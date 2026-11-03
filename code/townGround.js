import { settings } from './settings.js';

import { townMeshBuilder } from './townBuildings.js'
import { BUILDING_TYPES, TOWN_MATERIALS as MAT } from './townLayout.js'
import { PATHS } from './footpaths.js'
import { ZONE_FOREST } from './terrainGenerator.js'

/*
	THE GROUND WORK of the towns (town.js draws it): their streets, lanes, stairs, bridges, the plaza, the walls, the quay and the pier, the
	lamps, the rose bushes and the tulip beds, the landing strip's earth, the footpaths, and the fire towers. Pure maths, no GPU in here, so
	the world's other tiles have theirs made off the main thread with their land (tileWorker.js: world.js, terrain.js)
*/
//-------------------------------THE GROUND WORK-------------------------------
export function groundWork(towns, seaLevel, strip, paths, groundAt, zoneAt, towers, unitsPerMetre = settings.forestUnitsPerMetre) {
	const m = townMeshBuilder();
	const lift = 0.06;		// over the land the roads are cut into
	// a ribbon along a line of [x, y, z] points, width wide, up over them (or over the ground at each side and in the middle, if
	//		ground(x, z) is given). value: a number for each point, for the shader (into its height)
	const ribbon = (points, width, material, up = lift, ground = null, value = null) => {
		let along = 0;
		const sides = points.map((p, j) => {
			const a = points[Math.max(j - 1, 0)], c = points[Math.min(j + 1, points.length - 1)];
			const tl = Math.hypot(c[0] - a[0], c[2] - a[2]) || 1;
			const ox = -(c[2] - a[2]) / tl * width / 2, oz = (c[0] - a[0]) / tl * width / 2;
			if (j > 0) along += Math.hypot(p[0] - points[j - 1][0], p[2] - points[j - 1][2]);
			const at = (x, z) => [x, (ground ? ground(x, z) : p[1]) + up, z];
			return { l: at(p[0] + ox, p[2] + oz), m: ground ? at(p[0], p[2]) : null, r: at(p[0] - ox, p[2] - oz), s: along };
		});
		for (let j = 0; j < sides.length - 1; j++) {
			const A = sides[j], B = sides[j + 1];
			if (!ground) { m.quad(A.l, A.r, B.r, B.l, material, [[A.s, width / 2], [A.s, -width / 2], [B.s, -width / 2], [B.s, width / 2]], [0, 0, 0, 0]); continue; }
			const a = value ? value[j] : 0, b = value ? value[j + 1] : 0;
			m.quad(A.l, A.m, B.m, B.l, material, [[A.s, width / 2], [A.s, 0], [B.s, 0], [B.s, width / 2]], [a, a, b, b]);
			m.quad(A.m, A.r, B.r, B.m, material, [[A.s, 0], [A.s, -width / 2], [B.s, -width / 2], [B.s, 0]], [a, a, b, b]);
		}
	};
	for (const town of towns) {
		// the streets: cobbled, the promenade flagged
		// (a little wider than the street itself: up to the houses' walls)
		for (const street of town.streets) ribbon(street.points, street.width + 1.0, street.level == 0 ? MAT.DRESSED : MAT.COBBLE);
		// the plaza: flagged
		if (town.plaza) {
			const P = town.plaza, y = P.y + lift + 0.01;
			const c = (s, t) => [P.x + P.tx * s * P.long + P.nx * t * P.deep, y, P.z + P.tz * s * P.long + P.nz * t * P.deep];
			m.quad(c(-1, -1), c(1, -1), c(1, 1), c(-1, 1), MAT.DRESSED, [[-P.long, -P.deep], [P.long, -P.deep], [P.long, P.deep], [-P.long, P.deep]]);
		}
		// the lanes out to the hamlets: cobbled
		for (const lane of town.lanes ?? []) ribbon(lane.points, lane.width + 0.6, MAT.COBBLE);
		// the lanes and the stairs: from the edge of one street to the edge of the next
		for (const link of town.links) {
			const dx = link.b[0] - link.a[0], dz = link.b[2] - link.a[2], run = Math.hypot(dx, dz);
			const tx = dx / run, tz = dz / run, ox = -tz * link.width / 2, oz = tx * link.width / 2;
			const from = STREET_EDGE / run, to = 1 - STREET_EDGE / run;
			const at = (f) => [link.a[0] + dx * f, link.a[1] + (link.b[1] - link.a[1]) * f, link.a[2] + dz * f];
			const A = at(from), B = at(to);
			if (!link.stairs) {
				ribbon([A, B], link.width, MAT.COBBLE);
				continue;
			}
			// steps of about 17cm, each a tread and a riser, their noses on the line of the slope
			const rise = B[1] - A[1], steps = Math.max(Math.ceil(Math.abs(rise) / 0.34), 1);
			const runEach = (to - from) * run / steps;
			for (let k = 0; k < steps; k++) {
				const p0 = at(from + (to - from) * k / steps), p1 = at(from + (to - from) * (k + 1) / steps);
				const y0 = A[1] + rise * k / steps + lift, y1 = A[1] + rise * (k + 1) / steps + lift;
				const up = rise > 0;
				const treadY = up ? y1 : y0, riseAt = up ? p0 : p1;
				// the tread
				m.quad([p0[0] + ox, treadY, p0[2] + oz], [p0[0] - ox, treadY, p0[2] - oz], [p1[0] - ox, treadY, p1[2] - oz], [p1[0] + ox, treadY, p1[2] + oz], MAT.DRESSED,
					[[k * runEach, link.width / 2], [k * runEach, -link.width / 2], [(k + 1) * runEach, -link.width / 2], [(k + 1) * runEach, link.width / 2]]);
				// the riser, down to the tread below
				m.quad([riseAt[0] + ox, y0, riseAt[2] + oz], [riseAt[0] - ox, y0, riseAt[2] - oz], [riseAt[0] - ox, y1, riseAt[2] - oz], [riseAt[0] + ox, y1, riseAt[2] + oz], MAT.STONE,
					[[0, y0], [link.width, y0], [link.width, y1], [0, y1]], [0, 0, 0.34, 0.34]);
			}
		}
		// the walls: a slab along each, both faces and its coping
		for (const wall of town.walls) {
			const P = wall.points;
			let along = 0;
			for (let j = 0; j < P.length - 1; j++) {
				const [ax, az, at, ab] = P[j], [bx, bz, bt, bb] = P[j + 1];
				const len = Math.hypot(bx - ax, bz - az) || 1;
				const ox = -(bz - az) / len * 0.6, oz = (bx - ax) / len * 0.6;
				m.wall(ax + ox, az + oz, bx + ox, bz + oz, ab, at, bb, bt, MAT.STONE, along);
				m.wall(bx - ox, bz - oz, ax - ox, az - oz, bb, bt, ab, at, MAT.STONE, -along - len);
				m.quad([ax + ox, at, az + oz], [bx + ox, bt, bz + oz], [bx - ox, bt, bz - oz], [ax - ox, at, az - oz], MAT.DRESSED, [[along, 0.6], [along + len, 0.6], [along + len, -0.6], [along, -0.6]]);
				along += len;
			}
			// its ends
			for (const [k, s] of [[0, 1], [P.length - 1, -1]]) {
				const [x, z, top, bottom] = P[k], [nx, nz] = P[k + s];
				const len = Math.hypot(nx - x, nz - z) || 1, ox = -(nz - z) / len * 0.6, oz = (nx - x) / len * 0.6;
				m.wall(x - ox, z - oz, x + ox, z + oz, bottom, top, bottom, top, MAT.STONE);
			}
		}
		// the pier (and the dock): a deck of boards on posts
		for (const pier of [town.pier, town.dock]) {
			if (!pier) continue;
			const { a, b, width } = pier;
			const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz), tx = dx / len, tz = dz / len, ox = -tz * width / 2, oz = tx * width / 2;
			const y = a[1], under = y - 0.6;
			m.quad([a[0] + ox, y, a[2] + oz], [b[0] + ox, y, b[2] + oz], [b[0] - ox, y, b[2] - oz], [a[0] - ox, y, a[2] - oz], MAT.PLANKS, [[width / 2, 0], [width / 2, len], [-width / 2, len], [-width / 2, 0]]);
			m.wall(a[0] + ox, a[2] + oz, b[0] + ox, b[2] + oz, under, y, under, y, MAT.PLANKS);
			m.wall(b[0] - ox, b[2] - oz, a[0] - ox, a[2] - oz, under, y, under, y, MAT.PLANKS);
			m.wall(b[0] + ox, b[2] + oz, b[0] - ox, b[2] - oz, under, y, under, y, MAT.PLANKS);
			for (let s = 2; s < len; s += 6) {
				for (const side of [1, -1]) {
					const px = a[0] + tx * s + ox * side * 0.9, pz = a[2] + tz * s + oz * side * 0.9;
					const bottom = Math.min(groundAt(px, pz), seaLevel) - 2;
					m.box(px - 0.3, bottom, pz - 0.3, px + 0.3, under, pz + 0.3, MAT.TIMBER, ['bottom', 'top']);
				}
			}
		}
		// the bridges, the rose bushes and the tulip beds
		for (const b of town.bridges ?? []) bridge(m, b, seaLevel, ribbon, groundAt);
		for (const [x, y, z, size, seed] of town.roses ?? []) roseBush(m, x, y, z, size, seed);
		for (const b of town.beds ?? []) tulipBed(m, b);
		// the lamps
		for (const [x, y, z] of town.lamps) lamp(m, x, y + lift, z);
	}
	// the landing strip (see THE LANDING STRIP in terrainGenerator.js): its packed earth, on the ground laid flat for it, u along it and
	//		v across it. A little wider than it: its edges are ragged (the shader leaves the ground showing in and out along them)
	if (strip) {
		const at = (u, v) => [strip.x + strip.ax * u - strip.az * v, seaLevel + strip.h0 + strip.grade * u + lift * 1.5, strip.z + strip.az * u + strip.ax * v];
		const along = 24, across = 4, wide = strip.width + 4;
		for (let i = 0; i < along; i++) {
			for (let j = 0; j < across; j++) {
				const u0 = -strip.half + 2 * strip.half * i / along, u1 = -strip.half + 2 * strip.half * (i + 1) / along;
				const v0 = -wide / 2 + wide * j / across, v1 = -wide / 2 + wide * (j + 1) / across;
				m.quad(at(u0, v0), at(u0, v1), at(u1, v1), at(u1, v0), MAT.DIRT, [[u0, v0], [u0, v1], [u1, v1], [u1, v0]]);
			}
		}
	}
	// the footpaths: worn earth, on the ground as it is laid across them (it keeps some of its slope across a path, and its smallest
	//		bumps): each side of it and its middle on the ground there, three times as often as the path's own points. A little wider
	//		than the tread: the shader makes its edges ragged. Through the forest, strewn with fallen leaves (how much: each point's
	//		share of forest round it, along the path)
	for (const path of paths ?? []) {
		const fine = [path.points[0]];
		for (let j = 1; j < path.points.length; j++) {
			const a = path.points[j - 1], b = path.points[j];
			for (let s = 1; s <= 3; s++) fine.push([a[0] + (b[0] - a[0]) * s / 3, 0, a[2] + (b[2] - a[2]) * s / 3]);
		}
		const forest = fine.map(([x, , z]) => zoneAt(x, z) == ZONE_FOREST ? 1 : 0);
		const leafy = forest.map((_, i) => { const near = forest.slice(Math.max(i - 6, 0), i + 7); return near.reduce((s, v) => s + v, 0) / near.length; });
		ribbon(fine, PATHS.half * 2 + 0.8, MAT.PATH, 0.08, groundAt, leafy);
	}
	for (const [x, z] of towers ?? []) fireTower(m, x, z, groundAt, unitsPerMetre);
	return m;
}

