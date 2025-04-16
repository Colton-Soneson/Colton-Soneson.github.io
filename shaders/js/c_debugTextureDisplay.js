export const DEBUGTEXTURE_WORKGROUP_SIZE = [16, 16, 1];

export const c_DebugTexture_RGBA8UNORM = 
`
struct DebugTextureUniforms {
	@location(0) canvasSize: vec2f,
	@location(1) textureSize: vec2f,
	@location(2) mapRange: f32,
};
@group(0) @binding(0) var<uniform> DTU: DebugTextureUniforms;

@group(0) @binding(1) var outTexture : texture_storage_2d<rgba8unorm, write>;

@group(0) @binding(2) var inCanvasTexture : texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(3) var inDebugTexture : texture_storage_2d<rgba8unorm, read>;

@compute @workgroup_size(${DEBUGTEXTURE_WORKGROUP_SIZE[0]}, ${DEBUGTEXTURE_WORKGROUP_SIZE[1]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		let threadID = vec2<u32>(GlobalIvocationID.x, GlobalIvocationID.y);
		
		let width = u32(DTU.canvasSize.x);  // Canvas width
        let height = u32(DTU.canvasSize.y); // Canvas height
        let texWidth = u32(DTU.textureSize.x);  // Texture width
        let texHeight = u32(DTU.textureSize.y); // Texture height
		
		// Calculate the position in the bottom right corner of the screen
        let x = width - texWidth + (threadID.x % texWidth);
        let y = height - texHeight + (threadID.y % texHeight);

        // Sample the texture at this position
        let texCoord = vec2<f32>(f32(x % texWidth), f32(y % texHeight)) / vec2<f32>(f32(texWidth), f32(texHeight));
		
		//read input texture
		var inputCanvasCol = textureLoad(inCanvasTexture, vec2<u32>(threadID.x, threadID.y));
		
		//this assumes right now to scale by the full screen size, so at maximum the texture can be the size of our canvas
		var scaleMult = 1f;
		
		if(texWidth >= width || texHeight >= height) {
			scaleMult = 4f;
		}
		else if (texWidth >= (width / 2u) || texHeight >= (height / 2u)) {
			scaleMult = 2f;
		}
		else if (texWidth >= (width / 4u) || texHeight >= (height / 4u)) {
			scaleMult = 1f;
		}
		else if (texWidth >= (width / 8u) || texHeight >= (height / 8u)) {
			scaleMult = 0.5f;
		}
		
		var inputDebugCol = textureLoad(inDebugTexture, vec2<u32>(u32(f32(threadID.x) * scaleMult), u32(f32(threadID.y) * scaleMult)));
	
		var outCol = inputDebugCol;
		if(all(outCol == vec4f(0.0,0.0,0.0,0.0))) {
			outCol = inputCanvasCol;
		}
		
		//write to output
		textureStore(outTexture, threadID, outCol);
	}
`;

export const c_DebugTexture_DEPTH32FLOAT = 
`
struct DebugTextureUniforms {
	@location(0) canvasSize: vec2f,
	@location(1) textureSize: vec2f,
	@location(2) mapRange: f32,
};
@group(0) @binding(0) var<uniform> DTU: DebugTextureUniforms;

@group(0) @binding(1) var outTexture : texture_storage_2d<rgba8unorm, write>;

@group(0) @binding(2) var inCanvasTexture : texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(3) var inDebugTextureDepth: texture_depth_2d;
@group(0) @binding(4) var inDebugTextureDepthSampler: sampler;

@compute @workgroup_size(${DEBUGTEXTURE_WORKGROUP_SIZE[0]}, ${DEBUGTEXTURE_WORKGROUP_SIZE[1]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		let threadID = vec2<u32>(GlobalIvocationID.x, GlobalIvocationID.y);
		
		let width = u32(DTU.canvasSize.x);  // Canvas width
        let height = u32(DTU.canvasSize.y); // Canvas height
        let texWidth = u32(DTU.textureSize.x);  // Texture width
        let texHeight = u32(DTU.textureSize.y); // Texture height
		
		// Calculate the position in the bottom right corner of the screen
        let x = width - texWidth + (threadID.x % texWidth);
        let y = height - texHeight + (threadID.y % texHeight);

        // Sample the texture at this position
        let texCoord = vec2<f32>(f32(x % texWidth), f32(y % texHeight)) / vec2<f32>(f32(texWidth), f32(texHeight));
		
		//read input texture
		var inputCanvasCol = textureLoad(inCanvasTexture, vec2<u32>(threadID.x, threadID.y));
		
		//this assumes right now to scale by the full screen size, so at maximum the texture can be the size of our canvas
		var inputDebugCol = textureLoad(inDebugTextureDepth, vec2<u32>(threadID.x * 4, threadID.y * 4), 0);
		
		var outCol = vec4f(inputDebugCol * DTU.mapRange,0.0,0.0,1.0);
		
		if(all(outCol == vec4f(0.0,0.0,0.0,1.0))) {
			outCol = inputCanvasCol;
		}
		
		//write to output
		textureStore(outTexture, threadID, outCol);
	}
`;