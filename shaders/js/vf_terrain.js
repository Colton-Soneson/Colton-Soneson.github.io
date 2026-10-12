import { TERRAIN_ZONES, ZONE_OCEAN, ZONE_BEACH, ZONE_GRASSLAND, ZONE_FOREST, ZONE_MOUNTAIN, ZONE_SNOW, ZONE_LAKE, ZONE_MARSH } from '../../code/terrainGenerator.js';

// a zone's color from terrainGenerator.js written out as a WGSL vec3f, so the colors only live in one place
import { groundTextures } from './f_groundTextures.js';
import { moonShapes } from './f_moon.js';

const zoneColor = (zone) => `vec3f(${TERRAIN_ZONES[zone].color.map((c) => c.toFixed(3)).join(', ')})`;

/*
	Depth only version of the terrain, for the top down height map (which is what the water reads its depth and shoreline from)
	The terrain is already in world space, so all it takes is the top down camera's view projection matrix
*/
export const v_terrainDepth =
`
	struct DepthUniforms
	{
		viewProjectionMatrix : mat4x4f,
	}
	@group(0) @binding(0) var<uniform> UBO: DepthUniforms;

	struct VertexInput {
		@location(0) pos: vec3f,
		@location(1) fields: vec2f,
		@location(2) norm: vec3f,
	};

	@vertex
	fn vertexMain(input: VertexInput) -> @builtin(position) vec4f {
		return UBO.viewProjectionMatrix * vec4f(input.pos, 1.0);
	}
`;

