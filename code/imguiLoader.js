import GUI from 'https://cdn.jsdelivr.net/npm/lil-gui@0.19/+esm';
import { settings } from './settings.js';
import * as scene from './scene.js';
import * as water from './water.js';	//for water options
import * as grass from './computeGrass.js'
import * as profiler from './profiler.js';	//for the Performance window
import { device, canvas, gpuInfo, gpuIsFallback, onRenderResize, drawn } from './deviceSelection.js';
import { RESOLUTIONS, dynamicResolution } from './display.js';
import { PRESETS, PRESET_NAMES, PresetCheck, detectStartingPreset } from './graphicsPresets.js';
import { reversedDepth, rememberDepthChoice } from './depthMode.js';

export const imguiParams = {
    // Time
    step: settings.step,
    // Camera
    camPosX: settings.camPosX,
    camPosY: settings.camPosY,
    camPosZ: settings.camPosZ,
    camFarPlane: settings.camFarPlane,
    camNearPlane: settings.camNearPlane,
    gameMode: settings.gameMode,
    hordeFirstWave: settings.hordeFirstWave,
    hordeWaveGrowth: settings.hordeWaveGrowth,
    hordeMaxWave: settings.hordeMaxWave,
    hordeAliveCap: settings.hordeAliveCap,
    hordeSpeed: settings.hordeSpeed,
    hordeDamage: settings.hordeDamage,
    hordeBreakSeconds: settings.hordeBreakSeconds,
    huntingWalkSpeed: settings.huntingWalkSpeed,
    horseSpeed: settings.horseSpeed,
    boatSteadying: settings.boatSteadying,
    buoyancy: settings.buoyancy,
    aiDifficulty: settings.aiDifficulty,
    discGolfEnabled: settings.discGolfEnabled,
    discGolfHoles: settings.discGolfHoles,
    discGolfSeed: settings.discGolfSeed,
    enableSound: settings.enableSound,
    soundVolume: settings.soundVolume,
    huntingJumpHeight: settings.huntingJumpHeight,
    huntingLookSensitivity: settings.huntingLookSensitivity,
    cameraFlyMode: settings.cameraFlyMode,
    cameraFlySpeed: settings.cameraFlySpeed,
    // Sun
    sunPosX: settings.sunPosX,
    sunPosY: settings.sunPosY,
    sunPosZ: settings.sunPosZ,
    sunIntensity: settings.sunIntensity,
    sunCycleAngle: settings.sunCycleAngle,
    dayLengthSeconds: settings.dayLengthSeconds,
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
    renderResolution: settings.renderResolution,
    dynamicResolution: settings.dynamicResolution,
    dynamicResolutionTarget: settings.dynamicResolutionTarget,
    antiAliasing: settings.antiAliasing,
    reversedDepth: settings.reversedDepth,
    fxaaSubpixel: settings.fxaaSubpixel,
    anisotropicFiltering: settings.anisotropicFiltering,
    // Grass
    // Terrain
    enableTerrain: settings.enableTerrain,
    terrainSeed: settings.terrainSeed,
    terrainResolution: settings.terrainResolution,
    terrainDetailDistance: settings.terrainDetailDistance,
    terrainFarBake: settings.terrainFarBake,
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
    terrainTownCount: settings.terrainTownCount,
    terrainTownSize: settings.terrainTownSize,
    terrainLandingStrip: settings.terrainLandingStrip,
    terrainFootpaths: settings.terrainFootpaths,
    enableTownFolk: settings.enableTownFolk,
    enableNPCs: settings.enableNPCs,
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
    landOcclusion: settings.landOcclusion,
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
    forestThinnedRings: settings.forestThinnedRings,
    forestWindStrength: settings.forestWindStrength,
    // Water
    enableWater: settings.enableWater,
    waterWaveSteepness: settings.waterWaveSteepness,
    waterWaveLength: settings.waterWaveLength,
    waterWindSpeed: settings.waterWindSpeed,
    waterOceanWindSpeed: settings.waterOceanWindSpeed,
    waterSeed: settings.waterSeed,
    waterWorldPosY: settings.waterWorldPosY,
    waterFetch: settings.waterFetch,
    waterTileInstanceCount: settings.waterTileInstanceCount,
    waterTileResolution: settings.waterTileResolution,
    waterCascadeResolution: settings.waterCascadeResolution,
	waterGridSize: settings.waterGridSize,
	waterHorizonFogDistance: settings.waterHorizonFogDistance,
	waterClarityDepth: settings.waterClarityDepth,
	waterFullDepth: settings.waterFullDepth,
	waterShallowRippleScale: settings.waterShallowRippleScale,
	waterChoppiness: settings.waterChoppiness,
	waterFoamThreshold: settings.waterFoamThreshold,
	waterFoamFade: settings.waterFoamFade,
	waterShallowRideHigh: settings.waterShallowRideHigh,
	enableBoulderWater: settings.enableBoulderWater,
	waterDeepSeaDepth: settings.waterDeepSeaDepth,
	waterSwellHeight: settings.waterSwellHeight,
	waterSwellLength: settings.waterSwellLength,
	waterSwellSpread: settings.waterSwellSpread,
	waterSwellDirection: settings.waterSwellDirection,
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
    cloudResolution: settings.cloudResolution,
    cloudDrawDistance: settings.cloudDrawDistance,
    // Birds
    enableBirds: settings.enableBirds,
    birdGroups: settings.birdGroups,
    enableDeer: settings.enableDeer,
    deerGroups: settings.deerGroups,
    deerSize: settings.deerSize,
    enableGeese: settings.enableGeese,
    geeseCount: settings.geeseCount,
    geeseSize: settings.geeseSize,
    birdSize: settings.birdSize,
    birdSpeed: settings.birdSpeed,
    // Light shafts and under water
    enableLightShafts: settings.enableLightShafts,
    lightShaftStrength: settings.lightShaftStrength,
    enableUnderwater: settings.enableUnderwater,
    underwaterStartDepth: settings.underwaterStartDepth,
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

//-----------------------WHERE THE WINDOWS GO----------------------------
// Over the canvas, in one dock: Controls and the Entity Editor along the top left, Performance top right. On a narrow
//		screen (a phone) they would sit on top of each other, so there they go in one column down the left instead, which
//		scrolls if they get taller than the screen
const dockStyle = document.createElement('style');
dockStyle.textContent = `
#gui-dock { position: fixed; top: 10px; left: 10px; right: 10px; display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; pointer-events: none; z-index: 10; }
#gui-dock > div { display: flex; align-items: flex-start; gap: 10px; }
#gui-dock .lil-gui.root { pointer-events: auto; max-height: calc(100vh - 20px); max-height: calc(100dvh - 20px); }
@media (max-width: 760px) {
	#gui-dock { flex-direction: column; justify-content: flex-start; right: auto; width: min(380px, calc(100vw - 20px)); max-height: calc(100vh - 20px); max-height: calc(100dvh - 20px); overflow-y: auto; }
	#gui-dock > div { flex-direction: column; align-items: stretch; width: 100%; }
	#gui-dock .lil-gui.root { width: 100% !important; max-height: none; }
}
`;
document.head.appendChild(dockStyle);
const guiDock = document.createElement('div');
guiDock.id = 'gui-dock';
const dockLeft = document.createElement('div'), dockRight = document.createElement('div');
guiDock.append(dockLeft, dockRight);
document.body.appendChild(guiDock);

export const gui = new GUI({ title: 'Controls', container: dockLeft });

//-----------------------GRAPHICS PRESETS----------------------------
// At the top, outside the folders. The preset to start on is guessed from the GPU, then checked by the frame rate: see
//		graphicsPresets.js. Preset Override stops the check (it ticks itself once the frame rate is good)
const presetState = { preset: 'medium', override: false, status: '', drawnAt: '' };

// sets everything the preset has a value for, in the settings and in the controls
function applyPreset(name) {
	for (const [key, value] of Object.entries(PRESETS[name])) {
		settings[key] = value;
		if (key in imguiParams) imguiParams[key] = value;
	}
	presetState.preset = name;
	gui.controllersRecursive().forEach((c) => c.updateDisplay());
}

const startingPreset = detectStartingPreset({
	gpu: gpuInfo,
	fallback: gpuIsFallback,
	mobile: navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),
	pixels: canvas.width * canvas.height,
	memory: navigator.deviceMemory ?? 0,
});
console.log("Graphics preset to start on: " + startingPreset.preset + " (" + startingPreset.reason + ")");
const presetCheck = new PresetCheck(startingPreset.preset, performance.now());

