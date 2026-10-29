import { CLOTHES, colourName, colourHex } from './clothing.js'

/*
	THE ITEMS of the Survival game mode: every kind of thing a player can carry (ITEMS), what it is for, and how much room it takes.
		w, h			cells it takes in a grid (a backpack's, a pouch's, a crate's), turned round: h by w
		slot			where it is worn (inventory.js: SLOTS): torsoInner, torsoOuter, headFace, headHat, legsInner, legsOuter, feetInner,
						feetOuter, wrist, backpack, extra. Or hands: 'primary' (a long gun), 'secondary' (a pistol, a hatchet, a knife), 'item'
						(the four item slots: a lighter, stones, a knife, food...), or several of them
		clothing		the clothes are clothing.js's (CLOTHES): insulation, water, sweat, carry, armour (shares), five colours each
		grid			a container's own room: [columns, rows] (a backpack, a pouch, a belt). attach: how many pouches a backpack carries.
						holds: the only things it takes (the bedroll straps: the bedroll)
		stack			how many go in one cell (rounds, stones, firewood)
		food, drink		what eating or drinking one does to hunger and thirst (and stress, tired: beer), survival.js
		weapon			the weapons.js weapon it is in the hands (the guns), or a tool of survivalTools.js
		ammo			the weapons.js gun its rounds are for
		icon			its picture in the inventory (ICONS: an outline drawn in 40 x 40)
		kg, price		its weight (one of a stack; KG for those that do not say), and what it costs in the shops (shops.js: PRICE)
		money			Money: any amount in one stack, counted in cents, in a pocket or a backpack's grids only
		camp			the camp things (camp.js): the tent, and what goes in a tent's slots (its stove, its rain collector, two bedrolls).
						So big they are carried in the hands (primary, secondary: weapon 'carry'), or in a horse's saddlebags
	Each one carried is an instance: { uid, type, count, x, y, rot, contents (a container's), attached (a backpack's pouches), colour (a piece
	of clothing's: 0 to 4) }.
*/
export const SLOTS = ['headHat', 'headFace', 'torsoInner', 'torsoOuter', 'legsInner', 'legsOuter', 'feetInner', 'feetOuter', 'wrist', 'backpack', 'extra'];
export const SLOT_NAMES = { headHat: 'Head: hat', headFace: 'Head: face', torsoInner: 'Torso: inner', torsoOuter: 'Torso: outer', legsInner: 'Legs: inner', legsOuter: 'Legs: outer',
	feetInner: 'Feet: inner', feetOuter: 'Feet: outer', wrist: 'Wrist', backpack: 'Backpack', extra: 'Extra' };
export const HANDS = ['primary', 'secondary', 'item1', 'item2', 'item3', 'item4'];
export const HAND_NAMES = { primary: 'Primary', secondary: 'Secondary', item1: 'Item 1', item2: 'Item 2', item3: 'Item 3', item4: 'Item 4' };

