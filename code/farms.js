import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import * as props from './props.js'
import * as atmosphere from './atmosphere.js'
import * as survivalNet from './survivalNet.js'
import { setGrassHoles } from './computeGrass.js'
import { seasonNow, SEASON_WINTER } from './weather.js'
import { makeItem } from './items.js'
import * as inventory from './inventory.js'
import * as loot from './loot.js'

/*
	THE FARM BEDS of the Survival mode. A hoe's click (survivalTools.js) digs one on the ground in front of the walker, on the grid (BED metres a side, the whole world's): the grass goes (computeGrass.js: setGrassHoles), a bed of dirt is raised
	(farmBed: workMeshes.js) and wheat starts in it. It takes GROW days to come ripe, through four stages, each its own model: in the winter it hardly grows (WINTER times as fast). E at it ripe: HARVEST wheat, and it starts again. A hoe's click at a bed digs it out.
	IN A GAME (survivalNet.js) the host keeps them, growing each by the world's clock: a joiner asks (farmDig, farmOut, farmReap: what came of it back, farmGot), and everyone is told of each as it changes stage (farmIs), and when one goes (farmDel); a joiner come in, of all of them.
	The host's are kept in its browser with the rest of what is built (cabins.js: its save).
*/
export const BED = 2.4;				// metres
const GROW = 2;						// days
const WINTER = 0.2;
const STAGES = ['wheat1', 'wheat2', 'wheat3', 'wheat4'];
const HARVEST = 3;
const REACH = 3.5;					// metres
const AHEAD = 2.2;					// metres
const LEVEL = 0.5;					// metres the ground may rise across one
const DRAW = 180;					// metres

const metre = () => settings.forestUnitsPerMetre;
const clock = () => atmosphere.sunCycles;
const beds = new Map();				// 'i,j' -> { key, i, j, at, grown (0 to 1), told }
export const farmStats = { dug: 0, reaped: 0 };
const stageOf = (b) => Math.min(Math.floor(b.grown * STAGES.length), STAGES.length - 1);
const ripe = (b) => b.grown >= 1;
const share = (b) => ({ key: b.key, i: b.i, j: b.j, at: b.at, grown: b.grown });
const holes = () => setGrassHoles('farms', [...beds.values()].map((b) => [b.at[0], b.at[2], BED * 0.5 * metre(), BED * 0.5 * metre()]));
function told(b) { b.told = stageOf(b); survivalNet.send('farmIs', share(b)); changed(); }
const listeners = [];
export function onChange(fn) { listeners.push(fn); }
const changed = () => { for (const fn of listeners) fn(); };

