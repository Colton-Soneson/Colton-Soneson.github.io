import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {onRenderResize} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { settings } from './settings.js';

import { c_SSS } from '../shaders/js/c_SSS.js'
import { SSS_WAVE_SIZE } from '../shaders/js/c_SSS.js'

import * as transformations from './transformations.js'

/*
	Screen space shadows: the sun's shadows found in the depth texture of the frame itself. See the top of c_SSS.js for how,
	and where it comes from (Bend Studio's method from Days Gone, ported from the example code they published).

	This side works out which lines of the screen need doing (buildDispatchList), runs the compute shader over them, and keeps the
	result: screenShadowTexture, one number for every pixel, 1.0 lit to 0.0 shadowed. screenEffects.js is what puts it on the picture.
*/

const sssShaderModule = device.createShaderModule({
  label: "c_SSS",
  code: c_SSS
});

// 1.0 lit, 0.0 shadowed. It is cleared to lit every frame (which is why it can be drawn to), then the compute shader writes the pixels it visits
//		(at the canvas's size, and made again when that changes: see display.js)
export let screenShadowTexture;
let screenShadowView;
function makeScreenShadowTexture() {
	if (screenShadowTexture) screenShadowTexture.destroy();
	screenShadowTexture = device.createTexture({
		label: "screen space shadow",
		size: [canvas.width, canvas.height],
		format: 'r32float',
		usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
	});
	screenShadowView = screenShadowTexture.createView();
}
makeScreenShadowTexture();
onRenderResize(makeScreenShadowTexture);

// one block of uniforms for each dispatch (they only differ in where their wavefronts start), picked out with a dynamic offset
const MAX_DISPATCHES = 8;
const DISPATCH_STRIDE = 256;
const sssUniformBuffer = device.createBuffer({
  label: "SSS Uniform",
  size: MAX_DISPATCHES * DISPATCH_STRIDE,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// Layouts
//-------------------------------------------------
const bindGroupLayout = device.createBindGroupLayout({
  label: "SSS Bind Group Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,
    buffer: { hasDynamicOffset: true, minBindingSize: 48 }
  },
  {
    binding: 1,								//the frame's depth
    visibility: GPUShaderStage.COMPUTE,
    texture: { sampleType: 'depth' }
  },
  {
    binding: 2,								//the shadow
    visibility: GPUShaderStage.COMPUTE,
    storageTexture: { access: 'write-only', format: 'r32float' }
  }
  ]
});

const sssPipeline = device.createComputePipeline({
  label: "SSS pipeline",
  layout: device.createPipelineLayout({
	label: "SSS Pipeline Layout",
	bindGroupLayouts: [ bindGroupLayout ],
  }),
  compute: {
    module: sssShaderModule,
    entryPoint: "computeMain",
  }
});

