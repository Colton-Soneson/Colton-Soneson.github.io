export const WORKGROUP_SIZE = 8;	//this will make 8 x 8 x 1 groups (keeping it 64 is generally good, so 4 x 4 x 4 also is nice)

export const c_gridSim = 
`
	@group(0) @binding(0) var<uniform> grid: vec2f;
	
	@group(0) @binding(1) var<storage> cellStateIn: array<u32>;
	@group(0) @binding(2) var<storage, read_write> cellStateOut: array<u32>;
	
	fn cellIndex(cell: vec2u) -> u32 {
		//outside of bounds preventability, this is how wrap around is done
		return (cell.y % u32(grid.y)) * u32(grid.x) +
         (cell.x % u32(grid.x));
	}
	
	fn cellActive(x: u32, y: u32) -> u32 {
		return cellStateIn[cellIndex(vec2(x, y))];
	}
	
    @compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})	
    fn computeMain(
		@builtin(global_invocation_id) cell: vec3u		//tells where in grid of shader invocations
		) 
	{
		// Determine how many active neighbors this cell has.
		let activeNeighbors = cellActive(cell.x+1, cell.y+1) +
                        cellActive(cell.x+1, cell.y) +
                        cellActive(cell.x+1, cell.y-1) +
                        cellActive(cell.x, cell.y-1) +
                        cellActive(cell.x-1, cell.y-1) +
                        cellActive(cell.x-1, cell.y) +
                        cellActive(cell.x-1, cell.y+1) +
                        cellActive(cell.x, cell.y+1);
		
		let i = cellIndex(cell.xy);

		// Conway's game of life rules:
		switch activeNeighbors 
		{
			case 2: { // Active cells with 2 neighbors stay active.
				cellStateOut[i] = cellStateIn[i];
			}
			case 3: { // Cells with 3 neighbors become or stay active.
				cellStateOut[i] = 1;
			}
			default: { // Cells with < 2 or > 3 neighbors become inactive.
				cellStateOut[i] = 0;
			}
		}
		
		
		// New lines. Flip the cell state every step.
		//if (cellStateIn[cellIndex(cell.xy)] == 1) {
		//	cellStateOut[cellIndex(cell.xy)] = 0;
		//} else {
		//	cellStateOut[cellIndex(cell.xy)] = 1;
		//}
    }
	

`;