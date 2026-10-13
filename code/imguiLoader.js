import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';
import { settings } from './settings.js';
import * as scene from './scene.js';
import * as water from './water.js';	//for water options
import * as grass from './computeGrass.js'

export const imguiParams = {
    // Time
    step: settings.step,
    // Camera
    camPosX: settings.camPosX,
    camPosY: settings.camPosY,
    camPosZ: settings.camPosZ,
    camFarPlane: settings.camFarPlane,
    camNearPlane: settings.camNearPlane,
    cameraFlyMode: settings.cameraFlyMode,
    cameraFlySpeed: settings.cameraFlySpeed,
    // Sun
    sunPosX: settings.sunPosX,
    sunPosY: settings.sunPosY,
    sunPosZ: settings.sunPosZ,
    sunIntensity: settings.sunIntensity,
    sunCycleAngle: settings.sunCycleAngle,
    timeCycleMultiplier: settings.timeCycleMultiplier,
    sunCycleCount: settings.sunCycleCount,
    // Moon
    enableMoon: settings.enableMoon,
    moonPosX: settings.moonPosX,
    moonPosY: settings.moonPosY,
    moonPosZ: settings.moonPosZ,
    moonBrightness: settings.moonBrightness,
    moonSize: settings.moonSize,
    // Shadows
    shadowMapPCFKernelSize: settings.shadowMapPCFKernelSize,
    shadowMapAcneBias: settings.shadowMapAcneBias,
    // Post Effects
    enablePostEffects: settings.enablePostEffects,
    enableScreenShadows: settings.enableScreenShadows,
    screenShadowStrength: settings.screenShadowStrength,
    screenShadowThickness: settings.screenShadowThickness,
    screenShadowContrast: settings.screenShadowContrast,
    enableSSAO: settings.enableSSAO,
    ssaoRadius: settings.ssaoRadius,
    ssaoStrength: settings.ssaoStrength,
    enableSSR: settings.enableSSR,
    ssrStrength: settings.ssrStrength,
    ssrDistance: settings.ssrDistance,
    displayScreenShading: settings.displayScreenShading,
    // Display
    antiAliasing: settings.antiAliasing,
    fxaaSubpixel: settings.fxaaSubpixel,
    anisotropicFiltering: settings.anisotropicFiltering,
    // Grass
    // Terrain
    enableTerrain: settings.enableTerrain,
    terrainSeed: settings.terrainSeed,
    terrainResolution: settings.terrainResolution,
    terrainDetailDistance: settings.terrainDetailDistance,
    terrainLandScale: settings.terrainLandScale,
    terrainSeaFloorDepth: settings.terrainSeaFloorDepth,
    terrainSeaBedGrade: settings.terrainSeaBedGrade,
    terrainShelfWidth: settings.terrainShelfWidth,
    terrainHillHeight: settings.terrainHillHeight,
    terrainWoodland: settings.terrainWoodland,
    terrainLakes: settings.terrainLakes,
    terrainMountainHeight: settings.terrainMountainHeight,
    terrainBeachHeight: settings.terrainBeachHeight,
    terrainBankHeight: settings.terrainBankHeight,
    terrainSnowLine: settings.terrainSnowLine,
    terrainRockDetail: settings.terrainRockDetail,
    terrainRockVeins: settings.terrainRockVeins,
    terrainGroundDetail: settings.terrainGroundDetail,
    terrainDepthBias: settings.terrainDepthBias,
    enableGrass: settings.enableGrass,
    grassTotalBladeCount: settings.grassTotalBladeCount,
    grassDrawDistance: settings.grassDrawDistance,
    grassLodRings: settings.grassLodRings,
    grassLodNearDistance: settings.grassLodNearDistance,
    grassLodFarBlades: settings.grassLodFarBlades,
    grassClumpSize: settings.grassClumpSize,
    grassClumpPull: settings.grassClumpPull,
    grassClumpHeight: settings.grassClumpHeight,
    grassClumpFacing: settings.grassClumpFacing,
    grassClumpColor: settings.grassClumpColor,
    grassBladeHeight: settings.grassBladeHeight,
    grassBladeWidth: settings.grassBladeWidth,
    grassWindStrength: settings.grassWindStrength,
    // Boulders
    enableBoulders: settings.enableBoulders,
    boulderAmount: settings.boulderAmount,
    boulderDrawDistance: settings.boulderDrawDistance,
    // Forest
    enableForest: settings.enableForest,
    forestSeed: settings.forestSeed,
    forestUnitsPerMetre: settings.forestUnitsPerMetre,
    forestTreeSpacing: settings.forestTreeSpacing,
    forestMaxSlope: settings.forestMaxSlope,
    forestConiferShare: settings.forestConiferShare,
    forestLifeCycle: settings.forestLifeCycle,
    forestYearsPerSunCycle: settings.forestYearsPerSunCycle,
    forestYear: settings.forestYear,
    forestTreeCount: settings.forestTreeCount,
    forestDetailDistance: settings.forestDetailDistance,
    forestMidDistance: settings.forestMidDistance,
    forestBillboardDistance: settings.forestBillboardDistance,
    forestDrawDistance: settings.forestDrawDistance,
    forestWindStrength: settings.forestWindStrength,
    // Water
    enableWater: settings.enableWater,
    waterWaveSteepness: settings.waterWaveSteepness,
    waterWaveLength: settings.waterWaveLength,
    waterWindSpeed: settings.waterWindSpeed,
    waterWorldPosY: settings.waterWorldPosY,
    waterOceanPlanePhysicalSize: settings.waterOceanPlanePhysicalSize,
    waterTileInstanceCount: settings.waterTileInstanceCount,
    waterTileResolution: settings.waterTileResolution,
	waterGridSize: settings.waterGridSize,
	waterHorizonFogDistance: settings.waterHorizonFogDistance,
	waterClarityDepth: settings.waterClarityDepth,
	waterFullDepth: settings.waterFullDepth,
	waterShallowRippleScale: settings.waterShallowRippleScale,
	waterChoppiness: settings.waterChoppiness,
	waterFoamThreshold: settings.waterFoamThreshold,
	waterFoamFade: settings.waterFoamFade,
	waterShoreZone: settings.waterShoreZone,
	waterShoreWaveHeight: settings.waterShoreWaveHeight,
	waterShoreBreakDistance: settings.waterShoreBreakDistance,
	waterShoreSteepness: settings.waterShoreSteepness,
	waterShoreWaveLength1: settings.waterShoreWaveLength1,
	waterShoreWaveLength2: settings.waterShoreWaveLength2,
	waterShoreWaveSpeed: settings.waterShoreWaveSpeed,
	waterDeepSeaDepth: settings.waterDeepSeaDepth,
	waterSwellHeight: settings.waterSwellHeight,
	waterSwellLength: settings.waterSwellLength,
	waterSwellSteepness: settings.waterSwellSteepness,
	waterSwellSpeed: settings.waterSwellSpeed,
	waterSwellShoreDistance: settings.waterSwellShoreDistance,
    // Atmosphere
    enableAtmosphere: settings.enableAtmosphere,
    // Seasons
    seasonMode: settings.seasonMode,
    seasonStart: settings.seasonStart,
    seasonLength: settings.seasonLength,
    seasonNow: settings.seasonNow,
    snowbuildTriggers: settings.snowbuildTriggers,
    snowCover: settings.snowCover,
    // Clouds and weather
    enableClouds: settings.enableClouds,
    weatherMode: settings.weatherMode,
    weatherSeed: settings.weatherSeed,
    weatherNow: settings.weatherNow,
    cloudForceTower: settings.cloudForceTower,
    cloudForceShelf: settings.cloudForceShelf,
    enableLightning: settings.enableLightning,
    lightningRate: settings.lightningRate,
    cloudCoverageBias: settings.cloudCoverageBias,
    cloudDensity: settings.cloudDensity,
    cloudHeight: settings.cloudHeight,
    cloudLayers: settings.cloudLayers,
    cloudCrispness: settings.cloudCrispness,
    cloudDriftSpeed: settings.cloudDriftSpeed,
    cloudSteps: settings.cloudSteps,
    cloudDrawDistance: settings.cloudDrawDistance,
    // Birds
    enableBirds: settings.enableBirds,
    birdGroups: settings.birdGroups,
    birdSize: settings.birdSize,
    birdSpeed: settings.birdSpeed,
    // Light shafts and under water
    enableLightShafts: settings.enableLightShafts,
    lightShaftStrength: settings.lightShaftStrength,
    enableUnderwater: settings.enableUnderwater,
    causticStrength: settings.causticStrength,
    // Particles
    enableLeaves: settings.enableLeaves,
    leavesAllYear: settings.leavesAllYear,
    leafAmount: settings.leafAmount,
    leafSize: settings.leafSize,
    leafWeight: settings.leafWeight,
    enableSeaSpray: settings.enableSeaSpray,
    sprayAmount: settings.sprayAmount,
    enableRain: settings.enableRain,
    rainAmount: settings.rainAmount,
    rainDistance: settings.rainDistance,
    enableSnow: settings.enableSnow,
    snowAmount: settings.snowAmount,
    // Wind
    windDirectionAngle: settings.windDirectionAngle,
    windGustiness: settings.windGustiness,
    windGustSize: settings.windGustSize,
    windGustSpeed: settings.windGustSpeed,
    additionalAltitude: settings.additionalAltitude,
    atmosphereScaleToScene: settings.atmosphereScaleToScene,
	atmosphereSunRotationDemo: settings.atmosphereSunRotationDemo,
    // Debug
    showDebug: settings.showDebug,
    activateSkybox: settings.activateSkybox,
    displayLightingMode: settings.displayLightingMode,
    displayHeightMap: settings.displayHeightMap,
    displayShadowMapDepth: settings.displayShadowMapDepth,
    displayOceanSpectrum: settings.displayOceanSpectrum,
    displayWaterInitialHeight: settings.displayWaterInitialHeight,
    displayWaveHeightRealization: settings.displayWaveHeightRealization,
    displayWaterPreComp: settings.displayWaterPreComp,
    displayWaterFFT: settings.displayWaterFFT,
    displayWaterShifted: settings.displayWaterShifted,
    displayWaterDisplacementSpectrum: settings.displayWaterDisplacementSpectrum,
    displayWaterDisplacement: settings.displayWaterDisplacement,
    displayShoreDistance: settings.displayShoreDistance,
	displaySkyViewLUTtexture: settings.displaySkyViewLUTtexture,
	displayTransmittanceLUTtexture: settings.displayTransmittanceLUTtexture,
	displayShoreDistanceDebugRange: settings.displayShoreDistanceDebugRange,
	debugTextureRescaleSize: settings.debugTextureRescaleSize,
};

