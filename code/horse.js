import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_horse } from '../shaders/js/vf_horse.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as forest from './forest.js'
import * as boulders from './boulders.js'
import * as ballistics from './ballistics.js'
import * as help from './controlsHelp.js'
import { addChoice, announceSpawn } from './radialMenu.js'

//the horses fade into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	THE HORSE: one to ride, from the spawn menu (radialMenu.js: Vehicles, Horse), put down on the land where the crosshair points, no
	further off than SPAWN_REACH, side on to the player. One each: another takes the place of the first. hunting.js puts the
	player in its saddle (E, at it) and takes it out again (E).
		W				on: it gathers pace up to a canter (CANTER), and slows to a stop when let go
		S				back, slowly
		A / D			turn. The faster it goes, the wider it turns (TURN, TURN_EASE), and turning at pace slows it down
						(TURN_BLEED, TURN_SLOWS)
		Shift			a burst: flat out (GALLOP) for BURST_SECONDS, then it needs BURST_REST before the next
	It walks, trots, canters and gallops as it goes faster (see THE GAITS in vf_horse.js), on the ground under it (the same ground
	as the walker's), tipped to its slope. It will not go up ground steeper than STEEPEST, it goes round nothing (it stops at trees
	and boulders, as the walker does), and in deep water it swims, slowly, its head up. Left alone it grazes now and then.
	The SADDLEBAGS (E at them, on foot) fill the player's ammunition back up (hunting.onRefill).

	THE MESH (HORSE_MESH): HORSE_TRIANGLES (no more than 500), in metres, standing on y = 0 and facing +z, +x its left: the barrel
	lofted from rings along it (8 sides), the neck and the head (6), the ears, the mane, the tail, four legs of an upper and a
	lower part and a hoof, and the tack: the saddle on its blanket with its horn, girth and stirrups, the saddlebags behind it, and the
	reins. Each vertex's part says what moves it (see vf_horse.js): 17 is the blanket under the saddle.

	WHO RIDES IT (in a game with others, net.js): as a boat (see WHO SAILS IT in boat.js): its authority works its sums, and sends its
	state; the others draw it from those, FOLLOW_DELAY behind. Getting into the saddle makes this player its authority.
*/
const SPAWN_REACH = 50;				// metres
const WALK = 1.6, CANTER = 7.5, GALLOP = 13.5, BACK = 1.2;	// metres a second
const ACCELERATE = 2.4;				// metres a second, a second, on the way up to a canter
const BURST_ACCELERATE = 5.0;
const SLOW = 3.0;					// letting go
const BURST_SECONDS = 3.0;
const BURST_REST = 6.0;				// seconds after a burst before the next
const TURN = 1.7;					// radians a second at a stand
const TURN_EASE = 3.5;				// metres a second: at this pace it turns half as fast, at twice it a third
const TURN_BLEED = 0.35;			// of its pace lost a second for each radian a second it turns
const TURN_SLOWS = 0.4;				// and while it is turned at a canter (or faster) it only wants to go this much less fast
const STEEPEST = 1.0;				// rise over run: 45 degrees
const SWIM_DEPTH = 1.4;				// metres of water before it swims
const SWIM_PACE = 1.5;
const RADIUS = 0.45;				// metres round its chest and its quarters that bump into things
export const SEAT = [0, 1.6, 0.0];	// where the rider sits (metres on the horse)
export const RIDER_EYE = 0.82;		// metres over the seat
const FOLLOW_DELAY = 0.15;
const GROUND_AGAIN = 0.4;			// metres it goes before the exact ground under it is worked out again
const REACH = 3.0;					// metres from the eye it can be worked from
export const MAX_HORSES = 16;

