import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { settings } from './settings.js';

import { generateTerrain, chunkIndices } from './terrainGenerator.js'
import { TERRAIN_ZONES, ZONE_OCEAN, ZONE_BEACH, ZONE_GRASSLAND, ZONE_FOREST, ZONE_MOUNTAIN, ZONE_SNOW, ZONE_LAKE, ZONE_MARSH } from './terrainGenerator.js'
import { FOREST_THRESHOLD, MOUNTAIN_THRESHOLD } from './terrainGenerator.js'

import { v_terrainDepth } from '../shaders/js/vf_terrain.js'
import { vf_terrain } from '../shaders/js/vf_terrain.js'

import * as transformations from './transformations.js'
import * as scene from './scene.js'
import * as shadowMapping from './shadowMapping.js'
import { weatherNow, seasonNow } from './weather.js'

//the land fades into the horizon color, read from the sky view LUT (same as the water)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

// so anything that spawns by zone only needs this file
export { TERRAIN_ZONES, ZONE_OCEAN, ZONE_BEACH, ZONE_GRASSLAND, ZONE_FOREST, ZONE_MOUNTAIN, ZONE_SNOW, ZONE_LAKE, ZONE_MARSH };

/*
	The procedural land. terrainGenerator.js works out the heights, zones and mesh on the CPU, this file owns the result:
		- land			everything known about the ground: heights, zone tags, look ups by world position, and findSpawnPoints (the tag system)
		- the chunks	the mesh, and the two places it is drawn: the top down height map (so the water sees the land), and the main pass
		  The land is NOT drawn into the shadow map: that only covers a small box around the origin, so a mountain's shadow would stop dead at
		  the edge of the box. It still receives the shadows of the models that are in it

	The mesh is chunks (see chooseChunks)
		The world is far too big to draw at one fineness: fine enough to stand on would be hundreds of millions of triangles.
		So it is a quadtree. The world is cut into a few big squares, each can be cut into 4 squares of half the size, each of
		those into 4 again, and so on down to the finest. Every square at every level is a chunk: a mesh with the same number
		of cells, so a small chunk is fine and a big one is coarse. Each frame the tree is walked from the top, and a square is
		cut into its 4 only while it is near the camera for its size. What comes out is rings of detail round the camera:
		the smallest, finest chunks under it, each ring further out twice as coarse as the last.

		Chunks are made when they are first wanted, a few a frame, and the coarser chunk covering the same ground is drawn
		until they are ready. They are kept while there is room and the ones not used for longest are thrown away.
		Nothing is lost by that: the land comes from the seed, so a chunk made again is the same chunk.

	To place things by zone from anywhere:
		import * as terrain from './terrain.js'
		const spots = terrain.land.findSpawnPoints(terrain.ZONE_FOREST, 200, { minSpacing: 12, maxSlope: 0.4 });	// [{ x, y, z, normal }, ...]
		const y = terrain.land.heightAt(x, z);		const zone = terrain.land.zoneAt(x, z);
*/

const CHUNK_CELLS = 64;				// cells along one side of a chunk. Every chunk has the same, whatever its size
const ROOT_CHUNKS = 4;				// the biggest chunks, the top of the tree: this many along each side of the world
const CHUNKS_KEPT = 640;			// how many chunks are kept before the ones not used for longest are thrown away (about 140KB each on the GPU)
const BUILD_MILLISECONDS = 5;		// the most time one frame spends making new chunks
const SEA_FLOOR_DEPTH = 8;			// a chunk that is all at least this far under the sea is never drawn any finer: nobody can see it

// every setting the shape of the land depends on. If one of these changes the land is generated again
function getTerrainParams() {
	return {
		seed: settings.terrainSeed,
		worldSize: settings.terrainWorldSize,
		landScale: settings.terrainLandScale,
		hillHeight: settings.terrainHillHeight,
		woodland: settings.terrainWoodland,
		lakes: settings.terrainLakes,
		seaFloorDepth: settings.terrainSeaFloorDepth,
		seaBedGrade: settings.terrainSeaBedGrade,
		shelfWidth: settings.terrainShelfWidth,
		mountainHeight: settings.terrainMountainHeight,
		beachHeight: settings.terrainBeachHeight,
		bankHeight: settings.terrainBankHeight,
		snowLine: settings.terrainSnowLine,
		seaLevel: settings.waterWorldPosY,
	};
}

