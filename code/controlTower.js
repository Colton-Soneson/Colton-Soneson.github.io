import {canvas} from './deviceSelection.js'
import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as inventory from './inventory.js'
import * as help from './controlsHelp.js'
import * as plane from './plane.js'
import * as owned from './owned.js'
import * as transformations from './transformations.js'
import { announceSpawn } from './radialMenu.js'
import { dollars } from './items.js'
import { CONTROL, controlTowerOf } from './townGround.js'

/*
	THE CONTROL TOWERS (townGround.js: THE CONTROL TOWER, one by every landing strip): climbed by their ladders (hunting.js: LADDERS ON THE
	LAND), their walkway and cab a floor to stand on, their legs, walls and rails in the way. E at the desk by the radio (in the Survival
	mode) opens THE TOWER:
		the biplane		bought (owned.js: yours for good) and brought out at the end of this strip, or, owned, brought out here
		fuel, rounds	the player's own biplane, on this strip and stopped: filled up (REFUEL), or its Vickers, its bombs and its gunner's
						pans filled (REARM). In the Survival mode the strip itself only mends it (plane.js: setStripService), and that is free
	THE BIPLANE FROM THE WHEEL (owned.js: setPlaneOut): on the open, level ground the crosshair is on, as the spawn menu's (plane.js:
	spawnSpot); with none there, at the end of the nearest strip.
	PRICES in dollars.
*/
const REFUEL = 8, REARM = 12;
const DESK_REACH = 1.8;			// metres
const metre = () => settings.forestUnitsPerMetre;

// the towers, one for each strip there is (every tile's: terrain.land.strips), each worked out once
const made = new Map();
function towers() {
	const land = terrain.land;
	if (!land) return [];
	return (land.strips ?? (land.strip ? [land.strip] : [])).map((s) => {
		const key = `${Math.round(s.x)},${Math.round(s.z)}`;
		let T = made.get(key);
		if (!T || T.land !== land) { T = { ...controlTowerOf(s, land.groundAt, metre()), strip: s, land, key }; made.set(key, T); }
		return T;
	});
}
const near = (x, z, reach) => towers().filter((T) => Math.hypot(T.x - x, T.z - z) < reach);

// THE WALKER ON THEM (see the top)
//-------------------------------------------------
hunting.addLadders((x, z) => near(x, z, 25 * metre()).map((T) => ({ id: 'control:' + T.key, foot: T.at(T.ladder.foot), head: T.at(T.ladder.head), off: T.at(T.ladder.off), out: T.e2 })));
hunting.addFloor((x, z, highest) => {
	let floor = -Infinity;
	for (const T of near(x, z, 8 * metre())) {
		const [a, b] = T.local(x, z), y = T.y0 + T.deck * metre();
		if (Math.abs(a) <= CONTROL.walk && Math.abs(b) <= CONTROL.walk && y <= highest && y > floor) floor = y;
	}
	return floor;
});
hunting.addStill((x, z, reach, add) => {
	const m = metre();
	for (const T of near(x, z, reach + 10 * m)) {
		const deck = T.y0 + T.deck * m;
		for (const [sa, sb] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
			const p = T.at([sa * (CONTROL.base - 0.3), 0, sb * (CONTROL.base - 0.3)]);
			add(p[0], p[2], 0.25 * m, terrain.land.groundAt(p[0], p[2]) - m, T.y0 + CONTROL.floor * m);
		}
		const rim = (a, b, top) => { const p = T.at([a, 0, b]); add(p[0], p[2], 0.1 * m, deck, deck + top * m); };
		const Cb = CONTROL.cab, R = CONTROL.walk - 0.08;
		for (let u = -Cb; u <= Cb + 0.01; u += 0.3) { rim(u, -Cb, 2.5); if (Math.abs(u) > CONTROL.door + 0.1) rim(u, Cb, 2.5); rim(Cb, u, 2.5); rim(-Cb, u, 2.5); }
		for (let u = -R; u <= R + 0.01; u += 0.3) { rim(u, R, 1.0); rim(u, -R, 1.0); rim(R, u, 1.0); rim(-R, u, 1.0); }
		// (the desk)
		for (const u of [-0.55, 0, 0.55]) { const p = T.at([CONTROL.desk[0] + u, 0, CONTROL.desk[1]]); add(p[0], p[2], 0.28 * m, deck, deck + 0.78 * m); }
	}
});

