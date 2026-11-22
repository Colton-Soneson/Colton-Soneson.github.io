import { DEPTH_FORMAT, depthTest } from './depthMode.js'
import { device, frameTexture, canvasFormat } from './deviceSelection.js'
import * as profiler from './profiler.js'
import { settings } from './settings.js';
import { vf_wildBirds } from '../shaders/js/vf_wildBirds.js'
import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as ballistics from './ballistics.js'
import * as forest from './forest.js'
import { addJob } from './jobs.js'
import { stepFor } from './rates.js'
import { woundFrom, otherWound, recordOf } from './anatomy.js'
import { skyViewLUTtexture } from './atmosphere.js'
import { uniformBufferLights } from './rotatingCube.js'
import { BIRD_KINDS, BIRD_MESHES, BIRD_FLOATS, GULL, OWL, DRAKE, HEN, LOON, SWAN, TOM, TURKEY_HEN } from './wildBirdShapes.js'

/*
	THE WILD BIRDS, round wherever the camera is (settings.enableWildBirds; settings.wildBirdNumbers more or fewer of them): looked
	for again (PLACES) once it has gone AGAIN from where they were last looked for, and let go further than KEEP from it.
		GULLS		a colony on the beach and one over every town near: wheeling over it, gliding with a few beats now and then, each in
					turn coming down to stand on the sand (or the street) or to sit on the water a while, then up again
		OWLS		one in a tree here and there in the forest, sat up against its trunk, its head turning (right round, as an owl's);
					at night now and then off to another tree, silent; and off at once from anyone who comes close
		WATERFOWL	on the lakes and the marshes: mallards (drakes and hens) dabbling, heads under, and up and off at once from anyone
					who comes close, round, and down on the water again; loons, low in the water, diving and coming up somewhere else;
					swans, paddling slowly, and away from anyone who comes close
		TURKEYS		a flock on the forest's edge or the grass by it, walking and pecking, a tom or two strutting with his tail fanned;
					running off from anyone who comes close
	SHOT (ballistics.js): each its kind's hitbox (wildBirdShapes.js: HITS), and the round's way through it (anatomy.js: its kind's,
	ANATOMY_OF), kept as its record for the inspection (inspect.js, F at it: corpseInReach, birdRecord). It falls (out of the air too),
	lies a while on its side (as long as a deer: in the Hunting mode a good while), sinks away, and RESPAWN_SECONDS later another joins its group. Each player's are their own (not sent in a game with others).
	DRAWN (vf_wildBirds.js): every kind's mesh as a range of one buffer, the birds sorted by kind, one draw each.
*/

const NEAR = 450;				// metres round the camera places for them are looked for in
const KEEP = 1000;				// metres: groups further than this are let go
const AGAIN = 220;				// metres the camera goes before more places are looked for
const SEEN = 600;				// metres: further than this from everyone they are moved on less often (rates.js)
const MAX_BIRDS = 600;
const INSTANCE_FLOATS = 16;		// place (4), pose (4), anim (4), extra (4): see vf_wildBirds.js
const RESPAWN_SECONDS = 120;
const LIE_SECONDS = 8, SINK_SECONDS = 3, HUNTING_LIE_SECONDS = 600;
const lieSeconds = () => settings.gameMode == 'Hunting' ? HUNTING_LIE_SECONDS : LIE_SECONDS;
export const ANATOMY_OF = [['gull'], ['owl'], ['mallard'], ['mallard'], ['loon'], ['swan'], ['turkey'], ['turkey']].map(([k]) => k);	// (each kind's in anatomy.js)
const SPOOK = { ducks: 18, swans: 14, turkeys: 22, owl: 12, gulls: 6 };	// metres: anyone nearer and they are off
const GRAVITY = 9.81;

export const wildBirdStats = { groups: 0, birds: 0, kinds: [], killed: 0, dead: 0, looks: 0 };

let groups = [], dead = [];
let centre = null, looking = false, birdLand = null, made = 0, seconds = 0, lastTime = performance.now();
let nextId = 1;
let retryAt = 0, tries = 0;				// (when to look again where the camera is, too few having been found: see lookFor)
const RETRY_SECONDS = 12;
const M = () => settings.forestUnitsPerMetre;
const sea = () => settings.waterWorldPosY;
const night = () => settings.sunPosY < 0;
const between = ([a, b]) => a + (b - a) * Math.random();
const wrap = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const sizeOf = (b) => M() * BIRD_KINDS[b.kind].size;
const wet = (x, z, deep = 0.3) => terrain.land.heightAt(x, z) < sea() - deep * M();
// (the exact ground, worked out again only once it has gone a little way: as the deer's)
function groundOf(b) {
	if (!b.ground || Math.hypot(b.x - b.ground.x, b.z - b.ground.z) > 0.4 * M()) b.ground = { x: b.x, z: b.z, y: terrain.land.groundAt(b.x, b.z) };
	return b.ground.y;
}
const surfaceAt = (x, z) => Math.max(terrain.land.groundAt(x, z), sea());
const camAway = (x, z) => Math.hypot(x - settings.camPosX, z - settings.camPosZ) / M();
function walkable(x, z) {
	if (!terrain.inWorld(x, z, 20) || wet(x, z, -0.05)) return false;
	const y = terrain.land.heightAt(x, z), s = 2 * M();
	return Math.abs(terrain.land.heightAt(x + s, z) - y) < 1.2 * s && Math.abs(terrain.land.heightAt(x, z + s) - y) < 1.2 * s;
}

