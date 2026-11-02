import { settings } from './settings.js';

import * as vm from './viewmodel.js'
import * as help from './controlsHelp.js'
import * as hunting from './hunting.js'
import { ITEMS, makeItem } from './items.js'
import * as inventory from './inventory.js'
import * as loot from './loot.js'
import * as campfires from './campfires.js'
import * as stations from './stations.js'

/*
	THE COOKING SPIT of the Survival mode: the only way meat is cooked over a campfire (or a cabin's hearth). Held (survivalTools.js), a right click opens its one slot (inventoryUI.js): a piece of raw meat on it
	(MEATS: venison, rabbit, wolf, bear, rat, moose), one at a time. A left click holds it out at arm's length (POSE.out), or back in. Held out with its end over a fire burning (within OVER metres of it across, and
	between ABOVE[0] and ABOVE[1] over it), what is on it cooks: a fire burning well in COOK.full seconds, burning low in COOK.half, embers in COOK.embers. Shown in the middle of the screen as it goes, a ring
	filling (ring). Left on, it goes on cooking: past DONE it is cooked, at BURNT burnt. Taken off, it is what it has come to: raw, cooked (MEATS), or burnt meat (burntMeat: thirstier, and next to nothing for hunger).
	It is all in the player's own hands (item.meat: { type, cook }, kept with the spit), and the fires are everyone's already, so there is nothing about it to send.
*/
export const MEATS = { venison: 'cookedVenison', rabbitMeat: 'cookedRabbit', wolfMeat: 'cookedWolf', bearMeat: 'cookedBear', ratMeat: 'cookedRat', mooseMeat: 'cookedMoose' };
const DONE = 1, BURNT = 1.75;
const COOK = { full: 16, half: 24, embers: 40 };			// seconds to cooked
const OVER = 0.8, ABOVE = [0.05, 1.7];						// metres
// where it is held, in the camera's space (metres): its hand, and how far along it its end is
export const POSE = { rest: { x: 0.24, y: -0.36, z: -0.38, pitch: 0.55, yaw: -0.25 }, out: { x: 0.12, y: -0.32, z: -0.5, pitch: -0.05, yaw: -0.04 }, length: 1.25 };
export const spitState = { out: 0, extended: false, item: null };

export const typeNow = (meat) => !meat ? null : meat.cook >= BURNT ? 'burntMeat' : meat.cook >= DONE ? MEATS[meat.type] : meat.type;
export const isRaw = (type) => !!MEATS[type];
// its slot (inventoryUI.js): a piece out of a stack on to it, or what is on it off it
export function put(spit, item) {
	if (!spit || spit.type != 'spit') return false;
	if (spit.meat) { help.toast('There is meat on it already'); return false; }
	if (!isRaw(item.type)) { help.toast('Only raw meat goes on it'); return false; }
	inventory.useOne(item);
	spit.meat = { type: item.type, cook: 0 };
	inventory.changed();
	return true;
}
export function takeOff(spit) {
	if (!spit?.meat) return null;
	const it = makeItem(typeNow(spit.meat));
	spit.meat = null;
	inventory.changed();
	if (!inventory.give(it)) loot.dropHere([it]);
	return it;
}
// the end of it, in the world (world units), as it is held now
export function tipNow() {
	const k = vm.ease(spitState.out), P = POSE, mix = (a, b) => a + (b - a) * k;
	const pitch = mix(P.rest.pitch, P.out.pitch), yaw = mix(P.rest.yaw, P.out.yaw);
	const hand = [mix(P.rest.x, P.out.x), mix(P.rest.y, P.out.y), mix(P.rest.z, P.out.z)];
	// (as survivalTools.js draws it: along its own +z, turned by yaw and pitch, and +z made the camera's forward)
	const along = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
	return vm.toWorld(hand.map((v, i) => v + along[i] * P.length), vm.cameraAxes());
}
// what fire its end is over, burning: 'full', 'half', 'embers', or null
function fireUnder(tip) {
	const m = settings.forestUnitsPerMetre;
	const over = (at) => Math.hypot(at[0] - tip[0], at[2] - tip[2]) / m < OVER && (tip[1] - at[1]) / m > ABOVE[0] && (tip[1] - at[1]) / m < ABOVE[1];
	let best = null;
	for (const f of campfires.fireList()) if (over(f.at)) { const s = campfires.stageOf(f); if (COOK[s] && (!best || COOK[s] < COOK[best])) best = s; }
	for (const s of stations.list()) if (s.kind == 'fireplace' && stations.burning(s) && over(stations.toWorld(s, [0, 0.05, -0.1]))) best = best ?? (stations.fuelOf(s) > 0.5 * campfires.FULL ? 'full' : 'half');
	return best;
}