// A stone bridge: its deck (cobbled, along its points), a parapet either side, and under it arches on piers, about SPAN_POINTS of its
//		points to an arch. Its faces go down from the parapet to the arch under it, and a pier stands under every join of two arches,
//		down into the water or the land
const SPAN_POINTS = 4;
function bridge(m, { points: P, width }, seaLevel, ribbon, heightAt) {
	const n = P.length - 1, spans = Math.max(Math.round(n / SPAN_POINTS), 1);
	const piers = Array.from({ length: spans + 1 }, (_, i) => Math.round(i * n / spans));
	// the line across the bridge at each point
	const across = P.map((p, j) => {
		const a = P[Math.max(j - 1, 0)], c = P[Math.min(j + 1, n)], tl = Math.hypot(c[0] - a[0], c[2] - a[2]) || 1;
		return [-(c[2] - a[2]) / tl, (c[0] - a[0]) / tl];
	});
	// the underside at each point: a round arch from pier to pier, its crown a little under the deck
	const under = new Array(P.length).fill(-Infinity), springs = [];
	for (let i = 0; i < spans; i++) {
		const j0 = piers[i], j1 = piers[i + 1];
		let crown = Infinity;
		for (let j = j0; j <= j1; j++) crown = Math.min(crown, P[j][1] - 1.4);
		const run = Math.hypot(P[j1][0] - P[j0][0], P[j1][2] - P[j0][2]);
		const spring = crown - Math.min(run / 2, Math.max(crown - (seaLevel - 3), 1));
		springs.push(spring);
		for (let j = j0; j <= j1; j++) {
			const t = (j - j0) / Math.max(j1 - j0, 1);
			under[j] = Math.max(under[j], spring + (crown - spring) * Math.sqrt(Math.max(1 - (2 * t - 1) ** 2, 0)));
		}
	}
	ribbon(P, width, MAT.COBBLE);
	let along = 0;
	for (let j = 0; j < n; j++) {
		const a = P[j], b = P[j + 1], len = Math.hypot(b[0] - a[0], b[2] - a[2]);
		for (const side of [1, -1]) {
			const at = (p, k, out) => [p[0] + across[k][0] * side * out, p[2] + across[k][1] * side * out];
			const [ix0, iz0] = at(a, j, width / 2), [ix1, iz1] = at(b, j + 1, width / 2);
			const [ox0, oz0] = at(a, j, width / 2 + 0.6), [ox1, oz1] = at(b, j + 1, width / 2 + 0.6);
			// the parapet's inner face, its coping, and the face of the bridge from the coping down to the arch
			m.wall(ix0, iz0, ix1, iz1, a[1], a[1] + 1.1, b[1], b[1] + 1.1, MAT.STONE, along);
			m.quad([ix0, a[1] + 1.1, iz0], [ix1, b[1] + 1.1, iz1], [ox1, b[1] + 1.1, oz1], [ox0, a[1] + 1.1, oz0], MAT.DRESSED, [[along, 0], [along + len, 0], [along + len, 0.6], [along, 0.6]]);
			m.wall(ox0, oz0, ox1, oz1, under[j], a[1] + 1.1, under[j + 1], b[1] + 1.1, MAT.STONE, along);
		}
		// the underside of the arch
		const l0 = [a[0] + across[j][0] * (width / 2 + 0.6), under[j], a[2] + across[j][1] * (width / 2 + 0.6)], r0 = [a[0] - across[j][0] * (width / 2 + 0.6), under[j], a[2] - across[j][1] * (width / 2 + 0.6)];
		const l1 = [b[0] + across[j + 1][0] * (width / 2 + 0.6), under[j + 1], b[2] + across[j + 1][1] * (width / 2 + 0.6)], r1 = [b[0] - across[j + 1][0] * (width / 2 + 0.6), under[j + 1], b[2] - across[j + 1][1] * (width / 2 + 0.6)];
		m.quad(l0, r0, r1, l1, MAT.DRESSED, [[along, 0], [along, width], [along + len, width], [along + len, 0]]);
		along += len;
	}
	// the piers, between the arches: a block a little wider than the bridge, from under the water (or the land) up to the arches' feet
	for (let i = 1; i < spans; i++) {
		const j = piers[i], p = P[j], [cx, cz] = across[j], tx = cz, tz = -cx;
		const top = Math.max(springs[i - 1], springs[i]) + 0.2, bottom = Math.min(heightAt(p[0], p[2]), seaLevel) - 3;
		const hw = width / 2 + 1.2, hd = 1.6;
		const c = (s, t) => [p[0] + cx * hw * s + tx * hd * t, p[2] + cz * hw * s + tz * hd * t];
		const ring = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
		for (let k = 0; k < 4; k++) { const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % 4]; m.wall(ax, az, bx, bz, bottom, top, bottom, top, MAT.STONE); }
	}
}

