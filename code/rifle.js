import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import {onRenderResize} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { vf_rifle } from '../shaders/js/vf_rifle.js'

import * as transformations from './transformations.js'
import { lightNow } from './lighting.js'
import * as hunting from './hunting.js'
import * as ballistics from './ballistics.js'

/*
	The hunter's rifle, in the Hunting game mode only: a Mosin-Nagant 91/30, the Soviet bolt action of the Second World War.
		left click			fire (after the trigger's pull, TRIGGER_SECONDS)
		right click (held)	aim down the sights
		middle click		turn the bolt up (open it), or down again (close it): it only closes when it is all the way forward
		mouse wheel			with the bolt open, down (towards you) draws it back and up pushes it forward. BOLT_STROKE_PIXELS
							of scrolling is the whole way: two notches of an ordinary wheel
		R					with the bolt all the way back, push a round down into the magazine: one round a press
	THE BOLT is worked by hand. After a shot: open it, draw it all the way back (the empty case comes out on the bolt's face
	and is thrown clear), push it all the way forward (it strips the top round off the magazine into the chamber), and close
	it. Only then will it fire again. Drawn back part of the way and pushed forward again, nothing happens. Drawing it all the
	way back throws out whatever is in the chamber, a live round as well as an empty case. With nothing in the chamber the
	trigger only clicks. TO LOAD: open the bolt, draw it all the way back, press R for each round (up to MAGAZINE), push it
	forward and close it. The rifle starts with MAGAZINE - 1 in the magazine and one in the chamber, the way a clip of 5
	leaves it. There is no end to the ammunition. The ammunition is shown in the bottom right, with the next thing to do.

	THE RIFLE (RIFLE_MESH): 247 triangles, in metres, the muzzle along +z, the bore along the z axis:
		the stock			the butt and the wrist (18) and the forend under the barrel (10), wood
		the receiver		with the magazine under it, open on top over the ejection port (PORT) (12), steel
		the barrel			a four sided taper (8)
		the sights			the rear sight's notch (6) and the hooded post of the front sight (8), their tops SIGHT_HEIGHT over
							the bore: the line between them is the line of sight
		the bolt			its body in the receiver (8), the cocking piece at the back (7), and the handle out to the right
							with its knob (6): part 1
		the trigger			and its guard (4): part 2
		4 rounds			each a brass case (28) and a copper bullet (12): parts 3 to 6 (see THE ROUNDS)
	vf_rifle.js draws it, and moves the bolt, the trigger and the rounds.

	THE ROUNDS that can be seen, each placed (in the rifle's space) by a vec4 of the uniforms, w: 0 not there, 1 an empty case,
	2 a round:
		A, part 3			on the bolt's face: the one in the chamber, pulled out as the bolt comes back, or the top one off
							the magazine, pushed forward into the chamber
		B, part 4			in the hunter's thumb, pushed down into the magazine (R)
		C, part 5			thrown out of the action, turning over (spin)
		D, part 6			on top of the magazine, under the open action (MAG_REAR, MAG_Y)

	WHERE IT IS HELD, in the camera's space: at the hip (HIP, a little to the right and down), or with the sights in front of
	the eye (AIM: the line of sight along the middle of the view, the rear sight 45 cm in front of the eye, the stock at the cheek), and anywhere
	between while it comes up or goes down (aimed, 0 to 1). On top of that: the recoil (back into the shoulder and the
	muzzle up), its sway as the hunter walks, canted a little while the bolt is open, and rolled over to show the open action
	while rounds are pushed in (it cannot be aimed then).

	THE SHOT comes out of the muzzle (ballistics.js flies it). Aimed, along the line of sight, tipped up by the little it
	takes for the round to come up through the line of sight and fall back to it at ZERO metres: the sights are set for
	100 metres, so further off it hits low. From the hip, at the middle of the view ZERO metres off, give or take HIP_SPREAD.
*/
const SIGHT_HEIGHT = 0.034;			// metres over the bore
const ZERO = 100;					// metres the sights are set for
const MUZZLE = 0.76;				// metres from the receiver to the muzzle (z)
const HIP_SPREAD = 0.012;			// radians either way, from the hip
const TRIGGER_SECONDS = 0.12;
const RECOIL_SECONDS = 0.18;		// after the shot, before the bolt can be opened
const MAGAZINE = 5;					// rounds the magazine holds
const AIM_SECONDS = 0.2;			// to bring it up to the eye, or down again
const BOLT_TURN = 1.35;				// radians the handle turns up
const BOLT_TRAVEL = 0.1;			// metres it draws back
const BOLT_TURN_SECONDS = 0.14;		// to turn it up, or down
const BOLT_DRAW_SECONDS = 0.12;		// at the quickest, for the whole way back or forward (it follows the wheel)
const BOLT_STROKE_PIXELS = 200;		// of the wheel's scrolling, for the whole way (an ordinary wheel's notch is 100)
const LOAD_SECONDS = 0.38;			// to push a round down into the magazine
const SHOW_SECONDS = 0.3;			// to roll it over to show the open action, or back
const SHOW_HOLD = 0.9;				// seconds it stays rolled over after the last round went in
const EJECT_SECONDS = 0.8;			// the thrown out round or case is seen for
const MESSAGE_SECONDS = 1.6;

