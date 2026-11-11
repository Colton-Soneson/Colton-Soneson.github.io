/*
	Procedural land masses. Pure maths, no GPU in here: terrain.js takes what this makes and puts it on screen.

	The world is one square height grid. Each grid point gets a height from layered noise (fractional brownian motion, fBm:
	the same noise added on top of itself at higher and higher frequency and lower and lower strength), and from that a ZONE tag.

	The layers, each one a question about a point (x, z):
		continent	is this land or sea, and how far inland?				low frequency fBm, so land comes out as separate islands
		mountains	is this a mountain range?								its own low frequency fBm, kept away from the coast
		relief		the shape of the land, hills, valleys and mountains: not noise, but what running water has worn the land to (THE SHAPE OF
					THE LAND, erosion.js: the stream power law, over a whole continent at once). The layers above only say how hard the
					land is pushed up where: gently on the grassland, more round the ranges, most in them. Then only small hummocks of noise
					on top of it, and a little eroded noise on the high ground (outcrops on the faces)

	The zone rules fall out of how the layers are stacked:
		beach		every bit of land close to sea level, so it rings every land mass. A small bank steps up from it to the grass
		grassland	land that isnt beach and isnt in a mountain range. Mountain ranges are held back from the coast, so grassland always meets the beach
		forest		the outer band of a mountain range, where it has only started to rise. So forest surrounds the base of the mountains.
					And woodland: patches of forest out on the grassland, with a noise of their own (see sample)
		mountain	the core of a mountain range
		snow		mountain above the snow line
		lake		water with land all the way round it: hollows in the low ground that go down below the level of the sea
		marsh		the wet ground round a lake. The sea has beaches, a lake has marsh
		town		a seaside town (townLayout.js): on the shore where the mountains come down near the sea, its own hill rising from a
					quay in terraces, with its streets cut into it
	Laid on top of the zones, not one of them: the landing strip (see THE LANDING STRIP), and the footpaths (footpaths.js). The land
	under them is made as it would be, then laid flat for the strip, with banks no steeper than STRIP.bank where it is cut into the
	land or built up over it, and level across each path.
*/
import { findTownSites, findRiverSites, planTownGround, layoutTowns, makeRoadFlattener, makePadCutter, buildingPads } from './townLayout.js'
import { planFootpaths, makePathFlattener, PATHS } from './footpaths.js'
import { steadyLand } from './erosion.js'

// index = the tag stored for every grid point. name and color are what the rest of the engine reads
export const TERRAIN_ZONES = [
	{ name: "ocean",     color: [0.42, 0.37, 0.29] },	// the sea bed
	{ name: "beach",     color: [0.87, 0.79, 0.56] },
	{ name: "grassland", color: [0.33, 0.58, 0.22] },
	{ name: "forest",    color: [0.11, 0.31, 0.15] },
	{ name: "mountain",  color: [0.44, 0.42, 0.41] },
	{ name: "snow",      color: [0.94, 0.96, 0.99] },
	{ name: "lake",      color: [0.17, 0.17, 0.11] },	// the bed of a lake: mud
	{ name: "marsh",     color: [0.21, 0.27, 0.12] },
	{ name: "seaside town", color: [0.56, 0.5, 0.4] },
	{ name: "river",     color: [0.36, 0.33, 0.27] },	// the bed of a river: gravel and stones (THE RIVERS)
];
export const ZONE_OCEAN = 0;
export const ZONE_BEACH = 1;
export const ZONE_GRASSLAND = 2;
export const ZONE_FOREST = 3;
export const ZONE_MOUNTAIN = 4;
export const ZONE_SNOW = 5;
export const ZONE_LAKE = 6;
export const ZONE_MARSH = 7;
export const ZONE_TOWN = 8;
export const ZONE_RIVER = 9;

// The landing strip (world units, 2 to the metre): how long and how wide its packed earth is, how far out either side of the middle
//		the ground is laid flat (flat: so its edges are on the flat), how far out from that its short turf fades into the land (edge),
//		how far out past that the ground is kept level before its banks start (shoulder: past a cell of the data grid, so that is level
//		all over the flat too), how steep its banks may be where it is cut into the land or built up over it (bank, rise over run), how
//		much they are rounded
//		where they meet the land (round), how far out the trees are kept off it (clear), how far from the town it can be (reach), how
//		much it may climb end to end, how much it may be cut in or built up at the most (cut), how far out its banks may run before they
//		meet the land (banks) and how far one that has not met it by then fades out over (fade: see THE EARTHWORKS in planStrip), and
//		how far past each end the trees are kept off its approach
export const STRIP = { length: 480, width: 44, flat: 30, edge: 12, shoulder: 12, bank: 1 / 3, round: 10, clear: 35, reach: [520, 2400], grade: 0.025, cut: 40, banks: 160, fade: 200, approach: 420 };

// where in a mountain range (0 at its edge to 1 at its heart) the forest starts and where bare mountain takes over
export const FOREST_THRESHOLD = 0.16;
export const MOUNTAIN_THRESHOLD = 0.46;

/*
	What covers the ground, as one number. Everything that decides it by the pixel (the terrain's colors, where the grass grows,
	where trees stand) reads this, so that they all agree:
		0 to FOREST_THRESHOLD						open grassland
		FOREST_THRESHOLD to MOUNTAIN_THRESHOLD		forest
		MOUNTAIN_THRESHOLD and up					bare mountain
		below 0										marsh: -1 at the edge of a lake, back up to 0 where the ground has dried out
	In a mountain range it is how far into the range the ground is, which is what puts the forest round the foot of every mountain.
	Out on the grassland it is how wooded the ground is, scaled so that the thickest woodland lands in the middle of the forest band.
*/
const WOODLAND_COVER = 0.32;
export function coverOf(mountain, woodland, marsh = 0) {
	return Math.max(mountain, woodland * WOODLAND_COVER) * (1 - marsh) - marsh;
}
// a mountain range's own share of that (mountain, see sample): forest all over it, bare rock only where it stands high (BARE: from and to, of the
//		snow line, above the sea: the tree line), and up in a range at all. height: above the sea, world units
const BARE = [0.9, 1.05];
export function mountainCover(mountain, height, params) {
	const bare = smoothstep(BARE[0] * params.snowLine, BARE[1] * params.snowLine, height) * smoothstep(0.5 * FOREST_THRESHOLD, FOREST_THRESHOLD, mountain);
	return Math.max(Math.min(mountain, MOUNTAIN_THRESHOLD - 0.06), bare * (MOUNTAIN_THRESHOLD + 0.15));
}

// The shape of the mountains. Distances are world units
const MOUNTAINS = {
	spread: 0.6,				// how much of the land the ranges take up. Higher = more of it
	fromCoast: [0.04, 0.16],	// how far inland (see sample) a range starts to rise, and where it is at full strength
	fromHome: [600, 1400],		// and how far from the origin: the starting shore is kept clear of them
	homeRange: [2300, 1000],	// there is always a range to look at from the start: how far north of the origin its middle is, and how far it spreads
};