function newBird(kind, x, y, z, more = {}) {
	return { id: nextId++, kind, x, y, z, heading: Math.random() * Math.PI * 2, pitch: 0, bank: 0, beat: Math.random() * 6.28, flap: 0, flapAmp: 0, spread: 0, swing: 0, stride: 0,
		headYaw: 0, headDown: 0, headWanted: 0, yawWanted: 0, headTimer: 0, onWater: 0, display: 0, tone: Math.random(), state: 'idle', timer: between([2, 8]), target: null, ...more };
}

// THE PLACES (see the top): looked for a step at a time (jobs.js), round where the camera is
function addGroup(type, x, z, more = {}) {
	const g = { type, home: { x, z }, birds: [], respawns: [], ...more };
	const m = M(), n = settings.wildBirdNumbers ?? 1;
	if (type == 'gulls') {
		const count = Math.max(1, Math.round(between([4, 8]) * n));
		g.y = surfaceAt(x, z);
		for (let k = 0; k < count; k++) g.birds.push(newGull(g));
	} else if (type == 'owl') {
		const b = newBird(OWL, x, 0, z);
		if (!perchOwl(b, x, z, 40)) return null;
		b.state = 'perch';
		g.birds.push(b);
	} else if (type == 'ducks' || type == 'loons' || type == 'swans') {
		const count = type == 'ducks' ? Math.round(between([3, 8]) * n) : type == 'loons' ? 1 + Math.round(Math.random() * n) : 2 + 2 * Math.floor(Math.random() * 1.6 * n);
		for (let k = 0; k < Math.max(1, count); k++) {
			const kind = type == 'ducks' ? (k % 2 ? HEN : DRAKE) : type == 'loons' ? LOON : SWAN;
			const at = wetNear(g.home, 12);
			const b = newBird(kind, at[0], 0, at[1], { state: 'swim', onWater: 1 });
			floatOn(b, 0);
			g.birds.push(b);
		}
	} else if (type == 'turkeys') {
		const count = Math.max(2, Math.round(between([4, 10]) * n));
		for (let k = 0; k < count; k++) {
			const px = x + (Math.random() - 0.5) * 10 * m, pz = z + (Math.random() - 0.5) * 10 * m;
			const b = newBird(k < 1 + count / 6 ? TOM : TURKEY_HEN, px, 0, pz, { state: 'graze' });
			b.y = groundOf(b);
			g.birds.push(b);
		}
		g.target = null; g.timer = 0;
	}
	groups.push(g);
	return g;
}
function newGull(g) {
	const m = M(), b = newBird(GULL, g.home.x, 0, g.home.z, { state: 'soar', spread: 1 });
	b.radius = between([18, 45]) * m; b.angle = Math.random() * Math.PI * 2; b.dir = Math.random() < 0.5 ? -1 : 1; b.height = between([12, 40]) * m;
	b.x = g.home.x + Math.cos(b.angle) * b.radius; b.z = g.home.z + Math.sin(b.angle) * b.radius; b.y = g.y + b.height;
	b.timer = between([20, 70]);
	return b;
}
// a branch of a tree near (x, z) for an owl: against the trunk, under the crown (a third to a half of the way up, 9 m at the most). false with none
function perchOwl(b, x, z, reach) {
	const m = M(), tree = forest.treeNear(x, z, reach * m);
	if (!tree || tree.height < 8) return false;
	const a = Math.random() * Math.PI * 2, out = 0.6 * m;
	b.perch = { x: tree.x + Math.sin(a) * out, y: terrain.land.groundAt(tree.x, tree.z) + Math.min(tree.height * between([0.35, 0.5]), 9) * m, z: tree.z + Math.cos(a) * out, heading: a };
	b.x = b.perch.x; b.y = b.perch.y; b.z = b.perch.z; b.heading = a;
	return true;
}
// somewhere on the water near a place
function wetNear(at, reach) {
	const m = M();
	for (let k = 0; k < 12; k++) {
		const a = Math.random() * Math.PI * 2, r = reach * m * Math.sqrt(Math.random());
		const x = at.x + Math.cos(a) * r, z = at.z + Math.sin(a) * r;
		if (wet(x, z)) return [x, z];
	}
	return [at.x, at.z];
}
function floatOn(b, t) {
	b.y = sea() - BIRD_KINDS[b.kind].FLOAT * sizeOf(b) + 0.012 * M() * Math.sin(t * 1.7 + b.tone * 9);
}