const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// The mesh (see THE MESH at the top)
//-------------------------------------------------
const HORSE_MESH = (() => {
	const tris = [];
	const tri = (a, b, c, part) => tris.push([a, b, c, part]);
	const quad = (a, b, c, d, part) => { tri(a, b, c, part); tri(a, c, d, part); };
	// a loft through rings across it: [x, y, z (the middle), rx, ry] and a direction each ring faces (the next one), any number of sides
	const loft = (rings, sides, part, capStart = false, capEnd = false) => {
		const made = rings.map(([x, y, z, rx, ry], i) => {
			const next = rings[Math.min(i + 1, rings.length - 1)], prev = rings[Math.max(i - 1, 0)];
			const d = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]], dl = Math.hypot(...d) || 1;
			const along = d.map((v) => v / dl);
			// across it: level (x), and the other way round (up, as near as it can)
			let side = [along[2], 0, -along[0]];
			if (Math.hypot(...side) < 1e-4) side = [1, 0, 0];
			const sl = Math.hypot(...side); side = side.map((v) => v / sl);
			if (side[0] < 0) side = side.map((v) => -v);
			const up = [along[1] * side[2] - along[2] * side[1], along[2] * side[0] - along[0] * side[2], along[0] * side[1] - along[1] * side[0]];
			if (up[1] < 0) up.forEach((v, k) => { up[k] = -v; });
			return Array.from({ length: sides }, (_, k) => {
				const t = (k + 0.5) / sides * Math.PI * 2;
				return [0, 1, 2].map((c) => [x, y, z][c] + side[c] * Math.cos(t) * rx + up[c] * Math.sin(t) * ry);
			});
		});
		for (let i = 0; i < made.length - 1; i++) {
			for (let k = 0; k < sides; k++) quad(made[i][k], made[i][(k + 1) % sides], made[i + 1][(k + 1) % sides], made[i + 1][k], part);
		}
		const cap = (ring) => { for (let k = 1; k < sides - 1; k++) tri(ring[0], ring[k], ring[k + 1], part); };
		if (capStart) cap(made[0]);
		if (capEnd) cap(made[made.length - 1]);
	};
	// the barrel, from the buttocks to the breast (108)
	loft([[0, 1.25, -0.84, 0.13, 0.15], [0, 1.27, -0.7, 0.26, 0.28], [0, 1.25, -0.35, 0.3, 0.31], [0, 1.24, 0.05, 0.32, 0.32], [0, 1.28, 0.45, 0.29, 0.3],
		[0, 1.31, 0.72, 0.23, 0.26], [0, 1.3, 0.85, 0.13, 0.16]], 8, 0, true, true);
	// the neck (24), and the head down to the muzzle (28)
	loft([[0, 1.4, 0.7, 0.13, 0.2], [0, 1.7, 0.95, 0.1, 0.15], [0, 1.93, 1.12, 0.08, 0.1]], 6, 1);
	loft([[0, 1.97, 1.13, 0.085, 0.11], [0, 1.76, 1.4, 0.075, 0.09], [0, 1.53, 1.63, 0.06, 0.07]], 6, 2, false, true);
	// the ears (4)
	for (const s of [1, -1]) {
		tri([s * 0.035, 2.02, 1.16], [s * 0.075, 2.02, 1.1], [s * 0.065, 2.17, 1.1], 2);
		tri([s * 0.035, 2.02, 1.16], [s * 0.065, 2.17, 1.1], [s * 0.075, 2.02, 1.1], 2);
	}
	// the mane, along the top of the neck (6)
	const crest = [[1.98, 1.1], [1.84, 0.97], [1.66, 0.82], [1.5, 0.66]];
	for (let i = 0; i < crest.length - 1; i++) {
		const [y0, z0] = crest[i], [y1, z1] = crest[i + 1];
		quad([0, y0 - 0.05, z0 - 0.02], [0, y1 - 0.05, z1 - 0.02], [0, y1 + 0.06, z1 - 0.05], [0, y0 + 0.06, z0 - 0.05], 3);
	}
	// the tail (16 and the tip)
	loft([[0, 1.32, -0.82, 0.06, 0.07], [0, 1.0, -0.95, 0.075, 0.06], [0, 0.6, -1.0, 0.06, 0.05]], 4, 4, false, true);
	// the legs: the upper (10), the lower (10), the hoof (13). Left front, right front, left hind, right hind
	[[0.15, 0.55, true], [-0.15, 0.55, true], [0.15, -0.6, false], [-0.15, -0.6, false]].forEach(([x, z, front], leg) => {
		loft([[x, 1.12, z, front ? 0.09 : 0.12, front ? 0.11 : 0.15], [x, 0.53, z, 0.065, 0.065]], 5, 5 + leg);
		loft([[x, 0.51, z, 0.06, 0.06], [x, 0.15, z + 0.01, 0.045, 0.045]], 5, 9 + leg);
		loft([[x, 0.15, z + 0.01, 0.05, 0.05], [x, 0.0, z + 0.04, 0.07, 0.07]], 5, 9 + leg, false, true);
	});
	// the saddle: its seat, high at the pommel and the cantle (16), its flaps down the sides (8), the blanket under it (8)
	const seatY = (z) => 1.56 + 0.12 * Math.max(z - 0.18, 0) / 0.14 + 0.1 * Math.max(-0.12 - z, 0) / 0.13;
	const zs = [-0.25, -0.12, 0.05, 0.18, 0.32];
	for (let i = 0; i < zs.length - 1; i++) {
		const a = zs[i], b = zs[i + 1];
		quad([0.2, seatY(a) - 0.04, a], [0, seatY(a), a], [0, seatY(b), b], [0.2, seatY(b) - 0.04, b], 13);
		quad([0, seatY(a), a], [-0.2, seatY(a) - 0.04, a], [-0.2, seatY(b) - 0.04, b], [0, seatY(b), b], 13);
	}
	for (const s of [1, -1]) {
		quad([s * 0.21, 1.53, -0.2], [s * 0.21, 1.53, 0.25], [s * 0.31, 1.3, 0.22], [s * 0.31, 1.3, -0.16], 13);
		quad([s * 0.2, 1.53, -0.32], [s * 0.2, 1.53, 0.36], [s * 0.34, 1.14, 0.34], [s * 0.34, 1.14, -0.3], 17);
	}
	// the horn on the pommel (8), the girth round the belly (8)
	loft([[0, 1.66, 0.3, 0.025, 0.025], [0, 1.76, 0.33, 0.03, 0.03]], 4, 13);
	const girth = (a) => [Math.cos(a) * 0.33, 1.25 + Math.sin(a) * 0.36, 0.35];
	for (let k = 0; k < 4; k++) {
		const a0 = Math.PI + k / 4 * Math.PI, a1 = Math.PI + (k + 1) / 4 * Math.PI;
		quad(girth(a0), girth(a1), [girth(a1)[0], girth(a1)[1], 0.43], [girth(a0)[0], girth(a0)[1], 0.43], 0);
	}
	// the stirrups: a leather down each side, and the iron (16)
	for (const s of [1, -1]) {
		quad([s * 0.31, 1.3, 0.04], [s * 0.31, 1.3, 0.1], [s * 0.35, 0.98, 0.1], [s * 0.35, 0.98, 0.04], 13);
		loft([[s * 0.36, 0.95, -0.02, 0.012, 0.012], [s * 0.36, 0.95, 0.16, 0.012, 0.012]], 3, 13);
	}
	// the saddlebags (20), hung either side behind the cantle
	for (const s of [1, -1]) {
		const x0 = s * 0.27, x1 = s * 0.37, y0 = 1.05, y1 = 1.4, z0 = -0.55, z1 = -0.3;
		const c = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
		for (const f of [[1, 3, 7, 5], [0, 1, 5, 4], [0, 2, 3, 1], [4, 5, 7, 6], [2, 6, 7, 3]]) quad(c(f[0]), c(f[1]), c(f[2]), c(f[3]), 14);
	}
	// the reins (8): from the bit back to the pommel, either side of the neck
	for (const s of [1, -1]) {
		const bit = [s * 0.06, 1.55, 1.52], mid = [s * 0.14, 1.5, 0.9], pommel = [s * 0.1, 1.68, 0.32];
		const w = [0, 0.018, 0];
		quad(bit, mid, mid.map((v, i) => v + w[i]), bit.map((v, i) => v + w[i]), 16);
		quad(mid, pommel, pommel.map((v, i) => v + w[i]), mid.map((v, i) => v + w[i]), 16);
	}
	const data = [];
	for (const [a, b, c, part] of tris) for (const p of [a, b, c]) data.push(p[0], p[1], p[2], part);
	return new Float32Array(data);
})();
const HORSE_VERTICES = HORSE_MESH.length / 4;
export const HORSE_TRIANGLES = HORSE_VERTICES / 3;
// where the crosshair can find it: the saddle (to get on) and the saddlebags (the ammunition)
const CONTROLS = [{ kind: 'saddle', at: [0, 1.62, 0.05], radius: 0.45, name: 'Horse', keys: 'E get in the saddle' },
	{ kind: 'bags', at: [0.32, 1.25, -0.42], radius: 0.25, name: 'Saddlebags', keys: 'E fill up your ammunition' },
	{ kind: 'bags', at: [-0.32, 1.25, -0.42], radius: 0.25, name: 'Saddlebags', keys: 'E fill up your ammunition' }];
