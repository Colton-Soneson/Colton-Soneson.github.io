import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as transformations from './transformations.js'
import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import * as smoke from './smoke.js'
import * as pointLights from './pointLights.js'
import * as props from './props.js'
import * as atmosphere from './atmosphere.js'
import * as survivalNet from './survivalNet.js'
import { setGrassFlats } from './computeGrass.js'
import * as inventory from './inventory.js'
import * as survival from './survival.js'
import * as camp from './camp.js'

/*
	THE CAMPFIRES of the Survival mode. One is BUILT from firewood (the inventory screen: right click, Build campfire), laid in front of the
	walker: the wood stacked in a ring of stones, not burning. It is LIT with the lighter (survivalTools.js: the lighter's click, at it), and
	more wood is put on it with E (one firewood each, WOOD of burning). Its fuel burns down by the world's clock (atmosphere.js: sunCycles,
	in days: one world clock), so it burns down as fast as the days go, and through a night slept away (survival.js) too. FULL is the most
	it holds: 8.5 hours, a little over a third of a day. As it burns it goes through its STAGES, each its own model (itemMeshes.js), its own
	flames, smoke and sparks (smoke.js), light (pointLights.js) and warmth (survival.js: setFireNear):
		full		more than STAGE.full of FULL left: tall flames, a bright light, the most warmth
		half		more than STAGE.half: the logs burnt down, lower flames
		embers		anything left: no flames, a glow, a thread of smoke, a little warmth
		dead		burnt out: ash and the stubs of the logs, cold. Wood put on it is laid ready to be lit again
	Wood put on one burning raises its stage straight away. Raw venison (survivalTools.js) is COOKED at one burning, within COOK_REACH: X at
	it (all of it carried), or the inventory screen's right click (that one stack).
	In a game (survivalNet.js) the host keeps them: a joiner's building, wood and lighting are asked for (fireBuild, fireWood, fireLight), and
	everyone is told each one as it is (fireIs: where, its fuel as of when, whether it burns), and when one goes (fireDel: burnt out and
	left GONE days); a joiner come in, of all of them.
*/
export const FULL = 8.5 / 24;			// days of fuel: the most it holds
const WOOD = 2.5 / 24;					// days of fuel a firewood gives
const STAGE = { full: 0.5, half: 0.18 };	// shares of FULL
const GONE = 2;							// days a dead one stays
const REACH = 2.6;						// metres it is worked from
const BUILD_AHEAD = 1.6;				// metres in front it is built
const COOK_REACH = 3;					// metres from one burning that venison is cooked
const BURNING = ['full', 'half', 'embers'];
const NEAR = 7;							// metres its warmth reaches
const WARMTH = { full: 20, half: 13, embers: 6, laid: 0, dead: 0 };	// °C
const LIGHT = { full: [10, 2.4, [1.0, 0.56, 0.22]], half: [7, 1.6, [1.0, 0.5, 0.18]], embers: [3.5, 0.7, [1.0, 0.3, 0.08]] };	// metres, strength, colour
const MODELS = { full: 'campfireFull', half: 'campfireHalf', embers: 'campfireEmbers', dead: 'campfireDead', laid: 'campfireLaid' };

const fires = new Map();		// id -> { id, at, fuel (days, as of since), since (sunCycles), lit, born }
export const fireStats = { built: 0, lit: 0, wood: 0, cooked: 0 };
const metre = () => settings.forestUnitsPerMetre;
const clock = () => atmosphere.sunCycles;
export const fuelOf = (f) => f.lit ? Math.max(f.fuel - (clock() - f.since), 0) : f.fuel;
export function stageOf(f) {
	const left = fuelOf(f);
	if (!f.lit || left <= 0) return left > 0 ? 'laid' : 'dead';
	return left > STAGE.full * FULL ? 'full' : left > STAGE.half * FULL ? 'half' : 'embers';
}
const share = (f) => ({ id: f.id, at: f.at, fuel: fuelOf(f), since: clock(), lit: f.lit && fuelOf(f) > 0, born: f.born });
function told(f) { survivalNet.send('fireIs', share(f)); }

// BUILT, LIT, MORE WOOD (see the top): asked of the host, or done here
export function build(at) {
	if (!survivalNet.authority()) { survivalNet.send('fireBuild', { at }); return; }
	const f = { id: 'f' + Math.floor(Math.random() * 1e9), at, fuel: WOOD, since: clock(), lit: false, born: clock() };
	fires.set(f.id, f);
	fireStats.built++;
	told(f);
}
export function light(id) {
	if (!survivalNet.authority()) { survivalNet.send('fireLight', { id }); return; }
	const f = fires.get(id);
	if (!f || f.lit || f.fuel <= 0) return;
	Object.assign(f, { lit: true, since: clock() });
	fireStats.lit++;
	told(f);
}
export function addWood(id) {
	if (!survivalNet.authority()) { survivalNet.send('fireWood', { id }); return; }
	const f = fires.get(id);
	if (!f) return;
	Object.assign(f, { fuel: Math.min(fuelOf(f) + WOOD, FULL), since: clock() });
	if (fuelOf(f) > 0 && stageOf(f) == 'dead') f.lit = false;
	fireStats.wood++;
	told(f);
}
survivalNet.on('fireBuild', (m) => { if (Array.isArray(m.at)) build(m.at.map(Number)); });
survivalNet.on('fireLight', (m) => light(m.id));
survivalNet.on('fireWood', (m) => addWood(m.id));
survivalNet.on('fireIs', (m) => { if (!survivalNet.authority()) fires.set(m.id, { id: m.id, at: m.at.map(Number), fuel: Number(m.fuel), since: Number(m.since), lit: !!m.lit, born: Number(m.born) }); });
survivalNet.on('fireDel', (m) => fires.delete(m.id));
survivalNet.onJoin((id) => { for (const f of fires.values()) survivalNet.sendTo(id, 'fireIs', share(f)); });

