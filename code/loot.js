import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as town from './town.js'
import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import * as npcs from './npcs.js'
import * as atmosphere from './atmosphere.js'
import * as survivalNet from './survivalNet.js'
import { ITEMS, makeItem, cleanItem, fits, placeFor } from './items.js'
import * as inventory from './inventory.js'
import * as survival from './survival.js'
import * as outfits from './outfits.js'

/*
	THE LOOT of the Survival game mode: everything there is to search, with E (within REACH, looked at), in the inventory screen
	(inventoryUI.js). Each is a CONTAINER: { id, kind, at (world units), grid, items }:
		crate		by the door of one house in CRATE_EVERY of the towns' (in the same place on every machine: the houses are)
		cache		a supply crate out in the wild, CACHES of them, on the grassland and in the woods (the same places everywhere: the land's
					spawn points)
		body		a player's, where it went down: everything it carried (survival.js: onBody)
		npcBody		an NPC's, where it comes to rest (npcs.js: onDown; FALLEN seconds on, off its horse or out of the sky): what its kind
					would have on it (NPC_LOOT), for BODY_SECONDS
		(a body is on the ground under where it fell, or on the water over it: restingAt)
		pile		things put down or thrown (inventoryUI.js, survivalTools.js): a sack of them, near others merged into one
	What is in each is drawn by lot (TABLES) the first time it is looked in, and the crates and the caches fill again RESTOCK days after
	they were emptied.
	IN A GAME WITH OTHERS (survivalNet.js) the host keeps what is in every one. A joiner asks what is in one it opens (lootOpen: lootIs back),
	asks for a thing out of it (lootTake: lootGot back, and lootIs to everyone), and puts a thing into it (lootPut). The bodies and the piles
	are the host's to make (a joiner's, asked: lootBody, lootPile), and it tells everyone of each (lootAdd, lootDel), and a joiner come in
	of all of them.
*/
const REACH = 2.4;					// metres
const CRATE_EVERY = 3;
const CACHES = 28;
const RESTOCK = 3;					// days
const BODY_SECONDS = 8 * 60;
const PILE_MERGE = 1.5;				// metres
const FALLEN = 2;					// seconds an NPC down takes to come to rest
const GRIDS = { crate: [6, 4], cache: [7, 5], body: [8, 8], npcBody: [6, 4], pile: [5, 4] };
const LABELS = { crate: 'Crate', cache: 'Supply crate', body: 'Body', npcBody: 'Body', pile: 'Things on the ground' };
// [type, chance, most]: rolled for each
const TABLES = {
	crate: [['money', 0.35, 150], ['bread', 0.45, 2], ['sausage', 0.4, 2], ['water', 0.45, 2], ['beer', 0.35, 2], ['smokedFish', 0.15], ['cottonShirt', 0.12], ['henley', 0.08],
		['flannelShirt', 0.08], ['toque', 0.1], ['bandana', 0.1], ['scarf', 0.08], ['cottonSocks', 0.12], ['woolSocks', 0.1], ['drawers', 0.08], ['longJohns', 0.06],
		['denim', 0.08], ['woolTrousers', 0.06], ['workBoots', 0.06], ['moccasins', 0.05], ['cowboyHat', 0.05], ['knife', 0.12], ['stone', 0.2, 5], ['firewood', 0.3, 4],
		['bedroll', 0.1], ['coltRounds', 0.15, 12], ['shells', 0.12, 8], ['haversack', 0.08], ['watch', 0.04], ['compass', 0.04], ['revolver', 0.04]],
	cache: [['money', 0.45, 600], ['rifle', 0.25], ['shotgun', 0.18], ['sharps', 0.1], ['revolver', 0.2], ['mauser', 0.15], ['rifleRounds', 0.5, 20], ['shells', 0.4, 12],
		['coltRounds', 0.35, 18], ['sharpsRounds', 0.25, 8], ['mauserRounds', 0.3, 20], ['rucksack', 0.2], ['framePack', 0.08], ['ammoPouch', 0.3], ['utilityPouch', 0.25],
		['bedrollStrap', 0.15], ['slungPack', 0.15], ['chestplate', 0.06], ['duster', 0.1], ['mackinaw', 0.1], ['buffaloCoat', 0.05], ['sweater', 0.08], ['canvasTrousers', 0.1],
		['chaps', 0.06], ['silkLongJohns', 0.05], ['fleeceDrawers', 0.05], ['ridingBoots', 0.08], ['mukluks', 0.05], ['bootLiners', 0.06], ['kneeSocks', 0.06],
		['trapperHat', 0.06], ['bowler', 0.04], ['furCollar', 0.05], ['balaclava', 0.06], ['bread', 0.4, 2], ['water', 0.5, 2], ['bedroll', 0.2], ['hatchet', 0.1], ['rainCollector', 0.04], ['tentStove', 0.03]],
};
// an NPC's, by its kind (npcs.js)
//		(and what it was wearing, some of it: WORN_KEPT each, outfits.js)
const NPC_LOOT = {
	rider: [['money', 0.6, 300], ['revolver', 0.35], ['coltRounds', 0.7, 12], ['cowboyHat', 0.4], ['bread', 0.4], ['water', 0.4]],
	pilot: [['money', 0.5, 250], ['watch', 0.35], ['compass', 0.3], ['mauser', 0.25], ['mauserRounds', 0.5, 20]],
	gunner: [['money', 0.4, 150], ['rifleRounds', 0.4, 15], ['sausage', 0.3], ['beer', 0.3]],
	captain: [['money', 0.7, 600], ['watch', 0.3], ['compass', 0.3], ['revolver', 0.3], ['coltRounds', 0.5, 12], ['beer', 0.5, 2]],
	lookout: [['money', 0.4, 120], ['toque', 0.4], ['beer', 0.4], ['knife', 0.25], ['smokedFish', 0.3]],
	other: [['money', 0.3, 100], ['bread', 0.4], ['water', 0.4], ['knife', 0.15], ['beer', 0.2]],
};
const WORN_KEPT = 0.5;