const presetNames = Object.fromEntries(PRESET_NAMES.map((name) => [name.replace(/\b\w/g, (c) => c.toUpperCase()), name]));	// 'Very Low': 'very low', ...
const presetController = gui.add(presetState, 'preset', presetNames).name('Graphics Preset').onChange((name) => {
	applyPreset(name);
	rememberDepthChoice(PRESETS[name].reversedDepth);		// (chosen by hand: its depth buffer the next time the page loads)
	// chosen by hand: that is the user deciding, the check stops
	if (presetCheck.state != 'done') presetCheck.stop('chosen by hand');
	presetState.override = true;
	overrideController.updateDisplay();
});
// how many pixels the picture is drawn with: not part of the presets (see display.js)
gui.add(imguiParams, 'renderResolution', RESOLUTIONS).name('Resolution');
// dynamic resolution: below the Resolution setting while the frame rate is under the target (see DYNAMIC RESOLUTION in display.js)
gui.add(imguiParams, 'dynamicResolution').name('Dynamic Resolution');
gui.add(imguiParams, 'dynamicResolutionTarget', 0, 60, 1).name('Target FPS');
const drawnAtController = gui.add(presetState, 'drawnAt').name('Drawn At').disable();
// A new Resolution setting or window size changes the frame rate a lot: the check gives it its settling time again, as for a new
//		preset. Not for dynamic resolution's own changes though: it makes them all the time, and the check would never get to measure
let sizedFor = [settings.renderResolution, canvas.clientWidth, canvas.clientHeight].join();
onRenderResize(() => {
	const now = [settings.renderResolution, canvas.clientWidth, canvas.clientHeight].join();
	if (now != sizedFor && presetCheck.state != 'done') presetCheck.settle(performance.now());
	sizedFor = now;
});
const overrideController = gui.add(presetState, 'override').name('Preset Override').onChange((on) => {
	if (on) presetCheck.stop('override ticked');
	else presetCheck.restart(presetState.preset, performance.now());
});
const statusController = gui.add(presetState, 'status').name('Auto Check').disable();

