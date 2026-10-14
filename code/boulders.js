import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { settings } from './settings.js';

import { buildBoulderMesh, placeBoulders, BOULDER_SHAPES, BOULDER_VERTEX_FLOATS, BOULDER_FLOATS } from './boulderGenerator.js'

import { vf_boulders } from '../shaders/js/vf_boulders.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import { weatherNow } from './weather.js'

//the boulders fade into the horizon color, read from the sky view LUT (same as the water, the land, the grass and the trees)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	Boulders: at the foot of the mountains and on their ridges, under the trees, in the grass, along the top of the beaches
	and out in the sea. boulderGenerator.js makes their shapes and works out where they lie, this file owns the result and
	draws it, vf_boulders.js is the shader.

	There are BOULDER_SHAPES shapes of boulder and each has two meshes, a fine one and a coarse one for far away.
	Every frame the boulders near enough to see are sorted by shape and by which mesh they get, their records are written
	end to end into one buffer, and each (shape, mesh) is one draw call for all of its boulders at once.
*/

const NEAR_DETAIL = 2;		// times the ball's triangles are cut into 4: 320 triangles
const FAR_DETAIL = 1;		// 80 triangles
const NEAR_SIZES = 55;		// a boulder gets the fine mesh while it is nearer than this many times its own size
const SEEN_SIZES = 700;		// and is not drawn at all from further off than this many times its size: by then it is smaller than a pixel

// every setting where the boulders lie depends on. If one of these changes (or the land does) they are laid out again
function getBoulderParams() {
	return {
		seed: settings.terrainSeed,
		amount: settings.boulderAmount,
		seaLevel: settings.waterWorldPosY,
		unitsPerMetre: settings.forestUnitsPerMetre,
		beachHeight: settings.terrainBeachHeight,
		bankHeight: settings.terrainBankHeight,
	};
}

export const boulderStats = { boulders: 0, drawn: 0 };	// how many there are and how many the last frame drew, for anyone who wants to show it
let boulders = new Float32Array(0);		// see placeBoulders

// where they all lie, for anything that has to go round them (the leaves): the Float32Array placeBoulders returns
export function boulderPlaces() {
	return boulders;
}
let instanceBuffer;
let instanceData = new Float32Array(0);
let laidParams = "";					// the params the boulders were laid out from
let laidLand;							// and the land they were laid out on

// the meshes: [shape][0 fine, 1 coarse] -> { buffer, vertices }
const meshes = [];
for (let shape = 0; shape < BOULDER_SHAPES; shape++) {
	meshes.push([NEAR_DETAIL, FAR_DETAIL].map((detail) => {
		const data = buildBoulderMesh(shape, detail);
		const buffer = device.createBuffer({
			label: "boulder vertices",
			size: data.byteLength,
			usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
		});
		device.queue.writeBuffer(buffer, 0, data);
		return { buffer: buffer, vertices: data.length / BOULDER_VERTEX_FLOATS };
	}));
}

function layBoulders() {
	const params = getBoulderParams();
	boulders = placeBoulders(terrain.land, params);

	if (instanceBuffer) {
		instanceBuffer.destroy();
	}
	instanceData = new Float32Array(Math.max(boulders.length, BOULDER_FLOATS));
	instanceBuffer = device.createBuffer({
		label: "boulder instances",
		size: instanceData.byteLength,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});

	laidParams = JSON.stringify(params);
	laidLand = terrain.land;
	boulderStats.boulders = boulders.length / BOULDER_FLOATS;
	console.log("Boulders laid out: ", boulderStats.boulders);
}

// shaders
//-------------------------------------------------
const boulderShaderModule = device.createShaderModule({
  label: "vf_boulders",
  code: vf_boulders
});

// uniform buffers
//-------------------------------------------------
const boulderUniformBuffer = device.createBuffer({
  label: "boulder Uniform",
  size: 256,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

//linear sampling
const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

function boulderUniformBufferUpdates() {
	const bufferResult = [];

	const viewProjectionMatrix = transformations.getViewProj();
	for(let i = 0; i < 16; i++) {
		bufferResult.push(viewProjectionMatrix[i]);
	}

	bufferResult.push(settings.waterWorldPosY);
	bufferResult.push(settings.terrainSnowLine);
	bufferResult.push(settings.waterHorizonFogDistance);
	bufferResult.push(settings.enableAtmosphere ? 1 : 0);

	bufferResult.push(transformations.pixelSize());	//how big a pixel is (see pixelSize in transformations.js)
	bufferResult.push(settings.terrainRockDetail);
	bufferResult.push(settings.boulderDrawDistance);
	bufferResult.push(settings.terrainRockVeins);

	bufferResult.push(weatherNow.snowCover, 0, 0, 0);	//how much snow has fallen and is lying (weather.js)

	const result = new Float32Array(bufferResult);
	device.queue.writeBuffer(boulderUniformBuffer, 0, result.buffer, result.byteOffset, result.byteLength);
}

// Layouts
//-------------------------------------------------
const bindGroupLayout = device.createBindGroupLayout({
  label: "boulder Bind Group Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: {}
  },
  {
    binding: 1,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,	//lights
    buffer: {}
  },
  {
    binding: 2,								//sky view LUT
    visibility: GPUShaderStage.FRAGMENT,
    texture: {}
  },
  {
    binding: 3,
    visibility: GPUShaderStage.FRAGMENT,
    sampler: {}
  }
  ]
});

