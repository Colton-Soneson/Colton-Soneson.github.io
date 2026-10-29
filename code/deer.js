import { DEPTH_FORMAT, depthTest, DEPTH_CLEAR } from './depthMode.js'
import {device} from './deviceSelection.js'
import { frameTexture } from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_deer } from '../shaders/js/vf_deer.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as ballistics from './ballistics.js'

//the deer fade into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'
import {sunCycles} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	Deer. Small groups (settings.deerGroups, 4 to start with and up to MAX_GROUPS, of 1 to 3 each), living in the forest and going down to
	the water to drink.

	THE DEER (DEER_MESH)
		77 triangles, in metres, life size: a body (a box, 12), a neck (6) and a head (8), ears (2), a tail (1), and four legs
		of two pieces each (48, three sided tubes). The legs walk and the head goes down to graze and to drink in the shader
		(vf_deer.js), which only needs to know where each deer is in its stride and how far down its head is.

	THE GROUPS
		Each has a home: a stretch of forest near a marsh (the wet ground round a lake), the nearest first. The homes are
		kept HOME_SPACINGS[0] apart, and only when that leaves too few for the groups asked for do the rest come closer, down
		to the last of HOME_SPACINGS: the forest has room for about 40 at the widest, 200 at the closest. Most of the time they wander
		round it, a little way at a time, and stop to graze. Three times a day (THE DEER'S DAY) they go down to the water,
		to the marsh nearest where they are, drink a while at the edge, and go back up into the forest.
		The first of a group leads. The others follow, each in its own place a little behind and to the side, keeping
		apart from each other.
		They keep off water and off ground too steep to walk: before each step a deer looks a little way ahead, and if
		that is water or a cliff it tries turning a bit one way or the other until it finds ground it can walk on.

	THE DEER'S DAY is the world's: a round of the sun (sunCycles in atmosphere.js, settings.dayLengthSeconds long). They go to the
		water at three times spread through each day. While the sun is stood still no day goes by, and they only wander.
		(A very fast Time Multiplier leaves them too little time to walk there and back three times: then they go as often
		as they can)

	SHOT (rifle.js, ballistics.js). Each deer's hitbox is DEER_SPHERES, 7 balls: rump, middle and chest, neck and head (which go
		down with the head), and the front and the hind legs. A deer that is hit falls over on to its side, away from the shot
		(FALL_SECONDS), lies there (LIE_SECONDS; in the Survival mode SURVIVAL_LIE_SECONDS, with MEAT cuts of venison on it for a hatchet
		or a knife: butcher, survivalTools.js, and it goes once they are all cut), sinks into the ground (SINK_SECONDS) and is gone. RESPAWN_SECONDS later another
		joins its group, at its home in the forest (or somewhere else in the forest round it), never nearer the camera than
		RESPAWN_AWAY.

	THE GROUND under a deer is the exact ground (land.groundAt, what the mesh is made from), which is slow to work out. So it
	is only worked out again when the deer has gone GROUND_AGAIN from where it last was. In between, the change in the
	cheap data grid height (land.heightAt) is added to it.
*/

const MAX_GROUPS = 200;
const MAX_IN_GROUP = 3;
const MAX_DEER = MAX_GROUPS * MAX_IN_GROUP;
const MAX_DRAWN = MAX_DEER * 2 + 3400;	// the living and the shot ones still going into the ground, and the others drawn with them (addDrawn: the horde)
const HOME_SPACINGS = [250, 180, 120];	// world units between homes: the widest first, closer only when they do not all fit
const REHERD_SECONDS = 0.4;		// a new number of groups is made once it has held this long (a dragged slider goes through every number)
const DEER_FLOATS = 12;				// one deer as the shader gets it: place (4), pose (4), state (4)
const TRIPS_A_DAY = 3;
const TRIP_SPARE = 25;				// seconds more than a trip should take, when working out whether the day is running out on them
const WALK = 1.3, TROT = 4.0;		// metres a second: wandering, and going to and from the water
const WANDER = 80;					// metres round home they wander
const DRINK_SECONDS = [12, 20];
const GRAZE_SECONDS = [6, 18];
const STRIDE = 1.4;					// metres a stride takes
const STEEPEST = 1.0;				// rise over run a deer will walk up: 45 degrees
const STUCK_SECONDS = 6;			// going to the water and getting no nearer for this long, it tries somewhere else to drink
const GROUND_AGAIN = 0.5;			// metres
const FALL_SECONDS = 0.7, LIE_SECONDS = 6, SINK_SECONDS = 4;
const SURVIVAL_LIE_SECONDS = 600, MEAT = 4;
const lieOf = (corpse) => corpse.lie ?? (settings.gameMode == 'Hunting' ? SURVIVAL_LIE_SECONDS : LIE_SECONDS);
const SINK_DEPTH = 0.7;				// metres it goes down into the ground
const RESPAWN_SECONDS = 120;
const RESPAWN_AWAY = 60;			// metres
// the hitbox, in the deer's own metres: x, y, z, radius, and whether it goes down with the head (see vf_deer.js)
const DEER_SPHERES = [[0, 0.97, -0.42, 0.2], [0, 0.98, 0, 0.21], [0, 1.0, 0.38, 0.2], [0, 1.25, 0.56, 0.1, true], [0, 1.45, 0.8, 0.11, true], [0, 0.45, 0.4, 0.14], [0, 0.45, -0.45, 0.14]];

