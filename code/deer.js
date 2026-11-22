import { DEPTH_FORMAT, depthTest, DEPTH_CLEAR } from './depthMode.js'
import { stepFor, rateFrame } from './rates.js'
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
import * as hearing from './hearing.js'

//the deer fade into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'
import {sunCycles} from './atmosphere.js'
import { DEER_KINDS, ELK, CARIBOU, kindOf, isMale, hasAntlers, sizeOfOwn, cutAntlers, newOwn, pickKind } from './deerKinds.js'
import { ANATOMY, woundFrom, otherWound, cleanWound, bleedOf, recordOf, vital } from './anatomy.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	Deer. Small groups (settings.deerGroups, 4 to start with and up to MAX_GROUPS, of 1 to 3 each, or 4 of some kinds), living in the forest and going down to
	the water to drink. And herds of elk and of caribou (3 to 6 each), in the forest and out on the grass (THE GROUPS).
	SEVEN KINDS (deerKinds.js): the white-tailed deer, the mule deer, the black-tailed deer, the fallow deer, the roe deer, the elk and the
		caribou. Each group is all of one kind.

	THE DEER (DEER_MESH)
		In metres, a white-tailed deer's, life size: a body in rings (eight sided: deepest at the chest over the front legs), a neck and a head, ears, a tail, four legs from hip to
		hoof, and the antlers of every kind, each a part of its own. The legs walk and the head goes down to graze and to drink in the shader
		(vf_deer.js), which only needs to know where each deer is in its stride and how far down its head is; it makes it its kind's size,
		with its ears, its tail, its antlers and its coat.
		MALES AND FEMALES: each kind's share of males (deerKinds.js: bucks), a little bigger, and only they have antlers (and a caribou's
		cows: smaller ones). All of it is in own (deerKinds.js: OWN): so it goes with the deer's record to everyone, as it is.

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

	SPOOKED (the Survival mode): a player heard within SPOOK (hearing.js: further off running or coughing, nearer crouched or still), and the group runs off from them for FLEE seconds.

	THE DEER'S DAY is the world's: a round of the sun (sunCycles in atmosphere.js, settings.dayLengthSeconds long). They go to the
		water at three times spread through each day. While the sun is stood still no day goes by, and they only wander.
		(A very fast Time Multiplier leaves them too little time to walk there and back three times: then they go as often
		as they can)

	SHOT (rifle.js, ballistics.js). Each deer's hitbox is DEER_SPHERES (anatomy.js's: the body, the neck and the head, which go down
		with the head, and the legs), and inside it its organs: each round is a wound (anatomy.js: woundOf), and what it went through says
		what comes of it (bleedOf). Its brain or its spine, it drops. Its heart, lungs, liver or guts, its group runs off from the shot,
		and it goes down when its blood is gone (RUN_SECONDS on at the most). Meat only, they run, and it bleeds out slowly (minutes, and
		no RUN_SECONDS: it goes down wherever it is by then; another shot adds to it). Once dead it keeps the record of it (recordOf: its wounds, how long it took, its pelt's quality; inspect.js
		shows it). A shell, or a wolf: dead at once (otherWound). A deer that is dead falls over on to its side, away from the shot
		(FALL_SECONDS), lies there (LIE_SECONDS; in the Survival mode SURVIVAL_LIE_SECONDS, with CUTS on it for a hatchet or a knife, one at a time: a buck's antlers, then venison
		and sinew: butcher, survivalTools.js, and it goes once they are all cut), sinks into the ground (SINK_SECONDS) and is gone. RESPAWN_SECONDS later another
		joins its group, at its home in the forest (or somewhere else in the forest round it), never nearer the camera than
		RESPAWN_AWAY.

	THE GROUND under a deer is the exact ground (land.groundAt, what the mesh is made from), which is slow to work out. So it
	is only worked out again when the deer has gone GROUND_AGAIN from where it last was. In between, the change in the
	cheap data grid height (land.heightAt) is added to it.
*/

