import { DEPTH_FORMAT, depthTest, DEPTH_CLEAR } from './depthMode.js'
import {device} from './deviceSelection.js'
import { frameTexture } from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_dummy, HAT_PART as C } from '../shaders/js/vf_dummy.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as ballistics from './ballistics.js'
import * as hunting from './hunting.js'
import * as players from './players.js'
import { DUMMY_MESH, HELD_LENGTH, box, tube } from './players.js'
import { BUILDING_TYPES } from './townLayout.js'
import { seededRandom } from './terrainGenerator.js'
import { lightNow } from './lighting.js'
import * as outfits from './outfits.js'

//the townsfolk fade into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	THE TOWNSFOLK: the people of the seaside towns (townLayout.js, town.js). One to every building, its trade the building's
	(PROFESSIONS): a baker to every bakery, a fisherman to the shack on the pier, a priest to every chapel, and the houses' people
	trades of the kind of house they live in. They are the players' crash test dummies (players.js, vf_dummy.js), their arms down
	at their sides, each in the hat of its trade (HATS, made here, coloured from HAT_COLOURS in vf_dummy.js), and dressed for it (outfits.js).
	In the Survival mode the baker, the butcher, the fisherman and the innkeeper trade food, the tailor and the outfitter clothes and gear,
	and the banker keeps money (shops.js: E at one).

	THE WAYS (makeWays): every town's streets, lanes, stairs, bridges, the plaza and the pier, as one net of points and the ways
	between them. A person walks along them, a little to the right of the middle, and straight across from them to a door, a rose
	bush, a lamp.

	THE DAY. Each person's day is a run of errands, each ERRAND_SECONDS (its own, from a range) long: out of the door, along the ways
	to where the errand is (a stop or a few), a while there, back, and in again. What an errand is comes from the trade (errands in
	PROFESSIONS: its own door, the plaza, the promenade, the end of the pier, a building of a kind, the rose bushes, the lamps, a
	street near home). Whether it goes out at all is decided as the errand starts, by the light: by day (each from its own dusk on
	it stays in), by night (the lamplighter), or always (the innkeeper at the inn's door). So at dusk they finish what they are
	doing and go in, one by one, and come out again in the morning.
	It is all worked out from the time (folkSeconds, which the host shares in a game with others, net.js) and each person's own
	number: everyone in a game sees the same people in the same places, and nothing about them has to be sent.

	THE PLAYERS. Out of doors, a person steps aside from a player who comes within MAKE_ROOM (a push on top of where its day has it,
	so its day goes on as it was), and turns its head to look at the nearest one within LOOK_AT. The walker cannot walk through
	them (folkNear, for hunting.js).
	SHOT (DUMMY_SPHERES as players.js, more or less): it flinches, flashing red, then runs home (RUN, along the ways from where it
	was hit) and stays in until its errand is over. The one who fired tells the others (onFolkShot, net.js), with the time it
	happened, so it runs the same way everywhere (folkShotHeard).

	THE HORDE (horde.js). A person fighting the horde (setFight: where it stands, which way it aims, the gun in its hands) stands there
	instead of where its day has it, and when the fight is over runs home from there. One a deer got to (turnFolk) is gone, turned,
	until the towns are whole again (restoreFolk). In a game with others the host says who is fighting and who has turned. Fleeing to
	the schooner (horde.js: THE EVACUATION) a person is wherever the horde leads it (setLed: out of doors, whatever the hour), and once
	aboard it is gone (boardFolk) until the towns are whole again. THE WAR (war.js) kills them (killFolk), and is told of every hit on
	one (folkHit), and the townsfolk's own rounds (theirs: 'folk' and 'folk:' and a number) do not hit them.

	THE DRAWING: one draw for every trade (the dummy and its hat), of the people out of doors within DRAW_DISTANCE. One with a gun
	in its hands is the dummy with the players' gun (players.js), held where it aims. The people of npcs.js (the riders, the airmen,
	the sailors) are drawn with them (addFolkSource), in the hats made for them here.
*/
const ERRAND_SECONDS = [70, 140];
const WALK = 1.25;					// metres a second
const STRIDE = 1.4;					// metres a stride takes
const REST = [4, 10];				// seconds indoors between errands, at least
const DRAW_DISTANCE = 900;			// world units
const MAX_DRAWN = 640;
const DUMMY_FLOATS = 20;			// (as players.js)
const MAKE_ROOM = 1.6;				// metres
const LOOK_AT = 7;					// metres
const RUN = 3.4;					// metres a second, home when shot
const FLINCH = 0.45;				// seconds
// the hitbox, in the dummy's own metres: x, y, z, radius
const SPHERES = [[0, 1.71, 0.01, 0.14], [0, 1.33, 0, 0.21], [0, 1.0, 0, 0.19], [-0.1, 0.72, 0, 0.1], [0.1, 0.72, 0, 0.1], [-0.1, 0.3, 0, 0.09], [0.1, 0.3, 0, 0.09]];

/*
	The trades, by building type. errands: what an errand is, and how likely ('door' its own, 'plaza', 'promenade', 'pierEnd',
	'street' near home, 'garden' (rose bushes), 'lamps', or a building type: the nearest one's door). hours: 'day', 'night', 'always'
*/
export const PROFESSIONS = {
	bakery: { name: 'baker', hat: 'toque', errands: { door: 0.6, plaza: 0.2, inn: 0.2 } },
	library: { name: 'librarian', hat: 'mortarboard', errands: { door: 0.5, plaza: 0.4, shop: 0.1 } },
	shack: { name: 'fisherman', hat: 'souwester', errands: { pierEnd: 0.6, inn: 0.2, promenade: 0.2 } },
	shop: { name: 'outfitter', hat: 'boater', errands: { door: 0.7, warehouse: 0.15, plaza: 0.15 } },
	chapel: { name: 'priest', hat: 'saturno', errands: { door: 0.5, plaza: 0.3, street: 0.2 } },
	hotel: { name: 'bellhop', hat: 'pillbox', errands: { door: 0.7, plaza: 0.15, street: 0.15 } },
	inn: { name: 'innkeeper', hat: 'tricorn', errands: { door: 0.7, bakery: 0.15, warehouse: 0.15 }, hours: 'always' },
	warehouse: { name: 'dockworker', hat: 'beanie', errands: { promenade: 0.4, pierEnd: 0.2, door: 0.4 } },
	tower: { name: 'lamplighter', hat: 'peaked', errands: { lamps: 0.85, door: 0.15 }, hours: 'night' },
	townhouse: { name: 'tailor', hat: 'topHat', errands: { shop: 0.35, plaza: 0.3, hotel: 0.15, street: 0.2 } },
	mansard: { name: 'banker', hat: 'bowler', errands: { plaza: 0.4, hotel: 0.3, street: 0.3 } },
	timbered: { name: 'butcher', hat: 'flatCap', errands: { warehouse: 0.4, door: 0.3, street: 0.3 } },
	turret: { name: 'painter', hat: 'beret', errands: { promenade: 0.55, plaza: 0.25, street: 0.2 } },
	cottages: { name: 'gardener', hat: 'strawHat', errands: { garden: 0.75, street: 0.25 } },
	gabled: { name: 'sea captain', hat: 'captain', errands: { promenade: 0.4, pierEnd: 0.3, inn: 0.3 } },
};

