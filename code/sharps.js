import {canvas} from './deviceSelection.js'
import {onRenderResize} from './deviceSelection.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as transformations from './transformations.js'
import * as ballistics from './ballistics.js'
import * as vm from './viewmodel.js'

/*
	THE SHARPS: a Sharps 1874 falling block rifle, .45-70, one shot, with a scope: 3 to 8 power, its reticle in the first focal plane
	(it grows and shrinks with the magnification, so its marks are always the same angle on the target), a "Christmas tree".
		left click			fire, with the breech shut and the hammer at full cock
		right click (held)	up to the scope. In it the mouse wheel sets the magnification (up for more)
		middle click		the lever down: the breech block drops and the case is thrown out (a round too). Again: the lever up,
							the breech shut
		R					with the breech open and nothing in it, a round into the chamber
		mouse wheel			back (down) draws the hammer back to full cock (forward lets it down to half cock). Not in the scope
	Each round put in is one of those carried (weapons.js: 8 all told); a live one thrown out goes back to them.

	THE RETICLE: a fine cross with marks along it every milliradian (a tenth of a metre at a hundred), and under the middle the
	tree: a row every milliradian down, each with dots a milliradian apart for the wind, wider the further down. The rows say how
	far to hold over: the scope's line of sight and the bore cross at ZERO, and further off the heavy, slow bullet drops below it.
	Each row is marked with the range it is for, worked out from the bullet's own flight (holdovers: the same sums as ballistics.js).

	THE GUN (SHARPS_MESH): no more than 120 triangles, the scope with it, in metres, the bore along +z (as the rifle's): the octagonal
	barrel, the receiver, the stock, the forend, the scope on its mounts with its bells and lenses (part 0); the breech block (1),
	the lever (2), the side hammer (3), the trigger (4), a round's case (5) and its bullet (7).
*/
const SCOPE_Y = 0.055;				// the scope's line of sight over the bore, metres
const ZERO = 100;
const MUZZLE = 0.76;
const HIP_SPREAD = 0.014;
const MAGNIFICATION = [3, 8];
const TRIGGER_SECONDS = 0.1;
const RECOIL_SECONDS = 0.4;
const AIM_SECONDS = 0.25;
const LEVER_SECONDS = 0.25;
const LOAD_SECONDS = 0.45;
const BLOCK_DROP = 0.045;			// metres the breech block falls
const COCK_PIXELS = 100;			// of the wheel, from half to full cock
const ZOOM_PIXELS = 100;			// of the wheel, a notch: ZOOM_STEP of magnification
const ZOOM_STEP = 0.5;
const SCOPED = 0.9;					// aimed this far, the view is through the scope
const SCOPE_FIELD = 20;				// degrees: the scope's field of view across its eyepiece is this over its magnification (6.7 at 3x,
									//		2.5 at 8x, about a real 3-8 power's)
const EYEPIECE = 0.92;				// of the picture's height (or width, if narrower) the eyepiece's circle is across
const MESSAGE_SECONDS = 1.6;
const CASE = 0.053, BULLET = 0.072;	// a round's case and its whole length

const HIP = { x: 0.15, y: -0.16, z: -0.42, yaw: 0.045, pitch: 0.012 };
const AIM = { x: 0, y: -SCOPE_Y, z: -0.25, yaw: 0, pitch: 0 };

