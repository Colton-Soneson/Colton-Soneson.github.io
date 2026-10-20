import {canvas} from './deviceSelection.js'

import { settings } from './settings.js';

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as forest from './forest.js'
import * as boulders from './boulders.js'
import * as boat from './boat.js'

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

	SAILING (the Sailing game mode) is the same walker, with a vessel (boat.js, vessels.js) offshore. It starts at the helm. Where it is:
		land		as above: walking, swimming. It cannot swim through the boat's hull, and it can jump down on to its deck
		ladder		climbing the ladder on the boat's side up out of the water (E, or W, at the ladder), as long as the vessel says
		deck		standing on the boat: where it is is kept on the boat (metres, the boat's directions: boat.deckHeight is what
					its feet stand on), so it goes where the boat goes. It walks about the cockpit, up on to the side decks and
					the foredeck, and jumps over the side
		seat		at the helm (E at the seat or the wheel, E or Space again to let it go). A and D work the tiller or the wheel.
					In a dinghy it sits, leaning out to windward
	On the boat, the view turns as the boat turns, and leans a little as it heels and pitches. The halyards, sheets and braces are
	worked by looking at one (the crosshair on it says what it is) and the scroll wheel: up to haul it in or raise the sail, down
	to let it out or lower it. Each notch asks for ROPE_NOTCH of the way, and it is hauled there at the vessel's pace (boat.js).
	G drops the anchor or brings it up.
	The walker's weight is on the boat where it is, so the boat heels and trims to it.
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
const BOAT_LEAN = 0.5;				// how much of the boat's heel and pitch the view leans with
const ROPE_NOTCH = 0.08;			// of a halyard's or sheet's whole way, for a notch of the scroll wheel (100 pixels of it)

const LOOK_PITCH = Math.PI * 0.5 - 0.02;

export const crosshair = { hidden: false };	// the rifle hides the dot while its sights are up (rifle.js)
export const hunterLife = { alive: true };	// shot dead in a game with others (players.js): it cannot move until it is up again
export const hunterStats = { boxes: 0, gathers: 0, cornerReads: 0, grounded: false, swimming: false };	// for anyone who wants to show it

const hunter = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: false, swimming: false,
	on: 'land',					// land, ladder, deck or seat (see SAILING at the top)
	local: [0, 0, 0], localVy: 0,	// on the boat: where its feet are (metres on the boat) and how fast it is going up
	climb: 0, hike: 0 };			// how far up the ladder, 0 to 1. How far out to windward it is leaning, sitting (-1 to 1)
let active = false;
let lastTime = performance.now();
const keysDown = new Set();
let jumpPressed = false;
let usePressed = false, anchorPressed = false;	// E and G
let activeMode = '';							// the game mode it was started for
let boatRecalls = settings.sailingBoatRecalls;
let vesselChosen = settings.sailingVessel;
let wheelPixels = 0, scrolled = 0;				// the scroll wheel: turned since it was last read, and what this frame has of it (pixels, down +)
let lastHeading = null;						// the boat's heading last frame, to turn the view with it

// Input
//-------------------------------------------------
const hunting = () => settings.gameMode == 'Hunting' || settings.gameMode == 'Sailing';	// (Sailing is on foot too)
const sailing = () => settings.gameMode == 'Sailing';
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
	if (event.code == 'KeyE' && !event.repeat) usePressed = true;
	if (event.code == 'KeyG' && !event.repeat) anchorPressed = true;
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
// the scroll wheel, for the ropes on the boat (in the Hunting mode the rifle has it, see rifle.js)
window.addEventListener('wheel', (event) => {
	if (!sailing() || !locked()) return;
	wheelPixels += event.deltaY * (event.deltaMode == 1 ? 40 : event.deltaMode == 2 ? 800 : 1);		// (lines or pages, as pixels)
	event.preventDefault();
}, { passive: false });

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
// what the crosshair is on, on the boat: what it is, which keys work it, and how far it is set
const prompt = document.createElement('div');
prompt.style.cssText = 'position: absolute; left: 50%; top: calc(50% + 18px); transform: translateX(-50%); padding: 4px 10px; border-radius: 4px; background: rgba(0, 0, 0, 0.55); color: #e8e8e8; font-size: 12px; white-space: nowrap; text-align: center; display: none;';
let promptShown = '';
overlay.append(dot, hint, prompt);
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
	activeMode = settings.gameMode;
	hunter.on = 'land';
	lastHeading = null;
	if (sailing() && settings.enableWater) {
		// sailing: a boat offshore (the one there is, if there is one), with the walker at its helm
		if (!boat.boatExists()) boat.spawnBoatOffshore(settings.camPosX, settings.camPosZ);
		sitAtHelm();
		settings.camYaw = boat.boatFrame.heading();
		settings.camPitch = -0.08;
		gatheredAt = null;
		return;
	}
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
	leaveBoat();
}