export const ROSE_RADIUS = 1.6;
// A rose bush: a rounded clump, ragged, size about a metre and a half across (size 1). Its roses are the shader's (MAT.ROSES); uv.x is its own
//		number, for its colour
function roseBush(m, x, y, z, size, seed) {
	const sides = 7, R = ROSE_RADIUS * size, H = 2.7 * size;
	const rings = [[0.0, 0.65], [0.45, 1.0], [0.82, 0.62]];
	const jitter = (k, r) => 0.82 + 0.36 * ((Math.sin((k + 1) * 12.9898 + r * 78.233 + seed * 437.58) * 43758.5453) % 1 + 1) % 1;
	const at = (r, k) => { const a = (k + seed) / sides * Math.PI * 2; const s = R * rings[r][1] * jitter(k % sides, r); return [x + Math.cos(a) * s, y + H * rings[r][0] - (r == 0 ? 0.2 : 0), z + Math.sin(a) * s]; };
	const uv = [seed, 0];
	for (let r = 0; r < rings.length - 1; r++) {
		for (let k = 0; k < sides; k++) m.quad(at(r, k), at(r, k + 1), at(r + 1, k + 1), at(r + 1, k), MAT.ROSES, [uv, uv, uv, uv]);
	}
	const apex = [x, y + H, z];
	for (let k = 0; k < sides; k++) m.tri(at(rings.length - 1, k), at(rings.length - 1, k + 1), apex, MAT.ROSES, [uv, uv, uv]);
}

