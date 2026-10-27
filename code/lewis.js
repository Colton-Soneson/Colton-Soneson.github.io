import {canvas} from './deviceSelection.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as vm from './viewmodel.js'

/*
	THE LEWIS GUN: the British light machine gun of the First World War, .303 British, fed from a pan of 47 on top that turns a
	round on each shot, its barrel in the fat aluminium cooling shroud. It is fired lying down on its bipod: carried, it will not fire.
		middle click		deploy it: down on the ground behind it (hunting.js: LYING DOWN), its bipod legs swung down. The view
							turns no further than ARC either side of the way it was set up facing, and not too far up or down (PITCH).
							Again: pack it up, and get up. It only goes down on the land, on its feet, out of the water
		left click (held)	deployed: fire, RATE rounds a second for as long as it is held and the pan has rounds in it
		right click (held)	deployed: along the sights (the rear sight's aperture behind the pan, the post on the shroud's mouth)
		R					change the pan: the one on comes off (what is left in it goes back to those carried), a full one goes on
	The rounds carried (weapons.js: four pans, 188 all told) fill up at a horse's saddlebags.

	THE GUN (LEWIS_MESH): LEWIS_TRIANGLES (no more than 500), in metres, the bore along +z (as the rifle's), +x to the right. Part 0:
	the receiver, the cooling shroud with its rings and its cone to the barrel's mouth, the barrel and the dark of its bore, the sights,
	the stock, the pistol grip and the trigger guard, and the bipod's clamp on the shroud. Part 1 the pan, turning (its top ribbed,
	vf_viewmodel.js material 17), made with its middle at the origin. Part 2 the cocking handle on the right, driven back and forward
	by each shot. Part 3 the trigger. Parts 4 and 5 the bipod's legs, made hanging straight down from their hinge, swung out and
	down deployed or forward along the shroud packed up. Part 6 a spent case, thrown out down and to the right.
	The plane's gunner fires one too, on its ring (plane.js: drawMounted).
*/
const SIGHT_HEIGHT = 0.085;			// the rear sight's aperture and the front sight's post over the bore, metres
const ZERO = 300;
const MUZZLE = 0.765;
const SPREAD = 0.006;				// radians either way, deployed but not along the sights
export const PAN = 47;
export const RATE = 9.5;			// rounds a second (570 a minute)
const DEPLOY_SECONDS = 1.1;
const PAN_SECONDS = 2.6;
const AIM_SECONDS = 0.25;
const ARC = 0.8;					// radians either side of the way it faces
const PITCH = [-0.22, 0.4];			// radians down and up
const MESSAGE_SECONDS = 1.8;
export const PAN_AT = [0, 0.034, -0.045];	// the pan's middle, at its bottom
const LEG_HINGE = [0.014, -0.034, 0.53];
const LEG_LENGTH = 0.32;
const CASE_FROM = [0.024, -0.008, -0.06];

const CARRY = { x: 0.17, y: -0.23, z: -0.45, yaw: 0.2, pitch: -0.12 };	// packed up, carried low at the side
const DOWN = { x: 0.085, y: -0.15, z: -0.42, yaw: 0.03, pitch: 0.0 };		// deployed, not along the sights
const AIM = { x: 0, y: -SIGHT_HEIGHT, z: -0.32, yaw: 0, pitch: 0 };

