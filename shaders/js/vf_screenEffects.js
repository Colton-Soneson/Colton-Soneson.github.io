import { cloudShadeShapes } from './vfc_clouds.js';

export const SSAO_TAPS = 10;	// places around a pixel the ambient occlusion looks at

/*
	What is worked out from the frame's own depth texture and then laid over the picture: the ambient occlusion, and the pass
	that darkens the picture by it and by the screen space shadows (c_SSS.js). See screenEffects.js for the order it all runs in.

	Nothing here knows what it is shading. Everything was drawn and lit already, straight on to the screen, by shaders that
	know nothing of these shadows. So they go on afterwards as one multiply over the finished picture: every pixel is darkened
	by as much of its light as the shadow takes away. How much that is has to be estimated, from the only things there are to
	go on: where the pixel is (its depth) and which way its surface faces (the slope of the depth around it).
*/

const shared =
`
	struct ScreenUniforms
	{
		invViewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,
		sunDirection : vec4f,		// xyz: towards the light that casts the shadows, 1 long: the sun by day, the moon by night
		projection : vec4f,			// from the projection matrix: x scale, y scale, and the two numbers that turn a depth back into a distance (viewDistance)
		size : vec4f,				// xy: the size of the screen in pixels, zw: 1 / that
		amounts : vec4f,			// x: how strong the shadows are, y: how strong the ambient occlusion, z: its radius (world units), w: horizon fog distance
		flags : vec4f,				// x: 1.0 to show the shading alone, y: 1.0 if there is ambient occlusion to read, z: how strong that light is square on, w: and the light from everywhere else
		cloudMap : vec4f,			// where the cloud coverage map is: what cloudShadeAt takes (vfc_clouds.js)
		clouds : vec4f,				// x: how much of the sky is cloud, 0 to 1, y: 1.0 if there are clouds at all
	}
	@group(0) @binding(0) var<uniform> SU: ScreenUniforms;
	@group(0) @binding(1) var depthTexture: texture_depth_2d;

	// a triangle that covers the whole screen, from nothing but the number of the vertex
	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
		let corner = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
		return vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
	}

	// how far in front of the camera a depth from the depth texture is, world units
	fn viewDistance(depth: f32) -> f32 {
		return SU.projection.w / (depth + SU.projection.z);
	}

	fn depthAt(pixel: vec2i) -> f32 {
		return textureLoad(depthTexture, clamp(pixel, vec2i(0, 0), vec2i(SU.size.xy) - vec2i(1, 1)), 0);
	}
`;

