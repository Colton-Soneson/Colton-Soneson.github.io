import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import {postEffectPassSSS} from './SSS.js'
import {postEffectPassTextureDebug_DEPTH32FLOAT} from './debugTextureDisplay.js'
import {postEffectPassTextureDebug_RGBA8UNORM} from './debugTextureDisplay.js'
import {postEffectPassTextureDebug_RGBA32FLOAT} from './debugTextureDisplay.js'
import {grassPass} from './computeGrass.js'
import {waterPass} from './water.js'
import {atmospherePass} from './atmosphere.js'

import * as primitives from '../models/primitives.js'
import * as shadowMapping from './shadowMapping.js'
import * as transformations from './transformations.js'
import * as scene from './scene.js'
import * as grass from './computeGrass.js'
import * as water from './water.js'
import { settings } from './settings.js';

import { vf_p_generic3D } from '../shaders/js/vf_p_generic.js'

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
	
	lightsBuffer.push(settings.debugViewMode);
	
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

//input tracking section
const pressedKeys = new Set();
let selectedEntity = 0;
let selectedSubEditMode = 0;
let selectedDebugDisplayMode = 0;
const editModes = ["translate","rotate","scale","camera","lighting","grass"];
const camSubEditModes = ["default"];
const lightSubEditModes = ["Sun Intensity","Shadow Map Kernel Size", "Shadow Map Acne Bias"];
const grassSubEditModes = ["Grass Total Blade Count"];
const debugDisplayModes = ["final", "shadow mapping visibility","water line topology","heightMap", "shadowMapDepth", "Oceanographic Spectrum", "h0(k)", "waveHeightRealization h(k,t)", "PreComp Twiddle Water", "finalWaveHeightFFT h(x,t) pre Shift", "finalWaveHeightFFT h(x,t) Shifted"];
let selectedEditMode = 0;
const rotSpeed = 1.0;
const transSpeed = 1.0;
const scaleSpeed = 0.1;
const camSpeed = 10.0;
const sunIntensitySpeed = 100.0;
window.addEventListener("keydown", function (event) {
	const keyPressed = event.key;
	
	switch(keyPressed){
		case "w": {
			if(selectedEditMode == 0) {
				scene.entityModels[selectedEntity].worldTranslation[2] -= transSpeed;
			}
			else if(selectedEditMode == 1) {
				scene.entityModels[selectedEntity].worldRotation[0] += rotSpeed;
			}
			else if(selectedEditMode == 2) {
				scene.entityModels[selectedEntity].worldScale[2] += scaleSpeed;
			}
			else if(selectedEditMode == 3) {
				settings.camPosZ -= camSpeed;
			}
			else {
				settings.sunPosZ -= camSpeed;
				if(settings.showDebug) {
					console.log("SunPos: ", settings.sunPosX, settings.sunPosY, settings.sunPosZ);
					if(settings.showDebugIcons) {
						scene.entityModels[scene.searchListIndexForEntityByName(scene.entityModels, "Test")].worldTranslation[2] = settings.sunPosZ;
					}
				}
			}
		}
		break;
		case "a": {
			if(selectedEditMode == 0) {
				scene.entityModels[selectedEntity].worldTranslation[0] -= transSpeed;
			}
			else if(selectedEditMode == 1) {
				scene.entityModels[selectedEntity].worldRotation[2] -= rotSpeed;
			}
			else if(selectedEditMode == 2) {
				scene.entityModels[selectedEntity].worldScale[0] -= scaleSpeed;
			}
			else if(selectedEditMode == 3) {
				settings.camPosX -= camSpeed;
			}
			else {
				settings.sunPosX -= camSpeed;
				if(settings.showDebug) {
					console.log("SunPos: ", settings.sunPosX, settings.sunPosY, settings.sunPosZ);
					if(settings.showDebugIcons) {
						scene.entityModels[scene.searchListIndexForEntityByName(scene.entityModels, "Test")].worldTranslation[0] = settings.sunPosX;
					}
				}
			}
		}
		break;
		case "s": {
			if(selectedEditMode == 0) {
				scene.entityModels[selectedEntity].worldTranslation[2] += transSpeed;
			}
			else if(selectedEditMode == 1) {
				scene.entityModels[selectedEntity].worldRotation[0] -= rotSpeed;
			}
			else if(selectedEditMode == 2) {
				scene.entityModels[selectedEntity].worldScale[2] -= scaleSpeed;
			}
			else if(selectedEditMode == 3) {
				settings.camPosZ += camSpeed;
			}
			else {
				settings.sunPosZ += camSpeed;
				if(settings.showDebug) {
					console.log("SunPos: ", settings.sunPosX, settings.sunPosY, settings.sunPosZ);
					if(settings.showDebugIcons) {
						scene.entityModels[scene.searchListIndexForEntityByName(scene.entityModels, "Test")].worldTranslation[2] = settings.sunPosZ;
					}
				}
			}
		}
		break;
		case "d": {
			if(selectedEditMode == 0) {
				scene.entityModels[selectedEntity].worldTranslation[0] += transSpeed;
			}
			else if(selectedEditMode == 1) {
				scene.entityModels[selectedEntity].worldRotation[2] += rotSpeed;
			}
			else if(selectedEditMode == 2) {
				scene.entityModels[selectedEntity].worldScale[0] += scaleSpeed;
			}
			else if(selectedEditMode == 3) {
				settings.camPosX += camSpeed;
			}
			else {
				settings.sunPosX += camSpeed;
				if(settings.showDebug) {
					console.log("SunPos: ", settings.sunPosX, settings.sunPosY, settings.sunPosZ);
					if(settings.showDebugIcons) {
						scene.entityModels[scene.searchListIndexForEntityByName(scene.entityModels, "Test")].worldTranslation[0] = settings.sunPosX;
					}
				}
			}
		}
		break;
		case "q": {
			if(selectedEditMode == 0) {
				scene.entityModels[selectedEntity].worldTranslation[1] -= transSpeed;
			}
			else if(selectedEditMode == 1) {
				scene.entityModels[selectedEntity].worldRotation[1] -= rotSpeed;
			}
			else if(selectedEditMode == 2) {
				scene.entityModels[selectedEntity].worldScale[1] -= scaleSpeed;
			}
			else if(selectedEditMode == 3) {
				settings.camPosY -= camSpeed;
			}
			else {
				settings.sunPosY -= camSpeed / 2.0;
				if(settings.showDebug) {
					console.log("SunPos: ", settings.sunPosX, settings.sunPosY, settings.sunPosZ);
					if(settings.showDebugIcons) {
						scene.entityModels[scene.searchListIndexForEntityByName(scene.entityModels, "Test")].worldTranslation[1] = settings.sunPosY;
					}
				}
			}
		}
		break;
		case "e": {
			if(selectedEditMode == 0) {
				scene.entityModels[selectedEntity].worldTranslation[1] += transSpeed;
			}
			else if(selectedEditMode == 1) {
				scene.entityModels[selectedEntity].worldRotation[1] += rotSpeed;
			}
			else if(selectedEditMode == 2) {
				scene.entityModels[selectedEntity].worldScale[1] += scaleSpeed;
			}
			else if(selectedEditMode == 3) {
				settings.camPosY += camSpeed;
			}
			else {
				settings.sunPosY += camSpeed / 2.0;
				if(settings.showDebug) {
					console.log("SunPos: ", settings.sunPosX, settings.sunPosY, settings.sunPosZ);
					if(settings.showDebugIcons) {
						scene.entityModels[scene.searchListIndexForEntityByName(scene.entityModels, "Test")].worldTranslation[1] = settings.sunPosY;
					}
				}
			}
		}
		break;
		case "r": {
			if(selectedEditMode == 4) {
				if(selectedSubEditMode == 0)
				{
					settings.sunIntensity -= sunIntensitySpeed;
					console.log("Sun Intensity: ", settings.sunIntensity)
				}
				else if(selectedSubEditMode == 1)
				{
					settings.shadowMapPCFKernelSize -= 1;
					console.log("ShadowMap PCF Kernel Size: ", settings.shadowMapPCFKernelSize)
				}
				else
				{
					settings.shadowMapAcneBias -= 0.0005;
					console.log("ShadowMap Acne Bias: ", settings.shadowMapAcneBias)
				}
			}
			if(selectedEditMode == 5) {
				if(selectedSubEditMode == 0)
				{
					if(1 <= settings.grassTotalBladeCount) {
						settings.grassTotalBladeCount /= 2;
						grass.grassUpdateStorageVertexBuffer();
						console.log("Grass Total Blade Count: ", settings.grassTotalBladeCount)
					}
				}
			}
		}
		break;
		case "t": {
			if(selectedEditMode == 4) {
				if(selectedSubEditMode == 0)
				{
					settings.sunIntensity += sunIntensitySpeed;
					console.log("Sun Intensity: ", settings.sunIntensity)
				}
				else if(selectedSubEditMode == 1)
				{
					settings.shadowMapPCFKernelSize += 1;
					console.log("ShadowMap PCF Kernel Size: ", settings.shadowMapPCFKernelSize)
				}
				else
				{
					settings.shadowMapAcneBias += 0.0005;
					console.log("ShadowMap Acne Bias: ", settings.shadowMapAcneBias)
				}
			}
			if(selectedEditMode == 5) {
				if(selectedSubEditMode == 0)
				{
					if(settings.grassTotalHARDLIMIT > settings.grassTotalBladeCount) {
						settings.grassTotalBladeCount *= 2;
						grass.grassUpdateStorageVertexBuffer();
						console.log("Grass Total Blade Count: ", settings.grassTotalBladeCount);
					}
					else {
						console.log("Restriction: Hit blade count hard limit: ", settings.grassTotalBladeCount, settings.grassTotalHARDLIMIT);
					}
				}
			}
		}
		break;
		case "c": {
			if(selectedDebugDisplayMode < debugDisplayModes.length - 1) {
				selectedDebugDisplayMode++;
			}
			else {
				selectedDebugDisplayMode = 0;
			}
			settings.debugViewMode = selectedDebugDisplayMode;
			
			if(selectedDebugDisplayMode == 2) {	//water line topology
				water.waterPipelineSignalUpdate('line-list');
			}
			else {
				water.waterPipelineSignalUpdate('triangle-list');
			}
			
			if(selectedDebugDisplayMode == 3) {
				settings.displayHeightMap = true;
			}
			else {
				settings.displayHeightMap = false;
			}
			
			if(selectedDebugDisplayMode == 4) {
				settings.displayShadowMapDepth = true;
			}
			else {
				settings.displayShadowMapDepth = false;
			}
			
			if(selectedDebugDisplayMode == 5) {
				settings.displayOceanSpectrum = true;
			}
			else {
				settings.displayOceanSpectrum = false;
			}
			
			if(selectedDebugDisplayMode == 6) {
				settings.displayWaterInitialHeight = true;
			}
			else {
				settings.displayWaterInitialHeight = false;
			}
			
			if(selectedDebugDisplayMode == 7) {
				settings.displayWaveHeightRealization = true;
			}
			else {
				settings.displayWaveHeightRealization = false;
			}
			
			if(selectedDebugDisplayMode == 8) {
				settings.displayWaterPreComp = true;
			}
			else {
				settings.displayWaterPreComp = false;
			}
			
			if(selectedDebugDisplayMode == 9) {
				settings.displayWaterFFT = true;
			}
			else {
				settings.displayWaterFFT = false;
			}
			
			if(selectedDebugDisplayMode == 10) {
				settings.displayWaterShifted = true;
			}
			else {
				settings.displayWaterShifted = false;
			}
			
			console.log("DEBUG DISPLAY MODE: ", debugDisplayModes[selectedDebugDisplayMode]);
		}
		break;
		case "p": {
			settings.enablePostEffects = !settings.enablePostEffects;
			console.log("Post Effects Enabled: ", settings.enablePostEffects);
		}
		break;
		case "ArrowLeft": {
			if(selectedEditMode == 0 || selectedEditMode == 1 || selectedEditMode == 2)
			{
				if(selectedEntity >= 1) {
					selectedEntity--;
				}
				else {
					selectedEntity = scene.entityModels.length - 1;
				}
				console.log("Selected Entity: ", scene.entityModels[selectedEntity].name);
			}
			else if(selectedEditMode == 3)
			{
				if(selectedSubEditMode >= 1) {
					selectedSubEditMode--;
				}
				else {
					selectedSubEditMode = camSubEditModes.length - 1;
				}
				console.log("Selected Camera Sub Edit Mode: ", camSubEditModes[selectedSubEditMode]);
			}
			else if(selectedEditMode == 4)
			{
				if(selectedSubEditMode >= 1) {
					selectedSubEditMode--;
				}
				else {
					selectedSubEditMode = lightSubEditModes.length - 1;
				}
				console.log("Selected Lighting Sub Edit Mode: ", lightSubEditModes[selectedSubEditMode]);
			}
			else if(selectedEditMode == 5)
			{
				if(selectedSubEditMode >= 1) {
					selectedSubEditMode--;
				}
				else {
					selectedSubEditMode = grassSubEditModes.length - 1;
				}
				console.log("Selected Grass Sub Edit Mode: ", grassSubEditModes[selectedSubEditMode]);
			}
		}
		break;
		case "ArrowRight": {
			if(selectedEditMode == 0 || selectedEditMode == 1 || selectedEditMode == 2)
			{
				if(selectedEntity < scene.entityModels.length - 1) {
					selectedEntity++;
				}
				else {
					selectedEntity = 0;
				}
				console.log("Selected Entity: ", scene.entityModels[selectedEntity].name);
			}
			else if(selectedEditMode == 3)
			{
				if(selectedSubEditMode < camSubEditModes.length - 1) {
					selectedSubEditMode++;
				}
				else {
					selectedSubEditMode = 0;
				}
				console.log("Selected Camera Sub Edit Mode: ", camSubEditModes[selectedSubEditMode]);
			}
			else if(selectedEditMode == 4)
			{
				if(selectedSubEditMode < lightSubEditModes.length - 1) {
					selectedSubEditMode++;
				}
				else {
					selectedSubEditMode = 0;
				}
				console.log("Selected Lighting Sub Edit Mode: ", lightSubEditModes[selectedSubEditMode]);
			}
			else if(selectedEditMode == 5)
			{
				if(selectedSubEditMode < grassSubEditModes.length - 1) {
					selectedSubEditMode++;
				}
				else {
					selectedSubEditMode = 0;
				}
				console.log("Selected Grass Sub Edit Mode: ", grassSubEditModes[selectedSubEditMode]);
			}
		}
		break;
		case "ArrowDown": {
			selectedSubEditMode = 0;
			if(selectedEditMode >= 1) {
				selectedEditMode--;
			}
			else {
				selectedEditMode = editModes.length - 1;
			}
			console.log("Selected Edit Mode: ", editModes[selectedEditMode]);
		}
		break;
		case "ArrowUp": {
			selectedSubEditMode = 0;
			if(selectedEditMode < editModes.length - 1) {
				selectedEditMode++;
			}
			else {
				selectedEditMode = 0;
			}
			console.log("Selected Edit Mode: ", editModes[selectedEditMode]);
		}
		break;
	}
});


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
	
	//step++; // Increment the step count, done between compute and render so output buffer of compute pipeline is input buffer for render pipeline
	
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
	
	device.queue.submit([encoderDebug.finish()]);
	
}