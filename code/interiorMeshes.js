import * as vm from './viewmodel.js'
import { buildingMeshes } from './townBuildings.js'
import { BUILDING_TYPES, VARIANTS, TOWN_METRE } from './townLayout.js'

/*
	WHAT IS INSIDE THE HOUSES (interiors.js puts it there): the tags, the models and the rooms' shells. Everything in metres, drawn by props.js.

	THE TAGS. A ROOM is a kind of room, and has tags saying what it is for (ROOMS: tags). A MODEL (MODELS: sixty of them, each under 150 triangles) has tags
	saying what kind of room it belongs in, and an anchor saying where in a room it goes. A room spawns what it must have (must), then fills so many places
	of each anchor (fill) by lot from every model that shares a tag with it. So a new model only has to say what it is, and it turns up wherever it belongs.
	PLANS says which rooms each kind of building has, by the trade of who lives there (townFolk.js: PROFESSIONS).
		anchor		wall (on the floor, its back to a wall), corner, centre, floor (lying flat: a rug, walked over), hang (on a wall, HANG_AT up), ceil (from the ceiling),
					top (on something else that has a top), counter (the long counter across the room)
		hw, hd, h	half its width, half its depth, its height: what it takes up, and what is in the way (not if solid: false)
		top			how high up things can be stood on it (on: only on this model, and only if a room must have it)
		fire		it burns: flames (interiors.js) and a warm light. light: it lights the room at night

	THE SHELL of a room (planOf: its size from the building's own, buildingMeshes: where its doors and its windows are): walls with their doorways, floor, ceiling and the panes of
	its windows, one mesh for each kind of building in each of its sizes. Only the ground floor is made: the floors over it are shut off by its ceiling.
*/
export const HANG_AT = 1.55;
const U = 1 / TOWN_METRE;			// world units to metres
const BLUED = 1, BRASS = 2, NICKEL = 8, DARK = 9, STONE = 27, FLAME = 28, STEEL = 29, BOARDS = 30, SACKING = 31, EMBERS = 36, CANVAS = 37, LEATHER = 42, INK = 43, ENAMEL = 44, PAPER = 25, CLEAR_GLASS = 24, GREEN_GLASS = 23, RAW_MEAT = 39;
const PLASTER = 45, WALLPAPER = 46, PANELS = 47, TILES = 48, PLANKS = 49, FLAGS = 50, CEILING = 51, WOOD = 52, RED = 53, GREEN = 54, BLUE = 55, LEAF = 56, POT = 57, PAINTING = 58, CREAM = 59, BOOKS = 60, WINDOW = 61, LAMP = 62, BLUE_PAPER = 71, FIREBRICK = 72;