export const gui = new GUI({ title: 'Controls' });
gui.domElement.style.position = 'absolute';
gui.domElement.style.top = '10px';
gui.domElement.style.left = '20px';

const camFolder = gui.addFolder('Camera');
camFolder.add(imguiParams, 'camPosX', -2000, 2000).name('Pos X');
camFolder.add(imguiParams, 'camPosY', -2000, 2000).name('Pos Y');
camFolder.add(imguiParams, 'camPosZ', -2000, 2000).name('Pos Z');
camFolder.add(imguiParams, 'camNearPlane', 0.1, 100).name('Near Plane');
camFolder.add(imguiParams, 'camFarPlane', 100, 20000).name('Far Plane');
camFolder.add(imguiParams, 'cameraFlyMode').name('Fly Camera (WASD + RMB)');
camFolder.add(imguiParams, 'cameraFlySpeed', 5, 5000, 5).name('Fly Speed');

const sunFolder = gui.addFolder('Sun');
sunFolder.add(imguiParams, 'sunPosX', -2000, 2000).name('Pos X');
sunFolder.add(imguiParams, 'sunPosY', -2000, 2000).name('Pos Y');
sunFolder.add(imguiParams, 'sunPosZ', -2000, 2000).name('Pos Z');
sunFolder.add(imguiParams, 'sunIntensity', 0, 500000).name('Intensity');
sunFolder.add(imguiParams, 'sunCycleAngle', 0, 6.2832).name('Cycle Angle (2 pi)');
sunFolder.add(imguiParams, 'timeCycleMultiplier', 0, 100, 0.1).name('Time Multiplier');
sunFolder.add(imguiParams, 'sunCycleCount').name('Sun Cycles (days)').disable();

