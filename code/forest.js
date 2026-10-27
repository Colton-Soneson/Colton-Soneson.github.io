import {device} from './deviceSelection.js'
import { DEPTH_FORMAT, depthTest } from './depthMode.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { TREE_SPECIES, generateTree, heightFraction, ageAtGrowth, SECTION_FLOATS, FOLIAGE_FLOATS, NEVER } from './treeGenerator.js'
import { plantForest, plantTownTrees, createSite, makeTree, treeRoom } from './forestGenerator.js'
import { ForestLife, TreeGrid } from './forestLife.js'
import { seededRandom } from './terrainGenerator.js'

import { vf_forestWood } from '../shaders/js/vf_forest.js'
import { vf_forestFoliage } from '../shaders/js/vf_forest.js'
import { vf_forestBillboard } from '../shaders/js/vf_forest.js'
import { vf_forestAtlas } from '../shaders/js/vf_forest.js'
import { FOLIAGE_VERTICES } from '../shaders/js/vf_forest.js'
import { BILLBOARD_VERTICES } from '../shaders/js/vf_forest.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as horizon from './horizon.js'
import * as wind from './wind.js'
import { seasonNow } from './weather.js'
import { filteredSampler, filteringLevel } from './textureFiltering.js'

//the trees fade into the horizon color, read from the sky view LUT (same as the water, the land and the grass)
import {skyViewLUTtexture} from './atmosphere.js'
//and the forest keeps time by the sun
import {sunCycles} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	The forest on the land's forest zones. Four files make it, this one owns the result and draws it:
		treeGenerator.js		what a tree is: L-system, space colonization, arc sections, and how it grows
		forestGenerator.js		where the trees stand: poisson disc sampling over what the ground can carry
		forestLife.js			how they live: growing in the light they get, dying, falling, seeding
		vf_forest.js			the shaders: read its top for how hierarchical instancing and the tessellation work

	What is kept here
		archetypes		a few full grown trees of every species (VARIANTS of each). Every tree in the forest is one of these,
						at its own age and size. Each archetype's parts are stored once on the GPU
		the trees		one small record each on the GPU: where, how old, which archetype
		cells			the trees sorted into squares of ground, so whole squares can be skipped when they are behind the camera or too far off

	Every frame (forestPass)
		1. go through the cells in view, and sort each of their trees into a list by archetype, by how grown it is, and by
		   level of detail (how far off it is)
		2. each list is drawn with a few draw calls: its thick wood, its thin wood, its foliage. A draw call is "these trees x these parts"

	Levels of detail. The same tree, less of it and more coarsely made the further off it is:
		0	every branch and every piece of foliage, the wood finely tessellated
		1	the thicker branches, half the foliage (drawn bigger to cover the same), coarse tubes
		2	the trunk and limbs as a few flat sided tubes, a fifth of the foliage
		3	thinned: the same wood on fewer rings, a twelfth of the foliage in big pieces
		4	thinned further: the trunk and main limbs only, a thirtieth of the foliage. The step before the billboard
		5	a billboard: 2 flat cards with a picture of the tree on them
	3 and 4 are the thinned rings (forestThinnedRings): with fewer of them, the last one used runs on to the billboard distance.
	A level's parts are always the first so many of the level before it, so one turns into the next smoothly: over the last
	stretch of its distance the parts about to be left out shrink away (see towardsNextLevel in vf_forest.js).
	A billboard is nothing like a mesh though, so that swap is a dissolve: pixel by pixel the one is drawn less and the other more.

	Billboards (bakeBillboards)
		When the archetypes are made each one has its picture taken at a few ages, from the side and from above, into one big
		texture (the atlas). That is done with the real tree shaders, so a billboard is the tree it stands in for.

	Time (advanceForest)
		The forest has a clock, in years, and the sun drives it: every time the sun goes round (a sun cycle, a day) the
		clock moves on forestYearsPerSunCycle years. So the forest speeds up, slows down and stops with the sun.
		A tree's record on the GPU says how old it was at some moment and how fast it is growing, and the shaders work its age out
		from the clock. So every tree grows every frame for free, and a record is only written again when something about the
		tree changes: forestLife.js visits each tree every couple of years of the clock to see how it is doing.
*/

const VARIANTS = 3;			// different shapes of each species
const LEVELS = 5;			// levels of detail that are meshes. The billboards come after them
const THINNED_LEVELS = 2;	// the last of them, which are only used as far as forestThinnedRings says

// A tree is drawn from the parts list of the STAGE of life it is in: only the parts that exist at some time during that stage.
//		A sapling is a handful of parts, and there is no point running the vertex shader over the thousands it will have one day.
//		The ages a stage ends at, as a fraction of the age the tree is full grown
const STAGE_ENDS = [0.12, 0.3, 0.6, Infinity];
const STAGES = STAGE_ENDS.length;
// a tree is only moved on to its next stage when forestLife.js next visits it, which can be a few years late. So each stage's
//		list also has the parts of the years just either side of it
const STAGE_OVERLAP = 5;

// Tessellation: [sides around, rings along] each tube is cut into, for the thick wood and the thin wood of each level of detail.
//		null = not drawn at all. The trunk next to the camera gets 12 sides (round, and enough to show the roots swelling out),
//		the same trunk far off gets 4
const TESSELLATION = [
	{ thick: [12, 6], thin: [5, 3] },
	{ thick: [6, 3],  thin: [4, 1] },
	{ thick: [4, 2],  thin: null },
	{ thick: [4, 1],  thin: null },
	{ thick: [3, 1],  thin: null },
];
// and for the foliage: the share of the pieces that is drawn, and how much bigger each one is drawn to make up for the rest
const FOLIAGE_DETAIL = [[1.0, 1.0], [0.5, 1.4], [0.2, 2.1], [0.08, 3.2], [0.035, 4.8]];

const FADE_BAND = 0.25;				// the last part of a level's distance, over which it turns into the next (see towardsNextLevel in vf_forest.js)
const REFERENCE_HEIGHT = 22;		// metres. The level of detail distances are for a tree this tall, smaller trees drop detail sooner
const CELL_SIZE = 128;				// world units, the squares the trees are sorted into

// Billboards. How grown the tree is in each of an archetype's pictures (its height as a fraction of full grown).
//		A tree uses the first picture at least as grown as it is, see vf_forestBillboard
const BILLBOARD_GROWTHS = [0.1, 0.22, 0.38, 0.58, 0.8, 1.0];
const BILLBOARD_WIDTH = 96;			// pixels of one picture in the atlas. Trees are taller than wide, so it is twice as high
const BILLBOARD_HEIGHT = 192;
const BILLBOARD_OVERSIZE = 4;		// a picture is drawn this many times too big and shrunk into place, which smooths its edges
const ATLAS_COLUMNS = 12;			// pictures to a row of the atlas
const ATLAS_MIPS = 4;				// mip levels of the atlas. By the smallest a picture is 12 pixels wide, and any smaller they would run into each other
const CELL_FLOATS = 8;				// see the BillboardCell struct in vf_forest.js

// A dead tree's fall and its going back into the ground are things to watch, so they take the same few seconds however fast
//		the clock is running (and stop when it stops)
const FALL_SECONDS = 2.6;
const GONE_SECONDS = 7.0;
// but never longer than this on the clock, or with the clock running fast the dead would pile up faster than they went
const FALL_YEARS_MOST = 1.5;
const GONE_YEARS_MOST = 4.0;
const SETTLE_YEARS = 12;			// the forest lives this long before it is first shown, see ForestLife.settle
const REBASE_YEARS = 2000;			// see rebaseClock

const TREE_FLOATS = 16;				// see the Tree struct in vf_forest.js
const MAX_DRAWS = 1024;		// (5 levels of detail x 4 stages x every archetype, up to 3 draw calls each: rarely more than a few hundred are in view)
const DRAW_STRIDE = 256;			// bytes between one draw call's uniforms and the next (uniform buffer offsets have to be multiples of 256)

//time, for the wind
const startTime = performance.now();

// every setting the trees themselves depend on. If one of these changes the archetypes are made again
function getArchetypeParams() {
	return {
		seed: settings.forestSeed,
		unitsPerMetre: settings.forestUnitsPerMetre,
	};
}

// and every setting where they stand depends on. If one of these changes (or the land does) the forest is planted again
function getPlantingParams() {
	return {
		seed: settings.forestSeed,
		unitsPerMetre: settings.forestUnitsPerMetre,
		spacing: settings.forestTreeSpacing,
		maxSlope: settings.forestMaxSlope,
		coniferShare: settings.forestConiferShare,
		maxTrees: settings.forestMaxTrees,
		seaLevel: settings.waterWorldPosY,
		beachHeight: settings.terrainBeachHeight,
		bankHeight: settings.terrainBankHeight,
		snowLine: settings.terrainSnowLine,
	};
}