//-------------------------------NOISE-------------------------------
// small seeded random number generator (mulberry32), so a seed always gives the same world
export function seededRandom(seed) {
	let state = seed >>> 0;
	return function() {
		state = (state + 0x6D2B79F5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// 2D gradient (perlin) noise. Roughly -1 to 1, smooth, and 0 at every whole number coordinate.
// Returns the noise and its slope in one small array (reused every call, so read it before calling again):
//		[0] the value, [1] how fast it changes along x, [2] how fast it changes along y
export function createNoise(seed) {
	const random = seededRandom(seed);
	const shuffled = new Uint8Array(256);
	for (let i = 0; i < 256; i++) shuffled[i] = i;
	for (let i = 255; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		const swap = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = swap;
	}
	const perm = new Uint8Array(512);
	for (let i = 0; i < 512; i++) perm[i] = shuffled[i & 255];

	const gradX = [1, -1, 1, -1, 1, -1, 0, 0];
	const gradY = [1, 1, -1, -1, 0, 0, 1, -1];
	const out = new Float64Array(3);

	return function noise(x, y) {
		const cellX = Math.floor(x), cellY = Math.floor(y);
		const fx = x - cellX, fy = y - cellY;
		const ix = cellX & 255, iy = cellY & 255;

		const g00 = perm[perm[ix] + iy] & 7,     g10 = perm[perm[ix + 1] + iy] & 7;
		const g01 = perm[perm[ix] + iy + 1] & 7, g11 = perm[perm[ix + 1] + iy + 1] & 7;

		// what each corner of the cell says the value here is
		const a = gradX[g00] * fx + gradY[g00] * fy;
		const b = gradX[g10] * (fx - 1) + gradY[g10] * fy;
		const c = gradX[g01] * fx + gradY[g01] * (fy - 1);
		const d = gradX[g11] * (fx - 1) + gradY[g11] * (fy - 1);

		// the blend between the corners (quintic fade), and how fast that blend is changing
		const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
		const du = 30 * fx * fx * (fx - 1) * (fx - 1), dv = 30 * fy * fy * (fy - 1) * (fy - 1);
		const k = a - b - c + d;

		out[0] = (a + u * (b - a) + v * (c - a) + u * v * k) * 1.4;
		out[1] = (gradX[g00] + u * (gradX[g10] - gradX[g00]) + v * (gradX[g01] - gradX[g00]) + u * v * (gradX[g00] - gradX[g10] - gradX[g01] + gradX[g11]) + du * ((b - a) + v * k)) * 1.4;
		out[2] = (gradY[g00] + u * (gradY[g10] - gradY[g00]) + v * (gradY[g01] - gradY[g00]) + u * v * (gradY[g00] - gradY[g10] - gradY[g01] + gradY[g11]) + dv * ((c - a) + u * k)) * 1.4;
		return out;
	};
}

const smoothstep = (edge0, edge1, x) => {
	const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
	return t * t * (3 - 2 * t);
};
const clamp01 = (x) => Math.min(Math.max(x, 0), 1);

// The higher of two heights, but rounded where they cross instead of creased: within "round" of each other they blend
const smoothMax = (a, b, round) => {
	const h = Math.max(round - Math.abs(a - b), 0) / Math.max(round, 0.0001);
	return Math.max(a, b) + h * h * round * 0.25;
};

// A blur of a square grid of numbers (points x points): every one becomes the average of the square of them around it, radius cells
//		each way. Sideways then up and down, with a running total so the cost doesnt grow with the radius, and twice over, which
//		rounds the square off
function boxBlur(source, points, radius) {
	const full = points - 1;
	const scratch = new Float32Array(points * points);
	const blurred = Float32Array.from(source), width = 2 * radius + 1;
	for (let repeat = 0; repeat < 2; repeat++) {
		for (let y = 0; y < points; y++) {
			let total = 0;
			for (let x = -radius; x <= radius; x++) total += blurred[y * points + Math.min(Math.max(x, 0), full)];
			for (let x = 0; x < points; x++) {
				scratch[y * points + x] = total / width;
				total += blurred[y * points + Math.min(x + radius + 1, full)] - blurred[y * points + Math.max(x - radius, 0)];
			}
		}
		for (let x = 0; x < points; x++) {
			let total = 0;
			for (let y = -radius; y <= radius; y++) total += scratch[Math.min(Math.max(y, 0), full) * points + x];
			for (let y = 0; y < points; y++) {
				blurred[y * points + x] = total / width;
				total += scratch[Math.min(y + radius + 1, full) * points + x] - scratch[Math.max(y - radius, 0) * points + x];
			}
		}
	}
	return blurred;
}

//-------------------------------THE LAND WITHOUT ITS MOUNTAINS-------------------------------
// params: seed, worldSize, landScale, seaFloorDepth, seaBedGrade, shelfWidth, beachHeight, bankHeight, hillHeight, woodland, lakes (see the terrain settings in settings.js)
// returns { sample, erodedFbm, seamFade }
//		sample(x, z) -> { height: above sea level (negative under it) BEFORE any mountain is added,
//						  mountain: 0 to 1, how far into a mountain range,
//						  rise: 0 to 1, how much of the full mountain height this point gets,
//						  woodland: 0 to 1, how wooded the ground is where it isnt mountain,
//						  marsh: 0 to 1, how close to a lake,
//						  inland: how far from the sea, 0 at the shore }
const coreGrids = new Map();		// the world's land tiles -> the distances CORE is read from (coreAt)
const homeOffsets = new Map();		// seed -> the window on to the noise findHomeOffset found for it (every tile of a world wants the same)
export function createTerrainSampler(params) {
	const noise = createNoise(params.seed);

	// fractional brownian motion: octaves of the noise stacked up, each twice the frequency and half the strength of the last. About -1 to 1
	const fbm = (x, y, octaves) => {
		let total = 0, strength = 0.5, frequency = 1, sum = 0;
		for (let i = 0; i < octaves; i++) {
			total += noise(x * frequency, y * frequency)[0] * strength;
			sum += strength;
			strength *= 0.5;
			frequency *= 2.03;	// not exactly 2, so the octaves dont line their zero points up on top of each other
		}
		return total / sum;
	};

	/*
		fBm that erodes itself. Regular fBm, except every octave is turned down by how steep the ground already is:
		the slope of each octave is added to a running total, and each octave's strength is divided by 1 + that slope squared.

		Water runs faster on steeper ground and wears it smooth, and this imitates the result without simulating any water:
		the steep faces lose their fine detail and come out as clean slopes, while the flat places (ridge tops, valley floors)
		keep all of theirs. So the detail collects along the ridge lines and the faces between them look carved. About 0 to 1
	*/
	const erodedFbm = (x, y, octaves) => {
		let total = 0, strength = 0.5, sum = 0, slopeX = 0, slopeY = 0;
		for (let i = 0; i < octaves; i++) {
			const n = noise(x, y);
			slopeX += n[1] * 0.5;
			slopeY += n[2] * 0.5;
			total += strength * (n[0] * 0.5 + 0.5) / (1 + slopeX * slopeX + slopeY * slopeY);
			sum += strength;
			strength *= 0.5;
			// next octave: twice the frequency, and turned a bit so the octaves dont all line up along the same axes
			const turnedX = (0.8 * x - 0.6 * y) * 2.0, turnedY = (0.6 * x + 0.8 * y) * 2.0;
			x = turnedX; y = turnedY;
		}
		return total / sum;
	};

	const half = params.worldSize * 0.5;
	const seaThreshold = 0.06;
	/*
		THE WORLD'S TILES (world.js: params.world, the land tiles' keys, and their size). Without it, one land with open sea at its edge.
		openSea: how hard the continent is pushed under the sea at a place. In a tile that is not land, all the way; in a land tile with no
			land round it (the home island's), as the edge of the world has always done it (from the middle of the tile, its corners rounded
			off); in one with land beside it, by how far it is to the nearest tile that is not land: so across a side shared with another
			land tile there is no push at all, and the coast comes in from the sides that face the sea. Both tiles either side of a seam
			work it out the same, so the land runs on across it
		seamFade: 0 on a side (or a corner) shared with another land tile, 1 from SEAM in from it. What is worked out over the grid of
			one tile alone (the lakes) is faded away towards it, so the two tiles meet on ground that comes from the noise alone. (Not the
			mountains: their shape is worked out over the whole continent at once, THE SHAPE OF THE LAND)
		THE HEART OF A CONTINENT (CORE): the further a place is from the open sea round its continent (the tiles that are not land), the
			surer it is land (CORE.land, from landFrom to landTo in: the noise shapes only its coasts, its bays and its lakes, and a continent
			of many tiles is one land mass, not islands), and the more of it is mountain range (coreAt, 0 to 1, CORE.mountain). A continent of many tiles is pushed up into one main range across its
			middle, as land is where it is thickest, and the rivers wear that down into ranges high enough for snow. From how far in it
			starts (CORE.from) to where it is all range (CORE.to), world units, the way in rolled by noise (wobble) so the range does not
			follow the tiles' edges. And only along its belts (a slow noise, CORE.belt of it, about beltLength across): the earth pushes
			a continent up in long ranges with wide valleys between, not all over (the Coast Range, the Willamette Valley, the Cascades). A lonely tile (the home island) has none. The distance, and the
			range it makes, are read from a grid over the world's tiles (CORE.cell apart: the noise in them is much bigger than that),
			made once for each world
	*/
	const SEAM = 1200, OPEN_HOLD = [1000, 2800];
	const CORE = { land: 0.75, landFrom: 1200, landTo: 4500, from: 2400, to: 9000, mountain: 0.9, wobble: 1500, wobbleLength: 3600, cell: 512,
		belt: [-0.12, 0.22], beltLength: 15000 };
	const OPEN_COAST = { from: 0.6, wobble: 1100, wobbleLength: 1600, calm: 700 };	// (see openSea)
	const world = params.world ? { S: params.world.size, land: new Set(params.world.land) } : null;
	// (a tile as one number, not its key: these are asked for every point of the land, several times over)
	const tileNumber = (tx, tz) => tx * 65536 + tz;
	const landTiles = world ? new Set([...world.land].map((k) => tileNumber(...k.split(',').map(Number)))) : null;
	const isLand = (tx, tz) => landTiles.has(tileNumber(tx, tz));
	const edgeOfWorld = (lx, lz) => 1.4 * smoothstep(0.62, 1.0, Math.max(Math.abs(lx), Math.abs(lz), Math.hypot(lx, lz) * 0.8) / half);
	const lonely = new Map();
	function alone(tx, tz) {
		// (the home tile always: its coast is the one the world's edge always made, whatever meets it at a corner, world.js)
		if (tx == 0 && tz == 0) return true;
		const k = tileNumber(tx, tz);
		if (!lonely.has(k)) { let none = true; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if ((dx || dz) && isLand(tx + dx, tz + dz)) none = false; lonely.set(k, none); }
		return lonely.get(k);
	}
	// (how far a place is from the nearest tile that is not land: 0 in one, Infinity with none round it, or no world, or a lonely tile)
	function openDistance(x, z) {
		if (!world) return Infinity;
		const tx = Math.round(x / world.S), tz = Math.round(z / world.S);
		if (!isLand(tx, tz)) return 0;
		if (alone(tx, tz)) return Infinity;
		let D = Infinity;
		for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
			if ((!dx && !dz) || isLand(tx + dx, tz + dz)) continue;
			const ex = Math.max(Math.abs(x - (tx + dx) * world.S) - half, 0), ez = Math.max(Math.abs(z - (tz + dz) * world.S) - half, 0);
			D = Math.min(D, Math.hypot(ex, ez));
		}
		return D;
	}
	function openSea(x, z) {
		if (!world) return edgeOfWorld(x, z);
		const tx = Math.round(x / world.S), tz = Math.round(z / world.S);
		if (!isLand(tx, tz)) return 1.4;
		if (alone(tx, tz)) return edgeOfWorld(x - tx * world.S, z - tz * world.S);
		const D = openDistance(x, z);
		if (D == Infinity) return 0;
		// (over a wider band than a lonely tile's, and the way in from the tile's edge rolled by noise, so the coast it makes is not a
		//		straight line along the edge where the land is high. At the edge itself as hard as in the open sea, the same either side)
		const wobble = OPEN_COAST.wobble * fbm(x / OPEN_COAST.wobbleLength + 91.3, z / OPEN_COAST.wobbleLength - 47.2, 3) * smoothstep(0, OPEN_COAST.calm, D);
		return 1.4 * smoothstep(OPEN_COAST.from, 1.0, 1 - Math.max(D + wobble, 0) / half);
	}
	function seamFade(x, z) {
		if (!world) return 1;
		const tx = Math.round(x / world.S), tz = Math.round(z / world.S), lx = x - tx * world.S, lz = z - tz * world.S;
		if (tx == 0 && tz == 0) return 1;		// (the home tile: as it always was)
		let d = Infinity;
		for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
			if ((!dx && !dz) || !isLand(tx + dx, tz + dz)) continue;
			// (a side: how far in from it; a corner: how far from it)
			if (!dx || !dz) d = Math.min(d, dx ? half - lx * dx : half - lz * dz);
			else d = Math.min(d, Math.hypot(half - lx * dx, half - lz * dz));
		}
		return d == Infinity ? 1 : smoothstep(0, SEAM, d);
	}
	// (how far a place is from the open sea round its continent, world units: 0 in it, and in a lonely tile, or with no world)
	function deepIn(x, z) {
		if (!world) return 0;
		const tx = Math.round(x / world.S), tz = Math.round(z / world.S);
		if (!isLand(tx, tz) || alone(tx, tz)) return 0;
		return gridRead(coreGrid(world), 'dist', x, z);
	}
	function coreAt(x, z) {
		if (!world) return 0;
		const tx = Math.round(x / world.S), tz = Math.round(z / world.S);
		if (!isLand(tx, tz) || alone(tx, tz)) return 0;
		return gridRead(coreGrid(world), 'core', x, z);
	}
	const gridRead = (g, field, x, z) => {
		const gx = Math.min(Math.max((x - g.x0) / g.cell, 0), g.cols - 1.0001), gz = Math.min(Math.max((z - g.z0) / g.cell, 0), g.rows - 1.0001);
		const col = Math.floor(gx), row = Math.floor(gz), fx = gx - col, fz = gz - row, k = row * g.cols + col, v = g[field];
		const top = v[k] + (v[k + 1] - v[k]) * fx, bottom = v[k + g.cols] + (v[k + g.cols + 1] - v[k + g.cols]) * fx;
		return top + (bottom - top) * fz;
	};
	// (the distances, world units, from every point of a grid over the world's land tiles and one tile round them to the nearest one not land)
	function coreGrid(world) {
		if (world.core) return world.core;
		const key = (params.seed ?? 0) + ':' + world.S + ':' + [...world.land].sort().join(';');
		if (coreGrids.has(key)) return world.core = coreGrids.get(key);
		const at = [...world.land].map((k) => k.split(',').map(Number));
		const lo = [Math.min(...at.map((t) => t[0])) - 1, Math.min(...at.map((t) => t[1])) - 1], hi = [Math.max(...at.map((t) => t[0])) + 1, Math.max(...at.map((t) => t[1])) + 1];
		const cell = CORE.cell, x0 = (lo[0] - 0.5) * world.S, z0 = (lo[1] - 0.5) * world.S;
		const cols = Math.round((hi[0] - lo[0] + 1) * world.S / cell) + 1, rows = Math.round((hi[1] - lo[1] + 1) * world.S / cell) + 1;
		const dist = new Float32Array(cols * rows);
		for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) dist[row * cols + col] = isLand(Math.round((x0 + col * cell) / world.S), Math.round((z0 + row * cell) / world.S)) ? 1e9 : 0;
		// (two sweeps, each point taking the shortest way through a neighbour: near enough the straight line at this spacing)
		const steps = [[-1, 0, cell], [0, -1, cell], [-1, -1, cell * Math.SQRT2], [1, -1, cell * Math.SQRT2]];
		for (const sign of [1, -1]) for (let k = 0; k < dist.length; k++) {
			const i = sign > 0 ? k : dist.length - 1 - k, col = i % cols, row = (i - col) / cols;
			for (const [dx, dz, run] of steps) {
				const c = col + dx * sign, r = row + dz * sign;
				if (c >= 0 && r >= 0 && c < cols && r < rows) dist[i] = Math.min(dist[i], dist[r * cols + c] + run);
			}
		}
		// (and the range there: CORE)
		const core = new Float32Array(cols * rows);
		for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
			const i = row * cols + col, x = x0 + col * cell, z = z0 + row * cell;
			if (dist[i] < CORE.from - CORE.wobble) continue;
			const belt = smoothstep(CORE.belt[0], CORE.belt[1], fbm(x / CORE.beltLength - 41.3, z / CORE.beltLength + 8.6, 2));
			if (belt > 0) core[i] = belt * smoothstep(CORE.from, CORE.to, dist[i] + CORE.wobble * fbm(x / CORE.wobbleLength + 13.7, z / CORE.wobbleLength - 71.9, 3));
		}
		const grid = { x0, z0, cell, cols, rows, dist, core };
		coreGrids.set(key, grid);
		return world.core = grid;
	}	// how much of the continent noise is under water. Higher = less land
	const shape = MOUNTAINS;

	// The noise is endless, the world is one window on to it. originOffset picks which window (see findHomeOffset)
	let offsetX = 0, offsetZ = 0;

	// The shelf: the shallow ground that runs out under the water from a beach, before the sea bed drops away.
	//		out is how far a point is from the shore (0 at the waterline, growing seawards, in the units of the continent noise).
	//		It is slowed down over the shallows, so that the bed which shows through the water (down to about 4 deep) runs
	//		shelfWidth times as far out as it would have. Not from the waterline itself: the first stretch, down to about
	//		1 deep, is left alone, or the surf would break in water too thin to cover the sand. Past the shallows it is caught
	//		up again over a short run, so the bed drops off the edge of the shelf to the shape it would have had anyway, and
	//		the deep water is not pushed out to sea with the shallows. With a width of 1 it comes back as it went in
	const shelfWidth = Math.max(params.shelfWidth ?? 1, 1);
	const shelfStart = 0.0085, shelfSlowed = 1 + (shelfWidth - 1) * 1.85;	// (1.85: the part that is slowed is that much shorter than the whole shallows)
	const shelfEnd = shelfStart + 0.01 * shelfSlowed, deepStart = shelfEnd + 0.03;
	const shelfRun = (out) => {
		if (out <= shelfStart) {
			return out;
		}
		const slowed = shelfStart + (out - shelfStart) / shelfSlowed;
		return slowed + (out - slowed) * smoothstep(shelfEnd, deepStart, out);
	};

	// relief: the shape of the land there (THE SHAPE OF THE LAND), world units; or null for the land as the noise alone has it (what the shape's
	//		first round is routed over, and what the window on to the noise is chosen by)
	function sample(x, z, relief = null) {
		const nx = x + offsetX, nz = z + offsetZ;

		//---continent: land or sea, and how far inland
		let continent = fbm(nx / params.landScale, nz / params.landScale, 5);
		// a push towards land just north of the origin, so there is always an island to start on with its shore at the origin
		const homeX = x, homeZ = z + 520;
		continent += 0.42 * Math.exp(-(homeX * homeX + homeZ * homeZ) / (2 * 620 * 620));
		// and a wider one further north, for the mountains behind it to stand on (see homeRange)
		const rangeZ = z + shape.homeRange[0];
		const homeRange = Math.exp(-(x * x + rangeZ * rangeZ) / (2 * shape.homeRange[1] * shape.homeRange[1]));
		continent += 0.45 * homeRange;
		// and a push to open sea at the edge of the world, so no land mass gets cut off by it. It starts well inside the edge and
		//		comes on slowly, so the coast it makes still follows the noise instead of running in a straight line, and it is
		//		measured part of the way round the corners, so they are cut off
		continent -= openSea(x, z);
		// (and the inside of a continent of many tiles land: CORE)
		const deep = deepIn(x, z);
		if (deep > CORE.landFrom) continent += CORE.land * smoothstep(CORE.landFrom, CORE.landTo, deep);
		const inland = continent - seaThreshold;	// > 0 is land, and it grows with distance from the shore

		if (inland <= 0) {
			// under water: a shelf that eases away from the beach, then the drop-off. (From the drop-off on down the bed keeps
			//		falling at a steady grade, which is added in generateTerrain: see THE SEA BED there)
			const floor = -params.seaFloorDepth * smoothstep(0, 0.2, shelfRun(-inland));
			return { height: floor - 0.2, mountain: 0, rise: 0, woodland: 0, marsh: 0, inland, core: 0 };
		}

		//---mountain ranges: their own noise, forced to nothing near the coast (and around the home shore)
		const range = fbm(nx / (params.landScale * 0.62) + 31.7, nz / (params.landScale * 0.62) - 12.4, 3);
		let mountain = clamp01(shape.spread + range * 1.7 + 0.7 * homeRange);
		mountain *= smoothstep(shape.fromCoast[0], shape.fromCoast[1], inland);
		mountain *= smoothstep(shape.fromHome[0], shape.fromHome[1], Math.hypot(x, z));
		// (and the heart of a continent all range: CORE)
		const core = deep > CORE.from - CORE.wobble ? coreAt(x, z) : 0;
		mountain = Math.max(mountain, CORE.mountain * core * smoothstep(shape.fromCoast[0], shape.fromCoast[1], inland));
		const seam = seamFade(x, z);
		// (and in a land tile beside the open sea, held back from it: the push to the sea comes on over a short way, and a range right up
		//		to it would end in a wall over the water. A lonely tile, the home island, is as it was)
		mountain *= smoothstep(OPEN_HOLD[0], OPEN_HOLD[1], openDistance(x, z));
		const rise = Math.pow(smoothstep(FOREST_THRESHOLD, 1.0, mountain), 1.35);	// 0 at the forest edge of a range, 1 at its heart

		//---base land: a gentle run up from the waterline (the beach), levelling off to a low plateau inland
		const base = 58 * Math.tanh(1.9 * inland);

		//---rolling hills, fading in from the beach: a long slow swell, hills on that, and hummocks on those
		//		With the shape of the land, only the hummocks: its hills and valleys are the relief's, coming up from the shore, and on its high
		//		ground a little eroded noise (outcrops and gullies on the faces, finer than the relief's points: OUTCROPS)
		let hills = relief === null ? fbm(nx / 1150 + 3.1, nz / 1150 - 7.4, 3) * 36 + fbm(nx / 330, nz / 330, 4) * 27 + fbm(nx / 95 + 5.2, nz / 95 + 1.3, 3) * 5 : fbm(nx / 95 + 5.2, nz / 95 + 1.3, 3) * 5;
		hills *= (params.hillHeight ?? 1) * smoothstep(0.03, 0.22, inland);
		if (relief !== null) hills += relief * smoothstep(COAST[0], COAST[1], inland) + (erodedFbm(nx / OUTCROPS.length, nz / OUTCROPS.length, 5) - 0.5) * OUTCROPS.height * smoothstep(OUTCROPS.from[0], OUTCROPS.from[1], relief);
		hills *= 0.3 + 0.7 * smoothstep(180, 650, Math.hypot(x, z + 70));	// gentler round the start: there are buildings to stand on it
		hills = Math.max(hills, -0.45 * base);	// a dip between hills never gets back down to beach level, so the beach stays at the shore
		let height = base + hills * (relief === null ? 1 - 0.6 * rise : 1);

		//---woodland: forest that isnt holding on to a mountain. Its own noise, so it comes in patches across the grassland,
		//		big ones with ragged edges and small copses between them. Kept off the shore, and clear of the start
		const wooded = fbm(nx / 900 - 14.2, nz / 900 + 27.8, 3) + 0.35 * fbm(nx / 210 + 8.8, nz / 210 - 3.9, 2);
		const clear = 0.35 - 0.7 * (params.woodland ?? 0.5);		// the noise has to be above this to be wooded: lower = more woodland
		let woodland = smoothstep(clear, clear + 0.1, wooded) * smoothstep(0.1, 0.2, inland) * smoothstep(260, 620, Math.hypot(x, z));

		//---lakes: hollows in the low ground. Another noise picks out where, and there the land is drawn down: gently at first,
		//		so the ground all round tips towards the water, then under the level of the sea, where it fills.
		//		Not in the mountains or their forest, not hard up against the coast, and not on top of the start
		const hollow = fbm(nx / 560 + 51.3, nz / 560 - 22.6, 3) + 0.3 * fbm(nx / 150 - 6.1, nz / 150 + 40.2, 2);
		const wet = 0.5 - 0.42 * (params.lakes ?? 0.5);		// the noise has to be above this for there to be water: lower = more lakes
		const allowed = smoothstep(0.1, 0.24, inland) * (1 - smoothstep(0, FOREST_THRESHOLD, mountain)) * smoothstep(420, 800, Math.hypot(x, z)) * seam;
		// the valley: over a wide band of the noise the hills are levelled away and the ground brought down to just above the water.
		//		A lake lies in the bottom of a broad dip, the land does not drop into it off a ledge
		const valley = smoothstep(wet - 0.32, wet, hollow) * allowed;
		height += (1.2 - height) * valley;
		// and the lake itself, in the bottom of that: a shallow shelf round the edge, deeper water in the middle
		const basin = smoothstep(wet, wet + 0.17, hollow) * allowed;
		height -= 3.2 * smoothstep(0, 0.35, basin) + 11 * smoothstep(0.35, 1, basin);
		const marsh = smoothstep(0.72, 0.96, valley);		// the ground is wet well before it is under water
		woodland *= 1 - marsh;

		//---the bank: where the sand ends the ground steps up to the turf, the way a beach is cut in under the grass behind it.
		//		everything above the top of the beach is lifted by the height of the bank, over as short a run as the mesh allows
		//		(not round a lake: there is no surf there to cut one)
		height += params.bankHeight * smoothstep(params.beachHeight - 0.15, params.beachHeight + 0.15, height) * (1 - marsh);

		return { height: height, mountain: mountain, rise: rise, woodland: woodland, marsh: marsh, inland, core };
	}

	// Looks through windows on to the noise until it finds one where the start of the world makes sense:
	//		the origin (where the camera starts off looking) is on the shore, there is sea just south of it for the camera to sit over, and land to the north
	function findHomeOffset() {
		const known = homeOffsets.get(params.seed);
		if (known) { offsetX = known[0]; offsetZ = known[1]; return; }
		const random = seededRandom(params.seed ^ 0x9E3779B9);
		let best = [0, 0], bestScore = -Infinity;
		for (let attempt = 0; attempt < 600; attempt++) {
			offsetX = (random() - 0.5) * 40000;
			offsetZ = (random() - 0.5) * 40000;
			const atOrigin = sample(0, 0).height, south = sample(0, 170).height, farSouth = sample(0, 330).height, north = sample(0, -260).height;
			let score = 0;
			score -= Math.abs(atOrigin - 4);							// origin just above the waterline
			score += Math.min(-south, 6) + Math.min(-farSouth, 12);		// open water to the south
			score += Math.min(north, 20) * 0.5;							// solid land to the north
			if (score > bestScore) { bestScore = score; best = [offsetX, offsetZ]; }
			if (atOrigin > 1.5 && atOrigin < 8 && south < -3 && farSouth < -10 && north > 12) { best = [offsetX, offsetZ]; break; }
		}
		offsetX = best[0]; offsetZ = best[1];
		homeOffsets.set(params.seed, best);
	}
	findHomeOffset();

	return { sample: sample, erodedFbm: (x, z, octaves) => erodedFbm(x + offsetX * 0.001, z + offsetZ * 0.001, octaves), seamFade };
}

