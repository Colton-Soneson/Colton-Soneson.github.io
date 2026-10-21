import {canvas} from './deviceSelection.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as help from './controlsHelp.js'
import * as vm from './viewmodel.js'
import { strikeAt } from './lightning.js'
import { summonHawks } from './birds.js'
import { setBeams } from './lightShafts.js'
import { addChoice } from './radialMenu.js'
import { setMovingLight } from './pointLights.js'

/*
	THE WHITE STAFF: a wizard's staff, after Gandalf the White's in The Return of the King: a long pale shaft whose head splits into
	gnarled branches that twist up round a gem and curl in over it. The gem shines by itself, a little, in the colour of the spell
	that is ready (and the branches round it catch its light), and flares as a spell is cast. It is chosen from the spawn menu's
	Magic ring (radialMenu.js), the staff itself or a spell to have ready, and held as the guns are (weapons.js).
		left click			cast the spell that is ready, where the crosshair points (POINT_REACH, on the ground: pointing at the sky
							casts nothing). The staff is thrust out as it goes
		left click (held)	the Light Beam: on while it is held
		mouse wheel			the next spell (down) or the one before (up)
	THE SPELLS (SPELLS)
		Lightning			a strike called down on the place, from the cloud (lightning.strikeAt: the weather's own lightning)
		Huginn and Muninn	two great hawks called up out of the ground at the place (birds.summonHawks). For now they are hawks as
							any others, only bigger. Called again, the old pair goes on its way
		Light Beam			a cone of light (BEAM_SPREAD either side of its middle, BEAM_REACH long) from the gem towards the place the
							crosshair is on: the air in it glows, and what it falls on is lit (the light shafts' pass, lightShafts.setBeams)
	Each spell but the beam has a COOLDOWN before it can be cast again.

	THE STAFF (STAFF_MESH): no more than 300 triangles, in metres, along +y, its origin at the middle of the gem (where the glow is,
	see vf_viewmodel.js). The shaft lofted through rings, a little crooked and knotted, flaring at the top; four branches from there,
	each a tube along a curve twisting up round the gem and in over it; two twigs off them; the gem a long six sided crystal.

	IN A GAME WITH OTHERS (net.js): each spell cast is told to the others (onCast): a strike is struck everywhere, the hawks are called
	up by the host (they are the host's, as all the hawks are), and a beam is sent while it is on (remoteBeam) and drawn for everyone.
*/
const POINT_REACH = 1500;			// metres
const BEAM_REACH = 260;				// metres
const BEAM_SPREAD = 9 * Math.PI / 180;
const BEAM_RISE = 0.25, BEAM_FALL = 0.45;	// seconds the beam takes to come up, and to die away
const CAST_SECONDS = 0.45;			// the staff thrust out and back
const REMOTE_BEAM_SECONDS = 0.5;	// an other's beam not heard of for this long is gone
export const SPELLS = [
	{ id: 'lightning', name: 'Lightning', detail: 'A strike called down where you point', colour: [0.62, 0.8, 1.0], cooldown: 1.2 },
	{ id: 'hawks', name: 'Huginn and Muninn', detail: 'Two great hawks called up where you point', colour: [1.0, 0.7, 0.3], cooldown: 3.0 },
	{ id: 'beam', name: 'Light Beam', detail: 'A great cone of light where you look, while you hold the button', colour: [1.0, 0.95, 0.78], cooldown: 0 },
];
// where the gem is in front of the eye (camera space, metres) and how the staff leans: as it is held, thrust out casting, and
//		pointed with the beam on
const REST = { x: 0.25, y: 0.1, z: -0.6, lean: 0.12, tip: -0.12 };
const THRUST = { x: 0.13, y: 0.07, z: -0.72, lean: 0.2, tip: -0.85 };
const POINTED = { x: 0.19, y: -0.02, z: -0.58, lean: 0.3, tip: -0.95 };

const metre = () => settings.forestUnitsPerMetre;

