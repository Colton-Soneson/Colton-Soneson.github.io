import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import {postEffectPass} from './postEffectPass.js'
import * as primitives from '../models/primitives.js'

import { vf_p_generic3D } from '../shaders/js/vf_p_generic.js'

const devicePixelRatio = window.devicePixelRatio;
canvas.width = canvas.clientWidth * devicePixelRatio;
canvas.height = canvas.clientHeight * devicePixelRatio;

const vertices = primitives.pTest.vertices;
const faces = primitives.pTest.faces;
const vertDim = primitives.pTest.dimensions;
const normals = primitives.pTest.normals;
const uvs = primitives.pTest.uvs;
const numPositions = vertices / vertDim;	//actual vertex count
const vertStride = vertDim * 4;	//4 for number of bytes in a float
const normStride = vertDim * 4;	//4 for number of bytes in a float
const uvStride = 2 * 4;	//4 for number of bytes in a float
const totalStride = vertStride + uvStride + normStride;	//4 for number of bytes in a float
let step = 0; // Track how many simulation steps have been run

const aspect = canvas.width / canvas.height;
const projectionMatrix = mat4.perspective((2 * Math.PI) / 5, aspect, 1, 100.0);
const modelViewProjectionMatrix = mat4.create();

function getTransformationMatrix() {
  const viewMatrix = mat4.identity();
  mat4.translate(viewMatrix, vec3.fromValues(0, 0, -4), viewMatrix);
  const now = Date.now() / 1000;
  mat4.rotate(
    viewMatrix,
    vec3.fromValues(Math.sin(now), Math.cos(now), 0),
    1,
    viewMatrix
  );
  mat4.scale( viewMatrix, vec3.fromValues(1.05,1.05,1.05), viewMatrix);
  
  mat4.multiply(projectionMatrix, viewMatrix, modelViewProjectionMatrix);

  return modelViewProjectionMatrix;
}

//function should return GPUShaderModule object if compiled with valid results, code itself is WGSL
const genericShaderModule = device.createShaderModule({
label: "generic vf shader",
code: vf_p_generic3D
});

const positions = [];
for(let posCount = 0; posCount < (vertices.length / vertDim); posCount++)
{
	positions[posCount] = [vertices[(posCount * vertDim) + 0], vertices[(posCount * vertDim) + 1], vertices[(posCount * vertDim) + 2]];
}
console.log("---position list-----");
console.log(positions);

const uvSplitting = [];
for(let uvsCount = 0; uvsCount < (uvs.length / 2); uvsCount++)
{
	uvSplitting[uvsCount] = [uvs[(uvsCount * 2) + 0], uvs[(uvsCount * 2) + 1]];
}
console.log("---uvs list-----");
console.log(uvSplitting);

const normalSplitting = [];
for(let normCount = 0; normCount < (normals.length / vertDim); normCount++)
{
	normalSplitting[normCount] = [normals[(normCount * vertDim) + 0], normals[(normCount * vertDim) + 1], normals[(normCount * vertDim) + 2]];
}
console.log("---normals list-----");
console.log(normalSplitting);


const result = [];
//for the entire length of faces (ordered v1,vt1,vn1,v2,vt2,vn2,...) assign accordingly

//const faceList = [];
for(let faceCount = 0; faceCount < (faces.length / 3); faceCount++)	//3 for divider: v, vt, vn. If there was a vp then its 4
{
	result.push(positions[faces[(faceCount * 3) + 0] - 1][0]);
	result.push(positions[faces[(faceCount * 3) + 0] - 1][1]);
	result.push(positions[faces[(faceCount * 3) + 0] - 1][2]);
	
	result.push(uvSplitting[faces[(faceCount * 3) + 1] - 1][0]);
	result.push(uvSplitting[faces[(faceCount * 3) + 1] - 1][1]);
	
	result.push(normalSplitting[faces[(faceCount * 3) + 2] - 1][0]);
	result.push(normalSplitting[faces[(faceCount * 3) + 2] - 1][1]);
	result.push(normalSplitting[faces[(faceCount * 3) + 2] - 1][2]);
}
//{
//							//1st set locations
//	faceList[faceCount] = [faces[(faceCount * 9) + 0] - 1, 
//							faces[(faceCount * 9) + 1] - 1, 
//							faces[(faceCount * 9) + 2] - 1,
//							
//							//2nd set locations
//							faces[(faceCount * 9) + 3] - 1,
//							faces[(faceCount * 9) + 4] - 1,
//							faces[(faceCount * 9) + 5] - 1,
//							
//							//3rd set locations
//							faces[(faceCount * 8) + 6] - 1,
//							faces[(faceCount * 8) + 7] - 1,
//							faces[(faceCount * 8) + 8] - 1,
//							];
//}
//console.log("---face list-----");
//console.log(faceList);

//
//
//const result = [];
//
//for(let faceRows = 0; faceRows < (faces.length / 8); faceRows++)
//{
//	
//	result.push(positions[faceList[faceRows][0]][0]);
//	result.push(positions[faceList[faceRows][0]][1]);
//	result.push(positions[faceList[faceRows][0]][2]);
//	
//	result.push(positions[faceList[faceRows][1]][0]);
//	result.push(positions[faceList[faceRows][1]][1]);
//	result.push(positions[faceList[faceRows][1]][2]);
//
//	result.push(positions[faceList[faceRows][2]][0]);
//	result.push(positions[faceList[faceRows][2]][1]);
//	result.push(positions[faceList[faceRows][2]][2]);
//}

const vertexBufferArray = new Float32Array(result);	//triangle count by verts per tri by vert dimensions
console.log("-------Final Vertex Buffer Array-------");
console.log(vertexBufferArray);