//-------------------------------THE SHAPE OF THE LAND-------------------------------
/*
	The relief of the land is what water has made of it (erosion.js: the land in its steady state under the stream power law, its rivers in
	dendritic networks and its hillslopes at the angle their soil holds). Not noise: the noise only says how hard the land is pushed up
	where (and so how high it stands), and where the big valleys start out (the land the first round is routed over).
	THE CONTINENT: a land's relief is one piece, made over the whole of it at once (all the land tiles side by side with this one: world.js),
	SHAPE.cell apart, out to SHAPE.margin past it into the sea. So a river runs on from one tile into the next, and two tiles meet on the
	same ground. Made the first time a tile of it is wanted, and kept (SHAPE.kept of them): the tile worker makes each continent's once.
	A tile reads its own window of it (reliefWindow), the points round it as well, and the ground between them by cubic interpolation.
	HOW HIGH (metres; KSN: the channel steepness of the stream power law): the grassland's gentle hills (hills), the forest round the foot
	of a mountain range (foot), the ranges themselves (range, as high as the Mountain Height setting asks); each turned up and down by the
	rock (rock: harder rock stands higher), and brought down to nothing at the shore (coast: there is always a beach to come ashore on).
	SLOPE: the steepest a hillslope stands at the top of a stream, from the grassland's to a range's (Montgomery 2001: the Oregon Coast
	Range's at about 40 degrees, rise over run 0.8: forest all the way up; the cores of the ranges steeper, crags of bare rock).
	Both of a range's go with the Mountain Height setting (HIGH: what they are for). On lands this size the ranges come out under that
	(450 m at 1400, the home island): as high as the land is wide lets them, at those slopes. Steeper would be higher, and bare rock
*/
const SHAPE = { cell: 64, margin: 1024, kept: 6, metre: 2 };	// world units: between the points, past the land into the sea; continents kept; world units to the metre
const KSN = { hills: 12, foot: 80, range: 260, rock: [0.7, 1.35], rockLength: 2600 };
const SLOPE = { hills: 0.25, foot: 0.8, range: 1.25 };
const FOOT = [0.12, 0.42];		// how far into a range (its mountain value: sample) its forested foot starts, and where it is all there: the grassland out of it gentle
const ROUGH = { height: 60, length: 1500 };	// the lie of the rock the streams gather in (erosion.js: roughness): metres, and the size of its biggest shapes (world units)
/*
	THE MASSIFS: on a big continent (MASSIF.tiles or more) one or two mountains far over all the rest, well up through the snow: a
	Denali, an Aoraki. Each stands somewhere in the heart of the continent (CORE at least MASSIF.core), at random, MASSIF.apart of them
	from each other, MASSIF.radius across (world units), its outline rolled by noise. Over it the rock is pushed up far faster than the
	rivers can cut it down, so in the steady state the channels stand MASSIF.uplift times as steep and its faces at up to MASSIF.slope: all
	of it over its heart (MASSIF.heart of its radius), less and less out to its edge. That wears it into ridges and valleys a few
	kilometres high; under them the whole of it stands on a dome of the earth's crust pushed up (MASSIF.dome, world units at its middle,
	falling away to its edge as (1 - how far out) to the MASSIF.domeShape), as the great volcanoes of the Cascades stand on theirs. The
	dome is put under the land the rivers made: it falls away outwards, the way they run off it. So 6500 to 7500 m at the top:
	the same law as all the land (erosion.js), its ridges and valleys worn into it as everywhere else
*/
const MASSIF = { tiles: 12, count: [1, 2], radius: [10000, 13000], core: 0.85, apart: 2.2, uplift: 15, slope: 1.7, heart: 0.45, wobble: 0.3, dome: [10500, 12000], domeShape: 1.6 };
const HIGH = 1400;				// the Mountain Height the KSN and the SLOPE of the ranges are for
const COAST = [0.012, 0.09];		// how far inland (see sample) the relief starts to rise, and where it is all there
const OUTCROPS = { length: 260, height: 16, from: [40, 500] };	// the eroded noise on the high ground: how big, how high (world units), and from how high a relief to how high it is all there
const shapes = new Map();
const shapeMassifs = new Map();		// a continent's key -> its massifs, { x, z, radius } (for testing)
export const massifsOf = () => [...shapeMassifs.values()].flat();

// the continent the tile at (cx, cz) world units is in: its land tiles, as the world lays them out (one land without a world: all of it)
function continentOf(params, cx, cz) {
	if (!params.world) return { key: 'one', x0: -params.worldSize / 2 - SHAPE.margin, z0: -params.worldSize / 2 - SHAPE.margin, x1: params.worldSize / 2 + SHAPE.margin, z1: params.worldSize / 2 + SHAPE.margin };
	const S = params.world.size, land = new Set(params.world.land), start = [Math.round(cx / S), Math.round(cz / S)];
	const seen = new Set([start.join(',')]), queue = [start];
	let lo = [...start], hi = [...start];
	// (side by side: two that only meet at a corner have a strait between them, and are two lands)
	while (queue.length) {
		const [tx, tz] = queue.pop();
		lo = [Math.min(lo[0], tx), Math.min(lo[1], tz)]; hi = [Math.max(hi[0], tx), Math.max(hi[1], tz)];
		if (tx == 0 && tz == 0) continue;		// (the home island: alone, whatever is beside it)
		for (const [x, z] of [[tx + 1, tz], [tx - 1, tz], [tx, tz + 1], [tx, tz - 1]]) {
			const k = x + ',' + z;
			if (!seen.has(k) && land.has(k) && !(x == 0 && z == 0)) { seen.add(k); queue.push([x, z]); }
		}
	}
	return { key: [...seen].sort().join(' '), x0: (lo[0] - 0.5) * S - SHAPE.margin, z0: (lo[1] - 0.5) * S - SHAPE.margin, x1: (hi[0] + 0.5) * S + SHAPE.margin, z1: (hi[1] + 0.5) * S + SHAPE.margin };
}