// The gun (see THE GUN at the top)
//-------------------------------------------------
const WOOD = 0, BLUED = 1, BRASS = 2, LEAD = 3, HARDENED = 5, SCOPE = 6, GLASS = 7, RUBBER = 9;
const SHARPS_MESH = (() => {
	const m = vm.meshBuilder();
	// the octagonal barrel (16)
	m.tube(0, 0, 0.0, 0.017, MUZZLE, 0.014, 8, BLUED, 0, [], 0.5);
	// the receiver, case hardened (10)
	m.section(-0.11, [0.017, -0.052, 0.02], 0.0, [0.017, -0.052, 0.02], HARDENED, 0, [0]);
	// the stock, from the back of the receiver down to the butt, and its plate (10)
	m.section(-0.11, [0.016, -0.05, 0.016], -0.6, [0.021, -0.16, -0.01], WOOD);
	m.quad([-0.021, -0.16, -0.6], [0.021, -0.16, -0.6], [0.021, -0.01, -0.6], [-0.021, -0.01, -0.6], 0, RUBBER);
	// the forend under the barrel (8)
	m.section(0.02, [0.02, -0.04, -0.008], 0.4, [0.017, -0.034, -0.008], WOOD);
	// the scope: its two mounts (4), and its tube from the eyepiece's bell back to the objective's in front (30), its lenses (6)
	for (const z of [-0.06, 0.14]) m.quad([-0.004, 0.012, z], [0.004, 0.012, z], [0.004, SCOPE_Y - 0.01, z + 0.01], [-0.004, SCOPE_Y - 0.01, z + 0.01], 0, SCOPE);
	const rings = [[-0.17, 0.019], [-0.1, 0.0135], [0.16, 0.0135], [0.24, 0.022]];
	for (let i = 0; i < rings.length - 1; i++) m.tube(0, SCOPE_Y, rings[i][0], rings[i][1], rings[i + 1][0], rings[i + 1][1], 5, SCOPE);
	m.disc(0, SCOPE_Y, -0.17, 0.019, 5, GLASS);
	m.disc(0, SCOPE_Y, 0.24, 0.022, 5, GLASS);
	// the breech block, falling in its mortise (8)
	m.section(-0.075, [0.0125, -0.055, 0.016], -0.02, [0.0125, -0.055, 0.016], HARDENED, 1);
	// the lever, its loop the trigger guard, swung down about its pivot (4)
	m.quad([-0.005, -0.055, -0.03], [0.005, -0.055, -0.03], [0.005, -0.085, -0.12], [-0.005, -0.085, -0.12], 2, HARDENED);
	m.quad([-0.005, -0.085, -0.12], [0.005, -0.085, -0.12], [0.005, -0.07, -0.2], [-0.005, -0.07, -0.2], 2, HARDENED);
	// the side hammer on the right (4), the trigger (2)
	m.quad([0.018, -0.02, -0.06], [0.018, -0.005, -0.06], [0.02, 0.018, -0.095], [0.02, 0.006, -0.1], 3, HARDENED);
	m.quad([0.02, 0.018, -0.095], [0.02, 0.006, -0.1], [0.021, 0.012, -0.115], [0.021, 0.024, -0.112], 3, HARDENED);
	m.quad([0, -0.05, -0.085], [0, -0.05, -0.093], [0, -0.072, -0.1], [0, -0.072, -0.09], 4, BLUED);
	// a round: its case (7) and its bullet (3), its base at the origin along +z
	m.tube(0, 0, 0, 0.0065, CASE, 0.0062, 3, BRASS, 5, [0]);
	m.tri([0.0062, 0, CASE], [-0.0031, 0.0054, CASE], [0, 0, BULLET], 7, LEAD);
	m.tri([-0.0031, 0.0054, CASE], [-0.0031, -0.0054, CASE], [0, 0, BULLET], 7, LEAD);
	m.tri([-0.0031, -0.0054, CASE], [0.0062, 0, CASE], [0, 0, BULLET], 7, LEAD);
	return { data: m.done(), triangles: m.count() };
})();
export const SHARPS_TRIANGLES = SHARPS_MESH.triangles;
const view = new vm.Viewmodel('Sharps', SHARPS_MESH.data);

// What it is doing
//-------------------------------------------------
const gun = {
	state: 'ready', timer: 0, aimed: 0, wantsAim: false, kick: 0, bob: 0, trigger: 0,
	chamber: 'live',				// 'live', 'spent' or 'empty'
	open: false, lever: 0,			// the breech open (wanted), and the lever as drawn, 0 shut to 1 all the way down
	cock: 0,						// the hammer: 0 at half cock (or down, fired) to 1 at full cock
	fired: false,					// the hammer down on the fired case
	loading: -1,
	eject: null,					// the case (or round) thrown out: { t, live }
	magnification: 4,
	message: '', messageAge: 99,
};
export const sharpsStats = { shots: 0, loaded: 0, ejected: 0, triangles: SHARPS_TRIANGLES, scoped: false };
let triggerAsked = false, middleAsked = false, wheelPixels = 0, loadsAsked = 0;
let lastTime = performance.now();
const active = () => weapons.holding('sharps');
const locked = () => document.pointerLockElement == canvas;
const say = (text) => { gun.message = text; gun.messageAge = 0; };

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
	if (active() && locked() && !hunting.input.menuOpen && event.code == 'KeyR' && !event.repeat) loadsAsked++;
});
document.addEventListener('pointerlockchange', () => { if (!locked()) gun.wantsAim = false; });

