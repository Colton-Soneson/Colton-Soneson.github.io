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
    // Sun
    sunPosX: settings.sunPosX,
    sunPosY: settings.sunPosY,
    sunPosZ: settings.sunPosZ,
    sunIntensity: settings.sunIntensity,
    sunCycleAngle: settings.sunCycleAngle,
    // Shadows
    shadowMapPCFKernelSize: settings.shadowMapPCFKernelSize,
    shadowMapAcneBias: settings.shadowMapAcneBias,
    // Post Effects
    enablePostEffects: settings.enablePostEffects,
    // Grass
    enableGrass: settings.enableGrass,
    grassTotalBladeCount: settings.grassTotalBladeCount,
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
    // Atmosphere
    enableAtmosphere: settings.enableAtmosphere,
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
	displaySkyViewLUTtexture: settings.displaySkyViewLUTtexture,
	displayTransmittanceLUTtexture: settings.displayTransmittanceLUTtexture,
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
camFolder.add(imguiParams, 'camFarPlane', 100, 10000).name('Far Plane');

const sunFolder = gui.addFolder('Sun');
sunFolder.add(imguiParams, 'sunPosX', -2000, 2000).name('Pos X');
sunFolder.add(imguiParams, 'sunPosY', -2000, 2000).name('Pos Y');
sunFolder.add(imguiParams, 'sunPosZ', -2000, 2000).name('Pos Z');
sunFolder.add(imguiParams, 'sunIntensity', 0, 500000).name('Intensity');
sunFolder.add(imguiParams, 'sunCycleAngle', 0, 6.2832).name('Cycle Angle (2 pi)');

const shadowFolder = gui.addFolder('Shadows');
shadowFolder.add(imguiParams, 'shadowMapPCFKernelSize', 1, 16, 1).name('PCF Kernel Size');
shadowFolder.add(imguiParams, 'shadowMapAcneBias', 0, 0.05, 0.0001).name('Acne Bias');

const grassFolder = gui.addFolder('Grass');
grassFolder.add(imguiParams, 'enableGrass').name('Enable');
grassFolder.add(imguiParams, 'grassTotalBladeCount', 1, settings.grassTotalHARDLIMIT, 1).name('Blade Count')
    .onChange((value) => {
        settings.grassTotalBladeCount = value;
        grass.grassUpdateStorageVertexBuffer();  // resize the storage buffer
    });

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
							"Atmosphere Transmittance LUT Texture"];

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

    if (selectedDebugDisplayMode === 2) {
        water.waterPipelineSignalUpdate('line-list');
    } else {
        water.waterPipelineSignalUpdate('triangle-list');
    }
});
debugFolder.add(imguiParams, 'debugTextureRescaleSize', [32, 64, 128, 256, 512, 1024]).name('Debug Texture Size');


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
    gui.controllers.forEach(c => c.updateDisplay());
    gui.folders.forEach(f => f.controllers.forEach(c => c.updateDisplay()));
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


