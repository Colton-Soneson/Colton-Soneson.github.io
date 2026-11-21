/*
	THE SUN'S SHADOWS, read (code/sunShadows.js makes them). Three shadow maps of the land round the camera, nested, each a bigger
	square than the last (cascades): the near one sharp, the far ones coarser. A point is looked for in the nearest one it is inside.
	sunShadow: 1 in the sun, 0 in the shadow of a tree (or a bush) between it and the sun. Its normal pushes the point out of its
	own surface before it is looked for, by a texel and a half of the map it is in, so a surface does not shadow itself.
	A shader that takes them: ${'${sunShadowShapes(group)}'} among its declarations, and the three bindings (SUN_SHADOW_BINDINGS) in its
	bind group: the uniforms, the maps and their sampler.
*/
export const SUN_CASCADES = 3;
export const SUN_SHADOW_SIZE = 2048;
export const SUN_SHADOW_BINDINGS = [40, 41, 42];
export const SUN_SHADOW_FLOATS = 16 * SUN_CASCADES + 8;
export const sunShadowShapes = (group = 0) => `
	struct SunShadowUniforms {
		cascades : array<mat4x4f, ${SUN_CASCADES}>,	// each map's: world to the map (x, y -1 to 1, z its depth 0 to 1)
		texel : vec4f,		// xyz: how wide a texel of each map is, world units. w: 1 while there are shadows at all
		sun : vec4f,		// xyz: the way to the sun
	}
	@group(${group}) @binding(${SUN_SHADOW_BINDINGS[0]}) var<uniform> SUNSHADOW: SunShadowUniforms;
	@group(${group}) @binding(${SUN_SHADOW_BINDINGS[1]}) var sunShadowMap: texture_depth_2d_array;
	@group(${group}) @binding(${SUN_SHADOW_BINDINGS[2]}) var sunShadowSampler: sampler_comparison;

	fn sunShadow(worldPos: vec3f, normal: vec3f) -> f32 {
		if (SUNSHADOW.texel.w < 0.5) {
			return 1.0;
		}
		let margin = 3.0 / ${SUN_SHADOW_SIZE}.0;
		let d = 1.0 / ${SUN_SHADOW_SIZE}.0;
		for (var c = 0; c < ${SUN_CASCADES}; c++) {
			let texel = SUNSHADOW.texel[c];
			let p = worldPos + normal * texel * 1.5 + SUNSHADOW.sun.xyz * texel * 0.5;
			let clip = SUNSHADOW.cascades[c] * vec4f(p, 1.0);
			let uv = clip.xy * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
			if (all(uv > vec2f(margin, margin)) && all(uv < vec2f(1.0 - margin, 1.0 - margin)) && clip.z > 0.0 && clip.z < 1.0) {
				// (four of the sampler's own 2 by 2 blends, a texel apart: a soft edge 2 texels wide)
				var lit = textureSampleCompareLevel(sunShadowMap, sunShadowSampler, uv + vec2f(-0.5, -0.5) * d, c, clip.z);
				lit += textureSampleCompareLevel(sunShadowMap, sunShadowSampler, uv + vec2f(0.5, -0.5) * d, c, clip.z);
				lit += textureSampleCompareLevel(sunShadowMap, sunShadowSampler, uv + vec2f(-0.5, 0.5) * d, c, clip.z);
				lit += textureSampleCompareLevel(sunShadowMap, sunShadowSampler, uv + vec2f(0.5, 0.5) * d, c, clip.z);
				lit *= 0.25;
				// (out at the edge of the last map, the shadows fade away rather than stop)
				if (c == ${SUN_CASCADES - 1}) {
					let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
					lit = mix(1.0, lit, smoothstep(0.0, 0.1, edge));
				}
				return lit;
			}
		}
		return 1.0;
	}
`;