function spot() {
	const p = hunting.hunterPlace(), m = metre(), size = BED * m;
	const x = p.x + Math.sin(settings.camYaw) * AHEAD * m, z = p.z - Math.cos(settings.camYaw) * AHEAD * m;
	const i = Math.floor(x / size), j = Math.floor(z / size);
	return { i, j, x: (i + 0.5) * size, z: (j + 0.5) * size };
}
function hostDig(i, j) {
	const m = metre(), size = BED * m, x = (i + 0.5) * size, z = (j + 0.5) * size, key = i + ',' + j, land = terrain.land;
	if (beds.has(key) || !land) return false;
	const hs = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, 0]].map(([a, b]) => land.heightAt(x + a * size, z + b * size));
	if (Math.max(...hs) - Math.min(...hs) > LEVEL * m || Math.min(...hs) < settings.waterWorldPosY + 0.1 * m) return false;
	const b = { key, i, j, at: [x, hs.reduce((a, c) => a + c, 0) / hs.length, z], grown: 0 };
	beds.set(key, b);
	farmStats.dug++;
	holes();
	told(b);
	return true;
}
function hostOut(key) {
	if (!beds.delete(key)) return false;
	holes();
	survivalNet.send('farmDel', { key });
	changed();
	return true;
}
// the bed the walker is in front of, or null
export function bedInView() {
	if (!inventory.survivalOn()) return null;
	const p = hunting.hunterPlace(), m = metre();
	if (!p.active || p.on != 'land') return null;
	const look = [Math.sin(settings.camYaw), -Math.cos(settings.camYaw)];
	let best = null, bestD = REACH;
	for (const b of beds.values()) {
		const dx = (b.at[0] - p.x) / m, dz = (b.at[2] - p.z) / m, d = Math.hypot(dx, dz);
		if (d < bestD && (d < 1.2 || (dx * look[0] + dz * look[1]) / d > 0.75)) { best = b; bestD = d; }
	}
	return best;
}
// A HOE'S CLICK (see the top): true if it did something
export function hoeClick() {
	const b = bedInView();
	if (b) {
		if (survivalNet.authority()) hostOut(b.key); else survivalNet.send('farmOut', { key: b.key });
		help.toast('Bed dug out');
		return true;
	}
	const p = hunting.hunterPlace();
	if (p.on != 'land' || p.swimming) { help.toast('On firm ground'); return false; }
	const s = spot();
	if (survivalNet.authority()) { const ok = hostDig(s.i, s.j); help.toast(ok ? 'A bed dug, wheat sown: it takes two days, and hardly grows in the winter' : 'Not on this ground: too steep, or too wet', 2.4); return ok; }
	survivalNet.send('farmDig', { i: s.i, j: s.j });
	help.toast('A bed dug, wheat sown', 1.6);
	return true;
}
// E AT ONE RIPE (see the top)
function hostReap(key) {
	const b = beds.get(key);
	if (!b || !ripe(b)) return 0;
	b.grown = 0;
	farmStats.reaped++;
	told(b);
	return HARVEST;
}
function got(n) {
	if (!n) { help.toast('It is not ripe yet'); return; }
	const w = makeItem('wheat', n);
	if (!inventory.give(w)) loot.dropHere([w]);
	help.toast(`${n} wheat, and the bed sown again`, 2);
}
hunting.onUse(() => {
	const b = bedInView();
	if (!b) return false;
	if (survivalNet.authority()) got(hostReap(b.key));
	else survivalNet.send('farmReap', { key: b.key });
	return true;
});
hunting.addPrompt(() => {
	const b = bedInView();
	if (!b) return null;
	return ripe(b) ? { name: 'Wheat, ripe', keys: 'E harvest' } : { name: `Wheat, ${Math.round(b.grown * 100)}% grown${seasonNow.index == SEASON_WINTER ? ' (hardly growing: it is winter)' : ''}`, keys: 'A hoe: dig it out' };
});
survivalNet.on('farmDig', (m) => { if (survivalNet.authority()) hostDig(Number(m.i) | 0, Number(m.j) | 0); });
survivalNet.on('farmOut', (m) => { if (survivalNet.authority()) hostOut(String(m.key)); });
survivalNet.on('farmReap', (m, from) => { if (survivalNet.authority()) survivalNet.sendTo(from, 'farmGot', { n: hostReap(String(m.key)) }); });
survivalNet.on('farmGot', (m) => got(Number(m.n) || 0));
survivalNet.on('farmIs', (m) => { if (!survivalNet.authority() && Array.isArray(m.at)) { beds.set(m.key, { key: m.key, i: m.i, j: m.j, at: m.at.map(Number), grown: Number(m.grown) || 0 }); holes(); } });
survivalNet.on('farmDel', (m) => { if (!survivalNet.authority()) { beds.delete(m.key); holes(); } });
survivalNet.onJoin((id) => { for (const b of beds.values()) survivalNet.sendTo(id, 'farmIs', share(b)); });

// SAVED (cabins.js)
export const farmsSave = () => [...beds.values()].map(share);
export function farmsLoad(list) {
	beds.clear();
	for (const b of list ?? []) if (Array.isArray(b.at)) beds.set(b.key, { key: b.key, i: b.i, j: b.j, at: b.at.map(Number), grown: Number(b.grown) || 0, told: 0 });
	holes();
}

// Once a frame: grown (the host's), and drawn
let lastClock = null;
export function farmsUpdate() {
	if (!inventory.survivalOn()) return;
	const days = lastClock === null ? 0 : Math.max(clock() - lastClock, 0);
	lastClock = clock();
	const rate = (seasonNow.index == SEASON_WINTER ? WINTER : 1) / GROW;
	const m = metre(), cx = settings.camPosX, cz = settings.camPosZ, reach = DRAW * m;
	for (const b of beds.values()) {
		if (survivalNet.authority() && !ripe(b)) {
			b.grown = Math.min(b.grown + rate * days, 1);
			if (stageOf(b) !== b.told || ripe(b)) told(b);
		}
		if (Math.abs(b.at[0] - cx) > reach || Math.abs(b.at[2] - cz) > reach) continue;
		const model = props.place(b.at, 0);
		props.show('farmBed', model);
		props.show(STAGES[stageOf(b)], model);
	}
}
export const farmsForTest = () => [...beds.values()].map((b) => ({ key: b.key, at: b.at, grown: b.grown, stage: stageOf(b) }));
export function growForTest(key, grown) { const b = beds.get(key); if (b) { b.grown = grown; told(b); } }
