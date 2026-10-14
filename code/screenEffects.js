import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {onRenderResize} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_ssao } from '../shaders/js/vf_screenEffects.js'
import { vf_screenShade } from '../shaders/js/vf_screenEffects.js'

import * as transformations from './transformations.js'
import { screenShadowPass, screenShadowTexture } from './SSS.js'
import { lightNow } from './lighting.js'
import * as clouds from './clouds.js'
import { weatherNow } from './weather.js'

/*
	The effects worked out from the finished frame instead of from the scene: screen space shadows, ambient occlusion, and the
	copies of the frame the water reads its reflections from.

	It runs once everything solid has been drawn (the buildings, the land, the boulders, the grass, the trees) and before the
	water and the sky:
		1. screen space shadows	a compute pass over the depth texture (SSS.js)
		2. ambient occlusion	a half size picture of how shut in every pixel is (vf_ssao)
		3. the shade pass		multiplies the picture by what those two leave of each pixel's light (vf_screenShade),
								and by the shadows of the clouds (read from the coverage map, see clouds.js)
		4. two copies			the picture and its depth as they now stand, for the water to find reflections in (f_water)
	The water is drawn after, so it is not shaded by 1 to 3 itself, and it is not in its own reflections.
*/

const ssaoShaderModule = device.createShaderModule({
  label: "vf_ssao",
  code: vf_ssao
});

const screenShadeShaderModule = device.createShaderModule({
  label: "vf_screenShade",
  code: vf_screenShade
});

// All at the canvas's size (the occlusion at half of it), and made again when that changes (see display.js)
let halfSize, occlusionTexture, occlusionView;
export let sceneColorTexture, sceneDepthTexture;
function makeSizedTextures() {
	for (const texture of [occlusionTexture, sceneColorTexture, sceneDepthTexture]) {
		if (texture) texture.destroy();
	}
	halfSize = [Math.max(Math.ceil(canvas.width / 2), 1), Math.max(Math.ceil(canvas.height / 2), 1)];

	// how open every pixel is to the sky, 1.0 to 0.0, at half size
	occlusionTexture = device.createTexture({
		label: "ambient occlusion",
		size: halfSize,
		format: 'r8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
	});
	occlusionView = occlusionTexture.createView();

	// the frame as it stood before the water was drawn: what a reflection in the water can show
	sceneColorTexture = device.createTexture({
		label: "scene color before the water",
		size: [canvas.width, canvas.height],
		format: canvasFormat,
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
	});
	sceneDepthTexture = device.createTexture({
		label: "scene depth before the water",
		size: [canvas.width, canvas.height],
		format: 'depth24plus',
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,	//(a depth texture can only be copied to if it could also be drawn to)
	});
}
makeSizedTextures();
onRenderResize(makeSizedTextures);
export let sceneCopyReady = false;	// whether those two hold this frame

const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

const screenUniformBuffer = device.createBuffer({
  label: "screen effects Uniform",
  size: 256,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// (the light that casts the shadows, the sun by day and the moon by night, comes from lightNow in lighting.js)

// the ScreenUniforms struct in vf_screenEffects.js
function screenUniformBufferUpdates(sun, occlusion) {
	const bufferResult = [];

	const invViewProjectionMatrix = transformations.getInvViewProj();
	for(let i = 0; i < 16; i++) {
		bufferResult.push(invViewProjectionMatrix[i]);
	}

	bufferResult.push(settings.camPosX, settings.camPosY, settings.camPosZ, 0);
	bufferResult.push(sun.direction[0], sun.direction[1], sun.direction[2], 0);

	//projection: the two scales, and the two numbers of the matrix a depth is made from
	const projection = transformations.projectionMatrix;
	bufferResult.push(projection[0], projection[5], projection[10], projection[14]);

	bufferResult.push(canvas.width, canvas.height, 1 / canvas.width, 1 / canvas.height);

	bufferResult.push(settings.enableScreenShadows ? settings.screenShadowStrength : 0);
	bufferResult.push(settings.ssaoStrength);
	bufferResult.push(settings.ssaoRadius);
	bufferResult.push(settings.waterHorizonFogDistance);

	bufferResult.push(settings.displayScreenShading ? 1 : 0);
	bufferResult.push(occlusion ? 1 : 0);
	bufferResult.push(sun.direct, sun.ambient);

	//the shadows of the clouds: where the coverage map is, how much of the sky is cloud, and whether there are clouds at all
	bufferResult.push(...clouds.cloudMapValues());
	bufferResult.push(clouds.cloudsShowing() ? Math.max(weatherNow.coverage, weatherNow.skyCover) : 0);
	bufferResult.push(clouds.cloudsShowing() ? 1 : 0);
	bufferResult.push(0, 0);

	const result = new Float32Array(bufferResult);
	device.queue.writeBuffer(screenUniformBuffer, 0, result.buffer, result.byteOffset, result.byteLength);
}

// Layouts
//-------------------------------------------------
const ssaoBindGroupLayout = device.createBindGroupLayout({
  label: "SSAO Bind Group Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.FRAGMENT,
    buffer: {}
  },
  {
    binding: 1,								//the frame's depth
    visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType: 'depth' }
  }
  ]
});

