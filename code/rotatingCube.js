import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import {onRenderResize, setRenderSize} from './deviceSelection.js'
import {settledRenderSize, dynamicResolution} from './display.js'

import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import {screenEffectsPass} from './screenEffects.js'
import {fxaaPass} from './fxaa.js'
import {smaaPass} from './smaa.js'
import * as textureFiltering from './textureFiltering.js'
import {postEffectPassTextureDebug_DEPTH32FLOAT} from './debugTextureDisplay.js'
import {postEffectPassTextureDebug_RGBA8UNORM} from './debugTextureDisplay.js'
import {postEffectPassTextureDebug_RGBA32FLOAT} from './debugTextureDisplay.js'
import {postEffectPassTextureDebug_RGBA16FLOAT} from './debugTextureDisplay.js'
import {postEffectPassTextureDebug_R32FLOAT} from './debugTextureDisplay.js'
import {grassPass} from './computeGrass.js'
import {forestPass} from './forest.js'
import {waterPass} from './water.js'
import {atmospherePass} from './atmosphere.js'

import * as primitives from '../models/primitives.js'
import * as shadowMapping from './shadowMapping.js'
import * as transformations from './transformations.js'
import * as scene from './scene.js'
import * as grass from './computeGrass.js'
import * as water from './water.js'
import * as atmosphere from './atmosphere.js'
import * as terrain from './terrain.js'
import * as forest from './forest.js'
import * as boulders from './boulders.js'
import * as wind from './wind.js'
import * as clouds from './clouds.js'
import * as particles from './particles.js'
import * as lightShafts from './lightShafts.js'
import * as lightning from './lightning.js'
import * as birds from './birds.js'
import * as geese from './geese.js'
import * as deer from './deer.js'
import * as cameraControls from './cameraControls.js'
import * as hunting from './hunting.js'
import * as rifle from './rifle.js'
import * as ballistics from './ballistics.js'
import { settings } from './settings.js';
import * as userInterface from './imguiLoader.js';
import * as profiler from './profiler.js';
import { frameDrawn } from './loading.js';

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
	
	lightsBuffer.push(settings.camPosX);
	lightsBuffer.push(settings.camPosY);
	lightsBuffer.push(settings.camPosZ);
	lightsBuffer.push(1.0);
	
	lightsBuffer.push(settings.sunIntensity);
	
	lightsBuffer.push(settings.shadowMapPCFKernelSize);
	
	lightsBuffer.push(settings.shadowMapSize);
	
	lightsBuffer.push(settings.shadowMapAcneBias);
	
	lightsBuffer.push(settings.displayLightingMode);

	//the moon: which way it is and how bright (the 3 numbers before it are only there to start it on a 16 byte boundary, as a vec4f has to)
	lightsBuffer.push(0.0, 0.0, 0.0);
	const moonDistance = Math.hypot(settings.moonPosX, settings.moonPosY, settings.moonPosZ) || 1;
	lightsBuffer.push(settings.moonPosX / moonDistance);
	lightsBuffer.push(settings.moonPosY / moonDistance);
	lightsBuffer.push(settings.moonPosZ / moonDistance);
	lightsBuffer.push(settings.enableMoon ? settings.moonBrightness : 0.0);
	
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
const singleObjectUniformArraySpacesSize = 208; //(4 * 4 * 4) + (4 * 4 * 4) + (4 x 4 x 4) 4x4 matrix for MVP + iMV + normal, then a vec4 for the haze (see SpacesUniforms in vf_p_generic.js)
const totalUniformArraySpacesSize = uboOffset * scene.entityModels.length;	//one 256 byte slot for every model
const uniformBufferSpaces = device.createBuffer({
  label: "3D Space Transformations Uniform Buffer",
  size: totalUniformArraySpacesSize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

//lights
const uniformArrayLights = 256;
export const uniformBufferLights = device.createBuffer({
  label: "Lights Uniform Buffer",
  size: uniformArrayLights,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

// (made again when the size the frame is drawn at changes, see display.js)
const makeDepthTexture = () => device.createTexture({
  size: [canvas.width, canvas.height],
  format: 'depth24plus',
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,	//read back by the screen space effects, and copied for the water's reflections
});
let depthTexture = makeDepthTexture();
onRenderResize(() => {
	depthTexture.destroy();
	depthTexture = makeDepthTexture();
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
  },
  {
    binding: 6,		//the sky view LUT: the haze the models fade into far off is the color of the sky on the horizon (see vf_p_generic.js)
    visibility: GPUShaderStage.FRAGMENT,
    texture: {},
  },
  {
    binding: 7,
    visibility: GPUShaderStage.FRAGMENT,
    sampler: {},
  }]
});

const skySampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

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
				resource: textureFiltering.filteredSampler()	//the models' textures: anisotropic, at whatever level the setting is on 
				},
				{
				binding: 4,
				resource: shadowMapping.shadowMapView
				},
				{
				binding: 5,
				resource: shadowMapping.shadowMapSampler
				},
				{
				binding: 6,
				resource: atmosphere.skyViewLUTtexture.createView()
				},
				{
				binding: 7,
				resource: skySampler
				}],
			}));
			
			console.log("Generic Bind Group Buffer offset: ", i * uboOffset);
	}
	
	return result;
}

