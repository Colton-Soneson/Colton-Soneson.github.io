import {device} from './deviceSelection.js'
import { frameTexture, drawn } from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {onRenderResize} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { c_cloudNoise } from '../shaders/js/vfc_clouds.js'
import { c_cloudCoverage } from '../shaders/js/vfc_clouds.js'
import { c_cloudCells, CLOUD_CELLS_SIZE, CLOUD_CELLS_WORKGROUP } from '../shaders/js/vfc_clouds.js'
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
		cloudUpdate		early, before anything is drawn: moves the weather on, lets the clouds drift, lays out the heaps
						round the camera (the heaps' map, c_cloudCells), and takes the picture of them from above (the
						coverage map) that the shadows on the ground and the water are read from
		cloudPass		last, over the finished frame and the sky: marches the clouds at half size, and lays them on
*/

const WEATHER_MAP_SIZE = 256;		// texels along a side of the weather map
const WEATHER_TILE = 21000.0;		// and the stretch of world one tile of it covers
const MOUNTAIN_MAP_SIZE = 64;
// (the bottom of the high layer, world units above the sea: settings.cloudCirrusHeight, 8 km)
const HIGH_DEPTH = [500.0, 1400.0];	// how deep it is: as cirrus, and as the sheet of an overcast day
const SHELF_BOTTOM = 230.0;			// a shelf cloud: the height of its bottom above the sea, and how deep it is
const SHELF_DEPTH = 760.0;
// (the bottom of the middle layer, Layers 3 only: settings.cloudMiddleHeight, over the tops of all but the towering heaps)
const MIDDLE_DEPTH = 900.0;
// (how high a cumulonimbus stands above the sea, and how much wider than the weather has it: settings.cloudTowerTop, cloudTowerWidth)
// THE HEAPS (c_cloudCells, heapDensity in vfc_clouds.js): the low layer is heaps, each its own cloud. Their numbers are settings
//		(settings.js: THE HEAPS): the bottom, the weather's base times BASE_LIFT and Cloud Base Height (a fair day's 500: 1800, 900 m up);
//		the tallest heap of a fair day and of a towering one; the deck, the weather's depth times Deck Depth
const BASE_LIFT = 3.6;
const HEAP_CELL = 4400.0;			// one heap at most to a cell this wide: 0.6 to 0.9 of it across (times the size across, and Heap Spacing)
const CELLS_REACH = 60000.0;		// the heaps' map reaches as far from the camera as the clouds are drawn, but no further than this
const COVERAGE_MAP_WIDTH = 16384.0;	// the stretch of world the coverage map covers, centered on the camera
// THE CLOUDS' SIZE (settings.cloudSizeX, Y and Z): the heights and depths above, and the weather's own (weather.js), are at Y 1; the
//		billows, the heads and the fields of them (the shape noise, vfc_clouds.js; WEATHER_TILE) at X and Z 1
const sizeY = () => Math.max(settings.cloudSizeY ?? 1, 0.1);
// (the layers' bottoms go up half as fast as they deepen: the clouds stand taller, not only higher)
const raiseY = () => 1 + (sizeY() - 1) * 0.5;
const sizeAcross = () => Math.sqrt(Math.max(settings.cloudSizeX ?? 1, 0.1) * Math.max(settings.cloudSizeZ ?? 1, 0.1));
// the low layer's bottom and top (world units above the sea, as the weather has them, the size and the Height setting on them): lightning.js, lightShafts.js
//		(its top: the tallest heap there can be. The heaps tower where the weather's kind is over 0.5, and it is up to 0.175 over the day's here and there: weatherAt)
const toweringMost = () => Math.min(Math.max((weatherNow.kind + 0.175 - 0.5) * 2.2 + settings.cloudTowering, 0), 1);
const heapsTallest = () => (settings.cloudHeapTop + (settings.cloudToweringTop - settings.cloudHeapTop) * toweringMost()) * sizeY();
const deckDepth = () => weatherNow.depth * settings.cloudDeckDepth * sizeY();
export const lowLayer = () => {
	const bottom = weatherNow.base * BASE_LIFT * settings.cloudBaseScale * raiseY() + settings.cloudHeight;
	return { bottom: bottom, top: bottom + Math.max(heapsTallest(), deckDepth()) };
};

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

