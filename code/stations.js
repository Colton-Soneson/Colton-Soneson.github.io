import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import * as props from './props.js'
import * as smoke from './smoke.js'
import * as pointLights from './pointLights.js'
import * as atmosphere from './atmosphere.js'
import * as transformations from './transformations.js'
import * as weapons from './weapons.js'
import * as survivalNet from './survivalNet.js'
import { setGrassHoles } from './computeGrass.js'
import { ITEMS, makeItem } from './items.js'
import * as inventory from './inventory.js'
import * as survival from './survival.js'
import * as loot from './loot.js'
import * as campfires from './campfires.js'
import * as journal from './journalUI.js'

/*
	THE WORKSTATIONS of the Survival mode. Each is made (the crafting grid: crafting.js; the cauldron on the anvil), carried, and set up with the inventory's right click on the ground in front of the walker. F takes it up again, when it is empty. A cabin's rooms come with their own (cabins.js), fixed there.
		smelter		E at the top: the iron ore carried goes in (ORE_MOST at the most). E at the fire door: firewood. Lit with the lighter, as a campfire, and it burns as long (campfires.js: FULL, its wood worth the same). While it burns, an ore comes to an iron bar each
					SMELT days. E at the trough on its side: the bars
		anvil		E: its page (ANVIL): what can be made, of what is carried
		cauldron	E at the pot: its page (POT), only with the fire under it burning. E at the fire under it, or the lighter, as a campfire
		mortar		E: its page (MORTAR)
		fireplace	a cabin's: E firewood, the lighter. It warms the room
	IN A GAME (survivalNet.js) the host keeps them, their fires and what is in a smelter: a joiner asks (stationPlace, stationTake: stationBack; stationWood, stationLight, stationOre, stationBars: stationGot), and everyone is told each as it is (stationIs, stationDel); a joiner come in, of all of them.
	What is made on a page is made out of what the player carries, so there is nothing about that to send (in god mode, out of nothing: a cauldron still wants its fire). The host's are kept in its browser with the rest of what is built (cabins.js: its save).
*/
const WOOD = 2.5 / 24;				// days of fuel a firewood gives (as a campfire)
const SMELT = 1.25 / 24;			// days an ore takes
const ORE_MOST = 12;
const REACH = 2.8, AHEAD = 1.9;		// metres
const LEVEL = 0.6;					// metres the ground may rise under one
const WARMTH = { smelter: 14, cauldron: 12, fireplace: 22 }, NEAR = { smelter: 6, cauldron: 6, fireplace: 9 };
export const KINDS = {
	smelter: { name: 'Smelter', item: 'smelter', model: 'smelter', fire: true, half: 0.75, top: 1.7, spots: { ore: [0, 1.75, 0], fire: [0, 0.25, 0.72], bars: [1.05, 0.2, 0] } },
	anvil: { name: 'Anvil', item: 'anvil', model: 'anvil', half: 0.34, top: 0.85, spots: { use: [0, 0.8, 0] } },
	cauldron: { name: 'Cauldron', item: 'cauldron', model: 'cauldron', fire: true, half: 0.4, top: 0.9, spots: { use: [0, 0.8, 0], fire: [0, 0.1, 0] } },
	mortar: { name: 'Mortar and pestle', item: 'mortar', model: 'mortar', half: 0.5, top: 0.8, spots: { use: [-0.05, 0.9, 0] } },
	fireplace: { name: 'Fireplace', model: 'hearth', fire: true, half: 0, top: 0, spots: { fire: [0, 0.3, 0.05] } },
};
// WHAT THE PAGES MAKE: makes (how many), of needs. fire: only with its fire burning
export const ANVIL = [
	{ makes: 'nails', count: 10, needs: { ironBar: 1 } },
	{ makes: 'hatchet', needs: { ironBar: 1, firewood: 1, sinew: 1 } },
	{ makes: 'knife', needs: { ironBar: 1, sinew: 1 } },
	{ makes: 'pickaxe', needs: { ironBar: 2, sinew: 1, firewood: 1 } },
	{ makes: 'hoe', needs: { ironBar: 1, sinew: 1, firewood: 2 } },
	{ makes: 'cauldron', needs: { ironBar: 2 } },
];
export const POT = [
	{ makes: 'boiledMushroom', needs: { mushroom: 1 } },
	{ makes: 'cookedVenison', needs: { venison: 1 } },
	{ makes: 'cookedRabbit', needs: { rabbitMeat: 1 } },
	{ makes: 'cookedMoose', needs: { mooseMeat: 1 } },
	{ makes: 'cookedWolf', needs: { wolfMeat: 1 } },
	{ makes: 'cookedBear', needs: { bearMeat: 1 } },
	{ makes: 'cookedRat', needs: { ratMeat: 1 } },
	{ makes: 'boneAlcohol', needs: { bigBones: 1 } },
	{ makes: 'grainAlcohol', needs: { smallBones: 1, wheat: 1 } },
];
export const MORTAR = [
	{ makes: 'bandage', needs: { sinew: 1 } },
	{ makes: 'splint', needs: { smallBones: 1, sinew: 1 } },
	{ makes: 'antibiotics', needs: { boiledMushroom: 3 } },
	{ makes: 'alcohol', needs: { boneAlcohol: 1 } },
	{ makes: 'alcohol', needs: { grainAlcohol: 1 } },
];
const PAGES = { anvil: { title: 'At the anvil', list: ANVIL }, cauldron: { title: 'At the cauldron', list: POT, fire: true }, mortar: { title: 'At the mortar', list: MORTAR } };