weapons.addWeapon('sharps', { label: 'Sharps rifle', detail: 'Falling block, .45-70, one shot, a 3–8 power scope', equip: () => { gun.aimed = 0; },
	loaded: () => (gun.chamber == 'live' ? 1 : 0) + (gun.loading >= 0 ? 1 : 0), reset: () => resetSharps(), drawn: () => drawSharps(),
	help: () => ['Sharps 1874', [
		['Left click', 'fire (breech shut, hammer at full cock)'],
		['Right click', 'the scope (hold) · wheel: magnification 3–8×'],
		['Middle click', 'lever down (open, throws the case out) or up (shut)'],
		['R', 'breech open: a round into the chamber'],
		['Wheel down', 'draw the hammer back to full cock (up lets it down)'],
		['', 'Reticle rows: hold over by a row for its range'],
	]] });

export function resetSharps() {
	Object.assign(gun, { state: 'ready', timer: 0, aimed: 0, kick: 0, trigger: 0, chamber: 'live', open: false, lever: 0, cock: 0, fired: false, loading: -1, eject: null });
	triggerAsked = middleAsked = false; wheelPixels = loadsAsked = 0;
}

// Once a frame
//-------------------------------------------------
export function sharpsUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	advance(elapsed);
	scopeView();
	showAmmo();
}

function advance(elapsed) {
	if (!active()) {
		triggerAsked = middleAsked = false; wheelPixels = loadsAsked = 0;
		gun.aimed = 0;
		return;
	}
	const g = gun;
	g.timer += elapsed;
	g.messageAge += elapsed;
	const place = hunting.hunterPlace();
	g.bob += elapsed * (place.grounded ? Math.hypot(place.vx ?? 0, place.vz ?? 0) / settings.forestUnitsPerMetre * 3.2 : 0);

	// the trigger: the hammer falls, if it is at full cock with the breech shut
	if (g.state == 'ready') {
		if (triggerAsked) {
			if (g.open || g.lever > 0) say('Shut the breech to fire (middle click)');
			else if (g.cock < 1) say('Draw the hammer back first (wheel down)');
			else { g.state = 'trigger'; g.timer = 0; }
		}
	} else if (g.state == 'trigger') {
		g.trigger = vm.clamp01(g.timer / TRIGGER_SECONDS);
		if (g.timer >= TRIGGER_SECONDS) {
			if (g.chamber == 'live') {
				vm.shoot({ muzzle: [0, 0, MUZZLE], gun: gunMatrix(), aimed: g.aimed, sight: SCOPE_Y, zero: ZERO, spread: HIP_SPREAD, round: '.45-70' });
				sharpsStats.shots++;
				g.chamber = 'spent';
				g.kick = 1;
				settings.camPitch = Math.min(settings.camPitch + 0.03, Math.PI * 0.5 - 0.02);
			} else {
				say(g.chamber == 'spent' ? 'Click. Open the breech and put in a round' : 'Click. The chamber is empty');
			}
			g.cock = 0;
			g.fired = true;
			g.state = 'recoil'; g.timer = 0;
		}
	} else if (g.state == 'recoil') {
		g.trigger = 1 - vm.clamp01(g.timer / RECOIL_SECONDS);
		if (g.timer >= RECOIL_SECONDS) { g.trigger = 0; g.state = 'ready'; g.timer = 0; }
	}
	triggerAsked = false;

	// the middle button: the lever down or up. All the way down, the case is thrown out
	if (middleAsked && g.state == 'ready' && g.loading < 0) {
		g.open = !g.open;
		if (g.open) { g.cock = Math.min(g.cock, 0); g.fired = false; }
	}
	middleAsked = false;
	const was = g.lever;
	g.lever = vm.toward(g.lever, g.open ? 1 : 0, elapsed / LEVER_SECONDS);
	if (g.lever == 1 && was < 1 && g.chamber != 'empty') {
		const live = g.chamber == 'live';
		g.eject = { t: 0, live };
		g.chamber = 'empty';
		sharpsStats.ejected++;
		if (live) weapons.giveRound('sharps');
	}
	if (g.eject) { g.eject.t += elapsed; if (g.eject.t > 0.9) g.eject = null; }

	// R: a round into the open, empty chamber
	for (; loadsAsked > 0; loadsAsked--) {
		if (!g.open || g.lever < 1) say('Open the breech first (middle click)');
		else if (g.chamber != 'empty' || g.loading >= 0) say('There is a round in the chamber');
		else if (!weapons.takeRound('sharps')) say(weapons.noAmmoWord);
		else g.loading = 0;
	}
	if (g.loading >= 0) {
		g.loading += elapsed;
		if (g.loading >= LOAD_SECONDS) { g.loading = -1; g.chamber = 'live'; sharpsStats.loaded++; }
	}

	// the wheel: in the scope, the magnification; out of it, the hammer
	const scoped = g.aimed >= SCOPED;
	if (g.wantsAim && g.aimed > 0.5) {
		const notches = Math.trunc(wheelPixels / ZOOM_PIXELS);
		if (notches) {
			g.magnification = Math.min(Math.max(g.magnification - notches * ZOOM_STEP, MAGNIFICATION[0]), MAGNIFICATION[1]);
			wheelPixels -= notches * ZOOM_PIXELS;
		}
		if (!scoped) wheelPixels = 0;
	} else if (!g.open && g.state == 'ready') {
		if (wheelPixels > 0 && g.cock < 1) { g.cock = vm.clamp01(g.cock + wheelPixels / COCK_PIXELS); g.fired = false; }
		else if (wheelPixels < 0) g.cock = vm.clamp01(g.cock + wheelPixels / COCK_PIXELS);
		wheelPixels = 0;
	} else {
		wheelPixels = 0;
	}

	g.aimed = vm.clamp01(g.aimed + (g.wantsAim && !g.open && g.loading < 0 ? 1 : -1) * elapsed / AIM_SECONDS);
	g.kick *= Math.exp(-elapsed * 8);
	hunting.crosshair.hidden = g.aimed > 0.3;
}

