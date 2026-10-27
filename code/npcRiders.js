import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as forest from './forest.js'
import * as boulders from './boulders.js'
import * as town from './town.js'
import * as horse from './horse.js'
import * as hunting from './hunting.js'
import * as townFolk from './townFolk.js'
import { BUILDING_TYPES } from './townLayout.js'
import * as npcs from './npcs.js'

/*
	THE RIDERS (npcs.js's people): PER_TOWN from every town, each on a horse of its own (horse.js, ridden by its id), going between
	the towns along the footpaths (footpaths.js) and the towns' streets. Each starts from its town's inn (its home: where it comes
	back to, shot dead) and rides to another town's inn, rests there a while (REST), and rides back. With only one town it rides out
	to the far end of a footpath (a lookout, a lake, the beach) and back instead.

	THE ROADS (buildRoads): every footpath's points and every town's ways (townFolk.js's: its streets, lanes, stairs and bridges) as
	one net, a footpath's ends joined to whatever is nearest them (JOIN), and the way between two places on it (townFolk.js's
	wayBetween). A rider steers for a point LOOK_AHEAD along its way, at a trot (TROT, times settings.horseSpeed as the horses' paces
	are), slower round bends and coming in.
	IN THE WAY (avoid): every so often (THINK) it looks along a fan of headings either side of the one it wants, a few metres out
	(PROBES), and takes the nearest to it that is clear: of trees, boulders and the houses, ground too steep, water too deep, the
	other horses and the player. Stuck (going nowhere for STUCK seconds): it backs off, and finds its way again from where it is.
	SHOT AT (npcs.js: it, or its horse): it turns its horse to whoever fired and stops, and shoots back with its revolver (RANGE, every
	FIRE_EVERY, off by SPREAD), until they have been out of reach or out of sight for a while, then goes on its way. Who to fight, and
	whether it can be seen, is looked for every LOOK seconds, each rider at its own moment (the work spread over the frames). Further off, it
	rides at them (CHASE) until they are within reach.
	DOWN: off its horse on to the ground beside it. The horse stands there (anyone can ride it). Back at its inn RESPAWN_SECONDS
	later on a new horse; the old one goes if no one is on it (and the walker is not by it).
	THE WAR (war.js: addWarRider): each side's horsemen, out of its town's inn, ride over to the other's and about its streets from one
		house's door to another's, after its townsfolk (and the other side's players and horsemen, on the land: not up in the air nor out
		on the water). Down, each is back at its own inn on a new horse in time, and rides over again. While it is on, the others are put up.
	World units (2 to the metre) for places, metres a second for paces
*/
const PER_TOWN = 2;
const TROT = 3.6;					// metres a second (a real horse's: horse.js puts every pace times settings.horseSpeed)
const LOOK_AHEAD = 8;				// metres
const JOIN = 10;					// metres: a footpath's end joined to the nearest point of another, or a street
const REST = [25, 60];				// seconds at an inn
const THINK = 0.2;					// seconds between looks round
const PROBES = [2.5, 5, 8];			// metres out along a heading
const FAN = [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95, 1.4, -1.4, 2.0, -2.0];	// radians off the heading wanted
const STUCK = 3;					// seconds
const RANGE = 60;					// metres it shoots at (its revolver)
const CHASE = 180;					// metres: further than RANGE, as far as this, it rides at them
const FIRE_EVERY = [1.8, 3.0];		// seconds
const SPREAD = 0.014;				// radians, and as much again every 200 metres
const GIVE_UP = 12;
const LOOK = 0.3;					// seconds between looks round for who to fight (each rider at its own moment)					// seconds out of sight before it goes on its way

const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const pace = () => Math.max(settings.horseSpeed, 0.1);

export const riderStats = { riders: 0, roads: 0, routes: 0, stuck: 0, shots: 0 };

