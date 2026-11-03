import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as ballistics from './ballistics.js'
import * as props from './props.js'
import * as deer from './deer.js'
import * as hearing from './hearing.js'
import { makeWays } from './townFolk.js'

/*
	THE TOWNS' CATS AND RATS.
		CATS	CATS_PER_TOWN in every town, tabbies and black ones (catTabby, catBlack: creatureMeshes.js, under 200 triangles), walking its streets from corner to corner (townFolk.js: makeWays), sitting
				a while now and then. A cat sees a rat within SIGHT and goes after it (as fast as CHASE, faster than a rat runs: FLEE), and the first it catches is dead, and it sits over it (EAT seconds), and
				does not hunt again for a while (FULL). It gives up a chase after GIVE_UP seconds. A cat cannot be hurt: whatever hits it (a round, a blow, a stone: ballistics.js), it scurries off (SCURRY).
		RATS	in packs of PACK (rat: under 50 triangles): RAT_TOWN of them in every town, going about its streets as the cats do, and RAT_FIELDS out in the grassland, round a place each. A pack keeps together,
				each rat darting about its middle. A cat or a player near (hearing.js) and they all bolt, away from it. Shot (or caught), a rat lies there (LIE; in the Survival mode LIE_SURVIVAL) to be cut up
				with a hatchet or a knife (survivalTools.js: harvest: small bones and rat meat), and another joins its pack RESPAWN seconds on.
	MULTIPLAYER, as the deer (net.js: the animals, 'critter'): the host keeps them, a joiner draws its records (critterFollow); a joiner's shot is told to the host (critterShot: hitCritter, the same for
	a cat: it scurries), and its cuts are asked for (survivalTools.js). In metres and seconds (their places world units). Not in the Horde game mode.
*/
const CATS_PER_TOWN = 5, RAT_TOWN = 2, RAT_FIELDS = 7, PACK = [3, 6];
const WALK = 0.8, TROT = 2.2, CHASE = 5.2, SCURRY = 6.5, FLEE = 4.2, DART = 2.6;		// metres a second
const SIGHT = 16, SPOOK_CAT = 6, SPOOK_PLAYER = 8, CATCH = 0.4;						// metres
const SIT = [4, 14], EAT = 12, FULL = 45, GIVE_UP = 9, SCURRY_FOR = 4;				// seconds
const FIELD_WANDER = 45;															// metres
const LIE = 8, LIE_SURVIVAL = 400, RESPAWN = 60;
const DRAW = 140;																	// metres
const KIND = { rat: 5, tabby: 4, black: 4 };										// vf_props.js: RIGS
const SPHERES = { cat: [[0, 0.2, 0, 0.13], [0, 0.26, 0.2, 0.07]], rat: [[0, 0.04, 0, 0.05]] };

const metre = () => settings.forestUnitsPerMetre;
const hidden = () => settings.gameMode == 'Horde';
export const critterStats = { cats: 0, rats: 0, caught: 0, shot: 0, scurried: 0, corpses: 0 };
export const critterShot = { report: null };
let cats = [], rats = [], packs = [], corpses = [], respawns = [], builtFor = null, nextId = 1, clock = 0;
let followed = null;

// ALONG THE STREETS: from a corner (node) to the next, never straight back if there is another way
function nextNode(o) {
	const N = o.ways.nodes[o.to], choices = N.ways.map(([b]) => b).filter((b) => b != o.from);
	return choices.length ? choices[Math.floor(Math.random() * choices.length)] : o.from;
}
function streetStep(o, pace, dt) {
	const nodes = o.ways.nodes, A = nodes[o.from], B = nodes[o.to], m = metre(), len = Math.hypot(B.x - A.x, B.z - A.z) || 1;
	o.t += pace * m * dt / len;
	if (o.t >= 1) { o.from = o.to; o.to = nextNode(o); o.t = 0; return streetStep(o, 0, 0); }
	const x = A.x + (B.x - A.x) * o.t, z = A.z + (B.z - A.z) * o.t;
	face(o, x - o.x, z - o.z, dt);
	stride(o, Math.hypot(x - o.x, z - o.z));
	o.x = x; o.z = z; o.y = A.y + (B.y - A.y) * o.t;
}
// off the streets, straight to a place: how far off it still is
function runTo(o, to, pace, dt) {
	const m = metre(), dx = to[0] - o.x, dz = to[1] - o.z, far = Math.hypot(dx, dz);
	if (far < 0.05 * m) return far;
	const step = Math.min(pace * m * dt, far);
	face(o, dx, dz, dt * 2);
	o.x += dx / far * step; o.z += dz / far * step;
	stride(o, step);
	o.y = deer.groundUnder(o);
	return far - step;
}
function face(o, dx, dz, dt) {
	if (Math.hypot(dx, dz) < 1e-6) return;
	let off = Math.atan2(dx, dz) - o.heading;
	off -= Math.PI * 2 * Math.round(off / (Math.PI * 2));
	o.heading += off * Math.min(dt * 8, 1);
}
const stride = (o, step) => { o.stride += step / ((o.kind == 'rat' ? 0.12 : 0.45) * metre()) * Math.PI * 2; o.going = Math.min(o.going + 0.2, 1); };
// back on to the street at its nearest corner
function rejoin(o) { const k = o.ways.nearest(o.x, o.z); o.from = k; o.to = k; o.t = 1; o.back = true; }