// A tulip bed: a low kerb of dressed stone round a bed of leaves, and rows of tulips in it, all of one colour (uv.x, see vf_town.js).
//		The tulips' vertices are marked TULIP (in the world pattern flag), and come up out of the bed in the spring and go back into it
//		in the summer (the shader moves them)
const TULIP = 2;
function tulipBed(m, { x, y, z, ax, az, long, wide, colour }) {
	const bx = -az, bz = ax;
	const c = (s, t) => [x + ax * s + bx * t, z + az * s + bz * t];
	const ring = [c(-long, -wide), c(long, -wide), c(long, wide), c(-long, wide)];
	const top = y + 0.45, foot = y - 0.4;
	for (let k = 0; k < 4; k++) { const [px, pz] = ring[k], [qx, qz] = ring[(k + 1) % 4]; m.wall(px, pz, qx, qz, foot, top, foot, top, MAT.DRESSED); }
	const p3 = ([px, pz]) => [px, top - 0.05, pz];
	m.quad(p3(ring[0]), p3(ring[1]), p3(ring[2]), p3(ring[3]), MAT.LEAVES, [[-long, -wide], [long, -wide], [long, wide], [-long, wide]]);
	const flower = [colour + 0.5, 0];
	let k = 0;
	for (let s = -long + 0.45; s <= long - 0.3; s += 0.62) {
		for (let t = -wide + 0.4; t <= wide - 0.3; t += 0.6) {
			k++;
			const [fx, fz] = c(s + 0.12 * Math.sin(k * 3.7), t + 0.12 * Math.cos(k * 5.3));
			const stem = 0.75 + 0.25 * Math.abs(Math.sin(k * 1.9)), cup = top - 0.05 + stem;
			// the stem: one thin blade, and the cup: four petals opening out from it
			const turn = k * 0.9, sx = Math.cos(turn) * 0.05, sz = Math.sin(turn) * 0.05;
			m.quad([fx - sx, top - 0.05, fz - sz], [fx + sx, top - 0.05, fz + sz], [fx + sx, cup, fz + sz], [fx - sx, cup, fz - sz], MAT.LEAVES, [[0, 0], [0.1, 0], [0.1, stem], [0, stem]], [0, 0, 0, 0], TULIP);
			const petal = (q) => { const a = turn + q * Math.PI / 2; return [fx + Math.cos(a) * 0.16, cup + 0.34, fz + Math.sin(a) * 0.16]; };
			for (let q = 0; q < 4; q++) m.tri([fx, cup, fz], petal(q), petal(q + 1), MAT.TULIPS, [flower, [colour + 0.5, 1], [colour + 0.5, 1]], [0, 0, 0], TULIP);
		}
	}
}
const STREET_EDGE = 4.5;		// how far into a street a lane or stair starts: its own edge