export let archetypes = [];			// see buildArchetypes
export let trees = [];				// see plantForest in forestGenerator.js. forest.js adds: archetype, stage, detailScale. Has holes (undefined) where trees have gone
export let life;					// the ForestLife that runs them, see forestLife.js
export let clock = 0;				// the forest's clock, in years since it was planted
let clockBase = 0;					// the clock time the GPU counts from, see rebaseClock
let countedSunCycles = sunCycles;	// the sun cycles the clock has already been moved on for
let yearsPerSecond = 0;				// how fast the clock has been running lately
let lastAdvance = performance.now();
let treeData = new Float32Array(0);	// every tree's GPU record, kept here too so one can be changed and sent on its own
let changedTrees = [];				// the trees whose record has to be sent again this frame
let treesMoved = true;				// a tree came, went, or changed its stage or size since the draw calls were last worked out (see sortTreesIntoDraws)
// A tree that came or went near the camera has the draw calls worked out again at once. Further off, where trees are billboards,
//		the next refresh will do (DRAWS_REFRESH): with the life cycle running, one comes or goes somewhere in the forest every frame
function noteMoved(tree) {
	const away = Math.hypot(tree.x - settings.camPosX, tree.y - settings.camPosY, tree.z - settings.camPosZ);
	if (away < settings.forestBillboardDistance * 1.5) treesMoved = true;
}
export const forestStats = { trees: 0, drawn: new Array(LEVELS + 1).fill(0), drawCalls: 0, triangles: 0, hiddenCells: 0 };	// what the last frame drew (trees per level of detail, billboards last), for anyone who wants to show it
let cells = [];						// the squares of ground with trees in them, for skipping whole squares that are out of view
let cellsByKey = new Map();

let sectionBuffer, foliageBuffer, archetypeBuffer, treeBuffer, visibleBuffer, cellBuffer;
let atlasColorTexture, atlasShapeTexture;	// the billboard pictures, see bakeBillboards
let forestBindGroup;
let forestBindGroupFiltering = filteringLevel();	//the level the atlas sampler in it is at. It is made again when the setting moves
let visibleData = new Uint32Array(0);

let builtArchetypeParams = "";		// the params the current archetypes were made from
let plantedParams = "";				// and the ones the current forest was planted from
let plantedLand;					// and the land it was planted on
let pendingParams = "";				// the ones waiting to be made, see forestUpdate
let pendingSince = 0;

