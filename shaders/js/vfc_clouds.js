export const CLOUD_SHAPE_SIZE = 128;		// texels along each side of the shape noise, a cube
export const CLOUD_DETAIL_SIZE = 64;		// and of the detail noise
export const CLOUD_NOISE_WORKGROUP = 4;		// the noise is made in blocks of 4 x 4 x 4 texels
export const CLOUD_MAP_SIZE = 256;			// texels along each side of the cloud coverage map
export const CLOUD_MAP_WORKGROUP = 8;

/*
	Volumetric clouds, the way they have been done in games since Horizon Zero Dawn (Schneider, "The Real-time Volumetric
	Cloudscapes of Horizon Zero Dawn", 2015) and are in Microsoft Flight Simulator 2020: the clouds are not models, they are
	a density, a number for every point of a slab of sky that says how much cloud is there, and a picture of them is made by
	walking a ray out from every pixel through the slab and adding up what it meets (ray marching).

	THE LAYERS
		low			the one the weather is made of: heaps (cumulus) in fair weather, a lumpy sheet when it is overcast, deep
					dark rain cloud in a storm. Its bottom is well under the height of the mountains, which stand up through it
		middle		small heaps in wide fields, far above the peaks (altocumulus). Thin: there to give the sky depth
		cirrus		ice, higher again: not a volume, a streaked sheet the ray goes through once
		Each ray walks through the low and the middle layer in whichever order it meets them.

	WHERE THERE IS CLOUD (cloudDensity)
		the weather map		a picture laid over the world from above that says, place by place, how much cloud there is.
							It drifts with the wind. The weather (weather.js) says how much of it counts as cloud.
		the height			a cloud has a flat bottom and a rounded top, and how tall it stands depends on its kind:
							a sheet (stratus), heaps (cumulus), or a tower
		the shape noise		a 3D texture of Perlin-Worley noise: the billows. Perlin noise gives the wandering lumps, Worley
							(cellular) noise the round cauliflower heads, and one is used to hollow out the other. Read
							twice: once for the heaps themselves, and again three times finer for the heads on them
		the detail noise	a small 3D texture of fine Worley noise that eats away at the edges, so they are wispy

	HOW IT IS LIT (the march in vf_cloudMarch)
		At every step that lands in cloud a second, short walk is made towards the sun to find how much cloud is in the way
		(Beer's law: light dies off exponentially with how much it passes through). What gets through is scattered towards the
		eye by how the cloud scatters (mostly on forwards: the bright silver lining round a cloud in front of the sun),
		and the sky adds its own light from all sides. Light bouncing about inside the cloud is not followed, it is stood in
		for by adding the same thing again, weaker and less directional, a few times (Wrenninge's octaves).

	WHAT MAKES A HEAP LOOK LIKE A HEAP (the things that are easy to leave out, and leave a cloud looking like fog)
		a sharp edge		the density climbs steeply from nothing at the edge of a heap, so its outline is a line and
							not a haze (Crispness)
		worn edges			the fine noise only eats at the outside of the cloud, and the place it is read from is pushed
							about by the shape noise so it never shows as a pattern
		folds				the body of a cloud is brighter than its thin edges and its underside, because light is
							scattered into it from all round (Schneider's "in-scatter probability"). It is what draws
							the creases between one billow and the next: without it a cloud is brightest at its rim
		steps that grow		the steps along a ray start short and lengthen with distance, so the cloud nearby is
							walked finely however long the ray is

	THE COVERAGE MAP (c_cloudCoverage)
		A picture taken from above that sees only the clouds: for every place on the ground, how much of the sun the cloud
		over it lets through, how much cloud there is straight up, and whether it is raining there. It is what puts the
		shadows of the clouds on the ground and the water, and what says where the rain falls.
*/

// what every one of the cloud shaders is given
const cloudUniforms =
`
	struct CloudUniforms
	{
		invViewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz
		lightDirection : vec4f,		// xyz: towards the sun, or the moon at night, 1 long
		lightColor : vec4f,			// rgb: the color and strength of that light. a: how strong the light of the sky is
		layer : vec4f,				// x: height of the bottom of the clouds, y: of their top, z: of the cirrus, w: half the width of the world
		weather : vec4f,			// x: coverage, y: kind (0 sheet, 0.5 heaps, 1 towers), z: density, w: how much cirrus
		scroll : vec4f,				// xy: how far the clouds have drifted, z: 1 / the size of a tile of the weather map, w: gloom (how grey the cloud is)
		tower : vec4f,				// the cumulonimbus. xy: where it stands (x, z), z: its radius, w: how built up it is, 0 none
		screen : vec4f,				// xy: the size of the picture the march draws (half the screen), zw: the two numbers that turn a depth into a distance
		map : vec4f,				// the coverage map. xy: the middle of it (x, z), z: 1 / its width, w: the height its shadows are worked out at
		quality : vec4f,			// x: steps along a ray, y: how far off clouds are drawn, z: where they fade into the haze, w: rain, 0 to 1
		middle : vec4f,				// the middle layer. x: height of its bottom, y: of its top, z: how much of the sky it covers (0 none), w: how thick it is
		shape : vec4f,				// x: how many times deeper than the low layer a cumulonimbus stands, y: how sharp the edge of a heap is, z: 1.0 if there is cirrus
		moon : vec4f,				// xyz: towards the moon, w: the angle from the middle of its disc to its edge, radians
		moonLook : vec4f,			// x: how strongly the disc shows, 0 none
	}
	@group(0) @binding(0) var<uniform> CU: CloudUniforms;
`;

