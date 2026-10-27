import { DEPTH_FORMAT, depthTest, DEPTH_CLEAR } from './depthMode.js'
import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_smoke } from '../shaders/js/vf_smoke.js'

import * as transformations from './transformations.js'
import * as wind from './wind.js'
import * as pointLights from './pointLights.js'

//the puffs fade into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	Smoke, fire and dust, as many puffs as there are at once (MAX_PUFFS), drawn together (vf_smoke.js: a ball each, an instance): the
	houses burning and coming down (town.js), and whatever else puts a puff in (addPuff) or a ball of fire with its flash (blast).
	A PUFF: where it is, how fast it goes (metres a second), how big it is at first and how many times over it grows by the end of its
		life, its kind (0 fire burning out to smoke, 1 smoke, 2 dust) and, smoke, how dark. Each frame it is lifted (rise, metres a second
		a second, held back by the air as it goes up: RISE_DRAG), and carried off with the wind (WIND_TAKE of its speed, from the
		weather: wind.js), more of it the higher it has gone over where it started. A puff further off than DRAW_DISTANCE is not drawn.
	A BLAST: a ball of fire (puffs of fire flung out and up), and a flash of light for FLASH_SECONDS (pointLights.js, a moving light)
	DRAWN see-through, over everything (with the spray and the rain: rotatingCube.js), furthest first, hidden by what is in front of them
	and leaving the depth alone
	In metres and seconds; places in world units (settings.forestUnitsPerMetre to the metre)
*/
const MAX_PUFFS = 4000;
const DRAW_DISTANCE = 3500;			// world units
const RISE_DRAG = 0.35;				// a second
const WIND_TAKE = { low: 0.25, high: 0.85, over: 40 };	// of the wind's speed: at its start, and from over metres higher
const FLASH_SECONDS = 0.7;
const INSTANCE_FLOATS = 8;

const metre = () => settings.forestUnitsPerMetre;
export const smokeStats = { puffs: 0, drawn: 0, added: 0, blasts: 0, triangles: 0 };

// The puffs
//-------------------------------------------------
const puffs = [];
// a puff: at (world units), v (metres a second), size (its radius at first, metres), grow (how many times over by the end), life (seconds),
//		kind (0 fire, 1 smoke, 2 dust), dark (smoke: 0 grey to 1 black), rise (metres a second a second), delay (seconds before it shows)
export function addPuff({ at, v = [0, 0, 0], size = 1, grow = 2, life = 4, kind = 1, dark = 0.5, rise = 0.6, delay = 0 }) {
	if (puffs.length >= MAX_PUFFS) return false;
	puffs.push({ p: [...at], from: at[1], v: [...v], size, grow, life, kind, dark, rise, age: -delay, seed: Math.random() });
	smokeStats.added++;
	return true;
}
// a ball of fire at a place (world units), size: about how many metres across it goes; and its flash
const flashes = [];
let flashNumber = 0;
export function blast(at, size = 4) {
	const m = metre();
	for (let k = 0; k < 10; k++) {
		const a = Math.random() * Math.PI * 2, up = Math.random();
		const speed = (2 + Math.random() * 4) * size / 4;
		addPuff({ at: [at[0] + Math.cos(a) * size * 0.25 * m, at[1] + up * size * 0.3 * m, at[2] + Math.sin(a) * size * 0.25 * m], v: [Math.cos(a) * speed, 1.5 + up * 3, Math.sin(a) * speed],
			size: size * (0.18 + Math.random() * 0.12), grow: 2.2, life: 2 + Math.random() * 2, kind: 0, rise: 1.2, delay: k * 0.03 });
	}
	flashes.push({ key: 'smoke blast ' + flashNumber++, at: [...at], age: 0, size });
	smokeStats.blasts++;
}

let lastTime = performance.now();
export function smokeUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	const m = metre();
	const d = settings.windDirection, dl = Math.hypot(d[0], d[1]) || 1, blow = wind.windSpeedNow();
	const wx = d[0] / dl * blow, wz = d[1] / dl * blow;
	for (const puff of puffs) {
		puff.age += dt;
		if (puff.age < 0) continue;
		const v = puff.v;
		v[1] = v[1] * Math.exp(-RISE_DRAG * dt) + puff.rise * dt;
		const high = Math.min(Math.max((puff.p[1] - puff.from) / m / WIND_TAKE.over, 0), 1), take = WIND_TAKE.low + (WIND_TAKE.high - WIND_TAKE.low) * high;
		const k = Math.min(dt * 0.8, 1);
		v[0] += (wx * take - v[0]) * k;
		v[2] += (wz * take - v[2]) * k;
		for (let i = 0; i < 3; i++) puff.p[i] += v[i] * m * dt;
	}
	for (let i = puffs.length - 1; i >= 0; i--) if (puffs[i].age >= puffs[i].life) puffs.splice(i, 1);
	for (const f of flashes) {
		f.age += dt;
		pointLights.setMovingLight(f.key, f.age < FLASH_SECONDS ? { at: f.at, radius: 12 * m * f.size, colour: [1.0, 0.62, 0.3], strength: 9 * (1 - f.age / FLASH_SECONDS), night: false } : null);
	}
	for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].age >= FLASH_SECONDS) flashes.splice(i, 1);
	smokeStats.puffs = puffs.length;
}