// A storage buffer holding data, replacing the old one if there was one
function createStorageBuffer(label, data, old) {
	if (old) {
		old.destroy();
	}
	const buffer = device.createBuffer({
		label: label,
		size: Math.max(data.byteLength, 64),	// never empty, a buffer of size 0 cant be bound
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(buffer, 0, data);
	return buffer;
}

//-------------------------------ARCHETYPES-------------------------------
// How big a tree (from generateTree) is at an age: how far it reaches out from its trunk, how high its top is, and how high
//		its lowest foliage is. Found by growing every part to that age, the same way the vertex shaders do
function treeBoxAt(tree, age) {
	let reach = 0, top = 0, crownBottom = Infinity;
	const take = (x, y, z, size) => {
		reach = Math.max(reach, Math.hypot(x, z) + size);
		top = Math.max(top, y + size);
	};
	for (let i = 0; i < tree.sections.length; i += SECTION_FLOATS) {
		const s = tree.sections, bornStart = s[i + 7], bornEnd = s[i + 12];
		if (age <= bornStart || age >= s[i + 13]) continue;
		// the two ends of as much of the curve as has grown
		const t = Math.min((age - bornStart) / Math.max(bornEnd - bornStart, 0.0001), 1), u = 1 - t;
		take(s[i], s[i + 1], s[i + 2], 0);
		take(u * u * s[i] + 2 * u * t * s[i + 4] + t * t * s[i + 8], u * u * s[i + 1] + 2 * u * t * s[i + 5] + t * t * s[i + 9], u * u * s[i + 2] + 2 * u * t * s[i + 6] + t * t * s[i + 10], 0);
	}
	for (let i = 0; i < tree.foliage.length; i += FOLIAGE_FLOATS) {
		const f = tree.foliage;
		if (age <= f[i + 3] || age >= f[i + 7]) continue;
		const grown = Math.min((age - f[i + 3]) / Math.max(f[i + 13] - f[i + 3], 0.0001), 1);
		const along = Math.hypot(f[i + 4], f[i + 5], f[i + 6]), size = (along + Math.hypot(f[i + 8], f[i + 9], f[i + 10])) * 0.75;
		const back = f[i + 14] * (1 - grown) / Math.max(along, 0.0001);
		take(f[i] - f[i + 4] * back, f[i + 1] - f[i + 5] * back, f[i + 2] - f[i + 6] * back, size);
		crownBottom = Math.min(crownBottom, f[i + 1] - f[i + 5] * back);
	}
	return { reach: reach, top: top, crownBottom: Math.min(Math.max(crownBottom, 0), top) };
}

// the radius a section has got to (at its thicker end) at an age of the tree. The same sum the vertex shader does
function sectionRadiusAt(sections, i, age, fullGrownAge, twig) {
	const thicken = (radius, born) => twig + Math.max(radius - twig, 0) * Math.pow(Math.min(Math.max((age - born) / Math.max(fullGrownAge - born, 0.001), 0), 1), 0.9);
	return Math.max(thicken(sections[i + 3], sections[i + 7]), thicken(sections[i + 11], sections[i + 12]));
}

/*
	Makes the trees every tree in the forest is a copy of, and puts their parts on the GPU.

	Each archetype's parts are stored once per stage of life (see STAGE_ENDS), each time only the parts that exist during that
	stage, thickest first. So for every stage there is:
		sectionStart, foliageStart		where its parts start in the two big buffers
		thick							how many of its sections count as thick wood (they get the fine tessellation)
		thickAt[level]					how many of the thick ones that level draws (all of them, but for the last level: the trunk and main limbs)
		sections[level]					how many sections that level of detail draws (always the first so many: the thickest)
		foliage[level]					and how many pieces of foliage
*/
function buildArchetypes() {
	const params = getArchetypeParams();
	const twig = 0.012 * params.unitsPerMetre;
	const allSections = [], allFoliage = [];
	archetypes = [];

	for (let speciesIndex = 0; speciesIndex < TREE_SPECIES.length; speciesIndex++) {
		const species = TREE_SPECIES[speciesIndex];
		for (let variant = 0; variant < VARIANTS; variant++) {
			const tree = generateTree(speciesIndex, params.seed * 16 + variant, params.unitsPerMetre);
			const archetype = { species: speciesIndex, height: tree.height, crownRadius: tree.crownRadius, crownBottom: tree.crownBottom, trunkRadius: tree.trunkRadius, stages: [] };

			for (let stage = 0; stage < STAGES; stage++) {
				const from = stage == 0 ? 0 : STAGE_ENDS[stage - 1] * species.fullGrownAge;
				const to = STAGE_ENDS[stage] * species.fullGrownAge;
				const sizedAt = Math.min(to, species.fullGrownAge);		// the age the stage's parts are measured at: as big as they get in it

				// the sections that are there at some time in this stage, thickest first
				const picked = [];
				for (let i = 0; i < tree.sections.length; i += SECTION_FLOATS) {
					if (tree.sections[i + 7] < to + STAGE_OVERLAP && tree.sections[i + 13] > from - STAGE_OVERLAP) {
						picked.push([i, sectionRadiusAt(tree.sections, i, sizedAt, species.fullGrownAge, twig)]);
					}
				}
				picked.sort((a, b) => b[1] - a[1]);
				const thickest = picked.length > 0 ? picked[0][1] : 0;
				const countAbove = (radius) => picked.filter((section) => section[1] >= radius).length;
				const thick = countAbove(thickest * 0.22);
				const limbs = Math.min(Math.max(countAbove(thickest * 0.5), 1), thick);	// the trunk and main limbs

				const info = {
					sectionStart: allSections.length / SECTION_FLOATS,
					thick: thick,
					thickAt: [thick, thick, thick, thick, limbs],
					sections: [picked.length, Math.max(countAbove(Math.max(thickest * 0.05, 0.016 * params.unitsPerMetre)), thick), thick, thick, limbs],
					foliageStart: allFoliage.length / FOLIAGE_FLOATS,
					foliage: [],
				};
				for (const [i] of picked) {
					for (let k = 0; k < SECTION_FLOATS; k++) allSections.push(tree.sections[i + k]);
				}

				// and the foliage. It is already shuffled, so the first so many of it are a fair sample of the whole crown
				let pieces = 0;
				for (let i = 0; i < tree.foliage.length; i += FOLIAGE_FLOATS) {
					if (tree.foliage[i + 3] < to + STAGE_OVERLAP && tree.foliage[i + 7] > from - STAGE_OVERLAP) {
						for (let k = 0; k < FOLIAGE_FLOATS; k++) allFoliage.push(tree.foliage[i + k]);
						pieces++;
					}
				}
				for (let level = 0; level < LEVELS; level++) {
					info.foliage.push(Math.min(Math.ceil(pieces * FOLIAGE_DETAIL[level][0]), pieces));
				}
				archetype.stages.push(info);
			}

			// the billboard pictures: for each, the age of the tree in it and the box that holds all of the tree at that age
			archetype.pictures = BILLBOARD_GROWTHS.map((growth) => {
				const age = ageAtGrowth(species, growth) + 0.01;
				const box = treeBoxAt(tree, age);
				return {
					growth: growth, age: age,
					halfWidth: box.reach * 1.06,
					top: box.top * 1.04,
					bottom: -0.03 * box.top,
					above: (box.crownBottom + box.top) * 0.5,		// the height the view from above is drawn at: the middle of the crown
				};
			});
			archetypes.push(archetype);
		}
	}

	// what the shaders need to know about each archetype: the Archetype struct in vf_forest.js
	const table = new Float32Array(archetypes.length * 24);
	archetypes.forEach((archetype, i) => {
		const species = TREE_SPECIES[archetype.species];
		table.set([
			species.fullGrownAge, archetype.height, archetype.crownRadius, archetype.crownBottom,
			species.growth[0], species.growth[1], archetype.trunkRadius, archetype.species,
			...species.barkColor, 0,
			...species.barkColorHigh, 0,
			...species.leafColor, 0,
			...species.dryColor, 0,
		], i * 24);
	});

	// and about each billboard picture: the BillboardCell struct
	const cellTable = new Float32Array(archetypes.length * BILLBOARD_GROWTHS.length * CELL_FLOATS);
	archetypes.forEach((archetype, i) => {
		archetype.pictures.forEach((picture, j) => {
			cellTable.set([picture.halfWidth, picture.top, picture.bottom, picture.above, picture.growth, 0, 0, 0], (i * BILLBOARD_GROWTHS.length + j) * CELL_FLOATS);
		});
	});
	cellBuffer = createStorageBuffer("forest billboard cells", cellTable, cellBuffer);

	sectionBuffer = createStorageBuffer("forest sections", new Float32Array(allSections), sectionBuffer);
	foliageBuffer = createStorageBuffer("forest foliage", new Float32Array(allFoliage), foliageBuffer);
	archetypeBuffer = createStorageBuffer("forest archetypes", table, archetypeBuffer);
	forestBindGroup = undefined;

	bakeBillboards();

	builtArchetypeParams = JSON.stringify(params);
	console.log("Forest archetypes: ", archetypes.length, " trees, ", allSections.length / SECTION_FLOATS, " arc sections, ", allFoliage.length / FOLIAGE_FLOATS, " pieces of foliage");
}

//-------------------------------THE TREES-------------------------------
// What a tree's age makes it: the stage of life it is drawn from, and how far away it has to look for the level of detail.
//		age: its age now (a living tree's moves on with the clock, see ForestLife.ageAt)
function ageTree(tree, age = tree.age) {
	const species = TREE_SPECIES[tree.species];
	const archetype = archetypes[tree.archetype];
	const grown = age / species.fullGrownAge;
	tree.stage = STAGE_ENDS.findIndex((end) => grown < end);
	const height = archetype.height * tree.scale * heightFraction(species, age);
	tree.detailScale = Math.min(Math.max(Math.pow(REFERENCE_HEIGHT * settings.forestUnitsPerMetre / Math.max(height, 0.01), 0.75), 0.8), 4.0);
}

/*
	One tree's record for the GPU: the Tree struct in vf_forest.js.

	Its age goes in as a line, not a number: age = life.x + life.y * the clock. A living tree was tree.age years old when the
	clock said tree.ageTime and grows tree.rate years a year, which is the line through that point with that slope.
	A dead tree (and one having its billboard picture taken) has stopped: slope 0.
	All clock times are sent as years since clockBase, see rebaseClock.
*/
function packTree(tree, into, index) {
	const rate = tree.dead ? 0 : (tree.rate ?? 0);
	into.set([
		tree.x, tree.y, tree.z, tree.yaw,
		tree.age - rate * ((tree.ageTime ?? 0) - clockBase), rate, tree.dead ? tree.dryStart - clockBase : NEVER, tree.dead ? tree.fallStart - clockBase : NEVER,
		tree.scale, tree.archetype, tree.leanX, tree.leanZ,
		// both numbers of the fall in one: the direction in hundredths of a radian as the whole part, how far over it ends up (in half turns) as the fraction
		tree.dead ? Math.floor(tree.fallDirection * 100) + tree.fallAngle / Math.PI : 0, tree.seed, tree.dead ? tree.dryYears : 1, tree.detailScale,
	], index * TREE_FLOATS);
}

// The cells. Each one is a ball that holds all the trees there could be in its square of ground, crowns and all, which is
//		what gets tested against the camera. Trees come and go, so a cell is made when its first tree arrives and only ever grows
function addToCell(index) {
	const tree = trees[index];
	const key = Math.floor(tree.x / CELL_SIZE) + "," + Math.floor(tree.z / CELL_SIZE);
	let cell = cellsByKey.get(key);
	if (!cell) {
		cell = { x: (Math.floor(tree.x / CELL_SIZE) + 0.5) * CELL_SIZE, z: (Math.floor(tree.z / CELL_SIZE) + 0.5) * CELL_SIZE, bottom: tree.y, top: tree.y, trees: [] };
		cellsByKey.set(key, cell);
		cells.push(cell);
	}
	cell.trees.push(index);
	tree.cell = cell;
	cell.mostDetailScale = Math.max(cell.mostDetailScale ?? 0, tree.detailScale ?? 4);

	// tall and wide enough for the biggest tree there is, standing or lying
	const tallest = Math.max(...archetypes.map((archetype) => archetype.height)) * 1.3;
	cell.bottom = Math.min(cell.bottom, tree.y - tallest * 0.2);
	cell.top = Math.max(cell.top, tree.y + tallest);
	cell.y = (cell.bottom + cell.top) * 0.5;
	cell.radius = Math.hypot(CELL_SIZE * 0.5 + tallest, cell.top - cell.y, CELL_SIZE * 0.5 + tallest);
}

/*
	The trunks standing round a place, for anything that walks into them (hunting.js). Calls each(x, z, radius, bottom, top) for
	every tree standing within reach of (x, z), in world units: where its trunk is, how thick it is at the ground, and how far up
	it goes (the bottom half of the tree: anything higher is out of reach). Looks only in the cells round the place.
	Left out: a seedling too thin to bump into (under MIN_TRUNK), and a dead tree once it has started to fall.
*/
const MIN_TRUNK = 0.04;		// metres of trunk radius
export function trunksNear(x, z, reach, each) {
	const metre = settings.forestUnitsPerMetre;
	for (let cx = Math.floor((x - reach) / CELL_SIZE); cx <= Math.floor((x + reach) / CELL_SIZE); cx++) {
		for (let cz = Math.floor((z - reach) / CELL_SIZE); cz <= Math.floor((z + reach) / CELL_SIZE); cz++) {
			const cell = cellsByKey.get(cx + "," + cz);
			if (!cell) continue;
			for (const i of cell.trees) {
				const tree = trees[i];
				if (!tree || !tree.height || (tree.dead && clock >= tree.fallStart)) continue;
				if (Math.abs(tree.x - x) > reach || Math.abs(tree.z - z) > reach) continue;
				const archetype = archetypes[tree.archetype];
				if (!archetype) continue;
				// (a young tree's trunk is as much thinner as it is shorter)
				const radius = archetype.trunkRadius * tree.height / archetype.height;
				if (radius < MIN_TRUNK * metre) continue;
				each(tree.x, tree.z, radius, tree.y, tree.y + tree.height * 0.5);
			}
		}
	}
}

function removeFromCell(index, tree) {
	const members = tree.cell.trees;
	const at = members.indexOf(index);
	if (at >= 0) {
		members[at] = members[members.length - 1];
		members.pop();
	}
}

function plantTrees() {
	const params = getPlantingParams();
	trees = plantForest(terrain.land, params, VARIANTS).concat(plantTownTrees(terrain.land, params, VARIANTS));
	trees.forEach((tree) => { tree.archetype = tree.species * VARIANTS + tree.variant; });

	// the forest starts its clock again
	clock = 0;
	clockBase = 0;
	countedSunCycles = sunCycles;
	cells = [];
	cellsByKey = new Map();
	changedTrees = [];
	treesMoved = true;

	// there can never be more trees than maxTrees, so that is how many records there is room for
	const capacity = Math.max(params.maxTrees, trees.length, 1);
	treeData = new Float32Array(capacity * TREE_FLOATS);

	// From here the trees are in forestLife.js's hands. It tells this file whenever one arrives, changes or goes,
	//		and all this file does about it is keep the GPU's records and the cells up to date.
	//		(not yet though: while the forest settles there are no records or cells to keep, they are made from what is left standing)
	let listening = false;
	life = new ForestLife({
		trees: trees, archetypes: archetypes, variants: VARIANTS,
		land: terrain.land, site: createSite(terrain.land, params), params: params,
		wind: [settings.windDirection[0], settings.windDirection[1]],
		makeTree: makeTree, treeRoom: treeRoom,
		random: seededRandom(params.seed * 7919 + 577),
		added: (index) => { if (listening) { ageTree(trees[index]); addToCell(index); changedTrees.push(index); noteMoved(trees[index]); noteShared(index); } },
		changed: (index) => { if (listening) { const stage = trees[index].stage; ageTree(trees[index], life.ageAt(trees[index], clock)); changedTrees.push(index); if (trees[index].stage !== stage) noteMoved(trees[index]); if (trees[index].dead) noteShared(index); } },	//(only a new stage puts it in another list. Its size is caught up with by DRAWS_REFRESH)
		removed: (index, tree) => { if (listening) { removeFromCell(index, tree); noteMoved(tree); noteShared(index); } },
	});
	if (settings.forestLifeCycle) {
		life.settle(SETTLE_YEARS);
	}

	// everything that is standing now
	trees.forEach((tree, index) => {
		if (!tree) return;
		ageTree(tree, life.ageAt(tree, clock));
		addToCell(index);
		packTree(tree, treeData, index);
	});
	listening = true;

	treeBuffer = createStorageBuffer("forest trees", treeData, treeBuffer);
	// (twice over: a tree is in a mesh list and the billboard list at once while one dissolves into the other)
	visibleData = new Uint32Array(capacity * 2);
	visibleBuffer = createStorageBuffer("forest visible trees", visibleData, visibleBuffer);
	forestBindGroup = undefined;

	plantedParams = JSON.stringify(params);
	plantedLand = terrain.land;
	plantings++;
	if (sharing) sharing.clear();
	forestStats.trees = life.count;
	console.log("Forest planted: ", life.count, " trees in ", cells.length, " cells");
}

//-------------------------------TIME-------------------------------
/*
	The GPU works in 32 bit floats, which only hold about 7 digits. A clock that has run for thousands of years would have none
	left over for the fraction of a year a tree grows in a frame, and growth would start to stutter. So the GPU is never sent
	the clock itself, only how far it is past clockBase, and every so often clockBase is moved up to now and every record
	(they all hold times counted from it) is written again.
*/
function rebaseClock() {
	clockBase = clock;
	trees.forEach((tree, index) => {
		if (tree) packTree(tree, treeData, index);
	});
	device.queue.writeBuffer(treeBuffer, 0, treeData, 0, trees.length * TREE_FLOATS);
	changedTrees = [];
}

// Moves the forest's clock on by a number of years, and lets the forest live them
export function advanceForest(years) {
	const now = performance.now();
	const seconds = Math.min((now - lastAdvance) / 1000, 0.25);
	lastAdvance = now;
	if (years <= 0 || !life) {
		return;
	}
	clock += years;

	// how fast the clock is running, smoothed. A fall takes FALL_SECONDS at that pace
	if (seconds > 0) {
		yearsPerSecond = yearsPerSecond == 0 ? years / seconds : yearsPerSecond + (years / seconds - yearsPerSecond) * 0.05;
	}
	life.fallYears = Math.min(Math.max(yearsPerSecond * FALL_SECONDS, 0.0001), FALL_YEARS_MOST);
	life.goneYears = Math.min(Math.max(yearsPerSecond * GONE_SECONDS, 0.0001), GONE_YEARS_MOST);
	life.wind = [settings.windDirection[0], settings.windDirection[1]];

	if (!following) life.advance(clock, years);	// (a joiner's trees are the host's: see MULTIPLAYER)
	else followGrowth(years);

	// send on the records of the trees that changed
	if (clock - clockBase > REBASE_YEARS) {
		rebaseClock();
	} else {
		sendChangedTrees();
	}
	forestStats.trees = life.count;
}

//-------------------------------MULTIPLAYER-------------------------------
/*
	In a game with others (net.js) the host's forest is the forest. The life cycle draws on one stream of random numbers as the
	frames come, so two machines can never be made to live it the same way: the joiners' forests stop living (following),
	and take the host's trees.
		on joining			the host's whole forest (forestSnapshot, forestAdopt): every tree, SHARE_FIELDS each, and its clock
		as it goes on		every quarter of a second, the trees that came up, died (with how they will fall) or went, in full
							(forestChanges, forestApplyChanges). And a few at a time, round and round the whole forest, how
							old each living tree is and how fast it is growing (GROWTH_RECORD): a joiner's trees keep growing
							at the pace they were last sent, and this catches them up with the host's
		the clock			sent with the day's (setForestClock)
	The hitboxes (trunksNear) are made from the trees, so they follow.
	plantings counts the times the forest has been planted here: a forest planted again (its settings changed) has to be sent
	again.
	A joiner that leaves goes on living from the trees it has (forestFollow(false)).
*/
const SHARE_FIELDS = ['x', 'y', 'z', 'yaw', 'species', 'variant', 'age', 'ageTime', 'rate', 'scale', 'leanX', 'leanZ', 'seed', 'density',
	'dead', 'dryStart', 'dryYears', 'fallStart', 'fallDirection', 'fallAngle', 'planted'];
export const SHARE_RECORD = SHARE_FIELDS.length + 2;	// its number in the list, whether there is a tree there, and the fields
export const GROWTH_RECORD = 4;						// its number, age, ageTime, rate
let sharing = null;			// host: the numbers of the trees that came, died or went since they were last sent
let following = false;		// joiner: the trees are the host's
let sweep = 0;				// host: where the round of growth has got to
export let plantings = 0;

// host: start (or stop) noting what happens to the trees for the others
export function forestShare(on) {
	sharing = on ? new Set() : null;
	sweep = 0;
}
function noteShared(index) {
	if (!sharing) return;
	const tree = trees[index];
	if (!tree || tree.dead) {
		if (tree && tree.deathShared) return;
		if (tree) tree.deathShared = true;
	}
	sharing.add(index);
}
function recordOf(index, into, at) {
	const tree = trees[index];
	into[at] = index;
	into[at + 1] = tree ? 1 : 0;
	if (!tree) return;
	SHARE_FIELDS.forEach((field, k) => {
		const value = tree[field];
		into[at + 2 + k] = typeof value == 'boolean' ? (value ? 1 : 0) : (value ?? 0);
	});
}
// host: the whole forest, [clock, then SHARE_RECORD for every place in the list]
export function forestSnapshot() {
	const data = new Float32Array(1 + trees.length * SHARE_RECORD);
	data[0] = clock;
	for (let index = 0; index < trees.length; index++) recordOf(index, data, 1 + index * SHARE_RECORD);
	return data;
}
// host: what has happened since last time, and the growth of the next growthCount living trees round the forest
export function forestChanges(growthCount) {
	if (!sharing || !life || trees.length == 0) return null;
	const changed = [...sharing];
	sharing.clear();
	const records = new Float32Array(changed.length * SHARE_RECORD);
	changed.forEach((index, k) => recordOf(index, records, k * SHARE_RECORD));
	const growth = new Float32Array(growthCount * GROWTH_RECORD);
	let count = 0;
	for (let tries = 0; tries < trees.length && count < growthCount; tries++) {
		sweep = (sweep + 1) % trees.length;
		const tree = trees[sweep];
		if (!tree || tree.dead) continue;
		growth.set([sweep, tree.age, tree.ageTime, tree.rate], count * GROWTH_RECORD);
		count++;
	}
	return { clock, records, growth: growth.subarray(0, count * GROWTH_RECORD) };
}

// joiner: its trees measured again as they grow, at the pace the host's life visits them, from the pace each was last sent
//		(only that: no dying, no seeding. Without it a tree's size, and its trunk's hitbox, would only change when its growth comes in)
let followOwed = 0, followTurn = 0;
function followGrowth(years) {
	if (trees.length == 0) return;
	followOwed += trees.length * years / 2.5;
	const visits = Math.min(Math.floor(followOwed), trees.length);
	followOwed -= visits;
	for (let k = 0; k < visits; k++) {
		followTurn = (followTurn + 1) % trees.length;
		const tree = trees[followTurn];
		if (!tree || tree.dead) continue;
		tree.age = life.ageAt(tree, clock);
		tree.ageTime = clock;
		life.measure(tree);
		ageTree(tree, tree.age);
		changedTrees.push(followTurn);
	}
}
// joiner: whether the forest is planted with the settings it has now (the host's): ready to take the host's trees
export function forestReady() {
	const params = JSON.stringify(getArchetypeParams()) + JSON.stringify(getPlantingParams());
	return !!life && params == builtArchetypeParams + plantedParams && terrain.land === plantedLand;
}
// joiner: the trees are the host's from now on (true), or its own again (false)
export function forestFollow(on) {
	if (on == following) return;
	following = on;
	if (!on && life) {
		// living on its own again, from the trees as they are: the life's own lists made again from them
		life.trees = trees;
		life.grid = new TreeGrid(24);
		life.holes = [];
		life.count = 0;
		trees.forEach((tree, index) => {
			if (!tree) { life.holes.push(index); return; }
			life.grid.add(index, tree.x, tree.z);
			tree.visited = clock - Math.random() * 2.5;
			life.count++;
		});
		life.turn = 0;
		life.owed = 0;
	}
}
// joiner: the host's forest clock
export function setForestClock(hostClock) {
	clock = hostClock;
	if (Math.abs(clock - clockBase) > REBASE_YEARS && treeBuffer) rebaseClock();
}
// one tree as the host has it, at data[at] (SHARE_RECORD)
function applyRecord(data, at) {
	const index = data[at], present = data[at + 1] > 0.5;
	const old = trees[index];
	if (!present) {
		if (old) {
			removeFromCell(index, old);
			trees[index] = undefined;
			life.count--;
			noteMoved(old);
		}
		return;
	}
	const same = old && old.x === data[at + 2] && old.z === data[at + 4];
	const tree = same ? old : {};
	if (old && !same) removeFromCell(index, old);
	SHARE_FIELDS.forEach((field, k) => { tree[field] = data[at + 2 + k]; });
	tree.dead = tree.dead > 0.5;
	tree.planted = tree.planted > 0.5;		// (a town's: see plantTownTrees in forestGenerator.js)
	tree.archetype = tree.species * VARIANTS + tree.variant;
	life.measure(tree);
	ageTree(tree, life.ageAt(tree, clock));
	trees[index] = tree;
	if (!old) life.count++;
	if (!same) addToCell(index);
	changedTrees.push(index);
	noteMoved(tree);
}
// room on the GPU for as many places in the list as there are now
function makeRoom() {
	if (trees.length * TREE_FLOATS <= treeData.length) return;
	const capacity = Math.ceil(trees.length * 1.25);
	const data = new Float32Array(capacity * TREE_FLOATS);
	data.set(treeData);
	treeData = data;
	treeBuffer = createStorageBuffer("forest trees", treeData, treeBuffer);
	visibleData = new Uint32Array(capacity * 2);
	visibleBuffer = createStorageBuffer("forest visible trees", visibleData, visibleBuffer);
	forestBindGroup = undefined;
}
// the records of the trees that changed, to the GPU: one by one if there are a few, the whole lot in one go if there are many
function sendChangedTrees() {
	if (changedTrees.length == 0) return;
	for (const index of changedTrees) {
		if (trees[index]) packTree(trees[index], treeData, index);
	}
	if (changedTrees.length > 200) {
		device.queue.writeBuffer(treeBuffer, 0, treeData, 0, trees.length * TREE_FLOATS);
	} else {
		for (const index of changedTrees) {
			device.queue.writeBuffer(treeBuffer, index * TREE_FLOATS * 4, treeData, index * TREE_FLOATS, TREE_FLOATS);
		}
	}
	changedTrees = [];
}
// joiner: the host's whole forest, in place of its own
export function forestAdopt(data) {
	if (!life) return false;
	const count = (data.length - 1) / SHARE_RECORD;
	clock = data[0];
	clockBase = clock;
	trees = new Array(count).fill(undefined);	// (no holes in the array: an empty place is undefined, as the life leaves them)
	life.trees = trees;
	life.count = 0;
	cells = [];
	cellsByKey = new Map();
	changedTrees = [];
	for (let index = 0; index < count; index++) applyRecord(data, 1 + index * SHARE_RECORD);
	changedTrees = [];
	const capacity = Math.max(getPlantingParams().maxTrees, trees.length, 1);
	treeData = new Float32Array(capacity * TREE_FLOATS);
	trees.forEach((tree, index) => { if (tree) packTree(tree, treeData, index); });
	treeBuffer = createStorageBuffer("forest trees", treeData, treeBuffer);
	visibleData = new Uint32Array(capacity * 2);
	visibleBuffer = createStorageBuffer("forest visible trees", visibleData, visibleBuffer);
	forestBindGroup = undefined;
	treesMoved = true;
	forestStats.trees = life.count;
	return true;
}
// joiner: what has happened to the host's trees (see forestChanges)
export function forestApplyChanges(records, growth) {
	if (!life || !following) return;
	for (let at = 0; at < records.length; at += SHARE_RECORD) applyRecord(records, at);
	for (let at = 0; at < growth.length; at += GROWTH_RECORD) {
		const tree = trees[growth[at]];
		if (!tree || tree.dead) continue;
		tree.age = growth[at + 1];
		tree.ageTime = growth[at + 2];
		tree.rate = growth[at + 3];
		life.measure(tree);
		ageTree(tree, life.ageAt(tree, clock));
		changedTrees.push(growth[at]);
	}
	makeRoom();
	sendChangedTrees();
	forestStats.trees = life.count;
}

// shaders
//-------------------------------------------------
const woodShaderModule = device.createShaderModule({
  label: "vf_forestWood",
  code: vf_forestWood
});

const foliageShaderModule = device.createShaderModule({
  label: "vf_forestFoliage",
  code: vf_forestFoliage
});

const billboardShaderModule = device.createShaderModule({
  label: "vf_forestBillboard",
  code: vf_forestBillboard
});

const atlasShaderModule = device.createShaderModule({
  label: "vf_forestAtlas",
  code: vf_forestAtlas
});

// uniform buffers
//-------------------------------------------------
const forestUniformBuffer = device.createBuffer({
  label: "forest Uniform",
  size: 256,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// one small block of uniforms for every draw call, all in the one buffer. Each draw call points the same bind group at its own block
const drawUniformBuffer = device.createBuffer({
  label: "forest draw calls Uniform",
  size: MAX_DRAWS * DRAW_STRIDE,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const drawData = new ArrayBuffer(MAX_DRAWS * DRAW_STRIDE);

//linear sampling
const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

//the billboard atlas is read between its mip levels too, and anisotropically: with filteredSampler (textureFiltering.js)

// how the billboard pictures are laid out in the atlas: all the side views (archetype by archetype, age by age), then all the views from above
const atlasSlots = () => archetypes.length * BILLBOARD_GROWTHS.length * 2;
const atlasRows = () => Math.ceil(atlasSlots() / ATLAS_COLUMNS);

// The ForestUniforms struct in vf_forest.js. With no bake given it is the frame's: the main camera, the wind blowing.
//		bake: { viewProjectionMatrix, cameraPosition, view, halfDepth, height } is for taking a billboard picture: that camera, and the air still
function forestUniformValues(bake) {
	const bufferResult = [];

	const viewProjectionMatrix = bake ? bake.viewProjectionMatrix : transformations.getViewProj();
	for(let i = 0; i < 16; i++) {
		bufferResult.push(viewProjectionMatrix[i]);
	}

	bufferResult.push(bake ? bake.cameraPosition[0] : settings.camPosX);
	bufferResult.push(bake ? bake.cameraPosition[1] : settings.camPosY);
	bufferResult.push(bake ? bake.cameraPosition[2] : settings.camPosZ);
	bufferResult.push((performance.now() - startTime) / 1000.0);	//time in seconds

	//clock
	bufferResult.push(bake ? 0 : clock - clockBase);	//the forest's clock, in years (counted from clockBase, see rebaseClock)
	bufferResult.push(bake ? 0 : settings.forestWindStrength);
	bufferResult.push(settings.windDirection[0]);
	bufferResult.push(settings.windDirection[1]);

	//world
	bufferResult.push(settings.forestUnitsPerMetre);
	bufferResult.push(settings.waterHorizonFogDistance);
	bufferResult.push(settings.enableAtmosphere ? 1 : 0);
	bufferResult.push(bake ? 0 : seasonNow.autumn);		//how far the broadleaved trees have turned (weather.js). Never in a billboard's picture: that is turned when it is drawn

	//atlas
	bufferResult.push(ATLAS_COLUMNS);
	bufferResult.push(atlasRows());
	bufferResult.push(atlasSlots() / 2);
	bufferResult.push(BILLBOARD_GROWTHS.length);

	//bake
	bufferResult.push(bake ? bake.view : 0);
	bufferResult.push(bake ? bake.halfDepth : 0);
	bufferResult.push(bake ? bake.height : 0);
	bufferResult.push(0);

	//life
	bufferResult.push(life ? life.fallYears : 1);
	bufferResult.push(life ? life.goneYears : 1);
	bufferResult.push(0);
	bufferResult.push(0);

	//and the two rows windAt takes (vf_wind.js)
	bufferResult.push(...wind.windUniformValues());

	return new Float32Array(bufferResult);
}

function forestUniformBufferUpdates() {
	const result = forestUniformValues();
	device.queue.writeBuffer(forestUniformBuffer, 0, result.buffer, result.byteOffset, result.byteLength);
}

// Layouts
//-------------------------------------------------
const bindGroupLayout = device.createBindGroupLayout({
  label: "forest Bind Group Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: {}
  },
  {
    binding: 1,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,	//lights
    buffer: {}
  },
  {
    binding: 2,								//the trees
    visibility: GPUShaderStage.VERTEX,
    buffer: { type: 'read-only-storage' }
  },
  {
    binding: 3,								//which of them each draw call draws
    visibility: GPUShaderStage.VERTEX,
    buffer: { type: 'read-only-storage' }
  },
  {
    binding: 4,								//arc sections
    visibility: GPUShaderStage.VERTEX,
    buffer: { type: 'read-only-storage' }
  },
  {
    binding: 5,								//foliage
    visibility: GPUShaderStage.VERTEX,
    buffer: { type: 'read-only-storage' }
  },
  {
    binding: 6,								//archetypes
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: { type: 'read-only-storage' }
  },
  {
    binding: 7,								//sky view LUT
    visibility: GPUShaderStage.FRAGMENT,
    texture: {}
  },
  {
    binding: 8,
    visibility: GPUShaderStage.FRAGMENT,
    sampler: {}
  },
  {
    binding: 9,								//billboard cells: what each picture in the atlas shows
    visibility: GPUShaderStage.VERTEX,
    buffer: { type: 'read-only-storage' }
  },
  {
    binding: 10,							//billboard atlas, color
    visibility: GPUShaderStage.FRAGMENT,
    texture: {}
  },
  {
    binding: 11,							//billboard atlas, shape
    visibility: GPUShaderStage.FRAGMENT,
    texture: {}
  },
  {
    binding: 12,
    visibility: GPUShaderStage.FRAGMENT,
    sampler: {}
  },
  {
    binding: 13,							//the wind texture, read in the vertex shaders to bend the trees
    visibility: GPUShaderStage.VERTEX,
    texture: {}
  },
  {
    binding: 14,
    visibility: GPUShaderStage.VERTEX,
    sampler: {}
  }
  ]
});

const drawBindGroupLayout = device.createBindGroupLayout({
  label: "forest draw call Bind Group Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: { hasDynamicOffset: true, minBindingSize: 48 }	// the offset is given with every draw call: which block of the buffer is its own
  }
  ]
});

const drawBindGroup = device.createBindGroup({
	label: "forest draw call bind group",
	layout: drawBindGroupLayout,
	entries: [
	{
		binding: 0,
		resource: { buffer: drawUniformBuffer, size: 48 }
	}
	]
});

// uniforms, trees, visible: the frame's own, or the bake's stand ins for them (see bakeBillboards)
function createBindGroupForest(uniforms = forestUniformBuffer, treeList = treeBuffer, visibleList = visibleBuffer) {
	return device.createBindGroup({
			label: "forest bind group",
			layout: bindGroupLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: uniforms }
			},
			{
				binding: 1,
				resource: { buffer: uniformBufferLights }
			},
			{
				binding: 2,
				resource: { buffer: treeList }
			},
			{
				binding: 3,
				resource: { buffer: visibleList }
			},
			{
				binding: 4,
				resource: { buffer: sectionBuffer }
			},
			{
				binding: 5,
				resource: { buffer: foliageBuffer }
			},
			{
				binding: 6,
				resource: { buffer: archetypeBuffer }
			},
			{
				binding: 7,
				resource: skyViewLUTtexture.createView()
			},
			{
				binding: 8,
				resource: linSampler
			},
			{
				binding: 9,
				resource: { buffer: cellBuffer }
			},
			{
				binding: 10,
				resource: atlasColorTexture.createView()
			},
			{
				binding: 11,
				resource: atlasShapeTexture.createView()
			},
			{
				binding: 12,
				resource: filteredSampler()
			},
			{
				binding: 13,
				resource: wind.windTextureView
			},
			{
				binding: 14,
				resource: wind.windSampler
			}
			]
		});
}

