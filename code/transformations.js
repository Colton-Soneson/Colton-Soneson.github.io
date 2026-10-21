import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import {canvas} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {onRenderResize} from './deviceSelection.js'

import * as renderMath from './renderMath.js'
import { settings } from './settings.js';

// The view is 72 degrees from top to bottom, and as wide as the canvas's shape makes it. On a screen taller than it is wide (a phone
//		held upright) that would leave only a narrow slice of the world across it, so there it is 72 degrees from side to side
//		instead, and as tall as that makes it. Made again when the window changes shape (see display.js)
//		Looking through a scope (sharps.js, setZoom) narrows it by its magnification. baseVerticalViewAngle is the angle without it
//		(the guns in the hands are drawn with that: they are not seen through the scope)
const VIEW_ANGLE = (2 * Math.PI) / 5;
export let verticalViewAngle = VIEW_ANGLE;
export let baseVerticalViewAngle = VIEW_ANGLE;
let zoom = 1;
function makeProjection() {
	const aspect = canvas.width / canvas.height;
	baseVerticalViewAngle = aspect >= 1 ? VIEW_ANGLE : 2 * Math.atan(Math.tan(VIEW_ANGLE / 2) / aspect);
	verticalViewAngle = 2 * Math.atan(Math.tan(baseVerticalViewAngle / 2) / zoom);
	return mat4.perspective(verticalViewAngle, aspect, settings.camNearPlane, settings.camFarPlane);
}
export let projectionMatrix = makeProjection();
onRenderResize(() => { projectionMatrix = makeProjection(); });
// the view magnified (a scope): 1 for none
export function setZoom(magnification) {
	if (magnification === zoom) return;
	zoom = magnification;
	projectionMatrix = makeProjection();
}
export const zoomNow = () => zoom;

// how big one pixel is, as distance across per distance away from the camera (for the shaders that fade detail out at pixel size)
export function pixelSize() {
	return 2 * Math.tan(verticalViewAngle / 2) / canvas.height;
}

// Fly camera direction. Yaw is the compass turn (0 looks down -z, a positive turn swings right, towards +x),
//		pitch is the tilt above (+) or below (-) level. Both in radians
export function getCameraForward() {
	const level = Math.cos(settings.camPitch);
	return [Math.sin(settings.camYaw) * level, Math.sin(settings.camPitch), -Math.cos(settings.camYaw) * level];
}

// which way is up for the camera: straight up, unless something leans it (a boat rolling under the player, see hunting.js)
export const viewUp = [0, 1, 0];

// straight out to the camera's right, always level
export function getCameraRight() {
	return [Math.cos(settings.camYaw), 0, Math.sin(settings.camYaw)];
}

export function getViewMatrix() {

	// fly camera: looks where its yaw and pitch point, see cameraControls.js
	if (settings.cameraFlyMode) {
		const forward = getCameraForward();
		return mat4.lookAt([settings.camPosX, settings.camPosY, settings.camPosZ],
					   [settings.camPosX + forward[0], settings.camPosY + forward[1], settings.camPosZ + forward[2]],
					   viewUp);
	}

	// otherwise the camera always looks at the origin
	//this is to handle if we have our camera position parallel to the up vector, so change the up vector to right facing
	if (settings.camPosY > 0 && Math.abs(settings.camPosX) < 1e-6 && Math.abs(settings.camPosZ) < 1e-6) {
		return mat4.lookAt([settings.camPosX, settings.camPosY, settings.camPosZ],
					   [0,		 0,		  0],
					   [0,		 0,		  1]);
    }
	
	return mat4.lookAt([settings.camPosX, settings.camPosY, settings.camPosZ],
					   [0,		 0,		  0],
					   [0,		 1,		  0]);
}

export function getViewProj() {
	return mat4.mul(projectionMatrix, getViewMatrix());
}

// The 6 planes that box in what the camera sees, each as [x, y, z, d] with the normal pointing inwards. Read straight off the
//		view projection matrix (Gribb and Hartmann): a point is inside when x * p.x + y * p.y + z * p.z + d is 0 or more for all 6
export function getFrustumPlanes() {
	const m = getViewProj();
	const row = (i) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
	const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
	const planes = [
		r3.map((v, i) => v + r0[i]), r3.map((v, i) => v - r0[i]),		// left, right
		r3.map((v, i) => v + r1[i]), r3.map((v, i) => v - r1[i]),		// bottom, top
		r2, r3.map((v, i) => v - r2[i]),								// near, far
	];
	return planes.map((plane) => {
		const length = Math.hypot(plane[0], plane[1], plane[2]);
		return plane.map((v) => v / length);
	});
}

export function getInvViewProj() {
	return mat4.inverse(getViewProj());
}

export function getInvViewProjNoTranslation() {
    const view = getViewMatrix();
    
    const viewNoTrans = mat4.clone(view);
    // zero out translation (last column in column-major)
    viewNoTrans[12] = 0;
    viewNoTrans[13] = 0;
    viewNoTrans[14] = 0;

    const vp = mat4.mul(projectionMatrix, viewNoTrans);
    return mat4.inverse(vp);
}