// The gun (see THE GUN at the top)
//-------------------------------------------------
const WOOD = 0, BLUED = 1, BRASS = 2, DARK = 9, PANTOP = 17;
// made into a mesh being made (meshBuilder's): this one's, and the biplane's (plane.js, its parts numbered again)
export function buildLewis(m) {
	// THE RECEIVER, lofted, its back closed (28)
	m.loft([m.across(-0.19, [0.024, -0.045, 0.032], 0.008), m.across(0.04, [0.024, -0.045, 0.032], 0.008)], BLUED, 0, [0, 1]);
	// THE SHROUD: the tube (24), its back closed against the receiver (10), its cone down to the barrel (24), a ring at its back (24)
	m.tube(0, -0.004, 0.04, 0.036, 0.6, 0.036, 12, BLUED, 0, [0]);
	m.tube(0, -0.004, 0.6, 0.036, 0.69, 0.019, 12, BLUED);
	m.tube(0, -0.004, 0.06, 0.0385, 0.085, 0.0385, 12, BLUED);
	// the barrel out of its mouth and the dark of the bore (20)
	m.tube(0, 0, 0.68, 0.0115, MUZZLE, 0.0105, 8, BLUED);
	m.disc(0, 0, MUZZLE + 0.0003, 0.005, 6, DARK);
	// THE SIGHTS: the post on the shroud's mouth (12), the rear sight's leaf behind the pan, its aperture's frame (6) on its base (12)
	m.prismX([[0.668, 0.012], [0.682, 0.012], [0.679, SIGHT_HEIGHT], [0.672, SIGHT_HEIGHT]], -0.0014, 0.0014, BLUED);
	const zr = -0.165, H = SIGHT_HEIGHT;
	m.quad([-0.011, 0.032, zr], [-0.0055, 0.032, zr], [-0.0055, H + 0.008, zr], [-0.011, H + 0.008, zr], 0, BLUED);
	m.quad([0.0055, 0.032, zr], [0.011, 0.032, zr], [0.011, H + 0.008, zr], [0.0055, H + 0.008, zr], 0, BLUED);
	m.quad([-0.0055, H + 0.003, zr], [0.0055, H + 0.003, zr], [0.0055, H + 0.008, zr], [-0.0055, H + 0.008, zr], 0, BLUED);
	m.prismX([[-0.185, 0.032], [-0.14, 0.032], [-0.15, 0.04], [-0.18, 0.04]], -0.012, 0.012, BLUED);
	// THE STOCK, back from the receiver (32), and its butt plate (22)
	const stock = [[-0.19, [0.018, -0.04, 0.024]], [-0.32, [0.018, -0.075, 0.016]], [-0.6, [0.021, -0.14, 0.004]]];
	m.loft(stock.map(([z, r]) => m.across(z, r, 0.007)), WOOD);
	m.loft([m.across(-0.6, [0.021, -0.14, 0.004], 0.007), m.across(-0.612, [0.0215, -0.143, 0.005], 0.007)], BLUED, 0, [1]);
	// the pistol grip, down and back under the receiver (28), and the trigger guard in front of it (24)
	const gripTop = [0, -0.045, -0.118], gripFoot = [0, -0.15, -0.152];
	const d = [0, gripFoot[1] - gripTop[1], gripFoot[2] - gripTop[2]], dl = Math.hypot(...d), w = [0, -d[2] / dl, d[1] / dl];
	const oval = (s) => Array.from({ length: 6 }, (_, k) => { const a = (k + 0.5) / 6 * Math.PI * 2; return [Math.cos(a) * 0.014 * s, Math.sin(a) * 0.018 * s]; });
	m.loft([[0, 1], [0.6, 1.04], [1, 1.08]].map(([t, s]) => m.ringAt([0, gripTop[1] + d[1] * t, gripTop[2] + d[2] * t], [1, 0, 0], w, oval(s))), WOOD, 0, [1]);
	const bow = [[0, -0.045, -0.062], [0, -0.076, -0.07], [0, -0.079, -0.104], [0, -0.06, -0.118]];
	for (let k = 0; k < bow.length - 1; k++) m.strut(bow[k], bow[k + 1], 0.003, 0.003, 4, BLUED);
	// the bipod's clamp round the shroud (24)
	m.tube(0, -0.004, LEG_HINGE[2] - 0.012, 0.0385, LEG_HINGE[2] + 0.012, 0.0385, 12, BLUED);

	// THE MOVING PARTS
	// the pan, its middle at the origin: its side (24), its bottom (10), its ribbed top (10), the hub (16) and its cap (6)
	const ring = (y, r, n) => m.ringAt([0, y, 0], [1, 0, 0], [0, 0, 1], Array.from({ length: n }, (_, k) => { const a = (k + 0.5) / n * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r]; }));
	m.loft([ring(0, 0.081, 12), ring(0.032, 0.083, 12)], BLUED, 1, [0]);
	m.loft([ring(0.032, 0.083, 12), ring(0.0321, 0.083, 12)], PANTOP, 1, [1], Array.from({ length: 12 }, (_, k) => k));
	m.loft([ring(0.032, 0.022, 8), ring(0.042, 0.02, 8)], BLUED, 1, [1]);
	// the cocking handle out to the right (8) and its knob (16)
	m.strut([0.024, -0.02, -0.03], [0.05, -0.02, -0.03], 0.004, 0.004, 4, BLUED, 2);
	m.ball([0.055, -0.02, -0.03], 0.008, 4, BLUED, 2);
	// the trigger (12)
	m.prismX([[-0.086, -0.045], [-0.095, -0.045], [-0.1, -0.066], [-0.093, -0.067]], -0.0018, 0.0018, BLUED, 3);
	// the bipod's legs, each hanging straight down from its hinge, and its foot (10 each)
	for (const [s, part] of [[1, 4], [-1, 5]]) {
		const top = [s * LEG_HINGE[0], LEG_HINGE[1], LEG_HINGE[2]], foot = [top[0], top[1] - LEG_LENGTH, top[2]];
		m.strut(top, foot, 0.005, 0.0045, 4, BLUED, part);
		m.quad([foot[0] - 0.012, foot[1], foot[2] - 0.008], [foot[0] + 0.012, foot[1], foot[2] - 0.008], [foot[0] + 0.012, foot[1], foot[2] + 0.008], [foot[0] - 0.012, foot[1], foot[2] + 0.008], part, BLUED);
	}
	// a spent case, its base at the origin along +z (13)
	m.tube(0, 0, 0, 0.0068, 0.056, 0.0046, 5, BRASS, 6, [0]);
}
const LEWIS_MESH = (() => {
	const m = vm.meshBuilder();
	buildLewis(m);
	return { data: m.done(), triangles: m.count() };
})();
export const LEWIS_TRIANGLES = LEWIS_MESH.triangles;
const view = new vm.Viewmodel('Lewis gun', LEWIS_MESH.data);

