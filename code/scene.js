import * as primitives from '../models/primitives.js'
import { settings } from './settings.js';
import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'

function loadModel(vertices, faces, normals, uvs) {
	const positions = [];
	for(let posCount = 0; posCount < (vertices.length / primitives.vertDim); posCount++)
	{
		positions[posCount] = [vertices[(posCount * primitives.vertDim) + 0], vertices[(posCount * primitives.vertDim) + 1], vertices[(posCount * primitives.vertDim) + 2]];
	}
	//console.log("---position list-----");
	//console.log(positions);
	
	const uvSplitting = [];
	for(let uvsCount = 0; uvsCount < (uvs.length / 2); uvsCount++)
	{
		uvSplitting[uvsCount] = [uvs[(uvsCount * 2) + 0], uvs[(uvsCount * 2) + 1]];
	}
	//console.log("---uvs list-----");
	//console.log(uvSplitting);
	
	const normalSplitting = [];
	for(let normCount = 0; normCount < (normals.length / primitives.vertDim); normCount++)
	{
		normalSplitting[normCount] = [normals[(normCount * primitives.vertDim) + 0], normals[(normCount * primitives.vertDim) + 1], normals[(normCount * primitives.vertDim) + 2]];
	}
	//console.log("---normals list-----");
	//console.log(normalSplitting);
	
	console.log("MEEP ", faces.length / 3);
	const result = [];
	//for the entire length of faces (ordered v1,vt1,vn1,v2,vt2,vn2,...) assign accordingly
	for(let faceCount = 0; faceCount < (faces.length / 3); faceCount++)	//3 for divider: v, vt, vn. If there was a vp then its 4
	{
		result.push(positions[faces[(faceCount * 3) + 0] - 1][0]);
		result.push(positions[faces[(faceCount * 3) + 0] - 1][1]);
		result.push(positions[faces[(faceCount * 3) + 0] - 1][2]);
		
		result.push(uvSplitting[faces[(faceCount * 3) + 1] - 1][0]);
		result.push(uvSplitting[faces[(faceCount * 3) + 1] - 1][1]);
		
		result.push(normalSplitting[faces[(faceCount * 3) + 2] - 1][0]);
		result.push(normalSplitting[faces[(faceCount * 3) + 2] - 1][1]);
		result.push(normalSplitting[faces[(faceCount * 3) + 2] - 1][2]);
	}
	
	return result;
}

export const entityModelsStride = [];

export function loadModelsToVBArray(entityModelList, modelCount, name, ems) {
	const result = [];
	console.log("Vertex Buffer Array Model Load Function:" , name);	
	
	for(let i = 0; i < modelCount; ++i)
	{
		const tempModelArray = loadModel(entityModelList[i].vertices,
										entityModelList[i].faces,
										entityModelList[i].normals,
										entityModelList[i].uvs);
		for(let j = 0; j < tempModelArray.length; ++j)
		{
			result.push(tempModelArray[j]);
		}
		ems.push(tempModelArray.length);
		console.log("Model: ", i, "  Array Total Stride: ", tempModelArray.length);
	}
	
	return new Float32Array(result);
}

//textures
export const modelsTexturesList = [];
export function loadModelTextures (models, mtl) {
	for(let i = 0; i < models.length; ++i)
	{
		const resultTexture = device.createTexture({
			size: [models[i].textureBitmap.width, models[i].textureBitmap.height, 1],
			format: 'rgba8unorm',
			usage:
			GPUTextureUsage.TEXTURE_BINDING |
			GPUTextureUsage.COPY_DST |
			GPUTextureUsage.RENDER_ATTACHMENT,
		});
		
		device.queue.copyExternalImageToTexture(
			{ source: models[i].textureBitmap },
			{ texture: resultTexture },
			[models[i].textureBitmap.width, models[i].textureBitmap.height]
		);
		
		mtl.push(resultTexture);
	}
}

export function searchListIndexForEntityByName(ml, name) {
	for(let i = 0; i < ml.length; ++i) {
		if(ml[i].name == name) {
			return i;
		}
	}
	
	//wasnt found, for now crash condition
	console.log("Critical Failure: entity name not found in model list");
	return ml.length + 1;
}

export const entityModels = [];
entityModels.push(primitives.pIslandHouse);
entityModels.push(primitives.pLightHouse);
entityModels.push(primitives.pBench);
entityModels.push(primitives.pGround);
entityModels.push(primitives.pWavePlane);

//test for lighting right now
if(settings.showDebugIcons) {
	entityModels.push(primitives.pTest);
	entityModels[entityModels.length - 1].worldTranslation[0] = setttings.sunPosX;
	entityModels[entityModels.length - 1].worldTranslation[1] = setttings.sunPosY;
	entityModels[entityModels.length - 1].worldTranslation[2] = setttings.sunPosZ;
}

//for now, always leave skybox as last or this will break
if(settings.activateSkybox) {
	entityModels.push(primitives.pSkybox);
}

console.log("entity models: ", entityModels);
const genericShaderVertexBufferArray = loadModelsToVBArray(entityModels, entityModels.length, "generic shader VBA", entityModelsStride);

loadModelTextures(entityModels, modelsTexturesList);
console.log("Scene Textures: ", modelsTexturesList);

//-----------------VB OF GENERIC SHADER MODELS-----------------------
//GPU Side memory management done through GPUBuffer objects
export const vertexBuffer = device.createBuffer({
	label: "generic model vertices",		//just helps to identify object, can be anything you type
	size: genericShaderVertexBufferArray.byteLength,	//for 12 float vertices thats 48 bytes, cant be resized after creation
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,	//its use is for vertex data, and that you want to copy data into it
});
device.queue.writeBuffer(vertexBuffer, /*bufferOffset=*/0, genericShaderVertexBufferArray); //copy vertex data to buffer

//now tell WebGPU what the hell to do with the info
export const vertexBufferLayout = {
arrayStride: primitives.totalStride, //number of bytes gpu needs to skip forward to get to the next vertex (with two vertices per vertex, thats 
attributes: [{			//stuff like color, normal direction, etc
	format: "float32x3",//cant be anything, there is a list of GPUVertexFormat types in this case, its specific to pass in
	offset: 0,			//how many bytes into the vertex this attribute starts, use if you have more than one attribute
	shaderLocation: 0, // Position, see vertex shader, can be 0 - 15 and is unique to each attribute
	},
	{			
	format: "float32x2",
	offset: primitives.vertStride,
	shaderLocation: 1, 
	},
	{			
	format: "float32x3",
	offset: primitives.vertStride + primitives.uvStride,
	shaderLocation: 2, 
	}
	],

};
