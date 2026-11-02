import { motionShapes } from './motionShapes.js';
import { itemMaterials } from './f_itemMaterials.js';

/*
	THE PROPS of the Survival mode (props.js): crates, sacks, campfires, the things thrown and lying about, out in the world. Each vertex is
	a model's (itemMeshes.js: metres, shape.w its part and material), each instance where it is (model: its metres into the world) and how
	it glows (glow: rgb and how strong, for one that is looked at, or of this player's own lying out, as the discs: discgolf.js).
	Lit by the sun and the moon, as everything else (no shadows: they are small), or as a room is (extra.x: what is inside a house, interiors.js: no sun
	on it, the day coming in at the windows, the lamps lit at night). What swims bends as it goes (extra.y: fish.js, whaling.js).
*/
export const vf_props =
`
	struct PropUniforms
	{
		viewProjection : mat4x4f,
		motionNow : mat4x4f,		// THE MOTION (temporalAA.js): this frame's view projection without the jitter
		motionPrev : mat4x4f,		//		and the last frame's (the props stand still: only the camera moves)
		time : vec4f,				// x: seconds
	}
	@group(0) @binding(0) var<uniform> PU: PropUniforms;
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
	struct Instance { model : mat4x4f, glow : vec4f, extra : vec4f, rig : vec4f, }	// extra: x indoors; y how far it bends, z where in the bend it is, w its length (metres, less than 0: up and down)
	@group(0) @binding(2) var<storage, read> instances: array<Instance>;

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) shape: vec3f,
		@location(2) @interpolate(flat) material: f32,
		@location(3) @interpolate(flat) glow: vec4f,
		@location(4) @interpolate(flat) indoors: f32,
		@location(5) @interpolate(flat) snow: f32,		// (the ponds' ice)
		@location(14) nowClip: vec4f,
		@location(15) prevClip: vec4f,
	};

	@vertex
	fn vertexMain(@location(0) shape: vec4f, @builtin(instance_index) k: u32) -> VertexOutput {
		let I = instances[k];
		var at = shape.xyz;
		if (I.extra.y != 0.0) {
			// a wave down its length, growing towards the tail (its head +z)
			let L = abs(I.extra.w);
			let t = saturate(0.5 - at.z / L);
			let bend = I.extra.y * L * t * t * sin(I.extra.z + t * 5.0);
			if (I.extra.w < 0.0) { at.y += bend; } else { at.x += bend; }
		}
		// four legs (rig: x where in its stride, y how far it is walking, z head down, w its kind; the mesh's parts: 1 the neck and head, 2 to 5 the legs, as vf_deer.js)
		if (I.rig.w > 0.5) {
			// its kind's: its hips' height, its knees', how far forward its front hips are and its hind ones; and the foot of its neck, its height and how far forward
			var rigs = array<vec4f, 6>(vec4f(0.0), vec4f(1.25, 0.66, 0.68, -0.78), vec4f(0.56, 0.3, 0.38, -0.42), vec4f(0.62, 0.32, 0.56, -0.6), vec4f(0.2, 0.1, 0.12, -0.13), vec4f(0.035, 0.018, 0.035, -0.045));
			var necks = array<vec2f, 6>(vec2f(0.0), vec2f(1.6, 0.8), vec2f(0.68, 0.46), vec2f(0.88, 0.72), vec2f(0.25, 0.15), vec2f(0.03, 0.03));
			let k2 = i32(I.rig.w + 0.5);
			let R = rigs[k2];
			let part = i32(shape.w + 0.5) % 32;
			if (part >= 2 && part <= 5) {
				let leg = part - 2;
				let turnIn = select(select(0.5, 0.0, leg == 2), select(0.75, 0.25, leg == 0), leg < 2);
				let phase = I.rig.x + turnIn * 6.2831853;
				let hip = vec3f(0.0, R.x, select(R.w, R.z, leg < 2));
				if (at.y < R.y - 0.01) {
					let knee = vec3f(at.x, R.y, hip.z);
					let bend = max(sin(phase), 0.0) * 0.7 * I.rig.y * select(1.0, -1.0, leg < 2);
					let d = at - knee;
					at = knee + vec3f(d.x, d.y * cos(bend) - d.z * sin(bend), d.y * sin(bend) + d.z * cos(bend));
				}
				let swing = cos(phase) * 0.42 * I.rig.y;
				let d2 = at - hip;
				at = hip + vec3f(d2.x, d2.y * cos(swing) - d2.z * sin(swing), d2.y * sin(swing) + d2.z * cos(swing));
			} else if (part == 1) {
				let foot = vec3f(0.0, necks[k2].x, necks[k2].y);
				let a = 1.05 * I.rig.z;
				let d = at - foot;
				at = foot + vec3f(d.x, d.y * cos(a) - d.z * sin(a), d.y * sin(a) + d.z * cos(a));
			}
		}
		let world = (I.model * vec4f(at, 1.0)).xyz;
		var output: VertexOutput;
		output.pos = PU.viewProjection * vec4f(world, 1.0);
		output.worldPos = world;
		output.shape = shape.xyz;
		output.material = floor((shape.w + 0.5) / 32.0);
		output.glow = I.glow;
		output.indoors = I.extra.x;
		output.snow = I.extra.z;
		output.nowClip = PU.motionNow * vec4f(world, 1.0);
		output.prevClip = PU.motionPrev * vec4f(world, 1.0);
		return output;
	}

	${itemMaterials}

	fn shade(input: VertexOutput) -> vec4f {
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		let toEye = Lights.camPos.xyz - input.worldPos;
		if (dot(N, toEye) < 0.0) { N = -N; }
		let m = i32(input.material + 0.5);
		var albedo = vec3f(0.4);
		var gloss = 0.1;
		if (m >= 20) { let im = itemMaterial(m, input.shape); albedo = im.rgb; gloss = im.a; }
		// the ponds' ice (ice.js): its marks run on from one square to the next, so they are the world's
		if (m == 86) {
			let w = input.worldPos.xz;
			let crack = abs(sin(w.x * 0.083 + 2.3 * sin(w.y * 0.047))) * abs(sin(w.y * 0.097 + 2.6 * sin(w.x * 0.037)));
			let fine = abs(sin(w.x * 0.31 + 1.7 * sin(w.y * 0.19) + w.y * 0.13));
			albedo = albedo * (0.9 + 0.1 * sin(w.x * 0.031 + w.y * 0.023)) * (0.97 + 0.03 * smoothstep(0.0, 0.05, fine)) + vec3f(0.1) * (1.0 - smoothstep(0.0, 0.007, crack));
			// the snow lying on it, in drifts
			let drift = 0.5 + 0.25 * sin(w.x * 0.021 + 1.9 * sin(w.y * 0.017)) + 0.15 * sin(w.y * 0.053 + 1.3 * sin(w.x * 0.041)) + 0.1 * sin((w.x + w.y) * 0.13);
			let lying = smoothstep(drift - 0.12, drift + 0.12, input.snow * 1.25);
			albedo = mix(albedo, vec3f(0.96, 0.97, 1.0), lying);
			gloss = mix(gloss, 0.04, lying);
		}
		else if (m == 1) { albedo = vec3f(0.06, 0.065, 0.075); gloss = 0.5; }
		else if (m == 2) { albedo = vec3f(0.62, 0.46, 0.2); gloss = 0.8; }
		else if (m == 8) { albedo = vec3f(0.62, 0.63, 0.65); gloss = 0.9; }
		else if (m == 9) { albedo = vec3f(0.05, 0.045, 0.04); }
		let L = normalize(Lights.sunPos.xyz);
		let day = smoothstep(-0.1, 0.25, L.y);
		let diffuse = saturate(dot(N, L)) * day;
		let H = normalize(L + normalize(toEye));
		let shine = pow(saturate(dot(N, H)), 32.0) * gloss * day;
		let moon = saturate(dot(N, normalize(Lights.moonPos.xyz))) * Lights.moonPos.w * 0.15;
		var color = albedo * (0.06 + 0.22 * day + 0.95 * diffuse + moon) + vec3f(shine * 0.5);
		if (input.indoors > 0.5) {
			// a room: no sun on it, the day in at the windows, the lamps lit as it gets dark (warm), a little more on what faces up
			let room = (0.2 + 0.55 * day) * (0.72 + 0.28 * N.y) * vec3f(0.98, 0.96, 0.92) + (1.0 - day) * vec3f(0.34, 0.26, 0.17) * (0.8 + 0.2 * N.y);
			color = albedo * room;
			if (m == 61 || m == 99) { color = mix(vec3f(0.03, 0.04, 0.08), vec3f(0.9, 1.0, 1.1), day); }
		}
		color += itemGlow(m) * (0.8 + 0.2 * sin(PU.time.x * 13.0 + input.shape.x * 40.0));
		// a cabin's windows: by night, the warm of the room behind them
		if (m == 99) { color += vec3f(1.5, 0.92, 0.42) * smoothstep(0.75, 0.15, day); }
		color += input.glow.rgb * input.glow.a * (0.35 + 0.65 * saturate(dot(N, normalize(toEye))));
		return vec4f(color, 1.0);
	}

	${motionShapes}
	@fragment
	fn fragmentMain(input: VertexOutput) -> FrameOut {
		return FrameOut(shade(input), motionOf(input.nowClip, input.prevClip));
	}
`;
