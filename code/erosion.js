/*
	THE SHAPE OF THE LAND AS WATER WEARS IT: the land a long time on, where it is pushed up by the earth as fast as the rivers cut it down,
	and the hillslopes between the rivers stand at the steepest their soil will hold. Pure maths, no GPU (terrainGenerator.js asks it).

	THE STREAM POWER LAW (Howard 1994; Whipple and Tucker 1999): a river cuts its bed down as fast as K A^m S^n (A how much land drains
	through it, S how steep it is, K how easily the rock gives). Where the land is pushed up (uplift U) as fast as it is cut down, it holds
	its shape: a steady state. There, along every river, S = (U / K)^(1/n) A^(-m/n): the channel steepness ksn = (U / K)^(1/n) times the
	area to the power -THETA (m/n, the concavity: about 0.45 the world over, Snyder et al. 2000). Big rivers lie nearly flat, small
	streams are steep, and the land between them rises in ridges.
	THRESHOLD HILLSLOPES: high up a stream gets too steep for soil to stay on (Montgomery and Brandon 2002, the Oregon Coast Range among
	them): no slope is steeper than Sc, so the tops of the streams are planar hillslopes at that angle, and the ridges are where two meet.
	The steep streams under that, too steep for water alone, are worn by debris flows: they are as steep as Sc at the top of the hillslope
	and only a little less steep for more land drained (Stock and Dietrich 2003: about A^-PHI), so even a hillside gathers into hollows,
	and comes out in spurs and gullies, not planes.
	So the whole land comes from a river network: each point is as high as the point it drains to, plus the way to it times its slope.

	How (each of ROUNDS):
		ROUTING		every point is given the point it drains to (its receiver): the lowest of its 8 neighbours, out of every hollow by the
					lowest way over its rim (priority flood: Barnes, Lehman and Mulla 2014). From the outlets (the sea, the lakes) up, so the
					order the points come in is the order the water goes the other way: each after the one it drains to
		AREA		how much land drains through each point: its own cell, and all that drains to it (the order backwards)
		HEIGHT		from the outlets up again: a point's height is its receiver's plus the way there times its slope (above)
		LANDSLIDES	no point higher over any of its neighbours than the steepest a hillslope stands there lets it (slopeMax over the way
					between them). The heights come from the way each point's water goes, and two that drain different ways can stand very
					differently: where two valleys meet at a divide, the one's water going a long way round and the other's a short way down,
					the divide would be a wall. Ground that steep falls: the higher side is let down to stand at that slope over the lower.
					Sweeps across the grid each way (SLIDE_SWEEPS), each point brought down to its neighbours' heights plus that slope
	Each round's land routes the next, so the network finds its own shape: valleys capture the land round them, the divides move to where
	the two sides meet, and it comes out the branching (dendritic) networks real land has (Braun and Willett 2013; Cordonnier et al. 2016:
	the same law, stepped through time). The first round is routed over the land it is given (the noise), which sets where the big valleys go.
	A little noise in each round's routing (JITTER) keeps the rivers from running straight along the grid.
*/
export const THETA = 0.45;
const PHI = 0.2;			// the debris flows' concavity (see THRESHOLD HILLSLOPES). Less, and a hillside's streams barely gather: they run down it
							//		side by side in straight grooves
const ROUNDS = 8;
const SLIDE_SWEEPS = 2;		// LANDSLIDES: how many times across the grid and back each round
const JITTER = 0.4;			// metres: added at random to each point's height for the routing of a round, so equal ways are chosen between at random

// a min-heap of points by height (typed arrays: priority flood goes through every point of the grid)
function makeHeap(capacity) {
	const keys = new Float64Array(capacity), values = new Int32Array(capacity);
	let size = 0;
	return {
		get size() { return size; },
		push(key, value) {
			let i = size++;
			while (i > 0) {
				const parent = (i - 1) >> 1;
				if (keys[parent] <= key) break;
				keys[i] = keys[parent]; values[i] = values[parent]; i = parent;
			}
			keys[i] = key; values[i] = value;
		},
		pop() {
			const top = values[0], key = keys[--size], value = values[size];
			let i = 0;
			for (;;) {
				let child = 2 * i + 1;
				if (child >= size) break;
				if (child + 1 < size && keys[child + 1] < keys[child]) child++;
				if (keys[child] >= key) break;
				keys[i] = keys[child]; values[i] = values[child]; i = child;
			}
			keys[i] = key; values[i] = value;
			return top;
		},
	};
}

