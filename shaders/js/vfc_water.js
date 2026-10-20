import { settings } from '../../code/settings.js';
import { skyLookupShapes } from './vfc_atmosphere.js';

export const WATER_WORKGROUP_SIZE = [32, 1, 1];
export const FFT_WORKGROUP_SIZE = [8, 8, 1];
export const PRECOMP_WORKGROUP_SIZE = [1, 8, 1];
export const SHORE_FIELD_DOWNSCALE = 8;		// one shore distance field texel covers this many top down height map texels (per axis)
export const SHORE_SEARCH_RADIUS = 64;		// in shore field texels. The furthest distance from land the field can hold, further than this is open ocean
export const CASCADE_UNIFORM_FLOATS = 24;
export const ROCKS_MOST = 32;			// the most boulders in the sea the water is told about at once, the nearest the camera	// floats in CascadeUniforms below, in the order water.js writes them (writeCascadeUniforms)

// The settings of one cascade of the open ocean waves, shared by the passes that make and run the cascades (see the cascades in water.js)
const CASCADE_UNIFORMS = `
	struct CascadeUniforms {
		resolution: f32,		// texels along a side, the size of the FFT
		size: f32,				// world size of one tile of this cascade
		kLow: f32,				// the band of wave numbers this cascade carries, radians per world unit: from kLow up to (not including) kHigh
		kHigh: f32,
		unitsPerMetre: f32,		// the spectrum works in metres and seconds, the world in its own units
		depth: f32,				// depth of the open sea in metres. Waves long enough to feel the bottom are smaller (TMA) and slower
		time: f32,				// seconds, wrapped round at repeatTime
		repeatTime: f32,		// every wave's speed is rounded so that the whole sea comes back to where it started after this long
		windDirection: vec2f,	// the way the wind blows, 1 long
		windSpeed: f32,			// metres per second
		windAlpha: f32,			// how much energy the wind sea has (JONSWAP's alpha), 0 when there is no wind
		windPeak: f32,			// angular frequency of the wind sea's biggest waves, radians per second
		swellAlpha: f32,		// the same for the swell, 0 when there is none
		swellPeak: f32,
		swellSpread: f32,		// 0 to 1: from crests as short as the wind sea's to long, straight swell lines
		swellDirection: vec2f,	// the way the swell runs, 1 long
		cascade: f32,			// which cascade this is, 0 for the longest waves
		choppiness: f32,		// lambda in the tessendorf paper, as the mesh pass uses it: for the foam (c_waveMaps)
		foamThreshold: f32,		// foam starts where this cascade alone squeezes the surface (its jacobian) below this
		foamFade: f32,			// how far below the threshold until its fully white
		foamKeep: f32,			// how much of the foam is left a frame later: it lingers, and trails off behind the crests as they move on
		_padding0: f32,
	};
	@group(0) @binding(0) var<uniform> CU: CascadeUniforms;

	const G = 9.81;				// metres per second squared
	const PI = 3.14159265;

	// The wave vector a texel of the spectrum stands for, radians per world unit. The middle texel is k = 0.
	//		It is minus the usual one: the butterfly passes (c_IFFT_2D) do a forward transform, e^(-ikx), and run on k negated
	//		that is the inverse transform, e^(ikx), that turns the spectrum into the sea
	fn waveVector(texel: vec2u) -> vec2f {
		return -(vec2f(texel) - vec2f(CU.resolution * 0.5)) * (2.0 * PI / CU.size);
	}

	// how fast a wave of wave number k (radians per metre) turns, radians per second: w^2 = g k tanh(k depth).
	//		Deep water (tanh of 1) for anything shorter than about twice the depth, slower in shallower water
	fn angularFrequency(k: f32) -> f32 {
		return sqrt(G * k * tanh(min(k * CU.depth, 20.0)));	// (tanh is 1 to float precision long before 20)
	}
`;


