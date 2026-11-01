import {device} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import * as scene from './scene.js'
import * as transformations from './transformations.js'
import * as hunting from './hunting.js'
import * as forest from './forest.js'
import * as town from './town.js'
import * as props from './props.js'

/*
	WHAT THE SKY CAN SEE: the top down height map (scene.js: the land and the models, as from straight above: transformations.getTopDownViewProjectionMat)
	is what the water reads its depth from, and the snow on the ground what is over it. Here it is finished for everything that asks what is over a
	place: what stands near the camera goes into it too (coverPass: the houses, the streets' bridges and piers: town.coverDraws; the tents and whoever
	else adds to it: addProps; the crowns of the trees near the walker). That is done AFTER the water has read it, so the sea does not take a shack on a
	pier for an island.
		THE WALKER: is it under anything? A little square of the map round where it stands (PATCH texels, about its own width) is read out by a compute shader (only the
		whole of a depth texture can be copied), and back from the GPU a few frames later, every READ_EVERY frames (coverNow): the share of those texels where what the sky sees is higher than the walker's middle
		(HEAD metres over its feet: under a tent's eaves its head may be through them). The needs go by that (survival.js: UNDER COVER). Each machine has
		every tent and house there is, so each works out its own walker's.
		THE RAIN AND THE SNOW (particles.js, vf_rain, vf_snow): a drop lower than what the sky sees at its place is not drawn, so it does not rain indoors.
*/
const PATCH = 5;				// texels a side: about 70 cm
const READ_EVERY = 6;			// frames
const HEAD = 1.1;				// metres over its feet: what is over this is over the walker
const BIAS = 0.0003;			// of the map's depth: 0.3 world units
const REACH = 70;				// world units round the camera the houses go in (as far as the rain is drawn: settings.rainDistance, across the corners)
const TREES = 16;				// world units round the walker the crowns go in
const MOST = 128;

