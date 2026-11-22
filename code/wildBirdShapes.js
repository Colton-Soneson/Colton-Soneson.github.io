/*
	THE WILD BIRDS' SHAPES (wildBirds.js, vf_wildBirds.js): the seagull, the owl, the mallard (the drake and the hen), the loon, the
	swan and the wild turkey (the tom and the hen). Each its own mesh, in metres, life size, standing on y = 0 and heading along +z,
	its colors in it: every corner [x, y, z, part] and [r, g, b, span].

	PARTS (what vf_wildBirds.js moves):
		0	the body (and the tail of all but a turkey tom)
		1	the neck and the head: turned (an owl's right round) and bent down (to peck, to feed) about the kind's NECK
		2	a wing. span: how far out along it, 0 at the shoulder to 1 at the tip, negative on the left. Spread and beating in the air;
			folded along the kind's FOLD on the ground and the water
		3	a leg: swung in the walk; gone up into the body in the air and on the water
		4	a turkey tom's tail: a fan lying back, raised up behind it when he struts (display)

	Each kind (BIRD_KINDS): its name, the mesh, how big it is drawn (times life size: a little bigger for the far ones in the air),
	where its wings join (SHOULDER: x, y, z), the way a folded wing lies from there (FOLD, its length), its body tipped forward in the
	air (TILT, about MIDDLE: an owl sits up), where its neck bends (NECK) and how far down its head goes (DOWN), where a tom's tail is
	raised from (TAIL), where its legs swing from (HIP: y, z), the height of the water on it when it swims (FLOAT), and its hitbox (HITS:
	[x, y, z, radius]).
*/

// (the pieces: each a list of triangles, a corner [x, y, z, part, r, g, b, span])
function ellipsoid(out, c, r, color, part, seg = 8, rings = 6) {
	const at = (i, j) => {
		const v = i / rings * Math.PI, u = j / seg * Math.PI * 2;
		const p = [c[0] + r[0] * Math.sin(v) * Math.cos(u), c[1] + r[1] * Math.cos(v), c[2] + r[2] * Math.sin(v) * Math.sin(u)];
		return [...p, part, ...color(p), 0];
	};
	for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
		const a = at(i, j), b = at(i + 1, j), d = at(i, j + 1), e = at(i + 1, j + 1);
		if (i > 0) out.push([a, b, d]);
		if (i < rings - 1) out.push([d, b, e]);
	}
}
// a body along z: an ellipsoid with its long axis along z (rings round z), so it can be drawn out towards a tail
function lozenge(out, c, r, color, part, seg = 8, rings = 7) {
	const at = (i, j) => {
		const v = i / rings * Math.PI, u = j / seg * Math.PI * 2;
		const p = [c[0] + r[0] * Math.sin(v) * Math.cos(u), c[1] + r[1] * Math.sin(v) * Math.sin(u), c[2] - r[2] * Math.cos(v)];
		return [...p, part, ...color(p), 0];
	};
	for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
		const a = at(i, j), b = at(i + 1, j), d = at(i, j + 1), e = at(i + 1, j + 1);
		if (i > 0) out.push([a, b, d]);
		if (i < rings - 1) out.push([d, b, e]);
	}
}
function tube(out, a, b, ra, rb, color, part, sides = 5) {
	const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], length = Math.hypot(...axis), d = axis.map((v) => v / length);
	const other = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	let u = [d[1] * other[2] - d[2] * other[1], d[2] * other[0] - d[0] * other[2], d[0] * other[1] - d[1] * other[0]];
	const ul = Math.hypot(...u); u = u.map((v) => v / ul);
	const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
	const ring = (c, r) => Array.from({ length: sides }, (_, k) => { const t = k / sides * Math.PI * 2; const p = [0, 1, 2].map((i) => c[i] + (u[i] * Math.cos(t) + w[i] * Math.sin(t)) * r); return [...p, part, ...color(p), 0]; });
	const A = ring(a, ra), B = ring(b, rb), tip = [...b, part, ...color(b), 0];
	for (let k = 0; k < sides; k++) {
		const n = (k + 1) % sides;
		if (rb > 0) out.push([A[k], B[k], B[n]], [A[k], B[n], A[n]]);
		else out.push([A[k], tip, A[n]]);
	}
}
// a flat piece (a fan from its first corner), both ways (nothing is culled); span(p) for a wing's corners
function flat(out, points, color, part, span = () => 0) {
	const corner = (p) => [...p, part, ...color(p), span(p)];
	for (let k = 1; k < points.length - 1; k++) out.push([corner(points[0]), corner(points[k]), corner(points[k + 1])]);
}
// a wing each side: its outline on the right (x > 0) from the shoulder at x0 out to the tip at x0 + reach, mirrored for the left. Two
//		pieces, the inner and the outer, so it bends a little as it beats
function wings(out, outline, x0, reach, color) {
	for (const side of [-1, 1]) {
		const P = outline.map(([x, y, z]) => [x * side, y, z]);
		const span = (p) => side * Math.min(Math.max((Math.abs(p[0]) - x0) / reach, 0), 1);
		const col = (p) => color(p, Math.abs(span(p)));
		// outline: [root front, elbow front, tip, tip back, elbow back, root back]
		flat(out, [P[0], P[1], P[4], P[5]], col, 2, span);
		flat(out, [P[1], P[2], P[3], P[4]], col, 2, span);
	}
}
function legs(out, hip, length, r, color, feet = 0.04) {
	for (const side of [-1, 1]) {
		const top = [hip[0] * side, hip[1], hip[2]], foot = [hip[0] * side, 0.005, hip[2] + 0.01];
		tube(out, top, foot, r, r * 0.8, color, 3, 3);
		flat(out, [foot, [foot[0] - feet * 0.5, 0.004, foot[2] + feet], [foot[0], 0.004, foot[2] + feet * 1.1], [foot[0] + feet * 0.5, 0.004, foot[2] + feet]], color, 3);
	}
}
const rgb = (r, g, b) => () => [r, g, b];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const step = (edge, x) => x >= edge ? 1 : 0;

