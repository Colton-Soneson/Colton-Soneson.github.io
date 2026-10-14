import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {onRenderResize} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { c_cloudNoise } from '../shaders/js/vfc_clouds.js'
import { c_cloudCoverage } from '../shaders/js/vfc_clouds.js'
import { vf_cloudMarch } from '../shaders/js/vfc_clouds.js'
import { vf_cloudComposite } from '../shaders/js/vfc_clouds.js'
import { CLOUD_SHAPE_SIZE, CLOUD_DETAIL_SIZE, CLOUD_NOISE_WORKGROUP, CLOUD_MAP_SIZE, CLOUD_MAP_WORKGROUP } from '../shaders/js/vfc_clouds.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import { createTileableNoise, tileableFbm } from './wind.js'
import { weatherUpdate, weatherNow } from './weather.js'
import { lightNow } from './lighting.js'
import { lightningNow } from './lightning.js'

//the clouds are lit by the sky as well as the sun, read from the sky view LUT
import {skyViewLUTtexture} from './atmosphere.js'

/*
	The clouds. See the top of vfc_clouds.js for how they work, and weather.js for what decides how much of them there is.

	Twice a frame:
		cloudUpdate		early, before anything is drawn: moves the weather on, lets the clouds drift, and takes the picture
						of them from above (the coverage map) that the shadows on the ground and the water are read from
		cloudPass		last, over the finished frame and the sky: marches the clouds at half size, and lays them on
*/

const WEATHER_MAP_SIZE = 256;		// texels along a side of the weather map
const WEATHER_TILE = 21000.0;		// and the stretch of world one tile of it covers
const MOUNTAIN_MAP_SIZE = 64;
const HIGH_HEIGHT = 6200.0;			// the bottom of the high layer, world units above the sea
const HIGH_DEPTH = [260.0, 700.0];	// how deep it is: as cirrus, and as the sheet of an overcast day
const SHELF_BOTTOM = 230.0;			// a shelf cloud: the height of its bottom above the sea, and how deep it is
const SHELF_DEPTH = 760.0;
const MIDDLE_HEIGHT = 2550.0;		// the bottom of the middle layer: clear of the highest peaks
const MIDDLE_DEPTH = 420.0;
const TOWER_TOP = 4300.0;			// how high a cumulonimbus stands, whatever the depth of the layer it grows out of
const COVERAGE_MAP_WIDTH = 16384.0;	// the stretch of world the coverage map covers, centered on the camera

// Shader modules
//-------------------------------------------------
const cloudNoiseShaderModule = device.createShaderModule({ label: "c_cloudNoise", code: c_cloudNoise });
const cloudCoverageShaderModule = device.createShaderModule({ label: "c_cloudCoverage", code: c_cloudCoverage });
const cloudMarchShaderModule = device.createShaderModule({ label: "vf_cloudMarch", code: vf_cloudMarch });
const cloudCompositeShaderModule = device.createShaderModule({ label: "vf_cloudComposite", code: vf_cloudComposite });

// Samplers
//-------------------------------------------------
const repeatSampler = device.createSampler({
	label: "cloud noise sampler",
	magFilter: 'linear',
	minFilter: 'linear',
	addressModeU: 'repeat',
	addressModeV: 'repeat',
	addressModeW: 'repeat',
});
const clampSampler = device.createSampler({
	label: "cloud map sampler",
	magFilter: 'linear',
	minFilter: 'linear',
});
export const cloudMapSampler = clampSampler;

// The noise
//-------------------------------------------------
function createNoiseTexture(label, size, kind) {
	const texture = device.createTexture({
		label: label,
		size: [size, size, size],
		dimension: '3d',
		format: 'rgba8unorm',
		usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
	});
	const uniforms = device.createBuffer({ label: label + " Uniform", size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	device.queue.writeBuffer(uniforms, 0, new Float32Array([size, kind, 0, 0]));
	return { texture: texture, uniforms: uniforms, size: size };
}
const shapeNoise = createNoiseTexture("cloud shape noise", CLOUD_SHAPE_SIZE, 0);
const detailNoise = createNoiseTexture("cloud detail noise", CLOUD_DETAIL_SIZE, 1);

// made once, here, as the page loads
{
	const noisePipeline = device.createComputePipeline({
		label: "cloud noise pipeline",
		layout: 'auto',
		compute: { module: cloudNoiseShaderModule, entryPoint: "computeMain" },
	});
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginComputePass();
	pass.setPipeline(noisePipeline);
	for (const noise of [shapeNoise, detailNoise]) {
		pass.setBindGroup(0, device.createBindGroup({
			label: "cloud noise bind group",
			layout: noisePipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: noise.uniforms } },
				{ binding: 1, resource: noise.texture.createView() },
			],
		}));
		const groups = Math.ceil(noise.size / CLOUD_NOISE_WORKGROUP);
		pass.dispatchWorkgroups(groups, groups, groups);
	}
	pass.end();
	device.queue.submit([encoder.finish()]);
}