// Drawing them
//-------------------------------------------------
// a ball: an icosahedron, each face split in four, pushed out round (80 triangles)
const BALL = (() => {
	const t = (1 + Math.sqrt(5)) / 2;
	const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
	const f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
		[3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
	const unit = (p) => { const l = Math.hypot(...p); return p.map((c) => c / l); };
	const mid = (a, b) => unit([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
	const out = [];
	for (const [i, j, k] of f) {
		const a = unit(v[i]), b = unit(v[j]), c = unit(v[k]), ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
		for (const tri of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) for (const p of tri) out.push(p[0], p[1], p[2], 1);
	}
	return new Float32Array(out);
})();
const BALL_VERTICES = BALL.length / 4;
const ballBuffer = device.createBuffer({ label: "smoke ball", size: BALL.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(ballBuffer, 0, BALL);
const instanceData = new Float32Array(MAX_PUFFS * INSTANCE_FLOATS);
const instanceBuffer = device.createBuffer({ label: "smoke instances", size: instanceData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
const uniformBuffer = device.createBuffer({ label: "smoke Uniform", size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const shaderModule = device.createShaderModule({ label: "vf_smoke", code: vf_smoke });
const pipeline = device.createRenderPipeline({
	label: "smoke pipeline",
	layout: 'auto',
	vertex: {
		module: shaderModule,
		entryPoint: "vertexMain",
		buffers: [
			{ arrayStride: 16, attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }] },
			{ arrayStride: INSTANCE_FLOATS * 4, stepMode: 'instance', attributes: [{ format: "float32x4", offset: 0, shaderLocation: 1 }, { format: "float32x4", offset: 16, shaderLocation: 2 }] },
		],
	},
	fragment: { module: shaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat, blend: {
		color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
		alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
	} }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: false, depthCompare: depthTest('less'), format: DEPTH_FORMAT },
});
let bindGroup = null, boundLUT = null;
const startSeconds = performance.now() / 1000;

// over everything (see DRAWN at the top)
export function smokePass(mainpassDepthTexture) {
	const m = metre(), cx = settings.camPosX, cy = settings.camPosY, cz = settings.camPosZ;
	const shown = [];
	for (const puff of puffs) {
		if (puff.age < 0) continue;
		const p = puff.p;
		if (Math.abs(p[0] - cx) > DRAW_DISTANCE || Math.abs(p[2] - cz) > DRAW_DISTANCE) continue;
		const away = Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz);
		if (away <= DRAW_DISTANCE) shown.push([away, puff]);
	}
	shown.sort((a, b) => b[0] - a[0]);
	let count = 0;
	for (const [, puff] of shown) {
		const p = puff.p, k = puff.age / puff.life;
		instanceData.set([p[0], p[1], p[2], puff.size * m * (0.5 + puff.grow * Math.sqrt(k)), k, puff.kind, puff.seed, puff.dark], count * INSTANCE_FLOATS);
		count++;
	}
	smokeStats.drawn = count;
	smokeStats.triangles = count * BALL_VERTICES / 3;
	if (count == 0) return;
	device.queue.writeBuffer(instanceBuffer, 0, instanceData, 0, count * INSTANCE_FLOATS);
	const u = new Float32Array(24);
	u.set(transformations.getViewProj(), 0);
	u.set([cx, cy, cz, performance.now() / 1000 - startSeconds], 16);
	u.set([settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, 0, 0], 20);
	device.queue.writeBuffer(uniformBuffer, 0, u);
	if (!bindGroup || boundLUT !== skyViewLUTtexture) {
		boundLUT = skyViewLUTtexture;
		bindGroup = device.createBindGroup({
			label: "smoke bind group",
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: { buffer: uniformBufferLights } },
				{ binding: 2, resource: skyViewLUTtexture.createView() },
				{ binding: 3, resource: linSampler },
			],
		});
	}
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginRenderPass({
		colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Smoke', 'vf_smoke'),
	});
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup);
	pass.setVertexBuffer(0, ballBuffer);
	pass.setVertexBuffer(1, instanceBuffer);
	pass.draw(BALL_VERTICES, count, 0, 0);
	pass.end();
	device.queue.submit([encoder.finish()]);
}

// for testing
export function puffList() { return puffs.map((p) => ({ at: [...p.p], age: p.age, kind: p.kind, size: p.size })); }
