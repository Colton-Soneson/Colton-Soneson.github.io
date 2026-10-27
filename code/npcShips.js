import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as boat from './boat.js'
import * as shipGuns from './shipGuns.js'
import * as hunting from './hunting.js'
import * as npcs from './npcs.js'
import * as ballistics from './ballistics.js'
import { VESSELS } from './vessels.js'

/*
	THE SCHOONER'S CREW (npcs.js's people): one schooner (boat.js, vessels.js), out from the town that has the dock (townLayout.js:
	DOCK), sailed by its crew: a man at the wheel (the helmsman: the captain, in his cap) and a man on every gun (shipGuns.js's
	howitzers, worked by npcGun: no breech, no carrying rounds, a gun is loaded again RELOAD seconds after it fires).

	SAILING (shared with the dinghies, npcDinghies.js): a course is steered for (steerFor: the rudder put over by how far off it the bow
	is, its swing damped), and every sail trimmed to the wind it feels (trim: sheeted hard in close-hauled, eased out further the further
	aft the wind comes, all the way out running before it). It cannot sail into the wind: a course closer to the wind than NO_GO is
	sailed as the nearer of the two tacks CLOSE off it, kept a while (TACK_HOLD) so it does not go back and forth. IN THE WAY (chooseCourse):
	a fan of courses either side of the one wanted, each looked along (PROBES) for water too shallow for the keel, other boats and
	the edge of the world; the nearest clear one is taken.
	AGROUND for a while: warped off towards the deepest water near her (WARP).
	ON PATROL: round a few places off the town (PATROL: out from the dock, and along the shore either way), in deep water.
	ATTACKED (npcs.js: a hit on her or on her crew): at whoever fired, if they are on the land or the water (not in the air: her guns
		cannot reach a plane). Far off, she sails at them; within BROADSIDE she sails across them, her side to them, and every gun that
		bears is laid on them (the shell's fall worked out for the range, and led for how they go) and fired as it is loaded (off by
		SPREAD). Too close, she opens the range.
	THE HELMSMAN SHOT: with no one at the wheel her sheets are let go and she lies there, until a gunner leaves his gun for the wheel
		(REPLACE seconds) and she goes on.
	THE LOOKOUTS: a man in each crow's nest, at its Lewis gun (shipGuns.js: npcNest). Whoever she is hostile to in the air (a plane, within
		AIR.range) he shoots at in bursts (AIR.burst rounds, AIR.rest between), led for how it goes; a fresh pan as one runs out. With no
		one else left aboard, a lookout comes down to the wheel.
	THE WAR (war.js): each side has schooners of its own (addWarShip), out of its town's dock, her flag its colour (boat.js: b.team). She
		makes for the other side's town by sea (seaRoute: the shortest way through water deep enough for her, a cell off the shoals, A*
		over a grid of it, to SEA_ROUTE.off off the end of its dock; she steers for the point of it SEA_ROUTE.ahead on, and aground is
		warped off towards it), straight along it under her auxiliary engine (ENGINE: driven on at its speed, her sails
		set when the wind lets them help, furled heading up into it), and lies off it, her broadside to a house of it still standing (npcs.war.houseFor), and
		shells it; her lookouts shoot at the other side's planes. Lost, the next of hers sails WAR_SHIP seconds after, all of her crew with
		her. While it is on, the dock town's own schooner is laid up.
		THE PORT GUARD: the first of a side's (addWarShip: guard) does not go: she lies off her own town's dock (GUARD.off out past its end,
		swung round it out of the way her side's others sail out by; within GUARD.hold of it), and the other side's on the water within GUARD.reach of there she fights as ATTACKED does (broadside).
		THE FLANK: each of the others, as she sails, has a chance (FLANK.chance) of going the long way: the way found again with the water
		within FLANK.lane of the straight way FLANK.dear times as dear (but near either end), so she goes round by another channel, or as
		far off the straight way as the water lets her, and in on the town from one side (her station off it swung FLANK.turn round the
		end of its dock). A way no longer than the straight one (FLANK.longer) is no flank: then the straight way.
	THE CREW: shot dead, a man lies where he fell on her deck. Back RESPAWN_SECONDS later (npcs.js) at the end of the dock, where he
		waits. Once all of them are dead, or she is shot to pieces (whoever is aboard is lost with her), a new schooner is put in beside
		the end of the dock (moored, her bow out to sea with the wind on her beam if it can be), each of them aboard as he comes back, and
		she sails when all of them are. A schooner whose crew
		are all dead is left where she is (anyone can sail her), until the next one is.
	Metres and seconds (the people's places are world units)
*/
const NO_GO = 0.8;						// radians either side of the wind: no course is sailed closer than this
const CLOSE = 0.9;						// and close-hauled is this far off it
const TACK_HOLD = 40;					// seconds a tack is kept, at least
const PROBES = [20, 45, 80];			// metres along a course it looks
const FAN = [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.2, -1.2, 1.7, -1.7, 2.4, -2.4];
const KEEL_CLEAR = 3;					// metres of water under the keel it wants
const PATROL = { out: 380, along: 520, deep: 14, near: 70, most: 240 };	// metres: off the dock, either way along the shore, the depth it wants, near enough, seconds for one
const BROADSIDE = [170, 480], CHASE = 1100;	// metres: the range it fights at, and as far as it goes after them
const RELOAD = [9, 14];					// seconds
const SPREAD = 0.012;					// radians
const REPLACE = 4;						// seconds for a gunner to get to the wheel
const SHELL = { speed: 135 };			// metres a second (ballistics.js's 80mm)
const WARP = 0.6;						// metres a second: warped off when aground
const AIR = { range: 450, burst: [6, 12], rest: 0.8, spread: 0.012, aloft: 12 };	// metres, rounds, seconds, radians; aloft: metres over the land or the sea
const NEW_SHIP = 8;
const WAR_SHIP = 5;						// seconds after one of a side's is lost in THE WAR before the next sails
const SHELL_REACH = 1500;				// metres her guns are laid out to
const SEA_ROUTE = { cell: 40, off: 140, near: 60, ahead: 3 };
const GUARD = { off: 320, hold: 120, reach: 1400, swing: [0, 1.1, -1.1] };	// THE PORT GUARD: metres out past her own dock's end (swung round it any of those radians), near enough there, and how far from there she goes after them
const FLANK = { chance: 0.4, lane: 240, dear: 6, free: 450, turn: 0.9, longer: 1.08 };	// THE FLANK: a chance of it; metres either side of the straight way that are dear, how many times, metres from either end that are not;
								//		radians her station is swung round; how much longer than the straight way it must be
