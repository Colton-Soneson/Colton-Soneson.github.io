import { device } from './deviceSelection.js';
import { seasonNow } from './weather.js';
import { MEADOW_PALETTE_BINDING } from '../shaders/js/meadowShapes.js';

/*
	THE MEADOW'S COLORS, by the season (shaders/js/meadowShapes.js: meadowColor). Each season a ramp of four, from its lushest grass to
	its driest, laid along the meadow's own dry noise, so a field goes from one to the next in wide smooth sweeps: colors that are
	in a field together, not a bright green beside a dark olive. And the fall's maroon, the low shrubs gone red, in slow patches of
	their own. The season's colors give way to the next's over the last part of it.
		spring	last year's olive, and the new grass coming through, fresh and yellow-green (not yet the summer's bright green)
		summer	deep green to bright green, and to yellows where it is driest
		fall	olive, golden yellow and straw, with the maroon of the shrubs
		winter	dead grass, straw and olive, a little of the maroon left
	Written each frame into its own small uniform buffer, which the land and the grass take (MEADOW_PALETTE_BINDING)
*/
const SEASONS = [
	{ stops: [[0.34, 0.36, 0.17], [0.41, 0.46, 0.20], [0.49, 0.55, 0.25], [0.57, 0.57, 0.31]], maroon: [0.36, 0.18, 0.12, 0.0] },
	{ stops: [[0.11, 0.27, 0.07], [0.21, 0.45, 0.13], [0.39, 0.53, 0.17], [0.62, 0.59, 0.27]], maroon: [0.36, 0.18, 0.12, 0.0] },
	{ stops: [[0.30, 0.32, 0.14], [0.47, 0.43, 0.17], [0.66, 0.53, 0.21], [0.74, 0.64, 0.40]], maroon: [0.42, 0.17, 0.12, 0.55] },
	{ stops: [[0.29, 0.29, 0.17], [0.41, 0.37, 0.21], [0.55, 0.48, 0.28], [0.64, 0.58, 0.40]], maroon: [0.33, 0.16, 0.12, 0.25] },
];
const TURN = 0.7;		// of a season's way through, from where its colors start giving way to the next's

export const meadowPaletteBuffer = device.createBuffer({ label: 'meadow palette', size: 5 * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
export const meadowPaletteLayoutEntry = (visibility) => ({ binding: MEADOW_PALETTE_BINDING, visibility, buffer: {} });
export const meadowPaletteEntry = () => ({ binding: MEADOW_PALETTE_BINDING, resource: { buffer: meadowPaletteBuffer } });

const smooth = (t) => t * t * (3 - 2 * t);
export const meadowPaletteNow = { season: 1, toNext: 0 };
export function meadowPaletteUpdate() {
	const index = ((seasonNow.index ?? 1) % 4 + 4) % 4, progress = seasonNow.progress ?? 0.5;
	const t = smooth(Math.min(Math.max((progress - TURN) / (1 - TURN), 0), 1));
	const a = SEASONS[index], b = SEASONS[(index + 1) % 4];
	const mix = (x, y) => x.map((v, i) => v + (y[i] - v) * t);
	const values = new Float32Array(20);
	for (let k = 0; k < 4; k++) values.set([...mix(a.stops[k], b.stops[k]), 0], k * 4);
	values.set(mix(a.maroon, b.maroon), 16);
	device.queue.writeBuffer(meadowPaletteBuffer, 0, values);
	meadowPaletteNow.season = index; meadowPaletteNow.toNext = t;
}
meadowPaletteUpdate();
