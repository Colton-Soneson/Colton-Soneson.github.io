import {canvas} from './deviceSelection.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as vm from './viewmodel.js'

/*
	THE REVOLVER: a Colt Single Action Army made over for cartridges (a loading gate behind the cylinder on the right, an ejector rod
	under the barrel) and for double action (the trigger cocks and drops the hammer itself), .45 Colt, six chambers.
		left click			fire: the long double action pull, the hammer back and down. It fires the chamber under the hammer, and
							the cylinder turns on to the next as the trigger comes back
		right click (held)	aim, along the top strap's notch to the front sight
		middle click		open the loading gate (the hammer goes to half cock, the cylinder turns freely), or close it
		mouse wheel			with the gate open: a notch turns the cylinder on (down) or back (up) one chamber, the next to the gate
		R (a tap)			at the gate: a fired case is pushed out with the ejector rod, an empty chamber has a round put in. So it
							goes case, round, case, round, turning the cylinder a notch between each
		R (held)			the ejector rod works every chamber in turn, round the cylinder: all of them out, cases and rounds
	Closing the gate turns the cylinder so that the round put in last is the one under the hammer.
	Each round put in is one of those carried (weapons.js: 36 all told); a live one pushed out goes back to them.

	THE CHAMBERS are numbered round the cylinder clockwise as the shooter sees it (from behind). aligned: the one under the hammer,
	in line with the barrel at the top. The gate is two on from it (at four o'clock, GATE_AFTER).

	THE GUN (REVOLVER_MESH): no more than 80 triangles, in metres, the bore along +z (as the rifle's): the barrel and its front sight,
	the ejector rod's housing under it, the frame and the grip, the trigger guard (part 0); the cylinder (part 1), the loading gate
	(2), the hammer (3), the trigger (4), the round being put in (5), the case falling out (6), the ejector rod's head (7).
*/
const SIGHT_HEIGHT = 0.022;
const ZERO = 25;
const MUZZLE = 0.16;
const HIP_SPREAD = 0.02;
const CHAMBERS = 6;
const GATE_AFTER = 2;				// chambers on from the one under the hammer to the one at the gate
const AXIS_Y = -0.0125;			// the cylinder's axis under the bore
const CHAMBER_RADIUS = 0.0125;		// from the axis to a chamber's middle
const CYLINDER = [-0.047, -0.006];	// its back and its front
const PULL_SECONDS = 0.22;			// the double action pull
const RECOIL_SECONDS = 0.25;
const AIM_SECONDS = 0.18;
const GATE_SECONDS = 0.18;
const TURN_SECONDS = 0.09;			// the cylinder a chamber on
const TAP_SECONDS = 0.3;			// R let go sooner than this is a tap
const HOLD_SECONDS = 0.5;			// held this long, everything out
const OUT_SECONDS = 0.32;			// a case pushed out with the ejector
const IN_SECONDS = 0.35;			// a round put in
const EMPTY_EACH = 0.2;			// seconds a chamber, emptying the lot
const MESSAGE_SECONDS = 1.6;

const HIP = { x: 0.12, y: -0.13, z: -0.32, yaw: 0.06, pitch: 0.02 };
const AIM = { x: 0, y: -SIGHT_HEIGHT, z: -0.42, yaw: 0, pitch: 0 };