function gunMatrix() {
	const open = vm.ease(gun.lever);
	const loading = gun.loading >= 0 ? 1 : 0;
	return vm.holdMatrix(HIP, AIM, { aimed: gun.aimed, bob: gun.bob, kick: gun.kick, kickBack: 0.08, kickUp: 0.16, roll: -0.35 * open, tilt: 0.18 * open, drop: 0.03 * open + 0.005 * loading });
}

function partsNow() {
	const g = gun;
	const open = vm.ease(g.lever);
	const parts = [];
	parts[1] = mat4.translation([0, -BLOCK_DROP * open, 0]);
	const pivot = [0, -0.055, -0.03];
	parts[2] = mat4.multiply(mat4.translation(pivot), mat4.multiply(mat4.rotationX(0.9 * open), mat4.translation(pivot.map((v) => -v))));
	// the hammer: back about its pivot from half cock to full cock (and down on a fired case)
	const hammerPivot = [0.019, -0.012, -0.07];
	const angle = g.fired ? 0.12 : -0.35 - 0.45 * g.cock;
	parts[3] = mat4.multiply(mat4.translation(hammerPivot), mat4.multiply(mat4.rotationX(angle), mat4.translation(hammerPivot.map((v) => -v))));
	parts[4] = mat4.translation([0, 0, -0.005 * g.trigger]);
	// the round: in the chamber (seen with the breech open), going in, or thrown out back over the stock
	let round = vm.HIDDEN, bullet = false;
	const chamberZ = -0.002 - CASE - 0.0;
	if (g.loading >= 0) {
		const k = g.loading / LOAD_SECONDS;
		round = mat4.translation([0.03 * (1 - vm.ease(k / 0.5)), 0.02 * (1 - vm.ease(k / 0.5)), chamberZ - 0.07 * (1 - vm.ease((k - 0.5) / 0.5))]);
		bullet = true;
	} else if (g.eject) {
		const t = g.eject.t;
		round = mat4.rotateX(mat4.translation([0.02 * t, 0.9 * t - 4.9 * t * t, chamberZ - 0.06 - 0.6 * t]), 9 * t);
		bullet = g.eject.live;
	} else if (g.chamber != 'empty' && g.lever > 0.6) {
		round = mat4.translation([0, 0, chamberZ]);
		bullet = g.chamber == 'live';
	}
	parts[5] = round;
	parts[7] = bullet ? round : vm.HIDDEN;
	return parts;
}

function drawSharps() {
	if (gun.aimed >= SCOPED) return;		// (looking through the scope: the view is the scope's)
	view.draw(gunMatrix(), partsNow());
}