// a box: all six faces, or without the bottom
function box(m, x0, y0, z0, x1, y1, z1, material, bottom = false) {
	const p = (a, b, c) => [a ? x1 : x0, b ? y1 : y0, c ? z1 : z0];
	m.quad(p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1), 0, material);
	m.quad(p(1, 0, 0), p(0, 0, 0), p(0, 1, 0), p(1, 1, 0), 0, material);
	m.quad(p(1, 0, 1), p(1, 0, 0), p(1, 1, 0), p(1, 1, 1), 0, material);
	m.quad(p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0), 0, material);
	m.quad(p(0, 1, 1), p(1, 1, 1), p(1, 1, 0), p(0, 1, 0), 0, material);
	if (bottom) m.quad(p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1), 0, material);
}
const leg = (m, x, z, y, r, material = WOOD, sides = 4) => m.strut([x, 0, z], [x, y, z], r, r * 0.8, sides, material);
const legs = (m, hw, hd, y, r, material = WOOD) => { for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) leg(m, a * hw, c * hd, y, r, material); };
const ringY = (y, r, n) => Array.from({ length: n }, (_, k) => { const a = (k + 0.5) / n * Math.PI * 2; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
const lathe = (m, profile, n, material, caps = [0, 1]) => m.loft(profile.map(([y, r]) => ringY(y, r, n)), material, 0, caps);
const make = (fn) => () => { const m = vm.meshBuilder(); fn(m); return m; };

export const MODELS = {
	//---------------------seats and tables---------------------
	chair: { tags: ['dining', 'office', 'home', 'kitchen', 'books', 'inn'], anchor: 'centre', hw: 0.24, hd: 0.24, h: 0.95, make: make((m) => { legs(m, 0.19, 0.19, 0.45, 0.022); box(m, -0.23, 0.45, -0.23, 0.23, 0.5, 0.23, WOOD); box(m, -0.23, 0.5, -0.23, 0.23, 0.95, -0.19, WOOD); }) },
	stool: { tags: ['inn', 'bakery', 'sea', 'art', 'kitchen'], anchor: 'centre', hw: 0.18, hd: 0.18, h: 0.62, make: make((m) => { for (let k = 0; k < 3; k++) { const a = k * 2.09; leg(m, Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0.6, 0.02); } lathe(m, [[0.6, 0.17], [0.64, 0.17]], 8, BOARDS); }) },
	bench: { tags: ['home', 'inn', 'sea', 'kitchen', 'garden'], anchor: 'wall', hw: 0.8, hd: 0.2, h: 0.47, make: make((m) => { box(m, -0.8, 0.42, -0.18, 0.8, 0.47, 0.18, BOARDS); box(m, -0.7, 0, -0.16, -0.64, 0.42, 0.16, BOARDS); box(m, 0.64, 0, -0.16, 0.7, 0.42, 0.16, BOARDS); }) },
	armchair: { tags: ['home', 'books', 'hotel', 'bed'], anchor: 'corner', hw: 0.42, hd: 0.42, h: 1.0, make: make((m) => { box(m, -0.4, 0.1, -0.4, 0.4, 0.45, 0.4, GREEN); box(m, -0.4, 0.45, -0.4, 0.4, 1.0, -0.26, GREEN); box(m, -0.42, 0.45, -0.4, -0.3, 0.68, 0.38, GREEN); box(m, 0.3, 0.45, -0.4, 0.42, 0.68, 0.38, GREEN); legs(m, 0.35, 0.35, 0.1, 0.03); }) },
	tableRound: { tags: ['dining', 'inn', 'home', 'kitchen', 'hotel'], anchor: 'centre', hw: 0.62, hd: 0.62, h: 0.75, top: 0.76, make: make((m) => { lathe(m, [[0, 0.3], [0.05, 0.08], [0.7, 0.06]], 6, WOOD); lathe(m, [[0.7, 0.6], [0.76, 0.6]], 10, WOOD); }) },
	tableLong: { tags: ['dining', 'kitchen', 'inn', 'bakery', 'books', 'art'], anchor: 'centre', hw: 1.05, hd: 0.48, h: 0.8, top: 0.8, make: make((m) => { box(m, -1.05, 0.74, -0.48, 1.05, 0.8, 0.48, BOARDS); legs(m, 0.95, 0.4, 0.74, 0.04, BOARDS); }) },
	desk: { tags: ['office', 'bank', 'books', 'sea', 'lamp'], anchor: 'wall', hw: 0.72, hd: 0.36, h: 0.78, top: 0.78, make: make((m) => { box(m, -0.72, 0.72, -0.36, 0.72, 0.78, 0.36, WOOD); box(m, 0.25, 0, -0.34, 0.7, 0.72, 0.34, WOOD); box(m, -0.7, 0, -0.34, -0.62, 0.72, 0.34, WOOD); for (const y of [0.14, 0.38, 0.6]) box(m, 0.28, y, 0.34, 0.67, y + 0.18, 0.35, PANELS); }) },
	//---------------------what things are kept in---------------------
	bookcase: { tags: ['books', 'office', 'home', 'bank', 'sea'], anchor: 'wall', hw: 0.65, hd: 0.2, h: 2.1, make: make((m) => { box(m, -0.65, 0, -0.2, -0.61, 2.1, 0.2, WOOD); box(m, 0.61, 0, -0.2, 0.65, 2.1, 0.2, WOOD); box(m, -0.65, 2.06, -0.2, 0.65, 2.1, 0.2, WOOD); box(m, -0.65, 0, -0.2, 0.65, 2.1, -0.18, WOOD); for (let k = 0; k < 5; k++) { const y = 0.05 + k * 0.4; box(m, -0.61, y, -0.18, 0.61, y + 0.03, 0.2, WOOD); box(m, -0.6, y + 0.03, -0.14, 0.6, y + 0.33, 0.15, BOOKS); } }) },
	shelfUnit: { tags: ['store', 'kitchen', 'shop', 'bakery', 'butcher', 'lamp', 'garden'], anchor: 'wall', hw: 0.65, hd: 0.2, h: 1.9, make: make((m) => { for (const x of [-0.63, 0.63]) for (const z of [-0.18, 0.18]) leg(m, x, z, 1.9, 0.022, BOARDS); for (let k = 0; k < 4; k++) { const y = 0.3 + k * 0.5; box(m, -0.65, y, -0.2, 0.65, y + 0.03, 0.2, BOARDS); box(m, -0.4 + k * 0.2, y + 0.03, -0.1, -0.15 + k * 0.2, y + 0.26, 0.1, k % 2 ? POT : CREAM); } }) },
	cabinet: { tags: ['home', 'office', 'kitchen', 'bank', 'church'], anchor: 'wall', hw: 0.5, hd: 0.24, h: 1.3, make: make((m) => { box(m, -0.5, 0.05, -0.24, 0.5, 1.3, 0.24, WOOD); box(m, -0.46, 0.1, 0.24, -0.02, 1.25, 0.25, PANELS); box(m, 0.02, 0.1, 0.24, 0.46, 1.25, 0.25, PANELS); for (const x of [-0.06, 0.06]) box(m, x - 0.01, 0.65, 0.25, x + 0.01, 0.75, 0.27, BRASS); }) },
	wardrobe: { tags: ['bed', 'tailor'], anchor: 'wall', hw: 0.65, hd: 0.3, h: 2.05, make: make((m) => { box(m, -0.65, 0.08, -0.3, 0.65, 2.0, 0.3, WOOD); box(m, -0.68, 2.0, -0.32, 0.68, 2.08, 0.33, WOOD); box(m, -0.6, 0.15, 0.3, -0.02, 1.93, 0.31, PANELS); box(m, 0.02, 0.15, 0.3, 0.6, 1.93, 0.31, PANELS); box(m, -0.1, 0.95, 0.31, -0.07, 1.1, 0.33, BRASS); box(m, 0.07, 0.95, 0.31, 0.1, 1.1, 0.33, BRASS); }) },
	chest: { tags: ['bed', 'store', 'sea', 'church', 'bank'], anchor: 'wall', hw: 0.5, hd: 0.3, h: 0.6, top: 0.6, make: make((m) => { box(m, -0.5, 0, -0.3, 0.5, 0.42, 0.3, BOARDS); box(m, -0.52, 0.42, -0.31, 0.52, 0.6, 0.31, WOOD); for (const x of [-0.38, 0.38]) box(m, x - 0.03, 0, -0.32, x + 0.03, 0.61, 0.32, DARK); box(m, -0.05, 0.34, 0.31, 0.05, 0.5, 0.33, BRASS); }) },
	safe: { tags: ['bank', 'office', 'lamp'], anchor: 'corner', hw: 0.42, hd: 0.42, h: 1.2, top: 1.2, make: make((m) => { box(m, -0.42, 0, -0.42, 0.42, 1.2, 0.42, BLUED, true); box(m, -0.34, 0.1, 0.42, 0.34, 1.1, 0.44, DARK); m.tube(0, 0.72, 0.44, 0.09, 0.47, 0.09, 8, BRASS, 0, [1]); box(m, 0.18, 0.4, 0.44, 0.22, 0.6, 0.47, NICKEL); box(m, -0.38, 0.28, 0.42, -0.3, 0.38, 0.45, NICKEL); box(m, -0.38, 0.82, 0.42, -0.3, 0.92, 0.45, NICKEL); }) },
	barrel: { tags: ['store', 'sea', 'inn', 'butcher', 'garden', 'lamp'], anchor: 'corner', hw: 0.3, hd: 0.3, h: 0.9, top: 0.9, make: make((m) => { lathe(m, [[0, 0.26], [0.45, 0.32], [0.9, 0.26]], 10, BOARDS); lathe(m, [[0.14, 0.295], [0.2, 0.305]], 10, DARK, []); lathe(m, [[0.7, 0.305], [0.76, 0.295]], 10, DARK, []); }) },
	crateStack: { tags: ['store', 'shop', 'sea'], anchor: 'corner', hw: 0.6, hd: 0.5, h: 1.4, make: make((m) => { box(m, -0.6, 0, -0.5, 0.15, 0.7, 0.2, BOARDS); box(m, 0.18, 0, -0.45, 0.6, 0.5, 0.05, BOARDS); box(m, -0.5, 0.7, -0.45, 0.05, 1.25, 0.1, BOARDS); box(m, -0.6, 0.3, 0.2, 0.15, 0.36, 0.21, DARK); }) },
	grainSack: { tags: ['bakery', 'store', 'garden'], anchor: 'corner', hw: 0.36, hd: 0.3, h: 0.75, make: make((m) => { lathe(m, [[0, 0.24], [0.2, 0.34], [0.5, 0.28], [0.68, 0.1], [0.75, 0.12]], 7, SACKING); }) },
	//---------------------what a shop has---------------------
	counter: { tags: ['shop', 'bakery', 'butcher', 'tailor', 'inn', 'bank', 'hotel'], anchor: 'counter', hw: 1.6, hd: 0.34, h: 1.05, top: 1.05, make: make((m) => { box(m, -1.6, 0, -0.32, 1.6, 0.98, 0.32, PANELS); box(m, -1.64, 0.98, -0.36, 1.64, 1.05, 0.38, WOOD); box(m, -1.6, 0, 0.32, 1.6, 0.1, 0.34, WOOD); for (const x of [-1.05, 0, 1.05]) box(m, x - 0.42, 0.2, 0.32, x + 0.42, 0.86, 0.335, WOOD); }) },
	register: { tags: ['shop', 'bakery', 'butcher', 'tailor', 'inn', 'bank', 'hotel'], anchor: 'top', on: 'counter', hw: 0.2, hd: 0.2, h: 0.36, make: make((m) => { box(m, -0.18, 0, -0.18, 0.18, 0.1, 0.2, BRASS); box(m, -0.16, 0.1, -0.16, 0.16, 0.3, 0.06, BRASS); m.quad([-0.16, 0.1, 0.06], [0.16, 0.1, 0.06], [0.16, 0.06, 0.18], [-0.16, 0.06, 0.18], 0, DARK); box(m, -0.1, 0.3, -0.1, 0.1, 0.36, -0.08, ENAMEL); box(m, 0.18, 0.12, -0.02, 0.2, 0.2, 0.02, NICKEL); }) },
	displayCase: { tags: ['bakery', 'butcher', 'shop', 'tailor', 'books'], anchor: 'wall', hw: 0.8, hd: 0.3, h: 1.05, make: make((m) => { box(m, -0.8, 0, -0.3, 0.8, 0.6, 0.3, WOOD); box(m, -0.75, 0.6, -0.27, 0.75, 1.0, 0.27, CLEAR_GLASS); box(m, -0.8, 1.0, -0.3, 0.8, 1.05, 0.3, WOOD); box(m, -0.6, 0.62, -0.15, -0.2, 0.75, 0.15, CREAM); box(m, 0.1, 0.62, -0.15, 0.55, 0.72, 0.15, RAW_MEAT); }) },
	scale: { tags: ['butcher', 'bakery', 'bank', 'shop'], anchor: 'top', hw: 0.2, hd: 0.12, h: 0.42, make: make((m) => { box(m, -0.12, 0, -0.09, 0.12, 0.03, 0.09, DARK); m.strut([0, 0.03, 0], [0, 0.36, 0], 0.012, 0.01, 4, BRASS); box(m, -0.2, 0.36, -0.008, 0.2, 0.375, 0.008, BRASS); for (const s of [-1, 1]) { m.strut([s * 0.19, 0.36, 0], [s * 0.19, 0.2, 0], 0.003, 0.003, 3, BRASS); lathe(at0(m, s * 0.19), [[0.19, 0.07], [0.2, 0.07]], 6, BRASS, [0]); } }) },
	breadRack: { tags: ['bakery'], anchor: 'wall', hw: 0.7, hd: 0.24, h: 1.7, make: make((m) => { for (const x of [-0.68, 0.68]) box(m, x - 0.025, 0, -0.22, x + 0.025, 1.7, 0.22, BOARDS); for (let k = 0; k < 4; k++) { const y = 0.25 + k * 0.42; box(m, -0.68, y, -0.22, 0.68, y + 0.03, 0.22, BOARDS); box(m, -0.58, y + 0.03, -0.08, 0.58, y + 0.14, 0.08, 20); } }) },
	meatRail: { tags: ['butcher'], anchor: 'wall', hw: 1.0, hd: 0.2, h: 2.2, make: make((m) => { for (const x of [-1, 1]) m.strut([x, 0, 0], [x, 2.2, 0], 0.03, 0.03, 4, DARK); m.strut([-1, 2.1, 0], [1, 2.1, 0], 0.02, 0.02, 4, NICKEL); for (const x of [-0.6, 0, 0.6]) { m.strut([x, 2.1, 0], [x, 1.85, 0], 0.006, 0.006, 3, STEEL); m.loft([ringAt(x, 1.85, 0.05), ringAt(x, 1.6, 0.17), ringAt(x, 1.15, 0.14), ringAt(x, 0.95, 0.05)].map((r) => r.filter((_, k) => k < 4)), RAW_MEAT, 0, [0, 1]); } }) },
	butcherBlock: { tags: ['butcher', 'kitchen'], anchor: 'centre', hw: 0.45, hd: 0.45, h: 0.88, top: 0.88, make: make((m) => { box(m, -0.45, 0.55, -0.45, 0.45, 0.88, 0.45, BOARDS); legs(m, 0.38, 0.38, 0.55, 0.06, BOARDS); box(m, -0.3, 0.88, -0.02, 0.05, 0.895, 0.02, STEEL); box(m, 0.05, 0.88, -0.015, 0.2, 0.9, 0.015, WOOD); }) },
	clothesRack: { tags: ['tailor', 'shop'], anchor: 'wall', hw: 0.8, hd: 0.25, h: 1.65, make: make((m) => { for (const x of [-0.8, 0.8]) { m.strut([x, 0, 0], [x, 1.65, 0], 0.016, 0.016, 4, DARK); box(m, x - 0.02, 0, -0.24, x + 0.02, 0.03, 0.24, DARK); } m.strut([-0.8, 1.6, 0], [0.8, 1.6, 0], 0.013, 0.013, 4, DARK); [RED, BLUE, GREEN, CREAM, LEATHER].forEach((c, k) => { const x = -0.6 + k * 0.3; box(m, x - 0.05, 0.7, -0.2, x + 0.05, 1.56, 0.2, c); }); }) },
	mannequin: { tags: ['tailor'], anchor: 'corner', hw: 0.26, hd: 0.26, h: 1.6, make: make((m) => { lathe(m, [[0, 0.2], [0.03, 0.2]], 6, WOOD, [1]); m.strut([0, 0.03, 0], [0, 0.85, 0], 0.02, 0.02, 4, WOOD); lathe(m, [[0.85, 0.15], [1.05, 0.13], [1.3, 0.2], [1.45, 0.14], [1.53, 0.04], [1.6, 0.05]], 8, CREAM); }) },
	sewingTable: { tags: ['tailor'], anchor: 'wall', hw: 0.55, hd: 0.3, h: 1.05, top: 0, make: make((m) => { box(m, -0.55, 0.72, -0.3, 0.55, 0.77, 0.3, WOOD); for (const x of [-0.5, 0.5]) box(m, x - 0.02, 0, -0.27, x + 0.02, 0.72, 0.27, DARK); box(m, -0.5, 0.1, -0.2, 0.5, 0.14, 0.2, DARK); box(m, -0.26, 0.77, -0.08, 0.26, 0.82, 0.08, DARK); box(m, 0.14, 0.82, -0.05, 0.25, 1.02, 0.05, DARK); box(m, -0.2, 0.96, -0.04, 0.25, 1.05, 0.04, DARK); box(m, -0.19, 0.82, -0.015, -0.16, 0.96, 0.015, NICKEL); m.tube(0.27, 0.95, -0.03, 0.05, 0.03, 0.05, 8, BRASS, 0, [0, 1]); }) },
	mirror: { tags: ['tailor', 'bed', 'home', 'hotel'], anchor: 'hang', hw: 0.3, hd: 0.03, h: 1.2, make: make((m) => { box(m, -0.3, -0.6, 0, 0.3, 0.6, 0.03, WOOD); box(m, -0.26, -0.56, 0.03, 0.26, 0.56, 0.035, NICKEL); }) },
	fabricBolts: { tags: ['tailor'], anchor: 'wall', hw: 0.75, hd: 0.25, h: 1.5, make: make((m) => { box(m, -0.75, 0, -0.25, 0.75, 0.04, 0.25, WOOD); box(m, -0.75, 0, -0.25, 0.75, 1.5, -0.22, WOOD); [RED, BLUE, GREEN, CREAM, LEATHER, BOARDS].forEach((c, k) => { const y = 0.12 + (k % 3) * 0.42, x = -0.5 + (k % 3) * 0.5 + (k > 2 ? 0 : 0); m.tube(x, y + (k > 2 ? 0.0 : 0), -0.2, 0.09, 0.22, 0.09, 6, c, 0, [1]); }); }) },
	tellerCage: { tags: ['bank'], anchor: 'wall', hw: 0.8, hd: 0.3, h: 2.05, make: make((m) => { box(m, -0.8, 0, -0.3, 0.8, 1.0, 0.3, PANELS); box(m, -0.8, 1.0, -0.32, 0.8, 1.05, 0.32, WOOD); for (let k = 0; k < 7; k++) { const x = -0.75 + k * 0.25; m.strut([x, 1.05, 0.28], [x, 2.05, 0.28], 0.008, 0.008, 3, BRASS); } box(m, -0.8, 2.0, 0.26, 0.8, 2.05, 0.3, BRASS); }) },
	//---------------------what a home has---------------------
	bed: { tags: ['bed', 'hotel'], anchor: 'wall', hw: 0.55, hd: 1.0, h: 1.05, make: make((m) => { box(m, -0.55, 0.15, -1.0, 0.55, 0.45, 1.0, WOOD); box(m, -0.52, 0.45, -0.95, 0.52, 0.58, 0.98, CREAM); box(m, -0.53, 0.5, -0.55, 0.53, 0.6, 0.99, RED); box(m, -0.4, 0.58, -0.92, 0.4, 0.7, -0.6, ENAMEL); box(m, -0.55, 0, -1.04, 0.55, 1.05, -0.98, WOOD); box(m, -0.55, 0, 0.98, 0.55, 0.65, 1.02, WOOD); }) },
	nightstand: { tags: ['bed', 'hotel'], anchor: 'wall', hw: 0.24, hd: 0.2, h: 0.6, top: 0.6, make: make((m) => { box(m, -0.24, 0.1, -0.2, 0.24, 0.6, 0.2, WOOD); legs(m, 0.2, 0.16, 0.1, 0.02); box(m, -0.2, 0.3, 0.2, 0.2, 0.52, 0.21, PANELS); box(m, -0.02, 0.4, 0.21, 0.02, 0.44, 0.23, BRASS); }) },
	rug: { tags: ['home', 'bed', 'bank', 'books', 'hotel', 'dining'], anchor: 'floor', solid: false, hw: 1.0, hd: 0.7, h: 0.02, make: make((m) => { box(m, -1.0, 0, -0.7, 1.0, 0.012, 0.7, RED); box(m, -0.8, 0.012, -0.5, 0.8, 0.016, 0.5, CREAM); box(m, -0.65, 0.016, -0.36, 0.65, 0.02, 0.36, BLUE); }) },
	fireplace: { tags: ['home', 'inn', 'books', 'bank', 'hotel'], anchor: 'wall', fire: [0, 0.3, 0.05], hw: 0.85, hd: 0.3, h: 1.35, top: 0, make: make((m) => { box(m, -0.85, 0, -0.3, -0.45, 1.2, 0.26, FIREBRICK); box(m, 0.45, 0, -0.3, 0.85, 1.2, 0.26, FIREBRICK); box(m, -0.45, 0.8, -0.3, 0.45, 1.2, 0.26, FIREBRICK); box(m, -0.45, 0, -0.3, 0.45, 0.8, -0.24, FIREBRICK); box(m, -0.95, 1.2, -0.3, 0.95, 1.3, 0.34, WOOD); box(m, -0.45, 0, -0.24, 0.45, 0.03, 0.34, STONE); for (const [a, c] of [[-0.28, 0.08], [0.24, -0.02], [0, 0.14]]) m.strut([a, 0.08, c], [-a, 0.13, c + 0.05], 0.05, 0.045, 5, 32); lathe(at0(m, 0, 0.05), [[0.03, 0.34], [0.09, 0.2]], 8, EMBERS, [1]); for (let k = 0; k < 3; k++) m.strut([-0.15 + k * 0.15, 0.1, 0.04], [-0.15 + k * 0.15, 0.42 - (k % 2) * 0.1, 0.04], 0.07, 0.002, 4, FLAME); }) },
	kitchenStove: { tags: ['kitchen', 'inn', 'sea', 'lamp'], anchor: 'wall', fire: [0, 0.45, 0.3], hw: 0.55, hd: 0.34, h: 2.3, top: 0.82, make: make((m) => { box(m, -0.55, 0.12, -0.34, 0.55, 0.82, 0.34, BLUED); legs(m, 0.5, 0.3, 0.12, 0.03, DARK); box(m, -0.5, 0.2, 0.34, -0.02, 0.45, 0.35, EMBERS); box(m, 0.05, 0.2, 0.34, 0.5, 0.7, 0.35, DARK); box(m, 0.2, 0.42, 0.35, 0.34, 0.46, 0.38, NICKEL); m.strut([0.35, 0.82, -0.2], [0.35, 2.3, -0.2], 0.06, 0.06, 6, DARK); }) },
	bakeOven: { tags: ['bakery'], anchor: 'wall', fire: [0, 0.65, 0.5], hw: 1.1, hd: 0.7, h: 2.4, make: make((m) => { box(m, -1.1, 0, -0.7, 1.1, 0.5, 0.65, FIREBRICK); m.loft([[0, 1, 2, 3, 4, 5].map((k) => [Math.cos(k / 5 * Math.PI) * 1.1, 0.5 + Math.sin(k / 5 * Math.PI) * 0.9, -0.7]), [0, 1, 2, 3, 4, 5].map((k) => [Math.cos(k / 5 * Math.PI) * 1.1, 0.5 + Math.sin(k / 5 * Math.PI) * 0.9, 0.65])], FIREBRICK, 0, [0, 1]); box(m, -0.4, 0.5, 0.65, 0.4, 1.0, 0.66, EMBERS); box(m, -0.45, 1.0, 0.65, 0.45, 1.06, 0.68, DARK); box(m, 0.5, 1.2, -0.4, 0.9, 2.4, 0.0, FIREBRICK); box(m, -0.5, 0.42, 0.65, 0.5, 0.5, 0.95, STONE); }) },
	radiator: { tags: ['home', 'office', 'bank', 'hotel', 'books', 'bed', 'tailor'], anchor: 'wall', hw: 0.75, hd: 0.08, h: 0.22, make: make((m) => { box(m, -0.75, 0.02, -0.04, 0.75, 0.2, 0.06, ENAMEL); for (let k = 0; k < 6; k++) { const x = -0.65 + k * 0.26; box(m, x - 0.02, 0.05, 0.06, x + 0.02, 0.17, 0.07, CEILING); } m.strut([-0.75, 0.09, 0], [-0.82, 0.09, 0], 0.015, 0.015, 4, BRASS); m.strut([0.75, 0.09, 0], [0.82, 0.09, 0], 0.015, 0.015, 4, BRASS); }) },
	sink: { tags: ['kitchen', 'butcher', 'bakery'], anchor: 'wall', hw: 0.5, hd: 0.28, h: 1.1, make: make((m) => { box(m, -0.5, 0, -0.28, 0.5, 0.78, 0.28, WOOD); box(m, -0.4, 0.78, -0.2, 0.4, 0.86, 0.2, ENAMEL); box(m, -0.35, 0.8, -0.15, 0.35, 0.865, 0.15, BLUED); m.strut([0, 0.86, -0.23], [0, 1.1, -0.23], 0.015, 0.012, 4, BRASS); m.strut([0, 1.1, -0.23], [0, 1.02, -0.05], 0.012, 0.01, 4, BRASS); }) },
	cookingPot: { tags: ['kitchen', 'inn', 'bakery'], anchor: 'top', hw: 0.15, hd: 0.15, h: 0.24, make: make((m) => { lathe(m, [[0, 0.1], [0.03, 0.15], [0.18, 0.15], [0.2, 0.14]], 8, DARK, [0]); lathe(m, [[0.2, 0.14], [0.22, 0.03], [0.24, 0.02]], 8, BLUED, [1]); for (const s of [-1, 1]) box(m, s * 0.17 - 0.03, 0.13, -0.015, s * 0.17 + 0.03, 0.15, 0.015, DARK); }) },
	hangingPans: { tags: ['kitchen', 'inn', 'bakery'], anchor: 'hang', hw: 0.5, hd: 0.08, h: 0.7, make: make((m) => { box(m, -0.5, 0.22, 0, 0.5, 0.27, 0.03, BOARDS); [-0.3, 0.05, 0.33].forEach((x, k) => { const r = 0.11 + k * 0.02; m.strut([x, 0.24, 0.03], [x, -0.08 + r, 0.05], 0.008, 0.008, 3, BLUED); m.tube(x, -0.08, 0.03, r, 0.07, r, 8, k == 1 ? BRASS : BLUED, 0, [0]); }); }) },
	mug: { tags: ['inn', 'dining', 'office', 'sea', 'kitchen'], anchor: 'top', hw: 0.06, hd: 0.06, h: 0.11, make: make((m) => { lathe(m, [[0, 0.04], [0.1, 0.045]], 8, CREAM, [0]); lathe(m, [[0.095, 0.043], [0.1, 0.045]], 8, BLUED, [1]); m.strut([0.04, 0.03, 0], [0.07, 0.05, 0], 0.006, 0.006, 3, CREAM); m.strut([0.07, 0.05, 0], [0.04, 0.08, 0], 0.006, 0.006, 3, CREAM); }) },
	//---------------------what lights it---------------------
	candle: { tags: ['home', 'church', 'dining', 'inn', 'bed', 'books'], anchor: 'top', hw: 0.05, hd: 0.05, h: 0.26, make: make((m) => { lathe(m, [[0, 0.05], [0.02, 0.05]], 6, BRASS); m.strut([0, 0.02, 0], [0, 0.17, 0], 0.012, 0.011, 5, ENAMEL); m.strut([0, 0.17, 0], [0, 0.25, 0], 0.012, 0.0005, 5, FLAME); }) },
	tableLamp: { tags: ['office', 'bank', 'books', 'home', 'bed', 'hotel'], anchor: 'top', hw: 0.11, hd: 0.11, h: 0.42, make: make((m) => { lathe(m, [[0, 0.08], [0.03, 0.03], [0.22, 0.02]], 6, BRASS, [0]); lathe(m, [[0.2, 0.11], [0.38, 0.05]], 8, LAMP, [1]); }) },
	ceilingLamp: { tags: ['all'], anchor: 'ceil', light: true, solid: false, hw: 0.25, hd: 0.25, h: 0.8, make: make((m) => { m.strut([0, 0, 0], [0, -0.5, 0], 0.008, 0.008, 3, DARK); lathe(m, [[-0.5, 0.05], [-0.58, 0.24], [-0.62, 0.26]], 8, BRASS, []); lathe(m, [[-0.6, 0.1], [-0.76, 0.09], [-0.8, 0.02]], 6, LAMP, [1]); }) },
	wallSconce: { tags: ['home', 'inn', 'church', 'bank', 'hotel', 'books'], anchor: 'hang', light: true, solid: false, hw: 0.08, hd: 0.15, h: 0.34, make: make((m) => { box(m, -0.05, -0.1, 0, 0.05, 0.1, 0.02, BRASS); m.strut([0, -0.02, 0.02], [0, 0, 0.13], 0.01, 0.01, 4, BRASS); lathe(atXZ(m, 0, 0.13), [[0, 0.05], [0.04, 0.03]], 6, BRASS, [0]); lathe(atXZ(m, 0, 0.13), [[0.04, 0.045], [0.2, 0.03], [0.24, 0.01]], 6, LAMP, [1]); }) },
	//---------------------what is to look at---------------------
	plantPot: { tags: ['home', 'books', 'office', 'shop', 'garden', 'hotel', 'bed', 'art'], anchor: 'top', hw: 0.13, hd: 0.13, h: 0.42, make: make((m) => { lathe(m, [[0, 0.07], [0.14, 0.1]], 6, POT, [0, 1]); for (let k = 0; k < 7; k++) { const a = k * 0.9, r = 0.05 + (k % 3) * 0.05; m.tri([0, 0.13, 0], [Math.cos(a) * r - Math.sin(a) * 0.03, 0.3, Math.sin(a) * r + Math.cos(a) * 0.03], [Math.cos(a) * r * 2, 0.26 + (k % 2) * 0.16, Math.sin(a) * r * 2], 0, LEAF); } }) },
	plantTall: { tags: ['home', 'bank', 'shop', 'hotel', 'garden', 'books'], anchor: 'corner', hw: 0.34, hd: 0.34, h: 1.75, make: make((m) => { lathe(m, [[0, 0.16], [0.36, 0.22]], 8, POT, [0, 1]); m.strut([0, 0.3, 0], [0, 1.1, 0], 0.02, 0.012, 4, BOARDS); for (let k = 0; k < 14; k++) { const a = k * 2.4, y = 0.75 + k * 0.07, r = 0.2 + (k % 4) * 0.06; const c = [0, y - 0.15, 0], p = [Math.cos(a) * r, y + 0.2, Math.sin(a) * r], q = [Math.cos(a + 0.5) * r * 1.5, y - 0.1, Math.sin(a + 0.5) * r * 1.5]; m.tri(c, p, q, 0, LEAF); } }) },
	pictureLandscape: { tags: ['home', 'inn', 'bank', 'books', 'hotel', 'art', 'office'], anchor: 'hang', solid: false, hw: 0.45, hd: 0.03, h: 0.62, make: make((m) => { box(m, -0.45, -0.31, 0, 0.45, 0.31, 0.03, BRASS); box(m, -0.39, -0.25, 0.03, 0.39, 0.25, 0.035, PAINTING); }) },
	picturePortrait: { tags: ['home', 'bank', 'church', 'office', 'hotel', 'bed'], anchor: 'hang', solid: false, hw: 0.28, hd: 0.03, h: 0.8, make: make((m) => { box(m, -0.28, -0.4, 0, 0.28, 0.4, 0.03, WOOD); box(m, -0.23, -0.35, 0.03, 0.23, 0.35, 0.034, INK); lathe(atWall(m, 0, 0.09), [[-0.1, 0.01], [-0.05, 0.08], [0.05, 0.08], [0.1, 0.01]], 6, CREAM, []); box(m, -0.16, -0.32, 0.034, 0.16, -0.04, 0.038, BLUE); }) },
	wallClock: { tags: ['shop', 'kitchen', 'office', 'inn', 'bank', 'store', 'lamp'], anchor: 'hang', solid: false, hw: 0.2, hd: 0.05, h: 0.4, make: make((m) => { m.tube(0, 0, 0, 0.2, 0.04, 0.2, 12, WOOD, 0, [0]); m.disc(0, 0, 0.042, 0.17, 12, ENAMEL); box(m, -0.008, 0, 0.043, 0.008, 0.13, 0.047, INK); box(m, 0, -0.008, 0.043, 0.09, 0.008, 0.047, INK); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2, x = Math.cos(a) * 0.145, y = Math.sin(a) * 0.145; box(m, x - 0.01, y - 0.01, 0.043, x + 0.01, y + 0.01, 0.045, INK); } }) },
	grandfatherClock: { tags: ['home', 'bank', 'books', 'hotel', 'office'], anchor: 'wall', hw: 0.28, hd: 0.2, h: 2.2, make: make((m) => { box(m, -0.28, 0, -0.2, 0.28, 0.4, 0.2, WOOD); box(m, -0.2, 0.4, -0.15, 0.2, 1.55, 0.15, WOOD); box(m, -0.28, 1.55, -0.2, 0.28, 2.1, 0.2, WOOD); box(m, -0.3, 2.1, -0.22, 0.3, 2.2, 0.22, PANELS); m.disc(0, 1.82, 0.205, 0.2, 12, ENAMEL); box(m, -0.008, 1.82, 0.206, 0.008, 1.95, 0.21, INK); box(m, 0, 1.815, 0.206, 0.1, 1.83, 0.21, INK); box(m, -0.012, 0.75, 0.15, 0.012, 1.45, 0.16, BRASS); m.disc(0, 0.75, 0.161, 0.08, 8, BRASS); }) },
	globe: { tags: ['books', 'office', 'sea'], anchor: 'top', hw: 0.14, hd: 0.14, h: 0.38, make: make((m) => { lathe(m, [[0, 0.09], [0.03, 0.03], [0.09, 0.02]], 6, WOOD, [0]); m.ball([0, 0.24, 0], 0.14, 8, BLUE); box(m, -0.01, 0.1, -0.15, 0.01, 0.38, -0.14, BRASS); }) },
	bookStack: { tags: ['books', 'office', 'bank', 'bed', 'home', 'church'], anchor: 'top', hw: 0.14, hd: 0.1, h: 0.14, make: make((m) => { box(m, -0.13, 0, -0.09, 0.13, 0.04, 0.09, RED); box(m, -0.12, 0.04, -0.08, 0.11, 0.085, 0.09, BLUE); box(m, -0.1, 0.085, -0.09, 0.12, 0.13, 0.07, GREEN); }) },
	//---------------------what a trade has---------------------
	pew: { tags: ['church'], anchor: 'centre', hw: 1.3, hd: 0.26, h: 0.95, make: make((m) => { box(m, -1.3, 0.42, -0.24, 1.3, 0.47, 0.22, WOOD); box(m, -1.3, 0.47, -0.26, 1.3, 0.95, -0.22, WOOD); for (const x of [-1.3, 0, 1.3]) box(m, x - 0.03, 0, -0.26, x + 0.03, 0.8, 0.26, WOOD); }) },
	altar: { tags: ['church'], anchor: 'centre', hw: 0.9, hd: 0.4, h: 1.65, top: 1.0, make: make((m) => { box(m, -0.95, 0, -0.45, 0.95, 0.12, 0.45, STONE); box(m, -0.8, 0.12, -0.35, 0.8, 0.95, 0.35, STONE); box(m, -0.85, 0.95, -0.38, 0.85, 1.0, 0.38, ENAMEL); box(m, -0.5, 0.45, 0.35, 0.5, 0.95, 0.38, RED); box(m, -0.03, 1.0, -0.03, 0.03, 1.65, 0.03, BRASS); box(m, -0.17, 1.4, -0.03, 0.17, 1.46, 0.03, BRASS); }) },
	lectern: { tags: ['church', 'books'], anchor: 'centre', hw: 0.28, hd: 0.26, h: 1.2, make: make((m) => { lathe(m, [[0, 0.24], [0.05, 0.1], [1.0, 0.07]], 6, WOOD); m.quad([-0.28, 1.0, -0.2], [0.28, 1.0, -0.2], [0.28, 1.2, 0.2], [-0.28, 1.2, 0.2], 0, WOOD); m.quad([-0.22, 1.03, -0.14], [0.22, 1.03, -0.14], [0.22, 1.2, 0.17], [-0.22, 1.2, 0.17], 0, PAPER); }) },
	easel: { tags: ['art'], anchor: 'centre', hw: 0.4, hd: 0.36, h: 1.75, make: make((m) => { m.strut([-0.36, 0, 0.26], [0, 1.75, 0], 0.02, 0.015, 4, BOARDS); m.strut([0.36, 0, 0.26], [0, 1.75, 0], 0.02, 0.015, 4, BOARDS); m.strut([0, 0, -0.34], [0, 1.65, -0.02], 0.02, 0.015, 4, BOARDS); box(m, -0.38, 0.72, 0.1, 0.38, 0.76, 0.19, BOARDS); m.quad([-0.34, 0.76, 0.17], [0.34, 0.76, 0.17], [0.34, 1.46, 0.05], [-0.34, 1.46, 0.05], 0, PAINTING); }) },
	netRack: { tags: ['sea'], anchor: 'wall', hw: 0.9, hd: 0.14, h: 1.9, make: make((m) => { for (const x of [-0.9, 0.9]) m.strut([x, 0, 0], [x, 1.9, 0], 0.03, 0.03, 4, BOARDS); m.strut([-0.9, 1.8, 0], [0.9, 1.8, 0], 0.02, 0.02, 4, BOARDS); for (let k = 0; k < 8; k++) { const x = -0.8 + k * 0.23, sag = 0.5 + 0.35 * Math.sin(k * 1.9); m.quad([x, 1.8, 0.03], [x + 0.21, 1.8, 0.03], [x + 0.24, sag, 0.08], [x - 0.03, sag, 0.08], 0, ROPE_NET); } for (const x of [-0.5, 0.2, 0.6]) m.ball([x, 0.7, 0.1], 0.06, 4, GREEN_GLASS); }) },
	shipWheel: { tags: ['sea'], anchor: 'hang', solid: false, hw: 0.42, hd: 0.08, h: 0.84, make: make((m) => { m.tube(0, 0, 0.04, 0.1, 0.09, 0.1, 8, BRASS, 0, [1]); const ring = (r, z) => Array.from({ length: 10 }, (_, k) => { const a = k / 10 * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r, z]; }); m.loft([ring(0.42, 0.05), ring(0.36, 0.05), ring(0.36, 0.08), ring(0.42, 0.08), ring(0.42, 0.05)], WOOD, 0); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; m.strut([Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0.065], [Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0.065], 0.012, 0.012, 3, WOOD); } }) },
	pottingBench: { tags: ['garden'], anchor: 'wall', hw: 0.9, hd: 0.32, h: 1.2, top: 0.85, make: make((m) => { box(m, -0.9, 0.8, -0.32, 0.9, 0.85, 0.32, BOARDS); legs(m, 0.82, 0.26, 0.8, 0.035, BOARDS); box(m, -0.9, 0.85, -0.32, 0.9, 1.2, -0.29, BOARDS); box(m, -0.8, 0.3, -0.26, 0.8, 0.33, 0.26, BOARDS); for (const x of [-0.5, 0.0, 0.5]) lathe(atXZ(m, x, 0), [[0.33, 0.07], [0.46, 0.1]], 6, POT, [0, 1]); }) },
	lampRack: { tags: ['lamp'], anchor: 'wall', hw: 0.7, hd: 0.2, h: 1.7, make: make((m) => { for (const x of [-0.68, 0.68]) box(m, x - 0.025, 0, -0.2, x + 0.025, 1.7, 0.2, BOARDS); for (let k = 0; k < 3; k++) { const y = 0.3 + k * 0.5; box(m, -0.68, y, -0.2, 0.68, y + 0.03, 0.2, BOARDS); box(m, -0.45, y + 0.03, -0.05, 0.45, y + 0.1, 0.05, BRASS); box(m, -0.4, y + 0.1, -0.04, 0.4, y + 0.3, 0.04, k == 1 ? LAMP : CLEAR_GLASS); } }) },
};
const ROPE_NET = 35;
// (what is made round y moved somewhere: lathe's loft through a builder that adds the place)
function atXZ(m, x, z) { return { loft: (rings, material, part, caps) => m.loft(rings.map((r) => r.map(([a, b, c]) => [a + x, b, c + z])), material, part, caps) }; }
function at0(m, x, z = 0) { return atXZ(m, x, z); }
// (round z, lying against a wall: a ring's y its z, at height y)
function atWall(m, x, y) { return { loft: (rings, material, part, caps) => m.loft(rings.map((r) => r.map(([a, b, c]) => [a * 0.9 + x, c + y, b * 0.02 + 0.037])), material, part, caps) }; }
function ringAt(x, y, r) { return Array.from({ length: 5 }, (_, k) => { const a = (k + 0.5) / 5 * Math.PI * 2; return [x + Math.cos(a) * r * 0.8, y, Math.sin(a) * r * 0.6 + 0.05]; }); }

