import {canvas} from './deviceSelection.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as vm from './viewmodel.js'

/*
	THE SHOTGUN: a pump action, something like a Mossberg 500, 12 bore, 00 buckshot: nine pellets a shell (ballistics.js), spread by
	CHOKE. Four in the tube under the barrel and one in the chamber (TUBE + 1).
		left click			fire (with the action closed: the pump all the way forward)
		right click (held)	aim, along the rib to the bead
		mouse wheel			the pump: down draws it back (it throws out what is in the chamber), up pushes it forward (it takes the
							next shell off the tube into the chamber). PUMP_PIXELS of scrolling is the whole way: a notch of an
							ordinary wheel down, then a notch up. Drawn back part of the way and pushed forward again, nothing happens
		R					push a shell up through the loading port into the tube, one a press, as the rifle's rounds go in (the
							gun is rolled over to show the port). With the action open and nothing in the chamber, it goes into the
							chamber instead
	Each shell pushed in is one of those carried (weapons.js: 18 all told), and a live one thrown out by the pump goes back to them.

	THE GUN (SHOTGUN_MESH): SHOTGUN_TRIANGLES (no more than 500), in metres, the bore along +z from the front of the receiver (as the
	rifle's). Part 0: the receiver, lofted, its edges rounded off, with the dark of the ejection port on its right and the loading
	port under it, and the safety on its tang; the barrel with the dark of its bore, the vent rib along its top and the two beads on
	that (the front one at the muzzle is the sight); the magazine tube under the barrel, its cap, and the lug that holds the two
	together; the stock down from the receiver to its recoil pad; the trigger guard's loop. Part 1, sliding: the forend with its
	grooves, and the action bars back from it along the receiver's sides. Part 2 the trigger. Parts 3 and 4, two shells (the one in
	the chamber, pulled back and thrown out or fed up from the tube; the one being pushed into the tube), each a six sided hull with
	its brass head.
*/
const SIGHT_HEIGHT = 0.025;			// the bead and the rib over the bore, metres
const ZERO = 25;					// metres the bead is on at
const MUZZLE = 0.51;
const HIP_SPREAD = 0.03;			// radians either way, from the hip
const CHOKE = 0.018;				// radians: how far the pellets spread round the middle of the shot (one standard deviation)
const PELLETS = 9;
const TUBE = 4;
const TRIGGER_SECONDS = 0.08;
const RECOIL_SECONDS = 0.3;
const AIM_SECONDS = 0.2;
const PUMP_TRAVEL = 0.09;			// metres the forend slides
const PUMP_SECONDS = 0.1;			// at the quickest, the whole way
export const PUMP_PIXELS = 100;		// of the wheel, the whole way
const LOAD_SECONDS = 0.5;
const SHOW_SECONDS = 0.3, SHOW_HOLD = 0.9;
const EJECT_SECONDS = 0.8;
const MESSAGE_SECONDS = 1.6;
const SHELL = 0.07;					// a shell's length
const CHAMBER_Z = -0.072;			// where a shell's head is in the chamber
const TUBE_Y = -0.028;				// the middle of the magazine tube

const HIP = { x: 0.14, y: -0.15, z: -0.36, yaw: 0.05, pitch: 0.015 };
const AIM = { x: 0, y: -SIGHT_HEIGHT, z: -0.45, yaw: 0, pitch: 0 };

