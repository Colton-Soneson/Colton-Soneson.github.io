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
		right click (held)	aim, along the top strap to the front sight
		middle click		open the loading gate, or shut it. The gate is the little door in the right side of the frame, behind the
							cylinder: open, it shows the back of the chamber in line with it (a live round's primer, a fired one's, or
							an empty hole). The hammer goes to half cock, and the cylinder turns freely
		mouse wheel			with the gate open: a notch turns the cylinder on (down) or back (up) one chamber
		R (a tap)			whatever is in the chamber at the gate: a fired case is pushed out with the ejector rod, and so is a live
							round (it goes back to those carried); an empty chamber has a round put in, and the cylinder clicks on to
							the next that needs it. So R over and over goes case out, round in, case out, round in... until it is full
	Opening the gate turns the cylinder to the first chamber from the gate on that needs anything (a fired case, or empty), so a live
	round is only pulled out when it is turned to on purpose. Open, the gun is brought up and turned (OPEN) to show the gate.
		R (held)			everything out: the ejector works each chamber in turn, round the cylinder
	Shutting the gate turns the cylinder so that the round put in last, or the first of the rounds in a row with it, is under the
	hammer: the rounds loaded come up one after another.
	Each round put in is one of those carried (weapons.js: 36 all told); a live one pushed out goes back to them.

	THE CHAMBERS are numbered round the cylinder clockwise as the shooter sees it (from behind). aligned: the one under the hammer,
	in line with the barrel at the top. The gate is two on from it (at four o'clock, GATE_AFTER).

	THE GUN (REVOLVER_MESH): no more than 300 triangles, in metres, the bore along +z (as the rifle's), +x to the right. The parts:
		0	the frame (its front round the barrel, the top strap the sights run along, the strap under the cylinder, the recoil shield
			behind it with the gate's notch cut in its right side, the hammer's housing behind that), the barrel and its front sight,
			the ejector rod's housing under it, the grip (walnut panels on a blued back strap and front strap), the trigger guard
		1	the cylinder (its face drawn with its six chambers, vf_viewmodel.js material 14)
		2	the loading gate, hinged at its outside bottom edge: it swings out and down
		3	the hammer, about its pivot		4 the trigger
		5	a round: going in, or a live one on its way out		6 a fired case on its way out
		7	the ejector rod and its knob, pushed back through the chamber at the gate
		SLOT_PARTS	the backs of the three chambers nearest the gate, turning with the cylinder: each a case head's brass, and its
					primer as it is before firing and after (the one that is not so is hidden; an empty chamber hides them all)
	Rounds and cases come out of the chamber backwards through the gate's notch, and fall away to the right.
*/
const SIGHT_HEIGHT = 0.0165;		// the top of the front sight, and of the top strap at its back
const ZERO = 25;
const MUZZLE = 0.16;
const HIP_SPREAD = 0.02;
const CHAMBERS = 6;
const GATE_AFTER = 2;				// chambers on from the one under the hammer to the one at the gate
const AXIS_Y = -0.0125;			// the cylinder's axis under the bore
const CHAMBER_RADIUS = 0.0125;		// from the axis to a chamber's middle (CHAMBER_OUT in vf_viewmodel.js)
const CYLINDER = [-0.047, -0.006];	// its back and its front
const CYLINDER_OUT = 0.0195;		// its radius
const SHIELD = [-0.056, -0.047];	// the recoil shield behind it, back and front
const NOTCH = { x0: 0.0045, x1: 0.0175, y0: -0.0262, y1: -0.0113 };		// the gate's notch in the shield, which the gate fills
const CASE_LENGTH = 0.033, ROUND_LENGTH = 0.044;
const PULL_SECONDS = 0.22;			// the double action pull
const RECOIL_SECONDS = 0.25;
const AIM_SECONDS = 0.18;
const GATE_SECONDS = 0.25;
const TURN_SECONDS = 0.12;			// the cylinder a chamber on
const TAP_SECONDS = 0.3;			// R let go sooner than this is a tap
const HOLD_SECONDS = 0.5;			// held this long, everything out
const OUT_SECONDS = 0.45;			// a case or a round pushed out with the ejector: the push, then the rod back
const PUSH_SHARE = 0.55;			// of that, the push (the case comes free at the end of it)
const IN_SECONDS = 0.55;			// a round put in
const FALL_SECONDS = 0.7;
const MESSAGE_SECONDS = 1.6;

const HIP = { x: 0.12, y: -0.13, z: -0.32, yaw: 0.06, pitch: 0.02 };
const OPEN = { x: 0.03, y: -0.05, z: -0.25, yaw: -0.85, pitch: -0.15, roll: 0.4 };	// with the gate open: up, the muzzle off to the right, its right side to the eye
const AIM = { x: 0, y: -SIGHT_HEIGHT, z: -0.40, yaw: 0, pitch: 0 };

// The gun (see THE GUN at the top)
//-------------------------------------------------
const BLUED = 1, BRASS = 2, LEAD = 3, CASE = 5, NICKEL = 8, DARK = 9, WOOD = 10, FACE = 14;
const SLOTS = 3, SLOT_PARTS = 9;	// the chambers nearest the gate drawn from behind: parts 9 to 17, three each (head, primer, fired primer)
// a chamber's middle on the cylinder's face, the cylinder's own way round (as the mesh is made)
const chamberOnCylinder = (k) => { const a = k / CHAMBERS * Math.PI * 2; return [CHAMBER_RADIUS * Math.sin(a), CHAMBER_RADIUS * Math.cos(a)]; };
// the chamber at the gate's middle, in the gun's space (the ejector rod and its housing are in line with it)
const GATE_AT = [CHAMBER_RADIUS * Math.sin(GATE_AFTER / CHAMBERS * Math.PI * 2), AXIS_Y + CHAMBER_RADIUS * Math.cos(GATE_AFTER / CHAMBERS * Math.PI * 2)];
const REVOLVER_MESH = (() => {
	const m = vm.meshBuilder();
	// an outline of [x, y] corners (convex, in order) pushed back along z from z0 to z1: its sides (skip: those left out, side k from
	//		corner k to the next), and its back (at z0) and front (at z1) if asked
	const prismZ = (outline, z0, z1, part, material, { back = false, front = false, skip = [] } = {}) => {
		const A = outline.map(([x, y]) => [x, y, z0]), B = outline.map(([x, y]) => [x, y, z1]), n = outline.length;
		for (let k = 0; k < n; k++) if (!skip.includes(k)) m.quad(A[k], A[(k + 1) % n], B[(k + 1) % n], B[k], part, material);
		for (let k = 1; k < n - 1; k++) { if (back) m.tri(A[0], A[k], A[k + 1], part, material); if (front) m.tri(B[0], B[k], B[k + 1], part, material); }
	};
	// the same across the gun: an outline of [z, y] corners from x0 to x1, closed at both sides
	const prismX = (outline, x0, x1, part, material, { skip = [] } = {}) => {
		const A = outline.map(([z, y]) => [x0, y, z]), B = outline.map(([z, y]) => [x1, y, z]), n = outline.length;
		for (let k = 0; k < n; k++) if (!skip.includes(k)) m.quad(A[k], A[(k + 1) % n], B[(k + 1) % n], B[k], part, material);
		for (let k = 1; k < n - 1; k++) { m.tri(A[0], A[k], A[k + 1], part, material); m.tri(B[0], B[k], B[k + 1], part, material); }
	};
	const [GX, GY] = GATE_AT;

	// THE FRAME AND THE BARREL (part 0)
	// the barrel (16) and its front sight, a blade (10)
	m.tube(0, 0, 0.004, 0.0088, MUZZLE, 0.0083, 8, BLUED);
	prismX([[MUZZLE - 0.018, 0.0083], [MUZZLE - 0.004, 0.0082], [MUZZLE - 0.007, SIGHT_HEIGHT], [MUZZLE - 0.014, SIGHT_HEIGHT]], -0.0012, 0.0012, 0, BLUED, { skip: [0] });
	// the ejector rod's housing, in line with the chamber at the gate (13), and the web that holds it to the barrel (2)
	m.tube(GX, GY, 0.004, 0.0042, 0.118, 0.0042, 5, BLUED, 0, [1]);
	m.quad([0.004, -0.0075, 0.006], [0.004, -0.0075, 0.115], [GX - 0.002, GY + 0.0035, 0.115], [GX - 0.002, GY + 0.0035, 0.006], 0, BLUED);
	// the frame round the barrel's end (8), the top strap (6), the strap under the cylinder (6)
	m.section(-0.006, [0.0105, -0.0365, 0.0115], 0.010, [0.0095, -0.031, 0.0105], BLUED, 0, [1], [0]);
	m.section(CYLINDER[0] - 0.002, [0.0065, 0.0105, SIGHT_HEIGHT], CYLINDER[1], [0.006, 0.009, 0.0135], BLUED, 0, [], [0]);
	m.section(CYLINDER[0] - 0.002, [0.0105, -0.0365, -0.0315], CYLINDER[1], [0.0105, -0.0365, -0.0315], BLUED, 0, [], [2]);
	// the recoil shield, in three pieces round the gate's notch: the left and the middle, over the notch, under it (32)
	prismZ([[-0.0175, -0.037], [NOTCH.x0, -0.037], [NOTCH.x0, SIGHT_HEIGHT], [-0.0065, SIGHT_HEIGHT], [-0.0175, 0.004]], SHIELD[0], SHIELD[1], 0, BLUED, { back: true });
	prismZ([[NOTCH.x0, NOTCH.y1], [NOTCH.x1, NOTCH.y1], [NOTCH.x1, 0.004], [0.0065, SIGHT_HEIGHT], [NOTCH.x0, SIGHT_HEIGHT]], SHIELD[0], SHIELD[1], 0, BLUED, { back: true, skip: [4] });
	prismZ([[NOTCH.x0, -0.037], [NOTCH.x1, -0.037], [NOTCH.x1, NOTCH.y0], [NOTCH.x0, NOTCH.y0]], SHIELD[0], SHIELD[1], 0, BLUED, { back: true, skip: [3] });
	// the hammer's housing behind it (10): narrower on the right, where the rounds come and go
	prismZ([[-0.0085, -0.037], [0.006, -0.037], [0.006, 0.008], [-0.0085, 0.008]], -0.072, SHIELD[0], 0, BLUED, { back: true });
	// the grip (40): lofted down and back through four rings across it, each a hexagon: the front strap and the back strap blued,
	//		the walnut panels bulging out either side between them. [front z, front y, back z, back y, how far out the panels are]
	const GRIP = [[-0.058, -0.037, -0.074, 0.006, 0.0115], [-0.066, -0.062, -0.094, -0.040, 0.0145], [-0.074, -0.088, -0.106, -0.080, 0.015], [-0.080, -0.111, -0.108, -0.109, 0.014]];
	const strap = 0.0055;
	const rings = GRIP.map(([fz, fy, bz, by, w]) => [[strap, fy, fz], [w, (fy + by) / 2, (fz + bz) / 2], [strap, by, bz], [-strap, by, bz], [-w, (fy + by) / 2, (fz + bz) / 2], [-strap, fy, fz]]);
	const faces = [WOOD, WOOD, BLUED, WOOD, WOOD, BLUED];
	for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < 6; k++) m.quad(rings[i][k], rings[i][(k + 1) % 6], rings[i + 1][(k + 1) % 6], rings[i + 1][k], 0, faces[k]);
	const bottom = rings[rings.length - 1];
	for (let k = 1; k < 5; k++) m.tri(bottom[0], bottom[k], bottom[k + 1], 0, BLUED);
	// the trigger guard (24): a flat band bowed down round the trigger, from the frame to the front of the grip
	const bow = [[-0.012, -0.0365], [-0.022, -0.054], [-0.042, -0.0595], [-0.060, -0.045]];
	const out = bow.map((p, i) => {
		const a = bow[Math.max(i - 1, 0)], b = bow[Math.min(i + 1, bow.length - 1)];
		const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
		return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];		// (outwards: away from the trigger)
	});
	const band = bow.map(([z, y], i) => [[-0.0035, y, z], [0.0035, y, z], [0.0035, y - out[i][1] * 0.0026, z + out[i][0] * 0.0026], [-0.0035, y - out[i][1] * 0.0026, z + out[i][0] * 0.0026]]);
	for (let i = 0; i < band.length - 1; i++) for (let k = 0; k < 4; k++) m.quad(band[i][k], band[i][(k + 1) % 4], band[i + 1][(k + 1) % 4], band[i + 1][k], 0, BLUED);

	// THE MOVING PARTS
	// the cylinder about its own axis (it is put on it by its part's matrix): ten flats, its back face with the chambers in it (28)
	m.tube(0, 0, CYLINDER[0], CYLINDER_OUT, CYLINDER[1], CYLINDER_OUT, 10, BLUED, 1);
	m.disc(0, 0, CYLINDER[0], CYLINDER_OUT, 10, FACE, 1);
	// the loading gate (12), filling the notch
	prismZ([[NOTCH.x0 + 0.0001, NOTCH.y0 + 0.0001], [NOTCH.x1 + 0.0004, NOTCH.y0 + 0.0001], [NOTCH.x1 + 0.0004, NOTCH.y1 - 0.0001], [NOTCH.x0 + 0.0001, NOTCH.y1 - 0.0001]], SHIELD[0] - 0.0002, SHIELD[1], 2, CASE, { back: true, front: true });
	// the hammer (16): its face against the frame, its spur back over the grip, down under the line of the sights
	prismX([[-0.0565, 0.0], [-0.0565, 0.0125], [-0.087, 0.0155], [-0.0905, 0.0105], [-0.066, -0.006]], -0.003, 0.003, 3, CASE);
	// the trigger (8)
	prismX([[-0.029, -0.0355], [-0.0345, -0.0355], [-0.041, -0.0505], [-0.0365, -0.0515]], -0.0016, 0.0016, 4, BLUED, { skip: [0, 2] });
	// a round (18): its case, its rim, the lead of its bullet; its base at the origin, along +z
	m.tube(0, 0, 0, 0.0057, CASE_LENGTH, 0.0057, 5, BRASS, 5);
	m.disc(0, 0, 0, 0.0064, 5, BRASS, 5);
	for (let k = 0; k < 5; k++) {
		const a = (k + 0.5) / 5 * Math.PI * 2, b = (k + 1.5) / 5 * Math.PI * 2;
		m.tri([Math.cos(a) * 0.0057, Math.sin(a) * 0.0057, CASE_LENGTH], [Math.cos(b) * 0.0057, Math.sin(b) * 0.0057, CASE_LENGTH], [0, 0, ROUND_LENGTH], 5, LEAD);
	}
	// a fired case (13)
	m.tube(0, 0, 0, 0.0057, CASE_LENGTH, 0.0057, 5, BRASS, 6);
	m.disc(0, 0, 0, 0.0064, 5, BRASS, 6);
	// the ejector rod (6) and its knob on the right of the housing (10)
	m.tube(GX, GY, -0.002, 0.0017, 0.104, 0.0017, 3, BLUED, 7);
	prismZ([[GX + 0.0025, GY - 0.002], [GX + 0.0065, GY - 0.002], [GX + 0.0065, GY + 0.0025], [GX + 0.0025, GY + 0.0025]], 0.104, 0.112, 7, BLUED, { back: true });
	// the chambers' backs by the gate (18): a case head's brass, its primer as it is, its primer fired
	for (let s = 0; s < SLOTS; s++) {
		m.disc(0, 0, -0.0004, 0.0064, 6, BRASS, SLOT_PARTS + 3 * s);
		m.disc(0, 0, -0.0007, 0.0026, 3, NICKEL, SLOT_PARTS + 3 * s + 1);
		m.disc(0, 0, -0.0007, 0.0026, 3, DARK, SLOT_PARTS + 3 * s + 2);
	}
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
	work: null,					// at the gate: { kind: 'out' or 'in', t, chamber, live, freed } (a case or a round)
	emptying: false,			// R held: everything out, round the cylinder
	emptied: 0,					// chambers seen to so far, emptying
	falling: [],				// out of the gun, falling: { t, live, at: [x, y, z] where it came free }
	message: '', messageAge: 99,
};
export const revolverStats = { shots: 0, put: 0, out: 0, pulled: 0, triangles: REVOLVER_TRIANGLES };
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
		['Middle click', 'open or shut the loading gate'],
		['R (tap)', 'gate open: whatever is at the gate: case out, round in, or a live round out'],
		['Wheel', 'gate open: turn the cylinder a chamber'],
		['R (hold)', 'gate open: everything out'],
		['', 'Shutting the gate brings the rounds you loaded under the hammer, one after another'],
	]] });

