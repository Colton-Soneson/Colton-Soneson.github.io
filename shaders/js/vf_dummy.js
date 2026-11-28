import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';
import { legIK } from './legIK.js';

/*
	The other players drawn, as crash test dummies (players.js: the mesh, 90 triangles in metres, and the rifle they carry, 12).

	One mesh, drawn once for every player (instancing). What moves is done here, from each vertex's part (shape.w):
		0			the pelvis, with the player's own colour round it (a belt)
		1			the chest
		2			the neck and the head: tipped up and down with where the player looks (pitch), about the neck
		3, 4		the left upper arm and forearm		with the rifle, tipped with the look about the shoulders: the rifle
		5, 6		the right upper arm and forearm		is held where the player is looking
		7, 8		the left thigh and shin				laid by inverse kinematics (legIK.js) to reach the foot where it is in
		9, 10		the right thigh and shin			its step, the knee bending forward only (THE LEGS)
		11			the rifle
		12 and up	a hat (the townsfolk's, townFolk.js): HAT_COLOURS[part - 12], tipped with the head
	THE CLOTHES (outfits.js: the Survival mode's, on the players and the NPCs) are drawn with this too (vf_dummyClothes: each instance's
	colour as well, cloth): a vertex's w is its part (moved as the dummy's is) and 32 times its TONE, what it is coloured:
		1 the colour		2 the colour darker (a trim)	3 leather			4 steel			5 brass
		6 cream (linen)		7 fur, of the colour			8 checked, of the colour (flannel, a mackinaw)		9 a sole, black
	Sitting (state.w, 0 to 1: at a dinghy's helm), the thighs come up level and the shins hang down from the knees, and it is let
	down so its hips are on its place (the seat). Astride a horse (state.w from 1 to 2) the legs go apart round the saddle as well.
	One that holds nothing (held.y: the townsfolk) has its arms down at its sides, swinging against its legs as it walks.
	THE GESTURES (the townsfolk's greetings, townFolk.js): one that holds nothing (held.x no more than 0) can wave or shake hands with
	its right arm (parts 3 and 4, at -x: the dummy faces +z, +x its left): held.y's whole part says which (1 neither, 2 a wave, 3 a
	handshake), its fraction where it is in the wave or the pump (0 to 1 round), and -held.x how far the arm is up for it (0 down at
	its side, 1 all the way): the arm's two bones turned from hanging to the gesture's, by that much. 4 drinking (a tavern's patrons,
	taverns.js): sitting at a table, the hand resting on it (DRINK_REST), and by -held.x lifted to the mouth (DRINK_UP), the tankard in it
	(taverns.js works out where the hand is, the same sums, to put it there).
	Crouched (held.w, 0 to 1: a player's C, hunting.js), the hips come down CROUCH_DROP, the feet stay on the ground (so the knees come
	forward over them) and the body leans forward over its knees.
	THE LEGS: each foot's place first (its step: STEP_PACE steps to each the walker counts as a stride, STEP_HALF either way of the hip,
	on the ground going back as fast as the walker goes on, lifted STEP_LIFT coming forward; on the ground crouched; out in front sitting),
	then the thigh and the shin laid to reach it (legIK.js), within the knee's and the hip's restrictions (KNEE_FLEX, HIP_SWING). Walking,
	the whole dummy comes down a little (legDrop), so that the feet reach the ground at either end of the step.
	Then the whole dummy is tipped (tilt: forward, and rolled, as the cockpit or the deck it is on is: npcs.js) and turned to its
	heading, made its size and put in its place. A dead one has gone over on to its back,
	about its feet. A hit one flashes red for a moment.
	The colours are a crash test dummy's: yellow, the joints black, and the black and yellow quartered circles on the sides of
	the head and on the chest.
*/
// the hats' colours, by name: a hat's part is 12 and the colour's place in this list
export const HAT_COLOURS = {
	white: [0.93, 0.92, 0.88], black: [0.05, 0.05, 0.06], oilskin: [0.95, 0.74, 0.08], straw: [0.84, 0.71, 0.42], red: [0.68, 0.09, 0.07],
	gold: [0.86, 0.66, 0.2], navy: [0.09, 0.13, 0.27], blue: [0.12, 0.2, 0.38], tweed: [0.4, 0.34, 0.26], crimson: [0.55, 0.06, 0.14],
	brown: [0.33, 0.2, 0.1], grey: [0.45, 0.45, 0.47], green: [0.17, 0.33, 0.16],
};
export const HAT_PART = Object.fromEntries(Object.keys(HAT_COLOURS).map((name, k) => [name, 12 + k]));
const hatColours = Object.values(HAT_COLOURS).map(([r, g, b]) => `vec3f(${r}, ${g}, ${b})`).join(', ');