function* lookFor(cx, cz, ticket) {
	const land = terrain.land, m = M(), R = NEAR * m, n = settings.wildBirdNumbers ?? 1, near = [cx, cz];
	const free = (x, z, apart) => groups.every((g) => Math.hypot(g.home.x - x, g.home.z - z) > apart * m);
	const live = () => ticket === made && birdLand === terrain.land;
	// (as many as wanted of the spots, each far enough from every group there is: the first that are)
	//		(less those of the sort already near. Too few found (the forest's trees not in yet, for an owl): looked for again soon)
	const already = (types) => groups.filter((g) => types.includes(g.type) && Math.hypot(g.home.x - cx, g.home.z - cz) < R).length;
	const place = (spots, want, apart, type, types) => {
		let n = already(types);
		for (const s of spots) { if (n >= want) break; if (free(s.x, s.z, apart) && addGroup(type(n), s.x, s.z)) n++; }
		if (n < want && spots.length && tries < 5) retryAt = seconds + RETRY_SECONDS;
	};
	// the gulls: the beaches near, and every town
	place(land.findSpawnPoints(terrain.ZONE_BEACH, 8, { seed: 71, near, radius: R, minSpacing: 140 * m }), Math.max(1, Math.round(2 * n)), 160, () => 'gulls', ['gulls']);
	yield; if (!live()) return;
	for (const { land: one } of terrain.landsHere?.() ?? [{ land }]) for (const t of one.towns ?? []) {
		if (t.site && Math.hypot(t.site.x - cx, t.site.z - cz) < 1.6 * R && free(t.site.x, t.site.z, 120)) addGroup('gulls', t.site.x, t.site.z, { town: true });
	}
	yield; if (!live()) return;
	// the owls, in the forest
	place(land.findSpawnPoints(terrain.ZONE_FOREST, 12, { seed: 73, near, radius: 0.8 * R, minSpacing: 120 * m }), Math.max(1, Math.round(2 * n)), 100, () => 'owl', ['owl']);
	yield; if (!live()) return;
	// the waterfowl, on the lakes and the marshes (water at the sea's level): ducks, loons and swans in turn
	const waters = [terrain.ZONE_LAKE, terrain.ZONE_MARSH].flatMap((zone) => land.findSpawnPoints(zone, 12, { seed: 75 + zone, near, radius: R, minSpacing: 70 * m })).filter((s) => wet(s.x, s.z, 0.4));
	const types = ['ducks', 'loons', 'swans'], first = Math.floor(Math.random() * types.length);
	place(waters, Math.max(1, Math.round(3 * n)), 60, (k) => types[(first + k) % types.length], types);
	yield; if (!live()) return;
	// the turkeys: the forest's edges and the grass
	const fields = [terrain.ZONE_GRASSLAND, terrain.ZONE_FOREST].flatMap((zone) => land.findSpawnPoints(zone, 6, { seed: 79 + zone, near, radius: R, minSpacing: 200 * m, maxSlope: 0.3 })).filter((s) => walkable(s.x, s.z));
	fields.sort(() => Math.random() - 0.5);
	place(fields, Math.max(1, Math.round(1.5 * n)), 200, () => 'turkeys', ['turkeys']);
	wildBirdStats.looks++;
}
function lookAround() {
	const m = M(), cx = settings.camPosX, cz = settings.camPosZ;
	if (centre && Math.hypot(cx - centre[0], cz - centre[1]) < AGAIN * m && !(retryAt && seconds >= retryAt)) return;
	if (looking) return;
	tries = centre && Math.hypot(cx - centre[0], cz - centre[1]) < AGAIN * m ? tries + 1 : 0;
	centre = [cx, cz];
	retryAt = 0;
	groups = groups.filter((g) => Math.hypot(g.home.x - cx, g.home.z - cz) < KEEP * m);
	looking = true;
	const ticket = made;
	addJob('the wild birds round ' + Math.round(cx) + ',' + Math.round(cz), function* () { try { yield* lookFor(cx, cz, ticket); } finally { looking = false; } });
}

