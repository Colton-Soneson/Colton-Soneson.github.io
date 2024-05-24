import {updateGridPass} from './code/googleTutorial.js'

const UPDATE_INTERVAL = 200; // Update every 200ms (5 times/sec)

function mainLoop() {
	
	updateGridPass();
	
}

//built in function to run a function at a set interval
setInterval(mainLoop, UPDATE_INTERVAL);