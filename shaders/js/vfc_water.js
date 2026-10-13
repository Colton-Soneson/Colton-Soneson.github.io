import { settings } from '../../code/settings.js';

export const WATER_WORKGROUP_SIZE = [32, 1, 1];
export const FFT_WORKGROUP_SIZE = [8, 8, 1];
export const PRECOMP_WORKGROUP_SIZE = [1, 8, 1];
export const SHORE_FIELD_DOWNSCALE = 8;		// one shore distance field texel covers this many top down height map texels (per axis)
export const SHORE_SEARCH_RADIUS = 64;		// in shore field texels. The furthest distance from land the field can hold, further than this is open ocean


/*
	This pass builds the actual geometry
	Each thread handles one vertex of the ocean grid: it reads wave height from the FFT output texture, projects the vertex's world position 
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
		@location(18) shoreZone: f32,			//world distance from land where the ocean waves hand over to the shore waves
		@location(19) shoreWaveHeight: f32,		//crest height at the break line, world units
		@location(20) shoreBreakDistance: f32,	//distance from land where the shore waves are tallest, they die off from there in to the land
		@location(21) shoreSteepness: f32,		//how far the crests lean and sharpen as they come in. Too high folds the mesh
		@location(22) shoreWaveLength1: f32,	//wavelengths of the two shore wave trains, world units. Keep them several mesh cells long
		@location(23) shoreWaveLength2: f32,
		@location(24) shoreWaveSpeed: f32,		//1.0 keeps pace with the dominant open ocean waves
		@location(25) fullDepth: f32,			//water deeper than this gets the full open ocean waves
		@location(26) shallowRippleScale: f32,	//height of the spikey ripples that replace the waves in shallow water
		@location(27) deepSeaDepth: f32,		//water at least this deep is deep sea and gets the full swell
		@location(28) swellHeight: f32,			//height of the biggest swell crests, world units. 0 turns the swell off
		@location(29) swellLength: f32,			//wavelength of the main swell, world units
		@location(30) swellSteepness: f32,		//0 = smooth sine rollers, 1 = full trochoid with peaked crests and flat troughs
		@location(31) swellSpeed: f32,			//1.0 is the natural speed for the wavelength
		@location(32) swellShoreDistance: f32,	//distance from land where the swell is back to full size
		@location(33) terrainHalfSize: f32,		//half the width of the terrain, 0 when there is no terrain
		@location(34) terrainCellSize: f32,		//size of one terrain grid cell
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
	
	@group(0) @binding(4) var finalWaveHeightTexture : texture_storage_2d<rgba32float, read>;
	@group(0) @binding(5) var topDownHeightmapTexture : texture_depth_2d;
	
	@group(0) @binding(6) var finalDisplacementTexture : texture_storage_2d<rgba32float, read>;	//x: Dx, y: Dz
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
	foam: f32,
	depth: f32,
};

// Everything about one vertex of this tile's mesh, at grid index (ix, iz) of the tile
fn waterVertex(ix: u32, iz: u32) -> WaterVertex {

		//------------------------------FORM GRID-------------------------------

		// the wave textures tile exactly once across a tile, whatever its level of detail.
		//		a tile's mesh has tileCells cells per side, so it reads every texelStride-th texel: 1 under the camera, 2 for the next ring out, 4, 8...
		let textureWidth = u32(WU.resolution);
		let tileCells = u32(WU.tileCells);
		let texelStride = textureWidth / tileCells;

		let gridIndexX = f32(ix);
		let gridIndexZ = f32(iz);

		// Scale grid indices to physical size					!!!ASSUMES GRID IS SQUARE
		let cellSize = WU.gridSize.x / f32(tileCells);
		let vertGridPosX = gridIndexX * cellSize;
		let vertGridPosZ = gridIndexZ * cellSize;

		//------------------[REALISTIC] FFT Oceanographic Waves-----------------

		//just for now, only x as height
		let texel = vec2u((ix * texelStride) % textureWidth, (iz * texelStride) % textureWidth);
		var waveHeight = textureLoad(finalWaveHeightTexture, texel).x;
		
		// World position of this water vertex	!!! CHECK IF TILE OFFSET IS DONE CORRECTLY
        let worldX = (vertGridPosX - WU.gridSize.x * 0.5) + WU.tileOffsetX; // + WU.cameraPosition.x; //!!!!Camera positions may need to be put in for MULTIPLE WATER TILES!!!!!!!!!!
		let worldZ = (vertGridPosZ - WU.gridSize.y * 0.5) + WU.tileOffsetZ; // + WU.cameraPosition.z;

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
		let worldTerrain = worldTerrainAt(vec2f(worldX, worldZ));
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

		let shoreZone = clamp(WU.shoreZone, 0.001, shoreFieldRange);	// world distance from land where the ocean waves hand over to the shore waves. The field cant see further than its range

		//Taking Depth into account
		//		the depth keeps the open ocean waves from digging into the sea bed, the shore distance fades them out as they come in to land
		let depthAttenuation = clamp(waterDepth / fullDepthThreshold, 0.0, 1.0); //0.0 to 1.0 from shallow to full depth
		let shoreAttenuation = pow(smoothstep(0.0, shoreZone, shoreDistance), 1.5);
		let attenuation = min(depthAttenuation, shoreAttenuation);
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
		let deepDisplacement = waveHeight * attenuation;
		
		// boost high freq detail by exaggerating deviation from local mean
		// squaring preserves sign and amplifies peaks/troughs
		let rippleDetail = sign(waveHeight) * (waveHeight * waveHeight) * shallowFactor * rippleScale;
		// the waves flatten out with distance from the camera, so the furthest tiles end dead flat and meet the horizon plane with no seam.
		//		out there a wave is far smaller than a pixel anyway, and a real horizon is a straight line
		let cameraDistance = length(vec2f(worldX, worldZ) - WU.cameraPosition.xz);
		let distanceFade = 1.0 - smoothstep(WU.waveFadeDistance * 0.45, WU.waveFadeDistance, cameraDistance);

		var waveHeightAdj = (deepDisplacement + rippleDetail) * distanceFade + WU.planeYPos;
				
		//------------------[REALISTIC] Choppy Displacement-----------------
		// the horizontal displacement D pulls each vertex towards the nearest crest, which pinches the crests into peaks and flattens the troughs
		//		fades out with depth the same way the height does
		let choppiness = WU.choppiness;	// lambda in the tessendorf paper. Around 1.0 is where crests start folding over themselves
		let chop = choppiness * attenuation * distanceFade;
		let displacement = textureLoad(finalDisplacementTexture, texel).xy * chop;

		//------------------Shore Waves-----------------
		// inside the shore zone the open ocean waves fade out and wave trains that run straight at the nearest land take over
		//		their phase is the distance to shore, so the crests follow the coastline and travel inwards as time goes on
		//		same trochoid (gerstner) shape as the choppy ocean waves: the surface gets pushed along the travel direction towards each crest
		var shoreHeight = 0.0;				// added to the height
		var shorePush = vec2f(0.0, 0.0);	// added to the horizontal position
		var shoreSlope = 0.0;				// d(shoreHeight) / d(shoreDistance)
		var shoreSqueeze = 0.0;				// how hard the push bunches the surface up along the travel direction, 1.0 would fold it
		var awayFromShore = vec2f(0.0, 0.0);
		let shoreGradLength = length(shoreGradWorld);

		if (shoreDistance < shoreZone && shoreGradLength > 0.0001) {
			awayFromShore = shoreGradWorld / shoreGradLength;
			let worldXZ = vec2f(worldX, worldZ);
			let time = WU.step;

			let shoreWaveHeight = WU.shoreWaveHeight;		// crest height at the break line, world units
			let shoreBreakDistance = min(WU.shoreBreakDistance, shoreZone * 0.9);	// distance from land where the shore waves are tallest, always inside the zone
			let shoreSteepness = WU.shoreSteepness;		// how far the crests lean and sharpen as they come in. Too high folds the mesh

			// two trains of slightly different wavelength drift in and out of step, so the waves arrive in sets instead of an even pulse
			let k1 = 6.2832 / max(WU.shoreWaveLength1, 1.0);	// wave numbers from the wavelengths in world units. keep them several mesh cells long
			let k2 = 6.2832 / max(WU.shoreWaveLength2, 1.0);
			let w1 = 1.9 * WU.shoreWaveSpeed;	// angular speed. At a speed setting of 1.0 its close to the dominant open ocean waves so nothing changes pace at the hand over
			let w2 = 2.3 * WU.shoreWaveSpeed;

			// slow variation along the coast in phase and in size, otherwise every crest is a perfect copy of the shoreline
			let warp = 1.4 * sin(dot(worldXZ, vec2f(0.023, 0.017)) + 0.21 * time);
			let sets = 0.8 + 0.2 * sin(dot(worldXZ, vec2f(-0.011, 0.019)) - 0.13 * time);
			let theta1 = k1 * shoreDistance + w1 * time + warp;
			let theta2 = k2 * shoreDistance + w2 * time - 1.7 * warp;

			// coasts facing into the wind get the full waves, the sheltered side gets less
			let windward = mix(0.6, 1.0, saturate(0.5 - 0.5 * dot(normalize(WU.windDirection), awayFromShore)));

			// grows from nothing at the edge of the zone up to the break line, then runs out as it reaches land. Never taller than the water is deep
			let envelope = smoothstep(0.0, shoreBreakDistance, shoreDistance) * (1.0 - smoothstep(shoreBreakDistance, shoreZone, shoreDistance));
			let amplitude = min(shoreWaveHeight * envelope * sets * windward, 0.6 * max(waterDepth, 0.0)) * (1.0 - lake);	// (no surf on a lake)
			// capped so the push can never bunch the surface up past the point of folding (squeeze of 1.0), whatever the settings above are
			let steepness = min(mix(shoreSteepness, 1.0, saturate(shoreDistance / shoreZone)), 0.9 / max(amplitude * k2, 0.0001));

			// a mesh cant carry a wave much shorter than a few of its cells, so on the coarser (level of detail) tiles
			//		each train bows out as its wavelength gets down towards the cell size, instead of turning into jagged noise
			let weight1 = 0.62 * smoothstep(2.5, 5.0, (6.2832 / k1) / cellSize);
			let weight2 = 0.38 * smoothstep(2.5, 5.0, (6.2832 / k2) / cellSize);

			shoreHeight = amplitude * (weight1 * cos(theta1) + weight2 * cos(theta2));
			shoreSlope = -amplitude * (weight1 * k1 * sin(theta1) + weight2 * k2 * sin(theta2));
			shorePush = -awayFromShore * steepness * amplitude * (weight1 * sin(theta1) + weight2 * sin(theta2));
			shoreSqueeze = steepness * amplitude * (weight1 * k1 * cos(theta1) + weight2 * k2 * cos(theta2));
		}

		//------------------Deep Sea Swell-----------------
		// big slow rollers for the open sea, underneath the wind waves from the FFT: a handful of long trochoid (gerstner) waves heading roughly down wind.
		//		they come straight from the world position rather than a texture, so they can be far longer than a tile and never repeat from tile to tile
		var swellHeight = 0.0;					// added to the height
		var swellPush = vec2f(0.0, 0.0);		// added to the horizontal position
		var swellTangentX = vec3f(0.0, 0.0, 0.0);	// how (push.x, height, push.z) change per unit moved along world x
		var swellTangentZ = vec3f(0.0, 0.0, 0.0);	// and along world z

		// deep sea only. It grows with the depth of the water up to the deep sea depth, and with the distance from land,
		//		which is what keeps it smooth off coasts that drop straight to nothing (and stops it washing over the land)
		//		(both are known everywhere: from the top down height map near the camera, from the terrain's own texture beyond it)
		let swellShoreDistance = min(WU.swellShoreDistance, shoreFieldRange);
		let swellDepthFactor = smoothstep(0.5 * WU.deepSeaDepth, max(WU.deepSeaDepth, 0.001), waterDepth);
		let swellShoreFactor = smoothstep(0.35 * swellShoreDistance, max(swellShoreDistance, 0.001), shoreDistance);
		let swellSize = WU.swellHeight * min(swellDepthFactor, swellShoreFactor) * distanceFade * (1.0 - lake);	// flattens with distance like everything else, to meet the horizon plane. And no swell on a lake

		if (swellSize > 0.001) {
			// the trains: wavelength (x the swell length), share of the height, heading (radians off the wind), and a starting phase so they dont all line up
			var trainLength = array<f32, 5>(1.0, 0.72, 1.38, 0.55, 1.83);
			var trainShare = array<f32, 5>(0.44, 0.20, 0.18, 0.10, 0.08);
			var trainTurn = array<f32, 5>(0.0, 0.38, -0.31, -0.62, 0.21);
			var trainPhase = array<f32, 5>(0.0, 1.7, 4.1, 2.6, 5.3);

			let baseLength = max(WU.swellLength, 1.0);
			let windAngle = atan2(WU.windDirection.y, WU.windDirection.x);
			// the FFT waves are simulated on a small patch stretched up to the tile size. The same stretch on gravity keeps the swell moving in step with them
			let gravity = 9.81 * (WU.gridSize.x / WU.oceanPlanePhysicalSize);

			// how hard the crests get pinched: capped so that all the trains piled up together still cant fold the surface over
			var totalSlope = 0.0;
			for (var i = 0; i < 5; i++) {
				totalSlope += (6.2832 / (baseLength * trainLength[i])) * swellSize * trainShare[i];
			}
			let lean = min(WU.swellSteepness, 0.9 / max(totalSlope, 0.0001));

			for (var i = 0; i < 5; i++) {
				let k = 6.2832 / (baseLength * trainLength[i]);		// wave number
				let amplitude = swellSize * trainShare[i];
				let heading = windAngle + trainTurn[i];
				let direction = vec2f(cos(heading), sin(heading));
				let speed = sqrt(gravity * k) * WU.swellSpeed;		// deep water waves: the longer the wave the faster it runs
				let phase = k * dot(direction, vec2f(worldX, worldZ)) - speed * WU.step + trainPhase[i];

				swellHeight += amplitude * cos(phase);
				swellPush -= direction * (lean * amplitude * sin(phase));	// pushed towards each crest, same as the choppy displacement

				// change in (push.x, height, push.z) per unit moved along the direction of travel, shared out onto x and z
				let along = vec3f(-direction.x * lean * amplitude * k * cos(phase), -amplitude * k * sin(phase), -direction.y * lean * amplitude * k * cos(phase));
				swellTangentX += along * direction.x;
				swellTangentZ += along * direction.y;
			}
		}

		var position = vec3f((vertGridPosX - WU.gridSize.x * 0.5) + WU.tileOffsetX + displacement.x + shorePush.x + swellPush.x,
							 waveHeightAdj + shoreHeight + swellHeight,
							 (vertGridPosZ - WU.gridSize.y * 0.5) + WU.tileOffsetZ + displacement.y + shorePush.y + swellPush.y);

		//------------------Normal and Crest Foam-----------------
		// neighbouring texels one mesh cell either side (so further apart on the coarser tiles), wrapped around the texture
		let texelXp = vec2u((texel.x + texelStride) % textureWidth, texel.y);
		let texelXm = vec2u((texel.x + textureWidth - texelStride) % textureWidth, texel.y);
		let texelZp = vec2u(texel.x, (texel.y + texelStride) % textureWidth);
		let texelZm = vec2u(texel.x, (texel.y + textureWidth - texelStride) % textureWidth);

		// central differences across two cells of the height and of the displacement
		let chain = (attenuation + 2.0 * abs(waveHeight) * shallowFactor * rippleScale) * distanceFade;	// d(waveHeightAdj) / d(waveHeight)
		let dHdx = (textureLoad(finalWaveHeightTexture, texelXp).x - textureLoad(finalWaveHeightTexture, texelXm).x) * chain;
		let dHdz = (textureLoad(finalWaveHeightTexture, texelZp).x - textureLoad(finalWaveHeightTexture, texelZm).x) * chain;
		let dDdx = (textureLoad(finalDisplacementTexture, texelXp).xy - textureLoad(finalDisplacementTexture, texelXm).xy) * chop;
		let dDdz = (textureLoad(finalDisplacementTexture, texelZp).xy - textureLoad(finalDisplacementTexture, texelZm).xy) * chop;

		// tangents of the displaced surface along the grid x and z, the normal is their cross product
		let span = 2.0 * cellSize;
		// the shore waves are analytic, so their share of each tangent comes from their derivatives along the away-from-shore direction
		let shoreTangentX = vec3f(-awayFromShore.x * shoreSqueeze, shoreSlope, -awayFromShore.y * shoreSqueeze) * (awayFromShore.x * span);
		let shoreTangentZ = vec3f(-awayFromShore.x * shoreSqueeze, shoreSlope, -awayFromShore.y * shoreSqueeze) * (awayFromShore.y * span);
		let tangentX = vec3f(span + dDdx.x, dHdx, dDdx.y) + shoreTangentX + swellTangentX * span;
		let tangentZ = vec3f(dDdz.x, dHdz, span + dDdz.y) + shoreTangentZ + swellTangentZ * span;
		var normal = normalize(cross(tangentZ, tangentX));
		if (normal.y < 0.0) {
			normal = -normal;	// surface has folded over itself here, keep the normal facing up
		}

		// Jacobian of the horizontal displacement: how much a patch of surface has been squeezed
		//		1.0 is undisturbed, < 1.0 is squeezed together (crests), > 1.0 is stretched (troughs), < 0.0 has folded over (a breaking wave)
		let jacobian = (tangentX.x * tangentZ.z - tangentX.z * tangentZ.x) / (span * span);
		let foamThreshold = WU.foamThreshold;		// foam starts where the jacobian drops below this
		let foamFade = max(WU.foamFade, 0.001);		// how far below the threshold until its fully white
		let foam = saturate((foamThreshold - jacobian) / foamFade);

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
		// depth of the (still) water here, for the see-through shallows. Open sea is far too deep to see through, so it stays opaque
		vertex.depth = waterDepth;
		return vertex;
}

@compute @workgroup_size(${WATER_WORKGROUP_SIZE[0]}, ${WATER_WORKGROUP_SIZE[1]}, ${WATER_WORKGROUP_SIZE[2]})
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {

		var gIndex = GlobalIvocationID.x;

		let fPerVertexData = u32(3 + 2 + 3);

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
			vertex.depth = (before.depth + after.depth) * 0.5;
		}

		// uv isnt used by the water yet, so the foam factor and the water depth ride in that slot
		waterVertexData[oVertInd + 0] = vertex.position.x;
		waterVertexData[oVertInd + 1] = vertex.position.y;
		waterVertexData[oVertInd + 2] = vertex.position.z;
		waterVertexData[oVertInd + 3] = vertex.foam;
		waterVertexData[oVertInd + 4] = vertex.depth;
		waterVertexData[oVertInd + 5] = vertex.normal.x;
		waterVertexData[oVertInd + 6] = vertex.normal.y;
		waterVertexData[oVertInd + 7] = vertex.normal.z;
		
		
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
`;

/*
	The raw IFFT output is centered around frequency zero in the corner, which gives a discontinuous-looking wave pattern
	The shift pass applies a checkerboard sign flip which mathematically moves the zero-frequency component to the center making the wave pattern tile seamlessly.
	(gIndex.x + gIndex.y) % 2u alternates between 0 and 1 in a checkerboard pattern across the grid
*/