// The gun (see THE GUN at the top)
//-------------------------------------------------
const WOOD = 0, BLUED = 1, BRASS = 2, LEAD = 3, CASE = 5;
const REVOLVER_MESH = (() => {
	const m = vm.meshBuilder();
	// the barrel (12) and its front sight (1)
	m.tube(0, 0, 0.0, 0.0088, MUZZLE, 0.0085, 6, BLUED);
	m.tri([0, 0.008, MUZZLE - 0.012], [0, 0.008, MUZZLE - 0.002], [0, SIGHT_HEIGHT, MUZZLE - 0.004], 0, BLUED);
	// the ejector rod's housing (6)
	m.tube(0.009, -0.013, 0.005, 0.0045, 0.13, 0.004, 3, BLUED);
	// the frame round the cylinder, from the barrel back to the hammer (10), and the grip down from it (8)
	m.section(-0.068, [0.012, -0.032, 0.021], 0.006, [0.012, -0.032, 0.021], CASE, 0, [0]);
	m.section(-0.068, [0.012, -0.032, 0.02], -0.105, [0.014, -0.11, -0.085], WOOD);
	// the trigger guard (2)
	m.quad([-0.004, -0.05, -0.02], [0.004, -0.05, -0.02], [0.004, -0.05, -0.062], [-0.004, -0.05, -0.062], 0, CASE);
	// the cylinder: six flats round its axis, open at the ends (12)
	m.tube(0, AXIS_Y, CYLINDER[0], 0.0195, CYLINDER[1], 0.0195, 6, BLUED, 1, [], 0);
	// the loading gate, hinged at its bottom on the right of the frame (2)
	m.quad([0.0125, -0.028, -0.06], [0.0125, -0.028, -0.048], [0.0125, -0.008, -0.048], [0.0125, -0.008, -0.06], 2, CASE);
	// the hammer's spur (4), the trigger (2)
	m.quad([-0.003, 0.0, -0.06], [0.003, 0.0, -0.06], [0.003, 0.03, -0.078], [-0.003, 0.03, -0.078], 3, CASE);
	m.quad([-0.003, 0.03, -0.078], [0.003, 0.03, -0.078], [0.003, 0.034, -0.09], [-0.003, 0.034, -0.09], 3, CASE);
	m.quad([0, -0.032, -0.03], [0, -0.032, -0.036], [0, -0.048, -0.042], [0, -0.048, -0.034], 4, CASE);
	// a round (10): its case and its head, and the lead of its bullet, its base at the origin along +z
	m.tube(0, 0, 0, 0.006, 0.033, 0.006, 3, BRASS, 5, [0]);
	m.tri([0.006, 0, 0.033], [-0.003, 0.0052, 0.033], [0, 0, 0.044], 5, LEAD);
	m.tri([-0.003, 0.0052, 0.033], [-0.003, -0.0052, 0.033], [0, 0, 0.044], 5, LEAD);
	m.tri([-0.003, -0.0052, 0.033], [0.006, 0, 0.033], [0, 0, 0.044], 5, LEAD);
	// a fired case (7)
	m.tube(0, 0, 0, 0.006, 0.033, 0.006, 3, BRASS, 6, [0]);
	// the ejector rod's head (2)
	m.quad([0.012, -0.018, 0.1], [0.016, -0.018, 0.1], [0.016, -0.008, 0.11], [0.012, -0.008, 0.11], 7, BLUED);
	return { data: m.done(), triangles: m.count() };
})();
export const REVOLVER_TRIANGLES = REVOLVER_MESH.triangles;
const view = new vm.Viewmodel('Revolver', REVOLVER_MESH.data);

// What it is doing
//-------------------------------------------------
const gun = {
	state: 'ready', timer: 0, aimed: 0, wantsAim: false, kick: 0, bob: 0, trigger: 0,
	chambers: Array(CHAMBERS).fill('live'),	// each: 'live', 'spent' or 'empty'
	aligned: 0,					// the chamber under the hammer
	turn: 0,					// the cylinder as drawn, in chambers (it follows aligned round)
	open: false, gate: 0,		// the gate, and how far open it is drawn
	hammer: 0,					// 0 down, 0.4 half cock, 1 back
	lastIn: null,				// the chamber the last round went into
	work: null,					// at the gate: { kind: 'out' or 'in', t, chamber, live } (a case or a round)
	emptying: -1,				// emptying the lot: seconds into it, -1 when not
	falling: [],				// cases and rounds out of the gun, falling: { t, x, y }
	message: '', messageAge: 99,
};
export const revolverStats = { shots: 0, put: 0, out: 0, triangles: REVOLVER_TRIANGLES };
let triggerAsked = false, middleAsked = false, wheelPixels = 0;
let rDown = -1, tapsAsked = 0, holdDone = false;	// R: when it went down (seconds), taps waiting, the hold already done
let lastTime = performance.now();
const active = () => weapons.holding('revolver');
const locked = () => document.pointerLockElement == canvas;
const say = (text) => { gun.message = text; gun.messageAge = 0; };
const gateChamber = () => (gun.aligned + GATE_AFTER) % CHAMBERS;
const wrap = (k) => ((k % CHAMBERS) + CHAMBERS) % CHAMBERS;

