import {canvas} from './deviceSelection.js'

import { settings } from './settings.js';

import * as transformations from './transformations.js'
import * as hunting from './hunting.js'
import * as boat from './boat.js'
import * as help from './controlsHelp.js'

/*
	THE SPAWN MENU (T, in the Hunting game mode): a ring of choices in the middle of the picture. The mouse picks one (the
	view stops turning while it is open: hunting.input.menuOpen), and a click takes it (or let go of T, after holding it). A
	choice with more under it opens its own ring: right click goes back out, T again or Esc closes it.
		Vehicles		a boat (the dinghy, the schooner) where the crosshair points, no further off than boat.SPAWN_REACH, on water
						deep enough all round it not to touch the shore (boat.spawnSpot). One of each for each player: another
						takes the place of the first
		Weapons			what is in the hands
		Magic			the wizard's staff, and its spells (staff.js)
	What each choice does is said by whoever adds it (addChoice): the horse, the guns and the discs add their own.

	SPAWNED (onSpawn): told of each boat put in the sea here, for net.js to tell the others.
*/
const RING_OUT = 165, RING_IN = 62;		// pixels
const PICK_RADIUS = 28;					// pixels the mouse has to go from the middle for a choice to be picked
const HOLD_SECONDS = 0.3;				// T held this long: letting go of it takes the choice under the mouse

const menu = {
	open: false,
	path: [],				// the choices opened, from the top
	cursor: [0, 0],			// where the mouse has gone since the ring opened (pixels)
	hovered: -1,
	openedAt: 0, holding: false,
};

// What is in it
//-------------------------------------------------
// each: { label, detail, items (a ring under it) or act() (what it does: false if it could not), shown() (whether it is there now) }
const root = { label: 'Spawn', items: [
	{ label: 'Vehicles', detail: 'A boat on the water you point at, or a horse on the land', items: [] },
	{ label: 'Weapons', detail: 'What you hold', items: [] },
	{ label: 'Magic', detail: 'A wizard\'s staff, and its spells', items: [] },
] };
// a choice added under one of the top ones ('Vehicles', 'Weapons' or 'Magic')
export function addChoice(under, choice) {
	root.items.find((item) => item.label == under).items.push(choice);
	if (menu.open) redraw();
}

const spawnListeners = [];
// told of each vehicle put out here: fn(kind ('boat', 'horse'), vehicle, null), and of each taken away to make room for it: fn(kind, null, vehicle)
export function onSpawn(fn) { spawnListeners.push(fn); }
export function announceSpawn(kind, vehicle, removed) {
	for (const fn of spawnListeners) fn(kind, vehicle, removed);
}

// a boat where the crosshair points (see Vehicles at the top). The player's own of that kind, if it has one, goes
export function launchBoat(name) {
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ];
	const spot = boat.spawnSpot(name, eye, transformations.getCameraForward());
	if (spot.reason) {
		help.toast(spot.reason);
		return false;
	}
	for (const old of boat.boats.filter((b) => boat.isMine(b) && b.vessel.name == name)) {
		boat.removeBoat(old);
		announceSpawn('boat', null, old);
	}
	const b = boat.spawnBoat(spot.x, spot.z, name, { yaw: spot.yaw, anchored: true });
	announceSpawn('boat', b, null);
	help.toast(b.anchor ? `${name} in the water, at anchor (G on board to raise it)` : `${name} in the water`);
	return true;
}
addChoice('Vehicles', { label: 'Dinghy', detail: 'A sailing dinghy, 4.3 m: a mainsail and a jib', act: () => launchBoat('Dinghy') });
addChoice('Vehicles', { label: 'Schooner', detail: 'A topsail schooner, 18 m, about 1800', act: () => launchBoat('Schooner') });

// Input
//-------------------------------------------------
const locked = () => document.pointerLockElement == canvas;
const usable = () => settings.gameMode == 'Hunting' && hunting.hunterPlace().active && hunting.hunterLife.alive;
const ring = () => {
	let at = root;
	for (const k of menu.path) at = at.items.filter((item) => !item.shown || item.shown())[k] ?? at;
	return at;
};
const choices = () => ring().items.filter((item) => !item.shown || item.shown());

