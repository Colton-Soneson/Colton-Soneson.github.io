import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as boat from './boat.js'
import * as hunting from './hunting.js'
import * as npcs from './npcs.js'
import { chooseCourse, steerFor, trim, warpOff, bearing, windFrom } from './npcShips.js'
import { seededRandom } from './terrainGenerator.js'
import { VESSELS } from './vessels.js'

/*
	THE DINGHY SAILORS (npcs.js's people): DINGHIES dinghies (boat.js, vessels.js), each sailed by one sailor at its helm, in shallow
	water close in by the land (HOME: not too deep, the land near, room to sail) where it is easy to get about: the sea's bays and,
	where there is one big enough, a lake. Each has its own home water, as far from the others as can be (APART), the same for the
	same land (the land's seed).
	SAILING (npcShips.js's: the course chosen round the no-go zone and whatever is in the way, steered for, the sails trimmed): about
		its home water, to one place in it after another (WANDER: in water deep enough for its centreboard and not too deep, the way there
		all water; strayed far, home first), and
		round the land, the other boats and the shallows (it wants SHALLOW under it). In a blow its sheets are eased as it heels (HEEL), its
		sailor out on the windward side; aground, it is pushed off (npcShips.js: warpOff).
	ATTACKED (npcs.js: a hit on it or on its boat): it has no gun. It runs: away from whoever fired, downwind if that is near enough the
		way (it is fastest there), until it has been left alone for a while.
	SHOT DEAD: it lies in its boat, which drifts with its sheets let go. Back RESPAWN_SECONDS later (npcs.js) in a new dinghy at its home
		water; the old one goes, if no one is on it and the walker is not by it. Its boat shot to pieces: it is lost with it.
	Metres and seconds
*/
const DINGHIES = 3;
const HOME = { least: 3.0, most: 7, land: 70, grid: 40, room: 5 };	// metres deep, land within, a grid to look on; and how many of 8 ways round must be open water
const APART = 350;					// metres between homes, at the least (as far as can be)
const WANDER = { reach: 220, least: 2.5, deepest: 12, near: 25, most: 120 };	// metres from home a place it sails to may be, deep at the least and the most, near enough, seconds at the most
const SHALLOW = 2.5;				// metres of water it wants under it (its centreboard goes down 1, and the waves' troughs)
const PROBES = [8, 18, 32];			// metres along a course it looks
const FLEE = { downwind: 1.0, calm: 25 };
const HEEL = 0.4;					// radians: heeled more than this, its sheets are eased (npcShips.js: trim)	// radians off the way away it runs downwind instead; seconds left alone before it goes back to wandering

const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const { wrap } = npcs;
const depthAt = (x, z) => (settings.waterWorldPosY - terrain.land.heightAt(x * metre(), z * metre())) / metre();
const halfWorld = () => settings.terrainWorldSize * 0.5 / metre();

export const dinghyStats = { dinghies: 0, homes: 0, lakes: 0, newBoats: 0, fled: 0 };

