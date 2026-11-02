import {canvas} from './deviceSelection.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as vm from './viewmodel.js'
import { MESHES } from './itemMeshes.js'
import * as inventory from './inventory.js'

/*
	THE JOURNAL: everything a Survival player reads and works from is written in it, by hand, in charcoal, as the map is (survivalMap.js). This is the look of that, for what uses it (inventoryUI.js, stations.js, cabins.js), and the model pulled out of the coat for it:
		PAPER		the page, as a picture (warm, uneven, the same marks every time)
		the style	.jr classes: a hand's letters, boxes gone over twice, and the charcoal filter (#charcoal: shakes every stroke a little)
		pull, put	the journal drawn out of the coat and opened (journal: itemMeshes.js; PULL seconds), and whatever is to be shown shown once it is; and put away. While it is out, the mouse is free.
		menu		a page of its own for a workstation or a plan: shown at once, Tab, Esc or F shuts it
*/
export const INK = '#2b2520', SOFT = 'rgba(43, 37, 32, 0.55)', FAINT = 'rgba(43, 37, 32, 0.25)', RED = '#7a2a18';
export const HAND = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
const PULL = 0.42;

// THE PAPER
function makePaper() {
	const c = document.createElement('canvas');
	c.width = c.height = 512;
	const ctx = c.getContext('2d');
	let seed = 7;
	const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
	ctx.fillStyle = '#e6dcc4';
	ctx.fillRect(0, 0, 512, 512);
	for (let k = 0; k < 2600; k++) { ctx.fillStyle = `rgba(${90 + random() * 60}, ${70 + random() * 40}, 40, ${random() * 0.06})`; ctx.fillRect(random() * 512, random() * 512, 2 + random() * 6, 1 + random() * 3); }
	for (let k = 0; k < 16; k++) {
		const x = random() * 512, y = random() * 512, r = 30 + random() * 70, g = ctx.createRadialGradient(x, y, 0, x, y, r);
		g.addColorStop(0, 'rgba(40, 32, 26, 0.05)'); g.addColorStop(1, 'rgba(40, 32, 26, 0)');
		ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
	}
	return c.toDataURL('image/png');
}
export const PAPER = makePaper();

// THE STYLE
const style = document.createElement('style');
style.textContent = `
.jr-page { background: url(${PAPER}); color: ${INK}; font-family: ${HAND}; box-shadow: 0 12px 50px rgba(0,0,0,0.65), inset 0 0 60px rgba(70,50,30,0.3); }
.jr-spread { background: linear-gradient(90deg, rgba(40,28,18,0) 47.5%, rgba(40,28,18,0.2) 49.6%, rgba(40,28,18,0.32) 50%, rgba(40,28,18,0.2) 50.4%, rgba(40,28,18,0) 52.5%), url(${PAPER}); color: ${INK}; font-family: ${HAND}; box-shadow: 0 12px 50px rgba(0,0,0,0.65), inset 0 0 70px rgba(70,50,30,0.3); border-radius: 4px; }
.jr-title { font-size: 15px; font-weight: bold; letter-spacing: 0.04em; border-bottom: 2px solid ${INK}; filter: url(#charcoal); padding-bottom: 1px; margin-bottom: 7px; display: inline-block; }
.jr-box { border: 1.6px solid ${INK}; border-radius: 3px 5px 2px 6px; outline: 1px solid ${FAINT}; outline-offset: 1px; filter: url(#charcoal); }
.jr-btn { display: inline-block; font-family: ${HAND}; color: ${INK}; background: transparent; border: 1.6px solid ${INK}; border-radius: 4px 2px 5px 3px; padding: 2px 10px; cursor: pointer; font-size: 13px; }
.jr-btn:hover:not(:disabled) { background: rgba(43,37,32,0.14); }
.jr-btn:disabled { opacity: 0.4; cursor: default; text-decoration: line-through; }
.jr-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 6px 2px; border-bottom: 1px dashed ${FAINT}; }
.jr-need { font-size: 12px; color: ${SOFT}; }
.jr-short { color: ${RED}; font-weight: bold; }
`;
document.head.appendChild(style);
const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
defs.setAttribute('style', 'position: absolute; width: 0; height: 0;');
defs.innerHTML = '<filter id="charcoal" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.05 0.08" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/></filter>';
document.body.appendChild(defs);

