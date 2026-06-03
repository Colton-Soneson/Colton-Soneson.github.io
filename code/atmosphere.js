import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { c_transmittance_LUT } from '../shaders/js/vfc_atmosphere.js'
import { c_skyView_LUT } from '../shaders/js/vfc_atmosphere.js'
import { v_sky } from '../shaders/js/vfc_atmosphere.js'
import { f_sky } from '../shaders/js/vfc_atmosphere.js'
import { SKY_WORKGROUP_SIZE } from '../shaders/js/vfc_atmosphere.js'


import * as transformations from './transformations.js'
import * as scene from './scene.js'
import * as primitives from '../models/primitives.js'

//-------------------- Pre Computed (Bruneton) Atmospheric Scattering --------------------
const transmittanceLUTShaderModule = device.createShaderModule({
  label: "c_transmittance_LUT",
  code: c_transmittance_LUT	
});

const skyViewShaderModule = device.createShaderModule({
  label: "c_skyView_LUT",
  code: c_skyView_LUT	
});

const atmosphereVertShaderModule = device.createShaderModule({
  label: "v_sky",
  code: v_sky	
});

const atmosphereFragShaderModule = device.createShaderModule({
  label: "f_sky",
  code: f_sky	
});


const lutSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
});

const transmittanceLUTtexture = device.createTexture({
  label: "transmittance LUT texture",
  size: [settings.atmosphereTransmittanceTextureSizeX, settings.atmosphereTransmittanceTextureSizeY, 1],
  format: 'rgba16float',
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC, 
});
const transmittanceView = transmittanceLUTtexture.createView();

const skyViewLUTtexture = device.createTexture({
  label: "sky view LUT texture",
  size: [settings.atmosphereViewLUTTextureSizeX, settings.atmosphereViewLUTTextureSizeY, 1],
  format: 'rgba16float',
  usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC, 
});
const skyViewView = skyViewLUTtexture.createView();

