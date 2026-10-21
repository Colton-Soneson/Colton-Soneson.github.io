import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';

/*
	The horses drawn. See horse.js for the horse itself (its mesh, in metres, standing on y = 0 and facing +z, +x its left) and how
	it is ridden.

	One mesh, drawn once for every horse (instancing). What moves is moved here, from each vertex's part (shape.w):
		0			the body (the barrel, the chest, the rump)
		1, 2, 3		the neck, the head (with its ears) and the mane: nodding with the gait, and down to graze, about the foot of the neck
		4			the tail, swishing
		5 to 8		the upper legs: left front, right front, left hind, right hind. Each swings from the shoulder or the hip
		9 to 12		the lower legs and hooves: swing with the leg above, and fold at the knee (the hock behind) as the hoof comes forward
		13, 14, 17	the saddle and its stirrups, the saddlebags, the blanket: on the body
		16			the reins: from the bit (with the head) back to the pommel (with the body)
	THE GAITS (gait, 0 to 3: walk, trot, canter, gallop, in between while it changes) are the order the hooves come down in, each
	leg's own part of the stride (LEG_TIMING), and how far it swings. The body bobs, twice a stride at the walk and the trot,
	and rocks once a stride at the canter and the gallop, with the head and neck going the other way. phase: where it is in its
	stride (radians), going on as fast as the horse goes (see strideLength in horse.js).
	Then all of it is tipped to the slope it stands on, turned to its heading, made its size and put in its place.

	The coats (coat, 0 to 1): a bay, a chestnut, a black, a grey, a palomino. The mane, the tail and the lower legs (the points) and the
	hooves are darker. The tack is leather, the blanket red, the stirrups and the bit steel.
*/
export const vf_horse =
`
	struct HorseUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz, w: seconds
		look : vec4f,				// x: horizon fog distance, y: 1.0 if the atmosphere is on, z: the horse the crosshair is on (-1), w: which of it (0 saddle, 1 bags)
	}
	@group(0) @binding(0) var<uniform> HU: HorseUniforms;

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

	struct VertexInput {
		@location(0) shape: vec4f,		// xyz: the mesh, in metres. w: which part (see the top of the file)
		@location(1) place: vec4f,		// this horse: xyz where its hooves stand, w: world units to the metre
		@location(2) pose: vec4f,		// x: its heading (radians, round from +z towards +x), y: where it is in its stride (radians), z: how hard it is going (0 standing to 1 flat out), w: its gait (0 to 3)
		@location(3) state: vec4f,		// x: the slope under it along its heading (radians, nose up), y: its coat (0 to 1), z: head down (0 to 1, grazing), w: its number (for the crosshair)
		@location(4) more: vec4f,		// x: swimming (0 to 1), y: its own swish (seconds offset)
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) onHorse: vec4f,		// xyz: where on the mesh as it was made, w: the part
		@location(2) @interpolate(flat) coat: vec2f,	// x: the coat, y: lit by the crosshair (0, 1 saddle, 2 bags)
	};

	fn turnX(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x, v.y * cos(angle) - v.z * sin(angle), v.y * sin(angle) + v.z * cos(angle)); }
	fn turnY(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) + v.z * sin(angle), v.y, v.z * cos(angle) - v.x * sin(angle)); }
	fn turnZ(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) - v.y * sin(angle), v.x * sin(angle) + v.y * cos(angle), v.z); }

	const NECK_FOOT: vec3f = vec3f(0.0, 1.38, 0.68);
	const SHOULDER_Y: f32 = 1.05;
	const KNEE_Y: f32 = 0.52;
	const FRONT_Z: f32 = 0.55;
	const HIND_Z: f32 = -0.6;
	const BIT: vec3f = vec3f(0.0, 1.55, 1.52);

	// each leg's part of the stride (left front, right front, left hind, right hind), at each gait: the order the hooves come down in
	fn legTiming(gait: i32) -> vec4f {
		switch (gait) {
			case 0: { return vec4f(0.25, 0.75, 0.0, 0.5); }		// the walk, four beats: left hind, left front, right hind, right front
			case 1: { return vec4f(0.0, 0.5, 0.5, 0.0); }		// the trot, two beats: the diagonal pairs together
			case 2: { return vec4f(0.66, 0.33, 0.33, 0.0); }	// the canter on the right lead, three beats
			default: { return vec4f(0.5, 0.62, 0.0, 0.12); }	// the gallop, four beats close together
		}
	}
	fn gaitValue(a: vec4f, gait: f32) -> f32 {
		let g = clamp(gait, 0.0, 3.0);
		let low = i32(floor(g));
		let high = min(low + 1, 3);
		return mix(a[low], a[high], g - f32(low));
	}

	// the body's bob (metres) and rock (radians, nose up) at this point of the stride: the same sums as bodyMotion in horse.js
	fn bodyMotion(phase: f32, gait: f32, going: f32) -> vec2f {
		let twice = sin(2.0 * phase);
		let once = sin(phase);
		let bob = gaitValue(vec4f(0.02, 0.05, 0.0, 0.0), gait) * twice + gaitValue(vec4f(0.0, 0.0, 0.06, 0.07), gait) * once;
		let rock = gaitValue(vec4f(0.0, 0.0, 0.06, 0.05), gait) * cos(phase);
		return vec2f(bob, rock) * min(going * 10.0, 1.0);
	}

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		var p = input.shape.xyz;
		let part = i32(input.shape.w + 0.5);
		let phase = input.pose.y;
		let going = input.pose.z;
		let gait = input.pose.w;
		let seconds = HU.cameraPosition.w + input.more.y;
		let swim = input.more.x;

		if (part >= 5 && part <= 12) {
			// a leg: its part of the stride, its swing from the shoulder or the hip, the knee folding as the hoof comes forward
			let leg = (part - 5) % 4;
			let front = leg < 2;
			let gaitI = i32(clamp(round(gait), 0.0, 3.0));
			let timing = mix(legTiming(i32(floor(clamp(gait, 0.0, 3.0)))), legTiming(min(i32(floor(clamp(gait, 0.0, 3.0))) + 1, 3)), fract(clamp(gait, 0.0, 2.999)));
			let legPhase = phase + timing[leg] * 6.2831853;
			let swingSize = gaitValue(vec4f(0.3, 0.42, 0.55, 0.75), gait) * min(going * 10.0, 1.0) + 0.5 * swim;
			let foldSize = gaitValue(vec4f(0.9, 1.1, 1.2, 1.4), gait) * min(going * 10.0, 1.0) + 0.8 * swim;
			let hip = vec3f(p.x, SHOULDER_Y, select(HIND_Z, FRONT_Z, front));
			if (part >= 9) {
				let knee = vec3f(p.x, KNEE_Y, hip.z);
				let fold = max(sin(legPhase), 0.0) * foldSize * select(-1.0, 1.0, front);	// (the front knees fold back, the hocks forward)
				p = knee + turnX(p - knee, fold);
			}
			p = hip + turnX(p - hip, -cos(legPhase) * swingSize);
		} else if (part >= 1 && part <= 3) {
			// the neck and the head: nodding with the stride, down to the grass when it grazes
			let nod = gaitValue(vec4f(0.06, 0.02, 0.12, 0.1), gait) * min(going * 10.0, 1.0) * sin(phase * select(1.0, 2.0, gait < 0.5));
			p = NECK_FOOT + turnX(p - NECK_FOOT, nod + 1.1 * input.state.z - 0.25 * swim);
		} else if (part == 4) {
			// the tail: swishing, and lifted when it goes hard
			let root = vec3f(0.0, 1.32, -0.82);
			let along = clamp((root.y - p.y) / 0.8, 0.0, 1.0);
			p = root + turnX(p - root, -0.35 * going * along);
			p.x += along * along * (0.12 * sin(seconds * 1.7) + 0.05 * sin(seconds * 4.1));
		} else if (part == 16) {
			// the reins: the front of each goes with the head (nodding as it does), the back stays on the saddle
			let nod = gaitValue(vec4f(0.06, 0.02, 0.12, 0.1), gait) * min(going * 10.0, 1.0) * sin(phase * select(1.0, 2.0, gait < 0.5));
			let withHead = clamp((p.z - 0.32) / (BIT.z - 0.32), 0.0, 1.0);
			p = mix(p, NECK_FOOT + turnX(p - NECK_FOOT, nod + 1.1 * input.state.z), withHead);
		}

		// the body bobbing and rocking with the gait, low in the water swimming
		let motion = bodyMotion(phase, gait, going);
		p = turnX(p - vec3f(0.0, 1.2, 0.0), -motion.y) + vec3f(0.0, 1.2 + motion.x, 0.0);

		let tipped = turnX(p, -input.state.x);
		let position = input.place.xyz + turnY(tipped, input.pose.x) * input.place.w;

		var output: VertexOutput;
		output.pos = HU.viewProjectionMatrix * vec4f(position, 1.0);
		output.worldPos = position;
		output.onHorse = vec4f(input.shape.xyz, f32(part));
		var lit = 0.0;
		if (abs(input.state.w - HU.look.z) < 0.5) {
			lit = select(0.0, 1.0 + HU.look.w, (HU.look.w < 0.5 && part == 13) || (HU.look.w > 0.5 && part == 14));
		}
		output.coat = vec2f(input.state.y, lit);
		return output;
	}

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;	// see f_water

	${skyLookupShapes}

	${moonShapes}

	struct FragInput {
		@location(0) worldPos: vec3f,
		@location(1) onHorse: vec4f,
		@location(2) @interpolate(flat) coat: vec2f,
	};

	// the coat's colour, its points (the mane, the tail, the lower legs) and how light its belly and muzzle are
	fn coatColours(c: f32) -> array<vec3f, 2> {
		let k = i32(clamp(c * 5.0, 0.0, 4.99));
		switch (k) {
			case 0: { return array<vec3f, 2>(vec3f(0.36, 0.19, 0.09), vec3f(0.05, 0.04, 0.035)); }		// bay
			case 1: { return array<vec3f, 2>(vec3f(0.48, 0.23, 0.1), vec3f(0.38, 0.17, 0.07)); }		// chestnut
			case 2: { return array<vec3f, 2>(vec3f(0.06, 0.055, 0.05), vec3f(0.03, 0.03, 0.03)); }		// black
			case 3: { return array<vec3f, 2>(vec3f(0.62, 0.62, 0.6), vec3f(0.35, 0.35, 0.36)); }		// grey
			default: { return array<vec3f, 2>(vec3f(0.72, 0.55, 0.3), vec3f(0.88, 0.84, 0.72)); }		// palomino, its mane and tail pale
		}
	}

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let toHorse = input.worldPos - Lights.camPos.xyz;
		let away = length(toHorse);
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		if (dot(N, toHorse) > 0.0) {
			N = -N;
		}

		let at = input.onHorse.xyz;
		let part = i32(input.onHorse.w + 0.5);
		let coats = coatColours(input.coat.x);
		var albedo = coats[0];
		var shine = 0.0;
		if (part == 3 || part == 4) {
			albedo = coats[1];										// the mane and the tail
		} else if (part >= 5 && part <= 12) {
			albedo = mix(coats[1], coats[0], smoothstep(0.35, 0.75, at.y));	// the points: darker down the legs
			if (at.y < 0.1) {
				albedo = vec3f(0.08, 0.075, 0.07);					// the hooves
			}
		} else if (part == 2) {
			if (at.z > 1.55) {
				albedo = coats[0] * 0.55;							// the muzzle
			}
			if (abs(at.z - 1.45) < 0.025 || (abs(at.z - 1.2) < 0.03 && at.y > 1.85)) {
				albedo = vec3f(0.16, 0.09, 0.05);					// the bridle: the noseband and the headpiece
			}
		} else if (part == 13) {
			albedo = vec3f(0.33, 0.18, 0.08);						// the saddle's leather
			shine = 0.25;
			if (at.y < 1.0) {
				albedo = vec3f(0.55, 0.56, 0.58);					// the stirrup irons
				shine = 0.7;
			}
		} else if (part == 17) {
			albedo = vec3f(0.45, 0.07, 0.06);						// the blanket
		} else if (part == 14) {
			albedo = vec3f(0.27, 0.15, 0.07);						// the saddlebags
			shine = 0.2;
		} else if (part == 16) {
			albedo = vec3f(0.2, 0.11, 0.05);						// the reins
		} else if (part == 0 && at.y < 1.0 && abs(at.z - 0.35) < 0.05) {
			albedo = vec3f(0.2, 0.11, 0.05);						// the girth
		}

		// the same light as everything else
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.09 + daylight * (0.34 + 0.72 * saturate(dot(N, L)));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		let V = normalize(-toHorse);
		let gloss = pow(saturate(dot(N, normalize(L + V))), 24.0) * (0.12 + shine) * daylight;
		var color = albedo * (light * sunTint + moonLight(N)) + vec3f(gloss);

		// what the crosshair is on
		if (input.coat.y > 0.5) {
			color = mix(color, vec3f(1.0, 0.85, 0.35), 0.35 + 0.2 * sin(HU.cameraPosition.w * 6.0));
		}

		if (HU.look.y > 0.5) {
			let horizonColor = fogColorAt(toHorse);
			let fog = 1.0 - exp(-pow(away / HU.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, 1.0);
	}
`;