export const ITEMS = {
	// clothing (clothing.js: four of a kind for each slot, five colours each), and the wrist
	...CLOTHES,
	watch: { name: 'Wristwatch', slot: 'wrist', w: 1, h: 1, kg: 0.1, price: 6, weapon: 'watch', icon: 'watch', tint: '#c8b070', detail: 'Worn: on T, raise the wrist to read it (its hands go with the sun)' },
	// backpacks, and the pouches on them
	haversack: { name: 'Haversack', slot: 'backpack', w: 2, h: 2, grid: [4, 3], attach: 1, icon: 'pack', tint: '#8a7a54' },
	rucksack: { name: 'Rucksack', slot: 'backpack', w: 3, h: 3, grid: [5, 5], attach: 2, icon: 'pack', tint: '#5a5a3a' },
	framePack: { name: 'Frame pack', slot: 'backpack', w: 3, h: 4, grid: [6, 6], attach: 3, icon: 'pack', tint: '#4a4232' },
	ammoPouch: { name: 'Ammo pouch', slot: 'attachment', w: 2, h: 1, grid: [2, 1], icon: 'pouch', tint: '#6a5a3a' },
	utilityPouch: { name: 'Utility pouch', slot: 'attachment', w: 2, h: 2, grid: [2, 2], icon: 'pouch', tint: '#5a6a4a' },
	bedrollStrap: { name: 'Bedroll straps', slot: 'attachment', w: 3, h: 1, grid: [3, 1], holds: ['bedroll'], icon: 'belt', tint: '#7a5a3a', detail: 'A canvas bedroll rolled up on the backpack' },
	// guns (weapons.js), and their rounds
	rifle: { name: 'Mosin–Nagant', slot: ['primary'], w: 5, h: 1, weapon: 'rifle', icon: 'rifle', tint: '#6a4a2a' },
	shotgun: { name: 'Mossberg 500', slot: ['primary'], w: 4, h: 1, weapon: 'shotgun', icon: 'rifle', tint: '#3a3a3a' },
	sharps: { name: 'Sharps rifle', slot: ['primary'], w: 5, h: 1, weapon: 'sharps', icon: 'rifle', tint: '#7a5a34' },
	revolver: { name: 'Colt revolver', slot: ['secondary', 'item'], w: 2, h: 1, weapon: 'revolver', icon: 'pistol', tint: '#3a3a40' },
	mauser: { name: 'Broomhandle Mauser', slot: ['secondary', 'item'], w: 2, h: 1, weapon: 'mauser', icon: 'pistol', tint: '#2a2a30' },
	rifleRounds: { name: '7.62×54R rounds', w: 1, h: 1, stack: 20, ammo: 'rifle', icon: 'rounds', tint: '#b08a3a' },
	shells: { name: '12 bore shells', w: 1, h: 1, stack: 12, ammo: 'shotgun', icon: 'shells', tint: '#a02a22' },
	coltRounds: { name: '.45 Colt rounds', w: 1, h: 1, stack: 18, ammo: 'revolver', icon: 'rounds', tint: '#a07a3a' },
	sharpsRounds: { name: '.45-70 rounds', w: 1, h: 1, stack: 8, ammo: 'sharps', icon: 'rounds', tint: '#b8903a' },
	mauserRounds: { name: '7.63 Mauser rounds', w: 1, h: 1, stack: 20, ammo: 'mauser', icon: 'rounds', tint: '#9a7a3a' },
	// tools (survivalTools.js)
	lighter: { name: 'Lighter', slot: ['item'], w: 1, h: 1, weapon: 'lighter', icon: 'lighter', tint: '#b0b4b8', detail: 'Lights a campfire from firewood, and a little light' },
	hatchet: { name: 'Hatchet', slot: ['secondary', 'item'], w: 1, h: 3, weapon: 'hatchet', icon: 'hatchet', tint: '#8a6a44', detail: 'Chops firewood from trees, and a blow; thrown, it flies' },
	knife: { name: 'Small knife', slot: ['secondary', 'item'], w: 1, h: 2, weapon: 'knife', icon: 'knife', tint: '#9aa0a8', detail: 'A quick stab; thrown, it flies' },
	stone: { name: 'Throwing stones', slot: ['item'], w: 1, h: 1, stack: 5, weapon: 'stone', icon: 'stone', tint: '#8a8680', detail: 'Thrown: hurts a little, kills a bird' },
	firewood: { name: 'Firewood', w: 2, h: 1, stack: 4, icon: 'wood', tint: '#7a5634', detail: 'Right click: build a campfire; E at a campfire: more wood on it (2.5 hours)' },
	compass: { name: 'Compass', slot: ['item'], w: 1, h: 1, kg: 0.15, price: 5, weapon: 'compass', icon: 'compass', tint: '#b8963e', detail: 'In the hands: its card turns to the north' },
	tent: { name: 'Canvas wall tent', slot: ['primary', 'secondary'], w: 5, h: 5, kg: 9, price: 25, weapon: 'carry', camp: 'tent', use: 'pitch', icon: 'tent', tint: '#c8b890', detail: 'Pitched (in the hands, left click; or right click here): room for two to sleep, and the rain and snow kept off. E at it: its attachments. F: strike it' },
	tentStove: { name: 'Sheet-iron stove', slot: ['primary', 'secondary'], w: 3, h: 4, kg: 7, price: 12, weapon: 'carry', camp: 'stove', icon: 'stove', tint: '#4a4644', detail: 'A tent attachment: stands at the back of the tent, its pipe through the roof. Firewood (E), the lighter: warmth, and cooking (X)' },
	rainCollector: { name: 'Rain collector', slot: ['primary', 'secondary'], w: 3, h: 4, kg: 3, price: 8, weapon: 'carry', camp: 'collector', icon: 'funnel', tint: '#8a7a5a', detail: 'A tent attachment: stands outside the tent. Fills with water in the rain and the snow (E: the water)' },
	bedroll: { name: 'Canvas bedroll', w: 3, h: 1, icon: 'bedroll', tint: '#9a8a62', use: 'deploy', camp: 'bed', detail: 'Laid out (right click): E to sleep on it, F to roll it up. Down, you come back where you last slept' },
	// money (shops.js), and the pocket every walker has (inventory.js: a grid of its own)
	money: { name: 'Money', w: 1, h: 1, stack: Infinity, kg: 0, money: true, icon: 'coin', tint: '#d4b04a', detail: 'Coins and notes, any amount in one place: in a pocket or a backpack' },
	pocket: { name: 'Pocket', w: 1, h: 1, grid: [1, 1], kg: 0, icon: 'pouch', tint: '#6a5a44' },
	// food and drink (survival.js)
	bread: { name: 'Bread', slot: ['item'], w: 2, h: 1, food: 35, weapon: 'eat', icon: 'bread', tint: '#c08a44', detail: 'Hunger -35' },
	sausage: { name: 'Sausage', slot: ['item'], w: 1, h: 1, food: 25, drink: -4, weapon: 'eat', icon: 'sausage', tint: '#8a3a2a', detail: 'Hunger -25, a little thirsty' },
	water: { name: 'Water bottle', slot: ['item'], w: 1, h: 2, drink: 40, weapon: 'eat', icon: 'bottle', tint: '#8ab0c8', detail: 'Thirst -40' },
	venison: { name: 'Raw venison', slot: ['item'], w: 1, h: 1, stack: 4, food: 12, stress: 10, weapon: 'eat', icon: 'meat', tint: '#a8443a', detail: 'Hunger -12, but raw: stress +10. Cook it at a burning campfire or a tent stove (X there, or right click here)' },
	cookedVenison: { name: 'Cooked venison', slot: ['item'], w: 1, h: 1, stack: 4, food: 45, stress: -5, weapon: 'eat', icon: 'meat', tint: '#6e4426', detail: 'Hunger -45, and a little calmer' },
	smokedFish: { name: 'Smoked fish', slot: ['item'], w: 2, h: 1, stack: 2, food: 30, drink: -6, weapon: 'eat', icon: 'fish', tint: '#a07040', detail: 'Hunger -30, a little thirsty' },
	beer: { name: 'Beer', slot: ['item'], w: 1, h: 2, drink: 22, stress: -30, tired: 6, weapon: 'eat', icon: 'bottle', tint: '#5a7a2a', detail: 'Thirst -22, stress -30, a little sleepy' },
};
// WEIGHT (kg, one of a stack) and PRICE (dollars) of those that do not say: the rest weigh by their size; without a price, a shop has no use for it
const KG = { rifle: 4, shotgun: 3.4, sharps: 4.3, revolver: 1.1, mauser: 1.2, rifleRounds: 0.025, shells: 0.04, coltRounds: 0.02, sharpsRounds: 0.03, mauserRounds: 0.012,
	lighter: 0.05, hatchet: 0.7, knife: 0.15, stone: 0.3, firewood: 1.5, bedroll: 2.2, bread: 0.5, sausage: 0.3, water: 1, venison: 0.35, cookedVenison: 0.3, beer: 0.7,
	smokedFish: 0.4, haversack: 0.6, rucksack: 1.3, framePack: 2.2, ammoPouch: 0.2, utilityPouch: 0.25, bedrollStrap: 0.2 };
