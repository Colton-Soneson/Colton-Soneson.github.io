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
import { PATHS } from './footpaths.js'
import * as ballistics from './ballistics.js'
import * as smoke from './smoke.js'

//the towns fade into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	The seaside towns on screen (their layout is townLayout.js's, made with the land: terrain.land.towns), and the landing strip by the
	first of them (terrain.land.strip: its packed earth is part of the ground work), and the footpaths (terrain.land.paths, see
	footpaths.js: a ribbon of earth each, in the ground work too), and the fire tower in the mountains (terrain.land.fireTowers: in
	the ground work, see THE FIRE TOWER).
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

	THE DAMAGE: each house can be knocked down: its damage goes from 0 (whole) to 1 (down). A shell or a bomb bursting near it (blast:
	shipGuns.js; BURSTS: out to its radius, less the further off it is from the house's walls) and, a little, a bullet in one of its
	walls (DAMAGE.bullet), each the less the bigger the house is (sizeOf: by its volume, against DAMAGE.size). Past DAMAGE.smokeFrom smoke
	comes out of its windows, more and more and darker as it gets worse, and flames with it past DAMAGE.flamesFrom (smoke.js); its plaster,
	trim and roof are scorched darker. At 1 it comes down: a ball of fire (smoke.blast), a ring of dust, a column of smoke going up for
	PLUME.seconds (and a little more smouldering out of the rubble after it, until PLUME.smoulder), and a heap of rubble in its place
	(RUBBLE, stretched to it) that can be walked over (its boxes no higher than RUBBLE_TOP). onCollapse tells the rest (sound.js). It can be
	mended (mendHouse) and put back whole (restoreHouses).
	MULTIPLAYER: the damage is the host's (housesHere: alone or the host): every burst and every bullet it sees, its own, the NPCs' and the
	joiners' (flown there too), counts there; a joiner's own count for nothing at its end. The host sends each house whose damage has
	changed (housesShare), SHARE_SECONDS apart, and all of them to a joiner as it comes in; a joiner's houses are put to it (housesHeard),
	coming down and all as they would have.

	IN THE WAY (boxesNear): what the walker, the horses and the discs bump into, as the trunks and boulders are given (square boxes
	that do not turn): a ring of them round every house's walls (the inside is not reachable), along the walls of the streets, under
	the pier's deck (to stand on), and at each lamp.
*/
const NEAR_HOUSES = 520;		// world units
const DRAW_HOUSES = 6000;
// THE DAMAGE (see the top): a burst's radius (metres) and what it does to a house of DAMAGE.size (cubic world units) right by it
const BURSTS = { '80mm': { radius: 8, amount: 0.16 }, 'bomb': { radius: 14, amount: 1.0 } };
const DAMAGE = { bullet: 0.004, size: 1700, smokeFrom: 0.15, flamesFrom: 0.7, near: 2500 };	// near: world units from the camera a house smokes
const WINDOW_SMOKE = [0.6, 7];		// puffs a second out of its windows, just past DAMAGE.smokeFrom and nearly down
const PLUME = { seconds: 70, puffs: 10, smoulder: 240 };
const RUBBLE_TOP = 0.8;				// world units over its floor: the heap's boxes, walked over (as hunting.js's STEP)
const SHARE_SECONDS = 0.5;
const VERTEX_FLOATS = 8;
const INSTANCE_FLOATS = 28;

export const townStats = { towns: 0, houses: 0, groundTriangles: 0, triangles: 0, drawnHouses: 0, boxes: 0, lamps: 0 };

// THE TOWNS' NAMES (the Horde game mode says them, horde.js): one each, from the land's seed, the same on every machine
const NAMES = ['Gullhaven', 'Saltmarsh', 'Kestrel Bay', 'Wrenmouth', 'Port Alder', 'Brinecombe', 'Seacliff', 'Oyster Cove', 'Lanternmouth', 'Driftwick', 'Heronsea', 'Tidewell'];
export function townName(index) {
	const first = Math.abs(Math.floor(settings.terrainSeed ?? 0)) % NAMES.length;
	return NAMES[(first + index * 5) % NAMES.length];
}
// the middle of a town (world units: the middle of its houses) and how far its houses go out from it: { x, z, reach }
const middles = new WeakMap();
export function townMiddle(t) {
	let mid = middles.get(t);
	if (!mid) {
		const list = t.buildings.filter((b) => !b.onPier), n = Math.max(list.length, 1);
		const x = list.reduce((s, b) => s + b.x, 0) / n, z = list.reduce((s, b) => s + b.z, 0) / n;
		mid = { x, z, reach: list.reduce((r, b) => Math.max(r, Math.hypot(b.x - x, b.z - z)), 0) };
		middles.set(t, mid);
	}
	return mid;
}

//-------------------------------MESHES-------------------------------
// a unit box (the footings: stretched to each house), its pattern from the world
const FOOTING = (() => { const m = townMeshBuilder(); m.box(-0.5, 0, -0.5, 0.5, 1, 0.5, MAT.STONE, ['bottom', 'top'], MAT.STONE, 1); return m.done(); })();
// THE RUBBLE (see THE DAMAGE at the top): a heap over a house's footprint (x and z -0.5 to 0.5, stretched to it), up to RUBBLE_HIGH world
//		units in the middle (more for a taller house: up to twice), its plaster and stone in a mound, broken beams and slabs of its roof and
//		blocks of its walls lying on it
const RUBBLE_HIGH = 5;
const RUBBLE = (() => {
	const m = townMeshBuilder(), N = 7;
	let seed = 7;
	const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
	const lumps = Array.from({ length: (N + 1) * (N + 1) }, () => 0.75 + 0.5 * random());
	const at = (i, j) => {
		const x = i / N - 0.5, z = j / N - 0.5, r = Math.min(Math.hypot(x, z) * 2, 1);
		const edge = i == 0 || j == 0 || i == N || j == N;
		return [x, edge ? 0 : (1 - r * r) * RUBBLE_HIGH * lumps[i * (N + 1) + j], z];
	};
	for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
		const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
		m.quad(a, b, c, d, random() < 0.3 ? MAT.STONE : MAT.PLASTER, [[a[0] * 9, a[2] * 9], [b[0] * 9, b[2] * 9], [c[0] * 9, c[2] * 9], [d[0] * 9, d[2] * 9]]);
	}
	// a box turned any way: its middle and its three half axes
	const slab = (c, u, v, w, material) => {
		const p = (a, b, d) => [0, 1, 2].map((k) => c[k] + u[k] * a + v[k] * b + w[k] * d);
		const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
		for (const s of [-1, 1]) {
			m.quad(p(-1, -1, s), p(1, -1, s), p(1, 1, s), p(-1, 1, s), material, uv);
			m.quad(p(s, -1, -1), p(s, 1, -1), p(s, 1, 1), p(s, -1, 1), material, uv);
			m.quad(p(-1, s, -1), p(1, s, -1), p(1, s, 1), p(-1, s, 1), material, uv);
		}
	};
	for (let k = 0; k < 22; k++) {
		const x = (random() - 0.5) * 0.8, z = (random() - 0.5) * 0.8, s = 0.02 + random() * 0.03, up = 0.3 + random() * 0.8;
		const y = (1 - Math.min(Math.hypot(x, z) * 2, 1) ** 2) * RUBBLE_HIGH * 0.9;
		slab([x, y + up * 0.5, z], [s, 0.2 * random(), s * 0.3], [0, up * 0.6, 0], [-s * 0.3, 0.1 * random(), s], k % 3 ? MAT.PLASTER : MAT.STONE);
	}
	for (let k = 0; k < 6; k++) {
		const x = (random() - 0.5) * 0.6, z = (random() - 0.5) * 0.6, a = random() * Math.PI, tilt = 0.25 + random() * 0.5;
		const y = (1 - Math.min(Math.hypot(x, z) * 2, 1) ** 2) * RUBBLE_HIGH * 0.8;
		const along = [Math.cos(a) * Math.cos(tilt) * 0.3, Math.sin(tilt) * 3, Math.sin(a) * Math.cos(tilt) * 0.3];
		if (k < 4) slab([x, y, z], along, [0, 0.25, 0], [-Math.sin(a) * 0.012, 0, Math.cos(a) * 0.012], MAT.TIMBER);
		else slab([x, y + 0.3, z], [Math.cos(a) * 0.16, Math.sin(tilt) * 1.5, Math.sin(a) * 0.16], [-Math.sin(a) * 0.14, 0, Math.cos(a) * 0.14], [0, 0.15, 0], MAT.ROOF);
	}
	return m.done();
})();

