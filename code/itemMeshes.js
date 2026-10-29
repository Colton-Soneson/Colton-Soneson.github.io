import * as vm from './viewmodel.js'

/*
	THE MODELS of the Survival mode's things (items.js), each made the way the guns are (viewmodel.js: meshBuilder), in metres, and kept
	small: the lighter under 150 triangles, everything else under 300 (MESHES' counts: meshStats). They are drawn in the hands
	(survivalTools.js, survivalMap.js) and lying in the world (props.js). The materials 20 and up are f_itemMaterials.js's.
	A thing held: +z the way it points (a blade's edge, a bottle's neck), +y up; its parts (numbered) move as it is used:
		lighter		0 the case, 1 the lid (on its hinge at the back, +x side), 2 the flame
		hatchet		0 all of it: the handle up +y from the end held (0), the head at the top, the bit's edge towards +z
		map			0 the middle panel, 1 the left (hinged at its edge), 2 the right
		compass		lying face up (+y), its north +z: 0 the case and the lid, 1 the card (turned about y to keep its north to the north)
		tent		pitched, its door to +z, its middle on the ground at 0 (camp.js: TENT, where its attachments stand: SPOTS). Under 600
		stove		standing, its door to +z, its pipe up behind (up through a tent's roof where it stands in one); stoveLit: its fire
					showing. stovePacked: as carried. Under 400
		collector	a canvas funnel on a tripod over a barrel (waterSurface: the water in it, put as high as it is full). collectorPacked:
					as carried. Under 400
		tentBundle	the tent rolled up round its poles, as carried
		watchArm	the dummy's forearm along +z, the watch on top of it face up: 0 all of it, 1 the hour hand, 2 the minute, 3 the second (each
					turned about y, from +z: twelve o'clock)
*/
const BREAD_CRUST = 20, CRUMB = 21, SAUSAGE = 22, GREEN_GLASS = 23, CLEAR_GLASS = 24, PAPER = 25, WOOL = 26, STONE = 27, FLAME = 28, STEEL = 29,
	BOARDS = 30, SACKING = 31, CHARCOAL = 32, LABEL = 33, HANDLE = 34, ROPE = 35, EMBERS = 36, CANVAS = 37, ASH = 38, RAW_MEAT = 39, SEARED = 40,
	DUMMY = 41, LEATHER = 42, INK = 43, ENAMEL = 44;
const BLUED = 1, BRASS = 2, NICKEL = 8, DARK = 9;

