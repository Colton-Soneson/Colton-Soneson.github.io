import { settings } from './settings.js';

import * as terrain from './terrain.js'
import { MOUNTAIN_THRESHOLD } from './terrainGenerator.js'
import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import * as props from './props.js'
import * as boulders from './boulders.js'
import * as smoke from './smoke.js'
import * as weapons from './weapons.js'
import * as atmosphere from './atmosphere.js'
import * as transformations from './transformations.js'
import * as survivalNet from './survivalNet.js'
import { makeItem } from './items.js'
import * as inventory from './inventory.js'
import * as loot from './loot.js'

/*
	WHAT IS TAKEN OUT OF THE LAND in the Survival mode, the same places on every machine (drawn from the land):
		VEINS		of iron ore, on the sides of the mountains, low down in the ranges (VEIN_BAND over where the range proper starts: their forest, and their bare rock), on ground steep enough to be a mountainside. Three sizes (SIZES, workMeshes.js).
					A pickaxe's blows (HITS) break out a lump of iron ore, until it has no more in it (each size its own): gone, it comes back VEIN_BACK days on
		BOULDERS	(boulders.js) a pickaxe's blows (HITS) break out a stone (ROCK), and now and then some throwing stones. A boulder is not used up
		MUSHROOMS	on the forest floor, in clumps: E picks one. It comes back MUSHROOM_BACK days on
	IN A GAME (survivalNet.js) the host keeps what is left of each (veinHit, mushroomPick: what came of it back, oreGot, mushroomGot) and tells everyone of what has gone and what has come back (landTaken). A joiner come in is told of all of it.
*/
const VEINS = 90, MUSHROOMS = 260;
const VEIN_BAND = 90;				// metres
const VEIN_SLOPE = 0.16;			// how far off level the ground must be
const SIZES = [{ model: 'oreSmall', ore: 3, r: 0.8 }, { model: 'oreMid', ore: 6, r: 1.4 }, { model: 'oreBig', ore: 10, r: 2.2 }];
const HITS = { ore: 4, rock: 3 };	// blows
const STONES = { chance: 0.45, most: 3 };
const VEIN_BACK = 4, MUSHROOM_BACK = 2;	// days
const REACH = 3.8;					// metres
const DRAW = 260, DRAW_SMALL = 70;	// metres
const PICK_REACH = 2.2;

const metre = () => settings.forestUnitsPerMetre;
const clock = () => atmosphere.sunCycles;
let builtFor = null, veins = [], mushrooms = [];
export const miningStats = { veins: 0, mushrooms: 0, ore: 0, rock: 0, stones: 0, picked: 0 };
// (in a world of tiles, terrain.js: each tile of land's own, numbered by its tile and its place, the home tile's as the one land's. A tile
//		gone, what was taken from its veins and its mushrooms kept for when it comes again, and in the save file)
const veinById = new Map(), mushroomById = new Map();
const minedMemory = new Map();		// a vein's id -> ore left, or a mushroom's ('m' and its id) -> when it is back, while its tile is not here
function build() {
	const land = terrain.land;
	builtFor = land;
	veins = []; mushrooms = []; veinById.clear(); mushroomById.clear(); minedMemory.clear();
	for (const here of terrain.landsHere()) buildOf(here.land, here.key);
}
terrain.onTiles((added, removed) => {
	if (builtFor !== terrain.land) return;
	for (const v of veins) if (removed.includes(v.tile)) { if (v.ore < SIZES[v.size].ore) minedMemory.set(v.id, v.ore); veinById.delete(v.id); }
	for (const s of mushrooms) if (removed.includes(s.tile)) { if (!mushroomUp(s)) minedMemory.set('m' + s.id, s.backAt); mushroomById.delete(s.id); }
	veins = veins.filter((v) => !removed.includes(v.tile));
	mushrooms = mushrooms.filter((s) => !removed.includes(s.tile));
	for (const here of terrain.landsHere()) if (added.includes(here.key)) buildOf(here.land, here.key);
});
function buildOf(land, tile) {
	const m = metre(), name = (k) => tile == 'land' || tile == '0,0' ? k : tile + ':' + k;
	// (the lowest of the ranges: how high the mountains start, by what is found of them. The bare mountain, and the forest up in a range)
	const spots = land.findSpawnPoints(terrain.ZONE_MOUNTAIN, VEINS * 14, { seed: 7741, minSpacing: 30, maxSlope: 1.5 })
		.concat(land.findSpawnPoints(terrain.ZONE_FOREST, VEINS * 14, { seed: 7742, minSpacing: 30, maxSlope: 1.5 }).filter((s) => land.rangeAt(s.x, s.z) >= MOUNTAIN_THRESHOLD));
	const heights = spots.map((s) => land.heightAt(s.x, s.z)).sort((a, b) => a - b), foot = heights[Math.floor(heights.length * 0.08)] ?? 0;
	const low = spots.filter((s) => {
		const y = land.heightAt(s.x, s.z);
		return y < foot + VEIN_BAND * m && 1 - (s.normal?.[1] ?? 1) > VEIN_SLOPE * 0.3 && y > settings.waterWorldPosY + 2 * m;
	});
	const newVeins = low.slice(0, VEINS).map((s, k) => {
		const r = Math.abs(Math.sin(k * 12.9898) * 43758.5453) % 1, size = r < 0.45 ? 0 : r < 0.82 ? 1 : 2, n = s.normal ?? [0, 1, 0];
		// (sunk into the slope, tilted with it)
		const pitch = Math.atan2(Math.hypot(n[0], n[2]), n[1]) * 0.6, heading = Math.atan2(n[0], n[2]);
		return { id: name(k), tile, x: s.x, y: land.heightAt(s.x, s.z) - SIZES[size].r * 0.12 * m, z: s.z, size, ore: SIZES[size].ore, heading, pitch, backAt: -1 };
	});
	const newMushrooms = land.findSpawnPoints(terrain.ZONE_FOREST, MUSHROOMS, { seed: 3313, minSpacing: 14, maxSlope: 0.5 }).map((s, k) => ({ id: name(k), tile, x: s.x, y: land.heightAt(s.x, s.z), z: s.z, heading: k * 2.1, backAt: -1 }));
	for (const v of newVeins) { if (minedMemory.has(v.id)) { v.ore = minedMemory.get(v.id); minedMemory.delete(v.id); } veinById.set(v.id, v); }
	for (const s of newMushrooms) { if (minedMemory.has('m' + s.id)) { s.backAt = minedMemory.get('m' + s.id); minedMemory.delete('m' + s.id); } mushroomById.set(s.id, s); }
	veins.push(...newVeins);
	mushrooms.push(...newMushrooms);
	miningStats.veins = veins.length;
	miningStats.mushrooms = mushrooms.length;
}
const here = () => { if (terrain.land && builtFor !== terrain.land) build(); return !!terrain.land; };
export const veinOut = (v) => v.ore > 0;
const mushroomUp = (s) => s.backAt < 0;