const MAX_GROUPS = 200;
const MAX_IN_GROUP = 6;			// (the most of any kind's: deerKinds.js. A white-tailed deer's are 1 to 3)
const MAX_DEER = MAX_GROUPS * MAX_IN_GROUP * 1.5;	// (and the elk and the caribou, groups of their own: THE GROUPS)
const MAX_DRAWN = MAX_DEER * 2 + 3400;	// the living and the shot ones still going into the ground, and the others drawn with them (addDrawn: the horde)
const HOME_SPACINGS = [250, 180, 120];	// world units between homes: the widest first, closer only when they do not all fit
const REHERD_SECONDS = 0.4;		// a new number of groups is made once it has held this long (a dragged slider goes through every number)
const DEER_FLOATS = 12;				// one deer as the shader gets it: place (4), pose (4), state (4)
const TRIPS_A_DAY = 3;
const TRIP_SPARE = 25;				// seconds more than a trip should take, when working out whether the day is running out on them
const WALK = 1.3, TROT = 4.0;		// metres a second: wandering, and going to and from the water
const WANDER = 80;					// metres round home they wander
const NEAR_TOWN = { groups: 2, out: [250, 650] };	// groups more by each town, metres from its middle: game for its hunters (npcHunters.js)
const DRINK_SECONDS = [12, 20];
const GRAZE_SECONDS = [6, 18];
const STRIDE = 1.4;					// metres a stride takes
const STEEPEST = 1.0;				// rise over run a deer will walk up: 45 degrees
const STUCK_SECONDS = 6;			// going to the water and getting no nearer for this long, it tries somewhere else to drink
const GROUND_AGAIN = 0.5;			// metres
const FALL_SECONDS = 0.7, LIE_SECONDS = 6, SINK_SECONDS = 4;
const SURVIVAL_LIE_SECONDS = 600;
const CUTS = ['venison', 'sinew', 'deerHide', 'venison', 'venison', 'sinew', 'venison'];
const lieOf = (corpse) => corpse.lie ?? (settings.gameMode == 'Hunting' ? SURVIVAL_LIE_SECONDS : LIE_SECONDS);
const SINK_DEPTH = 0.7;				// metres it goes down into the ground
const RESPAWN_SECONDS = 120;
const RESPAWN_AWAY = 60;			// metres
const SPOOK = 22, FLEE = 9;			// metres, seconds
// the hitbox, in the deer's own metres: x, y, z, radius, and whether it goes down with the head (see vf_deer.js)
const DEER_SPHERES = ANATOMY.deer.body;
const RUN_SECONDS = 12;			// the most a deer shot through its heart, lungs, liver or guts runs before it goes down

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
// the sides between rings of corners (each the same number, in order round it), and the first and the last closed if asked
function rings(into, list, part, capFirst = false, capLast = false) {
	const n = list[0].length;
	for (let i = 0; i < list.length - 1; i++) for (let k = 0; k < n; k++) {
		const j = (k + 1) % n;
		into.push([list[i][k], list[i + 1][k], list[i + 1][j], part], [list[i][k], list[i + 1][j], list[i][j], part]);
	}
	const last = list[list.length - 1];
	if (capFirst) for (let k = 1; k < n - 1; k++) into.push([list[0][0], list[0][k + 1], list[0][k], part]);
	if (capLast) for (let k = 1; k < n - 1; k++) into.push([last[0], last[k], last[k + 1], part]);
}
// a ring of corners round a line along z (its plane upright): half widths w across, h up, about (0, y)
const acrossZ = (z, w, y0, y1, n = 8) => Array.from({ length: n }, (_, k) => { const a = (k + 0.5) / n * Math.PI * 2, y = (y0 + y1) / 2, h = (y1 - y0) / 2; return [Math.cos(a) * w, y + Math.sin(a) * h, z]; });
// a ring across the way from a place going towards the next (the neck, the head): at c, w across and h the other way, the axis the way it runs
const ringAlong = (c, axis, w, h, n = 6) => {
	const l = Math.hypot(...axis), d = axis.map((v) => v / l), up = [0, d[2], -d[1]];
	return Array.from({ length: n }, (_, k) => { const a = (k + 0.5) / n * Math.PI * 2; return [c[0] + Math.cos(a) * w, c[1] + up[1] * Math.sin(a) * h, c[2] + up[2] * Math.sin(a) * h]; });
};
const ANTLER_RANGES = {};		// each kind's antlers in DEER_MESH: part: [first vertex, vertices]
export const DEER_MESH = (() => {
	const triangles = [];
	// the body, rump to chest: its belly drawn up behind, the barrel of its ribs deepening forward to the chest, deepest and widest over
	//		the front legs, and the brisket rounding down in front of them below the neck
	//		(as deep as a white-tailed deer's: the bottom of its chest about half way down its front legs, its barrel nearly as wide)
	rings(triangles, [acrossZ(-0.68, 0.06, 0.94, 1.08), acrossZ(-0.58, 0.14, 0.8, 1.15), acrossZ(-0.32, 0.18, 0.72, 1.16), acrossZ(-0.02, 0.19, 0.68, 1.15), acrossZ(0.22, 0.2, 0.62, 1.17),
		acrossZ(0.4, 0.2, 0.58, 1.21), acrossZ(0.53, 0.18, 0.6, 1.23), acrossZ(0.62, 0.13, 0.7, 1.22), acrossZ(0.69, 0.07, 0.82, 1.17)], 0, true, true);
	// the neck
	// the neck (thick where it meets the chest)
	const neck = [[0, 1.08, 0.47, 0.13, 0.19], [0, 1.25, 0.56, 0.095, 0.12], [0, 1.38, 0.63, 0.062, 0.078], [0, 1.47, 0.68, 0.052, 0.066]];
	rings(triangles, neck.map(([x, y, z, w, h], k) => ringAlong([x, y, z], [0, 0.82, 0.57], w, h)), 1);
	// the head: from behind the ears down to the muzzle, closed at both ends
	const head = [[0, 1.5, 0.62, 0.052, 0.062], [0, 1.49, 0.7, 0.07, 0.08], [0, 1.46, 0.78, 0.054, 0.058], [0, 1.425, 0.87, 0.038, 0.04], [0, 1.4, 0.94, 0.024, 0.024]];
	rings(triangles, head.map(([x, y, z, w, h]) => ringAlong([x, y, z], [0, -0.25, 1], w, h)), 1, true, true);
	// the ears (a thin leaf each, both ways), and the tail
	for (const side of [-1, 1]) {
		const a = [0.035 * side, 1.54, 0.67], b = [0.05 * side, 1.55, 0.62], c = [0.1 * side, 1.61, 0.655], e = [0.17 * side, 1.65, 0.625];
		triangles.push([a, c, b, 1.25], [c, e, b, 1.25], [a, b, c, 1.25], [c, b, e, 1.25]);		// (1.25: the ears, each kind's size: deerKinds.js)
	}
	tube(triangles, [0, 1.06, -0.66], [0, 0.93, -0.75], 0.045, 0.012, 3, 0.25);		// (0.25: the tail, the same)
	// the legs: left front, right front, left hind, right hind: hip, knee, down the cannon bone, the hoof
	[[-0.095, 0.4], [0.095, 0.4], [-0.095, -0.45], [0.095, -0.45]].forEach(([x, z], leg) => {
		const hind = z < 0, ring = (y, w, d, off = 0) => [[x - w, y, z - d + off], [x + w, y, z - d + off], [x + w, y, z + d + off], [x - w, y, z + d + off]];
		rings(triangles, [ring(0.9, 0.05, hind ? 0.12 : 0.085), ring(0.46, 0.028, 0.038, hind ? -0.02 : 0), ring(0.14, 0.018, 0.022, 0.01), ring(0.05, 0.022, 0.03, 0.015), ring(0, 0.025, 0.036, 0.02)], 2 + leg);
	});
	// the antlers, each kind's a part of its own (6 on: deerKinds.js; only those of the deer's kind drawn, and only on one with antlers,
	//		vf_deer.js), from behind each ear. A beam through the points given, radius r0 at its foot to r1 at its tip, and tines off it
	const beam = (points, r0, r1, part) => { for (let k = 0; k < points.length - 1; k++) tube(triangles, points[k], points[k + 1], r0 + (r1 - r0) * k / (points.length - 1), r0 + (r1 - r0) * (k + 1) / (points.length - 1), 3, part); };
	const palm = (points, part) => { for (let k = 1; k < points.length - 1; k++) triangles.push([points[0], points[k], points[k + 1], part]); };	// (a flat fan, both ways: no culling)
	for (const side of [-1, 1]) {
		const s = (x, y, z) => [x * side, y, z];
		// 6, a white-tailed deer's: the beam out and up and curving forward, the tines standing up off it
		const bend = s(0.13, 1.72, 0.6);
		beam([s(0.03, 1.555, 0.655), bend, s(0.1, 1.86, 0.8)], 0.016, 0.004, 6);
		tube(triangles, bend, s(0.17, 1.92, 0.58), 0.009, 0.003, 3, 6);
		tube(triangles, s(0.12, 1.78, 0.68), s(0.04, 1.9, 0.68), 0.008, 0.003, 3, 6);
		tube(triangles, s(0.11, 1.76, 0.73), s(0.08, 1.88, 0.76), 0.007, 0.003, 3, 6);
		// 7, a mule deer's and a black-tailed deer's: up and out, forked, and each fork forked again
		const fork = s(0.14, 1.71, 0.62), front = s(0.18, 1.84, 0.7), back = s(0.22, 1.85, 0.55);
		beam([s(0.03, 1.555, 0.655), fork], 0.016, 0.012, 7);
		beam([fork, front], 0.012, 0.008, 7); beam([fork, back], 0.012, 0.008, 7);
		tube(triangles, front, s(0.16, 1.96, 0.77), 0.008, 0.003, 3, 7); tube(triangles, front, s(0.23, 1.95, 0.7), 0.008, 0.003, 3, 7);
		tube(triangles, back, s(0.25, 1.98, 0.6), 0.008, 0.003, 3, 7); tube(triangles, back, s(0.3, 1.93, 0.5), 0.008, 0.003, 3, 7);
		tube(triangles, s(0.06, 1.61, 0.66), s(0.08, 1.66, 0.72), 0.006, 0.002, 3, 7);
		// 8, a fallow deer's: a short round beam with a brow tine, then broad and flat, a palm with points along its back edge
		const P0 = s(0.11, 1.71, 0.62);
		beam([s(0.03, 1.555, 0.655), P0], 0.016, 0.013, 8);
		tube(triangles, s(0.07, 1.63, 0.64), s(0.09, 1.66, 0.74), 0.008, 0.003, 3, 8);
		tube(triangles, s(0.1, 1.69, 0.63), s(0.12, 1.73, 0.71), 0.007, 0.003, 3, 8);
		palm([P0, s(0.14, 1.8, 0.64), s(0.17, 1.93, 0.6), s(0.2, 2.0, 0.52), s(0.24, 1.97, 0.43), s(0.24, 1.88, 0.42), s(0.2, 1.8, 0.5), s(0.15, 1.74, 0.56)], 8);
		for (const [a, b] of [[[0.17, 1.93, 0.6], [0.18, 2.0, 0.63]], [[0.2, 2.0, 0.52], [0.21, 2.07, 0.5]], [[0.24, 1.97, 0.43], [0.27, 2.01, 0.38]], [[0.24, 1.88, 0.42], [0.28, 1.88, 0.36]]])
			tube(triangles, s(...a), s(...b), 0.007, 0.002, 3, 8);
		// 9, a roe deer's: short and nearly upright, rough at the foot, a tine forward and one back
		beam([s(0.03, 1.555, 0.655), s(0.04, 1.68, 0.65), s(0.045, 1.8, 0.63)], 0.017, 0.004, 9);
		tube(triangles, s(0.04, 1.67, 0.65), s(0.05, 1.72, 0.71), 0.007, 0.002, 3, 9);
		tube(triangles, s(0.044, 1.75, 0.64), s(0.05, 1.79, 0.58), 0.006, 0.002, 3, 9);
		// 10, an elk's: a long beam swept up and back over the shoulders, the tines standing forward and up off it, the fourth the longest
		const E = [s(0.03, 1.555, 0.655), s(0.1, 1.66, 0.62), s(0.19, 1.84, 0.52), s(0.26, 2.02, 0.36), s(0.27, 2.17, 0.2), s(0.22, 2.25, 0.06)];
		beam(E, 0.026, 0.006, 10);
		for (const [at, to] of [[[0.08, 1.63, 0.63], [0.11, 1.64, 0.88]], [[0.11, 1.68, 0.61], [0.14, 1.73, 0.84]], [[0.19, 1.84, 0.52], [0.23, 2.0, 0.66]],
			[[0.26, 2.02, 0.36], [0.31, 2.25, 0.46]], [[0.27, 2.17, 0.2], [0.29, 2.34, 0.25]]]) tube(triangles, s(...at), s(...to), 0.012, 0.004, 3, 10);
		// 11, a caribou's: back and up and round forward in a C, a flat shovel over the face from its foot, a palm of points at its top
		const B = [s(0.03, 1.555, 0.655), s(0.1, 1.7, 0.57), s(0.17, 1.9, 0.46), s(0.21, 2.08, 0.45), s(0.2, 2.21, 0.55), s(0.16, 2.27, 0.66)];
		beam(B, 0.018, 0.006, 11);
		beam([s(0.04, 1.6, 0.67), s(0.04, 1.63, 0.79)], 0.008, 0.006, 11);
		palm([s(0.04, 1.63, 0.79), s(0.02, 1.57, 0.84), s(0.04, 1.6, 0.9), s(0.07, 1.66, 0.89), s(0.07, 1.69, 0.82)], 11);
		tube(triangles, s(0.1, 1.7, 0.57), s(0.14, 1.79, 0.72), 0.009, 0.004, 3, 11);
		palm([s(0.2, 2.21, 0.55), s(0.13, 2.34, 0.6), s(0.16, 2.33, 0.68), s(0.2, 2.29, 0.74), s(0.16, 2.27, 0.66)], 11);
		tube(triangles, s(0.21, 2.08, 0.45), s(0.27, 2.16, 0.35), 0.008, 0.003, 3, 11);
	}
	// (the body first, then each kind's antlers together: drawn as ranges of their own, a deer's kind's only, see deerPass)
	const keyOf = (part) => part > 5.5 ? Math.round(part) : 0;
	triangles.sort((a, b) => keyOf(a[3]) - keyOf(b[3]));
	const data = [];
	for (const [a, b, c, part] of triangles) {
		const key = keyOf(part), v = data.length / 4;
		if (key && !ANTLER_RANGES[key]) ANTLER_RANGES[key] = [v, 0];
		if (key) ANTLER_RANGES[key][1] += 3;
		for (const p of [a, b, c]) data.push(p[0], p[1], p[2], part);
	}
	return new Float32Array(data);
})();
const DEER_VERTICES = DEER_MESH.length / 4;
const BODY_VERTICES = Math.min(...Object.values(ANTLER_RANGES).map(([first]) => first));
export const DEER_TRIANGLE_COUNT = BODY_VERTICES / 3 + Math.max(...Object.values(ANTLER_RANGES).map(([, n]) => n)) / 3;	// (the most one deer is drawn with)

