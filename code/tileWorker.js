import { generateTerrain, seededRandom } from './terrainGenerator.js'
import { plantForest, plantTownTrees } from './forestGenerator.js'
import { groundWork } from './townGround.js'

/*
	Makes the lands of the world's tiles (world.js) off the main thread (terrain.js streams them in as the camera comes near them): a whole
	land is about 3 seconds of work, which on the main thread would stop the frames dead.
	Messages in:
		{ port }				a port to the chunk worker (terrainWorker.js): each tile's chunk grids go to it from here, so the main thread
								does not copy them
		{ tile, params, survey: true }	only what towns that tile's land has: { tile, survey: [{ x, z, types (each building's), dock }] }
		{ tile, params, generation, forest }	make that tile's land (world.js: tileParams), and its trees, if forest ({ params, variants }:
										forest.js's planting settings), each TREE_RECORD floats (forest.js: bringInTrees)
	Messages out:
		{ tile, params, data }	the land as plain data (terrainGenerator.js: wrapLand makes it a land again): its grids handed over, not copied
		{ tile, error }			it could not be made
*/
const TREE_RECORD = 12;
const LOOK_UPS = new Set(['heightAt', 'groundAt', 'zoneAt', 'normalAt', 'findSpawnPoints', 'buildChunk', 'roadAt', 'onPath', 'townAt', 'rangeAt', 'riverAt']);
// (what a land is made of, without the odd function left in it from making it: a town's site keeps the noise its streets were laid out with)
function plain(v, seen = new WeakMap()) {
	if (typeof v == 'function') return undefined;
	if (!v || typeof v != 'object' || ArrayBuffer.isView(v)) return v;
	if (seen.has(v)) return seen.get(v);
	const out = Array.isArray(v) ? [] : {};
	seen.set(v, out);
	for (const [k, w] of Object.entries(v)) { const c = plain(w, seen); if (c !== undefined || Array.isArray(v)) out[k] = c; }
	return out;
}
let chunks = null;
self.onmessage = (event) => {
	if (event.data.port) { chunks = event.data.port; return; }
	const { tile, params, generation } = event.data;
	try {
		const land = generateTerrain(params);
		if (event.data.survey) {
			self.postMessage({ tile, survey: land.towns.map((t) => {
				const list = t.buildings.filter((b) => !b.onPier), n = Math.max(list.length, 1);
				return { x: list.reduce((s, b) => s + b.x, 0) / n, z: list.reduce((s, b) => s + b.z, 0) / n, types: t.buildings.map((b) => b.type), dock: !!t.dock, river: !!t.site?.river };
			}) });
			return;
		}
		// (a copy of its grids for the chunk worker first: what goes to the main thread is handed over)
		if (chunks) chunks.postMessage({ land: generation, tile, params, grids: plain(land.chunkGrids) });
		const data = {};
		for (const [key, value] of Object.entries(land)) if (!LOOK_UPS.has(key)) data[key] = plain(value);
		// (every grid handed over once: some are in the land and in its chunk grids both)
		const buffers = new Set();
		const gather = (v) => { if (ArrayBuffer.isView(v)) buffers.add(v.buffer); else if (v && typeof v == 'object' && !Array.isArray(v)) for (const w of Object.values(v)) if (ArrayBuffer.isView(w)) buffers.add(w.buffer); };
		for (const v of Object.values(data)) gather(v);
		gather(data.chunkGrids?.paths);
		// its towns' ground work (town.js draws it: townGround.js)
		if (land.towns.length || land.paths?.length || land.fireTowers?.length) {	// (and a tile with no town: its roads, its railway, its tunnels, its fire tower)
			const work = groundWork(land.towns, params.seaLevel, null, land.paths, land.groundAt, land.zoneAt, land.fireTowers, event.data.unitsPerMetre ?? 2, land.stations);
			data.townGround = work.done();
			buffers.add(data.townGround.buffer);
		}
		// its trees: planted as forest.js plants the home tile's, with a seed of the tile's own
		if (event.data.forest) {
			const F = event.data.forest, P = { ...F.params, seed: F.params.seed + Math.floor(seededRandom(params.center[0] * 0.13 + params.center[1] * 0.71 + 5)() * 1e6) };
			const planted = plantForest(land, P, F.variants).concat(plantTownTrees(land, P, F.variants));
			const records = new Float32Array(planted.length * TREE_RECORD);
			planted.forEach((t, k) => records.set([t.x, t.y, t.z, t.species, t.variant, t.age, t.scale, t.yaw, t.leanX, t.leanZ, t.seed, t.planted ? 1 : 0], k * TREE_RECORD));
			data.forestTrees = records;
			data.forestPlanted = JSON.stringify(F.params);
			buffers.add(records.buffer);
		}
		self.postMessage({ tile, params, data }, [...buffers]);
	} catch (error) {
		self.postMessage({ tile, error: String(error?.stack ?? error) });
	}
};
