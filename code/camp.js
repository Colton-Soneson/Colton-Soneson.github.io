import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import * as props from './props.js'
import * as smoke from './smoke.js'
import * as pointLights from './pointLights.js'
import * as atmosphere from './atmosphere.js'
import * as horse from './horse.js'
import * as transformations from './transformations.js'
import { weatherNow } from './weather.js'
import { setGrassFlats } from './computeGrass.js'
import * as survivalNet from './survivalNet.js'
import { ITEMS, HANDS, makeItem, cleanItem, handSlots } from './items.js'
import * as inventory from './inventory.js'
import * as survival from './survival.js'
import * as loot from './loot.js'
import * as bedrolls from './bedrolls.js'

/*
	THE CAMP of the Survival mode: the canvas wall tent, what goes in it, and a horse's saddlebags to carry it all in (items.js: camp).
	THE TENT is pitched (the inventory screen's right click, or left click with it in the hands) on the ground in front of the walker,
	its door towards it, where the ground is level enough (PITCH) and no other tent is. It is TENT across and deep, room enough to walk
	into. Under its roof (shelter: survival.js) the rain and the snow keep off, and most of the wind. It has a SLOT for each attachment,
	and an attachment put in its slot stands in its own place (SPOTS: in the tent's own metres, its door +z):
		stove		at the back between the beds, its pipe up through the roof. Firewood (E) burns in it by the world's clock (STOVE: as a
					campfire does, campfires.js), lit with the lighter (survivalTools.js); lit, it is warm in the tent (survival.js:
					setFireNear), smokes from its pipe, glows, and cooks (campfires.js: burningNear)
		collector	outside, by the right wall: fills with water while it rains or snows (COLLECT, by the world's clock), up to COLLECT.most
					bottles; E takes them
		bed1, bed2	two bedrolls, side by side: E on one, sleep (bedrolls.js: sleepAt, so the walker comes back there when it is down)
	E at the tent: the inventory screen, with the tent's slots (inventoryUI.js: a thing dragged on to its slot goes in, dragged off comes
	out). F at it: struck, back into the hands (or the bags, or the ground), once its slots are empty.
	THE SADDLEBAGS of any horse (horse.js: E at them, in the Survival mode) are slots too, one for each camp thing (BAG_SLOTS), nothing
	else. What comes out of them, or out of a tent, goes into the hands if it is carried there (the tent, the stove, the collector),
	and is taken up: carried to the camp and pitched there.
	In a game (survivalNet.js) the host keeps every tent and every horse's bags: a joiner asks it to pitch (pitch), put a thing in a slot
	(campPut: the thing out of its inventory first, back if it does not go: campBack), take one out (campTake: campGot back), strike a
	tent (strike), feed or light a stove (stoveWood, stoveLight) and take the water (waterTake: waterGot back), and everyone is told each
	one as it is (campIs) and when a tent goes (campDel); a joiner come in, of all of them. A horse's bags are told when they are asked
	for (campAsk).
*/
export const TENT = { halfW: 1.3, halfD: 1.4 };				// metres
const PITCH = { ahead: 2.4, level: 0.45, apart: 4 };		// metres: in front, the most the ground may rise across it, from another tent
const REACH = 2.6;											// metres
export const TENT_SLOTS = { stove: 'stove', collector: 'collector', bed1: 'bed', bed2: 'bed' };
export const BAG_SLOTS = { tent: 'tent', stove: 'stove', collector: 'collector', bed1: 'bed', bed2: 'bed' };
export const SLOT_NAMES = { tent: 'Tent', stove: 'Stove', collector: 'Rain collector', bed1: 'Bedroll', bed2: 'Bedroll' };
const SPOTS = { stove: [0, 0.07, -1.0], collector: [1.9, 0, 0.55], bed1: [-0.72, 0.07, 0.3], bed2: [0.72, 0.07, 0.3] };	// (in it: on its floor)
const STOVE = { wood: 2.5 / 24, most: 8 / 24, warmth: 12, reach: 3.5 };		// days of fuel a firewood, the most it holds; °C in the tent, metres it reaches
const COLLECT = { perDay: 24, most: 4 };					// bottles a day of rain at its hardest; the most it holds
const CARRIED = ['tent', 'stove', 'collector'];				// (the camp kinds carried in the hands)

