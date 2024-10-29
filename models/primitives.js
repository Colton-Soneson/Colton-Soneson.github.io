import {loadObjFileVerts, loadObjFileFaces} from '../code/objLoader.js'

function Primitive(dimensions, vertices, faces) {
	this.dimensions = dimensions;
	this.vertices = vertices;
	this.faces = faces;
}

//-------------------------OBJ----------------------------
export const pSuzanne = new Primitive(
	3, 
	new Float32Array(await loadObjFileVerts('./models/monkey.obj')),
	new Float32Array(await loadObjFileFaces('./models/monkey.obj')),
);

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