import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as forest from './forest.js'
import * as boulders from './boulders.js'
import * as town from './town.js'
import * as townFolk from './townFolk.js'
import * as deer from './deer.js'
import * as npcs from './npcs.js'
import * as treasury from './treasury.js'
import { roadsFor } from './npcRiders.js'
import { BUILDING_TYPES } from './townLayout.js'

/*
	THE HUNTERS (npcs.js's people): PER_TOWN from every town, on foot, a rifle in their hands. Each lives by its town's butcher's door. A while there (REST), then:
		OUT			along the town's ways and straight on over the land to the nearest deer (deer.js: nearestDeer, within REACH of it)
		STALK		within RANGE, in the clear: it stops, aims (AIM seconds), and fires, until the deer is down (it is a shot like anyone's: ballistics.js)
		CUT			to the carcass, and cuts it up (deer.js: butcher), a cut every CUT seconds, until there is nothing on it (so there is nothing left for a player)
		BACK		to the butcher's door, and the town is paid (treasury.js: PAID)
	SHOT AT (npcs.js): it turns and shoots back at whoever fired, within FIGHT, until they are gone or it is. DOWN: it lies where it fell, and is back at its door RESPAWN_SECONDS later.
	IN THE WAY (walkTo): trees, boulders, houses, water and cliffs: it looks along a fan of headings, as the riders do (npcRiders.js). Stuck (going nowhere for STUCK seconds), it goes off another way a moment; stuck SCRAMBLE times over (a terrace wall, say), it scrambles over whatever it is.
	In a game they are the host's, and go to the others as all the NPCs do (net.js: peopleShare). World units (2 to the metre) for places, metres a second for paces.
*/
const PER_TOWN = 2;
const WALK = 2.2, RUN = 3.2;		// metres a second
const STRIDE = 1.4;
const REST = [20, 45];				// seconds
const REACH = 900;					// metres from it a deer can be
const RANGE = 55;					// metres
const AIM = 1.6;					// seconds
const FIRE_EVERY = 2.8;
const SPREAD = 0.004;
const CUT = 1.2;					// seconds
const PAID = 20;					// dollars
const FIGHT = 90;					// metres
const THINK = 0.25;					// seconds between looks ahead
const FAN = [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 1.9, -1.9, 2.6, -2.6];
const PROBES = [1.5, 3.5];			// metres
const STUCK = 3, ASIDE = 2;			// seconds
const SCRAMBLE = 3;

const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export const hunterStats = { hunters: 0, deer: 0, paid: 0, shots: 0 };

const hunters = [];
let builtFor = null;