// Their home waters (see HOME at the top)
//-------------------------------------------------
function findHomes(land) {
	const m = metre(), half = halfWorld() - 150, spots = [];
	const ways = Array.from({ length: 8 }, (_, k) => [Math.cos(k / 8 * Math.PI * 2), Math.sin(k / 8 * Math.PI * 2)]);
	for (let x = -half; x <= half; x += HOME.grid) {
		for (let z = -half; z <= half; z += HOME.grid) {
			const d = depthAt(x, z);
			if (d < HOME.least || d > HOME.most) continue;
			if (!ways.some(([cx, cz]) => depthAt(x + cx * HOME.land, z + cz * HOME.land) < 0)) continue;
			const room = ways.filter(([cx, cz]) => depthAt(x + cx * 40, z + cz * 40) > WANDER.least && depthAt(x + cx * 90, z + cz * 90) > WANDER.least).length;
			if (room < HOME.room) continue;
			if (land.townAt?.(x * m, z * m) > 0.05) continue;
			spots.push({ x, z, lake: land.zoneAt(x * m, z * m) == terrain.ZONE_LAKE });
		}
	}
	// a lake first if there is one, then the rest, each as far from those already had as can be
	const random = seededRandom(settings.terrainSeed * 53 + 17);
	const homes = [];
	const lakes = spots.filter((s) => s.lake);
	if (lakes.length) homes.push(lakes[Math.floor(random() * lakes.length)]);
	while (homes.length < DINGHIES && spots.length) {
		let best = null, bestApart = -1;
		for (let k = 0; k < 60; k++) {
			const s = spots[Math.floor(random() * spots.length)];
			const apart = homes.length ? Math.min(...homes.map((h) => Math.hypot(h.x - s.x, h.z - s.z))) : 1e9;
			if (apart > bestApart) { bestApart = apart; best = s; }
		}
		if (homes.length && bestApart < APART * 0.4) break;
		homes.push(best);
	}
	dinghyStats.homes = homes.length;
	dinghyStats.lakes = homes.filter((h) => h.lake).length;
	return homes;
}
// a place to sail to, about home: deep enough there, and water all the way from where it is
function wanderSpot(d, from) {
	for (let k = 0; k < 30; k++) {
		const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * WANDER.reach;
		const x = d.home.x + Math.cos(a) * r, z = d.home.z + Math.sin(a) * r;
		const depth = depthAt(x, z);
		if (depth < WANDER.least || depth > WANDER.deepest) continue;
		let clear = true;
		for (let t = 0.1; t <= 1 && clear; t += 0.1) if (depthAt(from[0] + (x - from[0]) * t, from[1] + (z - from[1]) * t) < WANDER.least * 0.8) clear = false;
		if (clear) return [x, z];
	}
	return [d.home.x, d.home.z];
}

// The dinghies
//-------------------------------------------------
// each: { person, home ({ x, z, lake }), boat, goal ([x, z]), goalAt, calm (seconds since it was last shot at), tack, tackAt }
const dinghies = [];
let builtFor = null;

function makeDinghies(land) {
	clearDinghies();
	for (const home of findHomes(land)) {
		const person = npcs.makePerson('sailor', { hat: 'beanie', gun: 'none', home: { x: home.x * metre(), z: home.z * metre(), heading: 0 }, name: 'dinghy sailor' });
		const d = { person, home, boat: null, goal: null, goalAt: 0, calm: 1e9 };
		dinghies.push(d);
		launch(d);
	}
	dinghyStats.dinghies = dinghies.length;
}
function clearDinghies() {
	for (const d of dinghies) { npcs.removePerson(d.person); if (d.boat?.exists && d.boat.crew.size <= 1) { boat.removeBoat(d.boat); npcs.announce('boat', null, d.boat); } }
	dinghies.length = 0;
}
// a new dinghy at its home water, the sailor at its helm, sailing off on a reach
function launch(d) {
	const m = metre(), V = VESSELS.Dinghy;
	let at = null, yaw = 0;
	for (let k = 0; k < 24 && !at; k++) {
		const a = k / 24 * Math.PI * 2, r = k < 8 ? 0 : 15;
		const x = (d.home.x + Math.cos(a) * r) * m, z = (d.home.z + Math.sin(a) * r) * m;
		for (const way of [windFrom() + Math.PI / 2, windFrom() - Math.PI / 2]) {
			const y = Math.atan2(Math.sin(way), -Math.cos(way));		// (as settings.camYaw)
			if (!boat.footprintClear(V, x, z, y)) { at = [x, z]; yaw = y; break; }
		}
	}
	if (!at) return;
	d.boat = boat.spawnBoat(at[0], at[1], 'Dinghy', { yaw, owner: 'npc', authority: 0 });	// (authority: this machine, alone or the host)
	d.goal = null;
	d.tack = 0;
	dinghyStats.newBoats++;
	npcs.announce('boat', d.boat, null);
}

