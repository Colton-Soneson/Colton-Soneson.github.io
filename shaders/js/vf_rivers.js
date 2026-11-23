import { skyLookupShapes } from './vfc_atmosphere.js';

/*
	The rivers' water (rivers.js draws it, terrainGenerator.js THE RIVERS lays the rivers out and cuts their channels).

	Each river is a ribbon at the height of its water, a little wider than the water so its edges are under the banks. Over it:
		THE SURFACE		as a pond's: ripples over the water, in the world, carried along: a lake's by the wind, a river's down the way the
						land runs it (quicker where it falls steeply, as rapids are; quickest in the middle and slow by the banks; slow
						through a pool: terrainGenerator.js POOLS AND RIFFLES) and a little with the wind. Two layers of them carried half
						a cycle apart, each faded out as it starts again (as a flow map is), so they follow the water round its bends and
						are never drawn out. A little rougher where it runs quick or thin, or past something standing in it (WAKES: the
						frame before the water, a few metres upstream)
		WHAT IS UNDER	the frame as it stood before the water (screenEffects.js: the bed and anything in the water), through the water:
						the further the eye looks through it, the less of the bed and the more of the water's own color (Beer-Lambert:
						ABSORB a metre, and the light the water sends back itself, SCATTER), a little bent by the ripples
		THE SKY			reflected as much as the angle lets it (Schlick's Fresnel), and the sun glinting off it
		FOAM			on the rapids, a little in the wakes and at the edges
	A highland lake (its half width -1) is still water: ripples from the wind drifting slowly over it, no foam
	And faded into the horizon as everything else is, and soft at the shore where the water gets thin
*/
export const vf_rivers =
`
	struct RiverUniforms
	{
		viewProjectionMatrix : mat4x4f,
		time : f32,					// seconds
		fogDistance : f32,			// where things are about two thirds faded into the horizon
		atmosphereEnabled : f32,
		metre : f32,				// world units to the metre
		depthA : f32,				// the projection's numbers that turn a depth back into a distance along the view: depthB / (depth + depthA)
		depthB : f32,
		sceneReady : f32,			// 1.0 when the frame before the water was kept this frame (screenEffects.js)
		pad : f32,
		wind : vec4f,				// xy: the wind along the ground (its direction, times how hard it blows: about 1 for a breeze)
	}
	@group(0) @binding(0) var<uniform> UBO: RiverUniforms;

	struct LightsUniforms
	{
		lightViewProjMat : mat4x4f,
		sunPos : vec4f,
		sunCol : vec4f,
		camPos : vec4f,
		sunIntensity : f32,
		shadowMapKernelSize : f32,
		shadowMapTextureSize : f32,
		shadowMapAcneBias : f32,
		displayLightingMode : f32,
		moonPos : vec4f,
	}
	@group(0) @binding(1) var<uniform> Lights: LightsUniforms;
	@group(0) @binding(2) var skyLUT: texture_2d<f32>;
	@group(0) @binding(3) var skySampler: sampler;
	@group(0) @binding(4) var sceneColor: texture_2d<f32>;
	@group(0) @binding(5) var sceneDepth: texture_depth_2d;

	const PI: f32 = 3.14159265;
	${skyLookupShapes}

	const ABSORB: vec3f = vec3f(0.42, 0.17, 0.12);		// how much of the light a metre of river water takes, red to blue
	const SCATTER: vec3f = vec3f(0.05, 0.10, 0.09);		// the light it sends back of its own, in full daylight

	struct VertexInput {
		@location(0) pos: vec3f,
		@location(1) river: vec4f,		// x: how far along it (world units from its head), y: how far across (-1 and 1 at the water's edge), z: its half width, w: its fall
		@location(2) flow: vec2f,		// which way it runs (length 1)
		@location(3) depth: vec2f,		// x: how deep it is in the middle (world units), y: pool (1 a pool, -1 a riffle)
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) river: vec4f,
		@location(2) flow: vec2f,
		@location(3) viewDepth: f32,	// the distance along the view, as the depth buffer's own (clip w)
		@location(4) pool: f32,
	};

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		var output: VertexOutput;
		output.pos = UBO.viewProjectionMatrix * vec4f(input.pos, 1.0);
		output.worldPos = input.pos;
		output.river = input.river;
		output.flow = input.flow;
		output.viewDepth = output.pos.w;
		output.pool = input.depth.y;
		return output;
	}

	fn hash(p: vec2f) -> f32 {
		let q = fract(p * vec2f(0.1031, 0.1030));
		let r = q + dot(q, q.yx + 33.33);
		return fract((r.x + r.y) * r.x);
	}
	// value noise, smooth between whole numbers
	fn noise(p: vec2f) -> f32 {
		let i = floor(p);
		let f = fract(p);
		let u = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x), u.y);
	}
	// the ripples: three sizes of them, the small ones stretched along the flow a little less than the big
	fn ripples(p: vec2f) -> f32 {
		return 0.55 * noise(p * vec2f(0.6, 1.0)) + 0.3 * noise(p * vec2f(1.6, 2.1) + 7.3) + 0.15 * noise(p * vec2f(3.7, 4.3) - 2.1);
	}

	@fragment
	fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
		let m = UBO.metre;
		let fall = input.river.w;
		let flow = normalize(input.flow);
		let side = vec2f(-flow.y, flow.x);

		//------------------THE FLOW-----------------
		let lake = input.river.z < 0.0;
		let across = input.river.y;
		let pool = input.pool;
		// a slow river about 0.6 metres a second, rapids up to 4; quickest in the middle, slow by the banks; slow in a pool, quick on a riffle
		let speed = clamp(0.6 + 30.0 * fall, 0.6, 4.0) * (1.0 - 0.55 * min(across * across, 1.0)) * (1.0 - 0.35 * pool) * m;
		let rapid = smoothstep(0.02, 0.1, fall);

		let toEye = Lights.camPos.xyz - input.worldPos;
		let away = length(toEye);
		let V = toEye / away;

		//------------------WHAT IS UNDER (how thick)-----------------
		var through = 1.0 * m;
		if (UBO.sceneReady > 0.5) {
			let sceneD = textureLoad(sceneDepth, vec2i(input.pos.xy), 0);
			through = max(UBO.depthB / (sceneD + UBO.depthA) - input.viewDepth, 0.0) * away / max(input.viewDepth, 0.001);
		}
		let shallow = 1.0 - smoothstep(0.08 * m, 0.6 * m, through);

		//------------------WAKES-----------------
		// (anything at the surface a few metres upstream, as the frame before the water has it: there the water is thin, or gone)
		var wake = 0.0;
		if (UBO.sceneReady > 0.5 && !lake && abs(across) < 0.8) {
			let size = vec2f(textureDimensions(sceneDepth));
			for (var k = 1; k <= 4; k++) {
				let back = f32(k) * 0.9 * m;
				let up = input.worldPos - vec3f(flow.x, 0.0, flow.y) * back;
				let clip = UBO.viewProjectionMatrix * vec4f(up, 1.0);
				if (clip.w <= 0.0) { continue; }
				let ndc = clip.xy / clip.w;
				let px = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5) * size;
				if (any(px < vec2f(0.0)) || any(px >= size)) { continue; }
				let dUp = textureLoad(sceneDepth, vec2i(px), 0);
				let thin = UBO.depthB / (dUp + UBO.depthA) - clip.w;
				// (something within a hand's breadth of the surface there, or standing up through it: a wake, spreading and fading behind it)
				wake = max(wake, (1.0 - smoothstep(0.05 * m, 0.25 * m, thin)) * (1.0 - f32(k - 1) * 0.2));
			}
		}

		//------------------THE SURFACE-----------------
		// as a pond's: ripples over the water in the world (not the ribbon's frame: no seams where the river bends), carried along. A
		//		lake's by the wind alone; a river's down the way the land runs it (quicker where it falls, as rapids are) and a little
		//		with the wind. Two layers of them carried half a cycle apart, each faded out as it starts again (a flow map's way), so
		//		they go the way the water goes wherever it turns, and are never drawn out
		var g = vec2f(0.0);
		let drift = (UBO.wind.xy * 0.18 + select(flow * speed / m, vec2f(0.0), lake)) * m;		// world units a second
		let cycle = 2.4;
		for (var i = 0; i < 2; i++) {
			let t = fract(UBO.time / cycle + f32(i) * 0.5);
			let w = 1.0 - abs(2.0 * t - 1.0);
			let q = (input.worldPos.xz - drift * t * cycle + f32(i) * vec2f(17.3, 5.1) * m) / (2.2 * m);
			let e = 0.08;
			let h = ripples(q);
			g += vec2f(ripples(q + vec2f(e, 0.0)) - h, ripples(q + vec2f(0.0, e)) - h) / e * w;
		}
		// (a lake's as still as ever; a stream's a little rougher, the more where it runs quick or thin, or past something standing in it)
		g *= select(0.05 + 0.05 * rapid + 0.03 * shallow + 0.06 * wake, 0.045, lake);
		let N = normalize(vec3f(-g.x, 1.0, -g.y));

		//------------------WHAT IS UNDER-----------------
		// what is behind the water, bent a little by the ripples (by more the deeper it is; not on to anything in front of the water)
		var behind = vec3f(0.30, 0.28, 0.22) * 0.6;
		if (UBO.sceneReady > 0.5) {
			let size = vec2f(textureDimensions(sceneDepth));
			let here = vec2i(input.pos.xy);
			let bent = vec2i(clamp(input.pos.xy + N.xz * 40.0 * saturate(through / (2.0 * m)), vec2f(0.0), size - vec2f(1.0)));
			let bentDepth = textureLoad(sceneDepth, bent, 0);
			let bentFurther = UBO.depthB / (bentDepth + UBO.depthA) - input.viewDepth;
			behind = textureLoad(sceneColor, select(here, bent, bentFurther > 0.0), 0).rgb;
		}
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let kept = exp(-ABSORB * through / m);
		var color = behind * kept + SCATTER * (0.15 + 0.85 * daylight) * (1.0 - kept);

		//------------------THE SKY-----------------
		let R = reflect(-V, N);
		let fresnel = 0.02 + 0.98 * pow(1.0 - saturate(dot(N, V)), 5.0);
		let sky = skyColorAt(vec3f(R.x, max(R.y, 0.02), R.z));
		color = mix(color, sky, fresnel);
		color += Lights.sunCol.rgb * pow(saturate(dot(R, L)), 900.0) * 1.6 * daylight;

		//------------------FOAM-----------------
		// (carried down with the water, in the world as the ripples are)
		let fp = (input.worldPos.xz - drift * UBO.time) / (1.4 * m);
		let rapids = smoothstep(0.03, 0.14, fall) * smoothstep(0.5, 0.8, ripples(fp * 1.6 + 11.0));
		let edge = 0.25 * smoothstep(0.85, 1.0, abs(across)) * smoothstep(0.45, 0.7, ripples(fp * 3.1 - 5.0)) * smoothstep(0.6, 1.5, speed / m);
		let trail = 0.5 * wake * smoothstep(0.5, 0.75, ripples(fp * 2.2 + 23.0));
		let foam = select(saturate(rapids + edge + trail), 0.0, lake);
		color = mix(color, vec3f(0.85, 0.88, 0.88) * (0.25 + 0.75 * daylight), foam * 0.8);

		// and the same fade into the horizon
		if (UBO.atmosphereEnabled > 0.5) {
			let fog = 1.0 - exp(-pow(away / UBO.fogDistance, 2.0));
			color = mix(color, fogColorAt(-toEye), fog);
		}
		// (soft at the shore, where it is thin)
		var alpha = select(1.0, smoothstep(0.0, 0.35 * m, through), UBO.sceneReady > 0.5);
		// (and at its own edge, a smooth one, a little uneven: the ribbon's, not where the bank's mesh comes up through it, which follows
		//		the mesh's cells. The bed is cut on under the water past it for this: terrainGenerator.js THE RIVERS, shelf)
		if (!lake) {
			let along = input.river.x / m;
			let wobble = 0.32 * sin(along * 0.37 + 1.3 * sin(along * 0.11)) + 0.14 * sin(along * 1.13 + 2.0) + 0.06 * (ripples(vec2f(input.river.x, input.river.y * 3.0) / (1.5 * m)) - 0.5);
			alpha *= 1.0 - smoothstep(0.9, 1.0, abs(input.river.y) + wobble);
		}
		return vec4f(color, alpha);
	}
`;
