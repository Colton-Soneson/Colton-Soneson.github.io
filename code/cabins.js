import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import * as props from './props.js'
import * as smoke from './smoke.js'
import * as forest from './forest.js'
import * as boulders from './boulders.js'
import * as weapons from './weapons.js'
import * as transformations from './transformations.js'
import * as skyCover from './skyCover.js'
import * as survivalNet from './survivalNet.js'
import { setGrassHoles } from './computeGrass.js'
import { CUBE, CUBE_UP, PORCH } from './workMeshes.js'
import { ITEMS, makeItem, cleanItem } from './items.js'
import * as inventory from './inventory.js'
import * as survival from './survival.js'
import * as loot from './loot.js'
import * as bedrolls from './bedrolls.js'
import * as stations from './stations.js'
import * as farms from './farms.js'
import * as journal from './journalUI.js'

/*
	THE CABINS of the Survival mode: Nordic cabins of dark boards and battens under a green metal roof, built of prefabricated rooms on a grid of cubes (CUBE metres across, CUBE_UP high), planned in the build journal.
	THE BUILD JOURNAL (T: its own place on the wheel; held, left click: its page, plan): choose a MAIN ROOM (MAINS: cubes across, deep and high; more of them, more wood and nails), and the page shuts. A foundation is laid out in front on the ground, turned by quarters so its door faces the walker
	(R turns it, left click drives the stakes in, right click thinks better of it). It wants level, clear ground: no trees, no boulders, no water, no town. It is all on a grid of the world's quarter turns, so its walls run true for the walker to walk into (hunting.js: boxes with a halfZ).
	Held and looked at a main room built, the page is its plan from above instead: choose a ROOM (ROOMS: a cube each) and a square round it, and its foundation goes there. It joins by an opening through the wall. Squares that cannot take one: the one with the door and the one at the fireplace.
	WHAT IT TAKES: each wants what its walls take (MAINS, ROOMS: wood, nails) and what goes in it (FURNISHED: as these things cost to make). Stakes and twine mark it until then: E at them puts in whatever of that is carried (hide: any). F takes up a foundation not yet built, and gives it all back.
	Once it has it all, it stands. Every room comes with what is in it: a main room a bedroll, a chest and a fireplace (stations.js); a bedroom two bedrolls and two big chests; a kitchen a cauldron and a mortar; a workshop an anvil and a smelter. E sleeps on a bedroll (bedrolls.js), the chests are loot.js's containers.
	IN A GAME (survivalNet.js) the host keeps them all: a joiner asks (cabinFound, roomFound, cabinGive: anything it would not take, cabinBack; cabinTakeUp: cabinBack), everyone is told of each as it is (cabinIs, cabinDel), and a joiner come in, of all of them.
	SAVED: the host's are kept in its browser (SAVED), for the land's seed, and so are its work stations and farm beds, and what is in the chests.
*/
const SAVED = 'survivalWorld';
export const MAINS = {
	main322: { name: 'Long hall', w: 3, d: 2, h: 2, wood: 30, nails: 60 },
	main312: { name: 'Narrow hall', w: 3, d: 1, h: 2, wood: 16, nails: 32 },
	main221: { name: 'Small cabin', w: 2, d: 2, h: 1, wood: 12, nails: 24 },
};
const MAIN_THINGS = { hide: 1, firewood: 6, nails: 6, rock: 6 };						// what is in one: its bedroll, chest, fireplace
export const ROOMS = {
	bedroom: { name: 'Bedroom', wood: 6, nails: 12, things: { hide: 2, firewood: 16, nails: 24 }, detail: 'Two bedrolls, two big chests' },
	kitchen: { name: 'Kitchen, medicine and alchemy', wood: 6, nails: 12, things: { ironBar: 2, rock: 2, firewood: 1 }, detail: 'A cauldron, a mortar and pestle' },
	workshop: { name: 'Workshop', wood: 6, nails: 12, things: { ironBar: 3, rock: 3 }, detail: 'An anvil, a smelter' },
};
const HIDES = ['deerHide', 'mooseHide', 'bearHide'];
const PITCH = 0.62;					// a roof's rise over its run
const EAVE = 0.55;					// metres a roof comes out past its wall
const FLOOR_OVER = 0.35;			// metres the floor stands over the highest ground under it
const LEVEL = 2.4;					// metres the ground may rise across a foundation
const AHEAD = 3.2;					// metres from the walker to the foundation's front
const REACH = 5, DRAW = 620, DRAW_INSIDE = 70;	// metres
const CHEST = { small: 1, big: 1.35 };
const INDOORS = [1, 0, 0, 0];

const metre = () => settings.forestUnitsPerMetre;
const cabins = new Map();			// id -> { id, at: [x, y (its floor), z], low (the lowest ground under it), turn (quarters), style, stock, built, rooms: [{ i, j, type, stock, built, low }], porch }
export const cabinStats = { founded: 0, rooms: 0, built: 0 };

