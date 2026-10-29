import { motionShapes } from './motionShapes.js';
import { itemMaterials } from './f_itemMaterials.js';

/*
	THE PROPS of the Survival mode (props.js): crates, sacks, campfires, the things thrown and lying about, out in the world. Each vertex is
	a model's (itemMeshes.js: metres, shape.w its part and material), each instance where it is (model: its metres into the world) and how
	it glows (glow: rgb and how strong, for one that is looked at, or of this player's own lying out, as the discs: discgolf.js).
	Lit by the sun and the moon, as everything else (no shadows: they are small).
*/
export const vf_props =
`
	struct PropUniforms
	{
		viewProjection : mat4x4f,
		motionNow : mat4x4f,		// THE MOTION (temporalAA.js): this frame's view projection without the jitter
		motionPrev : mat4x4f,		//		and the last frame's (the props stand still: only the camera moves)
		time : vec4f,				// x: seconds
	}
	@group(0) @binding(0) var<uniform> PU: PropUniforms;
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
	struct Instance { model : mat4x4f, glow : vec4f, }
	@group(0) @binding(2) var<storage, read> instances: array<Instance>;

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) shape: vec3f,
		@location(2) @interpolate(flat) material: f32,
		@location(3) @interpolate(flat) glow: vec4f,
		@location(14) nowClip: vec4f,
		@location(15) prevClip: vec4f,
	};

	@vertex
	fn vertexMain(@location(0) shape: vec4f, @builtin(instance_index) k: u32) -> VertexOutput {
		let I = instances[k];
		let world = (I.model * vec4f(shape.xyz, 1.0)).xyz;
		var output: VertexOutput;
		output.pos = PU.viewProjection * vec4f(world, 1.0);
		output.worldPos = world;
		output.shape = shape.xyz;
		output.material = floor((shape.w + 0.5) / 32.0);
		output.glow = I.glow;
		output.nowClip = PU.motionNow * vec4f(world, 1.0);
		output.prevClip = PU.motionPrev * vec4f(world, 1.0);
		return output;
	}

	${itemMaterials}

	fn shade(input: VertexOutput) -> vec4f {
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		let toEye = Lights.camPos.xyz - input.worldPos;
		if (dot(N, toEye) < 0.0) { N = -N; }
		let m = i32(input.material + 0.5);
		var albedo = vec3f(0.4);
		var gloss = 0.1;
		if (m >= 20) { let im = itemMaterial(m, input.shape); albedo = im.rgb; gloss = im.a; }
		else if (m == 1) { albedo = vec3f(0.06, 0.065, 0.075); gloss = 0.5; }
		else if (m == 2) { albedo = vec3f(0.62, 0.46, 0.2); gloss = 0.8; }
		else if (m == 8) { albedo = vec3f(0.62, 0.63, 0.65); gloss = 0.9; }
		else if (m == 9) { albedo = vec3f(0.05, 0.045, 0.04); }
		let L = normalize(Lights.sunPos.xyz);
		let day = smoothstep(-0.1, 0.25, L.y);
		let diffuse = saturate(dot(N, L)) * day;
		let H = normalize(L + normalize(toEye));
		let shine = pow(saturate(dot(N, H)), 32.0) * gloss * day;
		let moon = saturate(dot(N, normalize(Lights.moonPos.xyz))) * Lights.moonPos.w * 0.15;
		var color = albedo * (0.06 + 0.22 * day + 0.95 * diffuse + moon) + vec3f(shine * 0.5) + itemGlow(m) * (0.8 + 0.2 * sin(PU.time.x * 13.0 + input.shape.x * 40.0));
		color += input.glow.rgb * input.glow.a * (0.35 + 0.65 * saturate(dot(N, normalize(toEye))));
		return vec4f(color, 1.0);
	}

	${motionShapes}
	@fragment
	fn fragmentMain(input: VertexOutput) -> FrameOut {
		return FrameOut(shade(input), motionOf(input.nowClip, input.prevClip));
	}
`;
