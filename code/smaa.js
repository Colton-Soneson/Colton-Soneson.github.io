import {device} from './deviceSelection.js'
import { drawn } from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {onRenderResize} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { vf_smaaEdges, vf_smaaWeights, vf_smaaBlend } from '../shaders/js/vf_smaa.js'

/*
	SMAA: anti-aliasing over the finished frame. See vf_smaa.js for how it works.

	Like the FXAA pass it is the last thing done to the picture (only the debug views go over it afterwards), and only one
	of the two runs: whichever the Anti-Aliasing setting names. The frame is copied, then
		edges		the copy is searched for edges, into edgeTexture
		weights		the edges are followed to their ends, into weightTexture
		blend		and the copy is drawn back over the frame, each pixel mixed with its neighbours by the weights
*/

const edgeShaderModule = device.createShaderModule({ label: "vf_smaaEdges", code: vf_smaaEdges });
const weightShaderModule = device.createShaderModule({ label: "vf_smaaWeights", code: vf_smaaWeights });
const blendShaderModule = device.createShaderModule({ label: "vf_smaaBlend", code: vf_smaaBlend });

const smaaUniformBuffer = device.createBuffer({
  label: "smaa Uniform",
  size: 16,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// The three textures and the bind groups that read them are at the canvas's size, and made again when that changes (see display.js)
let frameCopyTexture, edgeTexture, weightTexture, frameCopyView, edgeView, weightView;
let edgeBindGroup, weightBindGroup, blendBindGroup;
function makeSizedTextures() {
	for (const texture of [frameCopyTexture, edgeTexture, weightTexture]) {
		if (texture) texture.destroy();
	}

	// the copy of the frame the shaders read
	frameCopyTexture = device.createTexture({
		label: "smaa copy of the frame",
		size: [drawn.width, drawn.height],
		format: canvasFormat,
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	});

	// r: an edge along the left side of the pixel, g: along its top
	edgeTexture = device.createTexture({
		label: "smaa edges",
		size: [drawn.width, drawn.height],
		format: 'rg8unorm',
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
	});

	// how much each pixel is to be mixed with the ones across its top and left edges
	weightTexture = device.createTexture({
		label: "smaa blend weights",
		size: [drawn.width, drawn.height],
		format: 'rgba8unorm',
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
	});

	frameCopyView = frameCopyTexture.createView();
	edgeView = edgeTexture.createView();
	weightView = weightTexture.createView();
}
makeSizedTextures();

//linear sampling: reading between two pixels is what does the blending
const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

function createScreenPipeline(label, shaderModule, format) {
	return device.createRenderPipeline({
		label: label,
		layout: 'auto',
		vertex: {
			module: shaderModule,
			entryPoint: "vertexMain",
		},
		fragment: {
			module: shaderModule,
			entryPoint: "fragmentMain",
			targets: [{
			format: format
			}]
		},
		primitive: {
			topology: 'triangle-list',
		},
	});
}

const edgePipeline = createScreenPipeline("smaa edge pipeline", edgeShaderModule, 'rg8unorm');
const weightPipeline = createScreenPipeline("smaa weight pipeline", weightShaderModule, 'rgba8unorm');
const blendPipeline = createScreenPipeline("smaa blend pipeline", blendShaderModule, canvasFormat);

function makeBindGroups() {
	edgeBindGroup = device.createBindGroup({
		label: "smaa edge bind group",
		layout: edgePipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: smaaUniformBuffer } },
			{ binding: 1, resource: frameCopyView },
		]
	});

	weightBindGroup = device.createBindGroup({
		label: "smaa weight bind group",
		layout: weightPipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 1, resource: edgeView },
		]
	});

	blendBindGroup = device.createBindGroup({
		label: "smaa blend bind group",
		layout: blendPipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: smaaUniformBuffer } },
			{ binding: 1, resource: frameCopyView },
			{ binding: 2, resource: linSampler },
			{ binding: 3, resource: weightView },
		]
	});
}
makeBindGroups();
onRenderResize(() => {
	makeSizedTextures();
	makeBindGroups();
});

// one triangle over the whole of a texture, through one of the three shaders. name and shader: for the Performance window
function screenPass(aEncoder, view, clear, pipeline, bindGroup, name, shader) {
	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{
		view: view,
		loadOp: clear ? "clear" : "load",
		clearValue: { r: 0, g: 0, b: 0, a: 0 },
		storeOp: "store",
		}],
		timestampWrites: profiler.timestamps(name, shader),
	});
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup);
	pass.draw(3, 1, 0, 0);
	pass.end();
}

export function smaaPass(aEncoder, canvasTexture) {

	if (settings.antiAliasing != "smaa") {
		return;
	}

	const uniforms = new Float32Array([1 / drawn.width, 1 / drawn.height, settings.smaaEdgeThreshold, 0]);
	device.queue.writeBuffer(smaaUniformBuffer, 0, uniforms.buffer, uniforms.byteOffset, uniforms.byteLength);

	aEncoder.copyTextureToTexture({ texture: canvasTexture }, { texture: frameCopyTexture }, [drawn.width, drawn.height]);

	screenPass(aEncoder, edgeView, true, edgePipeline, edgeBindGroup, 'SMAA Edges', 'vf_smaaEdges');
	screenPass(aEncoder, weightView, true, weightPipeline, weightBindGroup, 'SMAA Weights', 'vf_smaaWeights');
	screenPass(aEncoder, canvasTexture.createView(), false, blendPipeline, blendBindGroup, 'SMAA Blend', 'vf_smaaBlend');
}
