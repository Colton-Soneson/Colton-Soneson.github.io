import { DEPTH_FORMAT, depthTest, DEPTH_CLEAR } from './depthMode.js'
import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { settings } from './settings.js';

import { generateTerrain, chunkIndices, wrapLand } from './terrainGenerator.js'
import { layoutWorld, tileParams, tileAt, HOME, GRID } from './world.js'
import { TERRAIN_ZONES, ZONE_OCEAN, ZONE_BEACH, ZONE_GRASSLAND, ZONE_FOREST, ZONE_MOUNTAIN, ZONE_SNOW, ZONE_LAKE, ZONE_MARSH, ZONE_TOWN } from './terrainGenerator.js'
import { FOREST_THRESHOLD, MOUNTAIN_THRESHOLD } from './terrainGenerator.js'
import { addJob, cancelJobs, LIVES } from './jobs.js'

import { v_terrainDepth } from '../shaders/js/vf_terrain.js'
import { vf_terrain } from '../shaders/js/vf_terrain.js'
import { vf_terrainBakeMips } from '../shaders/js/vf_terrain.js'

import { filteredSampler, mipLevelsFor } from './textureFiltering.js'
import * as profiler from './profiler.js'
import { setLoadingStage, showStage } from './loading.js'

import * as transformations from './transformations.js'
import * as scene from './scene.js'
import * as shadowMapping from './shadowMapping.js'
import { weatherNow, seasonNow } from './weather.js'

//the land fades into the horizon color, read from the sky view LUT (same as the water)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

// so anything that spawns by zone only needs this file
export { TERRAIN_ZONES, ZONE_OCEAN, ZONE_BEACH, ZONE_GRASSLAND, ZONE_FOREST, ZONE_MOUNTAIN, ZONE_SNOW, ZONE_LAKE, ZONE_MARSH, ZONE_TOWN };

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

	THE WORLD OF TILES (settings.worldTiles: world.js): the lands and seas of a whole world, a tile of it each the size of the one land. The home
	tile (today's island) is made with the world, as the one land is; the others are made off the main thread (tileWorker.js) as the camera
	comes within tileLoad of them (settings.worldViewDistance), the nearest first, one at a time, and let go again TILE_DROP past that (tilesKept at the most). land is then
	the world's (makeWorldLand): the same land all along, whatever tiles come and go, its look ups each asking the tile the place is in (in
	none: the endless sea), its grids the home tile's. The chunks' tree has the top of each tile's in it (made as the tile comes, by the
	worker), and the textures the shaders read the land from are a window on to the tiles round the camera (THE WINDOW). onTiles(fn) is
	told whenever a tile comes or goes.
	THE TOWNS OF THE WORLD (townSlots): land.towns has a place for every town the world's layout has room for (world.js: each land tile's
	towns, the home tile's first, as the one land has them), the same place all along, so a town's number (its place: the economy's,
	treasury.js's) is the same whatever tiles are here. A tile's towns fill their places as it comes (each the town its land made: the
	place takes on all of it) and are emptied again as it goes: an empty one has no buildings, and says its tile and about where it is
	(approx); one its land found no room for is none. onWindow(fn) is told whenever the window moves (town.js: the grass's mask).
	THE LAND FAR OFF (farTiles): past where a tile is streamed in (tileLoad), out to FAR_LAND, every land tile is drawn all the same, as its
	ground alone: made coarse (FAR_CELLS a side, no towns, no paths, no forest), one chunk at the top of its tree (FAR_ROOT), in the window's
	textures as it is. Nothing else knows of it (it is not one of tiles: the look ups take the sea there). As it comes within tileLoad the
	whole tile is made as ever, and once its own top of the tree is in, the far one is let go: so there is never a hole where it was.
	THE WINDOW: the land textures are the same size as ever, but in a world of tiles they hold the tiles' grid points round the camera
	(landWindow: its middle, moved on once the camera is WINDOW_MOVE from it), each grid point at its place in the world's grid of them
	modulo the texture's size (so a shader reads it from where a point is in the world, with no middle to know: vfc_grass.js,
	vfc_particles.js). The terrain and the water also know where the window is, and past its edge take the open sea (vf_terrain.js,
	vfc_water.js). With the one land of old the window is the land and its middle the origin, as it always was.

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
const RELIEF_DEPTH_DISTANCE = 250;	// chunks nearer than this put the relief of the ground into the depth (see terrainPass). By here the pebbles, grains and ripples have faded out anyway
const BAKE_DISTANCE = 400;			// chunks at least this far off are drawn from their bake, when there is one (see THE BAKE). By here the litter under the trees has faded out too
const MAX_BAKES = 200;				// the most chunks that keep a bake: about 35MB on the GPU at 128, 140MB at 256. The ones drawn longest ago go first
const BAKE_TEXELS_PER_FRAME = 128 * 128 * 8;	// how much baking one frame does: 8 chunks at 128, 2 at 256

// every setting the shape of the land depends on. If one of these changes the land is generated again
export const terrainParams = () => getTerrainParams();
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
		townCount: settings.terrainTownCount,
		townSize: settings.terrainTownSize,
		landingStrip: settings.terrainLandingStrip,
		footpaths: settings.terrainFootpaths,
		worldTiles: settings.worldTiles,
	};
}

export let land;				// the generated terrain, see generateTerrain in terrainGenerator.js for whats in it
export let terrainFieldsTexture;	// the land as a texture for shaders (the grass), one texel per grid point: height, what covers it (see coverOf in terrainGenerator.js), normal.x, normal.z
export let terrainWaterTexture;		// what the water needs to know about the land, one texel per grid point: height of the ground, distance to the nearest land, and 1.0 where the water is a lake
export const terrainStats = { chunks: 0, drawn: 0, triangles: 0, built: 0, nearChunks: 0, bakedChunks: 0, bakes: 0, bakedThisFrame: 0, waiting: 0 };	// kept / in the tree this frame / drawn in the main pass / made this frame / drawn with the relief in the depth / drawn from a bake / bakes kept / bakes made this frame / still to be made, for anyone who wants to show it
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
// THE WORLD OF TILES (see the top)
// world units from a tile's edge it is streamed in within (settings.worldViewDistance, the controls' first), let go past (TILE_DROP more), and
//		how many are kept at the most (more the further it reaches)
const tileLoad = () => Math.max(settings.worldViewDistance ?? 2500, 500) * settings.forestUnitsPerMetre;
const TILE_DROP = 4000;
const FAR_LAND = 22000, FAR_CELLS = 256;		// THE LAND FAR OFF: world units from a tile's edge it is drawn within; its data grid's cells a side
const farTiles = new Map();					// key -> { key, chunkKey ('far:' and its key), land, params, rooted }
export const farTilesLoaded = () => [...farTiles.keys()];
const tilesKept = () => Math.max(6, Math.ceil((2 * tileLoad() / settings.terrainWorldSize + 1) ** 2) + 2);
const WINDOW_MOVE = 2048;					// world units
const VOID_DEPTH = 600;						// world units under the sea: the bed of the endless sea, where there is no tile
export let world = null;					// the world's layout (world.js); null with the one land of old
const tiles = new Map();					// key -> { key, kind, land, params, usedAt }
export const tilesLoaded = () => [...tiles.values()];
export const tileLand = (x, z) => world ? tiles.get(tileAt(x, z, settings.terrainWorldSize))?.land ?? null : land;
const tileListeners = [];		// { fn, later }
// told of the tiles that come and go: fn(added, removed), their keys. later: told of the new ones a little after, from the jobs (jobs.js),
//		one listener a step, so that a tile coming in is not all of its work in one frame (a tile that goes is told of at once, and what
//		was still to be done for it dropped). A listener that asks for later is told of each new tile once, but has to take being told of
//		one it already has (it was made again, all of it, in between). It may hand back a generator, gone on with a step at a time: each
//		step has to see that nothing was made again in between
export function onTiles(fn, { later = false } = {}) { tileListeners.push({ fn, later }); }
// what more is made with a tile, off the main thread (tileWorker.js): forest.js's trees ({ forest: () => its planting })
export const tileExtras = {};
export const landWindow = { x: 0, z: 0 };
// the edge of the world (world units, [low, high] either way, margin in from it): the one land's square, or the whole world's grid of tiles
export function worldEdges(margin = 0) {
	const S = settings.terrainWorldSize;
	if (!world) return [-S * 0.5 + margin, S * 0.5 - margin];
	return [(-GRID / 2 - 0.5) * S + margin, (GRID / 2 - 0.5) * S - margin];
}
// whether a place is on the land there is here: inside the one land (margin in from its edge), or in a tile of the world that is here
export function inWorld(x, z, margin = 0) {
	if (!world) { const half = settings.terrainWorldSize * 0.5 - margin; return Math.abs(x) < half && Math.abs(z) < half; }
	return !!tileLand(x, z);
}
// the lands here: { key, land } for each tile of the world that is here (the home tile's is land itself, the world's), or the one land
export function landsHere() {
	if (!world) return land ? [{ key: 'land', land }] : [];
	return [...tiles.values()].map((t) => ({ key: t.key, land: t.key == HOME ? land : t.land }));
}
const windowListeners = [];
export function onWindow(fn) { windowListeners.push(fn); }
export let townSlots = [];
let tileWorker = null, tileAsked = null;
let generatedParams = "";		// the params the current land was made from
let pendingParams = "";			// and the ones waiting to be made, see terrainUpdate
let pendingSince = 0;

