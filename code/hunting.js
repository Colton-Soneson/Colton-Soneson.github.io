import {canvas} from './deviceSelection.js'

import { settings } from './settings.js';

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as forest from './forest.js'
import * as boulders from './boulders.js'
import * as boat from './boat.js'
import * as horse from './horse.js'
import * as water from './water.js'
import * as help from './controlsHelp.js'
import * as town from './town.js'
import * as vm from './viewmodel.js'

/*
	HUNTING: on foot. A first person walker on the land, in place of the fly camera (Observe, cameraControls.js).
		mouse				look around (the mouse is held by the page: pointer lock. Click the picture to take it)
		W / A / S / D		walk, Shift to run
		Space				jump
		T					the spawn menu (radialMenu.js): a boat or a horse where the crosshair is, or something else in the hands
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

	FALLING: coming down on to the ground or a deck faster than FALL.safe metres a second hurts (onFall: players.js takes it off), more
	the faster, all of it at FALL.deadly (about 15 metres up). Not into the water, nor under a parachute.
	Ground steeper than STEEPEST cannot be walked up. Water deeper than WADE_DEPTH is swum in: the walker floats with its head out,
	up and down with the waves (the water's surface under the camera, water.cameraWater: the waves are only known on the GPU).

	SAILING is the same walker, with boats in the sea (boat.js, vessels.js: put there with the spawn menu). Where it is:
		land		as above: walking, swimming. It cannot swim through a boat's hull, and it can jump down on to its deck
		ladder		climbing a ladder on a boat's side up out of the water (F, or W, at the ladder: there is one each side)
		deck		standing on a boat: where it is is kept on the boat (metres, the boat's directions: boat.deckHeight is what
					its feet stand on), so it goes where the boat goes. It walks about the cockpit, up on to the side decks and
					the foredeck, and jumps over the side
		seat		at the helm (F at the seat or the wheel, F or Space again to let it go). A and D work the tiller or the wheel.
					In a dinghy it sits, leaning out to windward
	On a boat, the view turns as the boat turns, and leans a little as it heels and pitches. The halyards, sheets and braces are
	worked by looking at one (the crosshair on it says what it is) and the scroll wheel: up to haul it in or raise the sail, down
	to let it out or lower it. Each notch asks for ROPE_NOTCH of the way, and it is hauled there at the vessel's pace (boat.js).
	G drops the anchor or brings it up. (With the crosshair on a rope the wheel is the rope's, not the gun's: crosshair.onRope)
	The walker's weight is on the boat where it is, so the boat heels and trims to it.

	THE MASTS (the schooner's: shipGuns.js): F at the foot of one, on deck, climbs its ladder (on: 'mast') up into its crow's nest
	(on: 'nest': standing in it, the boat's controls there worked from it). F at the top of the ladder climbs back down. On the ladder,
	Space jumps off it (out from the mast, LADDER_LEAP) and F lets go of it: down on to the deck, as hard as it falls (FALLING).
	BOATS' SEATS (onBoatSeat: its howitzers, the nests' Lewis guns): F at one puts the walker in it (on: 'aboard', still on the boat),
	and out of it back where it was; and the rest of what is on a boat's deck (onBoatUse: its stores) is worked with E.
	SEATS (addRides: the biplane's two cockpits, plane.js): F at one, on foot, climbs into it (on: 'aboard'), and whatever has the seat
	works the keys, the view and the wheel while the walker is in it, until it says the walker got out (and where).

	LYING DOWN, behind a gun on its bipod (the Lewis gun, lewis.js: setStance): the walker does not move, its eyes come down to
	LYING_EYE, and the view turns no further than the gun's arc either side of the way it faces, nor up or down further than it
	allows. A deer's shove does not move it.

	RIDING (horse.js): F at a horse's saddle (or right beside it) puts the walker in the saddle (on: 'saddle'), F again puts it down on
	the horse's left. W, S, A, D and Shift ride it (see THE HORSE in horse.js). The view turns as the horse turns, and rides up and
	down with its gait, and the gun in the hands with it (vm.ride: horse.riderLag). The gun can be used from the saddle. F at the
	saddlebags, on foot, fills the ammunition back up (onRefill).
*/
const BODY_WIDTH = 0.6;				// metres
const BODY_HEIGHT = 1.8;
const EYE_HEIGHT = 1.65;
const STEP = 0.45;					// metres a walker steps up without jumping
const GRAVITY = 9.81;				// metres a second, a second
const RUN = 2.3;					// times the walking pace, with Shift
const AIR_CONTROL = 2.0;			// how quickly it can change its course in the air (a second to fully change, at 1)
const STEEPEST = 1.2;				// rise over run: about 50 degrees
const WADE_DEPTH = 1.3;				// metres of water before it swims
const SWIM_PACE = 0.65;				// of the walking pace
const GATHER_REACH = 14;			// metres round the walker the boxes are gathered from
const GATHER_AGAIN = 4;				// metres walked before they are gathered again
const GATHER_SECONDS = 1.5;
const MAX_STEP_SECONDS = 1 / 60;	// a long frame is moved through in steps no longer than this, so nothing is walked through
const BOAT_LEAN = 0.5;				// how much of the boat's heel and pitch the view leans with
const ROPE_NOTCH = 0.08;			// of a halyard's or sheet's whole way, for a notch of the scroll wheel (100 pixels of it)
const LADDER_REACH = 1.6;			// metres from a ladder that a swimmer can take hold of it
const PROBE_REACH = 8;				// metres: see surfaceAt
const KNOCK_FADE = 6;				// how quickly a shove dies away (a second, to e to the minus this)
const LYING_EYE = 0.38;				// metres up the eyes are, lying behind a gun on its bipod (see LYING DOWN)
const LIE_SECONDS = 0.6;			// to get down, or up
const FALL = { safe: 8.5, deadly: 17 };	// metres a second coming down: see FALLING at the top
const LADDER_LEAP = 2.2;			// metres a second out from a mast's ladder, jumping off it
const RIDE_HANDS = { bob: 0.45, rock: 0.35 };	// how much of horse.riderLag the gun in the hands goes by
const CHUTE_SINK = 6;				// metres a second: how fast it comes down under a parachute (thrown out of a plane shot to pieces, plane.js)

const LOOK_PITCH = Math.PI * 0.5 - 0.02;

export const crosshair = { hidden: false, onRope: false };	// the rifle hides the dot while its sights are up (rifle.js). onRope: the wheel is the rope's
export const hunterLife = { alive: true };	// shot dead in a game with others (players.js): it cannot move until it is up again
export const hunterStats = { boxes: 0, gathers: 0, cornerReads: 0, grounded: false, swimming: false };	// for anyone who wants to show it
// what else is taking the input: the spawn menu has the mouse while it is open (radialMenu.js), and a scope turns the view slower (lookScale)
export const input = { menuOpen: false, lookScale: 1 };

