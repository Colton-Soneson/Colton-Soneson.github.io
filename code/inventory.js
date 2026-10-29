import { settings } from './settings.js';

import * as weapons from './weapons.js'
import * as help from './controlsHelp.js'
import { ITEMS, SLOTS, HANDS, makeItem, cleanItem, fits, placeFor, handSlots, sizeOf, weightOf } from './items.js'

/*
	WHAT THIS PLAYER CARRIES, in the Survival game mode (settings.gameMode 'Hunting'; the menu calls it Survival). items.js says what each
	thing is.
		worn		a slot each (items.js: SLOTS): the clothes, the wrist, the backpack, the extra (a poncho, a webbing belt)
		hands		the equippables: primary, secondary, item 1 to 4. Only these come up on T (radialMenu.js), and only these can be
					taken in the hands (weapons.js: gateEquip), but in god mode (survival.js)
		the grids	the POCKET (one cell, always there: the money, say), the backpack's own (its contents), each pouch attached to it (its
					attached, each with contents), and the extra's if it has one (the satchel). Where a thing goes in them, it fits (items.js:
					fits). Money (items.js) goes only in the pocket and the backpack's grids (MONEY_GRIDS)
		the watch	worn on the wrist, it can be taken up from T to be read (survivalTools.js), as if it were in the hands
	THE AMMUNITION of a gun in the hands is the rounds of its kind carried in the grids (weapons.js: setAmmoSource): loading takes one off a
	stack, a live round taken out goes back on one (or a new stack, where there is room).
	A NEW PLAYER (START_KIT) has a lighter, a hatchet and a compass in the item slots, a wristwatch on (START_WORN), a haversack on
	(START_PACK) with the bedroll straps on it and a canvas bedroll in them, and START_MONEY in its pocket. It comes into the Survival mode with nothing in its hands (whatever another mode left in them
	is put away: inventoryUpdate), and so after being down. What it carries is kept in the browser (SAVED, with the KIT it started from: a
	newer kit starts it again) from one visit to the next, and left on its body when it is down (loot.js), and it starts again from the
	start kit.
	Every change is told (onChange: the inventory screen, inventoryUI.js; and the others in a game see what it holds, net.js).
*/
const SAVED = 'survivalInventory';
const START_KIT = { item1: 'lighter', item2: 'hatchet', item3: 'compass' };
const START_WORN = { wrist: 'watch' };
const START_PACK = { pack: 'haversack', pouch: 'bedrollStrap', in: 'bedroll' };
const START_MONEY = 500;				// cents
const KIT = 3;
const MONEY_GRIDS = (id) => id == 'pocket' || id == 'pack' || id.startsWith('attach');
const INSULATION = 20;				// °C a whole share of insulation keeps the cold off
const CARRY = 30;					// kg, with nothing on that adds to it or takes from it (wornStats: carry)

export const inv = { worn: Object.fromEntries(SLOTS.map((s) => [s, null])), hands: Object.fromEntries(HANDS.map((h) => [h, null])), pocket: makeItem('pocket') };
const changeListeners = [];
export function onChange(fn) { changeListeners.push(fn); }
let saveSoon = 0;
export function changed() {
	for (const fn of changeListeners) fn();
	saveSoon = 1;
}
export const survivalOn = () => settings.gameMode == 'Hunting';

