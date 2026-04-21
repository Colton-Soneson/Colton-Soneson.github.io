import {updateGridPass} from './code/googleTutorial.js'
import {updateRotatingCubePass} from './code/rotatingCube.js'

const UPDATE_INTERVAL = 17; // Update every 17ms

function mainLoop() {
	
	//updateGridPass();
	updateRotatingCubePass();
	
}

//built in function to run a function at a set interval
setInterval(mainLoop, UPDATE_INTERVAL);