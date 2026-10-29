/*
	THE CLOTHES of the Survival mode (items.js takes them in with the rest): four of a kind for each slot that is worn (but the wrist, which
	has the watch, and the extra: a slung satchel or a steel chestplate), each in five colours (COLOURS: the instance's colour, 0 to 4).
	The look is the Long Dark's crossed with the Red Dead's: wool, flannel, oilskin, leather and fur, in the colours of the earth.

	WHAT EACH ONE DOES is worked out from what it is made of (MADE: warmth, wet, breath, armour, pockets, each 0 to 0.25), so that what
	keeps the cold and the wet out costs something:
		insulation		its warmth
		water			its wet: the rain kept off
		sweat			how well it lets sweat out: its breath, less for keeping the wet out and the warmth in
		carry			what it adds to how much can be carried: its pockets, less for its warmth, its wet and above all its armour
		armour			its armour: the share of a hit it stops
	Each is a share of the thing it changes (survival.js, inventory.js: wornStats), and none more than LIMIT either way.
	Every one is drawn on the walker (outfits.js: its model, by type), so the others see what it wears; and the NPCs are dressed in them.
*/
export const LIMIT = 0.25;

export const COLOURS = {
	charcoal: '#3a3836', oxblood: '#6e2423', tan: '#a8865a', olive: '#5c5f38', navy: '#2c3550', cream: '#d8ccb0', rust: '#8e4a24',
	forest: '#2f4a32', slate: '#5a6670', brown: '#5a3a22', black: '#1e1c1b', grey: '#7a7670', mustard: '#a8862e', burgundy: '#5a1e2e',
	sky: '#6a8aa8', sand: '#c2a878', steel: '#8a8e94', blued: '#3c4250', brass: '#a88a44', bone: '#cfc4a8',
};