// What it is doing
//-------------------------------------------------
const gun = {
	pan: PAN,					// rounds in the pan on it
	turn: 0,					// how far the pan has turned (rounds)
	deployed: false, down: 0,	// set up (wanted), and how far down it is, 0 to 1 (the legs out, the walker lying)
	aimed: 0, wantsAim: false, firing: false, kick: 0, bob: 0,
	cycle: 1,					// the cocking handle's stroke since the last shot, 0 to 1
	since: 1 / RATE,			// seconds since the last shot
	changing: -1,				// seconds into changing the pan, -1 when not
	cases: [],					// thrown out, falling: { t }
	message: '', messageAge: 99,
};
export const lewisStats = { shots: 0, pans: 0, triangles: LEWIS_TRIANGLES };
let middleAsked = false, panAsked = false;
let lastTime = performance.now();
const active = () => weapons.holding('lewis');
const locked = () => document.pointerLockElement == canvas;
const say = (text) => { gun.message = text; gun.messageAge = 0; };

window.addEventListener('mousedown', (event) => {
	if (!active() || !locked() || hunting.input.menuOpen) return;
	if (event.button == 0) gun.firing = true;
	if (event.button == 1) { middleAsked = true; event.preventDefault(); }
	if (event.button == 2) gun.wantsAim = true;
});
window.addEventListener('mouseup', (event) => {
	if (event.button == 0) gun.firing = false;
	if (event.button == 2) gun.wantsAim = false;
});
window.addEventListener('keydown', (event) => {
	if (active() && locked() && !hunting.input.menuOpen && event.code == 'KeyR' && !event.repeat) panAsked = true;
});
document.addEventListener('pointerlockchange', () => { if (!locked()) gun.wantsAim = gun.firing = false; });

