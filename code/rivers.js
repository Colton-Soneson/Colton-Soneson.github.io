import { DEPTH_FORMAT, depthTest } from './depthMode.js'
import * as profiler from './profiler.js'
import { device, frameTexture, canvasFormat } from './deviceSelection.js'
import { settings } from './settings.js';
import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as screenEffects from './screenEffects.js'
import { RIVER_FLOATS } from './terrainGenerator.js'
import { vf_rivers } from '../shaders/js/vf_rivers.js'
import { skyViewLUTtexture } from './atmosphere.js'
import { uniformBufferLights } from './rotatingCube.js'

/*
	THE RIVERS' WATER: terrainGenerator.js lays the rivers out over each continent (THE RIVERS) and cuts their channels into the land;
	each tile it has made has the stretches it draws (land.riverLines). This makes a ribbon of each tile's at the height of the water,
	EDGE wider than the water each side so its edges are under the banks, and draws them after the sea (they read the frame as it
	was before the water: screenEffects.js), the water itself the shader's (vf_rivers.js).
	A river is not drawn where its water is at the sea's (ABOVE_SEA): the sea is the water there, and comes up its mouth by itself.
	Far off a small stream is too narrow to see, and the land there too coarse to have its channel: each stretch is drawn out to SEEN
	times its width (and no further than settings.camFarPlane)
*/
const EDGE = 2.5;					// world units past the water's edge each side
const ABOVE_SEA = 0.4;				// world units: water lower than this over the sea is the sea's
const SEEN = 1400;					// times its half width that a stretch is drawn out to
const VERTEX_FLOATS = 10;			// position (3), along, across, half width, fall, which way it runs (2), depth

export const riverStats = { tiles: 0, stretches: 0, vertices: 0 };

const shaderModule = device.createShaderModule({ label: 'vf_rivers', code: vf_rivers });
const uniformBuffer = device.createBuffer({ label: 'river uniforms', size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

const bindGroupLayout = device.createBindGroupLayout({
	label: 'river bind group layout',
	entries: [
		{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },
		{ binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} },		// the lights
		{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },								// the sky view LUT
		{ binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
		{ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: {} },								// the frame before the water
		{ binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },		// and its depth
	],
});
const pipeline = device.createRenderPipeline({
	label: 'river pipeline',
	layout: device.createPipelineLayout({ label: 'river pipeline layout', bindGroupLayouts: [bindGroupLayout] }),
	vertex: {
		module: shaderModule,
		entryPoint: 'vertexMain',
		buffers: [{
			arrayStride: VERTEX_FLOATS * 4,
			attributes: [
				{ format: 'float32x3', offset: 0, shaderLocation: 0 },		// position
				{ format: 'float32x4', offset: 12, shaderLocation: 1 },		// along, across, half width, fall
				{ format: 'float32x2', offset: 28, shaderLocation: 2 },		// which way it runs
				{ format: 'float32', offset: 36, shaderLocation: 3 },		// depth
			],
		}],
	},
	fragment: {
		module: shaderModule,
		entryPoint: 'fragmentMain',
		targets: [{
			format: canvasFormat,
			// (soft at the shore: see vf_rivers.js)
			blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } },
		}],
	},
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: depthTest('less'), format: DEPTH_FORMAT },
});

