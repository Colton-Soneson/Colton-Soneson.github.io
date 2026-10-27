import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_trail } from '../shaders/js/vf_trail.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as forest from './forest.js'
import * as boulders from './boulders.js'

/*
	The rifle's bullets (rifle.js fires them): where they go, what they hit, and the wisp of a trail each leaves behind it.

	THE ROUNDS (ROUNDS): each gun's: how fast it leaves the barrel, how hard the air slows it, and how much harm it does (a share of
	DAMAGE in net.js). The 7.62x54mmR of the Mosin-Nagant, a pellet of the shotgun's 00 buckshot (nine to a shell, slowed fast: a
	round ball is a poor shape to fly), the .45 Colt of the revolver (slow and heavy), the .45-70 of the Sharps (heavy, and
	slower than the Mosin's, so it drops a long way at range: see the reticle in sharps.js), and the little 7.63 Mauser of the
	broomhandle pistol (mauser.js: quick for a pistol round, and light), and the .303 British of the Lewis gun (lewis.js) and the
	biplane's guns (plane.js). Two things act on one in flight:
		gravity		9.81 metres a second, a second, down
		the air		drag, slowing it by its drag times the square of its speed: dv/dt = -drag * v^2. That is the same as losing
					the same share of its speed for every metre it goes, so at 400 metres the Mosin's has lost about 30% (820 down to
					about 570 metres a second, near enough what the real round does)
	It is moved on in steps of STEP_SECONDS (a little over 3 metres at the muzzle), each step a straight line, and that line is
	tested against everything it could hit. The nearest thing it crosses stops it:
		the ground		read along the line every metre or so (land.heightAt)
		the water		its surface, where the ground under it is lower: flat, but round a boat as high as the waves it rides are there
					(setSeaHeight: boat.js), or a hull down in a trough would be under the flat sea and could not be hit
		tree trunks		upright cylinders (forest.trunksNear), only the ones round the line
		boulders		boxes (boulders.bouldersNear), the same as the walker bumps into
		anything else	that has asked to be shot at (addTarget: the animals, the other players)
	A bullet that has hit nothing after MAX_SECONDS, or gone below the world, is dropped.
	In a game with others (net.js) their shots are flown here too (remote), for their trails: they stop at what they hit,
	but do nothing to it. What they hit is theirs to say. The shots fired here are passed on (onLocalFire).

	THE TRAIL: a point is left every TRAIL_SPACING along the flight, for the first TRAIL_SECONDS of it. Each piece between two
	points is drawn as a soft strip turned to face the eye (vf_trail.js), which widens, drifts up a little and fades away
	over TRAIL_FADE seconds: the disturbed air a round leaves, made visible.
*/
// velocity: metres a second at the muzzle, drag: per metre (see THE ROUNDS), damage: of DAMAGE (net.js)
export const ROUNDS = {
	'7.62x54R': { velocity: 820, drag: 0.0009, damage: 1.0 },
	'00 buck': { velocity: 400, drag: 0.0055, damage: 0.24 },
	'.45 Colt': { velocity: 270, drag: 0.0025, damage: 0.65 },
	'.45-70': { velocity: 400, drag: 0.0011, damage: 1.35 },
	'7.63 Mauser': { velocity: 430, drag: 0.0024, damage: 0.55 },
	'.303 British': { velocity: 745, drag: 0.0009, damage: 0.9 },
	// the biplane's Vickers (plane.js): the same round, falling less on its way (gravity, of the rest's)
	'.303 Vickers': { velocity: 745, drag: 0.0009, damage: 0.9, gravity: 0.6 },
	// the schooner's howitzers' shell (shipGuns.js): slow and heavy, lobbed; it bursts where it stops (onBurst), and flies as long as life
	'80mm': { velocity: 135, drag: 0.00015, damage: 1, burst: true, life: 40 },
	// a biplane's bomb (plane.js): no gun, so carried: it leaves as fast as it is let go (the length of its direction, world units a
	//		second), and bursts as the shell does
	'bomb': { velocity: 0, drag: 0.0001, damage: 1, burst: true, life: 60, carried: true },
};
const GRAVITY = 9.81;
const STEP_SECONDS = 1 / 240;
// an NPC's round (not a shell or a bomb): each step tested against everything along its whole length, so a longer step misses nothing; the
//		ground sampled NPC_SAMPLE metres apart (instead of 1.2), and gone after NPC_LIFE seconds (far out of reach of anything by then)
const NPC_STEP = 1 / 60, NPC_SAMPLE = 2.5, NPC_LIFE = 2.5;
const MAX_SECONDS = 4;
const TRAIL_SPACING = 3;			// metres
const TRAIL_SECONDS = 1.4;
export const TRAIL_FADE = 1.8;
const MAX_TRAIL = 2048;				// pieces of trail at once
const TRAIL_FLOATS = 8;				// one piece: from (xyz, when it was left), to (xyz, when)