// The staff (see THE STAFF at the top)
//-------------------------------------------------
const WHITE = 15, GEM = 16;
const STAFF_MESH = (() => {
	const m = vm.meshBuilder();
	// a ring of sides points round p, square to the way t
	const ring = (p, t, r, sides, turn = 0) => {
		const tl = Math.hypot(...t), d = t.map((v) => v / tl);
		const other = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
		let u = [d[1] * other[2] - d[2] * other[1], d[2] * other[0] - d[0] * other[2], d[0] * other[1] - d[1] * other[0]];
		const ul = Math.hypot(...u); u = u.map((v) => v / ul);
		const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
		return Array.from({ length: sides }, (_, k) => { const a = (k + turn) / sides * Math.PI * 2; return [0, 1, 2].map((i) => p[i] + (u[i] * Math.cos(a) + w[i] * Math.sin(a)) * r); });
	};
	// a tube along a curve of points, its radius at each
	const along = (points, radii, sides, material, capStart = false) => {
		const rings = points.map((p, i) => ring(p, [0, 1, 2].map((k) => points[Math.min(i + 1, points.length - 1)][k] - points[Math.max(i - 1, 0)][k]), radii[i], sides, 0.5));
		for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < sides; k++) m.quad(rings[i][k], rings[i][(k + 1) % sides], rings[i + 1][(k + 1) % sides], rings[i + 1][k], 0, material);
		if (capStart) for (let k = 1; k < sides - 1; k++) m.tri(rings[0][0], rings[0][k], rings[0][k + 1], 0, material);
	};
	// the shaft (64): up from its foot, a little crooked and knotted, flaring out under the head
	along([[0, -1.3, 0], [0.002, -1.0, -0.001], [-0.002, -0.66, 0.002], [0.001, -0.36, -0.001], [0, -0.14, 0], [0, -0.085, 0]],
		[0.0125, 0.0135, 0.0148, 0.0138, 0.015, 0.021], 6, WHITE, true);
	// the branches (160): from the top of the shaft, twisting up round the gem, curling in over it
	const at = (r, a, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
	for (let b = 0; b < 4; b++) {
		const a = b * Math.PI / 2 + 0.3, tall = 1 + 0.07 * ((b * 5) % 3 - 1);
		along([at(0.012, a, -0.09), at(0.031, a + 0.25, -0.06), at(0.043, a + 0.55, -0.014 * tall), at(0.041, a + 0.85, 0.032 * tall), at(0.027, a + 1.15, 0.066 * tall), at(0.008, a + 1.42, 0.083 * tall)],
			[0.0095, 0.0088, 0.0076, 0.0064, 0.005, 0.0028], 4, WHITE);
	}
	// two twigs off them (24)
	for (const b of [0, 2]) {
		const a = b * Math.PI / 2 + 0.3 + 0.55;
		along([at(0.043, a, -0.014), at(0.058, a + 0.1, 0.012), at(0.064, a + 0.25, 0.034)], [0.0045, 0.0032, 0.0015], 3, WHITE);
	}
	// the gem (12): a long six sided crystal
	const sides = 6, top = [0, 0.032, 0], bottom = [0, -0.026, 0];
	const belt = Array.from({ length: sides }, (_, k) => { const a = (k + 0.25) / sides * Math.PI * 2; return [Math.cos(a) * 0.017, 0.002, Math.sin(a) * 0.017]; });
	for (let k = 0; k < sides; k++) {
		m.tri(belt[k], belt[(k + 1) % sides], top, 0, GEM);
		m.tri(belt[(k + 1) % sides], belt[k], bottom, 0, GEM);
	}
	return { data: m.done(), triangles: m.count() };
})();
export const STAFF_TRIANGLES = STAFF_MESH.triangles;
const view = new vm.Viewmodel('Staff', STAFF_MESH.data);

// What it is doing
//-------------------------------------------------
const staff = {
	spell: 0,
	cooldown: 0,			// seconds before the next can be cast
	cast: -1,				// seconds since the last was cast (the thrust and the flare), -1: none going on
	castColour: SPELLS[0].colour,
	holding: false,			// the button held (the beam)
	beam: 0,				// how strong the beam is, 0 to 1
	beamFrom: [0, 0, 0], beamWay: [0, 0, -1],
	bob: 0,
};
export const staffStats = { cast: 0, missed: 0, bolts: 0, hawks: 0, beamSeconds: 0, beamsDrawn: 0, triangles: STAFF_TRIANGLES };
let castAsked = false, wheelPixels = 0;
let localId = 0;
export function setLocalId(id) { localId = id; }
const castListeners = [];
// told of each spell cast here (net.js): fn({ k: 'bolt' or 'hawks', at: [x, z] }), and of the beam while it is on: fn({ k: 'beam', on, from, way })
export function onCast(fn) { castListeners.push(fn); }
const remoteBeams = new Map();		// whose -> { from, way, strength, at (seconds) }
const active = () => weapons.holding('staff');
const locked = () => document.pointerLockElement == canvas;

