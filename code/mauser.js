import {canvas} from './deviceSelection.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as vm from './viewmodel.js'

/*
	THE BROOMHANDLE: a Mauser C96, 7.63x25mm Mauser, its magazine in front of the trigger guard (MAGAZINE), loaded from the top
	with a stripper clip of ten, its grip the round grooved broomhandle it is named for.
		left click			fire. It loads itself: the recoil throws the bolt back (the case out to the right), and it comes
							forward with the next round off the magazine. After the last one the bolt stays back (the hold open)
		right click (held)	aim, along the notch of the rear sight to the blade at the muzzle
		middle click		the bolt: pull it back by its ears (it throws out whatever is in the chamber, a live round too, and
							stays back), or let it go forward again (it takes the top round off the magazine into the chamber)
		R					with the bolt back, a clip of ten into the guides, the rounds thumbed down into the magazine, the clip
							pulled out: and the bolt goes forward on the first of them by itself. Topping up a magazine that is not
							empty takes only as many as it has room for
	Each round put in is one of those carried (weapons.js: 40 all told); a live one thrown out goes back to them.

	THE GUN (MAUSER_MESH): MAUSER_TRIANGLES (no more than 400), in metres, the bore along +z (as the rifle's), +x to the right. The
	parts:
		0	the frame (the magazine's housing in front of the trigger guard, open on top under the bolt way, the frame under the
			barrel, the frame over the grip), the barrel extension's sides along the bolt way and its top in front of it, the
			tangent rear sight on that, the barrel and the dark of its bore, the front sight's blade, the trigger guard, and the grip:
			the broomhandle, lofted through rings with grooves between them
		1	the bolt, square, in the barrel extension, and its knurled ears out of the back of it either side
		2	the ring hammer behind it, cocked back by the bolt			3	the trigger
		4	the stripper clip			5	the ten rounds in it, as one block (their cases and their bullets: it is
										made shorter for fewer)
		6	the top round in the magazine, seen with the bolt back		7	a case: in the chamber, on the bolt's face, thrown out
		8	that round's bullet
*/
const SIGHT_HEIGHT = 0.026;			// the rear sight's notch and the front sight's blade over the bore, metres
const ZERO = 25;
const MUZZLE = 0.14;
const HIP_SPREAD = 0.022;
const MAGAZINE = 10;
const TRIGGER_SECONDS = 0.09;
const RECOIL_SECONDS = 0.16;		// the trigger let go again after a shot
const CYCLE_SECONDS = 0.06;			// the bolt back or forward on the recoil
const HAND_SECONDS = 0.16;			// by hand
const CLIP_SECONDS = 1.5;			// a clip in, thumbed down and pulled out
const AIM_SECONDS = 0.18;
const EJECT_SECONDS = 0.7;
const MESSAGE_SECONDS = 1.6;
const BOLT_TRAVEL = 0.05;			// metres the bolt goes back
const CHAMBER_Z = -0.036;			// a round's base in the chamber
const CASE_LENGTH = 0.025, ROUND_LENGTH = 0.035;
const MAG_REAR = -0.083;			// the base of the magazine's top round
const MAG_Y = -0.006;				// its middle
const STACK = 0.085;				// ten rounds, stacked in the clip
const CLIP_Y = -0.002;				// the clip's bottom, in its guides

const HIP = { x: 0.12, y: -0.13, z: -0.32, yaw: 0.06, pitch: 0.02 };
const LOADING = { x: 0.03, y: -0.1, z: -0.3, yaw: -0.3, pitch: 0.38, roll: -0.3 };	// the clip going in: up, its top tipped to the eye
const AIM = { x: 0, y: -SIGHT_HEIGHT, z: -0.38, yaw: 0, pitch: 0 };

