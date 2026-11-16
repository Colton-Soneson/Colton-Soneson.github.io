/*
	THE KINDS OF PLANT (flora.js draws them, vf_flora.js places and shapes them): each made of flat triangles here once, in metres, its foot
	at the origin and up the y axis, every vertex with its own color. A small one up to about 64 triangles (a fern's fronds with their
	leaflets, a flower's petals, a mushroom's cap and gills), a big one up to about 200.
		(the grassland's flowers are made tall enough to stand over the grass round them: its blades are up to 1.25 m)
		where		which ground it grows on: 'forest' (under the trees, on the forest floor), 'grass' (the grassland), 'wet' (the marsh
					round a lake, the reeds' ground), 'beach' (the top of the sand), 'alpine' (high up, near the tree line and over it)
		weight		how common its colonies are there, against the others of its ground
		niche		where it grows in its ground: each place has two slow noises (0 to 1) and a kind is at home where they are near its
					niche, so a stretch of ground has its own kinds (spread: how far round its niche)
		size		metres: as small and as large as one grows (its mesh is made at 1)
		flower		its petals (the vertices marked PETAL) only out from the spring to the end of the summer
		fern		browns in the fall (a fern, a moss gone dry)
		fungus		mostly in the fall
		far			seen out on the far ring too (a fern stand, a tussock: big enough): the little ones only near
		big			not put down by the GPU (flora.js: BIG): by the CPU, a few hundred round the walker, and pushed through (a bush
					slows the walker: flora.slowAt), or picked (wild wheat: E, wheat seeds)
	Colors are albedo, the light the shader's (lit as the grass is).
*/
export const PETAL = 1;			// a vertex of a flower's head (gone out of its season)
export const KINDS = [];

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const mixC = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function seeded(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function mesh() {
	const v = [];
	const tri = (a, b, c, color, flag = 0) => { const n = norm(cross(sub(b, a), sub(c, a))); for (const p of [a, b, c]) v.push({ p, n, c: color, flag }); };
	return { v, tri, quad: (a, b, c, d, color, flag = 0) => { tri(a, b, c, color, flag); tri(a, c, d, color, flag); } };
}
// the curve a leaf or a frond follows: out yaw's way len, rising rise and drooping droop, from
const curveOf = (yaw, len, rise, droop, from) => (t) => [from[0] + Math.cos(yaw) * len * t, from[1] + rise * t - droop * t * t, from[2] + Math.sin(yaw) * len * t];
// A LEAF: a strip along its curve in segs pieces, widest a third of the way out, to a point; its two halves a little folded up (fold)
function leaf(m, yaw, len, width, rise, droop, segs, color, from = [0, 0, 0], flag = 0, fold = 0.25) {
	const at = curveOf(yaw, len, rise, droop, from), sx = -Math.sin(yaw), sz = Math.cos(yaw);
	const half = (t) => width * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(t * 0.9 + 0.08, 1)), 0.6);
	const dark = color.map((c) => c * 0.8);
	for (let k = 0; k < segs; k++) {
		const t0 = k / segs, t1 = (k + 1) / segs, a = at(t0), b = at(t1), w0 = half(t0), w1 = k == segs - 1 ? 0 : half(t1);
		const side = (p, w, s) => [p[0] + sx * w * s, p[1] + w * fold, p[2] + sz * w * s];
		if (k == segs - 1) { m.tri(side(a, w0, 1), a, b, color, flag); m.tri(a, side(a, w0, -1), b, dark, flag); }
		else { m.quad(side(a, w0, 1), a, b, side(b, w1, 1), color, flag); m.quad(a, side(a, w0, -1), side(b, w1, -1), b, dark, flag); }
	}
}
// A FROND: its leaflets (pinnae) in pairs along its curve, one pair a segment, longest a third of the way out
function frond(m, yaw, len, width, rise, droop, segs, color, from = [0, 0, 0], color2 = null) {
	const at = curveOf(yaw, len, rise, droop, from), sx = -Math.sin(yaw), sz = Math.cos(yaw), fx = Math.cos(yaw), fz = Math.sin(yaw);
	for (let k = 0; k < segs; k++) {
		const t0 = k / segs, t1 = (k + 1) / segs, a = at(t0), b = at(t1), tm = (t0 + t1) / 2, mid = at(tm);
		const w = width * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(tm * 0.9 + 0.1, 1)), 0.7), step = len / segs;
		const c = k % 2 && color2 ? color2 : color;
		for (const s of [1, -1]) m.tri(a, b, [mid[0] + sx * w * s + fx * step * 0.5, mid[1] - w * 0.25, mid[2] + sz * w * s + fz * step * 0.5], s > 0 ? c : c.map((v) => v * 0.85));
	}
}
// a stem: a thin flat strip up from from to top, facing yaw
function stem(m, top, width, color, yaw = 0, from = [0, 0, 0]) {
	const sx = Math.cos(yaw) * width / 2, sz = Math.sin(yaw) * width / 2;
	m.quad([from[0] - sx, from[1], from[2] - sz], [from[0] + sx, from[1], from[2] + sz], [top[0] + sx * 0.6, top[1], top[2] + sz * 0.6], [top[0] - sx * 0.6, top[1], top[2] - sz * 0.6], color);
}
// A FLOWER'S HEAD: n petals round its middle at c, radius r, cupped up by cup, tipped over by tilt (its way yaw). round: each petal two
//		triangles (a rounded one), not one (a narrow one)
function head(m, c, r, n, color, middle, cup = 0.25, tilt = 0, yaw = 0, round = false) {
	const tip = (p) => { const ct = Math.cos(tilt), st = Math.sin(tilt), ux = Math.cos(yaw), uz = Math.sin(yaw), along = p[0] * ux + p[2] * uz, y = p[1]; const a2 = along * ct - y * st, y2 = along * st + y * ct; return [c[0] + p[0] + ux * (a2 - along), c[1] + y2, c[2] + p[2] + uz * (a2 - along)]; };
	const pole = (a, rr, up) => tip([Math.cos(a) * rr, up, Math.sin(a) * rr]);
	const inner = color.map((v) => v * 0.82);
	for (let k = 0; k < n; k++) {
		const am = k / n * Math.PI * 2, w = Math.PI / n * (round ? 0.95 : 0.6);
		if (round) {
			const base = pole(am, r * 0.12, r * cup * 0.1), l = pole(am - w, r * 0.7, r * cup * 0.7), rr = pole(am + w, r * 0.7, r * cup * 0.7), t = pole(am, r, r * cup);
			m.tri(base, l, t, inner, PETAL); m.tri(base, t, rr, color, PETAL);
		} else m.tri(pole(am - w, r * 0.2, r * cup * 0.15), pole(am + w, r * 0.2, r * cup * 0.15), pole(am, r, r * cup), color, PETAL);
	}
	if (middle) { const a = pole(0, r * 0.2, r * 0.08), b = pole(2.1, r * 0.2, r * 0.08), d = pole(4.2, r * 0.2, r * 0.08), top = tip([0, r * 0.14, 0]); m.tri(a, b, top, middle, PETAL); m.tri(b, d, top, middle, PETAL); m.tri(d, a, top, middle, PETAL); }
}
// A DOME (a moss mound, a cap, a puffball): n round, in bands (1 or 2) up to its top at h, its ring jittered by lumpy; under: its underside
function dome(m, c, r, h, n, color, rand, lumpy = 0, under = null, bands = 1) {
	const ring = (s, y) => Array.from({ length: n }, (_, k) => { const a = (k + (y > 0 ? 0.5 : 0)) / n * Math.PI * 2, rr = r * s * (1 - lumpy * rand()); return [c[0] + Math.cos(a) * rr, c[1] + y + lumpy * rand() * h * 0.15, c[2] + Math.sin(a) * rr]; });
	const low = ring(1, 0), top = [c[0], c[1] + h, c[2]], dark = color.map((v) => v * 0.78);
	let upper = low;
	if (bands > 1) {
		upper = ring(0.75, h * 0.6);
		for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; m.tri(low[k1], low[k], upper[k], dark); m.tri(low[k1], upper[k], upper[k1 % n], color); }
	}
	for (let k = 0; k < n; k++) m.tri(upper[(k + 1) % n], upper[k], top, color);
	if (under) for (let k = 0; k < n; k++) m.tri(low[k], low[(k + 1) % n], [c[0], c[1] + h * 0.1, c[2]], under);
}
// a stalk of a few sides (a mushroom's, a cattail's head): from c up to h, radius r (taper: the top's of it)
function stalk(m, c, r, h, sides, color, taper = 0.85) {
	for (let k = 0; k < sides; k++) {
		const a0 = k / sides * Math.PI * 2, a1 = (k + 1) / sides * Math.PI * 2;
		const p = (a, y, rr) => [c[0] + Math.cos(a) * rr, c[1] + y, c[2] + Math.sin(a) * rr];
		m.quad(p(a0, 0, r), p(a1, 0, r), p(a1, h, r * taper), p(a0, h, r * taper), k % 2 ? color : color.map((v) => v * 0.9));
	}
}
// A LUMP OF LEAVES (a bush's): a lumpy ball, n round, three bands from its foot to its top, its middle at c
function lump(m, c, r, h, n, color, rand, dark) {
	const ring = (y, s, off) => Array.from({ length: n }, (_, k) => { const a = (k + off) / n * Math.PI * 2, rr = r * s * (0.8 + 0.4 * rand()); return [c[0] + Math.cos(a) * rr, c[1] + h * y * (0.92 + 0.16 * rand()), c[2] + Math.sin(a) * rr]; });
	const R = [ring(0.04, 0.7, 0), ring(0.38, 1.0, 0.5), ring(0.72, 0.82, 0), ring(0.93, 0.42, 0.5)], top = [c[0], c[1] + h, c[2]];
	const shade = (b) => mixC(dark, color, b / 3);
	for (let b = 0; b < 3; b++) for (let k = 0; k < n; k++) {
		const k1 = (k + 1) % n, lo = R[b], hi = R[b + 1], off = b % 2 == 0;
		if (off) { m.tri(lo[k], lo[k1], hi[k], shade(b)); m.tri(lo[k1], hi[k1], hi[k], shade(b + 0.5)); }
		else { m.tri(lo[k], lo[k1], hi[k1], shade(b)); m.tri(lo[k], hi[k1], hi[k], shade(b + 0.5)); }
	}
	for (let k = 0; k < n; k++) m.tri(R[3][(k + 1) % n], R[3][k], top, color);
}
// blades of grass (a tussock's, dune grass's): n of them, each bent in two triangles
function blades(m, n, height, spread, color, color2, rand) {
	for (let k = 0; k < n; k++) {
		const a = k / n * Math.PI * 2 + rand() * 0.6, out = spread * (0.6 + 0.4 * rand()), h = height * (0.75 + 0.25 * rand()), w = 0.025 + 0.015 * rand();
		const ux = Math.cos(a), uz = Math.sin(a), sx = -uz * w, sz = ux * w;
		const mid = [ux * out * 0.35, h * 0.6, uz * out * 0.35], tip = [ux * out, h, uz * out];
		const c = k % 2 ? color : color2;
		m.quad([-sx, 0, -sz], [sx, 0, sz], [mid[0] + sx * 0.6, mid[1], mid[2] + sz * 0.6], [mid[0] - sx * 0.6, mid[1], mid[2] - sz * 0.6], c);
		m.tri([mid[0] - sx * 0.6, mid[1], mid[2] - sz * 0.6], [mid[0] + sx * 0.6, mid[1], mid[2] + sz * 0.6], tip, c);
	}
}

