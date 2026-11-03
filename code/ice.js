import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as props from './props.js'
import { seasonNow, weatherNow } from './weather.js'

/*
	THE PONDS FROZEN, in the winter (weather.js: seasonNow.ice, going on through the first of the winter and off through the first of the spring). The land's lake zone is cut into CELL metre squares,
	and each knows how far it is from the shore of its pond as a share of the furthest of that pond (shore): the ice comes in from the banks, and goes back to them, as seasonNow.ice passes that.
	A square frozen is a sheet (iceTile: props, drawn near the camera; the snow lying on it drifts across them all: vf_props.js) a little over the water (OVER), the land's banks standing up through it, and a floor to walk on
	(hunting.js: addFloor). Everything about it comes of the world's clock and the land, which everyone has, so there is nothing about it to send.
*/
const CELL = 8;				// metres
const OVER = 0.14;			// metres over the water
const DRAW = 420;			// metres
const SOLID = 0.2;			// the share of seasonNow.ice that even the shore's squares wait for: it has to bear

const metre = () => settings.forestUnitsPerMetre;
let builtFor = null, cells = new Map();		// 'i,j' -> { x, z, shore, hue }
export const iceStats = { cells: 0, drawn: 0 };
const keyOf = (i, j) => i * 100000 + j;

function build() {
	builtFor = terrain.land;
	cells = new Map();
	for (const here of terrain.landsHere()) buildOf(here.land, here.key);
	iceStats.cells = cells.size;
}
// (in a world of tiles, terrain.js: each tile of land's ponds, round its own middle, made as it comes and gone with it; a pond is never on two)
terrain.onTiles((added, removed) => {
	if (builtFor !== terrain.land) return;
	for (const [key, c] of [...cells]) if (removed.includes(c.tile)) cells.delete(key);
	for (const here of terrain.landsHere()) if (added.includes(here.key)) buildOf(here.land, here.key);
	iceStats.cells = cells.size;
});
function buildOf(here, tile) {
	const land = terrain.land;
	const m = metre(), size = CELL * m, half = settings.terrainWorldSize / 2, sea = settings.waterWorldPosY, n = Math.ceil(half / size);
	const wet = new Map();
	const [ci, cj] = (here.center ?? [0, 0]).map((v) => Math.round(v / size));
	for (let i = ci - n; i <= ci + n; i++) for (let j = cj - n; j <= cj + n; j++) {
		const x = (i + 0.5) * size, z = (j + 0.5) * size;
		if (here.zoneAt(x, z) != terrain.ZONE_LAKE) continue;
		// (a square with any of its water under it)
		if ([[0, 0], [-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]].some(([a, b]) => land.heightAt(x + a * size, z + b * size) < sea)) wet.set(keyOf(i, j), { i, j, x, z, d: Infinity });
	}
	// how far in from the shore: out in steps from every square with a side that is not water, pond by pond
	const near = ([i, j]) => [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]];
	let front = [];
	for (const c of wet.values()) if (near([c.i, c.j]).some(([a, b]) => !wet.has(keyOf(a, b)))) { c.d = 0; front.push(c); }
	for (let d = 1; front.length; d++) {
		const next = [];
		for (const c of front) for (const [a, b] of near([c.i, c.j])) { const o = wet.get(keyOf(a, b)); if (o && o.d == Infinity) { o.d = d; next.push(o); } }
		front = next;
	}
	const seen = new Set();
	for (const start of wet.values()) {
		if (seen.has(start)) continue;
		const pond = [start];
		seen.add(start);
		let most = 0;
		for (let k = 0; k < pond.length; k++) {
			most = Math.max(most, pond[k].d);
			for (const [a, b] of near([pond[k].i, pond[k].j])) { const o = wet.get(keyOf(a, b)); if (o && !seen.has(o)) { seen.add(o); pond.push(o); } }
		}
		for (const c of pond) cells.set(keyOf(c.i, c.j), { x: c.x, z: c.z, shore: c.d / (most + 1), tile });
	}
}
const frozen = (c) => seasonNow.ice > SOLID + (1 - SOLID) * c.shore;
// the top of the ice at (x, z), or null: open water, or no pond
export function iceAt(x, z) {
	if (!seasonNow.ice || !terrain.land) return null;
	if (builtFor !== terrain.land) build();
	const size = CELL * metre(), c = cells.get(keyOf(Math.floor(x / size), Math.floor(z / size)));
	return c && frozen(c) ? settings.waterWorldPosY + OVER * metre() : null;
}
hunting.addFloor((x, z) => iceAt(x, z) ?? -Infinity);

export function iceUpdate() {
	iceStats.drawn = 0;
	if (!seasonNow.ice || !terrain.land) return;
	if (builtFor !== terrain.land) build();
	const m = metre(), y = settings.waterWorldPosY + OVER * m, reach = DRAW * m, cx = settings.camPosX, cz = settings.camPosZ, snow = weatherNow.snowCover ?? 0;
	for (const c of cells.values()) {
		if (Math.abs(c.x - cx) > reach || Math.abs(c.z - cz) > reach || !frozen(c)) continue;
		props.show('iceTile', props.place([c.x, y, c.z], 0, 0, 0, CELL), undefined, [0, 0, snow, 0]);
		iceStats.drawn++;
	}
}
export const iceForTest = () => ({ ...iceStats, ice: seasonNow.ice, some: [...cells.values()].slice(0, 400).sort((a, b) => b.shore - a.shore)[0] ?? null });