window.addEventListener('mousedown', (event) => {
	if (!active() || !locked() || hunting.input.menuOpen) return;
	if (event.button == 0) triggerAsked = true;
	if (event.button == 1) { middleAsked = true; event.preventDefault(); }
	if (event.button == 2) gun.wantsAim = true;
});
window.addEventListener('mouseup', (event) => { if (event.button == 2) gun.wantsAim = false; });
window.addEventListener('wheel', (event) => {
	if (!active() || !locked() || hunting.input.menuOpen || hunting.crosshair.onRope) return;
	wheelPixels += vm.wheelPixels(event);
	event.preventDefault();
}, { passive: false });
window.addEventListener('keydown', (event) => {
	if (active() && locked() && !hunting.input.menuOpen && event.code == 'KeyR' && !event.repeat) { rDown = performance.now() / 1000; holdDone = false; }
});
window.addEventListener('keyup', (event) => {
	if (event.code != 'KeyR' || rDown < 0) return;
	if (performance.now() / 1000 - rDown < TAP_SECONDS && active()) tapsAsked++;
	rDown = -1;
});
document.addEventListener('pointerlockchange', () => { if (!locked()) gun.wantsAim = false; });

weapons.addWeapon('revolver', { label: 'Colt revolver', detail: 'Single Action Army, made over: cartridges and double action, .45 Colt, six', equip: () => { gun.aimed = 0; },
	loaded: () => gun.chambers.filter((c) => c == 'live').length + (gun.work && gun.work.kind == 'in' ? 1 : 0), reset: () => resetRevolver(), drawn: () => drawRevolver(),
	help: () => ['Colt revolver', [
		['Left click', 'fire (double action), with the gate shut'],
		['Right click', 'aim (hold)'],
		['Middle click', 'open or close the loading gate'],
		['Wheel', 'gate open: turn the cylinder a chamber'],
		['R (tap)', 'at the gate: push out a case, or put in a round'],
		['R (hold)', 'push them all out'],
		['', 'Closing puts the last round you put in under the hammer'],
	]] });

export function resetRevolver() {
	Object.assign(gun, { state: 'ready', timer: 0, aimed: 0, kick: 0, trigger: 0, chambers: Array(CHAMBERS).fill('live'), aligned: 0, turn: 0, open: false, gate: 0, hammer: 0,
		lastIn: null, work: null, emptying: -1, falling: [] });
	triggerAsked = middleAsked = false; wheelPixels = 0; tapsAsked = 0; rDown = -1;
}

// Once a frame
//-------------------------------------------------
export function revolverUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	advance(elapsed);
	showAmmo();
}

