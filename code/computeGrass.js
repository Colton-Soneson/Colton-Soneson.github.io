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
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,	//its use is for vertex data, and that you want to copy data into it
});
device.queue.writeBuffer(grassVertexBuffer, /*bufferOffset=*/0, grassShaderVertexBufferArray); //copy vertex data to buffer



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
const singleBladeUniformArraySpacesSize = 64; //(4 * 4 * 4) 4x4 matrix for MVP, forget the rest for in shader
const grassInstancePositionalData = 16 * settings.grassTotalBladeCount; // (4 * 4) * total blades, later this will be total clumps of blades, which will allow for more blade positions
const totalGrassUniformArraySize = singleBladeUniformArraySpacesSize + grassInstancePositionalData;
const grassUniformBuffer = device.createBuffer({
  label: "grass Uniform",
  size: totalGrassUniformArraySize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
console.log("Buffer size: ", totalGrassUniformArraySize);

//compute grass anim data
const uniformArrayComputeGrass= 128;	//default for now
const uniformBufferComputeGrass = device.createBuffer({
  label: "grass Compute Uniform Buffer",
  size: uniformArrayComputeGrass,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

//depth for distance scaling
const depthTexture = device.createTexture({
  size: [canvas.width, canvas.height],
  format: 'depth24plus',
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
});

//linear sampling
const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

function getGrassComputeInfo() {
	const grassCompBuffer = [];
	
	grassCompBuffer.push(settings.grassDensityPerTile);
	
	return new Float32Array(grassCompBuffer);
}

//TODO: remove when necessary, only works with even grid
function testInstancedGrassGridBased(numInstances) {
	const resultArray = [];
	
	const bladeDistanceDivisor = 1;
	
	const numInstanceAxis = Math.sqrt(numInstances);
	if(numInstanceAxis % 1 != 0) {
		console.error("provided number of total grass blades/clumps is not base 2", numInstanceAxis)
	}
	
	for(let x = 0; x < numInstanceAxis; x++) {
		for(let y = 0; y < numInstanceAxis; y++) {
			resultArray.push([(x / bladeDistanceDivisor),
								(y / bladeDistanceDivisor),
								0,
								1]);
		}
	}
	return resultArray;
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
		
		//TODO: this will have to grab the same positional data from compute shader output.
		//		for now this will be a grid created by instance number
		const testGrid = testInstancedGrassGridBased(numInstances);
		for(let instance = 0; instance < numInstances; instance++) {
			for(let positionColumn = 0; positionColumn < 4; positionColumn++) {
				bufferResult.push(testGrid[instance][positionColumn]);
			}
		}
		//include extra information from compute shader necesary for the VF Shader
		
		
		const result = new Float32Array(bufferResult);
		const offset = i * totalGrassUniformArraySize;
		
		//console.log("Grass Uniform Buffer Data:", result)


		device.queue.writeBuffer(grassUniformBuffer, 
								offset,
								result.buffer,
								result.byteOffset,
								result.byteLength);
	}
	
}

function grassComputeUniformBufferUpdate() {
	const gcInfo = getGrassComputeInfo();
	device.queue.writeBuffer(uniformBufferComputeGrass, 
									0,	//apparently uniform buffer size defaults to a need of 256 
									gcInfo.buffer,
									gcInfo.byteOffset,
									gcInfo.byteLength);
}

// Layouts
//-------------------------------------------------
// Create the bind group layout and pipeline layout.
const bindGroupVFLayout = device.createBindGroupLayout({
  label: "Grass Bind Group VF Layout",
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: {} 
  }
  ]
});

const bindGroupCLayout = device.createBindGroupLayout({
  label: "Grass Bind Group C Layout",
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,
    buffer: {} 
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
			entries: [{
			binding: 0,
			resource: { buffer: grassUniformBuffer }
			}]
		}));
	}
	return result;
}

function createCompBindGroupGrass() {
	
	const result = 
		device.createBindGroup({
			label: "Grass Comp bind group",
			layout: bindGroupCLayout,
			entries: [{
			binding: 0,
			resource: { buffer: uniformBufferComputeGrass }
			}]
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


export function grassPass(aEncoder) {
	
	// Start a compute pass place and animate the instances
	const bindCGroup = createCompBindGroupGrass();
	grassComputeUniformBufferUpdate();
	const computePass = aEncoder.beginComputePass();
	
	computePass.setPipeline(grassComputePipeline);
	computePass.setBindGroup(0, bindCGroup);	//
	computePass.dispatchWorkgroups(Math.ceil(canvas.width / GRASS_WORKGROUP_SIZE[0]), 
									Math.ceil(canvas.height / GRASS_WORKGROUP_SIZE[1]));
	
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
			view: depthTexture.createView(),
		
			depthClearValue: 1.0,
			depthLoadOp: 'clear',	//check if load instead
			depthStoreOp: 'store',
		},
	});

	pass.setPipeline(grassPipeline);			// shaders used, layout of vertex data, other relevant state data
	pass.setVertexBuffer(0, grassVertexBuffer);
	
	let prevModCombo = 0;
	for(let i = 0; i < grassEntityModels.length; ++i)
	{
		let mod = grassEntityModelsStride[i] / (primitives.totalStride / 4);
		pass.setBindGroup(0, bindVFGroups[i]);
		pass.draw(mod, settings.grassTotalBladeCount, prevModCombo);		// def for draw here is draw(vertexCount, instanceCount, firstVertex)
		prevModCombo += mod;
	}
	prevModCombo = 0;
		
	pass.end();
}