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
export const canvasFormat = navigator.gpu.getPreferredCanvasFormat();	//webgpu's suggestion for canvas type
context.configure({
	device: device,
	format: canvasFormat,	//format is the texture format that should be used
});