function stepDinghy(d, dt) {
	const p = d.person, b = d.boat, now = npcs.now(), m = metre();
	// back at its home water in a new boat; the old one goes (if no one is on it, and the walker is not by it)
	if (!p.alive && p.respawnIn <= 0 && p.respawnIn > -1) {
		const me = hunting.hunterPlace();
		if (b?.exists && b.destroyed < 0 && !b.crew.has('me') && !(me.active && Math.hypot(me.x / m - b.p[0], me.z / m - b.p[2]) < 40)) { boat.removeBoat(b); npcs.announce('boat', null, b); }
		else if (b?.exists) boat.setCrew(b, p.id, null);
		npcs.revive(p);
		launch(d);
		return;
	}
	if (!b || !b.exists) return;
	const V = b.vessel;
	// at its helm, out on the windward side (its weight against the heel: hiking, as vessels.js's helm has it), tipped with the boat (or,
	//		dead, lying in it, carried along)
	const seat = [V.helm.hike ? b.frame.windwardSide() * V.helm.hikeX : V.helm.at[0], V.helm.at[1], V.helm.at[2]];
	const at = b.frame.toWorld(seat);
	if (p.alive) {
		const { heading, tilt } = npcs.tipped(b.frame.directionToWorld([0, 0, 1]), b.frame.up());
		p.place = { x: at[0], y: at[1], z: at[2], heading, tilt, sit: 1 };
		p.anchor = { vehicle: b.id, local: seat, facing: [0, 0, 1] };
		p.armsDown = 0;
		boat.setCrew(b, p.id, [seat[0], seat[1] + 0.35, seat[2]]);
	} else {
		p.place = { ...p.place, x: at[0], y: at[1], z: at[2], tilt: null };
		boat.setCrew(b, p.id, null);
		trim(b, { luff: true });
		return;
	}
	// (a player who has taken the tiller sails it: the sailor leaves it to them)
	const me = hunting.hunterPlace();
	if (me.boat === b.id && me.on == 'seat') return;
	// running from whoever shot at it, or about its home water
	const here = [b.p[0], b.p[2]];
	const enemy = npcs.enemiesOf(p.group, at[0], at[1], at[2])[0];
	let wanted;
	if (enemy) {
		if (d.calm > FLEE.calm) dinghyStats.fled++;
		d.calm = 0;
		const away = bearing(here[0] - enemy.x / m, here[1] - enemy.z / m), downwind = windFrom() + Math.PI;
		wanted = Math.abs(wrap(downwind - away)) < FLEE.downwind ? downwind : away;
	} else {
		d.calm += dt;
		// (strayed far from home, after running: back towards it first)
		const strayed = Math.hypot(d.home.x - here[0], d.home.z - here[1]) > WANDER.reach * 1.5;
		if (!d.goal || Math.hypot(d.goal[0] - here[0], d.goal[1] - here[1]) < WANDER.near || now - d.goalAt > WANDER.most) { d.goal = strayed ? [d.home.x, d.home.z] : wanderSpot(d, here); d.goalAt = now; }
		wanted = bearing(d.goal[0] - here[0], d.goal[1] - here[1]);
	}
	const course = chooseCourse(d, b, wanted, 1.0, now, PROBES, SHALLOW);
	steerFor(b, course, dt, 1.6);
	trim(b, { heel: HEEL });
	warpOff(d, b, dt, [6, 14]);
}
// shot to pieces: its sailor lost with it
boat.onBreak((at, b) => {
	const d = dinghies.find((one) => one.boat === b);
	if (!d) return;
	if (d.person.alive) npcs.harm(d.person, 1000, d.person.group.lastShotBy, 'sunk');
	d.person.gone = true; d.person.place = d.person.anchor = null;
});
// each dinghy's sailor's group (npcs.js: a shot at the boat is a shot at the sailor)
npcs.addVehicleGroups((id) => dinghies.find((d) => d.boat?.id === id)?.person.group ?? null);

// Per frame (after npcs.js's)
//-------------------------------------------------
export function dinghiesUpdate(dt) {
	const land = terrain.land;
	if (!npcs.on() || !npcs.runsHere() || !settings.enableWater) {
		if (dinghies.length && (!settings.enableNPCs || !npcs.runsHere())) { clearDinghies(); builtFor = null; }
		return;
	}
	if (land !== builtFor) { builtFor = land; makeDinghies(land); }
	for (const d of dinghies) stepDinghy(d, dt);
}

// for testing
export function dinghyList() {
	return dinghies.map((d) => ({ id: d.person.id, alive: d.person.alive, home: d.home, boat: d.boat?.id ?? null, at: d.boat && [Math.round(d.boat.p[0]), Math.round(d.boat.p[2])], speed: d.boat && Math.round(d.boat.stats.speed * 10) / 10,
		depth: d.boat && Math.round(depthAt(d.boat.p[0], d.boat.p[2]) * 10) / 10, aground: d.boat?.stats.aground, goal: d.goal, calm: d.calm, heel: d.boat && Math.round(d.boat.stats.heel * 100) / 100 }));
}
export const dinghiesForTest = dinghies;