// The mesh
//-------------------------------------------------
// a three or four sided tube from a to b, radius ra at a and rb at b, as triangles of [x, y, z, part]
function tube(into, a, b, ra, rb, sides, part) {
	const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], length = Math.hypot(...axis);
	const d = axis.map((v) => v / length);
	const other = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	let u = [d[1] * other[2] - d[2] * other[1], d[2] * other[0] - d[0] * other[2], d[0] * other[1] - d[1] * other[0]];
	const ul = Math.hypot(...u); u = u.map((v) => v / ul);
	const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
	const ring = (c, r) => Array.from({ length: sides }, (_, k) => { const t = k / sides * Math.PI * 2; return [c[0] + (u[0] * Math.cos(t) + w[0] * Math.sin(t)) * r, c[1] + (u[1] * Math.cos(t) + w[1] * Math.sin(t)) * r, c[2] + (u[2] * Math.cos(t) + w[2] * Math.sin(t)) * r]; });
	const A = ring(a, ra), B = ring(b, rb);
	for (let k = 0; k < sides; k++) {
		const n = (k + 1) % sides;
		into.push([A[k], B[k], B[n], part], [A[k], B[n], A[n], part]);
	}
	return { A, B };
}
const DEER_MESH = (() => {
	const triangles = [];
	// the body: a box, a little narrower at the rump than at the chest
	const back = [[-0.14, 0.84, -0.6], [0.14, 0.84, -0.6], [0.14, 1.1, -0.6], [-0.14, 1.1, -0.6]];
	const front = [[-0.15, 0.85, 0.52], [0.15, 0.85, 0.52], [0.15, 1.15, 0.52], [-0.15, 1.15, 0.52]];
	for (let k = 0; k < 4; k++) {
		const n = (k + 1) % 4;
		triangles.push([back[k], front[k], front[n], 0], [back[k], front[n], back[n], 0]);
	}
	triangles.push([back[0], back[2], back[1], 0], [back[0], back[3], back[2], 0], [front[0], front[1], front[2], 0], [front[0], front[2], front[3], 0]);
	// the neck and the head
	tube(triangles, [0, 1.05, 0.42], [0, 1.45, 0.68], 0.1, 0.06, 3, 1);
	const head = tube(triangles, [0, 1.47, 0.64], [0, 1.4, 0.93], 0.085, 0.035, 3, 1);
	triangles.push([head.A[0], head.A[2], head.A[1], 1], [head.B[0], head.B[1], head.B[2], 1]);
	// the ears, and the tail
	for (const side of [-1, 1]) triangles.push([[0.04 * side, 1.53, 0.7], [0.15 * side, 1.62, 0.65], [0.06 * side, 1.54, 0.64], 1]);
	triangles.push([[-0.05, 1.08, -0.6], [0.05, 1.08, -0.6], [0, 0.94, -0.7], 0]);
	// the legs: left front, right front, left hind, right hind. Hip to knee, and knee to hoof
	[[-0.11, 0.4], [0.11, 0.4], [-0.11, -0.45], [0.11, -0.45]].forEach(([x, z], leg) => {
		tube(triangles, [x, 0.88, z], [x, 0.45, z], 0.055, 0.035, 3, 2 + leg);
		tube(triangles, [x, 0.45, z], [x, 0.0, z + 0.02], 0.03, 0.022, 3, 2 + leg);
	});
	const data = [];
	for (const [a, b, c, part] of triangles) for (const p of [a, b, c]) data.push(p[0], p[1], p[2], part);
	return new Float32Array(data);
})();
const DEER_VERTICES = DEER_MESH.length / 4;
export const DEER_TRIANGLE_COUNT = DEER_VERTICES / 3;

export const deerStats = { deer: 0, groups: 0, day: 0, triangles: DEER_TRIANGLE_COUNT, killed: 0, corpses: 0, respawned: 0, spheres: DEER_SPHERES.length };	// for anyone who wants to show it