// the heaps' map: where the heaps stand, round the camera (c_cloudCells). Made every frame
const cellsTexture = device.createTexture({
	label: "cloud heaps map",
	size: [CLOUD_CELLS_SIZE, CLOUD_CELLS_SIZE],
	format: 'rgba16float',
	usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
});
const cellsView = cellsTexture.createView();

// the march, in levels (see DYNAMIC RESOLUTION in vfc_clouds.js). Each: light (rgb: the light the clouds send to the eye, a: how much of
//		what is behind them shows through) and near (how near the cloud the ray met was, world units), at the canvas's size over its
//		divisor. settings.cloudResolution 0: dynamic, from settings.cloudCoarsest (an eighth or a quarter) up through every halving to
//		the full size; 1, 2, 3 or 4: one level, the full size, a half, a third or a quarter. Made again when those or the canvas's size
//		change (see display.js). The finest is what is laid over the frame (and read by the shafts of light)
//		Each level has two of each, drawn into by turns: one this frame, the other what it drew the frame before (THE UPDATE RATE in
//		vfc_clouds.js). near is rg: x how near the cloud was, y how far the ray went
let levels = [], levelsKey = '';
let halfSize, cloudView;
export let cloudMarchView;	// for the shafts of light, which need to know where the sky is open (lightShafts.js)
const resolutionKey = () => `${Number(settings.cloudResolution) || 0}:${Number(settings.cloudCoarsest) || 8}`;
// (what the coarsest level is given as its coarser one: nothing, 1 texel)
const noLight = device.createTexture({ label: "cloud march none", size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
const noNear = device.createTexture({ label: "cloud march near none", size: [1, 1], format: 'rg32float', usage: GPUTextureUsage.TEXTURE_BINDING });
const noPackedLight = device.createTexture({ label: "cloud march packed none", size: [1, 1], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING });
const LEVEL_FLOATS = 28;	// MarchLevel in vfc_clouds.js: size, before (a 4 by 4), rate, drift
function makeCloudTextures() {
	for (const L of levels) { for (const T of [...L.turns, ...(L.packed ? [L.packed] : [])]) { T.light.destroy(); T.near.destroy(); } L.uniforms.destroy(); }
	carriedFrom = null;	// (nothing drawn before to carry over)
	levelsKey = resolutionKey();
	const fixed = Number(settings.cloudResolution) || 0;
	const divisors = [];
	if (fixed >= 1) divisors.push(fixed);
	else for (let d = Number(settings.cloudCoarsest) >= 8 ? 8 : 4; d >= 1; d /= 2) divisors.push(d);
	levels = divisors.map((divisor) => {
		const size = [Math.max(Math.ceil(drawn.width / divisor), 1), Math.max(Math.ceil(drawn.height / divisor), 1)];
		const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
		const turns = [0, 1].map((t) => {
			const light = device.createTexture({ label: `cloud march 1/${divisor} (${t})`, size, format: 'rgba16float', usage });
			const near = device.createTexture({ label: `cloud march near 1/${divisor} (${t})`, size, format: 'rg32float', usage });
			return { light, near, lightView: light.createView(), nearView: near.createView() };
		});
		const uniforms = device.createBuffer({ label: `cloud march level 1/${divisor}`, size: LEVEL_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		return { divisor, size, turns, uniforms };
	});
	pickTurn(0);
}
// which of each level's two is drawn into this frame: the finest one's is what is laid over the frame
let turn = 0;
function pickTurn(t) {
	turn = t;
	for (const L of levels) { Object.assign(L, L.turns[t]); L.before = L.turns[1 - t]; }
	const finest = levels[levels.length - 1];
	halfSize = finest.size;
	cloudView = finest.lightView;
	cloudMarchView = cloudView;
}
// THE UPDATE RATE: what the frame before was marched with (null: nothing to carry over), and how many frames have been marched
let carriedFrom = null, cloudFrame = 0, updates = 0;
export const cloudRateStats = { every: 1, carried: false };
makeCloudTextures();
onRenderResize(makeCloudTextures);

const cloudUniformBuffer = device.createBuffer({
  label: "cloud Uniform",
  size: 768,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// how far the clouds have drifted, world units along x and z
let driftX = 0, driftZ = 0;
let lastTime = performance.now();
let mapMiddle = [0, 0];
let cellsMiddle = [0, 0], cellsWidth = 1;		// the heaps' map: its middle in the clouds' frame (the world less how far they have drifted), and its width

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
		const strength = 0.13 * 0.08 * light.moonlight * settings.cloudSunStrength;
		bufferResult.push(0.6 * strength, 0.75 * strength, 1.0 * strength, 1.0);
	} else {
		const low = 0.55 * (1 - Math.min(Math.max(light.direction[1] * 3, 0), 1));
		const strength = 0.13 * light.daylight * settings.cloudSunStrength;
		bufferResult.push((1 + (settings.sunColor[0] - 1) * low) * strength, (1 + (settings.sunColor[1] - 1) * low) * strength, (1 + (settings.sunColor[2] - 1) * low) * strength, 1.0);
	}

	//layer
	const seaLevel = settings.waterWorldPosY;
	const Y = sizeY(), B = raiseY(), low = lowLayer();
	bufferResult.push(seaLevel + low.bottom);
	bufferResult.push(seaLevel + low.top);
	bufferResult.push(Math.max(settings.cloudSizeX ?? 1, 0.1));		//(the size across: x here, z in weather.w)
	bufferResult.push(settings.terrainWorldSize * 0.5);

	//weather
	bufferResult.push(weatherNow.coverage);
	bufferResult.push(weatherNow.kind);
	//(a deeper cloud is walked further through: about as much light goes through it as through the old one, or a big cloud is black)
	bufferResult.push(weatherNow.density * settings.cloudDensity / Math.sqrt(Y));
	bufferResult.push(Math.max(settings.cloudSizeZ ?? 1, 0.1));

	//scroll
	bufferResult.push(driftX);
	bufferResult.push(driftZ);
	bufferResult.push(1 / (WEATHER_TILE * sizeAcross()));
	bufferResult.push(weatherNow.gloom);

	//tower
	bufferResult.push(weatherNow.tower[0], weatherNow.tower[1], weatherNow.tower[2] * settings.cloudTowerWidth * sizeAcross(), weatherNow.tower[3]);

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
	bufferResult.push(seaLevel + settings.cloudMiddleHeight * B + settings.cloudHeight);
	bufferResult.push(seaLevel + settings.cloudMiddleHeight * B + MIDDLE_DEPTH * Y + settings.cloudHeight);
	bufferResult.push(settings.cloudLayers >= 3 ? Math.min(weatherNow.middle * settings.cloudMiddleAmount, 1) : 0);
	bufferResult.push(settings.cloudDensity / Math.sqrt(Y));

	//shape: how tall the cumulonimbus stands over the bottom of the layer, how sharp the edges of the heaps are, and how tall the tallest heap stands on a fair day and a towering one
	bufferResult.push(Math.max(settings.cloudTowerTop * Y + settings.cloudHeight - low.bottom, heapsTallest() * 1.2));
	bufferResult.push(settings.cloudCrispness);
	bufferResult.push(settings.cloudHeapTop * Y);
	bufferResult.push(settings.cloudToweringTop * Y);

	//the moon: drawn with the clouds, so that they can hide it. Which way it is and the angle from the middle of its disc to
	//		the edge, then how strongly it shows (a pale ghost of itself by day)
	const moonDistance = Math.hypot(settings.moonPosX, settings.moonPosY, settings.moonPosZ) || 1;
	bufferResult.push(settings.moonPosX / moonDistance, settings.moonPosY / moonDistance, settings.moonPosZ / moonDistance, settings.moonSize * Math.PI / 180);
	bufferResult.push(settings.enableMoon ? Math.min(settings.moonBrightness, 1) * (1 - 0.6 * light.daylight) : 0, 0, 0, 0);

	//the high layer: cirrus, or the sheet of an overcast day (deeper, and thick enough to be grey from underneath)
	const sheet = weatherNow.sheet;
	bufferResult.push(seaLevel + settings.cloudCirrusHeight * B + settings.cloudHeight);
	bufferResult.push(seaLevel + settings.cloudCirrusHeight * B + (HIGH_DEPTH[0] + (HIGH_DEPTH[1] - HIGH_DEPTH[0]) * sheet) * Y + settings.cloudHeight);
	bufferResult.push(settings.cloudLayers >= 2 ? Math.min(weatherNow.cirrus * settings.cloudCirrusAmount, 1.5) : 0);
	bufferResult.push(sheet);
	//how thick it is, how much of the sun it lets down on to the layers under it, and how far off it fades into the haze
	bufferResult.push((0.22 - 0.07 * sheet) * settings.cloudDensity / Math.sqrt(Y));
	bufferResult.push(settings.cloudLayers >= 2 ? 1 - 0.55 * sheet : 1);
	bufferResult.push(settings.cloudDrawDistance * 1.7);
	bufferResult.push(0);

	//the shelf cloud (see weather.js for when there is one, and shelfDensity in vfc_clouds.js for its shape)
	bufferResult.push(weatherNow.shelf[0], weatherNow.shelf[1], weatherNow.shelf[2], weatherNow.shelf[3]);
	bufferResult.push(weatherNow.shelf[4], weatherNow.shelf[5], seaLevel + SHELF_BOTTOM * B + settings.cloudHeight, seaLevel + SHELF_BOTTOM * B + SHELF_DEPTH * Y + settings.cloudHeight);

	//what the storm has brought (weather.js): the tornado, the hurricane, how far each has turned, the green of the light, and the lightning (lightning.js)
	bufferResult.push(weatherNow.tornado[0], weatherNow.tornado[1], weatherNow.tornado[2], weatherNow.tornado[3]);
	bufferResult.push(weatherNow.hurricane[0], weatherNow.hurricane[1], weatherNow.hurricane[2], weatherNow.hurricane[3]);
	bufferResult.push(weatherNow.spin[0], weatherNow.spin[1], weatherNow.green, lightningNow.flash);
	bufferResult.push(lightningNow.position[0], lightningNow.position[1], lightningNow.position[2], lightningNow.reach);

	//the heaps' map, and the heaps: the size of a heap's cell, how far one leans downwind for every unit up, and how deep the deck is
	bufferResult.push(cellsMiddle[0], cellsMiddle[1], 1 / cellsWidth, cellsWidth / CLOUD_CELLS_SIZE);
	const windLength = Math.hypot(settings.windDirection[0], settings.windDirection[1]) || 1;
	const lean = settings.cloudHeapLean;
	bufferResult.push(HEAP_CELL * settings.cloudHeapSpacing * sizeAcross(), settings.windDirection[0] / windLength * lean, settings.windDirection[1] / windLength * lean, deckDepth());

	//the look (settings.js: THE HEAPS), as CloudUniforms in vfc_clouds.js has them
	bufferResult.push(settings.cloudBulbSize, settings.cloudBulbDepth, settings.cloudEdgeSoftness, settings.cloudBaseRagged);
	bufferResult.push(settings.cloudHeapAmount, settings.cloudPuffAmount, settings.cloudHeapWidth, settings.cloudHeightVariety);
	bufferResult.push(settings.cloudTowering, settings.cloudSteepness, settings.cloudLobes, settings.cloudWispiness);
	bufferResult.push(settings.cloudDeckFrom, settings.cloudSkipping ? 1 : 0, Math.round(settings.cloudLightSteps), settings.cloudShadowReach);
	bufferResult.push(settings.cloudForwardScatter, -settings.cloudBackScatter, settings.cloudBackShare, settings.cloudMultiScatter);
	bufferResult.push(settings.cloudShadowStrength, settings.cloudCrevices, settings.cloudUndersides, settings.cloudAmbient);
	bufferResult.push(settings.cloudCirrusScale, settings.cloudMiddleScale, settings.cloudScatterDepth, settings.cloudFarDetail);

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
  },
  {
    binding: 9,								//the heaps' map
    visibility: visibility,
    texture: {}
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
	{ binding: 9, resource: cellsView },
];

// the heaps' map is made from the weather alone
const cellsBindGroupLayout = device.createBindGroupLayout({
  label: "cloud heaps Bind Group Layout",
  entries: [
  { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: {} },
  { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: {} },			//weather map
  { binding: 4, visibility: GPUShaderStage.COMPUTE, texture: {} },			//mountain map
  { binding: 5, visibility: GPUShaderStage.COMPUTE, sampler: {} },
  { binding: 6, visibility: GPUShaderStage.COMPUTE, sampler: {} },
  { binding: 10, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: 'write-only', format: 'rgba16float' } },
  ]
});

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
  },
  { binding: 10, visibility: GPUShaderStage.FRAGMENT, buffer: {} },								//the level
  { binding: 11, visibility: GPUShaderStage.FRAGMENT, texture: {} },							//the coarser level's light
  { binding: 12, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },	//and how near its cloud was
  { binding: 13, visibility: GPUShaderStage.FRAGMENT, texture: {} },							//what this level drew the frame before: its light
  { binding: 14, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },	//and how near its cloud was
  { binding: 15, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },	//this frame's packed pixels: their light
  { binding: 16, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } },	//and how near their cloud was
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
const cellsPipeline = device.createComputePipeline({
	label: "cloud heaps pipeline",
	layout: device.createPipelineLayout({ label: "cloud heaps Pipeline Layout", bindGroupLayouts: [ cellsBindGroupLayout ] }),
	compute: { module: device.createShaderModule({ label: "c_cloudCells", code: c_cloudCells }), entryPoint: "computeMain" },
});

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
		targets: [{ format: 'rgba16float' }, { format: 'rg32float' }]
	},
	primitive: {
		topology: 'triangle-list',
	},
});
// THE UPDATE RATE, PACKED (vfc_clouds.js): only this frame's pixels marched, packed close, and then laid out over the level
const [packedPipeline, resolvePipeline] = ['packedMain', 'resolveMain'].map((entryPoint) => device.createRenderPipeline({
	label: `cloud march pipeline (${entryPoint})`,
	layout: device.createPipelineLayout({ label: `cloud march Pipeline Layout (${entryPoint})`, bindGroupLayouts: [ marchBindGroupLayout ] }),
	vertex: { module: cloudMarchShaderModule, entryPoint: "vertexMain", buffers: [] },
	fragment: { module: cloudMarchShaderModule, entryPoint, targets: [{ format: 'rgba16float' }, { format: 'rg32float' }] },
	primitive: { topology: 'triangle-list' },
}));

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