// the ejection port, and the rounds: z along the rifle, from the front of the receiver
const PORT = [-0.115, 0.0];			// the open top of the receiver, back and front
const ROUND_LENGTH = 0.077;			// 7.62x54R, base to point
const MAG_REAR = -0.095;			// the base of the top round on the magazine
const MAG_Y = -0.015;				// its middle, under the bolt
const ROUND_STACK = 0.013;			// a round's width: how far the top one goes down as another is pushed in over it

// where it is held: x, y, z of the rifle's origin (the front of the receiver, on the bore) in the camera's space, and the turn of it
const HIP = { x: 0.15, y: -0.155, z: -0.4, yaw: 0.045, pitch: 0.012 };
const AIM = { x: 0, y: -SIGHT_HEIGHT, z: -0.33, yaw: 0, pitch: 0 };

// The rifle
//-------------------------------------------------
const WOOD = 0, STEEL = 1, BRASS = 2, COPPER = 3;
const RIFLE_MESH = (() => {
	const tris = [];
	const code = (part, material) => part + 10 * material;
	const tri = (a, b, c, part, material) => tris.push([a, b, c, code(part, material)]);
	const quad = (a, b, c, d, part, material) => { tri(a, b, c, part, material); tri(a, c, d, part, material); };
	// a box between two rectangles across the rifle: [x half width, y bottom, y top] at z0 and z1. caps: which ends are closed. skip: sides left open (0 bottom, 1 right, 2 top, 3 left)
	const section = (z0, r0, z1, r1, material, caps, part = 0, skip = []) => {
		const ring = (z, [h, b, t]) => [[-h, b, z], [h, b, z], [h, t, z], [-h, t, z]];
		const A = ring(z0, r0), B = ring(z1, r1);
		for (let k = 0; k < 4; k++) if (!skip.includes(k)) quad(A[k], A[(k + 1) % 4], B[(k + 1) % 4], B[k], part, material);
		if (caps.includes(0)) quad(A[0], A[1], A[2], A[3], part, material);
		if (caps.includes(1)) quad(B[0], B[1], B[2], B[3], part, material);
	};
	// a tube along z with any number of sides
	const tube = (x, y, z0, r0, z1, r1, sides, material, part = 0, capBack = false) => {
		const ring = (z, r) => Array.from({ length: sides }, (_, k) => { const a = (k + 0.5) / sides * Math.PI * 2; return [x + Math.cos(a) * r, y + Math.sin(a) * r, z]; });
		const A = ring(z0, r0), B = ring(z1, r1);
		for (let k = 0; k < sides; k++) quad(A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k], part, material);
		if (capBack) for (let k = 1; k < sides - 1; k++) tri(A[0], A[k], A[k + 1], part, material);
	};
	// a round, 7.62x54R, its base at the origin and its point along +z: the case, closed at the base (28), and the bullet (12)
	const cartridge = (part) => {
		tube(0, 0, 0, 0.0068, 0.052, 0.0062, 6, BRASS, part, true);
		tube(0, 0, 0.052, 0.0062, 0.058, 0.0043, 6, BRASS, part);
		tube(0, 0, 0.058, 0.0043, ROUND_LENGTH, 0.0008, 6, COPPER, part);
	};
	const H = SIGHT_HEIGHT;

	// the stock: from the receiver back along the wrist, dropping, to the butt plate (18)
	section(-0.15, [0.02, -0.04, -0.004], -0.27, [0.019, -0.065, -0.03], WOOD, []);
	section(-0.27, [0.019, -0.065, -0.03], -0.52, [0.022, -0.14, -0.035], WOOD, [1]);
	// the forend under the barrel, to the front band (10)
	section(0.05, [0.022, -0.04, 0.008], 0.62, [0.019, -0.033, 0.006], WOOD, [1]);
	// the receiver, with the magazine below it, its top open over the ejection port (12)
	section(-0.15, [0.018, -0.07, 0.014], 0.05, [0.018, -0.07, 0.014], STEEL, [0], 0, [2]);
	const top = (z0, z1) => quad([-0.018, 0.014, z0], [0.018, 0.014, z0], [0.018, 0.014, z1], [-0.018, 0.014, z1], 0, STEEL);
	top(-0.15, PORT[0]);
	top(PORT[1], 0.05);
	// the barrel (8)
	tube(0, 0, 0.05, 0.016, MUZZLE, 0.011, 4, STEEL);
	// the rear sight: a plate across the barrel at z 0.12 with a notch in the top (6)
	const zr = 0.12;
	quad([-0.012, 0.016, zr], [0.012, 0.016, zr], [0.012, H, zr], [-0.012, H, zr], 0, STEEL);
	quad([-0.012, H, zr], [-0.0025, H, zr], [-0.0025, H + 0.007, zr], [-0.012, H + 0.007, zr], 0, STEEL);
	quad([0.0025, H, zr], [0.012, H, zr], [0.012, H + 0.007, zr], [0.0025, H + 0.007, zr], 0, STEEL);
	// the front sight: a post, its top on the line of sight, in a ring of a hood (8)
	const zf = 0.735;
	quad([-0.0018, 0.01, zf], [0.0018, 0.01, zf], [0.0018, H, zf], [-0.0018, H, zf], 0, STEEL);
	quad([-0.009, 0.01, zf - 0.012], [-0.009, 0.01, zf + 0.012], [-0.009, H + 0.008, zf + 0.012], [-0.009, H + 0.008, zf - 0.012], 0, STEEL);
	quad([0.009, 0.01, zf - 0.012], [0.009, 0.01, zf + 0.012], [0.009, H + 0.008, zf + 0.012], [0.009, H + 0.008, zf - 0.012], 0, STEEL);
	quad([-0.009, H + 0.008, zf - 0.012], [0.009, H + 0.008, zf - 0.012], [0.009, H + 0.008, zf + 0.012], [-0.009, H + 0.008, zf + 0.012], 0, STEEL);
	// the bolt: its body in the receiver, up to the chamber at z 0 (8), the cocking piece sticking out of the back of the receiver (7), the handle out to the right and down, and its knob (6)
	tube(0, 0.002, -0.15, 0.0095, 0, 0.0095, 4, STEEL, 1);
	tube(0, 0.002, -0.19, 0.011, -0.15, 0.011, 3, STEEL, 1, true);
	quad([0.012, 0.004, -0.115], [0.012, -0.004, -0.125], [0.062, -0.034, -0.135], [0.062, -0.026, -0.125], 1, STEEL);
	const knob = [0.066, -0.032, -0.13];
	tri([knob[0] - 0.01, knob[1] + 0.01, knob[2]], [knob[0] + 0.01, knob[1] - 0.004, knob[2] - 0.009], [knob[0] + 0.01, knob[1] - 0.004, knob[2] + 0.009], 1, STEEL);
	tri([knob[0] - 0.01, knob[1] + 0.01, knob[2]], [knob[0] + 0.01, knob[1] - 0.004, knob[2] + 0.009], [knob[0], knob[1] - 0.014, knob[2]], 1, STEEL);
	tri([knob[0] - 0.01, knob[1] + 0.01, knob[2]], [knob[0], knob[1] - 0.014, knob[2]], [knob[0] + 0.01, knob[1] - 0.004, knob[2] - 0.009], 1, STEEL);
	tri([knob[0] + 0.01, knob[1] - 0.004, knob[2] - 0.009], [knob[0] + 0.01, knob[1] - 0.004, knob[2] + 0.009], [knob[0], knob[1] - 0.014, knob[2]], 1, STEEL);
	// the trigger, and the bottom of its guard (4)
	quad([0, -0.07, -0.095], [0, -0.07, -0.11], [0, -0.1, -0.12], [0, -0.1, -0.108], 2, STEEL);
	quad([-0.006, -0.112, -0.05], [0.006, -0.112, -0.05], [0.006, -0.112, -0.165], [-0.006, -0.112, -0.165], 0, STEEL);
	// the rounds A to D (see THE ROUNDS at the top), each placed by the shader (160)
	for (let part = 3; part <= 6; part++) cartridge(part);

	const data = [];
	for (const [a, b, c, k] of tris) for (const p of [a, b, c]) data.push(p[0], p[1], p[2], k);
	return new Float32Array(data);
})();
const RIFLE_VERTICES = RIFLE_MESH.length / 4;
export const RIFLE_TRIANGLE_COUNT = RIFLE_VERTICES / 3;

