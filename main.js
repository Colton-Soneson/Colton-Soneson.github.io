// THE MAIN MENU first (code/menu.js), with none of the game loaded: once something is chosen, the game is (its choice put where the settings
//		take it from, code/settings.js: menuStart), and the frames start. (Joining a game: once the game is loaded, the room joined, code/net.js)
import { startMenu } from './code/menu.js'
const choice = await startMenu();
globalThis.menuStart = choice;
const { updateRotatingCubePass } = await import('./code/rotatingCube.js');
if (choice.join) import('./code/net.js').then((net) => net.joinRoom(choice.join)).catch((error) => console.warn('main: joining', error));

// The loop runs on the browser's frame clock (requestAnimationFrame), not a timer: frames line up with the screen's refreshes,
//		none are asked for while the GPU is still behind on the last ones, and none while the page is hidden.
// (It was setInterval every 17 milliseconds: 58.8 a second at most, never in step with a 60Hz screen, so a frame was shown
//		twice every so often, and on a slow GPU the frames queued up behind each other)
// A screen faster than 60Hz (120, 144) would have it draw every frame it can, twice the work for little to see, so it is kept
//		to MOST_FPS. A refresh that comes a little early is still taken (SLACK), or a 90Hz screen would only get 45.
const MOST_FPS = 60;
const FRAME_MILLISECONDS = 1000 / MOST_FPS;
const SLACK = 4;
let due = 0;

function mainLoop(now) {
	requestAnimationFrame(mainLoop);
	if (now < due - SLACK) {
		return;
	}
	// (after a pause, start counting again from now, not catch up)
	due = Math.max(due + FRAME_MILLISECONDS, now);

	updateRotatingCubePass();

}

requestAnimationFrame(mainLoop);