// ITS GRID: square (i, j) of a main room (0 to w, 0 to d: j towards its front, +z), in its own metres. The squares round it are the ones a room goes on. The door is on the front, DOOR_I
const doorI = (M) => Math.floor(M.w / 2);
const FIRE_I = 0;					// the fireplace is on the back wall of the first column
const mid = (M, i, j) => [(i + 0.5 - M.w / 2) * CUBE, (j + 0.5 - M.d / 2) * CUBE];
// out from the main room: which way a square round it lies. null: not one
function sideOf(M, i, j) {
	if (i >= 0 && i < M.w && j == -1) return i == FIRE_I ? null : [0, -1];
	if (i >= 0 && i < M.w && j == M.d) return i == doorI(M) ? null : [0, 1];
	if (j >= 0 && j < M.d && i == -1) return [-1, 0];
	if (j >= 0 && j < M.d && i == M.w) return [1, 0];
	return null;
}
export const slotsOf = (M) => { const out = []; for (let i = -1; i <= M.w; i++) for (let j = -1; j <= M.d; j++) if (sideOf(M, i, j)) out.push([i, j]); return out; };
const headingOf = ([dx, dz]) => Math.atan2(dx, dz);
// a place in a cabin's own metres (its floor at y = 0), in the world
function worldOf(c, x, y, z) {
	const m = metre(), h = c.turn * Math.PI / 2, co = Math.round(Math.cos(h)), si = Math.round(Math.sin(h));
	return [c.at[0] + (x * co + z * si) * m, c.at[1] + y * m, c.at[2] + (-x * si + z * co) * m];
}
const headingIn = (c, h) => c.turn * Math.PI / 2 + h;
// what a room or a hall wants, all told
function needOf(style) {
	const M = MAINS[style], R = ROOMS[style], base = M ? { firewood: M.wood, nails: M.nails } : { firewood: R.wood, nails: R.nails };
	const out = { ...base };
	for (const [k, n] of Object.entries(M ? MAIN_THINGS : R.things)) out[k] = (out[k] ?? 0) + n;
	return out;
}
export const needFor = needOf;
const nameOfNeed = (k) => k == 'hide' ? 'hide (deer, moose or bear)' : ITEMS[k]?.name.toLowerCase() ?? k;
const shareRoom = (r) => ({ i: r.i, j: r.j, type: r.type, stock: r.stock, built: r.built, low: r.low });
const share = (c) => ({ id: c.id, at: c.at, low: c.low, turn: c.turn, style: c.style, stock: c.stock, built: c.built, rooms: c.rooms.map(shareRoom) });
function told(c) { survivalNet.send('cabinIs', { c: share(c) }); changed(); saveSoon(); }
const cleanCabin = (raw) => ({ id: String(raw.id), at: raw.at.map(Number), low: Number(raw.low) || 0, turn: Number(raw.turn) & 3, style: MAINS[raw.style] ? raw.style : 'main221', stock: raw.stock ?? {}, built: !!raw.built, rooms: (raw.rooms ?? []).filter((r) => ROOMS[r.type]).map((r) => ({ i: r.i | 0, j: r.j | 0, type: r.type, stock: r.stock ?? {}, built: !!r.built, low: Number(r.low) || 0 })) });
survivalNet.on('cabinIs', (m) => { if (!survivalNet.authority() && m.c && Array.isArray(m.c.at)) { cabins.set(String(m.c.id), cleanCabin(m.c)); changed(); } });
survivalNet.on('cabinDel', (m) => { if (!survivalNet.authority()) { cabins.delete(String(m.id)); changed(); } });
survivalNet.onJoin((id) => { for (const c of cabins.values()) survivalNet.sendTo(id, 'cabinIs', { c: share(c) }); });

function changed() {
	setGrassHoles('cabins', [...cabins.values()].flatMap(holesOf));
	shapes.clear();
	hunting.regather();
	journal.refreshMenu();
}
// where the grass does not grow: under what is built or marked out
function holesOf(c) {
	const M = MAINS[c.style], list = [];
	const rect = (x, z, hx, hz) => { const [wx, , wz] = worldOf(c, x, 0, z), turned = c.turn % 2 == 1, m = metre(); list.push([wx, wz, (turned ? hz : hx) * m, (turned ? hx : hz) * m]); };
	rect(0, 0, M.w * CUBE / 2 + 0.2, M.d * CUBE / 2 + 0.2);
	if (c.built) rect((doorI(M) + 0.5 - M.w / 2) * CUBE, M.d * CUBE / 2 + PORCH / 2 + 0.5, CUBE / 2, PORCH / 2 + 0.6);
	for (const r of c.rooms) { const [x, z] = mid(M, r.i, r.j); rect(x, z, CUBE / 2 + 0.2, CUBE / 2 + 0.2); }
	return list;
}

// CAN IT GO THERE (see the top): the ground under a rectangle in the world: { low, high }, or a word on why not
function groundFor(cx, cz, hx, hz) {
	const land = terrain.land, m = metre();
	let low = Infinity, high = -Infinity;
	for (let a = -1; a <= 1.001; a += 0.5) for (let b = -1; b <= 1.001; b += 0.5) {
		const x = cx + a * hx * m, z = cz + b * hz * m, y = land.heightAt(x, z);
		if (y < settings.waterWorldPosY + 0.3 * m) return 'Not in the water';
		if (land.zoneAt(x, z) == terrain.ZONE_TOWN) return 'Not in the town';
		low = Math.min(low, y); high = Math.max(high, y);
	}
	if (high - low > LEVEL * m) return 'The ground is not level enough';
	let blocked = null;
	const inside = (x, z, half) => Math.abs(x - cx) < hx * m + half && Math.abs(z - cz) < hz * m + half;
	forest.trunksNear(cx, cz, (Math.max(hx, hz) + 2) * m * 1.5, (x, z, half) => { if (inside(x, z, half)) blocked = 'Trees in the way: fell them first'; });
	boulders.bouldersNear(cx, cz, (Math.max(hx, hz) + 2) * m * 1.5, (x, z, half) => { if (inside(x, z, half)) blocked = 'A boulder in the way'; });
	for (const c of cabins.values()) if (footprintsOf(c).some(([x, z, a, b]) => Math.abs(x - cx) < (a + hx) * m && Math.abs(z - cz) < (b + hz) * m)) blocked = 'Too close to a cabin';
	return blocked ?? { low, high };
}
// the rectangles it takes up: [x, z (the world's), half across x, half across z (metres)]
function footprintsOf(c) {
	const M = MAINS[c.style], out = [], turned = c.turn % 2 == 1;
	const add = (x, z, hx, hz) => { const [wx, , wz] = worldOf(c, x, 0, z); out.push([wx, wz, turned ? hz : hx, turned ? hx : hz]); };
	add(0, 0, M.w * CUBE / 2, M.d * CUBE / 2);
	for (const r of c.rooms) { const [x, z] = mid(M, r.i, r.j); add(x, z, CUBE / 2, CUBE / 2); }
	return out;
}
function mainFootprint(style, x, z, turn) { const M = MAINS[style], t = turn % 2 == 1; return [x, z, (t ? M.d : M.w) * CUBE / 2, (t ? M.w : M.d) * CUBE / 2]; }

// FOUNDED (the host's)
function hostFound(style, x, z, turn) {
	if (!MAINS[style] || !terrain.land) return 'No';
	const [cx, cz, hx, hz] = mainFootprint(style, x, z, turn), g = groundFor(cx, cz, hx, hz);
	if (typeof g == 'string') return g;
	const c = { id: 'c' + Math.floor(Math.random() * 1e9), at: [x, g.high + FLOOR_OVER * metre(), z], low: g.low, turn: turn & 3, style, stock: {}, built: false, rooms: [] };
	cabins.set(c.id, c);
	cabinStats.founded++;
	told(c);
	return null;
}
function hostRoom(id, i, j, type) {
	const c = cabins.get(id);
	if (!c?.built || !ROOMS[type]) return 'No';
	const M = MAINS[c.style];
	if (!sideOf(M, i, j)) return 'No room can go there';
	if (c.rooms.some((r) => r.i == i && r.j == j)) return 'There is one there already';
	const [x, z] = mid(M, i, j), [wx, , wz] = worldOf(c, x, 0, z), g = groundFor(wx, wz, CUBE / 2 - 0.05, CUBE / 2 - 0.05);
	const blocked = typeof g == 'string' && g != 'Too close to a cabin' ? g : null;
	if (blocked) return blocked;
	const low = typeof g == 'string' ? Math.min(terrain.land.heightAt(wx, wz), c.low) : g.low;
	if (typeof g != 'string' && g.high > c.at[1]) return 'The ground stands too high there';
	c.rooms.push({ i, j, type, stock: {}, built: false, low });
	cabinStats.rooms++;
	told(c);
	return null;
}
survivalNet.on('cabinFound', (m, from) => { if (survivalNet.authority()) { const why = hostFound(m.style, Number(m.x), Number(m.z), Number(m.turn) | 0); if (why) survivalNet.sendTo(from, 'cabinNo', { why }); } });
survivalNet.on('roomFound', (m, from) => { if (survivalNet.authority()) { const why = hostRoom(String(m.id), m.i | 0, m.j | 0, m.type); if (why) survivalNet.sendTo(from, 'cabinNo', { why }); } });
survivalNet.on('cabinNo', (m) => help.toast(String(m.why).slice(0, 80), 2.5));

