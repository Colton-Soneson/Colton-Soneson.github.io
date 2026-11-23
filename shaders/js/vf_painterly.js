import { skyTest } from './depthShapes.js';

/*
	PAINTERLY (painterly.js): the finished frame painted over, as the backgrounds of a hand painted animated film are (soft flat shapes of
	colour, clean skies, fresh greens, cool shade and warm light), in one pass over the screen after everything
	else (only the page's own controls go over it). For each pixel:
		THE STROKE		how wide the brush is here: the setting's width (pixels, for a 1080 line screen), wider near the camera and
						narrower far off (from the depth: NEAR_M to FAR_M), the sky in between. Which way the stroke runs: along the
						edges of what is there (across the way the light and dark change, from four taps half a stroke out), or where
						there is no edge to follow, the way its daub runs (THE DAUBS)
		THE DAUBS		the brush laid in daubs, held to the world, not the screen: they go with what they are painted on as the camera
						moves. Where the pixel is in the world (from the depth), in a grid of cells there each a daub a few strokes
						across (its size in the world from how much of it a pixel covers there; two sizes, a power of two apart,
						faded between, so none jumps as the camera comes nearer). Each daub its own way, the faint marks of its
						bristles in its own frame about its middle, its own touch of shade. None of it in the sky: a clean wash
		THE PAINT		the colour laid by the stroke: the picture round the pixel looked at in SECTORS slices round it (each RINGS
						taps out to the stroke's width, two to a slice), drawn out a little along the stroke. Each slice's mean and how
						much its colours differ: the slice whose colours agree most counts for nearly all (a Kuwahara filter, made to
						follow the stroke). So the flat stretches come out one colour, the edges stay sharp, and the colours within a
						stroke are its one colour: two near reds both the same red. Then sharpened a little against the picture round
						it, so the shapes stay crisp
		BANDS			and near colours run together: the lightness held to soft BANDS steps (the flat shapes of light and shade
						of a painted background), the step's edge wandering a little with the daubs
		THE EDGES		where one shape meets the next, the paint pooled a little darker, as a wash dries
		THE COLOURS		as a hand painted animated film's backgrounds: fuller, fresh greens, the shade cool and blue, the light warm,
						the darks lifted a little
		THE PAPER		the washes a little uneven over the page, and its grain
*/
export const vf_painterly =
`
	struct PainterlyUniforms
	{
		pixel : vec4f,			// xy: one pixel (of the picture, 0 to 1), zw: the picture's size in pixels
		brush : vec4f,			// x: the stroke's width (pixels), y, z: the projection's two numbers a depth is made from, w: world units to the metre
		invViewProj : mat4x4f,	// the screen and its depth back to the world, about the camera (no jitter)
		camera : vec4f,			// xyz: the camera's place in its origin cell (world units, see origin), w: world units a pixel covers 1 unit away
		origin : vec4f,			// xyz: which ORIGIN cell of the world the camera is in (whole numbers), w: ORIGIN (world units)
		right : vec4f,			// the camera's right, in the world
		up : vec4f,				// and its up
	}
	@group(0) @binding(0) var<uniform> PU: PainterlyUniforms;
	@group(0) @binding(1) var frame: texture_2d<f32>;		// the finished picture (a copy: a picture cant be read and drawn to at once)
	@group(0) @binding(2) var frameSampler: sampler;
	@group(0) @binding(3) var depthTexture: texture_depth_2d;

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
		var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
		return vec4f(corners[vertexIndex], 0.0, 1.0);
	}

	const PI: f32 = 3.14159265;
	const NEAR_M: f32 = 3.0;
	const FAR_M: f32 = 400.0;
	const SECTORS: i32 = 8;
	const RINGS: i32 = 3;
	const BANDS: f32 = 14.0;
	const DAUB: f32 = 3.6;			// a daub, strokes across

	// (hashes that hold steady however far the place is: no sine of a big number. The world's cells by whole numbers)
	fn hash21(p: vec2f) -> f32 { var q = fract(p * vec2f(0.1031, 0.1030)); q += dot(q, q.yx + 33.33); return fract((q.x + q.y) * q.x); }
	fn hash3u(c: vec3i) -> vec3f {
		var v = vec3u(c) * 1664525u + 1013904223u;
		v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
		v ^= v >> vec3u(16u);
		v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
		return vec3f(v & vec3u(0xffffu)) / 65535.0;
	}
	fn noise(p: vec2f) -> f32 {
		let i = floor(p); let f = fract(p); let u = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash21(i), hash21(i + vec2f(1.0, 0.0)), u.x), mix(hash21(i + vec2f(0.0, 1.0)), hash21(i + vec2f(1.0, 1.0)), u.x), u.y);
	}
	fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }
	fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(frame, frameSampler, uv, 0.0).rgb; }

	// the depth at this place on the screen
	fn depthAt(uv: vec2f) -> f32 {
		let size = vec2f(textureDimensions(depthTexture));
		return textureLoad(depthTexture, vec2i(clamp(uv * size, vec2f(0.0), size - 1.0)), 0);
	}

	// the bristle marks: their relief at a place in a daub's own frame (pixels: x along it, y across), its width r
	fn bristles(q: vec2f, r: f32) -> f32 {
		return 0.7 * noise(vec2f(q.x / (r * 2.6), q.y / max(r * 0.2, 3.0))) + 0.3 * noise(vec2f(q.x / (r * 1.1), q.y / max(r * 0.1, 2.0) + 17.0));
	}

	// THE DAUBS (see the top): at p (world units, about the camera's origin cell), a pixel there covering pixel units, the strokes
	//		r pixels wide. x: the marks, y: the shade, zw: the way they run (doubled, so a way and its opposite are one)
	fn daubsAt(p: vec3f, pixel: f32, r: f32, edgeWay: vec2f, edge: f32) -> vec4f {
		let wanted = log2(max(r * DAUB * pixel, 1e-4));
		let level0 = floor(wanted);
		var out = vec4f(0.0);
		for (var l = 0; l < 2; l++) {
			let level = level0 + f32(l);
			let lw = select(1.0 - fract(wanted), fract(wanted), l == 1);
			let size = exp2(level);
			let at = p / size - 0.5;
			let base = floor(at);
			let f = smoothstep(vec3f(0.0), vec3f(1.0), fract(at));
			// (the cell's number in the whole world: the origin cell's, in cells of this size, and the cell in it)
			let across = i32(round(PU.origin.w / size));
			for (var k = 0; k < 8; k++) {
				let o = vec3f(f32(k & 1), f32((k >> 1) & 1), f32((k >> 2) & 1));
				let cell = base + o;
				let w = lw * select(1.0 - f.x, f.x, o.x > 0.5) * select(1.0 - f.y, f.y, o.y > 0.5) * select(1.0 - f.z, f.z, o.z > 0.5);
				let h = hash3u(vec3i(cell) + vec3i(PU.origin.xyz) * across + vec3i(i32(level) * 7919));
				let middle = (cell + 0.5 + 0.35 * (h - 0.5)) * size;
				// (its way: its own, or along the edge there as much as there is one; on the screen, and so in the world about the camera)
				let own = h.x * PI * 2.0;
				let way2 = normalize(mix(vec2f(cos(own), sin(own)), edgeWay, edge) + vec2f(1e-5, 0.0));
				let a = 0.5 * atan2(way2.y, way2.x);
				let along = cos(a) * PU.right.xyz - sin(a) * PU.up.xyz;		// (the screen's y runs down)
				let side = -sin(a) * PU.right.xyz - cos(a) * PU.up.xyz;
				let q = vec2f(dot(p - middle, along), dot(p - middle, side)) / pixel + h.yz * 97.0;
				out += w * vec4f(bristles(q, r), h.z, way2);
			}
		}
		return out;
	}

	@fragment
	fn fragmentMain(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
		let uv = fragCoord.xy * PU.pixel.xy;
		let original = tap(uv);

		// where it is: metres off (the sky: -1), and its place in the world about the camera's origin cell
		let d = depthAt(uv);
		let sky = ${skyTest('d')};
		let distance = select(PU.brush.z / (d + PU.brush.y), 0.0, sky);
		let metres = select(distance / PU.brush.w, -1.0, sky);
		let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
		let world = PU.invViewProj * ndc;
		let p = world.xyz / world.w + PU.camera.xyz;

		// THE STROKE
		let near = select(1.0 - smoothstep(NEAR_M, FAR_M, metres), 0.7, sky);		// (the sky: broad strokes)
		let r = max(PU.brush.x * mix(0.4, 1.4, near), 1.0);
		let e = 0.5 * r * PU.pixel.xy;
		let cx0 = tap(uv - vec2f(e.x, 0.0)); let cx1 = tap(uv + vec2f(e.x, 0.0));
		let cy0 = tap(uv - vec2f(0.0, e.y)); let cy1 = tap(uv + vec2f(0.0, e.y));
		let g = vec2f(luma(cx1) - luma(cx0), luma(cy1) - luma(cy0));
		let edge = smoothstep(0.015, 0.08, length(g));
		let edgeAngle = atan2(g.y, g.x) + PI * 0.5;
		let edgeWay = vec2f(cos(2.0 * edgeAngle), sin(2.0 * edgeAngle));

		// THE DAUBS: held to the world (not in the sky)
		let rT = max(r, 6.0);		// (their marks never finer than a stroke 6 pixels wide: finer, they would only speckle)
		var daub = 0.5;
		var marks = 0.5;
		var way2 = edgeWay;
		if (!sky) {
			let here = daubsAt(p, distance * PU.camera.w, rT, edgeWay, edge);
			marks = here.x; daub = here.y; way2 = here.zw;
		}
		let angle = 0.5 * atan2(way2.y, way2.x + 1e-6);
		let along = vec2f(cos(angle), sin(angle));
		let across = vec2f(-along.y, along.x);
		let stretch = mix(1.15, 1.4, edge);
		let squeeze = mix(0.85, 0.65, edge);

		// THE PAINT
		var best = original;
		var total = vec3f(0.0);
		var weights = 0.0;
		for (var s = 0; s < SECTORS; s++) {
			var mean = original;
			var sq = original * original;
			var n = 1.0;
			for (var a = 0; a < 2; a++) {
				let theta = (f32(s) + (f32(a) + 0.5) * 0.5) * 2.0 * PI / f32(SECTORS);
				let dir = cos(theta) * stretch * along + sin(theta) * squeeze * across;
				for (var k = 1; k <= RINGS; k++) {
					let c = tap(uv + dir * (r * f32(k) / f32(RINGS)) * PU.pixel.xy);
					mean += c; sq += c * c; n += 1.0;
				}
			}
			mean /= n;
			let variance = sq / n - mean * mean;
			let spread = max(variance.r + variance.g + variance.b, 0.0);
			let w = 1.0 / (1.0 + pow(spread * 900.0, 4.0));		// (the most agreeing slice counts for nearly all)
			total += mean * w;
			weights += w;
		}
		var paint = total / max(weights, 1e-6);
		// (sharpened a little against the picture round it: crisp shapes, not a blur)
		let round4 = (cx0 + cx1 + cy0 + cy1) * 0.25;
		paint = max(paint + (paint - round4) * 0.45, vec3f(0.0));
		let brushed = select(1.0, 0.0, sky);

		// BANDS: the lightness held to soft steps, their edges wandering a little with the daubs
		let L = max(luma(paint), 1e-4);
		let x = L * BANDS + (daub - 0.5) * 0.5 * brushed + 0.5;
		let stepped = (floor(x) + smoothstep(0.25, 0.75, fract(x)) - 0.5) / BANDS;
		paint *= mix(1.0, clamp(stepped / L, 0.7, 1.4), 0.4 * brushed);
		paint *= mix(1.0, mix(0.985, 1.015, daub) * mix(0.985, 1.015, marks), brushed);

		// THE EDGES: where one shape meets the next, the paint pooled a little darker, as a wash dries
		paint *= 1.0 - 0.14 * smoothstep(0.04, 0.22, length(g)) * brushed;

		// THE COLOURS (a hand painted film's): fuller, the greens fresh, the shade cool and blue, the light warm, the darks lifted a little
		let Lp = luma(paint);
		paint = max(mix(vec3f(Lp), paint, 1.22), vec3f(0.0));
		paint = paint * 0.93 + 0.035;
		let shade = 1.0 - smoothstep(0.15, 0.6, Lp);
		paint *= mix(vec3f(1.0), vec3f(0.9, 0.95, 1.08), shade * 0.7);
		paint *= mix(vec3f(1.0), vec3f(1.04, 1.01, 0.94), smoothstep(0.45, 0.9, Lp) * 0.7);

		// THE PAPER: washes a little uneven over the page, and its grain
		let wash = mix(0.975, 1.025, noise(fragCoord.xy / 140.0 + vec2f(3.0, 1.0)));
		let grain = mix(0.99, 1.01, noise(fragCoord.xy / 3.0));
		return vec4f(clamp(paint * wash * grain, vec3f(0.0), vec3f(1.0)), 1.0);
	}
`;