/*
	This pass builds the actual geometry
	Each thread handles one vertex of the ocean grid: it reads the waves out of the three cascades' maps at its world position (c_waveMaps), projects the vertex's world position
	into the top-down depth camera to sample terrain depth underneath, then attenuates the wave height based on water depth (full waves in deep water, smaller ripples near shore)
	
	It also writes index buffer data to form triangles between adjacent grid vertices for the render pipeline
*/
export const c_water = 
`
	struct WaterSpaces
	{
		modelViewProjectionMatrix : mat4x4f,
		topDownViewProj : mat4x4f,
		topDownInvViewProj : mat4x4f,
		topDownTextureSize : vec2f,
		_padding0 : vec2f,
	}
	@group(0) @binding(0) var<uniform> Spaces: WaterSpaces;
	
	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveSteepness: f32,	
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
		@location(5) planeYPos: f32,
		@location(6) waveLength: f32,
		@location(7) oceanPlanePhysicalSize: f32,
		@location(8) windSpeed: f32,
		@location(9) tileOffsetX: f32,
		@location(10) tileOffsetZ: f32,
		@location(11) gridSize: vec2f,
		@location(12) tileCells: f32,			//cells along one side of THIS tile's mesh. Tiles further from the camera get fewer (level of detail)
		@location(13) waveFadeDistance: f32,	//distance from the camera where the open ocean waves have flattened out completely
		@location(14) coarserEdge: vec4f,		//-x, +x, -z, +z edge of this tile: 1.0 if the tile over that edge has a coarser mesh than this one

		//look settings, straight from settings.js / the Water folder of the controls
		@location(15) choppiness: f32,			//lambda in the tessendorf paper. Around 1.0 is where crests start folding over themselves
		@location(16) foamThreshold: f32,		//foam starts where the jacobian drops below this
		@location(17) foamFade: f32,			//how far below the threshold until its fully white
		@location(18) rideHigh: f32,			//1.0 to have waves over shallow water ride high: their troughs lifted towards the still water, their crests taller
		@location(19) unitsPerMetre: f32,		//the scale of the world, for the speed of waves in water of some depth
		@location(20) fullDepth: f32,			//water deeper than this gets the full open ocean waves
		@location(21) shallowRippleScale: f32,	//height of the spikey ripples that replace the waves in shallow water
		@location(22) terrainHalfSize: f32,		//half the width of the terrain, 0 when there is no terrain
		@location(23) terrainCellSize: f32,		//size of one terrain grid cell
		@location(24) cascadeSize0: f32,		//world size of one tile of each cascade of waves, longest waves first (see the cascades in water.js)
		@location(25) cascadeSize1: f32,
		@location(26) cascadeSize2: f32,
		@location(27) fineFadeStart: f32,		//distance from the camera where the shortest waves (cascade 2) start to fade out. Gone by fineFadeEnd
		@location(28) fineFadeEnd: f32,
		@location(29) swellDirX: f32,			//the way the swell runs out in the open sea (the refraction map turns it in the shallows)
		@location(30) swellDirZ: f32,
		@location(31) swellPeak: f32,			//angular frequency of the swell's biggest waves, radians a second
		@location(32) chopK1: f32,				//a typical wave number of cascades 1 and 2, radians per world unit: how soon they feel the bottom
		@location(33) chopK2: f32,
		@location(34) swellHs: f32,				//significant wave height of the swell out at sea, and of the wind sea, world units
		@location(35) windHs: f32,
	};
	@group(0) @binding(1) var<uniform> WU: WaterUniforms;


	//remember hidden padding, just use this struct for math and variables
	//	kept as vec4f to do matrix mult easier
	struct Vertex {
		pos: vec4f,
		uv: vec2f,
		norm: vec4f,
	};
	
	@group(0) @binding(2) var<storage, read_write> waterVertexData: array<f32>;
	@group(0) @binding(3) var<storage, read_write> waterIndexData: array<u32>;
	
	@group(0) @binding(4) var waveSampler : sampler;		//bilinear, and wrapping round: the cascades repeat
	@group(0) @binding(5) var topDownHeightmapTexture : texture_depth_2d;

	// the open ocean waves: two maps for each cascade (c_waveMaps), read wherever in the world a vertex is
	@group(0) @binding(6) var waveTexture0 : texture_2d<f32>;		//x: Dx, y: height, z: Dz, w: dDx/dz
	@group(0) @binding(9) var slopeTexture0 : texture_2d<f32>;		//x: dh/dx, y: dh/dz, z: dDx/dx, w: dDz/dz
	@group(0) @binding(10) var waveTexture1 : texture_2d<f32>;
	@group(0) @binding(11) var slopeTexture1 : texture_2d<f32>;
	@group(0) @binding(12) var waveTexture2 : texture_2d<f32>;
	@group(0) @binding(13) var slopeTexture2 : texture_2d<f32>;
	@group(0) @binding(14) var foamTexture1 : texture_2d<f32>;		//x: the foam the wind waves have made and left, cascades 1 and 2 (c_waveMaps)
	@group(0) @binding(15) var foamTexture2 : texture_2d<f32>;
	@group(0) @binding(16) var refractionTexture : texture_2d<f32>;	//the swell turned by the shallows (see waveRefraction.js). x: delay, yz: gradient of the arrival time, w: depth

	// the boulders standing in the sea near the camera (see gatherRocks in water.js): two vec4 each,
	//		x, z of its middle, its radius at the water line, how far its top stands over the still water; the way the waves run at it (x, z)
	struct RockUniforms {
		at: array<vec4f, ${ROCKS_MOST * 2}>,
		count: vec4f,	// x: how many there are
	};
	@group(0) @binding(17) var<uniform> Rocks: RockUniforms;

	// the foam map of a cascade at a place on it (0 to 1 across one tile of it, wrapping round), bilinear by hand: the maps are
	//		r32float, which a sampler cant filter
	fn foamAt(foamMap: texture_2d<f32>, uv: vec2f) -> f32 {
		let size = vec2i(textureDimensions(foamMap));
		let place = uv * vec2f(size) - vec2f(0.5, 0.5);
		let corner = vec2i(floor(place));
		let f = place - floor(place);
		let t00 = (corner % size + size) % size;
		let t11 = (t00 + vec2i(1, 1)) % size;
		let a = textureLoad(foamMap, t00, 0).x;
		let b = textureLoad(foamMap, vec2i(t11.x, t00.y), 0).x;
		let c = textureLoad(foamMap, vec2i(t00.x, t11.y), 0).x;
		let d = textureLoad(foamMap, t11, 0).x;
		return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
	}
	@group(0) @binding(7) var shoreDistanceTexture : texture_storage_2d<r32float, read>;		//x: world distance to the nearest land
	@group(0) @binding(8) var terrainWaterTexture : texture_2d<f32>;	//the whole world's land, one texel per terrain grid point. x: height of the ground, y: distance to the nearest land, z: 1.0 where the water is a lake

fn gerstnerWave(position: vec3f, waveLength: f32, waveSteepness: f32, windDirection: vec2f, step: f32) -> vec3f {
		let k = (2 * 3.14) / waveLength;     		// Wave number
		let A = waveSteepness / k;;       			// Amplitude
		let c = sqrt(9.81/k);						// Speed, based on gravity constant and wave number
		let omega = k * c;   						// Angular frequency
		let normWaveDir = normalize(windDirection);	// Wave Direction Normalized
		let time = WU.step * 0.01;  				// Current time adjusted to a hundreth	
	
		//Gerstners
		let f = k * (dot(normWaveDir, position.xz) - c * time);
		let new_x = position.x + (normWaveDir.x * (A * cos(f)));
	    let new_z = position.z + (normWaveDir.y * (A * cos(f)));
		let new_y = position.y + (A * sin(f));
		
		return vec3f(new_x, new_y, new_z);
}

// The land under a world position, from the texture terrain.js keeps of the WHOLE world. x: height of the ground, y: distance to the nearest land,
//		z: 1.0 where the water is a lake (land all the way round it), 0.0 where it is the sea.
//		Its coarse (one texel per terrain grid point) but it reaches everywhere, where the top down height map only sees the area around the camera.
//		Off the edge of the terrain, or with the terrain switched off, its open sea: no ground and no land anywhere near
fn worldTerrainAt(xz: vec2f) -> vec3f {
	if (WU.terrainHalfSize <= 0.0) {
		return vec3f(-100000.0, 100000.0, 0.0);
	}
	// off the edge of the map the sea bed carries on down from where it was at the edge, a unit deeper for every unit further out.
	//		(a sheer drop to nothing there would start the deep sea swell at full height along a dead straight line)
	let outside = max(max(abs(xz.x), abs(xz.y)) - WU.terrainHalfSize, 0.0);
	let maxPoint = vec2f(textureDimensions(terrainWaterTexture)) - vec2f(1.001, 1.001);
	let grid = clamp((xz + vec2f(WU.terrainHalfSize, WU.terrainHalfSize)) / WU.terrainCellSize, vec2f(0.0, 0.0), maxPoint);
	let base = vec2i(floor(grid));
	let f = fract(grid);

	let a = textureLoad(terrainWaterTexture, base, 0).xyz;
	let b = textureLoad(terrainWaterTexture, base + vec2i(1, 0), 0).xyz;
	let c = textureLoad(terrainWaterTexture, base + vec2i(0, 1), 0).xyz;
	let d = textureLoad(terrainWaterTexture, base + vec2i(1, 1), 0).xyz;
	let found = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
	return vec3f(found.x - outside, found.y + outside, found.z);
}

fn getHeightmapWorldPos(globalInvoc : vec2u) -> vec3f {
	let tdUV  = vec2f(f32(globalInvoc.x) / Spaces.topDownTextureSize.x,
                  f32(globalInvoc.y) / Spaces.topDownTextureSize.y);
	let ndcXY = tdUV * 2.0 - vec2f(1.0, 1.0);
	
	var heightMap = textureLoad(topDownHeightmapTexture, vec2<u32>(globalInvoc.x, globalInvoc.y), 0);
	
	let clipPos  = vec4f(ndcXY.x, ndcXY.y, heightMap, 1.0);
	var worldPos = Spaces.topDownInvViewProj * clipPos;
	worldPos /= worldPos.w;
	
	return worldPos.xyz;
}

struct WaterVertex {
	position: vec3f,
	normal: vec3f,
	foam: f32,		// the foam of the crests breaking now: the spray comes off this (particles.js)
	keptFoam: f32,	// and the foam still lying on the water from a little while ago
	crest: f32,		// how peaked the water is here, 0 to 1: where the surface is squeezed into a crest. The light shines through these (f_water)
	depth: f32,
};

// One cascade read at a place, in the world's frame: its height, how far it pushes the surface sideways, its slope (dh/dx, dh/dz),
//		and how the push squeezes the surface (x: dDx/dx, y: dDz/dz, z: dDx/dz)
struct WaveSample {
	height: f32,
	push: vec2f,
	slope: vec2f,
	squeeze: vec3f,
};

fn outerProduct(a: vec2f, b: vec2f) -> mat2x2f {
	return mat2x2f(a * b.x, a * b.y);
}

// A cascade's maps (wave: x Dx, y height, z Dz, w dDx/dz, slope: x dh/dx, y dh/dz, z dDx/dx, w dDz/dz) read at a place got from the world
//		position through toMap (a step across the world is toMap times it across the maps), and the directions in the maps turned
//		back into the world's by toWorld. The slopes and the squeeze follow by the chain rule
fn waveFromMaps(wave: vec4f, slope: vec4f, toMap: mat2x2f, toWorld: mat2x2f) -> WaveSample {
	let squeeze = toWorld * mat2x2f(vec2f(slope.z, wave.w), vec2f(wave.w, slope.w)) * toMap;
	return WaveSample(wave.y, toWorld * wave.xz, transpose(toMap) * slope.xy, vec3f(squeeze[0].x, squeeze[1].y, 0.5 * (squeeze[1].x + squeeze[0].y)));
}

fn scaleWave(w: WaveSample, s: f32) -> WaveSample {
	return WaveSample(w.height * s, w.push * s, w.slope * s, w.squeeze * s);
}

fn addWave(a: WaveSample, b: WaveSample) -> WaveSample {
	return WaveSample(a.height + b.height, a.push + b.push, a.slope + b.slope, a.squeeze + b.squeeze);
}

// The refraction map (waveRefraction.js) at a world position, bilinear by hand (it is rgba32float). Off the land's grid it is the open
//		sea: the edges of the grid are, and they carry on. x: delay, yz: gradient of the arrival time, w: depth
fn refractionAt(xz: vec2f) -> vec4f {
	if (WU.terrainHalfSize <= 0.0) {
		return vec4f(0.0, normalize(vec2f(WU.swellDirX, WU.swellDirZ)), 1000.0);
	}
	let points = vec2i(textureDimensions(refractionTexture));
	let cellSize = 2.0 * WU.terrainHalfSize / f32(points.x - 1);
	let grid = clamp((xz + vec2f(WU.terrainHalfSize, WU.terrainHalfSize)) / cellSize, vec2f(0.0, 0.0), vec2f(points - vec2i(1, 1)) - vec2f(0.001, 0.001));
	let corner = vec2i(floor(grid));
	let f = grid - floor(grid);
	let a = textureLoad(refractionTexture, corner, 0);
	let b = textureLoad(refractionTexture, corner + vec2i(1, 0), 0);
	let c = textureLoad(refractionTexture, corner + vec2i(0, 1), 0);
	let d = textureLoad(refractionTexture, corner + vec2i(1, 1), 0);
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// the wave number, per metre, for angular frequency omega in water depth metres deep: w^2 = g k tanh(k d), by Newton's method (as waveRefraction.js)
fn waveNumberAt(omega: f32, depth: f32) -> f32 {
	let deep = omega * omega / 9.81;
	var k = deep / sqrt(tanh(deep * depth));
	for (var i = 0; i < 3; i++) {
		let t = tanh(k * depth);
		k = max(k - (9.81 * k * t - omega * omega) / (9.81 * (t + k * depth * (1.0 - t * t))), deep);
	}
	return k;
}

// The swell at a world position, bent round by the shallows. The refraction map says how far behind a crest out at sea this one runs
//		(the delay) and the gradient of its arrival time. Reading the swell's maps at the position moved back along its open sea heading by
//		the delay makes the crests of the maps the crests of the refracted swell: they lie along the lines of equal arrival time, so they
//		turn and crowd together as the real ones do, and still move at the right speed (their phase is w (T - t)). Then it stands taller in
//		the shallows (Green's law, shoaling), and less tall the further it had to turn to get there: a beach in the lee of the swell only
//		gets what wraps round to it
struct SwellRead {
	wave: WaveSample,
	growth: f32,	// how much taller than out at sea it stands here: shoaling, less what it lost wrapping round
};

fn swellLookup(xz: vec2f, depthMetres: f32) -> SwellRead {
	let refracted = refractionAt(xz);
	let heading = normalize(vec2f(WU.swellDirX, WU.swellDirZ));
	let across = vec2f(-heading.y, heading.x);
	let gradient = refracted.yz;
	let uv = (xz + heading * refracted.x) / WU.cascadeSize0;
	let toMap = outerProduct(heading, gradient) + outerProduct(across, across);
	let runs = normalize(gradient + vec2f(0.00001, 0.0));
	let toWorld = outerProduct(runs, heading) + outerProduct(vec2f(-runs.y, runs.x), across);
	let seen = waveFromMaps(textureSampleLevel(waveTexture0, waveSampler, uv, 0.0), textureSampleLevel(slopeTexture0, waveSampler, uv, 0.0), toMap, toWorld);

	// Green's law: the waves carry their energy at the group speed, so they grow as it falls. 1 in the open sea
	let omega = WU.swellPeak;
	let depth = max(depthMetres, 0.05);
	let k = waveNumberAt(omega, depth);
	let kd = min(k * depth, 20.0);
	let groupSpeed = 0.5 * omega / k * (1.0 + 2.0 * kd / sinh(2.0 * kd));
	let shoaling = min(sqrt(0.5 * 9.81 / omega / groupSpeed), 2.2);
	let wrapped = mix(0.35, 1.0, smoothstep(-0.866, 0.5, dot(runs, heading)));
	return SwellRead(scaleWave(seen, shoaling * wrapped), shoaling * wrapped);
}

// turns a vector by angle radians (from x towards z)
fn rotation(angle: f32) -> mat2x2f {
	let c = cos(angle);
	let s = sin(angle);
	return mat2x2f(vec2f(c, s), vec2f(-s, c));
}

struct TurnedWave {
	wave: WaveSample,
	foam: f32,
};

// A wind cascade read turned round by turn radians: the same sea, its waves running that much further round. Turning the read about a
//		point would tear the waves apart wherever the turn changes from place to place, so the maps are read whole at fixed turns, half a
//		radian apart, and the two either side of the turn wanted are mixed (scaled up so the mix is as rough as either alone)
//		uv: the world position over the cascade's size
fn windLookup(cascade: i32, uv: vec2f, turn: f32) -> TurnedWave {
	let apart = 0.5;
	let lower = floor(turn / apart);
	let between = turn / apart - lower;
	var turned = TurnedWave(WaveSample(0.0, vec2f(0.0, 0.0), vec2f(0.0, 0.0), vec3f(0.0, 0.0, 0.0)), 0.0);
	for (var side = 0; side < 2; side++) {
		let weight = select(1.0 - between, between, side == 1);
		if (weight < 0.001) {
			continue;
		}
		let toWorld = rotation((lower + f32(side)) * apart);
		let toMap = transpose(toWorld);
		let at = toMap * uv;
		var wave: vec4f;
		var slope: vec4f;
		var foam: f32;
		if (cascade == 1) {
			wave = textureSampleLevel(waveTexture1, waveSampler, at, 0.0);
			slope = textureSampleLevel(slopeTexture1, waveSampler, at, 0.0);
			foam = foamAt(foamTexture1, at);
		} else {
			wave = textureSampleLevel(waveTexture2, waveSampler, at, 0.0);
			slope = textureSampleLevel(slopeTexture2, waveSampler, at, 0.0);
			foam = foamAt(foamTexture2, at);
		}
		turned.wave = addWave(turned.wave, scaleWave(waveFromMaps(wave, slope, toMap, toWorld), weight));
		turned.foam = max(turned.foam, foam * weight);
	}
	turned.wave = scaleWave(turned.wave, 1.0 / sqrt((1.0 - between) * (1.0 - between) + between * between));
	return turned;
}

// Everything about one vertex of this tile's mesh, at grid index (ix, iz) of the tile
fn waterVertex(ix: u32, iz: u32) -> WaterVertex {

		//------------------------------FORM GRID-------------------------------

		// a tile's mesh has tileCells cells per side: the most under the camera, half as many for the next ring out, and so on
		let tileCells = u32(WU.tileCells);

		let gridIndexX = f32(ix);
		let gridIndexZ = f32(iz);

		// Scale grid indices to physical size					!!!ASSUMES GRID IS SQUARE
		let cellSize = WU.gridSize.x / f32(tileCells);
		let vertGridPosX = gridIndexX * cellSize;
		let vertGridPosZ = gridIndexZ * cellSize;

		// World position of this water vertex
        let worldX = (vertGridPosX - WU.gridSize.x * 0.5) + WU.tileOffsetX;
		let worldZ = (vertGridPosZ - WU.gridSize.y * 0.5) + WU.tileOffsetZ;
		return waterVertexAt(vec2f(worldX, worldZ));
}

// Everything about the water at a place in the world (x, z), as it is before the waves move it: a vertex of a tile's mesh, or a
//		probe (probeMain)
fn waterVertexAt(worldXZ: vec2f) -> WaterVertex {
		let worldX = worldXZ.x;
		let worldZ = worldXZ.y;

        // Project into top-down camera clip space
        let worldPos4 = vec4f(worldX, 0.0, worldZ, 1.0);
        let clipPos   = Spaces.topDownViewProj * worldPos4;
        let ndcXY     = clipPos.xy / clipPos.w;
        let texUV     = vec2f(ndcXY.x * 0.5 + 0.5, 1.0 - (ndcXY.y * 0.5 + 0.5));

        let texCoord = vec2u(
            u32(clamp(texUV.x * Spaces.topDownTextureSize.x, 0.0, Spaces.topDownTextureSize.x - 1.0)),
            u32(clamp(texUV.y * Spaces.topDownTextureSize.y, 0.0, Spaces.topDownTextureSize.y - 1.0))
        );

        // Unproject depth to get terrain world Y
        let depth           = textureLoad(topDownHeightmapTexture, texCoord, 0);
        let terrainClip     = vec4f(ndcXY.x, ndcXY.y, depth, 1.0);
        var terrainWorldPos = Spaces.topDownInvViewProj * terrainClip;
        terrainWorldPos    /= terrainWorldPos.w;

        // Two sources for what is under the water, blended together:
		//		near the camera, the top down height map. Fine detail, but it only covers a box around the camera
		//		everywhere else, the terrain's own texture of the whole world. Coarse, but without it the waves have no idea
		//		a far off coast is there, and roll straight over the land at full size
		let boxEdge = min(min(texUV.x, 1.0 - texUV.x), min(texUV.y, 1.0 - texUV.y));	// negative outside the top down camera's box
		let boxFade = saturate(boxEdge / 0.08);										// 1 well inside the box, 0 at its edge and beyond
		let worldTerrain = worldTerrainAt(worldXZ);
        let waterDepth = mix(WU.planeYPos - worldTerrain.x, WU.planeYPos - terrainWorldPos.y, boxFade);
		let fullDepthThreshold = max(WU.fullDepth, 0.001); // where anything beyond this is full depth for full waves

		//------------------Distance To Shore-----------------
		// world distance to the nearest land, bilinear filtered out of the shore distance field (c_ShoreScan + c_ShoreDistance)
		//		the field lines up texel for texel with the top down height map, just at a lower resolution, so it uses the same UV
		let shoreFieldSize = vec2f(textureDimensions(shoreDistanceTexture));
		let shoreMaxTexel = vec2i(shoreFieldSize) - vec2i(1, 1);
		let shoreCoord = texUV * shoreFieldSize - vec2f(0.5, 0.5);
		let shoreBase = vec2i(floor(shoreCoord));
		let shoreFrac = fract(shoreCoord);
		let shoreTexel00 = clamp(shoreBase, vec2i(0, 0), shoreMaxTexel);
		let shoreTexel11 = clamp(shoreBase + vec2i(1, 1), vec2i(0, 0), shoreMaxTexel);
		let shore00 = textureLoad(shoreDistanceTexture, shoreTexel00).x;
		let shore10 = textureLoad(shoreDistanceTexture, vec2i(shoreTexel11.x, shoreTexel00.y)).x;
		let shore01 = textureLoad(shoreDistanceTexture, vec2i(shoreTexel00.x, shoreTexel11.y)).x;
		let shore11 = textureLoad(shoreDistanceTexture, shoreTexel11).x;

		// the field only covers the top down camera box. Towards its edge the distance goes over to the whole-world one from the terrain
		let shoreFieldTexelSize = length((Spaces.topDownInvViewProj * vec4f(2.0 / shoreFieldSize.x, 0.0, 0.0, 0.0)).xyz);
		let shoreFieldRange = ${SHORE_SEARCH_RADIUS}.0 * shoreFieldTexelSize;	// what the field holds for open ocean
		let shoreDistance = mix(min(worldTerrain.y, shoreFieldRange), mix(mix(shore00, shore10, shoreFrac.x), mix(shore01, shore11, shoreFrac.x), shoreFrac.y), boxFade);

		// direction straight away from the shore (gradient of the distance), turned from field texel axes into world x/z
		let shoreGradTexel = vec2f(mix(shore10 - shore00, shore11 - shore01, shoreFrac.y), mix(shore01 - shore00, shore11 - shore10, shoreFrac.x));
		let fieldAxisU = (Spaces.topDownInvViewProj * vec4f(1.0, 0.0, 0.0, 0.0)).xz;
		let fieldAxisV = (Spaces.topDownInvViewProj * vec4f(0.0, -1.0, 0.0, 0.0)).xz;	// texture v runs opposite to ndc y
		let shoreGradWorld = (shoreGradTexel.x * normalize(fieldAxisU) + shoreGradTexel.y * normalize(fieldAxisV)) * boxFade;

		//Taking Depth into account
		//		how far from deep the water is: only the spikey ripples of the shallows go by this now (the waves themselves are held to the depth, below)
		let attenuation = clamp(waterDepth / fullDepthThreshold, 0.0, 1.0); //0.0 to 1.0 from shallow to full depth
		//------------------Lakes-----------------
		// A lake's waves are the sea's: the same settings, the same spectrum, faded by the depth and the shore in the same way.
		//		What it does not have is what needs the open sea to make it: a swell, and surf (and with them, foam)
		let lake = saturate(worldTerrain.z);
		let rippleScale = WU.shallowRippleScale;  // depends on wave magnitude. Ripples will be "spikey", this decides shallow water ripple height
								//		typically its a percent of wave at full height. so 0.1 to 0.3 is good for approachin shallows
								//		while >1.0 is bigger than regular waves
								//		perhaps just tie this with attenutation for depth
								//		ALSO MAKE AS A PASS IN OR CALC HERE DIFFERENT
		let shallowFactor = 1.0 - attenuation;

		// the waves flatten out with distance from the camera, so the furthest tiles end dead flat and meet the horizon plane with no seam.
		//		out there a wave is far smaller than a pixel anyway, and a real horizon is a straight line
		let cameraDistance = length(worldXZ - WU.cameraPosition.xz);
		let distanceFade = 1.0 - smoothstep(WU.waveFadeDistance * 0.45, WU.waveFadeDistance, cameraDistance);

		//------------------[REALISTIC] FFT Oceanographic Waves-----------------
		// the same sea simulated at three sizes (the cascades, see water.js), each read at this vertex's place in the world.
		//		So they line up from tile to tile whatever size the tiles are, and between them only repeat every few kilometres
		//	cascade 0: the swell (and the longest of the wind waves). Turned by the shallows: read through the refraction map (see swellLookup),
		//		so its crests swing round to face the beaches, wrap round headlands and crowd together as the water shallows. And taller
		//		as they come in (shoaling). No swell on a lake
		//	cascade 1: the wind sea. Turned towards the shore too, but only as much as the waves feel the bottom (see windLookup)
		//	cascade 2: the shortest waves. They fade out with distance before the coarser rings of tiles, whose cells are too big to carry them
		//		(by distance, not by ring: two tiles have to agree on the vertices along the edge they share)
		//	None of them is faded out by the depth any more: they come all the way in, and break where they get too tall for the water (below)
		let swellWeight = (1.0 - lake) * distanceFade;
		let windWeight = distanceFade;
		let fineFade = 1.0 - smoothstep(WU.fineFadeStart, WU.fineFadeEnd, cameraDistance);
		let depthMetres = max(waterDepth, 0.0) / WU.unitsPerMetre;

		var swell = WaveSample(0.0, vec2f(0.0), vec2f(0.0), vec3f(0.0));
		var swellGrowth = 0.0;
		var wind = WaveSample(0.0, vec2f(0.0), vec2f(0.0), vec3f(0.0));
		var keptFoam = 0.0;	// the foam the wind waves broke into a little while ago, still lying on the water
		if (swellWeight > 0.0) {
			let read = swellLookup(worldXZ, depthMetres);
			swell = scaleWave(read.wave, swellWeight);
			swellGrowth = read.growth * swellWeight;
		}

		// which way the shore is, and how far round towards it the wind waves turn: Snell's law. A wave turns as much as it feels the bottom,
		//		1 - tanh(k depth): nothing in deep water, all the way round in the shallows, the long waves sooner than the short. And
		//		only one coming in: chop the wind blows out to sea (out of a bay, off a beach) runs out to sea
		let shoreGradLength = length(shoreGradWorld);
		var towardsShore = vec2f(0.0, 0.0);
		var turnTowardsShore = 0.0;
		if (shoreGradLength > 0.0001) {
			towardsShore = -shoreGradWorld / shoreGradLength;
			let windHeading = normalize(WU.windDirection);
			let comingIn = smoothstep(0.0, 0.35, dot(windHeading, towardsShore));
			let steady = smoothstep(0.45, 0.85, shoreGradLength / max(shoreFieldTexelSize, 0.0001));	// (on a ridge of the distance it swings about)
			turnTowardsShore = atan2(windHeading.x * towardsShore.y - windHeading.y * towardsShore.x, dot(windHeading, towardsShore)) * comingIn * steady;
		}
		if (distanceFade > 0.0) {
			let turned = windLookup(1, worldXZ / WU.cascadeSize1, turnTowardsShore * (1.0 - tanh(WU.chopK1 * max(waterDepth, 0.0))));
			wind = addWave(wind, turned.wave);
			keptFoam = turned.foam;
		}
		if (distanceFade > 0.0 && fineFade > 0.0) {
			let turned = windLookup(2, worldXZ / WU.cascadeSize2, turnTowardsShore * (1.0 - tanh(WU.chopK2 * max(waterDepth, 0.0))));
			wind = addWave(wind, scaleWave(turned.wave, fineFade));
			keptFoam = max(keptFoam, turned.foam * fineFade);
		}
		wind = scaleWave(wind, windWeight);

		// Breaking. Waves can only stand so tall in water so deep: in a surf zone their significant height is held to about half the
		//		depth, the rest of what they bring in lost as they break. So all of them are scaled down to that, from the height they
		//		would have here otherwise (the swell's, grown by the shallows, and the wind sea's), which keeps their shape and only
		//		makes them smaller. Far out the water is deep enough never to notice. What is breaking shows as white water on the crests
		let expectedHeight = sqrt(WU.swellHs * swellGrowth * WU.swellHs * swellGrowth + WU.windHs * WU.windHs * windWeight * windWeight);
		let surfHold = min(1.0, 0.5 * max(waterDepth, 0.0) / max(expectedHeight, 0.001));
		swell = scaleWave(swell, surfHold);
		wind = scaleWave(wind, surfHold);
		// Waves over water shallow for their size ride high (an option, WU.rideHigh): a wave coming into the shallows has peaked crests and
		//		long flat troughs that hardly dip under the still water, where a sine wave sinks as far as it rises. Over a shelf dropping
		//		off, a big wave would otherwise look to suck down before it runs in. So the troughs are lifted towards the still water and the
		//		crests stand taller, the more the shallower the water is next to the waves. Through the still water line smoothly (tanh),
		//		so there is no crease. Out in deep water nothing changes
		let evenHeight = swell.height + wind.height;
		let shallowness = WU.rideHigh * saturate(1.5 * expectedHeight / max(waterDepth, 0.1) - 0.15);
		let side = tanh(evenHeight / 0.3);
		let rideHigh = 1.0 + 0.85 * shallowness * side;
		let rawHeight = evenHeight * rideHigh;
		let rideHighSlope = rideHigh + evenHeight * 0.85 * shallowness * (1.0 - side * side) / 0.3;	// d(rawHeight) / d(evenHeight)
		//	and the odd wave still too tall for the water, its crest held under 0.55 times the depth and its trough above -0.4 times it,
		//		softly (tanh), and as much as was cut off shows as foam
		let crestRoom = max(0.55 * waterDepth, 0.02);
		let troughRoom = max(0.4 * waterDepth, 0.02);
		let room = select(troughRoom, crestRoom, rawHeight > 0.0);
		let heldHeight = room * tanh(rawHeight / room);
		let held = 1.0 - tanh(rawHeight / room) * tanh(rawHeight / room);	// d(heldHeight) / d(rawHeight)
		let overTop = saturate((rawHeight - heldHeight) / (0.25 * crestRoom + 0.05));
		let surfCrest = (1.0 - surfHold) * smoothstep(0.3, 0.75, heldHeight / crestRoom);	// the crests in a surf zone, as much as it is breaking
		let breakFoam = saturate(max(overTop, 1.4 * surfCrest)) * (1.0 - lake);
		// and nothing pushed sideways further than the water is deep, or the shallows would be shoved up onto the sand
		let pushRoom = max(0.6 * waterDepth, 0.02);

		// boost high freq detail by exaggerating deviation from local mean
		// squaring preserves sign and amplifies peaks/troughs
		let rippleDetail = sign(wind.height) * (wind.height * wind.height) * shallowFactor * rippleScale;
		let rippleChain = 2.0 * abs(wind.height) * shallowFactor * rippleScale;	// d(rippleDetail) / d(height)

		var waveHeightAdj = heldHeight + rippleDetail * distanceFade + WU.planeYPos;
		let heightSlope = held * rideHighSlope * (swell.slope + wind.slope) + rippleChain * distanceFade * wind.slope;	// d(waveHeightAdj) / dx, dz

		//------------------[REALISTIC] Choppy Displacement-----------------
		// the horizontal displacement D pulls each vertex towards the nearest crest, which pinches the crests into peaks and flattens the troughs
		let choppiness = WU.choppiness;	// lambda in the tessendorf paper. Around 1.0 is where crests start folding over themselves
		let rawDisplacement = choppiness * (swell.push + wind.push);
		let pushLength = length(rawDisplacement);
		let pushHeld = select(1.0, pushRoom * tanh(pushLength / pushRoom) / pushLength, pushLength > 0.0001);
		let displacement = rawDisplacement * pushHeld;
		// and how the displacement changes across the surface. x: dDx/dx, y: dDz/dz, z: dDx/dz (which is dDz/dx)
		let displacementChange = choppiness * pushHeld * (swell.squeeze + wind.squeeze);

		//------------------Boulders In The Sea-----------------
		// The water round a boulder standing in the sea: it piles up against the side the waves come from, the more as a crest
		//		runs into it, is pushed out round it, sinks a little in its lee, and breaks white on it (where the spray comes from too)
		var rockHeight = 0.0;
		var rockPush = vec2f(0.0, 0.0);
		var rockSlope = vec2f(0.0, 0.0);
		var rockFoam = 0.0;
		let surge = saturate((waveHeightAdj - WU.planeYPos) / max(0.5 * expectedHeight, 0.5));	// how far up a crest the water is here
		for (var r = 0; r < i32(Rocks.count.x); r++) {
			let rock = Rocks.at[r * 2];
			let rel = worldXZ - rock.xy;
			let distance = length(rel);
			let radius = rock.z;
			let reach = 0.6 * radius + 1.5;					// how far out from its side the water feels it
			let edge = max(distance - radius, 0.0);
			if (edge > 5.0 * reach || distance < 0.0001) {
				continue;
			}
			let away = rel / distance;
			let runs = Rocks.at[r * 2 + 1].xy;
			let facing = dot(away, -runs);					// 1 on the side the waves come at
			let near = exp(-edge / reach);
			let standing = saturate((rock.w + 1.0) / 1.5);	// a boulder just under the surface still breaks the water, less so
			let size = min(1.0 + 0.25 * radius, 3.0) * standing;
			let piled = size * near * ((0.35 + 0.65 * saturate(facing)) * (0.4 + 0.6 * surge) - 0.3 * saturate(-facing));
			rockHeight += piled;
			rockSlope += -piled / reach * away;					// (along the way out from it: the share of its slope that matters)
			rockPush += away * (0.6 * size * near);
			rockFoam = max(rockFoam, near * near * (0.5 + 0.5 * saturate(facing)) * (0.4 + 0.6 * surge) * standing);
		}
		rockFoam *= (1.0 - lake);

		var position = vec3f(worldX + displacement.x + rockPush.x,
							 waveHeightAdj + rockHeight,
							 worldZ + displacement.y + rockPush.y);

		//------------------Normal and Crest Foam-----------------
		// tangents of the displaced surface along world x and z, per unit moved along them. The normal is their cross product
		//		the waves' share comes straight out of the slope maps, no neighbours needed
		let tangentX = vec3f(1.0 + displacementChange.x, heightSlope.x + rockSlope.x, displacementChange.z);
		let tangentZ = vec3f(displacementChange.z, heightSlope.y + rockSlope.y, 1.0 + displacementChange.y);
		var normal = normalize(cross(tangentZ, tangentX));
		if (normal.y < 0.0) {
			normal = -normal;	// surface has folded over itself here, keep the normal facing up
		}

		// Jacobian of the horizontal displacement: how much a patch of surface has been squeezed
		//		1.0 is undisturbed, < 1.0 is squeezed together (crests), > 1.0 is stretched (troughs), < 0.0 has folded over (a breaking wave)
		let jacobian = tangentX.x * tangentZ.z - tangentX.z * tangentZ.x;
		let foamThreshold = WU.foamThreshold;		// foam starts where the jacobian drops below this
		let foamFade = max(WU.foamFade, 0.001);		// how far below the threshold until its fully white
		let foam = max(max(saturate((foamThreshold - jacobian) / foamFade), breakFoam), rockFoam);	// (and the waves breaking in the shallows and on the boulders)

		var vertex: WaterVertex;
		vertex.position = position;
		// Where there is water standing over the bed a trough never empties it: the surface is held a little above the sand
		//		(by the depth of the still water, up to a hand's width). On a wide flat shelf every trough would otherwise show as a patch of dry sand
		if (waterDepth > 0.0) {
			vertex.position.y = max(position.y, WU.planeYPos - waterDepth + min(waterDepth, 0.35));
		}
		vertex.normal = normal;
		// the fragment shader has to know a lake from the sea as well, and there is no slot left to tell it in. But a lake
		//		has no foam, so on a lake the foam slot carries "this is a lake" instead, as a number below 0
		vertex.foam = select(foam, -lake, lake > 0.02);
		vertex.keptFoam = keptFoam * windWeight * (1.0 - lake);
		// depth of the (still) water here, for the see-through shallows. Open sea is far too deep to see through, so it stays opaque
		vertex.depth = waterDepth;
		// the crests: where the waves squeeze the surface together (the jacobian under 1), which is where it stands up thin. Not how high it
		//		is: a whole swell standing high is no thinner for it
		vertex.crest = saturate((1.0 - jacobian) * 2.2) * (1.0 - lake);
		return vertex;
}

@compute @workgroup_size(${WATER_WORKGROUP_SIZE[0]}, ${WATER_WORKGROUP_SIZE[1]}, ${WATER_WORKGROUP_SIZE[2]})
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {

		var gIndex = GlobalIvocationID.x;

		let fPerVertexData = u32(3 + 2 + 3 + 1);

		// this tile's mesh: tileCells cells per side, so one more vertex than that per side
		let tileCells = u32(WU.tileCells);
		let gridWidth = tileCells + 1u;
		if (gIndex >= gridWidth * gridWidth) {
			return;	// the dispatch is rounded up to whole workgroups, the spare threads have no vertex
		}

		let ix = gIndex % gridWidth;
		let iz = gIndex / gridWidth;

		let oVertInd = gIndex * fPerVertexData;

		var vertex = waterVertex(ix, iz);

		//------------------------------LEVEL OF DETAIL SEAMS-------------------------------
		// where this tile meets a coarser one, the coarser tile only has every 2nd vertex along the shared edge and runs straight between them.
		//		this tile's extra vertices in between would open gaps along that edge, so each one is put on the straight line
		//		between its two neighbours, which is exactly where the coarser tile's edge is
		var between = vec2u(0u, 0u);	// which way along the edge those two neighbours are, (0, 0) for every vertex that isnt one of the in between ones
		if ((ix == 0u && WU.coarserEdge.x > 0.5) || (ix == tileCells && WU.coarserEdge.y > 0.5)) {
			between.y = iz % 2u;
		}
		if ((iz == 0u && WU.coarserEdge.z > 0.5) || (iz == tileCells && WU.coarserEdge.w > 0.5)) {
			between.x = ix % 2u;
		}
		if (between.x + between.y > 0u) {
			let before = waterVertex(ix - between.x, iz - between.y);
			let after = waterVertex(ix + between.x, iz + between.y);
			vertex.position = (before.position + after.position) * 0.5;
			vertex.normal = normalize(before.normal + after.normal);
			vertex.foam = (before.foam + after.foam) * 0.5;
			vertex.keptFoam = (before.keptFoam + after.keptFoam) * 0.5;
			vertex.depth = (before.depth + after.depth) * 0.5;
			vertex.crest = (before.crest + after.crest) * 0.5;
		}

		// uv isnt used by the water yet, so the foam factor and the water depth ride in that slot
		waterVertexData[oVertInd + 0] = vertex.position.x;
		waterVertexData[oVertInd + 1] = vertex.position.y;
		waterVertexData[oVertInd + 2] = vertex.position.z;
		waterVertexData[oVertInd + 3] = vertex.foam;
		waterVertexData[oVertInd + 4] = vertex.depth;
		// the foam left lying on the water rides in the length of the normal (1 + it): there is no slot left for it, and everything
		//		that reads the normal makes it 1 long again anyway. The spray (particles.js) only goes by the foam of the crests breaking now
		let normalWithFoam = normalize(vertex.normal) * (1.0 + saturate(vertex.keptFoam));
		waterVertexData[oVertInd + 5] = normalWithFoam.x;
		waterVertexData[oVertInd + 6] = normalWithFoam.y;
		waterVertexData[oVertInd + 7] = normalWithFoam.z;
		waterVertexData[oVertInd + 8] = vertex.crest;
		
		
		//--------------------FORM TRIANGLES IN INDEX BUFFER---------------------
		// Generate triangles: use the grid to form triangles between four points
		//let gridIndexX = f32(gIndex) % f32(gridWidth);
		//let gridIndexZ = f32(gIndex) / f32(gridWidth);
			
		if (ix < gridWidth - 1u && iz < gridWidth - 1u) {
			let baseIndex = iz * gridWidth + ix;  // explicit 2D → 1D, not gIndex
			let cellIndex = iz * (gridWidth - 1u) + ix;  // cell index, not vertex index
		
			waterIndexData[cellIndex * 6u + 0u] = baseIndex;
			waterIndexData[cellIndex * 6u + 1u] = baseIndex + 1u;
			waterIndexData[cellIndex * 6u + 2u] = baseIndex + gridWidth;
		
			waterIndexData[cellIndex * 6u + 3u] = baseIndex + gridWidth;
			waterIndexData[cellIndex * 6u + 4u] = baseIndex + 1u;
			waterIndexData[cellIndex * 6u + 5u] = baseIndex + gridWidth + 1u;
		}
		
	}

// The water's surface at a few places in the world, for things floating on it (see setWaterProbes in water.js): the very water the
//		mesh is made of. Here waterVertexData holds the probes instead of a tile's mesh, 8 numbers each: x, z of the place asked
//		about, and back: the height of the surface there, its normal (x, y, z), the depth of the still water, the foam.
//		The waves move the surface sideways as well as up and down (the choppy displacement), so the water over a place is the
//		water from a little way off it: found by stepping back by however far it missed, a few times over
@compute @workgroup_size(${WATER_WORKGROUP_SIZE[0]}, 1, 1)
fn probeMain(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= arrayLength(&waterVertexData) / 8u) {
		return;
	}
	let o = id.x * 8u;
	let wanted = vec2f(waterVertexData[o], waterVertexData[o + 1u]);
	var source = wanted;
	var water = waterVertexAt(source);
	for (var i = 0; i < 3; i++) {
		source += wanted - water.position.xz;
		water = waterVertexAt(source);
	}
	waterVertexData[o + 2u] = water.position.y;
	waterVertexData[o + 3u] = water.normal.x;
	waterVertexData[o + 4u] = water.normal.y;
	waterVertexData[o + 5u] = water.normal.z;
	waterVertexData[o + 6u] = water.depth;
	waterVertexData[o + 7u] = max(water.foam, 0.0);
}
`;

