import { DEPTH_FORMAT, depthTest, DEPTH_CLEAR } from './depthMode.js'
import {device} from './deviceSelection.js'
import { frameTexture } from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { vf_town, TOWN_MATERIALS as MAT } from '../shaders/js/vf_town.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import { addJob, SEEN } from './jobs.js'
import { BUILDING_TYPES, VARIANTS, variantSize, FLOOR_HEIGHT, GROUND_FLOOR } from './townLayout.js'
import { buildingMeshes, townMeshBuilder } from './townBuildings.js'
import { planOf } from './interiorMeshes.js'
import { lightNow } from './lighting.js'
import { seasonNow, weatherNow, SEASON_SPRING, SEASON_SUMMER, SEASON_FALL } from './weather.js'
import { setStillLights } from './pointLights.js'
import { setTownMask } from './townMask.js'
import { PATHS } from './footpaths.js'
import { groundWork, ROSE_RADIUS, TOWER } from './townGround.js'
import * as ballistics from './ballistics.js'
import * as smoke from './smoke.js'

//the towns fade into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	The seaside towns on screen (their layout is townLayout.js's, made with the land: terrain.land.towns), and the landing strip by the
	first of them (terrain.land.strip: its packed earth is part of the ground work), and the footpaths (terrain.land.paths, see
	footpaths.js: a ribbon of earth each, in the ground work too), and the fire tower in the mountains (terrain.land.fireTowers: in
	the ground work, see THE FIRE TOWER).
		THE GROUND WORK		one mesh, in world space, for all of them: the streets (cobbled, the promenade flagged), the lanes and
							the stairs between them, the plaza, the stone walls along the streets and round the plaza, the quay, the
							pier on its posts, and the gas lamps. Made again with every new land
		THE HOUSES			made once (townBuildings.js): each type of building in each of its sizes, a mesh of its own, and drawn
							once for every house of that type and size (instancing), turned and stood where the layout put it,
							in its own colours. Under each, stone footings down to the lowest ground under it. Further off than
							NEAR_HOUSES a house is drawn from its plain version: the same walls and roofs without the small things on them
	All of it with vf_town.js. Each mesh's vertices: where (3), what it is made of, uv (world units), how high over the foot of its wall,
	and whether its pattern is laid out from where it is in the world (1: the footings, which are a stretched box) or its uv (0)

	SHOT: a bullet stops at the first of the same boxes it meets (a house's wall, a street's wall, a lamp).

	THE DAMAGE: each house can be knocked down: its damage goes from 0 (whole) to 1 (down). A shell or a bomb bursting near it (blast:
	shipGuns.js; BURSTS: out to its radius, less the further off it is from the house's walls) and, a little, a bullet in one of its
	walls (DAMAGE.bullet), each the less the bigger the house is (sizeOf: by its volume, against DAMAGE.size). Past DAMAGE.smokeFrom smoke
	comes out of its windows, more and more and darker as it gets worse, and flames with it past DAMAGE.flamesFrom (smoke.js); its plaster,
	trim and roof are scorched darker. At 1 it comes down: a ball of fire (smoke.blast), a ring of dust, a column of smoke going up for
	PLUME.seconds (and a little more smouldering out of the rubble after it, until PLUME.smoulder), and a heap of rubble in its place
	(RUBBLE, stretched to it) that can be walked over (its boxes no higher than RUBBLE_TOP). onCollapse tells the rest (sound.js). It can be
	mended (mendHouse) and put back whole (restoreHouses).
	MULTIPLAYER: the damage is the host's (housesHere: alone or the host): every burst and every bullet it sees, its own, the NPCs' and the
	joiners' (flown there too), counts there; a joiner's own count for nothing at its end. The host sends each house whose damage has
	changed (housesShare), SHARE_SECONDS apart, and all of them to a joiner as it comes in; a joiner's houses are put to it (housesHeard),
	coming down and all as they would have.

	IN THE WAY (boxesNear): what the walker, the horses and the discs bump into, as the trunks and boulders are given (square boxes
	that do not turn): a thin ring of them round every house's walls with a gap at each door, the walls between its rooms (what else is in them: interiors.js), along the
	walls of the streets, under the pier's deck (to stand on), and at each lamp.
	GOING IN: within NEAR_OPEN of the camera a house is drawn from its open version, with the way in cut through it (townBuildings.js), and what is inside is drawn with it (interiors.js).
*/
const NEAR_HOUSES = 520;		// world units
export const NEAR_OPEN = 115;
const WALL = { half: 0.4, step: 0.6, inset: 0.2 };	// a house's walls in the way: a box's half width, how far apart, how far inside the wall
const DRAW_HOUSES = 6000;
// THE DAMAGE (see the top): a burst's radius (metres) and what it does to a house of DAMAGE.size (cubic world units) right by it
const BURSTS = { '80mm': { radius: 8, amount: 0.16 }, 'bomb': { radius: 14, amount: 1.0 } };
const DAMAGE = { bullet: 0.004, size: 1700, smokeFrom: 0.15, flamesFrom: 0.7, near: 2500 };	// near: world units from the camera a house smokes
const WINDOW_SMOKE = [0.6, 7];		// puffs a second out of its windows, just past DAMAGE.smokeFrom and nearly down
const PLUME = { seconds: 70, puffs: 10, smoulder: 240 };
const RUBBLE_TOP = 0.8;				// world units over its floor: the heap's boxes, walked over (as hunting.js's STEP)
const SHARE_SECONDS = 0.5;
const VERTEX_FLOATS = 8;
const INSTANCE_FLOATS = 28;

export const townStats = { towns: 0, houses: 0, groundTriangles: 0, triangles: 0, drawnHouses: 0, boxes: 0, lamps: 0 };

// THE TOWNS' NAMES (the Horde game mode says them, horde.js): one each, from the land's seed, the same on every machine
const NAMES = ['Gullhaven', 'Saltmarsh', 'Kestrel Bay', 'Wrenmouth', 'Port Alder', 'Brinecombe', 'Seacliff', 'Oyster Cove', 'Lanternmouth', 'Driftwick', 'Heronsea', 'Tidewell'];
// (past the twelve, in a world of tiles, terrain.js: a first part and a last of the coast's own, each town's its own pair)
const FIRST_PARTS = ['Gull', 'Salt', 'Kestrel', 'Wren', 'Alder', 'Brine', 'Cliff', 'Oyster', 'Lantern', 'Drift', 'Heron', 'Tide', 'Cormorant', 'Shingle', 'Kelp', 'Pebble', 'Storm', 'Mussel', 'Puffin', 'Fern'];
const LAST_PARTS = ['haven', 'mouth', 'combe', 'wick', 'ness', 'holm', 'stead', 'cove', 'port', 'by', 'sea', 'well', ' Harbour', ' Point', 'ford', 'stone'];
export function townName(index) {
	const first = Math.abs(Math.floor(settings.terrainSeed ?? 0)) % NAMES.length;
	if (index >= NAMES.length) { const k = index - NAMES.length; return FIRST_PARTS[(first + k * 7) % FIRST_PARTS.length] + LAST_PARTS[(first * 3 + k * 5 + Math.floor(k / FIRST_PARTS.length)) % LAST_PARTS.length]; }
	return NAMES[(first + index * 5) % NAMES.length];
}
// the middle of a town (world units: the middle of its houses) and how far its houses go out from it: { x, z, reach }
const middles = new WeakMap();
export function townMiddle(t) {
	let mid = middles.get(t);
	// (a world's town, terrain.js: filled as its tile comes and emptied as it goes, so worked out again then; one not here, about where it is)
	if (!mid || mid.buildings !== t.buildings) {
		const list = t.buildings.filter((b) => !b.onPier), n = Math.max(list.length, 1);
		const x = list.reduce((s, b) => s + b.x, 0) / n, z = list.reduce((s, b) => s + b.z, 0) / n;
		mid = !list.length && t.approx ? { x: t.approx[0], z: t.approx[1], reach: 400 } : { x, z, reach: list.reduce((r, b) => Math.max(r, Math.hypot(b.x - x, b.z - z)), 0) };
		mid.buildings = t.buildings;
		middles.set(t, mid);
	}
	return mid;
}

//-------------------------------MESHES-------------------------------
// a unit box (the footings: stretched to each house), its pattern from the world
const FOOTING = (() => { const m = townMeshBuilder(); m.box(-0.5, 0, -0.5, 0.5, 1, 0.5, MAT.STONE, ['bottom', 'top'], MAT.STONE, 1); return m.done(); })();
// THE RUBBLE (see THE DAMAGE at the top): a heap over a house's footprint (x and z -0.5 to 0.5, stretched to it), up to RUBBLE_HIGH world
//		units in the middle (more for a taller house: up to twice), its plaster and stone in a mound, broken beams and slabs of its roof and
//		blocks of its walls lying on it
const RUBBLE_HIGH = 5;
const RUBBLE = (() => {
	const m = townMeshBuilder(), N = 7;
	let seed = 7;
	const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
	const lumps = Array.from({ length: (N + 1) * (N + 1) }, () => 0.75 + 0.5 * random());
	const at = (i, j) => {
		const x = i / N - 0.5, z = j / N - 0.5, r = Math.min(Math.hypot(x, z) * 2, 1);
		const edge = i == 0 || j == 0 || i == N || j == N;
		return [x, edge ? 0 : (1 - r * r) * RUBBLE_HIGH * lumps[i * (N + 1) + j], z];
	};
	for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
		const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
		m.quad(a, b, c, d, random() < 0.3 ? MAT.STONE : MAT.PLASTER, [[a[0] * 9, a[2] * 9], [b[0] * 9, b[2] * 9], [c[0] * 9, c[2] * 9], [d[0] * 9, d[2] * 9]]);
	}
	// a box turned any way: its middle and its three half axes
	const slab = (c, u, v, w, material) => {
		const p = (a, b, d) => [0, 1, 2].map((k) => c[k] + u[k] * a + v[k] * b + w[k] * d);
		const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
		for (const s of [-1, 1]) {
			m.quad(p(-1, -1, s), p(1, -1, s), p(1, 1, s), p(-1, 1, s), material, uv);
			m.quad(p(s, -1, -1), p(s, 1, -1), p(s, 1, 1), p(s, -1, 1), material, uv);
			m.quad(p(-1, s, -1), p(1, s, -1), p(1, s, 1), p(-1, s, 1), material, uv);
		}
	};
	for (let k = 0; k < 22; k++) {
		const x = (random() - 0.5) * 0.8, z = (random() - 0.5) * 0.8, s = 0.02 + random() * 0.03, up = 0.3 + random() * 0.8;
		const y = (1 - Math.min(Math.hypot(x, z) * 2, 1) ** 2) * RUBBLE_HIGH * 0.9;
		slab([x, y + up * 0.5, z], [s, 0.2 * random(), s * 0.3], [0, up * 0.6, 0], [-s * 0.3, 0.1 * random(), s], k % 3 ? MAT.PLASTER : MAT.STONE);
	}
	for (let k = 0; k < 6; k++) {
		const x = (random() - 0.5) * 0.6, z = (random() - 0.5) * 0.6, a = random() * Math.PI, tilt = 0.25 + random() * 0.5;
		const y = (1 - Math.min(Math.hypot(x, z) * 2, 1) ** 2) * RUBBLE_HIGH * 0.8;
		const along = [Math.cos(a) * Math.cos(tilt) * 0.3, Math.sin(tilt) * 3, Math.sin(a) * Math.cos(tilt) * 0.3];
		if (k < 4) slab([x, y, z], along, [0, 0.25, 0], [-Math.sin(a) * 0.012, 0, Math.cos(a) * 0.012], MAT.TIMBER);
		else slab([x, y + 0.3, z], [Math.cos(a) * 0.16, Math.sin(tilt) * 1.5, Math.sin(a) * 0.16], [-Math.sin(a) * 0.14, 0, Math.cos(a) * 0.14], [0, 0.15, 0], MAT.ROOF);
	}
	return m.done();
})();