let bindGroups = createGenericBindGroups(scene.entityModels.length);
let bindGroupsFiltering = textureFiltering.filteringLevel();	//the level the sampler in them is at. They are made again when the setting moves

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
		// and the haze, after the three matrices: how far off it is about two thirds over the color, and whether the atmosphere is on
		device.queue.writeBuffer(uniformBufferSpaces, i * uboOffset + 192, new Float32Array([settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, 0, 0]));
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

	profiler.beginFrame();		//the Performance window: every pass from here to endFrame is timed while it is on
	profiler.cpuMark('Controls and Camera');	//(and the CPU time of the frame is noted a stretch at a time, at each cpuMark down to cpuFrameDone)
	const encoder = device.createCommandEncoder();
	
	// ImGUI setting updates
	userInterface.refreshControlsUI();

	// the window, the Resolution setting or dynamic resolution changed size: before anything is drawn, everything drawn at the canvas's size is made again (see display.js)
	const newSize = settledRenderSize(canvas, settings.renderResolution * dynamicResolution.scale, performance.now());
	if (newSize) {
		setRenderSize(newSize[0], newSize[1]);
	}

	// fly camera: after the controls have written their values (so the Pos sliders still work), before anything reads the camera
	cameraControls.updateCamera();
	hunting.updateHunter();		//on foot instead, in the Hunting game mode
	rifle.rifleUpdate();		//and the rifle in the hunter's hands
	ballistics.bulletUpdate();	//the rounds in the air
	wind.windUpdate();		//the air moves on, before anything reads it
	userInterface.refreshEntityFolder();
	
	//update skybox to position onto camera
	if(settings.activateSkybox) {
		updateSkyboxPosition(scene.entityModels[scene.entityModels.length - 1]);
	}
	
	//generate per-draw uniforms (not with dynamic uniform buffers though)
	//procedural land: regenerates if its settings changed (which can move the buildings), so before the model uniforms
	profiler.cpuMark('Terrain Update');
	terrain.terrainUpdate();
	profiler.cpuMark('Forest Update');
	forest.forestUpdate();		//after the land: the forest is planted again whenever the land under it changes
	profiler.cpuMark('Boulders, Particles, Birds Update');
	boulders.boulderUpdate();	//and the boulders laid out again
	particles.particleUpdate();		//what the leaves, the spray and the rain all need to know this frame
	birds.birdUpdate();				//the hawks fly on
	geese.geeseUpdate();			//and the geese
	deer.deerUpdate();				//and the deer
	lightning.lightningUpdate();	//a strike that is going on flickers and dies, and now and then a new one starts
	profiler.cpuMark('Cloud Map');
	profiler.section('Cloud Map', () => clouds.cloudUpdate(encoder));	//the weather moves on, and the picture of the clouds from above is taken: their shadows are read from it all through the frame

	profiler.cpuMark('Shadow and Height Map');
	genericUniformBufferUpdates(scene.entityModels);
	if (bindGroupsFiltering !== textureFiltering.filteringLevel()) {
		bindGroups = createGenericBindGroups(scene.entityModels.length);
		bindGroupsFiltering = textureFiltering.filteringLevel();
	}

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
		timestampWrites: profiler.section('Shadow Map', () => profiler.timestamps('Scene Models', 'v_shadowMapDepth')),
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
	
	//(while the Performance window is timing, the models and the land get a pass each: see renderPassParts in profiler.js)
	const heightPassParts = profiler.section('Height Map', () => profiler.renderPassParts(encoder, {
		colorAttachments: [],
		depthStencilAttachment: {
			view: scene.heightMapView,
			depthStoreOp: 'store',
			depthLoadOp: 'clear',
			depthClearValue: 1.0,
		},
	}));

	let heightPass = heightPassParts.next('Scene Models', 'v_heightMapDepth');
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
	
	heightPass = heightPassParts.next('Terrain', 'v_terrainDepth');
	terrain.terrainHeightMapPass(heightPass);	//this is how the water gets to know where the land and the sea bed are

	heightPassParts.end();


	//-------------MAIN PASS------------------
	profiler.cpuMark('Main Pass');
	const mainPassParts = profiler.section('Main Pass', () => profiler.renderPassParts(encoder, {
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
	}));

	let pass = mainPassParts.next('Scene Models', 'vf_p_generic3D');
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

	pass = mainPassParts.next('Terrain', 'vf_terrain');
	terrain.terrainPass(pass);
	pass = mainPassParts.next('Boulders', 'vf_boulders');
	boulders.boulderPass(pass);

	mainPassParts.end();

	//post effect section
	//(the screen space effects run further down, once the grass and the trees are in the frame as well)

	profiler.cpuMark('Grass');
	if(settings.enableGrass)
	{
		profiler.section('Grass', () => grassPass(encoder, depthTexture));
	}

	profiler.cpuMark('Forest');
	if(settings.enableForest)
	{
		profiler.section('Forest', () => forestPass(encoder, depthTexture));
	}

	//leaves blowing off the trees: solid, so they go in with the rest and get shaded with it
	profiler.cpuMark('Leaves and Birds');
	profiler.section('Leaves', () => particles.leafPass(encoder, depthTexture));

	//and the animals: the hawks, the geese and the deer
	profiler.section('Animal Life', () => {
		birds.birdPass(encoder, depthTexture);
		geese.geesePass(encoder, depthTexture);
		deer.deerPass(encoder, depthTexture);
	});

	//screen space shadows and ambient occlusion over everything solid, and the copies of the frame the water finds its reflections in.
	//		Before the water and the sky are drawn
	profiler.cpuMark('Screen Space');
	profiler.section('Screen Space', () => screenEffectsPass(encoder, context.getCurrentTexture(), depthTexture));

	device.queue.submit([encoder.finish()]);

	profiler.cpuMark('Water');
	if(settings.enableWater)
	{
		profiler.section('Water', () => waterPass(depthTexture));
	}

	profiler.cpuMark('Atmosphere, Clouds, Lightning');
	if(settings.enableAtmosphere)
	{
		profiler.section('Atmosphere', () => atmospherePass(depthTexture));
	}

	//the clouds go over everything, the sky included
	profiler.section('Clouds', () => clouds.cloudPass(depthTexture));

	//a bolt of lightning, if there is one at this moment
	profiler.section('Lightning', () => lightning.lightningPass(depthTexture));

	//the shafts of sun between the clouds, the flash of the lightning, and with the camera under the sea, the water it is looking through
	profiler.cpuMark('Light Shafts, Spray, Rain');
	profiler.section('Light Shafts', () => lightShafts.lightShaftPass(context.getCurrentTexture(), depthTexture));

	//spray off the waves and rain: see-through, so last, over everything that is behind them
	profiler.section('Spray, Rain and Snow', () => particles.weatherParticlePass(depthTexture));

	//the wisps the bullets leave, and the rifle in front of everything (in the Hunting game mode)
	profiler.section('Hunting', () => {
		ballistics.trailPass(depthTexture);
		rifle.riflePass();
	});

	profiler.cpuMark('Anti-Aliasing, Debug Views');
	const encoderDebug = device.createCommandEncoder();

	//anti-aliasing over the finished frame: whichever of the two the setting names. The debug views go on after it, and are left as they are
	profiler.section('Anti-Aliasing', () => {
		fxaaPass(encoderDebug, context.getCurrentTexture());
		smaaPass(encoderDebug, context.getCurrentTexture());
	});

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

	if(settings.displayWaterDisplacementSpectrum) {
		postEffectPassTextureDebug_RGBA32FLOAT(encoderDebug, context.getCurrentTexture(), water.displacementRealizationTexture);
	}

	if(settings.displayWaterDisplacement) {
		postEffectPassTextureDebug_RGBA32FLOAT(encoderDebug, context.getCurrentTexture(), water.finalDisplacementTexture);
	}

	if(settings.displayShoreDistance) {
		postEffectPassTextureDebug_R32FLOAT(encoderDebug, context.getCurrentTexture(), water.shoreDistanceTexture, settings.displayShoreDistanceDebugRange);
	}
	
	if(settings.displaySkyViewLUTtexture) {
		postEffectPassTextureDebug_RGBA16FLOAT(encoderDebug, context.getCurrentTexture(), atmosphere.skyViewLUTtexture);
	}
	
	if(settings.displayTransmittanceLUTtexture) {
		postEffectPassTextureDebug_RGBA16FLOAT(encoderDebug, context.getCurrentTexture(), atmosphere.transmittanceLUTtexture);
	}

	if(settings.displayCloudCoverage) {
		postEffectPassTextureDebug_RGBA8UNORM(encoderDebug, context.getCurrentTexture(), clouds.cloudCoverageTexture);
	}

	if(settings.displayWindTexture) {
		//the gusts alone, slid as far as the wind has carried them: the texture as it lies on the ground
		postEffectPassTextureDebug_RGBA8UNORM(encoderDebug, context.getCurrentTexture(), wind.windTexture, wind.windScrollTexels(), true);
	}
	
	// update the settings from changes made in render loop unless UI settings are changed directly
	profiler.cpuMark('Controls Sync');
	if(!userInterface.guiActive) {
		userInterface.syncSettingsToParams();
	}

	device.queue.submit([encoderDebug.finish()]);

	profiler.cpuMark('Performance Window, Presets');
	profiler.endFrame();	//after the last submit: the times are copied out, and come back to the window a frame or two later
	userInterface.refreshPerformanceWindow();
	userInterface.updateGraphicsPresets();	//the frame rate check that picks the graphics preset (see graphicsPresets.js)
	profiler.cpuFrameDone();
	frameDrawn();	//the loading screen goes once the first frames are drawn (loading.js)
}