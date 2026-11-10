import {device} from './deviceSelection.js'
import { frameTexture } from './deviceSelection.js'
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
import { c_forestChanges, CHANGE_WORKGROUP } from '../shaders/js/vf_forest.js'
import { c_forestCull, CULL_WORKGROUP, LIST_WORKGROUP } from '../shaders/js/vf_forest.js'
import { addJob, UNSEEN } from './jobs.js'
import { BILLBOARD_VERTICES } from '../shaders/js/vf_forest.js'
import { vf_forestFloor, vf_forestThrows } from '../shaders/js/vf_forest.js'
import { FLOOR_TEXELS, FLOOR_SPAN, FLOOR_FORMAT, floorView, floorUniformBuffer } from './floor.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as horizon from './horizon.js'
import * as scene from './scene.js'
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
		1. go through the blocks and the cells in view (see THE CELLS), and sort each of their trees into a list by archetype, by how
		   grown it is, and by level of detail (how far off it is)
		2. each list is drawn with a few draw calls: its thick wood, its thin wood, its foliage. A draw call is "these trees x these parts"

	Levels of detail. The same tree, less of it and more coarsely made the further off it is:
		0	every branch and every piece of foliage, the wood finely tessellated
		1	the thicker branches, half the foliage (drawn bigger to cover the same), coarse tubes
		2	the trunk and limbs as a few flat sided tubes, a fifth of the foliage
		3	thinned: the same wood on fewer rings, a twelfth of the foliage in big pieces
		4	thinned further: the trunk and main limbs only, a thirtieth of the foliage. The step before the billboard
		5	a billboard: 2 flat cards with a picture of the tree on them
	THE ROOTS (treeGenerator.js: THE ROOTS) are drawn by 0 (all of them, ROOT_TESSELLATION) and 1 (the thickest), and shrink away over
	the end of 1: further off they would be less than a pixel. They are laid over the ground where they are (vf_forest.js), which the
	top down height map has (scene.js: the ground round the camera, as from straight above), and are not drawn past ROOT_DISTANCE, where it ends.
	A town's trees have none: theirs are under the streets. What they and the windthrown trees do to the ground: THE FLOOR
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
// and the roots: [sides, rings] for each level of detail that draws them (THE ROOTS)
const ROOT_TESSELLATION = [[7, 3], [4, 2]];