export const c_Shift =
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

	@group(0) @binding(1) var inTexture : texture_storage_2d<rgba32float, read>;
	@group(0) @binding(2) var outTexture : texture_storage_2d<rgba32float, write>;
	

	@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		var gIndex = GlobalInvocationID;
		var val = textureLoad(inTexture, gIndex.xy);
		let N2 = WU.resolution;																		// THIS HAS TO BE POWER OF TWO REPLACE ONCE DONE TESTING!!!!!!!!
		
		//permute and scale
		var permute = val * (1.0 - 2.0 * f32((gIndex.x + gIndex.y) % 2u));
		
		//checkerboard style
		//var permute = vec4f(0.,0.,0.,0.);
		//if ((gIndex.x + gIndex.y) % 2u == 0) {
		//	permute = val;
		//} else {
		//	permute = -val;
		//}
		
		textureStore(outTexture, gIndex.xy, vec4f(permute.x / N2, permute.y / N2, 0.0, 1.0));
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
		
		// Determine which direction to process (horizontal or vertical)
		let direction = BU.direction;
		let res = u32(WU.resolution);
		
		if (BU.direction == 0.0) {
			// Horizontal pass (IFFT along rows)
			
			let preCompData = textureLoad(preCompTexture, vec2u(u32(BU.stage), gIndex.x));
			let inputIndices = vec2u(u32(preCompData.z), u32(preCompData.w));
			
			if(BU.pingPong == 0.0) {
				// Load data from input texture (real and imaginary parts of h0k)
				//let a = textureLoad(inTexture, vec2u(inputIndices.x, gIndex.y),0).xy;
				//let b = textureLoad(inTexture, vec2u(inputIndices.y, gIndex.y),0).xy;
				
				let a = vec2f(pingPongA[(gIndex.y * res + inputIndices.x) * 2 + 0], pingPongA[(gIndex.y * res + inputIndices.x) * 2 + 1]);
				let b = vec2f(pingPongA[(gIndex.y * res + inputIndices.y) * 2 + 0], pingPongA[(gIndex.y * res + inputIndices.y) * 2 + 1]);
				
				// Perform FFT butterfly operation (we could swap this depending on the FFT stage)		
				let p = vec2f(a.x, a.y);
				let q = vec2f(b.x, b.y);
				let w = vec2f(preCompData.x, preCompData.y);
				let result = complexAdd(p, complexMul(w,q));
				
				// Store the result back into the output texture
				//textureStore(outTexture, gIndex.xy, vec4f(result.x, result.y, 0.0, 1.0));
				pingPongB[(gIndex.y * res + gIndex.x) * 2 + 0] = result.x;
				pingPongB[(gIndex.y * res + gIndex.x) * 2 + 1] = result.y;
				
			} else {
				// Load data from input texture (real and imaginary parts of h0k)
				//let a = textureLoad(inTexture, vec2u(inputIndices.x, gIndex.y),0).xy;
				//let b = textureLoad(inTexture, vec2u(inputIndices.y, gIndex.y),0).xy;
				
				let a = vec2f(pingPongB[(gIndex.y * res + inputIndices.x) * 2 + 0], pingPongB[(gIndex.y * res + inputIndices.x) * 2 + 1]);
				let b = vec2f(pingPongB[(gIndex.y * res + inputIndices.y) * 2 + 0], pingPongB[(gIndex.y * res + inputIndices.y) * 2 + 1]);
				
				// Perform FFT butterfly operation (we could swap this depending on the FFT stage)		
				let p = vec2f(a.x, a.y);
				let q = vec2f(b.x, b.y);
				let w = vec2f(preCompData.x, preCompData.y);
				let result = complexAdd(p, complexMul(w,q));
				
				// Store the result back into the output texture
				//textureStore(outTexture, gIndex.xy, vec4f(result.x, result.y, 0.0, 1.0));
				pingPongA[(gIndex.y * res + gIndex.x) * 2 + 0] = result.x;
				pingPongA[(gIndex.y * res + gIndex.x) * 2 + 1] = result.y;
				
			}
			
		} else {
			// Vertical pass (IFFT along columns)
				
			let preCompData = textureLoad(preCompTexture, vec2u(u32(BU.stage), gIndex.y));
			let inputIndices = vec2u(u32(preCompData.z), u32(preCompData.w));
			
			if(BU.pingPong == 0.0) {
				// Load data from input texture (real and imaginary parts of h0k)
				//let a = textureLoad(inTexture, vec2u(gIndex.x, inputIndices.x),0).xy;
				//let b = textureLoad(inTexture, vec2u(gIndex.x, inputIndices.y),0).xy;
				
				let a = vec2f(pingPongA[(inputIndices.x * res + gIndex.x) * 2 + 0], pingPongA[(inputIndices.x * res + gIndex.x) * 2 + 1]);
				let b = vec2f(pingPongA[(inputIndices.y * res + gIndex.x) * 2 + 0], pingPongA[(inputIndices.y * res + gIndex.x) * 2 + 1]);
	
				// Perform FFT butterfly operation (we could swap this depending on the FFT stage)
				let p = vec2f(a.x, a.y);
				let q = vec2f(b.x, b.y);
				let w = vec2f(preCompData.x, preCompData.y);
				let result = complexAdd(p, complexMul(w,q));
				
				// Store the result back into the output texture
				//textureStore(outTexture, gIndex.xy, vec4f(result.x, result.y, 0.0, 1.0));
				pingPongB[(gIndex.y * res + gIndex.x) * 2 + 0] = result.x;
				pingPongB[(gIndex.y * res + gIndex.x) * 2 + 1] = result.y;
				
			} else {
				// Load data from input texture (real and imaginary parts of h0k)
				//let a = textureLoad(inTexture, vec2u(gIndex.x, inputIndices.x),0).xy;
				//let b = textureLoad(inTexture, vec2u(gIndex.x, inputIndices.y),0).xy;
				
				let a = vec2f(pingPongB[(inputIndices.x * res + gIndex.x) * 2 + 0], pingPongB[(inputIndices.x * res + gIndex.x) * 2 + 1]);
				let b = vec2f(pingPongB[(inputIndices.y * res + gIndex.x) * 2 + 0], pingPongB[(inputIndices.y * res + gIndex.x) * 2 + 1]);
	
				// Perform FFT butterfly operation (we could swap this depending on the FFT stage)
				let p = vec2f(a.x, a.y);
				let q = vec2f(b.x, b.y);
				let w = vec2f(preCompData.x, preCompData.y);
				let result = complexAdd(p, complexMul(w,q));
				
				// Store the result back into the output texture
				//textureStore(outTexture, gIndex.xy, vec4f(result.x, result.y, 0.0, 1.0));
				pingPongA[(gIndex.y * res + gIndex.x) * 2 + 0] = result.x;
				pingPongA[(gIndex.y * res + gIndex.x) * 2 + 1] = result.y;
			}
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

		// texels to world units: the size of one field texel on the ground
		let texelSize = length((Spaces.topDownInvViewProj * vec4f(2.0 / f32(fieldSize.x), 0.0, 0.0, 0.0)).xyz);

		textureStore(shoreDistanceTexture, gIndex, vec4f(sqrt(nearestSquared) * texelSize, 0.0, 0.0, 1.0));
	}
