import { settings } from '../../code/settings.js';

/*
	THE MEADOW'S LOOK: the grassland is not one even green. Three slow things over it, the same for the ground under the grass
	(vf_terrain.js), the blades on it (vfc_grass.js) and the bushes (flora.js), so they agree:
		dry		0 lush to 1 dry: wide patches of a deeper green and of olive and straw, wandering over a couple of hundred metres
		scrub	where the bushes stand thick (THE BIG ONES in flora.js: their thickets, the same noise to the bit): the ground worn to
				brown earth and litter between them, the grass short and thin there
		stony	patches of stony ground, the bedrock come up through the turf (more of them on a slope): grey, the grass gone from
				most of it, and the stones standing up out of it (vf_terrain.js: THE STONY GROUND)
	M: world units to the metre (settings.forestUnitsPerMetre, which flora.js's thickets are made in)
*/
export const MEADOW_SCRUB = { from: 0.56, to: 0.72 };
export const MEADOW_PALETTE_BINDING = 43;	// the season's colors (code/meadowPalette.js): where the land and the grass take them	// how far over the thickets' noise the scrub goes from none to all (flora.js: BIG.clump)
export const meadowShapes = `
	const MEADOW_M: f32 = ${Number(settings.forestUnitsPerMetre).toFixed(4)};
	// flora.js's squareRandom and smoothNoise, the same numbers to the bit (its thickets: salt 5, a lattice every 28 metres)
	fn meadowRandom(i: i32, j: i32, salt: i32) -> f32 {
		var h = (bitcast<u32>(i) * 73856093u) ^ (bitcast<u32>(j) * 19349663u) ^ (bitcast<u32>(salt + 1) * 83492791u);
		h ^= h >> 16u; h *= 0x7feb352du; h ^= h >> 15u; h *= 0x846ca68bu; h ^= h >> 16u;
		return f32(h) / 4294967296.0;
	}
	fn meadowNoise(p: vec2f, salt: i32) -> f32 {
		let c = floor(p);
		let i = i32(c.x);
		let j = i32(c.y);
		let f = p - c;
		let s = f * f * (3.0 - 2.0 * f);
		return mix(mix(meadowRandom(i, j, salt), meadowRandom(i + 1, j, salt), s.x), mix(meadowRandom(i, j + 1, salt), meadowRandom(i + 1, j + 1, salt), s.x), s.y);
	}
	// x: dry, y: scrub, z: stony (see THE MEADOW'S LOOK). up: how level the ground is (its normal's y)
	fn meadowLook(xz: vec2f, up: f32) -> vec3f {
		let dry = saturate(0.5 + 2.1 * (0.68 * meadowNoise(xz / (190.0 * MEADOW_M), 31) + 0.32 * meadowNoise(xz / (85.0 * MEADOW_M), 32) - 0.5));
		let thicket = meadowNoise(xz / (28.0 * MEADOW_M), 5);
		let scrub = smoothstep(${MEADOW_SCRUB.from}, ${MEADOW_SCRUB.to}, thicket + 0.06 * (meadowNoise(xz / (4.0 * MEADOW_M), 33) - 0.5));
		let stones = 0.62 * meadowNoise(xz / (24.0 * MEADOW_M), 41) + 0.38 * meadowNoise(xz / (6.5 * MEADOW_M), 42) + 0.9 * (1.0 - smoothstep(0.86, 0.98, up));
		let stony = smoothstep(0.7, 0.8, stones + 0.08 * (meadowNoise(xz / (2.5 * MEADOW_M), 43) - 0.5));
		return vec3f(dry, scrub * (1.0 - stony), stony);
	}
	// the grassland's green there, lush to dry (a color of the grassland's, times this)
	fn meadowTint(look: vec3f) -> vec3f {
		return mix(vec3f(0.82, 0.97, 0.74), vec3f(1.72, 1.06, 1.18), look.x * look.x * (3.0 - 2.0 * look.x));
	}
	// THE MEADOW'S COLORS (code/meadowPalette.js): the season's ramp of four, lush to dry, and its maroon (a: how much of it)
	struct MeadowPalette {
		stops: array<vec4f, 4>,
		maroon: vec4f,
	}
	@group(0) @binding(${MEADOW_PALETTE_BINDING}) var<uniform> MEADOW: MeadowPalette;
	fn meadowColor(xz: vec2f, look: vec3f) -> vec3f {
		let t = saturate(look.x) * 3.0;
		let i = i32(min(floor(t), 2.0));
		let f = smoothstep(0.0, 1.0, t - f32(i));
		let c = mix(MEADOW.stops[i].rgb, MEADOW.stops[i + 1].rgb, f);
		let red = smoothstep(0.58, 0.76, meadowNoise(xz / (38.0 * MEADOW_M), 71)) * MEADOW.maroon.a;
		return mix(c, MEADOW.maroon.rgb, red * 0.8);
	}
	const MEADOW_EARTH: vec3f = vec3f(0.34, 0.26, 0.16);	// the scrub's worn earth
	const MEADOW_LITTER: vec3f = vec3f(0.42, 0.31, 0.15);	// and the dead leaves on it
	const MEADOW_STONE: vec3f = vec3f(0.47, 0.46, 0.43);	// the stony ground's stone
`;