const ENGINE = { speed: 7, push: 0.6 };	// THE WAR: her auxiliary engine, metres a second it drives her at, and a second to it	// THE WAR's way by sea: metres a cell of its grid, how far off the end of the other town's dock she lies, near enough a point on it						// seconds after the last of them is gone (or she is) before the next is put in at the dock

const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const { wrap } = npcs;
const depthAt = (x, z) => (settings.waterWorldPosY - terrain.land.heightAt(x * metre(), z * metre())) / metre();	// (metres, at a place in metres)
const halfWorld = () => settings.terrainWorldSize * 0.5 / metre();
// a target in the air: in a vehicle (a plane), AIR.aloft metres or more over the land or the sea
const aloft = (e) => !!e.vehicle && e.y - Math.max(terrain.land.heightAt(e.x, e.z), settings.waterWorldPosY) > AIR.aloft * metre();

export const shipStats = { ships: 0, shells: 0, newShips: 0, tacks: 0, replaced: 0, lost: 0, flanks: 0 };

// SAILING (see the top): shared with the dinghies
//-------------------------------------------------
// the bearing of a direction (x, z) as a course (radians, from +z towards +x: as the boat's own heading, courseOf(b))
export const bearing = (dx, dz) => Math.atan2(dx, dz);
export function courseOf(b) { const f = b.frame.directionToWorld([0, 0, 1]); return Math.atan2(f[0], f[2]); }
// where the wind comes from, as a course
export function windFrom() { const d = settings.windDirection; return Math.atan2(-d[0], -d[1]); }
// how clear a course is from b: the least depth along it out to the probes (metres; minus for a boat or the edge of the world in the way)
export function waterAlong(b, course, probes = PROBES) {
	const at = b.frame.toWorld([0, 0, 0]).map((v) => v / metre());
	let least = Infinity;
	for (const d of probes) {
		const x = at[0] + Math.sin(course) * d, z = at[2] + Math.cos(course) * d;
		least = Math.min(least, depthAt(x, z));
		if (Math.abs(x) > halfWorld() - 60 || Math.abs(z) > halfWorld() - 60) least = -1;
		for (const o of boat.boats) if (o !== b && o.destroyed < 0 && Math.hypot(o.p[0] - x, o.p[2] - z) < o.vessel.reach + b.vessel.reach * 0.6) least = -1;
	}
	return least;
}
// THE COURSE (see SAILING at the top) for a course wanted: the nearest to it that can be sailed (out of the wind: in the no-go zone, the
//		tack it is on, kept TACK_HOLD at least, then the other, bearing away from close-hauled if need be) and is clear (keel: how deep it
//		goes; need, the water it wants under it). None clear: the one with the most water. s keeps the tack
export function chooseCourse(s, b, wanted, keel, now, probes = PROBES, need = keel + KEEL_CLEAR) {
	const from = windFrom(), off = wrap(wanted - from);
	let order;
	if (Math.abs(off) < NO_GO) {
		const best = off >= 0 ? 1 : -1;
		if (!s.tack || (best != s.tack && now - (s.tackAt ?? -1e9) > TACK_HOLD)) { if (s.tack) shipStats.tacks++; s.tack = best; s.tackAt = now; }
		order = [s.tack, -s.tack].flatMap((t) => [0, 0.2, 0.45, 0.8, 1.2].map((more) => ({ c: from + t * (CLOSE + more), t })));
	} else {
		order = FAN.map((more) => {
			const c = wanted + more, o = wrap(c - from);
			return Math.abs(o) >= NO_GO ? { c } : { c: from + (o >= 0 ? 1 : -1) * CLOSE, t: o >= 0 ? 1 : -1 };
		});
	}
	let deepest = null;
	for (const choice of order) {
		const water = waterAlong(b, choice.c, probes);
		if (water >= need) {
			if (choice.t && choice.t != s.tack) { s.tack = choice.t; s.tackAt = now; shipStats.tacks++; }
			return choice.c;
		}
		if (!deepest || water > deepest.water) deepest = { ...choice, water };
	}
	return deepest.c;
}
// the wheel (or the tiller) put over to bring the bow round to course: by how far off it is, against how fast she is turning already
export function steerFor(b, course, dt, gain = 1.3) {
	const R = b.vessel.rudder;
	const off = wrap(course - courseOf(b));			// (+: to port, as the rudder's +)
	const turning = b.frame.directionToLocal(b.w)[1];
	const want = clamp(gain * off - 2.5 * turning, -R.most, R.most);
	if (Math.abs(want - b.rudder) > 0.01) boat.steer(b, Math.sign(want - b.rudder), Math.min(dt, Math.abs(want - b.rudder) / R.most * R.seconds));
	return off;
}
// every sail trimmed to the wind it feels: hoisted (but sails named in furl), its sheet hauled in by how far forward the wind is, and eased
//		the further she heels past heel (radians: in a blow she is depowered, or she lies over and slides off sideways)
export function trim(b, { furl = [], luff = false, heel = 0.45 } = {}) {
	const apparent = Math.abs(b.stats.apparentAngle ?? Math.PI);
	const over = Math.abs(b.stats.heel ?? 0) - heel;
	const sheet = luff ? 0 : clamp(1 - (apparent - 0.6) / (Math.PI - 0.6), 0, 1) * clamp(1 - over / 0.35, 0.3, 1);
	b.vessel.sails.forEach((sail, i) => {
		const s = b.sails[i];
		s.hoistWant = furl.includes(sail.name) ? 0 : 1;
		s.sheetWant = sheet;
	});
}

// AGROUND for a while (going nowhere): warped off, a little at a time, towards the deepest water near her (her boats out with a line, as
//		sailors did). probes: how far round her it looks (metres)
export function warpOff(s, b, dt, probes = [15, 30]) {
	s.aground = b.stats.aground && Math.abs(b.stats.speed) < 0.3 ? (s.aground ?? 0) + dt : 0;
	if (s.aground < 6) return;
	let best = null;
	for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) { const w = waterAlong(b, a, probes); if (!best || w > best.w) best = { a, w }; }
	b.p[0] += Math.sin(best.a) * WARP * dt; b.p[2] += Math.cos(best.a) * WARP * dt;
}

