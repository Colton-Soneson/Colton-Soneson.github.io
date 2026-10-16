import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_geese } from '../shaders/js/vf_geese.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as ballistics from './ballistics.js'
import { birdSpheres, fallen, moveFallen } from './fallenBirds.js'

//the geese fade into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	Geese. One skein of them (settings.geeseCount, 7 to start with), high up most of the time, at about the height of the
	tallest peaks, in a V. Every so often they come down on to a lake or a marsh, stay a while, and are off again.

	THE GOOSE (GOOSE_MESH)
		25 triangles: a body (8, a long diamond), a neck (6, a thin three sided tube), a head and bill (3), and two wings of two
		pieces each (8). Unlike the hawk's it is solid, so it is lit by the faces it really has (see vf_geese.js). The beat of
		the wings, the neck held up on the water, and the wings folded on the ground are all put on by the shader.

	THE SKEIN, a few states one after another:
		cruise		in a V at CRUISE height, the leader making for one far point and then another. After CRUISE_SECONDS it picks a
					lake or a marsh to come down on
		descend		down to it: straight at it at first, losing height on a long glide, then round and round over it until low
		final		each goose to its own place on the water or the ground round the spot, slowing as it comes in
		landed		LANDED_SECONDS on the ground or the water, wings folded and necks up, each pottering about near where it came
					down. Then all of them are off again, straight back up to cruise

	HOW THEY FLY: boids (as the hawks, birds.js), weighted to fly in a V. Every goose but the leader has a place in it: a step
	further back and a step further out to one side than the one in front of it on that side, the two arms of the V taking
	turns. What each one steers by, added together:
		its place in the V				strongest. Where that is moves with the leader
		separation						not too close to any other goose
		alignment						heading the way the others are heading
		cohesion						towards the middle of them, weak (the V does most of this)
	SHOT (rifle.js): each goose's hitbox is GOOSE_SPHERES, 6 balls: body, breast, neck, head (the neck and head go up with it on
	the ground), and a wing each (not while folded). A goose that is hit falls (fallenBirds.js), and the V closes up behind it:
	if it was the leader the next one leads. RESPAWN_SECONDS later another joins the skein, from far behind it, while it is up high.
	The leader has none of these: it flies where the skein is going. And it does not stay the leader: every LEAD_SECONDS it
	drops back to the end of an arm and the next one takes over, as geese do (the one in front works hardest).
*/

const MAX_GEESE = 12;
const GOOSE_FLOATS = 12;				// one goose as the shader gets it: place (4), pose (4), state (4), the same as a hawk
const PACE = 34.0;						// world units a second in the air: about 17 metres a second
const ROAM = 3300.0;					// how far from the middle of the world the leader goes
const CRUISE_SECONDS = [100, 200];		// how long they stay up before coming down
const LANDED_SECONDS = [60, 120];		// and how long they stay down
const LEAD_SECONDS = 45;
const SLOT_BACK = 7.0, SLOT_OUT = 6.0;	// world units back and out to the side, for each place further down an arm of the V
const SEPARATION = 9.0;
const CLEARANCE = 60.0;					// the least they fly over the ground under them and ahead of them
const LOW_CLEARANCE = 15.0;				// and circling down over where they are landing
const CIRCLE = 170.0;					// how wide they circle over where they are coming down
const RESPAWN_SECONDS = 120;
// the hitbox, a wingspan of 1: x, y, z, radius, and whether it is a wing (left out while folded)
const GOOSE_SPHERES = [[0, 0, -0.05, 0.09], [0, -0.005, 0.1, 0.075], [0, 0.02, 0.27, 0.04], [0, 0.02, 0.45, 0.045], [0.28, 0.02, -0.02, 0.1, true], [-0.28, 0.02, -0.02, 0.1, true]];

