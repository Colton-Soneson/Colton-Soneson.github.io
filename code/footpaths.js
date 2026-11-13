/*
	THE ROADS AND THE FOOTPATHS: the main roads between the towns (wider, of dirt or of poor cobbles, rolling with the hills, through the
	tall mountains in tunnels), and the footpaths: worn earth paths off them and over the land, out to the landing strip, over the
	mountain passes in switchbacks, round the towns, up to lookouts and to a fire tower on every main peak, through the forests to
	clearings in them, and down to the lakes and to the top of the beaches (never on to the sand). Laid on the land the way the landing
	strip is (terrainGenerator.js): the land is made as it would be, and they are pressed into it after. They are not a zone. Pure
	maths, as the rest of the land: planned with it (generateTerrain), and the same for the same land on every machine.

	PLANNING (planFootpaths): the roads first (THE ROADS), then where the footpaths go (THE PLACES), a route to each (THE ROUTES), and each
	route made a line (THE LINE).
		THE ROADS	a tile's towns joined to each other, and to its GATES: where a road crosses into the tile beside it (terrainGenerator.js:
					THE ROADS OF A CONTINENT, planned over the whole continent so both tiles have the same gate). Routed as a path is
					(THE ROUTES) but by ROADS: far gentler (no steeper than ROADS.steepest at all, so up a mountain side they go back and forth
					across it), dearer across a steep side and through a river (a ford). And where a mountain is in the way, through it: a
					TUNNEL (THE TUNNELS) is a jump in the routing from one side of a ridge to the other, dearer by the length of it than the
					road the same length, so the road takes one only where going over would cost more. Each is a line as a path is, its
					heights evened out more (ROADS.smooth: it rolls with the hills, it does not follow every bump), and its surface dirt or
					cobbles (by where it starts)
		THE TUNNELS	looked for from points TUNNEL.every cells apart on a hillside: a straight line out every way (and a little up or down,
					TUNNEL.grades) that goes into the ground within TUNNEL.search (its portal: where the ground stands TUNNEL.height over the
					line), stays under it, as much as TUNNEL.cover over the bore at its deepest, for TUNNEL.least to TUNNEL.most, and comes
					out again (the far portal) to ground at its own height within TUNNEL.search. The road runs straight from where it
					leaves the land to the portal (a cutting: the ground pressed out of its way, its sides banked), through the bore at the
					line's height, and out the far portal the same. The bore (townGround.js: tunnelWork) is drawn with its own floor, walls
					and lamps, the ground cut away in front of its portals (vf_terrain.js: tunnelHole), and walked and ridden through on its
					floor (tunnels.js)
		THE PLACES	the towns (their streets), the side of the landing strip that faces the first town, passes (saddles: lower than the
					ridge either side of them, higher than the valley either side), the fire towers (the continent's main peaks, each the
					tallest for 2500 m round: land.peaks, terrainGenerator.js), lookouts (tops below the snow, standing over the land round
					them), clearings (deep in the forests), the lakes' shores and the tops of the beaches, and a ring round each town
					(PATHS.ring: its points joined each to the next). Of each kind the most marked first, as far apart as PATHS.spread,
					until PATHS.most of them are joined (one that cannot be reached is passed over). A pass and a lookout are only had
					where the ground round them is gentle enough to walk on to
		THE ROUTES	over a grid of the land PATHS.cell across, the cheapest way by how far it is and how steep: each step costs more the
					steeper it climbs or falls, much more past PATHS.comfortable, and past PATHS.steepest it cannot be taken at all, so on
					steep ground the way goes back and forth across the slope instead (switchbacks). Ground steeper than PATHS.side any way
					is dearer too (a path across it is cut into it: kept to where that is small), and past PATHS.cliff it cannot be crossed
					at all. Not through water or sand, dearer through snow, marsh, a town (off its streets) and over the landing strip. A
					step onto a path there is already (a road's too) is cheap, so paths join and share: each place is joined to the
					network there is so far (to start with, the roads and the towns' streets) where that is cheapest, and the network grows
					by its path. A pass is joined from both sides: to it, and then from a place well down the far side, which comes back up
					over it (being the low way)
		THE LINE	a route's points, rounded off (Chaikin), a point every PATHS.step, each at the height of the land there (the
					land's grid, the strip and the towns in it: the land's finest bumps are pressed out of the way under it), only a
					little evened out along the path: it goes over the land as it is, not cut through its rises or built up over its
					dips. Cut short where it runs on a town's street (the street takes it on), and its end where it joins the network
					moved on to the path it joins

	ON THE LAND (makePathFlattener: the chunks of the land, terrainGenerator.js): across a path the land is laid at the path's height
	there, out to its half width (keeping PATHS.keep of the slope across it, as a trodden path does: a road ROADS.keep), and out from that
	held within a bank of PATHS.bank of it: where the land is already within that, as it was. So a path across a slope is cut into it only
	as far as it must be, its sides no steeper than the bank, and they end where they meet the land. Out to PATHS.reach at the most (a
	side that has not met the land by then, on ground steeper than its bank, fades out over the last of that). Where paths come close
	(a switchback's bends, where one joins another) each has its say. At a portal the road's cutting ends: the hill past it is left as
	it is. Trees and boulders are kept off them and off the clearings, out to PATHS.edge and PATHS.clear past that.
	Drawn by town.js as a ribbon of earth (its ground work: a road's of its surface), with no grass on it (townMask.js). All in world
	units (2 to the metre), heights over the sea
*/
export const PATHS = {
	half: 1.5,				// half the trodden width
	edge: 4,				// out from that, the path's sides (where it is cut in or built up, about)
	clear: 4,				// and out from that, no trees or boulders
	reach: 12,				// out from its tread, the furthest a path changes the land
	cell: 16,				// the routing grid
	step: 6,				// the line's points this far apart
	comfortable: 0.14,		// rise over run: steeper than this costs much more
	steepest: 0.34,			// and no steeper than this at all (a mountain's side: back and forth across it)
	side: 0.35,				// ground steeper than this any way costs more to cross
	cliff: 1.1,				// and steeper than this cannot be crossed at all
	keep: 0.35,				// how much of the slope across it a path keeps
	keepMost: 1.2,			// and no more than this (deep in a cutting, it is laid at its own height)
	bank: 0.8,				// how steep its sides may be, cut into the land or built up over it (rise over run)
	reuse: 0.35,			// a step on a path there already, as much as a new one
	snow: 3,				// dearer through the snow (up to a peak's tower)
	spread: { pass: 900, lookout: 900, clearing: 800, lake: 600, beach: 900 },
	most: { pass: 3, lookout: 3, clearing: 4, lake: 3, beach: 3 },
	clearing: 16,			// the radius of a clearing at the end of a forest path
	towerClearing: 22,		// and round a fire tower
	farSide: 420,			// how far down the far side of a pass its path goes on to
	ring: { out: 80, points: 8, longest: 760 },	// round a town: how far out from its streets, how many points round, and none further apart than this
};
export const ROADS = {
	half: 5,				// half its width: 5 m across
	edge: 3, clear: 6, reach: 26,
	step: 8,
	comfortable: 0.06,
	steepest: 0.15,
	side: 0.45,				// dearer across ground steeper than this
	cliff: 1.1,
	keep: 0.1,				// laid all but level across
	keepMost: 0.3,
	bank: 0.8,
	reuse: 0.3,
	ford: 14,				// dearer through a river (a ford: a bridge over it, BRIDGE, is often the cheaper)
	snow: 2,
	gateIn: 96,				// a gate's road is routed from this far in from its tile's edge (and runs straight out to it)
	smooth: 5,				// passes evening its heights out along it
	limit: 900000,			// the most a road's route may cost
	cobbles: 0.4,			// how many of them are cobbled
};
export const TUNNEL = {
	half: 5.5, height: 13,	// the bore: half its width, and its height to the crown of the arch
	cover: 100,				// at least this much over the crown somewhere along it (it goes through a mountain, not a hill)
	least: 200, most: 2400,	// how long the bore may be
	every: 6,				// cells: where they are looked for from
	search: 240,			// how far from where the road leaves the land to its portal, and from the far portal to the land again
	step: 16,
	grades: [-0.035, 0, 0.035],
	factor: 3,				// a tunnel's cost: its length, as much as this many of road on the level
	fixed: 8000,			// and this on top (4 km of level road: only where the way over is far worse)
	lamps: 40,				// a lamp this far apart along it
};
// A RIVER TOWN'S FARM (THE FARMS: farmsteads.js keeps it): its ground, metres, across (x) and along (z, away from the town), the cabin
//		at its near end and the plots past it; how far out from the town's streets it may be, and how level its ground must be (world units)
export const FARM = { across: 20, along: 28, out: [70, 280], level: 14, clearing: 40 };	// (level: as uneven as its ground may be: it is laid level, a pad)
// A ROAD'S BRIDGES (THE BRIDGES): of stone, on arches, straight across water (a river, a lake's narrows, an inlet of the sea) from bank to bank
export const BRIDGE = {
	least: 16, most: 520,	// how long, bank to bank
	into: 40,				// it must be over the water within this from where it leaves the land
	step: 8,
	grade: 0.07,			// its deck no steeper than this, bank to bank
	factor: 3,				// its cost: its length, as much as this many of road on the level
	fixed: 1500,
	every: 2,				// cells: where they are looked for from (beside the water)
	clear: 8,				// its deck's middle at least this far over the lower of its banks (a hump-backed rise over the water, its arches under it)
	deck: 2,				// its deck's points this far apart (townGround.js draws its arches round under them)
	arch: 12,				// of them to an arch
};
// a peak's path (THE FIRE TOWERS): up ground as steep as this (cliff), steps as steep as this (steepest), each the dearer the steeper
const CLIMB = { cliff: 3.0, steepest: 0.6 };
// THE MAIN LINE (terrainGenerator.js) where it is laid on the ground: its bed, banked as a road's is; its stations (STATION: by a town)
export const RAILS = { half: 4, edge: 3, clear: 8, reach: 30, keep: 0.05, keepMost: 0.2, bank: 0.8 };
export const STATION = { reach: 1600, out: 14, platform: 60, step: 2, bore: { half: 5.5, height: 13 } };
// a segment (planFootpaths: segments): a then b, x z y, its half width, and FLAGS
export const SEG = 8;
export const FLAGS = { road: 1, portalA: 2, portalB: 4, rail: 8 };
const kindOf = (flags) => flags & FLAGS.rail ? RAILS : flags & FLAGS.road ? ROADS : PATHS;
// how far from its line a segment changes the land or keeps the trees off
export const segmentReach = (half, flags) => half + Math.max(kindOf(flags).reach, kindOf(flags).edge + kindOf(flags).clear);

