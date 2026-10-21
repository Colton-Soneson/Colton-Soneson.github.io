import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_birds } from '../shaders/js/vf_birds.js'
import { buildFlightGrid, findFlightPath } from './birdPaths.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as ballistics from './ballistics.js'
import { birdSpheres, fallen, moveFallen } from './fallenBirds.js'
import * as forest from './forest.js'
import { lightNow } from './lighting.js'

//the birds fade into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	Hawks. A few small groups of them, soaring over the grassland by day and roosting in the forest by night.

	THE BIRD (BIRD_MESH)
		18 flat triangles cut out of one sheet: a body, a fanned tail, and two wings with a finger of feathers at each tip.
		Everything else about its shape in the air (the beat of the wings, the bank into a turn) is put on by the shader.

	THE GROUPS
		Up to 3 groups of 1 to 5 birds. A group has somewhere it is going, and when it gets there it either soars round in
		circles over it (open grassland) or comes down to roost in the trees (forest), each bird on a tree of its own.
		After a while it picks somewhere new. Where it picks is weighted by the time of day: by day 3 times in 4 it is
		grassland, where the hunting is, and by night it is nearly always forest. A group that is roosting when night
		falls stays where it is until morning.

	THE WAY THERE (birdPaths.js)
		A group does not fly straight at where it is going: there may be a mountain in the way. It asks for the cheapest
		way across the land (bidirectional A* over a coarse grid, in which high ground is dear and the peaks are shut)
		and flies from one point of that to the next.

	SUMMONED (summonHawks: the staff's Huginn and Muninn, staff.js): a pair of big hawks (SUMMONED_SIZE times the others' wingspan),
	called up from the ground at a place. They come up out of it and soar low over it for SUMMONED_SECONDS, and then go about as
	the other hawks do. One pair for each player: calling them again sends the old pair away. They are not counted among the groups
	(birdGroups), and when they are shot no others take their place. In a game with others they are the host's, as all the hawks are.

	SHOT (rifle.js): each hawk's hitbox is BIRD_SPHERES, 6 balls: body, tail, and two along each wing (not while folded, on a
	perch). A hawk that is hit falls (fallenBirds.js), out of the air or out of its tree. RESPAWN_SECONDS later another joins
	its group, well away from the camera (or, if the whole group was shot, a new group of one starts over open ground).

	HOW THEY FLY (boids: Reynolds, "Flocks, Herds, and Schools", 1987)
		Nobody leads. Every bird steers by a few simple wants, added together, and the flock is what comes out:
			separation		not to be too close to another bird of its group
			alignment		to be heading the way the birds round it are heading
			cohesion		to be in among them, not off on its own
			and its own business: the next point on the way, or round the circle it is soaring in, or the tree it is landing on
		It can only change its speed and heading so fast, which is what makes the turns wide and smooth, and it banks by how
		hard it is turning.
		Height is kept separately: each bird has a height over the ground it likes (about 100 units over the tree tops, a
		bit more or less from bird to bird), and looks at the ground ahead of it as well as under it, so it starts climbing
		before a hill and not into it.
*/

const MAX_GROUPS = 3;
const MAX_IN_GROUP = 5;
const MAX_BIRDS = MAX_GROUPS * MAX_IN_GROUP;
const BIRD_FLOATS = 12;				// one bird as the shader gets it: place (4), pose (4), state (4)
const CANOPY = 34.0;				// about how tall the trees stand: the birds fly this much higher again over forest
const ROAM = 3300.0;				// how far from the middle of the world they go
const RESPAWN_SECONDS = 120;
const RESPAWN_AWAY = 120;			// metres from the camera, at least
const SUMMONED_SIZE = 2.2;			// times the wingspan of the others
const SUMMONED_SECONDS = 90;		// soaring over where they were called up, before they go their own way
const SUMMONED_RADIUS = 60.0;		// world units, the circle they soar
const MAX_SUMMONED = 4;				// pairs
// the hitbox, a wingspan of 1: x, y, z, radius, and whether it is on a wing (left out while folded)
const BIRD_SPHERES = [[0, 0, 0.02, 0.08], [0, 0, -0.15, 0.06], [0.22, 0.05, 0, 0.09, true], [-0.22, 0.05, 0, 0.09, true], [0.4, 0.06, 0, 0.07, true], [-0.4, 0.06, 0, 0.07, true]];