//-------------------------------THE GROUND WORK-------------------------------
function groundWork(towns, seaLevel, strip, paths, groundAt, zoneAt, towers) {
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
		const forest = fine.map(([x, , z]) => zoneAt(x, z) == terrain.ZONE_FOREST ? 1 : 0);
		const leafy = forest.map((_, i) => { const near = forest.slice(Math.max(i - 6, 0), i + 7); return near.reduce((s, v) => s + v, 0) / near.length; });
		ribbon(fine, PATHS.half * 2 + 0.8, MAT.PATH, 0.08, groundAt, leafy);
	}
	for (const [x, z] of towers ?? []) fireTower(m, x, z, groundAt);
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

// THE FIRE TOWER (terrain.land.fireTowers: on a top in the mountains, with a footpath up to it, see footpaths.js): a lookout's cab
//		of timber and glass on four splayed legs, braced in three panels, a walkway round the cab with a rail, and a ladder up one side.
//		About 770 triangles. In metres (TOWER) from its foot, the ground under its middle: each leg goes down to the ground under it
const TOWER = { base: 2.2, top: 1.6, floor: 11, cab: 1.6, walk: 2.3, wall: 1.0, window: 2.3, roof: 3.4, levels: [1.5, 5.0, 8.0, 11] };
function fireTower(m, x, z, groundAt) {
	const M = settings.forestUnitsPerMetre, y0 = groundAt(x, z), yF = y0 + TOWER.floor * M;
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
const rubbleBuffer = meshBuffer('town rubble', RUBBLE);

let ground = null;			// the ground work's buffer
let builtFor = null;		// the land it was made for
let houses = [];			// every house: { building, town, matrix, footing (its matrix), height, colours, index, damage, rubble (its heap's matrix),
							//		smokeDue, downAt (seconds, when it came down here), boxes ([first, after]: its in boxes) }
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
				each(boxes[o], boxes[o + 1], boxes[o + 2], boxes[o + 3], boxes[o + 4], at);
			}
		}
	}
}
// a bullet's step from a to b against the boxes near it: the first one it goes into (slabs: the line's way in and out of each pair of faces).
//		One of a house's: its damage (see THE DAMAGE at the top: on the host, the joiners' bullets too, remoteToo)
ballistics.addTarget((ax, ay, az, bx, by, bz) => {
	if (boxes.length == 0) return null;
	const dx = bx - ax, dy = by - ay, dz = bz - az;
	let best = null;
	boxesNear((ax + bx) / 2, (az + bz) / 2, Math.hypot(dx, dz) / 2 + 2, (x, z, half, bottom, top, at) => {
		let t0 = 0, t1 = 1;
		for (const [o, d, lo, hi] of [[ax, dx, x - half, x + half], [ay, dy, bottom, top], [az, dz, z - half, z + half]]) {
			if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = 2; break; } continue; }
			let ta = (lo - o) / d, tb = (hi - o) / d;
			if (ta > tb) [ta, tb] = [tb, ta];
			t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
			if (t0 > t1) break;
		}
		if (t0 <= t1 && t0 <= 1 && (!best || t0 < best.t)) {
			const h = houses[boxHouse[at]];
			best = { t: t0, what: 'wall', remoteToo: true, hit: (velocity, bullet) => { if (h && housesHere()) harmHouse(h, DAMAGE.bullet * (ballistics.ROUNDS[bullet?.round]?.damage ?? 1) / sizeOf(h)); } };
		}
	});
	return best;
});
let boxHouse = new Int32Array(0);		// each box's house (its number in houses), or -1