function kind(def, build) {
	const m = mesh(), rand = seeded(KINDS.length * 7919 + 13);
	build(m, rand);
	const top = Math.max(...m.v.map((v) => v.p[1]), 0.01);
	KINDS.push({ ...def, vertices: m.v.map((v) => ({ ...v, sway: Math.max(v.p[1], 0) / top })) });
}

const C = {
	fern: [0.15, 0.33, 0.08], fernDark: [0.09, 0.22, 0.05], fernPale: [0.24, 0.42, 0.11], bracken: [0.24, 0.36, 0.09], moss: [0.21, 0.37, 0.09], mossDark: [0.12, 0.25, 0.06],
	leaf: [0.14, 0.30, 0.08], leafDark: [0.08, 0.19, 0.05], stem: [0.20, 0.32, 0.10], white: [0.86, 0.86, 0.80], cream: [0.88, 0.84, 0.70],
	yellow: [0.88, 0.70, 0.08], gold: [0.78, 0.52, 0.06], purple: [0.38, 0.22, 0.66], purpleDark: [0.26, 0.14, 0.48], pink: [0.82, 0.36, 0.58], red: [0.74, 0.08, 0.06],
	blue: [0.22, 0.36, 0.80], orange: [0.86, 0.52, 0.10], capRed: [0.76, 0.08, 0.04], capBrown: [0.42, 0.25, 0.12], gill: [0.80, 0.74, 0.62],
	stalk: [0.84, 0.80, 0.70], heather: [0.52, 0.24, 0.52], heatherLeaf: [0.18, 0.26, 0.10], wheat: [0.80, 0.64, 0.28], wheatStalk: [0.60, 0.56, 0.26],
	laurel: [0.10, 0.25, 0.08], laurelDark: [0.05, 0.14, 0.04], laurelFlower: [0.92, 0.74, 0.82], berry: [0.26, 0.09, 0.34], salmonberry: [0.88, 0.45, 0.18],
	cattail: [0.30, 0.17, 0.07], reed: [0.36, 0.43, 0.16], dune: [0.56, 0.58, 0.31], thrift: [0.86, 0.50, 0.66], clover: [0.17, 0.38, 0.10], juniper: [0.12, 0.24, 0.13],
	avens: [0.92, 0.92, 0.86],
};