// where one is built: the ground in front, out of the water
export function buildSpot() {
	const p = hunting.hunterPlace(), m = metre(), land = terrain.land;
	if (p.on != 'land' || p.swimming) return null;
	const x = p.x + Math.sin(settings.camYaw) * BUILD_AHEAD * m, z = p.z - Math.cos(settings.camYaw) * BUILD_AHEAD * m, y = land.heightAt(x, z);
	return y > settings.waterWorldPosY + 0.1 * m && Math.abs(y - p.y) < 1.2 * m ? [x, y, z] : null;
}
// the one looked at, within REACH
export function inView() {
	if (!inventory.survivalOn()) return null;
	const p = hunting.hunterPlace(), m = metre();
	if (!p.active || p.on != 'land') return null;
	const look = [Math.sin(settings.camYaw), -Math.cos(settings.camYaw)];
	let best = null, bestD = REACH;
	for (const f of fires.values()) {
		const dx = (f.at[0] - p.x) / m, dz = (f.at[2] - p.z) / m, d = Math.hypot(dx, dz);
		if (d < bestD && (d < 0.8 || (dx * look[0] + dz * look[1]) / d > 0.6)) { best = f; bestD = d; }
	}
	return best;
}
const firewood = () => inventory.everything().find(({ item }) => item.type == 'firewood')?.item ?? null;
hunting.onUse(() => {
	const f = inView();
	if (!f) return false;
	const wood = firewood();
	if (!wood) { help.toast('No firewood: chop some with a hatchet'); return true; }
	inventory.useOne(wood);
	addWood(f.id);
	help.toast(stageOf(f) == 'dead' || !f.lit ? 'Wood laid: light it with the lighter' : 'More wood on the fire');
	return true;
});
// COOKED (see the top): one burning near enough, and the raw venison (that stack, or all of it) cooked
export function burningNear() {
	const p = hunting.hunterPlace(), m = metre();
	return [...fires.values()].find((f) => BURNING.includes(stageOf(f)) && Math.hypot(f.at[0] - p.x, f.at[2] - p.z) / m < COOK_REACH) ?? camp.burningNear(p.x, p.z, COOK_REACH);		// (or a tent's stove)
}
const rawMeat = () => inventory.everything().filter(({ item }) => item.type == 'venison').map(({ item }) => item);
export function cook(only = null) {
	const raw = only ? [only] : rawMeat();
	if (!raw.length) { help.toast('No raw venison to cook'); return false; }
	if (!burningNear()) { help.toast('Cook it at a burning campfire'); return false; }
	let n = 0;
	for (const item of raw) { item.type = 'cookedVenison'; n += item.count; }
	inventory.changed();
	fireStats.cooked += n;
	help.toast('Cooked venison' + (n > 1 ? ' (' + n + ')' : ''));
	return true;
}
window.addEventListener('keydown', (e) => {
	if (e.code == 'KeyX' && !e.repeat && inventory.survivalOn() && document.pointerLockElement && !hunting.input.menuOpen && (inView() || camp.stoveInView())) cook();
});
const NAMES = { full: 'Campfire, burning well', half: 'Campfire, burning low', embers: 'Campfire, embers', dead: 'Campfire, burnt out', laid: 'Campfire, laid' };
hunting.addPrompt(() => {
	const f = inView();
	if (!f) return null;
	const s = stageOf(f), hours = fuelOf(f) * 24;
	return { name: NAMES[s] + (s != 'dead' ? ` (${hours.toFixed(1)} h of wood)` : ''), keys: 'E add wood' + (s == 'laid' ? ' · the lighter: light it' : '') + (BURNING.includes(s) && rawMeat().length ? ' · X cook venison' : '') };
});

// THE WARMTH AND THE CALM round them (survival.js)
survival.setFireNear((x, y, z) => {
	const m = metre();
	let warmth = 0, calm = 0;
	for (const f of fires.values()) {
		const s = stageOf(f), d = Math.hypot(f.at[0] - x, f.at[1] - y, f.at[2] - z) / m;
		warmth = Math.max(warmth, WARMTH[s] * Math.min(Math.max(1 - (d - 1) / NEAR, 0), 1));
		if (d < 5 && WARMTH[s] > 0) calm = 1;
	}
	return { warmth, calm };
});