// The goose: [x, y, z, w] for every corner. It is 1 across from wing tip to wing tip and heads along +z.
//		w: on a wing, how far out along it (0 at the body, 1 at the tip, negative on the left wing). 2 on the neck and the head
const C = {
	// the body
	F: [0, 0.005, 0.15, 0], B: [0, 0.01, -0.22, 0], L: [-0.065, 0, -0.01, 0], R: [0.065, 0, -0.01, 0], U: [0, 0.05, -0.03, 0], D: [0, -0.055, -0.01, 0],
	// the neck, at its foot and at the head
	na: [0, 0.035, 0.12, 2], nb: [-0.022, -0.005, 0.12, 2], nc: [0.022, -0.005, 0.12, 2],
	ha: [0, 0.03, 0.40, 2], hb: [-0.014, 0.004, 0.40, 2], hc: [0.014, 0.004, 0.40, 2],
	// the tip of the bill
	t: [0, 0.012, 0.5, 2],
};
const GOOSE_TRIANGLES = [
	['F', 'U', 'R'], ['F', 'R', 'D'], ['F', 'D', 'L'], ['F', 'L', 'U'], ['B', 'R', 'U'], ['B', 'D', 'R'], ['B', 'L', 'D'], ['B', 'U', 'L'],
	['na', 'ha', 'hb'], ['na', 'hb', 'nb'], ['nb', 'hb', 'hc'], ['nb', 'hc', 'nc'], ['nc', 'hc', 'ha'], ['nc', 'ha', 'na'],
	['ha', 'hb', 't'], ['hb', 'hc', 't'], ['hc', 'ha', 't'],
];
// one wing, the right: the shoulder, the elbow and the tip, each front and back
const WING = { s0: [0.05, 0.02, 0.07, 0], s1: [0.05, 0.02, -0.07, 0], e0: [0.26, 0.02, 0.06, 0.5], e1: [0.25, 0.02, -0.08, 0.5], t0: [0.5, 0.02, 0.01, 1], t1: [0.46, 0.02, -0.06, 1] };
const WING_TRIANGLES = [['s0', 'e0', 'e1'], ['s0', 'e1', 's1'], ['e0', 't0', 't1'], ['e0', 't1', 'e1']];
const GOOSE_MESH = (() => {
	const data = [];
	for (const triangle of GOOSE_TRIANGLES) for (const corner of triangle) data.push(...C[corner]);
	for (const mirror of [1, -1]) {
		for (const triangle of WING_TRIANGLES) {
			const corners = mirror > 0 ? triangle : [...triangle].reverse();
			for (const corner of corners) {
				const [x, y, z, out] = WING[corner];
				data.push(x * mirror, y, z, out * mirror);
			}
		}
	}
	return new Float32Array(data);
})();
const GOOSE_VERTICES = GOOSE_MESH.length / 4;
export const GOOSE_TRIANGLE_COUNT = GOOSE_VERTICES / 3;

export const geeseStats = { geese: 0, state: '', landed: 0, leader: 0, triangles: GOOSE_TRIANGLE_COUNT, killed: 0, fallen: 0, respawned: 0, spheres: GOOSE_SPHERES.length };	// for anyone who wants to show it

// Buffers, pipeline
//-------------------------------------------------
const gooseShaderModule = device.createShaderModule({ label: "vf_geese", code: vf_geese });

