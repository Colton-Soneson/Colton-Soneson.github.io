import { settings } from './settings.js';
import * as terrain from './terrain.js'

/*
	The horizon round the camera: how high the land rises against the sky in every direction from it. Anything whose top is
	under that is behind a hill, and is not drawn (occlusion culling, by the land alone). forest.js and boulders.js ask about
	each of their cells, after the frustum: a mountain range or a ridge hides most of what is in front of the camera there.

	BINS directions all the way round. Along each, the height of the land is read at STEPS distances, each STEP_GROWTH times
	further than the last, and kept at each is the steepest rise from the camera seen up to there: the slope (height over
	distance) of the highest land between the camera and that distance. Something at that distance with its top under that
	slope is out of sight.

	It only ever errs on the side of drawing:
		- the land is read from the data grid (land.heights), which is a little smoother than the mesh near the camera, and the
		  mesh is coarser than the grid far away, which rounds crests off lower. So the land is taken as a little lower than
		  the grid has it: MARGIN, and MARGIN_PER_DISTANCE more for every unit away
		- between two distances read, a crest can be missed. That only makes the horizon lower than it is
		- a peak narrower than a direction's slice can hide what is behind it along that direction but not along the one next
		  to it. So a thing is only hidden when it is hidden along every direction it covers, and one more either side
		- a thing reaching nearer than the first distance read is never hidden
	It is made again when the camera has moved MOVE from where it was last made, or the land is a new one.
*/
const BINS = 128;
const FIRST = 16;				// world units, the first distance read
const STEP_GROWTH = 1.12;
const STEPS = 48;				// out to FIRST * STEP_GROWTH^47, about 3300 units. Further off only the land out to there hides anything
const MARGIN = 3;
const MARGIN_PER_DISTANCE = 0.01;
const MOVE = 10;

const BIN_ANGLE = 2 * Math.PI / BINS;
const LOG_GROWTH = Math.log(STEP_GROWTH);
const distances = new Float32Array(STEPS);
for (let k = 0; k < STEPS; k++) distances[k] = FIRST * Math.pow(STEP_GROWTH, k);
const steepest = new Float32Array(BINS * STEPS);	// [bin * STEPS + step]: the steepest slope of the land, from the camera, out to that distance
const direction = new Float32Array(BINS * 2);
for (let bin = 0; bin < BINS; bin++) {
	direction[bin * 2] = Math.cos((bin + 0.5) * BIN_ANGLE);
	direction[bin * 2 + 1] = Math.sin((bin + 0.5) * BIN_ANGLE);
}

let madeAt = null, madeFor = null;
export const horizonStats = { builds: 0, milliseconds: 0 };

// height of the data grid at a world position, bilinear (land.heightAt, without its array)
function landHeight(land, half, x, z) {
	const gx = Math.min(Math.max((x + half) / land.cellSize, 0), land.cells - 0.0001), gz = Math.min(Math.max((z + half) / land.cellSize, 0), land.cells - 0.0001);
	const col = Math.floor(gx), row = Math.floor(gz), fx = gx - col, fz = gz - row, i = row * land.points + col;
	const heights = land.heights, points = land.points;
	const top = heights[i] + (heights[i + 1] - heights[i]) * fx, bottom = heights[i + points] + (heights[i + points + 1] - heights[i + points]) * fx;
	return top + (bottom - top) * fz;
}

function make(land, camX, camY, camZ) {
	const started = performance.now();
	const half = land.cells * land.cellSize * 0.5;
	for (let bin = 0; bin < BINS; bin++) {
		const dx = direction[bin * 2], dz = direction[bin * 2 + 1];
		let most = -Infinity;
		for (let k = 0; k < STEPS; k++) {
			const d = distances[k];
			const slope = (landHeight(land, half, camX + dx * d, camZ + dz * d) - MARGIN - MARGIN_PER_DISTANCE * d - camY) / d;
			if (slope > most) most = slope;
			steepest[bin * STEPS + k] = most;
		}
	}
	madeAt = [camX, camY, camZ];
	madeFor = land;
	horizonStats.builds++;
	horizonStats.milliseconds = performance.now() - started;
}

/*
	Call before asking hidden() about a frame's things: makes the horizon again if the camera has moved far enough.
	Returns false when there is nothing to hide anything behind (no land, or turned off), and then hidden() must not be asked.
*/
export function readyHorizon() {
	const land = terrain.land;
	if (!settings.landOcclusion || !settings.enableTerrain || !land) {
		return false;
	}
	const camX = settings.camPosX, camY = settings.camPosY, camZ = settings.camPosZ;
	if (madeFor !== land || !madeAt || Math.abs(camX - madeAt[0]) > MOVE || Math.abs(camY - madeAt[1]) > MOVE || Math.abs(camZ - madeAt[2]) > MOVE) {
		make(land, camX, camY, camZ);
	}
	return true;
}

/*
	Whether a thing is behind the land from where the horizon was made: something standing round (x, z), reaching out to reach
	from there across the ground, and up to top (world y).
	(the camera has moved up to MOVE since. That is taken off how far the thing is, and added to how high it is)
*/
export function hidden(x, z, top, reach) {
	const dx = x - madeAt[0], dz = z - madeAt[2];
	const across = Math.hypot(dx, dz);
	const near = across - reach - MOVE * 1.5;
	if (near < FIRST) {
		return false;
	}
	const slope = (top + MOVE - madeAt[1]) / near;
	// the last distance read that is no further than the near side of it: what is between the camera and that
	const step = Math.min(Math.floor(Math.log(near / FIRST) / LOG_GROWTH), STEPS - 1);
	const angle = Math.atan2(dz, dx);
	const spread = Math.asin(Math.min((reach + MOVE * 1.5) / across, 1));
	const from = Math.floor((angle - spread) / BIN_ANGLE) - 1, to = Math.floor((angle + spread) / BIN_ANGLE) + 1;
	for (let b = from; b <= to; b++) {
		const bin = ((b % BINS) + BINS) % BINS;
		if (slope >= steepest[bin * STEPS + step]) {
			return false;
		}
	}
	return true;
}