export const ballisticStats = { fired: 0, flying: 0, hits: {} , lastHit: null };	// for anyone who wants to show it

const bullets = [];
const targets = [];			// see addTarget
const fireListeners = [];	// see onLocalFire

/*
	Something else that can be hit. test(ax, ay, az, bx, by, bz, bullet) is asked about each step of a bullet's flight: the straight line
	from a to b. It answers null, or { t, hit } for the first thing on that line it is hit by: t from 0 at a to 1 at b, and hit(
	velocity) what to do about it (called if it is the nearest thing the line crosses; for someone else's round too if it says remoteToo).
	The animals add themselves
*/
export function addTarget(test) {
	targets.push(test);
}

// the sea's height somewhere: fn(x, z) world units, or null where it is flat (boat.js)
let seaHeight = null;
export function setSeaHeight(fn) { seaHeight = fn; }

// told where a round that bursts (a shell) stops, fired here or by someone else: fn(at (world units), bullet, what it hit)
const burstListeners = [];
export function onBurst(fn) { burstListeners.push(fn); }

// told of every shot fired here (not the ones that are someone else's): fn(from, directions (one, or a shell's pellets), round)
export function onLocalFire(fn) {
	fireListeners.push(fn);
}
// told of every shot at all, here or someone else's or a townsperson's, once for a shell's pellets: fn(from, round, { remote, shooter })
//		(sound.js: its report)
const shotListeners = [];
export function onAnyShot(fn) {
	shotListeners.push(fn);
}

// Fires a round: from (world units) along a direction (any length), at its muzzle velocity. remote: someone else's (net.js),
//		flown for its trail only. shooter: who fired it, so it does not hit them. round: which (ROUNDS). npc: one of npcs.js's people fired it
//		(shooter is its id): it says what it hits of the players
export function fire(from, direction, { remote = false, shooter = null, round = '7.62x54R', quiet = false, volley = false, npc = false } = {}) {
	const metre = settings.forestUnitsPerMetre;
	const R = ROUNDS[round] ?? ROUNDS['7.62x54R'];
	const length = Math.hypot(...direction);
	const speed = R.carried ? length : R.velocity * metre;
	bullets.push({
		x: from[0], y: from[1], z: from[2],
		vx: direction[0] / length * speed, vy: direction[1] / length * speed, vz: direction[2] / length * speed,
		age: 0, trailFrom: [from[0], from[1], from[2]], trailAge: seconds, gone: false, remote, shooter, npc, round, drag: R.drag, gravity: R.gravity ?? 1, burst: !!R.burst, trail: !R.carried, life: npc && !R.burst ? Math.min(R.life ?? MAX_SECONDS, NPC_LIFE) : R.life ?? MAX_SECONDS,
	});
	ballisticStats.fired++;
	if (!remote && !quiet) for (const fn of fireListeners) fn([...from], [[...direction]], round);
	if (!volley) for (const fn of shotListeners) fn(from, round, { remote, shooter });
}
// the rounds of a kind in the air now: [{ at (world units), v (world units a second) }] (plane.js draws its bombs falling)
export function flyingOf(round) {
	return bullets.filter((b) => b.round == round && !b.gone).map((b) => ({ at: [b.x, b.y, b.z], v: [b.vx, b.vy, b.vz] }));
}
// told of every step of every round in the air that is not an NPC's (npcs.js: a near miss): fn(ax, ay, az, bx, by, bz, bullet), the line it
//		went along (world units)
const passListeners = [];
export function onPass(fn) { passListeners.push(fn); }
// how far off the NPCs aim (npcs.js, and the townsfolk's, horde.js), times their own spread: settings.aiDifficulty 0 three times as far,
//		0.5 as they are, 1 a third as far
export const aimSpread = () => Math.pow(3, 1 - 2 * Math.min(Math.max(settings.aiDifficulty ?? 0.5, 0), 1));
// several at once from the same place (a shotgun's pellets): told as one shot
export function fireVolley(from, directions, { round = '7.62x54R' } = {}) {
	for (const direction of directions) fire(from, direction, { round, quiet: true, volley: true });
	for (const fn of fireListeners) fn([...from], directions.map((d) => [...d]), round);
	for (const fn of shotListeners) fn(from, round, { remote: false, shooter: null });
}