const hunter = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: false, swimming: false,
	on: 'land',					// land, ladder, deck or seat (see SAILING at the top), mast or nest (THE MASTS), saddle (RIDING), or aboard (SEATS)
	nest: 0, climbingUp: true,	// the mast it is climbing, or whose nest it is in, and which way
	ride: null,					// aboard: { rides (whose seat it is: addRides), vehicle, seat }
	boat: null,					// the boat it is on (off the land)
	horse: null,				// the horse it rides
	ladder: 0,					// which of the boat's ladders it is climbing
	local: [0, 0, 0], localVy: 0,	// on the boat: where its feet are (metres on the boat) and how fast it is going up
	chute: false,				// coming down under a parachute
	climb: 0, hike: 0,
	drift: null };				// off a mast's ladder: metres a second (on the boat) it goes on out from it until it lands			// how far up the ladder, 0 to 1. How far out to windward it is leaning, sitting (-1 to 1)
let active = false;
let lastTime = performance.now();
const keysDown = new Set();
let jumpPressed = false;
let usePressed = false, anchorPressed = false;	// E and G
let vehiclePressed = false, vehicleNow = false;		// F: pressed, and pressed this frame (taken at the start of each: updateHunter)
let burstPressed = false;						// Shift, in the saddle
let wheelPixels = 0, scrolled = 0;				// the scroll wheel: turned since it was last read, and what this frame has of it (pixels, down +)
let lastHeading = null;						// the boat's heading last frame, to turn the view with it
const knock = [0, 0];						// a shove (shoveHunter), world units a second: on top of where the keys take it, dying away

// Input
//-------------------------------------------------
const hunting = () => settings.gameMode != 'Observe';		// (Hunting and Sailing, and Horde: horde.js)
const locked = () => document.pointerLockElement == canvas;

// a box being typed in (not a checkbox, a button or a slider: those only have the focus because they were clicked)
const TYPED = new Set(['text', 'number', 'search', 'email', 'password', 'url', 'tel']);
function typingInAField() {
	const element = document.activeElement;
	return element && ((element.tagName == 'INPUT' && TYPED.has(element.type)) || element.tagName == 'TEXTAREA' || element.isContentEditable);
}
// the keyboard taken back from whichever control in the menus last had it. With the focus left on one, Space presses it (a
//		button, a checkbox), and the menus' own key handlers stop the keys before the window hears them (lil-gui does, so that
//		typing in a box does not move the camera): the walker would stop hearing W, or never hear it let go
function takeKeyboard() {
	const element = document.activeElement;
	if (element && element !== document.body) element.blur();
}

function takeMouse() {
	try {
		const request = canvas.requestPointerLock();
		if (request && request.catch) request.catch(() => {});
	} catch (error) {
		// no pointer lock here (or not just now): clicking the picture tries again
	}
}
// the mouse taken: the keyboard too, and a slider still being dragged in the menus let go of (its button came up off the page,
//		or after the mouse was taken, so lil-gui never heard it: it would go on following the mouse)
document.addEventListener('pointerlockchange', () => {
	if (!locked()) return;
	takeKeyboard();
	if (document.body.classList.contains('lil-gui-dragging')) window.dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
});

// (heard on the way down, before anything on the page can stop them: see takeKeyboard)
window.addEventListener('keydown', (event) => {
	if (!hunting()) return;
	if (event.code == 'Tab') {
		event.preventDefault();		// (Tab would move the focus round the page's controls)
		if (locked()) document.exitPointerLock();
		return;
	}
	if (locked()) takeKeyboard();
	if (typingInAField()) return;
	if (event.code == 'Space') {
		event.preventDefault();		// (Space would press whichever control has the focus)
		if (!event.repeat) jumpPressed = true;
	}
	if (event.code == 'KeyE' && !event.repeat) usePressed = true;
	if (event.code == 'KeyF' && !event.repeat) vehiclePressed = true;
	if ((event.code == 'ShiftLeft' || event.code == 'ShiftRight') && !event.repeat) burstPressed = true;
	if (event.code == 'KeyG' && !event.repeat) anchorPressed = true;
	keysDown.add(event.code);
}, true);
window.addEventListener('keyup', (event) => {
	keysDown.delete(event.code);
	if (!hunting()) return;
	if (event.code == 'Space' && !typingInAField()) event.preventDefault();		// (a button or a checkbox is pressed when Space comes up)
	if (event.code == 'Tab') {
		event.preventDefault();
		takeMouse();
	}
}, true);
window.addEventListener('blur', () => keysDown.clear());
// the scroll wheel, for the ropes on the boat (otherwise the gun in the hands has it: see rifle.js)
window.addEventListener('wheel', (event) => {
	if (!hunting() || !locked()) return;
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
	if (hunting() && locked() && !input.menuOpen) {
		const turn = 0.0025 * settings.huntingLookSensitivity * input.lookScale;
		settings.camYaw += event.movementX * turn;
		settings.camPitch = Math.min(Math.max(settings.camPitch - event.movementY * turn, -LOOK_PITCH), LOOK_PITCH);
		if (stance.hold) keepToArc();
	}
});

// what is shown over the picture while hunting: a dot in the middle while the mouse is held, how to take it while it is not
const overlay = document.createElement('div');
overlay.style.cssText = 'position: fixed; inset: 0; pointer-events: none; display: none; z-index: 5; font-family: system-ui, sans-serif;';
const dot = document.createElement('div');
dot.style.cssText = 'position: absolute; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 50%; background: rgba(255, 255, 255, 0.8); box-shadow: 0 0 2px rgba(0, 0, 0, 0.8);';
const hint = document.createElement('div');
hint.style.cssText = 'position: absolute; left: 50%; bottom: 8%; transform: translateX(-50%); padding: 6px 12px; border-radius: 4px; background: rgba(0, 0, 0, 0.55); color: #e8e8e8; font-size: 13px; white-space: nowrap;';
hint.textContent = 'Click to look around · T spawn menu · hold Tab or Esc for the menus';
// what the crosshair is on, on the boat: what it is, which keys work it, and how far it is set
const prompt = document.createElement('div');
prompt.style.cssText = 'position: absolute; left: 50%; top: calc(50% + 18px); transform: translateX(-50%); padding: 4px 10px; border-radius: 4px; background: rgba(0, 0, 0, 0.55); color: #e8e8e8; font-size: 12px; white-space: nowrap; text-align: center; display: none;';
let promptShown = '', promptPlace = 'middle';
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

// the water's surface at (x, z) world units: the waves under the camera (the walker is under it), moved along their slope to
//		(x, z), or the still sea while nothing has come back from the probe. Not from a probe further off than PROBE_REACH (the
//		camera somewhere else when it was read: the fly camera's, just after Hunting begins), which moved that far would be nonsense
function surfaceAt(x, z) {
	const w = water.cameraWater;
	if (w.height === null || !settings.enableWater || performance.now() - w.at > 500 || Math.hypot(x - w.x, z - w.z) > PROBE_REACH * settings.forestUnitsPerMetre) return settings.waterWorldPosY;
	const ny = Math.max(w.normal[1], 0.2);
	return w.height - w.normal[0] / ny * (x - w.x) - w.normal[2] / ny * (z - w.z);
}

