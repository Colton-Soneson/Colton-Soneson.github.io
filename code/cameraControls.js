import {canvas} from './deviceSelection.js'

import { settings } from './settings.js';

import * as transformations from './transformations.js'

/*
	Fly camera, the controls of a 3D editor viewport:
		hold right mouse + drag		look around (the mouse is captured while its held, so the cursor cant run out of screen)
		W / S						forwards / backwards, along where the camera is looking
		A / D						left / right
		Q / E						straight down / straight up
		Shift						move 4x faster
		mouse wheel					change the fly speed
	and on a touch screen:
		one finger drag				look around
		two fingers					pull apart / pinch together to go forwards / backwards, drag both to slide left / right and up / down

	The camera's position is still settings.camPosX/Y/Z, so everything that follows the camera (water tiles, grass, the top down
	height map) and the Pos sliders keep working. What this adds is a direction: settings.camYaw and settings.camPitch,
	which transformations.getViewMatrix looks along instead of always looking at the origin.
	Turning Fly Camera off in the controls goes back to the old look-at-the-origin camera.
*/

const lookSensitivity = 0.0025;				// radians of turn per pixel of mouse movement
const maxPitch = Math.PI * 0.5 - 0.02;		// just short of straight up or down, where "up" stops meaning anything
const sprintMultiplier = 4.0;

const keysDown = new Set();		// by physical key (KeyW, ShiftLeft...), so it works whatever the keyboard layout is
let looking = false;			// right mouse button is held
let lastTime = performance.now();
let wasFlyMode = false;

// Pointer lock: while the right button is held the browser hides the cursor and keeps reporting mouse movement with no edge to stop at.
//		If the browser refuses the lock (it can), looking around still works, just only as far as the cursor can travel
function captureMouse() {
	try {
		const request = canvas.requestPointerLock();
		if (request && request.catch) {
			request.catch(() => {});
		}
	} catch (error) {
		// no pointer lock here, carry on without it
	}
}

function releaseMouse() {
	if (document.pointerLockElement == canvas) {
		document.exitPointerLock();
	}
}

// keys are for the camera unless they are being typed into one of the controls
function typingInAField() {
	const element = document.activeElement;
	return element && (element.tagName == 'INPUT' || element.tagName == 'TEXTAREA' || element.isContentEditable);
}

window.addEventListener('keydown', (event) => {
	if (!typingInAField()) {
		keysDown.add(event.code);
	}
});
window.addEventListener('keyup', (event) => keysDown.delete(event.code));

// if the window loses focus the key up never arrives, so let go of everything
window.addEventListener('blur', () => {
	keysDown.clear();
	looking = false;
	releaseMouse();
});

// (in Hunting and Sailing the mouse is hunting.js's)
const observing = () => settings.gameMode != 'Hunting' && settings.gameMode != 'Sailing';

canvas.addEventListener('mousedown', (event) => {
	if (event.button == 2 && observing()) {
		looking = true;
		if (document.activeElement) {
			document.activeElement.blur();	// take the keyboard away from whichever control had it
		}
		captureMouse();
	}
});
// on the window, not the canvas, so the drag carries on if the mouse wanders off the canvas or over the controls
window.addEventListener('mouseup', (event) => {
	if (event.button == 2 && looking) {
		looking = false;
		releaseMouse();
	}
});
window.addEventListener('mousemove', (event) => {
	if (looking && settings.cameraFlyMode && observing()) {
		settings.camYaw += event.movementX * lookSensitivity;
		settings.camPitch = Math.min(Math.max(settings.camPitch - event.movementY * lookSensitivity, -maxPitch), maxPitch);
	}
});

// right click is for looking around, not the browser's menu
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

// the wheel only notes how many notches it turned. The speed itself is changed in updateCamera, because the controls write
//		their own value over settings.cameraFlySpeed at the start of every frame and a change made out here would be lost
let wheelNotches = 0;
canvas.addEventListener('wheel', (event) => {
	if (settings.cameraFlyMode && observing()) {
		wheelNotches += (event.deltaY < 0) ? 1 : -1;
		event.preventDefault();		// dont scroll the page
	}
}, { passive: false });

// Touch. Only fingers: a mouse or a pen still goes through the mouse controls above. Turning is done here as the fingers move;
//		moving is noted (in screen pixels the fingers went) and done in updateCamera, at the fly speed
const touchLookSensitivity = 0.005;		// radians of turn per pixel a finger drags
const touchStepSeconds = 0.01;			// a pixel of pinch or two finger drag moves as far as this many seconds of a held key
const touches = new Map();				// finger -> where it was last
let touchMove = { forward: 0, right: 0, up: 0 };
let pair = null;						// the two fingers' middle and how far apart they were, last time they moved