//-------------------------------THE FOREST FLOOR-------------------------------
kind({ name: 'sword fern', where: 'forest', weight: 4, niche: [0.3, 0.3], spread: 0.4, size: [0.9, 1.4], fern: true, far: true }, (m, r) => {
	for (let k = 0; k < 6; k++) frond(m, k / 6 * Math.PI * 2 + r() * 0.4, 0.95, 0.24, 0.7, 0.6, 5, k % 2 ? C.fern : C.fernDark, [0, 0, 0], C.fernDark);
});
kind({ name: 'bracken', where: 'forest', weight: 3, niche: [0.7, 0.4], spread: 0.35, size: [0.9, 1.3], fern: true, far: true }, (m, r) => {
	stem(m, [0, 0.55, 0], 0.03, C.stem);
	for (let k = 0; k < 4; k++) frond(m, k / 4 * Math.PI * 2 + 0.3, 0.6, 0.34, 0.12, 0.18, 6, C.bracken, [0, 0.55, 0]);
});
kind({ name: 'lady fern', where: 'forest', weight: 3, niche: [0.5, 0.75], spread: 0.35, size: [0.7, 1.1], fern: true }, (m, r) => {
	for (let k = 0; k < 6; k++) frond(m, k / 6 * Math.PI * 2 + r() * 0.5, 0.7, 0.26, 0.8, 0.4, 5, C.fernPale, [0, 0, 0], C.fern);
});
kind({ name: 'maidenhair fern', where: 'forest', weight: 1, niche: [0.15, 0.7], spread: 0.25, size: [0.3, 0.45], fern: true }, (m, r) => {
	stem(m, [0, 0.4, 0], 0.02, C.fernDark);
	for (let k = 0; k < 6; k++) leaf(m, k / 6 * Math.PI * 2, 0.32, 0.16, 0.02, 0.08, 2, C.fern, [0, 0.4, 0]);
});
kind({ name: 'moss mound', where: 'forest', weight: 3, niche: [0.2, 0.15], spread: 0.35, size: [0.3, 0.7], fern: true, far: true }, (m, r) => {
	dome(m, [0, 0, 0], 0.5, 0.2, 9, C.moss, r, 0.25, null, 2);
});
kind({ name: 'moss carpet', where: 'forest', weight: 3, niche: [0.85, 0.15], spread: 0.35, size: [0.6, 1.2], fern: true }, (m, r) => {
	dome(m, [0, 0.01, 0], 0.6, 0.04, 10, C.mossDark, r, 0.35, null, 2);
});
kind({ name: 'wood sorrel', where: 'forest', weight: 2, niche: [0.6, 0.15], spread: 0.25, size: [0.15, 0.25] }, (m, r) => {
	for (let k = 0; k < 4; k++) {
		const c = [Math.cos(k * 1.7) * 0.12, 0, Math.sin(k * 1.7) * 0.12], top = [c[0], 0.12 + 0.03 * k, c[2]];
		stem(m, top, 0.02, C.stem, k, c);
		for (let l = 0; l < 3; l++) leaf(m, l / 3 * Math.PI * 2 + k, 0.13, 0.13, 0.0, 0.03, 2, C.clover, top);
	}
});
kind({ name: 'trillium', where: 'forest', weight: 1, niche: [0.4, 0.55], spread: 0.2, size: [0.25, 0.4], flower: true }, (m, r) => {
	stem(m, [0, 0.3, 0], 0.025, C.stem);
	for (let k = 0; k < 3; k++) leaf(m, k / 3 * Math.PI * 2, 0.24, 0.18, 0.02, 0.06, 3, C.leaf, [0, 0.28, 0]);
	head(m, [0, 0.33, 0], 0.09, 3, C.white, C.yellow, 0.4, 0, 0, true);
});
kind({ name: 'bunchberry', where: 'forest', weight: 1, niche: [0.9, 0.6], spread: 0.2, size: [0.15, 0.25], flower: true }, (m, r) => {
	for (let k = 0; k < 6; k++) leaf(m, k / 6 * Math.PI * 2 + 0.4, 0.16, 0.1, 0.12, 0.08, 2, C.leaf, [0, 0.1, 0]);
	head(m, [0, 0.15, 0], 0.06, 4, C.cream, C.leafDark, 0.1, 0, 0, true);
});
kind({ name: 'fly agaric', where: 'forest', weight: 0.6, niche: [0.55, 0.95], spread: 0.25, size: [0.12, 0.22], fungus: true }, (m, r) => {
	stalk(m, [0, 0, 0], 0.16, 0.85, 6, C.stalk);
	dome(m, [0, 0.82, 0], 0.55, 0.32, 8, C.capRed, r, 0, C.gill, 2);
	for (let k = 0; k < 4; k++) { const a = k * 1.6, c = [Math.cos(a) * 0.3, 1.06 + 0.02 * k, Math.sin(a) * 0.3]; m.tri([c[0] - 0.06, c[1], c[2]], [c[0] + 0.06, c[1], c[2]], [c[0], c[1] + 0.01, c[2] + 0.07], C.white); }
});
kind({ name: 'chanterelles', where: 'forest', weight: 0.8, niche: [0.25, 0.9], spread: 0.25, size: [0.08, 0.14], fungus: true }, (m, r) => {
	for (let k = 0; k < 3; k++) { const c = [Math.cos(k * 2.1) * 0.45, 0, Math.sin(k * 2.1) * 0.45], h = 0.35 + 0.1 * k; stalk(m, c, 0.11, h, 4, C.orange, 1.3); dome(m, [c[0], h, c[2]], 0.34, -0.1, 6, C.orange, r); }
});
kind({ name: 'bolete', where: 'forest', weight: 0.8, niche: [0.75, 0.8], spread: 0.25, size: [0.12, 0.2], fungus: true }, (m, r) => {
	stalk(m, [0, 0, 0], 0.28, 0.58, 6, C.cream, 0.8);
	dome(m, [0, 0.52, 0], 0.6, 0.36, 8, C.capBrown, r, 0, C.gold, 2);
});
kind({ name: 'puffballs', where: 'forest', weight: 0.6, niche: [0.95, 0.95], spread: 0.25, size: [0.08, 0.14], fungus: true }, (m, r) => {
	for (let k = 0; k < 3; k++) { const c = [Math.cos(k * 2.1) * 0.5, 0, Math.sin(k * 2.1) * 0.5]; dome(m, c, 0.45 + 0.1 * k, 0.6, 7, C.cream, r, 0.08, null, 2); }
});
kind({ name: 'salal', where: 'forest', weight: 2, niche: [0.45, 0.2], spread: 0.3, size: [0.4, 0.8], far: true }, (m, r) => {
	for (let k = 0; k < 9; k++) leaf(m, k / 9 * Math.PI * 2 + r(), 0.45, 0.24, 0.3 + 0.3 * r(), 0.3, 3, k % 2 ? C.leaf : C.leafDark, [0, 0.12 * r(), 0]);
	stem(m, [0, 0.4, 0], 0.02, C.stem);
});
kind({ name: 'oregon grape', where: 'forest', weight: 1.5, niche: [0.1, 0.45], spread: 0.25, size: [0.35, 0.6] }, (m, r) => {
	stem(m, [0, 0.5, 0], 0.03, C.stem);
	for (let k = 0; k < 6; k++) leaf(m, k / 6 * Math.PI * 2 + 0.6, 0.32, 0.16, 0.12, 0.1, 3, C.laurel, [0, 0.18 + 0.05 * k, 0]);
	head(m, [0.03, 0.52, 0], 0.07, 4, C.yellow, null, 0.6); head(m, [-0.04, 0.47, 0.03], 0.06, 4, C.yellow, null, 0.6);
});

