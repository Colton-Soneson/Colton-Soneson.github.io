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
    sunPosX: 0.0,
    sunPosY: 0.0,
    sunPosZ: -280.0,
    sunColor: vec3.create(0.992, 0.37, 0.325),
    sunIntensity: 75000.0,
    sunPadding: 1.0,
	//-------------------SHADOWS-------------------
    shadowMapHeight: 2048,
    shadowMapWidth: 2048,
	//--------------------DEBUG--------------------
    showDebug: false,
    activateSkybox: false
};