const stations = new Map();		// id -> { id, kind, at, yaw, cabin, indoors, fuel, since, lit, ore, bars, part }
export const stationStats = { placed: 0, made: 0, bars: 0 };
const metre = () => settings.forestUnitsPerMetre;
const clock = () => atmosphere.sunCycles;
export const fuelOf = (s) => s.lit ? Math.max(s.fuel - (clock() - s.since), 0) : s.fuel;
export const burning = (s) => s.lit && fuelOf(s) > 0;
const emptyOf = (s) => !s.ore && !s.bars && !s.cabin;
const share = (s) => ({ id: s.id, kind: s.kind, at: s.at, yaw: s.yaw, cabin: s.cabin ?? null, indoors: !!s.indoors, fuel: fuelOf(s), since: clock(), lit: burning(s), ore: s.ore, bars: s.bars, part: s.part });
function told(s) { survivalNet.send('stationIs', share(s)); changed(); soon(); }
const listeners = [], saveListeners = [];
export function onChange(fn) { listeners.push(fn); }
export function onSave(fn) { saveListeners.push(fn); }
// (no grass grows under one)
const changed = () => { setGrassHoles('stations', [...stations.values()].filter((s) => !s.indoors).map((s) => { const h = (KINDS[s.kind].half + 0.45) * metre(); return [s.at[0], s.at[2], h, h]; })); for (const fn of listeners) fn(); journal.refreshMenu(); };
const soon = () => { for (const fn of saveListeners) fn(); };
function clean(m) { return { id: String(m.id), kind: KINDS[m.kind] ? m.kind : 'anvil', at: m.at.map(Number), yaw: Number(m.yaw) || 0, cabin: m.cabin ?? null, indoors: !!m.indoors, fuel: Number(m.fuel) || 0, since: Number(m.since) || clock(), lit: !!m.lit, ore: Number(m.ore) || 0, bars: Number(m.bars) || 0, part: Number(m.part) || 0 }; }
survivalNet.on('stationIs', (m) => { if (!survivalNet.authority() && Array.isArray(m.at)) { stations.set(String(m.id), clean(m)); changed(); } });
survivalNet.on('stationDel', (m) => { if (!survivalNet.authority()) { stations.delete(String(m.id)); changed(); } });
survivalNet.onJoin((id) => { for (const s of stations.values()) survivalNet.sendTo(id, 'stationIs', share(s)); });

