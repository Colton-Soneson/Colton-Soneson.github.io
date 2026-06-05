import { mat4, vec3, vec2 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

export const settings = {
	//--------------------TIME---------------------
    step: 0,
	//---------------------TRS---------------------
    camPosX: 0.0,
    camPosY: 35.0,
    camPosZ: 150.0,
    camFarPlane: 2500.0,
    camNearPlane: 1.0,
	//-----------------SUN SETTINGS----------------
    sunPosX: 90.0,
    sunPosY: 5.0,
    sunPosZ: -210.0,
    sunColor: vec3.create(0.992, 0.37, 0.325),
    sunIntensity: 75000.0,
	sunCycleAngle: 0.0,
    sunPadding: 1.0,
	//--------------------SCENE--------------------
	heightMapResolution: 2048,
	topDownCameraHeight: 60.0,
	//-------------------SHADOWS-------------------
    shadowMapSize: 2048,
	shadowMapPCFKernelSize: 1,
	shadowMapAcneBias: 0.005,
	//-----------------POST EFFECTS----------------
	enablePostEffects: false,
	//--------------------GRASS--------------------
	enableGrass: true,
	grassDensityPerTile: 64,	//tile size will determine density using distance from camera
	grassTotalBladeCount: 64,	//make this base 2 for testing purposes
	grassTotalHARDLIMIT: 131072, //the buffers Can handle more than this, but doubling will go over the 128mb size of storage buffer
	//--------------------WATER--------------------
	enableWater: true,
	windDirection: vec2.create(1.0,1.0),
	waterWaveSteepness: 0.1,	//0 - 1
	waterWaveLength: 10.0,
	waterTileResolution: 256.0,
	waterTileInstanceCount: 3,
	waterWorldPosY: -16,
	waterOceanPlanePhysicalSize: 256.0,
	waterWindSpeed: 5.0,
	waterGridSize: 1024.0,
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
	displaySkyViewLUTtexture: false,
	displayTransmittanceLUTtexture: false,
	displayLightingMode: 0,
	debugTextureRescaleSize: 512.0
};