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
		ACROSS COUNTRY: with no way by the roads to where it is going, or one more than OFF_ROAD.detour times as long as straight
		there, it goes across country (landRoute: A* over a grid of OFF_ROAD.cell, dry land not too steep, the steeper the dearer).
		THE FLANK: riding over from its own town, it has a chance (FLANK.chance) of going round: across country out to a point FLANK.out
		off to one side of the way there, half way, then in to the edge of the town on that side, and on along its streets.
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
const OFF_ROAD = { cell: 20, pad: 400, steep: 0.7, climb: 4, detour: 2.2, most: 25000 };	// ACROSS COUNTRY: metres a cell, round the two ends, too steep (rise over run), how dear a climb is, how long a way round is too long
const FLANK = { chance: 0.35, out: [500, 400, 300, 200] };	// THE FLANK: a chance of it, and metres off to the side (the furthest on dry land; its side first)
const LOOK = 0.3;					// seconds between looks round for who to fight (each rider at its own moment)					// seconds out of sight before it goes on its way

const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const pace = () => Math.max(settings.horseSpeed, 0.1);

export const riderStats = { riders: 0, roads: 0, routes: 0, stuck: 0, shots: 0, offRoad: 0, flanks: 0 };

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
	if (r.war) {
		r.going = warSpot(r.war.enemy);
		r.war.flank = Math.random() < FLANK.chance ? (Math.random() < 0.5 ? -1 : 1) : 0;
		planRoute(r);
		return;
	}
	const choices = places.filter((p) => Math.hypot(p.x - r.horse.x, p.z - r.horse.z) > 60 * metre());
	r.going = choices.length ? choices[Math.floor(Math.random() * choices.length)] : r.inn;
	planRoute(r);
}
function planRoute(r) {
	const h = r.horse;
	r.route = r.war ? warRoute(r) : roadWay([h.x, h.z], [r.going.x, r.going.z]) ?? [[r.going.x, r.going.z]];
	r.along = 0;
	riderStats.routes++;
}
// the way by the roads from a place to another (world units, [x, z]): its points, the last the place itself; none: null
function roadWay(from, to) {
	const a = roads.nearest(from[0], from[1]), b = roads.nearest(to[0], to[1]);
	const way = a >= 0 && b >= 0 ? townFolk.wayBetween(roads, a, b) : null;
	return way && [...way.map((k) => [roads.nodes[k].x, roads.nodes[k].z]), to];
}
const lengthOf = (from, P) => P.reduce((sum, p, k) => sum + Math.hypot(p[0] - (k ? P[k - 1][0] : from[0]), p[1] - (k ? P[k - 1][1] : from[1])), 0);
// THE WAR: a horseman's way (see ACROSS COUNTRY and THE FLANK at the top)
function warRoute(r) {
	const h = r.horse, m = metre(), from = [h.x, h.z], goal = [r.going.x, r.going.z];
	const E = r.war.middle ??= town.townMiddle(r.war.enemy);
	const toE = [E.x - h.x, E.z - h.z], d = Math.hypot(...toE);
	if (r.war.flank && d > E.reach + 250 * m) {
		const half = settings.terrainWorldSize * 0.5 - 60 * m, dry = settings.waterWorldPosY + 1.5 * m;
		let P = null;
		for (const side of [r.war.flank, -r.war.flank]) for (const out of FLANK.out) {
			const at = [h.x + toE[0] * 0.5 - toE[1] / d * side * out * m, h.z + toE[1] * 0.5 + toE[0] / d * side * out * m];
			if (!P && Math.abs(at[0]) < half && Math.abs(at[1]) < half && terrain.land.heightAt(at[0], at[1]) > dry) P = at;
		}
		r.war.flank = 0;
		if (P) {
			const s = Math.hypot(P[0] - E.x, P[1] - E.z), edge = [E.x + (P[0] - E.x) / s * E.reach * 0.85, E.z + (P[1] - E.z) / s * E.reach * 0.85];
			const out1 = landRoute(from, P), in1 = out1 && landRoute(P, edge);
			if (in1) { riderStats.flanks++; return [...out1, ...in1, ...(roadWay(edge, goal) ?? [goal])]; }
		}
	}
	const road = roadWay(from, goal), straight = Math.hypot(goal[0] - from[0], goal[1] - from[1]);
	if (road && lengthOf(from, road) < OFF_ROAD.detour * straight + 60 * m) return road;
	const across = landRoute(from, goal);
	if (across) { riderStats.offRoad++; return across; }
	return road ?? [goal];
}
// ACROSS COUNTRY (see the top): A* over a grid of OFF_ROAD.cell round from and to (world units, [x, z]), through dry land not too steep, the
//		steeper the dearer; its points (world units), the last to itself. None: null
function landRoute(from, to) {
	const m = metre(), land = terrain.land, C = OFF_ROAD.cell * m, pad = OFF_ROAD.pad * m, half = settings.terrainWorldSize * 0.5 - 20 * m;
	const x0 = Math.max(Math.min(from[0], to[0]) - pad, -half), z0 = Math.max(Math.min(from[1], to[1]) - pad, -half);
	const nx = Math.max(Math.ceil((Math.min(Math.max(from[0], to[0]) + pad, half) - x0) / C), 1), nz = Math.max(Math.ceil((Math.min(Math.max(from[1], to[1]) + pad, half) - z0) / C), 1);
	const cellOf = (x, z) => [clamp(Math.floor((x - x0) / C), 0, nx - 1), clamp(Math.floor((z - z0) / C), 0, nz - 1)];
	const height = new Float32Array(nx * nz).fill(NaN);
	const heightOf = (i, j) => { const k = i * nz + j; if (Number.isNaN(height[k])) height[k] = land.heightAt(x0 + (i + 0.5) * C, z0 + (j + 0.5) * C); return height[k]; };
	const dry = settings.waterWorldPosY + 0.3 * m;
	const [si, sj] = cellOf(...from), [ti, tj] = cellOf(...to), goal = ti * nz + tj;
	const cost = new Float32Array(nx * nz).fill(Infinity), came = new Int32Array(nx * nz).fill(-1);
	cost[si * nz + sj] = 0;
	const heap = [[Math.hypot(ti - si, tj - sj), si, sj]];
	const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
	const pop = () => {
		const top = heap[0], last = heap.pop();
		if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, rr = l + 1; let k = i; if (l < heap.length && heap[l][0] < heap[k][0]) k = l; if (rr < heap.length && heap[rr][0] < heap[k][0]) k = rr; if (k == i) break; [heap[k], heap[i]] = [heap[i], heap[k]]; i = k; } }
		return top;
	};
	let found = false, steps = 0;
	while (heap.length && steps++ < OFF_ROAD.most) {
		const [, i, j] = pop(), here = i * nz + j;
		if (here == goal) { found = true; break; }
		const h0 = heightOf(i, j);
		for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
			if (!di && !dj) continue;
			const a = i + di, c = j + dj;
			if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
			const next = a * nz + c, h1 = heightOf(a, c), run = Math.hypot(di, dj) * C, rise = Math.abs(h1 - h0) / run;
			if (next != goal && (h1 < dry || rise > OFF_ROAD.steep)) continue;
			const g = cost[here] + Math.hypot(di, dj) * (1 + OFF_ROAD.climb * rise);
			if (g < cost[next]) { cost[next] = g; came[next] = here; push([g + Math.hypot(ti - a, tj - c), a, c]); }
		}
	}
	riderStats.landSteps = Math.max(riderStats.landSteps ?? 0, steps);
	if (!found) { riderStats.landFailed = (riderStats.landFailed ?? 0) + 1; return null; }
	const path = [];
	for (let k = came[goal]; k >= 0 && k != si * nz + sj; k = came[k]) path.unshift([x0 + (Math.floor(k / nz) + 0.5) * C, z0 + (k % nz + 0.5) * C]);
	return [...path, to];
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
export function warRiderList() { return riders.filter((r) => r.war).map((r) => ({ side: r.war.side, flank: r.war.flank ?? 0, alive: r.person.alive, at: r.horse ? [Math.round(r.horse.x), Math.round(r.horse.z)] : null, fighting: r.person.fighting })); }
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
// for testing: the way across country between two places (world units), and how long it took to find
export function landRouteForTest(from, to) {
	const t0 = performance.now(), P = landRoute(from, to);
	return { points: P?.length ?? 0, ms: Math.round((performance.now() - t0) * 10) / 10, steps: riderStats.landSteps };
}