/*
	The buildings (the lighthouse, the house and the bench), stood back up on every new land: one group of them, as they stand
	to each other in BUILDING_LAYOUT, on the grass at the top of a beach. The spot is the nearest one to where the camera
	starts that has:
		- each of the three on grassland, level, and all three at about the same height
		- beach a little way off (BEACH_NEAREST to BEACH_FURTHEST from the middle of the group), and no sea that close
		- no lake, marsh or forest under the group
	Then the ground round them is kept clear (land.clearings): no trees grow there and no boulders lie there (forestGenerator.js,
	boulderGenerator.js). And the shadow map's box is moved to them, as they are all there is in it (getLightViewProjectionMat)
*/
const BUILDING_LAYOUT = [["Lighthouse", 0, 0], ["IslandHouse", -12, 9], ["Bench", 16, 12]];	//name, then x and z away from the home spot
const BUILDING_MIDDLE = [2, 6];				// the middle of the group, from the home spot
const BUILDING_CLEARING = 32;				// the radius kept clear round that middle
const BEACH_NEAREST = 25, BEACH_FURTHEST = 70;
const BUILDINGS_FROM = [0, 150];			// where the search starts from: the camera's starting place (settings.js)

function findCoastSpot() {
	const zone = (x, z) => land.zoneAt(x, z);
	const level = (x, z) => land.normalAt(x, z)[1] > 0.985;
	const step = Math.max(land.cellSize * 2, 6);
	const half = settings.terrainWorldSize * 0.5 - 200;

	// every flat piece of grass, nearest first
	const candidates = [];
	for (let z = -half; z < half; z += step) {
		for (let x = -half; x < half; x += step) {
			if (zone(x, z) == ZONE_GRASSLAND && level(x, z)) {
				candidates.push([(x - BUILDINGS_FROM[0]) ** 2 + (z - BUILDINGS_FROM[1]) ** 2, x, z]);
			}
		}
	}
	candidates.sort((a, b) => a[0] - b[0]);

	const angles = 24;
	for (const [, x, z] of candidates) {
		const homeHeight = land.heightAt(x, z);
		const fits = BUILDING_LAYOUT.every(([, dx, dz]) => zone(x + dx, z + dz) == ZONE_GRASSLAND && level(x + dx, z + dz) && Math.abs(land.heightAt(x + dx, z + dz) - homeHeight) < 1.2);
		if (!fits) continue;

		const mx = x + BUILDING_MIDDLE[0], mz = z + BUILDING_MIDDLE[1];
		let beach = false, blocked = false;
		for (let a = 0; a < angles && !blocked; a++) {
			const ax = Math.cos(a / angles * 2 * Math.PI), az = Math.sin(a / angles * 2 * Math.PI);
			for (let r = 4; r <= BEACH_FURTHEST && !blocked; r += 4) {
				const here = zone(mx + ax * r, mz + az * r);
				if (r < BUILDING_CLEARING && (here == ZONE_LAKE || here == ZONE_MARSH || here == ZONE_FOREST || here == ZONE_MOUNTAIN)) blocked = true;
				if (r < BEACH_NEAREST && (here == ZONE_BEACH || here == ZONE_OCEAN)) blocked = true;
				if (here == ZONE_BEACH && r >= BEACH_NEAREST) beach = true;
			}
		}
		if (beach && !blocked) {
			return { x: x, z: z };
		}
	}
	return null;
}