// The gun (see THE GUN at the top)
//-------------------------------------------------
const WOOD = 0, BLUED = 1, BRASS = 2, LEAD = 3, DARK = 9;
const MAUSER_MESH = (() => {
	const m = vm.meshBuilder();
	// THE FRAME: the magazine's housing, open on top (10), the frame under the barrel (10), the frame over the grip, under the bolt (10)
	m.section(-0.09, [0.0105, -0.07, -0.007], -0.035, [0.0105, -0.068, -0.007], BLUED, 0, [0, 1], [2]);
	m.section(-0.035, [0.0105, -0.024, -0.007], 0.004, [0.0095, -0.018, -0.007], BLUED, 0, [1]);
	m.section(-0.14, [0.0105, -0.03, -0.007], -0.09, [0.0105, -0.03, -0.007], BLUED, 0, [0]);
	// the barrel extension: its sides along the bolt way (4), its top in front of it (6), the tangent rear sight on that (12) and the
	//		leaf with its notch (6)
	m.section(-0.12, [0.0115, -0.007, 0.017], CHAMBER_Z, [0.0115, -0.007, 0.017], BLUED, 0, [], [0, 2]);
	m.section(CHAMBER_Z, [0.0115, -0.007, 0.017], 0.0, [0.0115, -0.007, 0.017], BLUED, 0, [], [0]);
	m.prismX([[-0.032, 0.017], [-0.004, 0.017], [-0.004, 0.0205], [-0.028, 0.0222]], -0.006, 0.006, BLUED);
	const zr = -0.027, H = SIGHT_HEIGHT;
	m.quad([-0.0065, 0.02, zr], [0.0065, 0.02, zr], [0.0065, H, zr], [-0.0065, H, zr], 0, BLUED);
	m.quad([-0.0065, H, zr], [-0.0013, H, zr], [-0.0013, H + 0.0035, zr], [-0.0065, H + 0.0035, zr], 0, BLUED);
	m.quad([0.0013, H, zr], [0.0065, H, zr], [0.0065, H + 0.0035, zr], [0.0013, H + 0.0035, zr], 0, BLUED);
	// the barrel and the dark of its bore (20), the front sight's blade (12)
	m.tube(0, 0, 0, 0.0085, MUZZLE, 0.0074, 8, BLUED);
	m.disc(0, 0, MUZZLE + 0.0003, 0.0035, 6, DARK);
	m.prismX([[MUZZLE - 0.014, 0.007], [MUZZLE - 0.003, 0.007], [MUZZLE - 0.005, H], [MUZZLE - 0.011, H]], -0.0012, 0.0012, BLUED);
	// the trigger guard (24)
	const bow = [[0, -0.03, -0.09], [0, -0.056, -0.098], [0, -0.057, -0.118], [0, -0.034, -0.129]];
	for (let k = 0; k < bow.length - 1; k++) m.strut(bow[k], bow[k + 1], 0.0028, 0.0028, 4, BLUED);
	// THE GRIP, down and back from the frame: oval rings across it, the grooves between them, its foot closed (100)
	const top = [0, -0.026, -0.124], foot = [0, -0.118, -0.148];
	const d = [0, foot[1] - top[1], foot[2] - top[2]], dl = Math.hypot(...d);
	const w = [0, -d[2] / dl, d[1] / dl];
	const oval = (s) => Array.from({ length: 6 }, (_, k) => { const a = (k + 0.5) / 6 * Math.PI * 2; return [Math.cos(a) * 0.0128 * s, Math.sin(a) * 0.0158 * s]; });
	const grip = [[0, 1], [0.1, 1], [0.22, 0.88], [0.34, 1], [0.46, 0.88], [0.58, 1], [0.7, 0.88], [0.85, 1.02], [1, 1.07]];
	m.loft(grip.map(([t, s]) => m.ringAt([0, top[1] + d[1] * t, top[2] + d[2] * t], [1, 0, 0], w, oval(s))), WOOD, 0, [1]);

	// THE MOVING PARTS
	// the bolt (12), and its ears either side at the back (24)
	m.section(-0.132, [0.0085, -0.004, 0.0125], CHAMBER_Z, [0.0085, -0.004, 0.0125], BLUED, 1, [0, 1]);
	for (const s of [1, -1]) m.prismZ([[s * 0.0085, 0.001], [s * 0.0138, 0.001], [s * 0.0138, 0.011], [s * 0.0085, 0.011]], -0.133, -0.122, BLUED, 1);
	// the ring hammer: its stem up from the pivot (6), and the ring (30)
	const ring = Array.from({ length: 6 }, (_, k) => { const a = k / 5 * Math.PI * 2; return [0, 0.006 + Math.cos(a) * 0.0075, -0.144 - Math.sin(a) * 0.0075]; });
	m.strut([0, -0.009, -0.137], [0, -0.0015, -0.143], 0.0025, 0.0025, 3, BLUED, 2);
	for (let k = 0; k < 5; k++) m.strut(ring[k], ring[k + 1], 0.0019, 0.0019, 3, BLUED, 2);
	// the trigger (12)
	m.prismX([[-0.1, -0.03], [-0.108, -0.03], [-0.112, -0.048], [-0.105, -0.049]], -0.0017, 0.0017, BLUED, 3);
	// the stripper clip (12), made with its bottom at the origin, behind the rims of the rounds
	m.prismZ([[-0.0048, 0], [0.0048, 0], [0.0048, STACK + 0.003], [-0.0048, STACK + 0.003]], -0.003, 0, BLUED, 4);
	// the ten rounds in it, one block: their cases (12) and their bullets (12), from their rims at z 0, the bottom one at y 0
	const block = (outline, material) => m.loft([outline.map(([x, z]) => [x, 0, z]), outline.map(([x, z]) => [x, STACK, z])], material, 5, [0, 1]);
	block([[-0.0042, 0], [0.0042, 0], [0.0042, CASE_LENGTH], [-0.0042, CASE_LENGTH]], BRASS);
	block([[-0.0042, CASE_LENGTH], [0.0042, CASE_LENGTH], [0.0012, ROUND_LENGTH], [-0.0012, ROUND_LENGTH]], LEAD);
	// a round (the top one in the magazine) (18), a case (10) and its bullet (8), their bases at the origin along +z
	m.tube(0, 0, 0, 0.0042, CASE_LENGTH, 0.0042, 4, BRASS, 6, [0]);
	m.tube(0, 0, CASE_LENGTH, 0.0042, ROUND_LENGTH, 0.0012, 4, LEAD, 6);
	m.tube(0, 0, 0, 0.0042, CASE_LENGTH, 0.0042, 4, BRASS, 7, [0]);
	m.tube(0, 0, CASE_LENGTH, 0.0042, ROUND_LENGTH, 0.0012, 4, LEAD, 8);
	return { data: m.done(), triangles: m.count() };
})();
export const MAUSER_TRIANGLES = MAUSER_MESH.triangles;
const view = new vm.Viewmodel('Mauser', MAUSER_MESH.data);

