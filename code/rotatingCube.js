import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import {postEffectPass} from './postEffectPass.js'
import * as primitives from '../models/primitives.js'

import { vf_p_generic3D } from '../shaders/js/vf_p_generic.js'

//----------------CANVAS-----------------------
const devicePixelRatio = window.devicePixelRatio;
canvas.width = canvas.clientWidth * devicePixelRatio;
canvas.height = canvas.clientHeight * devicePixelRatio;

//---------------OBJ MODEL---------------------
const vertDim = 3; //primitives.pIslandHouse.dimensions;

//---------------VERT BUF ARRAYS----------------
const vertStride = vertDim * 4;	//4 for number of bytes in a float
const normStride = vertDim * 4;	//4 for number of bytes in a float
const uvStride = 2 * 4;	//4 for number of bytes in a float
const totalStride = vertStride + uvStride + normStride;	//4 for number of bytes in a float

//--------------------TIME---------------------
let step = 0; // Track how many simulation steps have been run

//---------------------TRS---------------------
let camPosX = 0.0;
let camPosY = 40.0;
let camPosZ = 150.0;
const camFarPlane = 500.0;
const camNearPlane = 1.0;

//-----------------SUN SETTINGS----------------
const sunPosX = 0.0;
const sunPosY = 400.0;
const sunPosZ = 0.5;
const sunPosWS = vec3.create(sunPosX, sunPosY, sunPosZ);
const sunColor = vec3.create(1.0, 1.0, 0.9);
const sunIntensity = 0.5;
const sunPadding = 1.0;

function radToDeg(rad) {
	return rad * (180.0 / Math.PI);
}

function degToRad(degrees) {
	return degrees * Math.PI / 180.0;
}

function updateCameraPosition() {
	const now = Date.now() / 1000;
	//spin the camera around 0
	const radius = 150.0;
	camPosX = (Math.cos(now) * radius); 
	camPosZ = (Math.sin(now) * radius); 
}

const aspect = canvas.width / canvas.height;
const projectionMatrix = mat4.perspective((2 * Math.PI) / 5, aspect, camNearPlane, camFarPlane);

function getViewMatrix() {
	return mat4.lookAt([camPosX, camPosY, camPosZ],
					   [0,		 0,		  0],
					   [0,		 1,		  0]);
}

function getModelMatrix(t, r, s) { 
	const modelMatrix = mat4.create();
	mat4.identity(modelMatrix);
	//trs
	mat4.translate(modelMatrix, vec3.fromValues(t[0],t[1],t[2]), modelMatrix);
	mat4.rotateX( modelMatrix, degToRad(r[0]), modelMatrix);
	mat4.rotateY( modelMatrix,  degToRad(r[1]), modelMatrix);
	mat4.rotateZ( modelMatrix, degToRad(r[2]), modelMatrix);
	mat4.scale( modelMatrix, vec3.fromValues(s[0],s[1],s[2]), modelMatrix);

	return modelMatrix;
}

function getMatrixTransformSpaces(model) {
  const spaceBuffer = [];
  const now = Date.now() / 1000;

  const viewMatrix = getViewMatrix();
  const modelMatrix = getModelMatrix(model.worldTranslation, model.worldRotation, model.worldScale);
  const modelViewMat = mat4.mul(viewMatrix, modelMatrix);
  const modelViewProjectionMatrix = mat4.mul(projectionMatrix, modelViewMat);
  var normalMat = mat4.create();
  normalMat = mat4.transpose(mat4.invert(modelMatrix));
  //normalMat = mat4.transpose(mat4.invert(modelViewMat));
  
  for(let i = 0; i < 16; i++) {
	  spaceBuffer.push(modelViewProjectionMatrix[i]);
  }
  for(let i = 0; i < 16; i++) {
	  spaceBuffer.push(normalMat[i]);
  }
  
  return new Float32Array(spaceBuffer);
}