const tents = new Map();		// id -> { id, at, yaw, slots, water, stove: { fuel, since, lit } }
const bags = new Map();			// horse id -> { id, slots }
export const campStats = { pitched: 0, struck: 0, put: 0, taken: 0, water: 0 };
const metre = () => settings.forestUnitsPerMetre;
const clock = () => atmosphere.sunCycles;
const fits = (slot, item, slots) => !!item && ITEMS[item.type]?.camp === slots[slot];
const emptySlots = (slots) => Object.fromEntries(Object.keys(slots).map((s) => [s, null]));
export const stoveFuel = (t) => t.stove.lit ? Math.max(t.stove.fuel - (clock() - t.stove.since), 0) : t.stove.fuel;
export const stoveBurning = (t) => !!t.slots.stove && t.stove.lit && stoveFuel(t) > 0;

// a place in a tent's own metres, in the world (its heading: round from +z towards +x, as props.js turns things)
export function tentToWorld(t, [x, y, z]) {
	const m = metre(), c = Math.cos(t.yaw), s = Math.sin(t.yaw);
	return [t.at[0] + (x * c + z * s) * m, t.at[1] + y * m, t.at[2] + (-x * s + z * c) * m];
}
function tentLocal(t, x, z) {
	const m = metre(), dx = (x - t.at[0]) / m, dz = (z - t.at[2]) / m, c = Math.cos(t.yaw), s = Math.sin(t.yaw);
	return [dx * c - dz * s, dx * s + dz * c];
}
export const insideTent = (t, x, z, margin = 0) => { const [lx, lz] = tentLocal(t, x, z); return Math.abs(lx) < TENT.halfW + margin && Math.abs(lz) < TENT.halfD + margin; };

// SHARED (see the top): told, and heard
const shareOf = (kind, h) => kind == 'tent' ? { id: h.id, at: h.at, yaw: h.yaw, slots: h.slots, water: h.water, stove: { fuel: stoveFuel(h), since: clock(), lit: h.stove.lit && stoveFuel(h) > 0 } } : { id: h.id, slots: h.slots };
function told(kind, h) { survivalNet.send('campIs', { kind, h: shareOf(kind, h) }); changed(); }
const changeListeners = [];
export function onChange(fn) { changeListeners.push(fn); }
const changed = () => changeListeners.forEach((fn) => fn());
function cleanSlots(raw, slots) { return Object.fromEntries(Object.keys(slots).map((s) => [s, cleanItem(raw?.[s]) ?? null])); }
survivalNet.on('campIs', (m) => {
	if (survivalNet.authority() || !m.h) return;
	if (m.kind == 'tent') tents.set(m.h.id, { id: m.h.id, at: m.h.at.map(Number), yaw: Number(m.h.yaw) || 0, slots: cleanSlots(m.h.slots, TENT_SLOTS), water: Number(m.h.water) || 0,
		stove: { fuel: Number(m.h.stove?.fuel) || 0, since: Number(m.h.stove?.since) || clock(), lit: !!m.h.stove?.lit } });
	else bags.set(m.h.id, { id: m.h.id, slots: cleanSlots(m.h.slots, BAG_SLOTS) });
	changed();
});
survivalNet.on('campDel', (m) => { if (!survivalNet.authority()) { tents.delete(m.id); changed(); } });
survivalNet.onJoin((id) => { for (const t of tents.values()) survivalNet.sendTo(id, 'campIs', { kind: 'tent', h: shareOf('tent', t) }); });
survivalNet.on('campAsk', (m, from) => { const b = bagsOf(m.id); if (b) survivalNet.sendTo(from, 'campIs', { kind: 'bags', h: shareOf('bags', b) }); });