// the relief of the continent a tile is in (see THE CONTINENT): { x0, z0, cell, cols, rows, height (world units over the land under it), area (square metres drained) }
function continentShape(params, sample, noise) {
	const [cx, cz] = params.center ?? [0, 0];
	const c = continentOf(params, cx, cz);
	const key = [params.seed, params.mountainHeight, params.hillHeight ?? 1, params.worldSize, c.key].join('|');		// (and the land's other settings, through sample: the cache is let go with the land)
	const known = shapes.get(key);
	if (known) return known;
	const cell = SHAPE.cell, m = SHAPE.metre;
	const cols = Math.round((c.x1 - c.x0) / cell) + 1, rows = Math.round((c.z1 - c.z0) / cell) + 1, n = cols * rows;
	const start = new Float32Array(n), outlet = new Uint8Array(n), ksn = new Float32Array(n), slopeMax = new Float32Array(n);
	const rangeHigh = (params.mountainHeight ?? HIGH) / HIGH, hillHigh = params.hillHeight ?? 1, slopeHigh = Math.min(Math.sqrt(rangeHigh), 1.4);
	const rough = new Float32Array(n), roughNoise = createNoise((params.seed ?? 0) + 9311), cores = new Float32Array(n);
	for (let row = 0; row < rows; row++) {
		for (let col = 0; col < cols; col++) {
			const i = row * cols + col, x = c.x0 + col * cell, z = c.z0 + row * cell;
			const s = sample(x, z);
			// (the water leaves into the sea, and into the lakes; and off the edge, which is all sea)
			outlet[i] = s.height < 0 || col == 0 || row == 0 || col == cols - 1 || row == rows - 1 ? 1 : 0;
			// where the big valleys start out: the land as the noise has it, the ranges up high
			start[i] = (s.height + params.mountainHeight * 0.4 * s.rise) / m;
			const foot = smoothstep(FOOT[0], FOOT[1], s.mountain), rock = KSN.rock[0] + (KSN.rock[1] - KSN.rock[0]) * (0.5 + 0.5 * noise(x / KSN.rockLength + 13.1, z / KSN.rockLength - 27.4)[0]);
			ksn[i] = (KSN.hills * hillHigh + (KSN.foot * hillHigh - KSN.hills * hillHigh) * foot + (KSN.range * rangeHigh - KSN.foot * hillHigh) * Math.pow(s.rise, 1.2)) * rock * smoothstep(COAST[0], COAST[1] * 1.5, s.inland);
			slopeMax[i] = SLOPE.hills + (SLOPE.foot * slopeHigh - SLOPE.hills) * foot + (SLOPE.range - SLOPE.foot) * slopeHigh * s.rise;
			cores[i] = outlet[i] ? 0 : s.core;
			let r = 0, a = 1, f = 1 / ROUGH.length;
			for (let k = 0; k < 4; k++) { r += roughNoise(x * f + k * 17.3, z * f - k * 9.1)[0] * a; a *= 0.55; f *= 2.1; }
			rough[i] = r * ROUGH.height;
		}
	}
	// THE MASSIFS: where, and how far into each every point is
	const tiles = c.key.split(' ').length;
	let massifs = [], outline = null;
	if (tiles >= MASSIF.tiles) {
		const random = seededRandom(((params.seed ?? 0) * 104723 + [...c.key].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7)) >>> 0);
		const want = MASSIF.count[0] + Math.floor(random() * (MASSIF.count[1] - MASSIF.count[0] + 1));
		const heart = [];
		for (let i = 0; i < n; i++) if (cores[i] >= MASSIF.core) heart.push(i);
		massifs = [];
		for (let tries = 0; tries < 60 && massifs.length < want && heart.length; tries++) {
			const i = heart[Math.floor(random() * heart.length)], x = c.x0 + (i % cols) * cell, z = c.z0 + Math.floor(i / cols) * cell;
			const radius = MASSIF.radius[0] + (MASSIF.radius[1] - MASSIF.radius[0]) * random();
			if (massifs.some((o) => Math.hypot(o.x - x, o.z - z) < MASSIF.apart * Math.max(o.radius, radius) * 0.5 + 0.5 * MASSIF.apart * radius)) continue;
			massifs.push({ x, z, radius, dome: MASSIF.dome[0] + (MASSIF.dome[1] - MASSIF.dome[0]) * random() });
		}
		outline = createNoise((params.seed ?? 0) + 6151);
		for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
			const i = row * cols + col;
			if (outlet[i]) continue;
			const x = c.x0 + col * cell, z = c.z0 + row * cell;
			let f = 0;
			for (const o of massifs) {
				const d = Math.hypot(x - o.x, z - o.z) / o.radius * (1 + MASSIF.wobble * outline(x / 5200 + 3.7, z / 5200 - 8.1)[0]);
				f = Math.max(f, smoothstep(1, MASSIF.heart, d));		// (all of it over its heart: MASSIF.heart of its radius)
			}
			if (f <= 0) continue;
			ksn[i] *= 1 + MASSIF.uplift * f;
			slopeMax[i] = Math.max(slopeMax[i], slopeMax[i] + (MASSIF.slope - slopeMax[i]) * f);
		}
		shapeMassifs.set(c.key, massifs);
	}
	const land = steadyLand({ cols, rows, cell: cell / m, start, outlet, ksn, slopeMax, roughness: rough, random: seededRandom((params.seed * 7919 + c.key.length * 104729) >>> 0) });
	const height = land.height.map((h, i) => outlet[i] ? 0 : h * m);
	// (and the massifs' domes under it)
	for (const o of massifs) {
		for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
			const i = row * cols + col;
			if (outlet[i]) continue;
			const x = c.x0 + col * cell, z = c.z0 + row * cell;
			const d = Math.hypot(x - o.x, z - o.z) / o.radius * (1 + MASSIF.wobble * outline(x / 5200 + 3.7, z / 5200 - 8.1)[0]);
			if (d < 1) height[i] += o.dome * Math.pow(1 - d, MASSIF.domeShape);
		}
	}
	const shape = { x0: c.x0, z0: c.z0, cell, cols, rows, height, area: land.area };
	// (and the rivers in it: THE RIVERS, over the ground as it will be made, the relief in it)
	const reliefOf = makeReliefAt(shape);
	shape.rivers = riverLines(shape, land.receiver, (x, z) => sample(x, z, reliefOf(x, z)).height);
	shapes.set(key, shape);
	if (shapes.size > SHAPE.kept) shapes.delete(shapes.keys().next().value);
	return shape;
}

// a tile's window of its continent's relief: the points over it and 2 more all round (for the cubic between them). Plain data: it goes to the
//		other threads with the chunk grids
function reliefWindow(params, shape) {
	const [ox, oz] = params.center ?? [0, 0], half = params.worldSize / 2, cell = shape.cell;
	const x0 = ox - half - 2 * cell, z0 = oz - half - 2 * cell, cols = Math.round(params.worldSize / cell) + 5, rows = cols;
	const height = new Float32Array(cols * rows), area = new Float32Array(cols * rows);
	const c0 = Math.round((x0 - shape.x0) / cell), r0 = Math.round((z0 - shape.z0) / cell);
	for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
		const sc = Math.min(Math.max(c0 + col, 0), shape.cols - 1), sr = Math.min(Math.max(r0 + row, 0), shape.rows - 1);
		height[row * cols + col] = shape.height[sr * shape.cols + sc];
		area[row * cols + col] = shape.area[sr * shape.cols + sc];
	}
	return { x0, z0, cell, cols, rows, height, area };
}

// the relief at a world position: cubic (Catmull-Rom) between the points of the window, so the ground has no creases along them
function makeReliefAt(window) {
	if (!window) return () => 0;
	const { x0, z0, cell, cols, rows, height } = window;
	const at = (c, r) => height[Math.min(Math.max(r, 0), rows - 1) * cols + Math.min(Math.max(c, 0), cols - 1)];
	const cubic = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
	return (x, z) => {
		const gx = (x - x0) / cell, gz = (z - z0) / cell, c = Math.floor(gx), r = Math.floor(gz), fx = gx - c, fz = gz - r;
		const row = (k) => cubic(at(c - 1, k), at(c, k), at(c + 1, k), at(c + 2, k), fx);
		return Math.max(cubic(row(r - 1), row(r), row(r + 1), row(r + 2), fz), 0);
	};
}

// where the ridges run (for what stands on them: boulderGenerator.js): [x, z, ...] world units of the points of the window over the tile that
//		nothing drains into, high up in a range
function crestsOf(params, window, rises) {
	const [ox, oz] = params.center ?? [0, 0], half = params.worldSize / 2, out = [];
	const least = window.cell * window.cell / (SHAPE.metre * SHAPE.metre) * 1.5;
	for (let row = 2; row < window.rows - 2; row++) for (let col = 2; col < window.cols - 2; col++) {
		const i = row * window.cols + col, x = window.x0 + col * window.cell, z = window.z0 + row * window.cell;
		if (window.area[i] > least || window.height[i] < params.mountainHeight * 0.25) continue;
		if (Math.abs(x - ox) > half || Math.abs(z - oz) > half || rises(x, z) < 0.15) continue;
		out.push(x, z);
	}
	return new Float32Array(out);
}

//-------------------------------THE RIVERS-------------------------------
/*
	THE RIVERS: the water the land was worn by (THE SHAPE OF THE LAND), running in it. Every point of a continent's relief that drains
	more than RIVERS.area is on a stream (erosion.js: area, and receiver, the point each drains to). From each stream's head down to
	where it meets one already laid, or the sea, a line of them (riverLines); the corners of the 8 ways they go rounded off, every point
	drawn towards the one it drains to and the biggest that drains to it (RIVERS.smooth times), then cut in a quarter and three quarters
	along each stretch (Chaikin). Rounded off like that a line cuts the corners of its valley, up the sides of it: so each point is put
	back on the bottom of the valley the ground makes there (the lowest of the places across the way it runs, RIVERS.snap: how many each
	side and how far apart), and the line evened out again a little. At each point:
		how wide	hydraulic geometry (Leopold and Maddock 1953): a river is as wide as about the square root of the water it carries, and
					that goes with the land it drains: RIVERS.width[0] times (area in square kilometres) to the RIVERS.width[1], metres
		how deep	the same way, to about the 0.4 power (RIVERS.depth)
		its water	the land under its middle (the noise and the relief together, as the ground is made: natural) cut down a little into it
					(RIVERS.incise), and never higher than it is upstream: water does not run up hill, and where the land comes up in its way
					it stands level over it. Never under the sea
	In the land (makeRiverCutter): under the water its bed, deepest in the middle; to either side its banks, the land cut down to no
	steeper than RIVERS.bank over the water's edge, out to RIVERS.reach; and right by the water, never lower than it (RIVERS.levee): the
	river is in its channel. Its bed is stony (RIVERS.cover) and its own zone (ZONE_RIVER): no grass, no trees.
	A tile has the stretches near it (riverWindow): every one it is cut by, and the ones it draws (rivers.js), each drawn by the one tile
	its middle is in. Units: world units, and the water's height over the sea
*/
const RIVERS = { area: 0.25e6, width: [3.5, 0.5], depth: [0.35, 0.4], incise: 0.7, smooth: 2, snap: [5, 5], bank: 0.9, reach: 30, fade: 0.55, levee: 5, cover: MOUNTAIN_THRESHOLD + 0.02, bucket: 64 };
export const RIVER_FLOATS = 6;		// a point of a river: x, z, its water (over the sea), half its width, its depth, how far along its line from the head

// the lines of a continent's rivers: { points: Float32Array, RIVER_FLOATS each, starts: Int32Array, where each line's points begin (and
//		one more, the end) }. natural(x, z): the ground there, over the sea
function riverLines(shape, receiver, natural) {
	const { cols, x0, z0, cell, area } = shape, n = area.length, m = SHAPE.metre;
	const nodes = [];
	for (let i = 0; i < n; i++) if (area[i] >= RIVERS.area && receiver[i] >= 0) nodes.push(i);
	// (more land drains through each point than through any that drains to it: by that, each comes after all of those)
	nodes.sort((a, b) => area[a] - area[b] || a - b);
	const biggest = new Map();		// a point -> the biggest stream that drains to it
	for (const i of nodes) { const r = receiver[i], b = biggest.get(r); if (b === undefined || area[i] > area[b]) biggest.set(r, i); }
	// the corners rounded: each drawn towards the point below it and the biggest above it
	const px = new Map(), pz = new Map();
	const placeOf = (i) => [px.get(i) ?? x0 + (i % cols) * cell, pz.get(i) ?? z0 + Math.floor(i / cols) * cell];
	for (let pass = 0; pass < RIVERS.smooth; pass++) {
		const nx = new Map(), nz = new Map();
		for (const i of nodes) {
			const [x, z] = placeOf(i), [rx, rz] = placeOf(receiver[i]), up = biggest.get(i), [ux, uz] = up === undefined ? [x, z] : placeOf(up);
			nx.set(i, 0.5 * x + 0.25 * rx + 0.25 * ux); nz.set(i, 0.5 * z + 0.25 * rz + 0.25 * uz);
		}
		for (const [i, v] of nx) px.set(i, v);
		for (const [i, v] of nz) pz.set(i, v);
	}
	// the water at each: the ground under it cut down a little, and no higher than upstream
	const water = new Map(), upstream = new Map();
	for (const i of nodes) {
		const [x, z] = placeOf(i);
		const w = Math.max(Math.min(natural(x, z) - RIVERS.incise * m, upstream.get(i) ?? Infinity), 0);
		water.set(i, w);
		const r = receiver[i];
		upstream.set(r, Math.min(upstream.get(r) ?? Infinity, w));
	}
	const at = (i) => {
		const [x, z] = placeOf(i), km2 = area[i] / 1e6;
		return [x, z, water.get(i) ?? 0, 0.5 * RIVERS.width[0] * Math.pow(km2, RIVERS.width[1]) * m, RIVERS.depth[0] * Math.pow(km2, RIVERS.depth[1]) * m, 0];
	};
	// the lines: from each head down to one laid already (its last point is that one's) or the sea
	const taken = new Set(), points = [], starts = [];
	for (const head of nodes) {
		if (biggest.has(head)) continue;		// (not a head: a stream drains to it)
		const line = [];
		for (let i = head; ; i = receiver[i]) {
			line.push(at(i));
			if (taken.has(i) || receiver[i] < 0 || area[i] < RIVERS.area) break;
			taken.add(i);
		}
		if (line.length < 2) continue;
		// (and the corners cut: Chaikin, the ends kept where they are)
		const cut = [line[0]];
		for (let k = 0; k < line.length - 1; k++) {
			const a = line[k], b = line[k + 1];
			cut.push(a.map((v, q) => 0.75 * v + 0.25 * b[q]), a.map((v, q) => 0.25 * v + 0.75 * b[q]));
		}
		cut.push(line[line.length - 1]);
		// (on to the bottom of the valley: the lowest of the places across it. Not the last point: it is on the line it joins, or the shore)
		for (let k = 0; k < cut.length - 1; k++) {
			const p = cut[k], o = cut[Math.max(k - 1, 0)], q = cut[k + 1];
			let tx = q[0] - o[0], tz = q[1] - o[1];
			const tl = Math.hypot(tx, tz) || 1;
			tx /= tl; tz /= tl;
			let lowest = natural(p[0], p[1]), off = 0;
			for (let j = -RIVERS.snap[0]; j <= RIVERS.snap[0]; j++) {
				if (j == 0) continue;
				const h = natural(p[0] - tz * j * RIVERS.snap[1], p[1] + tx * j * RIVERS.snap[1]);
				if (h < lowest - 0.01) { lowest = h; off = j * RIVERS.snap[1]; }
			}
			p[0] -= tz * off; p[1] += tx * off;
		}
		for (let k = 1; k < cut.length - 1; k++) { cut[k][0] = 0.25 * cut[k - 1][0] + 0.5 * cut[k][0] + 0.25 * cut[k + 1][0]; cut[k][1] = 0.25 * cut[k - 1][1] + 0.5 * cut[k][1] + 0.25 * cut[k + 1][1]; }
		// (and its water from the ground where it is now: no higher than that cut down, nor than upstream)
		for (let k = 0; k < cut.length; k++) cut[k][2] = Math.max(Math.min(cut[k][2], natural(cut[k][0], cut[k][1]) - RIVERS.incise * m, k > 0 ? cut[k - 1][2] : Infinity), 0);
		starts.push(points.length / RIVER_FLOATS);
		let along = 0;
		cut.forEach((p, k) => {
			if (k > 0) along += Math.hypot(p[0] - cut[k - 1][0], p[1] - cut[k - 1][1]);
			p[5] = along;
			points.push(...p);
		});
	}
	starts.push(points.length / RIVER_FLOATS);
	return { points: new Float32Array(points), starts: new Int32Array(starts) };
}

