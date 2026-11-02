import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as props from './props.js'
import * as smoke from './smoke.js'
import * as pointLights from './pointLights.js'
import * as survivalNet from './survivalNet.js'

/*
	THE FLARES (survivalTools.js: the flare gun). As a real one goes: up fast and thin, a small trail of smoke behind it and hardly a light (RISING), until it has slowed near the top of its climb (or BURST seconds), when it
	lights: a big bright ball coming slowly down (FALL metres a second, drifting on the wind), smoking, lighting the land under it (LIGHTS of them at a time, pointLights.js), for BURN seconds or until it is on the ground.
	Everyone sees the same one: fired on any machine, it is told to the host (flare) and by the host to everyone (flareIs), each flying its own from there. In metres and seconds (places world units).
*/
const SPEED = 60;					// metres a second out of the gun
const GRAVITY = 9.81, DRAG = 0.012;
const BURST = 4.5;					// seconds at the most before it lights
const FALL = 2.4;					// metres a second, burning
const BURN = 32;
const LIGHTS = 2;
const LIGHT_REACH = 260, LIGHT_UNDER = 0.7;	// metres, and the light on the land right under it

const metre = () => settings.forestUnitsPerMetre;
const flares = [];
export const flareStats = { fired: 0, burning: 0 };
function add(at, dir) {
	const m = metre();
	flares.push({ at: [...at], v: dir.map((d) => d * SPEED * m), age: 0, lit: false, burn: 0, puff: 0 });
	flareStats.fired++;
}
// fired here: from (world units) along dir (a unit direction)
export function fire(from, dir) {
	add(from, dir);
	if (survivalNet.authority()) survivalNet.send('flareIs', { from, dir, by: survivalNet.myId() });
	else survivalNet.send('flare', { from, dir });
}
const three = (a) => Array.isArray(a) && a.length == 3 && a.every(Number.isFinite);
survivalNet.on('flare', (m, by) => { if (survivalNet.authority() && three(m.from) && three(m.dir)) { add(m.from, m.dir); survivalNet.send('flareIs', { from: m.from, dir: m.dir, by }); } });
survivalNet.on('flareIs', (m) => { if (!survivalNet.authority() && m.by !== survivalNet.myId() && three(m.from) && three(m.dir)) add(m.from, m.dir); });

// the strength for as much light on the land right under it, however high it is (undoing vf_pointLights.js's falling off, as far as that is high)
function strengthOver(at, m) {
	const high = Math.max(at[1] - (terrain.land?.heightAt(at[0], at[2]) ?? 0), 1), fade = 1 - (high / (LIGHT_REACH * m)) ** 2;
	return LIGHT_UNDER * (1 + high * high * 0.05) / Math.max(fade * fade, 0.05);
}
// how big it is drawn: as big, from far off, as an eye sees so bright a thing (so much of a radian), and never under its own size (of a mesh that big)
const apparent = (at, angle, radius) => Math.max(1, Math.hypot(at[0] - settings.camPosX, at[1] - settings.camPosY, at[2] - settings.camPosZ) / metre() * angle / radius);
// Once a frame: on they go, drawn and lit
let lastTime = performance.now();
export function flaresUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	const m = metre(), wind = settings.windDirection ?? [0, 0], blow = (settings.waterWindSpeed ?? 0) * 0.15 * m;
	for (let k = flares.length - 1; k >= 0; k--) {
		const F = flares[k];
		F.age += dt;
		F.puff -= dt;
		if (!F.lit) {
			F.v[1] -= GRAVITY * m * dt;
			for (let i = 0; i < 3; i++) { F.v[i] *= Math.exp(-DRAG * dt * 6); F.at[i] += F.v[i] * dt; }
			if (F.puff <= 0) { F.puff = 0.03; smoke.addPuff({ at: F.at, v: [0, 0.2, 0], size: 0.12, grow: 0.8, life: 2.6, kind: 1, dark: 0, rise: 0.15 }); }
			props.show('flareSpark', props.place(F.at, 0, 0, 0, apparent(F.at, 0.004, 0.12)), [1, 0.5, 0.2, 2]);
			if (F.v[1] < 3 * m || F.age > BURST) { F.lit = true; F.burn = BURN; }
		} else {
			F.burn -= dt;
			F.at[0] += wind[0] * blow * dt; F.at[2] += wind[1] * blow * dt; F.at[1] -= FALL * m * dt;
			const shake = apparent(F.at, 0.02, 0.55) * (1 + 0.12 * Math.sin(now * 0.031 + k) * Math.sin(now * 0.017));
			props.show('flareBall', props.place(F.at, now * 0.001, 0, 0, shake), [1, 0.35, 0.2, 4]);
			if (F.puff <= 0) {
				F.puff = 0.07;
				// (the glare round it, and its smoke going up from it, lit by it)
				smoke.addPuff({ at: F.at, size: shake * 1.5, grow: 0, life: 0.24, kind: 3, dark: 1, rise: 0 });
				smoke.addPuff({ at: F.at, size: shake * 3.6, grow: 0, life: 0.24, kind: 3, dark: 0.55, rise: 0 });
				smoke.addPuff({ at: F.at, size: shake * 9, grow: 0, life: 0.24, kind: 3, dark: 0.22, rise: 0 });
				smoke.addPuff({ at: [F.at[0], F.at[1] + 0.8 * m, F.at[2]], v: [0, 0.6, 0], size: 1, grow: 3, life: 5, kind: 3, dark: 0.13, rise: 0.4 });
			}
			const ground = terrain.land?.heightAt(F.at[0], F.at[2]) ?? -Infinity;
			if (F.burn <= 0 || F.at[1] <= Math.max(ground, settings.waterWorldPosY)) flares.splice(k, 1);
		}
	}
	const lit = flares.filter((F) => F.lit).sort((a, b) => Math.hypot(a.at[0] - settings.camPosX, a.at[2] - settings.camPosZ) - Math.hypot(b.at[0] - settings.camPosX, b.at[2] - settings.camPosZ));
	flareStats.burning = lit.length;
	for (let k = 0; k < LIGHTS; k++) {
		const F = lit[k], fade = F ? Math.min(F.burn / 3, 1) : 0;
		pointLights.setMovingLight('flare' + k, F ? { at: F.at, radius: LIGHT_REACH * m, colour: [1.0, 0.5, 0.34], strength: strengthOver(F.at, m) * fade * (0.9 + 0.1 * Math.sin(now * 0.04 + k)), night: false } : null);
	}
}
export const flaresForTest = () => flares.map((F) => ({ at: F.at, lit: F.lit, burn: F.burn, age: F.age }));