/*
	THE ROOMS. tags, what it is made of (wall, floor, panelled: panelling up the walls' feet), what it must have, how many more of each anchor it fills by lot.
	rows: a model set out in rows across it (a chapel's pews).
*/
export const ROOMS = {
	bakeryShop: { tags: ['bakery', 'shop'], wall: PLASTER, floor: PLANKS, must: ['counter', 'register', 'breadRack', 'displayCase'], fill: { hang: 2, corner: 1, top: 2 } },
	bakehouse: { tags: ['bakery', 'kitchen'], wall: PLASTER, floor: FLAGS, must: ['bakeOven', 'tableLong', 'grainSack', 'shelfUnit', 'sink'], fill: { corner: 2, hang: 1, top: 2 } },
	butcherShop: { tags: ['butcher', 'shop'], wall: PLASTER, floor: TILES, must: ['counter', 'register', 'scale', 'meatRail', 'displayCase'], fill: { hang: 1, corner: 1 } },
	coldRoom: { tags: ['butcher'], wall: PLASTER, floor: TILES, must: ['meatRail', 'butcherBlock', 'sink', 'barrel'], fill: { wall: 1, corner: 1 } },
	outfitterShop: { tags: ['shop', 'store'], wall: PANELS, floor: PLANKS, must: ['counter', 'register', 'shelfUnit', 'clothesRack', 'crateStack'], fill: { wall: 1, corner: 1, hang: 1, top: 1 } },
	stockRoom: { tags: ['store'], wall: PLASTER, floor: PLANKS, must: ['crateStack', 'shelfUnit', 'barrel', 'chest'], fill: { corner: 2, wall: 2 } },
	tailorShop: { tags: ['tailor', 'shop'], wall: WALLPAPER, floor: PLANKS, panelled: true, must: ['counter', 'register', 'fabricBolts', 'mannequin', 'mirror', 'clothesRack'], fill: { hang: 1, wall: 1, floor: 1, ceil: 1 } },
	fittingRoom: { tags: ['tailor'], wall: BLUE_PAPER, floor: PLANKS, panelled: true, must: ['sewingTable', 'wardrobe', 'mirror', 'mannequin', 'radiator'], fill: { wall: 1, corner: 1 } },
	tapRoom: { tags: ['inn', 'dining'], wall: PANELS, floor: PLANKS, must: ['counter', 'register', 'fireplace', 'tableRound', 'barrel', 'stool'], fill: { centre: 5, hang: 3, top: 6, corner: 1 } },
	innKitchen: { tags: ['kitchen', 'inn'], wall: PLASTER, floor: FLAGS, must: ['kitchenStove', 'sink', 'tableLong', 'shelfUnit', 'hangingPans'], fill: { top: 3, corner: 1, centre: 1 } },
	guestRoom: { tags: ['bed'], wall: WALLPAPER, floor: PLANKS, panelled: true, must: ['bed', 'nightstand', 'wardrobe', 'radiator', 'rug'], fill: { hang: 2, top: 2, corner: 1 } },
	hotelLobby: { tags: ['hotel', 'home'], wall: WALLPAPER, floor: TILES, panelled: true, must: ['counter', 'register', 'plantTall', 'armchair', 'rug', 'radiator'], fill: { hang: 3, corner: 2, wall: 2, ceil: 1, top: 2 } },
	diningRoom: { tags: ['dining'], wall: BLUE_PAPER, floor: PLANKS, panelled: true, must: ['tableLong', 'tableRound', 'chair', 'chair'], fill: { centre: 4, hang: 2, top: 5 } },
	bankHall: { tags: ['bank'], wall: PANELS, floor: TILES, must: ['counter', 'tellerCage', 'register', 'plantTall', 'grandfatherClock', 'radiator'], fill: { hang: 3, floor: 1, corner: 1, top: 1 } },
	vault: { tags: ['bank'], wall: FIREBRICK, floor: FLAGS, must: ['safe', 'safe', 'cabinet', 'chest'], fill: { corner: 1 } },
	office: { tags: ['office'], wall: WALLPAPER, floor: PLANKS, panelled: true, must: ['desk', 'chair', 'bookcase', 'radiator', 'tableLamp'], fill: { hang: 2, wall: 1, corner: 1, top: 2 } },
	readingRoom: { tags: ['books'], wall: PANELS, floor: PLANKS, must: ['tableLong', 'chair', 'chair', 'bookcase', 'bookcase', 'bookcase', 'bookcase', 'rug', 'globe'], fill: { wall: 3, top: 3, hang: 2, corner: 1, centre: 1 } },
	stacks: { tags: ['books'], wall: PLASTER, floor: PLANKS, must: ['bookcase', 'bookcase', 'bookcase', 'bookcase', 'lectern'], fill: { wall: 3, hang: 1 } },
	nave: { tags: ['church'], wall: PLASTER, floor: FLAGS, rows: 'pew', must: ['altar', 'lectern', 'candle', 'candle'], fill: { hang: 4, top: 1 } },
	sacristy: { tags: ['church'], wall: PLASTER, floor: FLAGS, must: ['cabinet', 'chest', 'picturePortrait'], fill: { top: 1, hang: 1 } },
	warehouseFloor: { tags: ['store', 'sea'], wall: PLASTER, floor: FLAGS, must: ['crateStack', 'crateStack', 'crateStack', 'barrel', 'barrel', 'grainSack', 'netRack', 'chest'], fill: { corner: 4, wall: 4 } },
	tallyOffice: { tags: ['office'], wall: PLASTER, floor: PLANKS, must: ['desk', 'chair', 'safe', 'shelfUnit', 'wallClock'], fill: { hang: 1, top: 2 } },
	netLoft: { tags: ['sea'], wall: PANELS, floor: PLANKS, must: ['netRack', 'barrel', 'chest', 'stool', 'kitchenStove', 'shipWheel'], fill: { corner: 1, top: 1 } },
	lampStore: { tags: ['lamp'], wall: PLASTER, floor: FLAGS, must: ['lampRack', 'lampRack', 'shelfUnit', 'barrel', 'desk'], fill: { hang: 1, wall: 1, corner: 1 } },
	studio: { tags: ['art'], wall: PLASTER, floor: PLANKS, must: ['easel', 'easel', 'stool', 'tableLong', 'plantPot'], fill: { hang: 3, top: 2 } },
	parlour: { tags: ['home'], wall: WALLPAPER, floor: PLANKS, panelled: true, must: ['fireplace', 'armchair', 'rug', 'tableRound', 'grandfatherClock', 'radiator'], fill: { hang: 3, corner: 1, top: 3 } },
	pottingRoom: { tags: ['garden'], wall: PLASTER, floor: FLAGS, must: ['pottingBench', 'plantPot', 'plantTall', 'grainSack', 'barrel'], fill: { corner: 1, top: 2, wall: 1 } },
	kitchen: { tags: ['kitchen', 'home'], wall: PLASTER, floor: TILES, must: ['kitchenStove', 'sink', 'tableRound', 'chair', 'shelfUnit', 'hangingPans'], fill: { top: 3, centre: 1 } },
	chartRoom: { tags: ['sea', 'books'], wall: PANELS, floor: PLANKS, must: ['desk', 'shipWheel', 'globe', 'bookcase', 'chest', 'chair'], fill: { hang: 2, top: 2, corner: 1 } },
};
// the building's rooms, by who lives there (townFolk.js): the first is the one its door opens into
export const PLANS = {
	bakery: ['bakeryShop', 'bakehouse'], timbered: ['butcherShop', 'coldRoom'], shop: ['outfitterShop', 'stockRoom'], townhouse: ['tailorShop', 'fittingRoom'],
	inn: ['tapRoom', 'innKitchen', 'guestRoom'], hotel: ['hotelLobby', 'diningRoom', 'guestRoom'], mansard: ['bankHall', 'vault', 'office'], library: ['readingRoom', 'stacks', 'office'],
	chapel: ['nave', 'sacristy'], warehouse: ['warehouseFloor', 'tallyOffice'], shack: ['netLoft'], tower: ['lampStore'], turret: ['studio', 'parlour'],
	cottages: ['pottingRoom', 'kitchen'], gabled: ['chartRoom', 'parlour'],
};