export const rifleStats = { rounds: MAGAZINE, magazine: MAGAZINE - 1, chamber: 'live', bolt: 'closed', state: 'ready', shots: 0, loaded: 0, ejected: 0, aimed: 0, triangles: RIFLE_TRIANGLE_COUNT };	// for anyone who wants to show it

// What it is doing
//-------------------------------------------------
const rifle = {
	state: 'ready', timer: 0, aimed: 0, wantsAim: false, kick: 0, bob: 0, trigger: 0, roll: 0, drop: 0, tilt: 0,
	magazine: MAGAZINE - 1,
	chamber: 'live',				// 'live', 'spent' (an empty case) or 'empty'
	lift: 0, liftWanted: 0,			// the bolt turned up, 0 to 1, and which way it is going
	back: 0, backWanted: 0,			// the bolt drawn back, 0 to 1, and how far the wheel has asked for
	stripped: false,				// it has been all the way back since it was last forward: going forward, it takes the top round
	loading: -1,					// seconds into pushing a round into the magazine, -1 when not
	queued: 0,						// presses of R waiting for the round before to go in
	sinceLoad: 99,					// seconds since the last round went in
	shown: 0,						// rolled over to show the open action, 0 to 1
	eject: null,					// the round or case thrown out: { t, from, live }
	message: '', messageAge: 99,	// a word about something it would not do
};
let triggerAsked = false, middleAsked = false, wheelPixels = 0, loadsAsked = 0;
let lastTime = performance.now();