const containers = new Map();		// id -> { id, kind, at, grid, items (null: not drawn yet, or not heard yet), restockAt, until }
export const lootStats = { containers: 0, opened: 0, taken: 0, put: 0, bodies: 0, piles: 0 };
const metre = () => settings.forestUnitsPerMetre;
export const containerById = (id) => containers.get(id) ?? null;
export const label = (c) => LABELS[c.kind] ?? 'Container';
const seconds = () => performance.now() / 1000;

// the crates and caches of a land (the same on every machine)
let madeFor = null, housesFor = -1;
function makeFixed() {
	const land = terrain.land;
	// (made again once the towns' houses are up: they come after the land)
	const houses = town.townHouses().length;
	if (!land || (madeFor === land && housesFor == houses)) return;
	madeFor = land;
	housesFor = houses;
	for (const [id, c] of containers) if (c.kind == 'crate' || c.kind == 'cache') containers.delete(id);
	const m = metre();
	town.townHouses().forEach((H, k) => {
		if (k % CRATE_EVERY != 1 || H.footing < settings.waterWorldPosY) return;
		const out = H.depth / 2 + 1.0 * m, side = H.width * 0.3;
		const x = H.x + Math.sin(H.yaw) * out + Math.cos(H.yaw) * side, z = H.z + Math.cos(H.yaw) * out - Math.sin(H.yaw) * side;
		const y = land.heightAt(x, z);
		if (y < settings.waterWorldPosY) return;
		add({ id: 'h' + k, kind: 'crate', at: [x, y, z], yaw: H.yaw });
	});
	const spots = [...land.findSpawnPoints(terrain.ZONE_FOREST, CACHES / 2, { seed: 4441, maxSlope: 0.3 }), ...land.findSpawnPoints(terrain.ZONE_GRASSLAND, CACHES / 2, { seed: 5113, maxSlope: 0.3 })];
	spots.forEach((s, k) => { const y = land.heightAt(s.x, s.z); if (y > settings.waterWorldPosY + 0.5 * m) add({ id: 'w' + k, kind: 'cache', at: [s.x, y, s.z], yaw: k * 1.7 }); });
}
function add(c) {
	containers.set(c.id, { grid: GRIDS[c.kind], items: null, restockAt: -1, until: -1, ...c });
	lootStats.containers = containers.size;
}
// (what is drawn by lot into one: on the host, the first time)
function roll(c, table) {
	const items = [];
	for (const [type, chance, most = 1] of table) {
		if (Math.random() >= chance) continue;
		const item = makeItem(type, 1 + Math.floor(Math.random() * most));
		const at = placeFor(c.grid, items, item);
		if (at) { Object.assign(item, at); items.push(item); }
	}
	return items;
}
function contentsHere(c) {
	if (!survivalNet.authority()) return c.items;
	if (c.items === null || (c.restockAt >= 0 && atmosphere.sunCycles >= c.restockAt)) { c.items = TABLES[c.kind] ? roll(c, TABLES[c.kind]) : []; c.restockAt = -1; }
	return c.items;
}
// (emptied: it fills again in time, a crate or a cache)
function emptied(c) { if (c.items.length == 0 && TABLES[c.kind] && c.restockAt < 0) c.restockAt = atmosphere.sunCycles + RESTOCK; }