// WHAT GOES IN (see the top): what is left to come of each, and anything carried that it can use
const leftOf = (style, stock) => Object.entries(needOf(style)).map(([k, n]) => [k, n - (stock[k] ?? 0)]).filter(([, n]) => n > 0);
const carriedOf = (k) => inventory.everything().filter(({ item }) => k == 'hide' ? HIDES.includes(item.type) : item.type == k).map(({ item }) => item);
function targetIn(c, roomK) { return roomK < 0 ? { style: c.style, holder: c } : { style: c.rooms[roomK]?.type, holder: c.rooms[roomK] }; }
function give(c, roomK) {
	const T = targetIn(c, roomK);
	if (!T.holder || T.holder.built) return;
	const given = [];
	for (const [k, n] of leftOf(T.style, T.holder.stock)) {
		let left = n, got = 0;
		for (const item of carriedOf(k)) while (left > 0 && item.count > 0) { const type = item.type; inventory.useOne(item); left--; got++; if (k == 'hide') given.push(['hide', 1, type]); }
		if (got && k != 'hide') given.push([k, got]);
	}
	if (!given.length) { help.toast('You carry nothing it needs'); return; }
	for (const [k, n, type] of given) {
		if (survivalNet.authority()) hostGive(c.id, roomK, k, n);
		else survivalNet.send('cabinGive', { id: c.id, room: roomK, kind: k, n, type: type ?? k });
	}
	weapons.actionSound('knock');
	help.toast('Put in: ' + given.map(([k, n]) => `${n} ${nameOfNeed(k)}`).join(', '), 2);
}
function hostGive(id, roomK, k, n) {
	const c = cabins.get(id), T = c && targetIn(c, roomK);
	if (!T?.holder || T.holder.built) return n;
	const need = needOf(T.style)[k] ?? 0, went = Math.min(n, need - (T.holder.stock[k] ?? 0));
	if (went > 0) T.holder.stock[k] = (T.holder.stock[k] ?? 0) + went;
	if (!leftOf(T.style, T.holder.stock).length) raise(c, roomK);
	told(c);
	return n - Math.max(went, 0);
}
survivalNet.on('cabinGive', (m, from) => {
	if (!survivalNet.authority()) return;
	const left = hostGive(String(m.id), m.room | 0, String(m.kind), Number(m.n) || 0);
	if (left > 0) survivalNet.sendTo(from, 'cabinBack', { items: [[m.type ?? m.kind, left]] });
});
function backOf(list) {
	for (const [type, n] of list) { if (!ITEMS[type]) continue; for (let left = n; left > 0;) { const k = Math.min(left, ITEMS[type].stack ?? 1), it = makeItem(type, k); left -= k; if (!inventory.give(it)) loot.dropHere([it]); } }
}
survivalNet.on('cabinBack', (m) => backOf(m.items ?? []));
// F: not built yet, all of it back
function hostTakeUp(id, roomK) {
	const c = cabins.get(id), T = c && targetIn(c, roomK);
	if (!T?.holder || T.holder.built) return null;
	const back = Object.entries(T.holder.stock).map(([k, n]) => [k == 'hide' ? 'deerHide' : k, n]);
	if (roomK < 0) { cabins.delete(id); survivalNet.send('cabinDel', { id }); changed(); saveSoon(); }
	else { c.rooms.splice(roomK, 1); told(c); }
	return back;
}
survivalNet.on('cabinTakeUp', (m, from) => { if (survivalNet.authority()) { const back = hostTakeUp(String(m.id), m.room | 0); if (back) survivalNet.sendTo(from, 'cabinBack', { items: back }); } });

// IT STANDS (see the top): what is in it (the host's). A room's things go in its own frame: its way out from the main room is its +z
function frameOf(c, roomK) {
	const M = MAINS[c.style];
	if (roomK < 0) return { place: (x, y, z) => worldOf(c, x, y, z), heading: (h) => headingIn(c, h) };
	const r = c.rooms[roomK], [cx, cz] = mid(M, r.i, r.j), h = headingOf(sideOf(M, r.i, r.j)), co = Math.round(Math.cos(h)), si = Math.round(Math.sin(h));
	return { place: (x, y, z) => worldOf(c, cx + x * co + z * si, y, cz - x * si + z * co), heading: (a) => headingIn(c, h + a) };
}
// what stands in each, in its own metres (+z out; x either way): [kind, x, z, its heading]
const MAIN_FURNISH = (M) => {
	const backZ = -M.d * CUBE / 2, X = (i) => (i + 0.5 - M.w / 2) * CUBE, last = M.w - 1;
	return { fire: [X(FIRE_I), backZ + 0.55], chest: [X(last), backZ + 0.6, 0], bed: [X(last) + (M.w > 2 ? 0 : 0.4), backZ + (M.d > 1 ? 2.4 : 1.9), Math.PI / 2] };
};
const ROOM_FURNISH = {
	bedroom: { beds: [[-1.0, 0.1, 0], [1.0, 0.1, 0]], chests: [[-1.05, 1.5, Math.PI], [1.05, 1.5, Math.PI]], stations: [] },
	kitchen: { beds: [], chests: [], stations: [['cauldron', -0.75, 0.4, 0], ['mortar', 1.05, 0.9, Math.PI]] },
	workshop: { beds: [], chests: [], stations: [['anvil', 1.0, 0.7, 0], ['smelter', -0.7, 0.4, 0]] },
};
function raise(c, roomK) {
	const T = targetIn(c, roomK);
	T.holder.built = true;
	cabinStats.built++;
	const F = frameOf(c, roomK);
	if (roomK < 0) {
		const P = MAIN_FURNISH(MAINS[c.style]);
		stations.addBuilt('fireplace', F.place(P.fire[0], 0, P.fire[1]), F.heading(0), c.id, c.id + 'fire');
		loot.addChest(c.id + 'chest', F.place(P.chest[0], 0, P.chest[1]), F.heading(P.chest[2]), 'chest');
	} else {
		const P = ROOM_FURNISH[T.holder.type], key = c.id + 'r' + T.holder.i + '_' + T.holder.j;
		P.chests.forEach(([x, z, h], k) => loot.addChest(key + 'chest' + k, F.place(x, 0, z), F.heading(h), 'chestBig'));
		P.stations.forEach(([kind, x, z, h], k) => stations.addBuilt(kind, F.place(x, 0, z), F.heading(h), c.id, key + kind + k));
	}
	saveSoon();
}
// the beds of it, where they are (only what is built)
function bedsOf(c) {
	const out = [];
	if (!c.built) return out;
	const F = frameOf(c, -1), P = MAIN_FURNISH(MAINS[c.style]);
	out.push({ id: c.id + 'bed', at: F.place(P.bed[0], 0.02, P.bed[1]), yaw: F.heading(P.bed[2]) });
	c.rooms.forEach((r, k) => {
		if (!r.built) return;
		const G = frameOf(c, k);
		ROOM_FURNISH[r.type].beds.forEach(([x, z, h], n) => out.push({ id: c.id + 'r' + k + 'bed' + n, at: G.place(x, 0.02, z), yaw: G.heading(h) }));
	});
	return out;
}