//-------------------------------THE GRASSLAND-------------------------------
kind({ name: 'daisies', where: 'grass', weight: 3, niche: [0.3, 0.3], spread: 0.3, size: [0.75, 1.05], flower: true }, (m, r) => {
	for (let k = 0; k < 3; k++) { const c = [Math.cos(k * 2.1) * 0.25, 0, Math.sin(k * 2.1) * 0.25], top = [c[0], 0.75 + 0.25 * r(), c[2]]; stem(m, top, 0.035, C.stem, k, c); leaf(m, k + 0.5, 0.18, 0.06, 0.1, 0.05, 1, C.leaf, [c[0], 0.25, c[2]]); head(m, top, 0.2, 11, C.white, C.yellow, 0.12, 0.5, k); }
});
kind({ name: 'buttercups', where: 'grass', weight: 3, niche: [0.7, 0.3], spread: 0.3, size: [0.8, 1.1], flower: true }, (m, r) => {
	for (let k = 0; k < 3; k++) { const c = [Math.cos(k * 2.1) * 0.25, 0, Math.sin(k * 2.1) * 0.25], top = [c[0], 0.8 + 0.2 * r(), c[2]]; stem(m, top, 0.035, C.stem, k, c); leaf(m, k + 1, 0.2, 0.1, 0.05, 0.05, 2, C.leaf, [c[0], 0.3, c[2]]); head(m, top, 0.13, 5, C.yellow, null, 0.6, 0.3, k, true); }
});
kind({ name: 'lupine', where: 'grass', weight: 2, niche: [0.5, 0.8], spread: 0.25, size: [1.1, 1.5], flower: true, far: true }, (m, r) => {
	for (let k = 0; k < 6; k++) leaf(m, k / 6 * Math.PI * 2, 0.28, 0.08, 0.15, 0.05, 2, C.leaf, [0, 0.08, 0]);
	stem(m, [0, 0.5, 0], 0.04, C.stem);
	for (let k = 0; k < 6; k++) { const y = 0.48 + k * 0.085, rr = 0.075 * (1 - k / 7); head(m, [0, y, 0], rr, 3, k % 2 ? C.purple : C.purpleDark, null, -0.3, 0, k); }
});
kind({ name: 'foxglove', where: 'grass', weight: 1, niche: [0.85, 0.75], spread: 0.2, size: [1.3, 1.7], flower: true, far: true }, (m, r) => {
	for (let k = 0; k < 5; k++) leaf(m, k / 5 * Math.PI * 2, 0.35, 0.16, 0.1, 0.05, 3, C.leafDark, [0, 0.02, 0]);
	stem(m, [0, 0.95, 0], 0.035, C.stem);
	for (let k = 0; k < 7; k++) { const a = k * 2.4, y = 0.5 + k * 0.065, c = [Math.cos(a) * 0.05, y, Math.sin(a) * 0.05]; m.tri([c[0], y + 0.06, c[2]], [c[0] + Math.cos(a) * 0.08 - Math.sin(a) * 0.03, y - 0.03, c[2] + Math.sin(a) * 0.08 + Math.cos(a) * 0.03], [c[0] + Math.cos(a) * 0.08 + Math.sin(a) * 0.03, y - 0.03, c[2] + Math.sin(a) * 0.08 - Math.cos(a) * 0.03], C.pink, PETAL); }
});
kind({ name: 'poppies', where: 'grass', weight: 2, niche: [0.15, 0.6], spread: 0.25, size: [0.85, 1.15], flower: true }, (m, r) => {
	for (let k = 0; k < 3; k++) { const c = [Math.cos(k * 2.1) * 0.22, 0, Math.sin(k * 2.1) * 0.22], top = [c[0] + 0.05, 0.75 + 0.1 * k, c[2]]; stem(m, top, 0.03, C.stem, k, c); head(m, top, 0.16, 4, C.red, [0.05, 0.03, 0.02], 0.5, 0.2, k, true); }
	for (let k = 0; k < 2; k++) leaf(m, k * 3, 0.25, 0.08, 0.15, 0.05, 2, C.leaf, [0, 0.02, 0]);
});
kind({ name: 'yarrow', where: 'grass', weight: 2, niche: [0.6, 0.55], spread: 0.25, size: [0.85, 1.1], flower: true }, (m, r) => {
	for (let k = 0; k < 4; k++) frond(m, k * 1.6, 0.3, 0.1, 0.3, 0.1, 3, C.leaf);
	stem(m, [0, 0.82, 0], 0.03, C.stem);
	for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2, c = [Math.cos(a) * 0.08, 0.84 + 0.02 * (k % 2), Math.sin(a) * 0.08]; head(m, c, 0.05, 3, C.white, null, 0.05, 0, a); }
});
kind({ name: 'cornflowers', where: 'grass', weight: 1.5, niche: [0.35, 0.95], spread: 0.25, size: [0.85, 1.15], flower: true }, (m, r) => {
	for (let k = 0; k < 3; k++) { const c = [Math.cos(k * 2.1) * 0.2, 0, Math.sin(k * 2.1) * 0.2], top = [c[0], 0.8 + 0.1 * r(), c[2]]; stem(m, top, 0.03, C.stem, k * 1.4, c); head(m, top, 0.12, 7, C.blue, C.purpleDark, 0.5, 0.4, k * 1.4); }
	for (let k = 0; k < 2; k++) leaf(m, k * 2.5, 0.2, 0.04, 0.2, 0.05, 1, C.leaf, [0, 0.05, 0]);
});
kind({ name: 'clover', where: 'grass', weight: 3, niche: [0.85, 0.2], spread: 0.35, size: [0.4, 0.7] }, (m, r) => {
	dome(m, [0, 0.01, 0], 0.55, 0.05, 10, C.clover, r, 0.3);
	for (let k = 0; k < 8; k++) { const a = k * 0.8, c = [Math.cos(a) * 0.35, 0.06, Math.sin(a) * 0.35]; leaf(m, a + 1, 0.1, 0.08, 0.02, 0.02, 1, C.clover, c); }
	for (let k = 0; k < 3; k++) head(m, [Math.cos(k * 2) * 0.2, 0.1, Math.sin(k * 2) * 0.2], 0.06, 4, C.pink, null, 0.6);
});
kind({ name: 'dandelions', where: 'grass', weight: 2, niche: [0.1, 0.15], spread: 0.3, size: [0.9, 1.2], flower: true }, (m, r) => {
	for (let k = 0; k < 7; k++) leaf(m, k / 7 * Math.PI * 2 + 0.3, 0.42, 0.13, 0.05, 0.0, 3, C.leaf);
	stem(m, [0.05, 0.55, 0], 0.03, C.stem);
	head(m, [0.05, 0.56, 0], 0.13, 8, C.yellow, C.gold, 0.3);
});
kind({ name: 'tussock', where: 'grass', weight: 4, niche: [0.5, 0.1], spread: 0.4, size: [0.9, 1.4], far: true }, (m, r) => {
	blades(m, 14, 0.9, 0.4, C.stem, C.dune, r);
});