// at the top too: the sun going round is what moves the days on, and with them the seasons, the weather and the forest
gui.add(imguiParams, 'atmosphereSunRotationDemo').name('Sun Cycle (days and seasons)');

// how the scene is seen: Observe flies round it (see the Camera folder), Hunting and Sailing walks it on foot (hunting.js), with boats and
//		the rest from the spawn menu (T, radialMenu.js)
const modeFolder = gui.addFolder('Game Modes');
modeFolder.add(imguiParams, 'gameMode', { 'Observe': 'Observe', 'Hunting and Sailing': 'Hunting', 'Horde': 'Horde', 'War': 'War' }).name('Mode');
const huntingFolder = modeFolder.addFolder('Hunting and Sailing');	//click the picture to look round, WASD walk, Shift run, Space jump, T the spawn menu, hold Tab or Esc for the menus
huntingFolder.add(imguiParams, 'huntingWalkSpeed', 1, 8, 0.1).name('Walk Speed (m/s)');
huntingFolder.add(imguiParams, 'horseSpeed', 0.5, 5, 0.1).name('Horse Speed (x real)');
huntingFolder.add(imguiParams, 'boatSteadying', 0, 1, 0.01).name('Boat Steadying (0 off, 1 level)');
huntingFolder.add(imguiParams, 'buoyancy', 0.5, 2, 0.01).name('Buoyancy (boats, floats)');
huntingFolder.add(imguiParams, 'aiDifficulty', 0, 1, 0.01).name('AI Difficulty (NPC aim)');
huntingFolder.add(imguiParams, 'huntingJumpHeight', 0.1, 2, 0.05).name('Jump Height (m)');
huntingFolder.add(imguiParams, 'huntingLookSensitivity', 0.2, 3, 0.05).name('Mouse Sensitivity');
const hordeFolder = modeFolder.addFolder('Horde');	//rounds of feral deer, each bigger than the last (horde.js)
hordeFolder.add(imguiParams, 'hordeFirstWave', 1, 100, 1).name('First Round');
hordeFolder.add(imguiParams, 'hordeWaveGrowth', 1, 3, 0.05).name('Round Growth (x)');
hordeFolder.add(imguiParams, 'hordeMaxWave', 10, 6000, 10).name('Biggest Round');
hordeFolder.add(imguiParams, 'hordeAliveCap', 10, 1500, 10).name('Out at Once');
hordeFolder.add(imguiParams, 'hordeSpeed', 0.25, 5, 0.05).name('Deer Speed (x)');
hordeFolder.add(imguiParams, 'hordeDamage', 1, 50, 1).name('Lunge Damage');
hordeFolder.add(imguiParams, 'hordeBreakSeconds', 5, 120, 1).name('Break (s)');
hordeFolder.add({ again: () => import('./horde.js').then((horde) => horde.restartHorde()) }, 'again').name('Start Again');
// (the Horde game mode over, it puts this back to Hunting itself: horde.js)
import('./horde.js').then((horde) => { horde.modeHook.set = (mode) => { settings.gameMode = mode; imguiParams.gameMode = mode; }; });
const golfFolder = modeFolder.addFolder('Disc Golf');	//a course of tee pads and baskets on the land, to play with the discs from the spawn menu (discgolf.js)
golfFolder.add(imguiParams, 'discGolfEnabled').name('Course');
golfFolder.add(imguiParams, 'discGolfHoles', 1, 18, 1).name('Holes');
golfFolder.add({ again: () => { imguiParams.discGolfSeed += 1; } }, 'again').name('New Course');
const soundFolder = gui.addFolder('Sound');	//made as it plays, nothing downloaded (sound.js). It starts once the page is clicked
soundFolder.add(imguiParams, 'enableSound').name('Sound');
soundFolder.add(imguiParams, 'soundVolume', 0, 1, 0.05).name('Volume');

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
sunFolder.add(imguiParams, 'dayLengthSeconds', 10, 1800, 5).name('Day Length (s)');	//the one clock everything keeps time by (atmosphere.js)
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
displayFolder.add(imguiParams, 'antiAliasing', { 'SMAA': 'smaa', 'FXAA': 'fxaa', 'TAA': 'taa', 'TAA + FXAA': 'taa+fxaa', 'FSR 3 Native AA': 'fsr-native', 'FSR 3 Quality': 'fsr-quality', 'FSR 3 Balanced': 'fsr-balanced', 'FSR 3 Performance': 'fsr-performance', 'off': 'off' }).name('Anti-Aliasing');
// (the depth buffer is made as the page loads: a change is remembered, and is how it is the next time: depthMode.js)
displayFolder.add(imguiParams, 'reversedDepth').name(`Reversed-Z Depth (${reversedDepth ? 'on' : 'off'} now; on reload)`).onChange((on) => rememberDepthChoice(on));
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
terrainFolder.add(imguiParams, 'terrainTownCount', 0, 4, 1).name('Seaside Towns');
terrainFolder.add(imguiParams, 'terrainTownSize', 0.5, 1.6, 0.05).name('Town Size');
terrainFolder.add(imguiParams, 'terrainLandingStrip').name('Landing Strip');
terrainFolder.add(imguiParams, 'terrainFootpaths').name('Footpaths');
terrainFolder.add(imguiParams, 'enableTownFolk').name('Townsfolk');
terrainFolder.add(imguiParams, 'enableNPCs').name('NPCs (riders, airmen, sailors)');
terrainFolder.add(imguiParams, 'terrainRockDetail', 0, 3, 0.05).name('Rock Detail');
terrainFolder.add(imguiParams, 'terrainRockVeins', 0, 2, 0.05).name('Rock Veins');
terrainFolder.add(imguiParams, 'terrainGroundDetail', 0, 2, 0.05).name('Sand, Turf and Forest Floor');
terrainFolder.add(imguiParams, 'terrainDepthBias', 0, 4, 0.05).name('Depth Bias');
terrainFolder.add(imguiParams, 'terrainResolution', { '256': 256, '512': 512, '1k': 1024, '2k': 2048, '4k': 4096, '8k': 8192 }).name('Mesh Detail');	//these two only change the mesh, the land stays as it is
terrainFolder.add(imguiParams, 'terrainDetailDistance', 0.75, 5, 0.05).name('Detail Distance');
terrainFolder.add(imguiParams, 'terrainFarBake', { '256 (about 140MB)': 256, '128 (about 35MB)': 128, 'disabled (worked out live)': 0 }).name('Far Land Bake');	//see THE BAKE in terrain.js

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
forestFolder.add(imguiParams, 'forestYearsPerSunCycle', 1, 400, 1).name('Years per Day');
forestFolder.add(imguiParams, 'forestYear').name('Forest Year').disable();
forestFolder.add(imguiParams, 'forestTreeCount').name('Trees').disable();
forestFolder.add(imguiParams, 'forestDetailDistance', 10, 300, 5).name('Full Detail Distance');
forestFolder.add(imguiParams, 'forestMidDistance', 20, 800, 5).name('Mid Detail Distance');
forestFolder.add(imguiParams, 'forestThinnedRings', 0, 2, 1).name('Thinned Leaf Rings');	//levels of detail between the mid trees and the billboards, see forest.js
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
cloudFolder.add(imguiParams, 'cloudResolution', { 'half': 2, 'third': 3, 'quarter': 4 }).name('Resolution (of the frame)');
cloudFolder.add(imguiParams, 'cloudDrawDistance', 8000, 80000, 500).name('Draw Distance');