`;

export const c_ArrayToTexture =
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
	
	@group(0) @binding(1) var<storage, read_write> inArray: array<f32>;
	@group(0) @binding(2) var outTexture : texture_storage_2d<rgba32float, write>;

	@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		let gIndex = GlobalInvocationID.xy;	
				
		let singleDimensionIndex = gIndex.y * u32(WU.resolution) + gIndex.x;	//so this is going row by row, make sure the parsing matches in FFT
		
		textureStore(outTexture, gIndex.xy, vec4f(inArray[singleDimensionIndex * 2 + 0], inArray[singleDimensionIndex * 2 + 1], 0.0, 1.0));
	}
`;

export const c_RealizationToArray =
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
	};
	@group(0) @binding(0) var<uniform> WU: WaterUniforms;
	
	@group(0) @binding(1) var inTexture : texture_storage_2d<rgba32float, read>;
	@group(0) @binding(2) var<storage, read_write> outArray: array<f32>;

	@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		let gIndex = GlobalInvocationID.xy;	
		
		let pull = textureLoad(inTexture, gIndex);
		
		let singleDimensionIndex = gIndex.y * u32(WU.resolution) + gIndex.x;	//so this is going row by row, make sure the parsing matches in FFT
		
		outArray[singleDimensionIndex * 2 + 0] = pull.x;	//real
		outArray[singleDimensionIndex * 2 + 1] = pull.y;	//imaginary
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
	runs every frame. 
	It takes h0(k) and animates it forward in time using Euler's formula (e^iwt = cos(wt) + i·sin(wt)), where w (angular frequency) is derived from 
	the dispersion relation w = sqrt(g * |k|) and gravity is determining how fast each wave frequency travels
	The result h(k,t) is the animated frequency-domain ocean at the current time step, still as a complex texture