// WHAT IS IN ONE (see the top): asked for (open), and told when it comes or changes (onContents)
const contentListeners = [];
export function onContents(fn) { contentListeners.push(fn); }
const told = (id) => contentListeners.forEach((fn) => fn(id));
export function open(id) {
	const c = containers.get(id);
	if (!c) return null;
	lootStats.opened++;
	if (survivalNet.authority()) { contentsHere(c); told(id); }
	else survivalNet.send('lootOpen', { id });
	return c;
}
// a thing out of it, into this player's inventory (where: as inventory.put's, or anywhere it fits): done(true) once it is
export function take(id, uid, where = null, done = () => {}) {
	const c = containers.get(id);
	if (!c?.items) return done(false);
	if (!survivalNet.authority()) { pending.set(uid, { where, done }); survivalNet.send('lootTake', { id, uid }); return; }
	const item = c.items.find((i) => i.uid == uid);
	if (!item) return done(false);
	if (!landIn(item, where)) return done(false);
	c.items.splice(c.items.indexOf(item), 1);
	lootStats.taken++;
	emptied(c);
	changedHere(c);
	done(true);
}
const pending = new Map();
function landIn(item, where) {
	if (where && inventory.put(where.where, item, where.x, where.y, where.rot)) return true;
	return inventory.give(item);
}
// a thing (no one's now) into it, at x, y (or wherever it fits): false if it will not go (then it is still the caller's)
export function putInto(id, item, x = null, y = null, rot = item.rot) {
	const c = containers.get(id);
	if (!c?.items) return false;
	if (!(x !== null && fits(c.grid, c.items, item, x, y, rot))) {
		const at = placeFor(c.grid, c.items, item);
		if (!at) return false;
		({ x, y, rot } = at);
	}
	if (!survivalNet.authority()) { c.items.push(Object.assign(item, { x, y, rot })); survivalNet.send('lootPut', { id, item, x, y, rot }); told(id); return true; }
	c.items.push(Object.assign(item, { x, y, rot }));
	lootStats.put++;
	changedHere(c);
	return true;
}
// a thing moved about in it
export function moveIn(id, uid, x, y, rot) {
	const c = containers.get(id), item = c?.items?.find((i) => i.uid == uid);
	if (!item || !fits(c.grid, c.items, item, x, y, rot)) return false;
	Object.assign(item, { x, y, rot });
	if (survivalNet.authority()) changedHere(c);
	else { survivalNet.send('lootMove', { id, uid, x, y, rot }); told(id); }
	return true;
}
function changedHere(c) {
	told(c.id);
	survivalNet.send('lootIs', { id: c.id, items: c.items });
	// (a body or a pile with nothing left in it goes)
	if ((c.kind == 'pile' || c.kind == 'body' || c.kind == 'npcBody') && c.items.length == 0) remove(c.id);
}

