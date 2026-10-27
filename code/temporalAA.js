import { device, canvas, context, drawn, frameTexture, setOffscreenFrame, onRenderResize } from './deviceSelection.js'
import * as profiler from './profiler.js'
import * as transformations from './transformations.js'
import { settings } from './settings.js';
import { DEPTH_FORMAT } from './depthMode.js'

import { vf_motion } from '../shaders/js/vf_motion.js'
import { c_taa } from '../shaders/js/c_taa.js'

/*
	THE TEMPORAL ANTI-ALIASING: the Anti-Aliasing settings that use the frames before as well as this one (MODES).
		TAA				c_taa.js: each frame blended into the history of the ones before
		TAA + FXAA		and FXAA (fxaa.js) over what comes out, for what TAA leaves
		FSR				AMD's FidelityFX Super Resolution 3's upscaler (fsr3.js): its Native AA at the size the canvas is, the
						others drawing at less (ratio) and making the canvas's size from it: Quality, Balanced, Performance
	What they need, from here:
		THE JITTER		every frame drawn shifted by a fraction of a pixel (transformations.js), along a Halton (2, 3) sequence of
						JITTER.taa points (FSR: JITTER.fsr times the upscaling squared, as AMD has it), so that the frames together
						see between the pixels
		THE FRAME		drawn into a texture of its own (deviceSelection.js), not the canvas: what goes on the canvas is made from it
		THE MOTION		where each pixel was the frame before (motionTexture: xy, as a share of the screen, y down; without the jitter).
						Cleared at the start of each frame; what moves of itself writes its own as it is drawn (a biplane, a boat, a
						horse, and the guns in the hands, which stay where they are on the screen: MOTION_FORMAT, its second
						target), and the rest is worked out from the depth and the camera of the frame before (vf_motion.js) at the end
	The history is let go of (RESET) when the setting changes, the size the frame is drawn at does, or the camera jumps further than
	JUMP metres in a frame.
*/
export const MODES = {
	'taa': { ratio: 1 },
	'taa+fxaa': { ratio: 1, fxaa: true },
	'fsr-native': { ratio: 1, fsr: true },
	'fsr-quality': { ratio: 1.5, fsr: true },
	'fsr-balanced': { ratio: 1.7, fsr: true },
	'fsr-performance': { ratio: 2.0, fsr: true },
};
const JITTER = { taa: 8, fsr: 8 };
const TAA = { now: 0.1, box: 1.25, moving: 0.006 };	// c_taa.js: how much of this frame goes in, the box's half width, more for every pixel it moved
const JUMP = 50;
export const MOTION_FORMAT = 'rgba16float';

const mode = () => MODES[settings.antiAliasing] ?? null;
export const temporalOn = () => !!mode();
export const fsrOn = () => !!mode()?.fsr;
export const fxaaAfter = () => !!mode()?.fxaa;
// the size to draw at for a canvas this size (out: [width, height])
export function drawnFor(out) {
	const r = mode()?.ratio ?? 1;
	return [Math.max(Math.round(out[0] / r), 1), Math.max(Math.round(out[1] / r), 1)];
}
export const temporalStats = { mode: null, jitter: [0, 0], resets: 0, frames: 0 };