// THE RIBBONS: one buffer for each tile's rivers, made when the tile comes and let go when it goes
const ribbons = new Map();		// land -> { buffer, vertices, stretches: [{ x, z, seen, first, count }] }
// the ribbon of a land's rivers (null if it has none): its vertices, and its stretches, so the ones out of sight can be left out
function ribbonOf(land) {
	const lines = land?.riverLines;
	if (!lines || lines.points.length == 0) return null;
	const { points, starts } = lines, sea = settings.waterWorldPosY;
	const P = (k, q) => points[k * RIVER_FLOATS + q];
	const out = [], stretches = [];
	for (let l = 0; l < starts.length - 1; l++) {
		const a = starts[l], b = starts[l + 1];
		const end = (i) => {
			// (which way it runs here: from the point before to the one after)
			const i0 = Math.max(i - 1, a), i1 = Math.min(i + 1, b - 1);
			let tx = P(i1, 0) - P(i0, 0), tz = P(i1, 1) - P(i0, 1);
			const tl = Math.hypot(tx, tz) || 1;
			tx /= tl; tz /= tl;
			return { x: P(i, 0), z: P(i, 1), y: sea + Math.max(P(i, 2), ABOVE_SEA), w: P(i, 3), d: P(i, 4), u: P(i, 5), tx, tz };
		};
		for (let k = a; k < b - 1; k++) {
			if (P(k, 2) < ABOVE_SEA && P(k + 1, 2) < ABOVE_SEA) continue;
			const e0 = end(k), e1 = end(k + 1);
			const run = Math.hypot(e1.x - e0.x, e1.z - e0.z);
			const fall = run > 0 ? Math.max(P(k, 2) - P(k + 1, 2), 0) / run : 0;
			const v = (p, side) => { const reach = p.w + EDGE; out.push(p.x - p.tz * reach * side, p.y, p.z + p.tx * reach * side, p.u, side * reach / p.w, p.w, fall, p.tx, p.tz, p.d); };
			const first = out.length / VERTEX_FLOATS;
			v(e0, -1); v(e0, 1); v(e1, 1);
			v(e0, -1); v(e1, 1); v(e1, -1);
			stretches.push({ x: 0.5 * (e0.x + e1.x), z: 0.5 * (e0.z + e1.z), seen: Math.min(SEEN * Math.max(e0.w, e1.w), settings.camFarPlane ?? 20000) + run, first, count: 6 });
		}
	}
	if (out.length == 0) return null;
	const data = new Float32Array(out);
	const buffer = device.createBuffer({ label: 'river ribbon', size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	device.queue.writeBuffer(buffer, 0, data);
	return { buffer, vertices: data.length / VERTEX_FLOATS, stretches };
}
// the lands with rivers to draw now: every tile in, or the one land
function landsNow() {
	if (!terrain.land) return [];
	return terrain.world ? terrain.tilesLoaded().map((t) => t.land) : [terrain.land];
}
function keepRibbons() {
	const now = new Set(landsNow());
	for (const [land, r] of ribbons) if (!now.has(land)) { r?.buffer.destroy(); ribbons.delete(land); }
	for (const land of now) if (!ribbons.has(land)) ribbons.set(land, ribbonOf(land));
}

let bindGroup = null, boundTo = null;
function bindGroupNow() {
	const key = [screenEffects.sceneColorTexture, screenEffects.sceneDepthTexture, skyViewLUTtexture];
	if (!bindGroup || boundTo.some((v, i) => v !== key[i])) {
		boundTo = key;
		bindGroup = device.createBindGroup({
			label: 'river bind group',
			layout: bindGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: { buffer: uniformBufferLights } },
				{ binding: 2, resource: skyViewLUTtexture.createView() },
				{ binding: 3, resource: linSampler },
				{ binding: 4, resource: screenEffects.sceneColorTexture.createView() },
				{ binding: 5, resource: screenEffects.sceneDepthTexture.createView() },
			],
		});
	}
	return bindGroup;
}

// Per frame, after the sea
//-------------------------------------------------
export function riverPass(depthTexture) {
	riverStats.tiles = riverStats.stretches = riverStats.vertices = 0;
	if (!settings.enableTerrain || settings.enableRivers === false) return;
	keepRibbons();
	const drawn = [...ribbons.values()].filter(Boolean);
	if (drawn.length == 0) return;
	const P = transformations.projectionMatrix;
	device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([...transformations.getViewProj(),
		(performance.now() / 1000) % 3600, settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, settings.forestUnitsPerMetre,
		P[10], P[14], screenEffects.sceneCopyReady ? 1 : 0, 0]));
	const encoder = device.createCommandEncoder({ label: 'rivers' });
	const pass = encoder.beginRenderPass({
		label: 'rivers',
		timestampWrites: profiler.timestamps('Rivers', 'vf_rivers'),
		colorAttachments: [{ view: frameTexture().createView(), loadOp: 'load', storeOp: 'store' }],
		depthStencilAttachment: { view: depthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
	});
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroupNow());
	const cx = settings.camPosX, cz = settings.camPosZ;
	for (const r of drawn) {
		pass.setVertexBuffer(0, r.buffer);
		riverStats.tiles++;
		// (the stretches near enough to see, drawn in runs)
		let from = -1, to = -1;
		for (const s of r.stretches) {
			const seen = Math.hypot(s.x - cx, s.z - cz) < s.seen;
			if (seen) riverStats.stretches++;
			if (seen && from >= 0 && s.first == to) { to = s.first + s.count; continue; }
			if (from >= 0) { pass.draw(to - from, 1, from, 0); riverStats.vertices += to - from; }
			from = seen ? s.first : -1;
			to = seen ? s.first + s.count : -1;
		}
		if (from >= 0) { pass.draw(to - from, 1, from, 0); riverStats.vertices += to - from; }
	}
	pass.end();
	device.queue.submit([encoder.finish()]);
}
