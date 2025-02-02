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
		sunIntensity : f32,
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
	
    // Normal transformation
    let vNormal = normalize(UBO.normalMatrix * vec4f(input.norm.x, input.norm.y, input.norm.z, 0.0));
    
	let pointToLight = Lights.lightViewProjMat * UBO.modelMatrix * vec4(input.pos, 1.0);
	let sp = pointToLight.xy * vec2f(0.5,-0.5) + vec2f(0.5,0.5);
	output.shadowPos = vec4f(sp.x, sp.y, pointToLight.z, 1.0);
	
	//let shadowCoord = pointToLight.xy / pointToLight.w * 0.5 + 0.5;
	//let shadowDepth = pointToLight.z;
	//output.shadowPos = vec4f(shadowCoord, shadowDepth, 1.0);
	
	
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
		
		//return vec4f(input.light , 0.0, 0.0, 1.0);
		//return textureSample(myTexture, mySampler, input.fragUV);
		//return textureSampleCompare(myShadowMap, myShadowSampler, 0.5, input.fragUV);
		
		//let lightSpacePos = Lights.lightViewProjMat * input.fragPos;
		//let shadowCoord = lightSpacePos.xy / lightSpacePos.w;
		//let shadowUV = shadowCoord;  // Convert from [-1, 1] to [0, 1] range
		//let isInShadow = textureSampleCompare(myShadowMap, myShadowSampler, shadowUV, lightSpacePos.z);
		
		//return vec4f(isInShadow, 0.0,0.0,1.0);
		
		//var visibility = 0.0;
		//let oneOverShadowDepthTextureSize = 1.0 / 1024.0; // Adjust based on shadow map resolution
		//for (var y = -1; y <= 1; y++) {
		//	for (var x = -1; x <= 1; x++) {
		//		let offset = vec2f(vec2(x, y)) * oneOverShadowDepthTextureSize;
		//		visibility += textureSampleCompare(
		//			myShadowMap, myShadowSampler,
		//			input.shadowPos.xy + offset, input.shadowPos.z
		//		);
		//	}
		//}
		//visibility /= 9.0; // PCF: Average over 3x3 kernel
		//
		//let ambientFactor = 0.2;
		//let fragPosWorldSpace = (UBO.modelMatrix * input.fragPos).xyz;
		//let lightDir = normalize(Lights.sunPos.xyz - fragPosWorldSpace);
		//let lambertFactor = max(dot(lightDir, normalize(input.fragNormal.xyz)), 0.0);
		//let lightingFactor = min(ambientFactor + visibility * lambertFactor, 1.0);
		//return vec4(lightingFactor * vec3f(0.9), 1.0);
		
		//let test = textureSampleCompare(myShadowMap, myShadowSampler, input.shadowPos.xy, input.shadowPos.z);
		
		//if(test < input.fragPos.z)
		//{
		//	return vec4f(0.0, 1.0, 0.0, 1.0);
		//}
		//else
		//{
		//	return vec4f(1.0, 0.0, 0.0, 1.0);
		//}
		
		//return vec4f(input.shadowPos.xyz, 1.0);
		//return vec4f(textureSampleCompare(myShadowMap, myShadowSampler, input.shadowPos.xy, input.shadowPos.z), 0.0, 0.0, 1.0);
		//return vec4f(test, 0.0,0.0,1.0);
		
		
		let visibility = textureSampleCompare(myShadowMap, myShadowSampler, input.shadowPos.xy, input.shadowPos.z);
		return vec4f(visibility, 0.0,0.0,1.0);
		
		
		
		//return textureSample(myTexture, mySampler, input.fragUV) * (Lights.sunCol * input.light);
	}
`;

export const vf_p_shadowMap = 
`

	struct shadowUniforms
	{
		modelMatrix : mat4x4f,
		lightViewProjMat : mat4x4f,
	}
	
	@group(0) @binding(0) var<uniform> UBO: shadowUniforms;

	struct VertexInput {
		@location(0) pos: vec3f,
		@location(1) uv: vec2f,
		@location(2) norm: vec3f,
	};
	
	struct VertexOutput {				
		@builtin(position) pos: vec4f,
	};
	
	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {	
		var output: VertexOutput;
		output.pos = UBO.lightViewProjMat * UBO.modelMatrix * vec4(input.pos, 1.0);
    
		return output;
	}
	
	

`;