const animalFolder = gui.addFolder('Animal Life');
const birdFolder = animalFolder.addFolder('Hawks');	//see birds.js
birdFolder.add(imguiParams, 'enableBirds').name('Enable');
birdFolder.add(imguiParams, 'birdGroups', 0, 3, 1).name('Groups');
birdFolder.add(imguiParams, 'birdSize', 1, 30, 0.5).name('Wingspan');
birdFolder.add(imguiParams, 'birdSpeed', 0.2, 3, 0.05).name('Speed');
const geeseFolder = animalFolder.addFolder('Geese');	//see geese.js
geeseFolder.add(imguiParams, 'enableGeese').name('Enable');
geeseFolder.add(imguiParams, 'geeseCount', 0, 12, 1).name('Flock Size');
geeseFolder.add(imguiParams, 'geeseSize', 2, 30, 0.5).name('Wingspan');
const deerFolder = animalFolder.addFolder('Deer');	//see deer.js
deerFolder.add(imguiParams, 'enableDeer').name('Enable');
deerFolder.add(imguiParams, 'deerGroups', 0, 200, 1).name('Groups');
deerFolder.add(imguiParams, 'deerSize', 0.5, 3, 0.05).name('Size');

const shaftFolder = gui.addFolder('Light Shafts and Underwater');	//see lightShafts.js
shaftFolder.add(imguiParams, 'enableLightShafts').name('Light Shafts');
shaftFolder.add(imguiParams, 'lightShaftStrength', 0, 4, 0.05).name('Shaft Strength');
shaftFolder.add(imguiParams, 'enableUnderwater').name('Underwater View');
shaftFolder.add(imguiParams, 'underwaterStartDepth', 0, 2, 0.05).name('Underwater From (m deep)');
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
waterFolder.add(imguiParams, 'waterOceanWindSpeed', 0, 30).name('Wind Over The Sea');	//its own: the Wind folder's is the land's
waterFolder.add(imguiParams, 'waterSeed', 1, 1000, 1).name('Sea Seed');	//which waves (the same seed, the same sea on every machine)
waterFolder.add(imguiParams, 'waterFetch', 1, 1000, 1).name('Fetch (km)');
waterFolder.add(imguiParams, 'waterWorldPosY', -100, 100).name('World Pos Y');
waterFolder.add(imguiParams, 'waterTileResolution', [32, 64, 128, 256, 512, 1024]).name('Water Tile Resolution');
waterFolder.add(imguiParams, 'waterCascadeResolution', [128, 256, 512]).name('Wave Cascade Resolution');
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

const waterShoreFolder = waterFolder.addFolder('Shore');
waterShoreFolder.add(imguiParams, 'waterShallowRideHigh').name('Shallow Waves Ride High');
waterShoreFolder.add(imguiParams, 'enableBoulderWater').name('Water Round Boulders');