function advance(elapsed) {
	if (!active()) {
		triggerAsked = middleAsked = false; wheelPixels = 0; tapsAsked = 0;
		gun.aimed = 0;
		return;
	}
	const g = gun;
	g.timer += elapsed;
	g.messageAge += elapsed;
	const place = hunting.hunterPlace();
	g.bob += elapsed * (place.grounded ? Math.hypot(place.vx ?? 0, place.vz ?? 0) / settings.forestUnitsPerMetre * 3.2 : 0);
	const busy = g.work !== null || g.emptying >= 0;

	// the trigger: the double action pull draws the hammer back, and it falls
	if (g.state == 'ready') {
		if (triggerAsked) {
			if (g.open) say('Close the gate to fire');
			else { g.state = 'pull'; g.timer = 0; }
		}
	} else if (g.state == 'pull') {
		g.trigger = vm.clamp01(g.timer / PULL_SECONDS);
		g.hammer = g.trigger;
		if (g.timer >= PULL_SECONDS) {
			const k = g.aligned;
			if (g.chambers[k] == 'live') {
				vm.shoot({ muzzle: [0, 0, MUZZLE], gun: gunMatrix(), aimed: g.aimed, sight: SIGHT_HEIGHT, zero: ZERO, spread: HIP_SPREAD, round: '.45 Colt' });
				revolverStats.shots++;
				g.chambers[k] = 'spent';
				g.kick = 1;
				settings.camPitch = Math.min(settings.camPitch + 0.025, Math.PI * 0.5 - 0.02);
			} else {
				say(g.chambers[k] == 'spent' ? 'Click. A fired case' : 'Click. An empty chamber');
			}
			g.hammer = 0;
			g.state = 'recoil'; g.timer = 0;
		}
	} else if (g.state == 'recoil') {
		g.trigger = 1 - vm.clamp01(g.timer / RECOIL_SECONDS);
		if (g.timer >= RECOIL_SECONDS) {
			// the trigger comes back, and the cylinder turns on to the next chamber
			g.trigger = 0; g.state = 'ready'; g.timer = 0;
			g.aligned = wrap(g.aligned + 1);
		}
	}
	triggerAsked = false;

	// the middle button: the gate open (half cock), or shut (the last round put in turned under the hammer)
	if (middleAsked && g.state == 'ready' && !busy) {
		if (!g.open) {
			g.open = true;
			g.lastIn = null;
		} else {
			g.open = false;
			if (g.lastIn !== null && g.chambers[g.lastIn] == 'live') g.aligned = g.lastIn;
		}
	} else if (middleAsked && busy) {
		say('Wait for the ejector');
	}
	middleAsked = false;
	g.gate = vm.toward(g.gate, g.open ? 1 : 0, elapsed / GATE_SECONDS);
	if (g.state == 'ready') g.hammer = vm.toward(g.hammer, g.open ? 0.4 : 0, elapsed / 0.12);

	// the wheel: the cylinder a chamber on or back at a notch, with the gate open
	if (g.open && !busy) {
		const notches = Math.trunc(wheelPixels / 100);
		if (notches) {
			g.aligned = wrap(g.aligned + notches);
			wheelPixels -= notches * 100;
		}
	} else {
		wheelPixels = 0;
	}

	// R: a tap works the chamber at the gate; held, all of them out
	if (rDown >= 0 && !holdDone && performance.now() / 1000 - rDown >= HOLD_SECONDS) {
		holdDone = true;
		if (!g.open) say('Open the gate first (middle click)');
		else if (!busy) g.emptying = 0;
	}
	for (; tapsAsked > 0; tapsAsked--) {
		if (!g.open) { say('Open the gate first (middle click)'); continue; }
		if (busy || g.work) continue;
		const k = gateChamber();
		if (g.chambers[k] == 'spent') {
			g.work = { kind: 'out', t: 0, chamber: k, live: false };
		} else if (g.chambers[k] == 'empty') {
			if (!weapons.takeRound('revolver')) say(weapons.noAmmoWord);
			else g.work = { kind: 'in', t: 0, chamber: k };
		} else {
			say('A round is in that chamber: turn the cylinder (wheel)');
		}
	}
	if (g.work) {
		g.work.t += elapsed;
		const w = g.work;
		if (w.kind == 'out' && w.t >= OUT_SECONDS) {
			g.chambers[w.chamber] = 'empty';
			g.falling.push({ t: 0, live: w.live });
			revolverStats.out++;
			g.work = null;
		} else if (w.kind == 'in' && w.t >= IN_SECONDS) {
			g.chambers[w.chamber] = 'live';
			g.lastIn = w.chamber;
			revolverStats.put++;
			g.work = null;
		}
	}
	// emptying the lot: the cylinder turned on a chamber at a time, each pushed out at the gate
	if (g.emptying >= 0) {
		const before = Math.floor(g.emptying / EMPTY_EACH);
		g.emptying += elapsed;
		const after = Math.floor(g.emptying / EMPTY_EACH);
		for (let step = before; step < after && step < CHAMBERS; step++) {
			const k = gateChamber();
			if (g.chambers[k] != 'empty') {
				const live = g.chambers[k] == 'live';
				g.chambers[k] = 'empty';
				if (live) weapons.giveRound('revolver');
				g.falling.push({ t: 0, live });
				revolverStats.out++;
			}
			if (step < CHAMBERS - 1) g.aligned = wrap(g.aligned + 1);
		}
		if (g.emptying >= CHAMBERS * EMPTY_EACH) g.emptying = -1;
	}
	for (const f of g.falling) f.t += elapsed;
	g.falling = g.falling.filter((f) => f.t < 0.8);
	// the cylinder drawn turning round to where it is (the shorter way)
	let gap = g.aligned - g.turn;
	gap -= CHAMBERS * Math.round(gap / CHAMBERS);
	g.turn += Math.sign(gap) * Math.min(Math.abs(gap), elapsed / TURN_SECONDS);

	g.aimed = vm.clamp01(g.aimed + (g.wantsAim && !g.open ? 1 : -1) * elapsed / AIM_SECONDS);
	g.kick *= Math.exp(-elapsed * 12);
	hunting.crosshair.hidden = g.aimed > 0.3;
}