//-------------------------------THE GPU-------------------------------
const shaderModule = device.createShaderModule({ label: "vf_town", code: vf_town });
const uniformBuffer = device.createBuffer({ label: "town Uniform", size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const pipeline = device.createRenderPipeline({
	label: "town pipeline",
	layout: 'auto',
	vertex: {
		module: shaderModule,
		entryPoint: "vertexMain",
		buffers: [
			{ arrayStride: VERTEX_FLOATS * 4, attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }, { format: "float32x2", offset: 16, shaderLocation: 1 }, { format: "float32x2", offset: 24, shaderLocation: 9 }] },
			{ arrayStride: INSTANCE_FLOATS * 4, stepMode: 'instance', attributes: [0, 1, 2, 3, 4, 5, 6].map((k) => ({ format: "float32x4", offset: k * 16, shaderLocation: k + 2 })) },
		],
	},
	fragment: { module: shaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: depthTest('less'), format: DEPTH_FORMAT },
});
let bindGroup = null, boundLUT = null;
const meshBuffer = (label, data) => {
	const buffer = device.createBuffer({ label, size: Math.max(data.byteLength, 16), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	if (data.byteLength) device.queue.writeBuffer(buffer, 0, data);
	return { buffer, vertices: data.length / VERTEX_FLOATS };
};

// the houses' meshes, made once: [type][variant] -> { full, plain } (see townBuildings.js)
const HOUSES = buildingMeshes();
const houseBuffers = HOUSES.map((variants, t) => variants.map((mesh, v) => ({ full: meshBuffer(`town ${BUILDING_TYPES[t].name} ${v}`, mesh.full), open: meshBuffer(`town ${BUILDING_TYPES[t].name} ${v} open`, mesh.open), plain: meshBuffer(`town ${BUILDING_TYPES[t].name} ${v} plain`, mesh.plain), height: mesh.height })));
export const HOUSE_TRIANGLES = HOUSES.map((variants) => variants.map((mesh) => ({ full: mesh.full.length / VERTEX_FLOATS / 3, plain: mesh.plain.length / VERTEX_FLOATS / 3 })));
const footingBuffer = meshBuffer('town footing', FOOTING);
const rubbleBuffer = meshBuffer('town rubble', RUBBLE);

let ground = null;			// the ground work's buffer (the home land's)
let groundFor = null;
const tileGrounds = new Map();	// a world of tiles: each other tile's ground work (made with its land, tileWorker.js), by its key
let builtFor = null;		// the land it was made for
// (a world of tiles, terrain.js: made again as a tile with towns comes or goes, the damage kept; and a house's number then its town's
//		place times HOUSE_SLOT and its place in the town, the same whatever else is here. With the one land of old, its place in houses)
const HOUSE_SLOT = 1000;
let rebuildSoon = false;
const byNumber = new Map();		// a house's number -> it
const remembered = new Map();	// a house's number -> its damage, if it is hurt: kept while its tile is not here (and in the save file)
const houseNumbered = (i) => byNumber.get(Number(i));
terrain.onTiles((added, removed) => { if (terrain.tilesHaveTowns([...added, ...removed])) rebuildSoon = true; });
terrain.onWindow(() => { if (terrain.world && builtFor) setTownMask(...windowed(maskOf(terrain.land.towns.filter((t) => t.buildings.length), terrain.land.strip, terrain.land.paths))); });
// (the grass's mask is a window too, in a world of tiles: only what is in it, townMask.js)
function windowed([stretches, boxes]) {
	if (!terrain.world) return [stretches, boxes];
	const W = terrain.landWindow, reach = settings.terrainWorldSize * 0.5 - 64, near = ([x, z]) => Math.abs(x - W.x) < reach && Math.abs(z - W.z) < reach;
	return [stretches.filter((s) => near(s.a) && near(s.b)), boxes.filter((b) => near(b.at))];
}
let houses = [];			// every house: { building, town, matrix, footing (its matrix), height, colours, index, damage, rubble (its heap's matrix),
							//		smokeDue, downAt (seconds, when it came down here), boxes ([first, after]: its in boxes) }
let instanceData = new Float32Array(INSTANCE_FLOATS * 64);
let instanceBuffer = device.createBuffer({ label: "town instances", size: instanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });

//-------------------------------IN THE WAY-------------------------------
const BOX_BUCKET = 64;
let boxes = new Float32Array(0);		// x, z, half, bottom, top
let boxBuckets = new Map();
export function boxesNear(x, z, reach, each) {
	for (let bx = Math.floor((x - reach) / BOX_BUCKET); bx <= Math.floor((x + reach) / BOX_BUCKET); bx++) {
		for (let bz = Math.floor((z - reach) / BOX_BUCKET); bz <= Math.floor((z + reach) / BOX_BUCKET); bz++) {
			const bucket = boxBuckets.get(bx * 100000 + bz);
			if (!bucket) continue;
			for (const at of bucket) {
				const o = at * 5;
				if (Math.abs(boxes[o] - x) > reach + boxes[o + 2] || Math.abs(boxes[o + 1] - z) > reach + boxes[o + 2]) continue;
				each(boxes[o], boxes[o + 1], boxes[o + 2], boxes[o + 3], boxes[o + 4], at);
			}
		}
	}
}
// a bullet's step from a to b against the boxes near it: the first one it goes into (slabs: the line's way in and out of each pair of faces).
//		One of a house's: its damage (see THE DAMAGE at the top: on the host, the joiners' bullets too, remoteToo)
ballistics.addTarget((ax, ay, az, bx, by, bz) => {
	if (boxes.length == 0) return null;
	const dx = bx - ax, dy = by - ay, dz = bz - az;
	let best = null;
	boxesNear((ax + bx) / 2, (az + bz) / 2, Math.hypot(dx, dz) / 2 + 2, (x, z, half, bottom, top, at) => {
		let t0 = 0, t1 = 1;
		for (const [o, d, lo, hi] of [[ax, dx, x - half, x + half], [ay, dy, bottom, top], [az, dz, z - half, z + half]]) {
			if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = 2; break; } continue; }
			let ta = (lo - o) / d, tb = (hi - o) / d;
			if (ta > tb) [ta, tb] = [tb, ta];
			t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
			if (t0 > t1) break;
		}
		if (t0 <= t1 && t0 <= 1 && (!best || t0 < best.t)) {
			const h = houses[boxHouse[at]];
			best = { t: t0, what: 'wall', remoteToo: true, hit: (velocity, bullet) => { if (h && housesHere()) harmHouse(h, DAMAGE.bullet * (ballistics.ROUNDS[bullet?.round]?.damage ?? 1) / sizeOf(h)); } };
		}
	});
	return best;
});
let boxHouse = new Int32Array(0);		// each box's house (its number in houses), or -1
// whether a wall of the towns stands anywhere on the line from a to b (world units): the line taken in lengths of a bucket or so, each against the boxes round it
export function wallOnLine(a, b) {
	const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], n = Math.max(Math.ceil(Math.hypot(d[0], d[2]) / (BOX_BUCKET * 0.6)), 1);
	for (let k = 0; k < n; k++) {
		const s0 = k / n, s1 = (k + 1) / n, ax = a[0] + d[0] * s0, ay = a[1] + d[1] * s0, az = a[2] + d[2] * s0, sx = d[0] / n, sy = d[1] / n, sz = d[2] / n;
		let hit = false;
		boxesNear((ax + a[0] + d[0] * s1) / 2, (az + a[2] + d[2] * s1) / 2, Math.hypot(sx, sz) / 2 + 1, (x, z, half, bottom, top) => {
			if (hit) return;
			let t0 = 0, t1 = 1;
			for (const [o, v, lo, hi] of [[ax, sx, x - half, x + half], [ay, sy, bottom, top], [az, sz, z - half, z + half]]) {
				if (Math.abs(v) < 1e-9) { if (o < lo || o > hi) return; continue; }
				let ta = (lo - o) / v, tb = (hi - o) / v;
				if (ta > tb) [ta, tb] = [tb, ta];
				t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
				if (t0 > t1) return;
			}
			hit = true;
		});
		if (hit) return true;
	}
	return false;
}

