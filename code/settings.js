import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

export const settings = {
	//--------------------TIME---------------------
    step: 0,
	//---------------------TRS---------------------
    camPosX: 0.0,
    camPosY: 35.0,
    camPosZ: 150.0,
    camFarPlane: 800.0,
    camNearPlane: 1.0,
	//-----------------SUN SETTINGS----------------
    sunPosX: -40.0,
    sunPosY: 140.0,
    sunPosZ: -280.0,
    sunColor: vec3.create(0.992, 0.37, 0.325),
    sunIntensity: 75000.0,
    sunPadding: 1.0,
	//-------------------SHADOWS-------------------
    shadowMapSize: 2048,
	shadowMapPCFKernelSize: 1,
	shadowMapAcneBias: 0.005,
	//-----------------POST EFFECTS----------------
	enablePostEffects: false,
	//--------------------GRASS--------------------
	enableGrass: true,
	grassDensityPerTile: 64,	//tile size will determine density using distance from camera
	grassTotalBladeCount: 1024,	//make this base 2 for testing purposes
	//--------------------DEBUG--------------------
    showDebug: true,
	showDebugIcons: false,
    activateSkybox: false,
	debugViewMode: 0
};