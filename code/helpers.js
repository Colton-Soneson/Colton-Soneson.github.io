import { settings } from '../../code/settings.js';

export const HELPERS_FULL_SCREEN = [8, 8, 1];

export const c_RGBA32F_to_F32ARRAY =
`
	struct HelperUniforms {
		@location(1) textureSize: vec2f
	};
	@group(0) @binding(0) var<uniform> HU: HelperUniforms;
	
	@group(0) @binding(1) var inTexture : texture_storage_2d<rgba32float, read>;
	@group(0) @binding(2) var<storage, read_write> outArray: array<f32>;

	@compute @workgroup_size(${HELPERS_FULL_SCREEN[0]}, ${HELPERS_FULL_SCREEN[1]}, ${HELPERS_FULL_SCREEN[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		let gIndex = GlobalInvocationID.xy;	
		
		let pull = textureStorage(inTexture, gIndex);
		
		let singleDimensionIndex = gIndex.x * + gIndex.y;
		
		outArray[ + 0] = pull.x;
		outArray[ + 1] = pull.y;
		outArray[ + 2] = pull.z;
		outArray[ + 3] = pull.w;
	}
`;