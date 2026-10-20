import {device} from './deviceSelection.js'

import { settings } from './settings.js';
import { weatherNow } from './weather.js';

/*
	The wind.

	One small texture, made once, that says how the wind differs from place to place: where the gusts are, and which way the air
	is turned aside. It is laid over the whole world from above, repeating (it is made so that its edges meet, so no seam shows
	between one copy and the next, or between one chunk of land and the next), and it slides along the way the wind blows at the
	speed of the wind (times windGustSpeed: a gust front runs ahead of the air in it). So a gust is a patch of the texture going by.
	The Wind Texture debug view shows it as it lies on the ground: gusts in white, x to the right and z down, sliding with the wind.

	Everything the wind moves reads it at the place it stands, through windAt in vf_wind.js: the grass, the trees, the leaves
	in the air. Because they all read the same texture, the same gust that flattens the grass goes on to bend the trees behind it.

	What is in the texture
		r	gusts: wide patches, with ragged edges
		g	turbulence: the same thing much finer, for the flutter of small things
		ba	the swirl: which way the air is turned aside, along x and z. It is the curl of another noise, which makes it a flow
			that goes round things rather than piling up or thinning out anywhere

	The wind itself is two settings the water already had: windDirection, and waterWindSpeed (metres per second).
	The season and the weather blow harder on top of that (weatherNow.wind, see weather.js): a spring day more than a
	summer one, a storm more than either. The sea has a wind of its own, harder (waterOceanWindSpeed, see water.js), and the
	season and the weather add to it in the same way.
*/

export const WIND_TEXTURE_SIZE = 256;

// How hard a wind of some speed pushes on things, next to a steady breeze (about 1.0 at 5 m/s). It tails off:
//		a gale lays the grass flat, it does not stretch it
export function windPower(speed) {
	return 2.2 * Math.tanh(speed / 11);
}

// the speed of the wind right now, metres per second: the setting, times whatever the season and the weather add
export function windSpeedNow() {
	return settings.waterWindSpeed * weatherNow.wind;
}

// Gradient noise that repeats: the same value at x and at x + period, so a texture made of it tiles. About -0.7 to 0.7
export function createTileableNoise(seed) {
	const hash = (x, y, period) => {
		let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(period, 2246822519) + Math.imul(seed, 3266489917)) | 0;
		h = Math.imul(h ^ (h >>> 13), 1274126177);
		h ^= h >>> 16;
		return (h >>> 0) / 4294967296;
	};
	const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
	return (x, y, period) => {
		const x0 = Math.floor(x), y0 = Math.floor(y);
		const fx = x - x0, fy = y - y0;
		const wrap = (v) => ((v % period) + period) % period;
		// every corner of the cell has a direction of its own, the value is how far along it the point lies
		const corner = (cx, cy, dx, dy) => {
			const angle = hash(wrap(cx), wrap(cy), period) * Math.PI * 2;
			return Math.cos(angle) * dx + Math.sin(angle) * dy;
		};
		const u = fade(fx), v = fade(fy);
		const top = corner(x0, y0, fx, fy) * (1 - u) + corner(x0 + 1, y0, fx - 1, fy) * u;
		const bottom = corner(x0, y0 + 1, fx, fy - 1) * (1 - u) + corner(x0 + 1, y0 + 1, fx - 1, fy - 1) * u;
		return top * (1 - v) + bottom * v;
	};
}

// octaves of it stacked up, each twice as fine and half as strong. u, v: 0 to 1 across the texture. period: how many cells of the first octave fit across
export function tileableFbm(noise, u, v, period, octaves) {
	let total = 0, strength = 0.5;
	for (let i = 0; i < octaves; i++) {
		total += noise(u * period, v * period, period) * strength;
		strength *= 0.5;
		period *= 2;	// exactly twice, or it would stop repeating
	}
	return total;
}

