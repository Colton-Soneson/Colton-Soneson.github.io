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

//device options can be passed in for specific hardware feature requests
export const device = await adapter.requestDevice();


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
const devicePixelRatio = window.devicePixelRatio;
canvas.width = canvas.clientWidth * devicePixelRatio;
canvas.height = canvas.clientHeight * devicePixelRatio;