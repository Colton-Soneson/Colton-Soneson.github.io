import { settings } from '../../code/settings.js';

export const GRASS_BUFFER_SIZE = 10000;
export const GRASS_WORKGROUP_SIZE = [16, 1, 1];	//stick to 1 for now to get understanding

export const c_grass = 
`
	struct GrassSpaces
	{
		modelViewProjectionMatrix : mat4x4f,
	}
	@group(0) @binding(0) var<uniform> Spaces: GrassSpaces;
	
	struct GrassUniforms {
		@location(0) totalBladeCount: f32,
		@location(1) density: f32,
	};
	@group(0) @binding(1) var<uniform> GU: GrassUniforms;
	
	
	struct VertexData {
		//has to match that of scene
		pos: vec3f,
		uv: vec2f,
		norm: vec3f,
	};
	@group(0) @binding(2) var<storage, read> singleBladeVertexData: array<VertexData>;
	
	@group(0) @binding(3) var<storage, read_write> totalGrassVertexData: array<f32>;

@compute @workgroup_size(${GRASS_WORKGROUP_SIZE[0]}, ${GRASS_WORKGROUP_SIZE[1]}, ${GRASS_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		
		var bladeIndex = GlobalIvocationID.x;
		let replicationCount = u32(GU.totalBladeCount);
		
		//let verticesPerBlade = u32(arrayLength(&singleBladeVertexData));
		////let vertexIndex = bladeIndex % verticesPerBlade;
		//
		//let replicationFinalVertexIndex = bladeIndex * verticesPerBlade;
		//
		//if(bladeIndex >= replicationCount) {
		//	return;
		//}
		//
		////loop to go through every vertexData in singleBladeVertexData
		//for(var singleBladeVertexDataIndex = 0u; singleBladeVertexDataIndex < verticesPerBlade; singleBladeVertexDataIndex++) {
		//	
		//	//translation to be made 
		//	let translation = vec3f(5.0,0.0,0.0);
		//	let outputPos = singleBladeVertexData[singleBladeVertexDataIndex].pos + translation;
		//
		//	//take a single vertexData from the singleBladeVertexData array, and adjust its TRS
		//	let temp = VertexData(outputPos.xyz,
		//							singleBladeVertexData[singleBladeVertexDataIndex].uv,
		//							singleBladeVertexData[singleBladeVertexDataIndex].norm);
		//	
		//	//our current blade of grass, copying all the data of singleBladeVertexData when this loop completes
		//	//	make sure to leave adjustment in position for the next blade of grass (replicationFinalVertexIndex)
		//	totalGrassVertexData[replicationFinalVertexIndex + singleBladeVertexDataIndex] = temp;
		//}
		
		
		//MAKE A FUCKING TRIANGLE AND REPLICATE TO SEE WHAT THE FUCK IS UP
		
		//KEEP THIS, it quits the workgroup
		if(bladeIndex > replicationCount) {
			return;
		}
		
		var translatex = f32(bladeIndex) + 2.0;
		
		let triangleTotalSize = 24u;
		
		//first pos
		totalGrassVertexData[bladeIndex * triangleTotalSize + 0] = 0 + translatex;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 1] = 0.5;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 2] = 0;
		
		//second pos
		totalGrassVertexData[bladeIndex * triangleTotalSize + 8] = -0.5 + translatex;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 9] = -0.5;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 10] = 0;
		
		//third pos
		totalGrassVertexData[bladeIndex * triangleTotalSize + 16] = 0.5 + translatex;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 17] = -0.5;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 18] = 0;
		
		//first uv
		totalGrassVertexData[bladeIndex * triangleTotalSize + 3] = 0.5;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 4] = 1;
		
		//second uv
		totalGrassVertexData[bladeIndex * triangleTotalSize + 11] = 0;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 12] = 0;
		
		//third uv
		totalGrassVertexData[bladeIndex * triangleTotalSize + 19] = 1;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 20] = 0;
		
		//first norm
		totalGrassVertexData[bladeIndex * triangleTotalSize + 5] = 0;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 6] = 0;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 7] = 1;
		
		//second norm
		totalGrassVertexData[bladeIndex * triangleTotalSize + 13] = 0;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 14] = 0;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 15] = 1;
		
		//third norm
		totalGrassVertexData[bladeIndex * triangleTotalSize + 21] = 0;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 22] = 0;
		totalGrassVertexData[bladeIndex * triangleTotalSize + 23] = 1;
		
	}
`;

export const v_grass =
`
	//TODO: remove this after the input from compute shader comes in!!!!!!!!!!!!!
	//			at that point, we wont have to do modelViewProjections at all, its just read already adjusted vertex data and output
	struct GrassUniforms 
	{
		modelViewProjectionMatrix : mat4x4f,
	}
	@group(0) @binding(0) var<uniform> UBO: GrassUniforms;
		
	struct VertexInput {
		@builtin(instance_index) instanceIdx : u32,
		@location(0) pos: vec3f,
		@location(1) uv: vec2f,
		@location(2) norm: vec3f,
	};
	
	struct VertexOutput {				//into frag
		@builtin(position) pos: vec4f,
		@location(0) fragUV: vec2f,
		@location(1) fragPos: vec4f,
		@location(2) fragNormal: vec3f,
	};
	
	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {	
	
	var output: VertexOutput;
    output.pos = UBO.modelViewProjectionMatrix * vec4f(input.pos.x, input.pos.y, input.pos.z, 1.0);
    
	//INSTANCE TEST
	//output.pos = UBO.modelViewProjectionMatrix * vec4f(input.pos.x + UBO.guPositions[input.instanceIdx].x, 
	//																		input.pos.y + UBO.guPositions[input.instanceIdx].y, 
	//																		input.pos.z + UBO.guPositions[input.instanceIdx].z, 
	//																		1.0);
	
	//output.pos = vec4f(input.pos.xyz, 1.0);
	
    output.fragPos = output.pos;
	output.fragNormal = input.norm;
    output.fragUV = input.uv;
    
    return output;
	}
`;

export const f_grass =
`
	//same as vertexoutput without builtin bits
	struct FragInput {
		@location(0) fragUV: vec2f,
		@location(1) fragPos: vec4f,
		@location(2) fragNormal: vec3f,
	};

	
	@fragment
	fn fragmentMain(input: FragInput) -> //could also use input: VertexOutput instead because its contained within the same file here
		@location(0) vec4f {
		
		return vec4f(0.0,1.0,0.0,1.0);
	}
`;