const PRICE = { bread: 0.4, sausage: 0.5, water: 0.2, beer: 0.3, venison: 0.6, cookedVenison: 1, smokedFish: 0.8, haversack: 5, rucksack: 9, framePack: 16, ammoPouch: 2,
	utilityPouch: 2.5, bedrollStrap: 1.5, bedroll: 4, knife: 2, hatchet: 3, lighter: 1.5, firewood: 0.2, stone: 0.05 };
for (const [type, it] of Object.entries(ITEMS)) {
	it.type = type;
	it.kg ??= KG[type] ?? 0.3 * it.w * it.h;
	if (PRICE[type] !== undefined) it.price ??= PRICE[type];
}

// the slots of the hands an item can go in
export function handSlots(type) {
	const s = ITEMS[type]?.slot;
	const list = Array.isArray(s) ? s : [];
	return HANDS.filter((h) => list.includes(h) || (h.startsWith('item') && list.includes('item')));
}
export const isWorn = (type) => typeof ITEMS[type]?.slot == 'string' && SLOTS.includes(ITEMS[type].slot);
// its size in a grid, turned or not
export const sizeOf = (item) => { const it = ITEMS[item.type]; return item.rot ? [it.h, it.w] : [it.w, it.h]; };

let uidNext = Math.floor(Math.random() * 1e6) * 1000;
export function makeItem(type, count = 1, colour = null) {
	const it = ITEMS[type];
	const item = { uid: ++uidNext, type, count: Math.min(count, it.stack ?? 1), x: 0, y: 0, rot: 0 };
	if (it.clothing) item.colour = colour ?? Math.floor(Math.random() * 5);
	if (it.grid) item.contents = [];
	if (it.attach) item.attached = Array(it.attach).fill(null);
	return item;
}
// (an item heard from another machine: its uid kept, whatever else made sane)
export function cleanItem(raw) {
	if (!raw || !ITEMS[raw.type]) return null;
	const it = ITEMS[raw.type];
	const item = { uid: Number(raw.uid) || ++uidNext, type: raw.type, count: Math.max(1, Math.min(Number(raw.count) || 1, it.stack ?? 1)), x: Math.max(0, raw.x | 0), y: Math.max(0, raw.y | 0), rot: raw.rot ? 1 : 0 };
	if (it.clothing) item.colour = Math.max(0, Math.min(4, raw.colour | 0));
	if (it.grid) item.contents = (raw.contents ?? []).map(cleanItem).filter(Boolean);
	if (it.attach) item.attached = Array.from({ length: it.attach }, (_, k) => cleanItem(raw.attached?.[k]) ?? null);
	return item;
}