// THE BLOWS: a pickaxe's (survivalTools.js): true if it hit something it is for
let aimed = null, count = 0;
function blowOn(key, need) {
	if (aimed !== key) { aimed = key; count = 0; }
	if (++count < need) return false;
	count = 0;
	return true;
}
export function veinInView(eye, f) {
	if (!here()) return null;
	const m = metre();
	let best = null, bestD = Infinity;
	for (const v of veins) {
		if (!veinOut(v) || Math.abs(v.x - eye[0]) > 8 * m || Math.abs(v.z - eye[2]) > 8 * m) continue;
		const r = SIZES[v.size].r, to = [v.x - eye[0], v.y + r * 0.4 * m - eye[1], v.z - eye[2]], d = Math.hypot(...to);
		if (d > (REACH + r) * m) continue;
		const along = to[0] * f[0] + to[1] * f[1] + to[2] * f[2], miss = Math.sqrt(Math.max(d * d - along * along, 0));
		if (along > 0 && miss < (r + 0.35) * m && d < bestD) { best = v; bestD = d; }
	}
	return best;
}
function boulderInView(eye, f) {
	const m = metre();
	let found = null, bestD = Infinity;
	boulders.bouldersNear(eye[0], eye[2], (REACH + 3) * m, (x, z, half, bottom, top) => {
		const y = Math.min(Math.max(eye[1], bottom), top), to = [x - eye[0], y - eye[1], z - eye[2]], d = Math.hypot(...to);
		const along = to[0] * f[0] + to[1] * f[1] + to[2] * f[2], miss = Math.sqrt(Math.max(d * d - along * along, 0));
		if (along > 0 && miss < half + 0.3 * m && d - half < REACH * m && d < bestD) { found = { x, y, z }; bestD = d; }
	});
	return found;
}
const dust = (at) => { for (let k = 0; k < 3; k++) smoke.addPuff({ at, v: [(Math.random() - 0.5) * 1.4, 0.6, (Math.random() - 0.5) * 1.4], size: 0.1, grow: 2, life: 0.8, kind: 2, rise: 0.1 }); };
export function pickBlow(eye, f) {
	const v = veinInView(eye, f);
	if (v) {
		weapons.actionSound('knock');
		dust([v.x, v.y + SIZES[v.size].r * 0.5 * metre(), v.z]);
		if (!blowOn('v' + v.id, HITS.ore)) { help.toast(`Breaking out ore: ${count} of ${HITS.ore}`, 0.7); return true; }
		if (survivalNet.authority() || survivalNet.away()) oreGot(hostOre(v.id));
		else survivalNet.send('veinHit', { id: v.id });
		return true;
	}
	const b = boulderInView(eye, f);
	if (b) {
		weapons.actionSound('knock');
		dust([b.x, b.y, b.z]);
		if (!blowOn('b' + Math.round(b.x) + ',' + Math.round(b.z), HITS.rock)) { help.toast(`Breaking stone: ${count} of ${HITS.rock}`, 0.7); return true; }
		const rock = makeItem('rock');
		if (!inventory.give(rock)) loot.dropHere([rock]);
		miningStats.rock++;
		let said = 'Stone';
		if (Math.random() < STONES.chance) {
			const n = 1 + Math.floor(Math.random() * STONES.most), s = makeItem('stone', n);
			if (!inventory.give(s)) loot.dropHere([s]);
			miningStats.stones += n;
			said += ` and ${n} throwing stone${n > 1 ? 's' : ''}`;
		}
		help.toast(said, 1.5);
		return true;
	}
	return false;
}
function hostOre(id) {
	const v = veinById.get(id);
	if (!v || !veinOut(v)) return false;
	v.ore--;
	if (v.ore <= 0) { v.backAt = clock() + VEIN_BACK; told(); }
	return true;
}
function oreGot(ok) {
	if (!ok) { help.toast('There is no more in it'); return; }
	const ore = makeItem('ironOre');
	if (!inventory.give(ore)) loot.dropHere([ore]);
	miningStats.ore++;
	help.toast('Iron ore', 1.5);
}
survivalNet.on('veinHit', (msg, from) => { if (survivalNet.authority() && here()) survivalNet.sendTo(from, 'oreGot', { ok: hostOre(typeof msg.id == 'string' ? msg.id : Number(msg.id)) }); });
survivalNet.on('oreGot', (msg) => oreGot(!!msg.ok));

