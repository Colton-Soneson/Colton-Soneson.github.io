import { canvas } from './deviceSelection.js'
import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';
import { settings } from './settings.js';
import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as inventory from './inventory.js'
import * as props from './props.js'
import * as vm from './viewmodel.js'
import { MESHES } from './itemMeshes.js'
import { windSpeedNow } from './wind.js'
import { seasonNow } from './weather.js'
import { mapState } from './survivalMap.js'

/*
	THE GRASS THROW (the Survival mode, on foot: G). The left hand comes up into view with a pinch of grass in it (itemMeshes.js:
	grassHand), flicks it up and away and opens (RELEASE into the throw), and goes down again. Out of the hand the grass is BLADES
	bits of it (grassBit, grassBitDry: more of them dry as the grass goes to hay), out in the world (props.js), each so light the wind
	has it at once (THE BITS): it takes up the wind's speed and way in a moment (DRAG), falls only slowly (FALL), and flutters; in no wind
	it drops straight down. They lie where they come down a while, and go.
	And as it leaves the hand, for a moment (CARD seconds), in the bottom right: the wind in knots and where it blows from. The bits say
	the same, for anyone who watches them.
	Each player's own (not sent in a game with others).
*/
const THROW = 1.15, RELEASE = 0.46;		// seconds: the whole of it, and the grass let go
const BLADES = 7;
const DRAG = 2.6;						// a second: how fast a bit takes up the wind's speed
const FALL = 0.45;						// metres a second it falls in still air
const FLUTTER = 0.9;					// metres a second squared, at random, every way
const GROUND_WIND = 0.8;				// of the wind (as the setting has it) down at a man's height
const LIE = 4, GONE = 1.2, MOST = 14;	// seconds: lying on the ground, then going; and the most one is out
const CARD = 1.6;

export const grassStats = { thrown: 0, bits: 0, last: null };

const held = new vm.Viewmodel('grass hand', MESHES.grassHand.data);
const state = { t: -1 };
let bits = [];
let lastTime = performance.now();
const M = () => settings.forestUnitsPerMetre;

// G: only on foot on the land in the Survival mode, the mouse taken, nothing open, and not in the middle of one
export function canThrow() {
	const p = hunting.hunterPlace();
	return inventory.survivalOn() && hunting.hunterLife.alive && p.active && p.on == 'land' && !p.swimming && !hunting.input.menuOpen && mapState.phase == 'away' && state.t < 0;
}
export function throwGrass() {
	if (!canThrow()) return false;
	state.t = 0;
	return true;
}
window.addEventListener('keydown', (e) => {
	if (e.code != 'KeyG' || e.repeat || e.target?.matches?.('input, textarea')) return;
	if (document.pointerLockElement != canvas) return;
	throwGrass();
});

// THE HAND: where it is (the camera's space) at a time into the throw, and how far its fingers are open
function handAt(t) {
	const up = vm.ease(t / 0.32), flick = vm.ease((t - 0.3) / (RELEASE - 0.3)), down = vm.ease((t - 0.78) / (THROW - 0.78));
	// (from low on the left, the forearm reaching forward and in, the back of the hand up and the grass standing out of the fist; the
	//		flick tips it up and on, and it goes down again)
	const x = -0.2 + 0.06 * up + 0.04 * flick - 0.03 * down;
	const y = -0.42 + 0.24 * up + 0.07 * flick - 0.32 * down;
	const z = -0.3 - 0.06 * up - 0.1 * flick + 0.04 * down;
	const pitch = 0.05 + 0.15 * up + 0.6 * flick - 0.5 * down;
	let mtx = mat4.translation([x, y, z]);
	mtx = mat4.rotateY(mtx, -0.45 + 0.15 * flick);
	mtx = mat4.rotateX(mtx, pitch);
	mtx = mat4.rotateZ(mtx, -0.2);
	return { mtx: mat4.scale(mtx, [1, 1, -1]), open: vm.ease((t - RELEASE + 0.04) / 0.12) };
}