weapons.addWeapon('lewis', { label: 'Lewis gun', detail: 'Light machine gun, .303 British, a pan of 47: fires deployed on its bipod', equip: () => { gun.aimed = 0; },
	loaded: () => gun.pan, reset: () => resetLewis(), drawn: () => drawLewis(),
	help: () => ['Lewis gun', [
		['Middle click', gun.deployed ? 'pack it up, and get up' : 'deploy it: lie down behind it on its bipod'],
		['Left click', 'deployed: fire (hold)'],
		['Right click', 'deployed: along the sights (hold)'],
		['R', 'change the pan'],
	]] });

export function resetLewis() {
	if (gun.deployed) hunting.setStance(null);
	Object.assign(gun, { pan: PAN, turn: 0, deployed: false, down: 0, aimed: 0, firing: false, kick: 0, cycle: 1, since: 1 / RATE, changing: -1, cases: [] });
	middleAsked = panAsked = false;
}

// Once a frame
//-------------------------------------------------
export function lewisUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	advance(elapsed);
	showAmmo();
}

function packUp() {
	weapons.actionSound('deploy');
	gun.deployed = false;
	hunting.setStance(null);
}

function advance(elapsed) {
	const g = gun;
	if (!active() || !hunting.hunterLife.alive) {
		// put down (another in the hands, or shot): it is packed up at once
		if (g.deployed) packUp();
		g.down = 0;
		middleAsked = panAsked = false;
		g.aimed = 0;
		g.firing = false;
		return;
	}
	g.messageAge += elapsed;
	const place = hunting.hunterPlace();
	g.bob += elapsed * (place.grounded && !g.deployed ? Math.hypot(place.vx ?? 0, place.vz ?? 0) / settings.forestUnitsPerMetre * 3.2 : 0);

	// the middle button: down behind it, or up again
	if (middleAsked) {
		if (g.deployed) packUp();
		else if (!hunting.stanceNow().canLie) say('Deploy it on open ground, on foot');
		else {
			weapons.actionSound('deploy');
			g.deployed = true;
			hunting.setStance({ facing: settings.camYaw, arc: ARC, low: PITCH[0], high: PITCH[1] });
		}
	}
	middleAsked = false;
	if (g.deployed && !hunting.stanceNow().canLie) packUp();
	g.down = vm.toward(g.down, g.deployed ? 1 : 0, elapsed / DEPLOY_SECONDS);
	const ready = g.deployed && g.down >= 1;

	// R: the pan off (what is left in it back with the rest), a full one on
	if (panAsked && g.changing < 0) {
		if (weapons.carried('lewis') <= 0 && g.pan < PAN) say(weapons.noAmmoWord);
		else if (g.pan >= PAN) say('The pan is full');
		else { g.changing = 0; weapons.actionSound('pan'); }
	}
	panAsked = false;
	if (g.changing >= 0) {
		const was = g.changing;
		g.changing += elapsed;
		if (was < PAN_SECONDS * 0.4 && g.changing >= PAN_SECONDS * 0.4) {
			// off: its rounds back with the rest, and a full one (or as full as there are rounds for) on
			const left = g.pan;
			g.pan = 0;
			weapons.giveRound('lewis', left);
			while (g.pan < PAN && weapons.takeRound('lewis')) g.pan++;
			g.turn = 0;
			lewisStats.pans++;
			weapons.actionSound('pan');
		}
		if (g.changing >= PAN_SECONDS) g.changing = -1;
	}

	// the trigger, held: a round every 1 / RATE seconds, deployed, while the pan has any
	g.since += elapsed;
	if (g.firing && !ready) {
		if (!g.deployed) say('Deploy it first: middle click to lie down behind it');
		g.firing = false;
	}
	while (g.firing && ready && g.changing < 0 && g.since >= 1 / RATE) {
		if (g.pan <= 0) { weapons.actionSound('click'); say('The pan is empty: R for another'); g.firing = false; break; }
		g.since -= 1 / RATE;
		g.since = Math.min(g.since, 1 / RATE);
		vm.shoot({ muzzle: [0, 0, MUZZLE], gun: gunMatrix(), aimed: g.aimed, sight: SIGHT_HEIGHT, zero: ZERO, spread: SPREAD, round: '.303 British' });
		lewisStats.shots++;
		g.pan--;
		g.turn++;
		g.cycle = 0;
		g.kick = Math.min(g.kick + 0.45, 1);
		g.cases.push({ t: 0 });
		settings.camPitch = Math.min(settings.camPitch + 0.0022 + Math.random() * 0.0015, PITCH[1]);
		settings.camYaw += (Math.random() - 0.5) * 0.0025;
	}
	if (!g.firing) g.since = Math.min(g.since, 1 / RATE);
	g.cycle = Math.min(g.cycle + elapsed * RATE * 1.6, 1);
	for (const c of g.cases) c.t += elapsed;
	g.cases = g.cases.filter((c) => c.t < 0.5).slice(-3);

	g.aimed = vm.clamp01(g.aimed + (g.wantsAim && ready && g.changing < 0 ? 1 : -1) * elapsed / AIM_SECONDS);
	g.kick *= Math.exp(-elapsed * 16);
	hunting.crosshair.hidden = g.aimed > 0.3;
}