function gunMatrix() {
	const open = vm.ease(gun.gate);
	// opened, it is brought in and turned on its side a little, the gate towards the eye
	return vm.holdMatrix(HIP, AIM, { aimed: gun.aimed, bob: gun.bob, kick: gun.kick, kickBack: 0.04, kickUp: 0.3, roll: -0.5 * open, tilt: 0.25 * open, drop: 0.02 * open });
}

// a chamber's middle, in the gun's space (at the back of the cylinder), as the cylinder is drawn
function chamberAt(k) {
	const angle = (k - gun.turn) / CHAMBERS * Math.PI * 2;
	return [CHAMBER_RADIUS * Math.sin(angle), AXIS_Y + CHAMBER_RADIUS * Math.cos(angle)];
}
function partsNow() {
	const g = gun;
	const parts = [];
	// the cylinder turned about its axis (clockwise from behind, as the chambers are numbered)
	const turn = g.turn / CHAMBERS * Math.PI * 2;
	parts[1] = mat4.multiply(mat4.translation([0, AXIS_Y, 0]), mat4.multiply(mat4.rotationZ(turn), mat4.translation([0, -AXIS_Y, 0])));
	// the gate swung out about its hinge at its bottom
	const hinge = [0.0125, -0.028, 0];
	parts[2] = mat4.multiply(mat4.translation(hinge), mat4.multiply(mat4.rotationZ(-1.4 * vm.ease(g.gate)), mat4.translation(hinge.map((v) => -v))));
	// the hammer back about its pivot
	const pivot = [0, 0.005, -0.06];
	parts[3] = mat4.multiply(mat4.translation(pivot), mat4.multiply(mat4.rotationX(-0.75 * g.hammer), mat4.translation(pivot.map((v) => -v))));
	parts[4] = mat4.translation([0, 0, -0.008 * g.trigger]);
	// the round going in: from beside the gate, round to the back of its chamber and in
	let round = vm.HIDDEN, rod = 0;
	if (g.work && g.work.kind == 'in') {
		const k = vm.clamp01(g.work.t / IN_SECONDS);
		const [cx, cy] = chamberAt(g.work.chamber);
		const across = vm.ease(k / 0.5), push = vm.ease((k - 0.5) / 0.5);
		round = mat4.translation([cx + 0.05 * (1 - across), cy - 0.02 * (1 - across), CYLINDER[0] - 0.05 + 0.05 * push]);
	}
	parts[5] = round;
	// a case on its way out: pushed back out of its chamber by the rod, then falling
	let fired = vm.HIDDEN;
	if (g.work && g.work.kind == 'out') {
		const k = vm.clamp01(g.work.t / OUT_SECONDS);
		const [cx, cy] = chamberAt(g.work.chamber);
		rod = Math.sin(Math.PI * k);
		fired = mat4.translation([cx, cy, CYLINDER[0] - 0.04 * vm.ease(k)]);
	} else if (g.falling.length) {
		const f = g.falling[g.falling.length - 1], t = f.t;
		const [cx, cy] = chamberAt(gateChamber());
		fired = mat4.rotateX(mat4.translation([cx + 0.03 * t, cy - 4.9 * t * t, CYLINDER[0] - 0.04 - 0.05 * t]), 6 * t);
	}
	if (g.emptying >= 0) rod = Math.abs(Math.sin(Math.PI * g.emptying / EMPTY_EACH));
	parts[6] = fired;
	parts[7] = mat4.translation([0, 0, -0.06 * rod]);
	return parts;
}

