/*
	THE FOOTPATHS: worn earth paths over the land, between the towns, out to the landing strip, over the mountain passes, up to
	lookouts and a fire tower, through the forests to clearings in them, and down to the lakes and to the top of the beaches (never on
	to the sand). Laid on the land the way the landing
	strip is (terrainGenerator.js): the land is made as it would be, and they are pressed into it after. They are not a zone. Pure
	maths, as the rest of the land: planned with it (generateTerrain), and the same paths for the same land on every machine.

	PLANNING (planFootpaths): where they go (THE PLACES), a route to each (THE ROUTES), and each route made a line (THE LINE).
		THE PLACES	the towns (their streets), the side of the landing strip that faces the first town, passes (saddles: lower than the
					ridge either side of them, higher than the valley either side), the fire tower (the highest top in the mountains that
					is round enough to stand it on: towers), lookouts (tops below the snow, standing over the land round them),
					clearings (deep in the forests), the lakes' shores and the tops of the beaches. Of each kind the most marked first,
					as far apart as PATHS.spread, until PATHS.most of them are joined (one that cannot be reached is passed over). A
					pass and a lookout are only had where the ground round them is gentle enough to walk on to
		THE ROUTES	over a grid of the land PATHS.cell across, the cheapest way by how far it is and how steep: each step costs more the
					steeper it climbs or falls, much more past PATHS.comfortable, and past PATHS.steepest it cannot be taken at all, so on
					steep ground the way goes back and forth across the slope instead (switchbacks). Ground steeper than PATHS.side any way
					is dearer too (a path across it is cut into it: kept to where that is small), and past PATHS.cliff it cannot be crossed
					at all. Not through water, snow or sand, dearer through marsh, a town (off its streets) and over the landing strip. A step
					onto a path there is already is cheap, so
					paths join and share: each place is joined to the network there is so far (to start with, the first town's streets)
					where that is cheapest, and the network grows by its path. A pass is joined from both sides: to it, and then from a
					place well down the far side, which comes back up over it (being the low way)
		THE LINE	a route's points, rounded off (Chaikin), a point every PATHS.step, each at the height of the land there (the
					land's grid, the strip and the towns in it: the land's finest bumps are pressed out of the way under it), only a
					little evened out along the path: it goes over the land as it is, not cut through its rises or built up over its
					dips. Cut short where it runs on a town's street (the street takes it on), and its end where it joins the network
					moved on to the path it joins

	ON THE LAND (makePathFlattener: the chunks of the land, terrainGenerator.js): across a path the land is laid at the path's height
	there, out to PATHS.half (keeping PATHS.keep of the slope across it, as a trodden path does), and out from that held within a
	bank of PATHS.bank of it: where the land is already within that, as it was. So a path across a slope is cut into it only as far
	as it must be, its sides no steeper than the bank, and they end where they meet the land. Out to PATHS.reach at the most (a side
	that has not met the land by then, on ground steeper than its bank, fades out over the last of that). Where paths come close
	(a switchback's bends, where one joins another) each has its say. Trees and boulders are kept off them and off the clearings,
	out to PATHS.edge and PATHS.clear past that.
	Drawn by town.js as a ribbon of earth (its ground work), with no grass on it (townMask.js). All in world units (2 to the metre),
	heights over the sea
*/
export const PATHS = {
	half: 1.5,				// half the trodden width
	edge: 4,				// out from that, the path's sides (where it is cut in or built up, about)
	clear: 4,				// and out from that, no trees or boulders
	reach: 12,				// out from its tread, the furthest a path changes the land
	cell: 16,				// the routing grid
	step: 6,				// the line's points this far apart
	comfortable: 0.18,		// rise over run: steeper than this costs much more
	steepest: 0.45,			// and no steeper than this at all
	side: 0.35,				// ground steeper than this any way costs more to cross
	cliff: 1.1,				// and steeper than this cannot be crossed at all
	keep: 0.35,				// how much of the slope across it a path keeps
	bank: 0.8,				// how steep its sides may be, cut into the land or built up over it (rise over run)
	reuse: 0.35,			// a step on a path there already, as much as a new one
	spread: { pass: 900, tower: 1000, lookout: 900, clearing: 800, lake: 600, beach: 900 },
	most: { pass: 3, tower: 1, lookout: 3, clearing: 4, lake: 3, beach: 3 },
	clearing: 16,			// the radius of a clearing at the end of a forest path
	towerClearing: 22,		// and round the fire tower
	farSide: 420,			// how far down the far side of a pass its path goes on to
};