const BUCKET = 32;
const PORTAL_IN = 6;		// world units: how far a tunnel's road is cut on into its portal (makePathFlattener)

/*
	land: {
		worldSize, ground(x, z) (the exact height over the sea), heightAt(x, z) (the data grid's, quicker), zoneAt(x, z), Z (the zone
		numbers: OCEAN, BEACH, GRASSLAND, FOREST, MOUNTAIN, SNOW, LAKE, MARSH, TOWN, RIVER), townAt(x, z) (0 to 1), onRoad(x, z) (on a town's
		street), towns (townLayout.js's), strip (terrainGenerator.js's, or null), stripAt(x, z) (1 on its flat), gates ([{ x, z, ix, iz }]:
		a road's way out of the tile on its edge, and the way in from it), peaks ([[x, z], ...]: the main peaks in it, for a fire tower each) }
	Gives { paths: [{ kind, points: [[x, y, z], ...], half, surface (a road's), portals (a road's: [at its start, at its end]) }] (kind:
	'road', 'tunnel' (through a bore: not laid on the land), or a footpath's), segments (for makePathFlattener: SEG floats each), clearings
	([x, z, radius] each), towers (the fire towers: [x, z] each), tunnels ([{ a: [x, y, z], b, half, height }]: from portal to portal, on
	the floor), places (where each kind was looked for and found, for testing) }
*/
export function planFootpaths(land) {
	const { worldSize, Z } = land;
	// (a tile of the world's: its grid round its own middle, and kept off a seam with another land tile: world.js)
	const ox = land.ox ?? 0, oz = land.oz ?? 0, keep = land.keep ?? (() => true);
	const C = PATHS.cell, G = Math.round(worldSize / C), side = G + 1, n = side * side, half = worldSize / 2;
	const xOf = (k) => ox + (k % side) * C - half, zOf = (k) => oz + Math.floor(k / side) * C - half;
	const nodeAt = (x, z) => Math.min(Math.max(Math.round((z - oz + half) / C), 0), G) * side + Math.min(Math.max(Math.round((x - ox + half) / C), 0), G);
	const inTile = (x, z, margin) => Math.abs(x - ox) < half - margin && Math.abs(z - oz) < half - margin;

	// the grid: each point's height, whether it can be walked on, and how much dearer it is to go through, for a footpath and for a road
	const h = new Float32Array(n), dearer = new Float32Array(n), dearRoad = new Float32Array(n), dearClimb = new Float32Array(n), zone = new Uint8Array(n), slope = new Float32Array(n);
	const walkable = (k) => dearer[k] < Infinity;
	const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
	// (and the knight's moves, so a way can go across a slope at a shallower angle: up a steeper one, back and forth. Each over the two
	//		points it passes between, which must be walkable too)
	const MOVES = [...STEPS.map(([a, b]) => [a, b, null]), ...[[2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2], [2, -1]].map(([a, b]) => [a, b, Math.abs(a) == 2 ? [[Math.sign(a), 0], [Math.sign(a), b]] : [[0, Math.sign(b)], [a, Math.sign(b)]]])];
	for (let k = 0; k < n; k++) {
		const x = xOf(k), z = zOf(k);
		h[k] = land.heightAt(x, z);
		zone[k] = land.zoneAt(x, z);
		// (a footpath kept off a seam with another land tile where it can be, never within 60 of it: a road goes on over it, through its gate)
		const edge = Math.abs(x - ox) > half - 60 || Math.abs(z - oz) > half - 60;
		const wet = zone[k] == Z.OCEAN || zone[k] == Z.LAKE || h[k] < 0.3;
		if (edge || wet || zone[k] == Z.BEACH) { dearer[k] = dearRoad[k] = Infinity; continue; }
		const common = 1 + (zone[k] == Z.MARSH ? 1.5 : 0) + land.townAt(x, z) * 0.6 + (land.stripAt(x, z) > 0 ? 5 : 0) + (zone[k] == Z.FOREST ? 0.1 : 0);
		const river = Z.RIVER !== undefined && zone[k] == Z.RIVER;
		dearer[k] = common + (zone[k] == Z.SNOW ? PATHS.snow : 0) + (river ? 1 : 0) + (keep(x, z) ? 0 : 2);
		dearRoad[k] = common + (zone[k] == Z.SNOW ? ROADS.snow : 0) + (river ? ROADS.ford : 0);
	}
	for (let k = 0; k < n; k++) {
		if (dearRoad[k] == Infinity) continue;
		const col = k % side, row = (k - col) / side;
		const dx = (h[row * side + Math.min(col + 1, G)] - h[row * side + Math.max(col - 1, 0)]) / (2 * C), dz = (h[Math.min(row + 1, G) * side + col] - h[Math.max(row - 1, 0) * side + col]) / (2 * C);
		slope[k] = Math.hypot(dx, dz);
		// (and next to the sand, dearer: a path keeps a step back from it, its line rounded off between the points as it is)
		const sandy = STEPS.some(([dc, dr]) => { const a = Math.min(Math.max(row + dr, 0), G) * side + Math.min(Math.max(col + dc, 0), G); return zone[a] == Z.BEACH; }) ? 3 : 0;
		// (a peak's path, up to its fire tower: a climbers' way, up whatever it must, at a price: CLIMB)
		dearClimb[k] = slope[k] > CLIMB.cliff ? Infinity : dearer[k] + 10 * Math.max(slope[k] - PATHS.side, 0) + 30 * Math.max(slope[k] - PATHS.cliff, 0) + sandy;
		dearer[k] = slope[k] > PATHS.cliff ? Infinity : dearer[k] + 10 * Math.max(slope[k] - PATHS.side, 0) + sandy;
		dearRoad[k] = slope[k] > ROADS.cliff ? Infinity : dearRoad[k] + 25 * Math.max(slope[k] - ROADS.side, 0) + sandy;
	}

	// THE ROUTES: from one point to the nearest (by cost) of the goal (the network), through the grid. A road's (ROAD): by ROADS, and
	//		through the tunnels there are (jumps: node -> its tunnels out of it)
	const network = new Uint8Array(n);
	const cost = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), via = new Int32Array(n).fill(-1), touched = [];
	const heap = [];
	const push = (c, k) => { heap.push([c, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
	const pop = () => {
		const top = heap[0], last = heap.pop();
		if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m == i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
		return top;
	};
	const PATH = { dear: dearer, P: PATHS, goal: network, jumps: null, climb: [12, 40] };
	const UP = { ...PATH, dear: dearClimb, P: { ...PATHS, steepest: CLIMB.steepest } };
	const jumps = new Map(), jumpList = [];
	const roadNet = new Uint8Array(n);
	const ROAD = { dear: dearRoad, P: ROADS, goal: roadNet, jumps, climb: [10, 30] };
	const STEEP_ROAD = { ...ROAD, P: { ...ROADS, steepest: 0.24, comfortable: 0.1 } };
	const roadRoute = (start, limit) => route(start, limit, ROAD) ?? route(start, limit, STEEP_ROAD);
	// the way, and for each of its points whether it came by a tunnel (the number of it in jumpList, or -1)
	function route(start, limit = 6000, mode = PATH) {
		for (const k of touched) { cost[k] = Infinity; from[k] = -1; via[k] = -1; }
		touched.length = 0;
		heap.length = 0;
		const { dear, P, goal } = mode;
		if (dear[start] == Infinity) return null;
		cost[start] = 0;
		touched.push(start);
		push(0, start);
		const relax = (a, c, k, j) => {
			if (c < cost[a]) {
				if (cost[a] == Infinity) touched.push(a);
				cost[a] = c; from[a] = k; via[a] = j;
				push(c, a);
			}
		};
		while (heap.length) {
			const [c, k] = pop();
			if (c > cost[k]) continue;
			if (goal[k] && k != start) {
				const way = [k];
				while (from[way[way.length - 1]] >= 0) way.push(from[way[way.length - 1]]);
				way.reverse();
				return { way, marks: way.map((p) => via[p]) };
			}
			if (c > limit) break;
			const col = k % side, row = (k - col) / side;
			for (const [dc, dr, between] of MOVES) {
				const cc = col + dc, rr = row + dr;
				if (cc < 0 || rr < 0 || cc > G || rr > G) continue;
				const a = rr * side + cc;
				if (dear[a] == Infinity) continue;
				if (between && between.some(([bc, br]) => dear[(row + br) * side + col + bc] == Infinity)) continue;
				const run = C * Math.hypot(dc, dr), grade = Math.abs(h[a] - h[k]) / run;
				if (grade > P.steepest) continue;
				relax(a, c + run * (1 + mode.climb[0] * grade * grade + mode.climb[1] * Math.max(grade - P.comfortable, 0)) * (dear[k] + dear[a]) / 2 * (goal[a] ? P.reuse : 1), k, -1);
			}
			if (mode.jumps) for (const j of mode.jumps.get(k) ?? []) relax(jumpList[j].to, c + jumpList[j].cost, k, j);
		}
		return null;
	}

	// THE TUNNELS (see the top): every one there could be, both ways through, as jumps for a road's routing
	function findTunnels() {
		const T = TUNNEL, every = T.every, margin = 140;
		for (let row = every; row < G - every; row += every) for (let col = every; col < G - every; col += every) {
			const k = row * side + col;
			if (dearRoad[k] == Infinity || slope[k] < 0.18) continue;
			const x0 = xOf(k), z0 = zOf(k), y0 = h[k];
			for (let d = 0; d < 16; d++) {
				const dx = Math.cos(d * Math.PI / 8), dz = Math.sin(d * Math.PI / 8);
				for (const g of T.grades) {
					let phase = 0, sA = 0, sB = 0, deepest = 0, end = -1;
					for (let s = T.step; s <= T.search * 2 + T.most; s += T.step) {
						const x = x0 + dx * s, z = z0 + dz * s;
						if (!inTile(x, z, margin)) break;
						const over = land.heightAt(x, z) - (y0 + g * s);
						if (phase == 0) {
							if (s > T.search || over < -6) break;
							if (over >= T.height + 2) { phase = 1; sA = s; }
						} else if (phase == 1) {
							deepest = Math.max(deepest, over);
							if (s - sA > T.most) break;
							if (over < T.height + 2) { phase = 2; sB = s; if (sB - sA < T.least) break; }
						} else {
							if (over < -6 || s - sB > T.search) break;
							if (over <= 3) { end = s; break; }
						}
					}
					if (end < 0 || deepest < T.height + T.cover) continue;
					const e = nodeAt(x0 + dx * end, z0 + dz * end);
					if (dearRoad[e] == Infinity || Math.abs(h[e] - (y0 + g * end)) > 6) continue;
					const at = (s) => [x0 + dx * s, y0 + g * s, z0 + dz * s];
					const cost = end * T.factor + T.fixed;
					const there = { from: k, to: e, start: [x0, y0, z0], a: at(sA), b: at(sB), end: [xOf(e), h[e], zOf(e)], cost };
					const back = { from: e, to: k, start: there.end, a: there.b, b: there.a, end: there.start, cost };
					for (const j of [there, back]) { jumpList.push(j); if (!jumps.has(j.from)) jumps.set(j.from, []); jumps.get(j.from).push(jumpList.length - 1); }
				}
			}
		}
	}

	// THE BRIDGES (see BRIDGE): from a point beside the water every way, out over it and on to the far bank, as jumps for a road's routing
	function findBridges() {
		const B = BRIDGE, wet = (x, z) => { const zz = land.zoneAt(x, z); return zz == Z.OCEAN || zz == Z.LAKE || (Z.RIVER !== undefined && zz == Z.RIVER) || land.heightAt(x, z) < 0.3; };
		for (let row = B.every; row < G - B.every; row += B.every) for (let col = B.every; col < G - B.every; col += B.every) {
			const k = row * side + col;
			if (dearRoad[k] == Infinity || zone[k] == Z.RIVER) continue;
			// (only beside the water)
			if (!STEPS.some(([dc, dr]) => { const a = (row + 2 * dr) * side + col + 2 * dc; return a >= 0 && a < n && (dearRoad[a] == Infinity || zone[a] == Z.RIVER); })) continue;
			const x0 = xOf(k), z0 = zOf(k);
			for (let d = 0; d < 16; d++) {
				const dx = Math.cos(d * Math.PI / 8), dz = Math.sin(d * Math.PI / 8);
				let over = -1, end = -1;
				for (let s = B.step; s <= B.most + B.into; s += B.step) {
					const x = x0 + dx * s, z = z0 + dz * s;
					if (!inTile(x, z, 80)) break;
					const w = wet(x, z);
					if (over < 0) { if (w) over = s; else if (s > B.into) break; }
					else if (!w) { end = s; break; }
				}
				if (end < 0 || end - over < B.least) continue;
				// (on to the land past the far bank, a point a road can go on from)
				const e = nodeAt(x0 + dx * (end + C), z0 + dz * (end + C));
				if (dearRoad[e] == Infinity || zone[e] == Z.RIVER) continue;
				const length = Math.hypot(xOf(e) - x0, zOf(e) - z0);
				if (Math.abs(h[e] - h[k]) > B.grade * length) continue;
				const cost = length * B.factor + B.fixed;
				const there = { kind: 'bridge', from: k, to: e, start: [x0, h[k], z0], end: [xOf(e), h[e], zOf(e)], cost };
				const back = { kind: 'bridge', from: e, to: k, start: there.end, end: there.start, cost };
				for (const j of [there, back]) { jumpList.push(j); if (!jumps.has(j.from)) jumps.set(j.from, []); jumps.get(j.from).push(jumpList.length - 1); }
			}
		}
	}

	// THE LINE
	const lines = [];		// every path's points so far, to join new ones on to
	const roadLines = [];	// the roads', to join a road on to
	const chaikin = (pts) => {
		for (let r = 0; r < 2; r++) {
			if (pts.length < 3) break;
			const next = [pts[0]];
			for (let i = 0; i < pts.length - 1; i++) {
				const a = pts[i], b = pts[i + 1];
				next.push(a.map((v, c) => v * 0.75 + b[c] * 0.25), a.map((v, c) => v * 0.25 + b[c] * 0.75));
			}
			next.push(pts[pts.length - 1]);
			pts = next;
		}
		return pts;
	};
	// (a point every step along it, each with a height it must have (fix: NaN if none), from the corners' that have them)
	const evenly = (pts, fix, step) => {
		const even = [pts[0]], fixed = [fix[0]];
		let carry = 0;
		for (let i = 0; i < pts.length - 1; i++) {
			const a = pts[i], b = pts[i + 1], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
			let t = step - carry;
			for (; t < length; t += step) { even.push([a[0] + (b[0] - a[0]) * t / length, a[1] + (b[1] - a[1]) * t / length]); fixed.push(fix[i] + (fix[i + 1] - fix[i]) * t / length); }
			carry = length - (t - step);
		}
		const end = pts[pts.length - 1];
		if (Math.hypot(even[even.length - 1][0] - end[0], even[even.length - 1][1] - end[1]) > step * 0.3) { even.push(end); fixed.push(fix[fix.length - 1]); }
		else { even[even.length - 1] = end; fixed[fixed.length - 1] = fix[fix.length - 1]; }
		return { even, fixed };
	};
	// (its end on the network, on to the nearest point of the path it joins)
	const joinEnd = (pts, list) => {
		const end = pts[pts.length - 1];
		let join = null, best = PATHS.cell * 1.5;
		for (const line of list) for (const p of line) { const d = Math.hypot(p[0] - end[0], p[2] - end[1]); if (d < best) { best = d; join = p; } }
		if (join) pts[pts.length - 1] = [join[0], join[2], ...pts[pts.length - 1].slice(2)];
		return join;
	};
	// (not on a town's street: kept from the last point on it, so it meets the street; never on the sand)
	const offStreets = (line, ends = [true, true]) => {
		let first = 0, last = line.length - 1;
		if (ends[0]) while (first < last && land.onRoad(line[first + 1][0], line[first + 1][2])) first++;
		if (ends[1]) while (last > first && land.onRoad(line[last - 1][0], line[last - 1][2])) last--;
		line = line.slice(first, last + 1);
		const sand = (p) => land.zoneAt(p[0], p[2]) == Z.BEACH;
		while (line.length && sand(line[0])) line.shift();
		while (line.length && sand(line[line.length - 1])) line.pop();
		return line;
	};
	function makeLine(way, kind) {
		const pts = chaikin(way.map((k) => [xOf(k), zOf(k)]));
		const join = joinEnd(pts, lines);
		const { even } = evenly(pts, pts.map(() => NaN), PATHS.step);
		// (the land's height under each, a little evened out along it: the end that joins a path at that path's height)
		let ys = even.map(([x, z]) => land.heightAt(x, z));
		if (join) ys[ys.length - 1] = join[1];
		ys = ys.map((y, i) => i == 0 || i == ys.length - 1 ? y : (ys[i - 1] + 2 * y + ys[i + 1]) / 4);
		const line = offStreets(even.map(([x, z], i) => [x, ys[i], z]));
		if (line.length < 2) return null;
		lines.push(line);
		for (const k of way) network[k] = 1;
		return { kind, points: line, half: PATHS.half };
	}
	// A ROAD's line (see THE ROADS): its stretches on the land between the tunnels it goes through, rounded off, and each tunnel straight
	//		from the road's last point before it, through its portals, to its first after. edge: a gate's road, from that point on the
	//		tile's edge. Gives its pieces: the roads and the tunnels
	const tunnels = [];
	//		Its heights the route's own (each point of the grid's: no step between two of them steeper than ROADS.steepest), carried through
	//		the rounding off, not the land's under the rounded line (across a steep side that would be a bump at every point). start: the
	//		height its first point must have (a gate's)
	function makeRoad(way, marks, start = null) {
		const runs = [[]], bores = [];
		way.forEach((k, i) => { if (i > 0 && marks[i] >= 0) { bores.push(jumpList[marks[i]]); runs.push([]); } runs[runs.length - 1].push(k); });
		// (each point [x, z, height, 1 if it must keep that height])
		const stretches = runs.map((run, r) => {
			let pts = chaikin(run.map((k) => [xOf(k), zOf(k), h[k], 0]));
			if (r == 0 && start !== null) pts[0] = [pts[0][0], pts[0][1], start, 1];
			// (the cuttings: straight out to the portal before it, in from the one after)
			if (r > 0) { const J = bores[r - 1]; pts[0] = [J.end[0], J.end[2], J.end[1], 1]; if (J.kind != 'bridge') pts.unshift([J.b[0], J.b[2], J.b[1], 1]); }
			if (r < runs.length - 1) { const J = bores[r]; pts[pts.length - 1] = [J.start[0], J.start[2], J.start[1], 1]; if (J.kind != 'bridge') pts.push([J.a[0], J.a[2], J.a[1], 1]); }
			return pts;
		});
		const last = stretches[stretches.length - 1], endY = last[last.length - 1][2];
		const join = joinEnd(last, roadLines);
		if (join) last[last.length - 1] = [join[0], join[2], join[1], 1];
		const RAMP = 10;		// (the road it joins at another height: come to it over this many of its last points)
		const pieces = [];
		const surface = ((Math.floor(way[0] / 7) * 2654435761) >>> 0) / 4294967296 < ROADS.cobbles ? 'cobble' : 'dirt';
		stretches.forEach((pts, r) => {
			const { even, fixed } = evenly(pts.map((p) => [p[0], p[1]]), pts.map((p) => p[2]), ROADS.step);
			const { fixed: hard } = evenly(pts.map((p) => [p[0], p[1]]), pts.map((p) => p[3]), ROADS.step);
			let ys = fixed;
			if (join && r == stretches.length - 1) for (let j = 1; j < Math.min(RAMP, ys.length - 1); j++) if (!(hard[ys.length - 1 - j] >= 1)) ys[ys.length - 1 - j] += (join[1] - endY) * (1 - j / RAMP);
			// (evened out: it rolls with the hills; where it must be, kept there)
			for (let pass = 0; pass < ROADS.smooth; pass++) ys = ys.map((y, i) => i == 0 || i == ys.length - 1 || hard[i] >= 1 ? y : (ys[i - 1] + 2 * y + ys[i + 1]) / 4);
			let line = even.map(([x, z], i) => [x, ys[i], z]);
			line = offStreets(line, [r == 0 && start === null, r == stretches.length - 1]);
			if (line.length >= 2) { pieces.push({ kind: 'road', points: line, half: ROADS.half, surface, portals: [r > 0 && bores[r - 1].kind != 'bridge', r < stretches.length - 1 && bores[r].kind != 'bridge'] }); lines.push(line); roadLines.push(line); }
			if (r < bores.length && bores[r].kind == 'bridge') {
				// (a bridge: its deck straight from bank to bank, a point every BRIDGE.step)
				const J = bores[r], length = Math.hypot(J.end[0] - J.start[0], J.end[2] - J.start[2]), count = Math.max(Math.ceil(length / BRIDGE.deck), 1);
				const rise = Math.max(Math.min(J.start[1], J.end[1]) + BRIDGE.clear - (J.start[1] + J.end[1]) / 2, 0);
				const points = Array.from({ length: count + 1 }, (_, i) => { const p = J.start.map((v, c) => v + (J.end[c] - v) * i / count); p[1] += rise * Math.sin(Math.PI * i / count); return p; });
				pieces.push({ kind: 'bridge', points, half: ROADS.half, rise });
				tunnels.push({ kind: 'bridge', a: J.start, b: J.end, half: ROADS.half + 0.6, height: 0, rise });
			} else if (r < bores.length) {
				const J = bores[r], length = Math.hypot(J.b[0] - J.a[0], J.b[2] - J.a[2]), count = Math.max(Math.ceil(length / 16), 1);
				const points = Array.from({ length: count + 1 }, (_, i) => J.a.map((v, c) => v + (J.b[c] - v) * i / count));
				pieces.push({ kind: 'tunnel', points, half: TUNNEL.half });
				tunnels.push({ kind: 'tunnel', a: J.a, b: J.b, half: TUNNEL.half, height: TUNNEL.height });
			}
		});
		for (const k of way) roadNet[k] = network[k] = 1;
		return pieces;
	}

	const paths = [], places = {};
	// THE MAIN LINE's in this tile (terrainGenerator.js: railWindow): on the ground, laid; its tunnels and its bridges (each a straight
	//		stretch to stand on, tunnels.js), and the stations by the towns near it
	const stations = [];
	for (const piece of land.rails?.pieces ?? []) {
		const sea = land.seaLevel ?? 0;
		if (piece.kind == 'rail') { paths.push(piece); continue; }
		if (piece.kind == 'railTunnel') {
			const A = piece.points[0], B = piece.points[piece.points.length - 1];
			paths.push({ kind: 'tunnel', points: piece.points, half: STATION.bore.half, rail: true });
			tunnels.push({ kind: 'tunnel', a: A, b: B, half: STATION.bore.half, height: STATION.bore.height });
			continue;
		}
		// (a bridge: its deck every STATION.step, and to stand on, a chord of it every so often)
		const pts = [];
		for (let i = 1; i < piece.points.length; i++) {
			const a = piece.points[i - 1], b = piece.points[i], l = Math.hypot(b[0] - a[0], b[2] - a[2]), c = Math.max(Math.ceil(l / STATION.step), 1);
			for (let s = i == 1 ? 0 : 1; s <= c; s++) pts.push(a.map((v, k) => v + (b[k] - v) * s / c));
		}
		paths.push({ kind: 'bridge', points: pts, half: RAILS.half, rail: true });
		for (let i = 0; i < piece.points.length - 1; i += 4) { const a = piece.points[i], b = piece.points[Math.min(i + 4, piece.points.length - 1)]; tunnels.push({ kind: 'bridge', a, b, half: RAILS.half + 0.6, height: 0, rise: 0 }); }
	}
	const join = (start, kind, limit, mode = PATH) => {
		if (network[start]) return null;
		const found = route(start, limit, mode);
		const path = found && makeLine(found.way, kind);
		if (path) paths.push(path);
		return path && found.way;
	};

	// THE ROADS (see the top): the towns joined to each other and to the gates
	const towns = land.towns ?? [];
	const streetPoints = (town) => [...town.streets, ...(town.lanes ?? [])].flatMap((s) => s.points);
	const withStreets = towns.filter((t) => streetPoints(t).length);
	// (a gate: its stretch across the seam, the same in both tiles (terrainGenerator.js: THE GATES), laid in both so the land either side
	//		of the seam is laid the same; drawn by each tile for its own half (the other's hidden). And the road routed on in from its end)
	const gates = [];
	for (const g of land.gates ?? []) {
		const mid = [g.x, (g.own[1] + g.other[1]) / 2, g.z];
		const mine = { kind: 'road', points: [mid, g.own], half: ROADS.half, surface: 'dirt', portals: [false, false] };
		paths.push(mine, { kind: 'road', points: [g.other, mid], half: ROADS.half, surface: 'dirt', portals: [false, false], hidden: true });
		lines.push(mine.points); roadLines.push(mine.points);
		// (its road from its end, or from the nearest point to it a road can go from: straight to it first)
		let node = nodeAt(g.own[0], g.own[2]);
		if (dearRoad[node] == Infinity) {
			const col0 = node % side, row0 = (node - col0) / side;
			let best = -1;
			for (let dr = -5; dr <= 5; dr++) for (let dc = -5; dc <= 5; dc++) {
				const cc = col0 + dc, rr = row0 + dr, k = rr * side + cc;
				if (cc < 0 || rr < 0 || cc > G || rr > G || dearRoad[k] == Infinity) continue;
				if (best < 0 || Math.hypot(dc, dr) < Math.hypot(best % side - col0, Math.floor(best / side) - row0)) best = k;
			}
			if (best < 0 || Math.abs(h[best] - g.own[1]) > 0.3 * Math.hypot(xOf(best) - g.own[0], zOf(best) - g.own[2])) continue;
			const bit = { kind: 'road', points: [g.own, [xOf(best), h[best], zOf(best)]], half: ROADS.half, surface: 'dirt', portals: [false, false] };
			paths.push(bit); lines.push(bit.points); roadLines.push(bit.points);
			gates.push({ ...g, node: best, own: bit.points[1] });
			continue;
		}
		gates.push({ ...g, node });
	}
	const hub = towns.length ? towns[0].site : land.strip ?? { x: ox, z: oz };
	places.roads = { towns: [], gates: [], tunnels: 0 };
	const reached = new Set();
	if (withStreets.length + gates.length >= 2) {
		findTunnels();
		places.roads.tunnelsThere = jumpList.length / 2;
		findBridges();
		places.roads.bridgesThere = jumpList.length / 2 - places.roads.tunnelsThere;
		let gateList = gates;
		if (withStreets.length) for (const p of streetPoints(withStreets[0])) roadNet[nodeAt(p[0], p[2])] = 1;
		else {
			// (no town: the first gate's road is the start of them)
			roadNet[gates[0].node] = 1;
			gateList = gates.slice(1);
			places.roads.gates.push(true);
		}
		if (withStreets.length) reached.add(withStreets[0]);
		for (const t of withStreets.slice(1)) {
			const pts = streetPoints(t);
			const start = pts.reduce((a, b) => Math.hypot(a[0] - hub.x, a[2] - hub.z) < Math.hypot(b[0] - hub.x, b[2] - hub.z) ? a : b);
			const found = roadRoute(nodeAt(start[0], start[2]), ROADS.limit);
			if (found) { paths.push(...makeRoad(found.way, found.marks)); reached.add(t); }
			places.roads.towns.push(!!found);
			for (const p of pts) roadNet[nodeAt(p[0], p[2])] = 1;
		}
		for (const g of gateList) {
			const found = roadRoute(g.node, ROADS.limit);
			if (found) paths.push(...makeRoad(found.way, found.marks, g.own[1]));
			places.roads.gates.push(!!found);
		}
		places.roads.tunnels = tunnels.filter((t) => t.kind == 'tunnel').length;
		places.roads.bridges = tunnels.filter((t) => t.kind == 'bridge').length;
	}
	// THE STATIONS: by each town within STATION.reach of the line on the ground, where it comes nearest, out to the town's side of it; a road
	//		from it to the others
	const line = land.rails?.line;
	if (line) {
		const P = line.points, F = P.length / line.points.length * 4 || 4, count = P.length / 4;
		for (const [k, t] of towns.entries()) {
			const pts = streetPoints(t);
			if (!pts.length) continue;
			const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
			let best = -1, bestD = STATION.reach;
			for (let i = 2; i < count - 2; i++) {
				if (P[i * 4 + 3] != 0 || !inTile(P[i * 4], P[i * 4 + 2], 120)) continue;
				const d = Math.hypot(P[i * 4] - cx, P[i * 4 + 2] - cz);
				if (d < bestD) { bestD = d; best = i; }
			}
			if (best < 0) continue;
			const x = P[best * 4], z = P[best * 4 + 2], dx = P[(best + 1) * 4] - P[(best - 1) * 4], dz = P[(best + 1) * 4 + 2] - P[(best - 1) * 4 + 2], l = Math.hypot(dx, dz) || 1;
			const toward = ((cx - x) * -dz + (cz - z) * dx) >= 0 ? 1 : -1, sx = -dz / l * toward, sz = dx / l * toward;
			const at = [x + sx * STATION.out, z + sz * STATION.out];
			stations.push({ x, z, heading: Math.atan2(dx, dz), side: toward, at, s: best, town: k, line: line.id });
			if (withStreets.length + gates.length >= 1) {
				const found = roadRoute(nodeAt(at[0], at[1]), ROADS.limit);
				if (found) paths.push(...makeRoad(found.way, found.marks));
			}
		}
	}
	places.stations = stations.length;
	// (the gates' ends on the network too, routed or not: a footpath may go on from one)
	for (const g of land.gates ?? []) roadNet[nodeAt(g.own[0], g.own[2])] = 1;
	network.set(roadNet);

	// THE PLACES: the towns, then the strip
	const seeds = towns.length ? streetPoints(towns[0]) : [];
	for (const p of seeds) network[nodeAt(p[0], p[2])] = 1;
	// (no town and no road: beside the middle of the landing strip, off its earth, or the middle of the world)
	if (!seeds.length && !network.some((v) => v)) network[land.strip ? nodeAt(land.strip.x - land.strip.az * (land.strip.width / 2 + 8), land.strip.z + land.strip.ax * (land.strip.width / 2 + 8)) : nodeAt(hub.x, hub.z)] = 1;
	places.towns = [];
	for (const town of towns.slice(1)) {
		const pts = streetPoints(town);
		if (!pts.length) continue;
		if (reached.has(town)) { places.towns.push(true); for (const p of pts) network[nodeAt(p[0], p[2])] = 1; continue; }
		const start = pts.reduce((a, b) => Math.hypot(a[0] - hub.x, a[2] - hub.z) < Math.hypot(b[0] - hub.x, b[2] - hub.z) ? a : b);
		const way = join(nodeAt(start[0], start[2]), 'town', 16000);
		places.towns.push(!!way);
		for (const p of pts) network[nodeAt(p[0], p[2])] = 1;
	}
	if (land.strip && towns.length) {
		const s = land.strip, u = Math.max(Math.min((hub.x - s.x) * s.ax + (hub.z - s.z) * s.az, s.half - 30), -s.half + 30);
		const v = ((hub.x - s.x) * -s.az + (hub.z - s.z) * s.ax) >= 0 ? 1 : -1, off = s.width / 2 + 2;
		const x = s.x + s.ax * u - s.az * v * off, z = s.z + s.az * u + s.ax * v * off;
		places.strip = !!join(nodeAt(x, z), 'strip', 10000);
	}

	// the rest: candidates on a coarser grid, the most marked of each kind first, spread apart
	const every = 4, ring = (k, r) => {
		const col = k % side, row = (k - col) / side, out = [];
		for (let a = 0; a < 8; a++) {
			const cc = Math.round(col + Math.cos(a * Math.PI / 4) * r), rr = Math.round(row + Math.sin(a * Math.PI / 4) * r);
			out.push(cc < 0 || rr < 0 || cc > G || rr > G ? -1 : rr * side + cc);
		}
		return out;
	};
	const pick = (kind, score) => {
		const found = [];
		for (let row = every; row < G - every; row += every) for (let col = every; col < G - every; col += every) {
			const k = row * side + col;
			if (!walkable(k)) continue;
			const s = score(k);
			if (s !== null) found.push([s, k]);
		}
		found.sort((a, b) => b[0] - a[0]);
		const kept = [];
		for (const [, k] of found) {
			if (kept.length >= PATHS.most[kind] * 4) break;
			if (kept.every((j) => Math.hypot(xOf(j) - xOf(k), zOf(j) - zOf(k)) >= PATHS.spread[kind])) kept.push(k);
		}
		return kept;
	};
	// each of a kind's places in turn, joined (joined(k): the way, or null), until enough of them are: whether each was
	const reach = (kind, list, joined) => {
		const done = [];
		for (const k of list) {
			if (done.filter(Boolean).length >= PATHS.most[kind]) break;
			done.push(!!joined(k));
		}
		return done;
	};
	// a pass: along one line through it the land rises either side (the ridge), across it falls either side (the valleys)
	const R = 10;
	const saddle = (k) => {
		if (zone[k] != Z.MOUNTAIN && zone[k] != Z.FOREST) return null;
		const around = ring(k, R);
		if (around.some((a) => a < 0) || ring(k, 3).some((a) => Math.abs(h[a] - h[k]) / (3 * C) > 0.6)) return null;
		let best = null;
		for (let d = 0; d < 4; d++) {
			const up = Math.min(h[around[d]], h[around[d + 4]]) - h[k], down = h[k] - Math.max(h[around[(d + 2) % 8]], h[around[(d + 6) % 8]]);
			if (up > 15 && down > 15) best = Math.max(best ?? 0, Math.min(up, down));
		}
		return best;
	};
	// a lookout: a top, higher than all round it and standing well over the land further out, but round enough to walk up on to
	const top = (k) => {
		if (zone[k] == Z.MARSH || zone[k] == Z.BEACH || zone[k] == Z.SNOW) return null;
		const near = ring(k, 6), far = ring(k, 20);
		if (far.some((a) => a < 0) || near.some((a) => h[a] > h[k])) return null;
		if (near.some((a) => (h[k] - h[a]) / (6 * C) > PATHS.comfortable * 2)) return null;
		const over = h[k] - far.reduce((s, a) => s + h[a], 0) / 8;
		return over > 40 ? over : null;
	};
	// a clearing: forest all round, as far out as can be
	const deep = (k) => {
		if (zone[k] != Z.FOREST) return null;
		let r = 0;
		for (const out of [4, 8, 12, 16]) { if (ring(k, out).every((a) => a >= 0 && zone[a] == Z.FOREST)) r = out; else break; }
		return r >= 8 ? r : null;
	};
	// a lake's shore: dry land with lake water a step or two off it (nearer the first town first)
	const nearHub = (k) => -Math.hypot(xOf(k) - hub.x, zOf(k) - hub.z) / 1000;
	const shore = (water) => (k) => (zone[k] == Z.GRASSLAND || zone[k] == Z.MARSH || zone[k] == Z.FOREST) && ring(k, 2).some((a) => a >= 0 && zone[a] == water) ? nearHub(k) : null;
	// the top of a beach: the grass (or the trees) just above the sand, out of the towns
	const beach = (k) => shore(Z.BEACH)(k) !== null && land.townAt(xOf(k), zOf(k)) < 0.02 ? nearHub(k) : null;
	const clearings = [], towers = [];

	places.passes = reach('pass', pick('pass', saddle), (k) => {
		const way = join(k, 'pass', 60000);
		if (!way) return null;
		// on down the far side: away from the way it came up
		const came = way[Math.min(6, way.length - 1)], dx = xOf(k) - xOf(came), dz = zOf(k) - zOf(came), l = Math.hypot(dx, dz) || 1;
		const far = nodeAt(xOf(k) + dx / l * PATHS.farSide, zOf(k) + dz / l * PATHS.farSide);
		if (walkable(far)) join(far, 'pass', 30000);
		return way;
	});
	// THE FIRE TOWERS: on each of the main peaks in the tile (or, given none, the highest top in its mountains), a path up to it
	const mountainTop = (k) => {
		if (zone[k] != Z.MOUNTAIN && !(zone[k] == Z.FOREST && h[k] > 60)) return null;
		const near = ring(k, 4), far = ring(k, 14);
		if (far.some((a) => a < 0) || near.some((a) => a < 0 || h[a] > h[k] || (h[k] - h[a]) / (4 * C) > PATHS.comfortable * 3)) return null;
		return h[k] + 2 * (h[k] - far.reduce((s, a) => s + h[a], 0) / 8);
	};
	// (the highest point of the grid near the peak, out of the water and off the tile's edge: the tower's, steep or not; and the path up
	//		from the nearest point to it that can be walked on, if it cannot)
	const near = (k0, r, test, better) => {
		const col0 = k0 % side, row0 = (k0 - col0) / side;
		let best = -1;
		for (let dr = -r; dr <= r; dr++) for (let dc = -r; dc <= r; dc++) {
			const cc = col0 + dc, rr = row0 + dr;
			if (cc < 0 || rr < 0 || cc > G || rr > G) continue;
			const k = rr * side + cc;
			if (test(k) && (best < 0 || better(k, best))) best = k;
		}
		return best;
	};
	const dry = (k) => zone[k] != Z.OCEAN && zone[k] != Z.LAKE && h[k] > 0.3 && inTile(xOf(k), zOf(k), 70);
	const peaks = land.peaks ? land.peaks.map(([x, z]) => near(nodeAt(x, z), 6, dry, (a, b) => h[a] > h[b])).filter((k) => k >= 0) : pick('lookout', mountainTop).slice(0, 1);
	places.towers = peaks.map((k) => {
		const climbable = (a) => dearClimb[a] < Infinity;
		const foot = climbable(k) ? k : near(k, 14, climbable, (a, b) => Math.hypot(xOf(a) - xOf(k), zOf(a) - zOf(k)) < Math.hypot(xOf(b) - xOf(k), zOf(b) - zOf(k)));
		const way = foot < 0 ? null : network[foot] ? [foot] : join(foot, 'tower', 2000000, UP);
		towers.push([xOf(k), zOf(k)]);
		clearings.push([xOf(k), zOf(k), PATHS.towerClearing]);
		network[k] = 1;
		return !!way;
	});
	// THE FARMS: a river town's (townLayout.js: THE RIVER TOWNS), out from its streets on open, level, dry ground, laid along the way out
	//		from the town (its cabin nearest it), the trees and the rocks kept off it (a clearing), and a track from it to the paths
	const farms = [];
	places.farms = [];
	for (const [k, t] of towns.entries()) {
		if (!t.site?.river) continue;
		const pts = streetPoints(t);
		if (!pts.length) { places.farms.push(false); continue; }
		const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
		const reachOut = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[2] - cz)));
		const m = 2, ha = FARM.across / 2 * m, hl = FARM.along / 2 * m;
		let best = null;
		const why = { edge: 0, ground: 0, level: 0, path: 0 };
		for (let d = 0; d < 24; d++) for (const out of [FARM.out[0], (FARM.out[0] + FARM.out[1]) / 2, FARM.out[1]]) {
			const a = d / 24 * Math.PI * 2, ux = Math.cos(a), uz = Math.sin(a), sx = -uz, sz = ux;
			const x = cx + ux * (reachOut + out + hl), z = cz + uz * (reachOut + out + hl);
			if (!inTile(x, z, hl + 80)) { why.edge++; continue; }
			let lo = Infinity, hi = -Infinity, ok = true;
			for (let i = -2; i <= 2 && ok; i++) for (let j = -2; j <= 2 && ok; j++) {
				const px = x + sx * ha * i / 2 + ux * hl * j / 2, pz = z + sz * ha * i / 2 + uz * hl * j / 2, k2 = nodeAt(px, pz);
				if (!walkable(k2) || zone[k2] == Z.RIVER || zone[k2] == Z.MARSH || land.townAt(px, pz) > 0.05) ok = false;
				lo = Math.min(lo, h[k2]); hi = Math.max(hi, h[k2]);
			}
			if (!ok) { why.ground++; continue; }
			if (hi - lo > FARM.level) { why.level++; continue; }
			// (not on a road or a path: none of their lines through it)
			if (lines.some((line) => line.some((p) => Math.abs((p[0] - x) * sx + (p[2] - z) * sz) < ha + 6 && Math.abs((p[0] - x) * ux + (p[2] - z) * uz) < hl + 6))) { why.path++; continue; }
			const score = (hi - lo) * 10 + out / 20;
			if (!best || score < best.score) best = { x, z, yaw: Math.atan2(ux, uz), score, lo, hi };
		}
		places.farms.push(best ? true : why);
		if (!best) continue;
		// (its ground laid level: a pad as wide as it, at the middle of its heights, banked down or up to the land round it as a road is)
		const y = (best.lo + best.hi) / 2, fx = Math.sin(best.yaw) * hl, fz = Math.cos(best.yaw) * hl;
		paths.push({ kind: 'pad', points: [[best.x - fx, y, best.z - fz], [best.x + fx, y, best.z + fz]], half: ha + 3, hidden: true, portals: [false, false] });
		farms.push({ x: best.x, z: best.z, yaw: best.yaw, town: k, y });
		clearings.push([best.x, best.z, FARM.clearing]);
		// (its track: from its near end, by the cabin, to the paths)
		const gate = nodeAt(best.x - Math.sin(best.yaw) * (hl + 4), best.z - Math.cos(best.yaw) * (hl + 4));
		if (walkable(gate)) join(gate, 'farm', 12000);
	}
	places.lookouts = reach('lookout', pick('lookout', top), (k) => join(k, 'lookout', 30000));
	places.clearings = reach('clearing', pick('clearing', deep), (k) => { const way = join(k, 'clearing', 8000); if (way) clearings.push([xOf(k), zOf(k), PATHS.clearing]); return way; });
	places.lakes = reach('lake', pick('lake', shore(Z.LAKE)), (k) => join(k, 'lake', 8000));
	places.beaches = reach('beach', pick('beach', beach), (k) => join(k, 'beach', 8000));
	// ROUND THE TOWNS: a ring of points PATHS.ring.out past its streets, each joined to the next one round (to it, not on to the network)
	places.rings = [];
	const goal = new Uint8Array(n);
	const RING = { ...PATH, goal, P: { ...PATHS, reuse: 1 } };
	for (const t of withStreets) {
		const pts = streetPoints(t), cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
		const out = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[2] - cz))) + PATHS.ring.out;
		const round = [];
		for (let i = 0; i < PATHS.ring.points; i++) {
			const a = i / PATHS.ring.points * Math.PI * 2, k = nodeAt(cx + Math.cos(a) * out, cz + Math.sin(a) * out);
			round.push(walkable(k) && inTile(xOf(k), zOf(k), 80) && land.townAt(xOf(k), zOf(k)) < 0.5 ? k : -1);
		}
		let made = 0;
		for (let i = 0; i < round.length; i++) {
			const a = round[i], b = round[(i + 1) % round.length];
			if (a < 0 || b < 0 || Math.hypot(xOf(a) - xOf(b), zOf(a) - zOf(b)) > PATHS.ring.longest) continue;
			goal[b] = 1;
			const found = route(a, 12000, RING);
			goal[b] = 0;
			const path = found && makeLine(found.way, 'ring');
			if (path) { paths.push(path); made++; }
		}
		places.rings.push(made);
		if (globalThis.__ringDebug) globalThis.__ringDebug.push(round.map((k) => k < 0 ? 'x' : 'o').join(''));
	}

	const segments = [];
	for (const path of paths) {
		if (path.kind == 'tunnel' || path.kind == 'bridge') continue;
		const road = path.kind == 'road' || path.kind == 'pad' || path.kind == 'rail', last = path.points.length - 2;
		for (let i = 0; i <= last; i++) {
			const a = path.points[i], b = path.points[i + 1];
			const flags = (road ? FLAGS.road : 0) | (path.kind == 'rail' ? FLAGS.rail : 0) | (road && i == 0 && path.portals[0] ? FLAGS.portalA : 0) | (road && i == last && path.portals[1] ? FLAGS.portalB : 0);
			segments.push(a[0], a[2], a[1], b[0], b[2], b[1], path.half, flags);
		}
	}
	// (the tunnels and the bridges, and their paths' points, at their heights in the world: they are drawn and stood on at them, not laid on the land)
	const sea = land.seaLevel ?? 0;
	for (const t of tunnels) { t.a = [t.a[0], t.a[1] + sea, t.a[2]]; t.b = [t.b[0], t.b[1] + sea, t.b[2]]; }
	for (const p of paths) if (p.kind == 'tunnel' || p.kind == 'bridge') p.points = p.points.map(([x, y, z]) => [x, y + sea, z]);
	return { paths, segments: new Float32Array(segments), clearings, towers, tunnels, farms, stations, places };
}