// WHAT IT LOOKS LIKE AND WHAT STANDS IN THE WAY (see the top): worked out once for each as it is. pieces: [name, model, indoors], boxes: [x, z, halfX, bottom, top, halfZ] (the world's), floors: [x0, z0, x1, z1, y]
const shapes = new Map();
function shapeOf(c) {
	const made = shapes.get(c.id);
	if (made) return made;
	const out = { outer: [], inner: [], roofs: [], boxes: [], floors: [], smoke: null };
	const m = metre(), M = MAINS[c.style], base = headingIn(c, 0);
	const put = (list, name, x, y, z, h, sx = 1, sy = 1, sz = 1) => {
		const at = worldOf(c, x, y, z);
		let model = props.place(at, base + h);
		if (sx != 1 || sy != 1 || sz != 1) model = props.stretched(model, sx, sy, sz);
		list.push([name, model]);
	};
	// a box in its own metres, from x0 to x1 and z0 to z1, up from y0 to y1 over its floor
	const wall = (x0, z0, x1, z1, y0, y1) => {
		const a = worldOf(c, x0, y0, z0), b = worldOf(c, x1, y1, z1);
		out.boxes.push([(a[0] + b[0]) / 2, (a[2] + b[2]) / 2, Math.abs(a[0] - b[0]) / 2, a[1], b[1], Math.abs(a[2] - b[2]) / 2]);
	};
	const floorOf = (x0, z0, x1, z1) => {
		const a = worldOf(c, x0, 0, z0), b = worldOf(c, x1, 0, z1);
		out.floors.push([Math.min(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[2], b[2]), c.at[1]]);
	};
	// one wall's width of wall, on an edge's middle (x, z), its outside towards h; kind: 'wall', 'window', 'door', 'gap' (through to a room). tier: how far up, in cubes
	const edge = (x, z, h, kind, tier = 0) => {
		const y = tier * CUBE_UP;
		if (kind != 'gap') put(out.outer, kind + 'Out', x, y, z, h);
		put(out.inner, kind + 'In', x, y, z, h);
		const dx = Math.round(Math.cos(h)), dz = -Math.round(Math.sin(h));		// along it
		const t = 0.34, top = y + CUBE_UP;		// (more than the wall: the eye sees nothing nearer than half a metre, so the walker is kept that far off it)
		const piece = (a, b, y0, y1) => wall(x + dx * a - Math.abs(dz) * t, z + dz * a - Math.abs(dx) * t, x + dx * b + Math.abs(dz) * t, z + dz * b + Math.abs(dx) * t, y0, y1);
		const W = CUBE / 2;
		if (kind == 'door' || kind == 'gap') {
			const hw = kind == 'door' ? 0.72 : 0.9, tall = kind == 'door' ? 2.35 : 2.45;
			piece(-W, -hw, y, top);
			piece(hw, W, y, top);
			piece(-hw, hw, y + tall, top);
		} else piece(-W, W, y, top);
	};
	// a gabled roof on a rectangle (hx, hz half across, in a frame at (x, z) turned h: its ridge along its x), on walls up to y
	//		joined: 0, or 1 or -1, the end of it (along its x) that stands against a higher wall: no eave out past that end, and no gable to be seen on its far side
	const roof = (x, z, h, hx, hz, y, joined = 0, wallAbove = false) => {
		const co = Math.round(Math.cos(h)), si = Math.round(Math.sin(h));
		const local = (a, b) => [x + a * co + b * si, z - a * si + b * co];
		const run = hz, rise = run * PITCH, drop = EAVE * PITCH, len = hx * 2 + EAVE * (joined ? 1 : 2), along = joined ? -joined * EAVE / 2 : 0;
		for (const [s, turn] of [[1, Math.PI], [-1, 0]]) {
			const [ex, ez] = local(along, s * (hz + EAVE));
			put(out.roofs, 'roofOut', ex, y - drop, ez, h + turn, len, rise + drop, run + EAVE);
			const [ix, iz] = local(0, s * hz);
			put(out.inner, 'roofIn', ix, y - 0.08, iz, h + turn, hx * 2, rise, run);
		}
		const [rx, rz] = local(along, 0);
		put(out.roofs, 'ridge', rx, y + rise + 0.015, rz, h, len, 1, 1);
		for (const s of [1, -1]) {
			const [gx, gz] = local(s * hx, 0);
			if (!(joined == s && wallAbove)) put(out.outer, 'gableOut', gx + (co * s) * 0.1, y, gz - (si * s) * 0.1, h + s * Math.PI / 2, hz * 2, rise, 1);
			put(out.inner, 'gableIn', gx - (co * s) * 0.1, y, gz + (si * s) * 0.1, h - s * Math.PI / 2, hz * 2, rise, 1);
		}
	};
	if (c.built) {
		const hx = M.w * CUBE / 2, hz = M.d * CUBE / 2, under = c.at[1] - c.low;
		// its foot and its floor
		put(out.outer, 'block', 0, -under / metre() - 0.4, 0, 0, hx * 2 + 0.3, under / m + 0.38, hz * 2 + 0.3);
		put(out.inner, 'floorTile', 0, 0.01, 0, 0, hx * 2, 1, hz * 2);
		floorOf(-hx - 0.1, -hz - 0.1, hx + 0.1, hz + 0.1);
		const roomAt = (i, j) => c.rooms.find((r) => r.built && r.i == i && r.j == j);
		// its walls, round it: tier by tier. On the front the door, then windows and boards by turns
		for (let tier = 0; tier < M.h; tier++) {
			for (let i = 0; i < M.w; i++) {
				const x = (i + 0.5 - M.w / 2) * CUBE;
				edge(x, hz, 0, tier == 0 && i == doorI(M) ? 'door' : tier == 0 && roomAt(i, M.d) ? 'gap' : (i + tier) % 2 == 0 || M.w == 2 ? 'window' : 'wall', tier);
				edge(x, -hz, Math.PI, tier == 0 && roomAt(i, -1) ? 'gap' : tier == 0 && i == FIRE_I ? 'wall' : (i + tier) % 2 == 1 ? 'window' : 'wall', tier);
			}
			for (let j = 0; j < M.d; j++) {
				const z = (j + 0.5 - M.d / 2) * CUBE;
				edge(hx, z, Math.PI / 2, tier == 0 && roomAt(M.w, j) ? 'gap' : (j + tier) % 2 == 0 ? 'window' : 'wall', tier);
				edge(-hx, z, -Math.PI / 2, tier == 0 && roomAt(-1, j) ? 'gap' : (j + tier) % 2 == 1 ? 'window' : 'wall', tier);
			}
		}
		const top = M.h * CUBE_UP;
		roof(0, 0, 0, hx, hz, top);
		// a tall one has a window in its roof over the door
		if (M.h > 1 && M.d > 1) put(out.outer, 'dormer', 0, top + 0.1, hz * 0.36, 0);
		// the porch, its roof and its steps
		const doorX = (doorI(M) + 0.5 - M.w / 2) * CUBE;
		put(out.outer, 'porch', doorX, 0, hz + 0.1, 0);
		const lean = PORCH + EAVE;
		put(out.roofs, 'roofOut', doorX, 2.5, hz + 0.1 + lean, Math.PI, CUBE + 0.3, Math.max(top * 0.14, 0.45), lean);
		floorOf(doorX - CUBE / 2, hz, doorX + CUBE / 2, hz + 0.1 + PORCH);
		const [fx, , fz] = worldOf(c, doorX, 0, hz + 0.1 + PORCH + 0.5);
		const ground = terrain.land?.heightAt(fx, fz) ?? c.low, rise = (c.at[1] - ground) / m;
		const steps = Math.max(Math.ceil(rise / 0.26), 1);
		for (let k = 1; k <= steps; k++) {
			const y = -k * rise / steps, z0 = hz + 0.1 + PORCH + (k - 1) * 0.28, under2 = rise * (1 - k / steps) + 0.2;
			put(out.outer, 'plank', doorX, y - under2, z0 + 0.14, 0, 1.6, under2, 0.28);
			wall(doorX - 0.8, z0, doorX + 0.8, z0 + 0.28, y - under2, y);
		}
		// the fireplace, against the back wall, and its chimney up through the roof
		const P = MAIN_FURNISH(M);
		put(out.inner, 'hearth', P.fire[0], 0, -hz + 0.55, 0);
		const stackTop = top + hz * PITCH * 0.55 + 1.4;
		put(out.roofs, 'block', P.fire[0], 2.3, -hz + 0.42, 0, 1.0, stackTop - 2.3, 0.8);
		out.smoke = [P.fire[0], stackTop, -hz + 0.42];
		wall(P.fire[0] - 1.05, -hz, P.fire[0] + 1.05, -hz + 0.85, 0, 2.3);
		put(out.inner, 'chest', P.chest[0], 0, P.chest[1], P.chest[2]);
		wall(P.chest[0] - 0.46, P.chest[1] - 0.3, P.chest[0] + 0.46, P.chest[1] + 0.3, 0, 0.5);
		put(out.inner, 'bedrollFlat', P.bed[0], 0.02, P.bed[1], P.bed[2]);
		// the rooms on it
		for (const r of c.rooms) {
			if (!r.built) continue;
			const [cx, cz] = mid(M, r.i, r.j), dir = sideOf(M, r.i, r.j), h = headingOf(dir), co = Math.round(Math.cos(h)), si = Math.round(Math.sin(h)), W = CUBE / 2;
			const local = (a, b) => [cx + a * co + b * si, cz - a * si + b * co];
			put(out.outer, 'block', cx, -(c.at[1] - r.low) / m - 0.4, cz, 0, CUBE + 0.25, (c.at[1] - r.low) / m + 0.38, CUBE + 0.25);
			put(out.inner, 'floorTile', cx, 0.012, cz, 0, CUBE, 1, CUBE);
			const q = local(-W - 0.1, -W - 0.3), e = local(W + 0.1, W + 0.1);
			floorOf(Math.min(q[0], e[0]), Math.min(q[1], e[1]), Math.max(q[0], e[0]), Math.max(q[1], e[1]));
			const [ox, oz] = local(0, W);
			edge(ox, oz, h, 'window');
			const [sx1, sz1] = local(W, 0), [sx2, sz2] = local(-W, 0);
			edge(sx1, sz1, h + Math.PI / 2, 'wall');
			edge(sx2, sz2, h - Math.PI / 2, 'wall');
			const [ix, iz] = local(0, -W);
			edge(ix, iz, h + Math.PI, 'gap');
			// (its ridge out from the main room: its roof's own x along that)
			roof(cx, cz, h - Math.PI / 2, W, W, CUBE_UP, -1, M.h > 1);
			const P2 = ROOM_FURNISH[r.type];
			for (const [x, z, a] of P2.beds) { const [bx, bz] = local(x, z); put(out.inner, 'bedrollFlat', bx, 0.02, bz, h + a); }
			for (const [x, z, a] of P2.chests) { const [bx, bz] = local(x, z); put(out.inner, 'chest', bx, 0, bz, h + a); const s = CHEST.big; out.inner[out.inner.length - 1][1] = props.place(worldOf(c, bx, 0, bz), base + h + a, 0, 0, s); wall(bx - 0.62, bz - 0.62, bx + 0.62, bz + 0.62, 0, 0.7); }
		}
	}
	shapes.set(c.id, out);
	return out;
}
const FOUNDATION = (c, draw) => {
	// stakes and twine round a rectangle in its own metres
	const line = (x0, z0, x1, z1) => { const a = worldOf(c, x0, 0, z0), b = worldOf(c, x1, 0, z1), g = terrain.land; a[1] = g.heightAt(a[0], a[2]); b[1] = g.heightAt(b[0], b[2]); draw(a, b); };
	return line;
};
function markOut(c, x, z, hx, hz) {
	const line = FOUNDATION(c, drawTwine), C = [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]];
	C.forEach(([a, b], k) => { const [d, e] = C[(k + 1) % 4]; line(x + a, z + b, x + d, z + e); });
}
function drawTwine(a, b, glow) {
	const m = metre(), up = 0.7 * m, dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz) / m;
	props.show('stake', props.place(a, 0), glow);
	props.show('twine', props.stretched(props.place([a[0], a[1] + up, a[2]], Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz))), 1, 1, len), glow);
}