// The things in the way (see THE THINGS IN THE WAY at the top)
//-------------------------------------------------
const MOST_BOXES = 1024;
const boxes = new Float32Array(MOST_BOXES * 6);		// min x, min y, min z, max x, max y, max z
let boxCount = 0, stillBoxes = 0;		// (the still ones first, then the moving ones, gathered again every frame)
let gatheredAt = null, gatheredWhen = 0;
const add = (x, z, half, bottom, top) => {
	if (boxCount >= MOST_BOXES) return;
	boxes.set([x - half, bottom, z - half, x + half, top, z + half], boxCount * 6);
	boxCount++;
};

function gather(now) {
	const metre = settings.forestUnitsPerMetre;
	const reach = GATHER_REACH * metre;
	boxCount = 0;
	if (settings.enableForest) forest.trunksNear(hunter.x, hunter.z, reach, add);
	if (settings.enableBoulders) boulders.bouldersNear(hunter.x, hunter.z, reach, add);
	town.boxesNear(hunter.x, hunter.z, reach, add);		// (the houses, the walls, the pier, the lamps of the towns)
	gatheredAt = [hunter.x, hunter.z];
	gatheredWhen = now;
	stillBoxes = boxCount;
	hunterStats.boxes = boxCount;
	hunterStats.gathers++;
}
// Things in the way that move (the townsfolk): each one's fn(x, z, reach, add) gives the boxes within reach, where they are now
const movers = [];
export function addMovers(near) { movers.push(near); }
function gatherMovers() {
	boxCount = stillBoxes;
	for (const near of movers) near(hunter.x, hunter.z, 6 * settings.forestUnitsPerMetre, add);
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
	hunter.on = 'land';
	hunter.boat = null;
	lastHeading = null;
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
	getOutOfSeat();
	leaveBoat();
	if (hunter.on == 'saddle') dismount();
	help.showHelp(null);
}

// Riding (see RIDING at the top)
//-------------------------------------------------
function mount(h) {
	hunter.on = 'saddle';
	hunter.horse = h;
	hunter.local = [...horse.SEAT];
	horse.setRider(h, 'me');
	lastHeading = null;
	boatHelmListeners.forEach((fn) => fn(h));		// (whoever rides it works its sums: net.js)
	help.toast('W to ride on · F to get down');
}
// down on the ground on the horse's left
function dismount() {
	const h = hunter.horse;
	hunter.on = 'land';
	hunter.horse = null;
	lastHeading = null;
	if (!h || !h.exists) return;
	horse.setRider(h, null);
	const at = h.frame.toWorld([1.1, 0, 0]);
	placeHunter(at[0], at[2]);
	hunter.vx = hunter.vz = 0;
}
function ride(seconds) {
	const h = hunter.horse;
	if (!hunterLife.alive) { dismount(); return; }
	let ahead = 0, turn = 0;
	if (keysDown.has('KeyW')) ahead += 1;
	if (keysDown.has('KeyS')) ahead -= 1;
	if (keysDown.has('KeyA')) turn += 1;
	if (keysDown.has('KeyD')) turn -= 1;
	horse.rideHorse(h, { ahead, turn, burst: burstPressed }, seconds);
	burstPressed = jumpPressed = anchorPressed = false;
	scrolled = 0;
	if (vehicleNow) { dismount(); return; }
	// the view turns with the horse, and rides with it
	const heading = h.frame.heading();
	if (lastHeading !== null) {
		let turned = heading - lastHeading;
		turned -= Math.PI * 2 * Math.round(turned / (Math.PI * 2));
		settings.camYaw += turned;
	}
	lastHeading = heading;
	const seat = h.frame.toWorld(horse.SEAT), eye = horse.riderEye(h);
	const metre = settings.forestUnitsPerMetre;
	hunter.x = seat[0]; hunter.y = seat[1]; hunter.z = seat[2];
	hunter.vx = Math.sin(h.heading) * h.speed * metre; hunter.vz = Math.cos(h.heading) * h.speed * metre; hunter.vy = 0;
	hunter.grounded = true;
	hunter.swimming = false;
	settings.camPosX = eye[0];
	settings.camPosY = eye[1];
	settings.camPosZ = eye[2];
	transformations.viewUp.splice(0, 3, 0, 1, 0);
	// the gun in the hands with the horse's stride
	const lag = horse.riderLag(h);
	vm.ride.y = lag.bob * RIDE_HANDS.bob;
	vm.ride.pitch = lag.rock * RIDE_HANDS.rock;
}
// told when the walker fills its ammunition up at a horse's saddlebags (weapons.js): fn(), which may give a word more to say (plane.js: a
//		supply pack taken). Asked first (gateRefill): fn() false if it
//		may not (it costs points in the Horde game mode, horde.js: it says why)
const refillListeners = [], refillGates = [];
export function onRefill(fn) { refillListeners.push(fn); }
export function gateRefill(fn) { refillGates.push(fn); }
// asked first when E is pressed on foot: fn(place) gives true if it took the press (discgolf.js: a disc picked up)
const useHandlers = [];
export function onUse(fn) { useHandlers.push(fn); }
// and F at something on foot, as onUse (plane.js: a biplane's wheels or floats)
const vehicleHandlers = [];
export function onVehicleUse(fn) { vehicleHandlers.push(fn); }
// told when the walker comes down hard (see FALLING at the top): fn(health it takes off)
const fallListeners = [];
export function onFall(fn) { fallListeners.push(fn); }
function landed(speed) {
	if (speed <= FALL.safe || !hunterLife.alive || hunter.chute) return;
	const harm = 100 * (speed - FALL.safe) / (FALL.deadly - FALL.safe);
	for (const fn of fallListeners) fn(harm);
}
// a boat's seats (F at its control: shipGuns.js): fn(boat, control) gives { rides (addRides's), seat } to be put in it, or null
const boatSeaters = [];
export function onBoatSeat(fn) { boatSeaters.push(fn); }
// the rest of a boat's controls (E at one: its stores): fn(boat, control) true if it was worked
const boatUsers = [];
export function onBoatUse(fn) { boatUsers.push(fn); }
// what the eye is on, said in the middle of the screen: fn() gives { name, keys } or null (plane.js: a biplane's wheels)
const promptMakers = [];
export function addPrompt(fn) { promptMakers.push(fn); }
function promptInView() {
	for (const fn of promptMakers) { const said = fn(); if (said) return said; }
	return null;
}

