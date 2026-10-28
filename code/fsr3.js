import { device, canvas, drawn } from './deviceSelection.js'
import * as profiler from './profiler.js'
import * as transformations from './transformations.js'
import { settings } from './settings.js';
import * as temporalAA from './temporalAA.js'

import { c_fsr3 } from '../shaders/js/c_fsr3.js'

/*
	FSR 3: AMD FidelityFX Super Resolution 3.1's upscaler (c_fsr3.js, ported from AMD's FidelityFX SDK). The Anti-Aliasing settings
	FSR 3 Native AA, Quality, Balanced and Performance (temporalAA.js: MODES); everything it needs of the frame is from there (the
	jitter, the frame drawn into a texture of its own, the motion). What AMD's host side does each frame (ffx_fsr3upscaler.cpp,
	fsr3upscalerDispatch) is done here, in the same order:
		prepare inputs			the motion and depth dilated (the nearest of each 3 x 3), the depth of the frame before put back where it
								was (reconstructed), the farthest depth in metres, this frame's luma
		farthest depth mip		its average over each 2 x 2 (what the luma pyramid gives that is used)
		shading change			how the luma changed since the frame before, at half size and two mips under it, and from them how much
		prepare reactivity		what is newly seen (disocclusion), how long each pixel has been building up (accumulation), and thin
								features worth holding on to (new locks)
		luma instability		pixels that flicker between frames, from the last 4 frames' luma
		accumulate				the frame upsampled (Lanczos), the history read where it was, kept honest, and blended in, at the
								canvas's size
		RCAS					sharpened (SHARPNESS: AMD's 0 to 1), on to the canvas
	The history (the upscaled frame, the luma history, the accumulation) is two of each, read one and write the other, turned and turned
	about each frame (k). It all goes when the size drawn at, or the canvas's, changes; and starts again (frame index 0) on temporalAA.js's
	reset.
*/
const SHARPNESS = 0.8;