export function getModelMatrix(t, r, s) { 
	const modelMatrix = mat4.create();
	mat4.identity(modelMatrix);
	//trs
	mat4.translate(modelMatrix, vec3.fromValues(t[0],t[1],t[2]), modelMatrix);
	mat4.rotateX( modelMatrix, renderMath.degToRad(r[0]), modelMatrix);
	mat4.rotateY( modelMatrix,  renderMath.degToRad(r[1]), modelMatrix);
	mat4.rotateZ( modelMatrix, renderMath.degToRad(r[2]), modelMatrix);
	mat4.scale( modelMatrix, vec3.fromValues(s[0],s[1],s[2]), modelMatrix);

	return modelMatrix;
}

export function getLightViewProjectionMat() {
	
	let upDir = [0,1,0];
	if (settings.sunPosY > 0 && Math.abs(settings.sunPosX) < 1e-6 && Math.abs(settings.sunPosZ) < 1e-6) {
		upDir = [0,0,1];
    }
	
	// looking from the sun's side at the buildings (settings.shadowMapCenter, set where terrain.js puts them): they are all the
	//		shadow map has in it, so its box goes where they are
	const center = settings.shadowMapCenter;
	const lightViewMatrix = mat4.lookAt([center[0] + settings.sunPosX, center[1] + settings.sunPosY, center[2] + settings.sunPosZ],
								center,
								upDir);
	
	//this is an orthographic projection
	//	THINK OF THIS AS A BIG BOX
	//  increase l,r,b,t for more capture
	
	const boxSize = 300;
	
	const lightProjectionMatrix = mat4.create();
	{
	const left = -boxSize;
	const right = boxSize;
	const bottom = -boxSize;
	const top = boxSize;
	const near = -400;	//the near plane is negative because its behind the lights view to correctly represent scene geometry in light space
	const far = 600;	//the far plane will increase the extent of the boxes depth at cost of accuracy
	mat4.ortho(left, right, bottom, top, near, far, lightProjectionMatrix);
	}
	
	const lightViewProjMatrix = mat4.multiply(
	lightProjectionMatrix,
	lightViewMatrix
	);
	
	return lightViewProjMatrix;
}

export function getTopDownViewProjectionMat() {
	
	const boxSize = 300;

	// the top down camera follows the main camera in whole steps of 64 height map texels instead of sliding smoothly
	//		that way the height map (and the shore distance field built from it) samples the terrain at the same world points every frame,
	//		so the shoreline doesnt crawl while the camera moves. Has to stay a multiple of the shore field texel (8 height map texels)
	const snap = ((2 * boxSize) / settings.heightMapResolution) * 64;
	const topDownX = Math.round(settings.camPosX / snap) * snap;
	const topDownZ = Math.round(settings.camPosZ / snap) * snap;

	const topDownViewMatrix = mat4.lookAt([topDownX, settings.topDownCameraHeight, topDownZ],
								[topDownX,0,topDownZ],
								[0,0,-1]);	//changed the up-vector to prevent camera being parallel to up axis

	const topDownProjectionMatrix = mat4.create();
	{
	const left = -boxSize;
	const right = boxSize;
	const bottom = -boxSize;
	const top = boxSize;
	const near = -400;	//the near plane is negative because its behind the lights view to correctly represent scene geometry in light space
	const far = 600;	//the far plane will increase the extent of the boxes depth at cost of accuracy
	mat4.ortho(left, right, bottom, top, near, far, topDownProjectionMatrix);
	}
	
	const topDownViewProjMatrix = mat4.multiply(
	topDownProjectionMatrix,
	topDownViewMatrix
	);
	
	return topDownViewProjMatrix;
}

export function getMatrixTransformSpaces(model, numInstances) {
	const spaceBuffer = [];

	const viewMatrix = getViewMatrix();
  
	const modelMatrix = getModelMatrix(model.worldTranslation, model.worldRotation, model.worldScale);
	const modelViewMat = mat4.mul(viewMatrix, modelMatrix);
	const inverseModelViewMat = mat4.invert(modelViewMat);
	const modelViewProjectionMatrix = mat4.mul(projectionMatrix, modelViewMat);
	var normalMat = mat4.create();
	normalMat = mat4.transpose(mat4.invert(modelMatrix));

	//with instances, we want the arrays to match up with the shader
	//	maybe it would be best to have each of these split into multiple functions, to then be done in a compute shader, to save time with async
	for(let instance = 0; instance < numInstances; instance++) {
		for(let i = 0; i < 16; i++) {
			spaceBuffer.push(modelViewProjectionMatrix[i]);
		}
	}
	for(let instance = 0; instance < numInstances; instance++) {
		for(let i = 0; i < 16; i++) {
			spaceBuffer.push(modelMatrix[i]);
		}
	}
	for(let instance = 0; instance < numInstances; instance++) {
		for(let i = 0; i < 16; i++) {
			spaceBuffer.push(normalMat[i]);
		}
	}
  
  return new Float32Array(spaceBuffer);
}