// The gun (see THE GUN at the top)
//-------------------------------------------------
const WOOD = 0, STEEL = 1, BRASS = 2, HULL = 4, DARK = 9, RUBBER = 9;
const SHOTGUN_MESH = (() => {
	const m = vm.meshBuilder();
	// THE RECEIVER: lofted, its top edges rounded off, its back and front closed (44), the dark of the ejection port on the right and
	//		of the loading port under it (4), the safety on the tang at the back of its top (12)
	m.loft([m.across(-0.2, [0.016, -0.04, 0.02], 0.009), m.across(-0.17, [0.017, -0.045, 0.025], 0.01), m.across(0.0, [0.017, -0.045, 0.025], 0.01)], STEEL, 0, [0, 1]);
	m.quad([0.0172, -0.004, -0.11], [0.0172, -0.004, -0.035], [0.0172, 0.017, -0.035], [0.0172, 0.017, -0.11], 0, DARK);
	m.quad([-0.011, -0.0452, -0.1], [0.011, -0.0452, -0.1], [0.011, -0.0452, -0.02], [-0.011, -0.0452, -0.02], 0, DARK);
	m.section(-0.193, [0.0045, 0.019, 0.0255], -0.175, [0.0045, 0.02, 0.0262], STEEL, 0, [0, 1]);
	// the trigger guard's loop under it, from its front round under the trigger and back up (32), and the trigger (12)
	const bow = [[0, -0.045, -0.07], [0, -0.073, -0.077], [0, -0.079, -0.118], [0, -0.062, -0.152], [0, -0.045, -0.158]];
	for (let k = 0; k < bow.length - 1; k++) m.strut(bow[k], bow[k + 1], 0.0032, 0.0032, 4, STEEL);
	m.prismX([[-0.1, -0.045], [-0.111, -0.045], [-0.118, -0.067], [-0.11, -0.068]], -0.002, 0.002, STEEL, 2);

	// THE BARREL: eight sided, the dark of its bore at the muzzle (22), the vent rib along its top (10), the bead at the muzzle (the sight,
	//		its top SIGHT_HEIGHT) and the middle bead (32)
	m.tube(0, 0, 0.0, 0.0125, MUZZLE, 0.0115, 8, STEEL);
	m.disc(0, 0, MUZZLE + 0.0003, 0.0085, 8, DARK);
	m.section(0.0, [0.0042, 0.011, 0.0175], MUZZLE - 0.003, [0.0042, 0.0105, 0.019], STEEL, 0, [1], [0]);
	m.ball([0, SIGHT_HEIGHT - 0.003, MUZZLE - 0.008], 0.003, 4, BRASS);
	m.ball([0, 0.02, MUZZLE * 0.52], 0.0019, 4, BRASS);
	// the magazine tube under it (12), its cap (22), and the lug that holds the barrel to it (10)
	m.tube(0, TUBE_Y, 0.0, 0.0105, 0.41, 0.0105, 6, STEEL, 0, [], 0.25);
	m.tube(0, TUBE_Y, 0.41, 0.0118, 0.445, 0.011, 8, STEEL, 0, [1]);
	m.section(0.4, [0.0055, TUBE_Y, -0.006], 0.44, [0.0055, TUBE_Y, -0.006], STEEL, 0, [0, 1], [0]);

	// THE STOCK: down from the back of the receiver to the butt (64), and its recoil pad (22)
	const stock = [[-0.2, [0.016, -0.042, 0.014]], [-0.235, [0.0165, -0.06, 0.006]], [-0.29, [0.0175, -0.083, -0.006]], [-0.42, [0.019, -0.13, -0.014]], [-0.555, [0.0205, -0.168, -0.019]]];
	m.loft(stock.map(([z, r]) => m.across(z, r, 0.007)), WOOD);
	m.loft([m.across(-0.555, [0.0205, -0.168, -0.019], 0.007), m.across(-0.58, [0.021, -0.171, -0.018], 0.008)], RUBBER, 0, [1]);

	// THE FOREND round the tube, that slides back and forward, its grooves (76), and the action bars from it back along the receiver (24)
	const forend = [[0.07, 0.0185], [0.13, 0.0205], [0.17, 0.0188], [0.22, 0.0205], [0.3, 0.0185]];
	m.loft(forend.map(([z, h]) => m.across(z, [h, -0.05 - (h - 0.0185), -0.012], 0.008)), WOOD, 1, [0, 1]);
	for (const s of [1, -1]) m.prismZ([[s * 0.0168, -0.041], [s * 0.0188, -0.041], [s * 0.0188, -0.035], [s * 0.0168, -0.035]], -0.03, 0.08, STEEL, 1);

	// two shells, each made with its head at the origin and its crimp along +z: the hull (12) and its crimp closed (4), the brass head (16)
	for (const part of [3, 4]) {
		m.tube(0, 0, 0.011, 0.0105, SHELL, 0.0105, 6, HULL, part, [1]);
		m.tube(0, 0, 0, 0.0112, 0.011, 0.0109, 6, BRASS, part, [0]);
	}
	return { data: m.done(), triangles: m.count() };
})();
export const SHOTGUN_TRIANGLES = SHOTGUN_MESH.triangles;
const view = new vm.Viewmodel('Shotgun', SHOTGUN_MESH.data);