const active = () => settings.gameMode == 'Hunting' && settings.enableTerrain;
const locked = () => document.pointerLockElement == canvas;

window.addEventListener('mousedown', (event) => {
	if (!active() || !locked()) return;
	if (event.button == 0) triggerAsked = true;
	if (event.button == 1) {
		middleAsked = true;
		event.preventDefault();		// (the middle button would start the browser's scrolling)
	}
	if (event.button == 2) rifle.wantsAim = true;
});
window.addEventListener('mouseup', (event) => {
	if (event.button == 2) rifle.wantsAim = false;
});
window.addEventListener('wheel', (event) => {
	if (!active() || !locked()) return;
	wheelPixels += event.deltaY * (event.deltaMode == 1 ? 40 : event.deltaMode == 2 ? 800 : 1);		// (lines or pages, as pixels)
	event.preventDefault();
}, { passive: false });
window.addEventListener('keydown', (event) => {
	if (active() && locked() && event.code == 'KeyR' && !event.repeat) loadsAsked++;
});
document.addEventListener('pointerlockchange', () => { if (!locked()) rifle.wantsAim = false; });

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
const ease = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
// 0 to 1 over [from, to] of a stretch of time
const over = (t, from, to) => ease((t - from) / (to - from));
// v moved toward to, by no more than step
const toward = (v, to, step) => v < to ? Math.min(v + step, to) : Math.max(v - step, to);

function say(message) {
	rifle.message = message;
	rifle.messageAge = 0;
}

// The rifle as it is held this frame, from its own space into the camera's
function gunMatrix() {
	const a = rifle.aimed;
	const mix = (p, q) => p + (q - p) * a;
	const sway = 1 - 0.7 * a;
	const x = mix(HIP.x, AIM.x) + Math.sin(rifle.bob) * 0.007 * sway;
	const y = mix(HIP.y, AIM.y) - Math.abs(Math.cos(rifle.bob)) * 0.006 * sway - rifle.drop;
	const z = mix(HIP.z, AIM.z) + rifle.kick * 0.045;
	let m = mat4.translation([x, y, z]);
	m = mat4.rotateY(m, mix(HIP.yaw, AIM.yaw) + Math.sin(rifle.bob) * 0.008 * sway);
	m = mat4.rotateX(m, mix(HIP.pitch, AIM.pitch) + rifle.kick * 0.11 + rifle.tilt);
	m = mat4.rotateZ(m, rifle.roll);
	return mat4.scale(m, [1, 1, -1]);		// (the rifle's +z, out of the muzzle, is the camera's -z)
}

// the camera's own directions in the world: right, up, and forward
function cameraAxes() {
	const right = transformations.getCameraRight(), forward = transformations.getCameraForward();
	const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
	return { right, up, forward };
}

// a point in the camera's space (metres) out in the world (world units)
function toWorld(p, axes) {
	const metre = settings.forestUnitsPerMetre;
	return [0, 1, 2].map((k) => [settings.camPosX, settings.camPosY, settings.camPosZ][k] + (axes.right[k] * p[0] + axes.up[k] * p[1] - axes.forward[k] * p[2]) * metre);
}

