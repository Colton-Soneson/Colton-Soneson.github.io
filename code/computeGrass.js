import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { c_grass } from '../shaders/js/vfc_grass.js'
import { v_grass } from '../shaders/js/vfc_grass.js'
import { f_grass } from '../shaders/js/vfc_grass.js'
import { GRASS_WORKGROUP_SIZE } from '../shaders/js/vfc_grass.js'
import { GRASS_BUFFER_SIZE } from '../shaders/js/vfc_grass.js'

import * as transformations from './transformations.js'
import * as scene from './scene.js'
import * as primitives from '../models/primitives.js'

//time
let startTime = Date.now();

//Model Handling
//-------------------------------------------------
//models are not among scene entites, but a list just for here

const grassEntityModels = [];
grassEntityModels.push(primitives.pGrassBlade);

console.log(grassEntityModels);
const grassEntityModelsStride = [];
const grassShaderVertexBufferArray = scene.loadModelsToVBArray(grassEntityModels, grassEntityModels.length, "grass shader VBA", grassEntityModelsStride);

const grassModelTexturesList = [];
scene.loadModelTextures(grassEntityModels, grassModelTexturesList);
console.log("Grass Textures: ", grassModelTexturesList);

const grassVertexBuffer = device.createBuffer({
	label: "grass model vertices",		//just helps to identify object, can be anything you type
	size: grassShaderVertexBufferArray.byteLength,	//for 12 float vertices thats 48 bytes, cant be resized after creation
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,	//its use is for vertex data, and that you want to copy data into it, ALSO for use as storage buffer in compute
});
device.queue.writeBuffer(grassVertexBuffer, /*bufferOffset=*/0, grassShaderVertexBufferArray); //copy vertex data to buffer
//console.log("grass vertex buffer input: ", grassShaderVertexBufferArray);

// compute shaders and buffers
//-------------------------------------------------
const grassComputeShaderModule = device.createShaderModule({
  label: "c_grass",
  code: c_grass	
});

const grassFragShaderModule = device.createShaderModule({
  label: "f_grass",
  code: f_grass	
});

const grassVertexShaderModule = device.createShaderModule({
  label: "v_grass",
  code: v_grass	
});