// THE DESK: the tower whose desk the walker is at, in the Survival mode, or null
function deskInView() {
	if (!inventory.survivalOn()) return null;
	const p = hunting.hunterPlace(), m = metre();
	if (!p.active || p.on != 'land') return null;
	for (const T of near(p.x, p.z, 8 * m)) {
		const d = T.at(T.desk);
		if (Math.hypot(d[0] - p.x, d[2] - p.z) < DESK_REACH * m && Math.abs(p.y - T.y0 - T.deck * m) < 1.2 * m) return T;
	}
	return null;
}
hunting.addPrompt(() => deskInView() ? { name: 'Control tower', keys: 'E the radio: a biplane, fuel, rounds' } : null);
hunting.onUse(() => { const T = deskInView(); if (!T) return false; openTower(T); return true; });

// THE BIPLANE
//-------------------------------------------------
// the player's own biplanes there are (any bought, brought out, or from the spawn menu), and the one on a strip, stopped
const mine = () => plane.planes.filter((p) => plane.isMine(p) && p.destroyed < 0 && p.wreck < 0);
const onThisStrip = (T) => mine().find((p) => { const s = plane.stripUnder(p); return s && Math.round(s.x) == Math.round(T.strip.x) && Math.round(s.z) == Math.round(T.strip.z) && Math.hypot(...p.v) < 0.5; }) ?? null;
// brought out at the end of a strip (the one nearer the tower), facing along it; the player's own before it put away
function outAtStrip(s) {
	const m = metre();
	const x = s.x - s.ax * (s.half - 14 * m), z = s.z - s.az * (s.half - 14 * m);
	return outAt(x, z, Math.atan2(s.ax, -s.az), 'Your biplane waits at the end of the strip');
}
function outAt(x, z, heading, said) {
	for (const old of mine()) {
		if (old.crew.pilot === 'me' || old.crew.gunner === 'me') continue;
		plane.removePlane(old);
		announceSpawn('plane', null, old);
	}
	const p = plane.spawnPlane(x, z, { heading });
	announceSpawn('plane', p, null);
	help.toast(said, 3);
	return p;
}
// FROM THE WHEEL (see the top)
owned.setPlaneOut(() => {
	const spot = plane.spawnSpot([settings.camPosX, settings.camPosY, settings.camPosZ], transformations.getCameraForward());
	if (!spot.reason && !spot.strip) return !!outAt(spot.x, spot.z, spot.heading, 'Your biplane: F at a cockpit to climb in');
	const p = hunting.hunterPlace();
	const strips = terrain.land?.strips ?? [];
	if (!strips.length) { help.toast(spot.reason ?? 'There is no landing strip'); return false; }
	const nearest = strips.reduce((a, b) => Math.hypot(b.x - p.x, b.z - p.z) < Math.hypot(a.x - p.x, a.z - p.z) ? b : a);
	return !!outAtStrip(nearest);
});
// in the Survival mode the strip mends it, and the rest is bought (see the top)
plane.setStripService(() => inventory.survivalOn() ? { fuel: false, arms: false } : { fuel: true, arms: true });