function shoot() {
	const axes = cameraAxes();
	const metre = settings.forestUnitsPerMetre;
	// out of the muzzle as the rifle is held now
	const muzzle = toWorld(vec3.transformMat4([0, 0, MUZZLE], gunMatrix()), axes);
	let direction;
	if (rifle.aimed > 0.85) {
		// along the line of sight, tipped up to come back down on to it at ZERO metres (see THE SHOT at the top)
		const time = ZERO / (820 * (1 - 0.0009 * ZERO / 2));
		const up = (SIGHT_HEIGHT + 0.5 * 9.81 * time * time) / ZERO;
		direction = [0, 1, 2].map((k) => axes.forward[k] + axes.up[k] * up);
	} else {
		// at the middle of the view ZERO metres off, give or take
		const spread = () => (Math.random() * 2 - 1) * HIP_SPREAD;
		const at = [0, 1, 2].map((k) => [settings.camPosX, settings.camPosY, settings.camPosZ][k] + axes.forward[k] * ZERO * metre);
		const sx = spread(), sy = spread();
		direction = [0, 1, 2].map((k) => (at[k] - muzzle[k]) / (ZERO * metre) + axes.right[k] * sx + axes.up[k] * sy);
	}
	ballistics.fire(muzzle, direction);
	rifleStats.shots++;
	rifleStats.lastShot = { muzzle, direction, aimed: rifle.aimed };
}

// Once a frame, after the walker has moved
export function rifleUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	advanceRifle(elapsed);
	showAmmo();
}

function advanceRifle(elapsed) {
	if (!active() || !hunting.hunterLife.alive) {
		triggerAsked = middleAsked = false;
		wheelPixels = loadsAsked = 0;
		rifle.aimed = 0;
		hunting.crosshair.hidden = false;
		return;
	}
	const r = rifle;
	r.timer += elapsed;
	r.messageAge += elapsed;

	// the walk sways it, as far as the hunter has gone
	const place = hunting.hunterPlace();
	const pace = Math.hypot(place.vx ?? 0, place.vz ?? 0) / settings.forestUnitsPerMetre;
	r.bob += elapsed * (place.grounded ? pace * 3.2 : 0);

	// the trigger: it fires what is in the chamber, with the bolt closed
	if (r.state == 'ready') {
		if (triggerAsked) {
			if (r.lift > 0 || r.liftWanted > 0) {
				say('Close the bolt to fire');
			} else {
				r.state = 'trigger';
				r.timer = 0;
			}
		}
	} else if (r.state == 'trigger') {
		r.trigger = clamp01(r.timer / TRIGGER_SECONDS);
		if (r.timer >= TRIGGER_SECONDS) {
			if (r.chamber == 'live') {
				shoot();
				r.chamber = 'spent';
				r.kick = 1;
				// the muzzle climbs, and takes the view a little way with it
				settings.camPitch = Math.min(settings.camPitch + 0.012, Math.PI * 0.5 - 0.02);
			} else {
				say(r.chamber == 'spent' ? 'Click. Work the bolt' : 'Click. The chamber is empty');
			}
			r.state = 'recoil';
			r.timer = 0;
		}
	} else if (r.state == 'recoil') {
		r.trigger = 1 - clamp01(r.timer / RECOIL_SECONDS);
		if (r.timer >= RECOIL_SECONDS) {
			r.trigger = 0;
			r.state = 'ready';
			r.timer = 0;
		}
	}
	triggerAsked = false;

	workBolt(elapsed);

	// the thrown out round flies on
	if (r.eject) {
		r.eject.t += elapsed;
		if (r.eject.t > EJECT_SECONDS) r.eject = null;
	}

	// canted a little while the bolt is open, and rolled over to the right and tipped up to show the open action while rounds
	//		are pushed in (a dip for each)
	const loadingPose = r.loading >= 0 || r.queued > 0 || r.sinceLoad < SHOW_HOLD;
	r.shown = toward(r.shown, loadingPose ? 1 : 0, elapsed / SHOW_SECONDS);
	const shown = ease(r.shown), open = ease(r.lift);
	const pushing = r.loading >= 0 ? Math.sin(Math.PI * over(r.loading / LOAD_SECONDS, 0.15, 0.85)) : 0;
	r.roll = -0.1 * open * (1 - shown) - 0.55 * shown;
	r.tilt = 0.03 * open * (1 - shown) + 0.22 * shown;
	r.drop = 0.03 * shown + 0.01 * pushing;

	// up to the eye while the right button is held (not while loading), and the recoil dying away
	const wantsAim = r.wantsAim && !loadingPose;
	r.aimed = clamp01(r.aimed + (wantsAim ? 1 : -1) * elapsed / AIM_SECONDS);
	r.kick *= Math.exp(-elapsed * 14);
	hunting.crosshair.hidden = r.aimed > 0.3;

	rifleStats.rounds = r.magazine + (r.chamber == 'live' ? 1 : 0);
	rifleStats.magazine = r.magazine;
	rifleStats.chamber = r.chamber;
	rifleStats.bolt = boltWord();
	rifleStats.state = r.state;
	rifleStats.aimed = r.aimed;
}