/*
	The land in its steady state, on a grid of cols x rows points cell metres apart (row by row).
		start		Float32Array, metres: the land to route the first round over (where it is lower the big rivers will run)
		outlet		Uint8Array: 1 where the water leaves (the sea, a lake, the edge of the grid where it runs on), which stay at outletHeight
		ksn			Float32Array: the channel steepness at each point (metres^(2 THETA)): how high the land stands
		slopeMax	Float32Array: the steepest a hillslope stands there (rise over run)
		random		a seeded random number source, 0 to 1
		roughness	Float32Array, metres (or none): the lie of the rock under the land, added to it for the routing of every round. On ground
					that is all one slope the water would run straight down it side by side, and no stream would gather more than the next:
					the land would come out in planes. Real ground is never that even, and it is its unevenness the streams gather in
	Returns { height (metres), area (square metres drained through each point), receiver (the point each drains to; -1 an outlet) }
*/
export function steadyLand({ cols, rows, cell, start, outlet, outletHeight = 0, ksn, slopeMax, random, rounds = ROUNDS, theta = THETA, roughness = null, phi = PHI }) {
	const n = cols * rows, diagonal = cell * Math.SQRT2, cellArea = cell * cell;
	const height = Float32Array.from(start);
	const receiver = new Int32Array(n), order = new Int32Array(n), area = new Float32Array(n), seen = new Uint8Array(n);
	const route = new Float32Array(n);
	const heap = makeHeap(n);
	const DX = [-1, 0, 1, -1, 1, -1, 0, 1], DY = [-1, -1, -1, 0, 0, 1, 1, 1];
	const BEHIND_X = [-1, 0, -1, 1], BEHIND_Y = [0, -1, -1, -1];		// (the neighbours a sweep down the grid has passed already)
	for (let round = 0; round < rounds; round++) {
		// ROUTING: priority flood from the outlets
		seen.fill(0);
		for (let i = 0; i < n; i++) {
			route[i] = height[i] + (roughness ? roughness[i] : 0) + (random() - 0.5) * JITTER;
			if (outlet[i]) { seen[i] = 1; receiver[i] = -1; heap.push(route[i], i); }
		}
		let count = 0;
		while (heap.size > 0) {
			const c = heap.pop();
			order[count++] = c;
			const cx = c % cols, cy = (c - cx) / cols;
			for (let k = 0; k < 8; k++) {
				const x = cx + DX[k], y = cy + DY[k];
				if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
				const j = y * cols + x;
				if (seen[j]) continue;
				seen[j] = 1;
				receiver[j] = c;
				// (out of a hollow: the water fills it to its rim, and goes on over from there)
				if (route[j] < route[c]) route[j] = route[c] + 1e-3;
				heap.push(route[j], j);
			}
		}
		// (any point no outlet can reach, closed in on every side: an outlet of its own)
		for (let i = 0; i < n; i++) if (!seen[i]) { receiver[i] = -1; order[count++] = i; }
		// the steepest way down among the neighbours that drain no later (so the order still holds): the ways the routing found are the lowest
		//		way out, this turns them to the steepest where there is a choice
		const place = new Int32Array(n);
		for (let k = 0; k < count; k++) place[order[k]] = k;
		for (let k = 0; k < count; k++) {
			const c = order[k];
			if (receiver[c] < 0) continue;
			const cx = c % cols, cy = (c - cx) / cols;
			let best = receiver[c], bestDrop = (route[c] - route[best]) / ((best % cols != cx && Math.floor(best / cols) != cy) ? diagonal : cell);
			for (let q = 0; q < 8; q++) {
				const x = cx + DX[q], y = cy + DY[q];
				if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
				const j = y * cols + x;
				if (place[j] >= k) continue;
				const drop = (route[c] - route[j]) / (DX[q] && DY[q] ? diagonal : cell);
				if (drop > bestDrop) { bestDrop = drop; best = j; }
			}
			receiver[c] = best;
		}
		// AREA: from the tops down
		area.fill(cell * cell);
		for (let k = count - 1; k >= 0; k--) { const c = order[k], r = receiver[c]; if (r >= 0) area[r] += area[c]; }
		// HEIGHT: from the outlets up
		for (let k = 0; k < count; k++) {
			const c = order[k], r = receiver[c];
			if (r < 0) { height[c] = outlet[c] ? outletHeight : height[c]; continue; }
			const run = (r % cols != c % cols && Math.floor(r / cols) != Math.floor(c / cols)) ? diagonal : cell;
			const slope = Math.min(ksn[c] * Math.pow(area[c], -theta), slopeMax[c] * Math.pow(area[c] / cellArea, -phi));
			height[c] = height[r] + run * slope;
		}
		// LANDSLIDES: each way across the grid, every point no higher than the neighbours already passed allow
		for (let sweep = 0; sweep < 2 * SLIDE_SWEEPS; sweep++) {
			const sign = sweep % 2 == 0 ? 1 : -1;
			for (let k = 0; k < n; k++) {
				const c = sign > 0 ? k : n - 1 - k;
				if (outlet[c]) continue;
				const cx = c % cols, cy = (c - cx) / cols, most = slopeMax[c];
				let h = height[c];
				for (let q = 0; q < 4; q++) {
					const x = cx + BEHIND_X[q] * sign, y = cy + BEHIND_Y[q] * sign;
					if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
					const limit = height[y * cols + x] + most * (BEHIND_X[q] && BEHIND_Y[q] ? diagonal : cell);
					if (limit < h) h = limit;
				}
				height[c] = h;
			}
		}
	}
	return { height, area, receiver };
}