// The roads (see THE ROADS at the top)
//-------------------------------------------------
let roads = null, builtFor = null;
function buildRoads(land) {
	const nodes = [], index = new Map();
	const node = (x, y, z) => {
		const key = Math.round(x) + ',' + Math.round(z);
		let n = index.get(key);
		if (n === undefined) { n = nodes.length; nodes.push({ x, y, z, ways: [] }); index.set(key, n); }
		return n;
	};
	const join = (a, b) => {
		if (a == b || nodes[a].ways.some((w) => w[0] == b)) return;
		const d = Math.hypot(nodes[b].x - nodes[a].x, nodes[b].z - nodes[a].z);
		nodes[a].ways.push([b, d, 0, 1]); nodes[b].ways.push([a, d, 0, 1]);
	};
	const chains = [];		// the nodes of each footpath and each town: a footpath's ends are joined to the others
	for (const t of land.towns ?? []) {
		if (!t.buildings?.length) continue;
		const ways = townFolk.makeWays(t), first = nodes.length, map = ways.nodes.map((n) => node(n.x, n.y, n.z));
		ways.nodes.forEach((n, k) => { for (const [to] of n.ways) join(map[k], map[to]); });
		chains.push({ from: first, to: nodes.length, ends: [] });
	}
	for (const path of land.paths ?? []) {
		const first = nodes.length;
		const list = path.points.map(([x, y, z]) => node(x, y, z));
		for (let k = 0; k < list.length - 1; k++) join(list[k], list[k + 1]);
		chains.push({ from: first, to: nodes.length, ends: [list[0], list[list.length - 1]] });
	}
	// a footpath's ends to the nearest point not its own, within JOIN
	const reach = JOIN * metre();
	chains.forEach((chain) => {
		for (const end of chain.ends) {
			const e = nodes[end];
			let best = -1, bestD = reach;
			nodes.forEach((n, k) => {
				if (k >= chain.from && k < chain.to) return;
				const d = Math.hypot(n.x - e.x, n.z - e.z);
				if (d < bestD) { bestD = d; best = k; }
			});
			if (best >= 0) join(end, best);
		}
	});
	const nearest = (x, z) => {
		let best = -1, bestD = Infinity;
		nodes.forEach((n, k) => { if (!n.ways.length) return; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bestD) { bestD = d; best = k; } });
		return best;
	};
	riderStats.roads = nodes.length;
	return { nodes, nearest };
}

// the roads (buildRoads) of a land, for anyone else who wants a way across it (horde.js: the townsfolk to the schooner)
const roadsMade = new WeakMap();
export function roadsFor(land) {
	let made = roadsMade.get(land);
	if (!made) { made = buildRoads(land); roadsMade.set(land, made); }
	return made;
}

// the inns (each town's: a rider's home, and where it goes), or the plaza, or the first house: { x, z, heading } in front of its door
function innOf(t) {
	const b = t.buildings.find((one) => BUILDING_TYPES[one.type].name == 'inn') ?? t.buildings.find((one) => !one.onPier);
	if (!b) return null;
	const out = b.depth / 2 + 4 * metre();
	return { x: b.x + Math.sin(b.yaw) * out, z: b.z + Math.cos(b.yaw) * out, heading: b.yaw, town: t };
}
// where a rider with only its own town goes: the far ends of the footpaths that do not end in a town
function farEnds(land) {
	const ends = [];
	for (const path of land.paths ?? []) {
		const p = path.points[path.points.length - 1];
		if (p && (land.townAt?.(p[0], p[2]) ?? 0) < 0.05) ends.push({ x: p[0], z: p[2] });
	}
	return ends;
}

// The riders
//-------------------------------------------------
// each: { person (npcs.js), horse, inn (its home), going (the inn or the place it is going to), route ([[x, z], ...]), along (how far
//		along it, its point), rest (seconds left at the end), wanted (the heading it steers for), think, stuck, backing, fire (seconds to
//		its next shot), unseen (seconds its enemy has been out of sight) }
const riders = [];
let places = [];		// the inns, or the far ends of the footpaths