function drawRevolver() {
	view.draw(gunMatrix(), partsNow());
}

// The cylinder, in the bottom right: each chamber round it, the one under the hammer at the top, the gate's marked
//-------------------------------------------------
const box = vm.ammoBox();
let shown = '';
function cylinderPicture() {
	const g = gun;
	let svg = `<svg width="64" height="64" viewBox="-32 -32 64 64" style="display: block;"><circle r="27" fill="rgba(255, 255, 255, 0.06)" stroke="rgba(255, 255, 255, 0.25)"/>`;
	for (let k = 0; k < CHAMBERS; k++) {
		const a = (k - g.aligned) / CHAMBERS * Math.PI * 2;
		const x = Math.sin(a) * 17, y = -Math.cos(a) * 17;
		const c = g.chambers[k];
		const gate = g.open && k == gateChamber();
		svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="7" fill="${c == 'empty' ? 'none' : '#c9a043'}" stroke="${gate ? '#f2c46d' : c == 'empty' ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.5)'}" stroke-width="${gate ? 2.2 : 1}"/>`;
		if (c == 'live') svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="#8d8a85"/>`;
		if (c == 'spent') svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="#2a2420"/>`;
	}
	svg += `<path d="M0 -31 L-3 -26 L3 -26 Z" fill="#fff"/></svg>`;
	return svg;
}
function nextStep() {
	const g = gun;
	if (g.emptying >= 0) return 'Emptying';
	if (g.work) return g.work.kind == 'in' ? 'Putting a round in' : 'Pushing out a case';
	if (!g.open) return g.chambers[g.aligned] == 'live' ? 'Ready to fire' : g.chambers.includes('live') ? 'Fire to turn on to the next' : 'Middle click to open the gate';
	const at = g.chambers[gateChamber()];
	if (at == 'spent') return 'R: push out the case';
	if (at == 'empty') return 'R: put in a round';
	return g.chambers.some((c) => c != 'live') ? 'Scroll to turn the cylinder' : 'Middle click to close';
}
function showAmmo() {
	const on = active() && hunting.hunterPlace().active;
	box.style.display = on ? '' : 'none';
	if (!on) return;
	const g = gun;
	const message = g.messageAge < MESSAGE_SECONDS ? g.message : '';
	const key = [g.chambers.join(), g.aligned, g.open, nextStep(), message, weapons.carried('revolver')].join('|');
	if (key == shown) return;
	shown = key;
	box.innerHTML = vm.ammoHtml({ count: g.chambers.filter((c) => c == 'live').length, carried: weapons.carried('revolver'),
		groups: [{ icons: cylinderPicture(), label: 'CYLINDER' }], state: g.open ? 'GATE OPEN' : 'GATE SHUT', next: nextStep(), message });
}

// for testing: the trigger, the sights, the middle button, the wheel (pixels, down +), R tapped or held, moved on by seconds
export function testRevolver({ fire = false, aim = null, middle = false, wheel = 0, tap = 0, hold = false, seconds = 0 } = {}) {
	if (fire) triggerAsked = true;
	if (aim !== null) gun.wantsAim = aim;
	if (middle) middleAsked = true;
	wheelPixels += wheel;
	tapsAsked += tap;
	if (hold) { holdDone = true; if (gun.open && !gun.work && gun.emptying < 0) gun.emptying = 0; }
	for (let done = 0; done < seconds; done += 1 / 60) advance(1 / 60);
	showAmmo();
	return { chambers: gun.chambers.join(), aligned: gun.aligned, gate: gateChamber(), open: gun.open, state: gun.state, message: gun.message, carried: weapons.carried('revolver'), ...revolverStats };
}