// The scope (see THE RETICLE at the top)
//-------------------------------------------------
// how far the bullet drops below the line of sight, in milliradians, at each range: the same sums as ballistics.js, aimed as vm.shoot aims
function holdovers() {
	const R = ballistics.ROUNDS['.45-70'];
	const time = ZERO / (R.velocity * (1 - R.drag * ZERO / 2));
	const up = (SCOPE_Y + 0.5 * 9.81 * time * time) / ZERO;
	let x = 0, y = -SCOPE_Y, vx = R.velocity / Math.hypot(1, up), vy = vx * up;
	const out = [];
	const dt = 1 / 2000;
	for (let t = 0; t < 4 && x < 800; t += dt) {
		const speed = Math.hypot(vx, vy);
		const slow = Math.max(1 - R.drag * speed * dt, 0);
		vx *= slow; vy = vy * slow - 9.81 * dt;
		x += vx * dt; y += vy * dt;
		out.push([x, -y / x * 1000]);
	}
	return out;
}
const HOLD = holdovers();
// the range (metres) a row this many milliradians down is for, or null past the end of the flight worked out
function rangeFor(mils) {
	for (let k = 1; k < HOLD.length; k++) if (HOLD[k][0] > ZERO && HOLD[k][1] >= mils) return HOLD[k][0];
	return null;
}
export const reticleRanges = Array.from({ length: 12 }, (_, k) => [k + 1, rangeFor(k + 1)]);

const scope = document.createElement('canvas');
scope.style.cssText = 'position: fixed; inset: 0; width: 100%; height: 100%; z-index: 4; pointer-events: none; display: none;';
document.body.appendChild(scope);
let drawnFor = '';
function drawReticle() {
	const W = scope.clientWidth || innerWidth, H = scope.clientHeight || innerHeight;
	const dpr = Math.min(devicePixelRatio || 1, 2);
	scope.width = Math.round(W * dpr); scope.height = Math.round(H * dpr);
	const c = scope.getContext('2d');
	c.setTransform(dpr, 0, 0, dpr, 0, 0);
	const cx = W / 2, cy = H / 2, radius = Math.min(W, H) * EYEPIECE / 2;
	// black round the eyepiece, a soft dark edge inside it
	c.fillStyle = '#000';
	c.beginPath(); c.rect(0, 0, W, H); c.arc(cx, cy, radius, 0, Math.PI * 2, true); c.fill();
	const edge = c.createRadialGradient(cx, cy, radius * 0.86, cx, cy, radius);
	edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,0.85)');
	c.fillStyle = edge;
	c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2); c.fill();
	// a milliradian in pixels, as the view is magnified now (the reticle is in the first focal plane: it is magnified with it)
	const mil = H / 2 / Math.tan(transformations.verticalViewAngle / 2) * 0.001;
	c.save();
	c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2); c.clip();
	c.strokeStyle = '#000'; c.fillStyle = '#000';
	// the thick posts from the edge in to 6 milliradians off the middle, and the fine cross between them
	c.lineWidth = Math.max(mil * 0.3, 3);
	for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1]]) { c.beginPath(); c.moveTo(cx + dx * 6 * mil, cy + dy * 6 * mil); c.lineTo(cx + dx * radius, cy + dy * radius); c.stroke(); }
	c.lineWidth = Math.max(mil * 0.04, 1);
	c.beginPath(); c.moveTo(cx - 6 * mil, cy); c.lineTo(cx + 6 * mil, cy); c.moveTo(cx, cy - 6 * mil); c.lineTo(cx, cy + 12.5 * mil); c.stroke();
	// a mark every milliradian along the cross, a longer one every 5
	for (let k = 1; k <= 5; k++) {
		const long = k == 5 ? 0.5 : 0.25;
		c.beginPath();
		for (const s of [-1, 1]) { c.moveTo(cx + s * k * mil, cy - long * mil); c.lineTo(cx + s * k * mil, cy + long * mil); }
		c.moveTo(cx - long * mil, cy - k * mil); c.lineTo(cx + long * mil, cy - k * mil);
		c.stroke();
	}
	// the tree: a row every milliradian down, a dot a milliradian apart for the wind, wider each row down, and the range it is for
	const font = Math.max(Math.min(mil * 0.42, 15), 9);
	c.font = `${font}px system-ui, sans-serif`;
	c.textBaseline = 'middle';
	for (let row = 1; row <= 12; row++) {
		const y = cy + row * mil;
		c.beginPath(); c.moveTo(cx - 0.3 * mil, y); c.lineTo(cx + 0.3 * mil, y); c.stroke();
		const wide = Math.min(1 + Math.floor(row / 2), 6);
		for (let k = 1; k <= wide; k++) for (const s of [-1, 1]) { c.beginPath(); c.arc(cx + s * k * mil, y, Math.max(mil * 0.07, 1.3), 0, Math.PI * 2); c.fill(); }
		if (mil >= 7 && (row % 2 == 0 || mil > 22)) {
			const range = rangeFor(row);
			c.textAlign = 'right';
			c.fillText(String(row), cx - (wide + 0.6) * mil, y);
			if (range) { c.textAlign = 'left'; c.fillText(Math.round(range / 10) * 10 + ' m', cx + (wide + 0.6) * mil, y); }
		}
	}
	c.restore();
	// the magnification, under the eyepiece
	c.fillStyle = 'rgba(232, 232, 232, 0.8)';
	c.font = '13px system-ui, sans-serif';
	c.textAlign = 'center';
	c.fillText(`${gun.magnification.toFixed(1)}×   ·   zeroed at ${ZERO} m`, cx, Math.min(cy + radius + 18, H - 12));
}
onRenderResize(() => { drawnFor = ''; });
// how much the view is narrowed through the scope at a magnification: the scope's field across the eyepiece, the picture as wide as that
//		makes it
function viewZoom(magnification) {
	const W = innerWidth, H = innerHeight;
	const field = SCOPE_FIELD / magnification * Math.PI / 180;		// across the eyepiece's circle
	const across = Math.min(W, H) * EYEPIECE;						// pixels of it
	const vertical = 2 * Math.atan(Math.tan(field / 2) * H / across);
	return Math.tan(transformations.baseVerticalViewAngle / 2) / Math.tan(vertical / 2);
}
// through the scope (or not): the view magnified, the mouse slowed as much, the reticle over it
function scopeView() {
	const scoped = active() && gun.aimed >= SCOPED && hunting.hunterPlace().active;
	sharpsStats.scoped = scoped;
	const zoom = scoped ? viewZoom(gun.magnification) : 1;
	transformations.setZoom(zoom);
	hunting.input.lookScale = 1 / zoom;
	scope.style.display = scoped ? '' : 'none';
	if (!scoped) return;
	const key = [gun.magnification, innerWidth, innerHeight, transformations.verticalViewAngle].join();
	if (key != drawnFor) { drawnFor = key; drawReticle(); }
}