function getLightsInfo() {
	const lightsBuffer = [];
	
	const sunPosViewSpace = vec3.transformMat4(sunPosWS, getViewMatrix());
	lightsBuffer.push(sunPosViewSpace[0]);
	lightsBuffer.push(sunPosViewSpace[1]);
	lightsBuffer.push(sunPosViewSpace[2]);
	lightsBuffer.push(1.0);//uniform buffers HATE vec3f, keep it to scalars, 2, and 4 bytes. Otherwise shit will break.
	
	lightsBuffer.push(sunColor[0]);
	lightsBuffer.push(sunColor[1]);
	lightsBuffer.push(sunColor[2]);
	lightsBuffer.push(1.0);//uniform buffers HATE vec3f, keep it to scalars, 2, and 4 bytes. Otherwise shit will break.
	
	lightsBuffer.push(sunIntensity);
	
	
	return new Float32Array(lightsBuffer);
}

//-------------------MAIN-----------------------

//function should return GPUShaderModule object if compiled with valid results, code itself is WGSL
const genericShaderModule = device.createShaderModule({
label: "generic vf shader",
code: vf_p_generic3D
});

function loadModel(vertices, faces, normals, uvs) {
	const positions = [];
	for(let posCount = 0; posCount < (vertices.length / vertDim); posCount++)
	{
		positions[posCount] = [vertices[(posCount * vertDim) + 0], vertices[(posCount * vertDim) + 1], vertices[(posCount * vertDim) + 2]];
	}
	//console.log("---position list-----");
	//console.log(positions);
	
	const uvSplitting = [];
	for(let uvsCount = 0; uvsCount < (uvs.length / 2); uvsCount++)
	{
		uvSplitting[uvsCount] = [uvs[(uvsCount * 2) + 0], uvs[(uvsCount * 2) + 1]];
	}
	//console.log("---uvs list-----");
	//console.log(uvSplitting);
	
	const normalSplitting = [];
	for(let normCount = 0; normCount < (normals.length / vertDim); normCount++)
	{
		normalSplitting[normCount] = [normals[(normCount * vertDim) + 0], normals[(normCount * vertDim) + 1], normals[(normCount * vertDim) + 2]];
	}
	//console.log("---normals list-----");
	//console.log(normalSplitting);
	
	
	const result = [];
	//for the entire length of faces (ordered v1,vt1,vn1,v2,vt2,vn2,...) assign accordingly
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
	
	return result;
}

const entityModelsStride = [];

function loadModelsToVBArray(entityModelList, modelCount, name) {
	const result = [];
	console.log("Vertex Buffer Array Model Load Function:" , name);	
	
	for(let i = 0; i < modelCount; ++i)
	{
		const tempModelArray = loadModel(entityModelList[i].vertices,
										entityModelList[i].faces,
										entityModelList[i].normals,
										entityModelList[i].uvs);
		for(let j = 0; j < tempModelArray.length; ++j)
		{
			result.push(tempModelArray[j]);
		}
		entityModelsStride.push(tempModelArray.length);
		console.log("Model: ", i, "  Array Total Stride: ", tempModelArray.length);
	}
	
	return new Float32Array(result);
}

const entityModels = [];
entityModels.push(primitives.pIslandHouse);
entityModels.push(primitives.pBench);
entityModels.push(primitives.pGround);
entityModels.push(primitives.pWavePlane);
console.log(entityModels);
const genericShaderVertexBufferArray = loadModelsToVBArray(entityModels, entityModels.length, "generic shader VBA");

//-----------------VB OF GENERIC SHADER MODELS-----------------------
//GPU Side memory management done through GPUBuffer objects
const vertexBuffer = device.createBuffer({
	label: "generic model vertices",		//just helps to identify object, can be anything you type
	size: genericShaderVertexBufferArray.byteLength,	//for 12 float vertices thats 48 bytes, cant be resized after creation
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,	//its use is for vertex data, and that you want to copy data into it
});

//copy vertex data to buffer
device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/0, genericShaderVertexBufferArray);


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

//-----------------Buffer Binding-----------------------

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

const singleObjectUniformArraySpacesSize = 128; //(4 * 4 * 4) + (4 * 4 * 4) 4x4 matrix for MVP + normal
const uboOffset = 256;	//this is a defaulted max for UBO, nothing I wrote equals up to 256, its a limiter
const totalUniformArraySpacesSize = (uboOffset * (entityModels.length - 1)) + (singleObjectUniformArraySpacesSize * (entityModels.length));	// !!!!! Check this !!!!!
//const totalUniformArraySpacesSize = uboOffset + singleObjectUniformArraySpacesSize;