// off the boat, and the boat gone with the mode that had it
function leaveBoat() {
	hunter.on = 'land';
	boat.setCrew(null);
	boat.setHovered(-1);
	transformations.viewUp.splice(0, 3, 0, 1, 0);
	if (!sailing()) boat.removeBoat();
}

// at the helm (a dinghy's sitting out on the windward side)
function sitAtHelm() {
	hunter.on = 'seat';
	hunter.hike = boat.helm().hike ? boat.boatFrame.windwardSide() : 0;
	hunter.local = helmSpot();
	hunter.localVy = 0;
}
// where the walker's feet are at the helm: leaning out as far as it is (up on the side deck), or where it stands to steer
function helmSpot() {
	const helm = boat.helm();
	if (!helm.hike) return [...helm.at];
	const x = hunter.hike * helm.hikeX;
	return [x, boat.deckHeight(x, helm.at[2]) ?? helm.at[1], helm.at[2]];
}

// Call once a frame, after the controls have written their values into settings and before anything reads the camera
export function updateHunter() {
	const now = performance.now();
	const seconds = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;

	const on = hunting() && settings.enableTerrain && terrain.land;
	if (on && active && settings.gameMode != activeMode) { stopHunting(); active = false; }	// (from Hunting to Sailing, or back)
	if (on && !active) startHunting();
	if (!on && active) stopHunting();
	active = !!on;
	overlay.style.display = active ? '' : 'none';
	if (!active) {
		jumpPressed = false;
		return;
	}
	scrolled = wheelPixels;
	wheelPixels = 0;
	dot.style.display = locked() && !crosshair.hidden && hunterLife.alive ? '' : 'none';
	hint.style.display = locked() ? 'none' : '';
	hint.textContent = sailing()
		? 'Click to look around · WASD walk · E take the helm or let it go · A D steer, at the helm · look at a halyard, sheet or brace and scroll to work it · G anchor · Space jump · hold Tab or Esc for the menus'
		: 'Click to look around · WASD walk · Shift run · Space jump · left click fire · right click aim · middle click and the wheel work the bolt · R load · hold Tab or Esc for the menus';

	// the boat brought back (the control in the Sailing folder): offshore again near the walker, with the walker at its helm
	//		(and a different vessel chosen: that one instead)
	if (settings.sailingBoatRecalls !== boatRecalls || settings.sailingVessel !== vesselChosen) {
		boatRecalls = settings.sailingBoatRecalls;
		vesselChosen = settings.sailingVessel;
		if (sailing() && settings.enableWater) {
			boat.spawnBoatOffshore(settings.camPosX, settings.camPosZ);
			sitAtHelm();
			settings.camYaw = boat.boatFrame.heading();
			lastHeading = null;
		}
	}
	if (hunter.on != 'land' && !boat.boatExists()) leaveBoat();
	if (boat.boatExists() && hunter.on != 'land') {
		onBoat(seconds);
		return;
	}
	lastHeading = null;
	transformations.viewUp.splice(0, 3, 0, 1, 0);
	boat.setCrew(null);

	const metre = settings.forestUnitsPerMetre;
	if (!gatheredAt || Math.hypot(hunter.x - gatheredAt[0], hunter.z - gatheredAt[1]) > GATHER_AGAIN * metre || now - gatheredWhen > GATHER_SECONDS * 1000) {
		gather(now);
	}

	// at the boat's ladder, in the water: E (or W towards it) climbs it
	const control = boatControlInView();
	if (control && control.kind == 'ladder' && hunterLife.alive && (usePressed || keysDown.has('KeyW'))) {
		hunter.on = 'ladder';
		hunter.climb = 0;
		usePressed = anchorPressed = false;
		onBoat(seconds);
		return;
	}
	usePressed = anchorPressed = false;

	// where the keys want to go, level, the way the camera faces
	const right = transformations.getCameraRight();
	const forward = [right[2], -right[0]];		// (level forward, as x and z: the right turned a quarter)
	let ahead = 0, side = 0;
	if (!hunterLife.alive) { keysDown.clear(); jumpPressed = false; }
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

		// the boat: coming down on its deck it is on board, otherwise it is pushed out of its hull
		if (boat.boatExists() && meetBoat()) {
			onBoat(left);
			return;
		}
	}
	hunterStats.grounded = hunter.grounded;
	hunterStats.swimming = hunter.swimming;

	settings.camPosX = hunter.x;
	settings.camPosY = hunter.y + EYE_HEIGHT * metre;
	settings.camPosZ = hunter.z;
}