// Pipelines
//-------------------------------------------------
const forestPipelineLayout = device.createPipelineLayout({
	label: "forest Pipeline Layout",
	bindGroupLayouts: [ bindGroupLayout, drawBindGroupLayout ],
});

// bake: the version of a pipeline that takes billboard pictures. Same vertices, but it writes what the tree is made of into the two bake textures
function createForestPipeline(label, shaderModule, bake = false) {
	return device.createRenderPipeline({
		label: label,
		layout: forestPipelineLayout,
		vertex: {
			module: shaderModule,
			entryPoint: "vertexMain",
			buffers: []					// none: the vertex shader makes every tube and card from its vertex and instance number
		},
		fragment: {
			module: shaderModule,
			entryPoint: bake ? "fragmentBake" : "fragmentMain",
			targets: bake ? [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }] : [{
			format: canvasFormat
			}]
		},
		primitive: {
			topology: 'triangle-list',
			cullMode: 'none',			// foliage is seen from both sides
		},
		depthStencil: {
			depthWriteEnabled: true,
			depthCompare: bake ? 'less' : depthTest('less'),
			format: bake ? 'depth24plus' : DEPTH_FORMAT,
		},
	});
}

const woodPipeline = createForestPipeline("forest wood pipeline", woodShaderModule);
const foliagePipeline = createForestPipeline("forest foliage pipeline", foliageShaderModule);
const billboardPipeline = createForestPipeline("forest billboard pipeline", billboardShaderModule);
const woodBakePipeline = createForestPipeline("forest wood bake pipeline", woodShaderModule, true);
const foliageBakePipeline = createForestPipeline("forest foliage bake pipeline", foliageShaderModule, true);

