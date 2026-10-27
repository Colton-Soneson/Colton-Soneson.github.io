import { reversedDepth } from '../../code/depthMode.js';

/*
	TAA: Temporal Anti-Aliasing (temporalAA.js). Every frame is drawn a fraction of a pixel to one side or another (THE JITTER,
	transformations.js), so the frames one after another see between the pixels. Each frame is blended into what the frames before
	made (the history), a little at a time: an edge comes out as smooth as many frames' worth of samples across it.
	For every pixel:
		1. where it was		the motion (vf_motion.js, and what moved of itself) of whichever of the 3 x 3 pixels round it is nearest the
							camera: an edge of something in front takes the motion of the thing in front, not of what is behind it
		2. the history		read there, between its pixels with a Catmull-Rom spline (bilinear would blur it a little more every frame)
		3. kept honest		what the history says can only be what the pixels round it now could make: it is pulled into a box round
							their colours (in YCoCg: brightness and two colour differences, a tighter box than red, green and blue),
							the box no wider than TU.look.z standard deviations from their mean. What was there and is no longer
							(something moved off it, it is lit differently) is let go of at once, and nothing smears behind what moves
		4. blended			TU.look.y of this frame, the rest the history (more of this frame the faster it moves: the history read
							between its pixels is softer), each weighed by one over its brightness so a single bright pixel does
							not flicker
	Nothing to go on (just started, the camera jumped, or it was off the screen the frame before): this frame as it is.
	The result is the new history, and goes on the canvas.
*/
const NEARER = reversedDepth ? '>' : '<';
export const c_taa =
`
	struct TaaUniforms
	{
		size : vec4f,		// the frame's pixels across and down, and one over each
		look : vec4f,		// x: 1 to start again (no history), y: how much of this frame goes in, z: the box's half width (standard deviations), w: more of this frame for every pixel it moved
	}
	@group(0) @binding(0) var<uniform> TU: TaaUniforms;
	@group(0) @binding(1) var frame: texture_2d<f32>;
	@group(0) @binding(2) var history: texture_2d<f32>;
	@group(0) @binding(3) var motion: texture_2d<f32>;
	@group(0) @binding(4) var depthTexture: texture_depth_2d;
	@group(0) @binding(5) var linearSampler: sampler;
	@group(0) @binding(6) var historyOut: texture_storage_2d<rgba16float, write>;
	@group(0) @binding(7) var output: texture_storage_2d<rgba8unorm, write>;

	fn toYCoCg(c: vec3f) -> vec3f {
		return vec3f(dot(c, vec3f(0.25, 0.5, 0.25)), dot(c, vec3f(0.5, 0.0, -0.5)), dot(c, vec3f(-0.25, 0.5, -0.25)));
	}
	fn fromYCoCg(c: vec3f) -> vec3f {
		return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
	}
	fn luma(c: vec3f) -> f32 {
		return dot(c, vec3f(0.299, 0.587, 0.114));
	}

	// the history at uv, between its pixels: a Catmull-Rom spline over the 4 x 4 round it, as 5 bilinear reads (its corners left out)
	fn historyAt(uv: vec2f) -> vec3f {
		let pos = uv * TU.size.xy;
		let middle = floor(pos - 0.5) + 0.5;
		let f = pos - middle;
		let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
		let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
		let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
		let w3 = f * f * (-0.5 + 0.5 * f);
		let w12 = w1 + w2;
		let at12 = (middle + w2 / w12) * TU.size.zw;
		let at0 = (middle - 1.0) * TU.size.zw;
		let at3 = (middle + 2.0) * TU.size.zw;
		let c = textureSampleLevel(history, linearSampler, vec2f(at12.x, at0.y), 0.0).rgb * (w12.x * w0.y)
			+ textureSampleLevel(history, linearSampler, vec2f(at0.x, at12.y), 0.0).rgb * (w0.x * w12.y)
			+ textureSampleLevel(history, linearSampler, at12, 0.0).rgb * (w12.x * w12.y)
			+ textureSampleLevel(history, linearSampler, vec2f(at3.x, at12.y), 0.0).rgb * (w3.x * w12.y)
			+ textureSampleLevel(history, linearSampler, vec2f(at12.x, at3.y), 0.0).rgb * (w12.x * w3.y);
		let total = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
		return max(c / total, vec3f(0.0));
	}

	// a colour pulled into a box (lo to hi) towards its middle, if it is outside it
	fn intoBox(c: vec3f, lo: vec3f, hi: vec3f) -> vec3f {
		let middle = 0.5 * (hi + lo);
		let half = 0.5 * (hi - lo) + 1e-5;
		let off = c - middle;
		let most = max(abs(off.x / half.x), max(abs(off.y / half.y), abs(off.z / half.z)));
		return select(c, middle + off / most, most > 1.0);
	}

	@compute @workgroup_size(8, 8)
	fn computeMain(@builtin(global_invocation_id) id: vec3u) {
		let size = vec2i(TU.size.xy);
		let p = vec2i(id.xy);
		if (p.x >= size.x || p.y >= size.y) {
			return;
		}
		let here = textureLoad(frame, p, 0).rgb;
		// the 3 x 3 round it: its colours (their mean, spread and box), and which is nearest the camera
		var sum = vec3f(0.0);
		var squares = vec3f(0.0);
		var lo = vec3f(1e9);
		var hi = vec3f(-1e9);
		var nearest = p;
		var nearestDepth = textureLoad(depthTexture, p, 0);
		for (var dy = -1; dy <= 1; dy++) {
			for (var dx = -1; dx <= 1; dx++) {
				let q = clamp(p + vec2i(dx, dy), vec2i(0), size - 1);
				let c = toYCoCg(textureLoad(frame, q, 0).rgb);
				sum += c;
				squares += c * c;
				lo = min(lo, c);
				hi = max(hi, c);
				let d = textureLoad(depthTexture, q, 0);
				if (d ${NEARER} nearestDepth) {
					nearestDepth = d;
					nearest = q;
				}
			}
		}
		let moved = textureLoad(motion, nearest, 0).xy;
		let back = (vec2f(p) + 0.5) * TU.size.zw + moved;
		var result = here;
		if (TU.look.x < 0.5 && all(back >= vec2f(0.0)) && all(back <= vec2f(1.0))) {
			let mean = sum / 9.0;
			let spread = sqrt(max(squares / 9.0 - mean * mean, vec3f(0.0)));
			let past = fromYCoCg(intoBox(toYCoCg(historyAt(back)), max(lo, mean - TU.look.z * spread), min(hi, mean + TU.look.z * spread)));
			let now = clamp(TU.look.y + TU.look.w * length(moved * TU.size.xy), TU.look.y, 0.5);
			let wNow = now / (1.0 + luma(here));
			let wPast = (1.0 - now) / (1.0 + luma(past));
			result = (here * wNow + past * wPast) / (wNow + wPast);
		}
		textureStore(historyOut, p, vec4f(result, 1.0));
		textureStore(output, p, vec4f(result, 1.0));
	}
`;