// the hitbox: the quarters, the barrel, the chest, the neck and the head
const SPHERES = [[0, 1.2, -0.5, 0.36], [0, 1.2, 0.1, 0.38], [0, 1.27, 0.62, 0.33], [0, 1.68, 0.95, 0.17], [0, 1.75, 1.38, 0.15]];

export const horseStats = { horses: 0, triangles: HORSE_TRIANGLES, drawn: 0 };

// The horses, and how each one is now
//-------------------------------------------------
// each: { id, owner, authority, x, y, z (its hooves, world units), heading (radians, round from +z towards +x), speed (metres a second,
//		forward), turning (radians a second), phase (where it is in its stride, radians), slope, burst, rest (seconds left of a
//		burst, and before the next), swim (0 to 1), headDown, coat, rider (who is on it: 'me', a player's number, or null), track, frame }
export const horses = [];
let localId = 0;
export function setLocalId(id) { localId = id; }
export const riddenHere = (h) => h.authority === localId;
export const isMine = (h) => h.owner === localId;
let nextNumber = 1;

// where a horse is, for its rider and for anyone drawing someone on it: places on it (metres, its own directions) into the world
function makeFrame(h) {
	return {
		toWorld(local) {
			const m = metre();
			const [x, y, z] = local;
			const motion = bodyMotion(h);
			// tipped to its slope (and rocking with the gait) about its middle, then turned to its heading
			const p = tip([x, y - 1.2, z], -motion.rock);
			const q = tip([p[0], p[1] + 1.2 + motion.bob, p[2]], -h.slope);
			const c = Math.cos(h.heading), s = Math.sin(h.heading);
			return [h.x + (q[0] * c + q[2] * s) * m, h.y + q[1] * m, h.z + (q[2] * c - q[0] * s) * m];
		},
		toLocal(world) {
			const m = metre();
			const dx = (world[0] - h.x) / m, dy = (world[1] - h.y) / m, dz = (world[2] - h.z) / m;
			const c = Math.cos(h.heading), s = Math.sin(h.heading);
			const p = tip([dx * c - dz * s, dy, dx * s + dz * c], h.slope);
			return p;
		},
		heading() { return Math.atan2(Math.sin(h.heading), -Math.cos(h.heading)); },	// (as settings.camYaw)
	};
}
const tip = ([x, y, z], angle) => [x, y * Math.cos(angle) - z * Math.sin(angle), y * Math.sin(angle) + z * Math.cos(angle)];

