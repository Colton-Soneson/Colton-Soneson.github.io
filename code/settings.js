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
    camFarPlane: 12000.0,	//far enough to see the other land masses
    camNearPlane: 1.0,
    gameMode: 'Observe',			//Observe: fly round (cameraControls.js). Hunting (Hunting and Sailing): on foot, first person (hunting.js), with boats to sail (boat.js) and the rest from the spawn menu, T (radialMenu.js). Horde: the same, against waves of feral deer (horde.js)
    hordeFirstWave: 10,				//deer in the first round of the Horde game mode
    hordeWaveGrowth: 1.35,			//each round this many times the one before
    hordeMaxWave: 400,				//the most deer in one round
    hordeAliveCap: 120,				//the most out at once (600 at the most): the rest of the round comes as they go down
    hordeSpeed: 2.5,				//times the deer's own paces (a sprinter chases at 6.3 m/s at 1): all of their walking, trotting and running
    hordeDamage: 5,					//health a deer's lunge takes off (of 100). A super deer's is twice it
    hordeBreakSeconds: 10,			//between one round and the next
    huntingWalkSpeed: 3.0,			//metres a second on foot. Shift runs 2.3x
    horseSpeed: 2.5,				//how many times a real horse's pace the horses go at: the walk, the canter and the gallop (horse.js). 1 = a real horse, a 13.5 m/s gallop
    discGolfEnabled: false,			//a disc golf course laid out on the land (discgolf.js): tee pads and baskets, each hole its own colour
    discGolfHoles: 9,				//how many holes it has
    discGolfSeed: 1,				//which course: New Course moves it on
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
	sunCycleAngle: 0.0,
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
	antiAliasing: "smaa",				//smooths the stair steps along edges, working from the finished frame. "smaa" (see vf_smaa.js), "fxaa" (vf_fxaa.js) or "off"
	smaaEdgeThreshold: 0.1,				//SMAA: how much the brightness has to change between two pixels to count as an edge. Lower finds fainter edges and costs more
	fxaaSubpixel: 0.75,					//FXAA: how much anything smaller than a pixel (a far blade of grass) is softened into what is round it. 0 = edges only
	fxaaEdgeThreshold: 0.125,			//FXAA: how much the brightness has to change for it to count as an edge. Lower smooths more of the picture and costs more
	anisotropicFiltering: 8,			//1 (off), 2, 4, 8 or 16: keeps pictures sharp on surfaces seen at a low angle. See textureFiltering.js
	//-------------------TERRAIN-------------------
	enableTerrain: true,
	terrainSeed: 11,					//which world. The same seed always makes the same islands
	terrainWorldSize: 8192.0,			//width of the square of world that gets land, centered on the origin
	terrainResolution: 4096,			//how fine the mesh is next to the camera: what the world would be across at that fineness. 256, 512, 1024 (1k), 2048, 4096 or 8192 (8k, a vertex every 1 unit). (Only these: the chunks halve in size, so anything in between draws the same as the next one down. At 256 they never halve at all, a vertex every 32 units)
	terrainFarBake: 128,				//how far off land is drawn: from a picture of each chunk this many texels wide, taken once (0 = worked out live). 256 is sharper and takes four times the memory, see THE BAKE in terrain.js
	terrainDetailDistance: 1.25,		//how far the fine mesh reaches: a chunk of land is drawn at half the fineness once it is this many times its own width away. (2.0 drew more triangles than there are pixels, and the GPU shades pixels in 2x2 blocks, so much of that shading was wasted: 1.25 looks the same and the terrain pass takes about a fifth less)
	terrainLandScale: 4200.0,			//size of the biggest shapes in the coastline. Bigger = fewer and larger land masses
	terrainSeaFloorDepth: 160.0,		//how deep the drop-off at the edge of the shallows goes, before the sea bed settles to its steady grade
	terrainSeaBedGrade: 0.42,			//how steeply the sea bed keeps going down from the drop-off out to the edge of the land: 0.42 is 42 down for every 100 out. 0 = a flat sea floor
	terrainShelfWidth: 3.0,				//how far the shallows run out from a beach before the sea bed drops away. 1 = a short step off the sand, 3 = three times that
	terrainHillHeight: 1.0,				//how much the grassland rolls. 0 = flat, 1 = hills a few dozen units high
	terrainWoodland: 0.5,				//how much of the grassland is wooded, 0 to 1. The forest round the mountains is there whatever this is
	terrainLakes: 0.5,					//how much of the low ground is hollowed out into lakes and ponds, 0 to 1
	terrainMountainHeight: 1650.0,		//the most a peak can stand above the land it is on. A range is only as high as it is wide though (see MOUNTAINS in terrainGenerator.js), so most stop short of this
	terrainBeachHeight: 3.5,			//land lower than this above sea level is beach
	terrainBankHeight: 1.5,				//the step up from the top of the sand to the grass behind it. 0 = no step
	terrainSnowLine: 950.0,				//mountain higher than this above sea level is snow
	terrainRockVeins: 1.0,				//how strongly the pale marble veins show on bare rock. 0 = plain stone
	terrainGroundDetail: 1.0,			//how strongly the sand of the beaches, the turf of the grassland and the litter under the trees show. 0 = flat color
	terrainDepthBias: 1.0,				//how much of the relief of all three goes in to the frame's depth, where the screen space shadows and ambient occlusion find it. 0 = none
	terrainRockDetail: 1.0,				//how strongly the cracks and ledges the shader draws on bare rock show. 0 = lit by the mesh alone
	terrainTownCount: 2,				//seaside towns: on the shore where the mountains come down near the sea, up a hill of their own (townLayout.js, town.js). 0 to 4
	terrainTownSize: 1.0,				//how big each one is: 1 = about 340m along the shore and 165m up the hill
	enableTownFolk: true,				//the towns' people: one to every building, its trade the building's (townFolk.js)
	//--------------------GRASS--------------------
	enableGrass: true,
	grassTotalBladeCount: 420000,	//blades drawn, shared out over the level of detail rings around the camera. Most are skipped wherever there is no grassland
	grassTotalHARDLIMIT: 2000000,	//top of the blade count slider. Nothing is stored per blade any more, so this is only about how much the GPU can draw
	grassDrawDistance: 900.0,		//how far from the camera the grass reaches. The rings stretch to reach it: the grass at your feet stays as thick, the far grass thins
	//level of detail: rings round the camera, each reaching further than the last with a coarser grid of blades (see vfc_grass.js)
	grassLodRings: 6,				//how many rings, 1 to 8. More rings = a gentler thinning out, and more of the blades spent far away
	grassLodNearDistance: 30.0,		//how far the first ring reaches: the grass at full thickness, every blade a curved strip
	grassLodFarBlades: 0.8,			//how many blades a ring gets next to the ring inside it. 1 = every ring the same number, 0.5 = each ring half the one before
	//clumps: the blades grow in tufts, and take after the tuft they are in (see CLUMPS in vfc_grass.js)
	grassClumpSize: 2.6,			//how far apart the tufts are, world units
	grassClumpPull: 0.4,			//how far the blades are drawn in to the middle of their tuft, 0 to 1. 0 = spread evenly
	grassClumpHeight: 0.6,			//how much a tuft is tall or short as a whole, 0 to 1
	grassClumpFacing: 0.5,			//how much the blades of a tuft lean out from its middle together, 0 to 1. 0 = every blade its own way
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
	forestMaxTrees: 60000,				//planting stops here however much forest there is left to fill, and no seed comes up while there are this many
	forestLifeCycle: true,				//the trees grow, die, fall and seed as the days go by. Off = the forest stays as it is
	forestYearsPerSunCycle: 150.0,		//years a tree ages in one day. Real trees take 45 (birch) to 100 (oak) years to grow up, so at 150 a tree is grown in under a day (5 minutes, see dayLengthSeconds)
	forestYear: 0,						//the forest's clock. Read only
	forestTreeCount: 0,					//trees standing, living and dead. Read only
	forestDetailDistance: 60.0,			//closer than this a full grown tree is drawn in full: every branch, every piece of foliage
	forestMidDistance: 180.0,			//and closer than this with its thicker branches and half its foliage. Smaller trees drop detail sooner
	forestThinnedRings: 2,				//0 to 2: rings between the mid distance and the billboards where the trees are drawn thinned, fewer and bigger pieces of foliage on coarser wood (see the levels of detail at the top of forest.js)
	forestBillboardDistance: 420.0,		//further off than this a tree is a billboard: 2 flat cards with its picture on
	forestDrawDistance: 5000.0,			//how far off trees are drawn at all
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
	cloudCoverageBias: 0.0,				//more (+) or less (-) cloud than the weather asks for
	cloudDensity: 1.0,					//how thick the cloud is. Thicker cloud is darker underneath and casts a heavier shadow
	cloudLayers: 3,						//1: the low layer only, 2: and the middle layer above it, 3: and the high layer above that (cirrus, and the grey sheet of an overcast day: without it overcast is only dimmer)
	cloudCrispness: 0.7,				//how sharp the edge of a heaped cloud is, 0 to 1. 0 = soft all the way out, 1 = a hard white rim
	cloudHeight: 0.0,					//lifts or lowers every layer of cloud, world units
	cloudDriftSpeed: 4.0,				//how many times faster than the wind at the ground the clouds drift
	cloudSteps: 48,						//steps along each ray through the clouds. More is smoother and costs more
	cloudResolution: 2,					//the clouds are marched at the size of the frame divided by this: 2 (half), 3 or 4 (a quarter). They are soft, and the march is most of what they cost
	cloudDrawDistance: 36000.0,			//how far off clouds are drawn. They fade into the haze over the last part of it
	displayCloudCoverage: false,
	//--------------------BIRDS--------------------
	enableDeer: true,					//small groups of deer living in the forest, going down to the water to drink three times a day. See deer.js
	deerGroups: 4,						//how many groups, 0 to 200. Each is 1 to 3 deer. Past about 40 the homes are closer together (see THE GROUPS in deer.js)
	deerSize: 1.0,						//1 = life size
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
	waterHorizonFogDistance: 4000.0,	//distance where the water is about two thirds faded into the horizon colour
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