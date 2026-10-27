// Screen space shadows, after "Screen Space Shadows" by Graham Aldridge, Bend Studio (Days Gone):
//		https://www.bendstudio.com/blog/inside-bend-screen-space-shadows/
//
// c_SSS below and buildDispatchList (in SSS.js) are a port to WGSL and JavaScript of the example code published with that talk,
// bend_sss_gpu.h and bend_sss_cpu.h, which carry this notice:
//
//		Copyright 2023 Sony Interactive Entertainment.
//
//		Licensed under the Apache License, Version 2.0 (the "License");
//		you may not use this file except in compliance with the License.
//		You may obtain a copy of the License at
//
//		    http://www.apache.org/licenses/LICENSE-2.0
//
//		Unless required by applicable law or agreed to in writing, software
//		distributed under the License is distributed on an "AS IS" BASIS,
//		WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//		See the License for the specific language governing permissions and
//		limitations under the License.
//
// Changes from the original: translated from HLSL and C++, the depth texture is read texel by texel instead of through a
// border sampler, the early out by wave intrinsics and the debug views are left out, the depth buffer here runs from 0 (near)
// to 1 (far), and only the mode with BilinearSamplingOffsetMode off is kept.

export const SSS_WAVE_SIZE = 64;			// threads in a wavefront: the workgroup is this many by 1 by 1
export const SSS_SAMPLE_COUNT = 60;			// shadow samples for every pixel, which is also how long a shadow can get, in pixels
export const SSS_HARD_SHADOW_SAMPLES = 4;	// the first samples next to the pixel: any one of these can shadow it completely on its own
export const SSS_FADE_OUT_SAMPLES = 8;		// the last samples: these count for less and less, so a shadow does not stop dead at its far end
const READ_COUNT = Math.floor(SSS_SAMPLE_COUNT / SSS_WAVE_SIZE) + 2;	// depth readings every thread takes along its ray

/*
	THE IDEA
		A shadow map cannot hold the small things: a pebble, a root, the lip of a ledge half a mile off. But the depth texture
		the frame has just drawn does hold them, so the shadow is found there instead: from every pixel, walk across the screen
		towards the light, and if something along the way stands nearer to the light's line than the pixel does, the pixel is
		in its shadow.

		Done pixel by pixel that is 60 depth reads each. The trick of this method is that every pixel on one line towards the
		light walks over the same pixels as the others on that line. So the screen is cut into lines running to the light (the
		wavefronts, one workgroup each, 64 pixels to a workgroup), every thread reads the depth at a couple of places on its
		line and puts them in memory the whole workgroup shares, and then every thread finds its shadow from that shared list
		without reading the texture again. 4 reads a pixel instead of 60.

		The depths in the shared list are divided by how far along the line they are from the light. In those terms every ray
		of light is level, so "is this sample in the way" is just "is its number close to mine".
*/
import { DEPTH_NEAR, DEPTH_FAR, skyTest } from './depthShapes.js';