// what it is called (a piece of clothing: and its colour), what colour it is drawn in, what it weighs (with all in it), and money as money
export const nameOf = (item) => ITEMS[item.type].name + (ITEMS[item.type].clothing ? ` (${colourName(item.type, item.colour)})` : '');
export const tintOf = (item) => colourHex(item.type, item.colour) ?? ITEMS[item.type].tint ?? '#888';
export function weightOf(item) {
	let kg = (ITEMS[item.type].kg ?? 0) * item.count;
	for (const inside of item.contents ?? []) kg += weightOf(inside);
	for (const pouch of item.attached ?? []) if (pouch) kg += weightOf(pouch);
	return kg;
}
export const dollars = (cents) => '$' + (Math.floor(cents) / 100).toFixed(2);

/*
	A GRID's room: where an item goes in it (x, y in cells; null if it will not), the others in it kept out of. One already in it (the one
	being moved) not counted. Into the first place it fits, turned if need be
*/
export function fits(grid, items, item, x, y, rot = item.rot, except = item) {
	const it = ITEMS[item.type], w = rot ? it.h : it.w, h = rot ? it.w : it.h;
	if (x < 0 || y < 0 || x + w > grid[0] || y + h > grid[1]) return false;
	for (const o of items) {
		if (o === except || o.uid === except?.uid) continue;
		const [ow, oh] = sizeOf(o);
		if (x < o.x + ow && o.x < x + w && y < o.y + oh && o.y < y + h) return false;
	}
	return true;
}
export function placeFor(grid, items, item) {
	for (const rot of [item.rot, 1 - item.rot]) for (let y = 0; y < grid[1]; y++) for (let x = 0; x < grid[0]; x++) if (fits(grid, items, item, x, y, rot)) return { x, y, rot };
	return null;
}