// a tile's rivers: { cut: the stretches near enough to cut into its land (RIVER_FLOATS for each end), draw: the lines it draws, as
//		riverLines has them }. Its own arrays: they go to the other threads, and the continent's are kept
function riverWindow(params, shape) {
	const [ox, oz] = params.center ?? [0, 0], half = params.worldSize / 2, { points, starts } = shape.rivers;
	const near = 2 * shape.cell + RIVERS.reach + 64;
	const cut = [], draw = [], drawStarts = [];
	for (let line = 0; line < starts.length - 1; line++) {
		let open = false;
		for (let k = starts[line]; k < starts[line + 1] - 1; k++) {
			const a = k * RIVER_FLOATS, b = a + RIVER_FLOATS;
			const lo = [Math.min(points[a], points[b]) - points[b + 3] - near, Math.min(points[a + 1], points[b + 1]) - points[b + 3] - near];
			const hi = [Math.max(points[a], points[b]) + points[b + 3] + near, Math.max(points[a + 1], points[b + 1]) + points[b + 3] + near];
			if (hi[0] >= ox - half && lo[0] <= ox + half && hi[1] >= oz - half && lo[1] <= oz + half) for (let q = 0; q < 2 * RIVER_FLOATS; q++) cut.push(points[a + q]);
			// (drawn by the tile the middle of the stretch is in)
			const mx = 0.5 * (points[a] + points[b]) - ox, mz = 0.5 * (points[a + 1] + points[b + 1]) - oz;
			const mine = mx >= -half && mx < half && mz >= -half && mz < half;
			if (mine && !open) { drawStarts.push(draw.length / RIVER_FLOATS); for (let q = 0; q < RIVER_FLOATS; q++) draw.push(points[a + q]); }
			if (mine) for (let q = 0; q < RIVER_FLOATS; q++) draw.push(points[b + q]);
			open = mine;
		}
	}
	drawStarts.push(draw.length / RIVER_FLOATS);
	return { cut: new Float32Array(cut), draw: { points: new Float32Array(draw), starts: new Int32Array(drawStarts) } };
}

// The rivers in the land (see THE RIVERS): cut(x, z, natural) the ground there with them (over the sea, as natural is), and how wet that
//		leaves it in .wet (1 under the water); at(x, z) the nearest stretch's water there: null, or { surface (over the sea), depth there
//		(the water over the bed), distance (from the middle), half (its half width) }
export function makeRiverCutter(cut) {
	const B = RIVERS.bucket, buckets = new Map(), count = cut.length / (2 * RIVER_FLOATS);
	for (let k = 0; k < count; k++) {
		const a = k * 2 * RIVER_FLOATS, b = a + RIVER_FLOATS, r = Math.max(cut[a + 3], cut[b + 3]) + RIVERS.reach;
		for (let bx = Math.floor((Math.min(cut[a], cut[b]) - r) / B); bx <= Math.floor((Math.max(cut[a], cut[b]) + r) / B); bx++) {
			for (let bz = Math.floor((Math.min(cut[a + 1], cut[b + 1]) - r) / B); bz <= Math.floor((Math.max(cut[a + 1], cut[b + 1]) + r) / B); bz++) {
				const key = bx * 100003 + bz;
				if (!buckets.has(key)) buckets.set(key, []);
				buckets.get(key).push(a);
			}
		}
	}
	const near = { surface: 0, depth: 0, distance: Infinity, half: 0, edge: Infinity };
	// (the stretch at o: how far (x, z) is from its middle, and its water, half width and depth there)
	const on = { d: 0, s: 0, w: 0, dd: 0 };
	function onStretch(o, x, z) {
		const b = o + RIVER_FLOATS, ex = cut[b] - cut[o], ez = cut[b + 1] - cut[o + 1], ll = ex * ex + ez * ez;
		const t = ll > 0 ? Math.min(Math.max(((x - cut[o]) * ex + (z - cut[o + 1]) * ez) / ll, 0), 1) : 0;
		on.d = Math.hypot(x - cut[o] - ex * t, z - cut[o + 1] - ez * t);
		on.s = cut[o + 2] + (cut[b + 2] - cut[o + 2]) * t;
		on.w = cut[o + 3] + (cut[b + 3] - cut[o + 3]) * t;
		on.dd = cut[o + 4] + (cut[b + 4] - cut[o + 4]) * t;
	}
	const result = {
		wet: 0,
		cut(x, z, natural) {
			result.wet = 0;
			const bucket = buckets.get(Math.floor(x / B) * 100003 + Math.floor(z / B));
			if (!bucket) return natural;
			let lowest = Infinity, levee = -Infinity;
			for (const o of bucket) {
				onStretch(o, x, z);
				if (on.d >= on.w + RIVERS.reach) continue;
				if (on.d <= on.w) {
					// (the bed: deepest in the middle)
					const across = on.d / on.w;
					lowest = Math.min(lowest, on.s - on.dd * (1 - across * across));
					result.wet = 1;
				} else {
					// (the bank: given out over the last of the reach, so it never ends in a step up to the land)
					const bank = Math.min(on.s + RIVERS.bank * (on.d - on.w), natural);
					lowest = Math.min(lowest, natural + (bank - natural) * (1 - smoothstep(RIVERS.fade, 1, (on.d - on.w) / RIVERS.reach)));
					if (on.d < on.w + RIVERS.levee) levee = Math.max(levee, on.s + 0.1 * SHAPE.metre);
				}
			}
			let h = Math.min(natural, lowest);
			if (!result.wet && natural >= 0 && levee > h) h = levee;
			return h;
		},
		at(x, z) {
			const bucket = buckets.get(Math.floor(x / B) * 100003 + Math.floor(z / B));
			if (!bucket) return null;
			near.edge = Infinity;
			for (const o of bucket) {
				onStretch(o, x, z);
				if (on.d - on.w < near.edge) { near.edge = on.d - on.w; near.distance = on.d; near.half = on.w; near.surface = on.s; const across = Math.min(on.d / Math.max(on.w, 1e-6), 1); near.depth = on.dd * (1 - across * across); }
			}
			return near.edge < RIVERS.reach ? near : null;
		},
	};
	return result;
}

// the zone tag for a point, from its height above sea level and what covers it (see coverOf). lake: the water here is cut off from the sea
export function classifyZone(height, cover, params, lake = false) {
	if (height < 0) return lake ? ZONE_LAKE : ZONE_OCEAN;
	if (cover < -0.5) return ZONE_MARSH;
	if (height < params.beachHeight + 0.5 * params.bankHeight) return ZONE_BEACH;	// below the middle of the bank
	if (cover >= MOUNTAIN_THRESHOLD) return (height >= params.snowLine) ? ZONE_SNOW : ZONE_MOUNTAIN;
	if (cover >= FOREST_THRESHOLD) return ZONE_FOREST;
	return ZONE_GRASSLAND;
}

const BED_OUT = 400;		// world units: in a world of tiles, the most the sea bed is measured out past the drop-off (see THE SEA BED)
// how much lower the sea bed is for being out past the middle of the drop-off (see generateTerrain). It comes on over the first 60
//		or so units, not at a crease
function bedFall(params, out) {
	return Math.max(params.seaBedGrade ?? 0, 0) * out * out / (out + 60);
}

// The landing strip (see THE LANDING STRIP in generateTerrain): where a world position is along it (u) and across it (v)
function stripPlace(s, x, z) {
	const dx = x - s.x, dz = z - s.z;
	return [dx * s.ax + dz * s.az, -dx * s.az + dz * s.ax];
}
// how far (u, v) on it is off its flat
const stripOut = (s, u, v) => Math.hypot(Math.max(Math.abs(u) - s.half, 0), Math.max(Math.abs(v) - s.flat, 0));
// how much the ground at (x, z) is the strip's: 1 on its flat, out to 0 over its edge (its turf; plane.js: a plane on it)
export function stripWeight(s, x, z) {
	const [u, v] = stripPlace(s, x, z);
	const out = stripOut(s, u, v);
	return out >= s.edge ? 0 : 1 - smoothstep(0, s.edge, out);
}
// the ground at (x, z) with the strip laid on the land there (natural: how high the land is, over the sea). On the flat, the strip's
//		level. Off it, the land, moved up or down as much as its earthworks moved it there (s.work, see THE EARTHWORKS in planStrip)
export function stripGround(s, x, z, natural) {
	const [u, v] = stripPlace(s, x, z);
	const out = stripOut(s, u, v);
	if (out >= s.reach) return natural;
	if (out <= 0) return s.h0 + s.grade * Math.min(Math.max(u, -s.half), s.half);
	const W = s.work, d = W.offset;
	const gu = Math.min(Math.max((u - W.u0) / W.step, 0), W.nu - 1.0001), gv = Math.min(Math.max((v - W.v0) / W.step, 0), W.nv - 1.0001);
	const i = Math.floor(gu), j = Math.floor(gv), fu = gu - i, fv = gv - j, k = j * W.nu + i;
	const near = d[k] + (d[k + 1] - d[k]) * fu, far = d[k + W.nu] + (d[k + W.nu + 1] - d[k + W.nu]) * fu;
	return natural + near + (far - near) * fv;
}
// the land (natural) held to within a bank of the strip's level, out from its flat (level over its shoulder, then rising or falling
//		away): the nearer of the land and the bank, rounded (a smooth minimum, never below nothing, so it never comes out the far side)
function bankOf(natural, level, out) {
	const room = STRIP.bank * Math.max(out - STRIP.shoulder, 0), off = Math.abs(natural - level);
	return level + Math.sign(natural - level) * -smoothMax(-off, -room, Math.min(STRIP.round, room));
}
// 1 where no tree or boulder may be: on it, and on the ways in over each end (widening out from it)
function stripClear(s, x, z) {
	const [u, v] = stripPlace(s, x, z);
	const past = Math.max(Math.abs(u) - s.half, 0);
	if (past > s.approach) return 0;
	return Math.abs(v) < s.flat + STRIP.clear + past * 0.35 ? 1 : 0;
}