*/

export const c_hkt =
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
	
	@group(0) @binding(1) var initialHeightField : texture_storage_2d<rgba32float, read>;
	@group(0) @binding(2) var waveHeightRealization : texture_storage_2d<rgba32float, write>;
	@group(0) @binding(3) var displacementRealization : texture_storage_2d<rgba32float, write>;

fn complexMul(a: vec2f, b: vec2f) -> vec2f {
    return vec2f(
        a.x * b.x - a.y * b.y,
        a.x * b.y + a.y * b.x
    );
}

fn complexConj(z: vec2f) -> vec2f {
    return vec2f(z.x, -z.y);
}


@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		
		var gIndex = GlobalIvocationID.xy;
		let gridWidth = u32(WU.resolution);
		let vertGridPosX = gIndex.x;
		let vertGridPosZ = gIndex.y;
			
		// vector fields with e^it
		// https://www.youtube.com/watch?v=v0YEaeIClKY
		// e : eulers number (2.7...)
		// i : sqrt(-1), will take this 1D equation and create orthogonal vector of velocity, velocity WILL be 90deg of that position
		// t : time
		// e^it = cosx + isinx    this is how we remove the sin and cos that gerstners rely on
		
		//tessendorf paper
		//	the test parameters are ones from section 3.5
		//https://people.computing.clemson.edu/~jtessen/reports/papers_files/coursenotes2002.pdf
		let e = f32(2.71828);		// eulers num, but the "exp(f32 x)" function does e^x 
		let pi = f32(3.14159);		//PI
		let g = f32(9.81);			//grav constant
		
		//"waveheight is a random variable of horizontal position and time, h(x,t)"
		// wave number = grid point number
		// Lx and Lz are the actually lengths in meters of the patch
		// discrete sample points is the WU.resolution
		
		let oceanSizeL = WU.oceanPlanePhysicalSize;	//the size of the tile, what to scale the grid by
		let deltaK = ((2.0 * pi) / oceanSizeL);
		let kx = deltaK * (f32(vertGridPosX) - (WU.resolution / 2.0));
		let ky = deltaK * (f32(vertGridPosZ) - (WU.resolution / 2.0));
		let k = vec2f(kx, ky);	
											
		let D = 1.0;
		
		let w2 = g * length(k);				//frequency squared, infinite depth
		
		//THE BELOW IS FOR WAVE SPEED (FREQUENCY) NOT HEIGHT
		//let w2 = g * length(k) * tan(length(k) * D);			//frequency squared, adjusted for depth
		//let w2 = g * k * (1 + (k * k) * (LS * LS));		//frequency squared, but for small waves < 1cm
		
		let w = sqrt(w2);
		
		let h0Data = textureLoad(initialHeightField, vec2u(u32(vertGridPosX), u32(vertGridPosZ)));
		let h0k = h0Data.xy;
		let h0NegkConj = h0Data.zw;
		
		let t = WU.step;
		let cos_wt = cos(w * t);
		let sin_wt = sin(w * t);
	
		let exponent = vec2f(cos_wt, sin_wt);      // e^{iωt}
		let exponent_inv = vec2f(cos_wt, -sin_wt);	//it is supposed to be the H0-k conjugate multiplied by inverse exp
		
		let term1 = complexMul(h0k, exponent);
		let term2 = complexMul(h0NegkConj, exponent_inv);
		
		let hkt = term1 + term2;
		
		//DEBUG, visualizing hKt directly will show an inward collapse, this is how hKt is supposed to workgroup_size
		//			the waveHeightRealization should actually be hXt.
		
		// horizontal (choppy) displacement spectrum: D(k,t) = -i * (k / |k|) * h(k,t)
		//		Dx and Dz are packed into one complex number as Dx + i*Dz, so a single IFFT gives Dx in the real part and Dz in the imaginary part
		//		-i*(kx/|k|)*h + i * (-i*(ky/|k|)*h) = ((ky - i*kx) / |k|) * h
		//		this only works because h(k,t) is hermitian (see c_h0kConj), which is what makes Dx and Dz both real
		let kMag = length(k);
		var displacementSpectrum = vec2f(0.0, 0.0);
		if (kMag > 0.0001 && gIndex.x > 0u && gIndex.y > 0u) {	// k = 0 has no direction, and the first row/column (nyquist) has no -k partner
			displacementSpectrum = complexMul(vec2f(ky, -kx) / kMag, hkt);
		}
		textureStore(displacementRealization, gIndex, vec4f(displacementSpectrum.x, displacementSpectrum.y, 0.0, 1.0));

		textureStore(waveHeightRealization, vec2u(u32(vertGridPosX), u32(vertGridPosZ)), vec4f(hkt.x, hkt.y,0.0,1.0));
	}