// where a body comes to rest: on the ground under it (not up on a horse, a deck, in the air), or on the water
function restingAt([x, y, z]) {
	const g = terrain.land?.heightAt(x, z) ?? y, water = settings.waterWorldPosY;
	if (g < water) return [x, water, z];
	return [x, y < g || y - g > 2.5 * metre() ? g : y, z];
}
// THE BODIES AND THE PILES (see the top): made by the host
function makeDynamic(kind, at, items, extra = {}) {
	const id = (kind == 'pile' ? 'p' : 'b') + Math.floor(Math.random() * 1e9);
	const c = { id, kind, at: kind == 'pile' ? at : restingAt(at), items: [], grid: [...GRIDS[kind]], until: kind == 'npcBody' ? seconds() + BODY_SECONDS : -1, ...extra };
	for (const item of items) {
		let place = placeFor(c.grid, c.items, item);
		while (!place) { c.grid[1] += 2; place = placeFor(c.grid, c.items, item); }
		c.items.push(Object.assign(item, place));
	}
	add(c);
	survivalNet.send('lootAdd', { c: shareOf(c) });
	told(id);
	return c;
}
function remove(id) {
	if (!containers.delete(id)) return;
	lootStats.containers = containers.size;
	told(id);
	if (survivalNet.authority()) survivalNet.send('lootDel', { id });
}
const shareOf = (c) => ({ id: c.id, kind: c.kind, at: c.at.map((v) => Math.round(v * 100) / 100), grid: c.grid, items: c.items, name: c.name ?? null });
// a player's body (survival.js): everything it had
survival.onBody((at, items) => {
	if (!items.length) return;
	if (survivalNet.authority()) { makeDynamic('body', at, items, { name: survivalNet.role() == 'host' ? 'yours' : null }); lootStats.bodies++; }
	else survivalNet.send('lootBody', { at, items });
});
// things put down (inventoryUI.js) or come to rest (a thrown hatchet: survivalTools.js), here: into a pile near enough, or a new one
export function dropHere(items, at = null) {
	const p = hunting.hunterPlace();
	at ??= [p.x, p.y, p.z];
	if (!survivalNet.authority()) { survivalNet.send('lootPile', { at, items }); return; }
	pileAt(at, items);
}
function pileAt(at, items) {
	const m = metre();
	const near = [...containers.values()].find((c) => c.kind == 'pile' && Math.hypot(c.at[0] - at[0], c.at[2] - at[2]) < PILE_MERGE * m);
	if (near) { for (const item of items) putInto(near.id, item); return near; }
	lootStats.piles++;
	return makeDynamic('pile', at, items);
}
// an NPC down, on the host: what it had on it, once it has come to rest (FALLEN)
const falling = [];
npcs.onDown((person) => {
	if (!inventory.survivalOn() || !survivalNet.authority() || !person.place) return;
	falling.push({ person, at: [person.place.x, person.place.y, person.place.z] });
});
function bodiesFallen() {
	for (let k = falling.length - 1; k >= 0; k--) {
		const { person, at } = falling[k], p = person.place;
		if (p && !person.alive) { at[0] = p.x; at[1] = p.y; at[2] = p.z; }
		if (!person.alive && !person.gone && person.down < FALLEN) continue;
		falling.splice(k, 1);
		const table = NPC_LOOT[person.kind] ?? NPC_LOOT.other;
		const c = { grid: GRIDS.npcBody }, items = roll(c, table);
		for (const [type, colour] of outfits.npcOutfit(npcs.war.on && person.side ? 'soldier' : person.kind, Math.round(person.hue * 1000))) {
			if (Math.random() >= WORN_KEPT) continue;
			const item = makeItem(type, 1, colour), place = placeFor(c.grid, items, item);
			if (place) { Object.assign(item, place); items.push(item); }
		}
		if (items.length) makeDynamic('npcBody', at, items);
	}
}