// THE BITS (see the top): let go at the fingers, thrown up and forward a little, each its own way
function letGo(mtx) {
	const axes = vm.cameraAxes(), m = M();
	const p = vec3.transformMat4([0, 0.06, 0.1], mtx);		// (the top of the fist, in the camera's space)
	const at = vm.toWorld([p[0], p[1], p[2]], axes);
	const dry = seasonNow.hay ?? 0;
	for (let k = 0; k < BLADES; k++) {
		const spread = () => (Math.random() - 0.5) * 0.7;
		const v = [0, 1, 2].map((i) => axes.forward[i] * (1.2 + spread()) + axes.up[i] * (1.1 + spread()) + axes.right[i] * spread());
		bits.push({ p: at.map((c, i) => c + (axes.right[i] * spread() * 0.04 + axes.up[i] * spread() * 0.03) * m), v, t: 0, down: -1,
			spin: [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28], turn: [0, 1, 2].map(() => (Math.random() - 0.5) * 9),
			dry: Math.random() < 0.45 + 0.5 * dry, phase: Math.random() * 100 });
	}
	grassStats.thrown++;
	showCard();
}
// the wind down here: metres a second, along the ground ([x, z]), gusting a little
function windHere(t, phase) {
	const d = settings.windDirection, l = Math.hypot(d[0], d[1]) || 1, s = windSpeedNow() * GROUND_WIND * (1 + 0.25 * Math.sin(t * 1.7 + phase) + 0.15 * Math.sin(t * 4.1 + phase * 2.3));
	return [d[0] / l * s, d[1] / l * s];
}
function moveBits(dt) {
	const m = M(), sea = settings.waterWorldPosY, land = terrain.land;
	const now = performance.now() / 1000;
	for (const b of bits) {
		b.t += dt;
		if (b.down < 0) {
			const w = windHere(now, b.phase);
			const flutter = () => (Math.random() - 0.5) * 2 * FLUTTER;
			// (velocities in metres a second, the place in world units)
			b.v[0] += ((w[0] - b.v[0]) * DRAG + flutter()) * dt;
			b.v[2] += ((w[1] - b.v[2]) * DRAG + flutter()) * dt;
			b.v[1] += ((-FALL - b.v[1]) * DRAG + flutter() * 0.6) * dt;
			for (let i = 0; i < 3; i++) { b.p[i] += b.v[i] * dt * m; b.spin[i] += b.turn[i] * dt; }
			const ground = land ? Math.max(land.groundAt(b.p[0], b.p[2]), sea) : sea;
			if (b.p[1] <= ground + 0.01 * m || b.t > MOST) { b.p[1] = Math.max(b.p[1], ground + 0.005 * m); b.down = b.t; b.spin[0] = Math.PI / 2; }
		}
	}
	bits = bits.filter((b) => b.down < 0 || b.t - b.down < LIE + GONE);
	grassStats.bits = bits.length;
}

// THE CARD (see the top): the wind in knots, and the way it blows from (the compass: north is -z, east +x)
const card = document.createElement('div');
card.style.cssText = 'position: fixed; right: 16px; bottom: 118px; z-index: 6; pointer-events: none; padding: 9px 14px 8px; border-radius: 6px; background: rgba(0, 0, 0, 0.55); color: #e8e8e8; font-family: system-ui, sans-serif; text-align: right; user-select: none; opacity: 0; transition: opacity 0.25s; display: none;';
document.body.appendChild(card);
const POINTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export function windReport() {
	const d = settings.windDirection, speed = windSpeedNow(), knots = speed * 1.94384;
	// (where it blows from: against the way it blows)
	const from = (Math.atan2(-d[0], d[1]) * 180 / Math.PI + 360) % 360;
	return { knots: Math.round(knots), from: POINTS[Math.round(from / 22.5) % 16], calm: knots < 1 };
}
let cardTimer = null;
function showCard() {
	const r = windReport();
	grassStats.last = r;
	const label = 'font-size: 10px; letter-spacing: 0.08em; color: rgba(232, 232, 232, 0.6);';
	card.innerHTML = r.calm
		? `<div style="font-size: 22px; font-weight: 600; line-height: 1;">Calm</div><div style="${label} margin-top: 4px;">NO WIND</div>`
		: `<div style="font-size: 22px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums;">${r.knots}<span style="font-size: 12px; font-weight: 400; margin-left: 3px;">kn</span></div><div style="${label} margin-top: 4px;">WIND FROM THE ${r.from}</div>`;
	card.style.display = 'block';
	requestAnimationFrame(() => { card.style.opacity = '1'; });
	clearTimeout(cardTimer);
	cardTimer = setTimeout(() => { card.style.opacity = '0'; cardTimer = setTimeout(() => { card.style.display = 'none'; }, 280); }, CARD * 1000);
}

// once a frame (rotatingCube.js): the throw on, the bits moved and put out to be drawn (props.js)
export function grassUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (state.t >= 0) {
		const before = state.t;
		state.t += dt;
		if (!inventory.survivalOn() || !hunting.hunterLife.alive) state.t = -1;
		else {
			if (before < RELEASE && state.t >= RELEASE) letGo(handAt(RELEASE).mtx);
			if (state.t >= THROW) state.t = -1;
		}
	}
	if (bits.length) moveBits(dt);
	for (const b of bits) {
		const going = b.down >= 0 ? Math.max(0, 1 - Math.max(b.t - b.down - LIE, 0) / GONE) : 1;
		props.show(b.dry ? 'grassBitDry' : 'grassBit', props.place(b.p, b.spin[1], b.spin[0], b.spin[2], 2.8 * going));
	}
}
// over the finished frame, with the guns (rotatingCube.js): the hand, while it throws
export function grassHandPass() {
	if (state.t < 0) return;
	const { mtx, open } = handAt(state.t);
	const parts = [];
	parts[1] = mat4.multiply(mat4.translation([0, 0, 0.085]), mat4.multiply(mat4.rotationX(-1.1 * open), mat4.translation([0, 0, -0.085])));
	parts[2] = state.t >= RELEASE ? vm.HIDDEN : vm.IDENTITY;
	held.draw(mtx, parts);
}
export const grassForTest = () => ({ t: state.t, bits: bits.map((b) => ({ p: [...b.p], v: [...b.v], down: b.down, t: b.t })) });
export const forceThrowForTest = () => { state.t = 0; };
