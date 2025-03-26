import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { c_DebugTexture_RGBA8UNORM } from '../shaders/js/c_debugTextureDisplay.js'
import { c_DebugTexture_DEPTH32FLOAT } from '../shaders/js/c_debugTextureDisplay.js'
import { DEBUGTEXTURE_WORKGROUP_SIZE } from '../shaders/js/c_debugTextureDisplay.js'

import * as scene from './scene.js'
import { settings } from './settings.js';

// compute shaders and buffers
//-------------------------------------------------
const debugTextureShaderModule_RGBA8UNORM = device.createShaderModule({
  label: "DebugTexture_RGBA8UNORM",
  code: c_DebugTexture_RGBA8UNORM		
 });
const debugTextureShaderModule_DEPTH32FLOAT = device.createShaderModule({
  label: "DebugTexture_DEPTH32FLOAT",
  code: c_DebugTexture_DEPTH32FLOAT		
 });

const debugTextureUniformArraySize = 24; // (2 * 4) + (2 * 4) + 4	canvas size and debug texture size and tex type
const debugTextureUniformBuffer = device.createBuffer({
  label: "Debug Texture Uniform",
  size: debugTextureUniformArraySize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

function debugTextureUniformUpdate(texSize) {
	
	const result = [];
	
	result.push(canvas.width);
	result.push(canvas.height);
	
	result.push(texSize.width);
	result.push(texSize.height);
	
	result.push(settings.displayHeightMapDebugRange);
		
	const finalBuff = new Float32Array(result);
		
	device.queue.writeBuffer(debugTextureUniformBuffer, 
							0,	//apparently uniform buffer size defaults to a need of 256 
							finalBuff.buffer,
							finalBuff.byteOffset,
							finalBuff.byteLength);
}

//linear sampling
const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

//out texture
const outTexture = device.createTexture({
	size: {width: canvas.width, height: canvas.height},
	format: "rgba8unorm",
	usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

// Layouts
//-------------------------------------------------
// Create the bind group layout and pipeline layout.
const bindGroupLayout_RGBA8UNORM = device.createBindGroupLayout({
  label: "debugTexture Compute Bind Group Layout RGBA8UNORM",
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//visibility is GPUShaderStage flags that indicate which shader stages can use resource
    buffer: {} //buffer key, other options are things like "texture" or "sampler", default is uniform, leave empty for binding 0
  },
  {
    binding: 1,								//outTexture
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: canvasFormat,   // Format must match the swap chain texture
		access: "write-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
	binding: 2,								//in canvas Texture
	visibility:  GPUShaderStage.COMPUTE,
	storageTexture: {
		format: canvasFormat,
		access: "read-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
	binding: 3,								//in debug Texture
	visibility:  GPUShaderStage.COMPUTE,
	storageTexture: {
		format: canvasFormat,
		access: "read-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  }
  ]
});

const bindGroupLayout_DEPTH32FLOAT = device.createBindGroupLayout({
  label: "debugTexture Compute Bind Group Layout DEPTH32FLOAT",
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//visibility is GPUShaderStage flags that indicate which shader stages can use resource
    buffer: {} //buffer key, other options are things like "texture" or "sampler", default is uniform, leave empty for binding 0
  },
  {
    binding: 1,								//outTexture
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: canvasFormat,   // Format must match the swap chain texture
		access: "write-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
	binding: 2,								//in canvas Texture
	visibility:  GPUShaderStage.COMPUTE,
	storageTexture: {
		format: canvasFormat,
		access: "read-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
    binding: 3,
    visibility: GPUShaderStage.COMPUTE,
    texture: {
		sampleType: 'depth',
	},
  },
  {
    binding: 4,
    visibility: GPUShaderStage.COMPUTE,
    sampler: {
		type: 'comparison',		
	},
  }
  ]
});

//multi bind group
function createBindGroupsDebugTexture_RGBA8UNORM(aCanvasTexture, aTextureToDebug) {
	const bindGroups = [
  device.createBindGroup({
    label: "debugTexture compute bind group RGBA8UNORM",
    layout: bindGroupLayout_RGBA8UNORM,
    entries: [{
      binding: 0,
      resource: { buffer: debugTextureUniformBuffer }	//buffer key, other options are things like "texture" or "sampler"
    },
	{
      binding: 1,
      resource: outTexture.createView()
    },
	{
      binding: 2,
      resource: aCanvasTexture.createView()	//we want the current swap chain texture in here
    },
	{
      binding: 3,
      resource: aTextureToDebug.createView()	
    }
	],
  })
];

	return bindGroups;
}

function createBindGroupsDebugTexture_DEPTH32FLOAT(aCanvasTexture, aTextureToDebug, aSampler) {
	const bindGroups = [
  device.createBindGroup({
    label: "debugTexture compute bind group DEPTH32FLOAT",
    layout: bindGroupLayout_DEPTH32FLOAT,
    entries: [{
      binding: 0,
      resource: { buffer: debugTextureUniformBuffer }	//buffer key, other options are things like "texture" or "sampler"
    },
	{
      binding: 1,
      resource: outTexture.createView()
    },
	{
      binding: 2,
      resource: aCanvasTexture.createView()	//we want the current swap chain texture in here
    },
	{
      binding: 3,
      resource: aTextureToDebug.createView()	
    },
	{
      binding: 4,
      resource: aSampler	
    }
	],
  })
];

	return bindGroups;
}


const debugTexturePipelineLayout_RGBA8UNORM = device.createPipelineLayout({
  label: "debugTexture compute Pipeline Layout RGBA8UNORM",
  bindGroupLayouts: [ bindGroupLayout_RGBA8UNORM ],
});

const debugTexturePipelineLayout_DEPTH32FLOAT = device.createPipelineLayout({
  label: "debugTexture compute Pipeline Layout DEPTH32FLOAT",
  bindGroupLayouts: [ bindGroupLayout_DEPTH32FLOAT ],
});

// Pipelines
//-------------------------------------------------
// Create a compute pipeline that updates the game state.
const debugTexturePipeline_RGBA8UNORM = device.createComputePipeline({
  label: "debugTexture pipeline RGBA8UNORM",
  layout: debugTexturePipelineLayout_RGBA8UNORM,	//allows for use of same bind groups as the renderpipeline
  compute: {
    module: debugTextureShaderModule_RGBA8UNORM,
    entryPoint: "computeMain",
  }
});

const debugTexturePipeline_DEPTH32FLOAT = device.createComputePipeline({
  label: "debugTexture pipeline DEPTH32FLOAT",
  layout: debugTexturePipelineLayout_DEPTH32FLOAT,	//allows for use of same bind groups as the renderpipeline
  compute: {
    module: debugTextureShaderModule_DEPTH32FLOAT,
    entryPoint: "computeMain",
  }
});

function textureTypeToIndex(aTextureType) {
	switch(aTextureType) {
		case "rgba8unorm":
			return 1;
		break;
		case "depth32float":
			return 2;
		break;
		default:
			return 0;
		break;
	}
}

export function postEffectPassTextureDebug_RGBA8UNORM(aEncoder, aCanvasTexture, aTextureToDebug) {
	const bindGroups = createBindGroupsDebugTexture_RGBA8UNORM(aCanvasTexture, aTextureToDebug);
	
	debugTextureUniformUpdate(aTextureToDebug);
	
	// Start a compute pass 
	const computePass = aEncoder.beginComputePass();	//do before render pass so RP can take latest CP results
	
	computePass.setPipeline(debugTexturePipeline_RGBA8UNORM);
	computePass.setBindGroup(0, bindGroups[0]);	//same bind groups as rendering pass
	computePass.dispatchWorkgroups(Math.ceil(canvas.width / DEBUGTEXTURE_WORKGROUP_SIZE[0]), 
									Math.ceil(canvas.height / DEBUGTEXTURE_WORKGROUP_SIZE[1]));
	
	computePass.end();
	
	//this may seem ridiculous, but for now its to get around the swap chain image format problems with read-write storage
	aEncoder.copyTextureToTexture(
		{texture: outTexture},	//the compute pass result
		{texture: aCanvasTexture},	//the swap chain image
		{width: canvas.width, height: canvas.height}
	)
}

export function postEffectPassTextureDebug_DEPTH32FLOAT(aEncoder, aCanvasTexture, aTextureToDebug, aDepthSampler) {
	const bindGroups = createBindGroupsDebugTexture_DEPTH32FLOAT(aCanvasTexture, aTextureToDebug, aDepthSampler);
	
	debugTextureUniformUpdate(aTextureToDebug);
	
	// Start a compute pass 
	const computePass = aEncoder.beginComputePass();	//do before render pass so RP can take latest CP results
	
	computePass.setPipeline(debugTexturePipeline_DEPTH32FLOAT);
	computePass.setBindGroup(0, bindGroups[0]);	//same bind groups as rendering pass
	computePass.dispatchWorkgroups(Math.ceil(canvas.width / DEBUGTEXTURE_WORKGROUP_SIZE[0]), 
									Math.ceil(canvas.height / DEBUGTEXTURE_WORKGROUP_SIZE[1]));
	
	computePass.end();
	
	//this may seem ridiculous, but for now its to get around the swap chain image format problems with read-write storage
	aEncoder.copyTextureToTexture(
		{texture: outTexture},	//the compute pass result
		{texture: aCanvasTexture},	//the swap chain image
		{width: canvas.width, height: canvas.height}
	)
}