/*
	Which compute dispatches it takes to cover the screen with wavefronts, for a light at some place on (or off) the screen.
	A port of BuildDispatchList in bend_sss_cpu.h (see the notice at the top of c_SSS.js).

	The screen is taken as 4 quarters around the light, each a rectangle with one corner on it, and a quarter that is not
	square is cut in two along its longer side. So a light off the screen takes 1 or 2 dispatches and a light on it 4 to 6.

		lightProjection		the light as a vertex shader would put it out: viewProjection * (direction, 0) for the sun
		viewportSize		width and height of the depth texture
	Returns { lightCoordinate: [x, y, z, w], dispatches: [{ waveCount: [x, y, z], waveOffset: [x, y] }] }
*/
export function buildDispatchList(lightProjection, viewportSize, waveSize = SSS_WAVE_SIZE) {
	const whole = Math.trunc;	// the original is in whole numbers, which round towards 0

	// a light very far off the screen runs out of floating point precision in the shader, so w is kept away from 0
	let xyLightW = lightProjection[3];
	const precisionLimit = 0.000002 * waveSize;
	if (xyLightW >= 0 && xyLightW < precisionLimit) xyLightW = precisionLimit;
	else if (xyLightW < 0 && xyLightW > -precisionLimit) xyLightW = -precisionLimit;

	const lightCoordinate = [
		((lightProjection[0] / xyLightW) * 0.5 + 0.5) * viewportSize[0],
		((lightProjection[1] / xyLightW) * -0.5 + 0.5) * viewportSize[1],
		lightProjection[3] == 0 ? 0 : lightProjection[2] / lightProjection[3],
		lightProjection[3] > 0 ? 1 : -1,
	];
	const lightXY = [whole(lightCoordinate[0] + 0.5), whole(lightCoordinate[1] + 0.5)];

	// the screen's edges, measured from the light (y up)
	const minBounds = [0, 0], maxBounds = [viewportSize[0], viewportSize[1]];
	const biasedBounds = [
		minBounds[0] - lightXY[0],
		-(maxBounds[1] - lightXY[1]),
		maxBounds[0] - lightXY[0],
		-(minBounds[1] - lightXY[1]),
	];

	const dispatches = [];
	for (let q = 0; q < 4; q++) {
		// quarters 0 and 3 need 1 more wavefront up and down, 1 and 2 need it side to side
		const vertical = q == 0 || q == 3;

		// the edges of this quarter, in wavefronts
		const bounds = [
			whole(Math.max(0, (q & 1) ? biasedBounds[0] : -biasedBounds[2]) / waveSize),
			whole(Math.max(0, (q & 2) ? biasedBounds[1] : -biasedBounds[3]) / waveSize),
			whole(Math.max(0, ((q & 1) ? biasedBounds[2] : -biasedBounds[0]) + waveSize * (vertical ? 1 : 2) - 1) / waveSize),
			whole(Math.max(0, ((q & 2) ? biasedBounds[3] : -biasedBounds[1]) + waveSize * (vertical ? 2 : 1) - 1) / waveSize),
		];

		if ((bounds[2] - bounds[0]) > 0 && (bounds[3] - bounds[1]) > 0) {
			const biasX = (q == 2 || q == 3) ? 1 : 0;
			const biasY = (q == 1 || q == 3) ? 1 : 0;

			let disp = {
				waveCount: [waveSize, bounds[2] - bounds[0], bounds[3] - bounds[1]],
				waveOffset: [((q & 1) ? bounds[0] : -bounds[2]) + biasX, ((q & 2) ? -bounds[3] : bounds[1]) + biasY],
			};
			dispatches.push(disp);

			// where the diagonal from the light meets the edge of the quarter: past that the lines run the other way, so the quarter is cut there
			let axisDelta = biasedBounds[0] - biasedBounds[1];
			if (q == 1) axisDelta = biasedBounds[2] + biasedBounds[1];
			if (q == 2) axisDelta = -biasedBounds[0] - biasedBounds[3];
			if (q == 3) axisDelta = -biasedBounds[2] + biasedBounds[3];

			axisDelta = whole((axisDelta + waveSize - 1) / waveSize);

			if (axisDelta > 0) {
				let disp2 = { waveCount: [...disp.waveCount], waveOffset: [...disp.waveOffset] };
				dispatches.push(disp2);

				if (q == 0) {
					// cut along y, the cut off piece is 1 wider
					disp2.waveCount[2] = Math.min(disp.waveCount[2], axisDelta);
					disp.waveCount[2] -= disp2.waveCount[2];
					disp2.waveOffset[1] = disp.waveOffset[1] + disp.waveCount[2];
					disp2.waveOffset[0]--;
					disp2.waveCount[1]++;
				}
				if (q == 1) {
					// cut along x, the cut off piece is 1 taller
					disp2.waveCount[1] = Math.min(disp.waveCount[1], axisDelta);
					disp.waveCount[1] -= disp2.waveCount[1];
					disp2.waveOffset[0] = disp.waveOffset[0] + disp.waveCount[1];
					disp2.waveCount[2]++;
				}
				if (q == 2) {
					disp2.waveCount[1] = Math.min(disp.waveCount[1], axisDelta);
					disp.waveCount[1] -= disp2.waveCount[1];
					disp.waveOffset[0] += disp2.waveCount[1];
					disp2.waveCount[2]++;
					disp2.waveOffset[1]--;
				}
				if (q == 3) {
					disp2.waveCount[2] = Math.min(disp.waveCount[2], axisDelta);
					disp.waveCount[2] -= disp2.waveCount[2];
					disp.waveOffset[1] += disp2.waveCount[2];
					disp2.waveCount[1]++;
				}

				// a piece with nothing left in it is dropped
				if (disp2.waveCount[1] <= 0 || disp2.waveCount[2] <= 0) {
					dispatches.splice(dispatches.indexOf(disp2), 1);
				}
				if (disp.waveCount[1] <= 0 || disp.waveCount[2] <= 0) {
					dispatches.splice(dispatches.indexOf(disp), 1);
				}
			}
		}
	}

	// the shader wants the offsets in pixels
	for (const disp of dispatches) {
		disp.waveOffset[0] *= waveSize;
		disp.waveOffset[1] *= waveSize;
	}

	return { lightCoordinate: lightCoordinate, dispatches: dispatches };
}