export const deerStats = { deer: 0, groups: 0, day: 0, triangles: DEER_TRIANGLE_COUNT, killed: 0, corpses: 0, respawned: 0, spheres: DEER_SPHERES.length };	// for anyone who wants to show it

// Buffers, pipeline
//-------------------------------------------------
const deerShaderModule = device.createShaderModule({ label: "vf_deer", code: vf_deer });
const meshBuffer = device.createBuffer({ label: "deer mesh", size: DEER_MESH.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(meshBuffer, 0, DEER_MESH);
const instanceData = new Float32Array(MAX_DRAWN * DEER_FLOATS), sortedData = new Float32Array(MAX_DRAWN * DEER_FLOATS);
const antlerKey = new Uint8Array(MAX_DRAWN);		// (each drawn one's kind with antlers, or DEER_KINDS.length without: deerPass)
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
let herdMade = 0;		// how many times the whole herd has been made (a tile's own coming in steps stops if it is made again: see the listener)
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
		return found && { t: found.t, what: 'deer', hit: (velocity, bullet) => deerShot.report?.(found.animal.id, velocity, bullet ? woundOn(found.animal, bullet) : null, bullet?.round) };
	}
	const living = groups.flatMap((group) => group.deer.map((deer) => ({ deer, group })));
	const found = ballistics.crossAnimals(ax, ay, az, bx, by, bz, living, (one) => deerSpheres(one.deer), (one) => deerAround(one.deer));
	return found && { t: found.t, what: 'deer', hit: (velocity, bullet) => shootDeer(found.animal.deer, found.animal.group, velocity, bullet ? woundOn(found.animal.deer, bullet) : null) };
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
	if (followed) { for (const one of followed) if (one.alive && near(one)) deerShot.report?.(one.id, away(one), otherWound('blast')); return; }
	for (const group of groups) for (const deer of [...group.deer]) if (near(deer)) shootDeer(deer, group, away(deer), otherWound('blast'));
}