// THE SCHOONERS
//-------------------------------------------------
// each: { boat, town, dock ({ end, out (seaward, along the dock), side }), people ([helmsman, gunners..., lookouts]), roles (person -> { role
//		'helm', 'gun' (gun) or 'nest' (nest) }), where (person -> 'aboard', 'dock', 'dead'), fell (person -> where it lies on her deck), patrol,
//		wp, wpAt, reload, lostAt, waiting, war (THE WAR: { side }, or null for the dock town's own, on patrol) }
const ships = [];
let builtFor = null;
const derelicts = [];
const regular = () => ships.find((s) => !s.war) ?? null;

// a schooner and her crew, at a town's dock (war: { side } for one of a side's in THE WAR)
function makeShip(town, war = null) {
	const m = metre();
	const D = dockOf(town), { end, out, side } = D;
	// (they wait along the last of the dock, two by two)
	const spot = (k) => ({ x: (end[0] - out[0] * (2 + Math.floor(k / 2) * 1.6) + side[0] * (k % 2 ? 0.8 : -0.8)) * m, z: (end[1] - out[1] * (2 + Math.floor(k / 2) * 1.6) + side[1] * (k % 2 ? 0.8 : -0.8)) * m, heading: Math.atan2(out[0], out[1]) });
	const group = npcs.makeGroup();
	group.side = war?.side ?? null;
	const V = VESSELS.Schooner;
	const make = (kind, hat, k, name) => npcs.makePerson(kind, { hat, gun: 'none', group, home: spot(k), name });
	const people = [make('captain', 'captain', 0, 'schooner\'s helmsman')];
	V.guns.forEach((G, k) => people.push(make('gunner', 'sailor', k + 1, 'schooner\'s gunner')));
	V.nests.forEach((N, k) => { const p = make('lookout', 'sailor', V.guns.length + 1 + k, 'schooner\'s lookout'); p.nest = k; people.push(p); });
	const s = { boat: null, town, dock: D, people, roles: new Map(), where: new Map(people.map((p) => [p, 'dock'])), fell: new Map(), group, patrol: [], wp: 0, wpAt: 0,
		reload: V.guns.map(() => 0), lostAt: -1, replacing: -1, waiting: false, war };
	ships.push(s);
	launch(s, true);
	return s;
}
function clearShip(s) {
	for (const p of s.people) npcs.removePerson(p);
	if (s.boat?.exists) { boat.removeBoat(s.boat); npcs.announce('boat', null, s.boat); }
	ships.splice(ships.indexOf(s), 1);
}

// a town's dock: where its end is (metres, x and z), the way out along it and across it, and its deck's height (world units)
export function dockOf(town) {
	const m = metre(), { a, b } = town.dock;
	const len = Math.hypot(b[0] - a[0], b[2] - a[2]), out = [(b[0] - a[0]) / len, (b[2] - a[2]) / len];
	return { end: [b[0] / m, b[2] / m], out, side: [-out[1], out[0]], deck: b[1] };
}
// a place for a schooner beside the end of a dock (D: dockOf's), clear of the other boats, her bow the way out to sea that has the wind on
//		her beam (so she sails as soon as she casts off), or straight out along the dock: { x, z (world units), course } or null (horde.js too)
export function berthBeside(D) {
	const m = metre(), V = VESSELS.Schooner;
	const out = Math.atan2(D.out[0], D.out[1]), from = windFrom();
	const ways = [...[from + Math.PI / 2, from - Math.PI / 2].filter((w) => Math.cos(w - out) > 0.1).sort((a, c) => Math.cos(c - out) - Math.cos(a - out)), out];
	// (clear of the boats already there: footprintClear only knows the water)
	const roomy = (x, z) => boat.boats.every((o) => o.destroyed >= 0 || Math.hypot(o.p[0] - x / m, o.p[2] - z / m) > o.vessel.reach + V.reach + 4);
	for (const way of ways) {
		const yaw = Math.atan2(Math.sin(way), -Math.cos(way));		// (as settings.camYaw)
		for (let along = 0; along <= 300; along += 6) {
			for (const s of [1, -1]) {
				const x = (D.end[0] + D.out[0] * (along - 6) + D.side[0] * s * 9) * m, z = (D.end[1] + D.out[1] * (along - 6) + D.side[1] * s * 9) * m;
				if (!boat.footprintClear(V, x, z, yaw) && roomy(x, z) && depthAt(x / m + Math.sin(way) * 60, z / m + Math.cos(way) * 60) > V.spawn.keel + KEEL_CLEAR) return { x, z, course: way };
			}
		}
	}
	return null;
}
// a new schooner beside the end of the dock, her bow out to sea, at anchor; aboard: everyone back on the dock (all of them, at first)
function launch(s, everyone = false) {
	const V = VESSELS.Schooner, berth = berthBeside(s.dock);
	if (!berth) return;
	const b = boat.spawnBoat(berth.x, berth.z, 'Schooner', { yaw: Math.atan2(Math.sin(berth.course), -Math.cos(berth.course)), owner: 'npc', authority: 0 });		// (authority: this machine, alone or the host)
	b.vessel.sails.forEach((sail, i) => { b.sails[i].hoistWant = 0; b.sails[i].hoist = 0; });
	b.team = s.war?.side ?? null;
	npcs.announce('boat', b, null);
	s.moored = null;
	s.boat = b;
	s.route = null;
	if (s.war) s.war.flank = !s.war.guard && Math.random() < FLANK.chance ? (Math.random() < 0.5 ? -1 : 1) : 0;
	s.lostAt = -1;
	s.waiting = true;
	s.fell.clear();
	s.patrol = patrolOf(s);
	s.wp = 0; s.wpAt = npcs.now();
	s.reload = V.guns.map(() => 0);
	for (const p of s.people) if (everyone || s.where.get(p) == 'dock') board(s, p);
	shipStats.newShips++;
}
function board(s, person) {
	s.where.set(person, 'aboard');
	assignRoles(s);
}
// the wheel first, then the guns, in order: whoever is aboard and alive. The lookouts in their nests (one at the wheel if he is all there is)
function assignRoles(s) {
	const aboard = s.people.filter((p) => p.alive && s.where.get(p) == 'aboard');
	const helm = s.roles.size ? [...s.roles.entries()].find(([p, r]) => r.role == 'helm' && aboard.includes(p))?.[0] : null;
	s.roles.clear();
	const crew = aboard.filter((p) => p.kind != 'lookout' || p === helm), lookouts = aboard.filter((p) => !crew.includes(p));
	if (!crew.length && lookouts.length) crew.push(lookouts.shift());
	for (const p of lookouts) s.roles.set(p, { role: 'nest', nest: p.nest });
	const order = helm ? [helm, ...crew.filter((p) => p !== helm)] : crew;
	const guns = VESSELS.Schooner.guns.map((_, k) => k);
	order.forEach((p, k) => {
		if (k == 0) s.roles.set(p, { role: 'helm' });
		else {
			// (a gunner keeps his own gun if it is free: the people after the first are the gunners, in their order)
			const own = s.people.indexOf(p) - 1;
			const gun = own >= 0 && guns.includes(own) ? own : guns[0];
			guns.splice(guns.indexOf(gun), 1);
			s.roles.set(p, { role: 'gun', gun });
		}
	});
}
// the places it patrols round: off the dock, and along the shore either way, each pushed out to deep water
function patrolOf(s) {
	const D = s.dock, inside = halfWorld() - 200;
	const make = (along, out) => {
		for (let more = 0; more < 900; more += 40) {
			const x = clamp(D.end[0] + D.side[0] * along + D.out[0] * (out + more), -inside, inside), z = clamp(D.end[1] + D.side[1] * along + D.out[1] * (out + more), -inside, inside);
			if (depthAt(x, z) > PATROL.deep) return [x, z];
		}
		return null;
	};
	return [make(PATROL.along, PATROL.out), make(0, PATROL.out * 1.6), make(-PATROL.along, PATROL.out), make(0, PATROL.out * 0.8)].filter(Boolean);
}

