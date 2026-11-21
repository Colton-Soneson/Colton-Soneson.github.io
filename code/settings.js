import { mat4, vec3, vec2 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

export const settings = {
	//--------------------TIME---------------------
    step: 0,
	dayLengthSeconds: 300,				//how long a day is, in seconds: one round of the sun. Everything that keeps time keeps it by the sun (atmosphere.js): the seasons, the weather, the forest, the deer
	timeCycleMultiplier: 1.0,			//how fast the days go by. Scales the speed of the sun, and with it everything that keeps time by the sun (the forest, the weather, the animals)
	sunCycleCount: 0,					//days so far. Read only: counted in atmosphere.js as the sun goes round
	//---------------------TRS---------------------
    camPosX: 0.0,
    camPosY: 35.0,
    camPosZ: 150.0,
    camFarPlane: 120000.0,	//far enough to see the other land masses (the world's continents across the straits: world.js), and the massifs over them (terrainGenerator.js THE MASSIFS)
    camNearPlane: 1.0,
    gameMode: 'Observe',			//Observe: fly round (cameraControls.js). Hunting (the menu calls it Survival, survival.js): on foot, first person (hunting.js), with boats to sail (boat.js) and the rest from the spawn menu, T (radialMenu.js). Horde: the same, against waves of feral deer (horde.js)
    hordeFirstWave: 10,				//deer in the first round of the Horde game mode
    hordeWaveGrowth: 1.35,			//each round this many times the one before
    hordeMaxWave: 400,				//the most deer in one round
    hordeAliveCap: 120,				//the most out at once (1500 at the most): the rest of the round comes as they go down
    hordeSpeed: 2.5,				//times the deer's own paces (a sprinter chases at 6.3 m/s at 1): all of their walking, trotting and running
    hordeDamage: 5,					//health a deer's lunge takes off (of 100). A super deer's is twice it
    hordeBreakSeconds: 10,			//between one round and the next
    huntingWalkSpeed: 3.0,			//metres a second on foot. Shift runs 2.3x
    buoyancy: 1.15,				//how hard the water pushes up on the boats and a biplane's floats, times what it would (boat.js: FLOATING; plane.js: FLOATS)
    aiDifficulty: 0.5,			//how well the NPCs aim, in every game mode: 0 badly (their spread three times over), 0.5 as they were made, 1 well (a third of it) (ballistics.js: aimSpread)
    boatSteadying: 0.15,			//how much the boats (and a floatplane on the water) are held level, against sea sickness: 0 not at all, 1 no roll or pitch at all, only their heading (boat.js: THE STEADYING)
    horseSpeed: 2.5,				//how many times a real horse's pace the horses go at: the walk, the canter and the gallop (horse.js). 1 = a real horse, a 13.5 m/s gallop
    discGolfEnabled: false,			//a disc golf course laid out on the land (discgolf.js): tee pads and baskets, each hole its own colour
    discGolfHoles: 9,				//how many holes it has
    discGolfSeed: 1,				//which course: New Course moves it on
    enableSound: true,				//the sound: the wind, the sea, the animals, the guns and the engines, all made as it plays (sound.js). It starts once the page is clicked
    soundVolume: 0.8,				//how loud, 0 to 1
    huntingJumpHeight: 0.5,			//metres
    huntingLookSensitivity: 1.0,	//how far the view turns for the mouse moved
    cameraFlyMode: true,		//WASD + right mouse drag, see cameraControls.js. Off = the camera always looks at the origin
    cameraFlySpeed: 120.0,		//units per second. Shift goes 4x, the mouse wheel changes it
    camYaw: 0.0,				//fly camera direction in radians, set from the starting position so it begins looking at the origin
    camPitch: 0.0,
	//-----------------SUN SETTINGS----------------
    sunPosX: 90.0,
    sunPosY: 5.0,
    sunPosZ: -210.0,
    sunColor: vec3.create(0.992, 0.37, 0.325),
    sunIntensity: 75000.0,
	sunCycleAngle: 0.52,				//where the sun is round its circle: 0 is six in the morning, so it starts at eight
	survivalGodMode: false,				//the Survival mode: every equippable in the game on T (the host's, or alone: survival.js)
    sunPadding: 1.0,
	//-----------------MOON SETTINGS---------------
	enableMoon: true,
	moonPosX: -110.0,					//where the moon is, as a direction from the middle of the world like the sun's. While the sun cycle runs it goes round opposite the sun
	moonPosY: 25.0,
	moonPosZ: 140.0,
	moonBrightness: 1.0,				//how strong its light is, on the ground and in the sky. 1 = a clear night under a full moon
	moonSize: 1.8,						//how big its disc looks, degrees from its middle to its edge (the real one is a quarter of a degree: far too small to read on a screen)
	//--------------------SCENE--------------------
	heightMapResolution: 2048,
	topDownCameraHeight: 60.0,
	//-------------------SHADOWS-------------------
    shadowMapSize: 2048,
	shadowMapPCFKernelSize: 1,
	shadowMapAcneBias: 0.005,
	shadowMapCenter: [0.0, 0.0, 0.0],	//where the shadow map's box is centered: on the buildings, wherever the land generation put them (placeBuildings in terrain.js). Read only
	//-----------------POST EFFECTS----------------
	enablePostEffects: true,			//everything in this block: effects worked out from the finished frame instead of the scene. See screenEffects.js
	enableSunShadows: true,				//the sun's shadow maps round the camera: the trees and the bushes cast shadows on the land, the grass, the plants and each other (sunShadows.js)
	enableScreenShadows: true,			//the sun's shadows, found in the frame's own depth (Bend Studio's method from Days Gone, see c_SSS.js)
	screenShadowStrength: 1.0,			//1 = a shadowed pixel loses all of its sun light, 0 = none of it
	screenShadowThickness: 0.005,		//how thick whatever casts a shadow is taken to be, as a share of the depth behind it. Bigger = heavier shadows, that start to come loose from what casts them
	screenShadowContrast: 4.0,			//how sharply a pixel goes from lit to shadowed
	enableSSAO: true,					//ambient occlusion: corners and crevices get less of the sky's light
	ssaoRadius: 3.0,					//how far around a pixel it looks, world units
	ssaoStrength: 1.0,
	enableSSR: true,					//the water reflects the land and the trees as well as the sky, found on the screen
	ssrStrength: 1.0,
	ssrDistance: 1500.0,				//water further from the camera than this only reflects the sky
	displayScreenShading: false,		//shows the shadows and the ambient occlusion on their own
	//-------------------DISPLAY-------------------
	renderResolution: 1080,				//how many pixels the picture is drawn with across the short side of the window: 2160 (4K), 1440, 1080, 900, 720, 540 or 480. The canvas fills the page whatever this is, see display.js
	dynamicResolution: false,			//draw at less than renderResolution while the frame rate is under the target, back up when there is room (see DYNAMIC RESOLUTION in display.js). On in the Low and Very Low presets
	dynamicResolutionTarget: 30,		//the frame rate dynamic resolution keeps to, 0 to 60
	reversedDepth: true,				//the frame's depth buffer reversed-Z, 32 bit float: about as fine far off as near (no flicker in the distance). Takes effect when the page loads (see depthMode.js)
	antiAliasing: "smaa",				//smooths the stair steps along edges. From the finished frame: "smaa" (see vf_smaa.js), "fxaa" (vf_fxaa.js). With the frames before (temporalAA.js): "taa", "taa+fxaa", and FSR 3 (fsr3.js) "fsr-native", "fsr-quality", "fsr-balanced", "fsr-performance" (drawn at less, and upscaled). Or "off"
	smaaEdgeThreshold: 0.1,				//SMAA: how much the brightness has to change between two pixels to count as an edge. Lower finds fainter edges and costs more
	fxaaSubpixel: 0.75,					//FXAA: how much anything smaller than a pixel (a far blade of grass) is softened into what is round it. 0 = edges only
	fxaaEdgeThreshold: 0.125,			//FXAA: how much the brightness has to change for it to count as an edge. Lower smooths more of the picture and costs more
	anisotropicFiltering: 8,			//1 (off), 2, 4, 8 or 16: keeps pictures sharp on surfaces seen at a low angle. See textureFiltering.js
	//-------------------TERRAIN-------------------
	enableTerrain: true,
	observeInspectRadius: 2000,			//metres: V held in the Observe mode shows every NPC, town, train, cart and horse within this (highlights.js)
	worldViewDistance: 2500,			//metres: in the whole world (worldTiles), how near a tile of it has to be for it to be streamed in and drawn (its land, its forest, its towns, its people and animals). Further, it goes, and only the world tracker keeps its towns going (townEconomy.js)
	worldTiles: true,					//the whole world (world.js): today's island the home tile of a world of 40 land tiles in continents and 30 of sea, the rest endless sea, each tile streamed in as you come near it. Off: the one island
	terrainSeed: 11,					//which world. The same seed always makes the same islands
	terrainWorldSize: 8192.0,			//width of the square of world that gets land, centered on the origin
	terrainResolution: 2048,			//(at most 2048: TERRAIN_RESOLUTION_MOST in terrain.js) how fine the mesh is next to the camera: what the world would be across at that fineness. 256, 512, 1024 (1k), 2048, 4096 or 8192 (8k, a vertex every 1 unit). (Only these: the chunks halve in size, so anything in between draws the same as the next one down. At 256 they never halve at all, a vertex every 32 units)
	terrainFarBake: 128,				//how far off land is drawn: from a picture of each chunk this many texels wide, taken once (0 = worked out live). 256 is sharper and takes four times the memory, see THE BAKE in terrain.js
	terrainDetailDistance: 1.25,		//how far the fine mesh reaches: a chunk of land is drawn at half the fineness once it is this many times its own width away. (2.0 drew more triangles than there are pixels, and the GPU shades pixels in 2x2 blocks, so much of that shading was wasted: 1.25 looks the same and the terrain pass takes about a fifth less)
	terrainLandScale: 4200.0,			//size of the biggest shapes in the coastline. Bigger = fewer and larger land masses
	terrainSeaFloorDepth: 160.0,		//how deep the drop-off at the edge of the shallows goes, before the sea bed settles to its steady grade
	terrainSeaBedGrade: 0.42,			//how steeply the sea bed keeps going down from the drop-off out to the edge of the land: 0.42 is 42 down for every 100 out. 0 = a flat sea floor
	terrainShelfWidth: 3.0,				//how far the shallows run out from a beach before the sea bed drops away. 1 = a short step off the sand, 3 = three times that
	terrainHillHeight: 1.0,				//how much the grassland rolls. 0 = flat, 1 = hills a few dozen units high
	terrainWoodland: 0.5,				//how much of the grassland is wooded, 0 to 1. The forest round the mountains is there whatever this is
	terrainLakes: 0.5,					//how much of the low ground is hollowed out into lakes and ponds, 0 to 1
	terrainMountainHeight: 1400.0,		//how high the mountain ranges are pushed up (world units, 2 to the metre), and how steep their slopes stand, against how fast their rivers wear them down (terrainGenerator.js: THE SHAPE OF THE LAND). A range is only as high as its land is wide lets it: at this, about 450 m on the home island (the Oregon Coast Range's ridges), 1500 to 2000 m in the heart of a big continent (THE HEART OF A CONTINENT)
	terrainBeachHeight: 3.5,			//land lower than this above sea level is beach
	terrainBankHeight: 1.5,				//the step up from the top of the sand to the grass behind it. 0 = no step
	terrainSnowLine: 2000.0,			//mountain higher than this above sea level is snow (and the bare rock, above the trees, starts a little under it: 0.7 of it). 1000 m: the big continents' ranges go up into it, the home island's do not
	terrainRockVeins: 1.0,				//how strongly the pale marble veins show on bare rock. 0 = plain stone
	terrainGroundDetail: 1.0,			//how strongly the sand of the beaches, the turf of the grassland and the litter under the trees show. 0 = flat color
	terrainDepthBias: 1.0,				//how much of the relief of all three goes in to the frame's depth, where the screen space shadows and ambient occlusion find it. 0 = none
	terrainRockDetail: 1.0,				//how strongly the cracks and ledges the shader draws on bare rock show. 0 = lit by the mesh alone
	terrainTownCount: 2,				//seaside towns: on the shore where the mountains come down near the sea, up a hill of their own (townLayout.js, town.js). 0 to 4
	terrainTownSize: 1.0,				//how big each one is: 1 = about 340m along the shore and 165m up the hill
	terrainTownDensity: 2.0,			//how many towns the other lands have (world tiles): 1 = most tiles one or two, 0 = none, 2 = two on every tile, 4 = four on every tile (world.js: TOWNS)
	terrainPlains: 0.54,					//how flat the broad valley floors at the feet of the mountains are laid (terrainGenerator.js: THE PLAINS), 0 to 1. 0 = none
	terrainPlainsSize: 0.7,				//how big the patches of plains are, and how far apart. 2 = twice as big
	terrainRolling: 1.0,				//the gentle swell over the open grassland (terrainGenerator.js: THE ROLL), on top of Hill Height. 0 = none
	terrainMassifInland: 1.0,			//how far in from the sea the big ranges of a continent stand (terrainGenerator.js: MASSIF.inland, 4000 units at 1). 0 = they may come right down to the shore
	terrainMassifHeight: 0.45,			//how high the big ranges are raised. 0 = none, the land as its rivers wear it
	terrainLakeSize: 1.0,				//how big the highland lakes are (terrainGenerator.js: THE HIGHLAND LAKES): how far up its valley each fills. 2 = twice as far (Lakes: how many)
	terrainRailGrade: 0.12,				//how steep the main line may climb (terrainGenerator.js: RAIL.grade): 0.12 is 12 up for every 100 along. Steeper and it goes over more of the hills, gentler and it is cut and banked more
	terrainLandingStrip: true,			//a landing strip by the first town: a straight, even path of packed earth for the biplane (see THE LANDING STRIP in terrainGenerator.js, plane.js)
	terrainFootpaths: true,				//worn earth paths between the towns and the strip, over the passes, up to lookouts, through the forests, down to the lakes and the beaches (footpaths.js)
	townEconomyPace: 1,					//how fast the towns' economy goes (townEconomy.js): its days, times this. 1: by the world's clock
	enableTownFolk: true,				//the towns' people: one to every building, its trade the building's (townFolk.js)
	enableNPCs: true,					//the people out in the world: riders between the towns, the airmen of the landing strip, the schooner's crew and the dinghies' sailors (npcs.js)
	//--------------------GRASS--------------------
	enableGrass: true,
	hdVegetation: true,					//HD Textures and Models: the trees, the bushes, the flowers, ferns and mosses drawn with about twice the triangles, and their leaves, needles and petals drawn with their veins, teeth and streaks (vf_forest.js: THE HD CARDS, THE HD LEAVES; floraKinds.js: HD; vf_flora.js: THE HD TEXTURES)
	enableRiverFlecks: true,			//bits of foam carried on the rivers near the camera, going round whatever stands in the water (riverFlecks.js)
	enableFlora: true,					//the plants: ferns, mosses, mushrooms and flowers, bushes and wild wheat (flora.js)
	floraDensity: 1.0,					//how many of the small plants: 2 = twice as many
	floraDrawDistance: 130,				//metres out the small plants are drawn (the bushes and the wild wheat: 220)
	grassTotalBladeCount: 700000,	//blades drawn, shared out over the level of detail rings around the camera. Most are skipped wherever there is no grassland
	grassTotalHARDLIMIT: 2000000,	//top of the blade count slider. Nothing is stored per blade any more, so this is only about how much the GPU can draw
	grassDrawDistance: 900.0,		//how far from the camera the grass reaches. The rings stretch to reach it: the grass at your feet stays as thick, the far grass thins
	//level of detail: rings round the camera, each reaching further than the last with a coarser grid of blades (see vfc_grass.js)
	grassLodRings: 6,				//how many rings, 1 to 8. More rings = a gentler thinning out, and more of the blades spent far away
	grassLodNearDistance: 60.0,		//how far the first ring reaches: the grass at full thickness, every blade a curved strip
	grassLodFarBlades: 0.8,			//how many blades a ring gets next to the ring inside it. 1 = every ring the same number, 0.5 = each ring half the one before
	//clumps: the blades grow in tufts, and take after the tuft they are in (see CLUMPS in vfc_grass.js)
	grassClumpSize: 1.6,			//how far apart the tufts are, world units
	grassClumpPull: 0.6,			//how far the blades are drawn in to the middle of their tuft, 0 to 1. 0 = spread evenly
	grassClumpHeight: 0.75,			//how much a tuft is tall or short as a whole, 0 to 1
	grassClumpFacing: 0.65,			//how much the blades of a tuft lean out from its middle together, 0 to 1. 0 = every blade its own way
	grassClumpColor: 0.6,			//how much a tuft is one shade of green, 0 to 1
	grassBladeHeight: 1.7,			//height of an average blade, world units
	grassBladeWidth: 0.16,			//width of a blade at its root, in the ring nearest the camera
	grassWindStrength: 1.0,			//how far the wind pushes the tips over
	//-------------------BOULDERS------------------
	enableBoulders: true,
	landOcclusion: true,				//trees and boulders behind a hill are not drawn: see horizon.js
	boulderAmount: 1.0,					//how many boulders there are: at the foot of the mountains, under the trees, in the grass, along the top of the beaches, out in the sea and on the ridges. 1 = about twenty thousand in all, 0 = none
	boulderDrawDistance: 2500.0,		//how far off they are drawn
	//--------------------FOREST-------------------
	enableForest: true,
	forestSeed: 1,						//which forest. The same seed on the same land always plants the same trees
	forestUnitsPerMetre: 2.0,			//the trees are made in metres, from real ones. 2 fits the buildings: the lighthouse is 44 units tall, about 22m
	forestTreeSpacing: 9.0,				//distance between full grown trees where the forest is thickest. Thinner forest and wider trees stand further apart
	forestMaxSlope: 0.4,				//the steepest ground a tree grows on: 0 only dead flat, 1 anything
	forestConiferShare: 0.5,			//0 all broadleaf, 1 all conifer. The land still shifts it: conifers take the high and steep ground
	forestMaxTrees: 150000,				//planting stops here however much forest there is left to fill, and no seed comes up while there are this many (a tile's: a continent's tile of forest planted full is about 480000)
	forestLifeCycle: true,				//the trees grow, die, fall and seed as the days go by. Off = the forest stays as it is
	forestYearsPerSunCycle: 1.0,		//years a tree ages in one day. Real trees take 45 (birch) to 100 (oak) years to grow up, so at 1 a forest changes slowly, as one would (at 150 a tree is grown in under a day: 5 minutes, see dayLengthSeconds)
	forestYear: 0,						//the forest's clock. Read only
	forestTreeCount: 0,					//trees standing, living and dead. Read only
	forestDetailDistance: 60.0,			//closer than this a full grown tree is drawn in full: every branch, every piece of foliage
	forestMidDistance: 180.0,			//and closer than this with its thicker branches and half its foliage. Smaller trees drop detail sooner
	forestThinnedRings: 2,				//0 to 2: rings between the mid distance and the billboards where the trees are drawn thinned, fewer and bigger pieces of foliage on coarser wood (see the levels of detail at the top of forest.js)
	forestBillboardDistance: 420.0,		//further off than this a tree is a billboard: 2 flat cards with its picture on
	forestDrawDistance: 5000.0,			//how far off trees are drawn at all
	forestRoots: true,					//the trees' roots, running out over the ground from the foot of the trunk (treeGenerator.js: THE ROOTS), near the camera
	forestGpuCulling: true,				//which trees are drawn, and how, worked out on the GPU for every tree, every frame (forest.js: THE GPU'S LISTS). Off: on the CPU, a square of ground at a time
	forestWindStrength: 1.0,			//how far the wind bends the trees
	//-------------------SEASONS-------------------
	seasonMode: "auto",					//"auto": the seasons go round with the days (see weather.js). Or hold it at "spring", "summer", "fall" or "winter"
	seasonStart: "summer",				//which season the first day is in
	seasonLength: 1,					//days in a season: at 1 a year is four days (20 minutes, see dayLengthSeconds)
	seasonNow: "summer",				//what the season is. Read only
	snowbuildTriggers: 0,				//counts presses of the Trigger Snowbuild control: each one sets snow building on the ground, whatever the season
	snowCover: 0,						//how much snow is lying, 0 to 1. Read only
	//--------------CLOUDS AND WEATHER-------------
	enableClouds: true,
	weatherMode: "auto",				//"auto": two weathers a day, drawn by lot (see weather.js). Or hold it at "sunny", "overcast", "storm", "thunderstorm", "winter storm", "tornado" or "hurricane"
	weatherSeed: 1,						//which run of weather. The same seed gives the same weather on the same day
	weatherNow: "sunny",				//what the weather is. Read only
	cloudForceTower: false,				//while the weather is held: stand a cumulonimbus in the sky (on "auto" one comes with 1 storm in 5 that follows sunny weather)
	enableLightning: true,				//lightning in the storms that have it (see lightning.js). On "auto" which storms do is drawn by lot, more of them in summer
	lightningRate: 1.0,					//how often it strikes. 1 = every few seconds
	cloudForceShelf: false,				//stand a shelf cloud off the coast south of the start, whatever the day drew (on "auto" 1 day in 10 has one, somewhere round the edge of the world)
	cloudCoverageBias: 0.32,				//more (+) or less (-) cloud than the weather asks for
	cloudDensity: 0.65,					//how thick the cloud is. Thicker cloud is darker underneath and casts a heavier shadow
	cloudLayers: 1,						//1: the low layer only (the heaps), 2: and the high layer far above it (cirrus, and the grey sheet of an overcast day: without it overcast is only dimmer), 3: and a middle layer between them (altocumulus)
	cloudCrispness: 0.17,				//how sharp the edge of a heaped cloud is, 0 to 1. 0 = soft all the way out, 1 = a hard white rim
	cloudHeight: 100,					//lifts or lowers every layer of cloud, world units
	cloudSizeX: 1.5,					//how big the clouds are across, east to west: the heaps, their billows and heads, and the fields of them (clouds.js: THE CLOUDS' SIZE and THE HEAPS)
	cloudSizeZ: 1.0,					//and north to south
	cloudSizeY: 0.8,					//how tall the clouds stand: every heap and layer this many times taller, its bottom raised half as much (at 1 the heaps stand from about 900 m up to 2.2 km tall, 4 km on a towering day, and the cirrus is about 8 km up)
	cloudDriftSpeed: 6.5,				//how many times faster than the wind at the ground the clouds drift
	cloudSteps: 53,						//steps along each ray through the clouds. More is smoother and costs more
	cloudResolution: 0,					//the clouds are marched at the size of the frame divided by this: 1 (full), 2 (half), 3 or 4 (a quarter). 0: dynamic, by how near the cloud is (see the next two). The march is most of what they cost
	cloudFullResWithin: 1200,			//dynamic: cloud nearer than this (metres) is marched at the frame's full size, twice as far at half, four times as far at a quarter, and so on down to the next
	cloudCoarsest: 8,					//dynamic: the coarsest the furthest cloud is marched at, 4 (a quarter of the frame's size) or 8 (an eighth)
	cloudUpdateEvery: 3,				//every how many frames each pixel of the clouds is marched again, 1 to 16. Between, it carries over what it drew before (moved with the camera and the wind): each frame marches only one pixel in this many, spread evenly over the screen, so the clouds cost about that many times less (vfc_clouds.js: THE UPDATE RATE)
	// THE HEAPS, their lighting and the layers above them (clouds.js, vfc_clouds.js): every number of the look, to adjust
	cloudHeapAmount: 0.3,	//how many of the cells the weather has cloud over grow a heap (more: a closer field of them)
	cloudPuffAmount: 0.45,	//and how many grow the small puffs, between the heaps and on their flanks
	cloudHeapSpacing: 3,	//how far apart the heaps stand, and so how big they are: their cells, times the size across (1: 2.2 km)
	cloudHeapWidth: 1.5,	//how much of its cell a heap fills
	cloudLobes: 1.55,	//how far the lobes of a heap stick out of its round footprint
	cloudHeapLean: 0.46,	//how far a heap leans over downwind for every unit it stands up
	cloudBulbSize: 2.8,	//the size of the round heads a heap is made of (the cauliflower)
	cloudBulbDepth: 0.82,	//how deep the creases between the heads cut, of the way in
	cloudEdgeSoftness: 0.86,	//how far in from its surface a heap is thick all the way, of its height and radius: more, softer and more eaten
	cloudBaseRagged: 320,	//how uneven the flat bottom of a heap is, world units
	cloudWispiness: 0.36,	//how much the fine noise wears the edges of a heap
	cloudBaseScale: 1.5,	//the bottom of the heaps, times the weather's (1: about 900 m on a fair day)
	cloudHeapTop: 5800,	//how tall the tallest heap of a fair day stands over its bottom, world units (times Size Y)
	cloudToweringTop: 19600,	//and of a towering day (storms, and More Towering)
	cloudTowering: 0.28,	//more (+) or less (-) towering than the weather makes them: + stands towering cumulus on a fair day
	cloudHeightVariety: 0.83,	//how different the heaps are in height: 0 all as tall as they can be, 1 from a fifth of that up
	cloudSteepness: 1.65,	//how steep the sides of a heap are, and how flat its top: less, a rounder dome
	cloudTowerTop: 13250,	//how high a cumulonimbus stands above the sea, world units
	cloudTowerWidth: 5.2,	//and how wide, times the weather's
	cloudDeckFrom: 0.62,	//the weather's coverage from which a deck of cloud lies under the heaps (a storm's): over 1, never
	cloudDeckDepth: 2,	//how deep that deck is, times the weather's depth
	cloudSunStrength: 1.0,	//how strongly the sun (or the moon) lights the clouds
	cloudAmbient: 1.6,	//how strongly the sky lights them, from all round
	cloudForwardScatter: 0.75,	//how much of the light goes straight on through (the bright rim of a cloud in front of the sun): Henyey-Greenstein g
	cloudBackScatter: 0.25,	//and how much comes back towards the sun (a cloud brightening with the sun behind the viewer)
	cloudBackShare: 0.4,	//how much of the scattering is the back glow
	cloudMultiScatter: 0.7,	//how much light bouncing about inside a cloud adds (each bounce keeps this much of the last): more, a whiter, brighter cloud
	cloudScatterDepth: 0.22,	//how much less of the cloud each bounce is dimmed by: less, light reaches deeper in
	cloudShadowStrength: 1.0,	//how dark a cloud's own shadow is inside it
	cloudShadowReach: 1.0,	//how far towards the sun the shadow is looked for (one heap shading the next)
	cloudCrevices: 0.7,	//how much darker the thin edges and the creases between heads are than the body
	cloudUndersides: 0.4,	//how much darker the bottom of a heap is
	cloudCirrusAmount: 1.45,	//how much high cloud there is, times the weather's
	cloudCirrusHeight: 16000,	//the bottom of the high layer above the sea, world units
	cloudCirrusScale: 2.4,	//how big its streaks and fibres are
	cloudMiddleAmount: 1,	//how much middle cloud there is (Layers 3), times the weather's
	cloudMiddleHeight: 9500,	//the bottom of the middle layer above the sea, world units
	cloudMiddleScale: 2.5,	//how big its heaps are
	cloudLightSteps: 6,	//steps of the walk towards the sun from every step of a ray that lands in cloud: more, finer shadows and more cost
	cloudSkipping: true,	//cross the clear air between the heaps in long strides (the heaps' map says how far is clear). Off: every step is taken, for comparing
	cloudFarDetail: 3000,	//how far off the fine wear of the edges of a heap starts to go (it is finer than a pixel further off, and only grain)
	cloudDrawDistance: 80000.0,			//how far off clouds are drawn. They fade into the haze over the last part of it
	displayCloudCoverage: false,
	//--------------------BIRDS--------------------
	enableDeer: true,					//small groups of deer living in the forest, going down to the water to drink three times a day. See deer.js
	deerGroups: 4,						//how many groups, 0 to 200. Each is 1 to 3 deer. Past about 40 the homes are closer together (see THE GROUPS in deer.js)
	deerSize: 1.0,						//1 = life size
	enableRabbits: true,				//rabbits in the woods, and out on to the grassland and the marshes. See rabbits.js
	enableCritters: true,				//the towns' cats, and rats in the towns and the grassland. See critters.js
	enableBeasts: true,					//moose, wolves and bears, which fight back. See beasts.js
	enableFish: true,					//schools of fish, six kinds, in the ponds and the sea. See fish.js
	enableWhales: true,					//a few whales out in the deep, and the schooners after them. See whaling.js
	enableGeese: true,					//one skein of geese, high up in a V most of the time, now and then down on a lake or a marsh. See geese.js
	geeseCount: 7,						//how many geese in it, 0 to 12
	geeseSize: 8.0,						//from wing tip to wing tip, world units (about two and a half times life size, or they would be specks that high up)
	enableBirds: true,					//hawks: small groups that soar over the grassland by day and roost in the forest by night. See birds.js
	birdGroups: 3,						//how many groups, 0 to 3. Each is 1 to 5 birds
	birdSize: 6.0,						//from wing tip to wing tip, world units (twice life size: a real one would be a speck from the ground)
	birdSpeed: 1.0,						//how fast they fly. 1 = about 13 metres a second
	//----------LIGHT SHAFTS AND UNDER WATER--------
	enableLightShafts: true,			//shafts of sun in the air between the clouds (crepuscular rays). They show while the sky is part cloud and part clear. See vf_lightShafts.js
	lightShaftStrength: 1.0,
	enableUnderwater: true,				//with the camera under the sea: the water's color and murk, the surface from underneath, caustics on the sea bed and shafts of light in the water
	underwaterStartDepth: 0.25,			//metres the camera has to be under the water's surface (the waves counted) before it is seen as under the water: a little lower than the camera, so a swimmer's eyes in the waves do not flicker it on and off
	causticStrength: 1.0,				//how strongly the waves gather and spread the light under them
	//------------------PARTICLES------------------
	enableLeaves: true,					//in the fall, leaves blow off the trees near the camera and are carried on the wind. See particles.js
	leavesAllYear: false,				//have them come down in every season
	leafAmount: 1.0,					//how readily they let go. They let go more readily in a wind whatever this is
	leafSize: 0.42,						//half the length of a leaf, world units (bigger than life: a real one would be a speck)
	leafWeight: 1.0,					//how heavy a leaf is for its size. 1 falls at about 2 metres a second in still air, heavier falls faster and is carried less far
	enableSeaSpray: true,				//spray and mist off the crests of the waves round the camera
	sprayAmount: 0.8,					//how much of it, 0 to 1
	enableRain: true,					//rain, near the camera, wherever the cloud overhead is deep enough to rain (storms)
	rainAmount: 1.0,					//how heavy, 0 to 1
	rainDistance: 45.0,					//how far from the camera it is drawn
	enableSnow: true,					//snow, in the same places, when the storm is a winter storm
	snowAmount: 1.0,					//how heavy, 0 to 1
	//--------------------WIND---------------------
	//the wind is waterWindSpeed (metres per second) blowing along windDirection, both down in the water settings. See wind.js
	windDirectionAngle: 45.0,			//which way the wind blows, in degrees round from +x towards +z. Moving it sets windDirection
	windGustiness: 0.7,					//how uneven the wind is from place to place. 0 = the same everywhere, 1 = from dead calm to twice the wind speed
	windGustSize: 900.0,				//world size of one tile of the wind texture: about three gusts fit across it
	windGustSpeed: 2.0,					//how fast the gusts cross the ground, in wind speeds. 1 = at the speed of the wind
	//--------------------WATER--------------------
	enableWater: true,
	enableRivers: true,					//the rivers' water (rivers.js). Their channels are in the land either way (terrainGenerator.js THE RIVERS)
	windDirection: vec2.create(1.0,1.0),
	waterWaveSteepness: 0.1,	//0 - 1
	waterWaveLength: 10.0,
	waterTileResolution: 512.0,			//cells along a side of the mesh of the tile under the camera. Each ring of tiles further out has half as many
	waterSeed: 1,						//which sea: the waves are drawn from this (see gaussianNoise in water.js). The same seed, the same waves, on every machine
	waterCascadeResolution: 256,		//texels along a side of each of the 3 cascades of waves, the size of their FFTs: 128, 256 or 512. See the cascades in water.js
	waterTileInstanceCount: 5,
	waterWorldPosY: -16,
	waterWindSpeed: 5.0,				//the wind over the land, metres per second: the grass, the trees, the clouds. See wind.js
	waterOceanWindSpeed: 11.0,			//the wind over the open sea, metres per second: it blows harder there, with nothing in its way. The wind sea grows with it (JONSWAP): 5 is a gentle breeze, 11 white horses everywhere, 20 a gale. The weather adds to it as it does over the land
	waterFetch: 300.0,					//kilometres of open water the wind has blown over. Past a few hundred the waves are as big as the wind can make them
	waterGridSize: 1024.0,
	waterHorizonFogDistance: 14000.0,	//the haze: distance where anything (the water, the land, the trees, everything but the clouds) is about two thirds faded into the haze along the horizon
	waterClarityDepth: 2.0,				//depth of water where the sea bed has faded to about a third, fully hidden by 2x this. 0 = opaque water
	waterFullDepth: 20.0,				//water deeper than this gets the full open ocean waves
	waterShallowRippleScale: 0.02,		//height of the spikey ripples that replace the waves in shallow water
	//chop and foam
	waterChoppiness: 1.25,				//lambda in the tessendorf paper. Around 1.0 is where crests start folding over themselves
	waterFoamThreshold: 0.5,			//foam starts where the jacobian (how squeezed the surface is, 1 = not at all) drops below this
	waterFoamFade: 0.4,					//how far below the threshold until the foam is fully white
	//shore waves
	enableBoulderWater: true,			//the sea round boulders standing in it: pushed round them, piled up against them, white water and spray where the waves hit
	waterShallowRideHigh: true,			//waves over shallow water ride high: troughs lifted towards the still water, crests taller, instead of dipping under it before they run in
	//deep sea swell
	waterDeepSeaDepth: 219.0,			//the depth of the open sea, for its spectrum: waves long enough to feel the bottom are a little smaller and slower
	waterSwellHeight: 20.0,				//significant wave height of the swell (the average of the highest third of its waves, trough to crest), world units. The odd wave is near twice this. 0 turns the swell off
	waterSwellLength: 500.0,			//wavelength of the swell's peak, world units. 500 (250m) is a swell with about 13 seconds between crests
	waterSwellSpread: 0.75,				//0 = crests as short and broken as the wind sea's, 1 = long straight swell lines
	waterSwellDirection: 25.0,			//degrees off the wind the swell runs. It comes from storms far away, so it doesnt have to follow the local wind
	//------------ATMOSPHERIC SCATTERING-----------
	enableAtmosphere: true,
	atmosphereScaleToScene: 1.0,
	additionalAltitude: -40.0,	// horizon line correction (this is because I dont have enough distance in far plane, KEEP THIS for optimization perposes
	atmosphereNeedsTransmittanceRebuild: true,
	atmosphereViewLUTTextureSizeX: 192,
	atmosphereViewLUTTextureSizeY: 108,
	atmosphereTransmittanceTextureSizeX: 256,
	atmosphereTransmittanceTextureSizeY: 64,
	atmosphereSunRotationDemo: true,
	//--------------------DEBUG--------------------
    showDebug: true,
	showDebugIcons: false,
    activateSkybox: false,
	displayHeightMap: false,
	displayDepthMapDebugRange: 0.5,
	displayShadowMapDepth: false,
	displayOceanSpectrum: false,
	displayWaterInitialHeight: false,
	displayWaveHeightRealization: false,
	displayWaterPreComp: false,
	displayWaterFFT: false,
	displayWaterShifted: false,
	displayWaterDisplacementSpectrum: false,
	displayWaterDisplacement: false,
	displayShoreDistance: false,
	displayShoreDistanceDebugRange: 150.0,	//world distance from land that shows as full white, the shore field tops out at 150
	displaySkyViewLUTtexture: false,
	displayTransmittanceLUTtexture: false,
	displayWindTexture: false,
	displayLightingMode: 0,
	debugTextureRescaleSize: 512.0
};
// A SAVE BEING LOADED (saveGame.js): it was put in the session's storage and the page loaded again. Here, before anything else reads the
//		browser's storage or the settings (everything imports this first), what it keeps in the browser is written back (the inventory, the
//		body, the bank, the cabins, the towns' treasuries and economy...) and its world's settings put in. The rest (the clock, where the
//		player is, the houses, the camps...) saveGame.js puts back once the world is made
export const SAVE_LOADING = 'survivalSaveLoading';
export const savedWorld = (() => {
	let save = null;
	try {
		const raw = sessionStorage.getItem(SAVE_LOADING);
		if (!raw) return null;
		sessionStorage.removeItem(SAVE_LOADING);
		save = JSON.parse(raw);
	} catch (e) { return null; }
	try { for (const [key, text] of Object.entries(save.stored ?? {})) if (typeof text == 'string') localStorage.setItem(key, text); } catch (e) { /* (nowhere to keep it) */ }
	for (const [key, value] of Object.entries(save.world?.settings ?? {})) {
		if (!(key in settings)) continue;
		if (ArrayBuffer.isView(settings[key]) && Array.isArray(value)) settings[key].set(value);
		else if (typeof value == typeof settings[key]) settings[key] = value;
	}
	settings.gameMode = 'Hunting';
	return save;
})();
