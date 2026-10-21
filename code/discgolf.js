import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { vf_discgolf, vf_discGlow } from '../shaders/js/vf_discgolf.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as forest from './forest.js'
import * as boulders from './boulders.js'
import * as town from './town.js'
import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as help from './controlsHelp.js'
import * as vm from './viewmodel.js'
import * as flight from './discFlight.js'

//the course fades into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	DISC GOLF. Three discs, from the spawn menu's Weapons (radialMenu.js): a fairway driver, a midrange and a putter, one of each in the
	hand (see discFlight.js for how each flies).
		left click (held)	wind up: the longer it is held (up to WIND_UP_SECONDS) the harder it is thrown. Let go to throw it
		mouse wheel			the release angle: up for more hyzer (its outside edge down: it curves away to the left from a right
							handed backhand), down for anhyzer. HYZER_STEP a notch
		right click			backhand or forehand (a forehand spins the other way, so it fades the other way)
		E					pick up a disc of yours lying by you (PICK_REACH). Choosing it again from the menu takes it back too
	A disc is thrown from the hand, up a little from where the player looks (RELEASE_UP), a little nose down, as fast as the wind up
	says (speedForPower), carrying the player's own way on with it. It flies until it lands (and slides to a stop, SLIDE), drops in
	the water (it floats), hits a tree or a boulder (it bounces off and falls), or comes into a basket's chains slow enough to be
	caught (CATCH_SPEED: faster, it is thrown back out).

	THE COURSE (off unless settings.discGolfEnabled; the Disc Golf folder under Game Modes): settings.discGolfHoles holes, laid out on
	the land from settings.discGolfSeed (New Course moves it on), each a tee pad and a basket in the hole's own colour, the next tee a
	little way on from the last basket. A hole is no shorter than SHORTEST and no longer than LONGEST_THROWS of the fairway driver's
	longest throw (its flight, on flat ground at full power: flight.flatThrow), over dry land, its basket on level ground. Its par
	from its length. The seed and the number are the world's (net.js), and the land is the same, so everyone in a game has the
	same course. A marker over each tee and each basket says which hole it is (MARKER_REACH), the hole being played with how far it is.
	A hole is played from its tee: a disc thrown from within TEE_REACH of a tee begins that hole, every throw after counts, and a disc
	in its basket ends it (its score: throws against par).

	IN A GAME WITH OTHERS (net.js): each throw is sent to the others (onThrow: where, how fast, how turned, how it spins), and they fly
	it here too, with the same sums over the same land; where it comes to rest is sent when it does (onRest) and put right there. A disc
	picked up goes (onGone). A hole finished is said to everyone (onScore). The course is the host's: it lays it out and sends the holes
	themselves (courseShare), and a joiner plays on those (courseFromHost) instead of laying out its own.

	FINDING A DISC. Every disc out of the hand glows in its colour (see THE GLOW in vf_discgolf.js), fainter through whatever is in
	front of it, out to GLOW_REACH. In a game with others the thrower's name is over each one too, out to NAME_REACH.
*/
const KINDS = ['driver', 'midrange', 'putter'];
const COLOURS = { driver: [0.95, 0.42, 0.08], midrange: [0.12, 0.42, 0.95], putter: [0.95, 0.82, 0.12] };
const WIND_UP_SECONDS = 1.0;
const POWER_CURVE = 0.4;			// the release speed is the disc's fastest times the power to this: half the wind up, about half as far
const RELEASE_UP = 0.12;			// radians over the line of sight
const NOSE = -0.03;
const HYZER_STEP = 5 * Math.PI / 180, HYZER_MOST = 35 * Math.PI / 180;
const PICK_REACH = 2.2;				// metres
const TEE_REACH = 8;
const SUBSTEP = 1 / 240;
const MOST_FLIGHT = 20;				// seconds
const SLIDE = 5.0;					// metres a second, a second, sliding on the ground
const CATCH_SPEED = 14;				// metres a second
const BASKET = { radius: 0.32, trayBottom: 0.62, trayTop: 0.86, chainTop: 1.36, poleTop: 1.45 };
const SHORTEST = 55;				// metres, a hole
const LONGEST_THROWS = 2.5;			// of the fairway driver's longest throw
const MARKER_REACH = 900;			// metres
const GLOW_REACH = 400;				// metres
const NAME_REACH = 150;
export const MAX_DISCS = 64;

const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
let localId = 0;
export function setLocalId(id) { localId = id; }
// whose name a disc's owner number is, in a game with others (net.js): null when there is no game
let nameFor = () => null;
export function setNameLookup(fn) { nameFor = fn; }

// The discs
//-------------------------------------------------
// each: { id, owner, kind, s (its flight: p, v (metres, metres a second, in the world's directions), n, spin), state ('flying', 'sliding',
//		'rest', 'basket', 'water'), hole (the basket it is in), mine, turned (how far round it has spun, for drawing) }
export const discs = [];
const hand = { driver: true, midrange: true, putter: true };
const throwing = { windUp: -1, power: 0, hyzer: 0, style: 'backhand', released: 0 };
const listeners = { throw: [], rest: [], gone: [], score: [] };
export function onThrow(fn) { listeners.throw.push(fn); }
export function onRest(fn) { listeners.rest.push(fn); }
export function onGone(fn) { listeners.gone.push(fn); }
export function onScore(fn) { listeners.score.push(fn); }
export const discStats = { thrown: 0, landed: 0, caught: 0, bounced: 0, holes: 0, lastFlight: null };

const holdingDisc = () => KINDS.find((kind) => weapons.holding(kind)) ?? null;
const locked = () => document.pointerLockElement == canvas;
// a disc thrown as hard as power (0 to 1) says
export const speedForPower = (kind, power) => flight.DISCS[kind].fastest * Math.pow(Math.max(power, 0.08), POWER_CURVE);

function removeDisc(id, quiet = false) {
	const at = discs.findIndex((d) => d.id === id);
	if (at < 0) return;
	discs.splice(at, 1);
	if (!quiet) for (const fn of listeners.gone) fn(id);
}