// What it is doing
//-------------------------------------------------
const gun = {
	state: 'ready', timer: 0, aimed: 0, wantsAim: false, kick: 0, bob: 0, trigger: 0,
	magazine: MAGAZINE - 1,
	chamber: 'live',				// 'live', 'spent' or 'empty'
	bolt: 0, boltWanted: 0,			// back, 0 to 1, and where it is going
	boltSeconds: CYCLE_SECONDS,		// how long it takes, the whole way (the recoil's, or a hand's)
	stripped: false,				// it has been all the way back since it was last forward: going forward, it takes the top round
	hammer: 1,						// 1 cocked, 0 down
	clip: -1, clipRounds: 0,		// seconds into a clip going in (-1 when not), and how many rounds are in it
	eject: null,					// the case (or round) thrown out: { t, live }
	message: '', messageAge: 99,
};
export const mauserStats = { shots: 0, ejected: 0, clips: 0, triangles: MAUSER_TRIANGLES };
let triggerAsked = false, middleAsked = false, clipAsked = false;
let lastTime = performance.now();
const active = () => weapons.holding('mauser');
const locked = () => document.pointerLockElement == canvas;
const say = (text) => { gun.message = text; gun.messageAge = 0; };

window.addEventListener('mousedown', (event) => {
	if (!active() || !locked() || hunting.input.menuOpen) return;
	if (event.button == 0) triggerAsked = true;
	if (event.button == 1) { middleAsked = true; event.preventDefault(); }
	if (event.button == 2) gun.wantsAim = true;
});
window.addEventListener('mouseup', (event) => { if (event.button == 2) gun.wantsAim = false; });
window.addEventListener('keydown', (event) => {
	if (active() && locked() && !hunting.input.menuOpen && event.code == 'KeyR' && !event.repeat) clipAsked = true;
});
document.addEventListener('pointerlockchange', () => { if (!locked()) gun.wantsAim = false; });