// what holds what (ref: { kind: 'tent' | 'bags', id }), and its slots' kinds
export function holder(ref) { return ref?.kind == 'tent' ? tents.get(ref.id) ?? null : ref?.kind == 'bags' ? bags.get(ref.id) ?? null : null; }
export const slotsOf = (ref) => ref?.kind == 'tent' ? TENT_SLOTS : BAG_SLOTS;
function bagsOf(id) {
	if (!horse.horseById(id)) return null;
	if (!bags.has(id) && survivalNet.authority()) bags.set(id, { id, slots: emptySlots(BAG_SLOTS) });
	return bags.get(id) ?? null;
}
export function askBags(id) { if (survivalNet.authority()) bagsOf(id); else survivalNet.send('campAsk', { id }); }

// PITCHED (see the top): the tent item out of the inventory, if there is ground for it
export function pitch(item) {
	const p = hunting.hunterPlace(), m = metre(), land = terrain.land;
	if (p.on != 'land' || p.swimming) { help.toast('On firm ground'); return false; }
	const yaw = settings.camYaw, x = p.x + Math.sin(yaw) * PITCH.ahead * m, z = p.z - Math.cos(yaw) * PITCH.ahead * m;
	const heights = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([a, b]) => land.heightAt(x + a * TENT.halfW * m, z + b * TENT.halfD * m));
	if (Math.min(...heights) < settings.waterWorldPosY + 0.1 * m) { help.toast('Not in the water'); return false; }
	if (Math.max(...heights) - Math.min(...heights) > PITCH.level * m) { help.toast('The ground is not level enough here'); return false; }
	if ([...tents.values()].some((t) => Math.hypot(t.at[0] - x, t.at[2] - z) < PITCH.apart * m)) { help.toast('Too close to another tent'); return false; }
	const at = [x, Math.min(...heights), z], heading = -yaw;
	inventory.remove(item);
	if (survivalNet.authority()) addTent(at, heading);
	else survivalNet.send('pitch', { at, yaw: heading });
	help.toast('Tent pitched: E at it for its attachments, F to strike it');
	return true;
}
function addTent(at, yaw) {
	const t = { id: 't' + Math.floor(Math.random() * 1e9), at, yaw, slots: emptySlots(TENT_SLOTS), water: 0, stove: { fuel: 0, since: clock(), lit: false } };
	tents.set(t.id, t);
	campStats.pitched++;
	told('tent', t);
}
survivalNet.on('pitch', (m) => { if (survivalNet.authority() && Array.isArray(m.at)) addTent(m.at.map(Number), Number(m.yaw) || 0); });