// Seats (see SEATS at the top)
//-------------------------------------------------
// whoever has seats: { inView(eye, look) (the seat the crosshair is on: { vehicle, seat, name, keys } or null), board(vehicle, seat) (false
//		if it may not be), ride(vehicle, seat, { keys, jump, scrolled }, seconds) (in it this frame: { feet, eye, velocity } world units, or
//		{ left: { x, z } } got out), leave(vehicle, seat) (put out of it from here), local(vehicle, seat) ({ local, sit }: where on it, for
//		the others), help(vehicle, seat) ([title, lines]) }
const rides = [];
export function addRides(r) { rides.push(r); }
function seatInView() {
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ], look = transformations.getCameraForward();
	for (const r of rides) { const s = r.inView(eye, look); if (s) return { ...s, rides: r }; }
	return null;
}
// in a seat this frame: false if the walker is out of it (on the land, where it got out)
function aboard(seconds) {
	const R = hunter.ride;
	if (!hunterLife.alive) { getOutOfSeat(); return false; }
	const result = R.rides.ride(R.vehicle, R.seat, { keys: keysDown, jump: jumpPressed, use: vehicleNow, scrolled }, seconds);
	jumpPressed = usePressed = anchorPressed = burstPressed = false;
	scrolled = 0;
	crosshair.onRope = false;
	if (result.left) {
		vehicleNow = false;		// (the press that got it out is spent: not the press to climb straight back in, the seat still in view)
		hunter.on = 'land';
		hunter.ride = null;
		lastHeading = null;
		transformations.viewUp.splice(0, 3, 0, 1, 0);
		// (out of a boat's seat: back on its deck, or in its crow's nest)
		if (result.left.boat) {
			hunter.on = result.left.nest !== undefined ? 'nest' : 'deck';
			hunter.nest = result.left.nest ?? 0;
			hunter.boat = result.left.boat;
			hunter.local = [...result.left.local];
			hunter.localVy = 0;
			return false;
		}
		placeHunter(result.left.x, result.left.z);
		// thrown out in the air (a plane shot to pieces): falling from there, under a parachute if it opened
		if (result.left.y !== undefined) {
			hunter.y = Math.max(result.left.y, hunter.y);
			hunter.vx = result.left.vx; hunter.vy = result.left.vy; hunter.vz = result.left.vz;
			hunter.grounded = false;
			hunter.chute = result.left.chute;
		}
		return false;
	}
	// (in a seat, what the crosshair is on goes down in the corner: nothing needs climbing into)
	showPrompt(result.prompt ?? null, true);
	[hunter.x, hunter.y, hunter.z] = result.feet;
	hunter.vx = result.velocity[0]; hunter.vy = result.velocity[1]; hunter.vz = result.velocity[2];
	hunter.grounded = true;
	hunter.swimming = false;
	hunterStats.grounded = true;
	hunterStats.swimming = false;
	return true;
}
// out of the seat, put somewhere else (where the walker is)
function getOutOfSeat() {
	if (hunter.on != 'aboard') return;
	const R = hunter.ride;
	hunter.on = 'land';
	hunter.ride = null;
	R.rides.leave(R.vehicle, R.seat);
	transformations.viewUp.splice(0, 3, 0, 1, 0);
	if (hunter.boat && R.vehicle === hunter.boat) { boat.setCrew(hunter.boat, 'me', null); hunter.boat = null; }
}

// off the boat
function leaveBoat() {
	hunter.on = 'land';
	boat.setCrew(hunter.boat, 'me', null);
	boat.setHovered(null, -1);
	hunter.boat = null;
	transformations.viewUp.splice(0, 3, 0, 1, 0);
}

// at the helm (a dinghy's sitting out on the windward side)
function sitAtHelm() {
	hunter.on = 'seat';
	hunter.hike = boat.helm(hunter.boat).hike ? hunter.boat.frame.windwardSide() : 0;
	hunter.local = helmSpot();
	hunter.localVy = 0;
	boatHelmListeners.forEach((fn) => fn(hunter.boat));
}
// where the walker's feet are at the helm: leaning out as far as it is (up on the side deck), or where it stands to steer
function helmSpot() {
	const helm = boat.helm(hunter.boat);
	if (!helm.hike) return [...helm.at];
	const x = hunter.hike * helm.hikeX;
	return [x, boat.deckHeight(hunter.boat, x, helm.at[2]) ?? helm.at[1], helm.at[2]];
}
// told when this player takes a boat's helm: fn(boat) (net.js: whoever is at the helm sails it)
const boatHelmListeners = [];
export function onTakeHelm(fn) { boatHelmListeners.push(fn); }

