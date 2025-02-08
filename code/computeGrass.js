import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { settings } from './settings.js';

import { c_grass } from '../shaders/js/c_grass.js'
import { grass_WORKGROUP_SIZE } from '../shaders/js/c_grass.js'
import { grass_BUFFER_SIZE } from '../shaders/js/c_grass.js'

import * as transformations from './transformations.js'
import * as scene from './scene.js'


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
const singleBladeUniformArraySpacesSize = 192; //(4 * 4 * 4) + (4 * 4 * 4) + (4 x 4 x 4) 4x4 matrix for MVP + iMV + normal
const totalGrassUniformArraySpacesSize = uboOffset + singleBladeUniformArraySpacesSize;	// !!!!! Check this !!!!! this may also change with additions of different grass model types, look at space transformations to see
const grassUniformBuffer = device.createBuffer({
  label: "grass Uniform",
  size: totalGrassUniformArraySpacesSize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
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

function grassUniformBufferUpdates(grassBladeModel) {	//future will have a grass model list with multiple types
	const spaceTrans = transformations.getMatrixTransformSpaces(grassBladeModel);

		device.queue.writeBuffer(grassUniformBuffer, 
								i * uboOffset,	//apparently uniform buffer size defaults to a need of 256 
								spaceTrans.buffer,
								spaceTrans.byteOffset,
								spaceTrans.byteLength);
}

// Layouts
//-------------------------------------------------
// Create the bind group layout and pipeline layout.
const bindGroupLayout = device.createBindGroupLayout({
  label: "Grass Bind Group Layout",
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
    buffer: {} 
  }
  ]
});

//multi bind group
function createBindGroupGrass() {
	const bindGroup = [
  device.createBindGroup({
    label: "Grass bind group",
    layout: bindGroupLayout,
    entries: [{
      binding: 0,
      resource: { buffer: grassUniformBuffer }
    },
	],
  })
];

	return bindGroup;
}

const grassPipelineLayout = device.createPipelineLayout({
  label: "compute Pipeline Layout",
  bindGroupLayouts: [ bindGroupLayout ],
});

// Pipelines
//-------------------------------------------------
const grassPipeline = device.createComputePipeline({
  label: "grass VF pipeline",
  layout: grassPipelineLayout,	//allows for use of same bind groups as the renderpipeline
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
  layout: grassPipelineLayout,	//allows for use of same bind groups as the renderpipeline
  compute: {
		module: grassComputeShaderModule,
		entryPoint: "computeMain",
	},
});

const grassIndex = scene.searchListIndexForEntityByName(scene.entityModels, "pGrassBlade");

export function grassPass(aEncoder, aGrassModel) {
	const bindGroup = createBindGroupGrass();
	grassUniformBufferUpdates(aGrassModel);
	
	// start a pass to render the grass instances
	const pass = encoder.beginRenderPass({
		colorAttachments: [{
		view: context.getCurrentTexture().createView(),
		loadOp: "clear",
		clearValue: { r: 0.8, g: 0.8, b: 0.8, a: 1.0 },
		storeOp: "store",
		}],
		depthStencilAttachment: {
			view: depthTexture.createView(),
		
			depthClearValue: 1.0,
			depthLoadOp: 'clear',
			depthStoreOp: 'store',
		},
	});

	pass.setPipeline(grassPipeline);			// shaders used, layout of vertex data, other relevant state data
	pass.setVertexBuffer(0, scene.vertexBuffer);
	
	let stride = scene.entityModelsStride[grassIndex] / (primitives.totalStride / 4);
	pass.setBindGroup(0, bindGroup);
	pass.draw(stride, 1, 0);
		
	pass.end();
	
	// Start a compute pass place and animate the instances
	const computePass = aEncoder.beginComputePass();
	
	computePass.setPipeline(grassComputePipeline);
	computePass.setBindGroup(0, bindGroup[0]);	//same bind groups as rendering pass
	computePass.dispatchWorkgroups(Math.ceil(canvas.width / GRASS_WORKGROUP_SIZE[0]), 
									Math.ceil(canvas.height / GRASS_WORKGROUP_SIZE[1]));
	
	computePass.end();
}