// A SLOT: a thing put in (out of the inventory: back if it does not go), a thing taken out (into the hands, the inventory, or the ground)
export function put(ref, slot, item) {
	const h = holder(ref);
	if (!h || !fits(slot, item, slotsOf(ref))) { help.toast(`It does not go there`); return false; }
	if (h.slots[slot]) { help.toast(`There is one there already`); return false; }
	inventory.remove(item);
	if (survivalNet.authority()) { if (!hostPut(ref, slot, item)) taken(item); }
	else survivalNet.send('campPut', { ref, slot, item });
	return true;
}
function hostPut(ref, slot, item) {
	const h = ref.kind == 'bags' ? bagsOf(ref.id) : holder(ref);
	if (!h || !fits(slot, item, slotsOf(ref)) || h.slots[slot]) return false;
	h.slots[slot] = item;
	if (slot == 'stove') h.stove = { fuel: 0, since: clock(), lit: false };
	if (slot == 'collector') h.water = 0;
	campStats.put++;
	told(ref.kind, h);
	return true;
}
export function take(ref, slot) {
	if (survivalNet.authority()) { const item = hostTake(ref, slot); if (item) taken(item); return; }
	survivalNet.send('campTake', { ref, slot });
}
function hostTake(ref, slot) {
	const h = holder(ref);
	const item = h?.slots[slot];
	if (!item) return null;
	h.slots[slot] = null;
	if (slot == 'stove') h.stove = { fuel: 0, since: clock(), lit: false };
	campStats.taken++;
	told(ref.kind, h);
	return item;
}
survivalNet.on('campPut', (m, from) => {
	if (!survivalNet.authority()) return;
	const item = cleanItem(m.item);
	if (item && !hostPut(m.ref, m.slot, item)) survivalNet.sendTo(from, 'campBack', { item });
});
survivalNet.on('campTake', (m, from) => { if (survivalNet.authority()) { const item = hostTake(m.ref, m.slot); if (item) survivalNet.sendTo(from, 'campGot', { item }); } });
survivalNet.on('campBack', (m) => { const item = cleanItem(m.item); if (item) { taken(item); help.toast('It does not go there'); } });
survivalNet.on('campGot', (m) => { const item = cleanItem(m.item); if (item) taken(item); });
// what came out: a thing carried in the hands into the hands (and taken up), anything else wherever it fits; or put down
const holdListeners = [];
export function onHold(fn) { holdListeners.push(fn); }
function taken(item) {
	const it = ITEMS[item.type];
	if (CARRIED.includes(it.camp)) {
		for (const h of handSlots(item.type)) if (inventory.put({ kind: 'hand', slot: h }, item)) { holdListeners.forEach((fn) => fn(item)); return; }
	}
	if (inventory.give(item)) return;
	loot.dropHere([item]);
	help.toast('No room: put down at your feet');
}

// STRUCK (see the top): F at it, its slots empty
export function strike(id) {
	if (survivalNet.authority()) { const item = hostStrike(id); if (item) taken(item); return; }
	survivalNet.send('strike', { id });
}
function hostStrike(id) {
	const t = tents.get(id);
	if (!t) return null;
	if (Object.values(t.slots).some(Boolean)) return null;
	tents.delete(id);
	campStats.struck++;
	survivalNet.send('campDel', { id });
	changed();
	return makeItem('tent');
}
survivalNet.on('strike', (m, from) => { if (survivalNet.authority()) { const item = hostStrike(m.id); if (item) survivalNet.sendTo(from, 'campGot', { item }); } });

// THE STOVE (see the top): a firewood in, lit
export function stoveWood(id) {
	if (!survivalNet.authority()) { survivalNet.send('stoveWood', { id }); return; }
	const t = tents.get(id);
	if (!t?.slots.stove) return;
	t.stove = { fuel: Math.min(stoveFuel(t) + STOVE.wood, STOVE.most), since: clock(), lit: t.stove.lit && stoveFuel(t) > 0 };
	told('tent', t);
}
export function stoveLight(id) {
	if (!survivalNet.authority()) { survivalNet.send('stoveLight', { id }); return; }
	const t = tents.get(id);
	if (!t?.slots.stove || t.stove.fuel <= 0 || stoveBurning(t)) return;
	t.stove = { fuel: stoveFuel(t), since: clock(), lit: true };
	told('tent', t);
}
survivalNet.on('stoveWood', (m) => stoveWood(m.id));
survivalNet.on('stoveLight', (m) => stoveLight(m.id));
// THE WATER (see the top): every whole bottle of it
function waterTake(id) {
	if (!survivalNet.authority()) { survivalNet.send('waterTake', { id }); return; }
	waterGot(hostWater(id));
}
function hostWater(id) {
	const t = tents.get(id);
	if (!t?.slots.collector) return 0;
	const n = Math.floor(t.water);
	t.water -= n;
	if (n) told('tent', t);
	return n;
}
survivalNet.on('waterTake', (m, from) => { if (survivalNet.authority()) survivalNet.sendTo(from, 'waterGot', { n: hostWater(m.id) }); });
survivalNet.on('waterGot', (m) => waterGot(Number(m.n) || 0));
function waterGot(n) {
	if (!n) { help.toast('Not a bottle\'s worth in it yet: it fills in the rain and the snow'); return; }
	campStats.water += n;
	for (let k = 0; k < n; k++) { const w = makeItem('water'); if (!inventory.give(w)) loot.dropHere([w]); }
	help.toast(`${n} bottle${n > 1 ? 's' : ''} of water`);
}

