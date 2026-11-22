import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';
import { DEER_KINDS, EAR_FOOT, TAIL_FOOT, ANTLER_FOOT } from '../../code/deerKinds.js';

const kindArray = (f) => `array<f32, ${DEER_KINDS.length}>(${DEER_KINDS.map((K) => f(K).toFixed(3)).join(', ')})`;

/*
	The deer drawn. See deer.js for the deer itself (under 400 triangles, in metres) and how they live.

	One mesh, drawn once for every deer (instancing). What moves is done here, from each vertex's part (shape.w):
		0		the body, the tail
		1		the neck and the head: swung down about the foot of the neck by how far the deer has its head down (grazing,
				drinking), 0 up to 1 at the ground
		2 to 5	the legs: left front, right front, left hind, right hind. Each swings from the hip with the walk, and the lower
				leg bends back at the knee as it comes forward. The four take turns (a walk: hind, front, other hind, other front)
	(parts 6 on are the antlers, each kind's its own: with the head. Only the deer's kind's drawn, and only on one with antlers; on any other,
	a female or one whose antlers have been cut off, nothing. A caribou cow's smaller. See deerKinds.js: OWN, state.x here.)
	THE KINDS (deerKinds.js): each its ears (part 1.25) and its tail (part 0.25) drawn bigger or smaller, about where they grow from, and
	its own coat (THE COATS). Its size is in place.w already.
	Then the whole deer is tipped to the slope it stands on, turned to its heading, made its size and put in its place.
	The light comes from the faces as they are after all that (dpdx, dpdy), as for the geese.

	FERAL (state.w): the deer of the horde (horde.js) are darker and greyer, mangy (bare patches of skin), with eyes that glow red,
	brighter while they are in a frenzy (2).
*/
export const vf_deer =
`
	struct DeerUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz
		look : vec4f,				// x: horizon fog distance, y: 1.0 if the atmosphere is on
	}
	@group(0) @binding(0) var<uniform> DU: DeerUniforms;

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
		@location(0) shape: vec4f,		// xyz: the mesh, in metres, standing on y = 0 and heading along +z. w: which part (see the top of the file)
		@location(1) place: vec4f,		// this deer: xyz where its feet are, w: world units to the metre (its size)
		@location(2) pose: vec4f,		// x: its heading (radians, round from +z towards +x), y: where it is in its stride (radians), z: head down, 0 to 1, w: how far it leans its stride (0 standing to 1 walking)
		@location(3) state: vec4f,		// x: a number of its own, y: the slope under it along its heading (radians, nose up), z: rolled over on to its side (radians: a shot deer), w: feral (see FERAL)
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) onDeer: vec4f,		// xyz: where on the mesh as it was made, w: the part
		@location(2) @interpolate(flat) tone: f32,
		@location(3) @interpolate(flat) feral: f32,
		@location(4) @interpolate(flat) kind: f32,
	};

	fn turnX(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x, v.y * cos(angle) - v.z * sin(angle), v.y * sin(angle) + v.z * cos(angle)); }
	fn turnY(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) + v.z * sin(angle), v.y, v.z * cos(angle) - v.x * sin(angle)); }
	fn turnZ(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) - v.y * sin(angle), v.x * sin(angle) + v.y * cos(angle), v.z); }

	const NECK_FOOT: vec3f = vec3f(0.0, 1.08, 0.45);
	const HIP_Y: f32 = 0.88;
	const KNEE_Y: f32 = 0.45;
	const FRONT_HIP_Z: f32 = 0.4;
	const HIND_HIP_Z: f32 = -0.45;
	const EAR_FOOT: vec3f = vec3f(${EAR_FOOT.join(', ')});
	const TAIL_FOOT: vec3f = vec3f(${TAIL_FOOT.join(', ')});
	const ANTLER_FOOT: vec3f = vec3f(${ANTLER_FOOT.join(', ')});

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		var p = input.shape.xyz;
		let part = input.shape.w;
		// its kind and its antlers (deerKinds.js: OWN)
		let kind = clamp(i32(floor(input.state.x / 4.0)), 0, ${DEER_KINDS.length - 1});
		let antlers = i32(floor(input.state.x)) % 4;
		var EARS = ${kindArray((K) => K.ears)};
		var TAILS = ${kindArray((K) => K.tail)};
		var ANTLERS = ${kindArray((K) => K.antlers)};

		if (part > 5.5) {
			let shown = abs(part - ANTLERS[kind]) < 0.5 && (antlers == 1 || antlers == 3);
			if (antlers == 3) {
				let foot = vec3f(ANTLER_FOOT.x * sign(p.x), ANTLER_FOOT.yz);
				p = foot + (p - foot) * 0.55;			// (a caribou cow's)
			}
			p = select(NECK_FOOT, NECK_FOOT + turnX(p - NECK_FOOT, 1.25 * input.pose.z), shown);
		} else if (part > 1.5) {
			// a leg: its turn in the walk, its swing from the hip, and the knee bending as it comes forward
			let leg = i32(part + 0.5) - 2;
			let turnIn = select(select(0.5, 0.0, leg == 2), select(0.75, 0.25, leg == 0), leg < 2);	// left front, right front, left hind, right hind
			let phase = input.pose.y + turnIn * 6.2831853;
			let walking = input.pose.w;
			let hip = vec3f(0.0, HIP_Y, select(HIND_HIP_Z, FRONT_HIP_Z, leg < 2));
			if (p.y < KNEE_Y - 0.01) {
				let knee = vec3f(p.x, KNEE_Y, hip.z);
				let bend = max(sin(phase), 0.0) * 0.7 * walking * select(1.0, -1.0, leg < 2);	// (front knees bend back, hind hocks forward)
				p = knee + turnX(p - knee, bend);
			}
			let swing = cos(phase) * 0.42 * walking;
			p = hip + turnX(p - hip, swing);
		} else if (part > 0.5) {
			// the neck and the head, down to the grass or the water. The ears its kind's size
			if (part > 1.1) {
				let foot = vec3f(EAR_FOOT.x * sign(p.x), EAR_FOOT.yz);
				p = foot + (p - foot) * EARS[kind];
			}
			p = NECK_FOOT + turnX(p - NECK_FOOT, 1.25 * input.pose.z);
		} else if (part > 0.1) {
			p = TAIL_FOOT + (p - TAIL_FOOT) * TAILS[kind];		// the tail
		}

		// a shot deer over on its side, about its feet, and up by the half width of it so it lies on the ground and not in it
		let rolled = turnZ(p, input.state.z) + vec3f(0.0, 0.2 * abs(sin(input.state.z)), 0.0);
		let tipped = turnX(rolled, -input.state.y);
		let position = input.place.xyz + turnY(tipped, input.pose.x) * input.place.w;

		var output: VertexOutput;
		output.pos = DU.viewProjectionMatrix * vec4f(position, 1.0);
		output.worldPos = position;
		output.onDeer = vec4f(input.shape.xyz, part);
		output.tone = fract(input.state.x);
		output.feral = input.state.w;
		output.kind = f32(kind);
		return output;
	}

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;	// see f_water

	${skyLookupShapes}

	${moonShapes}

	struct FragInput {
		@location(0) worldPos: vec3f,
		@location(1) onDeer: vec4f,
		@location(2) @interpolate(flat) tone: f32,
		@location(3) @interpolate(flat) feral: f32,
		@location(4) @interpolate(flat) kind: f32,
	};

	// THE COATS, each kind's (deerKinds.js's order): its coat, its belly, its rump, its neck, its legs low down. Then what more marks it
	//		(fragmentMain). x of each the coat's red, y its green, z its blue
	fn coatOf(kind: i32, which: i32) -> vec3f {
		var C = array<vec3f, ${DEER_KINDS.length * 5}>(
			vec3f(0.42, 0.28, 0.17), vec3f(0.66, 0.58, 0.48), vec3f(0.86, 0.83, 0.78), vec3f(0.42, 0.29, 0.18), vec3f(0.12, 0.09, 0.07),		// white-tailed: red brown
			vec3f(0.36, 0.31, 0.26), vec3f(0.62, 0.58, 0.52), vec3f(0.88, 0.86, 0.82), vec3f(0.4, 0.36, 0.31), vec3f(0.16, 0.13, 0.1),		// mule: grey brown, a big white rump
			vec3f(0.3, 0.21, 0.14), vec3f(0.55, 0.47, 0.38), vec3f(0.82, 0.79, 0.74), vec3f(0.29, 0.21, 0.14), vec3f(0.1, 0.08, 0.06),		// black-tailed: darker
			vec3f(0.5, 0.29, 0.14), vec3f(0.8, 0.74, 0.62), vec3f(0.9, 0.88, 0.84), vec3f(0.48, 0.29, 0.15), vec3f(0.2, 0.13, 0.08),		// fallow: rufous, spotted white
			vec3f(0.52, 0.26, 0.12), vec3f(0.6, 0.45, 0.32), vec3f(0.9, 0.88, 0.84), vec3f(0.48, 0.27, 0.14), vec3f(0.14, 0.1, 0.07),		// roe: fox red, a white rump
			vec3f(0.56, 0.42, 0.27), vec3f(0.3, 0.2, 0.12), vec3f(0.8, 0.68, 0.46), vec3f(0.2, 0.13, 0.08), vec3f(0.13, 0.09, 0.06),		// elk: tan, dark mane and legs, buff rump
			vec3f(0.4, 0.35, 0.3), vec3f(0.84, 0.82, 0.77), vec3f(0.88, 0.86, 0.82), vec3f(0.82, 0.8, 0.74), vec3f(0.17, 0.13, 0.1),		// caribou: grey brown, a white mane
		);
		return C[kind * 5 + which];
	}

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let toDeer = input.worldPos - Lights.camPos.xyz;
		let away = length(toDeer);
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		if (dot(N, toDeer) > 0.0) {
			N = -N;
		}

		// its kind's colors (THE COATS): paler underneath, its rump, its tail, the legs darker towards the hooves, a dark nose
		let at = input.onDeer.xyz;
		let part = input.onDeer.w;
		let kind = i32(input.kind + 0.5);
		let tone = mix(0.85, 1.12, input.tone);
		let coat = coatOf(kind, 0) * tone;
		let belly = coatOf(kind, 1) * tone;
		let rump = coatOf(kind, 2);
		let neck = coatOf(kind, 3) * tone;
		let low = coatOf(kind, 4);
		var albedo = coat;
		// (where the rump patch starts, by kind: a mule deer's and an elk's the biggest)
		var RUMP_Z = array<f32, ${DEER_KINDS.length}>(-0.62, -0.5, -0.6, -0.58, -0.56, -0.52, -0.6);
		let rumpZ = RUMP_Z[kind];
		if (part > 5.5) {
			albedo = select(vec3f(0.5, 0.42, 0.3), vec3f(0.62, 0.55, 0.44), kind >= 5);		// the antlers
		} else if (part > 1.5) {
			// the legs: an elk's dark all the way, a caribou's with a white band over the hooves
			let upper = select(coat, neck, kind == 5);
			albedo = mix(low, upper, smoothstep(0.08, 0.5, at.y) * select(1.0, 0.35, kind == 5));
			if (kind == 6 && at.y > 0.045 && at.y < 0.12) {
				albedo = vec3f(0.84, 0.82, 0.78);
			}
		} else if (part > 0.5) {
			// the neck and the head: the neck its kind's (an elk's mane, a caribou's white one underneath), a pale throat and muzzle, a dark nose
			let onNeck = 1.0 - smoothstep(0.6, 0.66, at.z) * smoothstep(1.38, 1.44, at.y);
			let under = smoothstep(0.02, -0.04, at.y - (1.1 + (at.z - 0.46) * 1.44));		// (the underside of the neck)
			albedo = mix(coat, neck, onNeck * select(1.0, under, kind == 6));
			if (kind == 5) {
				albedo = mix(albedo, neck * 1.1, 1.0 - onNeck);		// (an elk's head as dark as its mane)
			}
			if (at.z > 0.84 && at.y < 1.43) {
				albedo = mix(albedo, vec3f(0.84, 0.81, 0.76), select(0.5, 0.85, kind == 1 || kind == 2));		// the muzzle, white on a mule deer
			}
			if (kind == 1 && at.z > 0.66 && at.z < 0.8 && at.y > 1.49) {
				albedo = vec3f(0.2, 0.16, 0.13);			// a mule deer's dark forehead
			}
			if (at.z > 0.88) {
				albedo = vec3f(0.08, 0.07, 0.06);			// the nose
			}
			if (part > 1.1 && kind != 5) {
				albedo = mix(albedo, vec3f(0.2, 0.17, 0.14), smoothstep(0.1, 0.17, abs(at.x)) * 0.6);	// the ears' dark rims
			}
		} else if (part > 0.1) {
			// the tail: white under it; on top a white-tailed deer's brown, a mule deer's white with a black tip, a black-tailed deer's black,
			//		a fallow deer's black down the middle, an elk's buff, a caribou's white
			let t = saturate((-0.66 - at.z) / 0.09);
			let top = at.y > 1.06 - 0.13 * t;
			var tail = rump;
			if (top) {
				tail = select(select(select(coat, vec3f(0.06, 0.05, 0.05), kind == 2 || kind == 3), rump, kind == 1 || kind >= 4), coat, kind == 0);
			}
			if (kind == 1 && t > 0.55) {
				tail = vec3f(0.06, 0.05, 0.05);
			}
			albedo = tail;
		} else if (at.z < rumpZ && (kind != 0 || at.y < 1.02)) {
			albedo = rump;									// the rump (a white-tailed deer's only white under its tail)
			if (kind == 3 && at.z > rumpZ - 0.04) {
				albedo = vec3f(0.07, 0.06, 0.05);			// a fallow deer's black edge round it
			}
		} else if (at.y < 0.76 - 0.1 * smoothstep(0.1, 0.45, at.z)) {
			albedo = belly;									// the belly (an elk's dark)
		} else if (kind == 3 && at.y > 0.82 && at.y < 1.13 && at.z > -0.55 && at.z < 0.42) {
			// a fallow deer's spots: rows along its flanks, and a pale line low down along them
			let cell = vec2f(at.z, at.y) / 0.055 + vec2f(select(0.0, 0.5, at.x > 0.0), 0.0);
			let k = floor(cell);
			let middle = k + 0.5 + 0.3 * (vec2f(fract(sin(dot(k, vec2f(12.9, 78.2))) * 43758.5), fract(sin(dot(k, vec2f(39.3, 11.1))) * 24634.6)) - 0.5);
			albedo = mix(albedo, vec3f(0.9, 0.87, 0.8), 1.0 - smoothstep(0.17, 0.26, length(cell - middle)));
		} else if (kind == 5) {
			albedo = mix(neck, coat, smoothstep(0.42, 0.28, at.z) * smoothstep(0.7, 0.8, at.y));	// an elk's dark mane down over its chest
		}
		if (kind == 3 && part < 0.1 && abs(at.y - 0.79) < 0.018 && at.z > -0.5 && at.z < 0.3) {
			albedo = vec3f(0.86, 0.82, 0.74);
		}
		// feral: the coat gone dark and grey, worn through to the skin in patches
		var eyes = 0.0;
		if (input.feral > 0.5) {
			albedo = mix(albedo, vec3f(0.17, 0.15, 0.13) * tone, 0.75);
			let mange = sin(at.x * 41.0 + input.tone * 17.0) * sin(at.y * 23.0 + 1.7) * sin(at.z * 31.0 + input.tone * 5.0);
			albedo = mix(albedo, vec3f(0.42, 0.3, 0.28), smoothstep(0.35, 0.5, mange) * 0.8);
			if (input.onDeer.w > 0.5 && input.onDeer.w < 1.5) {
				let eye = min(length(at - vec3f(0.04, 1.455, 0.77)), length(at - vec3f(-0.04, 1.452, 0.77)));
				eyes = (1.0 - smoothstep(0.012, 0.028, eye)) * select(1.2, 3.0, input.feral > 1.5);
			}
		}

		// the same light as everything else
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.09 + daylight * (0.34 + 0.72 * saturate(dot(N, L)));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		var color = albedo * (light * sunTint + moonLight(N)) + vec3f(1.0, 0.1, 0.03) * eyes;

		if (DU.look.y > 0.5) {
			let horizonColor = fogColorAt(toDeer);
			let fog = 1.0 - exp(-pow(away / DU.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, 1.0);
	}
`;