// THE FIRE TOWER (terrain.land.fireTowers: on a top in the mountains, with a footpath up to it, see footpaths.js): a lookout's cab
//		of timber and glass on four splayed legs, braced in three panels, a walkway round the cab with a rail, and a ladder up one side.
//		About 770 triangles. In metres (TOWER) from its foot, the ground under its middle: each leg goes down to the ground under it
export const TOWER = { base: 2.2, top: 1.6, floor: 11, cab: 1.6, walk: 2.3, wall: 1.0, window: 2.3, roof: 3.4, levels: [1.5, 5.0, 8.0, 11] };
function fireTower(m, x, z, groundAt, M = settings.forestUnitsPerMetre) {
	const y0 = groundAt(x, z), yF = y0 + TOWER.floor * M;
	const at = ([u, h, w]) => [x + u * M, y0 + h * M, z + w * M];
	// a square beam from p to q (metres), r across, its four sides
	const beam = (p, q, r, material) => {
		const a = at(p), b = at(q), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], length = Math.hypot(...d);
		const t = d.map((v) => v / length), other = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
		let u = [t[1] * other[2] - t[2] * other[1], t[2] * other[0] - t[0] * other[2], t[0] * other[1] - t[1] * other[0]];
		const ul = Math.hypot(...u); u = u.map((v) => v / ul * r * M);
		const w = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
		const corner = (p0, su, sw) => [p0[0] + u[0] * su + w[0] * sw, p0[1] + u[1] * su + w[1] * sw, p0[2] + u[2] * su + w[2] * sw];
		const around = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
		for (let k = 0; k < 4; k++) {
			const [s0, t0] = around[k], [s1, t1] = around[(k + 1) % 4];
			m.quad(corner(a, s0, t0), corner(a, s1, t1), corner(b, s1, t1), corner(b, s0, t0), material, [[k, 0], [k + 1, 0], [k + 1, length], [k, length]]);
		}
	};
	const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
	const leg = ([sx, sz], h) => { const half = TOWER.base + (TOWER.top - TOWER.base) * h / TOWER.floor; return [sx * half, h, sz * half]; };
	for (const c of corners) {
		const foot = leg(c, 0), ground = (groundAt(x + foot[0] * M, z + foot[2] * M) - y0) / M;
		beam([foot[0], ground - 0.5, foot[2]], leg(c, TOWER.floor), 0.14, MAT.TIMBER);
	}
	// the girts and the cross braces, each side, three panels up
	const L = TOWER.levels;
	for (let c = 0; c < 4; c++) {
		const a = corners[c], b = corners[(c + 1) % 4];
		for (let l = 0; l < L.length - 1; l++) beam(leg(a, L[l]), leg(b, L[l]), 0.07, MAT.TIMBER);
		for (let l = 1; l < L.length; l++) { beam(leg(a, L[l - 1]), leg(b, L[l]), 0.05, MAT.TIMBER); beam(leg(b, L[l - 1]), leg(a, L[l]), 0.05, MAT.TIMBER); }
	}
	// the walkway, the cab's walls to the sills, its corner posts, the glass, and the roof
	const W = TOWER.walk * M, C = TOWER.cab * M, deck = yF + 0.25 * M, sill = deck + TOWER.wall * M, head = deck + TOWER.window * M, t = 0.08 * M;
	m.box(x - W, yF, z - W, x + W, deck, z + W, MAT.PLANKS);
	m.box(x - C, deck, z + C - t, x + C, sill, z + C, MAT.PLANKS, ['bottom']);
	m.box(x - C, deck, z - C, x + C, sill, z - C + t, MAT.PLANKS, ['bottom']);
	m.box(x + C - t, deck, z - C + t, x + C, sill, z + C - t, MAT.PLANKS, ['bottom', '-z', '+z']);
	m.box(x - C, deck, z - C + t, x - C + t, sill, z + C - t, MAT.PLANKS, ['bottom', '-z', '+z']);
	for (const [sx, sz] of corners) m.box(x + sx * C - 0.06 * M, sill, z + sz * C - 0.06 * M, x + sx * C + 0.06 * M, head, z + sz * C + 0.06 * M, MAT.TIMBER, ['bottom']);
	const g = 0.04 * M;
	m.quad([x - C, sill, z + C - g], [x + C, sill, z + C - g], [x + C, head, z + C - g], [x - C, head, z + C - g], MAT.GLASS, [[0, 0], [1, 0], [1, 1], [0, 1]]);
	m.quad([x + C, sill, z - C + g], [x - C, sill, z - C + g], [x - C, head, z - C + g], [x + C, head, z - C + g], MAT.GLASS, [[0, 0], [1, 0], [1, 1], [0, 1]]);
	m.quad([x + C - g, sill, z + C], [x + C - g, sill, z - C], [x + C - g, head, z - C], [x + C - g, head, z + C], MAT.GLASS, [[0, 0], [1, 0], [1, 1], [0, 1]]);
	m.quad([x - C + g, sill, z - C], [x - C + g, sill, z + C], [x - C + g, head, z + C], [x - C + g, head, z - C], MAT.GLASS, [[0, 0], [1, 0], [1, 1], [0, 1]]);
	const E = C + 0.4 * M, apex = [x, deck + TOWER.roof * M, z], eave = (sx, sz) => [x + sx * E, head, z + sz * E];
	for (let c = 0; c < 4; c++) {
		const [ax, az] = corners[c], [bx, bz] = corners[(c + 1) % 4];
		m.tri(eave(bx, bz), eave(ax, az), apex, MAT.ROOF, [[0, 0], [2 * E, 0], [E, E]]);
	}
	// the rail round the walkway (open over the ladder), and the ladder up the -z side to it
	const R = TOWER.walk - 0.08, rail = TOWER.floor + 1.25, deckM = TOWER.floor + 0.25;
	for (const [sx, sz] of [...corners, [1, 0], [-1, 0], [0, 1]]) beam([sx * R, deckM, sz * R], [sx * R, rail, sz * R], 0.04, MAT.TIMBER);
	for (const [a, b] of [[[1, 1], [1, -1]], [[-1, -1], [-1, 1]], [[-1, 1], [1, 1]], [[-1, -1], [-0.3, -1]], [[0.3, -1], [1, -1]]]) beam([a[0] * R, rail, a[1] * R], [b[0] * R, rail, b[1] * R], 0.04, MAT.TIMBER);
	const ladder = -(TOWER.walk + 0.08);
	for (const s of [-0.28, 0.28]) beam([s, -0.3, ladder], [s, rail, ladder], 0.04, MAT.TIMBER);
	for (let h = 0.35; h < TOWER.floor; h += 0.4) beam([-0.28, h, ladder], [0.28, h, ladder], 0.025, MAT.TIMBER);
}

