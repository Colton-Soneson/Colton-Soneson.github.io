import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { settings } from './settings.js';

import { vf_fxaa } from '../shaders/js/vf_fxaa.js'

/*
	Anti-aliasing over the finished frame. See vf_fxaa.js for how it works.

	It is the last thing done to the picture (only the debug views go over it afterwards): the frame is copied, and the
	copy is drawn back over the frame through the shader.
*/

const fxaaShaderModule = device.createShaderModule({
  label: "vf_fxaa",
  code: vf_fxaa
});

const fxaaUniformBuffer = device.createBuffer({
  label: "fxaa Uniform",
  size: 16,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// the copy of the frame the shader reads
const frameCopyTexture = device.createTexture({
	label: "fxaa copy of the frame",
	size: [canvas.width, canvas.height],
	format: canvasFormat,
	usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});

//linear sampling: reading between two pixels is what does the blending
const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

const fxaaPipeline = device.createRenderPipeline({
	label: "fxaa pipeline",
	layout: 'auto',
	vertex: {
		module: fxaaShaderModule,
		entryPoint: "vertexMain",
	},
	fragment: {
		module: fxaaShaderModule,
		entryPoint: "fragmentMain",
		targets: [{
		format: canvasFormat
		}]
	},
	primitive: {
		topology: 'triangle-list',
	},
});

const fxaaBindGroup = device.createBindGroup({
	label: "fxaa bind group",
	layout: fxaaPipeline.getBindGroupLayout(0),
	entries: [
	{
		binding: 0,
		resource: { buffer: fxaaUniformBuffer }
	},
	{
		binding: 1,
		resource: frameCopyTexture.createView()
	},
	{
		binding: 2,
		resource: linSampler
	}
	]
});

export function fxaaPass(aEncoder, canvasTexture) {

	if (!settings.enableFXAA) {
		return;
	}

	const uniforms = new Float32Array([1 / canvas.width, 1 / canvas.height, settings.fxaaSubpixel, settings.fxaaEdgeThreshold]);
	device.queue.writeBuffer(fxaaUniformBuffer, 0, uniforms.buffer, uniforms.byteOffset, uniforms.byteLength);

	aEncoder.copyTextureToTexture({ texture: canvasTexture }, { texture: frameCopyTexture }, [canvas.width, canvas.height]);

	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{
		view: canvasTexture.createView(),
		loadOp: "load",
		storeOp: "store",
		}],
	});

	pass.setPipeline(fxaaPipeline);
	pass.setBindGroup(0, fxaaBindGroup);
	pass.draw(3, 1, 0, 0);	// one triangle over the whole screen

	pass.end();
}
