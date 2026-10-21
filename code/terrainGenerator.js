/*
	Procedural land masses. Pure maths, no GPU in here: terrain.js takes what this makes and puts it on screen.

	The world is one square height grid. Each grid point gets a height from layered noise (fractional brownian motion, fBm:
	the same noise added on top of itself at higher and higher frequency and lower and lower strength), and from that a ZONE tag.

	The layers, each one a question about a point (x, z):
		continent	is this land or sea, and how far inland?				low frequency fBm, so land comes out as separate islands
		hills		the rolling ground of the grasslands					mid frequency fBm
		mountains	is this a mountain range?								its own low frequency fBm, kept away from the coast
		alps		the mountains themselves, two things put together:
						ridges	a branching skeleton of ridge lines grown by diffusion limited aggregation, with the ground falling
								away from each line at a steady slope so the line stays a sharp crest (see growRidges)
						erosion	fBm that goes quiet on steep ground, which carves it the way running water would (see erodedFbm)
					How big they are is set by how much room they have: see MOUNTAINS

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
*/
import { findTownSites, planTownGround, layoutTowns, makeRoadFlattener } from './townLayout.js'

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

// The shape of the mountains. Distances are world units
const MOUNTAINS = {
	spread: 0.6,				// how much of the land the ranges take up. Higher = more of it
	fromCoast: [0.04, 0.16],	// how far inland (see sample) a range starts to rise, and where it is at full strength
	fromHome: [600, 1400],		// and how far from the origin: the starting shore is kept clear of them
	homeRange: [2300, 1000],	// there is always a range to look at from the start: how far north of the origin its middle is, and how far it spreads
	rangeSlope: 1.25,			// a crest is as high as this times its distance from the edge of its range (up to the mountain height setting). So a wide range is a high one and a narrow one is foothills
	flankSlope: 1.35,			// how steeply the ground falls away either side of a ridge crest, as rise over run
	minor: 0.72,				// how high the lesser ridges are next to the main ones. Each finer level of the tree is this much of the one before: lower = deeper valleys between the main ridges
	wobble: 0.2,				// how much the crest of a ridge goes up and down along its length (minor peaks and the saddles between them), 0 to 1
	wobbleLength: 180,			// and about how far apart those are. (Much shorter and the crest goes up and down faster than the faces fall away from it, and every high point on it comes out as a cone)
	valley: 24,					// how wide a strip in the bottom of each valley is rounded off
	erodeScale: 1400,			// the size of the largest shapes the erosion noise carves
};

