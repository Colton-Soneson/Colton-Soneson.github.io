import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_lightning, LIGHTNING_VERTICES } from '../shaders/js/vf_lightning.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import { weatherNow, seasonNow, SEASON_SUMMER } from './weather.js'

/*
	Lightning, for the storms that have it (weather.js says which). Made to be like the storms of S.T.A.L.K.E.R. 2: not a
	rare event far away, but strike after strike all round, each one lighting the whole cloud deck from inside and
	throwing the land into flat white light for a moment.

	A STRIKE is three things at once:
		the bolt		a jagged line from the bottom of the cloud to the ground, with branches (see buildBolt). 1 strike in 3
						never leaves the cloud, and has no bolt at all: sheet lightning
		the flash		in the cloud round the top of the bolt (the cloud march adds it as light inside the cloud, see
						vf_cloudMarch) and over the whole picture (vf_lightShafts adds it to the finished frame), stronger
						the nearer the strike
		the flicker		a strike is not one flash. The channel the first stroke burned is used again by 1 to 3 more, a few
						hundredths of a second apart, each a bit weaker: that is why lightning flickers

	THE BOLT'S SHAPE (buildBolt)
		Lightning finds its way down in steps, each one off at a random angle from the last. Drawn as a straight line from
		cloud to ground whose middle is knocked sideways at random, and then the middle of each half, and of each quarter,
		by less each time (midpoint displacement), it has the same look: big kinks with smaller kinks on them.
		Branches leave it at a few of its corners and do the same, heading down and outwards, thinner and dimmer, and
		stop short of the ground.

	CALLED DOWN (strikeAt: the staff's Lightning spell, staff.js): a strike to the ground at a given place, whatever the weather. It
	comes from the cloud base, or from high over the place on a clear day, and always reaches the ground, right there.

	Nothing is heard: there is no sound in this engine yet.
*/

const MAX_PIECES = 512;				// pieces of bolt that can be drawn at once
const PIECE_FLOATS = 8;				// start (3), half width, finish (3), brightness
const STRIKE_REACH = 5200.0;		// how far from the camera strikes land, world units

// What the lightning is doing right now, for the things that are lit by it.
//		flash		how bright the strike is at this moment, 0 none to about 1.5
//		sceneFlash	and how much of that reaches the camera: less for a strike far away
//		position	where its light is in the cloud (x, y, z), and reach, how far it spreads through it
export const lightningNow = { flash: 0, sceneFlash: 0, position: [0, 0, 0], reach: 1200 };

const lightningShaderModule = device.createShaderModule({ label: "vf_lightning", code: vf_lightning });