// HOW THEY MOVE
// in the air, towards a point: turning at most TURN a second, climbing or coming down at most CLIMB, banked into its turns
const TURN = 1.4, CLIMB = 3.5;
function flyToward(b, tx, ty, tz, speed, dt) {
	const m = M(), want = Math.atan2(tx - b.x, tz - b.z), turn = Math.max(Math.min(wrap(want - b.heading), TURN * dt), -TURN * dt);
	b.heading = wrap(b.heading + turn);
	b.x += Math.sin(b.heading) * speed * dt; b.z += Math.cos(b.heading) * speed * dt;
	const dy = Math.max(Math.min(ty - b.y, CLIMB * m * dt), -CLIMB * m * dt);
	b.y += dy;
	b.bank += (-turn / Math.max(dt, 1e-4) * 0.35 - b.bank) * Math.min(dt * 3, 1);
	b.pitch += (Math.atan2(dy / Math.max(dt, 1e-4), speed) - b.pitch) * Math.min(dt * 3, 1);
	return Math.hypot(tx - b.x, ty - b.y, tz - b.z);
}
// wings: spread (out) or folded, and beating (amp radians up and down, beats a second)
function wingsOf(b, out, amp, rate, dt) {
	b.spread += ((out ? 1 : 0) - b.spread) * Math.min(dt * (out ? 6 : 3), 1);
	b.flapAmp += (amp - b.flapAmp) * Math.min(dt * 4, 1);
	b.beat += rate * Math.PI * 2 * dt;
	b.flap = b.flapAmp * Math.sin(b.beat) + (out ? 0.06 : 0);
}
// on foot (or paddling), towards a point: the distance left
function walkToward(b, tx, tz, speed, dt, stride = 0.3) {
	const m = M(), d = Math.hypot(tx - b.x, tz - b.z);
	if (d < 0.05 * m) { b.swing *= 0.8; return d; }
	const want = Math.atan2(tx - b.x, tz - b.z);
	b.heading = wrap(b.heading + Math.max(Math.min(wrap(want - b.heading), 3 * dt), -3 * dt));
	const go = Math.min(speed * dt, d);
	b.x += Math.sin(b.heading) * go; b.z += Math.cos(b.heading) * go;
	b.stride += go / (stride * BIRD_KINDS[b.kind].size * m) * Math.PI;
	b.swing = 0.5 * Math.sin(b.stride);
	return d - go;
}
function settle(b, dt) {
	b.bank *= Math.max(1 - dt * 4, 0); b.pitch *= Math.max(1 - dt * 4, 0);
}
// the head: now and then turned and bent, as each kind does
function headOf(b, dt, { yaw = 0.8, down = 0.6, quick = 3, often = [2, 6] } = {}) {
	b.headTimer -= dt;
	if (b.headTimer <= 0) {
		b.yawWanted = (Math.random() * 2 - 1) * yaw;
		b.headWanted = Math.random() < down ? 1 : 0;
		b.headTimer = between(often);
	}
	b.headYaw += (b.yawWanted - b.headYaw) * Math.min(dt * quick, 1);
	b.headDown += (b.headWanted - b.headDown) * Math.min(dt * quick, 1);
}

function gullsMove(g, dt) {
	const m = M();
	for (const b of g.birds) {
		b.timer -= dt;
		if (b.state == 'soar') {
			b.angle += b.dir * 10 * m / b.radius * dt;
			const ahead = b.angle + b.dir * 0.35;
			flyToward(b, g.home.x + Math.cos(ahead) * b.radius, g.y + b.height + 5 * m * Math.sin(seconds * 0.3 + b.tone * 7), g.home.z + Math.sin(ahead) * b.radius, 10 * m, dt);
			wingsOf(b, true, Math.sin(seconds * 0.5 + b.tone * 11) > 0.55 ? 0.55 : 0.04, 2.6, dt);
			b.onWater = 0;
			if (b.timer <= 0) {
				// down: the sand or the street by its home, or the water
				let spot = null;
				for (let k = 0; k < 10 && !spot; k++) {
					const a = Math.random() * Math.PI * 2, r = between([4, 40]) * m, x = g.home.x + Math.cos(a) * r, z = g.home.z + Math.sin(a) * r;
					if (terrain.inWorld(x, z, 20) && (wet(x, z) || walkable(x, z))) spot = { x, z, water: wet(x, z, 0.1) };
				}
				if (spot) { b.state = 'down'; b.target = spot; spot.y = spot.water ? sea() : terrain.land.groundAt(spot.x, spot.z); }
				else b.timer = 20;
			}
		} else if (b.state == 'down') {
			const t = b.target, left = Math.hypot(t.x - b.x, t.z - b.z);
			flyToward(b, t.x, t.y + Math.min(left * 0.4, 25 * m), t.z, Math.max(Math.min(left * 0.6, 9 * m), 2 * m), dt);
			wingsOf(b, true, left < 6 * m ? 0.7 : 0.05, 3.5, dt);
			if (left < 0.6 * m && Math.abs(b.y - t.y) < 1.2 * m) { b.state = 'rest'; b.timer = between([15, 60]); b.onWater = t.water ? 1 : 0; }
		} else if (b.state == 'rest') {
			wingsOf(b, false, 0, 0, dt);
			settle(b, dt);
			headOf(b, dt, { yaw: 1.0, down: b.onWater ? 0.1 : 0.35, quick: 4 });
			if (b.onWater) floatOn(b, seconds); else b.y = groundOf(b);
			if (b.timer <= 0 || camAway(b.x, b.z) < SPOOK.gulls) { b.state = 'up'; b.timer = 3; b.angle = Math.atan2(b.z - g.home.z, b.x - g.home.x); b.headDown = 0; b.onWater = 0; }
		} else if (b.state == 'up') {
			b.y += 3 * m * dt;
			b.x += Math.sin(b.heading) * 5 * m * dt; b.z += Math.cos(b.heading) * 5 * m * dt;
			wingsOf(b, true, 0.8, 3.5, dt);
			if (b.timer <= 0) { b.state = 'soar'; b.timer = between([25, 80]); }
		}
	}
}