// THE MUSHROOMS (see the top)
export function mushroomInView() {
	if (!inventory.survivalOn() || !here()) return null;
	const p = hunting.hunterPlace(), m = metre();
	if (!p.active || p.on != 'land') return null;
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ], f = transformations.getCameraForward();
	let best = null, bestOff = 0.06;
	for (const s of mushrooms) {
		if (!mushroomUp(s) || Math.abs(s.x - p.x) > PICK_REACH * 1.6 * m || Math.abs(s.z - p.z) > PICK_REACH * 1.6 * m) continue;
		const to = [s.x - eye[0], s.y + 0.1 * m - eye[1], s.z - eye[2]], d = Math.hypot(...to), off = 1 - (to[0] * f[0] + to[1] * f[1] + to[2] * f[2]) / (d || 1);
		if (d < (PICK_REACH + 0.8) * m && off < bestOff) { best = s; bestOff = off; }
	}
	return best;
}
function hostMushroom(id) {
	const s = mushroomById.get(id);
	if (!s || !mushroomUp(s)) return false;
	s.backAt = clock() + MUSHROOM_BACK;
	told();
	return true;
}
function mushroomGot(ok) {
	if (!ok) return;
	const it = makeItem('mushroom');
	if (!inventory.give(it)) loot.dropHere([it]);
	miningStats.picked++;
	help.toast('A mushroom', 1.2);
}
hunting.onUse(() => {
	const s = mushroomInView();
	if (!s) return false;
	if (survivalNet.authority() || survivalNet.away()) mushroomGot(hostMushroom(s.id));
	else survivalNet.send('mushroomPick', { id: s.id });
	return true;
});
hunting.addPrompt(() => mushroomInView() ? { name: 'Mushrooms', keys: 'E pick' } : null);
survivalNet.on('mushroomPick', (msg, from) => { if (survivalNet.authority() && here()) survivalNet.sendTo(from, 'mushroomGot', { ok: hostMushroom(typeof msg.id == 'string' ? msg.id : Number(msg.id)) }); });
survivalNet.on('mushroomGot', (msg) => mushroomGot(!!msg.ok));
hunting.addPrompt(() => {
	if (!inventory.survivalOn() || !here() || weapons.weaponState.current != 'pickaxe') return null;
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ], f = transformations.getCameraForward(), v = veinInView(eye, f);
	return v ? { name: `Vein of iron ore (${v.ore} left)`, keys: 'Left click: break some out' } : boulderInView(eye, f) ? { name: 'Boulder', keys: 'Left click: break out stone' } : null;
});