const FADE_BAND = 0.25;				// the last part of a level's distance, over which it turns into the next (see towardsNextLevel in vf_forest.js)
const REFERENCE_HEIGHT = 22;		// metres. The level of detail distances are for a tree this tall, smaller trees drop detail sooner
const CELL_SIZE = 128;				// world units, the squares the trees are sorted into
const BLOCK_CELLS = 8;				// cells along a side of a block of them (see THE CELLS)

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
const TREE_BUFFER_USAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;	// (copied from as it grows: makeRoom)
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
let tallestArchetype = 0;			// world units: the tallest of them, full grown
export let trees = [];				// see plantForest in forestGenerator.js. forest.js adds: archetype, stage, detailScale. Has holes (undefined) where trees have gone
export let life;					// the ForestLife that runs them, see forestLife.js
export let clock = 0;				// the forest's clock, in years since it was planted
let clockBase = 0;					// the clock time the GPU counts from, see rebaseClock
let countedSunCycles = sunCycles;	// the sun cycles the clock has already been moved on for
const MOST_CYCLES = 0.02;			// a frame (see forestUpdate)
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
// the squares of ground with trees in them (cells), for skipping whole squares that are out of view, and the cells gathered into blocks,
//		for skipping a whole block of them without looking at any (see THE CELLS)
let blocks = [];
let cellsByKey = new Map(), blocksByKey = new Map();

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
function createStorageBuffer(label, data, old, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST) {
	if (old) {
		old.destroy();
	}
	const buffer = device.createBuffer({
		label: label,
		size: Math.max(data.byteLength, 64),	// never empty, a buffer of size 0 cant be bound
		usage: usage,
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
		rootStart, roots[level]			where its roots start in the sections, and how many of them that level draws (THE ROOTS: 0 and 1)
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
			const archetype = { species: speciesIndex, height: tree.height, crownRadius: tree.crownRadius, crownBottom: tree.crownBottom, trunkRadius: tree.trunkRadius, lobes: tree.rootLobes, roots: tree.roots, stages: [] };

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
				// the roots there are in the stage, after them: thickest first, all of them for the nearest level, the thickest half for the next
				const roots = [];
				for (let i = 0; i < tree.roots.length; i += SECTION_FLOATS) {
					if (tree.roots[i + 7] < to + STAGE_OVERLAP) roots.push([i, sectionRadiusAt(tree.roots, i, sizedAt, species.fullGrownAge, twig)]);
				}
				roots.sort((a, b) => b[1] - a[1]);
				const thickestRoot = roots.length > 0 ? roots[0][1] : 0;
				info.rootStart = allSections.length / SECTION_FLOATS;
				info.roots = [roots.length, roots.filter((root) => root[1] >= thickestRoot * 0.5).length, 0, 0, 0];
				for (const [i] of roots) {
					for (let k = 0; k < SECTION_FLOATS; k++) allSections.push(tree.roots[i + k]);
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

	tallestArchetype = Math.max(...archetypes.map((archetype) => archetype.height));

	// what the shaders need to know about each archetype: the Archetype struct in vf_forest.js
	const table = new Float32Array(archetypes.length * 24);
	archetypes.forEach((archetype, i) => {
		const species = TREE_SPECIES[archetype.species];
		table.set([
			species.fullGrownAge, archetype.height, archetype.crownRadius, archetype.crownBottom,
			species.growth[0], species.growth[1], archetype.trunkRadius, archetype.species,
			...species.barkColor, archetype.lobes[0],		// (and the lobes of the foot of the trunk: how many, and where: THE ROOTS)
			...species.barkColorHigh, archetype.lobes[1],
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
		tree.scale, tree.archetype + (tree.planted ? 0.5 : 0), tree.leanX, tree.leanZ,		// (a town's: no roots, see THE ROOTS)
		// both numbers of the fall in one: the direction in hundredths of a radian as the whole part, how far over it ends up (in half turns) as the fraction
		//		(less than 0: it tears its root plate out as it goes, THE FLOOR)
		tree.dead ? (uproots(tree) ? -1 : 1) * (Math.floor(tree.fallDirection * 100) + tree.fallAngle / Math.PI) : 0, tree.seed, tree.dead ? tree.dryYears : 1, tree.detailScale,
	], index * TREE_FLOATS);
}

/*
	THE CELLS. Each one is a ball that holds all the trees there could be in its square of ground, crowns and all, which is what gets
	tested against the camera. Trees come and go, so a cell is made when its first tree arrives, only ever grows, and goes when its
	last tree does.
	The cells are gathered into blocks, BLOCK_CELLS of them along each side: a bounding volume hierarchy two levels deep. A block is a
	box round the balls of all its cells, so a block wholly out of view, or too far off, is passed over without looking at any of them
	(not one of them would be drawn), and the cells of one that is not are tested as ever. What is drawn is the same; what a frame costs
	is the blocks and the cells near enough to see, however many tiles of the world have come and gone (a block goes with its last cell)
*/
function addToCell(index) {
	const tree = trees[index];
	const cx = Math.floor(tree.x / CELL_SIZE), cz = Math.floor(tree.z / CELL_SIZE), key = cx + "," + cz;
	let cell = cellsByKey.get(key);
	if (!cell) {
		const bx = Math.floor(cx / BLOCK_CELLS), bz = Math.floor(cz / BLOCK_CELLS), blockKey = bx + "," + bz;
		let block = blocksByKey.get(blockKey);
		if (!block) {
			block = { key: blockKey, cells: [], x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity };
			blocksByKey.set(blockKey, block);
			blocks.push(block);
		}
		cell = { key: key, x: (cx + 0.5) * CELL_SIZE, z: (cz + 0.5) * CELL_SIZE, bottom: tree.y, top: tree.y, trees: [], block: block };
		cellsByKey.set(key, cell);
		block.cells.push(cell);
	}
	cell.trees.push(index);
	tree.cell = cell;
	cell.mostDetailScale = Math.max(cell.mostDetailScale ?? 0, tree.detailScale ?? 4);

	// tall and wide enough for the biggest tree there is, standing or lying
	const tallest = tallestArchetype * 1.3;
	cell.bottom = Math.min(cell.bottom, tree.y - tallest * 0.2);
	cell.top = Math.max(cell.top, tree.y + tallest);
	cell.y = (cell.bottom + cell.top) * 0.5;
	cell.radius = Math.hypot(CELL_SIZE * 0.5 + tallest, cell.top - cell.y, CELL_SIZE * 0.5 + tallest);
	// and its block's box round its ball
	const block = cell.block;
	block.x0 = Math.min(block.x0, cell.x - cell.radius);
	block.x1 = Math.max(block.x1, cell.x + cell.radius);
	block.y0 = Math.min(block.y0, cell.y - cell.radius);
	block.y1 = Math.max(block.y1, cell.y + cell.radius);
	block.z0 = Math.min(block.z0, cell.z - cell.radius);
	block.z1 = Math.max(block.z1, cell.z + cell.radius);
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

/*
	FELLED (the Survival mode's hatchet, survivalTools.js): the standing tree whose trunk is nearest (x, z) within reach (world units), as
	{ index, height (metres), x, z }, or null; and one of them brought down there and then: dead, and falling at once the way it is
	pushed (direction: radians, 0 = +x), lying a while and going as any dead tree goes (forestLife.js). Its height in metres, or 0 if it
	could not be (gone, dead already, or one of the towns' planted ones). Only where the forest lives (alone, or the host: see
	MULTIPLAYER): the change goes out to the others as any death does
*/
export function treeNear(x, z, reach) {
	let best = null, bestD = reach;
	for (let cx = Math.floor((x - reach) / CELL_SIZE); cx <= Math.floor((x + reach) / CELL_SIZE); cx++) {
		for (let cz = Math.floor((z - reach) / CELL_SIZE); cz <= Math.floor((z + reach) / CELL_SIZE); cz++) {
			const cell = cellsByKey.get(cx + "," + cz);
			if (!cell) continue;
			for (const i of cell.trees) {
				const tree = trees[i];
				if (!tree || !tree.height || tree.dead) continue;
				const d = Math.hypot(tree.x - x, tree.z - z);
				if (d < bestD) { bestD = d; best = { index: i, height: tree.height / settings.forestUnitsPerMetre, x: tree.x, z: tree.z, planted: !!tree.planted }; }
			}
		}
	}
	return best;
}
// the crowns of the trees standing round a place (skyCover.js: what the sky sees over the walker): each(x, y (its foot), z, radius, height), world units
export function crownsNear(x, z, reach, each) {
	for (let cx = Math.floor((x - reach) / CELL_SIZE); cx <= Math.floor((x + reach) / CELL_SIZE); cx++) {
		for (let cz = Math.floor((z - reach) / CELL_SIZE); cz <= Math.floor((z + reach) / CELL_SIZE); cz++) {
			const cell = cellsByKey.get(cx + "," + cz);
			if (!cell) continue;
			for (const i of cell.trees) {
				const tree = trees[i];
				if (!tree || !tree.height || tree.dead || Math.abs(tree.x - x) > reach || Math.abs(tree.z - z) > reach) continue;
				each(tree.x, tree.y, tree.z, tree.crownRadius ?? tree.height * 0.25, tree.height);
			}
		}
	}
}
// every tree in the cells round a place, living or dead: each(tree) (particles.js: the trees the leaves come off, and the trunks in their way)
export function treesAround(x, z, reach, each) {
	for (let cx = Math.floor((x - reach) / CELL_SIZE); cx <= Math.floor((x + reach) / CELL_SIZE); cx++) {
		for (let cz = Math.floor((z - reach) / CELL_SIZE); cz <= Math.floor((z + reach) / CELL_SIZE); cz++) {
			const cell = cellsByKey.get(cx + "," + cz);
			if (!cell) continue;
			for (const i of cell.trees) each(trees[i]);
		}
	}
}
// THE TREES BROUGHT DOWN (the save file's: saveGame.js): where each was, the host's, the last FELLED_KEPT of them. The forest is planted
//		from its seed again with the world, so these are what the players did to it: put back, each takes the tree that stands nearest there
const FELLED_KEPT = 4000;
let felled = [];
export const felledRecord = () => felled.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
export function felledAdopt(list) {
	let down = 0;
	for (const [x, z] of list ?? []) {
		const t = treeNear(Number(x), Number(z), 1.5);
		if (!t || t.planted || !life) continue;
		const tree = trees[t.index];
		life.kill(tree, clock);
		Object.assign(tree, { dryYears: 0.0001, fallStart: clock - 1000 });
		life.changed(t.index);
		felled.push([tree.x, tree.z]);
		down++;
	}
	return down;
}
export function fellTree(index, direction) {
	const tree = trees[index];
	if (!life || following || !tree || tree.dead || tree.planted) return 0;
	felled.push([tree.x, tree.z]);
	if (felled.length > FELLED_KEPT) felled = felled.slice(-FELLED_KEPT);
	life.kill(tree, clock);
	tree.dryYears = 0.0001;
	tree.fallStart = clock;
	tree.fallDirection = ((direction % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);		// (0 to a whole turn: packTree keeps it in hundredths)
	life.changed(index);
	return tree.height / settings.forestUnitsPerMetre;
}

function removeFromCell(index, tree) {
	const cell = tree.cell, members = cell.trees;
	const at = members.indexOf(index);
	if (at >= 0) {
		members[at] = members[members.length - 1];
		members.pop();
	}
	// (the last of its trees gone: the cell goes, and its block with its last cell. See THE CELLS)
	if (members.length == 0 && cellsByKey.get(cell.key) === cell) {
		cellsByKey.delete(cell.key);
		const block = cell.block;
		block.cells.splice(block.cells.indexOf(cell), 1);
		if (block.cells.length == 0 && blocksByKey.get(block.key) === block) {
			blocksByKey.delete(block.key);
			blocks.splice(blocks.indexOf(block), 1);
		}
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
	blocks = [];
	cellsByKey = new Map();
	blocksByKey = new Map();
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
		land: terrain.land, site: siteOf(createSite(terrain.land, params)), params: params,
		wind: [settings.windDirection[0], settings.windDirection[1]],
		makeTree: makeTree, treeRoom: treeRoom,
		// (the tile a place is in, in a world of tiles: a seedling there is that tile's, and goes with it. The home tile's have none)
		tileOf: (x, z) => {
			if (!terrain.world) return undefined;
			const S = settings.terrainWorldSize, key = Math.round(x / S) + ',' + Math.round(z / S);
			return key == '0,0' ? undefined : key;
		},
		random: seededRandom(params.seed * 7919 + 577),
		added: (index) => { if (listening) { ageTree(trees[index]); addToCell(index); noteTile(index); changedTrees.push(index); noteMoved(trees[index]); noteShared(index); } },
		changed: (index) => { if (listening) { const stage = trees[index].stage; ageTree(trees[index], life.ageAt(trees[index], clock)); changedTrees.push(index); if (trees[index].stage !== stage) noteMoved(trees[index]); if (trees[index].dead) noteShared(index); } },	//(only a new stage puts it in another list. Its size is caught up with by DRAWS_REFRESH)
		removed: (index, tree) => { markGone(tree); if (listening) { removeFromCell(index, tree); forgetTile(index, tree); changedTrees.push(index); noteMoved(tree); noteShared(index); } },
		// (a tree moved down the list, packing it: its cell's and its tile's lists, its record in its new place, the others told of both)
		moved: (from, to) => {
			if (!listening) return;
			const tree = trees[to], members = tree.cell.trees, at = members.indexOf(from);
			if (at >= 0) members[at] = to;
			if (tree.tile !== undefined) { const own = tileTrees.get(tree.tile); if (own?.delete(from)) own.add(to); }
			changedTrees.push(to);
			noteMoved(tree);
			if (sharing) { sharing.add(from); sharing.add(to); }
		},
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

	treeBuffer = createStorageBuffer("forest trees", treeData, treeBuffer, TREE_BUFFER_USAGE);
	// (twice over: a tree is in a mesh list and the billboard list at once while one dissolves into the other)
	visibleData = new Uint32Array(capacity * 2);
	visibleBuffer = createStorageBuffer("forest visible trees", visibleData, visibleBuffer, TREE_BUFFER_USAGE);
	forestBindGroup = undefined;

	plantedParams = JSON.stringify(params);
	plantedLand = terrain.land;
	plantings++;
	felled = [];
	// (and the trees of the world's other tiles there are now, brought in again)
	incoming = [];
	tileTrees.clear();
	sites.clear();
	for (const t of terrain.tilesLoaded()) if (t.key != '0,0') bringTile(t.key);
	if (sharing) sharing.clear();
	forestStats.trees = life.count;
	console.log("Forest planted: ", life.count, " trees in ", cellsByKey.size, " cells");
}

//-------------------------------THE WORLD'S OTHER TILES-------------------------------
/*
	In a world of tiles (terrain.js, world.js) the home tile's trees are planted here, as the one land's are. Every other tile's are planted
	with its land off the main thread (tileWorker.js: terrain.tileExtras.forest, these planting settings), and brought in as it comes, as
	many a frame as BRING_MS allows (bringInTrees), each knowing its tile; let go with it. Each lives as the rest do (ForestLife: adopt),
	its seeds coming up by the ground of the tile they land on (siteOf). A joiner's trees are the host's (see MULTIPLAYER).
*/
const TILE_RECORD = 12;
const LET_GO_STEP = 2000;			// trees of a tile let go a step (see letGoTile)
const PACK_HOLES = 4000, PACK_STEP = 1000;	// holes in the list it takes for it to be packed down (and a fifth of it), and trees moved a step
let packing = false;
const tileTrees = new Map();		// the trees of each tile but the home one, by its key: their numbers in the list (a tile let go lets go of those)
function noteTile(index) {
	const tile = trees[index].tile;
	if (tile === undefined) return;
	if (!tileTrees.has(tile)) tileTrees.set(tile, new Set());
	tileTrees.get(tile).add(index);
}
const forgetTile = (index, tree) => { if (tree.tile !== undefined) tileTrees.get(tree.tile)?.delete(index); };
export const tileTreesForTest = () => tileTrees;
const BRING_MS = 1.5, BRING_LEAST = 200;		// milliseconds of a frame for bringing a tile's trees in, and the fewest a frame however long that takes
let incoming = [];				// { key, records, at }
terrain.tileExtras.forest = () => ({ params: getPlantingParams(), variants: VARIANTS });
terrain.onTiles((added, removed) => {
	for (const key of removed) letGoTile(key);
	for (const key of added) bringTile(key);
});
export function bringTiles(keys) { for (const key of keys) if (key != '0,0') bringTile(key); }
function bringTile(key) {
	const t = terrain.tilesLoaded().find((one) => one.key == key);
	if (t?.land.forestTrees && t.land.forestPlanted == JSON.stringify(getPlantingParams()) && !incoming.some((q) => q.key == key)) incoming.push({ key, records: t.land.forestTrees, at: 0 });
}
function letGoTile(key) {
	incoming = incoming.filter((q) => q.key != key);
	sites.delete(key);
	if (!life || following) return;
	// (a piece at a time, as the frames have room for it: jobs.js. It is far out of sight by now, past where trees are drawn. Each still
	//		the one it was: not gone of itself in the meantime, its place in the list taken by another, nor the forest planted again)
	const going = [...(tileTrees.get(key) ?? [])].map((index) => [index, trees[index]]), planting = plantings;
	tileTrees.delete(key);
	addJob('the trees of ' + key + ', let go', function* () {
		for (let k = 0; k < going.length; k++) {
			if (plantings !== planting || following) return;
			const [index, tree] = going[k];
			if (trees[index] === tree) life.letGo(index);
			if (k % LET_GO_STEP == LET_GO_STEP - 1) { forestStats.trees = life.count; yield; }
		}
		forestStats.trees = life.count;
	}, { priority: UNSEEN });
}
function bringInTrees() {
	if (!life || following || !incoming.length) return;
	const t0 = performance.now();
	const q = incoming[0];
	makeRoom((q.records.length - q.at) / TILE_RECORD);		// (room for all the rest of the tile's at once)
	let brought = 0;
	for (const r = q.records; q.at < r.length; q.at += TILE_RECORD) {
		if (brought >= BRING_LEAST && brought % 64 == 0 && performance.now() - t0 > BRING_MS) break;
		const tree = { x: r[q.at], y: r[q.at + 1], z: r[q.at + 2], species: r[q.at + 3], variant: r[q.at + 4], age: r[q.at + 5], scale: r[q.at + 6], yaw: r[q.at + 7],
			leanX: r[q.at + 8], leanZ: r[q.at + 9], seed: r[q.at + 10], tile: q.key };
		if (r[q.at + 11]) tree.planted = true;
		tree.archetype = tree.species * VARIANTS + tree.variant;
		life.adopt(tree, clock);
		brought++;
	}
	if (q.at >= q.records.length) {
		incoming.shift();
		// (the trees of it that were brought down before it went: down again, see THE TREES BROUGHT DOWN)
		const S = settings.terrainWorldSize, [tx, tz] = q.key.split(',').map(Number);
		const mine = felled.filter(([x, z]) => Math.round(x / S) == tx && Math.round(z / S) == tz);
		felled = felled.filter((f) => !mine.includes(f));
		felledAdopt(mine);
	}
	forestStats.trees = life.count;
	// (their records to the GPU now, with any others that changed: the clock may be standing still, and the records only go with it
	//		otherwise. They went into the holes the list had first, all along it: see THE CHANGES)
	sendChangedTrees();
	forestStats.bringLast = performance.now() - t0;
	forestStats.bringMs = Math.max(forestStats.bringMs ?? 0, Math.round(forestStats.bringLast));
}
// where a seed lands, the ground of the tile it lands on (the home tile's: the one planted with the forest)
const sites = new Map();
function siteOf(homeSite) {
	return (x, z) => {
		const L = terrain.world ? terrain.tileLand(x, z) : null;
		if (!L || !L.tile || L.tile == '0,0') return homeSite(x, z);
		let s = sites.get(L.tile);
		if (!s) { s = createSite(L, getPlantingParams()); sites.set(L.tile, s); }
		return s(x, z);
	};
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

// whether a tree could be seen from the camera: drawn at all, near enough for the draw distance (a box round that, the quicker sum.
//		A tree's detail distance is its own stretched by its detailScale, at least 0.8 of it: see sortTreesIntoDraws). See ForestLife.advance
function seenTree(tree) {
	const reach = Math.max(settings.forestDrawDistance, settings.forestBillboardDistance) * 1.3;
	return Math.abs(tree.x - settings.camPosX) < reach && Math.abs(tree.z - settings.camPosZ) < reach;
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

	if (!following) life.advance(clock, years, seenTree);	// (a joiner's trees are the host's: see MULTIPLAYER)
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
		life.tileCounts = new Map();
		trees.forEach((tree, index) => {
			if (!tree) { life.holes.push(index); return; }
			life.grid.add(index, tree.x, tree.z);
			tree.visited = clock - Math.random() * 2.5;
			life.count++;
			life.countTile(tree, 1);
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
			markGone(old);
			removeFromCell(index, old);
			trees[index] = undefined;
			life.count--;
			changedTrees.push(index);
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
// room on the GPU for as many places in the list as there are now (or as many more as are on the way): twice that, so it is seldom
//		needed, and the records there are already copied over on the GPU rather than sent again
function makeRoom(more = 0) {
	if ((trees.length + more) * TREE_FLOATS <= treeData.length) return;
	const capacity = Math.ceil((trees.length + more) * 2);
	const data = new Float32Array(capacity * TREE_FLOATS);
	data.set(treeData);
	const old = treeBuffer;
	treeBuffer = device.createBuffer({ label: "forest trees", size: data.byteLength, usage: TREE_BUFFER_USAGE });
	const encoder = device.createCommandEncoder({ label: "forest trees, moved" });
	encoder.copyBufferToBuffer(old, 0, treeBuffer, 0, treeData.byteLength);
	device.queue.submit([encoder.finish()]);
	old.destroy();		// (once the copy is done with it)
	treeData = data;
	visibleData = new Uint32Array(capacity * 2);
	visibleBuffer = createStorageBuffer("forest visible trees", visibleData, visibleBuffer, TREE_BUFFER_USAGE);
	forestBindGroup = undefined;
}
/*
	THE CHANGES: the records of the trees that changed, to the GPU. All that a frame has go up together, each with its place in the list,
	in one write to a staging buffer, and a small compute pass (c_forestChanges in vf_forest.js) puts each one where it goes in the trees'
	buffer. So however many there are, and however far apart in the list, it is one write and one dispatch. (It was a write each, and with
	more than 200 the whole list again: megabytes, every frame of a busy forest, and the slower the frames the more of them there are)
*/
const CHANGE_WORDS = 1 + TREE_FLOATS;		// its place in the list, then its record
let changeData = new Uint32Array(0), changeBuffer = null, changeBindGroup = null, changeBindGroupFor = null;
let treeWords = new Uint32Array(0);			// treeData's words, to copy a record as it is
function sendChangedTrees() {
	if (changedTrees.length == 0) return;
	if (treeWords.buffer !== treeData.buffer) treeWords = new Uint32Array(treeData.buffer);
	if (changeData.length < 1 + changedTrees.length * CHANGE_WORDS) {
		changeData = new Uint32Array(1 + Math.max(changedTrees.length * 2, 1024) * CHANGE_WORDS);
		if (changeBuffer) changeBuffer.destroy();
		changeBuffer = device.createBuffer({ label: "forest changed trees", size: changeData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		changeBindGroupFor = null;
	}
	let count = 0;
	for (const index of changedTrees) {
		if (trees[index]) packTree(trees[index], treeData, index);
		else if (index < treeData.length / TREE_FLOATS) treeData.fill(0, index * TREE_FLOATS, (index + 1) * TREE_FLOATS);		// (gone: an empty record, passed over by THE GPU'S LISTS)
		else continue;
		changeData[1 + count * CHANGE_WORDS] = index;
		changeData.set(treeWords.subarray(index * TREE_FLOATS, (index + 1) * TREE_FLOATS), 2 + count * CHANGE_WORDS);
		count++;
	}
	changedTrees = [];
	if (count == 0) return;
	changeData[0] = count;
	device.queue.writeBuffer(changeBuffer, 0, changeData, 0, 1 + count * CHANGE_WORDS);
	if (changeBindGroupFor !== treeBuffer) {
		changeBindGroup = device.createBindGroup({
			label: "forest changed trees bind group",
			layout: changePipeline.getBindGroupLayout(0),
			entries: [{ binding: 0, resource: { buffer: changeBuffer } }, { binding: 1, resource: { buffer: treeBuffer } }],
		});
		changeBindGroupFor = treeBuffer;
	}
	const encoder = device.createCommandEncoder({ label: "forest changed trees" });
	const pass = encoder.beginComputePass();
	pass.setPipeline(changePipeline);
	pass.setBindGroup(0, changeBindGroup);
	pass.dispatchWorkgroups(Math.ceil(count / CHANGE_WORKGROUP));
	pass.end();
	device.queue.submit([encoder.finish()]);
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
	blocks = [];
	cellsByKey = new Map();
	blocksByKey = new Map();
	changedTrees = [];
	for (let index = 0; index < count; index++) applyRecord(data, 1 + index * SHARE_RECORD);
	changedTrees = [];
	const capacity = Math.max(getPlantingParams().maxTrees, trees.length, 1);
	treeData = new Float32Array(capacity * TREE_FLOATS);
	trees.forEach((tree, index) => { if (tree) packTree(tree, treeData, index); });
	treeBuffer = createStorageBuffer("forest trees", treeData, treeBuffer, TREE_BUFFER_USAGE);
	visibleData = new Uint32Array(capacity * 2);
	visibleBuffer = createStorageBuffer("forest visible trees", visibleData, visibleBuffer, TREE_BUFFER_USAGE);
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

// putting changed records in their places (see THE CHANGES)
const changePipeline = device.createComputePipeline({
	label: "forest changed trees pipeline",
	layout: 'auto',
	compute: { module: device.createShaderModule({ label: "c_forestChanges", code: c_forestChanges }), entryPoint: "computeMain" },
});

// uniform buffers
//-------------------------------------------------
const forestUniformBuffer = device.createBuffer({
  label: "forest Uniform",
  size: 384,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// one small block of uniforms for every draw call, all in the one buffer. Each draw call points the same bind group at its own block
const drawUniformBuffer = device.createBuffer({
  label: "forest draw calls Uniform",
  size: MAX_DRAWS * DRAW_STRIDE,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,		// (STORAGE: the GPU's lists write each one's start: THE GPU'S LISTS)
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
	bufferResult.push(!bake && settings.forestRoots ? 1 : 0);		//(the windthrown stand their plates up only while the roots are drawn: THE FLOOR)
	bufferResult.push(bake ? 0 : seasonNow.bare);		//how far the broadleaved trees have lost their leaves (weather.js). Never in a billboard's picture

	//and the two rows windAt takes (vf_wind.js)
	bufferResult.push(...wind.windUniformValues());

	//and where the top down height map looks from (THE ROOTS), and where the floor map does (THE FLOOR)
	bufferResult.push(...transformations.getTopDownViewProjectionMat());
	bufferResult.push(...floorCamera().matrix);

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
  },
  {
    binding: 15,							//the top down height map: the ground the roots lie on (scene.js)
    visibility: GPUShaderStage.VERTEX,
    texture: { sampleType: 'depth' }
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
			},
			{
				binding: 15,
				resource: scene.heightMapView
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
	const bakeUniformBuffer = device.createBuffer({ label: "forest bake Uniform", size: 384, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
	// (no more than MOST_CYCLES a frame: the clock put on a long way at once, a save loaded or a joiner put right, is not centuries of the
	//		forest's life in one frame, every tree in it dead of old age. Sleeping goes by far slower than that: bedrolls.js)
	const cycles = Math.min(sunCycles - countedSunCycles, MOST_CYCLES);
	countedSunCycles = sunCycles;
	bringInTrees();
	// (the list packed down when a tile's trees let go have left it holes enough: a piece at a time, ForestLife.compact)
	if (life && !following && !packing && life.holes.length > PACK_HOLES && life.holes.length > trees.length * 0.2) {
		packing = true;
		const planting = plantings;
		addJob('the forest packed down', function* () {
			try { while (plantings === planting && !following && life.compact(PACK_STEP)) yield; }
			finally { packing = false; forestStats.listLength = trees.length; }
		}, { priority: UNSEEN });
	}
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
	for (const block of blocks) {
		// a whole block behind the camera, off to one side, or too far away: none of its cells is looked at (its box holds all their
		//		balls, so not one of them would be drawn: see THE CELLS)
		if (planes.some((plane) => plane[0] * (plane[0] > 0 ? block.x1 : block.x0) + plane[1] * (plane[1] > 0 ? block.y1 : block.y0) + plane[2] * (plane[2] > 0 ? block.z1 : block.z0) + plane[3] < 0)) continue;
		if (Math.hypot(Math.max(block.x0 - camX, 0, camX - block.x1), Math.max(block.y0 - camY, 0, camY - block.y1), Math.max(block.z0 - camZ, 0, camZ - block.z1)) > billboardEnd) continue;
		for (const cell of block.cells) {
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
	}

	// the lists go into the visible buffer end to end, and every list gets its draw calls
	const draws = { wood: [], foliage: [], billboards: [], roots: [] };
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
		const draw = { slot: slot, vertices: vertices, instances: treeCount * partCount };
		into.push(draw);
		forestStats.triangles += vertices / 3 * treeCount * partCount;
		slot++;
		return draw;
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
		const rootCut = settings.forestRoots ? ROOT_TESSELLATION[level] : null;
		if (rootCut) { const draw = addDraw(draws.wood, stage.rootStart, stage.roots[level], stage.roots[level + 1], rootCut[0], rootCut[1], level, rootCut[0] * rootCut[1] * 6, members.length); if (draw) draws.roots.push(draw); }

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
	floorDue = true;		// (the floor is drawn from them: THE FLOOR)
	gpuSlots = null;		// (the draw calls' uniforms are the CPU's now: THE GPU'S LISTS writes its own again)
	return draws;
}

//-------------------------------THE GPU'S LISTS-------------------------------
/*
	With forestGpuCulling on (as it is), 1. of forestPass is done on the GPU, for every tree, every frame: c_forestCull in vf_forest.js.
	Each tree is tested against the view and the horizon (horizon.js: the table the CPU's cells are tested with, sent as it is made again),
	and sorted by how far off it is into its list (archetype, stage of life, level of detail) and the billboards'; then the lists are laid
	end to end in the visible list, and each draw call's start and instance count written where it reads them: an indirect draw. The CPU
	never knows how many trees each list has.
	THE DRAW SLOTS: a draw call for every list there could be (its thick wood, its thin wood, its foliage) and one for the billboards, the
	same every frame and most of them drawing nothing: their uniforms are written when the levels of detail or the archetypes change, all
	but where each starts. Encoding a few hundred draw calls that draw nothing costs less than sorting the trees did.
	The CPU's way (sortTreesIntoDraws) is kept for forestGpuCulling off. It tests whole cells, the GPU each tree: so the GPU draws fewer
	trees, never more (the ones a cell of them is not, out of view or behind the hills).
	A tree gone leaves an empty record (sendChangedTrees), which the GPU passes over.
*/
const cullUniformBuffer = device.createBuffer({ label: "forest cull Uniform", size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const countsBuffer = device.createBuffer({ label: "forest list counts", size: LIST_WORKGROUP * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
const startsBuffer = device.createBuffer({ label: "forest list starts", size: LIST_WORKGROUP * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
const slotsBuffer = device.createBuffer({ label: "forest draw slots", size: MAX_DRAWS * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const indirectBuffer = device.createBuffer({ label: "forest indirect draws", size: MAX_DRAWS * 16, usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE });
const horizonBuffer = device.createBuffer({ label: "forest horizon", size: horizon.HORIZON.BINS * horizon.HORIZON.STEPS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const cullModule = device.createShaderModule({ label: "c_forestCull", code: c_forestCull(horizon.HORIZON, { LEVELS, STAGES, STAGE_ENDS }) });
const cullPipelines = Object.fromEntries(['cullTrees', 'layLists', 'placeTrees'].map((entry) =>
	[entry, device.createComputePipeline({ label: "forest " + entry + " pipeline", layout: 'auto', compute: { module: cullModule, entryPoint: entry } })]));
const cullValues = new Float32Array(44), cullSizes = new Uint32Array(cullValues.buffer, 40 * 4, 4);
let placedBuffer = null;			// each tree's lists and places in them (see cullTrees), made as big as the trees' list can be
let cullBindGroups = null, cullBindFor = [];
let horizonSent = -1;
let gpuSlots = null;				// THE DRAW SLOTS: { key, wood, foliage, billboards (their slots), count, lists, ends, billboardStart, billboardEnd }
let gpuListsFor = '', gpuFramesSince = 0;	// what the GPU's lists were last made for, and the frames since

// the distances the levels of detail end at, and the billboards', as the settings have them (see sortTreesIntoDraws)
function detailEnds() {
	const rings = Math.min(Math.max(Math.round(settings.forestThinnedRings), 0), THINNED_LEVELS);
	const lastLevel = LEVELS - 1 - THINNED_LEVELS + rings;
	const detailEnd = settings.forestDetailDistance;
	const midEnd = Math.max(settings.forestMidDistance, detailEnd);
	const meshEnd = Math.max(settings.forestBillboardDistance, midEnd);
	const ends = [detailEnd, midEnd];
	for (let level = 2; level < LEVELS; level++) {
		ends.push(level <= lastLevel ? midEnd * Math.pow(meshEnd / midEnd, (level - 1) / (lastLevel - 1)) : meshEnd);
	}
	return { lastLevel, ends, meshEnd, billboardStart: meshEnd * (1 - FADE_BAND), billboardEnd: Math.max(settings.forestDrawDistance, meshEnd) };
}

// THE DRAW SLOTS (see the top), made again when the levels of detail or the archetypes are not what they were made for
function drawSlots() {
	const key = [settings.forestDetailDistance, settings.forestMidDistance, settings.forestBillboardDistance, settings.forestDrawDistance, settings.forestThinnedRings, settings.forestRoots, archetypes.length, builtArchetypeParams].join();
	if (gpuSlots && gpuSlots.key === key) return gpuSlots;
	const { lastLevel, ends, meshEnd, billboardStart, billboardEnd } = detailEnds();
	const slots = { key, wood: [], foliage: [], billboards: [], roots: [], count: 0, lists: archetypes.length * STAGES * LEVELS, ends, billboardStart, billboardEnd, levelOf: new Uint8Array(MAX_DRAWS), levelFrom: 0 };
	const table = new Uint32Array(MAX_DRAWS * 4);
	const add = (into, list, partStart, partCount, kept, sides, rings, level, vertices) => {
		if (partCount <= 0 || slots.count >= MAX_DRAWS - 1) return -1;
		const last = level == lastLevel;
		const fade = [ends[level] * (1 - FADE_BAND), ends[level], last ? billboardStart : 1e8, last ? ends[level] : 2e8];
		writeDraw(drawData, slots.count, 0, partStart, partCount, sides, rings, last ? partCount : Math.min(Math.max(kept, 0), partCount),
					FOLIAGE_DETAIL[level][1], FOLIAGE_DETAIL[Math.min(level + 1, lastLevel)][1], fade);
		table.set([list, partCount, vertices, 0], slots.count * 4);
		slots.levelOf[slots.count] = level;
		into.push(slots.count);
		return slots.count++;
	};
	for (let list = 0; list < slots.lists; list++) {
		const level = list % LEVELS;
		if (level > lastLevel) continue;		// (a level not used: nothing falls in it)
		const stage = archetypes[Math.floor(list / (STAGES * LEVELS))].stages[Math.floor(list / LEVELS) % STAGES];
		const tessellation = TESSELLATION[level], next = Math.min(level + 1, lastLevel);
		add(slots.wood, list, stage.sectionStart, stage.thickAt[level], stage.thickAt[next], tessellation.thick[0], tessellation.thick[1], level, tessellation.thick[0] * tessellation.thick[1] * 6);
		if (tessellation.thin) {
			add(slots.wood, list, stage.sectionStart + stage.thick, stage.sections[level] - stage.thick, stage.sections[next] - stage.thick, tessellation.thin[0], tessellation.thin[1], level, tessellation.thin[0] * tessellation.thin[1] * 6);
		}
		add(slots.foliage, list, stage.foliageStart, stage.foliage[level], stage.foliage[next], 0, 0, level, FOLIAGE_VERTICES);
		const rootCut = settings.forestRoots ? ROOT_TESSELLATION[level] : null;
		if (rootCut) { const k = add(slots.wood, list, stage.rootStart, stage.roots[level], stage.roots[level + 1], rootCut[0], rootCut[1], level, rootCut[0] * rootCut[1] * 6); if (k >= 0) slots.roots.push(k); }
	}
	// the billboards: one draw call for the lot, whatever archetype they are. An instance is a whole tree
	writeDraw(drawData, slots.count, 0, 0, 1, 0, 0, 1, 1, 1, [billboardStart, meshEnd, billboardEnd * 0.9, billboardEnd]);
	table.set([slots.lists, 1, BILLBOARD_VERTICES, 0], slots.count * 4);
	slots.levelOf[slots.count] = LEVELS;		// (after every level of detail: always drawn)
	slots.billboards.push(slots.count++);
	device.queue.writeBuffer(drawUniformBuffer, 0, drawData, 0, slots.count * DRAW_STRIDE);
	device.queue.writeBuffer(slotsBuffer, 0, table, 0, slots.count * 4);
	keptDraws = null;		// (the CPU's draw calls' uniforms are gone: it works them out again, if it is asked)
	gpuListsFor = '';		// (and the lists made again into them)
	gpuSlots = slots;
	return slots;
}

// the three passes, into the frame's encoder before the forest is drawn. Returns THE DRAW SLOTS, or null if the lists cannot be made on
//		the GPU (more archetypes than a workgroup can lay out: the CPU's way, then)
function listsOnGPU(encoder) {
	const slots = drawSlots();
	if (slots.lists + 1 > LIST_WORKGROUP) return null;
	const places = treeData.length / TREE_FLOATS;
	if (!placedBuffer || placedBuffer.size < places * 16) {
		if (placedBuffer) placedBuffer.destroy();
		placedBuffer = device.createBuffer({ label: "forest trees placed", size: Math.max(places, 1) * 16, usage: GPUBufferUsage.STORAGE });
	}
	if (!cullBindGroups || cullBindFor[0] !== treeBuffer || cullBindFor[1] !== visibleBuffer || cullBindFor[2] !== placedBuffer || cullBindFor[3] !== archetypeBuffer) {
		const of = (entry, bindings) => device.createBindGroup({ label: "forest " + entry + " bind group", layout: cullPipelines[entry].getBindGroupLayout(0), entries: bindings.map(([binding, buffer]) => ({ binding, resource: { buffer } })) });
		cullBindGroups = {
			cullTrees: of('cullTrees', [[0, cullUniformBuffer], [1, treeBuffer], [2, archetypeBuffer], [3, horizonBuffer], [4, countsBuffer], [5, placedBuffer]]),
			layLists: of('layLists', [[0, cullUniformBuffer], [4, countsBuffer], [6, startsBuffer], [7, slotsBuffer], [8, drawUniformBuffer], [9, indirectBuffer]]),
			placeTrees: of('placeTrees', [[0, cullUniformBuffer], [5, placedBuffer], [6, startsBuffer], [10, visibleBuffer]]),
		};
		cullBindFor = [treeBuffer, visibleBuffer, placedBuffer, archetypeBuffer];
	}
	// the horizon, when it is a new one (horizon.js makes it again as the camera moves on)
	const occluding = horizon.readyHorizon(), table = horizon.horizonTable();
	if (occluding && table.builds !== horizonSent) {
		device.queue.writeBuffer(horizonBuffer, 0, table.steepest);
		horizonSent = table.builds;
	}
	const planes = transformations.getFrustumPlanes();
	// (the lists the GPU made last still right, as sortTreesIntoDraws keeps its own: the camera, the levels of detail, the trees near it and
	//		how many there are as they were. A tree further off is caught up with every DRAWS_REFRESH frames)
	const listsFor = planes.flat().join() + '|' + slots.key + '|' + settings.landOcclusion + '|' + trees.length;
	if (listsFor === gpuListsFor && !treesMoved && ++gpuFramesSince < DRAWS_REFRESH) return slots;
	floorDue = true;		// (the floor is drawn from them: THE FLOOR)
	gpuListsFor = listsFor;
	treesMoved = false;
	gpuFramesSince = 0;
	// (the nearest any tree can be: the nearest block of them (see THE CELLS: its box holds their feet), and nearer than that times 0.8 a
	//		tree's detail distance never is (its detailScale is 0.8 at the least). A level of detail that ends nearer has no trees in it this
	//		time, and its draw calls are not made: drawing nothing costs the GPU too. Every block, in view or not: a tree's own ball, which
	//		the GPU tests, can reach out of its block's box)
	let nearest = Infinity;
	for (const block of blocks) {
		nearest = Math.min(nearest, Math.hypot(Math.max(block.x0 - settings.camPosX, 0, settings.camPosX - block.x1), Math.max(block.y0 - settings.camPosY, 0, settings.camPosY - block.y1), Math.max(block.z0 - settings.camPosZ, 0, settings.camPosZ - block.z1)));
	}
	slots.levelFrom = 0;
	while (slots.levelFrom < LEVELS && slots.ends[slots.levelFrom] <= nearest * 0.8) slots.levelFrom++;
	cullValues.set([settings.camPosX, settings.camPosY, settings.camPosZ, 0], 0);
	planes.forEach((plane, k) => cullValues.set(plane, 4 + k * 4));
	cullValues.set(slots.ends.slice(0, 4), 28);
	cullValues.set([slots.ends[4], slots.billboardStart, slots.billboardEnd, clock - clockBase], 32);
	cullValues.set(occluding && table.madeAt ? [...table.madeAt, 1] : [0, 0, 0, 0], 36);
	cullSizes.set([trees.length, slots.lists, slots.lists, slots.count]);
	device.queue.writeBuffer(cullUniformBuffer, 0, cullValues);
	encoder.clearBuffer(countsBuffer);
	const pass = encoder.beginComputePass({ label: "forest lists", timestampWrites: profiler.timestamps('Lists', 'c_forestCull') });
	const groups = Math.ceil(trees.length / CULL_WORKGROUP);
	if (groups > 0) {
		pass.setPipeline(cullPipelines.cullTrees);
		pass.setBindGroup(0, cullBindGroups.cullTrees);
		pass.dispatchWorkgroups(groups);
	}
	pass.setPipeline(cullPipelines.layLists);
	pass.setBindGroup(0, cullBindGroups.layLists);
	pass.dispatchWorkgroups(1);
	if (groups > 0) {
		pass.setPipeline(cullPipelines.placeTrees);
		pass.setBindGroup(0, cullBindGroups.placeTrees);
		pass.dispatchWorkgroups(groups);
	}
	pass.end();
	forestStats.drawCalls = slots.count;
	readListStats(slots);
	return slots;
}
// forestStats.drawn from the GPU's counts now and then (a frame or two late: it is only for showing)
let statsReading = false, statsFrame = 0;
function readListStats(slots) {
	if (statsReading || ++statsFrame % 30 != 0) return;
	statsReading = true;
	const read = device.createBuffer({ label: "forest list counts, read", size: LIST_WORKGROUP * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const encoder = device.createCommandEncoder();
	encoder.copyBufferToBuffer(countsBuffer, 0, read, 0, LIST_WORKGROUP * 4);
	device.queue.submit([encoder.finish()]);
	read.mapAsync(GPUMapMode.READ).then(() => {
		const counts = new Uint32Array(read.getMappedRange().slice(0));
		read.destroy();
		const drawn = new Array(LEVELS + 1).fill(0);
		for (let list = 0; list < slots.lists; list++) drawn[list % LEVELS] += counts[list];
		drawn[LEVELS] = counts[slots.lists];
		forestStats.drawn = drawn;
		statsReading = false;
	}, () => { statsReading = false; });
}
// for testing: the CPU's lists as it last made them (forestGpuCulling off), the same as forestGpuListsForTest gives
export const forestCpuListsForTest = () => ({ lists: new Map(lists.map((members, k) => [k, [...members]]).filter(([, members]) => members.length)), billboards: [...billboards] });
// for testing: the nearest level of detail whose draw calls are made (see listsOnGPU)
export const forestLevelFromForTest = () => gpuSlots?.levelFrom ?? 0;
// for testing: the GPU's lists as the last frame made them, { lists: Map list -> [tree numbers], billboards: [...] }
export async function forestGpuListsForTest() {
	const slots = gpuSlots;
	if (!slots) return null;
	const bytes = Math.min(visibleBuffer.size, (trees.length * 2 + 1) * 4);
	const reads = [[countsBuffer, LIST_WORKGROUP * 4], [startsBuffer, LIST_WORKGROUP * 4], [visibleBuffer, bytes]].map(([buffer, size]) => {
		const read = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const encoder = device.createCommandEncoder();
		encoder.copyBufferToBuffer(buffer, 0, read, 0, size);
		device.queue.submit([encoder.finish()]);
		return read;
	});
	await Promise.all(reads.map((read) => read.mapAsync(GPUMapMode.READ)));
	const [counts, starts, list] = reads.map((read) => new Uint32Array(read.getMappedRange().slice(0)));
	reads.forEach((read) => read.destroy());
	const lists = new Map();
	for (let k = 0; k < slots.lists; k++) if (counts[k]) lists.set(k, [...list.subarray(starts[k], starts[k] + counts[k])]);
	return { lists, billboards: [...list.subarray(starts[slots.lists], starts[slots.lists] + counts[slots.lists])] };
}

//-------------------------------THE FLOOR-------------------------------
/*
	THE FLOOR (floor.js has the map, and what it holds): what the roots and the windthrown trees do to the ground round the camera, drawn
	into the floor map, for the terrain (its mesh and its relief: vf_terrain.js), the grass (vfc_grass.js) and the walker (hunting.js) to stand on.
		THE HEAVE		each root drawn again from straight above (vf_forestFloor): a ribbon along it of the soil over it, heaved where it runs
						shallow under the ground and banked up round it where it comes out, and how much of the ground it covers. The
						trees of the roots' own draw calls (the nearest levels of detail, the ones in view: the ground out of view needs none)
		WINDTHROW		of the big trees that fall most tear their root plate out of the ground as they go (uproots: not a felled one, nor a
						town's), and it stands up on edge as the trunk goes down (vf_forest.js: THE WINDTHROWN). Where it was is a pit; once
						the trunk has rotted away the soil it held falls off it into a mound at the pit's edge. Both soften over the years
						(MARK_YEARS), and the bare earth greens over sooner. The old ones are all over the forest, from before it was planted:
						OLD_THROWS to a square of it MARK_CELL across, about, at places from the land's seed (oldThrows), the same however the
						place is come to. Each is a mark (vf_forestThrows draws its pit and its mound from above): the old ones near, the
						trees lying fallen near, and the ones that have rotted away since (goneMarks)
		WHEN			made again when the camera has moved on a step (floorCamera), when what is drawn has changed (floorDue), and every
						FLOOR_EVERY frames whatever (the marks change with the forest's clock)
	floorRise and rootStep are the same shapes for the walker: how far the pits and mounds put the ground down or up at a place, and how far
	over the ground the top of a root is there
*/
const FLOOR_EVERY = 20;
const MARK_YEARS = 140;				// years for a pit to fill in and its mound to go down, about (they go as e^(-years / MARK_YEARS))
const MARK_CELL = 128;				// world units: the squares the old marks are made in (the same as the cells')
const OLD_THROWS = 3;
const MAX_MARKS = 1024;
const MARK_FLOATS = 8;				// see the Mark struct in vf_forestThrows
const PLATE = 3.2;					// a root plate's radius, against the trunk's (vf_forest.js: the same)
const UPROOT_SHARE = 0.6;			// of the dead trees UPROOT_HEIGHT metres tall or more, how many tear their plate out when they fall
const UPROOT_HEIGHT = 10;
const FLOOR_HIGH = 120;				// world units over the ground: a camera higher than this has no floor map made (it would not see it)

// whether a dead tree tears its root plate out when it falls: from what it is, so the same on every machine. Not one felled (fellTree: it
//		dries out at once, which nothing that dies does), nor a town's
export function uproots(tree) {
	return !tree.planted && !(tree.dryYears < 0.001) && tree.height > UPROOT_HEIGHT * settings.forestUnitsPerMetre && ((tree.seed ?? 0) * 7.31) % 1 < UPROOT_SHARE;
}
const plateOf = (tree) => { const archetype = archetypes[tree.archetype]; return archetype ? archetype.trunkRadius * tree.height / archetype.height * PLATE : 0; };
const markOf = (tree) => ({ x: tree.x, z: tree.z, direction: tree.fallDirection, plate: plateOf(tree), since: tree.fallStart });

// the old marks of a square, made the first time they are asked for
const oldCells = new Map();
let oldFor = null;
function oldThrows(cx, cz) {
	const land = terrain.land;
	if (oldFor !== land) { oldCells.clear(); oldFor = land; }
	const key = cx + ',' + cz;
	let marks = oldCells.get(key);
	if (marks) return marks;
	marks = [];
	const m = settings.forestUnitsPerMetre;
	const random = seededRandom((((cx * 73856093) ^ (cz * 19349663) ^ ((settings.terrainSeed | 0) * 83492791)) >>> 0) + 17);
	const count = Math.floor(random() * (2 * OLD_THROWS + 1));
	for (let k = 0; k < count; k++) {
		const x = (cx + random()) * MARK_CELL, z = (cz + random()) * MARK_CELL;
		const plate = (1.0 + 0.9 * random()) * m, direction = random() * Math.PI * 2, age = 20 + 220 * random();
		if (!land || land.zoneAt(x, z) !== terrain.ZONE_FOREST || land.heightAt(x, z) < settings.waterWorldPosY + 2 * m || land.onPath?.(x, z)) continue;
		// (not where a tree stands now)
		let crowded = false;
		trunksNear(x, z, plate * 2, (tx, tz, r) => { if (Math.hypot(tx - x, tz - z) < plate * 1.3 + r) crowded = true; });
		if (!crowded) marks.push({ x, z, direction, plate, since: -age });
	}
	if (oldCells.size > 4096) oldCells.delete(oldCells.keys().next().value);
	oldCells.set(key, marks);
	return marks;
}
// the ones the forest has made since it was planted, gone with their trees: by their square
const goneMarks = new Map();
let goneCount = 0;
function markGone(tree) {
	if (!tree.dead || clock < tree.fallStart || !uproots(tree)) return;
	const mark = markOf(tree), key = Math.floor(mark.x / MARK_CELL) + ',' + Math.floor(mark.z / MARK_CELL);
	let list = goneMarks.get(key);
	if (!list) goneMarks.set(key, list = []);
	// (long gone ones let go: there is nothing left of them)
	for (let k = list.length - 1; k >= 0; k--) if (clock - list[k].since > MARK_YEARS * 3) { list.splice(k, 1); goneCount--; }
	list.push(mark);
	goneCount++;
}
// every mark within reach of (x, z): the old ones, the fallen trees lying there, the gone ones
function marksNear(x, z, reach, each) {
	for (let i = Math.floor((x - reach) / MARK_CELL); i <= Math.floor((x + reach) / MARK_CELL); i++) {
		for (let j = Math.floor((z - reach) / MARK_CELL); j <= Math.floor((z + reach) / MARK_CELL); j++) {
			for (const mark of oldThrows(i, j)) each(mark);
			for (const mark of goneMarks.get(i + ',' + j) ?? []) each(mark);
			const cell = cellsByKey.get(i + ',' + j);
			if (cell) for (const k of cell.trees) { const tree = trees[k]; if (tree && tree.dead && clock >= tree.fallStart && uproots(tree)) each(markOf(tree)); }
		}
	}
}
// a mark as it is now: its pit's depth and its mound's height (world units), and how bare its earth is
function markNow(mark) {
	const age = clock - mark.since, fallYears = life ? life.fallYears : 1, goneYears = life ? life.goneYears : 1;
	const fell = Math.pow(Math.min(Math.max(age / fallYears, 0), 1), 2);
	const rotted = Math.min(Math.max((age - fallYears - goneYears) / 8, 0), 1);
	const softened = Math.exp(-Math.max(age, 0) / MARK_YEARS);
	return { pit: mark.plate * 0.26 * fell * softened, mound: mark.plate * 0.34 * rotted * softened, bare: Math.exp(-Math.max(age, 0) / 45) };
}
// its shapes at (x, z) (vf_forestThrows: the same): [pit, mound]
function markAt(mark, now, x, z) {
	const R = Math.max(mark.plate, 0.01), dx = Math.cos(mark.direction), dz = Math.sin(mark.direction);
	const u = ((x - mark.x) * dx + (z - mark.z) * dz) / R, w = (-(x - mark.x) * dz + (z - mark.z) * dx) / R;
	const q = ((u - 0.1) / 0.95) ** 2 + (w / 0.85) ** 2, r = ((u - 1.25) / 0.5) ** 2 + (w / 0.95) ** 2;
	return [now.pit * Math.max(1 - q, 0) ** 2, now.mound * Math.max(1 - r, 0) ** 1.5];
}

// the floor map's view: from straight above, round the camera in steps of 32 of its texels
function floorCamera() {
	const snap = FLOOR_SPAN / FLOOR_TEXELS * 32;
	const x = Math.round(settings.camPosX / snap) * snap, z = Math.round(settings.camPosZ / snap) * snap;
	const view = mat4.lookAt([x, 1000, z], [x, 0, z], [0, 0, -1]);
	const projection = mat4.ortho(-FLOOR_SPAN / 2, FLOOR_SPAN / 2, -FLOOR_SPAN / 2, FLOOR_SPAN / 2, 0, 2000);
	return { x, z, matrix: mat4.multiply(projection, view) };
}
const floorOn = () => settings.forestRoots && settings.enableForest && settings.enableTerrain;
let floorLast = null, floorWith = null, floorFrames = 0, floorDue = true, floorShown = false;
const markData = new Float32Array(MAX_MARKS * MARK_FLOATS);
const markBuffer = device.createBuffer({ label: "forest floor marks", size: markData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const throwUniformBuffer = device.createBuffer({ label: "forest floor marks Uniform", size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const floorTarget = { format: FLOOR_FORMAT, blend: { color: { srcFactor: 'one', dstFactor: 'one', operation: 'max' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' } } };
const floorShaderModule = device.createShaderModule({ label: "vf_forestFloor", code: vf_forestFloor });
const floorPipeline = device.createRenderPipeline({
	label: "forest floor heave pipeline", layout: forestPipelineLayout,
	vertex: { module: floorShaderModule, entryPoint: "floorVertex" },
	fragment: { module: floorShaderModule, entryPoint: "floorFragment", targets: [floorTarget] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
});
const throwShaderModule = device.createShaderModule({ label: "vf_forestThrows", code: vf_forestThrows });
const throwPipeline = device.createRenderPipeline({
	label: "forest floor marks pipeline", layout: 'auto',
	vertex: { module: throwShaderModule, entryPoint: "throwVertex" },
	fragment: { module: throwShaderModule, entryPoint: "throwFragment", targets: [floorTarget] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
});
const throwBindGroup = device.createBindGroup({ label: "forest floor marks bind group", layout: throwPipeline.getBindGroupLayout(0), entries: [
	{ binding: 0, resource: { buffer: throwUniformBuffer } }, { binding: 1, resource: { buffer: markBuffer } }] });
// (none to read: the terrain and the grass leave the ground as it is)
function floorOff() {
	if (!floorShown) return;
	device.queue.writeBuffer(floorUniformBuffer, 64, new Float32Array([0, 0, 0, 0]));
	floorShown = false; floorWith = null; floorLast = null;
}
// The frame's, after the forest: first what reads it this frame is told the view the map was last made with (floor.js), then it is made
//		again if it is due (WHEN). draw(pass) draws the roots' draw calls with the floor's pipeline
function floorPass(encoder, draw) {
	// (none, or the camera so high over the ground that none of it would show)
	if (!floorOn() || settings.camPosY - (terrain.land?.heightAt(settings.camPosX, settings.camPosZ) ?? 0) > FLOOR_HIGH) { floorOff(); return; }
	if (floorWith) {
		device.queue.writeBuffer(floorUniformBuffer, 0, new Float32Array([...floorWith, 1, 0, 0, 0]));
		floorShown = true;
	}
	const at = floorCamera();
	const moved = !floorLast || at.x !== floorLast.x || at.z !== floorLast.z;
	if (!moved && !floorDue && ++floorFrames < FLOOR_EVERY) return;
	floorFrames = 0; floorDue = false; floorLast = at;

	// the marks near
	let count = 0;
	marksNear(at.x, at.z, FLOOR_SPAN * 0.5 + 4 * settings.forestUnitsPerMetre, (mark) => {
		if (count >= MAX_MARKS) return;
		const now = markNow(mark);
		if (now.pit + now.mound < 0.01) return;
		markData.set([mark.x, mark.z, mark.direction, mark.plate, now.pit, now.mound, now.bare, 0], count++ * MARK_FLOATS);
	});
	if (count > 0) device.queue.writeBuffer(markBuffer, 0, markData, 0, count * MARK_FLOATS);
	device.queue.writeBuffer(throwUniformBuffer, 0, at.matrix);
	forestStats.floorMarks = count;

	const pass = encoder.beginRenderPass({ label: "forest floor", colorAttachments: [{ view: floorView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] });
	pass.setPipeline(floorPipeline);
	pass.setBindGroup(0, forestBindGroup);
	draw(pass);
	if (count > 0) {
		pass.setPipeline(throwPipeline);
		pass.setBindGroup(0, throwBindGroup);
		pass.draw(6, count);
	}
	pass.end();
	floorWith = at.matrix;
}

// for the walker (hunting.js): how far the pits and mounds put the ground down or up at (x, z), and how far over the ground the top of a
//		root is there (world units; 0 if none)
export function floorRise(x, z) {
	if (!floorOn() || !life) return 0;
	let rise = 0;
	marksNear(x, z, 3 * PLATE * settings.forestUnitsPerMetre, (mark) => {
		if (Math.abs(mark.x - x) > mark.plate * 2.4 || Math.abs(mark.z - z) > mark.plate * 2.4) return;
		const [pit, mound] = markAt(mark, markNow(mark), x, z);
		rise += mound - pit;
	});
	return rise;
}
export function rootStep(x, z) {
	if (!floorOn() || !life) return 0;
	const m = settings.forestUnitsPerMetre, reach = 4.5 * m, twig = 0.012 * m;
	let best = 0;
	for (let i = Math.floor((x - reach) / CELL_SIZE); i <= Math.floor((x + reach) / CELL_SIZE); i++) {
		for (let j = Math.floor((z - reach) / CELL_SIZE); j <= Math.floor((z + reach) / CELL_SIZE); j++) {
			const cell = cellsByKey.get(i + ',' + j);
			if (!cell) continue;
			for (const k of cell.trees) {
				const tree = trees[k];
				if (!tree || tree.planted || Math.abs(tree.x - x) > reach * tree.scale || Math.abs(tree.z - z) > reach * tree.scale) continue;
				if (tree.dead && clock >= tree.fallStart && uproots(tree)) continue;		// (its roots went up with its plate)
				const R = archetypes[tree.archetype]?.roots;
				if (!R) continue;
				const age = life.ageAt(tree, clock), full = TREE_SPECIES[tree.species].fullGrownAge;
				// (into the tree's own frame: vf_forest.js's rootPoint the other way)
				const c = Math.cos(tree.yaw), s = Math.sin(tree.yaw), wx = (x - tree.x) / tree.scale, wz = (z - tree.z) / tree.scale;
				const lx = c * wx - s * wz, lz = s * wx + c * wz;
				for (let p = 0; p < R.length; p += SECTION_FLOATS) {
					if (age <= R[p + 7]) continue;
					const most = Math.max(R[p + 3], R[p + 11]) * 1.7;
					if (lx < Math.min(R[p], R[p + 4], R[p + 8]) - most || lx > Math.max(R[p], R[p + 4], R[p + 8]) + most) continue;
					if (lz < Math.min(R[p + 2], R[p + 6], R[p + 10]) - most || lz > Math.max(R[p + 2], R[p + 6], R[p + 10]) + most) continue;
					for (let n = 0; n <= 8; n++) {
						const t = n / 8, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), d = t * t;
						const px = a * R[p] + b * R[p + 4] + d * R[p + 8], py = a * R[p + 1] + b * R[p + 5] + d * R[p + 9], pz = a * R[p + 2] + b * R[p + 6] + d * R[p + 10];
						const fullRadius = Math.max(R[p + 3] + (R[p + 11] - R[p + 3]) * t, 1e-4), born = R[p + 7] + (R[p + 12] - R[p + 7]) * t;
						const radius = twig + Math.max(fullRadius - twig, 0) * Math.pow(Math.min(Math.max((age - born) / Math.max(full - born, 0.001), 0), 1), 0.9);
						const plate = Math.min(Math.max(py / fullRadius, 0), 1), wide = 1.6 - 0.85 * plate, tall = 0.55 + plate;
						const off = Math.hypot(lx - px, lz - pz), w = radius * wide;
						if (off >= w) continue;
						const top = (py * Math.min(radius / fullRadius, 1) + tall * radius * Math.sqrt(1 - (off / w) ** 2)) * tree.scale;
						if (top > best) best = top;
					}
				}
			}
		}
	}
	return best;
}

// for testing: the marks within reach of (x, z) as they are now; and a tree thrown down by the wind, its plate torn out (as fellTree, not cut)
export function floorMarksForTest(x, z, reach) { const out = []; marksNear(x, z, reach, (mark) => out.push({ ...mark, ...markNow(mark) })); return out; }
export function windthrowForTest(index, direction) {	// (as fellTree, but drying out as one that died would: so it uproots)
 const height = fellTree(index, direction); const tree = trees[index]; if (height > 0 && tree) { tree.dryYears = 0.5; life.changed(index); } return height ? { height, uproots: uproots(tree) } : null; }
export function forestPass(aEncoder, mainpassDepthTexture) {

	// nothing to stand on without the land
	if (!settings.enableForest || !settings.enableTerrain || !life || life.count == 0) {
		floorOff();
		return;
	}

	forestUniformBufferUpdates();
	// (the lists made on the GPU, THE GPU'S LISTS, every draw call there could be drawn from them; or the CPU's)
	const slots = settings.forestGpuCulling ? listsOnGPU(aEncoder) : null;
	const draws = slots ? null : sortTreesIntoDraws();
	if (draws && draws.wood.length == 0 && draws.foliage.length == 0 && draws.billboards.length == 0) {
		floorOff();
		return;
	}
	if (!forestBindGroup || forestBindGroupFiltering !== filteringLevel()) {
		forestBindGroup = createBindGroupForest();
		forestBindGroupFiltering = filteringLevel();
	}

	//(one pass, or while the Performance window is timing, one for each of the three shaders: see renderPassParts in profiler.js)
	const parts = profiler.renderPassParts(aEncoder, {
		colorAttachments: [{
		view: frameTexture().createView(),
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

	// (one draw call each, as the GPU's lists have them: indirect)
	const drawEach = (pass, list) => {
		for (const slot of list) {
			if (slots.levelOf[slot] < slots.levelFrom) continue;		// (a level with no trees this time: see listsOnGPU)
			pass.setBindGroup(1, drawBindGroup, [slot * DRAW_STRIDE]);
			pass.drawIndirect(indirectBuffer, slot * 16);
		}
	};
	let pass = parts.next('Wood', 'vf_forestWood');
	pass.setBindGroup(0, forestBindGroup);
	pass.setPipeline(woodPipeline);
	if (slots) drawEach(pass, slots.wood);
	else for (const draw of draws.wood) {
		pass.setBindGroup(1, drawBindGroup, [draw.slot * DRAW_STRIDE]);
		pass.draw(draw.vertices, draw.instances, 0, 0);		// draw(vertexCount, instanceCount, firstVertex, firstInstance)
	}

	pass = parts.next('Foliage', 'vf_forestFoliage');
	pass.setBindGroup(0, forestBindGroup);
	pass.setPipeline(foliagePipeline);
	if (slots) drawEach(pass, slots.foliage);
	else for (const draw of draws.foliage) {
		pass.setBindGroup(1, drawBindGroup, [draw.slot * DRAW_STRIDE]);
		pass.draw(draw.vertices, draw.instances, 0, 0);
	}

	pass = parts.next('Billboards', 'vf_forestBillboard');
	pass.setBindGroup(0, forestBindGroup);
	pass.setPipeline(billboardPipeline);
	if (slots) drawEach(pass, slots.billboards);
	else for (const draw of draws.billboards) {
		pass.setBindGroup(1, drawBindGroup, [draw.slot * DRAW_STRIDE]);
		pass.draw(draw.vertices, draw.instances, 0, 0);
	}

	parts.end();

	// and the roots again, from above, into the floor map (THE FLOOR)
	floorPass(aEncoder, (floor) => {
		if (slots) {
			for (const slot of slots.roots) {
				if (slots.levelOf[slot] < slots.levelFrom) continue;
				floor.setBindGroup(1, drawBindGroup, [slot * DRAW_STRIDE]);
				floor.drawIndirect(indirectBuffer, slot * 16);
			}
		} else for (const draw of draws.roots) {
			floor.setBindGroup(1, drawBindGroup, [draw.slot * DRAW_STRIDE]);
			floor.draw(draw.vertices, draw.instances, 0, 0);
		}
	});
}
