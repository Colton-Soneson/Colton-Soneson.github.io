/*
	How the forest lives. Pure maths, no GPU in here: forest.js keeps the trees and calls these as its clock runs.

	Every tree is doing three things, and a forest is what they add up to:

		growing			as fast as the light it gets allows. A tree under taller neighbours is shaded and grows slowly, or hardly at all
						(see shadeAt, growthRate). How much shade it can stand is the main difference between the species:
						spruce and oak wait for decades in the shade of other trees, birch and pine need open sky.

		dying			of old age, more and more likely as it nears the age its species lives to. And long before that of shade:
						most trees that ever sprout are crowded out while young (self thinning), which is what keeps the grown
						trees apart (see deathChance). A dead tree dries out, stands bare for a while, and falls (see planFall).

		seeding			once it is old enough, every year. Seeds land near the tree, fewer the further out (see seedSpots), and
						one only comes up where there is room and light for it. So a gap left by a fallen tree fills with
						seedlings from around it: first the ones that need the light, with the patient ones coming up under them.

	That loop is forest succession, and nothing here says where trees should end up: the pattern comes out of the rules.
	Distances are world units, times are years.
*/

import { TREE_SPECIES, heightFraction } from './treeGenerator.js'

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);

//-------------------------------WHO IS NEAR-------------------------------
/*
	The trees sorted into square buckets of ground, so finding the neighbours of a spot only looks in the few buckets around it.
	Holds tree numbers (their place in forest.js's list), and has to be told when a tree is added or removed.
*/
export class TreeGrid {
	constructor(bucketSize) {
		this.bucketSize = bucketSize;
		this.buckets = new Map();
	}

	key(x, z) {
		// both bucket coordinates in one number (the world is far smaller than 100000 buckets across)
		return Math.floor(x / this.bucketSize) * 100000 + Math.floor(z / this.bucketSize);
	}

	add(index, x, z) {
		const key = this.key(x, z);
		const bucket = this.buckets.get(key);
		if (bucket) bucket.push(index);
		else this.buckets.set(key, [index]);
	}

	remove(index, x, z) {
		const bucket = this.buckets.get(this.key(x, z));
		if (!bucket) return;
		const at = bucket.indexOf(index);
		if (at >= 0) {
			bucket[at] = bucket[bucket.length - 1];
			bucket.pop();
		}
	}

	// calls visit(index) for every tree in the buckets that a circle touches. They can be a little outside the circle itself
	near(x, z, radius, visit) {
		const size = this.bucketSize;
		for (let bx = Math.floor((x - radius) / size); bx <= Math.floor((x + radius) / size); bx++) {
			for (let bz = Math.floor((z - radius) / size); bz <= Math.floor((z + radius) / size); bz++) {
				const bucket = this.buckets.get(bx * 100000 + bz);
				if (!bucket) continue;
				for (let i = 0; i < bucket.length; i++) visit(bucket[i]);
			}
		}
	}
}

//-------------------------------LIGHT-------------------------------
/*
	How shaded a point is by the trees around it, 0 (open sky) to 1 (deep shade).
		x, z, height		the point: for a tree, the top of it
		ignore				a tree number to leave out (the tree itself)
		trees				forest.js's list. Each needs: x, z, height (as it stands now), crownRadius (as it stands now), and to be alive
	Every taller tree whose crown is over the point takes some of its light: more the nearer its trunk, and more the higher
	it stands above the point (a neighbour only a little taller takes none: trees of about a height share the canopy).
	Their shade multiplies up, the way layers of leaves do.
*/
export function shadeAt(grid, trees, x, z, height, ignore) {
	let light = 1;
	grid.near(x, z, 26, (index) => {
		if (index == ignore) return;
		const tree = trees[index];
		if (!tree || tree.dead || tree.height <= height) return;
		const distance = Math.hypot(tree.x - x, tree.z - z);
		const cover = clamp01(1.3 - distance / Math.max(tree.crownRadius, 0.01));		// 1 right under it, 0 clear of the edge of its crown
		const above = clamp01(((tree.height - height) / (0.35 * tree.height + 1) - 0.25) / 0.75);	// 0 up in the canopy with it, 1 well underneath
		light *= 1 - 0.8 * cover * above;
	});
	return 1 - light;
}

// How fast a tree grows in an amount of shade: 1 = the full pace of its species, a year's growth every year.
//		A shade tolerant tree keeps most of its pace, an intolerant one all but stops
export function growthRate(species, shade) {
	return Math.max(1 - shade * (1 - 0.85 * species.shadeTolerance), 0.1);
}