// the four channels, as numbers 0 to 1 (see the top of the file)
function buildWindField(size) {
	const gustNoise = createTileableNoise(1), warpNoiseX = createTileableNoise(2), warpNoiseZ = createTileableNoise(3);
	const fineNoise = createTileableNoise(4), swirlNoise = createTileableNoise(5);

	const gust = new Float32Array(size * size), fine = new Float32Array(size * size), potential = new Float32Array(size * size);
	for (let j = 0; j < size; j++) {
		for (let i = 0; i < size; i++) {
			const u = i / size, v = j / size;
			// the gusts are read from a place pushed aside by more noise (domain warping), which pulls round blobs out into streaks and hooks
			const warpX = tileableFbm(warpNoiseX, u, v, 3, 2), warpZ = tileableFbm(warpNoiseZ, u, v, 3, 2);
			gust[j * size + i] = tileableFbm(gustNoise, u + 0.16 * warpX, v + 0.16 * warpZ, 3, 4);
			fine[j * size + i] = tileableFbm(fineNoise, u, v, 12, 3);
			potential[j * size + i] = tileableFbm(swirlNoise, u, v, 4, 3);
		}
	}

	// the swirl: the slope of the potential, turned a quarter turn
	const swirlX = new Float32Array(size * size), swirlZ = new Float32Array(size * size);
	let longest = 0;
	for (let j = 0; j < size; j++) {
		for (let i = 0; i < size; i++) {
			const left = potential[j * size + (i + size - 1) % size], right = potential[j * size + (i + 1) % size];
			const up = potential[((j + size - 1) % size) * size + i], down = potential[((j + 1) % size) * size + i];
			swirlX[j * size + i] = down - up;
			swirlZ[j * size + i] = left - right;
			longest = Math.max(longest, Math.hypot(swirlX[j * size + i], swirlZ[j * size + i]));
		}
	}

	// stretched to fill 0 to 1
	const spread = (values) => {
		let least = Infinity, most = -Infinity;
		for (const value of values) { least = Math.min(least, value); most = Math.max(most, value); }
		return values.map((value) => (value - least) / (most - least));
	};
	return { gust: spread(gust), fine: spread(fine), swirlX: swirlX.map((s) => 0.5 + 0.5 * s / longest), swirlZ: swirlZ.map((s) => 0.5 + 0.5 * s / longest) };
}

const windField = buildWindField(WIND_TEXTURE_SIZE);

export const windTexture = device.createTexture({
	label: "wind texture",
	size: [WIND_TEXTURE_SIZE, WIND_TEXTURE_SIZE],
	format: 'rgba8unorm',
	usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING,	//storage only so the debug view can show it
});
{
	const pixels = new Uint8Array(WIND_TEXTURE_SIZE * WIND_TEXTURE_SIZE * 4);
	for (let i = 0; i < WIND_TEXTURE_SIZE * WIND_TEXTURE_SIZE; i++) {
		pixels[i * 4] = Math.round(windField.gust[i] * 255);
		pixels[i * 4 + 1] = Math.round(windField.fine[i] * 255);
		pixels[i * 4 + 2] = Math.round(windField.swirlX[i] * 255);
		pixels[i * 4 + 3] = Math.round(windField.swirlZ[i] * 255);
	}
	device.queue.writeTexture({ texture: windTexture }, pixels, { bytesPerRow: WIND_TEXTURE_SIZE * 4 }, [WIND_TEXTURE_SIZE, WIND_TEXTURE_SIZE]);
}
export const windTextureView = windTexture.createView();

// repeating, so the one texture covers the world
export const windSampler = device.createSampler({
	label: "wind sampler",
	magFilter: 'linear',
	minFilter: 'linear',
	addressModeU: 'repeat',
	addressModeV: 'repeat',
});

// how far the texture has slid, world units along x and z. Kept inside one tile, so it never gets big enough to lose precision
let scrollX = 0, scrollZ = 0;
let seconds = 0;
let lastTime = performance.now();
let lastAngle = null;

