export const GRASS_BUFFER_SIZE = 1000;
export const GRASS_WORKGROUP_SIZE = [32, 32, 1];

export const c_grass = 
`
@compute @workgroup_size(${GRASS_WORKGROUP_SIZE[0]}, ${GRASS_WORKGROUP_SIZE[1]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		
	}
`;

export const v_grass =
`
	struct GrassUniforms
	{
		modelViewProjectionMatrix : mat4x4f,
		modelMatrix : mat4x4f,
		normalMatrix : mat4x4f,
	}
	@group(0) @binding(0) var<uniform> UBO: GrassUniforms;
	
	struct VertexInput {
		@location(0) pos: vec3f,
		@location(1) uv: vec2f,
		@location(2) norm: vec3f,
	};
	
	struct VertexOutput {				//into frag
		@builtin(position) pos: vec4f,
		@location(0) fragUV: vec2f,
		@location(1) fragPos: vec4f,
		@location(2) fragNormal: vec3f,
	};
	
	fn vertexMain(input: VertexInput) -> VertexOutput {	
		
	var output: VertexOutput;
    output.pos = UBO.modelViewProjectionMatrix * vec4f(input.pos.x, input.pos.y, input.pos.z, 1.0);
	
    output.fragPos = output.pos;
	output.fragNormal = input.norm;
    output.fragUV = input.uv;
    
    return output;
	}
`;

export const f_grass =
`
	//same as vertexoutput without builtin bits
	struct FragInput {
		@location(0) fragUV: vec2f,
		@location(1) fragPos: vec4f,
		@location(2) fragNormal: vec3f,
	};

	
	@fragment
	fn fragmentMain(input: FragInput) -> //could also use input: VertexOutput instead because its contained within the same file here
		@location(0) vec4f {
		
		return vec4f(0.0,1.0,0.0,1.0);
	}
`;