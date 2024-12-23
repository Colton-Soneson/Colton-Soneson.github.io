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
		normalMatrix : mat4x4f,
	}
	
	struct LightsUniforms
	{
		sunPos : vec4f,
		sunCol : vec4f,
		sunIntensity : f32,
	}
	
	@group(0) @binding(0) var<uniform> UBO: SpacesUniforms;
	@group(0) @binding(1) var<uniform> Lights: LightsUniforms;
	
	struct VertexInput {
		@location(0) pos: vec3f,
		@location(1) uv: vec3f,
		@location(2) norm: vec3f,
	};
	
	struct VertexOutput {				//into frag
		@builtin(position) pos: vec4f,
		@location(0) fragUV: vec2f,
		@location(1) fragPos: vec4f,
		@location(2) light: f32,
		@location(3) test: vec4f,
	};
	
	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {	
		
		var output: VertexOutput;
		output.pos = UBO.modelViewProjectionMatrix * vec4f(input.pos.x, input.pos.y, input.pos.z, 1);
		output.fragUV = vec2f(0,0);
		output.fragPos = 0.5 * (vec4f(input.pos.x, input.pos.y, input.pos.z, 1) + vec4f(1.0,1.0,1.0,1.0));
		
		//light
		let lightPos = Lights.sunPos;
		let diffuseStrength = 1.2;
		let ambient = 0.01;
		
		//test
		
		
		let vNormal = normalize(UBO.normalMatrix * vec4f(input.norm.x, input.norm.y, input.norm.z, 1.0));
		let lightDir = normalize(lightPos.xyz - output.fragPos.xyz);  
		let lightMag = dot(vNormal.xyz, lightDir);
		let diff : f32 = diffuseStrength * max(lightMag, 0.0);
		
		output.light = diff + ambient;
		
		output.test = vNormal;
		
		return output;
	}
	
	@group(0) @binding(2) var mySampler: sampler;
	@group(0) @binding(3) var myTexture: texture_2d<f32>;
	
	//same as vertexoutput without builtin bits
	struct FragInput {
		@location(0) fragUV: vec2f,
		@location(1) fragPos: vec4f,
		@location(2) light: f32,
		@location(3) test: vec4f,
	};

	
	@fragment
	fn fragmentMain(input: FragInput) -> //could also use input: VertexOutput instead because its contained within the same file here
		@location(0) vec4f {
					
		//return vec4f(input.light, input.light, input.light, 1.0);
		return input.test * 4.5;
	}
`;