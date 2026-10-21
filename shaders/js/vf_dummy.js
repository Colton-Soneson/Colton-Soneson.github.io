import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';

/*
	The other players drawn, as crash test dummies (players.js: the mesh, 90 triangles in metres, and the rifle they carry, 12).

	One mesh, drawn once for every player (instancing). What moves is done here, from each vertex's part (shape.w):
		0			the pelvis, with the player's own colour round it (a belt)
		1			the chest
		2			the neck and the head: tipped up and down with where the player looks (pitch), about the neck
		3, 4		the left upper arm and forearm		with the rifle, tipped with the look about the shoulders: the rifle
		5, 6		the right upper arm and forearm		is held where the player is looking
		7, 8		the left thigh and shin				swing from the hip with the walk, the shin bending back at the knee as
		9, 10		the right thigh and shin			the leg comes forward
		11			the rifle
		12 and up	a hat (the townsfolk's, townFolk.js): HAT_COLOURS[part - 12], tipped with the head
	Sitting (state.w, 0 to 1: at a dinghy's helm), the thighs come up level and the shins hang down from the knees, and it is let
	down so its hips are on its place (the seat). Astride a horse (state.w from 1 to 2) the legs go apart round the saddle as well.
	One that holds nothing (held.y: the townsfolk) has its arms down at its sides, swinging against its legs as it walks.
	Then the whole dummy is turned to its heading, made its size and put in its place. A dead one has gone over on to its back,
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

export const vf_dummy =
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

	struct VertexInput {
		@location(0) shape: vec4f,		// xyz: the mesh, in metres, standing on y = 0 and facing +z. w: which part (see the top of the file)
		@location(1) place: vec4f,		// this player: xyz where its feet are, w: world units to the metre
		@location(2) pose: vec4f,		// x: heading (radians, round from +z towards +x), y: pitch (radians, up), z: where it is in its stride (radians), w: walking, 0 to 1
		@location(3) state: vec4f,		// x: gone over, 0 standing to 1 flat on its back, y: hit, 1 just hit fading to 0, z: its colour (0 to 1 round the hues), w: sitting (0 to 1), astride (1 to 2)
		@location(4) held: vec4f,		// x: how long what it holds is, the rifle it was made with 1 (0: nothing in its hands), y: 1 arms down at its sides, z: its head turned (radians, as heading)
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) onDummy: vec4f,		// xyz: where on the mesh as it was made, w: the part
		@location(2) @interpolate(flat) state: vec4f,
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
		let left = part <= 4;
		let shoulder = select(vec3f(0.22, 1.45, 0.0), vec3f(-0.22, 1.45, 0.0), left);
		let elbow = select(vec3f(0.22, 1.2, 0.1), vec3f(-0.2, 1.24, 0.24), left);
		let hand = select(vec3f(0.07, 1.29, 0.24), vec3f(-0.03, 1.31, 0.5), left);
		let out = select(1.0, -1.0, left);
		let upper = normalize(vec3f(0.07 * out, -1.0, swing));
		let fore = normalize(vec3f(0.02 * out, -1.0, swing * 1.4 + 0.18));
		if (part == 3 || part == 5) {
			return shoulder + turnTo(p - shoulder, normalize(elbow - shoulder), upper);
		}
		let elbowNow = shoulder + upper * length(elbow - shoulder);
		return elbowNow + turnTo(p - elbow, normalize(hand - elbow), fore);
	}

	const NECK: vec3f = vec3f(0.0, 1.55, 0.0);
	const SHOULDERS: vec3f = vec3f(0.0, 1.45, 0.0);
	const HIP_Y: f32 = 0.95;
	const KNEE_Y: f32 = 0.5;

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		var p = input.shape.xyz;
		let part = i32(input.shape.w + 0.5);
		let pitch = input.pose.y;
		let sit = min(input.state.w, 1.0);
		let astride = clamp(input.state.w - 1.0, 0.0, 1.0);

		if (part == 11) {
			// what it holds: the long box made 1.1 metres along z from the right shoulder, as long as the gun is (nothing at 0)
			p.z = -0.05 + (p.z + 0.05) * input.held.x;
			p = select(p, vec3f(0.0, 1.3, 0.0), input.held.x < 0.01);
		}
		if (part == 2 || part >= 12) {
			p = NECK + turnY(turnX(p - NECK, -0.6 * pitch), input.held.z);
		} else if (part >= 3 && part <= 6 && input.held.y > 0.5) {
			// (nothing in its hands: arms down, each swinging against the leg on its side)
			p = hangArm(p, part, cos(input.pose.z) * 0.4 * input.pose.w * select(1.0, -1.0, part <= 4));
		} else if ((part >= 3 && part <= 6) || part == 11) {
			p = SHOULDERS + turnX(p - SHOULDERS, -pitch);
		} else if (part >= 7 && part <= 10) {
			// a leg: the left and the right half a stride apart
			let left = part <= 8;
			let phase = input.pose.z + select(3.14159265, 0.0, left);
			let walking = input.pose.w;
			let hip = vec3f(select(-0.1, 0.1, left), HIP_Y, 0.0);
			if (part == 8 || part == 10) {
				let knee = vec3f(p.x, KNEE_Y, 0.0);
				p = knee + turnX(p - knee, -max(sin(phase), 0.0) * 0.9 * walking + 1.45 * sit);
			}
			p = hip + turnX(p - hip, cos(phase) * 0.5 * walking - 1.45 * sit);
			p = hip + turnZ(p - hip, select(-0.45, 0.45, left) * astride);
		}
		// sitting: down on to the seat
		p.y -= (HIP_Y - 0.05) * sit;

		// a dead one goes over on to its back, about its heels
		let over = input.state.x * 1.5;
		let fallen = turnX(p, -over) + vec3f(0.0, 0.12 * sin(over), 0.0);
		let position = input.place.xyz + turnY(fallen, input.pose.x) * input.place.w;

		var output: VertexOutput;
		output.pos = DU.viewProjectionMatrix * vec4f(position, 1.0);
		output.worldPos = position;
		output.onDummy = vec4f(input.shape.xyz, f32(part));
		output.state = input.state;
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
	};

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let toDummy = input.worldPos - Lights.camPos.xyz;
		let away = length(toDummy);
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		if (dot(N, toDummy) > 0.0) {
			N = -N;
		}

		let at = input.onDummy.xyz;
		let part = i32(input.onDummy.w + 0.5);
		let yellow = vec3f(0.86, 0.66, 0.08);
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

		// the same light as everything else
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.09 + daylight * (0.34 + 0.72 * saturate(dot(N, L)));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		var color = albedo * (light * sunTint + moonLight(N));
		color = mix(color, vec3f(0.9, 0.05, 0.03), 0.7 * input.state.y);

		if (DU.look.y > 0.5) {
			let horizonColor = fogColorAt(toDummy);
			let fog = 1.0 - exp(-pow(away / DU.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, 1.0);
	}
`;
