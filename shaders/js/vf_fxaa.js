export const FXAA_SEARCH_STEPS = 10;	// how many steps the search along an edge takes, each way

/*
	FXAA: Fast Approximate Anti-Aliasing (Timothy Lottes, NVIDIA, version 3.11, the "quality" path)
	https://developer.download.nvidia.com/assets/gamedev/files/sdk/11/FXAA_WhitePaper.pdf

	Smooths the stair steps along edges using nothing but the finished picture, so it does not care what drew the edge:
	the outline of a mountain, a blade of grass, the rim of the moon.

	For every pixel:
		1. is it on an edge at all	the brightness of the pixel and the 4 next to it. If they are all much the same there is
									nothing to do, and most of the picture stops here
		2. which way the edge runs	across or up and down, from the 8 pixels around it
		3. how long the edge is		walks along the edge both ways until the brightness stops looking like the edge.
									A stair step is one long edge that shifts over by a pixel at some point: how far this
									pixel is from the end of its edge says how far along the step it is
		4. blend					reads the picture a fraction of a pixel across the edge, by that much. With linear
									filtering that is a blend of the two sides, more of the other side the nearer the step
	And for anything smaller than a pixel (a far blade of grass), which has no edge to follow: the pixel is pulled towards
	the average of the pixels around it, by how much it stands out from them.

	Brightness is judged from the picture as it is on screen (already gamma corrected), which is how the eye judges it.
*/
export const vf_fxaa =
`
	struct FxaaUniforms
	{
		texel : vec2f,			// the size of a pixel, as a share of the picture
		subpixel : f32,			// how much a pixel that stands out from the ones around it is pulled towards them. 0 = edges only
		edgeThreshold : f32,	// how much the brightness has to differ, next to the brightest pixel there, to count as an edge
	}
	@group(0) @binding(0) var<uniform> UBO: FxaaUniforms;
	@group(0) @binding(1) var frame: texture_2d<f32>;		// the finished picture (a copy of it: a picture cant be read and drawn to at once)
	@group(0) @binding(2) var frameSampler: sampler;

	// one triangle that covers the whole screen
	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
		var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
		return vec4f(corners[vertexIndex], 0.0, 1.0);
	}

	// how bright a color looks
	fn brightness(color: vec3f) -> f32 {
		return dot(color, vec3f(0.299, 0.587, 0.114));
	}

	fn brightnessAt(uv: vec2f) -> f32 {
		return brightness(textureSampleLevel(frame, frameSampler, uv, 0.0).rgb);
	}

	@fragment
	fn fragmentMain(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
		let texel = UBO.texel;
		let uv = fragCoord.xy * texel;
		let middle = textureSampleLevel(frame, frameSampler, uv, 0.0);

		//------------------1. IS IT ON AN EDGE-----------------
		let here = brightness(middle.rgb);
		let north = brightnessAt(uv + vec2f(0.0, -texel.y));
		let south = brightnessAt(uv + vec2f(0.0, texel.y));
		let west = brightnessAt(uv + vec2f(-texel.x, 0.0));
		let east = brightnessAt(uv + vec2f(texel.x, 0.0));

		let most = max(here, max(max(north, south), max(west, east)));
		let least = min(here, min(min(north, south), min(west, east)));
		let contrast = most - least;
		if (contrast < max(0.0312, most * UBO.edgeThreshold)) {
			return middle;
		}

		//------------------2. WHICH WAY IT RUNS-----------------
		let northWest = brightnessAt(uv + vec2f(-texel.x, -texel.y));
		let northEast = brightnessAt(uv + vec2f(texel.x, -texel.y));
		let southWest = brightnessAt(uv + vec2f(-texel.x, texel.y));
		let southEast = brightnessAt(uv + vec2f(texel.x, texel.y));

		// how sharply the brightness bends going down the screen (an edge that runs across), and going across it (one that runs up and down)
		let bendDown = abs(northWest + southWest - 2.0 * west) + 2.0 * abs(north + south - 2.0 * here) + abs(northEast + southEast - 2.0 * east);
		let bendAcross = abs(northWest + northEast - 2.0 * north) + 2.0 * abs(west + east - 2.0 * here) + abs(southWest + southEast - 2.0 * south);
		let runsAcross = bendDown >= bendAcross;

		// the two pixels either side of the edge, and which of them differs from this one the most: the edge is between it and this pixel
		let first = select(west, north, runsAcross);
		let second = select(east, south, runsAcross);
		let firstSteeper = abs(first - here) >= abs(second - here);
		let steepness = 0.25 * max(abs(first - here), abs(second - here));
		var stepAcross = select(texel.x, texel.y, runsAcross);		// one pixel across the edge, towards the other side
		var edgeBrightness = 0.5 * (second + here);					// the brightness half way across it
		if (firstSteeper) {
			stepAcross = -stepAcross;
			edgeBrightness = 0.5 * (first + here);
		}

		//------------------3. HOW LONG IT IS-----------------
		// from the middle of the edge (half a pixel across from here), out along it both ways
		var onEdge = uv;
		if (runsAcross) {
			onEdge.y += 0.5 * stepAcross;
		} else {
			onEdge.x += 0.5 * stepAcross;
		}
		let alongEdge = select(vec2f(0.0, texel.y), vec2f(texel.x, 0.0), runsAcross);

		// the steps get longer as they go: an edge that is nearly level is a very long one
		var strides = array<f32, ${FXAA_SEARCH_STEPS}>(1.0, 1.0, 1.0, 1.0, 1.5, 2.0, 2.0, 2.0, 4.0, 8.0);
		var back = onEdge;
		var forth = onEdge;
		var backEnd = 0.0;
		var forthEnd = 0.0;
		var backDone = false;
		var forthDone = false;
		for (var i = 0; i < ${FXAA_SEARCH_STEPS}; i++) {
			if (!backDone) {
				back -= alongEdge * strides[i];
				backEnd = brightnessAt(back) - edgeBrightness;
				backDone = abs(backEnd) >= steepness;		// it no longer looks like the middle of the edge: the edge has ended, or stepped over
			}
			if (!forthDone) {
				forth += alongEdge * strides[i];
				forthEnd = brightnessAt(forth) - edgeBrightness;
				forthDone = abs(forthEnd) >= steepness;
			}
			if (backDone && forthDone) {
				break;
			}
		}

		//------------------4. BLEND-----------------
		let backDistance = select(uv.y - back.y, uv.x - back.x, runsAcross);
		let forthDistance = select(forth.y - uv.y, forth.x - uv.x, runsAcross);
		let nearer = min(backDistance, forthDistance);
		// at the end of the edge the pixel is half way over to the other side, in the middle of it not at all
		var across = 0.5 - nearer / (backDistance + forthDistance);
		// only if the nearer end is where the edge steps over towards this pixel's side. If it steps the other way, the pixel is not part of that step
		let nearerEnd = select(forthEnd, backEnd, backDistance < forthDistance);
		if ((nearerEnd < 0.0) == (here < edgeBrightness)) {
			across = 0.0;
		}

		// anything smaller than a pixel: how much this pixel stands out from the average of the 8 around it
		let around = (2.0 * (north + south + west + east) + northWest + northEast + southWest + southEast) / 12.0;
		let standsOut = saturate(abs(around - here) / contrast);
		let softened = (3.0 - 2.0 * standsOut) * standsOut * standsOut;
		across = max(across, softened * softened * UBO.subpixel);

		var blended = uv;
		if (runsAcross) {
			blended.y += across * stepAcross;
		} else {
			blended.x += across * stepAcross;
		}
		return vec4f(textureSampleLevel(frame, frameSampler, blended, 0.0).rgb, middle.a);
	}
`;