`;

/*
	The IFFT requires that the spectrum satisfies Hermitian symmetry
		meaning h0(-k) = conjugate of h0(k)
*/
export const c_h0kConj =
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
	
	@group(0) @binding(1) var inH0KTexture : texture_storage_2d<rgba32float, read>;
	@group(0) @binding(2) var initialHeightField : texture_storage_2d<rgba32float, write>;

	fn complexConj(z: vec2f) -> vec2f {
		return vec2f(z.x, -z.y);
	}

@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		
		var gIndex = GlobalIvocationID.xy;
		let res = u32(WU.resolution);
		
		// h0(-k) has to be the SAME random value that the texel for -k holds, not a separate random draw
		//		k is centered at res/2, so the texel holding -k is the mirror of this one through the center
		//		with this, h(k,t) is hermitian and the IFFT output is purely real (imaginary channel of the final height should read 0)
		let negIndices = vec2u((res - gIndex.x) % res, (res - gIndex.y) % res);
		let h0k = textureLoad(inH0KTexture, gIndex).xy;
		let h0NegkConj = complexConj(textureLoad(inH0KTexture, negIndices).xy);
		textureStore(initialHeightField, gIndex, vec4f(h0k.x, h0k.y, h0NegkConj.x, h0NegkConj.y));

		//independent random draw for h0(-k) kept in the .zw of the same texel. NOT hermitian, the IFFT output ends up with an imaginary part
		//let data = textureLoad(inH0KTexture, gIndex);
		//let h0NegkConj = complexConj(data.zw);
		//textureStore(initialHeightField, gIndex, vec4f(data.x, data.y, h0NegkConj.x, h0NegkConj.y));

		
		//debug CONJ SYM test, if we see blue, we fail
		//let h0k = textureLoad(inH0KTexture, gIndex).xy;
		//let h0Negk = textureLoad(inH0KTexture, vec2u((res - gIndex.x) % res, (res - gIndex.y) % res)).xy;
		//let h0kConj = complexConj(h0k);
		//
		//let epsilon = 0.0001;
		//let isEqual = abs(h0Negk.x - h0kConj.x) < epsilon && abs(h0Negk.y - h0kConj.y) < epsilon;
		//let blue = select(1.0, 0.0, isEqual); // 1.0 = fail, 0.0 = pass
		//textureStore(initialHeightField, gIndex, vec4f(0, 0, blue, 1));
	}
`;

