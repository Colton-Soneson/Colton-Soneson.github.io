export const SSS_BUFFER_SIZE = 1000;
export const SSS_WORKGROUP_SIZE = [64, 1, 1];

export const c_SSS = 
`
@group(0) @binding(1) var texture : texture_storage_2d<rgba8unorm, read_write>;

@compute @workgroup_size(${SSS_WORKGROUP_SIZE[0]}, ${SSS_WORKGROUP_SIZE[1]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>,
		@builtin(workgroup_id) WorkGroupID : vec3u,
		@builtin(local_invocation_id) LocalInvocationID : vec3u
	) {
		
	}
`;