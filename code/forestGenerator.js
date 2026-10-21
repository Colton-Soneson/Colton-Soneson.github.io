/*
	Where the trees stand. Pure maths, no GPU in here: forest.js takes what this makes and puts it on screen.

	A forest is not trees dropped at random. Three things shape where they are, and each has its own part here:

		the site			What the ground is like decides how many trees it can carry and of which kind (see createSite).
							Trees crowd the gentle ground of the forest zone, thin out on to the grassland below and up the
							mountain above, stay off cliffs and the beach, and stop at the tree line. Clearings are left open.
							Conifers take the higher, steeper and colder ground, broadleaves the low and gentle.

		competition			Trees close together fight over light and water, and the losers die. What is left standing is
							spread out far more evenly than chance would do it: no two closer than their crowns allow.
							That is exactly what poisson disc sampling makes: random points with a least distance between them.
							Here the least distance is not one number, it changes with the site (thick or thin forest) and with the two
							trees themselves (two saplings can stand closer than two old oaks).

		the individual		No two trees are the same. Each gets its own age, size, turn, a slight lean, and one of a few
							different shapes of its species (the jitter and the transform perturbation).
*/

import { seededRandom, createNoise } from './terrainGenerator.js'
import { FOREST_THRESHOLD, MOUNTAIN_THRESHOLD } from './terrainGenerator.js'
import { TREE_SPECIES, heightFraction } from './treeGenerator.js'

export const SPRUCE = 0, PINE = 1, OAK = 2, BIRCH = 3;

// how much room a full grown tree of each species takes, next to the average. From the width of its crown
const SPECIES_ROOM = TREE_SPECIES.map((species) => 0.55 + 0.45 * species.crownRadius / 4.8);

const smoothstep = (edge0, edge1, x) => {
	const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
	return t * t * (3 - 2 * t);
};
const clamp01 = (x) => Math.min(Math.max(x, 0), 1);