/*
	For every point on a 2D frequency grid (the "wave number grid"), it computes how much energy a wave of that frequency and direction should have. 
	The Phillips Spectrum formula weighs waves based on wind speed, wind direction alignment, and physical suppression of very small waves. It then multiplies 
	that energy by a random Gaussian number; giving a statistically realistic but unique ocean each time. 
	The output h0k is a texture where each texel is a complex number representing the initial amplitude of one wave component.
*/
export const c_h0k =
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
	
	@group(0) @binding(1) var phillipsSpectrumOutTexture : texture_storage_2d<rgba32float, write>;
	@group(0) @binding(2) var outH0KTexture : texture_storage_2d<rgba32float, write>;
	
	@group(0) @binding(3) var<storage, read_write> complexGaussArray: array<f32>;

	fn complexAdd(a: vec2f, b: vec2f) -> vec2f {
		return vec2f(a.x + b.x, a.y + b.y);
	}
	
	fn complexMul(a: vec2f, b: vec2f) -> vec2f {
		return vec2f(
			a.x * b.x - a.y * b.y,
			a.x * b.y + a.y * b.x
		);
	}
	
	fn complexConj(z: vec2f) -> vec2f {
		return vec2f(z.x, -z.y);
	}
	
// Describes how wave energy is distributed across different wave frequencies and directions in a fully developed ocean
fn phillipsSpectrum(kx: f32, ky: f32) -> f32 {
	let pi = f32(3.14159);		//PI
	let g = f32(9.81);			//grav constant
	
	//"waveheight is a random variable of horizontal position and time, h(x,t)"
	// wave number = grid point number
	// Lx and Lz are the actually lengths in meters of the patch
	// discrete sample points is the WU.resolution
	
	let K = vec2f(kx, ky);		//GRID OF WAVE VECTORS
	
	var kMag = length(K);			// italic k, magnitude
	if(kMag < 0.0001) {		//avoid blowout
		kMag = 0.0001;		//allowing the kMag at a minimum means the top row of the texture and left column will contain noise
	}
	
	

	//check for kx, kz, w
	//let w2 = g * length(k);
	//let w = sqrt(w2);
	//textureStore(outH0KTexture, vec2u(u32(vertGridPosX), u32(vertGridPosZ)), vec4f(kx,ky,w,1.0));
	
	
	//phillips spectrum
	// These slides also help: https://www.cs.ubc.ca/~rbridson/courses/533d-winter-2005/cs533d-slides-mar9.pdf
	
	let V = WU.windSpeed; 			//wind speed, i made this up
	let L = (V * V) / g;	//largest possible waves from a continuous wind
	let Lmin = 0.01;			//minimum wavelength in meters
	let kLmin2 = (kMag * Lmin) * (kMag * Lmin);
	let A = 10.0;			//"a numeric constant" ???
	
	let kHat = normalize(K); //vec2f(K.x / kMag, K.y / kMag);		// hat k, unit vector
	let wHat = normalize(WU.windDirection);			// hat w, wind direction, normalized input just incase
	let kHwH = dot(kHat, wHat);						// hat k dot hat w 
	let kHwHX = kHwH * kHwH; 						//RAISING THIS X TIMES INCREASES WIND INFLUENCE MORE
	let kMagLSqr = (kMag * L) * (kMag * L);			
	var kMagDenomX = kMag * kMag * kMag * kMag;		//4 is standard ill use 2
	//kMag4 = max(kMag4, 0.1);
	
	var PhK = 0.0;
	if(kMag != 0.0) {
		//dont divide by 0
		//PhK = A * (exp(-1.0 / kL2) * supression /  k4) * kw6;
		//PhK = A * (1.0 / k4) * exp((-1.0 / kL2) - kLmin2) * (kw * kw);
		
		PhK = A * (exp(-1.0 / kMagLSqr) / kMagDenomX) * kHwHX;
		PhK *= exp(-kLmin2);	//high freq supression (avoiding spikes)
	}
	
	return PhK;
}

