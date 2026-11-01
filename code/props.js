import { DEPTH_FORMAT, depthTest } from './depthMode.js'
import { device, frameTexture, canvasFormat } from './deviceSelection.js'
import * as profiler from './profiler.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { vf_props } from '../shaders/js/vf_props.js'

import * as transformations from './transformations.js'
import * as temporalAA from './temporalAA.js'
import { MESHES } from './itemMeshes.js'
import { INTERIOR_MESHES } from './interiorMeshes.js'
import { CREATURE_MESHES } from './creatureMeshes.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	THE PROPS (the Survival mode's things out in the world, vf_props.js): each frame whoever has some to show puts them in (show: the
	model's name, itemMeshes.js, interiorMeshes.js, creatureMeshes.js; where, world units; how it is turned, and glowing) and they are drawn together
	after the animals, MOST at the most, by model. place() makes where one is from a spot on the ground, a heading and a tip. extra: [indoors (1: lit as a
	room is), how far it bends (a share of its length), where in the bend it is, its length in metres (less than 0: it bends up and down: a whale)]
*/
const MOST = 8192;
const INSTANCE_FLOATS = 24;

// every model in one buffer: each its first vertex and how many
const ALL = { ...MESHES, ...INTERIOR_MESHES, ...CREATURE_MESHES };
const ranges = {};
export const meshRange = (name) => ranges[name];
const vertexData = (() => {
	let total = 0;
	for (const mesh of Object.values(ALL)) total += mesh.data.length;
	const all = new Float32Array(total);
	let at = 0;
	for (const [name, mesh] of Object.entries(ALL)) { all.set(mesh.data, at); ranges[name] = { first: at / 4, count: mesh.data.length / 4 }; at += mesh.data.length; }
	return all;
})();
export const vertexBuffer = device.createBuffer({ label: 'props mesh', size: vertexData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(vertexBuffer, 0, vertexData);
const instanceData = new Float32Array(MOST * INSTANCE_FLOATS);
const instanceBuffer = device.createBuffer({ label: 'props instances', size: instanceData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const uniformBuffer = device.createBuffer({ label: 'props Uniform', size: 64 * 3 + 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const shaderModule = device.createShaderModule({ label: 'vf_props', code: vf_props });
const pipeline = device.createRenderPipeline({
	label: 'props pipeline',
	layout: 'auto',
	vertex: { module: shaderModule, entryPoint: 'vertexMain', buffers: [{ arrayStride: 16, attributes: [{ format: 'float32x4', offset: 0, shaderLocation: 0 }] }] },
	fragment: { module: shaderModule, entryPoint: 'fragmentMain', targets: [{ format: canvasFormat }, { format: temporalAA.MOTION_FORMAT }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: depthTest('less'), format: DEPTH_FORMAT },
});
// (made the first time it is drawn: the lights' buffer is rotatingCube.js's, made after this)
let bindGroup = null;
const makeBindGroup = () => device.createBindGroup({ label: 'props bind group', layout: pipeline.getBindGroupLayout(0), entries: [
	{ binding: 0, resource: { buffer: uniformBuffer } },
	{ binding: 1, resource: { buffer: uniformBufferLights } },
	{ binding: 2, resource: { buffer: instanceBuffer } },
] });

const queue = [];		// { name, model, glow, extra }
export const propStats = { drawn: 0 };
// one to draw this frame: name (itemMeshes.js), model (its metres into the world: place), glow ([r, g, b, how strong])
const NO_EXTRA = [0, 0, 0, 0];
export function show(name, model, glow = NO_EXTRA, extra = NO_EXTRA) {
	if (queue.length < MOST && ranges[name]) queue.push({ name, model, glow, extra });
}
// where one is: at (world units, its foot), heading (radians, round from +z towards +x), and tipped (pitch: its +z up, roll), scaled
export function place(at, heading = 0, pitch = 0, roll = 0, scale = 1) {
	const m = settings.forestUnitsPerMetre * scale;
	let model = mat4.translation(at);
	model = mat4.rotateY(model, heading);
	model = mat4.rotateX(model, -pitch);
	model = mat4.rotateZ(model, roll);
	return mat4.scale(model, [m, m, m]);
}

export function propsPass(encoder, depthTexture) {
	propStats.drawn = queue.length;
	if (!queue.length) return;
	queue.sort((a, b) => ranges[a.name].first - ranges[b.name].first);
	queue.forEach((q, k) => { instanceData.set(q.model, k * INSTANCE_FLOATS); instanceData.set(q.glow, k * INSTANCE_FLOATS + 16); instanceData.set(q.extra, k * INSTANCE_FLOATS + 20); });
	device.queue.writeBuffer(instanceBuffer, 0, instanceData, 0, queue.length * INSTANCE_FLOATS);
	const u = new Float32Array(52);
	u.set(transformations.getViewProj(), 0);
	u.set(temporalAA.viewProjNow(), 16);
	u.set(temporalAA.prevViewProjNow(), 32);
	u[48] = performance.now() / 1000 % 1000;
	device.queue.writeBuffer(uniformBuffer, 0, u);
	const pass = encoder.beginRenderPass({
		colorAttachments: [{ view: frameTexture().createView(), loadOp: 'load', storeOp: 'store' }, { view: temporalAA.motionView(), loadOp: 'load', storeOp: 'store' }],
		depthStencilAttachment: { view: depthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Props', 'vf_props'),
	});
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup ??= makeBindGroup());
	pass.setVertexBuffer(0, vertexBuffer);
	for (let k = 0; k < queue.length;) {
		const r = ranges[queue[k].name];
		let n = 1;
		while (k + n < queue.length && queue[k + n].name === queue[k].name) n++;
		pass.draw(r.count, n, r.first, k);
		k += n;
	}
	pass.end();
	queue.length = 0;
}
