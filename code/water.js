import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { c_water } from '../shaders/js/vfc_water.js'
import { v_water } from '../shaders/js/vfc_water.js'
import { f_water } from '../shaders/js/vfc_water.js'
import { WATER_WORKGROUP_SIZE } from '../shaders/js/vfc_water.js'

import * as transformations from './transformations.js'
import * as scene from './scene.js'
import * as primitives from '../models/primitives.js'


// compute shaders and buffers
//-------------------------------------------------
const waterComputeShaderModule = device.createShaderModule({
  label: "c_water",
  code: c_water	
});

const waterFragShaderModule = device.createShaderModule({
  label: "f_water",
  code: f_water	
});

const waterVertexShaderModule = device.createShaderModule({
  label: "v_water",
  code: v_water	
});

//anim
let step = 0;

//if settings change live, this will have to be changed out from constants													!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
const waterPlaneNumberOfVerts = settings.waterTileResolution * settings.waterTileResolution;
const waterPlaneVertexStride = (3 + 2 + 3);
const waterEntityModelsStride = waterPlaneNumberOfVerts * waterPlaneVertexStride;	//number of floats

//model list specific
const uboOffset = 256;	//this is a defaulted max for UBO, nothing I wrote equals up to 256, its a limiter
const totalwaterUniformArraySize = 64; //(4 * 4 * 4) 4x4 matrix for MVP, forget the rest for in shader
const waterUniformBuffer = device.createBuffer({
  label: "water space Uniform",
  size: totalwaterUniformArraySize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

//compute water anim data
const uniformArrayComputewater= 128;	//default for now
const uniformBufferComputewater = device.createBuffer({
  label: "water Compute settings Uniform Buffer",
  size: uniformArrayComputewater,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

let totalwaterVertexBuffer;
export function waterUpdateStorageVertexBuffer() {
	const totalwaterVertexArray = waterEntityModelsStride * Float32Array.BYTES_PER_ELEMENT;		// i dont think this is correct
	const GVB = device.createBuffer({
		label: "total water vertices",		//just helps to identify object, can be anything you type
		size: totalwaterVertexArray,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,	//its use is for vertex data, and that you want to copy data into it, ALSO for use as storage buffer in compute
	});
	
	totalwaterVertexBuffer = GVB;
}
waterUpdateStorageVertexBuffer(); // run the function

let totalwaterIndexBuffer;
const totalPlaneTriangles = ((settings.waterTileResolution - 1) * (settings.waterTileResolution - 1)) / 2;	//grid cells / tris per cell (2)
export function waterUpdateStorageIndexBuffer() {
	const totalwaterIndexArray = totalPlaneTriangles * (3 + 2 + 3) * Float32Array.BYTES_PER_ELEMENT;
	const GIB = device.createBuffer({
		label: "total water indices",	
		size: totalwaterIndexArray,
		usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,	//its use is for vertex data, and that you want to copy data into it, ALSO for use as storage buffer in compute
	});
	
	totalwaterIndexBuffer = GIB;
}
waterUpdateStorageIndexBuffer(); // run the function



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

function getwaterComputeInfo() {
	const waterCompBuffer = [];
	
	waterCompBuffer.push(settings.camPosX);
	waterCompBuffer.push(settings.camPosY);
	waterCompBuffer.push(settings.camPosZ);
	waterCompBuffer.push(1);	//padding
	
	waterCompBuffer.push(settings.windDirection[0]);
	waterCompBuffer.push(settings.windDirection[1]);
	
	waterCompBuffer.push(settings.waterTileResolution);
	waterCompBuffer.push(settings.waterWaveHeight);
	waterCompBuffer.push(step);	
	waterCompBuffer.push(settings.waterWorldPosY);
	waterCompBuffer.push(settings.waterWaveLength);

		
	return new Float32Array(waterCompBuffer);
}

function waterVFUniformBufferUpdates(numInstances) {	//future will have a water model list with multiple types
	
		const bufferResult = [];
		
		//for now this will be model mat, but its should just be default everything to save time (but scale might be good to avoid model crap)
		const modelMatrix = transformations.getModelMatrix(new Float32Array([0.0,0.0,0.0]), 
															new Float32Array([0.0,0.0,0.0]),
															new Float32Array([1.0,1.0,1.0]));
		const modelViewMat = mat4.mul(transformations.getViewMatrix(), modelMatrix);
		const modelViewProjectionMatrix = mat4.mul(transformations.projectionMatrix, modelViewMat);
		
		for(let i = 0; i < 16; i++) {
			bufferResult.push(modelViewProjectionMatrix[i]);
		}
		
		const result = new Float32Array(bufferResult);
		
		device.queue.writeBuffer(waterUniformBuffer, 
								0,
								result.buffer,
								result.byteOffset,
								result.byteLength);
}

function waterComputeBuffersUpdate() {
	
	const bufferResult = [];
	
	//for now this will be model mat, but its should just be default everything to save time (but scale might be good to avoid model crap)
	const modelMatrix = transformations.getModelMatrix(new Float32Array([0.0,0.0,0.0]), 
														new Float32Array([0.0,0.0,0.0]), 
														new Float32Array([1.0,1.0,1.0]));
	const modelViewMat = mat4.mul(transformations.getViewMatrix(), modelMatrix);
	const modelViewProjectionMatrix = mat4.mul(transformations.projectionMatrix, modelViewMat);
	
	for(let i = 0; i < 16; i++) {
		bufferResult.push(modelViewProjectionMatrix[i]);
	}
	
	const result = new Float32Array(bufferResult);
	
	device.queue.writeBuffer(waterUniformBuffer, 
							0,
							result.buffer,
							result.byteOffset,
							result.byteLength);
	
	const gcInfo = getwaterComputeInfo();

	device.queue.writeBuffer(uniformBufferComputewater, 
									0,	//apparently uniform buffer size defaults to a need of 256 
									gcInfo.buffer,
									gcInfo.byteOffset,
									gcInfo.byteLength);
}

// Layouts
//-------------------------------------------------
// Create the bind group layout and pipeline layout.
const bindGroupVFLayout = device.createBindGroupLayout({
  label: "water Bind Group VF Layout",
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
  label: "water Bind Group C Layout",
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
    visibility:  GPUShaderStage.COMPUTE,	//output vertex data for all blades
    buffer: {
		type: "storage",
		access: "read-write",
	}
  },
  {
	binding: 3,								
    visibility:  GPUShaderStage.COMPUTE,	//output index data for all blades
    buffer: {
		type: "storage",
		access: "read-write",
	}
  }
  ]
});

//multi bind group
function createVFBindGroupswater() {
	return device.createBindGroup({
			label: "water VF bind group",
			layout: bindGroupVFLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: waterUniformBuffer }
			}
			]
		});
}

