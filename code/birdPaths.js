/*
	Finding the birds a way across the land. Pure maths, no GPU in here: birds.js flies the birds along what this finds.

	THE FLIGHT GRID (buildFlightGrid)
		The world cut into squares a good deal bigger than a bird's turning circle. Every square has a price, which is how
		much a hawk would rather not fly across it:
			open land		1		the price of crossing a square is its width times this
			the sea			more	a hawk hunts over land, and only crosses water to get somewhere
			high ground		more the higher it is: going over a mountain means climbing it
			the peaks		cannot be crossed at all
		A way from one place to another is a string of squares, each next to the last, and the best way is the one whose
		prices add up to the least. That is what puts the birds through the passes and round the ranges instead of over them.

	BIDIRECTIONAL A* (findFlightPath)
		A* finds the cheapest way by growing a patch of squares it knows the cheapest way TO, outwards from the start,
		always growing next at the square where (the cost so far + the least the rest could possibly cost) is smallest.
		That second part, a straight line to the goal at the cheapest price there is, is what steers the patch towards
		the goal instead of letting it spread evenly every way.

		Bidirectional A* grows two patches at once, one from the start towards the goal and one from the goal towards the
		start, and stops when they have met and neither could still do better. Two patches that each reach half way cover
		much less ground between them than one that has to reach all the way, so fewer squares are looked at.
			- each side keeps its own costs, its own queue, and for every square which square it was reached from
			- whenever one side reaches a square the other side has already reached, the two half ways join into a whole
			  one. The cheapest whole way seen so far is kept
			- it is finished when the best square either side still has to offer could not beat that (its cost so far
			  + the least the rest could cost is already as much)
			- the way itself is read back from the square the two met at: back to the start one way, on to the goal the other
*/

const SEA_PRICE = 1.7;			// how much dearer a square of sea is than one of open land
const HIGH_GROUND = 260;		// ground higher than this above the sea starts to cost more
const PEAK_HEIGHT = 820;		// and higher than this cannot be crossed

/*
	The flight grid for a land.
		land		generateTerrain's result
		seaLevel	world y of the sea
		cells		squares along each side of the world
	Returns { cells, cellSize, half, price, ground }
		price		per square, what crossing it costs for each unit of distance. Infinity: cannot be crossed
		ground		per square, the highest ground in it, world y
*/
export function buildFlightGrid(land, seaLevel, cells = 64) {
	const half = land.cells * land.cellSize * 0.5;
	const cellSize = 2 * half / cells;
	const price = new Float32Array(cells * cells), ground = new Float32Array(cells * cells);
	for (let row = 0; row < cells; row++) {
		for (let col = 0; col < cells; col++) {
			// the highest of a few places across the square, and how much of it is under the sea
			let highest = -Infinity, wet = 0;
			for (let j = 0; j < 4; j++) {
				for (let i = 0; i < 4; i++) {
					const height = land.heightAt(-half + (col + (i + 0.5) / 4) * cellSize, -half + (row + (j + 0.5) / 4) * cellSize);
					highest = Math.max(highest, height);
					if (height < seaLevel) wet++;
				}
			}
			const above = highest - seaLevel;
			let cost = 1 + (SEA_PRICE - 1) * wet / 16;
			if (above > HIGH_GROUND) {
				const climb = (above - HIGH_GROUND) / (PEAK_HEIGHT - HIGH_GROUND);
				cost += 6 * climb * climb;
			}
			price[row * cells + col] = above > PEAK_HEIGHT ? Infinity : cost;
			ground[row * cells + col] = Math.max(highest, seaLevel);
		}
	}
	return { cells, cellSize, half, price, ground };
}

// which square of the grid a place is in (the nearest one, for a place off the edge of the world)
export function flightCell(grid, x, z) {
	const col = Math.min(Math.max(Math.floor((x + grid.half) / grid.cellSize), 0), grid.cells - 1);
	const row = Math.min(Math.max(Math.floor((z + grid.half) / grid.cellSize), 0), grid.cells - 1);
	return row * grid.cells + col;
}

// the middle of a square, as [x, z]
export function flightCellMiddle(grid, cell) {
	const col = cell % grid.cells, row = (cell - col) / grid.cells;
	return [-grid.half + (col + 0.5) * grid.cellSize, -grid.half + (row + 0.5) * grid.cellSize];
}

