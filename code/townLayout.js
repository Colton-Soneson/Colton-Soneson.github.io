import { seededRandom, createNoise } from './terrainGenerator.js'

/*
	THE SEASIDE TOWNS: where they are, the hill each one stands on, and how it is laid out. Pure maths, no GPU in here (it runs in the
	terrain worker too): terrainGenerator.js asks for it while it makes the land, and town.js puts the result on screen.
	The look is Koriko, the town in Kiki's Delivery Service: tall plastered houses packed tight up a hill over the sea, red and green
	roofs, cobbled streets that wind along the slope and stairs that climb straight up it, stone walls holding the terraces up.

	THE SITE (findTownSites). A town is on the sea: its middle is on the shore, where a mountain range (or its foothills) comes
	down near enough the coast to put the houses on a slope, MOUNTAIN_NEAR away. The coast there has to run more or less
	straight for the length of the town, with land behind it for the depth of it. settings.townCount of them, the best sites,
	TOWN_APART from each other, and not on top of the start.
		u		along the shore (the coast's own direction at the middle), -length to +length
		v		inland: how far a point is from the sea (the land's own distance to the sea, so it follows the coast as it bends)

	THE HILL (planTownGround). Over the town the land is made again: a quay at the water (QUAY_HEIGHT over the sea), then rising
	inland to meet the land behind, in terraces (TERRACE_SHARE of the rise is gathered into steps, one to each street). A town's
	strength is 1 over its core (length by depth) and fades out round it, and the land is the town's hill that much and its own
	the rest. The fade is as wide as it needs to be for the hill to roll gently down to the land beside it (no steeper than
	FADE_SLOPE): wide where the hill stands well above the grass or the forest round it, short where it does not. And the hill
	never cuts into land higher than itself: where a mountain rises behind the town, the hill rolls up into it (see landAt in
	terrainGenerator.js: the higher of the two, rounded).

	THE CLUSTERS. The houses do not fill the town: they are in a main cluster (MAIN_CLUSTER of the core's length and depth, round
	the middle, down to the water) and a few hamlets round it (HAMLETS), each a blob in u and v with a ragged edge (clusterAt). The
	streets are kept where there is a cluster, the houses thin out to its edge, lanes join each hamlet to the town, and the rest of
	the zone is grassland, with trees here and there.

	THE LAYOUT (layoutTowns), all on that hill:
		streets		the promenade along the quay, and streets above it along the slope (STREET_SPACING apart inland), each a
					line of points where the land is a given v, where a cluster is
		lanes		from each hamlet to the nearest street of the rest of the town, across the land between
		bridges		stone bridges on arches where water (an inlet, a bay) breaks a street or a lane: from the end of one piece of
					it to the start of the next, over the water
		links		lanes and stairs up from each street to the next, every LINK_EVERY or so along it: stairs where it is steep
		plaza		a square on one of the middle streets, with the library on its uphill side
		buildings	both sides of every street (the sea side of the promenade is the quay), shoulder to shoulder, facing it. Each
					one is a type (BUILDING_TYPES) and its own size and colours. Its floor is at the street, and where the land
					falls away under it, it stands on stone footings. A gap now and then has a tree in it
		pier		a timber pier out from the quay into the sea, with the fisherman's shack at its end
		dock		a narrow jetty out to deep water for the schooners (npcShips.js), as long as it has to be (DOCK), in every town that can
					have one
		lamps		gas lamps along every street, either side by turns
		trees		in the gaps between the houses, round the plaza, along the promenade
		roses		rose bushes in the gardens round the houses and along the lanes
		beds		tulip beds: on the plaza, and on the grass beside the streets and lanes
		walls		the stone walls the streets need where the ground beside them is well above or below them (not where houses are)
	THE ROADS IN THE LAND (makeRoadFlattener): every street, lane, stair and the plaza is cut into the land, level across, at its
	own height, with steep sides (that the walls then face), so whatever walks on the land walks on the roads. Not the bridges:
	they stand over it (whatever walks on them stands on their deck, see town.js).
*/
export const TOWN_METRE = 2;				// world units to the metre (the forest's own)
const QUAY_HEIGHT = 6.2;					// over the sea
const QUAY_DEPTH = 34;						// how far inland the quay runs flat
const TOWN_LENGTH = 440;					// half the length of its core along the shore, at a town size of 1
const TOWN_DEPTH = 380;						// how far inland its core goes
const FADE_SLOPE = 0.22;					// the steepest the fade from the town's hill to the land round it gets (rise over run)
const FADE_MOST = 700;						// and the widest it gets (the ground is planned out as far as that, so it is never cut short)
const MAIN_CLUSTER = [0.58, 0.52];			// the main cluster's half length and half depth, of the core's
const HAMLETS = [2, 4];
const SITE_FIT = [0.78, 0.87];				// how much of the core's length and depth a site has to be good for
const CROSSING_BONUS = 0.1;
const BRIDGE_LONGEST = 320;					// world units
const BRIDGE_CLEAR = 5;						// the least height of a bridge's deck over the sea
// the dock (one town's): out to where the sea is depth deep, and past more, least long at the least, most at the most (it is not
//		had if it cannot get that deep), and wide (world units)
const DOCK = { depth: 12, past: 10, least: 40, most: 320, width: 5 };					// how much a site across water (bridged) is favoured over a straight shore						// how many hamlets
const HAMLET_SIZE = [72, 112];				// their half length (world units)
const MOUNTAIN_NEAR = [250, 1500];			// how far from the shore the nearest mountain may be
const TOWN_APART = 2400;
const HOME_CLEAR = 700;						// world units round the start kept clear of towns
const STREET_SPACING = 62;					// inland, between the streets along the slope
const PROMENADE_V = 8;						// how far in from the water the promenade runs (its sea edge is the quay)
const TERRACE_SHARE = 0.7;
const LINK_EVERY = [70, 130];
const STAIRS_STEEPER = 0.16;				// a link steeper than this (rise over run) is a stairway
export const STREET_WIDTH = 9, LANE_WIDTH = 6, STAIR_WIDTH = 5, PROMENADE_WIDTH = 12;
const ROAD_EDGE = 2.0;						// how wide the steep side of a road cut is

/*
	The types of building (see the meshes in townBuildings.js), and where they go. Sizes in world units: width along the street,
	depth back from it. floors: storeys over the ground floor. once: there is one of it in a town (or none, if it does not fit)
		street		any street		water		the promenade only		plaza		the plaza		pier		the end of the pier
*/
export const BUILDING_TYPES = [
	{ name: 'townhouse', width: [14, 18], depth: [20, 26], floors: [2, 3], weight: 3, where: 'street' },
	{ name: 'mansard', width: [24, 32], depth: [22, 28], floors: [3, 4], weight: 2, where: 'street' },
	{ name: 'timbered', width: [16, 22], depth: [18, 24], floors: [1, 2], weight: 3, where: 'street' },
	{ name: 'turret', width: [18, 24], depth: [18, 24], floors: [2, 3], weight: 1.5, where: 'street' },
	{ name: 'hotel', width: [34, 42], depth: [24, 30], floors: [4, 5], weight: 0.7, where: 'street' },
	{ name: 'bakery', width: [18, 22], depth: [20, 24], floors: [2, 2], weight: 0, where: 'street', once: true },
	{ name: 'library', width: [38, 44], depth: [28, 32], floors: [2, 2], weight: 0, where: 'plaza', once: true },
	{ name: 'shack', width: [14, 16], depth: [12, 14], floors: [0, 0], weight: 0, where: 'pier', once: true },
	{ name: 'shop', width: [16, 22], depth: [18, 24], floors: [1, 2], weight: 2, where: 'street' },
	{ name: 'chapel', width: [18, 22], depth: [30, 34], floors: [1, 1], weight: 0.25, where: 'street' },
	{ name: 'cottages', width: [24, 28], depth: [14, 18], floors: [1, 1], weight: 1.2, where: 'street' },
	{ name: 'tower', width: [13, 15], depth: [13, 15], floors: [4, 5], weight: 0.8, where: 'street' },
	{ name: 'warehouse', width: [26, 34], depth: [22, 28], floors: [1, 2], weight: 1.5, where: 'water' },
	{ name: 'inn', width: [22, 28], depth: [20, 26], floors: [2, 3], weight: 1.2, where: 'street' },
	{ name: 'gabled', width: [14, 18], depth: [20, 24], floors: [2, 3], weight: 2.5, where: 'street' },
];
export const FLOOR_HEIGHT = 6.4, GROUND_FLOOR = 7.2;
// what the towns are made of, a number for each (see vf_town.js)
export const TOWN_MATERIALS = { PLASTER: 0, STONE: 1, ROOF: 2, TIMBER: 3, PLANKS: 4, GLASS: 5, TRIM: 6, IRON: 7, LAMP: 8, COBBLE: 9, DRESSED: 10,
	AWNING: 11, BRASS: 12, BRICK: 13, DOOR: 14, FLOWERS: 15, COPPER: 16, CLOCK: 17, LEAVES: 18, ROSES: 19, TULIPS: 20, DIRT: 21, PATH: 22 };