function createCompBindGroupwater() {
	
	const result = 
		device.createBindGroup({
			label: "water Comp bind group",
			layout: bindGroupCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: waterUniformBuffer }
			},
			{
				binding: 1,
				resource: { buffer: uniformBufferComputewater }
			},
			{
				binding: 2,
				resource: { buffer: totalwaterVertexBuffer }
			},
			{
				binding: 3,
				resource: { buffer: totalwaterIndexBuffer }
			}
			]
		});
	return result;
}

const waterVFPipelineLayout = device.createPipelineLayout({
  label: "water VF Pipeline Layout",
  bindGroupLayouts: [ bindGroupVFLayout ],
});

const waterCompPipelineLayout = device.createPipelineLayout({
  label: "water comp Pipeline Layout",
  bindGroupLayouts: [ bindGroupCLayout ],
});

// Pipelines
//-------------------------------------------------
//WebGPU handles render and computer pipelines seperately, they cannot be combined as one
let waterPipeline;
let waterPipelineUpdateFlag = false;
let waterPipelineTopologyType = 'triangle-list';

export function waterPipelineSignalUpdate(inputTopology) {
	waterPipelineUpdateFlag = true;
	waterPipelineTopologyType = inputTopology;
}

function recreateWaterPipeline(inputTopology) {
  waterPipeline = device.createRenderPipeline({
  label: "water VF pipeline",
  layout: waterVFPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	vertex: {							// vertex stage details
		module: waterVertexShaderModule,	
		entryPoint: "vertexMain",		// our name of function, as you can have multiple vertex/fragment functions in one shader module
		buffers: [scene.vertexBufferLayout]	// GPUVertexBufferLayout that describe data packed into vertex buffers used
	},
	fragment: {							// fragment stage details
		module: waterFragShaderModule,		
		entryPoint: "fragmentMain",
		targets: [{						// array of dictionaries giving details (like the texture "format") of color attachments pipeline outputs to
		format: canvasFormat			// we used textures from canvas context, and value saved from canvasFormat for format, so pass the same here
		}]
	},
	
	primitive: {
		topology: inputTopology,
	
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
}
recreateWaterPipeline(waterPipelineTopologyType);

// Compute Pipeline has to be seperate
const waterComputePipeline = device.createComputePipeline({
  label: "water C pipeline",
  layout: waterCompPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	compute: {
		module: waterComputeShaderModule,
		entryPoint: "computeMain",
	},
});

export function waterPass(aEncoder) {
	
	step++;
	
	if(waterPipelineUpdateFlag) {
		recreateWaterPipeline(waterPipelineTopologyType)
		waterPipelineUpdateFlag = false;
	}
	
	// Start a compute pass place and animate the instances
	const bindCGroup = createCompBindGroupwater();
	waterComputeBuffersUpdate();
	
	const computePass = aEncoder.beginComputePass();
	
	computePass.setPipeline(waterComputePipeline);
	computePass.setBindGroup(0, bindCGroup);
	
	computePass.dispatchWorkgroups(Math.ceil( (settings.waterTileResolution * settings.waterTileResolution) / WATER_WORKGROUP_SIZE[0]));			//you want to do it per vertex, not per cell
	computePass.end();
		
	const bindVFGroups = createVFBindGroupswater();
	waterVFUniformBufferUpdates(settings.waterTileResolution * settings.waterTileResolution);
	
	// start a pass to render the water instances
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

	pass.setPipeline(waterPipeline);					// shaders used, layout of vertex data, other relevant state data
	pass.setVertexBuffer(0, totalwaterVertexBuffer);	
	pass.setIndexBuffer(totalwaterIndexBuffer, 'uint32');	
	
	//3 instance view in viewport
	//
	//		  | \			  / |		instance 2
	//		  |__\___________/__|
	//  	     |\			/|			instance 1	
	//		     |_\_______/_|
	//		       |\	  /|
	//		       | \	 / |			instance 0
	//		       |__\ /__|
	//		    	  CAM
	
	
	//console.log("water vert buf: ", totalwaterVertexBuffer)
	
	let prevModCombo = 0;
	//for(let i = 0; i < settings.waterTileInstanceCount; ++i)
	{
		let mod = waterEntityModelsStride / (primitives.totalStride / 4);	//ACTUAL
		//console.log("mod: ", mod);
		pass.setBindGroup(0, bindVFGroups);
		//pass.draw(mod, 1/*i*/, prevModCombo);		// def for draw here is draw(vertexCount, instanceCount, firstVertex)
		pass.drawIndexed(totalPlaneTriangles * (3 + 2 + 3), 1, 0, 0, 0); // Drawing the mesh
		prevModCombo += mod;
	}
	prevModCombo = 0;
		
	pass.end();
}