export let land;				// the generated terrain, see generateTerrain in terrainGenerator.js for whats in it
export let terrainFieldsTexture;	// the land as a texture for shaders (the grass), one texel per grid point: height, what covers it (see coverOf in terrainGenerator.js), normal.x, normal.z
export let terrainWaterTexture;		// what the water needs to know about the land, one texel per grid point: height of the ground, distance to the nearest land, and 1.0 where the water is a lake
export const terrainStats = { chunks: 0, drawn: 0, triangles: 0, built: 0 };	// kept / in the tree this frame / drawn in the main pass / made this frame, for anyone who wants to show it
const chunks = new Map();		// every chunk there is, by name (see chunkName)
let rootChunks = [];			// the top of the tree
let chosenChunks = [];			// the chunks that make up the land this frame, see chooseChunks
let wantedChunks = [];			// and the ones it is waiting for
let chunkFrame = 0;				// counts frames, to know how long ago a chunk was last used

// one list of triangles for every chunk, they are all the same grid
const chunkIndexData = chunkIndices(CHUNK_CELLS);
const chunkIndexBuffer = device.createBuffer({
	label: "terrain chunk indices",
	size: chunkIndexData.byteLength,
	usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(chunkIndexBuffer, 0, chunkIndexData);
let generatedParams = "";		// the params the current land was made from
let pendingParams = "";			// and the ones waiting to be made, see terrainUpdate
let pendingSince = 0;

// The placeholder buildings, stood back up on the new land. A first use of the tag system: they go on flat grassland next to the starting shore
function placeBuildings() {
	const spots = land.findSpawnPoints(ZONE_GRASSLAND, 1, { near: [0, -70], radius: 240, maxSlope: 0.02, seed: 3 });
	if (spots.length == 0) {
		return;
	}
	const home = spots[0];

	const layout = [["Lighthouse", 0, 0], ["IslandHouse", -12, 9], ["Bench", 16, 12]];	//name, then x and z away from the home spot
	for (const [name, offsetX, offsetZ] of layout) {
		const index = scene.entityModels.findIndex((model) => model.name == name);
		if (index < 0) {
			continue;
		}
		const x = home.x + offsetX, z = home.z + offsetZ;
		scene.entityModels[index].worldTranslation[0] = x;
		scene.entityModels[index].worldTranslation[1] = land.heightAt(x, z);
		scene.entityModels[index].worldTranslation[2] = z;
	}
}

// Chunks
//-------------------------------------------------
const chunkName = (x0, z0, size) => size + ":" + x0 + ":" + z0;

// Makes the chunk covering a square of the land and puts its mesh on the GPU
function buildChunk(x0, z0, size) {
	const mesh = land.buildChunk(x0, z0, size, CHUNK_CELLS);
	const vertexBuffer = device.createBuffer({
		label: "terrain chunk vertices",
		size: mesh.vertices.byteLength,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);

	const chunk = { x0: x0, z0: z0, size: size, minY: mesh.minY, maxY: mesh.maxY, vertexBuffer: vertexBuffer, lastUsed: chunkFrame };
	chunks.set(chunkName(x0, z0, size), chunk);
	terrainStats.built++;
	return chunk;
}

// the size of the finest chunks: CHUNK_CELLS cells of the fineness the Mesh Detail setting asks for
function finestChunkSize() {
	return CHUNK_CELLS * settings.terrainWorldSize / settings.terrainResolution;
}

// how far the camera is from the nearest point of a chunk (0 inside it)
function distanceToChunk(chunk) {
	const dx = Math.max(chunk.x0 - settings.camPosX, 0, settings.camPosX - (chunk.x0 + chunk.size));
	const dy = Math.max(chunk.minY - settings.camPosY, 0, settings.camPosY - chunk.maxY);
	const dz = Math.max(chunk.z0 - settings.camPosZ, 0, settings.camPosZ - (chunk.z0 + chunk.size));
	return Math.hypot(dx, dy, dz);
}

/*
	Walks the tree from the top and settles which chunks are the land this frame.

	A chunk is cut into its 4 smaller ones when the camera is within terrainDetailDistance times its width of it. The same rule
	at every level is what makes the rings: a chunk half the size has to be half as far away before it is cut again.
	(and not at all if it is deep sea floor, or already as fine as the mesh goes)

	Steep ground is cut from further away, up to twice as far. A coarse mesh over a meadow looks the same as a fine one, but
	over a mountain it rounds off every crest, and a crest against the sky is the first thing the eye goes to.

	The 4 are only used once all of them are made. Until then the chunk itself is drawn, coarser but whole, and the missing
	ones are put on the wanted list with how far off they are, so the nearest get made first.
*/
function chooseChunks() {
	chunkFrame++;
	chosenChunks = [];
	wantedChunks = [];
	const finest = finestChunkSize();

	const visit = (chunk) => {
		chunk.lastUsed = chunkFrame;
		const distance = distanceToChunk(chunk);
		const steepness = Math.min((chunk.maxY - chunk.minY) / chunk.size, 1);	// how far it rises over its width: 0 flat, 1 as steep as 45 degrees or more
		if (chunk.size > finest && distance < chunk.size * settings.terrainDetailDistance * (1 + steepness) && chunk.maxY > settings.waterWorldPosY - SEA_FLOOR_DEPTH) {
			const half = chunk.size / 2;
			const smaller = [];
			for (let k = 0; k < 4; k++) {
				const x0 = chunk.x0 + (k % 2) * half, z0 = chunk.z0 + Math.floor(k / 2) * half;
				const made = chunks.get(chunkName(x0, z0, half));
				if (made) {
					made.lastUsed = chunkFrame;		// (keeps the ones that are made from being thrown away while the rest are waited for)
					smaller.push(made);
				} else {
					wantedChunks.push({ x0: x0, z0: z0, size: half, distance: distance });
				}
			}
			if (smaller.length == 4) {
				smaller.forEach(visit);
				return;
			}
		}
		chosenChunks.push(chunk);
	};
	rootChunks.forEach(visit);
	terrainStats.drawn = chosenChunks.length;
}

// Makes wanted chunks, nearest first, for as long as the time allows (always at least one, or nothing would ever get made)
function buildWantedChunks(milliseconds) {
	if (wantedChunks.length == 0) {
		return;
	}
	const started = performance.now();
	wantedChunks.sort((a, b) => a.distance - b.distance);
	for (const wanted of wantedChunks) {
		if (!chunks.has(chunkName(wanted.x0, wanted.z0, wanted.size))) {
			buildChunk(wanted.x0, wanted.z0, wanted.size);
		}
		if (performance.now() - started > milliseconds) {
			break;
		}
	}

	// too many kept: the ones that have gone longest without being part of the land go. Never the top of the tree, there has to be something to draw
	if (chunks.size > CHUNKS_KEPT) {
		const unused = [...chunks.entries()].filter(([name, chunk]) => chunk.lastUsed < chunkFrame - 30 && !rootChunks.includes(chunk));
		unused.sort((a, b) => a[1].lastUsed - b[1].lastUsed);
		for (const [name, chunk] of unused.slice(0, chunks.size - CHUNKS_KEPT)) {
			chunk.vertexBuffer.destroy();
			chunks.delete(name);
		}
	}
}

// Throws every chunk away and starts again from the top of the tree: the land under them has changed
function resetChunks() {
	for (const chunk of chunks.values()) {
		chunk.vertexBuffer.destroy();
	}
	chunks.clear();

	const size = settings.terrainWorldSize / ROOT_CHUNKS, half = settings.terrainWorldSize * 0.5;
	rootChunks = [];
	for (let k = 0; k < ROOT_CHUNKS * ROOT_CHUNKS; k++) {
		rootChunks.push(buildChunk(-half + (k % ROOT_CHUNKS) * size, -half + Math.floor(k / ROOT_CHUNKS) * size, size));
	}

	// and everything the camera needs where it is now, before anything is drawn, so the land doesnt sharpen into focus on screen.
	//		(each pass makes the next ring of finer chunks, so it takes as many passes as there are levels)
	const started = performance.now();
	do {
		chooseChunks();
		buildWantedChunks(Infinity);
	} while (wantedChunks.length > 0 && performance.now() - started < 1500);
}

function regenerateTerrain() {
	const params = getTerrainParams();
	land = generateTerrain(params);

	// the same land as a texture, for shaders that need to know about the ground under a point. The y of the normal isnt stored,
	//		a normal has length 1 and always points up here, so it can be worked back out from the other two
	if (!terrainFieldsTexture || terrainFieldsTexture.width != land.points) {
		if (terrainFieldsTexture) {
			terrainFieldsTexture.destroy();
		}
		terrainFieldsTexture = device.createTexture({
			label: "terrain fields texture",
			size: [land.points, land.points],
			format: 'rgba32float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
	}
	const fields = new Float32Array(land.points * land.points * 4);
	for (let i = 0; i < land.points * land.points; i++) {
		fields[i * 4 + 0] = land.heights[i];
		fields[i * 4 + 1] = land.covers[i];
		fields[i * 4 + 2] = land.normals[i * 3 + 0];
		fields[i * 4 + 3] = land.normals[i * 3 + 2];
	}
	device.queue.writeTexture({ texture: terrainFieldsTexture }, fields, { bytesPerRow: land.points * 16, rowsPerImage: land.points }, [land.points, land.points]);

	// and one for the water: the top down height map only shows it the land around the camera, this covers the whole world.
	//		Without it the waves have no idea a far off coast is there and roll straight over the land
	if (!terrainWaterTexture || terrainWaterTexture.width != land.points) {
		if (terrainWaterTexture) {
			terrainWaterTexture.destroy();
		}
		terrainWaterTexture = device.createTexture({
			label: "terrain water texture",
			size: [land.points, land.points],
			format: 'rgba32float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
	}
	const waterFields = new Float32Array(land.points * land.points * 4);
	for (let i = 0; i < land.points * land.points; i++) {
		waterFields[i * 4 + 0] = land.heights[i];
		waterFields[i * 4 + 1] = land.shoreDistances[i];
		waterFields[i * 4 + 2] = land.lakes[i];
	}
	device.queue.writeTexture({ texture: terrainWaterTexture }, waterFields, { bytesPerRow: land.points * 16, rowsPerImage: land.points }, [land.points, land.points]);

	placeBuildings();
	resetChunks();

	generatedParams = JSON.stringify(params);
	console.log("Terrain generated: ", chunks.size, " chunks to start with");
}
regenerateTerrain();

// shaders
//-------------------------------------------------
const terrainDepthShaderModule = device.createShaderModule({
  label: "v_terrainDepth",
  code: v_terrainDepth
});

const terrainShaderModule = device.createShaderModule({
  label: "vf_terrain",
  code: vf_terrain
});

// uniform buffers
//-------------------------------------------------
const terrainUniformBuffer = device.createBuffer({
  label: "terrain Uniform",
  size: 320,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

//the view projection matrix of the top down camera, for the depth only pass
const terrainHeightMapUniformBuffer = device.createBuffer({
  label: "terrain height map pass Uniform",
  size: 64,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

//linear sampling
const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

function terrainUniformBufferUpdates() {
	const bufferResult = [];

	const viewProjectionMatrix = transformations.getViewProj();
	const lightViewProjMat = transformations.getLightViewProjectionMat();
	const topDownViewProjMat = transformations.getTopDownViewProjectionMat();

	for(let i = 0; i < 16; i++) {
		bufferResult.push(viewProjectionMatrix[i]);
	}
	for(let i = 0; i < 16; i++) {
		bufferResult.push(lightViewProjMat[i]);
	}

	bufferResult.push(settings.waterWorldPosY);
	bufferResult.push(settings.terrainBeachHeight);
	bufferResult.push(settings.terrainSnowLine);
	bufferResult.push(settings.waterHorizonFogDistance);

	bufferResult.push(FOREST_THRESHOLD);
	bufferResult.push(MOUNTAIN_THRESHOLD);
	bufferResult.push(settings.enableAtmosphere ? 1 : 0);
	bufferResult.push(settings.terrainBankHeight);

	//for the rock: where the land data texture lies, and how big a pixel is (the view is 72 degrees from top to bottom, see projectionMatrix in transformations.js)
	bufferResult.push(settings.terrainWorldSize * 0.5);
	bufferResult.push(land.cellSize);
	bufferResult.push(2 * Math.tan(Math.PI / 5) / canvas.height);
	bufferResult.push(settings.terrainRockDetail);

	//for what the ground is made of close up (f_groundTextures.js), and the two numbers of the projection matrix a depth is made from,
	//		to move the depth of a pixel by its relief
	bufferResult.push(settings.terrainRockVeins);
	bufferResult.push(settings.terrainGroundDetail);
	bufferResult.push(settings.terrainDepthBias);
	bufferResult.push(transformations.projectionMatrix[10]);
	bufferResult.push(transformations.projectionMatrix[14]);
	//how far the blades of grass are drawn (0 if there are none): the turf under them is in their shade
	bufferResult.push(settings.enableGrass ? settings.grassDrawDistance : 0);
	//how much snow is lying and how far the grass has gone to hay (weather.js), and the top down camera, to tell what the snow could not get to
	bufferResult.push(weatherNow.snowCover);
	bufferResult.push(seasonNow.hay);
	for(let i = 0; i < 16; i++) {
		bufferResult.push(topDownViewProjMat[i]);
	}

	const result = new Float32Array(bufferResult);
	device.queue.writeBuffer(terrainUniformBuffer, 0, result.buffer, result.byteOffset, result.byteLength);

	device.queue.writeBuffer(terrainHeightMapUniformBuffer, 0, topDownViewProjMat.buffer, topDownViewProjMat.byteOffset, topDownViewProjMat.byteLength);
}

// Layouts
//-------------------------------------------------
const bindGroupDepthLayout = device.createBindGroupLayout({
  label: "terrain depth Bind Group Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.VERTEX,
    buffer: {}
  }
  ]
});

const bindGroupVFLayout = device.createBindGroupLayout({
  label: "terrain Bind Group VF Layout",
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
    binding: 2,								//shadow map
    visibility: GPUShaderStage.FRAGMENT,
    texture: {
		sampleType: 'depth',
	},
  },
  {
    binding: 3,
    visibility: GPUShaderStage.FRAGMENT,
    sampler: {
		type: 'comparison',
	},
  },
  {
    binding: 4,								//sky view LUT
    visibility: GPUShaderStage.FRAGMENT,
    texture: {}
  },
  {
    binding: 5,
    visibility: GPUShaderStage.FRAGMENT,
    sampler: {}
  },
  {
    binding: 6,								//the land data (terrainFieldsTexture), read texel by texel
    visibility: GPUShaderStage.FRAGMENT,
    texture: {
		sampleType: 'unfilterable-float',
	}
  },
  {
    binding: 7,								//the top down height map: what the sky can see of the ground (for the snow)
    visibility: GPUShaderStage.FRAGMENT,
    texture: {
		sampleType: 'depth',
	}
  }
  ]
});

const terrainHeightMapBindGroup = device.createBindGroup({
	label: "terrain height map pass bind group",
	layout: bindGroupDepthLayout,
	entries: [
	{
		binding: 0,
		resource: { buffer: terrainHeightMapUniformBuffer }
	}
	]
});

function createVFBindGroupTerrain() {
	return device.createBindGroup({
			label: "terrain VF bind group",
			layout: bindGroupVFLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: terrainUniformBuffer }
			},
			{
				binding: 1,
				resource: { buffer: uniformBufferLights }
			},
			{
				binding: 2,
				resource: shadowMapping.shadowMapView
			},
			{
				binding: 3,
				resource: shadowMapping.shadowMapSampler
			},
			{
				binding: 4,
				resource: skyViewLUTtexture.createView()
			},
			{
				binding: 5,
				resource: linSampler
			},
			{
				binding: 6,
				resource: terrainFieldsTexture.createView()
			},
			{
				binding: 7,
				resource: scene.heightMapView
			}
			]
		});
}

// Pipelines
//-------------------------------------------------
// depth only, for the top down height map
const terrainDepthPipeline = device.createRenderPipeline({
  label: "terrain depth pipeline",
  layout: device.createPipelineLayout({
	label: "terrain depth Pipeline Layout",
	bindGroupLayouts: [ bindGroupDepthLayout ],
  }),
	vertex: {
		module: terrainDepthShaderModule,
		entryPoint: "vertexMain",
		buffers: [scene.vertexBufferLayout]
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

const terrainPipeline = device.createRenderPipeline({
  label: "terrain VF pipeline",
  layout: device.createPipelineLayout({
	label: "terrain VF Pipeline Layout",
	bindGroupLayouts: [ bindGroupVFLayout ],
  }),
	vertex: {
		module: terrainShaderModule,
		entryPoint: "vertexMain",
		buffers: [scene.vertexBufferLayout]		// same 8 floats as every other model: position, 2 spare (uv), normal
	},
	fragment: {
		module: terrainShaderModule,
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
// call once a frame before the passes. Regenerates the land if its settings changed, and fills in the uniforms
export function terrainUpdate() {
	// generating takes a moment, so wait until a slider has stopped moving for a quarter of a second before doing it
	const params = JSON.stringify(getTerrainParams());
	if (params != generatedParams) {
		if (params != pendingParams) {
			pendingParams = params;
			pendingSince = performance.now();
		} else if (performance.now() - pendingSince > 250) {
			regenerateTerrain();
		}
	}

	// the mesh: which chunks are the land from where the camera is now, and a few more of the ones that are still to be made
	terrainStats.built = 0;
	chooseChunks();
	buildWantedChunks(BUILD_MILLISECONDS);
	terrainStats.chunks = chunks.size;

	terrainUniformBufferUpdates();
}

function drawChunk(pass, chunk) {
	pass.setVertexBuffer(0, chunk.vertexBuffer);
	pass.drawIndexed(chunkIndexData.length, 1, 0, 0, 0);
}

// inside the top down height map pass
export function terrainHeightMapPass(pass) {
	if (!settings.enableTerrain) return;
	pass.setPipeline(terrainDepthPipeline);
	pass.setBindGroup(0, terrainHeightMapBindGroup);
	pass.setIndexBuffer(chunkIndexBuffer, 'uint16');

	// only the chunks under the top down camera: it sees a square around the main camera (see getTopDownViewProjectionMat)
	const reach = 300 + (2 * 300 / settings.heightMapResolution) * 64;	// its box, and the most it is ever off centre (it moves in steps)
	for (const chunk of chosenChunks) {
		if (chunk.x0 > settings.camPosX + reach || chunk.x0 + chunk.size < settings.camPosX - reach) continue;
		if (chunk.z0 > settings.camPosZ + reach || chunk.z0 + chunk.size < settings.camPosZ - reach) continue;
		drawChunk(pass, chunk);
	}
}

// inside the main pass
export function terrainPass(pass) {
	if (!settings.enableTerrain) return;
	pass.setPipeline(terrainPipeline);
	pass.setBindGroup(0, createVFBindGroupTerrain());
	pass.setIndexBuffer(chunkIndexBuffer, 'uint16');

	// only the chunks the camera can see any of: a chunk is out of view if its whole box is on the outer side of one of the 6 planes
	//		(tested with the corner of the box that is furthest along the way the plane faces: if even that is outside, all of it is)
	const planes = transformations.getFrustumPlanes();
	terrainStats.triangles = 0;
	for (const chunk of chosenChunks) {
		const outside = planes.some((plane) =>
			plane[0] * (plane[0] > 0 ? chunk.x0 + chunk.size : chunk.x0) +
			plane[1] * (plane[1] > 0 ? chunk.maxY : chunk.minY) +
			plane[2] * (plane[2] > 0 ? chunk.z0 + chunk.size : chunk.z0) + plane[3] < 0);
		if (outside) continue;
		drawChunk(pass, chunk);
		terrainStats.triangles += chunkIndexData.length / 3;
	}
}
