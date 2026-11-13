import { settings } from './settings.js';
import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as inventory from './inventory.js'
import * as survival from './survival.js'
import * as survivalNet from './survivalNet.js'
import * as bedrolls from './bedrolls.js'
import * as stations from './stations.js'
import { towerCot, towerStove } from './townGround.js'

/*
	THE FIRE TOWERS' SHELTER (townGround.js: THE FIRE TOWER, on each main peak: terrain.land.fireTowers). In the Survival mode:
		the cot		E sleeps on it (bedrolls.js: sleepAt, as on a bedroll: the place the player last slept, where they come back to)
		the stove	a fireplace (stations.js): E firewood, the lighter, and it warms the cab. The host's, one for each tower, made when its
					tile is here (addFixed: once, and kept with the rest of the stations)
*/
const REACH = 2.4;				// metres: how near the cot to sleep on it
const metre = () => settings.forestUnitsPerMetre;
export const towerStats = { stoves: 0, slept: 0 };
const idOf = ([x, z]) => 'tower:' + Math.round(x) + ',' + Math.round(z);
const place = ([x, z], [u, h, w]) => { const m = metre(), y0 = terrain.land.groundAt(x, z); return [x + u * m, y0 + h * m, z + w * m]; };

// the cot looked at, near enough: { id, at, yaw } (a bedroll's, for bedrolls.sleepAt)
function cotInView() {
	if (!inventory.survivalOn() || !terrain.land) return null;
	const p = hunting.hunterPlace(), m = metre(), look = [Math.sin(settings.camYaw), -Math.cos(settings.camYaw)];
	for (const tower of terrain.land.fireTowers ?? []) {
		if (Math.hypot(tower[0] - p.x, tower[1] - p.z) > 12 * m) continue;
		const cot = towerCot(), at = place(tower, cot.at);
		const dx = (at[0] - p.x) / m, dz = (at[2] - p.z) / m, d = Math.hypot(dx, dz);
		if (Math.abs(at[1] - p.y) > 1.6 * m) continue;
		if (d < REACH && (d < 0.9 || (dx * look[0] + dz * look[1]) / d > 0.5)) return { id: idOf(tower) + ':cot', at, yaw: cot.yaw };
	}
	return null;
}
hunting.onUse(() => { const cot = cotInView(); if (!cot || survival.status.asleep > 0) return false; bedrolls.sleepAt(cot); towerStats.slept++; return true; });
hunting.addPrompt(() => cotInView() ? { name: 'Cot', keys: 'E sleep' } : null);

// the stoves: the host's, a fireplace for each tower there is
let madeFor = null;
function stovesNow() {
	if (!survivalNet.authority() || !inventory.survivalOn() || !terrain.land) return;
	for (const tower of terrain.land.fireTowers ?? []) if (stations.addFixed('fireplace', place(tower, towerStove().at), 0, idOf(tower) + ':stove')) towerStats.stoves++;
}
terrain.onTiles(() => stovesNow());
export function fireTowersUpdate() {
	const now = inventory.survivalOn() && survivalNet.authority() ? terrain.land : null;
	if (now !== madeFor) { madeFor = now; stovesNow(); }
}
// (for testing) a tower's cot and its stove's station, where they are
export const towerForTest = (tower) => ({ cot: place(tower, towerCot().at), stove: place(tower, towerStove().at), id: idOf(tower) });