//-------------------------------THE SITE-------------------------------
/*
	params: seed, maxSlope, coniferShare, seaLevel, beachHeight, bankHeight, snowLine (see the forest and terrain settings in settings.js)
	Returns site(x, z) -> what the ground at a world position is like for a tree. One object, reused every call:
		density		0 to 1. How much forest this ground carries: 0 none at all, 1 as thick as it gets
		conifer		0 to 1. The share of the trees here that are conifers
		pioneer		0 to 1. How open and exposed it is. Birch and pine are the first trees on to open ground, oak and spruce follow in their shelter
		standAge	0 to 1. Young regrowth to old growth: forest comes in patches of about the same age (a storm, a fire, a landslide)
		gap			about -1 to 1. Low where an old tree has come down and young ones are growing up in the light it left
		quality		0 to 1. How well a tree does here. Near the tree line they are stunted
*/
export function createSite(land, params) {
	const noise = createNoise(params.seed * 31 + 7);
	const half = land.cells * land.cellSize * 0.5;
	const out = { density: 0, conifer: 0, pioneer: 0, standAge: 0, gap: 0, quality: 0 };

	// a value from one of the land's grids at a world position, bilinear between the 4 grid points around it
	const sample = (grid, x, z, stride, offset) => {
		const gx = Math.min(Math.max((x + half) / land.cellSize, 0), land.cells - 0.0001), gz = Math.min(Math.max((z + half) / land.cellSize, 0), land.cells - 0.0001);
		const col = Math.floor(gx), row = Math.floor(gz), fx = gx - col, fz = gz - row;
		const i = (row * land.points + col) * stride + offset, down = land.points * stride;
		const top = grid[i] + (grid[i + stride] - grid[i]) * fx, bottom = grid[i + down] + (grid[i + down + stride] - grid[i + down]) * fx;
		return top + (bottom - top) * fz;
	};

	return function site(x, z) {
		out.density = 0;
		if (Math.abs(x) >= half || Math.abs(z) >= half) return out;
		// the ground kept clear round the buildings (placeBuildings in terrain.js): nothing grows there, and no seed comes up there either
		for (const clearing of land.clearings ?? []) {
			if ((x - clearing.x) ** 2 + (z - clearing.z) ** 2 < clearing.radius ** 2) return out;
		}
		// nor in a town: its trees are planted (see plantTownTrees). The forest thins out over the edge of one
		const town = land.townAt ? land.townAt(x, z) : 0;
		if (town > 0.55) return out;

		const mountain = sample(land.mountains, x, z, 1, 0);		// how far into a mountain range, the same number the zones are cut from
		const flatness = sample(land.normals, x, z, 3, 1);			// the y of the ground normal: 1 level, 0 a wall
		const height = sample(land.heights, x, z, 1, 0) - params.seaLevel;

		// the forest zone, with soft edges: scattered trees run out on to the grass below it and up on to the rock above it.
		//		Round the foot of every mountain range, and wherever the grassland is wooded
		//		(and neither carries on up the bare rock: both give out where the mountain proper starts)
		const belowRock = 1 - smoothstep(MOUNTAIN_THRESHOLD - 0.02, MOUNTAIN_THRESHOLD + 0.12, mountain);
		const aroundMountains = smoothstep(FOREST_THRESHOLD - 0.05, FOREST_THRESHOLD + 0.04, mountain) * belowRock;
		const zone = Math.max(aroundMountains, smoothstep(0.3, 0.7, sample(land.woodlands, x, z, 1, 0)) * belowRock);
		// slope: none on ground steeper than maxSlope, fewer as it gets near that
		const slope = smoothstep(1 - params.maxSlope - 0.1, 1 - params.maxSlope + 0.1, flatness);
		// nothing on the sand, and the tree line: it gets too cold and windy for trees some way under the snow
		const shore = smoothstep(params.beachHeight + params.bankHeight, params.beachHeight + params.bankHeight + 4, height);
		const treeLine = 1 - smoothstep(0.6 * params.snowLine, 0.85 * params.snowLine, height);
		// clearings: about a sixth of the forest is open glade, with only the odd tree in it
		const glade = noise(x / 230 + 17.3, z / 230 - 4.1)[0] + 0.5 * noise(x / 90 - 8.6, z / 90 + 31.9)[0];
		const open = 0.1 + 0.9 * smoothstep(-0.62, -0.3, glade);

		// and the ground round a lake is too wet for them
		const dryGround = 1 - smoothstep(0.1, 0.4, sample(land.marshes, x, z, 1, 0));

		out.density = zone * slope * shore * treeLine * open * dryGround * (1 - smoothstep(0.1, 0.55, town));
		out.quality = clamp01(0.35 + 0.65 * treeLine * (0.6 + 0.4 * slope));
		out.standAge = clamp01(0.5 + 0.75 * noise(x / 310 - 71.2, z / 310 + 12.7)[0]);
		out.gap = noise(x / 48 + 27.9, z / 48 - 63.4)[0];
		out.pioneer = clamp01(1.15 - 1.1 * zone * open + 0.5 * noise(x / 140 + 3.3, z / 140 + 55.1)[0]);
		// conifers: more of them the higher, steeper and further into the mountains it is. And in patches, forest is rarely an even mix
		out.conifer = clamp01(params.coniferShare + 0.9 * (smoothstep(0.18, 0.5, mountain) - 0.4) + 0.8 * (0.92 - flatness)
							+ 0.25 * smoothstep(0.3 * params.snowLine, 0.6 * params.snowLine, height) + 0.55 * noise(x / 260 + 91.4, z / 260 - 40.2)[0]);
		return out;
	};
}

// The least distance a tree keeps from its neighbours, before the site is counted in. It needs the room its crown takes:
//		a seedling next to none, a full grown tree all of it
export function treeRoom(species, age) {
	return SPECIES_ROOM[species] * (0.42 + 0.58 * heightFraction(TREE_SPECIES[species], age));
}

