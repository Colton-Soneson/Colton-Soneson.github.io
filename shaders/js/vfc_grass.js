import { TERRAIN_ZONES, ZONE_GRASSLAND, ZONE_MARSH } from '../../code/terrainGenerator.js';
import { windShapes } from './vf_wind.js';
import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';

export const GRASS_MAX_RINGS = 8;								// the most level of detail rings there can be around the camera (how many there are is a setting)
export const GRASS_RING_SEGMENTS = [4, 3, 2, 2, 1, 1, 1, 1];	// pieces a blade is cut into along its length, ring by ring outwards. 1 = a single triangle
export const GRASS_RING_SHIFT = 24;								// a blade's instance number carries its ring in the bits above this, and its place in the ring's grid below

/*
	Procedural grass, after "Procedural Grass Rendering" (GPUOpen, mesh shader version):
	https://gpuopen.com/learn/mesh_shaders/mesh_shaders-procedural_grass_rendering/
	and, for the clumps and the levels of detail, what is public of "Procedural Grass in Ghost of Tsushima" (Eric Wohllaib, GDC 2021)

	In the GPUOpen article a mesh shader is handed a patch of ground and emits the blades for it out of nothing: no blade model, no vertex buffer.
	WebGPU has no mesh shaders, so the same thing is done with instancing instead. No buffers at all:
		each INSTANCE is one blade,
		each VERTEX of it is a point on that blade's triangle strip,
	and the vertex shader works everything out from just those two numbers.

	Where a blade goes: LEVEL OF DETAIL
		The blades sit on square grids centered on the camera, one grid to a ring (see grassRings in computeGrass.js, which lays the
		rings out from the settings). Each ring reaches further than the one inside it and has a coarser grid, so the grass is dense
		at your feet and thins with distance. What is saved on the far rings:
			blades		a far ring covers many times the ground of a near one with no more blades (or fewer: Far Blade Share)
			triangles	a near blade is a curved strip of 4 pieces, a far one a single triangle (GRASS_RING_SEGMENTS)
		and to keep the ground covered all the same, the further rings draw wider blades. Each ring is one draw call.
		Each ring snaps to its own cell size, and a blade's random numbers come from its cell's place in the WORLD, so blades stay
		put as the camera moves instead of swimming along with it.

	CLUMPS
		Grass does not grow evenly, it grows in tufts. The ground is divided into cells (cellular noise: one point scattered in every
		square of a grid, and each place belongs to the nearest point), and every blade belongs to the clump whose point it is nearest.
		A clump has a height, a shade of green and a way it leans, and its blades take after it, by as much as the settings say:
			pull		the blades move in towards the middle of their clump, which opens gaps between the tufts
			height		a clump is tall or short as a whole, and stands tallest in its middle
			facing		the blades lean out from the middle of the clump and the way the clump leans, instead of each its own way
			color		a clump is one shade, so the odd dry blade becomes the odd dry tuft
		Far off, where one blade stands in for a whole patch of ground, there are no tufts to make and the pull fades out.

	Whether a blade exists
		The vertex shader reads the terrain under the blade (terrain.js keeps the height, cover and normal of the land in a texture)
		and applies the same zone rules as the terrain: only grassland grows grass. Blades that fail are collapsed to nothing.
		Round a lake the same blades are reeds: they grow on out into the shallows, taller and paler.

	The shape of a blade
		A quadratic bezier curve from the root, up through a control point, to a tip that leans over and gets pushed around by the wind.
		The strip is the curve given some width, tapering to a point.
*/

const zoneColor = (zone) => `vec3f(${TERRAIN_ZONES[zone].color.map((c) => c.toFixed(3)).join(', ')})`;