// THE GRIDS: { id, grid: [columns, rows], items, owner (the item they are in), name }
export function grids() {
	const list = [{ id: 'pocket', grid: ITEMS.pocket.grid, items: inv.pocket.contents, owner: inv.pocket, name: 'Pocket' }];
	const pack = inv.worn.backpack;
	if (pack) {
		list.push({ id: 'pack', grid: ITEMS[pack.type].grid, items: pack.contents, owner: pack, name: ITEMS[pack.type].name });
		pack.attached.forEach((pouch, k) => { if (pouch) list.push({ id: 'attach' + k, grid: ITEMS[pouch.type].grid, items: pouch.contents, owner: pouch, name: ITEMS[pouch.type].name }); });
	}
	const extra = inv.worn.extra;
	if (extra && ITEMS[extra.type].grid) list.push({ id: 'extra', grid: ITEMS[extra.type].grid, items: extra.contents, owner: extra, name: ITEMS[extra.type].name });
	return list;
}
export const gridById = (id) => grids().find((g) => g.id == id) ?? null;
// everything carried: [{ item, where }]: where { kind: 'worn' | 'hand' | 'attach' | 'grid', slot | index | grid }
export function everything() {
	const out = [];
	for (const s of SLOTS) if (inv.worn[s]) out.push({ item: inv.worn[s], where: { kind: 'worn', slot: s } });
	for (const h of HANDS) if (inv.hands[h]) out.push({ item: inv.hands[h], where: { kind: 'hand', slot: h } });
	inv.worn.backpack?.attached.forEach((p, k) => { if (p) out.push({ item: p, where: { kind: 'attach', index: k } }); });
	for (const g of grids()) for (const item of g.items) out.push({ item, where: { kind: 'grid', grid: g.id } });
	return out;
}
// the item where it is, or null
export function itemAt(where) {
	if (where.kind == 'worn') return inv.worn[where.slot];
	if (where.kind == 'hand') return inv.hands[where.slot];
	if (where.kind == 'attach') return inv.worn.backpack?.attached[where.index] ?? null;
	return null;
}

// TAKEN OUT of where it is (it is then nobody's: put it somewhere, or it is gone). A backpack taken off takes its pouches and their
//		contents with it; a gun out of the hands is put away
export function remove(item) {
	for (const s of SLOTS) if (inv.worn[s] === item) { inv.worn[s] = null; changed(); return true; }
	for (const h of HANDS) if (inv.hands[h] === item) { inv.hands[h] = null; handsChanged(); changed(); return true; }
	const pack = inv.worn.backpack;
	if (pack) { const k = pack.attached.indexOf(item); if (k >= 0) { pack.attached[k] = null; changed(); return true; } }
	for (const g of grids()) { const k = g.items.indexOf(item); if (k >= 0) { g.items.splice(k, 1); changed(); return true; } }
	return false;
}
// whether an item may go where: worn in its slot, in the hands slots it is for, a pouch on the backpack, anything in a grid it fits in
//		(not a container in itself)
export function accepts(where, item, x = 0, y = 0, rot = item.rot) {
	const it = ITEMS[item.type];
	if (where.kind == 'worn') return it.slot === where.slot && !inv.worn[where.slot];
	if (where.kind == 'hand') return handSlots(item.type).includes(where.slot) && !inv.hands[where.slot];
	if (where.kind == 'attach') return it.slot === 'attachment' && !!inv.worn.backpack && where.index < inv.worn.backpack.attached.length && !inv.worn.backpack.attached[where.index];
	if (where.kind == 'grid') {
		const g = gridById(where.grid);
		if (!g || g.owner === item || item.contents?.length || item.attached?.some(Boolean)) return false;
		if (ITEMS[g.owner.type].holds && !ITEMS[g.owner.type].holds.includes(item.type)) return false;
		if (ITEMS[item.type].money && !MONEY_GRIDS(g.id)) return false;
		return fits(g.grid, g.items, item, x, y, rot);
	}
	return false;
}
// put an item (nobody's) where it is to go: true if it went
export function put(where, item, x = 0, y = 0, rot = item.rot) {
	if (!accepts(where, item, x, y, rot)) return false;
	if (where.kind == 'worn') inv.worn[where.slot] = item;
	else if (where.kind == 'hand') { inv.hands[where.slot] = item; handsChanged(); }
	else if (where.kind == 'attach') inv.worn.backpack.attached[where.index] = item;
	else { Object.assign(item, { x, y, rot }); gridById(where.grid).items.push(item); }
	changed();
	return true;
}
// onto a stack of the same kind, as much as it holds: what is left over (0 all of it went)
export function stackOnto(target, item) {
	const most = ITEMS[target.type].stack ?? 1;
	if (target.type != item.type || most <= 1) return item.count;
	const room = Math.min(most - target.count, item.count);
	target.count += room;
	item.count -= room;
	changed();
	return item.count;
}
// an item found (or bought, or given): on to the stacks of its kind first, then wherever it fits (worn if its slot is empty and nothing
//		else will do; the hands slots too). True if all of it went
export function give(item) {
	if ((ITEMS[item.type].stack ?? 1) > 1) for (const { item: o } of everything()) if (o.type == item.type && stackOnto(o, item) == 0) return true;
	// (the pocket last, but for money: first)
	const all = grids(), order = ITEMS[item.type].money ? all : [...all.slice(1), all[0]];
	for (const g of order) { const at = placeFor(g.grid, g.items, item); if (at && put({ kind: 'grid', grid: g.id }, item, at.x, at.y, at.rot)) return true; }
	const it = ITEMS[item.type];
	if (typeof it.slot == 'string' && it.slot != 'attachment' && put({ kind: 'worn', slot: it.slot }, item)) return true;
	for (const h of handSlots(item.type)) if (put({ kind: 'hand', slot: h }, item)) return true;
	if (it.slot == 'attachment' && inv.worn.backpack) for (let k = 0; k < inv.worn.backpack.attached.length; k++) if (put({ kind: 'attach', index: k }, item)) return true;
	return false;
}
// one of an item used up (eaten, thrown): gone when there are none left
export function useOne(item) {
	item.count -= 1;
	if (item.count <= 0) remove(item);
	else changed();
}