// The gaits (as vf_horse.js has them)
//-------------------------------------------------
// which gait, 0 walk to 3 gallop, at a pace
function gaitAt(speed) {
	const v = Math.abs(speed);
	const ramp = (a, b) => clamp((v - a) / (b - a), 0, 1);
	return ramp(1.8, 3.0) + ramp(5.0, 6.5) + ramp(9.5, 11.0);
}
// how far a stride takes it: longer the faster it goes
const strideLength = (speed) => 1.5 + 0.38 * Math.abs(speed);
// the body's bob (metres) and rock (radians): the same sums as bodyMotion in vf_horse.js
function bodyMotion(h) {
	const g = gaitAt(h.speed), going = Math.min(Math.abs(h.speed) / GALLOP, 1);
	const at = (values) => { const low = Math.min(Math.floor(g), 3), high = Math.min(low + 1, 3); return values[low] + (values[high] - values[low]) * (g - low); };
	const fade = Math.min(going * 10, 1);
	return { bob: (at([0.02, 0.05, 0, 0]) * Math.sin(2 * h.phase) + at([0, 0, 0.06, 0.07]) * Math.sin(h.phase)) * fade, rock: at([0, 0, 0.06, 0.05]) * Math.cos(h.phase) * fade };
}

// Putting one on the land
//-------------------------------------------------
// where a horse would go from the eye (world units) looking along look: { x, z, heading } or { reason }
export function spawnSpot(eye, look) {
	const land = terrain.land;
	if (!land || !settings.enableTerrain) return { reason: 'There is no land' };
	const m = metre();
	for (let t = 0.5 * m; t <= SPAWN_REACH * m; t += 0.25 * m) {
		const x = eye[0] + look[0] * t, y = eye[1] + look[1] * t, z = eye[2] + look[2] * t;
		const ground = land.heightAt(x, z);
		if (y > ground && y > settings.waterWorldPosY) continue;
		if (y <= settings.waterWorldPosY && ground < settings.waterWorldPosY) return { reason: 'Point at dry land, not the water' };
		if (ground < settings.waterWorldPosY + 0.1 * m) return { reason: 'Point at dry land' };
		const step = 1.5 * m;
		if (Math.abs(land.heightAt(x + step, z) - ground) > 0.7 * step || Math.abs(land.heightAt(x, z + step) - ground) > 0.7 * step) return { reason: 'Too steep there for a horse' };
		// side on to the player, its head to the right as it looks (its saddle towards the player)
		return { x, z, heading: Math.atan2(-look[2], look[0]) };
	}
	return { reason: `Point at the ground within ${SPAWN_REACH} m` };
}