weapons.addWeapon('mauser', { label: 'Broomhandle Mauser', detail: 'C96 pistol, 7.63×25 Mauser, ten from a stripper clip', equip: () => { gun.aimed = 0; },
	loaded: () => gun.magazine + (gun.chamber == 'live' ? 1 : 0) + (gun.clip >= 0 ? gun.clipRounds : 0), reset: () => resetMauser(), drawn: () => drawMauser(),
	help: () => ['Mauser C96', [
		['Left click', 'fire (it loads the next itself)'],
		['Right click', 'aim (hold)'],
		['Middle click', 'pull the bolt back, or let it go forward'],
		['R', 'bolt back: a clip of ten into the magazine'],
	]] });

export function resetMauser() {
	Object.assign(gun, { state: 'ready', timer: 0, aimed: 0, kick: 0, trigger: 0, magazine: MAGAZINE - 1, chamber: 'live', bolt: 0, boltWanted: 0, boltSeconds: CYCLE_SECONDS,
		stripped: false, hammer: 1, clip: -1, clipRounds: 0, eject: null });
	triggerAsked = middleAsked = clipAsked = false;
}

// Once a frame
//-------------------------------------------------
export function mauserUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	advance(elapsed);
	showAmmo();
}

function advance(elapsed) {
	if (!active()) {
		triggerAsked = middleAsked = clipAsked = false;
		gun.aimed = 0;
		return;
	}
	const g = gun;
	g.timer += elapsed;
	g.messageAge += elapsed;
	const place = hunting.hunterPlace();
	g.bob += elapsed * (place.grounded ? Math.hypot(place.vx ?? 0, place.vz ?? 0) / settings.forestUnitsPerMetre * 3.2 : 0);
	const open = g.bolt > 0 || g.boltWanted > 0;

	// the trigger: the hammer falls on what is in the chamber, and the recoil works the bolt
	if (g.state == 'ready') {
		if (triggerAsked) {
			if (g.clip >= 0) say('Wait for the clip');
			else if (open) say(g.magazine > 0 ? 'Let the bolt go forward first (middle click)' : 'The magazine is empty: R to load a clip');
			else { g.state = 'trigger'; g.timer = 0; }
		}
	} else if (g.state == 'trigger') {
		g.trigger = vm.clamp01(g.timer / TRIGGER_SECONDS);
		if (g.timer >= TRIGGER_SECONDS) {
			g.hammer = 0;
			if (g.chamber == 'live') {
				vm.shoot({ muzzle: [0, 0, MUZZLE], gun: gunMatrix(), aimed: g.aimed, sight: SIGHT_HEIGHT, zero: ZERO, spread: HIP_SPREAD, round: '7.63 Mauser' });
				mauserStats.shots++;
				g.chamber = 'spent';
				g.kick = 1;
				settings.camPitch = Math.min(settings.camPitch + 0.02, Math.PI * 0.5 - 0.02);
				// the recoil throws the bolt back
				g.boltWanted = 1;
				g.boltSeconds = CYCLE_SECONDS;
			} else {
				weapons.actionSound('click');
				say('Click. The chamber is empty: pull the bolt back');
			}
			g.state = 'recoil'; g.timer = 0;
		}
	} else if (g.state == 'recoil') {
		g.trigger = 1 - vm.clamp01(g.timer / RECOIL_SECONDS);
		if (g.timer >= RECOIL_SECONDS) { g.trigger = 0; g.state = 'ready'; g.timer = 0; }
	}
	triggerAsked = false;

	// the middle button: the bolt back by hand, or let go forward
	if (middleAsked && g.clip < 0 && g.state == 'ready') {
		g.boltWanted = g.boltWanted > 0 ? 0 : 1;
		g.boltSeconds = HAND_SECONDS;
		weapons.actionSound('bolt');
	}
	middleAsked = false;

	// R: a clip, with the bolt held back
	if (clipAsked) {
		if (g.clip >= 0) {}
		else if (g.bolt < 1 || g.boltWanted < 1) say('Pull the bolt back first (middle click)');
		else if (g.magazine >= MAGAZINE) say('The magazine is full');
		else {
			let rounds = 0;
			while (rounds < MAGAZINE - g.magazine && weapons.takeRound('mauser')) rounds++;
			if (rounds == 0) say(weapons.noAmmoWord);
			else { g.clip = 0; g.clipRounds = rounds; weapons.actionSound('clip'); }
		}
	}
	clipAsked = false;
	if (g.clip >= 0) {
		g.clip += elapsed;
		if (g.clip >= CLIP_SECONDS) {
			// thumbed down into the magazine, the clip pulled out: and the bolt goes forward
			g.magazine += g.clipRounds;
			g.clip = -1;
			g.clipRounds = 0;
			mauserStats.clips++;
			g.boltWanted = 0;
			g.boltSeconds = CYCLE_SECONDS * 1.5;
			weapons.actionSound('bolt');
		}
	}

	// the bolt: all the way back, out comes whatever is in the chamber; all the way forward, the top round goes in. Thrown back by the
	//		recoil it comes forward again by itself, unless the magazine is empty (the hold open)
	const was = g.bolt;
	g.bolt = vm.toward(g.bolt, g.boltWanted, elapsed / g.boltSeconds);
	if (g.bolt > 0.3) g.hammer = 1;
	if (g.bolt == 1 && was < 1) {
		if (g.chamber != 'empty') {
			const live = g.chamber == 'live';
			g.eject = { t: 0, live };
			mauserStats.ejected++;
			if (live) weapons.giveRound('mauser');
		}
		g.chamber = 'empty';
		g.stripped = true;
		if (g.boltSeconds == CYCLE_SECONDS && g.magazine > 0) g.boltWanted = 0;
	}
	if (g.bolt == 0 && was > 0) {
		if (g.stripped && g.chamber == 'empty' && g.magazine > 0) { g.magazine--; g.chamber = 'live'; }
		g.stripped = false;
	}
	if (g.eject) { g.eject.t += elapsed; if (g.eject.t > EJECT_SECONDS) g.eject = null; }

	g.aimed = vm.clamp01(g.aimed + (g.wantsAim && g.clip < 0 ? 1 : -1) * elapsed / AIM_SECONDS);
	g.kick *= Math.exp(-elapsed * 14);
	hunting.crosshair.hidden = g.aimed > 0.3;
}