// What stands in the way of these houses and towns, made into `into` as { boxes, boxHouse, buckets }: in steps (a generator), the buckets
//		BOX_STEP boxes a step. Nothing it makes is looked at until it is all done and put in the old ones' place (see buildSteps). The
//		boxes of each house and town are kept as they are made, and copied in (houseBoxes, townBoxes)
const BOX_STEP = 20000;
function* makeBoxSteps(houseList, towns, towers = [], groundAt = null, into = {}) {
	const legs = [];
	const add = (x, z, half, bottom, top) => legs.push(x, z, half, bottom, top);
	// (the fire tower's legs)
	for (const [x, z] of towers) {
		const M = settings.forestUnitsPerMetre, y0 = groundAt(x, z);
		for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
			const lx = x + sx * (TOWER.base - 0.3) * M, lz = z + sz * (TOWER.base - 0.3) * M;
			add(lx, lz, 0.25 * M, groundAt(lx, lz) - M, y0 + TOWER.floor * M);
		}
	}
	const parts = [new Float32Array(legs)];
	let count = legs.length / 5;
	for (const h of houseList) {
		const own = h.building.boxList ??= new Float32Array(houseBoxes(h));
		h.boxes = [count, count + own.length / 5];
		count += own.length / 5;
		parts.push(own);
	}
	for (const town of towns) {
		if (town.boxList?.buildings !== town.buildings) town.boxList = { buildings: town.buildings, list: new Float32Array(townBoxes(town)) };
		parts.push(town.boxList.list);
		count += town.boxList.list.length / 5;
	}
	const boxes = new Float32Array(count * 5);
	let at = 0;
	for (const part of parts) { boxes.set(part, at); at += part.length; }
	const boxHouse = new Int32Array(count).fill(-1);
	houseList.forEach((h, i) => { for (let k = h.boxes[0]; k < h.boxes[1]; k++) boxHouse[k] = i; });
	const buckets = new Map();
	for (let k = 0; k < count; k++) {
		const key = Math.floor(boxes[k * 5] / BOX_BUCKET) * 100000 + Math.floor(boxes[k * 5 + 1] / BOX_BUCKET);
		if (!buckets.has(key)) buckets.set(key, []);
		buckets.get(key).push(k);
		if (k % BOX_STEP == BOX_STEP - 1) yield;
	}
	Object.assign(into, { boxes, boxHouse, buckets });
}
// a house's boxes, and a town's own (its walls, its pier and dock, its bridges, its lamps), for makeBoxSteps: x, z, half, bottom, top, one
//		after another. Worked out once for a building and for a town's buildings (the boxes are the same whenever it is made again)
function houseBoxes(h) {
	const list = [];
	const add = (x, z, half, bottom, top) => list.push(x, z, half, bottom, top);
	const b = h.building, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
	// round its walls: small squares along them, a gap at each door
	const plan = planOf(b.type, b.variant ?? 0);
	const hw = b.width / 2 - WALL.inset, hd = b.depth / 2 - WALL.inset, step = WALL.step, half = WALL.half;
	const at = (u, w, bottom, top) => add(b.x + u * c + w * s, b.z - u * s + w * c, half, bottom, top);
	for (let u = -hw; u <= hw + 0.01; u += step) {
		at(u, -hd, b.footing, b.y + h.height);
		if (!plan.doors.some((D) => Math.abs(u - D.x) < D.w / 2 + half)) at(u, hd, b.footing, b.y + h.height);
	}
	for (let w = -hd + step; w <= hd - step + 0.01; w += step) { at(-hw, w, b.footing, b.y + h.height); at(hw, w, b.footing, b.y + h.height); }
	// the walls between its rooms, with their doorways
	for (const [x0, z0, x1, z1] of plan.walls) {
		const n = Math.max(Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step), 1);
		for (let k = 0; k <= n; k++) {
			const u = x0 + (x1 - x0) * k / n, w = z0 + (z1 - z0) * k / n;
			if (plan.gaps.some((g) => g.along == 'x' ? Math.abs(w - g.at) < 0.4 && Math.abs(u - g.c) < g.w / 2 + half : Math.abs(u - g.at) < 0.4 && Math.abs(w - g.c) < g.w / 2 + half)) continue;
			at(u, w, b.y, b.y + plan.ceil);
		}
	}
	// what else it has outside to stand on or walk round (the library's steps, a chapel's tower)
	for (const S of plan.solids) for (let u = S.x0 + 0.4; u <= S.x1; u += 0.7) for (let w = S.z0 + 0.4; w <= S.z1; w += 0.7) add(b.x + u * c + w * s, b.z - u * s + w * c, 0.5, b.footing, b.y + S.top);
	return list;
}
function townBoxes(town) {
	const list = [];
	const add = (x, z, half, bottom, top) => list.push(x, z, half, bottom, top);
	for (const wall of town.walls) {
		for (let j = 0; j < wall.points.length - 1; j++) {
			const [ax, az, at, ab] = wall.points[j], [bx, bz, bt, bb] = wall.points[j + 1];
			const n = Math.max(Math.ceil(Math.hypot(bx - ax, bz - az) / 1.2), 1);
			for (let k = 0; k < n; k++) add(ax + (bx - ax) * k / n, az + (bz - az) * k / n, 0.65, Math.min(ab, bb), at + (bt - at) * k / n);
		}
	}
	for (const pier of [town.pier, town.dock]) {
		if (!pier) continue;
		const { a, b, width } = pier, len = Math.hypot(b[0] - a[0], b[2] - a[2]);
		for (let s = 0; s <= len; s += 2.5) {
			for (const side of [-1, 0, 1]) {
				const ox = -(b[2] - a[2]) / len * side * width / 3, oz = (b[0] - a[0]) / len * side * width / 3;
				add(a[0] + (b[0] - a[0]) * s / len + ox, a[2] + (b[2] - a[2]) * s / len + oz, 1.4, a[1] - 0.6, a[1]);
			}
		}
	}
	for (const b of town.bridges ?? []) {
		// the deck, in squares down its middle (stood on), and its parapets
		const P = b.points;
		for (let j = 0; j < P.length - 1; j++) {
			const [ax, ay, az] = P[j], [bx, by, bz] = P[j + 1], len = Math.hypot(bx - ax, bz - az) || 1;
			const ox = -(bz - az) / len, oz = (bx - ax) / len, n = Math.max(Math.ceil(len / 2.5), 1);
			for (let k = 0; k < n; k++) {
				const f = (k + 0.5) / n, x = ax + (bx - ax) * f, y = ay + (by - ay) * f, z = az + (bz - az) * f;
				add(x, z, b.width * 0.36, y - 1.0, y);
				for (const side of [1, -1]) add(x + ox * side * (b.width / 2 + 0.3), z + oz * side * (b.width / 2 + 0.3), 0.4, y - 1.0, y + 1.1);
			}
		}
	}
	for (const [x, y, z] of town.lamps) add(x, z, 0.35, y, y + 8);
	return list;
}