//-------------------------------THE HATS-------------------------------
// In the dummy's metres: its head is a box 0.2 across and 0.22 front to back, its top at y = 1.82, its front to +z. A hat is triangles
//		of [a, b, c, part], its part 12 and its colour (HAT_PART in vf_dummy.js), so it tips with the head
const ring = (y, r, sides, { deep = 1.08, cx = 0, cz = 0.01, from = 0, to = Math.PI * 2, shape = null } = {}) => {
	const whole = to - from >= Math.PI * 2 - 1e-6, n = whole ? sides : sides + 1;
	return Array.from({ length: n }, (_, k) => {
		const a = from + (to - from) * k / sides;
		const [rr, yy] = shape ? shape(a) : [r, y];
		return [cx + Math.sin(a) * rr, yy, cz + Math.cos(a) * rr * deep];
	});
};
// the band between two rings of as many points (closed round, unless open)
function band(into, A, B, part, open = false) {
	const n = open ? A.length - 1 : A.length;
	for (let k = 0; k < n; k++) { const j = (k + 1) % A.length; into.push([A[k], B[k], B[j], part], [A[k], B[j], A[j], part]); }
}
function cap(into, A, part) {
	const c = [0, 1, 2].map((i) => A.reduce((s, p) => s + p[i], 0) / A.length);
	for (let k = 0; k < A.length; k++) into.push([A[k], A[(k + 1) % A.length], c, part]);
}
// a straight-sided crown from y0 to y1, radius r0 to r1, its top closed
function crown(into, y0, r0, y1, r1, sides, part, o = {}) {
	const A = ring(y0, r0, sides, o), B = ring(y1, r1, sides, o);
	band(into, A, B, part);
	cap(into, B, part);
}
const HATS = {
	// the baker's toque: a tall white crown puffed out at the top
	toque(t) {
		const A = ring(1.76, 0.118, 8), B = ring(1.97, 0.126, 8), P = ring(2.04, 0.152, 8), T = ring(2.09, 0.118, 8);
		band(t, A, B, C.white); band(t, B, P, C.white); band(t, P, T, C.white); cap(t, T, C.white);
	},
	// the librarian's mortarboard: a skull cap, the square board on it, the tassel
	mortarboard(t) {
		crown(t, 1.76, 0.114, 1.86, 0.114, 8, C.black);
		box(t, 1.86, [0.17, -0.16, 0.18], 1.885, [0.17, -0.16, 0.18], C.black);
		tube(t, [0, 1.887, 0.01], [0.15, 1.887, 0.16], 0.008, 0.008, C.gold);
		tube(t, [0.15, 1.887, 0.16], [0.16, 1.79, 0.17], 0.01, 0.018, C.gold);
	},
	// the fisherman's sou'wester: a round crown, the brim sloping down, long at the back over the neck
	souwester(t) {
		crown(t, 1.75, 0.12, 1.92, 0.095, 8, C.oilskin);
		band(t, ring(1.75, 0.12, 8), ring(1.69, 0.2, 8, { cz: -0.05, deep: 1.35 }), C.oilskin);
	},
	// the shopkeeper's straw boater: a flat crown, a black band, a flat brim
	boater(t) {
		crown(t, 1.785, 0.116, 1.88, 0.116, 8, C.straw);
		band(t, ring(1.79, 0.119, 8), ring(1.83, 0.119, 8), C.black);
		band(t, ring(1.785, 0.116, 8), ring(1.785, 0.215, 8), C.straw);
	},
	// the priest's round hat: a wide flat brim, a low dome
	saturno(t) {
		band(t, ring(1.79, 0.115, 10), ring(1.795, 0.28, 10, { deep: 1 }), C.black);
		const A = ring(1.79, 0.12, 8), B = ring(1.86, 0.1, 8), T = ring(1.9, 0.05, 8);
		band(t, A, B, C.black); band(t, B, T, C.black); cap(t, T, C.black);
	},
	// the bellhop's pillbox: a little red drum, a gold band, worn a little forward
	pillbox(t) {
		crown(t, 1.8, 0.086, 1.9, 0.086, 8, C.red, { cz: 0.03 });
		band(t, ring(1.8, 0.089, 8, { cz: 0.03 }), ring(1.83, 0.089, 8, { cz: 0.03 }), C.gold);
	},
	// the innkeeper's tricorn: a low crown, the brim turned up into three points, one to the front
	tricorn(t) {
		crown(t, 1.77, 0.11, 1.88, 0.095, 8, C.brown);
		const point = (a) => Math.pow(Math.max(Math.cos(3 * a), 0), 2);
		band(t, ring(1.775, 0.112, 12), ring(0, 0, 12, { deep: 1, shape: (a) => [0.17 + 0.08 * point(a), 1.875 - 0.04 * point(a)] }), C.brown);
	},
	// the dockworker's knitted beanie, its cuff turned up
	beanie(t) {
		const A = ring(1.72, 0.119, 8), B = ring(1.84, 0.119, 8), T = ring(1.9, 0.075, 8);
		band(t, A, B, C.navy); band(t, B, T, C.navy); cap(t, T, C.navy);
		band(t, ring(1.72, 0.125, 8), ring(1.77, 0.125, 8), C.navy);
	},
	// the lamplighter's peaked cap: a flat top wider than the band, a black peak
	peaked(t) {
		band(t, ring(1.78, 0.11, 8), ring(1.84, 0.115, 8), C.blue);
		crown(t, 1.84, 0.115, 1.865, 0.132, 8, C.blue);
		band(t, ring(1.785, 0.113, 4, { from: -1.0, to: 1.0 }), ring(1.765, 0.2, 4, { from: -0.9, to: 0.9, deep: 1.05 }), C.black, true);
	},
	// the merchant's top hat: a tall black crown, a red band, a narrow brim
	topHat(t) {
		band(t, ring(1.785, 0.108, 10), ring(1.79, 0.175, 10), C.black);
		crown(t, 1.785, 0.103, 2.04, 0.108, 8, C.black);
		band(t, ring(1.795, 0.106, 8), ring(1.84, 0.107, 8), C.crimson);
	},
	// the banker's bowler: a round black crown, a narrow curled brim
	bowler(t) {
		const A = ring(1.78, 0.116, 8), B = ring(1.88, 0.11, 8), T = ring(1.93, 0.065, 8);
		band(t, A, B, C.black); band(t, B, T, C.black); cap(t, T, C.black);
		band(t, ring(1.785, 0.116, 8), ring(1.8, 0.158, 8), C.black);
	},
	// the carpenter's flat cap: low, its top pulled forward over a short peak
	flatCap(t) {
		const A = ring(1.78, 0.116, 8), T = ring(1.85, 0.128, 8, { cz: 0.045 });
		band(t, A, T, C.tweed); cap(t, T, C.tweed);
		band(t, ring(1.79, 0.118, 4, { from: -0.9, to: 0.9 }), ring(1.785, 0.19, 4, { from: -0.8, to: 0.8 }), C.tweed, true);
	},
	// the painter's beret: a flat round cap, pulled down to one side, a little stalk on top
	beret(t) {
		const A = ring(1.79, 0.116, 8), B = ring(1.84, 0.152, 8, { cx: 0.03 }), T = ring(1.865, 0.1, 8, { cx: 0.035 });
		band(t, A, B, C.crimson); band(t, B, T, C.crimson); cap(t, T, C.crimson);
		tube(t, [0.035, 1.86, 0.01], [0.04, 1.9, 0.01], 0.01, 0.006, C.crimson);
	},
	// the gardener's straw hat: a wide brim drooping at the edge, a green band
	strawHat(t) {
		band(t, ring(1.79, 0.112, 10), ring(1.75, 0.3, 10, { deep: 1 }), C.straw);
		crown(t, 1.79, 0.112, 1.9, 0.1, 8, C.straw);
		band(t, ring(1.795, 0.115, 8), ring(1.83, 0.113, 8), C.green);
	},
	// the sea captain's cap: a black band, a white top wider than it, a black peak, a gold badge
	captain(t) {
		band(t, ring(1.78, 0.11, 8), ring(1.85, 0.114, 8), C.black);
		crown(t, 1.85, 0.114, 1.885, 0.138, 8, C.white);
		band(t, ring(1.785, 0.113, 4, { from: -1.0, to: 1.0 }), ring(1.765, 0.2, 4, { from: -0.9, to: 0.9 }), C.black, true);
		box(t, 1.81, [0.025, 0.12, 0.128], 1.84, [0.025, 0.12, 0.128], C.gold);
	},
	// (the people of npcs.js) the airman's leather flying helmet: close round the head and down over the ears, its goggles up on the brow
	aviator(t) {
		const A = ring(1.68, 0.152, 8), B = ring(1.8, 0.15, 8), T = ring(1.86, 0.09, 8);
		band(t, A, B, C.brown); band(t, B, T, C.brown); cap(t, T, C.brown);
		for (const s of [1, -1]) box(t, 1.6, [0.03, -0.04, 0.04], 1.7, [0.03, -0.045, 0.045], C.brown, s * 0.125);
		band(t, ring(1.78, 0.156, 8), ring(1.805, 0.156, 8), C.black);
		for (const s of [1, -1]) box(t, 1.77, [0.032, 0.1, 0.135], 1.815, [0.032, 0.1, 0.135], C.gold, s * 0.048);
	},
	// the sailor's white cap, round, its brim turned up all round
	sailor(t) {
		const A = ring(1.76, 0.118, 8), T = ring(1.86, 0.1, 8);
		band(t, A, T, C.white); cap(t, T, C.white);
		band(t, ring(1.76, 0.12, 8), ring(1.81, 0.15, 8), C.white);
	},
	// the rider's broad-brimmed hat: a creased crown, a wide brim turned up a little at the sides
	stetson(t) {
		const A = ring(1.78, 0.115, 8), B = ring(1.9, 0.1, 8), T = ring(1.93, 0.07, 8);
		band(t, A, B, C.brown); band(t, B, T, C.brown); cap(t, T, C.brown);
		band(t, ring(1.79, 0.118, 8), ring(1.82, 0.118, 8), C.black);
		band(t, ring(1.785, 0.115, 10), ring(0, 0, 10, { deep: 1, shape: (a) => [0.26, 1.8 + 0.035 * Math.sin(a) ** 2] }), C.brown);
	},
};

