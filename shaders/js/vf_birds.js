import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';

/*
	The birds drawn. See birds.js for the bird itself (its 18 flat triangles) and how it flies.

	One mesh, drawn once for every bird (instancing): each instance brings where the bird is, which way it is heading, how
	it is banked, and where its wings are in their beat. The mesh is flat, cut out of a sheet: all of the bird's shape in
	the air is put on here.
		the beat	every vertex knows how far out along a wing it is (0 on the body, 1 at the tip, below 0 for the left wing).
					The wing is lifted and dropped by that, squared, so it bends up from the shoulder like a wing and not
					like a board. A gliding hawk holds its wings a little above level and hardly moves them
		folded		on a perch the wings are drawn in against the body and the bird sits up
	A flat thing has two sides and they are different: brown on top, pale underneath with dark tips to the wings and a dark
	bar across the tail. Which side is being looked at is which way the sheet faces next to the eye.
*/
export const vf_birds =
`
	struct BirdUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz
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
		moonPos : vec4f,			// xyz: towards the moon, w: how bright it is (see f_moon.js)
	}
	@group(0) @binding(1) var<uniform> Lights: LightsUniforms;
	@group(0) @binding(2) var skyLUT: texture_2d<f32>;
	@group(0) @binding(3) var skySampler: sampler;

	struct VertexInput {
		@location(0) shape: vec4f,		// xyz: the mesh, a bird 1 across from wing tip to wing tip, heading along +z. w: how far out along a wing (see the top of the file)
		@location(1) place: vec4f,		// this bird: xyz where it is, w: its wingspan, world units
		@location(2) pose: vec4f,		// x: its heading (radians, round from +z towards +x), y: nose up, z: banked, w: where its wings are in their beat (radians)
		@location(3) state: vec4f,		// x: how hard it is beating its wings, 0 gliding to 1, y: how folded they are, 0 to 1, z: a number of its own
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) normal: vec3f,
		@location(2) onBird: vec3f,		// where on the flat mesh: x across, z along, and y: how far out along a wing
		@location(3) @interpolate(flat) tone: f32,
	};

	// v turned by an angle about one of the axes
	fn turnX(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x, v.y * cos(angle) - v.z * sin(angle), v.y * sin(angle) + v.z * cos(angle)); }
	fn turnY(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) + v.z * sin(angle), v.y, v.z * cos(angle) - v.x * sin(angle)); }
	fn turnZ(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) - v.y * sin(angle), v.x * sin(angle) + v.y * cos(angle), v.z); }

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		let outAlong = abs(input.shape.w);
		var p = input.shape.xyz;

		// the beat (and with no beat, the wings held a little up: a hawk's glide)
		let lift = (0.07 + 0.3 * input.state.x * sin(input.pose.w)) * outAlong * outAlong;
		p.y += lift;
		p.x *= 1.0 - 0.5 * abs(lift) * outAlong;		// (a raised wing reaches less far out)
		// folded: drawn in to the body and swept back along it
		let folded = input.state.y * outAlong;
		p.x *= 1.0 - 0.72 * folded;
		p.z -= 0.2 * folded;
		p.y = mix(p.y, 0.02 * outAlong, input.state.y);

		// banked, nosed up (a perched bird sits upright), turned to its heading, made its size, put in its place
		let nose = input.pose.y + 1.05 * input.state.y;
		let turned = turnY(turnX(turnZ(p, input.pose.z), -nose), input.pose.x);
		let position = input.place.xyz + turned * input.place.w;

		var output: VertexOutput;
		output.pos = BU.viewProjectionMatrix * vec4f(position, 1.0);
		output.worldPos = position;
		// which way the sheet faces: up, leant by the slope of the wing where the beat has bent it
		let slope = 2.0 * (0.07 + 0.3 * input.state.x * sin(input.pose.w)) * outAlong * sign(input.shape.x) * (1.0 - input.state.y);
		output.normal = turnY(turnX(turnZ(normalize(vec3f(-slope, 1.0, 0.0)), input.pose.z), -nose), input.pose.x);
		output.onBird = vec3f(input.shape.x, outAlong, input.shape.z);
		output.tone = input.state.z;
		return output;
	}

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;	// see f_water

	// The color the sky pass puts on screen for a world direction, the same lookup as everything else that fades into the horizon uses
	${skyLookupShapes}

	${moonShapes}

	struct FragInput {
		@location(0) worldPos: vec3f,
		@location(1) normal: vec3f,
		@location(2) onBird: vec3f,
		@location(3) @interpolate(flat) tone: f32,
	};

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let toBird = input.worldPos - Lights.camPos.xyz;
		let away = length(toBird);
		var N = normalize(input.normal);
		// which side is being looked at
		let fromBelow = dot(N, toBird) > 0.0;
		if (fromBelow) {
			N = -N;
		}

		// on top: brown, darker out along the wings, every bird its own shade
		var albedo = mix(vec3f(0.34, 0.23, 0.14), vec3f(0.2, 0.14, 0.09), smoothstep(0.2, 0.9, input.onBird.y)) * mix(0.8, 1.15, input.tone);
		if (fromBelow) {
			// underneath: pale, with dark tips and a dark trailing edge to the wings, and a bar across the end of the tail
			let pale = vec3f(0.8, 0.73, 0.6) * mix(0.9, 1.05, input.tone);
			let dark = max(smoothstep(0.72, 0.9, input.onBird.y), smoothstep(-0.03, -0.065, input.onBird.z) * smoothstep(0.15, 0.4, input.onBird.y));
			let bar = smoothstep(-0.15, -0.165, input.onBird.z) * (1.0 - smoothstep(-0.185, -0.2, input.onBird.z)) * (1.0 - smoothstep(0.0, 0.1, input.onBird.y));
			albedo = mix(pale, vec3f(0.16, 0.12, 0.09), max(dark, bar));
		}

		// the same light as everything else
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.09 + daylight * (0.34 + 0.72 * saturate(dot(N, L)));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		var color = albedo * (light * sunTint + moonLight(N));

		// and the same fade into the horizon
		if (BU.look.y > 0.5) {
			let horizonColor = fogColorAt(toBird);
			let fog = 1.0 - exp(-pow(away / BU.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, 1.0);
	}
`;
