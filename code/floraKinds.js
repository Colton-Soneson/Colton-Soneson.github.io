/*
	THE KINDS OF PLANT (flora.js draws them, vf_flora.js places and shapes them): each made of flat triangles here once, in metres, its foot
	at the origin and up the y axis, every vertex with its own color. A small one up to about 64 triangles (a fern's fronds with their
	leaflets, a flower's petals, a mushroom's cap and gills; a bunchgrass up to about 150), a big one up to about 200 (a shrub's
	stems, branches and leaf clusters: up to about 700, each big kind is drawn on its own, flora.js).
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
/*
	HD (HD Textures and Models, settings.hdVegetation): every kind is made twice, as KINDS and KINDS_HD. Made HD, the builders take
	more of everything (D: a leaf's segments, a flower's round petals, a dome's sides, a bush's leaves and branches, a stone's sides),
	about twice the triangles; the grasses' blades are left as they are. And every vertex says what it is (its material, see
	vf_flora.js: THE HD TEXTURES) and where on it it is (uv), so the shader can draw a leaf's veins, a petal's streaks, a fern's
	leaflets, the leaves of a bush's mass and the grain of a stone:
		0 nothing, 1 a leaf (uv: x along it from its stalk, y across it, -1 to 1), 2 a frond's leaflet (x along the frond, y out to its
		tip, -1 to 1), 3 a petal (x out from the middle, y across it), 4 a blade of grass (x up it), 5 a mass of leaves (x round it,
		y up it), 6 moss, 7 stone (both: x and y across it)
*/
let HD = false;
const D = (n, f = 2) => HD ? Math.max(Math.round(n * f), n + 1) : n;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const mixC = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function seeded(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function mesh() {
	const v = [];
	let mat = 0, uvOf = null;		// (as: what the triangles made from now on are, and their uv from their points, till done is called)
	const tri = (a, b, c, color, flag = 0, uv = null) => { const n = norm(cross(sub(b, a), sub(c, a))); [a, b, c].forEach((p, i) => v.push({ p, n, c: color, flag, uv: uv ? uv[i] : uvOf ? uvOf(p) : [0, 0], mat })); };
	return {
		v, tri,
		quad: (a, b, c, d, color, flag = 0, uv = null) => { tri(a, b, c, color, flag, uv && [uv[0], uv[1], uv[2]]); tri(a, c, d, color, flag, uv && [uv[0], uv[2], uv[3]]); },
		as: (m2, fn = null) => { const was = [mat, uvOf]; mat = m2; uvOf = fn; return () => { [mat, uvOf] = was; }; },
	};
}
// the curve a leaf or a frond follows: out yaw's way len, rising rise and drooping droop, from
const curveOf = (yaw, len, rise, droop, from) => (t) => [from[0] + Math.cos(yaw) * len * t, from[1] + rise * t - droop * t * t, from[2] + Math.sin(yaw) * len * t];
// A LEAF: a strip along its curve in segs pieces, widest a third of the way out, to a point; its two halves a little folded up (fold)
function leaf(m, yaw, len, width, rise, droop, segs, color, from = [0, 0, 0], flag = 0, fold = 0.25) {
	const done = m.as(1);
	segs = D(segs);
	const at = curveOf(yaw, len, rise, droop, from), sx = -Math.sin(yaw), sz = Math.cos(yaw);
	const half = (t) => width * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(t * 0.9 + 0.08, 1)), 0.6);
	const dark = color.map((c) => c * 0.8);
	for (let k = 0; k < segs; k++) {
		const t0 = k / segs, t1 = (k + 1) / segs, a = at(t0), b = at(t1), w0 = half(t0), w1 = k == segs - 1 ? 0 : half(t1);
		const side = (p, w, s) => [p[0] + sx * w * s, p[1] + w * fold, p[2] + sz * w * s];
		if (k == segs - 1) { m.tri(side(a, w0, 1), a, b, color, flag, [[t0, 1], [t0, 0], [1, 0]]); m.tri(a, side(a, w0, -1), b, dark, flag, [[t0, 0], [t0, -1], [1, 0]]); }
		else { m.quad(side(a, w0, 1), a, b, side(b, w1, 1), color, flag, [[t0, 1], [t0, 0], [t1, 0], [t1, 1]]); m.quad(a, side(a, w0, -1), side(b, w1, -1), b, dark, flag, [[t0, 0], [t0, -1], [t1, -1], [t1, 0]]); }
	}
	done();
}
// A FROND: its leaflets (pinnae) in pairs along its curve, one pair a segment, longest a third of the way out
function frond(m, yaw, len, width, rise, droop, segs, color, from = [0, 0, 0], color2 = null) {
	segs = D(segs, 1.6);
	const done = m.as(2);
	const at = curveOf(yaw, len, rise, droop, from), sx = -Math.sin(yaw), sz = Math.cos(yaw), fx = Math.cos(yaw), fz = Math.sin(yaw);
	for (let k = 0; k < segs; k++) {
		const t0 = k / segs, t1 = (k + 1) / segs, a = at(t0), b = at(t1), tm = (t0 + t1) / 2, mid = at(tm);
		const w = width * 0.5 * Math.pow(Math.sin(Math.PI * Math.min(tm * 0.9 + 0.1, 1)), 0.7), step = len / segs;
		const c = k % 2 && color2 ? color2 : color;
		for (const s of [1, -1]) m.tri(a, b, [mid[0] + sx * w * s + fx * step * 0.5, mid[1] - w * 0.25, mid[2] + sz * w * s + fz * step * 0.5], s > 0 ? c : c.map((v) => v * 0.85), 0, [[t0, 0], [t1, 0], [tm, s]]);
	}
	done();
}
// a stem: a thin flat strip up from from to top, facing yaw
function stem(m, top, width, color, yaw = 0, from = [0, 0, 0]) {
	const sx = Math.cos(yaw) * width / 2, sz = Math.sin(yaw) * width / 2;
	m.quad([from[0] - sx, from[1], from[2] - sz], [from[0] + sx, from[1], from[2] + sz], [top[0] + sx * 0.6, top[1], top[2] + sz * 0.6], [top[0] - sx * 0.6, top[1], top[2] - sz * 0.6], color);
}
// A FLOWER'S HEAD: n petals round its middle at c, radius r, cupped up by cup, tipped over by tilt (its way yaw). round: each petal two
//		triangles (a rounded one), not one (a narrow one)
function head(m, c, r, n, color, middle, cup = 0.25, tilt = 0, yaw = 0, round = false) {
	round = round || HD;
	const done = m.as(3);
	const tip = (p) => { const ct = Math.cos(tilt), st = Math.sin(tilt), ux = Math.cos(yaw), uz = Math.sin(yaw), along = p[0] * ux + p[2] * uz, y = p[1]; const a2 = along * ct - y * st, y2 = along * st + y * ct; return [c[0] + p[0] + ux * (a2 - along), c[1] + y2, c[2] + p[2] + uz * (a2 - along)]; };
	const pole = (a, rr, up) => tip([Math.cos(a) * rr, up, Math.sin(a) * rr]);
	const inner = color.map((v) => v * 0.82);
	for (let k = 0; k < n; k++) {
		const am = k / n * Math.PI * 2, w = Math.PI / n * (round ? 0.95 : 0.6);
		if (round) {
			const base = pole(am, r * 0.12, r * cup * 0.1), l = pole(am - w, r * 0.7, r * cup * 0.7), rr = pole(am + w, r * 0.7, r * cup * 0.7), t = pole(am, r, r * cup);
			m.tri(base, l, t, inner, PETAL, [[0, 0], [0.7, -1], [1, 0]]); m.tri(base, t, rr, color, PETAL, [[0, 0], [1, 0], [0.7, 1]]);
		} else m.tri(pole(am - w, r * 0.2, r * cup * 0.15), pole(am + w, r * 0.2, r * cup * 0.15), pole(am, r, r * cup), color, PETAL, [[0.2, -1], [0.2, 1], [1, 0]]);
	}
	if (middle) { const a = pole(0, r * 0.2, r * 0.08), b = pole(2.1, r * 0.2, r * 0.08), d = pole(4.2, r * 0.2, r * 0.08), top = tip([0, r * 0.14, 0]); m.tri(a, b, top, middle, PETAL); m.tri(b, d, top, middle, PETAL); m.tri(d, a, top, middle, PETAL); }
	done();
}
// A DOME (a moss mound, a cap, a puffball): n round, in bands (1 or 2) up to its top at h, its ring jittered by lumpy; under: its underside
function dome(m, c, r, h, n, color, rand, lumpy = 0, under = null, bands = 1, mat = 0) {
	n = D(n, 1.3); if (HD) bands = 2;
	const done = m.as(mat, (p) => [(p[0] - c[0]) / r, (p[2] - c[2]) / r]);
	const ring = (s, y) => Array.from({ length: n }, (_, k) => { const a = (k + (y > 0 ? 0.5 : 0)) / n * Math.PI * 2, rr = r * s * (1 - lumpy * rand()); return [c[0] + Math.cos(a) * rr, c[1] + y + lumpy * rand() * h * 0.15, c[2] + Math.sin(a) * rr]; });
	const low = ring(1, 0), top = [c[0], c[1] + h, c[2]], dark = color.map((v) => v * 0.78);
	let upper = low;
	if (bands > 1) {
		upper = ring(0.75, h * 0.6);
		for (let k = 0; k < n; k++) { const k1 = (k + 1) % n; m.tri(low[k1], low[k], upper[k], dark); m.tri(low[k1], upper[k], upper[k1 % n], color); }
	}
	for (let k = 0; k < n; k++) m.tri(upper[(k + 1) % n], upper[k], top, color);
	if (under) for (let k = 0; k < n; k++) m.tri(low[k], low[(k + 1) % n], [c[0], c[1] + h * 0.1, c[2]], under);
	done();
}
// a stalk of a few sides (a mushroom's, a cattail's head): from c up to h, radius r (taper: the top's of it)
function stalk(m, c, r, h, sides, color, taper = 0.85) {
	sides = D(sides, 1.5);
	for (let k = 0; k < sides; k++) {
		const a0 = k / sides * Math.PI * 2, a1 = (k + 1) / sides * Math.PI * 2;
		const p = (a, y, rr) => [c[0] + Math.cos(a) * rr, c[1] + y, c[2] + Math.sin(a) * rr];
		m.quad(p(a0, 0, r), p(a1, 0, r), p(a1, h, r * taper), p(a0, h, r * taper), k % 2 ? color : color.map((v) => v * 0.9));
	}

}
// A LUMP OF LEAVES (a bush's): a lumpy ball, n round, three bands from its foot to its top, its middle at c
function lump(m, c, r, h, n, color, rand, dark) {
	n = D(n, 1.5);
	const done = m.as(5, (p) => [Math.atan2(p[2] - c[2], p[0] - c[0]) / Math.PI, (p[1] - c[1]) / h]);
	const ring = (y, s, off) => Array.from({ length: n }, (_, k) => { const a = (k + off) / n * Math.PI * 2, rr = r * s * (0.8 + 0.4 * rand()); return [c[0] + Math.cos(a) * rr, c[1] + h * y * (0.92 + 0.16 * rand()), c[2] + Math.sin(a) * rr]; });
	const R = [ring(0.04, 0.7, 0), ring(0.38, 1.0, 0.5), ring(0.72, 0.82, 0), ring(0.93, 0.42, 0.5)], top = [c[0], c[1] + h, c[2]];
	const shade = (b) => mixC(dark, color, b / 3);
	for (let b = 0; b < 3; b++) for (let k = 0; k < n; k++) {
		const k1 = (k + 1) % n, lo = R[b], hi = R[b + 1], off = b % 2 == 0;
		if (off) { m.tri(lo[k], lo[k1], hi[k], shade(b)); m.tri(lo[k1], hi[k1], hi[k], shade(b + 0.5)); }
		else { m.tri(lo[k], lo[k1], hi[k1], shade(b)); m.tri(lo[k], hi[k1], hi[k], shade(b + 0.5)); }
	}
	for (let k = 0; k < n; k++) m.tri(R[3][(k + 1) % n], R[3][k], top, color);
	done();
}
// blades of grass (a tussock's, dune grass's): n of them, each bent in two triangles
function blades(m, n, height, spread, color, color2, rand) {
	n = D(n, 1.6);
	const done = m.as(4, (p) => [p[1] / height, 0]);
	for (let k = 0; k < n; k++) {
		const a = k / n * Math.PI * 2 + rand() * 0.6, out = spread * (0.6 + 0.4 * rand()), h = height * (0.75 + 0.25 * rand()), w = 0.025 + 0.015 * rand();
		const ux = Math.cos(a), uz = Math.sin(a), sx = -uz * w, sz = ux * w;
		const mid = [ux * out * 0.35, h * 0.6, uz * out * 0.35], tip = [ux * out, h, uz * out];
		const c = k % 2 ? color : color2;
		m.quad([-sx, 0, -sz], [sx, 0, sz], [mid[0] + sx * 0.6, mid[1], mid[2] + sz * 0.6], [mid[0] - sx * 0.6, mid[1], mid[2] - sz * 0.6], c);
		m.tri([mid[0] - sx * 0.6, mid[1], mid[2] - sz * 0.6], [mid[0] + sx * 0.6, mid[1], mid[2] + sz * 0.6], tip, c);
	}
	done();
}