function placeBuildings() {
	let home = findCoastSpot();
	if (!home) {
		// no beach on this land with grass behind it: any flat grass near the start will do
		const spots = land.findSpawnPoints(ZONE_GRASSLAND, 1, { near: BUILDINGS_FROM, radius: 2000, maxSlope: 0.02, seed: 3 });
		if (spots.length == 0) {
			land.clearings = [];
			return;
		}
		home = spots[0];
	}
	const mx = home.x + BUILDING_MIDDLE[0], mz = home.z + BUILDING_MIDDLE[1];
	land.clearings = [{ x: mx, z: mz, radius: BUILDING_CLEARING }];
	settings.shadowMapCenter = [mx, land.heightAt(mx, mz), mz];

	for (const [name, offsetX, offsetZ] of BUILDING_LAYOUT) {
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

/*
	THE WORKER. The chunks wanted while the camera moves are made in terrainWorker.js, on a thread of its own, and put on the GPU
	here when they come back: a chunk is a few milliseconds of noise, and flying fast wants a lot of them, all of which came out
	of the frames when they were made here. At most WORKER_IN_FLIGHT are asked for at a time, nearest first, so what it is
	making is never far behind where the camera is now. Every new land is sent to it first (its chunkGrids, see makeChunkBuilder).
	The chunks made with the land (resetChunks) are still made here: nothing can be drawn until they are.
	Where a worker cant run, chunks are made here as before, BUILD_MILLISECONDS a frame.
*/
const WORKER_IN_FLIGHT = 3;
let landGeneration = 0;				// which land the chunks asked of the worker are of. One that comes back of an older land is thrown away
const inFlight = new Set();			// names of the chunks asked of the worker and not back yet
let builtSince = 0;					// chunks made since the last frame (terrainStats.built)
let chunkWorker = null;
try {
	chunkWorker = new Worker(new URL('./terrainWorker.js', import.meta.url), { type: 'module' });
	chunkWorker.onmessage = (event) => {
		const made = event.data;
		const name = chunkName(made.x0, made.z0, made.size);
		inFlight.delete(name);
		if (made.generation == landGeneration && made.vertices && (!chunks.has(name) || chunks.get(name).tile !== made.tile) && (!world || landOfChunkTile(made.tile))) {
			addChunk(made.x0, made.z0, made.size, made, made.tile);
		}
	};
	chunkWorker.onerror = (event) => {
		console.warn('The terrain worker stopped, chunks are made on the main thread from now on:', event.message);
		chunkWorker = null;
		inFlight.clear();
	};
} catch (error) {
	console.warn('No terrain worker, chunks are made on the main thread:', error);
	chunkWorker = null;
}

// the tile a chunk is of (its key; 'land' for the one land of old)
const chunkTile = (x0, z0, size) => {
	if (!world) return 'land';
	const key = tileAt(x0 + size / 2, z0 + size / 2, settings.terrainWorldSize);
	return tiles.has(key) || !farTiles.has(key) ? key : 'far:' + key;
};
const landOfChunkTile = (tile) => tile.startsWith('far:') ? farTiles.get(tile.slice(4))?.land : tiles.get(tile)?.land;
// Makes the chunk covering a square of the land here, and puts its mesh on the GPU
function buildChunk(x0, z0, size) {
	const tile = chunkTile(x0, z0, size), of = world ? landOfChunkTile(tile) : land;
	return of ? addChunk(x0, z0, size, of.buildChunk(x0, z0, size, CHUNK_CELLS), tile) : null;
}

// Puts a chunk's mesh (see buildChunk in terrainGenerator.js) on the GPU
function addChunk(x0, z0, size, mesh, tile = 'land') {
	const vertexBuffer = device.createBuffer({
		label: "terrain chunk vertices",
		size: mesh.vertices.byteLength,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(vertexBuffer, 0, mesh.vertices);

	const chunk = { x0: x0, z0: z0, size: size, minY: mesh.minY, maxY: mesh.maxY, vertexBuffer: vertexBuffer, lastUsed: chunkFrame, tile };
	// (one of the same place of another tile's, a far one's: gone for this)
	const was = chunks.get(chunkName(x0, z0, size));
	if (was) { was.vertexBuffer.destroy(); destroyBake(was); rootChunks = rootChunks.filter((c) => c !== was); }
	chunks.set(chunkName(x0, z0, size), chunk);
	// (a tile's top of the tree, come from the worker: in the tree; a far one's is the whole tile)
	const top = tile.startsWith('far:') ? settings.terrainWorldSize : settings.terrainWorldSize / ROOT_CHUNKS;
	if (world && size == top && !rootChunks.includes(chunk)) rootChunks.push(chunk);
	builtSince++;
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

// Makes wanted chunks, nearest first: asks the worker for them, or makes them here for as long as the time allows (always at
//		least one, or nothing would ever get made)
function buildWantedChunks(milliseconds) {
	if (wantedChunks.length == 0) {
		return;
	}
	const started = performance.now();
	wantedChunks.sort((a, b) => a.distance - b.distance);
	if (chunkWorker && milliseconds != Infinity) {
		for (const wanted of wantedChunks) {
			if (inFlight.size >= WORKER_IN_FLIGHT) {
				break;
			}
			const name = chunkName(wanted.x0, wanted.z0, wanted.size);
			if (!chunks.has(name) && !inFlight.has(name)) {
				inFlight.add(name);
				chunkWorker.postMessage({ generation: landGeneration, tile: chunkTile(wanted.x0, wanted.z0, wanted.size), x0: wanted.x0, z0: wanted.z0, size: wanted.size, cells: CHUNK_CELLS });
			}
		}
		milliseconds = -1;		// (and none made here)
	}
	for (const wanted of milliseconds < 0 ? [] : wantedChunks) {
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
			destroyBake(chunk);
			chunks.delete(name);
		}
	}
}

// Throws every chunk away and starts again from the top of the tree: the land under them has changed
function resetChunks() {
	for (const chunk of chunks.values()) {
		chunk.vertexBuffer.destroy();
		destroyBake(chunk);
	}
	chunks.clear();

	const size = settings.terrainWorldSize / ROOT_CHUNKS, half = settings.terrainWorldSize * 0.5;
	rootChunks = [];
	// (each tile's, in a world of tiles: those there are now)
	for (const [cx, cz] of world ? [...tiles.values()].map((t) => t.land.center) : [[0, 0]]) {
		for (let k = 0; k < ROOT_CHUNKS * ROOT_CHUNKS; k++) {
			const chunk = buildChunk(cx - half + (k % ROOT_CHUNKS) * size, cz - half + Math.floor(k / ROOT_CHUNKS) * size, size);
			if (chunk && !rootChunks.includes(chunk)) rootChunks.push(chunk);
		}
	}

	// and everything the camera needs where it is now, before anything is drawn, so the land doesnt sharpen into focus on screen.
	//		(each pass makes the next ring of finer chunks, so it takes as many passes as there are levels)
	const started = performance.now();
	do {
		chooseChunks();
		buildWantedChunks(Infinity);
	} while (wantedChunks.length > 0 && performance.now() - started < 1500);
}

// THE WORLD OF TILES (see the top)
//-------------------------------------------------
// the world's land: the home tile's grids and what was made with it, and every look up asking the tile the place is in (none: the endless sea)
function makeWorldLand(home) {
	const deep = () => settings.waterWorldPosY - VOID_DEPTH;
	const at = (x, z) => tileLand(x, z);
	makeTownSlots(home);
	return {
		...home, worldTiles: true, towns: townSlots,
		heightAt: (x, z) => at(x, z)?.heightAt(x, z) ?? deep(),
		groundAt: (x, z) => at(x, z)?.groundAt(x, z) ?? deep(),
		zoneAt: (x, z) => at(x, z)?.zoneAt(x, z) ?? ZONE_OCEAN,
		normalAt: (x, z) => at(x, z)?.normalAt(x, z) ?? [0, 1, 0],
		townAt: (x, z) => at(x, z)?.townAt(x, z) ?? 0,
		onPath: (x, z) => at(x, z)?.onPath(x, z) ?? false,
		roadAt: (x, z) => at(x, z)?.roadAt(x, z) ?? null,
		// (near a place: in the tile it is in; or the home tile's)
		findSpawnPoints: (zone, count, options = {}) => (options.near ? at(options.near[0], options.near[1]) : null)?.findSpawnPoints(zone, count, options) ?? home.findSpawnPoints(zone, count, options),
		buildChunk: home.buildChunk,
	};
}
// THE TOWNS OF THE WORLD (see the top)
let townTemplate = {};
function makeTownSlots(home) {
	const S = settings.terrainWorldSize;
	// (what an empty one has: every list of a town's empty, everything else nothing)
	townTemplate = {};
	for (const [key, value] of Object.entries(home.towns[0] ?? {})) townTemplate[key] = Array.isArray(value) ? [] : typeof value == 'number' ? 0 : typeof value == 'boolean' ? false : null;
	townTemplate.buildings = [];
	townSlots = [...home.towns];
	home.towns.forEach((t, k) => Object.assign(t, { slot: k, tile: HOME, k, approx: [0, 0], loaded: true, none: false }));
	for (const key of world.landKeys) {
		if (key == HOME) continue;
		const T = world.tiles.get(key);
		for (let k = 0; k < T.towns; k++) townSlots.push({ ...structuredClone(townTemplate), slot: townSlots.length, tile: key, k, approx: [T.tx * S, T.tz * S], loaded: false, none: false });
	}
}
function fillTowns(key, made) {
	for (const t of townSlots) {
		if (t.tile !== key) continue;
		const real = made.towns[t.k];
		if (real) Object.assign(t, real, { slot: t.slot, tile: key, k: t.k, approx: t.approx, surveyed: t.surveyed, loaded: true, none: false });
		else t.none = true;
	}
}
function emptyTowns(key) {
	for (const t of townSlots) if (t.tile === key) { const keep = { slot: t.slot, tile: key, k: t.k, approx: t.approx, none: t.none, surveyed: t.surveyed }; for (const k of Object.keys(t)) delete t[k]; Object.assign(t, structuredClone(townTemplate), keep, { loaded: false }); }
}
// (whether any of those tiles has a town there is, or had: the towns' houses and people are made again only then)
// THE SURVEY (see THE TOWNS OF THE WORLD at the top): while no tile is wanted near, each land tile is made once off the main thread for
//		what towns it has (tileWorker.js: survey): each place told about where its town is (approx), what its buildings are and whether it
//		has a dock (surveyed), or that there is none (none). So the world tracker (townEconomy.js) knows the world's towns before they are here
export const surveys = new Map();		// key -> [{ x, z, types, dock }]
const surveyListeners = [];
export function onSurvey(fn) { surveyListeners.push(fn); }
function surveyed(key, list) {
	surveys.set(key, list);
	for (const t of townSlots) {
		if (t.tile !== key) continue;
		const s = list[t.k];
		if (!s) { t.none = true; continue; }
		if (!t.loaded) t.approx = [s.x, s.z];
		t.surveyed = s;
	}
	for (const fn of surveyListeners) fn(key, list);
}
export const tilesHaveTowns = (keys) => keys.some((key) => townSlots.some((t) => t.tile === key && !t.none));
// (and the work still waiting for a tile that has gone dropped: jobs.js, the jobs handed in with its key, 'tile ' and it)
function tellTiles(added, removed) {
	for (const key of removed) cancelJobs('tile ' + key);
	for (const { fn, later } of tileListeners) {
		if (!later) fn(added, removed);
		else if (removed.length) fn([], removed);
	}
	const laters = tileListeners.filter((one) => one.later);
	// (one that hands back a generator is gone on with a step at a time: see onTiles)
	if (added.length && laters.length) addJob('what comes with ' + added.join(' '), function* () {
		for (const { fn } of laters) {
			const more = fn(added, []);
			if (more && typeof more.next == 'function') yield* more;
			yield;
		}
	}, { key: 'tile ' + added[0], priority: LIVES });
}
// how far a tile's square is from the camera (world units, 0 inside it)
function tileDistance(t) {
	const S = settings.terrainWorldSize, h = S / 2;
	return Math.hypot(Math.max(Math.abs(settings.camPosX - t.tx * S) - h, 0), Math.max(Math.abs(settings.camPosZ - t.tz * S) - h, 0));
}
function startTileWorker() {
	if (tileWorker !== null) return tileWorker;
	try {
		tileWorker = new Worker(new URL('./tileWorker.js', import.meta.url), { type: 'module' });
		// (the two workers joined: a tile's grids go from the one to the other)
		if (chunkWorker) { const pipe = new MessageChannel(); tileWorker.postMessage({ port: pipe.port1 }, [pipe.port1]); chunkWorker.postMessage({ port: pipe.port2 }, [pipe.port2]); }
		tileWorker.onmessage = (event) => {
			const r0 = performance.now();
			const { tile, params, data, error, survey } = event.data;
			if (survey) { if (tileAsked == tile) tileAsked = null; surveyed(tile, survey); return; }
			// (THE LAND FAR OFF: its ground alone)
			if (String(tile).startsWith('far:')) {
				const key = tile.slice(4);
				if (tileAsked == key) tileAsked = null;
				if (error || !world || params.seed !== world.seed || farTiles.has(key) || tiles.has(key)) return;
				const f = { key, chunkKey: tile, land: wrapLand(params, data), params, rooted: false };
				farTiles.set(key, f);
				askFarRoot(f);
				tileInWindow(world.tiles.get(key));
				terrainStats.farMs = Math.round(performance.now() - r0);
				return;
			}
			terrainStats.tileReadMs = Math.round(performance.now() - r0);
			if (tileAsked == tile) tileAsked = null;
			if (error) { console.warn('A tile of the world could not be made:', tile, error); return; }
			if (!world || params.seed !== world.seed || tiles.has(tile) || JSON.stringify({ ...params, center: 0, tile: 0, townCount: 0, landingStrip: 0, footpaths: 0, world: 0, dataResolution: 0 }) != tileBase) return;
			const t0 = performance.now(), made = wrapLand(params, data), t1 = performance.now();
			addTile(tile, made, params);
			const t2 = performance.now();
			terrainStats.tileMs = Math.max(terrainStats.tileMs ?? 0, Math.round(t1 - t0));
			terrainStats.addMs = Math.max(terrainStats.addMs ?? 0, Math.round(t2 - t1));
		};
		tileWorker.onerror = (event) => { console.warn('The tile worker stopped:', event.message); tileWorker = false; tileAsked = null; };
	} catch (error) {
		console.warn('No tile worker: the world is the home tile alone', error);
		tileWorker = false;
	}
	return tileWorker;
}
let tileBase = '';
function addTile(key, tileLandMade, params) {
	const t = world.tiles.get(key);
	tiles.set(key, { key, kind: t.kind, land: tileLandMade, params, usedAt: performance.now() });
	fillTowns(key, tileLandMade);
	// (its chunk grids are with the chunk worker already, from the tile worker)
	askRoots(tiles.get(key));
	tileInWindow(t);
	tellTiles([key], []);
}
// a tile's top of the tree: from the worker, as wanted chunks are, those not made yet and not asked for (its grids may not have got to the
//		worker yet: it says so, and they are asked for again); or here
function askRoots(t) {
	const size = settings.terrainWorldSize / ROOT_CHUNKS, half = settings.terrainWorldSize * 0.5, [cx, cz] = t.land.center;
	let missing = 0;
	for (let k = 0; k < ROOT_CHUNKS * ROOT_CHUNKS; k++) {
		const x0 = cx - half + (k % ROOT_CHUNKS) * size, z0 = cz - half + Math.floor(k / ROOT_CHUNKS) * size, name = chunkName(x0, z0, size);
		if (chunks.get(name)?.tile === t.key) continue;
		missing++;
		if (inFlight.has(name)) continue;
		if (chunkWorker) { inFlight.add(name); chunkWorker.postMessage({ generation: landGeneration, tile: t.key, x0, z0, size, cells: CHUNK_CELLS }); }
		else buildChunk(x0, z0, size);
	}
	t.rooted = missing == 0;
}
// THE LAND FAR OFF (see the top): its one chunk at the top of its tree asked for, and the far one let go
function askFarRoot(f) {
	const S = settings.terrainWorldSize, [cx, cz] = f.land.center, x0 = cx - S / 2, z0 = cz - S / 2, name = chunkName(x0, z0, S);
	if (chunks.get(name)?.tile === f.chunkKey) { f.rooted = true; return; }
	if (inFlight.has(name)) return;
	if (chunkWorker) { inFlight.add(name); chunkWorker.postMessage({ generation: landGeneration, tile: f.chunkKey, x0, z0, size: S, cells: CHUNK_CELLS }); }
	else buildChunk(x0, z0, S);
}
function dropFar(key) {
	const f = farTiles.get(key);
	if (!f) return;
	farTiles.delete(key);
	for (const [name, chunk] of [...chunks]) {
		if (chunk.tile !== f.chunkKey) continue;
		chunk.vertexBuffer.destroy();
		destroyBake(chunk);
		chunks.delete(name);
	}
	rootChunks = rootChunks.filter((chunk) => chunk.tile !== f.chunkKey);
	if (chunkWorker) chunkWorker.postMessage({ drop: f.chunkKey });
	if (!tiles.has(key)) tileInWindow(world.tiles.get(key));
}
function dropTile(key) {
	tiles.delete(key);
	emptyTowns(key);
	for (const [name, chunk] of [...chunks]) {
		if (chunk.tile !== key) continue;
		chunk.vertexBuffer.destroy();
		destroyBake(chunk);
		chunks.delete(name);
	}
	rootChunks = rootChunks.filter((chunk) => chunk.tile !== key);
	if (chunkWorker) chunkWorker.postMessage({ drop: key });
	tileInWindow(world.tiles.get(key));
	tellTiles([], [key]);
}
// each frame: the nearest tile wanted and not here asked for, those far off let go, and the window moved on with the camera
function streamTiles() {
	const params = getTerrainParams();
	tileBase = JSON.stringify({ ...params, center: 0, tile: 0, townCount: 0, landingStrip: 0, footpaths: 0, world: 0, dataResolution: 0 });
	let nearest = null, nearestD = Infinity;
	for (const t of world.tiles.values()) {
		const d = tileDistance(t), here = tiles.get(t.key);
		if (here) { if (d < tileLoad()) here.usedAt = performance.now(); continue; }
		if (d < tileLoad() && d < nearestD) { nearest = t; nearestD = d; }
	}
	for (const t of tiles.values()) if (!t.rooted) askRoots(t);
	// (THE LAND FAR OFF: nothing wanted near, the nearest land tile within FAR_LAND not here either way; those whose own are in, or too far, gone)
	if (!nearest && tileAsked === null && startTileWorker()) {
		let far = null, farD = Infinity;
		for (const key of world.landKeys) {
			if (tiles.has(key) || farTiles.has(key)) continue;
			const d = tileDistance(world.tiles.get(key));
			if (d < FAR_LAND && d < farD) { far = key; farD = d; }
		}
		if (far) {
			tileAsked = far;
			tileWorker.postMessage({ tile: 'far:' + far, params: { ...tileParams(params, world, far), dataResolution: FAR_CELLS, townCount: 0, footpaths: false, landingStrip: false }, generation: landGeneration });
		}
	}
	for (const f of [...farTiles.values()]) {
		if (!f.rooted) askFarRoot(f);
		if ((tiles.get(f.key)?.rooted) || tileDistance(world.tiles.get(f.key)) > FAR_LAND + TILE_DROP) dropFar(f.key);
	}
	// (nothing wanted near nor far: the next land tile not yet surveyed, see THE SURVEY)
	if (!nearest && tileAsked === null && startTileWorker()) {
		const next = world.landKeys.find((key) => key != HOME && !surveys.has(key) && !tiles.has(key));
		if (next) { tileAsked = next; tileWorker.postMessage({ tile: next, params: tileParams(params, world, next), survey: true }); }
	}
	if (nearest && tileAsked === null && startTileWorker()) {
		tileAsked = nearest.key;
		tileWorker.postMessage({ tile: nearest.key, params: tileParams(params, world, nearest.key), generation: landGeneration, forest: tileExtras.forest?.() ?? null, unitsPerMetre: settings.forestUnitsPerMetre });
	}
	// (far off, or too many: the ones gone longest without being near go. Never the home tile: the world's grids are its)
	const loose = [...tiles.values()].filter((t) => t.key != HOME && tileDistance(world.tiles.get(t.key)) > tileLoad() + TILE_DROP);
	for (const t of loose) dropTile(t.key);
	const spare = [...tiles.values()].filter((t) => t.key != HOME && tileDistance(world.tiles.get(t.key)) >= tileLoad()).sort((a, b) => a.usedAt - b.usedAt);
	while (tiles.size > tilesKept() && spare.length) dropTile(spare.shift().key);
	// (the window moved on with the camera, its new texels filled a few rows at a time: see THE WINDOW)
	if (Math.max(Math.abs(settings.camPosX - landWindow.x), Math.abs(settings.camPosZ - landWindow.z)) > WINDOW_MOVE) moveWindow();
	const w0 = performance.now();
	fillJobs(WINDOW_ROWS);
	terrainStats.windowLast = performance.now() - w0;
	terrainStats.windowMs = Math.max(terrainStats.windowMs ?? 0, Math.round(terrainStats.windowLast));
}
const WINDOW_ROWS = 16;

/*
	THE WINDOW (see the top): the land textures filled from the tiles round the camera (or the one land). A grid point of the world's (gx, gz:
	at x = gx times a cell, less half a land) is at texel (gx, gz) modulo the textures' size, so as the window moves on only the grid points
	that come into it are filled in (the rest are where they were, and the same): a strip along each side it moved towards (moveWindow).
	And a tile that comes or goes, its part of the window (tileInWindow). Each is a job, a rectangle of grid points, filled WINDOW_ROWS
	rows a frame and each lot of rows put on the GPU as it is done (fillJobs). Until then the old ones are read there, at the far edge
	of the window. With the one land of old, the whole of it, at once (fillWindow).
*/
let windowAt = null;			// the window's first grid point [gx, gz], or null before there is one
let windowJobs = [];			// rectangles of grid points to fill: [gx0, gz0, gx1, gz1] (the ends not in it)
function fillWindow() {
	windowAt = [0, 0];
	landWindow.x = 0;
	landWindow.z = 0;
	windowJobs = [[0, 0, land.points, land.points]];
	if (world) moveWindow(true);
	fillJobs(Infinity);
}
function moveWindow(anew = false) {
	const N = land.points, cell = land.cellSize;
	const next = [Math.round(settings.camPosX / cell), Math.round(settings.camPosZ / cell)];
	const [ox, oz] = windowAt ?? [Infinity, Infinity];
	const [nx, nz] = next;
	windowAt = next;
	landWindow.x = nx * cell;
	landWindow.z = nz * cell;
	terrainStats.windows = (terrainStats.windows ?? 0) + 1;
	if (anew || Math.abs(nx - ox) >= N || Math.abs(nz - oz) >= N) windowJobs = [[nx, nz, nx + N, nz + N]];
	else {
		// (the columns it moved towards, the whole height of it; then the rows, across the rest)
		const cols = nx > ox ? [ox + N, nx + N] : nx < ox ? [nx, ox] : null;
		if (cols) windowJobs.push([cols[0], nz, cols[1], nz + N]);
		const rest = nx > ox ? [nx, ox + N] : nx < ox ? [ox, nx + N] : [nx, nx + N];
		if (nz > oz) windowJobs.push([rest[0], oz + N, rest[1], nz + N]);
		if (nz < oz) windowJobs.push([rest[0], nz, rest[1], oz]);
	}
	// (a job of what is no longer in the window is cut to what is)
	windowJobs = windowJobs.map(([a, b, c, d]) => [Math.max(a, nx), Math.max(b, nz), Math.min(c, nx + N), Math.min(d, nz + N)]).filter(([a, b, c, d]) => c > a && d > b);
	for (const fn of windowListeners) fn();
}
// a tile come or gone: its part of the window filled again
function tileInWindow(t) {
	if (!windowAt) return;
	const N = land.points, cell = land.cellSize, S = settings.terrainWorldSize;
	const gx = Math.round((t.tx * S) / cell), gz = Math.round((t.tz * S) / cell);		// (a tile's first grid point: its middle's, less half, as a window's)
	const [wx, wz] = windowAt;
	const job = [Math.max(gx, wx), Math.max(gz, wz), Math.min(gx + N, wx + N), Math.min(gz + N, wz + N)];
	if (job[2] > job[0] && job[3] > job[1]) windowJobs.push(job);
}
// so many rows of the jobs filled, and each lot put on the GPU (as up to two runs of texels across, where it wraps round)
function fillJobs(rows) {
	const N = land.points, cell = land.cellSize, half = (N - 1) * cell / 2, S = settings.terrainWorldSize;
	const deep = settings.waterWorldPosY - VOID_DEPTH;
	const wrap = (v) => ((v % N) + N) % N;
	while (rows > 0 && windowJobs.length) {
		const job = windowJobs[0];
		const [x0, z0, x1] = job;
		// (as many rows as there are left to do, up to where the texels wrap round)
		const z1 = Math.min(job[3], z0 + rows, z0 + (N - wrap(z0)));
		const width = x1 - x0, height = z1 - z0;
		const fields = new Float32Array(width * height * 4), waterFields = new Float32Array(width * height * 4);
		for (let j = 0; j < height; j++) {
			const gz = z0 + j, z = gz * cell - half, tileZ = Math.round(z / S);
			let T = null, row = -1, lastTile = null;
			for (let i = 0; i < width; i++) {
				const gx = x0 + i, x = gx * cell - half, o = (j * width + i) * 4;
				// (the tile it is in: looked for again only where the row goes into another)
				const tileX = world ? Math.round(x / S) : 0;
				if (tileX !== lastTile) {
					lastTile = tileX;
					T = world ? tiles.get(tileX + ',' + tileZ)?.land ?? farTiles.get(tileX + ',' + tileZ)?.land ?? null : land;
					row = T ? Math.round((z - (T.center?.[1] ?? 0) + half) / cell) : -1;
				}
				if (!T || row < 0 || row > N - 1) { fields[o] = deep; waterFields[o] = deep; waterFields[o + 1] = 100000; continue; }
				if (T.points != N) {
					// (THE LAND FAR OFF: coarser, its nearest grid point's)
					const n = T.normalAt(x, z), Tc = T.cellSize, Th = (T.points - 1) * Tc / 2, kk = Math.min(Math.max(Math.round((z - T.center[1] + Th) / Tc), 0), T.points - 1) * T.points + Math.min(Math.max(Math.round((x - T.center[0] + Th) / Tc), 0), T.points - 1);
					fields[o] = waterFields[o] = T.heightAt(x, z);
					fields[o + 1] = T.covers[kk];
					fields[o + 2] = n[0];
					fields[o + 3] = n[2];
					waterFields[o + 1] = T.shoreDistances[kk];
					waterFields[o + 2] = T.lakes[kk];
					continue;
				}
				const col = Math.min(Math.max(Math.round((x - (T.center?.[0] ?? 0) + half) / cell), 0), N - 1), k = row * N + col;
				fields[o] = T.heights[k];
				// (a town is grassland, round its streets and houses: the grass is kept off those by townMask.js)
				fields[o + 1] = T.covers[k] + (Math.min(T.covers[k], 0.04) - T.covers[k]) * Math.min(T.townStrength[k] * 1.5, 1);
				fields[o + 2] = T.normals[k * 3];
				fields[o + 3] = T.normals[k * 3 + 2];
				waterFields[o] = T.heights[k];
				waterFields[o + 1] = T.shoreDistances[k];
				waterFields[o + 2] = T.lakes[k];
			}
		}
		// (up to two runs across: before and after the texels wrap round)
		const tx = wrap(x0), first = Math.min(width, N - tx);
		for (const [from, count, at] of [[0, first, tx], [first, width - first, 0]]) {
			if (count <= 0) continue;
			const layout = { offset: from * 16, bytesPerRow: width * 16, rowsPerImage: height };
			device.queue.writeTexture({ texture: terrainFieldsTexture, origin: [at, wrap(z0)] }, fields, layout, [count, height]);
			device.queue.writeTexture({ texture: terrainWaterTexture, origin: [at, wrap(z0)] }, waterFields, layout, [count, height]);
		}
		rows -= height;
		if (z1 >= job[3]) windowJobs.shift();
		else job[1] = z1;
	}
}

function regenerateTerrain() {
	const params = getTerrainParams();
	// (in a world of tiles: the home tile made here, the rest as the camera comes near them)
	tiles.clear();
	farTiles.clear();
	surveys.clear();
	cancelJobs((key) => typeof key == 'string' && key.startsWith('tile '));	// (what was waiting for the tiles of the land before)
	tileAsked = null;
	windowAt = null;
	windowJobs = [];
	world = params.worldTiles ? layoutWorld(params.seed, params.townCount) : null;
	if (world) {
		const homeParams = tileParams(params, world, HOME);
		tiles.set(HOME, { key: HOME, kind: 'land', land: generateTerrain(homeParams), params: homeParams, usedAt: performance.now() });
		land = makeWorldLand(tiles.get(HOME).land);
	} else land = generateTerrain(params);
	landWindow.x = 0;
	landWindow.z = 0;

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
	fillWindow();

	placeBuildings();
	// the worker makes its chunks from the same land (a copy of the grids: about 17MB, once a land; once a tile, in a world of tiles)
	landGeneration++;
	inFlight.clear();
	if (chunkWorker) {
		if (world) for (const t of tiles.values()) chunkWorker.postMessage({ land: landGeneration, tile: t.key, params: t.params, grids: t.land.chunkGrids });
		else chunkWorker.postMessage({ land: landGeneration, tile: 'land', params: params, grids: land.chunkGrids });
	}
	resetChunks();

	generatedParams = JSON.stringify(params);
	console.log("Terrain generated: ", chunks.size, " chunks to start with");
}
// the loading screen says so first, and waits until that is on the screen: this is the longest stretch of the loading (see loading.js)
await showStage('Generating the land', 0.35);
regenerateTerrain();
setLoadingStage('Getting everything else ready', 0.75);

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

	//for the rock: where the land data texture lies, and how big a pixel is (see pixelSize in transformations.js)
	bufferResult.push(settings.terrainWorldSize * 0.5);
	bufferResult.push(land.cellSize);
	bufferResult.push(transformations.pixelSize());
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
	//where the land data texture's window is (see THE WINDOW)
	bufferResult.push(landWindow.x, landWindow.z, 0, 0);
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
  },
  {
    binding: 8,								//for reading the bakes of the far chunks: anisotropic, at the level the setting asks for
    visibility: GPUShaderStage.FRAGMENT,
    sampler: {}
  }
  ]
});

