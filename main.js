import { vf_p_generic } from './shaders/js/vf_p_generic.js'
import { vf_p_gridGeneric } from './shaders/js/vf_p_gridGeneric.js'
import { c_gridSim } from './shaders/js/c_gridSim.js'
import { WORKGROUP_SIZE } from './shaders/js/c_gridSim.js'
import * as primitives from './models/primitives.js'

const canvas = document.querySelector("canvas");

if (!navigator.gpu) 
{
	throw new Error("WebGPU not supported on this browser.");
}

//adapter options can be passed in for specific hardware feature requests
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) 
{
	throw new Error("No appropriate GPUAdapter found.");
}

//device options can be passed in for specific hardware feature requests
const device = await adapter.requestDevice();


const context = canvas.getContext("webgpu");
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();	//webgpu's suggestion for canvas type
context.configure({
	device: device,
	format: canvasFormat,	//format is the texture format that should be used
});
/*
//interface to record GPU Commands, necessary for basically everything
const encoder = device.createCommandEncoder();

//begin render pass
//	give texture view property of colorAttachment
const pass = encoder.beginRenderPass({
	colorAttachments: [{
		view: context.getCurrentTexture().createView(),	//getCurrentTexture is getting ENTIRE canvas in this case
		loadOp: "clear",		//clear texture when renderpass starts
		storeOp: "store",		//once rp is finished, store results into the texture
	}]	
});

//end to the render pass "pass"
pass.end();

//command buffer for recording commands, assigned by finish function on command encoder
//const commandBuffer = encoder.finish();

//submit commands in queue, submit function can take an array of command buffers if needed
//device.queue.submit([commandBuffer]);

//combining the two into one, and its done
device.queue.submit([encoder.finish()]);

//--------------CANVAS COLOR-----------------
//new render pass, so different from the first
const encoder2 = device.createCommandEncoder();
const pass2 = encoder2.beginRenderPass({
colorAttachments: [{
	view: context.getCurrentTexture().createView(),
	loadOp: "clear",
	clearValue: { r: 0, g: 0, b: 0.4, a: 1 }, // New line
	storeOp: "store",
	}],
});

pass2.end();

device.queue.submit([encoder2.finish()]);
//--------------------------------------------
*/

const vertices = primitives.pSquare.vertices;
const vertDim = primitives.pSquare.dimensions;
const vertStride = vertDim * 4;	//4 for number of bytes in a float
const GRID_SIZE = 32;
const UPDATE_INTERVAL = 200; // Update every 200ms (5 times/sec)
let step = 0; // Track how many simulation steps have been run

//function should return GPUShaderModule object if compiled with valid results, code itself is WGSL
const cellShaderModule = device.createShaderModule({
label: "Cell shader",
code: vf_p_gridGeneric
});

// Create the compute shader that will process the simulation.
const simulationShaderModule = device.createShaderModule({
  label: "Game of Life simulation shader",
  code: c_gridSim		//computes can be dispatched along x y z axis, this grid is divided into workgroups (we just use 8x8)
});


//GPU Side memory management done through GPUBuffer objects
//	since its so simple, theres no need to do index buffer, but the process I imagine is similar
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

// Create a uniform buffer that describes the grid.
const uniformArray = new Float32Array([GRID_SIZE, GRID_SIZE]); //do floats for sake of not casting in shader code
const uniformBuffer = device.createBuffer({
  label: "Grid Uniforms",
  size: uniformArray.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});
device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

//array representing active state of each cell
const cellStateArray = new Uint32Array(GRID_SIZE * GRID_SIZE);

//storage buffers can be read by vertex shaders, and RW to compute. Large data storage
//	this creates two and holds them in an array
const cellStateStorage = [
  device.createBuffer({
    label: "Cell State A",
    size: cellStateArray.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  }),
  device.createBuffer({
    label: "Cell State B",
     size: cellStateArray.byteLength,
     usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
];


//initialize cell state array
/*
// Mark every third cell of the first grid as active.
for (let i = 0; i < cellStateArray.length; i+=3) {
  cellStateArray[i] = i;
}
device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);

// Mark every other cell of the second grid as active.
for (let i = 0; i < cellStateArray.length; i++) {
  cellStateArray[i] = i % 2;
}
device.queue.writeBuffer(cellStateStorage[1], 0, cellStateArray);
*/
// Set each cell to a random state, then copy the JavaScript array 
// into the storage buffer.
for (let i = 0; i < cellStateArray.length; ++i) {
  cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
}
device.queue.writeBuffer(cellStateStorage[0], 0, cellStateArray);


//GPUBindGroup, bind groups connect uniform in the shader
//	collection of resources for shader to access, cant change resources in bind group but you can change their contents
/*
const bindGroup = device.createBindGroup({
  label: "Cell renderer bind group",
  layout: cellPipeline.getBindGroupLayout(0),	//types of resources included, layout: "auto" works with bind group layout from
												//	bindings declared in shader code itself, then you use getBindGroupLayout(0) 0 via @group(0)
  entries: [{
		binding: 0,									//corresponds with @binding() value in shader
		resource: { buffer: uniformBuffer }			//actual resource to expose at binding index
	},
	{
		binding: 1,							// number has to match binding number in shader
		resource: { buffer: cellStateStorage } 
	}],
});
*/


// Create the bind group layout and pipeline layout.
const bindGroupLayout = device.createBindGroupLayout({
  label: "Cell Bind Group Layout",
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,	//visibility is GPUShaderStage flags that indicate which shader stages can use resource
    buffer: {} //buffer key, other options are things like "texture" or "sampler", default is uniform (like for our grid uniform buffer), leave empty for binding 0
  }, {
    binding: 1,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
    buffer: { type: "read-only-storage"} // Cell state input buffer
  }, {
    binding: 2,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { type: "storage"} // Cell state output buffer, storage because you do need RW access
  }]
});