// Each type comes in VARIANTS sizes (its meshes are made once for each, so they can be drawn many times over without being stretched):
//		{ width, depth, floors } of one of them
export const VARIANTS = 4;
export function variantSize(typeNumber, variant) {
	const t = BUILDING_TYPES[typeNumber];
	const lerp = ([a, b], f) => a + (b - a) * f;
	return { width: Math.round(lerp(t.width, [0, 0.66, 0.33, 1][variant]) * 2) / 2, depth: Math.round(lerp(t.depth, [0.5, 1, 0, 0.75][variant]) * 2) / 2,
		floors: t.floors[0] + variant % (t.floors[1] - t.floors[0] + 1) };
}

// the plaster and the roofs: Koriko's. Picked from per building
export const PLASTERS = [[0.93, 0.82, 0.62], [0.95, 0.88, 0.72], [0.9, 0.7, 0.62], [0.96, 0.92, 0.84], [0.86, 0.78, 0.66], [0.92, 0.74, 0.55],
	[0.78, 0.82, 0.74], [0.95, 0.8, 0.78], [0.84, 0.76, 0.86], [0.98, 0.86, 0.56]];
// (mostly the red and orange of fired tiles, then the green of old copper, a slate blue now and then, rarely a plum)
export const ROOFS = [[0.66, 0.24, 0.16], [0.74, 0.32, 0.2], [0.58, 0.2, 0.16], [0.7, 0.42, 0.22], [0.62, 0.28, 0.18], [0.78, 0.36, 0.22], [0.55, 0.22, 0.18],
	[0.24, 0.46, 0.42], [0.3, 0.5, 0.44], [0.28, 0.42, 0.26], [0.22, 0.34, 0.42], [0.42, 0.28, 0.4]];
export const TRIMS = [[0.95, 0.94, 0.9], [0.3, 0.42, 0.36], [0.24, 0.3, 0.42], [0.46, 0.26, 0.2], [0.94, 0.9, 0.8]];

const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

//-------------------------------THE SITES-------------------------------
/*
	g: the land's grids as generateTerrain has them so far: { points, cells, cellSize, half, heights (over the sea), covers, sea,
	toSea (cells), seaLevel }, and params (townCount, townSize, seed). Returns [{ x, z (the middle, on the shore), tx, tz (along it),
	nx, nz (inland), length, depth, top (how high over the sea the town's hill ends), across (over water), waterU (where along the
	shore the water is) }]. given: sites given up
	already (none is found near one of them)
*/
export function findTownSites(g, params, mountainThreshold, given = []) {
	const count = Math.round(params.townCount ?? 0);
	if (count <= 0) return [];
	const { points, cells, cellSize, half, heights, covers, sea, toSea } = g;
	const size = clamp(params.townSize ?? 1, 0.4, 2);
	const length = TOWN_LENGTH * size, depth = TOWN_DEPTH * Math.sqrt(size);
	// (the shore and the land behind are judged over where the houses will be, SITE_FIT of the core: the rest is open grass)
	const fitLength = length * SITE_FIT[0], fitDepth = depth * SITE_FIT[1];
	const index = (x, z) => Math.round(clamp((z + half) / cellSize, 0, cells)) * points + Math.round(clamp((x + half) / cellSize, 0, cells));
	// how far every point is from bare mountain, in cells (as distanceTo in generateTerrain)
	const toMountain = new Float32Array(points * points);
	for (let i = 0; i < toMountain.length; i++) toMountain[i] = covers[i] >= mountainThreshold ? 0 : 1e9;
	const steps = [[-1, 0], [0, -1], [-1, -1], [1, -1]];
	for (let sweep = 0; sweep < 2; sweep++) {
		const sign = sweep == 0 ? 1 : -1;
		for (let k = 0; k < toMountain.length; k++) {
			const i = sweep == 0 ? k : toMountain.length - 1 - k;
			const col = i % points, row = (i - col) / points;
			let best = toMountain[i];
			for (const [dx, dy] of steps) {
				const nx = col + dx * sign, ny = row + dy * sign;
				if (nx < 0 || ny < 0 || nx >= points || ny >= points) continue;
				best = Math.min(best, toMountain[ny * points + nx] + Math.hypot(dx, dy));
			}
			toMountain[i] = best;
		}
	}
	const seaAt = (x, z) => toSea[index(x, z)] * cellSize;		// world units to the sea (0 in it)

	// every bit of shore, scored
	const candidates = [];
	const stride = 4;
	for (let row = 4; row < cells - 4; row += stride) {
		for (let col = 4; col < cells - 4; col += stride) {
			const i = row * points + col;
			if (sea[i] || toSea[i] < 1 || toSea[i] > 2.5 || heights[i] < 0 || heights[i] > 9) continue;
			const mountainAway = toMountain[i] * cellSize;
			if (mountainAway < MOUNTAIN_NEAR[0] || mountainAway > MOUNTAIN_NEAR[1]) continue;
			const x = col * cellSize - half, z = row * cellSize - half;
			const fromHome = Math.hypot(x, z - 150);
			if (fromHome < HOME_CLEAR + length) continue;
			// inland: the way the distance to the sea grows
			let nx = seaAt(x + 24, z) - seaAt(x - 24, z), nz = seaAt(x, z + 24) - seaAt(x, z - 24);
			const nl = Math.hypot(nx, nz);
			if (nl < 1e-3) continue;
			nx /= nl; nz /= nl;
			const tx = -nz, tz = nx;
			// land all the way back, and none of it lake, sea or bare mountain
			let good = 0, tried = 0;
			for (let s = 20; s <= fitDepth; s += 16) {
				const j = index(x + nx * s, z + nz * s);
				tried++;
				// (and further from the sea the further in: not a strip of land with the sea behind it)
				if (!sea[j] && heights[j] > 0 && covers[j] > -0.1 && covers[j] < mountainThreshold + 0.05 && toSea[j] * cellSize > s * 0.45) good++;
			}
			if (good < 0.92 * tried) continue;
			// and the coast running on more or less straight either way: a little way in from it, still near the sea. Or across water
			//		(an inlet, a bay) to more of the same beyond it, with land at both ends: the town is then bridged over it
			let straight = 0, along = 0, water = 0, waterU = 0;
			for (let u = -fitLength; u <= fitLength; u += 40) {
				const j = index(x + tx * u + nx * 30, z + tz * u + nz * 30);
				along++;
				if (!sea[j] && heights[j] > 0 && toSea[j] * cellSize < 90 && toSea[j] * cellSize > 6) straight++;
				else if (sea[j] && Math.abs(u) > 60) { water++; waterU += u; }
			}
			const ends = [-fitLength, fitLength].every((u) => { const j = index(x + tx * u + nx * 30, z + tz * u + nz * 30); return !sea[j] && heights[j] > 0; });
			const across = water >= 2 && water <= 0.35 * along && straight >= 0.5 * along && straight + water >= 0.85 * along && ends;
			if (straight < 0.8 * along && !across) continue;
			const back = heights[index(x + nx * fitDepth, z + nz * fitDepth)];
			const score = (straight + water) / along - Math.abs(mountainAway - 700) / 1600 + 0.25 * smoothstep(20, 90, back) - 0.15 * fromHome / half + (across ? CROSSING_BONUS : 0);
			candidates.push({ score, x, z, nx, nz, tx, tz, back, across, waterU: water ? waterU / water : 0 });
		}
	}
	candidates.sort((a, b) => b.score - a.score);
	const sites = [];
	for (const c of candidates) {
		if (sites.length >= count) break;
		if (sites.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < TOWN_APART)) continue;
		if (given.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < TOWN_APART * 0.5)) continue;		// (given up already)
		sites.push({ x: c.x, z: c.z, tx: c.tx, tz: c.tz, nx: c.nx, nz: c.nz, length, depth, top: clamp(c.back + 35, 90, 160) * Math.sqrt(size), number: sites.length, across: c.across, waterU: c.waterU });
	}
	return sites;
}