// in the hand, from the menu (a fresh one, if this player's is lying out there)
for (const kind of KINDS) {
	weapons.addWeapon(kind, { label: flight.DISCS[kind].name, detail: `A golf disc: ${flight.DISCS[kind].flight.join(' | ')} (speed, glide, turn, fade)`,
		equip: () => { if (!hand[kind]) { removeDisc(`${localId}:${kind}`); hand[kind] = true; } throwing.windUp = -1; },
		reset: () => { for (const k of KINDS) { removeDisc(`${localId}:${k}`); hand[k] = true; } },
		drawn: () => drawHand(kind),
		help: () => [flight.DISCS[kind].name, [
			['Left click', 'hold to wind up, let go to throw'],
			['Wheel', `release angle: up hyzer, down anhyzer (${angleWord()})`],
			['Right click', `backhand or forehand (${throwing.style})`],
			['E', 'pick up your disc'],
			...(holes.length ? [['', 'Throw from a tee to play its hole']] : []),
		]] });
}
const angleWord = () => throwing.hyzer == 0 ? 'flat' : `${Math.round(Math.abs(throwing.hyzer) * 180 / Math.PI)}° ${throwing.hyzer > 0 ? 'hyzer' : 'anhyzer'}`;

window.addEventListener('mousedown', (event) => {
	const kind = holdingDisc();
	if (!kind || !locked() || hunting.input.menuOpen) return;
	if (event.button == 0) {
		if (hand[kind]) throwing.windUp = 0;
		else help.toast('Your disc is out there: pick it up (E), or take another from the menu');
	}
	if (event.button == 2) throwing.style = throwing.style == 'backhand' ? 'forehand' : 'backhand';
});
window.addEventListener('mouseup', (event) => {
	if (event.button != 0 || throwing.windUp < 0) return;
	const kind = holdingDisc();
	const power = clamp(throwing.windUp / WIND_UP_SECONDS, 0, 1);
	throwing.windUp = -1;
	if (kind && hand[kind]) throwDisc(kind, power);
});
window.addEventListener('wheel', (event) => {
	if (!holdingDisc() || !locked() || hunting.input.menuOpen || hunting.crosshair.onRope) return;
	const notches = -Math.sign(vm.wheelPixels(event));
	throwing.hyzer = clamp(throwing.hyzer + notches * HYZER_STEP, -HYZER_MOST, HYZER_MOST);
	event.preventDefault();
}, { passive: false });
document.addEventListener('pointerlockchange', () => { if (!locked()) throwing.windUp = -1; });

// Throwing (see the top)
//-------------------------------------------------
export function throwDisc(kind, power, { yaw = settings.camYaw, pitch = settings.camPitch } = {}) {
	const m = metre();
	const right = transformations.getCameraRight(), forward = transformations.getCameraForward();
	const backhand = throwing.style == 'backhand';
	const eye = [settings.camPosX / m, settings.camPosY / m, settings.camPosZ / m];
	const from = [0, 1, 2].map((k) => eye[k] + forward[k] * 0.35 + right[k] * (backhand ? 0.1 : 0.32) + (k == 1 ? -0.45 : 0));
	const D = flight.DISCS[kind];
	const speed = speedForPower(kind, power);
	const spin = (backhand ? -1 : 1) * D.spin * speed / D.fastest;
	const s = flight.launch(kind, from, { yaw, pitch: clamp(pitch + RELEASE_UP, -0.6, 1.0), speed, hyzer: throwing.hyzer, nose: NOSE, spin });
	// carried on as the thrower goes (a boat, a horse)
	const place = hunting.hunterPlace();
	s.v[0] += (place.vx ?? 0) / m; s.v[2] += (place.vz ?? 0) / m;
	const id = `${localId}:${kind}`;
	removeDisc(id, true);
	const disc = { id, owner: localId, kind, s, state: 'flying', hole: null, mine: true, turned: 0, from: [...from] };
	discs.push(disc);
	hand[kind] = false;
	throwing.released = 0.35;
	discStats.thrown++;
	countThrow(from);
	for (const fn of listeners.throw) fn({ id, kind, owner: localId, s: { p: s.p, v: s.v, n: s.n, spin: s.spin } });
	return disc;
}

// someone else's throw (net.js): flown here too
export function remoteThrow({ id, kind, owner, s }) {
	removeDisc(id, true);
	discs.push({ id, owner, kind, s: { kind, p: [...s.p], v: [...s.v], n: [...s.n], spin: s.spin, t: 0 }, state: 'flying', hole: null, mine: false, turned: 0 });
	if (discs.length > MAX_DISCS) discs.shift();
}
// where someone else's came to rest (net.js): put right there
export function remoteRest({ id, p, n, state, hole }) {
	const disc = discs.find((d) => d.id === id);
	if (!disc) return;
	disc.s.p = [...p]; disc.s.n = [...n]; disc.s.v = [0, 0, 0];
	disc.state = state; disc.hole = hole;
}
export function remoteGone(id) { removeDisc(id, true); }
// into a game with others (or out of one): this player's discs back in its hand, everyone else's gone
export function discsForNewGame() {
	discs.length = 0;
	for (const kind of KINDS) hand[kind] = true;
	play.hole = null; play.throws = 0;
}

// What a disc meets (see the top)
//-------------------------------------------------
function settle(disc, state) {
	disc.state = state;
	disc.s.v = [0, 0, 0];
	discStats.landed++;
	if (!disc.mine) return;
	discStats.lastFlight = { kind: disc.kind, state, from: disc.from, to: [...disc.s.p], metres: disc.from ? Math.hypot(disc.s.p[0] - disc.from[0], disc.s.p[2] - disc.from[2]) : 0, hole: disc.hole };
	for (const fn of listeners.rest) fn({ id: disc.id, p: disc.s.p, n: disc.s.n, state, hole: disc.hole });
	if (state == 'basket') holeDone(disc);
}
const groundAt = (x, z) => terrain.land.heightAt(x * metre(), z * metre()) / metre();