//-------------------------------DEATH-------------------------------
/*
	The chance a tree dies during a number of years.

	Deaths are counted as a hazard: the chance of dying in one year, if it were to stay as it is. The hazards from every
	cause add up, and the chance of having died after some years is 1 - e^(-hazard x years), which is what makes it come out
	the same whether the tree is checked every year or once in ten.

		background		a little, always: wind, lightning, disease
		the first years	a seedling is easily lost
		shade			growing under more shade than its species can take. This is the one that thins a crowded stand
		old age			climbs steeply as the tree nears the age its species lives to: about 1 in 20 a year by then
*/
export function deathChance(species, age, shade, years) {
	let hazard = 0.0015;
	if (age < 5) hazard += 0.03;
	hazard += 0.1 * Math.max(shade - 0.25 - 0.6 * species.shadeTolerance, 0);
	hazard += 0.003 * Math.exp(6.5 * (age / species.lifespan - 0.55));
	return 1 - Math.exp(-hazard * years);
}

/*
	How a dead tree comes down. Returns
		dryYears		how long its foliage takes to brown and drop
		standYears		how long it then stands as a bare snag before it falls
		direction		which way it falls, radians (0 = +x)
		angle			how far over it goes before it is lying on the ground, radians. A quarter turn on the level, further when it falls downhill
	It falls mostly downhill, pushed a bit by the wind, and otherwise any way at all.
		groundNormal	[x, y, z] of the ground at its foot			wind	[x, z]
		heightAt(x, z)	the ground, to find how the slope runs under where it lands
*/
export function planFall(tree, species, groundNormal, wind, heightAt, random) {
	const any = random() * 6.2832;
	const windLength = Math.hypot(wind[0], wind[1]) || 1;
	const x = groundNormal[0] * 4 + wind[0] / windLength * 0.5 + Math.cos(any), z = groundNormal[2] * 4 + wind[1] / windLength * 0.5 + Math.sin(any);
	const direction = Math.atan2(z, x);

	// the ground half a tree length out in that direction: lower means it turns further before it lands
	const reach = Math.max(tree.height * 0.5, 1);
	const drop = heightAt(tree.x + Math.cos(direction) * reach, tree.z + Math.sin(direction) * reach) - heightAt(tree.x, tree.z);
	const angle = Math.min(Math.max(Math.PI * 0.5 - Math.atan2(drop, reach), 0.9), 2.2);

	return {
		dryYears: (species.conifer ? 5 : 3) * (0.7 + 0.6 * random()),
		standYears: species.snagYears * (0.4 + 1.2 * random()),
		direction: direction < 0 ? direction + 6.2832 : direction,
		angle: angle,
	};
}

//-------------------------------SEEDS-------------------------------
/*
	Where the seeds of a tree land over a number of years. Returns [[x, z], ...], most of the time nothing.
	Only the few seeds worth trying are made: a real tree drops thousands, and all but a handful land where nothing can come of them.
	How far they go is the species' own: an acorn drops under the oak or is carried a little way by a jay, birch seed blows a long way.
	The distances follow an exponential fall off (most near, a few far), which is what seed traps on the ground measure.
*/
export function seedSpots(tree, species, age, years, unitsPerMetre, random) {
	const spots = [];
	if (age < species.seedAge) return spots;
	let seeds = species.seedsPerYear * years * heightFraction(species, age);
	// the whole seeds, and one more with the chance of the fraction left over
	for (; seeds > 0; seeds--) {
		if (seeds < 1 && random() > seeds) break;
		const angle = random() * 6.2832;
		const distance = (tree.crownRadius * 0.5 - Math.log(1 - random()) * species.seedDistance * unitsPerMetre);
		spots.push([tree.x + Math.cos(angle) * distance, tree.z + Math.sin(angle) * distance]);
	}
	return spots;
}

// The chance a seed that has landed on a piece of ground comes up, from how well the ground suits its species (see createSite
//		in forestGenerator.js) and how much light gets down to it. shade: at the ground, from shadeAt
export function sproutChance(speciesIndex, where, shade) {
	const species = TREE_SPECIES[speciesIndex];
	const pioneer = speciesIndex == 1 || speciesIndex == 3;		// pine and birch
	const kind = species.conifer ? where.conifer : 1 - where.conifer;
	const suits = kind * kind * (pioneer ? 0.35 + 0.65 * where.pioneer : 1 - 0.85 * where.pioneer);
	// a seedling needs more light the less shade its species can take
	const light = clamp01((1 - shade - 0.6 * (1 - species.shadeTolerance)) / (0.4 * species.shadeTolerance + 0.1));
	return clamp01(0.15 + suits) * light;
}