// Where there is cloud, and how much. Needs the 4 textures and 2 samplers bound under these names
const cloudDensity =
`
	@group(0) @binding(1) var shapeNoise: texture_3d<f32>;		// r: Perlin-Worley, gba: Worley at 3 sizes
	@group(0) @binding(2) var detailNoise: texture_3d<f32>;		// rgb: fine Worley at 3 sizes
	@group(0) @binding(3) var weatherMap: texture_2d<f32>;		// r, a: where the cloud is. g: what kind. b: cirrus
	@group(0) @binding(4) var mountainMap: texture_2d<f32>;		// r: how much mountain there is under a place
	@group(0) @binding(5) var repeatSampler: sampler;
	@group(0) @binding(6) var clampSampler: sampler;

	const SHAPE_TILE: f32 = 1500.0;		// world size of one tile of the shape noise: a billow is about a third of this
	const DETAIL_TILE: f32 = 380.0;

	// left behind by cloudDensity and middleDensity: how far into the body of the cloud the point is, 0 at its edge, before the
	//		fine noise has worn the edges. The light is worked out from it (see "folds" at the top of the file)
	var<private> cloudBody: f32;

	fn remap(value: f32, fromLow: f32, fromHigh: f32, toLow: f32, toHigh: f32) -> f32 {
		return toLow + (value - fromLow) / (fromHigh - fromLow) * (toHigh - toLow);
	}

	// how high the clouds can reach anywhere: the top of the layer, or of the thunderhead if there is one
	fn cloudCeiling() -> f32 {
		return CU.layer.y + (CU.shape.x - 1.0) * (CU.layer.y - CU.layer.x) * step(0.001, CU.tower.w);
	}

	// The weather over a place. x: how much cloud, 0 to 1. y: what kind. z: how far it is from the middle of the cumulonimbus, in radii of it
	fn weatherAt(xz: vec2f) -> vec3f {
		let map = textureSampleLevel(weatherMap, repeatSampler, (xz - CU.scroll.xy) * CU.scroll.z, 0.0);
		let mountains = textureSampleLevel(mountainMap, clampSampler, (xz + vec2f(CU.layer.w, CU.layer.w)) / (2.0 * CU.layer.w), 0.0).r;

		// the weather map is cloud wherever it is above a line, and the coverage sets the line. Cloud gathers over mountains
		let field = map.r * 0.75 + map.a * 0.25 + 0.06 * mountains;
		// (never quite all the way: heaped cloud always has the shape noise cutting bays and towers into it. A sheet or a rain cloud is let fill in)
		let cover = saturate(remap(field, 1.0 - CU.weather.x, 1.0 - CU.weather.x + 0.3, 0.0, 1.0)) * mix(0.66, 1.0, smoothstep(0.7, 0.95, CU.weather.x));
		let kind = saturate(CU.weather.y + (map.g - 0.5) * 0.35);
		return vec3f(cover, kind, distance(xz, CU.tower.xy) / CU.tower.z);
	}

	// how much cloud there is at a height through the layer (0 its bottom, 1 its top), for a kind of cloud
	fn cloudProfile(h: f32, kind: f32) -> f32 {
		let sheet = smoothstep(0.0, 0.06, h) * (1.0 - smoothstep(0.16, 0.32, h));
		let heaps = smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(0.35, 0.9, h));
		let towers = smoothstep(0.0, 0.07, h) * (1.0 - smoothstep(0.7, 1.0, h));
		return mix(mix(sheet, heaps, saturate(kind * 2.0)), towers, saturate(kind * 2.0 - 1.0));
	}

	// How much cloud there is at a point. detailed: whether to wear the edges away with the detail noise (not worth it for shadows)
	fn cloudDensity(p: vec3f, detailed: bool) -> f32 {
		if (p.y <= CU.layer.x) {
			return 0.0;
		}
		let weather = weatherAt(p.xz);
		let depth = CU.layer.y - CU.layer.x;
		let h = (p.y - CU.layer.x) / depth;								// how far up through the layer
		let towerH = h / CU.shape.x;									// and through the cumulonimbus, which stands far above it
		let inTower = CU.tower.w > 0.0 && weather.z < 1.7 && towerH < 1.0;
		if ((h >= 1.0 || weather.x <= 0.0) && !inTower) {
			return 0.0;
		}

		// the billows. They drift with the weather map, and lean over a little with height, as cloud does in wind that is faster higher up
		let drifted = p - vec3f(CU.scroll.x, 0.0, CU.scroll.y) * (1.0 + 0.25 * min(h, 1.0));
		let shape = textureSampleLevel(shapeNoise, repeatSampler, drifted / SHAPE_TILE, 0.0);
		let worley = shape.g * 0.5 + shape.b * 0.3 + shape.a * 0.2;
		// the heads on the heaps: the same noise three times finer, cut out of the heaps. They are in the cloud the light
		//		is walked through as well, so each head shades the one behind it, which is what makes them show
		let heads = textureSampleLevel(shapeNoise, repeatSampler, drifted / (SHAPE_TILE * 0.31) + vec3f(0.17, 0.43, 0.71), 0.0).g;
		let billows = saturate(remap(saturate(remap(shape.r, worley - 1.0, 1.0, 0.0, 1.0)), (1.0 - heads) * 0.42, 1.0, 0.0, 1.0));

		// cloud is whatever of the billows stands above a line that the coverage sets
		var density = 0.0;
		if (h < 1.0 && weather.x > 0.0) {
			density = saturate(remap(billows * cloudProfile(h, weather.y), 1.0 - weather.x, 1.0, 0.0, 1.0)) * weather.x;
		}
		var thickest = mix(0.55, 1.25, min(h, 1.0));		// thicker towards the top, where the water has had longer to condense

		// The cumulonimbus: a column that swells out on its way up and spreads at the top into the anvil, where it meets air
		//		it cannot rise through. Its outline is pushed in and out by the billows, or it would be a turned shape
		if (inTower) {
			let girth = 0.5 + 0.2 * sin(towerH * 3.14159) + 0.85 * smoothstep(0.68, 0.94, towerH);
			let outward = weather.z / girth + 0.5 * (worley - 0.5);
			let cover = (1.0 - smoothstep(0.5, 1.0, outward)) * CU.tower.w;
			let column = smoothstep(0.0, 0.05, towerH) * (1.0 - smoothstep(0.9, 1.0, towerH));
			let towering = saturate(remap(billows * column, 1.0 - cover, 1.0, 0.0, 1.0)) * cover;
			if (towering > density) {
				density = towering;
				thickest = mix(0.9, 1.5, towerH);
			}
		}
		if (density <= 0.0) {
			return 0.0;
		}
		cloudBody = density;

		if (detailed) {
			// wispy at the bottom (the detail is cut out of the cloud), billowy higher up (its inverse is). Read from a place
			//		pushed about by the shape noise, and only the outside of the cloud is worn: its body is solid
			let fine = textureSampleLevel(detailNoise, repeatSampler, (drifted + (shape.gba - vec3f(0.5, 0.5, 0.5)) * 110.0) / DETAIL_TILE, 0.0).rgb;
			let fineWorley = fine.r * 0.5 + fine.g * 0.3 + fine.b * 0.2;
			let wear = mix(fineWorley, 1.0 - fineWorley, saturate(h * 5.0));
			density = saturate(remap(density, wear * 0.62 * (1.0 - 0.45 * density), 1.0, 0.0, 1.0));
		}
		// the edge of a heap is sharp: a little way in it is already nearly as thick as it gets. (A sheet is left soft)
		let crisp = CU.shape.y * saturate(weather.y * 2.0);
		density = mix(density, 1.0 - pow(1.0 - density, 4.0), crisp);
		return density * CU.weather.z * thickest;
	}

	// How much cloud there is at a point of the middle layer: the same billows, read smaller, in fields of their own
	fn middleDensity(p: vec3f, detailed: bool) -> f32 {
		let h = (p.y - CU.middle.x) / (CU.middle.y - CU.middle.x);
		if (CU.middle.z <= 0.0 || h <= 0.0 || h >= 1.0) {
			return 0.0;
		}
		let drifted = p - vec3f(CU.scroll.x, 0.0, CU.scroll.y) * 1.35;		// (the wind is faster up there)
		let map = textureSampleLevel(weatherMap, repeatSampler, drifted.xz * CU.scroll.z * 1.9 + vec2f(0.37, 0.11), 0.0);
		let cover = saturate(remap(map.a * 0.55 + map.g * 0.45, 1.0 - CU.middle.z, 1.0 - CU.middle.z + 0.22, 0.0, 1.0));
		if (cover <= 0.0) {
			return 0.0;
		}
		let shape = textureSampleLevel(shapeNoise, repeatSampler, drifted / (SHAPE_TILE * 0.42) + vec3f(0.3, 0.6, 0.1), 0.0);
		let worley = shape.g * 0.5 + shape.b * 0.3 + shape.a * 0.2;
		let billows = saturate(remap(shape.r, worley - 1.0, 1.0, 0.0, 1.0));
		let profile = smoothstep(0.0, 0.2, h) * (1.0 - smoothstep(0.45, 1.0, h));
		var density = saturate(remap(billows * profile, 1.0 - 0.8 * cover, 1.0, 0.0, 1.0)) * cover;
		if (density <= 0.0) {
			return 0.0;
		}
		cloudBody = density;
		if (detailed) {
			let fine = textureSampleLevel(detailNoise, repeatSampler, drifted / (DETAIL_TILE * 0.6), 0.0).rgb;
			let wear = 1.0 - (fine.r * 0.5 + fine.g * 0.3 + fine.b * 0.2);
			density = saturate(remap(density, wear * 0.5 * (1.0 - 0.45 * density), 1.0, 0.0, 1.0));
		}
		density = mix(density, 1.0 - pow(1.0 - density, 4.0), CU.shape.y);
		return density * CU.middle.w * 0.8;
	}
`;