//-------------------------------EACH NEW LAND-------------------------------
function build() {
	for (const step of buildSteps()) ;		// (all of it now: a new land)
}
// The towns made again, in steps, each of which leaves them as they should be: for a tile come or gone, a step a frame or so (a job:
//		jobs.js, see townUpdate). The ground work of each new tile; the houses and what stands in the way (each house's worked out once,
//		see placeOf and houseBoxes); the grass's mask; the lamps
function* buildSteps() {
	const land = terrain.land;
	if (builtFor !== land) remembered.clear();		// (a new land: none of it hurt)
	builtFor = land;
	rebuildSoon = false;
	const towns = (land.towns ?? []).filter((t) => t.buildings.length);
	// (the home land's made here once a land; each other tile's made with it, off the main thread: tileWorker.js)
	if (!ground || groundFor !== land) {
		const home = terrain.world ? towns.filter((t) => t.tile == '0,0') : towns;
		const work = groundWork(home, settings.waterWorldPosY, land.strip, land.paths, land.groundAt, land.zoneAt, land.fireTowers);
		if (ground) ground.buffer.destroy();
		ground = meshBuffer('town ground work', work.done());
		groundFor = land;
	}
	for (const [key, g] of [...tileGrounds]) if (!terrain.tilesLoaded().some((t) => t.key == key)) { g.buffer.destroy(); tileGrounds.delete(key); }
	for (const t of terrain.tilesLoaded()) {
		if (t.key == '0,0' || !t.land.townGround || tileGrounds.has(t.key)) continue;
		tileGrounds.set(t.key, meshBuffer('town ground work, ' + t.key, t.land.townGround));
		yield;
		if (terrain.land !== land) return;
	}
	townStats.groundTriangles = [ground, ...tileGrounds.values()].reduce((n, g) => n + g.vertices / 3, 0);
	// (a new town's houses worked out first, a town a step: their matrices and their boxes, so the step that makes them all is a quick one)
	for (const town of towns) {
		let fresh = false;
		for (const b of town.buildings) {
			if (b.placed && b.boxList) continue;
			const mesh = houseBuffers[b.type][b.variant ?? 0];
			placeOf(b, mesh);
			b.boxList ??= new Float32Array(houseBoxes({ building: b, height: mesh.height }));
			fresh = true;
		}
		if (town.boxList?.buildings !== town.buildings) { town.boxList = { buildings: town.buildings, list: new Float32Array(townBoxes(town)) }; fresh = true; }
		if (fresh) {
			yield;
			if (terrain.land !== land) return;
		}
	}
	// the houses, and what stands in the way of them, made new beside the old ones (in steps: see makeBoxSteps)
	const made = [], numbered = new Map(), madeBoxes = {};
	for (const town of towns) {
		for (const [k, b] of town.buildings.entries()) {
			const mesh = houseBuffers[b.type][b.variant ?? 0];
			const { matrix, footing, rubble } = placeOf(b, mesh);
			const index = terrain.world ? (town.slot ?? 0) * HOUSE_SLOT + k : made.length;
			made.push({ building: b, town, matrix, footing: b.onPier ? null : footing, height: mesh.height, mesh, index, damage: 0, rubble, smokeDue: 0, downAt: -1, boxes: [0, 0] });		// (the shack stands on its own posts)
			numbered.set(index, made[made.length - 1]);
		}
	}
	for (const step of makeBoxSteps(made, towns, land.fireTowers, land.groundAt, madeBoxes)) {
		yield;
		if (terrain.land !== land) return;
	}
	// and then in the old ones' place, all of it at once. (Made again for a tile that came or went: the damage as it was, the houses here
	//		and those that were)
	const kept = new Map(remembered);
	houses = made;
	byNumber.clear();
	for (const [index, h] of numbered) byNumber.set(index, h);
	boxes = madeBoxes.boxes;
	boxHouse = madeBoxes.boxHouse;
	boxBuckets = madeBoxes.buckets;
	townStats.boxes = boxes.length / 5;
	dirty.clear();
	const needed = (houses.length * 2 + 4) * INSTANCE_FLOATS;
	if (instanceData.length < needed) {
		instanceData = new Float32Array(needed);
		instanceBuffer.destroy();
		instanceBuffer = device.createBuffer({ label: "town instances", size: instanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	}
	// (what the host said of them before they were here, and what they had before they were made again)
	for (const [i, d] of [...kept, ...heard]) if (houseNumbered(i)) setDamage(houseNumbered(i), d, true);
	heard.clear();
	yield;
	if (terrain.land !== land) return;
	setTownMask(...windowed(maskOf(towns, land.strip, land.paths)));
	yield;
	if (terrain.land !== land) return;
	// the lamps light what is round them by night (pointLights.js): from the lantern, warm, about 12 metres out
	setStillLights('town', towns.flatMap((t) => t.lamps.map(([x, y, z]) => ({ at: [x, y + 6.9, z], radius: 22, colour: [1.0, 0.7, 0.4], strength: 4.0 }))));
	townStats.towns = towns.length;
	townStats.houses = houses.length;
	townStats.lamps = towns.reduce((n, t) => n + t.lamps.length, 0);
}

// a house's matrices: where it stands, its footing (the plinth down to the ground) and its heap of rubble. Worked out once for a building
function placeOf(b, mesh) {
	if (!b.placed) {
		const footingHeight = Math.max(b.y - b.footing, 0.5);
		b.placed = {
			matrix: mat4.rotateY(mat4.translation([b.x, b.y, b.z]), b.yaw),
			footing: mat4.scale(mat4.rotateY(mat4.translation([b.x, b.footing, b.z]), b.yaw), [b.width - 0.1, footingHeight + 0.4, b.depth - 0.1]),
			rubble: mat4.scale(mat4.rotateY(mat4.translation([b.x, b.y, b.z]), b.yaw), [b.width, Math.min(Math.max(mesh.height / 14, 0.8), 2), b.depth]),
		};
	}
	return b.placed;
}

// where the grass does not grow (townMask.js): the roads and walls a little wider than they are drawn, under the houses and lamps
function maskOf(towns, strip, paths) {
	const stretches = [], boxes = [];
	// (the footpaths, their edges ragged and a tuft of grass on them here and there; the landing strip's earth, ragged at its edges)
	for (const path of paths ?? []) for (let j = 0; j < path.points.length - 1; j++) stretches.push({ a: [path.points[j][0], path.points[j][2]], b: [path.points[j + 1][0], path.points[j + 1][2]], half: PATHS.half + 0.3, ragged: 0.9, tufts: 0.06 });
	if (strip) boxes.push({ at: [strip.x, strip.z], axis: [strip.ax, strip.az], half: [strip.half + 1, strip.width / 2 + 1], ragged: 9 });
	const along = (points, half) => { for (let j = 0; j < points.length - 1; j++) stretches.push({ a: [points[j][0], points[j][2]], b: [points[j + 1][0], points[j + 1][2]], half }); };
	for (const town of towns) {
		for (const street of town.streets) along(street.points, (street.width + 1.0) / 2 + 0.3);
		for (const lane of town.lanes ?? []) along(lane.points, (lane.width + 0.6) / 2 + 0.3);
		for (const link of town.links) along([link.a, link.b], link.width / 2 + 0.3);
		for (const b of town.bridges ?? []) along(b.points, b.width / 2 + 1.0);
		for (const b of town.beds ?? []) boxes.push({ at: [b.x, b.z], axis: [b.ax, b.az], half: [b.long + 0.2, b.wide + 0.2] });
		for (const [x, , z, size] of town.roses ?? []) boxes.push({ at: [x, z], axis: [1, 0], half: [ROSE_RADIUS * size * 0.8, ROSE_RADIUS * size * 0.8] });
		for (const wall of town.walls) for (let j = 0; j < wall.points.length - 1; j++) stretches.push({ a: wall.points[j].slice(0, 2), b: wall.points[j + 1].slice(0, 2), half: 0.9 });
		if (town.plaza) { const P = town.plaza; boxes.push({ at: [P.x, P.z], axis: [P.tx, P.tz], half: [P.long + 0.3, P.deep + 0.3] }); }
		for (const b of town.buildings) if (!b.onPier) boxes.push({ at: [b.x, b.z], axis: [Math.cos(b.yaw), -Math.sin(b.yaw)], half: [b.width / 2 + 0.2, b.depth / 2 + 0.2] });
		for (const [x, , z] of town.lamps) boxes.push({ at: [x, z], axis: [1, 0], half: [0.5, 0.5] });
	}
	return [stretches, boxes];
}

let lastTime = performance.now();
let building = null;		// the job making the towns again for a tile come or gone, while it is going (see buildSteps)
export function townUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (terrain.land && terrain.land !== builtFor) { const t0 = performance.now(); build(); townStats.buildMs = Math.round(performance.now() - t0); }
	else if (terrain.land && rebuildSoon && !building) building = addJob('the towns, made again', function* () { try { yield* buildSteps(); } finally { building = null; } }, { priority: SEEN });
	if (settings.enableTerrain) burning(dt);
}

// THE DAMAGE (see the top)
//-------------------------------------------------
// whether this machine keeps the houses' damage: alone, or the host (net.js sets townNet.roleNow)
export const townNet = { roleNow: () => 'off' };
export const housesHere = () => townNet.roleNow() != 'joined';
const collapseListeners = [];
// told when a house comes down: fn(where (world units), the house's number)
export function onCollapse(fn) { collapseListeners.push(fn); }
// how hard a house is to knock down: 1 for one of DAMAGE.size, more for a bigger one
function sizeOf(h) {
	const b = h.building;
	return Math.sqrt(Math.min(Math.max(b.width * b.depth * h.height / DAMAGE.size, 0.4), 4));
}
// a shell or a bomb (round) bursting at (world units): every house near it (on the host, or alone)
export function blast(at, round) {
	if (!housesHere() || !houses.length) return;
	const R = BURSTS[round] ?? BURSTS['80mm'], m = settings.forestUnitsPerMetre, reach = R.radius * m;
	for (const h of houses) {
		const b = h.building;
		if (h.damage >= 1 || Math.abs(b.x - at[0]) > reach + b.width + b.depth || Math.abs(b.z - at[2]) > reach + b.width + b.depth) continue;
		// (how far it is from the house's walls: in its own directions)
		const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = at[0] - b.x, dz = at[2] - b.z;
		const u = dx * c - dz * s, w = dx * s + dz * c;
		const d = Math.hypot(Math.max(Math.abs(u) - b.width / 2, 0), Math.max(Math.abs(w) - b.depth / 2, 0), Math.max(b.footing - at[1], at[1] - (b.y + h.height), 0)) / m;
		if (d < R.radius) harmHouse(h, R.amount * (1 - d / R.radius) / sizeOf(h));
	}
}
export function harmHouse(h, amount) { if (amount > 0 && h.damage < 1) setDamage(h, Math.min(h.damage + amount, 1)); }
// mended by so much (0 to 1), if it is still standing
export function mendHouse(h, amount) { if (h.damage > 0 && h.damage < 1) setDamage(h, Math.max(h.damage - amount, 0)); }
// (the save file's: saveGame.js) every house's damage that is not whole, and each put back as it was (one down: its heap, quietly)
export const housesRecord = () => [...remembered].map(([index, d]) => [index, Math.round(d * 1000) / 1000]);
export const housesReady = () => houses.length > 0;
export function housesAdopt(list) {
	for (const [index, d] of list ?? []) {
		const h = houseNumbered(index), damage = Math.min(Math.max(Number(d) || 0, 0), 1);
		if (h) setDamage(h, damage, true);
		else if (damage > 0) remembered.set(Number(index), damage);		// (a house of a tile not here: for when it is)
	}
}
// one that is down built again, whole (townEconomy.js: the works)
export function rebuildHouse(h) { if (h.damage > 0) setDamage(h, 0); }
// every house whole again (a game mode over: horde.js)
export function restoreHouses() { for (const h of houses) if (h.damage > 0) setDamage(h, 0); }
const dirty = new Set();
function setDamage(h, d, quietly = false) {
	const was = h.damage;
	if (d == was) return;
	h.damage = d;
	if (d > 0) remembered.set(h.index, d); else remembered.delete(h.index);
	dirty.add(h.index);
	if (was < 1 && d >= 1) collapse(h, quietly);
	if (was >= 1 && d < 1) { h.downAt = -1; heap(h, false); }
}
// down: its boxes only as high as the heap's, the ball of fire, the dust, the column of smoke (quietly: one that was down already, for
//		a joiner coming in: the heap only)
function collapse(h, quietly) {
	heap(h, true);
	if (quietly) return;
	const b = h.building, m = settings.forestUnitsPerMetre;
	h.downAt = performance.now() / 1000;
	const middle = [b.x, b.y + h.height * 0.35, b.z];
	smoke.blast(middle, 10);
	const reach = Math.max(b.width, b.depth) / 2 / m;
	for (let k = 0; k < 18; k++) {
		const a = k / 18 * Math.PI * 2 + Math.random() * 0.3, speed = 3 + Math.random() * 3;
		smoke.addPuff({ at: [b.x + Math.cos(a) * reach * 0.6 * m, b.y + 0.5 * m, b.z + Math.sin(a) * reach * 0.6 * m], v: [Math.cos(a) * speed, 0.6, Math.sin(a) * speed], size: 1.6 + Math.random(),
			grow: 2.6, life: 5 + Math.random() * 2, kind: 2, rise: 0.05, delay: 0.1 });
	}
	for (const fn of collapseListeners) fn(middle, h.index);
}
function heap(h, down) {
	const b = h.building;
	for (let k = h.boxes[0]; k < h.boxes[1]; k++) boxes[k * 5 + 4] = down ? b.y + RUBBLE_TOP : b.y + h.height;
}
// each frame: smoke out of the windows of the houses that are hurt, the columns over the ones that are down (only near the camera)
function burning(dt) {
	const m = settings.forestUnitsPerMetre, now = performance.now() / 1000;
	for (const h of houses) {
		if (h.damage < DAMAGE.smokeFrom) continue;
		const b = h.building;
		if (Math.abs(b.x - settings.camPosX) > DAMAGE.near || Math.abs(b.z - settings.camPosZ) > DAMAGE.near) continue;
		if (h.damage >= 1) {
			const t = now - h.downAt;
			if (h.downAt < 0 || t > PLUME.smoulder) continue;
			const plume = t < PLUME.seconds;
			h.smokeDue += dt * (plume ? PLUME.puffs * (1 - 0.6 * t / PLUME.seconds) : 0.7);
			for (; h.smokeDue >= 1; h.smokeDue--) {
				const u = (Math.random() - 0.5) * 0.6 * b.width, w = (Math.random() - 0.5) * 0.6 * b.depth, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
				smoke.addPuff({ at: [b.x + u * c + w * s, b.y + 2 * m, b.z - u * s + w * c], v: [0, plume ? 3 : 1, 0], size: plume ? 1.6 + Math.random() * 0.8 : 0.8, grow: plume ? 3 : 2.5,
					life: plume ? 12 + Math.random() * 6 : 7, kind: 1, dark: plume ? 0.6 : 0.4, rise: plume ? 1.5 : 0.5 });
			}
			continue;
		}
		const worse = (h.damage - DAMAGE.smokeFrom) / (1 - DAMAGE.smokeFrom);
		h.smokeDue += dt * (WINDOW_SMOKE[0] + (WINDOW_SMOKE[1] - WINDOW_SMOKE[0]) * worse);
		for (; h.smokeDue >= 1; h.smokeDue--) {
			const [at, out] = windowOf(h);
			const flame = h.damage > DAMAGE.flamesFrom && Math.random() < 0.3;
			smoke.addPuff(flame ? { at, v: out.map((v, i) => v * 0.6 + (i == 1 ? 0.8 : 0)), size: 0.5 + Math.random() * 0.3, grow: 1.6, life: 0.9, kind: 0, rise: 1.5 }
				: { at, v: out.map((v, i) => v * 1.2 + (i == 1 ? 0.8 : 0)), size: 0.6 + 0.6 * worse, grow: 3.5, life: 10 + Math.random() * 4, kind: 1, dark: 0.3 + 0.55 * worse, rise: 1.4 });
		}
	}
}
// a window of a house, at random: where, just outside it (world units), and the way out of it. On every face, at each storey up its walls
//		(as townBuildings.js lays them out: bays along the face, a sill a storey)
function windowOf(h) {
	const b = h.building, m = settings.forestUnitsPerMetre;
	const storeys = Math.max(Math.floor((h.height - GROUND_FLOOR) / FLOOR_HEIGHT) + 1, 1);
	const storey = Math.floor(Math.random() * storeys), y = (storey == 0 ? 1.8 : GROUND_FLOOR + (storey - 1) * FLOOR_HEIGHT + 1.5) + 1.6;
	const face = Math.floor(Math.random() * 4), long = face < 2 ? b.width : b.depth, deep = face < 2 ? b.depth : b.width;
	const along = (Math.random() - 0.5) * Math.max(long - 2.4, 0.5), side = face % 2 ? 1 : -1;
	const [u, w, nu, nw] = face < 2 ? [along, side * (deep / 2 + 0.4), 0, side] : [side * (deep / 2 + 0.4), along, side, 0];
	const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
	return [[b.x + u * c + w * s, b.y + Math.min(y, h.height - 1), b.z - u * s + w * c], [nu * c + nw * s, 0, -nu * s + nw * c]];
}
// MULTIPLAYER (see the top): the host's houses whose damage has changed since the last (all: every one that is hurt), [number, damage]
export function housesShare(all = false) {
	const list = all ? houses.filter((h) => h.damage > 0).map((h) => h.index) : [...dirty];
	if (!all) dirty.clear();
	return list.filter((i) => houseNumbered(i)).map((i) => [i, Math.round(houseNumbered(i).damage * 1000) / 1000]);
}
// a joiner: the host's word on them
const heard = new Map();		// (before its houses are built: kept until they are)
export function housesHeard(list, all = false) {
	if (!houses.length) { for (const [i, d] of list) heard.set(i, d); return; }
	if (all) for (const h of houses) if (h.damage > 0 && !list.some(([i]) => i == h.index)) setDamage(h, 0);
	for (const [i, d] of list) if (houseNumbered(i)) setDamage(houseNumbered(i), Math.min(Math.max(Number(d) || 0, 0), 1), all);
}

//-------------------------------DRAWING-------------------------------
// how far the tulips and the roses are in flower (0 to 1): the tulips through the spring into the start of the summer, the roses from
//		the end of the spring until well into the autumn. And how far up the tulips are (they come up early in the spring, and are gone
//		by the middle of the summer)
function flowering() {
	const { index, progress } = seasonNow, s = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
	const tulips = index == SEASON_SPRING ? s(0.1, 0.35, progress) : index == SEASON_SUMMER ? 1 - s(0.05, 0.3, progress) : 0;
	const up = index == SEASON_SPRING ? s(0.0, 0.12, progress) : index == SEASON_SUMMER ? 1 - s(0.3, 0.55, progress) : 0;
	const roses = index == SEASON_SPRING ? s(0.6, 0.95, progress) : index == SEASON_SUMMER ? 1 : index == SEASON_FALL ? 1 - s(0.3, 0.8, progress) : 0;
	return [tulips, roses, up];
}
const IDENTITY = mat4.identity();
const NEUTRAL = [0.9, 0.85, 0.75, 0.5, 0.6, 0.3, 0.2, 0, 0.9, 0.9, 0.9, 0];
const startSeconds = performance.now() / 1000;
// with the solid things
export function townPass(aEncoder, mainpassDepthTexture) {
	if (!ground || (ground.vertices == 0 && houses.length == 0 && !tileGrounds.size) || !settings.enableTerrain) return;
	const light = lightNow();
	const u = new Float32Array(32);
	u.set(transformations.getViewProj(), 0);
	u.set([settings.camPosX, settings.camPosY, settings.camPosZ, 0], 16);
	u.set([settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, performance.now() / 1000 - startSeconds, 1 - light.daylight], 20);
	const [tulips, roses, up] = flowering();
	u.set([tulips, roses, weatherNow.snowCover ?? 0, seasonNow.autumn ?? 0], 24);
	u.set([up, 0, 0, 0], 28);
	device.queue.writeBuffer(uniformBuffer, 0, u);
	if (!bindGroup || boundLUT !== skyViewLUTtexture) {
		boundLUT = skyViewLUTtexture;
		bindGroup = device.createBindGroup({
			label: "town bind group",
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: { buffer: uniformBufferLights } },
				{ binding: 2, resource: skyViewLUTtexture.createView() },
				{ binding: 3, resource: linSampler },
			],
		});
	}
	// the instances: the ground work's one, then the houses near and far grouped by their mesh, then their footings
	let count = 0;
	// (scorched: its colours darker by so much)
	const put = (matrix, b, scorched = 0) => {
		const k = 1 - scorched, dark = (c) => c.map((v) => v * k);
		instanceData.set(matrix, count * INSTANCE_FLOATS);
		instanceData.set(b ? [...dark(b.plaster), b.seed, ...dark(b.roof), b.footing + 1.5, ...dark(b.trim), b.onPier ? 0 : 1] : NEUTRAL, count * INSTANCE_FLOATS + 16);
		return count++;
	};
	const scorchOf = (h) => h.damage >= 1 ? 0.45 : 0.5 * Math.min(Math.max((h.damage - 0.35) / 0.65, 0), 1);
	put(IDENTITY, null);
	const groups = new Map();		// mesh buffer -> [first instance, count]
	const visible = [];
	for (const h of houses) {
		const away = Math.hypot(h.building.x - settings.camPosX, h.building.z - settings.camPosZ);
		if (away > DRAW_HOUSES) continue;
		const mesh = h.damage >= 1 ? rubbleBuffer : away < NEAR_OPEN ? h.mesh.open : away < NEAR_HOUSES ? h.mesh.full : h.mesh.plain;
		if (!groups.has(mesh)) groups.set(mesh, []);
		groups.get(mesh).push(h);
		visible.push(h);
	}
	const draws = [];
	for (const [mesh, list] of groups) {
		const first = count;
		for (const h of list) put(h.damage >= 1 ? h.rubble : h.matrix, h.building, scorchOf(h));
		draws.push([mesh, first, list.length]);
	}
	const firstFooting = count;
	const footed = visible.filter((h) => h.footing);
	for (const h of footed) put(h.footing, h.building);
	townStats.drawnHouses = visible.length;
	device.queue.writeBuffer(instanceBuffer, 0, instanceData, 0, count * INSTANCE_FLOATS);

	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{ view: frameTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Towns', 'vf_town'),
	});
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup);
	pass.setVertexBuffer(1, instanceBuffer);
	let triangles = 0;
	for (const g of [ground, ...tileGrounds.values()]) if (g.vertices) { pass.setVertexBuffer(0, g.buffer); pass.draw(g.vertices, 1, 0, 0); triangles += g.vertices / 3; }
	for (const [mesh, first, n] of draws) {
		if (!mesh.vertices) continue;
		pass.setVertexBuffer(0, mesh.buffer);
		pass.draw(mesh.vertices, n, 0, first);
		triangles += mesh.vertices / 3 * n;
	}
	if (footed.length) {
		pass.setVertexBuffer(0, footingBuffer.buffer);
		pass.draw(footingBuffer.vertices, footed.length, 0, firstFooting);
		triangles += footingBuffer.vertices / 3 * footed.length;
	}
	pass.end();
	townStats.triangles = triangles;
}