const waterSwellFolder = waterFolder.addFolder('Deep Sea Swell');
waterSwellFolder.add(imguiParams, 'waterDeepSeaDepth', 1, 1000, 1).name('Open Sea Depth');
waterSwellFolder.add(imguiParams, 'waterSwellHeight', 0, 150, 0.5).name('Swell Height');
waterSwellFolder.add(imguiParams, 'waterSwellLength', 100, 1500, 10).name('Swell Length');
waterSwellFolder.add(imguiParams, 'waterSwellSpread', 0, 1, 0.01).name('Long Crested');
waterSwellFolder.add(imguiParams, 'waterSwellDirection', -180, 180, 1).name('Direction Off Wind');


const atmosphereFolder = gui.addFolder('Atmosphere');
atmosphereFolder.add(imguiParams, 'enableAtmosphere').name('Enable');
atmosphereFolder.add(imguiParams, 'atmosphereScaleToScene', 0.1, 10).name('Scale');
atmosphereFolder.add(imguiParams, 'additionalAltitude', -200, 200).name('Altitude Offset');

const debugDisplayModes = ["final", 
							"shadow mapping visibility",
							"water line topology",
							"heightMap", 
							"shadowMapDepth", 
							"Oceanographic Spectrum (the 3 cascades, top to bottom)", 
							"h0(k) (the 3 cascades)", 
							"Waves Cascade 0 (r: Dx, g: height, b: Dz)", 
							"PreComp Twiddle Water", 
							"Waves Cascade 1", 
							"Waves Cascade 2",
							"Skyview LUT Texture",
							"Atmosphere Transmittance LUT Texture",
							"Wave Slopes Cascade 1 (r: dh/dx, g: dh/dz)",
							"Wave Slopes Cascade 2",
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
debugFolder.add(imguiParams, 'landOcclusion').name('Hide What the Land Hides');	//trees and boulders behind hills are skipped, see horizon.js
debugFolder.add(imguiParams, 'debugTextureRescaleSize', [32, 64, 128, 256, 512, 1024]).name('Debug Texture Size');
debugFolder.add(imguiParams, 'displayShoreDistanceDebugRange', 5, 300).name('Shore Distance View Range');

// every folder starts shut, the ones inside other folders as well
gui.foldersRecursive().forEach((folder) => folder.close());

// the preset the check starts on. (Up to here the settings are as settings.js has them, which is the High preset)
applyPreset(startingPreset.preset);

// Once a frame, after it is sent off: counts the frames the GPU has finished, and lets the preset check act on them
let framesFinished = 0, framesCounted = 0, statusShown = 0;
export function updateGraphicsPresets() {
	device.queue.onSubmittedWorkDone().then(() => framesFinished++);
	const now = performance.now();
	const finished = framesFinished - framesCounted;
	framesCounted = framesFinished;
	dynamicResolution.frame(now, finished, document.hidden, settings.dynamicResolution, settings.dynamicResolutionTarget);	// (the size it asks for is put in place at the start of the next frame, see rotatingCube.js)
	const action = presetCheck.frame(now, finished, document.hidden);
	if (action && action.lower) {
		applyPreset(action.lower);
		console.log("Graphics preset lowered to " + action.lower + " (" + presetCheck.fps.toFixed(1) + " fps)");
	}
	if (action && action.done) {
		console.log("Graphics preset check done: " + presetState.preset + ", " + action.done);
		if (action.override) {
			presetState.override = true;
		}
	}

	// what the check is doing, twice a second
	if (action || now - statusShown > 500) {
		statusShown = now;
		const fps = presetCheck.fps > 0 ? ', ' + Math.round(presetCheck.fps) + ' fps' : '';
		presetState.status = presetCheck.state == 'done' ? 'done: ' + presetCheck.why
			: presetCheck.state == 'settling' ? 'settling' + fps
			: 'measuring' + fps;
		statusController.updateDisplay();
		//		(FSR's upscaling: drawn at less, and the canvas's size made from it)
		const upscaled = drawn.width != canvas.width || drawn.height != canvas.height ? ' -> ' + canvas.width + ' x ' + canvas.height : '';
		presetState.drawnAt = drawn.width + ' x ' + drawn.height + upscaled + (settings.dynamicResolution ? ' (' + Math.round(dynamicResolution.scale * 100) + '%)' : '');
		drawnAtController.updateDisplay();
		presetController.updateDisplay();
		overrideController.updateDisplay();
	}
}


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

// only the controls whose value changed are redrawn: redrawing all of them every frame was a good part of the CPU time of a frame
let allControllers = null;
export function syncSettingsToParams() {
    const changed = new Set();
    Object.keys(imguiParams).forEach(key => {
        if (key in settings && !dropdownManagedKeys.has(key) && imguiParams[key] !== settings[key]) {
            imguiParams[key] = settings[key];
            changed.add(key);
        }
    });
    if (changed.size == 0) {
        return;
    }
    allControllers ??= gui.controllersRecursive();	//every controller, however deep its folder is
    for (const controller of allControllers) {
        if (controller.object === imguiParams && changed.has(controller.property)) controller.updateDisplay();
    }
}

//-----------------------ENTITY BASED SETTINGS----------------------------
const entityGUI = new GUI({ title: 'Entity Editor', container: dockLeft });	//(beside the Controls, see WHERE THE WINDOWS GO)
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

//-----------------------PERFORMANCE WINDOW----------------------------
// Nothing is timed, and nothing shows but the checkboxes, until Enable is ticked. Then, from the top:
//		the frame rate	over the last 10 seconds as a graph, with its average and its lows (the slow frames, see THE GRAPHS in profiler.js)
//		the CPU			the CPU time of each frame as a graph, and where it goes (CPU TIME in profiler.js)
//		the GPU			the GPU time of each frame as a graph, and of every pass in the frame, filed under what it belongs to (see
//						profiler.js). A row with an arrow opens to show the passes inside it and the shader each one runs. The bars are
//						all to one scale: full width is the longest top row of the frame before
//		Pause Graphs holds the graphs still (the rows carry on). Shut until it is asked for
const perfGUI = new GUI({ title: 'Performance', width: 380, container: dockRight });	//(in the dock, see WHERE THE WINDOWS GO)

const perfView = { sortByTime: false };
perfGUI.add(profiler.timing, 'enabled').name('Enable').onChange((on) => {
	if (on) {
		profiler.clearTimes();		// (what was there is from before it was turned off)
		perfShownFrame = -1;
		perfScale = 0;
	}
	perfBox.style.display = on ? '' : 'none';
	perfOff.style.display = on ? 'none' : '';
});
perfGUI.add(profiler.timing, 'average').name('Average 30 Frames');
perfGUI.add(perfView, 'sortByTime').name('Sort by Time');
perfGUI.add(profiler.graphs, 'paused').name('Pause Graphs');

const perfStyle = document.createElement('style');
perfStyle.textContent = `
.perf-summary { padding: 4px var(--padding); color: var(--text-color); font-family: var(--font-family-mono); line-height: 1.5; }
.perf-rows { padding-bottom: 4px; }
.perf-row { position: relative; display: flex; align-items: center; height: 18px; padding-right: 6px; cursor: default; white-space: nowrap; font-family: var(--font-family); }
.perf-row.perf-open { cursor: pointer; }
.perf-row:hover { background: var(--hover-color); }
.perf-track { position: absolute; top: 2px; bottom: 2px; right: 2px; }
.perf-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 2px; opacity: 0.6; }
.perf-arrow { position: relative; width: 12px; flex: none; color: var(--text-color); opacity: 0.8; font-size: 9px; }
.perf-name { position: relative; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; color: var(--text-color); }
.perf-row.perf-top .perf-name { font-weight: bold; }
.perf-shader { position: relative; flex: none; margin-left: 6px; color: var(--string-color); font-family: var(--font-family-mono); font-size: 10px; opacity: 0.9; }
.perf-ms { position: relative; flex: none; width: 58px; text-align: right; color: var(--number-color); font-family: var(--font-family-mono); }
.perf-heading { padding: 6px var(--padding) 2px; color: var(--text-color); font-weight: bold; opacity: 0.85; }
.perf-graph { display: block; position: static; inset: auto; width: calc(100% - 2 * var(--padding)); height: 80px; margin: 2px var(--padding) 4px; touch-action: auto; }	/* (position, inset: a page rule for every canvas cannot move it) */
.perf-note { padding: 2px var(--padding) 6px; color: var(--text-color); opacity: 0.55; font-size: 10px; white-space: normal; line-height: 1.35; }
`;
document.head.appendChild(perfStyle);

const perfBox = document.createElement('div');
const perfHeading = (text) => { const heading = document.createElement('div'); heading.className = 'perf-heading'; heading.textContent = text; return heading; };
const perfText = () => { const text = document.createElement('div'); text.className = 'perf-summary'; text.style.whiteSpace = 'pre'; return text; };
const perfCanvas = () => { const canvas = document.createElement('canvas'); canvas.className = 'perf-graph'; return canvas; };
const perfFrameText = perfText(), perfFrameGraph = perfCanvas();
const perfCpuText = perfText(), perfCpuGraph = perfCanvas();
const perfGpuGraph = perfCanvas();
let perfGpuStats = '';
const perfOff = document.createElement('div');
perfOff.className = 'perf-note';
perfOff.textContent = 'Timing is off. Enable times the CPU and the GPU, with a graph of each.';
const perfCpuRows = document.createElement('div');
perfCpuRows.className = 'perf-rows';
const perfSummary = document.createElement('div');
perfSummary.className = 'perf-summary';
perfSummary.style.whiteSpace = 'pre';
const perfRows = document.createElement('div');
perfRows.className = 'perf-rows';
const perfNote = document.createElement('div');
perfNote.className = 'perf-note';
perfNote.textContent = 'GPU time of each pass. While timing, a pass drawn with several shaders is split into one pass per shader, '
	+ 'which costs a little. Copies between passes are not timed. Chrome and Edge can round the times to 0.1 ms unless started with '
	+ '--enable-webgpu-developer-features.';
perfBox.append(perfHeading('Frame Rate (last 10 s)'), perfFrameText, perfFrameGraph,
	perfHeading('CPU, ms per frame'), perfCpuText, perfCpuGraph, perfCpuRows,
	perfHeading('GPU, ms per frame'), perfSummary, perfGpuGraph, perfRows, perfNote);
perfBox.style.display = 'none';
perfGUI.$children.append(perfOff, perfBox);

perfGUI.close();

const perfOpenRows = new Set();		// keys of the rows that are opened up
const perfRowElements = new Map();	// key -> the row's elements, made once and kept
let perfShownKeys = '';
let perfShownFrame = -1;
let perfScale = 0;					// ms that fills a bar: the longest top row of the frame before

function perfRowFor(node, depth) {
	let row = perfRowElements.get(node.key);
	if (!row) {
		const element = document.createElement('div');
		element.className = 'perf-row';
		element.style.paddingLeft = (4 + depth * 12) + 'px';
		const track = document.createElement('div');
		track.className = 'perf-track';
		track.style.left = (2 + depth * 12) + 'px';
		const fill = document.createElement('div');
		fill.className = 'perf-fill';
		track.appendChild(fill);
		const arrow = document.createElement('span');
		arrow.className = 'perf-arrow';
		const name = document.createElement('span');
		name.className = 'perf-name';
		const shader = document.createElement('span');
		shader.className = 'perf-shader';
		const ms = document.createElement('span');
		ms.className = 'perf-ms';
		element.append(track, arrow, name, shader, ms);
		if (depth == 0) element.classList.add('perf-top');
		element.addEventListener('click', () => {
			if (!element.classList.contains('perf-open')) return;
			if (perfOpenRows.has(node.key)) perfOpenRows.delete(node.key);
			else perfOpenRows.add(node.key);
			perfShownFrame = -1;	// lay the rows out again now, not on the next frame's times
			refreshPerformanceWindow();
		});
		row = { element, fill, arrow, name, shader, ms };
		perfRowElements.set(node.key, row);
	}
	return row;
}

// the rows that show: the top ones, and inside each opened row the ones under it
function perfVisibleRows(nodes, depth, list) {
	const ordered = perfView.sortByTime ? [...nodes].sort((a, b) => b.ms - a.ms) : nodes;
	for (const node of ordered) {
		list.push([node, depth]);
		if (node.children.length > 0 && perfOpenRows.has(node.key)) {
			perfVisibleRows(node.children, depth + 1, list);
		}
	}
	return list;
}

/*
	A graph of one of the series (see THE GRAPHS in profiler.js): the last frames as a line, oldest on the left, taller is slower.
	Behind it the 60 and 30 fps marks (where they fit), and across it the 5% and 1% lows. The scale grows to fit the slowest
	frames, and what the top is stands in the corner.
		floor	the least the top of the graph goes down to, ms
*/
function drawGraph(canvas, values, stats, color, floor) {
	const ratio = window.devicePixelRatio || 1;
	const width = Math.round(canvas.clientWidth * ratio), height = Math.round(canvas.clientHeight * ratio);
	if (width == 0) return;
	if (canvas.width != width || canvas.height != height) {
		canvas.width = width;
		canvas.height = height;
	}
	const ctx = canvas.getContext('2d');
	ctx.clearRect(0, 0, width, height);
	ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
	ctx.fillRect(0, 0, width, height);

	const slowest = values.reduce((most, value) => Math.max(most, value), 0);
	const step = slowest * 1.15 > 20 ? 10 : 1;
	const top = Math.max(floor, Math.ceil(slowest * 1.15 / step) * step);	// ms at the top of the graph
	const y = (ms) => height - Math.min(ms / top, 1) * height;
	ctx.font = `${10 * ratio}px monospace`;
	ctx.lineWidth = ratio;
	// a line across, labelled at labelAt (0 to 1 of the way across. The fps marks are labelled on the right, the lows on the
	//		left and a third of the way in, so the labels of lines close together dont land on each other)
	const level = (ms, lineColor, label, labelAt) => {
		ctx.strokeStyle = lineColor;
		ctx.fillStyle = lineColor;
		ctx.beginPath();
		ctx.moveTo(0, y(ms));
		ctx.lineTo(width, y(ms));
		ctx.stroke();
		ctx.textAlign = labelAt == 1 ? 'right' : 'left';
		ctx.fillText(label, labelAt == 1 ? width - 3 * ratio : 3 * ratio + labelAt * width, Math.max(y(ms) - 2 * ratio, 22 * ratio));
		ctx.textAlign = 'left';
	};
	ctx.setLineDash([]);
	if (1000 / 60 < top) level(1000 / 60, 'rgba(255, 255, 255, 0.3)', '60 fps', 1);
	if (1000 / 30 < top) level(1000 / 30, 'rgba(255, 255, 255, 0.3)', '30 fps', 1);
	ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
	ctx.textAlign = 'right';
	ctx.fillText(top + ' ms', width - 3 * ratio, 11 * ratio);
	ctx.textAlign = 'left';

	if (values.length > 1) {
		ctx.strokeStyle = color;
		ctx.beginPath();
		const from = width - (values.length - 1) / (profiler.SERIES_FRAMES - 1) * width;
		for (let i = 0; i < values.length; i++) {
			const x = from + i / (profiler.SERIES_FRAMES - 1) * width;
			if (i == 0) ctx.moveTo(x, y(values[i]));
			else ctx.lineTo(x, y(values[i]));
		}
		ctx.stroke();
	}

	ctx.setLineDash([4 * ratio, 3 * ratio]);
	if (stats.worst5 > 0) level(stats.worst5, '#f0c060', '5% low', 0);
	if (stats.worst1 > 0) level(stats.worst1, '#ff7a6a', '1% low', 0.3);
	ctx.setLineDash([]);
}

// the three graphs and the lines over them. Held still while the graphs are paused
function drawGraphs() {
	if (profiler.graphs.paused) {
		return;
	}
	const frame = profiler.series.frame.stats(), cpu = profiler.series.cpu.stats(), gpu = profiler.series.gpu.stats();
	const fps = (ms) => (ms > 0 ? 1000 / ms : 0).toFixed(1);
	perfFrameText.textContent = `avg ${fps(frame.average)} fps · 5% low ${fps(frame.worst5)} · 1% low ${fps(frame.worst1)}`;
	perfCpuText.textContent = `avg ${cpu.average.toFixed(2)} ms · 5% low ${cpu.worst5.toFixed(2)} · 1% low ${cpu.worst1.toFixed(2)}`;
	perfGpuStats = `avg ${gpu.average.toFixed(2)} ms · 5% low ${gpu.worst5.toFixed(2)} · 1% low ${gpu.worst1.toFixed(2)}`;
	drawGraph(perfFrameGraph, profiler.series.frame.recent(), frame, '#8fb8ff', 40);
	drawGraph(perfCpuGraph, profiler.series.cpu.recent(), cpu, '#7fd98f', 4);
	if (profiler.timing.supported) {
		drawGraph(perfGpuGraph, profiler.series.gpu.recent(), gpu, '#f0a060', 4);
	}
}

// Where the CPU time of a frame goes: one row for each stretch of the frame (see CPU TIME in profiler.js), with a bar to the
//		scale of the longest
const perfCpuRowElements = new Map();
function drawCpuRows() {
	const times = profiler.cpuTimes;
	const longest = times.reduce((most, row) => Math.max(most, row.ms), 0.001);
	const names = times.map((row) => row.name).join('\n');
	if (perfCpuRows.dataset.names !== names) {
		perfCpuRows.replaceChildren(...times.map((row) => {
			if (!perfCpuRowElements.has(row.name)) {
				const element = document.createElement('div');
				element.className = 'perf-row';
				element.style.paddingLeft = '16px';
				const track = document.createElement('div');
				track.className = 'perf-track';
				track.style.left = '2px';
				const fill = document.createElement('div');
				fill.className = 'perf-fill';
				track.appendChild(fill);
				const name = document.createElement('span');
				name.className = 'perf-name';
				name.textContent = row.name;
				const ms = document.createElement('span');
				ms.className = 'perf-ms';
				element.append(track, name, ms);
				perfCpuRowElements.set(row.name, { element, fill, ms });
			}
			return perfCpuRowElements.get(row.name).element;
		}));
		perfCpuRows.dataset.names = names;
	}
	for (const row of times) {
		const elements = perfCpuRowElements.get(row.name);
		const share = Math.min(row.ms / longest, 1);
		elements.fill.style.width = (share * 100).toFixed(1) + '%';
		elements.fill.style.background = `hsl(${(130 - 130 * share).toFixed(0)}, 70%, 42%)`;
		elements.ms.textContent = row.ms.toFixed(2) + ' ms';
	}
}

// once a frame, after it is sent off
export function refreshPerformanceWindow() {
	if (perfGUI._closed || !profiler.timing.enabled) {
		return;
	}
	const data = profiler.latest;
	drawGraphs();
	drawCpuRows();
	perfGpuGraph.style.display = profiler.timing.supported ? '' : 'none';
	if (!profiler.timing.supported) {
		perfSummary.textContent = 'No timestamp queries in this browser or on this GPU, so the passes cannot be timed.';
		perfRows.replaceChildren();
		perfShownKeys = '';
		return;
	}
	if (data.frame == perfShownFrame) {
		return;
	}
	perfShownFrame = data.frame;

	perfSummary.textContent = perfGpuStats + `\nthis frame ${data.total.toFixed(2)} ms in ${data.passCount} passes`
		+ (data.untimedPasses ? ` (+${data.untimedPasses} untimed)` : '');

	// bars: to the scale of the frame before (the first frame to its own)
	const longestTop = data.tree.reduce((most, node) => Math.max(most, node.ms), 0);
	const scale = perfScale > 0 ? perfScale : Math.max(longestTop, 0.001);
	perfScale = Math.max(longestTop, 0.001);

	const visible = perfVisibleRows(data.tree, 0, []);
	const keys = visible.map(([node]) => node.key).join('\n');
	if (keys !== perfShownKeys) {
		perfRows.replaceChildren(...visible.map(([node, depth]) => perfRowFor(node, depth).element));
		perfShownKeys = keys;
	}
	for (const [node, depth] of visible) {
		const row = perfRowFor(node, depth);
		const share = Math.min(node.ms / scale, 1);
		row.fill.style.width = (share * 100).toFixed(1) + '%';
		row.fill.style.background = `hsl(${(130 - 130 * share).toFixed(0)}, 70%, 42%)`;	// green for little, through yellow, to red for the longest
		const opens = node.children.length > 0;
		row.element.classList.toggle('perf-open', opens);
		row.arrow.textContent = opens ? (perfOpenRows.has(node.key) ? '▼' : '▶') : '';
		row.name.textContent = node.count > 1 ? `${node.name} ×${node.count}` : node.name;
		row.shader.textContent = node.shader ?? '';
		row.ms.textContent = node.ms.toFixed(2) + ' ms';
	}
}

//----------------------WINDOWS EVENT LISTENERS-------------------------------
export let guiActive = false;
gui.domElement.addEventListener('mousedown', () => guiActive = true);
gui.domElement.addEventListener('mouseup', () => guiActive = false);
entityGUI.domElement.addEventListener('mousedown', () => guiActive = true);
entityGUI.domElement.addEventListener('mouseup', () => guiActive = false);