function stepDisc(disc, dt, check) {
	const s = disc.s, m = metre();
	const sea = settings.waterWorldPosY / m;
	if (disc.state == 'flying') {
		flight.fly(s, dt);
		const ground = groundAt(s.p[0], s.p[2]);
		if (s.p[1] <= sea && ground < sea) {
			s.p[1] = sea;
			s.n = [0, 1, 0];
			settle(disc, 'water');
			return;
		}
		if (s.p[1] <= ground + 0.012) {
			// down: it stops falling, skids on as far as it came in flat
			s.p[1] = ground + 0.012;
			const along = Math.hypot(s.v[0], s.v[2]);
			const keep = clamp(0.75 - Math.abs(s.v[1]) / (along + 0.1) * 0.5, 0.05, 0.75);
			s.v = [s.v[0] * keep, 0, s.v[2] * keep];
			disc.state = 'sliding';
			return;
		}
		if (check) meetThings(disc);
		if (s.t > MOST_FLIGHT) settle(disc, 'rest');
		return;
	}
	if (disc.state == 'sliding') {
		const along = Math.hypot(s.v[0], s.v[2]);
		const slow = SLIDE * dt;
		if (along <= slow) { settle(disc, 'rest'); return; }
		s.v[0] *= (along - slow) / along; s.v[2] *= (along - slow) / along;
		s.p[0] += s.v[0] * dt; s.p[2] += s.v[2] * dt;
		const ground = groundAt(s.p[0], s.p[2]);
		if (ground < sea) { s.p[1] = sea; s.n = [0, 1, 0]; settle(disc, 'water'); return; }
		s.p[1] = ground + 0.012;
		s.n = s.n.map((v, k) => v + ((k == 1 ? 1 : 0) - v) * Math.min(dt * 8, 1));
		const nl = Math.hypot(...s.n); s.n = s.n.map((v) => v / nl);
		if (check) meetThings(disc);
	}
}
// trees, boulders and the baskets round a disc
function meetThings(disc) {
	const s = disc.s, m = metre();
	const x = s.p[0] * m, z = s.p[2] * m, y = s.p[1] * m;
	const bounce = (nx, nz) => {
		const vn = s.v[0] * nx + s.v[2] * nz;
		if (vn >= 0) return;
		s.v[0] -= 1.35 * vn * nx; s.v[2] -= 1.35 * vn * nz;
		s.v = s.v.map((v) => v * 0.5);
		s.spin *= 0.5;
		// knocked about: its face tipped a little
		s.n = [s.n[0] + 0.25 * nx, s.n[1], s.n[2] + 0.25 * nz];
		const nl = Math.hypot(...s.n); s.n = s.n.map((v) => v / nl);
		discStats.bounced++;
	};
	const reach = 1.5 * m, r = flight.RADIUS * m;
	if (settings.enableForest) forest.trunksNear(x, z, reach, (tx, tz, half, bottom, top) => {
		if (y < bottom || y > top + (top - bottom)) return;
		const dx = x - tx, dz = z - tz, d = Math.hypot(dx, dz);
		if (d < half + r && d > 1e-6) {
			bounce(dx / d, dz / d);
			s.p[0] = (tx + dx / d * (half + r)) / m; s.p[2] = (tz + dz / d * (half + r)) / m;
		}
	});
	const blockOff = (bx, bz, half, bottom, top) => {
		if (y < bottom || y > top + r) return;
		const dx = x - bx, dz = z - bz;
		if (Math.abs(dx) > half + r || Math.abs(dz) > half + r) return;
		if (half + r - Math.abs(dx) < half + r - Math.abs(dz)) { bounce(Math.sign(dx), 0); s.p[0] = (bx + Math.sign(dx) * (half + r)) / m; }
		else { bounce(0, Math.sign(dz)); s.p[2] = (bz + Math.sign(dz) * (half + r)) / m; }
	};
	if (settings.enableBoulders) boulders.bouldersNear(x, z, reach, blockOff);
	town.boxesNear(x, z, reach, blockOff);		// (the houses and walls of the towns)
	// the baskets: into the chains slow enough, and it drops into the basket. Faster, it is thrown back out
	holes.forEach((hole, k) => {
		const b = hole.basket;
		const dx = x - b.x, dz = z - b.z, d = Math.hypot(dx, dz) / m;
		if (d > BASKET.radius) return;
		const up = (y - b.y) / m;
		if (up < BASKET.trayBottom || up > BASKET.chainTop) return;
		const speed = Math.hypot(...s.v);
		if (speed < CATCH_SPEED || up < BASKET.trayTop) {
			disc.hole = k;
			s.p = [b.x / m + dx / m * 0.3, b.y / m + BASKET.trayBottom + 0.05, b.z / m + dz / m * 0.3];
			s.n = [0, 1, 0];
			discStats.caught++;
			settle(disc, 'basket');
		} else {
			const nx = d > 1e-4 ? dx / m / d : 1, nz = d > 1e-4 ? dz / m / d : 0;
			s.v = [-s.v[0] * 0.3 + nx * 2, s.v[1] * 0.3, -s.v[2] * 0.3 + nz * 2];
			discStats.bounced++;
		}
	});
}

// Picking one up (E): this player's own, lying near enough
hunting.onUse((place) => {
	const m = metre();
	const mine = discs.filter((d) => d.mine && d.state != 'flying' && Math.hypot(d.s.p[0] * m - place.x, d.s.p[2] * m - place.z) < PICK_REACH * m && Math.abs(d.s.p[1] * m - place.y) < 2.5 * m);
	if (!mine.length) return false;
	for (const disc of mine) {
		hand[disc.kind] = true;
		removeDisc(disc.id);
	}
	weapons.equipWeapon(mine[0].kind);
	help.toast(`Picked up your ${flight.DISCS[mine[0].kind].name.toLowerCase()}`);
	return true;
});

