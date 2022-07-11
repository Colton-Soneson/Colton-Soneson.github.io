//https://web.dev/webgl-fundamentals/#what-do-type%22x-shaderx-vertex%22-and-type%22x-shaderx-fragment%22-mean

//--------------------------------------------
export function setProgram(glCanv, shaderProg)
{
	var programInfo = {
		program: shaderProg,
		attribLocations: {
			vertexPosition: glCanv.getAttribLocation(shaderProg, 'aVertexPos'),
			//primaryColor: glCanv.getAttribLocation(shaderProg, 'aPrimaryColor'),
		},
		uniformLocations: {
			modelViewMatrix: glCanv.getUniformLocation(shaderProg, 'uMV_Matrix'),
			projectionMatrix: glCanv.getUniformLocation(shaderProg, 'uProj_Matrix'),
		},
	};

	return programInfo;
}

//--------------------------------------------
export function vColorPrimary() {
	return 'attribute vec4 aVertexPos;' +
	//'attribute vec4 aPrimaryColor;' +
	'uniform mat4 uMV_Matrix;' +
	'uniform mat4 uProj_Matrix;' +
	//'varying vec4 varyPrimaryColor;' +
	'void main()' +
	'{' +
	//'	varyPrimaryColor = vec4(0.0,1.0,0.0,1.0);' +
	'	gl_Position = uProj_Matrix * uMV_Matrix * aVertexPos;' +
	'}';
} 


//----------------------------------------------
export function fColorPrimary() {
	return 'precision mediump float;' +
	//'varying vec4 varyPrimaryColor;' +
	'void main()' +
	'{' +
	'gl_FragColor = vec4(1.0,0.0,0.0,1.0);' +
	//'gl_FragColor = varyPrimaryColor;' +
	'}';
	//'	gl_FragColor = vec4(' + r.toString() + ',' + g.toString() + ',' + b.toString() + ',' + a.toString() + ');/n' +
}