function newCat(town, ways, k) {
	const n = Math.floor(Math.random() * ways.nodes.length), N = ways.nodes[n];
	return { id: nextId++, kind: k % 3 == 2 ? 'black' : 'tabby', ways, town, x: N.x, y: N.y, z: N.z, from: n, to: n, t: 1, heading: Math.random() * 6.28, stride: 0, going: 0, headDown: 0, state: 'sit', timer: Math.random() * SIT[1], prey: null, fullUntil: 0, away: null };
}
function newRat(P, x = P.x, z = P.z) {
	const m = metre();
	return { id: nextId++, kind: 'rat', pack: P, x: x + (Math.random() - 0.5) * 2 * m, y: 0, z: z + (Math.random() - 0.5) * 2 * m, heading: Math.random() * 6.28, stride: 0, going: 0, headDown: 0, spot: [0, 0], dart: 0, fleeing: 0 };
}
function newPack(home, ways = null) {
	const P = { home, ways, x: home[0], z: home[1], y: 0, from: 0, to: 0, t: 1, heading: 0, stride: 0, going: 0, kind: 'pack', target: null, wait: 0, flee: null, size: PACK[0] + Math.floor(Math.random() * (PACK[1] - PACK[0] + 1)) };
	if (ways) { const n = ways.nearest(home[0], home[1]); P.from = P.to = n; }
	packs.push(P);
	for (let k = 0; k < P.size; k++) rats.push(newRat(P));
	return P;
}
// (in a world of tiles, terrain.js: each tile of land its own, made as it comes and gone with it)
terrain.onTiles((added, removed) => {
	if (builtFor !== terrain.land) return;
	if (removed.length) { cats = cats.filter((c) => !removed.includes(c.tile)); packs = packs.filter((P) => !removed.includes(P.tile)); rats = rats.filter((r) => !removed.includes(r.pack?.tile)); respawns = respawns.filter((R) => !removed.includes(R.tile)); }
	for (const { key, land } of terrain.landsHere()) if (added.includes(key)) crittersOf(land, key);
});
function build() {
	builtFor = terrain.land;
	cats = []; rats = []; packs = []; corpses = []; respawns = [];
	for (const { key, land } of terrain.landsHere()) crittersOf(land, key);
}
function crittersOf(land, tile) {
	const before = { cats: cats.length, packs: packs.length };
	// (a tile's towns: the world's places for them, terrain.js: townSlots)
	for (const town of terrain.world ? terrain.land.towns.filter((t) => t.tile == tile) : land.towns ?? []) {
		if (!town.buildings?.length) continue;
		const ways = makeWays(town);
		if (!ways.nodes.length) continue;
		for (let k = 0; k < CATS_PER_TOWN; k++) cats.push(newCat(town, ways, k));
		for (let k = 0; k < RAT_TOWN; k++) { const N = ways.nodes[Math.floor(Math.random() * ways.nodes.length)]; newPack([N.x, N.z], ways); }
	}
	for (const s of land.findSpawnPoints(terrain.ZONE_GRASSLAND, RAT_FIELDS, { seed: 191, minSpacing: 150, maxSlope: 0.3 })) newPack([s.x, s.z]);
	for (const c of cats.slice(before.cats)) c.tile = tile;
	for (const P of packs.slice(before.packs)) P.tile = tile;
}

