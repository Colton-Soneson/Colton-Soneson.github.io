const identityMatrix = math.matrix([[1,0,0,0],
									[0,1,0,0],
									[0,0,1,0],
									[0,0,0,1]]);


export function radToDeg(rad) {
	return rad * (180.0 / Math.PI);
}

export function degToRad(degrees) {
	return degrees * Math.PI / 180.0;
}