/*
	The foothills: the forested hills the base of a mountain rolls out into, so that a range does not stand straight up out of flat ground.

	They are made from the mountains themselves. Once the ranges are built, two blurred copies of them are taken, wide enough to
	spill well out past the foot of every mountain: one that says how high the mountains near a place stand, and one that says how
	much mountain there is round it (a lot hard up against a range, less and less going away from it). The first times the second is
	a skirt round every range that is highest against its mountain and runs out to nothing: the bigger the mountain, the higher and wider.
	Noise then rolls the skirt into separate hills, and takes it away altogether along some stretches, where the mountain is left
	standing as a cliff over the flat. The ground is whichever is higher of the mountain and its foothills, rounded where they meet.
*/
const FOOTHILLS = {
	share: [1 / 7, 1 / 4],		// how high the hills stand next to the mountains behind them: from this to this, varying from place to place
	reach: 560,					// about how far out from the foot of a mountain they run, world units
	rollLength: 330,			// about how far it is from one hill to the next
	gaps: 0.28,					// how much of the way round a range has none, 0 to 1
	wooded: [8, 34],			// hills this high (from, to) and higher are forest, whatever the ground was before they were raised
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
// returns { sample, erodedFbm, foothillShape }
//		sample(x, z) -> { height: above sea level (negative under it) BEFORE any mountain is added,
//						  mountain: 0 to 1, how far into a mountain range,
//						  rise: 0 to 1, how much of the full mountain height this point gets,
//						  woodland: 0 to 1, how wooded the ground is where it isnt mountain,
//						  marsh: 0 to 1, how close to a lake,
//						  room: 0 to 1, how much room there is here for foothills (none by the coast, in a lake's valley or round the start) }
//		foothillShape(x, z) -> how much of their full height the foothills stand to here (see FOOTHILLS)
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
	const seaThreshold = 0.06;	// how much of the continent noise is under water. Higher = less land
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

	function sample(x, z) {
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
		const fromMiddle = Math.max(Math.abs(x), Math.abs(z), Math.hypot(x, z) * 0.8) / half;
		continent -= 1.4 * smoothstep(0.62, 1.0, fromMiddle);
		const inland = continent - seaThreshold;	// > 0 is land, and it grows with distance from the shore

		if (inland <= 0) {
			// under water: a shelf that eases away from the beach, then the drop-off. (From the drop-off on down the bed keeps
			//		falling at a steady grade, which is added in generateTerrain: see THE SEA BED there)
			const floor = -params.seaFloorDepth * smoothstep(0, 0.2, shelfRun(-inland));
			return { height: floor - 0.2, mountain: 0, rise: 0, woodland: 0, marsh: 0, room: 0 };
		}

		//---mountain ranges: their own noise, forced to nothing near the coast (and around the home shore)
		const range = fbm(nx / (params.landScale * 0.62) + 31.7, nz / (params.landScale * 0.62) - 12.4, 3);
		let mountain = clamp01(shape.spread + range * 1.7 + 0.7 * homeRange);
		mountain *= smoothstep(shape.fromCoast[0], shape.fromCoast[1], inland);
		mountain *= smoothstep(shape.fromHome[0], shape.fromHome[1], Math.hypot(x, z));
		const rise = Math.pow(smoothstep(FOREST_THRESHOLD, 1.0, mountain), 1.35);	// 0 at the forest edge of a range, 1 at its heart

		//---base land: a gentle run up from the waterline (the beach), levelling off to a low plateau inland
		const base = 58 * Math.tanh(1.9 * inland);

		//---rolling hills, fading in from the beach: a long slow swell, hills on that, and hummocks on those
		let hills = fbm(nx / 1150 + 3.1, nz / 1150 - 7.4, 3) * 36 + fbm(nx / 330, nz / 330, 4) * 27 + fbm(nx / 95 + 5.2, nz / 95 + 1.3, 3) * 5;
		hills *= (params.hillHeight ?? 1) * smoothstep(0.03, 0.22, inland);
		hills *= 0.3 + 0.7 * smoothstep(180, 650, Math.hypot(x, z + 70));	// gentler round the start: there are buildings to stand on it
		hills = Math.max(hills, -0.45 * base);	// a dip between hills never gets back down to beach level, so the beach stays at the shore
		let height = base + hills * (1 - 0.6 * rise);

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
		const allowed = smoothstep(0.1, 0.24, inland) * (1 - smoothstep(0, FOREST_THRESHOLD, mountain)) * smoothstep(420, 800, Math.hypot(x, z));
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

		// foothills are kept back from the sea (a beach is not the foot of a mountain), out of the valley of every lake,
		//		and clear of the start. And they give out towards the heart of a range: they are the outside of it
		const room = smoothstep(0.06, 0.2, inland) * (1 - valley) * smoothstep(380, 820, Math.hypot(x, z + 70)) * (1 - 0.85 * smoothstep(0.45, 0.85, rise));

		return { height: height, mountain: mountain, rise: rise, woodland: woodland, marsh: marsh, room: room };
	}

	// How much of their full height the foothills stand to at a place (see FOOTHILLS): the share of the mountain's height they
	//		are given here, rolled into hills, and nothing at all along the stretches that have none
	function foothillShape(x, z) {
		const nx = x + offsetX, nz = z + offsetZ;
		const present = smoothstep(-0.36 + 0.9 * FOOTHILLS.gaps - 0.25, -0.36 + 0.9 * FOOTHILLS.gaps + 0.1, fbm(nx / 1300 + 71.3, nz / 1300 - 18.9, 2));
		if (present <= 0) {
			return 0;
		}
		const share = FOOTHILLS.share[0] + (FOOTHILLS.share[1] - FOOTHILLS.share[0]) * clamp01(0.5 + 1.1 * fbm(nx / 840 - 40.1, nz / 840 + 9.7, 2));
		const roll = 0.84 + 0.62 * fbm(nx / FOOTHILLS.rollLength + 12.6, nz / FOOTHILLS.rollLength - 60.3, 3) + 0.1 * fbm(nx / 90 - 3.7, nz / 90 + 22.8, 2);
		return present * share * Math.max(roll, 0.2);
	}

	// Looks through windows on to the noise until it finds one where the start of the world makes sense:
	//		the origin (where the camera starts off looking) is on the shore, there is sea just south of it for the camera to sit over, and land to the north
	function findHomeOffset() {
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
	}
	findHomeOffset();

	return { sample: sample, erodedFbm: (x, z, octaves) => erodedFbm(x + offsetX * 0.001, z + offsetZ * 0.001, octaves), foothillShape: foothillShape };
}