/*
	Ambient occlusion: how much of the open sky a pixel cannot see because of what stands right next to it. The corners where
	things meet, the foot of a boulder, down in among the grass.

	For every pixel: where it is and which way it faces, both from the depth texture, and then a ring of other pixels around it.
	Each of those that stands up in front of the pixel's surface (and is near enough to be next to it rather than just in front
	of it on the screen) hides a bit of sky. Drawn at half size, since it is smoothed over when it is used anyway.
*/
export const vf_ssao =
`
	${shared}

	// where a pixel is in front of the camera: x right, y up, z towards the camera
	fn viewPositionAt(pixel: vec2i) -> vec3f {
		let along = viewDistance(depthAt(pixel));
		let ndc = vec2f((f32(pixel.x) + 0.5) * SU.size.z * 2.0 - 1.0, 1.0 - (f32(pixel.y) + 0.5) * SU.size.w * 2.0);
		return vec3f(ndc.x * along / SU.projection.x, ndc.y * along / SU.projection.y, -along);
	}

	// interleaved gradient noise (Jimenez): a different number for every pixel that still spreads evenly, so it smooths out well
	fn pixelNoise(pixel: vec2f) -> f32 {
		return fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
	}

	@fragment
	fn fragmentMain(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
		let pixel = vec2i(fragCoord.xy) * 2;	// this is drawn at half size
		if (depthAt(pixel) >= 1.0) {
			return vec4f(1.0, 1.0, 1.0, 1.0);	// sky
		}
		let here = viewPositionAt(pixel);
		let away = -here.z;

		// which way the surface faces: across to the neighbour on each axis, taking the one nearer in depth so it is not measured across an edge
		let left = viewPositionAt(pixel - vec2i(1, 0));
		let right = viewPositionAt(pixel + vec2i(1, 0));
		let above = viewPositionAt(pixel - vec2i(0, 1));
		let below = viewPositionAt(pixel + vec2i(0, 1));
		let acrossX = select(right - here, here - left, abs(left.z - here.z) < abs(right.z - here.z));
		let acrossY = select(below - here, here - above, abs(above.z - here.z) < abs(below.z - here.z));
		var normal = normalize(cross(acrossX, acrossY));
		if (dot(normal, here) > 0.0) {
			normal = -normal;	// towards the camera
		}

		// the radius on the screen. Very close up it is capped (so it does not cost a fortune), and far off, where it would be
		//		less than a pixel or two, there is nothing left to find
		let pixelsPerUnit = SU.projection.y * SU.size.y * 0.5 / away;
		let radiusPixels = min(SU.amounts.z * pixelsPerUnit, 72.0);
		if (radiusPixels < 2.0) {
			return vec4f(1.0, 1.0, 1.0, 1.0);
		}
		let radius = radiusPixels / pixelsPerUnit;

		let turn = pixelNoise(fragCoord.xy) * 6.2832;
		var hidden = 0.0;
		for (var i = 0; i < ${SSAO_TAPS}; i++) {
			// a spiral out from the pixel, turned by a different amount for every pixel
			let angle = turn + f32(i) * 2.39996;
			let reach = sqrt((f32(i) + fract(turn * 3.7)) / ${SSAO_TAPS}.0) * radiusPixels;
			let other = viewPositionAt(pixel + vec2i(vec2f(cos(angle), sin(angle)) * reach));
			let toOther = other - here;
			let apart = length(toOther);
			// how far it stands up in front of the surface (not counting what is all but level with it: a flat floor hides nothing of itself),
			//		and nothing at all for what is too far off to be beside the pixel
			let standsUp = saturate(dot(normal, toOther) / max(apart, 0.0001) - 0.12);
			hidden += standsUp * (1.0 - smoothstep(0.6 * radius, 1.3 * radius, apart));
		}
		let open = saturate(1.0 - 2.8 * hidden / ${SSAO_TAPS}.0);
		// fading out as the radius gets down to a couple of pixels, so there is no line where it stops
		return vec4f(vec3f(mix(1.0, open, smoothstep(2.0, 5.0, radiusPixels))), 1.0);
	}
`;