// THE CATS (see the top)
function stepCat(c, dt) {
	const m = metre();
	c.going *= Math.exp(-dt * 6);
	if (c.state == 'scurry') {
		runTo(c, c.away, SCURRY, dt);
		if ((c.timer -= dt) <= 0) { c.state = 'sit'; c.timer = SIT[0]; rejoin(c); }
		return;
	}
	if (c.state == 'chase') {
		const r = rats.find((o) => o.id === c.prey);
		if (!r || (c.timer -= dt) <= 0) { c.state = 'walk'; c.prey = null; rejoin(c); return; }
		if (runTo(c, [r.x, r.z], CHASE, dt) < CATCH * m) {
			killRat(r, [Math.sin(c.heading), 0, Math.cos(c.heading)]);
			critterStats.caught++;
			c.state = 'eat'; c.timer = EAT; c.fullUntil = clock + FULL; c.prey = null;
		}
		return;
	}
	if (c.state == 'eat') { c.headDown += (1 - c.headDown) * Math.min(dt * 3, 1); if ((c.timer -= dt) <= 0) { c.state = 'walk'; c.headDown = 0; rejoin(c); } return; }
	// a rat in sight, and not full
	if (clock > c.fullUntil) {
		let best = null, bestD = SIGHT * m;
		for (const r of rats) { const d = Math.hypot(r.x - c.x, r.z - c.z); if (d < bestD) { bestD = d; best = r; } }
		if (best) { c.state = 'chase'; c.prey = best.id; c.timer = GIVE_UP; return; }
	}
	if (c.state == 'sit') { c.headDown += (0 - c.headDown) * Math.min(dt * 2, 1); if ((c.timer -= dt) <= 0) { c.state = 'walk'; c.timer = 8 + Math.random() * 25; } return; }
	// walking the streets (back to them first, after a chase)
	if (c.back) {
		const N = c.ways.nodes[c.to];
		if (runTo(c, [N.x, N.z], TROT, dt) < 0.2 * m) c.back = false;
		return;
	}
	streetStep(c, WALK, dt);
	if ((c.timer -= dt) <= 0) { c.state = 'sit'; c.timer = SIT[0] + Math.random() * (SIT[1] - SIT[0]); }
}
// a cat hit by anything (see the top): it scurries off from whoever did it
function scurry(c, from) {
	const m = metre(), a = from ? Math.atan2(c.x - from[0], c.z - from[2]) : Math.random() * 6.28;
	c.state = 'scurry'; c.timer = SCURRY_FOR; c.prey = null;
	c.away = [c.x + Math.sin(a) * SCURRY * SCURRY_FOR * m, c.z + Math.cos(a) * SCURRY * SCURRY_FOR * m];
	critterStats.scurried++;
}