// The crew on her (see THE CREW at the top): each where its role has it, tipped with her
function placeCrew(s) {
	const b = s.boat, V = b.vessel;
	for (const p of s.people) {
		const where = s.where.get(p);
		if (where == 'aboard' && p.alive) {
			const r = s.roles.get(p);
			let local, facing;
			if (r?.role == 'helm') { local = V.helm.standAt; facing = [0, 0, 1]; }
			else if (r?.role == 'nest') {
				local = V.nests[r.nest].stand;
				const look = s.nestLooks?.[r.nest] ?? [0, 0, 1];
				facing = npcs.norm([look[0], 0, look[2] + 1e-3]);
			} else {
				const G = V.guns[r?.gun ?? 0];
				local = G.seat;
				const look = s.looks?.[r?.gun ?? 0] ?? [G.side, 0, 0];
				facing = npcs.norm([look[0], 0, look[2]]);
			}
			const at = b.frame.toWorld(local);
			const { heading, tilt } = npcs.tipped(b.frame.directionToWorld(facing), b.frame.up());
			p.place = { x: at[0], y: at[1], z: at[2], heading, tilt, sit: 0 };
			p.anchor = { vehicle: b.id, local, facing };
			p.armsDown = 0;
			p.local = local;
			boat.setCrew(b, p.id, [local[0], local[1] + 0.9, local[2]]);
		} else if (where == 'aboard' && !p.alive && p.local) {
			// (lying on her deck where he fell, carried along with her)
			const at = b.frame.toWorld(p.local);
			p.place = { ...p.place, x: at[0], y: at[1], z: at[2], tilt: null };
			boat.setCrew(b, p.id, null);
		} else if (where == 'dock' && p.alive) {
			p.place = { x: p.home.x, y: s.dock.deck, z: p.home.z, heading: p.home.heading, sit: 0 };
			p.anchor = null;
			p.armsDown = 1;
		}
	}
}

// her guns (see ATTACKED at the top): each laid on the enemy and fired as it bears and is loaded
function fight(s, enemy, dt) {
	const b = s.boat, V = b.vessel, m = metre();
	s.looks ??= [];
	V.guns.forEach((G, k) => {
		const gunner = [...s.roles.entries()].find(([p, r]) => r.role == 'gun' && r.gun == k)?.[0];
		s.reload[k] = Math.max(s.reload[k] - dt, 0);
		if (s.reload[k] <= 0) shipGuns.npcLoad(b, k);
		if (!gunner || !enemy) { shipGuns.npcGun(b, k, { yaw: Math.atan2(G.side, 0.2), pitch: 0.12, dt }); s.looks[k] = [G.side, 0, 0.2]; if (gunner) gunner.fighting = false; return; }
		// the shell's fall for the range: the low one of the two ways up that reach it, led for how the enemy goes
		const pivot = b.frame.toWorld(G.pivot).map((v) => v / m);
		let target = [enemy.x / m, enemy.y / m - 0.5, enemy.z / m], dir = null;
		for (let k2 = 0; k2 < 3; k2++) {
			const dx = target[0] - pivot[0], dz = target[2] - pivot[2], d = Math.hypot(dx, dz), h = target[1] - pivot[1], v = SHELL.speed, g = 9.81;
			const disc = v ** 4 - g * (g * d * d + 2 * h * v * v);
			if (disc < 0) { dir = null; break; }
			const up = Math.atan((v * v - Math.sqrt(disc)) / (g * d));
			const t = d / (v * Math.cos(up));
			dir = [Math.cos(up) * dx / d, Math.sin(up), Math.cos(up) * dz / d];
			target = [enemy.x / m + enemy.v[0] / m * t, enemy.y / m - 0.5 + enemy.v[1] / m * t, enemy.z / m + enemy.v[2] / m * t];
		}
		if (!dir) { gunner.fighting = false; return; }
		const local = b.frame.directionToLocal(dir);
		const jitter = () => (Math.random() - 0.5) * 2 * SPREAD * ballistics.aimSpread();
		const ready = s.reload[k] <= 0;
		const yaw = Math.atan2(local[0], local[2]) + (ready ? jitter() : 0), pitch = Math.asin(clamp(local[1], -1, 1)) + (ready ? jitter() : 0);
		const bears = shipGuns.npcGun(b, k, { yaw, pitch, dt, fire: ready, shooter: gunner.id });
		s.looks[k] = local;
		gunner.fighting = bears;
		gunner.aim = Math.asin(clamp(local[1], -1, 1));
		if (bears && ready) { s.reload[k] = RELOAD[0] + Math.random() * (RELOAD[1] - RELOAD[0]); shipStats.shells++; }
	});
}

