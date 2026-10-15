import {canvas} from './deviceSelection.js'

import { settings } from './settings.js';

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as forest from './forest.js'
import * as boulders from './boulders.js'

/*
	HUNTING: on foot. A first person walker on the land, in place of the fly camera (Observe, cameraControls.js).
		mouse				look around (the mouse is held by the page: pointer lock. Click the picture to take it)
		W / A / S / D		walk, Shift to run
		Space				jump
		Tab (held) or Esc	let go of the mouse, to use the controls. Letting go of Tab takes it back, after Esc click the picture
	The walker is a box (BODY_WIDTH across, BODY_HEIGHT tall) with its eyes EYE_HEIGHT up, all in metres: the world is
	settings.forestUnitsPerMetre units to the metre. Earth's gravity pulls it down.

	THE GROUND. What the walker stands on is the mesh that is drawn, not the smoother data grid under it: near the camera that
	is the finest chunk mesh, a grid of squares the size of a cell (terrainWorldSize / terrainResolution), each cut into two
	triangles along the same diagonal as chunkIndices in terrainGenerator.js. So the height under the walker is the plane of the
	triangle it is over, through 3 corners whose heights are land.groundAt (the very sum the chunks are made from). The corners
	are kept (cornerHeights) as they are read, so walking only reads the ground when it steps on to a new square: 4 corners
	at the most, mostly 1 or 2.

	THE THINGS IN THE WAY. Tree trunks and boulders, each a box that does not turn (axis aligned): see forest.trunksNear and
	boulders.bouldersNear. Looking through every tree each frame would be far too slow, so the boxes within GATHER_REACH are
	gathered into a short list, and that list is gathered again only when the walker has gone GATHER_AGAIN from where it was
	last made, or every GATHER_SECONDS (trees grow and fall). Each frame the walker is only tested against that list.
	The walker moves one way at a time, x, then z, then y, and after each is pushed back out of any box it ended up in, the way
	it came. A box whose top is no higher than STEP over the walker's feet does not stop it: it steps up on to it, the way it
	would up a stair. And it can stand on a box as on the ground.

	Ground steeper than STEEPEST cannot be walked up. Water deeper than WADE_DEPTH is swum in: the walker floats with its head out.
*/
const BODY_WIDTH = 0.6;				// metres
const BODY_HEIGHT = 1.8;
const EYE_HEIGHT = 1.65;
const STEP = 0.45;					// metres a walker steps up without jumping
const GRAVITY = 9.81;				// metres a second, a second
const RUN = 1.8;					// times the walking pace, with Shift
const AIR_CONTROL = 2.0;			// how quickly it can change its course in the air (a second to fully change, at 1)
const STEEPEST = 1.2;				// rise over run: about 50 degrees
const WADE_DEPTH = 1.3;				// metres of water before it swims
const SWIM_PACE = 0.45;				// of the walking pace
const GATHER_REACH = 14;			// metres round the walker the boxes are gathered from
const GATHER_AGAIN = 4;				// metres walked before they are gathered again
const GATHER_SECONDS = 1.5;
const MAX_STEP_SECONDS = 1 / 60;	// a long frame is moved through in steps no longer than this, so nothing is walked through

const LOOK_PITCH = Math.PI * 0.5 - 0.02;

export const crosshair = { hidden: false };	// the rifle hides the dot while its sights are up (rifle.js)
export const hunterStats = { boxes: 0, gathers: 0, cornerReads: 0, grounded: false, swimming: false };	// for anyone who wants to show it

const hunter = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: false, swimming: false };
let active = false;
let lastTime = performance.now();
const keysDown = new Set();
let jumpPressed = false;

// Input
//-------------------------------------------------
const hunting = () => settings.gameMode == 'Hunting';
const locked = () => document.pointerLockElement == canvas;

function typingInAField() {
	const element = document.activeElement;
	return element && (element.tagName == 'INPUT' || element.tagName == 'TEXTAREA' || element.isContentEditable);
}

function takeMouse() {
	try {
		const request = canvas.requestPointerLock();
		if (request && request.catch) request.catch(() => {});
	} catch (error) {
		// no pointer lock here (or not just now): clicking the picture tries again
	}
}