const shader = `
	struct Uniforms { viewProjection : mat4x4f }
	@group(0) @binding(0) var<uniform> U: Uniforms;
	@group(0) @binding(1) var<storage, read> models: array<mat4x4f>;
	@vertex
	fn vertexMain(@location(0) pos: vec3f, @builtin(instance_index) k: u32) -> @builtin(position) vec4f {
		return U.viewProjection * models[k] * vec4f(pos, 1.0);
	}
`;
const module = device.createShaderModule({ label: 'sky cover', code: shader });
const layout = device.createBindGroupLayout({ label: 'sky cover', entries: [
	{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: {} },
	{ binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
] });
const pipelineFor = (stride) => device.createRenderPipeline({
	label: 'sky cover pipeline', layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
	vertex: { module, entryPoint: 'vertexMain', buffers: [{ arrayStride: stride, attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }] }] },
	depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth32float' },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
});
const townPipeline = pipelineFor(32), propPipeline = pipelineFor(16);
const uniform = device.createBuffer({ label: 'sky cover Uniform', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const modelData = new Float32Array(MOST * 16);
const modelBuffer = device.createBuffer({ label: 'sky cover models', size: modelData.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const bindGroup = device.createBindGroup({ label: 'sky cover', layout, entries: [{ binding: 0, resource: { buffer: uniform } }, { binding: 1, resource: { buffer: modelBuffer } }] });
// the little square, out of the map
const readerModule = device.createShaderModule({ label: 'sky cover read', code: `
	@group(0) @binding(0) var heightMap: texture_depth_2d;
	@group(0) @binding(1) var<uniform> corner: vec4u;
	@group(0) @binding(2) var<storage, read_write> values: array<f32>;
	@compute @workgroup_size(${PATCH}, ${PATCH})
	fn main(@builtin(local_invocation_id) id: vec3u) { values[id.y * ${PATCH}u + id.x] = textureLoad(heightMap, vec2i(corner.xy + id.xy), 0); }
` });
const readerPipeline = device.createComputePipeline({ label: 'sky cover read', layout: 'auto', compute: { module: readerModule, entryPoint: 'main' } });
const readerUniform = device.createBuffer({ label: 'sky cover read Uniform', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const patchBuffer = device.createBuffer({ label: 'sky cover patch', size: PATCH * PATCH * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
const readBuffer = device.createBuffer({ label: 'sky cover read back', size: PATCH * PATCH * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
const readerGroup = device.createBindGroup({ label: 'sky cover read', layout: readerPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: scene.heightMapView }, { binding: 1, resource: { buffer: readerUniform } }, { binding: 2, resource: { buffer: patchBuffer } }] });

// who else stands in the picture: fn(put), put(name (itemMeshes.js), model)
const propSources = [];
export function addProps(fn) { propSources.push(fn); }

// the walker's own: the share of what is round it that is over it, 0 to 1, as last read
let cover = 0, frames = 0, reading = false;
export const coverNow = () => cover;
export const coverStats = { reads: 0, cover: 0, depth: 0, head: 0 };

const CROWN = (() => { const m = new Float32Array(16); return m; })();
// Once a frame, after the water has read the map (rotatingCube.js)
export function coverPass() {
	if (!settings.enableTerrain) return;
	const p = hunting.hunterPlace(), x = p.active ? p.x : settings.camPosX, z = p.active ? p.z : settings.camPosZ;
	const matrix = transformations.getTopDownViewProjectionMat();
	const townDraws = town.coverDraws(settings.camPosX, settings.camPosZ, REACH);
	const propDraws = [];
	for (const fn of propSources) fn((name, model) => { const r = props.meshRange(name); if (r) propDraws.push({ r, model }); });
	if (p.active && settings.enableForest) {
		const r = props.meshRange('crownCover'), m = settings.forestUnitsPerMetre;
		forest.crownsNear(x, z, TREES, (tx, ty, tz, radius, height) => {
			if (height < 3 * m) return;
			const bottom = ty + height * 0.3;
			CROWN.fill(0);
			CROWN[0] = radius; CROWN[5] = height * 0.7; CROWN[10] = radius; CROWN[12] = tx; CROWN[13] = bottom; CROWN[14] = tz; CROWN[15] = 1;
			propDraws.push({ r, model: new Float32Array(CROWN) });
		});
	}
	let n = 0;
	for (const d of [...townDraws, ...propDraws]) { if (n >= MOST) break; modelData.set(d.matrix ?? d.model, n * 16); d.instance = n++; }
	const encoder = device.createCommandEncoder({ label: 'sky cover' });
	if (n > 0) {
		device.queue.writeBuffer(uniform, 0, matrix);
		device.queue.writeBuffer(modelBuffer, 0, modelData, 0, n * 16);
		const pass = encoder.beginRenderPass({
			colorAttachments: [],
			depthStencilAttachment: { view: scene.heightMapView, depthLoadOp: 'load', depthStoreOp: 'store' },
			timestampWrites: profiler.timestamps('Sky Cover', 'skyCover'),
		});
		pass.setBindGroup(0, bindGroup);
		pass.setPipeline(townPipeline);
		for (const d of townDraws) if (d.instance !== undefined) { pass.setVertexBuffer(0, d.buffer); pass.draw(d.vertices, 1, 0, d.instance); }
		pass.setPipeline(propPipeline);
		pass.setVertexBuffer(0, props.vertexBuffer);
		for (const d of propDraws) if (d.instance !== undefined) pass.draw(d.r.count, 1, d.r.first, d.instance);
		pass.end();
	}
	// the little square round the walker (see the top)
	let reader = null;
	if (p.active && !reading && ++frames >= READ_EVERY) {
		frames = 0;
		const size = settings.heightMapResolution, m = settings.forestUnitsPerMetre, feet = p.y + HEAD * m;
		const cx = matrix[0] * x + matrix[8] * z + matrix[12], cy = matrix[1] * x + matrix[9] * z + matrix[13], cz = matrix[2] * x + matrix[6] * feet + matrix[10] * z + matrix[14];
		const u = Math.floor((cx * 0.5 + 0.5) * size) - (PATCH >> 1), v = Math.floor((0.5 - cy * 0.5) * size) - (PATCH >> 1);
		if (u >= 0 && v >= 0 && u + PATCH <= size && v + PATCH <= size) {
			device.queue.writeBuffer(readerUniform, 0, new Uint32Array([u, v, 0, 0]));
			const pass = encoder.beginComputePass({ label: 'sky cover read' });
			pass.setPipeline(readerPipeline);
			pass.setBindGroup(0, readerGroup);
			pass.dispatchWorkgroups(1);
			pass.end();
			encoder.copyBufferToBuffer(patchBuffer, 0, readBuffer, 0, PATCH * PATCH * 4);
			reader = cz;
		}
	}
	device.queue.submit([encoder.finish()]);
	if (reader !== null) {
		reading = true;
		readBuffer.mapAsync(GPUMapMode.READ).then(() => {
			const data = new Float32Array(readBuffer.getMappedRange());
			let over = 0, least = 1;
			for (const depth of data) {
				if (depth < least) least = depth;
				if (depth < reader - BIAS) over++;
			}
			readBuffer.unmap();
			cover = over / (PATCH * PATCH);
			coverStats.reads++; coverStats.cover = cover; coverStats.depth = least; coverStats.head = reader;
			reading = false;
		}).catch(() => { reading = false; });
	}
}