function openMenu() {
	menu.open = true;
	menu.path = [];
	menu.cursor = [0, 0];
	menu.hovered = -1;
	menu.openedAt = performance.now();
	menu.holding = true;
	hunting.input.menuOpen = true;
	redraw();
}
export function closeMenu() {
	menu.open = false;
	menu.holding = false;
	hunting.input.menuOpen = false;
	redraw();
}
// the choice under the mouse: into its ring, or done
function take() {
	const list = choices();
	const item = list[menu.hovered];
	if (!item) return;
	if (item.items) {
		menu.path.push(menu.hovered);
		menu.cursor = [0, 0];
		menu.hovered = -1;
		redraw();
		return;
	}
	closeMenu();
	item.act?.();
}
function back() {
	if (menu.path.length == 0) { closeMenu(); return; }
	menu.path.pop();
	menu.cursor = [0, 0];
	menu.hovered = -1;
	redraw();
}

window.addEventListener('keydown', (event) => {
	if (event.code != 'KeyT' || event.repeat) return;
	if (menu.open) { closeMenu(); return; }
	if (usable() && locked()) openMenu();
});
window.addEventListener('keyup', (event) => {
	if (event.code != 'KeyT' || !menu.open || !menu.holding) return;
	menu.holding = false;
	// held, and let go over a choice: that one
	if ((performance.now() - menu.openedAt) / 1000 >= HOLD_SECONDS && menu.hovered >= 0) take();
});
// (before anything else hears the click: the gun must not fire while the menu has it)
window.addEventListener('mousedown', (event) => {
	if (!menu.open) return;
	event.stopImmediatePropagation();
	event.preventDefault();
	if (event.button == 0) take();
	if (event.button == 2) back();
}, true);
window.addEventListener('mouseup', (event) => { if (menu.open) event.stopImmediatePropagation(); }, true);
window.addEventListener('wheel', (event) => { if (menu.open) { event.stopImmediatePropagation(); event.preventDefault(); } }, { capture: true, passive: false });
window.addEventListener('mousemove', (event) => {
	if (!menu.open) return;
	const x = menu.cursor[0] + event.movementX, y = menu.cursor[1] + event.movementY;
	const far = Math.hypot(x, y), most = RING_OUT * 0.8;
	menu.cursor = far > most ? [x / far * most, y / far * most] : [x, y];
	pick();
});
document.addEventListener('pointerlockchange', () => { if (!locked() && menu.open) closeMenu(); });

// the choice the mouse is towards (round from the top, clockwise)
function pick() {
	const list = choices();
	const [x, y] = menu.cursor;
	let hovered = -1;
	if (Math.hypot(x, y) > PICK_RADIUS && list.length) {
		const angle = (Math.atan2(x, -y) + Math.PI * 2) % (Math.PI * 2);
		hovered = Math.floor((angle + Math.PI / list.length) / (Math.PI * 2) * list.length) % list.length;
	}
	if (hovered != menu.hovered) {
		menu.hovered = hovered;
		redraw();
	}
	cursorDot.setAttribute('cx', (200 + x).toFixed(1));
	cursorDot.setAttribute('cy', (200 + y).toFixed(1));
}

// Drawn
//-------------------------------------------------
const box = document.createElement('div');
box.style.cssText = 'position: fixed; left: 50%; top: 50%; width: 400px; height: 400px; margin: -200px 0 0 -200px; z-index: 7; pointer-events: none; display: none; font-family: system-ui, sans-serif; user-select: none;';
document.body.appendChild(box);
const NS = 'http://www.w3.org/2000/svg';
const svg = document.createElementNS(NS, 'svg');
svg.setAttribute('viewBox', '0 0 400 400');
svg.setAttribute('width', '400');
svg.setAttribute('height', '400');
box.appendChild(svg);
const wedges = document.createElementNS(NS, 'g');
const cursorDot = document.createElementNS(NS, 'circle');
cursorDot.setAttribute('r', '4');
cursorDot.setAttribute('fill', '#f2c46d');
svg.append(wedges, cursorDot);
const middle = document.createElement('div');
middle.style.cssText = 'position: absolute; left: 50%; top: 50%; width: 112px; transform: translate(-50%, -50%); text-align: center; color: #e8e8e8; font-size: 11px; line-height: 1.3;';
box.appendChild(middle);