// where it is held: brought up and tipped to show its top while a clip goes in (LOADING)
function gunMatrix() {
	const k = gun.clip >= 0 ? vm.ease(Math.min(gun.clip / 0.3, (CLIP_SECONDS - gun.clip) / 0.3, 1)) : 0;
	const hold = Object.fromEntries(Object.keys(HIP).map((key) => [key, HIP[key] + (LOADING[key] - HIP[key]) * k]));
	return vm.holdMatrix(hold, AIM, { aimed: gun.aimed, bob: gun.bob, kick: gun.kick, kickBack: 0.035, kickUp: 0.28, roll: LOADING.roll * k });
}

// The parts as they are now (see THE GUN at the top)
//-------------------------------------------------
function partsNow() {
	const g = gun;
	const parts = [];
	const back = -BOLT_TRAVEL * g.bolt;
	parts[1] = mat4.translation([0, 0, back]);
	const pivot = [0, -0.009, -0.137];
	parts[2] = mat4.multiply(mat4.translation(pivot), mat4.multiply(mat4.rotationX(-0.75 * g.hammer + 0.25), mat4.translation(pivot.map((v) => -v))));
	parts[3] = mat4.translation([0, 0, -0.006 * g.trigger]);
	// the clip: down into its guides, the rounds thumbed down out of it into the magazine, and pulled out again
	let clip = vm.HIDDEN, stack = vm.HIDDEN;
	if (g.clip >= 0) {
		const k = g.clip / CLIP_SECONDS;
		const into = 0.07 * (1 - vm.ease(k / 0.25)), out = 0.09 * vm.ease((k - 0.82) / 0.18);
		const down = STACK * g.clipRounds / MAGAZINE * vm.ease((k - 0.3) / 0.45);
		clip = mat4.translation([0, CLIP_Y + into + out, MAG_REAR]);
		stack = mat4.scale(mat4.translation([0, CLIP_Y + into - down, MAG_REAR]), [1, g.clipRounds / MAGAZINE, 1]);
		if (k > 0.8) stack = vm.HIDDEN;
	}
	parts[4] = clip;
	parts[5] = stack;
	// the top round in the magazine, seen with the bolt back
	const feeding = g.chamber == 'empty' && g.stripped && g.magazine > 0 && g.bolt < 1;
	parts[6] = g.magazine - (feeding ? 1 : 0) > 0 && g.bolt > 0.6 ? mat4.translation([0, MAG_Y, MAG_REAR]) : vm.HIDDEN;
	// the round or case on the bolt's face: the one in the chamber drawn back with it, the top one off the magazine rising into the
	//		chamber, or thrown out up and to the right, tumbling
	let round = vm.HIDDEN, bullet = false;
	if (g.chamber != 'empty') {
		round = mat4.translation([0, 0, CHAMBER_Z + back]);
		bullet = g.chamber == 'live';
	} else if (feeding) {
		const rise = vm.ease((1 - g.bolt) / 0.5);
		round = mat4.translation([0, MAG_Y * (1 - rise), CHAMBER_Z + back]);
		bullet = true;
	} else if (g.eject) {
		const t = g.eject.t;
		round = mat4.translation([0.01 + 0.9 * t, 0.012 + 1.5 * t - 4.9 * t * t, CHAMBER_Z - BOLT_TRAVEL - 0.25 * t]);
		round = mat4.rotateX(mat4.rotateY(round, 9 * t), -18 * t);
		bullet = g.eject.live;
	}
	parts[7] = round;
	parts[8] = bullet ? round : vm.HIDDEN;
	return parts;
}