// The boat (see SAILING at the top)
//-------------------------------------------------
// the boat's control the crosshair is on, that the walker can work from where it is: the ladder from the water, the helm from the
//		deck, the rest from on board. Swimming close by the ladder it is the ladder, wherever it looks
function boatControlInView() {
	if (!boat.boatExists() || !hunterLife.alive) return null;
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ];
	const aboard = hunter.on == 'deck' || hunter.on == 'seat';
	const usable = (c) => c.kind == 'ladder' ? hunter.on == 'land' : c.kind == 'helm' ? hunter.on == 'deck' : aboard;
	let control = boat.controlInView(eye, transformations.getCameraForward(), usable);
	if (!control && hunter.on == 'land' && hunter.swimming) {
		const at = boat.boatFrame.toLocal([hunter.x, hunter.y, hunter.z]);
		const L = boat.ladder();
		if (Math.hypot(at[0] - L.x, at[2] - L.z) < 1.2 && at[1] < L.top + 0.5) control = { id: -1, kind: 'ladder', name: 'Ladder', keys: 'E climb aboard' };
	}
	return control;
}

// on land or in the water, the walker against the boat: down on its deck (true: it is on board now), or out of its hull
function meetBoat() {
	const metre = settings.forestUnitsPerMetre;
	const local = boat.boatFrame.toLocal([hunter.x, hunter.y, hunter.z]);
	const half = boat.halfBreadth(local[2]);
	if (half <= 0) return false;
	const deck = boat.deckHeight(local[0], local[2]);
	if (deck !== null && hunter.vy <= 0 && local[1] <= deck + 0.05 && local[1] >= deck - 0.6 && Math.abs(local[0]) < half - 0.15) {
		hunter.on = 'deck';
		hunter.local = [local[0], deck, local[2]];
		hunter.localVy = 0;
		return true;
	}
	const out = half + BODY_WIDTH * 0.5;
	if (Math.abs(local[0]) < out && local[1] < boat.sheerHeight(local[2]) + 0.1 && local[1] > -2.0) {
		local[0] = local[0] >= 0 ? out : -out;
		const world = boat.boatFrame.toWorld(local);
		hunter.x = world[0];
		hunter.z = world[2];
	}
	return false;
}