// Buffers, pipeline
//-------------------------------------------------
const deerShaderModule = device.createShaderModule({ label: "vf_deer", code: vf_deer });
const meshBuffer = device.createBuffer({ label: "deer mesh", size: DEER_MESH.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(meshBuffer, 0, DEER_MESH);
const instanceData = new Float32Array(MAX_DRAWN * DEER_FLOATS);
const instanceBuffer = device.createBuffer({ label: "deer instances", size: instanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
const deerUniformBuffer = device.createBuffer({ label: "deer Uniform", size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

const deerPipeline = device.createRenderPipeline({
	label: "deer pipeline",
	layout: 'auto',
	vertex: {
		module: deerShaderModule,
		entryPoint: "vertexMain",
		buffers: [
		{ arrayStride: 16, attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }] },
		{
			arrayStride: DEER_FLOATS * 4,
			stepMode: 'instance',
			attributes: [
				{ format: "float32x4", offset: 0, shaderLocation: 1 },		// where, how big
				{ format: "float32x4", offset: 16, shaderLocation: 2 },		// heading, stride, head down, walking
				{ format: "float32x4", offset: 32, shaderLocation: 3 },		// its own number, the slope under it
			],
		}]
	},
	fragment: { module: deerShaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },		// (whichever way round the triangles happen to run: the faces are turned to the eye in the shader)
	depthStencil: { depthWriteEnabled: true, depthCompare: depthTest('less'), format: DEPTH_FORMAT },
});

// The groups
//-------------------------------------------------
let groups = [];
let herdLand = null, herdGroups = -1;	// the land and the number of groups the herd was made for
let groupsAsked = -1, askedSeconds = 0;	// a new number of groups, and how long it has been asked for (see REHERD_SECONDS)
let shoreSpots = [];		// where they drink: { x, z, facing } on the marsh, facing the water
let dayClock = 0;			// the world's day (see THE DEER'S DAY), in days
let testDays = 0;			// days a test has moved the deer on by, on top of the sun's (see simulateDeer)
const daySeconds = () => Math.max(settings.dayLengthSeconds, 1) / Math.max(settings.timeCycleMultiplier, 0.01);	// real seconds a day takes
let lastTime = performance.now();
let herdSeconds = 0;		// real seconds the herd has been going, for the respawns
let corpses = [];			// shot deer on their way into the ground: { deer, t, side }

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const ease = (v) => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
// in the Horde game mode the herds are out of sight (and out of reach of the guns): every deer about is one of the horde (horde.js)
const hidden = () => settings.gameMode == 'Horde';

// Shot
//-------------------------------------------------
// a deer's hitbox in the world: [x, y, z, radius] for each of DEER_SPHERES (horde.js's deer too)
export function deerSpheres(deer) {
	const s = settings.forestUnitsPerMetre * settings.deerSize * (deer.size ?? 1);
	const down = 1.25 * deer.headDown, c = Math.cos(deer.heading), sn = Math.sin(deer.heading);
	return DEER_SPHERES.map(([x, y, z, r, head]) => {
		if (head) {
			const ry = y - 1.08, rz = z - 0.45;
			y = 1.08 + ry * Math.cos(down) - rz * Math.sin(down);
			z = 0.45 + ry * Math.sin(down) + rz * Math.cos(down);
		}
		return [deer.x + (x * c + z * sn) * s, deer.y + y * s, deer.z + (z * c - x * sn) * s, r * s];
	});
}
export function deerAround(deer) {
	const s = settings.forestUnitsPerMetre * settings.deerSize * (deer.size ?? 1);
	return [deer.x, deer.y + 1.0 * s, deer.z, 1.3 * s];
}
ballistics.addTarget((ax, ay, az, bx, by, bz) => {
	if (!settings.enableDeer || hidden()) return null;
	if (followed) {
		const found = ballistics.crossAnimals(ax, ay, az, bx, by, bz, followed.filter((one) => one.alive), deerSpheres, deerAround);
		return found && { t: found.t, what: 'deer', hit: (velocity) => deerShot.report?.(found.animal.id, velocity) };
	}
	const living = groups.flatMap((group) => group.deer.map((deer) => ({ deer, group })));
	const found = ballistics.crossAnimals(ax, ay, az, bx, by, bz, living, (one) => deerSpheres(one.deer), (one) => deerAround(one.deer));
	return found && { t: found.t, what: 'deer', hit: (velocity) => killDeer(found.animal.deer, found.animal.group, velocity) };
}, () => {
	const list = [];
	if (!settings.enableDeer || hidden()) return list;
	if (followed) { for (const one of followed) if (one.alive) list.push(...deerAround(one)); }
	else for (const group of groups) for (const deer of group.deer) list.push(...deerAround(deer));
	return list;
});

// a shell bursting (shipGuns.js) at (world units), fired here: every deer within radius (world units) of it dead (a joiner says so to
//		the host, as a shot would)
export function blast(at, radius) {
	if (!settings.enableDeer || hidden()) return;
	const near = (one) => Math.hypot(one.x - at[0], one.y - at[1], one.z - at[2]) < radius;
	const away = (one) => [one.x - at[0], 0, one.z - at[2]];
	if (followed) { for (const one of followed) if (one.alive && near(one)) deerShot.report?.(one.id, away(one)); return; }
	for (const group of groups) for (const deer of [...group.deer]) if (near(deer)) killDeer(deer, group, away(deer));
}

function killDeer(deer, group, velocity) {
	const at = group.deer.indexOf(deer);
	if (at < 0) return;
	group.deer.splice(at, 1);
	// over on to the side the shot pushed it to (its right is (cos, -sin) of its heading)
	const side = velocity[0] * Math.cos(deer.heading) - velocity[2] * Math.sin(deer.heading) > 0 ? 1 : -1;
	corpses.push({ deer: deer, t: 0, side: side, meat: MEAT });
	group.respawns.push(herdSeconds + RESPAWN_SECONDS);
	deerStats.killed++;
}

// Multiplayer (net.js). The host's deer are everyone's: the host sends them as they are (deerShare), and a joiner draws those
//		instead of its own, which stop (deerFollow). A joiner's shot that hits one is reported to the host (deerShot), who has it
//		fall, and everyone sees it fall
export const deerShot = { report: null };
let followed = null;		// joiner: the host's deer, as they are now
// host: [id, x, y, z, heading, stride, head down, walking, own, slope, roll, alive] for each deer, the shot ones too
export function deerShare() {
	const size = settings.forestUnitsPerMetre * settings.deerSize;
	const out = [];
	for (const group of groups) for (const deer of group.deer) out.push(deer.id, deer.x, deer.y, deer.z, deer.heading, deer.stride, deer.headDown, deer.walking, deer.own, deer.slope, 0, 1);
	for (const corpse of corpses) {
		const deer = corpse.deer;
		out.push(deer.id, deer.x, deer.y - (corpse.sink ?? 0) * size, deer.z, deer.heading, deer.stride, deer.headDown, 0, deer.own, deer.slope, corpse.roll ?? 0, 0);
	}
	return new Float32Array(out);
}
// joiner: the host's deer, as deerShare's records, or null to go back to its own
export function deerFollow(records) {
	if (!records) { followed = null; return; }
	followed = [];
	for (let at = 0; at < records.length; at += 12) {
		followed.push({ id: records[at], x: records[at + 1], y: records[at + 2], z: records[at + 3], heading: records[at + 4], stride: records[at + 5], headDown: records[at + 6],
			walking: records[at + 7], own: records[at + 8], slope: records[at + 9], roll: records[at + 10], alive: records[at + 11] > 0.5 });
	}
}
// host: a deer one of the others shot
export function killDeerById(id, velocity) {
	for (const group of groups) {
		const deer = group.deer.find((one) => one.id === id);
		if (deer) { killDeer(deer, group, velocity); return; }
	}
}

// a new deer for a group, at its home or somewhere in the forest round it, well away from the camera. false if nowhere will do just now
function respawnDeer(group) {
	const away = RESPAWN_AWAY * metre();
	const far = (x, z) => Math.hypot(x - settings.camPosX, z - settings.camPosZ) > away;
	let place = null;
	for (let attempt = 0; attempt < 12 && !place; attempt++) {
		const [x, z] = attempt == 0 ? [group.home.x, group.home.z] : wanderTarget(group);
		if (walkable(x, z) && far(x, z)) place = [x, z];
	}
	if (!place) return false;
	group.deer.push(newDeer(place[0], place[1]));
	if (group.deer.length == 1) {
		group.state = 'wander';
		group.target = wanderTarget(group);
	}
	deerStats.respawned++;
	return true;
}

let nextDeerId = 1;
function newDeer(x, z) {
	return { id: nextDeerId++, x: x, z: z, y: 0, heading: Math.random() * Math.PI * 2, stride: Math.random() * 6.28, walking: 0, headDown: 0, headWanted: 0, alertTimer: 0, own: Math.random(), slope: 0, ground: null, place: null };
}
const between = ([low, high]) => low + (high - low) * Math.random();
const metre = () => settings.forestUnitsPerMetre;

// ground a deer can stand on: not water, not too steep
export function walkable(x, z) {
	const land = terrain.land, half = settings.terrainWorldSize * 0.5 - 20;
	if (Math.abs(x) > half || Math.abs(z) > half) return false;
	const y = land.heightAt(x, z);
	if (y < settings.waterWorldPosY + 0.05) return false;
	const step = 2 * metre();
	return Math.abs(land.heightAt(x + step, z) - y) < STEEPEST * step && Math.abs(land.heightAt(x, z + step) - y) < STEEPEST * step;
}

// somewhere in the forest round a group's home
function wanderTarget(group) {
	for (let attempt = 0; attempt < 10; attempt++) {
		const angle = Math.random() * Math.PI * 2, out = WANDER * metre() * Math.sqrt(Math.random());
		const x = group.home.x + Math.cos(angle) * out, z = group.home.z + Math.sin(angle) * out;
		if (terrain.land.zoneAt(x, z) == terrain.ZONE_FOREST && walkable(x, z)) return [x, z];
	}
	return [group.home.x, group.home.z];
}

// the three times of a day the group goes to the water, spread through it
function scheduleTrips(group, day) {
	group.trips = [day + 0.08 + 0.18 * Math.random(), day + 0.42 + 0.14 * Math.random(), day + 0.74 + 0.14 * Math.random()].filter((t) => t > dayClock);
	group.scheduledDay = day;
}

function makeHerd() {
	herdLand = terrain.land;
	corpses = [];
	const land = terrain.land, water = settings.waterWorldPosY;
	// where to drink: from points on the marsh, out to the nearest edge of the water. The spot is the last dry ground before it,
	//		facing the water
	shoreSpots = [];
	for (const spot of land.findSpawnPoints(terrain.ZONE_MARSH, 120, { seed: 51, minSpacing: 30, maxSlope: 0.3 })) {
		if (!walkable(spot.x, spot.z)) continue;
		let best = null;
		for (let k = 0; k < 16; k++) {
			const angle = k / 16 * Math.PI * 2, dx = Math.sin(angle), dz = Math.cos(angle);
			for (let out = 2; out <= 60 && (!best || out < best.out); out += 2) {
				if (land.heightAt(spot.x + dx * out, spot.z + dz * out) < water) {
					if (out > 2) best = { out: out, x: spot.x + dx * (out - 2), z: spot.z + dz * (out - 2), facing: angle };
					break;
				}
			}
		}
		if (best && walkable(best.x, best.z) && shoreSpots.every((s) => Math.hypot(s.x - best.x, s.z - best.z) > 25)) shoreSpots.push({ x: best.x, z: best.z, facing: best.facing });
	}
	// homes: stretches of forest, the ones nearest to somewhere to drink first, well apart from each other. More than fit at the
	//		widest spacing: more places to choose from, closer together (see THE GROUPS at the top)
	const wanted = clamp(Math.round(settings.deerGroups), 0, MAX_GROUPS);
	const many = wanted > 40;
	const forestSpots = land.findSpawnPoints(terrain.ZONE_FOREST, many ? wanted * 5 : 60, { seed: 53, minSpacing: many ? 100 : 200, maxSlope: 0.4 }).filter((spot) => walkable(spot.x, spot.z));
	const nearestShore = (x, z) => shoreSpots.reduce((best, s) => Math.min(best, Math.hypot(s.x - x, s.z - z)), Infinity);
	forestSpots.sort((a, b) => nearestShore(a.x, a.z) - nearestShore(b.x, b.z));
	const homes = [];
	for (const spacing of HOME_SPACINGS) {
		for (const spot of forestSpots) {
			if (homes.length >= wanted) break;
			if (homes.every((home) => Math.hypot(home.x - spot.x, home.z - spot.z) > spacing)) homes.push(spot);
		}
	}

	groups = [];
	for (const home of homes) {
		const group = { home: { x: home.x, z: home.z }, deer: [], state: 'wander', target: null, timer: 0, trips: [], scheduledDay: -1, visits: {}, spot: null, respawns: [] };
		const size = 1 + Math.floor(Math.random() * MAX_IN_GROUP);
		for (let d = 0; d < size; d++) {
			const x = home.x + (Math.random() - 0.5) * 8, z = home.z + (Math.random() - 0.5) * 8;
			group.deer.push(newDeer(x, z));
		}
		group.target = wanderTarget(group);
		groups.push(group);
	}
}

// the exact ground under a deer, worked out again only when it has gone GROUND_AGAIN (see THE GROUND at the top)
export function groundUnder(deer) {
	const land = terrain.land;
	const rough = land.heightAt(deer.x, deer.z);
	if (!deer.ground || Math.hypot(deer.x - deer.ground.x, deer.z - deer.ground.z) > GROUND_AGAIN * metre()) {
		deer.ground = { x: deer.x, z: deer.z, exact: land.groundAt(deer.x, deer.z), rough: rough };
	}
	return deer.ground.exact + (rough - deer.ground.rough);
}

// one deer a step towards [x, z] at pace (world units a second), round water and cliffs. Returns how far off it still is
function walkTowards(deer, to, pace, elapsed) {
	const dx = to[0] - deer.x, dz = to[1] - deer.z, far = Math.hypot(dx, dz);
	if (far < 0.3 * metre()) return far;
	// looks a little way ahead, and turns aside until the ground there can be walked on
	const want = Math.atan2(dx, dz), look = 3 * metre();
	let heading = want;
	for (const turn of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4]) {
		if (walkable(deer.x + Math.sin(want + turn) * look, deer.z + Math.cos(want + turn) * look) || far < look) { heading = want + turn; break; }
	}
	let turn = heading - deer.heading;
	turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2));
	deer.heading += turn * Math.min(elapsed * 3, 1);
	const step = Math.min(pace * elapsed * (Math.abs(turn) > 1.6 ? 0.5 : 1), far);
	deer.x += Math.sin(deer.heading) * step;
	deer.z += Math.cos(deer.heading) * step;
	deer.stride += step / (STRIDE * metre()) * Math.PI * 2;
	deer.walking += (clamp(pace / (WALK * metre()), 0, 1.4) - deer.walking) * Math.min(elapsed * 4, 1);
	return far - step;
}

// Where a group goes to drink: the nearest spot that can be walked to in a straight line (none of the way water or a cliff),
//		or failing that the nearest at all. Not the one it got stuck going to
function chooseShore(from, not) {
	const clear = (spot) => {
		const far = Math.hypot(spot.x - from.x, spot.z - from.z), steps = Math.ceil(far / (4 * metre()));
		for (let k = 1; k < steps; k++) if (!walkable(from.x + (spot.x - from.x) * k / steps, from.z + (spot.z - from.z) * k / steps)) return false;
		return true;
	};
	const byDistance = shoreSpots.filter((s) => s !== not).sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
	return byDistance.slice(0, 6).find(clear) ?? byDistance[0] ?? not;
}

// the group a step on: the leader to `to`, the others to their places behind it. Returns how far off the leader still is
function moveGroup(group, to, pace, elapsed) {
	const leader = group.deer[0];
	const left = walkTowards(leader, to, pace, elapsed);
	group.deer.forEach((deer, i) => {
		if (i == 0) return;
		const side = i % 2 ? 1 : -1, back = (2.2 + 1.3 * i) * metre();
		let place = [leader.x - Math.sin(leader.heading) * back + Math.cos(leader.heading) * side * 1.6 * metre(), leader.z - Math.cos(leader.heading) * back - Math.sin(leader.heading) * side * 1.6 * metre()];
		if (!walkable(place[0], place[1])) place = [leader.x - Math.sin(leader.heading) * back, leader.z - Math.cos(leader.heading) * back];
		const far = Math.hypot(place[0] - deer.x, place[1] - deer.z);
		if (far > 0.6 * metre()) walkTowards(deer, place, pace * clamp(far / (2 * metre()), 0.3, 1.4), elapsed);
		else deer.walking += (0 - deer.walking) * Math.min(elapsed * 4, 1);
		// and not on top of one another
		for (const other of group.deer) {
			if (other === deer) continue;
			const ox = deer.x - other.x, oz = deer.z - other.z, apart = Math.hypot(ox, oz) || 0.01;
			if (apart < 1.2 * metre()) { deer.x += ox / apart * elapsed * metre(); deer.z += oz / apart * elapsed * metre(); }
		}
	});
	return left;
}

function standStill(group, elapsed) {
	for (const deer of group.deer) deer.walking += (0 - deer.walking) * Math.min(elapsed * 4, 1);
}

// Once a frame: every group moved on
export function deerUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.05);
	lastTime = now;
	advanceDeer(elapsed);
}

