//imports
//import * as mShaders from './Shaders.js';
//import shaderModuleLoadStatement from './Shaders';

//run main line of code
main();

function resizeToFullScreen() {
	canvas = document.getElementById("glcanvas");
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;
}

function main() {
	//globals
	var prevDeltaTime = 0;
	const canvas = document.querySelector('#glcanvas');
	const gl = canvas.getContext('webgl'); // Initialize the GL context

	//console.log(shaderModuleLoadStatement);
	
	//resize if need be
	window.addEventListener('resize', resizeToFullScreen());

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