// a round's wound in a deer (anatomy.js: woundFrom), the host's or one the joiner follows
const woundOn = (deer, bullet) => woundFrom('deer', bullet, [deer.x, deer.y, deer.z], deer.heading, settings.forestUnitsPerMetre * settings.deerSize * (deer.size ?? 1), deer.headDown);
// SHOT (see the top): a wound more in it, and what comes of it. velocity: the way the round went (world units)
const wounded = new Set();		// the ones shot and bleeding, still on their feet
function shootDeer(deer, group, velocity, wound) {
	if (!group.deer.includes(deer)) return;
	(deer.wounds ??= []).push(wound ?? otherWound('maul'));
	deer.firstWound ??= herdSeconds;
	deer.lastVelocity = velocity;
	const bleed = bleedOf(deer.wounds);
	if (bleed == 0) { killDeer(deer, group, velocity); return; }
	if (bleed < Infinity) { deer.bleed = bleed; deer.dieAt = Math.min(deer.dieAt ?? Infinity, herdSeconds + (deer.wounds.some(vital) ? Math.min(bleed, RUN_SECONDS) : bleed)); wounded.add(deer); }
	// (they all run, on along the way the shot went)
	const L = Math.hypot(velocity[0], velocity[2]) || 1, run = 45 * metre(), lead = group.deer[0];
	group.state = 'flee'; group.timer = FLEE; group.target = [lead.x + velocity[0] / L * run, lead.z + velocity[2] / L * run];
}
function killDeer(deer, group, velocity) {
	const at = group.deer.indexOf(deer);
	wounded.delete(deer);
	if (at < 0) return;
	group.deer.splice(at, 1);
	// over on to the side the shot pushed it to (its right is (cos, -sin) of its heading)
	const side = velocity[0] * Math.cos(deer.heading) - velocity[2] * Math.sin(deer.heading) > 0 ? 1 : -1;
	const more = DEER_KINDS[kindOf(deer.own)].more;		// (more meat on the bigger kinds, less on a roe deer: deerKinds.js)
	const cuts = [...(hasAntlers(deer.own) ? ['antlers'] : []), ...(more < 0 ? CUTS.slice(0, CUTS.length + more) : [...CUTS, ...Array.from({ length: more }, (_, k) => k % 3 == 2 ? 'sinew' : 'venison')])];
	const seconds = Math.max(herdSeconds - (deer.firstWound ?? herdSeconds), Number.isFinite(deer.bleed) ? deer.bleed : 0);
	corpses.push({ deer: deer, t: 0, side: side, cuts, meat: cuts.length, record: recordOf('deer', deer.wounds ?? [otherWound('maul')], seconds, { size: deer.size ?? 1, buck: isMale(deer.own), species: kindOf(deer.own), antlers: hasAntlers(deer.own) }) });
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
			walking: records[at + 7], own: records[at + 8], slope: records[at + 9], roll: records[at + 10], alive: records[at + 11] > 0.5, size: sizeOfOwn(records[at + 8]) });
	}
}
// host: a deer one of the others shot (part: its wound, as the joiner worked it out: anatomy.js cleanWound works it out again), or a
//		wolf caught (no part)
export function killDeerById(id, velocity, part = null) {
	for (const group of groups) {
		const deer = group.deer.find((one) => one.id === id);
		if (deer) { shootDeer(deer, group, velocity, part ? cleanWound(part, 'deer') ?? otherWound('maul') : otherWound('maul')); return; }
	}
}
// the record of a dead one, while it lies there (anatomy.js: recordOf; null if there is none, or it is gone). The host's: a joiner asks it (inspect.js)
export function deerRecord(id) { return corpses.find((corpse) => corpse.deer.id === id)?.record ?? null; }
export const peltStars = (id) => deerRecord(id)?.quality.stars ?? 3;
// for testing: a joiner's copies of the host's deer
export const followedForTest = () => followed;

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
	group.deer.push(newDeer(place[0], place[1], group.kind ?? 0));
	if (group.deer.length == 1) {
		group.state = 'wander';
		group.target = wanderTarget(group);
	}
	deerStats.respawned++;
	return true;
}