// the butcher's door of a town, or failing one its inn's, or its first house's
function doorOf(t) {
	const named = (name) => t.buildings.find((b) => BUILDING_TYPES[b.type].name == name);
	const b = named('timbered') ?? named('inn') ?? t.buildings.find((o) => !o.onPier);
	if (!b) return null;
	const out = b.depth / 2 + 1.5 * metre();
	return { x: b.x + Math.sin(b.yaw) * out, z: b.z + Math.cos(b.yaw) * out, heading: b.yaw + Math.PI, town: t };
}
function clear() {
	for (const h of hunters) npcs.removePerson(h.person);
	hunters.length = 0;
}
function build(land) {
	builtFor = land;
	clear();
	for (const t of land.towns ?? []) {
		if (!t.buildings?.length) continue;
		const door = doorOf(t);
		if (!door) continue;
		for (let k = 0; k < PER_TOWN; k++) {
			const person = npcs.makePerson('hunter', { hat: 'flatCap', gun: 'rifle', home: door, name: 'hunter' });
			const h = { aside: 0, scramble: 0, snags: 0, carrying: false, person, door, town: t, state: 'rest', timer: REST[0] * k + Math.random() * REST[1], x: door.x + k * metre(), z: door.z, ground: null, y: 0, heading: door.heading, route: [], along: 0, deer: null, corpse: null, wanted: door.heading, think: Math.random() * THINK, stuck: 0, fire: AIM, lastAt: [door.x, door.z], enemyFire: 1 };
			h.y = deer.groundUnder(h);
			hunters.push(h);
			place(h, 0);
		}
	}
	hunterStats.hunters = hunters.length;
}
function place(h, walking, stride = 0, tilt = null) {
	const p = h.person;
	p.place = { x: h.x, y: h.y, z: h.z, heading: h.heading, sit: 0, ...(tilt ? { tilt } : {}) };
	p.walking = walking;
	p.stride = stride;
	p.anchor = null;
	p.armsDown = p.fighting ? 0 : 1;
}
// a way from where it is to a place: along its town's ways as far as they go that way, then straight
function routeTo(h, to) {
	const roads = roadsFor(terrain.land), a = roads.nearest(h.x, h.z), b = roads.nearest(to[0], to[1]);
	const onRoads = a >= 0 && b >= 0 ? townFolk.wayBetween(roads, a, b) : null;
	h.route = [...(onRoads ?? []).map((k) => [roads.nodes[k].x, roads.nodes[k].z]), to];
	h.along = 0;
}
function blocked(x, z, feet) {
	const m = metre(), land = terrain.land, half = settings.terrainWorldSize * 0.5 - 20;
	if (Math.abs(x) > half || Math.abs(z) > half || land.heightAt(x, z) < settings.waterWorldPosY + 0.3 * m) return true;
	let hit = false;
	const box = (bx, bz, r, bottom, top) => { if (!hit && top > feet + 0.5 * m && bottom < feet + 1.8 * m && Math.abs(x - bx) < r + 0.4 * m && Math.abs(z - bz) < r + 0.4 * m) hit = true; };
	if (settings.enableForest) forest.trunksNear(x, z, m, box);
	if (settings.enableBoulders) boulders.bouldersNear(x, z, 2 * m, box);
	town.boxesNear(x, z, m, box);
	return hit;
}
// a step towards a place, round what is in the way: how far off it still is
function walkTo(h, to, pace, dt) {
	const m = metre(), dx = to[0] - h.x, dz = to[1] - h.z, far = Math.hypot(dx, dz);
	h.think -= dt;
	// (going nowhere: off to one side for a moment)
	if (Math.hypot(h.x - h.lastAt[0], h.z - h.lastAt[1]) > 0.5 * m) { h.lastAt = [h.x, h.z]; h.stuck = 0; if (h.scramble <= 0) h.snags = Math.max((h.snags ?? 0) - dt * 0.2, 0); }
	else if ((h.stuck += dt) > STUCK) { h.stuck = 0; h.aside = ASIDE; h.wanted = h.heading + (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random()); h.snags = (h.snags ?? 0) + 1; }
	if (h.snags >= SCRAMBLE) { h.snags = 0; h.scramble = 4; h.aside = 0; }
	if (h.scramble > 0) { h.scramble -= dt; h.wanted = Math.atan2(dx, dz); }
	else if (h.aside > 0) h.aside -= dt;
	else if (h.think <= 0) {
		h.think = THINK;
		const want = Math.atan2(dx, dz);
		h.wanted = want;
		for (const off of FAN) {
			const a = want + off;
			if (!PROBES.some((d) => d * m < far + m && blocked(h.x + Math.sin(a) * d * m, h.z + Math.cos(a) * d * m, h.y))) { h.wanted = a; break; }
		}
	}
	let off = h.wanted - h.heading;
	off -= Math.PI * 2 * Math.round(off / (Math.PI * 2));
	h.heading += off * Math.min(dt * 5, 1);
	const step = Math.min(pace * m * dt, far), nx = h.x + Math.sin(h.heading) * step, nz = h.z + Math.cos(h.heading) * step;
	if (h.scramble > 0 || !blocked(nx, nz, h.y)) { h.x = nx; h.z = nz; }
	h.y = deer.groundUnder(h);
	h.person.stride = (h.person.stride ?? 0) + step / (STRIDE * m) * Math.PI;
	place(h, 1, h.person.stride);
	return far - step;
}
// along its way: true once it is there
function follow(h, pace, dt) {
	const m = metre();
	while (h.along < h.route.length - 1 && Math.hypot(h.route[h.along][0] - h.x, h.route[h.along][1] - h.z) < 2.5 * m) h.along++;
	const left = walkTo(h, h.route[h.along], pace, dt);
	return h.along >= h.route.length - 1 && left < 1.2 * m;
}
function shotAt(h, target, spread) {
	const m = metre(), p = h.person, muzzle = [h.x + Math.sin(h.heading) * 0.8 * m, h.y + 1.45 * m, h.z + Math.cos(h.heading) * 0.8 * m];
	npcs.fireAt(p, muzzle, target, { round: '7.62x54R', spread, spreadFar: 0.001 });
	hunterStats.shots++;
}
function step(h, dt) {
	const m = metre(), p = h.person;
	// down: lying there, and back at its door
	if (!p.alive) {
		p.fighting = false;
		if (p.respawnIn <= 0 && p.respawnIn > -1) {
			npcs.revive(p);
			Object.assign(h, { x: h.door.x, z: h.door.z, ground: null, state: 'rest', timer: REST[0], deer: null, corpse: null, route: [] });
			h.y = deer.groundUnder(h);
			place(h, 0);
		}
		return;
	}
	// shot at: at whoever fired
	const enemy = npcs.enemiesOf(p.group, h.x, h.y, h.z).find((e) => e.d < FIGHT * m);
	if (enemy) {
		h.heading = Math.atan2(enemy.x - h.x, enemy.z - h.z);
		p.fighting = true;
		p.aim = Math.atan2(enemy.y - h.y - 1.4 * m, Math.hypot(enemy.x - h.x, enemy.z - h.z));
		place(h, 0);
		if ((h.enemyFire -= dt) <= 0) { h.enemyFire = FIRE_EVERY; if (npcs.clearLine([h.x, h.y + 1.5 * m, h.z], [enemy.x, enemy.y, enemy.z])) shotAt(h, enemy, 0.02); }
		return;
	}
	const hidden = settings.gameMode == 'Horde' || !settings.enableDeer;
	switch (h.state) {
		case 'rest': {
			p.fighting = false;
			h.heading += clamp(h.door.heading - h.heading, -dt, dt);
			place(h, 0);
			if ((h.timer -= dt) > 0 || hidden) return;
			const prey = deer.nearestDeer(h.x, h.z, REACH * m);
			if (!prey) { h.timer = 10; return; }
			h.deer = prey.id;
			routeTo(h, [prey.x, prey.z]);
			h.state = 'out';
			return;
		}
		case 'out': {
			const prey = deer.deerById(h.deer);
			if (!prey) { const c = deer.corpseOf(h.deer); if (c) { h.corpse = h.deer; routeTo(h, [c.x, c.z]); h.state = 'toCarcass'; return; } h.state = 'rest'; h.timer = 5; h.deer = null; backHome(h); return; }
			// (it moves about: where it is now is the end of the way)
			h.route[h.route.length - 1] = [prey.x, prey.z];
			const d = Math.hypot(prey.x - h.x, prey.z - h.z);
			if (d < RANGE * m && npcs.clearLine([h.x, h.y + 1.5 * m, h.z], [prey.x, prey.y + m, prey.z])) { h.state = 'stalk'; h.fire = AIM; return; }
			follow(h, WALK, dt);
			return;
		}
		case 'stalk': {
			const prey = deer.deerById(h.deer);
			p.fighting = !!prey;
			if (!prey) { const c = deer.corpseOf(h.deer); h.corpse = c ? h.deer : null; p.fighting = false; if (c) { routeTo(h, [c.x, c.z]); h.state = 'toCarcass'; } else backHome(h); return; }
			const d = Math.hypot(prey.x - h.x, prey.z - h.z);
			h.heading = Math.atan2(prey.x - h.x, prey.z - h.z);
			p.aim = Math.atan2(prey.y + m - h.y - 1.4 * m, d);
			place(h, 0);
			if (d > RANGE * 1.5 * m) { h.state = 'out'; p.fighting = false; routeTo(h, [prey.x, prey.z]); return; }
			if ((h.fire -= dt) <= 0) {
				h.fire = FIRE_EVERY;
				// (it has gone behind something: after it again)
				if (!npcs.clearLine([h.x, h.y + 1.5 * m, h.z], [prey.x, prey.y + m, prey.z])) { h.state = 'out'; p.fighting = false; routeTo(h, [prey.x, prey.z]); return; }
				shotAt(h, { x: prey.x, y: prey.y + 0.98 * m, z: prey.z, v: [0, 0, 0], kind: 'deer' }, SPREAD);
			}
			return;
		}
		case 'toCarcass': {
			const c = deer.corpseOf(h.corpse);
			if (!c) { backHome(h); return; }
			if (follow(h, RUN, dt) || Math.hypot(c.x - h.x, c.z - h.z) < 1.4 * m) { h.state = 'cut'; h.timer = CUT; }
			return;
		}
		case 'cut': {
			const c = deer.corpseOf(h.corpse);
			if (!c) { backHome(h); return; }		// (nothing left on it)
			h.heading = Math.atan2(c.x - h.x, c.z - h.z);
			place(h, 0, 0, [0.7, 0]);		// (bent over it)
			if ((h.timer -= dt) > 0) return;
			h.timer = CUT;
			if (deer.butcher(h.corpse) && !h.carrying) { hunterStats.deer++; h.carrying = true; }
			return;
		}
		case 'back': {
			if (!follow(h, WALK, dt)) return;
			if (h.carrying) { h.carrying = false; hunterStats.paid += PAID; treasury.pay(h.town, PAID, 'A hunter brings a deer to the butcher'); }
			h.state = 'rest';
			h.timer = REST[0] + Math.random() * (REST[1] - REST[0]);
			h.deer = h.corpse = null;
			return;
		}
	}
}
function backHome(h) {
	h.person.fighting = false;
	routeTo(h, [h.door.x, h.door.z]);
	h.state = 'back';
}

// Per frame (after npcs.js's): each on with what it is doing. Not in THE WAR, and only where the NPCs are run
export function huntersUpdate(dt) {
	const land = terrain.land;
	if (!npcs.on() || !npcs.runsHere() || !land || npcs.war.on) {
		if (hunters.length) { clear(); builtFor = null; }
		return;
	}
	if (land !== builtFor || !land.towns) build(land);
	if (!town.houseList().length) return;
	if (dt > 0) for (const h of hunters) step(h, dt);
}
// for testing
export const huntersForTest = () => ({ ...hunterStats, list: hunters.map((h) => ({ state: h.state, x: h.x, z: h.z, deer: h.deer, alive: h.person.alive, town: treasury.townNumber(h.town) })) });
export function hunterStateForTest(k) { return hunters[k]; }