// name, slot, w, h, kg, price (dollars), icon, what it is made of, its five colours, what is said of it
const MADE = (warmth = 0, wet = 0, breath = 0, armour = 0, pockets = 0) => ({ warmth, wet, breath, armour, pockets });
const LIST = {
	// the head: hats
	toque: ['Wool toque', 'headHat', 1, 1, 0.15, 1.5, 'cap', MADE(0.12, 0.02, 0.1), ['charcoal', 'oxblood', 'forest', 'cream', 'navy'], 'A knitted cap, the cuff turned up'],
	cowboyHat: ['Felt cowboy hat', 'headHat', 2, 2, 0.3, 4, 'hat', MADE(0.04, 0.12, 0.12), ['tan', 'brown', 'black', 'grey', 'sand'], 'A wide brim against the sun and the rain'],
	bowler: ['Bowler hat', 'headHat', 2, 1, 0.25, 3.5, 'hat', MADE(0.05, 0.08, 0.05, 0.02), ['black', 'brown', 'charcoal', 'burgundy', 'grey'], 'A hard felt crown'],
	trapperHat: ['Fur trapper hat', 'headHat', 2, 2, 0.4, 6, 'cap', MADE(0.22, 0.08, 0), ['brown', 'tan', 'grey', 'black', 'rust'], 'Fur, with flaps over the ears'],
	// the head: the face
	bandana: ['Bandana', 'headFace', 1, 1, 0.05, 0.5, 'scarf', MADE(0.02, 0, 0.15), ['oxblood', 'navy', 'black', 'mustard', 'sky'], 'Over the mouth and nose'],
	scarf: ['Wool scarf', 'headFace', 1, 2, 0.2, 1.5, 'scarf', MADE(0.12, 0.02, 0.06), ['oxblood', 'forest', 'charcoal', 'cream', 'mustard'], 'Wound twice round the neck'],
	balaclava: ['Balaclava', 'headFace', 1, 1, 0.15, 2, 'cap', MADE(0.16, 0.03, 0.02), ['charcoal', 'black', 'olive', 'navy', 'cream'], 'Knitted over the whole head, a slit for the eyes'],
	furCollar: ['Fur collar', 'headFace', 1, 2, 0.3, 4, 'scarf', MADE(0.2, 0.05, 0), ['brown', 'grey', 'tan', 'black', 'cream'], 'A thick ruff of fur round the neck'],
	// the torso: next to the skin
	cottonShirt: ['Cotton shirt', 'torsoInner', 2, 2, 0.25, 1.5, 'shirt', MADE(0.04, 0, 0.22), ['cream', 'sky', 'slate', 'oxblood', 'tan'], 'Light, and lets the sweat out'],
	henley: ['Wool henley', 'torsoInner', 2, 2, 0.35, 2.5, 'shirt', MADE(0.12, 0.02, 0.12), ['cream', 'grey', 'oxblood', 'forest', 'navy'], 'A buttoned wool undershirt'],
	flannelShirt: ['Flannel shirt', 'torsoInner', 2, 2, 0.35, 2.5, 'shirt', MADE(0.1, 0.02, 0.14, 0, 0.04), ['oxblood', 'forest', 'navy', 'mustard', 'slate'], 'Checked flannel, a pocket on the chest'],
	sweater: ['Cable-knit sweater', 'torsoInner', 2, 2, 0.6, 4, 'shirt', MADE(0.2, 0.04, 0.04), ['cream', 'charcoal', 'forest', 'oxblood', 'navy'], 'Thick wool, a roll neck'],
	// the torso: over the top
	duster: ['Oilskin duster', 'torsoOuter', 2, 3, 1.6, 9, 'coat', MADE(0.1, 0.25, 0.05, 0.02, 0.12), ['tan', 'brown', 'black', 'olive', 'slate'], 'A long riding coat, waxed against the rain'],
	mackinaw: ['Mackinaw coat', 'torsoOuter', 2, 3, 1.4, 8, 'coat', MADE(0.2, 0.1, 0.06, 0, 0.1), ['oxblood', 'forest', 'navy', 'charcoal', 'mustard'], 'Heavy checked wool, to the hip'],
	vest: ['Leather vest', 'torsoOuter', 2, 2, 0.7, 5, 'vest', MADE(0.05, 0.05, 0.12, 0.04, 0.14), ['brown', 'black', 'tan', 'oxblood', 'olive'], 'No sleeves: pockets, and a little leather over the chest'],
	buffaloCoat: ['Buffalo coat', 'torsoOuter', 3, 3, 3.2, 14, 'coat', MADE(0.25, 0.15, 0, 0.06), ['brown', 'black', 'rust', 'grey', 'tan'], 'Hide and fur to the knee: for the worst of the winter'],
	// the legs: next to the skin
	drawers: ['Cotton drawers', 'legsInner', 2, 2, 0.2, 1, 'trousers', MADE(0.03, 0, 0.2), ['cream', 'grey', 'sky', 'tan', 'oxblood'], 'Light, to the knee'],
	longJohns: ['Wool long johns', 'legsInner', 2, 2, 0.35, 2, 'trousers', MADE(0.12, 0.02, 0.08), ['oxblood', 'cream', 'grey', 'charcoal', 'forest'], 'Wool, to the ankle'],
	silkLongJohns: ['Silk long johns', 'legsInner', 2, 2, 0.15, 3.5, 'trousers', MADE(0.07, 0, 0.25), ['cream', 'black', 'sky', 'burgundy', 'grey'], 'Thin, warm for their weight, and dry'],
	fleeceDrawers: ['Fleece-lined drawers', 'legsInner', 2, 2, 0.45, 3, 'trousers', MADE(0.18, 0.02, 0.02), ['grey', 'charcoal', 'navy', 'cream', 'olive'], 'Thick and warm, and they hold the sweat in'],
	// the legs: over the top
	denim: ['Denim work pants', 'legsOuter', 2, 2, 0.8, 3, 'trousers', MADE(0.06, 0.04, 0.08, 0.02, 0.12), ['navy', 'sky', 'black', 'slate', 'tan'], 'Riveted denim: hard wearing, deep pockets'],
	woolTrousers: ['Wool trousers', 'legsOuter', 2, 2, 0.7, 3.5, 'trousers', MADE(0.14, 0.05, 0.06, 0, 0.06), ['charcoal', 'brown', 'grey', 'olive', 'navy'], 'Warm, even wet'],
	canvasTrousers: ['Waxed canvas trousers', 'legsOuter', 2, 2, 0.9, 4.5, 'trousers', MADE(0.08, 0.18, 0, 0, 0.16), ['tan', 'olive', 'brown', 'black', 'slate'], 'Waxed against the wet, pockets on the thighs'],
	chaps: ['Leather chaps', 'legsOuter', 2, 2, 1.2, 5, 'trousers', MADE(0.07, 0.1, 0.06, 0.08), ['brown', 'black', 'tan', 'oxblood', 'rust'], 'Leather over the front of the legs'],
	// the feet: socks
	cottonSocks: ['Cotton socks', 'feetInner', 1, 1, 0.05, 0.4, 'socks', MADE(0.02, 0, 0.16), ['cream', 'grey', 'black', 'navy', 'oxblood'], 'Thin'],
	woolSocks: ['Wool socks', 'feetInner', 1, 1, 0.1, 0.8, 'socks', MADE(0.08, 0.02, 0.08), ['grey', 'cream', 'oxblood', 'forest', 'charcoal'], 'Warm, even wet'],
	bootLiners: ['Felt boot liners', 'feetInner', 1, 1, 0.2, 1.5, 'socks', MADE(0.14, 0.03, 0), ['grey', 'charcoal', 'brown', 'cream', 'olive'], 'Thick felt, for the winter'],
	kneeSocks: ['Knee-high wool socks', 'feetInner', 1, 1, 0.15, 1.2, 'socks', MADE(0.11, 0.02, 0.06), ['cream', 'oxblood', 'forest', 'navy', 'mustard'], 'Wool to the knee, a stripe at the top'],
	// the feet: boots and shoes (only these go over the socks)
	ridingBoots: ['Riding boots', 'feetOuter', 2, 2, 1.4, 6, 'boots', MADE(0.06, 0.14, 0.04, 0.03), ['brown', 'black', 'tan', 'oxblood', 'rust'], 'Tall leather, a heel for the stirrup'],
	workBoots: ['Work boots', 'feetOuter', 2, 2, 1.3, 5, 'boots', MADE(0.08, 0.14, 0.02, 0.04), ['brown', 'black', 'tan', 'olive', 'rust'], 'Laced to the ankle, hobnailed'],
	moccasins: ['Moccasins', 'feetOuter', 2, 1, 0.4, 2, 'boots', MADE(0.05, 0.02, 0.2, 0, 0.06), ['tan', 'brown', 'sand', 'rust', 'cream'], 'Soft hide: light and quiet'],
	mukluks: ['Mukluks', 'feetOuter', 2, 2, 1.1, 7, 'boots', MADE(0.2, 0.12, 0), ['brown', 'grey', 'cream', 'black', 'tan'], 'Hide to the calf, trimmed with fur'],
	// the extra
	slungPack: ['Slung satchel', 'extra', 2, 2, 0.6, 4, 'pouch', MADE(0, 0.02, 0, 0, 0.1), ['tan', 'brown', 'olive', 'black', 'oxblood'], 'A satchel on a strap across the body: 3 × 2', { grid: [3, 2] }],
	chestplate: ['Steel chestplate', 'extra', 3, 3, 7, 18, 'vest', MADE(0.02, 0.06, 0, 0.25), ['steel', 'blued', 'brass', 'steel', 'blued'], 'Stops a good share of a hit, at a cost in weight'],
};

const round = (v) => Math.round(Math.max(Math.min(v, LIMIT), -LIMIT) * 100) / 100;
// what one does (see the top), from what it is made of
export function effectsOf(made) {
	return {
		insulation: round(made.warmth),
		water: round(made.wet),
		sweat: round(made.breath - 0.5 * made.wet - 0.3 * made.warmth),
		carry: round(made.pockets - 0.4 * made.warmth - 0.3 * made.wet - 0.9 * made.armour),
		armour: round(made.armour),
	};
}
export const CLOTHES = Object.fromEntries(Object.entries(LIST).map(([type, [name, slot, w, h, kg, price, icon, made, colours, detail, more]]) => [type,
	{ name, slot, w, h, kg, price, icon, colours, detail, clothing: true, ...effectsOf(made), ...more }]));
// the colour of an instance (0 to 4) as a name and as #rrggbb
export const colourName = (type, colour = 0) => CLOTHES[type]?.colours[colour % 5] ?? null;
export const colourHex = (type, colour = 0) => COLOURS[colourName(type, colour)] ?? null;