export const vf_grass =
`
	struct GrassUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz, and w: time in seconds
		terrain : vec4f,			// x: half the width of the terrain, y: size of a terrain grid cell, z: sea level, w: beach height
		blade : vec4f,				// x: height, y: width, z: how far into a mountain range the forest starts (no grass past it), w: wind strength
		grid : vec4f,				// x: how many rings there are, y: the draw distance, z: horizon fog distance, w: 1.0 if the atmosphere is on
		windScroll : vec4f,			// these two are what windAt takes, see vf_wind.js
		windBlow : vec4f,
		wind : vec4f,				// xy: wind direction, z: height of the bank between the beach and the grass
		clump : vec4f,				// x: how far apart the clumps are, y: pull, z: height, w: facing (see CLUMPS above)
		clumpLook : vec4f,			// x: color. And the season: y: how far the grass has gone to hay, z: how much snow is lying on it (both 0 to 1, see weather.js)
		rings : array<vec4f, ${GRASS_MAX_RINGS}>,	// a ring's x: blades along one side of its grid, y: cell size, z: how far out it reaches, w: pieces in a blade
	}
	@group(0) @binding(0) var<uniform> UBO: GrassUniforms;

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

	@group(0) @binding(2) var terrainFields: texture_2d<f32>;	// per terrain grid point: height, mountain value, normal.x, normal.z
	@group(0) @binding(3) var skyLUT: texture_2d<f32>;
	@group(0) @binding(4) var skySampler: sampler;
	@group(0) @binding(5) var windTexture: texture_2d<f32>;		// where the gusts are, see wind.js
	@group(0) @binding(6) var windSampler: sampler;
	// the towns' streets, lanes, stairs, walls and houses, sorted into a grid of the world (see townMask.js)
	@group(0) @binding(7) var<storage, read> townCells: array<vec2u>;
	@group(0) @binding(8) var<storage, read> townList: array<u32>;
	@group(0) @binding(9) var<storage, read> townItems: array<vec4f>;

	struct VertexOutput {				//into frag
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) bladeNormal: vec3f,
		@location(2) groundNormal: vec3f,
		@location(3) along: f32,		// 0 at the root of the blade, 1 at the tip
		@location(4) tone: f32,			// per blade (or per clump) random, for a bit of color variation
		@location(5) distant: f32,		// 0 near the camera, 1 at the draw distance
		@location(6) reed: f32,			// 1 at the edge of a lake, where the grass is reeds, 0 everywhere else
	};

	//------------------RANDOM-----------------
	// integer hash: scrambles a number into one that looks random, and always the same one for the same input
	fn hash(value: u32) -> u32 {
		var x = value;
		x ^= x >> 16u;
		x *= 0x7feb352du;
		x ^= x >> 15u;
		x *= 0x846ca68bu;
		x ^= x >> 16u;
		return x;
	}

	// 0 to 1
	fn random(seed: u32) -> f32 {
		return f32(hash(seed)) / 4294967295.0;
	}

	${moonShapes}

	//------------------WIND-----------------
	${windShapes}

	//------------------CLUMPS-----------------
	struct Clump
	{
		middle : vec2f,		// where the clump's point is
		apart : f32,		// how far from it this place is
		id : u32,			// the seed of the clump's own random numbers
	}

	// The clump a place on the ground belongs to: the nearest of the points scattered one to a square (size: how wide a square is)
	fn clumpAt(xz: vec2f, size: f32) -> Clump {
		let base = vec2i(floor(xz / size));
		var clump: Clump;
		clump.apart = 1000000.0;
		for (var j = -1; j <= 1; j++) {
			for (var i = -1; i <= 1; i++) {
				let square = base + vec2i(i, j);
				let id = hash((bitcast<u32>(square.x) * 73856093u) ^ (bitcast<u32>(square.y) * 19349663u) ^ 0x9e3779b9u);
				let point = (vec2f(square) + vec2f(random(id), random(id + 1u))) * size;
				let apart = distance(point, xz);
				if (apart < clump.apart) {
					clump.apart = apart;
					clump.middle = point;
					clump.id = id;
				}
			}
		}
		return clump;
	}

	//------------------TERRAIN-----------------
	// height, mountain value, normal.x and normal.z of the land at a world position, bilinear between the 4 grid points around it
	fn terrainAt(xz: vec2f) -> vec4f {
		let maxPoint = vec2f(textureDimensions(terrainFields)) - vec2f(1.001, 1.001);
		let grid = clamp((xz + vec2f(UBO.terrain.x, UBO.terrain.x)) / UBO.terrain.y, vec2f(0.0, 0.0), maxPoint);
		let base = vec2i(floor(grid));
		let f = fract(grid);

		let a = textureLoad(terrainFields, base, 0);
		let b = textureLoad(terrainFields, base + vec2i(1, 0), 0);
		let c = textureLoad(terrainFields, base + vec2i(0, 1), 0);
		let d = textureLoad(terrainFields, base + vec2i(1, 1), 0);
		return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
	}

	// Is a place on a town's roads or walls, or under one of its houses? (no grass there: the rest of a town is grassland)
	fn onTownWork(xz: vec2f) -> bool {
		let grid = townItems[0];		// half the world, the cell size, cells along a side (0: no towns)
		let along = i32(grid.z);
		let cell = vec2i(floor((xz + vec2f(grid.x, grid.x)) / grid.y));
		if (any(cell < vec2i(0, 0)) || any(cell >= vec2i(along, along))) {
			return false;
		}
		let range = townCells[cell.y * along + cell.x];
		for (var k = 0u; k < range.y; k++) {
			let item = townList[range.x + k];
			let a = townItems[1u + item * 2u];
			let b = townItems[2u + item * 2u];
			if (b.z < 0.5) {
				// a stretch of road or wall: within its half width of the line
				let ab = a.zw - a.xy;
				let t = saturate(dot(xz - a.xy, ab) / max(dot(ab, ab), 1e-6));
				if (length(xz - a.xy - ab * t) < b.x) {
					return true;
				}
			} else {
				// a box, turned: a.zw along its width
				let d = xz - a.xy;
				if (abs(dot(d, a.zw)) < b.x && abs(dot(d, vec2f(-a.w, a.z))) < b.y) {
					return true;
				}
			}
		}
		return false;
	}

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
		var output: VertexOutput;
		// a blade that isnt drawn has every vertex put in the same spot outside the screen, which makes triangles with no area
		output.pos = vec4f(2.0, 2.0, 2.0, 1.0);

		//------------------WHICH BLADE-----------------
		// (every ring is a draw call of its own, which starts its instance numbers at the ring's number shifted up out of the way)
		let ring = min(instanceIndex >> ${GRASS_RING_SHIFT}u, ${GRASS_MAX_RINGS - 1}u);
		let cellInRing = instanceIndex & ${(1 << 24) - 1}u;
		let ringData = UBO.rings[ring];
		let side = u32(ringData.x);
		let cellSize = ringData.y;

		// this ring's grid, snapped to its own cell size. The cell's place in the world is what seeds the blade's random numbers
		let ringOrigin = vec2i(floor(UBO.cameraPosition.xz / cellSize));
		let worldCell = ringOrigin + vec2i(i32(cellInRing % side), i32(cellInRing / side)) - vec2i(i32(side / 2u), i32(side / 2u));
		let seed = hash((bitcast<u32>(worldCell.x) * 73856093u) ^ (bitcast<u32>(worldCell.y) * 19349663u) ^ ((ring + 1u) * 83492791u));

		var root = (vec2f(worldCell) + vec2f(random(seed), random(seed + 1u))) * cellSize;	// somewhere inside its cell

		//------------------DOES IT EXIST-----------------
		// level of detail: a ring only covers the band between the ring inside it and its own edge.
		//		the edges are ragged (a different distance for every blade), so one ring thins out as the next thickens up instead of a line showing
		let cameraDistance = length(root - UBO.cameraPosition.xz);
		let ragged = 0.8 + 0.2 * random(seed + 2u);
		if (cameraDistance > ringData.z * ragged) {
			return output;
		}
		if (ring > 0u && cameraDistance < UBO.rings[ring - 1u].z * ragged) {
			return output;
		}

		// its clump, and the pull in towards the middle of it. Not all the way and not every blade as far, or a tuft would be a dot
		let clump = clumpAt(root, max(UBO.clump.x, 0.05));
		let clumped = saturate(0.6 * UBO.clump.x / cellSize - 0.6);	// only where there are several blades to a clump
		root = mix(root, clump.middle, 0.85 * UBO.clump.y * clumped * (0.3 + 0.7 * random(seed + 11u)));

		if (abs(root.x) >= UBO.terrain.x || abs(root.y) >= UBO.terrain.x) {
			return output;	// off the edge of the land
		}

		// zones: grass only grows on grassland. Same rules the terrain colors itself with, so the grass stops where the green does
		let ground = terrainAt(root);
		let groundNormal = vec3f(ground.z, sqrt(max(1.0 - ground.z * ground.z - ground.w * ground.w, 0.0)), ground.w);
		let heightAboveSea = ground.x - UBO.terrain.z;
		// at the shore the thick grass starts at the top of the bank. Below it, on the top strip of the sand, there is
		//		only a thin scatter of blades (and shorter ones, the height further down follows this number too)
		let aboveBank = smoothstep(UBO.terrain.w + 0.5 * UBO.wind.z, UBO.terrain.w + UBO.wind.z + 0.3, heightAboveSea);
		let onSand = 0.3 * smoothstep(UBO.terrain.w - 1.3, UBO.terrain.w - 0.2, heightAboveSea);
		// round a lake there is no beach to stop at. The cover of the ground is below 0 there (see coverOf in terrainGenerator.js),
		//		and the grass carries on down the bank and out into the water until it is about a blade deep
		let marsh = saturate(-ground.y);
		let inShallows = marsh * smoothstep(-0.9 * UBO.blade.x, -0.25 * UBO.blade.x, heightAboveSea);
		let reed = marsh * (1.0 - smoothstep(1.0, 4.5, heightAboveSea));
		let grassland = (1.0 - smoothstep(UBO.blade.z - 0.04, UBO.blade.z + 0.04, ground.y))		// not forest or mountain
						* max(max(aboveBank, onSand), inShallows)									// not beach, bar that top strip
						* smoothstep(0.7, 0.82, groundNormal.y);									// not a cliff
		if (random(seed + 3u) >= grassland) {
			return output;	// thins out towards the edge of the zone, gone outside it
		}
		if (onTownWork(root)) {
			return output;	// not on a town's roads, nor under its houses
		}

		//------------------THE BLADE-----------------
		// the grass sinks into the ground over the last stretch before the draw distance, so the field has no edge where it stops
		let distant = saturate(cameraDistance / UBO.grid.y);
		// how tall: its own height, or its clump's, and a clump stands tallest in its middle
		let tall = mix(random(seed + 4u), random(clump.id + 2u), 0.8 * UBO.clump.z);
		let tuft = mix(1.0, 1.2 - 0.5 * saturate(clump.apart / (0.6 * UBO.clump.x)), UBO.clump.z * clumped);
		let height = UBO.blade.x * (0.55 + 0.9 * tall) * tuft * (0.5 + 0.5 * grassland) * (1.0 + 1.2 * reed) * (1.0 - smoothstep(0.7, 1.0, distant));	// reeds stand over twice as tall
		// further rings have fewer blades for the same ground, so each one is wider to keep it covered
		let width = UBO.blade.y * (0.75 + 0.5 * random(seed + 5u)) * min(pow(cellSize / UBO.rings[0].y, 0.77), 16.0);
		// the way it leans: its own way, or out from the middle of its clump and the way the whole clump leans
		let ownAngle = random(seed + 6u) * 6.2832;
		let clumpAngle = random(clump.id + 3u) * 6.2832;
		let outward = (root - clump.middle) / max(UBO.clump.x, 0.05);
		let clumpWay = outward * 1.6 + vec2f(cos(clumpAngle), sin(clumpAngle)) * 0.7;
		let way = normalize(mix(vec2f(cos(ownAngle), sin(ownAngle)), clumpWay, 0.85 * UBO.clump.w) + vec2f(0.0001, 0.0));
		let facing = vec3f(way.x, 0.0, way.y);							// the way the blade leans
		let across = vec3f(-facing.z, 0.0, facing.x);					// the way its width runs
		let lean = 0.2 + 0.5 * random(seed + 7u);

		// wind: read from the wind texture where the blade stands (see wind.js), so the gusts crossing the field are the same ones
		//		that reach the trees behind it. On top of that every blade shivers in its own time, harder inside a gust
		let air = windAt(root, UBO.windScroll, UBO.windBlow);
		let shiver = sin(UBO.windBlow.w * (5.0 + 4.0 * random(seed + 8u)) + random(seed + 10u) * 6.2832) * (0.3 + 0.7 * air.z) * UBO.windScroll.w;
		let blown = (air.xy * 0.22 + (air.xy * 0.4 + vec2f(-air.y, air.x)) * 0.05 * shiver) * UBO.blade.w * height;
		let windPush = vec3f(blown.x, 0.0, blown.y);

		// quadratic bezier: root, a control point straight above it, and the tip leaning over and pushed by the wind.
		//		however hard it is pushed the tip stays a blade's length from the root, so a strong wind lays the grass over instead of stretching it
		let p0 = vec3f(root.x, ground.x, root.y);
		let p1 = p0 + vec3f(0.0, height * 0.75, 0.0);
		let p2 = p0 + normalize(vec3f(0.0, cos(lean), 0.0) + facing * sin(lean) + windPush / max(height, 0.0001)) * height;

		// this vertex: how far up the blade, and which edge of it. (the ring says how many pieces the blade is in: the draw call
		//		sends 2 vertices for every piece and 1 for the tip)
		let along = min(f32(vertexIndex / 2u) / max(ringData.w, 1.0), 1.0);
		let edge = f32(vertexIndex % 2u) * 2.0 - 1.0;

		let curve = mix(mix(p0, p1, along), mix(p1, p2, along), along);
		let curveDirection = normalize(mix(p1 - p0, p2 - p1, along));
		let position = curve + across * (edge * width * 0.5 * (1.0 - along));

		output.pos = UBO.viewProjectionMatrix * vec4f(position, 1.0);
		output.worldPos = position;
		output.bladeNormal = normalize(cross(across, curveDirection));
		output.groundNormal = groundNormal;
		output.along = along;
		output.tone = mix(random(seed + 9u), random(clump.id + 4u), UBO.clumpLook.x);
		output.distant = distant;
		output.reed = reed;

		return output;
	}

	const COLOR_GRASSLAND: vec3f = ${zoneColor(ZONE_GRASSLAND)};
	const COLOR_MARSH: vec3f     = ${zoneColor(ZONE_MARSH)};
	const COLOR_REED: vec3f      = vec3f(0.43, 0.45, 0.2);
	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;	// see f_water

	// The color the sky pass puts on screen for a world direction, the same lookup as f_sky, f_water and the terrain use
	${skyLookupShapes}

	//same as vertexoutput without builtin bits
	struct FragInput {
		@location(0) worldPos: vec3f,
		@location(1) bladeNormal: vec3f,
		@location(2) groundNormal: vec3f,
		@location(3) along: f32,
		@location(4) tone: f32,
		@location(5) distant: f32,
		@location(6) reed: f32,
	};

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {

		// dark at the root, the terrain's grassland green part way up, lighter at the tip. So from far off a field of it matches the ground under it
		let rootColor = COLOR_GRASSLAND * 0.45;
		let tipColor = COLOR_GRASSLAND * vec3f(1.35, 1.25, 1.1);
		var albedo = mix(rootColor, tipColor, input.along);
		// every blade (or every clump) a slightly different shade, and the odd dry one
		let shade = 0.85 + 0.3 * input.tone;
		let dry = mix(vec3f(1.0, 1.0, 1.0), vec3f(1.25, 1.1, 0.7), step(0.9, input.tone));
		albedo *= shade * dry;
		// the fall and the winter: hay, paler towards the tip
		let hay = vec3f(0.74, 0.64, 0.33);
		albedo = mix(albedo, hay * (0.5 + 0.65 * input.along) * shade, 0.85 * UBO.clumpLook.y);
		// snow lies on the upper part of every blade
		albedo = mix(albedo, vec3f(0.94, 0.96, 0.99), 0.85 * UBO.clumpLook.z * smoothstep(0.25, 0.8, input.along));
		// reeds: dark and wet at the foot, straw colored towards the top
		albedo = mix(albedo, mix(COLOR_MARSH, COLOR_REED, input.along) * shade, 0.8 * input.reed);

		// a blade is flat and seen from both sides. Lit mostly by the lie of the land under it, so a hillside of grass shades like the hill
		let toCamera = normalize(Lights.camPos.xyz - input.worldPos);
		var bladeNormal = normalize(input.bladeNormal);
		if (dot(bladeNormal, toCamera) < 0.0) {
			bladeNormal = -bladeNormal;
		}
		// (and by nothing else from far off, where the way one blade happens to face would only show as speckle)
		let N = normalize(mix(bladeNormal, normalize(input.groundNormal), mix(0.6, 1.0, smoothstep(0.015, 0.14, input.distant))));

		// same light as the terrain
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let diffuse = saturate(dot(N, L));
		let light = 0.09 + daylight * (0.34 + 0.72 * diffuse);
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		let amongst = 0.55 + 0.45 * input.along;	// darker down in amongst the other blades
		// far off, a blade is smaller than a pixel and all that shading just reads as dark speckle. So with distance it goes over to the
		//		color of the turf under it (grassTurf in f_groundTextures.js: the same green, in the same sort of shades), and the far
		//		field of grass melts into the terrain
		var farColor = mix(mix(COLOR_GRASSLAND, hay * 0.84, 0.8 * UBO.clumpLook.y) * mix(0.9, 1.1, input.tone) * mix(vec3f(1.0, 1.0, 1.0), dry, 0.5), COLOR_MARSH, input.reed);
		farColor = mix(farColor, vec3f(0.94, 0.96, 0.99), 0.85 * UBO.clumpLook.z);
		let surface = mix(albedo * amongst, farColor, smoothstep(0.015, 0.14, input.distant));
		var color = surface * (light * sunTint + moonLight(N));

		// and the same fade into the horizon
		if (UBO.grid.w > 0.5) {
			let toGrass = input.worldPos - Lights.camPos.xyz;
			let horizonColor = fogColorAt(toGrass);
			let fog = 1.0 - exp(-pow(length(toGrass) / UBO.grid.z, 2.0));
			color = mix(color, horizonColor, fog);
		}

		return vec4f(color, 1.0);
	}
`;
