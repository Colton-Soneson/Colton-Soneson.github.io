/*
	Wave refraction: which way the swell is running at every point over the terrain, and how far behind a crest out in the
	open sea it is, from the depth of the water alone.

	A wave runs slower the shallower the water under it (w^2 = g k tanh(k depth): the same period, a shorter wave, a slower one).
	So where a crest comes in at an angle to the depth contours, the end of it in shallower water falls behind and the crest
	swings round until it lies along them: waves turn to face the beach (Snell's law), wrap round headlands and fan out into bays.
	All of that is one equation, the eikonal: |grad T| = 1 / c(x). T is the time a crest takes to get to x from the open sea,
	c is the speed of the swell's waves in water as deep as it is at x. Its level lines are the crests, its gradient the way
	they run. Solved by fast sweeping (Zhao 2005): the grid is swept four times, once from each corner, each point taking the
	earliest arrival its neighbours allow (Godunov's upwind update), until nothing changes. Round the edges of the grid is the
	open sea, where the crests are the plain waves of it.

	Pure arithmetic on arrays, so it runs anywhere (water.js on the main thread, a test in node).

	refractSwell({ heights, lakes, points, worldSize, seaLevel, unitsPerMetre, direction, omega, every }) returns
		{ points, cellSize, data }: a coarser grid, every `every`th point of the land's, data 4 floats a point:
			x: the delay, c0 T - direction . position: how far behind a crest that came the same way through deep water this one is,
			   world units. 0 out in the open sea
			y, z: grad (c0 T): the way the crest runs, and as long as c0 / c: how much closer its crests are than out at sea
			w: the depth used, world units
		heights			the land's ground height at each point, points x points, row by row (z, then x), world units
		lakes			1 where a point is a lake (the swell cant get in), or null
		worldSize		the world size of the land grid, centred on the origin
		seaLevel		the height of the still sea
		unitsPerMetre	the scale of the world
		direction		[x, z] the way the swell runs out in the open sea, 1 long
		omega			its angular frequency, radians per second (its period is 2 pi / omega)
*/

const GRAVITY = 9.81;
const MOST_CROWDING = 6.0;		// the slowest a wave is let run, next to deep water: 6 times slower (about a metre of water for a long swell). Land is that slow too

// the wave number for angular frequency omega in water depth deep, metres: w^2 = g k tanh(k d), by Newton's method from Eckart's fit
export function waveNumber(omega, depth) {
	const deep = omega * omega / GRAVITY;
	let k = deep / Math.sqrt(Math.tanh(deep * Math.max(depth, 1e-4)));
	for (let i = 0; i < 4; i++) {
		const t = Math.tanh(k * depth);
		const f = GRAVITY * k * t - omega * omega;
		const df = GRAVITY * (t + k * depth * (1 - t * t));
		k = Math.max(k - f / df, deep);
	}
	return k;
}

export function refractSwell({ heights, lakes, points: landPoints, worldSize, seaLevel, unitsPerMetre, direction, omega, every = 4 }) {
	const cells = Math.floor((landPoints - 1) / every);
	const points = cells + 1;
	const cellSize = worldSize / cells;
	const half = worldSize * 0.5;
	const [sx, sz] = direction;

	// how slow the swell is at each point: 1 / its speed, in seconds per world unit
	const deepSpeed = GRAVITY / omega * unitsPerMetre;					// c0, world units a second
	const slowest = deepSpeed / MOST_CROWDING;
	const slowness = new Float64Array(points * points);
	const depths = new Float32Array(points * points);
	for (let j = 0; j < points; j++) {
		for (let i = 0; i < points; i++) {
			const land = j * every * landPoints + i * every;
			const depth = seaLevel - heights[land];
			depths[j * points + i] = depth;
			let speed = slowest;
			if (depth > 0 && !(lakes && lakes[land] > 0.5)) {
				const k = waveNumber(omega, depth / unitsPerMetre);
				speed = Math.max(omega / k * unitsPerMetre, slowest);
			}
			slowness[j * points + i] = 1 / speed;
		}
	}

	// arrival times: unknown everywhere but round the edges of the grid, where it is the open sea and the plain wave of it
	const arrival = new Float64Array(points * points).fill(Infinity);
	const position = (i) => -half + i * cellSize;
	for (let j = 0; j < points; j++) {
		for (let i = 0; i < points; i++) {
			if (i == 0 || i == cells || j == 0 || j == cells) {
				arrival[j * points + i] = (position(i) * sx + position(j) * sz) / deepSpeed;
			}
		}
	}

	// fast sweeping, Godunov's update: the earliest a crest can get here from the neighbours either side in x and in z
	const h = cellSize;
	const update = (i, j) => {
		const at = j * points + i;
		const a = Math.min(i > 0 ? arrival[at - 1] : Infinity, i < cells ? arrival[at + 1] : Infinity);
		const b = Math.min(j > 0 ? arrival[at - points] : Infinity, j < cells ? arrival[at + points] : Infinity);
		if (a === Infinity && b === Infinity) return 0;
		const fh = slowness[at] * h;
		let t;
		if (Math.abs(a - b) >= fh) {
			t = Math.min(a, b) + fh;
		} else {
			t = (a + b + Math.sqrt(2 * fh * fh - (a - b) * (a - b))) * 0.5;
		}
		if (t < arrival[at]) {
			const change = arrival[at] === Infinity ? Infinity : arrival[at] - t;
			arrival[at] = t;
			return change;
		}
		return 0;
	};
	for (let round = 0; round < 12; round++) {
		let biggest = 0;
		for (const [di, dj] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
			for (let jj = 0; jj < points; jj++) {
				const j = dj > 0 ? jj : cells - jj;
				for (let ii = 0; ii < points; ii++) {
					const i = di > 0 ? ii : cells - ii;
					biggest = Math.max(biggest, update(i, j));
				}
			}
		}
		if (biggest < 1e-6) break;
	}

	// out to world units: the delay behind the plain wave, and the gradient of c0 T
	const data = new Float32Array(points * points * 4);
	const distance = (i, j) => arrival[j * points + i] * deepSpeed;
	for (let j = 0; j < points; j++) {
		for (let i = 0; i < points; i++) {
			const at = j * points + i;
			const here = distance(i, j);
			const plain = position(i) * sx + position(j) * sz;
			// one-sided at the edges of the grid
			const gx = i == 0 ? distance(1, j) - here : i == cells ? here - distance(i - 1, j) : (distance(i + 1, j) - distance(i - 1, j)) * 0.5;
			const gz = j == 0 ? distance(i, 1) - here : j == cells ? here - distance(i, j - 1) : (distance(i, j + 1) - distance(i, j - 1)) * 0.5;
			data[at * 4 + 0] = isFinite(here) ? here - plain : 0;
			data[at * 4 + 1] = isFinite(gx) ? gx / h : sx;
			data[at * 4 + 2] = isFinite(gz) ? gz / h : sz;
			data[at * 4 + 3] = depths[at];
		}
	}
	return { points, cellSize, data };
}