export function spawnHorse(x, z, { heading = 0, owner = localId, id = null, authority = owner, coat = null } = {}) {
	const h = { id: id ?? `${owner}:h${nextNumber++}`, owner, authority, exists: true, x, z, y: 0, heading, speed: 0, turning: 0, phase: 0, slope: 0, burst: 0, rest: 0, swim: 0,
		headDown: 0, grazeTimer: 4 + Math.random() * 6, coat: coat ?? ((owner * 0.37 + nextNumber * 0.21) % 1), rider: null, track: [], ground: null, sinceMoved: 0, swish: Math.random() * 10 };
	h.y = groundUnder(h);
	h.frame = makeFrame(h);
	if (horses.length >= MAX_HORSES) removeHorse(horses.find((one) => !one.rider) ?? horses[0]);
	horses.push(h);
	return h;
}
export function removeHorse(h) {
	const at = horses.indexOf(h);
	if (at < 0) return;
	horses.splice(at, 1);
	h.exists = false;
}
export const horseById = (id) => horses.find((h) => h.id === id) ?? null;

// a horse where the crosshair points (the spawn menu): the player's own old one goes
function bringHorse() {
	const spot = spawnSpot([settings.camPosX, settings.camPosY, settings.camPosZ], transformations.getCameraForward());
	if (spot.reason) { help.toast(spot.reason); return false; }
	for (const old of horses.filter((h) => isMine(h))) {
		if (old.rider === 'me') continue;
		removeHorse(old);
		announceSpawn('horse', null, old);
	}
	const h = spawnHorse(spot.x, spot.z, { heading: spot.heading });
	announceSpawn('horse', h, null);
	help.toast('A horse, saddled');
	return true;
}
addChoice('Vehicles', { label: 'Horse', detail: 'Saddled, with saddlebags of ammunition', act: bringHorse });

// The ground (the walker's: the exact ground, worked out again every GROUND_AGAIN, the data grid's change in between)
//-------------------------------------------------
function groundUnder(h) {
	const land = terrain.land;
	if (!land) return 0;
	const rough = land.heightAt(h.x, h.z);
	if (!h.ground || Math.hypot(h.x - h.ground.x, h.z - h.ground.z) > GROUND_AGAIN * metre()) h.ground = { x: h.x, z: h.z, exact: land.groundAt(h.x, h.z), rough };
	return h.ground.exact + (rough - h.ground.rough);
}

