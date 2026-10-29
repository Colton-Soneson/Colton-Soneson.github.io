import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as players from './players.js'
import * as help from './controlsHelp.js'
import * as props from './props.js'
import { setGrassFlats } from './computeGrass.js'
import * as survivalNet from './survivalNet.js'
import { makeItem } from './items.js'
import * as inventory from './inventory.js'
import * as survival from './survival.js'
import * as loot from './loot.js'

/*
	THE CANVAS BEDROLL of the Survival mode (items.js: bedroll): carried in a grid, or rolled up on the backpack in the bedroll straps (a
	pouch for it alone). DEPLOYED (the inventory screen: right click), it is laid out flat on the ground in front of the walker (REACH), the
	way it faces, and stays there for anyone:
		E		sleep on it: lying on it (hunting.js: setStance) until the tiredness is gone, a key is pressed, or it is hurt (survival.js)
		F		roll it up again: into the inventory (the straps first, if they are empty), or put down if there is no room
	WHERE IT LAST SLEPT is kept (in the browser too: SAVED), and a walker down comes back there (players.js: placeRespawn), whether the
	bedroll is still out or not.
	In a game (survivalNet.js) the host keeps the bedrolls out: a joiner's laid out is asked for (rollDeploy), and everyone told of each
	(rollAdd, rollDel), a joiner come in of all of them; rolling one up is asked for too (rollUp, rollGot back), so two cannot both have it.
*/
const REACH = 1.8;					// metres in front it is laid out
const USE_REACH = 2.4;				// metres it can be used from
const SAVED = 'survivalSlept';

const rolls = new Map();			// id -> { id, at, yaw }
export const bedrollStats = { deployed: 0, rolled: 0, slept: 0 };
const metre = () => settings.forestUnitsPerMetre;

// LAID OUT (see the top): the item (in the inventory) taken out of it, if there is ground for it
export function deploy(item) {
	const p = hunting.hunterPlace(), m = metre(), land = terrain.land;
	if (p.on != 'land' || p.swimming) { help.toast('On firm ground'); return false; }
	const yaw = settings.camYaw, ahead = [Math.sin(yaw), -Math.cos(yaw)];
	const x = p.x + ahead[0] * REACH * m, z = p.z + ahead[1] * REACH * m, y = land.heightAt(x, z);
	if (y < settings.waterWorldPosY + 0.1 * m || Math.abs(y - p.y) > 1.2 * m) { help.toast('No room to lay it out there'); return false; }
	inventory.remove(item);
	if (survivalNet.authority()) add({ id: 'r' + Math.floor(Math.random() * 1e9), at: [x, y, z], yaw }, true);
	else survivalNet.send('rollDeploy', { at: [x, y, z], yaw });
	bedrollStats.deployed++;
	help.toast('Bedroll laid out: E to sleep, F to roll it up');
	return true;
}
function add(roll, tell) {
	rolls.set(roll.id, roll);
	if (tell) survivalNet.send('rollAdd', roll);
}
function take(id) {
	if (!rolls.delete(id)) return false;
	survivalNet.send('rollDel', { id });
	return true;
}
// ROLLED UP (see the top): into the straps, or anywhere, or put down
function rollUp(id) {
	if (!survivalNet.authority()) { survivalNet.send('rollUp', { id }); return; }
	if (take(id)) carry();
}
function carry() {
	bedrollStats.rolled++;
	const item = makeItem('bedroll');
	const straps = inventory.grids().find((g) => g.owner.type == 'bedrollStrap' && g.items.length == 0);
	if (straps && inventory.put({ kind: 'grid', grid: straps.id }, item, 0, 0, 0)) { help.toast('Bedroll rolled up, on the straps'); return; }
	if (inventory.give(item)) { help.toast('Bedroll rolled up'); return; }
	loot.dropHere([item]);
	help.toast('No room: the bedroll is on the ground');
}
survivalNet.on('rollDeploy', (msg) => { if (Array.isArray(msg.at)) add({ id: 'r' + Math.floor(Math.random() * 1e9), at: msg.at.map(Number), yaw: Number(msg.yaw) || 0 }, true); });
survivalNet.on('rollAdd', (msg) => { if (!survivalNet.authority()) add({ id: msg.id, at: msg.at.map(Number), yaw: Number(msg.yaw) || 0 }, false); });
survivalNet.on('rollDel', (msg) => { if (!survivalNet.authority()) rolls.delete(msg.id); });
survivalNet.on('rollUp', (msg, from) => survivalNet.sendTo(from, 'rollGot', { id: msg.id, ok: take(msg.id) }));
survivalNet.on('rollGot', (msg) => { if (msg.ok) carry(); });
survivalNet.onJoin((id) => { for (const r of rolls.values()) survivalNet.sendTo(id, 'rollAdd', r); });

