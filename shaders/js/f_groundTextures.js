/*
	What the ground is made of, close up: marbled rock for the mountains, sand for the beaches, turf for the grassland, and
	the litter of needles and dead leaves under the trees. There are no pictures behind any of it, every one is worked out for each pixel
	from where the pixel is in the world, so they never repeat, never stretch and cost no memory.

	Each returns two things: a color, and a RELIEF, how far the surface stands up (+) or is sunk (-) at that spot, in world
	units. It is never more than a few centimetres. The terrain uses the relief twice:
		to light the pixel as if the surface really had that shape (it leans the normal by the slope of the relief),
		and to move the pixel's DEPTH by it. That is the part taken from Days Gone (the same talk as c_SSS.js): there every
		material puts out a "depth bias", the fine up and down of its surface, about 8cm either way, and it is added to the
		depth the frame keeps. Nothing looks different for it directly. But everything that works from the depth afterwards
		now finds the grain of the ground there: the screen space shadows cast a shadow from every pebble and every
		fallen leaf, and the ambient occlusion darkens every hollow.

	The tools are few, and the same ones every time:
		noise				smooth random hills (noiseAndSlope and noise, in vf_terrain.js)
		domain warping		reading a pattern from a place that has been pushed aside by noise, which bends anything straight
		a sine				for anything that comes in stripes: veins, ripples
		abs and inversion	1 - |x| turns a smooth wave into a sharp ridge
		cells				cellular (Worley, Voronoi) noise: points scattered one to a square, and every place belongs to the
							nearest. The points make pebbles and leaves

	All of them fade out as they get down to the size of a pixel (pixel: how much ground one pixel covers here), or they would
	turn to sparkle. They need the noise from rockShapes (vf_terrain.js) in the shader ahead of them.
*/
export const groundTextures =
`
	//------------------CELLS-----------------
	// 2 numbers that look random, 0 to 1, for a place on the map (Dave Hoskins' hash without sine)
	fn hash2(p: vec2f) -> vec2f {
		var q = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
		q += dot(q, q.yzx + vec3f(33.33, 33.33, 33.33));
		return fract((q.xx + q.yz) * q.zy);
	}

	struct Cell
	{
		nearest : f32,		// how far it is to the nearest point
		border : f32,		// how much further the second nearest is: 0 on the border between two cells, growing in to the middle of one
		toPoint : vec2f,	// from here to the nearest point
		id : vec2f,			// 2 random numbers that belong to that point, the same all over its cell
	}

	// Cellular noise over the map: one point somewhere in every square of a grid 1 across, and the cell of a point is everywhere that is nearer to it than to any other
	fn cellsAt(p: vec2f) -> Cell {
		let base = floor(p);
		let f = fract(p);
		var cell: Cell;
		var nearest = 8.0;
		var second = 8.0;
		for (var j = -1; j <= 1; j++) {
			for (var i = -1; i <= 1; i++) {
				let corner = vec2f(f32(i), f32(j));
				let random = hash2(base + corner);
				let toPoint = corner + random - f;
				let apart = dot(toPoint, toPoint);
				if (apart < nearest) {
					second = nearest;
					nearest = apart;
					cell.toPoint = toPoint;
					cell.id = random;
				} else if (apart < second) {
					second = apart;
				}
			}
		}
		cell.nearest = sqrt(nearest);
		cell.border = sqrt(second) - cell.nearest;
		return cell;
	}

	/*
		MARBLED ROCK
		rgb: what to multiply the color of the stone by. a: relief.

		Pale veins, at three sizes: the largest to be seen from across a valley and the smallest from a few steps away. Each is
		a sine through the rock, sharpened to a thin line by 1 - |sine| raised to a power: the pale threads of marble, with a
		fainter glow to either side of each. They come in seams (veined rock here, plain stone there), and are read from
		places pushed aside by noise, so no vein is straight.

		The veins run up and down. Everything is read with height squashed to under a third, so every shape is over
		three times as tall as it is wide.

		A line thinner than a pixel is not drawn at all (it would only sparkle), so from far off a mountain has its widest
		veins and nothing else, and the finer ones come in as the camera does.
	*/
	fn marbleRock(position: vec3f, pixel: f32) -> vec4f {
		var tint = vec3f(1.0, 1.0, 1.0);
		var relief = 0.0;

		// the push: a wide slow one and a finer one on top
		let tall = position * vec3f(1.0, 0.3, 1.0);
		let pushWide = vec3f(noiseAndSlope(tall / 47.0).x, noiseAndSlope(tall / 47.0 + vec3f(19.1, 7.3, 33.7)).x, noiseAndSlope(tall / 47.0 + vec3f(5.9, 23.3, 11.2)).x) - vec3f(0.5, 0.5, 0.5);
		let pushFine = vec3f(noiseAndSlope(tall / 11.0 + vec3f(3.3, 0.0, 8.1)).x, noiseAndSlope(tall / 11.0 + vec3f(27.9, 4.4, 2.2)).x, noiseAndSlope(tall / 11.0 + vec3f(14.4, 9.1, 31.0)).x) - vec3f(0.5, 0.5, 0.5);

		var size = 78.0;	// how far apart this layer's veins are, world units
		for (var layer = 0; layer < 3; layer++) {
			let warped = tall + pushWide * size * 0.9 + pushFine * size * 0.2 + vec3f(f32(layer) * 31.7, f32(layer) * 5.3, f32(layer) * 12.9);

			//veins
			let veinShown = saturate(0.035 * size / pixel - 0.6);
			if (veinShown > 0.0) {
				let turn = f32(layer) * 2.1 + 0.6;
				let wave = abs(sin(dot(warped, vec3f(cos(turn), 0.3, sin(turn))) * 3.14159 / size));
				// (not all through the rock: a seam of them here, plain stone there)
				let seam = smoothstep(0.4, 0.62, noiseAndSlope(tall / (size * 1.7) + vec3f(2.0, f32(layer) * 21.0, 17.0)).x);
				let vein = (pow(1.0 - wave, 12.0) + 0.1 * pow(1.0 - wave, 3.0)) * veinShown * seam;
				tint *= mix(vec3f(1.0, 1.0, 1.0), vec3f(1.5, 1.48, 1.44), 0.55 * vein);
				relief += 0.01 * vein;
			}

			size *= 0.27;
		}
		return vec4f(tint, relief);
	}

	/*
		SAND
		rgb: what to multiply the color of the sand by. a: relief.
			wet: 0 dry to 1 wet through (the strip the waves reach, and everything under the water)

		ripples		the little ridges the wind (or under water, the swash) leaves across sand: a sine, bent by noise, sharpened
					to ridges by 1 - |sine|. In patches, and washed nearly flat where the sand is wet
		grain		noise at the size of a grain, and now and then a dark one
		stones		the points of the cells: a pebble or a bit of shell lies at one in seven of them
	*/
	fn beachSand(xz: vec2f, pixel: f32, wet: f32) -> vec4f {
		// lighter and darker stretches
		var tint = vec3f(1.0, 1.0, 1.0) * (0.95 + 0.1 * noise(xz / 7.0));
		var relief = 0.0;

		//ripples
		let rippleLength = 1.2;
		let rippleShown = saturate(rippleLength / (pixel * 5.0) - 1.0);
		if (rippleShown > 0.0) {
			let push = noise(xz / 5.5) * 2.6 + noise(xz / 1.9 + vec2f(7.0, 3.0)) * 0.55;
			let ridge = 1.0 - abs(sin((dot(xz, vec2f(0.86, 0.5)) + push) * 3.14159 / rippleLength));
			let rippled = smoothstep(0.3, 0.62, noise(xz / 14.0 + vec2f(3.0, 9.0))) * rippleShown * (1.0 - 0.75 * wet);
			relief += (ridge * ridge - 0.33) * 0.09 * rippled;
			tint *= 1.0 + (ridge * ridge - 0.33) * 0.12 * rippled;
		}

		//stones and shell
		let stoneShown = saturate(0.4 / (pixel * 3.0) - 1.0);
		if (stoneShown > 0.0) {
			let cell = cellsAt(xz / 1.3);
			let radius = 0.07 + 0.13 * cell.id.y;
			let rounded = saturate(1.0 - cell.nearest / radius);
			let stone = step(0.86, cell.id.x) * smoothstep(0.0, 0.3, rounded) * stoneShown;
			let pale = step(0.5, fract(cell.id.y * 7.3));		// shell, or a dark pebble
			tint = mix(tint, mix(vec3f(0.68, 0.64, 0.6), vec3f(1.12, 1.1, 1.06), pale), stone);
			relief += sqrt(rounded) * 0.07 * stone;
		}

		//grain
		let grainShown = saturate(0.09 / (pixel * 2.5) - 1.0);
		if (grainShown > 0.0) {
			let coarse = noise(xz / 0.07);
			let fine = noise(xz / 0.031 + vec2f(9.0, 4.0));
			tint *= 1.0 + ((coarse - 0.5) * 0.18 + (fine - 0.5) * 0.12) * grainShown;
			tint *= 1.0 - 0.3 * smoothstep(0.8, 0.92, fine) * grainShown;
			relief += (coarse - 0.5) * 0.012 * grainShown;
		}

		// wet sand is darker, and a little colder
		tint *= mix(vec3f(1.0, 1.0, 1.0), vec3f(0.66, 0.65, 0.64), wet);
		return vec4f(tint, relief);
	}

	/*
		TURF
		rgb: what to multiply the color of the grassland by. a: relief.

		Grass seen from above and from far off: what the ground under the blades is, and all there is of a meadow from further
		away than the blades are drawn. Made to look like a field of them, so the one runs into the other.
			patches		wide stretches of lusher and drier grass, which can be told apart from any distance
			tufts		cells, at three sizes: each its own shade of green (and the odd one dry, as the odd blade is), darker
						round its edge where it goes under the next. The widest are whole stands of grass, and show from a hilltop
			blades		noise stretched many times longer than it is wide is a mat of flattened blades. Five of them, at
						five angles, lighter where a blade lies on top and darker between
	*/
	fn grassTurf(xz: vec2f, pixel: f32) -> vec4f {
		//patches
		let lush = noise(xz / 95.0 + vec2f(13.0, 4.0));
		let parched = smoothstep(0.55, 0.82, noise(xz / 37.0 + vec2f(1.0, 27.0)));
		var tint = mix(vec3f(0.84, 0.9, 0.82), vec3f(1.1, 1.07, 1.0), lush);
		tint = mix(tint, tint * vec3f(1.2, 1.06, 0.74), 0.5 * parched);
		var relief = 0.0;

		//tufts
		var tuftSize = 11.0;
		for (var layer = 0; layer < 3; layer++) {
			let tuftShown = saturate(tuftSize / (pixel * 3.0) - 1.0);
			if (tuftShown > 0.0) {
				let cell = cellsAt(xz / tuftSize + vec2f(f32(layer) * 17.0, f32(layer) * 3.0));
				let inFromEdge = smoothstep(0.0, 0.3, cell.border);
				var shade = vec3f(1.0, 1.0, 1.0) * (0.84 + 0.3 * cell.id.x) * (0.8 + 0.2 * inFromEdge);
				shade = mix(shade, shade * vec3f(1.25, 1.1, 0.7), step(0.9, cell.id.y) * 0.8);
				let strength = tuftShown * select(0.6, 1.0, layer == 1);
				tint *= mix(vec3f(1.0, 1.0, 1.0), shade, strength);
				relief += (inFromEdge - 0.5) * 0.01 * min(tuftSize, 3.0) * strength;
			}
			tuftSize = select(0.55, 2.6, layer == 0);
		}

		//blades
		let bladeShown = saturate(0.06 / (pixel * 1.4) - 1.0);
		if (bladeShown > 0.0) {
			var lying = 0.0;
			for (var k = 0; k < 5; k++) {
				// (each layer dead straight. Turning the angle from place to place bends the streaks round into whorls)
				let angle = f32(k) * 0.628 + 0.3;
				let lengthways = vec2f(cos(angle), sin(angle));
				let stretched = vec2f(dot(xz, lengthways) / 0.55, dot(xz, vec2f(-lengthways.y, lengthways.x)) / 0.05);
				lying = max(lying, smoothstep(0.5, 0.74, noise(stretched + vec2f(f32(k) * 17.0, f32(k) * 3.0))));
			}
			tint *= mix(1.0, mix(0.72, 1.24, lying), bladeShown);
			relief += (lying - 0.4) * 0.03 * bladeShown;
		}
		return vec4f(tint, relief);
	}

	/*
		THE FOREST FLOOR
		rgb: its color. a: relief.

		Dark soil, and lying on it:
		needles		noise stretched twenty times longer than it is wide is a mat of straws. Three of them, at three angles
					(each bent a little from place to place), the brightest one at any spot on top
		leaves		one to a cell, where there is one at all: a pointed oval about the point of the cell, turned its own
					way, in its own shade of brown, with a rib down the middle. Two layers of them, so they overlap
		moss		in patches

		More needles in some stretches and more leaves in others, as it is under conifers and under broadleaves.
	*/
	fn forestFloor(xz: vec2f, pixel: f32) -> vec4f {
		// (mottled, which is all that can be seen of the litter from further off than its pieces can be told apart)
		var color = vec3f(0.19, 0.13, 0.08) * (0.75 + 0.3 * noise(xz / 3.1) + 0.3 * noise(xz / 0.45));
		var relief = 0.0;
		let conifer = smoothstep(0.35, 0.65, noise(xz / 41.0 + vec2f(11.0, 5.0)));

		//moss
		let moss = smoothstep(0.55, 0.75, noise(xz / 9.0 + vec2f(2.0, 31.0)) + 0.25 * (noise(xz / 1.3) - 0.5));
		color = mix(color, vec3f(0.13, 0.24, 0.08) * (0.8 + 0.4 * noise(xz / 0.35)), moss * 0.8);
		relief += moss * 0.02;

		//needles
		let needleShown = saturate(0.045 / (pixel * 1.4) - 1.0);
		if (needleShown > 0.0) {
			var straw = 0.0;
			var which = 0.0;
			for (var k = 0; k < 3; k++) {
				let angle = f32(k) * 1.047 + 0.4 + (noise(xz / 2.3 + vec2f(f32(k) * 5.0, 0.0)) - 0.5) * 1.1;
				let lengthways = vec2f(cos(angle), sin(angle));
				let stretched = vec2f(dot(xz, lengthways) / 0.9, dot(xz, vec2f(-lengthways.y, lengthways.x)) / 0.045);
				let lying = smoothstep(0.6, 0.74, noise(stretched + vec2f(f32(k) * 17.0, f32(k) * 3.0)));
				if (lying > straw) {
					straw = lying;
					which = f32(k);
				}
			}
			let needleColor = mix(vec3f(0.4, 0.24, 0.12), vec3f(0.56, 0.42, 0.22), fract(which * 0.37 + noise(xz / 0.6)));
			let lain = straw * needleShown * mix(0.4, 1.0, conifer) * (1.0 - 0.6 * moss);
			color = mix(color, needleColor, lain);
			relief += 0.015 * lain;
		}

		//leaves
		let leafShown = saturate(0.3 / (pixel * 3.0) - 1.0);
		if (leafShown > 0.0) {
			for (var layer = 0; layer < 2; layer++) {
				let cell = cellsAt(xz / 0.62 + vec2f(f32(layer) * 13.3, f32(layer) * 7.1));
				// turned its own way
				let angle = cell.id.y * 6.2832;
				let own = vec2f(cos(angle) * cell.toPoint.x + sin(angle) * cell.toPoint.y, cos(angle) * cell.toPoint.y - sin(angle) * cell.toPoint.x);
				// a pointed oval: narrower towards both ends
				let outward = length(vec2f(own.x, own.y * (1.9 + 1.6 * abs(own.x)))) / 0.43;
				let fallen = step(cell.id.x, mix(0.88, 0.4, conifer));		// fewer under conifers
				let leaf = fallen * (1.0 - smoothstep(0.86, 1.0, outward)) * leafShown;
				let rib = 1.0 - smoothstep(0.0, 0.03, abs(own.y));
				let shade = fract(cell.id.x * 9.7 + cell.id.y * 3.1);
				var leafColor = mix(vec3f(0.36, 0.2, 0.09), vec3f(0.43, 0.32, 0.15), smoothstep(0.0, 0.5, shade));
				leafColor = mix(leafColor, vec3f(0.2, 0.12, 0.07), smoothstep(0.55, 1.0, shade));
				// darker along the rib and lighter out at the edge, which has curled up
				color = mix(color, leafColor * (1.0 - 0.3 * rib) * (0.82 + 0.3 * outward), leaf);
				relief = max(relief, (0.02 + 0.04 * outward * outward) * leaf);
			}
		}
		return vec4f(color, relief);
	}
`;