/*
	This is converting from frequency domain back to spatial domain (wave heights in world space) 
	It runs in two sweeps: first horizontally across all rows, then vertically across all columns. Each sweep runs log2(resolution) stages, 
	and each stage does butterfly operations. combining pairs of complex numbers using the precomputed twiddle factors
	
	A ping-pong buffer alternates between two storage arrays each stage to avoid read/write conflicts 
	At the end, the real part of each complex value is the actual wave height at that grid point
*/

export const c_IFFT_2D =
`
	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveSteepness: f32,	
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
		@location(5) planeYPos: f32,
		@location(6) waveLength: f32,
		@location(7) oceanPlanePhysicalSize: f32,
		@location(8) windSpeed: f32,
		@location(9) tileOffsetX: f32,
		@location(10) tileOffsetZ: f32,
		@location(11) gridSize: vec2f,
	};
	@group(0) @binding(0) var<uniform> WU: WaterUniforms;
	
	//@group(0) @binding(1) var inTexture : texture_2d<f32>;
	//@group(0) @binding(2) var outTexture : texture_storage_2d<rgba32float, write>;
	
	@group(0) @binding(1) var<storage, read_write> pingPongA: array<f32>;
	@group(0) @binding(2) var<storage, read_write> pingPongB: array<f32>;
	
	struct ButterflyUniforms {
		@location(0) direction: f32,
		@location(1) stage: f32,
		@location(2) pingPong: f32,
		
		@location(3) padding0: f32,
	};
	@group(0) @binding(3) var<uniform> BU: ButterflyUniforms;

	@group(0) @binding(4) var preCompTexture : texture_storage_2d<rgba32float, read>;

	fn complexMul(a: vec2f, b: vec2f) -> vec2f {
		return vec2f(
			a.x * b.x - a.y * b.y,
			a.x * b.y + a.y * b.x
		);
	}
	
	fn complexConj(z: vec2f) -> vec2f {
		return vec2f(z.x, -z.y);
	}
	
	fn complexAdd(a: vec2f, b: vec2f) -> vec2f {
		return vec2f(a.x + b.x, a.y + b.y);
	}
	
	fn complexSub(a: vec2f, b: vec2f) -> vec2f {
		return vec2f(a.x - b.x, a.y - b.y);
	}
	
	fn complexExp(a: vec2f) -> vec2f {
		return vec2f(cos(a.y), sin(a.y)) * exp(a.x);
	}

	@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {

		var gIndex = GlobalInvocationID.xy;
		let res = u32(WU.resolution);
		// every field of every cascade goes through at once, one layer of the buffers each (z)
		let layerStart = GlobalInvocationID.z * res * res;

		// the two elements this one is made from, along its row (horizontal) or its column (vertical), and their twiddle factor
		var preCompData: vec4f;
		var indexA: u32;
		var indexB: u32;
		if (BU.direction == 0.0) {
			// Horizontal pass (IFFT along rows)
			preCompData = textureLoad(preCompTexture, vec2u(u32(BU.stage), gIndex.x));
			indexA = layerStart + gIndex.y * res + u32(preCompData.z);
			indexB = layerStart + gIndex.y * res + u32(preCompData.w);
		} else {
			// Vertical pass (IFFT along columns)
			preCompData = textureLoad(preCompTexture, vec2u(u32(BU.stage), gIndex.y));
			indexA = layerStart + u32(preCompData.z) * res + gIndex.x;
			indexB = layerStart + u32(preCompData.w) * res + gIndex.x;
		}
		let outIndex = layerStart + gIndex.y * res + gIndex.x;
		let w = vec2f(preCompData.x, preCompData.y);

		// Perform FFT butterfly operation, from one ping pong buffer into the other
		if (BU.pingPong == 0.0) {
			let a = vec2f(pingPongA[indexA * 2u], pingPongA[indexA * 2u + 1u]);
			let b = vec2f(pingPongA[indexB * 2u], pingPongA[indexB * 2u + 1u]);
			let result = complexAdd(a, complexMul(w, b));
			pingPongB[outIndex * 2u] = result.x;
			pingPongB[outIndex * 2u + 1u] = result.y;
		} else {
			let a = vec2f(pingPongB[indexA * 2u], pingPongB[indexA * 2u + 1u]);
			let b = vec2f(pingPongB[indexB * 2u], pingPongB[indexB * 2u + 1u]);
			let result = complexAdd(a, complexMul(w, b));
			pingPongA[outIndex * 2u] = result.x;
			pingPongA[outIndex * 2u + 1u] = result.y;
		}
	}
`;