//-------------------------------THE WAYS-------------------------------
// A town's ways as a net: nodes { x, y, z, ways: [[to, length, width, pace]] }. nearest(x, z): the node nearest a place
export function makeWays(town) {
	const nodes = [], index = new Map();
	const node = (p) => {
		const key = Math.round(p[0] * 10) + ',' + Math.round(p[2] * 10);
		let n = index.get(key);
		if (n === undefined) { n = nodes.length; nodes.push({ x: p[0], y: p[1], z: p[2], ways: [] }); index.set(key, n); }
		return n;
	};
	const join = (a, b, width, pace = 1) => {
		if (a == b) return;
		const A = nodes[a], B = nodes[b], d = Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z);
		A.ways.push([b, d, width, pace]); B.ways.push([a, d, width, pace]);
	};
	const line = (points, width, pace) => { for (let j = 0; j < points.length - 1; j++) join(node(points[j]), node(points[j + 1]), width, pace); };
	for (const s of town.streets) line(s.points, s.width);
	for (const l of town.lanes ?? []) line(l.points, l.width);
	for (const b of town.bridges ?? []) line(b.points, b.width);
	for (const l of town.links) line([l.a, l.b], l.width, l.stairs ? 0.75 : 1);
	const nearest = (x, z, among = null) => {
		let best = -1, bestD = Infinity;
		nodes.forEach((n, k) => { if (among && !among(n)) return; const d = (n.x - x) ** 2 + (n.z - z) ** 2; if (d < bestD) { bestD = d; best = k; } });
		return best;
	};
	if (town.plaza) { const P = town.plaza; line([P.at, [P.x, P.y, P.z]], P.deep * 2); }
	if (town.pier) {
		const { a, b, width } = town.pier, from = nearest(a[0], a[2]);
		line([[nodes[from].x, nodes[from].y, nodes[from].z], [a[0], a[1] + 0.25, a[2]], [b[0], b[1] + 0.25, b[2]]], width);
	}
	return { nodes, nearest, node };
}