// a place in one's own metres, in the world
export function toWorld(s, [x, y, z]) {
	const m = metre(), c = Math.cos(s.yaw), n = Math.sin(s.yaw);
	return [s.at[0] + (x * c + z * n) * m, s.at[1] + y * m, s.at[2] + (-x * n + z * c) * m];
}
// MADE (the host's): one set up by hand, or one of a cabin's
function hostAdd(kind, at, yaw, extra = {}) {
	const s = { id: extra.id ?? 's' + Math.floor(Math.random() * 1e9), kind, at, yaw, cabin: extra.cabin ?? null, indoors: !!extra.indoors, fuel: 0, since: clock(), lit: false, ore: 0, bars: 0, part: 0 };
	stations.set(s.id, s);
	stationStats.placed++;
	told(s);
	return s;
}
export const addBuilt = (kind, at, yaw, cabin, id) => hostAdd(kind, at, yaw, { id, cabin, indoors: true });
const kindOfItem = (type) => Object.keys(KINDS).find((k) => KINDS[k].item == type);
// SET UP (see the top): out of the inventory, on the ground in front
export function place(item) {
	const kind = kindOfItem(item.type), p = hunting.hunterPlace(), m = metre(), land = terrain.land;
	if (!kind) return false;
	if (p.on != 'land' || p.swimming) { help.toast('On firm ground'); return false; }
	const yaw = settings.camYaw, x = p.x + Math.sin(yaw) * AHEAD * m, z = p.z - Math.cos(yaw) * AHEAD * m, half = (KINDS[kind].half + 0.2) * m;
	const hs = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([a, b]) => land.heightAt(x + a * half, z + b * half));
	const onFloor = p.grounded && p.y - land.heightAt(p.x, p.z) > 0.15 * m;		// (on a floor: a cabin's)
	if (!onFloor && Math.min(...hs) < settings.waterWorldPosY + 0.1 * m) { help.toast('Not in the water'); return false; }
	if (!onFloor && Math.max(...hs) - Math.min(...hs) > LEVEL * m) { help.toast('The ground is not level enough here'); return false; }
	if ([...stations.values()].some((s) => Math.hypot(s.at[0] - x, s.at[2] - z) < (KINDS[s.kind].half + KINDS[kind].half + 0.2) * m)) { help.toast('Too close to another'); return false; }
	const at = [x, onFloor ? p.y : Math.min(...hs), z], heading = -yaw + Math.PI;
	inventory.useOne(item);
	if (survivalNet.authority()) hostAdd(kind, at, heading);
	else survivalNet.send('stationPlace', { kind, at, yaw: heading });
	help.toast(`${KINDS[kind].name} set up: F to take it up again`, 2);
	return true;
}
survivalNet.on('stationPlace', (m) => { if (survivalNet.authority() && KINDS[m.kind] && Array.isArray(m.at)) hostAdd(m.kind, m.at.map(Number), Number(m.yaw) || 0); });
function hostTake(id) {
	const s = stations.get(id);
	if (!s || !emptyOf(s) || burning(s)) return null;
	stations.delete(id);
	survivalNet.send('stationDel', { id });
	changed(); soon();
	return KINDS[s.kind].item;
}
const backInHand = (type) => { if (!type) { help.toast('Empty it, and let its fire die, first'); return; } const it = makeItem(type); if (!inventory.give(it)) loot.dropHere([it]); help.toast(ITEMS[type].name + ' taken up'); };
survivalNet.on('stationTake', (m, from) => { if (survivalNet.authority()) survivalNet.sendTo(from, 'stationBack', { type: hostTake(String(m.id)) }); });
survivalNet.on('stationBack', (m) => backInHand(ITEMS[m.type] ? m.type : null));
export function removeOfCabin(cabin) { if (survivalNet.authority()) for (const s of [...stations.values()]) if (s.cabin == cabin) { stations.delete(s.id); survivalNet.send('stationDel', { id: s.id }); } }

// ITS FIRE (see the top; as a campfire's)
function hostWood(id, n = 1) {
	const s = stations.get(id);
	if (!s) return;
	Object.assign(s, { fuel: Math.min(fuelOf(s) + WOOD * n, campfires.FULL), since: clock() });
	told(s);
}
function hostLight(id) {
	const s = stations.get(id);
	if (!s || burning(s) || s.fuel <= 0) return;
	Object.assign(s, { lit: true, since: clock() });
	told(s);
}
survivalNet.on('stationWood', (m) => { if (survivalNet.authority()) hostWood(String(m.id)); });
survivalNet.on('stationLight', (m) => { if (survivalNet.authority()) hostLight(String(m.id)); });
// THE ORE IN, AND THE BARS OUT
function hostOre(id, n) {
	const s = stations.get(id);
	if (!s) return n;
	const went = Math.min(n, ORE_MOST - s.ore);
	s.ore += went;
	told(s);
	return n - went;
}
function hostBars(id) {
	const s = stations.get(id);
	if (!s) return 0;
	const n = s.bars;
	s.bars = 0;
	if (n) told(s);
	return n;
}
function giveBack(type, n) { for (let left = n; left > 0;) { const k = Math.min(left, ITEMS[type].stack ?? 1), it = makeItem(type, k); left -= k; if (!inventory.give(it)) loot.dropHere([it]); } }
survivalNet.on('stationOre', (m, from) => { if (survivalNet.authority()) { const left = hostOre(String(m.id), Number(m.n) || 0); if (left) survivalNet.sendTo(from, 'stationGot', { type: 'ironOre', n: left }); } });
survivalNet.on('stationBars', (m, from) => { if (survivalNet.authority()) survivalNet.sendTo(from, 'stationGot', { type: 'ironBar', n: hostBars(String(m.id)), said: true }); });
survivalNet.on('stationGot', (m) => { if (ITEMS[m.type]) { giveBack(m.type, Number(m.n) || 0); if (m.said) help.toast(Number(m.n) ? `${m.n} iron bar${m.n > 1 ? 's' : ''}` : 'No bars yet'); } });