/*
	The terrain as seen by the main camera.

	Zone colors are decided per pixel, not per vertex or per triangle: each vertex carries how far into a mountain range it is (fields.x),
	and together with the height of the pixel that is enough to apply the same zone rules terrainGenerator.js tags the grid with.
	Doing it per pixel is what lets the zones blend into each other instead of following the triangle edges.

	Lighting is the sun as a direction (the land is far too big for a point light), the shadow map where it reaches,
	and the same fade into the horizon color that the water has, so far away islands sit in the haze instead of popping out of it.

	ROCK AND SNOW
		The mesh gives a mountain its outline, but a mesh fine enough to carry every crack and ledge would be billions of
		triangles. So the small shapes are not in the mesh at all, they are worked out here for every pixel (see rockDetail):
		how far the real rock would stand out from the smooth mesh at this spot, and which way that changes fastest.
		The pixel is then lit as if the surface leaned that way (the same idea as a normal map, with the map being a sum
		instead of a picture). Three things make the shapes:
			gullies		water and falling stone wear channels straight down a steep face
			joints		rock cracks along flat planes, in a few directions that hold across the whole mountain. What is left
						between the cracks are flat faces at slightly different tilts, which is what makes rock look hard
			breaks		ridged noise, layer on layer down to the size of a pixel, for everything rougher than that

		The same made up surface says where things settle. Low places are crevices: darker, and snow fills them first.
		What the ground is turns on how steep it is once the small shapes are counted in: snow lies on the ledges and
		leaves the faces between them bare, loose stone sits on the middling slopes, turf on the gentle ones lower down.

	CLOSE UP
		What the ground is made of once the camera is near: marble veins in the rock, the grain and ripples of the
		sand, the tufts of the turf, the needles and dead leaves under the trees. All in f_groundTextures.js, which also says what their relief is for.

		Far away the mesh is coarse (see the chunks in terrain.js) and its normals with it, which rounds every crest off.
		So where the mesh is coarser than the land data texture, the slope of the ground is read from that instead.
*/
// The noise, and the small shapes of bare rock made from it (see ROCK AND SNOW above). On their own so that anything else made of
//		rock (the boulders) can be made of the same rock
export const rockShapes =
`
	//------------------NOISE-----------------
	// a number that looks random, 0 to 1, and always the same one for the same place (Dave Hoskins' hash without sine)
	fn hash(p: vec3f) -> f32 {
		var p3 = fract(p * 0.1031);
		p3 += dot(p3, p3.zyx + vec3f(31.32, 31.32, 31.32));
		return fract((p3.x + p3.y) * p3.z);
	}

	// Smooth noise through space, and which way it rises. x: the value, 0 to 1. yzw: how fast it changes along x, y and z.
	//		Having that straight from the sum (instead of sampling the noise again a little way off) is what makes lighting
	//		by it affordable: Inigo Quilez, "value noise derivatives"
	fn noiseAndSlope(p: vec3f) -> vec4f {
		let cell = floor(p);
		let w = fract(p);
		let u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);		// the blend between the corners of the cell (quintic fade)
		let du = 30.0 * w * w * (w * (w - 2.0) + 1.0);			// and how fast the blend is changing

		let a = hash(cell);
		let b = hash(cell + vec3f(1.0, 0.0, 0.0));
		let c = hash(cell + vec3f(0.0, 1.0, 0.0));
		let d = hash(cell + vec3f(1.0, 1.0, 0.0));
		let e = hash(cell + vec3f(0.0, 0.0, 1.0));
		let f = hash(cell + vec3f(1.0, 0.0, 1.0));
		let g = hash(cell + vec3f(0.0, 1.0, 1.0));
		let h = hash(cell + vec3f(1.0, 1.0, 1.0));

		let k1 = b - a;
		let k2 = c - a;
		let k3 = e - a;
		let k4 = a - b - c + d;
		let k5 = a - c - e + g;
		let k6 = a - b - e + f;
		let k7 = -a + b + c - d + e - f - g + h;

		return vec4f(a + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z + k6 * u.z * u.x + k7 * u.x * u.y * u.z,
					 du * vec3f(k1 + k4 * u.y + k6 * u.z + k7 * u.y * u.z,
								k2 + k5 * u.z + k4 * u.x + k7 * u.z * u.x,
								k3 + k6 * u.x + k5 * u.y + k7 * u.x * u.y));
	}

	// noise over the map, for things that vary from place to place
	fn noise(p: vec2f) -> f32 {
		return noiseAndSlope(vec3f(p.x, 0.5, p.y)).x;
	}

	/*
		The small shapes of bare rock at a point, too small for the mesh.
		Returns x: how open to the sky the point is, 0 (down in a crack) to 1.
				yzw: which way the rock stands further out, and how fast (rise per unit of distance, in world space)

		All three kinds of shape are ridged noise: 1 - |noise|, which turns the smooth hills of ordinary noise into sharp
		creases with even slopes between them. What differs is the space the noise is read in.

		GULLIES. Read with height squashed almost flat, so the creases run nearly straight up and down: on a steep face
		that is channels down the fall line.

		JOINTS. Read along one direction only, so every crease is a flat plane: a crack running dead straight through the
		rock, with the stretch between two cracks one flat face. Two directions of them, both steep, at two spacings.

		BREAKS. Read as it is, layer after layer, each a bit under half the size of the last. Broken rock looks much the
		same at every size, which is why adding the same thing at many sizes looks like it.

		All of it is worked out in space, not on the map, or it would be stretched down every steep face.
		And a shape smaller than a pixel cant be drawn, it would only sparkle as the camera moves. So each of these fades
		out as it gets down to pixel size, and far away mountains are lit by the big shapes alone.
			pixel: the size of a pixel on the ground here, world units
	*/
	fn rockDetail(position: vec3f, pixel: f32) -> vec4f {
		var slope = vec3f(0.0, 0.0, 0.0);
		var open = 0.0;
		var counted = 0.0;

		//gullies
		let squash = vec3f(1.0, 0.14, 1.0);
		var gullyWidth = 70.0;
		for (var gully = 0; gully < 2; gully++) {
			let shown = saturate(gullyWidth / (pixel * 4.0) - 1.0);
			let n = noiseAndSlope(position * squash / gullyWidth + vec3f(f32(gully) * 23.1, 0.0, 7.7));
			slope += -sign(n.x * 2.0 - 1.0) * 2.0 * n.yzw * squash * 0.1 * shown;
			gullyWidth = 24.0;
		}

		//joints
		let bend = noiseAndSlope(position / 140.0).x * 0.7;		// the planes are not quite flat, or they would look ruled
		var across = normalize(vec3f(1.0, 0.22, 0.36));			// the direction straight through one family of cracks
		for (var family = 0; family < 2; family++) {
			var spacing = 26.0;
			for (var fineness = 0; fineness < 2; fineness++) {
				let shown = saturate(spacing / (pixel * 4.0) - 1.0);
				if (shown > 0.0) {
					let through = dot(position, across) / spacing + bend + f32(family) * 13.7 + f32(fineness) * 5.1;
					let n = noiseAndSlope(vec3f(through, f32(family) * 3.3 + 0.5, f32(fineness) * 9.1 + 0.5));
					slope += -sign(n.x * 2.0 - 1.0) * 2.0 * n.y * across * 0.085 * shown;
					// the crack itself: the thin line where two faces meet at their lowest
					if (fineness == 1) {
						open += mix(1.0, smoothstep(0.0, 0.14, 1.0 - abs(n.x * 2.0 - 1.0)), shown);
						counted += 1.0;
					}
				}
				spacing = 7.0;
			}
			across = normalize(vec3f(-0.45, 0.3, 1.0));
		}

		//breaks
		var size = 20.0;			// the width of this layer's shapes, world units
		for (var layer = 0; layer < 7; layer++) {
			let shown = saturate(size / (pixel * 3.0) - 1.0);
			if (shown <= 0.0) {
				break;
			}
			let n = noiseAndSlope(position / size + vec3f(f32(layer) * 17.3, f32(layer) * 5.9, f32(layer) * 11.1));
			let fold = 1.0 - abs(n.x * 2.0 - 1.0);		// the crease: 1 along the middle of the noise, falling away to both sides
			slope += -sign(n.x * 2.0 - 1.0) * 2.0 * n.yzw * 0.085 * shown;		// (each layer leans the surface about the same: its shapes are as much taller as they are wider)
			// only the fine layers count as crevices. The big ones are whole hollows and bulges, and those the sun shades by itself
			if (size < 5.0) {
				open += mix(1.0, 0.35 + 0.65 * fold, shown);
				counted += 1.0;
			}
			size *= 0.45;
		}
		return vec4f(select(1.0, open / counted, counted > 0.0), slope);
	}
`;

