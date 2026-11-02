import * as vm from './viewmodel.js'

/*
	THE MODELS OF THE WORK a player does in the Survival mode, drawn by props.js: in metres, standing on y = 0.
		iceTile						a square of the ponds' ice, a unit across (ice.js)
		oreSmall, oreMid, oreBig	a vein of iron ore (mining.js), rock lumps stuck with ore, each under 500 triangles
		mushroom					a few in a clump (mining.js), under 90
		smelter, smelterFire		a stone bloomery (stations.js), under 500; its fire door, lit
		anvil						on its stump, under 300
		cauldron					on its tripod, the fire under it being its own (a campfire's models), under 300
		mortar						a mortar and pestle on a table, under 400
		chest						(a big one is the same scaled up)
		farmBed, wheat1 to wheat4	the raised dirt, and the wheat on it at each stage (farms.js), each under 200
		stake, twine				a foundation's marks (cabins.js): twine a unit long along z
		THE CABIN (cabins.js), after a Nordic cabin of dark boards and battens under a green metal roof. A wall piece is a cube's width (CUBE across, CUBE_UP high), x either side of 0, its foot on y = 0,
		outside towards +z. Each has an outside and an inside, which are drawn apart (the inside as indoors: props.js has no shadows, and the sun must not come in):
		wallOut/In, windowOut/In, doorOut/In, gapIn (an opening through to a room built on)
		roofOut, roofIn				one slope, a unit each way: its eave along x at y = 0, z = 0, up to its ridge at y = 1, z = 1. Scaled to fit
		gableOut, gableIn			the wall up under a roof's end, a unit across and a unit high. Scaled to fit
		floorTile, block, plank, ridge, dormer, porch, hearth	a floor (a unit square), a block of stone (a unit, its foot on y = 0), a board, the ridge's cap, a window in the roof, the posts of a porch, a fireplace
*/
export const CUBE = 4, CUBE_UP = 3;		// metres
const ICE = 86, ORE_ROCK = 88, ORE = 89, SOIL = 90, WHEAT_GREEN = 91, WHEAT_GOLD = 92, CAST_IRON = 93, FIRE_STONE = 94, CAP = 95, STEM = 96, WALL = 97, ROOF = 98, WINDOW = 99, TWINE = 100, STAKE = 101,
	INNER = 103, FLOOR = 104, PLINTH = 105, SOOT = 106, EMBER = 107, BOARDS = 30, LEATHER = 42;

function box(m, x0, x1, y0, y1, z0, z1, material, part = 0) {
	const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
	for (const [a, b, d, e] of [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]) m.quad(c[a], c[b], c[d], c[e], part, material);
}
// a lump of rock: rings of corners, each pushed in and out by a rule of its own
function lump(m, [cx, cy, cz], [rx, ry, rz], seed, material, rings = 4, sides = 7) {
	const out = [];
	for (let i = 0; i < rings; i++) {
		const t = (i + 0.5) / rings, y = t * 2 - 1, s = Math.sqrt(Math.max(1 - y * y, 0.02));
		out.push(Array.from({ length: sides }, (_, k) => {
			const a = k / sides * Math.PI * 2, w = 1 + 0.22 * Math.sin(seed * 3.1 + a * 3 + i * 2.1) + 0.14 * Math.sin(seed * 7.7 + a * 5 - i);
			return [cx + Math.cos(a) * rx * s * w, cy + y * ry * (1 + 0.1 * Math.sin(seed + a * 2)), cz + Math.sin(a) * rz * s * w];
		}));
	}
	m.loft(out, material, 0, [0, 1]);
}
const chunk = (m, c, r, material) => { const p = [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]].map(([x, y, z]) => [c[0] + x, c[1] + y, c[2] + z]); for (const [a, b, d] of [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]]) m.tri(p[a], p[b], p[d], 0, material); };

function iceTile() { const m = vm.meshBuilder(); m.quad([-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], 0, ICE); return m; }