const moonFolder = gui.addFolder('Moon');	//while the sun cycle runs (Atmosphere) it moves the moon as well, opposite the sun
moonFolder.add(imguiParams, 'enableMoon').name('Enable');
moonFolder.add(imguiParams, 'moonPosX', -2000, 2000).name('Pos X');
moonFolder.add(imguiParams, 'moonPosY', -2000, 2000).name('Pos Y');
moonFolder.add(imguiParams, 'moonPosZ', -2000, 2000).name('Pos Z');
moonFolder.add(imguiParams, 'moonBrightness', 0, 4, 0.05).name('Brightness');
moonFolder.add(imguiParams, 'moonSize', 0.25, 8, 0.05).name('Size (degrees)');

const shadowFolder = gui.addFolder('Shadows');
shadowFolder.add(imguiParams, 'shadowMapPCFKernelSize', 1, 16, 1).name('PCF Kernel Size');
shadowFolder.add(imguiParams, 'shadowMapAcneBias', 0, 0.05, 0.0001).name('Acne Bias');

const screenFolder = gui.addFolder('Screen Space');	//worked out from the finished frame: see screenEffects.js
screenFolder.add(imguiParams, 'enablePostEffects').name('Enable');
screenFolder.add(imguiParams, 'enableScreenShadows').name('Shadows');
screenFolder.add(imguiParams, 'screenShadowStrength', 0, 1, 0.01).name('Shadow Strength');
screenFolder.add(imguiParams, 'screenShadowThickness', 0.0005, 0.04, 0.0005).name('Shadow Thickness');
screenFolder.add(imguiParams, 'screenShadowContrast', 1, 8, 0.1).name('Shadow Contrast');
screenFolder.add(imguiParams, 'enableSSAO').name('Ambient Occlusion');
screenFolder.add(imguiParams, 'ssaoRadius', 0.25, 20, 0.25).name('AO Radius');
screenFolder.add(imguiParams, 'ssaoStrength', 0, 2, 0.05).name('AO Strength');
screenFolder.add(imguiParams, 'enableSSR').name('Water Reflections');
screenFolder.add(imguiParams, 'ssrStrength', 0, 1, 0.01).name('Reflection Strength');
screenFolder.add(imguiParams, 'ssrDistance', 100, 6000, 50).name('Reflection Distance');
screenFolder.add(imguiParams, 'displayScreenShading').name('Show Shading Only');

