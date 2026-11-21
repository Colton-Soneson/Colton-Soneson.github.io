import { device, canvasFormat } from './deviceSelection.js'
import { DEPTH_FORMAT, depthTest } from './depthMode.js'
import { settings } from './settings.js'
import * as profiler from './profiler.js'
import * as transformations from './transformations.js'
import * as screenEffects from './screenEffects.js'
import { c_riverFlecks, vf_riverFlecks, FLECKS, FLECK_FLOATS, FLECK_WORKGROUP, FLECK_STRETCHES } from '../shaders/js/vfc_riverFlecks.js'

/*
	THE RIVERS' FLECKS (shaders/js/vfc_riverFlecks.js has how they move and go round things): bits of foam carried on the rivers near the
	camera. rivers.js gives the stretches near the camera (nearStretches: their ends, water, half widths and speeds), moves them (fleckUpdate,
	before its pass) and draws them (fleckDraw, in its pass, after the water). settings.enableRiverFlecks
*/
const NEAR = 80;			// metres: the stretches the flecks are born on are this near the camera
const STRETCH_FLOATS = 12;

const uniformBuffer = device.createBuffer({ label: 'river flecks uniforms', size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const fleckBuffer = device.createBuffer({ label: 'river flecks', size: FLECKS * FLECK_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
{	// (all of them born straight away: each past its time)
	const start = new Float32Array(FLECKS * FLECK_FLOATS);
	for (let i = 0; i < FLECKS; i++) { start[i * FLECK_FLOATS + 3] = 1e9; start[i * FLECK_FLOATS + 6] = 1e6; }
	device.queue.writeBuffer(fleckBuffer, 0, start);
}
const stretchBuffer = device.createBuffer({ label: 'river flecks stretches', size: FLECK_STRETCHES * STRETCH_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const C = GPUShaderStage.COMPUTE, V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
const computeLayout = device.createBindGroupLayout({ label: 'river flecks update layout', entries: [
	{ binding: 0, visibility: C, buffer: {} },
	{ binding: 1, visibility: C, buffer: { type: 'storage' } },
	{ binding: 2, visibility: C, buffer: { type: 'read-only-storage' } },
	{ binding: 3, visibility: C, texture: { sampleType: 'depth' } },
] });
const drawLayout = device.createBindGroupLayout({ label: 'river flecks draw layout', entries: [
	{ binding: 0, visibility: V | F, buffer: {} },
	{ binding: 1, visibility: V, buffer: { type: 'read-only-storage' } },
] });
const computeModule = device.createShaderModule({ label: 'c_riverFlecks', code: c_riverFlecks });
const drawModule = device.createShaderModule({ label: 'vf_riverFlecks', code: vf_riverFlecks });
const updatePipeline = device.createComputePipeline({ label: 'river flecks update', layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }), compute: { module: computeModule, entryPoint: 'update' } });
const drawPipeline = device.createRenderPipeline({
	label: 'river flecks draw',
	layout: device.createPipelineLayout({ bindGroupLayouts: [drawLayout] }),
	vertex: { module: drawModule, entryPoint: 'vertexMain', buffers: [] },
	fragment: { module: drawModule, entryPoint: 'fragmentMain', targets: [{ format: canvasFormat, blend: {
		color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } } }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: false, depthCompare: depthTest('less-equal'), format: DEPTH_FORMAT },
});
const drawGroup = device.createBindGroup({ label: 'river flecks draw', layout: drawLayout, entries: [{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: { buffer: fleckBuffer } }] });
let computeGroup = null, computeFor = null;
let last = performance.now(), stretchCount = 0;
export const fleckStats = { stretches: 0 };

// the stretches near the camera: [{ a: [x, y, z, half], b: [...], speed }]
export function fleckUpdate(encoder, stretches) {
	if (settings.enableRiverFlecks === false) { stretchCount = 0; return; }
	const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05);
	last = now;
	const m = settings.forestUnitsPerMetre, cx = settings.camPosX, cz = settings.camPosZ;
	const near = stretches.filter((s) => Math.hypot((s.a[0] + s.b[0]) / 2 - cx, (s.a[2] + s.b[2]) / 2 - cz) < NEAR * m).slice(0, FLECK_STRETCHES);
	stretchCount = near.length;
	fleckStats.stretches = stretchCount;
	if (stretchCount == 0) return;
	const data = new Float32Array(stretchCount * STRETCH_FLOATS);
	near.forEach((s, k) => data.set([...s.a, ...s.b, s.speed, 0, 0, 0], k * STRETCH_FLOATS));
	device.queue.writeBuffer(stretchBuffer, 0, data);
	const P = transformations.projectionMatrix, L = [settings.sunPosX, settings.sunPosY, settings.sunPosZ], len = Math.hypot(...L) || 1;
	const daylight = Math.min(Math.max((L[1] / len + 0.08) / 0.33, 0), 1);
	const depth = screenEffects.sceneDepthTexture;
	device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([...transformations.getViewProj(),
		settings.camPosX, settings.camPosY, settings.camPosZ, (now / 1000) % 3600,
		dt, stretchCount, m, daylight,
		P[10], P[14], screenEffects.sceneCopyReady ? 1 : 0, 0,
		depth.width, depth.height, 0, 0]));
	if (!computeGroup || computeFor !== depth) {
		computeFor = depth;
		computeGroup = device.createBindGroup({ label: 'river flecks update', layout: computeLayout, entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } }, { binding: 1, resource: { buffer: fleckBuffer } },
			{ binding: 2, resource: { buffer: stretchBuffer } }, { binding: 3, resource: depth.createView() },
		] });
	}
	const pass = encoder.beginComputePass({ label: 'river flecks', timestampWrites: profiler.timestamps('River Flecks', 'c_riverFlecks') });
	pass.setPipeline(updatePipeline);
	pass.setBindGroup(0, computeGroup);
	pass.dispatchWorkgroups(Math.ceil(FLECKS / FLECK_WORKGROUP));
	pass.end();
}
export function fleckDraw(pass) {
	if (stretchCount == 0 || settings.enableRiverFlecks === false) return;
	pass.setPipeline(drawPipeline);
	pass.setBindGroup(0, drawGroup);
	pass.draw(6, FLECKS, 0, 0);
}