const lightningUniformBuffer = device.createBuffer({
  label: "lightning Uniform",
  size: 96,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

const pieceData = new Float32Array(MAX_PIECES * PIECE_FLOATS);
const pieceBuffer = device.createBuffer({
	label: "lightning bolt pieces",
	size: pieceData.byteLength,
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
let pieceCount = 0;

const lightningPipeline = device.createRenderPipeline({
	label: "lightning pipeline",
	layout: 'auto',
	vertex: {
		module: lightningShaderModule,
		entryPoint: "vertexMain",
		buffers: [{
			// one piece of the bolt: once per instance
			arrayStride: PIECE_FLOATS * 4,
			stepMode: 'instance',
			attributes: [
				{ format: "float32x4", offset: 0, shaderLocation: 0 },		// start, half width
				{ format: "float32x4", offset: 16, shaderLocation: 1 },		// finish, brightness
			],
		}]
	},
	fragment: {
		module: lightningShaderModule,
		entryPoint: "fragmentMain",
		targets: [{
		format: canvasFormat,
		blend: {		// added to the picture: it is light
			color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
			alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
		},
		}]
	},
	primitive: {
		topology: 'triangle-list',
		cullMode: 'none',
	},
	depthStencil: {		// hidden by anything in front of it, and leaving the depth alone
		depthWriteEnabled: false,
		depthCompare: 'less',
		format: 'depth24plus',
	},
});

const lightningBindGroup = device.createBindGroup({
	label: "lightning bind group",
	layout: lightningPipeline.getBindGroupLayout(0),
	entries: [{ binding: 0, resource: { buffer: lightningUniformBuffer } }],
});

// The pieces of one bolt, from a point in the cloud to a point on the ground (see THE BOLT'S SHAPE at the top of the file).
//		Written into pieceData. Returns how many pieces there are
function buildBolt(top, ground) {
	let count = 0;
	const add = (a, b, width, bright) => {
		if (count >= MAX_PIECES) return;
		pieceData.set([a[0], a[1], a[2], width, b[0], b[1], b[2], bright], count * PIECE_FLOATS);
		count++;
	};

	// a line between two points, its middle knocked aside again and again. Returns the points along it
	const jagged = (from, to, levels, wander) => {
		let points = [from, to];
		let offset = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) * wander;
		for (let level = 0; level < levels; level++) {
			const next = [];
			for (let i = 0; i < points.length - 1; i++) {
				const a = points[i], b = points[i + 1];
				next.push(a, [(a[0] + b[0]) / 2 + (Math.random() - 0.5) * offset, (a[1] + b[1]) / 2 + (Math.random() - 0.5) * offset * 0.35, (a[2] + b[2]) / 2 + (Math.random() - 0.5) * offset]);
			}
			next.push(points[points.length - 1]);
			points = next;
			offset *= 0.52;
		}
		return points;
	};

	const height = top[1] - ground[1];
	const main = jagged(top, ground, 5, 0.22);
	for (let i = 0; i < main.length - 1; i++) {
		add(main[i], main[i + 1], 0.9, 1);
	}

	// branches: off a few of the corners of the upper two thirds, heading down and out
	const branches = 3 + Math.floor(Math.random() * 4);
	for (let branch = 0; branch < branches; branch++) {
		const from = main[1 + Math.floor(Math.random() * (main.length * 0.66))];
		const bearing = Math.random() * Math.PI * 2;
		const length = height * (0.12 + 0.3 * Math.random());
		const to = [from[0] + Math.cos(bearing) * length * 0.7, Math.max(from[1] - length * (0.5 + 0.5 * Math.random()), ground[1] + height * 0.08), from[2] + Math.sin(bearing) * length * 0.7];
		const points = jagged(from, to, 3, 0.26);
		for (let i = 0; i < points.length - 1; i++) {
			// thinner and dimmer towards its end
			const fade = 1 - i / points.length;
			add(points[i], points[i + 1], 0.45, 0.2 + 0.4 * fade);
		}
	}
	return count;
}

let lastTime = performance.now();
let untilNext = 2;				// seconds until the next strike
let strikeAge = -1;				// seconds since the strike that is going on began. Below 0: there is none
let strokes = [];				// the strokes of that strike: [when it comes (seconds after the strike began), how strong]
let strikeNearness = 1;			// how much of its flash reaches the camera

// Sets a strike off on the next frame, whatever the weather is doing (for looking at one)
let forced = false;
export function strikeNow() {
	forced = true;
}
// A strike to the ground at (x, z), world units, on the next frame (see CALLED DOWN at the top)
let calledAt = null;
export function strikeAt(x, z) {
	calledAt = [x, z];
}
export const lightningStats = { called: 0 };

// Once a frame, before the clouds are worked out: moves the strike that is going on forward, and now and then starts a new one
export function lightningUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;

	if (calledAt) {
		const [x, z] = calledAt;
		calledAt = null;
		const sea = settings.waterWorldPosY;
		const ground = Math.max(terrain.land ? terrain.land.heightAt(x, z) : sea, sea);
		const cloudBottom = sea + weatherNow.base + settings.cloudHeight;
		const topY = Math.max(cloudBottom + 140, ground + 600);
		// the top a little off from straight over it, the bottom right there
		const lean = Math.random() * Math.PI * 2, off = (topY - ground) * 0.12 * Math.random();
		const top = [x + Math.cos(lean) * off, topY, z + Math.sin(lean) * off];
		lightningNow.position = [top[0], topY + 120, top[2]];
		lightningNow.reach = 900 + 600 * Math.random();
		const away = Math.hypot(x - settings.camPosX, z - settings.camPosZ);
		strikeNearness = Math.min(Math.max(0.35 + 0.65 * (1 - away / STRIKE_REACH), 0.35), 1);
		pieceCount = buildBolt(top, [x, ground, z]);
		device.queue.writeBuffer(pieceBuffer, 0, pieceData, 0, pieceCount * PIECE_FLOATS);
		strokes = [[0, 1.2]];
		let when = 0;
		for (let again = 1 + Math.floor(Math.random() * 2); again > 0; again--) {
			when += 0.05 + 0.1 * Math.random();
			strokes.push([when, 0.5 + 0.4 * Math.random()]);
		}
		strikeAge = 0;
		lightningStats.called++;
	}
	const storming = forced ? 1 : settings.enableLightning && settings.enableClouds ? weatherNow.lightning : 0;
	if (strikeAge < 0 && storming > 0.05) {
		untilNext -= elapsed;
		if (untilNext <= 0 || forced) {
			forced = false;
			// more often the more of a thunderstorm it is, and in summer, when the storms are at their worst
			const rate = storming * Math.max(settings.lightningRate, 0.05) * (seasonNow.index == SEASON_SUMMER ? 1.6 : 1);
			untilNext = (0.8 + 5.5 * Math.random() * Math.random()) / rate;

			// where: anywhere round the camera, more of them far off than near (there is more far off)
			const bearing = Math.random() * Math.PI * 2, away = 350 + (STRIKE_REACH - 350) * Math.sqrt(Math.random());
			const x = settings.camPosX + Math.cos(bearing) * away, z = settings.camPosZ + Math.sin(bearing) * away;
			const cloudBottom = settings.waterWorldPosY + weatherNow.base + settings.cloudHeight;
			const top = [x, cloudBottom + 140, z];
			lightningNow.position = [x, cloudBottom + 260, z];
			lightningNow.reach = 900 + 900 * Math.random();
			strikeNearness = 0.25 + 0.75 * (1 - away / STRIKE_REACH);

			// 2 times in 3 it comes to ground, a little way off from straight under where it started
			pieceCount = 0;
			if (Math.random() < 0.67) {
				const lean = Math.random() * Math.PI * 2, off = (top[1] - settings.waterWorldPosY) * 0.35 * Math.random();
				const gx = x + Math.cos(lean) * off, gz = z + Math.sin(lean) * off;
				const land = terrain.land ? terrain.land.heightAt(gx, gz) : settings.waterWorldPosY;
				pieceCount = buildBolt(top, [gx, Math.max(land, settings.waterWorldPosY), gz]);
				device.queue.writeBuffer(pieceBuffer, 0, pieceData, 0, pieceCount * PIECE_FLOATS);
			}

			// the strokes: the first, and 1 to 3 more down the same channel
			strokes = [[0, 1]];
			let when = 0;
			for (let again = 1 + Math.floor(Math.random() * 3); again > 0; again--) {
				when += 0.05 + 0.12 * Math.random();
				strokes.push([when, 0.35 + 0.5 * Math.random()]);
			}
			strikeAge = 0;
		}
	}

	// how bright it is now: every stroke that has come flares up at once and dies away in under a tenth of a second
	let flash = 0;
	if (strikeAge >= 0) {
		strikeAge += elapsed;
		for (const [when, strength] of strokes) {
			if (strikeAge >= when) {
				flash += strength * Math.exp(-(strikeAge - when) / 0.07);
			}
		}
		if (strikeAge > strokes[strokes.length - 1][0] + 0.45) {
			strikeAge = -1;
			flash = 0;
		}
	}
	lightningNow.flash = Math.min(flash, 1.5);
	lightningNow.sceneFlash = lightningNow.flash * strikeNearness;
}

// The bolt, drawn over the clouds
export function lightningPass(mainpassDepthTexture) {
	if (lightningNow.flash <= 0.01 || pieceCount == 0) {
		return;
	}
	const bufferResult = [];
	const viewProjectionMatrix = transformations.getViewProj();
	for(let i = 0; i < 16; i++) {
		bufferResult.push(viewProjectionMatrix[i]);
	}
	//(and how big a pixel is, see pixelSize in transformations.js)
	bufferResult.push(settings.camPosX, settings.camPosY, settings.camPosZ, transformations.pixelSize());
	bufferResult.push(lightningNow.flash, 0, 0, 0);
	const result = new Float32Array(bufferResult);
	device.queue.writeBuffer(lightningUniformBuffer, 0, result.buffer, result.byteOffset, result.byteLength);

	const encoder = device.createCommandEncoder();
	const pass = encoder.beginRenderPass({
		colorAttachments: [{
			view: context.getCurrentTexture().createView(),
			loadOp: "load",
			storeOp: "store",
		}],
		depthStencilAttachment: {
			view: mainpassDepthTexture.createView(),
			depthLoadOp: 'load',
			depthStoreOp: 'store',
		},
		timestampWrites: profiler.timestamps('Bolt', 'vf_lightning'),
	});
	pass.setPipeline(lightningPipeline);
	pass.setBindGroup(0, lightningBindGroup);
	pass.setVertexBuffer(0, pieceBuffer);
	pass.draw(LIGHTNING_VERTICES, pieceCount, 0, 0);
	pass.end();
	device.queue.submit([encoder.finish()]);
}