function vein(lumps, chunks, reach, seed) {
	const m = vm.meshBuilder();
	lumps.forEach(([c, r], k) => lump(m, c, r, seed + k * 1.7, ORE_ROCK));
	for (let k = 0; k < chunks; k++) {
		const [c, r] = lumps[k % lumps.length], a = seed * 11 + k * 2.4, b = Math.sin(seed * 5 + k * 1.3) * 0.5 + 0.55;
		chunk(m, [c[0] + Math.cos(a) * r[0] * 0.92 * Math.cos(b - 0.5), c[1] + Math.sin(b) * r[1] * 0.9, c[2] + Math.sin(a) * r[2] * 0.92 * Math.cos(b - 0.5)], reach * (0.05 + 0.025 * Math.sin(k * 3.7) + 0.025), ORE);
	}
	return m;
}
const oreSmall = () => vein([[[0, 0.18, 0], [0.5, 0.36, 0.42]], [[0.34, 0.08, 0.16], [0.26, 0.2, 0.24]]], 6, 1, 2.1);
const oreMid = () => vein([[[0, 0.3, 0], [0.8, 0.6, 0.68]], [[0.6, 0.14, 0.26], [0.42, 0.32, 0.4]], [[-0.55, 0.12, -0.3], [0.4, 0.28, 0.36]]], 13, 1.5, 4.3);
const oreBig = () => vein([[[0, 0.5, 0], [1.25, 0.95, 1.05]], [[1.0, 0.24, 0.3], [0.66, 0.5, 0.6]], [[-0.9, 0.22, -0.4], [0.62, 0.46, 0.55]], [[0.2, 0.2, 1.0], [0.55, 0.36, 0.45]], [[-0.25, 1.1, -0.1], [0.5, 0.42, 0.45]]], 21, 2.1, 7.9);

function mushroom() {
	const m = vm.meshBuilder();
	for (const [x, z, h, r] of [[0, 0, 0.1, 0.055], [0.075, 0.035, 0.065, 0.04], [-0.05, 0.06, 0.05, 0.03]]) {
		m.loft([[[x - h * 0.15, 0, z], [x + h * 0.15, 0, z], [x, 0, z + h * 0.15]], [[x - h * 0.13, h, z], [x + h * 0.13, h, z], [x, h, z + h * 0.13]]], STEM);
		const ring = (y, s) => Array.from({ length: 5 }, (_, k) => { const a = k / 5 * Math.PI * 2; return [x + Math.cos(a) * r * s, y, z + Math.sin(a) * r * s]; });
		m.loft([ring(h * 0.92, 1), ring(h * 1.2, 0.72), ring(h * 1.42, 0.08)], CAP, 0, [0]);
	}
	return m;
}

function smelter() {
	const m = vm.meshBuilder(), sides = 8;
	const ring = (y, r) => Array.from({ length: sides }, (_, k) => { const a = (k + 0.5) / sides * Math.PI * 2, w = 1 + 0.03 * Math.sin(k * 2.3 + y * 7); return [Math.cos(a) * r * w, y, Math.sin(a) * r * w]; });
	// the stack, fat at the foot, its mouth open at the top. The front (+z) left open for the door
	m.loft([ring(0, 0.72), ring(0.34, 0.72)], FIRE_STONE, 0, [], [1]);
	m.loft([ring(0.34, 0.72), ring(0.72, 0.66), ring(1.2, 0.5), ring(1.62, 0.4)], FIRE_STONE);
	m.loft([ring(1.62, 0.4), ring(1.68, 0.44), ring(1.72, 0.32), ring(1.2, 0.22)], SOOT);
	// bands of iron
	for (const [y, r] of [[0.76, 0.665], [1.26, 0.495]]) m.loft([ring(y, r + 0.015), ring(y + 0.05, r + 0.012)], CAST_IRON);
	// the fire door: an arch of stones, and its sooted hollow
	box(m, -0.34, -0.25, 0, 0.42, 0.56, 0.78, FIRE_STONE);
	box(m, 0.25, 0.34, 0, 0.42, 0.56, 0.78, FIRE_STONE);
	box(m, -0.36, 0.36, 0.42, 0.52, 0.54, 0.8, FIRE_STONE);
	m.quad([-0.25, 0.01, 0.6], [0.25, 0.01, 0.6], [0.25, 0.42, 0.6], [-0.25, 0.42, 0.6], 0, SOOT);
	// logs in the door
	m.strut([-0.18, 0.08, 0.62], [0.18, 0.08, 0.74], 0.045, 0.045, 5, BOARDS);
	m.strut([0.16, 0.14, 0.6], [-0.15, 0.13, 0.72], 0.04, 0.04, 5, BOARDS);
	// the tap and the trough on its right, where the bars come out
	box(m, 0.62, 0.8, 0.2, 0.3, -0.1, 0.1, CAST_IRON);
	box(m, 0.8, 1.32, 0, 0.18, -0.24, 0.24, FIRE_STONE);
	m.quad([0.84, 0.181, -0.2], [1.28, 0.181, -0.2], [1.28, 0.181, 0.2], [0.84, 0.181, 0.2], 0, SOOT);
	// stones heaped round its foot
	for (const [x, z, r, s] of [[-0.75, 0.2, 0.17, 1.1], [-0.6, -0.5, 0.19, 2.3], [0.1, -0.78, 0.15, 3.7], [0.62, 0.52, 0.14, 4.1]]) lump(m, [x, r * 0.5, z], [r, r * 0.8, r], s, FIRE_STONE, 3, 5);
	return m;
}
function smelterFire() { const m = vm.meshBuilder(); m.quad([-0.24, 0.02, 0.61], [0.24, 0.02, 0.61], [0.22, 0.4, 0.61], [-0.22, 0.4, 0.61], 0, EMBER); m.quad([0.3, 1.69, -0.3], [0.3, 1.69, 0.3], [-0.3, 1.69, 0.3], [-0.3, 1.69, -0.3], 0, EMBER); return m; }