fn h0(vertGridPosX: u32, vertGridPosZ: u32) {
	
	//BEST PAGE for all of this
	//https://barthpaleologue.github.io/Blog/posts/ocean-simulation-webgpu/#:~:text=Okay%2C%20so%20we%20need%20a,w%5E=%E2%88%A3w%E2%88%A3w
	
	let pi = f32(3.14159);
	
	let oceanSizeL = WU.oceanPlanePhysicalSize;	//the size of the tile, what to scale the grid by
	let deltaK = ((2.0 * pi) / oceanSizeL);
	let kx = deltaK * (f32(vertGridPosX) - (WU.resolution / 2.0));
	let ky = deltaK * (f32(vertGridPosZ) - (WU.resolution / 2.0));
	
	var PhK = phillipsSpectrum(kx, ky);	
	
	//DEBUG
	// PhK = (cos(kx * 2.0) * cos(kx * 2.0) - sin(ky * 2.0) * sin(ky * 2.0));
	
	
	//THIS IS FOR DEBUG FOR NOW
	// this is a check to see for spikes
	let compressedDynamicRangePhk = sqrt(min(max(PhK, 0.01), 3000.0));
	textureStore(phillipsSpectrumOutTexture, vec2u(vertGridPosX, vertGridPosZ), vec4<f32>(compressedDynamicRangePhk,compressedDynamicRangePhk,compressedDynamicRangePhk,1.0));
	
	let index = vertGridPosX + u32(WU.resolution) * vertGridPosZ;
	let offset = index * 4u;
	let gauss = vec2f(complexGaussArray[offset], complexGaussArray[offset + 1u]);
	//let gauss = vec2f(1.0,1.0);
	
	//DEBUG NOISE
	//let gauss = vec2f(1.0,1.0);
	//var gcheck = length(gauss);
	//if(gcheck > 3.0) {
	//	textureStore(phillipsSpectrumOutTexture, vec2u(vertGridPosX, vertGridPosZ), vec4<f32>(1.,0.,0.,1.));
	//} else if (gcheck < -0.0) {
	//	textureStore(phillipsSpectrumOutTexture, vec2u(vertGridPosX, vertGridPosZ), vec4<f32>(0.,1.,0.,1.));
	//} else {
	//	textureStore(phillipsSpectrumOutTexture, vec2u(vertGridPosX, vertGridPosZ), vec4<f32>(length(gauss),length(gauss),length(gauss),1.0));
	//}
	
	let minClampVal = 0.0001;			//if PhK returns 0, or is wayyy too low, find this (reduces the 0 line split effect)
	let maxClampVal = 3000.0;
	var clampedPhK = sqrt(min(max(PhK, minClampVal), maxClampVal));
	let scale = (1.0 / sqrt(2.0));
	let h0k = scale * (gauss * clampedPhK);				//max is used incase PhK is 0, which sqrt(0) would be NaN

	//textureStore(outH0KTexture, vec2u(vertGridPosX, vertGridPosZ), vec4f(h0k.x, h0k.y,0.0,0.0));		// storing h0k
	
	//DEBUG check for random gauss
	//textureStore(outH0KTexture, vec2u(u32(vertGridPosX), u32(vertGridPosZ)), vec4(length(gauss), length(gaussNegK), 0.0,1.0));
	
	//let h0Negk = complexConj(h0k);
	//let negIndices = vec2u((u32(WU.resolution) - vertGridPosX ) % u32(WU.resolution), 
	//						(u32(WU.resolution) - vertGridPosZ ) % u32(WU.resolution));
	//
	//if(vertGridPosX > u32(WU.resolution) / 2u || 
	//	(vertGridPosX == u32(WU.resolution) / 2u && vertGridPosZ > u32(WU.resolution) / 2u)) {
	//	return;
	//}
	//
	//textureStore(outH0KTexture, negIndices, vec4f(h0Negk.x, h0Negk.y,0.0,0.0));
	
	//with Phillips -k
	let gaussNeg = vec2f(complexGaussArray[offset + 2u], complexGaussArray[offset + 3u]);
	//let gaussNeg = vec2f(1.0,1.0);
	var PhNegK = phillipsSpectrum(-kx, -ky);	
	var clampedPhNegK = sqrt(min(max(PhNegK, minClampVal), maxClampVal));
	let h0Negk = scale * (gaussNeg * clampedPhNegK);				//max is used incase PhK is 0, which sqrt(0) would be NaN
	textureStore(outH0KTexture, vec2u(vertGridPosX, vertGridPosZ), vec4f(h0k.x, h0k.y, h0Negk.x, h0Negk.y));
	
	
	//Just h0k Output
	//textureStore(outH0KTexture, vec2u(vertGridPosX, vertGridPosZ), vec4f(h0k.x, h0k.y,0.0,0.0));

	
}