// PULLED OUT, AND PUT AWAY
const view = new vm.Viewmodel('held journal', MESHES.journal.data);
const state = { phase: 'away', t: 0, before: 'none', shown: null, closed: null };
export const journalState = state;
export const journalOut = () => state.phase != 'away';
export function pull(shown) {
	if (state.phase == 'putting') { state.phase = 'pulling'; state.t = Math.max(PULL - state.t, 0); state.shown = shown; return true; }
	if (state.phase != 'away') return false;
	state.before = weapons.weaponState.current;
	if (state.before != 'none') weapons.equipWeapon('none');
	state.phase = 'pulling'; state.t = 0; state.shown = shown;
	hunting.input.menuOpen = true;
	if (document.pointerLockElement) document.exitPointerLock();
	return true;
}
export function put(closed = null) {
	if (state.phase == 'away' || state.phase == 'putting') return;
	state.phase = 'putting'; state.t = 0; state.closed = closed;
}
let lastTime = performance.now();
export function journalUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (state.phase == 'away' || state.phase == 'open') return;
	state.t += dt;
	if (state.t < PULL) return;
	if (state.phase == 'pulling') { state.phase = 'open'; const fn = state.shown; state.shown = null; fn?.(); return; }
	state.phase = 'away';
	hunting.input.menuOpen = false;
	hunting.releaseKeys();
	const fn = state.closed; state.closed = null; fn?.();
	if (hunting.hunterLife.alive && inventory.survivalOn()) canvas.requestPointerLock?.()?.catch?.(() => {});
	if (state.before != 'none') weapons.equipWeapon(state.before);
}
// over the finished frame (rotatingCube.js, with the guns and the map)
export function journalPass() {
	if (state.phase != 'pulling' && state.phase != 'putting') return;
	const k = vm.ease(state.phase == 'pulling' ? state.t / PULL : 1 - state.t / PULL), open = vm.ease(Math.max(k * 1.7 - 0.7, 0));
	const hinge = -0.085, parts = [];
	parts[1] = mat4.multiply(mat4.translation([hinge, 0, 0]), mat4.multiply(mat4.rotationY(-open * 2.9), mat4.translation([-hinge, 0, 0])));
	let mtx = mat4.translation([0.04 * (1 - k), -0.36 + k * 0.33, -0.5 + k * 0.2]);
	mtx = mat4.rotateX(mtx, 1.05 * (1 - k) + 0.05);
	mtx = mat4.rotateY(mtx, Math.PI);
	mtx = mat4.scale(mtx, [1, 1, -1]);
	view.draw(mtx, parts);
}

// A PAGE of its own (see the top): render() gives what is on it, and a click on anything with a data-act is act(its value, the element). Open at most one
const root = document.createElement('div');
root.style.cssText = 'position: fixed; inset: 0; z-index: 20; display: none; background: rgba(10, 8, 6, 0.72); align-items: center; justify-content: center; user-select: none;';
const page = document.createElement('div');
page.className = 'jr-page';
page.style.cssText = 'min-width: 460px; max-width: min(92vw, 980px); max-height: 90vh; overflow: auto; padding: 22px 30px 18px; border-radius: 4px;';
root.appendChild(page);
document.body.appendChild(root);
let current = null;
export const menuOpen = () => current;
export function openMenu(menu, viaJournal = false) {
	if (current) closeMenu(true);
	current = menu;
	const show = () => { root.style.display = 'flex'; refreshMenu(); };
	if (viaJournal) { pull(show); return; }
	hunting.input.menuOpen = true;
	if (document.pointerLockElement) document.exitPointerLock();
	show();
}
export function refreshMenu() { if (current && root.style.display != 'none') page.innerHTML = current.render(); }
export function closeMenu(quietly = false) {
	if (!current) return;
	const was = current;
	current = null;
	root.style.display = 'none';
	if (journalOut()) { put(); return; }
	if (quietly) return;
	hunting.input.menuOpen = false;
	hunting.releaseKeys();
	was.closed?.();
	canvas.requestPointerLock?.()?.catch?.(() => {});
}
page.addEventListener('click', (e) => {
	const el = e.target.closest('[data-act]');
	if (el && !el.disabled) { current?.act?.(el.dataset.act, el); refreshMenu(); }
});
window.addEventListener('keydown', (e) => {
	if (current && (e.code == 'Escape' || e.code == 'Tab' || e.code == 'KeyF')) { e.preventDefault(); closeMenu(); }
});