function makeRiders(land) {
	clearRiders();
	roads = buildRoads(land);
	const inns = (land.towns ?? []).filter((t) => t.buildings?.length).map(innOf).filter(Boolean);
	places = inns.length > 1 ? inns : farEnds(land);
	inns.forEach((inn, t) => {
		for (let k = 0; k < PER_TOWN; k++) {
			const person = npcs.makePerson('rider', { hat: 'stetson', gun: 'revolver', home: inn, name: 'rider' });
			const r = { person, inn, horse: null, going: null, route: [], along: 0, rest: 0, wanted: 0, think: 0, stuck: 0, backing: 0, fire: 1, unseen: 0, turnSign: 1 };
			riders.push(r);
			mountNew(r);
			setOff(r);
			// (the second sets off a while into its ride, so they are not side by side)
			if (k > 0) skipAlong(r, 0.45);
		}
	});
	riderStats.riders = riders.length;
}
// a new horse at its inn, and it in the saddle
function mountNew(r) {
	const h = horse.spawnHorse(r.inn.x, r.inn.z, { heading: r.inn.heading, owner: 'npc', authority: 0, coat: Math.random() });	// (authority: this machine, alone or the host)
	horse.setRider(h, r.person.id);
	r.horse = h;
	npcs.announce('horse', h, null);
}
// on to the next place: another inn (or far end), the way there along the roads
function setOff(r) {
	if (r.war) { r.going = warSpot(r.war.enemy); planRoute(r); return; }
	const choices = places.filter((p) => Math.hypot(p.x - r.horse.x, p.z - r.horse.z) > 60 * metre());
	r.going = choices.length ? choices[Math.floor(Math.random() * choices.length)] : r.inn;
	planRoute(r);
}
function planRoute(r) {
	const h = r.horse, a = roads.nearest(h.x, h.z), b = roads.nearest(r.going.x, r.going.z);
	const way = a >= 0 && b >= 0 ? townFolk.wayBetween(roads, a, b) : null;
	r.route = (way ?? []).map((k) => [roads.nodes[k].x, roads.nodes[k].z]);
	r.route.push([r.going.x, r.going.z]);
	r.along = 0;
	riderStats.routes++;
}
// (for the second of a town's: put a share of the way along its route)
function skipAlong(r, share) {
	const k = Math.floor((r.route.length - 1) * share);
	if (k <= 0) return;
	const [x, z] = r.route[k], [nx, nz] = r.route[Math.min(k + 1, r.route.length - 1)];
	Object.assign(r.horse, { x, z, heading: Math.atan2(nx - x, nz - z), ground: null });
	r.along = k;
}

// IN THE WAY (see the top): whether a heading is clear out to PROBES, a cost (0 clear) for it
function blockedAlong(r, heading) {
	const h = r.horse, m = metre(), land = terrain.land;
	const fx = Math.sin(heading), fz = Math.cos(heading);
	let cost = 0;
	PROBES.forEach((d, k) => {
		const x = h.x + fx * d * m, z = h.z + fz * d * m, weight = 1 / (k + 1);
		const ground = land.heightAt(x, z), here = land.heightAt(h.x, h.z);
		if ((ground - here) / (d * m) > 0.75) cost += 3 * weight;
		if (settings.waterWorldPosY - ground > 1.0 * m) cost += 4 * weight;
		const box = (bx, bz, half, bottom, top) => { if (top > h.y + 0.5 * m && bottom < h.y + 2 * m && Math.abs(bx - x) < half + 0.9 * m && Math.abs(bz - z) < half + 0.9 * m) cost += 5 * weight; };
		if (settings.enableForest) forest.trunksNear(x, z, 2 * m, box);
		if (settings.enableBoulders) boulders.bouldersNear(x, z, 2 * m, box);
		town.boxesNear(x, z, 2 * m, box);
		for (const other of horse.horses) if (other !== h && Math.hypot(other.x - x, other.z - z) < 2.2 * m) cost += 3 * weight;
		const me = hunting.hunterPlace();
		if (me.active && Math.hypot(me.x - x, me.z - z) < 1.8 * m) cost += 3 * weight;
	});
	return cost;
}