// for testing: the deer moved on by a number of seconds, as if that many had gone by with the sun going round
export function simulateDeer(total) {
	for (let done = 0; done < total; done += 0.05) {
		testDays += 0.05 / daySeconds();
		advanceDeer(0.05);
	}
}

function advanceDeer(elapsed) {
	dayClock = sunCycles + testDays;
	if (followed) {		// (a joiner's deer are the host's)
		deerStats.deer = followed.filter((one) => one.alive).length;
		return;
	}

	if (!settings.enableDeer || !terrain.land) {
		return;
	}
	// (made again for a new land, or when the number of groups is changed and has held for REHERD_SECONDS. There may be fewer
	//		than asked for: see makeHerd)
	if (settings.deerGroups !== groupsAsked) {
		groupsAsked = settings.deerGroups;
		askedSeconds = 0;
	}
	askedSeconds += elapsed;
	if (terrain.land !== herdLand || (settings.deerGroups !== herdGroups && askedSeconds >= REHERD_SECONDS)) {
		makeHerd();
		herdGroups = settings.deerGroups;
	}
	const day = Math.floor(dayClock);
	const m = metre();
	herdSeconds += elapsed;

	// the shot ones: over on to their sides, a while lying there, down into the ground, gone
	for (const corpse of corpses) {
		corpse.t += elapsed;
		const deer = corpse.deer;
		deer.walking = 0;
		deer.headDown += (0.35 - deer.headDown) * Math.min(elapsed * 4, 1);
		corpse.roll = -corpse.side * 1.45 * ease(corpse.t / FALL_SECONDS);
		corpse.sink = SINK_DEPTH * ease((corpse.t - FALL_SECONDS - lieOf(corpse)) / SINK_SECONDS);
	}
	corpses = corpses.filter((corpse) => corpse.t < FALL_SECONDS + lieOf(corpse) + SINK_SECONDS);
	// and the ones that take their places
	for (const group of groups) {
		while (group.respawns.length > 0 && group.respawns[0] <= herdSeconds) {
			if (respawnDeer(group)) group.respawns.shift();
			else { group.respawns[0] = herdSeconds + 10; break; }	// (nowhere far enough from the camera just now: again in a while)
		}
	}

	for (const group of groups) {
		if (group.deer.length == 0) continue;		// (all of it shot: until the new ones come)
		if (group.scheduledDay < day) scheduleTrips(group, day);
		// a trip is due at its time. And whatever the time, once the day is running out on the ones still to go: there have to be
		//		TRIPS_A_DAY in it (a group with a long way to the water may be late for one, still walking back from the last)
		//		How long a trip takes is worked out from how far the group is from the water now: there, the longest drink, and back
		const missing = TRIPS_A_DAY - (group.visits[day] ?? 0) - (group.state == 'toWater' || group.state == 'drink' ? 1 : 0);
		let late = false;
		if (missing > 0 && shoreSpots.length > 0 && (settings.atmosphereSunRotationDemo || testDays > 0)) {	// (no day goes by with the sun stood still)
			const leader = group.deer[0];
			const toWater = shoreSpots.reduce((best, s) => Math.min(best, Math.hypot(s.x - leader.x, s.z - leader.z)), Infinity);
			const tripSeconds = 2 * toWater / (TROT * m) + DRINK_SECONDS[1] + TRIP_SPARE;
			late = (day + 1 - dayClock) * daySeconds() < missing * tripSeconds;
		}
		const due = (group.trips.length > 0 && group.trips[0] <= dayClock) || late;

		if ((group.state == 'wander' || group.state == 'graze' || (group.state == 'back' && late)) && due && shoreSpots.length > 0) {
			//------------------OFF TO THE WATER-----------------
			group.trips.shift();
			const leader = group.deer[0];
			group.spot = chooseShore(leader, null);
			group.state = 'toWater';
			group.nearest = Infinity;
			group.stuckTimer = STUCK_SECONDS;
		}

		if (group.state == 'wander') {
			//------------------ROUND THE FOREST-----------------
			if (moveGroup(group, group.target, WALK * m, elapsed) < 1 * m) {
				group.state = 'graze';
				group.timer = between(GRAZE_SECONDS);
			}
		} else if (group.state == 'graze') {
			standStill(group, elapsed);
			group.timer -= elapsed;
			if (group.timer <= 0) {
				group.target = wanderTarget(group);
				group.state = 'wander';
			}
		} else if (group.state == 'toWater') {
			//------------------DOWN TO THE WATER-----------------
			const left = moveGroup(group, [group.spot.x, group.spot.z], TROT * m, elapsed);
			// no nearer for a while (water or a cliff in the way): somewhere else to drink
			if (left < group.nearest - 1 * m) {
				group.nearest = left;
				group.stuckTimer = STUCK_SECONDS;
			} else if ((group.stuckTimer -= elapsed) <= 0) {
				group.spot = chooseShore(group.deer[0], group.spot);
				group.nearest = Infinity;
				group.stuckTimer = STUCK_SECONDS;
			}
			if (left < 1 * m) {
				group.state = 'drink';
				group.timer = between(DRINK_SECONDS);
				group.visits[day] = (group.visits[day] ?? 0) + 1;
			}
		} else if (group.state == 'drink') {
			// all of them at the edge, side by side, facing the water, heads down
			group.deer.forEach((deer, i) => {
				const along = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 1.4 * m;
				let place = [group.spot.x + Math.cos(group.spot.facing) * along, group.spot.z - Math.sin(group.spot.facing) * along];
				if (!walkable(place[0], place[1])) place = [group.spot.x - Math.sin(group.spot.facing) * 1.6 * i * m, group.spot.z - Math.cos(group.spot.facing) * 1.6 * i * m];	// (no room along the edge: behind)
				if (i > 0 && Math.hypot(place[0] - deer.x, place[1] - deer.z) > 0.4 * m) walkTowards(deer, place, WALK * m, elapsed);
				else {
					deer.walking += (0 - deer.walking) * Math.min(elapsed * 4, 1);
					let turn = group.spot.facing - deer.heading;
					turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2));
					deer.heading += turn * Math.min(elapsed * 2, 1);
				}
			});
			group.timer -= elapsed;
			if (group.timer <= 0) {
				group.target = wanderTarget(group);
				group.state = 'back';
				group.nearest = Infinity;
				group.stuckTimer = STUCK_SECONDS;
			}
		} else if (group.state == 'back') {
			//------------------BACK UP INTO THE FOREST-----------------
			const left = moveGroup(group, group.target, TROT * m, elapsed);
			if (left < group.nearest - 1 * m) {
				group.nearest = left;
				group.stuckTimer = STUCK_SECONDS;
			} else if ((group.stuckTimer -= elapsed) <= 0) {
				group.target = wanderTarget(group);
				group.nearest = Infinity;
				group.stuckTimer = STUCK_SECONDS;
			}
			if (left < 1 * m) {
				group.state = 'graze';
				group.timer = between(GRAZE_SECONDS);
			}
		}

		// heads: down to graze (now and then up, to look round), down to drink, up to walk
		for (const deer of group.deer) {
			deer.alertTimer -= elapsed;
			if (group.state == 'graze' || group.state == 'drink') {
				if (deer.alertTimer <= 0) {
					deer.headWanted = Math.random() < (group.state == 'drink' ? 0.85 : 0.7) ? 1 : 0;
					deer.alertTimer = 2 + 5 * Math.random();
				}
			} else {
				deer.headWanted = 0;
			}
			deer.headDown += ((deer.walking > 0.3 ? 0 : deer.headWanted) - deer.headDown) * Math.min(elapsed * 2.5, 1);
			deer.y = groundUnder(deer);
			// tipped to the slope it stands on, along its heading
			const fx = Math.sin(deer.heading) * 0.8 * m, fz = Math.cos(deer.heading) * 0.8 * m;
			deer.slope += (Math.atan2(terrain.land.heightAt(deer.x + fx, deer.z + fz) - terrain.land.heightAt(deer.x - fx, deer.z - fz), 1.6 * m) - deer.slope) * Math.min(elapsed * 4, 1);
		}
	}
	deerStats.groups = groups.length;
	deerStats.deer = groups.reduce((sum, group) => sum + group.deer.length, 0);
	deerStats.corpses = corpses.length;
	deerStats.day = dayClock;
}