// THE PICTURES (40 x 40): an outline each, filled with the item's tint
export const ICONS = {
	shirt: 'M12 6 L18 9 L22 9 L28 6 L35 12 L31 17 L28 15 L28 34 L12 34 L12 15 L9 17 L5 12 Z',
	coat: 'M12 4 L17 7 L23 7 L28 4 L36 11 L33 36 L24 36 L20 14 L16 36 L7 36 L4 11 Z',
	scarf: 'M8 10 Q20 4 32 10 L32 15 Q20 9 8 15 Z M24 13 L29 13 L30 34 L25 34 Z',
	hat: 'M4 26 Q20 32 36 26 L33 22 L29 22 L27 10 Q20 6 13 10 L11 22 L7 22 Z',
	cap: 'M8 26 Q8 8 20 8 Q32 8 32 26 Z M18 4 L22 4 L22 8 L18 8 Z',
	helmet: 'M3 25 L37 25 L34 21 Q32 9 20 9 Q8 9 6 21 Z',
	trousers: 'M11 4 L29 4 L32 36 L23 36 L20 14 L17 36 L8 36 Z',
	socks: 'M14 4 L22 4 L22 24 L30 28 L30 34 L14 34 Z',
	boots: 'M9 4 L19 4 L19 24 L33 28 L34 34 L9 34 Z',
	watch: 'M15 3 L25 3 L25 11 L15 11 Z M15 29 L25 29 L25 37 L15 37 Z M20 10 A10 10 0 1 0 20.1 10 Z',
	poncho: 'M20 4 L36 30 L28 34 L20 30 L12 34 L4 30 Z',
	belt: 'M3 14 L37 14 L37 26 L3 26 Z M8 10 L16 10 L16 30 L8 30 Z M24 10 L32 10 L32 30 L24 30 Z',
	pack: 'M12 6 Q20 2 28 6 L32 34 L8 34 Z M12 18 L28 18 L28 28 L12 28 Z',
	pouch: 'M6 10 L34 10 L32 34 L8 34 Z M6 10 L34 10 L30 18 L10 18 Z',
	rifle: 'M2 18 L26 16 L38 15 L38 18 L26 19 L22 24 L14 24 L12 21 L2 22 Z',
	pistol: 'M6 12 L34 12 L34 18 L16 18 L14 32 L6 32 Z',
	rounds: 'M8 14 L12 6 L16 14 L16 34 L8 34 Z M18 14 L22 6 L26 14 L26 34 L18 34 Z M28 18 L31 11 L34 18 L34 34 L28 34 Z',
	shells: 'M8 10 L16 10 L16 34 L8 34 Z M18 10 L26 10 L26 34 L18 34 Z M28 14 L34 14 L34 34 L28 34 Z',
	lighter: 'M13 14 L27 14 L27 36 L13 36 Z M13 6 L25 6 L25 13 L13 13 Z',
	hatchet: 'M18 4 L22 4 L22 37 L18 37 Z M14 4 L30 4 Q34 10 30 14 L14 14 Z',
	knife: 'M18 3 Q24 10 22 22 L18 22 Z M17 22 L23 22 L23 37 L17 37 Z',
	stone: 'M10 20 Q8 10 20 9 Q33 9 31 20 Q32 31 20 31 Q8 31 10 20 Z',
	wood: 'M3 12 L37 10 L37 18 L3 20 Z M3 22 L37 22 L37 30 L3 30 Z',
	bedroll: 'M4 12 L36 12 L36 28 L4 28 Z M10 10 L13 10 L13 30 L10 30 Z M27 10 L30 10 L30 30 L27 30 Z',
	bread: 'M4 24 Q4 10 20 10 Q36 10 36 24 L36 30 L4 30 Z',
	meat: 'M5 22 Q4 12 15 9 Q28 6 34 13 Q38 20 32 27 Q26 33 17 31 Q11 30 9 34 L5 32 Q8 28 5 22 Z M21 15 A3 3 0 1 0 27 15 A3 3 0 1 0 21 15 Z',
	sausage: 'M8 28 Q4 20 12 14 Q22 8 30 10 Q36 14 30 18 Q22 18 16 24 Q12 30 8 28 Z',
	coin: 'M20 5 A15 15 0 1 0 20.01 5 Z M20 10 A10 10 0 1 1 19.99 10 Z M18 14 L22 14 L22 26 L18 26 Z',
	compass: 'M20 4 A16 16 0 1 0 20.01 4 Z M20 9 L24 20 L20 31 L16 20 Z',
	vest: 'M10 4 L16 4 L20 14 L24 4 L30 4 L33 12 L32 36 L22 36 L20 18 L18 36 L8 36 L7 12 Z',
	fish: 'M4 20 Q14 8 28 16 L36 9 L34 20 L36 31 L28 24 Q14 32 4 20 Z M11 18 A2 2 0 1 0 11.01 18 Z',
	tent: 'M20 5 L37 33 L3 33 Z M20 14 L26 33 L14 33 Z',
	stove: 'M9 14 L29 14 L29 30 L9 30 Z M23 3 L28 3 L28 14 L23 14 Z M11 30 L14 30 L14 36 L11 36 Z M24 30 L27 30 L27 36 L24 36 Z M13 18 L21 18 L21 26 L13 26 Z',
	funnel: 'M4 6 L36 6 L23 18 L23 22 L17 22 L17 18 Z M11 22 L29 22 L29 37 L11 37 Z',
	bottle: 'M17 3 L23 3 L23 11 Q29 15 29 21 L29 37 L11 37 L11 21 Q11 15 17 11 Z',
};
