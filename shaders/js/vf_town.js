import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';

/*
	The seaside towns (town.js): the houses, the streets and stairs, the walls, the pier and the lamps. Everything is one kind of
	vertex: where it is (in its own space), what it is made of (MATERIALS), and a place on its surface in world units (uv) the patterns
	are laid out by: along a wall and up it, along a street and across it, along a roof and up its slope. Drawn once for each of its
	kind (instancing), each with its matrix (where it stands, how it is turned) and its colours: its plaster, its roof, its trim, and a
	number of its own (in plaster.w) that the weathering is laid out from.

	THE LOOK is the plastered stone of an old town by the sea: every wall is rubble stone under a coat of lime plaster, and the
	plaster has come away in places (more low down, at the corners and round the windows), showing the stones under it. Ivy has
	climbed some walls from the foot. The stone itself, where it is bare (the footings, the walls of the streets, the quay), is
	the same rubble in a warm grey and pink, the stairs and copings dressed stone, the streets cobbled. At dusk the windows light up
	here and there, and the lamps.
*/
export { TOWN_MATERIALS } from '../../code/townLayout.js';

export const vf_town =
`
	struct TownUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz
		look : vec4f,				// x: horizon fog distance, y: 1.0 if the atmosphere is on, z: seconds, w: how dark it is (0 day, 1 night)
		season : vec4f,				// x: how far the tulips are in flower, y: the roses (0 to 1), z: how much snow is lying, w: how far into the autumn
		growth : vec4f,				// x: how far up the tulips are (0: down in their beds, out of their season)
	}
	@group(0) @binding(0) var<uniform> TU: TownUniforms;

	struct LightsUniforms
	{
		lightViewProjMat : mat4x4f,
		sunPos : vec4f,
		sunCol : vec4f,
		camPos : vec4f,
		sunIntensity : f32,
		shadowMapKernelSize : f32,
		shadowMapTextureSize : f32,
		shadowMapAcneBias : f32,
		displayLightingMode : f32,
		moonPos : vec4f,
	}
	@group(0) @binding(1) var<uniform> Lights: LightsUniforms;
	@group(0) @binding(2) var skyLUT: texture_2d<f32>;
	@group(0) @binding(3) var skySampler: sampler;

	struct VertexInput {
		@location(0) shape: vec4f,		// xyz: where, in its own space. w: its material
		@location(1) uv: vec2f,			// a place on its surface, world units
		@location(2) m0: vec4f,			// its matrix, column by column
		@location(3) m1: vec4f,
		@location(4) m2: vec4f,
		@location(5) m3: vec4f,
		@location(6) plaster: vec4f,	// rgb, w: a number of its own, 0 to 1
		@location(7) roof: vec4f,		// rgb, w: the world height of the lowest ground under it
		@location(8) trim: vec4f,		// rgb, w: 1 if its height is to be measured from that ground (a house and its footing)
		@location(9) extra: vec2f,		// x: how high over the foot of its wall, y: 1 if its pattern is laid out from where it is in the world (a stretched box), 2 a tulip
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) uv: vec2f,
		@location(2) @interpolate(flat) material: f32,
		@location(3) @interpolate(flat) plaster: vec4f,
		@location(4) @interpolate(flat) roof: vec3f,
		@location(5) @interpolate(flat) trim: vec3f,
		@location(6) height: f32,		// how high over the foot of its wall (the weathering is worse low down)
		@location(7) @interpolate(flat) worldPattern: f32,
	};

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		let model = mat4x4f(input.m0, input.m1, input.m2, input.m3);
		var world = (model * vec4f(input.shape.xyz, 1.0)).xyz;
		// (a tulip down in its bed out of its season)
		if (input.extra.y > 1.5) {
			world.y -= (1.0 - TU.growth.x) * 1.7;
		}
		var output: VertexOutput;
		output.pos = TU.viewProjectionMatrix * vec4f(world, 1.0);
		output.worldPos = world;
		output.uv = input.uv;
		output.material = input.shape.w;
		output.plaster = input.plaster;
		output.roof = input.roof.rgb;
		output.trim = input.trim.rgb;
		// (a house's from the ground under it, so the ivy and the wear go on up from the footing over the wall without a break)
		output.height = select(input.extra.x, world.y - input.roof.w, input.trim.w > 0.5);
		output.worldPattern = input.extra.y;
		return output;
	}

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;

	${skyLookupShapes}

	${moonShapes}

	// a hash of the bits of the two numbers (a sine hash loses its precision far out in the world, and draws ripples)
	fn hash2(p: vec2f) -> f32 {
		let h = bitcast<vec2u>(p + vec2f(0.0, 0.0));
		var x = h.x * 1664525u + h.y * 1013904223u + 374761393u;
		x = (x ^ (x >> 16u)) * 2246822519u;
		x = (x ^ (x >> 13u)) * 3266489917u;
		x = x ^ (x >> 16u);
		return f32(x) / 4294967295.0;
	}
	fn noise2(p: vec2f) -> f32 {
		let i = floor(p);
		let f = fract(p);
		let u = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), u.x), mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), u.x), u.y);
	}
	fn fbm2(p: vec2f) -> f32 {
		return 0.55 * noise2(p) + 0.3 * noise2(p * 2.13 + vec2f(5.2, 1.7)) + 0.15 * noise2(p * 4.37 - vec2f(3.1, 7.4));
	}

	// Rubble stone in rough courses: rows of stones of different lengths and heights, mortar between. uv in world units, blur: how
	//		much of the surface one pixel covers (further off the joints fade out into the stone's average, rather than flicker).
	//		Returns rgb: the colour, a: 1 on a stone's face, 0 in the mortar (for the lighting to sink the joints)
	fn rubble(uv: vec2f, blur: f32) -> vec4f {
		let rowHeight = 0.62;
		let row = floor(uv.y / rowHeight);
		let rowRand = hash2(vec2f(row, 3.7));
		let inRowY = fract(uv.y / rowHeight);
		let shifted = uv.x + rowRand * 5.0;
		let span = 0.7 + 0.9 * hash2(vec2f(row, floor(shifted / 1.7)));
		let stone = floor(shifted / span);
		let inStoneX = fract(shifted / span);
		let id = hash2(vec2f(stone, row));
		// the joints, ragged, and stones that sit high or low in their course
		let jitter = 0.05 * (noise2(uv * 4.1) - 0.5) + 0.05 * (hash2(vec2f(stone, row + 9.0)) - 0.5);
		let edgeX = min(inStoneX, 1.0 - inStoneX) * span;
		let edgeY = min(inRowY, 1.0 - inRowY) * rowHeight;
		let fade = smoothstep(0.06, 0.25, blur);
		let face = mix(smoothstep(0.03, 0.08, min(edgeX, edgeY) + jitter), 0.82, fade);
		// warm grey, pink and ochre stones, as in Koriko's old walls
		let warm = mix(vec3f(0.6, 0.57, 0.53), vec3f(0.72, 0.6, 0.56), id);
		let ochre = mix(warm, vec3f(0.68, 0.57, 0.42), step(0.82, hash2(vec2f(stone + 3.0, row))));
		let mottle = 0.88 + 0.2 * noise2(uv * 2.3 + vec2f(id * 9.0, 0.0));
		let rounded = mix(0.86 + 0.14 * smoothstep(0.0, 0.18, min(edgeX, edgeY)), 0.95, fade);
		let average = vec3f(0.65, 0.6, 0.55);
		let colour = mix(ochre * mottle * rounded, average, fade * 0.6);
		let mortar = vec3f(0.76, 0.72, 0.66);
		return vec4f(mix(mortar, colour, face), face);
	}

	// Ivy: a mat of small leaves, each its own shade, with the wall showing between. Returns rgb, a: how much leaf
	fn ivyLeaves(uv: vec2f, blur: f32) -> vec4f {
		let size = 0.42;
		let cell = floor(uv / size);
		var best = 0.0;
		var shade = 0.0;
		for (var k = 0; k < 4; k++) {
			let c = cell + vec2f(f32(k % 2), f32(k / 2)) - vec2f(0.5, 0.5);
			let centre = (c + vec2f(hash2(c), hash2(c + vec2f(5.1, 2.3)))) * size;
			let d = (uv - centre) / size;
			// three lobes round the leaf's middle
			let a = atan2(d.y, d.x) + hash2(c + vec2f(1.7, 0.0)) * 6.28;
			let r = length(d) / (0.62 + 0.18 * cos(3.0 * a));
			let leaf = 1.0 - smoothstep(0.75, 0.95, r);
			if (leaf > best) { best = leaf; shade = hash2(c + vec2f(9.3, 4.4)); }
		}
		best = mix(best, 0.7, smoothstep(0.08, 0.3, blur));
		let colour = mix(vec3f(0.12, 0.24, 0.08), vec3f(0.36, 0.5, 0.17), shade) * mix(0.75, 1.0, best);
		return vec4f(colour, best);
	}

	// Cobbles: rounded setts in rows across the street, the rows offset
	fn cobbles(uv: vec2f) -> vec4f {
		let size = vec2f(0.95, 0.75);
		let row = floor(uv.x / size.y);
		let shifted = vec2f(uv.y + 0.5 * size.x * (row % 2.0), uv.x);
		let cell = floor(vec2f(shifted.x / size.x, shifted.y / size.y));
		let f = fract(vec2f(shifted.x / size.x, shifted.y / size.y)) - vec2f(0.5, 0.5);
		let id = hash2(cell + vec2f(row * 0.1, 7.0));
		let dome = 1.0 - smoothstep(0.32, 0.5, max(abs(f.x) * 1.05, abs(f.y)) + 0.05 * length(f));
		let colour = mix(vec3f(0.5, 0.48, 0.46), vec3f(0.62, 0.56, 0.5), id) * (0.85 + 0.25 * noise2(uv * 0.6));
		return vec4f(mix(vec3f(0.3, 0.29, 0.27), colour, dome), dome);
	}

	// Dressed stone: big squared blocks (stair treads, copings, the promenade's flags)
	fn dressed(uv: vec2f) -> vec4f {
		let size = vec2f(2.6, 1.8);
		let row = floor(uv.y / size.y);
		let cell = floor(vec2f((uv.x + 1.3 * (row % 2.0)) / size.x, row));
		let f = fract(vec2f((uv.x + 1.3 * (row % 2.0)) / size.x, uv.y / size.y));
		let edge = min(min(f.x, 1.0 - f.x) * size.x, min(f.y, 1.0 - f.y) * size.y);
		let id = hash2(cell);
		let face = smoothstep(0.02, 0.07, edge);
		let colour = mix(vec3f(0.74, 0.7, 0.64), vec3f(0.8, 0.75, 0.68), id) * (0.9 + 0.15 * noise2(uv * 0.9));
		return vec4f(mix(colour * 0.7, colour, face), face);
	}

	struct FragInput {
		@builtin(position) fragCoord: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) uv: vec2f,
		@location(2) @interpolate(flat) material: f32,
		@location(3) @interpolate(flat) plaster: vec4f,
		@location(4) @interpolate(flat) roof: vec3f,
		@location(5) @interpolate(flat) trim: vec3f,
		@location(6) height: f32,
		@location(7) @interpolate(flat) worldPattern: f32,
	};

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let toIt = input.worldPos - Lights.camPos.xyz;
		let away = length(toIt);
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		if (dot(N, toIt) > 0.0) {
			N = -N;
		}
		// (a stretched box's pattern is laid out from where it is: along the face and up it, or across the top)
		var uv = input.uv;
		if (abs(input.worldPattern - 1.0) < 0.5) {
			uv = select(input.worldPos.xz, vec2f(dot(input.worldPos.xz, normalize(vec2f(-N.z, N.x) + vec2f(0.0001, 0.0))), input.worldPos.y), abs(N.y) < 0.7);
		}
		let what = i32(input.material + 0.5);
		let px = length(fwidth(uv));		// how much of the surface one pixel covers
		let seed = input.plaster.w;
		let night = TU.look.w;
		var albedo = vec3f(0.5, 0.5, 0.5);
		var shine = 0.05;
		var glow = vec3f(0.0, 0.0, 0.0);
		var joint = 1.0;		// how much of the light a joint between stones gets
		switch (what) {
			case 0: {
				// lime plaster over rubble, come away in patches: most of all low down, and in blotches higher up. A thin rim of
				//		broken plaster and dirt round the edge of each
				let blotch = 0.6 * fbm2(uv / 1.9 + vec2f(seed * 61.0, seed * 17.0)) + 0.4 * fbm2(uv / 0.7 - vec2f(seed * 13.0, 3.0));
				let low = 1.0 - smoothstep(0.3, 4.5, input.height);
				let worn = blotch + 0.38 * low * (0.6 + 0.8 * noise2(vec2f(uv.x / 3.0, seed * 7.0)));
				let gone = smoothstep(0.735, 0.75, worn);
				let rim = smoothstep(0.7, 0.735, worn) * (1.0 - gone);
				let stone = rubble(uv, px);
				// the plaster itself: its colour, stained and streaked down from the eaves, dirtier at the foot
				let streak = 0.94 + 0.06 * noise2(vec2f(uv.x * 2.4, uv.y * 0.12 + seed * 5.0));
				let grime = mix(0.8, 1.0, smoothstep(0.0, 3.0, input.height));
				var coat = input.plaster.rgb * streak * grime * (0.96 + 0.05 * noise2(uv * 0.4));
				coat = mix(coat, coat * vec3f(0.78, 0.74, 0.68), rim);
				albedo = mix(coat, stone.rgb, gone);
				joint = mix(1.0, 0.72 + 0.28 * stone.a, gone);
			}
			case 1: {
				let stone = rubble(uv, px);
				albedo = stone.rgb * mix(0.8, 1.0, smoothstep(-2.0, 2.0, input.height));
				joint = 0.72 + 0.28 * stone.a;
			}
			case 2: {
				// roof tiles: rows up the slope, each tile its own shade, a dark line under each row
				let rowY = fract(uv.y / 0.9);
				let tile = floor(vec2f((uv.x + 0.5 * floor(uv.y / 0.9)) / 0.75, uv.y / 0.9));
				let id = hash2(tile + vec2f(seed * 31.0, 0.0));
				let edge = fract((uv.x + 0.5 * floor(uv.y / 0.9)) / 0.75);
				albedo = input.roof * (0.82 + 0.3 * id) * mix(0.62, 1.0, smoothstep(0.0, 0.25, rowY)) * mix(0.85, 1.0, smoothstep(0.0, 0.08, min(edge, 1.0 - edge)));
				// lichen and soot in patches
				albedo = mix(albedo, albedo * vec3f(0.75, 0.8, 0.6), 0.5 * smoothstep(0.6, 0.85, fbm2(uv / 3.0 + vec2f(seed * 13.0, 2.0))));
				shine = 0.12;
			}
			case 3: { albedo = vec3f(0.27, 0.17, 0.11) * (0.85 + 0.2 * noise2(vec2f(uv.x * 0.5, uv.y * 6.0))); }
			case 4: {
				// grey weathered boards
				let board = floor(uv.y / 0.55);
				albedo = mix(vec3f(0.46, 0.42, 0.36), vec3f(0.58, 0.53, 0.45), hash2(vec2f(board, seed * 7.0))) * (0.85 + 0.2 * noise2(vec2f(uv.x * 0.4, uv.y * 8.0)));
				albedo *= mix(0.55, 1.0, smoothstep(0.0, 0.06, min(fract(uv.y / 0.55), 1.0 - fract(uv.y / 0.55))));
			}
			case 5: {
				// glass: dark, the sky a little in it, its glazing bars; at dusk lit warm in some windows
				let bars = step(0.06, abs(fract(uv.x / 0.75) - 0.5) * 2.0 - 0.0) * step(0.06, abs(fract(uv.y / 0.9) - 0.5) * 2.0);
				let lit = step(0.55, hash2(floor(input.worldPos.xz / 1.7) + vec2f(floor(input.worldPos.y / 5.0), seed * 9.0)));
				albedo = mix(input.trim * 0.9, vec3f(0.12, 0.17, 0.2), 1.0 - (1.0 - bars) * 1.0);
				albedo = select(input.trim * 0.9, vec3f(0.11, 0.16, 0.19), bars > 0.5);
				shine = 0.9 * bars;
				glow = vec3f(1.0, 0.72, 0.38) * 0.9 * lit * bars * night;
			}
			case 6: { albedo = input.trim; shine = 0.1; }
			case 7: { albedo = vec3f(0.09, 0.1, 0.1); shine = 0.3; }
			case 8: {
				albedo = vec3f(0.85, 0.82, 0.7);
				glow = vec3f(1.0, 0.7, 0.36) * (0.12 + 1.5 * night);
			}
			case 9: {
				let cobble = cobbles(uv);
				albedo = cobble.rgb;
				joint = 0.7 + 0.3 * cobble.a;
				// worn smooth and darker down the middle of the street
				albedo *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 2.5, abs(uv.y)));
			}
			case 10: {
				let block = dressed(uv);
				albedo = block.rgb;
				joint = 0.8 + 0.2 * block.a;
			}
			case 11: {
				let stripe = step(0.5, fract(uv.x / 1.2));
				albedo = mix(vec3f(0.95, 0.93, 0.88), input.roof, stripe);
			}
			case 12: { albedo = vec3f(0.78, 0.55, 0.22); shine = 0.6; }
			case 13: {
				let course = floor(uv.y / 0.35);
				let brick = fract((uv.x + 0.4 * (course % 2.0)) / 0.8);
				albedo = vec3f(0.55, 0.27, 0.2) * (0.85 + 0.2 * hash2(vec2f(floor((uv.x + 0.4 * (course % 2.0)) / 0.8), course)));
				albedo = mix(vec3f(0.6, 0.57, 0.52), albedo, step(0.06, fract(uv.y / 0.35)) * step(0.05, brick));
			}
			case 14: { albedo = input.trim * 0.55 * (0.85 + 0.2 * noise2(vec2f(uv.x * 4.0, uv.y * 0.6))); }
			case 15: {
				// geraniums: small round heads of red, pink or white over a mass of leaves
				let cell = floor(uv * 6.0);
				let f = fract(uv * 6.0) - vec2f(0.5, 0.5);
				let head = (1.0 - smoothstep(0.22, 0.34, length(f))) * step(0.45, hash2(cell));
				let which = hash2(cell + vec2f(3.0, 1.0));
				let petals = select(select(vec3f(0.95, 0.92, 0.9), vec3f(0.95, 0.45, 0.6), which < 0.66), vec3f(0.88, 0.16, 0.18), which < 0.4);
				let leaves = mix(vec3f(0.14, 0.3, 0.1), vec3f(0.26, 0.42, 0.16), noise2(uv * 9.0));
				albedo = mix(leaves, petals, head);
			}
			case 16: { albedo = mix(vec3f(0.3, 0.55, 0.48), vec3f(0.42, 0.62, 0.55), noise2(uv * 0.8)); shine = 0.2; }
			case 17: {
				let r = length(uv);
				albedo = select(vec3f(0.95, 0.93, 0.85), vec3f(0.1, 0.1, 0.1), (r > 0.85) || (fract(atan2(uv.y, uv.x) / (PI / 6.0)) < 0.08 && r > 0.7));
				glow = vec3f(1.0, 0.9, 0.7) * 0.6 * night;
			}
			case 18: { albedo = vec3f(0.2, 0.33, 0.13) * (0.75 + 0.5 * noise2(uv * 2.0)); }
			case 19: {
				// a rose bush: a mass of small dark leaves (browning in the autumn), and in their season its roses, one colour to a bush
				//		(input.uv.x: its own number). The roses fade into the leaves far off rather than flicker
				let p = input.worldPos * 1.7;
				let cell = floor(p);
				let f = fract(p) - vec3f(0.5, 0.5, 0.5);
				let near = 1.0 - smoothstep(80.0, 220.0, away);
				let bloom = 1.0 - smoothstep(0.26, 0.42, length(f));
				let head = bloom * step(0.4, hash2(cell.xz + vec2f(cell.y * 17.0, cell.y * 5.0))) * TU.season.y * near;
				let which = input.uv.x;
				let petals = select(select(select(vec3f(0.95, 0.85, 0.35), vec3f(0.96, 0.94, 0.9), which < 0.75), vec3f(0.92, 0.5, 0.6), which < 0.5), vec3f(0.72, 0.06, 0.1), which < 0.3);
				let speck = 0.6 * noise2(input.worldPos.xz * 3.1 + vec2f(input.worldPos.y * 2.3, 0.0)) + 0.4 * noise2(input.worldPos.xz * 9.0 - vec2f(input.worldPos.y * 7.0, 3.0));
				let leaves = mix(mix(vec3f(0.09, 0.2, 0.07), vec3f(0.19, 0.33, 0.12), speck), vec3f(0.36, 0.27, 0.1) * (0.7 + 0.5 * speck), 0.7 * TU.season.w);
				// (each rose darker in its heart, where the petals fold in)
				albedo = mix(leaves, petals * (0.62 + 0.45 * smoothstep(0.02, 0.26, length(f))), head);
			}
			case 20: {
				// a tulip's petals: its colour (input.uv.x, one to a bed), deeper at the foot of the cup. Green buds out of their season
				let which = floor(input.uv.x);
				var petal = vec3f(0.85, 0.08, 0.1);
				if (which == 1.0) { petal = vec3f(0.98, 0.8, 0.12); }
				if (which == 2.0) { petal = vec3f(0.95, 0.45, 0.62); }
				if (which == 3.0) { petal = vec3f(0.98, 0.45, 0.1); }
				if (which == 4.0) { petal = vec3f(0.96, 0.94, 0.88); }
				if (which == 5.0) { petal = vec3f(0.45, 0.18, 0.55); }
				petal = petal * mix(0.65, 1.05, input.uv.y);
				albedo = mix(vec3f(0.22, 0.38, 0.14), petal, TU.season.x);
			}
			case 21: {
				// the landing strip's packed earth (uv: along it and across it, world units): pebbly, the wheels' two worn tracks down its
				//		middle darker and smoother, the grass coming in at its edges. Its edges ragged: in and out along it, the land showing
				//		(it is drawn a little wider than the strip), here and there a tongue of grass reaching well in
				let side = select(-11.0, 11.0, uv.y >= 0.0);
				let reach = 24.0 - 5.0 * fbm2(vec2f(uv.x / 16.0, side)) - 2.5 * noise2(vec2f(uv.x / 3.5, side * 0.5)) - 6.0 * smoothstep(0.6, 0.85, fbm2(vec2f(uv.x / 9.0, side * 2.0)));
				if (abs(uv.y) > reach) { discard; }
				let soil = mix(vec3f(0.36, 0.28, 0.19), vec3f(0.47, 0.38, 0.26), fbm2(uv / 6.0));
				var earth = soil * (0.9 + 0.15 * noise2(uv * 3.0));
				let track = 1.0 - smoothstep(0.6, 1.8, abs(abs(uv.y) - 2.2));
				earth *= 1.0 - 0.2 * track * (0.7 + 0.3 * noise2(vec2f(uv.x * 0.05, uv.y)));
				let grassy = smoothstep(15.0, 21.0, abs(uv.y) + 4.0 * fbm2(uv / 5.0)) + 0.35 * smoothstep(0.7, 0.85, fbm2(uv / 9.0 + vec2f(3.0, 0.0)));
				albedo = mix(earth, vec3f(0.22, 0.34, 0.12) * (0.8 + 0.3 * noise2(uv * 1.5)), saturate(grassy));
			}
			case 22: {
				// a footpath's trodden earth (uv: along it and across it, world units; input.height: how much forest is round it, 0 to 1).
				//		Its edges ragged, in and out over the land (it is drawn a little wider than its tread), grass coming in at them in
				//		patches and a tuft or two on it, darker where it is walked most, down the middle. Through the forest, strewn with
				//		fallen leaves on their mulch, thicker towards its edges
				let edge = 1.85 - 0.75 * fbm2(vec2f(uv.x / 2.2, select(-9.0, 9.0, uv.y >= 0.0))) - 0.3 * noise2(vec2f(uv.x * 1.7, uv.y * 3.0));
				if (abs(uv.y) > edge) { discard; }
				let soil = mix(vec3f(0.31, 0.24, 0.16), vec3f(0.41, 0.33, 0.22), fbm2(uv / 2.5));
				var earth = soil * (0.85 + 0.25 * noise2(uv * 5.0));
				earth *= 1.0 - 0.12 * (1.0 - smoothstep(0.1, 0.8, abs(uv.y)));
				let leafy = saturate(input.height);
				let grassy = smoothstep(0.55, 0.75, fbm2(uv / 1.6 + vec2f(7.0, 2.0))) * smoothstep(edge - 0.9, edge - 0.1, abs(uv.y)) + 0.5 * smoothstep(0.8, 0.9, fbm2(uv / 1.1 + vec2f(1.0, 9.0)));
				earth = mix(earth, vec3f(0.2, 0.32, 0.11) * (0.8 + 0.4 * noise2(uv * 2.0)), saturate(grassy) * (1.0 - 0.7 * leafy));
				if (leafy > 0.01) {
					earth = mix(earth, vec3f(0.24, 0.16, 0.09) * (0.85 + 0.3 * noise2(uv * 3.0)), 0.4 * leafy);
					// (a leaf to a cell, or none: each turned its own way, its own colour)
					let cell = floor(uv * 2.6);
					let r = hash2(cell);
					let spot = fract(uv * 2.6) - vec2f(0.5) + (vec2f(hash2(cell + vec2f(3.1, 0.0)), hash2(cell + vec2f(0.0, 5.7))) - 0.5) * 0.4;
					let turn = r * 6.283;
					let along = vec2f(spot.x * cos(turn) - spot.y * sin(turn), spot.x * sin(turn) + spot.y * cos(turn));
					let leaf = 1.0 - smoothstep(0.2, 0.26, length(along * vec2f(1.0, 2.0)));
					let density = leafy * (0.75 + 0.25 * smoothstep(0.3, 1.4, abs(uv.y)));
					let colour = mix(mix(vec3f(0.5, 0.33, 0.15), vec3f(0.62, 0.47, 0.24), hash2(cell + vec2f(9.0, 9.0))), vec3f(0.42, 0.22, 0.09), step(0.7, hash2(cell + vec2f(4.0, 4.0))));
					earth = mix(earth, colour * (0.85 + 0.3 * noise2(uv * 9.0)), leaf * step(1.0 - density, r));
				}
				albedo = earth;
			}
			default: {}
		}

		// snow lying on the flowers, on what faces up
		if (what == 19 || what == 20 || what == 18) {
			albedo = mix(albedo, vec3f(0.9, 0.92, 0.95), TU.season.z * smoothstep(0.2, 0.7, N.y));
		}

		// ivy, up from the foot of some stretches of wall (plaster and stone, not roofs), in tongues of different heights, ragged at the top
		if (what <= 1 && abs(N.y) < 0.5) {
			let stretch = hash2(vec2f(floor(uv.x / 11.0), seed * 37.0 + 2.0));
			if (stretch > 0.62) {
				let reach = (1.5 + 8.0 * fbm2(vec2f(uv.x / 4.5 + seed * 41.0, 1.3))) * smoothstep(0.62, 0.75, stretch);
				let edge = reach + 0.9 * (noise2(uv * 1.7) - 0.5);
				let cover = 1.0 - smoothstep(edge - 0.6, edge, input.height);
				let leaves = ivyLeaves(uv, px);
				let ivy = cover * leaves.a;
				albedo = mix(albedo * mix(1.0, 0.55, cover), leaves.rgb, ivy);
				joint = mix(joint, 0.95, ivy);
			}
		}

		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let V = normalize(-toIt);
		let light = (0.12 + daylight * (0.4 + 0.75 * saturate(dot(N, L)))) * joint;
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.35 * (1.0 - saturate(L.y * 3.0)));
		let gloss = pow(saturate(dot(N, normalize(L + V))), 24.0) * shine * daylight;
		var color = albedo * (light * sunTint + moonLight(N)) + vec3f(gloss) + glow;
		if (TU.look.y > 0.5) {
			let horizonColor = fogColorAt(toIt);
			let fog = 1.0 - exp(-pow(away / TU.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, 1.0);
	}
`;