//-------------------------------MOUNTAIN RIDGES-------------------------------
/*
	Diffusion limited aggregation (DLA). Real mountain ranges are branching things: a main ridge, spurs off it, smaller spurs off those.
	DLA grows exactly that shape. Start with one stuck particle (a peak). Let a loose particle wander at random until it bumps into
	the stuck ones, and stick it there. Repeat. Because a wanderer nearly always meets the outermost tips first, the clump grows
	outwards as a tree of thin branches rather than filling in as a blob.

	Here the particles are grid cells, and they can only wander inside the mountain ranges (rise > 0):
		1. on a coarse grid, put a seed on each peak of the rise and grow trees from them. This lays out the main ridges
		2. double the resolution. Every link of the tree gets a new cell in its middle, nudged sideways at random so the lines arent ruler straight,
		   and more particles are grown on at the new scale, which adds the spurs. Repeat until its at the resolution of the terrain
		3. give every cell of the tree the height of its crest: higher the further inside its range it is, lower for the lesser spurs
		4. that is a drawing of ridge LINES. From each one the ground falls away at a steady slope to either side, which makes the
		   faces of the mountain and leaves the line itself as a sharp crest

	rise: Float32Array, points x points, 0 to 1 (0 outside the mountain ranges). points - 1 must be a power of 2. cellSize: world size of a grid cell.
	mountainHeight: the height a crest of 1 stands for. shape: MOUNTAINS
	Returns { ridges, crests }
		ridges		a Float32Array the same size, 0 to 1: how high the ridges make each point, as a share of mountainHeight
		crests		where the main ridges run, for anything that wants to stand on one: [cell x, cell y, ...] of the cells along them
*/
function growRidges(rise, points, seed, cellSize, mountainHeight, shape) {
	const random = seededRandom(seed ^ 0x51ED270B);
	const full = points - 1;								// cells along a side at full resolution
	const coarsest = Math.min(64, full);					// and where the growing starts
	const inRange = 0.02;									// rise above this counts as inside a mountain range

	// the tree: every node knows the cell it is in (at the current resolution) and the node it stuck to
	const nodeX = [], nodeY = [], nodeParent = [];
	const nodeLevel = [];	// and the resolution it was grown at: 0 the coarsest, where the main ridges are laid out

	// how much of each range gets filled in at each resolution: lots while laying out the main ridges, less and less for the finer spurs
	const fillPerLevel = [0.24, 0.15, 0.09, 0.05, 0.028, 0.016];

	for (let size = coarsest, level = 0; size <= full; size *= 2, level++) {
		const scale = full / size;	// full resolution cells per cell at this level
		const riseAt = (x, y) => (x < 0 || y < 0 || x >= size || y >= size) ? 0 : rise[Math.min(Math.round((y + 0.5) * scale), full) * points + Math.min(Math.round((x + 0.5) * scale), full)];

		// which node is in each cell, -1 for none
		const occupied = new Int32Array(size * size).fill(-1);

		if (level == 0) {
			// seeds: one on every peak of the rise, the cells that are higher than all 8 around them.
			//		(In the heart of a wide range the rise is at its full 1 over a whole stretch of cells, all exactly as high as each
			//		other. Of two cells that tie, only the one that comes first counts, or every cell of the stretch would be a seed:
			//		a block of peaks standing a cell apart with nothing joining them, each of which comes out as a perfect cone)
			for (let y = 0; y < size; y++) {
				for (let x = 0; x < size; x++) {
					const here = riseAt(x, y);
					if (here <= inRange) continue;
					let peak = true;
					for (let dy = -1; dy <= 1 && peak; dy++) {
						for (let dx = -1; dx <= 1; dx++) {
							if (dx == 0 && dy == 0) continue;
							const other = riseAt(x + dx, y + dy);
							if (other > here || (other == here && (dy < 0 || (dy == 0 && dx < 0)))) { peak = false; break; }
						}
					}
					if (peak) {
						occupied[y * size + x] = nodeX.length;
						nodeX.push(x); nodeY.push(y); nodeParent.push(-1); nodeLevel.push(0);
					}
				}
			}
		} else {
			// double the resolution: every node moves to twice its coordinates, and every link gets a new node in the middle of it
			const count = nodeX.length;
			for (let i = 0; i < count; i++) {
				nodeX[i] *= 2; nodeY[i] *= 2;
				occupied[nodeY[i] * size + nodeX[i]] = i;
			}
			for (let i = 0; i < count; i++) {
				const parent = nodeParent[i];
				if (parent < 0) continue;
				let midX = (nodeX[i] + nodeX[parent]) >> 1, midY = (nodeY[i] + nodeY[parent]) >> 1;
				// nudge it sideways half the time, if there is room. Its still touching both ends, so the line isnt broken
				if (random() < 0.5) {
					const sideways = random() < 0.5 ? -1 : 1;
					const tryX = midX + (nodeY[i] != nodeY[parent] ? sideways : 0), tryY = midY + (nodeX[i] != nodeX[parent] ? sideways : 0);
					if (riseAt(tryX, tryY) > inRange && occupied[tryY * size + tryX] < 0) { midX = tryX; midY = tryY; }
				}
				if (midX < 0 || midY < 0 || midX >= size || midY >= size || occupied[midY * size + midX] >= 0) continue;
				occupied[midY * size + midX] = nodeX.length;
				nodeX.push(midX); nodeY.push(midY); nodeParent.push(parent); nodeLevel.push(nodeLevel[i]);	// (a piece of the link it is in the middle of)
				nodeParent[i] = nodeX.length - 1;
			}
		}

		// the cells a particle can start from: anywhere inside a range
		const startCells = [];
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				if (riseAt(x, y) > inRange) startCells.push(y * size + x);
			}
		}
		if (startCells.length == 0 || nodeX.length == 0) continue;

		// grow: drop a particle somewhere in a range and let it wander until it is next to the tree, then it joins it
		const target = Math.floor(startCells.length * fillPerLevel[Math.min(level, fillPerLevel.length - 1)]);
		let added = 0;
		for (let attempt = 0; attempt < target * 6 && added < target; attempt++) {
			let cell = startCells[Math.floor(random() * startCells.length)];
			if (occupied[cell] >= 0) continue;
			let x = cell % size, y = Math.floor(cell / size);

			for (let step = 0; step < 3000; step++) {
				// next to the tree? (the 4 cells sharing an edge with this one)
				let neighbour = -1;
				if (x > 0 && occupied[cell - 1] >= 0) neighbour = occupied[cell - 1];
				else if (x < size - 1 && occupied[cell + 1] >= 0) neighbour = occupied[cell + 1];
				else if (y > 0 && occupied[cell - size] >= 0) neighbour = occupied[cell - size];
				else if (y < size - 1 && occupied[cell + size] >= 0) neighbour = occupied[cell + size];
				if (neighbour >= 0) {
					occupied[cell] = nodeX.length;
					nodeX.push(x); nodeY.push(y); nodeParent.push(neighbour); nodeLevel.push(level);
					added++;
					break;
				}

				// wander one cell. Walking out of the range ends this particle
				const direction = Math.floor(random() * 4);
				const nextX = x + (direction == 0 ? 1 : direction == 1 ? -1 : 0), nextY = y + (direction == 2 ? 1 : direction == 3 ? -1 : 0);
				if (riseAt(nextX, nextY) <= inRange) break;
				x = nextX; y = nextY; cell = y * size + x;
			}
		}
	}

	const count = nodeX.length;

	/*
		The height of the crest at every node, 0 to 1.

		A mountain needs ground to stand on: a tall one on a narrow base is a wall. So a crest is as high as it is far inside
		its range: rangeSlope times the distance to the range's edge. That puts the highest ground in the middle of the widest
		ranges, and has every ridge drop away to nothing as it runs out to the edge.
		First then, how far every cell is from the edge of its range (in cells): 0 outside, and inside it the shortest way out,
		found by the same two sweeps as the cones further down, counting distance up instead of height down.
	*/
	const steps = [[-1, 0], [0, -1], [-1, -1], [1, -1], [-2, -1], [2, -1], [-1, -2], [1, -2]];	// the neighbours already done, when sweeping from the top left
	const toEdge = new Float32Array(points * points);
	for (let i = 0; i < points * points; i++) toEdge[i] = rise[i] > inRange ? 1e9 : 0;
	for (let sweep = 0; sweep < 2; sweep++) {
		const sign = sweep == 0 ? 1 : -1;
		for (let k = 0; k < points * points; k++) {
			const i = sweep == 0 ? k : points * points - 1 - k;
			if (toEdge[i] == 0) continue;
			const x = i % points, y = (i - x) / points;
			let best = toEdge[i];
			for (const [dx, dy] of steps) {
				const nx = x + dx * sign, ny = y + dy * sign;
				const carried = (nx < 0 || ny < 0 || nx >= points || ny >= points ? 0 : toEdge[ny * points + nx]) + Math.hypot(dx, dy);
				if (carried < best) best = carried;
			}
			toEdge[i] = best;
		}
	}

	// And the lesser ridges are lower. The main ridges were laid out first, on the coarsest grid, and each finer grid added
	//		smaller spurs to them. A spur is that much lower than the ridge it stands off, so between two main ridges the
	//		ground drops away into a real valley, with the lesser ridges as ribs down its sides
	const crest = new Float32Array(count);
	for (let i = 0; i < count; i++) {
		crest[i] = Math.pow(shape.minor, nodeLevel[i]);
	}
	for (let i = 0; i < count; i++) {
		crest[i] *= Math.min(toEdge[nodeY[i] * points + nodeX[i]] * cellSize * shape.rangeSlope / Math.max(mountainHeight, 1), 1);
	}

	// draw the tree: each cell on a ridge line gets the height of its crest, everything else 0.
	//		A real crest is not an even slope, it goes over minor peaks and down into saddles: some noise along it does that
	const wobble = createNoise(seed ^ 0x2545F491);
	const lines = new Float32Array(points * points);
	for (let i = 0; i < count; i++) {
		const along = wobble(nodeX[i] * cellSize / shape.wobbleLength, nodeY[i] * cellSize / shape.wobbleLength)[0];
		lines[nodeY[i] * points + nodeX[i]] = crest[i] * (1 - shape.wobble * (0.5 - 0.5 * along));
	}

	/*
		Spread the lines into mountains, keeping the crest. From every cell of a ridge line the ground falls away at
		one steady slope in every direction, a cone with its point on the crest, and the land is whatever is highest:
			height here = the most, over every ridge cell, of (the crest's height there - slope x the distance to it)
		Along a ridge line that leaves a sharp edge with a face either side, like the ridge of a roof, and where the
		faces of two ridges meet it leaves a valley.

		Looking at every ridge cell from every cell would take hours. But the best cone at a cell is always one that
		came through a cell next to it, so the answer can be passed along from neighbour to neighbour: one sweep
		across the grid from the top left carrying heights down and right, one back from the bottom right carrying them
		up and left (a chamfer distance transform). With only the 8 cells around the cones come out eight sided,
		so the 8 a knight's move away are used as well, which makes them near enough round.
	*/
	const drop = shape.flankSlope * cellSize / Math.max(mountainHeight, 1);		// height lost per cell of distance, in the 0 to 1 the crests are in
	const ridges = Float32Array.from(lines);
	for (let sweep = 0; sweep < 2; sweep++) {
		const sign = sweep == 0 ? 1 : -1;
		for (let k = 0; k < points * points; k++) {
			const i = sweep == 0 ? k : points * points - 1 - k;
			const x = i % points, y = (i - x) / points;
			let best = ridges[i];
			for (const [dx, dy] of steps) {
				const nx = x + dx * sign, ny = y + dy * sign;
				if (nx < 0 || ny < 0 || nx >= points || ny >= points) continue;
				const carried = ridges[ny * points + nx] - drop * Math.hypot(dx, dy);
				if (carried > best) best = carried;
			}
			ridges[i] = best;
		}
	}

	// Two faces meeting leave a valley with a knife cut for a floor. A blurred copy is higher than the land in the hollows
	//		(they are filled in) and lower on the crests (they are worn down): taking whichever is higher keeps the first and not the second
	if (shape.valley > 0) {
		const filled = boxBlur(ridges, points, Math.max(Math.round(shape.valley / cellSize), 1));
		for (let i = 0; i < ridges.length; i++) ridges[i] = Math.max(ridges[i], filled[i]);
	}

	// the main ridges: the ones laid out on the coarsest grid, where they are a good way up
	const crests = [];
	for (let i = 0; i < count; i++) {
		if (nodeLevel[i] == 0 && crest[i] > 0.3) crests.push(nodeX[i], nodeY[i]);
	}

	return { ridges, crests };
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