// Call once a frame, after the controls have written their values into settings and before anything reads the camera
export function updateHunter() {
	const now = performance.now();
	const seconds = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	vehicleNow = vehiclePressed;
	vehiclePressed = false;
	if (hunter.on != 'aboard') transformations.setSeatedNear(null);		// (a seat's close near plane only while in it: see plane.js)
	vm.ride.y = vm.ride.pitch = 0;

	const on = hunting() && settings.enableTerrain && terrain.land;
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
	dot.style.display = locked() && !crosshair.hidden && hunterLife.alive && !input.menuOpen ? '' : 'none';
	hint.style.display = locked() ? 'none' : '';

	if (hunter.on == 'aboard') {
		if (aboard(seconds)) {
			showControls();
			return;
		}
	}
	if (hunter.on == 'saddle') {
		if (hunter.horse && hunter.horse.exists) {
			showPrompt(null);
			ride(seconds);
			showControls();
			return;
		}
		dismount();
	}
	if (hunter.on != 'land' && !(hunter.boat && hunter.boat.exists)) leaveBoat();
	if (hunter.on != 'land') {
		onBoat(seconds);
		showControls();
		return;
	}
	lastHeading = null;
	transformations.viewUp.splice(0, 3, 0, 1, 0);

	const metre = settings.forestUnitsPerMetre;
	if (!gatheredAt || Math.hypot(hunter.x - gatheredAt[0], hunter.z - gatheredAt[1]) > GATHER_AGAIN * metre || now - gatheredWhen > GATHER_SECONDS * 1000) {
		gather(now);
	}
	gatherMovers();

	// at a boat's ladder, in the water: F (or W towards it) climbs it
	const control = boatControlInView();
	boat.setHovered(control?.boat ?? null, control ? control.id : -1);
	// a horse: E at its saddlebags for ammunition (F at its saddle to get on: below)
	const tack = !control && hunterLife.alive ? horse.controlInView([settings.camPosX, settings.camPosY, settings.camPosZ], transformations.getCameraForward()) : null;
	horse.setHovered(tack?.horse ?? null, tack?.kind ?? '');
	// a seat (the biplane's cockpits): F at it to climb in
	const seat = !control && !tack && hunterLife.alive ? seatInView() : null;
	// (and whatever else has something to say about what the eye is on: addPrompt)
	const other = !control && !tack && !seat && hunterLife.alive ? promptInView() : null;
	showPrompt(control ?? tack ?? seat ?? other);
	if (vehicleNow && seat && !hunter.swimming && seat.rides.board(seat.vehicle, seat.seat)) {
		hunter.on = 'aboard';
		hunter.ride = { rides: seat.rides, vehicle: seat.vehicle, seat: seat.seat };
		vehicleNow = false;		// (the press that got it in is spent: it is not the press to get out as well)
		if (aboard(0)) { showControls(); return; }
	}
	crosshair.onRope = false;
	if (usePressed && !control && hunterLife.alive && useHandlers.some((fn) => fn(hunterPlace()))) usePressed = false;
	if (vehicleNow && !control && hunterLife.alive && !hunter.swimming && vehicleHandlers.some((fn) => fn(hunterPlace()))) vehicleNow = false;
	if (vehicleNow && !control && hunterLife.alive && !hunter.swimming && tack && tack.kind == 'bags') {
		vehicleNow = false;		// (F at the saddlebags fills up: it does not put the walker in the saddle as well)
		if (refillGates.every((fn) => fn())) {
			const more = refillListeners.map((fn) => fn()).filter(Boolean);
			help.toast(['Ammunition filled up', ...more].join(' · '), more.length ? 3 : 2.2);
		}
	}
	// a horse: F at its saddle, or right beside it, to get on
	if (vehicleNow && !control && hunterLife.alive && !hunter.swimming) {
		const h = tack && tack.kind == 'saddle' && !tack.horse.rider ? tack.horse : horse.horseBeside(hunter.x, hunter.z);
		if (h) {
			mount(h);
			vehicleNow = false;		// (as above: in the saddle, not straight back down again)
			ride(0);
			showControls();
			return;
		}
	}
	if (control && control.kind == 'ladder' && hunterLife.alive && (vehicleNow || keysDown.has('KeyW'))) {
		hunter.on = 'ladder';
		hunter.boat = control.boat;
		hunter.ladder = control.ladder;
		hunter.climb = 0;
		usePressed = anchorPressed = vehicleNow = false;
		onBoat(seconds);
		showControls();
		return;
	}
	usePressed = anchorPressed = false;
	scrolled = 0;

	// where the keys want to go, level, the way the camera faces
	const right = transformations.getCameraRight();
	const forward = [right[2], -right[0]];		// (level forward, as x and z: the right turned a quarter)
	let ahead = 0, side = 0;
	if (!hunterLife.alive) { keysDown.clear(); jumpPressed = false; }
	if (keysDown.has('KeyW')) ahead += 1;
	if (keysDown.has('KeyS')) ahead -= 1;
	if (keysDown.has('KeyD')) side += 1;
	if (keysDown.has('KeyA')) side -= 1;
	// lying behind a gun: it does not move (see LYING DOWN at the top)
	stance.lying = Math.min(Math.max(stance.lying + (stance.hold ? 1 : -1) * seconds / LIE_SECONDS, 0), 1);
	if (stance.hold || stance.lying > 0) { ahead = side = 0; jumpPressed = false; }
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
	const surface = surfaceAt(hunter.x, hunter.z);
	let left = seconds;
	while (left > 0) {
		const dt = Math.min(left, MAX_STEP_SECONDS);
		left -= dt;

		// on the ground it goes where it is told at once. In the air it only gets there slowly
		const give = hunter.grounded || hunter.swimming ? 1 : Math.min(dt * AIR_CONTROL, 1);
		hunter.vx += (wantX - hunter.vx) * give;
		hunter.vz += (wantZ - hunter.vz) * give;
		hunter.vy -= GRAVITY * metre * dt;
		if (hunter.chute) hunter.vy = Math.max(hunter.vy, -CHUTE_SINK * metre);

		// across, a way at a time, out of anything it walked into. On the ground, not up anything too steep (standing on something
		//		over the ground, a bridge, the pier, it goes where that goes)
		const fromX = hunter.x, fromZ = hunter.z, fromGround = hunter.grounded ? groundUnder(fromX, fromZ) : 0;
		const onGround = hunter.y - fromGround < step;
		hunter.x += (hunter.vx + knock[0]) * dt;
		pushOut(0, hunter.vx + knock[0], half, step);
		hunter.z += (hunter.vz + knock[1]) * dt;
		pushOut(2, hunter.vz + knock[1], half, step);
		knock[0] *= Math.exp(-dt * KNOCK_FADE); knock[1] *= Math.exp(-dt * KNOCK_FADE);
		if (hunter.grounded && !hunter.swimming && onGround) {
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
			if (!hunter.grounded) landed(-hunter.vy / metre);
			hunter.y = support;
			hunter.vy = 0;
			hunter.grounded = true;
		} else {
			hunter.grounded = false;
		}

		// deep water: it floats, head and shoulders out, on the waves
		const floatAt = surface - WADE_DEPTH * metre;
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

		// the boats: coming down on one's deck it is on board, otherwise it is pushed out of their hulls
		const boarded = meetBoats();
		if (boarded) {
			onBoat(left);
			showControls();
			return;
		}
	}
	hunterStats.grounded = hunter.grounded;
	hunterStats.swimming = hunter.swimming;
	// the parachute: let go of on the ground or in the water, and gone with whoever was shot under it
	if (hunter.grounded || hunter.swimming || !hunterLife.alive) hunter.chute = false;

	settings.camPosX = hunter.x;
	const lying = stance.lying * stance.lying * (3 - 2 * stance.lying);
	settings.camPosY = hunter.y + (EYE_HEIGHT + (LYING_EYE - EYE_HEIGHT) * lying) * metre;
	settings.camPosZ = hunter.z;
	showControls();
}

// The boats (see SAILING at the top)
//-------------------------------------------------
// the boat control the crosshair is on, that the walker can work from where it is: a ladder from the water, the helm from the
//		deck, the rest from on board (that boat's). Swimming close by a ladder it is the ladder, wherever it looks
function boatControlInView() {
	if (boat.boats.length == 0 || !hunterLife.alive) return null;
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ];
	const aboard = (b) => (hunter.on == 'deck' || hunter.on == 'seat') && hunter.boat === b;
	const usable = (b, c) => c.kind == 'ladder' ? hunter.on == 'land' : c.kind == 'helm' ? hunter.on == 'deck' && hunter.boat === b
		: c.kind == 'nestGun' || c.kind == 'nestDown' ? hunter.on == 'nest' && hunter.boat === b && hunter.nest == c.nest
		: hunter.on == 'nest' || hunter.on == 'mast' ? false : aboard(b);
	let control = boat.controlInView(eye, transformations.getCameraForward(), usable);
	const inWater = hunter.swimming || hunter.y < surfaceAt(hunter.x, hunter.z) - 0.3 * settings.forestUnitsPerMetre;
	if (!control && hunter.on == 'land' && inWater) {
		for (const b of boat.boats) {
			const at = b.frame.toLocal([hunter.x, hunter.y, hunter.z]);
			boat.ladders(b).forEach((L, k) => {
				if (!control && Math.hypot(at[0] - L.x, at[2] - L.z) < LADDER_REACH && at[1] < L.top + 0.8 && at[1] > L.foot[1] - 2.5) control = { boat: b, id: L.control, kind: 'ladder', ladder: k, name: 'Ladder', keys: 'F climb aboard' };
			});
		}
	}
	return control;
}

// on land or in the water, the walker against the boats: down on one's deck (true: it is on board now), or out of their hulls
function meetBoats() {
	const metre = settings.forestUnitsPerMetre;
	for (const b of boat.boats) {
		if (Math.hypot(b.p[0] * metre - hunter.x, b.p[2] * metre - hunter.z) > (b.vessel.reach + 2) * metre) continue;
		const local = b.frame.toLocal([hunter.x, hunter.y, hunter.z]);
		const half = boat.halfBreadth(b, local[2]);
		if (half <= 0) continue;
		const deck = boat.deckHeight(b, local[0], local[2]);
		if (deck !== null && b.destroyed < 0 && !hunter.swimming && hunter.vy <= 0 && local[1] <= deck + 0.05 && local[1] >= deck - 0.6 && Math.abs(local[0]) < half - 0.15) {
			landed(-hunter.vy / metre);
			hunter.on = 'deck';
			hunter.drift = null;
			hunter.boat = b;
			hunter.local = [local[0], deck, local[2]];
			hunter.localVy = 0;
			return true;
		}
		const out = half + BODY_WIDTH * 0.5;
		if (Math.abs(local[0]) < out && local[1] < boat.sheerHeight(b, local[2]) + 0.1 && local[1] > -2.0) {
			local[0] = local[0] >= 0 ? out : -out;
			const world = b.frame.toWorld(local);
			hunter.x = world[0];
			hunter.z = world[2];
		}
	}
	return false;
}