/*
	Shore distance field, first of two passes. Runs every frame on a low resolution copy of the top down height map.
	Together the two passes give every texel its distance to the nearest land, which the water mesh pass uses to fade the ocean waves
	out and aim the shore waves in. It only looks SHORE_SEARCH_RADIUS texels out, the water doesnt care about a shoreline further away than that.

	This pass looks up and down each column for the nearest land texel. The second pass (c_ShoreDistance) then combines the columns
	sideways, which gives the true straight line distance for 2 small passes instead of searching a whole circle of texels around each one.
*/
export const c_ShoreScan =
`
	struct WaterSpaces
	{
		modelViewProjectionMatrix : mat4x4f,
		topDownViewProj : mat4x4f,
		topDownInvViewProj : mat4x4f,
		topDownTextureSize : vec2f,
		_padding0 : vec2f,
	}
	@group(0) @binding(0) var<uniform> Spaces: WaterSpaces;

	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveSteepness: f32,
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
		@location(5) planeYPos: f32,
		@location(6) waveLength: f32,
		@location(7) oceanPlanePhysicalSize: f32,
		@location(8) windSpeed: f32,
		@location(9) tileOffsetX: f32,
		@location(10) tileOffsetZ: f32,
		@location(11) gridSize: vec2f,
	};
	@group(0) @binding(1) var<uniform> WU: WaterUniforms;

	@group(0) @binding(2) var topDownHeightmapTexture : texture_depth_2d;
	@group(0) @binding(3) var shoreScanTexture : texture_storage_2d<r32float, write>;	//x: texels up or down the column to the nearest land

	// the top down camera is orthographic and looks straight down, so its depth only depends on world height:
	//		anything nearer to that camera than the water plane is land sticking out of the water
	fn isLand(fieldTexel: vec2i, waterPlaneDepth: f32) -> bool {
		let heightMapTexel = fieldTexel * ${SHORE_FIELD_DOWNSCALE} + vec2i(${SHORE_FIELD_DOWNSCALE / 2}, ${SHORE_FIELD_DOWNSCALE / 2});	// middle of the block this field texel covers
		return textureLoad(topDownHeightmapTexture, heightMapTexel, 0) < waterPlaneDepth;
	}

	@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		let fieldSize = vec2i(textureDimensions(shoreScanTexture));
		let gIndex = vec2i(GlobalInvocationID.xy);
		if (gIndex.x >= fieldSize.x || gIndex.y >= fieldSize.y) {
			return;
		}

		let waterPlaneClip = Spaces.topDownViewProj * vec4f(WU.cameraPosition.x, WU.planeYPos, WU.cameraPosition.z, 1.0);
		let waterPlaneDepth = waterPlaneClip.z / waterPlaneClip.w;

		// walk outwards both ways along the column and stop at the first land. Texels off the edge of the map count as water
		var nearest = 1.0e6;	// no land in reach
		for (var offset = 0; offset <= ${SHORE_SEARCH_RADIUS}; offset++) {
			let up = gIndex.y - offset;
			let down = gIndex.y + offset;
			if ((up >= 0 && isLand(vec2i(gIndex.x, up), waterPlaneDepth)) || (down < fieldSize.y && isLand(vec2i(gIndex.x, down), waterPlaneDepth))) {
				nearest = f32(offset);
				break;
			}
		}

		textureStore(shoreScanTexture, gIndex, vec4f(nearest, 0.0, 0.0, 1.0));
	}
`;