// WHAT THE EYE IS ON (within REACH): a tent's attachment, or a tent. { tent, what: 'stove' | 'collector' | 'bed1' | 'bed2' | 'tent' }
export function inView() {
	if (!inventory.survivalOn()) return null;
	const p = hunting.hunterPlace(), m = metre();
	if (!p.active || p.on != 'land') return null;
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ], look = transformations.getCameraForward();
	const offOf = (at) => { const to = at.map((v, i) => v - eye[i]), d = Math.hypot(...to); return { d: d / m, off: 1 - (to[0] * look[0] + to[1] * look[1] + to[2] * look[2]) / (d || 1) }; };
	let best = null, bestScore = Infinity;
	for (const t of tents.values()) {
		if (Math.hypot(t.at[0] - p.x, t.at[2] - p.z) > 8 * m) continue;
		for (const what of Object.keys(TENT_SLOTS)) {
			if (!t.slots[what]) continue;
			const [x, , z] = SPOTS[what], { d, off } = offOf(tentToWorld(t, [x, what == 'collector' ? 0.8 : 0.3, z]));
			if (d < REACH && off < 0.06 && off + d * 0.01 < bestScore) { bestScore = off + d * 0.01; best = { tent: t, what }; }
		}
	}
	if (best) return best;
	for (const t of tents.values()) {
		const inside = insideTent(t, p.x, p.z, 0.2), { d, off } = offOf(tentToWorld(t, [0, 1.0, 0]));
		if ((inside || (d < REACH + 1.6 && off < 0.2)) && d < bestScore) { bestScore = d; best = { tent: t, what: 'tent' }; }
	}
	return best;
}
// the stove looked at (survivalTools.js: the lighter)
export function stoveInView() { const v = inView(); return v?.what == 'stove' ? v.tent : null; }
const firewood = () => inventory.everything().find(({ item }) => item.type == 'firewood')?.item ?? null;
const openListeners = [];
export function onOpen(fn) { openListeners.push(fn); }
hunting.onUse(() => {
	const v = inView();
	if (v) {
		const t = v.tent;
		if (v.what == 'stove') {
			const wood = firewood();
			if (!wood) { help.toast('No firewood: chop some with a hatchet'); return true; }
			inventory.useOne(wood);
			stoveWood(t.id);
			help.toast(stoveBurning(t) ? 'More wood in the stove' : 'Wood in the stove: light it with the lighter');
			return true;
		}
		if (v.what == 'collector') { waterTake(t.id); return true; }
		if (v.what == 'bed1' || v.what == 'bed2') {
			if (survival.status.asleep > 0) return false;
			bedrolls.sleepAt({ id: t.id + v.what, at: tentToWorld(t, SPOTS[v.what]), yaw: Math.PI - t.yaw });
			return true;
		}
		openListeners.forEach((fn) => fn({ kind: 'tent', id: t.id }));
		return true;
	}
	// a horse's saddlebags (horse.js)
	if (!inventory.survivalOn()) return false;
	const tack = horse.controlInView([settings.camPosX, settings.camPosY, settings.camPosZ], transformations.getCameraForward());
	if (tack?.kind != 'bags') return false;
	askBags(tack.horse.id);
	openListeners.forEach((fn) => fn({ kind: 'bags', id: tack.horse.id }));
	return true;
});
hunting.onVehicleUse(() => {
	const v = inView();
	if (!v || v.what != 'tent') return false;
	if (Object.values(v.tent.slots).some(Boolean)) { help.toast('Take its attachments out first (E at the tent)'); return true; }
	strike(v.tent.id);
	return true;
});
const PROMPTS = { stove: 'E firewood · the lighter: light it · X cook', collector: 'E take the water', bed1: 'E sleep', bed2: 'E sleep' };
hunting.addPrompt(() => {
	const v = inView();
	if (!v) return null;
	const t = v.tent;
	if (v.what == 'stove') return { name: `Stove, ${stoveBurning(t) ? `burning (${(stoveFuel(t) * 24).toFixed(1)} h of wood)` : t.stove.fuel > 0 ? 'laid' : 'cold'}`, keys: PROMPTS.stove };
	if (v.what == 'collector') return { name: `Rain collector (${t.water.toFixed(1)} of ${COLLECT.most} bottles)`, keys: PROMPTS.collector };
	if (v.what != 'tent') return { name: 'Bedroll, in the tent', keys: PROMPTS[v.what] };
	return { name: 'Canvas wall tent', keys: 'E its attachments · F strike it' };
});