//-------------------------------THE HILL-------------------------------
// The town's own ground (over the sea) a distance v inland, before the terraces: the quay, then up to its top
function rampAt(site, v) {
	if (v <= QUAY_DEPTH) return QUAY_HEIGHT;
	const f = clamp((v - QUAY_DEPTH) / (site.depth - QUAY_DEPTH), 0, 1);
	// steepest a little way up, easing off towards the top
	return QUAY_HEIGHT + (site.top - QUAY_HEIGHT) * (f * f * (3 - 2 * f) * 0.6 + f * 0.4);
}
// and with the terraces: the rise gathered into a step between each street and the next. A terrace holds a street and the houses
//		on its uphill side (from a little below it to STREET_SPACING * 0.55 above), the step the houses on the downhill side of the next
//		street up, on their footings
function hillAt(site, v, terraces = 1) {
	const smooth = rampAt(site, v);
	if (v <= QUAY_DEPTH) return smooth;
	const k = (v - PROMENADE_V) / STREET_SPACING;
	const lo = Math.floor(k + 0.1) - 0.1;
	const a = rampAt(site, PROMENADE_V + (lo + 0.1) * STREET_SPACING), b = rampAt(site, PROMENADE_V + (lo + 1.1) * STREET_SPACING);
	const f = k - lo;
	const stepped = a + (b - a) * smoothstep(0.55, 0.95, f);
	return smooth + (stepped - smooth) * TERRACE_SHARE * terraces;
}

// The clusters (see THE CLUSTERS at the top), made once for a site: the main one round the middle and down to the water, the hamlets
//		round it, apart from each other
function placeClusters(site, seed) {
	if (site.clusters) return;
	const random = seededRandom(seed * 389 + site.number * 61 + 11);
	const between = ([a, b]) => a + (b - a) * random();
	// (round the water, where the town is across some: on both sides of it)
	const clusters = [{ u: site.across ? clamp(site.waterU, -0.4 * site.length, 0.4 * site.length) : (random() - 0.5) * 0.3 * site.length, v: site.depth * 0.3, ru: site.length * MAIN_CLUSTER[0], rv: site.depth * MAIN_CLUSTER[1], main: true }];
	const wantHamlets = Math.round(between(HAMLETS));
	for (let tries = 0; tries < 80 && clusters.length < wantHamlets + 1; tries++) {
		const ru = between(HAMLET_SIZE), c = { u: (random() * 2 - 1) * site.length * 0.92, v: (0.15 + random() * 0.75) * site.depth, ru, rv: ru * 0.85, main: false };
		if (clusters.some((o) => Math.hypot((c.u - o.u) / (o.ru + c.ru), (c.v - o.v) / (o.rv + c.rv)) < 1.15)) continue;
		clusters.push(c);
	}
	site.clusters = clusters;
	site.clusterNoise = createNoise(site.number * 17 + 3);
}
// how much of a cluster a place (u, v, and x, z in the world) is in, 0 to 1 (k: one of them, or the most of any)
function clusterOf(site, u, v, x, z, k = -1) {
	const ragged = 0.14 * site.clusterNoise(x / 90, z / 90)[0];
	let most = 0;
	site.clusters.forEach((c, j) => {
		if (k >= 0 && j != k) return;
		const e = Math.hypot((u - c.u) / c.ru, (v - c.v) / c.rv) + ragged;
		most = Math.max(most, 1 - smoothstep(0.72, 1.0, e));
	});
	return most;
}

/*
	The town's strength (0 to 1) and its ground over the sea at every grid point. g as findTownSites, and the sea's distance
	in world units at a point (seaAt). Returns { strength, height } grids, and each site gets strengthAt(x, z) and its inland distance v
*/
export function planTownGround(g, sites, seed) {
	const { points, cells, cellSize, half, sea, toSea, heights } = g;
	const strength = new Float32Array(points * points), height = new Float32Array(points * points);
	const noise = createNoise(seed * 13 + 5);
	for (const site of sites) {
		placeClusters(site, seed);
		const reach = Math.max(site.length, site.depth) + FADE_MOST + 35 + 60;		// (35: the most the ragged edge reaches out)
		const c0 = Math.max(Math.floor((site.x - reach + half) / cellSize), 0), c1 = Math.min(Math.ceil((site.x + reach + half) / cellSize), cells);
		const r0 = Math.max(Math.floor((site.z - reach + half) / cellSize), 0), r1 = Math.min(Math.ceil((site.z + reach + half) / cellSize), cells);
		for (let row = r0; row <= r1; row++) {
			for (let col = c0; col <= c1; col++) {
				const i = row * points + col;
				if (sea[i]) continue;
				const x = col * cellSize - half, z = row * cellSize - half;
				const dx = x - site.x, dz = z - site.z;
				const u = dx * site.tx + dz * site.tz, across = dx * site.nx + dz * site.nz;
				if (across < -60) continue;
				const v = toSea[i] * cellSize;
				const ragged = 35 * noise(x / 160, z / 160)[0];
				// (terraced where the houses are, a plain grassy slope between the clusters)
				const hill = hillAt(site, v, smoothstep(0.05, 0.4, clusterOf(site, u, v, x, z))) + 2.5 * noise(x / 70 + 9, z / 70 - 3)[0] * smoothstep(QUAY_DEPTH, QUAY_DEPTH + 30, v);
				// how far out of the core, and how wide the fade has to be there to come down to the land gently (or up to it, into a
				//		mountain the core was cut into). Out of it as well past its depth inland of the site's own shore (across): further
				//		along the coast another stretch of water (a bay) is near, but that is not this town's
				const beyond = Math.max(Math.abs(u) - site.length, v - site.depth, across - site.depth, 0);
				const out = beyond + Math.max(ragged, -beyond);
				const width = clamp(Math.abs(hill - heights[i]) / FADE_SLOPE, 60, FADE_MOST);
				const f = clamp(out / width, 0, 1);
				const s = (1 - f * f * f * (f * (f * 6 - 15) + 10)) * smoothstep(-60, -20, across);
				if (s <= strength[i]) continue;
				strength[i] = s;
				height[i] = hill;
			}
		}
	}
	return { strength, height };
}

//-------------------------------THE ROADS IN THE LAND-------------------------------
// Segments are 8 floats each: ax, az, ah (world y), bx, bz, bh, half width, kind (0 street, 1 lane, 2 stairs, 3 plaza, 4 promenade,
//		5 bridge: a road, but not cut into the land)
export const SEGMENT_FLOATS = 8;
const BUCKET = 32;
// Returns flatten(x, z, y) -> the land's world y there with the roads cut into it, and nearest(x, z) -> the road a point is on ({ y, kind, d }) or null
export function makeRoadFlattener(segments) {
	const buckets = new Map();
	const count = segments ? segments.length / SEGMENT_FLOATS : 0;
	for (let k = 0; k < count; k++) {
		const o = k * SEGMENT_FLOATS, w = segments[o + 6] + ROAD_EDGE;
		const x0 = Math.min(segments[o], segments[o + 3]) - w, x1 = Math.max(segments[o], segments[o + 3]) + w;
		const z0 = Math.min(segments[o + 1], segments[o + 4]) - w, z1 = Math.max(segments[o + 1], segments[o + 4]) + w;
		for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++) {
			for (let bz = Math.floor(z0 / BUCKET); bz <= Math.floor(z1 / BUCKET); bz++) {
				const key = bx * 100000 + bz;
				if (!buckets.has(key)) buckets.set(key, []);
				buckets.get(key).push(k);
			}
		}
	}
	const found = { y: 0, kind: 0, d: 0, weight: 0 };
	function nearest(x, z, cut = false) {
		const bucket = buckets.get(Math.floor(x / BUCKET) * 100000 + Math.floor(z / BUCKET));
		if (!bucket) return null;
		let best = -1, bestWeight = 0, bestD = Infinity;
		for (const k of bucket) {
			const o = k * SEGMENT_FLOATS;
			if (cut && segments[o + 7] == 5) continue;
			const ax = segments[o], az = segments[o + 1], bx = segments[o + 3], bz = segments[o + 4], hw = segments[o + 6];
			const ex = bx - ax, ez = bz - az, ll = ex * ex + ez * ez;
			const s = ll > 0 ? clamp(((x - ax) * ex + (z - az) * ez) / ll, 0, 1) : 0;
			const d = Math.hypot(x - ax - ex * s, z - az - ez * s);
			if (d > hw + ROAD_EDGE) continue;
			const weight = 1 - smoothstep(hw, hw + ROAD_EDGE, d);
			if (weight > bestWeight + 1e-6 || (Math.abs(weight - bestWeight) < 1e-6 && d < bestD)) {
				bestWeight = weight; bestD = d; best = k;
				found.y = segments[o + 2] + (segments[o + 5] - segments[o + 2]) * s;
				found.kind = segments[o + 7];
			}
		}
		if (best < 0) return null;
		found.d = bestD; found.weight = bestWeight;
		return found;
	}
	return {
		nearest,
		flatten(x, z, y) {
			if (count == 0) return y;
			const road = nearest(x, z, true);
			return road ? y + (road.y - y) * road.weight : y;
		},
	};
}

