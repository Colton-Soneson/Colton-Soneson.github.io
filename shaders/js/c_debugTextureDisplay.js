export const DEBUGTEXTURE_WORKGROUP_SIZE = [16, 16, 1];

export const c_DebugTexture_RGBA8UNORM = 
`
struct DebugTextureUniforms {
	@location(0) canvasSize: vec2f,
	@location(1) textureSize: vec2f,
	@location(2) mapRange: f32,
	@location(3) rescale: f32,
	@location(4) scroll: vec2f,		// how far the texture has slid across the view, in its own texels. It wraps round
	@location(5) redOnly: f32,		// 1.0 shows the red channel alone, as grey
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
		
		// fixed display size in screen pixels (top-left region)
        let displayWidth  = u32(DTU.rescale);
        let displayHeight = u32(DTU.rescale);
		let startX = width - displayWidth;

        // only process threads within the display region
        if (threadID.x < startX || threadID.y >= displayHeight) {
            // outside display region — write canvas pixel through unchanged
            var passthrough = textureLoad(inCanvasTexture, threadID);
            textureStore(outTexture, threadID, passthrough);
            return;
        }

        // exact normalized UV within the display region
        let u = f32(threadID.x - startX) / f32(displayWidth);
        let v = f32(threadID.y) / f32(displayHeight);

        // map UV to exact texel in source texture
		//		(slid back by the scroll: what was at the left edge is now that many texels in)
        let texX = (u32(u * f32(texWidth)) + texWidth - u32(DTU.scroll.x) % texWidth) % texWidth;
        let texY = (u32(v * f32(texHeight)) + texHeight - u32(DTU.scroll.y) % texHeight) % texHeight;

        var inputDebugCol = textureLoad(inDebugTexture, vec2<u32>(texX, texY));

        var outCol = inputDebugCol;
        if (DTU.redOnly > 0.5) {
            outCol = vec4f(outCol.r, outCol.r, outCol.r, 1.0);
        } else if (all(outCol == vec4f(0.0, 0.0, 0.0, 0.0))) {
            outCol = textureLoad(inCanvasTexture, threadID);
        }

        textureStore(outTexture, threadID, outCol);
	}
`;

export const c_DebugTexture_RGBA32FLOAT = 
`
struct DebugTextureUniforms {
	@location(0) canvasSize: vec2f,
	@location(1) textureSize: vec2f,
	@location(2) mapRange: f32,
	@location(3) rescale: f32,
};
@group(0) @binding(0) var<uniform> DTU: DebugTextureUniforms;

@group(0) @binding(1) var outTexture : texture_storage_2d<rgba8unorm, write>;

@group(0) @binding(2) var inCanvasTexture : texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(3) var inDebugTexture : texture_storage_2d<rgba32float, read>;

@compute @workgroup_size(${DEBUGTEXTURE_WORKGROUP_SIZE[0]}, ${DEBUGTEXTURE_WORKGROUP_SIZE[1]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		let threadID = vec2<u32>(GlobalIvocationID.x, GlobalIvocationID.y);
		
		let width = u32(DTU.canvasSize.x);  // Canvas width
        let height = u32(DTU.canvasSize.y); // Canvas height
        let texWidth = u32(DTU.textureSize.x);  // Texture width
        let texHeight = u32(DTU.textureSize.y); // Texture height
		
		let displayWidth  = u32(DTU.rescale);
        let displayHeight = u32(DTU.rescale);

        let startX = width - displayWidth;

        if (threadID.x < startX || threadID.y >= displayHeight) {
            var passthrough = textureLoad(inCanvasTexture, threadID);
            textureStore(outTexture, threadID, passthrough);
            return;
        }

        let u = f32(threadID.x - startX) / f32(displayWidth);
        let v = f32(threadID.y)           / f32(displayHeight);

        let texX = u32(u * f32(texWidth));
        let texY = u32(v * f32(texHeight));

        var inputDebugCol = textureLoad(inDebugTexture, vec2<u32>(texX, texY));

        var outCol = inputDebugCol;
        if (all(outCol == vec4f(0.0, 0.0, 0.0, 0.0))) {
            outCol = textureLoad(inCanvasTexture, threadID);
        }

        textureStore(outTexture, threadID, outCol);
	}
`;

