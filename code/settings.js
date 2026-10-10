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
	waterTileInstanceCount: 5,
	waterWorldPosY: -16,
	waterOceanPlanePhysicalSize: 256.0,
	waterWindSpeed: 5.0,
	waterGridSize: 1024.0,
	waterHorizonFogDistance: 4000.0,	//distance where the water is about two thirds faded into the horizon colour
	waterClarityDepth: 2.0,				//depth of water where the sea bed has faded to about a third, fully hidden by 2x this. 0 = opaque water
	waterFullDepth: 20.0,				//water deeper than this gets the full open ocean waves
	waterShallowRippleScale: 0.02,		//height of the spikey ripples that replace the waves in shallow water
	//chop and foam
	waterChoppiness: 1.25,				//lambda in the tessendorf paper. Around 1.0 is where crests start folding over themselves
	waterFoamThreshold: 0.4,			//foam starts where the jacobian (how squeezed the surface is, 1 = not at all) drops below this
	waterFoamFade: 0.4,					//how far below the threshold until the foam is fully white
	//shore waves
	waterShoreZone: 70.0,				//distance from land where the ocean waves hand over to the shore waves. The shore field only reaches 150
	waterShoreWaveHeight: 2.4,			//crest height at the break line
	waterShoreBreakDistance: 12.0,		//distance from land where the shore waves are tallest
	waterShoreSteepness: 2.2,			//how far the crests lean and sharpen as they come in. Too high folds the mesh
	waterShoreWaveLength1: 30.0,		//wavelengths of the two shore wave trains. Keep them several mesh cells (about 4 units each) long
	waterShoreWaveLength2: 21.5,
	waterShoreWaveSpeed: 1.0,			//1.0 keeps pace with the dominant open ocean waves
	//deep sea swell
	waterDeepSeaDepth: 40.0,			//water at least this deep (or with no sea bed at all) is deep sea and gets the full swell
	waterSwellHeight: 16.0,				//height of the biggest swell crests. 0 turns the swell off
	waterSwellLength: 320.0,			//wavelength of the main swell
	waterSwellSteepness: 0.8,			//0 = smooth sine rollers, 1 = full trochoid with peaked crests and flat troughs
	waterSwellSpeed: 1.0,				//1.0 is the natural speed for the wavelength
	waterSwellShoreDistance: 150.0,		//distance from land where the swell is back to full size. The shore field only reaches 150
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
	displayLightingMode: 0,
	debugTextureRescaleSize: 512.0
};