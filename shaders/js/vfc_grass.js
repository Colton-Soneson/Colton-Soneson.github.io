import { settings } from '../../code/settings.js';

export const GRASS_BUFFER_SIZE = 1000;
export const GRASS_WORKGROUP_SIZE = [16, 1, 1];

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
	
	@group(0) @binding(3) var<storage, read_write> totalGrassVertexData: array<VertexData>;

@compute @workgroup_size(${GRASS_WORKGROUP_SIZE[0]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		//1) create clump
		//2) apply curves to each blade in each clump
		//3) animate each clump
		//4) disperse each clump
		
		
		//for now, just take the single blade input, and output it to its index position in totalGrassVertexData
		//		this is a 1-1 transaction, no loops to fill multiple points.
		//		the DispatchWorkgroups call should be done enough times to then FILL this list of totalGrassVertexData, exactly
		//			good test is 1024 blades, 16 workgroup size, leaving an exact 64 workgroup runs
		
		let myMat = mat4x4f(
							1, 0, 0, 0,
							0, 1, 0, 0, 
							0, 0, 1, 0,
							0, 0, 0, 1,
							);
		
		//let outputPos = myMat * vec4f(singleBladeVertexData[GlobalIvocationID.x].pos.xyz + vec3f(-1,-1,0.0), 1.0);
		//let outputPos = vec4f(singleBladeVertexData[GlobalIvocationID.x].pos.xyz + vec3f(-1,-1,0.0), 1.0);
		//let outputPos = singleBladeVertexData[GlobalIvocationID.x].pos;
		
		let outputPos = Spaces.modelViewProjectionMatrix * vec4f(singleBladeVertexData[GlobalIvocationID.x].pos.xyz, 1.0);

		
		let temp = VertexData(outputPos.xyz,
								singleBladeVertexData[GlobalIvocationID.x].uv,
								singleBladeVertexData[GlobalIvocationID.x].norm);
		
		totalGrassVertexData[GlobalIvocationID.x] = temp;
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
    //output.pos = UBO.modelViewProjectionMatrix * vec4f(input.pos.x, input.pos.y, input.pos.z, 1.0);
    
	//INSTANCE TEST
	//output.pos = UBO.modelViewProjectionMatrix * vec4f(input.pos.x + UBO.guPositions[input.instanceIdx].x, 
	//																		input.pos.y + UBO.guPositions[input.instanceIdx].y, 
	//																		input.pos.z + UBO.guPositions[input.instanceIdx].z, 
	//																		1.0);
	
	output.pos = vec4f(input.pos.xyz, 1.0);
	
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