export const c_DebugTexture_RGBA16FLOAT = 
`
struct DebugTextureUniforms {
	@location(0) canvasSize: vec2f,
	@location(1) textureSize: vec2f,
	@location(2) mapRange: f32,
	@location(3) rescale: f32,
};
@group(0) @binding(0) var<uniform> DTU: DebugTextureUniforms;

@group(0) @binding(1) var outTexture : texture_storage_2d<rgba8unorm, write>;

@group(0) @binding(2) var inCanvasTexture : texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(3) var inDebugTexture : texture_storage_2d<rgba16float, read>;

@compute @workgroup_size(${DEBUGTEXTURE_WORKGROUP_SIZE[0]}, ${DEBUGTEXTURE_WORKGROUP_SIZE[1]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		let threadID = vec2<u32>(GlobalIvocationID.x, GlobalIvocationID.y);
		
		let width = u32(DTU.canvasSize.x);  // Canvas width
        let height = u32(DTU.canvasSize.y); // Canvas height
        let texWidth = u32(DTU.textureSize.x);  // Texture width
        let texHeight = u32(DTU.textureSize.y); // Texture height
		
		let displayWidth  = u32(DTU.rescale);
        let displayHeight = u32(DTU.rescale);

        let startX = width - displayWidth;

        if (threadID.x < startX || threadID.y >= displayHeight) {
            var passthrough = textureLoad(inCanvasTexture, threadID);
            textureStore(outTexture, threadID, passthrough);
            return;
        }

        let u = f32(threadID.x - startX) / f32(displayWidth);
        let v = f32(threadID.y)           / f32(displayHeight);

        let texX = u32(u * f32(texWidth));
        let texY = u32(v * f32(texHeight));

        var inputDebugCol = textureLoad(inDebugTexture, vec2<u32>(texX, texY));

        var outCol = inputDebugCol;
        if (all(outCol == vec4f(0.0, 0.0, 0.0, 0.0))) {
            outCol = textureLoad(inCanvasTexture, threadID);
        }

        textureStore(outTexture, threadID, outCol);
	}
`;

export const c_DebugTexture_R32FLOAT =
`
struct DebugTextureUniforms {
	@location(0) canvasSize: vec2f,
	@location(1) textureSize: vec2f,
	@location(2) mapRange: f32,
	@location(3) rescale: f32,
};
@group(0) @binding(0) var<uniform> DTU: DebugTextureUniforms;

@group(0) @binding(1) var outTexture : texture_storage_2d<rgba8unorm, write>;

@group(0) @binding(2) var inCanvasTexture : texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(3) var inDebugTexture : texture_storage_2d<r32float, read>;

@compute @workgroup_size(${DEBUGTEXTURE_WORKGROUP_SIZE[0]}, ${DEBUGTEXTURE_WORKGROUP_SIZE[1]})
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		let threadID = vec2<u32>(GlobalIvocationID.x, GlobalIvocationID.y);

		let width = u32(DTU.canvasSize.x);  // Canvas width
        let height = u32(DTU.canvasSize.y); // Canvas height
        let texWidth = u32(DTU.textureSize.x);  // Texture width
        let texHeight = u32(DTU.textureSize.y); // Texture height

		let displayWidth  = u32(DTU.rescale);
        let displayHeight = u32(DTU.rescale);

        let startX = width - displayWidth;

        if (threadID.x < startX || threadID.y >= displayHeight) {
            var passthrough = textureLoad(inCanvasTexture, threadID);
            textureStore(outTexture, threadID, passthrough);
            return;
        }

        let u = f32(threadID.x - startX) / f32(displayWidth);
        let v = f32(threadID.y)           / f32(displayHeight);

        let texX = u32(u * f32(texWidth));
        let texY = u32(v * f32(texHeight));

        // the one channel holds a raw value, mapRange scales it down so the expected range shows as black to white
        var inputValue = textureLoad(inDebugTexture, vec2<u32>(texX, texY)).x * DTU.mapRange;

        var outCol = vec4f(inputValue, inputValue, inputValue, 1.0);

        textureStore(outTexture, threadID, outCol);
	}
`;

export const c_DebugTexture_DEPTH32FLOAT = 
`
struct DebugTextureUniforms {
	@location(0) canvasSize: vec2f,
	@location(1) textureSize: vec2f,
	@location(2) mapRange: f32,
	@location(3) rescale: f32,
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
		
		let displayWidth  = u32(DTU.rescale);
        let displayHeight = u32(DTU.rescale);

        let startX = width - displayWidth;

        if (threadID.x < startX || threadID.y >= displayHeight) {
            var passthrough = textureLoad(inCanvasTexture, threadID);
            textureStore(outTexture, threadID, passthrough);
            return;
        }

        let u = f32(threadID.x - startX) / f32(displayWidth);
        let v = f32(threadID.y)           / f32(displayHeight);

        let texX = u32(u * f32(texWidth));
        let texY = u32(v * f32(texHeight));

        var inputDepth = textureLoad(inDebugTextureDepth, vec2<u32>(texX, texY), 0);

        var outCol = vec4f(inputDepth * DTU.mapRange, 0.0, 0.0, 1.0);

        if (all(outCol == vec4f(0.0, 0.0, 0.0, 1.0))) {
            outCol = textureLoad(inCanvasTexture, threadID);
        }

        textureStore(outTexture, threadID, outCol);
	}
`;