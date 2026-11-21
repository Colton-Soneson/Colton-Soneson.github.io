import { device } from './deviceSelection.js';
import { settings } from './settings.js';
import * as profiler from './profiler.js';
import { SUN_CASCADES, SUN_SHADOW_SIZE, SUN_SHADOW_BINDINGS, SUN_SHADOW_FLOATS } from '../shaders/js/sunShadowShapes.js';

/*
	THE SUN'S SHADOWS (shaders/js/sunShadowShapes.js reads them). Three shadow maps of what stands round the camera, as the sun sees it,
	each a square on the ground CASCADE_METRES across from its middle to its edge, the middle a little ahead of the camera (so more of
	each is in front of it than behind): the trees (forest.js) and the bushes (flora.js) drawn into them from the sun's side, the
	nearest depth kept. The land, the grass, the plants and the trees then look themselves up in them to see if the sun gets to them.
		following the camera	each map's square moves with the camera, in steps of whole texels of its own, so the edges of the
								shadows hold still and do not crawl as it moves
		the far ones less often	the near and the middle maps are drawn again every 2nd frame, on alternate frames, the far one every 4th (EVERY):
								further off a shadow moves too little in a frame to be missed
		who casts				whatever has called addSunShadowCaster: fn(pass, cascade, matrix), drawing itself into the pass with the
								matrix as its view projection. What it draws from can be the frame before's (the forest's lists are
								made later in the frame): a frame behind is nothing anyone can see
	Off (settings.enableSunShadows), or with the sun under the horizon, every map is empty and sunShadow is 1 everywhere.
	The near map is the one the near trees need to be in: forest.js keeps every tree within KEEP_NEAR of the camera in its lists, in
	view or not, so one behind the camera still throws its shadow forwards (keepRadius).
*/
export const CASCADE_METRES = [60, 250, 1000];
const EVERY = [2, 2, 4];
const DEPTH = 2400;				// world units the maps' depth reaches either way from the camera's height along the sun's rays
const AHEAD = 0.35;				// of a map's half width, how far ahead of the camera its middle is
const KEEP_NEAR = 1.3;			// of the near map's half width: the trees kept in the forest's lists for it (keepRadius)

const metre = () => settings.forestUnitsPerMetre;
export const sunShadowTexture = device.createTexture({
	label: 'sun shadow maps',
	size: [SUN_SHADOW_SIZE, SUN_SHADOW_SIZE, SUN_CASCADES],
	format: 'depth32float',
	usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});