// into one of a boat's seats (a gun: onBoatSeat), from its control: true if it is in it now
function seatOnBoat(B, control) {
	for (const fn of boatSeaters) {
		const seat = fn(B, control);
		if (!seat || !seat.rides.board(B, seat.seat)) continue;
		hunter.on = 'aboard';
		hunter.ride = { rides: seat.rides, vehicle: B, seat: seat.seat };
		boat.setHovered(null, -1);
		return true;
	}
	return false;
}

// on a boat when it is shot to pieces: in the water, over the side nearer it
boat.onBreak((at, b) => {
	if (hunter.boat !== b || hunter.on == 'land') return;
	const local = b.frame.toLocal([hunter.x, hunter.y, hunter.z]);
	const out = Math.max(boat.halfBreadth(b, local[2]), 0.5) + 1.2;
	const world = b.frame.toWorld([local[0] >= 0 ? out : -out, 0, local[2]]);
	placeSwimmer(world[0], world[2]);
	help.toast('Your boat is going down!', 3);
});

// the walker on a boat: climbing its ladder, standing on it or sitting at its helm. The view goes with the boat
function onBoat(seconds) {
	const metre = settings.forestUnitsPerMetre;
	const B = hunter.boat;
	const frame = B.frame;

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
	boat.setHovered(control?.boat ?? null, control ? control.id : -1);
	showPrompt(control);
	const rope = control && (control.kind == 'halyard' || control.kind == 'sheet') ? control : null;
	crosshair.onRope = !!rope;
	if (!hunterLife.alive) { keysDown.clear(); jumpPressed = usePressed = anchorPressed = false; }
	if (rope && scrolled) boat.nudgeControl(rope.boat, rope, -scrolled / 100 * ROPE_NOTCH);	// (up the wheel, in or up)
	scrolled = 0;
	if (anchorPressed && hunter.on != 'ladder') boat.toggleAnchor(B);
	anchorPressed = false;

	if (hunter.on == 'ladder') {
		// up out of the water, over the side and down on to the deck
		const L = boat.ladders(B)[hunter.ladder];
		hunter.climb = Math.min(hunter.climb + seconds / L.seconds, 1);
		const t = hunter.climb;
		const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
		hunter.local = t < 0.7 ? mix(L.foot, L.over, t / 0.7) : mix(L.over, L.inside, (t - 0.7) / 0.3);
		if (t >= 0.7) hunter.local[1] += 0.25 * Math.sin(Math.PI * (t - 0.7) / 0.3);
		if (t >= 1) hunter.on = 'deck';
		usePressed = jumpPressed = false;
	} else if (hunter.on == 'mast') {
		// up the ladder on the front of a mast to its crow's nest, or down it to the deck
		const N = B.vessel.nests[hunter.nest];
		hunter.climb = Math.min(hunter.climb + seconds / N.climb, 1);
		const t = hunter.climbingUp ? hunter.climb : 1 - hunter.climb;
		hunter.local = N.foot.map((v, i) => v + (N.stand[i] - v) * t);
		if (hunter.climb >= 1) hunter.on = hunter.climbingUp ? 'nest' : 'deck';
		// off it: Space jumps, out from the mast; F lets go. Down on to the deck from there (see THE MASTS at the top)
		else if (jumpPressed || vehicleNow) {
			hunter.on = 'deck';
			hunter.localVy = jumpPressed ? Math.sqrt(2 * GRAVITY * settings.huntingJumpHeight) * 0.5 : 0;
			hunter.drift = jumpPressed ? [0, 0, LADDER_LEAP] : null;
			vehicleNow = false;
		}
		usePressed = jumpPressed = false;
	} else if (hunter.on == 'nest') {
		// standing in a crow's nest: its gun (F), the stores' uses (E: a supply pack for its gun), or back down its ladder (E)
		hunter.local = [...B.vessel.nests[hunter.nest].stand];
		if (vehicleNow && control && seatOnBoat(B, control)) return;
		if (vehicleNow && control && control.kind == 'nestDown') { hunter.on = 'mast'; hunter.climbingUp = false; hunter.climb = 0; vehicleNow = false; }
		else if (usePressed && control) boatUsers.some((fn) => fn(B, control));
		usePressed = jumpPressed = false;
	} else if (hunter.on == 'seat') {
		// the tiller or the wheel, and (in a dinghy) out to windward
		let tiller = 0;
		if (keysDown.has('KeyA')) tiller += 1;
		if (keysDown.has('KeyD')) tiller -= 1;
		if (tiller) boat.steer(B, tiller, seconds);
		const helm = boat.helm(B);
		if (helm.hike) hunter.hike += Math.max(Math.min(frame.windwardSide() - hunter.hike, seconds * 1.5), -seconds * 1.5);
		hunter.local = helmSpot();
		if (vehicleNow || jumpPressed) {
			hunter.on = 'deck';
			hunter.local = [helm.standAt[0], boat.deckHeight(B, helm.standAt[0], helm.standAt[2]) ?? helm.standAt[1], helm.standAt[2]];
			hunter.localVy = 0;
		}
		usePressed = jumpPressed = false;
	} else {
		if (vehicleNow && control && control.kind == 'helm' && control.boat === B) {
			sitAtHelm();
		} else if (vehicleNow && control && control.boat === B && seatOnBoat(B, control)) {
			return;
		} else if (vehicleNow && control && control.boat === B && STORES.has(control.kind) && boatUsers.some((fn) => fn(B, control))) {
			vehicleNow = false;
		} else if (vehicleNow && control && control.boat === B && control.kind == 'mast') {
			hunter.on = 'mast';
			hunter.nest = control.mast;
			hunter.climbingUp = true;
			hunter.climb = 0;
			hunter.drift = null;
			vehicleNow = false;
		} else if (usePressed && control && control.boat === B && boatUsers.some((fn) => fn(B, control))) {
			usePressed = false;
		} else if (walkOnDeck(seconds)) {
			usePressed = false;
			return;	// (over the side)
		}
		usePressed = false;
	}

	// the walker's weight on the boat (its middle), and where it is in the world
	const helm = boat.helm(B);
	const sitting = hunter.on == 'seat' && helm.seated;
	boat.setCrew(B, 'me', sitting && helm.hike ? [hunter.hike * helm.hikeOut, boat.sheerHeight(B, hunter.local[2]) + 0.3, hunter.local[2]] : [hunter.local[0], hunter.local[1] + (sitting ? 0.35 : 0.9), hunter.local[2]]);
	const feet = frame.toWorld(hunter.local);
	const going = frame.velocityAt(hunter.local);
	hunter.x = feet[0]; hunter.y = feet[1]; hunter.z = feet[2];
	hunter.vx = going[0]; hunter.vy = going[1]; hunter.vz = going[2];
	hunter.grounded = hunter.on != 'ladder' && hunter.on != 'mast';
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
	const B = hunter.boat;
	const frame = B.frame;
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
	if (hunter.drift) { want[0] += hunter.drift[0]; want[2] += hunter.drift[2]; }
	if (jumpPressed && hunter.localVy == 0) hunter.localVy = Math.sqrt(2 * GRAVITY * settings.huntingJumpHeight);
	jumpPressed = false;

	const local = hunter.local;
	let left = seconds;
	while (left > 0) {
		const dt = Math.min(left, MAX_STEP_SECONDS);
		left -= dt;
		const floor = boat.deckHeight(B, local[0], local[2]);
		const airborne = floor === null || local[1] > floor + 0.01 || hunter.localVy > 0;
		const nx = local[0] + want[0] * dt, nz = local[2] + want[2] * dt;
		const next = boat.deckHeight(B, nx, nz);
		if (airborne && (next === null || Math.abs(nx) > boat.halfBreadth(B, nz))) {
			// over the side: off the boat, going as it was
			local[0] = nx; local[2] = nz;
			const world = frame.toWorld(local), going = frame.velocityAt(local), mine = frame.directionToWorld([want[0], hunter.localVy, want[2]]);
			hunter.x = world[0]; hunter.y = world[1]; hunter.z = world[2];
			hunter.vx = going[0] + mine[0] * metre; hunter.vy = going[1] + mine[1] * metre; hunter.vz = going[2] + mine[2] * metre;
			hunter.grounded = false;
			hunter.drift = null;
			lastHeading = null;
			leaveBoat();
			return true;
		}
		// on board it keeps inside the sheer (in the air it can go out over it), and steps up no higher than STEP. Stopped one
		//		way, it slides along the other
		const fits = (x, z) => {
			const h = boat.deckHeight(B, x, z);
			const room = airborne ? boat.halfBreadth(B, z) + 0.01 : boat.halfBreadth(B, z) - BODY_WIDTH * 0.5;
			return h !== null && room > 0 && Math.abs(x) <= room && (h - local[1] <= STEP || airborne);
		};
		if (fits(nx, nz)) { local[0] = nx; local[2] = nz; }
		else if (fits(nx, local[2])) local[0] = nx;
		else if (fits(local[0], nz)) local[2] = nz;
		const under = boat.deckHeight(B, local[0], local[2]) ?? 0;
		hunter.localVy -= GRAVITY * dt;
		local[1] += hunter.localVy * dt;
		if (local[1] <= under || (hunter.localVy <= 0 && local[1] - under < STEP && !airborne)) {
			if (airborne) { landed(-hunter.localVy); hunter.drift = null; }
			local[1] = under;
			hunter.localVy = 0;
		}
	}
	return false;
}