// Riding (see THE HORSE at the top)
//-------------------------------------------------
// the rider's keys, for dt seconds: ahead (1 on, -1 back, 0 neither), turn (1 left, -1 right), burst (Shift pressed)
export function rideHorse(h, { ahead = 0, turn = 0, burst = false }, dt) {
	if (!riddenHere(h)) return;
	if (burst && h.burst <= 0 && h.rest <= 0) { h.burst = BURST_SECONDS; help.toast('Gallop!', 1); }
	h.input = { ahead, turn };
}
// a horse's sums for dt seconds: its pace, its turn, where it goes
function stepHorse(h, dt) {
	const m = metre();
	const land = terrain.land;
	const input = h.input ?? { ahead: 0, turn: 0 };
	if (!h.rider) h.input = null;
	// the burst, and the rest after it
	if (h.burst > 0) { h.burst -= dt; if (h.burst <= 0) h.rest = BURST_REST; }
	else if (h.rest > 0) h.rest = Math.max(h.rest - dt, 0);
	// how fast it wants to go, and how quickly it gets there
	let want = 0, rate = SLOW;
	if (h.burst > 0) { want = GALLOP; rate = BURST_ACCELERATE; }
	else if (input.ahead > 0) { want = CANTER; rate = h.speed < CANTER ? ACCELERATE : SLOW; }
	else if (input.ahead < 0) { want = -BACK; rate = SLOW; }
	// turning at pace, it slows: the harder it is turned and the faster it goes, the slower it wants to go
	if (input.turn && want > 0) want *= 1 - TURN_SLOWS * Math.min(Math.abs(h.speed) / CANTER, 1);
	if (h.swim > 0.5) want = clamp(want, -BACK * 0.5, SWIM_PACE);
	h.speed += clamp(want - h.speed, -rate * dt, rate * dt);
	// turning: slower the faster it goes, and it takes some of its pace
	const most = TURN / (1 + Math.abs(h.speed) / TURN_EASE);
	h.turning += clamp(input.turn * most - h.turning, -4 * dt, 4 * dt);
	h.heading += h.turning * dt * (h.speed < -0.05 ? -1 : 1);
	h.speed -= Math.sign(h.speed) * Math.min(Math.abs(h.turning) * Math.abs(h.speed) * TURN_BLEED * dt, Math.abs(h.speed));

	// on, unless the ground ahead is too steep, or something is in the way
	const fx = Math.sin(h.heading), fz = Math.cos(h.heading);
	const step = h.speed * m * dt;
	if (Math.abs(step) > 0 && land) {
		const look = Math.sign(step) * 1.2 * m;
		const here = land.heightAt(h.x, h.z), there = land.heightAt(h.x + fx * look, h.z + fz * look);
		if ((there - here) / Math.abs(look) > STEEPEST && h.swim < 0.5) {
			h.speed = 0;
		} else {
			h.x += fx * step;
			h.z += fz * step;
		}
	}
	// out of the trunks and the boulders round its chest and its quarters
	const points = [0.55, -0.55];
	let bumped = false;
	const pushOut = (x, z, half) => {
		for (const along of points) {
			const px = h.x + fx * along * m, pz = h.z + fz * along * m;
			const r = RADIUS * m;
			const dx = clamp(px, x - half, x + half) - px, dz = clamp(pz, z - half, z + half) - pz;
			const d = Math.hypot(dx, dz);
			if (d < r && d > 1e-6) { h.x -= dx / d * (r - d); h.z -= dz / d * (r - d); bumped = true; }
		}
	};
	if (Math.abs(h.speed) > 0.01 || h.rider) {
		const reach = 2.5 * m;
		if (settings.enableForest) forest.trunksNear(h.x, h.z, reach, (x, z, half, bottom, top) => { if (top > h.y + 0.5 * m && bottom < h.y + 1.6 * m) pushOut(x, z, half); });
		if (settings.enableBoulders) boulders.bouldersNear(h.x, h.z, reach, (x, z, half, bottom, top) => { if (top > h.y + 0.5 * m && bottom < h.y + 1.6 * m) pushOut(x, z, half); });
	}
	if (bumped) h.speed *= Math.pow(0.05, dt);
	const edge = settings.terrainWorldSize * 0.5 - 2 * m;
	h.x = clamp(h.x, -edge, edge);
	h.z = clamp(h.z, -edge, edge);

	// on the ground, tipped to its slope, or swimming
	const ground = groundUnder(h);
	const depth = (settings.waterWorldPosY - ground) / m;
	h.swim += clamp((depth > SWIM_DEPTH ? 1 : 0) - h.swim, -dt * 2, dt * 2);
	const floating = settings.waterWorldPosY - (SWIM_DEPTH - 0.1) * m;
	h.y = h.swim > 0.5 ? Math.max(ground, floating) : ground;
	if (land) {
		const look = 0.9 * m;
		const ahead = land.heightAt(h.x + fx * look, h.z + fz * look), behind = land.heightAt(h.x - fx * look, h.z - fz * look);
		const slope = h.swim > 0.5 ? 0 : clamp(Math.atan2(ahead - behind, 2 * look), -0.5, 0.5);
		h.slope += (slope - h.slope) * Math.min(dt * 5, 1);
	}
	advanceLook(h, dt);
}
// its stride, and its head: up while it goes, down to graze now and then while it stands
function advanceLook(h, dt) {
	h.phase = (h.phase + Math.abs(h.speed) / strideLength(h.speed) * Math.PI * 2 * dt * (h.swim > 0.5 ? 0.6 : 1)) % (Math.PI * 200);
	if (Math.abs(h.speed) < 0.2 && !h.rider) {
		h.grazeTimer -= dt;
		if (h.grazeTimer <= 0) { h.grazing = !h.grazing; h.grazeTimer = h.grazing ? 5 + Math.random() * 8 : 3 + Math.random() * 6; }
	} else {
		h.grazing = false;
	}
	h.headDown += ((h.grazing ? 1 : 0) - h.headDown) * Math.min(dt * 1.5, 1);
}

