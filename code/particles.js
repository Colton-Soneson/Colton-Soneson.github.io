import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { settings } from './settings.js';

import { c_leaves, vf_leaves, c_spray, vf_spray, vf_rain } from '../shaders/js/vfc_particles.js'
import { PARTICLE_WORKGROUP_SIZE, LEAF_VERTICES, SPRAY_VERTICES, RAIN_VERTICES } from '../shaders/js/vfc_particles.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as forest from './forest.js'
import * as boulders from './boulders.js'
import * as scene from './scene.js'
import * as water from './water.js'
import * as wind from './wind.js'
import * as clouds from './clouds.js'
import { weatherNow } from './weather.js'
import { BOULDER_FLOATS } from './boulderGenerator.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	The particles: leaves off the trees, spray off the wave crests, rain. See the top of vfc_particles.js for how each works.

	Three times a frame:
		particleUpdate		before anything is drawn: the numbers they all share, and (now and then) the lists the leaves need,
							of the trees near the camera they can come from and the things near it that stand in their way
		leafPass			with the solid things, before the screen space effects: moves the leaves on and draws them
		weatherParticlePass	last of all, over the water and the clouds: moves the spray on, and draws it and the rain.
							These two are see-through, so they have to go on after everything that is behind them
*/

const LEAF_COUNT = 4096;			// leaves there can be in the air at once
const SPRAY_COUNT = 4096;			// bits of spray
const RAIN_COUNT = 9000;			// raindrops in the box of air round the camera
const MAX_SOURCES = 64;				// trees leaves come from at one time
const MAX_OBSTACLES = 128;			// things that stand in a leaf's way at one time
const SOURCE_DISTANCE = 120.0;		// how far from the camera a tree can be and still shed leaves that are drawn
const OBSTACLE_DISTANCE = 90.0;		// how far from the camera things are steered round
const PARTICLE_BYTES = 48;			// the Particle struct in vfc_particles.js: 12 numbers

// Shader modules
//-------------------------------------------------
const leafSimShaderModule = device.createShaderModule({ label: "c_leaves", code: c_leaves });
const leafShaderModule = device.createShaderModule({ label: "vf_leaves", code: vf_leaves });
const spraySimShaderModule = device.createShaderModule({ label: "c_spray", code: c_spray });
const sprayShaderModule = device.createShaderModule({ label: "vf_spray", code: vf_spray });
const rainShaderModule = device.createShaderModule({ label: "vf_rain", code: vf_rain });

