import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as props from './props.js'
import { seededRandom } from './terrainGenerator.js'

/*
	THE FISH: six kinds (KINDS), two in the ponds and four in the sea, each model under 40 triangles (creatureMeshes.js). They go about in schools.
		A SCHOOL has a leader, wandering from place to place in water of its own (a pond's, or the sea's, deep enough, and for the sea's near enough to the land to be met with). It lives on the
		host, which sends it with the animals (net.js: fishShare, fishFollow), so everyone has the same schools in the same places.
		ITS FISH are worked out on each machine, for the schools near its camera (NEAR): BOIDS, each fish steering by the others in its school within SIGHT: away from the ones too close
		(separation), the way they are going (alignment), and in towards their middle (cohesion), and all of them after the leader. Between the sea bed and the surface, and they
		turn away from ground ahead too shallow. Nothing depends on where one fish is, so they do not have to be the same on every machine, only the school.
	In metres and seconds (their places world units).
*/
const KINDS = [
	{ name: 'trout', model: 'fishTrout', water: 'pond', length: 0.36, count: [5, 9], pace: 0.9, schools: 8 },
	{ name: 'carp', model: 'fishCarp', water: 'pond', length: 0.5, count: [3, 7], pace: 0.5, schools: 8 },
	{ name: 'herring', model: 'fishHerring', water: 'sea', length: 0.26, count: [12, 20], pace: 1.4, schools: 10 },
	{ name: 'mackerel', model: 'fishMackerel', water: 'sea', length: 0.36, count: [8, 14], pace: 1.8, schools: 8 },
	{ name: 'cod', model: 'fishCod', water: 'sea', length: 0.75, count: [3, 6], pace: 0.8, schools: 6 },
	{ name: 'tuna', model: 'fishTuna', water: 'sea', length: 1.5, count: [2, 5], pace: 3.0, schools: 4 },
];
const NEAR = 130;					// metres from the camera the fish of a school are made
const WANDER = 70;					// metres a leader goes at a time
const SEA_DEEP = [5, 45];			// metres of water a sea school keeps to
const POND_DEEP = 0.9;
const SIGHT = 3;					// body lengths a fish sees the others
const CROWD = 1.2;					// body lengths it wants between it and the next
const WEIGHTS = { apart: 2.6, along: 1.0, together: 0.7, leader: 0.9, depth: 3 };
const DRAW_MOST = 600;

const metre = () => settings.forestUnitsPerMetre;
export const fishStats = { schools: 0, fish: 0 };
let schools = [], builtFor = null, nextId = 1;
let followed = null;				// joiner: the host's schools as they are now
const live = new Map();				// school's id -> its fish, on this machine

const surface = () => settings.waterWorldPosY;
const depthAt = (x, z) => (surface() - terrain.land.heightAt(x, z)) / metre();
const inWater = (K, x, z) => {
	const d = depthAt(x, z), zone = terrain.land.zoneAt(x, z);
	return K.water == 'pond' ? zone == terrain.ZONE_LAKE && d > POND_DEEP : zone == terrain.ZONE_OCEAN && d > SEA_DEEP[0] && d < SEA_DEEP[1];
};
function build() {
	builtFor = terrain.land;
	schools = [];
	const half = settings.terrainWorldSize * 0.5 - 40;
	KINDS.forEach((K, k) => {
		const zone = K.water == 'pond' ? terrain.ZONE_LAKE : terrain.ZONE_OCEAN;
		const spots = terrain.land.findSpawnPoints(zone, K.schools * 12, { seed: 300 + k * 13, minSpacing: K.water == 'pond' ? 30 : 120 }) ?? [];
		for (const s of spots) {
			if (schools.filter((o) => o.kind == k).length >= K.schools) break;
			if (Math.abs(s.x) > half || Math.abs(s.z) > half || !inWater(K, s.x, s.z)) continue;
			schools.push({ id: nextId++, kind: k, x: s.x, z: s.z, y: surface() - metre(), heading: Math.random() * 6.28, target: null });
		}
	});
}
function moveLeaders(dt) {
	const m = metre();
	for (const S of schools) {
		const K = KINDS[S.kind];
		if (!S.target || Math.hypot(S.target[0] - S.x, S.target[1] - S.z) < 3 * m) {
			S.target = null;
			for (let k = 0; k < 8 && !S.target; k++) {
				const a = Math.random() * 6.28, out = WANDER * m * (0.3 + 0.7 * Math.random()), x = S.x + Math.sin(a) * out, z = S.z + Math.cos(a) * out;
				if (inWater(K, x, z) && inWater(K, (x + S.x) / 2, (z + S.z) / 2)) S.target = [x, z];
			}
			if (!S.target) { S.heading += 0.5; continue; }
		}
		const want = Math.atan2(S.target[0] - S.x, S.target[1] - S.z);
		let off = want - S.heading;
		off -= Math.PI * 2 * Math.round(off / (Math.PI * 2));
		S.heading += off * Math.min(dt, 1);
		const nx = S.x + Math.sin(S.heading) * K.pace * m * dt, nz = S.z + Math.cos(S.heading) * K.pace * m * dt;
		if (inWater(K, nx, nz)) { S.x = nx; S.z = nz; } else S.target = null;
		// (about half way down: never right on the bed or the surface)
		const depth = Math.max(depthAt(S.x, S.z), 0.5);
		S.y += (surface() - Math.min(depth * 0.5, 8) * m - S.y) * Math.min(dt, 1);
	}
}