/*
	The pass that puts the shadows and the ambient occlusion on the picture. It multiplies: what it writes is how much of each
	pixel's light is left, and the blending does the rest.

	A shadow only takes away the sun, not the light of the sky. How much of a pixel's light was sun depends on which way it
	faces, so that is worked out again here, from the slope of the depth, with the same numbers the terrain lights itself by.
	A slope facing away from the sun was dark already and is not darkened twice.
*/
export const vf_screenShade =
`
	${shared}

	@group(0) @binding(2) var shadowTexture: texture_2d<f32>;	// 1.0 lit to 0.0 shadowed, from c_SSS
	@group(0) @binding(3) var occlusionTexture: texture_2d<f32>;	// 1.0 open to 0.0 shut in, from vf_ssao, half size
	@group(0) @binding(4) var occlusionSampler: sampler;
	@group(0) @binding(5) var cloudMap: texture_2d<f32>;			// the clouds from above, from c_cloudCoverage
	@group(0) @binding(6) var cloudMapSampler: sampler;

	${cloudShadeShapes}

	fn worldPositionAt(pixel: vec2i) -> vec3f {
		let ndc = vec2f((f32(pixel.x) + 0.5) * SU.size.z * 2.0 - 1.0, 1.0 - (f32(pixel.y) + 0.5) * SU.size.w * 2.0);
		let world = SU.invViewProjectionMatrix * vec4f(ndc, depthAt(pixel), 1.0);
		return world.xyz / world.w;
	}

	@fragment
	fn fragmentMain(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
		let pixel = vec2i(fragCoord.xy);
		let depth = depthAt(pixel);
		if (depth >= 1.0) {
			return vec4f(1.0, 1.0, 1.0, 1.0);	// sky: nothing to shade
		}
		let here = worldPositionAt(pixel);
		let toCamera = SU.cameraPosition.xyz - here;
		let away = length(toCamera);

		// which way the surface faces, the same way as in vf_ssao but in the world
		let hereDistance = viewDistance(depth);
		let nearerLeft = abs(viewDistance(depthAt(pixel - vec2i(1, 0))) - hereDistance) < abs(viewDistance(depthAt(pixel + vec2i(1, 0))) - hereDistance);
		let nearerAbove = abs(viewDistance(depthAt(pixel - vec2i(0, 1))) - hereDistance) < abs(viewDistance(depthAt(pixel + vec2i(0, 1))) - hereDistance);
		let acrossX = select(worldPositionAt(pixel + vec2i(1, 0)) - here, here - worldPositionAt(pixel - vec2i(1, 0)), nearerLeft);
		let acrossY = select(worldPositionAt(pixel + vec2i(0, 1)) - here, here - worldPositionAt(pixel - vec2i(0, 1)), nearerAbove);
		var normal = normalize(cross(acrossX, acrossY));
		if (dot(normal, toCamera) < 0.0) {
			normal = -normal;
		}

		// how much of this pixel's light was the sun (see the light in vf_terrain.js: sky 0.09 + daylight * 0.34, sun daylight * 0.72 * how square on it is.
		//		screenEffects.js works those two out, for the sun or for the moon)
		let facing = saturate(dot(normal, SU.sunDirection.xyz));
		let sunLight = SU.flags.z * facing;
		let skyLight = SU.flags.w;
		let sunShare = sunLight / (sunLight + skyLight);

		//------------------SHADOW-----------------
		let shadow = 1.0 - textureLoad(shadowTexture, pixel, 0).r;
		var left = 1.0 - shadow * sunShare * SU.amounts.x;

		//------------------AMBIENT OCCLUSION-----------------
		// smoothed over, to hide the pattern of the noise it was made with: 8 readings in two rings, each already a blend of 4 texels
		if (SU.flags.y > 0.5) {
			let uv = fragCoord.xy * SU.size.zw;
			let texel = SU.size.zw * 2.0;
			var open = 0.0;
			for (var i = 0; i < 4; i++) {
				let corner = vec2f(f32(i & 1) * 2.0 - 1.0, f32(i >> 1u) * 2.0 - 1.0);
				open += textureSampleLevel(occlusionTexture, occlusionSampler, uv + texel * corner * 0.5, 0.0).r * 0.15;
				open += textureSampleLevel(occlusionTexture, occlusionSampler, uv + texel * corner * 1.5, 0.0).r * 0.1;
			}
			// it is the sky's light that cannot get in. The sun's is only cut by half as much
			left *= 1.0 - (1.0 - open) * SU.amounts.y * (1.0 - 0.5 * sunShare);
		}

		//------------------THE SHADOWS OF THE CLOUDS-----------------
		// a cloud takes the sun off whatever is under it, the same as any other shadow. And a sky full of cloud lets less of
		//		its own light down as well: the whole day is dimmer
		let clouded = cloudShadeAt(here, SU.sunDirection.xyz, SU.cloudMap);
		left *= 1.0 - (1.0 - clouded.r) * sunShare * 0.92 * SU.clouds.y;
		left *= 1.0 - 0.28 * SU.clouds.x * (1.0 - sunShare);

		// far off the picture has faded into the horizon, and the haze is not in anything's shadow
		let clear = exp(-pow(away / SU.amounts.w, 2.0));
		left = mix(1.0, left, clear);

		return vec4f(left, left, left, 1.0);
	}
`;
