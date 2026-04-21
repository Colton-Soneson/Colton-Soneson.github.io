import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { c_SSS } from '../shaders/js/c_SSS.js'
import { SSS_WORKGROUP_SIZE } from '../shaders/js/c_SSS.js'
import { SSS_BUFFER_SIZE } from '../shaders/js/c_SSS.js'

//https://developer.mozilla.org/en-US/docs/Web/API/GPUComputePassEncoder/dispatchWorkgroups

// compute shaders and buffers
//-------------------------------------------------
const sssShaderModule = device.createShaderModule({
  label: "SSS",
  code: c_SSS		//computes can be dispatched along x y z axis, this grid is divided into workgroups (we just use 8x8)
});

const sssUniformArray = new Float32Array([1, 1]); //do floats for sake of not casting in shader code
const sssUniformBuffer = device.createBuffer({
  label: "SSS Uniform",
  size: sssUniformArray.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});
device.queue.writeBuffer(sssUniformBuffer, 0, sssUniformArray);

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
const bindGroupLayout = device.createBindGroupLayout({
  label: "Compute Bind Group Layout",
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
	binding: 2,								//inTexture
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

//multi bind group
function createBindGroupsSSS(aTexture) {
	const bindGroups = [
  device.createBindGroup({
    label: "compute bind group",
    layout: bindGroupLayout,
    entries: [{
      binding: 0,
      resource: { buffer: sssUniformBuffer }	//buffer key, other options are things like "texture" or "sampler"
    },
	{
      binding: 1,
      resource: outTexture.createView()
    },
	{
      binding: 2,
      resource: aTexture.createView()	//we want the current swap chain texture in here
    }
	],
  })
];

	return bindGroups;
}


const sssPipelineLayout = device.createPipelineLayout({
  label: "compute Pipeline Layout",
  bindGroupLayouts: [ bindGroupLayout ],
});


// Pipelines
//-------------------------------------------------
// Create a compute pipeline that updates the game state.
const sssPipeline = device.createComputePipeline({
  label: "SSS pipeline",
  layout: sssPipelineLayout,	//allows for use of same bind groups as the renderpipeline
  compute: {
    module: sssShaderModule,
    entryPoint: "computeMain",
  }
});


export function postEffectPassSSS(aEncoder, aTexture) {
	const bindGroups = createBindGroupsSSS(aTexture);
	
	// Start a compute pass 
	const computePass = aEncoder.beginComputePass();	//do before render pass so RP can take latest CP results
	
	computePass.setPipeline(sssPipeline);
	computePass.setBindGroup(0, bindGroups[0]);	//same bind groups as rendering pass
	computePass.dispatchWorkgroups(Math.ceil(canvas.width / SSS_WORKGROUP_SIZE[0]), 
									Math.ceil(canvas.height / SSS_WORKGROUP_SIZE[1]));
	
	computePass.end();
	
	//this may seem ridiculous, but for now its to get around the swap chain image format problems with read-write storage
	aEncoder.copyTextureToTexture(
		{texture: outTexture},	//the compute pass result
		{texture: aTexture},	//the swap chain image
		{width: canvas.width, height: canvas.height}
	)
}