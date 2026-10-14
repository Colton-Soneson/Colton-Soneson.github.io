/*
	How big the picture is drawn, and how it fills the page.

	The canvas always covers the whole page (index.html), however big the window is: that is only its size on the screen.
	What it is DRAWN at is the Resolution setting: the number of pixels across the short side of the window, as screens are
	named (1080p: 1080 lines). The long side follows the shape of the window, so the picture is never stretched: 1080p in a
	16:9 window is 1920 x 1080, in a 21:9 one 2520 x 1080, and on a phone held upright 1080 across and as tall as it needs.
	The browser scales the drawn picture to fit the canvas.

	Everything drawn at the canvas's size (the depth, the copies of the frame for the screen effects and anti-aliasing, the
	clouds' half size picture...) is made again whenever this changes: see onRenderResize in deviceSelection.js.
*/

// the choices for the Resolution setting: lines across the short side of the window
export const RESOLUTIONS = { '2160p (4K)': 2160, '1440p': 1440, '1080p': 1080, '900p': 900, '720p': 720, '540p': 540, '480p': 480 };

const MOST_PIXELS_ACROSS = 8192;	// the most a texture can be across on any GPU WebGPU runs on (maxTextureDimension2D)
const SETTLE_MILLISECONDS = 150;	// while a window is being dragged bigger or smaller, wait until it stops for this long

// The size to draw at, for a canvas this big on the page (CSS pixels) and the Resolution setting. [width, height]
export function renderSizeFor(pageWidth, pageHeight, lines) {
	const width = Math.max(pageWidth, 1), height = Math.max(pageHeight, 1);
	let scale = lines / Math.min(width, height);
	scale = Math.min(scale, MOST_PIXELS_ACROSS / Math.max(width, height));
	return [Math.max(Math.round(width * scale), 1), Math.max(Math.round(height * scale), 1)];
}

/*
	DYNAMIC RESOLUTION
	Draws at less than the Resolution setting while the frame rate is under the target, and goes back up when there is room.
	The Resolution setting is the most it draws at: the scale is 1 at most, MIN_SCALE at least, in steps of SCALE_STEP.

	The frame rate is measured about once a second, from the frames the GPU finished (as the preset check does, see
	graphicsPresets.js). Under the target, the scale goes down by about what that takes: a frame's cost goes with the number
	of pixels, the square of the scale, so the scale is cut by the square root of how far short it fell. Over the target by
	a good margin, or running as fast as the loop goes (then there is no telling how much room there is), it goes back up a
	step at a time. A step up that then has to come back down is not tried again for a while (BACK_OFF, doubled every time
	it fails again), or it would go up and down for ever. The measurement after a change is not counted: everything drawn at
	the canvas's size has just been made again. Nor are the first ones after the page loads or it is turned on.

	It can only help where it is the pixels that cost (the GPU). If the time goes on the CPU, drawing smaller changes nothing,
	and it ends at MIN_SCALE.
	A target over READY_FPS counts as READY_FPS: the main loop runs every 17 milliseconds (main.js), which tops out at 58.8.
*/
export const MIN_SCALE = 0.5;
const SCALE_STEP = 0.05;
const WINDOW_MILLISECONDS = 1000;
const READY_FPS = 55;
const ROOM_ABOVE = 1.25;		// over the target by this much: room to go back up a step
const SETTLE_WINDOWS = 2;		// measurements not counted after the page loads or it is turned on
const BACK_OFF = 5000;			// milliseconds before a scale that failed is tried again. Doubles every time, up to BACK_OFF_MOST
const BACK_OFF_MOST = 60000;

export class DynamicResolution {
	constructor() {
		this.scale = 1;
		this.fps = 0;
		this.from = -1;
		this.frames = 0;
		this.skip = SETTLE_WINDOWS;
		this.blocked = { scale: 2, until: 0, backOff: BACK_OFF };	// a scale it went down from, and when it may be tried again
		this.wentUpAt = -1;		// the time of the last step up, to tell if coming down again is that step failing
	}

	// Once a frame. finished: frames the GPU has finished since the last call. Returns the scale to draw at now
	frame(now, finished, hidden, enabled, target) {
		if (!enabled) {
			this.scale = 1;
			this.from = -1;
			this.skip = SETTLE_WINDOWS;
			return this.scale;
		}
		if (hidden || this.from < 0) {
			this.from = now;		// (and again from the start once it is shown)
			this.frames = 0;
			return this.scale;
		}
		this.frames += finished;
		if (now - this.from < WINDOW_MILLISECONDS) {
			return this.scale;
		}
		this.fps = this.frames / ((now - this.from) / 1000);
		this.from = now;
		this.frames = 0;
		if (this.skip > 0) {
			this.skip--;
			return this.scale;
		}

		const goal = Math.min(target, READY_FPS);
		let scale = this.scale;
		if (this.fps < goal * 0.95) {
			scale = Math.floor(scale * Math.sqrt(Math.max(this.fps, 1) / goal) / SCALE_STEP) * SCALE_STEP;
			// a step up that did not hold: that scale waits before it is tried again, longer each time it fails
			const failedStepUp = this.wentUpAt >= 0 && now - this.wentUpAt < 4 * WINDOW_MILLISECONDS;
			const backOff = failedStepUp && Math.abs(this.blocked.scale - this.scale) < SCALE_STEP / 2 ? Math.min(this.blocked.backOff * 2, BACK_OFF_MOST) : BACK_OFF;
			this.blocked = { scale: this.scale, until: now + backOff, backOff: backOff };
			this.wentUpAt = -1;
		} else if (this.fps > goal * ROOM_ABOVE || this.fps >= READY_FPS) {
			const up = scale + SCALE_STEP;
			if (up < this.blocked.scale - SCALE_STEP / 2 || now >= this.blocked.until) {
				scale = up;
			}
		}
		scale = Math.min(Math.max(Math.round(scale / SCALE_STEP) * SCALE_STEP, MIN_SCALE), 1);
		if (scale !== this.scale) {
			if (scale > this.scale) this.wentUpAt = now;
			this.scale = scale;
			this.skip = 1;
		}
		return this.scale;
	}
}
export const dynamicResolution = new DynamicResolution();

// Once a frame: the size to change to now, or null to stay as it is. A change only goes through once the size asked for has
//		held still for a moment, so dragging the edge of the window does not make everything again on every frame
let asked = '';
let askedSince = 0;
export function settledRenderSize(canvas, lines, now) {
	const size = renderSizeFor(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, lines);
	if (size[0] === canvas.width && size[1] === canvas.height) {
		asked = '';
		return null;
	}
	const key = size.join('x');
	if (key !== asked) {
		asked = key;
		askedSince = now;
		return null;
	}
	return now - askedSince >= SETTLE_MILLISECONDS ? size : null;
}