// a gas lamp at the foot (x, y, z): a stone foot, an iron post, the lantern and its cap
function lamp(m, x, y, z) {
	m.box(x - 0.4, y, z - 0.4, x + 0.4, y + 0.9, z + 0.4, MAT.DRESSED, ['bottom']);
	const post = 0.13;
	for (let k = 0; k < 6; k++) {
		const a0 = k / 6 * Math.PI * 2, a1 = (k + 1) / 6 * Math.PI * 2;
		const p = (a, h, r) => [x + Math.cos(a) * r, h, z + Math.sin(a) * r];
		m.quad(p(a0, y + 0.9, post * 1.4), p(a1, y + 0.9, post * 1.4), p(a1, y + 6.2, post), p(a0, y + 6.2, post), MAT.IRON, [[0, 0], [1, 0], [1, 1], [0, 1]]);
	}
	// the lantern: four panes, wider at the top
	const lo = y + 6.2, hi = y + 7.5, r0 = 0.32, r1 = 0.48;
	const c = (s, t, h, r) => [x + s * r, h, z + t * r];
	const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
	for (let k = 0; k < 4; k++) {
		const [s0, t0] = corners[k], [s1, t1] = corners[(k + 1) % 4];
		m.quad(c(s0, t0, lo, r0), c(s1, t1, lo, r0), c(s1, t1, hi, r1), c(s0, t0, hi, r1), MAT.LAMP, [[0, 0], [1, 0], [1, 1], [0, 1]]);
		// the cap, a little pyramid over it
		m.tri(c(s0, t0, hi, r1 + 0.1), c(s1, t1, hi, r1 + 0.1), [x, hi + 0.7, z], MAT.IRON, [[0, 0], [1, 0], [0.5, 1]]);
	}
	m.quad(c(-1, -1, lo, r0), c(1, -1, lo, r0), c(1, 1, lo, r0), c(-1, 1, lo, r0), MAT.IRON, [[0, 0], [1, 0], [1, 1], [0, 1]]);
}