/*
	The two noise textures, made once when the page loads. Both repeat: every lattice the noise is built on wraps round at
	the edge of the texture, so the clouds can be tiled across the sky without a seam.
		kind 0: the shape noise		r: Perlin-Worley, g b a: Worley at 3 sizes, each the sum of 3 finer and finer layers
		kind 1: the detail noise	r g b: Worley at 3 finer sizes
*/
export const c_cloudNoise =
`
	struct NoiseUniforms
	{
		size : f32,		// texels along a side
		kind : f32,
	}
	@group(0) @binding(0) var<uniform> NU: NoiseUniforms;
	@group(0) @binding(1) var noiseOut: texture_storage_3d<rgba8unorm, write>;

	fn hash3(cell: vec3f) -> vec3f {
		var q = fract(cell * vec3f(0.1031, 0.1030, 0.0973));
		q += dot(q, q.yxz + vec3f(33.33, 33.33, 33.33));
		return fract((q.xxy + q.yxx) * q.zyx);
	}

	// which cell of a lattice that repeats every period cells this is
	fn wrapped(cell: vec3f, period: f32) -> vec3f {
		return cell - period * floor(cell / period);
	}

	// Worley noise, turned over: 1.0 at the point of a cell, falling to 0.0 a cell's width from it. p: 0 to 1 across the texture
	fn worley(p: vec3f, period: f32) -> f32 {
		let scaled = p * period;
		let base = floor(scaled);
		let f = fract(scaled);
		var nearest = 8.0;
		for (var k = -1; k <= 1; k++) {
			for (var j = -1; j <= 1; j++) {
				for (var i = -1; i <= 1; i++) {
					let corner = vec3f(f32(i), f32(j), f32(k));
					let toPoint = corner + hash3(wrapped(base + corner, period) + vec3f(period, period, period)) - f;
					nearest = min(nearest, dot(toPoint, toPoint));
				}
			}
		}
		return 1.0 - saturate(sqrt(nearest));
	}

	fn worleyLayers(p: vec3f, period: f32) -> f32 {
		return worley(p, period) * 0.625 + worley(p, period * 2.0) * 0.25 + worley(p, period * 4.0) * 0.125;
	}

	// gradient (Perlin) noise that repeats every period cells, about -1 to 1
	fn perlin(p: vec3f, period: f32) -> f32 {
		let scaled = p * period;
		let base = floor(scaled);
		let f = fract(scaled);
		let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
		var total = 0.0;
		for (var k = 0; k <= 1; k++) {
			for (var j = 0; j <= 1; j++) {
				for (var i = 0; i <= 1; i++) {
					let corner = vec3f(f32(i), f32(j), f32(k));
					let slope = normalize(hash3(wrapped(base + corner, period) + vec3f(7.0, period, 3.0)) * 2.0 - vec3f(1.0, 1.0, 1.0));
					let weight = mix(1.0 - u.x, u.x, f32(i)) * mix(1.0 - u.y, u.y, f32(j)) * mix(1.0 - u.z, u.z, f32(k));
					total += dot(slope, f - corner) * weight;
				}
			}
		}
		return total * 1.5;
	}

	@compute @workgroup_size(${CLOUD_NOISE_WORKGROUP}, ${CLOUD_NOISE_WORKGROUP}, ${CLOUD_NOISE_WORKGROUP})
	fn computeMain(@builtin(global_invocation_id) id: vec3u) {
		if (f32(id.x) >= NU.size || f32(id.y) >= NU.size || f32(id.z) >= NU.size) {
			return;
		}
		let p = (vec3f(id) + vec3f(0.5, 0.5, 0.5)) / NU.size;

		if (NU.kind > 0.5) {
			textureStore(noiseOut, id, vec4f(worleyLayers(p, 2.0), worleyLayers(p, 4.0), worleyLayers(p, 8.0), 1.0));
			return;
		}

		// Perlin, 5 layers of it, as a number 0 to 1
		var billow = 0.0;
		var strength = 0.5;
		var period = 4.0;
		for (var layer = 0; layer < 5; layer++) {
			billow += perlin(p, period) * strength;
			strength *= 0.5;
			period *= 2.0;
		}
		billow = saturate(billow * 0.5 + 0.5);

		let worleyWide = worleyLayers(p, 3.0);
		// Perlin-Worley: the Perlin with its low places filled in up to the Worley, so the lumps have round heads
		let perlinWorley = saturate(mix(worleyWide, 1.0, billow));
		textureStore(noiseOut, id, vec4f(perlinWorley, worleyWide, worleyLayers(p, 6.0), worley(p, 12.0) * 0.625 + worley(p, 24.0) * 0.375));
	}
`;

