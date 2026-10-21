import { BUILDING_TYPES, VARIANTS, variantSize, FLOOR_HEIGHT, GROUND_FLOOR, TOWN_MATERIALS as MAT } from './townLayout.js'
import { seededRandom } from './terrainGenerator.js'

/*
	The houses of the seaside towns, after Koriko in Kiki's Delivery Service: tall plastered houses on stone, steep tiled roofs of red
	and green with dormers and chimneys, shuttered windows with flower boxes, the odd turret, a clock tower over the library.
	Every type (BUILDING_TYPES in townLayout.js) in each of its VARIANTS sizes is a mesh of its own, made here once. In its own space:
	its floor at y = 0, its front (to the street) facing +z, its width along x, its depth along z, both centred on the origin.
	Each is no more than MOST_TRIANGLES. The patterns (the plaster and the stone under it, the tiles, the glazing bars) are the shader's
	(vf_town.js), laid out by each surface's uv in world units, so a wall is two triangles and a window a handful.
	Returns [type][variant] -> { full, plain, height }
		full		all of it
		plain		for far off: the walls, the roofs, the glass and the bigger shapes, without the small things on them (frames, sills,
					shutters, flower boxes, string courses, signs: anything marked small below)
		height		of its walls, for anything that bumps into it

	THE KIT (makeKit): faces of a box (a front, a right side, a back, a left side, each with its own frame: x along it from its left
	end, y up, z out of it), and on a face: windows (glass, frame, sill, shutters, a flower box, an arched head), doors, shop fronts,
	timber framing, string courses. Roofs: gabled, hipped, mansard, cones and domes, with dormers and chimneys.
*/
export const MOST_TRIANGLES = 3000;
const VERTEX_FLOATS = 8;

// A mesh being made: triangles of [x, y, z, material, u, v, height over the foot, world pattern] (see vf_town.js)
export function townMeshBuilder() {
	const data = [];
	const v = (p, material, uv, h, flag) => data.push(p[0], p[1], p[2], material, uv[0], uv[1], h, flag);
	const b = {
		data,
		quad(a, c, d, e, material, uvs, hs = [0, 0, 0, 0], flag = 0) {
			v(a, material, uvs[0], hs[0], flag); v(c, material, uvs[1], hs[1], flag); v(d, material, uvs[2], hs[2], flag);
			v(a, material, uvs[0], hs[0], flag); v(d, material, uvs[2], hs[2], flag); v(e, material, uvs[3], hs[3], flag);
		},
		tri(a, c, d, material, uvs, hs = [0, 0, 0], flag = 0) {
			v(a, material, uvs[0], hs[0], flag); v(c, material, uvs[1], hs[1], flag); v(d, material, uvs[2], hs[2], flag);
		},
		// a vertical face from (ax, az) to (bx, bz), bottom to top at each end. u runs along it from u0, v is the height
		wall(ax, az, bx, bz, a0, a1, b0, b1, material, u0 = 0, foot = Math.min(a0, b0)) {
			const len = Math.hypot(bx - ax, bz - az);
			b.quad([ax, a0, az], [bx, b0, bz], [bx, b1, bz], [ax, a1, az], material, [[u0, a0], [u0 + len, b0], [u0 + len, b1], [u0, a1]], [a0 - foot, b0 - foot, b1 - foot, a1 - foot]);
			return len;
		},
		// a box with its sides along x and z. skip: faces left out, of 'bottom', 'top', '-x', '+x', '-z', '+z'
		box(x0, y0, z0, x1, y1, z1, material, skip = [], topMaterial = material, flag = 0) {
			const h = (y) => y - y0;
			if (!skip.includes('-z')) b.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], material, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], [0, 0, h(y1), h(y1)], flag);
			if (!skip.includes('+z')) b.quad([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], material, [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]], [0, 0, h(y1), h(y1)], flag);
			if (!skip.includes('-x')) b.quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], material, [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]], [0, 0, h(y1), h(y1)], flag);
			if (!skip.includes('+x')) b.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], material, [[z0, y0], [z1, y0], [z1, y1], [z0, y1]], [0, 0, h(y1), h(y1)], flag);
			if (!skip.includes('top')) b.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], topMaterial, [[x0, z0], [x0, z1], [x1, z1], [x1, z0]], [h(y1), h(y1), h(y1), h(y1)], flag);
			if (!skip.includes('bottom')) b.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], material, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], [0, 0, 0, 0], flag);
		},
		triangles() { return data.length / VERTEX_FLOATS / 3; },
		done() { return new Float32Array(data); },
	};
	return b;
}

//-------------------------------THE KIT-------------------------------
function makeKit(seed) {
	const all = townMeshBuilder(), fine = townMeshBuilder();
	const random = seededRandom(seed);
	let T = { x: 0, y: 0, z: 0, a: 0 };
	const stack = [];
	// a point in the frame now into the building's own space
	const tp = (p) => { const c = Math.cos(T.a), s = Math.sin(T.a); return [T.x + c * p[0] + s * p[2], T.y + p[1], T.z - s * p[0] + c * p[2]]; };
	const K = {
		random,
		chance: (p) => random() < p,
		pick: (list) => list[Math.floor(random() * list.length)],
		between: (a, b) => a + (b - a) * random(),
		// into a frame of its own: its origin at (x, y, z) in the one now, turned by yaw (its +x along (cos yaw, -sin yaw))
		push(x, y, z, yaw = 0) { stack.push(T); const o = tp([x, y, z]); T = { x: o[0], y: o[1], z: o[2], a: T.a + yaw }; },
		pop() { T = stack.pop(); },
		quad(a, b, c, d, material, uvs, small = false) { const P = [a, b, c, d].map(tp); (small ? fine : all).quad(P[0], P[1], P[2], P[3], material, uvs, P.map((p) => p[1])); },
		tri(a, b, c, material, uvs, small = false) { const P = [a, b, c].map(tp); (small ? fine : all).tri(P[0], P[1], P[2], material, uvs, P.map((p) => p[1])); },
		// a flat rectangle on the face of the frame (z out of it), from (x0, y0) to (x1, y1), at z
		panel(x0, y0, x1, y1, z, material, small = false) { K.quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], material, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], small); },
		// a box, its sides along the frame's axes. skip as townMeshBuilder's box. small: left out far off
		box(x0, y0, z0, x1, y1, z1, material, { skip = [], top = material, small = false } = {}) {
			const q = (a, b, c, d, m, uvs) => K.quad(a, b, c, d, m, uvs, small);
			if (!skip.includes('-z')) q([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], material, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
			if (!skip.includes('+z')) q([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], material, [[-x1, y0], [-x0, y0], [-x0, y1], [-x1, y1]]);
			if (!skip.includes('-x')) q([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], material, [[-z1, y0], [-z0, y0], [-z0, y1], [-z1, y1]]);
			if (!skip.includes('+x')) q([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], material, [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]);
			if (!skip.includes('top')) q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], top, [[x0, z0], [x0, z1], [x1, z1], [x1, z0]]);
			if (!skip.includes('bottom')) q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], material, [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);
		},
		// an upright prism of sides round (cx, cz), radius r0 at y0 to r1 at y1. cap: close its top
		ring(cx, cz, r0, r1, y0, y1, sides, material, { cap = false, small = false, turn = 0.5, capMaterial = material } = {}) {
			const at = (k, y, r) => { const a = (k + turn) / sides * Math.PI * 2; return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]; };
			const arc = 2 * Math.PI * Math.max(r0, r1) / sides;
			for (let k = 0; k < sides; k++) K.quad(at(k, y0, r0), at(k + 1, y0, r0), at(k + 1, y1, r1), at(k, y1, r1), material, [[k * arc, y0], [(k + 1) * arc, y0], [(k + 1) * arc, y1], [k * arc, y1]], small);
			if (cap) for (let k = 1; k < sides - 1; k++) K.tri(at(0, y1, r1), at(k, y1, r1), at(k + 1, y1, r1), capMaterial, [[0, 0], [1, 0], [1, 1]], small);
		},
		// a cone (a spire, a turret's roof) round (cx, cz) from radius r at y0 to a point at y1
		cone(cx, cz, r, y0, y1, sides, material, small = false) {
			const at = (k) => { const a = (k + 0.5) / sides * Math.PI * 2; return [cx + Math.cos(a) * r, y0, cz + Math.sin(a) * r]; };
			const slant = Math.hypot(r, y1 - y0), arc = 2 * Math.PI * r / sides;
			for (let k = 0; k < sides; k++) K.tri(at(k), at(k + 1), [cx, y1, cz], material, [[k * arc, 0], [(k + 1) * arc, 0], [(k + 0.5) * arc, slant]], small);
		},
		// a dome: rings of a quarter circle, from radius r at y0 up to a point, bulging (onion) by bulge
		dome(cx, cz, r, y0, height, sides, material, bulge = 0, rings = 4) {
			let prev = null;
			for (let i = 0; i <= rings; i++) {
				const t = i / rings, a = t * Math.PI / 2;
				const radius = r * Math.cos(a) * (1 + bulge * Math.sin(t * Math.PI));
				const y = y0 + height * Math.sin(a);
				if (prev) K.ring(cx, cz, prev[0], Math.max(radius, 0.01), prev[1], y, sides, material);
				prev = [radius, y];
			}
		},
		done() {
			const plain = all.done();
			const full = new Float32Array(all.data.length + fine.data.length);
			full.set(plain, 0);
			full.set(fine.data, all.data.length);
			return { full, plain };
		},
		triangles: () => (all.data.length + fine.data.length) / VERTEX_FLOATS / 3,
	};
	return K;
}