let nextDeerId = 1;
function newDeer(x, z, kind = 0) {
	const own = newOwn(kind);
	return { id: nextDeerId++, x: x, z: z, y: 0, heading: Math.random() * Math.PI * 2, stride: Math.random() * 6.28, walking: 0, headDown: 0, headWanted: 0, alertTimer: 0, own, size: sizeOfOwn(own), slope: 0, ground: null, place: null };
}
const between = ([low, high]) => low + (high - low) * Math.random();
const metre = () => settings.forestUnitsPerMetre;

// ground a deer can stand on: not water, not too steep
export function walkable(x, z) {
	const land = terrain.land;
	if (!terrain.inWorld(x, z, 20)) return false;
	const y = land.heightAt(x, z);
	if (y < settings.waterWorldPosY + 0.05) return false;
	const step = 2 * metre();
	return Math.abs(land.heightAt(x + step, z) - y) < STEEPEST * step && Math.abs(land.heightAt(x, z + step) - y) < STEEPEST * step;
}

// somewhere in the forest round a group's home (or on the grass, for the elk and the caribou)
function wanderTarget(group) {
	for (let attempt = 0; attempt < 10; attempt++) {
		const angle = Math.random() * Math.PI * 2, out = WANDER * metre() * Math.sqrt(Math.random());
		const x = group.home.x + Math.cos(angle) * out, z = group.home.z + Math.sin(angle) * out;
		const zone = terrain.land.zoneAt(x, z);
		if ((zone == terrain.ZONE_FOREST || (group.grass && zone == terrain.ZONE_GRASSLAND)) && walkable(x, z)) return [x, z];
	}
	return [group.home.x, group.home.z];
}