window.addEventListener('mousedown', (event) => {
	if (!active() || !locked() || hunting.input.menuOpen) return;
	if (event.button == 0) { castAsked = true; staff.holding = true; }
});
window.addEventListener('mouseup', (event) => { if (event.button == 0) staff.holding = false; });
window.addEventListener('wheel', (event) => {
	if (!active() || !locked() || hunting.input.menuOpen || hunting.crosshair.onRope) return;
	wheelPixels += vm.wheelPixels(event);
	event.preventDefault();
}, { passive: false });
document.addEventListener('pointerlockchange', () => { if (!locked()) staff.holding = false; });

weapons.addWeapon('staff', { label: 'White staff', detail: 'A wizard\'s staff: lightning, Huginn and Muninn, a beam of light', menu: 'Magic',
	equip: () => { staff.cast = -1; staff.holding = false; },
	reset: () => { staff.cooldown = 0; staff.cast = -1; staff.beam = 0; staff.holding = false; },
	drawn: () => drawStaff(),
	help: () => ['White staff', [
		['Left click', SPELLS[staff.spell].id == 'beam' ? 'hold: the beam of light' : 'cast ' + SPELLS[staff.spell].name + ', where you point'],
		['Wheel', 'the next spell'],
		['', 'Spells: ' + SPELLS.map((s) => s.name).join(', ')],
	]] });
// and each spell, ready, from the same ring
SPELLS.forEach((spell, k) => addChoice('Magic', { label: spell.name, detail: spell.detail, act: () => { weapons.equipWeapon('staff'); chooseSpell(k); return true; } }));

function chooseSpell(k) {
	staff.spell = ((k % SPELLS.length) + SPELLS.length) % SPELLS.length;
	staff.holding = false;
	help.toast(SPELLS[staff.spell].name);
}

// Where the crosshair points: the first ground (or sea) along the line of sight, within POINT_REACH. null: the sky
export function pointAt(eye = [settings.camPosX, settings.camPosY, settings.camPosZ], look = transformations.getCameraForward()) {
	const land = terrain.land;
	if (!land) return null;
	const m = metre(), sea = settings.waterWorldPosY;
	const ground = (t) => Math.max(land.heightAt(eye[0] + look[0] * t, eye[2] + look[2] * t), sea);
	const above = (t) => eye[1] + look[1] * t - ground(t);
	let last = 0;
	for (let t = 0.5 * m; t <= POINT_REACH * m; t += Math.max(0.5 * m, t * 0.015)) {
		if (above(t) <= 0) {
			// between the last step above it and this one under it
			let lo = last, hi = t;
			for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (above(mid) > 0) lo = mid; else hi = mid; }
			const x = eye[0] + look[0] * hi, z = eye[2] + look[2] * hi;
			return [x, ground(hi), z];
		}
		last = t;
	}
	return null;
}

// Once a frame
//-------------------------------------------------
let lastTime = performance.now();
export function staffUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	advance(elapsed);
	showBeams(now / 1000);
	showBox();
	// the gem lights what is round it while it is held (pointLights.js): a little always, a flash when a spell goes
	if (active() && hunting.hunterPlace().active) {
		const p = poseNow(), glow = glowNow();
		setMovingLight('staff', { at: vm.toWorld([p.x, p.y, p.z], vm.cameraAxes()), radius: 10 + 6 * Math.min(glow[3], 2), colour: glow.slice(0, 3), strength: 0.12 * glow[3] });
	} else setMovingLight('staff', null);
}