/*
	The coverage map: the clouds as seen from straight above (see the top of the file).
		r	how much of the sun gets through the cloud to the ground at this place, 1.0 clear to 0.0 dark. Worked out along the
			way to the sun, not straight up: the shadow of a cloud lies down-sun of it
		g	how much cloud there is straight overhead, 0 to 1
		b	how hard it is raining here, 0 to 1
*/
export const c_cloudCoverage =
`
	${cloudUniforms}
	${cloudDensity}

	@group(0) @binding(7) var coverageOut: texture_storage_2d<rgba8unorm, write>;

	const SHADOW_STEPS: i32 = 10;
	const OVERHEAD_STEPS: i32 = 6;

	@compute @workgroup_size(${CLOUD_MAP_WORKGROUP}, ${CLOUD_MAP_WORKGROUP})
	fn computeMain(@builtin(global_invocation_id) id: vec3u) {
		let uv = (vec2f(id.xy) + vec2f(0.5, 0.5)) / ${CLOUD_MAP_SIZE}.0;
		let xz = CU.map.xy + (uv - vec2f(0.5, 0.5)) / CU.map.z;
		let ceiling = cloudCeiling();

		// towards the sun, from where the way to it from the ground here comes up into the bottom of the clouds.
		//		(a sun right down on the horizon is taken as a little way up, or the shadows would run off for ever)
		let toLight = normalize(vec3f(CU.lightDirection.x, max(CU.lightDirection.y, 0.14), CU.lightDirection.z));
		let enter = vec3f(xz.x, CU.map.w, xz.y) + toLight * ((CU.layer.x - CU.map.w) / toLight.y);
		let stride = (ceiling - CU.layer.x) / toLight.y / f32(SHADOW_STEPS);
		var inTheWay = 0.0;
		for (var i = 0; i < SHADOW_STEPS; i++) {
			inTheWay += cloudDensity(enter + toLight * (stride * (f32(i) + 0.5)), false) * stride;
		}

		// and straight up
		let rise = (ceiling - CU.layer.x) / f32(OVERHEAD_STEPS);
		var overhead = 0.0;
		for (var i = 0; i < OVERHEAD_STEPS; i++) {
			overhead += cloudDensity(vec3f(xz.x, CU.layer.x + rise * (f32(i) + 0.5), xz.y), false) * rise;
		}
		let cover = 1.0 - exp(-overhead * 0.016);

		// rain falls out of the deep of the cloud, not from under its ragged edges
		let rain = smoothstep(0.55, 0.9, cover) * CU.quality.w;
		textureStore(coverageOut, id.xy, vec4f(exp(-inTheWay * 0.008), cover, rain, 1.0));
	}
`;