/*
	THE STONY GROUND, CLOSE UP (vf_terrain.js, its own; it needs cellsAt from f_groundTextures.js): stones bedded in the soil, each a cell
	of a cellular pattern (so they are angular, and fit together with soil between), flat topped and rounded at their edges, the stonier
	the ground the more and the bigger of them. They stand up out of the mesh, which is the soil, and are traced along the line of
	sight: the place where it first meets a stone is what is seen (parallax occlusion), so a stone hides the soil behind it, and its
	side faces the camera, as a real one does. Its height is the ground's relief there, which leans the light (vf_terrain.js: the
	relief's slope) and moves the depth, so the shadows and the ambient occlusion find it too.
		stonyGround: rgb its color, a its height above the soil (world units)
*/
export const STONY_NEAR = 30;		// metres: out to here the stones are traced (fading out over the last part of it); further, the flat grey
export const stonyShapes = `
	const STONE_CELL: f32 = 0.42;		// metres from one stone to the next
	const STONE_TALL: f32 = 0.16;		// the tallest of them stands this far out of the soil, metres
	struct Stones {
		height: f32,		// world units over the soil
		id: vec2f,			// the stone's own random numbers
		edge: f32,			// 0 at its edge, 1 well in
	}
	// (one size of stone: in cells cell metres across, a share of them with a stone, each a rounded lump r of its cell across, tall)
	fn stoneLayer(xz: vec2f, cell: f32, share: f32, r: f32, tall: f32, salt: vec2f) -> Stones {
		let c = cellsAt(xz / (cell * MEADOW_M) + salt);
		var found: Stones;
		found.id = c.id;
		let radius = r * (0.65 + 0.6 * c.id.y);
		let d = c.nearest / radius;
		found.edge = saturate(1.0 - d);
		let here = step(c.id.x, share);
		// (a lump, flattish on top, a little lopsided: the far side of its point lower than the near)
		let lump = sqrt(saturate(1.0 - d * d)) * (1.0 - 0.3 * dot(c.toPoint / max(radius, 0.001), vec2f(c.id.x - 0.5, c.id.y - 0.5)));
		// (and broken off flat where it meets the next cell: angular, the faces of broken rock, not a pebble)
		let facet = smoothstep(0.0, 0.16, c.border / max(radius, 0.001) + 0.6 * (1.0 - d));
		found.height = here * lump * facet * tall * MEADOW_M * (0.5 + 0.5 * c.id.x);
		return found;
	}
	/*
		THE STONES OF A STONY PATCH: loose stones of two sizes, the big ones few and the small ones many, each a lump of its own with
		gravel and soil showing between them; the stonier the ground the more of them (amount). Where both are, the higher is the one seen
	*/
	fn stonesAt(xz: vec2f, amount: f32) -> Stones {
		let big = stoneLayer(xz, STONE_CELL * 2.2, 0.2 + 0.35 * amount, 0.42, STONE_TALL * 1.5, vec2f(0.0, 0.0));
		let small = stoneLayer(xz, STONE_CELL * 0.75, 0.25 + 0.5 * amount, 0.36, STONE_TALL * 0.55, vec2f(17.3, 5.1));
		if (big.height >= small.height) {
			return big;
		}
		return small;
	}
	// eye: the camera; up: the ground's normal; amount: how stony (meadowLook's z); steps: how many along the line of sight (fewer further off)
	fn stonyGround(worldPos: vec3f, eye: vec3f, up: vec3f, amount: f32, steps: i32) -> vec4f {
		let d = normalize(worldPos - eye);
		let top = STONE_TALL * MEADOW_M;
		let down = max(-dot(d, up), 0.15);
		let shift = (d - up * dot(d, up)).xz / down;		// how far over the ground the line of sight goes for each unit it comes down
		// (from where it crosses the height of the tallest stone, down to the soil, the mesh, here)
		let start = worldPos.xz - shift * top;
		let stride = top / f32(steps);
		var fell = 0.0;
		var before = 0.0;
		var aboveBefore = top - stonesAt(start, amount).height;
		var at = worldPos.xz;
		for (var i = 1; i <= steps; i++) {
			fell = f32(i) * stride;
			let xz = start + shift * fell;
			let above = (top - fell) - stonesAt(xz, amount).height;		// how far over the stone (or the soil) the line of sight still is
			if (above <= 0.0) {
				// (between the last step over and this one under: once more at the straight line's guess, then the guess between)
				var t = aboveBefore / max(aboveBefore - above, 0.00001);
				let middle = mix(before, fell, t);
				let aboveMiddle = (top - middle) - stonesAt(start + shift * middle, amount).height;
				if (aboveMiddle > 0.0) {
					t = aboveMiddle / max(aboveMiddle - above, 0.00001);
					at = start + shift * mix(middle, fell, t);
				} else {
					t = aboveBefore / max(aboveBefore - aboveMiddle, 0.00001);
					at = start + shift * mix(before, middle, t);
				}
				break;
			}
			before = fell;
			aboveBefore = above;
		}
		let s = stonesAt(at, amount);
		// the stone: grey, each its own shade, warmer or cooler, paler on top and darker down its sides; spots of lichen on some,
		//		and moss over the tops of others
		let tint = mix(vec3f(0.94, 0.97, 1.03), vec3f(1.08, 1.0, 0.9), s.id.y);
		var stone = MEADOW_STONE * tint * (0.7 + 0.45 * s.id.x) * mix(0.62, 1.08, s.edge);
		let lichen = smoothstep(0.62, 0.7, meadowNoise(at / (0.07 * MEADOW_M), 51)) * step(0.55, s.id.y);
		stone = mix(stone, vec3f(0.66, 0.66, 0.5), lichen * 0.55 * s.edge);
		let moss = smoothstep(0.45, 0.65, meadowNoise(at / (0.25 * MEADOW_M), 53)) * step(0.72, fract(s.id.x * 7.3)) * smoothstep(0.2, 0.6, s.edge);
		stone = mix(stone, vec3f(0.24, 0.34, 0.1) * (0.8 + 0.4 * meadowNoise(at / (0.04 * MEADOW_M), 54)), moss * 0.85);
		// the ground between: gravel and grit, grey and brown, and mossy right up against the stones
		let grit = meadowNoise(at / (0.03 * MEADOW_M), 55);
		let gravel = mix(MEADOW_EARTH * 0.75, MEADOW_STONE * 0.82, smoothstep(0.35, 0.75, grit)) * (0.8 + 0.3 * meadowNoise(at / (0.012 * MEADOW_M), 56));
		let soil = mix(gravel, vec3f(0.2, 0.28, 0.1), 0.45 * smoothstep(0.0, 0.6, 1.0 - s.edge) * step(0.001, s.height));
		let isStone = smoothstep(0.0, 0.18 * STONE_TALL * MEADOW_M, s.height);
		return vec4f(mix(soil, stone, isStone), s.height);
	}
`;