// The way from node a to node b (A*): a list of nodes, or null
export function wayBetween(ways, a, b) {
	const { nodes } = ways;
	if (a == b) return [a];
	const cost = new Map([[a, 0]]), from = new Map();
	const guess = (k) => Math.hypot(nodes[k].x - nodes[b].x, nodes[k].z - nodes[b].z);
	const heap = [[guess(a), a]];
	const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
	const pop = () => {
		const top = heap[0], last = heap.pop();
		if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m == i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
		return top;
	};
	while (heap.length) {
		const [, k] = pop();
		if (k == b) {
			const path = [b];
			while (path[0] != a) path.unshift(from.get(path[0]));
			return path;
		}
		for (const [to, length, , pace] of nodes[k].ways) {
			const c = cost.get(k) + length / pace;
			if (c < (cost.get(to) ?? Infinity)) { cost.set(to, c); from.set(to, k); push([c + guess(to), to]); }
		}
	}
	return null;
}

//-------------------------------THE PEOPLE-------------------------------
let folkSeconds = 0;
export function folkClock() { return folkSeconds; }
export function setFolkClock(seconds) { folkSeconds = seconds; }

export const townFolkStats = { folk: 0, out: 0, drawn: 0, triangles: 0, errands: 0, shot: 0 };
let folk = [];					// { town, ways, building, profession, seed, period, offset, side, dusk, hue, home (a spot), k, errand }
let builtFor = null;
const metre = () => settings.forestUnitsPerMetre;

// a place to stand: { at: [x, y, z], node, heading }
function doorOf(ways, b, out = 1.2, along = 0) {
	const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), ax = Math.cos(b.yaw), az = -Math.sin(b.yaw);
	const at = [b.x + fx * (b.depth / 2 + out) + ax * along, b.y - 0.25, b.z + fz * (b.depth / 2 + out) + az * along];
	return { at, node: ways.nearest(at[0], at[2]), heading: b.yaw };
}

function build() {
	const land = terrain.land;
	builtFor = land;
	folk = [];
	for (const [t, town] of (land?.towns ?? []).entries()) {
		if (!town.buildings.length) continue;
		const ways = makeWays(town);
		if (!ways.nodes.length) continue;
		town.buildings.forEach((b, k) => {
			const type = BUILDING_TYPES[b.type].name, profession = PROFESSIONS[type];
			if (!profession) return;
			const random = seededRandom(settings.terrainSeed * 7919 + t * 104729 + k * 31337 + 17);
			const period = ERRAND_SECONDS[0] + (ERRAND_SECONDS[1] - ERRAND_SECONDS[0]) * random();
			folk.push({ town, ways, building: b, type, profession, seed: Math.floor(random() * 1e9), period, offset: random() * period,
				side: (random() < 0.5 ? 1 : 0.6) * 1.5, dusk: 0.25 + 0.3 * random(), hue: random(), home: doorOf(ways, b, 1.2), k: -1, errand: null,
				push: [0, 0], look: 0, hit: 0, flee: null, index: folk.length });
		});
	}
	townFolkStats.folk = folk.length;
}

