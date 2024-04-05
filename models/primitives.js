function Primitive(dimensions, vertices, indices) {
	this.dimensions = dimensions;
	this.vertices = vertices;
	this.indices = indices;
}

//--------------------------2D----------------------------
export const pSquare = new Primitive(
	2, 
	new Float32Array([
		//   X,    Y,
		-0.8, -0.8, // Triangle 1 (Blue)
		0.8, -0.8,
		0.8,  0.8,
		
		-0.8, -0.8, // Triangle 2 (Red)
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