// the nests' guns (see THE LOOKOUTS at the top): each at the nearest she is hostile to in the air, in bursts
function fightAir(s, dt) {
	const b = s.boat, V = b.vessel, m = metre(), R = ballistics.ROUNDS['.303 British'];
	s.nestLooks ??= [];
	s.bursts ??= V.nests.map(() => ({ left: 0, rest: 0 }));
	V.nests.forEach((N, k) => {
		const man = [...s.roles.entries()].find(([p, r]) => r.role == 'nest' && r.nest == k)?.[0];
		const B = s.bursts[k];
		B.rest = Math.max(B.rest - dt, 0);
		const pivot = b.frame.toWorld(N.pivot);
		const enemy = man && npcs.enemiesOf(s.group, ...pivot).find((e) => e.d < AIR.range * m && aloft(e) && npcs.clearLine(pivot, [e.x, e.y, e.z]));
		if (!enemy) { shipGuns.npcNest(b, k, { look: null, dt }); if (man) man.fighting = false; B.left = 0; return; }
		const dir = npcs.leadDirection(pivot, enemy, R), look = b.frame.directionToLocal(dir);
		if (B.left <= 0 && B.rest <= 0) B.left = AIR.burst[0] + Math.floor(Math.random() * (AIR.burst[1] - AIR.burst[0] + 1));
		const muzzle = shipGuns.npcNest(b, k, { look, dt, fire: B.left > 0 });
		if (muzzle) {
			npcs.fireAt(man, muzzle, enemy, { round: '.303 British', spread: AIR.spread, spreadFar: 0.003, aimAt: dir });
			if (--B.left <= 0) B.rest = AIR.rest;
		}
		s.nestLooks[k] = look;
		man.fighting = true;
		man.aim = Math.asin(clamp(look[1], -1, 1));
	});
}

// what she is after: in THE WAR the nearest of the other side's houses that still stands (npcs.war.houseFor: where to aim, its middle),
//		otherwise whoever she is hostile to on the land or the water, within CHASE
function quarry(s, at) {
	const m = metre();
	if (s.war) {
		const h = npcs.war.houseFor?.(s.war.side, at);
		return h && { x: h.x, y: h.y, z: h.z, v: [0, 0, 0], d: Math.hypot(h.x - at[0], h.z - at[2]) };
	}
	return npcs.enemiesOf(s.group, at[0], at[1], at[2]).find((e) => e.d < CHASE * m && !aloft(e)) ?? null;
}

function stepShip(s, dt) {
	const now = npcs.now(), m = metre();
	// the dead back on the dock in time; aboard at once if she is still there at anchor
	for (const p of s.people) {
		if (!p.alive && s.where.get(p) != 'dead' && p.respawnIn > 0) {
			if (s.where.get(p) == 'aboard' && s.boat) boat.setCrew(s.boat, p.id, null);
			if (s.where.get(p) != 'aboard') s.where.set(p, 'dead');
		}
		if (!p.alive && p.respawnIn <= 0 && p.respawnIn > -1) { npcs.revive(p); p.local = null; s.where.set(p, s.boat && s.waiting ? 'aboard' : 'dock'); assignRoles(s); }
	}
	const b = s.boat;
	// her gone (shot to pieces), or everyone on her dead: a new one at the dock in a while
	const crewAboard = s.people.filter((p) => p.alive && s.where.get(p) == 'aboard');
	if (b && b.destroyed < 0 && crewAboard.length == 0 && !s.waiting) {
		// (left where she is: anyone can sail her)
		for (const p of s.people) if (s.where.get(p) == 'aboard') s.where.set(p, 'dead');
		derelicts.push(b);
		while (derelicts.length > 1) { const old = derelicts.shift(); if (old.exists && old.crew.size == 0) { boat.removeBoat(old); npcs.announce('boat', null, old); } }
		s.boat = null; s.lostAt = now;
	}
	if (!s.boat) {
		placeDock(s);
		// (in the war a new one WAR_SHIP seconds after, her whole crew with her)
		if (s.lostAt >= 0 && now - s.lostAt > (s.war ? WAR_SHIP : NEW_SHIP)) {
			if (s.war) for (const p of s.people) { if (!p.alive) npcs.revive(p); p.local = null; s.where.set(p, 'dock'); }
			launch(s, !!s.war);
		}
		return;
	}
	placeCrew(s);
	fightAir(s, dt);
	// (a player who has taken her wheel sails her: the crew leave it to them)
	const me = hunting.hunterPlace();
	if (me.boat === b.id && me.on == 'seat') { fight(s, null, dt); return; }
	// waiting at the dock until everyone is aboard
	if (s.waiting) {
		s.moored ??= { x: b.p[0], z: b.p[2], q: [...b.q] };
		b.p[0] = s.moored.x; b.p[2] = s.moored.z; b.v[0] = b.v[2] = 0;
		b.q = [...s.moored.q]; b.w = [0, 0, 0];
		trim(b, { luff: true, furl: b.vessel.sails.map((sail) => sail.name) });
		if (s.people.every((p) => p.alive && s.where.get(p) == 'aboard')) { s.waiting = false; s.leftAt = now; s.tack = 0; }
		fight(s, null, dt);
		return;
	}
	// the helmsman: someone at the wheel, or a gunner on his way to it
	const helm = [...s.roles.entries()].find(([p, r]) => r.role == 'helm' && p.alive)?.[0];
	if (!helm) {
		trim(b, { luff: true, furl: ['Topsail'] });
		steerFor(b, courseOf(b), dt);
		if (s.replacing < 0 && crewAboard.length) s.replacing = REPLACE;
		if (s.replacing >= 0 && (s.replacing -= dt) <= 0) { s.replacing = -1; s.roles.clear(); assignRoles(s); shipStats.replaced++; }
		fight(s, null, dt);
		return;
	}
	// where to: at what she is after (on the land or the water), or round the patrol. In the war, by sea to the other town first
	const at = b.frame.toWorld([0, 0, 0]);
	if (s.war?.guard) { guardPort(s, b, at, dt, now); return; }
	const enemy = quarry(s, at);
	let wanted;
	if (s.war && !s.route) {
		// (on from the point of it nearest her: the first of it may be behind her, off the dock)
		const points = warRoute(s, [at[0] / m, at[2] / m]);
		let nearest = 0;
		points.forEach((p, k) => { if (Math.hypot(p[0] - at[0] / m, p[1] - at[2] / m) < Math.hypot(points[nearest][0] - at[0] / m, points[nearest][1] - at[2] / m)) nearest = k; });
		s.route = { points, at: Math.min(nearest + 1, Math.max(points.length - 1, 0)) };
	}
	// (on along it: past the point she is nearest of the next few, and past one she is close to)
	if (s.war) {
		const P = s.route.points, d = (k) => Math.hypot(P[k][0] - at[0] / m, P[k][1] - at[2] / m);
		for (let k = s.route.at + 1; k < Math.min(s.route.at + 8, P.length); k++) if (d(k) < d(s.route.at)) s.route.at = k;
		if (s.route.at < P.length && d(s.route.at) < SEA_ROUTE.near) s.route.at++;
	}
	if (s.war && s.route.at < s.route.points.length) {
		// (along the way there under her engine: straight at the next point of it)
		const next = s.route.points[Math.min(s.route.at + SEA_ROUTE.ahead, s.route.points.length - 1)];
		const course = bearing(next[0] - at[0] / m, next[1] - at[2] / m);
		steerFor(b, course, dt);
		// (aground: warped off towards the way on, not just to the deepest water)
		if (b.stats.aground && Math.abs(b.stats.speed) < 1) { b.p[0] += Math.sin(course) * 2 * dt; b.p[2] += Math.cos(course) * 2 * dt; }
		const upWind = Math.abs(wrap(course - windFrom())) < NO_GO + 0.2;
		trim(b, { furl: upWind ? b.vessel.sails.map((sail) => sail.name) : [] });
		engine(b, dt);
		fight(s, enemy && enemy.d < SHELL_REACH * m ? enemy : null, dt);
		return;
	} else if (enemy) {
		wanted = broadsideCourse(b, enemy, at);
	} else {
		const wp = s.patrol[s.wp];
		if (!wp) return;
		const toWp = Math.hypot(wp[0] - at[0] / m, wp[1] - at[2] / m);
		if (toWp < PATROL.near || now - s.wpAt > PATROL.most) { s.wp = (s.wp + 1) % s.patrol.length; s.wpAt = now; }
		wanted = bearing(wp[0] - at[0] / m, wp[1] - at[2] / m);
	}
	// (just cast off: straight on out a while first)
	if (now - (s.leftAt ?? -1e9) < (s.war ? 10 : 25)) wanted = courseOf(b);
	const course = chooseCourse(s, b, wanted, b.vessel.spawn.keel, now);
	steerFor(b, course, dt);
	warpOff(s, b, dt);
	trim(b, { furl: Math.abs(b.stats.apparentAngle ?? 0) > 1.3 ? [] : ['Topsail'] });
	fight(s, enemy && enemy.d < SHELL_REACH * m ? enemy : null, dt);
}
// the course for a fight with enemy (see ATTACKED at the top): at them from far off, across them in BROADSIDE, away from them too close
function broadsideCourse(b, enemy, at) {
	const toE = bearing(enemy.x - at[0], enemy.z - at[2]), range = enemy.d / metre();
	if (range > BROADSIDE[1]) return toE;
	if (range < BROADSIDE[0]) return toE + Math.PI + (wrap(courseOf(b) - toE - Math.PI) > 0 ? 0.6 : -0.6);
	// across them: whichever way round is nearer the way she is going
	const a1 = toE + Math.PI / 2, a2 = toE - Math.PI / 2;
	return Math.abs(wrap(a1 - courseOf(b))) < Math.abs(wrap(a2 - courseOf(b))) ? a1 : a2;
}
// the people on the dock (and the dead there): where they wait
function placeDock(s) {
	for (const p of s.people) if (s.where.get(p) == 'dock' && p.alive) { p.place = { x: p.home.x, y: s.dock.deck, z: p.home.z, heading: p.home.heading, sit: 0 }; p.anchor = null; }
}

