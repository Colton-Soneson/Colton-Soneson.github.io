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