// The weather map
//-------------------------------------------------
// Laid over the world from above, repeating. r and a: where the cloud is (wide fields of it, and smaller clumps),
//		g: what kind it is from place to place, b: for the cirrus. Made of the same repeating noise as the wind texture
const weatherMapTexture = device.createTexture({
	label: "weather map",
	size: [WEATHER_MAP_SIZE, WEATHER_MAP_SIZE],
	format: 'rgba8unorm',
	usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
{
	const size = WEATHER_MAP_SIZE;
	const fields = createTileableNoise(11), kinds = createTileableNoise(12), streaks = createTileableNoise(13), clumps = createTileableNoise(14);
	const channels = [new Float32Array(size * size), new Float32Array(size * size), new Float32Array(size * size), new Float32Array(size * size)];
	for (let j = 0; j < size; j++) {
		for (let i = 0; i < size; i++) {
			const u = i / size, v = j / size;
			channels[0][j * size + i] = tileableFbm(fields, u, v, 4, 4);
			channels[1][j * size + i] = tileableFbm(kinds, u, v, 3, 2);
			channels[2][j * size + i] = tileableFbm(streaks, u, v, 6, 4);
			channels[3][j * size + i] = tileableFbm(clumps, u, v, 11, 3);
		}
	}
	const pixels = new Uint8Array(size * size * 4);
	channels.forEach((values, channel) => {
		// stretched to fill 0 to 1
		let least = Infinity, most = -Infinity;
		for (const value of values) { least = Math.min(least, value); most = Math.max(most, value); }
		for (let i = 0; i < size * size; i++) {
			pixels[i * 4 + channel] = Math.round((values[i] - least) / (most - least) * 255);
		}
	});
	device.queue.writeTexture({ texture: weatherMapTexture }, pixels, { bytesPerRow: size * 4 }, [size, size]);
}

// The mountain map
//-------------------------------------------------
// How much mountain there is under every place, for the cloud that gathers over the ranges and the cirrus above them.
//		Made again whenever the land is
const mountainMapTexture = device.createTexture({
	label: "cloud mountain map",
	size: [MOUNTAIN_MAP_SIZE, MOUNTAIN_MAP_SIZE],
	format: 'r8unorm',
	usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
let mountainMapLand = null;		// the land the map was last made from

function updateMountainMap() {
	if (terrain.land === mountainMapLand) {
		return;
	}
	mountainMapLand = terrain.land;
	const pixels = new Uint8Array(MOUNTAIN_MAP_SIZE * MOUNTAIN_MAP_SIZE);
	if (terrain.land && terrain.land.mountains) {
		const points = terrain.land.points;
		const block = points / MOUNTAIN_MAP_SIZE;
		for (let j = 0; j < MOUNTAIN_MAP_SIZE; j++) {
			for (let i = 0; i < MOUNTAIN_MAP_SIZE; i++) {
				// the most mountain anywhere in the block of the land's grid this texel covers (a few points of it are enough)
				let most = 0;
				for (let y = 0; y < 4; y++) {
					for (let x = 0; x < 4; x++) {
						const px = Math.min(Math.floor((i + (x + 0.5) / 4) * block), points - 1), py = Math.min(Math.floor((j + (y + 0.5) / 4) * block), points - 1);
						most = Math.max(most, terrain.land.mountains[py * points + px]);
					}
				}
				const t = Math.min(Math.max((most - 0.16) / 0.5, 0), 1);
				pixels[j * MOUNTAIN_MAP_SIZE + i] = Math.round(t * t * (3 - 2 * t) * 255);
			}
		}
	}
	device.queue.writeTexture({ texture: mountainMapTexture }, pixels, { bytesPerRow: MOUNTAIN_MAP_SIZE }, [MOUNTAIN_MAP_SIZE, MOUNTAIN_MAP_SIZE]);
}

// What is drawn to and read from
//-------------------------------------------------
// the clouds as seen from above. r: how much sun gets through, g: how much cloud is overhead, b: rain. See c_cloudCoverage
export const cloudCoverageTexture = device.createTexture({
	label: "cloud coverage map",
	size: [CLOUD_MAP_SIZE, CLOUD_MAP_SIZE],
	format: 'rgba8unorm',
	usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
});
export const cloudCoverageView = cloudCoverageTexture.createView();

// the march. rgb: the light the clouds send to the eye, a: how much of what is behind them shows through. At a half, a third or a
//		quarter of the canvas's size (settings.cloudResolution: the clouds are soft, and the march is most of their cost), and made
//		again when that or the canvas's size changes (see display.js)
let halfSize, cloudTexture, cloudView, cloudDivisor = 0;
export let cloudMarchView;	// for the shafts of light, which need to know where the sky is open (lightShafts.js)
function makeCloudTexture() {
	if (cloudTexture) cloudTexture.destroy();
	cloudDivisor = Number(settings.cloudResolution) || 2;
	halfSize = [Math.max(Math.ceil(canvas.width / cloudDivisor), 1), Math.max(Math.ceil(canvas.height / cloudDivisor), 1)];
	cloudTexture = device.createTexture({
		label: "cloud march",
		size: halfSize,
		format: 'rgba16float',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
	});
	cloudView = cloudTexture.createView();
	cloudMarchView = cloudView;
}
makeCloudTexture();
onRenderResize(makeCloudTexture);

const cloudUniformBuffer = device.createBuffer({
  label: "cloud Uniform",
  size: 512,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// how far the clouds have drifted, world units along x and z
let driftX = 0, driftZ = 0;
let lastTime = performance.now();
let mapMiddle = [0, 0];

// The 4 numbers cloudShadeAt (vfc_clouds.js) takes to read the coverage map: its middle (x, z), 1 / its width, and the height its shadows are worked out at
export function cloudMapValues() {
	return [mapMiddle[0], mapMiddle[1], 1 / COVERAGE_MAP_WIDTH, settings.waterWorldPosY];
}

// whether there are clouds casting shadows at all
export function cloudsShowing() {
	return settings.enableClouds;
}

// the CloudUniforms struct in vfc_clouds.js
function cloudUniformBufferUpdates() {
	const bufferResult = [];

	const invViewProjectionMatrix = transformations.getInvViewProj();
	for(let i = 0; i < 16; i++) {
		bufferResult.push(invViewProjectionMatrix[i]);
	}

	bufferResult.push(settings.camPosX, settings.camPosY, settings.camPosZ, 0);

	//the light: the sun, warmer the lower it is, or the moon. In the terms of the sky view LUT, where the sun's light is 1
	//		(0.13: what it takes for the sunlit side of a cloud to come out just short of white once it is exposed for the screen.
	//		Any more and the shaded side comes out nearly white as well, and a cloud has no shape)
	const light = lightNow();
	bufferResult.push(light.direction[0], light.direction[1], light.direction[2], 0);
	if (light.isMoon) {
		const strength = 0.13 * 0.08 * light.moonlight;
		bufferResult.push(0.6 * strength, 0.75 * strength, 1.0 * strength, 1.0);
	} else {
		const low = 0.55 * (1 - Math.min(Math.max(light.direction[1] * 3, 0), 1));
		const strength = 0.13 * light.daylight;
		bufferResult.push((1 + (settings.sunColor[0] - 1) * low) * strength, (1 + (settings.sunColor[1] - 1) * low) * strength, (1 + (settings.sunColor[2] - 1) * low) * strength, 1.0);
	}

	//layer
	const seaLevel = settings.waterWorldPosY;
	bufferResult.push(seaLevel + weatherNow.base + settings.cloudHeight);
	bufferResult.push(seaLevel + weatherNow.base + settings.cloudHeight + weatherNow.depth);
	bufferResult.push(0);
	bufferResult.push(settings.terrainWorldSize * 0.5);

	//weather
	bufferResult.push(weatherNow.coverage);
	bufferResult.push(weatherNow.kind);
	bufferResult.push(weatherNow.density * settings.cloudDensity);
	bufferResult.push(0);

	//scroll
	bufferResult.push(driftX);
	bufferResult.push(driftZ);
	bufferResult.push(1 / WEATHER_TILE);
	bufferResult.push(weatherNow.gloom);

	//tower
	bufferResult.push(weatherNow.tower[0], weatherNow.tower[1], weatherNow.tower[2], weatherNow.tower[3]);

	//screen: the size the march draws at, and the two numbers of the projection matrix a depth is made from
	bufferResult.push(halfSize[0], halfSize[1], transformations.projectionMatrix[10], transformations.projectionMatrix[14]);

	//map
	bufferResult.push(...cloudMapValues());

	//quality
	bufferResult.push(settings.cloudSteps);
	bufferResult.push(settings.cloudDrawDistance);
	bufferResult.push(settings.cloudDrawDistance * 0.6);
	bufferResult.push(Math.max(weatherNow.rain, weatherNow.snow));	//(the coverage map says where it rains. In winter the same places are where it snows)

	//the middle layer
	bufferResult.push(seaLevel + MIDDLE_HEIGHT + settings.cloudHeight);
	bufferResult.push(seaLevel + MIDDLE_HEIGHT + settings.cloudHeight + MIDDLE_DEPTH);
	bufferResult.push(settings.cloudLayers >= 2 ? weatherNow.middle : 0);
	bufferResult.push(settings.cloudDensity);

	//shape: how many times deeper than the low layer the cumulonimbus stands, and how sharp the edges of the heaps are
	bufferResult.push(Math.max((TOWER_TOP - weatherNow.base) / weatherNow.depth, 1.2));
	bufferResult.push(settings.cloudCrispness);
	bufferResult.push(0);
	bufferResult.push(0);

	//the moon: drawn with the clouds, so that they can hide it. Which way it is and the angle from the middle of its disc to
	//		the edge, then how strongly it shows (a pale ghost of itself by day)
	const moonDistance = Math.hypot(settings.moonPosX, settings.moonPosY, settings.moonPosZ) || 1;
	bufferResult.push(settings.moonPosX / moonDistance, settings.moonPosY / moonDistance, settings.moonPosZ / moonDistance, settings.moonSize * Math.PI / 180);
	bufferResult.push(settings.enableMoon ? Math.min(settings.moonBrightness, 1) * (1 - 0.6 * light.daylight) : 0, 0, 0, 0);

	//the high layer: cirrus, or the sheet of an overcast day (deeper, and thick enough to be grey from underneath)
	const sheet = weatherNow.sheet;
	bufferResult.push(seaLevel + HIGH_HEIGHT + settings.cloudHeight);
	bufferResult.push(seaLevel + HIGH_HEIGHT + settings.cloudHeight + HIGH_DEPTH[0] + (HIGH_DEPTH[1] - HIGH_DEPTH[0]) * sheet);
	bufferResult.push(settings.cloudLayers >= 3 ? weatherNow.cirrus : 0);
	bufferResult.push(sheet);
	//how thick it is, how much of the sun it lets down on to the layers under it, and how far off it fades into the haze
	bufferResult.push((0.22 - 0.07 * sheet) * settings.cloudDensity);
	bufferResult.push(settings.cloudLayers >= 3 ? 1 - 0.55 * sheet : 1);
	bufferResult.push(settings.cloudDrawDistance * 1.7);
	bufferResult.push(0);

	//the shelf cloud (see weather.js for when there is one, and shelfDensity in vfc_clouds.js for its shape)
	bufferResult.push(weatherNow.shelf[0], weatherNow.shelf[1], weatherNow.shelf[2], weatherNow.shelf[3]);
	bufferResult.push(weatherNow.shelf[4], weatherNow.shelf[5], seaLevel + SHELF_BOTTOM + settings.cloudHeight, seaLevel + SHELF_BOTTOM + SHELF_DEPTH + settings.cloudHeight);

	//what the storm has brought (weather.js): the tornado, the hurricane, how far each has turned, the green of the light, and the lightning (lightning.js)
	bufferResult.push(weatherNow.tornado[0], weatherNow.tornado[1], weatherNow.tornado[2], weatherNow.tornado[3]);
	bufferResult.push(weatherNow.hurricane[0], weatherNow.hurricane[1], weatherNow.hurricane[2], weatherNow.hurricane[3]);
	bufferResult.push(weatherNow.spin[0], weatherNow.spin[1], weatherNow.green, lightningNow.flash);
	bufferResult.push(lightningNow.position[0], lightningNow.position[1], lightningNow.position[2], lightningNow.reach);

	const result = new Float32Array(bufferResult);
	device.queue.writeBuffer(cloudUniformBuffer, 0, result.buffer, result.byteOffset, result.byteLength);
}

// Layouts
//-------------------------------------------------
// what cloudDensity reads (vfc_clouds.js), the same in the march and the coverage map
const densityEntries = (visibility) => [
  {
    binding: 0,
    visibility: visibility,
    buffer: {}
  },
  {
    binding: 1,								//shape noise
    visibility: visibility,
    texture: { viewDimension: '3d' }
  },
  {
    binding: 2,								//detail noise
    visibility: visibility,
    texture: { viewDimension: '3d' }
  },
  {
    binding: 3,								//weather map
    visibility: visibility,
    texture: {}
  },
  {
    binding: 4,								//mountain map
    visibility: visibility,
    texture: {}
  },
  {
    binding: 5,
    visibility: visibility,
    sampler: {}
  },
  {
    binding: 6,
    visibility: visibility,
    sampler: {}
  }
];

const densityResources = () => [
	{ binding: 0, resource: { buffer: cloudUniformBuffer } },
	{ binding: 1, resource: shapeNoise.texture.createView() },
	{ binding: 2, resource: detailNoise.texture.createView() },
	{ binding: 3, resource: weatherMapTexture.createView() },
	{ binding: 4, resource: mountainMapTexture.createView() },
	{ binding: 5, resource: repeatSampler },
	{ binding: 6, resource: clampSampler },
];

const coverageBindGroupLayout = device.createBindGroupLayout({
  label: "cloud coverage Bind Group Layout",
  entries: [
  ...densityEntries(GPUShaderStage.COMPUTE),
  {
    binding: 7,								//the coverage map
    visibility: GPUShaderStage.COMPUTE,
    storageTexture: { access: 'write-only', format: 'rgba8unorm' }
  }
  ]
});

const marchBindGroupLayout = device.createBindGroupLayout({
  label: "cloud march Bind Group Layout",
  entries: [
  ...densityEntries(GPUShaderStage.FRAGMENT),
  {
    binding: 7,								//the frame's depth
    visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType: 'depth' }
  },
  {
    binding: 8,								//sky view LUT
    visibility: GPUShaderStage.FRAGMENT,
    texture: {}
  }
  ]
});

const compositeBindGroupLayout = device.createBindGroupLayout({
  label: "cloud composite Bind Group Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.FRAGMENT,
    buffer: {}
  },
  {
    binding: 1,								//the march
    visibility: GPUShaderStage.FRAGMENT,
    texture: {}
  },
  {
    binding: 2,								//the frame's depth
    visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType: 'depth' }
  }
  ]
});

// Pipelines
//-------------------------------------------------
const coveragePipeline = device.createComputePipeline({
	label: "cloud coverage pipeline",
	layout: device.createPipelineLayout({ label: "cloud coverage Pipeline Layout", bindGroupLayouts: [ coverageBindGroupLayout ] }),
	compute: { module: cloudCoverageShaderModule, entryPoint: "computeMain" },
});

const marchPipeline = device.createRenderPipeline({
	label: "cloud march pipeline",
	layout: device.createPipelineLayout({ label: "cloud march Pipeline Layout", bindGroupLayouts: [ marchBindGroupLayout ] }),
	vertex: {
		module: cloudMarchShaderModule,
		entryPoint: "vertexMain",
		buffers: []					// none: one triangle over the whole screen, made from the vertex number
	},
	fragment: {
		module: cloudMarchShaderModule,
		entryPoint: "fragmentMain",
		targets: [{
		format: 'rgba16float'
		}]
	},
	primitive: {
		topology: 'triangle-list',
	},
});

const compositePipeline = device.createRenderPipeline({
	label: "cloud composite pipeline",
	layout: device.createPipelineLayout({ label: "cloud composite Pipeline Layout", bindGroupLayouts: [ compositeBindGroupLayout ] }),
	vertex: {
		module: cloudCompositeShaderModule,
		entryPoint: "vertexMain",
		buffers: []
	},
	fragment: {
		module: cloudCompositeShaderModule,
		entryPoint: "fragmentMain",
		targets: [{
		format: canvasFormat,
		blend: {
			color: { srcFactor: 'one', dstFactor: 'src-alpha', operation: 'add' },		// the cloud, plus what is there by as much as shows through
			alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
		},
		}]
	},
	primitive: {
		topology: 'triangle-list',
	},
});

// Early in the frame, before anything is drawn: see the top of the file
export function cloudUpdate(aEncoder) {
	if ((Number(settings.cloudResolution) || 2) !== cloudDivisor) {
		makeCloudTexture();
	}
	weatherUpdate();

	// the clouds drift with the wind, a good deal faster than the air at the ground
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	const windLength = Math.hypot(settings.windDirection[0], settings.windDirection[1]) || 1;
	const speed = settings.waterWindSpeed * settings.forestUnitsPerMetre * settings.cloudDriftSpeed;
	driftX += settings.windDirection[0] / windLength * speed * elapsed;
	driftZ += settings.windDirection[1] / windLength * speed * elapsed;

	// the coverage map follows the camera in whole texels, so the shadows do not crawl as the camera moves
	const texel = COVERAGE_MAP_WIDTH / CLOUD_MAP_SIZE;
	mapMiddle = [Math.round(settings.camPosX / texel) * texel, Math.round(settings.camPosZ / texel) * texel];

	updateMountainMap();
	cloudUniformBufferUpdates();

	if (!settings.enableClouds) {
		// no clouds: the map is cleared to clear sky, so nothing that reads it has to know
		const clearPass = aEncoder.beginRenderPass({
			colorAttachments: [{
				view: cloudCoverageView,
				loadOp: "clear",
				clearValue: { r: 1.0, g: 0.0, b: 0.0, a: 1.0 },
				storeOp: "store",
			}],
			timestampWrites: profiler.timestamps('Clear (clouds off)', null),
		});
		clearPass.end();
		return;
	}

	const computePass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Coverage', 'c_cloudCoverage') });
	computePass.setPipeline(coveragePipeline);
	computePass.setBindGroup(0, device.createBindGroup({
		label: "cloud coverage bind group",
		layout: coverageBindGroupLayout,
		entries: [
			...densityResources(),
			{ binding: 7, resource: cloudCoverageView },
		],
	}));
	const groups = Math.ceil(CLOUD_MAP_SIZE / CLOUD_MAP_WORKGROUP);
	computePass.dispatchWorkgroups(groups, groups);
	computePass.end();
}

// Last, over the finished frame and the sky
export function cloudPass(mainpassDepthTexture) {
	if (!settings.enableClouds) {
		return;
	}
	const encoder = device.createCommandEncoder();
	const depthView = mainpassDepthTexture.createView();

	//-------------THE MARCH------------------
	const marchPass = encoder.beginRenderPass({
		colorAttachments: [{
			view: cloudView,
			loadOp: "clear",
			clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
			storeOp: "store",
		}],
		timestampWrites: profiler.timestamps('March', 'vf_cloudMarch'),
	});
	marchPass.setPipeline(marchPipeline);
	marchPass.setBindGroup(0, device.createBindGroup({
		label: "cloud march bind group",
		layout: marchBindGroupLayout,
		entries: [
			...densityResources(),
			{ binding: 7, resource: depthView },
			{ binding: 8, resource: skyViewLUTtexture.createView() },
		],
	}));
	marchPass.draw(3);
	marchPass.end();

	//-------------OVER THE FRAME------------------
	const compositePass = encoder.beginRenderPass({
		colorAttachments: [{
			view: context.getCurrentTexture().createView(),
			loadOp: "load",
			storeOp: "store",
		}],
		timestampWrites: profiler.timestamps('Over the Frame', 'vf_cloudComposite'),
	});
	compositePass.setPipeline(compositePipeline);
	compositePass.setBindGroup(0, device.createBindGroup({
		label: "cloud composite bind group",
		layout: compositeBindGroupLayout,
		entries: [
			{ binding: 0, resource: { buffer: cloudUniformBuffer } },
			{ binding: 1, resource: cloudView },
			{ binding: 2, resource: depthView },
		],
	}));
	compositePass.draw(3);
	compositePass.end();

	device.queue.submit([encoder.finish()]);
}