// THE UPDATE RATE: a camera that has moved further than this (metres) since the frame before has nothing to carry over
const CARRY_JUMP = 300;

// Early in the frame, before anything is drawn: see the top of the file
export function cloudUpdate(aEncoder) {
	updates++;		// (every frame, the clouds on or off: THE UPDATE RATE carries over only from the frame just before)
	if (resolutionKey() !== levelsKey) {
		makeCloudTextures();
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
	// and the heaps' map follows it in whole texels of its own, in the clouds' frame, so a heap stays the same shape as it drifts
	cellsWidth = 2 * Math.min(settings.cloudDrawDistance, CELLS_REACH);
	const cellsTexel = cellsWidth / CLOUD_CELLS_SIZE;
	cellsMiddle = [Math.round((settings.camPosX - driftX) / cellsTexel) * cellsTexel, Math.round((settings.camPosZ - driftZ) / cellsTexel) * cellsTexel];

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

	const cellsPass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Heaps', 'c_cloudCells') });
	cellsPass.setPipeline(cellsPipeline);
	cellsPass.setBindGroup(0, device.createBindGroup({
		label: "cloud heaps bind group",
		layout: cellsBindGroupLayout,
		entries: [
			{ binding: 0, resource: { buffer: cloudUniformBuffer } },
			{ binding: 3, resource: weatherMapTexture.createView() },
			{ binding: 4, resource: mountainMapTexture.createView() },
			{ binding: 5, resource: repeatSampler },
			{ binding: 6, resource: clampSampler },
			{ binding: 10, resource: cellsView },
		],
	}));
	const cellGroups = Math.ceil(CLOUD_CELLS_SIZE / CLOUD_CELLS_WORKGROUP);
	cellsPass.dispatchWorkgroups(cellGroups, cellGroups);
	cellsPass.end();

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
	// a level at a time, the coarsest first (see DYNAMIC RESOLUTION in vfc_clouds.js): each marches again only where the one before met
	//		cloud nearer than its reach, Full Resolution Within (settings.cloudFullResWithin) times its divisor
	const skyView = skyViewLUTtexture.createView();
	const within = Math.max(settings.cloudFullResWithin ?? 1200, 1) * settings.forestUnitsPerMetre;
	// THE UPDATE RATE (see vfc_clouds.js): this frame into the other of each level's two. What the frame before drew is carried
	//		over where a pixel is not marched this frame, unless there was no frame before (the clouds just turned on, the levels
	//		just made, a frame gone by without them) or the camera has jumped
	pickTurn(1 - turn);
	const every = Math.min(Math.max(Math.round(settings.cloudUpdateEvery ?? 1), 1), 16);
	const camera = [settings.camPosX, settings.camPosY, settings.camPosZ];
	const viewProj = transformations.getViewProj();
	const from = carriedFrom;
	const carry = every > 1 && !!from && from.update == updates - 1 && Math.hypot(...camera.map((v, i) => v - from.camera[i])) < CARRY_JUMP * settings.forestUnitsPerMetre;
	cloudFrame++;
	cloudRateStats.every = every; cloudRateStats.carried = carry;
	levels.forEach((L, k) => {
		const coarser = k > 0 ? levels[k - 1] : null;
		const level = new Float32Array(LEVEL_FLOATS);
		level.set([L.size[0], L.size[1], within * L.divisor, coarser ? 1 : 0], 0);
		level.set(from?.viewProj ?? viewProj, 4);
		const slots = Math.ceil(16 / every);	// (the most of a 4 by 4 block's pixels marched in one frame)
		level.set([every, cloudFrame % every, carry ? 1 : 0, slots], 20);
		level.set([driftX - (from?.drift[0] ?? driftX), driftZ - (from?.drift[1] ?? driftZ), 0, 0], 24);
		device.queue.writeBuffer(L.uniforms, 0, level);
		const name = L.divisor == 1 ? 'March (full)' : `March (1/${L.divisor})`;
		const pass = (pipeline, light, near, packed, label) => {
			const marchPass = encoder.beginRenderPass({
				colorAttachments: [
					{ view: light, loadOp: "clear", clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }, storeOp: "store" },
					{ view: near, loadOp: "clear", clearValue: { r: 1e9, g: 1e9, b: 0, a: 0 }, storeOp: "store" },
				],
				timestampWrites: profiler.timestamps(label, 'vf_cloudMarch'),
			});
			marchPass.setPipeline(pipeline);
			marchPass.setBindGroup(0, device.createBindGroup({
				label: "cloud march bind group",
				layout: marchBindGroupLayout,
				entries: [
					...densityResources(),
					{ binding: 7, resource: depthView },
					{ binding: 8, resource: skyView },
					{ binding: 10, resource: { buffer: L.uniforms } },
					{ binding: 11, resource: coarser ? coarser.lightView : noLight.createView() },
					{ binding: 12, resource: coarser ? coarser.nearView : noNear.createView() },
					{ binding: 13, resource: L.before.lightView },
					{ binding: 14, resource: L.before.nearView },
					{ binding: 15, resource: packed ? packed.lightView : noPackedLight.createView() },
					{ binding: 16, resource: packed ? packed.nearView : noNear.createView() },
				],
			}));
			marchPass.draw(3);
			marchPass.end();
		};
		if (!carry) {
			pass(marchPipeline, L.lightView, L.nearView, null, name);
			return;
		}
		// (this frame's pixels, packed: a target of its own, made again when the size or the rate changes. Too wide for the GPU, on a
		//		very wide screen at a low rate: every pixel marched, as at a rate of 1)
		const size = [Math.ceil(L.size[0] / 4) * slots, Math.ceil(L.size[1] / 4)];
		if (size[0] > device.limits.maxTextureDimension2D) {
			pass(marchPipeline, L.lightView, L.nearView, null, name);
			return;
		}
		if (L.packed?.key !== size.join()) {
			if (L.packed) { L.packed.light.destroy(); L.packed.near.destroy(); }
			const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
			const light = device.createTexture({ label: `cloud march packed 1/${L.divisor}`, size, format: 'rgba16float', usage });
			const near = device.createTexture({ label: `cloud march packed near 1/${L.divisor}`, size, format: 'rg32float', usage });
			L.packed = { key: size.join(), light, near, lightView: light.createView(), nearView: near.createView() };
		}
		pass(packedPipeline, L.packed.lightView, L.packed.nearView, null, name);
		pass(resolvePipeline, L.lightView, L.nearView, L.packed, name + ' laid out');
	});
	carriedFrom = { update: updates, camera, viewProj, drift: [driftX, driftZ] };

	//-------------OVER THE FRAME------------------
	const compositePass = encoder.beginRenderPass({
		colorAttachments: [{
			view: frameTexture().createView(),
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
