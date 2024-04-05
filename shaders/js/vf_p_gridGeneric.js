export const vf_p_gridGeneric = 
`
	@group(0) @binding(0) var<uniform> grid: vec2f;
	
	@vertex
	fn vertexMain(@location(0) pos: vec2f, @builtin(instance_index) instance: u32) -> //instance_index is 32bit num 0 to instances from draw call
		@builtin(position) vec4f {	
												// "let" in WGSL behaves like const, "var" in wgsl is for changable variables
		let i = f32(instance);								// convert to float
		let cell = vec2f(i % grid.x, floor(i / grid.x));	// Cell(1,1) of grid
		let cellOffset = cell / grid * 2;					// offset to cell
		let gridPos = (pos + 1) / grid - 1 + cellOffset;	
		return vec4f(gridPos, 0, 1); 
	}
	
	@fragment
	fn fragmentMain() -> @location(0) vec4f {
		 return vec4f(1,0,0,1);
	}
`;