// SLEEPING on one (see the top), and where it last slept
let sleepingOn = null;
let lastSlept = null;
try { lastSlept = JSON.parse(localStorage.getItem(SAVED) ?? 'null'); } catch (e) { /* (none) */ }
function sleepOn(roll) {
	hunting.teleportHunter(roll.at[0], roll.at[1] + 0.05 * metre(), roll.at[2]);
	if (!survival.sleep()) return;
	sleepingOn = roll.id;
	hunting.setStance({ facing: roll.yaw, arc: Math.PI, low: -0.4, high: 1.3 });
	lastSlept = { x: roll.at[0], z: roll.at[2] };
	try { localStorage.setItem(SAVED, JSON.stringify(lastSlept)); } catch (e) { /* */ }
	bedrollStats.slept++;
}
players.placeRespawn(() => inventory.survivalOn() && lastSlept ? { ...lastSlept } : null);
export const lastSleptAt = () => lastSlept;
// (a bedroll in a tent: camp.js) { id, at, yaw }
export const sleepAt = (roll) => sleepOn(roll);

// THE ONE LOOKED AT, within USE_REACH
function inView() {
	if (!inventory.survivalOn()) return null;
	const p = hunting.hunterPlace(), m = metre();
	if (!p.active || p.on != 'land') return null;
	const look = [Math.sin(settings.camYaw), -Math.cos(settings.camYaw)];
	let best = null, bestD = USE_REACH;
	for (const r of rolls.values()) {
		const dx = (r.at[0] - p.x) / m, dz = (r.at[2] - p.z) / m, d = Math.hypot(dx, dz);
		if (d < bestD && (d < 1 || (dx * look[0] + dz * look[1]) / d > 0.6)) { best = r; bestD = d; }
	}
	return best;
}
hunting.onUse(() => { const r = inView(); if (!r || survival.status.asleep > 0) return false; sleepOn(r); return true; });
hunting.onVehicleUse(() => { const r = inView(); if (!r || survival.status.asleep > 0) return false; rollUp(r.id); return true; });
hunting.addPrompt(() => inView() ? { name: 'Canvas bedroll', keys: 'E sleep · F roll up' } : null);

// Once a frame: drawn, and up again once awake
export function bedrollsUpdate() {
	if (!inventory.survivalOn()) return;
	const m = metre();
	for (const r of rolls.values()) if (Math.hypot(r.at[0] - settings.camPosX, r.at[2] - settings.camPosZ) / m < 300) props.show('bedrollFlat', props.place(r.at, Math.PI - r.yaw));
	setGrassFlats('bedrolls', [...rolls.values()].map((r) => [r.at[0], r.at[2], 1.2 * m]));
	if (sleepingOn && survival.status.asleep <= 0) { sleepingOn = null; hunting.setStance(null); }
}
// for testing
export const rollsForTest = () => [...rolls.values()];
export function sleepForTest() { const r = [...rolls.values()][0]; if (r) sleepOn(r); return !!r; }