// The bolt (see THE BOLT at the top): turned by the middle button, drawn back and pushed forward by the wheel, and the rounds pushed in with R
function workBolt(elapsed) {
	const r = rifle;

	// the middle button: turn it up, or down again once it is all the way forward. Not while the trigger is being pulled
	if (middleAsked && r.state == 'ready') {
		if (r.liftWanted == 0) {
			r.liftWanted = 1;
		} else if (r.back == 0 && r.backWanted == 0 && r.loading < 0) {
			r.liftWanted = 0;
		} else {
			say('Push the bolt all the way forward to close it');
		}
	}
	middleAsked = false;
	r.lift = toward(r.lift, r.liftWanted, elapsed / BOLT_TURN_SECONDS);

	// R: a round at a time, with the bolt all the way back, while there is room in the magazine
	for (; loadsAsked > 0; loadsAsked--) {
		if (r.back < 1 || r.backWanted < 1) say(r.liftWanted == 0 ? 'Open the bolt and draw it back to load' : 'Draw the bolt all the way back to load');
		else if (r.magazine + r.queued + (r.loading >= 0 ? 1 : 0) >= MAGAZINE) say('The magazine is full');
		else r.queued++;
	}
	if (r.loading < 0 && r.queued > 0) {
		r.loading = 0;
		r.queued--;
	}
	if (r.loading >= 0) {
		r.loading += elapsed;
		if (r.loading >= LOAD_SECONDS) {
			r.magazine++;
			r.loading = -1;
			r.sinceLoad = 0;
			rifleStats.loaded++;
		}
	}
	r.sinceLoad += elapsed;

	// the wheel, with the bolt turned all the way up. While a round is being pushed in, or the bolt is still turning up, the
	//		scrolling waits
	const turning = r.liftWanted == 1 && r.lift < 1;
	const busy = r.loading >= 0 || r.queued > 0;
	if (r.liftWanted == 1 && r.lift == 1 && !busy) {
		r.backWanted = clamp01(r.backWanted + wheelPixels / BOLT_STROKE_PIXELS);
		wheelPixels = 0;
	} else if (!turning && !busy) {
		wheelPixels = 0;
	}
	if (r.lift < 1) r.backWanted = 0;

	const was = r.back;
	r.back = toward(r.back, r.backWanted, elapsed / BOLT_DRAW_SECONDS);
	// all the way back: out comes whatever was in the chamber
	if (r.back == 1 && was < 1) {
		if (r.chamber != 'empty') {
			r.eject = { t: 0, from: [0, 0, -BOLT_TRAVEL], live: r.chamber == 'live' };
			rifleStats.ejected++;
		}
		r.chamber = 'empty';
		r.stripped = true;
	}
	// all the way forward again: the top round off the magazine goes into the chamber
	if (r.back == 0 && was > 0 && r.stripped) {
		if (r.magazine > 0) {
			r.magazine--;
			r.chamber = 'live';
		}
		r.stripped = false;
	}
}

function boltWord() {
	if (rifle.lift == 0 && rifle.liftWanted == 0) return 'closed';
	if (rifle.back == 1) return 'back';
	return 'open';
}

// where the rounds are this frame (see THE ROUNDS at the top): A, B, C and D, then the spin of C
function roundsNow() {
	const r = rifle;
	const face = -BOLT_TRAVEL * r.back;
	const hidden = [0, 0, 0, 0];
	// B: from over the port, down on to the top of the magazine
	let B = hidden;
	if (r.loading >= 0) {
		const k = r.loading / LOAD_SECONDS;
		B = [0.016 * (1 - over(k, 0, 0.3)), 0.05 - (0.05 - MAG_Y) * over(k, 0.15, 0.85), MAG_REAR, 2];
	}
	// A: on the bolt's face: the one out of the chamber, or the top one off the magazine on its way in, rising to the bore
	let A = hidden;
	const feeding = r.chamber == 'empty' && r.stripped && r.magazine > 0 && face > MAG_REAR;
	if (r.chamber != 'empty') {
		A = [0, 0, face, r.chamber == 'live' ? 2 : 1];
	} else if (feeding) {
		const rise = over((face - MAG_REAR) / -MAG_REAR, 0, 0.5);
		A = [0, MAG_Y * (1 - rise), face, 2];
	}
	// D: the next on the magazine, pushed down by one coming in over it
	let D = hidden;
	if (r.magazine - (feeding ? 1 : 0) > 0) D = [0, r.loading >= 0 ? Math.min(MAG_Y, B[1] - ROUND_STACK) : MAG_Y, MAG_REAR, 2];
	// C: thrown up and out to the right, turning over, falling
	let C = hidden, spin = [0, 0, 0, 0];
	if (r.eject) {
		const t = r.eject.t, [x, y, z] = r.eject.from;
		C = [x + 0.9 * t, y + 1.3 * t - 4.9 * t * t, z - 0.35 * t, r.eject.live ? 2 : 1];
		spin = [-22 * t, 9 * t, 0, 0];
	}
	return [A, B, C, D, spin];
}