// Where an errand goes: a list of places to stand (and how long at each, as a share of the time there), or null
function stopsFor(person, kind, random) {
	const { town, ways, building } = person, home = person.home;
	const pick = (list) => list[Math.floor(random() * list.length)];
	const facing = (from, to) => Math.atan2(to[0] - from[0], to[2] - from[2]);
	const toSea = Math.atan2(-town.site.nx, -town.site.nz);
	switch (kind) {
		case 'door': {
			// at its own door, a step or two to one side
			const spot = doorOf(ways, building, 1.4 + random(), (random() - 0.5) * Math.min(building.width * 0.4, 4));
			return [spot];
		}
		case 'plaza': {
			const P = town.plaza;
			if (!P) return null;
			const s = (random() * 2 - 1) * (P.long - 5), d = (random() * 2 - 1) * (P.deep - 4);
			const at = [P.x + P.tx * s + P.nx * d, P.y, P.z + P.tz * s + P.nz * d];
			return [{ at, node: ways.nearest(P.x, P.z), heading: random() * Math.PI * 2 }];
		}
		case 'promenade': {
			// on its sea side, looking out
			const prom = town.streets.filter((s) => s.level == 0);
			if (!prom.length) return null;
			const street = pick(prom), p = pick(street.points);
			const at = [p[0] - town.site.nx * (street.width / 2 - 1.6), p[1], p[2] - town.site.nz * (street.width / 2 - 1.6)];
			return [{ at, node: ways.nearest(p[0], p[2]), heading: toSea + (random() - 0.5) * 0.6 }];
		}
		case 'pierEnd': {
			const pier = town.pier;
			if (!pier) return null;
			const { a, b } = pier, len = Math.hypot(b[0] - a[0], b[2] - a[2]), tx = (b[0] - a[0]) / len, tz = (b[2] - a[2]) / len;
			const side = random() < 0.5 ? 1 : -1, back = building.onPier ? 18 : 3;
			const at = [b[0] - tx * (back + random() * 6) - tz * side * 2.4, b[1] + 0.25, b[2] - tz * (back + random() * 6) + tx * side * 2.4];
			// (looking out over the side of the pier, the way the fishing line goes)
			return [{ at, node: ways.nearest(b[0], b[2]), heading: Math.atan2(-tz * side, tx * side) }];
		}
		case 'street': {
			const near = ways.nodes.map((n, k) => k).filter((k) => Math.hypot(ways.nodes[k].x - home.at[0], ways.nodes[k].z - home.at[2]) < 160);
			if (!near.length) return null;
			const n = ways.nodes[pick(near)];
			return [{ at: [n.x, n.y, n.z], node: ways.nearest(n.x, n.z), heading: random() * Math.PI * 2, onWay: true }];
		}
		case 'garden': {
			const roses = (town.roses ?? []).filter(([x, , z]) => Math.hypot(x - home.at[0], z - home.at[2]) < 90);
			if (!roses.length) return null;
			const [x, y, z] = pick(roses), node = ways.nearest(x, z), n = ways.nodes[node];
			const d = Math.hypot(n.x - x, n.z - z) || 1, at = [x + (n.x - x) / d * 2.4, terrain.land.heightAt(x + (n.x - x) / d * 2.4, z + (n.z - z) / d * 2.4), z + (n.z - z) / d * 2.4];
			return [{ at, node, heading: facing(at, [x, y, z]) }];
		}
		case 'lamps': {
			// a round of the lamps near home: three or four, a little while at each
			const lamps = town.lamps.filter(([x, , z]) => Math.hypot(x - home.at[0], z - home.at[2]) < 220);
			if (lamps.length < 2) return null;
			const stops = [];
			for (let k = 0; k < 3 + Math.floor(random() * 2); k++) {
				const [x, y, z] = pick(lamps), node = ways.nearest(x, z), n = ways.nodes[node];
				const d = Math.hypot(n.x - x, n.z - z) || 1, at = [x + (n.x - x) / d * 1.3, y, z + (n.z - z) / d * 1.3];
				stops.push({ at, node, heading: facing(at, [x, y, z]), share: 0.2 });
			}
			return stops;
		}
		default: {
			// a building of a kind: the nearest one's door, to one side of it, facing it
			const type = BUILDING_TYPES.findIndex((t) => t.name == kind);
			const others = town.buildings.filter((o) => o.type == type && o !== building);
			if (!others.length) return null;
			const o = others.reduce((best, b) => Math.hypot(b.x - home.at[0], b.z - home.at[2]) < Math.hypot(best.x - home.at[0], best.z - home.at[2]) ? b : best);
			const spot = doorOf(ways, o, 2.2 + random() * 1.5, (random() - 0.5) * 5);
			return [{ ...spot, heading: o.yaw + Math.PI }];
		}
	}
}

// A walk from one place to another: points [x, y, z] (along the ways, a little to the right) and the distance along at each
function walkBetween(person, from, to) {
	const { ways } = person;
	const nodes = wayBetween(ways, from.node, to.node);
	if (!nodes) return null;
	const raw = [{ p: from.at, width: 0 }];
	nodes.forEach((k, j) => {
		const n = ways.nodes[k], next = nodes[j + 1];
		const way = next !== undefined ? n.ways.find(([to]) => to == next) : null;
		raw.push({ p: [n.x, n.y, n.z], width: way ? way[2] : raw[raw.length - 1].width });
	});
	if (to.onWay) raw.pop();
	raw.push({ p: to.at, width: 0 });
	// to the right of the way it goes, by the person's own side, as far as the way is wide
	const points = raw.map(({ p, width }, j) => {
		const a = raw[Math.max(j - 1, 0)].p, c = raw[Math.min(j + 1, raw.length - 1)].p;
		const dx = c[0] - a[0], dz = c[2] - a[2], l = Math.hypot(dx, dz) || 1;
		const off = j == 0 || j == raw.length - 1 ? 0 : Math.min(person.side, Math.max(width / 2 - 1.0, 0));
		return [p[0] - dz / l * off, p[1], p[2] + dx / l * off];
	});
	const along = [0];
	for (let j = 1; j < points.length; j++) along.push(along[j - 1] + Math.hypot(points[j][0] - points[j - 1][0], points[j][1] - points[j - 1][1], points[j][2] - points[j - 1][2]));
	return { points, along, length: along[along.length - 1] };
}

// whether a person goes out on an errand that starts now (see THE DAY at the top)
function goesOut(person) {
	const day = lightNow().daylight;
	const hours = person.profession.hours ?? 'day';
	return hours == 'always' || (hours == 'night' ? day < 0.6 : day > person.dusk);
}

// An errand: { legs: [{ t0, t1, walk } or { t0, t1, stand }] } within the period, the rest of it indoors. k: which errand it is
function planErrand(person, k) {
	townFolkStats.errands++;
	if (!goesOut(person)) return { legs: [] };
	const random = seededRandom(person.seed + k * 7919);
	const seconds = WALK * metre();		// world units a second
	const rest = REST[0] + (REST[1] - REST[0]) * random();
	const kinds = Object.entries(person.profession.errands);
	for (let tries = 0; tries < 6; tries++) {
		// which, by how likely each is
		let r = random() * kinds.reduce((s, [, w]) => s + w, 0), kind = kinds[0][0];
		for (const [name, w] of kinds) { r -= w; if (r <= 0) { kind = name; break; } }
		const stops = stopsFor(person, kind, random);
		if (!stops) continue;
		// the walks: out to each stop in turn, and home
		const places = [person.home, ...stops, person.home];
		// (at its own door it just comes out and stands there)
		const walks = [];
		for (let j = 0; j < places.length - 1; j++) walks.push(kind == 'door' ? { points: [stops[0].at], along: [0], length: 0 } : walkBetween(person, places[j], places[j + 1]));
		if (walks.some((w) => !w)) continue;
		const walking = walks.reduce((s, w) => s + w.length, 0) / seconds;
		const standing = person.period - rest - walking;
		if (standing < 8) continue;
		// out of the door at rest / 2, then walk, stand, walk...
		const legs = [];
		let t = rest / 2;
		const shares = stops.map((s) => s.share ?? 1), whole = shares.reduce((s, x) => s + x, 0);
		walks.forEach((w, j) => {
			if (w.length > 0) { legs.push({ t0: t, t1: t + w.length / seconds, walk: w }); t += w.length / seconds; }
			if (j < stops.length) { const d = standing * shares[j] / whole; legs.push({ t0: t, t1: t + d, stand: stops[j] }); t += d; }
		});
		return { legs, kind };
	}
	return { legs: [] };
}