// the walker on the boat: climbing its ladder, standing on it or sitting at its helm. The view goes with the boat
function onBoat(seconds) {
	const metre = settings.forestUnitsPerMetre;
	const frame = boat.boatFrame;

	// the view turns as the boat turns, and leans with it a little
	const heading = frame.heading();
	if (lastHeading !== null) {
		let turn = heading - lastHeading;
		turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2));
		settings.camYaw += turn;
	}
	lastHeading = heading;
	const up = frame.up();
	const lean = [up[0] * BOAT_LEAN, 1 - BOAT_LEAN + up[1] * BOAT_LEAN, up[2] * BOAT_LEAN];
	const leanLength = Math.hypot(...lean);
	transformations.viewUp.splice(0, 3, lean[0] / leanLength, lean[1] / leanLength, lean[2] / leanLength);

	// what the crosshair is on, and the keys that work it
	const control = boatControlInView();
	boat.setHovered(control ? control.id : -1);
	showPrompt(control);
	const rope = control && (control.kind == 'halyard' || control.kind == 'sheet') ? control : null;
	if (!hunterLife.alive) { keysDown.clear(); jumpPressed = usePressed = anchorPressed = false; }
	if (rope && scrolled) boat.nudgeControl(rope, -scrolled / 100 * ROPE_NOTCH);	// (up the wheel, in or up)
	scrolled = 0;
	if (anchorPressed && hunter.on != 'ladder') boat.toggleAnchor();
	anchorPressed = false;

	const L = boat.ladder();
	if (hunter.on == 'ladder') {
		// up out of the water, over the side and down on to the deck
		hunter.climb = Math.min(hunter.climb + seconds / L.seconds, 1);
		const t = hunter.climb;
		const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
		hunter.local = t < 0.7 ? mix(L.foot, L.over, t / 0.7) : mix(L.over, L.inside, (t - 0.7) / 0.3);
		if (t >= 0.7) hunter.local[1] += 0.25 * Math.sin(Math.PI * (t - 0.7) / 0.3);
		if (t >= 1) hunter.on = 'deck';
		usePressed = jumpPressed = false;
	} else if (hunter.on == 'seat') {
		// the tiller or the wheel, and (in a dinghy) out to windward
		let tiller = 0;
		if (keysDown.has('KeyA')) tiller += 1;
		if (keysDown.has('KeyD')) tiller -= 1;
		if (tiller) boat.steer(tiller, seconds);
		const helm = boat.helm();
		if (helm.hike) hunter.hike += Math.max(Math.min(frame.windwardSide() - hunter.hike, seconds * 1.5), -seconds * 1.5);
		hunter.local = helmSpot();
		if (usePressed || jumpPressed) {
			hunter.on = 'deck';
			hunter.local = [helm.standAt[0], boat.deckHeight(helm.standAt[0], helm.standAt[2]) ?? helm.standAt[1], helm.standAt[2]];
			hunter.localVy = 0;
		}
		usePressed = jumpPressed = false;
	} else {
		if (usePressed && control && control.kind == 'helm') {
			sitAtHelm();
		} else if (walkOnDeck(seconds)) {
			usePressed = false;
			return;	// (over the side)
		}
		usePressed = false;
	}

	// the walker's weight on the boat (its middle), and where it is in the world
	const helm = boat.helm();
	const sitting = hunter.on == 'seat' && helm.seated;
	boat.setCrew(sitting && helm.hike ? [hunter.hike * helm.hikeOut, boat.sheerHeight(hunter.local[2]) + 0.3, hunter.local[2]] : [hunter.local[0], hunter.local[1] + (sitting ? 0.35 : 0.9), hunter.local[2]]);
	const feet = frame.toWorld(hunter.local);
	const going = frame.velocityAt(hunter.local);
	hunter.x = feet[0]; hunter.y = feet[1]; hunter.z = feet[2];
	hunter.vx = going[0]; hunter.vy = going[1]; hunter.vz = going[2];
	hunter.grounded = hunter.on != 'ladder';
	hunter.swimming = false;
	hunterStats.grounded = hunter.grounded;
	hunterStats.swimming = false;
	const eye = frame.toWorld([hunter.local[0], hunter.local[1] + (hunter.on == 'seat' ? helm.eye : EYE_HEIGHT), hunter.local[2]]);
	settings.camPosX = eye[0];
	settings.camPosY = eye[1];
	settings.camPosZ = eye[2];
}