const meshBuffer = device.createBuffer({ label: "goose mesh", size: GOOSE_MESH.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(meshBuffer, 0, GOOSE_MESH);

const instanceData = new Float32Array(MAX_GEESE * 2 * GOOSE_FLOATS);		// (the living, and the shot ones going into the ground)
const instanceBuffer = device.createBuffer({ label: "goose instances", size: instanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });

const gooseUniformBuffer = device.createBuffer({ label: "goose Uniform", size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

const goosePipeline = device.createRenderPipeline({
	label: "goose pipeline",
	layout: 'auto',
	vertex: {
		module: gooseShaderModule,
		entryPoint: "vertexMain",
		buffers: [
		{
			arrayStride: 16,
			attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }],
		},
		{
			arrayStride: GOOSE_FLOATS * 4,
			stepMode: 'instance',
			attributes: [
				{ format: "float32x4", offset: 0, shaderLocation: 1 },		// where, how big
				{ format: "float32x4", offset: 16, shaderLocation: 2 },		// heading, nose up, bank, wing beat
				{ format: "float32x4", offset: 32, shaderLocation: 3 },		// how hard it is beating, how folded, its own number
			],
		}]
	},
	fragment: { module: gooseShaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },		// (the wings are flat: both sides are seen)
	depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
});

// The skein
//-------------------------------------------------
let geese = [];			// in their order in the V: the leader first, then the arms in turn
let skein = null;		// { state, timer, target: [x, z], spot: { x, z, y }, leadTimer }
let skeinLand = null;
let landingSpots = [];	// places on the lakes and the marshes to come down on
let cruiseY = 0;		// the height they fly at: about the tops of the tallest peaks
let lastTime = performance.now();
let seconds = 0;
let skeinCount = -1;		// the number of geese the skein was made for (settings.geeseCount)
let fallenGeese = [];		// shot, on their way into the ground (fallenBirds.js)
let respawns = [];			// when the next ones come (seconds)

// Shot
//-------------------------------------------------
const NECK_FOOT = [0, 0.02, 0.12];
function gooseSpheres(goose) {
	// (the neck and the head swung up about the neck's foot, as in vf_geese.js)
	const up = 1.2 * goose.folded, cu = Math.cos(up), su = Math.sin(up);
	const lift = (x, y, z) => {
		if (z < 0.2) return [x, y, z];
		const ay = y - NECK_FOOT[1], az = z - NECK_FOOT[2];
		return [x, NECK_FOOT[1] + ay * cu + az * su, NECK_FOOT[2] + az * cu - ay * su];
	};
	return birdSpheres(goose, GOOSE_SPHERES, settings.geeseSize, goose.nose, lift);
}
ballistics.addTarget((ax, ay, az, bx, by, bz) => {
	if (!settings.enableGeese) return null;
	const size = settings.geeseSize;
	if (followed) {
		const found = ballistics.crossAnimals(ax, ay, az, bx, by, bz, followed.filter((one) => one.alive), gooseSpheres, (goose) => [goose.x, goose.y, goose.z, 0.6 * size]);
		return found && { t: found.t, what: 'goose', hit: (velocity) => gooseShot.report?.(found.animal.id, velocity) };
	}
	const found = ballistics.crossAnimals(ax, ay, az, bx, by, bz, geese, gooseSpheres, (goose) => [goose.x, goose.y, goose.z, 0.6 * size]);
	return found && { t: found.t, what: 'goose', hit: (velocity) => killGoose(found.animal, velocity) };
});

function killGoose(goose, velocity) {
	const at = geese.indexOf(goose);
	if (at < 0) return;
	geese.splice(at, 1);
	fallenGeese.push(fallen(goose, velocity));
	respawns.push(seconds + RESPAWN_SECONDS);
	geeseStats.killed++;
}

// a new goose, come to join the skein from far behind it while it is up high (or, with none left, a new skein of one)

// Multiplayer (net.js). The host's geese are everyone's: the host sends them as they are (ANIMAL_RECORD floats each, see
//		gooseShare), and a joiner draws those instead of its own, which stop (gooseFollow). A joiner's shot that hits one is
//		reported to the host (gooseShot), who has it fall, and everyone sees it fall
export const gooseShot = { report: null };
let followed = null;		// joiner: the host's, as they are now
// host: [id, x, y, z, heading, nose, bank, beat, beating, folded, own, alive] for each, the fallen ones too
export function geeseShare() {
	const out = [];
	const add = (bird, alive) => out.push(bird.id ?? 0, bird.x, bird.y, bird.z, bird.heading, bird.nose, bird.bank, bird.beat, bird.beating, bird.folded, bird.own, alive);
	for (const bird of geese) add(bird, 1);
	for (const one of fallenGeese) add(one.bird, 0);
	return new Float32Array(out);
}
// joiner: the host's, as gooseShare's records, or null to go back to its own
export function geeseFollow(records) {
	if (!records) { followed = null; return; }
	followed = [];
	for (let at = 0; at < records.length; at += 12) {
		followed.push({ id: records[at], x: records[at + 1], y: records[at + 2], z: records[at + 3], heading: records[at + 4], nose: records[at + 5], bank: records[at + 6],
			beat: records[at + 7], beating: records[at + 8], folded: records[at + 9], own: records[at + 10], alive: records[at + 11] > 0.5 });
	}
}
// host: one the others shot
export function killGooseById(id, velocity) {
	const goose = geese.find((one) => one.id === id);
	if (goose) killGoose(goose, velocity);
}

function respawnGoose() {
	if (geese.length > 0 && skein.state != 'cruise') return false;
	const leader = geese[0];
	let goose;
	if (leader) {
		const speed = Math.hypot(leader.vx, leader.vz) || 1;
		const x = leader.x - leader.vx / speed * 250, z = leader.z - leader.vz / speed * 250;
		goose = makeGoose(x, leader.y, z, leader.heading);
	} else {
		const start = farPoint();
		goose = makeGoose(start[0], cruiseY, start[1], Math.random() * Math.PI * 2);
		skein.state = 'cruise';
		skein.timer = between(CRUISE_SECONDS);
		skein.target = farPoint();
	}
	geese.push(goose);
	geeseStats.respawned++;
	return true;
}

let nextGooseId = 1;
function makeGoose(x, y, z, heading) {
	return {
		id: nextGooseId++,
		x: x, y: y, z: z, vx: Math.sin(heading) * PACE, vy: 0, vz: Math.cos(heading) * PACE,
		heading: heading, nose: 0, bank: 0, beat: Math.random() * 6.28, beating: 1, folded: 0, own: Math.random(),
		landed: false, home: null, wanderTimer: 0,
	};
}

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const between = ([low, high]) => low + (high - low) * Math.random();
// the ground or the water under a place, whichever is higher
const surfaceAt = (x, z) => Math.max(terrain.land.heightAt(x, z), settings.waterWorldPosY);

function farPoint() {
	const angle = Math.random() * Math.PI * 2, out = ROAM * Math.sqrt(Math.random());
	return [Math.cos(angle) * out, Math.sin(angle) * out];
}

function makeSkein() {
	skeinLand = terrain.land;
	skeinCount = settings.geeseCount;
	fallenGeese = [];
	respawns = [];
	let highest = -Infinity;
	for (const height of terrain.land.heights) highest = Math.max(highest, height);
	cruiseY = Math.max(highest * 0.92, settings.waterWorldPosY + 400);
	const near = [0, 0];
	landingSpots = [
		...terrain.land.findSpawnPoints(terrain.ZONE_LAKE, 16, { seed: 41, minSpacing: 200, near: near, radius: ROAM }),
		...terrain.land.findSpawnPoints(terrain.ZONE_MARSH, 16, { seed: 43, minSpacing: 200, near: near, radius: ROAM, maxSlope: 0.15 }),
	];

	geese = [];
	const count = clamp(Math.round(settings.geeseCount), 0, MAX_GEESE);
	const start = farPoint(), heading = Math.random() * Math.PI * 2;
	for (let g = 0; g < count; g++) {
		const x = start[0] - Math.sin(heading) * g * SLOT_BACK, z = start[1] - Math.cos(heading) * g * SLOT_BACK;
		geese.push(makeGoose(x, cruiseY + Math.random() * 10, z, heading));
	}
	skein = { state: 'cruise', timer: between(CRUISE_SECONDS), target: farPoint(), spot: null, leadTimer: LEAD_SECONDS };
}

// where a goose's place in the V is: index 1 and up, behind the leader and out to the side
function slotFor(index, leader) {
	const rank = Math.ceil(index / 2), side = index % 2 == 1 ? 1 : -1;
	const speed = Math.hypot(leader.vx, leader.vz) || 1;
	const fx = leader.vx / speed, fz = leader.vz / speed;		// the way the leader is going, level
	const rx = fz, rz = -fx;									// its right
	return [leader.x - fx * rank * SLOT_BACK + rx * side * rank * SLOT_OUT, leader.y + rank * 0.8, leader.z - fz * rank * SLOT_BACK + rz * side * rank * SLOT_OUT];
}

// one goose steered towards a velocity it wants, as fast as a goose can change its mind, and its pose worked out from that
function steer(goose, wantX, wantY, wantZ, pace, elapsed) {
	const turnBefore = Math.atan2(goose.vx, goose.vz);
	const give = Math.min(elapsed * 1.5, 1);
	goose.vx += (wantX - goose.vx) * give;
	goose.vz += (wantZ - goose.vz) * give;
	goose.vy += (clamp(wantY, -18, 14) - goose.vy) * Math.min(elapsed * 1.2, 1);
	const speed = Math.hypot(goose.vx, goose.vz) || 0.01;
	const held = clamp(speed, 0.5 * pace, 1.4 * pace);
	goose.vx *= held / speed; goose.vz *= held / speed;
	goose.x += goose.vx * elapsed; goose.y += goose.vy * elapsed; goose.z += goose.vz * elapsed;

	goose.heading = Math.atan2(goose.vx, goose.vz);
	let turned = goose.heading - turnBefore;
	turned -= Math.PI * 2 * Math.round(turned / (Math.PI * 2));
	goose.bank += (clamp(-turned / Math.max(elapsed, 0.001) * 0.8, -0.8, 0.8) - goose.bank) * Math.min(elapsed * 3, 1);
	goose.nose += (Math.atan2(goose.vy, held) * 0.6 - goose.nose) * Math.min(elapsed * 3, 1);
	// geese beat steadily all the way. Only coming down do they glide
	const working = goose.vy < -6 ? 0.25 : 1;
	goose.beating += (working - goose.beating) * Math.min(elapsed * 2, 1);
	goose.beat += elapsed * (5 + 9 * goose.beating);
	goose.folded += (0 - goose.folded) * Math.min(elapsed * 3, 1);
}

// the height a goose in the air may not go under: over the ground under it and ahead of it
function lowest(goose, clearance) {
	return Math.max(surfaceAt(goose.x, goose.z), surfaceAt(goose.x + goose.vx * 4, goose.z + goose.vz * 4)) + clearance;
}

// Every goose of the V moved on (cruise and descend): the leader to `to` [x, z] at the height `height`, the rest by the boids and their places.
//		clearance: how far over the ground they keep
function flyV(to, height, pace, elapsed, clearance = CLEARANCE) {
	const leader = geese[0];
	{
		const dx = to[0] - leader.x, dz = to[1] - leader.z, far = Math.hypot(dx, dz) || 1;
		const y = Math.max(height, lowest(leader, clearance));
		steer(leader, dx / far * pace, (y - leader.y) * 0.5, dz / far * pace, pace, elapsed);
	}
	let midX = 0, midY = 0, midZ = 0, withX = 0, withZ = 0;
	for (const goose of geese) { midX += goose.x; midY += goose.y; midZ += goose.z; withX += goose.vx; withZ += goose.vz; }
	const n = geese.length;
	for (let i = 1; i < n; i++) {
		const goose = geese[i];
		const [sx, sy, sz] = slotFor(i, leader);
		let wantX = leader.vx + (sx - goose.x) * 0.7, wantZ = leader.vz + (sz - goose.z) * 0.7;
		let wantY = (Math.max(sy, lowest(goose, clearance)) - goose.y) * 0.6;
		for (const other of geese) {
			if (other === goose) continue;
			const dx = goose.x - other.x, dy = goose.y - other.y, dz = goose.z - other.z, apart = Math.hypot(dx, dy, dz) || 0.01;
			if (apart < SEPARATION) {
				const push = (SEPARATION - apart) / apart * 1.6;
				wantX += dx * push; wantY += dy * push; wantZ += dz * push;
			}
		}
		wantX += (withX / n - goose.vx) * 0.2 + (midX / n - goose.x) * 0.02;
		wantZ += (withZ / n - goose.vz) * 0.2 + (midZ / n - goose.z) * 0.02;
		wantY += (midY / n - goose.y) * 0.02;
		steer(goose, wantX, wantY, wantZ, pace, elapsed);
	}
}

// Once a frame: the skein moved on
export function geeseUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.05);
	lastTime = now;
	advanceGeese(elapsed);
}