// Where a person is at a time into its errand: { x, y, z, heading, stride, walking } or null (indoors)
function placeAt(person, tau) {
	const leg = person.errand.legs.find((l) => tau >= l.t0 && tau < l.t1);
	if (!leg) return null;
	if (leg.stand) {
		const s = leg.stand;
		return { x: s.at[0], y: s.at[1], z: s.at[2], heading: s.heading, stride: 0, walking: 0 };
	}
	const w = leg.walk, s = (tau - leg.t0) / (leg.t1 - leg.t0) * w.length;
	const at = (d) => {
		d = Math.min(Math.max(d, 0), w.length);
		let j = 0;
		while (j < w.along.length - 2 && w.along[j + 1] < d) j++;
		const f = (d - w.along[j]) / Math.max(w.along[j + 1] - w.along[j], 1e-6), a = w.points[j], b = w.points[j + 1];
		return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
	};
	const p = at(s), ahead = at(s + 1.2), behind = at(s - 1.2);
	return { x: p[0], y: p[1], z: p[2], heading: Math.atan2(ahead[0] - behind[0], ahead[2] - behind[2]), stride: s / (STRIDE * metre()) * Math.PI, walking: 1 };
}

// Shot at folk time at: from where its day had it then, home at a run (null: indoors then, or nowhere to run)
function fleeFrom(person, at) {
	const time = at + person.offset, k = Math.floor(time / person.period);
	if (k != person.k) { person.k = k; person.errand = planErrand(person, k); }
	const p = placeAt(person, time - k * person.period);
	if (!p) return null;
	const walk = walkBetween(person, { at: [p.x, p.y, p.z], node: person.ways.nearest(p.x, p.z) }, person.home);
	return walk && { k, t0: at, walk, heading: p.heading };
}
// where a shot one is, t seconds after: flinching where it was, then running, then indoors (null)
function fleeingAt(flee, t) {
	const w = flee.walk, run = RUN * metre();
	if (t < FLINCH) return { x: w.points[0][0], y: w.points[0][1], z: w.points[0][2], heading: flee.heading, stride: 0, walking: 0, lean: 0.25 * Math.sin(Math.PI * t / FLINCH) };
	const s = (t - FLINCH) * run;
	if (s >= w.length) return null;
	const leg = { t0: 0, t1: w.length / run, walk: w };
	const p = placeAt({ errand: { legs: [leg] } }, s / run);
	return p && { ...p, stride: p.stride * 0.8, lean: 0 };
}
// shot here: fn(index, at) (net.js tells the others)
const shotListeners = [];
export function onFolkShot(fn) { shotListeners.push(fn); }
// shot, there or here: index (its place in the list, the same on every machine), at (folk time)
export function folkShotHeard(index, at) {
	const person = folk[index];
	if (!person) return;
	person.flee = fleeFrom(person, at);
	person.hit = 1;
}
// the townsfolk's hitboxes, for the bullets fired here (not their own, horde.js)
const folkBounds = () => {
	const m = metre(), list = [];
	if (settings.enableTownFolk) for (const person of folk) { const p = person.place; if (p) list.push(p.x, p.y + 1.0 * m, p.z, 1.6 * m); }
	return list;
};
ballistics.addTarget((ax, ay, az, bx, by, bz, bullet) => {
	if (!settings.enableTownFolk || folk.length == 0 || String(bullet?.shooter).startsWith('folk')) return null;
	const m = metre(), mx = (ax + bx) / 2, mz = (az + bz) / 2, reach = Math.hypot(bx - ax, bz - az) / 2 + 2 * m;
	let best = null;
	for (const person of folk) {
		const p = person.place;
		if (!p || Math.abs(p.x - mx) > reach || Math.abs(p.z - mz) > reach) continue;
		if (ballistics.crossSphere(ax, ay, az, bx, by, bz, p.x, p.y + 1.0 * m, p.z, 1.2 * m) === null) continue;
		const c = Math.cos(p.heading), s = Math.sin(p.heading);
		for (const [x, y, z, r] of SPHERES) {
			const t = ballistics.crossSphere(ax, ay, az, bx, by, bz, p.x + (x * c + z * s) * m, p.y + y * m, p.z + (z * c - x * s) * m, r * m);
			if (t !== null && (!best || t < best.t)) best = { t, person };
		}
	}
	return best && { t: best.t, what: 'townsperson', remoteToo: true, hit: (velocity, bullet) => {
		if (folkHit.take?.(best.person, bullet) || bullet?.remote) return;
		if (best.person.flee) return;
		townFolkStats.shot++;
		folkShotHeard(best.person.index, folkSeconds);
		for (const fn of shotListeners) fn(best.person.index, folkSeconds);
	} };
}, folkBounds);

// the players about: [x, z] of the walker (out hunting) and the others in a game who are
function playersAbout() {
	const about = [];
	const me = hunting.hunterPlace();
	if (me.active) about.push([me.x, me.z]);
	for (const other of players.otherList()) if (other.view?.hunting) about.push([other.view.x, other.view.z]);
	return about;
}
// for the walker (hunting.js): every one out of doors within reach of (x, z), as a box: fn(x, z, half, bottom, top)
export function folkNear(x, z, reach, each) {
	if (!settings.enableTownFolk) return;
	const m = metre();
	for (const person of folk) {
		const p = person.place;
		if (p && Math.abs(p.x - x) < reach && Math.abs(p.z - z) < reach) each(p.x, p.z, 0.26 * m, p.y, p.y + 1.8 * m);
	}
}
hunting.addMovers(folkNear);