const atmosphereUBOArraySize = 96;	//invViewProj (mat4) + sun direction (vec4) + cam pos (vec4) = 96
const atmosphereUniformBuffer = device.createBuffer({
    label: 'atmosphere uniforms',
    size: atmosphereUBOArraySize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const atmosphereQuadVertexBuffer = device.createBuffer({
    label: 'sky-quad',
    size: scene.fullScreenQuad.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(atmosphereQuadVertexBuffer, 0, scene.fullScreenQuad);

function updateSkyUniforms() {
	const bufferResult = [];
	
	const invVP = transformations.getInvViewProjNoTranslation();
	
	for(let i = 0; i < 16; i++) {
		bufferResult.push(invVP[i]);
	}
	
	bufferResult.push(settings.sunPosX);
	bufferResult.push(settings.sunPosY);
	bufferResult.push(settings.sunPosZ);
	bufferResult.push(1);	//padding
	
	bufferResult.push(0);
	bufferResult.push((settings.camPosY + settings.additionalAltitude) * settings.atmosphereScaleToScene);
	bufferResult.push(0);
	bufferResult.push(1);	//padding
	
	const result = new Float32Array(bufferResult);
	
	device.queue.writeBuffer(atmosphereUniformBuffer, 
							0,
							result.buffer,
							result.byteOffset,
							result.byteLength);
}

//-------------Layouts-------------------
const transmittanceBindGroupLayout = device.createBindGroupLayout({
    entries: [
        {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: {
                access: 'write-only',
                format: 'rgba16float',
                viewDimension: '2d',
            },
        },
    ],
});

const skyViewBindGroupLayout = device.createBindGroupLayout({
    entries: [
        {   // uniforms (sun dir, camera pos)
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'uniform' },
        },
        {   // transmittance LUT input
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            texture: { sampleType: 'float', viewDimension: '2d' },
        },
        {   // sampler
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            sampler: { type: 'filtering' },
        },
        {   // sky-view LUT output
            binding: 3,
            visibility: GPUShaderStage.COMPUTE,
            storageTexture: {
                access: 'write-only',
                format: 'rgba16float',
                viewDimension: '2d',
            },
        },
    ],
});

const skyVFBindGroupLayout = device.createBindGroupLayout({
    entries: [
        {   // sky uniforms (sun, camera, invViewProj)
            binding: 0,
            visibility: GPUShaderStage.FRAGMENT,
            buffer: { type: 'uniform' },
        },
        {   // sky-view LUT
            binding: 1,
            visibility: GPUShaderStage.FRAGMENT,
            texture: { sampleType: 'float', viewDimension: '2d' },
        },
        {   // sampler
            binding: 2,
            visibility: GPUShaderStage.FRAGMENT,
            sampler: { type: 'filtering' },
        },
    ],
});



//----------------Pipelines--------------------
const transmittancePipeline = device.createComputePipeline({
    label: 'transmittance LUT compute pipeline',
    layout: device.createPipelineLayout({
        bindGroupLayouts: [transmittanceBindGroupLayout],
    }),
    compute: {
        module: transmittanceLUTShaderModule,
        entryPoint: 'computeMain',
    },
});

const skyViewPipeline = device.createComputePipeline({
    label: 'skyview LUT compute pipeline',
    layout: device.createPipelineLayout({
        bindGroupLayouts: [skyViewBindGroupLayout],
    }),
    compute: {
        module: skyViewShaderModule,
        entryPoint: 'computeMain',
    },
});

const skyRenderPipeline = device.createRenderPipeline({
    label: 'sky render pipeline',
    layout: device.createPipelineLayout({
        bindGroupLayouts: [ skyVFBindGroupLayout ],
    }),
    vertex: {
        module: atmosphereVertShaderModule,
        entryPoint: 'vertexMain',
        buffers: [{
            arrayStride: 16,             // custom for 2D fullscreen quad, put this on other SS shaders for optimization
            attributes: [
                { shaderLocation: 0, offset: 0, format: 'float32x2' },  // pos xy
                { shaderLocation: 1, offset: 8, format: 'float32x2' },  // uv xy
            ],
        }],
    },
    fragment: {
        module: atmosphereFragShaderModule,
        entryPoint: 'fragmentMain',
        targets: [{
            format: canvasFormat,
        }],
    },
    primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
    },
    depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: false,    // sky doesn't own the depth buffer
        depthCompare: 'less-equal',  // passes where nothing has drawn yet
    },
});

//--------------Bind Groups------------------
const transmittanceBindGroup = device.createBindGroup({
    layout: transmittanceBindGroupLayout,
    entries: [
        { binding: 0, resource: transmittanceView },
    ],
});

const skyViewBindGroup = device.createBindGroup({
    layout: skyViewBindGroupLayout,
    entries: [
        { binding: 0, resource: { buffer: atmosphereUniformBuffer } },
        { binding: 1, resource: transmittanceView },
        { binding: 2, resource: lutSampler },
        { binding: 3, resource: skyViewView },
    ],
});

const skyVFBindGroup = device.createBindGroup({
    layout: skyVFBindGroupLayout,
    entries: [
        { binding: 0, resource: { buffer: atmosphereUniformBuffer } },
        { binding: 1, resource: skyViewView },
        { binding: 2, resource: lutSampler },
    ],
});

export function sunCycle(cycleSpeed)
{
	settings.sunCycleAngle = (settings.sunCycleAngle || 0) + cycleSpeed;
    if (settings.sunCycleAngle > Math.PI * 2) settings.sunCycleAngle -= Math.PI * 2;

    // ellipse — wide on X, tall on Y, flat on Z
	// HARD CODED FOR NOW
    settings.sunPosX = Math.cos(settings.sunCycleAngle) * 110.0;
    settings.sunPosY = (Math.sin(settings.sunCycleAngle) * 50.0) + 25.0;
}

export function atmospherePass(mainpassDepthTexture)
{	
	if(settings.atmosphereSunRotationDemo) {
		sunCycle(0.01)
	}

	updateSkyUniforms();

    const encoder = device.createCommandEncoder();

    // Only needs to run once, or when atmosphere constants change.
    // Pull it out of the frame loop once it's working.
    if (settings.atmosphereNeedsTransmittanceRebuild) {
        const transmitPass = encoder.beginComputePass({ label: 'transmittance LUT pass' });
        transmitPass.setPipeline(transmittancePipeline);
        transmitPass.setBindGroup(0, transmittanceBindGroup);
        transmitPass.dispatchWorkgroups(
            Math.ceil(settings.atmosphereTransmittanceTextureSizeX / SKY_WORKGROUP_SIZE[0]),  // ceil(256/32) = 8
            settings.atmosphereTransmittanceTextureSizeY,                                     // one row per workgroup row
            1
        );
        transmitPass.end();
        settings.atmosphereNeedsTransmittanceRebuild = false;
    }

    // Rebuild whenever sun direction changes.
    const skyViewPass = encoder.beginComputePass({ label: 'sky View pass' });
    skyViewPass.setPipeline(skyViewPipeline);
    skyViewPass.setBindGroup(0, skyViewBindGroup);
    skyViewPass.dispatchWorkgroups(
        Math.ceil(settings.atmosphereViewLUTTextureSizeX / SKY_WORKGROUP_SIZE[0]),  // ceil(192/32) = 6
        settings.atmosphereViewLUTTextureSizeY,
        1
    );
    skyViewPass.end();

	// sky quad
    const renderPass = encoder.beginRenderPass({
		colorAttachments: [{
			view: context.getCurrentTexture().createView(),
			clearValue: { r: 0, g: 0, b: 0, a: 1 },
			loadOp:  'load',
			storeOp: 'store',
		}],
		depthStencilAttachment: {
			view: mainpassDepthTexture.createView(),	
			depthClearValue: 1.0,
			depthLoadOp:  'load',
			depthStoreOp: 'store',
		},
	});
    renderPass.setPipeline(skyRenderPipeline);
    renderPass.setBindGroup(0, skyVFBindGroup);
    renderPass.setVertexBuffer(0, atmosphereQuadVertexBuffer);
    renderPass.draw(6);  // fullscreen quad = 2 triangles
    renderPass.end();

    device.queue.submit([encoder.finish()]);
}