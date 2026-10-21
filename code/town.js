import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { vf_town, TOWN_MATERIALS as MAT } from '../shaders/js/vf_town.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import { BUILDING_TYPES, VARIANTS, variantSize, FLOOR_HEIGHT, GROUND_FLOOR } from './townLayout.js'
import { buildingMeshes, townMeshBuilder } from './townBuildings.js'
import { lightNow } from './lighting.js'
import { seasonNow, weatherNow, SEASON_SPRING, SEASON_SUMMER, SEASON_FALL } from './weather.js'
import { setStillLights } from './pointLights.js'
import { setTownMask } from './townMask.js'
import * as ballistics from './ballistics.js'

//the towns fade into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	The seaside towns on screen (their layout is townLayout.js's, made with the land: terrain.land.towns).
		THE GROUND WORK		one mesh, in world space, for all of them: the streets (cobbled, the promenade flagged), the lanes and
							the stairs between them, the plaza, the stone walls along the streets and round the plaza, the quay, the
							pier on its posts, and the gas lamps. Made again with every new land
		THE HOUSES			made once (townBuildings.js): each type of building in each of its sizes, a mesh of its own, and drawn
							once for every house of that type and size (instancing), turned and stood where the layout put it,
							in its own colours. Under each, stone footings down to the lowest ground under it. Further off than
							NEAR_HOUSES a house is drawn from its plain version: the same walls and roofs without the small things on them
	All of it with vf_town.js. Each mesh's vertices: where (3), what it is made of, uv (world units), how high over the foot of its wall,
	and whether its pattern is laid out from where it is in the world (1: the footings, which are a stretched box) or its uv (0)

	SHOT: a bullet stops at the first of the same boxes it meets (a house's wall, a street's wall, a lamp).

	IN THE WAY (boxesNear): what the walker, the horses and the discs bump into, as the trunks and boulders are given (square boxes
	that do not turn): a ring of them round every house's walls (the inside is not reachable), along the walls of the streets, under
	the pier's deck (to stand on), and at each lamp.
*/
const NEAR_HOUSES = 520;		// world units
const DRAW_HOUSES = 6000;
const VERTEX_FLOATS = 8;
const INSTANCE_FLOATS = 28;

export const townStats = { towns: 0, houses: 0, groundTriangles: 0, triangles: 0, drawnHouses: 0, boxes: 0, lamps: 0 };

//-------------------------------MESHES-------------------------------
// a unit box (the footings: stretched to each house), its pattern from the world
const FOOTING = (() => { const m = townMeshBuilder(); m.box(-0.5, 0, -0.5, 0.5, 1, 0.5, MAT.STONE, ['bottom', 'top'], MAT.STONE, 1); return m.done(); })();