// WHAT HAS GONE (see the top): everyone told, the lists whole (they are short: only what is gone)
const shareOf = () => ({ veins: veins.filter((v) => v.ore < SIZES[v.size].ore).map((v) => [v.id, v.ore]), gone: mushrooms.filter((s) => !mushroomUp(s)).map((s) => s.id) });
let toTell = 0;
function told() { toTell = 0.5; }
// (the save file's: saveGame.js): the veins worked, and the mushrooms picked (when they come back)
export const miningRecord = () => ({ veins: [...veins.filter((v) => v.ore < SIZES[v.size].ore).map((v) => [v.id, v.ore]), ...[...minedMemory].filter(([id]) => !String(id).startsWith('m')).map(([id, ore]) => [id, ore])],
	mushrooms: [...mushrooms.filter((s) => !mushroomUp(s)).map((s) => [s.id, s.backAt]), ...[...minedMemory].filter(([id]) => String(id).startsWith('m')).map(([id, at]) => [String(id).slice(1), at])] });
// (the host's: the veins and mushrooms a joiner away has kept, for the save, net.js; and a joiner's, of the tiles it is away on)
export function minesHeard(r) {
	for (const [id, ore] of r?.veins ?? []) { const v = veinById.get(id); if (v) v.ore = Math.max(0, Number(ore) || 0); else minedMemory.set(id, Math.max(0, Number(ore) || 0)); }
	for (const [id, backAt] of r?.mushrooms ?? []) { const s = mushroomById.get(id); if (s) s.backAt = Number(backAt) || 0; else minedMemory.set('m' + id, Number(backAt) || 0); }
}
export const minesOfTiles = (keys) => ({ veins: veins.filter((v) => keys.includes(v.tile) && v.ore < SIZES[v.size].ore).map((v) => [v.id, v.ore]), mushrooms: mushrooms.filter((s) => keys.includes(s.tile) && !mushroomUp(s)).map((s) => [s.id, s.backAt]) });
export const miningReady = () => veins.length > 0 || mushrooms.length > 0;
export function miningAdopt(r) {
	for (const v of veins) v.ore = SIZES[v.size].ore;
	for (const [id, ore] of r?.veins ?? []) { const v = veinById.get(id); if (v) v.ore = Math.max(0, Number(ore) || 0); else minedMemory.set(id, Math.max(0, Number(ore) || 0)); }
	for (const s of mushrooms) s.backAt = -1;
	for (const [id, backAt] of r?.mushrooms ?? []) { const s = mushroomById.get(id); if (s) s.backAt = Number(backAt) || 0; else minedMemory.set('m' + id, Number(backAt) || 0); }
	told();
}
survivalNet.on('landTaken', (msg) => {
	if (survivalNet.authority() || survivalNet.away() || !here()) return;
	for (const v of veins) v.ore = SIZES[v.size].ore;
	for (const [id, ore] of msg.veins ?? []) { const v = veinById.get(id); if (v) v.ore = Number(ore); }
	for (const s of mushrooms) s.backAt = -1;
	for (const id of msg.gone ?? []) { const s = mushroomById.get(id); if (s) s.backAt = 1; }
});
survivalNet.onJoin((id) => { if (here()) survivalNet.sendTo(id, 'landTaken', shareOf()); });

// Once a frame: what has come back, and what is near drawn
let lastTime = performance.now(), checkIn = 0;
export function miningUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (!inventory.survivalOn() || !here()) return;
	if (survivalNet.authority()) {
		if ((checkIn -= dt) <= 0) {
			checkIn = 2;
			const t = clock();
			for (const v of veins) if (!veinOut(v) && t >= v.backAt) { v.ore = SIZES[v.size].ore; v.backAt = -1; told(); }
			for (const s of mushrooms) if (!mushroomUp(s) && t >= s.backAt) { s.backAt = -1; told(); }
		}
		if (toTell > 0 && (toTell -= dt) <= 0) survivalNet.send('landTaken', shareOf());
	}
	const m = metre(), cx = settings.camPosX, cz = settings.camPosZ, far = DRAW * m, close = DRAW_SMALL * m;
	for (const v of veins) if (veinOut(v) && Math.abs(v.x - cx) < far && Math.abs(v.z - cz) < far) props.show(SIZES[v.size].model, props.place([v.x, v.y, v.z], v.heading, v.pitch));
	for (const s of mushrooms) if (mushroomUp(s) && Math.abs(s.x - cx) < close && Math.abs(s.z - cz) < close) props.show('mushroom', props.place([s.x, s.y, s.z], s.heading));
}
export const veinsForTest = () => veins;
export const mushroomsForTest = () => mushrooms;
export const miningForTest = () => ({ ...miningStats, sizes: veins.reduce((a, v) => { a[v.size]++; return a; }, [0, 0, 0]), gone: mushrooms.filter((s) => !mushroomUp(s)).length });