// The trail
//-------------------------------------------------
const trailData = new Float32Array(MAX_TRAIL * TRAIL_FLOATS);
let trailNext = 0, trailCount = 0;
let seconds = 0;		// the clock the trail's ages are kept by
function leaveTrail(a, b) {
	trailData.set([a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]], trailNext * TRAIL_FLOATS);
	trailNext = (trailNext + 1) % MAX_TRAIL;
	trailCount = Math.min(trailCount + 1, MAX_TRAIL);
}

// What a step crosses
//-------------------------------------------------
// where along the line from a to b (0 to 1) it first goes into an upright cylinder, or null
function crossCylinder(ax, ay, az, bx, by, bz, cx, cz, radius, bottom, top) {
	const dx = bx - ax, dz = bz - az, fx = ax - cx, fz = az - cz;
	const a = dx * dx + dz * dz, b = 2 * (fx * dx + fz * dz), c = fx * fx + fz * fz - radius * radius;
	if (a < 1e-9) return null;
	const disc = b * b - 4 * a * c;
	if (disc < 0) return null;
	const t = (-b - Math.sqrt(disc)) / (2 * a);
	if (t < 0 || t > 1) return null;
	const y = ay + (by - ay) * t;
	return y >= bottom && y <= top ? t : null;
}
// where along the line from a to b it first goes into a box (slabs), or null
function crossBox(ax, ay, az, bx, by, bz, min, max) {
	let near = 0, far = 1;
	const from = [ax, ay, az], step = [bx - ax, by - ay, bz - az];
	for (let k = 0; k < 3; k++) {
		if (Math.abs(step[k]) < 1e-9) {
			if (from[k] < min[k] || from[k] > max[k]) return null;
			continue;
		}
		let t0 = (min[k] - from[k]) / step[k], t1 = (max[k] - from[k]) / step[k];
		if (t0 > t1) [t0, t1] = [t1, t0];
		near = Math.max(near, t0); far = Math.min(far, t1);
		if (near > far) return null;
	}
	return near;
}

// the nearest thing the line from a to b crosses: { t, what, hit } or null
function firstHit(ax, ay, az, bx, by, bz, bullet) {
	const land = terrain.land;
	const metre = settings.forestUnitsPerMetre;
	let best = null;
	const take = (t, what, hit = null, remoteToo = false) => { if (t !== null && t >= 0 && t <= 1 && (!best || t < best.t)) best = { t, what, hit, remoteToo }; };

	// the ground and the water, read along the line
	const length = Math.hypot(bx - ax, by - ay, bz - az);
	const samples = Math.max(Math.ceil(length / ((bullet?.npc && !bullet.burst ? NPC_SAMPLE : 1.2) * metre)), 1);
	const flat = settings.waterWorldPosY;
	const seaAt = (x, z) => seaHeight?.(x, z) ?? flat;
	let lastAbove = ay - Math.max(land.heightAt(ax, az), seaAt(ax, az));
	for (let k = 1; k <= samples; k++) {
		const t = k / samples, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
		const ground = land.heightAt(x, z), water = seaAt(x, z);
		const above = y - Math.max(ground, water);
		if (above <= 0) {
			const at = (k - 1 + lastAbove / Math.max(lastAbove - above, 1e-6)) / samples;	// (where between the two samples it went under)
			take(Math.min(Math.max(at, 0), 1), ground >= water ? 'ground' : 'water');
			break;
		}
		lastAbove = above;
	}

	// trunks and boulders round the line
	const mx = (ax + bx) / 2, mz = (az + bz) / 2, reach = length / 2 + 2 * metre;
	if (settings.enableForest) {
		// (trunksNear gives the trunk up to half the tree's height, as high as a walker can bump into: a bullet can hit all of it)
		forest.trunksNear(mx, mz, reach, (x, z, radius, bottom, top) => take(crossCylinder(ax, ay, az, bx, by, bz, x, z, radius, bottom, top + (top - bottom)), 'trunk'));
	}
	if (settings.enableBoulders) {
		boulders.bouldersNear(mx, mz, reach, (x, z, half, bottom, top) => take(crossBox(ax, ay, az, bx, by, bz, [x - half, bottom, z - half], [x + half, top, z + half]), 'boulder'));
	}
	// and anything else that can be shot
	for (const test of targets) {
		const found = test(ax, ay, az, bx, by, bz, bullet);
		if (found) take(found.t, found.what ?? 'target', found.hit, found.remoteToo);
	}
	return best;
}