function anvil() {
	const m = vm.meshBuilder();
	// the stump
	const ring = (y, r) => Array.from({ length: 9 }, (_, k) => { const a = k / 9 * Math.PI * 2; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
	m.loft([ring(0, 0.34), ring(0.06, 0.29), ring(0.5, 0.27)], BOARDS, 0, [1]);
	// the anvil along x: foot, waist, face, and the horn out to +x
	m.loft([[[-0.26, 0.5, -0.17], [0.26, 0.5, -0.17], [0.26, 0.5, 0.17], [-0.26, 0.5, 0.17]], [[-0.21, 0.56, -0.13], [0.21, 0.56, -0.13], [0.21, 0.56, 0.13], [-0.21, 0.56, 0.13]], [[-0.12, 0.66, -0.07], [0.12, 0.66, -0.07], [0.12, 0.66, 0.07], [-0.12, 0.66, 0.07]], [[-0.17, 0.72, -0.09], [0.17, 0.72, -0.09], [0.17, 0.72, 0.09], [-0.17, 0.72, 0.09]], [[-0.3, 0.76, -0.1], [0.24, 0.76, -0.1], [0.24, 0.76, 0.1], [-0.3, 0.76, 0.1]], [[-0.33, 0.83, -0.105], [0.25, 0.83, -0.105], [0.25, 0.83, 0.105], [-0.33, 0.83, 0.105]]], CAST_IRON, 0, [0, 1]);
	const horn = (x, h, w) => { const y = 0.83 - h; return [[x, y, -w], [x, y, w], [x, 0.83, w], [x, 0.83, -w]]; };
	m.loft([horn(0.25, 0.09, 0.09), horn(0.36, 0.065, 0.06), horn(0.46, 0.035, 0.03), horn(0.52, 0.006, 0.006)], CAST_IRON, 0, [1]);
	// a hammer lying on it
	m.strut([-0.22, 0.85, 0.02], [0.08, 0.85, 0.12], 0.012, 0.012, 5, BOARDS);
	box(m, -0.27, -0.19, 0.83, 0.89, -0.03, 0.07, CAST_IRON);
	return m;
}
function cauldron() {
	const m = vm.meshBuilder(), S = 10;
	const ring = (y, r) => Array.from({ length: S }, (_, k) => { const a = k / S * Math.PI * 2; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
	m.loft([ring(0.42, 0.06), ring(0.46, 0.2), ring(0.58, 0.31), ring(0.74, 0.33), ring(0.86, 0.28), ring(0.9, 0.3)], CAST_IRON, 0, [0]);
	m.loft([ring(0.9, 0.3), ring(0.89, 0.25)], CAST_IRON);
	m.quad([-0.25, 0.84, -0.25], [0.25, 0.84, -0.25], [0.25, 0.84, 0.25], [-0.25, 0.84, 0.25], 0, SOOT);
	// the tripod over it, the chain and the bail
	const top = [0, 1.75, 0];
	for (const [x, z] of [[0.75, 0.05], [-0.42, 0.65], [-0.4, -0.66]]) m.strut([x, 0, z], top, 0.03, 0.022, 5, BOARDS);
	m.strut([0, 1.72, 0], [0, 1.15, 0], 0.008, 0.008, 3, CAST_IRON);
	m.strut([0, 1.15, 0], [0.3, 0.9, 0], 0.008, 0.008, 3, CAST_IRON);
	m.strut([0, 1.15, 0], [-0.3, 0.9, 0], 0.008, 0.008, 3, CAST_IRON);
	return m;
}
function mortar() {
	const m = vm.meshBuilder();
	// the table
	box(m, -0.55, 0.55, 0.74, 0.8, -0.38, 0.38, BOARDS);
	for (const [x, z] of [[-0.48, -0.31], [0.48, -0.31], [-0.48, 0.31], [0.48, 0.31]]) box(m, x - 0.035, x + 0.035, 0, 0.74, z - 0.035, z + 0.035, BOARDS);
	box(m, -0.46, 0.46, 0.22, 0.26, -0.29, 0.29, BOARDS);
	// the mortar: a stone bowl, and the pestle in it
	const ring = (y, r, x = -0.1, z = 0.02) => Array.from({ length: 9 }, (_, k) => { const a = k / 9 * Math.PI * 2; return [x + Math.cos(a) * r, y, z + Math.sin(a) * r]; });
	m.loft([ring(0.8, 0.075), ring(0.83, 0.07), ring(0.87, 0.1), ring(0.95, 0.12), ring(0.95, 0.095), ring(0.88, 0.07)], FIRE_STONE, 0, [1]);
	m.strut([-0.1, 0.88, 0.02], [0.03, 1.08, 0.08], 0.03, 0.018, 6, BOARDS);
	// a jar, a bottle, a roll of linen, a bundle of herbs
	const jar = (x, z, r, h, material) => { const R = (y, s) => Array.from({ length: 6 }, (_, k) => { const a = k / 6 * Math.PI * 2; return [x + Math.cos(a) * r * s, y, z + Math.sin(a) * r * s]; }); m.loft([R(0.8, 1), R(0.8 + h * 0.75, 1), R(0.8 + h * 0.85, 0.5), R(0.8 + h, 0.5)], material, 0, [1]); };
	jar(0.26, -0.18, 0.055, 0.2, FIRE_STONE);
	jar(0.38, 0.05, 0.04, 0.24, LEATHER);
	jar(0.2, 0.2, 0.05, 0.12, CAST_IRON);
	m.strut([-0.42, 0.84, -0.2], [-0.24, 0.84, -0.2], 0.04, 0.04, 6, TWINE);
	return m;
}
function chest() {
	const m = vm.meshBuilder();
	box(m, -0.45, 0.45, 0, 0.36, -0.28, 0.28, BOARDS);
	const lid = [[-0.28, 0.36], [0.28, 0.36], [0.22, 0.5], [0, 0.56], [-0.22, 0.5]];
	m.loft([lid.map(([z, y]) => [-0.46, y, z]), lid.map(([z, y]) => [0.46, y, z])], BOARDS, 0, [0, 1]);
	for (const x of [-0.3, 0.3]) box(m, x - 0.025, x + 0.025, 0, 0.37, -0.285, 0.285, CAST_IRON);
	box(m, -0.04, 0.04, 0.28, 0.4, 0.28, 0.3, CAST_IRON);
	return m;
}
function farmBed() {
	const m = vm.meshBuilder(), H = 1.05, T = 0.24;
	m.loft([[[-H, 0, -H], [H, 0, -H], [H, 0, H], [-H, 0, H]], [[-H, T, -H], [H, T, -H], [H, T, H], [-H, T, H]]], BOARDS);
	// the dirt in it, mounded in rows
	for (let k = 0; k < 4; k++) {
		const a = -0.95 + k * 0.475, b = a + 0.475, mid = (a + b) / 2;
		m.quad([-0.97, T - 0.04, a], [0.97, T - 0.04, a], [0.97, T + 0.07, mid], [-0.97, T + 0.07, mid], 0, SOIL);
		m.quad([-0.97, T + 0.07, mid], [0.97, T + 0.07, mid], [0.97, T - 0.04, b], [-0.97, T - 0.04, b], 0, SOIL);
	}
	return m;
}
// the wheat: blades in rows on the mounds (a triangle or two each), and at the last, heads on them
function wheat(height, blades, material, heads) {
	const m = vm.meshBuilder(), Y = 0.26;
	for (let k = 0; k < blades; k++) {
		const r = (n) => { const s = Math.sin((k + 1) * 12.9898 + n * 78.233) * 43758.5453; return s - Math.floor(s); };
		const row = Math.floor(r(1) * 4), x = -0.9 + r(2) * 1.8, z = -0.95 + (row + 0.5) * 0.475 + (r(3) - 0.5) * 0.12, a = r(4) * 6.283, w = 0.02, h = height * (0.8 + 0.4 * r(5));
		const dx = Math.cos(a), dz = Math.sin(a), lean = 0.12 * height * (r(6) - 0.5), top = [x + dx * lean, Y + h, z + dz * lean];
		m.tri([x - dz * w, Y, z + dx * w], [x + dz * w, Y, z - dx * w], top, 0, material);
		if (heads && k % 2 == 0) {
			const s = top, u = [dx * 0.02, 0.1, dz * 0.02];
			m.quad([s[0] - dz * 0.022, s[1] - 0.02, s[2] + dx * 0.022], [s[0] + dz * 0.022, s[1] - 0.02, s[2] - dx * 0.022], [s[0] + u[0] + dz * 0.012, s[1] + u[1], s[2] + u[2] - dx * 0.012], [s[0] + u[0] - dz * 0.012, s[1] + u[1], s[2] + u[2] + dx * 0.012], 0, heads);
		}
	}
	return m;
}
function stake() {
	const m = vm.meshBuilder();
	m.strut([0, 0, 0], [0, 0.95, 0], 0.03, 0.02, 4, STAKE);
	// (its flag)
	m.tri([0, 0.95, 0], [0.26, 0.86, 0.02], [0, 0.76, 0], 0, TWINE);
	return m;
}
function twine() { const m = vm.meshBuilder(); m.strut([0, 0, 0], [0, 0, 1], 0.008, 0.008, 3, TWINE); return m; }

//-------------------------------THE CABIN-------------------------------
const W = CUBE / 2, H = CUBE_UP;
// a face of boards with a hole in it, at z, from x -W to W, y 0 to H
function face(m, z, hole, material) {
	const q = (x0, y0, x1, y1) => { m.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], 0, material); };
	if (!hole) { q(-W, 0, W, H); return; }
	const [hx, hy0, hw, hy1] = hole;
	q(-W, 0, hx - hw, H);
	q(hx + hw, 0, W, H);
	if (hy0 > 0) q(hx - hw, 0, hx + hw, hy0);
	q(hx - hw, hy1, hx + hw, H);
}
// the sides of the hole, through the wall
function reveal(m, z0, z1, [hx, hy0, hw, hy1], material) {
	m.quad([hx - hw, hy0, z0], [hx - hw, hy1, z0], [hx - hw, hy1, z1], [hx - hw, hy0, z1], 0, material);
	m.quad([hx + hw, hy0, z1], [hx + hw, hy1, z1], [hx + hw, hy1, z0], [hx + hw, hy0, z0], 0, material);
	m.quad([hx - hw, hy1, z0], [hx + hw, hy1, z0], [hx + hw, hy1, z1], [hx - hw, hy1, z1], 0, material);
	if (hy0 > 0) m.quad([hx - hw, hy0, z1], [hx + hw, hy0, z1], [hx + hw, hy0, z0], [hx - hw, hy0, z0], 0, material);
}
const FACE = 0.1;
const WINDOW_HOLE = [0, 1.0, 0.72, 2.15], DOOR_HOLE = [0, 0, 0.72, 2.35], GAP_HOLE = [0, 0, 0.9, 2.45];
function outside(hole, frame) {
	const m = vm.meshBuilder();
	face(m, FACE, hole, WALL);
	// the battens, and the sill and head of the wall
	for (let x = -W + 0.25; x < W; x += 0.5) {
		const a = x - 0.03, b = x + 0.03, y1 = H;
		const parts = !hole || x < hole[0] - hole[2] - 0.03 || x > hole[0] + hole[2] + 0.03 ? [[0, y1]] : [[hole[3], y1], ...(hole[1] > 0 ? [[0, hole[1]]] : [])];
		for (const [y0, top] of parts) { m.quad([a, y0, FACE + 0.03], [b, y0, FACE + 0.03], [b, top, FACE + 0.03], [a, top, FACE + 0.03], 0, WALL + 0); m.quad([a, y0, FACE], [a, y0, FACE + 0.03], [a, top, FACE + 0.03], [a, top, FACE], 0, WALL); m.quad([b, y0, FACE + 0.03], [b, y0, FACE], [b, top, FACE], [b, top, FACE + 0.03], 0, WALL); }
	}
	if (hole) {
		reveal(m, FACE + 0.03, -FACE, hole, frame);
		// the frame round it
		const [hx, y0, hw, y1] = hole, t = 0.07;
		box(m, hx - hw - t, hx - hw, y0, y1 + t, FACE, FACE + 0.06, STAKE);
		box(m, hx + hw, hx + hw + t, y0, y1 + t, FACE, FACE + 0.06, STAKE);
		box(m, hx - hw, hx + hw, y1, y1 + t, FACE, FACE + 0.06, STAKE);
	}
	return m;
}
function inside(hole) { const m = vm.meshBuilder(); face(m, -FACE, hole, INNER); if (hole) reveal(m, FACE, -FACE, hole, INNER); return m; }
function windowOut() {
	const m = outside(WINDOW_HOLE, STAKE), [hx, y0, hw, y1] = WINDOW_HOLE;
	// the glass (lit from in the room by night: vf_props.js) and its bars
	m.quad([hx - hw, y0, 0], [hx + hw, y0, 0], [hx + hw, y1, 0], [hx - hw, y1, 0], 0, WINDOW);
	box(m, hx - 0.025, hx + 0.025, y0, y1, 0, 0.03, STAKE);
	box(m, hx - hw, hx + hw, (y0 + y1) / 2 - 0.025, (y0 + y1) / 2 + 0.025, 0, 0.03, STAKE);
	return m;
}
function windowIn() {
	const m = inside(WINDOW_HOLE), [hx, y0, hw, y1] = WINDOW_HOLE;
	m.quad([hx - hw, y0, -0.01], [hx + hw, y0, -0.01], [hx + hw, y1, -0.01], [hx - hw, y1, -0.01], 0, WINDOW);
	return m;
}
function doorIn() {
	const m = inside(DOOR_HOLE), [hx, , hw, y1] = DOOR_HOLE;
	// the door stood open, back against the wall inside
	box(m, hx + hw, hx + hw + 0.05, 0.02, y1, -FACE - hw * 2, -FACE, STAKE);
	box(m, hx + hw - 0.02, hx + hw + 0.07, 1.02, 1.08, -FACE - hw * 2 + 0.05, -FACE - hw * 2 + 0.11, 2);
	return m;
}
function roofPiece(material, ribs) {
	const m = vm.meshBuilder();
	m.quad([-0.5, 0, 0], [0.5, 0, 0], [0.5, 1, 1], [-0.5, 1, 1], 0, material);
	if (ribs) {
		for (let k = 0; k < ribs; k++) {
			const x = -0.5 + (k + 0.5) / ribs, w = 0.007;
			m.quad([x - w, 0.03, 0], [x + w, 0.03, 0], [x + w, 1.03, 1], [x - w, 1.03, 1], 0, material);
			m.quad([x - w, 0, 0], [x - w, 0.03, 0], [x - w, 1.03, 1], [x - w, 1, 1], 0, material);
			m.quad([x + w, 0.03, 0], [x + w, 0, 0], [x + w, 1, 1], [x + w, 1.03, 1], 0, material);
		}
		// the fascia along the eave
		m.quad([-0.5, -0.1, -0.01], [0.5, -0.1, -0.01], [0.5, 0.01, -0.01], [-0.5, 0.01, -0.01], 0, WALL);
	}
	return m;
}
function gable(material, battens) {
	const m = vm.meshBuilder();
	m.tri([-0.5, 0, FACE * 0.02], [0.5, 0, FACE * 0.02], [0, 1, FACE * 0.02], 0, material);
	for (let k = 0; k < battens; k++) {
		const x = -0.5 + (k + 0.5) / battens, top = 1 - Math.abs(x) * 2, w = 0.006;
		m.quad([x - w, 0, 0.012], [x + w, 0, 0.012], [x + w, top, 0.012], [x - w, top, 0.012], 0, material);
	}
	return m;
}
function floorTile() { const m = vm.meshBuilder(); m.quad([-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], 0, FLOOR); return m; }
function block(material) { const m = vm.meshBuilder(); box(m, -0.5, 0.5, 0, 1, -0.5, 0.5, material); return m; }
function ridge() { const m = vm.meshBuilder(); m.loft([[[-0.5, 0, -0.1], [0.5, 0, -0.1], [0.5, 0.06, 0], [-0.5, 0.06, 0]], [[-0.5, 0, 0.1], [0.5, 0, 0.1], [0.5, 0.06, 0], [-0.5, 0.06, 0]]], ROOF); return m; }
// a window in the roof: its face to +z, out of a slope that comes down towards it
function dormer() {
	const m = vm.meshBuilder(), w = 1.25, h = 1.3, d = 1.9, rise = 0.65;
	m.quad([-w, 0, 0], [w, 0, 0], [w, h, 0], [-w, h, 0], 0, WALL);
	m.quad([-w * 0.85, 0.2, 0.01], [w * 0.85, 0.2, 0.01], [w * 0.85, 1.12, 0.01], [-w * 0.85, 1.12, 0.01], 0, WINDOW);
	for (const x of [-w * 0.3, w * 0.3]) box(m, x - 0.03, x + 0.03, 0.2, 1.12, 0.01, 0.04, STAKE);
	box(m, -w * 0.85, w * 0.85, 0.63, 0.69, 0.01, 0.04, STAKE);
	m.tri([-w, h, 0], [w, h, 0], [0, h + rise, 0], 0, WALL);
	for (const s of [-1, 1]) {
		m.tri([s * w, 0, 0], [s * w, h, 0], [s * w, h, -d], 0, WALL);
		m.quad([s * (w + 0.18), h - 0.1, 0.2], [0, h + rise, 0.2], [0, h + rise, -d], [s * (w + 0.18), h - 0.1, -d], 0, ROOF);
	}
	return m;
}
// the porch: its boards, two posts and a beam: a cube's width, out to +z PORCH metres (the roof over it is a roof slope)
export const PORCH = 1.9;
function porch() {
	const m = vm.meshBuilder();
	box(m, -W, W, -0.14, 0, 0, PORCH, FLOOR);
	for (const x of [-W + 0.12, W - 0.12]) box(m, x - 0.07, x + 0.07, 0, 2.55, PORCH - 0.2, PORCH - 0.06, BOARDS);
	box(m, -W, W, 2.45, 2.6, PORCH - 0.2, PORCH - 0.06, BOARDS);
	return m;
}
// a fireplace of stones against a wall (its back to -z), its chimney a block on top of it, up through the roof
function hearth() {
	const m = vm.meshBuilder();
	box(m, -1.0, -0.62, 0, 1.2, -0.45, 0.25, PLINTH);
	box(m, 0.62, 1.0, 0, 1.2, -0.45, 0.25, PLINTH);
	box(m, -1.05, 1.05, 1.2, 1.5, -0.5, 0.3, PLINTH);
	m.quad([-0.62, 0.02, -0.4], [0.62, 0.02, -0.4], [0.62, 1.2, -0.4], [-0.62, 1.2, -0.4], 0, SOOT);
	box(m, -0.62, 0.62, 0.0, 0.05, -0.45, 0.25, PLINTH);
	box(m, -0.75, 0.75, 1.5, 2.3, -0.5, 0.15, PLINTH);
	box(m, -1.1, 1.1, 1.42, 1.5, 0.3, 0.38, BOARDS);
	return m;
}

const MAKERS = { iceTile, oreSmall, oreMid, oreBig, mushroom, smelter, smelterFire, anvil, cauldron, mortar, chest, farmBed,
	wheat1: () => wheat(0.12, 40, WHEAT_GREEN), wheat2: () => wheat(0.32, 70, WHEAT_GREEN), wheat3: () => wheat(0.62, 100, WHEAT_GREEN), wheat4: () => wheat(0.85, 90, WHEAT_GOLD, WHEAT_GOLD), stake, twine,
	wallOut: () => outside(null), wallIn: () => inside(null), windowOut, windowIn, doorOut: () => outside(DOOR_HOLE, STAKE), doorIn, gapIn: () => inside(GAP_HOLE),
	roofOut: () => roofPiece(ROOF, 8), roofIn: () => roofPiece(INNER, 0), gableOut: () => gable(WALL, 8), gableIn: () => gable(INNER, 0), floorTile, block: () => block(PLINTH), plank: () => block(FLOOR), ridge, dormer, porch, hearth };
export const WORK_MESHES = Object.fromEntries(Object.entries(MAKERS).map(([name, make]) => { const m = make(); return [name, { data: m.done(), triangles: m.count() }]; }));
export const workStats = Object.fromEntries(Object.entries(WORK_MESHES).map(([name, mesh]) => [name, mesh.triangles]));