// THE RATS (see the top)
function stepPack(P, dt) {
	const m = metre(), mine = rats.filter((r) => r.pack === P);
	P.going *= Math.exp(-dt * 6);
	// what would make them bolt: a cat near, or a player heard
	let danger = null;
	for (const c of cats) if (Math.hypot(c.x - P.x, c.z - P.z) < SPOOK_CAT * m) danger = [c.x, c.z];
	if (!danger && hearing.survivalMode()) { const L = hearing.heardBy(P.x, P.z, SPOOK_PLAYER * m); if (L) danger = [L.x, L.z]; }
	if (danger && !P.flee) { const a = Math.atan2(P.x - danger[0], P.z - danger[1]); P.flee = { to: [P.x + Math.sin(a) * 18 * m, P.z + Math.cos(a) * 18 * m], t: 4 }; if (P.ways) P.back = false; }
	if (P.flee) {
		if (runTo(P, P.flee.to, FLEE, dt) < 0.5 * m || (P.flee.t -= dt) <= 0) { P.flee = null; if (P.ways) rejoin(P); }
	} else if (P.ways) {
		if (P.back) { const N = P.ways.nodes[P.to]; if (runTo(P, [N.x, N.z], DART, dt) < 0.2 * m) P.back = false; }
		else if ((P.wait -= dt) <= 0) { streetStep(P, DART * 0.6, dt); if (Math.random() < dt * 0.15) P.wait = 2 + Math.random() * 6; }
	} else {
		if (!P.target || (P.wait -= dt) <= 0 && runTo(P, P.target, DART * 0.6, dt) < 0.5 * m) {
			if (!P.target || P.wait <= -0.01) { P.wait = 2 + Math.random() * 8; P.target = null; }
			for (let k = 0; k < 8 && !P.target; k++) { const a = Math.random() * 6.28, out = FIELD_WANDER * m * Math.sqrt(Math.random()), x = P.home[0] + Math.cos(a) * out, z = P.home[1] + Math.sin(a) * out; if (deer.walkable(x, z)) P.target = [x, z]; }
		}
	}
	// each darting about the middle of its pack, or running with it
	for (const r of mine) {
		r.going *= Math.exp(-dt * 6);
		if ((r.dart -= dt) <= 0) { r.dart = 0.4 + Math.random() * 1.6; const a = Math.random() * 6.28, out = (0.4 + Math.random() * 1.3) * m; r.spot = [Math.cos(a) * out, Math.sin(a) * out]; }
		const to = [P.x + r.spot[0], P.z + r.spot[1]];
		runTo(r, to, P.flee ? FLEE * 1.1 : Math.hypot(to[0] - r.x, to[1] - r.z) > 3 * m ? FLEE : DART, dt);
		r.headDown = r.going < 0.1 ? 0.6 : 0;
	}
}
function killRat(r, velocity = [0, 0, 0]) {
	const k = rats.indexOf(r);
	if (k < 0) return;
	rats.splice(k, 1);
	const side = velocity[0] * Math.cos(r.heading) - velocity[2] * Math.sin(r.heading) > 0 ? 1 : -1;
	corpses.push({ rat: r, t: 0, side });
	respawns.push({ at: clock + RESPAWN, pack: r.pack });
}
// shot or struck (ballistics.js), or a joiner says so (net.js): a rat dies; a cat scurries
export function hitCritter(id, velocity, part, round, who, from = null) {
	const r = rats.find((o) => o.id === id);
	if (r) { killRat(r, velocity ?? [0, 0, 0]); critterStats.shot++; return; }
	const c = cats.find((o) => o.id === id);
	if (c) scurry(c, from);
}

function advance(dt) {
	if (followed) { critterStats.cats = followed.filter((o) => o.kind != 'rat').length; critterStats.rats = followed.filter((o) => o.kind == 'rat' && o.alive).length; return; }
	if (!terrain.land || hidden()) return;
	if (terrain.land !== builtFor) build();
	clock += dt;
	for (const c of cats) stepCat(c, dt);
	for (const P of packs) stepPack(P, dt);
	for (const c of corpses) c.t += dt;
	corpses = corpses.filter((c) => c.t < (settings.gameMode == 'Hunting' ? LIE_SURVIVAL : LIE));
	for (let k = respawns.length - 1; k >= 0; k--) if (respawns[k].at <= clock) { const P = respawns.splice(k, 1)[0].pack; rats.push(newRat(P)); }
	critterStats.cats = cats.length; critterStats.rats = rats.length; critterStats.corpses = corpses.length;
}

// SHOT (see the top)
const spheresOf = (o) => {
	const m = metre(), c = Math.cos(o.heading), s = Math.sin(o.heading);
	return SPHERES[o.kind == 'rat' ? 'rat' : 'cat'].map(([x, y, z, r]) => [o.x + (x * c + z * s) * m, o.y + y * m, o.z + (z * c - x * s) * m, r * m]);
};
const aroundOf = (o) => [o.x, o.y + 0.15 * metre(), o.z, (o.kind == 'rat' ? 0.25 : 0.5) * metre()];
const living = () => followed ? followed.filter((o) => o.alive) : [...cats, ...rats];
ballistics.addTarget((ax, ay, az, bx, by, bz) => {
	if (hidden()) return null;
	const found = ballistics.crossAnimals(ax, ay, az, bx, by, bz, living(), spheresOf, aroundOf);
	return found && { t: found.t, what: found.animal.kind == 'rat' ? 'rat' : 'cat', hit: (velocity) => {
		if (followed) critterShot.report?.(found.animal.id, velocity ?? [0, 0, 0]);
		else hitCritter(found.animal.id, velocity, null, null, 'me', [ax, ay, az]);
	} };
}, () => { const out = []; if (!hidden()) for (const o of living()) out.push(...aroundOf(o)); return out; });