// WHAT THE EYE IS ON (see the top): { station, spot }
export function inView() {
	if (!inventory.survivalOn()) return null;
	const p = hunting.hunterPlace(), m = metre();
	if (!p.active || p.on != 'land') return null;
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ], f = transformations.getCameraForward();
	let best = null, bestScore = 0.12;
	for (const s of stations.values()) {
		if (Math.abs(s.at[0] - p.x) > 6 * m || Math.abs(s.at[2] - p.z) > 6 * m) continue;
		for (const [spot, local] of Object.entries(KINDS[s.kind].spots)) {
			const at = toWorld(s, local), to = at.map((v, i) => v - eye[i]), d = Math.hypot(...to), off = 1 - (to[0] * f[0] + to[1] * f[1] + to[2] * f[2]) / (d || 1);
			if (d < REACH * m && off + d / m * 0.002 < bestScore) { bestScore = off + d / m * 0.002; best = { station: s, spot }; }
		}
	}
	return best;
}
const carried = (type) => inventory.everything().filter(({ item }) => item.type == type).reduce((n, { item }) => n + item.count, 0);
function takeOut(type, n) {
	let left = n;
	for (const { item } of inventory.everything().filter((e) => e.item.type == type)) { while (left > 0 && item.count > 0) { inventory.useOne(item); left--; } if (left <= 0) break; }
}
hunting.onUse(() => {
	const v = inView();
	if (!v) return false;
	const s = v.station, id = s.id;
	if (v.spot == 'use') { openPage(s); return true; }
	if (v.spot == 'fire') {
		if (!carried('firewood')) { help.toast('No firewood: chop some with a hatchet'); return true; }
		takeOut('firewood', 1);
		if (survivalNet.authority()) hostWood(id); else survivalNet.send('stationWood', { id });
		help.toast(burning(s) ? 'More wood on the fire' : 'Wood laid: light it with the lighter');
		return true;
	}
	if (v.spot == 'ore') {
		const n = Math.min(carried('ironOre'), ORE_MOST - s.ore);
		if (!carried('ironOre')) { help.toast('No iron ore: a pickaxe, at a vein on the mountainside'); return true; }
		if (n <= 0) { help.toast('It holds no more'); return true; }
		takeOut('ironOre', n);
		if (survivalNet.authority()) hostOre(id, n); else survivalNet.send('stationOre', { id, n });
		help.toast(`${n} iron ore in`);
		return true;
	}
	if (v.spot == 'bars') {
		if (survivalNet.authority()) { const n = hostBars(id); giveBack('ironBar', n); help.toast(n ? `${n} iron bar${n > 1 ? 's' : ''}` : 'No bars yet'); }
		else survivalNet.send('stationBars', { id });
		return true;
	}
	return false;
});
hunting.onVehicleUse(() => {
	const v = inView();
	if (!v || v.station.cabin) return false;
	if (survivalNet.authority()) backInHand(hostTake(v.station.id));
	else survivalNet.send('stationTake', { id: v.station.id });
	return true;
});
hunting.addPrompt(() => {
	const v = inView();
	if (!v) return null;
	const s = v.station, K = KINDS[s.kind], hours = (fuelOf(s) * 24).toFixed(1), off = s.cabin ? '' : ' · F take it up';
	const flame = burning(s) ? `burning (${hours} h of wood)` : s.fuel > 0 ? 'laid: the lighter lights it' : 'no fire';
	if (v.spot == 'ore') return { name: `${K.name}: its mouth (${s.ore} of ${ORE_MOST} ore in it)`, keys: 'E put in your iron ore' + off };
	if (v.spot == 'fire') return { name: `${K.name}: ${flame}`, keys: 'E firewood' + off };
	if (v.spot == 'bars') return { name: `${K.name}: its trough (${s.bars} bar${s.bars == 1 ? '' : 's'}; ${s.ore} ore to come)`, keys: 'E take the bars' + off };
	if (K.fire) return { name: `${K.name}: ${flame}`, keys: 'E work at it' + off };
	return { name: K.name, keys: 'E work at it' + off };
});
// the lighter, at one (survivalTools.js): true if that is what it was for
export function lightInView() {
	const v = inView();
	if (!v || !KINDS[v.station.kind].fire || burning(v.station)) return false;
	if (v.station.fuel <= 0) { help.toast('No wood in it: E at the fire'); return true; }
	if (survivalNet.authority()) hostLight(v.station.id); else survivalNet.send('stationLight', { id: v.station.id });
	help.toast('It catches');
	return true;
}