function makeBoxes(towns, towers = [], groundAt = null) {
	const list = [];
	const add = (x, z, half, bottom, top) => list.push(x, z, half, bottom, top);
	// (the fire tower's legs)
	for (const [x, z] of towers) {
		const M = settings.forestUnitsPerMetre, y0 = groundAt(x, z);
		for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
			const lx = x + sx * (TOWER.base - 0.3) * M, lz = z + sz * (TOWER.base - 0.3) * M;
			add(lx, lz, 0.25 * M, groundAt(lx, lz) - M, y0 + TOWER.floor * M);
		}
	}
	for (const h of houses) {
		const b = h.building, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
		// round its walls: squares along them, a little inside them
		const hw = b.width / 2, hd = b.depth / 2, step = 2.2, half = 1.0 * (Math.abs(c) + Math.abs(s));
		const ring = [];
		for (let u = -hw + 1; u <= hw - 1 + 0.01; u += step) ring.push([u, -hd + 1], [u, hd - 1]);
		for (let w = -hd + 1 + step; w <= hd - 1 - step + 0.01; w += step) ring.push([-hw + 1, w], [hw - 1, w]);
		const first = list.length / 5;
		for (const [u, w] of ring) add(b.x + u * c + w * s, b.z - u * s + w * c, half, b.footing, b.y + h.height);
		h.boxes = [first, list.length / 5];
	}
	for (const town of towns) {
		for (const wall of town.walls) {
			for (let j = 0; j < wall.points.length - 1; j++) {
				const [ax, az, at, ab] = wall.points[j], [bx, bz, bt, bb] = wall.points[j + 1];
				const n = Math.max(Math.ceil(Math.hypot(bx - ax, bz - az) / 1.2), 1);
				for (let k = 0; k < n; k++) add(ax + (bx - ax) * k / n, az + (bz - az) * k / n, 0.65, Math.min(ab, bb), at + (bt - at) * k / n);
			}
		}
		for (const pier of [town.pier, town.dock]) {
			if (!pier) continue;
			const { a, b, width } = pier, len = Math.hypot(b[0] - a[0], b[2] - a[2]);
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
	boxHouse = new Int32Array(boxes.length / 5).fill(-1);
	houses.forEach((h, i) => { for (let k = h.boxes[0]; k < h.boxes[1]; k++) boxHouse[k] = i; });
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
	const work = groundWork(towns, settings.waterWorldPosY, land.strip, land.paths, land.groundAt, land.zoneAt, land.fireTowers);
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
			const rubble = mat4.scale(mat4.rotateY(mat4.translation([b.x, b.y, b.z]), b.yaw), [b.width, Math.min(Math.max(mesh.height / 14, 0.8), 2), b.depth]);
			houses.push({ building: b, town, matrix, footing: b.onPier ? null : footing, height: mesh.height, mesh, index: houses.length, damage: 0, rubble, smokeDue: 0, downAt: -1, boxes: [0, 0] });		// (the shack stands on its own posts)
		}
	}
	dirty.clear();
	const needed = (houses.length * 2 + 4) * INSTANCE_FLOATS;
	if (instanceData.length < needed) {
		instanceData = new Float32Array(needed);
		instanceBuffer.destroy();
		instanceBuffer = device.createBuffer({ label: "town instances", size: instanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	}
	makeBoxes(towns, land.fireTowers, land.groundAt);
	setTownMask(...maskOf(towns, land.strip, land.paths));
	// (what the host said of them before they were here)
	for (const [i, d] of heard) if (houses[i]) setDamage(houses[i], d, true);
	heard.clear();
	// the lamps light what is round them by night (pointLights.js): from the lantern, warm, about 12 metres out
	setStillLights('town', towns.flatMap((t) => t.lamps.map(([x, y, z]) => ({ at: [x, y + 6.9, z], radius: 22, colour: [1.0, 0.7, 0.4], strength: 4.0 }))));
	townStats.towns = towns.length;
	townStats.houses = houses.length;
	townStats.lamps = towns.reduce((n, t) => n + t.lamps.length, 0);
}

// where the grass does not grow (townMask.js): the roads and walls a little wider than they are drawn, under the houses and lamps
function maskOf(towns, strip, paths) {
	const stretches = [], boxes = [];
	// (the footpaths, their edges ragged and a tuft of grass on them here and there; the landing strip's earth, ragged at its edges)
	for (const path of paths ?? []) for (let j = 0; j < path.points.length - 1; j++) stretches.push({ a: [path.points[j][0], path.points[j][2]], b: [path.points[j + 1][0], path.points[j + 1][2]], half: PATHS.half + 0.3, ragged: 0.9, tufts: 0.06 });
	if (strip) boxes.push({ at: [strip.x, strip.z], axis: [strip.ax, strip.az], half: [strip.half + 1, strip.width / 2 + 1], ragged: 9 });
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
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (terrain.land && terrain.land !== builtFor) build();
	if (settings.enableTerrain) burning(dt);
}

// THE DAMAGE (see the top)
//-------------------------------------------------
// whether this machine keeps the houses' damage: alone, or the host (net.js sets townNet.roleNow)
export const townNet = { roleNow: () => 'off' };
export const housesHere = () => townNet.roleNow() != 'joined';
const collapseListeners = [];
// told when a house comes down: fn(where (world units), the house's number)
export function onCollapse(fn) { collapseListeners.push(fn); }
// how hard a house is to knock down: 1 for one of DAMAGE.size, more for a bigger one
function sizeOf(h) {
	const b = h.building;
	return Math.sqrt(Math.min(Math.max(b.width * b.depth * h.height / DAMAGE.size, 0.4), 4));
}
// a shell or a bomb (round) bursting at (world units): every house near it (on the host, or alone)
export function blast(at, round) {
	if (!housesHere() || !houses.length) return;
	const R = BURSTS[round] ?? BURSTS['80mm'], m = settings.forestUnitsPerMetre, reach = R.radius * m;
	for (const h of houses) {
		const b = h.building;
		if (h.damage >= 1 || Math.abs(b.x - at[0]) > reach + b.width + b.depth || Math.abs(b.z - at[2]) > reach + b.width + b.depth) continue;
		// (how far it is from the house's walls: in its own directions)
		const c = Math.cos(b.yaw), s = Math.sin(b.yaw), dx = at[0] - b.x, dz = at[2] - b.z;
		const u = dx * c - dz * s, w = dx * s + dz * c;
		const d = Math.hypot(Math.max(Math.abs(u) - b.width / 2, 0), Math.max(Math.abs(w) - b.depth / 2, 0), Math.max(b.footing - at[1], at[1] - (b.y + h.height), 0)) / m;
		if (d < R.radius) harmHouse(h, R.amount * (1 - d / R.radius) / sizeOf(h));
	}
}
export function harmHouse(h, amount) { if (amount > 0 && h.damage < 1) setDamage(h, Math.min(h.damage + amount, 1)); }
// mended by so much (0 to 1), if it is still standing
export function mendHouse(h, amount) { if (h.damage > 0 && h.damage < 1) setDamage(h, Math.max(h.damage - amount, 0)); }
// every house whole again (a game mode over: horde.js)
export function restoreHouses() { for (const h of houses) if (h.damage > 0) setDamage(h, 0); }
const dirty = new Set();
function setDamage(h, d, quietly = false) {
	const was = h.damage;
	if (d == was) return;
	h.damage = d;
	dirty.add(h.index);
	if (was < 1 && d >= 1) collapse(h, quietly);
	if (was >= 1 && d < 1) { h.downAt = -1; heap(h, false); }
}
// down: its boxes only as high as the heap's, the ball of fire, the dust, the column of smoke (quietly: one that was down already, for
//		a joiner coming in: the heap only)
function collapse(h, quietly) {
	heap(h, true);
	if (quietly) return;
	const b = h.building, m = settings.forestUnitsPerMetre;
	h.downAt = performance.now() / 1000;
	const middle = [b.x, b.y + h.height * 0.35, b.z];
	smoke.blast(middle, 10);
	const reach = Math.max(b.width, b.depth) / 2 / m;
	for (let k = 0; k < 18; k++) {
		const a = k / 18 * Math.PI * 2 + Math.random() * 0.3, speed = 3 + Math.random() * 3;
		smoke.addPuff({ at: [b.x + Math.cos(a) * reach * 0.6 * m, b.y + 0.5 * m, b.z + Math.sin(a) * reach * 0.6 * m], v: [Math.cos(a) * speed, 0.6, Math.sin(a) * speed], size: 1.6 + Math.random(),
			grow: 2.6, life: 5 + Math.random() * 2, kind: 2, rise: 0.05, delay: 0.1 });
	}
	for (const fn of collapseListeners) fn(middle, h.index);
}
function heap(h, down) {
	const b = h.building;
	for (let k = h.boxes[0]; k < h.boxes[1]; k++) boxes[k * 5 + 4] = down ? b.y + RUBBLE_TOP : b.y + h.height;
}
// each frame: smoke out of the windows of the houses that are hurt, the columns over the ones that are down (only near the camera)
function burning(dt) {
	const m = settings.forestUnitsPerMetre, now = performance.now() / 1000;
	for (const h of houses) {
		if (h.damage < DAMAGE.smokeFrom) continue;
		const b = h.building;
		if (Math.abs(b.x - settings.camPosX) > DAMAGE.near || Math.abs(b.z - settings.camPosZ) > DAMAGE.near) continue;
		if (h.damage >= 1) {
			const t = now - h.downAt;
			if (h.downAt < 0 || t > PLUME.smoulder) continue;
			const plume = t < PLUME.seconds;
			h.smokeDue += dt * (plume ? PLUME.puffs * (1 - 0.6 * t / PLUME.seconds) : 0.7);
			for (; h.smokeDue >= 1; h.smokeDue--) {
				const u = (Math.random() - 0.5) * 0.6 * b.width, w = (Math.random() - 0.5) * 0.6 * b.depth, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
				smoke.addPuff({ at: [b.x + u * c + w * s, b.y + 2 * m, b.z - u * s + w * c], v: [0, plume ? 3 : 1, 0], size: plume ? 1.6 + Math.random() * 0.8 : 0.8, grow: plume ? 3 : 2.5,
					life: plume ? 12 + Math.random() * 6 : 7, kind: 1, dark: plume ? 0.6 : 0.4, rise: plume ? 1.5 : 0.5 });
			}
			continue;
		}
		const worse = (h.damage - DAMAGE.smokeFrom) / (1 - DAMAGE.smokeFrom);
		h.smokeDue += dt * (WINDOW_SMOKE[0] + (WINDOW_SMOKE[1] - WINDOW_SMOKE[0]) * worse);
		for (; h.smokeDue >= 1; h.smokeDue--) {
			const [at, out] = windowOf(h);
			const flame = h.damage > DAMAGE.flamesFrom && Math.random() < 0.3;
			smoke.addPuff(flame ? { at, v: out.map((v, i) => v * 0.6 + (i == 1 ? 0.8 : 0)), size: 0.5 + Math.random() * 0.3, grow: 1.6, life: 0.9, kind: 0, rise: 1.5 }
				: { at, v: out.map((v, i) => v * 1.2 + (i == 1 ? 0.8 : 0)), size: 0.6 + 0.6 * worse, grow: 3.5, life: 10 + Math.random() * 4, kind: 1, dark: 0.3 + 0.55 * worse, rise: 1.4 });
		}
	}
}
// a window of a house, at random: where, just outside it (world units), and the way out of it. On every face, at each storey up its walls
//		(as townBuildings.js lays them out: bays along the face, a sill a storey)
function windowOf(h) {
	const b = h.building, m = settings.forestUnitsPerMetre;
	const storeys = Math.max(Math.floor((h.height - GROUND_FLOOR) / FLOOR_HEIGHT) + 1, 1);
	const storey = Math.floor(Math.random() * storeys), y = (storey == 0 ? 1.8 : GROUND_FLOOR + (storey - 1) * FLOOR_HEIGHT + 1.5) + 1.6;
	const face = Math.floor(Math.random() * 4), long = face < 2 ? b.width : b.depth, deep = face < 2 ? b.depth : b.width;
	const along = (Math.random() - 0.5) * Math.max(long - 2.4, 0.5), side = face % 2 ? 1 : -1;
	const [u, w, nu, nw] = face < 2 ? [along, side * (deep / 2 + 0.4), 0, side] : [side * (deep / 2 + 0.4), along, side, 0];
	const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
	return [[b.x + u * c + w * s, b.y + Math.min(y, h.height - 1), b.z - u * s + w * c], [nu * c + nw * s, 0, -nu * s + nw * c]];
}
// MULTIPLAYER (see the top): the host's houses whose damage has changed since the last (all: every one that is hurt), [number, damage]
export function housesShare(all = false) {
	const list = all ? houses.filter((h) => h.damage > 0).map((h) => h.index) : [...dirty];
	if (!all) dirty.clear();
	return list.filter((i) => houses[i]).map((i) => [i, Math.round(houses[i].damage * 1000) / 1000]);
}
// a joiner: the host's word on them
const heard = new Map();		// (before its houses are built: kept until they are)
export function housesHeard(list, all = false) {
	if (!houses.length) { for (const [i, d] of list) heard.set(i, d); return; }
	if (all) for (const h of houses) if (h.damage > 0 && !list.some(([i]) => i == h.index)) setDamage(h, 0);
	for (const [i, d] of list) if (houses[i]) setDamage(houses[i], Math.min(Math.max(Number(d) || 0, 0), 1), all);
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
	// (scorched: its colours darker by so much)
	const put = (matrix, b, scorched = 0) => {
		const k = 1 - scorched, dark = (c) => c.map((v) => v * k);
		instanceData.set(matrix, count * INSTANCE_FLOATS);
		instanceData.set(b ? [...dark(b.plaster), b.seed, ...dark(b.roof), b.footing + 1.5, ...dark(b.trim), b.onPier ? 0 : 1] : NEUTRAL, count * INSTANCE_FLOATS + 16);
		return count++;
	};
	const scorchOf = (h) => h.damage >= 1 ? 0.45 : 0.5 * Math.min(Math.max((h.damage - 0.35) / 0.65, 0), 1);
	put(IDENTITY, null);
	const groups = new Map();		// mesh buffer -> [first instance, count]
	const visible = [];
	for (const h of houses) {
		const away = Math.hypot(h.building.x - settings.camPosX, h.building.z - settings.camPosZ);
		if (away > DRAW_HOUSES) continue;
		const mesh = h.damage >= 1 ? rubbleBuffer : away < NEAR_HOUSES ? h.mesh.full : h.mesh.plain;
		if (!groups.has(mesh)) groups.set(mesh, []);
		groups.get(mesh).push(h);
		visible.push(h);
	}
	const draws = [];
	for (const [mesh, list] of groups) {
		const first = count;
		for (const h of list) put(h.damage >= 1 ? h.rubble : h.matrix, h.building, scorchOf(h));
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
	return houses.map((h) => ({ type: BUILDING_TYPES[h.building.type].name, variant: h.building.variant, x: h.building.x, y: h.building.y, z: h.building.z, yaw: h.building.yaw, footing: h.building.footing, height: h.height, width: h.building.width, depth: h.building.depth, damage: h.damage, town: h.town }));
}
export const houseForTest = (i) => houses[i];
// a town's houses (not the shack on the pier), as they are kept here: { building, height, damage, index, ... } (war.js)
export function housesOf(t) { return houses.filter((h) => h.town === t && !h.building.onPier); }
export function damageForTest(i, d) { if (houses[i]) setDamage(houses[i], d); }
