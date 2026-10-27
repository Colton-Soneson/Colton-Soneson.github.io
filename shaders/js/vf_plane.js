import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';

/*
	The biplane drawn (see plane.js for the plane itself: its mesh, in metres, +x its left wing, +y up, +z out of its nose, the origin at
	its centre of gravity, and how it flies).

	One plane a draw. Each vertex says which part it is (shape.w % 32) and what it is made of (shape.w / 32): each part has its matrix
	(parts: where it is on the plane now: the propeller turned, an aileron, the elevators or the rudder deflected, a lever pulled, the
	gunner's ring and his Lewis gun turned to where he aims), and then the whole plane its own (model: from its metres into the world).
	THE MATERIALS: the Lewis gun's own (as vf_viewmodel.js: 0 walnut, 1 blued steel, 2 brass, 3 lead, 9 dark, 17 its pan's ribbed top),
	and the plane's:
		20	the wings' and the tailplane's doped linen: the khaki green of PC10 on top, the pale clear dope under, the ribs showing as
			lighter tapes, and the roundels, red, white and blue: on top of the upper wing and under the lower, out by the tips
		21	the fuselage's linen: PC10, pale underneath, a roundel on either side behind the gunner
		22	the cowling's painted metal		23 the varnished wood of the struts		24 the propeller's laminated wood, its tips
		sheathed in brass		25 the radiator's honeycomb		26 a tyre		27 the leather round the cockpits		28 the windscreen
		29 the exhausts' rusty iron		30 the rudder, striped blue, white and red		31 the instrument board		32 the propeller's
		blur, spinning fast (drawn with holes in it, more of them the slower it goes: look.w)		33 the bracing wires
		34 inside the cockpits		35 a parachute's silk, its panels in two shades		37 a red knob		38 a bomb's paint
		36 a puff of fire, burning out to smoke (state.z: how far
		through its life it is), thinning to nothing (holes in it, as the propeller's blur)
	The light is the sun's and the moon's, as on everything else, and it fades into the horizon colour far off.
*/
export const vf_plane =
`
	struct PlaneUniforms
	{
		viewProjectionMatrix : mat4x4f,
		model : mat4x4f,			// the plane's metres into the world
		cameraPosition : vec4f,		// xyz, w: seconds
		look : vec4f,				// x: horizon fog distance, y: 1.0 if the atmosphere is on, z: the part the crosshair is on (-1 none), w: the propeller's blur, 0 to 1
		state : vec4f,				// x: wrecked, 0 to 1, y: world units to the metre, z: a puff of fire's age, 0 to 1, w: its side in the war (0 none, 1 red, 2 blue)
		parts : array<mat4x4f, 26>,
	}
	@group(0) @binding(0) var<uniform> PU: PlaneUniforms;

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
		moonPos : vec4f,			// xyz: towards the moon, w: how bright it is (see f_moon.js)
	}
	@group(0) @binding(1) var<uniform> Lights: LightsUniforms;
	@group(0) @binding(2) var skyLUT: texture_2d<f32>;
	@group(0) @binding(3) var skySampler: sampler;

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) shape: vec3f,
		@location(2) @interpolate(flat) what: vec2f,		// x: the material, y: the part
	};

	@vertex
	fn vertexMain(@location(0) shape: vec4f) -> VertexOutput {
		let code = i32(shape.w + 0.5);
		let part = min(code % 32, 25);
		let material = code / 32;
		let placed = (PU.parts[part] * vec4f(shape.xyz, 1.0)).xyz;
		let world = (PU.model * vec4f(placed, 1.0)).xyz;
		var output: VertexOutput;
		output.pos = PU.viewProjectionMatrix * vec4f(world, 1.0);
		output.worldPos = world;
		output.shape = shape.xyz;
		output.what = vec2f(f32(material), f32(part));
		return output;
	}

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;	// see f_water

	${skyLookupShapes}

	${moonShapes}

	// a screen door's pattern for a pixel: interleaved gradient noise, its pattern moved on every frame (seconds: t). Even, without stripes
	fn screenDoor(pixel: vec2f, t: f32) -> f32 {
		let frame = f32(u32(t * 60.0) % 64u);
		let p = floor(pixel) + vec2f(5.588238 * frame);
		return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
	}

	fn hash2(p: vec2f) -> f32 {
		return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
	}

	// a roundel: red in the middle, then white, then blue, r from its middle (metres), size its radius. a: 0 outside it
	// the khaki green, or in the war its side's colour (state.w: war.js)
	fn sidePaint(c: vec3f) -> vec3f {
		if (PU.state.w > 1.5) { return vec3f(0.1, 0.2, 0.55); }
		if (PU.state.w > 0.5) { return vec3f(0.6, 0.1, 0.08); }
		return c;
	}

	fn roundel(r: f32, size: f32) -> vec4f {
		if (r > size) { return vec4f(0.0); }
		if (r < size * 0.36) { return vec4f(0.62, 0.08, 0.07, 1.0); }
		if (r < size * 0.68) { return vec4f(0.86, 0.85, 0.8, 1.0); }
		return vec4f(0.1, 0.16, 0.38, 1.0);
	}

	const PC10: vec3f = vec3f(0.31, 0.29, 0.17);
	const LINEN: vec3f = vec3f(0.76, 0.7, 0.55);

	@fragment
	fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
		let toPlane = input.worldPos - Lights.camPos.xyz;
		let away = length(toPlane);
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		if (dot(N, toPlane) > 0.0) {
			N = -N;
		}
		// the normal in the plane's own directions: which way a face looks on it (up: the top of a wing)
		let metre = PU.state.y;
		let R = mat3x3f(PU.model[0].xyz / metre, PU.model[1].xyz / metre, PU.model[2].xyz / metre);
		let Nb = transpose(R) * N;
		let at = input.shape;
		let m = i32(input.what.x + 0.5);
		var albedo = vec3f(0.5, 0.5, 0.5);
		var shine = 0.05;
		var power = 24.0;
		var glow = vec3f(0.0);
		switch (m) {
			case 0: { albedo = vec3f(0.36, 0.19, 0.08) * (0.85 + 0.15 * sin(at.z * 240.0)); shine = 0.15; }
			case 1, 17: {
				albedo = vec3f(0.055, 0.06, 0.07); shine = 0.5; power = 40.0;
				if (m == 17 && abs(fract(atan2(at.x, at.z) / (2.0 * PI) * 25.0) - 0.5) < 0.12 && length(at.xz) > 0.03) { albedo *= 0.55; }
			}
			case 2: { albedo = vec3f(0.62, 0.46, 0.2); shine = 0.7; power = 32.0; }
			case 3: { albedo = vec3f(0.45, 0.42, 0.4); shine = 0.4; }
			case 9: { albedo = vec3f(0.05, 0.045, 0.04); }
			case 20: {
				// the wings: PC10 on top, the pale dope under, the ribs every third of a metre, the roundels out by the tips
				let top = Nb.y > 0.0;
				albedo = select(LINEN, sidePaint(PC10), top);
				let rib = abs(fract(at.x / 0.33) - 0.5);
				albedo *= select(1.0, 1.08, rib > 0.46);
				let upper = at.y > 0.6;
				if ((upper && top) || (!upper && !top)) {
					let r = roundel(length(vec2f(abs(at.x) - 4.35, at.z - select(-0.4, -0.1, upper))), 0.72);
					if (r.a > 0.0) { albedo = r.rgb; }
				}
				shine = 0.06;
			}
			case 21: {
				albedo = select(sidePaint(PC10), LINEN, Nb.y < -0.6);
				if (abs(Nb.x) > 0.6) {
					let r = roundel(length(vec2f(at.z + 2.95, at.y - 0.02)), 0.4);
					if (r.a > 0.0) { albedo = r.rgb; }
				}
				shine = 0.06;
			}
			case 22: { albedo = sidePaint(PC10) * 0.92; shine = 0.3; power = 30.0; }
			case 23: { albedo = vec3f(0.46, 0.31, 0.17) * (0.9 + 0.1 * sin(at.y * 60.0 + at.x * 40.0)); shine = 0.25; }
			case 24: {
				let along = length(at.xy - vec2f(0.0, 0.05));
				albedo = vec3f(0.4, 0.23, 0.1) * (0.8 + 0.2 * step(0.5, fract(at.z * 220.0)));
				if (along > 1.25) { albedo = vec3f(0.62, 0.46, 0.2); shine = 0.6; }
				else { shine = 0.3; }
			}
			case 25: {
				let cell = abs(fract(at.xy * vec2f(28.0, 28.0)) - vec2f(0.5));
				albedo = select(vec3f(0.06, 0.06, 0.06), vec3f(0.3, 0.28, 0.25), cell.x > 0.4 || cell.y > 0.4);
				shine = 0.3;
			}
			case 26: { albedo = vec3f(0.05, 0.05, 0.05); shine = 0.08; }
			case 27: { albedo = vec3f(0.26, 0.13, 0.06); shine = 0.2; }
			case 28: { albedo = vec3f(0.12, 0.16, 0.18); shine = 0.9; power = 64.0; }
			case 29: { albedo = vec3f(0.2, 0.13, 0.09) * (0.8 + 0.3 * hash2(floor(at.xz * 40.0))); shine = 0.15; }
			case 30: {
				// the rudder: blue at the hinge, white, red at the trailing edge
				let t = (-4.95 - at.z) / 0.62;
				albedo = select(select(vec3f(0.62, 0.08, 0.07), vec3f(0.86, 0.85, 0.8), t < 0.66), vec3f(0.1, 0.16, 0.38), t < 0.33);
				shine = 0.06;
			}
			case 31: {
				albedo = vec3f(0.3, 0.18, 0.09);
				let dial = min(min(length(at.xy - vec2f(0.15, 0.3)), length(at.xy - vec2f(-0.15, 0.3))), length(at.xy - vec2f(0.0, 0.18)));
				if (dial < 0.055) { albedo = select(vec3f(0.85, 0.82, 0.72), vec3f(0.05, 0.05, 0.05), dial > 0.048); }
			}
			case 32: {
				// the propeller's blur: holes through it, more the slower it spins (screen door)
				let hole = screenDoor(input.pos.xy, PU.cameraPosition.w);
				if (hole > PU.look.w * 0.22) { discard; }
				albedo = vec3f(0.36, 0.25, 0.14);
			}
			case 33: { albedo = vec3f(0.5, 0.5, 0.52); shine = 0.5; }
			case 34: { albedo = vec3f(0.07, 0.06, 0.05); }
			case 35: { albedo = vec3f(0.88, 0.85, 0.78) * select(1.0, 0.82, fract(atan2(at.x, at.z) / (2.0 * PI) * 6.0) < 0.5); shine = 0.15; }
			case 36: {
				let age = PU.state.z;
				if (screenDoor(input.pos.xy + vec2f(17.0, 3.0), PU.cameraPosition.w) > 1.2 - age * 1.2) { discard; }
				let fire = saturate(1.0 - age * 2.4);
				albedo = mix(vec3f(0.17, 0.16, 0.15), vec3f(0.35, 0.14, 0.04), fire);
				glow = vec3f(4.0, 1.7, 0.45) * fire * fire;
			}
			case 37: { albedo = vec3f(0.55, 0.06, 0.05); shine = 0.45; power = 24.0; }
			case 38: { albedo = vec3f(0.2, 0.22, 0.17); shine = 0.35; power = 20.0; }
			default: {}
		}
		// burnt, wrecked
		albedo *= 1.0 - 0.65 * PU.state.x;

		// the same light as everything else
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.09 + daylight * (0.34 + 0.72 * saturate(dot(N, L)));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		let V = normalize(-toPlane);
		let gloss = pow(saturate(dot(N, normalize(L + V))), power) * shine * daylight;
		var color = albedo * (light * sunTint + moonLight(N)) + vec3f(gloss) + glow;

		// what the crosshair is on
		if (abs(input.what.y - PU.look.z) < 0.5) {
			color = mix(color, vec3f(1.0, 0.85, 0.35), 0.35 + 0.2 * sin(PU.cameraPosition.w * 6.0));
		}

		if (PU.look.y > 0.5) {
			let horizonColor = fogColorAt(toPlane);
			let fog = 1.0 - exp(-pow(away / PU.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, 1.0);
	}
`;