function advance(elapsed) {
	const s = staff;
	s.cooldown = Math.max(s.cooldown - elapsed, 0);
	if (s.cast >= 0) { s.cast += elapsed; if (s.cast > CAST_SECONDS) s.cast = -1; }
	if (!active()) {
		castAsked = false; wheelPixels = 0;
		s.holding = false;
	} else {
		const place = hunting.hunterPlace();
		s.bob += elapsed * (place.grounded ? Math.hypot(place.vx ?? 0, place.vz ?? 0) / metre() * 3.2 : 0);
		// the wheel: a notch a spell
		const notches = Math.trunc(wheelPixels / 100);
		if (notches) { chooseSpell(s.spell + Math.sign(notches)); wheelPixels = 0; }
		const spell = SPELLS[s.spell];
		if (castAsked && spell.id != 'beam' && s.cooldown <= 0) cast(spell);
	}
	castAsked = false;
	// the beam: up while the button is held (and it is the spell ready), dying away after
	const on = active() && s.holding && SPELLS[s.spell].id == 'beam';
	s.beam = vm.clamp01(s.beam + (on ? elapsed / BEAM_RISE : -elapsed / BEAM_FALL));
	if (s.beam > 0) {
		const axes = vm.cameraAxes();
		s.beamFrom = vm.toWorld(gemNow(), axes);
		const target = pointAt() ?? [0, 1, 2].map((k) => [settings.camPosX, settings.camPosY, settings.camPosZ][k] + axes.forward[k] * BEAM_REACH * metre());
		const to = [0, 1, 2].map((k) => target[k] - s.beamFrom[k]), tl = Math.hypot(...to) || 1;
		s.beamWay = to.map((v) => v / tl);
		if (on) staffStats.beamSeconds += elapsed;
	}
	for (const fn of castListeners) if (s.beam > 0 || beamWasOn) fn({ k: 'beam', on: s.beam > 0, from: s.beamFrom, way: s.beamWay, strength: s.beam });
	beamWasOn = s.beam > 0;
}
let beamWasOn = false;

// A spell cast (not the beam): where the crosshair points
function cast(spell) {
	const s = staff;
	const at = pointAt();
	if (!at) { help.toast('Point at the ground', 1.2); staffStats.missed++; return; }
	s.cooldown = spell.cooldown;
	s.cast = 0;
	s.castColour = spell.colour;
	staffStats.cast++;
	if (spell.id == 'lightning') {
		strikeAt(at[0], at[2]);
		staffStats.bolts++;
		for (const fn of castListeners) fn({ k: 'bolt', at: [at[0], at[2]] });
	} else if (spell.id == 'hawks') {
		if (!settings.enableBirds) help.toast('The hawks are turned off (Animal Life, Hawks)', 2);
		summonHawks(at[0], at[2], localId);		// (in a game, a joiner's are called up by the host: see IN A GAME WITH OTHERS at the top)
		staffStats.hawks++;
		for (const fn of castListeners) fn({ k: 'hawks', at: [at[0], at[2]] });
	}
}
// someone else's spell (net.js)
export function remoteSpell(who, { k, at, on, from, way, strength }) {
	if (k == 'bolt') strikeAt(at[0], at[1]);
	else if (k == 'hawks') summonHawks(at[0], at[1], who);
	else if (k == 'beam') {
		if (on) remoteBeams.set(who, { from, way, strength: strength ?? 1, at: performance.now() / 1000 });
		else remoteBeams.delete(who);
	}
}
// the beams going on, this player's and the others', to the light shafts' pass
function showBeams(now) {
	const list = [];
	const spread = Math.tan(BEAM_SPREAD), reach = BEAM_REACH * metre();
	if (staff.beam > 0) list.push({ from: staff.beamFrom, way: staff.beamWay, reach, spread, strength: vm.ease(staff.beam) });
	for (const [who, b] of remoteBeams) {
		if (now - b.at > REMOTE_BEAM_SECONDS) { remoteBeams.delete(who); continue; }
		list.push({ from: b.from, way: b.way, reach, spread, strength: vm.ease(b.strength) });
	}
	setBeams(list);
	staffStats.beamsDrawn = list.length;
}

// Drawn
//-------------------------------------------------
// where the gem is in front of the eye now (camera space, metres), and how the staff leans
function poseNow() {
	const s = staff;
	const mix = (a, b, f) => Object.fromEntries(Object.keys(a).map((key) => [key, a[key] + (b[key] - a[key]) * f]));
	let pose = mix(REST, POINTED, vm.ease(s.beam));
	if (s.cast >= 0) pose = mix(pose, THRUST, Math.sin(Math.PI * Math.min(s.cast / CAST_SECONDS, 1)));
	const sway = 1 - 0.6 * s.beam;
	pose.x += Math.sin(s.bob) * 0.008 * sway;
	pose.y -= Math.abs(Math.cos(s.bob)) * 0.008 * sway;
	return pose;
}
function gemNow() {
	const p = poseNow();
	return [p.x, p.y, p.z];
}
function glowNow() {
	const s = staff;
	const ready = SPELLS[s.spell].colour;
	const flare = s.cast >= 0 ? Math.exp(-s.cast * 6) * 2.2 : 0;
	const colour = s.cast >= 0 ? s.castColour : ready;
	const breathe = 0.06 * Math.sin(performance.now() / 1000 * 2.1);
	return [...colour, 0.35 + breathe + flare + 1.1 * s.beam];
}
function drawStaff() {
	const p = poseNow();
	let at = mat4.translation([p.x, p.y, p.z]);
	at = mat4.rotateZ(at, p.lean);
	at = mat4.rotateX(at, p.tip);
	view.draw(at, [], glowNow());
}