/*
	Shore distance field, second pass. For every texel along the row, c_ShoreScan already knows how far up or down that column the nearest land is.
	The nearest land overall is whichever column makes the shortest diagonal: sqrt(sideways^2 + upDown^2)
	Stored in world units, 0 on land, capped at the search radius for open ocean.
*/
export const c_ShoreDistance =
`
	struct WaterSpaces
	{
		modelViewProjectionMatrix : mat4x4f,
		topDownViewProj : mat4x4f,
		topDownInvViewProj : mat4x4f,
		topDownTextureSize : vec2f,
		_padding0 : vec2f,
	}
	@group(0) @binding(0) var<uniform> Spaces: WaterSpaces;

	@group(0) @binding(1) var shoreScanTexture : texture_storage_2d<r32float, read>;
	@group(0) @binding(2) var shoreDistanceTexture : texture_storage_2d<r32float, write>;	//x: world distance to the nearest land

	const SHORE_ROUNDING: f32 = 3.0;	// field texels: how far round the ridges of the distance are rounded off

	@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		let fieldSize = vec2i(textureDimensions(shoreDistanceTexture));
		let gIndex = vec2i(GlobalInvocationID.xy);
		if (gIndex.x >= fieldSize.x || gIndex.y >= fieldSize.y) {
			return;
		}

		var nearestSquared = ${SHORE_SEARCH_RADIUS * SHORE_SEARCH_RADIUS}.0;
		for (var offset = -${SHORE_SEARCH_RADIUS}; offset <= ${SHORE_SEARCH_RADIUS}; offset++) {
			let column = gIndex.x + offset;
			if (column < 0 || column >= fieldSize.x) {
				continue;
			}
			let upDown = textureLoad(shoreScanTexture, vec2i(column, gIndex.y)).x;
			nearestSquared = min(nearestSquared, f32(offset * offset) + upDown * upDown);
		}
		// A smooth minimum over the columns instead of the nearest alone: where two stretches of coast are as near as each other the
		//		distance has a sharp ridge, and every shore wave, which follows the distance, came in as a V. The smooth minimum
		//		rounds the ridges off. (it reads a little nearer than the nearest; taken back off, so a straight coast stays where it is)
		let nearest = sqrt(nearestSquared);
		var together = 0.0;
		for (var offset = -${SHORE_SEARCH_RADIUS}; offset <= ${SHORE_SEARCH_RADIUS}; offset++) {
			let column = gIndex.x + offset;
			if (column < 0 || column >= fieldSize.x) {
				continue;
			}
			let upDown = textureLoad(shoreScanTexture, vec2i(column, gIndex.y)).x;
			together += exp(-(sqrt(f32(offset * offset) + upDown * upDown) - nearest) / SHORE_ROUNDING);
		}
		let straightCoast = sqrt(2.0 * 3.14159 * max(nearest, 1.0) * SHORE_ROUNDING);	// about what a straight coast adds up to

		// texels to world units: the size of one field texel on the ground
		let texelSize = length((Spaces.topDownInvViewProj * vec4f(2.0 / f32(fieldSize.x), 0.0, 0.0, 0.0)).xyz);

		let rounded = max(nearest - SHORE_ROUNDING * log(together / max(straightCoast, 1.0)), 0.0);
		textureStore(shoreDistanceTexture, gIndex, vec4f(select(rounded, nearest, nearest >= ${SHORE_SEARCH_RADIUS}.0) * texelSize, 0.0, 0.0, 1.0));
	}
`;