//-------------------------------THE GROUND WORK-------------------------------
function groundWork(towns, seaLevel) {
	const m = townMeshBuilder();
	const lift = 0.06;		// over the land the roads are cut into
	// a ribbon along a line of [x, y, z] points, width wide
	const ribbon = (points, width, material) => {
		let along = 0;
		const sides = points.map((p, j) => {
			const a = points[Math.max(j - 1, 0)], c = points[Math.min(j + 1, points.length - 1)];
			const tl = Math.hypot(c[0] - a[0], c[2] - a[2]) || 1;
			const ox = -(c[2] - a[2]) / tl * width / 2, oz = (c[0] - a[0]) / tl * width / 2;
			if (j > 0) along += Math.hypot(p[0] - points[j - 1][0], p[2] - points[j - 1][2]);
			return { l: [p[0] + ox, p[1] + lift, p[2] + oz], r: [p[0] - ox, p[1] + lift, p[2] - oz], s: along };
		});
		for (let j = 0; j < sides.length - 1; j++) {
			const A = sides[j], B = sides[j + 1];
			m.quad(A.l, A.r, B.r, B.l, material, [[A.s, width / 2], [A.s, -width / 2], [B.s, -width / 2], [B.s, width / 2]], [0, 0, 0, 0]);
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
		// the pier: a deck of boards on posts
		if (town.pier) {
			const { a, b, width } = town.pier;
			const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz), tx = dx / len, tz = dz / len, ox = -tz * width / 2, oz = tx * width / 2;
			const y = a[1], under = y - 0.6;
			m.quad([a[0] + ox, y, a[2] + oz], [b[0] + ox, y, b[2] + oz], [b[0] - ox, y, b[2] - oz], [a[0] - ox, y, a[2] - oz], MAT.PLANKS, [[width / 2, 0], [width / 2, len], [-width / 2, len], [-width / 2, 0]]);
			m.wall(a[0] + ox, a[2] + oz, b[0] + ox, b[2] + oz, under, y, under, y, MAT.PLANKS);
			m.wall(b[0] - ox, b[2] - oz, a[0] - ox, a[2] - oz, under, y, under, y, MAT.PLANKS);
			m.wall(b[0] + ox, b[2] + oz, b[0] - ox, b[2] - oz, under, y, under, y, MAT.PLANKS);
			for (let s = 2; s < len; s += 6) {
				for (const side of [1, -1]) {
					const px = a[0] + tx * s + ox * side * 0.9, pz = a[2] + tz * s + oz * side * 0.9;
					const bottom = Math.min(terrain.land.heightAt(px, pz), seaLevel) - 2;
					m.box(px - 0.3, bottom, pz - 0.3, px + 0.3, under, pz + 0.3, MAT.TIMBER, ['bottom', 'top']);
				}
			}
		}
		// the bridges, the rose bushes and the tulip beds
		for (const b of town.bridges ?? []) bridge(m, b, seaLevel, ribbon);
		for (const [x, y, z, size, seed] of town.roses ?? []) roseBush(m, x, y, z, size, seed);
		for (const b of town.beds ?? []) tulipBed(m, b);
		// the lamps
		for (const [x, y, z] of town.lamps) lamp(m, x, y + lift, z);
	}
	return m;
}

// A stone bridge: its deck (cobbled, along its points), a parapet either side, and under it arches on piers, about SPAN_POINTS of its
//		points to an arch. Its faces go down from the parapet to the arch under it, and a pier stands under every join of two arches,
//		down into the water or the land
const SPAN_POINTS = 4;
function bridge(m, { points: P, width }, seaLevel, ribbon) {
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
		const top = Math.max(springs[i - 1], springs[i]) + 0.2, bottom = Math.min(terrain.land.heightAt(p[0], p[2]), seaLevel) - 3;
		const hw = width / 2 + 1.2, hd = 1.6;
		const c = (s, t) => [p[0] + cx * hw * s + tx * hd * t, p[2] + cz * hw * s + tz * hd * t];
		const ring = [c(-1, -1), c(1, -1), c(1, 1), c(-1, 1)];
		for (let k = 0; k < 4; k++) { const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % 4]; m.wall(ax, az, bx, bz, bottom, top, bottom, top, MAT.STONE); }
	}
}

const ROSE_RADIUS = 1.6;
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