//GPU Side memory management done through GPUBuffer objects
const vertexBuffer = device.createBuffer({
	label: "cube vertices",		//just helps to identify object, can be anything you type
	size: vertexBufferArray.byteLength,	//for 12 float vertices thats 48 bytes, cant be resized after creation
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,	//its use is for vertex data, and that you want to copy data into it
});

//copy vertex data to buffer
device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/0, vertexBufferArray);


//now tell WebGPU what the hell to do with the info
const vertexBufferLayout = {
arrayStride: totalStride, //number of bytes gpu needs to skip forward to get to the next vertex (with two vertices per vertex, thats 
						//	two 32 bit floats, so 2 x 4(bytes) = 8 bytes. in 3D it would be 12
attributes: [{			//stuff like color, normal direction, etc
	format: "float32x3",//cant be anything, there is a list of GPUVertexFormat types in this case, its specific to pass in
	offset: 0,			//how many bytes into the vertex this attribute starts, use if you have more than one attribute
	shaderLocation: 0, // Position, see vertex shader, can be 0 - 15 and is unique to each attribute
	},
	{			
	format: "float32x2",
	offset: vertStride,
	shaderLocation: 1, 
	},
	{			
	format: "float32x3",
	offset: vertStride + uvStride,
	shaderLocation: 2, 
	}
	],

};


const uniformArrayTRS = 4 * 16; // 4x4 matrix for TRS
const uniformBufferTRS = device.createBuffer({
  label: "3D TRS Matrix Uniform Buffer",
  size: uniformArrayTRS,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

//const uniformArrayGU = new Float32Array([1, 1]); //do floats for sake of not casting in shader code
//const uniformBufferGU = device.createBuffer({
//  label: "Generic Uniforms",
//  size: uniformArrayGU.byteLength,
//  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
//});
//device.queue.writeBuffer(uniformBufferGU, 1, uniformArrayGU);

const depthTexture = device.createTexture({
  size: [canvas.width, canvas.height],
  format: 'depth24plus',
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
});

//GPUBindGroup, bind groups connect uniform in the shader
//	collection of resources for shader to access, cant change resources in bind group but you can change their contents

// Create the bind group layout and pipeline layout.
const bindGroupLayout = device.createBindGroupLayout({
  label: "Bind Group Layout",
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,	//visibility is GPUShaderStage flags that indicate which shader stages can use resource
    buffer: {} //buffer key, other options are things like "texture" or "sampler", default is uniform, leave empty for binding 0
  }]
});

//multi bind group
const bindGroups = [
  device.createBindGroup({
    label: "renderer bind group",
    layout: bindGroupLayout,
    entries: [{
      binding: 0,
      resource: { buffer: uniformBufferTRS }	//buffer key, other options are things like "texture" or "sampler"
    }],
  })
];

const pipelineLayout = device.createPipelineLayout({
  label: "Generic Pipeline Layout",
  bindGroupLayouts: [ bindGroupLayout ],
});

//finally creating render pipeline
const genericPipeline = device.createRenderPipeline({
	label: "Generic pipeline",
	layout: pipelineLayout,				// types of inputs other than vertex buffers needed can be passed, can be "auto"
	vertex: {							// vertex stage details
		module: genericShaderModule,	
		entryPoint: "vertexMain",		// our name of function, as you can have multiple vertex/fragment functions in one shader module
		buffers: [vertexBufferLayout]	// GPUVertexBufferLayout that describe data packed into vertex buffers used
	},
	fragment: {							// fragment stage details
		module: genericShaderModule,		
		entryPoint: "fragmentMain",
		targets: [{						// array of dictionaries giving details (like the texture "format") of color attachments pipeline outputs to
		format: canvasFormat			// we used textures from canvas context, and value saved from canvasFormat for format, so pass the same here
		}]
	},
	
	primitive: {
		topology: 'triangle-list',
	
		// Backface culling since the cube is solid piece of geometry.
		// Faces pointing away from the camera will be occluded by faces
		// pointing toward the camera.
		cullMode: 'none',
	},

	// Enable depth testing so that the fragment closest to the camera
	// is rendered in front.
	depthStencil: {
		depthWriteEnabled: true,
		depthCompare: 'less',
		format: 'depth24plus',
	},
});


// Move all of our rendering code into a function
export function updateRotatingCubePass() {
	
	const encoder = device.createCommandEncoder();
	
	//compute section
	//postEffectPass(encoder, bindGroups, step);
	
	step++; // Increment the step count, done between compute and render so output buffer of compute pipeline is input buffer for render pipeline
	
	const transformationMatrix = getTransformationMatrix();
	device.queue.writeBuffer(uniformBufferTRS, 
							0, 
							transformationMatrix.buffer,
							transformationMatrix.byteOffset,
							transformationMatrix.byteLength);
	
	// Start a render pass 
	const pass = encoder.beginRenderPass({
		colorAttachments: [{
		view: context.getCurrentTexture().createView(),
		loadOp: "clear",
		clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
		storeOp: "store",
		}],
		depthStencilAttachment: {
			view: depthTexture.createView(),
		
			depthClearValue: 1.0,
			depthLoadOp: 'clear',
			depthStoreOp: 'store',
		},
	});

	pass.setPipeline(genericPipeline);			// shaders used, layout of vertex data, other relevant state data
	pass.setVertexBuffer(0, vertexBuffer);
	pass.setBindGroup(0, bindGroups[0]);
	pass.draw(vertexBufferArray.length / (totalStride / 4), 1);		// passed in is total stride / float size = 8 
																		//	second arg is number of instances of this draw call
	pass.end();

	device.queue.submit([encoder.finish()]);
}