// THE PAGES (see the top)
const nameOf = (type) => ITEMS[type]?.name ?? type;
function canMake(r) { return inventory.isGod() || Object.entries(r.needs).every(([k, n]) => carried(k) >= n); }
function openPage(s) { journal.openMenu(pageOf(s)); }
function pageOf(s) {
	const P = PAGES[s.kind];
	return {
		station: s,
		render() {
			const hot = !P.fire || burning(s);
			const rows = P.list.map((r, k) => {
				const needs = inventory.isGod() ? 'Free: god mode' : Object.entries(r.needs).map(([type, n]) => { const have = carried(type); return `<span class="${have < n ? 'jr-short' : ''}">${n} ${nameOf(type).toLowerCase()}${have < n ? ` (${have})` : ''}</span>`; }).join(' + ');
				return `<div class="jr-row"><div><b>${nameOf(r.makes)}${r.count > 1 ? ' × ' + r.count : ''}</b><div class="jr-need">${needs}</div></div><button class="jr-btn" data-act="${k}" ${canMake(r) && hot ? '' : 'disabled'}>Make</button></div>`;
			}).join('');
			return `<div class="jr-title" style="font-size: 20px;">${P.title}</div>${P.fire && !hot ? `<div class="jr-short" style="margin-bottom: 6px;">No fire under it: firewood, and the lighter</div>` : ''}${rows}<div class="jr-need" style="margin-top: 10px;">Tab, Esc or F to close</div>`;
		},
		act(value) { make(P.list[Number(value)], P, s); },
	};
}
function make(r, P, s) {
	if (!r || !canMake(r) || (P.fire && !burning(s))) return false;
	if (!inventory.isGod()) for (const [type, n] of Object.entries(r.needs)) takeOut(type, n);
	giveBack(r.makes, r.count ?? 1);
	stationStats.made++;
	weapons.actionSound(s.kind == 'anvil' ? 'knock' : 'click');
	help.toast('Made: ' + nameOf(r.makes), 1.4);
	return true;
}

// THE WARMTH AND THE CALM round them (survival.js)
survival.setFireNear((x, y, z) => {
	const m = metre();
	let warmth = 0, calm = 0;
	for (const s of stations.values()) {
		if (!burning(s)) continue;
		const d = Math.hypot(s.at[0] - x, s.at[1] - y, s.at[2] - z) / m, w = WARMTH[s.kind] ?? 0;
		warmth = Math.max(warmth, w * Math.min(Math.max(1 - (d - 1) / (NEAR[s.kind] ?? 6), 0), 1));
		if (d < 5) calm = 1;
	}
	return { warmth, calm };
});
// IN THE WAY (hunting.js)
hunting.addStill((x, z, reach, add) => {
	const m = metre();
	for (const s of stations.values()) {
		const K = KINDS[s.kind];
		if (K.half && Math.hypot(s.at[0] - x, s.at[2] - z) < reach) add(s.at[0], s.at[2], K.half * m, s.at[1] - 0.1 * m, s.at[1] + K.top * m);
	}
});
// (for a cabin's plan: what has been set up in the way of it)
export const list = () => [...stations.values()];

// SAVED (cabins.js)
export const stationsSave = () => [...stations.values()].map(share);
export function stationsLoad(saved) { stations.clear(); for (const m of saved ?? []) if (Array.isArray(m.at)) stations.set(String(m.id), clean(m)); changed(); }

