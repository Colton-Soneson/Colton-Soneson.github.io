import { DEPTH_FORMAT, depthTest } from './depthMode.js'
import {device} from './deviceSelection.js'
import { frameTexture } from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_dummyClothes } from '../shaders/js/vf_dummy.js'

import * as transformations from './transformations.js'
import * as survivalNet from './survivalNet.js'
import { ITEMS, SLOTS } from './items.js'
import { COLOURS, colourHex } from './clothing.js'
import * as inventory from './inventory.js'

//the clothes fade into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	WHAT THE DUMMIES WEAR (clothing.js: the Survival mode's clothes, and the backpacks and the watch): a model for every type (MAKERS, each
	under 300 triangles), made on the dummy (players.js: DUMMY_MESH) in its metres, a part of it for every part of the dummy it goes on, so
	vf_dummy.js moves it as it moves the dummy: the sleeves with the arms, the trousers with the legs, a hat with the head. A vertex's w is
	its part and 32 times its tone (vf_dummy.js: the colour, a trim, leather, steel, fur, checks...), the colour the instance's.
	WHO WEARS WHAT. Anyone drawn as a dummy can be dressed (wear: its row, as players.js and townFolk.js give them to the shader, and its
	outfit, [[type, colour], ...]): the others in a game (what they have on, told: OUTFIT), the NPCs and the townsfolk (npcOutfit: by their
	kind or their trade, the same everywhere from their own number). Everything worn within REACH of the camera is drawn once a frame
	(outfitsPass), every piece of a type in one draw.
	IN A GAME (survivalNet.js) each player says what it has on, and its armour, whenever that changes (outfit): a joiner to the host, who
	tells everyone, and a joiner come in of all of them. The armour is the host's to use: ARMOUR, a share of every hit stopped (net.js,
	npcs.js).
*/
const REACH = 250;					// metres
const MAX_PIECES = 6144;
const FLOATS = 24;					// the dummy's row (20, as players.js) and the colour (4)

// The models
//-------------------------------------------------
const C = (part, tone = 1) => part + 32 * tone;
// a box between two rectangles across y: [x half width, z back, z front] at y0 and y1 (as players.js)
function box(t, y0, [w0, b0, f0], y1, [w1, b1, f1], code, x = 0) {
	const ring = (y, w, b, f) => [[x - w, y, b], [x + w, y, b], [x + w, y, f], [x - w, y, f]];
	const A = ring(y0, w0, b0, f0), B = ring(y1, w1, b1, f1);
	for (let k = 0; k < 4; k++) { const n = (k + 1) % 4; t.push([A[k], B[k], B[n], code], [A[k], B[n], A[n], code]); }
	t.push([A[0], A[1], A[2], code], [A[0], A[2], A[3], code], [B[0], B[2], B[1], code], [B[0], B[3], B[2], code]);
}
// a tube of sides from a to b, radius ra at a and rb at b (open ends)
function tube(t, a, b, ra, rb, code, sides = 6) {
	const axis = b.map((v, i) => v - a[i]), length = Math.hypot(...axis), d = axis.map((v) => v / length);
	const other = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	let u = [d[1] * other[2] - d[2] * other[1], d[2] * other[0] - d[0] * other[2], d[0] * other[1] - d[1] * other[0]];
	const ul = Math.hypot(...u); u = u.map((v) => v / ul);
	const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
	const ring = (c, r) => Array.from({ length: sides }, (_, k) => { const q = (k + 0.5) / sides * Math.PI * 2; return [0, 1, 2].map((i) => c[i] + (u[i] * Math.cos(q) + w[i] * Math.sin(q)) * r); });
	const A = ring(a, ra), B = ring(b, rb);
	for (let k = 0; k < sides; k++) { const n = (k + 1) % sides; t.push([A[k], B[k], B[n], code], [A[k], B[n], A[n], code]); }
}
// round the head (or a leg: cx, cz), from the front (+z) round: the points of a ring at y
const ring = (y, r, sides, { deep = 1.08, cx = 0, cz = 0.01, from = 0, to = Math.PI * 2, shape = null } = {}) => {
	const whole = to - from >= Math.PI * 2 - 1e-6, n = whole ? sides : sides + 1;
	return Array.from({ length: n }, (_, k) => {
		const a = from + (to - from) * k / sides;
		const [rr, yy] = shape ? shape(a) : [r, y];
		return [cx + Math.sin(a) * rr, yy, cz + Math.cos(a) * rr * deep];
	});
};
function band(t, A, B, code, open = false, skip = () => false) {
	const n = open ? A.length - 1 : A.length;
	for (let k = 0; k < n; k++) { if (skip(k)) continue; const j = (k + 1) % A.length; t.push([A[k], B[k], B[j], code], [A[k], B[j], A[j], code]); }
}
function cap(t, A, code, lift = 0) {
	const c = [0, 1, 2].map((i) => A.reduce((s, p) => s + p[i], 0) / A.length);
	c[1] += lift;
	for (let k = 0; k < A.length; k++) t.push([A[k], A[(k + 1) % A.length], c, code]);
}
// rings up, banded, closed at the top
function stack(t, levels, code, sides = 10, o = {}, lift = 0) {
	const R = levels.map(([y, r]) => ring(y, r, sides, o));
	for (let k = 0; k + 1 < R.length; k++) band(t, R[k], R[k + 1], code);
	cap(t, R[R.length - 1], code, lift);
}
function ball(t, c, r, code, sides = 6) {
	const at = (y, s) => Array.from({ length: sides }, (_, k) => { const a = k / sides * Math.PI * 2; return [c[0] + Math.sin(a) * r * s, c[1] + y * r, c[2] + Math.cos(a) * r * s]; });
	const A = at(-0.5, 0.87), B = at(0.5, 0.87);
	band(t, A, B, code);
	cap(t, A, code, -0.5 * r);
	cap(t, B, code, 0.5 * r);
}