//-------------------------------THE LOOP-------------------------------
/*
	Runs the three rules over the forest as its clock advances.

	Trees are not all updated every frame. They take turns: each tree is visited once every couple of years of the forest's
	clock, and is brought up to date for however long it has been since its last visit. Between visits a tree grows at the
	pace its last visit worked out (the GPU works its age out from that pace, so it still grows smoothly, see treeAge in vf_forest.js).

	forest: {
		trees				forest.js's list. A dead and gone tree leaves a hole (undefined), which the next new tree fills
		archetypes			[{ species, height, crownRadius }, ...] full grown sizes, for measuring a tree
		variants			how many archetypes each species has
		land, site			the ground: generateTerrain's result, and createSite's
		params				the planting params (spacing, unitsPerMetre, maxTrees...)
		wind				[x, z]
		makeTree, treeRoom	from forestGenerator.js
		random				seeded random number generator
		added(index), changed(index), removed(index, tree)		told whenever the list changes, so forest.js can keep the GPU's copy in step
	}

	What a living tree carries (on top of what planting gave it):
		age, ageTime, rate		its age was `age` when the clock said `ageTime`, and it has grown `rate` years a year since
		height, crownRadius		as it stands now
		room					the least distance it keeps from other trees now (see plantForest)
	and a dead one:
		dead, dryStart, dryYears, fallStart, fallDirection, fallAngle		see planFall. The times are on the forest's clock
*/
const VISIT_EVERY = 2.5;		// years of the forest's clock between a tree's visits
const LEAST_DENSITY = 0.06;		// ground that carries less forest than this carries none (the same as in plantForest)

export class ForestLife {
	constructor(forest) {
		Object.assign(this, forest);
		this.grid = new TreeGrid(24);
		this.holes = [];
		this.count = 0;				// trees in the list, dead ones still on show included
		this.turn = 0;				// whose visit is next
		this.owed = 0;				// visits not yet made
		this.fallYears = 0.01;		// how long falling over takes and how long a fallen tree lies before it is gone. forest.js sets these
		this.goneYears = 0.01;		//		from how fast the clock is running, so that both take a few seconds to watch
		this.farthest = this.params.spacing * 1.45 / Math.sqrt(LEAST_DENSITY);
		this.stats = { sprouted: 0, died: 0, fell: 0 };

		this.trees.forEach((tree, index) => {
			tree.ageTime = 0;
			tree.rate = 1;
			tree.visited = -this.random() * VISIT_EVERY;	// spread out, so they dont all come due together
			tree.density = Math.max(this.site(tree.x, tree.z).density, LEAST_DENSITY);
			this.measure(tree);
			this.grid.add(index, tree.x, tree.z);
			this.count++;
		});
		// a forest always has some dead wood standing in it: a few of the grown trees start out already dead, at every point from just browning to about to fall
		this.trees.forEach((tree) => {
			if (!tree.planted && tree.age > 0.8 * TREE_SPECIES[tree.species].fullGrownAge && this.random() < 0.025) {
				this.kill(tree, 0);
				const sooner = this.random() * (tree.fallStart - 0.2);
				tree.dryStart -= sooner;
				tree.fallStart -= sooner;
			}
		});
		this.stats.died = 0;
	}

	// Lets the forest live for some years before anyone sees it, up to clock 0. Planting only keeps trees apart: it knows nothing
	//		of shade, and puts far more saplings under grown trees than can live there. Left alone they would all die together
	//		in the first minutes. This gets that over with, and the dead of those years are fallen and gone by the time it is done
	settle(years) {
		const step = 2, fallYears = this.fallYears, goneYears = this.goneYears;
		this.fallYears = 0;
		this.goneYears = 0;
		for (const tree of this.trees) {
			tree.ageTime -= years;
			tree.visited -= years;
			if (tree.dead) { tree.dryStart -= years; tree.fallStart -= years; }
		}
		for (let clock = -years + step; clock <= 0; clock += step) {
			this.advance(clock, step);
		}
		this.fallYears = fallYears;
		this.goneYears = goneYears;
		this.stats = { sprouted: 0, died: 0, fell: 0 };
	}

	// a tree's age when the clock says so
	ageAt(tree, clock) {
		return tree.dead ? tree.age : tree.age + tree.rate * (clock - tree.ageTime);
	}

