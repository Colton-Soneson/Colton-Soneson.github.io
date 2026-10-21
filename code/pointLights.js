import {device} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_pointLights } from '../shaders/js/vf_pointLights.js'

import * as transformations from './transformations.js'
import { lightNow } from './lighting.js'

/*
	Lights that light what is round them: the towns' gas lamps (town.js), a staff's gem (staff.js). One pass over the picture of
	the solid things, once they are all drawn (see vf_pointLights.js: it works from the depth buffer, a deferred light pass), before
	the water and the sky.
		still lights		setStillLights(owner, list): a list for each owner, made again when it changes (a new land). They are
							sorted into a grid of the world, CELL across, each cell knowing its own
		moving lights		setMovingLight(owner, light or null): one each, MOST_MOVING at once, looked at by every pixel
	A light: { at: [x, y, z], radius (world units), colour: [r, g, b], strength, night } (night: only by night, as a lamp lit at dusk).
	The pass is skipped when there is nothing to light: by day, or with no light within REACH of the camera.
*/
const CELL = 32;
const MOST_MOVING = 8;
const REACH = 900;

const still = new Map();			// owner -> list
const moving = new Map();			// owner -> light
let grid = null;					// { cells, list, lights (Float32Array), count }
let dirty = true;
export const pointLightStats = { still: 0, moving: 0, drawn: false };

export function setStillLights(owner, list) { still.set(owner, list); dirty = true; }
export function setMovingLight(owner, light) { if (light) moving.set(owner, light); else moving.delete(owner); }

const shaderModule = device.createShaderModule({ label: "vf_pointLights", code: vf_pointLights });
const pipeline = device.createRenderPipeline({
	label: "point lights pipeline",
	layout: 'auto',
	vertex: { module: shaderModule, entryPoint: "vertexMain" },
	fragment: { module: shaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat,
		// the picture times one plus the light: source times destination, plus destination
		blend: { color: { srcFactor: 'dst', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } } }] },
	primitive: { topology: 'triangle-list' },
});
const uniformBuffer = device.createBuffer({ label: "point lights Uniform", size: (16 + 4 + 4 + 4 + MOST_MOVING * 8) * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
let buffers = null, bindGroup = null, boundDepth = null;

// the still lights sorted into the grid, and on the GPU
function sortLights() {
	dirty = false;
	const all = [...still.values()].flat();
	const half = settings.terrainWorldSize * 0.5, along = Math.ceil(settings.terrainWorldSize / CELL);
	const lights = new Float32Array(Math.max(all.length, 1) * 8);
	const inCell = new Map();
	all.forEach((l, k) => {
		lights.set([...l.at, l.radius, ...l.colour, l.strength], k * 8);
		const c0 = Math.max(Math.floor((l.at[0] - l.radius + half) / CELL), 0), c1 = Math.min(Math.floor((l.at[0] + l.radius + half) / CELL), along - 1);
		const r0 = Math.max(Math.floor((l.at[2] - l.radius + half) / CELL), 0), r1 = Math.min(Math.floor((l.at[2] + l.radius + half) / CELL), along - 1);
		for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
			const key = r * along + c;
			if (!inCell.has(key)) inCell.set(key, []);
			inCell.get(key).push(k);
		}
	});
	const cells = new Uint32Array(along * along * 2);
	const list = [];
	for (const [key, members] of inCell) { cells[key * 2] = list.length; cells[key * 2 + 1] = members.length; list.push(...members); }
	if (buffers) for (const b of Object.values(buffers)) b.destroy();
	const storage = (label, data) => { const b = device.createBuffer({ label, size: Math.max(data.byteLength, 16), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
	buffers = { lights: storage("point lights", lights), cells: storage("point light cells", cells), list: storage("point light lists", new Uint32Array(list.length ? list : [0])) };
	grid = { along, half, all };
	bindGroup = null;
	pointLightStats.still = all.length;
}

// Over the solid things, before the water (see the top)
export function pointLightPass(encoder, canvasTexture, depthTexture) {
	pointLightStats.drawn = false;
	if (dirty) sortLights();
	const light = lightNow();
	const night = 1 - light.daylight;
	const camera = [settings.camPosX, settings.camPosY, settings.camPosZ];
	const near = (l) => Math.hypot(l.at[0] - camera[0], l.at[2] - camera[2]) < REACH + l.radius;
	const movers = [...moving.values()].filter((l) => near(l) && (!l.night || night > 0.03)).slice(0, MOST_MOVING);
	if ((night < 0.03 || !grid.all.some(near)) && movers.length == 0) return;
	const u = new Float32Array(16 + 12 + MOST_MOVING * 8);
	u.set(transformations.getInvViewProj(), 0);
	u.set([...camera, 0], 16);
	u.set([grid.half, CELL, grid.along, movers.length], 20);
	u.set([smoothstep(0.03, 0.5, night), Math.max(light.ambient + light.direct * 0.5, 0.06), 0, 0], 24);
	movers.forEach((l, k) => u.set([...l.at, l.radius, ...l.colour, l.strength * (l.night ? smoothstep(0.03, 0.5, night) : 1)], 28 + k * 8));
	device.queue.writeBuffer(uniformBuffer, 0, u);
	if (!bindGroup || boundDepth !== depthTexture) {
		boundDepth = depthTexture;
		bindGroup = device.createBindGroup({
			label: "point lights bind group",
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: depthTexture.createView() },
				{ binding: 2, resource: { buffer: buffers.lights } },
				{ binding: 3, resource: { buffer: buffers.cells } },
				{ binding: 4, resource: { buffer: buffers.list } },
			],
		});
	}
	const pass = encoder.beginRenderPass({
		colorAttachments: [{ view: canvasTexture.createView(), loadOp: "load", storeOp: "store" }],
		timestampWrites: profiler.timestamps('Point Lights', 'vf_pointLights'),
	});
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup);
	pass.draw(3);
	pass.end();
	pointLightStats.drawn = true;
	pointLightStats.moving = movers.length;
}
const smoothstep = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