// The box in the bottom right: the spells, the one ready lit, what the buttons do
//-------------------------------------------------
const box = vm.ammoBox();
let shown = '';
const ICONS = {
	lightning: '<path d="M9 1 L3 10 L7 10 L5 17 L12 7 L8 7 L10 1 Z" fill="currentColor"/>',
	hawks: '<path d="M1 7 Q4 4 8 8 Q12 4 15 7 Q12 6 9 10 L8 12 L7 10 Q4 6 1 7 Z" fill="currentColor"/>',
	beam: '<circle cx="5" cy="9" r="3" fill="currentColor"/><path d="M8 7 L16 3 L16 15 L8 11 Z" fill="currentColor" opacity="0.6"/>',
};
const KEY = 'display: inline-block; min-width: 14px; padding: 0 5px; margin-right: 6px; border: 1px solid rgba(255, 255, 255, 0.55); border-radius: 3px; font-size: 11px; font-weight: 700; line-height: 16px; text-align: center; color: #fff; background: rgba(255, 255, 255, 0.1);';
function showBox() {
	const on = active() && hunting.hunterPlace().active;
	box.style.display = on ? '' : 'none';
	if (!on) return;
	const s = staff;
	const spell = SPELLS[s.spell];
	const wait = spell.cooldown ? s.cooldown / spell.cooldown : 0;
	const key = [s.spell, Math.round(wait * 30), s.beam > 0].join('|');
	if (key == shown) return;
	shown = key;
	const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
	const rows = SPELLS.map((sp, k) => {
		const lit = k == s.spell;
		return `<div style="display: flex; align-items: center; justify-content: flex-end; gap: 7px; padding: 3px 7px; border-radius: 4px; ${lit ? `background: rgba(255, 255, 255, 0.1); outline: 1px solid ${rgb(sp.colour)};` : 'opacity: 0.55;'}">`
			+ `<span style="font-size: 13px; font-weight: ${lit ? 700 : 500};">${sp.name}</span>`
			+ `<svg width="17" height="18" viewBox="0 0 17 18" style="color: ${rgb(sp.colour)};">${ICONS[sp.id]}</svg></div>`;
	}).join('');
	const bar = spell.cooldown ? `<div style="margin: 5px 0 0 auto; width: 150px; height: 5px; border-radius: 3px; background: rgba(255, 255, 255, 0.15); overflow: hidden;"><div style="height: 100%; width: ${((1 - wait) * 100).toFixed(0)}%; background: ${rgb(spell.colour)};"></div></div>` : '';
	const keys = `<div style="margin-top: 6px; font-size: 12px; white-space: nowrap;"><span style="${KEY} border-color: ${rgb(spell.colour)}; color: ${rgb(spell.colour)};">LMB</span>${spell.id == 'beam' ? (s.beam > 0 ? 'Shining…' : 'Hold to shine the beam') : wait > 0 ? 'Gathering…' : 'Cast where you point'}</div>`
		+ `<div style="margin-top: 3px; font-size: 12px; color: rgba(232, 232, 232, 0.6); white-space: nowrap;"><span style="${KEY}">Wheel</span>Next spell</div>`;
	box.innerHTML = `<div style="${vm.LABEL} text-align: right; margin: 0 0 5px;">WHITE STAFF · SPELLS</div>${rows}${bar}${keys}`;
}

// for testing: a spell made ready, cast where the view points (or the beam held on or let go), moved on by seconds
export function testStaff({ spell = null, cast: doCast = false, hold = null, seconds = 0 } = {}) {
	if (spell !== null) chooseSpell(typeof spell == 'string' ? SPELLS.findIndex((sp) => sp.id == spell) : spell);
	if (doCast) castAsked = true;
	if (hold !== null) staff.holding = hold;
	for (let done = 0; done < seconds; done += 1 / 60) advance(1 / 60);
	showBeams(performance.now() / 1000);
	showBox();
	return { spell: SPELLS[staff.spell].id, cooldown: staff.cooldown, beam: staff.beam, from: staff.beamFrom, way: staff.beamWay, point: pointAt(), ...staffStats };
}