// every deer within reach of (x, z) world units: each(x, y, z) (sound.js: a snort now and then)
export function deerNear(x, z, reach, each) {
	if (!settings.enableDeer || hidden()) return;
	const list = followed ? followed.filter((one) => one.alive) : groups.flatMap((group) => group.deer);
	for (const one of list) if (Math.abs(one.x - x) < reach && Math.abs(one.z - z) < reach) each(one.x, one.y, one.z);
}
// for testing: the groups as they are now
export function deerGroups() {
	return groups.map((group) => ({ state: group.state, home: group.home, spot: group.spot, visits: { ...group.visits }, trips: [...group.trips], deer: group.deer.map((deer) => ({ x: deer.x, y: deer.y, z: deer.z, heading: deer.heading, headDown: deer.headDown, walking: deer.walking })) }));
}
// the dead one the eye (world units) is on, looking along look, within reach (world units): its id, or null. The host's own still with
//		meat on them; a joiner's, any the host has lying (it says whether there is any left: butcher)
export function corpseInReach(eye, look, reach) {
	if (!settings.enableDeer || hidden()) return null;
	const s = settings.forestUnitsPerMetre * settings.deerSize;
	const list = followed ? followed.filter((one) => !one.alive) : corpses.filter((corpse) => corpse.meat > 0).map((corpse) => corpse.deer);
	let best = null, bestD = reach;
	for (const one of list) {
		const to = [one.x - eye[0], one.y + 0.4 * s - eye[1], one.z - eye[2]], d = Math.hypot(...to);
		if (d < bestD && (to[0] * look[0] + to[1] * look[1] + to[2] * look[2]) / (d || 1) > 0.75) { best = one; bestD = d; }
	}
	return best ? best.id : null;
}
// host: a cut of venison off the dead one id, if there is any left on it (true); the last one taken, it sinks away
export function butcher(id) {
	const corpse = corpses.find((one) => one.deer.id == id);
	if (!corpse || !(corpse.meat > 0)) return false;
	if (--corpse.meat == 0) corpse.lie = Math.max(corpse.t - FALL_SECONDS, 0);
	deerStats.butchered = (deerStats.butchered ?? 0) + 1;
	return true;
}
export function deerCorpses() {
	return corpses.map((corpse) => ({ id: corpse.deer.id, t: corpse.t, roll: corpse.roll, sink: corpse.sink, x: corpse.deer.x, y: corpse.deer.y, z: corpse.deer.z, meat: corpse.meat }));
}
export function deerDay() {
	return { clock: dayClock, shoreSpots: shoreSpots.length };
}