// The controls on it (see CONTROLS): the one the eye (world units) looks at, within reach: { horse, kind, name, keys } or null
export function controlInView(eye, look) {
	const m = metre();
	let best = null, bestAlong = Infinity;
	for (const h of horses) {
		if (Math.hypot(h.x - eye[0], h.z - eye[2]) > (REACH + 2.5) * m) continue;
		for (const control of CONTROLS) {
			const at = h.frame.toWorld(control.at);
			const to = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]];
			const along = to[0] * look[0] + to[1] * look[1] + to[2] * look[2];
			if (along < 0 || along > REACH * m) continue;
			const off = Math.hypot(to[0] - look[0] * along, to[1] - look[1] * along, to[2] - look[2] * along);
			if (off < control.radius * m && along < bestAlong) { best = { horse: h, ...control }; bestAlong = along; }
		}
	}
	return best;
}
// the horse a walker at (x, z) is right beside, close enough to get on without looking at the saddle, or null
export function horseBeside(x, z) {
	const m = metre();
	return horses.find((h) => !h.rider && Math.hypot(h.x - x, h.z - z) < 1.3 * m) ?? null;
}
let lit = { horse: null, kind: '' };
export function setHovered(h, kind) { lit = { horse: h, kind }; }

// who is on each one: this player ('me', from hunting.js), and the others (net.js, from their states)
export function setRider(h, who) {
	if (h) h.rider = who;
}
export function setOtherRiders(riders) {		// id -> horse id
	for (const h of horses) if (h.rider !== 'me') h.rider = null;
	for (const [who, id] of riders) { const h = horseById(id); if (h && h.rider !== 'me') h.rider = who; }
}

// Ridden somewhere else (as WHO SAILS IT in boat.js)
//-------------------------------------------------
export function horseShare(h) {
	const r = (v) => Math.round(v * 1000) / 1000;
	return { id: h.id, o: h.owner, a: h.authority, x: r(h.x), y: r(h.y), z: r(h.z), h: r(h.heading), s: r(h.speed), t: r(h.turning), p: r(h.phase), sl: r(h.slope), sw: r(h.swim), hd: r(h.headDown), c: h.coat, b: r(h.burst), re: r(h.rest) };
}
export function horseFromShare(s) {
	const h = spawnHorse(s.x, s.z, { heading: s.h, owner: s.o, id: s.id, authority: s.a, coat: s.c });
	Object.assign(h, { y: s.y, speed: s.s, turning: s.t, phase: s.p, slope: s.sl, swim: s.sw, headDown: s.hd, burst: s.b, rest: s.re });
	if (!riddenHere(h)) h.track.push({ at: performance.now() / 1000, s });
	return h;
}
export function horseHeard(s) {
	const h = horseById(s.id);
	if (!h || riddenHere(h)) return;
	h.track.push({ at: performance.now() / 1000, s });
	if (h.track.length > 8) h.track.shift();
}
function follow(h, now) {
	const track = h.track;
	if (track.length == 0) return;
	const at = now - FOLLOW_DELAY;
	let a = track[0], c = track[track.length - 1];
	for (let k = 0; k < track.length - 1; k++) if (track[k].at <= at && track[k + 1].at >= at) { a = track[k]; c = track[k + 1]; break; }
	const f = c.at > a.at ? clamp((at - a.at) / (c.at - a.at), 0, 1) : 1;
	const A = a.s, C = c.s;
	const mix = (u, v) => u + (v - u) * f;
	let turn = C.h - A.h;
	turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2));
	let stride = C.p - A.p;
	if (stride < -Math.PI * 100) stride += Math.PI * 200;	// (the stride's count goes back round to 0 now and then)
	Object.assign(h, { x: mix(A.x, C.x), y: mix(A.y, C.y), z: mix(A.z, C.z), heading: A.h + turn * f, speed: mix(A.s, C.s), turning: C.t, phase: A.p + stride * f,
		slope: mix(A.sl, C.sl), swim: C.sw, headDown: mix(A.hd, C.hd), burst: C.b, rest: C.re });
}
export function takeOver(h, authority = localId) {
	h.authority = authority;
	h.track = [];
}

// Shot: a bullet stops at a horse (it is not hurt). Not at the one its shooter rides
ballistics.addTarget((ax, ay, az, bx, by, bz, bullet) => {
	const m = metre();
	let best = null;
	for (const h of horses) {
		if (h.rider !== null && (bullet?.remote ? h.rider === bullet.shooter : h.rider === 'me')) continue;
		const around = h.frame.toWorld([0, 1.3, 0.3]);
		if (ballistics.crossSphere(ax, ay, az, bx, by, bz, around[0], around[1], around[2], 1.6 * m) === null) continue;
		for (const [x, y, z, r] of SPHERES) {
			const c = h.frame.toWorld([x, y, z]);
			const t = ballistics.crossSphere(ax, ay, az, bx, by, bz, c[0], c[1], c[2], r * m);
			if (t !== null && (!best || t < best.t)) best = { t };
		}
	}
	return best && { t: best.t, what: 'horse', hit: () => {} };
});

