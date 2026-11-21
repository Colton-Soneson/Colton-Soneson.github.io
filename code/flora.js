import { DEPTH_FORMAT, depthTest } from './depthMode.js'
import { device, frameTexture, canvasFormat } from './deviceSelection.js'
import * as profiler from './profiler.js'
import { settings } from './settings.js';
import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import { FOREST_THRESHOLD, MOUNTAIN_THRESHOLD } from './terrainGenerator.js'
import * as wind from './wind.js'
import { townMaskBuffers } from './townMask.js'
import { weatherNow, seasonNow, SEASON_SPRING, SEASON_SUMMER, SEASON_FALL } from './weather.js'
import { skyViewLUTtexture } from './atmosphere.js'
import * as atmosphere from './atmosphere.js'
import { uniformBufferLights } from './rotatingCube.js'
import { floorView, floorSampler, floorUniformBuffer } from './floor.js'
import { grassHolesView, grassHolesUniform } from './computeGrass.js'
import { vf_flora, c_flora, FLORA_RINGS, FLORA_CAP, FLORA_INSTANCE } from '../shaders/js/vf_flora.js'
import { KINDS, KINDS_HD, SMALL, WHERE, BIG_VERTICES } from './floraKinds.js'
import { MEADOW_SCRUB, meadowShapes } from '../shaders/js/meadowShapes.js'
import * as sunShadows from './sunShadows.js'
import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import { makeItem } from './items.js'
import * as inventory from './inventory.js'
import * as loot from './loot.js'

/*
	THE PLANTS: thirty kinds and more of the small ones (ferns, mosses, mushrooms and the forest's flowers; the grassland's flowers and
	tussocks; cattails in the marsh, dune grass and thrift on the sand, heather and avens up high: floraKinds.js), and the big ones (the
	laurel, huckleberry and salmonberry bushes, the juniper, the wild wheat).
		THE SMALL ONES		put down on the GPU every frame (vf_flora.js: THE SCATTER, a compute pass), in COLONY patches, on the cells of
							RINGS round the camera, only those in sight, each kind into its own share of a list; then each kind drawn with
							one indirect draw of its own vertices. Settings: floraDensity, floraDrawDistance (the last ring's reach)
		THE BIG ONES		put down here, on BIG.cell squares round the camera out to BIG.reach (made again once it has gone BIG.again),
							a square's own random numbers saying whether one is there and which: a bush of its ground's (floraKinds.js:
							where and weight; BIG.chance, by ground: the forest, the grassland, the marsh, the beach, up high), and the
							wild wheat in its patches of the grassland (BIG.wheat); the bushes in thickets (BIG.clump: a slow noise over
							BIG.clump.from), and each kind in stands of its own (a slow noise of its own, BIG.stand metres across).
							Each kind of them is drawn on its own (as many vertices as it has: a vine maple is not drawn with a
							juniper's)
		PUSHING THROUGH		a bush round the walker slows it (hunting.js: effects.brush, BRUSH)
		WILD WHEAT			E at a stand of it: WHEAT_SEEDS seeds (items.js: wheatSeeds: a hoe's bed needs one, farms.js), and the stand is
							gone until it grows back REGROW days on (this machine's: nothing to send)
	World units (2 to the metre) for places; metres in the constants.
*/
const RINGS = [{ radius: 22, cell: 0.6 }, { radius: 55, cell: 1.3 }, { radius: 1, cell: 2.8, far: true }];	// metres: the last reaches floraDrawDistance
const FILL = { forest: 0.95, grass: 0.75, wet: 0.85, beach: 0.55, alpine: 0.7, stony: 0.6 };	// the share of a colony's middle with a plant on it, by its ground
const COLONY = { cell: 5, reach: 0.8, stray: 0.1, bare: 0.3 };	// a colony's cell (metres), how far out from its point it thins (of the cell), the strays of other kinds in it, and the bare stretches between (a noise under this)
const ALPINE = 0.42;					// of the snow line: the heights from here up are the heather's
const SWAY = 0.5;						// how far the wind sways them
const BIG = { cell: 6, reach: 220, again: 25, chance: { forest: 0.07, grass: 0.018, wet: 0.05, beach: 0.025, alpine: 0.06 }, clump: { scale: 28, from: 0.5 }, stand: 40, wheat: { scale: 70, from: 0.66, chance: 0.4 } };
const BRUSH = { pace: 0.6, reach: 0.55 };	// how fast the walker goes through a bush, and how far out from its middle it is in it (of its size)
const WHEAT_SEEDS = [2, 4], REGROW = 2, PICK = 2.2;		// seeds from a stand, days to grow back, metres it is picked from
export const floraStats = { big: 0, wheat: 0, bushes: 0, picked: 0, rebuilt: 0, ms: 0 };

