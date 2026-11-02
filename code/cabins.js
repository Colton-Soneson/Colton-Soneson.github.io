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
import { CUBE, CUBE_UP, PORCH, STAIR_STEPS, STAIR_RISE, STAIR_RADIUS, STAIR_TURN, STAIR_FROM } from './workMeshes.js'
import { MODELS as FURNITURE } from './interiorMeshes.js'
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
	Held and looked at a main room built, the page is its plan from above instead: choose a ROOM (ROOMS: a cube each) and a square round it, and its foundation goes there. It joins by an opening through the wall. Squares that cannot take one: the one with the door, the one at the fireplace, and on a hall two cubes high the two either side of its stair.
	A HALL TWO CUBES HIGH has a floor over the first, CUBE_UP up, and a spiral stair (workMeshes.js: spiralStair) up to it in its front corner on the left, through a stairwell (STAIR_WELL) railed round but where the stair comes up. The walker walks up it step by step (the floor under it: stairStep), kept on it by a ring of posts round it, open at its foot and its head. Upstairs, a bed (E sleeps), a nightstand, a wardrobe, a rug, an armchair.
	FURNISHED: every main room has, as well as what it comes with, a rug before the fire and an armchair turned to it, a table with two chairs and a candle, a barrel in the corner by the fire, a cabinet by the door (interiorMeshes.js: MODELS, the townsfolk's houses' own), each in the way as it stands.
	HOW IT GOES TOGETHER, so nothing shows through anything: corner boards up its corners; a room has a ceiling under its roof (the hall's eave comes down into the space over it); a room on the front or the back of a hall one cube high has its ridge along the hall's wall, and no eave down into it; rooms side by side share a wall (each its own face of it) and stop their eaves at it; a hall's wall over a room is boards, not a window; a room's gable against the hall is not to be seen; the dormer stands on the front wall.
	WHAT IT TAKES: each wants what its walls take (MAINS, ROOMS: wood, nails) and what goes in it (FURNISHED: as these things cost to make). Stakes and twine mark it until then: E at them puts in whatever of that is carried (hide: any). F takes up a foundation not yet built, and gives it all back.
	In god mode it costs nothing: it stands as soon as its stakes are in, and E finishes one staked out before. Once it has it all, it stands. Every room comes with what is in it: a main room a bedroll, a chest and a fireplace (stations.js); a bedroom two bedrolls and two big chests; a kitchen a cauldron and a mortar; a workshop an anvil and a smelter. E sleeps on a bedroll (bedrolls.js), the chests are loot.js's containers.
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
// (a hall two cubes high has its stair in its front corner on the left: no room on the squares either side of it)
const stairBlocks = (M, i, j) => M.h > 1 && ((i == -1 && j == M.d - 1) || (i == 0 && j == M.d));
const STAIR_WELL = 2.3;				// metres square, the stairwell
const stairOf = (M) => [-M.w * CUBE / 2 + STAIR_WELL / 2, M.d * CUBE / 2 - STAIR_WELL / 2];
// which way a square lies out from it, a room on it or not (one built before the stair kept it clear still stands there)
function sideRaw(M, i, j) {
	if (i >= 0 && i < M.w && j == -1) return i == FIRE_I ? null : [0, -1];
	if (i >= 0 && i < M.w && j == M.d) return i == doorI(M) ? null : [0, 1];
	if (j >= 0 && j < M.d && i == -1) return [-1, 0];
	if (j >= 0 && j < M.d && i == M.w) return [1, 0];
	return null;
}
const sideOf = (M, i, j) => stairBlocks(M, i, j) ? null : sideRaw(M, i, j);
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
// (god mode: everything it still wants, out of nothing. God mode is only ever the host's: survival.js)
function finishFree(c, roomK) {
	const T = targetIn(c, roomK);
	for (const [k, n] of leftOf(T.style, T.holder.stock)) hostGive(c.id, roomK, k, n);
}
function give(c, roomK) {
	const T = targetIn(c, roomK);
	if (!T.holder || T.holder.built) return;
	if (inventory.isGod()) { finishFree(c, roomK); weapons.actionSound('knock'); help.toast('Built: free in god mode', 2); return; }
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
	const r = c.rooms[roomK], [cx, cz] = mid(M, r.i, r.j), h = headingOf(sideRaw(M, r.i, r.j)), co = Math.round(Math.cos(h)), si = Math.round(Math.sin(h));
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
	const M = MAINS[c.style];
	if (M.h > 1) out.push({ id: c.id + 'loft', at: F.place(M.w * CUBE / 2 - 0.75, CUBE_UP + 0.5, -M.d * CUBE / 2 + 1.15), yaw: F.heading(Math.PI) });
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
	const out = { outer: [], inner: [], roofs: [], boxes: [], floors: [], smoke: null, stair: null };
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
	const floorOf = (x0, z0, x1, z1, y = 0) => {
		const a = worldOf(c, x0, 0, z0), b = worldOf(c, x1, 0, z1);
		out.floors.push([Math.min(a[0], b[0]), Math.min(a[2], b[2]), Math.max(a[0], b[0]), Math.max(a[2], b[2]), c.at[1] + y * m]);
	};
	// one wall's width of wall, on an edge's middle (x, z), its outside towards h; kind: 'wall', 'window', 'door', 'gap' (through to a room), 'inner' (its inside only: a
	//		wall two rooms share, each its own face of it). tier: how far up, in cubes
	const edge = (x, z, h, kind, tier = 0) => {
		const y = tier * CUBE_UP;
		if (kind != 'gap' && kind != 'inner') put(out.outer, kind + 'Out', x, y, z, h);
		put(out.inner, kind == 'inner' ? 'wallIn' : kind + 'In', x, y, z, h);
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
	// a gabled roof on a rectangle (hx, hz half across, in a frame at (x, z) turned h: its ridge along its x), on walls up to y.
	//		ends: the ends of it (along its x: -1, 1) that stand against a wall: no eave out past them, and no gable to be seen outside.
	//		slopes: the sides of it (along its z: -1, 1) whose eave would come down into something (the hall's wall, the room beside it): they stop at their wall.
	//		columns: its slopes in so many pieces along it, and bare(s, k): piece k of slope s has no eave either (over a room against the wall under it)
	const roof = (x, z, h, hx, hz, y, { ends = [], slopes = [], columns = 1, bare = () => false } = {}) => {
		const co = Math.round(Math.cos(h)), si = Math.round(Math.sin(h));
		const local = (a, b) => [x + a * co + b * si, z - a * si + b * co];
		const run = hz, rise = run * PITCH, out0 = ends.includes(-1) ? 0 : EAVE, out1 = ends.includes(1) ? 0 : EAVE, len = hx * 2 + out0 + out1, along = (out1 - out0) / 2;
		for (const [s, turn] of [[1, Math.PI], [-1, 0]]) {
			for (let k = 0; k < columns; k++) {
				const a0 = -hx + k * hx * 2 / columns - (k == 0 ? out0 : 0), a1 = -hx + (k + 1) * hx * 2 / columns + (k == columns - 1 ? out1 : 0);
				const eave = slopes.includes(s) || bare(s, k) ? 0 : EAVE;
				const [ex, ez] = local((a0 + a1) / 2, s * (hz + eave));
				put(out.roofs, 'roofOut', ex, y - eave * PITCH, ez, h + turn, a1 - a0, rise + eave * PITCH, run + eave);
			}
			const [ix, iz] = local(0, s * hz);
			put(out.inner, 'roofIn', ix, y - 0.08, iz, h + turn, hx * 2, rise, run);
		}
		const [rx, rz] = local(along, 0);
		put(out.roofs, 'ridge', rx, y + rise + 0.015, rz, h, len, 1, 1);
		for (const s of [1, -1]) {
			const [gx, gz] = local(s * hx, 0);
			if (!ends.includes(s)) put(out.outer, 'gableOut', gx + (co * s) * 0.1, y, gz - (si * s) * 0.1, h + s * Math.PI / 2, hz * 2, rise, 1);
			put(out.inner, 'gableIn', gx - (co * s) * 0.1, y, gz + (si * s) * 0.1, h - s * Math.PI / 2, hz * 2, rise, 1);
		}
	};
	// a board up a corner (x, z), from y0 to y1
	const corner = (x, z, y0, y1) => put(out.outer, 'cornerBoard', x, y0, z, 0, 0.22, y1 - y0, 0.22);
	// a piece of furniture (interiorMeshes.js: MODELS) at (x, y, z) turned a, and what of it is in the way (turned other than by quarters: the bigger of its sides both ways)
	const furnish = (name, x, y, z, a = 0) => {
		put(out.inner, name, x, y, z, a);
		const F = FURNITURE[name];
		if (!F || F.solid === false) return;
		const q = Math.abs(Math.sin(a)), quarter = q < 0.01 || q > 0.99, big = Math.max(F.hw, F.hd);
		const hw = !quarter ? big : q > 0.5 ? F.hd : F.hw, hd = !quarter ? big : q > 0.5 ? F.hw : F.hd;
		wall(x - hw, z - hd, x + hw, z + hd, y, y + F.h);
	};
	if (c.built) {
		const hx = M.w * CUBE / 2, hz = M.d * CUBE / 2, under = c.at[1] - c.low;
		// its foot and its floor
		put(out.outer, 'block', 0, -under / metre() - 0.4, 0, 0, hx * 2 + 0.3, under / m + 0.38, hz * 2 + 0.3);
		put(out.inner, 'floorTile', 0, 0.01, 0, 0, hx * 2, 1, hz * 2);
		floorOf(-hx - 0.1, -hz - 0.1, hx + 0.1, hz + 0.1);
		const roomAt = (i, j) => c.rooms.find((r) => r.built && r.i == i && r.j == j);
		// its walls, round it: tier by tier. On the front the door, then windows and boards by turns. Where a room stands against it: the way through to it, and
		//		over that boards (the room's roof comes up against them)
		for (let tier = 0; tier < M.h; tier++) {
			const roomed = (r) => tier == 0 ? 'gap' : 'wall';
			for (let i = 0; i < M.w; i++) {
				const x = (i + 0.5 - M.w / 2) * CUBE;
				edge(x, hz, 0, tier == 0 && i == doorI(M) ? 'door' : roomAt(i, M.d) ? roomed() : (i + tier) % 2 == 0 || M.w == 2 ? 'window' : 'wall', tier);
				edge(x, -hz, Math.PI, roomAt(i, -1) ? roomed() : tier == 0 && i == FIRE_I ? 'wall' : (i + tier) % 2 == 1 ? 'window' : 'wall', tier);
			}
			for (let j = 0; j < M.d; j++) {
				const z = (j + 0.5 - M.d / 2) * CUBE;
				edge(hx, z, Math.PI / 2, roomAt(M.w, j) ? roomed() : (j + tier) % 2 == 0 ? 'window' : 'wall', tier);
				edge(-hx, z, -Math.PI / 2, roomAt(-1, j) ? roomed() : (j + tier) % 2 == 1 ? 'window' : 'wall', tier);
			}
		}
		const top = M.h * CUBE_UP;
		// (one cube high, a room on its front or back has its roof up under this one's eave: no eave over it, the two meet at the wall)
		roof(0, 0, 0, hx, hz, top, M.h == 1 ? { columns: M.w, bare: (s, k) => !!roomAt(k, s > 0 ? M.d : -1) } : {});
		// boards up its corners
		for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) corner(a * (hx + 0.05), b * (hz + 0.05), -0.05, top);
		// a tall one has a window in its roof over the door, standing on the front wall
		if (M.h > 1 && M.d > 1) put(out.outer, 'dormer', 0, top - 0.02, hz - 0.12, 0);
		// the porch, its roof (not out over a room beside it) and its steps
		const doorX = (doorI(M) + 0.5 - M.w / 2) * CUBE;
		put(out.outer, 'porch', doorX, 0, hz + 0.1, 0);
		const lean = PORCH + EAVE, trimL = roomAt(doorI(M) - 1, M.d) ? 0.5 : 0, trimR = roomAt(doorI(M) + 1, M.d) ? 0.5 : 0;
		put(out.roofs, 'roofOut', doorX + (trimL - trimR) / 2, 2.5, hz + 0.1 + lean, Math.PI, CUBE + 0.3 - trimL - trimR, Math.max(top * 0.14, 0.45), lean);
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
		// FURNISHED (see the top): the fire's side of the room, the table, the corners
		const fire = P.fire[0], tall = M.h > 1;
		furnish('rug', fire + (tall ? 0.7 : 0), 0.005, -hz + 1.75, 0);
		const ax = fire + 1.4, az = -hz + 2.05;
		furnish('armchair', ax, 0, az, Math.atan2(fire - ax, -hz + 0.55 - az));
		const tx = M.w == 2 ? -hx + 2.4 : 1.7, tz = M.d == 1 ? -0.35 : tall ? 1.0 : 1.7;
		furnish('tableLong', tx, 0, tz, 0);
		furnish('chair', tx - 0.45, 0, tz - 0.85, 0);
		furnish('chair', tx + 0.45, 0, tz + 0.85, Math.PI);
		put(out.inner, 'candle', tx + 0.35, 0.8, tz, 0);
		furnish('barrel', -hx + 0.45, 0, -hz + 0.45, 0);
		furnish('cabinet', hx - 0.6, 0, hz - 0.36, Math.PI);
		// A HALL TWO CUBES HIGH (see the top): the floor over, round the stairwell; the stair and what keeps the walker on it; the rail round the well; upstairs
		if (tall) {
			const y1 = CUBE_UP, S = STAIR_WELL, [sx, sz] = stairOf(M);
			const slab = (x0, z0, x1, z1) => { put(out.inner, 'plank', (x0 + x1) / 2, y1 - 0.1, (z0 + z1) / 2, 0, x1 - x0, 0.1, z1 - z0); floorOf(x0, z0, x1, z1, y1); };
			slab(-hx + S, -hz, hx, hz);
			slab(-hx, -hz, -hx + S, hz - S);
			put(out.inner, 'spiralStair', sx, 0, sz, 0);
			out.stair = [sx, sz];
			wall(sx - 0.1, sz - 0.1, sx + 0.1, sz + 0.1, 0, y1 + 1);
			for (let k = 0; k < 20; k++) {
				const a = k / 20 * Math.PI * 2, rel = ((a - STAIR_FROM) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
				if (rel < STAIR_TURN * 2.2 || rel > Math.PI * 2 - STAIR_TURN * 1.2) continue;		// (its foot, and its head)
				const px = sx + Math.sin(a) * (STAIR_RADIUS + 0.12), pz = sz + Math.cos(a) * (STAIR_RADIUS + 0.12);
				wall(px - 0.09, pz - 0.09, px + 0.09, pz + 0.09, 0, y1);
			}
			const rail = (x0, z0, x1, z1) => {
				const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(Math.round(len), 1), alongX = x1 != x0;
				for (let k = 0; k < n; k++) put(out.inner, 'railing', x0 + (x1 - x0) * (k + 0.5) / n, y1, z0 + (z1 - z0) * (k + 0.5) / n, alongX ? 0 : Math.PI / 2, len / n, 1, 1);
				wall(Math.min(x0, x1) - 0.05, Math.min(z0, z1) - 0.05, Math.max(x0, x1) + 0.05, Math.max(z0, z1) + 0.05, y1, y1 + 1);
			};
			rail(-hx + 0.1, hz - S, -hx + S, hz - S);
			rail(-hx + S, hz - S, -hx + S, sz - 0.6);
			rail(-hx + S, sz + 0.6, -hx + S, hz - 0.1);
			// (the chimney, on up through the floor over)
			wall(fire - 0.5, -hz, fire + 0.5, -hz + 0.82, y1, top);
			furnish('bed', hx - 0.75, y1, -hz + 1.15, 0);
			furnish('nightstand', hx - 1.65, y1, -hz + 0.35, 0);
			put(out.inner, 'candle', hx - 1.65, y1 + 0.6, -hz + 0.35, 0);
			furnish('wardrobe', hx - 0.42, y1, Math.min(-hz + 2.9, hz - 0.8), -Math.PI / 2);
			furnish('rug', 0.6, y1 + 0.005, 0, 0);
			furnish('armchair', -hx + 3.4, y1, -hz + 0.8, 0.3);
		}
		// the rooms on it (see HOW IT GOES TOGETHER at the top)
		for (const r of c.rooms) {
			if (!r.built) continue;
			const [cx, cz] = mid(M, r.i, r.j), dir = sideRaw(M, r.i, r.j), h = headingOf(dir), co = Math.round(Math.cos(h)), si = Math.round(Math.sin(h)), W = CUBE / 2;
			const local = (a, b) => [cx + a * co + b * si, cz - a * si + b * co];
			// (the room beside it on the same side of the hall: at its +W, s 1, or its -W)
			const near = (s) => !!roomAt(r.i + s * co, r.j - s * si);
			put(out.outer, 'block', cx, -(c.at[1] - r.low) / m - 0.4, cz, 0, CUBE + 0.25, (c.at[1] - r.low) / m + 0.38, CUBE + 0.25);
			put(out.inner, 'floorTile', cx, 0.012, cz, 0, CUBE, 1, CUBE);
			put(out.inner, 'floorTile', cx, 2.5, cz, 0, CUBE, 1, CUBE);		// (its ceiling)
			const q = local(-W - 0.1, -W - 0.3), e = local(W + 0.1, W + 0.1);
			floorOf(Math.min(q[0], e[0]), Math.min(q[1], e[1]), Math.max(q[0], e[0]), Math.max(q[1], e[1]));
			const [ox, oz] = local(0, W);
			edge(ox, oz, h, 'window');
			const [sx1, sz1] = local(W, 0), [sx2, sz2] = local(-W, 0);
			edge(sx1, sz1, h + Math.PI / 2, near(1) ? 'inner' : 'wall');
			edge(sx2, sz2, h - Math.PI / 2, near(-1) ? 'inner' : 'wall');
			const [ix, iz] = local(0, -W);
			edge(ix, iz, h + Math.PI, 'gap');
			{ const [bx, bz] = local(W + 0.05, W + 0.05); corner(bx, bz, -0.05, CUBE_UP); }
			if (!near(-1)) { const [bx, bz] = local(-W - 0.05, W + 0.05); corner(bx, bz, -0.05, CUBE_UP); }
			// its roof: on the front or the back of a hall one cube high, its ridge along the hall's wall (under the hall's eave, and none down into it); otherwise its
			//		ridge out from the hall's wall, which stands over it
			const beside = (a, b) => [...(near(1) ? [a] : []), ...(near(-1) ? [b] : [])];
			if (M.h == 1 && dir[0] == 0) roof(cx, cz, h, W, W, CUBE_UP, { ends: beside(1, -1), slopes: [-1] });
			else roof(cx, cz, h - Math.PI / 2, W, W, CUBE_UP, { ends: [-1], slopes: beside(-1, 1) });
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
	if (inventory.isGod()) return { name: `Foundation, ${name}`, keys: 'E build it, free · F take it up' };
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
const needList = (style, stock = {}) => inventory.isGod() ? 'Free: god mode' : Object.entries(needOf(style)).map(([k, n]) => `${(stock[k] ?? 0) ? `${stock[k]} of ` : ''}${n} ${nameOfNeed(k)}`).join(', ');
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
			if (inventory.isGod()) { const c = cabins.get(id); finishFree(c, c.rooms.length - 1); help.toast('Built: free in god mode', 2); return; }
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
	if (inventory.isGod()) { finishFree([...cabins.values()].at(-1), -1); help.toast('Built: free in god mode', 2); return; }
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
		const S = shapeOf(c);
		for (const [x0, z0, x1, z1, y] of S.floors) if (x > x0 && x < x1 && z > z0 && z < z1 && y <= highest) floor = Math.max(floor, y);
		if (S.stair) { const y = stairStep(c, S.stair, x, z); if (y !== null && y <= highest) floor = Math.max(floor, y); }
	}
	return floor;
});
// the top of the stair's step over (x, z) (the world's), or null: off it
function stairStep(c, [sx, sz], wx, wz) {
	const m = metre(), h = c.turn * Math.PI / 2, co = Math.round(Math.cos(h)), si = Math.round(Math.sin(h));
	const dx = (wx - c.at[0]) / m, dz = (wz - c.at[2]) / m, x = dx * co - dz * si - sx, z = dx * si + dz * co - sz;
	if (Math.hypot(x, z) > STAIR_RADIUS + 0.05) return null;
	const rel = ((Math.atan2(x, z) - STAIR_FROM) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
	return c.at[1] + (Math.min(Math.floor(rel / STAIR_TURN), STAIR_STEPS - 1) + 1) * STAIR_RISE * m;
}
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