// THE ONE IN VIEW (see the top): a foundation to put things in { cabin, room (-1 its main room) }
export function foundationInView() {
	if (!inventory.survivalOn()) return null;
	const p = hunting.hunterPlace(), m = metre();
	if (!p.active || p.on != 'land') return null;
	const reach = (x, z, half) => Math.hypot(x - p.x, z - p.z) / m < half + REACH;
	for (const c of cabins.values()) {
		const M = MAINS[c.style];
		if (!c.built && reach(c.at[0], c.at[2], Math.max(M.w, M.d) * CUBE / 2)) return { cabin: c, room: -1 };
		for (let k = 0; k < c.rooms.length; k++) {
			if (c.rooms[k].built) continue;
			const [x, z] = mid(M, c.rooms[k].i, c.rooms[k].j), [wx, , wz] = worldOf(c, x, 0, z);
			if (reach(wx, wz, CUBE / 2)) return { cabin: c, room: k };
		}
	}
	return null;
}
hunting.onUse(() => { const v = foundationInView(); if (!v) return false; give(v.cabin, v.room); return true; });
hunting.onVehicleUse(() => {
	const v = foundationInView();
	if (!v) return false;
	if (survivalNet.authority()) backOf(hostTakeUp(v.cabin.id, v.room) ?? []);
	else survivalNet.send('cabinTakeUp', { id: v.cabin.id, room: v.room });
	help.toast('Foundation taken up, and what was in it back');
	return true;
});
hunting.addPrompt(() => {
	const v = foundationInView();
	if (!v) return null;
	const T = targetIn(v.cabin, v.room), name = MAINS[T.style]?.name ?? ROOMS[T.style]?.name;
	return { name: `Foundation, ${name}: wants ${leftOf(T.style, T.holder.stock).map(([k, n]) => `${n} ${nameOfNeed(k)}`).join(', ')}`, keys: 'E put in what you carry · F take it up' };
});
// a built main room the eye is on, or stood in
function builtInView() {
	const p = hunting.hunterPlace(), m = metre(), f = transformations.getCameraForward();
	let best = null, bestD = 22 * m;
	for (const c of cabins.values()) {
		if (!c.built) continue;
		const to = [c.at[0] - p.x, c.at[2] - p.z], d = Math.hypot(...to);
		if (d < bestD && (d < 6 * m || (to[0] * f[0] + to[1] * f[2]) / (d || 1) > 0.55)) { best = c; bestD = d; }
	}
	return best;
}
// its beds: E sleeps
function bedInView() {
	if (!inventory.survivalOn()) return null;
	const p = hunting.hunterPlace(), m = metre(), look = [Math.sin(settings.camYaw), -Math.cos(settings.camYaw)];
	let best = null, bestD = 2.6;
	for (const c of cabins.values()) {
		if (Math.hypot(c.at[0] - p.x, c.at[2] - p.z) > 22 * m) continue;
		for (const b of bedsOf(c)) {
			const dx = (b.at[0] - p.x) / m, dz = (b.at[2] - p.z) / m, d = Math.hypot(dx, dz);
			if (d < bestD && (d < 0.8 || (dx * look[0] + dz * look[1]) / d > 0.7)) { best = b; bestD = d; }
		}
	}
	return best;
}
hunting.onUse(() => { const b = bedInView(); if (!b || survival.status.asleep > 0) return false; bedrolls.sleepAt(b); return true; });
hunting.addPrompt(() => bedInView() ? { name: 'Bedroll', keys: 'E sleep' } : null);