function owlMove(g, dt) {
	const m = M();
	for (const b of g.birds) {
		b.timer -= dt;
		if (b.state == 'perch') {
			wingsOf(b, false, 0, 0, dt);
			settle(b, dt);
			headOf(b, dt, { yaw: 2.6, down: 0.25, quick: 6, often: [1.5, 5] });
			b.x = b.perch.x; b.y = b.perch.y; b.z = b.perch.z;
			b.heading += wrap(b.perch.heading - b.heading) * Math.min(dt * 3, 1);
			const flush = camAway(b.x, b.z) < SPOOK.owl && Math.abs(settings.camPosY - b.y) < 15 * m;
			if (flush || (night() && b.timer <= 0)) {
				const from = { ...b.perch }, prior = { x: b.x, y: b.y, z: b.z };
				const a = Math.random() * Math.PI * 2, r = between([30, 90]);
				if (perchOwl(b, from.x + Math.cos(a) * r * m, from.z + Math.sin(a) * r * m, 30)) {
					b.state = 'fly'; b.x = prior.x; b.y = prior.y; b.z = prior.z; b.headYaw = 0; b.yawWanted = 0; b.headDown = 0;
				}
				b.timer = between([40, 140]);
			}
		} else if (b.state == 'fly') {
			const p = b.perch, left = Math.hypot(p.x - b.x, p.z - b.z);
			flyToward(b, p.x, p.y + Math.min(left * 0.3, 6 * m), p.z, Math.max(Math.min(left, 8 * m), 1.5 * m), dt);
			wingsOf(b, true, left < 4 * m ? 0.8 : (Math.sin(seconds * 1.3 + b.tone * 5) > 0 ? 0.55 : 0.05), 2.2, dt);
			if (left < 0.5 * m) { b.state = 'perch'; b.timer = between([40, 140]); }
		}
	}
}

function waterfowlMove(g, dt) {
	const m = M();
	for (const b of g.birds) {
		b.timer -= dt;
		const K = b.kind, swan = K == SWAN, loon = K == LOON, duck = K == DRAKE || K == HEN;
		const near = camAway(b.x, b.z) < (swan ? SPOOK.swans : SPOOK.ducks);
		if (b.state == 'swim') {
			wingsOf(b, false, 0, 0, dt);
			settle(b, dt);
			b.onWater = 1;
			floatOn(b, seconds);
			if (!b.target || b.timer <= 0) { b.target = wetNear(g.home, swan ? 35 : 25); b.timer = between([8, 25]); }
			let [tx, tz] = b.target;
			if (near && swan) { const a = Math.atan2(b.x - settings.camPosX, b.z - settings.camPosZ); tx = b.x + Math.sin(a) * 10 * m; tz = b.z + Math.cos(a) * 10 * m; if (!wet(tx, tz)) [tx, tz] = b.target; }
			const pace = (swan ? 0.45 : loon ? 0.4 : 0.3) * (near ? 2.2 : 1) * m;
			if (walkToward(b, tx, tz, pace, dt, 0.15) < 0.3 * m && !near) headOf(b, dt, { yaw: 0.7, down: duck ? 0.45 : swan ? 0.3 : 0.1, quick: 2, often: [2, 7] });
			else { b.headDown += (0 - b.headDown) * Math.min(dt * 3, 1); b.headYaw *= 0.95; }
			b.swing = 0;
			if (loon && (b.dives ??= between([25, 70])) && (b.dives -= dt) <= 0) { b.state = 'dive'; b.hidden = true; b.timer = between([10, 22]); b.dives = undefined; }
			if (duck && near) {
				// up and away: round, and down on the water again somewhere else near
				const a = Math.atan2(b.x - settings.camPosX, b.z - settings.camPosZ) + (Math.random() - 0.5);
				b.state = 'flee'; b.target = [b.x + Math.sin(a) * 120 * m, b.z + Math.cos(a) * 120 * m]; b.climb = sea() + between([10, 20]) * m; b.timer = between([8, 14]); b.onWater = 0; b.heading = a;
			}
		} else if (b.state == 'dive') {
			if (b.timer <= 0) { const at = wetNear({ x: b.x, z: b.z }, 30); b.x = at[0]; b.z = at[1]; b.state = 'swim'; b.hidden = false; b.timer = between([5, 15]); }
		} else if (b.state == 'flee') {
			flyToward(b, b.target[0], b.climb, b.target[1], 14 * m, dt);
			wingsOf(b, true, 0.75, 6, dt);
			if (b.timer <= 0) { const at = wetNear(g.home, 40); b.state = 'land'; b.target = [at[0], at[1]]; }
		} else if (b.state == 'land') {
			const [tx, tz] = b.target, left = Math.hypot(tx - b.x, tz - b.z);
			flyToward(b, tx, sea() + Math.min(left * 0.25, 18 * m), tz, Math.max(Math.min(left * 0.5, 14 * m), 3 * m), dt);
			wingsOf(b, true, left < 10 * m ? 0.4 : 0.7, 6, dt);
			if (left < 1 * m) { b.state = 'swim'; b.timer = between([5, 15]); b.target = null; }
			else if (left < 30 * m && camAway(tx, tz) < SPOOK.ducks) b.target = wetNear(g.home, 60);
		}
	}
}