const uniformBufferSpaces = device.createBuffer({
  label: "3D Space Transformations Uniform Buffer",
  size: totalUniformArraySpacesSize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

const uniformArrayLights = 48; //(4 * 4) + (4 * 4) + 4 + 12   vec4 + vec4 + scalar + padding to 48
const uniformBufferLights = device.createBuffer({
  label: "Lights Uniform Buffer",
  size: uniformArrayLights,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

//GPUBindGroup, bind groups connect uniform in the shader
//	collection of resources for shader to access, cant change resources in bind group but you can change their contents

// Create the bind group layout and pipeline layout.
const bindGroupLayout = device.createBindGroupLayout({
  label: "Bind Group Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,	//visibility is GPUShaderStage flags that indicate which shader stages can use resource
    buffer: {} //buffer key, other options are things like "texture" or "sampler", default is uniform, leave empty for binding 0
  },
  {
    binding: 1,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
    buffer: {}
  }
  ]
});

//multi bind group

function createGenericBindGroups(numModels){
	//essentially we want a bind group per model, and thats okay
	//	its only not okay if we use different groups per instance of the same model, then its inefficient
	
	const result = [];
	for(let i = 0; i < numModels; ++i) {
		
			result.push(device.createBindGroup({
				label: "renderer generic model uniform bind group",
				layout: bindGroupLayout,
				entries: [
				{
				binding: 0,
				resource: { buffer: uniformBufferSpaces, offset: i * uboOffset, size: singleObjectUniformArraySpacesSize, }	//buffer key, other options are things like "texture" or "sampler"
				},
				{
				binding: 1,
				resource: { buffer: uniformBufferLights }
				}],
			}));
			
			console.log("Generic Bind Group Buffer offset: ", i * uboOffset);
	}
	
	return result;
}

const bindGroups = createGenericBindGroups(entityModels.length);

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


function genericUniformBufferUpdates(models) {
	for(let i = 0; i < models.length; ++i)
	{	
		const spaceTrans = getMatrixTransformSpaces(models[i]);

		device.queue.writeBuffer(uniformBufferSpaces, 
								i * uboOffset,	//apparently uniform buffer size defaults to a need of 256 
								spaceTrans.buffer,
								spaceTrans.byteOffset,
								spaceTrans.byteLength);
	}
	
	const lights = getLightsInfo();
	device.queue.writeBuffer(uniformBufferLights, 
								0, 
								lights.buffer,
								lights.byteOffset,
								lights.byteLength);
}


// Move all of our rendering code into a function
export function updateRotatingCubePass() {
	
	const encoder = device.createCommandEncoder();
	
	//compute section
	//postEffectPass(encoder, bindGroups, step);
	
	step++; // Increment the step count, done between compute and render so output buffer of compute pipeline is input buffer for render pipeline
	
	//update camera Position
	updateCameraPosition();
	
	//generate per-draw uniforms (not with dynamic uniform buffers though)
	genericUniformBufferUpdates(entityModels);
	
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
	
	//generic shader pass
	pass.setVertexBuffer(0, vertexBuffer);
	
	const VBAStrideOut = genericShaderVertexBufferArray.length / (totalStride / 4);
	const mod1 = entityModelsStride[0] / (totalStride / 4);
	const mod2 = entityModelsStride[1] / (totalStride / 4);
	const mod3 = entityModelsStride[2] / (totalStride / 4);
	const mod4 = entityModelsStride[3] / (totalStride / 4);
	
	//first object
	pass.setBindGroup(0, bindGroups[0]);
	pass.draw(mod1, 1);
	
	//second object
	pass.setBindGroup(0, bindGroups[1]);
	pass.draw(mod2, 1, mod1);
	
	//third object
	pass.setBindGroup(0, bindGroups[2]);
	pass.draw(mod3, 1, mod1 + mod2);
	
	//fourth object
	pass.setBindGroup(0, bindGroups[3]);
	pass.draw(mod4, 1, mod1 + mod2 + mod3);
	
	
	pass.end();

	device.queue.submit([encoder.finish()]);
}