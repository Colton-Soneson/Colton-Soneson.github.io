export const SMAA_SEARCH_DISTANCE = 24;	// how many pixels along an edge the search for its end goes, each way

/*
	SMAA: Enhanced Subpixel Morphological Antialiasing (Jimenez, Echevarria, Sousa, Gutierrez, 2012), the "1x" kind
	https://www.iryoku.com/smaa/

	Like FXAA it works from the finished picture alone. Where FXAA blurs across whatever looks like an edge, this works out
	what SHAPE the edge is, and from the shape where the true outline most likely ran before the pixels squared it off.
	So it leaves a sharper picture: only the pixels the outline actually crosses are touched, each by how much of it lies
	on the far side of the line.

	Three passes over the screen:
		1. EDGES		for every pixel: is there an edge along its left side, along its top? (the brightness changes there)
		2. WEIGHTS		for every pixel on an edge: follow the edge both ways to where it ends, and see which way it turns
						at each end. The ends say what the outline was doing. An edge that ends in a step up at one end
						is a stair: the true outline is a line from the middle of that step to the middle of this stretch,
						and what is wanted is how much of each pixel lies under that line (its area)
		3. BLEND		every pixel is mixed with the one across the edge from it, by that area

	THE SHAPES (pass 2). Take an edge running across the screen, d pixels long, between the row above it and the row below.
	At each end one of four things is so:
		nothing crosses it		the edge just fades out. No telling where the outline went: that end is left alone
		a step up				(an edge running up from the end) the outline came down to this edge from above: the line
								goes from half a pixel up, at the end, to the edge itself half way along
		a step down				the same, from below
		both					a T: no telling
	A step up at one end and a step down at the other is a stair tread (a Z): the two half lines meet in the middle and make
	one straight line across the whole tread, which is exactly the slanted outline the stair was made from. A step at one
	end only is a corner (an L). The same step at both ends is a bump or a dent (a U).

	Left out of this version: SMAA's separate search for edges that run at 45 degrees, and its rounding of sharp corners.
	The areas are worked out here from the line, where the original reads them from a table worked out ahead of time.
*/
const smaaCommon =
`
	struct SmaaUniforms
	{
		texel : vec2f,			// the size of a pixel, as a share of the picture
		threshold : f32,		// how much the brightness has to change between two pixels for there to be an edge between them
		padding : f32,
	}
	@group(0) @binding(0) var<uniform> UBO: SmaaUniforms;

	// one triangle that covers the whole screen
	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
		var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
		return vec4f(corners[vertexIndex], 0.0, 1.0);
	}
`;

// 1. EDGES. Out: r: there is an edge along the left side of this pixel, g: along its top
export const vf_smaaEdges =
`
	${smaaCommon}
	@group(0) @binding(1) var frame: texture_2d<f32>;		// the finished picture (a copy of it)

	// how bright the pixel at a place looks (as it is on screen, gamma corrected: that is how the eye judges an edge)
	fn brightnessAt(pixel: vec2i) -> f32 {
		let inside = clamp(pixel, vec2i(0, 0), vec2i(textureDimensions(frame)) - vec2i(1, 1));
		return dot(textureLoad(frame, inside, 0).rgb, vec3f(0.299, 0.587, 0.114));
	}

	@fragment
	fn fragmentMain(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
		let pixel = vec2i(fragCoord.xy);
		let here = brightnessAt(pixel);
		let left = brightnessAt(pixel + vec2i(-1, 0));
		let top = brightnessAt(pixel + vec2i(0, -1));

		let change = abs(vec2f(here, here) - vec2f(left, top));
		var edges = step(vec2f(UBO.threshold, UBO.threshold), change);
		if (edges.x + edges.y == 0.0) {
			return vec4f(0.0, 0.0, 0.0, 0.0);		// most of the picture stops here
		}

		// An edge only counts if nothing right next to it is much stronger. Beside a strong edge (the outline of a mountain
		//		against the sky) the eye does not see a faint one, and smoothing the faint one would only blur the strong one
		let right = brightnessAt(pixel + vec2i(1, 0));
		let bottom = brightnessAt(pixel + vec2i(0, 1));
		let leftLeft = brightnessAt(pixel + vec2i(-2, 0));
		let topTop = brightnessAt(pixel + vec2i(0, -2));
		var most = max(change, abs(vec2f(here, here) - vec2f(right, bottom)));
		most = max(most, abs(vec2f(left, top) - vec2f(leftLeft, topTop)));
		let strongest = max(most.x, most.y);
		edges *= step(vec2f(strongest, strongest), 2.0 * change);

		return vec4f(edges, 0.0, 1.0);
	}
`;