// what stands over a place, for the picture from above (skyCover.js): every house within reach, as { buffer, vertices, matrix }, and if there is one, the
//		ground work (the pier and the bridges are in it)
export function coverDraws(x, z, reach) {
	const list = [];
	for (const h of houses) {
		const b = h.building;
		if (h.damage >= 1 || Math.abs(b.x - x) > reach + b.width || Math.abs(b.z - z) > reach + b.width) continue;
		list.push({ buffer: h.mesh.full.buffer, vertices: h.mesh.full.vertices, matrix: h.matrix });
	}
	if (list.length) for (const g of [ground, ...tileGrounds.values()]) if (g?.vertices) list.push({ buffer: g.buffer, vertices: g.vertices, matrix: IDENTITY });
	return list;
}
// every house, as they are kept here (interiors.js)
export const houseList = () => houses;
// for testing: every house, where it is and what
export function townHouses() {
	return houses.map((h) => ({ type: BUILDING_TYPES[h.building.type].name, variant: h.building.variant, x: h.building.x, y: h.building.y, z: h.building.z, yaw: h.building.yaw, footing: h.building.footing, height: h.height, width: h.building.width, depth: h.building.depth, damage: h.damage, town: h.town }));
}
export const houseForTest = (i) => houseNumbered(i) ?? houses[i];
// a town's houses (not the shack on the pier), as they are kept here: { building, height, damage, index, ... } (war.js)
export function housesOf(t) { return houses.filter((h) => h.town === t && !h.building.onPier); }
export function damageForTest(i, d) { const h = houseNumbered(i) ?? houses[i]; if (h) setDamage(h, d); }