function twoFingers() {
	const [a, b] = [...touches.values()];
	return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, apart: Math.hypot(a.x - b.x, a.y - b.y) };
}

canvas.addEventListener('pointerdown', (event) => {
	if (event.pointerType != 'touch') return;
	try {
		canvas.setPointerCapture(event.pointerId);	// so a finger that slides off the canvas is still followed
	} catch (error) {
		// carry on without it
	}
	touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
	pair = touches.size >= 2 ? twoFingers() : null;
	if (document.activeElement) {
		document.activeElement.blur();
	}
	event.preventDefault();
});

canvas.addEventListener('pointermove', (event) => {
	const last = touches.get(event.pointerId);
	if (!last || !(settings.cameraFlyMode || !observing())) return;
	const dx = event.clientX - last.x, dy = event.clientY - last.y;
	last.x = event.clientX;
	last.y = event.clientY;
	if (touches.size == 1) {
		settings.camYaw -= dx * touchLookSensitivity;		// (the world follows the finger, the way a photo does when it is dragged)
		settings.camPitch = Math.min(Math.max(settings.camPitch + dy * touchLookSensitivity, -maxPitch), maxPitch);
	} else if (pair) {
		const now = twoFingers();
		touchMove.forward += now.apart - pair.apart;
		touchMove.right -= now.x - pair.x;
		touchMove.up += now.y - pair.y;
		pair = now;
	}
	event.preventDefault();
});

function liftFinger(event) {
	if (!touches.delete(event.pointerId)) return;
	pair = touches.size >= 2 ? twoFingers() : null;
}
canvas.addEventListener('pointerup', liftFinger);
canvas.addEventListener('pointercancel', liftFinger);

// turns the camera to face the origin from wherever it is: the view the old camera always had
export function pointCameraAtOrigin() {
	const distance = Math.hypot(settings.camPosX, settings.camPosY, settings.camPosZ);
	if (distance < 1e-6) {
		return;
	}
	settings.camYaw = Math.atan2(-settings.camPosX, settings.camPosZ);
	settings.camPitch = Math.min(Math.max(Math.asin(-settings.camPosY / distance), -maxPitch), maxPitch);
}

// call once a frame, after the controls have written their values into settings and before anything reads the camera
export function updateCamera() {
	const now = performance.now();
	const seconds = Math.min((now - lastTime) / 1000, 0.1);		// time since the last frame, so the speed doesnt depend on frame rate
	lastTime = now;

	// switching the mode on starts from the view the old camera had, so nothing jumps
	if (settings.cameraFlyMode && !wasFlyMode) {
		pointCameraAtOrigin();
	}
	wasFlyMode = settings.cameraFlyMode;
	if (!settings.cameraFlyMode || !observing()) {
		wheelNotches = 0;
		touchMove = { forward: 0, right: 0, up: 0 };	// (in Hunting one finger still looks round, but two do not fly: hunting.js moves the camera)
		return;
	}

	// mouse wheel: each notch is 15% faster or slower
	if (wheelNotches != 0) {
		settings.cameraFlySpeed = Math.min(Math.max(settings.cameraFlySpeed * Math.pow(1.15, wheelNotches), 5), 5000);
		wheelNotches = 0;
	}

	const forward = transformations.getCameraForward();
	const right = transformations.getCameraRight();

	// what the fingers did since the last frame (see Touch above)
	if (touchMove.forward != 0 || touchMove.right != 0 || touchMove.up != 0) {
		const touchStep = settings.cameraFlySpeed * touchStepSeconds;
		settings.camPosX += (forward[0] * touchMove.forward + right[0] * touchMove.right) * touchStep;
		settings.camPosY += (forward[1] * touchMove.forward + touchMove.up) * touchStep;
		settings.camPosZ += (forward[2] * touchMove.forward + right[2] * touchMove.right) * touchStep;
		touchMove = { forward: 0, right: 0, up: 0 };
	}

	let moveForward = 0, moveRight = 0, moveUp = 0;
	if (keysDown.has('KeyW')) moveForward += 1;
	if (keysDown.has('KeyS')) moveForward -= 1;
	if (keysDown.has('KeyD')) moveRight += 1;
	if (keysDown.has('KeyA')) moveRight -= 1;
	if (keysDown.has('KeyE')) moveUp += 1;
	if (keysDown.has('KeyQ')) moveUp -= 1;
	if (moveForward == 0 && moveRight == 0 && moveUp == 0) {
		return;
	}

	const sprinting = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight');
	const step = settings.cameraFlySpeed * (sprinting ? sprintMultiplier : 1.0) * seconds;

	settings.camPosX += (forward[0] * moveForward + right[0] * moveRight) * step;
	settings.camPosY += (forward[1] * moveForward + moveUp) * step;
	settings.camPosZ += (forward[2] * moveForward + right[2] * moveRight) * step;
}