/*
	A one-time setup for the FFT. The Cooley-Tukey FFT algorithm needs to know, for each stage and each element, which two elements to combine and what twiddle factor (complex rotation) to apply
	This pass bakes all of that into a lookup texture so the main butterfly pass doesn't have to recompute it every stage
	It also handles bit-reversal reordering, which is required to put the input data in the correct order for the FFT butterfly pattern
*/
export const c_PreComp =
`
	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveSteepness: f32,	
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
		@location(5) planeYPos: f32,
		@location(6) waveLength: f32,
		@location(7) oceanPlanePhysicalSize: f32,
		@location(8) windSpeed: f32,
		@location(9) tileOffsetX: f32,
		@location(10) tileOffsetZ: f32,
	};
	@group(0) @binding(0) var<uniform> WU: WaterUniforms;

	@group(0) @binding(1) var preCompTexture : texture_storage_2d<rgba32float, write>;
			
	struct ButterflyUniforms {
		@location(0) direction: f32,
		@location(1) stage: f32,	
	};
	@group(0) @binding(2) var<uniform> BU: ButterflyUniforms;
	
	@group(0) @binding(3) var<storage, read_write> bitReversedIndices: array<f32>;

	
	fn complexExp(a: vec2f) -> vec2f {
		return vec2f(cos(a.y), sin(a.y)) * exp(a.x);
	}
	
	fn bitReverse(n: u32, bits: u32) -> u32 {
		var reversed: u32 = 0u;
		var i: u32 = 0u;
		var r = n;
		while (i < bits) {
			reversed = (reversed << 1u) | (r & 1u);  // Shift reversed and OR with the lowest bit of n
			r = r >> 1u;  // Shift n to the right
			i = i + 1u;
		}
		return reversed;
	}
	
	fn uncenterIndex(index: u32, resolution: u32) -> u32 {
		let half = resolution / 2u;
		return (index + half) % resolution;
	}

	@compute @workgroup_size(${PRECOMP_WORKGROUP_SIZE[0]}, ${PRECOMP_WORKGROUP_SIZE[1]}, ${PRECOMP_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		var gIndex = vec2i(i32(GlobalInvocationID.x), i32(GlobalInvocationID.y));	//x is by num stages, y is by full resolution
		var k = (f32(gIndex.y) * (WU.resolution / pow(2.0, f32(gIndex.x) + 1.0))) % WU.resolution;
		var twiddle = vec2f(cos((2.0 * 3.14159 * k) / WU.resolution), 
							-sin((2.0 * 3.14159 * k) / WU.resolution));	//maybe this isnt negative
		var butterflySpan = pow(2.0, f32(gIndex.x));
		var butterflyWing = 0u;
		
		let stageSize = 1u << u32(gIndex.x);        // 2^stage
		let stageSize2 = stageSize << 1u;      // 2^(stage + 1)
		
		if ((u32(gIndex.y) % stageSize2) < stageSize) {
			butterflyWing = 1u;
		}
		
		if(gIndex.x == 0) {
			if(butterflyWing == 1u) {
				textureStore(preCompTexture, vec2i(gIndex.x, gIndex.y), vec4f(twiddle.x, twiddle.y, bitReversedIndices[gIndex.y], bitReversedIndices[gIndex.y + 1]));
			} else {
				textureStore(preCompTexture, vec2i(gIndex.x, gIndex.y), vec4f(twiddle.x, twiddle.y, bitReversedIndices[gIndex.y - 1], bitReversedIndices[gIndex.y]));
			}
			
		} else {
			if(butterflyWing == 1u) {
				textureStore(preCompTexture, vec2i(gIndex.x, gIndex.y), vec4f(twiddle.x, twiddle.y, f32(gIndex.y), f32(gIndex.y) + butterflySpan));
			} else {
				textureStore(preCompTexture, vec2i(gIndex.x, gIndex.y), vec4f(twiddle.x, twiddle.y, f32(gIndex.y) - butterflySpan, f32(gIndex.y)));
			}
		}
		
		
		//var gIndex = GlobalInvocationID;	//x is by num stages, y is by full resolution
		//var yIndex = 0u;
		//let res = u32(WU.resolution);
		//let shiftedIndex = uncenterIndex(gIndex.y, res);
		//if(gIndex.x == 0) {
		//	yIndex = bitReverse(shiftedIndex, u32(log2(f32(res))));
		//} else {
		//	yIndex = shiftedIndex;
		//}
		//		
		////based on "Realtime GPGPU FFT  Ocean Water Simulation" by Fynn-Jorin Flügge
		//let span = 1u << gIndex.x;
		//let twiddleK = (yIndex % span);
		//let theta = 2.0 * 3.14159 * f32(twiddleK) / f32(span * 2u);
		//let twiddle = vec2f(cos(theta), -sin(theta));		//positive sin for fft, neg for ifft
		//
		//let stageSize = span * 2u;
		//let group = yIndex / stageSize;
		//let offset = yIndex % span;
		//
		//let a = group * stageSize + offset;
		//let b = a + span;
		//
		//textureStore(preCompTexture, vec2u(gIndex.x, a), vec4f(twiddle.x, twiddle.y, f32(a), f32(b)));
		//textureStore(preCompTexture, vec2u(gIndex.x, b), vec4f(-twiddle.x, -twiddle.y, f32(a), f32(b)));
	}
`;

/*
	runs every frame, once for each cascade.
	It takes h0(k) and animates it forward in time: each wave turns by e^(iwt), w from the dispersion relation w^2 = g k tanh(k depth),
	so the longer the wave the faster it runs. Out of that come the two fields the butterfly passes turn into the sea: the height h(k,t),
	and the horizontal displacement that sharpens the crests (choppy waves), Dx + i Dz. Both go straight into the butterfly passes' first buffer
*/

export const c_hkt =
`
	${CASCADE_UNIFORMS}
	@group(0) @binding(1) var initialSpectrum : texture_storage_2d<rgba32float, read>;	// h0(k) and conj(h0(-k)), the cascades one above the other (c_spectrum)
	@group(0) @binding(2) var<storage, read_write> fftInput: array<vec2f>;				// 2 layers a cascade: the height, then the displacement

	fn complexMul(a: vec2f, b: vec2f) -> vec2f {
		return vec2f(
			a.x * b.x - a.y * b.y,
			a.x * b.y + a.y * b.x
		);
	}

@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		let res = u32(CU.resolution);
		let texel = GlobalInvocationID.xy;
		if (texel.x >= res || texel.y >= res) {
			return;
		}
		let cascade = u32(CU.cascade);
		let h0 = textureLoad(initialSpectrum, texel + vec2u(0u, cascade * res));

		// the wave's speed is rounded down to a whole number of turns in repeatTime, so the sea repeats exactly after it
		//		and the time can be kept small (after an hour, the phase of a short wave would have lost its precision in a float)
		let k = waveVector(texel);
		let kLength = length(k);
		let slowestTurn = 2.0 * PI / CU.repeatTime;
		let omega = floor(angularFrequency(kLength * CU.unitsPerMetre) / slowestTurn) * slowestTurn;
		let turn = vec2f(cos(omega * CU.time), sin(omega * CU.time));

		// h(k,t) = h0(k) e^(-iwt) + conj(h0(-k)) e^(iwt): the first runs along k, the second the opposite way
		//		h0(-k) is the same draw as the texel holding -k makes (see c_spectrum), so h(-k,t) = conj(h(k,t)) and the sea comes out real
		let h = complexMul(h0.xy, vec2f(turn.x, -turn.y)) + complexMul(h0.zw, turn);

		// horizontal displacement, D(k,t) = i (k / |k|) h(k,t): every point pulled towards the nearest crest, which pinches the crests
		//		into peaks and flattens the troughs. Dx and Dz both come out real, so they go through one transform together as Dx + i Dz
		var displacement = vec2f(0.0, 0.0);
		if (kLength > 0.0) {
			let ih = vec2f(-h.y, h.x);
			let dx = ih * (k.x / kLength);
			let dz = ih * (k.y / kLength);
			displacement = dx + vec2f(-dz.y, dz.x);
		}

		let layerSize = res * res;
		let index = cascade * 2u * layerSize + texel.y * res + texel.x;
		fftInput[index] = h;
		fftInput[index + layerSize] = displacement;
	}
`;

/*
	The sea's spectrum: for every wave vector k on a cascade's grid, how much energy the waves running that way at that length have,
	from two sources added together:
		the wind sea	JONSWAP (Hasselmann et al. 1973): the waves the wind raises over the fetch, spread round the wind
						direction with Mitsuyasu's spreading (narrowest at the peak)
		the swell		JONSWAP again, narrower, come from storms far away: its own height, length and heading, and long crested
						(Horvath 2015, "Empirical directional wave spectra for computer graphics")
	both made smaller where the waves are long enough to feel the bottom (TMA, Bouws et al. 1985).
	Each texel's energy is turned into an amplitude and multiplied by a complex gaussian random number, which gives a statistically
	realistic but unique sea each time. Only made again when the settings change.
	Each cascade only keeps the waves in its own band (kLow to kHigh), so nothing is counted twice when the cascades are added up.
	The output is h0(k) and conj(h0(-k)) together, which is all c_hkt needs to animate it.
*/

export const c_spectrum =
`
	${CASCADE_UNIFORMS}
	@group(0) @binding(1) var<storage, read> gaussNoise: array<vec2f>;						// a complex gaussian random number for each texel of each cascade
	@group(0) @binding(2) var initialSpectrum : texture_storage_2d<rgba32float, write>;	// xy: h0(k), zw: conj(h0(-k)). The cascades one above the other
	@group(0) @binding(3) var spectrumView : texture_storage_2d<rgba32float, write>;		// the amplitudes as a picture, for the debug view

	// JONSWAP: the energy at each frequency, per radian per second. alpha and the peak come from the wind and the fetch, or from the swell's settings (water.js)
	fn jonswap(omega: f32, alpha: f32, peak: f32, gamma: f32) -> f32 {
		let sigma = select(0.09, 0.07, omega <= peak);
		let peakSharpening = exp(-(omega - peak) * (omega - peak) / (2.0 * sigma * sigma * peak * peak));
		let ratio = peak / omega;
		return alpha * G * G / pow(omega, 5.0) * exp(-1.25 * ratio * ratio * ratio * ratio) * pow(gamma, peakSharpening);
	}

	// TMA: how much of its deep water energy a wave keeps in water CU.depth deep (Kitaigorodskii's approximation)
	fn depthAttenuation(omega: f32) -> f32 {
		let omegaH = omega * sqrt(CU.depth / G);
		if (omegaH <= 1.0) {
			return 0.5 * omegaH * omegaH;
		}
		if (omegaH < 2.0) {
			return 1.0 - 0.5 * (2.0 - omegaH) * (2.0 - omegaH);
		}
		return 1.0;
	}

	// ln of the gamma function (Stirling's series, plenty for z of 1 and over)
	fn lnGamma(z: f32) -> f32 {
		return (z - 0.5) * log(z) - z + 0.9189385 + 1.0 / (12.0 * z) - 1.0 / (360.0 * z * z * z);
	}

	// how the energy at one frequency is shared out over the directions: cos(theta / 2)^2s round the way the sea runs, the higher s
	//		the narrower. Scaled so it adds up to 1 over all directions. cosTheta: between the wave's heading and the sea's
	fn spreading(cosTheta: f32, s: f32) -> f32 {
		let normalise = (2.0 * s - 1.0) * log(2.0) - log(PI) + 2.0 * lnGamma(s + 1.0) - lnGamma(2.0 * s + 1.0);
		return exp(normalise + s * log(max(0.5 + 0.5 * cosTheta, 1e-20)));
	}

	// the energy per (radian per metre)^2 of the waves with wave vector k (radians per world unit)
	fn spectrum(k: vec2f) -> f32 {
		let kLength = length(k);
		if (kLength < CU.kLow || kLength >= CU.kHigh) {
			return 0.0;
		}
		let kMetres = kLength * CU.unitsPerMetre;
		let omega = angularFrequency(kMetres);
		let heading = k / kLength;

		var energy = 0.0;	// per radian per second of frequency, per radian of direction
		if (CU.windAlpha > 0.0) {
			// Mitsuyasu et al. 1975: narrowest at the peak, wider for the waves longer and shorter than it
			let peakSpread = 11.5 * pow(G / (CU.windPeak * CU.windSpeed), 2.5);
			let ratio = omega / CU.windPeak;
			let s = min(select(peakSpread * pow(ratio, -2.5), peakSpread * pow(ratio, 5.0), omega <= CU.windPeak), 60.0);
			energy += jonswap(omega, CU.windAlpha, CU.windPeak, 3.3) * spreading(dot(heading, CU.windDirection), s);
		}
		// the swell only in cascade 0, which the mesh pass keeps to the deep sea (no swell on a lake, or in the shallows). Its short
		//		tail is left to the wind sea
		if (CU.swellAlpha > 0.0 && CU.cascade == 0.0) {
			// Horvath's swell: the crests made longer the nearer the wave is to the swell's peak
			let s = 1.0 + 40.0 * CU.swellSpread * CU.swellSpread * tanh(CU.swellPeak / omega);
			energy += jonswap(omega, CU.swellAlpha, CU.swellPeak, 5.0) * spreading(dot(heading, CU.swellDirection), s);
		}

		// from frequency and direction to the two components of k: E(k) = E(w, theta) (dw/dk) / k
		let kDepth = min(kMetres * CU.depth, 20.0);
		let sech = 1.0 / cosh(kDepth);
		let dOmegadK = G * (tanh(kDepth) + kDepth * sech * sech) / (2.0 * omega);
		return energy * depthAttenuation(omega) * dOmegadK / kMetres;
	}

@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		let res = u32(CU.resolution);
		let texel = GlobalInvocationID.xy;
		if (texel.x >= res || texel.y >= res) {
			return;
		}
		let cascade = u32(CU.cascade);
		let k = waveVector(texel);

		// the first row and column are the nyquist frequency, which has no -k partner on the grid. They are left empty
		var energy = spectrum(k);
		var energyOpposite = spectrum(-k);
		if (texel.x == 0u || texel.y == 0u) {
			energy = 0.0;
			energyOpposite = 0.0;
		}

		// amplitude: |h0(k)|^2 has to average E(k) dk^2 / 2 (the other half arrives as h0(-k), see c_hkt),
		//		and the gaussian's square averages 2. Then metres to world units
		let dk = 2.0 * PI / CU.size * CU.unitsPerMetre;
		let scale = 0.5 * dk * CU.unitsPerMetre;
		// h0(-k) is the same random draw that the texel holding -k makes for its own h0, so the sea comes out real (see c_hkt)
		let mirror = vec2u((res - texel.x) % res, (res - texel.y) % res);
		let layer = cascade * res * res;
		let h0k = gaussNoise[layer + texel.y * res + texel.x] * (sqrt(energy) * scale);
		let h0MinusK = gaussNoise[layer + mirror.y * res + mirror.x] * (sqrt(energyOpposite) * scale);

		let stacked = texel + vec2u(0u, cascade * res);
		textureStore(initialSpectrum, stacked, vec4f(h0k.x, h0k.y, h0MinusK.x, -h0MinusK.y));

		// (the amplitude on a log scale: 1 for a world unit, 0 for a ten thousandth of one)
		let shown = saturate(log(sqrt(energy) * scale + 1e-6) / log(10.0) * 0.25 + 1.0);
		textureStore(spectrumView, stacked, vec4f(shown, shown, shown, 1.0));
	}
`;