// Which tree comes up on a piece of ground, and how old the one standing there now is
function pickTree(where, random) {
	const conifer = random() < where.conifer;
	const pioneer = random() < where.pioneer;
	const species = conifer ? (pioneer ? PINE : SPRUCE) : (pioneer ? BIRCH : OAK);

	// Ages come in three lots: young trees, trees still putting on height, and full grown ones (which carry on for a long time).
	//		They are not mixed evenly. A sapling cant live in the shade under a grown tree, it comes up where one has fallen and
	//		let the light in. So the young stand together in the gaps, in patches about a crown or two across, with grown forest
	//		between them. An old stand has fewer gaps than a young one
	const full = TREE_SPECIES[species].fullGrownAge;
	const lot = where.gap + 0.5 * (where.standAge - 0.5) + 0.4 * (random() - 0.5);
	let age;
	if (lot < -0.42) age = full * (0.04 + 0.26 * random());
	else if (lot < -0.12) age = full * (0.3 + 0.4 * random());
	else age = full * 0.7 + (0.75 * TREE_SPECIES[species].lifespan - full * 0.7) * random();

	return { species: species, age: age };
}

// The individual: one tree of a species and an age at a spot, with everything that makes it not quite like the next one.
//		where: what site() said about the spot. Returns { x, y, z, species, variant, age, scale, yaw, leanX, leanZ, seed }
export function makeTree(x, z, species, age, where, land, params, random, variants) {
	const leanAngle = random() * 6.2832, lean = 0.05 * random() * random();
	return {
		x: x,
		y: land.heightAt(x, z) - 0.12 * params.unitsPerMetre,	// a little into the ground, so the foot never shows a gap on a slope
		z: z,
		species: species,
		variant: Math.floor(random() * variants),
		age: age,
		scale: (0.84 + 0.3 * random()) * (0.55 + 0.45 * where.quality),
		yaw: random() * 6.2832,
		leanX: Math.cos(leanAngle) * lean,
		leanZ: Math.sin(leanAngle) * lean,
		seed: random(),
	};
}

// The trees of the towns (townLayout.js): grown broadleaves where the layout left room for them, smaller than in the wild. They are
//		planted: they never die and drop no seed (see ForestLife), but they come into leaf and turn and drop it with the seasons as any other
export function plantTownTrees(land, params, variants) {
	const random = seededRandom(params.seed * 7919 + 4243);
	const out = [];
	for (const town of land.towns ?? []) {
		for (const [x, z, kind] of town.trees) {
			const species = kind == 'birch' ? BIRCH : OAK;
			const tree = makeTree(x, z, species, TREE_SPECIES[species].fullGrownAge * (1.1 + 0.6 * random()), { quality: 0.1 * random() }, land, params, random, variants);
			tree.planted = true;
			out.push(tree);
		}
	}
	return out;
}