// THE DUMMY (players.js), where the clothes go: its arms (shoulder, elbow, hand; the parts), its legs (x; the parts)
const ARMS = [[[-0.22, 1.45, 0], [-0.2, 1.24, 0.24], [-0.03, 1.31, 0.5], 3, 4], [[0.22, 1.45, 0], [0.22, 1.2, 0.1], [0.07, 1.29, 0.24], 5, 6]];
const LEGS = [[-0.1, 7, 8], [0.1, 9, 10]];
const along = (a, b, f) => a.map((v, i) => v + (b[i] - v) * f);
// the leg's centre and radius at y (the thigh above the knee, the shin below)
const legAt = (y) => y >= 0.5 ? { z: 0.01 * (0.95 - y) / 0.45, r: 0.06 + 0.02 * (y - 0.5) / 0.45 } : { z: 0.01 - 0.02 * (0.5 - y) / 0.46, r: 0.045 + 0.01 * (y - 0.04) / 0.46 };
function torso(t, d, hem, tone) {
	box(t, 1.05, [0.16 + d, -0.1 - d, 0.1 + d], 1.51, [0.2 + d, -0.11 - d, 0.11 + d], C(1, tone));
	if (hem < 1.05) box(t, hem, [0.175 + d, -0.105 - d, 0.105 + d], 1.05, [0.175 + d, -0.105 - d, 0.105 + d], C(0, tone));
}
function sleeves(t, d, length, tone, cuff = 0) {
	for (const [s, e, h, upper, fore] of ARMS) {
		tube(t, s, e, 0.055 + d, 0.045 + d, C(upper, tone));
		const end = along(e, h, length), r = 0.045 - 0.01 * length + d;
		tube(t, e, end, 0.045 + d, r, C(fore, tone));
		if (cuff) tube(t, along(e, h, length - 0.12), end, r + 0.006, r + 0.006, C(fore, cuff));
	}
}
const collar = (t, d, tone, height = 0.07, r = 0.075) => tube(t, [0, 1.47, 0], [0, 1.47 + height, 0], r + d, r - 0.006 + d, C(1, tone), 8);
// the legs from the hips down to y, d out from them, and the seat round the hips
function legs(t, d, to, tone, sides = 6, flare = 0) {
	box(t, 0.86, [0.175 + d, -0.105 - d, 0.105 + d], 1.07, [0.175 + d, -0.105 - d, 0.105 + d], C(0, tone));
	for (const [x, thigh, shin] of LEGS) {
		const top = legAt(0.97), knee = legAt(0.5), low = legAt(Math.max(to, 0.04));
		tube(t, [x, 0.97, top.z], [x, Math.max(to, 0.5), legAt(Math.max(to, 0.5)).z], top.r + d, legAt(Math.max(to, 0.5)).r + d, C(thigh, tone), sides);
		if (to < 0.5) tube(t, [x, 0.5, knee.z], [x, to, low.z], knee.r + d, low.r + d + flare, C(shin, tone), sides);
	}
}
// a band round each leg, from y0 to y1
function legBands(t, y0, y1, d, tone, sides = 6) {
	for (const [x, thigh, shin] of LEGS) { const a = legAt(y0), b = legAt(y1); tube(t, [x, y0, a.z], [x, y1, b.z], a.r + d, b.r + d, C(y0 >= 0.5 ? thigh : shin, tone), sides); }
}
// a sock or a boot on each foot: up the shin to top, and the foot
function feet(t, top, r, tone, { foot = [0.05, -0.08, 0.15], sole = false, heel = false, sides = 8 } = {}) {
	for (const [x, , shin] of LEGS) {
		const b = legAt(0.04), a = legAt(top);
		tube(t, [x, 0.015, b.z], [x, top, a.z], r, r + 0.004, C(shin, tone), sides);
		box(t, 0.0, foot, 0.075, [foot[0] - 0.006, foot[1] + 0.01, foot[2] - 0.04], C(shin, tone), x);
		if (sole) box(t, -0.014, [foot[0] + 0.004, foot[1] - 0.006, foot[2] + 0.006], 0.004, [foot[0] + 0.004, foot[1] - 0.006, foot[2] + 0.006], C(shin, 9), x);
		if (heel) box(t, -0.035, [0.038, foot[1], foot[1] + 0.06], -0.014, [0.04, foot[1], foot[1] + 0.06], C(shin, 9), x);
	}
}
// the skirts of a long coat: behind (on the hips) and in front (round each leg, so it swings with them)
function skirts(t, d, to, tone) {
	box(t, to, [0.2 + d, -0.13 - d, -0.105 - d], 0.9, [0.185 + d, -0.12 - d, -0.1 - d], C(0, tone));
	for (const [x, thigh, shin] of LEGS) {
		tube(t, [x, 0.92, 0], [x, Math.max(to, 0.5), 0.01], 0.11 + d, 0.12 + d, C(thigh, tone), 8);
		if (to < 0.5) tube(t, [x, 0.5, 0.01], [x, to, 0], 0.12 + d, 0.125 + d, C(shin, tone), 8);
	}
}
const HEAD = { sides: 10 };
export const MAKERS = {
	// hats (on the head: part 2)
	toque(t) {
		stack(t, [[1.69, 0.118], [1.8, 0.118], [1.86, 0.098], [1.895, 0.055]], C(2), 10);
		band(t, ring(1.685, 0.125, 10), ring(1.75, 0.125, 10), C(2, 2));
		ball(t, [0, 1.915, 0.01], 0.032, C(2, 2));
	},
	cowboyHat(t) {
		band(t, ring(1.79, 0.108, 12), ring(0, 0, 12, { shape: (a) => [0.24, 1.79 + 0.04 * Math.abs(Math.sin(a))] }), C(2));
		stack(t, [[1.79, 0.105], [1.93, 0.097], [1.955, 0.07]], C(2), 10, {}, -0.02);
		band(t, ring(1.792, 0.11, 10), ring(1.825, 0.105, 10), C(2, 2));
	},
	bowler(t) {
		band(t, ring(1.775, 0.112, 12), ring(0, 0, 12, { shape: (a) => [0.155, 1.775 + 0.025 * Math.abs(Math.sin(a))] }), C(2));
		stack(t, [[1.775, 0.112], [1.87, 0.118], [1.93, 0.1], [1.965, 0.055]], C(2), 10);
		band(t, ring(1.778, 0.115, 10), ring(1.8, 0.116, 10), C(2, 2));
	},
	trapperHat(t) {
		stack(t, [[1.72, 0.122], [1.85, 0.12], [1.9, 0.08]], C(2), 10);
		band(t, ring(1.69, 0.132, 10), ring(1.77, 0.132, 10), C(2, 7));
		for (const x of [-0.122, 0.122]) box(t, 1.57, [0.012, -0.06, 0.07], 1.73, [0.012, -0.06, 0.07], C(2, 7), x);
		box(t, 1.6, [0.09, -0.135, -0.11], 1.72, [0.1, -0.135, -0.11], C(2, 7));
	},
	// the face and the neck
	bandana(t) {
		const L = [-0.112, 1.695, 0.122], R = [0.112, 1.695, 0.122], P = [0, 1.56, 0.14], Ls = [-0.115, 1.66, 0.05], Rs = [0.115, 1.66, 0.05];
		t.push([L, R, P, C(2)], [L, P, Ls, C(2)], [R, Rs, P, C(2)]);
		band(t, ring(1.67, 0.113, 8), ring(1.7, 0.113, 8), C(2));
		box(t, 1.64, [0.012, -0.14, -0.11], 1.7, [0.02, -0.13, -0.11], C(2));
	},
	scarf(t) {
		tube(t, [0, 1.45, 0], [0, 1.56, 0], 0.095, 0.085, C(1), 8);
		tube(t, [0, 1.48, 0.005], [0, 1.53, 0.005], 0.105, 0.1, C(1, 2), 8);
		box(t, 1.2, [0.025, 0.11, 0.135], 1.47, [0.025, 0.115, 0.14], C(1), 0.07);
		box(t, 1.28, [0.022, 0.11, 0.132], 1.47, [0.022, 0.115, 0.138], C(1), 0.02);
	},
	balaclava(t) {
		const levels = [[1.565, 0.1], [1.66, 0.118], [1.75, 0.118], [1.82, 0.112], [1.86, 0.075]].map(([y, r]) => ring(y, r, 10));
		for (let k = 0; k + 1 < levels.length; k++) band(t, levels[k], levels[k + 1], C(2), false, (j) => k == 1 && (j == 0 || j == 9));
		cap(t, levels[levels.length - 1], C(2));
		tube(t, [0, 1.47, 0], [0, 1.58, 0], 0.078, 0.072, C(2), 8);
	},
	furCollar(t) {
		tube(t, [0, 1.43, 0], [0, 1.6, 0], 0.118, 0.1, C(1, 7), 10);
		tube(t, [0, 1.45, 0], [0, 1.53, 0], 0.13, 0.125, C(1, 7), 10);
		band(t, ring(1.6, 0.1, 10, { cz: 0 }), ring(1.6, 0.068, 10, { cz: 0 }), C(1, 7));
	},
	// the torso, next to the skin
	cottonShirt(t) {
		torso(t, 0.012, 0.93, 1); sleeves(t, 0.012, 0.92, 1); collar(t, 0.012, 1, 0.06);
		box(t, 1.06, [0.01, 0.112, 0.118], 1.49, [0.01, 0.122, 0.128], C(1, 2));
	},
	henley(t) {
		torso(t, 0.014, 0.93, 1); sleeves(t, 0.014, 0.96, 1, 2); collar(t, 0.014, 1, 0.05);
		box(t, 1.34, [0.012, 0.114, 0.12], 1.5, [0.012, 0.124, 0.13], C(1, 2));
	},
	flannelShirt(t) {
		torso(t, 0.013, 0.93, 8); sleeves(t, 0.013, 0.92, 8); collar(t, 0.013, 8, 0.065);
		box(t, 1.3, [0.04, 0.112, 0.13], 1.4, [0.04, 0.12, 0.138], C(1, 8), 0.09);
	},
	sweater(t) {
		torso(t, 0.028, 0.95, 1); box(t, 0.9, [0.21, -0.14, 0.14], 0.96, [0.21, -0.14, 0.14], C(0, 2));
		sleeves(t, 0.025, 0.95, 1, 2);
		tube(t, [0, 1.46, 0], [0, 1.6, 0], 0.092, 0.084, C(1), 8);
	},
	// the torso, over the top
	duster(t) {
		torso(t, 0.042, 0.88, 1); sleeves(t, 0.035, 1, 1, 2);
		tube(t, [0, 1.47, 0], [0, 1.58, 0], 0.112, 0.1, C(1, 2), 8);
		skirts(t, 0.0, 0.32, 1);
	},
	mackinaw(t) {
		torso(t, 0.04, 0.84, 8); sleeves(t, 0.035, 0.95, 8, 2); collar(t, 0.04, 8, 0.08, 0.08);
		for (const x of [-0.09, 0.09]) box(t, 1.08, [0.05, 0.14, 0.158], 1.2, [0.05, 0.142, 0.16], C(1, 8), x);
	},
	vest(t) {
		torso(t, 0.03, 0.95, 1);
		for (const x of [-0.06, 0.06]) box(t, 1.28, [0.035, 0.135, 0.145], 1.52, [0.025, 0.138, 0.148], C(1, 2), x);
		box(t, 1.0, [0.01, 0.136, 0.142], 1.28, [0.01, 0.138, 0.145], C(1, 5));
	},
	buffaloCoat(t) {
		torso(t, 0.065, 0.85, 7); sleeves(t, 0.055, 0.95, 7);
		tube(t, [0, 1.45, 0], [0, 1.62, 0], 0.135, 0.12, C(1, 7), 10);
		skirts(t, 0.025, 0.48, 7);
	},
	// the legs, next to the skin
	drawers(t) { legs(t, 0.01, 0.52, 1); },
	longJohns(t) { legs(t, 0.01, 0.06, 1); legBands(t, 0.06, 0.1, 0.016, 2); },
	silkLongJohns(t) { legs(t, 0.008, 0.06, 1); },
	fleeceDrawers(t) { legs(t, 0.018, 0.3, 1); box(t, 1.02, [0.2, -0.13, 0.13], 1.07, [0.2, -0.13, 0.13], C(0, 6)); },
	// the legs, over the top: trousers with a belt (and their own bits)
	denim(t) { trousers(t, 0.025); legBands(t, 0.07, 0.12, 0.033, 2); },
	woolTrousers(t) { trousers(t, 0.022); },
	canvasTrousers(t) {
		trousers(t, 0.028);
		for (const [x, thigh] of LEGS) box(t, 0.6, [0.02, -0.04, 0.05], 0.76, [0.02, -0.04, 0.05], C(thigh, 2), x * 1.62);
	},
	chaps(t) {
		belt(t, 0.03);
		for (const [x, thigh, shin] of LEGS) {
			const at = (y, r) => ring(y, r, 6, { cx: x, cz: legAt(y).z, deep: 1, from: -Math.PI * 0.6, to: Math.PI * 0.6 });
			band(t, at(0.97, 0.115), at(0.72, 0.1), C(thigh), true); band(t, at(0.72, 0.1), at(0.5, 0.092), C(thigh), true);
			band(t, at(0.5, 0.088), at(0.25, 0.08), C(shin), true); band(t, at(0.25, 0.08), at(0.07, 0.076), C(shin), true);
		}
	},
	// the feet: socks
	cottonSocks(t) { feet(t, 0.2, 0.053, 1, { foot: [0.047, -0.07, 0.13], sides: 6 }); },
	woolSocks(t) { feet(t, 0.28, 0.056, 1, { foot: [0.048, -0.072, 0.132], sides: 6 }); legBands(t, 0.24, 0.29, 0.016, 2); },
	bootLiners(t) { feet(t, 0.3, 0.064, 1, { foot: [0.054, -0.076, 0.136], sides: 6 }); },
	kneeSocks(t) { feet(t, 0.47, 0.056, 1, { foot: [0.048, -0.072, 0.132], sides: 6 }); legBands(t, 0.4, 0.44, 0.017, 2); },
	// the feet: boots and shoes
	ridingBoots(t) { feet(t, 0.46, 0.064, 1, { sole: true, heel: true }); legBands(t, 0.4, 0.46, 0.024, 2, 8); },
	workBoots(t) { feet(t, 0.2, 0.066, 1, { foot: [0.054, -0.08, 0.15], sole: true }); for (const [x, , shin] of LEGS) box(t, 0.06, [0.012, 0.06, 0.072], 0.19, [0.012, 0.05, 0.07], C(shin, 6), x); },
	moccasins(t) { feet(t, 0.1, 0.058, 1, { foot: [0.05, -0.075, 0.14], sides: 6 }); legBands(t, 0.09, 0.12, 0.022, 2); },
	mukluks(t) { feet(t, 0.4, 0.076, 1, { foot: [0.058, -0.085, 0.15], sole: true }); legBands(t, 0.36, 0.44, 0.04, 7, 8); },
	// the extra
	slungPack(t) {
		tube(t, [-0.16, 1.5, 0.125], [0.19, 1.02, 0.13], 0.012, 0.012, C(1, 3), 4);
		tube(t, [-0.16, 1.5, -0.125], [0.19, 1.02, -0.125], 0.012, 0.012, C(1, 3), 4);
		box(t, 0.84, [0.035, -0.09, 0.1], 1.04, [0.035, -0.09, 0.1], C(0), 0.215);
		box(t, 0.97, [0.038, -0.093, 0.103], 1.05, [0.038, -0.093, 0.103], C(0, 2), 0.215);
	},
	chestplate(t) {
		box(t, 1.06, [0.185, 0.115, 0.15], 1.48, [0.215, 0.125, 0.165], C(1));
		box(t, 1.06, [0.185, -0.15, -0.115], 1.48, [0.215, -0.165, -0.125], C(1));
		for (const x of [-0.13, 0.13]) box(t, 1.47, [0.022, -0.14, 0.14], 1.535, [0.022, -0.14, 0.14], C(1, 3), x);
		box(t, 1.03, [0.2, -0.13, 0.13], 1.07, [0.2, -0.13, 0.13], C(0, 3));
	},
	// the wrist: the watch, on the left forearm
	watch(t) {
		const [, e, h, , fore] = ARMS[0], at = along(e, h, 0.8), dir = h.map((v, i) => v - e[i]), L = Math.hypot(...dir), d = dir.map((v) => v / L * 0.012);
		tube(t, at.map((v, i) => v - d[i]), at.map((v, i) => v + d[i]), 0.044, 0.043, C(fore, 3), 6);
		box(t, at[1] + 0.03, [0.017, at[2] - 0.017, at[2] + 0.017], at[1] + 0.046, [0.017, at[2] - 0.017, at[2] + 0.017], C(fore, 5), at[0]);
	},
	// the backpacks, on the back (their colour is their own)
	haversack(t) {
		box(t, 1.1, [0.13, -0.27, -0.112], 1.38, [0.125, -0.25, -0.112], C(1));
		box(t, 1.3, [0.135, -0.28, -0.11], 1.4, [0.13, -0.26, -0.11], C(1, 2));
		for (const x of [-0.1, 0.1]) box(t, 1.38, [0.016, -0.125, 0.125], 1.53, [0.016, -0.12, 0.12], C(1, 3), x);
	},
	rucksack(t) {
		box(t, 1.0, [0.16, -0.33, -0.112], 1.5, [0.15, -0.3, -0.112], C(1));
		box(t, 1.42, [0.165, -0.345, -0.11], 1.55, [0.155, -0.31, -0.11], C(1, 2));
		for (const x of [-0.19, 0.19]) box(t, 1.05, [0.03, -0.29, -0.15], 1.25, [0.03, -0.28, -0.15], C(1, 2), x);
		for (const x of [-0.1, 0.1]) box(t, 1.42, [0.016, -0.125, 0.125], 1.53, [0.016, -0.12, 0.12], C(1, 3), x);
	},
	framePack(t) {
		for (const x of [-0.16, 0.16]) tube(t, [x, 0.9, -0.15], [x, 1.78, -0.15], 0.012, 0.012, C(1, 4), 4);
		for (const y of [0.95, 1.7]) tube(t, [-0.17, y, -0.15], [0.17, y, -0.15], 0.01, 0.01, C(1, 4), 4);
		box(t, 1.05, [0.17, -0.4, -0.16], 1.62, [0.16, -0.36, -0.16], C(1));
		box(t, 1.55, [0.175, -0.41, -0.155], 1.68, [0.165, -0.37, -0.155], C(1, 2));
		tube(t, [-0.19, 1.74, -0.26], [0.19, 1.74, -0.26], 0.06, 0.06, C(1, 6), 8);
		for (const x of [-0.1, 0.1]) box(t, 1.42, [0.016, -0.125, 0.125], 1.53, [0.016, -0.12, 0.12], C(1, 3), x);
	},
};
function trousers(t, d) { legs(t, d, 0.07, 1, 8, 0.008); belt(t, d); }
function belt(t, d) {
	box(t, 1.0, [0.19 + d, -0.12 - d, 0.12 + d], 1.06, [0.19 + d, -0.12 - d, 0.12 + d], C(0, 3));
	box(t, 1.005, [0.025, 0.13 + d, 0.138 + d], 1.055, [0.025, 0.13 + d, 0.138 + d], C(0, 5));
}
// all of them in one buffer: each its first vertex and how many
const ranges = {};
export const outfitStats = { triangles: {}, pieces: 0, dressed: 0 };
const meshData = (() => {
	const all = [];
	for (const [type, make] of Object.entries(MAKERS)) {
		const t = [];
		make(t);
		ranges[type] = { first: all.length / 4, count: t.length * 3 };
		outfitStats.triangles[type] = t.length;
		for (const [a, b, c, code] of t) for (const p of [a, b, c]) all.push(p[0], p[1], p[2], code);
	}
	return new Float32Array(all);
})();