// WARM BY A STOVE, AND UNDER A ROOF (survival.js)
survival.setFireNear((x, y, z) => {
	const m = metre();
	let warmth = 0, calm = 0;
	for (const t of tents.values()) {
		if (!stoveBurning(t)) continue;
		const inside = insideTent(t, x, z), d = Math.hypot(...tentToWorld(t, SPOTS.stove).map((v, i) => v - [x, y, z][i])) / m;
		warmth = Math.max(warmth, inside ? STOVE.warmth : STOVE.warmth * 0.5 * Math.max(1 - d / STOVE.reach, 0));
		if (inside) calm = 1;
	}
	return { warmth, calm };
});
survival.setShelter((x, y, z) => [...tents.values()].some((t) => insideTent(t, x, z) && y < t.at[1] + 2.4 * metre()));
// a stove burning near enough to cook on (campfires.js)
export function burningNear(x, z, reach) {
	return [...tents.values()].find((t) => stoveBurning(t) && Math.hypot(...[0, 2].map((i) => tentToWorld(t, SPOTS.stove)[i] - [x, 0, z][i])) < reach * metre()) ?? null;
}

// for the inventory screen: what is in view to show, and how it is
export function describe(ref) {
	const h = holder(ref);
	if (!h) return null;
	if (ref.kind == 'bags') return { title: 'SADDLEBAGS', lines: ['Only the camp: a tent, its stove, its rain collector, two bedrolls'] };
	const lines = [];
	if (h.slots.stove) lines.push(stoveBurning(h) ? `Stove burning: ${(stoveFuel(h) * 24).toFixed(1)} h of wood` : h.stove.fuel > 0 ? 'Stove laid, not lit' : 'Stove cold: firewood in it (E at it)');
	if (h.slots.collector) lines.push(`Water: ${h.water.toFixed(1)} of ${COLLECT.most} bottles`);
	lines.push('F at the tent, its slots empty: strike it');
	return { title: 'TENT', lines };
}
export function nearEnough(ref) {
	const p = hunting.hunterPlace(), m = metre();
	if (ref.kind == 'tent') { const t = tents.get(ref.id); return !!t && Math.hypot(t.at[0] - p.x, t.at[2] - p.z) < 5 * m; }
	const h = horse.horseById(ref.id);
	return !!h && Math.hypot(h.x - p.x, h.z - p.z) < 4 * m;
}