// GRASS BLADES THAT BEND (a bunchgrass's, a sedge's): n of them out of a tuft, each in segs pieces along a curve that rises and arches
//		over (arch: how far its tip droops, of its height), narrowing to its point. width: at its foot (metres, at a size of 1)
function arching(m, n, height, spread, width, color, color2, rand, arch = 0.35, segs = 2, from = [0, 0, 0]) {
	const done = m.as(4, (p) => [(p[1] - from[1]) / height, 0]);
	for (let k = 0; k < n; k++) {
		const a = k / n * Math.PI * 2 + rand() * 0.9, out = spread * (0.45 + 0.55 * rand()), h = height * (0.7 + 0.3 * rand()), w = width * (0.75 + 0.5 * rand());
		const ux = Math.cos(a), uz = Math.sin(a), droop = arch * h * (0.6 + 0.8 * rand());
		const at = (t) => [from[0] + ux * out * t * t * 0.9 + ux * out * t * 0.1, from[1] + h * t - droop * t * t * t, from[2] + uz * out * t * t * 0.9 + uz * out * t * 0.1];
		const c = k % 2 ? color : color2;
		for (let s = 0; s < segs; s++) {
			const t0 = s / segs, t1 = (s + 1) / segs, p0 = at(t0), p1 = at(t1), w0 = w * (1 - t0 * 0.85), w1 = w * (1 - t1 * 0.85);
			const sx = -uz, sz = ux;
			if (s == segs - 1) m.tri([p0[0] - sx * w0, p0[1], p0[2] - sz * w0], [p0[0] + sx * w0, p0[1], p0[2] + sz * w0], p1, mixC(c, color2, t0 * 0.3));
			else m.quad([p0[0] - sx * w0, p0[1], p0[2] - sz * w0], [p0[0] + sx * w0, p0[1], p0[2] + sz * w0], [p1[0] + sx * w1, p1[1], p1[2] + sz * w1], [p1[0] - sx * w1, p1[1], p1[2] - sz * w1], mixC(c, color2, t0 * 0.3));
		}
	}
	done();
}
// A SEED SPIKE (timothy's, a cattail's or a sedge's head): a few-sided stalk of len up the way up from at, its two ends pointed
function spike(m, at, up, len, r, sides, color) {
	sides = D(sides, 1.5);
	const u = norm(up), side = norm(cross(u, [0.3, 0.1, 0.9])), side2 = cross(u, side);
	const p = (t, a, rr) => add(add(add(at, u, len * t), side, Math.cos(a) * rr), side2, Math.sin(a) * rr);
	const bottom = add(at, u, -len * 0.08), top = add(at, u, len * 1.1);
	for (let k = 0; k < sides; k++) {
		const a0 = k / sides * Math.PI * 2, a1 = (k + 1) / sides * Math.PI * 2, c = k % 2 ? color : color.map((v) => v * 0.85);
		m.quad(p(0, a0, r), p(0, a1, r), p(1, a1, r * 0.8), p(1, a0, r * 0.8), c);
		m.tri(p(1, a0, r * 0.8), p(1, a1, r * 0.8), top, c);
		m.tri(p(0, a1, r), p(0, a0, r), bottom, c);
	}

}
// A PANICLE (an airy, branching head: redtop's, hairgrass's, orchard grass's): branches out of the stem's top part at, each a thin
//		sliver tipped with a little spray of seeds (n branches, len long, open: how far out from the stem they lean)
function panicle(m, at, up, n, len, open, color, color2, rand, sprays = 2) {
	const u = norm(up);
	for (let k = 0; k < n; k++) {
		const t = k / n, base = add(at, u, len * 0.9 * t), a = k * 2.4 + rand(), lean = open * (1 - t * 0.6);
		const dir = norm([Math.cos(a) * lean + u[0], u[1] * (1 - lean * 0.4), Math.sin(a) * lean + u[2]]), bl = len * (0.45 - 0.3 * t) * (0.7 + 0.6 * rand());
		const tip = add(base, dir, bl), sx = -Math.sin(a) * 0.006, sz = Math.cos(a) * 0.006;
		m.tri([base[0] - sx, base[1], base[2] - sz], [base[0] + sx, base[1], base[2] + sz], tip, color);
		for (let s = 0; s < sprays; s++) {
			const q = add(base, dir, bl * (0.55 + 0.45 * s / Math.max(sprays - 1, 1))), b = a + (s - 0.5) * 1.4, w = bl * 0.16;
			m.tri(q, [q[0] + Math.cos(b) * w, q[1] + w * 0.4, q[2] + Math.sin(b) * w], [q[0] + Math.cos(b + 0.5) * w * 0.7, q[1] + w * 0.9, q[2] + Math.sin(b + 0.5) * w * 0.7], s % 2 ? color2 : color);
		}
	}
}
// A NODDING HEAD OF AWNS (foxtail barley's, wild rye's): a head along a curve that bows over from at, every bit of it shedding long
//		fine bristles that splay out (n of them)
function awned(m, at, yaw, len, bow, n, awn, color, color2, rand) {
	const ux = Math.cos(yaw), uz = Math.sin(yaw);
	const along = (t) => [at[0] + ux * len * t * 0.6, at[1] + len * t * (1 - bow * t), at[2] + uz * len * t * 0.6];
	for (let k = 0; k < n; k++) {
		const t = k / n, p = along(t), a = yaw + (k % 2 ? 1.2 : -1.2) + (rand() - 0.5) * 0.6, out = awn * (0.7 + 0.6 * rand());
		const tip = [p[0] + Math.cos(a) * out * 0.8 + ux * out * 0.4, p[1] + out * (0.5 - bow * t), p[2] + Math.sin(a) * out * 0.8 + uz * out * 0.4];
		const w = 0.006;
		m.tri([p[0] - uz * w, p[1], p[2] + ux * w], [p[0] + uz * w, p[1], p[2] - ux * w], tip, k % 3 ? color : color2);
	}
	for (let k = 0; k < 4; k++) { const p0 = along(k / 4), p1 = along((k + 1) / 4), w = 0.012 * (1 - k / 5); m.quad([p0[0] - uz * w, p0[1], p0[2] + ux * w], [p0[0] + uz * w, p0[1], p0[2] - ux * w], [p1[0] + uz * w, p1[1], p1[2] - ux * w], [p1[0] - uz * w, p1[1], p1[2] + ux * w], color2); }
}
// A PALMATE LEAF (a maple's, devil's club's): lobes fanned round its stalk's end at c, r out, lying open towards up, each lobe two
//		triangles to a point
function palm(m, c, r, lobes, color, up = [0, 1, 0], turn = 0, cupped = 0.15) {
	const done = m.as(1);
	const u = norm(up), side = norm(cross(u, Math.abs(u[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), side2 = cross(u, side), dark = color.map((v) => v * 0.8);
	const at = (a, rr, lift) => add(add(add(c, side, Math.cos(a) * rr), side2, Math.sin(a) * rr), u, lift);
	for (let k = 0; k < lobes; k++) {
		const a = turn + k / lobes * Math.PI * 2, w = Math.PI / lobes * 0.85;
		const tip = at(a, r, r * cupped), l = at(a - w, r * 0.55, r * cupped * 0.5), rr = at(a + w, r * 0.55, r * cupped * 0.5), base = at(a, r * 0.08, 0);
		m.tri(base, l, tip, k % 2 ? color : dark, 0, [[0, 0], [0.55, -1], [1, 0]]); m.tri(base, tip, rr, k % 2 ? dark : color, 0, [[0, 0], [1, 0], [0.55, 1]]);
	}
	done();
}
// A WOODY STEM (a bush's): from a to b, a few sides, its radius r at a going down to r * taper at b
function twig(m, a, b, r, color, sides = 3, taper = 0.55) {
	if (HD) sides = 4;
	const u = norm(sub(b, a)), side = norm(cross(u, Math.abs(u[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0])), side2 = cross(u, side);
	const ring = (p, rr) => Array.from({ length: sides }, (_, k) => { const t = k / sides * Math.PI * 2; return add(add(p, side, Math.cos(t) * rr), side2, Math.sin(t) * rr); });
	const lo = ring(a, r), hi = ring(b, r * taper);
	for (let k = 0; k < sides; k++) m.quad(lo[k], lo[(k + 1) % sides], hi[(k + 1) % sides], hi[k], k % 2 ? color : color.map((v) => v * 0.8));

}
/*
	A SHRUB, with depth: not a ball of leaves but its stems, its branches off them, and the leaves in clusters along the outer parts of
	the branches, with the air showing between them, so a bush is lit through, and looked into, as a real one is. o:
		stems, height, spread		how many stems from its foot, how tall it stands, and how far out they lean (metres at a size of 1)
		bend						how far a stem arches back down over its length (a bramble's: a long way)
		branches					side branches off each stem, up its upper part
		clusters					leaf clusters on each stem and branch, from cluster (of the way up it) out to its end
		leaf(m, at, dir, rand, k)	lays one cluster at at, the way out from the stem dir
		bark						the color of the stems
		extra(m, at, dir, rand, k)	once at the end of every branch and stem (a flower, a fruit, a head of seeds)
		core						{ r, color, dark }: a lumpy mass of foliage at the middle of every cluster, r across (metres at a size
									of 1), the leaves standing out of it: what makes a bush look full, each cluster its own mass with
									air between them
*/
// A MASS OF FOLIAGE (shrub's core): a lumpy, a little flattened, eight-sided thing at c, r out
function foliage(m, c, r, color, dark, rand) {
	const done = m.as(5, (p) => [Math.atan2(p[2] - c[2], p[0] - c[0]) / Math.PI, (p[1] - c[1]) / r]);
	const j = () => r * (0.7 + 0.5 * rand());
	const px = [c[0] + j(), c[1], c[2]], nx = [c[0] - j(), c[1], c[2]], pz = [c[0], c[1], c[2] + j()], nz = [c[0], c[1], c[2] - j()];
	const top = [c[0] + (rand() - 0.5) * r * 0.4, c[1] + j() * 0.8, c[2] + (rand() - 0.5) * r * 0.4], bottom = [c[0], c[1] - j() * 0.6, c[2]];
	const ring = [px, pz, nx, nz];
	for (let k = 0; k < 4; k++) { const a = ring[k], b = ring[(k + 1) % 4]; m.tri(a, top, b, k % 2 ? color : mixC(color, dark, 0.3)); m.tri(b, bottom, a, dark); }
	done();
}
function shrub(m, rand, o) {
	let { stems, height, spread, bend = 0.15, branches = 2, clusters = 3, cluster = 0.4, bark, leaf, extra = null, thick = 0.03, core = null } = o;
	clusters = D(clusters, 1.34);
	const along = (from, dir, len, droop) => (t) => [from[0] + dir[0] * len * t, from[1] + dir[1] * len * t - droop * len * t * t, from[2] + dir[2] * len * t];
	const leaves = (curve, len, k, start) => {
		for (let c = 0; c < clusters; c++) {
			const t = start + (1 - start) * (c + 0.5 + 0.4 * (rand() - 0.5)) / clusters, p = curve(t), q = curve(Math.min(t + 0.05, 1));
			if (core) foliage(m, p, core.r, core.color, mixC(core.dark, core.color, 0.5), rand);
			leaf(m, p, norm(sub(q, p)), rand, k * 7 + c);
		}
	};
	for (let s = 0; s < stems; s++) {
		const a = s / stems * Math.PI * 2 + rand() * 0.8, lean = spread / height * (0.5 + 0.7 * rand());
		const dir = norm([Math.cos(a) * lean, 1, Math.sin(a) * lean]), len = height * (0.75 + 0.35 * rand()) / dir[1];
		const foot = [Math.cos(a) * spread * 0.08, 0, Math.sin(a) * spread * 0.08], curve = along(foot, dir, len, bend);
		const segs = 3;
		for (let k = 0; k < segs; k++) twig(m, curve(k / segs), curve((k + 1) / segs), thick * (1 - k / segs * 0.6), bark, 3, 0.8);
		leaves(curve, len, s, cluster);
		if (extra) extra(m, curve(1), dir, rand, s);
		for (let b = 0; b < branches; b++) {
			const t = 0.35 + 0.5 * (b + rand() * 0.6) / branches, from = curve(t), ba = a + (b % 2 ? 1 : -1) * (0.6 + 0.6 * rand());
			const bdir = norm([Math.cos(ba) * 0.9, 0.55 + 0.3 * rand(), Math.sin(ba) * 0.9]), blen = len * (0.32 + 0.2 * rand()) * (1 - t * 0.4);
			const bc = along(from, bdir, blen, bend * 1.4);
			twig(m, from, bc(1), thick * 0.5, bark, 3, 0.5);
			leaves(bc, blen, s * 5 + b + 11, 0.2);
			if (extra) extra(m, bc(1), bdir, rand, s * 5 + b);
		}
	}
}
// LEAF CLUSTERS for shrub(): n leaves round a twig's end at, leaning out every way (most of them the way the twig goes, dir) and up
//		or down, so the cluster has depth: each a kite of two triangles folded along its midrib, len long and width wide
const leafy = (count, len, width, color, color2) => (m, at, dir, rand, k) => {
	const yaw0 = Math.atan2(dir[2], dir[0]), n = D(count, 1.3), done = m.as(1);
	for (let l = 0; l < n; l++) {
		const yaw = yaw0 + (l / n - 0.5) * 2 * Math.PI * 0.8 + (rand() - 0.5) * 0.7, pitch = -0.35 + 1.1 * rand(), s = 0.75 + 0.5 * rand();
		const d = [Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch)], side = [-Math.sin(yaw), 0, Math.cos(yaw)];
		const base = add(at, d, len * 0.08), tip = add(at, d, len * s), mid = add(add(at, d, len * s * 0.42), [0, 1, 0], width * s * 0.18);
		const c = (k + l) % 3 ? color : color2;
		m.tri(base, add(mid, side, width * s * 0.5), tip, c, 0, [[0, 0], [0.42, 1], [1, 0]]);
		m.tri(base, tip, add(mid, side, -width * s * 0.5), c.map((v) => v * 0.82), 0, [[0, 0], [1, 0], [0.42, -1]]);
	}
	done();
};
// and of palmate leaves, n of them standing out on short stalks
const palmy = (count, r, lobes, color, color2) => (m, at, dir, rand, k) => {
	const n = count;
	for (let l = 0; l < n; l++) {
		const a = Math.atan2(dir[2], dir[0]) + (l - (n - 1) / 2) * 1.3 + (rand() - 0.5) * 0.4, d = r * (0.9 + 0.4 * rand());
		const c = [at[0] + Math.cos(a) * d, at[1] + r * 0.25 * rand(), at[2] + Math.sin(a) * d];
		stem(m, c, 0.008, color2, a, at);
		palm(m, c, r * (0.8 + 0.4 * rand()), lobes, (k + l) % 2 ? color : color2, norm([Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35]), rand() * 3);
	}
};
// and of compound leaves (an elder's, a rose's): leaflets in pairs along a short rachis, as a frond's
const pinnate = (count, len, width, color, color2) => (m, at, dir, rand, k) => {
	const n = count;
	for (let l = 0; l < n; l++) {
		const yaw = Math.atan2(dir[2], dir[0]) + (l - (n - 1) / 2) * (2.4 / n) + (rand() - 0.5) * 0.5;
		frond(m, yaw, len * (0.8 + 0.4 * rand()), width, len * 0.3 * rand(), len * 0.25, 3, (k + l) % 2 ? color : color2, at, color2);
	}
};
// a few round berries or hips (dir unused): n of them hung round at
const berries = (n, r, color, spread = 0.06) => (m, at, dir, rand) => {
	for (let b = 0; b < n; b++) dome(m, [at[0] + (rand() - 0.5) * spread, at[1] - rand() * spread, at[2] + (rand() - 0.5) * spread], r, r * 1.6, 4, color, rand);
};

// A STONE (the stony ground's: still, it does not sway): an angular lump, n sided, r across and h high at c, its top a little
//		flattened and leaning (tilt), in two bands, its foot sunk a little into the ground. color2: its top (lichen, moss)
function rock(m, c, r, h, n, color, color2, rand, tilt = 0.1) {
	n = D(n, 1.5);
	const done = m.as(7, (p) => [(p[0] - c[0]) / r, (p[2] - c[2]) / r + p[1] / r]);
	const ring = (s, y) => Array.from({ length: n }, (_, k) => { const a = (k + rand() * 0.6) / n * Math.PI * 2, rr = r * s * (0.75 + 0.45 * rand()); return [c[0] + Math.cos(a) * rr, c[1] + y + Math.cos(a) * tilt * r, c[2] + Math.sin(a) * rr]; });
	const foot = ring(1.0, -0.15 * h), shoulder = ring(0.92, h * 0.6), crown = ring(0.55, h * 0.95), top = [c[0], c[1] + h, c[2]];
	const dark = color.map((v) => v * 0.72);
	for (let k = 0; k < n; k++) {
		const k1 = (k + 1) % n;
		m.quad(foot[k], foot[k1], shoulder[k1], shoulder[k], k % 2 ? dark : color.map((v) => v * 0.82));
		m.quad(shoulder[k], shoulder[k1], crown[k1], crown[k], k % 2 ? color : color.map((v) => v * 0.92));
		m.tri(crown[k], crown[k1], top, color2);
	}
	done();
}

const DEFS = [];
function kind(def, build) { DEFS.push({ def, build }); }
// every kind made, HD or not (see HD)
function made(hd) {
	HD = hd;
	const kinds = DEFS.map(({ def, build }, index) => {
		const m = mesh(), rand = seeded(index * 7919 + 13);
		build(m, rand);
		const top = Math.max(...m.v.map((v) => v.p[1]), 0.01);
		return { ...def, vertices: m.v.map((v) => ({ ...v, sway: def.still ? 0 : Math.max(v.p[1], 0) / top })) };
	});
	HD = false;
	return kinds;
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
	cobble: [0.50, 0.49, 0.46], slab: [0.44, 0.43, 0.41], pebble: [0.58, 0.55, 0.50], lichen: [0.60, 0.60, 0.40],
	// (the grasses and bushes added in version 7)
	timothy: [0.49, 0.62, 0.27], timothyHead: [0.62, 0.68, 0.41], barley: [0.84, 0.68, 0.62], barleyAwn: [1.00, 0.89, 0.84], orchard: [0.27, 0.51, 0.23],
	rye: [0.51, 0.70, 0.65], ryeHead: [0.84, 0.86, 0.68], redtop: [0.78, 0.35, 0.30], redtopStem: [0.54, 0.59, 0.30], rush: [0.30, 0.49, 0.16], rushFlower: [0.57, 0.41, 0.22],
	sedge: [0.24, 0.46, 0.16], sedgeDark: [0.16, 0.32, 0.11], sedgeHead: [0.30, 0.22, 0.11], tule: [0.38, 0.54, 0.24], tuleHead: [0.62, 0.41, 0.19],
	beachRye: [0.62, 0.78, 0.70], beachRyeHead: [0.89, 0.84, 0.57], fescue: [0.57, 0.70, 0.59], fescueDry: [0.84, 0.78, 0.54], hairgrass: [0.41, 0.54, 0.27], hairgrassHead: [0.94, 0.84, 0.65],
	maple: [0.28, 0.53, 0.12], mapleDark: [0.18, 0.38, 0.09], mapleBark: [0.30, 0.26, 0.14], club: [0.22, 0.47, 0.12], clubStem: [0.52, 0.44, 0.22], clubBerry: [0.80, 0.10, 0.06],
	elder: [0.20, 0.40, 0.11], elderBerry: [0.78, 0.06, 0.06], hazel: [0.30, 0.50, 0.15], hazelBark: [0.40, 0.30, 0.20], catkin: [0.72, 0.66, 0.34],
	snowberry: [0.22, 0.34, 0.16], snowBerry: [0.92, 0.92, 0.90], rose: [0.21, 0.40, 0.12], roseFlower: [0.90, 0.48, 0.64], hip: [0.78, 0.16, 0.06], roseBark: [0.42, 0.20, 0.16],
	bramble: [0.18, 0.38, 0.10], brambleCane: [0.36, 0.22, 0.22], blackberry: [0.08, 0.05, 0.10], redberry: [0.62, 0.08, 0.10], spray: [0.25, 0.43, 0.15], sprayFlower: [0.90, 0.88, 0.76],
	dogwood: [0.22, 0.43, 0.12], dogwoodStem: [0.62, 0.12, 0.08], dogwoodFlower: [0.92, 0.92, 0.84], willow: [0.38, 0.53, 0.25], willowPale: [0.58, 0.68, 0.47], willowBark: [0.46, 0.34, 0.16],
	buckthorn: [0.55, 0.65, 0.55], buckthornBerry: [0.94, 0.54, 0.08], buckthornBark: [0.36, 0.30, 0.22], birch: [0.30, 0.47, 0.18], birchBark: [0.32, 0.18, 0.12],
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
	dome(m, [0, 0, 0], 0.5, 0.2, 9, C.moss, r, 0.25, null, 2, 6);
});
kind({ name: 'moss carpet', where: 'forest', weight: 3, niche: [0.85, 0.15], spread: 0.35, size: [0.6, 1.2], fern: true }, (m, r) => {
	dome(m, [0, 0.01, 0], 0.6, 0.04, 10, C.mossDark, r, 0.35, null, 2, 6);
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
kind({ name: 'daisies', where: 'grass', weight: 3, niche: [0.3, 0.3], spread: 0.3, size: [0.6, 0.85], flower: true }, (m, r) => {
	for (let k = 0; k < 3; k++) { const c = [Math.cos(k * 2.1) * 0.25, 0, Math.sin(k * 2.1) * 0.25], top = [c[0], 0.75 + 0.25 * r(), c[2]]; stem(m, top, 0.035, C.stem, k, c); leaf(m, k + 0.5, 0.18, 0.06, 0.1, 0.05, 1, C.leaf, [c[0], 0.25, c[2]]); head(m, top, 0.1, 11, C.white, C.yellow, 0.12, 0.5, k); }
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
	dome(m, [0, 0, 0], 0.55, 0.35, 9, C.heatherLeaf, r, 0.3, null, 2, 5);
	for (let k = 0; k < 6; k++) { const a = k * 1.05, c = [Math.cos(a) * 0.28, 0.25, Math.sin(a) * 0.28]; m.quad([c[0] - 0.04, c[1], c[2]], [c[0] + 0.04, c[1], c[2]], [c[0] + 0.02, c[1] + 0.22, c[2]], [c[0] - 0.02, c[1] + 0.22, c[2]], C.heather, PETAL); }
});
kind({ name: 'mountain avens', where: 'alpine', weight: 1.5, niche: [0.8, 0.7], spread: 0.3, size: [0.15, 0.25], flower: true }, (m, r) => {
	dome(m, [0, 0, 0], 0.45, 0.08, 8, C.leafDark, r, 0.3);
	for (let k = 0; k < 3; k++) { const c = [Math.cos(k * 2.1) * 0.15, 0.08, Math.sin(k * 2.1) * 0.15], top = [c[0], 0.4, c[2]]; stem(m, top, 0.03, C.stem, k, c); head(m, top, 0.16, 8, C.avens, C.yellow, 0.2); }
});

//-------------------------------THE GRASSES (version 7): bunchgrasses, sedges and rushes, each its own height, color and head-------------------------------
kind({ name: 'timothy', where: 'grass', weight: 2.5, niche: [0.2, 0.45], spread: 0.3, size: [0.9, 1.2], far: true }, (m, r) => {
	arching(m, 10, 0.55, 0.38, 0.022, C.timothy, C.stem, r, 0.5);
	for (let k = 0; k < 5; k++) { const a = k * 1.3 + r(), c = [Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06], top = [c[0] + Math.cos(a) * 0.08, 0.85 + 0.2 * r(), c[2] + Math.sin(a) * 0.08]; stem(m, top, 0.012, C.timothy, a, c); spike(m, top, [Math.cos(a) * 0.1, 1, Math.sin(a) * 0.1], 0.12, 0.014, 3, C.timothyHead); }
});
kind({ name: 'foxtail barley', where: 'grass', weight: 1.5, niche: [0.9, 0.45], spread: 0.25, size: [0.55, 0.8], flower: true }, (m, r) => {
	arching(m, 8, 0.35, 0.3, 0.018, C.timothy, C.stem, r, 0.5);
	for (let k = 0; k < 4; k++) { const a = k * 1.6 + r(), c = [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05], top = [c[0] + Math.cos(a) * 0.1, 0.55 + 0.1 * r(), c[2] + Math.sin(a) * 0.1]; stem(m, top, 0.01, C.stem, a, c); awned(m, top, a, 0.14, 0.9, 9, 0.09, C.barleyAwn, C.barley, r); }
});
kind({ name: 'orchard grass', where: 'grass', weight: 2.5, niche: [0.4, 0.65], spread: 0.3, size: [0.9, 1.25], far: true }, (m, r) => {
	arching(m, 14, 0.6, 0.5, 0.032, C.orchard, C.clover, r, 0.6);
	for (let k = 0; k < 3; k++) { const a = k * 2.1 + r(), c = [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05], top = [c[0] + Math.cos(a) * 0.06, 0.8 + 0.15 * r(), c[2] + Math.sin(a) * 0.06]; stem(m, top, 0.012, C.orchard, a, c); panicle(m, top, [0.15, 1, 0], 4, 0.16, 0.5, C.ryeHead, C.orchard, r, 2); }
});
kind({ name: 'blue wildrye', where: 'grass', weight: 1.5, niche: [0.65, 0.95], spread: 0.25, size: [1.0, 1.4], far: true }, (m, r) => {
	arching(m, 10, 0.7, 0.48, 0.026, C.rye, C.ryeHead, r, 0.5);
	for (let k = 0; k < 3; k++) { const a = k * 2.1 + r(), c = [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05], top = [c[0] + Math.cos(a) * 0.1, 0.95 + 0.1 * r(), c[2] + Math.sin(a) * 0.1]; stem(m, top, 0.012, C.rye, a, c); awned(m, top, a, 0.2, 0.35, 10, 0.05, C.ryeHead, C.rye, r); }
});
kind({ name: 'redtop', where: 'grass', weight: 2, niche: [0.05, 0.75], spread: 0.3, size: [0.7, 1.0], flower: true }, (m, r) => {
	arching(m, 9, 0.4, 0.34, 0.018, C.redtopStem, C.stem, r, 0.5);
	for (let k = 0; k < 4; k++) { const a = k * 1.6 + r(), c = [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05], top = [c[0] + Math.cos(a) * 0.05, 0.62 + 0.15 * r(), c[2] + Math.sin(a) * 0.05]; stem(m, top, 0.01, C.redtopStem, a, c); panicle(m, top, [0, 1, 0], 6, 0.2, 0.7, C.redtop, C.thrift, r, 1); }
});
kind({ name: 'wood rush', where: 'forest', weight: 2.5, niche: [0.3, 0.6], spread: 0.3, size: [0.35, 0.55] }, (m, r) => {
	arching(m, 12, 0.35, 0.42, 0.035, C.rush, C.leaf, r, 0.6);
	for (let k = 0; k < 3; k++) { const a = k * 2.1 + r(), c = [Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04], top = [c[0] + Math.cos(a) * 0.08, 0.5 + 0.1 * r(), c[2] + Math.sin(a) * 0.08]; stem(m, top, 0.01, C.rush, a, c); panicle(m, top, [0, 1, 0], 4, 0.1, 0.9, C.rushFlower, C.rush, r, 1); }
});
kind({ name: 'forest sedge', where: 'forest', weight: 2, niche: [0.65, 0.5], spread: 0.3, size: [0.4, 0.65], far: true }, (m, r) => {
	arching(m, 14, 0.45, 0.42, 0.02, C.sedge, C.sedgeDark, r, 0.75, 3);
	for (let k = 0; k < 3; k++) { const a = k * 2.1 + r(), top = [Math.cos(a) * 0.1, 0.4 + 0.08 * r(), Math.sin(a) * 0.1]; stem(m, top, 0.008, C.sedge, a, [0, 0, 0]); spike(m, top, [Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3], 0.05, 0.01, 3, C.sedgeHead); }
});
kind({ name: 'bulrush', where: 'wet', weight: 2.5, niche: [0.25, 0.4], spread: 0.4, size: [1.4, 2.0], far: true }, (m, r) => {
	for (let k = 0; k < 9; k++) {
		const a = k * 2.4 + r(), d = 0.04 + 0.12 * r(), c = [Math.cos(a) * d, 0, Math.sin(a) * d], top = [c[0] + Math.cos(a) * 0.08, 0.85 + 0.15 * r(), c[2] + Math.sin(a) * 0.08];
		twig(m, c, top, 0.012, C.tule, 3, 0.4);
		if (k % 2 == 0) for (let b = 0; b < 3; b++) dome(m, [top[0] - Math.cos(a + b) * 0.02, top[1] - 0.06 - 0.03 * b, top[2] - Math.sin(a + b) * 0.02], 0.02, 0.05, 4, C.tuleHead, r);
	}
});
kind({ name: 'slough sedge', where: 'wet', weight: 2.5, niche: [0.75, 0.6], spread: 0.4, size: [0.8, 1.2], far: true }, (m, r) => {
	arching(m, 12, 0.85, 0.55, 0.03, C.sedge, C.reed, r, 0.55, 3);
	for (let k = 0; k < 3; k++) { const a = k * 2.1 + r(), c = [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05], top = [c[0] + Math.cos(a) * 0.05, 0.95 + 0.1 * r(), c[2] + Math.sin(a) * 0.05]; stem(m, top, 0.012, C.sedge, a, c); spike(m, [top[0], top[1] - 0.12, top[2]], [Math.cos(a) * 0.2, 1, Math.sin(a) * 0.2], 0.1, 0.018, 3, C.sedgeHead); spike(m, [top[0], top[1] - 0.27, top[2]], [Math.cos(a + 1) * 0.5, 1, Math.sin(a + 1) * 0.5], 0.07, 0.014, 3, C.cattail); }
});
kind({ name: 'beach wildrye', where: 'beach', weight: 2.5, niche: [0.75, 0.3], spread: 0.45, size: [0.7, 1.0], far: true }, (m, r) => {
	arching(m, 12, 0.75, 0.6, 0.04, C.beachRye, C.dune, r, 0.6, 3);
	for (let k = 0; k < 3; k++) { const a = k * 2.1 + r(), c = [Math.cos(a) * 0.05, 0, Math.sin(a) * 0.05], top = [c[0] + Math.cos(a) * 0.06, 0.9 + 0.1 * r(), c[2] + Math.sin(a) * 0.06]; stem(m, top, 0.014, C.beachRye, a, c); spike(m, top, [0, 1, 0], 0.2, 0.02, 3, C.beachRyeHead); }
});
kind({ name: 'Idaho fescue', where: 'alpine', weight: 2.5, niche: [0.15, 0.25], spread: 0.35, size: [0.4, 0.6], far: true }, (m, r) => {
	arching(m, 22, 0.42, 0.36, 0.012, C.fescue, C.fescueDry, r, 0.6);
	for (let k = 0; k < 4; k++) { const a = k * 1.6 + r(), c = [Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04], top = [c[0] + Math.cos(a) * 0.07, 0.62 + 0.15 * r(), c[2] + Math.sin(a) * 0.07]; stem(m, top, 0.008, C.fescueDry, a, c); panicle(m, top, [0, 1, 0], 3, 0.1, 0.35, C.fescueDry, C.fescue, r, 1); }
});
kind({ name: 'tufted hairgrass', where: 'alpine', weight: 2, niche: [0.6, 0.15], spread: 0.3, size: [0.5, 0.8], flower: true, far: true }, (m, r) => {
	arching(m, 14, 0.3, 0.34, 0.014, C.hairgrass, C.leafDark, r, 0.6);
	for (let k = 0; k < 6; k++) { const a = k * 1.05 + r(), c = [Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04], top = [c[0] + Math.cos(a) * 0.12, 0.55 + 0.25 * r(), c[2] + Math.sin(a) * 0.12]; stem(m, top, 0.006, C.hairgrassHead, a, c); panicle(m, top, [Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3], 5, 0.2, 0.8, C.hairgrassHead, C.avens, r, 1); }
});

//-------------------------------THE STONY GROUND (version 7: where 'stony', the stones of the grassland's stony patches, meadowShapes.js)-------------------------------
//		(still: the wind does not sway them. Sized so a stone is a stone, not a boulder: boulders.js has those)
kind({ name: 'cobbles', where: 'stony', weight: 3, niche: [0.4, 0.4], spread: 0.5, size: [0.5, 0.9], far: true, still: true }, (m, r) => {
	for (let k = 0; k < 4; k++) { const a = k * 1.7 + r(), d = 0.15 + 0.25 * r(), rr = 0.12 + 0.1 * r(); rock(m, [Math.cos(a) * d, 0, Math.sin(a) * d], rr, rr * (0.6 + 0.4 * r()), 6, C.cobble, k % 2 ? C.cobble : C.lichen, r); }
});
kind({ name: 'stone slab', where: 'stony', weight: 1.5, niche: [0.7, 0.6], spread: 0.4, size: [0.7, 1.3], far: true, still: true }, (m, r) => {
	rock(m, [0, 0, 0], 0.45, 0.14, 7, C.slab, C.lichen, r, 0.18);
	rock(m, [0.42, 0, 0.25], 0.18, 0.1, 5, C.slab, C.slab, r, 0.1);
});
kind({ name: 'pebbles', where: 'stony', weight: 2.5, niche: [0.2, 0.8], spread: 0.5, size: [0.4, 0.7], still: true }, (m, r) => {
	for (let k = 0; k < 7; k++) { const a = k * 2.4 + r(), d = 0.08 + 0.35 * r(), rr = 0.035 + 0.04 * r(); rock(m, [Math.cos(a) * d, 0, Math.sin(a) * d], rr, rr * 0.7, 4, k % 3 ? C.cobble : C.pebble, C.pebble, r, 0.05); }
});
kind({ name: 'mossy stone', where: 'stony', weight: 1.5, niche: [0.8, 0.2], spread: 0.4, size: [0.6, 1.8], far: true, still: true }, (m, r) => {
	rock(m, [0, 0, 0], 0.32, 0.26, 7, C.cobble, C.moss, r, 0.12);
	dome(m, [0.1, 0.22, 0.05], 0.18, 0.05, 6, C.moss, r, 0.3, null, 1, 6);
});
kind({ name: 'stones and grass', where: 'stony', weight: 2, niche: [0.5, 0.1], spread: 0.4, size: [0.6, 1.0] }, (m, r) => {
	rock(m, [0.1, 0, 0], 0.16, 0.12, 5, C.cobble, C.lichen, r);
	rock(m, [-0.18, 0, 0.12], 0.1, 0.08, 5, C.slab, C.slab, r);
	arching(m, 8, 0.32, 0.25, 0.012, C.fescue, C.fescueDry, r, 0.5);
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

//-------------------------------THE BUSHES (version 7, flora.js: BIG): each a shrub, its stems and branches and its leaves in clusters-------------------------------
//		(where and weight: which ground, and how common against the other bushes of it; flora.js puts them down in stands of one kind)
kind({ name: 'vine maple', where: 'forest', weight: 1.2, size: [2.0, 3.2], big: true }, (m, r) => {
	shrub(m, r, { core: { r: 0.1, color: C.maple, dark: C.mapleDark }, stems: 5, height: 1.0, spread: 0.55, bend: 0.35, branches: 1, clusters: 2, cluster: 0.5, bark: C.mapleBark, thick: 0.025, leaf: palmy(2, 0.16, 5, C.maple, C.mapleDark) });
});
kind({ name: "devil's club", where: 'forest', weight: 0.7, size: [1.4, 2.2], big: true }, (m, r) => {
	shrub(m, r, { stems: 5, height: 1.0, spread: 0.25, bend: 0.05, branches: 0, clusters: 1, cluster: 0.92, bark: C.clubStem, thick: 0.03,
		leaf: palmy(3, 0.3, 7, C.club, C.leafDark), extra: (m2, at, dir, rand) => { for (let b = 0; b < 5; b++) dome(m2, [at[0] + (rand() - 0.5) * 0.06, at[1] + 0.02 + b * 0.03, at[2] + (rand() - 0.5) * 0.06], 0.025, 0.04, 4, C.clubBerry, rand); } });
});
kind({ name: 'red elderberry', where: 'forest', weight: 0.9, size: [1.8, 2.6], big: true }, (m, r) => {
	shrub(m, r, { core: { r: 0.1, color: C.elder, dark: C.leafDark }, stems: 4, height: 1.0, spread: 0.5, bend: 0.12, branches: 2, clusters: 2, cluster: 0.45, bark: C.hazelBark, leaf: pinnate(2, 0.3, 0.12, C.elder, C.leafDark), extra: berries(4, 0.016, C.elderBerry, 0.08) });
});
kind({ name: 'hazel', where: 'forest', weight: 1.2, size: [2.0, 3.0], big: true }, (m, r) => {
	shrub(m, r, { core: { r: 0.09, color: C.hazel, dark: C.leafDark }, stems: 6, height: 1.0, spread: 0.35, bend: 0.06, branches: 2, clusters: 3, cluster: 0.4, bark: C.hazelBark, thick: 0.022, leaf: leafy(4, 0.16, 0.13, C.hazel, C.leaf),
		extra: (m2, at, dir, rand) => { if (rand() < 0.5) spike(m2, at, [dir[0], -1, dir[2]], 0.06, 0.008, 3, C.catkin); } });
});
kind({ name: 'snowberry', where: 'grass', weight: 1.2, size: [0.9, 1.4], big: true }, (m, r) => {
	shrub(m, r, { core: { r: 0.07, color: C.snowberry, dark: C.leafDark }, stems: 6, height: 1.0, spread: 0.6, bend: 0.25, branches: 1, clusters: 3, cluster: 0.35, bark: C.hazelBark, thick: 0.015, leaf: leafy(4, 0.09, 0.07, C.snowberry, C.leafDark), extra: berries(3, 0.02, C.snowBerry, 0.04) });
});
kind({ name: 'wild rose', where: 'grass', weight: 1.2, size: [1.0, 1.6], big: true, flower: true }, (m, r) => {
	shrub(m, r, { core: { r: 0.07, color: C.rose, dark: C.leafDark }, stems: 5, height: 1.0, spread: 0.5, bend: 0.3, branches: 1, clusters: 2, cluster: 0.4, bark: C.roseBark, thick: 0.015, leaf: pinnate(2, 0.16, 0.08, C.rose, C.leafDark),
		extra: (m2, at, dir, rand, k) => { if (k % 2) head(m2, add(at, [0, 0.02, 0]), 0.05, 5, C.roseFlower, C.yellow, 0.3, 0, 0, true); else dome(m2, at, 0.022, 0.04, 5, C.hip, rand); } });
});
kind({ name: 'blackberry bramble', where: 'grass', weight: 1, size: [1.3, 2.0], big: true }, (m, r) => {
	shrub(m, r, { core: { r: 0.08, color: C.bramble, dark: C.leafDark }, stems: 7, height: 0.8, spread: 0.9, bend: 0.7, branches: 1, clusters: 2, cluster: 0.3, bark: C.brambleCane, thick: 0.014, leaf: pinnate(2, 0.15, 0.11, C.bramble, C.leafDark),
		extra: (m2, at, dir, rand, k) => berries(2, 0.014, k % 3 ? C.blackberry : C.redberry, 0.04)(m2, at, dir, rand) });
});
kind({ name: 'ocean spray', where: 'grass', weight: 0.8, size: [1.8, 2.6], big: true, flower: true }, (m, r) => {
	shrub(m, r, { core: { r: 0.08, color: C.spray, dark: C.leafDark }, stems: 6, height: 1.0, spread: 0.6, bend: 0.35, branches: 1, clusters: 3, cluster: 0.4, bark: C.mapleBark, thick: 0.018, leaf: leafy(4, 0.11, 0.09, C.spray, C.leaf),
		extra: (m2, at, dir, rand) => panicle(m2, at, [dir[0], -0.6, dir[2]], 5, 0.16, 0.5, C.sprayFlower, C.cream, rand, 2) });
});
kind({ name: 'red-osier dogwood', where: 'wet', weight: 1.2, size: [1.6, 2.4], big: true }, (m, r) => {
	shrub(m, r, { core: { r: 0.08, color: C.dogwood, dark: C.leafDark }, stems: 8, height: 1.0, spread: 0.45, bend: 0.1, branches: 1, clusters: 3, cluster: 0.5, bark: C.dogwoodStem, thick: 0.016, leaf: leafy(4, 0.14, 0.08, C.dogwood, C.leafDark),
		extra: (m2, at, dir, rand) => { for (let b = 0; b < 2; b++) head(m2, add(at, [(rand() - 0.5) * 0.05, 0.01, (rand() - 0.5) * 0.05]), 0.025, 4, C.dogwoodFlower, null, 0.2); } });
});
kind({ name: 'willow scrub', where: 'wet', weight: 1.2, size: [2.0, 3.2], big: true }, (m, r) => {
	shrub(m, r, { core: { r: 0.07, color: C.willow, dark: C.leafDark }, stems: 7, height: 1.0, spread: 0.4, bend: 0.08, branches: 1, clusters: 3, cluster: 0.35, bark: C.willowBark, thick: 0.015, leaf: leafy(5, 0.14, 0.035, C.willow, C.willowPale) });
});
kind({ name: 'sea buckthorn', where: 'beach', weight: 1, size: [1.2, 2.0], big: true }, (m, r) => {
	shrub(m, r, { core: { r: 0.07, color: C.buckthorn, dark: C.buckthornBark }, stems: 6, height: 1.0, spread: 0.5, bend: 0.12, branches: 1, clusters: 3, cluster: 0.3, bark: C.buckthornBark, thick: 0.02, leaf: leafy(5, 0.1, 0.028, C.buckthorn, C.willowPale), extra: berries(4, 0.012, C.buckthornBerry, 0.05) });
});
kind({ name: 'dwarf birch', where: 'alpine', weight: 1, size: [0.6, 1.0], big: true }, (m, r) => {
	shrub(m, r, { core: { r: 0.06, color: C.birch, dark: C.leafDark }, stems: 7, height: 0.8, spread: 0.9, bend: 0.35, branches: 1, clusters: 3, cluster: 0.3, bark: C.birchBark, thick: 0.02, leaf: leafy(4, 0.08, 0.07, C.birch, C.leafDark) });
});

export const KINDS = made(false), KINDS_HD = made(true);
export const SMALL = KINDS.filter((k) => !k.big), BIG = KINDS.filter((k) => k.big);
export const WHERE = ['forest', 'grass', 'wet', 'beach', 'alpine', 'stony'];
export const SMALL_VERTICES = Math.max(...SMALL.map((k) => k.vertices.length));
export const BIG_VERTICES = Math.max(...BIG.map((k) => k.vertices.length), ...KINDS_HD.filter((k) => k.big).map((k) => k.vertices.length));