// the way the wind blows, as a direction 1 long
function windHeading() {
	const length = Math.hypot(settings.windDirection[0], settings.windDirection[1]);
	return length > 0.0001 ? [settings.windDirection[0] / length, settings.windDirection[1] / length] : [1, 0];
}

// Once a frame, before anything reads the wind: slides the texture on by how far the wind has blown since the last one
export function windUpdate() {
	// the direction control is an angle. When it is moved, the direction everything reads (the water as well) follows it
	if (settings.windDirectionAngle !== lastAngle) {
		if (lastAngle !== null) {
			const angle = settings.windDirectionAngle * Math.PI / 180;
			settings.windDirection[0] = Math.cos(angle);
			settings.windDirection[1] = Math.sin(angle);
		}
		lastAngle = settings.windDirectionAngle;
	}

	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);	// a frame that took for ever (the tab was hidden) does not throw everything forward
	lastTime = now;
	seconds += elapsed;

	const heading = windHeading();
	const speed = windSpeedNow() * settings.forestUnitsPerMetre * settings.windGustSpeed;	// world units a second
	const tile = Math.max(settings.windGustSize, 1);
	scrollX = (scrollX + heading[0] * speed * elapsed) % tile;
	scrollZ = (scrollZ + heading[1] * speed * elapsed) % tile;
}

// how far the texture has slid, in its own texels: what the debug view moves it by
export function windScrollTexels() {
	const tile = Math.max(settings.windGustSize, 1);
	const wrap = (value) => ((value / tile * WIND_TEXTURE_SIZE) % WIND_TEXTURE_SIZE + WIND_TEXTURE_SIZE) % WIND_TEXTURE_SIZE;
	return [wrap(scrollX), wrap(scrollZ)];
}

// The two rows of numbers windAt (vf_wind.js) takes, for a uniform buffer:
//		scroll	xy: how far the texture has slid, z: 1 / the size of a tile, w: how hard the wind pushes (windPower)
//		blow	xy: the way the wind blows, z: gustiness, w: time in seconds
export function windUniformValues() {
	const heading = windHeading();
	return [scrollX, scrollZ, 1 / Math.max(settings.windGustSize, 1), windPower(windSpeedNow()),
			heading[0], heading[1], settings.windGustiness, seconds];
}

// one channel of the texture at a place in it (u, v: 0 to 1 and repeating), bilinear like the sampler
function readField(values, u, v) {
	const size = WIND_TEXTURE_SIZE;
	const x = (u - Math.floor(u)) * size - 0.5, y = (v - Math.floor(v)) * size - 0.5;
	const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
	const at = (i, j) => values[((j + size) % size) * size + (i + size) % size];
	return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
}

// The same as windAt in vf_wind.js, for anything on this side that wants to know the wind at a place.
//		Returns [along x, along z, gust 0 to 1, flutter -1 to 1]
export function windAtPoint(x, z) {
	const [sx, sz, perTile, power, headingX, headingZ, gustiness] = windUniformValues();
	const u = (x - sx) * perTile, v = (z - sz) * perTile;
	const fu = (x * 5 - sx * 10) * perTile + 0.37, fv = (z * 5 - sz * 10) * perTile + 0.61;
	const mixed = readField(windField.gust, u, v) * 0.6 + readField(windField.gust, fu, fv) * 0.4;
	const t = Math.min(Math.max((mixed - 0.25) / 0.5, 0), 1);
	const gust = t * t * (3 - 2 * t);
	const strength = power * (1 + (2 * gust - 1) * gustiness);
	let dx = headingX + ((readField(windField.swirlX, u, v) * 2 - 1) + 0.5 * (readField(windField.swirlX, fu, fv) * 2 - 1)) * 0.6 * gustiness;
	let dz = headingZ + ((readField(windField.swirlZ, u, v) * 2 - 1) + 0.5 * (readField(windField.swirlZ, fu, fv) * 2 - 1)) * 0.6 * gustiness;
	const length = Math.hypot(dx, dz) || 1;
	return [dx / length * strength, dz / length * strength, gust, readField(windField.fine, fu, fv) * 2 - 1];
}
