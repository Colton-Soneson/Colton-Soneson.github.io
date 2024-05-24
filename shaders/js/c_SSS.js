export const SSS_BUFFER_SIZE = 1000;
export const SSS_WORKGROUP_SIZE = [64, 1, 1];

export const c_SSS = 
`
@compute @workgroup_size(${SSS_WORKGROUP_SIZE[0]}, ${SSS_WORKGROUP_SIZE[1]})	
    fn computeMain() {
		
	}
`;