//IMPORTS
import * as basicShaders from "./ShadersJS/basicShaders.js";
//import fragment from "./GLSL/fragment.glsl";
//import vertex from "./GLSL/vertex.glsl";

//run main line of code
main();

function initShaderProgram(glCanv, vs, fs)
{
	const vertexShader = loadShader(glCanv, glCanv.VERTEX_SHADER, vs);
	const fragmentShader = loadShader(glCanv, glCanv.FRAGMENT_SHADER, fs);

	const shaderProg = glCanv.createProgram();
	glCanv.attachShader(shaderProg, vertexShader);
	glCanv.attachShader(shaderProg, fragmentShader);
	glCanv.linkProgram(shaderProg);

	if(!glCanv.getProgramParameter(shaderProg, glCanv.LINK_STATUS))
	{
		alert('Shader Program Fail: ' + glCanv.getProgramInfoLog(shaderProg));
		return null;
	}
	
	return shaderProg;
}

function loadShader(glCanv, type, source) 
{
  const shader = glCanv.createShader(type);
  glCanv.shaderSource(shader, source);
  glCanv.compileShader(shader);

  if (!glCanv.getShaderParameter(shader, glCanv.COMPILE_STATUS)) {
    alert('An error occurred compiling the shaders: ' + glCanv.getShaderInfoLog(shader));
    glCanv.deleteShader(shader);
    return null;
  }

  return shader;
}

function getDefaultShaderProgram(glCanv)
{
	return initShaderProgram(glCanv, basicShaders.vColorPrimary(), basicShaders.fColorPrimary(1.0,0.0,0.0,1.0));
}

function resizeToFullScreen(canv) 
{
	canv.width = window.innerWidth;
	canv.height = window.innerHeight;
}

function initSquareBuffers(glCanv)
{
	const posBuf = glCanv.createBuffer();
	glCanv.bindBuffer(glCanv.ARRAY_BUFFER, posBuf);
	const indices = [
		 1.0,  1.0,
		-1.0,  1.0,
		 1.0, -1.0,
		-1.0, -1.0,
	];
	glCanv.bufferData(glCanv.ARRAY_BUFFER, new Float32Array(indices), glCanv.STATIC_DRAW);

	return {
		position: posBuf,
	};
}

function clearScene(glCanv) {
	glCanv.clearColor(0.0,0.0,0.0,1.0);
	glCanv.clearDepth(1.0);
	//glCanv.clear(glCanv.COLOR_BUFFER_BIT | glCanv.DEPTH_BUFFER_BIT);
}

function drawScene(glCanv, progInfo, buffers)
{
	clearScene(glCanv);

	glCanv.enable(glCanv.DEPTH_TEST);
	glCanv.depthFunc(glCanv.LEQUAL);
	glCanv.clear(glCanv.COLOR_BUFFER_BIT | glCanv.DEPTH_BUFFER_BIT);


	const FOV = 45.0 * 3.14159 / 180.0;
	const aspect = glCanv.canvas.clientWidth / glCanv.canvas.clientHeight;
	const zNear = 0.1;
	const zFar = 100.0;
	const projMat = mat4.create();

	mat4.perspective(projMat, FOV, aspect, zNear, zFar);
	const MVMat = mat4.create();

	mat4.translate(MVMat,				//dest mat
					MVMat,				//mat to traslate
					[-0.0,0.0,-6.0]);	//translation amount

	{
		const numComponents = 2;  // pull out 2 values per iteration
		const type = glCanv.FLOAT;    // the data in the buffer is 32bit floats
		const normalize = false;  // don't normalize
		const stride = 0;         // how many bytes to get from one set of values to the next
								  // 0 is to use the type and numComponents
		const offset = 0;		  // how many bytes inside buffer to start from

		glCanv.bindBuffer(glCanv.ARRAY_BUFFER, buffers.position);
		glCanv.vertexAttribPointer( progInfo.attribLocations.vertexPosition,	//see basicShaders
									numComponents,
									type,
									normalize,
									stride,
									offset);
		glCanv.enableVertexAttribArray(progInfo.attribLocations.vertexPosition);
	}

	glCanv.useProgram(progInfo.program);
	
	glCanv.uniformMatrix4fv(
		progInfo.uniformLocations.projectionMatrix,
		false,
		projMat
	);

	glCanv.uniformMatrix4fv(
		progInfo.uniformLocations.MVMat,
		false,
		MVMat
	);

	{
		const offset = 0;
		const indicesCount = 4;
		glCanv.drawArrays(glCanv.TRIANGLE_STRIP, offset, indicesCount);
	}
}

function main() {
	//globals
	var prevDeltaTime = 0;
	const canvas = document.querySelector('#glcanvas');
	const gl = canvas.getContext('webgl'); // Initialize the GL context
	
	//resize if need be
	window.addEventListener('resize', resizeToFullScreen(canvas));

	// If we don't have a GL context, give up now
	// Only continue if WebGL is available and working

	if (gl == null) {
	alert('Unable to initialize WebGL. Your browser or machine may not support it.');
	return;
	}

	// Set clear color to black, fully opaque
	gl.clearColor(0.0, 0.0, 0.0, 1.0);
	// Clear the color buffer with specified clear color
	gl.clear(gl.COLOR_BUFFER_BIT);

	const shaderProg = initShaderProgram(gl, basicShaders.vColorPrimary(), basicShaders.fColorPrimary());
	const programInfo = basicShaders.setProgram(gl, shaderProg);
	const buffers = initSquareBuffers(gl);
	drawScene(gl, programInfo, buffers);

	function render(currentTime)
	{
		currentTime *= 0.001;
		const deltaTime = currentTime - prevDeltaTime;
		prevDeltaTime = currentTime;
	
		//where animation and possibly physics can happen
		

		requestAnimationFrame(render);
	}
	
	requestAnimationFrame(render);
}