// The course (see THE COURSE at the top)
//-------------------------------------------------
// each: { number, tee: { x, z, y, heading }, basket: { x, z, y }, length (metres), par, colour }
export let holes = [];
let courseFor = '';
let hostCourse = false;		// the holes are the host's (see IN A GAME WITH OTHERS at the top), not laid out here
export let longestThrow = 0;
function random(seed) {
	let a = seed >>> 0;
	return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hueColour(h) {
	const f = (n) => { const k = (n + h * 12) % 12; return 0.55 - 0.45 * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
	return [f(0), f(8), f(4)];
}
function layCourse() {
	const land = terrain.land;
	holes = [];
	if (!settings.discGolfEnabled || !land) return;
	const m = metre();
	const sea = settings.waterWorldPosY;
	longestThrow = flight.flatThrow('driver').along;
	const longest = LONGEST_THROWS * longestThrow;
	const rand = random(Math.round(settings.discGolfSeed) * 9973 + 17);
	const count = clamp(Math.round(settings.discGolfHoles), 1, 18);
	// dry, level enough ground
	const dry = (x, z) => land.heightAt(x, z) > sea + 0.6 * m;
	const level = (x, z, most) => { const h = land.heightAt(x, z), step = 2 * m; return Math.abs(land.heightAt(x + step, z) - h) < most * step && Math.abs(land.heightAt(x, z + step) - h) < most * step; };
	const half = settings.terrainWorldSize * 0.5 - 100 * m;
	const inside = (x, z) => Math.abs(x) < half && Math.abs(z) < half;
	const used = [];
	const clear = (x, z) => used.every(([ux, uz]) => Math.hypot(ux - x, uz - z) > 25 * m);
	// the first tee: somewhere on the open grassland
	const starts = land.findSpawnPoints(terrain.ZONE_GRASSLAND, 60, { seed: Math.round(settings.discGolfSeed) * 31 + 5, minSpacing: 200, maxSlope: 0.15 }).filter((s) => dry(s.x, s.z) && level(s.x, s.z, 0.2));
	if (!starts.length) return;
	let tee = starts[Math.floor(rand() * starts.length)];
	for (let k = 0; k < count; k++) {
		let made = null;
		for (let attempt = 0; attempt < 80 && !made; attempt++) {
			const angle = rand() * Math.PI * 2;
			const length = SHORTEST + Math.pow(rand(), 1.4) * (longest - SHORTEST);
			const bx = tee.x + Math.sin(angle) * length * m, bz = tee.z - Math.cos(angle) * length * m;
			if (!inside(bx, bz) || !dry(bx, bz) || !level(bx, bz, 0.25) || !clear(bx, bz)) continue;
			// over dry land most of the way, and not over a mountain
			let wet = 0, rise = 0;
			for (let t = 0.1; t < 1; t += 0.1) {
				const x = tee.x + (bx - tee.x) * t, z = tee.z + (bz - tee.z) * t;
				if (!dry(x, z)) wet++;
				rise = Math.max(rise, Math.abs(land.heightAt(x, z) - land.heightAt(tee.x, tee.z)) / m);
			}
			if (wet > 1 || rise > 35) continue;
			made = { bx, bz, angle, length };
		}
		if (!made) {
			// nowhere from this tee: another tee, somewhere else on the grassland
			tee = starts[Math.floor(rand() * starts.length)];
			continue;
		}
		const number = holes.length + 1;
		holes.push({
			number, colour: hueColour((number - 1) / Math.max(count, 1) * 0.92),
			tee: { x: tee.x, z: tee.z, y: land.groundAt(tee.x, tee.z), heading: made.angle },
			basket: { x: made.bx, z: made.bz, y: land.groundAt(made.bx, made.bz) },
			length: made.length, par: made.length < 100 ? 3 : made.length < 170 ? 4 : 5,
		});
		used.push([tee.x, tee.z], [made.bx, made.bz]);
		// the next tee: a little way on from this basket
		let next = null;
		for (let attempt = 0; attempt < 30 && !next; attempt++) {
			const a = rand() * Math.PI * 2, d = (15 + rand() * 20) * m;
			const x = made.bx + Math.sin(a) * d, z = made.bz - Math.cos(a) * d;
			if (inside(x, z) && dry(x, z) && level(x, z, 0.2) && clear(x, z)) next = { x, z };
		}
		tee = next ?? starts[Math.floor(rand() * starts.length)];
	}
	makeMarkers();
}

// Playing a hole (see the top)
//-------------------------------------------------
const play = { hole: null, throws: 0 };
export const scorecard = new Map();		// hole number -> { throws, par }
function countThrow(from) {
	const m = metre();
	const tee = holes.find((h) => Math.hypot(h.tee.x / m - from[0], h.tee.z / m - from[2]) < TEE_REACH);
	if (tee) { play.hole = holes.indexOf(tee); play.throws = 1; return; }
	if (play.hole !== null) play.throws++;
}
function holeDone(disc) {
	if (disc.hole !== play.hole) { help.toast(`In hole ${holes[disc.hole]?.number}'s basket`); return; }
	const hole = holes[play.hole];
	const score = play.throws - hole.par;
	scorecard.set(hole.number, { throws: play.throws, par: hole.par });
	discStats.holes++;
	const word = play.throws == 1 ? 'An ace!' : score <= -2 ? 'Eagle' : score == -1 ? 'Birdie' : score == 0 ? 'Par' : score == 1 ? 'Bogey' : `+${score}`;
	help.toast(`Hole ${hole.number} in ${play.throws} (par ${hole.par}): ${word}`, 3.5);
	for (const fn of listeners.score) fn({ hole: hole.number, throws: play.throws, par: hole.par });
	play.hole = null;
	play.throws = 0;
}

// Per frame
//-------------------------------------------------
let lastTime = performance.now();
export function discUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	const key = [settings.discGolfEnabled, settings.discGolfSeed, settings.discGolfHoles, terrain.land ? terrain.land.points : 0, terrain.land ? terrain.land.heights?.length : 0].join();
	if (!hostCourse && terrain.land && (key != courseFor || terrain.land !== laidOn)) { courseFor = key; laidOn = terrain.land; layCourse(); }
	if (terrain.land) {
		for (const disc of discs) {
			let k = 0;
			for (let left = elapsed; left > 1e-6 && (disc.state == 'flying' || disc.state == 'sliding'); left -= SUBSTEP, k++) {
				stepDisc(disc, Math.min(left, SUBSTEP), k % 4 == 0);
			}
			disc.turned += (disc.state == 'flying' ? disc.s.spin : 0) * elapsed;
		}
	}
	// the wind up
	if (throwing.windUp >= 0) {
		if (!holdingDisc()) throwing.windUp = -1;
		else throwing.windUp += elapsed;
	}
	throwing.released = Math.max(throwing.released - elapsed, 0);
	hunting.crosshair.hidden = hunting.crosshair.hidden && !holdingDisc();
	showBox();
	showMarkers();
	showNames();
}
let laidOn = null;

// The course in a game with others (see IN A GAME WITH OTHERS at the top)
//-------------------------------------------------
// host: the holes as they are, to send
export function courseShare() {
	const r = (v) => Math.round(v * 1000) / 1000;
	return holes.map((h) => [h.number, h.colour.map(r), [h.tee.x, h.tee.z, h.tee.y, h.tee.heading].map(r), [h.basket.x, h.basket.z, h.basket.y].map(r), r(h.length), h.par]);
}
// joiner: the host's holes (courseShare's), or null to lay out its own again (out of the game)
export function courseFromHost(list) {
	const before = JSON.stringify(courseShare());
	if (!list) {
		if (!hostCourse) return;
		hostCourse = false;
		courseFor = '';
	} else {
		hostCourse = true;
		holes = list.map(([number, colour, tee, basket, length, par]) => ({ number, colour, tee: { x: tee[0], z: tee[1], y: tee[2], heading: tee[3] },
			basket: { x: basket[0], z: basket[1], y: basket[2] }, length, par }));
		if (JSON.stringify(courseShare()) == before) return;
		makeMarkers();
	}
	play.hole = null; play.throws = 0;
	scorecard.clear();
}

// for testing: thrown by power, as the view is (or yaw and pitch given), the release angle and style set
export function testThrow(kind, power, { hyzer = 0, style = 'backhand', yaw, pitch } = {}) {
	throwing.hyzer = hyzer;
	throwing.style = style;
	hand[kind] = true;
	return throwDisc(kind, power, { yaw: yaw ?? settings.camYaw, pitch: pitch ?? settings.camPitch });
}
export function testPlay() { return { ...play, card: Object.fromEntries(scorecard) }; }
// for testing: the discs in the air flown on by a number of seconds, at once
export function simulateDiscs(seconds) {
	for (let t = 0; t < seconds; t += SUBSTEP * 4) {
		for (const disc of discs) for (let k = 0; k < 4 && (disc.state == 'flying' || disc.state == 'sliding'); k++) stepDisc(disc, SUBSTEP, k == 0);
	}
}
export function testHand() { return { ...hand }; }

// What is shown: the disc box in the bottom right, and the markers over the course
//-------------------------------------------------
const box = vm.ammoBox();
let boxShown = '';
function showBox() {
	const kind = holdingDisc();
	const on = !!kind && hunting.hunterPlace().active;
	box.style.display = on ? '' : 'none';
	if (!on) return;
	const power = throwing.windUp >= 0 ? clamp(throwing.windUp / WIND_UP_SECONDS, 0, 1) : 0;
	const hole = play.hole !== null ? holes[play.hole] : null;
	const m = metre();
	const toBasket = hole ? Math.hypot(hole.basket.x - settings.camPosX, hole.basket.z - settings.camPosZ) / m : 0;
	const key = [kind, Math.round(power * 40), throwing.hyzer, throwing.style, ...KINDS.map((k) => hand[k]), hole?.number, play.throws, Math.round(toBasket)].join('|');
	if (key == boxShown) return;
	boxShown = key;
	const label = vm.LABEL;
	const dot = (k) => `<div title="${flight.DISCS[k].name}" style="width: 16px; height: 16px; border-radius: 50%; background: ${hand[k] ? `rgb(${COLOURS[k].map((c) => Math.round(c * 255)).join(',')})` : 'transparent'}; border: 2px solid rgb(${COLOURS[k].map((c) => Math.round(c * 255)).join(',')}); opacity: ${k == kind ? 1 : 0.55};"></div>`;
	box.innerHTML = `<div style="display: flex; gap: 6px; justify-content: flex-end;">${KINDS.map(dot).join('')}</div>`
		+ `<div style="${label} text-align: right;">${flight.DISCS[kind].name.toUpperCase()} · ${hand[kind] ? 'IN HAND' : 'THROWN'}</div>`
		+ `<div style="margin-top: 6px; width: 180px; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.15); overflow: hidden;"><div style="height: 100%; width: ${(power * 100).toFixed(0)}%; background: ${power > 0.95 ? '#f2c46d' : '#8fc3e8'};"></div></div>`
		+ `<div style="margin-top: 5px; font-size: 12px; letter-spacing: 0.06em; font-weight: 600;">${throwing.style.toUpperCase()} · ${angleWord().toUpperCase()}</div>`
		+ (hole ? `<div style="margin-top: 4px; font-size: 12px; color: rgb(${hole.colour.map((c) => Math.round(c * 255)).join(',')});">HOLE ${hole.number} · PAR ${hole.par} · THROWS ${play.throws} · ${Math.round(toBasket)} m</div>` : (holes.length ? `<div style="margin-top: 4px; font-size: 12px; color: rgba(232,232,232,0.7);">Throw from a tee to play its hole</div>` : ''));
}

const markers = document.createElement('div');
markers.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: 4; font-family: system-ui, sans-serif; overflow: hidden;';
document.body.appendChild(markers);
let markerEls = [];
function makeMarkers() {
	markers.innerHTML = '';
	markerEls = [];
	for (const hole of holes) {
		const c = `rgb(${hole.colour.map((v) => Math.round(v * 255)).join(',')})`;
		for (const what of ['tee', 'basket']) {
			const el = document.createElement('div');
			el.style.cssText = `position: absolute; transform: translate(-50%, -100%); display: none; padding: 1px 7px; border-radius: 9px; background: rgba(0, 0, 0, 0.55); border: 2px solid ${c}; color: #fff; font-size: 12px; font-weight: 600; white-space: nowrap;`;
			el.innerHTML = what == 'tee' ? `<span style="color: ${c};">TEE</span> ${hole.number}` : `<span style="color: ${c};">●</span> ${hole.number}`;
			markers.appendChild(el);
			markerEls.push({ el, hole, what, shown: false, text: '' });
		}
	}
}
// the thrower's name over each disc, in a game with others (see FINDING A DISC at the top)
const nameTags = new Map();		// disc id -> { el, text }
function showNames() {
	const on = settings.gameMode == 'Hunting' && hunting.hunterPlace().active;
	const viewProj = transformations.getViewProj();
	const W = innerWidth, H = innerHeight, m = metre();
	const seen = new Set();
	for (const disc of discs) {
		const name = on ? nameFor(disc.owner) : null;
		if (!name) continue;
		const p = disc.s.p;
		if (Math.hypot(p[0] * m - settings.camPosX, p[1] * m - settings.camPosY, p[2] * m - settings.camPosZ) > NAME_REACH * m) continue;
		const c = [0, 1, 2, 3].map((r) => viewProj[r] * p[0] * m + viewProj[4 + r] * (p[1] + 0.45) * m + viewProj[8 + r] * p[2] * m + viewProj[12 + r]);
		if (c[3] < 0.1) continue;
		const x = (c[0] / c[3] * 0.5 + 0.5) * W, y = (0.5 - c[1] / c[3] * 0.5) * H;
		if (x < -60 || x > W + 60 || y < -20 || y > H + 20) continue;
		let tag = nameTags.get(disc.id);
		if (!tag) {
			const el = document.createElement('div');
			el.style.cssText = 'position: absolute; transform: translate(-50%, -100%); padding: 0 6px; border-radius: 8px; background: rgba(0, 0, 0, 0.5); color: #fff; font-size: 11px; font-weight: 600; white-space: nowrap;';
			names.appendChild(el);
			tag = { el, text: '' };
			nameTags.set(disc.id, tag);
		}
		const text = `<span style="color: rgb(${COLOURS[disc.kind].map((v) => Math.round(v * 255)).join(',')});">●</span> ${html(name)}`;
		if (text != tag.text) { tag.text = text; tag.el.innerHTML = text; }
		tag.el.style.left = x.toFixed(0) + 'px';
		tag.el.style.top = y.toFixed(0) + 'px';
		seen.add(disc.id);
	}
	for (const [id, tag] of nameTags) if (!seen.has(id)) { tag.el.remove(); nameTags.delete(id); }
	glowStats.named = seen.size;
}
const names = document.createElement('div');
names.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: 4; font-family: system-ui, sans-serif; overflow: hidden;';
document.body.appendChild(names);
const html = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function showMarkers() {
	const on = holes.length > 0 && settings.gameMode == 'Hunting' && hunting.hunterPlace().active;
	markers.style.display = on ? '' : 'none';
	if (!on) return;
	const viewProj = transformations.getViewProj();
	const W = innerWidth, H = innerHeight, m = metre();
	for (const marker of markerEls) {
		const at = marker.what == 'tee' ? marker.hole.tee : marker.hole.basket;
		const away = Math.hypot(at.x - settings.camPosX, at.z - settings.camPosZ) / m;
		const playing = play.hole !== null && holes[play.hole] === marker.hole;
		let shown = false;
		if (away < MARKER_REACH || (playing && marker.what == 'basket')) {
			const p = [at.x, at.y + (marker.what == 'tee' ? 1.2 : 2.0) * m, at.z, 1];
			const c = [0, 1, 2, 3].map((r) => viewProj[r] * p[0] + viewProj[4 + r] * p[1] + viewProj[8 + r] * p[2] + viewProj[12 + r] * p[3]);
			if (c[3] > 0.1) {
				const x = (c[0] / c[3] * 0.5 + 0.5) * W, y = (0.5 - c[1] / c[3] * 0.5) * H;
				if (x > -40 && x < W + 40 && y > -20 && y < H + 20) {
					marker.el.style.left = x.toFixed(0) + 'px';
					marker.el.style.top = y.toFixed(0) + 'px';
					shown = true;
					const text = playing && marker.what == 'basket' ? ` ${Math.round(away)} m` : '';
					if (text != marker.text) {
						marker.text = text;
						const c2 = `rgb(${marker.hole.colour.map((v) => Math.round(v * 255)).join(',')})`;
						marker.el.innerHTML = (marker.what == 'tee' ? `<span style="color: ${c2};">TEE</span> ${marker.hole.number}` : `<span style="color: ${c2};">●</span> ${marker.hole.number}`) + text;
					}
					marker.el.style.opacity = playing || away < 150 ? '1' : '0.75';
				}
			}
		}
		if (shown != marker.shown) { marker.shown = shown; marker.el.style.display = shown ? '' : 'none'; }
	}
}

// The disc in the hand
//-------------------------------------------------
const PAINTS = { driver: 11, midrange: 12, putter: 13 };
const HAND_MESH = (() => {
	const mb = vm.meshBuilder();
	KINDS.forEach((kind, k) => {
		const part = k + 1, paint = PAINTS[kind];
		const r = flight.RADIUS, sides = 10;
		const at = (j, y, rr = r) => { const a = j / sides * Math.PI * 2; return [Math.cos(a) * rr, y, Math.sin(a) * rr]; };
		for (let j = 0; j < sides; j++) {
			mb.tri([0, 0.016, 0], at(j, 0.014), at(j + 1, 0.014), part, paint);
			mb.quad(at(j, 0.014), at(j + 1, 0.014), at(j + 1, 0.0, r * 0.97), at(j, 0.0, r * 0.97), part, paint);
		}
	});
	return mb.done();
})();
const handView = new vm.Viewmodel('Disc', HAND_MESH);
function drawHand(kind) {
	if (!hand[kind]) return;
	// at the right hip; wound up, back across the body (a backhand) or back to the right (a forehand); just thrown, gone
	const power = throwing.windUp >= 0 ? vm.ease(throwing.windUp / WIND_UP_SECONDS) : 0;
	const backhand = throwing.style == 'backhand';
	const x = 0.22 + (backhand ? -0.46 : 0.14) * power, y = -0.36 + 0.08 * power, z = -0.42 + 0.16 * power;
	let gun = mat4.translation([x, y, z]);
	gun = mat4.rotateY(gun, (backhand ? 0.9 : -0.6) * power);
	gun = mat4.rotateZ(gun, throwing.hyzer * (backhand ? 1 : -1));
	gun = mat4.rotateX(gun, 0.15);
	const parts = KINDS.map((k) => k == kind ? vm.IDENTITY : vm.HIDDEN);
	handView.draw(gun, [vm.IDENTITY, ...parts]);
}

// Drawing the course and the discs
//-------------------------------------------------
const MESHES = (() => {
	const basket = [], tee = [], disc = [];
	const push = (into, p, what) => into.push(p[0], p[1], p[2], what);
	const tri = (into, a, b, c, what) => { push(into, a, what); push(into, b, what); push(into, c, what); };
	const quad = (into, a, b, c, d, what) => { tri(into, a, b, c, what); tri(into, a, c, d, what); };
	const ring = (sides, r, y) => Array.from({ length: sides }, (_, j) => { const a = j / sides * Math.PI * 2; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
	const band = (into, sides, r0, y0, r1, y1, what) => { const A = ring(sides, r0, y0), B = ring(sides, r1, y1); for (let j = 0; j < sides; j++) quad(into, A[j], A[(j + 1) % sides], B[(j + 1) % sides], B[j], what); };
	// the basket: its pole (8), the band round the top in the hole's colour (16), the chains (32), the basket and its bottom (22)
	band(basket, 4, 0.025, 0, 0.025, BASKET.poleTop, 1);
	band(basket, 8, 0.31, BASKET.chainTop - 0.05, 0.31, BASKET.chainTop + 0.03, 0);
	for (let j = 0; j < 8; j++) {
		const a = j / 8 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), w = 0.012;
		quad(basket, [c * 0.29 - s * w, BASKET.chainTop - 0.04, s * 0.29 + c * w], [c * 0.29 + s * w, BASKET.chainTop - 0.04, s * 0.29 - c * w], [c * 0.05 + s * w, BASKET.trayTop + 0.1, s * 0.05 - c * w], [c * 0.05 - s * w, BASKET.trayTop + 0.1, s * 0.05 + c * w], 2);
		const b = a + Math.PI / 8, cb = Math.cos(b), sb = Math.sin(b);
		quad(basket, [cb * 0.3 - sb * w, BASKET.chainTop - 0.04, sb * 0.3 + cb * w], [cb * 0.3 + sb * w, BASKET.chainTop - 0.04, sb * 0.3 - cb * w], [cb * 0.27 + sb * w, BASKET.trayTop + 0.02, sb * 0.27 - cb * w], [cb * 0.27 - sb * w, BASKET.trayTop + 0.02, sb * 0.27 + cb * w], 2);
	}
	band(basket, 8, 0.31, BASKET.trayBottom, 0.33, BASKET.trayTop, 1);
	const floor = ring(8, 0.31, BASKET.trayBottom);
	for (let j = 1; j < 7; j++) tri(basket, floor[0], floor[j], floor[j + 1], 1);
	// the tee pad: a slab of concrete with its edge in the hole's colour (10)
	const [w, h, l] = [0.75, 0.08, 1.4];
	quad(tee, [-w, h, -l], [w, h, -l], [w, h, l], [-w, h, l], 3);
	for (const [a, b] of [[[-w, -l], [w, -l]], [[w, -l], [w, l]], [[w, l], [-w, l]], [[-w, l], [-w, -l]]]) quad(tee, [a[0], -0.1, a[1]], [b[0], -0.1, b[1]], [b[0], h, b[1]], [a[0], h, a[1]], 3);
	// a disc: its top (10), its rim (20)
	const r = flight.RADIUS, sides = 10;
	for (let j = 0; j < sides; j++) {
		const a0 = j / sides * Math.PI * 2, a1 = (j + 1) / sides * Math.PI * 2;
		const p = (a, y, rr = r) => [Math.cos(a) * rr, y, Math.sin(a) * rr];
		tri(disc, [0, 0.016, 0], p(a0, 0.014), p(a1, 0.014), 4);
		quad(disc, p(a0, 0.014), p(a1, 0.014), p(a1, 0, r * 0.97), p(a0, 0, r * 0.97), 5);
	}
	return { basket: new Float32Array(basket), tee: new Float32Array(tee), disc: new Float32Array(disc) };
})();
export const COURSE_TRIANGLES = { basket: MESHES.basket.length / 12, tee: MESHES.tee.length / 12, disc: MESHES.disc.length / 12 };

const INSTANCE_FLOATS = 20;
const MOST_INSTANCES = 18 + MAX_DISCS;
const GLOW_FLOATS = 8;				// where (3), how big the card is (half its width, world units), colour (3), a number of its own
const shaderModule = device.createShaderModule({ label: "vf_discgolf", code: vf_discgolf });
const glowModule = device.createShaderModule({ label: "vf_discGlow", code: vf_discGlow });
const meshBuffers = {};
for (const [name, data] of Object.entries(MESHES)) {
	meshBuffers[name] = device.createBuffer({ label: `disc golf ${name}`, size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	device.queue.writeBuffer(meshBuffers[name], 0, data);
}
const instanceBuffers = {};
for (const name of Object.keys(MESHES)) instanceBuffers[name] = device.createBuffer({ label: `disc golf ${name} instances`, size: MOST_INSTANCES * INSTANCE_FLOATS * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
const uniformBuffer = device.createBuffer({ label: "disc golf Uniform", size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const glowData = new Float32Array(MAX_DISCS * GLOW_FLOATS);
const glowBuffer = device.createBuffer({ label: "disc glow instances", size: glowData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const pipeline = device.createRenderPipeline({
	label: "disc golf pipeline",
	layout: 'auto',
	vertex: {
		module: shaderModule,
		entryPoint: "vertexMain",
		buffers: [
			{ arrayStride: 16, attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }] },
			{ arrayStride: INSTANCE_FLOATS * 4, stepMode: 'instance', attributes: [0, 1, 2, 3, 4].map((k) => ({ format: "float32x4", offset: k * 16, shaderLocation: k + 1 })) },
		],
	},
	fragment: { module: shaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
});
// the glow (see THE GLOW in vf_discgolf.js): added on, seen and through what is in front
const glowPipeline = (fragment, depthCompare) => device.createRenderPipeline({
	label: `disc ${fragment} pipeline`,
	layout: 'auto',
	vertex: { module: glowModule, entryPoint: "vertexMain", buffers: [{ arrayStride: GLOW_FLOATS * 4, stepMode: 'instance', attributes: [
		{ format: "float32x4", offset: 0, shaderLocation: 0 }, { format: "float32x4", offset: 16, shaderLocation: 1 }] }] },
	fragment: { module: glowModule, entryPoint: fragment, targets: [{ format: canvasFormat, blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'zero', dstFactor: 'one' } } }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: false, depthCompare, format: 'depth24plus' },
});
const glowSeen = glowPipeline('fragmentGlow', 'less'), glowHidden = glowPipeline('fragmentGlowHidden', 'greater-equal');
const glowBindGroup = device.createBindGroup({ label: "disc glow bind group", layout: glowSeen.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
const glowHiddenBindGroup = device.createBindGroup({ label: "disc glow (hidden) bind group", layout: glowHidden.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniformBuffer } }] });
const startSeconds = performance.now() / 1000;
// the discs that glow now: out of the hand, within GLOW_REACH
function glowing() {
	const m = metre();
	return discs.filter((d) => Math.hypot(d.s.p[0] * m - settings.camPosX, d.s.p[1] * m - settings.camPosY, d.s.p[2] * m - settings.camPosZ) < GLOW_REACH * m).slice(0, MAX_DISCS);
}
export const glowStats = { glowing: 0, named: 0 };

let bindGroup = null, boundLUT = null;

// a disc's matrix: where it is, its face turned to n, spun round it as it has spun, made world units
function discMatrix(disc) {
	const m = metre();
	const n = disc.s.n;
	const helper = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	let u = [n[1] * helper[2] - n[2] * helper[1], n[2] * helper[0] - n[0] * helper[2], n[0] * helper[1] - n[1] * helper[0]];
	const ul = Math.hypot(...u); u = u.map((v) => v / ul);
	const w2 = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]];
	const basis = mat4.create(u[0], u[1], u[2], 0, n[0], n[1], n[2], 0, w2[0], w2[1], w2[2], 0, 0, 0, 0, 1);
	let model = mat4.translation(disc.s.p.map((v) => v * m));
	model = mat4.scale(model, [m, m, m]);
	model = mat4.multiply(model, basis);
	return mat4.rotateY(model, disc.turned);
}

// with the solid things
export function discGolfPass(aEncoder, mainpassDepthTexture) {
	const showCourse = holes.length > 0;
	if (!showCourse && discs.length == 0) return;
	const camera = vm.cameraAxes();
	const m = metre();
	const lists = { basket: [], tee: [], disc: [] };
	if (showCourse) {
		for (const hole of holes) {
			lists.basket.push([mat4.scale(mat4.translation([hole.basket.x, hole.basket.y, hole.basket.z]), [m, m, m]), hole.colour]);
			lists.tee.push([mat4.scale(mat4.rotateY(mat4.translation([hole.tee.x, hole.tee.y, hole.tee.z]), -hole.tee.heading), [m, m, m]), hole.colour]);
		}
	}
	for (const disc of discs) lists.disc.push([discMatrix(disc), COLOURS[disc.kind]]);
	const u = new Float32Array(32);
	u.set(transformations.getViewProj(), 0);
	u.set([settings.camPosX, settings.camPosY, settings.camPosZ, 0], 16);
	u.set([settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, performance.now() / 1000 - startSeconds, 0], 20);
	u.set([...camera.right, 0], 24);
	u.set([...camera.up, 0], 28);
	device.queue.writeBuffer(uniformBuffer, 0, u);
	if (!bindGroup || boundLUT !== skyViewLUTtexture) {
		boundLUT = skyViewLUTtexture;
		bindGroup = device.createBindGroup({
			label: "disc golf bind group",
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: { buffer: uniformBufferLights } },
				{ binding: 2, resource: skyViewLUTtexture.createView() },
				{ binding: 3, resource: linSampler },
			],
		});
	}
	const counts = {};
	for (const [name, list] of Object.entries(lists)) {
		const data = new Float32Array(Math.max(list.length, 1) * INSTANCE_FLOATS);
		list.slice(0, MOST_INSTANCES).forEach(([model, colour], k) => { data.set(model, k * INSTANCE_FLOATS); data.set([...colour, 1], k * INSTANCE_FLOATS + 16); });
		counts[name] = Math.min(list.length, MOST_INSTANCES);
		if (counts[name]) device.queue.writeBuffer(instanceBuffers[name], 0, data, 0, counts[name] * INSTANCE_FLOATS);
	}
	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Disc Golf', 'vf_discgolf'),
	});
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup);
	for (const name of Object.keys(lists)) {
		if (!counts[name]) continue;
		pass.setVertexBuffer(0, meshBuffers[name]);
		pass.setVertexBuffer(1, instanceBuffers[name]);
		pass.draw(MESHES[name].length / 4, counts[name], 0, 0);
	}
	// the glow round each disc (after the discs: it is added on)
	const lit = glowing();
	glowStats.glowing = lit.length;
	if (lit.length) {
		lit.forEach((disc, k) => {
			const away = Math.hypot(disc.s.p[0] * m - settings.camPosX, disc.s.p[1] * m - settings.camPosY, disc.s.p[2] * m - settings.camPosZ) / m;
			glowData.set([...disc.s.p.map((v) => v * m), Math.max(0.6, away * 0.02) * m, ...COLOURS[disc.kind], k * 0.37], k * GLOW_FLOATS);
		});
		device.queue.writeBuffer(glowBuffer, 0, glowData, 0, lit.length * GLOW_FLOATS);
		pass.setVertexBuffer(0, glowBuffer);
		pass.setPipeline(glowHidden);
		pass.setBindGroup(0, glowHiddenBindGroup);
		pass.draw(6, lit.length, 0, 0);
		pass.setPipeline(glowSeen);
		pass.setBindGroup(0, glowBindGroup);
		pass.draw(6, lit.length, 0, 0);
	}
	pass.end();
}