// The horde (see THE HORDE at the top): fn(person) for each one out of doors, and not turned
export function folkOut(each) {
	if (!settings.enableTownFolk) return;
	for (const person of folk) if (person.place && !person.turned) each(person);
}
// a person fighting: { x, y, z, heading, pitch, gun (players.js's HELD_LENGTH's names) }, or null to stop (goHome: it runs home from there)
export function setFight(index, fight, goHome = false) {
	const person = folk[index];
	if (!person) return;
	if (!fight && person.fight && goHome) {
		const f = person.fight, time = folkSeconds + person.offset;
		const walk = walkBetween(person, { at: [f.x, f.y, f.z], node: person.ways.nearest(f.x, f.z) }, person.home);
		person.flee = walk && { k: Math.floor(time / person.period), t0: folkSeconds - FLINCH, walk, heading: f.heading };
	}
	person.fight = fight;
}
export function turnFolk(index) {
	const person = folk[index];
	if (person) { person.turned = true; person.fight = null; person.place = null; }
}
export function restoreFolk() { for (const person of folk) { person.turned = false; person.fight = null; person.led = null; person.gone = false; person.dead = false; } }
// THE WAR (war.js): killed (it does not come back until the towns are whole again), and who is
export function killFolk(index) { const person = folk[index]; if (person) { person.dead = true; person.fight = null; person.led = null; person.place = null; } }
export function setDead(list) { const dead = new Set(list); for (const person of folk) { person.dead = dead.has(person.index); if (person.dead) person.fight = null; } }
export function deadList() { return folk.filter((person) => person.dead).map((person) => person.index); }
// a hit on one, for the war (war.js): take(person, bullet) true if it has seen to it (anyone's: the host sees the joiners' rounds too)
export const folkHit = { take: null };
// led (see THE HORDE at the top): where the horde has it now, { x, y, z, heading, stride, walking }, or null to let it go its own way again
export function setLed(index, place) { const person = folk[index]; if (person) person.led = place; }
export function boardFolk(index) { const person = folk[index]; if (person) { person.gone = true; person.led = null; person.fight = null; person.place = null; } }
export function setBoarded(list) { const gone = new Set(list); for (const person of folk) { person.gone = gone.has(person.index); if (person.gone) person.led = null; } }
// for the horde: fn(person) for every one, out of doors or not ({ index, town, home, place, turned, gone })
export function folkEach(fn) { for (const person of folk) fn(person); }
export const folkPerson = (index) => folk[index];
export function setTurned(list) {
	const turned = new Set(list);
	for (const person of folk) { person.turned = turned.has(person.index); if (person.turned) person.fight = null; }
}
export function turnedList() { return folk.filter((person) => person.turned).map((person) => person.index); }
// how many there are, and how many of them have not turned (the Horde game mode is lost when none are left, horde.js)
export function folkCount() { return settings.enableTownFolk ? { all: folk.length, left: folk.filter((person) => !person.turned).length } : { all: 0, left: 0 }; }

let lastTime = performance.now();
export function townFolkUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	folkSeconds += elapsed;
	lastTime = now;
	if (terrain.land && terrain.land !== builtFor) build();
	if (!settings.enableTownFolk) return;
	const m = metre(), about = playersAbout(), ease = Math.min(elapsed * 6, 1);
	let out = 0;
	for (const person of folk) {
		const time = folkSeconds + person.offset, k = Math.floor(time / person.period);
		if (k != person.k) { person.k = k; person.errand = planErrand(person, k); }
		if (person.flee && person.flee.k != k) person.flee = null;		// (out again with the next errand)
		const f = person.fight;
		const place = person.turned || person.gone || person.dead ? null : person.led ? { ...person.led } : f ? { x: f.x, y: f.y, z: f.z, heading: f.heading, stride: 0, walking: 0 }
			: person.flee ? fleeingAt(person.flee, folkSeconds - person.flee.t0) : placeAt(person, time - k * person.period);
		person.hit = Math.max(person.hit - elapsed * 2, 0);
		if (!place) { person.place = null; person.push = [0, 0]; person.look = 0; continue; }
		out++;
		// out of the way of the players near it, and looking at the nearest
		let px = 0, pz = 0, nearest = null;
		for (const [x, z] of about) {
			const dx = place.x - x, dz = place.z - z, d = Math.hypot(dx, dz);
			if (d < MAKE_ROOM * m && d > 1e-3) { px += dx / d * (MAKE_ROOM * m - d); pz += dz / d * (MAKE_ROOM * m - d); }
			if (d < LOOK_AT * m && (!nearest || d < nearest.d)) nearest = { d, x, z };
		}
		person.push = [person.push[0] + (px - person.push[0]) * ease, person.push[1] + (pz - person.push[1]) * ease];
		place.x += person.push[0];
		place.z += person.push[1];
		let look = 0;
		if (nearest && !person.flee && !f) {
			look = Math.atan2(nearest.x - place.x, nearest.z - place.z) - place.heading;
			look -= Math.PI * 2 * Math.round(look / (Math.PI * 2));
			look = Math.min(Math.max(look, -1.1), 1.1);
		}
		person.look += (look - person.look) * Math.min(elapsed * 4, 1);
		person.place = place;
	}
	townFolkStats.out = out;
}