const displayFolder = gui.addFolder('Display');	//see smaa.js, fxaa.js and textureFiltering.js
displayFolder.add(imguiParams, 'antiAliasing', { 'SMAA': 'smaa', 'FXAA': 'fxaa', 'off': 'off' }).name('Anti-Aliasing');
displayFolder.add(imguiParams, 'fxaaSubpixel', 0, 1, 0.05).name('FXAA Softening');
displayFolder.add(imguiParams, 'anisotropicFiltering', { '1x (off)': 1, '2x': 2, '4x': 4, '8x': 8, '16x': 16 }).name('Anisotropic Filtering');

const terrainFolder = gui.addFolder('Terrain');	//changing any of these but Enable generates the land again
terrainFolder.add(imguiParams, 'enableTerrain').name('Enable');
terrainFolder.add(imguiParams, 'terrainSeed', 0, 999, 1).name('Seed');
terrainFolder.add(imguiParams, 'terrainLandScale', 1000, 8000, 50).name('Land Mass Size');
terrainFolder.add(imguiParams, 'terrainMountainHeight', 0, 2500, 10).name('Mountain Height');
terrainFolder.add(imguiParams, 'terrainSnowLine', 50, 2500, 10).name('Snow Line');
terrainFolder.add(imguiParams, 'terrainBeachHeight', 1, 15, 0.5).name('Beach Height');
terrainFolder.add(imguiParams, 'terrainBankHeight', 0, 5, 0.1).name('Beach Bank Height');
terrainFolder.add(imguiParams, 'terrainSeaFloorDepth', 40, 500, 5).name('Drop-off Depth');
terrainFolder.add(imguiParams, 'terrainSeaBedGrade', 0, 0.8, 0.01).name('Sea Bed Grade');
terrainFolder.add(imguiParams, 'terrainShelfWidth', 1, 6, 0.1).name('Shelf Width');
terrainFolder.add(imguiParams, 'terrainHillHeight', 0, 3, 0.05).name('Hill Height');
terrainFolder.add(imguiParams, 'terrainWoodland', 0, 1, 0.01).name('Woodland');
terrainFolder.add(imguiParams, 'terrainLakes', 0, 1, 0.01).name('Lakes');
terrainFolder.add(imguiParams, 'terrainRockDetail', 0, 3, 0.05).name('Rock Detail');
terrainFolder.add(imguiParams, 'terrainRockVeins', 0, 2, 0.05).name('Rock Veins');
terrainFolder.add(imguiParams, 'terrainGroundDetail', 0, 2, 0.05).name('Sand, Turf and Forest Floor');
terrainFolder.add(imguiParams, 'terrainDepthBias', 0, 4, 0.05).name('Depth Bias');
terrainFolder.add(imguiParams, 'terrainResolution', { '1k': 1024, '2k': 2048, '4k': 4096, '8k': 8192 }).name('Mesh Detail');	//these two only change the mesh, the land stays as it is
terrainFolder.add(imguiParams, 'terrainDetailDistance', 0.75, 5, 0.05).name('Detail Distance');

const grassFolder = gui.addFolder('Grass');
grassFolder.add(imguiParams, 'enableGrass').name('Enable');
grassFolder.add(imguiParams, 'grassTotalBladeCount', 1000, settings.grassTotalHARDLIMIT, 1000).name('Blade Count');
grassFolder.add(imguiParams, 'grassDrawDistance', 20, 1500, 5).name('Draw Distance');
grassFolder.add(imguiParams, 'grassBladeHeight', 0.2, 6, 0.05).name('Blade Height');
grassFolder.add(imguiParams, 'grassBladeWidth', 0.02, 1, 0.01).name('Blade Width');
grassFolder.add(imguiParams, 'grassWindStrength', 0, 3, 0.05).name('Wind Strength');

const grassLodFolder = grassFolder.addFolder('Level of Detail');	//rings of thinner and simpler grass round the camera, see vfc_grass.js
grassLodFolder.add(imguiParams, 'grassLodRings', 1, 8, 1).name('Rings');
grassLodFolder.add(imguiParams, 'grassLodNearDistance', 5, 200, 1).name('Full Detail Distance');
grassLodFolder.add(imguiParams, 'grassLodFarBlades', 0.2, 1, 0.01).name('Far Blade Share');

const grassClumpFolder = grassFolder.addFolder('Clumping');
grassClumpFolder.add(imguiParams, 'grassClumpSize', 0.4, 12, 0.1).name('Clump Size');
grassClumpFolder.add(imguiParams, 'grassClumpPull', 0, 1, 0.01).name('Pull to Middle');
grassClumpFolder.add(imguiParams, 'grassClumpHeight', 0, 1, 0.01).name('Shared Height');
grassClumpFolder.add(imguiParams, 'grassClumpFacing', 0, 1, 0.01).name('Shared Facing');
grassClumpFolder.add(imguiParams, 'grassClumpColor', 0, 1, 0.01).name('Shared Color');

const boulderFolder = gui.addFolder('Boulders');
boulderFolder.add(imguiParams, 'enableBoulders').name('Enable');
boulderFolder.add(imguiParams, 'boulderAmount', 0, 5, 0.05).name('Amount');
boulderFolder.add(imguiParams, 'boulderDrawDistance', 200, 8000, 50).name('Draw Distance');