function lighter() {
	const m = vm.meshBuilder();
	// the case (12), its lid on its hinge (12), the chimney with its holes as bars (16), the wick (8), the wheel (8), the flame (15)
	m.section(-0.006, [0.019, 0, 0.036], 0.006, [0.019, 0, 0.036], NICKEL, 0, [0, 1]);
	m.section(-0.0062, [0.0192, 0.036, 0.052], 0.0062, [0.0192, 0.036, 0.052], NICKEL, 1, [0, 1]);
	m.tube(0.004, 0.0, -0.002, 0.0045, 0.002, 0.0045, 4, NICKEL, 0, [], 0.5);
	m.strut([-0.006, 0.036, 0], [-0.006, 0.047, 0], 0.0045, 0.0045, 4, NICKEL, 0);
	m.strut([-0.006, 0.047, 0], [-0.006, 0.05, 0], 0.0012, 0.0012, 4, DARK, 0);
	m.strut([0.007, 0.046, -0.003], [0.007, 0.046, 0.003], 0.0035, 0.0035, 4, BLUED, 0);
	m.strut([-0.006, 0.049, 0], [-0.006, 0.07, 0], 0.0055, 0.0002, 5, FLAME, 2);
	return m;
}
function hatchet() {
	const m = vm.meshBuilder();
	// the handle: six sided rings up it, swelling at the end held (60), closed at the bottom
	const rings = [[0, 0.016, 0.012], [0.03, 0.017, 0.013], [0.12, 0.014, 0.011], [0.25, 0.013, 0.01], [0.33, 0.014, 0.011], [0.36, 0.014, 0.011]];
	m.loft(rings.map(([y, a, b]) => Array.from({ length: 6 }, (_, k) => { const t = (k + 0.5) / 6 * Math.PI * 2; return [Math.cos(t) * b, y, Math.sin(t) * a]; })), HANDLE, 0, [0]);
	// the head: the eye round the handle's top, the poll behind (12), the bit out in front, flaring to its edge (28)
	m.section(-0.03, [0.012, 0.325, 0.385], 0.018, [0.012, 0.325, 0.385], BLUED, 0, [0, 1]);
	m.prismX([[0.018, 0.33], [0.06, 0.315], [0.105, 0.29], [0.11, 0.4], [0.06, 0.39], [0.018, 0.38]], -0.008, 0.008, BLUED);
	m.prismX([[0.104, 0.292], [0.112, 0.29], [0.117, 0.402], [0.109, 0.4]], -0.0035, 0.0035, STEEL);
	return m;
}
function knife() {
	const m = vm.meshBuilder();
	m.prismX([[0.0, 0.0], [0.07, 0.0], [0.1, 0.008], [0.07, 0.018], [0.0, 0.018]], -0.0015, 0.0015, STEEL);
	m.section(-0.006, [0.004, -0.004, 0.022], 0.0, [0.004, -0.004, 0.022], BRASS, 0, [0, 1]);
	m.section(-0.1, [0.007, -0.002, 0.018], -0.006, [0.007, -0.001, 0.019], HANDLE, 0, [0, 1]);
	return m;
}
function stone() {
	const m = vm.meshBuilder();
	m.ball([0, 0, 0], 0.03, 6, STONE);
	return m;
}
function bread() {
	const m = vm.meshBuilder();
	// a loaf: rounded rings along it (8 corners), its crust, the cut end its crumb
	const ring = (z, s) => Array.from({ length: 8 }, (_, k) => { const t = (k + 0.5) / 8 * Math.PI * 2; return [Math.cos(t) * 0.06 * s, Math.max(Math.sin(t), -0.55) * 0.045 * s + 0.03, z]; });
	const along = [[-0.12, 0.7], [-0.105, 0.95], [-0.04, 1], [0.04, 1], [0.105, 0.95], [0.12, 0.8]];
	m.loft(along.map(([z, s]) => ring(z, s)), BREAD_CRUST, 0, [0]);
	m.loft([ring(0.12, 0.8), ring(0.12, 0.8)], CRUMB, 0, [1]);
	return m;
}
function sausage() {
	const m = vm.meshBuilder();
	const pts = [[0, 0, -0.07], [0.012, 0.002, -0.03], [0.016, 0.003, 0.015], [0.008, 0.002, 0.06], [-0.006, 0, 0.08]];
	for (let k = 0; k < pts.length - 1; k++) m.strut(pts[k], pts[k + 1], k == 0 ? 0.012 : 0.016, k == pts.length - 2 ? 0.012 : 0.016, 7, SAUSAGE);
	m.ball(pts[0], 0.012, 6, SAUSAGE);
	m.ball(pts[pts.length - 1], 0.012, 6, SAUSAGE);
	return m;
}
// a cut of venison: a slab (its outline in z and y, its thickness in x), raw or seared, the bone through it (44)
function venison(cooked) {
	const m = vm.meshBuilder();
	const outline = [[-0.07, 0.0], [-0.03, -0.035], [0.03, -0.04], [0.075, -0.015], [0.08, 0.02], [0.04, 0.045], [-0.02, 0.05], [-0.065, 0.03]];
	m.prismX(outline, -0.012, 0.012, cooked ? SEARED : RAW_MEAT);
	m.strut([-0.013, 0.0, -0.02], [0.013, 0.0, -0.02], 0.009, 0.009, 6, PAPER);
	return m;
}
// round about y: a ring of corners at y, radius r, from +x round towards +z
const aroundY = (y, r, n, from = 0) => Array.from({ length: n }, (_, k) => { const a = from + k / n * Math.PI * 2; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
// a flat quad on the face (y), from p to q, w wide: both sides
function stroke(m, y, [x0, z0], [x1, z1], w, material, part) {
	const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz), nx = -dz / l * w / 2, nz = dx / l * w / 2;
	const a = [x0 + nx, y, z0 + nz], b = [x1 + nx, y, z1 + nz], c = [x1 - nx, y, z1 - nz], d = [x0 - nx, y, z0 - nz];
	m.quad(a, b, c, d, part, material); m.quad(a, d, c, b, part, material);
}
function compass() {
	const m = vm.meshBuilder();
	const R = 0.028, H = 0.012, face = 0.0108;
	// the case: its side and its bottom (36), the bezel (24), the lid stood open behind (36) and its hinge (8)
	m.loft([aroundY(0, R, 12), aroundY(H, R, 12)], BRASS, 0, [0]);
	m.loft([aroundY(H, R, 12), aroundY(H, R - 0.004, 12)], BRASS, 0);
	const lid = (d) => Array.from({ length: 12 }, (_, k) => { const a = k / 12 * Math.PI * 2; return [Math.cos(a) * R, H + R + Math.sin(a) * R, R + 0.004 + d]; });
	m.loft([lid(0), lid(0.004)], BRASS, 0, [0, 1]);
	m.strut([-0.006, H, R + 0.002], [0.006, H, R + 0.002], 0.003, 0.003, 4, BRASS, 0);
	// the card (12), the ticks round it (32), the needle (8), and N (red), E, S and W on it (about 60)
	const card = aroundY(face, R - 0.004, 12);
	for (let k = 1; k < 11; k++) { m.tri(card[0], card[k], card[k + 1], 1, PAPER); m.tri(card[0], card[k + 1], card[k], 1, PAPER); }
	const y = face + 0.0004, s = 0.0045;
	for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, r0 = k % 2 ? 0.02 : 0.0185; stroke(m, y, [Math.sin(a) * r0, Math.cos(a) * r0], [Math.sin(a) * 0.0225, Math.cos(a) * 0.0225], 0.0008, INK, 1); }
	m.tri([0, y + 0.0003, 0.016], [-0.003, y + 0.0003, 0], [0.003, y + 0.0003, 0], 1, LABEL); m.tri([0, y + 0.0003, 0.016], [0.003, y + 0.0003, 0], [-0.003, y + 0.0003, 0], 1, LABEL);
	m.tri([0, y + 0.0003, -0.016], [0.003, y + 0.0003, 0], [-0.003, y + 0.0003, 0], 1, STEEL); m.tri([0, y + 0.0003, -0.016], [-0.003, y + 0.0003, 0], [0.003, y + 0.0003, 0], 1, STEEL);
	// each in a box -0.5 to 0.5 across and up, its head out towards the rim (theta: where round the card, from +z towards +x)
	const letter = (theta, strokes, material) => {
		const o = [Math.sin(theta), Math.cos(theta)], r = [Math.cos(theta), -Math.sin(theta)], c = [o[0] * 0.0175, o[1] * 0.0175];
		const at = ([u, v]) => [c[0] + (u * r[0] + v * o[0]) * s, c[1] + (u * r[1] + v * o[1]) * s];
		for (const [a, b] of strokes) stroke(m, y, at(a), at(b), 0.0009, material, 1);
	};
	letter(0, [[[-0.4, -0.5], [-0.4, 0.5]], [[-0.4, 0.5], [0.4, -0.5]], [[0.4, -0.5], [0.4, 0.5]]], LABEL);
	letter(Math.PI / 2, [[[-0.35, -0.5], [-0.35, 0.5]], [[-0.35, 0.5], [0.4, 0.5]], [[-0.35, 0], [0.3, 0]], [[-0.35, -0.5], [0.4, -0.5]]], INK);
	letter(Math.PI, [[[0.4, 0.5], [-0.4, 0.5]], [[-0.4, 0.5], [-0.4, 0]], [[-0.4, 0], [0.4, 0]], [[0.4, 0], [0.4, -0.5]], [[0.4, -0.5], [-0.4, -0.5]]], INK);
	letter(-Math.PI / 2, [[[-0.5, 0.5], [-0.25, -0.5]], [[-0.25, -0.5], [0, 0.2]], [[0, 0.2], [0.25, -0.5]], [[0.25, -0.5], [0.5, 0.5]]], INK);
	return m;
}
function watchArm() {
	const m = vm.meshBuilder();
	// the dummy's forearm (16) and its wrist joint (24), the strap round it (16), the case (20) and the face (10), the twelve marks (48), the hands (12)
	m.strut([0, 0, -0.17], [0, 0, 0.04], 0.036, 0.032, 8, DUMMY, 0);
	m.ball([0, 0, 0.05], 0.03, 6, INK, 0);
	m.strut([0, 0, -0.012], [0, 0, 0.012], 0.039, 0.038, 8, LEATHER, 0);
	const top = 0.036, R = 0.021;
	m.loft([aroundY(top, R, 10), aroundY(top + 0.008, R, 10)], BRASS, 0);
	const face = aroundY(top + 0.008, R - 0.002, 10);
	for (let k = 1; k < 9; k++) m.tri(face[0], face[k + 1], face[k], 0, ENAMEL);
	const y = top + 0.0085, z0 = 0;
	for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2, r0 = k % 3 ? 0.0155 : 0.0135; const p = [Math.sin(a) * r0, y, Math.cos(a) * r0], q = [Math.sin(a) * 0.0175, y, Math.cos(a) * 0.0175]; stroke(m, y, [p[0], p[2] + z0], [q[0], q[2] + z0], 0.0012, INK, 0); }
	stroke(m, y + 0.0003, [0, -0.002], [0, 0.009], 0.0016, INK, 1);
	stroke(m, y + 0.0006, [0, -0.002], [0, 0.0145], 0.0011, INK, 2);
	stroke(m, y + 0.0009, [0, -0.003], [0, 0.016], 0.0005, LABEL, 3);
	return m;
}
function smokedFish() {
	const m = vm.meshBuilder();
	m.prismX([[-0.09, 0.0], [-0.06, -0.022], [0.0, -0.028], [0.05, -0.02], [0.075, 0.0], [0.05, 0.02], [0.0, 0.028], [-0.06, 0.022]], -0.011, 0.011, BREAD_CRUST);
	m.prismX([[0.07, 0.0], [0.11, -0.03], [0.115, 0.03]], -0.004, 0.004, CHARCOAL);
	return m;
}
// THE CAMP (camp.js): the tent and its attachments
const TENT_SIZE = { w: 1.3, d: 1.4, wall: 1.3, ridge: 2.7, door: 0.45, doorTop: 2.05, eave: 0.12 };	// (tall enough to walk in under, hat and all)
function tent() {
	const m = vm.meshBuilder();
	const { w: W, d: D, wall: h, ridge: H, door: dw, doorTop: dh, eave: e } = TENT_SIZE;
	const roofAt = (x) => h + (H - h) * (1 - Math.abs(x) / W);
	// the walls (4), the roof, out over the walls at the eaves and the ends (4), the back (3), the floor (2)
	for (const s of [-1, 1]) m.quad([s * W, 0, -D], [s * W, 0, D], [s * W, h, D], [s * W, h, -D], 0, CANVAS);
	const eaveY = h - e * (H - h) / W;
	for (const s of [-1, 1]) m.quad([s * (W + e), eaveY, -D - 0.15], [s * (W + e), eaveY, D + 0.15], [0, H, D + 0.15], [0, H, -D - 0.15], 0, CANVAS);
	m.tri([-W, 0, -D], [W, 0, -D], [W, h, -D], 0, CANVAS); m.tri([-W, 0, -D], [W, h, -D], [0, H, -D], 0, CANVAS); m.tri([-W, 0, -D], [0, H, -D], [-W, h, -D], 0, CANVAS);
	m.quad([-W, 0.07, -D], [W, 0.07, -D], [W, 0.07, D], [-W, 0.07, D], 0, SACKING);		// (the floor, over the grass flattened under it)
	// the front, round the door (10), and its flaps tied back (2)
	for (const s of [-1, 1]) {
		m.quad([s * W, 0, D], [s * dw, 0, D], [s * dw, h, D], [s * W, h, D], 0, CANVAS);
		m.tri([s * W, h, D], [s * dw, h, D], [s * dw, roofAt(dw), D], 0, CANVAS);
		m.tri([s * dw, 0, D + 0.01], [s * dw, dh, D + 0.01], [s * (dw + 0.45), 0.25, D + 0.04], 0, SACKING);
	}
	const top = [[-dw, dh, D], [dw, dh, D], [dw, roofAt(dw), D], [0, H, D], [-dw, roofAt(dw), D]];
	for (let k = 1; k < 4; k++) m.tri(top[0], top[k], top[k + 1], 0, CANVAS);
	// the poles: the ridge, the upright at the back, and at the front one either side of the door up to the roof, out of the way in (48)
	m.strut([0, H + 0.03, -D - 0.25], [0, H + 0.03, D + 0.25], 0.025, 0.025, 6, HANDLE);
	m.strut([0, 0, -D - 0.05], [0, H + 0.08, -D - 0.05], 0.028, 0.025, 6, HANDLE);
	for (const s of [-1, 1]) m.strut([s * (dw + 0.06), 0, D + 0.05], [s * (dw + 0.06), roofAt(dw + 0.06), D + 0.05], 0.028, 0.025, 6, HANDLE);
	// the guy ropes and their pegs: from the ends of the ridge, the corners and the middles of the eaves (8 of each)
	const guy = (from, to) => { m.strut(from, to, 0.006, 0.006, 3, ROPE); m.strut([to[0], -0.06, to[2]], [to[0], 0.14, to[2]], 0.014, 0.012, 4, HANDLE); };
	for (const s of [-1, 1]) {
		if (s < 0) guy([0, H, s * (D + 0.2)], [0, 0.04, s * (D + 1.3)]);		// (from the back of the ridge only: none across the way in)
		for (const z of [-D, 0, D]) guy([s * (W + e), eaveY, z], [s * (W + 0.95), 0.04, z * 1.15]);
	}
	return m;
}
function tentBundle() {
	const m = vm.meshBuilder();
	m.tube(0, 0, -0.42, 0.13, 0.42, 0.13, 10, CANVAS, 0, [0, 1]);
	for (const z of [-0.25, 0.25]) m.tube(0, 0, z - 0.02, 0.135, z + 0.02, 0.135, 10, ROPE);
	for (const [x, y] of [[0.05, 0.04], [-0.04, 0.06], [0.0, -0.05]]) m.strut([x, y, -0.5], [x, y, 0.5], 0.015, 0.015, 4, HANDLE);
	return m;
}
// the stove's body: its legs, the box, the top's lip, the door (with its fire showing, or not)
function stoveBody(m, lit) {
	for (const x of [-0.17, 0.17]) for (const z of [-0.22, 0.22]) m.strut([x, 0, z], [x, 0.2, z], 0.015, 0.015, 4, BLUED);
	m.section(-0.28, [0.2, 0.18, 0.5], 0.28, [0.2, 0.18, 0.5], BLUED, 0, [0, 1]);
	m.section(-0.3, [0.215, 0.5, 0.52], 0.3, [0.215, 0.5, 0.52], DARK, 0, [0, 1]);
	m.section(0.28, [0.11, 0.24, 0.43], 0.295, [0.11, 0.24, 0.43], DARK, 0, [1]);
	if (lit) m.section(0.295, [0.07, 0.27, 0.37], 0.3, [0.07, 0.27, 0.37], EMBERS, 0, [1]);
	m.strut([0.06, 0.335, 0.3], [0.13, 0.335, 0.33], 0.01, 0.01, 4, BRASS);
}
function stoveWithPipe(lit) {
	const m = vm.meshBuilder();
	stoveBody(m, lit);
	m.strut([0.15, 0.5, -0.15], [0.15, 2.9, -0.15], 0.055, 0.055, 8, BLUED);
	m.strut([0.15, 2.9, -0.15], [0.15, 2.98, -0.15], 0.085, 0.07, 8, DARK);
	m.strut([0.15, 2.42, -0.15], [0.15, 2.49, -0.15], 0.11, 0.11, 8, BRASS);
	return m;
}
function stovePacked() { const m = vm.meshBuilder(); stoveBody(m, false); m.strut([-0.12, 0.53, -0.25], [-0.12, 0.53, 0.25], 0.05, 0.05, 6, BLUED); return m; }
// the barrel (with its hoops) the collector stands over, and the collector itself: the tripod and the canvas funnel
function barrel(m) {
	m.loft([aroundY(0, 0.2, 12), aroundY(0.3, 0.23, 12), aroundY(0.6, 0.2, 12)], BOARDS, 0, [0]);
	for (const y of [0.1, 0.5]) m.loft([aroundY(y, y == 0.1 ? 0.215 : 0.215, 12), aroundY(y + 0.035, 0.22, 12)], DARK, 0);
}
function collector() {
	const m = vm.meshBuilder();
	barrel(m);
	for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2 + 0.5; m.strut([Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55], [Math.cos(a) * 0.3, 1.25, Math.sin(a) * 0.3], 0.02, 0.018, 6, HANDLE); }
	m.loft([aroundY(1.2, 0.5, 12), aroundY(0.95, 0.22, 12), aroundY(0.72, 0.07, 12)], CANVAS, 0);
	m.loft([aroundY(1.2, 0.5, 12), aroundY(1.23, 0.51, 12)], ROPE, 0);
	return m;
}
function collectorPacked() {
	const m = vm.meshBuilder();
	barrel(m);
	m.strut([-0.1, 0.6, -0.05], [0.1, 1.0, 0.05], 0.02, 0.02, 4, HANDLE);
	m.loft([aroundY(0.62, 0.21, 10), aroundY(0.8, 0.18, 10)], CANVAS, 0, [1]);
	return m;
}
function waterSurface() {
	const m = vm.meshBuilder();
	const ring = aroundY(0, 0.19, 12);
	for (let k = 1; k < 11; k++) m.tri(ring[0], ring[k], ring[k + 1], 0, CLEAR_GLASS);
	return m;
}
// a bottle, its neck up +y: water (clear, a cork) or beer (green, a label, a cap)
function bottle(beer) {
	const m = vm.meshBuilder();
	const glass = beer ? GREEN_GLASS : CLEAR_GLASS;
	const profile = [[0, 0.03], [0.004, 0.032], [0.13, 0.032], [0.16, 0.022], [0.19, 0.011], [0.225, 0.011]];
	const ring = (y, r) => Array.from({ length: 8 }, (_, k) => { const t = (k + 0.5) / 8 * Math.PI * 2; return [Math.cos(t) * r, y, Math.sin(t) * r]; });
	m.loft(profile.map(([y, r]) => ring(y, r)), glass, 0, [0]);
	if (beer) m.loft([ring(0.05, 0.0328), ring(0.11, 0.0328)], LABEL);
	m.loft([ring(0.225, beer ? 0.012 : 0.0105), ring(0.24, beer ? 0.012 : 0.0105)], beer ? BRASS : HANDLE, 0, [1]);
	return m;
}
function map() {
	const m = vm.meshBuilder();
	// three panels, folded out: the middle (0), the left (1) and the right (2), each hinged at its edge, the paper thin, lying in x, y
	const W = 0.11, H = 0.28;
	m.section(-0.0008, [W, -H / 2, H / 2], 0.0008, [W, -H / 2, H / 2], PAPER, 0, [0, 1]);
	for (const [s, part] of [[-1, 1], [1, 2]]) {
		const x0 = s * W, x1 = s * W * 3;
		m.quad([x0, -H / 2, 0.0005], [x1, -H / 2, 0.0005], [x1, H / 2, 0.0005], [x0, H / 2, 0.0005], part, PAPER);
		m.quad([x0, -H / 2, -0.0005], [x0, H / 2, -0.0005], [x1, H / 2, -0.0005], [x1, -H / 2, -0.0005], part, PAPER);
	}
	return m;
}
function firewood() {
	const m = vm.meshBuilder();
	for (const [x, y] of [[-0.035, 0], [0.035, 0], [0, 0.055]]) m.tube(x, y + 0.03, -0.2, 0.034, 0.2, 0.03, 5, BOARDS, 0, [0, 1]);
	return m;
}
function bedroll() {
	const m = vm.meshBuilder();
	m.tube(0, 0.08, -0.3, 0.08, 0.3, 0.08, 10, WOOL, 0, [0, 1]);
	for (const z of [-0.18, 0.18]) m.tube(0, 0.08, z - 0.015, 0.084, z + 0.015, 0.084, 10, ROPE);
	return m;
}
// a canvas bedroll laid out: the groundsheet, the wool blanket over most of it, its edge turned back, the pillow roll at the head (+z)
function bedrollFlat() {
	const m = vm.meshBuilder();
	m.section(-0.95, [0.42, 0, 0.035], 0.95, [0.42, 0, 0.035], CANVAS, 0, [0, 1]);
	m.section(-0.9, [0.37, 0.035, 0.085], 0.5, [0.37, 0.035, 0.09], WOOL, 0, [0, 1]);
	m.strut([-0.37, 0.095, 0.48], [0.37, 0.095, 0.48], 0.03, 0.03, 6, WOOL);
	m.strut([-0.36, 0.1, 0.75], [0.36, 0.1, 0.75], 0.07, 0.07, 8, CANVAS);
	for (const z of [-0.5, 0.1]) m.section(z - 0.02, [0.425, 0.03, 0.04], z + 0.02, [0.425, 0.03, 0.04], ROPE);
	return m;
}
// THE CAMPFIRE's stages (campfires.js): each in its ring of stones (10, 200 triangles), under 500 all told
function stoneRing(m) {
	for (let k = 0; k < 10; k++) {
		const a = k / 10 * Math.PI * 2 + (k % 3) * 0.05, r = 0.07 + (k % 4) * 0.01;
		m.ball([Math.cos(a) * 0.46, r * 0.55, Math.sin(a) * 0.46], r, 5, STONE);
	}
}
// a mound round the middle: rings out from it, lower and lower (embers, ash)
function mound(m, r, h, material) {
	const ring = (y, s) => Array.from({ length: 8 }, (_, k) => { const t = (k + 0.5) / 8 * Math.PI * 2; return [Math.cos(t) * r * s, y, Math.sin(t) * r * s]; });
	m.loft([ring(0.005, 1), ring(h * 0.6, 0.7), ring(h, 0.3)], material, 0, [1]);
}
// logs leant together over the middle: n of them, how long, how far out their feet are, which way round (turn); burnt: the bottom charcoal
function teepee(m, n, length, out, turn, burnt) {
	for (let k = 0; k < n; k++) {
		const a = k / n * Math.PI * 2 + turn, foot = [Math.cos(a) * out, 0.03, Math.sin(a) * out];
		const top = [Math.cos(a) * 0.04, Math.sqrt(Math.max(length * length - (out - 0.04) ** 2, 0.01)), Math.sin(a) * 0.04];
		if (!burnt) { m.strut(foot, top, 0.04, 0.03, 6, BOARDS); continue; }
		const mid = foot.map((v, i) => v + (top[i] - v) * burnt);
		m.strut(foot, mid, 0.038, 0.034, 5, CHARCOAL);
		m.strut(mid, top, 0.034, 0.028, 5, BOARDS);
	}
}
function campfireFull() {
	const m = vm.meshBuilder();
	stoneRing(m);
	teepee(m, 7, 0.62, 0.32, 0.2, 0.35);
	for (let k = 0; k < 4; k++) { const a = k * 1.6 + 0.4; m.strut([Math.cos(a) * 0.14, 0.02, Math.sin(a) * 0.14], [0, 0.22, 0], 0.012, 0.008, 4, HANDLE); }
	mound(m, 0.3, 0.05, EMBERS);
	return m;
}
function campfireHalf() {
	const m = vm.meshBuilder();
	stoneRing(m);
	teepee(m, 6, 0.42, 0.3, 0.6, 0.6);
	mound(m, 0.32, 0.06, EMBERS);
	return m;
}
function campfireEmbers() {
	const m = vm.meshBuilder();
	stoneRing(m);
	for (let k = 0; k < 4; k++) { const a = k * 1.7 + 0.2; m.strut([Math.cos(a) * 0.3, 0.035, Math.sin(a) * 0.3], [Math.cos(a + 0.4) * 0.06, 0.05, Math.sin(a + 0.4) * 0.06], 0.035, 0.03, 6, CHARCOAL); }
	mound(m, 0.3, 0.07, EMBERS);
	return m;
}
function campfireDead() {
	const m = vm.meshBuilder();
	stoneRing(m);
	mound(m, 0.32, 0.06, ASH);
	for (let k = 0; k < 3; k++) { const a = k * 2.2 + 0.5; m.strut([Math.cos(a) * 0.28, 0.03, Math.sin(a) * 0.28], [Math.cos(a + 0.3) * 0.08, 0.045, Math.sin(a + 0.3) * 0.08], 0.03, 0.025, 6, CHARCOAL); }
	return m;
}
function campfireLaid() {
	const m = vm.meshBuilder();
	stoneRing(m);
	teepee(m, 6, 0.6, 0.3, 0.1, 0);
	for (let k = 0; k < 4; k++) { const a = k * 1.6 + 0.4; m.strut([Math.cos(a) * 0.14, 0.02, Math.sin(a) * 0.14], [0, 0.22, 0], 0.012, 0.008, 4, HANDLE); }
	mound(m, 0.3, 0.03, ASH);
	return m;
}
function crate() {
	const m = vm.meshBuilder();
	// a crate, 0.8 x 0.5 x 0.55, its boards and the battens across them
	m.section(-0.275, [0.4, 0, 0.5], 0.275, [0.4, 0, 0.5], BOARDS, 0, [0, 1]);
	for (const z of [-0.26, 0.26]) m.section(z - 0.025, [0.41, 0.02, 0.48], z + 0.025, [0.41, 0.02, 0.48], HANDLE);
	for (const x of [-0.36, 0.36]) m.prismZ([[x - 0.03, 0.505], [x + 0.03, 0.505], [x + 0.03, 0.52], [x - 0.03, 0.52]], -0.28, 0.28, HANDLE);
	return m;
}
function sack() {
	const m = vm.meshBuilder();
	// a heap of a sack, tied at the top
	const ring = (y, r, sq) => Array.from({ length: 8 }, (_, k) => { const t = (k + 0.5) / 8 * Math.PI * 2; return [Math.cos(t) * r * (1 + sq * Math.cos(2 * t)), y, Math.sin(t) * r]; });
	const rings = [[0, 0.3, 0.2], [0.12, 0.34, 0.15], [0.3, 0.27, 0.08], [0.42, 0.12, 0], [0.46, 0.05, 0], [0.55, 0.09, 0]];
	m.loft(rings.map(([y, r, sq]) => ring(y, r, sq)), SACKING, 0, [0, 1]);
	m.strut([0, 0.43, 0], [0, 0.47, 0], 0.065, 0.065, 6, ROPE);
	return m;
}
function campfire() {
	const m = vm.meshBuilder();
	// a ring of stones (8 boxes, 96), the logs leant together over it (6, 72), the embers under them (12)
	for (let k = 0; k < 8; k++) {
		const a = k / 8 * Math.PI * 2, x = Math.cos(a) * 0.42, z = Math.sin(a) * 0.42, r = 0.08 + (k % 3) * 0.015;
		m.strut([x, 0, z], [x * 1.02, r * 1.4, z * 1.02], r, r * 0.8, 3, STONE);
	}
	for (let k = 0; k < 6; k++) {
		const a = k / 6 * Math.PI * 2 + 0.3;
		m.strut([Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3], [Math.cos(a) * 0.04, 0.42, Math.sin(a) * 0.04], 0.035, 0.022, 4, k % 2 ? CHARCOAL : BOARDS);
	}
	const embers = Array.from({ length: 6 }, (_, k) => { const t = (k + 0.5) / 6 * Math.PI * 2; return [Math.cos(t) * 0.26, 0.015, Math.sin(t) * 0.26]; });
	m.loft([embers, embers], EMBERS, 0, [1]);
	return m;
}

const MAKERS = { tent, tentBundle, stove: () => stoveWithPipe(false), stoveLit: () => stoveWithPipe(true), stovePacked, collector, collectorPacked, waterSurface, compass, watchArm, smokedFish, lighter, hatchet, knife, stone, bread, sausage, venison: () => venison(false), cookedVenison: () => venison(true), water: () => bottle(false), beer: () => bottle(true), map, firewood, bedroll, bedrollFlat, crate, sack, campfire, campfireFull, campfireHalf, campfireEmbers, campfireDead, campfireLaid };
export const MESHES = Object.fromEntries(Object.entries(MAKERS).map(([name, make]) => { const m = make(); return [name, { data: m.done(), triangles: m.count() }]; }));
export const meshStats = Object.fromEntries(Object.entries(MESHES).map(([name, mesh]) => [name, mesh.triangles]));