/*
	The march: one ray out from every pixel through the slab of sky the clouds are in (see the top of the file).
	Drawn at half size, into a texture: rgb is the light the clouds send to the eye, a is how much of what is behind them
	still shows through. vf_cloudComposite lays it over the frame.
*/
export const vf_cloudMarch =
`
	${cloudUniforms}
	${cloudDensity}

	@group(0) @binding(7) var depthTexture: texture_depth_2d;
	@group(0) @binding(8) var skyLUT: texture_2d<f32>;

	const PI: f32 = 3.14159265;
	const LIGHT_STEPS: i32 = 6;
	const MIDDLE_LIGHT_STEPS: i32 = 3;
	const SCATTER: f32 = 0.03;			// how much of the light a unit of cloud of density 1 scatters, per world unit

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
		let corner = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
		return vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
	}

	// the light of the sky from a direction, as the sky view LUT has it (not yet exposed for the screen)
	fn skyLight(direction: vec3f) -> vec3f {
		let azimuth = atan2(-direction.z, -direction.x);
		let elevation = asin(clamp(direction.y, -1.0, 1.0));
		return textureSampleLevel(skyLUT, clampSampler, vec2f(azimuth / (2.0 * PI) + 0.5, elevation / PI + 0.5), 0.0).rgb;
	}

	// Henyey-Greenstein: how much of the light arriving along one direction leaves along another, by the cosine of the angle
	//		between them. g: 0 the same every way, towards 1 nearly all of it straight on
	fn phase(cosAngle: f32, g: f32) -> f32 {
		let g2 = g * g;
		return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * cosAngle, 1.5));
	}

	fn pixelNoise(pixel: vec2f) -> f32 {
		return fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
	}

	// how much cloud lies between a point and the sun: a short walk towards it, in steps that grow
	fn cloudToLight(p: vec3f) -> f32 {
		var inTheWay = 0.0;
		var reach = 0.0;
		var stride = 28.0;
		for (var i = 0; i < LIGHT_STEPS; i++) {
			inTheWay += cloudDensity(p + CU.lightDirection.xyz * (reach + 0.5 * stride), false) * stride;
			reach += stride;
			stride *= 1.7;
		}
		return inTheWay;
	}

	// and the same for a point of the middle layer
	fn middleToLight(p: vec3f) -> f32 {
		var inTheWay = 0.0;
		var reach = 0.0;
		var stride = 30.0;
		for (var i = 0; i < MIDDLE_LIGHT_STEPS; i++) {
			inTheWay += middleDensity(p + CU.lightDirection.xyz * (reach + 0.5 * stride), false) * stride;
			reach += stride;
			stride *= 2.0;
		}
		return inTheWay;
	}

	// The stretch of a ray that lies between two heights. x: how far along it that stretch starts, y: where it ends (before x if there is none)
	fn stretchBetween(origin: vec3f, direction: vec3f, low: f32, high: f32, furthest: f32) -> vec2f {
		if (abs(direction.y) > 0.00001) {
			let toLow = (low - origin.y) / direction.y;
			let toHigh = (high - origin.y) / direction.y;
			return vec2f(max(min(toLow, toHigh), 0.0), min(max(toLow, toHigh), furthest));
		}
		if (origin.y < low || origin.y > high) {
			return vec2f(0.0, -1.0);
		}
		return vec2f(0.0, furthest);
	}

	fn mountainsUnder(xz: vec2f) -> f32 {
		return textureSampleLevel(mountainMap, clampSampler, (xz + vec2f(CU.layer.w, CU.layer.w)) / (2.0 * CU.layer.w), 0.0).r;
	}

	@fragment
	fn fragmentMain(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
		//------------------THE RAY-----------------
		let uv = fragCoord.xy / CU.screen.xy;
		let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
		let nearPoint = CU.invViewProjectionMatrix * vec4f(ndc, 0.0, 1.0);
		let farPoint = CU.invViewProjectionMatrix * vec4f(ndc, 1.0, 1.0);
		let origin = CU.cameraPosition.xyz;
		let direction = normalize(farPoint.xyz / farPoint.w - nearPoint.xyz / nearPoint.w);

		// how far it can go: to whatever solid thing was drawn at this pixel, if anything was
		let depth = textureLoad(depthTexture, min(vec2i(fragCoord.xy) * 2, vec2i(textureDimensions(depthTexture)) - vec2i(1, 1)), 0);
		var furthest = CU.quality.y;
		if (depth < 1.0) {
			let scenePoint = CU.invViewProjectionMatrix * vec4f(ndc, depth, 1.0);
			furthest = min(furthest, distance(scenePoint.xyz / scenePoint.w, origin));
		}

		// the stretches of it that are inside the two layers
		let lowStretch = stretchBetween(origin, direction, CU.layer.x, cloudCeiling(), furthest);
		let middleStretch = stretchBetween(origin, direction, CU.middle.x, CU.middle.y, furthest);

		var light = vec3f(0.0, 0.0, 0.0);		// what the clouds send to the eye
		var through = 1.0;						// how much of what is behind them still shows
		var meanDistance = 0.0;					// how far off the cloud is, weighted by how much of it shows
		var meanWeight = 0.0;

		//------------------THE LIGHT-----------------
		let cosAngle = dot(direction, CU.lightDirection.xyz);
		// (straight on and a little back: the silver lining, and the faint brightening of a cloud with the sun behind the viewer)
		let lobes = mix(phase(cosAngle, 0.75), phase(cosAngle, -0.25), 0.4);
		let ambientHigh = skyLight(vec3f(0.0, 1.0, 0.0)) + skyLight(normalize(vec3f(CU.lightDirection.x, 0.35, CU.lightDirection.z)));
		let ambientLow = skyLight(normalize(vec3f(direction.x, 0.08, direction.z)));
		let grey = 1.0 - 0.75 * CU.scroll.w;
		let jitter = pixelNoise(fragCoord.xy);

		// the two layers, the nearer one first
		for (var turn = 0; turn < 2; turn++) {
			let isMiddle = (turn == 0) == (middleStretch.x < lowStretch.x);
			var stretch = lowStretch;
			var steps = i32(CU.quality.x);
			if (isMiddle) {
				stretch = middleStretch;
				steps = max(steps / 3, 8);
				if (CU.middle.z <= 0.0) {
					continue;
				}
			}
			if (stretch.y <= stretch.x) {
				continue;
			}

			//------------------THE MARCH-----------------
			// The steps start short (no shorter than the detail they could find) and each is a little longer than the last, by
			//		however much it takes for them to reach the end of the stretch between them. A ray that grazes along a layer for
			//		miles walks the near cloud as finely as one that goes straight up through it, and the far cloud coarsely
			let reachOut = stretch.y - stretch.x;
			let first = clamp(reachOut / f32(steps), 12.0, 46.0);
			// (a long stretch gets more steps as well, up to 3 times as many: stretched over too few, the far steps are so long
			//		that where each one happens to land shows, as stripes across the far cloud)
			let longer = log(max(reachOut / (first * f32(steps)), 1.0));
			steps = i32(f32(steps) * clamp(1.0 + longer, 1.0, 3.0));
			let growth = 1.7 * log(max(reachOut / (first * f32(steps)), 1.0)) / f32(steps);
			var stride = first;
			// every pixel takes each step at a different place along it: grain instead of bands, however long the step
			let along = fract(jitter + 0.618 * f32(turn));
			var stepStart = stretch.x;
			for (var i = 0; i < steps; i++) {
				let travelled = stepStart + stride * along;
				if (travelled >= stretch.y || through < 0.01) {
					break;
				}
				let p = origin + direction * travelled;
				var density = 0.0;
				var h = 0.0;
				if (isMiddle) {
					density = middleDensity(p, true);
					h = saturate((p.y - CU.middle.x) / (CU.middle.y - CU.middle.x));
				} else {
					density = cloudDensity(p, true);
					h = saturate((p.y - CU.layer.x) / (cloudCeiling() - CU.layer.x));		// (through the whole of the slab: with a cumulonimbus standing, that is to the top of it)
				}
				if (density > 0.0) {
					let body = cloudBody;
					var inTheWay = 0.0;
					if (isMiddle) {
						inTheWay = middleToLight(p) * SCATTER;
					} else {
						inTheWay = cloudToLight(p) * SCATTER;
					}

					// the light that gets here from the sun and is sent on to the eye. Three times over, each time weaker,
					//		reaching deeper and less particular about direction: it stands in for the light that bounces about inside
					var sun = 0.0;
					var weaker = 1.0;
					var deeper = 1.0;
					var rounder = 1.0;
					for (var bounce = 0; bounce < 3; bounce++) {
						sun += weaker * exp(-inTheWay * deeper) * mix(1.0 / (4.0 * PI), lobes, rounder);
						weaker *= 0.5;
						deeper *= 0.35;
						rounder *= 0.5;
					}
					// folds: more light is scattered in to the body of a cloud than to its thin edges, and less to its underside
					sun *= (0.3 + 0.7 * pow(saturate(body * 2.4), mix(0.45, 1.1, h))) * mix(0.6, 1.0, smoothstep(0.0, 0.3, h));
					// and from the sky: from above in the top of the cloud, only from the horizon down in the bottom of it
					let ambient = mix(ambientLow, ambientHigh * 0.5, h) * CU.lightColor.a * mix(0.3, 1.0, h);
					let lit = (CU.lightColor.rgb * sun * 4.0 * PI * grey + ambient * grey * 0.3);

					// what this step adds, and what it hides of everything further on (Hillaire's energy conserving sum)
					let fade = exp(-density * SCATTER * stride);
					light += through * lit * (1.0 - fade);
					meanDistance += travelled * through * (1.0 - fade);
					meanWeight += through * (1.0 - fade);
					through *= fade;
				}
				stepStart += stride;
				stride *= 1.0 + growth;
			}
		}

		//------------------CIRRUS-----------------
		// High thin streaks of ice, far above the rest: not a volume, just a sheet the ray passes through once.
		//		Only where the ray gets that far: where nothing solid is in the way
		if (direction.y > 0.02 && depth >= 1.0 && CU.weather.w > 0.0 && CU.shape.z > 0.5 && origin.y < CU.layer.z) {
			let reach = (CU.layer.z - origin.y) / direction.y;
			if (reach < CU.quality.y * 1.6) {
				let at = origin.xz + direction.xz * reach;
				let drifted = (at - CU.scroll.xy * 1.6) * CU.scroll.z;
				// the weather map read long and thin makes streaks, and read from a place pushed aside by itself the streaks
				//		curl at their ends: mares' tails
				let curl = textureSampleLevel(weatherMap, repeatSampler, drifted * 2.3 + vec2f(0.61, 0.13), 0.0).ga - vec2f(0.5, 0.5);
				let streaks = textureSampleLevel(weatherMap, repeatSampler, drifted * vec2f(1.2, 3.9) + curl * 0.07, 0.0).b * 0.6
							+ textureSampleLevel(weatherMap, repeatSampler, drifted * vec2f(4.1, 11.3) + curl * 0.16 + vec2f(0.3, 0.7), 0.0).b * 0.4;
				// There is more of it over the mountains: over the ground the cirrus itself is above, and wherever the line of sight
				//		passes over a range on its way up (which is where cirrus is seen to stand behind the peaks: the cloud
				//		straight over a mountain is nearly overhead by the time the mountain is near enough to see)
				let pastPeaks = origin.xz + direction.xz * max((CU.map.w + 1100.0 - origin.y) / direction.y, 0.0);
				let mountains = max(mountainsUnder(at), mountainsUnder(pastPeaks));
				let amount = CU.weather.w * mix(0.5, 1.45, mountains);
				let sheet = smoothstep(1.0 - 0.58 * amount, 1.0 - 0.58 * amount + 0.36, streaks) * 0.55 * (1.0 - smoothstep(0.5, 1.0, reach / (CU.quality.y * 1.6)));
				let cirrusLight = CU.lightColor.rgb * (0.5 + 2.2 * phase(dot(direction, CU.lightDirection.xyz), 0.6)) + skyLight(vec3f(0.0, 1.0, 0.0)) * CU.lightColor.a * 0.4;
				light += through * cirrusLight * sheet;
				through *= 1.0 - sheet;
			}
		}

		// far off the clouds go into the haze like everything else: they just fade away into the sky behind them
		if (meanWeight > 0.0) {
			let clear = exp(-pow(meanDistance / meanWeight / CU.quality.z, 2.0));
			light *= clear;
			through = 1.0 - (1.0 - through) * clear;
		}
		return vec4f(light, through);
	}
`;