// where it is held: carried low at the side packed up, down in front of the eyes deployed (DOWN), along the sights aimed
function gunMatrix() {
	const k = vm.ease(gun.down);
	const hold = Object.fromEntries(Object.keys(CARRY).map((key) => [key, CARRY[key] + (DOWN[key] - CARRY[key]) * k]));
	const shake = gun.kick * 0.004;
	return vm.holdMatrix(hold, AIM, { aimed: gun.aimed, bob: gun.bob, kick: gun.kick, kickBack: 0.02, kickUp: 0.012, roll: 0.25 * (1 - k) + (Math.random() - 0.5) * shake * 2, tilt: (Math.random() - 0.5) * shake });
}

// The parts as they are now (see THE GUN at the top)
//-------------------------------------------------
// the pan, the cocking handle, the legs and the cases: down (0 packed to 1 deployed), turn (rounds), cycle (0 to 1), changing (seconds or -1)
export function lewisParts({ down = 1, turn = 0, cycle = 1, changing = -1, cases = [] } = {}) {
	const parts = [];
	// the pan turned a round each shot (25 places round it), lifted off and back on while it is changed
	let pan = mat4.multiply(mat4.translation(PAN_AT), mat4.rotationY(-turn / 25 * Math.PI * 2));
	if (changing >= 0) {
		const k = changing / PAN_SECONDS;
		const off = k < 0.4 ? vm.ease(k / 0.25) : 1 - vm.ease((k - 0.55) / 0.35);
		pan = mat4.multiply(mat4.translation([0.12 * off, 0.09 * off, -0.03 * off]), mat4.multiply(pan, mat4.rotationZ(-0.6 * off)));
		if (k > 0.38 && k < 0.5) pan = vm.HIDDEN;
	}
	parts[1] = pan;
	parts[2] = mat4.translation([0, 0, -0.07 * Math.sin(Math.PI * cycle) * (cycle < 1 ? 1 : 0)]);
	// the legs: forward along the shroud packed, swung down and out deployed
	const k = vm.ease(down);
	for (const [s, part] of [[1, 4], [-1, 5]]) {
		const hinge = [s * LEG_HINGE[0], LEG_HINGE[1], LEG_HINGE[2]];
		const swing = mat4.multiply(mat4.rotationZ(s * 0.36 * k), mat4.rotationX(-Math.PI / 2 + 0.06 + (Math.PI / 2 - 0.16) * k));
		parts[part] = mat4.multiply(mat4.translation(hinge), mat4.multiply(swing, mat4.translation(hinge.map((v) => -v))));
	}
	// the last case out: down and to the right, tumbling
	const c = cases[cases.length - 1];
	parts[6] = c ? mat4.rotateZ(mat4.rotateX(mat4.translation([CASE_FROM[0] + 0.6 * c.t, CASE_FROM[1] - 0.3 * c.t - 4.9 * c.t * c.t, CASE_FROM[2] - 0.1 * c.t]), 14 * c.t), 6 * c.t) : vm.HIDDEN;
	return parts;
}
function drawLewis() {
	view.draw(gunMatrix(), lewisParts(gun));
}
// one on a mount (the plane's gunner's, plane.js): where it is, in the camera's space, and its parts (lewisParts)
export function drawMounted(matrix, parts) {
	view.draw(matrix, parts);
}