// the three times of a day the group goes to the water, spread through it
function scheduleTrips(group, day) {
	group.trips = [day + 0.08 + 0.18 * Math.random(), day + 0.42 + 0.14 * Math.random(), day + 0.74 + 0.14 * Math.random()].filter((t) => t > dayClock);
	group.scheduledDay = day;
}

// (in a world of tiles, terrain.js: a herd of its own for each tile of land, made as it comes and gone with it)
terrain.onTiles((added, removed) => {
	if (herdLand !== terrain.land) return;
	if (removed.length) { groups = groups.filter((g) => !removed.includes(g.tile)); shoreSpots = shoreSpots.filter((s) => !removed.includes(s.tile)); }
	const fresh = added.map((key) => terrain.landsHere().find((one) => one.key == key)).filter((here) => here && !groups.some((g) => g.tile == here.key) && !shoreSpots.some((s) => s.tile == here.key));
	const made = herdMade;
	if (fresh.length) return (function* () { for (const here of fresh) for (const step of herdSteps(here.land, here.key)) { yield; if (herdMade !== made) return; } })();
}, { later: true });
function makeHerd() {
	herdLand = terrain.land;
	herdMade++;
	corpses = [];
	shoreSpots = [];
	groups = [];
	for (const { key, land } of terrain.landsHere()) herdOf(land, key);
}
// one land's herd (a tile's): its places to drink, and its groups, each knowing its tile
function herdOf(land, tile) {
	for (const step of herdSteps(land, tile)) ;
}
// (in two steps: its places to drink, then its groups. A tile's own can come a step at a time: see the listener above)
function* herdSteps(land, tile) {
	const water = settings.waterWorldPosY;
	const ownShore = [];
	// where to drink: from points on the marsh, out to the nearest edge of the water. The spot is the last dry ground before it,
	//		facing the water
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
		if (best && walkable(best.x, best.z) && ownShore.every((s) => Math.hypot(s.x - best.x, s.z - best.z) > 25)) ownShore.push({ x: best.x, z: best.z, facing: best.facing, tile });
	}
	shoreSpots.push(...ownShore);
	yield;
	// homes: stretches of forest, the ones nearest to somewhere to drink first, well apart from each other. More than fit at the
	//		widest spacing: more places to choose from, closer together (see THE GROUPS at the top)
	const wanted = clamp(Math.round(settings.deerGroups), 0, MAX_GROUPS);
	const many = wanted > 40;
	const forestSpots = land.findSpawnPoints(terrain.ZONE_FOREST, many ? wanted * 5 : 60, { seed: 53, minSpacing: many ? 100 : 200, maxSlope: 0.4 }).filter((spot) => walkable(spot.x, spot.z));
	const nearestShore = (x, z) => ownShore.reduce((best, s) => Math.min(best, Math.hypot(s.x - x, s.z - z)), Infinity);
	forestSpots.sort((a, b) => nearestShore(a.x, a.z) - nearestShore(b.x, b.z));
	const homes = [];
	for (const spacing of HOME_SPACINGS) {
		for (const spot of forestSpots) {
			if (homes.length >= wanted) break;
			if (homes.every((home) => Math.hypot(home.x - spot.x, home.z - spot.z) > spacing)) homes.push(spot);
		}
	}

	// and by every town of the tile's, NEAR_TOWN.groups of them in the woods round it (or on its grass, with none), NEAR_TOWN.out from its
	//		middle: game for its hunters (npcHunters.js: within its REACH), whatever the drinking places
	if (wanted > 0) for (const t of land.towns ?? []) {
		if (!t.site) continue;
		const at = [t.site.x, t.site.z], m = metre();
		const near = [terrain.ZONE_FOREST, terrain.ZONE_GRASSLAND].flatMap((zone) => land.findSpawnPoints(zone, 24, { seed: 57, near: at, radius: NEAR_TOWN.out[1] * m, minSpacing: 40, maxSlope: 0.4 }))
			.filter((s) => { const d = Math.hypot(s.x - at[0], s.z - at[1]); return d > NEAR_TOWN.out[0] * m && walkable(s.x, s.z) && (land.townAt?.(s.x, s.z) ?? 0) < 0.02; });
		let made = 0;
		for (const spot of near) {
			if (made >= NEAR_TOWN.groups) break;
			if (homes.some((home) => Math.hypot(home.x - spot.x, home.z - spot.z) < 60 * m)) continue;
			homes.push(spot);
			made++;
		}
	}

	// the elk and the caribou: herds of their own (a quarter as many as the deer asked for each, one at the least), in the forest or out on
	//		the grass, away from the deer's homes and each other's
	const herds = wanted > 0 ? Math.max(1, Math.round(wanted / 4)) : 0;
	const open = [terrain.ZONE_GRASSLAND, terrain.ZONE_FOREST].flatMap((zone, z) => land.findSpawnPoints(zone, herds * 6 + 10, { seed: 59 + z, minSpacing: 150, maxSlope: 0.35 })).filter((spot) => walkable(spot.x, spot.z));
	open.sort(() => Math.random() - 0.5);
	const kinds = homes.map(() => pickKind());
	for (const kind of [ELK, CARIBOU]) {
		let made = 0;
		for (const spot of open) {
			if (made >= herds) break;
			if (homes.some((home) => Math.hypot(home.x - spot.x, home.z - spot.z) < 150)) continue;
			homes.push(spot); kinds.push(kind);
			made++;
		}
	}

	homes.forEach((home, h) => {
		const kind = kinds[h], K = DEER_KINDS[kind];
		const group = { home: { x: home.x, z: home.z }, kind, grass: K.grass, deer: [], state: 'wander', target: null, timer: 0, trips: [], scheduledDay: -1, visits: {}, spot: null, respawns: [], tile };
		const size = K.group[0] + Math.floor(Math.random() * (K.group[1] - K.group[0] + 1));
		for (let d = 0; d < size; d++) {
			const x = home.x + (Math.random() - 0.5) * 8 * K.size, z = home.z + (Math.random() - 0.5) * 8 * K.size;
			group.deer.push(newDeer(x, z, kind));
		}
		group.target = wanderTarget(group);
		groups.push(group);
	});
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
		const k = DEER_KINDS[group.kind ?? 0].size, side = i % 2 ? 1 : -1, back = (2.2 + 1.3 * i) * k * metre();
		let place = [leader.x - Math.sin(leader.heading) * back + Math.cos(leader.heading) * side * 1.6 * k * metre(), leader.z - Math.cos(leader.heading) * back - Math.sin(leader.heading) * side * 1.6 * k * metre()];
		if (!walkable(place[0], place[1])) place = [leader.x - Math.sin(leader.heading) * back, leader.z - Math.cos(leader.heading) * back];
		const far = Math.hypot(place[0] - deer.x, place[1] - deer.z);
		if (far > 0.6 * metre()) walkTowards(deer, place, pace * clamp(far / (2 * metre()), 0.3, 1.4), elapsed);
		else deer.walking += (0 - deer.walking) * Math.min(elapsed * 4, 1);
		// and not on top of one another
		for (const other of group.deer) {
			if (other === deer) continue;
			const ox = deer.x - other.x, oz = deer.z - other.z, apart = Math.hypot(ox, oz) || 0.01;
			if (apart < 1.2 * k * metre()) { deer.x += ox / apart * elapsed * metre(); deer.z += oz / apart * elapsed * metre(); }
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
		rateFrame();
		advanceDeer(0.05);
	}
}

