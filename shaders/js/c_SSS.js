export const SSS_BUFFER_SIZE = 1000;
export const SSS_WORKGROUP_SIZE = [16, 16, 1];

export const c_SSS = 
`
@group(0) @binding(1) var outTexture : texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var inTexture : texture_storage_2d<rgba8unorm, read>;

//@group(0) @binding(2) var inTexture : texture_2d<f32>;
//@group(0) @binding(3) var mySampler : sampler;

@compute @workgroup_size(${SSS_WORKGROUP_SIZE[0]}, ${SSS_WORKGROUP_SIZE[1]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		let threadID = vec2<u32>(GlobalIvocationID.x, GlobalIvocationID.y);
		
		//read input texture
		var inputCol = textureLoad(inTexture, vec2<u32>(threadID.x, threadID.y));
		
		inputCol *= vec4f(1.0,0.0,0.0,1.0);
		
		//write to output
		textureStore(outTexture, threadID, vec4<f32>(inputCol.r,inputCol.g,inputCol.b,1.0));
	}
`;