const forestFolder = gui.addFolder('Forest');	//changing Seed, Tree Scale, Spacing, Max Slope or Conifer Share plants the forest again
forestFolder.add(imguiParams, 'enableForest').name('Enable');
forestFolder.add(imguiParams, 'forestSeed', 0, 999, 1).name('Seed');
forestFolder.add(imguiParams, 'forestUnitsPerMetre', 0.5, 4, 0.1).name('Tree Scale (units per m)');
forestFolder.add(imguiParams, 'forestTreeSpacing', 5, 30, 0.5).name('Tree Spacing');
forestFolder.add(imguiParams, 'forestMaxSlope', 0.05, 0.8, 0.01).name('Max Slope');
forestFolder.add(imguiParams, 'forestConiferShare', 0, 1, 0.01).name('Conifer Share');
forestFolder.add(imguiParams, 'forestLifeCycle').name('Life Cycle');
forestFolder.add(imguiParams, 'forestYearsPerSunCycle', 0.25, 50, 0.25).name('Years per Sun Cycle');
forestFolder.add(imguiParams, 'forestYear').name('Forest Year').disable();
forestFolder.add(imguiParams, 'forestTreeCount').name('Trees').disable();
forestFolder.add(imguiParams, 'forestDetailDistance', 10, 300, 5).name('Full Detail Distance');
forestFolder.add(imguiParams, 'forestMidDistance', 20, 800, 5).name('Mid Detail Distance');
forestFolder.add(imguiParams, 'forestBillboardDistance', 50, 3000, 10).name('Billboard Distance');
forestFolder.add(imguiParams, 'forestDrawDistance', 100, 12000, 50).name('Draw Distance');
forestFolder.add(imguiParams, 'forestWindStrength', 0, 3, 0.05).name('Wind Strength');

const seasonFolder = gui.addFolder('Seasons');	//see weather.js
seasonFolder.add(imguiParams, 'seasonMode', ['auto', 'spring', 'summer', 'fall', 'winter']).name('Season');
seasonFolder.add(imguiParams, 'seasonNow').name('Season Now').disable();
seasonFolder.add(imguiParams, 'seasonStart', ['spring', 'summer', 'fall', 'winter']).name('First Season');
seasonFolder.add(imguiParams, 'seasonLength', 1, 32, 1).name('Days in a Season');
seasonFolder.add({ trigger: () => { imguiParams.snowbuildTriggers += 1; } }, 'trigger').name('Trigger Snowbuild');
seasonFolder.add(imguiParams, 'snowCover').name('Snow Lying').disable();

const cloudFolder = gui.addFolder('Clouds and Weather');	//see weather.js and clouds.js
cloudFolder.add(imguiParams, 'enableClouds').name('Enable');
cloudFolder.add(imguiParams, 'weatherMode', ['auto', 'sunny', 'overcast', 'storm', 'thunderstorm', 'winter storm', 'tornado', 'hurricane']).name('Weather');
cloudFolder.add(imguiParams, 'weatherNow').name('Weather Now').disable();
cloudFolder.add(imguiParams, 'weatherSeed', 0, 999, 1).name('Weather Seed');
cloudFolder.add(imguiParams, 'cloudForceTower').name('Cumulonimbus (held weather)');
cloudFolder.add(imguiParams, 'cloudForceShelf').name('Shelf Cloud');
cloudFolder.add(imguiParams, 'enableLightning').name('Lightning');
cloudFolder.add(imguiParams, 'lightningRate', 0.1, 5, 0.1).name('Lightning Rate');
cloudFolder.add(imguiParams, 'cloudCoverageBias', -0.5, 0.5, 0.01).name('More / Less Cloud');
cloudFolder.add(imguiParams, 'cloudDensity', 0.2, 3, 0.05).name('Density');
cloudFolder.add(imguiParams, 'cloudLayers', { 'low': 1, 'low and middle': 2, 'low, middle and high': 3 }).name('Layers');
cloudFolder.add(imguiParams, 'cloudCrispness', 0, 1, 0.01).name('Crispness');
cloudFolder.add(imguiParams, 'cloudHeight', -400, 4000, 50).name('Height');
cloudFolder.add(imguiParams, 'cloudDriftSpeed', 0, 20, 0.5).name('Drift Speed');
cloudFolder.add(imguiParams, 'cloudSteps', 16, 128, 1).name('Quality (steps)');
cloudFolder.add(imguiParams, 'cloudDrawDistance', 8000, 80000, 500).name('Draw Distance');

const birdFolder = gui.addFolder('Birds');	//see birds.js
birdFolder.add(imguiParams, 'enableBirds').name('Enable');
birdFolder.add(imguiParams, 'birdGroups', 0, 3, 1).name('Groups');
birdFolder.add(imguiParams, 'birdSize', 1, 30, 0.5).name('Wingspan');
birdFolder.add(imguiParams, 'birdSpeed', 0.2, 3, 0.05).name('Speed');

