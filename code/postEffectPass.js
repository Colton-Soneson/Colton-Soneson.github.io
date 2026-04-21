import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
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

// Layouts
//-------------------------------------------------
// Create the bind group layout and pipeline layout.
const bindGroupLayout = device.createBindGroupLayout({
  label: "Compute Bind Group Layout",
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,	//visibility is GPUShaderStage flags that indicate which shader stages can use resource
    buffer: {} //buffer key, other options are things like "texture" or "sampler", default is uniform, leave empty for binding 0
  }]
});

//multi bind group
const bindGroups = [
  device.createBindGroup({
    label: "compute bind group",
    layout: bindGroupLayout,
    entries: [{
      binding: 0,
      resource: { buffer: sssUniformBuffer }	//buffer key, other options are things like "texture" or "sampler"
    }],
  })
];

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


export function postEffectPass(aEncoder, aStep) {
	// Start a compute pass 
	const computePass = aEncoder.beginComputePass();	//do before render pass so RP can take latest CP results
	
	computePass.setPipeline(sssPipeline);
	computePass.setBindGroup(0, bindGroups[0]);	//same bind groups as rendering pass
	const workgroupCount = Math.ceil(SSS_BUFFER_SIZE / SSS_WORKGROUP_SIZE[0] * SSS_WORKGROUP_SIZE[1] * SSS_WORKGROUP_SIZE[2]);
	computePass.dispatchWorkgroups(workgroupCount);
	
	computePass.end();
}