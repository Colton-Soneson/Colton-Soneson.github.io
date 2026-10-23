import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_dummy } from '../shaders/js/vf_dummy.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as ballistics from './ballistics.js'
import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as boat from './boat.js'

//the dummies fade into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	The players in a game of Hunting with others (net.js connects them): the others, drawn as crash test dummies, and this
	one's own health.

	THE DUMMY (DUMMY_MESH): 90 triangles, in metres, 1.82 tall, standing on y = 0 and facing +z, made of boxes and three sided
		tubes: the pelvis (12), the chest (12), the head (12) and the neck (6), the arms (24: upper arm and forearm, each side)
		and the legs (24: thigh and shin). It carries a rifle: a long box (12), at the chest, pointing where the player looks.
		vf_dummy.js moves the parts: the legs walk, the head, the arms and the rifle follow the look up and down, a dead one goes
		over on to its back.

	THE OTHERS. Each one's state comes in STATE_RATE times a second (net.js): where its feet are, its heading and pitch, how fast
		it is going, whether it is alive and whether it is out hunting, and the vehicle it is on (a boat, a horse), where on it,
		and whether it is sitting. They are drawn INTERPOLATION_SECONDS behind the last one heard, in between the two states
		either side of then, so they move smoothly however the states arrive. One on a vehicle is drawn where it is on it, on
		the vehicle as it is drawn here (its frame, vehicleFrame), so it stays on the deck or in the saddle as they move.
		Sitting at a helm or astride a horse, the dummy sits (see vf_dummy.js).

	SHOT. Each dummy's hitbox is DUMMY_SPHERES: the head, the chest, the belly, and the thighs and shins. A bullet fired here
		that hits one (ballistics.js asks every target along every step of its flight) is reported with the part it hit (onShot,
		net.js sends it to the host, who keeps everyone's health: see DAMAGE in net.js). Bullets from the others' rifles are
		flown here too, for their trails, but do nothing when they hit (they are theirs to report), and do not hit their own
		shooter.

	THIS PLAYER. HEALTH at the start. At 0: down (it cannot move or shoot, the rifle is gone), and RESPAWN_SECONDS later it is up
		again with full health and a full rifle, somewhere new: a random spot on the grassland or in the forest, out of the water.
		While in a game there is a bar for the health in the bottom left, the others' names over their heads, and what happens
		to whom in the top right.
*/
export const HEALTH = 100;
const RESPAWN_SECONDS = 5;
const INTERPOLATION_SECONDS = 0.12;
const NAME_DISTANCE = 150;			// metres: further off than this a player's name is not shown
const FEED_SECONDS = 6;
const MAX_DRAWN = 16;
const DUMMY_FLOATS = 16;				// one dummy as the shader gets it: place (4), pose (4), state (4), what it holds (4)
// how long what each one holds is (the box it carries, see vf_dummy.js), as the long gun it was made with is 1: nothing, a disc: 0
export const HELD_LENGTH = { rifle: 1, shotgun: 0.9, sharps: 1.1, revolver: 0.3, staff: 1.6, none: 0 };
const STRIDE = 1.5;					// metres a stride takes
// the hitbox, in the dummy's own metres: x, y, z, radius, and which part it is (see DAMAGE in net.js)
const DUMMY_SPHERES = [[0, 1.71, 0.01, 0.13, 'head'], [0, 1.33, 0, 0.21, 'chest'], [0, 1.0, 0, 0.19, 'belly'],
	[-0.1, 0.72, 0, 0.1, 'leg'], [0.1, 0.72, 0, 0.1, 'leg'], [-0.1, 0.3, 0, 0.09, 'leg'], [0.1, 0.3, 0, 0.09, 'leg']];

// The mesh
//-------------------------------------------------
// a box between two rectangles across y: [x half width, z back, z front] at y0 and y1, as triangles of [a, b, c, part]
export function box(into, y0, [w0, b0, f0], y1, [w1, b1, f1], part, x = 0) {
	const ring = (y, w, b, f) => [[x - w, y, b], [x + w, y, b], [x + w, y, f], [x - w, y, f]];
	const A = ring(y0, w0, b0, f0), B = ring(y1, w1, b1, f1);
	for (let k = 0; k < 4; k++) {
		const n = (k + 1) % 4;
		into.push([A[k], B[k], B[n], part], [A[k], B[n], A[n], part]);
	}
	into.push([A[0], A[1], A[2], part], [A[0], A[2], A[3], part], [B[0], B[2], B[1], part], [B[0], B[3], B[2], part]);
}
// a three sided tube from a to b, radius ra at a and rb at b (6)
export function tube(into, a, b, ra, rb, part) {
	const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], length = Math.hypot(...axis);
	const d = axis.map((v) => v / length);
	const other = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	let u = [d[1] * other[2] - d[2] * other[1], d[2] * other[0] - d[0] * other[2], d[0] * other[1] - d[1] * other[0]];
	const ul = Math.hypot(...u); u = u.map((v) => v / ul);
	const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
	const ring = (c, r) => Array.from({ length: 3 }, (_, k) => { const t = k / 3 * Math.PI * 2; return [0, 1, 2].map((i) => c[i] + (u[i] * Math.cos(t) + w[i] * Math.sin(t)) * r); });
	const A = ring(a, ra), B = ring(b, rb);
	for (let k = 0; k < 3; k++) {
		const n = (k + 1) % 3;
		into.push([A[k], B[k], B[n], part], [A[k], B[n], A[n], part]);
	}
}
// (the townsfolk are the same dummy, without the rifle: the first bodyTriangles, see townFolk.js)
export const DUMMY_MESH = (() => {
	const t = [];
	box(t, 0.88, [0.16, -0.1, 0.1], 1.05, [0.17, -0.1, 0.1], 0);			// the pelvis (12)
	box(t, 1.05, [0.16, -0.1, 0.1], 1.5, [0.2, -0.11, 0.11], 1);			// the chest (12)
	tube(t, [0, 1.48, 0], [0, 1.6, 0], 0.06, 0.05, 2);						// the neck (6)
	box(t, 1.58, [0.1, -0.1, 0.12], 1.82, [0.095, -0.09, 0.11], 2);			// the head (12)
	// the arms, holding the rifle: the right hand on the wrist of the stock, the left under the forend (24)
	tube(t, [-0.22, 1.45, 0], [-0.2, 1.24, 0.24], 0.055, 0.045, 3);
	tube(t, [-0.2, 1.24, 0.24], [-0.03, 1.31, 0.5], 0.045, 0.035, 4);
	tube(t, [0.22, 1.45, 0], [0.22, 1.2, 0.1], 0.055, 0.045, 5);
	tube(t, [0.22, 1.2, 0.1], [0.07, 1.29, 0.24], 0.045, 0.035, 6);
	// the legs (24)
	for (const [x, thigh, shin] of [[-0.1, 7, 8], [0.1, 9, 10]]) {
		tube(t, [x, 0.95, 0], [x, 0.5, 0.01], 0.08, 0.06, thigh);
		tube(t, [x, 0.5, 0.01], [x, 0.04, -0.01], 0.055, 0.045, shin);
	}
	const body = t.length;
	// the rifle (12): a box along z, from the butt at the right shoulder out past the left hand
	const [x0, x1, y0, y1, z0, z1] = [0.0, 0.05, 1.27, 1.33, -0.05, 1.05];
	const corner = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
	for (const [a, b, c, d] of [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]) {
		t.push([corner(a), corner(b), corner(c), 11], [corner(a), corner(c), corner(d), 11]);
	}
	const data = [];
	for (const [a, b, c, part] of t) for (const p of [a, b, c]) data.push(p[0], p[1], p[2], part);
	return { data: new Float32Array(data), bodyTriangles: body };
})();
const DUMMY_VERTICES = DUMMY_MESH.data.length / 4;
export const DUMMY_TRIANGLE_COUNT = DUMMY_MESH.bodyTriangles;