// a full rifle, the bolt closed on a round: a hunter up again after being shot (players.js)
export function resetRifle() {
	Object.assign(rifle, { state: 'ready', timer: 0, aimed: 0, kick: 0, trigger: 0, roll: 0, drop: 0, tilt: 0, magazine: MAGAZINE - 1, chamber: 'live',
		lift: 0, liftWanted: 0, back: 0, backWanted: 0, stripped: false, loading: -1, queued: 0, sinceLoad: 99, shown: 0, eject: null });
	triggerAsked = middleAsked = false;
	wheelPixels = loadsAsked = 0;
}

// for testing: the trigger pulled, the sights up or down, the middle button, the wheel turned (pixels, down positive), R pressed, and the rifle moved on by a number of seconds
export function testRifle({ fire = false, aim = null, middle = false, wheel = 0, load = 0, seconds = 0 } = {}) {
	if (fire) triggerAsked = true;
	if (aim !== null) rifle.wantsAim = aim;
	if (middle) middleAsked = true;
	wheelPixels += wheel;
	loadsAsked += load;
	for (let done = 0; done < seconds; done += 1 / 60) advanceRifle(1 / 60);
	showAmmo();
	return { ...rifleStats, lift: rifle.lift, back: rifle.back, trigger: rifle.trigger, roll: rifle.roll, shown: rifle.shown, loading: rifle.loading, message: rifle.message, rounds3d: roundsNow() };
}

// The ammunition, in the bottom right
//-------------------------------------------------
const ammo = document.createElement('div');
ammo.style.cssText = 'position: fixed; right: 16px; bottom: 16px; z-index: 5; pointer-events: none; display: none; padding: 10px 14px 9px; border-radius: 6px; background: rgba(0, 0, 0, 0.55); color: #e8e8e8; font-family: system-ui, sans-serif; text-align: right; user-select: none;';
document.body.appendChild(ammo);
let ammoShown = '';

// a round standing on its base: 'live', 'spent' (the case alone) or 'empty' (an outline)
function roundIcon(kind) {
	const empty = kind == 'empty';
	const fill = empty ? 'none' : '#c9a043', edge = empty ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.45)';
	const bullet = kind == 'live' ? '<path d="M2.4 9 L4 1.2 L5.6 9 Z" fill="#b5653a" stroke="rgba(0, 0, 0, 0.45)" stroke-width="0.6"/>' : '';
	return `<svg width="9" height="30" viewBox="0 0 8 28" style="display: block; opacity: ${kind == 'spent' ? 0.55 : 1}">${bullet}`
		+ `<path d="M2.4 9 L5.6 9 L7 12.5 L7 25.5 L1 25.5 L1 12.5 Z" fill="${fill}" stroke="${edge}" stroke-width="0.7"/>`
		+ `<rect x="0.4" y="25.5" width="7.2" height="2" fill="${fill}" stroke="${edge}" stroke-width="0.6"/></svg>`;
}

// what to do next, from where the bolt is
function nextStep() {
	const r = rifle;
	if (r.state != 'ready') return '';
	if (r.liftWanted == 0) return r.lift > 0 ? '' : r.chamber == 'live' ? 'Ready to fire' : 'Middle click to open the bolt';
	if (r.lift < 1) return '';
	if (r.loading >= 0 || r.queued > 0) return 'Loading';
	if (r.back == 1) return r.magazine < MAGAZINE ? 'R to load a round · scroll up to push the bolt forward' : 'Scroll up to push the bolt forward';
	if (r.stripped) return 'Scroll up to push the bolt forward';
	if (r.back > 0) return 'Scroll down to draw the bolt back';
	return r.chamber == 'live' ? 'Middle click to close the bolt' : 'Scroll down to draw the bolt back';
}