// one rider, for dt seconds
function stepRider(r, dt) {
	const p = r.person, h = r.horse, m = metre();
	if (!p.alive) { fallen(r, dt); return; }
	if (!h.exists) { mountNew(r); planRoute(r); }
	// its enemy: the nearest it is hostile to, in reach (or in sight, to chase)
	// (looked round for every LOOK, each rider at its own moment; in between the one it has, where it is now)
	if ((r.look = (r.look ?? Math.random() * LOOK) - dt) <= 0) {
		r.look += LOOK;
		const found = npcs.enemiesOf(p.group, h.x, h.y + 2 * m, h.z).find((e) => e.d < CHASE * m && (!npcs.war.on || onLand(e)));
		r.enemyId = found?.id ?? null;
		r.seen = !!found && npcs.clearLine(h.frame.toWorld([0, 2.4, 0]), [found.x, found.y, found.z]);
	}
	const t = r.enemyId ? npcs.targetById(r.enemyId) : null;
	const enemy = t && t.alive ? { ...t, d: Math.hypot(t.x - h.x, t.y - h.y - 2 * m, t.z - h.z) } : null;
	const seen = enemy && r.seen;
	r.unseen = seen ? 0 : r.unseen + dt;
	p.fighting = !!enemy && r.unseen < GIVE_UP;
	let ahead = 0, turn = 0;
	if (p.fighting) {
		// at them: closer if out of reach, then stopped and turned to them, firing
		const toward = Math.atan2(enemy.x - h.x, enemy.z - h.z), off = npcs.wrap(toward - h.heading);
		const close = enemy.d < RANGE * m && seen;
		if (!close) { r.wanted = toward; ({ ahead, turn } = steer(r, dt, 1.6)); }
		else {
			turn = clamp(off * 2, -1, 1);
			const muzzle = h.frame.toWorld([0.1, 1.6 + 1.32 - 0.9, 0.5]);
			p.aim = Math.atan2(enemy.y - muzzle[1], Math.hypot(enemy.x - muzzle[0], enemy.z - muzzle[2]));
			r.fire -= dt;
			if (r.fire <= 0 && Math.abs(off) < 0.35 && Math.abs(h.speed) < 1.5) {
				r.fire = FIRE_EVERY[0] + Math.random() * (FIRE_EVERY[1] - FIRE_EVERY[0]);
				npcs.fireAt(p, muzzle, enemy, { round: '.45 Colt', spread: SPREAD, spreadFar: SPREAD * 0.5 });
				riderStats.shots++;
			}
		}
		if (!p.fighting) planRoute(r);
	} else if (r.rest > 0) {
		r.rest -= dt;
		if (r.rest <= 0) setOff(r);
	} else {
		// along its way: the point LOOK_AHEAD on from the nearest it has come to
		const route = r.route;
		while (r.along < route.length - 1 && Math.hypot(route[r.along][0] - h.x, route[r.along][1] - h.z) < LOOK_AHEAD * 0.6 * m) r.along++;
		const [tx, tz] = route[r.along] ?? [r.going.x, r.going.z];
		const left = Math.hypot(r.going.x - h.x, r.going.z - h.z);
		if (r.along >= route.length - 1 && left < 4 * m) { r.rest = r.war ? 2 + Math.random() * 4 : REST[0] + Math.random() * (REST[1] - REST[0]); }
		else {
			r.wanted = Math.atan2(tx - h.x, tz - h.z);
			({ ahead, turn } = steer(r, dt, left < 25 * m ? 0.5 : 1));
		}
	}
	// stuck: back off a while, then find its way again
	if (ahead > 0 && Math.abs(h.speed) < 0.3) r.stuck += dt; else r.stuck = Math.max(r.stuck - dt, 0);
	if (r.stuck > STUCK) { r.stuck = 0; r.backing = 1.6; r.turnSign = Math.random() < 0.5 ? 1 : -1; riderStats.stuck++; }
	if (r.backing > 0) {
		r.backing -= dt;
		ahead = -1; turn = r.turnSign;
		if (r.backing <= 0 && !p.fighting) planRoute(r);
	}
	h.input = { ahead, turn };
	p.place = { x: 0, y: 0, z: 0, heading: h.heading, sit: 2 };
	[p.place.x, p.place.y, p.place.z] = h.frame.toWorld(horse.SEAT);
	p.anchor = { vehicle: h.id, local: horse.SEAT, facing: [0, 0, 1] };
	p.armsDown = 0;
}
// towards r.wanted, round whatever is in the way, at a trot times howFast: { ahead, turn }
function steer(r, dt, howFast) {
	const h = r.horse;
	r.think -= dt;
	if (r.think <= 0) {
		r.think = THINK;
		let best = r.wanted, bestCost = Infinity;
		for (const off of FAN) {
			const cost = blockedAlong(r, r.wanted + off) * 2 + Math.abs(off);
			if (cost < bestCost) { bestCost = cost; best = r.wanted + off; }
		}
		r.heading = best;
	}
	const off = npcs.wrap((r.heading ?? r.wanted) - h.heading);
	const want = TROT * pace() * howFast * (Math.abs(off) > 0.7 ? 0.45 : 1);
	return { ahead: Math.abs(h.speed) < want ? 1 : 0, turn: clamp(off * 2.5, -1, 1) };
}
// down: off the horse, on the ground beside it; back at its inn on a new horse in time (npcs.js)
function fallen(r, dt) {
	const p = r.person, h = r.horse, m = metre();
	if (h.rider === p.id) {
		horse.setRider(h, null);
		h.input = null;
		const side = h.frame.toWorld([1.1, 0, 0]);
		p.place = { x: side[0], y: terrain.land.groundAt(side[0], side[2]), z: side[2], heading: h.heading + Math.PI / 2, sit: 0 };
		p.anchor = null;
	}
	if (p.respawnIn <= 0 && p.respawnIn > -1) {
		const me = hunting.hunterPlace();
		if (h.exists && !h.rider && !(me.active && Math.hypot(me.x - h.x, me.z - h.z) < 30 * m)) { horse.removeHorse(h); npcs.announce('horse', null, h); }
		npcs.revive(p);
		mountNew(r);
		setOff(r);
	}
}