// The ammunition, in the bottom right
//-------------------------------------------------
const box = vm.ammoBox();
let shown = '';
function nextStep() {
	const g = gun;
	if (g.state != 'ready') return '';
	if (g.loading >= 0) return 'Loading';
	if (g.open) return g.lever < 1 ? '' : g.chamber == 'empty' ? 'R to put in a round' : 'Middle click to shut the breech';
	if (g.chamber != 'live') return 'Middle click to open the breech';
	if (g.cock < 1) return 'Scroll down to draw the hammer back';
	return 'Ready to fire';
}
function showAmmo() {
	const on = active() && hunting.hunterPlace().active;
	box.style.display = on ? '' : 'none';
	if (!on) return;
	const g = gun;
	const message = g.messageAge < MESSAGE_SECONDS ? g.message : '';
	const key = [g.chamber, g.open, g.cock >= 1, g.fired, nextStep(), message, weapons.carried('sharps')].join('|');
	if (key == shown) return;
	shown = key;
	box.innerHTML = vm.ammoHtml({ count: g.chamber == 'live' ? 1 : 0, carried: weapons.carried('sharps'), groups: [{ icons: vm.roundIcon(g.chamber, 34), label: 'CHAMBER' }],
		state: (g.open ? 'BREECH OPEN' : 'BREECH SHUT') + ' · ' + (g.cock >= 1 ? 'FULL COCK' : g.fired ? 'HAMMER DOWN' : 'HALF COCK'), next: nextStep(), message });
}

// for testing: the trigger, the scope, the middle button, the wheel (pixels, down +), R, moved on by seconds
export function testSharps({ fire = false, aim = null, middle = false, wheel = 0, load = 0, seconds = 0 } = {}) {
	if (fire) triggerAsked = true;
	if (aim !== null) gun.wantsAim = aim;
	if (middle) middleAsked = true;
	wheelPixels += wheel;
	loadsAsked += load;
	for (let done = 0; done < seconds; done += 1 / 60) advance(1 / 60);
	scopeView();
	showAmmo();
	return { chamber: gun.chamber, open: gun.open, lever: gun.lever, cock: gun.cock, aimed: gun.aimed, magnification: gun.magnification, state: gun.state, message: gun.message, carried: weapons.carried('sharps'), ...sharpsStats };
}