const shaftFolder = gui.addFolder('Light Shafts and Underwater');	//see lightShafts.js
shaftFolder.add(imguiParams, 'enableLightShafts').name('Light Shafts');
shaftFolder.add(imguiParams, 'lightShaftStrength', 0, 4, 0.05).name('Shaft Strength');
shaftFolder.add(imguiParams, 'enableUnderwater').name('Underwater View');
shaftFolder.add(imguiParams, 'causticStrength', 0, 4, 0.05).name('Caustic Strength');

const particleFolder = gui.addFolder('Particles');	//see particles.js
particleFolder.add(imguiParams, 'enableLeaves').name('Leaves (in the fall)');
particleFolder.add(imguiParams, 'leavesAllYear').name('Leaves All Year');
particleFolder.add(imguiParams, 'leafAmount', 0, 5, 0.05).name('Leaf Amount');
particleFolder.add(imguiParams, 'leafSize', 0.1, 2, 0.01).name('Leaf Size');
particleFolder.add(imguiParams, 'leafWeight', 0.3, 3, 0.05).name('Leaf Weight');
particleFolder.add(imguiParams, 'enableSeaSpray').name('Sea Spray');
particleFolder.add(imguiParams, 'sprayAmount', 0, 1, 0.01).name('Spray Amount');
particleFolder.add(imguiParams, 'enableRain').name('Rain');
particleFolder.add(imguiParams, 'rainAmount', 0, 1, 0.01).name('Rain Amount');
particleFolder.add(imguiParams, 'rainDistance', 10, 150, 1).name('Rain and Snow Distance');
particleFolder.add(imguiParams, 'enableSnow').name('Snow');
particleFolder.add(imguiParams, 'snowAmount', 0, 1, 0.01).name('Snow Amount');

const windFolder = gui.addFolder('Wind');	//moves the grass and the trees. See wind.js
windFolder.add(imguiParams, 'waterWindSpeed', 0, 20).name('Wind Speed');	//the same setting as Wind Speed under Water
windFolder.add(imguiParams, 'windDirectionAngle', 0, 360, 1).name('Direction (degrees)');
windFolder.add(imguiParams, 'windGustiness', 0, 1, 0.01).name('Gustiness');
windFolder.add(imguiParams, 'windGustSize', 100, 3000, 10).name('Gust Size');
windFolder.add(imguiParams, 'windGustSpeed', 0, 8, 0.1).name('Gust Speed (x wind speed)');

const waterFolder = gui.addFolder('Water');
waterFolder.add(imguiParams, 'enableWater').name('Enable');
waterFolder.add(imguiParams, 'waterWaveSteepness', 0, 1, 0.01).name('Wave Steepness');
waterFolder.add(imguiParams, 'waterWaveLength', 1, 500).name('Wave Length');
waterFolder.add(imguiParams, 'waterWindSpeed', 0, 20).name('Wind Speed');
waterFolder.add(imguiParams, 'waterWorldPosY', -100, 100).name('World Pos Y');
waterFolder.add(imguiParams, 'waterTileResolution', [32, 64, 128, 256, 512, 1024]).name('Water Tile Resolution');
waterFolder.add(imguiParams, 'waterOceanPlanePhysicalSize', 1, 1024).name('WT Physical Size (H0K)');
waterFolder.add(imguiParams, 'waterGridSize', 1, 5000).name('Water Tile Grid Size');
waterFolder.add(imguiParams, 'waterTileInstanceCount', [1, 3, 5, 7, 9, 11]).name('Water Tile Instance Count');
waterFolder.add(imguiParams, 'waterHorizonFogDistance', 200, 20000).name('Horizon Fog Distance');
waterFolder.add(imguiParams, 'waterClarityDepth', 0, 10, 0.1).name('Water Clarity Depth');
waterFolder.add(imguiParams, 'waterFullDepth', 1, 100).name('Full Wave Depth');
waterFolder.add(imguiParams, 'waterShallowRippleScale', 0, 0.3, 0.005).name('Shallow Ripple Scale');

const waterChopFolder = waterFolder.addFolder('Chop and Foam');
waterChopFolder.add(imguiParams, 'waterChoppiness', 0, 3, 0.05).name('Choppiness');
waterChopFolder.add(imguiParams, 'waterFoamThreshold', 0, 1, 0.01).name('Foam Threshold');
waterChopFolder.add(imguiParams, 'waterFoamFade', 0.05, 1, 0.01).name('Foam Fade');

const waterShoreFolder = waterFolder.addFolder('Shore Waves');
waterShoreFolder.add(imguiParams, 'waterShoreZone', 10, 150, 1).name('Zone Distance');
waterShoreFolder.add(imguiParams, 'waterShoreWaveHeight', 0, 6, 0.1).name('Wave Height');
waterShoreFolder.add(imguiParams, 'waterShoreBreakDistance', 2, 40, 0.5).name('Break Distance');
waterShoreFolder.add(imguiParams, 'waterShoreSteepness', 0, 4, 0.1).name('Steepness');
waterShoreFolder.add(imguiParams, 'waterShoreWaveLength1', 12, 80, 0.5).name('Wave Length 1');
waterShoreFolder.add(imguiParams, 'waterShoreWaveLength2', 12, 80, 0.5).name('Wave Length 2');
waterShoreFolder.add(imguiParams, 'waterShoreWaveSpeed', 0, 3, 0.05).name('Wave Speed');