export const c_SSS =
`
	struct ShadowUniforms
	{
		lightCoordinate : vec4f,	// xy: where the light is on the screen, in pixels (it can be far off it). z: its depth. w: 1.0 if it is in front of the camera, -1.0 behind
		waveOffset : vec2i,			// where this dispatch's first wavefront is, from the light, in pixels
		size : vec2f,				// the size of the depth texture
		surfaceThickness : f32,		// how thick whatever is in a pixel is taken to be, as a share of the depth between it and the far plane
		bilinearThreshold : f32,	// two depths that differ by more than this share are an edge, and are not blended
		shadowContrast : f32,		// how sharply a pixel goes from lit to shadowed
		ignoreEdgePixels : f32,		// 1.0: a pixel on an edge casts no shadow
	}
	@group(0) @binding(0) var<uniform> SU: ShadowUniforms;

	@group(0) @binding(1) var depthTexture: texture_depth_2d;
	@group(0) @binding(2) var shadowOut: texture_storage_2d<r32float, write>;	// 1.0 lit, 0.0 shadowed

	const WAVE_SIZE: i32 = ${SSS_WAVE_SIZE};
	const SAMPLE_COUNT: i32 = ${SSS_SAMPLE_COUNT};
	const HARD_SHADOW_SAMPLES: i32 = ${SSS_HARD_SHADOW_SAMPLES};
	const FADE_OUT_SAMPLES: i32 = ${SSS_FADE_OUT_SAMPLES};
	const READ_COUNT: i32 = ${READ_COUNT};

	const NEAR_DEPTH: f32 = ${DEPTH_NEAR};	// what the depth texture holds at the near plane (depthMode.js: reversed-Z or not)
	const FAR_DEPTH: f32 = ${DEPTH_FAR};		// and at the far plane, or where nothing was drawn

	// the list the threads of a workgroup share: the depths along their line, already divided by distance from the light
	var<workgroup> depthData: array<f32, ${READ_COUNT * SSS_WAVE_SIZE}>;

	// the depth at a pixel. Off the screen there is nothing, which is as far away as it gets, so nothing out there casts a shadow in
	fn depthAt(pixel: vec2f) -> f32 {
		let p = vec2i(floor(pixel));
		if (p.x < 0 || p.y < 0 || p.x >= i32(SU.size.x) || p.y >= i32(SU.size.y)) {
			return FAR_DEPTH;
		}
		return textureLoad(depthTexture, p, 0);
	}

	@compute @workgroup_size(${SSS_WAVE_SIZE}, 1, 1)
	fn computeMain(@builtin(workgroup_id) groupID: vec3u, @builtin(local_invocation_id) localID: vec3u) {
		let threadID = localID.x;

		//------------------WHERE THIS THREAD'S PIXEL IS-----------------
		// (ComputeWavefrontExtents) the workgroup is one stretch, 64 pixels long, of a line running in to the light
		var xy = vec2i(groupID.yz) * WAVE_SIZE + SU.waveOffset;

		// the light's pixel, and how far into that pixel the light really is
		let lightXY = floor(SU.lightCoordinate.xy) + 0.5;
		let lightFraction = SU.lightCoordinate.xy - lightXY;
		let reverseDirection = SU.lightCoordinate.w > 0.0;

		let signXY = sign(xy);
		let horizontal = abs(xy.x + signXY.y) < abs(xy.y - signXY.x);
		let axis = vec2i(select(0, signXY.y, horizontal), select(-signXY.x, 0, horizontal));

		// which wavefront of the dispatch this is
		xy = axis * i32(groupID.x) + xy;
		let xyFloat = vec2f(xy);

		// the line is followed along whichever of x and y it covers more of
		let xAxisMajor = abs(xyFloat.x) > abs(xyFloat.y);
		let majorAxis = select(xyFloat.y, xyFloat.x, xAxisMajor);

		let majorAxisStart = abs(majorAxis);
		let majorAxisEnd = abs(majorAxis) - f32(WAVE_SIZE);

		var majorLightFraction = select(lightFraction.y, lightFraction.x, xAxisMajor);
		majorLightFraction = select(majorLightFraction, -majorLightFraction, majorAxis > 0.0);

		// back to places on the screen
		let startXY = xyFloat + lightXY;
		// (for the innermost ring this has to come out on a pixel's center, so going from places to pixels skips none)
		let endXY = mix(SU.lightCoordinate.xy, startXY, (majorAxisEnd + majorLightFraction) / (majorAxisStart + majorLightFraction));

		// one whole wavefront's worth of the line
		let xyDelta = startXY - endXY;

		// the threads are read in the other order when the light is behind the camera
		let threadStep = f32(threadID ^ select(u32(WAVE_SIZE - 1), 0u, reverseDirection));

		var pixelXY = mix(startXY, endXY, threadStep / f32(WAVE_SIZE));
		let pixelDistance = majorAxisStart - threadStep + majorLightFraction;

		//------------------READ THE DEPTHS-----------------
		var samplingDepth: array<f32, READ_COUNT>;
		var shadowingDepth: array<f32, READ_COUNT>;
		var depthThicknessScale: array<f32, READ_COUNT>;
		var sampleDistance: array<f32, READ_COUNT>;

		let direction = -SU.lightCoordinate.w;
		let zSign = select(1.0, -1.0, NEAR_DEPTH > FAR_DEPTH);

		let writeXY = vec2i(floor(pixelXY));

		for (var i = 0; i < READ_COUNT; i++) {
			// two depths for every place on the line, blended unless there is an edge between them.
			//		Only across the line: along it, the places are on pixel centers already
			let readXY = floor(pixelXY);
			let minorAxis = select(pixelXY.x, pixelXY.y, xAxisMajor);
			let bilinear = fract(minorAxis) - 0.5;
			let bias = select(-1.0, 1.0, bilinear > 0.0);
			let offsetXY = vec2f(select(bias, 0.0, xAxisMajor), select(0.0, bias, xAxisMajor));

			let depthHere = depthAt(readXY);
			let depthBeside = depthAt(readXY + offsetXY);

			// the thresholds are shares of the depth left between the sample and the far plane
			depthThicknessScale[i] = abs(FAR_DEPTH - depthHere);

			// too different to be the same surface: an edge
			let usePointFilter = abs(depthHere - depthBeside) > depthThicknessScale[i] * SU.bilinearThreshold;

			// the pixel starts from this depth
			samplingDepth[i] = depthHere;

			// but anything on this wavefront may be standing part way to the neighbour, so the shadow is cast from a little
			//		further away, by the difference between the two
			let edgeDepth = select(depthHere, 1e20, SU.ignoreEdgePixels > 0.5);
			let shadowDepth = depthHere + abs(depthHere - depthBeside) * zSign;
			shadowingDepth[i] = select(shadowDepth, edgeDepth, usePointFilter);

			sampleDistance[i] = pixelDistance + f32(WAVE_SIZE * i) * direction;

			// on to the next place along the line, a whole wavefront further
			pixelXY += xyDelta * direction;
		}

		//------------------SHARE THEM-----------------
		for (var i = 0; i < READ_COUNT; i++) {
			// divided by the distance from the light: in these terms every ray of light is level
			var storedDepth = (shadowingDepth[i] - SU.lightCoordinate.z) / sampleDistance[i];
			if (i != 0) {
				// close in to the light the further readings can go past it. Those are not in the way of anything
				storedDepth = select(1e10, storedDepth, sampleDistance[i] > 0.0);
			}
			depthData[i * WAVE_SIZE + i32(threadID)] = storedDepth;
		}

		// every thread waits here until the whole list is written
		workgroupBarrier();

		// nothing drawn at this pixel (the sky): nothing to shadow, and the texture is already cleared to lit
		if (${skyTest('samplingDepth[0]')}) {
			return;
		}

		//------------------FIND THE SHADOW-----------------
		var startDepth = (samplingDepth[0] - SU.lightCoordinate.z) / sampleDistance[0];

		// from the sample after this thread's own
		let sampleIndex = i32(threadID) + 1;

		var shadowValue = vec4f(1.0, 1.0, 1.0, 1.0);
		var hardShadow = 1.0;

		// The depths are scaled so that the window a sample has to fall in to shadow the pixel is 1 wide:
		//		times sampleDistance to undo the division above, over the thickness the setting asks for (as a share of the
		//		depth left to the far plane), and never narrower than a minimum right next to the light
		let depthScale = min(sampleDistance[0] + direction, 1.0 / SU.surfaceThickness) * sampleDistance[0] / depthThicknessScale[0];

		startDepth = startDepth * depthScale - zSign;

		// the first few: one sample is enough to shadow the pixel, which is what plants things on the ground
		for (var i = 0; i < HARD_SHADOW_SAMPLES; i++) {
			let depthDelta = abs(startDepth - depthData[sampleIndex + i] * depthScale);
			hardShadow = min(hardShadow, depthDelta);
		}

		// the bulk of them go 4 ways, and the 4 are averaged at the end: one pixel of noise in the depth cannot shadow a pixel by itself
		for (var i = HARD_SHADOW_SAMPLES; i < SAMPLE_COUNT - FADE_OUT_SAMPLES; i++) {
			let depthDelta = abs(startDepth - depthData[sampleIndex + i] * depthScale);
			shadowValue[i & 3] = min(shadowValue[i & 3], depthDelta);
		}

		// and the last ones fade out
		for (var i = SAMPLE_COUNT - FADE_OUT_SAMPLES; i < SAMPLE_COUNT; i++) {
			let depthDelta = abs(startDepth - depthData[sampleIndex + i] * depthScale);
			let fadeOut = f32(i + 1 - (SAMPLE_COUNT - FADE_OUT_SAMPLES)) / f32(FADE_OUT_SAMPLES + 1) * 0.75;
			shadowValue[i & 3] = min(shadowValue[i & 3], depthDelta + fadeOut);
		}

		// 0 is a sample dead level with the pixel. The contrast lets ones that are nearly level count as shadow too
		shadowValue = saturate(shadowValue * SU.shadowContrast + (1.0 - SU.shadowContrast));
		hardShadow = saturate(hardShadow * SU.shadowContrast + (1.0 - SU.shadowContrast));

		let result = min(hardShadow, dot(shadowValue, vec4f(0.25, 0.25, 0.25, 0.25)));

		// (a pixel off the texture is not written: storing outside a texture does nothing)
		textureStore(shadowOut, writeXY, vec4f(result, 0.0, 0.0, 1.0));
	}
`;