const BUCKET = 32;

/*
	land: {
		worldSize, ground(x, z) (the exact height over the sea), heightAt(x, z) (the data grid's, quicker), zoneAt(x, z), Z (the zone
		numbers: OCEAN, BEACH, GRASSLAND, FOREST, MOUNTAIN, SNOW, LAKE, MARSH, TOWN), townAt(x, z) (0 to 1), onRoad(x, z) (on a town's
		street), towns (townLayout.js's), strip (terrainGenerator.js's, or null), stripAt(x, z) (1 on its flat) }
	Gives { paths: [{ kind, points: [[x, y, z], ...] }], segments (for makePathFlattener: 6 floats each, a then b, x z y), clearings
	([x, z, radius] each), towers (the fire tower: [x, z], or none), places (where each kind was looked for and found, for testing) }
*/
export function planFootpaths(land) {
	const { worldSize, Z } = land;
	const C = PATHS.cell, G = Math.round(worldSize / C), side = G + 1, n = side * side, half = worldSize / 2;
	const xOf = (k) => (k % side) * C - half, zOf = (k) => Math.floor(k / side) * C - half;
	const nodeAt = (x, z) => Math.min(Math.max(Math.round((z + half) / C), 0), G) * side + Math.min(Math.max(Math.round((x + half) / C), 0), G);

	// the grid: each point's height, whether it can be walked on, and how much dearer it is to go through
	const h = new Float32Array(n), dearer = new Float32Array(n), zone = new Uint8Array(n);
	const walkable = (k) => dearer[k] < Infinity;
	const STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
	for (let k = 0; k < n; k++) {
		const x = xOf(k), z = zOf(k);
		h[k] = land.heightAt(x, z);
		zone[k] = land.zoneAt(x, z);
		const edge = Math.abs(x) > half - 60 || Math.abs(z) > half - 60;
		const wet = zone[k] == Z.OCEAN || zone[k] == Z.LAKE || h[k] < 0.3;
		if (edge || wet || zone[k] == Z.SNOW || zone[k] == Z.BEACH) { dearer[k] = Infinity; continue; }
		dearer[k] = 1 + (zone[k] == Z.MARSH ? 1.5 : 0) + land.townAt(x, z) * 0.6 + (land.stripAt(x, z) > 0 ? 5 : 0) + (zone[k] == Z.FOREST ? 0.1 : 0);
	}
	for (let k = 0; k < n; k++) {
		if (!walkable(k)) continue;
		const col = k % side, row = (k - col) / side;
		const dx = (h[row * side + Math.min(col + 1, G)] - h[row * side + Math.max(col - 1, 0)]) / (2 * C), dz = (h[Math.min(row + 1, G) * side + col] - h[Math.max(row - 1, 0) * side + col]) / (2 * C);
		const slope = Math.hypot(dx, dz);
		dearer[k] = slope > PATHS.cliff ? Infinity : dearer[k] + 10 * Math.max(slope - PATHS.side, 0);
		// (and next to the sand, dearer: a path keeps a step back from it, its line rounded off between the points as it is)
		if (STEPS.some(([dc, dr]) => { const a = Math.min(Math.max(row + dr, 0), G) * side + Math.min(Math.max(col + dc, 0), G); return zone[a] == Z.BEACH; })) dearer[k] += 3;
	}

	// THE ROUTES: from one point to the nearest (by cost) of the network, through the grid
	const network = new Uint8Array(n);
	const cost = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), touched = [];
	const heap = [];
	const push = (c, k) => { heap.push([c, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
	const pop = () => {
		const top = heap[0], last = heap.pop();
		if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m == i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
		return top;
	};
	function route(start, limit = 6000) {
		for (const k of touched) { cost[k] = Infinity; from[k] = -1; }
		touched.length = 0;
		heap.length = 0;
		if (!walkable(start)) return null;
		cost[start] = 0;
		touched.push(start);
		push(0, start);
		while (heap.length) {
			const [c, k] = pop();
			if (c > cost[k]) continue;
			if (network[k] && k != start) {
				const way = [k];
				while (from[way[way.length - 1]] >= 0) way.push(from[way[way.length - 1]]);
				return way.reverse();
			}
			if (c > limit) break;
			const col = k % side, row = (k - col) / side;
			for (const [dc, dr] of STEPS) {
				const cc = col + dc, rr = row + dr;
				if (cc < 0 || rr < 0 || cc > G || rr > G) continue;
				const a = rr * side + cc;
				if (!walkable(a)) continue;
				const run = dc && dr ? C * Math.SQRT2 : C, grade = Math.abs(h[a] - h[k]) / run;
				if (grade > PATHS.steepest) continue;
				const step = run * (1 + 12 * grade * grade + 40 * Math.max(grade - PATHS.comfortable, 0)) * (dearer[k] + dearer[a]) / 2 * (network[a] ? PATHS.reuse : 1);
				if (c + step < cost[a]) {
					if (cost[a] == Infinity) touched.push(a);
					cost[a] = c + step;
					from[a] = k;
					push(c + step, a);
				}
			}
		}
		return null;
	}

	// THE LINE
	const lines = [];		// every path's points so far, to join new ones on to
	function makeLine(way, kind) {
		let pts = way.map((k) => [xOf(k), zOf(k)]);
		// (rounded off: each corner cut, twice over, the ends kept)
		for (let r = 0; r < 2; r++) {
			const next = [pts[0]];
			for (let i = 0; i < pts.length - 1; i++) {
				const a = pts[i], b = pts[i + 1];
				next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
			}
			next.push(pts[pts.length - 1]);
			pts = next;
		}
		// (its end on the network, on to the nearest point of the path it joins)
		const end = pts[pts.length - 1];
		let join = null, best = PATHS.cell * 1.5;
		for (const line of lines) for (const p of line) { const d = Math.hypot(p[0] - end[0], p[2] - end[1]); if (d < best) { best = d; join = p; } }
		if (join) pts[pts.length - 1] = [join[0], join[2]];
		// (a point every step along it)
		const even = [pts[0]];
		let carry = 0;
		for (let i = 0; i < pts.length - 1; i++) {
			const a = pts[i], b = pts[i + 1], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
			let t = PATHS.step - carry;
			for (; t < length; t += PATHS.step) even.push([a[0] + (b[0] - a[0]) * t / length, a[1] + (b[1] - a[1]) * t / length]);
			carry = length - (t - PATHS.step);
		}
		if (Math.hypot(even[even.length - 1][0] - end[0], even[even.length - 1][1] - end[1]) > 0.5) even.push(pts[pts.length - 1]);
		// (the land's height under each, a little evened out along it: the end that joins a path at that path's height)
		let ys = even.map(([x, z]) => land.heightAt(x, z));
		if (join) ys[ys.length - 1] = join[1];
		ys = ys.map((y, i) => i == 0 || i == ys.length - 1 ? y : (ys[i - 1] + 2 * y + ys[i + 1]) / 4);
		let line = even.map(([x, z], i) => [x, ys[i], z]);
		// (not on a town's street: kept from the last point on it, so it meets the street)
		let first = 0, last = line.length - 1;
		while (first < last && land.onRoad(line[first + 1][0], line[first + 1][2])) first++;
		while (last > first && land.onRoad(line[last - 1][0], line[last - 1][2])) last--;
		line = line.slice(first, last + 1);
		// (and never on the sand: an end that comes on to it is cut back off it)
		const sand = (p) => land.zoneAt(p[0], p[2]) == Z.BEACH;
		while (line.length && sand(line[0])) line.shift();
		while (line.length && sand(line[line.length - 1])) line.pop();
		if (line.length < 2) return null;
		lines.push(line);
		for (const k of way) network[k] = 1;
		return { kind, points: line };
	}

	const paths = [], places = {};
	const join = (start, kind, limit) => {
		if (network[start]) return null;
		const way = route(start, limit);
		const path = way && makeLine(way, kind);
		if (path) paths.push(path);
		return path && way;
	};

	// THE PLACES: the towns, then the strip
	const towns = land.towns ?? [];
	const streetPoints = (town) => [...town.streets, ...(town.lanes ?? [])].flatMap((s) => s.points);
	const hub = towns.length ? towns[0].site : land.strip ?? { x: 0, z: 0 };
	const seeds = towns.length ? streetPoints(towns[0]) : [];
	for (const p of seeds) network[nodeAt(p[0], p[2])] = 1;
	// (no town: beside the middle of the landing strip, off its earth, or the middle of the world)
	if (!seeds.length) network[land.strip ? nodeAt(land.strip.x - land.strip.az * (land.strip.width / 2 + 8), land.strip.z + land.strip.ax * (land.strip.width / 2 + 8)) : nodeAt(hub.x, hub.z)] = 1;
	places.towns = [];
	for (const town of towns.slice(1)) {
		const pts = streetPoints(town);
		if (!pts.length) continue;
		const start = pts.reduce((a, b) => Math.hypot(a[0] - hub.x, a[2] - hub.z) < Math.hypot(b[0] - hub.x, b[2] - hub.z) ? a : b);
		const way = join(nodeAt(start[0], start[2]), 'town', 12000);
		places.towns.push(!!way);
		for (const p of pts) network[nodeAt(p[0], p[2])] = 1;
	}
	if (land.strip && towns.length) {
		const s = land.strip, u = Math.max(Math.min((hub.x - s.x) * s.ax + (hub.z - s.z) * s.az, s.half - 30), -s.half + 30);
		const v = ((hub.x - s.x) * -s.az + (hub.z - s.z) * s.ax) >= 0 ? 1 : -1, off = s.width / 2 + 2;
		const x = s.x + s.ax * u - s.az * v * off, z = s.z + s.az * u + s.ax * v * off;
		places.strip = !!join(nodeAt(x, z), 'strip', 8000);
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
		if (zone[k] == Z.MARSH || zone[k] == Z.BEACH) return null;
		const near = ring(k, 6), far = ring(k, 20);
		if (far.some((a) => a < 0) || near.some((a) => h[a] > h[k])) return null;
		if (near.some((a) => (h[k] - h[a]) / (6 * C) > PATHS.comfortable * 1.6)) return null;
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
	// the fire tower's top: in the mountains, higher than all round it and round enough on top, the highest first (and the more it
	//		stands over the land round it)
	const mountainTop = (k) => {
		if (zone[k] != Z.MOUNTAIN && !(zone[k] == Z.FOREST && h[k] > 60)) return null;
		const near = ring(k, 4), far = ring(k, 14);
		if (far.some((a) => a < 0) || near.some((a) => a < 0 || h[a] > h[k] || (h[k] - h[a]) / (4 * C) > PATHS.comfortable * 2)) return null;
		return h[k] + 2 * (h[k] - far.reduce((s, a) => s + h[a], 0) / 8);
	};
	const clearings = [], towers = [];

	places.passes = reach('pass', pick('pass', saddle), (k) => {
		const way = join(k, 'pass', 40000);
		if (!way) return null;
		// on down the far side: away from the way it came up
		const came = way[Math.min(6, way.length - 1)], dx = xOf(k) - xOf(came), dz = zOf(k) - zOf(came), l = Math.hypot(dx, dz) || 1;
		const far = nodeAt(xOf(k) + dx / l * PATHS.farSide, zOf(k) + dz / l * PATHS.farSide);
		if (walkable(far)) join(far, 'pass', 20000);
		return way;
	});
	places.tower = reach('tower', pick('tower', mountainTop), (k) => {
		const way = join(k, 'tower', 40000);
		if (way) { towers.push([xOf(k), zOf(k)]); clearings.push([xOf(k), zOf(k), PATHS.towerClearing]); }
		return way;
	});
	places.lookouts = reach('lookout', pick('lookout', top), (k) => join(k, 'lookout', 20000));
	places.clearings = reach('clearing', pick('clearing', deep), (k) => { const way = join(k, 'clearing', 8000); if (way) clearings.push([xOf(k), zOf(k), PATHS.clearing]); return way; });
	places.lakes = reach('lake', pick('lake', shore(Z.LAKE)), (k) => join(k, 'lake', 8000));
	places.beaches = reach('beach', pick('beach', beach), (k) => join(k, 'beach', 8000));

	const segments = [];
	for (const path of paths) for (let i = 0; i < path.points.length - 1; i++) {
		const a = path.points[i], b = path.points[i + 1];
		segments.push(a[0], a[2], a[1], b[0], b[2], b[1]);
	}
	return { paths, segments: new Float32Array(segments), clearings, towers, places };
}

// Laying the paths on the land, from planFootpaths's segments and clearings: flatten(x, z, height) (the land's height over the sea,
//		laid level across a path there), clear(x, z) (1 where no tree or boulder may be), on(x, z) (on a path or its sides)
export function makePathFlattener({ segments, clearings }) {
	const buckets = new Map();
	const count = segments.length / 6, reach = PATHS.half + Math.max(PATHS.reach, PATHS.edge + PATHS.clear);
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
		const o = k * 6;
		file(k, Math.min(segments[o], segments[o + 3]) - reach, Math.min(segments[o + 1], segments[o + 4]) - reach, Math.max(segments[o], segments[o + 3]) + reach, Math.max(segments[o + 1], segments[o + 4]) + reach);
	}
	const found = { d: Infinity, y: 0 };
	function nearest(x, z) {
		found.d = Infinity;
		const bucket = buckets.get(Math.floor(x / BUCKET) * 100000 + Math.floor(z / BUCKET));
		if (!bucket) return found;
		for (const k of bucket) {
			const o = k * 6, ax = segments[o], az = segments[o + 1], ex = segments[o + 3] - ax, ez = segments[o + 4] - az, ll = ex * ex + ez * ez;
			const s = ll > 0 ? Math.min(Math.max(((x - ax) * ex + (z - az) * ez) / ll, 0), 1) : 0;
			const d = Math.hypot(x - ax - ex * s, z - az - ez * s);
			if (d < found.d) { found.d = d; found.y = segments[o + 2] + (segments[o + 5] - segments[o + 2]) * s; }
		}
		return found;
	}
	return {
		// (every path near enough has its say, by how near it is: where two at different heights come close, at a bend in a
		//		switchback or where one joins another, the land goes from one to the other, not a step where one is nearer)
		flatten(x, z, height) {
			const bucket = buckets.get(Math.floor(x / BUCKET) * 100000 + Math.floor(z / BUCKET));
			if (!bucket) return height;
			let sum = 0, weight = 0;
			for (const k of bucket) {
				const o = k * 6, ax = segments[o], az = segments[o + 1], ex = segments[o + 3] - ax, ez = segments[o + 4] - az, ll = ex * ex + ez * ez;
				const s = ll > 0 ? Math.min(Math.max(((x - ax) * ex + (z - az) * ez) / ll, 0), 1) : 0;
				const d = Math.hypot(x - ax - ex * s, z - az - ez * s), y = segments[o + 2] + (segments[o + 5] - segments[o + 2]) * s;
				if (d >= PATHS.half + PATHS.reach) continue;
				const off = height - y, room = PATHS.keep * Math.abs(off) + PATHS.bank * Math.max(d - PATHS.half, 0);
				const t = Math.min(Math.max((d - PATHS.half - 0.6 * PATHS.reach) / (0.4 * PATHS.reach), 0), 1), w = 1 - t * t * (3 - 2 * t);
				sum += Math.sign(off) * (Math.min(Math.abs(off), room) - Math.abs(off)) * w;
				weight += w;
			}
			return height + (weight > 1 ? sum / weight : sum);
		},
		on(x, z) { return nearest(x, z).d < PATHS.half + PATHS.edge; },
		clear(x, z) {
			if (nearest(x, z).d < PATHS.half + PATHS.edge + PATHS.clear) return 1;
			for (const [cx, cz, r] of clearings) if (Math.hypot(x - cx, z - cz) < r) return 1;
			return 0;
		},
	};
}