// THE HANDS: the weapons.js weapons the equippables are; one put away that is no longer there
export function inHands(name) {
	return HANDS.some((h) => inv.hands[h] && ITEMS[inv.hands[h].type].weapon == name) || (name == 'watch' && inv.worn.wrist?.type == 'watch');
}
export const handItemFor = (name) => HANDS.map((h) => inv.hands[h]).find((i) => i && ITEMS[i.type].weapon == name) ?? null;
function handsChanged() {
	const now = weapons.weaponState.current;
	if (survivalOn() && now != 'none' && !inHands(now) && !godMode()) weapons.equipWeapon('none');
}
let godMode = () => false;
export function setGodMode(fn) { godMode = fn; }
// (in the Survival mode: only what is in the hands may be taken up, but in god mode)
weapons.gateEquip((name) => !survivalOn() || name == 'none' || godMode() || inHands(name));

// THE AMMUNITION (see the top): the rounds of a gun's kind in the grids
const roundsOf = (gun) => Object.values(ITEMS).find((it) => it.ammo == gun)?.type;
const stacksOf = (type) => everything().filter(({ item }) => item.type == type).map(({ item }) => item);
weapons.setAmmoSource({
	active: () => survivalOn() && !godMode(),
	carried: (gun) => stacksOf(roundsOf(gun)).reduce((n, i) => n + i.count, 0),
	take: (gun) => { const s = stacksOf(roundsOf(gun))[0]; if (!s) return false; useOne(s); return true; },
	give: (gun, count) => { const type = roundsOf(gun); if (type) give(makeItem(type, count)); },
});

// THE WORN: what the clothes come to (clothing.js; survival.js uses them): warmth (°C: their insulation), waterproof (the share of the rain
//		kept off: their water), sweat (how well it gets out: less than 0, worse than nothing), armour (the share of a hit stopped), what can be
//		carried (capacity, kg: their carry) and what is (load: everything, worn and in the hands, with all that is in it)
export function wornStats() {
	let insulation = 0, water = 0, sweat = 0, carry = 0, armour = 0;
	for (const s of SLOTS) {
		const it = inv.worn[s] && ITEMS[inv.worn[s].type];
		if (!it) continue;
		insulation += it.insulation ?? 0;
		water += it.water ?? 0;
		sweat += it.sweat ?? 0;
		carry += it.carry ?? 0;
		armour += it.armour ?? 0;
	}
	let load = 0;
	for (const s of SLOTS) if (inv.worn[s]) load += weightOf(inv.worn[s]);
	for (const h of HANDS) if (inv.hands[h]) load += weightOf(inv.hands[h]);
	load += weightOf(inv.pocket);
	return { warmth: insulation * INSULATION, insulation, waterproof: Math.min(water * 1.2, 0.9), sweat: Math.max(Math.min(sweat, 0.8), -0.8), armour: Math.min(armour, 0.6),
		capacity: CARRY * Math.max(Math.min(1 + carry, 1.6), 0.5), load, watch: inv.worn.wrist?.type == 'watch' };
}