// for testing: the skein moved on by a number of seconds, as if that many had gone by
export function simulateGeese(total) {
	for (let done = 0; done < total; done += 0.05) advanceGeese(0.05);
}

function advanceGeese(elapsed) {
	seconds += elapsed;
	if (followed) return;		// (a joiner's geese are the host's)

	if (!settings.enableGeese || !terrain.land) {
		return;
	}
	// (made again for a new land, or when the number of geese is changed: not when one is shot)
	if (terrain.land !== skeinLand || settings.geeseCount !== skeinCount) {
		makeSkein();
	}
	fallenGeese = moveFallen(fallenGeese, elapsed, surfaceAt, 0.25 * settings.geeseSize);
	if (respawns.length > 0 && respawns[0] <= seconds && respawnGoose()) {
		respawns.shift();
	}
	geeseStats.fallen = fallenGeese.length;
	if (geese.length == 0) {
		return;
	}
	const leader = geese[0];

	if (skein.state == 'cruise') {
		//------------------UP HIGH, IN A V-----------------
		if (Math.hypot(skein.target[0] - leader.x, skein.target[1] - leader.z) < 300) {
			skein.target = farPoint();
		}
		skein.timer -= elapsed;
		if (skein.timer <= 0 && landingSpots.length > 0) {
			const spot = landingSpots[Math.floor(Math.random() * landingSpots.length)];
			skein.spot = { x: spot.x, z: spot.z, y: surfaceAt(spot.x, spot.z) };
			skein.state = 'descend';
		}
		// the one in front drops back now and then
		skein.leadTimer -= elapsed;
		if (skein.leadTimer <= 0 && geese.length > 2) {
			geese.push(geese.shift());
			skein.leadTimer = LEAD_SECONDS;
		}
		flyV(skein.target, cruiseY, PACE, elapsed);
	} else if (skein.state == 'descend') {
		//------------------COMING DOWN, IN A V-----------------
		// straight at it on a long glide while far off, then round and round over it until low
		const spot = skein.spot;
		const far = Math.hypot(spot.x - leader.x, spot.z - leader.z);
		let to = [spot.x, spot.z], height = Math.min(cruiseY, spot.y + 40 + Math.max(far - CIRCLE, 0) / 2.5), clearance = CLEARANCE;
		if (far < CIRCLE * 1.4) {
			clearance = LOW_CLEARANCE;
			const bearing = Math.atan2(leader.z - spot.z, leader.x - spot.x) + 0.6;
			to = [spot.x + Math.cos(bearing) * CIRCLE, spot.z + Math.sin(bearing) * CIRCLE];
			height = Math.max(spot.y + 30, leader.y - 14 * 2);
		}
		flyV(to, height, PACE * 0.85, elapsed, clearance);
		// in to land once low over it, or as low as the ground round it lets them get
		if (far < CIRCLE * 1.6 && leader.y < Math.max(spot.y + 50, lowest(leader, LOW_CLEARANCE) + 25)) {
			// each its own place round the spot, a little apart
			geese.forEach((goose, i) => {
				const angle = i * 2.4, out = 6 + 4 * Math.sqrt(i);
				const x = spot.x + Math.cos(angle) * out, z = spot.z + Math.sin(angle) * out;
				goose.home = { x: x, z: z, y: surfaceAt(x, z), centre: [spot.x, spot.z] };
				goose.landed = false;
			});
			skein.state = 'final';
		}
	} else if (skein.state == 'final') {
		//------------------IN, ONE BY ONE-----------------
		let down = 0;
		for (const goose of geese) {
			if (goose.landed) { down++; continue; }
			const home = goose.home;
			const dx = home.x - goose.x, dz = home.z - goose.z, far = Math.hypot(dx, dz) || 0.01;
			const pace = clamp(far * 0.35, 1, PACE * 0.8);
			// down a slope towards its place, and over any rise on the way in
			let wantY = (Math.max(home.y + Math.min(far * 0.25, 60), far > 25 ? lowest(goose, 8) : -Infinity) - goose.y) * 0.8;
			for (const other of geese) {
				if (other === goose || other.landed) continue;
				const ox = goose.x - other.x, oz = goose.z - other.z, apart = Math.hypot(ox, oz) || 0.01;
				if (apart < SEPARATION * 0.7) { goose.x += ox / apart * elapsed * 3; goose.z += oz / apart * elapsed * 3; }
			}
			steer(goose, dx / far * pace, wantY, dz / far * pace, pace, elapsed);
			goose.beating += (1 - goose.beating) * Math.min(elapsed * 3 * (far < 30 ? 1 : 0), 1);	// back-pedalling in to land
			if (goose.y < surfaceAt(goose.x, goose.z) + 0.2) goose.y = surfaceAt(goose.x, goose.z) + 0.2;
			if (far < 3 && goose.y - home.y < 3) {
				goose.landed = true;
				goose.y = home.y; goose.vx = goose.vz = goose.vy = 0;
				goose.wanderTimer = 0;
				down++;
			}
		}
		if (down == geese.length) {
			skein.state = 'landed';
			skein.timer = between(LANDED_SECONDS);
		}
	} else {
		//------------------ON THE WATER OR THE GROUND-----------------
		// each one wanders slowly round where they came down: a new place every so often, within a short way of the middle
		skein.timer -= elapsed;
		for (const goose of geese) {
			goose.wanderTimer -= elapsed;
			if (goose.wanderTimer <= 0) {
				const angle = Math.random() * Math.PI * 2, out = 18 * Math.sqrt(Math.random());
				const x = goose.home.centre[0] + Math.cos(angle) * out, z = goose.home.centre[1] + Math.sin(angle) * out;
				goose.home = { x: x, z: z, y: surfaceAt(x, z), centre: goose.home.centre };
				goose.wanderTimer = 8 + 12 * Math.random();
			}
			const dx = goose.home.x - goose.x, dz = goose.home.z - goose.z, far = Math.hypot(dx, dz);
			if (far > 0.5) {
				const step = Math.min(1.4 * elapsed, far);
				goose.x += dx / far * step; goose.z += dz / far * step;
				let turn = Math.atan2(dx, dz) - goose.heading;
				turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2));
				goose.heading += turn * Math.min(elapsed * 2, 1);
			}
			goose.y = surfaceAt(goose.x, goose.z);
			goose.folded += (1 - goose.folded) * Math.min(elapsed * 2, 1);
			goose.beating += (0 - goose.beating) * Math.min(elapsed * 3, 1);
			goose.bank += (0 - goose.bank) * Math.min(elapsed * 3, 1);
			goose.nose += (0 - goose.nose) * Math.min(elapsed * 3, 1);
		}
		if (skein.timer <= 0) {
			// off: up and away, the way the leader is facing, and back up to cruise
			for (const goose of geese) {
				goose.landed = false;
				goose.vx = Math.sin(geese[0].heading) * 14; goose.vz = Math.cos(geese[0].heading) * 14; goose.vy = 8;
			}
			skein.state = 'cruise';
			skein.timer = between(CRUISE_SECONDS);
			skein.target = farPoint();
		}
	}

	geeseStats.geese = geese.length;
	geeseStats.state = skein.state;
	geeseStats.landed = geese.filter((goose) => goose.landed).length;
}