// What it is doing
//-------------------------------------------------
const gun = {
	state: 'ready', timer: 0, aimed: 0, wantsAim: false, kick: 0, bob: 0, trigger: 0,
	tube: TUBE,
	chamber: 'live',				// 'live', 'spent' (a fired hull) or 'empty'
	pump: 0, pumpWanted: 0,			// drawn back, 0 to 1, and how far the wheel has asked for
	stripped: false,				// back all the way since it was last forward: going forward, it takes a shell off the tube
	dropped: false,					// a shell put straight into the open chamber: closing does not take another
	loading: -1, queued: 0, sinceLoad: 99, shown: 0, intoChamber: false,
	eject: null,					// the shell thrown out: { t, live }
	message: '', messageAge: 99,
};
export const shotgunStats = { shots: 0, ejected: 0, loaded: 0, triangles: SHOTGUN_TRIANGLES };
let triggerAsked = false, wheelPixels = 0, loadsAsked = 0;
let lastTime = performance.now();
const active = () => weapons.holding('shotgun');
const locked = () => document.pointerLockElement == canvas;
const say = (text) => { gun.message = text; gun.messageAge = 0; };

window.addEventListener('mousedown', (event) => {
	if (!active() || !locked() || hunting.input.menuOpen) return;
	if (event.button == 0) triggerAsked = true;
	if (event.button == 2) gun.wantsAim = true;
});
window.addEventListener('mouseup', (event) => { if (event.button == 2) gun.wantsAim = false; });
window.addEventListener('wheel', (event) => {
	if (!active() || !locked() || hunting.input.menuOpen || hunting.crosshair.onRope) return;
	wheelPixels += vm.wheelPixels(event);
	event.preventDefault();
}, { passive: false });
window.addEventListener('keydown', (event) => {
	if (active() && locked() && !hunting.input.menuOpen && event.code == 'KeyR' && !event.repeat) loadsAsked++;
});
document.addEventListener('pointerlockchange', () => { if (!locked()) gun.wantsAim = false; });

weapons.addWeapon('shotgun', { label: 'Mossberg 500', detail: 'Pump shotgun, 12 bore buckshot, 4 + 1', equip: () => { gun.aimed = 0; },
	loaded: () => gun.tube + (gun.chamber == 'live' ? 1 : 0) + (gun.loading >= 0 ? 1 : 0) + gun.queued, reset: () => resetShotgun(), drawn: () => drawShotgun(),
	help: () => ['Mossberg 500', [
		['Left click', 'fire (the pump all the way forward)'],
		['Right click', 'aim along the rib (hold)'],
		['Wheel down, up', 'pump: back throws out the shell, forward chambers the next'],
		['R', 'push a shell into the tube (with the action open and the chamber empty: into the chamber)'],
	]] });

export function resetShotgun() {
	Object.assign(gun, { state: 'ready', timer: 0, aimed: 0, kick: 0, trigger: 0, tube: TUBE, chamber: 'live', pump: 0, pumpWanted: 0, stripped: false, dropped: false,
		loading: -1, queued: 0, sinceLoad: 99, shown: 0, eject: null });
	triggerAsked = false; wheelPixels = loadsAsked = 0;
}

// Once a frame, after the walker has moved
//-------------------------------------------------
export function shotgunUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	advance(elapsed);
	showAmmo();
}

