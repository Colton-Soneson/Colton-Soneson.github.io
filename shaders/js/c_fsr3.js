import { reversedDepth } from '../../code/depthMode.js';

/*
	FSR 3: AMD FidelityFX Super Resolution 3.1's upscaler, ported to WGSL from AMD's own shaders (the FidelityFX SDK, v1.1.4:
	sdk/include/FidelityFX/gpu/fsr3upscaler/, and RCAS from gpu/fsr1/ffx_fsr1.h). Run by fsr3.js. The algorithm is AMD's, pass for
	pass and constant for constant; what is different is only what WebGPU has and has not:
		the reconstructed depth of the frame before		a storage buffer, atomicMax (WebGPU has no atomics on textures): each
														depth kept as nearer-is-bigger (reversed-Z as it is, the usual depth as 1
														less it), so one clear to 0 and one atomicMax do for both
		the new locks									a storage buffer (read and written in one pass)
		the luma pyramid								(SPD, one pass with a global atomic and globally coherent writes, which WebGPU
														cannot promise): only what of it is used here, the farthest depth at half size
														(farthestMip1); the scene's average luma and auto exposure are for HDR input,
														and this frame is already tone mapped (exposure 1)
		the shading change pyramid						SPD's first three mips made one dispatch each (shadingMip0, downsample twice)
		textures read with a linear sampler				rgba16float or rgba8unorm (r16float and r8unorm cannot be written as storage)
	The reactive mask is the motion's z (motionShapes.js: the propeller's blur, the puffs), and no transparency and composition mask is given, and the motion is in UV already (scale 1),
	without the jitter (no jitter cancellation). The motion vectors are at the size the frame is drawn at (LOW_RESOLUTION_MOTION_VECTORS).

	Copyright (C) 2024 Advanced Micro Devices, Inc.

	Permission is hereby granted, free of charge, to any person obtaining a copy
	of this software and associated documentation files(the "Software"), to deal
	in the Software without restriction, including without limitation the rights
	to use, copy, modify, merge, publish, distribute, sublicense, and /or sell
	copies of the Software, and to permit persons to whom the Software is
	furnished to do so, subject to the following conditions :

	The above copyright notice and this permission notice shall be included in
	all copies or substantial portions of the Software.

	THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
	IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
	FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
	AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
	LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
	OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
	THE SOFTWARE.
*/
export const c_fsr3 =
`
	struct FsrConstants
	{
		sizes : vec4f,		// render size xy, upscale size zw
		jitters : vec4f,	// this frame's jitter xy, the frame before's zw (render pixels)
		toView : vec4f,		// deviceToViewDepth (ffx_fsr3upscaler.cpp: setupDeviceDepthToViewSpaceDepthParams)
		more : vec4f,		// x: frame index, y: jitter sequence length, z: view space units to metres, w: RCAS sharpness (linear)
	}
	@group(0) @binding(0) var<uniform> FC: FsrConstants;
	@group(0) @binding(1) var linearClamp: sampler;

	// the inputs
	@group(0) @binding(2) var inputDepth: texture_depth_2d;
	@group(0) @binding(3) var inputMotion: texture_2d<f32>;
	@group(0) @binding(4) var inputColor: texture_2d<f32>;
	// written in one pass, read in later ones
	@group(0) @binding(5) var dilatedMotionOut: texture_storage_2d<rgba16float, write>;
	@group(0) @binding(6) var dilatedMotion: texture_2d<f32>;
	@group(0) @binding(7) var dilatedDepthOut: texture_storage_2d<r32float, write>;
	@group(0) @binding(8) var dilatedDepth: texture_2d<f32>;
	@group(0) @binding(9) var farthestDepthOut: texture_storage_2d<r32float, write>;
	@group(0) @binding(10) var farthestDepth: texture_2d<f32>;
	@group(0) @binding(11) var currentLumaOut: texture_storage_2d<rgba16float, write>;
	@group(0) @binding(12) var currentLuma: texture_2d<f32>;
	@group(0) @binding(13) var previousLuma: texture_2d<f32>;
	@group(0) @binding(14) var<storage, read_write> reconDepthOut: array<atomic<u32>>;
	@group(0) @binding(15) var<storage, read> reconDepth: array<u32>;
	@group(0) @binding(16) var farthestMip1Out: texture_storage_2d<rgba16float, write>;
	@group(0) @binding(17) var farthestMip1: texture_2d<f32>;
	@group(0) @binding(18) var spdMipOut: texture_storage_2d<rgba16float, write>;
	@group(0) @binding(19) var spdMipIn: texture_2d<f32>;
	@group(0) @binding(20) var spdMips: texture_2d<f32>;
	@group(0) @binding(21) var shadingChangeOut: texture_storage_2d<rgba16float, write>;
	@group(0) @binding(22) var shadingChange: texture_2d<f32>;
	@group(0) @binding(23) var reactiveMasksOut: texture_storage_2d<rgba8unorm, write>;
	@group(0) @binding(24) var reactiveMasks: texture_2d<f32>;
	@group(0) @binding(25) var accumulationOut: texture_storage_2d<rgba8unorm, write>;
	@group(0) @binding(26) var accumulation: texture_2d<f32>;
	@group(0) @binding(27) var<storage, read_write> newLocks: array<f32>;
	@group(0) @binding(28) var lumaHistoryOut: texture_storage_2d<rgba16float, write>;
	@group(0) @binding(29) var lumaHistory: texture_2d<f32>;
	@group(0) @binding(30) var lumaInstabilityOut: texture_storage_2d<rgba16float, write>;
	@group(0) @binding(31) var lumaInstability: texture_2d<f32>;
	@group(0) @binding(32) var upscaledOut: texture_storage_2d<rgba16float, write>;
	@group(0) @binding(33) var upscaled: texture_2d<f32>;
	@group(0) @binding(34) var output: texture_storage_2d<rgba8unorm, write>;

	// ffx_fsr3upscaler_common.h
	const FP16_MIN: f32 = 6.10e-05;
	const FP16_MAX: f32 = 65504.0;
	const EPSILON: f32 = 6.10e-05;
	const FP32_MIN: f32 = 1.175494351e-38;
	const FP32_MAX: f32 = 3.402823466e+38;
	const RECONSTRUCTED_DEPTH_BILINEAR_WEIGHT_THRESHOLD: f32 = 6.10e-04;
	const UPSAMPLE_LANCZOS_WEIGHT_SCALE: f32 = 1.0 / 16.0;
	const AVERAGE_LANCZOS_WEIGHT_PER_FRAME: f32 = 0.74 / 16.0;
	const LOCK_THRESHOLD: f32 = 1.0;
	const LOCK_MAX: f32 = 2.0;
	const ACCUMULATION_ADDED_PER_FRAME: f32 = 1.0 / 3.0;
	const MIN_DISOCCLUSION_ACCUMULATION: f32 = -1.0 / 3.0;
	const VELOCITY_FACTOR: f32 = 1.0;
	const INVERTED_DEPTH: bool = ${reversedDepth};

	fn RenderSize() -> vec2i { return vec2i(FC.sizes.xy); }
	fn UpscaleSize() -> vec2i { return vec2i(FC.sizes.zw); }
	fn ShadingChangeRenderSize() -> vec2i { return max(vec2i(FC.sizes.xy * 0.5), vec2i(1)); }
	fn Jitter() -> vec2f { return FC.jitters.xy; }
	fn PreviousFrameJitter() -> vec2f { return FC.jitters.zw; }
	fn DownscaleFactor() -> vec2f { return FC.sizes.xy / FC.sizes.zw; }
	fn FrameIndex() -> f32 { return FC.more.x; }
	fn JitterSequenceLength() -> f32 { return FC.more.y; }

	fn ReconstructedDepthMvPxThreshold(nearestDepthInMeters: f32) -> f32 {
		return mix(0.25, 0.75, saturate(nearestDepthInMeters / 100.0));
	}
	fn Get4KVelocity(motionVector: vec2f) -> f32 {
		return length(motionVector * vec2f(3840.0, 2160.0));
	}
	fn MinDividedByMax(v0: f32, v1: f32, onZero: f32) -> f32 {
		let m = max(v0, v1);
		return select(onZero, min(v0, v1) / m, m != 0.0);
	}
	fn YCoCgToRGB(c: vec3f) -> vec3f {
		return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
	}
	fn RGBToYCoCg(c: vec3f) -> vec3f {
		return vec3f(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
	}
	fn RGBToLuma(c: vec3f) -> f32 {
		return dot(c, vec3f(0.2126, 0.7152, 0.0722));
	}
	fn IsUvInside(uv: vec2f) -> bool {
		return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
	}
	fn ClampLoad(p: vec2i, offset: vec2i, size: vec2i) -> vec2i {
		return clamp(p + offset, vec2i(0), size - 1);
	}
	fn ClampUv(uv: vec2f, textureSize: vec2i, resourceSize: vec2i) -> vec2f {
		let at = clamp(uv * vec2f(textureSize), vec2f(0.5), vec2f(textureSize) - vec2f(0.5));
		return at / vec2f(resourceSize);
	}
	fn IsOnScreen(p: vec2i, size: vec2i) -> bool {
		return all(p >= vec2i(0)) && all(p < size);
	}
	fn ComputeHrPosFromLrPos(p: vec2i) -> vec2i {
		let jittered = vec2f(p) + 0.5 - Jitter();
		return vec2i(floor(jittered / FC.sizes.xy * FC.sizes.zw));
	}
	fn GetViewSpaceDepth(deviceDepth: f32) -> f32 {
		return FC.toView.y / (deviceDepth - FC.toView.x);
	}
	fn GetViewSpaceDepthInMeters(deviceDepth: f32) -> f32 {
		return GetViewSpaceDepth(deviceDepth) * FC.more.z;
	}
	// (the depth of the frame before, as kept: nearer is bigger)
	fn LoadReconstructedPrevDepth(p: vec2i) -> f32 {
		let kept = bitcast<f32>(reconDepth[p.y * RenderSize().x + p.x]);
		return select(1.0 - kept, kept, INVERTED_DEPTH);
	}
	fn LoadInputDepth(p: vec2i) -> f32 {
		return textureLoad(inputDepth, clamp(p, vec2i(0), RenderSize() - 1), 0);
	}

	// ffx_fsr3upscaler_prepare_inputs.h
	fn StoreReconstructedDepth(p: vec2i, depth: f32) {
		let kept = select(1.0 - depth, depth, INVERTED_DEPTH);
		atomicMax(&reconDepthOut[p.y * RenderSize().x + p.x], bitcast<u32>(kept));
	}
	fn ReconstructPrevDepth(p: vec2i, depth: f32, motionVectorIn: vec2f) {
		let nearestDepthInMeters = min(GetViewSpaceDepthInMeters(depth), FP16_MAX);
		let threshold = ReconstructedDepthMvPxThreshold(nearestDepthInMeters);
		let motionVector = motionVectorIn * f32(Get4KVelocity(motionVectorIn) > threshold);
		let uv = (vec2f(p) + 0.5) / FC.sizes.xy;
		let reprojected = uv + motionVector;
		let at = reprojected * FC.sizes.xy - 0.5;
		let base = vec2i(floor(at));
		let f = fract(at);
		let weights = array<f32, 4>((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
		let offsets = array<vec2i, 4>(vec2i(0, 0), vec2i(1, 0), vec2i(0, 1), vec2i(1, 1));
		for (var k = 0; k < 4; k++) {
			if (weights[k] > RECONSTRUCTED_DEPTH_BILINEAR_WEIGHT_THRESHOLD) {
				let to = base + offsets[k];
				if (IsOnScreen(to, RenderSize())) {
					StoreReconstructedDepth(to, depth);
				}
			}
		}
	}
	@compute @workgroup_size(8, 8)
	fn prepareInputs(@builtin(global_invocation_id) id: vec3u) {
		let p = vec2i(id.xy);
		if (!IsOnScreen(p, RenderSize())) { return; }
		// the depth extents of the 3 x 3
		let offsets = array<vec2i, 9>(vec2i(0, 0), vec2i(1, 0), vec2i(0, 1), vec2i(0, -1), vec2i(-1, 0), vec2i(-1, 1), vec2i(1, 1), vec2i(-1, -1), vec2i(1, -1));
		var nearest = LoadInputDepth(p);
		var farthest = nearest;
		var nearestCoord = p;
		for (var k = 1; k < 9; k++) {
			let q = p + offsets[k];
			if (IsOnScreen(q, RenderSize()) && textureLoad(inputMotion, q, 0).z < 0.5) {
				let d = LoadInputDepth(q);
				if ((INVERTED_DEPTH && d > nearest) || (!INVERTED_DEPTH && d < nearest)) {
					farthest = select(max(farthest, d), min(farthest, d), INVERTED_DEPTH);
					nearestCoord = q;
					nearest = d;
				}
			}
		}
		let motion = textureLoad(inputMotion, nearestCoord, 0).xy;
		ReconstructPrevDepth(p, nearest, motion);
		textureStore(dilatedMotionOut, p, vec4f(motion, 0.0, 0.0));
		textureStore(dilatedDepthOut, p, vec4f(nearest, 0.0, 0.0, 0.0));
		textureStore(farthestDepthOut, p, vec4f(min(GetViewSpaceDepthInMeters(farthest), FP16_MAX), 0.0, 0.0, 0.0));
		let rgb = max(vec3f(0.0), textureLoad(inputColor, p, 0).rgb);
		textureStore(currentLumaOut, p, vec4f(RGBToLuma(rgb), 0.0, 0.0, 0.0));
	}

	// ffx_fsr3upscaler_luma_pyramid.h (what of it is used: the farthest depth's first mip, the average of each 2 x 2)
	@compute @workgroup_size(8, 8)
	fn farthestMip(@builtin(global_invocation_id) id: vec3u) {
		let p = vec2i(id.xy);
		let size = vec2i(textureDimensions(farthestMip1Out));
		if (!IsOnScreen(p, size)) { return; }
		var sum = 0.0;
		for (var k = 0; k < 4; k++) {
			sum += textureLoad(farthestDepth, ClampLoad(p * 2, vec2i(k % 2, k / 2), RenderSize()), 0).r;
		}
		textureStore(farthestMip1Out, p, vec4f(sum * 0.25, 0.0, 0.0, 0.0));
	}

	// ffx_fsr3upscaler_shading_change_pyramid.h
	fn SortSet(s: ptr<function, array<f32, 5>>) {
		let pairs = array<vec2i, 9>(vec2i(0, 3), vec2i(1, 4), vec2i(0, 2), vec2i(1, 3), vec2i(0, 1), vec2i(2, 4), vec2i(1, 2), vec2i(3, 4), vec2i(2, 3));
		for (var k = 0; k < 9; k++) {
			let i = pairs[k].x;
			let j = pairs[k].y;
			let lo = min((*s)[i], (*s)[j]);
			(*s)[j] = max((*s)[i], (*s)[j]);
			(*s)[i] = lo;
		}
	}
	fn ComputeMinimumDifference(set0In: array<f32, 5>, set1In: array<f32, 5>) -> f32 {
		var set0 = set0In;
		var set1 = set1In;
		var minDiff = FP16_MAX - 1.0;
		var a = 0;
		var b = 0;
		SortSet(&set0);
		SortSet(&set1);
		let most = min(set0[4], set1[4]);
		if (most > FP32_MIN) {
			for (var i = 0; i < 5 && minDiff < FP16_MAX; i++) {
				var diff = set0[min(a, 4)] - set1[min(b, 4)];
				if (abs(diff) > FP16_MIN) {
					diff = sign(diff) * (1.0 - MinDividedByMax(set0[min(a, 4)], set1[min(b, 4)], 0.0));
					minDiff = select(minDiff, diff, abs(diff) < abs(minDiff));
					a += i32(set0[min(a, 4)] < set1[min(b, 4)]);
					b += i32(set0[min(a, 4)] >= set1[min(b, 4)]);
				} else {
					minDiff = FP16_MAX;
				}
			}
		}
		return minDiff * f32(minDiff < (FP16_MAX - 1.0));
	}
	fn ComputeDiff(uv: vec2f, motionVector: vec2f) -> f32 {
		let offsets = array<vec2i, 5>(vec2i(0, 0), vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1));
		var current: array<f32, 5>;
		let base = vec2i(floor((uv + Jitter() / FC.sizes.xy) * FC.sizes.xy));
		for (var k = 0; k < 5; k++) {
			current[k] = max(textureLoad(currentLuma, ClampLoad(base, offsets[k], RenderSize()), 0).r, EPSILON);
		}
		let reprojected = uv + PreviousFrameJitter() / FC.sizes.xy + motionVector;
		if (!IsUvInside(reprojected)) { return 0.0; }
		var previous: array<f32, 5>;
		let prevBase = vec2i(floor(reprojected * FC.sizes.xy));
		for (var k = 0; k < 5; k++) {
			previous[k] = max(textureLoad(previousLuma, ClampLoad(prevBase, offsets[k], RenderSize()), 0).r, EPSILON);
		}
		return ComputeMinimumDifference(current, previous);
	}
	// SPD's first mip: each 2 x 2 of the source (the difference, its sign, 1) averaged
	@compute @workgroup_size(8, 8)
	fn shadingMip0(@builtin(global_invocation_id) id: vec3u) {
		let p = vec2i(id.xy);
		let size = vec2i(textureDimensions(spdMipOut));
		if (!IsOnScreen(p, size)) { return; }
		var sum = vec4f(0.0);
		for (var k = 0; k < 4; k++) {
			let q = ClampLoad(p * 2, vec2i(k % 2, k / 2), RenderSize());
			let motionVector = textureLoad(dilatedMotion, q, 0).xy;
			let diff = ComputeDiff((vec2f(q) + 0.5) / FC.sizes.xy, motionVector);
			sum += vec4f(diff, select(0.0, sign(diff), diff != 0.0), 1.0, 0.0);
		}
		textureStore(spdMipOut, p, sum * 0.25);
	}
	// and the next mips, each from the one before
	@compute @workgroup_size(8, 8)
	fn downsample(@builtin(global_invocation_id) id: vec3u) {
		let p = vec2i(id.xy);
		let size = vec2i(textureDimensions(spdMipOut));
		if (!IsOnScreen(p, size)) { return; }
		let inSize = vec2i(textureDimensions(spdMipIn));
		var sum = vec4f(0.0);
		for (var k = 0; k < 4; k++) {
			sum += textureLoad(spdMipIn, ClampLoad(p * 2, vec2i(k % 2, k / 2), inSize), 0);
		}
		textureStore(spdMipOut, p, sum * 0.25);
	}

	// ffx_fsr3upscaler_shading_change.h
	@compute @workgroup_size(8, 8)
	fn shadingChangePass(@builtin(global_invocation_id) id: vec3u) {
		let p = vec2i(id.xy);
		if (!IsOnScreen(p, ShadingChangeRenderSize())) { return; }
		let uv = (vec2f(p) + 0.5) / vec2f(ShadingChangeRenderSize());
		let uvJittered = uv + Jitter() / FC.sizes.xy;
		let mipUv = ClampUv(uvJittered, ShadingChangeRenderSize(), vec2i(textureDimensions(spdMips, 0)));
		var change = 0.0;
		for (var mip = 0; mip < 3; mip++) {
			let s = textureSampleLevel(spdMips, linearClamp, mipUv, f32(mip)).xy;
			let v = abs(s.x * s.y);
			if (v > 0.0) {
				change = max(change, v);
			}
		}
		textureStore(shadingChangeOut, p, vec4f(saturate(change), 0.0, 0.0, 0.0));
	}

	// ffx_fsr3upscaler_prepare_reactivity.h
	fn ComputeDisocclusions(uv: vec2f, motionVectorIn: vec2f, currentDepthViewSpace: f32) -> f32 {
		let nearestDepthInMeters = min(currentDepthViewSpace * FC.more.z, FP16_MAX);
		let threshold = ReconstructedDepthMvPxThreshold(nearestDepthInMeters);
		let motionVector = motionVectorIn * f32(Get4KVelocity(motionVectorIn) > threshold);
		let at = (uv + motionVector) * FC.sizes.xy - 0.5;
		let base = vec2i(floor(at));
		let f = fract(at);
		let weights = array<f32, 4>((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
		let offsets = array<vec2i, 4>(vec2i(0, 0), vec2i(1, 0), vec2i(0, 1), vec2i(1, 1));
		var disocclusion = 0.0;
		var weightSum = 0.0;
		var potential = true;
		for (var k = 0; k < 4 && potential; k++) {
			let q = ClampLoad(base, offsets[k], RenderSize());
			let weight = weights[k];
			if (weight > RECONSTRUCTED_DEPTH_BILINEAR_WEIGHT_THRESHOLD) {
				let prevNearest = GetViewSpaceDepth(LoadReconstructedPrevDepth(q));
				let depthDifference = currentDepthViewSpace - prevNearest;
				potential = potential && depthDifference > FP32_MIN;
				if (potential) {
					let halfViewportWidth = length(FC.sizes.xy * 0.5);
					let depthThreshold = max(currentDepthViewSpace, prevNearest);
					let required = 1.37e-05 * halfViewportWidth * depthThreshold;
					disocclusion += saturate(required / depthDifference) * weight;
					weightSum += weight;
				}
			}
		}
		return select(0.0, saturate(1.0 - disocclusion / weightSum), potential && weightSum > 0.0);
	}
	fn ComputeMotionDivergence(uv: vec2f, motionVector: vec2f, currentDepth: f32) -> f32 {
		let q = clamp(vec2i((uv + motionVector) * FC.sizes.xy), vec2i(0), RenderSize() - 1);
		let reprojectedDepth = textureLoad(dilatedDepth, q, 0).r;
		let reprojectedMotion = textureLoad(dilatedMotion, q, 0).xy;
		let reprojectedVelocity = Get4KVelocity(reprojectedMotion);
		let velocity = Get4KVelocity(motionVector);
		let distanceFactor = MinDividedByMax(GetViewSpaceDepthInMeters(reprojectedDepth), GetViewSpaceDepthInMeters(currentDepth), 0.0);
		let velocityFactor = saturate(velocity / 10.0);
		let ratio = select(1.0, saturate(reprojectedVelocity / velocity), velocity > 0.0);
		return (1.0 - ratio) * distanceFactor * velocityFactor;
	}
	fn ComputeThinFeatureConfidence(p: vec2i) -> f32 {
		let offsets = array<vec2i, 9>(vec2i(0, 0), vec2i(-1, -1), vec2i(0, -1), vec2i(1, -1), vec2i(-1, 0), vec2i(1, 0), vec2i(-1, 1), vec2i(0, 1), vec2i(1, 1));
		var samples: array<f32, 9>;
		var lumaMin = FP32_MAX;
		var lumaMax = FP32_MIN;
		for (var k = 0; k < 9; k++) {
			samples[k] = textureLoad(currentLuma, ClampLoad(p, offsets[k], RenderSize()), 0).r;
			lumaMin = min(lumaMin, samples[k]);
			lumaMax = max(lumaMax, samples[k]);
		}
		let range = lumaMax - lumaMin;
		var dissimilarMin = FP32_MAX;
		var dissimilarMax = 0.0;
		var pattern = 1u;		// (the nucleus: similar)
		for (var k = 1; k < 9; k++) {
			let difference = select(1.0, abs(samples[k] - samples[0]) / range, range > 0.0);
			if (difference < 0.9) {
				pattern |= (1u << u32(k));
			} else {
				dissimilarMin = min(dissimilarMin, samples[k]);
				dissimilarMax = max(dissimilarMax, samples[k]);
			}
		}
		let ridge = samples[0] > dissimilarMax || samples[0] < dissimilarMin;
		if (!ridge) { return 0.0; }
		let rejections = array<u32, 4>((1u << 1u) | (1u << 2u) | (1u << 4u) | 1u, (1u << 2u) | (1u << 3u) | (1u << 5u) | 1u, (1u << 4u) | (1u << 6u) | (1u << 7u) | 1u, (1u << 5u) | (1u << 7u) | (1u << 8u) | 1u);
		for (var k = 0; k < 4; k++) {
			if ((pattern & rejections[k]) == rejections[k]) { return 0.0; }
		}
		return 1.0 - lumaMin / lumaMax;
	}
	@compute @workgroup_size(8, 8)
	fn prepareReactivity(@builtin(global_invocation_id) id: vec3u) {
		let p = vec2i(id.xy);
		if (!IsOnScreen(p, RenderSize())) { return; }
		let uv = (vec2f(p) + 0.5) / FC.sizes.xy;
		let motionVector = textureLoad(dilatedMotion, p, 0).xy;
		let depth = textureLoad(dilatedDepth, p, 0).r;
		let disocclusion = ComputeDisocclusions(uv, motionVector, GetViewSpaceDepth(depth));
		// (the reactive mask, AMD's DilateReactiveMasks: the most of the 3 x 3; given in the motion's z, motionShapes.js)
		var reactiveMask = 0.0;
		for (var k = 0; k < 9; k++) {
			reactiveMask = max(reactiveMask, textureLoad(inputMotion, ClampLoad(p, vec2i(k % 3 - 1, k / 3 - 1), RenderSize()), 0).z);
		}
		let shadingUv = ClampUv(uv - Jitter() / FC.sizes.xy, ShadingChangeRenderSize(), ShadingChangeRenderSize());
		let change = max(reactiveMask, saturate(textureSampleLevel(shadingChange, linearClamp, shadingUv, 0.0).r));
		let reactive = max(ComputeMotionDivergence(uv, motionVector, depth), reactiveMask);
		// the accumulation (UpdateAccumulation)
		let reprojected = uv + motionVector;
		var accumulated = 0.0;
		if (IsUvInside(reprojected)) {
			accumulated = saturate(textureSampleLevel(accumulation, linearClamp, ClampUv(reprojected, RenderSize(), RenderSize()), 0.0).r);
		}
		accumulated = mix(accumulated, 0.0, change);
		accumulated = mix(accumulated, min(MIN_DISOCCLUSION_ACCUMULATION, accumulated), disocclusion);
		accumulated *= f32(round(accumulated * 100.0) > 1.0);
		textureStore(accumulationOut, p, vec4f(saturate(accumulated + ACCUMULATION_ADDED_PER_FRAME), 0.0, 0.0, 0.0));
		textureStore(reactiveMasksOut, p, saturate(vec4f(reactive, disocclusion, change, accumulated)));
		// a thin feature: locked in
		let lockStrength = ComputeThinFeatureConfidence(p);
		if (lockStrength > 0.01) {
			let hr = ComputeHrPosFromLrPos(p);
			if (IsOnScreen(hr, UpscaleSize())) {
				newLocks[hr.y * UpscaleSize().x + hr.x] = lockStrength;
			}
		}
	}

	// ffx_fsr3upscaler_luma_instability.h
	@compute @workgroup_size(8, 8)
	fn lumaInstabilityPass(@builtin(global_invocation_id) id: vec3u) {
		let p = vec2i(id.xy);
		if (!IsOnScreen(p, RenderSize())) { return; }
		var history = vec4f(0.0);
		var instability = 0.0;
		let motionVector = textureLoad(dilatedMotion, p, 0).xy;
		let uv = (vec2f(p) + 0.5) / FC.sizes.xy;
		let uvJittered = uv + Jitter() / FC.sizes.xy;
		let reprojected = uv + PreviousFrameJitter() / FC.sizes.xy + motionVector;
		if (IsUvInside(reprojected)) {
			let masks = textureSampleLevel(reactiveMasks, linearClamp, ClampUv(uvJittered, RenderSize(), RenderSize()), 0.0);
			let reactive = saturate(masks.x);
			let disocclusion = saturate(masks.y);
			let change = saturate(masks.z);
			let accumulated = saturate(masks.w);
			if (accumulated > 0.9) {
				let luma = textureSampleLevel(currentLuma, linearClamp, ClampUv(uvJittered, RenderSize(), RenderSize()), 0.0).r;
				history = textureSampleLevel(lumaHistory, linearClamp, ClampUv(reprojected, RenderSize(), RenderSize()), 0.0);
				// (ComputeLumaInstabilityFactor)
				let diffs0 = luma - history[0];
				let similarity0 = MinDividedByMax(luma, history[0], 1.0);
				var maxSimilarity = similarity0;
				var unstable = 0.0;
				if (similarity0 < 1.0) {
					for (var k = 1; k <= 3; k++) {
						let diffs1 = luma - history[k];
						let similarity1 = MinDividedByMax(luma, history[k], 0.0);
						if (sign(diffs0) == sign(diffs1)) {
							maxSimilarity = max(maxSimilarity, similarity1);
						}
					}
					unstable = f32(maxSimilarity > similarity0);
				}
				history = vec4f(luma, history[0], history[1], history[2]);
				instability = unstable * f32(history[3] != 0.0);
				let velocityWeight = 1.0 - saturate(Get4KVelocity(motionVector) / 20.0);
				instability *= velocityWeight * (1.0 - disocclusion) * (1.0 - reactive) * (1.0 - change);
			}
		}
		textureStore(lumaHistoryOut, p, history);
		textureStore(lumaInstabilityOut, p, vec4f(instability, 0.0, 0.0, 0.0));
	}

	// ffx_fsr3upscaler_sample.h: Lanczos 2, and its approximation from the square
	const PI: f32 = 3.141592653589793;
	fn Lanczos2(xIn: f32) -> f32 {
		let x = min(abs(xIn), 2.0);
		return select((sin(PI * x) / (PI * x)) * (sin(0.5 * PI * x) / (0.5 * PI * x)), 1.0, abs(x) < EPSILON);
	}
	fn Lanczos2ApproxSq(x2In: f32) -> f32 {
		let x2 = min(x2In, 4.0);
		let a = (2.0 / 5.0) * x2 - 1.0;
		let b = (1.0 / 4.0) * x2 - 1.0;
		return ((25.0 / 16.0) * a * a - (25.0 / 16.0 - 1.0)) * (b * b);
	}
	fn Lanczos2Row(c0: vec4f, c1: vec4f, c2: vec4f, c3: vec4f, t: f32) -> vec4f {
		let w0 = Lanczos2(-1.0 - t);
		let w1 = Lanczos2(-0.0 - t);
		let w2 = Lanczos2(1.0 - t);
		let w3 = Lanczos2(2.0 - t);
		return (w0 * c0 + w1 * c1 + w2 * c2 + w3 * c3) / (w0 + w1 + w2 + w3);
	}
	fn HistoryAt(p: vec2i, size: vec2i) -> vec4f {
		return textureLoad(upscaled, clamp(p, vec2i(1), size - 2), 0);
	}
	// (ffx_fsr3upscaler_reproject.h: the history read at uv with a 4 x 4 Lanczos, deringed to the 2 x 2 in the middle)
	fn HistorySample(uv: vec2f, size: vec2i) -> vec4f {
		var at = uv * vec2f(size) - 0.5;
		let f = fract(at);
		at = clamp(at, vec2f(0.0), vec2f(size - 1));
		let i = vec2i(floor(at));
		var rows: array<vec4f, 4>;
		for (var y = 0; y < 4; y++) {
			rows[y] = Lanczos2Row(HistoryAt(i + vec2i(-1, y - 1), size), HistoryAt(i + vec2i(0, y - 1), size), HistoryAt(i + vec2i(1, y - 1), size), HistoryAt(i + vec2i(2, y - 1), size), f.x);
		}
		let c = Lanczos2Row(rows[0], rows[1], rows[2], rows[3], f.y);
		let d0 = HistoryAt(i, size);
		let d1 = HistoryAt(i + vec2i(1, 0), size);
		let d2 = HistoryAt(i + vec2i(0, 1), size);
		let d3 = HistoryAt(i + vec2i(1, 1), size);
		return clamp(c, min(min(d0, d1), min(d2, d3)), max(max(d0, d1), max(d2, d3)));
	}

	// ffx_fsr3upscaler_accumulate.h, upsample.h
	struct Box {
		center: vec3f,
		vec: vec3f,
		lo: vec3f,
		hi: vec3f,
		weight: f32,
	}
	@compute @workgroup_size(8, 8)
	fn accumulate(@builtin(global_invocation_id) id: vec3u) {
		let hr = vec2i(id.xy);
		if (!IsOnScreen(hr, UpscaleSize())) { return; }
		let R = RenderSize();
		let U = UpscaleSize();
		// InitPassData
		let hrUv = (vec2f(hr) + 0.5) / FC.sizes.zw;
		let lrUvJittered = hrUv + Jitter() / FC.sizes.xy;
		let lrUvHw = ClampUv(lrUvJittered, R, R);
		let motionVector = textureLoad(dilatedMotion, clamp(vec2i(hrUv * FC.sizes.xy), vec2i(0), R - 1), 0).xy;
		let velocity = Get4KVelocity(motionVector);
		let reprojectedUv = hrUv + motionVector;
		let existing = IsUvInside(reprojectedUv);
		let lumaInstab = textureSampleLevel(lumaInstability, linearClamp, ClampUv(hrUv, R, R), 0.0).r;
		let farthestMeters = textureSampleLevel(farthestMip1, linearClamp, ClampUv(lrUvJittered, max(R / 2, vec2i(1)), vec2i(textureDimensions(farthestMip1))), 0.0).r;
		let isNew = !existing || FrameIndex() == 0.0;
		let masks = textureSampleLevel(reactiveMasks, linearClamp, lrUvHw, 0.0);
		let reactive = saturate(masks.x);
		let disocclusion = saturate(masks.y);
		let change = saturate(masks.z);
		var accumulated = saturate(masks.w);
		accumulated *= f32(round(accumulated * 100.0) > 1.0);

		var upsampledColor = vec3f(0.0);
		var upsampledWeight = 0.0;
		var historyColor = vec3f(0.0);
		var historyWeight = 1.0;
		var lock = 0.0;
		// ReprojectHistoryColor
		if (existing && !isNew) {
			let h = HistorySample(reprojectedUv, U);
			historyColor = RGBToYCoCg(h.rgb);
			lock = h.w;
		}
		// UpdateLockStatus
		lock *= f32(!isNew);
		let lifetimeDecreaseFactor = max(change, max(reactive, disocclusion));
		lock = max(0.0, lock - lifetimeDecreaseFactor * LOCK_MAX);
		let lockContribution = saturate(saturate(lock - LOCK_THRESHOLD) * (LOCK_MAX - LOCK_THRESHOLD));
		let lockIndex = hr.y * U.x + hr.x;
		let newLockIntensity = newLocks[lockIndex] * (1.0 - max(change * 0.0, reactive));
		lock = max(0.0, min(lock + newLockIntensity, LOCK_MAX));
		lock = max(0.0, lock - (0.1 / JitterSequenceLength()) * (1.0 - lifetimeDecreaseFactor));
		lock *= f32(IsUvInside(hrUv - motionVector));
		// ComputeBaseAccumulationWeight
		historyWeight = min(accumulated, mix(accumulated, 0.15, saturate(max(0.0, (velocity * VELOCITY_FACTOR) / 0.5))));
		// ComputeUpsampledColorAndWeight
		let dstPos = vec2f(hr) + 0.5;
		let srcPos = dstPos * DownscaleFactor();
		let srcInput = vec2i(floor(srcPos));
		let srcUnjittered = vec2f(srcInput) + 0.5 - Jitter();
		let baseOffset = srcUnjittered - srcPos;
		let flipCol = srcUnjittered.x > srcPos.x;
		let flipRow = srcUnjittered.y > srcPos.y;
		let offsetTL = vec2i(select(-1, -2, flipCol), select(-1, -2, flipRow));
		let initial = accumulated == 0.0;
		var samples: array<vec3f, 9>;
		for (var k = 0; k < 9; k++) {
			let colRow = vec2i(select(k % 3, 3 - k % 3, flipCol), select(k / 3, 3 - k / 3, flipRow));
			samples[k] = RGBToYCoCg(max(vec3f(0.0), textureLoad(inputColor, ClampLoad(srcInput + offsetTL + colRow, vec2i(0), R), 0).rgb));
		}
		let kernelBiasMax = min(1.99, 1.0 + (1.0 / DownscaleFactor().x - 1.0));
		let kernelBiasMin = max(1.0, (1.0 + kernelBiasMax) * 0.3);
		let kernelBiasWeight = min(1.0 - disocclusion * 0.5, min(1.0 - change, saturate(historyWeight * 5.0)));
		let kernelBias = mix(kernelBiasMin, kernelBiasMax, kernelBiasWeight);
		var box: Box;
		for (var k = 0; k < 9; k++) {
			let colRow = vec2i(select(k % 3, 3 - k % 3, flipCol), select(k / 3, 3 - k / 3, flipRow));
			let sampleOffset = baseOffset + vec2f(offsetTL) + vec2f(colRow);
			let onScreen = f32(IsOnScreen(srcInput + offsetTL + colRow, R));
			if (!initial) {
				let biased = sampleOffset * kernelBias;
				let w = onScreen * Lanczos2ApproxSq(dot(biased, biased));
				upsampledColor += samples[k] * w;
				upsampledWeight += w;
			}
			let boxWeight = exp(-2.3 * dot(sampleOffset, sampleOffset)) * onScreen;
			if (k == 0) {
				box.lo = samples[k];
				box.hi = samples[k];
				box.center = samples[k] * boxWeight;
				box.vec = samples[k] * samples[k] * boxWeight;
				box.weight = boxWeight;
			} else {
				box.lo = min(box.lo, samples[k]);
				box.hi = max(box.hi, samples[k]);
				box.center += samples[k] * boxWeight;
				box.vec += samples[k] * samples[k] * boxWeight;
				box.weight += boxWeight;
			}
		}
		box.weight = select(1.0, box.weight, abs(box.weight) > FP32_MIN);
		box.center /= box.weight;
		box.vec /= box.weight;
		box.vec = sqrt(abs(box.vec - box.center * box.center));
		upsampledWeight *= f32(upsampledWeight > EPSILON);
		if (upsampledWeight > EPSILON) {
			upsampledColor = clamp(upsampledColor / upsampledWeight, box.lo, box.hi);
			upsampledWeight *= AVERAGE_LANCZOS_WEIGHT_PER_FRAME;
		}
		if (initial) {
			upsampledColor = box.center;
			upsampledWeight = 1.0;
			historyWeight = 0.0;
		}
		// RectifyHistory
		let boxScaleT = max(saturate(velocity / 20.0), max(saturate(0.75 - farthestMeters / 20.0), max(1.0 - accumulated, max(sqrt(reactive), change))));
		let boxScale = mix(3.0, 1.0, boxScaleT);
		let scaledBoxVec = box.vec * vec3f(1.7, 1.0, 1.0) * boxScale;
		let clampedScaledBoxVec = max(scaledBoxVec, vec3f(1.193e-7));
		let transformed = (historyColor - box.center) / clampedScaledBoxVec;
		if (length(transformed) > 1.0) {
			let clampedHistory = normalize(transformed) * scaledBoxVec + box.center;
			let historyContribution = max(lumaInstab, lockContribution) * accumulated * (1.0 - disocclusion);
			historyColor = mix(clampedHistory, historyColor, saturate(historyContribution));
		}
		// Accumulate
		historyWeight *= f32(historyWeight > FP16_MIN);
		historyWeight = max(EPSILON, historyWeight + upsampledWeight);
		let alpha = saturate(upsampledWeight / historyWeight);
		let result = max(YCoCgToRGB(mix(historyColor, upsampledColor, alpha)), vec3f(0.0));
		textureStore(upscaledOut, hr, vec4f(result, lock));
		newLocks[lockIndex] = 0.0;
	}

	// ffx_fsr3upscaler_rcas.h, ffx_fsr1.h FsrRcasF (with its denoise): sharpened onto the canvas
	const RCAS_LIMIT: f32 = 0.25 - (1.0 / 16.0);
	fn RcasLoad(p: vec2i) -> vec3f {
		return textureLoad(upscaled, clamp(p, vec2i(0), UpscaleSize() - 1), 0).rgb;
	}
	@compute @workgroup_size(8, 8)
	fn rcas(@builtin(global_invocation_id) id: vec3u) {
		let p = vec2i(id.xy);
		if (!IsOnScreen(p, UpscaleSize())) { return; }
		let b = RcasLoad(p + vec2i(0, -1));
		let d = RcasLoad(p + vec2i(-1, 0));
		let e = RcasLoad(p);
		let f = RcasLoad(p + vec2i(1, 0));
		let h = RcasLoad(p + vec2i(0, 1));
		let bL = b.b * 0.5 + (b.r * 0.5 + b.g);
		let dL = d.b * 0.5 + (d.r * 0.5 + d.g);
		let eL = e.b * 0.5 + (e.r * 0.5 + e.g);
		let fL = f.b * 0.5 + (f.r * 0.5 + f.g);
		let hL = h.b * 0.5 + (h.r * 0.5 + h.g);
		var nz = 0.25 * bL + 0.25 * dL + 0.25 * fL + 0.25 * hL - eL;
		let lumaRange = max(max(max(bL, dL), max(eL, fL)), hL) - min(min(min(bL, dL), min(eL, fL)), hL);
		nz = saturate(abs(nz) / max(lumaRange, 1e-6));
		nz = -0.5 * nz + 1.0;
		let mn4 = min(min(b, d), min(f, h));
		let mx4 = max(max(b, d), max(f, h));
		let hitMin = mn4 / max(4.0 * mx4, vec3f(1e-6));
		let hitMax = (1.0 - mx4) / min(4.0 * mn4 - 4.0, vec3f(-1e-6));
		let lobeRGB = max(-hitMin, hitMax);
		var lobe = max(-RCAS_LIMIT, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * FC.more.w;
		lobe *= nz;
		let rcpL = 1.0 / (4.0 * lobe + 1.0);
		let pix = (lobe * b + lobe * d + lobe * h + lobe * f + e) * rcpL;
		textureStore(output, p, vec4f(saturate(pix), 1.0));
	}
`;
