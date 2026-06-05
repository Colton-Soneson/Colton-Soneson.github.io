import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import {postEffectPassSSS} from './SSS.js'
import {postEffectPassTextureDebug_DEPTH32FLOAT} from './debugTextureDisplay.js'
import {postEffectPassTextureDebug_RGBA8UNORM} from './debugTextureDisplay.js'
import {postEffectPassTextureDebug_RGBA32FLOAT} from './debugTextureDisplay.js'
import {postEffectPassTextureDebug_RGBA16FLOAT} from './debugTextureDisplay.js'
import {grassPass} from './computeGrass.js'
import {waterPass} from './water.js'
import {atmospherePass} from './atmosphere.js'

import * as primitives from '../models/primitives.js'
import * as shadowMapping from './shadowMapping.js'
import * as transformations from './transformations.js'
import * as scene from './scene.js'
import * as grass from './computeGrass.js'
import * as water from './water.js'
import * as atmosphere from './atmosphere.js'
import { settings } from './settings.js';
import * as userInterface from './imguiLoader.js';

import { vf_p_generic3D } from '../shaders/js/vf_p_generic.js'

//-----------------BASIC LIGHTING--------------------
function getLightsInfo() {
	const lightsBuffer = [];

	const lightViewProjMat = transformations.getLightViewProjectionMat();
	
	for(let i = 0; i < 16; ++i) {
		lightsBuffer.push(lightViewProjMat[i]);
	}
	
	lightsBuffer.push(settings.sunPosX);
	lightsBuffer.push(settings.sunPosY);
	lightsBuffer.push(settings.sunPosZ);
	lightsBuffer.push(1.0);//uniform buffers HATE vec3f, keep it to scalars, 2, and 4 bytes. Otherwise shit will break.
	
	lightsBuffer.push(settings.sunColor[0]);
	lightsBuffer.push(settings.sunColor[1]);
	lightsBuffer.push(settings.sunColor[2]);
	lightsBuffer.push(1.0);//uniform buffers HATE vec3f, keep it to scalars, 2, and 4 bytes. Otherwise shit will break.
	
	lightsBuffer.push(settings.sunIntensity);
	
	lightsBuffer.push(settings.shadowMapPCFKernelSize);
	
	lightsBuffer.push(settings.shadowMapSize);
	
	lightsBuffer.push(settings.shadowMapAcneBias);
	
	lightsBuffer.push(settings.displayLightingMode);
	
	return new Float32Array(lightsBuffer);
}
//-------------------MAIN-----------------------

//function should return GPUShaderModule object if compiled with valid results, code itself is WGSL
const genericShaderModule = device.createShaderModule({
label: "generic vf shader",
code: vf_p_generic3D
});

//-------------------UBO--------------------------------
const uboOffset = 256;	//this is a defaulted max for UBO, nothing I wrote equals up to 256, its a limiter
const singleObjectUniformArraySpacesSize = 192; //(4 * 4 * 4) + (4 * 4 * 4) + (4 x 4 x 4) 4x4 matrix for MVP + iMV + normal
const totalUniformArraySpacesSize = (uboOffset * (scene.entityModels.length - 1)) + (singleObjectUniformArraySpacesSize * (scene.entityModels.length));	// !!!!! Check this !!!!!
const uniformBufferSpaces = device.createBuffer({
  label: "3D Space Transformations Uniform Buffer",
  size: totalUniformArraySpacesSize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

//lights
const uniformArrayLights = 128; //(4 * 4 * 4) + (4 * 4) + (4 * 4) + 4 + 4 + 4 + 4 + 4 + 12   mat4 + vec4 + vec4 + scalar + scalar + scalar + scalar + scalar + padding to 128
const uniformBufferLights = device.createBuffer({
  label: "Lights Uniform Buffer",
  size: uniformArrayLights,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

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

//GPUBindGroup, bind groups connect uniform in the shader
//	collection of resources for shader to access, cant change resources in bind group but you can change their contents

// Create the bind group layout and pipeline layout.
const bindGroupLayout = device.createBindGroupLayout({
  label: "Uniform Bind Group Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,	//visibility is GPUShaderStage flags that indicate which shader stages can use resource
    buffer: {}, //buffer key, other options are things like "texture" or "sampler", default is uniform, leave empty for binding 0
	//resource: { type: 'uniform-buffer' }
  },
  {
    binding: 1,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
    buffer: {},
	//resource: { type: 'uniform-buffer' }
  },
  {
    binding: 2,
    visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,
    texture: {
		sampleType: 'float',
		viewDimension: '2d',
		multiSample: false,
	},
	//resource: { type: 'sampled-texture', viewDimension: '2d', textureSampleType: 'float' }
  },
  {
    binding: 3,
    visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE,	//not sure if sampler is allowed on compute
    sampler: {
		type: 'filtering',
	},
	//resource: { type: 'sampler' }
  },
  {
    binding: 4,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    texture: {
		sampleType: 'depth',
		//viewDimension: '2d',
		//multiSample: false, 
	},
	//resource: { type: 'sampled-texture', viewDimension: '2d', textureSampleType: 'float' }
  },
  {
    binding: 5,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,	//not sure if sampler is allowed on compute
    sampler: {
		type: 'comparison',		//check if this needs to be chagned
	},
	//resource: { type: 'sampler' }
  }]
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
				},
				{
				binding: 2,
				resource: scene.modelsTexturesList[i].createView()
				},
				{
				binding: 3,
				resource: linSampler 
				},
				{
				binding: 4,
				resource: shadowMapping.shadowMapView
				},
				{
				binding: 5,
				resource: shadowMapping.shadowMapSampler
				}],
			}));
			
			console.log("Generic Bind Group Buffer offset: ", i * uboOffset);
	}
	
	return result;
}