const INSET = 0.3;					// world units its walls are inside the house's
const GAP = { w: 2.6, h: 4.8 };		// a doorway between rooms, world units
const SPLIT = 0.58;					// how much of its depth the front room has
// a building's plan, in its own world units: { floorY, ceil, rooms: [{ x0, x1, z0, z1, tag }], doors: [{ x, z, w, h }], gaps: [{ along: 'x' | 'z', at, c, w, h }], porch }
const plans = new Map();
export function planOf(t, v) {
	const key = t * 10 + v;
	if (plans.has(key)) return plans.get(key);
	const M = buildingMeshes()[t][v], names = PLANS[BUILDING_TYPES[t].name] ?? ['parlour'], w = M.width, d = M.depth;
	const x0 = -w / 2 + INSET, x1 = w / 2 - INSET, z0 = -d / 2 + INSET, z1 = d / 2 - (M.porch ? 0.8 : INSET);
	const rooms = [], gaps = [], door = M.doors[0] ?? { x: 0 };
	const clampX = (c, a, b) => Math.min(Math.max(c, a + GAP.w / 2 + 0.8), b - GAP.w / 2 - 0.8);
	if (BUILDING_TYPES[t].name == 'cottages') {
		// (two front doors: a room to each, a door between)
		rooms.push({ x0, x1: -0.15, z0, z1, tag: names[0] }, { x0: 0.15, x1, z0, z1, tag: names[1] });
		gaps.push({ along: 'z', at: 0, c: (z0 + z1) / 2, w: GAP.w, h: GAP.h });
	} else if (names.length == 1) {
		rooms.push({ x0, x1, z0, z1, tag: names[0] });
	} else {
		const split = z1 - (z1 - z0) * SPLIT;
		rooms.push({ x0, x1, z0: split + 0.15, z1, tag: names[0] });
		if (names.length == 2) {
			rooms.push({ x0, x1, z0, z1: split - 0.15, tag: names[1] });
			gaps.push({ along: 'x', at: split, c: door.x > (x0 + x1) / 2 ? x0 + GAP.w / 2 + 0.8 : x1 - GAP.w / 2 - 0.8, w: GAP.w, h: GAP.h });
		} else {
			const mid = (x0 + x1) / 2;
			rooms.push({ x0, x1: mid - 0.15, z0, z1: split - 0.15, tag: names[1] }, { x0: mid + 0.15, x1, z0, z1: split - 0.15, tag: names[2] });
			gaps.push({ along: 'x', at: split, c: clampX((x0 + mid) / 2, x0, mid), w: GAP.w, h: GAP.h }, { along: 'x', at: split, c: clampX((mid + x1) / 2, mid, x1), w: GAP.w, h: GAP.h });
		}
	}
	// (the walls between the rooms, for what bumps into them: town.js)
	const walls = rooms.length < 2 ? [] : BUILDING_TYPES[t].name == 'cottages' ? [[0, z0, 0, z1]] : gaps.length == 1 ? [[x0, gaps[0].at, x1, gaps[0].at]] : [[x0, gaps[0].at, x1, gaps[0].at], [(x0 + x1) / 2, z0, (x0 + x1) / 2, gaps[0].at]];
	const plan = { floorY: M.floorY, ceil: M.ceil, rooms, doors: M.doors, gaps, walls, windows: M.windows, porch: M.porch ?? null, solids: M.solids ?? [], w, d, inner: { x0, x1, z0, z1 } };
	plans.set(key, plan);
	return plan;
}

