import { device, drawn, onRenderResize, canvasFormat } from './deviceSelection.js'
import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';
import * as profiler from './profiler.js'
import * as transformations from './transformations.js'
import { settings } from './settings.js';
import { vf_painterly } from '../shaders/js/vf_painterly.js'

/*
	PAINTERLY (settings.painterly, at the top of the controls): a filter over the whole finished picture, as a game's screen filters
	are, that paints it over as a hand painted animated film's backgrounds are: see vf_painterly.js for how. The last thing done to the picture, after the
	anti-aliasing (only the debug views and the page's own controls go over it): the frame is copied, and the copy drawn back over
	it through the shader, as FXAA does (fxaa.js).
	BRUSH WIDTH (settings.painterlyBrushWidth): how wide its strokes are, BRUSH pixels times it on a screen 1080 pixels high (as wide
	for the screen whatever its size), wider near the camera and narrower far off (the shader: THE STROKE).
*/
const BRUSH = 5;
const ORIGIN = 4096;		// world units: the world in cells this big, the camera's place given in its own (the shader's daubs, held to the world, are
						//		worked out about it: small numbers, exact enough), and which cell it is (so a daub is the same one whichever)

const shaderModule = device.createShaderModule({ label: "vf_painterly", code: vf_painterly });
const uniformBuffer = device.createBuffer({ label: "painterly uniform", size: 160, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const makeFrameCopy = () => device.createTexture({
	label: "painterly copy of the frame",
	size: [drawn.width, drawn.height],
	format: canvasFormat,
	usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
let frameCopy = makeFrameCopy();
onRenderResize(() => { frameCopy.destroy(); frameCopy = makeFrameCopy(); });
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
const pipeline = device.createRenderPipeline({
	label: "painterly pipeline",
	layout: 'auto',
	vertex: { module: shaderModule, entryPoint: "vertexMain" },
	fragment: { module: shaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list' },
});

export function painterlyPass(aEncoder, canvasTexture, depthTexture) {
	if (!settings.painterly) return;
	const P = transformations.projectionMatrix;
	const width = BRUSH * Math.max(settings.painterlyBrushWidth ?? 1, 0.1) * drawn.height / 1080;
	// (the screen back to the world about the camera: the view turned but not moved, and the projection without the jitter)
	const view = mat4.clone(transformations.getViewMatrix());
	view[12] = view[13] = view[14] = 0;
	const inverse = mat4.inverse(mat4.mul(transformations.unjitteredProjection ?? P, view));
	const cam = [settings.camPosX, settings.camPosY, settings.camPosZ], cell = cam.map((v) => Math.floor(v / ORIGIN));
	const right = transformations.getCameraRight(), f = transformations.getCameraForward();
	const up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
	const u = new Float32Array([1 / drawn.width, 1 / drawn.height, drawn.width, drawn.height, width, P[10], P[14], settings.forestUnitsPerMetre,
		...inverse, ...cam.map((v, i) => v - cell[i] * ORIGIN), transformations.pixelSize(), ...cell, ORIGIN, ...right, 0, ...up, 0]);
	device.queue.writeBuffer(uniformBuffer, 0, u.buffer, u.byteOffset, u.byteLength);
	aEncoder.copyTextureToTexture({ texture: canvasTexture }, { texture: frameCopy }, [drawn.width, drawn.height]);
	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{ view: canvasTexture.createView(), loadOp: "load", storeOp: "store" }],
		timestampWrites: profiler.timestamps('Painterly', 'vf_painterly'),
	});
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, device.createBindGroup({
		label: "painterly bind group",
		layout: pipeline.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: uniformBuffer } },
			{ binding: 1, resource: frameCopy.createView() },
			{ binding: 2, resource: linSampler },
			{ binding: 3, resource: depthTexture.createView() },
		],
	}));
	pass.draw(3, 1, 0, 0);
	pass.end();
}