// THE PLAN (see the top): the page, and laying out a main room on the ground
const plan = { placing: null, room: 'bedroom', cabin: null };
export const planState = plan;
const sketchMain = (M) => {
	const u = 26, W = M.w * u, D = M.d * u * 0.55, H = M.h * u * 0.7, R = D * 0.7, x0 = 16, y0 = 12 + R + H;
	return `<svg width="${W + D * 0.7 + 34}" height="${y0 + 14}" style="filter:url(#charcoal);" fill="none" stroke="${journal.INK}" stroke-width="1.6"><path d="M${x0} ${y0} h${W} v${-H} h${-W} Z M${x0 + W} ${y0} l${D * 0.7} ${-D * 0.45} v${-H} l${-D * 0.7} ${D * 0.45} M${x0} ${y0 - H} l${D * 0.35} ${-R} h${W} l${-D * 0.35} ${R} M${x0 + W + D * 0.35} ${y0 - H - R} l${D * 0.35} ${R - D * 0.45}"/>${Array.from({ length: M.w }, (_, k) => `<path d="M${x0 + (k + 0.5) * u - 7} ${y0 - H + 8} h14 v12 h-14 Z" stroke-width="1"/>`).join('')}<path d="M${x0 + (Math.floor(M.w / 2) + 0.5) * u - 6} ${y0} v-16 h12 v16" stroke-width="1.2"/></svg>`;
};
const needList = (style, stock = {}) => Object.entries(needOf(style)).map(([k, n]) => `${(stock[k] ?? 0) ? `${stock[k]} of ` : ''}${n} ${nameOfNeed(k)}`).join(', ');
const planMenu = {
	render() {
		const c = plan.cabin && cabins.get(plan.cabin);
		if (!c) {
			return `<div class="jr-title" style="font-size: 22px;">Build journal</div><div class="jr-need" style="margin-bottom: 8px;">Choose a main room. Rooms can be built on to it when it stands.</div>
			${Object.entries(MAINS).map(([style, M]) => `<div class="jr-row"><div style="display:flex; align-items:center; gap:14px;">${sketchMain(M)}<div><b>${M.name}</b> <span class="jr-need">(${M.w} × ${M.d} × ${M.h} cubes)</span><div class="jr-need" style="max-width: 360px;">Comes with a bedroll, a chest and a fireplace<br>${needList(style)}</div></div></div><button class="jr-btn" data-act="main:${style}">Lay it out</button></div>`).join('')}
			<div class="jr-need" style="margin-top: 10px;">Tab, Esc or F to close</div>`;
		}
		const M = MAINS[c.style], cell = 62, x0 = cell + 10, y0 = cell + 10;
		const slots = slotsOf(M), rects = [];
		for (let i = 0; i < M.w; i++) for (let j = 0; j < M.d; j++) rects.push(`<rect x="${x0 + i * cell}" y="${y0 + j * cell}" width="${cell}" height="${cell}" fill="rgba(43,37,32,0.14)" stroke="${journal.INK}" stroke-width="1.8"/>`);
		for (const [i, j] of slots) {
			const r = c.rooms.find((o) => o.i == i && o.j == j), x = x0 + i * cell, y = y0 + j * cell;
			if (r) rects.push(`<rect x="${x + 2}" y="${y + 2}" width="${cell - 4}" height="${cell - 4}" fill="rgba(43,37,32,${r.built ? 0.26 : 0.08})" stroke="${journal.INK}" stroke-width="1.4"/><text x="${x + cell / 2}" y="${y + cell / 2 + 4}" text-anchor="middle" font-size="10" fill="${journal.INK}" stroke="none" font-family='${journal.HAND}'>${ROOMS[r.type].name.split(',')[0]}${r.built ? '' : ' (staked)'}</text>`);
			else rects.push(`<rect data-act="cell:${i}:${j}" style="cursor:pointer;" x="${x + 3}" y="${y + 3}" width="${cell - 6}" height="${cell - 6}" fill="rgba(0,0,0,0.001)" stroke="${journal.SOFT}" stroke-width="1.2" stroke-dasharray="5 4"><title>Build the ${ROOMS[plan.room].name.toLowerCase()} here</title></rect>`);
		}
		const di = doorI(M);
		rects.push(`<text x="${x0 + (di + 0.5) * cell}" y="${y0 + (M.d + 0.5) * cell + 3}" text-anchor="middle" font-size="11" fill="${journal.INK}" stroke="none" font-family='${journal.HAND}'>door</text>`);
		rects.push(`<text x="${x0 + (FIRE_I + 0.5) * cell}" y="${y0 - cell / 2 + 3}" text-anchor="middle" font-size="11" fill="${journal.INK}" stroke="none" font-family='${journal.HAND}'>hearth</text>`);
		const rooms = Object.entries(ROOMS).map(([type, R]) => `<div class="jr-row" style="${plan.room == type ? 'background: rgba(43,37,32,0.1);' : ''}"><div><b>${R.name}</b><div class="jr-need" style="max-width: 320px;">${R.detail}<br>${needList(type)}</div></div><button class="jr-btn" data-act="room:${type}" ${plan.room == type ? 'disabled style="text-decoration:none;"' : ''}>${plan.room == type ? 'Chosen' : 'Choose'}</button></div>`).join('');
		return `<div class="jr-title" style="font-size: 22px;">${M.name}: the plan</div><div class="jr-need" style="margin-bottom: 8px;">Choose a room, then the square for it, from above</div>
		<div style="display:flex; gap:24px; align-items:flex-start;"><svg width="${(M.w + 2) * cell + 20}" height="${(M.d + 2) * cell + 20}" style="filter:url(#charcoal);">${rects.join('')}</svg><div>${rooms}</div></div>
		<div class="jr-need" style="margin-top: 10px;">Tab, Esc or F to close</div>`;
	},
	act(value) {
		const [what, a, b] = value.split(':');
		if (what == 'main') { journal.closeMenu(); plan.placing = { style: a, extraTurn: 0 }; help.toast('Left click: drive in the stakes · R turns it · Right click: not here', 4); return; }
		if (what == 'room') { plan.room = a; return; }
		if (what == 'cell') {
			const id = plan.cabin, i = Number(a), j = Number(b);
			if (survivalNet.authority()) { const why = hostRoom(id, i, j, plan.room); if (why) { help.toast(why, 2.5); return; } }
			else survivalNet.send('roomFound', { id, i, j, type: plan.room });
			journal.closeMenu();
			help.toast(`Stakes in: E at them with ${needList(plan.room)}`, 4);
		}
	},
};
// THE JOURNAL'S CLICK (survivalTools.js)
export function journalClick() {
	if (plan.placing) { dropStakes(); return; }
	const c = builtInView();
	plan.cabin = c?.id ?? null;
	journal.openMenu(planMenu);
}
export function openPlanner() { journalClick(); }
function placingAt() {
	const P = plan.placing, p = hunting.hunterPlace(), m = metre(), M = MAINS[P.style], yaw = settings.camYaw;
	// the door towards the walker, by quarter turns
	const turn = (Math.round(-yaw / (Math.PI / 2)) + P.extraTurn + 400) & 3, deep = turn % 2 == 1 ? M.w : M.d, x = p.x + Math.sin(yaw) * (deep * CUBE / 2 + AHEAD) * m, z = p.z - Math.cos(yaw) * (deep * CUBE / 2 + AHEAD) * m;
	// (on a grid of a cube's width, so what is built nearby lines up)
	const size = CUBE * m;
	return { x: Math.round(x / size) * size, z: Math.round(z / size) * size, turn };
}
function dropStakes() {
	const P = plan.placing, A = placingAt();
	if (survivalNet.authority()) { const why = hostFound(P.style, A.x, A.z, A.turn); if (why) { help.toast(why, 2.5); return; } }
	else {
		const [cx, cz, hx, hz] = mainFootprint(P.style, A.x, A.z, A.turn), g = groundFor(cx, cz, hx, hz);
		if (typeof g == 'string') { help.toast(g, 2.5); return; }
		survivalNet.send('cabinFound', { style: P.style, x: A.x, z: A.z, turn: A.turn });
	}
	plan.placing = null;
	help.toast(`Stakes in. E at them with ${needList(P.style)}`, 5);
}
window.addEventListener('keydown', (e) => { if (e.code == 'KeyR' && plan.placing && !hunting.input.menuOpen) plan.placing.extraTurn = (plan.placing.extraTurn + 1) & 3; });
window.addEventListener('mousedown', (e) => { if (e.button == 2 && plan.placing) { plan.placing = null; help.toast('Laid aside', 1.2); } });
survival.setBuildChoice({ label: 'Build journal', detail: 'Plan a cabin, or build on to one', act: () => { weapons.equipWeapon('journal'); return weapons.weaponState.current == 'journal'; } });