window.addEventListener('keydown', (event) => {
	if (!hunting()) return;
	if (event.code == 'Tab') {
		event.preventDefault();		// (Tab would move the focus round the page's controls)
		if (locked()) document.exitPointerLock();
		return;
	}
	if (typingInAField()) return;
	if (event.code == 'Space') {
		event.preventDefault();		// (Space would press whichever control has the focus)
		if (!event.repeat) jumpPressed = true;
	}
	keysDown.add(event.code);
});
window.addEventListener('keyup', (event) => {
	keysDown.delete(event.code);
	if (hunting() && event.code == 'Tab') {
		event.preventDefault();
		takeMouse();
	}
});
window.addEventListener('blur', () => keysDown.clear());

canvas.addEventListener('mousedown', (event) => {
	if (hunting() && event.button == 0 && !locked()) {
		if (document.activeElement) document.activeElement.blur();
		takeMouse();
	}
});
window.addEventListener('mousemove', (event) => {
	if (hunting() && locked()) {
		const turn = 0.0025 * settings.huntingLookSensitivity;
		settings.camYaw += event.movementX * turn;
		settings.camPitch = Math.min(Math.max(settings.camPitch - event.movementY * turn, -LOOK_PITCH), LOOK_PITCH);
	}
});

// what is shown over the picture while hunting: a dot in the middle while the mouse is held, how to take it while it is not
const overlay = document.createElement('div');
overlay.style.cssText = 'position: fixed; inset: 0; pointer-events: none; display: none; z-index: 5; font-family: system-ui, sans-serif;';
const dot = document.createElement('div');
dot.style.cssText = 'position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 50%; background: rgba(255, 255, 255, 0.8); box-shadow: 0 0 2px rgba(0, 0, 0, 0.8);';
const hint = document.createElement('div');
hint.style.cssText = 'position: absolute; left: 50%; bottom: 8%; transform: translateX(-50%); padding: 6px 12px; border-radius: 4px; background: rgba(0, 0, 0, 0.55); color: #e8e8e8; font-size: 13px; white-space: nowrap;';
hint.textContent = 'Click to look around · WASD walk · Shift run · Space jump · left click fire · right click aim · middle click and the wheel work the bolt · R load · hold Tab or Esc for the menus';
overlay.append(dot, hint);
document.body.appendChild(overlay);

// The ground (see THE GROUND at the top)
//-------------------------------------------------
const cornerHeights = new Map();	// corner number -> world y
let cornersFor = null, cornersCell = 0;	// the land and the size of square the corners were read for
const MOST_CORNERS = 4096;

function groundUnder(x, z) {
	const land = terrain.land;
	const cell = settings.terrainWorldSize / settings.terrainResolution;
	const half = settings.terrainWorldSize * 0.5;
	if (cornersFor !== land || cornersCell !== cell || cornerHeights.size > MOST_CORNERS) {
		cornerHeights.clear();
		cornersFor = land;
		cornersCell = cell;
	}
	const perSide = Math.round(settings.terrainWorldSize / cell) + 1;
	const corner = (i, j) => {
		const key = j * perSide + i;
		let height = cornerHeights.get(key);
		if (height === undefined) {
			height = land.groundAt(-half + i * cell, -half + j * cell);
			cornerHeights.set(key, height);
			hunterStats.cornerReads++;
		}
		return height;
	};
	const gx = Math.min(Math.max((x + half) / cell, 0), perSide - 1.0001), gz = Math.min(Math.max((z + half) / cell, 0), perSide - 1.0001);
	const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
	// the two triangles of the square, split from (i + 1, j) to (i, j + 1)
	if (u + v <= 1) {
		const h00 = corner(i, j);
		return h00 + (corner(i + 1, j) - h00) * u + (corner(i, j + 1) - h00) * v;
	}
	const h11 = corner(i + 1, j + 1);
	return h11 + (corner(i, j + 1) - h11) * (1 - u) + (corner(i + 1, j) - h11) * (1 - v);
}

// The things in the way (see THE THINGS IN THE WAY at the top)
//-------------------------------------------------
const MOST_BOXES = 512;
const boxes = new Float32Array(MOST_BOXES * 6);		// min x, min y, min z, max x, max y, max z
let boxCount = 0;
let gatheredAt = null, gatheredWhen = 0;

function gather(now) {
	const metre = settings.forestUnitsPerMetre;
	const reach = GATHER_REACH * metre;
	boxCount = 0;
	const add = (x, z, half, bottom, top) => {
		if (boxCount >= MOST_BOXES) return;
		boxes.set([x - half, bottom, z - half, x + half, top, z + half], boxCount * 6);
		boxCount++;
	};
	if (settings.enableForest) forest.trunksNear(hunter.x, hunter.z, reach, add);
	if (settings.enableBoulders) boulders.bouldersNear(hunter.x, hunter.z, reach, add);
	gatheredAt = [hunter.x, hunter.z];
	gatheredWhen = now;
	hunterStats.boxes = boxCount;
	hunterStats.gathers++;
}