// shrinks a picture into (part of) the two atlas textures, see vf_forestAtlas
const atlasPipeline = device.createRenderPipeline({
	label: "forest atlas pipeline",
	layout: 'auto',
	vertex: {
		module: atlasShaderModule,
		entryPoint: "vertexMain",
		buffers: []
	},
	fragment: {
		module: atlasShaderModule,
		entryPoint: "fragmentMain",
		targets: [{ format: 'rgba8unorm' }, { format: 'rgba8unorm' }]
	},
	primitive: {
		topology: 'triangle-list',
	},
});

//-------------------------------BILLBOARDS-------------------------------
// one draw call's uniforms (the DrawUniforms struct in vf_forest.js) written into a block of drawData. fade: [x, y, z, w]
function writeDraw(into, slot, listStart, partStart, partCount, sides, rings, kept, foliageSize, nextFoliageSize, fade) {
	const ints = new Uint32Array(into), floats = new Float32Array(into);
	const at = slot * DRAW_STRIDE / 4;
	ints[at + 0] = listStart;
	ints[at + 1] = partStart;
	ints[at + 2] = partCount;
	ints[at + 3] = sides;
	ints[at + 4] = rings;
	ints[at + 5] = kept;
	floats[at + 6] = foliageSize;
	floats[at + 7] = nextFoliageSize;
	floats.set(fade, at + 8);
}

