import { DEPTH_FORMAT, depthTest } from './depthMode.js'
import { device, frameTexture, canvasFormat } from './deviceSelection.js'
import * as profiler from './profiler.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { vf_props } from '../shaders/js/vf_props.js'

import * as transformations from './transformations.js'
import * as temporalAA from './temporalAA.js'
import { MESHES } from './itemMeshes.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	THE PROPS (the Survival mode's things out in the world, vf_props.js): each frame whoever has some to show puts them in (show: the
	model's name, itemMeshes.js; where, world units; how it is turned, and glowing) and they are drawn together after the animals, MOST
	at the most. place() makes where one is from a spot on the ground, a heading and a tip.
*/
const MOST = 512;
const INSTANCE_FLOATS = 20;

// every model in one buffer: each its first vertex and how many
const ranges = {};
const vertexData = (() => {
	let total = 0;
	for (const mesh of Object.values(MESHES)) total += mesh.data.length;
	const all = new Float32Array(total);
	let at = 0;
	for (const [name, mesh] of Object.entries(MESHES)) { all.set(mesh.data, at); ranges[name] = { first: at / 4, count: mesh.data.length / 4 }; at += mesh.data.length; }
	return all;
})();
const vertexBuffer = device.createBuffer({ label: 'props mesh', size: vertexData.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
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

const queue = [];		// { name, model, glow }
export const propStats = { drawn: 0 };
// one to draw this frame: name (itemMeshes.js), model (its metres into the world: place), glow ([r, g, b, how strong])
export function show(name, model, glow = [0, 0, 0, 0]) {
	if (queue.length < MOST && ranges[name]) queue.push({ name, model, glow });
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
	queue.forEach((q, k) => { instanceData.set(q.model, k * INSTANCE_FLOATS); instanceData.set(q.glow, k * INSTANCE_FLOATS + 16); });
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
	queue.forEach((q, k) => { const r = ranges[q.name]; pass.draw(r.count, 1, r.first, k); });
	pass.end();
	queue.length = 0;
}