function advance(elapsed) {
	if (!active()) {
		triggerAsked = false; wheelPixels = loadsAsked = 0;
		gun.aimed = 0;
		return;
	}
	const g = gun;
	g.timer += elapsed;
	g.messageAge += elapsed;
	const place = hunting.hunterPlace();
	g.bob += elapsed * (place.grounded ? Math.hypot(place.vx ?? 0, place.vz ?? 0) / settings.forestUnitsPerMetre * 3.2 : 0);

	// the trigger
	if (g.state == 'ready') {
		if (triggerAsked) {
			if (g.pump > 0 || g.pumpWanted > 0) say('Push the pump forward to close the action');
			else { g.state = 'trigger'; g.timer = 0; }
		}
	} else if (g.state == 'trigger') {
		g.trigger = vm.clamp01(g.timer / TRIGGER_SECONDS);
		if (g.timer >= TRIGGER_SECONDS) {
			if (g.chamber == 'live') {
				vm.shoot({ muzzle: [0, 0, MUZZLE], gun: gunMatrix(), aimed: g.aimed, sight: SIGHT_HEIGHT, zero: ZERO, spread: HIP_SPREAD, round: '00 buck', pellets: PELLETS, choke: CHOKE });
				shotgunStats.shots++;
				g.chamber = 'spent';
				g.kick = 1;
				settings.camPitch = Math.min(settings.camPitch + 0.035, Math.PI * 0.5 - 0.02);
			} else {
				weapons.actionSound('click');
				say(g.chamber == 'spent' ? 'Click. Work the pump' : 'Click. Nothing in the chamber');
			}
			g.state = 'recoil'; g.timer = 0;
		}
	} else if (g.state == 'recoil') {
		g.trigger = 1 - vm.clamp01(g.timer / RECOIL_SECONDS);
		if (g.timer >= RECOIL_SECONDS) { g.trigger = 0; g.state = 'ready'; g.timer = 0; }
	}
	triggerAsked = false;

	// R: a shell at a time, into the tube (or the open, empty chamber)
	for (; loadsAsked > 0; loadsAsked--) {
		const open = g.pump == 1 && g.pumpWanted == 1;
		const intoChamber = open && g.chamber == 'empty' && !g.dropped && g.queued == 0 && g.loading < 0;
		if (!intoChamber && g.tube + g.queued + (g.loading >= 0 && !g.intoChamber ? 1 : 0) >= TUBE) say(open ? 'The tube is full' : 'The tube is full: open the action to drop one in the chamber');
		else if (!weapons.takeRound('shotgun')) say(weapons.noAmmoWord);
		else if (intoChamber) { g.dropped = true; g.intoChamber = true; g.loading = 0; }
		else g.queued++;
	}
	if (g.loading < 0 && g.queued > 0) { g.loading = 0; g.queued--; g.intoChamber = false; }
	if (g.loading >= 0) {
		g.loading += elapsed;
		if (g.loading >= LOAD_SECONDS) {
			if (g.intoChamber) { g.chamber = 'live'; g.stripped = false; }
			else g.tube++;
			g.loading = -1;
			g.intoChamber = false;
			g.sinceLoad = 0;
			shotgunStats.loaded++;
			weapons.actionSound('load');
		}
	}
	g.sinceLoad += elapsed;

	// the pump, from the wheel: down draws it back, up pushes it forward. Not while a shell is going in
	const busy = g.loading >= 0 || g.queued > 0;
	if (!busy && g.state != 'trigger') g.pumpWanted = vm.clamp01(g.pumpWanted + wheelPixels / PUMP_PIXELS);
	wheelPixels = 0;
	const was = g.pump;
	g.pump = vm.toward(g.pump, g.pumpWanted, elapsed / PUMP_SECONDS);
	if ((g.pump == 1 && was < 1) || (g.pump == 0 && was > 0)) weapons.actionSound('pump');
	if (g.pump == 1 && was < 1) {
		// all the way back: out comes whatever is in the chamber
		if (g.chamber != 'empty') {
			g.eject = { t: 0, live: g.chamber == 'live' };
			shotgunStats.ejected++;
			const live = g.chamber == 'live';
			g.chamber = 'empty';
			if (live) weapons.giveRound('shotgun');
		}
		g.stripped = true;
		g.dropped = false;
	}
	if (g.pump == 0 && was > 0) {
		// all the way forward: the next shell off the tube, unless one was dropped in
		if (g.stripped && g.chamber == 'empty' && g.tube > 0) { g.tube--; g.chamber = 'live'; }
		g.stripped = false;
		g.dropped = false;
	}
	if (g.eject) { g.eject.t += elapsed; if (g.eject.t > EJECT_SECONDS) g.eject = null; }

	// rolled over to show the loading port while shells go in, and up to the eye while the right button is held
	const loadingPose = g.loading >= 0 || g.queued > 0 || g.sinceLoad < SHOW_HOLD;
	g.shown = vm.toward(g.shown, loadingPose ? 1 : 0, elapsed / SHOW_SECONDS);
	g.aimed = vm.clamp01(g.aimed + (g.wantsAim && !loadingPose ? 1 : -1) * elapsed / AIM_SECONDS);
	g.kick *= Math.exp(-elapsed * 10);
	hunting.crosshair.hidden = g.aimed > 0.3;
}

function gunMatrix() {
	const shown = vm.ease(gun.shown);
	const pushing = gun.loading >= 0 ? Math.sin(Math.PI * vm.clamp01((gun.loading / LOAD_SECONDS - 0.15) / 0.7)) : 0;
	return vm.holdMatrix(HIP, AIM, { aimed: gun.aimed, bob: gun.bob, kick: gun.kick, kickBack: 0.07, kickUp: 0.2, roll: 1.2 * shown, tilt: 0.25 * shown, drop: 0.04 * shown + 0.01 * pushing });
}