// THE SHELL (see the top)
function quadU(m, a, b, c, d, material) { m.quad(a.map((v) => v * U), b.map((v) => v * U), c.map((v) => v * U), d.map((v) => v * U), 0, material); }
// a wall on the line from (ax, az) to (bx, bz), floor to ceiling, with its openings cut out of it, and panelling up to PANEL if it has it
const PANEL = 2.0;
function wallOf(m, ax, az, bx, bz, y0, y1, holes, material, panelled) {
	const len = Math.hypot(bx - ax, bz - az), P = (s, y) => [ax + (bx - ax) * s / len, y, az + (bz - az) * s / len];
	const spans = [];
	let from = 0;
	for (const h of [...holes].sort((p, q) => p.c - q.c)) { const a = Math.max(h.c - h.w / 2, 0), b = Math.min(h.c + h.w / 2, len); if (a > from) spans.push([from, a, y0]); spans.push([a, b, y0 + h.h]); from = b; }
	if (from < len) spans.push([from, len, y0]);
	for (const [a, b, low] of spans) if (low < y1) {
		quadU(m, P(a, low), P(b, low), P(b, y1), P(a, y1), material);
		if (panelled && low == y0) quadU(m, P(a, y0), P(b, y0), P(b, y0 + PANEL), P(a, y0 + PANEL), PANELS);
	}
}
function shellOf(t, v) {
	const m = vm.meshBuilder(), plan = planOf(t, v), y0 = plan.floorY, y1 = plan.ceil;
	const openings = (along, at) => [
		...plan.gaps.filter((g) => g.along == along && Math.abs(g.at - at) < 0.4),
		...(along == 'x' && Math.abs(at - plan.inner.z1) < 0.4 ? plan.doors.map((D) => ({ c: D.x, w: D.w, h: D.h - y0 })) : []),
	];
	for (const R of plan.rooms) {
		const K = ROOMS[R.tag], A = K.panelled;
		quadU(m, [R.x0, y0, R.z0], [R.x1, y0, R.z0], [R.x1, y0, R.z1], [R.x0, y0, R.z1], K.floor);
		quadU(m, [R.x0, y1, R.z0], [R.x1, y1, R.z0], [R.x1, y1, R.z1], [R.x0, y1, R.z1], CEILING);
		const along = (at, a0, a1) => openings('x', at).filter((o) => o.c > a0 && o.c < a1).map((o) => ({ ...o, c: o.c - a0 }));
		const across = (at, a0, a1) => openings('z', at).filter((o) => o.c > a0 && o.c < a1).map((o) => ({ ...o, c: o.c - a0 }));
		// (a wall that shares a line with a neighbour's: the gap is half way between, so look either side of it)
		wallOf(m, R.x0, R.z1, R.x1, R.z1, y0, y1, along(nearLine(plan, R.z1, 'x'), R.x0, R.x1), K.wall, A);
		wallOf(m, R.x0, R.z0, R.x1, R.z0, y0, y1, along(nearLine(plan, R.z0, 'x'), R.x0, R.x1), K.wall, A);
		wallOf(m, R.x0, R.z0, R.x0, R.z1, y0, y1, across(nearLine(plan, R.x0, 'z'), R.z0, R.z1), K.wall, A);
		wallOf(m, R.x1, R.z0, R.x1, R.z1, y0, y1, across(nearLine(plan, R.x1, 'z'), R.z0, R.z1), K.wall, A);
	}
	// the doorways' sides and heads: through the wall to the house's own, and between rooms
	for (const D of plan.doors) {
		const a = D.x - D.w / 2, b = D.x + D.w / 2, z = plan.inner.z1, out = D.z + 0.2, top = D.h;
		quadU(m, [a, y0, z], [a, y0, out], [a, top, out], [a, top, z], PANELS);
		quadU(m, [b, y0, z], [b, y0, out], [b, top, out], [b, top, z], PANELS);
		quadU(m, [a, top, z], [b, top, z], [b, top, out], [a, top, out], PANELS);
		quadU(m, [a, y0 - 0.01, z], [b, y0 - 0.01, z], [b, y0 - 0.01, out], [a, y0 - 0.01, out], STONE);
		// its door stood open against the wall inside
		box(m, a * U, y0 * U, (z - D.w) * U, (a + 0.14) * U, top * U, z * U, PANELS);
	}
	for (const g of plan.gaps) {
		const top = y0 + g.h;
		if (g.along == 'x') { const a = g.c - g.w / 2, b = g.c + g.w / 2, z0 = g.at - 0.16, z1 = g.at + 0.16;
			quadU(m, [a, y0, z0], [a, y0, z1], [a, top, z1], [a, top, z0], PANELS); quadU(m, [b, y0, z0], [b, y0, z1], [b, top, z1], [b, top, z0], PANELS); quadU(m, [a, top, z0], [b, top, z0], [b, top, z1], [a, top, z1], PANELS); quadU(m, [a, y0, z0], [b, y0, z0], [b, y0, z1], [a, y0, z1], PLANKS);
		} else { const a = g.c - g.w / 2, b = g.c + g.w / 2, x0 = g.at - 0.16, x1 = g.at + 0.16;
			quadU(m, [x0, y0, a], [x1, y0, a], [x1, top, a], [x0, top, a], PANELS); quadU(m, [x0, y0, b], [x1, y0, b], [x1, top, b], [x0, top, b], PANELS); quadU(m, [x0, top, a], [x1, top, a], [x1, top, b], [x0, top, b], PANELS); quadU(m, [x0, y0, a], [x1, y0, a], [x1, y0, b], [x0, y0, b], PLANKS);
		}
	}
	// a window where the house has one: its pane just off the wall, a frame round it
	const I = plan.inner;
	for (const W of plan.windows) {
		const bottom = Math.max(W.y, y0 + 0.8), top = Math.min(W.y + W.h, y1 - 0.4);
		if (top <= bottom + 0.4) continue;
		let a, b;
		if (W.nx == 0) { const z = W.nz > 0 ? I.z1 - 0.04 : I.z0 + 0.04; a = [W.x - W.w / 2, z]; b = [W.x + W.w / 2, z]; if (plan.doors.some((D) => W.nz > 0 && Math.abs(D.x - W.x) < D.w / 2 + W.w / 2) || W.x - W.w / 2 < I.x0 || W.x + W.w / 2 > I.x1) continue; }
		else { const x = W.nx > 0 ? I.x1 - 0.04 : I.x0 + 0.04; a = [x, W.z - W.w / 2]; b = [x, W.z + W.w / 2]; if (W.z - W.w / 2 < I.z0 || W.z + W.w / 2 > I.z1) continue; }
		quadU(m, [a[0], bottom, a[1]], [b[0], bottom, b[1]], [b[0], top, b[1]], [a[0], top, a[1]], WINDOW);
		const dx = W.nx == 0 ? 0.2 : 0, dz = W.nx == 0 ? 0 : 0.2, off = W.nx == 0 ? [0, -Math.sign(W.nz) * 0.03] : [-Math.sign(W.nx) * 0.03, 0];
		const frame = (p, q, r, s) => quadU(m, [p[0] + off[0], p[1], p[2] + off[1]], [q[0] + off[0], q[1], q[2] + off[1]], [r[0] + off[0], r[1], r[2] + off[1]], [s[0] + off[0], s[1], s[2] + off[1]], WOOD);
		frame([a[0] - dx, bottom - 0.2, a[1] - dz], [b[0] + dx, bottom - 0.2, b[1] + dz], [b[0] + dx, bottom, b[1] + dz], [a[0] - dx, bottom, a[1] - dz]);
		frame([a[0] - dx, top, a[1] - dz], [b[0] + dx, top, b[1] + dz], [b[0] + dx, top + 0.2, b[1] + dz], [a[0] - dx, top + 0.2, a[1] - dz]);
		frame([a[0] - dx, bottom, a[1] - dz], [a[0], bottom, a[1]], [a[0], top, a[1]], [a[0] - dx, top, a[1] - dz]);
		frame([b[0], bottom, b[1]], [b[0] + dx, bottom, b[1] + dz], [b[0] + dx, top, b[1] + dz], [b[0], top, b[1]]);
		const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
		frame([c[0] - dx * 0.2, bottom, c[1] - dz * 0.2], [c[0] + dx * 0.2, bottom, c[1] + dz * 0.2], [c[0] + dx * 0.2, top, c[1] + dz * 0.2], [c[0] - dx * 0.2, top, c[1] - dz * 0.2]);
	}
	if (plan.porch) { const P = plan.porch; quadU(m, [P.x0, y0, P.z0], [P.x1, y0, P.z0], [P.x1, y0, P.z1], [P.x0, y0, P.z1], FLAGS); }
	return m;
}
// (the line of a wall: a gap's own line, if it is one of the two either side of it)
function nearLine(plan, at, along) {
	const g = plan.gaps.find((one) => one.along == along && Math.abs(one.at - at) < 0.4);
	return g ? g.at : at;
}

export const shellName = (t, v) => `shell:${t}:${v}`;
const built = {};
for (const [name, model] of Object.entries(MODELS)) { const m = model.make(); built[name] = { data: m.done(), triangles: m.count() }; }
for (let t = 0; t < BUILDING_TYPES.length; t++) for (let v = 0; v < VARIANTS; v++) { const m = shellOf(t, v); built[shellName(t, v)] = { data: m.done(), triangles: m.count() }; }
export const INTERIOR_MESHES = built;
export const interiorStats = { models: Object.keys(MODELS).length, most: Math.max(...Object.keys(MODELS).map((name) => built[name].triangles)), triangles: Object.fromEntries(Object.keys(MODELS).map((name) => [name, built[name].triangles])) };