const bindGroups = createGenericBindGroups(scene.entityModels.length);

const shadowMapBindGroups = shadowMapping.createShadowMapBindGroups(scene.entityModels.length);

const heightMapBindGroups = scene.createHeightMapBindGroups(scene.entityModels.length);

const pipelineLayout = device.createPipelineLayout({
  label: "Generic Pipeline Layout",
  bindGroupLayouts: [ bindGroupLayout ],
});

//---------------------PIPELINES----------------------
const genericPipeline = device.createRenderPipeline({
	label: "Generic pipeline",
	layout: pipelineLayout,				// types of inputs other than vertex buffers needed can be passed, can be "auto"
	vertex: {							// vertex stage details
		module: genericShaderModule,	
		entryPoint: "vertexMain",		// our name of function, as you can have multiple vertex/fragment functions in one shader module
		buffers: [scene.vertexBufferLayout]	// GPUVertexBufferLayout that describe data packed into vertex buffers used
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
		const spaceTrans = transformations.getMatrixTransformSpaces(models[i], 1);

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

//skybox
function updateSkyboxPosition(skyboxEntity)
{
	skyboxEntity.worldTranslation[0] = settings.camPosX;
	skyboxEntity.worldTranslation[1] = 0.0;
	skyboxEntity.worldTranslation[2] = settings.camPosZ;
}

// Move all of our rendering code into a function
export function updateRotatingCubePass() {
	
	const encoder = device.createCommandEncoder();
	
	// ImGUI setting updates
	userInterface.refreshControlsUI();
	userInterface.refreshEntityFolder();
	
	//update skybox to position onto camera
	if(settings.activateSkybox) {
		updateSkyboxPosition(scene.entityModels[scene.entityModels.length - 1]);
	}
	
	//generate per-draw uniforms (not with dynamic uniform buffers though)
	genericUniformBufferUpdates(scene.entityModels);
	
	shadowMapping.shadowMapUniformBufferUpdates(scene.entityModels);
	
	//to go through models
	let prevModCombo = 0;
	
	//-------------SHADOW PASS------------------
	const shadowPass = encoder.beginRenderPass({
		colorAttachments: [],
		depthStencilAttachment: {
			view: shadowMapping.shadowMapView,
			depthStoreOp: 'store',
			depthLoadOp: 'clear',
			depthClearValue: 1.0,
		},
	});
	
	shadowPass.setPipeline(shadowMapping.shadowMapPipeline);
	
	shadowPass.setVertexBuffer(0, scene.vertexBuffer);
	
	for(let i = 0; i < scene.entityModels.length; ++i)
	{
		let mod = scene.entityModelsStride[i] / (primitives.totalStride / 4);
		shadowPass.setBindGroup(0, shadowMapBindGroups[i]);
		shadowPass.draw(mod, 1, prevModCombo);
		prevModCombo += mod;
	}
	prevModCombo = 0;
	
	shadowPass.end();
	
	
	//-------------HEIGHT PASS------------------
	
	//update the heightmap
	scene.heightMapUniformBufferUpdates(scene.entityModels);
	
	const heightPass = encoder.beginRenderPass({
		colorAttachments: [],
		depthStencilAttachment: {
			view: scene.heightMapView,
			depthStoreOp: 'store',
			depthLoadOp: 'clear',
			depthClearValue: 1.0,
		},
	});
	
	heightPass.setPipeline(scene.heightMapPipeline);
	
	heightPass.setVertexBuffer(0, scene.vertexBuffer);
	
	for(let i = 0; i < scene.entityModels.length; ++i)
	{
		let mod = scene.entityModelsStride[i] / (primitives.totalStride / 4);
		heightPass.setBindGroup(0, heightMapBindGroups[i]);
		heightPass.draw(mod, 1, prevModCombo);
		prevModCombo += mod;
	}
	prevModCombo = 0;
	
	heightPass.end();
	
	
	//-------------MAIN PASS------------------
	const pass = encoder.beginRenderPass({
		colorAttachments: [{
		view: context.getCurrentTexture().createView(),
		loadOp: "clear",
		clearValue: { r: 0.6, g: 0.6, b: 0.6, a: 1.0 },
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
	pass.setVertexBuffer(0, scene.vertexBuffer);
	
	
	for(let i = 0; i < scene.entityModels.length; ++i)
	{
		let mod = scene.entityModelsStride[i] / (primitives.totalStride / 4);
		pass.setBindGroup(0, bindGroups[i]);
		pass.draw(mod, 1, prevModCombo);
		prevModCombo += mod;
	}
	prevModCombo = 0;
		
	pass.end();
	
	//post effect section
	if(settings.enablePostEffects)
	{
		postEffectPassSSS(encoder, context.getCurrentTexture());
	}
	
	if(settings.enableGrass)
	{
		grassPass(encoder, depthTexture);
	}
	
	device.queue.submit([encoder.finish()]);
	
	if(settings.enableWater)
	{
		waterPass(depthTexture);
	}
	
	if(settings.enableAtmosphere)
	{
		atmospherePass(depthTexture);
	}
	
	const encoderDebug = device.createCommandEncoder();
	
	if(settings.displayHeightMap)
	{
		postEffectPassTextureDebug_DEPTH32FLOAT(encoderDebug, context.getCurrentTexture(), scene.heightMapDepthTexture, scene.heightMapSampler);
	}
	
	if(settings.displayShadowMapDepth) {
		postEffectPassTextureDebug_DEPTH32FLOAT(encoderDebug, context.getCurrentTexture(), shadowMapping.shadowMapDepthTexture, shadowMapping.shadowMapSampler);
	}
	
	if(settings.displayOceanSpectrum) {
		postEffectPassTextureDebug_RGBA32FLOAT(encoderDebug, context.getCurrentTexture(), water.phillipsSpectrumTexture);
	}
	
	if(settings.displayWaterInitialHeight) {
		postEffectPassTextureDebug_RGBA32FLOAT(encoderDebug, context.getCurrentTexture(), water.initialWaterHeightMap);
	}
	
	if(settings.displayWaveHeightRealization) {
		postEffectPassTextureDebug_RGBA32FLOAT(encoderDebug, context.getCurrentTexture(), water.hkt);
	}
	
	if(settings.displayWaterPreComp) {
		postEffectPassTextureDebug_RGBA32FLOAT(encoderDebug, context.getCurrentTexture(), water.preCompTexture);
	}
	
	if(settings.displayWaterFFT) {
		postEffectPassTextureDebug_RGBA32FLOAT(encoderDebug, context.getCurrentTexture(), water.preShiftFinalWaveHeightTexture);
	}
	
	if(settings.displayWaterShifted ) {
		postEffectPassTextureDebug_RGBA32FLOAT(encoderDebug, context.getCurrentTexture(), water.finalWaveHeightTexture);
	}
	
	if(settings.displaySkyViewLUTtexture) {
		postEffectPassTextureDebug_RGBA16FLOAT(encoderDebug, context.getCurrentTexture(), atmosphere.transmittanceLUTtexture);
	}
	
	if(settings.displayTransmittanceLUTtexture) {
		postEffectPassTextureDebug_RGBA16FLOAT(encoderDebug, context.getCurrentTexture(), atmosphere.skyViewLUTtexture);
	}
	
	// update the settings from changes made in render loop unless UI settings are changed directly
	if(!userInterface.guiActive) {
		userInterface.syncSettingsToParams();
	}

	device.queue.submit([encoderDebug.finish()]);
}