// The bird: [x, z, how far out along a wing] for every corner (y is 0: it is flat), then the triangles as 3 corner numbers each.
//		It is 1 across from wing tip to wing tip and heads along +z. The left wing is the right one mirrored
const HALF = [
	[0.0, 0.2, 0],			// 0 the beak
	[0.045, 0.06, 0],		// 1 the shoulder (front of the wing where it joins the body)
	[0.03, -0.07, 0],		// 2 the back of the wing where it joins the body
	[0.0, -0.1, 0],			// 3 the rump
	[0.075, -0.2, 0],		// 4 the corner of the tail
	[0.0, -0.215, 0],		// 5 the middle of the end of the tail
	[0.25, 0.1, 0.5],		// 6 the bend of the wing, front
	[0.24, -0.075, 0.5],	// 7 and back
	[0.42, 0.05, 0.85],		// 8 the wrist, front
	[0.39, -0.065, 0.85],	// 9 and back
	[0.5, 0.035, 1],		// 10 the tip of the leading finger
	[0.485, -0.03, 1],		// 11 and of the trailing one
];
const HALF_TRIANGLES = [
	[0, 1, 3],							// the breast (half of it: the other half is the mirror of this)
	[1, 2, 3],							// the back
	[3, 2, 4], [3, 4, 5],				// the tail
	[1, 6, 7], [1, 7, 2],				// the arm of the wing
	[6, 8, 9], [6, 9, 7],				// the hand
	[8, 10, 9],							// the fingers (the notch between the two is the triangle left out)
];
const BIRD_MESH = (() => {
	const data = [];
	for (const mirror of [1, -1]) {
		for (const triangle of HALF_TRIANGLES) {
			for (const corner of triangle) {
				const [x, z, out] = HALF[corner];
				data.push(x * mirror, 0, z, out * mirror);
			}
		}
	}
	return new Float32Array(data);
})();
const BIRD_VERTICES = BIRD_MESH.length / 4;

export const birdStats = { birds: 0, groups: 0, flying: 0, roosting: 0, looked: 0, killed: 0, fallen: 0, respawned: 0, summoned: 0, spheres: BIRD_SPHERES.length };	// for anyone who wants to show it

// Buffers, pipeline
//-------------------------------------------------
const birdShaderModule = device.createShaderModule({ label: "vf_birds", code: vf_birds });