//-------------------------------THE MESH-------------------------------
/*
	What makes the mesh of the land, apart from the rest of it: the grids it reads are passed in (chunkGrids, from generateTerrain),
	so a worker can be handed a copy of them and make chunks off the main thread (see terrainWorker.js). The same params and grids
	make the same chunks wherever it runs.
		grids		{ relief (reliefWindow), marshes, beyondDrop, and the towns' }, one entry per data grid point (relief: its own)
		sampler		createTerrainSampler(params), when there is one already
*/
export function makeChunkBuilder(params, grids, sampler = createTerrainSampler(params)) {
	const { sample, erodedFbm } = sampler;
	const { relief, marshes, beyondDrop } = grids;		// (and the towns' grids, read as they are when wanted: generateTerrain fills them in after making this)
	const riverCut = makeRiverCutter(grids.rivers ?? new Float32Array(0));
	// the streets of the towns, cut into the land (made when they are first wanted: they are laid out after the builder is made)
	let roads = null, roadsFrom = null, cutPads = null, padsFrom = null;
	let paths = null, pathsFrom = null;		// (and the footpaths, the same way)
	const cells = params.dataResolution ?? 1024;
	const points = cells + 1;
	const cellSize = params.worldSize / cells;
	const half = params.worldSize * 0.5;
	const [ox, oz] = params.center ?? [0, 0];		// (a tile of the world's: world.js. Its grid round its own middle)
	const reliefAt = makeReliefAt(relief);

	// one of the data grids at a world position, bilinear between the 4 grid points around it
	function gridAt(grid, x, z) {
		const gx = Math.min(Math.max((x - ox + half) / cellSize, 0), cells - 0.0001), gz = Math.min(Math.max((z - oz + half) / cellSize, 0), cells - 0.0001);
		const col = Math.floor(gx), row = Math.floor(gz), fx = gx - col, fz = gz - row, i = row * points + col;
		const top = grid[i] + (grid[i + 1] - grid[i]) * fx, bottom = grid[i + points] + (grid[i + points + 1] - grid[i + points]) * fx;
		return top + (bottom - top) * fz;
	}

	// The exact ground at any world position, the same sum the data grid was filled with. A mesh finer than the data grid gets its
	//		extra detail from here: the noise layers go on down to a couple of units, only the ridge skeleton is limited to the grid.
	//		Returns the height above sea level, and leaves what covers the point (see coverOf) in landAtCover
	let landAtCover = 0;
	function landAt(x, z) {
		const result = sample(x, z, reliefAt(x, z));
		// (how marshy it is comes from the data grid, which knows about every lake. sample only knows the ones it hollowed out itself)
		const marsh = gridAt(marshes, x, z);
		landAtCover = coverOf(mountainCover(result.mountain, result.height, params), result.woodland, marsh);
		let height = result.height - (result.height < 0 ? bedFall(params, gridAt(beyondDrop, x, z)) : 0);
		// the rivers cut into it (THE RIVERS): stony under the water
		height = riverCut.cut(x, z, height);
		if (riverCut.wet) landAtCover = RIVERS.cover;
		// a town: its own hill, and its streets cut into that (see townLayout.js). Its ground is short turf
		if (grids.townStrength) {
			const town = gridAt(grids.townStrength, x, z);
			if (town > 0) {
				// the town's hill as much as the town is there. Over its core that is all of it (a mountain that comes into the core is
				//		cut back for the terraces), but out over the fade it is never lower than the land: where the land is higher (a
				//		mountain behind it) the hill rolls up into it (the higher of the two, rounded where they meet)
				const hill = height + (gridAt(grids.townHeight, x, z) - height) * town;
				height = hill + (smoothMax(height, hill, 14 * town) - hill) * (1 - smoothstep(0.6, 1, town));
				landAtCover += (0.04 - landAtCover) * town;
			}
			if (grids.townRoads !== roadsFrom) { roadsFrom = grids.townRoads; roads = makeRoadFlattener(roadsFrom); }
			if (roads && town > 0) height = roads.flatten(x, z, height + params.seaLevel) - params.seaLevel;
			// (and cut down under its houses: see THE GROUND UNDER A HOUSE in townLayout.js)
			if (grids.townPads && town > 0) {
				if (grids.townPads !== padsFrom) { padsFrom = grids.townPads; cutPads = makePadCutter(padsFrom); }
				height = cutPads(x, z, height + params.seaLevel) - params.seaLevel;
			}
		}
		// the landing strip: laid on the land, flat at its grade, with banks down or up to the land round it. Its ground is short turf
		if (grids.strip) {
			height = stripGround(grids.strip, x, z, height);
			const k = stripWeight(grids.strip, x, z);
			if (k > 0) landAtCover += (0.02 - landAtCover) * k;
		}
		// the footpaths: pressed into it, level across each (see footpaths.js)
		if (grids.paths) {
			if (grids.paths !== pathsFrom) { pathsFrom = grids.paths; paths = makePathFlattener(pathsFrom); }
			height = paths.flatten(x, z, height);
		}
		return height;
	}

	/*
		The mesh of one square of the land: a chunk. terrain.js covers the world in these, small fine ones next to the
		camera and big coarse ones far away, and asks for each as it comes to need it.
			x0, z0		the corner of the square with the lowest x and z
			size		the length of its sides
			cells		how many cells it is cut into along a side. Every chunk has the same number, so a chunk of twice
						the size is half as fine, and all of them can share one list of triangles (see chunkIndices)
		Nothing is kept from one call to the next and nothing is random, so the same chunk asked for twice is the same chunk:
		one that has been thrown away can always be made again.

		Returns
			vertices	8 floats each, the same layout as every other model: position (3), then "uv" (2) carrying what covers
						the point (see coverOf) and the size of the chunk's cells instead, then normal (3)
			minY, maxY	how low and how high it goes

		The skirt. Where a fine chunk meets a coarse one their edges dont quite agree: the fine one has a vertex half way along
		each of the coarse one's edges, and that vertex sits on the real ground while the coarse edge cuts straight across.
		The gap that leaves shows the sky through the ground. So every chunk also has a skirt: its 4 edges again, hanging
		straight down, like the sides of a box with no bottom. Whatever gap opens above, there is ground colored wall behind it.
	*/
	function buildChunk(x0, z0, size, cells) {
		const cell = size / cells, perSide = cells + 1;

		// the heights, with a ring of 1 extra point all round so the normals at the chunk's edge have a neighbour to slope against
		const side = cells + 3;
		const padHeight = new Float32Array(side * side), padCover = new Float32Array(side * side);
		for (let j = -1; j <= cells + 1; j++) {
			for (let i = -1; i <= cells + 1; i++) {
				padHeight[(j + 1) * side + (i + 1)] = landAt(x0 + i * cell, z0 + j * cell);
				padCover[(j + 1) * side + (i + 1)] = landAtCover;
			}
		}

		const vertices = new Float32Array((perSide * perSide + 4 * perSide) * 8);
		let v = 0, minY = Infinity, maxY = -Infinity;
		for (let j = 0; j <= cells; j++) {
			for (let i = 0; i <= cells; i++) {
				const p = (j + 1) * side + (i + 1);
				const height = padHeight[p];
				const nx = padHeight[p - 1] - padHeight[p + 1], nz = padHeight[p - side] - padHeight[p + side];
				const length = Math.hypot(nx, 2 * cell, nz);
				vertices[v + 0] = x0 + i * cell;
				vertices[v + 1] = params.seaLevel + height;
				vertices[v + 2] = z0 + j * cell;
				vertices[v + 3] = padCover[p];			// the shader works the zone colors out per pixel from this and the height, so they blend smoothly
				vertices[v + 4] = cell;					// how fine this chunk's mesh is. Where it is coarse the shader gets the slope of the ground from the land data instead
				vertices[v + 5] = nx / length;
				vertices[v + 6] = 2 * cell / length;
				vertices[v + 7] = nz / length;
				minY = Math.min(minY, vertices[v + 1]);
				maxY = Math.max(maxY, vertices[v + 1]);
				v += 8;
			}
		}

		// the skirt: the vertices of each edge again, lower. Deep enough to cover the most a neighbour twice as coarse can disagree by
		const drop = cell * 3;
		const edgeStart = [0, cells * perSide, 0, cells], edgeStep = [1, 1, perSide, perSide];	// first vertex of each edge, and the step to the next: top, bottom, left, right
		for (let edge = 0; edge < 4; edge++) {
			for (let k = 0; k <= cells; k++) {
				const from = (edgeStart[edge] + k * edgeStep[edge]) * 8;
				for (let f = 0; f < 8; f++) vertices[v + f] = vertices[from + f];
				vertices[v + 1] -= drop;
				v += 8;
			}
		}
		minY -= drop;

		return { vertices, minY, maxY };
	}

	return { landAt, buildChunk };
}