/*
	runs every frame after the butterfly passes, once for each cascade.
	Takes the sea out of the butterfly passes' buffer into two small textures the mesh pass reads with filtering, at any world position:
	the displacement of the surface (Dx, height, Dz), and how it changes across the surface (its slopes, and how much the
	displacement squeezes or stretches it). Worked out once here for each texel, so the mesh pass doesnt have to look at any neighbours
*/

export const c_waveMaps =
`
	${CASCADE_UNIFORMS}
	@group(0) @binding(1) var<storage, read> fftOutput: array<vec2f>;						// the butterfly passes' result, 2 layers a cascade
	@group(0) @binding(2) var waveTexture : texture_storage_2d<rgba16float, write>;		// x: Dx, y: height, z: Dz, w: dDx/dz (= dDz/dx)
	@group(0) @binding(3) var slopeTexture : texture_storage_2d<rgba16float, write>;		// x: dh/dx, y: dh/dz, z: dDx/dx, w: dDz/dz
	@group(0) @binding(4) var foamTexture : texture_storage_2d<r32float, read_write>;		// x: the foam this cascade has made, kept from frame to frame

	// a field at a texel, wrapped round (the tile repeats). The spectrum has k = 0 in its middle, not its corner,
	//		which multiplies the transform by -1 on every other texel: that is put right here
	fn fieldAt(texel: vec2i, field: u32) -> vec2f {
		let res = i32(CU.resolution);
		let wrapped = (texel % res + res) % res;
		let flip = 1.0 - 2.0 * f32((wrapped.x + wrapped.y) & 1);
		let layerStart = (u32(CU.cascade) * 2u + field) * u32(res * res);
		return fftOutput[layerStart + u32(wrapped.y * res + wrapped.x)] * flip;
	}

@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		let res = i32(CU.resolution);
		let texel = vec2i(GlobalInvocationID.xy);
		if (texel.x >= res || texel.y >= res) {
			return;
		}
		let height = fieldAt(texel, 0u).x;
		let displacement = fieldAt(texel, 1u);	// x: Dx, y: Dz

		// central differences, one texel either side
		let toX = vec2i(1, 0);
		let toZ = vec2i(0, 1);
		let perUnit = CU.resolution / (2.0 * CU.size);
		let dHdx = (fieldAt(texel + toX, 0u).x - fieldAt(texel - toX, 0u).x) * perUnit;
		let dHdz = (fieldAt(texel + toZ, 0u).x - fieldAt(texel - toZ, 0u).x) * perUnit;
		let dDdx = (fieldAt(texel + toX, 1u) - fieldAt(texel - toX, 1u)) * perUnit;
		let dDdz = (fieldAt(texel + toZ, 1u) - fieldAt(texel - toZ, 1u)) * perUnit;

		textureStore(waveTexture, texel, vec4f(displacement.x, height, displacement.y, 0.5 * (dDdz.x + dDdx.y)));
		textureStore(slopeTexture, texel, vec4f(dHdx, dHdz, dDdx.x, dDdz.y));

		// Foam: where this cascade squeezes the surface together (its jacobian, as the mesh pass works it out for all of them) whitecaps
		//		break. What was made before is kept and fades a little each frame: the map is fixed in the world and the crests run on
		//		through it, so the foam stays where it broke and trails off behind them
		let squeezeX = 1.0 + CU.choppiness * dDdx.x;
		let squeezeZ = 1.0 + CU.choppiness * dDdz.y;
		let shear = CU.choppiness * 0.5 * (dDdz.x + dDdx.y);
		let jacobian = squeezeX * squeezeZ - shear * shear;
		let breaking = saturate((CU.foamThreshold - jacobian) / max(CU.foamFade, 0.001));
		let kept = textureLoad(foamTexture, texel).x * CU.foamKeep;
		textureStore(foamTexture, texel, vec4f(max(breaking, kept), 0.0, 0.0, 0.0));
	}
`;

export const v_water =
`
	//TODO: remove this after the input from compute shader comes in!!!!!!!!!!!!!
	//			at that point, we wont have to do modelViewProjections at all, its just read already adjusted vertex data and output
	struct WaterUniforms 
	{
		modelViewProjectionMatrix : mat4x4f,
		topDownViewProj : mat4x4f,
		topDownInvViewProj : mat4x4f,
		topDownTextureSize : vec2f,
		_padding0 : vec2f,
	}
	@group(0) @binding(0) var<uniform> UBO: WaterUniforms;
	
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
	}
	@group(0) @binding(1) var<uniform> Lights: LightsUniforms;
	
	
	//so this is pushed in from the water compute shader
	struct VertexInput {
		@builtin(instance_index) instanceIdx : u32,
		@location(0) pos: vec3f,
		@location(1) uv: vec2f,
		@location(2) norm: vec3f,
		@location(3) crest: f32,			// how peaked the water is (see c_water)
	};
	
	struct VertexOutput {				//into frag
		@builtin(position) pos: vec4f,
		@location(0) fragUV: vec2f,
		@location(1) fragNormal: vec3f,
		@location(2) worldPos: vec3f,
		@location(3) crest: f32,
	};
	
	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {	
	
	var output: VertexOutput;
	
    output.pos = UBO.modelViewProjectionMatrix * vec4f(input.pos.x, input.pos.y, input.pos.z, 1.0);

	// anything past the camera's far plane normally gets clipped away. Holding the depth just inside it instead
	//		is what lets the horizon plane run on to the horizon, whatever the far plane is set to
	output.pos.z = min(output.pos.z, output.pos.w * 0.999999);
    output.worldPos = input.pos;
	output.fragNormal = input.norm;
    output.fragUV = input.uv;
    output.crest = input.crest;
    
    return output;
	}
`;

import { moonShapes } from './f_moon.js';
import { cloudShadeShapes } from './vfc_clouds.js';

const SSR_STEPS = 24;	// the most steps a reflection takes along its ray looking for something to show