// A DEAD RAT: the one the eye is on (its id, or null), and what comes of cutting it up (the host's to say)
export function corpseInReach(eye, look, reach) {
	if (hidden()) return null;
	const list = followed ? followed.filter((o) => !o.alive) : corpses.map((c) => c.rat);
	let best = null, bestD = reach;
	for (const o of list) {
		const to = [o.x - eye[0], o.y + 0.05 * metre() - eye[1], o.z - eye[2]], d = Math.hypot(...to);
		if (d < bestD && (to[0] * look[0] + to[1] * look[1] + to[2] * look[2]) / (d || 1) > 0.7) { best = o; bestD = d; }
	}
	return best ? best.id : null;
}
export function harvest(id) {
	const k = corpses.findIndex((c) => c.rat.id == id);
	if (k < 0) return null;
	corpses.splice(k, 1);
	return ['ratMeat', 'smallBones'];
}

// MULTIPLAYER (see the top): [id, x, y, z, heading, stride, head down, going, kind (0 rat, 1 tabby, 2 black), 0, roll, alive]
const KIND_NUMBER = { rat: 0, tabby: 1, black: 2 }, NUMBER_KIND = ['rat', 'tabby', 'black'];
export function critterShare() {
	const out = [];
	for (const o of [...cats, ...rats]) out.push(o.id, o.x, o.y, o.z, o.heading, o.stride, o.headDown, o.going, KIND_NUMBER[o.kind], 0, 0, 1);
	for (const c of corpses) { const r = c.rat; out.push(r.id, r.x, r.y, r.z, r.heading, 0, 0, 0, 0, 0, c.side * 1.5, 0); }
	return new Float32Array(out);
}
export function critterFollow(records) {
	if (!records) { followed = null; return; }
	followed = [];
	for (let k = 0; k < records.length; k += 12) followed.push({ id: records[k], x: records[k + 1], y: records[k + 2], z: records[k + 3], heading: records[k + 4], stride: records[k + 5], headDown: records[k + 6], going: records[k + 7], kind: NUMBER_KIND[Math.round(records[k + 8])] ?? 'rat', roll: records[k + 10], alive: records[k + 11] > 0.5 });
}

// Once a frame: on they go, and drawn near the camera
let lastTime = performance.now();
const MODEL = { rat: 'rat', tabby: 'catTabby', black: 'catBlack' };
export function crittersUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.05);
	lastTime = now;
	if (!settings.enableCritters) return;
	advance(dt);
	if (hidden()) return;
	const m = metre(), reach = DRAW * m, cx = settings.camPosX, cz = settings.camPosZ;
	const show = (o, roll = 0) => {
		if (Math.abs(o.x - cx) > reach || Math.abs(o.z - cz) > reach) return;
		props.show(MODEL[o.kind], props.place([o.x, o.y + (roll ? 0.03 * m : 0), o.z], o.heading, 0, roll), undefined, undefined, [o.stride, roll ? 0 : Math.min(o.going * 1.3, 1.2), o.headDown, KIND[o.kind]]);
	};
	if (followed) for (const o of followed) show(o, o.alive ? 0 : o.roll);
	else { for (const o of cats) show(o); for (const o of rats) show(o); for (const c of corpses) show(c.rat, c.side * 1.5); }
}
// what a dead one is called (highlights.js)
export const deadSpots = () => (followed ? followed.filter((o) => !o.alive) : corpses.map((c) => c.rat)).map((o) => ({ at: [o.x, o.y + 0.4 * metre(), o.z], name: 'Dead rat (cut it up: hatchet or knife)' }));
// for testing
export const crittersForTest = () => ({ ...critterStats, cats: (followed ?? cats).filter((o) => o.kind != 'rat').map((o) => ({ id: o.id, kind: o.kind, x: o.x, z: o.z, state: o.state })), rats: (followed ?? rats).filter((o) => o.kind == 'rat' && (o.alive ?? true)).map((o) => ({ id: o.id, x: o.x, z: o.z })), packs: packs.length, corpses: corpses.map((c) => c.rat.id) });
export const catForTest = (id) => cats.find((o) => o.id === id);
export const ratForTest = (id) => rats.find((o) => o.id === id);