// The four faces of a box w wide and d deep (centred): a frame for each, x along it from its left end (as seen from outside), z out
//		of it. [front, right, back, left], each { x, z (its left end), yaw, length }
function boxFaces(w, d) {
	return [
		{ x: -w / 2, z: d / 2, yaw: 0, length: w, which: 'front' },
		{ x: w / 2, z: d / 2, yaw: Math.PI / 2, length: d, which: 'right' },
		{ x: w / 2, z: -d / 2, yaw: Math.PI, length: w, which: 'back' },
		{ x: -w / 2, z: -d / 2, yaw: -Math.PI / 2, length: d, which: 'left' },
	];
}
// on a face: fn() runs in its frame
function onFace(K, f, fn) { K.push(f.x, 0, f.z, f.yaw); fn(f); K.pop(); }

// walls round a box, y0 to y1, in a material (one or one for each face)
function walls(K, w, d, y0, y1, material, faces = [0, 1, 2, 3]) {
	const F = boxFaces(w, d);
	for (const k of faces) onFace(K, F[k], (f) => K.panel(0, y0, f.length, y1, 0, Array.isArray(material) ? material[k] : material));
}

// bays: where n windows go along a face of a length, evenly, keeping off its corners
function bays(length, spacing = 4.6, margin = 1.2) {
	const n = Math.max(Math.floor((length - 2 * margin) / spacing), 1);
	return Array.from({ length: n }, (_, k) => margin + (length - 2 * margin) * (k + 0.5) / n);
}
// the sill heights of the windows of each storey: the ground floor's, and each floor's over it
const sillOf = (storey) => storey == 0 ? 1.8 : GROUND_FLOOR + (storey - 1) * FLOOR_HEIGHT + 1.5;
const topOf = (floors) => GROUND_FLOOR + floors * FLOOR_HEIGHT;

/*
	A window on a face, its middle x, its sill at y, w wide and h high. options:
		frame		a frame of the trim colour round it		sill		a stone sill under it
		shutters	a pair of shutters, open, either side		flowers		a box of flowers on the sill
		arch		a round head over it						simple		glass and sill alone (the backs and sides)
*/
function windowAt(K, x, y, w, h, { frame = true, sill = true, shutters = false, flowers = false, arch = false, simple = false, lintel = false } = {}) {
	K.panel(x - w / 2, y, x + w / 2, y + h, 0.06, MAT.GLASS);
	if (arch) {
		const r = w / 2, cy = y + h;
		for (let k = 0; k < 4; k++) {
			const a0 = k / 4 * Math.PI, a1 = (k + 1) / 4 * Math.PI;
			K.tri([x, cy, 0.06], [x + Math.cos(a0) * r, cy + Math.sin(a0) * r, 0.06], [x + Math.cos(a1) * r, cy + Math.sin(a1) * r, 0.06], MAT.GLASS, [[x, cy], [x + Math.cos(a0) * r, cy + Math.sin(a0) * r], [x + Math.cos(a1) * r, cy + Math.sin(a1) * r]]);
		}
	}
	if (sill) K.box(x - w / 2 - 0.3, y - 0.22, 0, x + w / 2 + 0.3, y, 0.35, MAT.DRESSED, { skip: ['-z', 'bottom'], small: true });
	if (simple) return;
	if (frame) {
		const f = 0.22, z = 0.12, top = arch ? y + h + w / 2 : y + h;
		K.panel(x - w / 2 - f, y, x - w / 2, top, z, MAT.TRIM, true);
		K.panel(x + w / 2, y, x + w / 2 + f, top, z, MAT.TRIM, true);
		if (!arch) K.panel(x - w / 2 - f, y + h, x + w / 2 + f, y + h + f, z, MAT.TRIM, true);
	}
	if (lintel && !arch) K.panel(x - w / 2 - 0.4, y + h + 0.22, x + w / 2 + 0.4, y + h + 0.75, 0.08, MAT.DRESSED, true);
	if (shutters) {
		K.panel(x - w / 2 - w / 2 - 0.1, y, x - w / 2 - 0.25, y + h, 0.1, MAT.TRIM, true);
		K.panel(x + w / 2 + 0.25, y, x + w / 2 + w / 2 + 0.1, y + h, 0.1, MAT.TRIM, true);
	}
	if (flowers) {
		K.box(x - w / 2 - 0.1, y, 0.35, x + w / 2 + 0.1, y + 0.55, 0.9, MAT.TRIM, { skip: ['-z', 'bottom'], top: MAT.FLOWERS, small: true });
		K.box(x - w / 2, y + 0.55, 0.4, x + w / 2, y + 0.95, 0.85, MAT.FLOWERS, { skip: ['-z', 'bottom'], small: true });
	}
}
// a door on a face, its middle x, w wide and h high: the door, its frame, a step, a light over it
function doorAt(K, x, w = 2.4, h = 4.6, { arch = false, step = true, canopy = false } = {}) {
	K.panel(x - w / 2, 0, x + w / 2, h, 0.05, MAT.DOOR);
	K.panel(x - w / 2 + 0.2, h + 0.2, x + w / 2 - 0.2, h + 1.0, 0.06, MAT.GLASS, true);
	const f = 0.3;
	K.panel(x - w / 2 - f, 0, x - w / 2, h + 1.2, 0.12, MAT.TRIM, true);
	K.panel(x + w / 2, 0, x + w / 2 + f, h + 1.2, 0.12, MAT.TRIM, true);
	K.panel(x - w / 2 - f, h + 1.0, x + w / 2 + f, h + 1.3, 0.12, MAT.TRIM, true);
	if (arch) for (let k = 0; k < 4; k++) {
		const r = w / 2 + f, cy = h + 1.3, a0 = k / 4 * Math.PI, a1 = (k + 1) / 4 * Math.PI;
		K.tri([x, cy, 0.1], [x + Math.cos(a0) * r, cy + Math.sin(a0) * r, 0.1], [x + Math.cos(a1) * r, cy + Math.sin(a1) * r, 0.1], MAT.DRESSED, [[0, 0], [1, 0], [0, 1]], true);
	}
	if (step) K.box(x - w / 2 - 0.5, -0.4, 0, x + w / 2 + 0.5, 0.25, 0.9, MAT.DRESSED, { skip: ['-z', 'bottom'], small: true });
	if (canopy) {
		K.quad([x - w / 2 - 0.8, h + 1.6, 0], [x + w / 2 + 0.8, h + 1.6, 0], [x + w / 2 + 0.8, h + 1.1, 1.4], [x - w / 2 - 0.8, h + 1.1, 1.4], MAT.ROOF, [[0, 0], [w, 0], [w, 1.4], [0, 1.4]], true);
	}
}
// the windows of every storey along a face. storeys: which ones (0 the ground floor). skipAt: x along it where something else is (a door)
function rowsOfWindows(K, length, storeys, options = {}, spacing = 4.6) {
	const xs = bays(length, spacing);
	for (const storey of storeys) {
		for (const x of xs) {
			if (options.skipAt && storey == 0 && options.skipAt.some((s) => Math.abs(s - x) < 2.6)) continue;
			const tall = storey == 0 ? 3.6 : storey == 1 ? 3.8 : 3.4;
			windowAt(K, x, sillOf(storey), options.width ?? 1.9, options.height ?? tall, {
				...options, flowers: options.flowers && storey > 0 && K.chance(0.45), shutters: options.shutters && storey > 0 });
		}
	}
	return xs;
}
// a band of dressed stone round a box at a height (the floors marked on the outside), and the corners in dressed stone (quoins)
function stringCourse(K, w, d, y, out = 0.18, faces = [0, 1, 2, 3]) {
	const F = boxFaces(w, d);
	for (const k of faces) onFace(K, F[k], (f) => {
		K.panel(-out, y, f.length + out, y + 0.35, out, MAT.DRESSED, true);
		K.quad([-out, y + 0.35, out], [f.length + out, y + 0.35, out], [f.length + out, y + 0.35, 0], [-out, y + 0.35, 0], MAT.DRESSED, [[0, 0], [f.length, 0], [f.length, 0.2], [0, 0.2]], true);
	});
}
function quoins(K, w, d, y0, y1) {
	const F = boxFaces(w, d);
	for (const f of F) onFace(K, f, () => { K.panel(-0.02, y0, 0.9, y1, 0.04, MAT.DRESSED, true); K.panel(f.length - 0.9, y0, f.length + 0.02, y1, 0.04, MAT.DRESSED, true); });
}
// timber framing on a face, from y0 to y1, its posts at xs: beams along at each storey, posts, and a brace across some bays
function timbers(K, length, y0, y1, storeyHeight) {
	const z = 0.05, t = 0.35;
	for (let y = y0; y <= y1 + 0.01; y += storeyHeight) K.panel(-0.1, y - t / 2, length + 0.1, y + t / 2, z, MAT.TIMBER);
	const posts = Math.max(Math.round(length / 3.2), 2);
	for (let k = 0; k <= posts; k++) {
		const x = length * k / posts;
		K.panel(x - t / 2, y0, x + t / 2, y1, z, MAT.TIMBER);
	}
	for (let k = 0; k < posts; k++) {
		if ((k + Math.round(y0)) % 3 == 1) continue;
		const xa = length * k / posts, xb = length * (k + 1) / posts;
		for (let y = y0; y < y1 - 0.5; y += storeyHeight) {
			const yb = Math.min(y + storeyHeight, y1);
			const down = k % 2 == 0;
			K.quad([xa, down ? yb : y, z], [xa + t, down ? yb : y, z], [xb, down ? y : yb, z], [xb - t, down ? y : yb, z], MAT.TIMBER, [[0, 0], [t, 0], [3, 3], [3 - t, 3]], true);
		}
	}
}

