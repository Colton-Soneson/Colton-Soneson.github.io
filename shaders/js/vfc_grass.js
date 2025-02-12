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
	
	
	//remember hidden padding, just use this struct for math and variables
	//	kept as vec4f to do matrix mult easier
	struct Vertex {
		pos: vec4f,
		uv: vec2f,
		norm: vec4f,
	};
	
	@group(0) @binding(2) var<storage, read> singleBladeVertexData: array<f32>;
	@group(0) @binding(3) var<storage, read_write> totalGrassVertexData: array<f32>;


@compute @workgroup_size(${GRASS_WORKGROUP_SIZE[0]}, ${GRASS_WORKGROUP_SIZE[1]}, ${GRASS_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		
		var bladeIndex = GlobalIvocationID.x;
		let replicationCount = u32(GU.totalBladeCount);
		
		let vertexDataPerBlade = u32(arrayLength(&singleBladeVertexData));
		let fPerVertexData = u32(3 + 2 + 3);
		let bladeTotalSize = vertexDataPerBlade * fPerVertexData;	//total floats in the whole thing
				
		if(bladeIndex >= replicationCount) {
			return;
		}
		
		var translate = vec4f(f32(bladeIndex) * 0.25,0.0,0.0,0.0);
		
		for(var vd = 0u; vd < vertexDataPerBlade / fPerVertexData; vd++) {
			
			//index
			let iVertInd = vd * fPerVertexData;
			let oVertInd = (bladeIndex * vertexDataPerBlade) + iVertInd;
			
			var resultVert = Vertex(vec4f(singleBladeVertexData[iVertInd + 0], singleBladeVertexData[iVertInd + 1], singleBladeVertexData[iVertInd + 2], 1.0),
									vec2f(singleBladeVertexData[iVertInd + 3], singleBladeVertexData[iVertInd + 4]),
									vec4f(singleBladeVertexData[iVertInd + 5], singleBladeVertexData[iVertInd + 6], singleBladeVertexData[iVertInd + 7], 1.0));
			
			resultVert.pos += translate;
			
			totalGrassVertexData[oVertInd + 0] = resultVert.pos.x;
			totalGrassVertexData[oVertInd + 1] = resultVert.pos.y;
			totalGrassVertexData[oVertInd + 2] = resultVert.pos.z;
			totalGrassVertexData[oVertInd + 3] = resultVert.uv.x;
			totalGrassVertexData[oVertInd + 4] = resultVert.uv.y;
			totalGrassVertexData[oVertInd + 5] = resultVert.norm.x;
			totalGrassVertexData[oVertInd + 6] = resultVert.norm.y;
			totalGrassVertexData[oVertInd + 7] = resultVert.norm.z;
		
		}
		
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