	// how big a tree stands at the age it has, and so how much room it takes
	measure(tree) {
		const species = TREE_SPECIES[tree.species], archetype = this.archetypes[tree.archetype];
		const grown = heightFraction(species, tree.age);
		tree.height = archetype.height * tree.scale * grown;
		tree.crownRadius = archetype.crownRadius * tree.scale * (0.25 + 0.75 * grown);
		// a dead tree holds little ground: seedlings come up right round a snag
		tree.room = this.params.spacing * this.treeRoom(tree.species, tree.age) / Math.sqrt(tree.density) * (tree.dead ? 0.35 : 1);
	}

	kill(tree, clock) {
		const species = TREE_SPECIES[tree.species];
		const fall = planFall(tree, species, this.land.normalAt(tree.x, tree.z), this.wind, this.land.heightAt, this.random);
		tree.dead = true;
		tree.rate = 0;
		tree.dryStart = clock;
		tree.dryYears = fall.dryYears;
		tree.fallStart = clock + fall.dryYears + fall.standYears;
		tree.fallDirection = fall.direction;
		tree.fallAngle = fall.angle;
		this.measure(tree);
		this.stats.died++;
	}

	// A seed has landed at x, z. A tree comes up if the ground carries forest, the seed gets enough light, and there is room
	sprout(speciesIndex, x, z, clock) {
		if (this.count >= this.params.maxTrees) return;
		const where = this.site(x, z);
		if (where.density < LEAST_DENSITY) return;
		if (this.random() > sproutChance(speciesIndex, where, shadeAt(this.grid, this.trees, x, z, 0, -1))) return;

		// room: the same rule the forest was planted by, two trees stand at least the average of what each needs apart
		const needs = this.params.spacing * this.treeRoom(speciesIndex, 0) / Math.sqrt(where.density);
		let crowded = false;
		this.grid.near(x, z, (needs + this.farthest) * 0.5, (index) => {
			const other = this.trees[index];
			if (crowded || !other) return;
			const apart = (needs + other.room) * 0.5;
			crowded = (other.x - x) * (other.x - x) + (other.z - z) * (other.z - z) < apart * apart;
		});
		if (crowded) return;

		const tree = this.makeTree(x, z, speciesIndex, 0.5, where, this.land, this.params, this.random, this.variants);
		tree.archetype = tree.species * this.variants + tree.variant;
		tree.ageTime = clock;
		tree.rate = 1;
		tree.visited = clock;
		tree.density = where.density;
		this.measure(tree);

		const index = this.holes.length > 0 ? this.holes.pop() : this.trees.length;
		this.trees[index] = tree;
		this.grid.add(index, x, z);
		this.count++;
		this.stats.sprouted++;
		this.added(index);
	}

	// one tree's turn
	visit(index, clock) {
		const tree = this.trees[index];
		if (!tree) return;
		const years = clock - tree.visited;
		tree.visited = clock;

		if (tree.dead) {
			// fallen and sunk away: it leaves the list
			if (clock > tree.fallStart + this.fallYears + this.goneYears) {
				this.grid.remove(index, tree.x, tree.z);
				this.trees[index] = undefined;
				this.holes.push(index);
				this.count--;
				this.stats.fell++;
				this.removed(index, tree);
			}
			return;
		}

		// grow: bring its age up to date at the pace it has had, then see how the light is now
		const species = TREE_SPECIES[tree.species];
		tree.age = this.ageAt(tree, clock);
		tree.ageTime = clock;
		this.measure(tree);
		const shade = shadeAt(this.grid, this.trees, tree.x, tree.z, tree.height, index);

		// a planted tree (a town's: see plantTownTrees in forestGenerator.js) lives on as it is, and seeds nothing
		if (tree.planted) {
			tree.rate = 1;
		} else if (this.random() < deathChance(species, tree.age, shade, years)) {
			this.kill(tree, clock);
		} else {
			tree.rate = growthRate(species, shade);
			for (const [x, z] of seedSpots(tree, species, tree.age, years, this.params.unitsPerMetre, this.random)) {
				this.sprout(tree.species, x, z, clock);
			}
		}
		this.changed(index);
	}

	// Call every frame. clock: the forest's clock now, years: how far it moved since the last call.
	//		Makes as many visits as that much time calls for, carrying on round the list from where it left off
	advance(clock, years) {
		this.owed += this.trees.length * years / VISIT_EVERY;
		const visits = Math.min(Math.floor(this.owed), this.trees.length);
		this.owed -= visits;
		for (let i = 0; i < visits; i++) {
			this.turn = (this.turn + 1) % this.trees.length;
			this.visit(this.turn, clock);
		}
	}
}