function turkeysMove(g, dt) {
	const m = M();
	g.timer -= dt;
	const lead = g.birds[0];
	if (!lead) return;
	const near = g.birds.some((b) => camAway(b.x, b.z) < SPOOK.turkeys);
	if (near && g.state != 'run') {
		const a = Math.atan2(lead.x - settings.camPosX, lead.z - settings.camPosZ);
		g.state = 'run'; g.timer = 6; g.target = [lead.x + Math.sin(a) * 40 * m, lead.z + Math.cos(a) * 40 * m];
	}
	if (!g.target || g.timer <= 0) {
		g.state = g.state == 'walk' ? 'graze' : 'walk'; g.timer = g.state == 'walk' ? between([8, 20]) : between([10, 30]);
		if (g.state == 'walk') for (let k = 0; k < 10; k++) {
			const a = Math.random() * Math.PI * 2, r = 50 * m * Math.sqrt(Math.random()), x = g.home.x + Math.cos(a) * r, z = g.home.z + Math.sin(a) * r;
			if (walkable(x, z)) { g.target = [x, z]; break; }
		}
		if (!g.target) g.target = [g.home.x, g.home.z];
	}
	g.birds.forEach((b, i) => {
		b.timer -= dt;
		wingsOf(b, false, 0, 0, dt);
		settle(b, dt);
		const off = i == 0 ? [0, 0] : [Math.sin(i * 2.4) * (1.5 + i * 0.6) * m, Math.cos(i * 2.4) * (1.5 + i * 0.6) * m];
		const [tx, tz] = [g.target[0] + off[0], g.target[1] + off[1]];
		if (g.state == 'run') {
			walkToward(b, tx, tz, 4 * m, dt, 0.35);
			b.headDown += (0 - b.headDown) * Math.min(dt * 5, 1); b.display = Math.max(b.display - dt * 2, 0);
		} else if (g.state == 'walk' && Math.hypot(tx - b.x, tz - b.z) > 1.5 * m) {
			walkToward(b, tx, tz, 0.7 * m, dt, 0.3);
			b.headDown += (0 - b.headDown) * Math.min(dt * 3, 1); b.display = Math.max(b.display - dt * 1.5, 0);
		} else {
			b.swing *= 0.85;
			// pecking: the head down and up quickly, a few times, now and then. A tom struts, his tail fanned
			headOf(b, dt, { yaw: 0.9, down: 0.55, quick: 7, often: [0.4, 2.5] });
			if (b.kind == TOM) {
				if (b.timer <= 0) { b.strut = !b.strut && Math.random() < 0.5; b.timer = b.strut ? between([8, 16]) : between([15, 40]); }
				b.display += ((b.strut ? 1 : 0) - b.display) * Math.min(dt * 2, 1);
				if (b.strut) { b.headDown = 0; b.headWanted = 0; }
			}
		}
		b.y = groundOf(b);
	});
}