//model list specific
const uboOffset = 256;	//this is a defaulted max for UBO, nothing I wrote equals up to 256, its a limiter
const totalGrassUniformArraySize = 64; //(4 * 4 * 4) 4x4 matrix for MVP, forget the rest for in shader
const grassUniformBuffer = device.createBuffer({
  label: "grass space Uniform",
  size: totalGrassUniformArraySize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

//compute grass anim data
const uniformArrayComputeGrass= 128;	//default for now
const uniformBufferComputeGrass = device.createBuffer({
  label: "grass Compute settings Uniform Buffer",
  size: uniformArrayComputeGrass,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

//compute grass total blade vertex data output
//	the size has to be set here, BUT the "writeBuffer" functionality is done within the compute shader
//	!!!ONE ISSUE!!! so this cant be as big as a vertex buffer (max size 256mb), we have to limit it to the max size of a storage buffer (128mb)
let totalGrassVertexBuffer;
export function grassUpdateStorageVertexBuffer() {
	const totalGrassVertexArray = settings.grassTotalBladeCount *  grassEntityModelsStride[0] * Float32Array.BYTES_PER_ELEMENT;
	const GVB = device.createBuffer({
		label: "total grass vertices",		//just helps to identify object, can be anything you type
		size: totalGrassVertexArray,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,	//its use is for vertex data, and that you want to copy data into it, ALSO for use as storage buffer in compute
	});
	
	totalGrassVertexBuffer = GVB;
}
grassUpdateStorageVertexBuffer(); // run the function

//linear sampling
const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

function getGrassComputeInfo() {
	const grassCompBuffer = [];
	
	grassCompBuffer.push(settings.grassTotalBladeCount);
	grassCompBuffer.push(settings.grassDensityPerTile);
	
	const currentTime = (Date.now() - startTime)/ 1000.0; //time in ms
	grassCompBuffer.push(currentTime);	
		
	return new Float32Array(grassCompBuffer);
}

function grassVFUniformBufferUpdates(grassBladeModels, numInstances) {	//future will have a grass model list with multiple types
	
	// !!!!!!!!!!! THIS WILL TAKE IN THE MATH AND POSITIONAL DATA DONE FROM THE COMPUTE SHADER !!!!!!!!!!!!!!!!!
	
	for(let i = 0; i < grassBladeModels.length; i++) {
		//const spaceTrans = transformations.getMatrixTransformSpaces(grassBladeModels[i], numInstances);
		
		const bufferResult = [];
		
		//for now this will be model mat, but its should just be default everything to save time (but scale might be good to avoid model crap)
		const modelMatrix = transformations.getModelMatrix(grassBladeModels[i].worldTranslation, 
															grassBladeModels[i].worldRotation, 
															grassBladeModels[i].worldScale);
		const modelViewMat = mat4.mul(transformations.getViewMatrix(), modelMatrix);
		const modelViewProjectionMatrix = mat4.mul(transformations.projectionMatrix, modelViewMat);
		
		for(let i = 0; i < 16; i++) {
			bufferResult.push(modelViewProjectionMatrix[i]);
		}
		
		const result = new Float32Array(bufferResult);
		const offset = i * totalGrassUniformArraySize;
		
		device.queue.writeBuffer(grassUniformBuffer, 
								offset,
								result.buffer,
								result.byteOffset,
								result.byteLength);
	}
	
}


function grassComputeBuffersUpdate(grassBladeModels) {
	
	for(let i = 0; i < grassBladeModels.length; i++) {		
		const bufferResult = [];
		
		//for now this will be model mat, but its should just be default everything to save time (but scale might be good to avoid model crap)
		const modelMatrix = transformations.getModelMatrix(grassBladeModels[i].worldTranslation, 
															grassBladeModels[i].worldRotation, 
															grassBladeModels[i].worldScale);
		const modelViewMat = mat4.mul(transformations.getViewMatrix(), modelMatrix);
		const modelViewProjectionMatrix = mat4.mul(transformations.projectionMatrix, modelViewMat);
		
		for(let i = 0; i < 16; i++) {
			bufferResult.push(modelViewProjectionMatrix[i]);
		}
		
		const result = new Float32Array(bufferResult);
		const offset = i * totalGrassUniformArraySize;
		
		device.queue.writeBuffer(grassUniformBuffer, 
								offset,
								result.buffer,
								result.byteOffset,
								result.byteLength);
	}
	
	
	const gcInfo = getGrassComputeInfo();

	device.queue.writeBuffer(uniformBufferComputeGrass, 
									0,	//apparently uniform buffer size defaults to a need of 256 
									gcInfo.buffer,
									gcInfo.byteOffset,
									gcInfo.byteLength);
									
	
	//NEW PLAN
	// 1) pass in just one single blade model's vertex data into compute shader in a uniform buffer, along with some extra data generic to all grass (average height, average width, blades per clump, etc)
	//
}

// Layouts
//-------------------------------------------------
// Create the bind group layout and pipeline layout.
const bindGroupVFLayout = device.createBindGroupLayout({
  label: "Grass Bind Group VF Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: {
		type: 'uniform'
	} 
  }
  ]
});

const bindGroupCLayout = device.createBindGroupLayout({
  label: "Grass Bind Group C Layout",
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//spaces
    buffer: {} 
  },
  {
    binding: 1,
    visibility: GPUShaderStage.COMPUTE,	//settings
    buffer: {} 
  },
  {
	binding: 2,								
    visibility:  GPUShaderStage.COMPUTE,	//input vertex data for single blade
    buffer: {
		type: "read-only-storage",
		access: "read-only",
	}
  },
  {
	binding: 3,								
    visibility:  GPUShaderStage.COMPUTE,	//output vertex data for all blades
    buffer: {
		type: "storage",
		access: "read-write",
	}
  }
  ]
});

//multi bind group
function createVFBindGroupsGrass(numModels) {
	
	const result = [];
	for(let i = 0; i < numModels; ++i) {
		result.push(
		device.createBindGroup({
			label: "Grass VF bind group",
			layout: bindGroupVFLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: grassUniformBuffer }
			}
			]
		}));
	}
	return result;
}

console.log(grassShaderVertexBufferArray);
function createCompBindGroupGrass() {
	
	const result = 
		device.createBindGroup({
			label: "Grass Comp bind group",
			layout: bindGroupCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: grassUniformBuffer }
			},
			{
				binding: 1,
				resource: { buffer: uniformBufferComputeGrass }
			},
			{
				binding: 2,
				resource: { buffer: grassVertexBuffer }
			},
			{
				binding: 3,
				resource: { buffer: totalGrassVertexBuffer }
			}
			]
		});
	return result;
}