function showAmmo() {
	const on = active() && hunting.hunterPlace().active && hunting.hunterLife.alive;
	ammo.style.display = on ? '' : 'none';
	if (!on) return;
	const r = rifle;
	const message = r.messageAge < MESSAGE_SECONDS ? r.message : '';
	const key = [r.magazine, r.chamber, boltWord(), nextStep(), message].join('|');
	if (key == ammoShown) return;
	ammoShown = key;

	const label = 'font-size: 10px; letter-spacing: 0.08em; color: rgba(232, 232, 232, 0.6); margin-top: 3px; text-align: center;';
	let magazine = '';
	for (let k = 0; k < MAGAZINE; k++) magazine += roundIcon(k < MAGAZINE - r.magazine ? 'empty' : 'live');
	const rounds = r.magazine + (r.chamber == 'live' ? 1 : 0);
	ammo.innerHTML =
		`<div style="display: flex; align-items: flex-end; justify-content: flex-end; gap: 12px;">`
		+ `<div style="font-size: 30px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums; margin-right: 2px;">${rounds}</div>`
		+ `<div><div style="display: flex; gap: 3px;">${magazine}</div><div style="${label}">MAGAZINE</div></div>`
		+ `<div style="width: 1px; align-self: stretch; background: rgba(255, 255, 255, 0.2);"></div>`
		+ `<div><div style="display: flex; justify-content: center;">${roundIcon(r.chamber)}</div><div style="${label}">CHAMBER</div></div>`
		+ `</div>`
		+ `<div style="margin-top: 7px; font-size: 12px; letter-spacing: 0.1em; font-weight: 600;">BOLT ${boltWord().toUpperCase()}</div>`
		+ `<div style="margin-top: 2px; font-size: 12px; color: rgba(232, 232, 232, 0.75); min-height: 15px;">${nextStep()}</div>`
		+ (message ? `<div style="margin-top: 2px; font-size: 12px; color: #f2c46d;">${message}</div>` : '');
}

// Drawing it
//-------------------------------------------------
const rifleShaderModule = device.createShaderModule({ label: "vf_rifle", code: vf_rifle });
const meshBuffer = device.createBuffer({ label: "rifle mesh", size: RIFLE_MESH.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(meshBuffer, 0, RIFLE_MESH);
const rifleUniformBuffer = device.createBuffer({ label: "rifle Uniform", size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const riflePipeline = device.createRenderPipeline({
	label: "rifle pipeline",
	layout: 'auto',
	vertex: { module: rifleShaderModule, entryPoint: "vertexMain", buffers: [{ arrayStride: 16, attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }] }] },
	fragment: { module: rifleShaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
});
const rifleBindGroup = device.createBindGroup({ label: "rifle bind group", layout: riflePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: rifleUniformBuffer } }] });

// its own depth, at the canvas's size (made again when that changes)
const makeDepth = () => device.createTexture({ label: "rifle depth", size: [canvas.width, canvas.height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
let rifleDepth = makeDepth();
onRenderResize(() => { rifleDepth.destroy(); rifleDepth = makeDepth(); });

// over the finished frame, in front of everything
export function riflePass() {
	if (!active() || !hunting.hunterPlace().active || !hunting.hunterLife.alive) {
		return;
	}
	const projection = mat4.perspective(transformations.verticalViewAngle, canvas.width / canvas.height, 0.01, 10);
	// the light, turned into the camera's space
	const light = lightNow();
	const view = transformations.getViewMatrix();
	const L = [0, 1, 2].map((k) => view[k] * light.direction[0] + view[4 + k] * light.direction[1] + view[8 + k] * light.direction[2]);
	const [A, B, C, D, spin] = roundsNow();
	const uniforms = new Float32Array(64);
	uniforms.set(projection, 0);
	uniforms.set(gunMatrix(), 16);
	uniforms.set([ease(rifle.lift) * BOLT_TURN, rifle.back * BOLT_TRAVEL, rifle.trigger, 0], 32);
	uniforms.set([L[0], L[1], L[2], light.direct * 1.3], 36);
	uniforms.set([light.ambient, light.daylight, 0, 0], 40);
	uniforms.set(A, 44);
	uniforms.set(B, 48);
	uniforms.set(C, 52);
	uniforms.set(D, 56);
	uniforms.set(spin, 60);
	device.queue.writeBuffer(rifleUniformBuffer, 0, uniforms);

	const encoder = device.createCommandEncoder({ label: "rifle" });
	const pass = encoder.beginRenderPass({
		colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: rifleDepth.createView(), depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
		timestampWrites: profiler.timestamps('Rifle', 'vf_rifle'),
	});
	pass.setPipeline(riflePipeline);
	pass.setBindGroup(0, rifleBindGroup);
	pass.setVertexBuffer(0, meshBuffer);
	pass.draw(RIFLE_VERTICES, 1, 0, 0);
	pass.end();
	device.queue.submit([encoder.finish()]);
}
