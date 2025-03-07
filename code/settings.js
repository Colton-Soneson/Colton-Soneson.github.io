import { mat4, vec3, vec2 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

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
	grassTotalBladeCount: 4,	//make this base 2 for testing purposes
	grassTotalHARDLIMIT: 131072, //the buffers Can handle more than this, but doubling will go over the 128mb size of storage buffer
	//--------------------WATER--------------------
	enableWater: true,
	windDirection: vec2.create(0.5,0.5),
	waterWaveHeight: 3.0,
	waterTileResolution: 1024,
	waterTileInstanceCount: 3,
	waterWorldPosY: -16,
	//--------------------DEBUG--------------------
    showDebug: true,
	showDebugIcons: false,
    activateSkybox: false,
	debugViewMode: 0
};