// MONEY (items.js: in cents): how much is carried, paid out (false if there is not that much), and taken in (false if there is nowhere for it)
const moneyStacks = () => everything().filter(({ item }) => ITEMS[item.type].money).map(({ item }) => item);
export const moneyCarried = () => moneyStacks().reduce((n, item) => n + item.count, 0);
export function pay(cents) {
	if (moneyCarried() < cents) return false;
	for (const item of moneyStacks()) {
		const part = Math.min(item.count, cents);
		item.count -= part;
		cents -= part;
		if (item.count <= 0) remove(item);
		if (cents <= 0) break;
	}
	changed();
	return true;
}
export function receive(cents) {
	if (cents <= 0) return true;
	const stack = moneyStacks()[0];
	if (stack) { stack.count += cents; changed(); return true; }
	return give(makeItem('money', cents));
}

// A NEW PLAYER (see the top), and all of it as a list (to leave on a body, loot.js)
export function startKit() {
	for (const s of SLOTS) inv.worn[s] = null;
	for (const h of HANDS) inv.hands[h] = null;
	for (const [h, type] of Object.entries(START_KIT)) inv.hands[h] = makeItem(type);
	for (const [s, type] of Object.entries(START_WORN)) inv.worn[s] = makeItem(type);
	inv.pocket = makeItem('pocket');
	inv.pocket.contents.push(makeItem('money', START_MONEY));
	const pack = makeItem(START_PACK.pack), pouch = makeItem(START_PACK.pouch);
	pouch.contents.push(makeItem(START_PACK.in));
	pack.attached[0] = pouch;
	inv.worn.backpack = pack;
	emptyHands();
	changed();
}
// (put away whatever is in the hands that is not one of the equippables: god mode or not)
function emptyHands() {
	const now = weapons.weaponState.current;
	if (now != 'none' && !inHands(now)) weapons.equipWeapon('none');
}
export function takeAll() {
	const all = [];
	for (const s of SLOTS) if (inv.worn[s]) all.push(inv.worn[s]);
	for (const h of HANDS) if (inv.hands[h]) all.push(inv.hands[h]);
	all.push(...inv.pocket.contents);
	for (const s of SLOTS) inv.worn[s] = null;
	for (const h of HANDS) inv.hands[h] = null;
	inv.pocket.contents = [];
	handsChanged();
	changed();
	return all;
}

// SAVED (see the top): in the browser, a moment after each change
export function save() {
	try { localStorage.setItem(SAVED, JSON.stringify({ ...inv, kit: KIT })); } catch (e) { /* (nowhere to keep it) */ }
}
function load() {
	try {
		const raw = JSON.parse(localStorage.getItem(SAVED) ?? 'null');
		if (!raw || raw.kit !== KIT) return false;
		for (const s of SLOTS) inv.worn[s] = cleanItem(raw.worn?.[s]);
		for (const h of HANDS) inv.hands[h] = cleanItem(raw.hands?.[h]);
		inv.pocket = cleanItem(raw.pocket) ?? makeItem('pocket');
		return true;
	} catch (e) { return false; }
}
if (!load()) startKit();
let wasOn = false;
export function inventoryUpdate(dt) {
	const on = survivalOn();
	if (on && !wasOn) emptyHands();
	wasOn = on;
	if (saveSoon > 0 && (saveSoon -= dt) <= 0) save();
}
window.addEventListener('beforeunload', save);
export { sizeOf };