export const vf_terrain =
`
	struct TerrainUniforms
	{
		viewProjectionMatrix : mat4x4f,
		lightViewProjMat : mat4x4f,
		seaLevel : f32,				// world y of the sea surface
		beachHeight : f32,			// land lower than this above the sea is beach
		snowLine : f32,				// mountain higher than this above the sea is snow
		horizonFogDistance : f32,	// distance from the camera where the land is about two thirds faded into the horizon
		forestThreshold : f32,		// how far into a mountain range (0 to 1) the forest starts
		mountainThreshold : f32,	// and where bare mountain takes over from it
		atmosphereEnabled : f32,	// 1.0 while the atmosphere pass is keeping the sky LUT up to date
		bankHeight : f32,			// height of the step up from the sand to the turf behind it
		worldHalf : f32,			// half the width of the world: the land data texture starts that far west and north of the origin
		dataCell : f32,				// and the size of one cell of it
		pixelSize : f32,			// how much one pixel covers, as distance across per distance away from the camera
		rockDetail : f32,			// how strongly the small shapes of the rock show. 0 = lit by the mesh alone
		rockVeins : f32,			// how strongly the veins of the rock show
		groundDetail : f32,			// and the sand and the forest floor
		depthBias : f32,			// how much of their relief goes into the depth of the pixel
		depthA : f32,				// the two numbers of the projection matrix a depth is made from: depth = -depthA + depthB / distance in front of the camera
		depthB : f32,
		grassDistance : f32,		// how far from the camera the blades of grass are drawn. 0 if there are none
	}
	@group(0) @binding(0) var<uniform> UBO: TerrainUniforms;

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
		moonPos : vec4f,			// xyz: towards the moon, w: how bright it is (see f_moon.js)
	}
	@group(0) @binding(1) var<uniform> Lights: LightsUniforms;

	struct VertexInput {
		@location(0) pos: vec3f,
		@location(1) fields: vec2f,		// x: what covers the ground (see coverOf in terrainGenerator.js), y: the size of a cell of the chunk's mesh
		@location(2) norm: vec3f,
	};

	struct VertexOutput {				//into frag
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) fragNormal: vec3f,
		@location(2) mountain: f32,
		@location(3) shadowPos: vec3f,
		@location(4) meshCell: f32,
	};

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		var output: VertexOutput;
		output.pos = UBO.viewProjectionMatrix * vec4f(input.pos, 1.0);
		output.worldPos = input.pos;
		output.fragNormal = input.norm;
		output.mountain = input.fields.x;
		output.meshCell = input.fields.y;

		// where this point lands in the shadow map: xy as a texture coordinate, z as the depth to compare against
		let pointToLight = UBO.lightViewProjMat * vec4f(input.pos, 1.0);
		output.shadowPos = vec3f(pointToLight.xy * vec2f(0.5, -0.5) + vec2f(0.5, 0.5), pointToLight.z);

		return output;
	}

	@group(0) @binding(2) var myShadowMap: texture_depth_2d;
	@group(0) @binding(3) var myShadowSampler: sampler_comparison;
	@group(0) @binding(4) var skyLUT: texture_2d<f32>;
	@group(0) @binding(5) var skySampler: sampler;
	@group(0) @binding(6) var terrainFields: texture_2d<f32>;	// the land data: per grid point its height, mountain value, normal.x, normal.z (see terrain.js)

	const COLOR_SEABED: vec3f    = ${zoneColor(ZONE_OCEAN)};
	const COLOR_BEACH: vec3f     = ${zoneColor(ZONE_BEACH)};
	const COLOR_GRASSLAND: vec3f = ${zoneColor(ZONE_GRASSLAND)};
	const COLOR_FOREST: vec3f    = ${zoneColor(ZONE_FOREST)};
	const COLOR_MOUNTAIN: vec3f  = ${zoneColor(ZONE_MOUNTAIN)};
	const COLOR_SNOW: vec3f      = ${zoneColor(ZONE_SNOW)};
	const COLOR_LAKEBED: vec3f   = ${zoneColor(ZONE_LAKE)};
	const COLOR_MARSH: vec3f     = ${zoneColor(ZONE_MARSH)};
	const COLOR_EARTH: vec3f     = vec3f(0.36, 0.27, 0.18);	// bare soil, on the face of the bank between the sand and the grass
	const COLOR_SCREE: vec3f     = vec3f(0.52, 0.50, 0.47);	// loose broken stone, paler than the rock it fell from
	const COLOR_TURF: vec3f      = vec3f(0.27, 0.36, 0.17);	// the tough short grass of high ground

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;	// see f_water: reads the first row of sky above the horizon, not the seam under it

	// The color the sky pass puts on screen for a world direction, the same lookup as f_sky and f_water use
	fn skyColorAt(direction: vec3f) -> vec3f {
		let rd = normalize(direction + vec3f(0.0, 0.00001, 0.0));
		let azimuth   = atan2(-rd.z, -rd.x);
		let elevation = asin(clamp(rd.y, -1.0, 1.0));
		let uv = vec2f(azimuth / (2.0 * PI) + 0.5, elevation / PI + 0.5);
		let color = textureSampleLevel(skyLUT, skySampler, uv, 0.0).rgb;

		let exposed = 1.0 - exp(-color * 10.0);
		return pow(exposed, vec3f(1.0 / 2.2));
	}

	${moonShapes}
	${rockShapes}
	${groundTextures}
	//------------------THE LAND DATA-----------------
	// The slope of the ground at a place, from the land data texture: normal.x and normal.z, bilinear between the 4 grid points around it
	fn dataNormal(xz: vec2f) -> vec3f {
		let maxPoint = vec2f(textureDimensions(terrainFields)) - vec2f(1.001, 1.001);
		let grid = clamp((xz + vec2f(UBO.worldHalf, UBO.worldHalf)) / UBO.dataCell, vec2f(0.0, 0.0), maxPoint);
		let base = vec2i(floor(grid));
		let f = fract(grid);
		let a = textureLoad(terrainFields, base, 0).zw;
		let b = textureLoad(terrainFields, base + vec2i(1, 0), 0).zw;
		let c = textureLoad(terrainFields, base + vec2i(0, 1), 0).zw;
		let d = textureLoad(terrainFields, base + vec2i(1, 1), 0).zw;
		let n = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
		return vec3f(n.x, sqrt(max(1.0 - dot(n, n), 0.0)), n.y);
	}

	//same as vertexoutput without builtin bits
	struct FragInput {
		@builtin(position) fragCoord: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) fragNormal: vec3f,
		@location(2) mountain: f32,
		@location(3) shadowPos: vec3f,
		@location(4) meshCell: f32,
	};

	// the depth is written out as well as the color: it is the mesh's depth, moved by the relief of the ground (see the end of fragmentMain)
	struct FragOutput {
		@location(0) color: vec4f,
		@builtin(frag_depth) depth: f32,
	};

	@fragment
	fn fragmentMain(input: FragInput) -> FragOutput {

		let height = input.worldPos.y - UBO.seaLevel;	// above the sea, negative under it
		let toLand = input.worldPos - Lights.camPos.xyz;
		let away = length(toLand);

		//------------------THE LIE OF THE GROUND-----------------
		// from the mesh where it is fine, from the land data where the mesh is coarser than that
		let groundNormal = normalize(mix(normalize(input.fragNormal), dataNormal(input.worldPos.xz), smoothstep(UBO.dataCell, UBO.dataCell * 2.5, input.meshCell)));

		//------------------ZONES-----------------
		// how much of each zone this pixel is, 0 to 1. Same rules as classifyZone in terrainGenerator.js, with soft edges
		let mountain = smoothstep(UBO.mountainThreshold - 0.05, UBO.mountainThreshold + 0.05, input.mountain);
		let forest = smoothstep(UBO.forestThreshold - 0.04, UBO.forestThreshold + 0.04, input.mountain) * (1.0 - mountain);
		// the sand ends at the bank, the short step up to the turf: sand below the middle of it, grass from the top, bare earth on its face
		//		(not round a lake: there the cover is below 0, which is marsh, and the ground runs down into the water as mud)
		let marsh = saturate(-input.mountain);
		let bank = max(UBO.bankHeight, 0.4);
		let beach = (1.0 - smoothstep(UBO.beachHeight + 0.2 * bank, UBO.beachHeight + 0.7 * bank, height)) * (1.0 - marsh);
		let bankFace = smoothstep(UBO.beachHeight + 0.05 * bank, UBO.beachHeight + 0.35 * bank, height)
						* (1.0 - smoothstep(UBO.beachHeight + 0.65 * bank, UBO.beachHeight + bank, height)) * step(0.2, UBO.bankHeight) * (1.0 - marsh);
		// anything steep is bare rock whatever zone it is in (cliffs in the hills, crags in the forest)
		let cliff = 1.0 - smoothstep(0.52, 0.7, groundNormal.y);
		let rocky = max(mountain, cliff) * (1.0 - beach);

		//------------------THE SMALL SHAPES-----------------
		// only where there is rock to see them on. The surface is lit as if it leaned the way the rock stands out: that way,
		//		less whatever part of it is straight in or out of the ground, is taken off the normal
		var detail = vec4f(0.5, 0.0, 0.0, 0.0);
		if (rocky > 0.001 && UBO.rockDetail > 0.0) {
			detail = rockDetail(input.worldPos, away * UBO.pixelSize);
		}
		let along = detail.yzw - groundNormal * dot(detail.yzw, groundNormal);
		let rockNormal = normalize(groundNormal - along * UBO.rockDetail * rocky);

		//------------------WHAT IT IS MADE OF, CLOSE UP-----------------
		// (f_groundTextures.js) a color and a relief each, and only worked out where there is some of it to see
		let pixel = away * UBO.pixelSize;
		var marble = vec4f(1.0, 1.0, 1.0, 0.0);
		if (rocky > 0.001 && UBO.rockVeins > 0.0) {
			let veined = marbleRock(input.worldPos, pixel);
			marble = vec4f(mix(vec3f(1.0, 1.0, 1.0), veined.rgb, UBO.rockVeins), veined.a * UBO.rockVeins);
		}
		var sand = vec4f(1.0, 1.0, 1.0, 0.0);
		if (beach > 0.001 && height > -10.0 && UBO.groundDetail > 0.0) {
			// wet through under the water and for the strip above it that the waves reach
			let grained = beachSand(input.worldPos.xz, pixel, 1.0 - smoothstep(0.1, 0.9, height));
			sand = vec4f(mix(vec3f(1.0, 1.0, 1.0), grained.rgb, saturate(UBO.groundDetail)), grained.a * UBO.groundDetail);
		}
		// (from far off the floor of the forest is the green it always was: there the trees are what is seen, not what lies under them)
		var litter = vec4f(COLOR_FOREST, 0.0);
		let litterNear = (1.0 - smoothstep(90.0, 320.0, away)) * saturate(UBO.groundDetail);
		if (forest > 0.001 && litterNear > 0.0) {
			litter = forestFloor(input.worldPos.xz, pixel);
		}

		// the grassland: everywhere that is none of the others. Its turf is in the shade of the blades standing on it, for as far
		//		out as the blades are seen as blades (further off they take the turf's color themselves, see the end of vf_grass)
		let meadow = (1.0 - forest) * (1.0 - rocky) * (1.0 - beach) * (1.0 - marsh);
		var turf = vec4f(1.0, 1.0, 1.0, 0.0);
		if (meadow > 0.001 && UBO.groundDetail > 0.0) {
			let tufted = grassTurf(input.worldPos.xz, pixel);
			turf = vec4f(mix(vec3f(1.0, 1.0, 1.0), tufted.rgb, saturate(UBO.groundDetail)), tufted.a * UBO.groundDetail);
		}
		if (UBO.grassDistance > 0.0) {
			turf = vec4f(turf.rgb * mix(0.66, 1.0, smoothstep(0.015, 0.14, away / UBO.grassDistance)), turf.a);
		}

		// 1 down in a crack or a joint, 0 out on a face: dark, short of sky, and where snow settles first
		let crevice = 1.0 - detail.x;

		//------------------ROCK-----------------
		// wide patches of warmer and cooler stone across the range, and nothing finer: the rest of what rock looks like is its shape
		let stains = noise(input.worldPos.xz / 640.0 + vec2f(41.0, 7.0));
		var rock = COLOR_MOUNTAIN * mix(vec3f(0.94, 0.97, 1.04), vec3f(1.1, 1.0, 0.88), stains) * mix(0.92, 1.06, noise(input.worldPos.xz / 150.0));
		// crevices are dark: less light gets down into them, and what collects there is dirt
		rock *= mix(1.03, 0.68, crevice);
		rock *= marble.rgb;

		// loose stone: on the slopes too steep for turf and not steep enough to shed it, in fans below the crags. Paler and smoother than the rock
		let scree = smoothstep(0.6, 0.72, groundNormal.y) * (1.0 - smoothstep(0.8, 0.9, groundNormal.y)) * smoothstep(0.42, 0.6, noise(input.worldPos.xz / 85.0));
		rock = mix(rock, COLOR_SCREE * mix(1.05, 0.9, crevice), scree * 0.7);

		// turf: gentle ground low on a mountain is green, in patches. It thins out with height, going long before the snow starts
		let turfLine = UBO.snowLine * (0.5 + 0.25 * noise(input.worldPos.xz / 240.0));
		let highTurf = smoothstep(0.74, 0.88, groundNormal.y + 0.14 * (noise(input.worldPos.xz / 23.0) - 0.5)) * (1.0 - smoothstep(0.6 * turfLine, turfLine, height)) * mountain;
		rock = mix(rock, COLOR_TURF * mix(1.1, 0.85, crevice), highTurf);

		//------------------SNOW-----------------
		// The snow line is not a line. It wanders up and down with the weather of each slope, sits lower on the sides
		//		that face away from the sun, and around it the snow is only in the hollows, where it drifts and lasts longest.
		//		(the sun in this world goes round by the -z side, see sunCycle in atmosphere.js)
		let snowBand = 0.1 * UBO.snowLine;		// the height over which it goes from the first patches to full cover
		let snowLine = UBO.snowLine * (1.0 + 0.16 * (noise(input.worldPos.xz / 520.0) - 0.5)) - 1.2 * snowBand * groundNormal.z;
		let altitude = (height - snowLine) / snowBand;		// 0 on the line, 1 a band above it
		// what it will lie on: ledges and hollows, not the faces between them. The higher up, the steeper the ground it clings to
		let ledgeNormal = normalize(mix(groundNormal, rockNormal, 0.35));
		let clings = saturate(0.5 + 0.2 * altitude);
		let lies = smoothstep(mix(0.72, 0.3, clings), mix(0.88, 0.55, clings), ledgeNormal.y + 0.12 * crevice);
		let snow = smoothstep(-1.0, 0.6, altitude + 1.4 * (crevice - 0.3)) * lies * (1.0 - beach);

		//------------------WHAT IS HERE-----------------
		var albedo = COLOR_GRASSLAND * turf.rgb;
		albedo = mix(albedo, mix(COLOR_FOREST, litter.rgb, litterNear), forest);
		albedo = mix(albedo, rock, rocky);
		albedo = mix(albedo, COLOR_SNOW, snow);
		albedo = mix(albedo, COLOR_BEACH * sand.rgb, beach);
		albedo = mix(albedo, COLOR_EARTH, bankFace * 0.85);
		albedo = mix(albedo, COLOR_SEABED, smoothstep(0.0, 30.0, -height));	// sand runs out into the darker sea bed
		// round a lake: wet dark ground from a little above the water down, and mud under it
		albedo = mix(albedo, COLOR_MARSH, marsh * (1.0 - smoothstep(1.5, 6.0, height)));
		albedo = mix(albedo, COLOR_LAKEBED, marsh * smoothstep(-0.3, 2.5, -height));

		// the relief of whichever of the three shows here. Snow buries it, and so do the loose stone and the turf on a mountain
		let relief = (marble.a * rocky * (1.0 - 0.7 * scree) * (1.0 - highTurf) + sand.a * beach + litter.a * forest * litterNear * (1.0 - rocky) + turf.a * meadow) * (1.0 - snow);

		// snow lies over the small shapes and rounds them off: it is lit by a smoother surface than the rock under it
		let smoothNormal = normalize(mix(rockNormal, groundNormal, 0.65 * snow));
		// and the surface leans by the slope of the relief. The slope is taken from the pixels next door: how much the relief
		//		changes across the screen, against how much the position does (Mikkelsen, "Bump Mapping Unparametrized Surfaces on the GPU")
		let acrossX = dpdx(input.worldPos);
		let acrossY = dpdy(input.worldPos);
		let reliefX = dpdx(relief);
		let reliefY = dpdy(relief);
		let r1 = cross(acrossY, smoothNormal);
		let r2 = cross(smoothNormal, acrossX);
		let area = dot(acrossX, r1);
		let N = normalize(max(abs(area), 0.00000001) * smoothNormal - sign(area) * (reliefX * r1 + reliefY * r2));

		//------------------LIGHT-----------------
		let L = normalize(Lights.sunPos.xyz);			// the sun as a direction
		let daylight = smoothstep(-0.08, 0.25, L.y);	// fades the sun out as it sets
		// snow is not solid, light goes a little way into it and comes out again: its shaded side falls off more gently than rock's
		let diffuse = mix(saturate(dot(N, L)), saturate((dot(N, L) + 0.3) / 1.3), snow);

		// shadow map (PCF, same as the generic shader). It only covers a box around the middle of the world, so the shadows
		//		fade out towards the edge of that box and everything outside it is just lit
		let shadowMapEdge = min(min(input.shadowPos.x, 1.0 - input.shadowPos.x), min(input.shadowPos.y, 1.0 - input.shadowPos.y));
		let insideShadowMap = saturate(shadowMapEdge / 0.08) * step(0.0, input.shadowPos.z) * step(input.shadowPos.z, 1.0);
		let invShadowMapTextureSize = 1.0 / Lights.shadowMapTextureSize;
		let kernelSize = i32(Lights.shadowMapKernelSize);
		let kernelCount = (2.0 * Lights.shadowMapKernelSize + 1.0) * (2.0 * Lights.shadowMapKernelSize + 1.0);
		var visibility = 0.0;
		for (var x = -kernelSize; x <= kernelSize; x++) {
			for (var y = -kernelSize; y <= kernelSize; y++) {
				let kernelOffset = vec2f(f32(x), f32(y)) * invShadowMapTextureSize;
				visibility += textureSampleCompareLevel(myShadowMap, myShadowSampler, input.shadowPos.xy + kernelOffset, input.shadowPos.z - Lights.shadowMapAcneBias);
			}
		}
		visibility = mix(1.0, visibility / kernelCount, insideShadowMap);

		if (Lights.displayLightingMode == 1.0) {
			var shown: FragOutput;
			shown.color = vec4f(visibility, 0.0, 0.0, 1.0);
			shown.depth = input.fragCoord.z;
			return shown;
		}

		// a little light at night, sky light through the day, and the sun on top where it reaches.
		//		The sky's share is less down in a crevice, which has less sky over it. And on snow it is blue: snow in shade is lit
		//		by nothing but the sky and takes its color
		let skyLight = (0.09 + daylight * 0.34) * mix(1.0, mix(1.0, 0.6, crevice), rocky * (1.0 - snow));
		let sunLight = daylight * 0.72 * diffuse * visibility;
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));	// warmer as the sun gets low
		var color = albedo * ((skyLight * mix(vec3f(1.0, 1.0, 1.0), vec3f(0.78, 0.88, 1.08), snow) + sunLight) * sunTint + moonLight(N));

		//------------------HORIZON FOG-----------------
		// same as the water: far land fades into the color of the sky on the horizon behind it
		if (UBO.atmosphereEnabled > 0.5) {
			let horizonColor = skyColorAt(vec3f(toLand.x, HORIZON_LIFT * length(toLand.xz), toLand.z));
			let fog = 1.0 - exp(-pow(away / UBO.horizonFogDistance, 2.0));
			color = mix(color, horizonColor, fog);
		}

		//------------------DEPTH BIAS-----------------
		// The depth of the pixel is the depth of the mesh, moved by the relief: nearer where the surface stands up, further in a
		//		crack. That puts the grain of the ground into the depth texture, where the screen space shadows and the ambient
		//		occlusion find it (see the top of f_groundTextures.js)
		var output: FragOutput;
		output.color = vec4f(color, 1.0);
		let inFront = UBO.depthB / (input.fragCoord.z + UBO.depthA);	// how far in front of the camera the mesh is here
		output.depth = saturate(input.fragCoord.z + UBO.depthB * (1.0 / max(inFront - relief * UBO.depthBias, 0.01) - 1.0 / inFront));
		return output;
	}
`;