// Once a frame: each drawn as it is, its flames and smoke, the nearest few lit; the burnt out long ago gone
let puffClock = 0, lastTime = performance.now();
export function campfiresUpdate() {
	const dt = Math.min((performance.now() - lastTime) / 1000, 0.1);
	lastTime = performance.now();
	if (!inventory.survivalOn()) { for (let k = 0; k < 3; k++) pointLights.setMovingLight('campfire' + k, null); return; }
	const m = metre(), now = performance.now() / 1000;
	const near = [];
	for (const f of [...fires.values()]) {
		const s = stageOf(f);
		if (survivalNet.authority()) {
			if (f.lit && s == 'dead') { f.lit = false; f.fuel = 0; f.since = clock(); told(f); }
			if (s == 'dead' && clock() - f.since > GONE) { fires.delete(f.id); survivalNet.send('fireDel', { id: f.id }); continue; }
		}
		const d = Math.hypot(f.at[0] - settings.camPosX, f.at[2] - settings.camPosZ) / m;
		if (d > 300) continue;
		props.show(MODELS[s], props.place(f.at, (f.id.charCodeAt(3) ?? 0) * 0.7));
		near.push({ f, s, d });
	}
	puffClock += dt;
	const puffs = puffClock > 0.05;
	if (puffs) puffClock = 0;
	for (const { f, s, d } of near) {
		if (!puffs || d > 160) continue;
		const at = (y, spread) => [f.at[0] + (Math.random() - 0.5) * spread * m, f.at[1] + y * m, f.at[2] + (Math.random() - 0.5) * spread * m];
		if (s == 'full') {
			smoke.addPuff({ at: at(0.25, 0.4), v: [0, 1.4, 0], size: 0.3, grow: 1.1, life: 0.75, kind: 0, rise: 1.3 });
			smoke.addPuff({ at: at(0.35, 0.25), v: [0, 1.7, 0], size: 0.22, grow: 0.9, life: 0.6, kind: 0, rise: 1.5 });
			if (Math.random() < 0.5) smoke.addPuff({ at: at(1.1, 0.2), v: [0, 0.9, 0], size: 0.4, grow: 3.2, life: 5, kind: 1, dark: 0.35, rise: 0.9 });
			if (Math.random() < 0.25) smoke.addPuff({ at: at(0.5, 0.3), v: [(Math.random() - 0.5) * 0.8, 2.6, (Math.random() - 0.5) * 0.8], size: 0.04, grow: 0, life: 1.4, kind: 0, rise: 2 });
		} else if (s == 'half') {
			if (Math.random() < 0.6) smoke.addPuff({ at: at(0.15, 0.35), v: [0, 1.0, 0], size: 0.2, grow: 1.0, life: 0.55, kind: 0, rise: 1.1 });
			if (Math.random() < 0.35) smoke.addPuff({ at: at(0.7, 0.2), v: [0, 0.8, 0], size: 0.3, grow: 3, life: 4.5, kind: 1, dark: 0.3, rise: 0.8 });
			if (Math.random() < 0.12) smoke.addPuff({ at: at(0.3, 0.3), v: [0, 2.0, 0], size: 0.035, grow: 0, life: 1.1, kind: 0, rise: 1.8 });
		} else if (s == 'embers') {
			if (Math.random() < 0.25) smoke.addPuff({ at: at(0.06, 0.4), v: [0, 0.25, 0], size: 0.07, grow: 0.3, life: 0.9, kind: 0, rise: 0.4 });
			if (Math.random() < 0.15) smoke.addPuff({ at: at(0.3, 0.15), v: [0, 0.5, 0], size: 0.15, grow: 2.5, life: 3.5, kind: 1, dark: 0.15, rise: 0.6 });
		}
	}
	setGrassFlats('campfires', [...fires.values()].map((f) => [f.at[0], f.at[2], 1.1 * m]));
	const lit = near.filter((n) => LIGHT[n.s]).sort((a, b) => a.d - b.d);
	for (let k = 0; k < 3; k++) {
		const n = lit[k], L = n && LIGHT[n.s];
		pointLights.setMovingLight('campfire' + k, n ? { at: [n.f.at[0], n.f.at[1] + 0.6 * m, n.f.at[2]], radius: L[0] * m, colour: L[2], strength: L[1] * (0.88 + 0.12 * Math.sin(now * 17 + k * 3) * Math.sin(now * 7.3 + k)), night: false } : null);
	}
}
// for testing
// where each one is, and what it is called (highlights.js)
export const fireSpots = () => [...fires.values()].map((f) => ({ at: f.at, name: NAMES[stageOf(f)] }));
export const firesForTest = () => [...fires.values()].map((f) => ({ id: f.id, stage: stageOf(f), hours: Math.round(fuelOf(f) * 24 * 100) / 100, lit: f.lit }));
export const fireById = (id) => fires.get(id) ?? null;