export const sunShadowView = sunShadowTexture.createView({ dimension: '2d-array' });
const layerViews = Array.from({ length: SUN_CASCADES }, (_, k) => sunShadowTexture.createView({ dimension: '2d', baseArrayLayer: k, arrayLayerCount: 1 }));
// (for whoever draws into the maps with the same bind group as they are read with: a map cannot be drawn into and read at once)
const noShadowTexture = device.createTexture({ label: 'sun shadow maps none', size: [1, 1, 1], format: 'depth32float', usage: GPUTextureUsage.TEXTURE_BINDING });
export const noSunShadowView = noShadowTexture.createView({ dimension: '2d-array' });
export const sunShadowSampler = device.createSampler({ label: 'sun shadow sampler', compare: 'less', minFilter: 'linear', magFilter: 'linear' });
export const sunShadowUniformBuffer = device.createBuffer({ label: 'sun shadow uniforms', size: SUN_SHADOW_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

// the three bind group layout entries, and the three entries of a bind group (drawing: the maps left out, see noSunShadowView)
export const sunShadowLayoutEntries = (visibility) => [
	{ binding: SUN_SHADOW_BINDINGS[0], visibility, buffer: {} },
	{ binding: SUN_SHADOW_BINDINGS[1], visibility, texture: { sampleType: 'depth', viewDimension: '2d-array' } },
	{ binding: SUN_SHADOW_BINDINGS[2], visibility, sampler: { type: 'comparison' } },
];
export const sunShadowEntries = (drawing = false) => [
	{ binding: SUN_SHADOW_BINDINGS[0], resource: { buffer: sunShadowUniformBuffer } },
	{ binding: SUN_SHADOW_BINDINGS[1], resource: drawing ? noSunShadowView : sunShadowView },
	{ binding: SUN_SHADOW_BINDINGS[2], resource: sunShadowSampler },
];

const casters = [];
export function addSunShadowCaster(fn) { casters.push(fn); }
// how far from the camera (world units) a tree has to be kept in the forest's lists, in view or not (0: no shadows)
export const keepRadius = () => sunShadowsOn ? CASCADE_METRES[0] * KEEP_NEAR * metre() : 0;
export const sunShadowStats = { on: false, drawn: [0, 0, 0] };

let sunShadowsOn = false;
let frame = 0;
const matrices = Array.from({ length: SUN_CASCADES }, () => new Float32Array(16));
const made = new Array(SUN_CASCADES).fill(false);

// A map's matrix: looking down the sun's rays at its middle, its square snapped to whole texels
function cascadeMatrix(k, sun) {
	const R = CASCADE_METRES[k] * metre();
	const f = [-sun[0], -sun[1], -sun[2]];		// the way the light goes
	const helper = Math.abs(f[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
	const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
	const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
	const r = norm(cross(f, helper)), u = cross(r, f);
	const yaw = settings.camYaw;
	let c = [settings.camPosX + Math.sin(yaw) * R * AHEAD, settings.camPosY, settings.camPosZ - Math.cos(yaw) * R * AHEAD];
	const texel = 2 * R / SUN_SHADOW_SIZE;
	const snap = (axis) => { const along = dot(c, axis); const to = Math.round(along / texel) * texel; c = c.map((v, i) => v + axis[i] * (to - along)); };
	snap(r); snap(u);
	const m = matrices[k];
	m.set([r[0] / R, u[0] / R, f[0] / (2 * DEPTH), 0, r[1] / R, u[1] / R, f[1] / (2 * DEPTH), 0, r[2] / R, u[2] / R, f[2] / (2 * DEPTH), 0,
		-dot(c, r) / R, -dot(c, u) / R, (DEPTH - dot(c, f)) / (2 * DEPTH), 1]);
	return texel;
}

const texels = [0, 0, 0];
// Early in the frame, before anything that reads them is drawn
export function sunShadowPass(encoder) {
	frame++;
	const length = Math.hypot(settings.sunPosX, settings.sunPosY, settings.sunPosZ) || 1;
	const sun = [settings.sunPosX / length, settings.sunPosY / length, settings.sunPosZ / length];
	sunShadowsOn = settings.enableSunShadows !== false && sun[1] > 0.03 && casters.length > 0;
	sunShadowStats.on = sunShadowsOn;
	if (!sunShadowsOn) {
		made.fill(false);
		device.queue.writeBuffer(sunShadowUniformBuffer, 0, new Float32Array(SUN_SHADOW_FLOATS));
		return;
	}
	for (let k = 0; k < SUN_CASCADES; k++) {
		if (made[k] && frame % EVERY[k] != k % EVERY[k]) continue;
		texels[k] = cascadeMatrix(k, sun);
		made[k] = true;
		const pass = encoder.beginRenderPass({
			label: `sun shadow map ${k}`,
			colorAttachments: [],
			depthStencilAttachment: { view: layerViews[k], depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store' },
			timestampWrites: profiler.timestamps(`Sun Shadows ${k}`, 'sun shadow map'),
		});
		for (const cast of casters) cast(pass, k, matrices[k]);
		pass.end();
	}
	const values = new Float32Array(SUN_SHADOW_FLOATS);
	matrices.forEach((m, k) => values.set(m, k * 16));
	values.set([texels[0], texels[1], texels[2], 1, ...sun, 0], SUN_CASCADES * 16);
	device.queue.writeBuffer(sunShadowUniformBuffer, 0, values);
}