//-------------------------------ROOFS-------------------------------
// a gabled roof over a w by d box whose walls stop at y: its ridge along x, rise over the middle, the eaves over by over. Gable walls of
//		plaster (or wallMaterial) at the ends, and the tiles a slab thick enough to see from below
function gableRoof(K, w, d, y, rise, { over = 0.9, overEnds = 0.6, material = MAT.ROOF, wallMaterial = MAT.PLASTER, ends = true } = {}) {
	const pitch = rise / (d / 2), drop = over * pitch, thick = 0.35;
	const x0 = -w / 2 - overEnds, x1 = w / 2 + overEnds, eaveY = y - drop, top = y + rise;
	const slant = Math.hypot(d / 2 + over, rise + drop);
	for (const s of [1, -1]) {
		const e = s * (d / 2 + over);
		// the tiles, and the slab's edges: along the eave, and up each verge
		K.quad([x0, eaveY, e], [x1, eaveY, e], [x1, top, 0], [x0, top, 0], material, [[x0, 0], [x1, 0], [x1, slant], [x0, slant]]);
		K.quad([x0, eaveY - thick, e], [x1, eaveY - thick, e], [x1, eaveY, e], [x0, eaveY, e], MAT.TIMBER, [[x0, 0], [x1, 0], [x1, thick], [x0, thick]]);
		for (const x of [x0, x1]) K.quad([x, eaveY - thick, e], [x, eaveY, e], [x, top, 0], [x, top - thick, 0], MAT.TIMBER, [[0, 0], [0, thick], [slant, thick], [slant, 0]]);
		K.quad([x0, eaveY - thick, e], [x1, eaveY - thick, e], [x1, top - thick, 0], [x0, top - thick, 0], MAT.TIMBER, [[x0, 0], [x1, 0], [x1, slant], [x0, slant]], true);
	}
	if (ends) for (const x of [-w / 2, w / 2]) K.tri([x, y, -d / 2], [x, y, d / 2], [x, top, 0], wallMaterial, [[-d / 2, y], [d / 2, y], [0, top]]);
	return top;
}
// the same with its ridge along z (its gables at the front and the back)
function gableRoofZ(K, w, d, y, rise, options = {}) {
	K.push(0, 0, 0, Math.PI / 2);
	const top = gableRoof(K, d, w, y, rise, options);
	K.pop();
	return top;
}
// a hipped roof: sloping on all four sides up to a ridge along x (or a point, on a square)
function hipRoof(K, w, d, y, rise, { over = 0.9, material = MAT.ROOF } = {}) {
	const X = w / 2 + over, Z = d / 2 + over, pitch = rise / (Math.min(w, d) / 2), eaveY = y - over * pitch, top = y + rise;
	const ridge = Math.max(X - Z, 0);
	const slantZ = Math.hypot(Z, rise + over * pitch), slantX = Math.hypot(X - ridge, rise + over * pitch);
	K.quad([-X, eaveY, Z], [X, eaveY, Z], [ridge, top, 0], [-ridge, top, 0], material, [[-X, 0], [X, 0], [ridge, slantZ], [-ridge, slantZ]]);
	K.quad([X, eaveY, -Z], [-X, eaveY, -Z], [-ridge, top, 0], [ridge, top, 0], material, [[-X, 0], [X, 0], [ridge, slantZ], [-ridge, slantZ]]);
	K.tri([X, eaveY, Z], [X, eaveY, -Z], [ridge, top, 0], material, [[-Z, 0], [Z, 0], [0, slantX]]);
	K.tri([-X, eaveY, -Z], [-X, eaveY, Z], [-ridge, top, 0], material, [[-Z, 0], [Z, 0], [0, slantX]]);
	// the fascia round the eaves
	const t = 0.35;
	const E = [[-X, Z], [X, Z], [X, -Z], [-X, -Z]];
	for (let k = 0; k < 4; k++) { const [ax, az] = E[k], [bx, bz] = E[(k + 1) % 4]; K.quad([ax, eaveY - t, az], [bx, eaveY - t, bz], [bx, eaveY, bz], [ax, eaveY, az], MAT.TIMBER, [[0, 0], [1, 0], [1, t], [0, t]], true); }
	return top;
}
// a mansard: steep lower slopes up from the eaves (where the dormers go), a low hip over them
function mansardRoof(K, w, d, y, { lower = 6.5, inset = 1.6, upper = 2.4, over = 0.5, material = MAT.ROOF } = {}) {
	const X = w / 2 + over, Z = d / 2 + over, x = w / 2 - inset, z = d / 2 - inset, y1 = y + lower;
	const slant = Math.hypot(inset + over, lower);
	const lo = [[-X, Z], [X, Z], [X, -Z], [-X, -Z]], hi = [[-x, z], [x, z], [x, -z], [-x, -z]];
	for (let k = 0; k < 4; k++) {
		const a = lo[k], b = lo[(k + 1) % 4], c = hi[(k + 1) % 4], e = hi[k];
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
		K.quad([a[0], y - 0.2, a[1]], [b[0], y - 0.2, b[1]], [c[0], y1, c[1]], [e[0], y1, e[1]], material, [[0, 0], [len, 0], [len - inset, slant], [inset, slant]]);
	}
	K.push(0, y1, 0);
	const top = hipRoof(K, 2 * x, 2 * z, 0, upper, { over: 0.2, material }) + y1;
	K.pop();
	return { top, steep: y1 };
}
// a dormer on a roof slope facing +z: its front at z, its sill at y, w wide, back into the roof by depth
function dormer(K, x, y, z, w = 2.8, h = 3.0, depth = 3.2, roofMaterial = MAT.ROOF, wallMaterial = MAT.PLASTER) {
	K.push(x, y, z);
	K.panel(-w / 2, 0, w / 2, h, 0, wallMaterial);
	for (const s of [-1, 1]) K.quad([s * w / 2, 0, 0], [s * w / 2, 0, -depth], [s * w / 2, h, -depth], [s * w / 2, h, 0], wallMaterial, [[0, 0], [depth, 0], [depth, h], [0, h]]);
	K.tri([-w / 2, h, 0], [w / 2, h, 0], [0, h + w * 0.45, 0], wallMaterial, [[-w / 2, h], [w / 2, h], [0, h + w * 0.45]]);
	const rise = w * 0.45, over = 0.35;
	for (const s of [-1, 1]) K.quad([s * (w / 2 + over), h - over * 0.9, over], [s * (w / 2 + over), h - over * 0.9, -depth], [0, h + rise, -depth], [0, h + rise, over], roofMaterial, [[0, 0], [depth, 0], [depth, w / 2 + 1], [0, w / 2 + 1]]);
	K.push(0, 0, 0.01);
	windowAt(K, 0, 0.5, w - 1.0, h - 1.0, { sill: false, frame: true });
	K.pop();
	K.pop();
}
// a chimney from y0 to y1 at (x, z): brick, with a stone cap and a pot
function chimney(K, x, z, y0, y1, size = 1.4) {
	K.box(x - size / 2, y0, z - size / 2, x + size / 2, y1, z + size / 2, MAT.BRICK, { skip: ['bottom'], top: MAT.IRON });
	K.box(x - size / 2 - 0.2, y1 - 0.4, z - size / 2 - 0.2, x + size / 2 + 0.2, y1 - 0.1, z + size / 2 + 0.2, MAT.DRESSED, { skip: ['bottom'], small: true });
	K.ring(x, z, 0.3, 0.25, y1, y1 + 0.8, 5, MAT.BRICK, { small: true });
}