// Per frame
//-------------------------------------------------
let lastTime = performance.now();
export function bulletUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	moveBullets(elapsed);
}

// for testing: the bullets moved on by a number of seconds
export function simulateBullets(total) {
	for (let done = 0; done < total; done += 1 / 60) moveBullets(1 / 60);
}

function moveBullets(elapsed) {
	seconds += elapsed;
	if (!terrain.land) return;
	const metre = settings.forestUnitsPerMetre;
	const trailStep = TRAIL_SPACING * metre;
	for (const bullet of bullets) {
		let left = elapsed;
		while (left > 1e-6 && !bullet.gone) {
			const dt = Math.min(left, bullet.npc && !bullet.burst ? NPC_STEP : STEP_SECONDS);
			left -= dt;
			// the air slows it, gravity pulls it down (in metres, then back to world units)
			const speed = Math.hypot(bullet.vx, bullet.vy, bullet.vz) / metre;
			const slow = Math.max(1 - bullet.drag * speed * dt, 0);
			bullet.vx *= slow; bullet.vz *= slow;
			bullet.vy = bullet.vy * slow - GRAVITY * bullet.gravity * metre * dt;
			const bx = bullet.x + bullet.vx * dt, by = bullet.y + bullet.vy * dt, bz = bullet.z + bullet.vz * dt;

			const hit = firstHit(bullet.x, bullet.y, bullet.z, bx, by, bz, bullet);
			const t = hit ? hit.t : 1;
			const ex = bullet.x + (bx - bullet.x) * t, ey = bullet.y + (by - bullet.y) * t, ez = bullet.z + (bz - bullet.z) * t;
			bullet.age += dt * t;

			// the trail, up to here
			const lastPoint = bullet.trailFrom;
			if (bullet.trail && bullet.age < TRAIL_SECONDS && (hit || Math.hypot(ex - lastPoint[0], ey - lastPoint[1], ez - lastPoint[2]) >= trailStep)) {
				leaveTrail([lastPoint[0], lastPoint[1], lastPoint[2], bullet.trailAge], [ex, ey, ez, seconds - left]);
				bullet.trailFrom = [ex, ey, ez];
				bullet.trailAge = seconds - left;
			}

			if (!bullet.npc && passListeners.length) for (const fn of passListeners) fn(bullet.x, bullet.y, bullet.z, ex, ey, ez, bullet);
			bullet.x = ex; bullet.y = ey; bullet.z = ez;
			if (hit) {
				bullet.gone = true;
				ballisticStats.hits[hit.what] = (ballisticStats.hits[hit.what] ?? 0) + 1;
				ballisticStats.lastHit = { what: hit.what, x: ex, y: ey, z: ez, metres: null, seconds: bullet.age, speed: Math.hypot(bullet.vx, bullet.vy, bullet.vz) / metre };
				if (hit.hit && (!bullet.remote || hit.remoteToo)) hit.hit([bullet.vx, bullet.vy, bullet.vz], bullet);
				if (bullet.burst) for (const fn of burstListeners) fn([ex, ey, ez], bullet, hit.what);
			} else if (bullet.age > bullet.life || bullet.y < settings.waterWorldPosY - 500) {
				bullet.gone = true;
			}
		}
	}
	for (let i = bullets.length - 1; i >= 0; i--) if (bullets[i].gone) bullets.splice(i, 1);
	ballisticStats.flying = bullets.length;
}