export function resetRevolver() {
	Object.assign(gun, { state: 'ready', timer: 0, aimed: 0, kick: 0, trigger: 0, chambers: Array(CHAMBERS).fill('live'), aligned: 0, turn: 0, open: false, gate: 0, hammer: 0,
		lastIn: null, work: null, emptying: false, emptied: 0, falling: [] });
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

// the chamber at the gate worked: a case or a live round pushed out, a round put in. False if nothing could be done
function workGate() {
	const g = gun;
	const k = gateChamber();
	if (g.chambers[k] == 'empty') {
		if (!weapons.takeRound('revolver')) { say(weapons.noAmmoWord); return false; }
		g.work = { kind: 'in', t: 0, chamber: k };
	} else {
		g.work = { kind: 'out', t: 0, chamber: k, live: g.chambers[k] == 'live', freed: false };
	}
	return true;
}
// how many chambers on from chamber k the first one is that needs anything (a fired case in it, or empty): 0 for k itself, and 0 when
//		none does
function needsWork(k) {
	for (let d = 0; d < CHAMBERS; d++) if (gun.chambers[wrap(k + d)] != 'live') return d;
	return 0;
}
// how far the cylinder is from where it is drawn: still turning
const turning = () => Math.abs(gun.aligned - gun.turn - CHAMBERS * Math.round((gun.aligned - gun.turn) / CHAMBERS)) > 0.02;

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
	const busy = () => g.work !== null || g.emptying;

	// the trigger: the double action pull draws the hammer back, and it falls
	if (g.state == 'ready') {
		if (triggerAsked) {
			if (g.open) say('Shut the gate to fire (middle click)');
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
	if (middleAsked && g.state == 'ready' && !busy()) {
		if (!g.open) {
			g.open = true;
			g.lastIn = null;
			g.aligned = wrap(g.aligned + needsWork(gateChamber()));
		} else {
			g.open = false;
			// the last round put in, or the first of the run of rounds it is in
			if (g.lastIn !== null && g.chambers[g.lastIn] == 'live') {
				let k = g.lastIn;
				for (let n = 0; n < CHAMBERS - 1 && g.chambers[wrap(k - 1)] == 'live'; n++) k = wrap(k - 1);
				g.aligned = k;
			}
		}
	} else if (middleAsked && busy()) {
		say('Wait for the ejector');
	}
	middleAsked = false;
	g.gate = vm.toward(g.gate, g.open ? 1 : 0, elapsed / GATE_SECONDS);
	if (g.state == 'ready') g.hammer = vm.toward(g.hammer, g.open ? 0.4 : 0, elapsed / 0.12);

	// the wheel: the cylinder a chamber on or back at a notch, with the gate open
	if (g.open && !busy()) {
		const notches = Math.trunc(wheelPixels / 100);
		if (notches) {
			g.aligned = wrap(g.aligned + notches);
			wheelPixels -= notches * 100;
		}
	} else {
		wheelPixels = 0;
	}

	// R: a tap works the chamber at the gate; held, everything out
	if (rDown >= 0 && !holdDone && performance.now() / 1000 - rDown >= HOLD_SECONDS) {
		holdDone = true;
		if (!g.open) say('Open the gate first (middle click)');
		else if (!busy()) { g.emptying = true; g.emptied = 0; }
	}
	// (a tap while the last is still being done waits for it: two at the most)
	tapsAsked = Math.min(tapsAsked, 2);
	while (tapsAsked > 0) {
		if (!g.open) { say('Open the gate first (middle click)'); tapsAsked--; continue; }
		if (busy() || turning()) break;
		workGate();
		tapsAsked--;
	}
	// emptying: each chamber at the gate pushed out (if there is anything in it), then the cylinder on a chamber
	if (g.emptying && !g.work && !turning()) {
		if (g.emptied >= CHAMBERS) g.emptying = false;
		else {
			g.emptied++;
			if (g.chambers[gateChamber()] != 'empty') workGate();
			else g.aligned = wrap(g.aligned + 1);
		}
	}
	if (g.work) {
		const w = g.work;
		w.t += elapsed * (g.emptying ? 1.3 : 1);
		if (w.kind == 'out' && !w.freed && w.t >= OUT_SECONDS * PUSH_SHARE) {
			// out of the chamber: it falls away, and the chamber is empty
			w.freed = true;
			g.chambers[w.chamber] = 'empty';
			if (w.live) { weapons.giveRound('revolver'); revolverStats.pulled++; }
			g.falling.push({ t: 0, live: w.live, at: caseOut(w.chamber, 1) });
			revolverStats.out++;
		}
		if (w.kind == 'out' && w.t >= OUT_SECONDS) {
			g.work = null;
			if (g.emptying) g.aligned = wrap(g.aligned + 1);
		} else if (w.kind == 'in' && w.t >= IN_SECONDS) {
			g.chambers[w.chamber] = 'live';
			g.lastIn = w.chamber;
			revolverStats.put++;
			g.work = null;
			// and on to the next chamber that needs a round, with a click (the next one along when they are all full)
			g.aligned = wrap(g.aligned + 1 + needsWork(wrap(gateChamber() + 1)));
		}
	}
	for (const f of g.falling) f.t += elapsed;
	g.falling = g.falling.filter((f) => f.t < FALL_SECONDS);
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
	// opened, it is brought up and turned, its right side and the gate to the eye (OPEN)
	const hold = Object.fromEntries(Object.keys(HIP).map((key) => [key, HIP[key] + (OPEN[key] - HIP[key]) * open]));
	return vm.holdMatrix(hold, AIM, { aimed: gun.aimed, bob: gun.bob, kick: gun.kick, kickBack: 0.04, kickUp: 0.3, roll: OPEN.roll * open });
}

// The parts as they are now (see THE GUN at the top)
//-------------------------------------------------
// a chamber's middle at the back of the cylinder, in the gun's space, as the cylinder is drawn
function chamberAt(k) {
	const angle = (k - gun.turn) / CHAMBERS * Math.PI * 2;
	return [CHAMBER_RADIUS * Math.sin(angle), AXIS_Y + CHAMBER_RADIUS * Math.cos(angle)];
}
// where a case (or a round) being pushed out of chamber k is, pushed 0 (in) to 1 (free of it): back along the chamber, and out to the
//		right a little as it clears the notch
function caseOut(k, push) {
	const [cx, cy] = chamberAt(k);
	return [cx + 0.004 * push * push, cy - 0.002 * push * push, CYLINDER[0] - (CASE_LENGTH + 0.003) * push];
}
function partsNow() {
	const g = gun;
	const parts = [];
	// the cylinder turned about its axis (clockwise from behind, as the chambers are numbered)
	const turn = g.turn / CHAMBERS * Math.PI * 2;
	const cylinder = mat4.multiply(mat4.translation([0, AXIS_Y, 0]), mat4.rotationZ(turn));
	parts[1] = cylinder;
	// the gate swung out and down about its hinge, at its outside bottom edge
	const hinge = [NOTCH.x1, NOTCH.y0, 0];
	parts[2] = mat4.multiply(mat4.translation(hinge), mat4.multiply(mat4.rotationZ(-1.75 * vm.ease(g.gate)), mat4.translation(hinge.map((v) => -v))));
	// the hammer back about its pivot
	const pivot = [0, -0.002, -0.064];
	parts[3] = mat4.multiply(mat4.translation(pivot), mat4.multiply(mat4.rotationX(-0.75 * g.hammer), mat4.translation(pivot.map((v) => -v))));
	parts[4] = mat4.translation([0, 0, -0.007 * g.trigger]);

	// the round going in: up from below and to the right, turned nose in, straightened behind its chamber, then pushed home with a
	//		little press at the end
	let round = vm.HIDDEN, fired = vm.HIDDEN, rod = 0;
	const w = g.work;
	if (w && w.kind == 'in') {
		const k = vm.clamp01(w.t / IN_SECONDS);
		const [cx, cy] = chamberAt(w.chamber);
		const come = vm.ease(k / 0.5), push = vm.ease((k - 0.5) / 0.4), press = k > 0.9 ? Math.sin((k - 0.9) / 0.1 * Math.PI) * 0.0012 : 0;
		const at = [cx + 0.045 * (1 - come), cy - 0.035 * (1 - come), CYLINDER[0] - (ROUND_LENGTH + 0.004) * (1 - push) - 0.012 * (1 - come) + press];
		round = mat4.rotateX(mat4.rotateY(mat4.translation(at), -0.8 * (1 - come)), 0.3 * (1 - come));
	}
	// pushed out by the rod: back out of its chamber through the notch, then falling away to the right, tumbling
	if (w && w.kind == 'out') {
		const k = vm.clamp01(w.t / OUT_SECONDS);
		rod = k < PUSH_SHARE ? vm.ease(k / PUSH_SHARE) : vm.ease((1 - k) / (1 - PUSH_SHARE));
		if (!w.freed) {
			const at = mat4.translation(caseOut(w.chamber, vm.ease(k / PUSH_SHARE)));
			if (w.live) round = at; else fired = at;
		}
	}
	for (const f of g.falling) {
		const t = f.t;
		const at = mat4.rotateZ(mat4.rotateX(mat4.translation([f.at[0] + 0.25 * t, f.at[1] + 0.06 * t - 4.9 * t * t, f.at[2] - 0.04 * t]), 7 * t), -3 * t);
		if (f.live) { if (round === vm.HIDDEN) round = at; }
		else if (fired === vm.HIDDEN) fired = at;
	}
	parts[5] = round;
	parts[6] = fired;
	parts[7] = mat4.translation([0, 0, -(CASE_LENGTH + 0.012) * rod]);

	// the backs of the chambers by the gate, turning with the cylinder (the one being worked on is the round or case drawn above)
	const near = Math.round(g.turn) + GATE_AFTER;
	for (let s = 0; s < SLOTS; s++) {
		const k = wrap(near - 1 + s);
		const what = w && w.chamber == k ? 'empty' : g.chambers[k];
		const [x, y] = chamberOnCylinder(k);
		const at = mat4.multiply(cylinder, mat4.translation([x, y, CYLINDER[0]]));
		parts[SLOT_PARTS + 3 * s] = what == 'empty' ? vm.HIDDEN : at;
		parts[SLOT_PARTS + 3 * s + 1] = what == 'live' ? at : vm.HIDDEN;
		parts[SLOT_PARTS + 3 * s + 2] = what == 'spent' ? at : vm.HIDDEN;
	}
	return parts;
}

function drawRevolver() {
	view.draw(gunMatrix(), partsNow());
}

// The ammunition box, in the bottom right
//-------------------------------------------------
// the cylinder as the shooter sees it from behind, turning as it turns: the hammer's chamber at the top, the gate's at four o'clock
//		(its tab lit while it is open), each chamber a live round (brass, its primer), a fired case (brass, its primer dark and struck)
//		or empty (a dark hole). Under it, what R does now and the other keys
const box = vm.ammoBox();
let shown = '';
const KEY = 'display: inline-block; min-width: 14px; padding: 0 5px; margin-right: 6px; border: 1px solid rgba(255, 255, 255, 0.55); border-radius: 3px; font-size: 11px; font-weight: 700; line-height: 16px; text-align: center; color: #fff; background: rgba(255, 255, 255, 0.1);';
function cylinderPicture() {
	const g = gun;
	const S = 84, r = 33, out = 21;
	let svg = `<svg width="${S + 36}" height="${S}" viewBox="${-S / 2 - 18} ${-S / 2} ${S + 36} ${S}" style="display: block;">`;
	// the gate's tab, outside the cylinder at four o'clock
	const ga = GATE_AFTER / CHAMBERS * Math.PI * 2, gx = Math.sin(ga) * (r + 8), gy = -Math.cos(ga) * (r + 8);
	svg += `<g transform="translate(${gx.toFixed(1)} ${gy.toFixed(1)}) rotate(${(ga * 180 / Math.PI - 90).toFixed(0)})"><rect x="-4" y="-9" width="11" height="18" rx="2" fill="${g.open ? '#f2c46d' : 'rgba(255, 255, 255, 0.18)'}" stroke="rgba(0, 0, 0, 0.4)"/></g>`;
	svg += `<text x="${(gx + 13).toFixed(1)}" y="${(gy + 13).toFixed(1)}" font-size="9" font-weight="700" fill="${g.open ? '#f2c46d' : 'rgba(255, 255, 255, 0.45)'}" text-anchor="middle">GATE</text>`;
	svg += `<circle r="${r}" fill="rgba(40, 44, 52, 0.9)" stroke="rgba(255, 255, 255, 0.3)"/>`;
	for (let k = 0; k < CHAMBERS; k++) {
		const a = (k - g.turn) / CHAMBERS * Math.PI * 2;
		const x = (Math.sin(a) * out).toFixed(1), y = (-Math.cos(a) * out).toFixed(1);
		const c = g.work && g.work.chamber == k ? (g.work.kind == 'in' ? 'empty' : g.chambers[k]) : g.chambers[k];
		const atGate = g.open && k == gateChamber() && !turning();
		if (c == 'empty') svg += `<circle cx="${x}" cy="${y}" r="8.5" fill="#0b0c0e" stroke="rgba(255, 255, 255, 0.35)"/>`;
		else svg += `<circle cx="${x}" cy="${y}" r="8.5" fill="#c9a043" stroke="rgba(0, 0, 0, 0.55)"/>`;
		if (c == 'live') svg += `<circle cx="${x}" cy="${y}" r="3.4" fill="#d9dadc" stroke="rgba(0, 0, 0, 0.35)"/>`;
		if (c == 'spent') svg += `<circle cx="${x}" cy="${y}" r="3.4" fill="#2a2420"/><path d="M${+x - 2.2} ${+y - 2.2} L${+x + 2.2} ${+y + 2.2} M${+x + 2.2} ${+y - 2.2} L${+x - 2.2} ${+y + 2.2}" stroke="#7a1f14" stroke-width="1.4"/>`;
		if (atGate) svg += `<circle cx="${x}" cy="${y}" r="11" fill="none" stroke="#f2c46d" stroke-width="2"/>`;
	}
	// the hammer, over the top chamber
	svg += `<path d="M0 ${-r + 4} L-4 ${-r - 4} L4 ${-r - 4} Z" fill="#fff"/></svg>`;
	return svg;
}
// what R does now, and the keys
function prompts() {
	const g = gun;
	const key = (k, text, lit = false) => `<div style="margin-top: 3px; font-size: 12px; color: ${lit ? '#fff' : 'rgba(232, 232, 232, 0.6)'}; white-space: nowrap;"><span style="${KEY}${lit ? ' border-color: #f2c46d; color: #f2c46d;' : ''}">${k}</span>${text}</div>`;
	if (g.emptying) return key('R', 'Emptying the cylinder…', true);
	if (g.work) return key('R', g.work.kind == 'in' ? 'Putting a round in…' : g.work.live ? 'Pulling out a live round…' : 'Pushing out the fired case…', true);
	if (!g.open) {
		const ready = g.chambers[g.aligned] == 'live';
		const any = g.chambers.includes('live');
		return (ready ? key('LMB', 'Fire', true) : any ? key('LMB', 'Fire (that chamber is not loaded: the next one is)', true) : '')
			+ key('MMB', any && !g.chambers.includes('empty') && !g.chambers.includes('spent') ? 'Open the gate' : 'Open the gate to reload', !any);
	}
	const at = g.chambers[gateChamber()];
	const left = g.chambers.filter((c) => c != 'live').length;
	return key('R', at == 'spent' ? 'Push out the fired case' : at == 'empty' ? 'Load a round (then it turns to the next)' : 'Pull out this live round', true)
		+ key('Wheel', 'Turn the cylinder')
		+ key('Hold R', 'Empty every chamber')
		+ key('MMB', left ? `Shut the gate (${left} not loaded)` : 'Shut the gate: fully loaded', left == 0);
}
function showAmmo() {
	const on = active() && hunting.hunterPlace().active;
	box.style.display = on ? '' : 'none';
	if (!on) return;
	const g = gun;
	const message = g.messageAge < MESSAGE_SECONDS ? g.message : '';
	const key = [g.chambers.join(), Math.round(g.turn * 20), g.open, g.emptying, g.work ? g.work.kind + g.work.live + g.work.chamber : '', g.aligned, message, weapons.carried('revolver')].join('|');
	if (key == shown) return;
	shown = key;
	const live = g.chambers.filter((c) => c == 'live').length, spent = g.chambers.filter((c) => c == 'spent').length;
	box.innerHTML = `<div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px;">`
		+ `<div style="text-align: center;"><div style="font-size: 30px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums;">${live}</div><div style="${vm.LABEL}">+${weapons.carried('revolver')} CARRIED</div></div>`
		+ `<div>${cylinderPicture()}<div style="${vm.LABEL}">${live} LIVE · ${spent} FIRED · ${CHAMBERS - live - spent} EMPTY</div></div></div>`
		+ `<div style="margin-top: 6px; font-size: 12px; letter-spacing: 0.1em; font-weight: 600; color: ${g.open ? '#f2c46d' : '#e8e8e8'};">${g.open ? 'GATE OPEN' : 'GATE SHUT'}</div>`
		+ `<div style="display: flex; flex-direction: column; align-items: flex-end;">${prompts()}</div>`
		+ (message ? `<div style="margin-top: 4px; font-size: 12px; color: #f2c46d;">${message}</div>` : '');
}

// for testing: the trigger, the sights, the middle button, the wheel (pixels, down +), R tapped or held, moved on by seconds
export function testRevolver({ fire = false, aim = null, middle = false, wheel = 0, tap = 0, hold = false, seconds = 0 } = {}) {
	if (fire) triggerAsked = true;
	if (aim !== null) gun.wantsAim = aim;
	if (middle) middleAsked = true;
	wheelPixels += wheel;
	tapsAsked += tap;
	if (hold) { holdDone = true; if (gun.open && !gun.work && !gun.emptying) { gun.emptying = true; gun.emptied = 0; } }
	for (let done = 0; done < seconds; done += 1 / 60) advance(1 / 60);
	showAmmo();
	return { chambers: gun.chambers.join(), aligned: gun.aligned, gate: gateChamber(), open: gun.open, state: gun.state, message: gun.message, carried: weapons.carried('revolver'),
		work: gun.work && { ...gun.work }, ...revolverStats };
}
// for testing: the gun held still where it is now, part way through what it is doing (seconds into the work at the gate)
export function testPose({ work = null, t = 0, open = null } = {}) {
	if (open !== null) { gun.open = open; gun.gate = open ? 1 : 0; gun.hammer = open ? 0.4 : 0; }
	if (work == 'none') gun.work = null;
	else if (work) gun.work = { kind: work, t, chamber: gateChamber(), live: work == 'outLive', freed: false };
	if (work == 'outLive' || work == 'outCase') gun.work.kind = 'out';
	gun.turn = gun.aligned;
	showAmmo();
}
// for testing: the gun drawn where a matrix puts it (in the camera's space), as it is now
export function inspectRevolver(matrix) {
	view.draw(matrix, partsNow());
}
