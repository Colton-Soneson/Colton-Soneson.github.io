import {loadObjFileVerts, loadObjFileFaces, loadObjFileNormals, loadObjFileUVs, fileBlob, prefetchFiles} from '../code/objLoader.js'

// every file below, asked for all at once before any of them is waited for: they download side by side instead of one after
//		another (see objLoader.js). Each model's four loaders then share its one download
prefetchFiles([
	'./models/islandhouse2.obj', './textures/FinalIslandHouse2FlipY.png',
	'./models/lighthouse.obj', './textures/FinalLighthouseTextureFlipY.png',
	'./models/bench.obj', './textures/BenchTextureFlipY.png',
	'./models/skybox.obj', './textures/skyboxTexture.png',
	'./models/test.obj', './textures/testFlipY.png',
]);

//---------------OBJ MODEL---------------------
export const vertDim = 3; //primitives.pIslandHouse.dimensions;

//---------------VERT BUF ARRAYS----------------
export const vertStride = vertDim * 4;	//4 for number of bytes in a float
export const normStride = vertDim * 4;	//4 for number of bytes in a float
export const uvStride = 2 * 4;	//4 for number of bytes in a float
export const totalStride = vertStride + uvStride + normStride;	//4 for number of bytes in a float


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
// A model's picture, at most MODEL_TEXTURE_MOST across. The house's and the lighthouse's come at 4096: with their mip levels
//		that was 90MB each on the GPU, for buildings a few dozen units across, which never show more than a few hundred pixels of
//		it. Anything bigger is shrunk on the way in (the file itself is untouched)
const MODEL_TEXTURE_MOST = 1024;
async function loadTextureImageBitmap(path){
	const imageBitmap = await createImageBitmap(await fileBlob(path));	//(one download, shared: see objLoader.js)
	const most = Math.max(imageBitmap.width, imageBitmap.height);
	if (most <= MODEL_TEXTURE_MOST) {
		return imageBitmap;
	}
	const scale = MODEL_TEXTURE_MOST / most;
	const smaller = await createImageBitmap(imageBitmap, { resizeWidth: Math.round(imageBitmap.width * scale), resizeHeight: Math.round(imageBitmap.height * scale), resizeQuality: 'high' });
	imageBitmap.close();
	return smaller;
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

// not loaded: nothing draws it any more (the land is made in terrain.js). It was 4.3MB to download. Take the comment marks off to have it back, and put its files back in prefetchFiles above
/*
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
*/

// not loaded: nothing draws it any more (the sea is made in water.js). It was 3.8MB to download. Take the comment marks off to have it back, and put its files back in prefetchFiles above
/*
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
*/

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

// not loaded: nothing draws it (the grass is made in computeGrass.js). Take the comment marks off to have it back, and put its files back in prefetchFiles above
/*
export const pGrassBlade = new Primitive(
	3, 	//we will need to make this 2
	new Float32Array(await loadObjFileVerts('./models/basicgrass.obj')),
	new Float32Array(await loadObjFileFaces('./models/basicgrass.obj')),
	new Float32Array(await loadObjFileNormals('./models/basicgrass.obj')),
	new Float32Array(await loadObjFileUVs('./models/basicgrass.obj')),
	await loadTextureImageBitmap('./textures/default.png'),
	new Float32Array([0.0,0,0.0]),
	new Float32Array([0,0,0]),
	new Float32Array([3,3,3]),
	"grassBlade",
);
*/

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

//--------------------------2D----------------------------
export const pSquare = new Primitive(
	2, 
	new Float32Array([
		//   X,    Y,
			-1, -1, // Triangle 1 
			1, -1,
			1,  1,
			
			-1, -1, // Triangle 2 
			1,  1,
			-1,  1,
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