// 2. WEIGHTS. Out, for the edge along the top of this pixel: r: how much of the pixel above is to be given this pixel's color,
//		g: how much of this pixel the color of the one above. And the same for the edge along its left side: b: the pixel to the left, a: this one
export const vf_smaaWeights =
`
	${smaaCommon}
	@group(0) @binding(1) var edgeTexture: texture_2d<f32>;

	fn edgesAt(pixel: vec2i) -> vec2f {
		let size = vec2i(textureDimensions(edgeTexture));
		if (pixel.x < 0 || pixel.y < 0 || pixel.x >= size.x || pixel.y >= size.y) {
			return vec2f(0.0, 0.0);
		}
		return textureLoad(edgeTexture, pixel, 0).rg;
	}

	// How much of a pixel lies under the line that runs from half a pixel up at one end of an edge down to the edge itself
	//		half way along it. fromEnd: how many pixels the pixel is from that end. edgeLength: the whole edge, in pixels
	fn areaUnderLine(fromEnd: f32, edgeLength: f32) -> f32 {
		let halfWay = edgeLength * 0.5;
		let a = min(fromEnd, halfWay);
		let b = min(fromEnd + 1.0, halfWay);
		// the height of the line at both sides of the pixel, and the area between: a trapezium
		return (0.5 * (1.0 - a / halfWay) + 0.5 * (1.0 - b / halfWay)) * 0.5 * (b - a);
	}

	// The two weights for one edge, from where the pixel is along it and what crosses each of its ends.
	//		back, forth: how many pixels of edge there are before and after this one
	//		backEnd, forthEnd: what crosses the edge at each end. x: on the far side of the edge (up, or left), y: on this pixel's side
	// Returns x: how much of the pixel across the edge gets this pixel's color, y: how much of this pixel gets that one's
	fn edgeWeights(back: i32, forth: i32, backEnd: vec2f, forthEnd: vec2f) -> vec2f {
		let edgeLength = f32(back + forth + 1);
		var backArea = areaUnderLine(f32(back), edgeLength);
		var forthArea = areaUnderLine(f32(forth), edgeLength);

		// an end counts only if exactly one edge crosses it (see THE SHAPES)
		let backFar = backEnd.x > 0.5 && backEnd.y < 0.5;
		let backNear = backEnd.y > 0.5 && backEnd.x < 0.5;
		let forthFar = forthEnd.x > 0.5 && forthEnd.y < 0.5;
		let forthNear = forthEnd.y > 0.5 && forthEnd.x < 0.5;

		// a bump or a dent (the same step at both ends): a short one is most likely the end of something thin, and is rounded off more
		if ((backFar && forthFar) || (backNear && forthNear)) {
			let lengthy = saturate(edgeLength / 32.0);
			backArea = mix(sqrt(backArea * 2.0) * 0.5, backArea, lengthy);
			forthArea = mix(sqrt(forthArea * 2.0) * 0.5, forthArea, lengthy);
		}

		return vec2f(select(0.0, backArea, backFar) + select(0.0, forthArea, forthFar),
					 select(0.0, backArea, backNear) + select(0.0, forthArea, forthNear));
	}

	@fragment
	fn fragmentMain(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
		let pixel = vec2i(fragCoord.xy);
		let edges = edgesAt(pixel);
		var weights = vec4f(0.0, 0.0, 0.0, 0.0);

		//------------------THE EDGE ALONG THE TOP-----------------
		if (edges.g > 0.5) {
			// to the left, a pixel at a time, until something crosses the edge or the edge stops
			var back = 0;
			var backEnd = vec2f(0.0, 0.0);
			for (var i = 0; i < ${SMAA_SEARCH_DISTANCE}; i++) {
				let at = pixel - vec2i(back, 0);
				backEnd = vec2f(edgesAt(at + vec2i(0, -1)).r, edgesAt(at).r);		// the left sides of the pixel above, and of this one
				if (backEnd.x + backEnd.y > 0.5 || edgesAt(at + vec2i(-1, 0)).g < 0.5) {
					break;
				}
				back++;
			}
			// and to the right
			var forth = 0;
			var forthEnd = vec2f(0.0, 0.0);
			for (var i = 0; i < ${SMAA_SEARCH_DISTANCE}; i++) {
				let at = pixel + vec2i(forth + 1, 0);
				forthEnd = vec2f(edgesAt(at + vec2i(0, -1)).r, edgesAt(at).r);
				if (forthEnd.x + forthEnd.y > 0.5 || edgesAt(at).g < 0.5) {
					break;
				}
				forth++;
			}
			let found = edgeWeights(back, forth, backEnd, forthEnd);
			weights.r = found.x;
			weights.g = found.y;
		}

		//------------------THE EDGE ALONG THE LEFT SIDE-----------------
		if (edges.r > 0.5) {
			// upwards
			var back = 0;
			var backEnd = vec2f(0.0, 0.0);
			for (var i = 0; i < ${SMAA_SEARCH_DISTANCE}; i++) {
				let at = pixel - vec2i(0, back);
				backEnd = vec2f(edgesAt(at + vec2i(-1, 0)).g, edgesAt(at).g);		// the tops of the pixel to the left, and of this one
				if (backEnd.x + backEnd.y > 0.5 || edgesAt(at + vec2i(0, -1)).r < 0.5) {
					break;
				}
				back++;
			}
			// and downwards
			var forth = 0;
			var forthEnd = vec2f(0.0, 0.0);
			for (var i = 0; i < ${SMAA_SEARCH_DISTANCE}; i++) {
				let at = pixel + vec2i(0, forth + 1);
				forthEnd = vec2f(edgesAt(at + vec2i(-1, 0)).g, edgesAt(at).g);
				if (forthEnd.x + forthEnd.y > 0.5 || edgesAt(at).r < 0.5) {
					break;
				}
				forth++;
			}
			let found = edgeWeights(back, forth, backEnd, forthEnd);
			weights.b = found.x;
			weights.a = found.y;
		}
		return weights;
	}
`;