//-------------------------------DRAWING-------------------------------
let gpu = null;		// made the first time it is needed: { pipeline, meshes: { hat: { buffer, vertices } }, instanceBuffer, uniformBuffer }
function makeGpu() {
	const module = device.createShaderModule({ label: "vf_dummy (townsfolk)", code: vf_dummy });
	const body = DUMMY_MESH.data.subarray(0, DUMMY_MESH.bodyTriangles * 12);
	const meshes = {};
	// each hat on the dummy, and on the dummy with the gun (a name with + after it: see THE HORDE at the top)
	for (const [name, make] of Object.entries(HATS)) {
		const t = [];
		make(t);
		for (const [key, under] of [[name, body], [name + '+', DUMMY_MESH.data]]) {
			const data = new Float32Array(under.length + t.length * 12);
			data.set(under);
			let o = under.length;
			for (const [a, b, c, part] of t) for (const p of [a, b, c]) { data.set([p[0], p[1], p[2], part], o); o += 4; }
			const buffer = device.createBuffer({ label: `townsfolk ${key}`, size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
			device.queue.writeBuffer(buffer, 0, data);
			meshes[key] = { buffer, vertices: data.length / 4, hatTriangles: t.length };
		}
	}
	const pipeline = device.createRenderPipeline({
		label: "townsfolk pipeline",
		layout: 'auto',
		vertex: {
			module, entryPoint: "vertexMain",
			buffers: [
				{ arrayStride: 16, attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }] },
				{ arrayStride: DUMMY_FLOATS * 4, stepMode: 'instance', attributes: [1, 2, 3, 4, 5].map((k) => ({ format: "float32x4", offset: (k - 1) * 16, shaderLocation: k })) },
			],
		},
		fragment: { module, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
		primitive: { topology: 'triangle-list', cullMode: 'none' },
		depthStencil: { depthWriteEnabled: true, depthCompare: depthTest('less'), format: DEPTH_FORMAT },
	});
	const instanceData = new Float32Array(MAX_DRAWN * DUMMY_FLOATS);
	const instanceBuffer = device.createBuffer({ label: "townsfolk instances", size: instanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const uniformBuffer = device.createBuffer({ label: "townsfolk Uniform", size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
	return { pipeline, meshes, instanceData, instanceBuffer, uniformBuffer, sampler, bindGroup: null, boundLUT: null };
}
export const HAT_TRIANGLES = () => gpu ? Object.fromEntries(Object.entries(gpu.meshes).filter(([name]) => !name.endsWith('+')).map(([name, m]) => [name, m.hatTriangles])) : null;

// the others drawn as townsfolk (npcs.js): fn(each) calls each({ x, y, z, heading, pitch, stride, walking, fallen, hit, hue, sit, gun (HELD_LENGTH's
//		names), armsDown (with no gun: 1 at its sides, 0 held out in front), look, hat, tilt ([forward, rolled]: see vf_dummy.js) }) for every one of them to draw
const extraFolk = [];
export function addFolkSource(fn) { extraFolk.push(fn); }

// with the solid things
export function townFolkPass(aEncoder, mainpassDepthTexture) {
	townFolkStats.drawn = 0;
	if (!settings.enableTerrain || (folk.length == 0 && extraFolk.length == 0)) return;
	if (!gpu) gpu = makeGpu();
	// the ones out of doors and near enough, by hat: each its instance
	const byHat = new Map();
	let count = 0;
	const take = (hat, p, row) => {
		if (count >= MAX_DRAWN || Math.hypot(p.x - settings.camPosX, p.z - settings.camPosZ) > DRAW_DISTANCE || !gpu.meshes[hat]) return;
		if (!byHat.has(hat)) byHat.set(hat, []);
		byHat.get(hat).push(row);
		count++;
		return true;
	};
	if (settings.enableTownFolk) for (const person of folk) {
		const p = person.place;
		if (!p) continue;
		const held = HELD_LENGTH[person.fight?.gun] ?? 0;
		const row = [p.x, p.y, p.z, metre(), p.heading, held ? person.fight.pitch : 0, p.stride, p.walking, p.lean ?? 0, person.hit, person.hue, 0, held, held ? 0 : 1, person.look, 0, 0, 0, 0, 0];
		if (take(person.profession.hat + (held ? '+' : ''), p, row)) outfits.wear(row, outfits.npcOutfit(person.profession.name, person.index));
	}
	for (const source of extraFolk) source((o) => {
		const held = HELD_LENGTH[o.gun] ?? 0;
		const row = [o.x, o.y, o.z, metre(), o.heading, o.pitch ?? 0, o.stride ?? 0, o.walking ?? 0, o.fallen ?? 0, o.hit ?? 0, o.hue ?? 0, o.sit ?? 0, held, held ? 0 : o.armsDown ?? 1, o.look ?? 0, 0, o.tilt?.[0] ?? 0, o.tilt?.[1] ?? 0, o.side ?? 0, 0];
		if (take(o.hat + (held ? '+' : ''), o, row)) outfits.wear(row, o.outfit);
	});
	if (count == 0) return;
	const draws = [];
	let n = 0, triangles = 0;
	for (const [hat, rows] of byHat) {
		draws.push([gpu.meshes[hat], n, rows.length]);
		triangles += gpu.meshes[hat].vertices / 3 * rows.length;
		for (const row of rows) gpu.instanceData.set(row, n++ * DUMMY_FLOATS);
	}
	device.queue.writeBuffer(gpu.instanceBuffer, 0, gpu.instanceData, 0, n * DUMMY_FLOATS);
	device.queue.writeBuffer(gpu.uniformBuffer, 0, new Float32Array([...transformations.getViewProj(), settings.camPosX, settings.camPosY, settings.camPosZ, 0,
		settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, 0, 0]));
	if (!gpu.bindGroup || gpu.boundLUT !== skyViewLUTtexture) {
		gpu.boundLUT = skyViewLUTtexture;
		gpu.bindGroup = device.createBindGroup({
			label: "townsfolk bind group",
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
		timestampWrites: profiler.timestamps('Townsfolk', 'vf_dummy'),
	});
	pass.setPipeline(gpu.pipeline);
	pass.setBindGroup(0, gpu.bindGroup);
	pass.setVertexBuffer(1, gpu.instanceBuffer);
	for (const [mesh, first, people] of draws) {
		pass.setVertexBuffer(0, mesh.buffer);
		pass.draw(mesh.vertices, people, 0, first);
	}
	pass.end();
	townFolkStats.drawn = count;
	townFolkStats.triangles = triangles;
}

// for testing: everyone, where they are and what they are doing
export function townFolkList() {
	return folk.map((p) => ({ profession: p.profession.name, hat: p.profession.hat, building: p.type, home: p.home.at, place: p.place, doing: p.errand?.kind ?? null, out: !!p.place,
		fleeing: !!p.flee, look: p.look, push: p.push, hit: p.hit }));
}
// for testing: the clock moved on, as if that many seconds had gone by
export function passFolkTime(seconds) { folkSeconds += seconds; }