// Buffers
//-------------------------------------------------
const particleUniformBuffer = device.createBuffer({
  label: "particle Uniform",
  size: 256,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// every leaf starts on a tree, each due to let go at a different moment
const leafBuffer = device.createBuffer({
	label: "leaves",
	size: LEAF_COUNT * PARTICLE_BYTES,
	usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
{
	const start = new Float32Array(LEAF_COUNT * PARTICLE_BYTES / 4);
	for (let i = 0; i < LEAF_COUNT; i++) {
		start[i * PARTICLE_BYTES / 4 + 3] = Math.random() * 5;	// life: seconds until it lets go
	}
	device.queue.writeBuffer(leafBuffer, 0, start);
}

// and no spray is in the air (a new buffer is all zeros, which is that)
const sprayBuffer = device.createBuffer({
	label: "spray",
	size: SPRAY_COUNT * PARTICLE_BYTES,
	usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const sourceBuffer = device.createBuffer({
	label: "leaf sources",
	size: MAX_SOURCES * 16,
	usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const obstacleBuffer = device.createBuffer({
	label: "leaf obstacles",
	size: MAX_OBSTACLES * 16,
	usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
let sourceCount = 0, obstacleCount = 0;
let listsFrom = null;		// where the camera was when the two lists were last made
let listsAge = 0;			// and how many frames ago

// The two lists the leaves need, made again every so often and whenever the camera has moved a way
function updateLeafLists() {
	const camera = [settings.camPosX, settings.camPosZ];
	listsAge++;
	if (listsFrom && listsAge < 45 && Math.hypot(camera[0] - listsFrom[0], camera[1] - listsFrom[1]) < 25) {
		return;
	}
	listsFrom = camera;
	listsAge = 0;

	const sources = [], obstacles = [];
	const metre = settings.forestUnitsPerMetre;
	if (settings.enableForest) {
		for (const tree of forest.trees) {
			if (!tree || tree.dead || !tree.height) {
				continue;
			}
			const away = Math.hypot(tree.x - camera[0], tree.z - camera[1]);
			// leaves come off any tree with a crown to speak of. The broadleaves (oak 2, birch 3) shed far more than the conifers
			if (away < SOURCE_DISTANCE && tree.height > 5 * metre && (tree.species >= 2 || Math.random() < 0.25)) {
				sources.push([tree.x, tree.y + 0.68 * tree.height, tree.z, Math.max(tree.crownRadius ?? 0.25 * tree.height, 1), away]);
			}
			// a trunk: up to where the crown starts
			if (away < OBSTACLE_DISTANCE) {
				obstacles.push([tree.x, tree.z, Math.max(0.018 * tree.height, 0.15 * metre), tree.y + 0.45 * tree.height, away]);
			}
		}
	}
	if (settings.enableBoulders) {
		const places = boulders.boulderPlaces();
		for (let i = 0; i < places.length; i += BOULDER_FLOATS) {
			const away = Math.hypot(places[i] - camera[0], places[i + 2] - camera[1]);
			if (away < OBSTACLE_DISTANCE) {
				obstacles.push([places[i], places[i + 2], 0.5 * places[i + 3], places[i + 1] + 0.7 * places[i + 3], away]);
			}
		}
	}
	// the buildings, each about as wide and as tall as this
	const buildings = { Lighthouse: [7, 46], IslandHouse: [10, 14], Bench: [2.5, 3] };
	for (const model of scene.entityModels) {
		const building = buildings[model.name];
		if (building) {
			const away = Math.hypot(model.worldTranslation[0] - camera[0], model.worldTranslation[2] - camera[1]);
			if (away < OBSTACLE_DISTANCE * 1.5) {
				obstacles.push([model.worldTranslation[0], model.worldTranslation[2], building[0], model.worldTranslation[1] + building[1], away]);
			}
		}
	}

	// if there are too many of either, the trees are picked by lot and the things in the way by which are nearest
	for (let i = sources.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[sources[i], sources[j]] = [sources[j], sources[i]];
	}
	obstacles.sort((a, b) => a[4] - b[4]);
	sourceCount = Math.min(sources.length, MAX_SOURCES);
	obstacleCount = Math.min(obstacles.length, MAX_OBSTACLES);

	const sourceData = new Float32Array(MAX_SOURCES * 4), obstacleData = new Float32Array(MAX_OBSTACLES * 4);
	for (let i = 0; i < sourceCount; i++) sourceData.set(sources[i].slice(0, 4), i * 4);
	for (let i = 0; i < obstacleCount; i++) obstacleData.set(obstacles[i].slice(0, 4), i * 4);
	device.queue.writeBuffer(sourceBuffer, 0, sourceData);
	device.queue.writeBuffer(obstacleBuffer, 0, obstacleData);
}

let lastTime = performance.now();
let seconds = 0;
let frame = 0;
let crests = null;		// the water mesh the spray looks for crests in this frame, see waterCrestVertices in water.js

// the ParticleUniforms struct in vfc_particles.js
function particleUniformBufferUpdates() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.05);	// a frame that took for ever does not throw everything across the world
	lastTime = now;
	seconds += elapsed;
	frame++;

	const bufferResult = [];
	const viewProjectionMatrix = transformations.getViewProj();
	for(let i = 0; i < 16; i++) {
		bufferResult.push(viewProjectionMatrix[i]);
	}
	bufferResult.push(settings.camPosX, settings.camPosY, settings.camPosZ, seconds);

	// right and up on the screen, for the cards that face the camera. Read off the rows of the view matrix
	const view = transformations.getViewMatrix();
	bufferResult.push(view[0], view[4], view[8], Math.max(settings.leafWeight, 0.05));	// (and in the slot left over: how heavy a leaf is)
	bufferResult.push(view[1], view[5], view[9], 0);

	bufferResult.push(...wind.windUniformValues());

	//step
	bufferResult.push(elapsed);
	bufferResult.push(settings.waterWindSpeed * settings.forestUnitsPerMetre);
	bufferResult.push(frame % 1000000);
	bufferResult.push(settings.leafAmount);

	//terrain
	bufferResult.push(settings.terrainWorldSize * 0.5);
	bufferResult.push(terrain.land ? terrain.land.cellSize : 8);
	bufferResult.push(settings.waterWorldPosY);
	bufferResult.push(settings.forestUnitsPerMetre);

	//counts
	crests = settings.enableWater && settings.enableSeaSpray ? water.waterCrestVertices() : null;
	bufferResult.push(sourceCount);
	bufferResult.push(obstacleCount);
	bufferResult.push(crests ? crests.count : 0);
	bufferResult.push(settings.enableRain && settings.enableClouds ? weatherNow.rain : 0);

	bufferResult.push(...clouds.cloudMapValues());

	//amounts
	bufferResult.push(settings.leafSize);
	bufferResult.push(settings.sprayAmount);
	bufferResult.push(settings.rainDistance);
	bufferResult.push(settings.rainAmount);

	const result = new Float32Array(bufferResult);
	device.queue.writeBuffer(particleUniformBuffer, 0, result.buffer, result.byteOffset, result.byteLength);
}

// Pipelines
//-------------------------------------------------
// (the layouts are read off the shaders: 'auto')
const leafSimPipeline = device.createComputePipeline({
	label: "leaf simulation pipeline",
	layout: 'auto',
	compute: { module: leafSimShaderModule, entryPoint: "computeMain" },
});

const spraySimPipeline = device.createComputePipeline({
	label: "spray simulation pipeline",
	layout: 'auto',
	compute: { module: spraySimShaderModule, entryPoint: "computeMain" },
});

const leafPipeline = device.createRenderPipeline({
	label: "leaf pipeline",
	layout: 'auto',
	vertex: {
		module: leafShaderModule,
		entryPoint: "vertexMain",
		buffers: []					// none: the vertex shader makes every leaf from its vertex and instance number
	},
	fragment: {
		module: leafShaderModule,
		entryPoint: "fragmentMain",
		targets: [{
		format: canvasFormat
		}]
	},
	primitive: {
		topology: 'triangle-list',
		cullMode: 'none',			// a leaf is seen from both sides
	},
	depthStencil: {
		depthWriteEnabled: true,
		depthCompare: 'less',
		format: 'depth24plus',
	},
});

// see-through: blended over what is there, hidden by anything in front, and leaving the depth alone
function createSoftPipeline(label, shaderModule) {
	return device.createRenderPipeline({
		label: label,
		layout: 'auto',
		vertex: {
			module: shaderModule,
			entryPoint: "vertexMain",
			buffers: []
		},
		fragment: {
			module: shaderModule,
			entryPoint: "fragmentMain",
			targets: [{
			format: canvasFormat,
			blend: {
				color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
				alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
			},
			}]
		},
		primitive: {
			topology: 'triangle-list',
			cullMode: 'none',
		},
		depthStencil: {
			depthWriteEnabled: false,
			depthCompare: 'less',
			format: 'depth24plus',
		},
	});
}
const sprayPipeline = createSoftPipeline("spray pipeline", sprayShaderModule);
const rainPipeline = createSoftPipeline("rain pipeline", rainShaderModule);

const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

// Before anything is drawn: see the top of the file
export function particleUpdate() {
	if (settings.enableLeaves) {
		updateLeafLists();
	}
	particleUniformBufferUpdates();
}

// The leaves: moved on, then drawn with the solid things
export function leafPass(aEncoder, mainpassDepthTexture) {
	if (!settings.enableLeaves || !settings.enableTerrain || !terrain.terrainFieldsTexture) {
		return;
	}

	const computePass = aEncoder.beginComputePass();
	computePass.setPipeline(leafSimPipeline);
	computePass.setBindGroup(0, device.createBindGroup({
		label: "leaf simulation bind group",
		layout: leafSimPipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: particleUniformBuffer } },
			{ binding: 1, resource: { buffer: leafBuffer } },
			{ binding: 2, resource: { buffer: sourceBuffer } },
			{ binding: 3, resource: { buffer: obstacleBuffer } },
			{ binding: 4, resource: wind.windTextureView },
			{ binding: 5, resource: wind.windSampler },
			{ binding: 6, resource: terrain.terrainFieldsTexture.createView() },
		],
	}));
	computePass.dispatchWorkgroups(Math.ceil(LEAF_COUNT / PARTICLE_WORKGROUP_SIZE));
	computePass.end();

	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{
			view: context.getCurrentTexture().createView(),
			loadOp: "load",
			storeOp: "store",
		}],
		depthStencilAttachment: {
			view: mainpassDepthTexture.createView(),
			depthLoadOp: 'load',
			depthStoreOp: 'store',
		},
	});
	pass.setPipeline(leafPipeline);
	pass.setBindGroup(0, device.createBindGroup({
		label: "leaf bind group",
		layout: leafPipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: particleUniformBuffer } },
			{ binding: 1, resource: { buffer: uniformBufferLights } },
			{ binding: 2, resource: { buffer: leafBuffer } },
		],
	}));
	pass.draw(LEAF_VERTICES, LEAF_COUNT, 0, 0);
	pass.end();
}

