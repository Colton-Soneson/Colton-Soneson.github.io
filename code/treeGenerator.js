/*
	Procedural trees. Pure maths, no GPU in here: forest.js takes what this makes and puts it on screen.

	A tree is made once, FULL GROWN, as a skeleton: a set of points, each joined to a parent point, from the root out to every twig.
	Three methods build it, each one doing the part it is good at:

		L-system					the trunk and everything regular about the branching. A string of symbols is rewritten over and over
									by a few rules ("the tip of the trunk becomes: a length of trunk, a ring of branches, and a new tip"),
									and the finished string is then read out as drawing commands for a turtle (see deriveLSystem, interpretLSystem).
									Conifers are nearly all L-system: a straight leader with whorls of branches is exactly what the rules describe.

		space colonization			the crown of the trees that dont have a regular one (oak, birch, the top of a pine). The space the crown
									should fill is scattered with points, and the branches grow towards whichever points are nearest to them,
									using the points up as they reach them. The branches end up sharing out the space the way real ones share
									out the light (see colonizeCrown). Runions, Lane, Prusinkiewicz: "Modeling Trees with a Space Colonization Algorithm"

		parametric arc sections		the skeleton is straight lines between points, a tree isnt. Runs of points along a branch are replaced by
									curves: each section is a quadratic bezier arc with a radius at each end (see buildSections).
									The sections are all the GPU gets. It turns each one into a tube, with as many sides and rings as the
									distance to the camera deserves (the tessellation, see vf_forest.js).

	Growing
		Every point of the skeleton also gets a BIRTH: the age of the tree at which the tree has grown out as far as that point.
		A real tree grows at its tips, and what it has already grown stays where it is and only gets thicker. So a young tree is not a
		small copy of an old one, it is the old one with everything not yet grown left out: draw only what has been born, and thicken
		each piece by how long ago that was. That is all the shader does, so one skeleton is the tree at every age.
		Branches low on the trunk also get a DEATH: in a forest they are shaded out and shed as the crown moves up (self pruning).

	Sizes in here are metres and ages are years, taken from the real trees. generateTree converts to world units at the end.
*/

import { seededRandom } from './terrainGenerator.js'

export const SECTION_FLOATS = 16;	// see buildSections for the layout
export const FOLIAGE_FLOATS = 16;	// see buildFoliage
export const NEVER = 1e9;			// a birth or death that doesnt happen

// what a piece of foliage is drawn as
export const FOLIAGE_LEAVES = 0;	// a clump of broad leaves
export const FOLIAGE_FROND = 1;		// a spray of needles along a branch (spruce)
export const FOLIAGE_TUFT = 2;		// a ball of long needles at the end of a twig (pine)

/*
	The trees. Sizes are for a tree grown in a forest (trees in the open are shorter and much wider).
		height, crownRadius		metres, full grown
		trunkDiameter			metres at chest height, full grown
		fullGrownAge			years to reach that height. It keeps getting thicker after that, not taller
		growth					[c, p] of the height curve, see heightFraction. p: how slow the start is, c: how early it levels off
		lifespan				years it lives, about. Some die long before, a few go on well past it (see deathChance in forestLife.js)
		shadeTolerance			0 to 1. How well it grows, and how well its seedlings come up, in the shade of other trees
		seedAge, seedsPerYear	the age it first sets seed, and how many a year are worth trying to grow (see seedSpots in forestLife.js)
		seedDistance			metres. How far its seeds travel, on average
		snagYears				about how long it stands dead and bare before it falls
		crownBase				how far up the trunk of a full grown tree the lowest living branches are (0 to 1)
		deadBranchLinger		how long a shed branch stays on the trunk as a bare stick, as a fraction of the tree's growth
		pipeExponent			how branch thickness adds up where branches join, see setRadii
*/
export const TREE_SPECIES = [
	{
		name: "spruce", conifer: true, foliage: FOLIAGE_FROND,
		height: 32, crownRadius: 4.0, trunkDiameter: 0.52, fullGrownAge: 90, growth: [3.0, 1.8],
		lifespan: 220, shadeTolerance: 0.8, seedAge: 30, seedsPerYear: 0.10, seedDistance: 30, snagYears: 6,
		crownBase: 0.40, deadBranchLinger: 0.22, pipeExponent: 2.3,
		barkColor: [0.26, 0.19, 0.15], barkColorHigh: [0.30, 0.22, 0.17], leafColor: [0.075, 0.200, 0.110], dryColor: [0.36, 0.17, 0.07],
	},
	{
		name: "pine", conifer: true, foliage: FOLIAGE_TUFT,
		height: 27, crownRadius: 4.4, trunkDiameter: 0.46, fullGrownAge: 80, growth: [3.0, 1.6],
		lifespan: 250, shadeTolerance: 0.2, seedAge: 20, seedsPerYear: 0.20, seedDistance: 40, snagYears: 8,
		crownBase: 0.62, deadBranchLinger: 0.10, pipeExponent: 2.2,
		barkColor: [0.27, 0.20, 0.16], barkColorHigh: [0.50, 0.29, 0.16], leafColor: [0.110, 0.235, 0.110], dryColor: [0.42, 0.22, 0.08],
	},
	{
		name: "oak", conifer: false, foliage: FOLIAGE_LEAVES,
		height: 24, crownRadius: 7.5, trunkDiameter: 0.80, fullGrownAge: 100, growth: [2.6, 1.6],
		lifespan: 320, shadeTolerance: 0.5, seedAge: 40, seedsPerYear: 0.10, seedDistance: 12, snagYears: 5,
		crownBase: 0.36, deadBranchLinger: 0.05, pipeExponent: 2.3,
		barkColor: [0.22, 0.18, 0.15], barkColorHigh: [0.25, 0.21, 0.17], leafColor: [0.135, 0.300, 0.085], dryColor: [0.40, 0.25, 0.09],
	},
	{
		name: "birch", conifer: false, foliage: FOLIAGE_LEAVES,
		height: 21, crownRadius: 3.4, trunkDiameter: 0.30, fullGrownAge: 45, growth: [3.4, 1.5],
		lifespan: 90, shadeTolerance: 0.15, seedAge: 12, seedsPerYear: 0.30, seedDistance: 60, snagYears: 2,
		crownBase: 0.40, deadBranchLinger: 0.04, pipeExponent: 2.4,
		barkColor: [0.80, 0.79, 0.74], barkColorHigh: [0.86, 0.85, 0.81], leafColor: [0.235, 0.400, 0.110], dryColor: [0.50, 0.36, 0.10],
	},
];