// a chunk's bake, for drawing it (see THE BAKE)
const bindGroupBakedLayout = device.createBindGroupLayout({
  label: "terrain baked chunk Bind Group Layout",
  entries: [
  { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: {} },		// the square it covers
  { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },		// color
  { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },		// shape
  ]
});

// and for taking one: where the picture is, one slot of the buffer for each chunk baked this frame
const bindGroupBakeLayout = device.createBindGroupLayout({
  label: "terrain bake Bind Group Layout",
  entries: [
  { binding: 3, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { hasDynamicOffset: true } },
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
			},
			{
				binding: 8,
				resource: filteredSampler()
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

// the land near the camera, with the relief in its depth (fragmentMain), and the land further off without (fragmentMainFar)
// The land is only ever seen from above, so the side of a hill facing away from the camera is never seen: it is left out
//		(back face culling), which is less for the GPU to set up and, for the near chunks, to shade. Not the skirts: they
//		hang under the edges both ways round, and have to be seen from whichever side a crack shows them. They are drawn
//		after the rest with terrainSkirtPipeline (see terrainPass)
const TERRAIN_CULL = 'back';
function createTerrainPipeline(label, fragmentEntryPoint, cullMode = TERRAIN_CULL) {
	return device.createRenderPipeline({
	  label: label,
	  layout: terrainVFPipelineLayout,
		vertex: {
			module: terrainShaderModule,
			entryPoint: "vertexMain",
			buffers: [scene.vertexBufferLayout]		// same 8 floats as every other model: position, 2 spare (uv), normal
		},
		fragment: {
			module: terrainShaderModule,
			entryPoint: fragmentEntryPoint,
			targets: [{
			format: canvasFormat
			}]
		},
		primitive: {
			topology: 'triangle-list',
			cullMode: cullMode,
		},
		depthStencil: {
			depthWriteEnabled: true,
			depthCompare: depthTest('less'),
			format: DEPTH_FORMAT,
		},
	});
}
const terrainVFPipelineLayout = device.createPipelineLayout({
	label: "terrain VF Pipeline Layout",
	bindGroupLayouts: [ bindGroupVFLayout ],
});
const terrainPipeline = createTerrainPipeline("terrain VF pipeline", "fragmentMain");
const terrainFarPipeline = createTerrainPipeline("terrain VF pipeline, far off", "fragmentMainFar");
const terrainSkirtPipeline = createTerrainPipeline("terrain VF pipeline, the skirts", "fragmentMainFar", 'none');

// where the skirt starts in the list of triangles of a chunk (see chunkIndices in terrainGenerator.js: the grid comes first)
const CHUNK_GRID_INDICES = CHUNK_CELLS * CHUNK_CELLS * 6;
const CHUNK_SKIRT_INDICES = chunkIndexData.length - CHUNK_GRID_INDICES;

/*
	THE BAKE
	Far off, a chunk is drawn from a picture of what its ground is made of, taken once from straight above, instead of working
	the material out again for every pixel of every frame. All the noise of the rock, the veins, the sand and the turf goes into
	the picture; the light (sun, shadows, sky, moon, fog) is still worked out live from it, so it moves with the time of day.

	The picture is two textures as wide as the Far Land Bake setting says (128 or 256 texels), with their smaller copies:
		color	rgb: the albedo, a: how much sky light gets to the ground (less in the crevices of bare rock)
		shape	rg: which way the surface faces (x and z: it always faces up, so y follows), b: how much is snow, a: wet sand
	The small shapes fade out at the size of a texel instead of a pixel, so the far land is a little softer than if it were
	worked out live. 256 keeps more of it, at four times the memory.

	A chunk is baked the first time it is drawn far enough off (BAKE_DISTANCE), a few chunks a frame, nearest first. Until
	then it is drawn the live way. When something the picture depends on changes (a setting of the ground, snow falling,
	the grass turning to hay) every bake is out of date: each is still drawn until its new one is made.

	Kept in GPU memory only, and only while there is room (MAX_BAKES): the land comes from the seed, so a bake thrown away
	is made again the same the next time it is needed.
	It is taken from straight above, so on a face steeper than about 60 degrees the texels are stretched down the slope.
	(The steeper a chunk, the further off it is still drawn finer, which makes up for most of that)
*/
const terrainBakedPipeline = device.createRenderPipeline({
	label: "terrain VF pipeline, from the bake",
	layout: device.createPipelineLayout({
		label: "terrain baked Pipeline Layout",
		bindGroupLayouts: [ bindGroupVFLayout, bindGroupBakedLayout ],
	}),
	vertex: {
		module: terrainShaderModule,
		entryPoint: "vertexMain",
		buffers: [scene.vertexBufferLayout]
	},
	fragment: {
		module: terrainShaderModule,
		entryPoint: "fragmentMainBaked",
		targets: [{ format: canvasFormat }]
	},
	primitive: {
		topology: 'triangle-list',
		cullMode: TERRAIN_CULL,
	},
	depthStencil: {
		depthWriteEnabled: true,
		depthCompare: depthTest('less'),
		format: DEPTH_FORMAT,
	},
});

const BAKE_FORMATS = ['rgba8unorm-srgb', 'rgba8unorm'];	// color (stored as sRGB, for more steps in the darks), shape
const bakePipeline = device.createRenderPipeline({
	label: "terrain bake pipeline",
	layout: device.createPipelineLayout({
		label: "terrain bake Pipeline Layout",
		bindGroupLayouts: [ bindGroupVFLayout, bindGroupBakeLayout ],
	}),
	vertex: {
		module: terrainShaderModule,
		entryPoint: "vertexBake",
		buffers: [scene.vertexBufferLayout]
	},
	fragment: {
		module: terrainShaderModule,
		entryPoint: "fragmentBake",
		targets: BAKE_FORMATS.map((format) => ({ format: format })),
	},
	primitive: {
		topology: 'triangle-list',
		cullMode: 'none',
	},
});

const bakeMipPipeline = device.createRenderPipeline({
	label: "terrain bake mip pipeline",
	layout: 'auto',
	vertex: {
		module: device.createShaderModule({ label: "vf_terrainBakeMips", code: vf_terrainBakeMips }),
		entryPoint: "vertexMain",
	},
	fragment: {
		module: device.createShaderModule({ label: "vf_terrainBakeMips", code: vf_terrainBakeMips }),
		entryPoint: "fragmentMain",
		targets: BAKE_FORMATS.map((format) => ({ format: format })),
	},
	primitive: {
		topology: 'triangle-list',
	},
});

const BAKE_SLOT = 256;			// bytes between the uniforms of two chunks baked in the same frame (the least a dynamic offset can step)
const bakeSlots = Math.ceil(BAKE_TEXELS_PER_FRAME / (128 * 128));
const bakeUniformBuffer = device.createBuffer({
	label: "terrain bake uniforms",
	size: BAKE_SLOT * bakeSlots,
	usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const bakeUniformBindGroup = device.createBindGroup({
	label: "terrain bake bind group",
	layout: bindGroupBakeLayout,
	entries: [{ binding: 3, resource: { buffer: bakeUniformBuffer, size: 16 } }],
});
const bakeMipSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

let bakeQueue = [];			// chunks drawn last frame that want a bake, nearest first (see terrainPass)
let bakeVersion = "";		// everything a bake depends on, as it is now. A bake made under another is out of date
let bakeSize = 0;			// the size the bakes there are were made at
let bakeCount = 0;

// what the picture of the ground depends on. The snow and the hay change slowly and go in steps, so the bakes are made again
//		now and then while they change, not every frame
function currentBakeVersion() {
	return JSON.stringify([settings.terrainRockDetail, settings.terrainRockVeins, settings.terrainGroundDetail, settings.terrainBeachHeight,
		settings.terrainBankHeight, settings.terrainSnowLine, settings.waterWorldPosY, Math.round(weatherNow.snowCover * 25), Math.round(seasonNow.hay * 25)]);
}

function destroyBake(chunk) {
	if (!chunk.bake) {
		return;
	}
	chunk.bake.color.destroy();
	chunk.bake.shape.destroy();
	chunk.bake.area.destroy();
	chunk.bake = null;
	bakeCount--;
}

// Takes the picture of one chunk (see THE BAKE), into the bake it has or a new one. slot: which of this frame's uniform slots to use
function bakeChunk(aEncoder, vfBindGroup, chunk, slot) {
	const size = bakeSize;
	if (!chunk.bake) {
		const texture = (format) => device.createTexture({
			label: "terrain chunk bake",
			size: [size, size],
			format: format,
			mipLevelCount: mipLevelsFor(size, size),
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		const color = texture(BAKE_FORMATS[0]), shape = texture(BAKE_FORMATS[1]);
		const area = device.createBuffer({ label: "terrain chunk bake area", size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		device.queue.writeBuffer(area, 0, new Float32Array([chunk.x0, chunk.z0, chunk.size, 0]));
		chunk.bake = {
			color: color, shape: shape, area: area, version: "", lastDrawn: chunkFrame,
			bindGroup: device.createBindGroup({
				label: "terrain baked chunk bind group",
				layout: bindGroupBakedLayout,
				entries: [
					{ binding: 0, resource: { buffer: area } },
					{ binding: 1, resource: color.createView() },
					{ binding: 2, resource: shape.createView() },
				],
			}),
		};
		bakeCount++;
	}
	const bake = chunk.bake;
	const level = (texture, mip) => texture.createView({ baseMipLevel: mip, mipLevelCount: 1 });

	// the picture: the chunk's own square, one texel to size / texels of ground
	device.queue.writeBuffer(bakeUniformBuffer, slot * BAKE_SLOT, new Float32Array([chunk.x0, chunk.z0, chunk.size, chunk.size / size]));
	const pass = aEncoder.beginRenderPass({
		colorAttachments: [bake.color, bake.shape].map((texture) => ({ view: level(texture, 0), loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: "store" })),
		timestampWrites: profiler.timestamps('Bake', 'vf_terrain fragmentBake'),
	});
	pass.setPipeline(bakePipeline);
	pass.setBindGroup(0, vfBindGroup);
	pass.setBindGroup(1, bakeUniformBindGroup, [slot * BAKE_SLOT]);
	pass.setVertexBuffer(0, chunk.vertexBuffer);
	pass.setIndexBuffer(chunkIndexBuffer, 'uint16');
	pass.drawIndexed(chunkIndexData.length, 1, 0, 0, 0);
	pass.end();

	// and its smaller copies, each from the one before
	const levels = mipLevelsFor(size, size);
	for (let mip = 1; mip < levels; mip++) {
		const mipPass = aEncoder.beginRenderPass({
			colorAttachments: [bake.color, bake.shape].map((texture) => ({ view: level(texture, mip), loadOp: "clear", clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: "store" })),
			timestampWrites: profiler.timestamps('Smaller Copies', 'vf_terrainBakeMips'),
		});
		mipPass.setPipeline(bakeMipPipeline);
		mipPass.setBindGroup(0, device.createBindGroup({
			label: "terrain bake mip bind group",
			layout: bakeMipPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: level(bake.color, mip - 1) },
				{ binding: 1, resource: level(bake.shape, mip - 1) },
				{ binding: 2, resource: bakeMipSampler },
			],
		}));
		mipPass.draw(3);
		mipPass.end();
	}
	bake.version = bakeVersion;
}

// Once a frame, after the uniforms are written: bakes the chunks the last frame asked for, as many as the frame allows,
//		and throws away the bakes drawn longest ago if there are too many
function bakeWantedChunks() {
	const size = settings.enableTerrain ? Number(settings.terrainFarBake) || 0 : 0;
	if (size !== bakeSize) {
		// another size (or off): every bake there is goes
		for (const chunk of chunks.values()) destroyBake(chunk);
		bakeSize = size;
		bakeQueue = [];
	}
	bakeVersion = currentBakeVersion();
	terrainStats.bakedThisFrame = 0;
	if (bakeSize == 0 || bakeQueue.length == 0) {
		terrainStats.bakes = bakeCount;
		return;
	}

	const encoder = device.createCommandEncoder({ label: "terrain bake encoder" });
	const vfBindGroup = createVFBindGroupTerrain();
	const most = Math.max(1, Math.floor(BAKE_TEXELS_PER_FRAME / (bakeSize * bakeSize)));
	profiler.section('Terrain Bake', () => {
		for (const chunk of bakeQueue.slice(0, most)) {
			if (chunks.get(chunkName(chunk.x0, chunk.z0, chunk.size)) !== chunk) continue;	// (thrown away since it was asked for)
			bakeChunk(encoder, vfBindGroup, chunk, terrainStats.bakedThisFrame);
			terrainStats.bakedThisFrame++;
		}
	});
	device.queue.submit([encoder.finish()]);
	bakeQueue = [];

	if (bakeCount > MAX_BAKES) {
		const baked = [...chunks.values()].filter((chunk) => chunk.bake && chunk.bake.lastDrawn < chunkFrame - 1);
		baked.sort((a, b) => a.bake.lastDrawn - b.bake.lastDrawn);
		for (const chunk of baked.slice(0, bakeCount - MAX_BAKES)) destroyBake(chunk);
	}
	terrainStats.bakes = bakeCount;
}

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

	if (world) streamTiles();

	// the mesh: which chunks are the land from where the camera is now, and a few more of the ones that are still to be made
	chooseChunks();
	buildWantedChunks(BUILD_MILLISECONDS);
	terrainStats.chunks = chunks.size;
	terrainStats.built = builtSince;
	terrainStats.waiting = wantedChunks.length;
	builtSince = 0;

	terrainUniformBufferUpdates();
	bakeWantedChunks();		//(after the uniforms: the bake reads them)
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
	pass.setBindGroup(0, createVFBindGroupTerrain());
	pass.setIndexBuffer(chunkIndexBuffer, 'uint16');

	// only the chunks the camera can see any of: a chunk is out of view if its whole box is on the outer side of one of the 6 planes
	//		(tested with the corner of the box that is furthest along the way the plane faces: if even that is outside, all of it is)
	const planes = transformations.getFrustumPlanes();
	const inView = [];
	for (const chunk of chosenChunks) {
		const outside = planes.some((plane) =>
			plane[0] * (plane[0] > 0 ? chunk.x0 + chunk.size : chunk.x0) +
			plane[1] * (plane[1] > 0 ? chunk.maxY : chunk.minY) +
			plane[2] * (plane[2] > 0 ? chunk.z0 + chunk.size : chunk.z0) + plane[3] < 0);
		if (outside) continue;
		inView.push({ chunk: chunk, distance: distanceToChunk(chunk) });
	}

	// Nearest first. Then a pixel of land behind a hill fails the depth test before its shader is run, as the hill is already
	//		in the depth. Only the far pipeline gets that: a shader that writes its own depth (the near one) is always run.
	//		So the relief goes into the depth only near the camera, where it is big enough on screen to be found in it
	//		Far off, a chunk with a bake is drawn from it (see THE BAKE), and one without asks for one
	inView.sort((a, b) => a.distance - b.distance);
	terrainStats.triangles = 0;
	terrainStats.nearChunks = 0;
	terrainStats.bakedChunks = 0;
	bakeQueue = [];
	let pipeline = null;
	for (const { chunk, distance } of inView) {
		let wanted = distance < RELIEF_DEPTH_DISTANCE ? terrainPipeline : terrainFarPipeline;
		if (bakeSize > 0 && distance >= BAKE_DISTANCE) {
			if (!chunk.bake || chunk.bake.version !== bakeVersion) bakeQueue.push(chunk);
			if (chunk.bake) wanted = terrainBakedPipeline;		// (one out of date is still drawn until its new one is made)
		}
		if (wanted !== pipeline) {
			pipeline = wanted;
			pass.setPipeline(pipeline);
		}
		if (pipeline === terrainPipeline) terrainStats.nearChunks++;
		if (pipeline === terrainBakedPipeline) {
			pass.setBindGroup(1, chunk.bake.bindGroup);
			chunk.bake.lastDrawn = chunkFrame;
			terrainStats.bakedChunks++;
		}
		pass.setVertexBuffer(0, chunk.vertexBuffer);
		pass.drawIndexed(CHUNK_GRID_INDICES, 1, 0, 0, 0);		// the ground, without its skirt
		terrainStats.triangles += CHUNK_GRID_INDICES / 3;
	}

	// and the skirts, both sides, in the same order. After the ground, so that most of them are already hidden behind it.
	//		Worked out live, even under a baked chunk: there is too little of them showing for it to matter
	pass.setPipeline(terrainSkirtPipeline);
	for (const { chunk } of inView) {
		pass.setVertexBuffer(0, chunk.vertexBuffer);
		pass.drawIndexed(CHUNK_SKIRT_INDICES, 1, CHUNK_GRID_INDICES, 0, 0);
		terrainStats.triangles += CHUNK_SKIRT_INDICES / 3;
	}
}
