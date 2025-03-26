import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import {canvas} from './deviceSelection.js'
import {context} from './deviceSelection.js'

import * as renderMath from './renderMath.js'
import { settings } from './settings.js';

const aspect = canvas.width / canvas.height;
export const projectionMatrix = mat4.perspective((2 * Math.PI) / 5, aspect, settings.camNearPlane, settings.camFarPlane);

export function getViewMatrix() {
	return mat4.lookAt([settings.camPosX, settings.camPosY, settings.camPosZ],
					   [0,		 0,		  0],
					   [0,		 1,		  0]);
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
	const lightViewMatrix = mat4.lookAt([settings.sunPosX, settings.sunPosY, settings.sunPosZ], 
								[0,0,0], 	//this is origin, not sure how to do this for omnidirectional lights
								[0,1,0]);
	
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
	
	//we look from above camera view, to beneath it
	//		!!!!SEE IF THIS CAUSES RENDER PROBLEMS!!!!
	const topDownViewMatrix = mat4.lookAt([settings.camPosX, settings.topDownCameraHeight, settings.camPosZ], 
								[settings.camPosX,0,settings.camPosZ], 	
								[0,1,0]);
	
	const boxSize = 300;	
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
	const now = Date.now() / 1000;

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