// THE GULL: a herring gull. White, its back and wings grey, black wing tips, a yellow bill, pink legs. 0.6 long, 1.4 across
function gull() {
	const T = [], white = [0.92, 0.92, 0.9], grey = [0.58, 0.62, 0.66];
	lozenge(T, [0, 0.2, -0.01], [0.075, 0.075, 0.2], (p) => p[1] > 0.235 ? grey : white, 0);
	ellipsoid(T, [0, 0.27, 0.16], [0.045, 0.055, 0.055], rgb(...white), 1);
	ellipsoid(T, [0, 0.31, 0.2], [0.042, 0.042, 0.055], rgb(...white), 1);
	tube(T, [0, 0.305, 0.245], [0, 0.295, 0.315], 0.013, 0, rgb(0.95, 0.8, 0.2), 1, 4);
	flat(T, [[0, 0.215, -0.17], [-0.06, 0.215, -0.24], [0, 0.205, -0.3], [0.06, 0.215, -0.24]], rgb(...white), 0);
	wings(T, [[0.06, 0.24, 0.08], [0.32, 0.245, 0.08], [0.7, 0.24, -0.1], [0.62, 0.24, -0.17], [0.32, 0.24, -0.1], [0.06, 0.24, -0.1]], 0.06, 0.64,
		(p, s) => s > 0.82 ? [0.08, 0.08, 0.09] : grey);
	legs(T, [0.03, 0.14, 0.0], 0.14, 0.008, rgb(0.85, 0.6, 0.55), 0.05);
	return T;
}
// THE OWL: a great horned owl, sitting up. Brown, barred, a paler front, a buff face with yellow eyes, its ear tufts. 0.55 tall
function owl() {
	const T = [], brown = [0.38, 0.29, 0.2], pale = [0.62, 0.54, 0.42];
	const barred = (p) => { const base = p[2] > 0.05 ? pale : brown; return mix(base, [0.17, 0.12, 0.08], step(0.55, Math.sin(p[1] * 95 + p[0] * 20)) * 0.6); };
	ellipsoid(T, [0, 0.24, 0], [0.12, 0.19, 0.11], barred, 0);
	ellipsoid(T, [0, 0.45, 0.015], [0.1, 0.085, 0.09], (p) => p[2] > 0.06 ? [0.66, 0.48, 0.3] : brown, 1);
	for (const s of [-1, 1]) {
		tube(T, [0.055 * s, 0.5, 0.03], [0.075 * s, 0.58, 0.005], 0.022, 0, rgb(0.2, 0.15, 0.1), 1, 3);
		ellipsoid(T, [0.037 * s, 0.465, 0.088], [0.019, 0.019, 0.012], (p) => Math.hypot(p[0] - 0.037 * s, p[1] - 0.465) < 0.008 ? [0.02, 0.02, 0.02] : [1.0, 0.72, 0.08], 1, 6, 4);
	}
	tube(T, [0, 0.44, 0.095], [0, 0.41, 0.115], 0.012, 0, rgb(0.22, 0.2, 0.18), 1, 3);
	// (its wings spread across, the chord upright: tipped forward in the air (TILT) they lie flat)
	wings(T, [[0.1, 0.38, -0.02], [0.34, 0.4, -0.03], [0.6, 0.34, -0.04], [0.58, 0.13, -0.04], [0.34, 0.1, -0.03], [0.1, 0.1, -0.02]], 0.1, 0.5,
		(p, s) => mix(brown, [0.15, 0.11, 0.07], step(0.5, Math.sin(p[0] * 40 + p[1] * 30)) * 0.5));
	flat(T, [[0, 0.1, -0.08], [-0.07, 0.0, -0.12], [0, -0.03, -0.1], [0.07, 0.0, -0.12]], rgb(...brown), 0);
	legs(T, [0.04, 0.08, 0.04], 0.08, 0.02, rgb(0.55, 0.47, 0.36), 0.05);
	return T;
}
// THE MALLARD: the drake green headed, a white collar, a chestnut breast, grey flanks; the hen mottled brown. Both a blue speculum
function mallard(drake) {
	const T = [];
	const hen = (p) => mix([0.5, 0.38, 0.24], [0.27, 0.19, 0.11], step(0.4, Math.sin(p[0] * 70 + p[2] * 55) * Math.sin(p[2] * 40 - p[1] * 60)) * 0.7);
	const body = drake ? (p) => p[2] < -0.14 ? [0.06, 0.06, 0.07] : p[2] > 0.09 ? [0.38, 0.19, 0.11] : p[1] > 0.2 ? [0.42, 0.38, 0.32] : [0.72, 0.72, 0.7] : hen;
	lozenge(T, [0, 0.16, 0], [0.105, 0.075, 0.2], body, 0);
	ellipsoid(T, [0, 0.24, 0.15], [0.045, 0.06, 0.05], drake ? (p) => p[1] < 0.215 ? [0.92, 0.92, 0.9] : [0.04, 0.26, 0.1] : hen, 1);
	ellipsoid(T, [0, 0.29, 0.18], [0.042, 0.042, 0.055], drake ? rgb(0.04, 0.26, 0.1) : (p) => Math.abs(p[1] - 0.295) < 0.006 ? [0.15, 0.1, 0.06] : [0.55, 0.42, 0.28], 1);
	flat(T, [[0, 0.285, 0.22], [-0.022, 0.282, 0.235], [-0.016, 0.268, 0.3], [0.016, 0.268, 0.3], [0.022, 0.282, 0.235]], rgb(...(drake ? [0.85, 0.8, 0.2] : [0.75, 0.5, 0.2])), 1);
	flat(T, [[0, 0.18, -0.17], [-0.045, 0.18, -0.22], [0, 0.19, -0.27], [0.045, 0.18, -0.22]], drake ? rgb(0.06, 0.06, 0.07) : hen, 0);
	wings(T, [[0.08, 0.2, 0.08], [0.24, 0.205, 0.07], [0.45, 0.2, -0.06], [0.4, 0.2, -0.12], [0.24, 0.2, -0.1], [0.08, 0.2, -0.09]], 0.08, 0.37,
		(p, s) => s > 0.25 && s < 0.55 && p[2] < -0.05 ? [0.12, 0.18, 0.62] : drake ? [0.42, 0.4, 0.36] : [0.46, 0.35, 0.22]);
	legs(T, [0.04, 0.1, -0.03], 0.1, 0.009, rgb(0.95, 0.5, 0.15), 0.05);
	return T;
}
// THE LOON: a common loon. Black, its back checked white, a white striped collar, a black dagger of a bill, sitting low in the water
function loon() {
	const T = [], black = [0.04, 0.05, 0.05], white = [0.88, 0.88, 0.86];
	const back = (p) => p[1] < 0.12 ? white : step(0.55, Math.sin(p[0] * 120) * Math.sin(p[2] * 90)) ? white : black;
	lozenge(T, [0, 0.15, 0], [0.12, 0.075, 0.3], back, 0);
	ellipsoid(T, [0, 0.23, 0.23], [0.05, 0.075, 0.055], (p) => Math.abs(p[1] - 0.235) < 0.018 && step(0.3, Math.sin(p[1] * 900)) ? white : black, 1);
	ellipsoid(T, [0, 0.3, 0.28], [0.048, 0.048, 0.07], (p) => Math.hypot(Math.abs(p[0]) - 0.03, p[1] - 0.31, p[2] - 0.32) < 0.01 ? [0.7, 0.05, 0.04] : [0.03, 0.07, 0.05], 1);
	tube(T, [0, 0.295, 0.34], [0, 0.285, 0.45], 0.016, 0, rgb(...black), 1, 4);
	wings(T, [[0.1, 0.19, 0.12], [0.33, 0.2, 0.1], [0.66, 0.19, -0.08], [0.6, 0.19, -0.16], [0.33, 0.19, -0.1], [0.1, 0.19, -0.1]], 0.1, 0.56, rgb(...black));
	legs(T, [0.05, 0.1, -0.24], 0.1, 0.012, rgb(...black), 0.07);
	return T;
}
// THE SWAN: a trumpeter swan. White, a long neck held up in an S, a black bill. 1.5 long
function swan() {
	const T = [], white = [0.94, 0.94, 0.92];
	lozenge(T, [0, 0.3, 0], [0.24, 0.16, 0.48], (p) => p[1] > 0.38 && p[2] < 0.1 ? [0.9, 0.9, 0.88] : white, 0, 10, 8);
	const neck = [[0, 0.36, 0.36], [0, 0.5, 0.48], [0, 0.66, 0.47], [0, 0.8, 0.43], [0, 0.9, 0.47]];
	for (let k = 0; k < neck.length - 1; k++) tube(T, neck[k], neck[k + 1], 0.06 - k * 0.006, 0.054 - k * 0.006, rgb(...white), 1, 6);
	ellipsoid(T, [0, 0.92, 0.51], [0.045, 0.045, 0.075], rgb(...white), 1);
	tube(T, [0, 0.91, 0.56], [0, 0.88, 0.7], 0.028, 0.008, rgb(0.05, 0.05, 0.05), 1, 4);
	flat(T, [[0, 0.32, -0.45], [-0.09, 0.33, -0.5], [0, 0.34, -0.6], [0.09, 0.33, -0.5]], rgb(...white), 0);
	wings(T, [[0.18, 0.38, 0.22], [0.55, 0.39, 0.2], [1.15, 0.38, -0.12], [1.05, 0.38, -0.3], [0.55, 0.38, -0.25], [0.18, 0.38, -0.25]], 0.18, 0.97, rgb(...white));
	legs(T, [0.08, 0.2, -0.05], 0.2, 0.02, rgb(0.06, 0.06, 0.06), 0.12);
	return T;
}
// THE WILD TURKEY: the tom bronze, barred wings, a bare blue and red head, a red wattle, his tail a fan he raises; the hen smaller (drawn
//		so), duller, her head grey blue
function turkey(tom) {
	const T = [];
	const bronze = (p) => mix(tom ? [0.22, 0.16, 0.1] : [0.36, 0.28, 0.18], tom ? [0.42, 0.32, 0.16] : [0.2, 0.15, 0.1], step(0.3, Math.sin(p[2] * 45 + p[1] * 20)) * 0.6);
	lozenge(T, [0, 0.55, 0], [0.19, 0.21, 0.32], bronze, 0, 10, 8);
	tube(T, [0, 0.62, 0.24], [0, 0.84, 0.32], 0.055, 0.03, tom ? (p) => p[1] < 0.72 ? [0.22, 0.16, 0.1] : [0.55, 0.62, 0.78] : rgb(0.45, 0.48, 0.55), 1, 5);
	ellipsoid(T, [0, 0.87, 0.35], [0.034, 0.04, 0.05], tom ? rgb(0.72, 0.8, 0.92) : rgb(0.5, 0.52, 0.58), 1);
	if (tom) ellipsoid(T, [0, 0.8, 0.355], [0.02, 0.05, 0.025], rgb(0.72, 0.08, 0.07), 1, 6, 4);
	tube(T, [0, 0.87, 0.39], [0, 0.85, 0.43], 0.012, 0, rgb(0.6, 0.55, 0.4), 1, 3);
	if (tom) tube(T, [0, 0.89, 0.38], [0, 0.82, 0.42], 0.008, 0.004, rgb(0.72, 0.08, 0.07), 1, 3);
	// the tail: a tom's a fan lying back (raised when he struts: part 4), a hen's short
	const base = [0, 0.6, -0.28], n = 9, reach = tom ? 0.48 : 0.3;
	for (let k = 0; k < n; k++) {
		const a0 = (k / n - 0.5) * 2.6, a1 = ((k + 1) / n - 0.5) * 2.6;
		const tip = (a) => [base[0] + Math.sin(a) * reach, base[1] - 0.12, base[2] - Math.cos(a) * reach];
		flat(T, [base, tip(a0), tip(a1)], (p) => { const r = Math.hypot(p[0] - base[0], p[2] - base[2]) / reach; return r > 0.85 ? [0.62, 0.48, 0.32] : r > 0.75 ? [0.06, 0.05, 0.04] : [0.3, 0.21, 0.12]; }, tom ? 4 : 0);
	}
	wings(T, [[0.17, 0.62, 0.12], [0.4, 0.63, 0.1], [0.72, 0.6, -0.12], [0.66, 0.6, -0.26], [0.4, 0.6, -0.2], [0.17, 0.6, -0.2]], 0.17, 0.55,
		(p, s) => mix([0.3, 0.22, 0.14], [0.85, 0.83, 0.8], step(0.6, Math.sin(p[0] * 55)) * (s > 0.4 ? 1 : 0)));
	legs(T, [0.08, 0.4, 0.0], 0.4, 0.022, rgb(0.72, 0.42, 0.36), 0.1);
	return T;
}