/*
	Lays the clouds over the frame. The march is at half size, so every pixel here sits among several of its pixels. Blending
	those evenly would smear cloud over the edge of anything that stands in front of it, so each of them counts for more the
	closer the depth it was marched to is to the depth of this pixel.

	The moon's disc is drawn here too, and not with the sky, because here it is known how much cloud is in front of it.
	A cloud that lets half of the sky through does not show half a moon: the disc is a small sharp thing, and what a cloud
	does to it is smear it out. So the disc gets the cube of what the sky gets, and is gone behind anything but the thinnest cloud.

	The light is in the sky view LUT's terms, so it is exposed for the screen the same way the sky is (see f_sky).
*/
export const vf_cloudComposite =
`
	${cloudUniforms}

	@group(0) @binding(1) var cloudTexture: texture_2d<f32>;
	@group(0) @binding(2) var depthTexture: texture_depth_2d;

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
		let corner = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
		return vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
	}

	fn viewDistance(depth: f32) -> f32 {
		return CU.screen.w / (depth + CU.screen.z);
	}

	@fragment
	fn fragmentMain(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
		let fullSize = vec2i(textureDimensions(depthTexture));
		let halfSize = vec2i(textureDimensions(cloudTexture));
		let here = viewDistance(textureLoad(depthTexture, vec2i(fragCoord.xy), 0));

		// the 9 pixels of the march around this one. (9 and not the nearest 4: every ray of the march starts a different way
		//		into its first step, by a pattern made to even out over any 3 by 3 block, and this is where it is evened out)
		let place = fragCoord.xy * 0.5 - vec2f(0.5, 0.5);
		let base = vec2i(round(place));
		var total = vec4f(0.0, 0.0, 0.0, 0.0);
		var weights = 0.0;
		for (var j = -1; j <= 1; j++) {
			for (var i = -1; i <= 1; i++) {
				let texel = clamp(base + vec2i(i, j), vec2i(0, 0), halfSize - vec2i(1, 1));
				let there = viewDistance(textureLoad(depthTexture, min(texel * 2, fullSize - vec2i(1, 1)), 0));
				let apart = length(vec2f(texel) - place);
				let weight = (1.0 - 0.3 * apart) / (0.001 + abs(there - here) / here);
				total += textureLoad(cloudTexture, texel, 0) * weight;
				weights += weight;
			}
		}
		let cloud = total / weights;
		let hidden = 1.0 - cloud.a;

		// the moon: a plain white disc wherever the view comes within its radius of the way to the moon, in the sky only
		var moonLight = vec3f(0.0, 0.0, 0.0);
		if (CU.moonLook.x > 0.0 && textureLoad(depthTexture, vec2i(fragCoord.xy), 0) >= 1.0) {
			let ndc = vec2f(fragCoord.x / f32(fullSize.x) * 2.0 - 1.0, 1.0 - fragCoord.y / f32(fullSize.y) * 2.0);
			let nearPoint = CU.invViewProjectionMatrix * vec4f(ndc, 0.0, 1.0);
			let farPoint = CU.invViewProjectionMatrix * vec4f(ndc, 1.0, 1.0);
			let direction = normalize(farPoint.xyz / farPoint.w - nearPoint.xyz / nearPoint.w);
			let fromMiddle = acos(clamp(dot(direction, CU.moon.xyz), -1.0, 1.0));
			let disc = 1.0 - smoothstep(0.93 * CU.moon.w, CU.moon.w, fromMiddle);
			moonLight = vec3f(0.95, 0.96, 1.0) * disc * CU.moonLook.x * smoothstep(-0.02, 0.01, direction.y) * cloud.a * cloud.a * cloud.a;
		}
		if (hidden <= 0.001) {
			return vec4f(moonLight, 1.0);
		}

		// the color of the cloud itself (the light it sends, over how much of the pixel it covers), exposed for the screen like the sky
		let exposed = 1.0 - exp(-(cloud.rgb / hidden) * 10.0);
		let color = pow(exposed, vec3f(1.0 / 2.2));
		// (the blending adds this to what is there times a: the frame shows through by as much as the cloud lets it)
		return vec4f(color * hidden + moonLight, cloud.a);
	}
`;

/*
	The shadow of the clouds on a place, for any shader that wants it. It binds the coverage map and a sampler under the names
	cloudMap and cloudMapSampler, and passes in the 4 numbers of cloudMapValues() (clouds.js).
		position	where, in the world
		toLight		towards the sun, 1 long
		map			xy: the middle of the coverage map (x, z), z: 1 / its width, w: the height its shadows were worked out at
	Returns what c_cloudCoverage wrote: r: how much sun gets through, g: how much cloud is overhead, b: rain. Clear sky outside the map.
*/
export const cloudShadeShapes =
`
	fn cloudShadeAt(position: vec3f, toLight: vec3f, map: vec4f) -> vec3f {
		// the map is worked out for ground at one height. Higher ground is in the shadow that would fall further down-sun at that height
		let lean = toLight.xz / max(toLight.y, 0.14) * (position.y - map.w);
		let uv = (position.xz - lean - map.xy) * map.z + vec2f(0.5, 0.5);
		let inside = step(0.0, min(min(uv.x, uv.y), 1.0 - max(uv.x, uv.y)));
		let shade = textureSampleLevel(cloudMap, cloudMapSampler, uv, 0.0).rgb;
		return mix(vec3f(1.0, 0.0, 0.0), shade, inside);
	}
`;