// Who wears what
//-------------------------------------------------
const hexColour = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
const colourOf = (type, colour) => hexColour(colourHex(type, colour) ?? ITEMS[type]?.tint ?? '#808080');
// [[type, colour], ...] worn by this player now (everything worn that has a model)
export function myOutfit() {
	if (!inventory.survivalOn()) return [];
	return SLOTS.map((s) => inventory.inv.worn[s]).filter((item) => item && MAKERS[item.type]).map((item) => [item.type, item.colour ?? 0]);
}
const cleanOutfit = (list) => (Array.isArray(list) ? list : []).slice(0, SLOTS.length).filter((p) => Array.isArray(p) && MAKERS[p[0]]).map(([type, colour]) => [type, Math.max(0, Math.min(4, colour | 0))]);

// THE NPCS AND THE TOWNSFOLK (see the top): what they wear, by kind or trade: a choice for each place (null: nothing there)
const WARDROBES = {
	rider: [['cottonShirt', 'flannelShirt', 'henley'], ['duster', 'vest', 'duster', null], ['denim', 'chaps', 'woolTrousers'], ['ridingBoots'], ['bandana', null, null]],
	pilot: [['henley', 'sweater'], ['vest', 'mackinaw'], ['woolTrousers'], ['ridingBoots'], ['scarf']],
	gunner: [['sweater', 'henley'], ['mackinaw', 'vest'], ['woolTrousers', 'canvasTrousers'], ['workBoots'], ['scarf', null]],
	captain: [['cottonShirt'], ['mackinaw', 'duster'], ['woolTrousers'], ['ridingBoots']],
	lookout: [['sweater'], ['mackinaw', null], ['canvasTrousers', 'denim'], ['workBoots'], ['scarf', null]],
	sailor: [['sweater', 'henley', 'flannelShirt'], [null, 'mackinaw'], ['canvasTrousers', 'denim'], ['workBoots', 'moccasins']],
	soldier: [['henley', 'flannelShirt'], ['mackinaw', 'duster', null], ['woolTrousers', 'canvasTrousers'], ['workBoots', 'ridingBoots']],
	// the townsfolk (townFolk.js: PROFESSIONS), by trade
	baker: [['cottonShirt'], [null], ['woolTrousers', 'denim'], ['workBoots']],
	librarian: [['cottonShirt', 'henley'], ['vest', 'sweater'], ['woolTrousers'], ['ridingBoots', 'workBoots']],
	fisherman: [['sweater', 'flannelShirt'], [null, 'duster'], ['canvasTrousers'], ['workBoots'], [null, 'scarf']],
	outfitter: [['flannelShirt', 'cottonShirt'], ['vest'], ['denim', 'canvasTrousers'], ['workBoots']],
	priest: [['cottonShirt'], ['duster'], ['woolTrousers'], ['ridingBoots']],
	bellhop: [['cottonShirt'], ['vest'], ['woolTrousers'], ['ridingBoots']],
	innkeeper: [['flannelShirt', 'henley'], ['vest', null], ['woolTrousers', 'denim'], ['workBoots']],
	dockworker: [['henley', 'flannelShirt', 'sweater'], [null, 'mackinaw'], ['denim', 'canvasTrousers'], ['workBoots']],
	lamplighter: [['henley'], ['mackinaw', 'duster'], ['woolTrousers'], ['workBoots'], ['scarf']],
	tailor: [['cottonShirt'], ['vest'], ['woolTrousers'], ['ridingBoots'], ['bandana', null]],
	banker: [['cottonShirt'], ['vest'], ['woolTrousers'], ['ridingBoots']],
	butcher: [['cottonShirt', 'henley'], [null], ['denim', 'woolTrousers'], ['workBoots']],
	painter: [['flannelShirt', 'cottonShirt'], [null, 'vest'], ['canvasTrousers', 'denim'], ['moccasins', 'workBoots'], ['scarf', 'bandana']],
	gardener: [['flannelShirt', 'cottonShirt'], [null], ['denim', 'canvasTrousers'], ['workBoots']],
	'sea captain': [['sweater', 'cottonShirt'], ['mackinaw', 'duster'], ['woolTrousers'], ['ridingBoots'], [null, 'scarf']],
};
const outfitCache = new Map();
// what one of kind (or trade) seed (a whole number: the same on every machine) wears
export function npcOutfit(kind, seed) {
	const key = kind + ':' + seed;
	if (outfitCache.has(key)) return outfitCache.get(key);
	let state = (Math.abs(seed | 0) * 2654435761 + 12345) >>> 0;
	const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
	const wardrobe = WARDROBES[kind] ?? WARDROBES.sailor;
	const list = [];
	for (const choices of wardrobe) { const type = choices[Math.floor(random() * choices.length)]; const colour = Math.floor(random() * 5); if (type) list.push([type, colour]); }
	outfitCache.set(key, list);
	return list;
}