// THE TOWER (see the top)
//-------------------------------------------------
const panel = { tower: null };
export const towerState = panel;
const root = document.createElement('div');
root.style.cssText = 'position: fixed; inset: 0; z-index: 21; display: none; background: rgba(10, 8, 6, 0.8); color: #e6dcc8; font: 13px Georgia, "Times New Roman", serif; overflow: auto;';
document.body.appendChild(root);
const html = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const button = (act, label, off = false) => `<button data-act="${act}" ${off ? 'disabled' : ''} style="padding:4px 10px; margin-left:6px; border:1px solid #8a7452; border-radius:4px; background:${off ? '#2e261c' : '#4a3a28'}; color:${off ? '#8a7a60' : '#f0e4c8'}; font:inherit; cursor:${off ? 'default' : 'pointer'};">${label}</button>`;
const row = (name, detail, right) => `<div style="display:flex; align-items:center; gap:10px; padding:6px 8px; border-bottom:1px solid rgba(200,180,140,0.15);"><div><div>${html(name)}</div><div style="font-size:11px; color:#b8a888;">${html(detail)}</div></div><div style="margin-left:auto; display:flex; align-items:center;">${right}</div></div>`;
function render() {
	const T = panel.tower;
	if (!T) return;
	const P = owned.PRICES, here = onThisStrip(T);
	let body = owned.owned.plane
		? row('Your biplane', 'A Bristol Fighter, two seats: pilot and gunner. Brought out at the end of this strip (and from T, anywhere)', button('out', 'Bring it out'))
		: row('A biplane', 'A Bristol Fighter, two seats: pilot and gunner. Yours for good: brought out at the end of this strip now, and from T wherever you are', `<span style="margin-right:4px;">${dollars(P.plane * 100)}</span>${button('buy', 'Buy')}`);
	if (here) {
		const full = here.fuel > 0.995, armed = here.vickers >= 500 && here.bombs >= 4;
		body += row('Fuel', `Your biplane, on this strip: its tank ${Math.round(here.fuel * 100)}% full`, `<span style="margin-right:4px;">${dollars(REFUEL * 100)}</span>${button('fuel', full ? 'Full' : 'Refuel', full)}`);
		body += row('Rounds and bombs', `Its Vickers ${here.vickers} rounds, ${here.bombs} set${here.bombs == 1 ? '' : 's'} of bombs, the gunner's pans`, `<span style="margin-right:4px;">${dollars(REARM * 100)}</span>${button('arms', armed ? 'Full' : 'Rearm', armed)}`);
	} else body += row('Fuel and rounds', 'Land your biplane on this strip and stop it, and they are brought out to it from here', '');
	body += row('Repairs', 'Free: stopped on the strip with the parking brake on, it is mended in ' + plane.RELOAD_SECONDS + ' s', '');
	root.innerHTML = `<div style="margin:auto; width:min(640px, calc(100vw - 32px)); background:rgba(40,32,24,0.96); border:1px solid #5a4a36; border-radius:6px; padding:12px 16px;">
		<div style="display:flex; align-items:center; margin-bottom:8px;"><div style="font-size:16px; letter-spacing:0.12em;">CONTROL TOWER</div>
		<div style="margin-left:auto;">You carry <b>${dollars(inventory.moneyCarried())}</b>${button('close', 'Close')}</div></div>${body}
		<div style="margin-top:8px; font-size:11px; color:#9a8a70;">Esc, Tab, F or E to leave</div></div>`;
}
export function openTower(T) {
	panel.tower = T;
	root.style.display = 'flex';
	hunting.input.menuOpen = true;
	if (document.pointerLockElement) document.exitPointerLock();
	render();
}
export function closeTower() {
	if (!panel.tower) return;
	panel.tower = null;
	root.style.display = 'none';
	hunting.input.menuOpen = false;
	hunting.releaseKeys();
	canvas.requestPointerLock?.()?.catch?.(() => {});
}
const pay = (dollarsOf) => { if (inventory.pay(dollarsOf * 100)) return true; help.toast('Not enough money'); return false; };
root.addEventListener('click', (e) => {
	const el = e.target.closest('[data-act]');
	if (!el || el.disabled || !panel.tower) return;
	const act = el.dataset.act, T = panel.tower, here = onThisStrip(T);
	if (act == 'close') { closeTower(); return; }
	if (act == 'buy') owned.buy('plane', () => outAtStrip(T.strip));
	if (act == 'out') outAtStrip(T.strip);
	if (act == 'fuel' && here && pay(REFUEL)) { plane.refuel(here); help.toast('Refuelled', 2); }
	if (act == 'arms' && here && pay(REARM)) { plane.rearm(here); help.toast('Rearmed: the Vickers, the bombs and the gunner\'s pans', 2.5); }
	render();
});
window.addEventListener('keydown', (e) => {
	if (!panel.tower) return;
	if (e.code == 'Escape' || e.code == 'Tab' || e.code == 'KeyE' || e.code == 'KeyF') { e.preventDefault(); closeTower(); }
});
inventory.onChange(() => render());
// Once a frame: walked away, the panel shuts; open, it is drawn again every so often (the plane on the strip comes, stops, goes)
let drawnAt = 0;
export function controlTowerUpdate() {
	if (!panel.tower) return;
	const T = panel.tower, p = hunting.hunterPlace(), d = T.at(T.desk);
	if (!inventory.survivalOn() || !hunting.hunterLife.alive || Math.hypot(d[0] - p.x, d[2] - p.z) > 4 * metre()) { closeTower(); return; }
	if (performance.now() - drawnAt > 500) { drawnAt = performance.now(); render(); }
}

// for testing
export const towersForTest = () => towers().map((T) => ({ x: T.x, z: T.z, y0: T.y0, deck: T.y0 + T.deck * metre(), desk: T.at(T.desk), ladder: { foot: T.at(T.ladder.foot), head: T.at(T.ladder.head), off: T.at(T.ladder.off) }, strip: T.strip }));