// The mountain and its foothills at a place, as one height over the land they stand on: whichever is higher, rounded where
//		they meet. mountain: how high the mountain alone is there, footing: the skirt there, room: see sample.
//		Leaves how wooded the foothills make the place in wooded: the hills are forest
function makeFoothills(foothillShape) {
	const foothills = { wooded: 0, raise: (x, z, mountain, footing, room) => {
	foothills.wooded = 0;
	if (footing <= 0 || room <= 0) {
		return mountain;
	}
	const hill = footing * room * foothillShape(x, z);
	foothills.wooded = smoothstep(FOOTHILLS.wooded[0], FOOTHILLS.wooded[1], hill);
	return smoothMax(mountain, hill, 0.5 * hill + 3);
	} };
	return foothills;
}

// how much lower the sea bed is for being out past the middle of the drop-off (see generateTerrain). It comes on over the first 60
//		or so units, not at a crease
function bedFall(params, out) {
	return Math.max(params.seaBedGrade ?? 0, 0) * out * out / (out + 60);
}

//-------------------------------THE MESH-------------------------------
/*
	What makes the mesh of the land, apart from the rest of it: the grids it reads are passed in (chunkGrids, from generateTerrain),
	so a worker can be handed a copy of them and make chunks off the main thread (see terrainWorker.js). The same params and grids
	make the same chunks wherever it runs.
		grids		{ ridges, marshes, footings, beyondDrop }, one entry per data grid point
		sampler		createTerrainSampler(params), when there is one already
*/
export function makeChunkBuilder(params, grids, sampler = createTerrainSampler(params)) {
	const { sample, erodedFbm, foothillShape } = sampler;
	const { ridges, marshes, footings, beyondDrop } = grids;		// (and the towns' grids, read as they are when wanted: generateTerrain fills them in after making this)
	// the streets of the towns, cut into the land (made when they are first wanted: they are laid out after the builder is made)
	let roads = null, roadsFrom = null;
	const cells = params.dataResolution ?? 1024;
	const points = cells + 1;
	const cellSize = params.worldSize / cells;
	const half = params.worldSize * 0.5;
	const foothills = makeFoothills(foothillShape);

	// one of the data grids at a world position, bilinear between the 4 grid points around it
	function gridAt(grid, x, z) {
		const gx = Math.min(Math.max((x + half) / cellSize, 0), cells - 0.0001), gz = Math.min(Math.max((z + half) / cellSize, 0), cells - 0.0001);
		const col = Math.floor(gx), row = Math.floor(gz), fx = gx - col, fz = gz - row, i = row * points + col;
		const top = grid[i] + (grid[i + 1] - grid[i]) * fx, bottom = grid[i + points] + (grid[i + points + 1] - grid[i + points]) * fx;
		return top + (bottom - top) * fz;
	}
	// how high the ridge skeleton makes a world position
	const ridgeAt = (x, z) => gridAt(ridges, x, z);

	// The exact ground at any world position, the same sum the data grid was filled with. A mesh finer than the data grid gets its
	//		extra detail from here: the noise layers go on down to a couple of units, only the ridge skeleton is limited to the grid.
	//		Returns the height above sea level, and leaves what covers the point (see coverOf) in landAtCover
	let landAtCover = 0;
	function landAt(x, z) {
		const result = sample(x, z);
		// (how marshy it is comes from the data grid, which knows about every lake. sample only knows the ones it hollowed out itself)
		const marsh = gridAt(marshes, x, z);
		let mountain = 0;
		if (result.rise > 0) {
			const eroded = erodedFbm(x / MOUNTAINS.erodeScale, z / MOUNTAINS.erodeScale, 9);
			const shape = ridgeAt(x, z) * (0.62 + 0.76 * eroded) + 0.14 * eroded;
			mountain = params.mountainHeight * smoothstep(0, 0.3, result.rise) * shape;
		}
		const raised = foothills.raise(x, z, mountain, gridAt(footings, x, z), result.room);
		landAtCover = coverOf(result.mountain, Math.max(result.woodland, foothills.wooded * (1 - marsh)), marsh);
		let height = result.height + raised - (result.height < 0 ? bedFall(params, gridAt(beyondDrop, x, z)) : 0);
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
	const { sample, erodedFbm, foothillShape } = createTerrainSampler(params);

	// Two resolutions. The DATA grid (heights, zones, the ridge skeleton, what the water and the grass read) is always this fine.
	//		The MESH is built separately, a chunk at a time (see buildChunk): finer than this near the camera, coarser far away
	const cells = params.dataResolution ?? 1024;
	const points = cells + 1;
	const cellSize = params.worldSize / cells;
	const half = params.worldSize * 0.5;

	const heights = new Float32Array(points * points);		// world y
	const mountains = new Float32Array(points * points);
	const woodlands = new Float32Array(points * points);
	const covers = new Float32Array(points * points);
	const marshes = new Float32Array(points * points);
	const lakes = new Float32Array(points * points);
	const rises = new Float32Array(points * points);
	const rooms = new Float32Array(points * points);
	const zones = new Uint8Array(points * points);
	const normals = new Float32Array(points * points * 3);

	// the land without its mountains, and where the mountain ranges are
	for (let row = 0; row < points; row++) {
		for (let col = 0; col < points; col++) {
			const result = sample(col * cellSize - half, row * cellSize - half);
			const i = row * points + col;
			heights[i] = result.height;		// above sea level for now
			mountains[i] = result.mountain;
			woodlands[i] = result.woodland;
			marshes[i] = result.marsh;
			rises[i] = result.rise;
			rooms[i] = result.room;
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
	//		the shortest way through a neighbour (as in growRidges)
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
	}

	// the mountains: the ridge skeleton, with the eroded noise roughing it up and carving the faces between the ridges
	const { ridges, crests } = growRidges(rises, points, params.seed, cellSize, params.mountainHeight, MOUNTAINS);
	const ridgeCrests = new Float32Array(crests.map((cell) => cell * cellSize - half));	// as world x, z
	const massif = new Float32Array(points * points);		// how high the mountains alone stand at each point, over the land they are on
	for (let row = 0; row < points; row++) {
		for (let col = 0; col < points; col++) {
			const i = row * points + col;
			if (rises[i] > 0) {
				const eroded = erodedFbm((col * cellSize - half) / MOUNTAINS.erodeScale, (row * cellSize - half) / MOUNTAINS.erodeScale, 9);
				const shape = ridges[i] * (0.62 + 0.76 * eroded) + 0.14 * eroded;
				// the ridges set the profile of the mountain. The range only reins it in at its very edge, so it meets the forest without a step
				massif[i] = params.mountainHeight * smoothstep(0, 0.3, rises[i]) * shape;
			}
		}
	}

	/*
		The skirt the foothills are cut from (see FOOTHILLS): at every point, how high foothills as tall as the mountains
		behind them would stand there.
			peak	how high the mountains near the point stand. An average would be dragged down by all the flat ground round
					them, so it is the average of their heights to the 4th power, and the 4th root of that: the high ground counts
					for nearly all of it (the 1.9 brings it up to about the height of the tops themselves)
			share	how much mountain there is round the point: the plain average, next to that peak. Near enough 0.2 and up
					against a range, falling to 0 going away from it
	*/
	const footings = new Float32Array(points * points);
	{
		const radius = Math.max(Math.round(FOOTHILLS.reach / cellSize), 1);
		const average = boxBlur(massif, points, radius);
		const fourth = boxBlur(massif.map((height) => height * height * height * height), points, radius);
		for (let i = 0; i < points * points; i++) {
			const peak = Math.sqrt(Math.sqrt(Math.max(fourth[i], 0)));
			footings[i] = peak > 1 ? 1.9 * peak * smoothstep(0, 0.2, average[i] / peak) : 0;
		}
	}

	const foothills = makeFoothills(foothillShape);

	for (let row = 0; row < points; row++) {
		for (let col = 0; col < points; col++) {
			const i = row * points + col;
			heights[i] += foothills.raise(col * cellSize - half, row * cellSize - half, massif[i], footings[i], rooms[i]) - bedFall(params, beyondDrop[i]);
			woodlands[i] = Math.max(woodlands[i], foothills.wooded * (1 - marshes[i]));
			covers[i] = coverOf(mountains[i], woodlands[i], marshes[i]);
			zones[i] = classifyZone(heights[i], covers[i], params, !sea[i]);
			heights[i] += params.seaLevel;
		}
	}

	// the mesh (see makeChunkBuilder)
	const chunkGrids = { ridges, marshes, footings, beyondDrop, townStrength: null, townHeight: null, townRoads: null };
	const { landAt, buildChunk } = makeChunkBuilder(params, chunkGrids, { sample, erodedFbm, foothillShape });

	/*
		THE TOWNS (townLayout.js): where they go, the hill each stands on, and their streets, houses and the rest. The hill goes into
		the land's grids, and the land is worked out again over each town with its streets cut into it
	*/
	const aboveSea = heights.map((h) => h - params.seaLevel);
	const siteGrids = { points, cells, cellSize, half, heights: aboveSea, covers, sea, toSea };
	let townSites = findTownSites(siteGrids, params, MOUNTAIN_THRESHOLD);
	let townGround = null, town = null;
	const gridValue = (grid, x, z) => {
		const gx = Math.min(Math.max((x + half) / cellSize, 0), cells - 0.0001), gz = Math.min(Math.max((z + half) / cellSize, 0), cells - 0.0001);
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
		townGround = planTownGround({ points, cells, cellSize, half, sea, toSea, heights: aboveSea }, townSites, params.seed);
		chunkGrids.townStrength = townGround.strength;
		chunkGrids.townHeight = townGround.height;
		chunkGrids.townRoads = null;
		town = layoutTowns(townSites, (x, z) => params.seaLevel + landAt(x, z), townAt, (x, z) => gridValue(toSeaWorld, x, z), params.seaLevel, params.seed);
		const kept = townSites.filter((site, k) => town.towns[k].buildings.length >= 30);
		if (kept.length == townSites.length || attempt == 3) break;
		givenUp.push(...townSites.filter((site) => !kept.includes(site)));
		const more = findTownSites(siteGrids, params, MOUNTAIN_THRESHOLD, givenUp).filter((s) => !kept.some((k) => Math.hypot(k.x - s.x, k.z - s.z) < 1));
		townSites = [...kept, ...more].slice(0, townSites.length).map((site, k) => ({ ...site, number: k, clusters: null }));
	}
	chunkGrids.townRoads = town.segments;
	for (let i = 0; i < points * points; i++) {
		if (townGround.strength[i] <= 0) continue;
		const col = i % points, row = (i - col) / points;
		heights[i] = params.seaLevel + landAt(col * cellSize - half, row * cellSize - half);
		if (townGround.strength[i] > 0.5 && heights[i] > params.seaLevel + 0.5) zones[i] = ZONE_TOWN;
	}
	const roadAt = makeRoadFlattener(town.segments).nearest;

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

	//-------------------------------LOOK UPS-------------------------------
	// grid coordinates of a world position, clamped inside the grid
	const toGrid = (x, z) => [Math.min(Math.max((x + half) / cellSize, 0), cells - 0.0001), Math.min(Math.max((z + half) / cellSize, 0), cells - 0.0001)];

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
	function findSpawnPoints(zone, count, options = {}) {
		const random = seededRandom((options.seed ?? 1) * 7919 + zone);
		const spacing = options.minSpacing ?? 0;
		const flatness = 1 - (options.maxSlope ?? 1);
		const centerX = options.near ? options.near[0] : 0, centerZ = options.near ? options.near[1] : 0;
		const radius = options.radius ?? half;

		const found = [];
		for (let attempt = 0; attempt < count * 400 && found.length < count; attempt++) {
			const x = centerX + (random() * 2 - 1) * radius, z = centerZ + (random() * 2 - 1) * radius;
			if (Math.abs(x) >= half || Math.abs(z) >= half) continue;
			if (zoneAt(x, z) !== zone) continue;
			const normal = normalAt(x, z);
			if (normal[1] < flatness) continue;
			if (spacing > 0 && found.some((p) => Math.hypot(p.x - x, p.z - z) < spacing)) continue;
			found.push({ x: x, y: heightAt(x, z), z: z, normal: normal });
		}
		return found;
	}

	const groundAt = (x, z) => params.seaLevel + landAt(x, z);

	return { cells, points, cellSize, heights, mountains, woodlands, covers, marshes, lakes, zones, normals, shoreDistances, ridgeCrests, heightAt, groundAt, zoneAt, normalAt, findSpawnPoints, buildChunk, chunkGrids,
		towns: town.towns, townStrength: townGround.strength, townAt, roadAt };
}

// The triangles of a chunk (see buildChunk), as a list of vertex numbers. The same for every chunk with that many cells:
//		the grid, 2 triangles to a cell, and then the skirt, 2 triangles under each piece of each edge
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