const html = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function redraw() {
	box.style.display = menu.open ? '' : 'none';
	if (!menu.open) return;
	const list = choices();
	const n = Math.max(list.length, 1);
	const at = (angle, r) => [200 + Math.sin(angle) * r, 200 - Math.cos(angle) * r];
	let shapes = '';
	list.forEach((item, k) => {
		const a0 = (k - 0.5) / n * Math.PI * 2 + 0.02, a1 = (k + 0.5) / n * Math.PI * 2 - 0.02;
		const big = a1 - a0 > Math.PI ? 1 : 0;
		const [x0, y0] = at(a0, RING_OUT), [x1, y1] = at(a1, RING_OUT), [x2, y2] = at(a1, RING_IN), [x3, y3] = at(a0, RING_IN);
		const lit = k == menu.hovered;
		const path = n == 1
			? `M ${200} ${200 - RING_OUT} A ${RING_OUT} ${RING_OUT} 0 1 1 ${199.9} ${200 - RING_OUT} Z M ${200} ${200 - RING_IN} A ${RING_IN} ${RING_IN} 0 1 0 ${199.9} ${200 - RING_IN} Z`
			: `M ${x0} ${y0} A ${RING_OUT} ${RING_OUT} 0 ${big} 1 ${x1} ${y1} L ${x2} ${y2} A ${RING_IN} ${RING_IN} 0 ${big} 0 ${x3} ${y3} Z`;
		shapes += `<path d="${path}" fill="${lit ? 'rgba(242, 196, 109, 0.42)' : 'rgba(10, 12, 16, 0.62)'}" stroke="rgba(255, 255, 255, ${lit ? 0.7 : 0.22})" stroke-width="1.2" fill-rule="evenodd"/>`;
		const [lx, ly] = at(k / n * Math.PI * 2, (RING_OUT + RING_IN) / 2);
		const more = item.items ? ' ›' : '';
		shapes += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="#fff" font-size="13" font-weight="${lit ? 700 : 500}" text-anchor="middle" dominant-baseline="middle" style="paint-order: stroke; stroke: rgba(0,0,0,0.6); stroke-width: 3px;">${html(item.label + more)}</text>`;
	});
	wedges.innerHTML = shapes;
	const hovered = list[menu.hovered];
	const title = ring().label;
	middle.innerHTML = hovered
		? `<div style="font-weight: 700; font-size: 13px;">${html(hovered.label)}</div><div style="opacity: 0.75; margin-top: 3px;">${html(hovered.detail ?? '')}</div>`
		: `<div style="font-weight: 700; font-size: 13px;">${html(title)}</div><div style="opacity: 0.6; margin-top: 3px;">${menu.path.length ? 'right click: back' : 'move the mouse, click to choose'}</div>`;
}

// for testing: open it, go to a choice by its labels (['Vehicles', 'Dinghy']), and take it. Returns what the choice gave back
export function testChoose(labels) {
	openMenu();
	let result;
	for (const label of labels) {
		const k = choices().findIndex((item) => item.label == label);
		if (k < 0) { closeMenu(); return 'no ' + label; }
		const item = choices()[k];
		menu.hovered = k;
		if (item.items) take();
		else { closeMenu(); result = item.act?.(); }
	}
	return result;
}
export function testOpen(labels = []) {
	openMenu();
	for (const label of labels) { menu.hovered = choices().findIndex((item) => item.label == label); take(); }
	menu.cursor = [60, -40];
	pick();
}
export const menuState = menu;