const meshBuffer = device.createBuffer({
	label: "bird mesh",
	size: BIRD_MESH.byteLength,
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(meshBuffer, 0, BIRD_MESH);

const instanceData = new Float32Array((MAX_BIRDS + MAX_SUMMONED * 2) * 2 * BIRD_FLOATS);		// (the living, and the shot ones going into the ground)
const instanceBuffer = device.createBuffer({
	label: "bird instances",
	size: instanceData.byteLength,
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

const birdUniformBuffer = device.createBuffer({
  label: "bird Uniform",
  size: 96,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

const birdPipeline = device.createRenderPipeline({
	label: "bird pipeline",
	layout: 'auto',
	vertex: {
		module: birdShaderModule,
		entryPoint: "vertexMain",
		buffers: [
		{
			// the mesh: once per vertex
			arrayStride: 16,
			attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }],
		},
		{
			// the bird: once per instance
			arrayStride: BIRD_FLOATS * 4,
			stepMode: 'instance',
			attributes: [
				{ format: "float32x4", offset: 0, shaderLocation: 1 },		// where, how big
				{ format: "float32x4", offset: 16, shaderLocation: 2 },		// heading, nose up, bank, wing beat
				{ format: "float32x4", offset: 32, shaderLocation: 3 },		// how hard it is beating, how folded, its own number
			],
		}]
	},
	fragment: {
		module: birdShaderModule,
		entryPoint: "fragmentMain",
		targets: [{
		format: canvasFormat
		}]
	},
	primitive: {
		topology: 'triangle-list',
		cullMode: 'none',			// it is flat: both sides are seen
	},
	depthStencil: {
		depthWriteEnabled: true,
		depthCompare: 'less',
		format: 'depth24plus',
	},
});

// The flock
//-------------------------------------------------
let groups = [];
let flightGrid = null;
let flockLand = null;			// the land the flock was made on
let openGround = [];			// places on the grassland to go to
let lastTime = performance.now();
let seconds = 0;
let fallenBirdsList = [];		// shot, on their way into the ground (fallenBirds.js)

// Shot
//-------------------------------------------------
// (a hawk on a perch sits up: see vf_birds.js)
const sizeOf = (bird) => bird.size ?? (bird.own >= 2 ? SUMMONED_SIZE : 1) * settings.birdSize;		// (a joiner's: a big one's own has 2 added)
const hawkSpheres = (bird) => birdSpheres(bird, BIRD_SPHERES, sizeOf(bird), bird.nose + 1.05 * bird.folded);
ballistics.addTarget((ax, ay, az, bx, by, bz) => {
	if (!settings.enableBirds) return null;
	if (followed) {
		const found = ballistics.crossAnimals(ax, ay, az, bx, by, bz, followed.filter((one) => one.alive), hawkSpheres, (one) => [one.x, one.y, one.z, 0.6 * sizeOf(one)]);
		return found && { t: found.t, what: 'hawk', hit: (velocity) => hawkShot.report?.(found.animal.id, velocity) };
	}
	const living = groups.flatMap((group) => group.birds.map((bird) => ({ bird, group })));
	const found = ballistics.crossAnimals(ax, ay, az, bx, by, bz, living, (one) => hawkSpheres(one.bird), (one) => [one.bird.x, one.bird.y, one.bird.z, 0.6 * sizeOf(one.bird)]);
	return found && { t: found.t, what: 'hawk', hit: (velocity) => killHawk(found.animal.bird, found.animal.group, velocity) };
});

function killHawk(bird, group, velocity) {
	const at = group.birds.indexOf(bird);
	if (at < 0) return;
	group.birds.splice(at, 1);
	fallenBirdsList.push(fallen(bird, velocity));
	if (group.summoned || group.gone) { if (group.birds.length == 0) groups.splice(groups.indexOf(group), 1); }
	else (group.respawns ??= []).push(seconds + RESPAWN_SECONDS);
	birdStats.killed++;
}


// Multiplayer (net.js). The host's hawks are everyone's: the host sends them as they are (ANIMAL_RECORD floats each, see
//		hawkShare), and a joiner draws those instead of its own, which stop (hawkFollow). A joiner's shot that hits one is
//		reported to the host (hawkShot), who has it fall, and everyone sees it fall
export const hawkShot = { report: null };
let followed = null;		// joiner: the host's, as they are now
// host: [id, x, y, z, heading, nose, bank, beat, beating, folded, own, alive] for each, the fallen ones too
export function hawkShare() {
	const out = [];
	const add = (bird, alive) => out.push(bird.id ?? 0, bird.x, bird.y, bird.z, bird.heading, bird.nose, bird.bank, bird.beat, bird.beating, bird.folded, bird.own + (bird.size ? 2 : 0), alive);
	for (const bird of groups.flatMap((group) => group.birds)) add(bird, 1);
	for (const one of fallenBirdsList) add(one.bird, 0);
	return new Float32Array(out);
}
// joiner: the host's, as hawkShare's records, or null to go back to its own
export function hawkFollow(records) {
	if (!records) { followed = null; return; }
	followed = [];
	for (let at = 0; at < records.length; at += 12) {
		followed.push({ id: records[at], x: records[at + 1], y: records[at + 2], z: records[at + 3], heading: records[at + 4], nose: records[at + 5], bank: records[at + 6],
			beat: records[at + 7], beating: records[at + 8], folded: records[at + 9], own: records[at + 10], alive: records[at + 11] > 0.5 });
	}
}
// host: one the others shot
export function killHawkById(id, velocity) {
	for (const group of groups) {
		const bird = group.birds.find((one) => one.id === id);
		if (bird) { killHawk(bird, group, velocity); return; }
	}
}

// a new hawk for a group: in the air, near the rest of it but well away from the camera. With none left, over open ground
function respawnHawk(group) {
	const away = RESPAWN_AWAY * settings.forestUnitsPerMetre;
	for (let attempt = 0; attempt < 12; attempt++) {
		let x, z;
		if (group.birds.length > 0) {
			const middle = groupMiddle(group), angle = Math.random() * Math.PI * 2;
			x = middle[0] + Math.cos(angle) * 150; z = middle[1] + Math.sin(angle) * 150;
		} else if (openGround.length > 0) {
			const spot = openGround[Math.floor(Math.random() * openGround.length)];
			x = spot.x; z = spot.z;
		} else return false;
		if (Math.hypot(x - settings.camPosX, z - settings.camPosZ) < away) continue;
		const bearing = Math.random() * Math.PI * 2;
		group.birds.push(makeBird(x, z, bearing));
		if (group.birds.length == 1) {
			group.state = 'soar';
			group.target = { x: x, z: z, forest: false };
			group.timer = 20 + 30 * Math.random();
		}
		birdStats.respawned++;
		return true;
	}
	return false;
}

let nextBirdId = 1;
function makeBird(x, z, bearing) {
	return {
		id: nextBirdId++,
		x: x, y: groundAt(x, z) + 90 + 40 * Math.random(), z: z,
		vx: -Math.sin(bearing) * 24, vy: 0, vz: Math.cos(bearing) * 24,
		heading: 0, nose: 0, bank: 0, beat: Math.random() * 6.28, beating: 0.2, folded: 0,
		likes: 78 + 44 * Math.random(),		// the height over the tree tops it likes to fly at
		own: Math.random(), perch: null, landed: false,
	};
}

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

// the ground under a place (the sea counts as ground), and whether trees stand on it
function groundAt(x, z) {
	return Math.max(terrain.land.heightAt(x, z), settings.waterWorldPosY);
}
function overForest(x, z) {
	return terrain.land.zoneAt(x, z) == terrain.ZONE_FOREST;
}

// a living tree tall enough to sit in, picked at random. near: [x, z, radius] to pick one close to a place
function pickTree(near) {
	const trees = forest.trees;
	for (let attempt = 0; attempt < 60 && trees.length > 0; attempt++) {
		const tree = trees[Math.floor(Math.random() * trees.length)];
		if (!tree || tree.dead || !tree.height || tree.height < 9 * settings.forestUnitsPerMetre) continue;
		if (Math.hypot(tree.x, tree.z) > ROAM) continue;
		if (near && Math.hypot(tree.x - near[0], tree.z - near[1]) > near[2]) continue;
		return tree;
	}
	return null;
}

// a called up pair's time is up (or they were called again): off on their way as any hawks, and gone once well out of sight
function letGo(group) {
	group.summoned = false;
	group.gone = true;
	group.leaveAt = seconds + 60;
	chooseDestination(group);
}
// Called up (see SUMMONED at the top): a pair of big hawks rising out of the ground at (x, z), world units, for owner (a player's number)
export function summonHawks(x, z, owner = 0) {
	if (!terrain.land || followed) return false;
	if (!flightGrid) makeFlock();
	for (const old of groups.filter((group) => group.summoned && group.owner === owner)) letGo(old);
	// (no more than two pairs on their way out at once: the oldest go)
	const leaving = groups.filter((group) => group.gone);
	while (leaving.length > 2) groups.splice(groups.indexOf(leaving.shift()), 1);
	const summoned = groups.filter((group) => group.summoned);
	if (summoned.length >= MAX_SUMMONED) groups.splice(groups.indexOf(summoned[0]), 1);
	const group = { birds: [], state: "soar", target: { x, z, forest: false }, path: [], at: 0, timer: SUMMONED_SECONDS, radius: SUMMONED_RADIUS, summoned: true, owner };
	for (let b = 0; b < 2; b++) {
		const bearing = b * Math.PI + Math.random() * 0.5;
		const bird = makeBird(x + Math.cos(bearing) * 3, z + Math.sin(bearing) * 3, bearing);
		bird.size = SUMMONED_SIZE * settings.birdSize;
		bird.y = groundAt(x, z) + 4 * settings.forestUnitsPerMetre;
		bird.vy = 10;
		bird.likes = 22 + 10 * b;		// (low over the place: they are there to be seen)
		bird.beating = 1;
		group.birds.push(bird);
	}
	groups.push(group);
	birdStats.summoned++;
	return true;
}

// Makes the flock, on the land as it is now
function makeFlock() {
	flockLand = terrain.land;
	flightGrid = buildFlightGrid(terrain.land, settings.waterWorldPosY);
	openGround = terrain.land.findSpawnPoints(terrain.ZONE_GRASSLAND, 40, { seed: 23, minSpacing: 260, near: [0, -600], radius: ROAM });

	groups = groups.filter((group) => group.summoned || group.gone);		// (the ones called up stay)
	const wanted = clamp(Math.round(settings.birdGroups), 0, MAX_GROUPS);
	for (let g = 0; g < wanted && openGround.length > 0; g++) {
		// each starts in the air over a stretch of grassland, the first of them over the nearest to where the camera starts
		const place = g == 0 ? openGround.reduce((best, spot) => Math.hypot(spot.x, spot.z + 150) < Math.hypot(best.x, best.z + 150) ? spot : best) : openGround[Math.floor(Math.random() * openGround.length)];
		const size = 1 + Math.floor(Math.random() * MAX_IN_GROUP);
		const group = { birds: [], state: "soar", target: { x: place.x, z: place.z, forest: false }, path: [], at: 0, timer: 15 + 30 * Math.random(), radius: 110 + 90 * Math.random() };
		for (let b = 0; b < size; b++) {
			const bearing = Math.random() * Math.PI * 2, out = 40 + 80 * Math.random();
			group.birds.push(makeBird(place.x + Math.cos(bearing) * out, place.z + Math.sin(bearing) * out, bearing));
		}
		groups.push(group);
	}
}

// Somewhere new for a group to go, and the way there (see THE GROUPS and THE WAY THERE at the top of the file)
function chooseDestination(group) {
	const day = lightNow().daylight > 0.35;
	const middle = groupMiddle(group);
	for (let attempt = 0; attempt < 6; attempt++) {
		let target = null;
		if (Math.random() < (day ? 0.25 : 0.92)) {
			const tree = pickTree(null);
			if (tree) target = { x: tree.x, z: tree.z, forest: true };
		} else if (openGround.length > 0) {
			const spot = openGround[Math.floor(Math.random() * openGround.length)];
			target = { x: spot.x, z: spot.z, forest: false };
		}
		if (!target || Math.hypot(target.x - middle[0], target.z - middle[1]) < 250) continue;
		const way = findFlightPath(flightGrid, middle, [target.x, target.z]);
		if (!way) continue;
		birdStats.looked = way.looked;
		group.target = target;
		group.path = way.points;
		group.at = Math.min(1, way.points.length - 1);		// (the first point is the square it is already in)
		group.state = "travel";
		for (const bird of group.birds) {
			bird.perch = null;
			bird.landed = false;
		}
		return;
	}
	// nowhere to go just now: carry on round where it is, and ask again shortly
	group.state = "soar";
	group.target = { x: middle[0], z: middle[1], forest: false };
	group.timer = 10;
}

function groupMiddle(group) {
	let x = 0, z = 0;
	for (const bird of group.birds) { x += bird.x; z += bird.z; }
	return [x / group.birds.length, z / group.birds.length];
}

// a tree each for the birds of a group to come down on, round where the group was going
function assignPerches(group) {
	const taken = new Set();
	for (const bird of group.birds) {
		let tree = null;
		for (let attempt = 0; attempt < 8 && !tree; attempt++) {
			const found = pickTree([group.target.x, group.target.z, 110 + 40 * attempt]);
			if (found && !taken.has(found)) tree = found;
		}
		if (tree) {
			taken.add(tree);
			bird.perch = { tree: tree, x: tree.x, y: tree.y + 0.93 * tree.height, z: tree.z };
		} else {
			bird.perch = null;
		}
		bird.landed = false;
	}
}

// One bird moved on by a moment. wants: where it is trying to get to [x, z], pace: how fast it wants to go, low: the height it is trying to hold (world y)
function flyBird(bird, group, wants, pace, low, elapsed) {
	// its own business: towards where it wants to be, at the pace it wants
	let toX = wants[0] - bird.x, toZ = wants[1] - bird.z;
	const far = Math.hypot(toX, toZ) || 1;
	let wantX = toX / far * pace, wantZ = toZ / far * pace;

	// the flock (see HOW THEY FLY at the top of the file)
	let awayX = 0, awayZ = 0, withX = 0, withZ = 0, midX = 0, midZ = 0, others = 0;
	for (const other of group.birds) {
		if (other === bird || other.landed) continue;
		const dx = bird.x - other.x, dz = bird.z - other.z, apart = Math.hypot(dx, dz, bird.y - other.y) || 0.01;
		if (apart < 22) {
			awayX += dx / apart * (22 - apart); awayZ += dz / apart * (22 - apart);
		}
		withX += other.vx; withZ += other.vz; midX += other.x; midZ += other.z;
		others++;
	}
	if (others > 0) {
		wantX += awayX * 1.4 + (withX / others - bird.vx) * 0.35 + (midX / others - bird.x) * 0.045;
		wantZ += awayZ * 1.4 + (withZ / others - bird.vz) * 0.35 + (midZ / others - bird.z) * 0.045;
	}

	// it can only change its mind so fast
	const turnBefore = Math.atan2(bird.vx, bird.vz);
	const give = Math.min(elapsed * 1.1, 1);
	bird.vx += (wantX - bird.vx) * give;
	bird.vz += (wantZ - bird.vz) * give;
	const speed = Math.hypot(bird.vx, bird.vz) || 0.01;
	const held = clamp(speed, 0.55 * pace, 1.3 * pace);
	bird.vx *= held / speed; bird.vz *= held / speed;

	// height: over the ground under it and the ground it is about to be over, whichever is higher
	const ahead = groundAt(bird.x + bird.vx * 5, bird.z + bird.vz * 5);
	const wantY = clamp((Math.max(low, ahead + (low - groundAt(bird.x, bird.z)) * 0.6) - bird.y) * 0.7, -11, 13);
	bird.vy += (wantY - bird.vy) * Math.min(elapsed * 1.6, 1);

	bird.x += bird.vx * elapsed; bird.y += bird.vy * elapsed; bird.z += bird.vz * elapsed;

	// how it sits in the air: heading where it is going, nose up or down with its climb, banked by how hard it is turning
	bird.heading = Math.atan2(bird.vx, bird.vz);
	let turned = bird.heading - turnBefore;
	turned -= Math.PI * 2 * Math.round(turned / (Math.PI * 2));
	bird.bank += (clamp(-turned / Math.max(elapsed, 0.001) * 0.8, -0.95, 0.95) - bird.bank) * Math.min(elapsed * 3, 1);
	bird.nose += (Math.atan2(bird.vy, held) - bird.nose) * Math.min(elapsed * 4, 1);
	// it beats its wings to climb, and now and then on the level. The rest of the time it glides
	const working = bird.vy > 2.5 || Math.sin(seconds * 0.45 + bird.own * 40) > 0.72 ? 1 : 0.12;
	bird.beating += (working - bird.beating) * Math.min(elapsed * 2.5, 1);
	bird.beat += elapsed * (5 + 6 * bird.beating);
	bird.folded += (0 - bird.folded) * Math.min(elapsed * 4, 1);
}

// Once a frame: every group and every bird moved on
export function birdUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.05);
	lastTime = now;
	advanceBirds(elapsed);
}

// for testing: the hawks moved on by a number of seconds, as if that many had gone by
export function simulateBirds(total) {
	for (let done = 0; done < total; done += 0.05) advanceBirds(0.05);
}

function advanceBirds(elapsed) {
	seconds += elapsed;
	if (followed) return;		// (a joiner's hawks are the host's)

	if (!settings.enableBirds || !terrain.land) {
		return;
	}
	// (a pair let go goes once it is out of sight, or long after)
	groups = groups.filter((group) => !group.gone || seconds < group.leaveAt || (seconds < group.leaveAt + 300 && group.birds.some((bird) => Math.hypot(bird.x - settings.camPosX, bird.z - settings.camPosZ) < 400)));
	if (terrain.land !== flockLand || groups.filter((group) => !group.summoned && !group.gone).length != clamp(Math.round(settings.birdGroups), 0, MAX_GROUPS)) {
		makeFlock();
	}
	const day = lightNow().daylight > 0.35;
	const speed = 26 * settings.birdSpeed;

	// the shot ones, and the ones that take their places
	fallenBirdsList = moveFallen(fallenBirdsList, elapsed, groundAt, 0.2 * settings.birdSize);
	birdStats.fallen = fallenBirdsList.length;
	for (const group of groups) {
		const respawns = group.respawns ?? [];
		if (respawns.length > 0 && respawns[0] <= seconds) {
			if (respawnHawk(group)) respawns.shift();
			else respawns[0] = seconds + 10;
		}
	}

	birdStats.flying = 0; birdStats.roosting = 0;
	for (const group of groups) {
		if (group.birds.length == 0) continue;		// (all of it shot: until the new ones come)
		const middle = groupMiddle(group);

		if (group.state == "travel") {
			//------------------ON THE WAY-----------------
			const point = group.path[group.at];
			if (Math.hypot(point[0] - middle[0], point[1] - middle[1]) < 170) {
				if (group.at < group.path.length - 1) {
					group.at++;
				} else if (group.target.forest) {
					assignPerches(group);
					group.state = "land";
				} else {
					group.state = "soar";
					group.timer = 35 + 55 * Math.random();
					group.radius = 110 + 90 * Math.random();
				}
			}
			for (const bird of group.birds) {
				const low = groundAt(bird.x, bird.z) + (overForest(bird.x, bird.z) ? CANOPY : 0.4 * CANOPY) + bird.likes;
				flyBird(bird, group, group.path[group.at], speed, low, elapsed);
			}
		} else if (group.state == "soar") {
			//------------------ROUND AND ROUND-----------------
			// each bird heads for the point on the circle a little way round from where it is: that takes it round
			group.timer -= elapsed;
			if (group.summoned && group.timer <= 0) letGo(group);		// (their time over the place is up: hawks like any others now)
			else if (!group.summoned && (group.timer <= 0 || (!day && Math.random() < elapsed * 0.2))) {
				chooseDestination(group);
			}
			for (const bird of group.birds) {
				const bearing = Math.atan2(bird.z - group.target.z, bird.x - group.target.x) + 0.55;
				const round = group.radius * (0.75 + 0.5 * bird.own);
				const low = groundAt(bird.x, bird.z) + (overForest(bird.x, bird.z) ? CANOPY : 0.4 * CANOPY) + bird.likes + 18 * Math.sin(seconds * 0.11 + bird.own * 9);
				flyBird(bird, group, [group.target.x + Math.cos(bearing) * round, group.target.z + Math.sin(bearing) * round], speed * 0.78, low, elapsed);
			}
		} else if (group.state == "land") {
			//------------------COMING DOWN-----------------
			let down = 0;
			for (const bird of group.birds) {
				// (its tree may have fallen while it was on its way. Then it finds another)
				if (bird.perch && bird.perch.tree.dead) {
					bird.perch = null;
				}
				if (!bird.perch) {
					const tree = pickTree([group.target.x, group.target.z, 260]);
					if (tree) bird.perch = { tree: tree, x: tree.x, y: tree.y + 0.93 * tree.height, z: tree.z };
				}
				if (bird.landed || !bird.perch) {
					down++;
					continue;
				}
				// lower and slower the nearer it gets, and once it is right over the tree, on to it
				const off = Math.hypot(bird.perch.x - bird.x, bird.perch.z - bird.z);
				const low = bird.perch.y + Math.min(off * 0.3, bird.likes);
				flyBird(bird, group, [bird.perch.x, bird.perch.z], clamp(off * 0.4, 7, speed), low, elapsed);
				bird.beating += (1 - bird.beating) * Math.min(elapsed * 3 * (off < 40 ? 1 : 0), 1);
				if (off < 4 && Math.abs(bird.y - bird.perch.y) < 5) {
					bird.landed = true;
					bird.x = bird.perch.x; bird.y = bird.perch.y; bird.z = bird.perch.z;
					bird.vx = 0; bird.vy = 0; bird.vz = 0;
					down++;
				}
			}
			if (down == group.birds.length) {
				group.state = "roost";
				group.timer = 30 + 50 * Math.random();
			}
		} else {
			//------------------IN THE TREES-----------------
			// by night they stay. By day they are off again after a while (or at once, if a tree goes from under one)
			group.timer -= day ? elapsed : 0;
			const lost = group.birds.some((bird) => bird.perch && bird.perch.tree.dead);
			if (group.timer <= 0 || lost) {
				for (const bird of group.birds) {
					// off the branch: up and out, whichever way it was facing
					bird.vx = Math.sin(bird.heading) * 9; bird.vz = Math.cos(bird.heading) * 9; bird.vy = 6;
				}
				chooseDestination(group);
			}
		}

		// a bird on its tree: wings folded, the tree's sway is not followed
		for (const bird of group.birds) {
			if (bird.landed) {
				bird.folded += (1 - bird.folded) * Math.min(elapsed * 3, 1);
				bird.beating += (0 - bird.beating) * Math.min(elapsed * 3, 1);
				bird.bank += (0 - bird.bank) * Math.min(elapsed * 3, 1);
				bird.nose += (0 - bird.nose) * Math.min(elapsed * 3, 1);
				birdStats.roosting++;
			} else {
				birdStats.flying++;
			}
		}
	}
	birdStats.groups = groups.length;
	birdStats.birds = birdStats.flying + birdStats.roosting;
}

// for testing: the shot ones, as they fall and lie
export function fallenHawks() {
	return fallenBirdsList.map((one) => ({ x: one.bird.x, y: one.bird.y, z: one.bird.z, falling: one.falling, t: one.t }));
}
// for testing: the hitbox of every hawk
export function hawkHitboxes() {
	return groups.flatMap((group) => group.birds.map(hawkSpheres));
}

// where every bird is, for anyone who wants to know (the harness, to point a camera at one): [{ x, y, z, landed }, ...]
export function birdPlaces() {
	return groups.flatMap((group) => group.birds.map((bird) => ({ x: bird.x, y: bird.y, z: bird.z, landed: bird.landed, state: group.state, big: !!bird.size, summoned: !!group.summoned })));
}

// The birds drawn, with the solid things
export function birdPass(aEncoder, mainpassDepthTexture) {
	if (!settings.enableBirds || (!followed && groups.length == 0)) {
		return;
	}
	let count = 0;
	const drawn = (followed ?? [...groups.flatMap((group) => group.birds), ...fallenBirdsList.map((one) => one.bird)]).slice(0, (MAX_BIRDS + MAX_SUMMONED * 2) * 2);
	for (const bird of drawn) {
		instanceData.set([bird.x, bird.y, bird.z, sizeOf(bird), bird.heading, bird.nose, bird.bank, bird.beat, bird.beating, bird.folded, bird.own % 2, 0], count * BIRD_FLOATS);
		count++;
	}
	if (count == 0) {
		return;
	}
	device.queue.writeBuffer(instanceBuffer, 0, instanceData, 0, count * BIRD_FLOATS);

	const bufferResult = [];
	const viewProjectionMatrix = transformations.getViewProj();
	for(let i = 0; i < 16; i++) {
		bufferResult.push(viewProjectionMatrix[i]);
	}
	bufferResult.push(settings.camPosX, settings.camPosY, settings.camPosZ, 0);
	bufferResult.push(settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, 0, 0);
	const result = new Float32Array(bufferResult);
	device.queue.writeBuffer(birdUniformBuffer, 0, result.buffer, result.byteOffset, result.byteLength);

	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{
			view: context.getCurrentTexture().createView(),
			loadOp: "load",
			storeOp: "store",
		}],
		depthStencilAttachment: {
			view: mainpassDepthTexture.createView(),
			depthLoadOp: 'load',
			depthStoreOp: 'store',
		},
		timestampWrites: profiler.timestamps('Hawks', 'vf_birds'),
	});
	pass.setPipeline(birdPipeline);
	pass.setBindGroup(0, device.createBindGroup({
		label: "bird bind group",
		layout: birdPipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: birdUniformBuffer } },
			{ binding: 1, resource: { buffer: uniformBufferLights } },
			{ binding: 2, resource: skyViewLUTtexture.createView() },
			{ binding: 3, resource: linSampler },
		],
	}));
	pass.setVertexBuffer(0, meshBuffer);
	pass.setVertexBuffer(1, instanceBuffer);
	pass.draw(BIRD_VERTICES, count, 0, 0);
	pass.end();
}