// what the frame's own passes need of it
let motionTexture = null;
export function motionView() { return motionView.view; }
function makeMotion() {
	motionTexture?.destroy();
	motionTexture = device.createTexture({ label: 'the motion', size: [drawn.width, drawn.height], format: MOTION_FORMAT,
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
	motionView.view = motionTexture.createView();
}
makeMotion();
export const motionTextureNow = () => motionTexture;

// the history: two, one read and the other written, turn and turn about
let histories = [];
let which = 0;
function makeHistories() {
	for (const h of histories) h.destroy();
	histories = [0, 1].map((k) => device.createTexture({ label: `TAA history ${k}`, size: [drawn.width, drawn.height], format: 'rgba16float',
		usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }));
}
makeHistories();
let reset = true;
onRenderResize(() => { makeMotion(); makeHistories(); reset = true; resetListeners.forEach((fn) => fn()); });
const resetListeners = [];
// told when the history goes (fsr3.js: its own)
export function onReset(fn) { resetListeners.push(fn); }

// THE JITTER: the Halton sequence's k-th point in base b, 0 to 1
function halton(k, b) {
	let f = 1, r = 0;
	for (; k > 0; k = Math.floor(k / b)) { f /= b; r += f * (k % b); }
	return r;
}
let frameIndex = 0, wasMode = undefined;
export function jitterPhases() {
	const m = mode();
	return !m ? 1 : m.fsr ? Math.ceil(JITTER.fsr * m.ratio * m.ratio) : JITTER.taa;
}
// At the start of each frame, once its size is settled: drawn into a texture of its own or not, and this frame's jitter
export function beginFrame() {
	const m = mode();
	if (settings.antiAliasing !== wasMode) { wasMode = settings.antiAliasing; reset = true; resetListeners.forEach((fn) => fn()); }
	setOffscreenFrame(!!m);
	temporalStats.mode = m ? settings.antiAliasing : null;
	if (!m) { transformations.setJitter(0, 0); return; }
	frameIndex = frameIndex % jitterPhases() + 1;
	const j = [halton(frameIndex, 2) - 0.5, halton(frameIndex, 3) - 0.5];
	transformations.setJitter(j[0], j[1]);
	temporalStats.jitter = j;
}

// THE MOTION: the cameras of this frame and the one before, and the motion cleared, before anything is drawn
let viewProj = null, prevViewProj = null, camera = null, prevCamera = null;
export const viewProjsNow = () => ({ viewProj, prevViewProj });
export function cameraNow(encoder) {
	if (!temporalOn()) { prevViewProj = null; return; }
	viewProj = transformations.getViewProjUnjittered();
	camera = [settings.camPosX, settings.camPosY, settings.camPosZ];
	if (!prevViewProj || (prevCamera && Math.hypot(...camera.map((v, i) => v - prevCamera[i])) > JUMP * settings.forestUnitsPerMetre)) { reset = true; resetListeners.forEach((fn) => fn()); }
	prevViewProj ??= viewProj;
	encoder.beginRenderPass({ label: 'motion cleared', colorAttachments: [{ view: motionView(), loadOp: 'clear', clearValue: [0, 0, 0, 0], storeOp: 'store' }] }).end();
}
// the previous frame's view projection (without the jitter) for whatever draws its own motion (as cameraNow has it)
export const prevViewProjNow = () => prevViewProj ?? transformations.getViewProjUnjittered();
export const viewProjNow = () => viewProj ?? transformations.getViewProjUnjittered();

// the rest of the motion, from the depth (vf_motion.js): only where nothing has been written (its alpha), by the blending
const motionModule = device.createShaderModule({ label: 'vf_motion', code: vf_motion });
const motionPipeline = device.createRenderPipeline({
	label: 'motion pipeline',
	layout: 'auto',
	vertex: { module: motionModule, entryPoint: 'vertexMain' },
	fragment: { module: motionModule, entryPoint: 'fragmentMain', targets: [{ format: MOTION_FORMAT, blend: {
		color: { srcFactor: 'one-minus-dst-alpha', dstFactor: 'one', operation: 'add' },
		alpha: { srcFactor: 'one-minus-dst-alpha', dstFactor: 'one', operation: 'add' },
	} }] },
	primitive: { topology: 'triangle-list' },
});
const motionUniforms = device.createBuffer({ label: 'motion Uniform', size: 64 * 3 + 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
let motionBindGroup = null, motionBoundTo = null;
function motionPass(encoder, depthTexture) {
	const u = new Float32Array(52);
	u.set(transformations.getInvViewProj(), 0);
	u.set(prevViewProj, 16);
	u.set(viewProj, 32);
	u.set([drawn.width, drawn.height, 1 / drawn.width, 1 / drawn.height], 48);
	device.queue.writeBuffer(motionUniforms, 0, u);
	if (motionBoundTo !== depthTexture) {
		motionBoundTo = depthTexture;
		motionBindGroup = device.createBindGroup({ label: 'motion bind group', layout: motionPipeline.getBindGroupLayout(0), entries: [
			{ binding: 0, resource: { buffer: motionUniforms } },
			{ binding: 1, resource: depthTexture.createView() },
		] });
	}
	const pass = encoder.beginRenderPass({ colorAttachments: [{ view: motionView(), loadOp: 'load', storeOp: 'store' }], timestampWrites: profiler.timestamps('Motion', 'vf_motion') });
	pass.setPipeline(motionPipeline);
	pass.setBindGroup(0, motionBindGroup);
	pass.draw(3);
	pass.end();
}

// TAA (c_taa.js)
const taaModule = device.createShaderModule({ label: 'c_taa', code: c_taa });
const taaPipeline = device.createComputePipeline({ label: 'taa pipeline', layout: 'auto', compute: { module: taaModule, entryPoint: 'computeMain' } });
const taaUniforms = device.createBuffer({ label: 'taa Uniform', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const linearSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
function taaPass(encoder, depthTexture) {
	device.queue.writeBuffer(taaUniforms, 0, new Float32Array([drawn.width, drawn.height, 1 / drawn.width, 1 / drawn.height, reset ? 1 : 0, TAA.now, TAA.box, TAA.moving]));
	const bindGroup = device.createBindGroup({ label: 'taa bind group', layout: taaPipeline.getBindGroupLayout(0), entries: [
		{ binding: 0, resource: { buffer: taaUniforms } },
		{ binding: 1, resource: frameTexture().createView() },
		{ binding: 2, resource: histories[which].createView() },
		{ binding: 3, resource: motionView() },
		{ binding: 4, resource: depthTexture.createView() },
		{ binding: 5, resource: linearSampler },
		{ binding: 6, resource: histories[1 - which].createView() },
		{ binding: 7, resource: context.getCurrentTexture().createView() },
	] });
	const pass = encoder.beginComputePass({ timestampWrites: profiler.timestamps('TAA', 'c_taa') });
	pass.setPipeline(taaPipeline);
	pass.setBindGroup(0, bindGroup);
	pass.dispatchWorkgroups(Math.ceil(drawn.width / 8), Math.ceil(drawn.height / 8));
	pass.end();
	which = 1 - which;
}

// FSR (fsr3.js) says how it is done here, as it loads
let fsrUpscale = null;
export function setFsr(fn) { fsrUpscale = fn; }

// At the end of the frame, once everything is drawn: the rest of the motion, and what goes on the canvas made from the frame and
//		the history (TAA) or by FSR. Then this frame's camera is the one before
export function resolve(encoder, depthTexture) {
	if (!temporalOn() || !viewProj) return;
	motionPass(encoder, depthTexture);
	if (fsrOn() && fsrUpscale) fsrUpscale(encoder, { color: frameTexture(), depth: depthTexture, motion: motionTexture, output: context.getCurrentTexture(), reset, jitter: transformations.jitterNow(), phases: jitterPhases() });
	else taaPass(encoder, depthTexture);
	reset = false;
	prevViewProj = viewProj;
	prevCamera = camera;
	temporalStats.frames++;
}