// shot to pieces: whoever is aboard lost with her
boat.onBreak((at, b) => {
	const s = ships.find((one) => one.boat === b);
	if (!s) return;
	for (const p of s.people) {
		if (s.where.get(p) != 'aboard') continue;
		if (p.alive) npcs.harm(p, 1000, s.group.lastShotBy, 'sunk');
		p.gone = true; p.place = p.anchor = null;
		s.where.set(p, 'dead');
	}
	s.boat = null;
	s.lostAt = npcs.now();
	shipStats.lost++;
});
// her crew's group (npcs.js: a shot at her is a shot at them)
npcs.addVehicleGroups((id) => ships.find((s) => s.boat?.id === id)?.group ?? null);

// Per frame (after npcs.js's)
//-------------------------------------------------
export function shipsUpdate(dt) {
	const land = terrain.land;
	if (!npcs.on() || !npcs.runsHere() || !settings.enableWater) {
		if (ships.length && (!settings.enableNPCs || !npcs.runsHere())) { for (const s of [...ships]) clearShip(s); builtFor = null; }
		return;
	}
	// (in THE WAR the dock town's own is laid up until it is over: only the sides' sail)
	if (npcs.war.on) { const own = regular(); if (own) clearShip(own); builtFor = null; }
	else if (land !== builtFor) {
		builtFor = land;
		const own = regular();
		if (own) clearShip(own);
		const town = land.towns?.find((t) => t.dock);
		if (town) makeShip(town);
	}
	for (const s of [...ships]) stepShip(s, dt);
	shipStats.ships = ships.filter((s) => s.boat).length;
}
// a person on her who is shot: where it lies (its place on her, kept: placeCrew)
npcs.onDown((person) => {
	const s = ships.find((one) => one.people.includes(person));
	if (!s || s.where.get(person) != 'aboard' || !s.boat) return;
	s.roles.delete(person);
});