// Once a frame: the host's fires burnt out and ore smelted; each drawn, its smoke, the nearest lit
let puffClock = 0, lastTime = performance.now(), lastClock = null;
const INDOORS = [1, 0, 0, 0];
export function stationsUpdate() {
	const dt = Math.min((performance.now() - lastTime) / 1000, 0.1);
	lastTime = performance.now();
	if (!inventory.survivalOn()) { for (let k = 0; k < 3; k++) pointLights.setMovingLight('station' + k, null); return; }
	const m = metre(), now = performance.now() / 1000, days = lastClock === null ? 0 : Math.max(clock() - lastClock, 0);
	lastClock = clock();
	puffClock += dt;
	const puffs = puffClock > 0.07;
	if (puffs) puffClock = 0;
	const lit = [];
	for (const s of stations.values()) {
		const on = burning(s);
		if (survivalNet.authority()) {
			if (s.lit && !on) { Object.assign(s, { lit: false, fuel: 0, since: clock() }); told(s); }
			if (on && s.kind == 'smelter' && s.ore > 0) {
				s.part += days / SMELT;
				if (s.part >= 1) { const n = Math.min(Math.floor(s.part), s.ore); s.part -= n; s.ore -= n; s.bars += n; stationStats.bars += n; told(s); }
			}
		}
		const d = Math.hypot(s.at[0] - settings.camPosX, s.at[2] - settings.camPosZ) / m;
		if (d > 300) continue;
		const model = props.place(s.at, s.yaw), extra = s.indoors ? INDOORS : undefined;
		if (s.kind != 'fireplace') props.show(KINDS[s.kind].model, model, undefined, extra);
		else if (on || s.fuel > 0) props.show(!on ? 'campfireLaid' : fuelOf(s) > 0.5 * campfires.FULL ? 'campfireFull' : 'campfireHalf', props.place(toWorld(s, [0, 0.05, -0.1]), s.yaw), undefined, extra);
		if (s.kind == 'smelter' && on) props.show('smelterFire', model, undefined, extra);
		if (s.kind == 'cauldron') {
			const left = fuelOf(s);
			props.show(!on ? (left > 0 ? 'campfireLaid' : 'campfireDead') : left > 0.5 * campfires.FULL ? 'campfireFull' : 'campfireHalf', model, undefined, extra);
		}
		if (on) {
			lit.push({ s, d });
			if (puffs && d < 160) {
				const K = s.kind == 'smelter' ? [0, 1.75, 0] : s.kind == 'cauldron' ? [0, 0.15, 0] : [0, 0.2, 0.05], at = toWorld(s, K);
				if (s.kind == 'fireplace') { smoke.addPuff({ at: [at[0], at[1] + 0.05 * m, at[2] - 0.1 * m], v: [0, 1.2, 0], size: 0.26, grow: 1.1, life: 0.65, kind: 0, rise: 1.2 }); smoke.addPuff({ at: [at[0] + (Math.random() - 0.5) * 0.3 * m, at[1], at[2] - 0.1 * m], v: [0, 1.4, 0], size: 0.18, grow: 0.9, life: 0.5, kind: 0, rise: 1.4 }); }
				else if (s.kind == 'smelter' || Math.random() < 0.4) smoke.addPuff({ at, v: [0, 1.0, 0], size: 0.2, grow: 1, life: 0.5, kind: 0, rise: 1 });
				if (s.kind != 'fireplace' && Math.random() < 0.3) smoke.addPuff({ at: [at[0], at[1] + 0.3 * m, at[2]], v: [0, 0.8, 0], size: 0.3, grow: 3, life: 4.5, kind: 1, dark: 0.35, rise: 0.8 });
			}
		}
	}
	lit.sort((a, b) => a.d - b.d);
	for (let k = 0; k < 3; k++) {
		const n = lit[k];
		pointLights.setMovingLight('station' + k, n ? { at: toWorld(n.s, n.s.kind == 'fireplace' ? [0, 0.6, 0.7] : n.s.kind == 'smelter' ? [0, 0.5, 1] : [0, 0.6, 0]), radius: (n.s.kind == 'fireplace' ? 9 : 6) * m, colour: [1.0, 0.55, 0.22], strength: 1.5 * (0.88 + 0.12 * Math.sin(now * 17 + k * 3) * Math.sin(now * 7.3 + k)), night: false } : null);
	}
}
// where each is, and what it is called (highlights.js)
export const stationSpots = () => [...stations.values()].map((s) => ({ at: toWorld(s, [0, KINDS[s.kind].top + 0.4, 0]), name: KINDS[s.kind].name + (burning(s) ? ', burning' : '') }));
// for testing
export const stationsForTest = () => [...stations.values()].map((s) => ({ id: s.id, kind: s.kind, at: s.at, cabin: s.cabin, fuel: fuelOf(s), lit: burning(s), ore: s.ore, bars: s.bars }));
export const makeForTest = (s, r, P) => make(r, P, s);
export { PAGES as PAGES_FOR_TEST };