// 3. BLEND
export const vf_smaaBlend =
`
	${smaaCommon}
	@group(0) @binding(1) var frame: texture_2d<f32>;
	@group(0) @binding(2) var frameSampler: sampler;		// linear: reading part of the way over to the next pixel is the mixing
	@group(0) @binding(3) var weightTexture: texture_2d<f32>;

	fn weightsAt(pixel: vec2i) -> vec4f {
		return textureLoad(weightTexture, clamp(pixel, vec2i(0, 0), vec2i(textureDimensions(weightTexture)) - vec2i(1, 1)), 0);
	}

	@fragment
	fn fragmentMain(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
		let pixel = vec2i(fragCoord.xy);
		let uv = fragCoord.xy * UBO.texel;

		// what this pixel is to take from each of the four next to it. Its own top and left edges say how much from above and
		//		from the left, and the edges of the pixels below and to the right (which are this pixel's other two sides) the rest
		let own = weightsAt(pixel);
		let fromAbove = own.g;
		let fromLeft = own.a;
		let fromBelow = weightsAt(pixel + vec2i(0, 1)).r;
		let fromRight = weightsAt(pixel + vec2i(1, 0)).b;

		if (fromAbove + fromLeft + fromBelow + fromRight < 0.00001) {
			return textureSampleLevel(frame, frameSampler, uv, 0.0);
		}

		// across whichever edge is the stronger. Reading the picture a part of a pixel over is a mix of this pixel and the next, by that part
		var first = vec2f(0.0, -fromAbove);
		var second = vec2f(0.0, fromBelow);
		var shares = vec2f(fromAbove, fromBelow);
		if (max(fromLeft, fromRight) > max(fromAbove, fromBelow)) {
			first = vec2f(-fromLeft, 0.0);
			second = vec2f(fromRight, 0.0);
			shares = vec2f(fromLeft, fromRight);
		}
		shares /= shares.x + shares.y;
		let color = shares.x * textureSampleLevel(frame, frameSampler, uv + first * UBO.texel, 0.0)
				  + shares.y * textureSampleLevel(frame, frameSampler, uv + second * UBO.texel, 0.0);
		return vec4f(color.rgb, 1.0);
	}
`;