const dummyShader = (clothes) =>
`
	struct DummyUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz
		look : vec4f,				// x: horizon fog distance, y: 1.0 if the atmosphere is on
	}
	@group(0) @binding(0) var<uniform> DU: DummyUniforms;

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
	// THE RAGDOLL (code/ragdolls.js, ragBuffer.js): one shot is drawn from its ragdoll's limbs, each part its own matrix (3 rows, the
	//		translation in w) from the mesh as it was made to the world. tilt.w says which ragdoll (0: none, drawn as itself)
	struct RagPart { r0: vec4f, r1: vec4f, r2: vec4f, }
	@group(0) @binding(4) var<storage, read> RAGS: array<RagPart>;

	struct VertexInput {
		@location(0) shape: vec4f,		// xyz: the mesh, in metres, standing on y = 0 and facing +z. w: which part (see the top of the file)
		@location(1) place: vec4f,		// this player: xyz where its feet are, w: world units to the metre
		@location(2) pose: vec4f,		// x: heading (radians, round from +z towards +x), y: pitch (radians, up), z: where it is in its stride (radians), w: walking, 0 to 1
		@location(3) state: vec4f,		// x: gone over, 0 standing to 1 flat on its back, y: hit, 1 just hit fading to 0, z: its colour (0 to 1 round the hues), w: sitting (0 to 1), astride (1 to 2)
		@location(4) held: vec4f,		// x: how long what it holds is, the rifle it was made with 1 (0: nothing in its hands), y: 1 arms down at its sides, z: its head turned (radians, as heading), w: crouched, 0 to 1
		@location(5) tilt: vec4f,		// x: tipped about its own x (radians: + its front down), y: rolled about its own z (radians), before it is turned to its heading,
										//		z: in the war, 1 the other side (bright red) or 2 this one's (bright blue), w: its ragdoll's number and 1 (THE RAGDOLL), 0 none
		${clothes ? '@location(6) cloth: vec4f,		// the clothes: rgb the colour of what is drawn' : ''}
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) onDummy: vec4f,		// xyz: where on the mesh as it was made, w: the part
		@location(2) @interpolate(flat) state: vec4f,
		@location(3) @interpolate(flat) side: f32,
		@location(4) @interpolate(flat) cloth: vec4f,
	};

	fn turnX(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x, v.y * cos(angle) - v.z * sin(angle), v.y * sin(angle) + v.z * cos(angle)); }
	fn turnY(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) + v.z * sin(angle), v.y, v.z * cos(angle) - v.x * sin(angle)); }
	fn turnZ(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) - v.y * sin(angle), v.x * sin(angle) + v.y * cos(angle), v.z); }

	var<private> HAT_COLOURS: array<vec3f, ${Object.keys(HAT_COLOURS).length}> = array<vec3f, ${Object.keys(HAT_COLOURS).length}>(${hatColours});

	// v turned the way that takes the direction was to the direction now (both of length 1)
	fn turnTo(v: vec3f, was: vec3f, now: vec3f) -> vec3f {
		let axis = cross(was, now);
		let s = length(axis);
		if (s < 1e-5) {
			return v;
		}
		let k = axis / s;
		let c = dot(was, now);
		return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
	}
	// an arm (part 3 to 6) as it was made, holding the rifle, let down to hang at its side, swung forward by swing (back if less than
	//		0): the upper arm turned about the shoulder, the forearm about the elbow and taken to where the elbow now is
	fn hangArm(p: vec3f, part: i32, swing: f32) -> vec3f {
		let out = select(1.0, -1.0, part <= 4);
		return armTo(p, part, normalize(vec3f(0.07 * out, -1.0, swing)), normalize(vec3f(0.02 * out, -1.0, swing * 1.4 + 0.18)));
	}
	// an arm (part 3 to 6) as it was made, its upper arm turned to point along upper from the shoulder, and its forearm along fore from
	//		where the elbow now is
	fn armTo(p: vec3f, part: i32, upper: vec3f, fore: vec3f) -> vec3f {
		let left = part <= 4;
		let shoulder = select(vec3f(0.22, 1.45, 0.0), vec3f(-0.22, 1.45, 0.0), left);
		let elbow = select(vec3f(0.22, 1.2, 0.1), vec3f(-0.2, 1.24, 0.24), left);
		let hand = select(vec3f(0.07, 1.29, 0.24), vec3f(-0.03, 1.31, 0.5), left);
		if (part == 3 || part == 5) {
			return shoulder + turnTo(p - shoulder, normalize(elbow - shoulder), upper);
		}
		let elbowNow = shoulder + upper * length(elbow - shoulder);
		return elbowNow + turnTo(p - elbow, normalize(hand - elbow), fore);
	}

	// drinking (THE GESTURES): the upper arm's way and the forearm's, the hand on the table, and the tankard at the mouth
	const DRINK_REST: array<vec3f, 2> = array<vec3f, 2>(vec3f(0.1864, -0.5592, 0.8078), vec3f(0.0995, -0.0298, 0.9946));
	const DRINK_UP: array<vec3f, 2> = array<vec3f, 2>(vec3f(0.3928, -0.3143, 0.8642), vec3f(0.3164, 0.8416, -0.4376));
	// the right arm (parts 3 and 4) put up for a gesture (THE GESTURES: 2 a wave, 3 a handshake), up by amount from how it hangs
	//		(swing: hangArm's), round at phase (radians): waved side to side up by the head, or held out to the middle in front and pumped
	fn gestureArm(p: vec3f, part: i32, gesture: f32, amount: f32, phase: f32, swing: f32) -> vec3f {
		let upperDown = normalize(vec3f(-0.07, -1.0, swing));
		let foreDown = normalize(vec3f(-0.02, -1.0, swing * 1.4 + 0.18));
		let wave = 0.55 * sin(phase);
		var upper = normalize(vec3f(-0.5, 0.55, 0.22));
		var fore = normalize(vec3f(-0.1 + sin(wave), cos(wave), 0.18));
		if (gesture > 3.5) {
			return armTo(p, part, normalize(mix(DRINK_REST[0], DRINK_UP[0], amount)), normalize(mix(DRINK_REST[1], DRINK_UP[1], amount)));
		}
		if (gesture > 2.5) {
			upper = normalize(vec3f(0.3, -0.55, 0.55));
			fore = normalize(vec3f(0.25, 0.05 + 0.18 * sin(phase), 1.0));
		}
		return armTo(p, part, normalize(mix(upperDown, upper, amount)), normalize(mix(foreDown, fore, amount)));
	}

	const NECK: vec3f = vec3f(0.0, 1.55, 0.0);
	const SHOULDERS: vec3f = vec3f(0.0, 1.45, 0.0);
	const HIP_Y: f32 = 0.95;
	const KNEE_Y: f32 = 0.5;
	const CROUCH_DROP: f32 = 0.44;
	// THE LEGS (see the top): steps to a stride, metres either way, metres up; radians the knee bends (only forward), the thigh swings
	const STEP_PACE: f32 = 1.8;
	const STEP_HALF: f32 = 0.38;
	const STEP_LIFT: f32 = 0.13;
	const KNEE_FLEX: vec2f = vec2f(0.03, 2.5);
	const HIP_SWING: vec2f = vec2f(-0.75, 1.75);
	const SIT_FOOT: vec2f = vec2f(0.396, 0.447);		// (y, z: the shin hanging from a knee out in front, the thigh level)
	${legIK}

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		var p = input.shape.xyz;
		let part = i32(input.shape.w + 0.5) % 32;
		let pitch = input.pose.y;
		let sit = min(input.state.w, 1.0);
		let crouch = input.held.w * (1.0 - sit);
		let astride = clamp(input.state.w - 1.0, 0.0, 1.0);
		let walking = input.pose.w * (1.0 - sit);
		let half = STEP_HALF * walking * (1.0 - 0.5 * crouch);
		let walkDrop = legDrop(HIP_Y, half, 0.02 * walking);

		if (part == 11) {
			// what it holds: the long box made 1.1 metres along z from the right shoulder, as long as the gun is (nothing at 0)
			p.z = -0.05 + (p.z + 0.05) * input.held.x;
			p = select(p, vec3f(0.0, 1.3, 0.0), input.held.x < 0.01);
		}
		if (part == 2 || part >= 12) {
			p = NECK + turnY(turnX(p - NECK, -0.6 * pitch), input.held.z);
		} else if (part >= 3 && part <= 6 && input.held.y > 0.5) {
			// (nothing in its hands: arms down, each swinging against the leg on its side)
			let swing = cos(input.pose.z * STEP_PACE) * 0.4 * input.pose.w * select(1.0, -1.0, part <= 4);
			let gesture = floor(input.held.y);
			if (gesture >= 2.0 && part <= 4) {
				p = gestureArm(p, part, gesture, clamp(-input.held.x, 0.0, 1.0), fract(input.held.y) * 6.2831853, swing);
			} else {
				p = hangArm(p, part, swing);
			}
		} else if ((part >= 3 && part <= 6) || part == 11) {
			p = SHOULDERS + turnX(p - SHOULDERS, -pitch);
		} else if (part >= 7 && part <= 10) {
			// a leg (THE LEGS): the left and the right half a step apart; the foot on the ground under the hips come down (walking,
			//		crouched), or out in front sitting; the thigh and the shin laid to reach it
			let left = part <= 8;
			let phase = input.pose.z * STEP_PACE + select(3.14159265, 0.0, left);
			let hip = vec3f(select(-0.1, 0.1, left), HIP_Y, 0.0);
			let foot = mix(legStep(vec2f(walkDrop + CROUCH_DROP * crouch, 0.0), phase, half, STEP_LIFT * walking), SIT_FOOT, sit);
			let bones = legReach(hip.yz, HIP_Y - KNEE_Y, KNEE_Y, foot, 1.0, KNEE_FLEX, HIP_SWING);
			p = legMove(p, vec3f(p.x, HIP_Y, 0.0), KNEE_Y, part == 7 || part == 9, bones);
			p = hip + turnZ(p - hip, select(-0.45, 0.45, left) * astride);
		}
		// crouched: everything above the legs leaning forward over them, and all of it down
		if (part < 7 || part > 10) {
			p = vec3f(0.0, HIP_Y, 0.0) + turnX(p - vec3f(0.0, HIP_Y, 0.0), 0.35 * crouch);
		}
		p.y -= CROUCH_DROP * crouch + walkDrop;
		// sitting: down on to the seat
		p.y -= (HIP_Y - 0.05) * sit;

		// a dead one goes over on to its back, about its heels
		let over = input.state.x * 1.5;
		let fallen = turnX(p, -over) + vec3f(0.0, 0.12 * sin(over), 0.0);
		var position = input.place.xyz + turnY(turnX(turnZ(fallen, input.tilt.y), input.tilt.x), input.pose.x) * input.place.w;
		// THE RAGDOLL: each part where its ragdoll's limb is (a hat with the head, what it held folded into the chest)
		if (input.tilt.w > 0.5) {
			var q = input.shape.xyz;
			var limb = u32(part);
			if (part >= 12) { limb = 2u; }
			if (part == 11) { q = vec3f(0.0, 1.3, 0.0); limb = 1u; }
			let R = RAGS[(u32(input.tilt.w + 0.5) - 1u) * 12u + limb];
			let h = vec4f(q, 1.0);
			position = vec3f(dot(R.r0, h), dot(R.r1, h), dot(R.r2, h));
		}

		var output: VertexOutput;
		output.pos = DU.viewProjectionMatrix * vec4f(position, 1.0);
		output.worldPos = position;
		output.onDummy = input.shape;
		output.state = input.state;
		output.side = input.tilt.z;
		output.cloth = ${clothes ? 'input.cloth' : 'vec4f(0.0)'};
		return output;
	}

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;	// see f_water

	${skyLookupShapes}

	${moonShapes}

	// a hue (0 to 1) as a colour
	fn hueColor(h: f32) -> vec3f {
		return saturate(abs(fract(vec3f(h) + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0);
	}

	// black and yellow quarters in a circle round (a, b) on a face, 1 where black
	fn quartered(u: f32, v: f32, radius: f32) -> f32 {
		if (u * u + v * v > radius * radius) {
			return 0.0;
		}
		return select(0.0, 1.0, u * v > 0.0);
	}

	struct FragInput {
		@location(0) worldPos: vec3f,
		@location(1) onDummy: vec4f,
		@location(2) @interpolate(flat) state: vec4f,
		@location(3) @interpolate(flat) side: f32,
		@location(4) @interpolate(flat) cloth: vec4f,
	};

	// the clothes (see the top): the tone's colour, at a place on the dummy as it was made
	fn clothColour(tone: i32, colour: vec3f, at: vec3f) -> vec3f {
		switch (tone) {
			case 2: { return colour * 0.55; }
			case 3: { return vec3f(0.28, 0.17, 0.09); }
			case 4: { return vec3f(0.52, 0.54, 0.57); }
			case 5: { return vec3f(0.62, 0.48, 0.2); }
			case 6: { return vec3f(0.82, 0.77, 0.66); }
			case 7: { return colour * (0.75 + 0.35 * fract(sin(dot(floor(at * 140.0), vec3f(12.9898, 78.233, 37.719))) * 43758.5453)); }
			case 8: {
				let check = step(0.5, fract(at.x * 9.0 + at.z * 9.0)) + step(0.5, fract(at.y * 9.0));
				let line = step(0.92, fract(at.y * 9.0 + 0.25)) + step(0.92, fract((at.x + at.z) * 9.0 + 0.25));
				return mix(colour * mix(1.0, 0.45, check * 0.5), vec3f(0.07), saturate(line) * 0.6);
			}
			case 9: { return vec3f(0.07, 0.06, 0.05); }
			default: { return colour; }
		}
	}

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let toDummy = input.worldPos - Lights.camPos.xyz;
		let away = length(toDummy);
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		if (dot(N, toDummy) > 0.0) {
			N = -N;
		}

		let at = input.onDummy.xyz;
		let code = i32(input.onDummy.w + 0.5);
		let part = code % 32;
		let tone = code / 32;
		let sideColour = select(vec3f(0.95, 0.1, 0.07), vec3f(0.12, 0.38, 1.0), input.side > 1.5);
		let yellow = select(vec3f(0.86, 0.66, 0.08), sideColour, input.side > 0.5);
		let black = vec3f(0.035, 0.035, 0.04);
		var albedo = yellow;
		if (part >= 12) {
			albedo = HAT_COLOURS[min(part - 12, ${Object.keys(HAT_COLOURS).length - 1})];		// a hat
		} else if (part == 0) {
			albedo = mix(yellow, hueColor(input.state.z) * 0.8, step(0.96, at.y));		// the belt
		} else if (part == 4 || part == 6 || part == 8 || part == 10) {
			albedo = mix(black, yellow, smoothstep(0.0, 0.02, abs(at.y - select(1.3, 0.5, part >= 8)) - 0.05));	// the elbows and the knees
		} else if (part == 11) {
			albedo = vec3f(0.2, 0.12, 0.06);
		} else if (part == 2) {
			if (at.y < 1.6) {
				albedo = black;		// the neck
			} else if (abs(at.x) > 0.095) {
				albedo = mix(yellow, black, quartered(at.z - 0.01, at.y - 1.71, 0.065));		// the sides of the head
			}
		} else if (part == 1 && at.z > 0.105) {
			albedo = mix(yellow, black, quartered(at.x - 0.08, at.y - 1.36, 0.06));			// the chest
		}
		if (tone > 0) {
			albedo = clothColour(tone, input.cloth.rgb, at);
			if (input.side > 0.5) { albedo = mix(albedo, sideColour, 0.55); }		// (in the war: which side, over the clothes too)
		}

		// the same light as everything else
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.09 + daylight * (0.34 + 0.72 * saturate(dot(N, L)));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		var color = albedo * (light * sunTint + moonLight(N));
		color = mix(color, vec3f(0.9, 0.05, 0.03), 0.7 * input.state.y);
		if (input.side > 0.5) { color += sideColour * 0.22; }		// (bright: seen from far off)

		if (DU.look.y > 0.5) {
			let horizonColor = fogColorAt(toDummy);
			let fog = 1.0 - exp(-pow(away / DU.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, 1.0);
	}
`;
export const vf_dummy = dummyShader(false);
export const vf_dummyClothes = dummyShader(true);