// Once a frame: drawn, the water coming in, the stoves burning down, their smoke and glow
let lastClock = null, puffClock = 0, lastTime = performance.now();
export function campUpdate() {
	const dt = Math.min((performance.now() - lastTime) / 1000, 0.1);
	lastTime = performance.now();
	if (!inventory.survivalOn()) { for (let k = 0; k < 2; k++) pointLights.setMovingLight('stove' + k, null); return; }
	const m = metre(), now = performance.now() / 1000;
	const days = lastClock === null ? 0 : Math.max(clock() - lastClock, 0);
	lastClock = clock();
	const lit = [];
	puffClock += dt;
	const puffs = puffClock > 0.08;
	if (puffs) puffClock = 0;
	for (const t of tents.values()) {
		// (the host's: the water, and a stove burnt out)
		if (survivalNet.authority()) {
			if (t.slots.collector && t.water < COLLECT.most && (weatherNow.rain + weatherNow.snow) > 0) {
				const was = Math.floor(t.water * 4);
				t.water = Math.min(t.water + (weatherNow.rain + weatherNow.snow) * COLLECT.perDay * days, COLLECT.most);
				if (Math.floor(t.water * 4) != was) told('tent', t);
			}
			if (t.stove.lit && stoveFuel(t) <= 0) { t.stove = { fuel: 0, since: clock(), lit: false }; told('tent', t); }
		}
		const d = Math.hypot(t.at[0] - settings.camPosX, t.at[2] - settings.camPosZ) / m;
		if (d > 300) continue;
		props.show('tent', props.place(t.at, t.yaw));
		for (const bed of ['bed1', 'bed2']) if (t.slots[bed]) props.show('bedrollFlat', props.place(tentToWorld(t, SPOTS[bed]), t.yaw + Math.PI));
		if (t.slots.collector) {
			props.show('collector', props.place(tentToWorld(t, SPOTS.collector), t.yaw));
			if (t.water > 0.05) props.show('waterSurface', props.place(tentToWorld(t, [SPOTS.collector[0], 0.08 + 0.48 * t.water / COLLECT.most, SPOTS.collector[2]]), t.yaw));
		}
		if (t.slots.stove) {
			const burning = stoveBurning(t);
			props.show(burning ? 'stoveLit' : 'stove', props.place(tentToWorld(t, SPOTS.stove), t.yaw));
			if (burning) {
				lit.push({ t, d });
				if (puffs && d < 160) {
					const top = tentToWorld(t, [SPOTS.stove[0] + 0.15, 3.05, SPOTS.stove[2] - 0.15]);
					smoke.addPuff({ at: top, v: [0, 0.8, 0], size: 0.12, grow: 2.4, life: 4, kind: 1, dark: 0.3, rise: 0.8 });
				}
			}
		}
	}
	setGrassFlats('tents', [...tents.values()].map((t) => [t.at[0], t.at[2], 1.9 * m]));
	lit.sort((a, b) => a.d - b.d);
	for (let k = 0; k < 2; k++) {
		const n = lit[k];
		pointLights.setMovingLight('stove' + k, n ? { at: tentToWorld(n.t, [SPOTS.stove[0], 0.6, SPOTS.stove[2] + 0.5]), radius: 4 * m, colour: [1.0, 0.5, 0.2], strength: 1.1 * (0.9 + 0.1 * Math.sin(now * 13 + k)), night: false } : null);
	}
}
// where each is, and what it is called (highlights.js)
export const campSpots = () => [...tents.values()].flatMap((t) => [{ at: tentToWorld(t, [0, 2.9, 0]), name: 'Canvas wall tent' },
	...(t.slots.stove ? [{ at: tentToWorld(t, [SPOTS.stove[0], 0.8, SPOTS.stove[2]]), name: stoveBurning(t) ? 'Stove, burning' : 'Stove' }] : []),
	...(t.slots.collector ? [{ at: tentToWorld(t, [SPOTS.collector[0], 1.5, SPOTS.collector[2]]), name: `Rain collector (${Math.floor(t.water)} water)` }] : [])]);
// for testing
export const tentsForTest = () => [...tents.values()].map((t) => ({ id: t.id, at: t.at, yaw: t.yaw, slots: Object.fromEntries(Object.entries(t.slots).map(([s, i]) => [s, i?.type ?? null])), water: t.water, burning: stoveBurning(t), fuel: stoveFuel(t) }));
export const bagsForTest = (id) => { const b = bags.get(id); return b ? Object.fromEntries(Object.entries(b.slots).map(([s, i]) => [s, i?.type ?? null])) : null; };