// The ammunition, in the bottom right
//-------------------------------------------------
const box = vm.ammoBox();
let shown = '';
// the pan from above: a dot for every round in it, round its two tiers
export function panPicture(rounds, size = 46) {
	let svg = `<svg width="${size}" height="${size}" viewBox="-25 -25 50 50" style="display: block;"><circle r="24" fill="rgba(40, 44, 52, 0.9)" stroke="rgba(255, 255, 255, 0.3)"/><circle r="6" fill="#22262c" stroke="rgba(255, 255, 255, 0.25)"/>`;
	for (let k = 0; k < PAN; k++) {
		const tier = k < 25 ? 19 : 12.5, a = (k < 25 ? k / 25 : (k - 25) / 22) * Math.PI * 2;
		svg += `<circle cx="${(Math.sin(a) * tier).toFixed(1)}" cy="${(-Math.cos(a) * tier).toFixed(1)}" r="2" fill="${k < rounds ? '#c9a043' : 'rgba(255, 255, 255, 0.12)'}"/>`;
	}
	return svg + '</svg>';
}
function nextStep() {
	const g = gun;
	if (g.changing >= 0) return 'Changing the pan';
	if (!g.deployed) return 'Middle click to deploy it';
	if (g.down < 1) return '';
	if (g.pan <= 0) return 'R to change the pan';
	return 'Hold left click to fire';
}
function showAmmo() {
	const on = active() && hunting.hunterPlace().active;
	box.style.display = on ? '' : 'none';
	if (!on) return;
	const g = gun;
	const message = g.messageAge < MESSAGE_SECONDS ? g.message : '';
	const key = [g.pan, g.deployed, g.down >= 1, g.changing >= 0, nextStep(), message, weapons.carried('lewis')].join('|');
	if (key == shown) return;
	shown = key;
	box.innerHTML = vm.ammoHtml({ count: g.pan, carried: weapons.carried('lewis'), groups: [{ icons: panPicture(g.pan), label: 'PAN' }],
		state: g.deployed ? 'DEPLOYED' : 'PACKED UP', next: nextStep(), message });
}

// for testing: the middle button, the trigger held (or let go), the sights, R, moved on by a number of seconds
export function testLewis({ middle = false, fire = null, aim = null, pan = false, seconds = 0 } = {}) {
	if (middle) middleAsked = true;
	if (fire !== null) gun.firing = fire;
	if (aim !== null) gun.wantsAim = aim;
	if (pan) panAsked = true;
	for (let done = 0; done < seconds; done += 1 / 60) { advance(1 / 60); }
	showAmmo();
	return { pan: gun.pan, deployed: gun.deployed, down: gun.down, aimed: gun.aimed, changing: gun.changing, carried: weapons.carried('lewis'), stance: hunting.stanceNow(), message: gun.message, ...lewisStats };
}
// for testing: the gun drawn where a matrix puts it (in the camera's space), as it is now
export function inspectLewis(matrix) { view.draw(matrix, lewisParts(gun)); }
export function poseLewis({ down = null, changing = null } = {}) {
	if (down !== null) gun.down = down;
	if (changing !== null) gun.changing = changing;
}
