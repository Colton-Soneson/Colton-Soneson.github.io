import {device} from './deviceSelection.js'

import { settings } from './settings.js';

/*
	Where the grass does not grow in a town: on its streets, lanes, stairs and walls, the plaza, and under its houses and lamps (and on
	the landing strip's earth and the footpaths, out of the towns). A
	town is grassland (see terrain.js), but the grass only knows the land's own grid, far too coarse for a street, so the town gives
	it the shapes themselves (town.js, with every new land), sorted into a grid of the world CELL across, each cell knowing its own
	(as the still lights in pointLights.js). The grass's vertex shader looks a blade up in it (onTownWork in vfc_grass.js).
		a stretch		{ a: [x, z], b: [x, z], half, ragged, tufts }: within half of the line from a to b (a street, a lane, a wall). ragged
						(optional): its edge goes in by up to this much, in and out along it; tufts (optional): the share of it where a tuft of
						grass comes up anyway (a footpath's)
		a box			{ at: [x, z], axis: [x, z] (a unit line along its width), half: [width, depth], ragged } (a house, the plaza, a lamp;
						the landing strip, ragged)
	On the GPU: cells (a vec2u each: where its list starts, how long it is), list (item numbers), items (two vec4f each, after a
	first one of half the world, CELL and the cells along a side: 0 with no towns, and nothing is looked up)
	On the CPU (onTownWork: sound.js, the grass underfoot): the same shapes in the same cells, their ragged edges taken halfway in.
*/
const CELL = 32;

export let townMaskBuffers = null;		// { cells, list, items }
export const townMaskStats = { items: 0, cells: 0 };

export function setTownMask(stretches, boxes) {
	const count = stretches.length + boxes.length;
	const half = settings.terrainWorldSize * 0.5, along = count ? Math.ceil(settings.terrainWorldSize / CELL) : 0;
	const items = new Float32Array(4 + count * 8);
	items.set([half, CELL, along, 0], 0);
	const inCell = new Map();
	const sort = (k, x0, z0, x1, z1) => {
		const c0 = Math.max(Math.floor((x0 + half) / CELL), 0), c1 = Math.min(Math.floor((x1 + half) / CELL), along - 1);
		const r0 = Math.max(Math.floor((z0 + half) / CELL), 0), r1 = Math.min(Math.floor((z1 + half) / CELL), along - 1);
		for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
			const key = r * along + c;
			if (!inCell.has(key)) inCell.set(key, []);
			inCell.get(key).push(k);
		}
	};
	stretches.forEach(({ a, b, half: h, ragged = 0, tufts = 0 }, k) => {
		items.set([a[0], a[1], b[0], b[1], h, ragged, 0, tufts], 4 + k * 8);
		sort(k, Math.min(a[0], b[0]) - h, Math.min(a[1], b[1]) - h, Math.max(a[0], b[0]) + h, Math.max(a[1], b[1]) + h);
	});
	boxes.forEach(({ at, axis, half: [w, d], ragged = 0 }, j) => {
		const k = stretches.length + j, reach = Math.hypot(w, d);
		items.set([at[0], at[1], axis[0], axis[1], w, d, 1, ragged], 4 + k * 8);
		sort(k, at[0] - reach, at[1] - reach, at[0] + reach, at[1] + reach);
	});
	// (on the CPU: each item a test of a place)
	const tests = [
		...stretches.map(({ a, b, half: h, ragged = 0 }) => (x, z) => {
			const abx = b[0] - a[0], abz = b[1] - a[1], t = Math.min(Math.max(((x - a[0]) * abx + (z - a[1]) * abz) / Math.max(abx * abx + abz * abz, 1e-6), 0), 1);
			return Math.hypot(x - a[0] - abx * t, z - a[1] - abz * t) < h - ragged / 2;
		}),
		...boxes.map(({ at, axis, half: [w, d], ragged = 0 }) => (x, z) => {
			const dx = x - at[0], dz = z - at[1];
			return Math.abs(dx * axis[0] + dz * axis[1]) < w - ragged / 2 && Math.abs(-dx * axis[1] + dz * axis[0]) < d - ragged / 2;
		}),
	];
	cpu = { half, along, cells: new Map([...inCell].map(([key, members]) => [key, members.map((k) => tests[k])])) };
	const cells = new Uint32Array(Math.max(along * along, 1) * 2);
	const list = [];
	for (const [key, members] of inCell) { cells[key * 2] = list.length; cells[key * 2 + 1] = members.length; list.push(...members); }
	if (townMaskBuffers) for (const b of Object.values(townMaskBuffers)) b.destroy();
	const storage = (label, data) => { const b = device.createBuffer({ label, size: Math.max(data.byteLength, 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
	townMaskBuffers = { cells: storage("town mask cells", cells), list: storage("town mask lists", new Uint32Array(list.length ? list : [0])), items: storage("town mask items", items) };
	townMaskStats.items = count;
	townMaskStats.cells = inCell.size;
}
// whether a place (world units) is on a town's streets, lanes, stairs or walls, or under one of its houses (see the top)
let cpu = { half: 0, along: 0, cells: new Map() };
export function onTownWork(x, z) {
	const { half, along, cells } = cpu;
	if (!along) return false;
	const c = Math.floor((x + half) / CELL), r = Math.floor((z + half) / CELL);
	if (c < 0 || r < 0 || c >= along || r >= along) return false;
	return (cells.get(r * along + c) ?? []).some((test) => test(x, z));
}
setTownMask([], []);
