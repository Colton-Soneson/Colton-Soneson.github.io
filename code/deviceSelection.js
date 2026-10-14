import { settings } from './settings.js';
import { renderSizeFor } from './display.js';

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

// Whatever is drawn at the canvas's size has to be made again when the size changes: each of those registers what to do here.
//		Called with the new width and height, at the start of a frame, before anything is drawn (see setRenderSize)
const resizeListeners = [];
export function onRenderResize(listener) {
	resizeListeners.push(listener);
}

// changes the size the frame is drawn at. Only from the start of a frame (rotatingCube.js)
export function setRenderSize(width, height) {
	if (width === canvas.width && height === canvas.height) {
		return false;
	}
	canvas.width = width;
	canvas.height = height;
	for (const listener of resizeListeners) {
		listener(width, height);
	}
	return true;
}