// Laying the paths on the land, from planFootpaths's segments and clearings: flatten(x, z, height) (the land's height over the sea,
//		laid level across a path there), clear(x, z) (1 where no tree or boulder may be), on(x, z) (on a path or its sides)
export function makePathFlattener({ segments, clearings }) {
	const buckets = new Map();
	const count = segments.length / SEG;
	const file = (k, x0, z0, x1, z1) => {
		for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++) {
			for (let bz = Math.floor(z0 / BUCKET); bz <= Math.floor(z1 / BUCKET); bz++) {
				const key = bx * 100000 + bz;
				if (!buckets.has(key)) buckets.set(key, []);
				buckets.get(key).push(k);
			}
		}
	};
	for (let k = 0; k < count; k++) {
		const o = k * SEG, reach = segmentReach(segments[o + 6], segments[o + 7]);
		file(k, Math.min(segments[o], segments[o + 3]) - reach, Math.min(segments[o + 1], segments[o + 4]) - reach, Math.max(segments[o], segments[o + 3]) + reach, Math.max(segments[o + 1], segments[o + 4]) + reach);
	}
	// (the nearest: how far past its tread, and how far its sides and its clear ground go)
	const found = { past: Infinity, edge: 0, clear: 0 };
	function nearest(x, z) {
		found.past = Infinity;
		const bucket = buckets.get(Math.floor(x / BUCKET) * 100000 + Math.floor(z / BUCKET));
		if (!bucket) return found;
		for (const k of bucket) {
			const o = k * SEG, ax = segments[o], az = segments[o + 1], ex = segments[o + 3] - ax, ez = segments[o + 4] - az, ll = ex * ex + ez * ez;
			const s = ll > 0 ? Math.min(Math.max(((x - ax) * ex + (z - az) * ez) / ll, 0), 1) : 0;
			const past = Math.hypot(x - ax - ex * s, z - az - ez * s) - segments[o + 6];
			if (past < found.past) { const P = kindOf(segments[o + 7]); found.past = past; found.edge = P.edge; found.clear = P.edge + P.clear; }
		}
		return found;
	}
	return {
		// (every path near enough has its say: the land within each one's bank, so the deepest cut (or the highest fill) any of them
		//		asks for, by how near it is. Where two at different heights come close and ask for both, at a bend in a switchback or
		//		where one joins another, the land goes from one to the other, by how near each is: not a step where one is nearer. Past
		//		the end of a road at a portal, none: the hill is left as it is over the tunnel)
		flatten(x, z, height) {
			const bucket = buckets.get(Math.floor(x / BUCKET) * 100000 + Math.floor(z / BUCKET));
			if (!bucket) return height;
			let sum = 0, weight = 0, cut = 0, fill = 0;
			for (const k of bucket) {
				const o = k * SEG, ax = segments[o], az = segments[o + 1], ex = segments[o + 3] - ax, ez = segments[o + 4] - az, ll = ex * ex + ez * ez;
				// (a road into a portal: its cutting on a little way into the bore's mouth, under its floor, so the land is not a wall
				//		right at the portal: the ground's mesh rises over its last cell)
				const flags = segments[o + 7], along = ll > 0 ? ((x - ax) * ex + (z - az) * ez) / ll : 0, into = PORTAL_IN / Math.sqrt(ll || 1);
				if ((flags & FLAGS.portalA && along < -into) || (flags & FLAGS.portalB && along > 1 + into)) continue;
				const s = Math.min(Math.max(along, 0), 1), P = kindOf(flags), w0 = segments[o + 6];
				const d = Math.hypot(x - ax - ex * s, z - az - ez * s), y = segments[o + 2] + (segments[o + 5] - segments[o + 2]) * s;
				if (d >= w0 + P.reach) continue;
				const off = height - y, room = Math.min(P.keep * Math.abs(off), P.keepMost) + P.bank * Math.max(d - w0, 0);
				const t = Math.min(Math.max((d - w0 - 0.6 * P.reach) / (0.4 * P.reach), 0), 1), w = 1 - t * t * (3 - 2 * t);
				const c = Math.sign(off) * (Math.min(Math.abs(off), room) - Math.abs(off)) * w;
				cut = Math.min(cut, c); fill = Math.max(fill, c);
				sum += c;
				weight += w;
			}
			if (cut < 0 && fill > 0) return height + (weight > 1 ? sum / weight : sum);
			return height + cut + fill;
		},
		on(x, z) { const f = nearest(x, z); return f.past < f.edge; },
		clear(x, z) {
			const f = nearest(x, z);
			if (f.past < f.clear) return 1;
			for (const [cx, cz, r] of clearings) if (Math.hypot(x - cx, z - cz) < r) return 1;
			return 0;
		},
	};
}