// pushes the walker back out of every box it is in along one axis (0 = x, 2 = z), the way it came. step: how high a box can be and still be stepped on to
function pushOut(axis, moved, half, step) {
	const feet = hunter.y, head = hunter.y + BODY_HEIGHT * settings.forestUnitsPerMetre;
	for (let b = 0; b < boxCount; b++) {
		const o = b * 6;
		if (boxes[o + 4] <= feet + step || boxes[o + 1] >= head) continue;	// low enough to step on, or over its head
		if (hunter.x + half <= boxes[o] || hunter.x - half >= boxes[o + 3] || hunter.z + half <= boxes[o + 2] || hunter.z - half >= boxes[o + 5]) continue;
		if (axis == 0) hunter.x = moved > 0 ? boxes[o] - half - 0.001 : boxes[o + 3] + half + 0.001;
		else hunter.z = moved > 0 ? boxes[o + 2] - half - 0.001 : boxes[o + 5] + half + 0.001;
	}
}

// the highest thing under the walker that it could be standing on: the ground, or the top of a box under it that is not above its feet by more than a step
function supportUnder(step) {
	const half = BODY_WIDTH * 0.5 * settings.forestUnitsPerMetre;
	let highest = groundUnder(hunter.x, hunter.z);
	for (let b = 0; b < boxCount; b++) {
		const o = b * 6;
		if (boxes[o + 4] > hunter.y + step || boxes[o + 4] <= highest) continue;
		if (hunter.x + half <= boxes[o] || hunter.x - half >= boxes[o + 3] || hunter.z + half <= boxes[o + 2] || hunter.z - half >= boxes[o + 5]) continue;
		highest = boxes[o + 4];
	}
	return highest;
}

// Per frame
//-------------------------------------------------
// the walker is put down on the land under the camera, or on the nearest grassland when the camera is out over the sea
function startHunting() {
	const metre = settings.forestUnitsPerMetre;
	let x = settings.camPosX, z = settings.camPosZ;
	if (terrain.land.heightAt(x, z) < settings.waterWorldPosY + 0.5 * metre) {
		const spots = terrain.land.findSpawnPoints(terrain.ZONE_GRASSLAND, 1, { near: [x, z], radius: 1500, seed: 7 });
		const spot = spots[0] ?? terrain.land.findSpawnPoints(terrain.ZONE_GRASSLAND, 1, { seed: 7 })[0];
		if (spot) { x = spot.x; z = spot.z; }
	}
	hunter.x = x; hunter.z = z;
	hunter.y = groundUnder(x, z);
	hunter.vx = hunter.vy = hunter.vz = 0;
	hunter.grounded = true;
	settings.camPitch = 0;
	gatheredAt = null;
}

function stopHunting() {
	if (locked()) document.exitPointerLock();
	keysDown.clear();
}

