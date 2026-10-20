import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';

/*
	The deer drawn. See deer.js for the deer itself (its 77 triangles, in metres) and how they live.

	One mesh, drawn once for every deer (instancing). What moves is done here, from each vertex's part (shape.w):
		0		the body, the tail
		1		the neck and the head: swung down about the foot of the neck by how far the deer has its head down (grazing,
				drinking), 0 up to 1 at the ground
		2 to 5	the legs: left front, right front, left hind, right hind. Each swings from the hip with the walk, and the lower
				leg bends back at the knee as it comes forward. The four take turns (a walk: hind, front, other hind, other front)
	Then the whole deer is tipped to the slope it stands on, turned to its heading, made its size and put in its place.
	The light comes from the faces as they are after all that (dpdx, dpdy), as for the geese.
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
		@location(3) state: vec4f,		// x: a number of its own, y: the slope under it along its heading (radians, nose up), z: rolled over on to its side (radians: a shot deer)
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) onDeer: vec4f,		// xyz: where on the mesh as it was made, w: the part
		@location(2) @interpolate(flat) tone: f32,
	};

	fn turnX(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x, v.y * cos(angle) - v.z * sin(angle), v.y * sin(angle) + v.z * cos(angle)); }
	fn turnY(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) + v.z * sin(angle), v.y, v.z * cos(angle) - v.x * sin(angle)); }
	fn turnZ(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) - v.y * sin(angle), v.x * sin(angle) + v.y * cos(angle), v.z); }

	const NECK_FOOT: vec3f = vec3f(0.0, 1.08, 0.45);
	const HIP_Y: f32 = 0.88;
	const KNEE_Y: f32 = 0.45;
	const FRONT_HIP_Z: f32 = 0.4;
	const HIND_HIP_Z: f32 = -0.45;

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		var p = input.shape.xyz;
		let part = input.shape.w;

		if (part > 1.5) {
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
			// the neck and the head, down to the grass or the water
			p = NECK_FOOT + turnX(p - NECK_FOOT, 1.25 * input.pose.z);
		}

		// a shot deer over on its side, about its feet, and up by the half width of it so it lies on the ground and not in it
		let rolled = turnZ(p, input.state.z) + vec3f(0.0, 0.17 * abs(sin(input.state.z)), 0.0);
		let tipped = turnX(rolled, -input.state.y);
		let position = input.place.xyz + turnY(tipped, input.pose.x) * input.place.w;

		var output: VertexOutput;
		output.pos = DU.viewProjectionMatrix * vec4f(position, 1.0);
		output.worldPos = position;
		output.onDeer = vec4f(input.shape.xyz, part);
		output.tone = input.state.x;
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
	};

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let toDeer = input.worldPos - Lights.camPos.xyz;
		let away = length(toDeer);
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		if (dot(N, toDeer) > 0.0) {
			N = -N;
		}

		// a white-tailed deer's colors: red brown, paler underneath, white under the tail, the legs darker towards the hooves, a dark nose
		let at = input.onDeer.xyz;
		let tone = mix(0.85, 1.12, input.tone);
		var albedo = vec3f(0.42, 0.28, 0.17) * tone;
		if (input.onDeer.w > 1.5) {
			albedo = mix(vec3f(0.12, 0.09, 0.07), albedo, smoothstep(0.08, 0.5, at.y));
		} else if (input.onDeer.w > 0.5) {
			if (at.z > 0.88) {
				albedo = vec3f(0.08, 0.07, 0.06);			// the nose
			}
		} else if (at.z < -0.58) {
			albedo = vec3f(0.86, 0.83, 0.78);				// the white of the tail and the rump
		} else if (at.y < 0.84) {
			albedo = vec3f(0.66, 0.58, 0.48) * tone;		// the belly
		}

		// the same light as everything else
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.09 + daylight * (0.34 + 0.72 * saturate(dot(N, L)));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		var color = albedo * (light * sunTint + moonLight(N));

		if (DU.look.y > 0.5) {
			let horizonColor = fogColorAt(toDeer);
			let fog = 1.0 - exp(-pow(away / DU.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, 1.0);
	}
`;