// standing on the boat: walking about on its deck, in the boat's own directions. true if it went over the side
function walkOnDeck(seconds) {
	const metre = settings.forestUnitsPerMetre;
	const frame = boat.boatFrame;
	// where the keys want to go, turned into the boat's directions
	const right = transformations.getCameraRight();
	const forward = [right[2], 0, -right[0]];
	let ahead = 0, side = 0;
	if (keysDown.has('KeyW')) ahead += 1;
	if (keysDown.has('KeyS')) ahead -= 1;
	if (keysDown.has('KeyD')) side += 1;
	if (keysDown.has('KeyA')) side -= 1;
	const length = Math.hypot(ahead, side) || 1;
	const pace = settings.huntingWalkSpeed;
	const want = frame.directionToLocal([(forward[0] * ahead + right[0] * side) / length * pace, 0, (forward[2] * ahead + right[2] * side) / length * pace]);
	if (jumpPressed && hunter.localVy == 0) hunter.localVy = Math.sqrt(2 * GRAVITY * settings.huntingJumpHeight);
	jumpPressed = false;

	const local = hunter.local;
	let left = seconds;
	while (left > 0) {
		const dt = Math.min(left, MAX_STEP_SECONDS);
		left -= dt;
		const floor = boat.deckHeight(local[0], local[2]);
		const airborne = floor === null || local[1] > floor + 0.01 || hunter.localVy > 0;
		const nx = local[0] + want[0] * dt, nz = local[2] + want[2] * dt;
		const next = boat.deckHeight(nx, nz);
		if (airborne && (next === null || Math.abs(nx) > boat.halfBreadth(nz))) {
			// over the side: off the boat, going as it was
			local[0] = nx; local[2] = nz;
			const world = frame.toWorld(local), going = frame.velocityAt(local), mine = frame.directionToWorld([want[0], hunter.localVy, want[2]]);
			hunter.x = world[0]; hunter.y = world[1]; hunter.z = world[2];
			hunter.vx = going[0] + mine[0] * metre; hunter.vy = going[1] + mine[1] * metre; hunter.vz = going[2] + mine[2] * metre;
			hunter.on = 'land';
			hunter.grounded = false;
			lastHeading = null;
			boat.setCrew(null);
			boat.setHovered(-1);
			transformations.viewUp.splice(0, 3, 0, 1, 0);
			return true;
		}
		// on board it keeps inside the sheer (in the air it can go out over it), and steps up no higher than STEP. Stopped one
		//		way, it slides along the other
		const fits = (x, z) => {
			const h = boat.deckHeight(x, z);
			const room = airborne ? boat.halfBreadth(z) + 0.01 : boat.halfBreadth(z) - BODY_WIDTH * 0.5;
			return h !== null && room > 0 && Math.abs(x) <= room && (h - local[1] <= STEP || airborne);
		};
		if (fits(nx, nz)) { local[0] = nx; local[2] = nz; }
		else if (fits(nx, local[2])) local[0] = nx;
		else if (fits(local[0], nz)) local[2] = nz;
		const under = boat.deckHeight(local[0], local[2]) ?? 0;
		hunter.localVy -= GRAVITY * dt;
		local[1] += hunter.localVy * dt;
		if (local[1] <= under || (hunter.localVy <= 0 && local[1] - under < STEP && !airborne)) {
			local[1] = under;
			hunter.localVy = 0;
		}
	}
	return false;
}

// what the crosshair is on, under it
function showPrompt(control) {
	let text = '';
	if (control && locked()) {
		// how far it is now, and a mark where it is wanted (it is hauled there)
		const set = control.value !== undefined ? `<div style="position: relative; margin-top: 4px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.2);"><div style="height: 100%; width: ${(control.value * 100).toFixed(0)}%; border-radius: 2px; background: #8fc3e8;"></div>`
			+ `<div style="position: absolute; top: -3px; bottom: -3px; left: calc(${(control.want * 100).toFixed(0)}% - 1px); width: 2px; background: #f2c46d;"></div></div>` : '';
		text = `<div style="font-weight: 600;">${control.name}</div><div style="color: rgba(232, 232, 232, 0.75);">${control.keys}</div>${set}`;
	}
	if (text != promptShown) {
		promptShown = text;
		prompt.innerHTML = text;
		prompt.style.display = text ? '' : 'none';
	}
}

// where the walker is, for anyone who wants to know (the rifle, the harness): { x, y (its feet), z, vx, vz, grounded, swimming, active }
export function hunterPlace() {
	return { x: hunter.x, y: hunter.y, z: hunter.z, vx: hunter.vx, vz: hunter.vz, grounded: hunter.grounded, swimming: hunter.swimming, boxes: boxCount, active: active, on: hunter.on, local: [...hunter.local] };
}

// for testing: the keys held, as if pressed (KeyW, ShiftLeft...), and a jump, E and G, and the scroll wheel turned (pixels, down +)
export function pressKeys(codes, jump = false, use = false, anchor = false, scroll = 0) {
	wheelPixels += scroll;
	keysDown.clear();
	for (const code of codes) keysDown.add(code);
	if (jump) jumpPressed = true;
	if (use) usePressed = true;
	if (anchor) anchorPressed = true;
}

// for testing: the walker put down on the ground at (x, z), standing still
export function placeHunter(x, z) {
	if (hunter.on != 'land') leaveBoat();
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
