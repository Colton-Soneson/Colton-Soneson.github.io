import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {onRenderResize} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_causticMap, vf_lightShafts } from '../shaders/js/vf_lightShafts.js'

import * as transformations from './transformations.js'
import * as clouds from './clouds.js'
import * as water from './water.js'
import { weatherNow } from './weather.js'
import { lightNow } from './lighting.js'
import { lightningNow } from './lightning.js'

/*
	Light in the air and in the water: the shafts of sun between the clouds, and the view from under the sea (the caustics
	on the sea bed, the shafts in the water, the water's own color). See vf_lightShafts.js for how they work.

	It runs after the clouds, over the finished frame:
		the caustic map		a small picture of how the water's surface curves, made from this frame's wave heights. Only
							while the camera is under the sea
		the shafts			the frame is copied, and drawn back through the shader with the light added
*/

const CAUSTIC_MAP_SIZE = 512;		// texels along a side of the caustic map
const SHAFT_REACH = 9000.0;			// how far from the camera the shafts in the air are followed, world units

const causticShaderModule = device.createShaderModule({ label: "vf_causticMap", code: vf_causticMap });
const shaftShaderModule = device.createShaderModule({ label: "vf_lightShafts", code: vf_lightShafts });

const shaftUniformBuffer = device.createBuffer({
  label: "light shaft Uniform",
  size: 256,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const causticUniformBuffer = device.createBuffer({
  label: "caustic map Uniform",
  size: 16,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// the copy of the frame the shader reads
//		(at the canvas's size, and made again when that changes: see display.js)
let frameCopyTexture, frameCopyView;
function makeFrameCopy() {
	if (frameCopyTexture) frameCopyTexture.destroy();
	frameCopyTexture = device.createTexture({
		label: "light shaft copy of the frame",
		size: [canvas.width, canvas.height],
		format: canvasFormat,
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	});
	frameCopyView = frameCopyTexture.createView();
}
makeFrameCopy();
onRenderResize(makeFrameCopy);

// how sharply the water's surface curves, over one tile of waves (see vf_causticMap)
const causticTexture = device.createTexture({
	label: "caustic map",
	size: [CAUSTIC_MAP_SIZE, CAUSTIC_MAP_SIZE],
	format: 'r16float',
	usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
});
const causticView = causticTexture.createView();

// repeating: the one tile of waves covers the sea
const causticSampler = device.createSampler({
	label: "caustic sampler",
	magFilter: 'linear',
	minFilter: 'linear',
	addressModeU: 'repeat',
	addressModeV: 'repeat',
});

// (the layouts are read off the shaders: 'auto')
const causticPipeline = device.createRenderPipeline({
	label: "caustic map pipeline",
	layout: 'auto',
	vertex: { module: causticShaderModule, entryPoint: "vertexMain" },
	fragment: { module: causticShaderModule, entryPoint: "fragmentMain", targets: [{ format: 'r16float' }] },
	primitive: { topology: 'triangle-list' },
});

const shaftPipeline = device.createRenderPipeline({
	label: "light shaft pipeline",
	layout: 'auto',
	vertex: { module: shaftShaderModule, entryPoint: "vertexMain" },
	fragment: { module: shaftShaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list' },
});

// whether the camera is under the sea (the level sea: the waves are not counted)
function cameraUnderWater() {
	return settings.enableWater && settings.enableUnderwater && settings.camPosY < settings.waterWorldPosY;
}

// the ShaftUniforms struct in vf_lightShafts.js
function shaftUniformBufferUpdates(shaftStrength) {
	const bufferResult = [];

	const invViewProjectionMatrix = transformations.getInvViewProj();
	for(let i = 0; i < 16; i++) {
		bufferResult.push(invViewProjectionMatrix[i]);
	}
	bufferResult.push(settings.camPosX, settings.camPosY, settings.camPosZ, 0);

	//the sun (never the moon: its light is too weak to show in the air), and its color, warmer the lower it is
	const light = lightNow();
	const sunLength = Math.hypot(settings.sunPosX, settings.sunPosY, settings.sunPosZ) || 1;
	const sun = [settings.sunPosX / sunLength, settings.sunPosY / sunLength, settings.sunPosZ / sunLength];
	bufferResult.push(sun[0], sun[1], sun[2], light.daylight);
	const low = 0.55 * (1 - Math.min(Math.max(sun[1] * 3, 0), 1));
	bufferResult.push(1 + (settings.sunColor[0] - 1) * low, 1 + (settings.sunColor[1] - 1) * low, 1 + (settings.sunColor[2] - 1) * low, shaftStrength);

	//water
	bufferResult.push(settings.waterWorldPosY, settings.waterGridSize, settings.causticStrength, cameraUnderWater() ? 1 : 0);

	bufferResult.push(...clouds.cloudMapValues());

	//air: the bottom of the low cloud, how far the shafts are followed, and whether there are clouds at all
	//		(and in the slot left over: how bright the lightning is on the scene at this moment)
	bufferResult.push(settings.waterWorldPosY + weatherNow.base + settings.cloudHeight, SHAFT_REACH, clouds.cloudsShowing() ? 1 : 0, lightningNow.sceneFlash);

	bufferResult.push(canvas.width, canvas.height, 1 / canvas.width, 1 / canvas.height);

	const viewProjectionMatrix = transformations.getViewProj();
	for(let i = 0; i < 16; i++) {
		bufferResult.push(viewProjectionMatrix[i]);
	}

	const result = new Float32Array(bufferResult);
	device.queue.writeBuffer(shaftUniformBuffer, 0, result.buffer, result.byteOffset, result.byteLength);
}

// Over the finished frame, once the clouds are on it
export function lightShaftPass(canvasTexture, mainpassDepthTexture) {
	const underWater = cameraUnderWater();

	// Shafts in the air only show when the sky is part cloud and part clear: with no cloud there is nothing to cast them,
	//		and under a closed sky no sun to make them. And the strength is that of the day
	const light = lightNow();
	const cover = weatherNow.coverage;
	const broken = Math.min(Math.max((cover - 0.12) / 0.25, 0), 1) * (1 - Math.min(Math.max((cover - 0.82) / 0.14, 0), 1)) * (1 - 0.85 * weatherNow.skyCover);
	const shaftStrength = settings.enableLightShafts && settings.enableClouds ? settings.lightShaftStrength * broken * light.daylight : 0;
	if (!underWater && shaftStrength <= 0.001 && lightningNow.sceneFlash <= 0.001) {
		return;
	}

	const encoder = device.createCommandEncoder();
	shaftUniformBufferUpdates(shaftStrength);

	//-------------THE CAUSTIC MAP------------------
	if (underWater) {
		const texel = new Float32Array([settings.waterGridSize / settings.waterTileResolution, 0, 0, 0]);
		device.queue.writeBuffer(causticUniformBuffer, 0, texel);

		const causticPass = encoder.beginRenderPass({
			colorAttachments: [{
				view: causticView,
				loadOp: "clear",
				clearValue: { r: 0, g: 0, b: 0, a: 1 },
				storeOp: "store",
			}],
			timestampWrites: profiler.timestamps('Caustic Map', 'vf_causticMap'),
		});
		causticPass.setPipeline(causticPipeline);
		causticPass.setBindGroup(0, device.createBindGroup({
			label: "caustic map bind group",
			layout: causticPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: causticUniformBuffer } },
				{ binding: 1, resource: water.finalWaveHeightTexture.createView() },
			],
		}));
		causticPass.draw(3);
		causticPass.end();
	}

	//-------------THE SHAFTS------------------
	encoder.copyTextureToTexture({ texture: canvasTexture }, { texture: frameCopyTexture }, [canvas.width, canvas.height]);

	const pass = encoder.beginRenderPass({
		colorAttachments: [{
			view: canvasTexture.createView(),
			loadOp: "load",
			storeOp: "store",
		}],
		timestampWrites: profiler.timestamps('Shafts', 'vf_lightShafts'),
	});
	pass.setPipeline(shaftPipeline);
	pass.setBindGroup(0, device.createBindGroup({
		label: "light shaft bind group",
		layout: shaftPipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: shaftUniformBuffer } },
			{ binding: 1, resource: frameCopyView },
			{ binding: 2, resource: mainpassDepthTexture.createView() },
			{ binding: 3, resource: clouds.cloudCoverageView },
			{ binding: 4, resource: clouds.cloudMapSampler },
			{ binding: 5, resource: causticView },
			{ binding: 6, resource: causticSampler },
			{ binding: 7, resource: clouds.cloudMarchView },
		],
	}));
	pass.draw(3);
	pass.end();

	device.queue.submit([encoder.finish()]);
}
