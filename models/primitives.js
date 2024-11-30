import {loadObjFileVerts, loadObjFileFaces, loadObjFileNormals, loadObjFileUVs} from '../code/objLoader.js'

function Primitive(dimensions, vertices, faces, normals, uvs, texture, worldTranslation, worldRotation, worldScale) {
	this.dimensions = dimensions;
	this.vertices = vertices;
	this.faces = faces;
	this.normals = normals;
	this.uvs = uvs;
	this.texture = texture;
	this.worldTranslation = worldTranslation;
	this.worldRotation = worldRotation;
	this.worldScale = worldScale;
	
}

//-------------------------OBJ----------------------------
export const pIslandHouse = new Primitive(
	3, 
	new Float32Array(await loadObjFileVerts('./models/islandhouse.obj')),
	new Float32Array(await loadObjFileFaces('./models/islandhouse.obj')),
	new Float32Array(await loadObjFileNormals('./models/islandhouse.obj')),
	new Float32Array(await loadObjFileUVs('./models/islandhouse.obj')),
	'blankForNow',
	new Float32Array([-20.0,-1.0,-5.0]),
	new Float32Array([0.0,-45.0,0.0]),
	new Float32Array([1.0, 1.0, 1.0]),
);

export const pBench = new Primitive(
	3, 
	new Float32Array(await loadObjFileVerts('./models/bench.obj')),
	new Float32Array(await loadObjFileFaces('./models/bench.obj')),
	new Float32Array(await loadObjFileNormals('./models/bench.obj')),
	new Float32Array(await loadObjFileUVs('./models/bench.obj')),
	'blankForNow',
	new Float32Array([-2.0,-1.0,-5.0]),
	new Float32Array([0.0,-45.0,0.0]),
	new Float32Array([0.5, 0.5, 0.5]),
);

export const pGround = new Primitive(
	3, 
	new Float32Array(await loadObjFileVerts('./models/ground.obj')),
	new Float32Array(await loadObjFileFaces('./models/ground.obj')),
	new Float32Array(await loadObjFileNormals('./models/ground.obj')),
	new Float32Array(await loadObjFileUVs('./models/ground.obj')),
	'blankForNow',
	new Float32Array(),
	new Float32Array(),
	new Float32Array(),
);

export const pTest = new Primitive(
	3, 
	new Float32Array(await loadObjFileVerts('./models/test.obj')),
	new Float32Array(await loadObjFileFaces('./models/test.obj')),
	new Float32Array(await loadObjFileNormals('./models/test.obj')),
	new Float32Array(await loadObjFileUVs('./models/test.obj')),
	'blankForNow',
	new Float32Array([0,0,0]),
	new Float32Array([0,0,0]),
	new Float32Array([1,1,1]),
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