// Per frame
//-------------------------------------------------
let lastTime = performance.now();
export function horseUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (!terrain.land) return;
	for (const h of horses) {
		if (riddenHere(h)) {
			for (let left = elapsed; left > 1e-6; left -= 1 / 60) stepHorse(h, Math.min(left, 1 / 60));
		} else {
			follow(h, now / 1000);
		}
	}
	horseStats.horses = horses.length;
}
// for testing: a horse's state
export function horseState(h = horses[0]) {
	return h && { id: h.id, x: h.x, y: h.y, z: h.z, heading: h.heading, speed: h.speed, turning: h.turning, gait: gaitAt(h.speed), burst: h.burst, rest: h.rest, swim: h.swim, slope: h.slope, rider: h.rider, authority: h.authority };
}
// how the rider's eye bobs with the horse (hunting.js)
export function riderEye(h) {
	return h.frame.toWorld([SEAT[0], SEAT[1] + RIDER_EYE, SEAT[2]]);
}
export function burstState(h) {
	return { burst: Math.max(h.burst, 0), rest: h.rest, ready: h.burst <= 0 && h.rest <= 0 };
}

// Drawing them
//-------------------------------------------------
const HORSE_FLOATS = 20;
const shaderModule = device.createShaderModule({ label: "vf_horse", code: vf_horse });
const meshBuffer = device.createBuffer({ label: "horse mesh", size: HORSE_MESH.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(meshBuffer, 0, HORSE_MESH);
const instanceData = new Float32Array(MAX_HORSES * HORSE_FLOATS);
const instanceBuffer = device.createBuffer({ label: "horse instances", size: instanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
const uniformBuffer = device.createBuffer({ label: "horse Uniform", size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const pipeline = device.createRenderPipeline({
	label: "horse pipeline",
	layout: 'auto',
	vertex: {
		module: shaderModule,
		entryPoint: "vertexMain",
		buffers: [
			{ arrayStride: 16, attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }] },
			{
				arrayStride: HORSE_FLOATS * 4,
				stepMode: 'instance',
				attributes: [
					{ format: "float32x4", offset: 0, shaderLocation: 1 },		// where, how big
					{ format: "float32x4", offset: 16, shaderLocation: 2 },		// heading, stride, how hard it goes, gait
					{ format: "float32x4", offset: 32, shaderLocation: 3 },		// slope, coat, head down, its number
					{ format: "float32x4", offset: 48, shaderLocation: 4 },		// swimming, its own swish
				],
			}]
	},
	fragment: { module: shaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
});
let bindGroup = null, boundLUT = null;
const startSeconds = performance.now() / 1000;

// with the solid things
export function horsePass(aEncoder, mainpassDepthTexture) {
	if (horses.length == 0) return;
	let count = 0;
	for (const h of horses.slice(0, MAX_HORSES)) {
		const going = Math.min(Math.abs(h.speed) / GALLOP, 1);
		instanceData.set([h.x, h.y, h.z, metre(), h.heading, h.phase, going, gaitAt(h.speed), h.slope, h.coat, h.headDown, count, h.swim, h.swish, 0, 0], count * HORSE_FLOATS);
		count++;
	}
	horseStats.drawn = count;
	device.queue.writeBuffer(instanceBuffer, 0, instanceData, 0, count * HORSE_FLOATS);
	const litIndex = lit.horse ? horses.indexOf(lit.horse) : -1;
	const u = new Float32Array(24);
	u.set(transformations.getViewProj(), 0);
	u.set([settings.camPosX, settings.camPosY, settings.camPosZ, performance.now() / 1000 - startSeconds], 16);
	u.set([settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, litIndex, lit.kind == 'bags' ? 1 : 0], 20);
	device.queue.writeBuffer(uniformBuffer, 0, u);
	if (!bindGroup || boundLUT !== skyViewLUTtexture) {
		boundLUT = skyViewLUTtexture;
		bindGroup = device.createBindGroup({
			label: "horse bind group",
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: { buffer: uniformBufferLights } },
				{ binding: 2, resource: skyViewLUTtexture.createView() },
				{ binding: 3, resource: linSampler },
			],
		});
	}
	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Horses', 'vf_horse'),
	});
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup);
	pass.setVertexBuffer(0, meshBuffer);
	pass.setVertexBuffer(1, instanceBuffer);
	pass.draw(HORSE_VERTICES, count, 0, 0);
	pass.end();
}