export const f_water =
`
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

	${moonShapes}

	struct WaterUniforms
	{
		modelViewProjectionMatrix : mat4x4f,
		topDownViewProj : mat4x4f,
		topDownInvViewProj : mat4x4f,
		topDownTextureSize : vec2f,
		atmosphereEnabled : f32,	// 1.0 while the atmosphere pass is running and keeping the sky LUT up to date
		horizonFogDistance : f32,	// distance from the camera where the water is about two thirds faded into the horizon
		clarityDepth : f32,			// depth of water where the sea bed has faded to about a third. 0 turns the see-through off
		seaLevel : f32,				// the height of the still sea
		crestHeight : f32,			// how high over it a crest stands where the sun shines through it at its brightest
		_padding1 : f32,
		screen : vec4f,				// for the reflections found on the screen. xy: the two numbers that turn a depth into a distance, z: how strongly they show, w: how far out they are looked for
		cloudMap : vec4f,			// where the cloud coverage map is: what cloudShadeAt takes (vfc_clouds.js)
	}
	@group(0) @binding(0) var<uniform> UBO: WaterUniforms;

	@group(0) @binding(2) var skyLUT: texture_2d<f32>;
	@group(0) @binding(3) var skySampler: sampler;
	@group(0) @binding(6) var sceneColor: texture_2d<f32>;		// the frame as it stood before the water was drawn, see screenEffects.js
	@group(0) @binding(7) var sceneDepth: texture_depth_2d;
	@group(0) @binding(8) var cloudMap: texture_2d<f32>;		// the clouds from above, see clouds.js
	@group(0) @binding(9) var cloudMapSampler: sampler;

	${cloudShadeShapes}

	const PI: f32 = 3.14159265;

	// the sky LUT has one row of texels just above the horizon and one just below it (the ground side, which is darker).
	//		reading dead on the horizon blends the two, so "the horizon" is read about a degree up, in the middle of the first row of real sky
	const HORIZON_LIFT: f32 = 0.016;

	// The colour the sky pass puts on screen for a world direction.
	//		same LUT lookup, exposure and gamma as f_sky in the atmosphere shaders, so the water can match the sky behind it exactly
	${skyLookupShapes}

	//same as vertexoutput without builtin bits
	struct FragInput {
		@builtin(position) fragCoord: vec4f,
		@location(0) fragUV: vec2f,
		@location(1) fragNormal: vec3f,
		@location(2) worldPos: vec3f,
		@location(3) crest: f32,
	};

	fn lerp(a: vec4<f32>, b: vec4<f32>, t: f32) -> vec4<f32> {
		return a + t * (b - a);
	}	

	// A number from 0 to 1 for a whole-numbered place, the same every time (an integer hash: a sine of a big number
	//		loses its precision kilometres out)
	fn foamHash(cell: vec2f) -> f32 {
		let c = vec2i(cell);
		var h = (bitcast<u32>(c.x) * 1597334673u) ^ (bitcast<u32>(c.y) * 3812015801u);
		h = (h ^ (h >> 16u)) * 2246822519u;
		h = h ^ (h >> 13u);
		return f32(h & 0xffffu) / 65535.0;
	}

	// smooth noise from those, 0 to 1
	fn foamNoise(p: vec2f) -> f32 {
		let cell = floor(p);
		let f = p - cell;
		let u = f * f * (3.0 - 2.0 * f);
		let a = foamHash(cell);
		let b = foamHash(cell + vec2f(1.0, 0.0));
		let c = foamHash(cell + vec2f(0.0, 1.0));
		let d = foamHash(cell + vec2f(1.0, 1.0));
		return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
	}

	// The look of foam, fixed in the world: patches, streaks and bubbles at three sizes. Thin foam only shows where this is low
	//		(a lace with the water showing through), thick foam everywhere
	fn foamLace(xz: vec2f) -> f32 {
		let p = xz * 0.3;
		return 0.5 * foamNoise(p) + 0.3 * foamNoise(p * 2.9 + vec2f(13.1, 7.7)) + 0.2 * foamNoise(p * 8.3 + vec2f(5.3, 21.9));
	}

	// interleaved gradient noise (Jimenez): a different number for every pixel, spread evenly
	fn pixelNoise(pixel: vec2f) -> f32 {
		return fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
	}

	// A place in the world, looked up on the screen. x: how far in front of the camera whatever was drawn there is (the far plane
	//		where nothing was), y: how far in front of the camera the place itself is, z: 1.0, or 0.0 if the place is not on the screen
	fn reflectionProbe(place: vec3f) -> vec3f {
		let clip = UBO.modelViewProjectionMatrix * vec4f(place, 1.0);
		if (clip.w <= 0.0) {
			return vec3f(0.0, 0.0, 0.0);
		}
		let uv = clip.xy / clip.w * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
		if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
			return vec3f(0.0, 0.0, 0.0);
		}
		let size = vec2f(textureDimensions(sceneDepth));
		let depth = textureLoad(sceneDepth, vec2i(min(uv * size, size - vec2f(1.0, 1.0))), 0);
		return vec3f(UBO.screen.y / (depth + UBO.screen.x), clip.w, 1.0);
	}

	/*
		Screen space reflection: what stands over the water in the mirrored direction, found in the frame itself.

		The frame as it stood before the water was drawn is kept, picture and depth (screenEffects.js). From the water, a ray is
		walked out in the mirrored direction, and at every step the place it has reached is looked up on the screen: if the
		ray is now behind whatever was drawn there, it went in to it somewhere since the last step. A few halvings find where,
		and the color of the picture at that spot is the reflection.

		The steps grow as they go (each 1.4 times the last), so 24 of them reach from a reed at the water's edge to a mountain
		a mile off. Only what is on the screen can be found: a reflection of something out of view falls back to the sky.
			rgb: the color found, a: how much to trust it (0.0 if nothing was found, fading out near the edges of the screen)
	*/
	fn screenReflection(start: vec3f, direction: vec3f, jitter: f32) -> vec4f {
		var travelled = 1.5 + jitter;	// every pixel starts a little differently, which turns the steps into grain instead of bands
		var before = 0.0;
		for (var i = 0; i < ${SSR_STEPS}; i++) {
			let probe = reflectionProbe(start + direction * travelled);
			if (probe.z < 0.5) {
				break;	// off the screen
			}
			// gone in behind something, and by no more than it could have since the last step (further behind than that, and it
			//		is passing behind something that stands in front, a tree trunk say, not hitting it)
			let behind = probe.y - probe.x;
			if (behind > 0.0 && behind < 1.5 * (travelled - before) + 2.0) {
				var nearer = before;
				var further = travelled;
				for (var j = 0; j < 5; j++) {
					let middle = 0.5 * (nearer + further);
					let halfway = reflectionProbe(start + direction * middle);
					if (halfway.y > halfway.x) {
						further = middle;
					} else {
						nearer = middle;
					}
				}
				let clip = UBO.modelViewProjectionMatrix * vec4f(start + direction * further, 1.0);
				let uv = clip.xy / clip.w * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
				let inFromEdge = smoothstep(0.0, 0.06, uv.x) * (1.0 - smoothstep(0.94, 1.0, uv.x)) * smoothstep(0.0, 0.06, uv.y) * (1.0 - smoothstep(0.94, 1.0, uv.y));
				return vec4f(textureSampleLevel(sceneColor, skySampler, uv, 0.0).rgb, inFromEdge);
			}
			before = travelled;
			travelled *= 1.4;
		}
		return vec4f(0.0, 0.0, 0.0, 0.0);
	}

	@fragment
	fn fragmentMain(input: FragInput) -> //could also use input: VertexOutput instead because its contained within the same file here
		@location(0) vec4f {
		
		// a lake comes in as a foam factor below 0 (see the end of waterVertex in c_water): it has a color of its own, and no foam
		let lake = saturate(-input.fragUV.x);
		let N = normalize(input.fragNormal);							// renormalize: interpolation shortens it
		let V = normalize(Lights.camPos.xyz - input.worldPos); 		// surface to eye
		let L = normalize(Lights.sunPos.xyz);                       // directional sun
		let H = normalize(L + V);                                   // Blinn-Phong halfway vector
	
		//Fresnel (Schlick). Water's F0 is ~0.02: nearly transparent head-on,
		//     mirror-like at grazing angles. This is what sells water more than anything else.
		let F = 0.02 + 0.98 * pow(1.0 - saturate(dot(N, V)), 5.0);
		
		let NdotL = dot(N, L);
		// the water's own color: a deep green blue, lighter and greener where the sun is on it (the Sea of Thieves sea rather than navy)
		//		(the planet seen from high up, in the sky view LUT, is given the same: GROUND_ALBEDO in vfc_atmosphere.js)
		let deepColor = vec3f(0.02, 0.16, 0.21);
		let litColor  = vec3f(0.05, 0.38, 0.42);
		let body      = mix(deepColor, litColor, saturate(NdotL));
		
		// Reflection: whatever the sky pass draws in the mirrored direction. With the atmosphere off there is no sky to read, so a flat stand-in
		var skyColor = vec3f(0.45, 0.62, 0.85);
		if (UBO.atmosphereEnabled > 0.5) {
			let R = reflect(-V, N);
			skyColor = skyColorAt(vec3f(R.x, max(R.y, HORIZON_LIFT), R.z));	// the sea mirrors the sky, never what is under the horizon
		}
		// and over the sky, whatever stands above the water in that direction: the land, the trees (see screenReflection).
		//		Not looked for where it would not show: far off, or where the water is looked straight down into
		let toSurface = distance(Lights.camPos.xyz, input.worldPos);
		if (UBO.screen.z > 0.0 && toSurface < UBO.screen.w && F > 0.03) {
			let mirrored = reflect(-V, N);
			let found = screenReflection(input.worldPos, normalize(vec3f(mirrored.x, max(mirrored.y, 0.03), mirrored.z)), pixelNoise(input.fragCoord.xy));
			// (a lake is sheltered enough to hold a picture. The sea is rough, and shows less of one)
			skyColor = mix(skyColor, found.rgb, found.a * UBO.screen.z * mix(0.65, 1.0, lake) * (1.0 - smoothstep(0.7 * UBO.screen.w, UBO.screen.w, toSurface)));
		}
		// lake water is darker and greener than the sea: it is shallow, over mud, and full of what grows in it
		let lakeBody = vec3f(0.07, 0.15, 0.17) * (0.55 + 0.45 * saturate(NdotL));
		// The clouds over this stretch of water, from the picture of them taken from above. Under cloud the sea is not
		//		mirroring blue sky any more but the grey underside of the cloud, and the sun is off it
		let clouded = cloudShadeAt(input.worldPos, L, UBO.cloudMap);
		let greySky = vec3f(1.0, 1.0, 1.0) * (0.08 + 0.8 * dot(skyColor, vec3f(0.3, 0.4, 0.3)));
		skyColor = mix(skyColor, greySky, 0.85 * clouded.g);

		// the water's own color is lit like anything else: it goes dark with the day, bar what the moon gives it
		//		(what it mirrors needs no such thing, the sky it mirrors has gone dark by itself)
		let waterLight = (vec3f(1.0, 1.0, 1.0) * (0.14 + 0.86 * smoothstep(-0.08, 0.25, L.y)) + 0.5 * moonGlow()) * (0.5 + 0.5 * clouded.r);
		var color    = mix(mix(body, lakeBody, 0.6 * lake) * waterLight, skyColor, F);

		// Crest foam (whitecaps): jacobian based factor from the water compute pass, riding in uv.x
		//     foam is rough so it gets plain diffuse light instead of the fresnel/reflection look
		//     broken up by a pattern fixed in the world (foamLace): thin foam is a lace of streaks and bubbles, thick foam is solid
		let foamAmount = max(saturate(input.fragUV.x), saturate(length(input.fragNormal) - 1.0));	// breaking now, or left lying (in the length of the normal, see c_water)
		let lace = foamLace(input.worldPos.xz);
		let foam = smoothstep(lace * 0.75, lace * 0.75 + 0.25, foamAmount);
		let foamColor = vec3f(0.80, 0.94, 0.88) * (0.55 + 0.45 * saturate(NdotL)) * waterLight;	// a seafoam white, a little green
		color = mix(color, foamColor, 0.82 * foam);	// and never quite opaque: the water shows through it

		// Light through the crests: where a wave stands up thin enough the sun shines through it, and it glows a bright green blue.
		//		Most looking towards the sun, through the back of the wave, some from any side. Not on a lake: there is no swell to stand up
		//		Where the water is peaked (the crests, from the mesh pass), not just where it stands high. And most of all where the
		//		sun is behind the face of the wave: looking towards it through a surface leaning away from the eye
		let crest = saturate(input.crest);
		let throughFace = pow(saturate(dot(-V, normalize(L + 0.6 * N))), 3.0);
		let towardsSun = pow(saturate(dot(-V, L)), 3.0);
		let shineThrough = crest * sqrt(crest) * (0.25 + 0.45 * towardsSun + 0.6 * throughFace) * smoothstep(-0.05, 0.2, L.y) * (0.4 + 0.6 * clouded.r);
		color += vec3f(0.08, 0.72, 0.58) * shineThrough * (1.0 - foam) * (1.0 - lake) * (1.0 - F);

		// Specular sun glint, hidden under the foam
		let shininess = 300.0;
		let spec = pow(saturate(dot(N, H)), shininess) * step(0.0, NdotL) * (1.0 - foam);
		color += Lights.sunCol.rgb * spec * F * 3.0 * clouded.r;
		// and the moon's: wider and softer, the long broken path of light across the water towards it
		let toMoon = normalize(Lights.moonPos.xyz);
		let moonSpec = pow(saturate(dot(N, normalize(toMoon + V))), 120.0) * step(0.0, dot(N, toMoon)) * (1.0 - foam);
		color += moonGlow() * moonSpec * F * 3.0 * clouded.r;
		//color += Lights.sunCol.rgb * Lights.sunIntensity * spec * F * 4.0;

		// Horizon fog: far water fades into the colour of the sky sitting right on the horizon behind it,
		//     so the sea has no far edge to see and the horizon line dissolves into the sky instead of cutting across it
		var fog = 0.0;
		if (UBO.atmosphereEnabled > 0.5) {
			let toWater = input.worldPos - Lights.camPos.xyz;
			let horizonColor = fogColorAt(toWater);
			fog = 1.0 - exp(-pow(length(toWater) / UBO.horizonFogDistance, 2.0));
			color = mix(color, horizonColor, fog);
		}
	
		// See-through shallows: where the sea bed is close under the surface the water lets it show, tinted more the deeper it is.
		//     the depth is the one from the top down height map (riding in uv.y), so this only ever happens over real terrain near the camera.
		//     the open sea and everything in the distance has no bed to show and stays fully opaque, so nothing behind it (the sky, a set sun) can show through
		var seeThrough = 0.0;
		if (UBO.clarityDepth > 0.0) {
			let depth = max(input.fragUV.y, 0.0);
			// fades with depth, and is cut off completely by 2x the clarity depth so the edge of a sea bed mesh never shows as a line
			seeThrough = exp(-depth / UBO.clarityDepth) * (1.0 - smoothstep(UBO.clarityDepth, 2.0 * UBO.clarityDepth, depth));
			// the surface is a mirror at grazing angles, and foam and haze hide the bed as well
			seeThrough *= (1.0 - F) * (1.0 - foam) * (1.0 - fog);
		}

		// Seen from underneath (the camera is under the sea) it is none of the above: no mirror of the sky, no foam. What shows
		//		through the surface is the sky over it, bent on its way in to the water so that all of it fits in a circle
		//		overhead (Snell's window, its edge wobbling with the waves). Outside that circle no light from above can
		//		reach the eye at all, and the surface is a mirror of the dark water under it.
		//		(the water between the eye and the surface is put in afterwards: vf_lightShafts.js)
		if (dot(N, V) < 0.0 && Lights.camPos.y < input.worldPos.y) {
			let leaving = refract(-V, -N, 1.33);		// the way the line of sight carries on once it is out in the air. Nothing if it cannot get out
			var underside = vec3f(0.02, 0.1, 0.14) * (0.15 + 0.85 * smoothstep(-0.08, 0.25, L.y));
			if (dot(leaving, leaving) > 0.5 && UBO.atmosphereEnabled > 0.5) {
				underside = mix(underside, skyColorAt(vec3f(leaving.x, max(leaving.y, HORIZON_LIFT), leaving.z)) * (0.6 + 0.4 * clouded.r), smoothstep(0.0, 0.3, leaving.y));
			}
			return vec4f(underside, 1.0);
		}

		return vec4f(color, 1.0 - seeThrough);
	}
`;