// Per frame (after npcs.js's)
//-------------------------------------------------
export function ridersUpdate(dt) {
	const land = terrain.land;
	if (!npcs.on() || !npcs.runsHere()) {
		// (off, or this machine joined a game: the host's are drawn instead, npcs.js)
		if (riders.length && (!settings.enableNPCs || !npcs.runsHere())) { clearRiders(() => true); builtFor = null; }
		return;
	}
	// (in THE WAR only the sides' ride: the others are put up until it is over)
	if (npcs.war.on) { if (riders.some((r) => !r.war)) clearRiders(); builtFor = null; }
	else if (land !== builtFor) { builtFor = land; makeRiders(land); }
	for (const r of [...riders]) stepRider(r, dt);
}
// (the riders between the towns, or which)
function clearRiders(which = (r) => !r.war) {
	for (const r of riders.filter(which)) {
		npcs.removePerson(r.person);
		if (r.horse?.exists && r.horse.rider !== 'me') { horse.removeHorse(r.horse); npcs.announce('horse', null, r.horse); }
		riders.splice(riders.indexOf(r), 1);
	}
}

// THE WAR (see the top)
//-------------------------------------------------
// one of a side's horsemen, out of its town's (home's) inn, after the other's (enemy's) townsfolk. k: which of them (they start spread
//		round the inn)
export function addWarRider(side, home, enemy, k = 0) {
	roads = roadsFor(terrain.land);
	const group = npcs.makeGroup();
	group.side = side;
	const inn = innOf(home), a = k * 2.4, out = (3 + (k % 5) * 2.5) * metre();
	const start = { ...inn, x: inn.x + Math.cos(a) * out, z: inn.z + Math.sin(a) * out };
	const person = npcs.makePerson('rider', { hat: 'stetson', gun: 'revolver', home: start, group, name: 'horseman' });
	const r = { person, inn: start, horse: null, going: null, route: [], along: 0, rest: 0, wanted: 0, think: 0, stuck: 0, backing: 0, fire: 1, unseen: 0, turnSign: 1, war: { side, enemy } };
	riders.push(r);
	mountNew(r);
	setOff(r);
	return r;
}
export function clearWarRiders() { clearRiders((r) => !!r.war); }
// for testing: a side's horsemen put in the other town (world units: at, spread round it), and on their way about it
export function warRidersToForTest(side, at) {
	riders.filter((r) => r.war?.side == side && r.horse?.exists).forEach((r, k) => {
		const a = k * 2.4, out = (4 + k * 3) * metre();
		Object.assign(r.horse, { x: at[0] + Math.cos(a) * out, z: at[1] + Math.sin(a) * out, ground: null });
		setOff(r);
	});
}
export function warRiderList() { return riders.filter((r) => r.war).map((r) => ({ side: r.war.side, alive: r.person.alive, at: r.horse ? [Math.round(r.horse.x), Math.round(r.horse.z)] : null, fighting: r.person.fighting })); }
// somewhere in the other town to ride to: before the door of one of its houses, at random
function warSpot(t) {
	const list = t.buildings.filter((b) => !b.onPier), b = list[Math.floor(Math.random() * list.length)];
	const out = b.depth / 2 + 4 * metre();
	return { x: b.x + Math.sin(b.yaw) * out, z: b.z + Math.cos(b.yaw) * out, heading: b.yaw };
}
// whether one of theirs is somewhere a horseman can get at it: on the land, not up in the air nor out on the water
function onLand(e) {
	const ground = terrain.land.heightAt(e.x, e.z);
	return ground > settings.waterWorldPosY && (e.feet ?? e.y) - ground < 3 * metre();
}
// each horse's rider's group (npcs.js: a shot at the horse is a shot at its rider)
npcs.addVehicleGroups((id) => riders.find((r) => r.horse?.id === id)?.person.group ?? null);

// for testing
export function riderList() {
	return riders.map((r) => ({ id: r.person.id, alive: r.person.alive, horse: r.horse.id, x: r.horse.x, z: r.horse.z, speed: r.horse.speed, going: r.going && { x: r.going.x, z: r.going.z }, route: r.route.length, along: r.along, rest: r.rest, fighting: r.person.fighting, stuck: r.stuck }));
}
export const roadsForTest = () => roads;
export const ridersForTest = riders;