// WHERE THE WALKER CAN WALK (hunting.js)
hunting.addStill((x, z, reach, add) => {
	for (const c of cabins.values()) {
		if (Math.hypot(c.at[0] - x, c.at[2] - z) > reach + 30 * metre()) continue;
		for (const [bx, bz, hx, bottom, top, hz] of shapeOf(c).boxes) add(bx, bz, hx, bottom, top, hz);
	}
});
hunting.addFloor((x, z, highest) => {
	let floor = -Infinity;
	for (const c of cabins.values()) {
		if (!c.built || c.at[1] > highest) continue;
		for (const [x0, z0, x1, z1, y] of shapeOf(c).floors) if (x > x0 && x < x1 && z > z0 && z < z1 && y <= highest) floor = Math.max(floor, y);
	}
	return floor;
});
// (the roofs in the picture from above: skyCover.js)
skyCover.addProps((put) => { for (const c of cabins.values()) if (c.built) for (const [name, model] of shapeOf(c).roofs) put(name, model); });
// the picture of what is in the way, for stations set up near (a place's own question)
export function inside(x, z) {
	for (const c of cabins.values()) if (c.built) for (const [x0, z0, x1, z1] of shapeOf(c).floors) if (x > x0 && x < x1 && z > z0 && z < z1) return c;
	return null;
}