function drawMauser() {
	view.draw(gunMatrix(), partsNow());
}

// The ammunition, in the bottom right
//-------------------------------------------------
const box = vm.ammoBox();
let shown = '';
function nextStep() {
	const g = gun;
	if (g.clip >= 0) return 'Loading a clip';
	if (g.state != 'ready') return '';
	if (g.bolt > 0 || g.boltWanted > 0) {
		if (g.bolt < 1) return '';
		return g.magazine < MAGAZINE ? 'R to load a clip · middle click to let the bolt go' : 'Middle click to let the bolt go forward';
	}
	if (g.chamber == 'live') return 'Ready to fire';
	return g.magazine > 0 ? 'Middle click to pull the bolt back' : 'Middle click to pull the bolt back, then R';
}
function showAmmo() {
	const on = active() && hunting.hunterPlace().active;
	box.style.display = on ? '' : 'none';
	if (!on) return;
	const g = gun;
	const message = g.messageAge < MESSAGE_SECONDS ? g.message : '';
	const key = [g.magazine, g.chamber, g.bolt > 0, g.clip >= 0, nextStep(), message, weapons.carried('mauser')].join('|');
	if (key == shown) return;
	shown = key;
	let magazine = '';
	for (let k = 0; k < MAGAZINE; k++) magazine += vm.roundIcon(k < MAGAZINE - g.magazine ? 'empty' : 'live', 22);
	box.innerHTML = vm.ammoHtml({ count: g.magazine + (g.chamber == 'live' ? 1 : 0), carried: weapons.carried('mauser'),
		groups: [{ icons: magazine, label: 'MAGAZINE' }, { icons: vm.roundIcon(g.chamber, 22), label: 'CHAMBER' }],
		state: g.bolt > 0 ? 'BOLT BACK' : 'BOLT FORWARD', next: nextStep(), message });
}

// for testing: the trigger, the sights, the middle button, R, moved on by a number of seconds
export function testMauser({ fire = false, aim = null, middle = false, clip = false, seconds = 0 } = {}) {
	if (fire) triggerAsked = true;
	if (aim !== null) gun.wantsAim = aim;
	if (middle) middleAsked = true;
	if (clip) clipAsked = true;
	for (let done = 0; done < seconds; done += 1 / 60) advance(1 / 60);
	showAmmo();
	return { magazine: gun.magazine, chamber: gun.chamber, bolt: gun.bolt, clip: gun.clip, state: gun.state, message: gun.message, carried: weapons.carried('mauser'), ...mauserStats };
}
// for testing: the gun drawn where a matrix puts it (in the camera's space), as it is now
export function inspectMauser(matrix) { view.draw(matrix, partsNow()); }
// for testing: a clip held part way in (seconds), the gun held still
export function poseMauser({ bolt = null, clip = null } = {}) {
	if (bolt !== null) gun.bolt = gun.boltWanted = bolt;
	if (clip !== null) { gun.clip = clip; gun.clipRounds = gun.clipRounds || MAGAZINE - gun.magazine || 10; }
}