// where each moving part is (see THE GUN at the top)
function partsNow() {
	const g = gun;
	const parts = [];
	parts[1] = mat4.translation([0, 0, -PUMP_TRAVEL * g.pump]);
	parts[2] = mat4.translation([0, 0, -0.006 * g.trigger]);
	// the shell in the chamber, drawn back with the bolt; or one rising off the tube as the pump goes forward; or thrown out
	let A = vm.HIDDEN;
	const feeding = g.chamber == 'empty' && g.stripped && g.tube > 0 && g.pump < 1;
	if (g.chamber != 'empty') {
		A = mat4.translation([0, 0, CHAMBER_Z - PUMP_TRAVEL * g.pump]);
	} else if (feeding) {
		const rise = vm.ease((1 - g.pump) / 0.6);
		A = mat4.translation([0, TUBE_Y * (1 - rise), CHAMBER_Z - PUMP_TRAVEL * g.pump]);
	} else if (g.eject) {
		const t = g.eject.t;
		A = mat4.translation([0.05 + 1.1 * t, 0.02 + 1.4 * t - 4.9 * t * t, CHAMBER_Z - PUMP_TRAVEL - 0.3 * t]);
		A = mat4.rotateX(mat4.rotateY(A, 7 * t), -16 * t);
	}
	parts[3] = A;
	// the shell going in: up from under the gun into the port, and forward into the tube (or up into the chamber)
	let B = vm.HIDDEN;
	if (g.loading >= 0) {
		const k = g.loading / LOAD_SECONDS;
		const up = vm.ease(k / 0.5), on = vm.ease((k - 0.5) / 0.5);
		const y = -0.13 + (TUBE_Y + 0.13) * up, z = -0.11 + (g.intoChamber ? 0.04 : 0.11) * on;
		B = mat4.translation([0, g.intoChamber ? y + (0 - TUBE_Y) * on : y, z]);
		if (on >= 1 && !g.intoChamber) B = vm.HIDDEN;
	}
	parts[4] = B;
	return parts;
}

function drawShotgun() {
	view.draw(gunMatrix(), partsNow());
}

// The ammunition, in the bottom right
//-------------------------------------------------
const box = vm.ammoBox();
let shown = '';
function nextStep() {
	const g = gun;
	if (g.state != 'ready') return '';
	if (g.loading >= 0 || g.queued > 0) return 'Loading';
	if (g.pump == 1) return g.chamber == 'live' ? 'Scroll up to close the action' : g.tube > 0 ? 'Scroll up to chamber the next shell' : 'R to load · scroll up to close';
	if (g.pump > 0) return 'Keep scrolling';
	if (g.chamber == 'live') return 'Ready to fire';
	if (g.chamber == 'spent') return 'Scroll down, then up, to pump';
	return g.tube > 0 ? 'Scroll down, then up, to chamber a shell' : 'R to load the tube';
}
function showAmmo() {
	const on = active() && hunting.hunterPlace().active;
	box.style.display = on ? '' : 'none';
	if (!on) return;
	const g = gun;
	const message = g.messageAge < MESSAGE_SECONDS ? g.message : '';
	const key = [g.tube, g.chamber, g.pump == 1, nextStep(), message, weapons.carried('shotgun')].join('|');
	if (key == shown) return;
	shown = key;
	let tube = '';
	for (let k = 0; k < TUBE; k++) tube += vm.shellIcon(k < TUBE - g.tube ? 'empty' : 'live');
	box.innerHTML = vm.ammoHtml({ count: g.tube + (g.chamber == 'live' ? 1 : 0), carried: weapons.carried('shotgun'),
		groups: [{ icons: tube, label: 'TUBE' }, { icons: vm.shellIcon(g.chamber), label: 'CHAMBER' }],
		state: g.pump > 0 ? 'ACTION OPEN' : 'ACTION CLOSED', next: nextStep(), message });
}

// for testing: the trigger, the sights, the wheel (pixels, down +), R, and moved on by a number of seconds
export function testShotgun({ fire = false, aim = null, wheel = 0, load = 0, seconds = 0 } = {}) {
	if (fire) triggerAsked = true;
	if (aim !== null) gun.wantsAim = aim;
	wheelPixels += wheel;
	loadsAsked += load;
	for (let done = 0; done < seconds; done += 1 / 60) advance(1 / 60);
	showAmmo();
	return { tube: gun.tube, chamber: gun.chamber, pump: gun.pump, state: gun.state, aimed: gun.aimed, message: gun.message, carried: weapons.carried('shotgun'), ...shotgunStats };
}

// for testing: the gun drawn where a matrix puts it (in the camera's space), as it is now
export function inspectShotgun(matrix) { view.draw(matrix, partsNow()); }