// SAVED (see the top)
let saveIn = 0, loadedFor = null;
const savedKey = () => SAVED + ':' + (settings.terrainSeed ?? 0);
function saveSoon() { saveIn = saveIn || 3; }
stations.onSave(saveSoon);
farms.onChange(saveSoon);
loot.onChest(saveSoon);
function save() {
	if (!survivalNet.authority()) return;
	try { localStorage.setItem(savedKey(), JSON.stringify({ cabins: [...cabins.values()].map(share), stations: stations.stationsSave(), farms: farms.farmsSave(), chests: loot.chestsSave() })); } catch (e) { /* */ }
}
function load() {
	if (loadedFor === savedKey() || !terrain.land) return;
	loadedFor = savedKey();
	if (!survivalNet.authority()) return;
	let saved = null;
	try { saved = JSON.parse(localStorage.getItem(savedKey()) ?? 'null'); } catch (e) { /* */ }
	if (!saved) return;
	for (const raw of saved.cabins ?? []) if (Array.isArray(raw.at)) { const c = cleanCabin(raw); cabins.set(c.id, c); }
	stations.stationsLoad(saved.stations);
	farms.farmsLoad(saved.farms);
	loot.chestsLoad((saved.chests ?? []).map((c) => ({ ...c, items: (c.items ?? []).map(cleanItem).filter(Boolean) })));
	changed();
}
window.addEventListener('beforeunload', () => { if (loadedFor) save(); });

// Once a frame: the plan's stakes, each drawn, its chimney's smoke
let lastTime = performance.now(), puffClock = 0;
export function cabinsUpdate() {
	const dt = Math.min((performance.now() - lastTime) / 1000, 0.1);
	lastTime = performance.now();
	if (!inventory.survivalOn()) return;
	load();
	if (saveIn > 0 && (saveIn -= dt) <= 0) { saveIn = 0; save(); }
	const m = metre(), cx = settings.camPosX, cz = settings.camPosZ, far = DRAW * m, near = DRAW_INSIDE * m;
	puffClock += dt;
	const puffs = puffClock > 0.09;
	if (puffs) puffClock = 0;
	if (plan.placing && weapons.weaponState.current != 'journal' && !hunting.input.menuOpen) plan.placing = null;
	if (plan.placing) {
		const A = placingAt(), M = MAINS[plan.placing.style], at = { at: [A.x, 0, A.z], turn: A.turn };
		const [fx, fz, hx, hz] = mainFootprint(plan.placing.style, A.x, A.z, A.turn), g = groundFor(fx, fz, hx, hz), glow = typeof g == 'string' ? [1, 0.2, 0.1, 0.9] : [0.3, 1, 0.3, 0.7];
		const W = M.w * CUBE / 2, D = M.d * CUBE / 2, C = [[-W, -D], [W, -D], [W, D], [-W, D]];
		C.forEach(([a, b], k) => {
			const [d, e] = C[(k + 1) % 4], p = worldOf(at, a, 0, b), q = worldOf(at, d, 0, e);
			p[1] = terrain.land.heightAt(p[0], p[2]); q[1] = terrain.land.heightAt(q[0], q[2]);
			drawTwine(p, q, glow);
		});
		// (a stake at its door, so it can be seen which way it faces)
		const dx = (Math.floor(M.w / 2) + 0.5 - M.w / 2) * CUBE, door = worldOf(at, dx, 0, D + 0.6);
		door[1] = terrain.land.heightAt(door[0], door[2]);
		props.show('stake', props.place(door, 0, 0, 0, 1.6), glow);
	}
	for (const c of cabins.values()) {
		if (Math.abs(c.at[0] - cx) > far || Math.abs(c.at[2] - cz) > far) continue;
		const M = MAINS[c.style];
		if (!c.built) markOut(c, 0, 0, M.w * CUBE / 2, M.d * CUBE / 2);
		for (const r of c.rooms) if (!r.built) { const [x, z] = mid(M, r.i, r.j); markOut(c, x, z, CUBE / 2, CUBE / 2); }
		if (!c.built) continue;
		const S = shapeOf(c), close = Math.abs(c.at[0] - cx) < near && Math.abs(c.at[2] - cz) < near;
		for (const [name, model] of S.outer) props.show(name, model);
		for (const [name, model] of S.roofs) props.show(name, model);
		if (close) for (const [name, model] of S.inner) props.show(name, model, undefined, INDOORS);
		// (the fire in its hearth is the station's, stations.js: its smoke goes up the chimney)
		const fire = stations.list().find((s) => s.id == c.id + 'fire');
		if (puffs && S.smoke && fire && stations.burning(fire)) { const at = worldOf(c, ...S.smoke); smoke.addPuff({ at, v: [0, 0.9, 0], size: 0.25, grow: 3, life: 5, kind: 1, dark: 0.3, rise: 0.9 }); }
	}
}
// where each is, and what it is called (highlights.js)
export const cabinSpots = () => [...cabins.values()].map((c) => ({ at: worldOf(c, 0, c.built ? MAINS[c.style].h * CUBE_UP + 3 : 1.2, 0), name: (c.built ? '' : 'Foundation: ') + MAINS[c.style].name }));
// for testing
export const cabinsForTest = () => [...cabins.values()].map((c) => ({ ...share(c), pieces: c.built ? shapeOf(c).outer.length + shapeOf(c).inner.length + shapeOf(c).roofs.length : 0, boxes: shapeOf(c).boxes.length }));
export const foundForTest = hostFound;
export const whyNotForTest = (style, x, z, turn) => { const [cx, cz, hx, hz] = mainFootprint(style, x, z, turn), g = groundFor(cx, cz, hx, hz); return typeof g == 'string' ? g : null; };
export const roomForTest = hostRoom;
export const giveForTest = give;
export const cabinForTest = (id) => cabins.get(id);
export const bedsForTest = (id) => bedsOf(cabins.get(id));
