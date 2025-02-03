import { vf_p_shadowMap } from '../shaders/js/vf_p_generic.js'
import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';
import {device} from './deviceSelection.js'

import { settings } from './settings.js';
import * as scene from './scene.js'
import * as transformations from './transformations.js'

function getShadowMapMatrices(model) {
	const shadowMapBuff = [];
	const modelMatrix = transformations.getModelMatrix(model.worldTranslation, model.worldRotation, model.worldScale);
	const lightViewProjMat = transformations.getLightViewProjectionMat();
	
	for(let k = 0; k < 16; ++k)
	{
		shadowMapBuff.push(modelMatrix[k]);
	}
	for(let k = 0; k < 16; ++k)
	{
		shadowMapBuff.push(lightViewProjMat[k]);
	}
	return new Float32Array(shadowMapBuff);
}

const shaderMapModule = device.createShaderModule({
	label: "shadow map vf shader",
	code: vf_p_shadowMap
});

//---------------------Shadow Map Depth Textures-------------------------
const shadowMapDepthTexture = device.createTexture({
size: {height: settings.shadowMapWidth, width: settings.shadowMapHeight, depthOrArrayLayers: 1},
	format: 'depth32float',
	usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});

export const shadowMapView = shadowMapDepthTexture.createView();

export const shadowMapSampler = device.createSampler({
	label: 'shadowMap Sampler',
	minFilter: 'nearest',
	magFilter: 'nearest',
	mipmapFilter: 'nearest',
	addressModeU: 'clamp-to-edge',
	addressModeV: 'clamp-to-edge',
	addressModeW: 'clamp-to-edge',
	compare: 'less',
});

//-------------------------Shadow Map UBO----------------------------
const uboOffset = 256;	//this is a defaulted max for UBO, nothing I wrote equals up to 256, its a limiter
const shadowMapUniformSize = 128; //(4 * 4 * 4) + (4 * 4 * 4)   two 4x4 mats
const totalUniformShadowMapSize = (uboOffset * (scene.entityModels.length - 1)) + (shadowMapUniformSize * (scene.entityModels.length));
const uniformShadowMap = device.createBuffer({
  label: "Shadow Map Uniform Buffer",
  size: totalUniformShadowMapSize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

//---------------------Shadow Map Bind Group-------------------------
const shadowMapBindGroupLayout = device.createBindGroupLayout({
	label: "ShadowMap Bind Group Layout",
	entries: [
  {
    binding: 0,		//contains shadow UBO thats it
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: {},
  }]
});

export function createShadowMapBindGroups(numModels){
	
	const result = [];
	for(let i = 0; i < numModels; ++i) {
		
			result.push(device.createBindGroup({
				label: "renderer shadowmap model uniform bind group",
				layout: shadowMapBindGroupLayout,
				entries: [
				{
				binding: 0,
				resource: {buffer : uniformShadowMap, offset: i * uboOffset, size: shadowMapUniformSize,}
				}],
			}));
	}
	
	return result;
}

//------------------------Shadow Pipeline--------------------------
const shadowMapPipelineLayout = device.createPipelineLayout({
  label: "Shadow Map Pipeline Layout",
  bindGroupLayouts: [ shadowMapBindGroupLayout ],
});

export const shadowMapPipeline = device.createRenderPipeline({
	label: "Shadow Map pipeline",
	layout: shadowMapPipelineLayout,	
  vertex: {
    module: shaderMapModule,
	entryPoint: "vertexMain",
    buffers: [scene.vertexBufferLayout],
  },
  depthStencil: {
    depthWriteEnabled: true,
    depthCompare: 'less',
    format: 'depth32float',
  },
  primitive: {
	  topology: 'triangle-list',
	  cullMode: 'none',
  },
});

//-------------------------UBO Write------------------------------
export function shadowMapUniformBufferUpdates(models) {
	for(let i = 0; i < models.length; ++i)
	{	
		const finalShadowMapBuff = getShadowMapMatrices(models[i]);
		
		device.queue.writeBuffer(uniformShadowMap, 
								i * uboOffset,	//apparently uniform buffer size defaults to a need of 256 
								finalShadowMapBuff.buffer,
								finalShadowMapBuff.byteOffset,
								finalShadowMapBuff.byteLength);
	}
}