//-------------------------------THE MARSH, THE SAND AND THE HEIGHTS-------------------------------
kind({ name: 'cattails', where: 'wet', weight: 3, niche: [0.5, 0.5], spread: 0.5, size: [1.2, 1.7], far: true }, (m, r) => {
	for (let k = 0; k < 4; k++) {
		const c = [Math.cos(k * 1.6) * 0.14, 0, Math.sin(k * 1.6) * 0.14], top = [c[0], 1 - 0.05 * k, c[2]];
		stem(m, top, 0.025, C.reed, k, c);
		stalk(m, [top[0], top[1] - 0.26, top[2]], 0.035, 0.2, 4, C.cattail, 1);
	}
	blades(m, 6, 1.1, 0.25, C.reed, C.stem, r);
});
kind({ name: 'dune grass', where: 'beach', weight: 3, niche: [0.5, 0.5], spread: 0.5, size: [0.5, 0.8], far: true }, (m, r) => {
	blades(m, 12, 0.85, 0.55, C.dune, C.reed, r);
});
kind({ name: 'sea thrift', where: 'beach', weight: 1, niche: [0.2, 0.8], spread: 0.3, size: [0.15, 0.25], flower: true }, (m, r) => {
	dome(m, [0, 0, 0], 0.5, 0.25, 8, C.reed, r, 0.2);
	for (let k = 0; k < 4; k++) { const c = [Math.cos(k * 1.6) * 0.25, 0.2, Math.sin(k * 1.6) * 0.25], top = [c[0], 0.75, c[2]]; stem(m, top, 0.035, C.stem, k, c); head(m, top, 0.12, 6, C.thrift, null, 0.6); }
});
kind({ name: 'heather', where: 'alpine', weight: 3, niche: [0.4, 0.4], spread: 0.4, size: [0.4, 0.7], far: true }, (m, r) => {
	dome(m, [0, 0, 0], 0.55, 0.35, 9, C.heatherLeaf, r, 0.3, null, 2);
	for (let k = 0; k < 6; k++) { const a = k * 1.05, c = [Math.cos(a) * 0.28, 0.25, Math.sin(a) * 0.28]; m.quad([c[0] - 0.04, c[1], c[2]], [c[0] + 0.04, c[1], c[2]], [c[0] + 0.02, c[1] + 0.22, c[2]], [c[0] - 0.02, c[1] + 0.22, c[2]], C.heather, PETAL); }
});
kind({ name: 'mountain avens', where: 'alpine', weight: 1.5, niche: [0.8, 0.7], spread: 0.3, size: [0.15, 0.25], flower: true }, (m, r) => {
	dome(m, [0, 0, 0], 0.45, 0.08, 8, C.leafDark, r, 0.3);
	for (let k = 0; k < 3; k++) { const c = [Math.cos(k * 2.1) * 0.15, 0.08, Math.sin(k * 2.1) * 0.15], top = [c[0], 0.4, c[2]]; stem(m, top, 0.03, C.stem, k, c); head(m, top, 0.16, 8, C.avens, C.yellow, 0.2); }
});