// Drawing the trails
//-------------------------------------------------
const trailShaderModule = device.createShaderModule({ label: "vf_trail", code: vf_trail });
const trailBuffer = device.createBuffer({ label: "bullet trails", size: trailData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
const trailUniformBuffer = device.createBuffer({ label: "bullet trail Uniform", size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const trailPipeline = device.createRenderPipeline({
	label: "bullet trail pipeline",
	layout: 'auto',
	vertex: {
		module: trailShaderModule,
		entryPoint: "vertexMain",
		buffers: [{
			arrayStride: TRAIL_FLOATS * 4,
			stepMode: 'instance',
			attributes: [
				{ format: "float32x4", offset: 0, shaderLocation: 0 },
				{ format: "float32x4", offset: 16, shaderLocation: 1 },
			],
		}],
	},
	fragment: {
		module: trailShaderModule,
		entryPoint: "fragmentMain",
		targets: [{
			format: canvasFormat,
			blend: {
				color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
				alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
			},
		}],
	},
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: false, depthCompare: 'less', format: 'depth24plus' },
});
let trailBindGroup = null;

// over the finished frame, behind whatever is in front of them
export function trailPass(mainpassDepthTexture) {
	if (trailCount == 0) return;
	// (pieces older than the fade are drawn as nothing: the shader fades them out. Once all are, nothing is drawn at all)
	let newest = -Infinity;
	for (let i = 0; i < trailCount; i++) newest = Math.max(newest, trailData[i * TRAIL_FLOATS + 7]);
	if (seconds - newest > TRAIL_FADE) return;

	device.queue.writeBuffer(trailBuffer, 0, trailData, 0, trailCount * TRAIL_FLOATS);
	const uniforms = new Float32Array(28);
	uniforms.set(transformations.getViewProj(), 0);
	uniforms.set([settings.camPosX, settings.camPosY, settings.camPosZ, seconds], 16);
	uniforms.set([TRAIL_FADE, settings.forestUnitsPerMetre, 0, 0], 20);
	const daylight = Math.min(Math.max((settings.sunPosY / (Math.hypot(settings.sunPosX, settings.sunPosY, settings.sunPosZ) || 1) + 0.08) / 0.33, 0), 1);
	uniforms.set([0.25 + 0.65 * daylight, 0, 0, 0], 24);
	device.queue.writeBuffer(trailUniformBuffer, 0, uniforms);
	trailBindGroup ??= device.createBindGroup({ label: "bullet trail bind group", layout: trailPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: trailUniformBuffer } }] });

	const encoder = device.createCommandEncoder({ label: "bullet trails" });
	const pass = encoder.beginRenderPass({
		colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Bullet Trails', 'vf_trail'),
	});
	pass.setPipeline(trailPipeline);
	pass.setBindGroup(0, trailBindGroup);
	pass.setVertexBuffer(0, trailBuffer);
	pass.draw(6, trailCount, 0, 0);
	pass.end();
	device.queue.submit([encoder.finish()]);
}

/*
	For the animals' hitboxes: where along the line from a to b (0 to 1) it goes into a ball at c of the given radius, or null.
	(0 if a is already inside it)
*/
export function crossSphere(ax, ay, az, bx, by, bz, cx, cy, cz, radius) {
	const dx = bx - ax, dy = by - ay, dz = bz - az, fx = ax - cx, fy = ay - cy, fz = az - cz;
	const a = dx * dx + dy * dy + dz * dz, b = 2 * (fx * dx + fy * dy + fz * dz), c = fx * fx + fy * fy + fz * fz - radius * radius;
	if (c <= 0) return 0;
	if (a < 1e-12) return null;
	const disc = b * b - 4 * a * c;
	if (disc < 0) return null;
	const t = (-b - Math.sqrt(disc)) / (2 * a);
	return t >= 0 && t <= 1 ? t : null;
}

/*
	The nearest of a set of animals' hitboxes the line from a to b goes into: { t, animal } or null. animals: a list of anything,
	spheresOf(animal) its hitbox as balls [[x, y, z, radius], ...] in world units (at most 8), and around(animal) one ball
	round all of them, to pass over the ones nowhere near the line without working out their balls
*/
export function crossAnimals(ax, ay, az, bx, by, bz, animals, spheresOf, around) {
	let best = null;
	for (const animal of animals) {
		const [x, y, z, r] = around(animal);
		if (crossSphere(ax, ay, az, bx, by, bz, x, y, z, r) === null) continue;
		for (const [sx, sy, sz, sr] of spheresOf(animal)) {
			const t = crossSphere(ax, ay, az, bx, by, bz, sx, sy, sz, sr);
			if (t !== null && (!best || t < best.t)) best = { t, animal };
		}
	}
	return best;
}