// ITS FISH (see the top)
function schoolFish(S) {
	let list = live.get(S.id);
	if (!list) {
		const K = KINDS[S.kind], random = seededRandom(S.id * 977 + 13), m = metre(), n = K.count[0] + Math.floor(random() * (K.count[1] - K.count[0] + 1));
		const spread = K.length * 3 * m;
		list = Array.from({ length: n }, () => ({ x: S.x + (random() - 0.5) * spread, y: S.y + (random() - 0.5) * spread * 0.4, z: S.z + (random() - 0.5) * spread, v: [Math.sin(S.heading) * K.pace * m, 0, Math.cos(S.heading) * K.pace * m], swim: random() * 6.28, own: 0.85 + 0.3 * random() }));
		live.set(S.id, list);
	}
	return list;
}
function boids(S, list, dt) {
	const K = KINDS[S.kind], m = metre(), L = K.length * m, sight = SIGHT * L, crowd = CROWD * L, most = K.pace * 1.6 * m;
	const low = () => terrain.land;
	for (const f of list) {
		let ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0, seen = 0;
		for (const o of list) {
			if (o === f) continue;
			const dx = o.x - f.x, dy = o.y - f.y, dz = o.z - f.z, d = Math.hypot(dx, dy, dz);
			if (d > sight || d < 1e-4) continue;
			seen++;
			cx += o.x; cy += o.y; cz += o.z;
			vx += o.v[0]; vy += o.v[1]; vz += o.v[2];
			// (separation)
			if (d < crowd) { const push = (crowd - d) / crowd / d; ax -= dx * push * WEIGHTS.apart * most; ay -= dy * push * WEIGHTS.apart * most; az -= dz * push * WEIGHTS.apart * most; }
		}
		if (seen) {
			// (alignment, and cohesion)
			ax += (vx / seen - f.v[0]) * WEIGHTS.along; ay += (vy / seen - f.v[1]) * WEIGHTS.along; az += (vz / seen - f.v[2]) * WEIGHTS.along;
			ax += (cx / seen - f.x) * WEIGHTS.together; ay += (cy / seen - f.y) * WEIGHTS.together; az += (cz / seen - f.z) * WEIGHTS.together;
		}
		// after the leader, a little ahead of where it is
		const lx = S.x + Math.sin(S.heading) * L - f.x, lz = S.z + Math.cos(S.heading) * L - f.z, ly = S.y - f.y, ld = Math.hypot(lx, ly, lz) || 1;
		ax += lx / ld * most * WEIGHTS.leader; ay += ly / ld * most * WEIGHTS.leader; az += lz / ld * most * WEIGHTS.leader;
		// between the bed and the surface, and not on to the shore
		const ahead = low().heightAt(f.x + f.v[0] * 0.8, f.z + f.v[2] * 0.8), bed = low().heightAt(f.x, f.z);
		if (f.y < bed + 0.3 * m) ay += (bed + 0.3 * m - f.y) * WEIGHTS.depth * most;
		if (f.y > surface() - 0.25 * m) ay -= (f.y - surface() + 0.25 * m) * WEIGHTS.depth * most;
		if (ahead > f.y - 0.2 * m) { ax -= f.v[0] * 2; az -= f.v[2] * 2; ax += lx / ld * most; az += lz / ld * most; }
		f.v[0] += ax * dt; f.v[1] += ay * dt; f.v[2] += az * dt;
		const speed = Math.hypot(...f.v), top = most * f.own;
		if (speed > top) { const k = top / speed; f.v[0] *= k; f.v[1] *= k; f.v[2] *= k; }
		f.x += f.v[0] * dt; f.y += f.v[1] * dt; f.z += f.v[2] * dt;
		f.swim += dt * (4 + 9 * speed / Math.max(most, 1e-3));
	}
}

// MULTIPLAYER (see the top): [id, x, y, z, heading, kind, 0, 0, 0, 0, 0, 1]
export function fishShare() {
	const out = [];
	for (const S of schools) out.push(S.id, S.x, S.y, S.z, S.heading, S.kind, 0, 0, 0, 0, 0, 1);
	return new Float32Array(out);
}
export function fishFollow(records) {
	if (!records) { followed = null; return; }
	followed = [];
	for (let k = 0; k < records.length; k += 12) followed.push({ id: records[k], x: records[k + 1], y: records[k + 2], z: records[k + 3], heading: records[k + 4], kind: Math.round(records[k + 5]) });
}

// Once a frame: the leaders on (the host's), and the fish of the schools near the camera
let lastTime = performance.now();
export function fishUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.05);
	lastTime = now;
	if (!settings.enableFish || !settings.enableWater || !terrain.land) return;
	if (!followed) {
		if (terrain.land !== builtFor) { build(); live.clear(); }
		moveLeaders(dt);
	}
	const list = followed ?? schools, m = metre(), reach = NEAR * m, cx = settings.camPosX, cz = settings.camPosZ;
	let drawn = 0;
	const wanted = new Set();
	for (const S of list) {
		const K = KINDS[S.kind];
		if (!K || Math.hypot(S.x - cx, S.z - cz) > reach) continue;
		wanted.add(S.id);
		const fishes = schoolFish(S);
		boids(S, fishes, dt);
		for (const f of fishes) {
			if (drawn++ >= DRAW_MOST) break;
			const speed = Math.hypot(...f.v) || 1, heading = Math.atan2(f.v[0], f.v[2]), pitch = Math.asin(Math.min(Math.max(f.v[1] / speed, -1), 1));
			props.show(K.model, props.place([f.x, f.y, f.z], heading, pitch, 0, f.own), undefined, [0, 0.14, f.swim, K.length]);
		}
	}
	for (const id of live.keys()) if (!wanted.has(id)) live.delete(id);
	fishStats.schools = list.length;
	fishStats.fish = drawn;
}
export const fishForTest = () => ({ ...fishStats, kinds: KINDS.map((K, k) => ({ name: K.name, water: K.water, schools: (followed ?? schools).filter((S) => S.kind == k).length })) });