const waterSwellFolder = waterFolder.addFolder('Deep Sea Swell');
waterSwellFolder.add(imguiParams, 'waterDeepSeaDepth', 1, 1000, 1).name('Deep Sea Depth');
waterSwellFolder.add(imguiParams, 'waterSwellHeight', 0, 200, 0.5).name('Swell Height');
waterSwellFolder.add(imguiParams, 'waterSwellLength', 100, 2000, 10).name('Swell Length');
waterSwellFolder.add(imguiParams, 'waterSwellSteepness', 0, 1, 0.01).name('Steepness');
waterSwellFolder.add(imguiParams, 'waterSwellSpeed', 0, 3, 0.05).name('Speed');
waterSwellFolder.add(imguiParams, 'waterSwellShoreDistance', 20, 150, 1).name('Full Size Distance From Land');


const atmosphereFolder = gui.addFolder('Atmosphere');
atmosphereFolder.add(imguiParams, 'enableAtmosphere').name('Enable');
atmosphereFolder.add(imguiParams, 'atmosphereScaleToScene', 0.1, 10).name('Scale');
atmosphereFolder.add(imguiParams, 'additionalAltitude', -200, 200).name('Altitude Offset');
atmosphereFolder.add(imguiParams, 'atmosphereSunRotationDemo').name('atmosphere sun demo enable');

const debugDisplayModes = ["final", 
							"shadow mapping visibility",
							"water line topology",
							"heightMap", 
							"shadowMapDepth", 
							"Oceanographic Spectrum", 
							"h0(k)", 
							"waveHeightRealization h(k,t)", 
							"PreComp Twiddle Water", 
							"finalWaveHeightFFT h(x,t) pre Shift", 
							"finalWaveHeightFFT h(x,t) Shifted",
							"Skyview LUT Texture",
							"Atmosphere Transmittance LUT Texture",
							"Choppy Displacement D(k,t)",
							"Choppy Displacement D(x,t) Shifted",
							"Shore Distance Field",
							"Wind Texture",
							"Cloud Coverage (r: sun through, g: cloud overhead, b: rain)"];

let selectedDebugDisplayMode;
const debugFolder = gui.addFolder('Debug');
const debugViewState = { mode: debugDisplayModes[0] };
debugFolder.add(debugViewState, 'mode', debugDisplayModes).name('View Mode').onChange(value => {
    selectedDebugDisplayMode = debugDisplayModes.indexOf(value);
    
	settings.displayLightingMode 		  = selectedDebugDisplayMode === 1;
    settings.displayHeightMap             = selectedDebugDisplayMode === 3;
    settings.displayShadowMapDepth        = selectedDebugDisplayMode === 4;
    settings.displayOceanSpectrum         = selectedDebugDisplayMode === 5;
    settings.displayWaterInitialHeight    = selectedDebugDisplayMode === 6;
    settings.displayWaveHeightRealization = selectedDebugDisplayMode === 7;
    settings.displayWaterPreComp          = selectedDebugDisplayMode === 8;
    settings.displayWaterFFT              = selectedDebugDisplayMode === 9;
    settings.displayWaterShifted          = selectedDebugDisplayMode === 10;
    settings.displaySkyViewLUTtexture          = selectedDebugDisplayMode === 11;
    settings.displayTransmittanceLUTtexture    = selectedDebugDisplayMode === 12;
    settings.displayWaterDisplacementSpectrum  = selectedDebugDisplayMode === 13;
    settings.displayWaterDisplacement          = selectedDebugDisplayMode === 14;
    settings.displayShoreDistance              = selectedDebugDisplayMode === 15;
    settings.displayWindTexture                = selectedDebugDisplayMode === 16;
    settings.displayCloudCoverage              = selectedDebugDisplayMode === 17;

    if (selectedDebugDisplayMode === 2) {
        water.waterPipelineSignalUpdate('line-list');
    } else {
        water.waterPipelineSignalUpdate('triangle-list');
    }
});
debugFolder.add(imguiParams, 'debugTextureRescaleSize', [32, 64, 128, 256, 512, 1024]).name('Debug Texture Size');
debugFolder.add(imguiParams, 'displayShoreDistanceDebugRange', 5, 300).name('Shore Distance View Range');

// every folder starts shut, the ones inside other folders as well
gui.foldersRecursive().forEach((folder) => folder.close());


const dropdownManagedKeys = new Set([
    'displayLightingMode',
    'displayHeightMap',
    'displayShadowMapDepth',
    'displayOceanSpectrum',
    'displayWaterInitialHeight',
    'displayWaveHeightRealization',
    'displayWaterPreComp',
    'displayWaterFFT',
    'displayWaterShifted',
	'displaySkyViewLUTtexture',
	'displayTransmittanceLUTtexture',
	'displayWaterDisplacementSpectrum',
	'displayWaterDisplacement',
	'displayShoreDistance',
	'displayWindTexture',
	'displayCloudCoverage',
]);

