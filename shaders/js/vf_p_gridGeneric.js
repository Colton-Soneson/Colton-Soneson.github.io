export const vf_p_gridGeneric = 
`
	@group(0) @binding(0) var<uniform> grid: vec2f;

	struct VertexInput {
		@location(0) pos: vec2f,
		@builtin(instance_index) instance: u32,	//instance_index is 32bit num 0 to instances from draw call
	};
	
	struct VertexOutput {				//into frag
		@builtin(position) pos: vec4f,
		@location(0) cell: vec2f,
	};
	
	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {	
												// "let" in WGSL behaves like const, "var" in wgsl is for changable variables
		let i = f32(input.instance);								// convert to float
		let cell = vec2f(i % grid.x, floor(i / grid.x));	// Cell(1,1) of grid
		let cellOffset = cell / grid * 2;					// offset to cell
		let gridPos = (input.pos + 1) / grid - 1 + cellOffset;	
		
		var output: VertexOutput;
		output.pos = vec4f(gridPos, 0, 1);
		output.cell = cell;
		return output;
	}
	
	struct FragInput {
		@location(0) cell: vec2f,
	};

	
	@fragment
	fn fragmentMain(input: FragInput) -> //could also use input: VertexOutput instead because its contained within the same file here
		@location(0) vec4f {
		
		let c = input.cell/grid;
		return vec4f(c, 1-c.x, 1);
	}
`;