// Others drawn with the deer, the same mesh (horde.js's): fn(put) calls put(x, y, z, heading, stride, head down, walking, own, slope, roll,
//		feral, scale) for each one (feral: 0 a deer, 1 one of the horde, 2 one in a frenzy: see vf_deer.js. scale: times a deer's size)
const drawers = [];
export function addDrawn(fn) { drawers.push(fn); }

// The deer drawn, with the solid things
export function deerPass(aEncoder, mainpassDepthTexture) {
	let count = 0;
	const size = settings.forestUnitsPerMetre * settings.deerSize;
	const put = (x, y, z, heading, stride, headDown, walking, own, slope, roll, feral, scale = 1) => {
		if (count >= MAX_DRAWN) return;
		instanceData.set([x, y, z, size * scale, heading, stride, headDown, clamp(walking, 0, 1), own, slope, roll, feral], count * DEER_FLOATS);
		count++;
	};
	if (settings.enableDeer && !hidden()) {
		const drawn = followed ? followed.map((one) => [one, one.roll, 0])
			: [...groups.flatMap((group) => group.deer.map((deer) => [deer, 0, 0])), ...corpses.map((corpse) => [corpse.deer, corpse.roll ?? 0, corpse.sink ?? 0])];
		for (const [deer, roll, sink] of drawn) put(deer.x, deer.y - sink * size, deer.z, deer.heading, deer.stride, deer.headDown, deer.walking, deer.own, deer.slope, roll, 0);
	}
	for (const fn of drawers) fn(put);
	if (count == 0) return;
	device.queue.writeBuffer(instanceBuffer, 0, instanceData, 0, count * DEER_FLOATS);

	const bufferResult = [...transformations.getViewProj()];
	bufferResult.push(settings.camPosX, settings.camPosY, settings.camPosZ, 0);
	bufferResult.push(settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, 0, 0);
	const result = new Float32Array(bufferResult);
	device.queue.writeBuffer(deerUniformBuffer, 0, result.buffer, result.byteOffset, result.byteLength);

	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{ view: frameTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Deer', 'vf_deer'),
	});
	pass.setPipeline(deerPipeline);
	pass.setBindGroup(0, device.createBindGroup({
		label: "deer bind group",
		layout: deerPipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: deerUniformBuffer } },
			{ binding: 1, resource: { buffer: uniformBufferLights } },
			{ binding: 2, resource: skyViewLUTtexture.createView() },
			{ binding: 3, resource: linSampler },
		],
	}));
	pass.setVertexBuffer(0, meshBuffer);
	pass.setVertexBuffer(1, instanceBuffer);
	pass.draw(DEER_VERTICES, count, 0, 0);
	pass.end();
}