function createBindGroupBoulders() {
	return device.createBindGroup({
			label: "boulder bind group",
			layout: bindGroupLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: boulderUniformBuffer }
			},
			{
				binding: 1,
				resource: { buffer: uniformBufferLights }
			},
			{
				binding: 2,
				resource: skyViewLUTtexture.createView()
			},
			{
				binding: 3,
				resource: linSampler
			}
			]
		});
}

// Pipeline
//-------------------------------------------------
const boulderPipeline = device.createRenderPipeline({
  label: "boulder pipeline",
  layout: device.createPipelineLayout({
	label: "boulder Pipeline Layout",
	bindGroupLayouts: [ bindGroupLayout ],
  }),
	vertex: {
		module: boulderShaderModule,
		entryPoint: "vertexMain",
		buffers: [
		{
			// the mesh: once per vertex
			arrayStride: BOULDER_VERTEX_FLOATS * 4,
			attributes: [
				{ format: "float32x3", offset: 0, shaderLocation: 0 },		// position
				{ format: "float32x3", offset: 12, shaderLocation: 1 },		// normal
			],
		},
		{
			// the boulder: once per instance (see placeBoulders for what is in it)
			arrayStride: BOULDER_FLOATS * 4,
			stepMode: 'instance',
			attributes: [
				{ format: "float32x4", offset: 0, shaderLocation: 2 },		// where it lies, how big
				{ format: "float32x4", offset: 16, shaderLocation: 3 },		// how it lies
				{ format: "float32x4", offset: 32, shaderLocation: 4 },		// its proportions
			],
		}]
	},
	fragment: {
		module: boulderShaderModule,
		entryPoint: "fragmentMain",
		targets: [{
		format: canvasFormat
		}]
	},
	primitive: {
		topology: 'triangle-list',
		cullMode: 'none',
	},
	depthStencil: {
		depthWriteEnabled: true,
		depthCompare: 'less',
		format: 'depth24plus',
	},
});

// Per frame
//-------------------------------------------------
// call once a frame before the passes. Lays the boulders out again if their settings or the land changed
export function boulderUpdate() {
	if (!settings.enableBoulders || !terrain.land) {
		return;
	}
	if (JSON.stringify(getBoulderParams()) != laidParams || terrain.land !== laidLand) {
		layBoulders();
	}
}

// inside the main pass, after the land
export function boulderPass(pass) {
	if (!settings.enableBoulders || !settings.enableTerrain || boulders.length == 0) {
		return;
	}

	// which boulders, with which mesh. One list for every (shape, mesh), reused every frame
	const planes = transformations.getFrustumPlanes();
	const lists = Array.from({ length: BOULDER_SHAPES * 2 }, () => []);
	for (let at = 0; at < boulders.length; at += BOULDER_FLOATS) {
		const x = boulders[at], y = boulders[at + 1], z = boulders[at + 2], size = boulders[at + 3];
		const away = Math.hypot(x - settings.camPosX, y - settings.camPosY, z - settings.camPosZ);
		if (away > settings.boulderDrawDistance || away > size * SEEN_SIZES) continue;
		if (planes.some((plane) => plane[0] * x + plane[1] * y + plane[2] * z + plane[3] < -size * 2)) continue;
		lists[boulders[at + 11] * 2 + (away < size * NEAR_SIZES ? 0 : 1)].push(at);
	}

	// their records end to end, list after list
	let count = 0;
	const starts = [];
	for (const list of lists) {
		starts.push(count);
		for (const at of list) {
			instanceData.set(boulders.subarray(at, at + BOULDER_FLOATS), count * BOULDER_FLOATS);
			count++;
		}
	}
	boulderStats.drawn = count;
	if (count == 0) {
		return;
	}
	device.queue.writeBuffer(instanceBuffer, 0, instanceData, 0, count * BOULDER_FLOATS);
	boulderUniformBufferUpdates();

	pass.setPipeline(boulderPipeline);
	pass.setBindGroup(0, createBindGroupBoulders());
	pass.setVertexBuffer(1, instanceBuffer);
	lists.forEach((list, i) => {
		if (list.length == 0) return;
		const mesh = meshes[Math.floor(i / 2)][i % 2];
		pass.setVertexBuffer(0, mesh.buffer);
		pass.draw(mesh.vertices, list.length, 0, starts[i]);		// draw(vertexCount, instanceCount, firstVertex, firstInstance)
	});
}