const shadeBindGroupLayout = device.createBindGroupLayout({
  label: "screen shade Bind Group Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.FRAGMENT,
    buffer: {}
  },
  {
    binding: 1,								//the frame's depth
    visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType: 'depth' }
  },
  {
    binding: 2,								//screen space shadows, read texel by texel
    visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType: 'unfilterable-float' }
  },
  {
    binding: 3,								//ambient occlusion
    visibility: GPUShaderStage.FRAGMENT,
    texture: {}
  },
  {
    binding: 4,
    visibility: GPUShaderStage.FRAGMENT,
    sampler: {}
  },
  {
    binding: 5,								//the clouds from above: their shadows
    visibility: GPUShaderStage.FRAGMENT,
    texture: {}
  },
  {
    binding: 6,
    visibility: GPUShaderStage.FRAGMENT,
    sampler: {}
  }
  ]
});

// Pipelines
//-------------------------------------------------
const ssaoPipeline = device.createRenderPipeline({
	label: "SSAO pipeline",
	layout: device.createPipelineLayout({
		label: "SSAO Pipeline Layout",
		bindGroupLayouts: [ ssaoBindGroupLayout ],
	}),
	vertex: {
		module: ssaoShaderModule,
		entryPoint: "vertexMain",
		buffers: []					// none: one triangle over the whole screen, made from the vertex number
	},
	fragment: {
		module: ssaoShaderModule,
		entryPoint: "fragmentMain",
		targets: [{
		format: 'r8unorm'
		}]
	},
	primitive: {
		topology: 'triangle-list',
	},
});

// multiply: what the shader writes is how much of the light is left, and the picture is multiplied by it.
//		replace: the same shader writing straight over the picture instead, to look at the shading on its own
function createShadePipeline(label, multiply) {
	return device.createRenderPipeline({
		label: label,
		layout: device.createPipelineLayout({
			label: "screen shade Pipeline Layout",
			bindGroupLayouts: [ shadeBindGroupLayout ],
		}),
		vertex: {
			module: screenShadeShaderModule,
			entryPoint: "vertexMain",
			buffers: []
		},
		fragment: {
			module: screenShadeShaderModule,
			entryPoint: "fragmentMain",
			targets: [{
			format: canvasFormat,
			blend: multiply ? {
				color: { srcFactor: 'dst', dstFactor: 'zero', operation: 'add' },		// source * what is there
				alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },		// and the alpha left as it is
			} : undefined,
			}]
		},
		primitive: {
			topology: 'triangle-list',
		},
	});
}
const shadePipeline = createShadePipeline("screen shade pipeline", true);
const shadeViewPipeline = createShadePipeline("screen shade pipeline, shown alone", false);

// After everything solid is drawn and before the water: see the top of the file
export function screenEffectsPass(aEncoder, canvasTexture, depthTexture) {
	sceneCopyReady = false;
	if (!settings.enablePostEffects) {
		return;
	}

	const sun = lightNow();
	const shadows = settings.enableScreenShadows && sun.direct > 0.001;
	const occlusion = settings.enableSSAO;

	if (shadows || occlusion || clouds.cloudsShowing()) {
		screenUniformBufferUpdates(sun, occlusion);
		const depthView = depthTexture.createView();

		//-------------SCREEN SPACE SHADOWS------------------
		// (with no sun up it only clears its texture to lit)
		screenShadowPass(aEncoder, depthTexture, shadows ? sun.direction : null);

		//-------------AMBIENT OCCLUSION------------------
		if (occlusion) {
			const pass = aEncoder.beginRenderPass({
				colorAttachments: [{
				view: occlusionView,
				loadOp: "clear",
				clearValue: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
				storeOp: "store",
				}],
				timestampWrites: profiler.timestamps('Ambient Occlusion', 'vf_ssao'),
			});
			pass.setPipeline(ssaoPipeline);
			pass.setBindGroup(0, device.createBindGroup({
				label: "SSAO bind group",
				layout: ssaoBindGroupLayout,
				entries: [
				{
					binding: 0,
					resource: { buffer: screenUniformBuffer }
				},
				{
					binding: 1,
					resource: depthView
				}
				]
			}));
			pass.draw(3);
			pass.end();
		}

		//-------------SHADE PASS------------------
		const pass = aEncoder.beginRenderPass({
			colorAttachments: [{
			view: canvasTexture.createView(),
			loadOp: "load",
			storeOp: "store",
			}],
			timestampWrites: profiler.timestamps('Shade', 'vf_screenShade'),
		});
		pass.setPipeline(settings.displayScreenShading ? shadeViewPipeline : shadePipeline);
		pass.setBindGroup(0, device.createBindGroup({
			label: "screen shade bind group",
			layout: shadeBindGroupLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: screenUniformBuffer }
			},
			{
				binding: 1,
				resource: depthView
			},
			{
				binding: 2,
				resource: screenShadowTexture.createView()
			},
			{
				binding: 3,
				resource: occlusionView
			},
			{
				binding: 4,
				resource: linSampler
			},
			{
				binding: 5,
				resource: clouds.cloudCoverageView
			},
			{
				binding: 6,
				resource: clouds.cloudMapSampler
			}
			]
		}));
		pass.draw(3);
		pass.end();
	}

	//-------------COPIES FOR REFLECTIONS------------------
	if (settings.enableSSR && settings.enableWater) {
		aEncoder.copyTextureToTexture({ texture: canvasTexture }, { texture: sceneColorTexture }, [canvas.width, canvas.height]);
		aEncoder.copyTextureToTexture({ texture: depthTexture }, { texture: sceneDepthTexture }, [canvas.width, canvas.height]);
		sceneCopyReady = true;
	}
}