const TWIG_RADIUS = 0.012;		// metres. The thinnest a branch gets, at its tip

//-------------------------------SMALL VECTOR HELPERS-------------------------------
// vectors are [x, y, z] arrays
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a) => Math.hypot(a[0], a[1], a[2]);
const normalize = (a) => { const l = length(a); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]; };
const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const mix = (a, b, t) => a + (b - a) * t;
const radians = (degrees) => degrees * Math.PI / 180;

// v turned around axis (length 1) by angle (rodrigues' rotation formula)
function rotate(v, axis, angle) {
	const c = Math.cos(angle), s = Math.sin(angle), d = dot(axis, v) * (1 - c);
	const x = cross(axis, v);
	return [v[0] * c + x[0] * s + axis[0] * d, v[1] * c + x[1] * s + axis[1] * d, v[2] * c + x[2] * s + axis[2] * d];
}

// some direction at right angles to v
function anyPerpendicular(v) {
	return normalize(cross(v, Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
}

//-------------------------------HOW A TREE GAINS HEIGHT-------------------------------
/*
	Height of a tree at an age, as a fraction of its full grown height (0 to 1). This is the Chapman-Richards curve foresters fit to
	measured trees: slow as a seedling, fastest as a young tree, levelling off as it reaches its full height.
		height = (1 - e^(-c * age))^p		scaled here so it is exactly 1 at fullGrownAge
*/
export function heightFraction(species, age) {
	const [c, p] = species.growth;
	const u = clamp01(age / species.fullGrownAge);
	return Math.pow((1 - Math.exp(-c * u)) / (1 - Math.exp(-c)), p);
}

// the same curve the other way round: the age at which the tree reaches a fraction of its growth.
//		Past 1 (only used for how long dead branches hang on) it carries on in a straight line
export function ageAtGrowth(species, growth) {
	const [c, p] = species.growth;
	if (growth >= 1) {
		return species.fullGrownAge * (1 + (growth - 1) * 1.5);
	}
	return -Math.log(1 - Math.pow(clamp01(growth), 1 / p) * (1 - Math.exp(-c))) / c * species.fullGrownAge;
}

//-------------------------------L-SYSTEM-------------------------------
/*
	An L-system is a string of symbols and a set of rules that each replace one symbol with several. Applying every rule to the
	whole string at once, over and over, grows the string the way a plant grows: every tip that can do something does it, each step.

	The symbols here are modules: a letter and some numbers ({ s: 'F', p: [1.5] } is "forward 1.5"), which makes it a parametric
	L-system. The rules are functions, and they roll dice, which makes it a stochastic one: the same rules give a different tree per seed.

	rules: { letter: (numbers, random) => [modules that replace it] }. Letters without a rule are left as they are.
	Rewriting stops when nothing in the string has a rule left to apply.
*/
const m = (s, ...p) => ({ s: s, p: p });

function deriveLSystem(axiom, rules, random) {
	let modules = axiom;
	for (let generation = 0; generation < 500; generation++) {
		let rewritten = false;
		const next = [];
		for (const module of modules) {
			const rule = rules[module.s];
			if (!rule) {
				next.push(module);
				continue;
			}
			rewritten = true;
			for (const made of rule(module.p, random)) next.push(made);
		}
		modules = next;
		if (!rewritten) break;
	}
	return modules;
}

/*
	Reads the finished string as commands for a turtle: something with a position and a direction that draws as it moves.
	The turtle carries three directions at right angles: heading (the way it moves), left and up.
		F(length)		move forward and draw: this is what makes a skeleton point, joined to the point the turtle came from
		+(a) -(a)		turn left / right (around up)
		&(a) ^(a)		pitch down / up (around left)
		/(a)			roll (around heading)
		G(amount)		gravity: bend the heading towards straight down by this much. Negative bends it up
		[ ... ]			remember where the turtle is, do what is in the brackets, and come back: a branch
		S(attributes)	set what the points drawn from here on are marked as (see newNode), until the branch ends
	Angles are radians. The turtle starts at the origin heading straight up.
*/
function interpretLSystem(modules) {
	const nodes = [newNode([0, 0, 0], -1, {})];
	let turtle = { node: 0, p: [0, 0, 0], h: [0, 1, 0], l: [1, 0, 0], u: [0, 0, 1], marks: {} };
	const stack = [];

	for (const { s, p } of modules) {
		switch (s) {
			case 'F':
				turtle.p = add(turtle.p, mul(turtle.h, p[0]));
				nodes.push(newNode(turtle.p, turtle.node, turtle.marks));
				turtle.node = nodes.length - 1;
				break;
			case '+': turtle.h = rotate(turtle.h, turtle.u, p[0]);  turtle.l = rotate(turtle.l, turtle.u, p[0]);  break;
			case '-': turtle.h = rotate(turtle.h, turtle.u, -p[0]); turtle.l = rotate(turtle.l, turtle.u, -p[0]); break;
			case '&': turtle.h = rotate(turtle.h, turtle.l, p[0]);  turtle.u = rotate(turtle.u, turtle.l, p[0]);  break;
			case '^': turtle.h = rotate(turtle.h, turtle.l, -p[0]); turtle.u = rotate(turtle.u, turtle.l, -p[0]); break;
			case '/': turtle.l = rotate(turtle.l, turtle.h, p[0]);  turtle.u = rotate(turtle.u, turtle.h, p[0]);  break;
			case 'G':
				// bend, then square the other two directions back up against the new heading
				turtle.h = normalize(add(turtle.h, [0, -p[0], 0]));
				turtle.u = normalize(cross(turtle.l, turtle.h));
				turtle.l = normalize(cross(turtle.h, turtle.u));
				break;
			case '[':
				stack.push({ node: turtle.node, p: turtle.p, h: turtle.h, l: turtle.l, u: turtle.u, marks: turtle.marks });
				break;
			case ']':
				turtle = stack.pop();
				break;
			case 'S':
				turtle.marks = Object.assign({}, turtle.marks, p[0]);
				break;
		}
	}
	return nodes;
}

/*
	One point of the skeleton. What it can be marked with:
		level		0 the trunk, 1 a branch off it, 2 a branch off that
		speed		how fast this part of the tree gets longer, compared to the trunk getting taller (see setGrowth)
		pruneAt		the tree height (metres) at which this branch has been shaded out and dies. Infinity = it lives
		crown		the crown is allowed to grow on from this point (see colonizeCrown)
		leafy		this point carries foliage
*/
function newNode(p, parent, marks) {
	return {
		p: p, parent: parent,
		level: marks.level ?? 0, speed: marks.speed ?? 1, pruneAt: marks.pruneAt ?? Infinity,
		crown: marks.crown ?? false, leafy: marks.leafy ?? false,
		// filled in later
		children: [], radius: TWIG_RADIUS, reach: 0, growth: 0, deepest: 0, birth: 0, death: NEVER, woodDeath: NEVER,
	};
}

//-------------------------------SPACE COLONIZATION-------------------------------
/*
	Grows the crown on from the skeleton that is already there.

	1. scatter attraction points through the space the crown should fill (the envelope)
	2. every point pulls on the one skeleton point nearest to it, if that is within its influence distance
	3. every skeleton point that is being pulled grows a new point, one step long, in the average direction it is pulled in
	4. attraction points that a branch has got within the kill distance of are used up and removed
	5. repeat from 2 until there are no points left to pull, or nothing can grow

	Two branches never get the same attraction point, so they spread out and fill the envelope evenly without ever being told to,
	and where a branch has two groups of points pulling it different ways it forks.

	crown: {
		inside(p)				how far out a position is in the envelope: 0 at its middle, 1 on its surface, more than 1 outside
		min, max				a box around the envelope, to scatter in
		points					how many attraction points
		step					length of each piece of branch grown
		influence, kill			the two distances above
		inertia					how much a branch likes to keep going the way it was going (smoother branches)
		lift					pull straight up on every branch (the tree reaching for light)
	}
*/
function colonizeCrown(nodes, crown, random) {
	// 1. the attraction points. More of them towards the outside of the envelope, where the light and so the leaves are
	const points = [];
	for (let attempt = 0; attempt < crown.points * 60 && points.length < crown.points; attempt++) {
		const p = [mix(crown.min[0], crown.max[0], random()), mix(crown.min[1], crown.max[1], random()), mix(crown.min[2], crown.max[2], random())];
		const out = crown.inside(p);
		if (out > 1 || random() > 0.3 + 0.7 * out * out) continue;
		points.push(p);
	}
	const count = points.length;
	const alive = new Uint8Array(count).fill(1);
	// the skeleton point nearest each attraction point and how far it is. Kept between rounds: only the points grown
	//		in the last round can have got any nearer, so only those need checking against
	const nearest = new Int32Array(count).fill(-1);
	const nearestSquared = new Float64Array(count).fill(Infinity);

	let fresh = [];
	for (let i = 0; i < nodes.length; i++) if (nodes[i].crown) fresh.push(i);
	const children = nodes.map(() => []);

	for (let round = 0; round < 400 && fresh.length > 0; round++) {
		// 2. and 4.
		const pulls = new Map();	// skeleton point -> the sum of the directions it is pulled in
		for (let i = 0; i < count; i++) {
			if (!alive[i]) continue;
			const p = points[i];
			for (const n of fresh) {
				const q = nodes[n].p;
				const squared = (p[0] - q[0]) * (p[0] - q[0]) + (p[1] - q[1]) * (p[1] - q[1]) + (p[2] - q[2]) * (p[2] - q[2]);
				if (squared < nearestSquared[i]) { nearestSquared[i] = squared; nearest[i] = n; }
			}
			if (nearestSquared[i] < crown.kill * crown.kill) {
				alive[i] = 0;
				continue;
			}
			if (nearestSquared[i] < crown.influence * crown.influence) {
				const direction = normalize(sub(p, nodes[nearest[i]].p));
				const pull = pulls.get(nearest[i]);
				if (pull) { pull[0] += direction[0]; pull[1] += direction[1]; pull[2] += direction[2]; }
				else pulls.set(nearest[i], direction);
			}
		}

		// 3.
		fresh = [];
		for (const [n, pull] of pulls) {
			const node = nodes[n];
			let direction = normalize(pull);
			if (node.parent >= 0) {
				direction = add(direction, mul(normalize(sub(node.p, nodes[node.parent].p)), crown.inertia));
			}
			direction = normalize(add(direction, [0, crown.lift, 0]));
			const p = add(node.p, mul(direction, crown.step));

			// if it already grew a point just there (the same points pulling it the same way again) growing another does nothing
			if (children[n].some((child) => length(sub(nodes[child].p, p)) < crown.step * 0.4)) continue;

			nodes.push(newNode(p, n, { level: Math.max(node.level, 1) + (children[n].length > 0 ? 1 : 0), speed: crown.speed ?? 1, leafy: true }));
			children.push([]);
			children[n].push(nodes.length - 1);
			fresh.push(nodes.length - 1);
		}
	}
}

//-------------------------------THE FOUR TREES-------------------------------
// each returns the skeleton of one full grown tree, in metres. random is what makes two trees of a species different

// In a forest the crown is a shape that rides up the trunk as the tree grows: a branch lengthens while it is in the crown, and
//		is shaded out and dies once the crown base has gone past it. The crown base climbs slowly at first and faster later
//		(a young tree is green nearly to the ground, an old one in a closed forest has a long bare trunk): the bare share of the
//		trunk is taken to grow in step with the tree, reaching crownBase when it is full grown.
//		This is the height the tree has got to when the branch at height h on its trunk is shed
const shedHeight = (h, height, species) => Math.min(height, Math.sqrt(h * height / species.crownBase));
// how fast branches lengthen, next to the trunk gaining height: the pace that gives the crown its width
const branchSpeed = (height, species) => species.crownRadius / ((1 - species.crownBase) * height);
// So how long a branch that leaves the trunk at height h gets: what it can grow before it is shed or the tree stops growing.
//		The longest branches a full grown tree has are at its crown base, and the dead ones below that stopped while shorter
const branchLength = (h, height, species) => branchSpeed(height, species) * (shedHeight(h, height, species) - h);
// and the mark that gives a branch that life
const branchMarks = (h, height, species, more) => Object.assign({
	level: 1,
	speed: branchSpeed(height, species),
	pruneAt: h < species.crownBase * height ? shedHeight(h, height, species) : Infinity,
	leafy: true,
}, more);

// heights of the points up a trunk: close together at the bottom, where a seedling needs them, evenly spread further up
const trunkHeights = (height, count) => Array.from({ length: count + 1 }, (unused, i) => height * Math.pow(i / count, 1.25));

/*
	Spruce. Monopodial: one leader that never forks, a whorl of branches under each year's growth of it. Low branches droop
	and turn up again at the tip, high ones reach upwards. The branches fork flat, to either side, like a fern.
		A(i)		the tip of the trunk, i whorls up		->	trunk, a whorl of B, A(i + 1)
		B(l, all)	the tip of a branch with l still to go	->	a piece of branch, maybe a side shoot each side, B(l - piece)
*/
function growSpruce(species, random) {
	const height = species.height * (0.9 + 0.2 * random());
	const whorls = 28;
	const heights = trunkHeights(height, whorls);

	const rules = {
		A: ([i]) => {
			if (i >= whorls) return [];
			const h = heights[i + 1];
			const out = [m('+', (random() - 0.5) * 0.02), m('F', h - heights[i]), m('/', radians(137.5) + (random() - 0.5) * 0.5)];
			if (i < whorls - 1) {
				const inCrown = clamp01((h / height - species.crownBase) / (1 - species.crownBase));	// 0 at the crown base, 1 at the top
				const branches = inCrown > 0.85 ? 3 : (random() < 0.45 ? 5 : 4);
				for (let k = 0; k < branches; k++) {
					const reach = branchLength(h, height, species) * (0.8 + 0.3 * random());
					out.push(m('['), m('S', branchMarks(h, height, species)),
						m('/', (k + random() * 0.5) * 2 * Math.PI / branches), m('&', radians(mix(104, 55, inCrown)) + (random() - 0.5) * 0.2),
						m('B', reach, reach), m(']'));
				}
			}
			out.push(m('A', i + 1));
			return out;
		},
		B: ([left, all]) => {
			if (left < 0.25) return [];
			const piece = Math.min(left, 1.15);
			const along = 1 - left / all;	// 0 where the branch leaves the trunk, 1 at its tip
			const out = [m('F', piece), m('G', along < 0.55 ? 0.09 : -0.13), m('+', (random() - 0.5) * 0.12)];
			// side shoots, left and right in the flat of the branch
			if (left - piece > 0.9 && random() < 0.75) {
				const shoot = Math.min((left - piece) * 0.5, 1.5);
				out.push(m('['), m('S', { level: 2 }), m('+', radians(52)), m('F', shoot), m(']'));
				out.push(m('['), m('S', { level: 2 }), m('-', radians(52)), m('F', shoot), m(']'));
			}
			out.push(m('B', left - piece, all));
			return out;
		},
	};
	return interpretLSystem(deriveLSystem([m('A', 0)], rules, random));
}

/*
	Pine. The same leader and whorls while it is young, but the low branches are shed early and cleanly, and what is left is a
	long bare trunk with an irregular, flat topped crown. The crown is too untidy for rules, so it is grown by space colonization
	from the whorls that are still alive at the top.
*/
function growPine(species, random) {
	const height = species.height * (0.9 + 0.2 * random());
	const whorls = 20;
	const heights = trunkHeights(height * 0.9, whorls);		// the leader stops short of the top, the crown grows on over it
	const lean = (random() - 0.5) * 0.05;

	const rules = {
		A: ([i]) => {
			if (i >= whorls) return [];
			const h = heights[i + 1];
			// a pine trunk is rarely dead straight: a slight lean, and a wander from one year to the next
			const out = [m('+', lean + (random() - 0.5) * 0.07), m('&', (random() - 0.5) * 0.07), m('F', h - heights[i]), m('/', radians(137.5) + (random() - 0.5))];
			const inCrown = h > species.crownBase * height;
			const branches = inCrown ? 3 : 2;
			for (let k = 0; k < branches && i < whorls - 1; k++) {
				const reach = inCrown ? 1.6 + random() : branchLength(h, height, species) * (0.7 + 0.4 * random());
				out.push(m('['), m('S', branchMarks(h, height, species, inCrown ? { crown: true, speed: 1 } : {})),
					m('/', (k + random() * 0.6) * 2 * Math.PI / branches), m('&', radians(inCrown ? 62 : 82) + (random() - 0.5) * 0.3),
					m('B', reach), m(']'));
			}
			out.push(m('S', { crown: h > species.crownBase * height }), m('A', i + 1));
			return out;
		},
		B: ([left]) => {
			if (left < 0.3) return [];
			const piece = Math.min(left, 1.0);
			return [m('F', piece), m('G', -0.06), m('+', (random() - 0.5) * 0.3), m('B', left - piece)];
		},
	};
	const nodes = interpretLSystem(deriveLSystem([m('A', 0)], rules, random));

	// the crown: a wide, shallow dome sitting on top of the trunk
	const bottom = species.crownBase * height, top = height;
	const middle = [0, mix(bottom, top, 0.45), 0], radius = species.crownRadius * (0.9 + 0.2 * random());
	const squash = [1, 0.85 + 0.3 * random(), 0.8 + 0.4 * random()];	// not round: every pine crown is lopsided its own way
	colonizeCrown(nodes, {
		inside: (p) => {
			const x = (p[0] - middle[0]) / (radius * squash[0]), z = (p[2] - middle[2]) / (radius * squash[2]);
			const y = (p[1] - middle[1]) / (p[1] > middle[1] ? (top - middle[1]) : (middle[1] - bottom));
			return Math.sqrt(x * x + y * y + z * z);
		},
		min: [-radius * 1.3, bottom, -radius * 1.3], max: [radius * 1.3, top, radius * 1.3],
		points: 600, step: 0.8, influence: 5.5, kill: 1.4, inertia: 0.45, lift: 0.06,
	}, random);
	return nodes;
}

/*
	Oak. The trunk gives up being a trunk part way up and splits into a few great limbs (sympodial), which fork again and again.
	The rules make the trunk and the first forks of the limbs, the scaffold. The crown is grown on from that by space colonization.
		T(i)		the tip of the trunk			->	trunk, a small side branch (shed later), T(i + 1). At the top: the limbs
		L(l, n)		the tip of a limb, n forks in	->	a piece of limb, then two limbs a bit shorter, or nothing at all
*/
function growOak(species, random) {
	const height = species.height * (0.9 + 0.2 * random());
	const forkAt = species.crownBase * height * (0.9 + 0.25 * random());
	const pieces = 9;
	const heights = trunkHeights(forkAt, pieces);

	const rules = {
		T: ([i]) => {
			if (i >= pieces) {
				// the trunk ends in 3 or 4 limbs spread around it
				const limbs = random() < 0.5 ? 3 : 4, out = [m('S', { level: 1, crown: true })];
				for (let k = 0; k < limbs; k++) {
					out.push(m('['), m('/', (k + random() * 0.5) * 2 * Math.PI / limbs), m('&', radians(22 + 30 * random())),
						m('L', height * (0.16 + 0.07 * random()), 0), m(']'));
				}
				return out;
			}
			const h = heights[i + 1];
			const out = [m('+', (random() - 0.5) * 0.09), m('&', (random() - 0.5) * 0.09), m('F', h - heights[i]), m('/', radians(137.5) + (random() - 0.5))];
			// the side branches of a young oak, all gone from a full grown one
			const reach = branchLength(h, height, species) * (0.4 + 0.3 * random());
			if (reach > 0.4) {
				out.push(m('['), m('S', branchMarks(h, height, species, { speed: 0.3 })), m('/', random() * 6.28), m('&', radians(55 + 25 * random())), m('J', reach), m(']'));
			}
			out.push(m('T', i + 1));
			return out;
		},
		J: ([left]) => left < 0.3 ? [] : [m('F', Math.min(left, 0.9)), m('G', -0.05), m('+', (random() - 0.5) * 0.4), m('J', left - 0.9)],
		L: ([reach, forks]) => {
			const out = [];
			for (let piece = 0; piece < 3; piece++) {
				out.push(m('+', (random() - 0.5) * 0.3), m('&', (random() - 0.5) * 0.3), m('G', -0.05), m('F', reach / 3));
			}
			if (forks < 2) {
				out.push(m('['), m('/', random() * 6.28), m('&', radians(18 + 22 * random())), m('L', reach * (0.62 + 0.2 * random()), forks + 1), m(']'));
				out.push(m('['), m('S', { level: 2 }), m('/', random() * 6.28), m('^', radians(22 + 22 * random())), m('L', reach * (0.55 + 0.2 * random()), forks + 1), m(']'));
			}
			return out;
		},
	};
	const nodes = interpretLSystem(deriveLSystem([m('T', 0)], rules, random));

	// the crown: a broad dome, widest a bit below its middle, flatter underneath than on top
	const bottom = forkAt * 0.92, top = height;
	const middle = [(random() - 0.5) * 1.5, mix(bottom, top, 0.42), (random() - 0.5) * 1.5], radius = species.crownRadius * (0.88 + 0.24 * random());
	colonizeCrown(nodes, {
		inside: (p) => {
			const x = (p[0] - middle[0]) / radius, z = (p[2] - middle[2]) / radius;
			const y = (p[1] - middle[1]) / (p[1] > middle[1] ? (top - middle[1]) : (middle[1] - bottom));
			return Math.sqrt(x * x + y * y + z * z);
		},
		min: [middle[0] - radius, bottom, middle[2] - radius], max: [middle[0] + radius, top, middle[2] + radius],
		points: 950, step: 0.95, influence: 6.5, kill: 1.8, inertia: 0.35, lift: 0.04,
	}, random);
	return nodes;
}

/*
	Birch. A slender leader that carries on most of the way up, with thin branches rising steeply off it, and a narrow crown of
	fine twigs that hang at the ends. Leader and branches by the rules, the crown by space colonization, and the hanging
	twigs added on to the tips afterwards.
*/
function growBirch(species, random) {
	const height = species.height * (0.9 + 0.2 * random());
	const pieces = 16;
	const heights = trunkHeights(height * 0.84, pieces);
	const lean = (random() - 0.5) * 0.06;

	const rules = {
		T: ([i]) => {
			if (i >= pieces) return [];
			const h = heights[i + 1];
			const inCrown = h > species.crownBase * height;
			const out = [m('+', lean + (random() - 0.5) * 0.08), m('&', (random() - 0.5) * 0.08), m('F', h - heights[i]), m('/', radians(137.5) + (random() - 0.5))];
			for (let k = 0; k < (inCrown ? 2 : 1) && i < pieces - 1; k++) {
				const reach = inCrown ? 1.2 + 1.2 * random() : branchLength(h, height, species) * (0.5 + 0.4 * random());
				if (reach < 0.3) continue;
				out.push(m('['), m('S', branchMarks(h, height, species, { crown: inCrown, speed: inCrown ? 1 : 0.3 })),
					m('/', k * Math.PI + random()), m('&', radians(inCrown ? 38 : 55) + (random() - 0.5) * 0.3), m('J', reach), m(']'));
			}
			out.push(m('S', { crown: inCrown }), m('T', i + 1));
			return out;
		},
		J: ([left]) => left < 0.3 ? [] : [m('F', Math.min(left, 0.8)), m('G', -0.1), m('+', (random() - 0.5) * 0.3), m('J', left - 0.8)],
	};
	const nodes = interpretLSystem(deriveLSystem([m('T', 0)], rules, random));

	// the crown: tall and narrow, an egg standing on its wide end
	const bottom = species.crownBase * height, top = height;
	const middle = [0, mix(bottom, top, 0.4), 0], radius = species.crownRadius * (0.85 + 0.3 * random());
	colonizeCrown(nodes, {
		inside: (p) => {
			const y = (p[1] - middle[1]) / (p[1] > middle[1] ? (top - middle[1]) : (middle[1] - bottom));
			const x = (p[0] - middle[0]) / radius, z = (p[2] - middle[2]) / radius;
			return Math.sqrt(x * x + y * y + z * z);
		},
		min: [-radius, bottom, -radius], max: [radius, top, radius],
		points: 520, step: 0.8, influence: 5.0, kill: 1.5, inertia: 0.5, lift: 0.12,
	}, random);

	// the weeping twigs: every tip out at the edge of the crown gets a few more points that curl over and hang
	const tips = nodes.map((node, i) => i).filter((i) => nodes[i].leafy && !nodes.some((other) => other.parent == i));
	for (const tip of tips) {
		const node = nodes[tip];
		if (Math.hypot(node.p[0], node.p[2]) < radius * 0.35 || node.pruneAt < Infinity) continue;
		let direction = normalize(sub(node.p, nodes[node.parent].p)), last = tip;
		for (let piece = 0; piece < 3; piece++) {
			direction = normalize(add(direction, [0, -0.55, 0]));
			nodes.push(newNode(add(nodes[last].p, mul(direction, 0.55 + 0.25 * random())), last, { level: 3, leafy: true }));
			last = nodes.length - 1;
		}
	}
	return nodes;
}

const GROWERS = { spruce: growSpruce, pine: growPine, oak: growOak, birch: growBirch };

//-------------------------------FROM SKELETON TO TREE-------------------------------
// the crown is grown in straight steps, which zig zag. Each point that is just a link in a chain moves part way towards the middle of its two neighbours
function smoothSkeleton(nodes) {
	for (let pass = 0; pass < 2; pass++) {
		const moved = nodes.map((node) => node.p);
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			if (node.parent < 0 || node.children.length != 1 || node.level == 0) continue;
			const before = nodes[node.parent].p, after = nodes[node.children[0]].p;
			moved[i] = [node.p[0] * 0.5 + (before[0] + after[0]) * 0.25, node.p[1] * 0.5 + (before[1] + after[1]) * 0.25, node.p[2] * 0.5 + (before[2] + after[2]) * 0.25];
		}
		nodes.forEach((node, i) => { node.p = moved[i]; });
	}
}

/*
	When every point of the tree is grown, and when the shed ones die.

	The tree is taken to grow like a wave front leaving the root: reach is how far the front has to travel to get to a point,
	which is the length of the path from the root, except that the parts of the path that grow slower than the trunk count for more
	(a branch that grows at a third of the pace of the trunk is three times as "far"). The furthest point of all is where the
	tree is full grown, so growth = reach / the longest reach is 0 at the root, 1 at the last tip to finish.
	The height curve says at what age the tree has done that fraction of its growing, and that age is the point's birth.
*/
function setGrowth(nodes, species) {
	let furthest = 0;
	for (const node of nodes) {	// parents are always before their children in the list
		if (node.parent >= 0) {
			node.reach = nodes[node.parent].reach + length(sub(node.p, nodes[node.parent].p)) / node.speed;
		}
		furthest = Math.max(furthest, node.reach);
	}
	// how far the tree goes on beyond each point. Foliage is only kept near the tips, see buildFoliage
	for (let i = nodes.length - 1; i > 0; i--) {
		const node = nodes[i], parent = nodes[node.parent];
		parent.deepest = Math.max(parent.deepest, node.deepest + length(sub(node.p, parent.p)));
	}
	for (const node of nodes) {
		node.growth = node.reach / furthest;
		node.birth = ageAtGrowth(species, node.growth);
		if (node.pruneAt < Infinity) {
			// pruneAt was a height of the tree. The front is that far up the trunk when its reach is the same number
			const shed = node.pruneAt / furthest;
			node.death = ageAtGrowth(species, shed);
			node.woodDeath = ageAtGrowth(species, shed + species.deadBranchLinger);
		}
	}
	return furthest;
}

/*
	How thick everything is, full grown. Leonardo da Vinci's rule (the pipe model): where a branch forks, the cross sections of the
	forks add up to the cross section of the branch below them. Think of the tree as a bundle of pipes, one running from each twig
	all the way down to the root. With areas adding the exponent would be exactly 2, measured trees come out between 2 and 3:
		parent radius ^ n = the sum of each child radius ^ n
	So start every tip at twig thickness and add up towards the root. Then the whole lot is scaled to give the trunk the thickness
	the species should have, and the trunk is flared out where it meets the ground.
*/
function setRadii(nodes, species, height) {
	const n = species.pipeExponent;
	const pipes = new Float64Array(nodes.length);
	for (let i = nodes.length - 1; i >= 0; i--) {
		const node = nodes[i];
		if (node.children.length == 0) pipes[i] = Math.pow(TWIG_RADIUS, n);
		// branches that will have been shed by the time the tree is full grown are not holding the trunk's thickness up
		if (node.parent >= 0 && (node.pruneAt == Infinity || nodes[node.parent].pruneAt < Infinity)) {
			pipes[node.parent] += pipes[i];
		}
	}
	const rootRadius = Math.pow(pipes[0], 1 / n);
	const scale = (species.trunkDiameter * 0.5 - TWIG_RADIUS) / Math.max(rootRadius - TWIG_RADIUS, 1e-6);
	const crownBase = species.crownBase * height;
	for (let i = 0; i < nodes.length; i++) {
		const node = nodes[i];
		node.radius = TWIG_RADIUS + Math.max(Math.pow(pipes[i], 1 / n) - TWIG_RADIUS, 0) * scale;
		if (node.level == 0) {
			// the clear trunk under the crown has no branches leaving it to thin it, but it still tapers. And the flare at the foot
			node.radius *= 1 + 0.28 * Math.max(0, 1 - node.p[1] / crownBase);
			node.radius *= 1 + 0.4 * Math.exp(-node.p[1] / (0.03 * height));
		}
	}
}

/*
	Skeleton to parametric arc sections.

	The skeleton is first cut into chains: a chain follows a branch from where it starts to its tip, and at every fork it carries
	on along the thickest way (the others start chains of their own). Then each chain is cut into sections of a few skeleton
	points each, as many as fit before the branch has turned too far for one arc to follow.

	A section is a quadratic bezier: p0, p1, p2. p0 and p2 are skeleton points. p1, the control point, is placed so the arc leaves
	p0 and arrives at p2 heading the way the branch is heading at those points. Neighbouring sections share that heading, so they
	join without a kink.

	16 floats per section:
		 0  p0.xyz				 3  radius at p0, full grown
		 4  p1.xyz				 7  birth at p0 (years)
		 8  p2.xyz				11  radius at p2, full grown
		12  birth at p2			13  death: the age the wood is shed (NEVER if it isnt)		14  distance along the branch at p0 (for the bark)		15  level
*/
function buildSections(nodes, scale) {
	const sections = [];

	const trunk = thickest(nodes, 0);
	const chainStarts = nodes[0].children.map((child) => [0, child]);	// [the point it leaves from, its first own point]
	while (chainStarts.length > 0) {
		const [from, first] = chainStarts.pop();

		// walk the chain to its tip, starting other chains at the forks
		const chain = [from];
		for (let at = first; at >= 0; ) {
			chain.push(at);
			const next = thickest(nodes, at);
			for (const child of nodes[at].children) if (child != next) chainStarts.push([at, child]);
			at = next;
		}

		// which way the branch is heading at each point of the chain: from the point before to the point after
		const heading = chain.map((unused, i) => normalize(sub(nodes[chain[Math.min(i + 1, chain.length - 1)]].p, nodes[chain[Math.max(i - 1, 0)]].p)));
		// the thickness the chain has at each point. Its first point belongs to the branch it leaves from, which is thicker:
		//		the chain starts at its own thickness, with a bit of a collar
		const radius = chain.map((index, i) => i == 0 ? (first == trunk ? nodes[0].radius : nodes[chain[1]].radius * 1.15) : nodes[index].radius);

		let distance = 0;
		for (let a = 0; a < chain.length - 1; ) {
			// take in points until the branch has turned 26 degrees, or 4 (2 for the trunk, to keep its shape)
			const most = nodes[chain[1]].level == 0 ? 2 : 4;
			let b = a + 1;
			while (b < chain.length - 1 && b - a < most && dot(heading[a], heading[b + 1]) > 0.9) b++;

			const p0 = nodes[chain[a]].p, p2 = nodes[chain[b]].p;
			const reach = length(sub(p2, p0)) * 0.5;
			const p1 = mul(add(add(p0, mul(heading[a], reach)), sub(p2, mul(heading[b], reach))), 0.5);

			const start = nodes[chain[a]], end = nodes[chain[b]];
			sections.push([
				p0[0] * scale, p0[1] * scale, p0[2] * scale, radius[a] * scale,
				p1[0] * scale, p1[1] * scale, p1[2] * scale, start.birth,
				p2[0] * scale, p2[1] * scale, p2[2] * scale, radius[b] * scale,
				end.birth, end.woodDeath, distance * scale, end.level,
			]);
			distance += reach * 2;
			a = b;
		}
	}

	// thickest first. A level of detail then just draws the first so many: the trunk and limbs, without the twigs
	sections.sort((s, t) => Math.max(t[3], t[11]) - Math.max(s[3], s[11]));
	return sections;
}

// the child a branch carries on along: its thickest one
function thickest(nodes, i) {
	let best = -1;
	for (const child of nodes[i].children) {
		if (best < 0 || nodes[child].radius > nodes[best].radius) best = child;
	}
	return best;
}

/*
	Foliage. Not single leaves, there would be hundreds of thousands: each piece is a few flat cards that the fragment shader
	draws many leaves or needles on (see vf_forest.js).

	Every point of the skeleton gets a piece. It starts when the tree has grown as far as the point before, rides the growing tip
	out along the branch getting bigger, and is full size and in place when its own point is born. So whatever is growing is
	always green at the end, at any age.

	A broadleaf or a pine carries its foliage near its tips only: as the crown grows outwards the leaves it had further in are
	shaded by the new ones and dropped. So a piece is lost again once the tree has grown a few metres on past it.
	A spruce keeps its needles for years and is green nearly all the way along each branch, only the leader loses them.

	16 floats per piece:
		 0  middle.xyz				 3  birth (years): when it starts
		 4  U.xyz					 7  death (NEVER if it stays)
		 8  V.xyz					11  what it is drawn as (FOLIAGE_...)
		12  a random number			13  grown (years): when it is full size and in place
		14  ride: how far back along U it starts out from			15  height in the crown, 0 at its base to 1 at the top
	U and V are the two half edges of its main card. U runs along the branch, V across it.
*/
function buildFoliage(nodes, species, height, furthest, scale, random) {
	const foliage = [];
	const frond = species.foliage == FOLIAGE_FROND;
	const crownBase = species.crownBase * height;

	for (let i = 1; i < nodes.length; i++) {
		const node = nodes[i];
		const parent = nodes[node.parent];
		const edge = sub(node.p, parent.p);
		const direction = normalize(edge);
		let middle, u, v, ride, death = node.death;

		// metres back from the tips that the tree keeps its foliage. A spruce branch keeps all of it
		const depth = frond ? (node.level == 0 ? 1.4 : Infinity) : (species.foliage == FOLIAGE_TUFT ? 2.2 : 2.7);
		if (node.deepest > depth) {
			// the tree goes on growing past here: the foliage goes when it has got that depth beyond this point
			death = Math.min(death, ageAtGrowth(species, node.growth + (depth / node.speed) / furthest));
		} else if (!frond && node.children.length > 0 && random() < 0.3) {
			continue;	// not every twig point needs one, the clumps overlap
		}

		if (frond) {
			// along the piece of branch that ends at this point, and a bit over each end so they overlap into one long spray
			const width = (node.level == 0 ? 0.4 : node.level == 1 ? 0.95 : 0.7) * (0.85 + 0.3 * random());
			middle = mul(add(node.p, parent.p), 0.5);
			u = mul(edge, 0.62);
			v = mul(anyPerpendicular(direction), width);
			ride = length(edge) * 0.5;
		} else {
			const size = (species.foliage == FOLIAGE_TUFT ? 0.8 : (species.name == "oak" ? 0.95 : 0.72)) * (0.8 + 0.45 * random());
			middle = add(node.p, mul([random() - 0.5, random() - 0.5, random() - 0.5], 0.5));
			u = mul(normalize(add(direction, mul([random() - 0.5, random() - 0.5, random() - 0.5], 0.6))), size);
			v = rotate(mul(anyPerpendicular(u), size), normalize(u), random() * 6.28);
			ride = length(edge);
		}

		foliage.push([
			middle[0] * scale, middle[1] * scale, middle[2] * scale, parent.birth,
			u[0] * scale, u[1] * scale, u[2] * scale, death,
			v[0] * scale, v[1] * scale, v[2] * scale, species.foliage,
			random(), node.birth, ride * scale, clamp01((node.p[1] - crownBase) / (height - crownBase)),
		]);
	}

	// shuffled, so that the first so many are a fair sample of all of it, which is what a level of detail draws
	for (let i = foliage.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		const swap = foliage[i]; foliage[i] = foliage[j]; foliage[j] = swap;
	}
	return foliage;
}

/*
	One full grown tree of a species.
		speciesIndex		into TREE_SPECIES
		seed				the same seed is always the same tree
		unitsPerMetre		world units in a metre
	Returns
		sections			Float32Array, SECTION_FLOATS each, thickest first (see buildSections)
		foliage				Float32Array, FOLIAGE_FLOATS each, shuffled (see buildFoliage)
		height				world units, full grown
		crownRadius			world units: the furthest any living part gets from the trunk
		crownBottom			world units: the height of the lowest foliage a full grown tree has
		trunkRadius			world units, at the ground
*/
export function generateTree(speciesIndex, seed, unitsPerMetre) {
	const species = TREE_SPECIES[speciesIndex];
	const random = seededRandom(seed * 2654435761 + speciesIndex * 97 + 13);

	const nodes = GROWERS[species.name](species, random);
	nodes.forEach((node, i) => { if (node.parent >= 0) nodes[node.parent].children.push(i); });
	// a branch that was marked to be shed takes everything that grew from it along
	for (const node of nodes) {
		if (node.parent >= 0) node.pruneAt = Math.min(node.pruneAt, nodes[node.parent].pruneAt);
	}
	smoothSkeleton(nodes);

	let height = 0;
	for (const node of nodes) height = Math.max(height, node.p[1]);
	const furthest = setGrowth(nodes, species);
	setRadii(nodes, species, height);

	const sections = buildSections(nodes, unitsPerMetre);
	const foliage = buildFoliage(nodes, species, height, furthest, unitsPerMetre, random);

	let crownRadius = 0, crownBottom = height;
	for (const node of nodes) {
		if (node.pruneAt < Infinity || !node.leafy) continue;
		crownRadius = Math.max(crownRadius, Math.hypot(node.p[0], node.p[2]));
		crownBottom = Math.min(crownBottom, node.p[1]);
	}

	return {
		species: speciesIndex,
		sections: new Float32Array(sections.flat()),
		foliage: new Float32Array(foliage.flat()),
		height: height * unitsPerMetre,
		crownRadius: (crownRadius + 0.6) * unitsPerMetre,
		crownBottom: crownBottom * unitsPerMetre,
		trunkRadius: nodes[0].radius * unitsPerMetre,
	};
}