export function refreshControlsUI() {
    Object.keys(imguiParams).forEach(key => {
        if (!dropdownManagedKeys.has(key)) {
            settings[key] = imguiParams[key];
        }
    });
}

export function syncSettingsToParams() {
    Object.keys(imguiParams).forEach(key => {
        if (key in settings && !dropdownManagedKeys.has(key)) {
            imguiParams[key] = settings[key];
        }
    });
    gui.controllersRecursive().forEach(c => c.updateDisplay());	//every controller, however deep its folder is
}

//-----------------------ENTITY BASED SETTINGS----------------------------
const entityGUI = new GUI({ title: 'Entity Editor' });
entityGUI.domElement.style.position = 'absolute';
entityGUI.domElement.style.top = '10px';
entityGUI.domElement.style.left = '290px'; // offset past the first panel
let selectedEntity = 0;

// entity folder
let entityParams = {
    entity: scene.entityModels[selectedEntity].name,
    posX: scene.entityModels[selectedEntity].worldTranslation[0],
    posY: scene.entityModels[selectedEntity].worldTranslation[1],
    posZ: scene.entityModels[selectedEntity].worldTranslation[2],
    rotX: scene.entityModels[selectedEntity].worldRotation[0],
    rotY: scene.entityModels[selectedEntity].worldRotation[1],
    rotZ: scene.entityModels[selectedEntity].worldRotation[2],
    scaleX: scene.entityModels[selectedEntity].worldScale[0],
    scaleY: scene.entityModels[selectedEntity].worldScale[1],
    scaleZ: scene.entityModels[selectedEntity].worldScale[2],
};

const entityFolder = entityGUI.addFolder('Entity');

const entityNames = scene.entityModels.map(e => e.name);
entityFolder.add(entityParams, 'entity', entityNames).name('Selected').onChange(name => {
    selectedEntity = scene.entityModels.findIndex(e => e.name === name);
    refreshEntityFolder();
});

const posFolder = entityFolder.addFolder('Position');
posFolder.add(entityParams, 'posX', -300, 300).name('X').onChange(v => scene.entityModels[selectedEntity].worldTranslation[0] = v);
posFolder.add(entityParams, 'posY', -300, 300).name('Y').onChange(v => scene.entityModels[selectedEntity].worldTranslation[1] = v);
posFolder.add(entityParams, 'posZ', -300, 300).name('Z').onChange(v => scene.entityModels[selectedEntity].worldTranslation[2] = v);

const rotFolder = entityFolder.addFolder('Rotation');
rotFolder.add(entityParams, 'rotX', -360, 360).name('X').onChange(v => scene.entityModels[selectedEntity].worldRotation[0] = v);
rotFolder.add(entityParams, 'rotY', -360, 360).name('Y').onChange(v => scene.entityModels[selectedEntity].worldRotation[1] = v);
rotFolder.add(entityParams, 'rotZ', -360, 360).name('Z').onChange(v => scene.entityModels[selectedEntity].worldRotation[2] = v);

const scaleFolder = entityFolder.addFolder('Scale');
scaleFolder.add(entityParams, 'scaleX', 0, 10).name('X').onChange(v => scene.entityModels[selectedEntity].worldScale[0] = v);
scaleFolder.add(entityParams, 'scaleY', 0, 10).name('Y').onChange(v => scene.entityModels[selectedEntity].worldScale[1] = v);
scaleFolder.add(entityParams, 'scaleZ', 0, 10).name('Z').onChange(v => scene.entityModels[selectedEntity].worldScale[2] = v);

entityGUI.foldersRecursive().forEach((folder) => folder.close());

export function refreshEntityFolder() {
    const e = scene.entityModels[selectedEntity];
    entityParams.posX = e.worldTranslation[0];
    entityParams.posY = e.worldTranslation[1];
    entityParams.posZ = e.worldTranslation[2];
    entityParams.rotX = e.worldRotation[0];
    entityParams.rotY = e.worldRotation[1];
    entityParams.rotZ = e.worldRotation[2];
    entityParams.scaleX = e.worldScale[0];
    entityParams.scaleY = e.worldScale[1];
    entityParams.scaleZ = e.worldScale[2];
    posFolder.controllers.forEach(c => c.updateDisplay());
    rotFolder.controllers.forEach(c => c.updateDisplay());
    scaleFolder.controllers.forEach(c => c.updateDisplay());
}

//----------------------WINDOWS EVENT LISTENERS-------------------------------
export let guiActive = false;
gui.domElement.addEventListener('mousedown', () => guiActive = true);
gui.domElement.addEventListener('mouseup', () => guiActive = false);
entityGUI.domElement.addEventListener('mousedown', () => guiActive = true);
entityGUI.domElement.addEventListener('mouseup', () => guiActive = false);


