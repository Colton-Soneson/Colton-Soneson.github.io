import {loadObjFileVerts, loadObjFileFaces, loadObjFileNormals, loadObjFileUVs} from '../code/objLoader.js'

function Primitive(dimensions, vertices, faces, normals, uvs, textureBitmap, worldTranslation, worldRotation, worldScale, name) {
	this.dimensions = dimensions;
	this.vertices = vertices;
	this.faces = faces;
	this.normals = normals;
	this.uvs = uvs;
	this.textureBitmap = textureBitmap;
	this.worldTranslation = worldTranslation;
	this.worldRotation = worldRotation;
	this.worldScale = worldScale;
	this.name = name;
	
}

//----------------------HELPER FUNCS----------------------
async function loadTextureImageBitmap(path){
	const response = await fetch(path);
	const imageBitmap = await createImageBitmap(await response.blob());
	
	return imageBitmap;
}


//-------------------------OBJ----------------------------
export const pIslandHouse = new Primitive(
	3, 
	new Float32Array(await loadObjFileVerts('./models/islandhouse2.obj')),
	new Float32Array(await loadObjFileFaces('./models/islandhouse2.obj')),
	new Float32Array(await loadObjFileNormals('./models/islandhouse2.obj')),
	new Float32Array(await loadObjFileUVs('./models/islandhouse2.obj')),
	await loadTextureImageBitmap('./textures/FinalIslandHouse2FlipY.png'),
	new Float32Array([-63.0,-7.0,7.0]),
	new Float32Array([0.0,-45.0,0.0]),
	new Float32Array([0.7, 0.7, 0.7]),
	"IslandHouse",
);

export const pLightHouse = new Primitive(
	3, 
	new Float32Array(await loadObjFileVerts('./models/lighthouse.obj')),
	new Float32Array(await loadObjFileFaces('./models/lighthouse.obj')),
	new Float32Array(await loadObjFileNormals('./models/lighthouse.obj')),
	new Float32Array(await loadObjFileUVs('./models/lighthouse.obj')),
	await loadTextureImageBitmap('./textures/FinalLighthouseTextureFlipY.png'),
	new Float32Array([-53.0,-7.0,-5.0]),
	new Float32Array([0.0,90.0,0.0]),
	new Float32Array([0.7, 0.7, 0.7]),
	"Lighthouse",
);

export const pBench = new Primitive(
	3, 
	new Float32Array(await loadObjFileVerts('./models/bench.obj')),
	new Float32Array(await loadObjFileFaces('./models/bench.obj')),
	new Float32Array(await loadObjFileNormals('./models/bench.obj')),
	new Float32Array(await loadObjFileUVs('./models/bench.obj')),
	await loadTextureImageBitmap('./textures/BenchTextureFlipY.png'),
	new Float32Array([18.0,-5.25,1.0]),
	new Float32Array([10.0,-45.0,10.0]),
	new Float32Array([0.1, 0.1, 0.1]),
	"Bench",
);

export const pGround = new Primitive(
	3, 
	new Float32Array(await loadObjFileVerts('./models/ground.obj')),
	new Float32Array(await loadObjFileFaces('./models/ground.obj')),
	new Float32Array(await loadObjFileNormals('./models/ground.obj')),
	new Float32Array(await loadObjFileUVs('./models/ground.obj')),
	await loadTextureImageBitmap('./textures/groundFlipY.png'),
	new Float32Array([0.0,-20.0,0.0]),
	new Float32Array([0.0,90.0,0.0]),
	new Float32Array([0.45,0.45,0.45]),
	"Ground",
);

export const pWavePlane = new Primitive(
	3, 
	new Float32Array(await loadObjFileVerts('./models/waveplane.obj')),
	new Float32Array(await loadObjFileFaces('./models/waveplane.obj')),
	new Float32Array(await loadObjFileNormals('./models/waveplane.obj')),
	new Float32Array(await loadObjFileUVs('./models/waveplane.obj')),
	await loadTextureImageBitmap('./textures/STOCKanimewater.png'),
	new Float32Array([0,-16.0,0]),
	new Float32Array([0,0,0]),
	new Float32Array([10,10,10]),
	"Waves",
);