// THE HAWK (the inspection's: a red-tailed hawk in the air): brown above, its breast pale and streaked, its tail rufous, its bill hooked
function hawk() {
	const T = [], brown = [0.36, 0.25, 0.16], pale = [0.82, 0.76, 0.66];
	lozenge(T, [0, 0, 0], [0.055, 0.05, 0.16], (p) => p[1] > 0.005 ? brown : mix(pale, brown, step(0.6, Math.sin(p[2] * 120 + p[0] * 60)) * 0.5), 0);
	ellipsoid(T, [0, 0.015, 0.17], [0.04, 0.04, 0.05], (p) => p[1] > 0.02 ? brown : pale, 1);
	tube(T, [0, 0.015, 0.215], [0, -0.005, 0.245], 0.012, 0, rgb(0.22, 0.2, 0.18), 1, 4);
	flat(T, [[0, 0, -0.12], [-0.07, 0, -0.3], [0, 0, -0.32], [0.07, 0, -0.3]], rgb(0.62, 0.3, 0.16), 0);
	wings(T, [[0.05, 0.02, 0.08], [0.22, 0.02, 0.09], [0.5, 0.02, 0.02], [0.46, 0.02, -0.08], [0.22, 0.02, -0.08], [0.05, 0.02, -0.07]], 0.05, 0.45,
		(p, s) => s > 0.85 ? [0.12, 0.1, 0.08] : mix(brown, pale, step(0.5, Math.sin(p[0] * 70)) * 0.25));
	return T;
}
// THE GOOSE (the inspection's: a Canada goose in the air, its neck out in front): grey brown, a pale breast, the neck and head black, a
//		white chin strap, white under the tail
function goose() {
	const T = [], body = [0.45, 0.4, 0.34], black = [0.05, 0.05, 0.05];
	lozenge(T, [0, 0, -0.03], [0.07, 0.065, 0.2], (p) => p[2] < -0.18 && p[1] < 0 ? [0.9, 0.9, 0.88] : p[2] > 0.08 && p[1] < 0.01 ? [0.72, 0.68, 0.6] : body, 0);
	tube(T, [0, 0.015, 0.13], [0, 0.03, 0.4], 0.032, 0.026, rgb(...black), 1, 5);
	ellipsoid(T, [0, 0.03, 0.44], [0.03, 0.032, 0.05], (p) => p[1] < 0.035 && p[2] < 0.47 && Math.abs(p[0]) > 0.012 ? [0.92, 0.92, 0.9] : black, 1);
	tube(T, [0, 0.025, 0.485], [0, 0.02, 0.53], 0.014, 0.004, rgb(...black), 1, 4);
	flat(T, [[0, 0.01, -0.2], [-0.05, 0.01, -0.27], [0, 0.01, -0.3], [0.05, 0.01, -0.27]], rgb(0.1, 0.09, 0.08), 0);
	wings(T, [[0.05, 0.02, 0.07], [0.26, 0.02, 0.06], [0.5, 0.02, 0.01], [0.46, 0.02, -0.06], [0.25, 0.02, -0.08], [0.05, 0.02, -0.07]], 0.05, 0.45,
		(p, s) => s > 0.8 ? [0.2, 0.18, 0.16] : body);
	return T;
}