@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		
		var gIndex = GlobalIvocationID;
		
		//------------------------------FORM GRID-------------------------------
		let gridWidth = u32(WU.resolution);
		let vertGridPosX = gIndex.x;
		let vertGridPosZ = gIndex.y;
		
		//-----------------------------------
		h0(vertGridPosX, vertGridPosZ);
		
		
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
	};
	
	struct VertexOutput {				//into frag
		@builtin(position) pos: vec4f,
		@location(0) fragUV: vec2f,
		@location(1) fragNormal: vec3f,
		@location(2) worldPos: vec3f,
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
	fn skyColorAt(direction: vec3f) -> vec3f {
		let rd = normalize(direction + vec3f(0.0, 0.00001, 0.0));	// never zero length
		let azimuth   = atan2(-rd.z, -rd.x);
		let elevation = asin(clamp(rd.y, -1.0, 1.0));
		let uv = vec2f(azimuth / (2.0 * PI) + 0.5, elevation / PI + 0.5);
		let color = textureSampleLevel(skyLUT, skySampler, uv, 0.0).rgb;

		let exposed = 1.0 - exp(-color * 10.0);
		return pow(exposed, vec3f(1.0 / 2.2));
	}

	//same as vertexoutput without builtin bits
	struct FragInput {
		@builtin(position) fragCoord: vec4f,
		@location(0) fragUV: vec2f,
		@location(1) fragNormal: vec3f,
		@location(2) worldPos: vec3f,
	};

	fn lerp(a: vec4<f32>, b: vec4<f32>, t: f32) -> vec4<f32> {
		return a + t * (b - a);
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
		let deepBlue = vec3f(0.125, 0.125, 0.451);
		let baseBlue = vec3f(0.486, 0.486, 0.788);
		let body     = mix(deepBlue, baseBlue, saturate(NdotL));
		
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
		let foam = saturate(input.fragUV.x);
		let foamColor = vec3f(0.95, 0.95, 0.95) * (0.55 + 0.45 * saturate(NdotL)) * waterLight;
		color = mix(color, foamColor, foam);

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
			let horizonColor = skyColorAt(vec3f(toWater.x, HORIZON_LIFT * length(toWater.xz), toWater.z));
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
