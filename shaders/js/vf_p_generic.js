import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';
export const vf_p_generic = 
`
	@vertex
	fn vertexMain(@location(0) pos: vec2f) -> 	// location and type to match whats described in vertexBufferLayout below
											    //		the 0 in location is for shaderLocation attribute and vec2f = float32x2
		 @builtin(position) vec4f {	// -> is for what the function returns, value returned is assigned with @builtin 
		 return vec4f(pos, 0, 1); // (X, Y, Z, W) W is always 1 for 4x4 mat math
	}
	
	@fragment
	fn fragmentMain() -> @location(0) vec4f {	//return value to indicate which coloarAttachnment from beginRenderPass is written to
											   //	Just one attachment of color means location is 0
		 return vec4f(1,0,0,1);
	}
`;



/*
	The models loaded from files (the lighthouse, the house, the bench), lit the same way as the land around them (see lightLand in
	vf_terrain.js), so they sit in it instead of standing out:
		the sun		a direction, not a lamp somewhere: how much a surface faces it is what lights it. It fades out as it sets,
					and only tints the light as it gets low (its full color is the color of the sunset)
		shadows		from the shadow map, which only covers a box round the buildings, so they fade out towards its edge
		the sky		light from all round, more on what faces up than on what faces down
		the moon	a little cold light at night (f_moon.js)
		the haze	far off, the color fades into the sky on the horizon, as the land and the water do
	The screen space shadows and ambient occlusion are put on top of all of it afterwards, as on everything else (screenEffects.js).
*/
export const vf_p_generic3D =
`
	struct SpacesUniforms
	{
		modelViewProjectionMatrix : mat4x4f,
		modelMatrix : mat4x4f,
		normalMatrix : mat4x4f,
		look : vec4f,			// x: how far off the haze is about two thirds over the color, y: 1 while the atmosphere is on
	}

	struct LightsUniforms
	{
		lightViewProjMat : mat4x4f,
		sunPos : vec4f,			// which way the sun is (only the direction counts)
		sunCol : vec4f,
		camPos : vec4f,
		sunIntensity : f32,
		shadowMapKernelSize : f32,
		shadowMapTextureSize : f32,
		shadowMapAcneBias : f32,
		displayLightingMode : f32,	//find a different space for this, its own UBO, also has to be float for some reason
		moonPos : vec4f,		// xyz: towards the moon, w: how bright it is (see f_moon.js)
	}

	@group(0) @binding(0) var<uniform> UBO: SpacesUniforms;
	@group(0) @binding(1) var<uniform> Lights: LightsUniforms;

	struct VertexInput {
		@location(0) pos: vec3f,
		@location(1) uv: vec2f,
		@location(2) norm: vec3f,
	};

	struct VertexOutput {				//into frag
		@builtin(position) pos: vec4f,
		@location(0) fragUV: vec2f,
		@location(1) worldPos: vec3f,
		@location(2) shadowPos: vec3f,
		@location(3) fragNormal: vec3f,
	};

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {

		var output: VertexOutput;
		output.pos = UBO.modelViewProjectionMatrix * vec4f(input.pos, 1.0);
		let worldPos = (UBO.modelMatrix * vec4f(input.pos, 1.0)).xyz;
		output.worldPos = worldPos;

		// the normal, turned the way the model is in the world (the normal matrix keeps it square to the surface however the model is scaled)
		output.fragNormal = (UBO.normalMatrix * vec4f(input.norm, 0.0)).xyz;

		// where this point lands in the shadow map: xy as a texture coordinate, z as the depth to compare against
		let pointToLight = Lights.lightViewProjMat * vec4f(worldPos, 1.0);
		output.shadowPos = vec3f(pointToLight.xy * vec2f(0.5, -0.5) + vec2f(0.5, 0.5), pointToLight.z);

		output.fragUV = input.uv;
		return output;
	}

	@group(0) @binding(2) var myTexture: texture_2d<f32>;
	@group(0) @binding(3) var mySampler: sampler;

	@group(0) @binding(4) var myShadowMap: texture_depth_2d;
	@group(0) @binding(5) var myShadowSampler: sampler_comparison;

	@group(0) @binding(6) var skyLUT: texture_2d<f32>;
	@group(0) @binding(7) var skySampler: sampler;

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;	// see f_water: reads the first row of sky above the horizon, not the seam under it

	// The color the sky pass puts on screen for a world direction, the same lookup as f_sky, f_water and the land use
	${skyLookupShapes}

	${moonShapes}

	//same as vertexoutput without builtin bits
	struct FragInput {
		@location(0) fragUV: vec2f,
		@location(1) worldPos: vec3f,
		@location(2) shadowPos: vec3f,
		@location(3) fragNormal: vec3f,
	};

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let albedo = textureSample(myTexture, mySampler, input.fragUV);
		let toModel = input.worldPos - Lights.camPos.xyz;
		let away = length(toModel);

		// the side of the surface the camera sees (a face only one triangle thick, the bench's seat, is seen from both sides)
		var N = normalize(input.fragNormal);
		if (dot(N, toModel) > 0.0) {
			N = -N;
		}

		let L = normalize(Lights.sunPos.xyz);			// the sun as a direction
		let daylight = smoothstep(-0.08, 0.25, L.y);	// fades the sun out as it sets
		let diffuse = saturate(dot(N, L));

		// Shadow map (PCF). It only covers a box around the buildings, so the shadows fade out towards the edge of that box and
		//		everything outside it is just lit. The bias grows on a surface the sun only grazes, where the texels of the map
		//		are stretched furthest across it and it would otherwise shadow itself in stripes
		let shadowMapEdge = min(min(input.shadowPos.x, 1.0 - input.shadowPos.x), min(input.shadowPos.y, 1.0 - input.shadowPos.y));
		let insideShadowMap = saturate(shadowMapEdge / 0.08) * step(0.0, input.shadowPos.z) * step(input.shadowPos.z, 1.0);
		let invShadowMapTextureSize = 1.0 / Lights.shadowMapTextureSize;
		let kernelSize = i32(Lights.shadowMapKernelSize);
		let kernelCount = (2.0 * Lights.shadowMapKernelSize + 1.0) * (2.0 * Lights.shadowMapKernelSize + 1.0);
		let bias = Lights.shadowMapAcneBias * (0.15 + 0.85 * (1.0 - diffuse));
		var visibility = 0.0;
		for (var x = -kernelSize; x <= kernelSize; x++) {
			for (var y = -kernelSize; y <= kernelSize; y++) {
				let kernelOffset = vec2f(f32(x), f32(y)) * invShadowMapTextureSize;
				visibility += textureSampleCompareLevel(myShadowMap, myShadowSampler, input.shadowPos.xy + kernelOffset, input.shadowPos.z - bias);
			}
		}
		visibility = mix(1.0, visibility / kernelCount, insideShadowMap);

		if (Lights.displayLightingMode == 1.0) {
			return vec4f(visibility, 0.0, 0.0, 1.0);
		}

		// a little light at night, sky light through the day (less on what faces the ground than on what faces the sky), and the
		//		sun on top where it reaches. The sun only colors the light as it gets low
		let skyLight = (0.09 + daylight * 0.34) * mix(0.55, 1.0, N.y * 0.5 + 0.5);
		let sunLight = daylight * 0.72 * diffuse * visibility;
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));	// warmer as the sun gets low
		var color = albedo.rgb * ((skyLight + sunLight) * sunTint + moonLight(N));

		// the haze: far off, the color of the sky on the horizon behind it
		if (UBO.look.y > 0.5) {
			let horizonColor = fogColorAt(toModel);
			let fog = 1.0 - exp(-pow(away / UBO.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, 1.0);
	}
`;