//-------------------------------THE TYPES-------------------------------
// Each: (K, w, d, floors, variant) -> the height of its walls. The kit's random is the type's and variant's own
const TYPES = {
	// a tall narrow house, its gable to the street, shuttered windows, dormers in the side slopes
	townhouse(K, w, d, floors) {
		const H = topOf(floors);
		walls(K, w, d, -0.5, H, MAT.PLASTER);
		quoins(K, w, d, -0.5, H);
		for (let s = 1; s <= floors; s++) stringCourse(K, w, d, sillOf(s) - 1.5, 0.15, [0]);
		const F = boxFaces(w, d);
		const door = K.chance(0.5) ? w * 0.3 : w * 0.7;
		onFace(K, F[0], (f) => { doorAt(K, door); rowsOfWindows(K, f.length, [0, ...range(1, floors)], { shutters: true, flowers: true, skipAt: [door] }, 3.6); });
		onFace(K, F[2], (f) => rowsOfWindows(K, f.length, range(1, floors), { simple: true }, 4.2));
		for (const k of [1, 3]) onFace(K, F[k], (f) => rowsOfWindows(K, f.length, range(1, floors), { simple: true }, 7));
		const top = gableRoofZ(K, w, d, H, w * 0.55);
		// a window up in the front gable, and dormers in the slopes either side
		onFace(K, F[0], () => windowAt(K, w / 2, H + 0.8, 1.6, 2.6, { shutters: false }));
		K.push(0, 0, 0, Math.PI / 2); dormer(K, -d * 0.1, H + 1.0, w / 2 - 1.2, 2.4, 2.6, 3.0); K.pop();
		K.push(0, 0, 0, -Math.PI / 2); dormer(K, d * 0.1, H + 1.0, w / 2 - 1.2, 2.4, 2.6, 3.0); K.pop();
		chimney(K, w * 0.25, -d * 0.3, H, top + 1.0);
		return H;
	},
	// a wide house under a mansard roof, dormers all along it, its door in the middle on a step
	mansard(K, w, d, floors) {
		const H = topOf(floors);
		walls(K, w, d, -0.5, H, MAT.PLASTER);
		quoins(K, w, d, -0.5, H);
		stringCourse(K, w, d, GROUND_FLOOR - 0.4);
		stringCourse(K, w, d, H - 0.5, 0.3);
		const F = boxFaces(w, d);
		onFace(K, F[0], (f) => { doorAt(K, f.length / 2, 2.8, 5.0, { arch: true }); rowsOfWindows(K, f.length, [0, ...range(1, floors)], { shutters: K.chance(0.5), flowers: true, skipAt: [f.length / 2], lintel: true }); });
		onFace(K, F[2], (f) => rowsOfWindows(K, f.length, [0, ...range(1, floors)], { simple: true }));
		for (const k of [1, 3]) onFace(K, F[k], (f) => rowsOfWindows(K, f.length, range(1, floors), { simple: true }, 6));
		const roof = mansardRoof(K, w, d, H, { lower: 6.0 });
		for (const x of bays(w - 3, 5.5).map((x) => x - (w - 3) / 2)) {
			dormer(K, x, H + 1.0, d / 2 - 0.5, 2.6, 3.2, 2.0);
			K.push(0, 0, 0, Math.PI); dormer(K, x, H + 1.0, d / 2 - 0.5, 2.6, 3.2, 2.0); K.pop();
		}
		chimney(K, -w / 2 + 2.5, 0, roof.steep, roof.top + 1.5);
		chimney(K, w / 2 - 2.5, 0, roof.steep, roof.top + 1.5);
		return H;
	},
	// stone below, timber framed plaster above, the upper floors jutting out over the street, a cross gable to the front
	timbered(K, w, d, floors) {
		const H = topOf(floors), jetty = 0.7;
		walls(K, w, d, -0.5, GROUND_FLOOR, MAT.STONE);
		quoins(K, w, d, -0.5, GROUND_FLOOR);
		K.push(0, 0, jetty / 2);
		walls(K, w, d + jetty, GROUND_FLOOR, H, MAT.PLASTER);
		const F = boxFaces(w, d + jetty);
		for (const k of [0, 1, 3]) onFace(K, F[k], (f) => timbers(K, f.length, GROUND_FLOOR, H, FLOOR_HEIGHT));
		onFace(K, F[0], (f) => rowsOfWindows(K, f.length, range(1, floors), { frame: false, flowers: true }, 4.0));
		onFace(K, F[2], (f) => rowsOfWindows(K, f.length, range(1, floors), { simple: true }, 4.5));
		K.box(-w / 2 - 0.1, GROUND_FLOOR - 0.6, (d + jetty) / 2 - 0.1, w / 2 + 0.1, GROUND_FLOOR, (d + jetty) / 2 + 0.2, MAT.TIMBER, { skip: ['-z'], small: true });
		K.pop();
		const G = boxFaces(w, d);
		onFace(K, G[0], (f) => { doorAt(K, f.length * 0.25, 2.4, 4.6); windowAt(K, f.length * 0.62, 1.8, 3.4, 3.2, { frame: true, lintel: true }); });
		onFace(K, G[2], (f) => rowsOfWindows(K, f.length, [0], { simple: true }));
		const top = gableRoof(K, w, d + jetty, H, d * 0.5, { over: 1.0 });
		// the cross gable
		K.push(0, 0, d * 0.18);
		const gw = Math.min(w * 0.5, 9);
		gableRoofZ(K, gw, d * 0.7, H, gw * 0.6, { overEnds: 0.4 });
		K.pop();
		onFace(K, F[0], () => windowAt(K, w / 2, H + 0.6, 1.6, 2.4, { frame: false }));
		chimney(K, -w * 0.3, -d * 0.15, H, top + 1.2);
		return H;
	},
	// a house with a round turret on its front corner, its cone of copper or tiles over the eaves
	turret(K, w, d, floors) {
		const H = topOf(floors);
		walls(K, w, d, -0.5, H, MAT.PLASTER);
		quoins(K, w, d, -0.5, H);
		stringCourse(K, w, d, GROUND_FLOOR - 0.4, 0.18, [0, 1, 3]);
		const F = boxFaces(w, d);
		onFace(K, F[0], (f) => { doorAt(K, f.length * 0.35, 2.4, 4.8, { canopy: true }); rowsOfWindows(K, f.length - 5, [0, ...range(1, floors)], { shutters: true, flowers: true, skipAt: [f.length * 0.35] }); });
		onFace(K, F[2], (f) => rowsOfWindows(K, f.length, range(1, floors), { simple: true }));
		onFace(K, F[3], (f) => rowsOfWindows(K, f.length - 4, range(1, floors), { simple: true }, 5));
		const top = hipRoof(K, w, d, H, Math.min(w, d) * 0.4);
		// the turret, on the front right corner, a storey taller
		const r = 3.2, cx = w / 2 - 0.6, cz = d / 2 - 0.6, th = H + FLOOR_HEIGHT * 0.9;
		K.ring(cx, cz, r, r, -0.5, th, 10, MAT.PLASTER);
		K.ring(cx, cz, r + 0.2, r + 0.2, th - 0.6, th - 0.2, 10, MAT.DRESSED, { small: true });
		for (let s = 1; s <= floors + 1; s++) {
			for (const a of [0.2, 1.1]) {
				const x = cx + Math.cos(a) * (r + 0.02), z = cz + Math.sin(a) * (r + 0.02);
				K.push(x, 0, z, Math.PI / 2 - a);
				windowAt(K, 0, s > floors ? H + 1.2 : sillOf(s), 1.5, 3.0, { frame: false, sill: true });
				K.pop();
			}
		}
		K.cone(cx, cz, r + 0.7, th, th + 7.5, 10, K.chance(0.5) ? MAT.COPPER : MAT.ROOF);
		K.ring(cx, cz, 0.08, 0.04, th + 7.5, th + 9.2, 4, MAT.IRON, { small: true });
		chimney(K, -w * 0.25, -d * 0.2, H, top + 1.5);
		return H;
	},
	// a big hotel: four or five storeys, a mansard full of dormers, a middle bay standing forward under a pediment, a balcony over the door
	hotel(K, w, d, floors) {
		const H = topOf(floors);
		walls(K, w, d, -0.5, GROUND_FLOOR, MAT.STONE);
		walls(K, w, d, GROUND_FLOOR, H, MAT.PLASTER);
		quoins(K, w, d, GROUND_FLOOR, H);
		stringCourse(K, w, d, GROUND_FLOOR - 0.3, 0.25);
		stringCourse(K, w, d, H - 0.6, 0.35);
		const F = boxFaces(w, d);
		const mid = w / 2;
		onFace(K, F[0], (f) => {
			doorAt(K, mid, 3.4, 5.4, { arch: true, canopy: false });
			rowsOfWindows(K, f.length, [0], { arch: true, frame: false, skipAt: [mid] }, 4.6);
			rowsOfWindows(K, f.length, range(1, floors), { shutters: false, flowers: true, lintel: true }, 4.0);
			// the balcony over the door
			K.box(mid - 4, GROUND_FLOOR + 0.2, 0, mid + 4, GROUND_FLOOR + 0.7, 1.8, MAT.DRESSED, { skip: ['-z'] });
			for (let x = mid - 3.8; x <= mid + 3.9; x += 0.9) K.box(x - 0.06, GROUND_FLOOR + 0.7, 1.55, x + 0.06, GROUND_FLOOR + 2.0, 1.67, MAT.IRON, { skip: ['bottom', 'top', '-z'], small: true });
			K.box(mid - 4, GROUND_FLOOR + 2.0, 1.5, mid + 4, GROUND_FLOOR + 2.15, 1.75, MAT.IRON, { skip: ['bottom'], small: true });
			// its name over the ground floor
			K.panel(mid - 7, GROUND_FLOOR - 1.6, mid + 7, GROUND_FLOOR - 0.5, 0.2, MAT.BRASS, true);
		});
		onFace(K, F[2], (f) => rowsOfWindows(K, f.length, range(1, floors), { simple: true }, 4.6));
		for (const k of [1, 3]) onFace(K, F[k], (f) => rowsOfWindows(K, f.length, [0, ...range(1, floors)], { simple: true }, 4.8));
		const roof = mansardRoof(K, w, d, H, { lower: 6.0, upper: 2.0 });
		for (const x of bays(w - 4, 4.8).map((x) => x - (w - 4) / 2)) {
			if (Math.abs(x) < 3) continue;
			dormer(K, x, H + 1.0, d / 2 - 0.5, 2.4, 3.0, 2.0);
			K.push(0, 0, 0, Math.PI); dormer(K, x, H + 1.0, d / 2 - 0.5, 2.4, 3.0, 2.0); K.pop();
		}
		// the pediment over the middle bay, and its little clock
		K.push(0, H - 0.2, d / 2 + 0.3);
		K.quad([-6, 0, 0], [6, 0, 0], [6, 2.0, 0], [-6, 2.0, 0], MAT.PLASTER, [[-6, 0], [6, 0], [6, 2], [-6, 2]]);
		K.tri([-6.6, 2.0, 0], [6.6, 2.0, 0], [0, 5.5, 0], MAT.PLASTER, [[-6.6, 2], [6.6, 2], [0, 5.5]]);
		for (const s of [-1, 1]) K.quad([s * 6.8, 1.8, 0.3], [0, 5.8, 0.3], [0, 5.8, -2.0], [s * 6.8, 1.8, -2.0], MAT.ROOF, [[0, 0], [7, 0], [7, 2], [0, 2]]);
		K.pop();
		chimney(K, -w / 2 + 3, 0, roof.steep, roof.top + 1.5);
		chimney(K, w / 2 - 3, 0, roof.steep, roof.top + 1.5);
		return H;
	},
	// the bakery: a shop window under a striped awning, the pretzel hanging over the street on its iron bracket, the oven's tall
	//		chimney, timber framing upstairs, the gable to the street
	bakery(K, w, d, floors) {
		const H = topOf(floors);
		walls(K, w, d, -0.5, GROUND_FLOOR, MAT.STONE);
		walls(K, w, d, GROUND_FLOOR, H, MAT.PLASTER);
		quoins(K, w, d, -0.5, GROUND_FLOOR);
		const F = boxFaces(w, d);
		onFace(K, F[0], (f) => {
			doorAt(K, f.length * 0.78, 2.4, 4.8);
			// the shop window, wide, in a wooden frame, a bench of loaves behind it
			const x0 = 1.4, x1 = f.length * 0.62;
			K.panel(x0, 1.2, x1, 5.4, 0.08, MAT.GLASS);
			K.box(x0 - 0.35, 0.6, 0, x1 + 0.35, 1.2, 0.5, MAT.TIMBER, { skip: ['-z', 'bottom'] });
			K.panel(x0 - 0.35, 5.4, x1 + 0.35, 6.0, 0.14, MAT.TIMBER, true);
			K.panel(x0 - 0.35, 1.2, x0, 5.4, 0.14, MAT.TIMBER, true);
			K.panel(x1, 1.2, x1 + 0.35, 5.4, 0.14, MAT.TIMBER, true);
			K.box(x0 + 0.3, 1.2, -0.6, x1 - 0.3, 2.0, 0.0, MAT.BRASS, { skip: ['bottom', '-z'], small: true });
			// the awning
			K.quad([0.8, 6.6, 0], [f.length - 0.8, 6.6, 0], [f.length - 0.8, 5.4, 2.6], [0.8, 5.4, 2.6], MAT.AWNING, [[0, 0], [f.length, 0], [f.length, 2.8], [0, 2.8]]);
			K.quad([0.8, 5.4, 2.6], [f.length - 0.8, 5.4, 2.6], [f.length - 0.8, 4.8, 2.6], [0.8, 4.8, 2.6], MAT.AWNING, [[0, 0], [f.length, 0], [f.length, 0.6], [0, 0.6]]);
			// the sign over the window, and the pretzel on its bracket at the corner
			K.panel(1.6, 6.8, f.length * 0.6, 7.0 + 0.0 + 0.0, 0.2, MAT.TRIM, true);
			K.box(f.length - 0.4, GROUND_FLOOR + 0.6, 0, f.length - 0.2, GROUND_FLOOR + 0.8, 3.0, MAT.IRON, { small: true });
			K.box(f.length - 0.4, GROUND_FLOOR + 0.6, 0, f.length - 0.2, GROUND_FLOOR + 2.2, 0.2, MAT.IRON, { small: true });
			K.quad([f.length - 0.3, GROUND_FLOOR + 2.0, 0.1], [f.length - 0.3, GROUND_FLOOR + 0.8, 1.6], [f.length - 0.3, GROUND_FLOOR + 0.6, 1.4], [f.length - 0.3, GROUND_FLOOR + 1.8, 0.1], MAT.IRON, [[0, 0], [1, 0], [1, 1], [0, 1]], true);
			pretzel(K, f.length - 0.3, GROUND_FLOOR - 0.6, 2.2);
			rowsOfWindows(K, f.length, range(1, floors), { frame: true, flowers: true, shutters: true }, 4.2);
		});
		onFace(K, F[0], (f) => timbers(K, f.length, GROUND_FLOOR, H, FLOOR_HEIGHT));
		onFace(K, F[2], (f) => rowsOfWindows(K, f.length, [0, ...range(1, floors)], { simple: true }, 5));
		for (const k of [1, 3]) onFace(K, F[k], (f) => rowsOfWindows(K, f.length, range(1, floors), { simple: true }, 6));
		const top = gableRoofZ(K, w, d, H, w * 0.5);
		onFace(K, F[0], () => windowAt(K, w / 2, H + 0.7, 1.7, 2.6, { flowers: true }));
		chimney(K, -w * 0.3, -d * 0.3, H - 2, top + 3.5, 1.8);
		return H;
	},
	// the library: pale, symmetrical, tall arched windows, columns and a pediment over the steps to its door, a hipped roof of
	//		copper, and the clock tower over the middle of it
	library(K, w, d, floors) {
		const H = GROUND_FLOOR + 2 * FLOOR_HEIGHT + 1.5;
		walls(K, w, d, -0.5, 1.5, MAT.DRESSED);
		walls(K, w, d, 1.5, H, MAT.PLASTER);
		quoins(K, w, d, 1.5, H);
		stringCourse(K, w, d, 1.2, 0.3);
		stringCourse(K, w, d, H - 0.8, 0.45);
		const F = boxFaces(w, d);
		onFace(K, F[0], (f) => {
			for (const x of bays(f.length, 4.4)) {
				if (Math.abs(x - f.length / 2) < 5) continue;
				windowAt(K, x, 3.0, 2.2, 6.0, { arch: true, frame: false, lintel: false });
				windowAt(K, x, GROUND_FLOOR + FLOOR_HEIGHT + 0.8, 2.2, 3.0, { frame: true });
			}
			doorAt(K, f.length / 2, 3.2, 6.0, { arch: true, step: false });
			// the steps up to it, the columns and the pediment
			K.box(f.length / 2 - 6, -0.5, 0, f.length / 2 + 6, 1.0, 4.2, MAT.DRESSED, { skip: ['-z', 'bottom'] });
			for (let k = 0; k < 3; k++) K.box(f.length / 2 - 6, -0.5, 4.2 + k * 1.0, f.length / 2 + 6, 1.0 - (k + 1) * 0.33, 5.2 + k * 1.0, MAT.DRESSED, { skip: ['-z', 'bottom'] });
			for (let k = 0; k < 4; k++) {
				const x = f.length / 2 - 4.8 + k * 3.2;
				K.ring(x, 3.4, 0.55, 0.48, 1.0, H - 2.2, 8, MAT.DRESSED);
				K.box(x - 0.8, H - 2.2, 2.6, x + 0.8, H - 1.6, 4.2, MAT.DRESSED, { small: true });
			}
			K.box(f.length / 2 - 6.2, H - 1.6, 0, f.length / 2 + 6.2, H, 4.4, MAT.DRESSED, { skip: ['-z'] });
			K.tri([f.length / 2 - 6.4, H, 4.4], [f.length / 2 + 6.4, H, 4.4], [f.length / 2, H + 3.8, 4.4], MAT.PLASTER, [[-6, H], [6, H], [0, H + 3.8]]);
			K.quad([f.length / 2 - 6.8, H - 0.1, 4.8], [f.length / 2, H + 4.1, 4.8], [f.length / 2, H + 4.1, 0], [f.length / 2 - 6.8, H - 0.1, 0], MAT.COPPER, [[0, 0], [8, 0], [8, 4.8], [0, 4.8]]);
			K.quad([f.length / 2 + 6.8, H - 0.1, 4.8], [f.length / 2, H + 4.1, 4.8], [f.length / 2, H + 4.1, 0], [f.length / 2 + 6.8, H - 0.1, 0], MAT.COPPER, [[0, 0], [8, 0], [8, 4.8], [0, 4.8]]);
		});
		onFace(K, F[2], (f) => { for (const x of bays(f.length, 4.4)) windowAt(K, x, 3.0, 2.2, 6.0, { arch: true, simple: true }); });
		for (const k of [1, 3]) onFace(K, F[k], (f) => { for (const x of bays(f.length, 4.4)) windowAt(K, x, 3.0, 2.2, 6.0, { arch: true, simple: true }); });
		const top = hipRoof(K, w, d, H, d * 0.32, { material: MAT.COPPER });
		// the clock tower: square, up through the roof, its clock on all four sides, an open belfry, a copper dome and spire
		const t = 4.2, base = H, clockY = top + 3.5, belfry = clockY + 6;
		K.box(-t, base, -t, t, belfry, t, MAT.PLASTER, { skip: ['bottom', 'top'] });
		quoinsAt(K, t, base, belfry);
		K.box(-t - 0.4, clockY - 3.6, -t - 0.4, t + 0.4, clockY - 3.0, t + 0.4, MAT.DRESSED, { skip: ['bottom'], small: true });
		for (const f of boxFaces(2 * t, 2 * t)) onFace(K, f, () => {
			clockFace(K, t, clockY, 2.9);
			windowAt(K, t, clockY - 9.0 > base ? clockY - 9 : base + 0.6, 1.4, 2.6, { simple: true });
		});
		// the belfry: four posts and a deck, open between
		for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) K.box(sx * t - (sx > 0 ? 1.2 : 0), belfry, sz * t - (sz > 0 ? 1.2 : 0), sx * t + (sx < 0 ? 1.2 : 0), belfry + 5, sz * t + (sz < 0 ? 1.2 : 0), MAT.PLASTER, { skip: ['bottom', 'top'] });
		K.box(-t - 0.5, belfry + 5, -t - 0.5, t + 0.5, belfry + 6, t + 0.5, MAT.DRESSED, { skip: [] });
		K.box(-t + 1.5, belfry + 1.2, -t + 1.5, t - 1.5, belfry + 3.4, t - 1.5, MAT.BRASS, { skip: ['bottom'], small: true });
		K.dome(0, 0, t + 0.3, belfry + 6, 5.5, 8, MAT.COPPER, 0.15, 4);
		K.ring(0, 0, 0.6, 0.6, belfry + 11.3, belfry + 13, 6, MAT.COPPER, { cap: false });
		K.cone(0, 0, 0.7, belfry + 13, belfry + 18, 6, MAT.COPPER);
		return H;
	},
	// the fisherman's shack at the end of the pier: board walls, a small window, a door, its roof of tiles, a stovepipe, a deck
	//		round it on posts down into the sea, a barrel and a coil of rope
	shack(K, w, d) {
		const H = 6.2;
		// the deck and its posts
		K.box(-w / 2 - 1.5, -0.4, -d / 2 - 1.5, w / 2 + 1.5, 0, d / 2 + 2.5, MAT.PLANKS, { skip: ['bottom'] });
		for (const [x, z] of [[-w / 2 - 1, -d / 2 - 1], [w / 2 + 1, -d / 2 - 1], [-w / 2 - 1, d / 2 + 2], [w / 2 + 1, d / 2 + 2], [0, -d / 2 - 1], [-w / 2 - 1, 0], [w / 2 + 1, 0]])
			K.box(x - 0.3, -14, z - 0.3, x + 0.3, -0.4, z + 0.3, MAT.TIMBER, { skip: ['bottom', 'top'] });
		walls(K, w, d, 0, H, MAT.PLANKS);
		const F = boxFaces(w, d);
		onFace(K, F[0], (f) => { doorAt(K, f.length * 0.3, 2.2, 4.6, { step: false }); windowAt(K, f.length * 0.72, 2.2, 2.0, 1.8, { frame: true, sill: true, shutters: true }); });
		onFace(K, F[1], (f) => windowAt(K, f.length / 2, 2.2, 2.0, 1.8, { frame: true, sill: true }));
		onFace(K, F[3], (f) => windowAt(K, f.length / 2, 2.2, 2.0, 1.8, { frame: true, sill: true }));
		// corner posts
		for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) K.box(x - 0.3, 0, z - 0.3, x + 0.3, H, z + 0.3, MAT.TIMBER, { skip: ['bottom', 'top'] });
		const top = gableRoof(K, w, d, H, d * 0.35, { wallMaterial: MAT.PLANKS, over: 1.0 });
		K.ring(w * 0.25, -d * 0.2, 0.3, 0.3, H, top + 2, 6, MAT.IRON);
		K.ring(w * 0.25, -d * 0.2, 0.5, 0.2, top + 2, top + 2.6, 6, MAT.IRON, { small: true });
		// a barrel by the door, and a coil of rope
		K.ring(w / 2 - 1.3, d / 2 + 1.4, 0.75, 0.85, 0, 1.0, 8, MAT.PLANKS, { small: true });
		K.ring(w / 2 - 1.3, d / 2 + 1.4, 0.85, 0.75, 1.0, 2.0, 8, MAT.PLANKS, { cap: true, small: true, capMaterial: MAT.TIMBER });
		K.ring(-w / 2 + 1.3, d / 2 + 1.6, 0.9, 0.9, 0, 0.35, 8, MAT.BRASS, { cap: true, small: true });
		return H;
	},
	// a shop: a big window under a striped awning, a sign board, flats over it
	shop(K, w, d, floors) {
		const H = topOf(floors);
		walls(K, w, d, -0.5, H, MAT.PLASTER);
		quoins(K, w, d, -0.5, H);
		stringCourse(K, w, d, GROUND_FLOOR - 0.4, 0.2);
		const F = boxFaces(w, d);
		onFace(K, F[0], (f) => {
			const door = f.length - 2.5;
			doorAt(K, door, 2.2, 4.6, { step: true });
			K.panel(1.2, 1.0, door - 2.2, 5.0, 0.08, MAT.GLASS);
			K.box(1.0, 0.0, 0, door - 2.0, 1.0, 0.4, MAT.TRIM, { skip: ['-z', 'bottom'] });
			K.panel(1.0, 5.0, door - 2.0, 5.5, 0.14, MAT.TRIM, true);
			K.panel(1.0, 5.6, f.length - 1.0, 6.8, 0.2, MAT.TRIM, true);
			K.quad([0.6, 6.2, 0], [f.length - 0.6, 6.2, 0], [f.length - 0.6, 5.0, 2.4], [0.6, 5.0, 2.4], MAT.AWNING, [[0, 0], [f.length, 0], [f.length, 2.6], [0, 2.6]]);
			K.quad([0.6, 5.0, 2.4], [f.length - 0.6, 5.0, 2.4], [f.length - 0.6, 4.4, 2.4], [0.6, 4.4, 2.4], MAT.AWNING, [[0, 0], [f.length, 0], [f.length, 0.6], [0, 0.6]]);
			rowsOfWindows(K, f.length, range(1, floors), { shutters: true, flowers: true }, 4.0);
		});
		onFace(K, F[2], (f) => rowsOfWindows(K, f.length, [0, ...range(1, floors)], { simple: true }, 4.6));
		for (const k of [1, 3]) onFace(K, F[k], (f) => rowsOfWindows(K, f.length, range(1, floors), { simple: true }, 6));
		const top = K.chance(0.5) ? gableRoof(K, w, d, H, d * 0.45) : hipRoof(K, w, d, H, d * 0.4);
		dormer(K, 0, H + 0.8, d / 2 - 0.4, 2.6, 2.8, 2.6);
		chimney(K, w * 0.3, -d * 0.2, H, top + 1.2);
		return H;
	},
	// a chapel: a nave gabled front to back, a rose window, a tower with a spire over its front
	chapel(K, w, d) {
		const H = 11;
		walls(K, w, d, -0.5, H, MAT.PLASTER);
		quoins(K, w, d, -0.5, H);
		const F = boxFaces(w, d);
		for (const k of [1, 3]) onFace(K, F[k], (f) => { for (const x of bays(f.length, 5.5)) windowAt(K, x, 3.0, 1.8, 5.0, { arch: true, frame: false }); });
		onFace(K, F[2], (f) => windowAt(K, f.length / 2, 3.0, 2.0, 5.0, { arch: true, simple: true }));
		const top = gableRoofZ(K, w, d, H, w * 0.6);
		// the tower, in front of the nave
		const t = 3.6, tz = d / 2 + t - 0.5, th = H + 10;
		K.box(-t, -0.5, tz - t, t, th, tz + t, MAT.PLASTER, { skip: ['bottom', 'top'] });
		quoinsAt(K, t, -0.5, th, 0, tz);
		K.push(0, 0, tz + t);
		doorAt(K, 0, 2.8, 5.2, { arch: true });
		roundWindow(K, 0, 7.8, 1.5);
		K.pop();
		for (const f of boxFaces(2 * t, 2 * t)) { K.push(0, 0, tz); onFace(K, f, () => windowAt(K, t, th - 4.5, 1.6, 3.0, { arch: true, frame: false })); K.pop(); }
		K.box(-t - 0.3, th, tz - t - 0.3, t + 0.3, th + 0.6, tz + t + 0.3, MAT.DRESSED, { skip: ['bottom'] });
		K.push(0, 0, tz);
		K.ring(0, 0, t * 1.2, 0.2, th + 0.6, th + 13, 8, MAT.COPPER, { turn: 0 });
		K.ring(0, 0, 0.08, 0.05, th + 13, th + 15, 4, MAT.IRON, { small: true });
		K.box(-0.8, th + 14, -0.06, 0.8, th + 14.15, 0.06, MAT.IRON, { small: true });
		K.pop();
		return H;
	},
	// two cottages side by side, one a little taller, steep roofs, a dormer and a chimney each
	cottages(K, w, d, floors) {
		const half = w / 2;
		let H = 0;
		for (const [s, extra] of [[-1, 0], [1, 1.2]]) {
			K.push(s * half / 2, 0, 0);
			const h = topOf(floors) + extra;
			H = Math.max(H, h);
			walls(K, half, d, -0.5, h, MAT.PLASTER);
			quoins(K, half, d, -0.5, h);
			const F = boxFaces(half, d);
			onFace(K, F[0], (f) => { doorAt(K, f.length * 0.32, 2.2, 4.4, { canopy: s > 0 }); rowsOfWindows(K, f.length, [0, ...range(1, floors)], { shutters: true, flowers: true, skipAt: [f.length * 0.32] }, 4.2); });
			onFace(K, F[2], (f) => rowsOfWindows(K, f.length, range(1, floors), { simple: true }, 5));
			const top = gableRoof(K, half, d, h, d * 0.55, { overEnds: 0.3 });
			dormer(K, half * 0.15, h + 0.8, d / 2 - 0.6, 2.4, 2.6, 3.0);
			chimney(K, -half * 0.3 * s, -d * 0.15, h, top + 1.0, 1.2);
			K.pop();
		}
		return H;
	},
	// a tall narrow tower house, five or six storeys, an onion dome of copper and a lantern on top
	tower(K, w, d, floors) {
		const H = topOf(floors);
		walls(K, w, d, -0.5, H, MAT.PLASTER);
		quoins(K, w, d, -0.5, H);
		for (let s = 1; s <= floors; s += 2) stringCourse(K, w, d, sillOf(s) - 1.4, 0.15);
		const F = boxFaces(w, d);
		onFace(K, F[0], (f) => { doorAt(K, f.length / 2, 2.2, 4.6, { arch: true }); rowsOfWindows(K, f.length, range(1, floors), { shutters: true, flowers: true }, 4.4); });
		for (const k of [1, 2, 3]) onFace(K, F[k], (f) => rowsOfWindows(K, f.length, range(1, floors), { simple: true }, 4.4));
		K.box(-w / 2 - 0.5, H, -d / 2 - 0.5, w / 2 + 0.5, H + 0.8, d / 2 + 0.5, MAT.DRESSED, { skip: [] });
		const r = Math.min(w, d) / 2 - 0.3;
		K.ring(0, 0, r, r, H + 0.8, H + 2.5, 8, MAT.PLASTER);
		K.dome(0, 0, r + 0.3, H + 2.5, r * 1.8, 8, MAT.COPPER, 0.35, 5);
		K.ring(0, 0, 0.8, 0.8, H + 2.5 + r * 1.8, H + 4.5 + r * 1.8, 6, MAT.LAMP);
		K.cone(0, 0, 1.1, H + 4.5 + r * 1.8, H + 7 + r * 1.8, 6, MAT.COPPER);
		return H;
	},
	// a warehouse on the quay: bare stone, a big arched door, small windows high up, a hoist beam under the gable, a loft door
	warehouse(K, w, d, floors) {
		const H = topOf(floors);
		walls(K, w, d, -0.5, H, MAT.STONE);
		quoins(K, w, d, -0.5, H);
		const F = boxFaces(w, d);
		onFace(K, F[0], (f) => {
			doorAt(K, f.length / 2, 5.5, 7.0, { arch: true, step: false });
			for (const x of [f.length * 0.18, f.length * 0.82]) windowAt(K, x, 3.2, 1.6, 2.2, { frame: false, lintel: true });
			for (const x of bays(f.length, 5.2)) for (let s = 1; s <= floors; s++) if (Math.abs(x - f.length / 2) > 3) windowAt(K, x, sillOf(s) + 0.6, 1.6, 2.4, { frame: false, lintel: true });
		});
		for (const k of [1, 2, 3]) onFace(K, F[k], (f) => { for (const x of bays(f.length, 6)) windowAt(K, x, H - 4.0, 1.4, 2.0, { simple: true }); });
		const top = gableRoofZ(K, w, d, H, w * 0.4, { wallMaterial: MAT.STONE });
		onFace(K, F[0], (f) => {
			K.panel(f.length / 2 - 1.4, H + 0.4, f.length / 2 + 1.4, H + 4.0, 0.05, MAT.DOOR);
			K.box(f.length / 2 - 0.3, H + 4.6, 0, f.length / 2 + 0.3, H + 5.2, 3.2, MAT.TIMBER, { small: true });
			K.ring(f.length / 2, 2.9, 0.04, 0.04, H + 1.5, H + 4.6, 3, MAT.IRON, { small: true });
		});
		return H;
	},
	// an inn: bay windows bowed out over the street, a hanging sign, a hipped roof with dormers
	inn(K, w, d, floors) {
		const H = topOf(floors);
		walls(K, w, d, -0.5, H, MAT.PLASTER);
		quoins(K, w, d, -0.5, H);
		stringCourse(K, w, d, GROUND_FLOOR - 0.3, 0.2);
		const F = boxFaces(w, d);
		onFace(K, F[0], (f) => {
			const door = f.length / 2;
			doorAt(K, door, 2.6, 5.0, { canopy: true });
			rowsOfWindows(K, f.length, [0], { frame: true, skipAt: [door] }, 4.4);
			// two bay windows, the height of the upper floors
			for (const x of [f.length * 0.24, f.length * 0.76]) {
				const bw = 3.6, out = 1.2, y0 = GROUND_FLOOR - 0.4, y1 = H - 1.0;
				K.box(x - bw / 2, y0, 0, x + bw / 2, y1, out, MAT.PLASTER, { skip: ['-z'], top: MAT.ROOF });
				K.push(x - bw / 2, 0, out); for (let s = 1; s <= floors; s++) windowAt(K, bw / 2, sillOf(s), bw - 1.2, 3.2, { frame: false, sill: true }); K.pop();
				K.box(x - bw / 2 - 0.1, y0 - 0.5, -0.1, x + bw / 2 + 0.1, y0, out + 0.1, MAT.TIMBER, { small: true });
			}
			rowsOfWindows(K, f.length * 0.4, range(1, floors), { shutters: true, flowers: true }, 4.0);
			// the sign, hanging off its bracket
			K.box(door + 3.0, GROUND_FLOOR - 0.2, 0, door + 3.2, GROUND_FLOOR, 2.6, MAT.IRON, { small: true });
			K.panel(door + 3.1 - 0.05, GROUND_FLOOR - 2.4, door + 3.1 + 0.05, GROUND_FLOOR - 0.4, 0.0, MAT.IRON, true);
			K.push(door + 3.1, 0, 1.5, Math.PI / 2);
			K.box(-0.9, GROUND_FLOOR - 2.2, -0.06, 0.9, GROUND_FLOOR - 0.5, 0.06, MAT.TRIM, { small: true });
			K.pop();
		});
		onFace(K, F[2], (f) => rowsOfWindows(K, f.length, [0, ...range(1, floors)], { simple: true }, 4.6));
		for (const k of [1, 3]) onFace(K, F[k], (f) => rowsOfWindows(K, f.length, range(1, floors), { simple: true }, 5));
		const top = hipRoof(K, w, d, H, d * 0.4);
		dormer(K, 0, H + 0.8, d / 2 - 0.6, 2.6, 2.8, 3.2);
		chimney(K, -w * 0.3, 0, H, top + 1.0);
		chimney(K, w * 0.3, 0, H, top + 1.0);
		return H;
	},
	// a house with a stepped gable to the street, as along an old harbour
	gabled(K, w, d, floors) {
		const H = topOf(floors);
		walls(K, w, d, -0.5, H, MAT.PLASTER);
		quoins(K, w, d, -0.5, H);
		const F = boxFaces(w, d);
		onFace(K, F[0], (f) => { doorAt(K, f.length * 0.3, 2.3, 4.8, {}); rowsOfWindows(K, f.length, [0, ...range(1, floors)], { lintel: true, flowers: true, skipAt: [f.length * 0.3] }, 3.8); });
		onFace(K, F[2], (f) => rowsOfWindows(K, f.length, range(1, floors), { simple: true }, 4.2));
		for (const k of [1, 3]) onFace(K, F[k], (f) => rowsOfWindows(K, f.length, range(1, floors), { simple: true }, 7));
		const rise = w * 0.75;
		gableRoofZ(K, w, d - 0.6, H, rise, { ends: false, overEnds: 0.0, over: 0.3 });
		// the stepped gables, front and back: five steps each side, a stone cap on each
		for (const z of [d / 2, -d / 2]) {
			const steps = 5;
			for (let k = 0; k < steps; k++) {
				const x0 = -w / 2 + k * w / 2 / steps, x1 = w / 2 - k * w / 2 / steps, y0 = H + k * rise / steps, y1 = H + (k + 1) * rise / steps;
				K.box(x0, y0, z - 0.6, x1, y1, z, MAT.PLASTER, { skip: ['bottom', 'top', '-x', '+x'] });
				for (const x of [x0, x1]) {
					K.box(x - (x < 0 ? 0 : 0.8), y0, z - 0.6, x + (x < 0 ? 0.8 : 0), y1, z, MAT.PLASTER, { skip: ['bottom', 'top', '-z', '+z'] });
					K.box(x - (x < 0 ? 0.1 : 0.9), y1, z - 0.7, x + (x < 0 ? 0.9 : 0.1), y1 + 0.3, z + 0.1, MAT.DRESSED, { small: true });
				}
			}
			if (z > 0) onFace(K, F[0], () => { windowAt(K, w / 2, H + 1.0, 1.7, 2.8, { lintel: true }); windowAt(K, w / 2, H + 5.6, 1.0, 1.4, { frame: false, sill: false }); });
		}
		return H;
	},
};
// the corners of a square tower 2t across in dressed stone, from y0 to y1 (centred on (cx, cz))
function quoinsAt(K, t, y0, y1, cx = 0, cz = 0) {
	K.push(cx, 0, cz);
	quoins(K, 2 * t, 2 * t, y0, y1);
	K.pop();
}
// a clock on a face: its middle x, y, radius
function clockFace(K, x, y, r) {
	const sides = 12;
	for (let k = 0; k < sides; k++) {
		const a0 = k / sides * Math.PI * 2, a1 = (k + 1) / sides * Math.PI * 2;
		K.tri([x, y, 0.15], [x + Math.cos(a0) * r, y + Math.sin(a0) * r, 0.15], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, 0.15], MAT.CLOCK,
			[[0, 0], [Math.cos(a0), Math.sin(a0)], [Math.cos(a1), Math.sin(a1)]]);
	}
	// the hands: ten past ten, the way clocks are always shown
	K.quad([x - 0.08, y, 0.2], [x + 0.08, y, 0.2], [x - r * 0.45 + 0.08, y + r * 0.35, 0.2], [x - r * 0.45 - 0.08, y + r * 0.35, 0.2], MAT.IRON, [[0, 0], [1, 0], [1, 1], [0, 1]], true);
	K.quad([x - 0.06, y, 0.22], [x + 0.06, y, 0.22], [x + r * 0.55 + 0.06, y + r * 0.55, 0.22], [x + r * 0.55 - 0.06, y + r * 0.55, 0.22], MAT.IRON, [[0, 0], [1, 0], [1, 1], [0, 1]], true);
}
// a round window on a face (the chapel's rose): its middle x, y, radius
function roundWindow(K, x, y, r) {
	const sides = 10;
	for (let k = 0; k < sides; k++) {
		const a0 = k / sides * Math.PI * 2, a1 = (k + 1) / sides * Math.PI * 2;
		K.tri([x, y, 0.08], [x + Math.cos(a0) * r, y + Math.sin(a0) * r, 0.08], [x + Math.cos(a1) * r, y + Math.sin(a1) * r, 0.08], MAT.GLASS,
			[[x, y], [x + Math.cos(a0) * r, y + Math.sin(a0) * r], [x + Math.cos(a1) * r, y + Math.sin(a1) * r]]);
	}
}
// the bakery's pretzel: a hanging golden knot, x at the end of the bracket, y its top, s across. Faces the street both ways
function pretzel(K, x, y, z, s = 2.0) {
	const loop = (cx, cy, r, a0, a1, n = 6) => {
		for (let k = 0; k < n; k++) {
			const p = (a, rr) => [x, cy + Math.sin(a) * rr, z + cx + Math.cos(a) * rr];
			const b0 = a0 + (a1 - a0) * k / n, b1 = a0 + (a1 - a0) * (k + 1) / n;
			K.quad(p(b0, r - 0.22), p(b1, r - 0.22), p(b1, r + 0.22), p(b0, r + 0.22), MAT.BRASS, [[0, 0], [1, 0], [1, 1], [0, 1]], true);
		}
	};
	const cy = y - s * 0.55;
	loop(-s * 0.25, cy, s * 0.3, 0.3, Math.PI * 1.9, 7);
	loop(s * 0.25, cy, s * 0.3, -Math.PI * 0.9, Math.PI * 0.7, 7);
	loop(0, cy - s * 0.25, s * 0.45, Math.PI * 1.15, Math.PI * 1.85, 4);
}
const range = (a, b) => Array.from({ length: Math.max(b - a + 1, 0) }, (_, k) => a + k);

//-------------------------------ALL OF THEM-------------------------------
export function buildingMeshes() {
	return BUILDING_TYPES.map((type, t) => Array.from({ length: VARIANTS }, (_, v) => {
		const { width, depth, floors } = variantSize(t, v);
		const K = makeKit(t * 101 + v * 7 + 3);
		const height = TYPES[type.name](K, width, depth, floors, v);
		const { full, plain } = K.done();
		return { full, plain, height };
	}));
}