export const pSkybox = new Primitive(
	3, 
	new Float32Array(await loadObjFileVerts('./models/skybox.obj')),
	new Float32Array(await loadObjFileFaces('./models/skybox.obj')),
	new Float32Array(await loadObjFileNormals('./models/skybox.obj')),
	new Float32Array(await loadObjFileUVs('./models/skybox.obj')),
	await loadTextureImageBitmap('./textures/skyboxTexture.png'),
	new Float32Array([0.0,0,0]),
	new Float32Array([0,0,0]),
	new Float32Array([15,15,15]),
	"Skybox",
);

export const pTest = new Primitive(
	3, 
	new Float32Array(await loadObjFileVerts('./models/test.obj')),
	new Float32Array(await loadObjFileFaces('./models/test.obj')),
	new Float32Array(await loadObjFileNormals('./models/test.obj')),
	new Float32Array(await loadObjFileUVs('./models/test.obj')),
	await loadTextureImageBitmap('./textures/testFlipY.png'),
	new Float32Array([0.0,0,0.0]),
	new Float32Array([0,0,0]),
	new Float32Array([3,3,3]),
	"Test",
);

//export const pSuzanne = new Primitive(
//	3, 
//	new Float32Array(await loadObjFileVerts('./models/monkey.obj')),
//	new Float32Array(await loadObjFileFaces('./models/monkey.obj')),
//);
//
//export const pTotoro = new Primitive(
//	3, 
//	new Float32Array(await loadObjFileVerts('./models/totoro.obj')),
//	new Float32Array(await loadObjFileFaces('./models/totoro.obj')),
//);

//--------------------------2D----------------------------
export const pSquare = new Primitive(
	2, 
	new Float32Array([
		//   X,    Y,
		-0.8, -0.8, // Triangle 1 
		0.8, -0.8,
		0.8,  0.8,
		
		-0.8, -0.8, // Triangle 2 
		0.8,  0.8,
		-0.8,  0.8,
	]),
	0,
);

export const pTriangle = new Primitive(
	2,
	new Float32Array([
		0.0, 0.5,
		-0.5, -0.5,
		0.5, -0.5,
	]),
	0,
);

//--------------------------3D----------------------------
export const pCube = new Primitive(
	3, 
	new Float32Array([
		//   X,    Y,	Z
		 1.000000, 1.000000, -1.000000,
		 1.000000, -1.000000, -1.000000,
		 1.000000, 1.000000, 1.000000,
		 1.000000, -1.000000, 1.000000,
		 -1.000000, 1.000000, -1.000000,
		 -1.000000, -1.000000, -1.000000,
		 -1.000000, 1.000000, 1.000000,
		 -1.000000, -1.000000, 1.000000,
	]),
	new Float32Array([
		5, 3, 1,
		3, 8, 4,
		7, 6, 8,
		2, 8, 6,
		1, 4, 2,
		5, 2, 6,
		5, 7, 3,
		3, 7, 8,
		7, 5, 6,
		2, 4, 8,
		1, 3, 4,
		5, 1, 2,
	]),
);

export const pCubeOld = new Primitive(
	4, 
	new Float32Array([
		//   X,    Y,	Z
		1, -1, 1, 1, 
		-1, -1, 1, 1,
		-1, -1, -1, 1,
		1, -1, -1, 1,
		1, -1, 1, 1, 
		-1, -1, -1, 1,
		1, 1, 1, 1,  
		1, -1, 1, 1, 
		1, -1, -1, 1,
		1, 1, -1, 1, 
		1, 1, 1, 1,  
		1, -1, -1, 1,
		-1, 1, 1, 1, 
		1, 1, 1, 1,  
		1, 1, -1, 1, 
		-1, 1, -1, 1,
		-1, 1, 1, 1, 
		1, 1, -1, 1, 
		-1, -1, 1, 1,
		-1, 1, 1, 1, 
		-1, 1, -1, 1,
		-1, -1, -1, 1,
		-1, -1, 1, 1,
		-1, 1, -1, 1,
		1, 1, 1, 1,  
		-1, 1, 1, 1, 
		-1, -1, 1, 1,
		-1, -1, 1, 1,
		1, -1, 1, 1, 
		1, 1, 1, 1,  
		1, -1, -1, 1,
		-1, -1, -1, 1
		-1, 1, -1, 1,
		1, 1, -1, 1, 
		1, -1, -1, 1,
		-1, 1, -1, 1,
		
	]),
	0,
);