// THE WAR (see the top)
//-------------------------------------------------
// her auxiliary engine (see THE WAR at the top): driven on ahead, up to ENGINE.speed
function engine(b, dt) {
	const ahead = b.frame.directionToWorld([0, 0, 1]), going = b.v[0] * ahead[0] + b.v[2] * ahead[2];
	if (going >= ENGINE.speed) return;
	const more = Math.min(ENGINE.speed - going, ENGINE.speed * ENGINE.push * dt);
	b.v[0] += ahead[0] * more; b.v[2] += ahead[2] * more;
}
// where she lies off the other side's town: SEA_ROUTE.off out past the end of its dock (metres), or as near as there is deep water
const otherTown = (s) => (terrain.land.towns ?? []).find((t) => t.dock && t !== s.town);
function warStation(s) {
	return stationOff(otherTown(s));
}
// (swung: the way out from the dock's end turned that many radians round it; off: metres out past it)
function stationOff(other, swung = 0, off = SEA_ROUTE.off) {
	if (!other?.dock) return null;
	const D = dockOf(other), c = Math.cos(swung), s = Math.sin(swung);
	const out = [D.out[0] * c - D.out[1] * s, D.out[0] * s + D.out[1] * c];
	for (let more = 0; more < 900; more += 40) {
		const x = D.end[0] + out[0] * (off + more), z = D.end[1] + out[1] * (off + more);
		if (depthAt(x, z) > VESSELS.Schooner.spawn.keel + KEEL_CLEAR + 2) return [x, z];
	}
	return null;
}
// the way by sea from a place to another (metres, x and z): A* over a grid of SEA_ROUTE.cell, through water deep enough for her keel,
//		inside the world; its points, a cell apart, the last of them the place itself. None (no way by sea, or nowhere to go): null.
//		dear(x, z): how many times as dear a cell is there (metres), or every one the same
function seaRoute(from, to, dear = null) {
	if (!to) return null;
	const C = SEA_ROUTE.cell, half = halfWorld() - 150, n = Math.floor(half * 2 / C);
	const cellOf = ([x, z]) => [clamp(Math.floor((x + half) / C), 0, n - 1), clamp(Math.floor((z + half) / C), 0, n - 1)];
	const middle = (i, j) => [-half + (i + 0.5) * C, -half + (j + 0.5) * C];
	const need = VESSELS.Schooner.spawn.keel + KEEL_CLEAR;
	// (a cell is open with deep water in it and in the cells round it: the way keeps a cell off the shoals)
	const deep = new Map();
	const wet = (i, j) => { const k = i * n + j; if (!deep.has(k)) deep.set(k, depthAt(...middle(i, j)) > need); return deep.get(k); };
	const open = (i, j) => wet(i, j) && wet(Math.max(i - 1, 0), j) && wet(Math.min(i + 1, n - 1), j) && wet(i, Math.max(j - 1, 0)) && wet(i, Math.min(j + 1, n - 1));
	const [si, sj] = cellOf(from), [ti, tj] = cellOf(to);
	const key = (i, j) => i * n + j, goal = key(ti, tj);
	const cost = new Map([[key(si, sj), 0]]), cameFrom = new Map();
	// (the open cells in a binary heap, the cheapest first)
	const heap = [[Math.hypot(ti - si, tj - sj), si, sj]];
	const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
	const pop = () => {
		const top = heap[0], last = heap.pop();
		if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let k = i; if (l < heap.length && heap[l][0] < heap[k][0]) k = l; if (r < heap.length && heap[r][0] < heap[k][0]) k = r; if (k == i) break; [heap[k], heap[i]] = [heap[i], heap[k]]; i = k; } }
		return top;
	};
	let found = false, steps = 0;
	while (heap.length && steps++ < 60000) {
		const [, i, j] = pop();
		const here = key(i, j);
		if (here == goal) { found = true; break; }
		for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
			if (!di && !dj) continue;
			const a = i + di, c = j + dj;
			if (a < 0 || c < 0 || a >= n || c >= n || !(open(a, c) || key(a, c) == goal)) continue;
			const next = key(a, c), g = cost.get(here) + Math.hypot(di, dj) * (dear ? dear(...middle(a, c)) : 1);
			if (g < (cost.get(next) ?? Infinity)) { cost.set(next, g); cameFrom.set(next, here); push([g + Math.hypot(ti - a, tj - c), a, c]); }
		}
	}
	if (!found) return null;
	const path = [];
	for (let k = goal; k !== undefined; k = cameFrom.get(k)) path.unshift(middle(Math.floor(k / n), k % n));
	return [...path.slice(1), to];
}
// her way to the other town (see THE FLANK at the top): straight there, or for a flanker round a point off to her side (s.war.flank) and in
//		from that side; points as seaRoute's (metres), none: []
function warRoute(s, from) {
	const other = otherTown(s), straight = () => seaRoute(from, stationOff(other)) ?? [];
	const F = s.war.flank;
	const direct = straight();
	if (!F || direct.length < 4) return direct;
	const length = (P) => P.reduce((sum, p, k) => sum + (k ? Math.hypot(p[0] - P[k - 1][0], p[1] - P[k - 1][1]) : Math.hypot(p[0] - from[0], p[1] - from[1])), 0);
	// (the straight way's points in buckets, for how near a place is to it)
	const B = FLANK.lane, buckets = new Map(), end = direct[direct.length - 1];
	for (const p of direct) { const k = Math.floor(p[0] / B) + ',' + Math.floor(p[1] / B); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(p); }
	const dear = (x, z) => {
		// (free near either end: she has to leave from her dock and come in at theirs)
		if (Math.hypot(x - from[0], z - from[1]) < FLANK.free || Math.hypot(x - end[0], z - end[1]) < FLANK.free) return 1;
		const bi = Math.floor(x / B), bj = Math.floor(z / B);
		for (let i = bi - 1; i <= bi + 1; i++) for (let j = bj - 1; j <= bj + 1; j++) for (const p of buckets.get(i + ',' + j) ?? []) if (Math.hypot(p[0] - x, p[1] - z) < B) return FLANK.dear;
		return 1;
	};
	// (her station off it swung round to her side)
	const swung = stationOff(other, F * FLANK.turn) ?? stationOff(other, -F * FLANK.turn) ?? end;
	const round = seaRoute(from, swung, dear);
	if (round && length(round) > length(direct) * FLANK.longer) { shipStats.flanks++; return round; }
	return direct;
}
// her station (see THE PORT GUARD at the top): GUARD.off out from her dock, swung whichever way is furthest from the way out to the other
//		town (metres, x and z)
function guardStation(s) {
	const D = dockOf(s.town), lane = seaRoute([D.end[0] + D.out[0] * 40, D.end[1] + D.out[1] * 40], warStation(s)) ?? [];
	const clear = (p) => Math.min(Infinity, ...lane.slice(0, 30).map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])));
	return GUARD.swing.map((a) => stationOff(s.town, a, GUARD.off)).filter(Boolean).sort((p, q) => clear(q) - clear(p))[0] ?? null;
}
// THE PORT GUARD (see the top): out to her station off her own town's dock, and lying there; the other side's on the water near it fought
function guardPort(s, b, at, dt, now) {
	const m = metre();
	const home = s.guardAt ??= guardStation(s);
	if (!home) { fight(s, null, dt); return; }
	const enemy = npcs.enemiesOf(s.group, at[0], at[1], at[2]).find((e) => !aloft(e) && e.vehicle && boat.boatById(e.vehicle) && Math.hypot(e.x / m - home[0], e.z / m - home[1]) < GUARD.reach) ?? null;
	const off = Math.hypot(home[0] - at[0] / m, home[1] - at[2] / m);
	if (!enemy && off < GUARD.hold) {
		// (on station: her sails let go, lying there)
		trim(b, { luff: true, furl: b.vessel.sails.map((sail) => sail.name) });
		steerFor(b, courseOf(b), dt);
		fight(s, null, dt);
		return;
	}
	let wanted = enemy ? broadsideCourse(b, enemy, at) : bearing(home[0] - at[0] / m, home[1] - at[2] / m);
	if (now - (s.leftAt ?? -1e9) < 10) wanted = courseOf(b);
	const course = chooseCourse(s, b, wanted, b.vessel.spawn.keel, now);
	steerFor(b, course, dt);
	warpOff(s, b, dt);
	const upWind = Math.abs(wrap(course - windFrom())) < NO_GO + 0.2;
	trim(b, { furl: upWind ? b.vessel.sails.map((sail) => sail.name) : [] });
	engine(b, dt);
	fight(s, enemy && enemy.d < SHELL_REACH * m ? enemy : null, dt);
}
// whether a side's schooners can get from its town's dock to the other's by sea (war.js asks as it begins: with no way, the side has none)
export function warSeaWay(home, other) {
	if (!home?.dock || !other?.dock) return false;
	const D = dockOf(home);
	return !!seaRoute([D.end[0] + D.out[0] * 40, D.end[1] + D.out[1] * 40], stationOff(other));
}
// a side's schooners, out of its town's dock (null if it has none); and all of them gone when it is over (war.js)
//		(guard: THE PORT GUARD, see the top)
export function addWarShip(town, side, guard = false) { return town.dock ? makeShip(town, { side, guard }) : null; }
export function clearWarShips() { for (const s of ships.filter((one) => one.war)) clearShip(s); }
export function warShipList() { return ships.filter((s) => s.war).map((s) => ({ side: s.war.side, guard: !!s.war.guard, flank: s.war.flank ?? 0, boat: s.boat?.id ?? null, at: s.boat && s.boat.frame.toWorld([0, 0, 0]).map((v) => Math.round(v / metre())), crew: s.people.filter((p) => p.alive).length, route: s.route ? [s.route.at, s.route.points.length] : null })); }