//multi bind group
const bindGroups = [
  device.createBindGroup({
    label: "Cell renderer bind group A",
    layout: bindGroupLayout, //OLD: cellPipeline.getBindGroupLayout(0),
    entries: [{
      binding: 0,
      resource: { buffer: uniformBuffer }	//buffer key, other options are things like "texture" or "sampler"
    }, {
      binding: 1,
      resource: { buffer: cellStateStorage[0] }
    }, {
      binding: 2, // New Entry
      resource: { buffer: cellStateStorage[1] }
    }],
  }),
   device.createBindGroup({
    label: "Cell renderer bind group B",
    layout: bindGroupLayout,
    entries: [{
      binding: 0,
      resource: { buffer: uniformBuffer }
    }, {
      binding: 1,
      resource: { buffer: cellStateStorage[1] }
    }, {
      binding: 2, // New Entry
      resource: { buffer: cellStateStorage[0] }
    }],
  })
];

const pipelineLayout = device.createPipelineLayout({
  label: "Cell Pipeline Layout",
  bindGroupLayouts: [ bindGroupLayout ],
});

//finally creating render pipeline
const cellPipeline = device.createRenderPipeline({
	label: "Cell pipeline",
	layout: pipelineLayout,				// types of inputs other than vertex buffers needed can be passed, can be "auto"
	vertex: {							// vertex stage details
		module: cellShaderModule,		// 
		entryPoint: "vertexMain",		// our name of function, as you can have multiple vertex/fragment functions in one shader module
		buffers: [vertexBufferLayout]	// GPUVertexBufferLayout that describe data packed into vertex buffers used
	},
	fragment: {							// fragment stage details
		module: cellShaderModule,		
		entryPoint: "fragmentMain",
		targets: [{						// array of dictionaries giving details (like the texture "format") of color attachments pipeline outputs to
		format: canvasFormat			// we used textures from canvas context, and value saved from canvasFormat for format, so pass the same here
		}]
	}
});

// Create a compute pipeline that updates the game state.
const simulationPipeline = device.createComputePipeline({
  label: "Simulation pipeline",
  layout: pipelineLayout,	//allows for use of same bind groups as the renderpipeline
  compute: {
    module: simulationShaderModule,
    entryPoint: "computeMain",
  }
});

// Move all of our rendering code into a function
function updateGridPass() {
	
	const encoder3 = device.createCommandEncoder();
	
	// Start a compute pass 
	const computePass = encoder3.beginComputePass();	//do before render pass so RP can take latest CP results
	
	computePass.setPipeline(simulationPipeline);
	computePass.setBindGroup(0, bindGroups[step % 2]);	//same bind groups as rendering pass
	const workgroupCount = Math.ceil(GRID_SIZE / WORKGROUP_SIZE);
	computePass.dispatchWorkgroups(workgroupCount, workgroupCount);	//not number of invocations, its number of workgroups to execute (DEFINED IN SHADER)
																	// if workload isnt even divisor of workgroup size, then you can round up and have an early return with 
																	// a "global_invocation_id" check in the shader itself
	
	computePass.end();
	
	step++; // Increment the step count, done between compute and render so output buffer of compute pipeline is input buffer for render pipeline
	
	// Start a render pass 
	const pass3 = encoder3.beginRenderPass({
		colorAttachments: [{
		view: context.getCurrentTexture().createView(),
		loadOp: "clear",
		clearValue: { r: 0, g: 0, b: 0.4, a: 1.0 },
		storeOp: "store",
		}]
	});

	pass3.setPipeline(cellPipeline);			// shaders used, layout of vertex data, other relevant state data
	pass3.setVertexBuffer(0, vertexBuffer);		// bugger containing vertices for square, with 0th element in cellPipeline's vertex.buffers definition 
	//pass3.setBindGroup(0, bindGroup);			// 0 for @group(0) in shader code, and @binding part of it
	pass3.setBindGroup(0, bindGroups[step % 2]);
	pass3.draw(vertices.length / vertDim, GRID_SIZE * GRID_SIZE);		// passed in is number of vertices to render, 12 floats / coords per float = 6 vertices
																		//	second arg is number of instances of this draw call
	pass3.end();

	device.queue.submit([encoder3.finish()]);
}

//built in function to run a function at a set interval
setInterval(updateGridPass, UPDATE_INTERVAL);