// A queue that always hands back whatever was put in with the lowest key (a binary heap: a tree kept in an array, every
//		entry lower than the two under it, so the lowest is always at the top and putting in or taking out only walks one branch)
function createQueue() {
	const keys = [], items = [];
	const swap = (a, b) => { const k = keys[a], i = items[a]; keys[a] = keys[b]; items[a] = items[b]; keys[b] = k; items[b] = i; };
	return {
		get size() { return keys.length; },
		lowest: () => keys.length ? keys[0] : Infinity,
		put: (key, item) => {
			keys.push(key); items.push(item);
			for (let at = keys.length - 1; at > 0;) {
				const over = (at - 1) >> 1;
				if (keys[over] <= keys[at]) break;
				swap(over, at); at = over;
			}
		},
		take: () => {
			const item = items[0];
			const lastKey = keys.pop(), lastItem = items.pop();
			if (keys.length) {
				keys[0] = lastKey; items[0] = lastItem;
				for (let at = 0;;) {
					const left = 2 * at + 1, right = left + 1;
					let least = at;
					if (left < keys.length && keys[left] < keys[least]) least = left;
					if (right < keys.length && keys[right] < keys[least]) least = right;
					if (least == at) break;
					swap(least, at); at = least;
				}
			}
			return item;
		},
	};
}

/*
	The cheapest way across the grid from one place to another (see BIDIRECTIONAL A* at the top of the file).
		from, to		[x, z]
	Returns { points, cost, looked }
		points		the way, as [x, z] places: the middles of the squares it goes through, ending at "to" itself. With the
					squares that lie in a straight line between two others left out
		cost		what it adds up to
		looked		how many squares were looked at to find it
	or null if there is no way (one of the two is shut in by peaks).
*/
export function findFlightPath(grid, from, to) {
	const cells = grid.cells, count = cells * cells;
	const start = flightCell(grid, from[0], from[1]), goal = flightCell(grid, to[0], to[1]);
	if (!isFinite(grid.price[start]) || !isFinite(grid.price[goal])) {
		return null;
	}

	// the least a stretch between two squares could cost: a straight line, at the price of open land (nothing is cheaper)
	const least = (a, b) => {
		const dc = (a % cells) - (b % cells), dr = Math.floor(a / cells) - Math.floor(b / cells);
		return Math.hypot(dc, dr) * grid.cellSize;
	};

	// the two sides: 0 growing from the start towards the goal, 1 from the goal towards the start
	const sides = [start, goal].map((origin, side) => {
		const cost = new Float32Array(count).fill(Infinity), cameFrom = new Int32Array(count).fill(-1), done = new Uint8Array(count);
		const queue = createQueue();
		cost[origin] = 0;
		queue.put(least(origin, side == 0 ? goal : start), origin);
		return { cost, cameFrom, done, queue, towards: side == 0 ? goal : start };
	});

	let best = Infinity, meeting = -1, looked = 0;
	if (start == goal) {
		best = 0; meeting = start;
	}
	while (sides[0].queue.size && sides[1].queue.size) {
		// grow whichever side has the more promising square to offer. If even that one cannot beat the best whole way, it is finished
		const side = sides[0].queue.lowest() <= sides[1].queue.lowest() ? sides[0] : sides[1];
		const other = side === sides[0] ? sides[1] : sides[0];
		if (side.queue.lowest() >= best) {
			break;
		}
		const cell = side.queue.take();
		if (side.done[cell]) {
			continue;		// (it was in the queue more than once, and the cheaper time has already been dealt with)
		}
		side.done[cell] = 1;
		looked++;

		const col = cell % cells, row = (cell - col) / cells;
		for (let dr = -1; dr <= 1; dr++) {
			for (let dc = -1; dc <= 1; dc++) {
				const nc = col + dc, nr = row + dr;
				if ((dc == 0 && dr == 0) || nc < 0 || nr < 0 || nc >= cells || nr >= cells) continue;
				const next = nr * cells + nc;
				if (!isFinite(grid.price[next])) continue;
				// (not through the gap between two peaks that only touch at their corners)
				if (dc != 0 && dr != 0 && (!isFinite(grid.price[row * cells + nc]) || !isFinite(grid.price[nr * cells + col]))) continue;

				// half of the step is in this square and half in the next, each at its own price
				const reached = side.cost[cell] + Math.hypot(dc, dr) * grid.cellSize * 0.5 * (grid.price[cell] + grid.price[next]);
				if (reached < side.cost[next]) {
					side.cost[next] = reached;
					side.cameFrom[next] = cell;
					side.queue.put(reached + least(next, side.towards), next);
					// the other side has been here: the two half ways make a whole one
					if (reached + other.cost[next] < best) {
						best = reached + other.cost[next];
						meeting = next;
					}
				}
			}
		}
	}
	if (meeting < 0) {
		return null;
	}

	// read the way back: from where they met to the start (which comes out backwards), then on from there to the goal
	const way = [];
	for (let cell = meeting; cell >= 0; cell = sides[0].cameFrom[cell]) way.unshift(cell);
	for (let cell = sides[1].cameFrom[meeting]; cell >= 0; cell = sides[1].cameFrom[cell]) way.push(cell);

	// the squares in a straight line between two others say nothing new
	const points = [];
	for (let i = 0; i < way.length; i++) {
		if (i > 0 && i < way.length - 1) {
			const a = way[i - 1], b = way[i], c = way[i + 1];
			if (b - a == c - b) continue;
		}
		points.push(flightCellMiddle(grid, way[i]));
	}
	points.push([to[0], to[1]]);
	return { points, cost: best, looked };
}