const metre = () => settings.forestUnitsPerMetre;
const module = device.createShaderModule({ label: 'vf_flora', code: vf_flora });
const computeModule = device.createShaderModule({ label: 'c_flora', code: c_flora });
const uniformBuffer = device.createBuffer({ label: 'flora uniforms', size: 512, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

// the kinds and their vertices, once, both as they are and HD (floraKinds.js: HD; vf_flora.js has how they are laid out). The ones
//		drawn are the HD ones while HD Textures and Models is on (settings.hdVegetation)
const storage = (label, data, more = 0) => { const b = device.createBuffer({ label, size: Math.max(data.byteLength, 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | more }); device.queue.writeBuffer(b, 0, data); return b; };
const VERTEX_FLOATS = 16;
function packKinds(kinds, label) {
	const vertexData = [], kindData = [];
	for (const [index, k] of kinds.entries()) {
		const first = vertexData.length / VERTEX_FLOATS;
		for (const v of k.vertices) vertexData.push(...v.p, v.sway, ...v.n, v.flag, ...v.c, index, ...v.uv, v.mat, 0);
		const flags = (k.flower ? 1 : 0) | (k.fern ? 2 : 0) | (k.fungus ? 4 : 0) | (k.far ? 8 : 0);
		kindData.push(first, k.vertices.length, WHERE.indexOf(k.where), k.weight, ...(k.niche ?? [0.5, 0.5]), k.spread ?? 0.3, flags, k.size[0], k.size[1], 0, 0);
	}
	return { kinds, vertices: storage('flora vertices' + label, new Float32Array(vertexData)), kindList: storage('flora kinds' + label, new Float32Array(kindData)) };
}
const PACKS = [packKinds(KINDS, ''), packKinds(KINDS_HD, ' HD')];
const pack = () => PACKS[settings.hdVegetation ? 1 : 0];
let bigBuffer = storage('flora big', new Float32Array(8)), bigCapacity = 1, bigCount = 0;
// THE SCATTER's: each small kind's count, its share of the list of those put down, and its draw
const zeros = new Uint32Array(SMALL.length);
const countBuffer = storage('flora counts', zeros);
const placedBuffer = device.createBuffer({ label: 'flora placed', size: SMALL.length * FLORA_CAP * FLORA_INSTANCE * 16, usage: GPUBufferUsage.STORAGE });
const drawBuffer = storage('flora draws', new Uint32Array(SMALL.length * 4), GPUBufferUsage.INDIRECT);

const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT, Cs = GPUShaderStage.COMPUTE;
const renderLayout = device.createBindGroupLayout({
	label: 'flora draw layout',
	entries: [
		...sunShadows.sunShadowLayoutEntries(V | F),
		{ binding: 0, visibility: V | F, buffer: {} },
		{ binding: 1, visibility: V | F, buffer: {} },
		{ binding: 2, visibility: V, texture: { sampleType: 'unfilterable-float' } },
		{ binding: 3, visibility: F, texture: {} },
		{ binding: 4, visibility: F, sampler: {} },
		{ binding: 5, visibility: V, texture: {} },
		{ binding: 6, visibility: V, sampler: {} },
		...[14, 15, 16, 18].map((binding) => ({ binding, visibility: V, buffer: { type: 'read-only-storage' } })),
	],
});
const computeLayout = device.createBindGroupLayout({
	label: 'flora scatter layout',
	entries: [
		{ binding: 0, visibility: Cs, buffer: {} },
		{ binding: 2, visibility: Cs, texture: { sampleType: 'unfilterable-float' } },
		...[7, 8, 9, 15].map((binding) => ({ binding, visibility: Cs, buffer: { type: 'read-only-storage' } })),
		{ binding: 10, visibility: Cs, texture: {} },
		{ binding: 11, visibility: Cs, texture: {} },
		{ binding: 12, visibility: Cs, sampler: {} },
		{ binding: 13, visibility: Cs, buffer: {} },
		...[17, 18, 19].map((binding) => ({ binding, visibility: Cs, buffer: { type: 'storage' } })),
	],
});
const pipelineOf = (entryPoint) => device.createRenderPipeline({
	label: 'flora ' + entryPoint,
	layout: device.createPipelineLayout({ label: 'flora draw pipeline layout', bindGroupLayouts: [renderLayout] }),
	vertex: { module, entryPoint, buffers: [] },
	fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: depthTest('less'), format: DEPTH_FORMAT },
});
const smallPipeline = pipelineOf('vertexSmall'), bigPipeline = pipelineOf('vertexBig');
const computeOf = (entryPoint) => device.createComputePipeline({ label: 'flora ' + entryPoint, layout: device.createPipelineLayout({ label: 'flora scatter pipeline layout', bindGroupLayouts: [computeLayout] }), compute: { module: computeModule, entryPoint } });
const scatterPipeline = computeOf('scatter'), drawsPipeline = computeOf('makeDraws');

// the rings now: { side, cell, radius, before (cells in the rings inside it) } (world units)
function rings() {
	const m = metre(), out = [];
	let before = 0;
	for (const r of RINGS) {
		const radius = (r.far ? Math.max(settings.floraDrawDistance ?? 130, RINGS[1].radius + 10) : r.radius) * m, cell = r.cell * m / Math.sqrt(Math.max(settings.floraDensity ?? 1, 0.25));
		const side = Math.min(Math.ceil(2 * radius / cell), 2000);
		out.push({ side, cell, radius, before });
		before += side * side;
	}
	out.cells = before;
	return out;
}
// the season's: in flower, the fall's brown, the mushrooms'
function season() {
	const s = (t) => { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); };
	const i = seasonNow.index, p = seasonNow.progress;
	const bloom = i == SEASON_SPRING ? s((p - 0.15) / 0.4) : i == SEASON_SUMMER ? 1 : i == SEASON_FALL ? 1 - s(p / 0.35) : 0;
	return [bloom, seasonNow.hay ?? 0, weatherNow.snowCover ?? 0, i == SEASON_FALL ? 1 : 0];
}
function writeUniforms(R) {
	const m = metre(), u = [...transformations.getViewProj()];
	u.push(settings.camPosX, settings.camPosY, settings.camPosZ, performance.now() / 1000);
	u.push(settings.terrainWorldSize * 0.5, terrain.land.cellSize, settings.waterWorldPosY, settings.terrainBeachHeight);
	u.push(FOREST_THRESHOLD, MOUNTAIN_THRESHOLD, settings.terrainBankHeight, terrain.world ? 1 : 0);
	u.push(settings.terrainSnowLine * ALPINE, settings.terrainSnowLine, m, settings.floraDensity ?? 1);
	u.push(...season());
	u.push(R.length, R[R.length - 1].radius, settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0);
	u.push(...wind.windUniformValues());
	u.push(SWAY * (settings.grassWindStrength ?? 1), SMALL.length, R.cells, 0);
	u.push(FILL.forest, FILL.grass, FILL.wet, FILL.beach);
	u.push(FILL.alpine, FILL.stony, settings.hdVegetation ? 1 : 0, 0);
	u.push(COLONY.cell, COLONY.reach, COLONY.stray, COLONY.bare);
	for (let k = 0; k < FLORA_RINGS; k++) { const r = R[k] ?? { side: 1, cell: 1, radius: 0, before: R.cells }; u.push(r.side, r.cell, r.radius, r.before); }
	u.push(...grassHolesUniform());
	lastUniforms = new Float32Array(u);
	device.queue.writeBuffer(uniformBuffer, 0, lastUniforms);
}
let renderGroup = null, computeGroup = null, boundTo = [];
/*
	THE SUN'S SHADOWS (sunShadows.js): the bushes drawn into the two nearer of the sun's maps, as they were last drawn (their uniforms
	the frame before's, the view the map's). The small plants cast none: under a bush or a tree, in the grass, theirs would hardly show
*/
let lastUniforms = null, shadowGroups = null;
const shadowUniformBuffers = [0, 1].map((k) => device.createBuffer({ label: `flora sun shadow ${k} uniforms`, size: 512, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
const shadowPipeline = device.createRenderPipeline({
	label: 'flora bushes sun shadow',
	layout: device.createPipelineLayout({ label: 'flora sun shadow pipeline layout', bindGroupLayouts: [renderLayout] }),
	vertex: { module, entryPoint: 'vertexBig', buffers: [] },
	fragment: { module, entryPoint: 'fragmentShadow', targets: [] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth32float', depthBias: 2, depthBiasSlopeScale: 2.0 },
});
sunShadows.addSunShadowCaster((pass, cascade, matrix) => {
	if (cascade > 1 || !lastUniforms || !shadowGroups || !bigCount || settings.enableFlora === false) return;
	const u = lastUniforms.slice();
	u.set(matrix, 0);
	device.queue.writeBuffer(shadowUniformBuffers[cascade], 0, u);
	pass.setBindGroup(0, shadowGroups[cascade]);
	pass.setPipeline(shadowPipeline);
	for (const d of bigDraws) pass.draw(pack().kinds[d.kind].vertices.length, d.count, 0, d.first);
});
function groupsNow() {
	const key = [terrain.terrainFieldsTexture, townMaskBuffers.cells, townMaskBuffers.list, townMaskBuffers.items, bigBuffer, skyViewLUTtexture, floorView, pack()];
	if (!renderGroup || key.some((v, i) => v !== boundTo[i])) {
		boundTo = key;
		// (and the bushes' own, drawing into the sun's shadow maps: each map its uniforms, and the maps not read, sunShadows.js)
		shadowGroups = shadowUniformBuffers.map((buffer) => device.createBindGroup({
			label: 'flora sun shadow bind group', layout: renderLayout,
			entries: [
				...sunShadows.sunShadowEntries(true),
				{ binding: 0, resource: { buffer } },
				{ binding: 1, resource: { buffer: uniformBufferLights } },
				{ binding: 2, resource: terrain.terrainFieldsTexture.createView() },
				{ binding: 3, resource: skyViewLUTtexture.createView() },
				{ binding: 4, resource: linSampler },
				{ binding: 5, resource: wind.windTextureView },
				{ binding: 6, resource: wind.windSampler },
				{ binding: 14, resource: { buffer: pack().vertices } },
				{ binding: 15, resource: { buffer: pack().kindList } },
				{ binding: 16, resource: { buffer: bigBuffer } },
				{ binding: 18, resource: { buffer: placedBuffer } },
			],
		}));
		renderGroup = device.createBindGroup({
			label: 'flora draw bind group', layout: renderLayout,
			entries: [
				...sunShadows.sunShadowEntries(),
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: { buffer: uniformBufferLights } },
				{ binding: 2, resource: terrain.terrainFieldsTexture.createView() },
				{ binding: 3, resource: skyViewLUTtexture.createView() },
				{ binding: 4, resource: linSampler },
				{ binding: 5, resource: wind.windTextureView },
				{ binding: 6, resource: wind.windSampler },
				{ binding: 14, resource: { buffer: pack().vertices } },
				{ binding: 15, resource: { buffer: pack().kindList } },
				{ binding: 16, resource: { buffer: bigBuffer } },
				{ binding: 18, resource: { buffer: placedBuffer } },
			],
		});
		computeGroup = device.createBindGroup({
			label: 'flora scatter bind group', layout: computeLayout,
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 2, resource: terrain.terrainFieldsTexture.createView() },
				{ binding: 7, resource: { buffer: townMaskBuffers.cells } },
				{ binding: 8, resource: { buffer: townMaskBuffers.list } },
				{ binding: 9, resource: { buffer: townMaskBuffers.items } },
				{ binding: 15, resource: { buffer: pack().kindList } },
				{ binding: 10, resource: grassHolesView() },
				{ binding: 11, resource: floorView },
				{ binding: 12, resource: floorSampler },
				{ binding: 13, resource: { buffer: floorUniformBuffer } },
				{ binding: 17, resource: { buffer: countBuffer } },
				{ binding: 18, resource: { buffer: placedBuffer } },
				{ binding: 19, resource: { buffer: drawBuffer } },
			],
		});
	}
	return [renderGroup, computeGroup];
}

//-------------------------------THE BIG ONES-------------------------------
// a square's own random numbers (the same every time, on every machine)
function squareRandom(i, j, salt) {
	let h = (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(salt + 1, 83492791)) >>> 0;
	h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}
// a smooth noise, 0 to 1, a lattice every unit (the wheat's patches)
function smoothNoise(x, z, salt) {
	const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
	const r = (a, b) => squareRandom(a, b, salt);
	return (r(i, j) * (1 - sx) + r(i + 1, j) * sx) * (1 - sz) + (r(i, j + 1) * (1 - sx) + r(i + 1, j + 1) * sx) * sz;
}
const kindIndex = Object.fromEntries(KINDS.map((k, i) => [k.name, i]));
// the bushes of each ground (the wild wheat is put down its own way)
const BUSHES = Object.fromEntries(WHERE.map((w) => [w, KINDS.filter((k) => k.big && !k.wheat && k.where == w)]));
const SCRUB_CHANCE = 0.11;		// more bushes on the grassland where it is scrub (THE MEADOW'S LOOK): up to this many more of the squares
const MOST_CHANCE = Math.max(...Object.values(BIG.chance), BIG.wheat.chance, BIG.chance.grass + SCRUB_CHANCE);
// THE MEADOW'S LOOK (meadowShapes.js, the same numbers): how much of the scrub, and of the stony ground, there is at x, z. up: the ground's normal's y
const smooth = (a, b, v) => { const t = Math.min(Math.max((v - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
export function meadowAt(x, z, up = 1) {
	const m = metre();
	const scrub = smooth(MEADOW_SCRUB.from, MEADOW_SCRUB.to, smoothNoise(x / (BIG.clump.scale * m), z / (BIG.clump.scale * m), 5) + 0.06 * (smoothNoise(x / (4 * m), z / (4 * m), 33) - 0.5));
	const stones = 0.62 * smoothNoise(x / (24 * m), z / (24 * m), 41) + 0.38 * smoothNoise(x / (6.5 * m), z / (6.5 * m), 42) + 0.9 * (1 - smooth(0.86, 0.98, up));
	const stony = smooth(0.7, 0.8, stones + 0.08 * (smoothNoise(x / (2.5 * m), z / (2.5 * m), 43) - 0.5));
	return { scrub: scrub * (1 - stony), stony };
}
// one of a ground's bushes at x, z: each in stands of its own (a slow noise for each kind), picked by r
function bushAt(where, x, z, r) {
	const list = BUSHES[where], m = metre();
	if (!list?.length) return null;
	const weights = list.map((k) => { const n = smoothNoise(x / (BIG.stand * m), z / (BIG.stand * m), 20 + kindIndex[k.name]); return k.weight * (0.08 + n * n * n); });
	let pick = r * weights.reduce((a, b) => a + b, 0);
	for (let k = 0; k < list.length; k++) { if (pick < weights[k]) return list[k].name; pick -= weights[k]; }
	return list[list.length - 1].name;
}
let bigDraws = [];		// { vertices, count, first }: each kind's run of the list (it is sorted by kind)
let bigList = [], bigFor = null, bigAt = [Infinity, Infinity];
const picked = new Map();			// a wild wheat's square ('i,j') -> the day it was picked
const day = () => atmosphere.sunCycles;
function placeBig() {
	const t0 = performance.now(), land = terrain.land, m = metre(), cell = BIG.cell * m, reach = BIG.reach * m, sea = settings.waterWorldPosY;
	const cx = settings.camPosX, cz = settings.camPosZ, n = Math.ceil(reach / cell), i0 = Math.floor(cx / cell), j0 = Math.floor(cz / cell);
	const Z = terrain, list = [];
	for (let dj = -n; dj <= n; dj++) for (let di = -n; di <= n; di++) {
		const i = i0 + di, j = j0 + dj, x = (i + 0.2 + 0.6 * squareRandom(i, j, 1)) * cell, z = (j + 0.2 + 0.6 * squareRandom(i, j, 2)) * cell;
		if ((x - cx) ** 2 + (z - cz) ** 2 > reach * reach) continue;
		const r = squareRandom(i, j, 3);
		// (most squares nothing: only the ones whose number is low enough look at the land)
		if (r > MOST_CHANCE) continue;
		if (!terrain.inWorld(x, z, 4 * m)) continue;
		const zone = land.zoneAt(x, z);
		let name = null;
		// (the bushes in thickets: only where their slow noise is over BIG.clump.from)
		const thicket = smoothNoise(x / (BIG.clump.scale * m), z / (BIG.clump.scale * m), 5) > BIG.clump.from;
		const where = zone == Z.ZONE_FOREST ? 'forest' : zone == Z.ZONE_GRASSLAND ? 'grass' : zone == Z.ZONE_MARSH ? 'wet' : zone == Z.ZONE_BEACH ? 'beach'
			: zone == Z.ZONE_MOUNTAIN && land.heightAt(x, z) - sea > settings.terrainSnowLine * ALPINE ? 'alpine' : null;
		if (where == 'grass' && r < BIG.wheat.chance && smoothNoise(x / (BIG.wheat.scale * m), z / (BIG.wheat.scale * m), 9) > BIG.wheat.from) name = 'wild wheat';
		else if (where && thicket) {
			// (none on the stony ground, and more of them in the scrub)
			const look = where == 'grass' ? meadowAt(x, z, land.normalAt(x, z)[1]) : { scrub: 0, stony: 0 };
			if (look.stony < 0.5 && r < BIG.chance[where] + (where == 'grass' ? SCRUB_CHANCE * look.scrub : 0)) name = bushAt(where, x, z, squareRandom(i, j, 4));
		}
		if (!name) continue;
		if ((land.townAt?.(x, z) ?? 0) > 0.03 || land.onPath?.(x, z)) continue;
		if (land.normalAt(x, z)[1] < 0.8) continue;
		if (land.riverAt?.(x, z)) continue;
		const key = i + ',' + j;
		if (name == 'wild wheat' && picked.has(key) && day() - picked.get(key) < REGROW) continue;
		const y = land.groundAt(x, z);
		if (y < sea + 0.4 * m) continue;
		const K = KINDS[kindIndex[name]], size = K.size[0] + (K.size[1] - K.size[0]) * squareRandom(i, j, 5);
		list.push({ x, y, z, kind: kindIndex[name], name, yaw: squareRandom(i, j, 6) * Math.PI * 2, size, tone: squareRandom(i, j, 7), key });
	}
	bigFor = land; bigAt = [cx, cz];
	useBig(list);
	floraStats.rebuilt++; floraStats.ms = Math.round((performance.now() - t0) * 10) / 10;
}
// the list of big ones drawn (sorted by kind: each kind's run of it is a draw of its own), and the walker's
function useBig(list) {
	const m = metre();
	list.sort((a, b) => a.kind - b.kind);
	bigList = list;
	bigDraws = [];
	list.forEach((b, k) => { const last = bigDraws[bigDraws.length - 1]; if (last?.kind == b.kind) last.count++; else bigDraws.push({ kind: b.kind, vertices: KINDS[b.kind].vertices.length, count: 1, first: k }); });
	const data = new Float32Array(Math.max(list.length, 1) * 8);
	list.forEach((b, k) => data.set([b.x, b.y - 0.05 * m, b.z, b.kind, b.yaw, b.size, b.tone, 0], k * 8));
	if (list.length > bigCapacity) { bigBuffer.destroy(); bigCapacity = Math.ceil(list.length * 1.5); bigBuffer = device.createBuffer({ label: 'flora big', size: bigCapacity * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); }
	device.queue.writeBuffer(bigBuffer, 0, data);
	bigCount = list.length;
	floraStats.big = list.length; floraStats.wheat = list.filter((b) => b.name == 'wild wheat').length; floraStats.bushes = list.length - floraStats.wheat;
}
// (a test's: these plants, of any kind, put down as the big ones are, [{ name, x, z, size, yaw }], and nothing else, until null)
let showcase = null;
export function showcaseForTest(items) {
	showcase = items;
	if (!items) { bigFor = null; return; }
	useBig(items.map((p) => ({ x: p.x, y: terrain.land.groundAt(p.x, p.z), z: p.z, kind: kindIndex[p.name], name: p.name, yaw: p.yaw ?? 0, size: p.size ?? KINDS[kindIndex[p.name]].size[1], tone: 0.5, key: 'show' })));
}
// (the big ones made again: a new land, gone far enough, or a tile come or gone under them)
terrain.onTiles(() => { bigFor = null; });
function bigNow() {
	if (!terrain.land || showcase) return;
	if (bigFor !== terrain.land || Math.hypot(settings.camPosX - bigAt[0], settings.camPosZ - bigAt[1]) > BIG.again * metre()) placeBig();
}
export const bigPlantsForTest = () => bigList;

// PUSHING THROUGH: how fast the walker can go at (x, z), 1 out of the bushes
export function brushAt(x, z) {
	const m = metre();
	for (const b of bigList) {
		if (b.name == 'wild wheat') continue;
		if (Math.abs(b.x - x) < 3 * m && Math.abs(b.z - z) < 3 * m && Math.hypot(b.x - x, b.z - z) < b.size * BRUSH.reach * m) return BRUSH.pace;
	}
	return 1;
}

// WILD WHEAT: the stand in front of the walker, near enough to pick
function wheatInView() {
	const p = hunting.hunterPlace();
	if (!p.active || p.on != 'land') return null;
	const m = metre(), look = [Math.sin(settings.camYaw), -Math.cos(settings.camYaw)];
	let best = null, bestD = PICK;
	for (const b of bigList) {
		if (b.name != 'wild wheat') continue;
		const dx = (b.x - p.x) / m, dz = (b.z - p.z) / m, d = Math.hypot(dx, dz);
		if (d < bestD && (d < 0.9 || (dx * look[0] + dz * look[1]) / d > 0.6)) { best = b; bestD = d; }
	}
	return best;
}
hunting.addPrompt(() => wheatInView() ? { name: 'Wild wheat', keys: 'E gather seeds' } : null);
hunting.onUse(() => {
	const b = wheatInView();
	if (!b) return false;
	const n = WHEAT_SEEDS[0] + Math.floor(Math.random() * (WHEAT_SEEDS[1] - WHEAT_SEEDS[0] + 1));
	const seeds = makeItem('wheatSeeds', n);
	if (!inventory.give(seeds)) loot.dropHere([seeds]);
	picked.set(b.key, day());
	floraStats.picked++;
	help.toast(`${n} wheat seeds: a hoe's bed takes one`, 2);
	placeBig();
	return true;
});

// Per frame: the walker's pace in the bushes; and drawn, after the grass
//-------------------------------------------------
export function floraUpdate() {
	const p = hunting.hunterPlace?.();
	hunting.effects.brush = settings.enableFlora !== false && p?.active && p.on == 'land' ? brushAt(p.x, p.z) : 1;
}
export function floraPass(encoder, depthTexture) {
	if (settings.enableFlora === false || !settings.enableTerrain || !terrain.terrainFieldsTexture || !terrain.land) return;
	bigNow();
	const R = rings();
	writeUniforms(R);
	device.queue.writeBuffer(countBuffer, 0, zeros);
	const [renderGroup, computeGroup] = groupsNow();
	// THE SCATTER: every cell looked at, the plants on them put down, and the counts made into the draws
	const scatter = encoder.beginComputePass({ label: 'flora scatter', timestampWrites: profiler.timestamps('Plants scatter', 'c_flora') });
	scatter.setBindGroup(0, computeGroup);
	scatter.setPipeline(scatterPipeline);
	scatter.dispatchWorkgroups(Math.ceil(R.cells / 64));
	scatter.setPipeline(drawsPipeline);
	scatter.dispatchWorkgroups(Math.ceil(SMALL.length / 64));
	scatter.end();
	const pass = encoder.beginRenderPass({
		label: 'flora',
		colorAttachments: [{ view: frameTexture().createView(), loadOp: 'load', storeOp: 'store' }],
		depthStencilAttachment: { view: depthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Plants', 'vf_flora'),
	});
	pass.setBindGroup(0, renderGroup);
	pass.setPipeline(smallPipeline);
	for (let k = 0; k < SMALL.length; k++) pass.drawIndirect(drawBuffer, k * 16);
	if (bigCount) { pass.setPipeline(bigPipeline); for (const d of bigDraws) pass.draw(pack().kinds[d.kind].vertices.length, d.count, 0, d.first); }
	pass.end();
}
