export const v_shadowMapDepth = 
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