//-------------------------------THE GRID-------------------------------
/*
	Samples the land on a grid of points covering the world, centered on the origin.
	params adds: seaLevel (world y of the sea surface), mountainHeight, snowLine

	What comes back is everything known about the land:
		heights, mountains, zones, normals		one entry per grid point, row by row (z then x)
		woodlands, covers						how wooded each grid point is, and what covers it (see coverOf)
		marshes, lakes							how close to a lake each grid point is (0 to 1), and whether the nearest water to it is a lake (1) or the sea (0)
		shoreDistances							and for the sea: how far each grid point is from the nearest land
		heightAt / zoneAt / normalAt			look ups by world position, for placing things on the land
		groundAt								world y of the ground at a world position, exactly: the same sum the mesh is made from. Slower than heightAt
		ridgeCrests								points along the main ridges of the mountains, as [x, z, x, z, ...]
		findSpawnPoints							the tag system: scattered points that lie in a given zone
		buildChunk								the mesh of one square of the land, as fine or as coarse as asked for (terrain.js draws the land out of these)
		chunkGrids								the grids buildChunk reads, so another thread can make a builder of its own (see makeChunkBuilder)
*/
export function generateTerrain(params) {
	const { sample, erodedFbm, seamFade } = createTerrainSampler(params);
	// the shape of the land (THE SHAPE OF THE LAND): its continent's, and this tile's window of it
	const shape = continentShape(params, sample, createNoise((params.seed ?? 0) + 4057));
	const relief = reliefWindow(params, shape);
	const rivers = riverWindow(params, shape), riverCut = makeRiverCutter(rivers.cut);
	const reliefAt = makeReliefAt(relief);

	// Two resolutions. The DATA grid (heights, zones, the ridge skeleton, what the water and the grass read) is always this fine.
	//		The MESH is built separately, a chunk at a time (see buildChunk): finer than this near the camera, coarser far away
	const cells = params.dataResolution ?? 1024;
	const points = cells + 1;
	const cellSize = params.worldSize / cells;
	const half = params.worldSize * 0.5;
	// (a tile of the world's, world.js: its grid round its own middle, everything in it in world units where it is in the world)
	const [ox, oz] = params.center ?? [0, 0];
	const xAt = (col) => ox + col * cellSize - half, zAt = (row) => oz + row * cellSize - half;

	const heights = new Float32Array(points * points);		// world y
	const mountains = new Float32Array(points * points);
	const woodlands = new Float32Array(points * points);
	const covers = new Float32Array(points * points);
	const marshes = new Float32Array(points * points);
	const lakes = new Float32Array(points * points);
	const rises = new Float32Array(points * points);
	const zones = new Uint8Array(points * points);
	const normals = new Float32Array(points * points * 3);

	// the land without its mountains, and where the mountain ranges are
	for (let row = 0; row < points; row++) {
		for (let col = 0; col < points; col++) {
			const result = sample(xAt(col), zAt(row), reliefAt(xAt(col), zAt(row)));
			const i = row * points + col;
			heights[i] = result.height;		// above sea level for now
			mountains[i] = result.mountain;
			woodlands[i] = result.woodland;
			marshes[i] = result.marsh;
			rises[i] = result.rise;
		}
	}

	/*
		Lakes. Any water with land all the way round it is a lake: the hollows sample makes, and also any bay the coastline
		happens to close off. So which water is sea is found by letting the sea in from the edge of the world: it starts
		in every cell of water on the edge and spreads from each cell of water to the ones next to it (a flood fill).
		Whatever water it never reaches is lake.
	*/
	const sea = new Uint8Array(points * points);
	const reached = [];
	for (let k = 0; k < points; k++) {
		for (const i of [k, cells * points + k, k * points, k * points + cells]) {
			if (heights[i] < 0 && !sea[i]) { sea[i] = 1; reached.push(i); }
		}
	}
	while (reached.length > 0) {
		const i = reached.pop(), col = i % points;
		for (const next of [i - points, i + points, col > 0 ? i - 1 : -1, col < cells ? i + 1 : -1]) {
			if (next >= 0 && next < points * points && heights[next] < 0 && !sea[next]) { sea[next] = 1; reached.push(next); }
		}
	}

	// How far every cell is from the nearest cell that passes a test, in cells. Two sweeps across the grid, each cell taking
	//		the shortest way through a neighbour
	//		round: also through the 4 neighbours a knight's move away, which brings what would be eight sided rings of distance near enough to circles
	const distanceTo = (test, round = false) => {
		const distance = new Float32Array(points * points);
		for (let i = 0; i < points * points; i++) distance[i] = test(i) ? 0 : 1e9;
		const through = round ? [[-1, 0], [0, -1], [-1, -1], [1, -1], [-2, -1], [2, -1], [-1, -2], [1, -2]] : [[-1, 0], [0, -1], [-1, -1], [1, -1]];
		for (let sweep = 0; sweep < 2; sweep++) {
			const sign = sweep == 0 ? 1 : -1;
			for (let k = 0; k < points * points; k++) {
				const i = sweep == 0 ? k : points * points - 1 - k;
				const col = i % points, row = (i - col) / points;
				let best = distance[i];
				for (const [dx, dy] of through) {
					const nx = col + dx * sign, ny = row + dy * sign;
					if (nx < 0 || ny < 0 || nx >= points || ny >= points) continue;
					best = Math.min(best, distance[ny * points + nx] + Math.hypot(dx, dy));
				}
				distance[i] = best;
			}
		}
		return distance;
	};

	// The ground round a lake is marsh. Round the hollows sample has already said so, round a closed off bay it hasnt.
	//		There it is by distance: the 40 units back from the water, fading out. And any low flat ground beyond that
	//		which would have been beach, if it is nearer to the lake than to the sea: a lake has no surf to make sand
	const marshWidth = 40 / cellSize;
	const toLake = distanceTo((i) => heights[i] < 0 && !sea[i]);
	const toSea = distanceTo((i) => sea[i] == 1);
	for (let i = 0; i < points * points; i++) {
		const lake = heights[i] < 0 && !sea[i];
		if (!sea[i]) marshes[i] = Math.max(marshes[i], clamp01(1 - toLake[i] / marshWidth));
		if (heights[i] >= 0 && heights[i] < params.beachHeight + params.bankHeight + 1 && toLake[i] < toSea[i]) {
			marshes[i] = Math.max(marshes[i], clamp01(1.6 - toLake[i] * cellSize / 220));
		}
		// the nearest water is a lake: in one, or on the wet ground round one. This is what the water reads to know to lie calm
		lakes[i] = (lake || (heights[i] >= 0 && marshes[i] > 0.05)) ? 1 : 0;
	}

	/*
		THE SEA BED. sample runs it out from the beach as a shallow shelf and then drops it away, to the Drop-off Depth setting.
		It used to level out there, a floor as flat as a table all the way to the edge of the world. Now it keeps on down
		from the drop-off at one steady grade (params.seaBedGrade: 0.42 is 42 down for every 100 out) for as far as the
		land's mesh goes.

		A steady grade needs to know how far out a place is, and the noise the coast is made from cant say: its slope is
		different everywhere. So it is measured, across the grid: how far every point of the sea is from the line half way
		down the drop-off (0 on the land, on the shelf and on the top half of the drop). The bed is lowered by the grade
		times that. Half way down is where the drop-off is steepest, so the two run together: the drop eases off into the
		grade instead of levelling out and then starting down again.
	*/
	const seaBedGrade = Math.max(params.seaBedGrade ?? 0, 0);
	let beyondDrop = new Float32Array(points * points);		// world units out past the middle of the drop-off
	if (seaBedGrade > 0) {
		const out = distanceTo((i) => !(sea[i] && heights[i] < -0.5 * params.seaFloorDepth), true);
		beyondDrop = boxBlur(out, points, 3).map((distance) => distance * cellSize);	// (blurred a little: the grid still leaves corners in it)
		// (in a world of tiles, no further than BED_OUT: a tile of open sea has nothing to measure from, and the one beside it does, so
		//		past that both lie at the same depth and meet)
		if (params.world) beyondDrop = beyondDrop.map((distance) => Math.min(distance, BED_OUT));
	}

	// where the ridges run (boulderGenerator.js stands boulders along them), from the relief
	const ridgeCrests = crestsOf(params, relief, (x, z) => sample(x, z).rise);

	for (let row = 0; row < points; row++) {
		for (let col = 0; col < points; col++) {
			const i = row * points + col;
			heights[i] -= bedFall(params, beyondDrop[i]);
			// (and the rivers cut into it: THE RIVERS)
			heights[i] = riverCut.cut(xAt(col), zAt(row), heights[i]);
			covers[i] = riverCut.wet ? RIVERS.cover : coverOf(mountainCover(mountains[i], heights[i], params), woodlands[i], marshes[i]);
			zones[i] = riverCut.wet && heights[i] >= 0 ? ZONE_RIVER : classifyZone(heights[i], covers[i], params, !sea[i]);
			heights[i] += params.seaLevel;
		}
	}

	// the mesh (see makeChunkBuilder)
	const chunkGrids = { relief, rivers: rivers.cut, marshes, beyondDrop, townStrength: null, townHeight: null, townRoads: null, townPads: null };
	const { landAt, buildChunk } = makeChunkBuilder(params, chunkGrids, { sample, erodedFbm });

	/*
		THE TOWNS (townLayout.js): where they go, the hill each stands on, and their streets, houses and the rest. The hill goes into
		the land's grids, and the land is worked out again over each town with its streets cut into it
	*/
	const aboveSea = heights.map((h) => h - params.seaLevel);
	const siteGrids = { points, cells, cellSize, half, ox, oz, heights: aboveSea, covers, mountains, sea, toSea, keep: (x, z) => seamFade(x, z) >= 1 };
	// (on its shores; and where it has too few, by its rivers: THE RIVER TOWNS in townLayout.js)
	const findSites = (given) => {
		const shore = findTownSites(siteGrids, params, MOUNTAIN_THRESHOLD, given);
		const river = findRiverSites(siteGrids, params, MOUNTAIN_THRESHOLD, rivers.draw, Math.round(params.townCount ?? 0) - shore.length, [...shore, ...given]);
		return [...shore, ...river].map((site, k) => ({ ...site, number: k }));
	};
	let townSites = findSites([]);
	let townGround = null, town = null;
	const gridValue = (grid, x, z) => {
		const gx = Math.min(Math.max((x - ox + half) / cellSize, 0), cells - 0.0001), gz = Math.min(Math.max((z - oz + half) / cellSize, 0), cells - 0.0001);
		const col = Math.floor(gx), row = Math.floor(gz), fx = gx - col, fz = gz - row, i = row * points + col;
		const top = grid[i] + (grid[i + 1] - grid[i]) * fx, bottom = grid[i + points] + (grid[i + points + 1] - grid[i + points]) * fx;
		return top + (bottom - top) * fz;
	};
	const townAt = (x, z) => gridValue(townGround.strength, x, z);
	const toSeaWorld = toSea.map((d) => d * cellSize);
	// (a site where too little of a town could be laid out, its streets broken up by the lie of the land, is given up, the next best
	//		found in its place, and the hills and layouts made again)
	const givenUp = [];
	for (let attempt = 0; attempt < 4; attempt++) {
		townGround = planTownGround({ points, cells, cellSize, half, ox, oz, sea, toSea, heights: aboveSea }, townSites, params.seed);
		chunkGrids.townStrength = townGround.strength;
		chunkGrids.townHeight = townGround.height;
		chunkGrids.townRoads = null;
		town = layoutTowns(townSites, (x, z) => params.seaLevel + landAt(x, z), townAt, (x, z) => gridValue(toSeaWorld, x, z), params.seaLevel, params.seed);
		const kept = townSites.filter((site, k) => town.towns[k].buildings.length >= 30);
		if (kept.length == townSites.length || attempt == 3) break;
		givenUp.push(...townSites.filter((site) => !kept.includes(site)));
		const more = findSites(givenUp).filter((s) => !kept.some((k) => Math.hypot(k.x - s.x, k.z - s.z) < 1));
		townSites = [...kept, ...more].slice(0, townSites.length).map((site, k) => ({ ...site, number: k, clusters: null }));
	}
	chunkGrids.townRoads = town.segments;
	chunkGrids.townPads = buildingPads(town.towns);
	for (let i = 0; i < points * points; i++) {
		if (townGround.strength[i] <= 0) continue;
		const col = i % points, row = (i - col) / points;
		heights[i] = params.seaLevel + landAt(xAt(col), zAt(row));
		if (townGround.strength[i] > 0.5 && heights[i] > params.seaLevel + 0.5) zones[i] = ZONE_TOWN;
	}
	const roadAt = makeRoadFlattener(town.segments).nearest;

	/*
		THE LANDING STRIP (params.landingStrip): one, by the first town (by the middle of the world without one), for the biplane
		(plane.js). The best stretch of open ground STRIP.reach from the town is found: every heading round every place on rings out
		from it, sampled along and across, kept to the grassland and the woods, out of the town and the water, the straight line through
		its heights fitted, and the one with the least to cut and fill (and the least climb end to end, and the nearest, and the least
		ground under its banks) wins. Its banks are followed out from all round the flat until they meet the land (where the land is
		within STRIP.bank of the strip's level). A site whose banks would run out further than STRIP.banks, or into a town, or off the
		world, counts for far less (it is still had, if there is nothing better). Then THE EARTHWORKS (below) are worked out for it,
		the land is laid flat along that line with them (stripGround in makeChunkBuilder), and the grid worked out again over it. The
		zones are left as they were
	*/
	const strip = params.landingStrip ? planStrip() : null;
	function planStrip() {
		const site = townSites[0] ?? { x: 0, z: 0 };
		const hAt = (x, z) => gridValue(aboveSea, x, z);
		const zoneHere = (x, z) => { const gx = Math.round((x - ox + half) / cellSize), gz = Math.round((z - oz + half) / cellSize); return gx < 0 || gz < 0 || gx > cells || gz > cells ? ZONE_OCEAN : zones[gz * points + gx]; };
		const dryEnough = params.beachHeight + params.bankHeight + 2;
		const half2 = STRIP.length / 2 + 20;
		let best = null;
		for (let r = STRIP.reach[0]; r <= STRIP.reach[1]; r += 140) {
			for (let a = 0; a < 32; a++) {
				const around = a / 32 * Math.PI * 2, cx = site.x + Math.sin(around) * r, cz = site.z + Math.cos(around) * r;
				if (Math.abs(cx - ox) > half - 800 || Math.abs(cz - oz) > half - 800) continue;
				for (let h = 0; h < 16; h++) {
					const ax = Math.cos(h / 16 * Math.PI), az = Math.sin(h / 16 * Math.PI);
					let ok = true, su = 0, sh = 0, suu = 0, suh = 0, n = 0, woods = 0;
					const samples = [];
					for (let i = 0; i <= 12 && ok; i++) {
						const u = (i / 12 * 2 - 1) * half2;
						for (const v of [-STRIP.flat, 0, STRIP.flat]) {
							const x = cx + ax * u - az * v, z = cz + az * u + ax * v;
							const zone = zoneHere(x, z), height = hAt(x, z);
							if ((zone != ZONE_GRASSLAND && zone != ZONE_FOREST) || height < dryEnough || townAt(x, z) > 0.02) { ok = false; break; }
							if (zone == ZONE_FOREST) woods++;
							samples.push([u, height]);
							if (v == 0) { su += u; sh += height; suu += u * u; suh += u * height; n++; }
						}
					}
					if (!ok) continue;
					const grade = (suh - su * sh / n) / (suu - su * su / n), middle = sh / n - grade * su / n;
					const kept = Math.max(Math.min(grade, STRIP.grade), -STRIP.grade);
					let cut = 0;
					for (const [u, height] of samples) cut = Math.max(cut, Math.abs(height - (middle + kept * u)));
					if (cut >= STRIP.cut) continue;
					// the banks: out from the flat's edge, along each side and off each end, to where each meets the land
					const halfLength = STRIP.length / 2;
					const starts = [];
					for (let i = 0; i <= 12; i++) for (const side of [-1, 1]) starts.push([(i / 12 * 2 - 1) * halfLength, side * STRIP.flat, 0, side]);
					for (const end of [-1, 1]) for (const v of [-STRIP.flat, 0, STRIP.flat]) starts.push([end * halfLength, v, end, 0]);
					// (and out from each corner, between the two)
					for (const end of [-1, 1]) for (const side of [-1, 1]) for (const a of [0.35, 0.79, 1.22]) starts.push([end * halfLength, side * STRIP.flat, end * Math.cos(a), side * Math.sin(a)]);
					let meets = true, banks = 0;
					for (const [u0, v0, du, dv] of starts) {
						const level = middle + kept * u0;
						let met = Infinity;
						for (let out = 8; out <= STRIP.banks && met == Infinity; out += 8) {
							const u = u0 + du * out, v = v0 + dv * out, x = cx + ax * u - az * v, z = cz + az * u + ax * v;
							if (Math.abs(x - ox) > half - 50 || Math.abs(z - oz) > half - 50 || townAt(x, z) > 0.02) break;
							if (Math.abs(hAt(x, z) - level) <= STRIP.bank * out - STRIP.round) met = out;
						}
						if (met == Infinity) { meets = false; met = STRIP.banks; }
						banks = Math.max(banks, met);
					}

					// the ways in and out over each end: the ground no higher than a gentle climb from the end of the strip
					let climb = 0;
					for (const end of [-1, 1]) for (let out = 60; out <= STRIP.approach * 1.5; out += 60) {
						const x = cx + ax * end * (half2 + out), z = cz + az * end * (half2 + out);
						climb = Math.max(climb, (hAt(x, z) - (middle + kept * end * half2)) / out);
					}
					const score = cut + 300 * Math.abs(grade - kept) + 100 * Math.abs(kept) + woods * 0.6 + r / 300 + 600 * Math.max(climb - 0.02, 0);
					const scored = score + banks / 20 + (meets ? 0 : 1000);
					if (climb < 0.06 && (!best || scored < best.score)) best = { score: scored, x: cx, z: cz, ax, az, h0: middle, grade: kept };
				}
			}
		}
		if (!best) return null;
		// THE EARTHWORKS, on a grid along and across it (work): what laying it on the land does to the land round it. Each point's
		//		bank (bankOf) is followed out from the flat, point to point, for as long as it changes the land: so where a bank meets the
		//		land it ends, and a hill further on is left alone. What it changes is kept, as how far it moves the land up or down. A bank
		//		that has not met the land by STRIP.banks fades out over STRIP.fade, and all of it is blurred a little, to round it off
		const halfLength = STRIP.length / 2, step = 4, most = STRIP.banks + STRIP.fade;
		const s = { x: best.x, z: best.z, ax: best.ax, az: best.az, half: halfLength, flat: STRIP.flat };
		const u0 = -halfLength - most, v0 = -STRIP.flat - most;
		const nu = Math.ceil(2 * (halfLength + most) / step) + 1, nv = Math.ceil(2 * (STRIP.flat + most) / step) + 1;
		// (the land is only looked at where the flood comes to: the flat, its shoulder, the banks and the points just past them)
		let offset = new Float32Array(nu * nv).fill(NaN);
		const outs = new Float32Array(nu * nv), worked = new Uint8Array(nu * nv), queue = [];
		const offsetAt = (k) => {
			if (Number.isNaN(offset[k])) {
				const i = k % nu, j = (k - i) / nu, u = u0 + i * step, v = v0 + j * step;
				const natural = landAt(best.x + best.ax * u - best.az * v, best.z + best.az * u + best.ax * v);
				offset[k] = bankOf(natural, best.h0 + best.grade * Math.min(Math.max(u, -halfLength), halfLength), outs[k]) - natural;
			}
			return offset[k];
		};
		for (let j = 0; j < nv; j++) {
			for (let i = 0; i < nu; i++) {
				const k = j * nu + i;
				outs[k] = stripOut(s, u0 + i * step, v0 + j * step);
				if (outs[k] <= STRIP.shoulder) { worked[k] = 1; queue.push(k); offsetAt(k); }
			}
		}
		while (queue.length) {
			const k = queue.pop(), i = k % nu, j = (k - i) / nu;
			for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
				const n = b * nu + a;
				if (a < 0 || b < 0 || a >= nu || b >= nv || worked[n] || Math.abs(offsetAt(n)) < 0.25) continue;
				worked[n] = 1;
				queue.push(n);
			}
		}
		for (let k = 0; k < nu * nv; k++) offset[k] = worked[k] ? offset[k] * (1 - smoothstep(STRIP.banks, most, outs[k])) : 0;
		const flat = Float32Array.from(offset);
		// (blurred: along, then across, twice over)
		for (let repeat = 0; repeat < 2; repeat++) {
			for (const [n, m, stride, across] of [[nu, nv, 1, nu], [nv, nu, nu, 1]]) {
				const next = new Float32Array(nu * nv);
				for (let line = 0; line < m; line++) {
		for (let p = 0; p < n; p++) {
			let sum = 0, count = 0;
			for (let q = Math.max(p - 2, 0); q <= Math.min(p + 2, n - 1); q++) { sum += offset[line * across + q * stride]; count++; }
			next[line * across + p * stride] = sum / count;
		}
				}
				offset = next;
			}
		}
		// (the flat and its shoulder kept level, as they were before the blur)
		for (let k = 0; k < nu * nv; k++) if (outs[k] <= STRIP.shoulder) offset[k] = flat[k];
		let reach = 0;
		for (let k = 0; k < nu * nv; k++) if (Math.abs(offset[k]) > 0.01) reach = Math.max(reach, outs[k]);
		return { x: best.x, z: best.z, ax: best.ax, az: best.az, half: halfLength, width: STRIP.width, flat: STRIP.flat, edge: STRIP.edge,
			work: { u0, v0, step, nu, nv, offset }, reach: reach + 2 * step, h0: best.h0, grade: best.grade, approach: STRIP.approach };
	}
	if (strip) {
		chunkGrids.strip = strip;
		const reach = strip.half + strip.flat + strip.reach + cellSize;
		const c0 = Math.max(Math.floor((strip.x - ox - reach + half) / cellSize), 0), c1 = Math.min(Math.ceil((strip.x - ox + reach + half) / cellSize), cells);
		const r0 = Math.max(Math.floor((strip.z - oz - reach + half) / cellSize), 0), r1 = Math.min(Math.ceil((strip.z - oz + reach + half) / cellSize), cells);
		for (let row = r0; row <= r1; row++) {
			for (let col = c0; col <= c1; col++) {
				const x = xAt(col), z = zAt(row), [u, v] = stripPlace(strip, x, z);
				if (stripOut(strip, u, v) >= strip.reach) continue;
				heights[row * points + col] = params.seaLevel + landAt(x, z);
			}
		}
	}

	/*
		THE FOOTPATHS (params.footpaths, see footpaths.js): planned over the land as it is now (the towns and the landing strip in it),
		pressed into it (landAt), and the grid worked out again under them
	*/
	const footpaths = params.footpaths ? planFootpaths({
		worldSize: params.worldSize, ox, oz, keep: siteGrids.keep, ground: landAt, heightAt: (x, z) => gridValue(heights, x, z) - params.seaLevel,
		zoneAt: (x, z) => zones[Math.min(Math.max(Math.round((z - oz + half) / cellSize), 0), cells) * points + Math.min(Math.max(Math.round((x - ox + half) / cellSize), 0), cells)],
		Z: { OCEAN: ZONE_OCEAN, BEACH: ZONE_BEACH, GRASSLAND: ZONE_GRASSLAND, FOREST: ZONE_FOREST, MOUNTAIN: ZONE_MOUNTAIN, SNOW: ZONE_SNOW, LAKE: ZONE_LAKE, MARSH: ZONE_MARSH, TOWN: ZONE_TOWN },
		townAt, onRoad: (x, z) => roadAt(x, z) !== null, towns: town.towns, strip, stripAt: strip ? (x, z) => stripWeight(strip, x, z) : () => 0,
	}) : null;
	if (footpaths) {
		chunkGrids.paths = { segments: footpaths.segments, clearings: footpaths.clearings };
		const s = footpaths.segments, reach = PATHS.half + PATHS.reach + cellSize, redone = new Set();
		for (let o = 0; o < s.length; o += 6) {
			const c0 = Math.max(Math.floor((Math.min(s[o], s[o + 3]) - ox - reach + half) / cellSize), 0), c1 = Math.min(Math.ceil((Math.max(s[o], s[o + 3]) - ox + reach + half) / cellSize), cells);
			const r0 = Math.max(Math.floor((Math.min(s[o + 1], s[o + 4]) - oz - reach + half) / cellSize), 0), r1 = Math.min(Math.ceil((Math.max(s[o + 1], s[o + 4]) - oz + reach + half) / cellSize), cells);
			for (let row = r0; row <= r1; row++) for (let col = c0; col <= c1; col++) redone.add(row * points + col);
		}
		for (const i of redone) heights[i] = params.seaLevel + landAt(xAt(i % points), zAt(Math.floor(i / points)));
	}
	const pathsLaid = footpaths ? makePathFlattener(chunkGrids.paths) : null, pathClear = pathsLaid?.clear;

	// normals from the heights either side of each point
	for (let row = 0; row < points; row++) {
		for (let col = 0; col < points; col++) {
			const left = heights[row * points + Math.max(col - 1, 0)], right = heights[row * points + Math.min(col + 1, cells)];
			const up = heights[Math.max(row - 1, 0) * points + col], down = heights[Math.min(row + 1, cells) * points + col];
			const nx = left - right, ny = 2 * cellSize, nz = up - down;
			const length = Math.hypot(nx, ny, nz);
			const i = (row * points + col) * 3;
			normals[i] = nx / length; normals[i + 1] = ny / length; normals[i + 2] = nz / length;
		}
	}

	// distance from every grid point to the nearest land (0 on land), so the sea can tell how close it is to a coast anywhere in the world.
	//		Worked out in two sweeps: first the nearest land up or down each column, then for each point the column that makes the shortest diagonal.
	//		It only looks reach cells out, further than that just counts as open sea
	const reach = Math.ceil(240 / cellSize);
	const columnDistance = new Float32Array(points * points);
	for (let row = 0; row < points; row++) {
		for (let col = 0; col < points; col++) {
			let nearest = 1e6;
			for (let offset = 0; offset <= reach; offset++) {
				const up = row - offset, down = row + offset;
				if ((up >= 0 && zones[up * points + col] !== ZONE_OCEAN) || (down < points && zones[down * points + col] !== ZONE_OCEAN)) {
					nearest = offset;
					break;
				}
			}
			columnDistance[row * points + col] = nearest;
		}
	}
	const shoreDistances = new Float32Array(points * points);	// world units
	for (let row = 0; row < points; row++) {
		for (let col = 0; col < points; col++) {
			let nearestSquared = reach * reach;
			for (let offset = -reach; offset <= reach; offset++) {
				const other = col + offset;
				if (other < 0 || other >= points) continue;
				const upDown = columnDistance[row * points + other];
				nearestSquared = Math.min(nearestSquared, offset * offset + upDown * upDown);
			}
			shoreDistances[row * points + col] = Math.sqrt(nearestSquared) * cellSize;
		}
	}

	// (all of it as plain data, so a land made off the main thread can be sent back: wrapLand makes the look ups again from it)
	return wrapLand(params, {
		cells, points, cellSize, heights, mountains, woodlands, covers, marshes, lakes, zones, normals, shoreDistances, ridgeCrests, chunkGrids,
		riverLines: rivers.draw, towns: town.towns, townStrength: townGround.strength, strip, paths: footpaths?.paths ?? [], pathPlaces: footpaths?.places ?? null, fireTowers: footpaths?.towers ?? [],
	}, { landAt, buildChunk, roadAt, pathsLaid });
}