// The spray and the rain: last of all, over the water and the clouds
export function weatherParticlePass(mainpassDepthTexture) {
	const spraying = crests !== null;
	const raining = settings.enableRain && settings.enableClouds && weatherNow.rain > 0.001;
	if (!spraying && !raining) {
		return;
	}
	const encoder = device.createCommandEncoder();

	if (spraying) {
		const computePass = encoder.beginComputePass();
		computePass.setPipeline(spraySimPipeline);
		computePass.setBindGroup(0, device.createBindGroup({
			label: "spray simulation bind group",
			layout: spraySimPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: particleUniformBuffer } },
				{ binding: 1, resource: { buffer: sprayBuffer } },
				{ binding: 2, resource: { buffer: crests.buffer } },
				{ binding: 3, resource: wind.windTextureView },
				{ binding: 4, resource: wind.windSampler },
			],
		}));
		computePass.dispatchWorkgroups(Math.ceil(SPRAY_COUNT / PARTICLE_WORKGROUP_SIZE));
		computePass.end();
	}

	const pass = encoder.beginRenderPass({
		colorAttachments: [{
			view: context.getCurrentTexture().createView(),
			loadOp: "load",
			storeOp: "store",
		}],
		depthStencilAttachment: {
			view: mainpassDepthTexture.createView(),
			depthLoadOp: 'load',
			depthStoreOp: 'store',
		},
	});
	if (spraying) {
		pass.setPipeline(sprayPipeline);
		pass.setBindGroup(0, device.createBindGroup({
			label: "spray bind group",
			layout: sprayPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: particleUniformBuffer } },
				{ binding: 1, resource: { buffer: uniformBufferLights } },
				{ binding: 2, resource: { buffer: sprayBuffer } },
			],
		}));
		pass.draw(SPRAY_VERTICES, SPRAY_COUNT, 0, 0);
	}
	if (raining) {
		pass.setPipeline(rainPipeline);
		pass.setBindGroup(0, device.createBindGroup({
			label: "rain bind group",
			layout: rainPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: particleUniformBuffer } },
				{ binding: 1, resource: clouds.cloudCoverageView },
				{ binding: 2, resource: linSampler },
			],
		}));
		pass.draw(RAIN_VERTICES, RAIN_COUNT, 0, 0);
	}
	pass.end();

	device.queue.submit([encoder.finish()]);
}