//-------------------------------THE LAYOUT-------------------------------
/*
	sites: findTownSites's. ground(x, z): the land's world y there, the town's hill in it but no roads yet. seaLevel, seed.
	strengthAt(x, z): the town's strength there. distanceToSea(x, z): world units. Returns { towns: [one per site, below], segments }
	A town: { site, streets: [{ points: [[x, y, z], ...], width }], links: [{ a: [x, y, z], b, width, stairs }], plaza: { x, y, z, tx, tz, size },
		buildings: [{ type (index into BUILDING_TYPES), x, y (floor), z, yaw, width, depth, floors, footing (world y of the bottom of its
		footings), plaster, roof, trim (colours), seed }], pier: { a: [x, y, z], b, width } or null, dock (as the pier: one town's, see DOCK) or
		null, lamps: [[x, y, z, yaw], ...],
		trees: [[x, z, species], ...], walls: [{ points: [[x, z, top, bottom], ...] }], quay: [[x, z, top], ...] }
*/
export function layoutTowns(sites, ground, strengthAt, distanceToSea, seaLevel, seed) {
	const segments = [];
	// (every town that can have a dock has one: DOCK)
	const towns = sites.map((site) => layoutTown(site, ground, strengthAt, distanceToSea, seaLevel, seededRandom(seed * 977 + site.number * 131 + 7), segments, true));
	return { towns, segments: new Float32Array(segments) };
}