// SHOT (see the top)
function spheresOf(b) {
	const K = BIRD_KINDS[b.kind], s = sizeOf(b), c = Math.cos(b.heading), n = Math.sin(b.heading);
	return K.HITS.map(([x, y, z, r]) => [b.x + (x * c + z * n) * s, b.y + y * s, b.z + (z * c - x * n) * s, r * s]);
}
const aroundOf = (b) => [b.x, b.y + 0.4 * sizeOf(b), b.z, 1.3 * sizeOf(b)];
const living = () => groups.flatMap((g) => g.birds.filter((b) => !b.hidden));
ballistics.addTarget((ax, ay, az, bx, by, bz) => {
	if (!settings.enableWildBirds) return null;
	const found = ballistics.crossAnimals(ax, ay, az, bx, by, bz, living(), spheresOf, aroundOf);
	return found && { t: found.t, what: BIRD_KINDS[found.animal.kind].name, hit: (velocity, bullet) => shoot(found.animal, velocity, bullet) };
}, () => {
	const list = [];
	if (settings.enableWildBirds) for (const b of living()) list.push(...aroundOf(b));
	return list;
});
function shoot(b, velocity, bullet = null) {
	const g = groups.find((one) => one.birds.includes(b));
	if (!g) return;
	const wound = bullet ? woundFrom(ANATOMY_OF[b.kind], bullet, [b.x, b.y, b.z], b.heading, sizeOf(b)) : otherWound('maul');
	b.record = recordOf(ANATOMY_OF[b.kind], [wound], 0, { species: b.kind, size: BIRD_KINDS[b.kind].size, buck: b.kind == DRAKE || b.kind == TOM });
	g.birds.splice(g.birds.indexOf(b), 1);
	g.respawns.push(seconds + RESPAWN_SECONDS);
	const speed = Math.hypot(...velocity) || 1, push = 3 * M() / speed;
	b.vx = velocity[0] * push; b.vy = Math.max(velocity[1] * push, 0); b.vz = velocity[2] * push;
	b.dead = 0; b.falling = true; b.flapAmp = 0; b.display = 0;
	dead.push(b);
	wildBirdStats.killed++;
}
function deadMove(dt) {
	const m = M();
	for (const b of dead) {
		b.dead += dt;
		if (b.falling) {
			b.vy -= GRAVITY * m * dt;
			b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
			b.vx *= Math.exp(-dt); b.vz *= Math.exp(-dt);
			b.spread += (0.4 - b.spread) * Math.min(dt * 3, 1);
			b.bank += 3 * dt;
			const water = wet(b.x, b.z, 0.1), surface = water ? sea() - 0.5 * BIRD_KINDS[b.kind].FLOAT * sizeOf(b) : terrain.land.groundAt(b.x, b.z);
			if (b.y <= surface) { b.y = surface; b.falling = false; b.dead = 0; b.onWater = water ? 1 : 0; }
		} else {
			b.bank += (1.35 - b.bank) * Math.min(dt * 4, 1);
			b.spread += (0.25 - b.spread) * Math.min(dt * 2, 1);
			b.pitch *= 0.9; b.flap = 0; b.headDown = 0.3;
			if (b.dead > lieSeconds()) b.y -= 0.35 * sizeOf(b) / SINK_SECONDS * dt;
		}
	}
	dead = dead.filter((b) => b.falling || b.dead < lieSeconds() + SINK_SECONDS);
}
function respawnIn(g) {
	while (g.respawns.length && g.respawns[0] <= seconds) {
		g.respawns.shift();
		if (g.type == 'gulls') g.birds.push(newGull(g));
		else if (g.type == 'owl') { const b = newBird(OWL, g.home.x, 0, g.home.z, { state: 'perch' }); if (perchOwl(b, g.home.x, g.home.z, 60)) g.birds.push(b); }
		else if (g.type == 'turkeys') { const b = newBird(Math.random() < 0.25 ? TOM : TURKEY_HEN, g.home.x, 0, g.home.z, { state: 'graze' }); b.y = groundOf(b); g.birds.push(b); }
		else {
			const kind = g.type == 'ducks' ? (Math.random() < 0.5 ? DRAKE : HEN) : g.type == 'loons' ? LOON : SWAN, at = wetNear(g.home, 15);
			const b = newBird(kind, at[0], 0, at[1], { state: 'swim', onWater: 1 }); floatOn(b, seconds); g.birds.push(b);
		}
	}
}