// Drawing
//-------------------------------------------------
const pieces = [];		// [type, row (20), colour] collected this frame
// a dummy (its row, as the shader has it: players.js) in its outfit, if it is near enough to be seen
export function wear(row, outfit) {
	if (!outfit || !outfit.length) return;
	const m = settings.forestUnitsPerMetre;
	if (Math.hypot(row[0] - settings.camPosX, row[2] - settings.camPosZ) > REACH * m) return;
	outfitStats.dressed++;
	for (const [type, colour] of outfit) if (ranges[type] && pieces.length < MAX_PIECES) pieces.push([type, row, colourOf(type, colour)]);
}

let gpu = null;
function makeGpu() {
	const module = device.createShaderModule({ label: "vf_dummyClothes", code: vf_dummyClothes });
	const meshBuffer = device.createBuffer({ label: "outfits mesh", size: meshData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	device.queue.writeBuffer(meshBuffer, 0, meshData);
	const pipeline = device.createRenderPipeline({
		label: "outfits pipeline",
		layout: 'auto',
		vertex: {
			module, entryPoint: "vertexMain",
			buffers: [
				{ arrayStride: 16, attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }] },
				{ arrayStride: FLOATS * 4, stepMode: 'instance', attributes: [1, 2, 3, 4, 5, 6].map((k) => ({ format: "float32x4", offset: (k - 1) * 16, shaderLocation: k })) },
			],
		},
		fragment: { module, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
		primitive: { topology: 'triangle-list', cullMode: 'none' },
		depthStencil: { depthWriteEnabled: true, depthCompare: depthTest('less'), format: DEPTH_FORMAT },
	});
	const instanceData = new Float32Array(MAX_PIECES * FLOATS);
	const instanceBuffer = device.createBuffer({ label: "outfits instances", size: instanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const uniformBuffer = device.createBuffer({ label: "outfits Uniform", size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
	return { pipeline, meshBuffer, instanceData, instanceBuffer, uniformBuffer, sampler, bindGroup: null, boundLUT: null };
}
// with the solid things, after the dummies they are on (players.js, townFolk.js)
export function outfitsPass(aEncoder, mainpassDepthTexture) {
	outfitStats.pieces = pieces.length;
	if (!pieces.length) { outfitStats.dressed = 0; return; }
	if (!gpu) gpu = makeGpu();
	const byType = new Map();
	for (const piece of pieces) { if (!byType.has(piece[0])) byType.set(piece[0], []); byType.get(piece[0]).push(piece); }
	const draws = [];
	let n = 0;
	for (const [type, list] of byType) {
		draws.push([ranges[type], n, list.length]);
		for (const [, row, colour] of list) { gpu.instanceData.set(row, n * FLOATS); gpu.instanceData.set([colour[0], colour[1], colour[2], 0], n * FLOATS + 20); n++; }
	}
	pieces.length = 0;
	outfitStats.dressed = 0;
	device.queue.writeBuffer(gpu.instanceBuffer, 0, gpu.instanceData, 0, n * FLOATS);
	device.queue.writeBuffer(gpu.uniformBuffer, 0, new Float32Array([...transformations.getViewProj(), settings.camPosX, settings.camPosY, settings.camPosZ, 0,
		settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, 0, 0]));
	if (!gpu.bindGroup || gpu.boundLUT !== skyViewLUTtexture) {
		gpu.boundLUT = skyViewLUTtexture;
		gpu.bindGroup = device.createBindGroup({
			label: "outfits bind group",
			layout: gpu.pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: gpu.uniformBuffer } },
				{ binding: 1, resource: { buffer: uniformBufferLights } },
				{ binding: 2, resource: skyViewLUTtexture.createView() },
				{ binding: 3, resource: gpu.sampler },
			],
		});
	}
	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{ view: frameTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Outfits', 'vf_dummyClothes'),
	});
	pass.setPipeline(gpu.pipeline);
	pass.setBindGroup(0, gpu.bindGroup);
	pass.setVertexBuffer(0, gpu.meshBuffer);
	pass.setVertexBuffer(1, gpu.instanceBuffer);
	for (const [range, first, count] of draws) pass.draw(range.count, count, range.first, first);
	pass.end();
}

// In a game (see the top)
//-------------------------------------------------
const theirs = new Map();		// id -> { list, armour }
export const outfitOf = (id) => theirs.get(id)?.list ?? null;
// ARMOUR: the share of a hit stopped, by id ('me': this player), as the host has it
const armour = new Map();
export function setArmour(id, share) { armour.set(id, Math.max(Math.min(Number(share) || 0, 0.6), 0)); }
export const armourOf = (id) => armour.get(id) ?? 0;
survivalNet.on('outfit', (msg, from) => {
	const id = survivalNet.role() == 'host' ? from : msg.id;
	const list = cleanOutfit(msg.look), share = Math.max(Math.min(Number(msg.armour) || 0, 0.6), 0);
	theirs.set(id, { list, armour: share });
	setArmour(id, share);
	if (survivalNet.role() == 'host') survivalNet.send('outfit', { id, look: list, armour: share });
});
survivalNet.onJoin((id) => {
	for (const [other, o] of theirs) survivalNet.sendTo(id, 'outfit', { id: other, look: o.list, armour: o.armour });
	said = '';
});
let said = '', roleWas = 'off';
// once a frame: what this player has on, told when it changes
export function outfitsUpdate() {
	const role = survivalNet.role();
	if (role != roleWas) { said = ''; if (role == 'off') theirs.clear(); roleWas = role; }
	if (role == 'off') return;
	const look = myOutfit(), share = inventory.survivalOn() ? inventory.wornStats().armour : 0;
	const key = JSON.stringify([look, share]);
	if (key == said) return;
	said = key;
	survivalNet.send('outfit', { id: survivalNet.myId(), look, armour: share });
}
// for testing
export const outfitRanges = () => ({ ...ranges });