export const BIRD_KINDS = [
	{ name: 'gull', mesh: gull, size: 1.25, SHOULDER: [0.06, 0.24, 0.0], FOLD: [0, 0.02, -1, 0.3], TILT: 0, MIDDLE: [0, 0.2, 0], NECK: [0, 0.24, 0.12], DOWN: 0.9, TAIL: [0, 0, 0], HIP: [0.14, 0.0], FLOAT: 0.13, HITS: [[0, 0.2, 0, 0.11], [0, 0.3, 0.19, 0.06]] },
	{ name: 'owl', mesh: owl, size: 1.15, SHOULDER: [0.1, 0.36, -0.02], FOLD: [0, -0.85, -0.25, 0.26], TILT: 1.2, MIDDLE: [0, 0.25, 0], NECK: [0, 0.38, 0.0], DOWN: 0.4, TAIL: [0, 0, 0], HIP: [0.08, 0.04], FLOAT: 0, HITS: [[0, 0.24, 0, 0.15], [0, 0.45, 0.02, 0.1]] },
	{ name: 'mallard drake', mesh: () => mallard(true), size: 1.15, SHOULDER: [0.08, 0.2, 0.0], FOLD: [0, 0.03, -1, 0.22], TILT: 0, MIDDLE: [0, 0.16, 0], NECK: [0, 0.21, 0.12], DOWN: 1.4, TAIL: [0, 0, 0], HIP: [0.1, -0.03], FLOAT: 0.12, HITS: [[0, 0.16, 0, 0.12], [0, 0.28, 0.17, 0.05]] },
	{ name: 'mallard hen', mesh: () => mallard(false), size: 1.1, SHOULDER: [0.08, 0.2, 0.0], FOLD: [0, 0.03, -1, 0.22], TILT: 0, MIDDLE: [0, 0.16, 0], NECK: [0, 0.21, 0.12], DOWN: 1.4, TAIL: [0, 0, 0], HIP: [0.1, -0.03], FLOAT: 0.12, HITS: [[0, 0.16, 0, 0.12], [0, 0.28, 0.17, 0.05]] },
	{ name: 'loon', mesh: loon, size: 1.1, SHOULDER: [0.1, 0.19, 0.0], FOLD: [0, 0.03, -1, 0.3], TILT: 0, MIDDLE: [0, 0.15, 0], NECK: [0, 0.2, 0.2], DOWN: 0.8, TAIL: [0, 0, 0], HIP: [0.1, -0.24], FLOAT: 0.16, HITS: [[0, 0.15, 0, 0.15], [0, 0.29, 0.28, 0.06]] },
	{ name: 'swan', mesh: swan, size: 1.0, SHOULDER: [0.18, 0.38, 0.0], FOLD: [0, 0.06, -1, 0.5], TILT: 0, MIDDLE: [0, 0.3, 0], NECK: [0, 0.36, 0.34], DOWN: 1.7, TAIL: [0, 0, 0], HIP: [0.2, -0.05], FLOAT: 0.24, HITS: [[0, 0.3, 0, 0.3], [0, 0.85, 0.47, 0.09]] },
	{ name: 'turkey tom', mesh: () => turkey(true), size: 1.0, SHOULDER: [0.17, 0.62, 0.0], FOLD: [0, 0.02, -1, 0.42], TILT: 0.15, MIDDLE: [0, 0.55, 0], NECK: [0, 0.62, 0.22], DOWN: 1.3, TAIL: [0, 0.6, -0.28], HIP: [0.4, 0.0], FLOAT: 0, HITS: [[0, 0.55, 0, 0.26], [0, 0.85, 0.34, 0.07]] },
	{ name: 'turkey hen', mesh: () => turkey(false), size: 0.8, SHOULDER: [0.17, 0.62, 0.0], FOLD: [0, 0.02, -1, 0.42], TILT: 0.15, MIDDLE: [0, 0.55, 0], NECK: [0, 0.62, 0.22], DOWN: 1.3, TAIL: [0, 0.6, -0.28], HIP: [0.4, 0.0], FLOAT: 0, HITS: [[0, 0.55, 0, 0.26], [0, 0.85, 0.34, 0.07]] },
	// (and two only for the inspection, inspect.js: a hawk and a goose as birds.js and geese.js have them, in the air, a wingspan of 1, the
	//		body at the middle. Their hitboxes are those files' (HITS here: the body and the head, for anatomy.js))
	{ name: 'hawk', mesh: hawk, size: 1, inspectOnly: true, SHOULDER: [0.05, 0.02, 0.0], FOLD: [0, 0, -1, 0.2], TILT: 0, MIDDLE: [0, 0, 0], NECK: [0, 0, 0.12], DOWN: 0, TAIL: [0, 0, 0], HIP: [0, 0], FLOAT: 0, HITS: [[0, 0, 0.02, 0.08], [0, 0.015, 0.17, 0.045]] },
	{ name: 'goose', mesh: goose, size: 1, inspectOnly: true, SHOULDER: [0.05, 0.02, 0.0], FOLD: [0, 0, -1, 0.2], TILT: 0, MIDDLE: [0, 0, 0], NECK: [0, 0, 0.12], DOWN: 0, TAIL: [0, 0, 0], HIP: [0, 0], FLOAT: 0, HITS: [[0, 0, -0.05, 0.09], [0, 0.02, 0.45, 0.045]] },
];
export const GULL = 0, OWL = 1, DRAKE = 2, HEN = 3, LOON = 4, SWAN = 5, TOM = 6, TURKEY_HEN = 7, HAWK = 8, GOOSE = 9;
export const BIRD_FLOATS = 8;	// a corner: [x, y, z, part, r, g, b, span]

// every kind's mesh one after another in one buffer, and where each is in it: { data, ranges: [[first vertex, vertices], ...] }
export const BIRD_MESHES = (() => {
	const data = [], ranges = [];
	for (const K of BIRD_KINDS) {
		const first = data.length / BIRD_FLOATS;
		for (const triangle of K.mesh()) for (const corner of triangle) data.push(...corner);
		ranges.push([first, data.length / BIRD_FLOATS - first]);
	}
	return { data: new Float32Array(data), ranges };
})();