// THE MESSAGES (see the top)
survivalNet.on('lootOpen', (m, from) => { const c = containers.get(m.id); if (c) survivalNet.sendTo(from, 'lootIs', { id: c.id, items: contentsHere(c) }); });
survivalNet.on('lootIs', (m) => {
	if (survivalNet.authority()) return;
	const c = containers.get(m.id);
	if (c) { c.items = (m.items ?? []).map(cleanItem).filter(Boolean); told(c.id); }
});
survivalNet.on('lootTake', (m, from) => {
	const c = containers.get(m.id), item = c?.items?.find((i) => i.uid == m.uid);
	if (!item) { survivalNet.sendTo(from, 'lootGot', { id: m.id, uid: m.uid, item: null }); return; }
	c.items.splice(c.items.indexOf(item), 1);
	lootStats.taken++;
	emptied(c);
	survivalNet.sendTo(from, 'lootGot', { id: m.id, uid: m.uid, item });
	changedHere(c);
});
survivalNet.on('lootGot', (m) => {
	const p = pending.get(m.uid);
	pending.delete(m.uid);
	const item = cleanItem(m.item);
	if (!item) { p?.done(false); return; }
	if (landIn(item, p?.where)) p?.done(true);
	else { dropHere([item]); p?.done(false); }
});
survivalNet.on('lootPut', (m) => { const item = cleanItem(m.item); if (item && !putInto(m.id, item, m.x, m.y, m.rot)) pileAt(containers.get(m.id)?.at ?? [0, 0, 0], [item]); });
survivalNet.on('lootMove', (m) => moveIn(m.id, m.uid, m.x, m.y, m.rot ? 1 : 0));
survivalNet.on('lootBody', (m) => { const items = (m.items ?? []).map(cleanItem).filter(Boolean); if (items.length && Array.isArray(m.at)) { makeDynamic('body', m.at.map(Number), items); lootStats.bodies++; } });
survivalNet.on('lootPile', (m) => { const items = (m.items ?? []).map(cleanItem).filter(Boolean); if (items.length && Array.isArray(m.at)) pileAt(m.at.map(Number), items); });
survivalNet.on('lootAdd', (m) => {
	if (survivalNet.authority() || !m.c?.id) return;
	add({ id: m.c.id, kind: m.c.kind, at: m.c.at.map(Number), grid: m.c.grid, items: (m.c.items ?? []).map(cleanItem).filter(Boolean), name: m.c.name });
	told(m.c.id);
});
survivalNet.on('lootDel', (m) => { if (!survivalNet.authority()) { containers.delete(m.id); told(m.id); } });
survivalNet.onJoin((id) => { for (const c of containers.values()) if (c.kind == 'body' || c.kind == 'npcBody' || c.kind == 'pile') survivalNet.sendTo(id, 'lootAdd', { c: shareOf(c) }); });

// E AT ONE (see the top), and what is said of it
export function inView() {
	if (!inventory.survivalOn()) return null;
	const p = hunting.hunterPlace(), m = metre();
	if (!p.active || p.on != 'land') return null;
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ];
	const look = [Math.sin(settings.camYaw) * Math.cos(settings.camPitch), Math.sin(settings.camPitch), -Math.cos(settings.camYaw) * Math.cos(settings.camPitch)];
	let best = null, bestScore = Infinity;
	for (const c of containers.values()) {
		const to = [c.at[0] - eye[0], c.at[1] + 0.3 * m - eye[1], c.at[2] - eye[2]], d = Math.hypot(...to) / m;
		if (d > REACH + 1.2) continue;
		const off = 1 - (to[0] * look[0] + to[1] * look[1] + to[2] * look[2]) / (d * m || 1);
		if (off > 0.12) continue;
		if (off + d * 0.02 < bestScore) { bestScore = off + d * 0.02; best = c; }
	}
	return best;
}
const openListeners = [];
export function onOpen(fn) { openListeners.push(fn); }
hunting.onUse(() => {
	const c = inView();
	if (!c) return false;
	open(c.id);
	for (const fn of openListeners) fn(c.id);
	return true;
});
hunting.addPrompt(() => { const c = inView(); return c ? { name: label(c), keys: 'E search' } : null; });

// Once a frame
export function lootUpdate() {
	if (!inventory.survivalOn()) return;
	makeFixed();
	if (survivalNet.authority()) bodiesFallen();
	if (survivalNet.authority()) for (const c of [...containers.values()]) if (c.until >= 0 && seconds() > c.until) remove(c.id);
}
export const containerList = () => [...containers.values()];
export function lootForTest() { return [...containers.values()].map((c) => ({ id: c.id, kind: c.kind, items: c.items?.length ?? null })); }
