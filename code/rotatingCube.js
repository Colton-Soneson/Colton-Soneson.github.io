import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import {postEffectPass} from './postEffectPass.js'
import * as primitives from '../models/primitives.js'

import { vf_p_generic } from '../shaders/js/vf_p_generic.js'

const vertices = primitives.pSquare.vertices;
const vertDim = primitives.pSquare.dimensions;
const vertStride = vertDim * 4;	//4 for number of bytes in a float
let step = 0; // Track how many simulation steps have been run

//function should return GPUShaderModule object if compiled with valid results, code itself is WGSL
const genericShaderModule = device.createShaderModule({
label: "generic vf shader",
code: vf_p_generic
});


//GPU Side memory management done through GPUBuffer objects
const vertexBuffer = device.createBuffer({
	label: "Cell vertices",		//just helps to identify object, can be anything you type
	size: vertices.byteLength,	//for 12 float vertices thats 48 bytes, cant be resized after creation
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,	//its use is for vertex data, and that you want to copy data into it
});

//copy vertex data to buffer
device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/0, vertices);

//now tell WebGPU what the hell to do with the info
const vertexBufferLayout = {
arrayStride: vertStride,//number of bytes gpu needs to skip forward to get to the next vertex (with two vertices per vertex, thats 
						//	two 32 bit floats, so 2 x 4(bytes) = 8 bytes. in 3D it would be 12
attributes: [{			//stuff like color, normal direction, etc
	format: "float32x2",//cant be anything, there is a list of GPUVertexFormat types in this case, its specific to pass in
	offset: 0,			//how many bytes into the vertex this attribute starts, use if you have more than one attribute
	shaderLocation: 0, // Position, see vertex shader, can be 0 - 15 and is unique to each attribute
	}],
};

const uniformArray = new Float32Array([1, 1]); //do floats for sake of not casting in shader code
const uniformBuffer = device.createBuffer({
  label: "Generic Uniforms",
  size: uniformArray.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});
device.queue.writeBuffer(uniformBuffer, 0, uniformArray);


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
      resource: { buffer: uniformBuffer }	//buffer key, other options are things like "texture" or "sampler"
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
	}
});


// Move all of our rendering code into a function
export function updateRotatingCubePass() {
	
	const encoder = device.createCommandEncoder();
	
	//compute section
	//postEffectPass(encoder, bindGroups, step);
	
	step++; // Increment the step count, done between compute and render so output buffer of compute pipeline is input buffer for render pipeline
	
	// Start a render pass 
	const pass = encoder.beginRenderPass({
		colorAttachments: [{
		view: context.getCurrentTexture().createView(),
		loadOp: "clear",
		clearValue: { r: 0, g: 0, b: 0.4, a: 1.0 },
		storeOp: "store",
		}]
	});

	pass.setPipeline(genericPipeline);			// shaders used, layout of vertex data, other relevant state data
	pass.setVertexBuffer(0, vertexBuffer);	
	pass.setBindGroup(0, bindGroups[0]);
	pass.draw(vertices.length / vertDim, 1);		// passed in is number of vertices to render, 12 floats / coords per float = 6 vertices
																		//	second arg is number of instances of this draw call
	pass.end();

	device.queue.submit([encoder.finish()]);
}