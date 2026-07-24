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

export const vf_p_generic3D = 
`
	struct SpacesUniforms
	{
		modelViewProjectionMatrix : mat4x4f,
		modelMatrix : mat4x4f,
		normalMatrix : mat4x4f,
	}
	
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
		displayLightingMode : f32,	//find a different space for this, its own UBO, also has to be float for some reason
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
		@location(1) light: f32,
		@location(2) fragPos: vec4f,
		@location(3) shadowPos: vec4f,
		@location(4) fragNormal: vec3f,
	};
	
	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {	
		
		var output: VertexOutput;
		output.pos = UBO.modelViewProjectionMatrix * vec4f(input.pos.x, input.pos.y, input.pos.z, 1.0);
		let vertexInputPosWS = (UBO.modelMatrix * vec4f(input.pos.xyz, 1.0)).xyz;	
		
		//----------------POINT LIGHTS-------------------
		// Calculate light intensity (inverse square law)
		let dist = length(Lights.sunPos.xyz - vertexInputPosWS);  // Calculate distance in world space
		output.light = Lights.sunIntensity / (dist * dist);    
		//-----------------------------------------------
		
		//-----------------AMBIENT LIGHT-------------
		//output.light = Lights.sunIntensity;
		//-----------------------------------------------
		
		// Normal transformation
		let vNormal = normalize(UBO.normalMatrix * vec4f(input.norm.x, input.norm.y, input.norm.z, 0.0));
		
		let pointToLight = Lights.lightViewProjMat * UBO.modelMatrix * vec4(input.pos, 1.0);
		let sp = pointToLight.xy * vec2f(0.5,-0.5) + vec2f(0.5,0.5);
		output.shadowPos = vec4f(sp.x, sp.y, pointToLight.z, 1.0);
		
		output.fragPos = output.pos;
		output.fragNormal = input.norm;
		output.fragUV = input.uv;
		
		return output;
	}
	
	@group(0) @binding(2) var myTexture: texture_2d<f32>;
	@group(0) @binding(3) var mySampler: sampler;
	
	@group(0) @binding(4) var myShadowMap: texture_depth_2d;
	@group(0) @binding(5) var myShadowSampler: sampler_comparison;

	
	//same as vertexoutput without builtin bits
	struct FragInput {
		@location(0) fragUV: vec2f,
		@location(1) light: f32,
		@location(2) fragPos: vec4f,
		@location(3) shadowPos: vec4f,
		@location(4) fragNormal: vec3f,
	};

	
	@fragment
	fn fragmentMain(input: FragInput) -> //could also use input: VertexOutput instead because its contained within the same file here
		@location(0) vec4f {
		
		//this has to do with the accuracy of the map, if you see "stripes", take a look at this number (shadowmap resolution doesnt have anything to do with it)
		let invShadowMapTextureSize = 1.0 / Lights.shadowMapTextureSize;
		var visibility = 0.0;
		let kernelCount = (2.0 * Lights.shadowMapKernelSize + 1.0) * (2.0 * Lights.shadowMapKernelSize + 1.0);
		let kernelSize = i32(Lights.shadowMapKernelSize);
		
		//PCF
		for(var x = -kernelSize; x <= kernelSize; x++)
		{
			for(var y = -kernelSize; y <= kernelSize; y++)
			{
				let kernelOffset = vec2f(f32(x),f32(y)) * invShadowMapTextureSize;
				visibility += textureSampleCompare(myShadowMap, myShadowSampler, input.shadowPos.xy + kernelOffset, input.shadowPos.z - Lights.shadowMapAcneBias);
			}
		}
		visibility /= kernelCount;
		
		var finalResult = vec4f(0.0,0.0,0.0,1.0);
		
		if(Lights.displayLightingMode == 1.0)
		{
			finalResult = vec4f(visibility, 0.0,0.0,1.0);
		}
		else
		{
			let shadowImpactOnAmbient = 0.4;
			finalResult = textureSample(myTexture, mySampler, input.fragUV) * (Lights.sunCol * input.light * (visibility + shadowImpactOnAmbient));
		}
		
		return finalResult;
	}
`;