/*
	A LAND FROM ITS DATA: the look ups made over the grids (heightAt and the rest), the exact ground (groundAt: the chunk builder's, over the
	same grids), the towns' streets (roadAt), the footpaths, and the tag system (findSpawnPoints). generateTerrain makes a land with it;
	terrain.js with what the tile worker (tileWorker.js) sends back, the lands of the world's other tiles (world.js), made off the main thread.
	made: what generateTerrain has made already, so it is not made twice
*/
export function wrapLand(params, data, made = null) {
	const { cells, points, cellSize, heights, zones, normals, chunkGrids, strip } = data;
	const half = params.worldSize * 0.5;
	const [ox, oz] = params.center ?? [0, 0];
	const builder = made?.landAt ? made : makeChunkBuilder(params, chunkGrids);
	const { landAt, buildChunk } = builder;
	const roadAt = made?.roadAt ?? makeRoadFlattener(chunkGrids.townRoads ?? []).nearest;
	const rivers = makeRiverCutter(chunkGrids.rivers ?? new Float32Array(0));
	const pathsLaid = made ? made.pathsLaid : chunkGrids.paths ? makePathFlattener(chunkGrids.paths) : null, pathClear = pathsLaid?.clear;
	const gridValue = (grid, x, z) => {
		const gx = Math.min(Math.max((x - ox + half) / cellSize, 0), cells - 0.0001), gz = Math.min(Math.max((z - oz + half) / cellSize, 0), cells - 0.0001);
		const col = Math.floor(gx), row = Math.floor(gz), fx = gx - col, fz = gz - row, i = row * points + col;
		const top = grid[i] + (grid[i + 1] - grid[i]) * fx, bottom = grid[i + points] + (grid[i + points + 1] - grid[i + points]) * fx;
		return top + (bottom - top) * fz;
	};
	const townAt = (x, z) => gridValue(data.townStrength, x, z);

	//-------------------------------LOOK UPS-------------------------------
	// grid coordinates of a world position, clamped inside the grid
	const toGrid = (x, z) => [Math.min(Math.max((x - ox + half) / cellSize, 0), cells - 0.0001), Math.min(Math.max((z - oz + half) / cellSize, 0), cells - 0.0001)];

	// world y of the ground at a world position
	function heightAt(x, z) {
		const [gx, gz] = toGrid(x, z);
		const col = Math.floor(gx), row = Math.floor(gz), fx = gx - col, fz = gz - row;
		const i = row * points + col;
		const top = heights[i] + (heights[i + 1] - heights[i]) * fx;
		const bottom = heights[i + points] + (heights[i + points + 1] - heights[i + points]) * fx;
		return top + (bottom - top) * fz;
	}

	// index of the grid point nearest a world position
	const nearestPoint = (x, z) => { const [gx, gz] = toGrid(x, z); return Math.round(gz) * points + Math.round(gx); };

	// zone tag at a world position (index into TERRAIN_ZONES)
	function zoneAt(x, z) { return zones[nearestPoint(x, z)]; }

	// ground normal at a world position
	function normalAt(x, z) { const i = nearestPoint(x, z) * 3; return [normals[i], normals[i + 1], normals[i + 2]]; }

	/*
		The tag system. Scatters up to count points that lie in the given zone and returns them as { x, y, z, normal }.
		options (all optional):
			seed			different seeds scatter differently, the same seed always gives the same points
			minSpacing		points are kept at least this far apart
			maxSlope		0 (only dead flat ground) to 1 (anything). Default 1
			near, radius	only look within radius of the world position [x, z]. Default is the whole world
	*/
	// (the same zone, count and options always give the same points, so each is worked out once for the land and remembered, and a
	//		copy of it handed out: SPAWN_KEPT of them, the oldest let go first. Not one of a point or two, those are quick and come from
	//		anywhere. And a point is kept apart from the ones found so far by testing only those in the squares round it, spacing
	//		across: the same as testing them all, as anything nearer than spacing is in one of those)
	const spawnKept = new Map();
	function findSpawnPoints(zone, count, options = {}) {
		const keyOf = count > 2 ? zone + '|' + count + '|' + JSON.stringify(options) : null;
		let found = keyOf && spawnKept.get(keyOf);
		if (!found) {
			const random = seededRandom((options.seed ?? 1) * 7919 + zone);
			const spacing = options.minSpacing ?? 0;
			const flatness = 1 - (options.maxSlope ?? 1);
			const centerX = options.near ? options.near[0] : ox, centerZ = options.near ? options.near[1] : oz;
			const radius = options.radius ?? half;
			const squares = new Map(), square = (x, z) => Math.floor(x / spacing) + ',' + Math.floor(z / spacing);
			const crowded = (x, z) => {
				const sx = Math.floor(x / spacing), sz = Math.floor(z / spacing);
				for (let i = sx - 1; i <= sx + 1; i++) for (let j = sz - 1; j <= sz + 1; j++) {
					const near = squares.get(i + ',' + j);
					if (near && near.some((p) => Math.hypot(p.x - x, p.z - z) < spacing)) return true;
				}
				return false;
			};

			found = [];
			for (let attempt = 0; attempt < count * 400 && found.length < count; attempt++) {
				const x = centerX + (random() * 2 - 1) * radius, z = centerZ + (random() * 2 - 1) * radius;
				if (Math.abs(x - ox) >= half || Math.abs(z - oz) >= half) continue;
				if (zoneAt(x, z) !== zone) continue;
				const normal = normalAt(x, z);
				if (normal[1] < flatness) continue;
				if (spacing > 0 && crowded(x, z)) continue;
				const point = { x: x, y: heightAt(x, z), z: z, normal: normal };
				found.push(point);
				if (spacing > 0) { const k = square(x, z); if (squares.has(k)) squares.get(k).push(point); else squares.set(k, [point]); }
			}
			if (keyOf) {
				spawnKept.set(keyOf, found);
				if (spawnKept.size > SPAWN_KEPT) spawnKept.delete(spawnKept.keys().next().value);
			}
		}
		return found.map((p) => ({ x: p.x, y: p.y, z: p.z, normal: [...p.normal] }));
	}

	const groundAt = (x, z) => params.seaLevel + landAt(x, z);

	return { ...data, center: [ox, oz], tile: params.tile ?? null, half, heightAt, groundAt, zoneAt, normalAt, findSpawnPoints, buildChunk, roadAt,
		// (how far into a mountain range, forested or bare: sample's mountain, the zones' MOUNTAIN_THRESHOLD the range proper)
		rangeAt: (x, z) => gridValue(data.mountains, x, z),
		// (the river at a place, THE RIVERS: null, or { surface: the world y of its water, depth: of the water there, distance: from its
		//		middle, half: its half width }. In it where distance < half)
		riverAt: (x, z) => { const r = rivers.at(x, z); return r && { surface: r.surface + params.seaLevel, depth: r.depth, distance: r.distance, half: r.half }; },
		onPath: pathsLaid ? (x, z) => pathsLaid.on(x, z) : () => false,
		// (kept clear of trees and boulders: the towns, the landing strip and its approaches, and the footpaths and their clearings)
		townAt: strip || pathClear ? (x, z) => Math.max(townAt(x, z), strip ? stripClear(strip, x, z) : 0, pathClear ? pathClear(x, z) : 0) : townAt };
}

// The triangles of a chunk (see buildChunk), as a list of vertex numbers. The same for every chunk with that many cells:
//		the grid, 2 triangles to a cell, and then the skirt, 2 triangles under each piece of each edge
const SPAWN_KEPT = 64;		// lists of points findSpawnPoints remembers, for each land

export function chunkIndices(cells) {
	const perSide = cells + 1;
	const indices = new Uint16Array((cells * cells + 4 * cells) * 6);
	let o = 0;
	for (let j = 0; j < cells; j++) {
		for (let i = 0; i < cells; i++) {
			const corner = j * perSide + i;
			indices[o + 0] = corner;     indices[o + 1] = corner + perSide; indices[o + 2] = corner + 1;
			indices[o + 3] = corner + 1; indices[o + 4] = corner + perSide; indices[o + 5] = corner + perSide + 1;
			o += 6;
		}
	}
	const edgeStart = [0, cells * perSide, 0, cells], edgeStep = [1, 1, perSide, perSide];
	for (let edge = 0; edge < 4; edge++) {
		for (let k = 0; k < cells; k++) {
			const top = edgeStart[edge] + k * edgeStep[edge], under = perSide * perSide + edge * perSide + k;
			indices[o + 0] = top;                    indices[o + 1] = under; indices[o + 2] = top + edgeStep[edge];
			indices[o + 3] = top + edgeStep[edge];   indices[o + 4] = under; indices[o + 5] = under + 1;
			o += 6;
		}
	}
	return indices;
}