export const playerStats = { others: 0, drawn: 0, triangles: DUMMY_TRIANGLE_COUNT, rifleTriangles: DUMMY_VERTICES / 3 - DUMMY_TRIANGLE_COUNT, hitsReported: 0, deaths: 0, respawns: 0 };	// for anyone who wants to show it

// Buffers, pipeline
//-------------------------------------------------
const dummyShaderModule = device.createShaderModule({ label: "vf_dummy", code: vf_dummy });
const meshBuffer = device.createBuffer({ label: "dummy mesh", size: DUMMY_MESH.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(meshBuffer, 0, DUMMY_MESH.data);
const instanceData = new Float32Array(MAX_DRAWN * DUMMY_FLOATS);
const instanceBuffer = device.createBuffer({ label: "dummy instances", size: instanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
const dummyUniformBuffer = device.createBuffer({ label: "dummy Uniform", size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const dummyPipeline = device.createRenderPipeline({
	label: "dummy pipeline",
	layout: 'auto',
	vertex: {
		module: dummyShaderModule,
		entryPoint: "vertexMain",
		buffers: [
			{ arrayStride: 16, attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }] },
			{
				arrayStride: DUMMY_FLOATS * 4,
				stepMode: 'instance',
				attributes: [
					{ format: "float32x4", offset: 0, shaderLocation: 1 },		// where, how big
					{ format: "float32x4", offset: 16, shaderLocation: 2 },		// heading, pitch, stride, walking
					{ format: "float32x4", offset: 32, shaderLocation: 3 },		// gone over, hit, colour, sitting
				{ format: "float32x4", offset: 48, shaderLocation: 4 },		// how long what it holds is
				],
			}]
	},
	fragment: { module: dummyShaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
});

// The others
//-------------------------------------------------
const others = new Map();		// id -> { id, name, hue, states: [{ at, s }], view, stride, walking, fallen, hit, sit, tag }
let inGame = false;				// in a game with others (net.js)
const shotListeners = [];
const respawnListeners = [];

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const metre = () => settings.forestUnitsPerMetre;
export const hueOf = (id) => (id * 0.618034 + 0.12) % 1;

// net.js tells this file when a game starts or ends, who is in it, and what each one is doing
export function setInGame(on) {
	inGame = on;
	if (!on) {
		for (const id of [...others.keys()]) removeOther(id);
		local.health = HEALTH;
		if (!local.alive) respawn();
	}
}
export function addOther(id, name) {
	if (others.has(id)) { others.get(id).name = name; return; }
	const tag = document.createElement('div');
	tag.style.cssText = 'position: absolute; transform: translate(-50%, -100%); padding: 1px 6px; border-radius: 3px; background: rgba(0, 0, 0, 0.45); color: #fff; font-size: 12px; white-space: nowrap; display: none;';
	tag.textContent = name;
	overlay.appendChild(tag);
	others.set(id, { id, name, hue: hueOf(id), states: [], view: null, stride: 0, walking: 0, fallen: 0, hit: 0, sit: 0, tag });
}
export function removeOther(id) {
	const other = others.get(id);
	if (!other) return;
	other.tag.remove();
	others.delete(id);
}
// s: [x, y, z (its feet), heading, pitch, speed (metres a second), alive (1 or 0), out hunting (1 or 0), the vehicle it is on ('' for
//		none), x, y, z on it (metres), sitting (0, 1, astride 2), what it holds]
export function otherState(id, s) {
	const other = others.get(id);
	if (!other) return;
	other.states.push({ at: performance.now() / 1000, s });
	if (other.states.length > 12) other.states.shift();
}
export function otherHit(id) {
	const other = others.get(id);
	if (other) other.hit = 1;
}
export function otherList() {
	return [...others.values()].map((o) => ({ id: o.id, name: o.name, view: o.view }));
}
// the others on a vehicle, as their last states say: [{ id, vehicle, local (metres on it), sit }] (net.js: their weight on a boat)
export function othersAboard() {
	const aboard = [];
	for (const other of others.values()) {
		const s = other.states[other.states.length - 1]?.s;
		if (s && s[8]) aboard.push({ id: other.id, vehicle: s[8], local: [s[9], s[10], s[11]], sit: s[12] ?? 0 });
	}
	return aboard;
}
// where a vehicle is, by its id: its frame (toWorld, a place on it in the world), or null. The boats here, and the others add theirs
const vehicleFrames = [(id) => boat.boatById(id)?.frame];
export function addVehicleFrames(find) { vehicleFrames.push(find); }
function vehicleFrame(id) {
	for (const find of vehicleFrames) { const frame = find(id); if (frame) return frame; }
	return null;
}
// told when a bullet fired here hits one of the others: fn(id, part, round)
export function onShot(fn) { shotListeners.push(fn); }
// told when this player is up again: fn([x, y, z])
export function onRespawn(fn) { respawnListeners.push(fn); }
// asked before this player is up again: fn() gives what to say if it is to stay down for now (the horde's rounds, horde.js), or false
const respawnHolds = [];
export function holdRespawn(fn) { respawnHolds.push(fn); }
const heldBy = () => { for (const fn of respawnHolds) { const why = fn(); if (why) return why; } return false; };

// where one is now: in between the two states either side of INTERPOLATION_SECONDS ago
function viewOf(other, now) {
	const states = other.states;
	if (states.length == 0) return null;
	const at = now - INTERPOLATION_SECONDS;
	let a = states[0], b = states[0];
	for (let k = 0; k < states.length; k++) {
		if (states[k].at <= at) a = states[k];
		if (states[k].at >= at) { b = states[k]; break; }
		b = states[k];
	}
	const f = b.at > a.at ? clamp((at - a.at) / (b.at - a.at), 0, 1) : 1;
	const mix = (i) => a.s[i] + (b.s[i] - a.s[i]) * f;
	let turn = b.s[3] - a.s[3];
	turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2));
	const view = { x: mix(0), y: mix(1), z: mix(2), heading: a.s[3] + turn * f, pitch: mix(4), speed: mix(5), alive: b.s[6] > 0.5, hunting: b.s[7] > 0.5, sit: b.s[12] ?? 0, holds: b.s[13] ?? 'rifle' };
	// on a vehicle: where it is on it, on the vehicle as it is drawn here
	const frame = b.s[8] ? vehicleFrame(b.s[8]) : null;
	if (frame) {
		const local = a.s[8] == b.s[8] ? [mix(9), mix(10), mix(11)] : [b.s[9], b.s[10], b.s[11]];
		[view.x, view.y, view.z] = frame.toWorld(local);
	}
	return view;
}

// a dummy's hitbox in the world: [x, y, z, radius, part] for each of DUMMY_SPHERES (sitting: let down on to its seat, its legs out in front)
function dummySpheres(view, fallen, sit = 0) {
	const s = metre(), c = Math.cos(view.heading), sn = Math.sin(view.heading);
	if (fallen > 0.5) return [];		// (on the ground: nothing to hit)
	const down = 0.9 * Math.min(sit, 1);
	return DUMMY_SPHERES.map(([x, y, z, r, part]) => {
		if (part == 'leg' && sit > 0.5) { z += (0.95 - y) * 0.9; y = 0.95 - 0.12; }
		return [view.x + (x * c + z * sn) * s, view.y + (y - down) * s, view.z + (z * c - x * sn) * s, r * s, part];
	});
}
ballistics.addTarget((ax, ay, az, bx, by, bz, bullet) => {
	if (!inGame) return null;
	let best = null;
	for (const other of others.values()) {
		const view = other.view;
		if (!view || !view.hunting || !view.alive) continue;
		if (bullet && (bullet.shooter === other.id || bullet.shooter == 'folk')) continue;	// (nor the townsfolk's, horde.js)
		if (ballistics.crossSphere(ax, ay, az, bx, by, bz, view.x, view.y + 1.0 * metre(), view.z, 1.2 * metre()) === null) continue;
		for (const [x, y, z, r, part] of dummySpheres(view, other.fallen, other.sit)) {
			const t = ballistics.crossSphere(ax, ay, az, bx, by, bz, x, y, z, r);
			if (t !== null && (!best || t < best.t)) best = { t, other, part };
		}
	}
	return best && { t: best.t, what: 'player', hit: (velocity, bullet) => {
		playerStats.hitsReported++;
		best.other.hit = 1;
		showHitMarker(best.part == 'head');
		for (const fn of shotListeners) fn(best.other.id, best.part, bullet?.round ?? '7.62x54R');
	} };
});

// This player
//-------------------------------------------------
const local = { health: HEALTH, alive: true, downAt: 0, by: '', how: '' };
export function localLife() { return { ...local }; }
// in the Horde game mode this player has health alone too (horde.js takes it off)
const horde = () => settings.gameMode == 'Horde';

// the host says how much health this player has now, and who took it (how: what is said when it is down, if not shot by them)
export function setLocalHealth(health, by, how = '') {
	if (health < local.health) hurtFlash = 1;
	local.health = Math.max(health, 0);
	if (health <= 0 && local.alive) {
		local.alive = false;
		local.downAt = performance.now() / 1000;
		local.by = by;
		local.how = how;
		hunting.hunterLife.alive = false;
		playerStats.deaths++;
	}
}

// back to full health (a wave of the horde down, horde.js)
export function healLocal() {
	if (local.alive) local.health = HEALTH;
}
// the hit marker, for a bullet that hit one of the horde
export function markHit(head) { showHitMarker(head); }

// a random spot on the grassland or in the forest, out of the water
function respawnSpot() {
	const land = terrain.land;
	if (!land) return null;
	for (let attempt = 0; attempt < 20; attempt++) {
		const zone = Math.random() < 0.5 ? terrain.ZONE_GRASSLAND : terrain.ZONE_FOREST;
		const spot = land.findSpawnPoints(zone, 1, { seed: Math.floor(Math.random() * 1e6), maxSlope: 0.4 })[0];
		if (spot && land.heightAt(spot.x, spot.z) > settings.waterWorldPosY + 0.5 * metre()) return spot;
	}
	return null;
}
// where to come back, if not somewhere new: fn() gives { x, z } or null (near the others, in the Horde game mode: horde.js)
let respawnPlacer = null;
export function placeRespawn(fn) { respawnPlacer = fn; }
// up again (or into a game for the first time), somewhere new, with full health and a full rifle
export function respawn() {
	const spot = respawnPlacer?.() ?? respawnSpot();
	if (spot) hunting.placeHunter(spot.x, spot.z);
	local.alive = true;
	local.health = HEALTH;
	hunting.hunterLife.alive = true;
	weapons.resetWeapons();
	playerStats.respawns++;
	const place = hunting.hunterPlace();
	for (const fn of respawnListeners) fn([place.x, place.y, place.z]);
}

// What is shown over the picture
//-------------------------------------------------
const overlay = document.createElement('div');
overlay.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: 5; font-family: system-ui, sans-serif; display: none; overflow: hidden;';
const healthBox = document.createElement('div');
healthBox.style.cssText = 'position: absolute; left: 16px; bottom: 16px; width: 200px; padding: 8px 10px; border-radius: 6px; background: rgba(0, 0, 0, 0.55); color: #e8e8e8;';
healthBox.innerHTML = '<div style="display: flex; justify-content: space-between; font-size: 11px; letter-spacing: 0.08em; color: rgba(232, 232, 232, 0.7);"><span>HEALTH</span><span class="hp-number"></span></div>'
	+ '<div style="margin-top: 5px; height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.15); overflow: hidden;"><div class="hp-fill" style="height: 100%; width: 100%; background: #7cc46a;"></div></div>';
const downBox = document.createElement('div');
downBox.style.cssText = 'position: absolute; left: 50%; top: 38%; transform: translate(-50%, -50%); padding: 12px 20px; border-radius: 6px; background: rgba(0, 0, 0, 0.6); color: #fff; text-align: center; display: none;';
const feedBox = document.createElement('div');
feedBox.style.cssText = 'position: absolute; right: 16px; top: 16px; display: flex; flex-direction: column; align-items: flex-end; gap: 4px; font-size: 13px;';
const hurtBox = document.createElement('div');
hurtBox.style.cssText = 'position: absolute; inset: 0; box-shadow: inset 0 0 120px rgba(200, 0, 0, 0.9); opacity: 0;';
const hitMarker = document.createElement('div');
hitMarker.style.cssText = 'position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) rotate(45deg); font-size: 22px; font-weight: 300; color: #fff; text-shadow: 0 0 2px #000; opacity: 0;';
hitMarker.textContent = '+';
overlay.append(hurtBox, healthBox, downBox, feedBox, hitMarker);
document.body.appendChild(overlay);
let hurtFlash = 0, hitFlash = 0;
const feed = [];		// { text, at }

function showHitMarker(head) {
	hitFlash = 1;
	hitMarker.style.color = head ? '#ff5a4a' : '#fff';
}
// a line in the top right: who shot whom
export function addFeed(text) {
	feed.push({ text, at: performance.now() / 1000 });
	if (feed.length > 5) feed.shift();
	feedShown = '';
}
let feedShown = '';

function showOverlay(now, elapsed) {
	const huntingNow = hunting.hunterPlace().active;
	const shown = (inGame || horde()) && huntingNow;
	overlay.style.display = shown ? '' : 'none';
	if (!shown) return;

	healthBox.querySelector('.hp-number').textContent = Math.max(Math.round(local.health), 0);
	const fill = healthBox.querySelector('.hp-fill');
	fill.style.width = clamp(local.health / HEALTH, 0, 1) * 100 + '%';
	fill.style.background = local.health > 50 ? '#7cc46a' : local.health > 25 ? '#e0b44a' : '#e0583e';

	if (!local.alive) {
		downBox.style.display = '';
		const left = Math.max(Math.ceil(RESPAWN_SECONDS - (now - local.downAt)), 0), held = heldBy();
		downBox.innerHTML = `<div style="font-size: 18px; font-weight: 600;">${local.by ? 'Shot by ' + escapeHtml(local.by) : escapeHtml(local.how || 'Down')}</div><div style="margin-top: 4px; font-size: 13px; opacity: 0.8;">${held ? escapeHtml(held) : 'Back in ' + left}</div>`;
	} else {
		downBox.style.display = 'none';
	}

	while (feed.length && now - feed[0].at > FEED_SECONDS) { feed.shift(); feedShown = ''; }
	const key = feed.map((line) => line.text).join('|');
	if (key != feedShown) {
		feedShown = key;
		feedBox.innerHTML = feed.map((line) => `<div style="padding: 3px 8px; border-radius: 3px; background: rgba(0, 0, 0, 0.5); color: #eee;">${escapeHtml(line.text)}</div>`).join('');
	}

	hurtFlash = Math.max(hurtFlash - elapsed * 1.5, 0);
	hurtBox.style.opacity = hurtFlash * 0.8;
	hitFlash = Math.max(hitFlash - elapsed * 4, 0);
	hitMarker.style.opacity = hitFlash;

	// the others' names, over their heads, within NAME_DISTANCE
	const viewProj = transformations.getViewProj();
	const rect = overlay.getBoundingClientRect();
	for (const other of others.values()) {
		const view = other.view;
		let shown = false;
		if (view && view.hunting && Math.hypot(view.x - settings.camPosX, view.z - settings.camPosZ) < NAME_DISTANCE * metre()) {
			const p = [view.x, view.y + (view.alive ? 2.05 - 0.9 * Math.min(other.sit, 1) : 0.6) * metre(), view.z, 1];
			const c = [0, 1, 2, 3].map((r) => viewProj[r] * p[0] + viewProj[4 + r] * p[1] + viewProj[8 + r] * p[2] + viewProj[12 + r] * p[3]);
			if (c[3] > 0.1) {
				const x = (c[0] / c[3] * 0.5 + 0.5) * rect.width, y = (0.5 - c[1] / c[3] * 0.5) * rect.height;
				if (x > -50 && x < rect.width + 50 && y > -20 && y < rect.height + 20) {
					other.tag.style.left = x + 'px';
					other.tag.style.top = y + 'px';
					other.tag.style.borderBottom = `2px solid hsl(${Math.round(other.hue * 360)}, 70%, 55%)`;
					shown = true;
				}
			}
		}
		other.tag.style.display = shown ? '' : 'none';
	}
}
function escapeHtml(text) {
	return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Per frame
//-------------------------------------------------
let lastTime = performance.now();
export function playersUpdate() {
	const nowMs = performance.now();
	const elapsed = Math.min((nowMs - lastTime) / 1000, 0.1);
	lastTime = nowMs;
	const now = nowMs / 1000;

	for (const other of others.values()) {
		const view = viewOf(other, now);
		if (view && other.view) {
			const went = Math.hypot(view.x - other.view.x, view.z - other.view.z) / metre();
			other.stride += went / STRIDE * Math.PI;
		}
		other.view = view;
		other.walking += (clamp((view?.speed ?? 0) / 1.5, 0, 1) - other.walking) * Math.min(elapsed * 6, 1);
		other.fallen = clamp(other.fallen + (view && !view.alive ? 1 : -1) * elapsed / 0.6, 0, 1);
		other.hit = Math.max(other.hit - elapsed * 3, 0);
		other.sit += ((view?.sit ?? 0) - other.sit) * Math.min(elapsed * 6, 1);
	}
	playerStats.others = others.size;

	// down: up again after RESPAWN_SECONDS
	if ((inGame || horde()) && !local.alive && now - local.downAt >= RESPAWN_SECONDS && !heldBy()) respawn();
	showOverlay(now, elapsed);
}

// The others drawn, with the solid things
export function playersPass(aEncoder, mainpassDepthTexture) {
	if (!inGame || others.size == 0) return;
	let count = 0;
	for (const other of others.values()) {
		const view = other.view;
		if (!view || !view.hunting || count >= MAX_DRAWN) continue;
		const fall = other.fallen * other.fallen * (3 - 2 * other.fallen);
		instanceData.set([view.x, view.y, view.z, metre(), view.heading, view.pitch, other.stride, other.walking * (1 - fall) * (other.sit > 0.5 ? 0 : 1), fall, other.hit, other.hue, other.sit,
			HELD_LENGTH[view.holds] ?? 0, 0, 0, 0], count * DUMMY_FLOATS);
		count++;
	}
	playerStats.drawn = count;
	if (count == 0) return;
	device.queue.writeBuffer(instanceBuffer, 0, instanceData, 0, count * DUMMY_FLOATS);

	const bufferResult = [...transformations.getViewProj()];
	bufferResult.push(settings.camPosX, settings.camPosY, settings.camPosZ, 0);
	bufferResult.push(settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, 0, 0);
	const result = new Float32Array(bufferResult);
	device.queue.writeBuffer(dummyUniformBuffer, 0, result.buffer, result.byteOffset, result.byteLength);

	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Players', 'vf_dummy'),
	});
	pass.setPipeline(dummyPipeline);
	pass.setBindGroup(0, device.createBindGroup({
		label: "dummy bind group",
		layout: dummyPipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: dummyUniformBuffer } },
			{ binding: 1, resource: { buffer: uniformBufferLights } },
			{ binding: 2, resource: skyViewLUTtexture.createView() },
			{ binding: 3, resource: linSampler },
		],
	}));
	pass.setVertexBuffer(0, meshBuffer);
	pass.setVertexBuffer(1, instanceBuffer);
	pass.draw(DUMMY_VERTICES, count, 0, 0);
	pass.end();
}