//-------------------------------THE GPU-------------------------------
const shaderModule = device.createShaderModule({ label: "vf_town", code: vf_town });
const uniformBuffer = device.createBuffer({ label: "town Uniform", size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const pipeline = device.createRenderPipeline({
	label: "town pipeline",
	layout: 'auto',
	vertex: {
		module: shaderModule,
		entryPoint: "vertexMain",
		buffers: [
			{ arrayStride: VERTEX_FLOATS * 4, attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }, { format: "float32x2", offset: 16, shaderLocation: 1 }, { format: "float32x2", offset: 24, shaderLocation: 9 }] },
			{ arrayStride: INSTANCE_FLOATS * 4, stepMode: 'instance', attributes: [0, 1, 2, 3, 4, 5, 6].map((k) => ({ format: "float32x4", offset: k * 16, shaderLocation: k + 2 })) },
		],
	},
	fragment: { module: shaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
});
let bindGroup = null, boundLUT = null;
const meshBuffer = (label, data) => {
	const buffer = device.createBuffer({ label, size: Math.max(data.byteLength, 16), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	if (data.byteLength) device.queue.writeBuffer(buffer, 0, data);
	return { buffer, vertices: data.length / VERTEX_FLOATS };
};

// the houses' meshes, made once: [type][variant] -> { full, plain } (see townBuildings.js)
const HOUSES = buildingMeshes();
const houseBuffers = HOUSES.map((variants, t) => variants.map((mesh, v) => ({ full: meshBuffer(`town ${BUILDING_TYPES[t].name} ${v}`, mesh.full), plain: meshBuffer(`town ${BUILDING_TYPES[t].name} ${v} plain`, mesh.plain), height: mesh.height })));
export const HOUSE_TRIANGLES = HOUSES.map((variants) => variants.map((mesh) => ({ full: mesh.full.length / VERTEX_FLOATS / 3, plain: mesh.plain.length / VERTEX_FLOATS / 3 })));
const footingBuffer = meshBuffer('town footing', FOOTING);

let ground = null;			// the ground work's buffer
let builtFor = null;		// the land it was made for
let houses = [];			// every house: { building, town, matrix, footing (its matrix), height, colours }
let instanceData = new Float32Array(INSTANCE_FLOATS * 64);
let instanceBuffer = device.createBuffer({ label: "town instances", size: instanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });

//-------------------------------IN THE WAY-------------------------------
const BOX_BUCKET = 64;
let boxes = new Float32Array(0);		// x, z, half, bottom, top
let boxBuckets = new Map();
export function boxesNear(x, z, reach, each) {
	for (let bx = Math.floor((x - reach) / BOX_BUCKET); bx <= Math.floor((x + reach) / BOX_BUCKET); bx++) {
		for (let bz = Math.floor((z - reach) / BOX_BUCKET); bz <= Math.floor((z + reach) / BOX_BUCKET); bz++) {
			const bucket = boxBuckets.get(bx * 100000 + bz);
			if (!bucket) continue;
			for (const at of bucket) {
				const o = at * 5;
				if (Math.abs(boxes[o] - x) > reach + boxes[o + 2] || Math.abs(boxes[o + 1] - z) > reach + boxes[o + 2]) continue;
				each(boxes[o], boxes[o + 1], boxes[o + 2], boxes[o + 3], boxes[o + 4]);
			}
		}
	}
}
// a bullet's step from a to b against the boxes near it: the first one it goes into (slabs: the line's way in and out of each pair of faces)
ballistics.addTarget((ax, ay, az, bx, by, bz) => {
	if (boxes.length == 0) return null;
	const dx = bx - ax, dy = by - ay, dz = bz - az;
	let best = null;
	boxesNear((ax + bx) / 2, (az + bz) / 2, Math.hypot(dx, dz) / 2 + 2, (x, z, half, bottom, top) => {
		let t0 = 0, t1 = 1;
		for (const [o, d, lo, hi] of [[ax, dx, x - half, x + half], [ay, dy, bottom, top], [az, dz, z - half, z + half]]) {
			if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = 2; break; } continue; }
			let ta = (lo - o) / d, tb = (hi - o) / d;
			if (ta > tb) [ta, tb] = [tb, ta];
			t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
			if (t0 > t1) break;
		}
		if (t0 <= t1 && t0 <= 1 && (!best || t0 < best.t)) best = { t: t0, what: 'wall', hit: () => {} };
	});
	return best;
});

function makeBoxes(towns) {
	const list = [];
	const add = (x, z, half, bottom, top) => list.push(x, z, half, bottom, top);
	for (const h of houses) {
		const b = h.building, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
		// round its walls: squares along them, a little inside them
		const hw = b.width / 2, hd = b.depth / 2, step = 2.2, half = 1.0 * (Math.abs(c) + Math.abs(s));
		const ring = [];
		for (let u = -hw + 1; u <= hw - 1 + 0.01; u += step) ring.push([u, -hd + 1], [u, hd - 1]);
		for (let w = -hd + 1 + step; w <= hd - 1 - step + 0.01; w += step) ring.push([-hw + 1, w], [hw - 1, w]);
		for (const [u, w] of ring) add(b.x + u * c + w * s, b.z - u * s + w * c, half, b.footing, b.y + h.height);
	}
	for (const town of towns) {
		for (const wall of town.walls) {
			for (let j = 0; j < wall.points.length - 1; j++) {
				const [ax, az, at, ab] = wall.points[j], [bx, bz, bt, bb] = wall.points[j + 1];
				const n = Math.max(Math.ceil(Math.hypot(bx - ax, bz - az) / 1.2), 1);
				for (let k = 0; k < n; k++) add(ax + (bx - ax) * k / n, az + (bz - az) * k / n, 0.65, Math.min(ab, bb), at + (bt - at) * k / n);
			}
		}
		if (town.pier) {
			const { a, b, width } = town.pier, len = Math.hypot(b[0] - a[0], b[2] - a[2]);
			for (let s = 0; s <= len; s += 2.5) {
				for (const side of [-1, 0, 1]) {
					const ox = -(b[2] - a[2]) / len * side * width / 3, oz = (b[0] - a[0]) / len * side * width / 3;
					add(a[0] + (b[0] - a[0]) * s / len + ox, a[2] + (b[2] - a[2]) * s / len + oz, 1.4, a[1] - 0.6, a[1]);
				}
			}
		}
		for (const b of town.bridges ?? []) {
			// the deck, in squares down its middle (stood on), and its parapets
			const P = b.points;
			for (let j = 0; j < P.length - 1; j++) {
				const [ax, ay, az] = P[j], [bx, by, bz] = P[j + 1], len = Math.hypot(bx - ax, bz - az) || 1;
				const ox = -(bz - az) / len, oz = (bx - ax) / len, n = Math.max(Math.ceil(len / 2.5), 1);
				for (let k = 0; k < n; k++) {
					const f = (k + 0.5) / n, x = ax + (bx - ax) * f, y = ay + (by - ay) * f, z = az + (bz - az) * f;
					add(x, z, b.width * 0.36, y - 1.0, y);
					for (const side of [1, -1]) add(x + ox * side * (b.width / 2 + 0.3), z + oz * side * (b.width / 2 + 0.3), 0.4, y - 1.0, y + 1.1);
				}
			}
		}
		for (const [x, y, z] of town.lamps) add(x, z, 0.35, y, y + 8);
	}
	boxes = new Float32Array(list);
	boxBuckets = new Map();
	for (let k = 0; k < boxes.length / 5; k++) {
		const key = Math.floor(boxes[k * 5] / BOX_BUCKET) * 100000 + Math.floor(boxes[k * 5 + 1] / BOX_BUCKET);
		if (!boxBuckets.has(key)) boxBuckets.set(key, []);
		boxBuckets.get(key).push(k);
	}
	townStats.boxes = boxes.length / 5;
}

//-------------------------------EACH NEW LAND-------------------------------
function build() {
	const land = terrain.land;
	builtFor = land;
	const towns = land.towns ?? [];
	const work = groundWork(towns, settings.waterWorldPosY);
	if (ground) ground.buffer.destroy();
	ground = meshBuffer('town ground work', work.done());
	townStats.groundTriangles = work.triangles();
	houses = [];
	for (const town of towns) {
		for (const b of town.buildings) {
			const mesh = houseBuffers[b.type][b.variant ?? 0];
			const matrix = mat4.rotateY(mat4.translation([b.x, b.y, b.z]), b.yaw);
			const footingHeight = Math.max(b.y - b.footing, 0.5);
			const footing = mat4.scale(mat4.rotateY(mat4.translation([b.x, b.footing, b.z]), b.yaw), [b.width - 0.1, footingHeight + 0.4, b.depth - 0.1]);
			houses.push({ building: b, town, matrix, footing: b.onPier ? null : footing, height: mesh.height, mesh });		// (the shack stands on its own posts)
		}
	}
	const needed = (houses.length * 2 + 4) * INSTANCE_FLOATS;
	if (instanceData.length < needed) {
		instanceData = new Float32Array(needed);
		instanceBuffer.destroy();
		instanceBuffer = device.createBuffer({ label: "town instances", size: instanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	}
	makeBoxes(towns);
	setTownMask(...maskOf(towns));
	// the lamps light what is round them by night (pointLights.js): from the lantern, warm, about 12 metres out
	setStillLights('town', towns.flatMap((t) => t.lamps.map(([x, y, z]) => ({ at: [x, y + 6.9, z], radius: 22, colour: [1.0, 0.7, 0.4], strength: 4.0 }))));
	townStats.towns = towns.length;
	townStats.houses = houses.length;
	townStats.lamps = towns.reduce((n, t) => n + t.lamps.length, 0);
}

// where the grass does not grow (townMask.js): the roads and walls a little wider than they are drawn, under the houses and lamps
function maskOf(towns) {
	const stretches = [], boxes = [];
	const along = (points, half) => { for (let j = 0; j < points.length - 1; j++) stretches.push({ a: [points[j][0], points[j][2]], b: [points[j + 1][0], points[j + 1][2]], half }); };
	for (const town of towns) {
		for (const street of town.streets) along(street.points, (street.width + 1.0) / 2 + 0.3);
		for (const lane of town.lanes ?? []) along(lane.points, (lane.width + 0.6) / 2 + 0.3);
		for (const link of town.links) along([link.a, link.b], link.width / 2 + 0.3);
		for (const b of town.bridges ?? []) along(b.points, b.width / 2 + 1.0);
		for (const b of town.beds ?? []) boxes.push({ at: [b.x, b.z], axis: [b.ax, b.az], half: [b.long + 0.2, b.wide + 0.2] });
		for (const [x, , z, size] of town.roses ?? []) boxes.push({ at: [x, z], axis: [1, 0], half: [ROSE_RADIUS * size * 0.8, ROSE_RADIUS * size * 0.8] });
		for (const wall of town.walls) for (let j = 0; j < wall.points.length - 1; j++) stretches.push({ a: wall.points[j].slice(0, 2), b: wall.points[j + 1].slice(0, 2), half: 0.9 });
		if (town.plaza) { const P = town.plaza; boxes.push({ at: [P.x, P.z], axis: [P.tx, P.tz], half: [P.long + 0.3, P.deep + 0.3] }); }
		for (const b of town.buildings) if (!b.onPier) boxes.push({ at: [b.x, b.z], axis: [Math.cos(b.yaw), -Math.sin(b.yaw)], half: [b.width / 2 + 0.2, b.depth / 2 + 0.2] });
		for (const [x, , z] of town.lamps) boxes.push({ at: [x, z], axis: [1, 0], half: [0.5, 0.5] });
	}
	return [stretches, boxes];
}

let lastTime = performance.now();
export function townUpdate() {
	if (terrain.land && terrain.land !== builtFor) build();
}

//-------------------------------DRAWING-------------------------------
// how far the tulips and the roses are in flower (0 to 1): the tulips through the spring into the start of the summer, the roses from
//		the end of the spring until well into the autumn. And how far up the tulips are (they come up early in the spring, and are gone
//		by the middle of the summer)
function flowering() {
	const { index, progress } = seasonNow, s = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
	const tulips = index == SEASON_SPRING ? s(0.1, 0.35, progress) : index == SEASON_SUMMER ? 1 - s(0.05, 0.3, progress) : 0;
	const up = index == SEASON_SPRING ? s(0.0, 0.12, progress) : index == SEASON_SUMMER ? 1 - s(0.3, 0.55, progress) : 0;
	const roses = index == SEASON_SPRING ? s(0.6, 0.95, progress) : index == SEASON_SUMMER ? 1 : index == SEASON_FALL ? 1 - s(0.3, 0.8, progress) : 0;
	return [tulips, roses, up];
}
const IDENTITY = mat4.identity();
const NEUTRAL = [0.9, 0.85, 0.75, 0.5, 0.6, 0.3, 0.2, 0, 0.9, 0.9, 0.9, 0];
const startSeconds = performance.now() / 1000;
// with the solid things
export function townPass(aEncoder, mainpassDepthTexture) {
	if (!ground || (ground.vertices == 0 && houses.length == 0) || !settings.enableTerrain) return;
	const light = lightNow();
	const u = new Float32Array(32);
	u.set(transformations.getViewProj(), 0);
	u.set([settings.camPosX, settings.camPosY, settings.camPosZ, 0], 16);
	u.set([settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, performance.now() / 1000 - startSeconds, 1 - light.daylight], 20);
	const [tulips, roses, up] = flowering();
	u.set([tulips, roses, weatherNow.snowCover ?? 0, seasonNow.autumn ?? 0], 24);
	u.set([up, 0, 0, 0], 28);
	device.queue.writeBuffer(uniformBuffer, 0, u);
	if (!bindGroup || boundLUT !== skyViewLUTtexture) {
		boundLUT = skyViewLUTtexture;
		bindGroup = device.createBindGroup({
			label: "town bind group",
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: { buffer: uniformBufferLights } },
				{ binding: 2, resource: skyViewLUTtexture.createView() },
				{ binding: 3, resource: linSampler },
			],
		});
	}
	// the instances: the ground work's one, then the houses near and far grouped by their mesh, then their footings
	let count = 0;
	const put = (matrix, b) => {
		instanceData.set(matrix, count * INSTANCE_FLOATS);
		instanceData.set(b ? [...b.plaster, b.seed, ...b.roof, b.footing + 1.5, ...b.trim, b.onPier ? 0 : 1] : NEUTRAL, count * INSTANCE_FLOATS + 16);
		return count++;
	};
	put(IDENTITY, null);
	const groups = new Map();		// mesh buffer -> [first instance, count]
	const visible = [];
	for (const h of houses) {
		const away = Math.hypot(h.building.x - settings.camPosX, h.building.z - settings.camPosZ);
		if (away > DRAW_HOUSES) continue;
		const mesh = away < NEAR_HOUSES ? h.mesh.full : h.mesh.plain;
		if (!groups.has(mesh)) groups.set(mesh, []);
		groups.get(mesh).push(h);
		visible.push(h);
	}
	const draws = [];
	for (const [mesh, list] of groups) {
		const first = count;
		for (const h of list) put(h.matrix, h.building);
		draws.push([mesh, first, list.length]);
	}
	const firstFooting = count;
	const footed = visible.filter((h) => h.footing);
	for (const h of footed) put(h.footing, h.building);
	townStats.drawnHouses = visible.length;
	device.queue.writeBuffer(instanceBuffer, 0, instanceData, 0, count * INSTANCE_FLOATS);

	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Towns', 'vf_town'),
	});
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup);
	pass.setVertexBuffer(1, instanceBuffer);
	let triangles = 0;
	if (ground.vertices) { pass.setVertexBuffer(0, ground.buffer); pass.draw(ground.vertices, 1, 0, 0); triangles += ground.vertices / 3; }
	for (const [mesh, first, n] of draws) {
		if (!mesh.vertices) continue;
		pass.setVertexBuffer(0, mesh.buffer);
		pass.draw(mesh.vertices, n, 0, first);
		triangles += mesh.vertices / 3 * n;
	}
	if (footed.length) {
		pass.setVertexBuffer(0, footingBuffer.buffer);
		pass.draw(footingBuffer.vertices, footed.length, 0, firstFooting);
		triangles += footingBuffer.vertices / 3 * footed.length;
	}
	pass.end();
	townStats.triangles = triangles;
}

// for testing: every house, where it is and what
export function townHouses() {
	return houses.map((h) => ({ type: BUILDING_TYPES[h.building.type].name, variant: h.building.variant, x: h.building.x, y: h.building.y, z: h.building.z, yaw: h.building.yaw, footing: h.building.footing, height: h.height, width: h.building.width, depth: h.building.depth }));
}