const shaderModule = device.createShaderModule({ label: 'c_fsr3', code: c_fsr3 });
const PASSES = ['prepareInputs', 'farthestMip', 'shadingMip0', 'downsample', 'shadingChangePass', 'prepareReactivity', 'lumaInstabilityPass', 'accumulate', 'rcas'];
const pipelines = Object.fromEntries(PASSES.map((entry) => [entry, device.createComputePipeline({ label: `fsr3 ${entry}`, layout: 'auto', compute: { module: shaderModule, entryPoint: entry } })]));
const uniforms = device.createBuffer({ label: 'fsr3 Uniform', size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const linearClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

// its textures and buffers, for a size drawn at (R) and a canvas's (U)
let made = null;
function make(R, U) {
	if (made) for (const r of made.all) r.destroy();
	const H = [Math.max(Math.floor(R[0] / 2), 1), Math.max(Math.floor(R[1] / 2), 1)];
	const all = [];
	const texture = (label, size, format, { mips = 1, clearable = false } = {}) => {
		const t = device.createTexture({ label: `fsr3 ${label}`, size, format, mipLevelCount: mips,
			usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | (clearable ? GPUTextureUsage.RENDER_ATTACHMENT : 0) });
		all.push(t);
		return t;
	};
	const buffer = (label, bytes) => { const b = device.createBuffer({ label: `fsr3 ${label}`, size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }); all.push(b); return b; };
	const two = (label, size, format, options) => [0, 1].map((k) => texture(`${label} ${k}`, size, format, options));
	made = {
		R, U, H, all,
		dilatedMotion: texture('dilated motion', R, 'rgba16float'),
		dilatedDepth: texture('dilated depth', R, 'r32float'),
		farthestDepth: texture('farthest depth', R, 'r32float'),
		farthestMip1: texture('farthest depth mip 1', H, 'rgba16float'),
		spd: texture('shading change pyramid', H, 'rgba16float', { mips: 3 }),
		shadingChange: texture('shading change', H, 'rgba16float'),
		masks: texture('dilated reactive masks', R, 'rgba8unorm'),
		lumaInstability: texture('luma instability', R, 'rgba16float'),
		luma: two('luma', R, 'rgba16float'),
		lumaHistory: two('luma history', R, 'rgba16float'),
		accumulation: two('accumulation', R, 'rgba8unorm', { clearable: true }),
		upscaled: two('upscaled', U, 'rgba16float'),
		recon: buffer('reconstructed previous nearest depth', R[0] * R[1] * 4),
		newLocks: buffer('new locks', U[0] * U[1] * 4),
	};
	made.spdViews = [0, 1, 2].map((mip) => made.spd.createView({ baseMipLevel: mip, mipLevelCount: 1 }));
}

let k = 0, frameIndex = 0, previousJitter = [0, 0];
export const fsrStats = { frames: 0, made: 0, R: null, U: null };

function bind(entry, resources) {
	return device.createBindGroup({ label: `fsr3 ${entry}`, layout: pipelines[entry].getBindGroupLayout(0),
		entries: Object.entries(resources).map(([binding, resource]) => ({ binding: Number(binding), resource: resource.createView ? resource.createView() : resource instanceof GPUBuffer ? { buffer: resource } : resource })) });
}
const groups = (R) => [Math.ceil(R[0] / 8), Math.ceil(R[1] / 8)];

// what temporalAA.js asks for once everything is drawn: color (the frame), depth, motion, output (the canvas's texture)
function upscale(encoder, { color, depth, motion, output, reset, jitter, phases }) {
	const R = [drawn.width, drawn.height], U = [canvas.width, canvas.height];
	if (!made || made.R.join() !== R.join() || made.U.join() !== U.join()) { make(R, U); reset = true; fsrStats.made++; fsrStats.R = R; fsrStats.U = U; }
	const M = made, a = k, b = 1 - k;
	frameIndex = reset ? 0 : frameIndex + 1;
	// the constants (the projection's own numbers turn a depth back into a distance, in either depth mode: GetViewSpaceDepth)
	const P = transformations.unjitteredProjection;
	device.queue.writeBuffer(uniforms, 0, new Float32Array([
		R[0], R[1], U[0], U[1],
		jitter[0], jitter[1], previousJitter[0], previousJitter[1],
		-P[10], P[14], 1 / P[0], 1 / P[5],
		frameIndex, phases, 1 / settings.forestUnitsPerMetre, Math.pow(2, -(2 - 2 * SHARPNESS)),
	]));
	previousJitter = [...jitter];
	// (starting again: no accumulation; and every frame the depth of the frame before is reconstructed afresh)
	if (reset) encoder.beginRenderPass({ label: 'fsr3 accumulation cleared', colorAttachments: [{ view: M.accumulation[a].createView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] }).end();
	encoder.clearBuffer(M.recon);

	const motionTexture = motion, colorTexture = color;
	const steps = [
		['prepareInputs', { 0: { buffer: uniforms }, 2: depth.createView(), 3: motionTexture, 4: colorTexture, 5: M.dilatedMotion, 7: M.dilatedDepth, 9: M.farthestDepth, 11: M.luma[a], 14: M.recon }, groups(R)],
		['farthestMip', { 0: { buffer: uniforms }, 10: M.farthestDepth, 16: M.farthestMip1 }, groups(M.H)],
		['shadingMip0', { 0: { buffer: uniforms }, 6: M.dilatedMotion, 12: M.luma[a], 13: M.luma[b], 18: M.spdViews[0] }, groups(M.H)],
		['downsample', { 18: M.spdViews[1], 19: M.spdViews[0] }, groups(M.H.map((v) => Math.max(v >> 1, 1)))],
		['downsample', { 18: M.spdViews[2], 19: M.spdViews[1] }, groups(M.H.map((v) => Math.max(v >> 2, 1)))],
		['shadingChangePass', { 0: { buffer: uniforms }, 1: linearClamp, 20: M.spd, 21: M.shadingChange }, groups(M.H)],
		['prepareReactivity', { 0: { buffer: uniforms }, 1: linearClamp, 3: motionTexture, 6: M.dilatedMotion, 8: M.dilatedDepth, 12: M.luma[a], 15: M.recon, 22: M.shadingChange, 23: M.masks, 25: M.accumulation[b], 26: M.accumulation[a], 27: M.newLocks }, groups(R)],
		['lumaInstabilityPass', { 0: { buffer: uniforms }, 1: linearClamp, 6: M.dilatedMotion, 12: M.luma[a], 24: M.masks, 28: M.lumaHistory[b], 29: M.lumaHistory[a], 30: M.lumaInstability }, groups(R)],
		['accumulate', { 0: { buffer: uniforms }, 1: linearClamp, 4: colorTexture, 6: M.dilatedMotion, 17: M.farthestMip1, 24: M.masks, 27: M.newLocks, 31: M.lumaInstability, 32: M.upscaled[b], 33: M.upscaled[a] }, groups(U)],
		['rcas', { 0: { buffer: uniforms }, 33: M.upscaled[b], 34: output }, groups(U)],
	];
	const pass = encoder.beginComputePass({ label: 'fsr3', timestampWrites: profiler.timestamps('FSR 3', 'c_fsr3') });
	for (const [entry, resources, count] of steps) {
		pass.setPipeline(pipelines[entry]);
		pass.setBindGroup(0, bind(entry, resources));
		pass.dispatchWorkgroups(count[0], count[1]);
	}
	pass.end();
	k = b;
	fsrStats.frames++;
}
temporalAA.setFsr(upscale);