// Call once a frame, after the controls have written their values into settings and before anything reads the camera
export function updateHunter() {
	const now = performance.now();
	const seconds = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;

	const on = hunting() && settings.enableTerrain && terrain.land;
	if (on && !active) startHunting();
	if (!on && active) stopHunting();
	active = !!on;
	overlay.style.display = active ? '' : 'none';
	if (!active) {
		jumpPressed = false;
		return;
	}
	dot.style.display = locked() && !crosshair.hidden ? '' : 'none';
	hint.style.display = locked() ? 'none' : '';

	const metre = settings.forestUnitsPerMetre;
	if (!gatheredAt || Math.hypot(hunter.x - gatheredAt[0], hunter.z - gatheredAt[1]) > GATHER_AGAIN * metre || now - gatheredWhen > GATHER_SECONDS * 1000) {
		gather(now);
	}

	// where the keys want to go, level, the way the camera faces
	const right = transformations.getCameraRight();
	const forward = [right[2], -right[0]];		// (level forward, as x and z: the right turned a quarter)
	let ahead = 0, side = 0;
	if (keysDown.has('KeyW')) ahead += 1;
	if (keysDown.has('KeyS')) ahead -= 1;
	if (keysDown.has('KeyD')) side += 1;
	if (keysDown.has('KeyA')) side -= 1;
	const length = Math.hypot(ahead, side) || 1;
	const running = keysDown.has('ShiftLeft') || keysDown.has('ShiftRight');
	const pace = settings.huntingWalkSpeed * metre * (running ? RUN : 1) * (hunter.swimming ? SWIM_PACE : 1);
	const wantX = (forward[0] * ahead + right[0] * side) / length * pace;
	const wantZ = (forward[1] * ahead + right[2] * side) / length * pace;

	// a jump: straight up at the speed that reaches the jump height
	if (jumpPressed && (hunter.grounded || hunter.swimming)) {
		hunter.vy = Math.sqrt(2 * GRAVITY * settings.huntingJumpHeight) * metre;
		hunter.grounded = false;
	}
	jumpPressed = false;

	const half = BODY_WIDTH * 0.5 * metre, step = STEP * metre;
	const water = settings.waterWorldPosY;
	let left = seconds;
	while (left > 0) {
		const dt = Math.min(left, MAX_STEP_SECONDS);
		left -= dt;

		// on the ground it goes where it is told at once. In the air it only gets there slowly
		const give = hunter.grounded || hunter.swimming ? 1 : Math.min(dt * AIR_CONTROL, 1);
		hunter.vx += (wantX - hunter.vx) * give;
		hunter.vz += (wantZ - hunter.vz) * give;
		hunter.vy -= GRAVITY * metre * dt;

		// across, a way at a time, out of anything it walked into. On the ground, not up anything too steep
		const fromX = hunter.x, fromZ = hunter.z, fromGround = hunter.grounded ? groundUnder(fromX, fromZ) : 0;
		hunter.x += hunter.vx * dt;
		pushOut(0, hunter.vx, half, step);
		hunter.z += hunter.vz * dt;
		pushOut(2, hunter.vz, half, step);
		if (hunter.grounded && !hunter.swimming) {
			const went = Math.hypot(hunter.x - fromX, hunter.z - fromZ);
			if (went > 0 && (groundUnder(hunter.x, hunter.z) - fromGround) / went > STEEPEST) {
				hunter.x = fromX; hunter.z = fromZ;
			}
		}

		// up and down: on to whatever is under it. Walking down a slope it keeps its feet on it, instead of stepping off into the air
		hunter.y += hunter.vy * dt;
		const support = supportUnder(step);
		const keepsFeet = hunter.grounded && hunter.vy <= 0 && hunter.y - support < step;
		if (hunter.y <= support || keepsFeet) {
			hunter.y = support;
			hunter.vy = 0;
			hunter.grounded = true;
		} else {
			hunter.grounded = false;
		}

		// deep water: it floats, head and shoulders out
		const floatAt = water - WADE_DEPTH * metre;
		hunter.swimming = support < floatAt && hunter.y <= floatAt + 0.05 * metre;
		if (hunter.swimming && hunter.vy <= 0) {
			hunter.y = floatAt;
			hunter.vy = 0;
			hunter.grounded = false;
		}

		// not off the edge of the world
		const edge = settings.terrainWorldSize * 0.5 - 1;
		hunter.x = Math.min(Math.max(hunter.x, -edge), edge);
		hunter.z = Math.min(Math.max(hunter.z, -edge), edge);
	}
	hunterStats.grounded = hunter.grounded;
	hunterStats.swimming = hunter.swimming;

	settings.camPosX = hunter.x;
	settings.camPosY = hunter.y + EYE_HEIGHT * metre;
	settings.camPosZ = hunter.z;
}

// where the walker is, for anyone who wants to know (the rifle, the harness): { x, y (its feet), z, vx, vz, grounded, swimming, active }
export function hunterPlace() {
	return { x: hunter.x, y: hunter.y, z: hunter.z, vx: hunter.vx, vz: hunter.vz, grounded: hunter.grounded, swimming: hunter.swimming, boxes: boxCount, active: active };
}

// for testing: the keys held, as if pressed (KeyW, ShiftLeft...), and a jump
export function pressKeys(codes, jump = false) {
	keysDown.clear();
	for (const code of codes) keysDown.add(code);
	if (jump) jumpPressed = true;
}

// for testing: the walker put down on the ground at (x, z), standing still
export function placeHunter(x, z) {
	hunter.x = x; hunter.z = z;
	hunter.y = groundUnder(x, z);
	hunter.vx = hunter.vy = hunter.vz = 0;
	hunter.grounded = true;
	gatheredAt = null;
}

// for testing: the height of the ground the walker stands on at (x, z): the drawn mesh's (see THE GROUND at the top)
export function meshGroundAt(x, z) {
	return groundUnder(x, z);
}