//-------------------------------PLANTING-------------------------------
/*
	Poisson disc sampling, Bridson's method ("Fast Poisson Disk Sampling in Arbitrary Dimensions"), with a distance that varies.

	Keep a list of ACTIVE trees: ones that may still have room next to them. Take one at random and try a number of spots in the
	ring around it, between one and two times its distance away. A spot that is far enough from every tree already there gets
	a tree, which joins the active list. If none of the tries worked, there is no room left around that tree and it leaves the list.
	When the list is empty the ground is full: no gaps a tree would fit in, and no two trees too close.

	Checking a spot against every tree would be far too slow, so the trees are kept in a grid of buckets and only the buckets near the spot are looked in.

	The forest is in many separate pieces, and the list can only spread through one at a time, so it is started off with a tree
	tried every so often across the whole land.

	params adds: spacing (world units between full grown trees where the forest is thickest), maxTrees, unitsPerMetre
	Returns an array of trees: { x, y, z, species, variant, age, scale, yaw, leanX, leanZ, seed }
		variant				which of the shapes of its species it is, 0 to variants - 1
		scale				its size next to the average of its species
		leanX, leanZ		how far it leans, as sideways distance per unit of height
*/
export function plantForest(land, params, variants) {
	const random = seededRandom(params.seed * 7919 + 101);
	const site = createSite(land, params);
	const half = land.cells * land.cellSize * 0.5;

	const leastDensity = 0.06;									// ground that carries less forest than this carries none
	const farthest = params.spacing * 1.45 / Math.sqrt(leastDensity);	// the most room any tree asks for
	const bucketSize = params.spacing;
	const bucketsPerSide = Math.ceil(2 * half / bucketSize);
	const firstInBucket = new Int32Array(bucketsPerSide * bucketsPerSide).fill(-1);
	const nextInBucket = [];									// the trees in a bucket are a chain: each one says which is next

	const trees = [], room = [];
	const active = [];

	// the room a tree takes at a spot: its own, spread out where the site carries less forest.
	//		Young trees are planted with most of the room of a grown one, not the little they need: a thicket of saplings packed
	//		as tight as they will go thins itself out within a few decades, and a forest that starts that way starts by dying
	const roomAt = (tree, density) => params.spacing * Math.max(treeRoom(tree.species, tree.age), 0.8 * treeRoom(tree.species, Infinity)) / Math.sqrt(density);

	function tryPlant(x, z) {
		const where = site(x, z);
		if (where.density < leastDensity) return false;
		const picked = pickTree(where, random);
		const needs = roomAt(picked, where.density);

		// far enough from every tree near by? Two trees have to be the average of what each of them needs apart
		const reach = (needs + farthest) * 0.5;
		const fromCol = Math.max(Math.floor((x - reach + half) / bucketSize), 0), toCol = Math.min(Math.floor((x + reach + half) / bucketSize), bucketsPerSide - 1);
		const fromRow = Math.max(Math.floor((z - reach + half) / bucketSize), 0), toRow = Math.min(Math.floor((z + reach + half) / bucketSize), bucketsPerSide - 1);
		for (let row = fromRow; row <= toRow; row++) {
			for (let col = fromCol; col <= toCol; col++) {
				for (let other = firstInBucket[row * bucketsPerSide + col]; other >= 0; other = nextInBucket[other]) {
					const apart = (needs + room[other]) * 0.5;
					const dx = trees[other].x - x, dz = trees[other].z - z;
					if (dx * dx + dz * dz < apart * apart) return false;
				}
			}
		}

		const tree = makeTree(x, z, picked.species, picked.age, where, land, params, random, variants);

		const bucket = Math.floor((z + half) / bucketSize) * bucketsPerSide + Math.floor((x + half) / bucketSize);
		nextInBucket.push(firstInBucket[bucket]);
		firstInBucket[bucket] = trees.length;
		trees.push(tree);
		room.push(needs);
		active.push(trees.length - 1);
		return true;
	}

	// starting trees, tried on a loose grid over the whole land
	const startEvery = 56;
	for (let z = -half; z < half && trees.length < params.maxTrees; z += startEvery) {
		for (let x = -half; x < half && trees.length < params.maxTrees; x += startEvery) {
			tryPlant(x + random() * startEvery, z + random() * startEvery);
		}
	}

	// and fill in from them
	const tries = 20;
	while (active.length > 0 && trees.length < params.maxTrees) {
		const pick = Math.floor(random() * active.length);
		const from = trees[active[pick]], distance = room[active[pick]];
		let planted = false;
		for (let attempt = 0; attempt < tries && !planted; attempt++) {
			const angle = random() * 6.2832, away = distance * (1 + random());
			planted = tryPlant(from.x + Math.cos(angle) * away, from.z + Math.sin(angle) * away);
		}
		if (!planted) {
			active[pick] = active[active.length - 1];
			active.pop();
		}
	}

	return trees;
}