// for testing: a side's schooners put where she would lie off the other town, done with the way there (metres: at, and spread round it)
export function warShipsToForTest(side, at) {
	ships.filter((s) => s.war?.side == side && s.boat).forEach((s, k) => {
		const b = s.boat;
		b.p[0] = at[0] + (k % 2) * 60 - 30; b.p[2] = at[1] + Math.floor(k / 2) * 60 - 30; b.v = [0, 0, 0];
		s.waiting = false; s.leftAt = -1e9; s.route = { points: [], at: 0 };
	});
}
export const warStationForTest = (side) => { const s = ships.find((x) => x.war?.side == side); return s && warStation(s); };
// for testing: each of the war's schooners as she sails
export function warShipDebug() {
	const r = (v) => Math.round((v ?? 0) * 100) / 100;
	return ships.filter((s) => s.war).map((s) => {
		const b = s.boat;
		if (!b) return { gone: true };
		const at = b.frame.toWorld([0, 0, 0]).map((v) => v / metre()), next = s.route?.points[s.route.at];
		return { waiting: s.waiting, speed: r(b.stats.speed), aground: !!b.stats.aground, apparent: r(b.stats.apparentAngle), heel: r(b.stats.heel), course: r(courseOf(b)), wind: r(windFrom()),
			toNext: next && Math.round(Math.hypot(next[0] - at[0], next[1] - at[2])), bearingNext: next && r(bearing(next[0] - at[0], next[1] - at[2])), depthNext: next && Math.round(depthAt(next[0], next[1])),
			depthHere: Math.round(depthAt(at[0], at[2])), hoist: b.sails.map((x) => r(x.hoist)), helm: [...s.roles.values()].some((x) => x.role == 'helm'), route: s.route && [s.route.at, s.route.points.length] };
	});
}
// for testing
export function shipState() {
	const ship = regular();
	if (!ship) return null;
	const b = ship.boat;
	return { boat: b?.id ?? null, waiting: ship.waiting, dock: ship.dock, patrol: ship.patrol, wp: ship.wp, crew: ship.people.map((p) => ({ id: p.id, alive: p.alive, where: ship.where.get(p), role: ship.roles.get(p) ?? null })),
		at: b && b.frame.toWorld([0, 0, 0]).map((v) => Math.round(v / metre())), speed: b && Math.round(b.stats.speed * 10) / 10, course: b && courseOf(b), rudder: b?.rudder, anchor: !!b?.anchor, health: b?.health, tack: ship.tack, ...shipStats };
}
export const shipForTest = () => regular();
// for testing: a side's attacking schooner's way there, straight and as a flanker (flank -1 or 1): how long each is (metres), and
//		what was tried
export function warRouteForTest(side, flank) {
	const s = ships.find((x) => x.war?.side == side && !x.war.guard);
	if (!s) return null;
	const D = dockOf(s.town), from = [D.end[0] + D.out[0] * 40, D.end[1] + D.out[1] * 40], was = s.war.flank;
	const length = (P) => Math.round(P.reduce((sum, p, k) => sum + Math.hypot(p[0] - (k ? P[k - 1][0] : from[0]), p[1] - (k ? P[k - 1][1] : from[1])), 0));
	s.war.flank = 0; const direct = warRoute(s, from);
	s.war.flank = flank; const before = shipStats.flanks, t0 = performance.now(), flanked = warRoute(s, from), ms = Math.round(performance.now() - t0);
	s.war.flank = was;
	return { direct: length(direct), flanked: length(flanked), took: shipStats.flanks > before, ms, half: Math.round(halfWorld()), mid: direct[Math.floor(direct.length / 2)]?.map(Math.round) };
}