/*
	Takes the billboard pictures: every archetype, at every age in BILLBOARD_GROWTHS, from the side and from above.

	For each picture one tree of that archetype and age is stood at the origin, and drawn in full detail by the same vertex
	shaders as the forest, through a camera with no perspective (orthographic) boxed tight around it. The fragment shaders
	are the bake ones: instead of a lit color they write what the tree is made of (see baked in vf_forest.js).
	It is drawn BILLBOARD_OVERSIZE times too big into two scratch textures and shrunk from there into its slot of the atlas.
	Last, the atlas is halved over and over into its mip levels, so far away billboards dont sparkle.
*/
function bakeBillboards() {
	const pictures = BILLBOARD_GROWTHS.length;
	const sideSlots = archetypes.length * pictures;
	const atlasWidth = ATLAS_COLUMNS * BILLBOARD_WIDTH, atlasHeight = atlasRows() * BILLBOARD_HEIGHT;

	if (!atlasColorTexture || atlasColorTexture.height != atlasHeight) {
		if (atlasColorTexture) {
			atlasColorTexture.destroy();
			atlasShapeTexture.destroy();
		}
		const atlasDescriptor = {
			size: [atlasWidth, atlasHeight],
			format: 'rgba8unorm',
			mipLevelCount: ATLAS_MIPS,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		};
		atlasColorTexture = device.createTexture({ label: "forest billboard atlas, color", ...atlasDescriptor });
		atlasShapeTexture = device.createTexture({ label: "forest billboard atlas, shape", ...atlasDescriptor });
	}

	// the scratch textures a picture is first drawn into, and a depth buffer for drawing it
	const scratchSize = [BILLBOARD_WIDTH * BILLBOARD_OVERSIZE, BILLBOARD_HEIGHT * BILLBOARD_OVERSIZE];
	const scratchUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT;
	const scratchColor = device.createTexture({ label: "forest bake scratch, color", size: scratchSize, format: 'rgba8unorm', usage: scratchUsage });
	const scratchShape = device.createTexture({ label: "forest bake scratch, shape", size: scratchSize, format: 'rgba8unorm', usage: scratchUsage });
	const scratchDepth = device.createTexture({ label: "forest bake scratch, depth", size: scratchSize, format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });

	// the trees to take pictures of: one for every archetype and age, standing at the origin, full size, facing forwards. Tree i is picture i
	const models = new Float32Array(sideSlots * TREE_FLOATS);
	const everyModel = new Uint32Array(sideSlots);
	const bakeDraws = new ArrayBuffer(sideSlots * 3 * DRAW_STRIDE);
	const noFade = [1e8, 2e8, 1e8, 2e8];	// nothing turns into the next level of detail or dissolves while it has its picture taken
	archetypes.forEach((archetype, i) => {
		archetype.pictures.forEach((picture, j) => {
			const slot = i * pictures + j;
			packTree({ x: 0, y: 0, z: 0, yaw: 0, age: picture.age, scale: 1, archetype: i, leanX: 0, leanZ: 0, seed: 0.5, detailScale: 1 }, models, slot);
			everyModel[slot] = slot;

			// its three draw calls: thick wood, thin wood, foliage. All of it, as the nearest level of detail would
			const stage = archetype.stages[STAGE_ENDS.findIndex((end) => picture.age / TREE_SPECIES[archetype.species].fullGrownAge < end)];
			writeDraw(bakeDraws, slot * 3 + 0, slot, stage.sectionStart, stage.thick, 8, 4, stage.thick, 1, 1, noFade);
			writeDraw(bakeDraws, slot * 3 + 1, slot, stage.sectionStart + stage.thick, stage.sections[0] - stage.thick, 4, 2, stage.sections[0], 1, 1, noFade);
			writeDraw(bakeDraws, slot * 3 + 2, slot, stage.foliageStart, stage.foliage[0], 0, 0, stage.foliage[0], 1, 1, noFade);
			picture.draws = [
				{ slot: slot * 3 + 0, vertices: 8 * 4 * 6, instances: stage.thick },
				{ slot: slot * 3 + 1, vertices: 4 * 2 * 6, instances: stage.sections[0] - stage.thick },
				{ slot: slot * 3 + 2, vertices: FOLIAGE_VERTICES, instances: stage.foliage[0] },
			];
		});
	});
	const modelBuffer = createStorageBuffer("forest bake trees", models);
	const everyModelBuffer = createStorageBuffer("forest bake visible trees", everyModel);
	const bakeUniformBuffer = device.createBuffer({ label: "forest bake Uniform", size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const bakeDrawBuffer = device.createBuffer({ label: "forest bake draw calls Uniform", size: bakeDraws.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	device.queue.writeBuffer(bakeDrawBuffer, 0, bakeDraws);
	const bakeBindGroup = createBindGroupForest(bakeUniformBuffer, modelBuffer, everyModelBuffer);
	const bakeDrawBindGroup = device.createBindGroup({
		label: "forest bake draw call bind group",
		layout: drawBindGroupLayout,
		entries: [{ binding: 0, resource: { buffer: bakeDrawBuffer, size: 48 } }],
	});

	// shrinking: the uniforms (see vf_forestAtlas), and a bind group reading each source there will be
	const atlasUniformBuffer = device.createBuffer({ label: "forest atlas Uniform", size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const shrinkFrom = (colorView, shapeView) => device.createBindGroup({
		label: "forest atlas bind group",
		layout: atlasPipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: atlasUniformBuffer } },
			{ binding: 1, resource: colorView },
			{ binding: 2, resource: shapeView },
		],
	});
	const fromScratch = shrinkFrom(scratchColor.createView(), scratchShape.createView());
	const mipViews = (texture) => Array.from({ length: ATLAS_MIPS }, (unused, level) => texture.createView({ baseMipLevel: level, mipLevelCount: 1 }));
	const colorMips = mipViews(atlasColorTexture), shapeMips = mipViews(atlasShapeTexture);
	const targets = (colorView, shapeView, loadOp) => [
		{ view: colorView, loadOp: loadOp, clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: "store" },
		{ view: shapeView, loadOp: loadOp, clearValue: { r: 0, g: 0, b: 0, a: 0 }, storeOp: "store" },
	];

	// start from an empty atlas
	const clearEncoder = device.createCommandEncoder();
	clearEncoder.beginRenderPass({ colorAttachments: targets(colorMips[0], shapeMips[0], "clear") }).end();
	device.queue.submit([clearEncoder.finish()]);

	archetypes.forEach((archetype, i) => {
		archetype.pictures.forEach((picture, j) => {
			for (let view = 1; view <= 2; view++) {		// 1 from the side, 2 from above
				// the camera: looking along -z at the tree, or straight down on it with -z up the picture. No perspective
				const reach = picture.halfWidth, margin = 10;
				let viewMatrix, projectionMatrix;
				if (view == 1) {
					viewMatrix = mat4.lookAt([0, 0, reach + margin], [0, 0, 0], [0, 1, 0]);
					projectionMatrix = mat4.ortho(-reach, reach, picture.bottom, picture.top, 0.1, 2 * (reach + margin));
				} else {
					viewMatrix = mat4.lookAt([0, picture.top + margin, 0], [0, 0, 0], [0, 0, -1]);
					projectionMatrix = mat4.ortho(-reach, reach, -reach, reach, 0.1, picture.top + 2 * margin);
				}
				const uniforms = forestUniformValues({
					viewProjectionMatrix: mat4.multiply(projectionMatrix, viewMatrix),
					cameraPosition: [0, picture.top * 0.5, 60],
					view: view, halfDepth: reach, height: picture.top,
				});
				device.queue.writeBuffer(bakeUniformBuffer, 0, uniforms);

				// its slot in the atlas
				const slot = (view - 1) * sideSlots + i * pictures + j;
				const x = (slot % ATLAS_COLUMNS) * BILLBOARD_WIDTH, y = Math.floor(slot / ATLAS_COLUMNS) * BILLBOARD_HEIGHT;
				device.queue.writeBuffer(atlasUniformBuffer, 0, new Float32Array([x, y, BILLBOARD_OVERSIZE, 0]));

				const encoder = device.createCommandEncoder();
				const drawPass = encoder.beginRenderPass({
					colorAttachments: targets(scratchColor.createView(), scratchShape.createView(), "clear"),
					depthStencilAttachment: { view: scratchDepth.createView(), depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
				});
				drawPass.setBindGroup(0, bakeBindGroup);
				picture.draws.forEach((draw, k) => {
					if (draw.instances <= 0) return;
					drawPass.setPipeline(k < 2 ? woodBakePipeline : foliageBakePipeline);
					drawPass.setBindGroup(1, bakeDrawBindGroup, [draw.slot * DRAW_STRIDE]);
					drawPass.draw(draw.vertices, draw.instances, 0, 0);
				});
				drawPass.end();

				const shrinkPass = encoder.beginRenderPass({ colorAttachments: targets(colorMips[0], shapeMips[0], "load") });
				shrinkPass.setViewport(x, y, BILLBOARD_WIDTH, BILLBOARD_HEIGHT, 0, 1);
				shrinkPass.setPipeline(atlasPipeline);
				shrinkPass.setBindGroup(0, fromScratch);
				shrinkPass.draw(3);
				shrinkPass.end();

				// (sent off picture by picture: the uniforms written above are the ones in force when this is)
				device.queue.submit([encoder.finish()]);
			}
		});
	});

	// the mip levels, each one the level above it at half the size
	for (let level = 1; level < ATLAS_MIPS; level++) {
		device.queue.writeBuffer(atlasUniformBuffer, 0, new Float32Array([0, 0, 2, 0]));
		const encoder = device.createCommandEncoder();
		const pass = encoder.beginRenderPass({ colorAttachments: targets(colorMips[level], shapeMips[level], "clear") });
		pass.setPipeline(atlasPipeline);
		pass.setBindGroup(0, shrinkFrom(colorMips[level - 1], shapeMips[level - 1]));
		pass.draw(3);
		pass.end();
		device.queue.submit([encoder.finish()]);
	}

	// everything that was only for the bake. destroy waits for the work already sent off to finish with them
	for (const used of [scratchColor, scratchShape, scratchDepth, modelBuffer, everyModelBuffer, bakeUniformBuffer, bakeDrawBuffer, atlasUniformBuffer]) {
		used.destroy();
	}
	console.log("Forest billboards baked: ", sideSlots * 2, " pictures into a ", atlasWidth, "x", atlasHeight, " atlas");
}

// Per frame
//-------------------------------------------------
// call once a frame before the passes. Makes the archetypes and plants the forest again if their settings (or the land) changed
export function forestUpdate() {
	if (!settings.enableForest || !terrain.land) {
		countedSunCycles = sunCycles;	// no time passes in a forest that is switched off
		return;
	}

	// both take a moment, so wait until a slider has stopped moving for a quarter of a second before doing it
	const params = JSON.stringify(getArchetypeParams()) + JSON.stringify(getPlantingParams());
	if (params != builtArchetypeParams + plantedParams || terrain.land !== plantedLand) {
		if (params != pendingParams) {
			pendingParams = params;
			pendingSince = performance.now();
		} else if (builtArchetypeParams == "" || performance.now() - pendingSince > 250) {
			if (JSON.stringify(getArchetypeParams()) != builtArchetypeParams) {
				buildArchetypes();
			}
			plantTrees();
		}
	}

	// the clock: on by however far the sun has gone round since last frame
	const cycles = sunCycles - countedSunCycles;
	countedSunCycles = sunCycles;
	advanceForest(settings.forestLifeCycle ? Math.max(cycles, 0) * settings.forestYearsPerSunCycle : 0);
	settings.forestYear = Math.round(clock * 10) / 10;		// for the controls to show
	settings.forestTreeCount = forestStats.trees;
}

// 1. of forestPass: which trees are drawn this frame and how. Fills the visible list and the draw calls' uniforms.
//		Returns the draw calls as { wood: [...], foliage: [...] }, each { slot, vertices, instances }
const lists = [];	// one list of trees for every (archetype, stage, level of detail), reused every frame
const billboards = [];	// and the one list of the trees that are billboards
//		The lists are kept from one frame to the next, and only worked out again when something they depend on has changed: the
//		camera (its place, which way it looks, the shape of the view), the level of detail settings, or a tree (treesMoved). Standing
//		still, that is never, and sorting tens of thousands of trees was the most CPU time a frame took
//		A tree that only grew a little (its size, and with it how soon it drops detail) is caught up with every DRAWS_REFRESH frames
const DRAWS_REFRESH = 30;
let keptDraws = null, keptDrawsFor = '', framesSinceSort = 0;
function sortTreesIntoDraws() {
	const planes = transformations.getFrustumPlanes();
	const camX = settings.camPosX, camY = settings.camPosY, camZ = settings.camPosZ;
	const drawsFor = planes.flat().join() + '|' + [settings.forestDetailDistance, settings.forestMidDistance, settings.forestBillboardDistance, settings.forestDrawDistance, settings.forestThinnedRings, archetypes.length, settings.landOcclusion].join();
	if (keptDraws && !treesMoved && drawsFor === keptDrawsFor && ++framesSinceSort < DRAWS_REFRESH) {
		return keptDraws;
	}
	treesMoved = false;
	framesSinceSort = 0;
	keptDrawsFor = drawsFor;

	// the distances each level of detail ends at. They are distances for a tree of REFERENCE_HEIGHT, see detailDistance in vf_forest.js.
	//		The thinned rings share out the stretch from the mid distance to the billboard distance, each the same many times
	//		further than the last. A level that is not used ends where the last one used does, so nothing ever falls in it
	const rings = Math.min(Math.max(Math.round(settings.forestThinnedRings), 0), THINNED_LEVELS);
	const lastLevel = LEVELS - 1 - THINNED_LEVELS + rings;
	const detailEnd = settings.forestDetailDistance;
	const midEnd = Math.max(settings.forestMidDistance, detailEnd);
	const meshEnd = Math.max(settings.forestBillboardDistance, midEnd);
	const ends = [detailEnd, midEnd];
	for (let level = 2; level < LEVELS; level++) {
		ends.push(level <= lastLevel ? midEnd * Math.pow(meshEnd / midEnd, (level - 1) / (lastLevel - 1)) : meshEnd);
	}
	// billboards start a bit before the last mesh level ends, the two dissolve into each other over that stretch
	const billboardStart = meshEnd * (1 - FADE_BAND), billboardEnd = Math.max(settings.forestDrawDistance, meshEnd);
	billboards.length = 0;

	const listCount = archetypes.length * STAGES * LEVELS;
	for (let i = 0; i < listCount; i++) {
		if (lists[i]) lists[i].length = 0;
		else lists[i] = [];
	}

	forestStats.drawn = new Array(LEVELS + 1).fill(0);
	forestStats.hiddenCells = 0;
	const occluding = horizon.readyHorizon();
	for (const cell of cells) {
		// the whole cell behind the camera, off to one side, or too far away to draw anything of (a small tree's detail distance is up to 4x its real one)
		if (planes.some((plane) => plane[0] * cell.x + plane[1] * cell.y + plane[2] * cell.z + plane[3] < -cell.radius)) continue;
		const cellAway = Math.hypot(cell.x - camX, cell.y - camY, cell.z - camZ);
		if (cellAway - cell.radius > billboardEnd) continue;
		// or behind a hill (see horizon.js)
		if (occluding && cell.trees.length > 0 && horizon.hidden(cell.x, cell.z, cell.top, cell.radius)) {
			forestStats.hiddenCells++;
			continue;
		}

		// a cell so far off that every tree in it is a billboard, and none of them past the draw distance: all of them, with no
		//		sums for each tree. (A tree's detail distance is its own distance stretched by its detailScale, which is 0.8 at the least)
		if ((cellAway - cell.radius) * 0.8 >= meshEnd && (cellAway + cell.radius) * (cell.mostDetailScale ?? 4) < billboardEnd) {
			for (const i of cell.trees) billboards.push(i);
			forestStats.drawn[LEVELS] += cell.trees.length;
			continue;
		}

		for (const i of cell.trees) {
			const tree = trees[i];
			const detail = Math.hypot(tree.x - camX, tree.y - camY, tree.z - camZ) * tree.detailScale;
			let level = 0;
			while (level < LEVELS && detail >= ends[level]) level++;
			if (level == LEVELS) level = -1;
			if (level >= 0) {
				lists[(tree.archetype * STAGES + tree.stage) * LEVELS + level].push(i);
				forestStats.drawn[level]++;
			}
			if (detail >= billboardStart && detail < billboardEnd) {
				billboards.push(i);
				forestStats.drawn[LEVELS]++;
			}
		}
	}

	// the lists go into the visible buffer end to end, and every list gets its draw calls
	const draws = { wood: [], foliage: [], billboards: [] };
	let listStart = 0, slot = 0;
	forestStats.triangles = 0;
	// kept: how many of the parts the next level of detail still draws. The rest shrink away over the last part of this level's distance
	const addDraw = (into, partStart, partCount, kept, sides, rings, level, vertices, treeCount) => {
		if (partCount <= 0 || slot >= MAX_DRAWS) return;
		const last = level == lastLevel;
		// fade. x to y: where it turns into the next level. z to w: where it dissolves away (into the billboard), which only the last level does
		const fade = [ends[level] * (1 - FADE_BAND), ends[level], last ? billboardStart : 1e8, last ? ends[level] : 2e8];
		writeDraw(drawData, slot, listStart, partStart, partCount, sides, rings, last ? partCount : Math.min(Math.max(kept, 0), partCount),
					FOLIAGE_DETAIL[level][1], FOLIAGE_DETAIL[Math.min(level + 1, lastLevel)][1], fade);
		into.push({ slot: slot, vertices: vertices, instances: treeCount * partCount });
		forestStats.triangles += vertices / 3 * treeCount * partCount;
		slot++;
	};

	for (let list = 0; list < listCount; list++) {
		const members = lists[list];
		if (members.length == 0) continue;
		const level = list % LEVELS;
		const stage = archetypes[Math.floor(list / (STAGES * LEVELS))].stages[Math.floor(list / LEVELS) % STAGES];
		visibleData.set(members, listStart);

		const tessellation = TESSELLATION[level], next = Math.min(level + 1, lastLevel);
		addDraw(draws.wood, stage.sectionStart, stage.thickAt[level], stage.thickAt[next], tessellation.thick[0], tessellation.thick[1], level, tessellation.thick[0] * tessellation.thick[1] * 6, members.length);
		if (tessellation.thin) {
			addDraw(draws.wood, stage.sectionStart + stage.thick, stage.sections[level] - stage.thick, stage.sections[next] - stage.thick, tessellation.thin[0], tessellation.thin[1], level, tessellation.thin[0] * tessellation.thin[1] * 6, members.length);
		}
		addDraw(draws.foliage, stage.foliageStart, stage.foliage[level], stage.foliage[next], 0, 0, level, FOLIAGE_VERTICES, members.length);

		listStart += members.length;
	}

	// the billboards: one draw call for the lot, whatever archetype they are. An instance is a whole tree
	if (billboards.length > 0 && slot < MAX_DRAWS) {
		visibleData.set(billboards, listStart);
		// fade. x to y: where it dissolves in (as the last mesh level dissolves out). z to w: where it dissolves away at the draw distance
		writeDraw(drawData, slot, listStart, 0, 1, 0, 0, 1, 1, 1, [billboardStart, meshEnd, billboardEnd * 0.9, billboardEnd]);
		draws.billboards.push({ slot: slot, vertices: BILLBOARD_VERTICES, instances: billboards.length });
		forestStats.triangles += BILLBOARD_VERTICES / 3 * billboards.length;
		listStart += billboards.length;
		slot++;
	}
	forestStats.drawCalls = slot;

	if (listStart > 0) {
		device.queue.writeBuffer(visibleBuffer, 0, visibleData.buffer, 0, listStart * 4);
		device.queue.writeBuffer(drawUniformBuffer, 0, drawData, 0, slot * DRAW_STRIDE);
	}
	keptDraws = draws;
	return draws;
}

export function forestPass(aEncoder, mainpassDepthTexture) {

	// nothing to stand on without the land
	if (!settings.enableForest || !settings.enableTerrain || !life || life.count == 0) {
		return;
	}

	forestUniformBufferUpdates();
	const draws = sortTreesIntoDraws();
	if (draws.wood.length == 0 && draws.foliage.length == 0 && draws.billboards.length == 0) {
		return;
	}
	if (!forestBindGroup || forestBindGroupFiltering !== filteringLevel()) {
		forestBindGroup = createBindGroupForest();
		forestBindGroupFiltering = filteringLevel();
	}

	//(one pass, or while the Performance window is timing, one for each of the three shaders: see renderPassParts in profiler.js)
	const parts = profiler.renderPassParts(aEncoder, {
		colorAttachments: [{
		view: context.getCurrentTexture().createView(),
		loadOp: "load",
		clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
		storeOp: "store",
		}],
		depthStencilAttachment: {
			view: mainpassDepthTexture.createView(),
			depthLoadOp: 'load',
			depthStoreOp: 'store',
		},
	});

	let pass = parts.next('Wood', 'vf_forestWood');
	pass.setBindGroup(0, forestBindGroup);
	pass.setPipeline(woodPipeline);
	for (const draw of draws.wood) {
		pass.setBindGroup(1, drawBindGroup, [draw.slot * DRAW_STRIDE]);
		pass.draw(draw.vertices, draw.instances, 0, 0);		// draw(vertexCount, instanceCount, firstVertex, firstInstance)
	}

	pass = parts.next('Foliage', 'vf_forestFoliage');
	pass.setBindGroup(0, forestBindGroup);
	pass.setPipeline(foliagePipeline);
	for (const draw of draws.foliage) {
		pass.setBindGroup(1, drawBindGroup, [draw.slot * DRAW_STRIDE]);
		pass.draw(draw.vertices, draw.instances, 0, 0);
	}

	pass = parts.next('Billboards', 'vf_forestBillboard');
	pass.setBindGroup(0, forestBindGroup);
	pass.setPipeline(billboardPipeline);
	for (const draw of draws.billboards) {
		pass.setBindGroup(1, drawBindGroup, [draw.slot * DRAW_STRIDE]);
		pass.draw(draw.vertices, draw.instances, 0, 0);
	}

	parts.end();
}
