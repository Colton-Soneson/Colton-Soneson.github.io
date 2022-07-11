//imports
//import * as mShaders from './Shaders.js';
//import shaderModuleLoadStatement from './Shaders';
//import fragment from "./fragment.glsl";
//import vertex from "./vertex.glsl";

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

	if(!gl.getProgramParameter(shaderProg, glCanv.LINK_STATUS))
	{
		alert('Shader Program Fail: ' + glCanv.getProgramInfoLog(shaderProg));
		return null;
	}
	
	return shaderProg;
}

function getDefaultShaderProgram(glCanv, vs, fs)
{
	return initShaderProgram(glCanv, vs, fs);
}

function resizeToFullScreen(canv) {
	canv.width = window.innerWidth;
	canv.height = window.innerHeight;
}

function main() {
	//globals
	var prevDeltaTime = 0;
	const canvas = document.querySelector('#glcanvas');
	const gl = canvas.getContext('webgl'); // Initialize the GL context

	//console.log(shaderModuleLoadStatement);
	
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


	//function render(currentTime)
	//{
	//	currentTime *= 0.001;
	//	const deltaTime = currentTime - prevDeltaTime;
	//	prevDeltaTime = currentTime;
	//
	//	//where animation and possibly physics can happen
	//	
	//
	//	requestAnimationFrame(render);
	//}
	//
	//requestAnimationFrame(render);
}