const grassVFPipelineLayout = device.createPipelineLayout({
  label: "grass VF Pipeline Layout",
  bindGroupLayouts: [ bindGroupVFLayout ],
});

const grassCompPipelineLayout = device.createPipelineLayout({
  label: "grass comp Pipeline Layout",
  bindGroupLayouts: [ bindGroupCLayout ],
});

// Pipelines
//-------------------------------------------------
//WebGPU handles render and computer pipelines seperately, they cannot be combined as one
const grassPipeline = device.createRenderPipeline({
  label: "grass VF pipeline",
  layout: grassVFPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	vertex: {							// vertex stage details
		module: grassVertexShaderModule,	
		entryPoint: "vertexMain",		// our name of function, as you can have multiple vertex/fragment functions in one shader module
		buffers: [scene.vertexBufferLayout]	// GPUVertexBufferLayout that describe data packed into vertex buffers used
	},
	fragment: {							// fragment stage details
		module: grassFragShaderModule,		
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
	
	depthStencil: {
		depthWriteEnabled: true,
		depthCompare: 'less',
		format: 'depth24plus',
	},
});

// Compute Pipeline has to be seperate
const grassComputePipeline = device.createComputePipeline({
  label: "grass C pipeline",
  layout: grassCompPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	compute: {
		module: grassComputeShaderModule,
		entryPoint: "computeMain",
	},
});


	//console.log("Total Grass Vert array size : ", totalGrassVertexArray);
	//console.log("single grass blade vertex num: ", grassEntityModels[0].vertices.length / 3);
	//console.log("Total Grass Vert array size divide by (12 pos + 8 uv + 12 norm = 32) divide by verts per blade model (10) should be number of blades: ", (totalGrassVertexArray / 32 / (grassEntityModels[0].vertices.length / 3)));

export function grassPass(aEncoder, mainpassDepthTexture) {
		
	// Start a compute pass place and animate the instances
	const bindCGroup = createCompBindGroupGrass();
	grassComputeBuffersUpdate(grassEntityModels);
	
	const computePass = aEncoder.beginComputePass();
	
	computePass.setPipeline(grassComputePipeline);
	computePass.setBindGroup(0, bindCGroup);
	
	//In WebGPU, the number of times a compute shader will be invoked depends on the number of workgroups you dispatch and the workgroup size
	//	we take the number of times to invoke, divide by workgroups size
	computePass.dispatchWorkgroups(Math.ceil( settings.grassTotalBladeCount / GRASS_WORKGROUP_SIZE[0]));			//CHECK THIS SIZE!!!!!!!!!!!
	computePass.end();
		
	const bindVFGroups = createVFBindGroupsGrass(grassEntityModels.length);
	grassVFUniformBufferUpdates(grassEntityModels, settings.grassTotalBladeCount);
	
	
	// start a pass to render the grass instances
	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{
		view: context.getCurrentTexture().createView(),
		loadOp: "load",
		clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
		storeOp: "store",
		}],
		depthStencilAttachment: {
			view: mainpassDepthTexture.createView(),
			
			depthLoadOp: 'load',	//check if load instead
			depthStoreOp: 'store',
		},
	});

	pass.setPipeline(grassPipeline);					// shaders used, layout of vertex data, other relevant state data
	pass.setVertexBuffer(0, totalGrassVertexBuffer);	// swapped from single blade to new total grass blades
	
	let prevModCombo = 0;
	for(let i = 0; i < grassEntityModels.length; ++i)
	{
		//with 24 verts to a 8 triangle grass model, thats 24 * ((3 + 2 + 3 for vertex layout) * 4 byte size) = 768.
		let mod = (grassEntityModelsStride[i] * settings.grassTotalBladeCount) / (primitives.totalStride / 4);	//ACTUAL
		pass.setBindGroup(0, bindVFGroups[i]);
		pass.draw(mod, /*higher instance to increase density */ 1, prevModCombo);		// def for draw here is draw(vertexCount, instanceCount, firstVertex)
		prevModCombo += mod;
	}
	prevModCombo = 0;
		
	pass.end();
}