// what the crosshair is on, under it (or in the bottom left corner, in a seat: corner)
function showPrompt(control, corner = false) {
	let text = '';
	const place = corner ? 'corner' : 'middle';
	if (place != promptPlace) {
		promptPlace = place;
		Object.assign(prompt.style, corner ? { left: '16px', top: 'auto', bottom: '96px', transform: 'none', textAlign: 'left' } : { left: '50%', top: 'calc(50% + 18px)', bottom: 'auto', transform: 'translateX(-50%)', textAlign: 'center' });
	}
	if (control && locked() && !input.menuOpen) {
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

// the controls for where the walker is, on the side (controlsHelp.js). The gun in its hands adds its own (help.setWeaponHelp)
function showControls() {
	if (!hunterLife.alive) { help.showHelp(null); return; }
	if (hunter.on == 'aboard') {
		const [title, lines] = hunter.ride.rides.help(hunter.ride.vehicle, hunter.ride.seat);
		help.showHelp(title, lines, false);
		return;
	}
	if (hunter.on == 'saddle') {
		const b = horse.burstState(hunter.horse);
		help.showHelp('On horseback', [
			['W', 'ride on (gathers pace to a canter)'],
			['S', 'slow down, back up'],
			['A / D', 'turn (wider the faster it goes)'],
			['Shift', b.burst > 0 ? 'galloping…' : b.ready ? 'a burst of gallop' : `a burst of gallop (ready in ${Math.ceil(b.rest)} s)`],
			['F', 'get down'],
			['T', 'spawn menu'],
		]);
	} else if (hunter.on == 'seat') {
		const B = hunter.boat, wheel = boat.helm(B).tiller == 'wheel';
		help.showHelp(`${B.vessel.name}: at the ${wheel ? 'wheel' : 'tiller'}`, [
			['A / D', `turn the ${wheel ? 'wheel' : 'tiller'} (it stays where it is put)`],
			['F or Space', 'let go of the helm'],
			['G', 'drop or raise the anchor'],
			['Mouse', 'look around'],
			['T', 'spawn menu'],
		], false);
	} else if (hunter.on == 'deck') {
		help.showHelp(`On the ${hunter.boat.vessel.name}`, [
			['W A S D', 'walk about the deck'],
			['Look + wheel', 'at a halyard: raise or lower its sail · at a sheet or brace: haul it in or ease it out'],
			['F', `at the ${boat.helm(hunter.boat).tiller == 'wheel' ? 'wheel' : 'helm seat'}: take the helm`],
			['G', 'drop or raise the anchor'],
			['F', 'at a howitzer: man it'],
			['F', 'at the rounds, the supply packs or the wood: take one · at a mast: climb to its crow\'s nest'],
			['R (held)', 'with wood, at a mast: mend her'],
			['Space', 'jump (over the side to swim)'],
		]);
	} else if (hunter.on == 'ladder') {
		help.showHelp('Climbing aboard', [['', 'up the ladder and over the side']], false);
	} else if (hunter.on == 'mast') {
		help.showHelp('Climbing', [['', hunter.climbingUp ? 'up to the crow\'s nest' : 'down to the deck'], ['Space', 'jump off'], ['F', 'let go']], false);
	} else if (hunter.on == 'nest') {
		help.showHelp('In the crow\'s nest', [
			['F', 'at the Lewis gun: man it · at the ladder: climb down'],
			['E', 'at the gun with a supply pack: fill its pans'],
			['Mouse', 'look around'],
		]);
	} else if (hunter.swimming) {
		help.showHelp('Swimming', [
			['W A S D', 'swim'],
			['F or W', 'at a boat\'s ladder: climb aboard'],
			['Space', 'kick up'],
			['T', 'spawn menu'],
		], false);
	} else {
		help.showHelp('On foot', [
			['W A S D', 'walk · Shift run'],
			['Space', 'jump'],
			['T', 'spawn menu: vehicles and weapons'],
			['F', 'at a horse: get on · at its saddlebags: fill up your ammunition · at a biplane\'s cockpit: climb in · at its wheels: floats or wheels'],
			['E', 'by your disc: pick it up'],
			['Tab / Esc', 'let go of the mouse'],
		]);
	}
}

// where the walker is, for anyone who wants to know (the rifle, the harness, net.js): { x, y (its feet), z, vx, vz, grounded, swimming,
//		active, on (land, ladder, deck, seat), boat (the boat's id, off the land), local (where on it, metres) }
export function hunterPlace() {
	const seat = hunter.on == 'aboard' ? hunter.ride.rides.local(hunter.ride.vehicle, hunter.ride.seat) : null;
	return { x: hunter.x, y: hunter.y, z: hunter.z, vx: hunter.vx, vz: hunter.vz, grounded: hunter.grounded && hunter.on != 'saddle', swimming: hunter.swimming, boxes: boxCount, active: active, on: hunter.on,
		boat: hunter.on != 'land' && hunter.on != 'saddle' && hunter.on != 'aboard' && hunter.boat ? hunter.boat.id : null,
		vehicle: hunter.on == 'saddle' && hunter.horse ? hunter.horse.id : seat ? hunter.ride.vehicle.id : null, local: seat ? seat.local : [...hunter.local], sit: seat?.sit ?? 0, seat: seat ? hunter.ride.seat : null, chute: hunter.chute };
}
// what is taken from a boat's stores with F (shipGuns.js: a round, a supply pack, planks)
const STORES = new Set(['shells', 'packs', 'barrel']);
// the boat control the walker would work now: { kind, ladder, boat (its id), id (its place in the vessel's controls) } or null
//		(shipGuns.js: the howitzer stood at; and testing)
export function controlNow() {
	const c = boatControlInView();
	return c && { kind: c.kind, ladder: c.ladder, boat: c.boat?.id, id: c.id };
}
// for testing: into a seat of a vehicle (the first that has seats: plane.js), or out of it (vehicle null)
export function testSeat(vehicle, seat) {
	if (!vehicle) { getOutOfSeat(); return; }
	if (!rides[0].board(vehicle, seat)) return;
	hunter.on = 'aboard';
	hunter.ride = { rides: rides[0], vehicle, seat };
}
// for testing: into a seat of any rides (addRides's): of a boat's (shipGuns.js), still on it
export function testRide(r, vehicle, seat) {
	if (!r.board(vehicle, seat)) return false;
	hunter.on = 'aboard';
	hunter.ride = { rides: r, vehicle, seat };
	if (vehicle.vessel) hunter.boat = vehicle;
	return true;
}
// for testing: get on a horse, or down
export function testMount(h) { if (h) { mount(h); ride(0); } else dismount(); }
// Lying down (see LYING DOWN at the top)
//-------------------------------------------------
// hold: { facing (as settings.camYaw), arc (radians either way), low, high (the pitch, radians) } to lie down behind the gun, or null to
//		get up. The view is brought inside it at once
const stance = { hold: null, lying: 0 };
export function setStance(hold) {
	stance.hold = hold;
	if (hold) keepToArc();
}
// how far down it is (0 standing to 1 lying), and whether it can lie down here: on its feet on the land, not in the water
export function stanceNow() {
	return { lying: stance.lying, down: !!stance.hold, canLie: hunter.on == 'land' && hunter.grounded && !hunter.swimming && active };
}
function keepToArc() {
	const h = stance.hold;
	let off = settings.camYaw - h.facing;
	off -= Math.PI * 2 * Math.round(off / (Math.PI * 2));
	settings.camYaw = h.facing + Math.min(Math.max(off, -h.arc), h.arc);
	settings.camPitch = Math.min(Math.max(settings.camPitch, h.low), h.high);
}

// whether the hands are busy (at the helm, on a ladder): no gun then
export function handsBusy() {
	return hunter.on == 'seat' || hunter.on == 'ladder' || hunter.on == 'mast' || hunter.on == 'aboard';
}

// for testing: the keys held, as if pressed (KeyW, ShiftLeft...), and a jump, E and G, and the scroll wheel turned (pixels, down +)
export function pressKeys(codes, jump = false, use = false, anchor = false, scroll = 0, vehicle = false) {
	if (vehicle) vehiclePressed = true;
	wheelPixels += scroll;
	keysDown.clear();
	for (const code of codes) keysDown.add(code);
	if (jump) jumpPressed = true;
	if (use) usePressed = true;
	if (anchor) anchorPressed = true;
}

// the walker shoved, on foot (a deer of the horde butting it, horde.js): vx, vz metres a second
export function shoveHunter(vx, vz) {
	if (hunter.on != 'land' || stance.hold) return;
	knock[0] += vx * settings.forestUnitsPerMetre;
	knock[1] += vz * settings.forestUnitsPerMetre;
}

// the walker put down on the ground at (x, z), standing still (for testing, and up again after being shot)
export function placeHunter(x, z) {
	getOutOfSeat();
	if (hunter.on == 'saddle') { hunter.on = 'land'; horse.setRider(hunter.horse, null); hunter.horse = null; }
	if (hunter.on != 'land') leaveBoat();
	hunter.x = x; hunter.z = z;
	hunter.y = groundUnder(x, z);
	hunter.vx = hunter.vy = hunter.vz = 0;
	hunter.grounded = true;
	hunter.chute = false;
	gatheredAt = null;
}
// the walker taken to (x, y, z) world units (the host's Bring and Go To, net.js): a step to one side of it, on the ground there, or
//		swimming if that is under the sea
export function teleportHunter(x, y, z) {
	const metre = settings.forestUnitsPerMetre;
	const side = Math.random() * Math.PI * 2;
	x += Math.cos(side) * 1.5 * metre; z += Math.sin(side) * 1.5 * metre;
	if (groundUnder(x, z) < settings.waterWorldPosY - 0.5 * metre) placeSwimmer(x, z);
	else placeHunter(x, z);
}
// for testing: the walker put in the water at (x, z), swimming
export function placeSwimmer(x, z) {
	getOutOfSeat();
	if (hunter.on == 'saddle') { hunter.on = 'land'; horse.setRider(hunter.horse, null); hunter.horse = null; }
	if (hunter.on != 'land') leaveBoat();
	hunter.x = x; hunter.z = z;
	hunter.y = settings.waterWorldPosY - WADE_DEPTH * settings.forestUnitsPerMetre;
	hunter.vx = hunter.vy = hunter.vz = 0;
	hunter.grounded = false;
	hunter.swimming = true;
	gatheredAt = null;
}

// for testing: the walker let go of in the air at (x, y, z) world units (it comes down on whatever is under it: a boat's deck)
export function dropHunter(x, y, z) {
	placeHunter(x, z);
	hunter.y = y;
	hunter.grounded = false;
}

// for testing: the walker put on a boat, at local (metres on it) on its deck, or in a crow's nest (nest: which)
export function placeOnBoat(b, local, nest = null) {
	getOutOfSeat();
	if (hunter.on == 'saddle') { hunter.on = 'land'; horse.setRider(hunter.horse, null); hunter.horse = null; }
	hunter.boat = b;
	hunter.on = nest === null ? 'deck' : 'nest';
	hunter.nest = nest ?? 0;
	hunter.local = [...local];
	hunter.localVy = 0;
	hunter.drift = null;
	lastHeading = null;
}

// for testing: the height of the ground the walker stands on at (x, z): the drawn mesh's (see THE GROUND at the top)
export function meshGroundAt(x, z) {
	return groundUnder(x, z);
}