function layoutTown(site, ground, strengthAt, distanceToSea, seaLevel, random, segments, wantDock = false) {
	const town = { site, streets: [], links: [], plaza: null, buildings: [], pier: null, dock: null, lamps: [], trees: [], walls: [], quay: [] };
	const debug = town.debug = { failed: {}, why: {} };
	const pick = (list) => list[Math.floor(random() * list.length)];
	const between = ([a, b]) => a + (b - a) * random();

	// a line across the town where the land is v from the sea: one point every 8 along the shore, found by stepping inland from the
	//		shore line (and broken where the town is too weak)
	const traceAt = (v) => {
		const pieces = [];
		let piece = [], last = 0;
		for (let u = -site.length; u <= site.length; u += 8) {
			const bx = site.x + site.tx * u, bz = site.z + site.tz * u;
			let lo = -120, hi = site.depth + 120;
			if (distanceToSea(bx + site.nx * lo, bz + site.nz * lo) > v || distanceToSea(bx + site.nx * hi, bz + site.nz * hi) < v) { if (piece.length) pieces.push(piece); piece = []; continue; }
			for (let k = 0; k < 18; k++) {
				const mid = (lo + hi) / 2;
				if (distanceToSea(bx + site.nx * mid, bz + site.nz * mid) < v) lo = mid; else hi = mid;
			}
			const x = bx + site.nx * lo, z = bz + site.nz * lo;
			if (strengthAt(x, z) < 0.62 || clusterAt(x, z) < 0.1) { if (piece.length) pieces.push(piece); piece = []; continue; }
			// (and where it jumps inland, round the head of an inlet: the water is bridged instead, see the bridges)
			if (piece.length && Math.abs(lo - last) > 40) { pieces.push(piece); piece = []; }
			last = lo;
			piece.push([x, 0, z]);
		}
		if (piece.length) pieces.push(piece);
		return pieces.filter((p) => p.length >= 4).map((p) => {
			// smoothed, so it winds gently, and its height the land's, smoothed along it
			for (let pass = 0; pass < 3; pass++) for (let k = 1; k < p.length - 1; k++) { p[k][0] = (p[k - 1][0] + 2 * p[k][0] + p[k + 1][0]) / 4; p[k][2] = (p[k - 1][2] + 2 * p[k][2] + p[k + 1][2]) / 4; }
			const raw = p.map(([x, , z]) => ground(x, z));
			p.forEach((point, k) => { let sum = 0, n = 0; for (let j = Math.max(k - 2, 0); j <= Math.min(k + 2, p.length - 1); j++) { sum += raw[j]; n++; } point[1] = sum / n; });
			return p;
		});
	};
	const addSegment = (a, b, width, kind) => segments.push(a[0], a[2], a[1], b[0], b[2], b[1], width / 2, kind);

	//---the clusters (placed with the hill, see placeClusters)
	const clusters = site.clusters;
	town.clusters = clusters;
	const clusterAt = (x, z, k = -1) => clusterOf(site, (x - site.x) * site.tx + (z - site.z) * site.tz, distanceToSea(x, z), x, z, k);

	//---the streets: the promenade, and the streets above it
	for (let k = 0; ; k++) {
		const v = PROMENADE_V + k * STREET_SPACING;
		if (v > site.depth * 0.86) break;
		const width = k == 0 ? PROMENADE_WIDTH : STREET_WIDTH;
		for (const points of traceAt(v)) {
			const street = { points, width, level: k };
			town.streets.push(street);
			for (let j = 0; j < points.length - 1; j++) addSegment(points[j], points[j + 1], width, k == 0 ? 4 : 0);
		}
	}
	if (town.streets.length == 0) return town;

	//---the bridges: a deck from a to b, every 6 or so a point, level with the roads at its ends and humped to clear the water
	town.bridges = [];
	const wetBetween = (a, b) => {
		const n = Math.max(Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 6), 2);
		let wet = 0;
		for (let k = 1; k < n; k++) if (ground(a[0] + (b[0] - a[0]) * k / n, a[2] + (b[2] - a[2]) * k / n) < seaLevel + 0.5) wet++;
		return wet;
	};
	const addBridge = (a, b, width) => {
		const len = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(Math.ceil(len / 6), 2);
		const line = (f) => a[1] + (b[1] - a[1]) * f;
		let low = Infinity;
		for (let k = 0; k <= n; k++) low = Math.min(low, line(k / n) - seaLevel);
		const hump = Math.max(len * 0.012, BRIDGE_CLEAR - low + 1);
		const points = [];
		for (let k = 0; k <= n; k++) {
			const f = k / n;
			points.push([a[0] + (b[0] - a[0]) * f, line(f) + hump * Math.sin(f * Math.PI), a[2] + (b[2] - a[2]) * f]);
		}
		town.bridges.push({ points, width });
		for (let k = 0; k < n; k++) addSegment(points[k], points[k + 1], width, 5);
	};
	// along each level, the end of one piece of street to the start of the next, where water is between them and the way is along the shore
	for (let k = 0; k <= Math.max(...town.streets.map((s) => s.level)); k++) {
		const pieces = town.streets.filter((s) => s.level == k);
		for (let j = 0; j < pieces.length - 1; j++) {
			const a = pieces[j].points[pieces[j].points.length - 1];
			let best = null;
			for (const next of pieces.slice(j + 1)) {
				const b = next.points[0], d = Math.hypot(b[0] - a[0], b[2] - a[2]);
				const along = Math.abs((b[0] - a[0]) * site.tx + (b[2] - a[2]) * site.tz) / Math.max(d, 1);
				if (d < BRIDGE_LONGEST && along > 0.75 && Math.abs(b[1] - a[1]) < d * 0.1 && wetBetween(a, b) >= 2 && (!best || d < best.d)) best = { b, d };
			}
			if (best) addBridge(a, best.b, Math.min(pieces[j].width, STREET_WIDTH));
		}
	}
	// and where the promenade goes round a bay: straight across its mouth, from the one headland to the other, where that is much
	//		shorter than the way round
	for (const street of town.streets.filter((s) => s.level == 0)) {
		const P = street.points, along = [0];
		for (let j = 1; j < P.length; j++) along.push(along[j - 1] + Math.hypot(P[j][0] - P[j - 1][0], P[j][2] - P[j - 1][2]));
		let best = null;
		for (let i = 0; i < P.length; i += 2) {
			for (let j = i + 8; j < P.length; j += 2) {
				const d = Math.hypot(P[j][0] - P[i][0], P[j][2] - P[i][2]);
				if (d < 50 || d > BRIDGE_LONGEST || along[j] - along[i] < 1.35 * d) continue;
				if (best && along[j] - along[i] - d <= best.saves) continue;
				const n = Math.max(Math.ceil(d / 6), 2);
				if (wetBetween(P[i], P[j]) < 0.55 * (n - 1)) continue;
				best = { a: P[i], b: P[j], saves: along[j] - along[i] - d };
			}
		}
		if (best) { addBridge(best.a, best.b, STREET_WIDTH); town.bridges.at(-1).fromQuay = true; }
	}

	const levels = Math.max(...town.streets.map((s) => s.level));
	//---the plaza: on a middle street, near the middle of the town, on its downhill side (built out over the slope on a wall), the library across the street from it
	//		(a few places along each middle street of the main cluster are tried, longest street first, for one where the largest
	//		library would stand: not dug into the hill behind it, out of the town, nor in the sea)
	const inMain = (s) => { const p = s.points[s.points.length >> 1]; return clusterAt(p[0], p[2], 0) > 0.6; };
	const middle = (s) => s.level >= 1 && s.level <= Math.max(levels - 1, 1);
	const middles = town.streets.filter((s) => s.level >= 1 && inMain(s)).sort((a, b) => (middle(b) - middle(a)) || (b.points.length - a.points.length));
	const plazaAt = (middle, at) => {
		const p = middle.points[at], q = middle.points[Math.min(at + 1, middle.points.length - 1)], o = middle.points[Math.max(at - 1, 0)];
		let tx = q[0] - o[0], tz = q[2] - o[2];
		const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
		let nx = -tz, nz = tx;
		if (nx * site.nx + nz * site.nz < 0) { nx = -nx; nz = -nz; }
		const uphill = [nx, nz];
		nx = -nx; nz = -nz;		// (the plaza goes out the other way)
		// (one wide segment along the street, with round ends: deep (in from the street) and long (along it) halves)
		const deep = 13, long = 22;
		const centre = [p[0] + nx * (deep + middle.width / 2 - 3), p[1], p[2] + nz * (deep + middle.width / 2 - 3)];
		return { x: centre[0], y: p[1], z: centre[2], tx, tz, nx, nz, deep, long, street: middle, at: p, uphill };
	};
	const libraryFits = (P) => {
		const back = P.street.width / 2 + 0.6, hw = 22, hd = 16;
		for (const [s, t] of [[-1, 0], [1, 0], [-1, 1], [1, 1], [0, 0.5], [0, 1]]) {
			const x = P.at[0] + P.tx * hw * s + P.uphill[0] * (back + 2 * hd * t), z = P.at[2] + P.tz * hw * s + P.uphill[1] * (back + 2 * hd * t);
			const y = ground(x, z);
			if (strengthAt(x, z) < 0.5 || y < seaLevel + 1.5 || y > P.y + 0.3 + 12 || y < P.y - 30) return false;
		}
		return true;
	};
	const first = 0.4 + 0.2 * random();
	let plaza = null;
	for (const middle of middles) {
		for (const f of [first, 0.5, 0.38, 0.62, 0.3, 0.7, 0.22, 0.78, 0.15, 0.85]) {
			const P = plazaAt(middle, Math.floor(middle.points.length * f));
			if (libraryFits(P)) { plaza = P; break; }
		}
		if (plaza) break;
	}
	if (!plaza && middles.length) plaza = plazaAt(middles[0], Math.floor(middles[0].points.length * first));
	if (plaza) {
		const { x, z, y, tx, tz, deep, long } = plaza;
		town.plaza = plaza;
		addSegment([x - tx * (long - deep), y, z - tz * (long - deep)], [x + tx * (long - deep), y, z + tz * (long - deep)], 2 * deep, 3);
	}

	//---the pier: out from the promenade into the sea, a third of the way along, to where it is a few metres deep (or further along,
	//		where a bridge is in the way)
	const promenade = town.streets.filter((s) => s.level == 0).sort((a, b) => b.points.length - a.points.length)[0];
	const nearBridge = (x, z, room) => town.bridges.some((br) => {
		const a = br.points[0], e = br.points[br.points.length - 1], dx = e[0] - a[0], dz = e[2] - a[2];
		const f = clamp(((x - a[0]) * dx + (z - a[2]) * dz) / (dx * dx + dz * dz), 0, 1);
		return Math.hypot(x - a[0] - dx * f, z - a[2] - dz * f) < br.width / 2 + room;
	});
	if (promenade) {
		const first = random() < 0.5 ? 0.25 : 0.72;
		for (const f of [first, 1 - first, 0.15, 0.85, 0.06, 0.94, 0.5]) {
			const p = promenade.points[Math.floor((promenade.points.length - 1) * f)];
			const a = [p[0] - site.nx * (PROMENADE_WIDTH / 2), p[1] - 0.25, p[2] - site.nz * (PROMENADE_WIDTH / 2)];
			// (out to where it is deep enough, and short of a bridge by the shack's length and some)
			const free = (s) => !nearBridge(a[0] - site.nx * s, a[2] - site.nz * s, 26);
			let length = 0;
			while (length < 110 && free(length + 4) && (length < 30 || ground(a[0] - site.nx * length, a[2] - site.nz * length) > seaLevel - 5)) length += 4;
			if (length < 22 && f != 0.5) continue;
			length = Math.max(length, 22);
			const b = [a[0] - site.nx * length, a[1], a[2] - site.nz * length];
			town.pier = { a, b, width: 7 };
			break;
		}
	}

	//---the dock (wantDock: where the schooners of npcShips.js tie up): a narrow jetty out from the promenade as the pier is, away
	//		from it and the bridges, out past where it is DOCK.depth deep (deep enough for her keel at its end), or none if it cannot get there
	if (promenade && wantDock) {
		for (const f of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
			const p = promenade.points[Math.floor((promenade.points.length - 1) * f)];
			const a = [p[0] - site.nx * (PROMENADE_WIDTH / 2), p[1] - 0.25, p[2] - site.nz * (PROMENADE_WIDTH / 2)];
			if (town.pier && Math.hypot(a[0] - town.pier.a[0], a[2] - town.pier.a[2]) < 40) continue;
			const free = (s) => !nearBridge(a[0] - site.nx * s, a[2] - site.nz * s, 16) && !(town.pier && Math.hypot(a[0] - site.nx * s - town.pier.b[0], a[2] - site.nz * s - town.pier.b[2]) < 30);
			let length = 0;
			while (length < DOCK.most && free(length + 4) && ground(a[0] - site.nx * length, a[2] - site.nz * length) > seaLevel - DOCK.depth) length += 4;
			if (length >= DOCK.most || !free(length + 4)) continue;
			length = Math.max(length + DOCK.past, DOCK.least);
			town.dock = { a, b: [a[0] - site.nx * length, a[1], a[2] - site.nz * length], width: DOCK.width };
			break;
		}
	}

	//---the buildings: along both sides of every street, shoulder to shoulder
	const placed = [];		// oriented boxes: { x, z, ax, az (along), hw, hd }
	const counts = new Map();
	const typeIndex = (name) => BUILDING_TYPES.findIndex((t) => t.name == name);
	let road = makeRoadFlattener(new Float32Array(segments));		// (made again once the links are in)
	const overlaps = (x, z, ax, az, hw, hd) => placed.some((b) => {
		if (Math.hypot(b.x - x, b.z - z) > Math.hypot(b.hw, b.hd) + Math.hypot(hw, hd)) return false;
		// separating axes: the two boxes' own axes
		for (const [px, pz] of [[ax, az], [-az, ax], [b.ax, b.az], [-b.az, b.ax]]) {
			const centre = Math.abs((b.x - x) * px + (b.z - z) * pz);
			const r1 = Math.abs(hw * (ax * px + az * pz)) + Math.abs(hd * (-az * px + ax * pz));
			const r2 = Math.abs(b.hw * (b.ax * px + b.az * pz)) + Math.abs(b.hd * (-b.az * px + b.ax * pz));
			if (centre > r1 + r2 - 0.2) return false;
		}
		return true;
	});
	// a building of a type at a place: x, z its middle, (ax, az) along the street, (fx, fz) out of its front. null if it does not fit
	const tryBuilding = (typeNumber, x, z, ax, az, fx, fz, width, depth, floorY, buried = 9) => {
		const hw = width / 2, hd = depth / 2;
		const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => [x + ax * hw * s + fx * hd * t, z + az * hw * s + fz * hd * t]);
		let low = Infinity, high = -Infinity;
		const no = (why) => { debug.why[why] = (debug.why[why] ?? 0) + 1; return null; };
		for (const [cx, cz] of [...corners, [x, z]]) {
			if (strengthAt(cx, cz) < 0.5) return no('weak');
			const y = ground(cx, cz);
			if (y < seaLevel + 1.5) return no('sea');
			low = Math.min(low, y); high = Math.max(high, y);
			// (on no road, but for the front corners, which stand at the street's edge)
		}
		// no road through it: points across it, back from the front
		for (let s = -0.8; s <= 0.8; s += 0.4) for (let t = -0.9; t <= 0.6; t += 0.3) {
			const r = road.nearest(x + ax * hw * s + fx * hd * t, z + az * hw * s + fz * hd * t);
			if (r && r.weight > 0.05) return no('road');
		}
		if (high > floorY + buried) return no('buried');
		if (low < floorY - 34) return no('stilts');
		if (overlaps(x, z, ax, az, hw + 0.3, hd + 0.3)) return no('overlap');
		const yaw = Math.atan2(fx, fz);		// its front (+z of the building) turned to face (fx, fz)
		const building = { type: typeNumber, x, y: floorY, z, yaw, width, depth, floors: 0, footing: low - 1.5, seed: random(),
			plaster: pick(PLASTERS), roof: pick(ROOFS), trim: pick(TRIMS) };
		placed.push({ x, z, ax, az, hw, hd });
		town.buildings.push(building);
		counts.set(typeNumber, (counts.get(typeNumber) ?? 0) + 1);
		return building;
	};
	const chooseType = (where) => {
		const choices = BUILDING_TYPES.map((t, k) => ({ t, k })).filter(({ t, k }) => (t.where == where || (where == 'water' && t.where == 'street')) && (t.weight > 0) && !(t.once && counts.get(k)));
		const total = choices.reduce((s, c) => s + c.t.weight * (c.t.where == where ? 1 : 0.6), 0);
		let r = random() * total;
		for (const c of choices) { r -= c.t.weight * (c.t.where == where ? 1 : 0.6); if (r <= 0) return c.k; }
		return choices[0].k;
	};

	// the library, across the street from the plaza, facing it
	if (town.plaza) {
		const P = town.plaza, t = BUILDING_TYPES[typeIndex('library')];
		const variant = Math.floor(random() * VARIANTS), { depth, width, floors } = variantSize(typeIndex('library'), variant);
		const made = tryBuilding(typeIndex('library'), P.at[0] + P.uphill[0] * (P.street.width / 2 + 0.6 + depth / 2), P.at[2] + P.uphill[1] * (P.street.width / 2 + 0.6 + depth / 2), P.tx, P.tz, -P.uphill[0], -P.uphill[1], width, depth, P.y + 0.3, 13);
		if (made) Object.assign(made, { variant, floors });
		else debug.library = JSON.stringify(debug.why);
	}
	// (not through a house already standing: the library)
	const crossesHouse = (a, b) => { for (let f = 0.1; f < 0.95; f += 0.05) { const x = a[0] + (b[0] - a[0]) * f, z = a[2] + (b[2] - a[2]) * f; if (placed.some((h) => Math.abs((x - h.x) * h.ax + (z - h.z) * h.az) < h.hw + 4 && Math.abs((x - h.x) * -h.az + (z - h.z) * h.ax) < h.hd + 4)) return true; } return false; };
	//---the links between them: from a point on one street to the nearest point of the next street up, every so often
	for (let k = 0; k < levels; k++) {
		const below = town.streets.filter((s) => s.level == k), above = town.streets.filter((s) => s.level == k + 1);
		for (const street of below) {
			let at = Math.floor(between([3, 8]));
			while (at < street.points.length - 3) {
				const a = street.points[at];
				// the nearest point of the streets above, a little to one side for some of them
				let best = null, bestD = Infinity;
				for (const up of above) for (const p of up.points) { const d = Math.hypot(p[0] - a[0], p[2] - a[2]); if (d < bestD) { bestD = d; best = p; } }
				if (best && bestD < STREET_SPACING * 1.8 && !crossesHouse(a, best) && clusterAt(a[0], a[2]) > 0.35 && clusterAt(best[0], best[2]) > 0.35) {
					const run = Math.hypot(best[0] - a[0], best[2] - a[2]), rise = Math.abs(best[1] - a[1]);
					const stairs = rise / Math.max(run, 1) > STAIRS_STEEPER;
					const width = stairs ? STAIR_WIDTH : LANE_WIDTH;
					town.links.push({ a: [...a], b: [...best], width, stairs });
					addSegment(a, best, width, stairs ? 2 : 1);
				}
				at += Math.max(Math.round(between(LINK_EVERY) / 8), 4);
			}
		}
	}

	//---the lanes: from each hamlet's streets to the nearest street of the rest of the town, a point every 10 across the land between
	town.lanes = [];
	const joined = new Set([0]);
	const streetsOf = (k) => town.streets.filter((s) => s.points.some((p) => clusterAt(p[0], p[2], k) > 0.5));
	for (let pass = 0; pass < clusters.length; pass++) {
		let best = null;
		clusters.forEach((c, k) => {
			if (joined.has(k)) return;
			for (const from of streetsOf(k)) for (const to of town.streets) {
				if (from === to || streetsOf(k).includes(to) || !to.points.some((p) => [...joined].some((j) => clusterAt(p[0], p[2], j) > 0.5))) continue;
				for (const a of from.points) for (const b of to.points) {
					const d = Math.hypot(a[0] - b[0], a[2] - b[2]);
					if (!best || d < best.d) best = { d, a, b, k };
				}
			}
		});
		if (!best) break;
		joined.add(best.k);
		const len = best.d, n = Math.max(Math.ceil(len / 10), 2), wiggle = (random() - 0.5) * Math.min(len * 0.25, 40);
		const ox = -(best.b[2] - best.a[2]) / len, oz = (best.b[0] - best.a[0]) / len;
		const points = [];
		const straight = wetBetween(best.a, best.b) > 0;		// (over water it goes straight)
		for (let k = 0; k <= n; k++) {
			const f = k / n, bend = straight ? 0 : Math.sin(f * Math.PI) * wiggle;
			const x = best.a[0] + (best.b[0] - best.a[0]) * f + ox * bend, z = best.a[2] + (best.b[2] - best.a[2]) * f + oz * bend;
			points.push([x, ground(x, z), z]);
		}
		points[0][1] = best.a[1]; points[points.length - 1][1] = best.b[1];
		// on land, in runs between the water, each its height the land's smoothed and its ends the streets'; bridged between the runs
		const runs = [];
		for (const p of points) {
			const dry = p[1] >= seaLevel + 1 || p === points[0] || p === points[points.length - 1];
			if (dry) { if (!runs.length || runs[runs.length - 1].broken) runs.push({ points: [] }); runs[runs.length - 1].points.push(p); }
			else if (runs.length) runs[runs.length - 1].broken = true;
		}
		if (runs.some((r, j) => j > 0 && Math.hypot(r.points[0][0] - runs[j - 1].points.at(-1)[0], r.points[0][2] - runs[j - 1].points.at(-1)[2]) > BRIDGE_LONGEST)) continue;
		for (const run of runs) {
			const P = run.points;
			for (let pass2 = 0; pass2 < 4; pass2++) for (let k = 1; k < P.length - 1; k++) P[k][1] = (P[k - 1][1] + 2 * P[k][1] + P[k + 1][1]) / 4;
		}
		runs.forEach((run, j) => {
			if (run.points.length >= 2) {
				town.lanes.push({ points: run.points, width: LANE_WIDTH });
				for (let k = 0; k < run.points.length - 1; k++) addSegment(run.points[k], run.points[k + 1], LANE_WIDTH, 1);
			}
			if (j > 0) addBridge(runs[j - 1].points.at(-1), run.points[0], LANE_WIDTH);
		});
	}

	road = makeRoadFlattener(new Float32Array(segments));

	// the shack, at the end of the pier, facing back along it
	if (town.pier) {
		const { a, b } = town.pier, t = BUILDING_TYPES[typeIndex('shack')];
		const variant = Math.floor(random() * VARIANTS), { depth, width } = variantSize(typeIndex('shack'), variant);
		const shack = { type: typeIndex('shack'), variant, x: b[0] - site.nx * (depth / 2 - 2), y: b[1] + 0.4, z: b[2] - site.nz * (depth / 2 - 2), yaw: Math.atan2(site.nx, site.nz),
			width, depth, floors: 0, footing: seaLevel - 4, seed: random(), plaster: pick(PLASTERS), roof: pick(ROOFS), trim: pick(TRIMS), onPier: true };
		town.buildings.push(shack);
		counts.set(shack.type, 1);
	}

	const bakeryAt = 0.35 + 0.3 * random();
	for (const street of town.streets) {
		const P = street.points;
		// arc length along it
		const along = [0];
		for (let j = 1; j < P.length; j++) along.push(along[j - 1] + Math.hypot(P[j][0] - P[j - 1][0], P[j][2] - P[j - 1][2]));
		const total = along[along.length - 1];
		const at = (s) => {
			let j = 0;
			while (j < P.length - 2 && along[j + 1] < s) j++;
			const f = clamp((s - along[j]) / Math.max(along[j + 1] - along[j], 1e-6), 0, 1);
			const a = P[j], b = P[j + 1];
			const tl = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
			return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, z: a[2] + (b[2] - a[2]) * f, tx: (b[0] - a[0]) / tl, tz: (b[2] - a[2]) / tl };
		};
		for (const side of [1, -1]) {
			// which way is uphill from the street, on this side
			const probe = at(total / 2);
			let ox = -probe.tz * side, oz = probe.tx * side;
			const uphill = ox * site.nx + oz * site.nz > 0;
			if (street.level == 0 && !uphill) continue;		// the sea side of the promenade is the quay
			let s = between([2, 10]);
			while (s < total - 8) {
				const where = street.level == 0 ? 'water' : 'street';
				let typeNumber = chooseType(where);
				// the bakery, once, a little way along a street above the promenade
				if (street.level >= 1 && !counts.get(typeIndex('bakery')) && s / total > bakeryAt && clusterAt(at(s).x, at(s).z, 0) > 0.5) typeNumber = typeIndex('bakery');
				const variant = Math.floor(random() * VARIANTS), { width, depth, floors } = variantSize(typeNumber, variant);
				const p = at(s + width / 2);
				ox = -p.tz * side; oz = p.tx * side;
				const setback = street.width / 2 + 0.4 + depth / 2;
				// (thinner towards the edge of its cluster, and none past it)
				const inCluster = clusterAt(p.x + ox * setback, p.z + oz * setback);
				if (inCluster < 0.25 || random() > 0.2 + inCluster) { s += 7; continue; }
				const made = tryBuilding(typeNumber, p.x + ox * setback, p.z + oz * setback, p.tx * side, p.tz * side, -ox, -oz, width, depth, p.y + 0.25);
				if (made) Object.assign(made, { level: street.level, variant, floors });
				else debug.failed[street.level] = (debug.failed[street.level] ?? 0) + 1;
				if (made) {
					s += width + (random() < 0.06 ? between([14, 20]) : between([0, 0.8]));
					if (random() < 0.5 && s < total) {
						// a tree in the gap, if there is one
					}
				} else {
					s += 4;
				}
			}
		}
	}

	//---the lamps: along every street, either side by turns, at the edge
	for (const street of town.streets) {
		let side = 1, since = 0;
		for (let j = 1; j < street.points.length; j++) {
			const a = street.points[j - 1], b = street.points[j];
			since += Math.hypot(b[0] - a[0], b[2] - a[2]);
			if (since < (street.level == 0 ? 22 : 30)) continue;
			since = 0;
			const tl = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
			const tx = (b[0] - a[0]) / tl, tz = (b[2] - a[2]) / tl;
			let ox = -tz * side, oz = tx * side;
			if (street.level == 0) { ox = -site.nx; oz = -site.nz; } else side = -side;	// (the promenade's are along the water)
			const off = street.width / 2 - 0.9;
			town.lamps.push([b[0] + ox * off, b[1], b[2] + oz * off, Math.atan2(ox, oz)]);
		}
	}
	// along the lanes, further apart
	for (const lane of town.lanes) {
		for (let j = 4; j < lane.points.length - 2; j += 5) {
			const a = lane.points[j - 1], b = lane.points[j + 1], p = lane.points[j];
			const tl = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, side = j % 10 < 5 ? 1 : -1;
			const ox = -(b[2] - a[2]) / tl * side, oz = (b[0] - a[0]) / tl * side;
			town.lamps.push([p[0] + ox * (lane.width / 2 + 0.6), p[1], p[2] + oz * (lane.width / 2 + 0.6), Math.atan2(ox, oz)]);
		}
	}
	// on the bridges: at each end and every 30 or so between, on either parapet by turns
	for (const bridge of town.bridges) {
		const P = bridge.points, every = 5;
		for (let j = 0; j < P.length; j += every) {
			const a = P[Math.max(j - 1, 0)], b = P[Math.min(j + 1, P.length - 1)];
			const tl = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, side = (j / every) % 2 ? 1 : -1;
			const ox = -(b[2] - a[2]) / tl * side, oz = (b[0] - a[0]) / tl * side, off = bridge.width / 2 - 0.6;
			town.lamps.push([P[j][0] + ox * off, P[j][1], P[j][2] + oz * off, Math.atan2(ox, oz)]);
		}
	}
	// and round the plaza
	if (town.plaza) {
		const P = town.plaza;
		for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) town.lamps.push([P.x + P.tx * s * (P.long - 6) + P.nx * t * (P.deep - 2), P.y, P.z + P.tz * s * (P.long - 6) + P.nz * t * (P.deep - 2), 0]);
	}

	//---the trees: wherever there is room for one in the town, off the roads and clear of the houses (the gaps, the corners, the plaza)
	for (let tries = 0; tries < 4000 && town.trees.length < 110; tries++) {
		const u = (random() * 2 - 1) * site.length * 1.1, w = random() * site.depth * 1.1;
		const x = site.x + site.tx * u + site.nx * w, z = site.z + site.tz * u + site.nz * w;
		if (strengthAt(x, z) < 0.3 || ground(x, z) < seaLevel + 2) continue;
		// (most round the edges of the clusters, fewer out on the open grass)
		const c = clusterAt(x, z);
		if (random() > (c > 0.05 && c < 0.7 ? 1 : 0.35)) continue;
		const r = road.nearest(x, z);
		if (r && r.weight > 0) continue;
		if (placed.some((b) => Math.abs((x - b.x) * b.ax + (z - b.z) * b.az) < b.hw + 4 && Math.abs((x - b.x) * -b.az + (z - b.z) * b.ax) < b.hd + 4)) continue;
		if (town.trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 12)) continue;
		town.trees.push([x, z, random() < 0.75 ? 'broadleaf' : 'birch']);
	}
	if (town.plaza) {
		const P = town.plaza;
		for (const s of [-1, 1]) town.trees.push([P.x + P.tx * s * (P.long - 3), P.z + P.tz * s * (P.long - 3), 'broadleaf']);
	}

	//---the walls: along every street's edges, where the land beside it is well above or below it and no house stands there
	const nearHouse = (x, z) => placed.some((b) => Math.abs((x - b.x) * b.ax + (z - b.z) * b.az) < b.hw + 1.5 && Math.abs((x - b.x) * -b.az + (z - b.z) * b.ax) < b.hd + 1.5);
	const edgeWalls = (points, width, parapet) => {
		for (const side of [1, -1]) {
			let wall = null;
			for (let j = 0; j < points.length; j++) {
				const a = points[Math.max(j - 1, 0)], b = points[Math.min(j + 1, points.length - 1)];
				const tl = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
				const ox = -(b[2] - a[2]) / tl * side, oz = (b[0] - a[0]) / tl * side;
				const p = points[j];
				const ex = p[0] + ox * (width / 2 + 0.3), ez = p[2] + oz * (width / 2 + 0.3);
				const beyond = ground(p[0] + ox * (width / 2 + ROAD_EDGE + 3), p[2] + oz * (width / 2 + ROAD_EDGE + 3));
				const drop = p[1] - beyond;
				const r = road.nearest(p[0] + ox * (width / 2 + ROAD_EDGE + 1), p[2] + oz * (width / 2 + ROAD_EDGE + 1));
				const wanted = Math.abs(drop) > 1.6 && !nearHouse(ex, ez) && !(r && r.weight > 0.5);
				if (wanted) {
					// higher land beside it: the wall holds it back, up to it. Lower: the wall holds the road up, with a parapet over it
					const top = drop < 0 ? beyond + 0.4 : p[1] + parapet, bottom = Math.min(beyond, p[1]) - 1.2;
					if (!wall) { wall = { points: [] }; town.walls.push(wall); }
					wall.points.push([ex, ez, top, bottom]);
				} else wall = null;
			}
		}
	};
	for (const street of town.streets) if (street.level > 0) edgeWalls(street.points, street.width, 1.1);
	for (const lane of town.lanes) edgeWalls(lane.points.slice(1, -1), lane.width, 1.0);
	for (const link of town.links) {
		const n = Math.max(Math.ceil(Math.hypot(link.b[0] - link.a[0], link.b[2] - link.a[2]) / 6), 2);
		const pts = Array.from({ length: n + 1 }, (_, k) => [0, 1, 2].map((i) => link.a[i] + (link.b[i] - link.a[i]) * k / n));
		edgeWalls(pts.slice(1, -1), link.width, 1.0);
	}
	town.walls = town.walls.filter((w) => w.points.length >= 2);
	// round the plaza, on its three open sides: it is built out over the slope, with a parapet
	if (town.plaza) {
		const P = town.plaza;
		const corner = (s, t) => [P.x + P.tx * s * P.long + P.nx * t * P.deep, P.z + P.tz * s * P.long + P.nz * t * P.deep];
		const edge = [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([s, t]) => corner(s, t));
		const points = [];
		for (let k = 0; k < 3; k++) {
			const [ax, az] = edge[k], [bx, bz] = edge[k + 1];
			const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 4);
			for (let j = (k == 0 ? 0 : 1); j <= n; j++) {
				const x = ax + (bx - ax) * j / n, z = az + (bz - az) * j / n;
				points.push([x, z, P.y + 1.1, Math.min(ground(x, z), P.y) - 1.2]);
			}
		}
		town.walls.push({ points });
	}
	//---the flowers: rose bushes in the gardens round the houses and along the lanes, tulip beds on the plaza and beside the roads
	town.roses = [];		// [x, y, z, size, seed]
	town.beds = [];			// { x, y, z, ax, az (along it), long, wide (halves), colour }
	const wallNear = (x, z, reach) => town.walls.some((w) => w.points.some(([wx, wz]) => Math.abs(wx - x) < reach && Math.abs(wz - z) < reach));
	const clearFor = (x, z, room) => {
		if (strengthAt(x, z) < 0.3 || ground(x, z) < seaLevel + 1.5) return false;
		const r = road.nearest(x, z);
		if (r && r.weight > 0) return false;
		if (placed.some((b) => Math.abs((x - b.x) * b.ax + (z - b.z) * b.az) < b.hw + room && Math.abs((x - b.x) * -b.az + (z - b.z) * b.ax) < b.hd + room)) return false;
		return !town.trees.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < 3.5) && !wallNear(x, z, 2);
	};
	// in the gardens: just out from a house's back or side
	const houses = town.buildings.filter((b) => !b.onPier);
	for (let tries = 0; tries < 3000 && town.roses.length < 140 && houses.length; tries++) {
		const b = pick(houses), ax = Math.cos(b.yaw), az = -Math.sin(b.yaw), fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
		const side = Math.floor(random() * 3), out = 1.6 + random() * 1.5;
		const [s, t] = side == 0 ? [(random() * 2 - 1) * b.width / 2, -(b.depth / 2 + out)] : [(side == 1 ? 1 : -1) * (b.width / 2 + out), (random() * 2 - 1) * b.depth / 2];
		const x = b.x + ax * s + fx * t, z = b.z + az * s + fz * t;
		if (!clearFor(x, z, 0.9) || town.roses.some(([rx, , rz]) => Math.hypot(rx - x, rz - z) < 2.6)) continue;
		town.roses.push([x, ground(x, z), z, 0.8 + 0.6 * random(), random()]);
	}
	// along the lanes, here and there
	for (const lane of town.lanes) {
		for (let j = 1; j < lane.points.length - 1; j++) {
			if (random() > 0.4) continue;
			const a = lane.points[j - 1], b = lane.points[j + 1], p = lane.points[j];
			const tl = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, side = random() < 0.5 ? 1 : -1;
			const x = p[0] - (b[2] - a[2]) / tl * side * (lane.width / 2 + 2.2), z = p[2] + (b[0] - a[0]) / tl * side * (lane.width / 2 + 2.2);
			if (clearFor(x, z, 0.9)) town.roses.push([x, ground(x, z), z, 0.8 + 0.6 * random(), random()]);
		}
	}
	// the tulip beds: two along the plaza's open edge, and on level grass beside the streets and lanes
	const bed = (x, y, z, ax, az, long, wide) => town.beds.push({ x, y, z, ax, az, long, wide, colour: Math.floor(random() * 6) });
	if (town.plaza) {
		const P = town.plaza;
		for (const s of [-1, 1]) bed(P.x + P.tx * s * P.long * 0.45 + P.nx * (P.deep - 2.6), P.y, P.z + P.tz * s * P.long * 0.45 + P.nz * (P.deep - 2.6), P.tx, P.tz, 3.6, 1.1);
	}
	const roadsides = [...town.streets.filter((s) => s.level > 0), ...town.lanes];
	for (const way of roadsides) {
		const P = way.points;
		for (let j = 2; j < P.length - 2 && town.beds.length < 28; j += 3) {
			if (random() > 0.45) continue;
			const a = P[j - 1], b = P[j + 1], p = P[j];
			const tl = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1, tx = (b[0] - a[0]) / tl, tz = (b[2] - a[2]) / tl, side = random() < 0.5 ? 1 : -1;
			const off = way.width / 2 + ROAD_EDGE + 1.6, x = p[0] - tz * side * off, z = p[2] + tx * side * off;
			const ends = [-1, 0, 1].map((e) => [x + tx * e * 3.2, z + tz * e * 3.2]);
			if (!ends.every(([ex, ez]) => clearFor(ex, ez, 1.2) && Math.abs(ground(ex, ez) - ground(x, z)) < 0.7)) continue;
			if (town.beds.some((o) => Math.hypot(o.x - x, o.z - z) < 10)) continue;
			bed(x, ground(x, z), z, tx, tz, 3.2, 1.0);
		}
	}

	// the quay: along the sea side of the promenade, from its top down into the water. Open where the pier leaves it
	for (const street of town.streets.filter((s) => s.level == 0)) {
		let edge = [];
		for (const p of street.points) {
			const ex = p[0] - site.nx * (street.width / 2 + 0.3), ez = p[2] - site.nz * (street.width / 2 + 0.3);
			// (or where a bridge goes out over it)
			const bridged = town.bridges.some((b) => {
				const a = b.points[0], e = b.points[b.points.length - 1], dx = e[0] - a[0], dz = e[2] - a[2];
				const f = clamp(((ex - a[0]) * dx + (ez - a[2]) * dz) / (dx * dx + dz * dz), 0, 1);
				return Math.hypot(ex - a[0] - dx * f, ez - a[2] - dz * f) < b.width / 2 + 2;
			});
			if (bridged || [town.pier, town.dock].some((pier) => pier && Math.hypot(ex - pier.a[0], ez - pier.a[2]) < pier.width / 2 + 2)) {
				if (edge.length >= 2) town.walls.push({ points: edge, quay: true });
				edge = [];
				continue;
			}
			edge.push([ex, ez, p[1] + 0.9, seaLevel - 3]);
		}
		if (edge.length >= 2) town.walls.push({ points: edge, quay: true });
	}
	return town;
}