const SEEN = 2500;			// metres: further than this from everyone a group is moved on less often (rates.js). A deer is a few pixels there, through a scope
function advanceDeer(frameElapsed) {
	const elapsed = frameElapsed;
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
	// the wounded: down where they are when their time is up (see SHOT)
	for (const deer of wounded) if (deer.dieAt <= herdSeconds) { const group = groups.find((g) => g.deer.includes(deer)); if (group) killDeer(deer, group, deer.lastVelocity ?? [1, 0, 0]); else wounded.delete(deer); }

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
		const elapsed = stepFor(group, group.deer[0].x, group.deer[0].z, frameElapsed, SEEN * m);
		if (!elapsed) continue;
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

		// SPOOKED (see the top)
		if (group.state != 'flee' && hearing.survivalMode()) {
			const L = hearing.heardBy(group.deer[0].x, group.deer[0].z, SPOOK * m);
			if (L) {
				const a = Math.atan2(group.deer[0].x - L.x, group.deer[0].z - L.z), run = 45 * m;
				group.state = 'flee'; group.timer = FLEE; group.target = [group.deer[0].x + Math.sin(a) * run, group.deer[0].z + Math.cos(a) * run];
			}
		}
		if (group.state == 'flee') {
			moveGroup(group, group.target, TROT * 1.5 * m, elapsed);
			group.timer -= elapsed;
			if (group.timer <= 0) { group.state = 'graze'; group.timer = between(GRAZE_SECONDS); }
		} else if (group.state == 'wander') {
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
				const along = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 1.4 * DEER_KINDS[group.kind ?? 0].size * m;
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
	deerStats.kinds = DEER_KINDS.map((_, k) => groups.filter((group) => (group.kind ?? 0) == k).length);	// (groups of each kind: deerKinds.js)
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
//		meat on them (any: all that lie there); a joiner's, any the host has lying (it says whether there is any left: butcher)
export function corpseInReach(eye, look, reach, any = false) {
	if (!settings.enableDeer || hidden()) return null;
	const s = settings.forestUnitsPerMetre * settings.deerSize;
	const list = followed ? followed.filter((one) => !one.alive) : corpses.filter((corpse) => any || corpse.meat > 0).map((corpse) => corpse.deer);
	let best = null, bestD = reach;
	for (const one of list) {
		const to = [one.x - eye[0], one.y + 0.4 * s - eye[1], one.z - eye[2]], d = Math.hypot(...to);
		if (d < bestD && (to[0] * look[0] + to[1] * look[1] + to[2] * look[2]) / (d || 1) > 0.75) { best = one; bestD = d; }
	}
	return best ? best.id : null;
}
// host: the next cut off the dead one id, if there is any left on it (what it is: items.js); the last one taken, it sinks away. A buck's antlers cut off, it has none
export function butcher(id) {
	const corpse = corpses.find((one) => one.deer.id == id);
	if (!corpse?.cuts.length) return null;
	const kind = corpse.cuts.shift();
	corpse.meat = corpse.cuts.length;
	if (kind == 'antlers') corpse.deer.own = cutAntlers(corpse.deer.own);
	if (corpse.meat == 0) corpse.lie = Math.max(corpse.t - FALL_SECONDS, 0);
	deerStats.butchered = (deerStats.butchered ?? 0) + 1;
	return kind;
}
// host: for the hunters (npcHunters.js): the nearest deer alive within reach (world units), a living one by its id, a dead one by its id (while it lies there with something on it)
export function nearestDeer(x, z, reach) {
	let best = null, bestD = reach;
	if (!settings.enableDeer || hidden()) return null;
	for (const group of groups) for (const one of group.deer) { const d = Math.hypot(one.x - x, one.z - z); if (d < bestD) { bestD = d; best = one; } }
	return best;
}
// host: a dead one all eaten (beasts.js: a pack's): nothing on it, and it goes
export function eaten(id) { const corpse = corpses.find((c) => c.deer.id === id); if (corpse) { corpse.cuts = []; corpse.meat = 0; corpse.lie = Math.max(corpse.t - FALL_SECONDS, 0); } }
export function deerById(id) { for (const group of groups) { const one = group.deer.find((d) => d.id === id); if (one) return one; } return null; }
export function corpseOf(id) { const corpse = corpses.find((c) => c.deer.id === id && c.cuts.length); return corpse ? corpse.deer : null; }
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
		antlerKey[count] = hasAntlers(own) ? kindOf(own) : DEER_KINDS.length;
		count++;
	};
	if (settings.enableDeer && !hidden()) {
		const drawn = followed ? followed.map((one) => [one, one.roll, 0])
			: [...groups.flatMap((group) => group.deer.map((deer) => [deer, 0, 0])), ...corpses.map((corpse) => [corpse.deer, corpse.roll ?? 0, corpse.sink ?? 0])];
		for (const [deer, roll, sink] of drawn) put(deer.x, deer.y - sink * size, deer.z, deer.heading, deer.stride, deer.headDown, deer.walking, deer.own, deer.slope, roll, 0, deer.size ?? 1);
	}
	for (const fn of drawers) fn(put);
	if (count == 0) return;
	// (in order of their antlers' kind, those without last: the bodies drawn for all of them, then each kind's antlers for its own)
	const starts = new Array(DEER_KINDS.length + 2).fill(0);
	for (let i = 0; i < count; i++) starts[antlerKey[i] + 1]++;
	for (let k = 1; k < starts.length; k++) starts[k] += starts[k - 1];
	const next = starts.slice();
	for (let i = 0; i < count; i++) sortedData.set(instanceData.subarray(i * DEER_FLOATS, (i + 1) * DEER_FLOATS), next[antlerKey[i]]++ * DEER_FLOATS);
	device.queue.writeBuffer(instanceBuffer, 0, sortedData, 0, count * DEER_FLOATS);

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
	pass.draw(BODY_VERTICES, count, 0, 0);
	DEER_KINDS.forEach((K, k) => {
		const n = starts[k + 1] - starts[k], range = ANTLER_RANGES[K.antlers];
		if (n > 0 && range) pass.draw(range[1], n, range[0], starts[k]);
	});
	pass.end();
}
