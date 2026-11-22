import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';
import { BIRD_KINDS } from '../../code/wildBirdShapes.js';

const n = BIRD_KINDS.length;
const vecs = (f) => `array<vec4f, ${n}>(${BIRD_KINDS.map((K) => { const v = [...f(K), 0, 0, 0, 0].slice(0, 4); return `vec4f(${v.map((x) => x.toFixed(4)).join(', ')})`; }).join(', ')})`;

/*
	The wild birds drawn (wildBirds.js: the gulls, the owls, the ducks, the loons, the swans and the turkeys). Each kind its own mesh
	(wildBirdShapes.js), its colors in it, and what moves done here from each corner's part:
		1	the neck and the head: turned (anim.z) and bent down (anim.w times the kind's DOWN) about its NECK
		2	a wing: folded along the kind's FOLD, or spread (anim.x) and beaten up and down about its shoulder (pose.w, the angle now,
			more out towards the tip)
		3	a leg: swung about its HIP in the walk (anim.y), tucked up into the body in the air and on the water
		4	a turkey tom's tail: raised into a fan as he struts (extra.z)
	In the air (anim.x) the body is tipped forward by its TILT about its MIDDLE (an owl sits up). Then the whole bird is banked
	(pose.z), nosed up (pose.y), turned to its heading (pose.x), made its size and put in its place. Lit as the deer are.
*/
export const vf_wildBirds =
`
	struct BirdUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,
		look : vec4f,				// x: horizon fog distance, y: 1.0 if the atmosphere is on
	}
	@group(0) @binding(0) var<uniform> BU: BirdUniforms;

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

	struct VertexInput {
		@location(0) shape: vec4f,		// xyz: the mesh, metres. w: the part
		@location(1) look: vec4f,		// rgb: its color. w: on a wing, how far out along it (negative on the left)
		@location(2) place: vec4f,		// xyz: where its feet are (world), w: world units to its metre
		@location(3) pose: vec4f,		// x: heading, y: nose up, z: bank, w: the wings' beat now (radians up)
		@location(4) anim: vec4f,		// x: wings out (0 folded, 1 spread: in the air), y: the legs' swing, z: head turned, w: head down
		@location(5) extra: vec4f,		// x: its kind, y: on the water, z: a tom's display, w: its tone
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) color: vec3f,
	};

	fn turnX(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x, v.y * cos(angle) - v.z * sin(angle), v.y * sin(angle) + v.z * cos(angle)); }
	fn turnY(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) + v.z * sin(angle), v.y, v.z * cos(angle) - v.x * sin(angle)); }
	fn turnZ(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) - v.y * sin(angle), v.x * sin(angle) + v.y * cos(angle), v.z); }

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		var SHOULDER = ${vecs((K) => K.SHOULDER)};
		var FOLD = ${vecs((K) => K.FOLD)};
		var MIDDLE = ${vecs((K) => [...K.MIDDLE, K.TILT])};
		var NECK = ${vecs((K) => [...K.NECK, K.DOWN])};
		var TAIL = ${vecs((K) => K.TAIL)};
		var HIP = ${vecs((K) => K.HIP)};
		let kind = clamp(i32(input.extra.x + 0.5), 0, ${n - 1});
		var p = input.shape.xyz;
		let part = i32(input.shape.w + 0.5);
		let spread = input.anim.x;

		if (part == 2) {
			let side = select(-1.0, 1.0, p.x > 0.0);
			let s = abs(input.look.w);
			let pivot = vec3f(side * SHOULDER[kind].x, SHOULDER[kind].y, SHOULDER[kind].z);
			let rel = p - pivot;
			let open = pivot + turnZ(rel, side * input.pose.w * (0.75 + 0.5 * s));
			let shut = pivot + vec3f(side * 0.012 * s, rel.y * 0.3, rel.z * 0.3) + FOLD[kind].xyz * s * FOLD[kind].w;
			p = mix(shut, open, spread);
		} else if (part == 3) {
			let side = select(-1.0, 1.0, p.x > 0.0);
			let hip = vec3f(p.x, HIP[kind].x, HIP[kind].y);
			p = hip + turnX(p - hip, input.anim.y * side);
			p.y = mix(p.y, HIP[kind].x - 0.01, max(spread, input.extra.y));		// (tucked up)
			p.z = mix(p.z, HIP[kind].y - 0.02, max(spread, input.extra.y) * 0.5);
		} else if (part == 1) {
			let neck = NECK[kind].xyz;
			p = neck + turnY(turnX(p - neck, input.anim.w * NECK[kind].w), input.anim.z);
		} else if (part == 4) {
			let tail = TAIL[kind].xyz;
			p = tail + turnX(p - tail, 1.45 * input.extra.z);
		}
		// tipped forward in the air
		let middle = MIDDLE[kind].xyz;
		p = middle + turnX(p - middle, MIDDLE[kind].w * spread);

		let banked = turnZ(p, input.pose.z);
		let tipped = turnX(banked, -input.pose.y);
		let position = input.place.xyz + turnY(tipped, input.pose.x) * input.place.w;

		var output: VertexOutput;
		output.pos = BU.viewProjectionMatrix * vec4f(position, 1.0);
		output.worldPos = position;
		output.color = input.look.rgb * mix(0.88, 1.1, input.extra.w);
		return output;
	}

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;

	${skyLookupShapes}

	${moonShapes}

	struct FragInput {
		@location(0) worldPos: vec3f,
		@location(1) color: vec3f,
	};

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let toBird = input.worldPos - Lights.camPos.xyz;
		let away = length(toBird);
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		if (dot(N, toBird) > 0.0) {
			N = -N;
		}
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.1 + daylight * (0.36 + 0.7 * saturate(dot(N, L)));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		var color = input.color * (light * sunTint + moonLight(N));
		if (BU.look.y > 0.5) {
			let fog = 1.0 - exp(-pow(away / BU.look.x, 2.0));
			color = mix(color, fogColorAt(toBird), fog);
		}
		return vec4f(color, 1.0);
	}
`;