// viewProjection * (x, y, z, w), column major like the rest of the matrices here
function transform(m, v) {
	return [
		m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
		m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
		m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
		m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
	];
}

// Finds the shadows of a light for this frame. lightDirection: towards the light, any length. depthTexture: what the frame has drawn so far.
//		With no light direction the texture is only cleared: everything lit
export function screenShadowPass(aEncoder, depthTexture, lightDirection) {

	// cleared to lit: the compute shader leaves alone what it has nothing to say about (the sky, a strip at the edge)
	const clearPass = aEncoder.beginRenderPass({
		colorAttachments: [{
			view: screenShadowView,
			loadOp: "clear",
			clearValue: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
			storeOp: "store",
		}],
		timestampWrites: profiler.timestamps('Shadow Clear', null),
	});
	clearPass.end();

	if (!lightDirection) {
		return;
	}

	const length = Math.hypot(lightDirection[0], lightDirection[1], lightDirection[2]);
	const lightProjection = transform(transformations.getViewProj(), [lightDirection[0] / length, lightDirection[1] / length, lightDirection[2] / length, 0]);
	const list = buildDispatchList(lightProjection, [canvas.width, canvas.height]);

	list.dispatches.slice(0, MAX_DISPATCHES).forEach((disp, i) => {
		const block = new ArrayBuffer(48);
		const floats = new Float32Array(block), ints = new Int32Array(block);
		floats.set(list.lightCoordinate, 0);
		ints[4] = disp.waveOffset[0];
		ints[5] = disp.waveOffset[1];
		floats[6] = canvas.width;
		floats[7] = canvas.height;
		floats[8] = settings.screenShadowThickness;
		floats[9] = settings.screenShadowThickness * 4;		// the edge threshold goes with the thickness (0.02 at the suggested 0.005)
		floats[10] = settings.screenShadowContrast;
		floats[11] = 0;
		device.queue.writeBuffer(sssUniformBuffer, i * DISPATCH_STRIDE, block);
	});

	const bindGroup = device.createBindGroup({
		label: "SSS bind group",
		layout: bindGroupLayout,
		entries: [
		{
			binding: 0,
			resource: { buffer: sssUniformBuffer, size: 48 }
		},
		{
			binding: 1,
			resource: depthTexture.createView()
		},
		{
			binding: 2,
			resource: screenShadowView
		}
		],
	});

	const computePass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Screen Shadows', 'c_SSS') });
	computePass.setPipeline(sssPipeline);
	list.dispatches.slice(0, MAX_DISPATCHES).forEach((disp, i) => {
		computePass.setBindGroup(0, bindGroup, [i * DISPATCH_STRIDE]);
		computePass.dispatchWorkgroups(disp.waveCount[0], disp.waveCount[1], disp.waveCount[2]);
	});
	computePass.end();
}
