import { settings } from './settings.js';

import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import { addChoice } from './radialMenu.js'

/*
	What the hunter holds: one thing at a time (current), chosen from the Weapons ring of the spawn menu (radialMenu.js). Each gun
	(rifle.js, shotgun.js, revolver.js, sharps.js) and the discs (discgolf.js) add themselves (addWeapon) and only work, draw and
	show their ammunition while they are the one held (holding). The hands are busy, and nothing is held, at a boat's helm or on its
	ladder (hunting.handsBusy). Each says what its controls are (help), shown on the left (controlsHelp.js) under the player's own.

	THE AMMUNITION each gun has, all told: AMMO, its rounds in it (loaded: the magazine, the tube, the cylinder, the chamber) and
	the rest carried (reserve). Loading takes a round from the carried ones (takeRound); a live round taken back out goes back to them
	(giveRound). A horse's saddlebags fill every gun back up to its whole (refill, hunting.onRefill), and so does coming back after
	being shot (resetWeapons).
*/
export const AMMO = { rifle: 20, shotgun: 18, revolver: 36, sharps: 8 };
export const weaponState = { current: 'rifle' };
const weapons = new Map();		// name -> { label, detail, help(), equip(), loaded(), reset() }
const reserve = new Map();		// name -> rounds carried (not in the gun)

// a weapon: name, what it is called and a word about it in the menu, its controls (help: () => [title, lines]), and what it does when
//		taken in hand (equip), how many rounds are in it (loaded) and how to make it as it starts (reset: full, ready). menu: the ring of
//		the spawn menu it is chosen from (the staff is under Magic)
export function addWeapon(name, { label, detail, help: helpLines, equip, loaded, reset, drawn, menu = 'Weapons' }) {
	weapons.set(name, { label, detail, help: helpLines, equip, loaded, reset, drawn });
	if (name in AMMO) reserve.set(name, AMMO[name] - (loaded?.() ?? 0));
	addChoice(menu, { label, get detail() { return detail + (priceOf?.(name) ?? ''); }, act: () => { equipWeapon(name); return true; } });
}
// asked before a weapon is taken in hand: fn(name) false if it may not be (not bought yet, in the Horde game mode: horde.js). And what
//		it costs, said after its detail in the menu: fn(name) a few words, or ''
const equipGates = [];
export function gateEquip(fn) { equipGates.push(fn); }
let priceOf = null;
export function priceTag(fn) { priceOf = fn; }
addChoice('Weapons', { label: 'Empty hands', detail: 'Put away what you hold', act: () => { equipWeapon('none'); return true; } });

export function equipWeapon(name) {
	if (name != 'none' && !weapons.has(name)) return;
	if (name != weaponState.current && !equipGates.every((fn) => fn(name))) return;
	weaponState.current = name;
	weapons.get(name)?.equip?.();
	help.toast(name == 'none' ? 'Empty hands' : weapons.get(name).label);
}

// whether this one is in the hands and can be used now
export function holding(name) {
	return weaponState.current == name && settings.gameMode != 'Observe' && settings.enableTerrain && !hunting.handsBusy() && hunting.hunterLife.alive;
}

// The ammunition (see THE AMMUNITION at the top)
//-------------------------------------------------
export const carried = (name) => reserve.get(name) ?? 0;
// a round out of the carried ones, to load: false if there are none
export function takeRound(name) {
	const left = carried(name);
	if (left <= 0) return false;
	reserve.set(name, left - 1);
	return true;
}
// a live round taken back out of the gun
export function giveRound(name, count = 1) {
	reserve.set(name, Math.min(carried(name) + count, AMMO[name] - (weapons.get(name)?.loaded?.() ?? 0)));
}
// every gun back up to its whole
export function refill() {
	for (const [name, weapon] of weapons) if (name in AMMO) reserve.set(name, AMMO[name] - (weapon.loaded?.() ?? 0));
}
hunting.onRefill(refill);
// every gun as it starts, and its ammunition full (up again after being shot: players.js)
export function resetWeapons() {
	for (const weapon of weapons.values()) weapon.reset?.();
	refill();
}
// for testing: the ammunition of each, in it and carried
export function ammoState() {
	return Object.fromEntries([...weapons].filter(([name]) => name in AMMO).map(([name, w]) => [name, { loaded: w.loaded?.() ?? 0, carried: carried(name), total: AMMO[name] }]));
}
export const noAmmoWord = 'Out of ammunition: fill up at a horse\'s saddlebags';

// once a frame, after the guns: the controls of the one held, on the left
export function weaponsUpdate() {
	const weapon = weapons.get(weaponState.current);
	if (!weapon || !holding(weaponState.current) || !hunting.hunterPlace().active) { help.setWeaponHelp(null); return; }
	const [title, lines] = weapon.help();
	help.setWeaponHelp(title, lines);
}
// over the finished frame: the one held (the rifle draws itself, see rifle.js)
export function weaponsPass() {
	const weapon = weapons.get(weaponState.current);
	if (!weapon || !weapon.drawn || !holding(weaponState.current) || !hunting.hunterPlace().active) return;
	weapon.drawn();
}