// THE RING (see the top), under the cross in the middle of the screen
const ring = document.createElement('div');
ring.style.cssText = 'position: fixed; left: 50%; top: 50%; transform: translate(-50%, calc(-100% - 26px)); z-index: 6; pointer-events: none; display: none; text-align: center; font: 600 12px system-ui, sans-serif; color: #f4ead8; text-shadow: 0 1px 3px #000;';
document.body.appendChild(ring);
let shown = '';
function showRing(meat, fire) {
	const k = meat.cook, burning = k >= DONE, r = 22, c = 2 * Math.PI * r;
	const fill = burning ? Math.min((k - DONE) / (BURNT - DONE), 1) : k, colour = k >= BURNT ? '#3a2a22' : burning ? '#e0503a' : '#f2c46d';
	const said = k >= BURNT ? 'Burnt' : burning ? (fire ? 'Cooked: burning, take it off' : 'Cooked') : fire ? `Cooking ${Math.round(k * 100)}%` : `${Math.round(k * 100)}% cooked: hold it over a fire`;
	const key = [Math.round(fill * 100), said].join('|');
	ring.style.display = '';
	if (key == shown) return;
	shown = key;
	ring.innerHTML = `<svg width="60" height="60" viewBox="-30 -30 60 60" style="display:block; margin:0 auto;"><circle r="${r}" fill="rgba(0,0,0,0.45)" stroke="${burning ? '#7ac06a' : 'rgba(255,255,255,0.25)'}" stroke-width="5"/>`
		+ `<circle r="${r}" fill="none" stroke="${colour}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(c * Math.min(Math.max(fill, 0), 1)).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90)"/></svg><div>${ITEMS[meat.type].name.replace('Raw v', 'V').replace('Raw ', 'The ')}: ${said}</div>`;
}

// Once a frame, while it is held (survivalTools.js): out or in, and cooking
export const spitStats = { cooked: 0, burnt: 0 };
let lastTime = performance.now();
export function spitUpdate(spit, holding) {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	spitState.item = holding ? spit : null;
	if (!holding) { spitState.extended = false; spitState.out = 0; ring.style.display = 'none'; return; }
	spitState.out = vm.toward(spitState.out, spitState.extended ? 1 : 0, dt / 0.35);
	const meat = spit?.meat;
	if (!meat) { ring.style.display = 'none'; return; }
	const fire = spitState.out > 0.95 && !hunting.input.menuOpen ? fireUnder(tipNow()) : null;
	if (fire) {
		const was = meat.cook;
		meat.cook = Math.min(meat.cook + dt / COOK[fire], BURNT + 0.01);
		if (was < DONE && meat.cook >= DONE) { spitStats.cooked++; help.toast('Cooked: take it off before it burns', 2); }
		if (was < BURNT && meat.cook >= BURNT) spitStats.burnt++;
	}
	if (spitState.out > 0.5) showRing(meat, fire); else ring.style.display = 'none';
}
export function toggle() { spitState.extended = !spitState.extended; }
// its slot opened (inventoryUI.js)
const openListeners = [];
export function onOpen(fn) { openListeners.push(fn); }
export function open(spit) { for (const fn of openListeners) fn(spit); }
export const fireUnderForTest = () => fireUnder(tipNow());
