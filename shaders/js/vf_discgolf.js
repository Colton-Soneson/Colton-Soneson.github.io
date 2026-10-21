import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';

/*
	The disc golf course and the discs (discgolf.js): the baskets, the tee pads, the discs flying or lying about. Each is a mesh in
	metres, drawn once for each of its kind (instancing), each with its own matrix (where it is, how it is turned, made world units)
	and its own colour: a hole's for its basket's band and its tee pad's edge, a disc's own.
	What each part of a mesh is, by shape.w: 0 painted the colour, 1 galvanised steel (the pole, the basket), 2 the chains, 3 concrete
	(the tee pad), 4 a disc's top (the colour, with a stripe of white), 5 a disc's rim and bottom (the colour, darker).

	THE GLOW round a thrown disc (vf_discGlow, drawn after them, added to what is there): a ring of its colour on a card turned to the
	camera, a little bigger the further off it is so it does not shrink to nothing, breathing slowly. Drawn twice: where the disc can be
	seen (fragmentGlow), and fainter where something is in front of it (fragmentGlowHidden: the grass it lies in, a tree, a rise),
	so a disc lying in the long grass still shows where it is.
*/
export const vf_discgolf =
`
	struct GolfUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz
		look : vec4f,				// x: horizon fog distance, y: 1.0 if the atmosphere is on, z: seconds
		right : vec4f,				// the camera's right and up, in the world (for the glow's cards)
		up : vec4f,
	}
	@group(0) @binding(0) var<uniform> GU: GolfUniforms;

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
		@location(0) shape: vec4f,		// xyz: the mesh, in metres. w: what it is (see the top of the file)
		@location(1) m0: vec4f,			// its matrix, column by column
		@location(2) m1: vec4f,
		@location(3) m2: vec4f,
		@location(4) m3: vec4f,
		@location(5) colour: vec4f,		// rgb, w: unused
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) onIt: vec4f,
		@location(2) @interpolate(flat) colour: vec3f,
	};

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		let model = mat4x4f(input.m0, input.m1, input.m2, input.m3);
		let world = (model * vec4f(input.shape.xyz, 1.0)).xyz;
		var output: VertexOutput;
		output.pos = GU.viewProjectionMatrix * vec4f(world, 1.0);
		output.worldPos = world;
		output.onIt = input.shape;
		output.colour = input.colour.rgb;
		return output;
	}

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;	// see f_water

	${skyLookupShapes}

	${moonShapes}

	struct FragInput {
		@location(0) worldPos: vec3f,
		@location(1) onIt: vec4f,
		@location(2) @interpolate(flat) colour: vec3f,
	};

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let toIt = input.worldPos - Lights.camPos.xyz;
		let away = length(toIt);
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		if (dot(N, toIt) > 0.0) {
			N = -N;
		}
		let what = i32(input.onIt.w + 0.5);
		var albedo = input.colour;
		var shine = 0.1;
		switch (what) {
			case 1: { albedo = vec3f(0.55, 0.57, 0.6); shine = 0.6; }
			case 2: { albedo = vec3f(0.42, 0.43, 0.45); shine = 0.9; }
			case 3: {
				albedo = vec3f(0.55, 0.54, 0.5);
				let edge = max(abs(input.onIt.x) - 0.7, abs(input.onIt.z) - 1.35);
				if (edge > -0.08) { albedo = input.colour; }
			}
			case 4: {
				let r = length(input.onIt.xz);
				albedo = select(input.colour, mix(input.colour, vec3f(1.0), 0.75), abs(r - 0.065) < 0.008);
				shine = 0.35;
			}
			case 5: { albedo = input.colour * 0.7; shine = 0.3; }
			default: {}
		}
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.09 + daylight * (0.34 + 0.72 * saturate(dot(N, L)));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		let V = normalize(-toIt);
		let gloss = pow(saturate(dot(N, normalize(L + V))), 30.0) * shine * daylight;
		var color = albedo * (light * sunTint + moonLight(N)) + vec3f(gloss);
		if (GU.look.y > 0.5) {
			let horizonColor = fogColorAt(toIt);
			let fog = 1.0 - exp(-pow(away / GU.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, 1.0);
	}
`;

// The glow round a thrown disc (see THE GLOW at the top). Each instance: where the disc is and how big its card is (world units), its colour
export const vf_discGlow =
`
	struct GolfUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,
		look : vec4f,
		right : vec4f,
		up : vec4f,
	}
	@group(0) @binding(0) var<uniform> GU: GolfUniforms;

	struct GlowOutput {
		@builtin(position) pos: vec4f,
		@location(0) onCard: vec2f,
		@location(1) @interpolate(flat) colour: vec4f,
	};

	@vertex
	fn vertexMain(@builtin(vertex_index) corner: u32, @location(0) place: vec4f, @location(1) colour: vec4f) -> GlowOutput {
		var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
		let c = corners[corner];
		// (brought a little towards the camera, so the ground the disc lies on does not cut the card in half)
		let toCamera = normalize(GU.cameraPosition.xyz - place.xyz);
		let world = place.xyz + toCamera * place.w * 0.6 + (GU.right.xyz * c.x + GU.up.xyz * c.y) * place.w;
		var output: GlowOutput;
		output.pos = GU.viewProjectionMatrix * vec4f(world, 1.0);
		output.onCard = c;
		output.colour = colour;
		return output;
	}

	fn glowAt(onCard: vec2f, colour: vec4f) -> vec4f {
		let r = length(onCard);
		let breathe = 0.8 + 0.2 * sin(GU.look.z * 3.2 + colour.w * 6.0);
		let ring = exp(-pow((r - 0.62) / 0.13, 2.0));
		let haze = 0.35 * exp(-r * r * 3.5);
		let edge = 1.0 - smoothstep(0.85, 1.0, r);
		let light = (ring + haze) * edge * breathe;
		return vec4f(mix(colour.rgb, vec3f(1.0), 0.35) * light, 0.0);
	}

	@fragment
	fn fragmentGlow(@location(0) onCard: vec2f, @location(1) @interpolate(flat) colour: vec4f) -> @location(0) vec4f {
		return glowAt(onCard, colour) * 1.6;
	}
	@fragment
	fn fragmentGlowHidden(@location(0) onCard: vec2f, @location(1) @interpolate(flat) colour: vec4f) -> @location(0) vec4f {
		return glowAt(onCard, colour) * 0.55;
	}
`;