// for testing: the shot ones, as they fall and lie
export function fallenGeesePlaces() {
	return fallenGeese.map((one) => ({ x: one.bird.x, y: one.bird.y, z: one.bird.z, falling: one.falling, t: one.t, bank: one.bird.bank }));
}
// for testing: the hitbox of every goose
export function geeseHitboxes() {
	return geese.map(gooseSpheres);
}

// where every goose is, for anyone who wants to know (the harness): [{ x, y, z, landed }, ...], the leader first
export function geesePlaces() {
	return geese.map((goose) => ({ x: goose.x, y: goose.y, z: goose.z, landed: goose.landed, vx: goose.vx, vz: goose.vz }));
}

// for testing: the skein made to come down now, or to take off now
export function hurryGeese(state) {
	if (!skein) return;
	if (state == 'descend') skein.timer = 0;
	if (state == 'cruise' && skein.state == 'landed') skein.timer = 0;
}
// for testing: where they fly up high, and the state of the skein
export function skeinState() {
	return skein ? { state: skein.state, cruiseY: cruiseY, spot: skein.spot, timer: skein.timer, landingSpots: landingSpots.length } : null;
}

// The geese drawn, with the solid things
export function geesePass(aEncoder, mainpassDepthTexture) {
	const drawn = (followed ?? [...geese, ...fallenGeese.map((one) => one.bird)]).slice(0, MAX_GEESE * 2);
	if (!settings.enableGeese || drawn.length == 0) {
		return;
	}
	drawn.forEach((goose, i) => {
		instanceData.set([goose.x, goose.y, goose.z, settings.geeseSize, goose.heading, goose.nose, goose.bank, goose.beat, goose.beating, goose.folded, goose.own, 0], i * GOOSE_FLOATS);
	});
	device.queue.writeBuffer(instanceBuffer, 0, instanceData, 0, drawn.length * GOOSE_FLOATS);

	const bufferResult = [...transformations.getViewProj()];
	bufferResult.push(settings.camPosX, settings.camPosY, settings.camPosZ, 0);
	bufferResult.push(settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, 0, 0);
	const result = new Float32Array(bufferResult);
	device.queue.writeBuffer(gooseUniformBuffer, 0, result.buffer, result.byteOffset, result.byteLength);

	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Geese', 'vf_geese'),
	});
	pass.setPipeline(goosePipeline);
	pass.setBindGroup(0, device.createBindGroup({
		label: "goose bind group",
		layout: goosePipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: gooseUniformBuffer } },
			{ binding: 1, resource: { buffer: uniformBufferLights } },
			{ binding: 2, resource: skyViewLUTtexture.createView() },
			{ binding: 3, resource: linSampler },
		],
	}));
	pass.setVertexBuffer(0, meshBuffer);
	pass.setVertexBuffer(1, instanceBuffer);
	pass.draw(GOOSE_VERTICES, drawn.length, 0, 0);
	pass.end();
}