function advance(elapsed) {
	seconds += elapsed;
	if (!settings.enableWildBirds || !terrain.land) { groups = []; dead = []; centre = null; return; }
	if (birdLand !== terrain.land) { birdLand = terrain.land; groups = []; dead = []; centre = null; retryAt = 0; made++; }
	lookAround();
	for (const g of groups) {
		const at = g.birds[0] ?? g.home;
		const dt = stepFor(g, at.x, at.z, elapsed, SEEN * M());
		if (!dt) continue;
		respawnIn(g);
		if (g.type == 'still') continue;		// (a test's: put there, not moved)
		if (g.type == 'gulls') gullsMove(g, dt);
		else if (g.type == 'owl') owlMove(g, dt);
		else if (g.type == 'turkeys') turkeysMove(g, dt);
		else waterfowlMove(g, dt);
	}
	deadMove(elapsed);
	wildBirdStats.groups = groups.length;
	wildBirdStats.birds = groups.reduce((sum, g) => sum + g.birds.length, 0);
	wildBirdStats.kinds = BIRD_KINDS.map((_, k) => groups.reduce((sum, g) => sum + g.birds.filter((b) => b.kind == k).length, 0));
	wildBirdStats.types = ['gulls', 'owl', 'ducks', 'loons', 'swans', 'turkeys'].map((t) => groups.filter((g) => g.type == t).length);
	wildBirdStats.dead = dead.length;
}
export function wildBirdsUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.05);
	lastTime = now;
	advance(elapsed);
}
// for testing: moved on by a number of seconds
export function simulateWildBirds(total) { for (let done = 0; done < total; done += 0.05) advance(0.05); }
export const wildBirdGroupsForTest = () => groups;
export const wildBirdsDeadForTest = () => dead;
// THE INSPECTION (inspect.js): the dead one the eye (world units) is on, looking along look, within reach: { kind (anatomy.js's), id }, or null
export function corpseInReach(eye, look, reach) {
	if (!settings.enableWildBirds) return null;
	let best = null, bestD = reach;
	for (const b of dead) {
		if (b.falling || !b.record) continue;
		const to = [b.x - eye[0], b.y + 0.2 * sizeOf(b) - eye[1], b.z - eye[2]], d = Math.hypot(...to);
		if (d < bestD && (to[0] * look[0] + to[1] * look[1] + to[2] * look[2]) / (d || 1) > 0.7) { best = b; bestD = d; }
	}
	return best ? { kind: ANATOMY_OF[best.kind], id: best.id } : null;
}
export const birdRecord = (id) => dead.find((b) => b.id === id)?.record ?? null;
export const addGroupForTest = (type, x, z) => addGroup(type, x, z);

// THE DRAWING
const shaderModule = device.createShaderModule({ label: "vf_wildBirds", code: vf_wildBirds });
const meshBuffer = device.createBuffer({ label: "wild bird meshes", size: BIRD_MESHES.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(meshBuffer, 0, BIRD_MESHES.data);
const instanceData = new Float32Array(MAX_BIRDS * INSTANCE_FLOATS);
const instanceBuffer = device.createBuffer({ label: "wild bird instances", size: instanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
const uniformBuffer = device.createBuffer({ label: "wild birds uniform", size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const pipeline = device.createRenderPipeline({
	label: "wild birds pipeline",
	layout: 'auto',
	vertex: {
		module: shaderModule,
		entryPoint: "vertexMain",
		buffers: [
			{ arrayStride: BIRD_FLOATS * 4, attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }, { format: "float32x4", offset: 16, shaderLocation: 1 }] },
			{ arrayStride: INSTANCE_FLOATS * 4, stepMode: 'instance', attributes: [0, 1, 2, 3].map((k) => ({ format: "float32x4", offset: k * 16, shaderLocation: 2 + k })) },
		],
	},
	fragment: { module: shaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: depthTest('less'), format: DEPTH_FORMAT },
});

export function wildBirdsPass(aEncoder, mainpassDepthTexture) {
	if (!settings.enableWildBirds) return;
	const drawn = [...groups.flatMap((g) => g.birds.filter((b) => !b.hidden)), ...dead].slice(0, MAX_BIRDS);
	if (!drawn.length) return;
	// (in order of kind: one draw a kind, its mesh's range)
	const counts = new Array(BIRD_KINDS.length).fill(0);
	for (const b of drawn) counts[b.kind]++;
	const starts = counts.map((_, k) => counts.slice(0, k).reduce((a, c) => a + c, 0)), next = starts.slice();
	for (const b of drawn) {
		const head = b.kind == SWAN ? Math.max(b.headDown, 0.62 * b.spread) : b.headDown;		// (a swan flies with its neck out in front)
		instanceData.set([b.x, b.y, b.z, sizeOf(b), b.heading, b.pitch, b.bank, b.flap, b.spread, b.swing, b.headYaw, head, b.kind, b.onWater, b.display, b.tone], next[b.kind]++ * INSTANCE_FLOATS);
	}
	device.queue.writeBuffer(instanceBuffer, 0, instanceData, 0, drawn.length * INSTANCE_FLOATS);
	const u = new Float32Array([...transformations.getViewProj(), settings.camPosX, settings.camPosY, settings.camPosZ, 0, settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, 0, 0]);
	device.queue.writeBuffer(uniformBuffer, 0, u.buffer, u.byteOffset, u.byteLength);
	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{ view: frameTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Wild Birds', 'vf_wildBirds'),
	});
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, device.createBindGroup({
		label: "wild birds bind group",
		layout: pipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: { buffer: uniformBufferLights } },
			{ binding: 2, resource: skyViewLUTtexture.createView() },
			{ binding: 3, resource: linSampler },
		],
	}));
	pass.setVertexBuffer(0, meshBuffer);
	pass.setVertexBuffer(1, instanceBuffer);
	BIRD_KINDS.forEach((K, k) => { if (counts[k]) pass.draw(BIRD_MESHES.ranges[k][1], counts[k], BIRD_MESHES.ranges[k][0], starts[k]); });
	pass.end();
}
