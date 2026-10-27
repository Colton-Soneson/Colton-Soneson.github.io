import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';

/*
	The puffs of smoke, fire and dust (see smoke.js): a ball each (an instance), as big as the puff is now. See-through: thickest where it
	faces the camera, nothing at its rim (so the ball does not show), coming in quickly and thinning to nothing at the end of its life;
		kind 0	a ball of fire, glowing at first and burning out to dark smoke
		kind 1	smoke, its darkness from the instance (0 grey to 1 black), a little lighter where the sun is on it
		kind 2	dust and plaster, pale and brown
	The light is the sun's and the moon's, as on everything else, and it fades into the horizon colour far off.
*/
export const vf_smoke =
`
	struct SmokeUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz, w: seconds
		look : vec4f,				// x: horizon fog distance, y: 1.0 if the atmosphere is on
	}
	@group(0) @binding(0) var<uniform> SU: SmokeUniforms;

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
		@location(1) normal: vec3f,
		@location(2) @interpolate(flat) look: vec4f,		// x: its age, 0 to 1, y: its kind, z: its seed, w: its darkness
	};

	@vertex
	fn vertexMain(@location(0) ball: vec4f, @location(1) place: vec4f, @location(2) state: vec4f) -> VertexOutput {
		// (each one turned its own way about its seed, so the balls do not all show the same facets)
		let a = state.z * 6.2832;
		let turned = vec3f(ball.x * cos(a) + ball.z * sin(a), ball.y, ball.z * cos(a) - ball.x * sin(a));
		let world = place.xyz + turned * place.w;
		var output: VertexOutput;
		output.pos = SU.viewProjectionMatrix * vec4f(world, 1.0);
		output.worldPos = world;
		output.normal = turned;
		output.look = state;
		return output;
	}

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;	// see f_water

	${skyLookupShapes}

	${moonShapes}

	fn hash2(p: vec2f) -> f32 {
		return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
	}

	@fragment
	fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
		let age = input.look.x;
		let kind = i32(input.look.y + 0.5);
		let toPuff = input.worldPos - Lights.camPos.xyz;
		let away = length(toPuff);
		let N = normalize(input.normal);
		let rim = saturate(dot(N, -toPuff / away));
		var albedo = vec3f(0.17, 0.16, 0.15);
		var glow = vec3f(0.0);
		var thick = 0.45;
		if (kind == 0) {
			let fire = saturate(1.0 - age * 2.4);
			albedo = mix(vec3f(0.17, 0.16, 0.15), vec3f(0.35, 0.14, 0.04), fire);
			glow = vec3f(1.9, 0.62, 0.14) * fire * fire;
			thick = 0.55 + 0.4 * fire;
		} else if (kind == 1) {
			albedo = mix(vec3f(0.42, 0.41, 0.4), vec3f(0.07, 0.065, 0.06), input.look.w);
			thick = 0.4 + 0.35 * input.look.w;
		} else {
			albedo = vec3f(0.55, 0.49, 0.4);
		}
		let alpha = thick * pow(rim, 1.5) * saturate(age * 12.0) * (1.0 - smoothstep(0.5, 1.0, age)) * (0.9 + 0.2 * hash2(floor(input.pos.xy * 0.5) + input.look.zz * 31.0));
		// the same light as everything else (a puff is soft: lit a little round its back too)
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.12 + daylight * (0.45 + 0.55 * saturate(dot(N, L) * 0.7 + 0.3));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		var color = albedo * (light * sunTint + moonLight(N)) + glow;
		if (SU.look.y > 0.5) {
			let horizonColor = fogColorAt(toPuff);
			let fog = 1.0 - exp(-pow(away / SU.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, alpha);
	}
`;
