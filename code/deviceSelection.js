import { settings } from './settings.js';
import { renderSizeFor } from './display.js';
import { setLoadingStage } from './loading.js';

export const canvas = document.querySelector("canvas");

if (!navigator.gpu) 
{
	throw new Error("WebGPU not supported on this browser.");
}

//adapter options can be passed in for specific hardware feature requests
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) 
{
	throw new Error("No appropriate GPUAdapter found.");
}

//what the browser says about the GPU (vendor, architecture, description): the graphics presets start from a guess made from it (see graphicsPresets.js)
export const gpuInfo = adapter.info ?? {};
export const gpuIsFallback = !!(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter);

//timestamp queries: how the Performance window times each pass (see profiler.js). Not every browser and GPU has them
export const canTimestamp = adapter.features.has('timestamp-query');

//device options can be passed in for specific hardware feature requests
export const device = await adapter.requestDevice({
	requiredFeatures: canTimestamp ? ['timestamp-query'] : [],
});
setLoadingStage('Downloading the models', 0.15);	//(the loading screen: see loading.js. The models are what is fetched next)


export const context = canvas.getContext("webgpu");
//export const canvasFormat = navigator.gpu.getPreferredCanvasFormat();	//webgpu's suggestion for canvas type
export const canvasFormat = 'rgba8unorm';	//changed as screen space compute shaders came in, needed specific copy patern for now

context.configure({
	device: device,
	format: canvasFormat,
	usage: GPUTextureUsage.RENDER_ATTACHMENT 
			| GPUTextureUsage.COPY_SRC 
			| GPUTextureUsage.COPY_DST 
			| GPUTextureUsage.TEXTURE_BINDING	//not sure this one is necesary
			| GPUTextureUsage.STORAGE_BINDING
});

//----------------CANVAS-----------------------
// It covers the whole page (index.html); what it is drawn at is the Resolution setting, see display.js
const firstSize = renderSizeFor(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, settings.renderResolution);
canvas.width = firstSize[0];
canvas.height = firstSize[1];

/*
	THE FRAME: what the picture is drawn into, and how big (drawn). Usually the canvas itself, at its size. With a temporal anti-aliasing
	(temporalAA.js: TAA, FSR) it is drawn into a texture of its own (setOffscreenFrame), and what goes on the canvas is made from it and
	the frames before: at the same size, or with FSR's upscaling at the canvas's own bigger size (the output: setRenderSize).
	Everything that draws the picture draws into frameTexture() and sizes itself by drawn; the canvas's own size is only for what goes on
	it last (the anti-aliasing's result, the debug views)
*/
export const drawn = { width: canvas.width, height: canvas.height };
let offscreen = null, offscreenWanted = false;
export function frameTexture() { return offscreen ?? context.getCurrentTexture(); }
export const frameIsOffscreen = () => !!offscreen;
function makeOffscreen() {
	offscreen?.destroy();
	offscreen = offscreenWanted ? device.createTexture({ label: 'the frame (offscreen)', size: [drawn.width, drawn.height], format: canvasFormat,
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING }) : null;
}
// the frame drawn into a texture of its own (on), or straight on to the canvas. Only from the start of a frame (temporalAA.js)
export function setOffscreenFrame(on) {
	if (on === offscreenWanted) return;
	offscreenWanted = on;
	makeOffscreen();
}

// Whatever is drawn at the canvas's size has to be made again when the size changes: each of those registers what to do here.
//		Called with the new width and height, at the start of a frame, before anything is drawn (see setRenderSize)
const resizeListeners = [];
export function onRenderResize(listener) {
	resizeListeners.push(listener);
}

// changes the size the frame is drawn at, and the canvas's (the output: bigger only with an upscaling, see THE FRAME). Only from the
//		start of a frame (rotatingCube.js). The listeners are told the size it is drawn at
export function setRenderSize(width, height, outWidth = width, outHeight = height) {
	if (width === drawn.width && height === drawn.height && outWidth === canvas.width && outHeight === canvas.height) {
		return false;
	}
	canvas.width = outWidth;
	canvas.height = outHeight;
	const changed = width !== drawn.width || height !== drawn.height;
	drawn.width = width;
	drawn.height = height;
	if (offscreen && changed) makeOffscreen();
	for (const listener of resizeListeners) {
		listener(width, height);
	}
	return true;
}