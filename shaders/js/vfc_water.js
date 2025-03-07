import { settings } from '../../code/settings.js';

export const WATER_WORKGROUP_SIZE = [32, 1, 1];	//stick to 1 for now to get understanding

export const c_water = 
`
	struct WaterSpaces
	{
		modelViewProjectionMatrix : mat4x4f,
	}
	@group(0) @binding(0) var<uniform> Spaces: WaterSpaces;
	
	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveHieght: f32,	
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
	};
	@group(0) @binding(1) var<uniform> WU: WaterUniforms;
	
	
	//remember hidden padding, just use this struct for math and variables
	//	kept as vec4f to do matrix mult easier
	struct Vertex {
		pos: vec4f,
		uv: vec2f,
		norm: vec4f,
	};
	
	@group(0) @binding(2) var<storage, read_write> waterVertexData: array<f32>;

@compute @workgroup_size(${WATER_WORKGROUP_SIZE[0]}, ${WATER_WORKGROUP_SIZE[1]}, ${WATER_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		
		var gIndex = GlobalIvocationID.x;
		
		let fPerVertexData = u32(3 + 2 + 3);
		
		let waterPlaneNumberOfTriangles = ((WU.resolution - 1) * (WU.resolution - 1)) / 2;	//	(res - 1) * (res - 1) is the amount of cells in a grid. IE 5 points by 5 points is a 16 cell grid, where a cell is made of 4 points
																							//			then divide by triangles per cell, 2
	}
`;

export const v_water =
`
	//TODO: remove this after the input from compute shader comes in!!!!!!!!!!!!!
	//			at that point, we wont have to do modelViewProjections at all, its just read already adjusted vertex data and output
	struct WaterUniforms 
	{
		modelViewProjectionMatrix : mat4x4f,
	}
	@group(0) @binding(0) var<uniform> UBO: WaterUniforms;
		
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
    	
    output.fragPos = output.pos;
	output.fragNormal = input.norm;
    output.fragUV = input.uv;
    
    return output;
	}
`;

export const f_water =
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
		
		return vec4f(input.fragUV.x,input.fragUV.y,0.0,1.0);
	}
`;