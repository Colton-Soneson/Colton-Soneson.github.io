import { skyTest } from './depthShapes.js';
/*
	The point lights (pointLights.js): the towns' gas lamps, and the like, lighting whatever is round them at dusk and by night.

	DEFERRED. It is not done in the shader of each thing a light might fall on (the land, the houses, the trees, the horses...) but once,
	over the finished picture of the solid things, from what the depth buffer knows about every pixel: where in the world it is
	(the depth taken back through the camera), and which way it faces (how that position changes to the next pixel across and down).
	Each light adds as much as reaches the pixel: falling off with distance to nothing at its radius, and more on a surface turned
	to it. What colour the surface is, is the colour already there: the picture is darker than the surface by the light that
	fell on it already (the ambient light of the night), so lit by a lamp it is the colour there times (1 + the lamp / that light).
	That is done by the blend, not here: this writes the lamp's light over the ambient, and the blend multiplies the picture by one
	plus it (source times destination, plus destination).

	FINDING THE LIGHTS NEAR A PIXEL. The still ones (the lamps) are sorted once into a grid over the world (CELL wide): each cell
	keeps where its lights start in a list and how many. A pixel only looks at the lights of the cell it is in. A light is put in
	every cell its radius reaches. The ones that move (a held staff's gem) are few, and every pixel looks at all of them.
*/
export const vf_pointLights =
`
	struct LightUniforms
	{
		invViewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz
		grid : vec4f,				// x: half the world's width, y: the width of a cell, z: cells along a side, w: how many moving lights
		look : vec4f,				// x: how strong the still lights are (0 by day: they are lamps), y: the light from everywhere already in the picture
		moving : array<vec4f, 16>,	// the moving lights, two each: where (xyz) and its radius (w), its colour (rgb) and how bright (a)
	}
	@group(0) @binding(0) var<uniform> LU: LightUniforms;
	@group(0) @binding(1) var depthTexture: texture_depth_2d;
	@group(0) @binding(2) var<storage, read> lights: array<vec4f>;		// two each, as the moving ones
	@group(0) @binding(3) var<storage, read> cells: array<vec2u>;		// for each cell: where its lights start in the list, how many
	@group(0) @binding(4) var<storage, read> list: array<u32>;			// the lights of each cell, one after another

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
		var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
		return vec4f(corners[vertexIndex], 0.0, 1.0);
	}

	// one light's share at a point, facing N
	fn lightAt(place: vec4f, colour: vec4f, P: vec3f, N: vec3f) -> vec3f {
		let toLight = place.xyz - P;
		let d = length(toLight);
		if (d >= place.w) {
			return vec3f(0.0, 0.0, 0.0);
		}
		let fade = 1.0 - (d / place.w) * (d / place.w);
		let falloff = fade * fade / (1.0 + d * d * 0.05);
		let facing = saturate(dot(N, toLight / max(d, 0.001)) * 0.8 + 0.2);
		return colour.rgb * colour.a * falloff * facing;
	}

	@fragment
	fn fragmentMain(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
		let pixel = vec2i(fragCoord.xy);
		let depth = textureLoad(depthTexture, pixel, 0);
		let size = vec2f(textureDimensions(depthTexture));
		let ndc = vec2f(fragCoord.x / size.x * 2.0 - 1.0, 1.0 - fragCoord.y / size.y * 2.0);
		let scenePoint = LU.invViewProjectionMatrix * vec4f(ndc, depth, 1.0);
		let P = scenePoint.xyz / scenePoint.w;
		var N = normalize(cross(dpdx(P), dpdy(P)));
		if (dot(N, LU.cameraPosition.xyz - P) < 0.0) {
			N = -N;
		}
		if (${skyTest('depth')}) {
			return vec4f(0.0, 0.0, 0.0, 0.0);		// the sky
		}
		var light = vec3f(0.0, 0.0, 0.0);
		var movers = vec3f(0.0, 0.0, 0.0);
		// the still lights of the cell it is in
		let cellsAlong = u32(LU.grid.z);
		let c = vec2u(clamp((P.xz + vec2f(LU.grid.x, LU.grid.x)) / LU.grid.y, vec2f(0.0, 0.0), vec2f(LU.grid.z - 1.0, LU.grid.z - 1.0)));
		let cell = cells[c.y * cellsAlong + c.x];
		for (var k = 0u; k < cell.y; k++) {
			let i = list[cell.x + k];
			light += lightAt(lights[2u * i], lights[2u * i + 1u], P, N);
		}
		// and the moving ones
		for (var k = 0; k < i32(LU.grid.w); k++) {
			movers += lightAt(LU.moving[2 * k], LU.moving[2 * k + 1], P, N);
		}
		return vec4f(min((light * LU.look.x + movers) / max(LU.look.y, 0.06), vec3f(14.0, 14.0, 14.0)), 0.0);
	}
`;