//-------------------------------THE BIG ONES (flora.js: BIG)-------------------------------
kind({ name: 'laurel', where: 'forest', weight: 1, size: [1.4, 2.2], big: true }, (m, r) => {
	lump(m, [0, 0, 0], 0.7, 0.8, 8, C.laurel, r, C.laurelDark);
	lump(m, [0.4, 0.3, 0.2], 0.5, 0.65, 7, C.laurel, r, C.laurelDark);
	lump(m, [-0.35, 0.2, -0.25], 0.45, 0.6, 7, C.laurel, r, C.laurelDark);
	for (let k = 0; k < 8; k++) { const a = k * 0.8, c = [Math.cos(a) * 0.5, 0.75 + 0.15 * r(), Math.sin(a) * 0.5]; head(m, c, 0.11, 5, C.laurelFlower, null, 0.8); }
});
kind({ name: 'huckleberry', where: 'forest', weight: 1.4, size: [1.0, 1.6], big: true }, (m, r) => {
	lump(m, [0, 0, 0], 0.6, 0.9, 8, C.leaf, r, C.leafDark);
	lump(m, [0.3, 0.25, -0.2], 0.4, 0.6, 6, C.leaf, r, C.leafDark);
	for (let k = 0; k < 10; k++) { const a = k * 0.7, c = [Math.cos(a) * 0.55, 0.35 + 0.4 * r(), Math.sin(a) * 0.55]; dome(m, c, 0.04, 0.07, 3, C.berry, r); }
});
kind({ name: 'salmonberry', where: 'grass', weight: 1, size: [1.0, 1.5], big: true }, (m, r) => {
	lump(m, [0, 0, 0], 0.65, 0.85, 8, C.bracken, r, C.leafDark);
	lump(m, [-0.3, 0.2, 0.25], 0.45, 0.6, 6, C.bracken, r, C.leafDark);
	for (let k = 0; k < 8; k++) { const a = k * 0.9, c = [Math.cos(a) * 0.6, 0.35 + 0.35 * r(), Math.sin(a) * 0.6]; dome(m, c, 0.05, 0.08, 4, C.salmonberry, r); }
});
kind({ name: 'juniper', where: 'alpine', weight: 1, size: [0.8, 1.3], big: true }, (m, r) => {
	lump(m, [0, 0, 0], 0.8, 0.45, 9, C.juniper, r, C.laurelDark);
	lump(m, [0.45, 0, 0.3], 0.55, 0.35, 7, C.juniper, r, C.laurelDark);
});
kind({ name: 'wild wheat', where: 'grass', weight: 1, size: [0.9, 1.15], big: true, wheat: true }, (m, r) => {
	for (let k = 0; k < 10; k++) {
		const a = k / 10 * Math.PI * 2 + r() * 0.6, d = 0.1 + 0.2 * r(), c = [Math.cos(a) * d, 0, Math.sin(a) * d], top = [c[0] + Math.cos(a) * 0.08, 0.85 + 0.15 * r(), c[2] + Math.sin(a) * 0.08];
		stem(m, top, 0.022, C.wheatStalk, a, c);
		for (const turn of [0, Math.PI / 2]) { const sx = Math.cos(a + turn) * 0.028, sz = Math.sin(a + turn) * 0.028; m.quad([top[0] - sx, top[1], top[2] - sz], [top[0] + sx, top[1], top[2] + sz], [top[0] + sx * 0.4 + Math.cos(a) * 0.05, top[1] + 0.17, top[2] + sz * 0.4 + Math.sin(a) * 0.05], [top[0] - sx * 0.4 + Math.cos(a) * 0.05, top[1] + 0.17, top[2] - sz * 0.4 + Math.sin(a) * 0.05], turn ? C.wheat : C.gold); }
		m.tri([top[0] - 0.005, top[1] + 0.16, top[2]], [top[0] + 0.005, top[1] + 0.16, top[2]], [top[0] + Math.cos(a) * 0.08, top[1] + 0.3, top[2] + Math.sin(a) * 0.08], C.wheat);
	}
});

export const SMALL = KINDS.filter((k) => !k.big), BIG = KINDS.filter((k) => k.big);
export const WHERE = ['forest', 'grass', 'wet', 'beach', 'alpine'];
export const SMALL_VERTICES = Math.max(...SMALL.map((k) => k.vertices.length));
export const BIG_VERTICES = Math.max(...BIG.map((k) => k.vertices.length));
