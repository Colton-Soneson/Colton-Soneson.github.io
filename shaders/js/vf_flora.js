import { windShapes } from './vf_wind.js';
import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';
import { floorShapes } from '../../code/floor.js';
import { meadowShapes } from './meadowShapes.js';
import { sunShadowShapes } from './sunShadowShapes.js';

export const FLORA_RINGS = 3;			// rings of the small plants round the camera (flora.js: RINGS)
export const FLORA_CAP = 8192;			// the most of one kind put down a frame (its share of the list)
export const FLORA_INSTANCE = 3;		// vec4s to a plant put down

/*
	THE PLANTS (flora.js; their kinds and meshes, floraKinds.js). In two steps each frame:
	THE SCATTER (a compute pass, c_floraScatter): every cell of the RINGS round the camera (the grass's way, vfc_grass.js: each its place in
		the world, so nothing swims as the camera moves) is looked at once, and the plant on it, if there is one, is put down in its kind's
		share of the list (FLORA_CAP each, a count of each kept), already sized, turned and out of sight left out:
		WHICH GROUND		the land under it (terrain.js's fields: its height, what covers it, its slope), as the land's colors have it: the
							FOREST floor, the GRASSland, the WET ground round a lake, the top of the BEACH, the ALPINE heights. None on a
							cliff, a river's or a lake's bed, a town's work, the forest's roots, a hole (computeGrass.js: setGrassHoles)
		IN COLONIES			plants grow in patches, not evenly: the ground is in cells (UBO.colony.x across, a point scattered in each),
							each a colony of one kind (the one its noise niche likes best there, at its point: niche and weight, floraKinds.js),
							thick at its middle and thinning to nothing at its edge (UBO.colony.y), the odd one of another kind amongst them
							(UBO.colony.z); and whole stretches with none (a slow noise under UBO.colony.w)
		ITS SEASON			a flower's head only from the spring through the summer, a fern browning in the fall, the mushrooms mostly in the
							fall, all of them pressed down under the snow
	THE DRAW (vertexSmall): for each kind one indirect draw of its own, exactly its own vertices, as many as were put down (the counts made
		into the draws by c_floraDraws). THE BIG ONES (bushes, laurel, wild wheat: flora.js puts them down on the CPU) are drawn from their
		own list (vertexBig). Lit as the grass is, by the lie of the land as much as by their own leaves.
*/
const common = `
	struct FloraUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz, w: seconds
		terrain : vec4f,			// x: half the world, y: the terrain grid's cell, z: sea level, w: beach height
		zones : vec4f,				// x: the forest's cover, y: the bare mountain's, z: the beach's bank, w: 1 in a world of tiles
		alpine : vec4f,				// x: the heights from (over the sea), y: the snow line, z: world units to the metre, w: density
		season : vec4f,				// x: in flower (0 to 1), y: the fall's brown, z: snow lying, w: the mushrooms' season
		grid : vec4f,				// x: rings, y: draw distance, z: horizon fog distance, w: 1 with the atmosphere on
		windScroll : vec4f,
		windBlow : vec4f,
		wind : vec4f,				// x: how far a plant sways, y: small kinds, z: cells in all the rings
		fill : vec4f,				// the share of a colony's middle with a plant on it: forest, grass, wet, beach
		fill2 : vec4f,				// x: alpine's, y: the stony ground's (its stones), z: 1 with HD Textures and Models (THE HD TEXTURES)
		colony : vec4f,				// x: a colony's cell (metres), y: how far out from its point it thins (of the cell), z: how many strays, w: bare ground under this noise
		rings : array<vec4f, ${FLORA_RINGS}>,	// side, cell size, radius, cells before this ring
		holes : vec4f,
	}
	@group(0) @binding(0) var<uniform> UBO: FloraUniforms;

	fn hash(value: u32) -> u32 {
		var x = value;
		x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
		return x;
	}
	fn random(seed: u32) -> f32 { return f32(hash(seed)) / 4294967295.0; }
	fn latticeRandom(c: vec2f) -> f32 {
		return random(hash((bitcast<u32>(i32(c.x) + 100000) * 73856093u) ^ (bitcast<u32>(i32(c.y) + 100000) * 19349663u)));
	}
	fn smoothNoise(p: vec2f) -> f32 {
		let i = floor(p); let f = fract(p); let s = f * f * (3.0 - 2.0 * f);
		return mix(mix(latticeRandom(i), latticeRandom(i + vec2f(1.0, 0.0)), s.x), mix(latticeRandom(i + vec2f(0.0, 1.0)), latticeRandom(i + vec2f(1.0, 1.0)), s.x), s.y);
	}
`;

// THE SCATTER: what it reads, and writes
export const c_flora = `
	${common}
	@group(0) @binding(2) var terrainFields: texture_2d<f32>;
	@group(0) @binding(7) var<storage, read> townCells: array<vec2u>;
	@group(0) @binding(8) var<storage, read> townList: array<u32>;
	@group(0) @binding(9) var<storage, read> townItems: array<vec4f>;
	@group(0) @binding(10) var grassHoles: texture_2d<f32>;
	${floorShapes(11, 12, 13)}
	${meadowShapes}
	@group(0) @binding(15) var<storage, read> kinds: array<vec4f>;
	@group(0) @binding(17) var<storage, read_write> counts: array<atomic<u32>>;
	@group(0) @binding(18) var<storage, read_write> placed: array<vec4f>;
	@group(0) @binding(19) var<storage, read_write> draws: array<u32>;

	fn terrainAt(xz: vec2f) -> vec4f {
		let n = vec2i(textureDimensions(terrainFields));
		let grid = (xz + vec2f(UBO.terrain.x, UBO.terrain.x)) / UBO.terrain.y;
		let base = vec2i(floor(grid));
		let f = fract(grid);
		let a = textureLoad(terrainFields, ((base % n) + n) % n, 0);
		let b = textureLoad(terrainFields, (((base + vec2i(1, 0)) % n) + n) % n, 0);
		let c = textureLoad(terrainFields, (((base + vec2i(0, 1)) % n) + n) % n, 0);
		let d = textureLoad(terrainFields, (((base + vec2i(1, 1)) % n) + n) % n, 0);
		return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
	}
	fn onTownWork(xz: vec2f) -> bool {
		let grid = townItems[0];
		let along = i32(grid.z);
		if (along <= 0) { return false; }
		let cell = ((vec2i(floor((xz + vec2f(grid.x, grid.x)) / grid.y)) % vec2i(along, along)) + vec2i(along, along)) % vec2i(along, along);
		let range = townCells[cell.y * along + cell.x];
		for (var k = 0u; k < range.y; k++) {
			let item = townList[range.x + k];
			let a = townItems[1u + item * 2u];
			let b = townItems[2u + item * 2u];
			if (b.z < 0.5) {
				let ab = a.zw - a.xy;
				let t = saturate(dot(xz - a.xy, ab) / max(dot(ab, ab), 1e-6));
				if (length(xz - a.xy - ab * t) < b.x + 0.5) { return true; }
			} else {
				let d = xz - a.xy;
				if (abs(dot(d, a.zw)) < b.x + 0.5 && abs(dot(d, vec2f(-a.w, a.z))) < b.y + 0.5) { return true; }
			}
		}
		return false;
	}
	// the zone's kinds' weights at a place (the noise niches), and one picked of them by r: none, ${0xffffffff}
	fn pickKind(zone: u32, at: vec2f, r: f32, far: bool) -> u32 {
		let m = UBO.alpine.z;
		let n1 = smoothNoise(at / (16.0 * m) + vec2f(13.1, 7.7));
		let n2 = smoothNoise(at / (37.0 * m) + vec2f(-4.3, 21.9));
		let count = u32(UBO.wind.y);
		var sum = 0.0;
		for (var k = 0u; k < count; k++) {
			let A = kinds[k * 3u]; let B = kinds[k * 3u + 1u];
			if (u32(A.z) != zone || (far && (u32(B.w) & 8u) == 0u)) { continue; }
			let d = distance(vec2f(n1, n2), B.xy) / B.z;
			sum += A.w * exp(-d * d) * select(1.0, 0.15 + UBO.season.w, (u32(B.w) & 4u) != 0u);
		}
		if (sum <= 0.0) { return 0xffffffffu; }
		var choose = r * sum;
		var kind = 0xffffffffu;
		for (var k = 0u; k < count; k++) {
			let A = kinds[k * 3u]; let B = kinds[k * 3u + 1u];
			if (u32(A.z) != zone || (far && (u32(B.w) & 8u) == 0u)) { continue; }
			let d = distance(vec2f(n1, n2), B.xy) / B.z;
			let w = A.w * exp(-d * d) * select(1.0, 0.15 + UBO.season.w, (u32(B.w) & 4u) != 0u);
			kind = k;
			if (choose < w) { break; }
			choose -= w;
		}
		return kind;
	}

	@compute @workgroup_size(64)
	fn scatter(@builtin(global_invocation_id) id: vec3u) {
		let index = id.x;
		if (index >= u32(UBO.wind.z)) { return; }
		// (which ring's cell: the rings' cells one after another)
		var ring = 0u;
		for (var r = 1u; r < ${FLORA_RINGS}u; r++) { if (index >= u32(UBO.rings[r].w)) { ring = r; } }
		let ringData = UBO.rings[ring];
		let cellInRing = index - u32(ringData.w);
		let side = u32(ringData.x);
		let cellSize = ringData.y;
		let ringOrigin = vec2i(floor(UBO.cameraPosition.xz / cellSize));
		let worldCell = ringOrigin + vec2i(i32(cellInRing % side), i32(cellInRing / side)) - vec2i(i32(side / 2u), i32(side / 2u));
		let seed = hash((bitcast<u32>(worldCell.x) * 73856093u) ^ (bitcast<u32>(worldCell.y) * 19349663u) ^ ((ring + 7u) * 83492791u));
		let root = (vec2f(worldCell) + vec2f(random(seed), random(seed + 1u))) * cellSize;
		let cameraDistance = length(root - UBO.cameraPosition.xz);
		let ragged = 0.8 + 0.2 * random(seed + 2u);
		if (cameraDistance > ringData.z * ragged) { return; }
		if (ring > 0u && cameraDistance < UBO.rings[ring - 1u].z * ragged) { return; }
		if (UBO.zones.w < 0.5 && (abs(root.x) >= UBO.terrain.x || abs(root.y) >= UBO.terrain.x)) { return; }

		//------------------WHICH GROUND-----------------
		let ground = terrainAt(root);
		let groundNormal = vec3f(ground.z, sqrt(max(1.0 - ground.z * ground.z - ground.w * ground.w, 0.0)), ground.w);
		if (groundNormal.y < 0.6) { return; }
		let h = ground.x - UBO.terrain.z;
		let cover = ground.y;
		if (cover >= UBO.zones.y && cover < UBO.zones.y + 0.05) { return; }
		if (h > UBO.alpine.y) { return; }
		let F = UBO.zones.x;
		let aboveBank = smoothstep(UBO.terrain.w + 0.5 * UBO.zones.z, UBO.terrain.w + UBO.zones.z + 0.3, h);
		let high = smoothstep(UBO.alpine.x * 0.9, UBO.alpine.x * 1.1, h);
		var weights = array<f32, 5>(
			smoothstep(F - 0.03, F + 0.03, cover) * (1.0 - smoothstep(UBO.zones.y - 0.03, UBO.zones.y, cover)) * aboveBank * (1.0 - high),
			(1.0 - smoothstep(F - 0.03, F + 0.03, cover)) * step(0.0, cover) * aboveBank * (1.0 - high),
			saturate(-cover * 2.0) * (1.0 - smoothstep(1.0, 8.0, h)),
			smoothstep(UBO.terrain.w - 1.6, UBO.terrain.w - 0.6, h) * (1.0 - aboveBank) * step(0.0, cover),
			high * step(0.0, cover));
		var total = 0.0;
		for (var z = 0; z < 5; z++) { total += weights[z]; }
		if (total < 0.05) { return; }
		var pick = random(seed + 3u) * total;
		var zone = 4u;
		for (var z = 0u; z < 5u; z++) { if (pick < weights[z]) { zone = z; break; } pick -= weights[z]; }

		//------------------IN COLONIES-----------------
		let m = UBO.alpine.z;
		// (few on the stony ground: THE MEADOW'S LOOK, meadowShapes.js)
		// (the stony grassland: its own ground, the stones', THE STONY GROUND: meadowShapes.js, floraKinds.js)
		if (zone <= 1u && random(seed + 12u) < meadowLook(root, groundNormal.y).z) { zone = 5u; }
		// (whole stretches bare: not the forest's floor, which its ferns and mosses cover all over)
		if (zone != 0u && zone != 5u && smoothNoise(root / (55.0 * m) + vec2f(31.7, -8.2)) < UBO.colony.w) { return; }
		// the colony it is in: the nearest point of those scattered one to a cell (a bigger cell for the far ring's big ones)
		let size = UBO.colony.x * m * select(1.0, 1.6, ring == ${FLORA_RINGS - 1}u);
		let base = vec2i(floor(root / size));
		var middle = vec2f(0.0); var apart = 1e9; var colonyId = 0u;
		for (var j = -1; j <= 1; j++) {
			for (var i = -1; i <= 1; i++) {
				let square = base + vec2i(i, j);
				let cid = hash((bitcast<u32>(square.x) * 73856093u) ^ (bitcast<u32>(square.y) * 19349663u) ^ 0x51ed27u);
				let point = (vec2f(square) + vec2f(random(cid), random(cid + 1u))) * size;
				let d = distance(point, root);
				if (d < apart) { apart = d; middle = point; colonyId = cid; }
			}
		}
		// thick at its middle, thinning out to nothing (each colony its own size), and a share of them none at all
		let reach = size * UBO.colony.y * (0.6 + 0.8 * random(colonyId + 2u)) * select(1.0, 1.4, zone == 0u);
		var fills = array<f32, 6>(UBO.fill.x, UBO.fill.y, UBO.fill.z, UBO.fill.w, UBO.fill2.x, UBO.fill2.y);
		let thick = fills[zone] * UBO.alpine.w * (1.0 - smoothstep(0.35, 1.0, apart / reach));
		if (random(seed + 4u) > thick) { return; }
		let far = ring == ${FLORA_RINGS - 1}u;
		// its kind: the colony's (picked at the colony's point), or now and then a stray of its own
		let stray = random(seed + 5u) < UBO.colony.z;
		let kind = pickKind(zone, select(middle, root, stray), random(select(colonyId + 3u, seed + 6u, stray)), far);
		if (kind == 0xffffffffu) { return; }

		//------------------NOT WHERE IT CANNOT BE, NOR OUT OF SIGHT-----------------
		let holeAt = vec2i(floor(root - UBO.holes.xy));
		if (all(holeAt >= vec2i(0)) && all(holeAt < vec2i(i32(UBO.holes.z))) && textureLoad(grassHoles, holeAt, 0).r > 0.5) { return; }
		let K2 = kinds[kind * 3u + 2u];
		let distant = saturate(cameraDistance / UBO.grid.y);
		// (each colony its own size, the ferns of one stretch tall and of the next short, and its own plants round that)
		let grown = mix(K2.x, K2.y, random(seed + 7u)) * mix(0.7, 1.35, random(colonyId + 9u)) * m * (1.0 - smoothstep(0.82, 1.0, distant)) * (0.75 + 0.35 * (1.0 - apart / max(reach, 0.001)));
		let foot0 = vec3f(root.x, ground.x, root.y);
		// (out of sight: its middle, a plant's height up, off the screen by more than its size)
		let clip = UBO.viewProjectionMatrix * vec4f(foot0 + vec3f(0.0, grown * 0.5, 0.0), 1.0);
		let margin = grown * 1.2;
		if (clip.w < -margin || any(abs(clip.xy) > vec2f(clip.w + margin * 2.0))) { return; }
		if (onTownWork(root)) { return; }
		let rootFloor = floorAt(root);
		if (random(seed + 8u) < rootFloor.g * 1.4 - 0.15) { return; }

		//------------------PUT DOWN-----------------
		let slot = atomicAdd(&counts[kind], 1u);
		if (slot >= ${FLORA_CAP}u) { return; }
		let o = (kind * ${FLORA_CAP}u + slot) * ${FLORA_INSTANCE}u;
		placed[o] = vec4f(root.x, ground.x + rootFloor.a - rootFloor.b - 0.03 * m, root.y, f32(kind));
		placed[o + 1u] = vec4f(random(seed + 9u) * 6.2832, grown, random(seed + 10u), distant);
		placed[o + 2u] = vec4f(groundNormal.x, groundNormal.z, random(seed + 11u), 0.0);
	}

	// THE DRAWS: each kind's count into its indirect draw (vertices, instances, first vertex, first instance). The first instance always 0
	//		(another is a feature not every GPU has): its vertices start at its own first, and the vertex shader knows its kind from them
	@compute @workgroup_size(64)
	fn makeDraws(@builtin(global_invocation_id) id: vec3u) {
		let k = id.x;
		if (k >= u32(UBO.wind.y)) { return; }
		let A = kinds[k * 3u];
		draws[k * 4u] = u32(A.y);
		draws[k * 4u + 1u] = min(atomicLoad(&counts[k]), ${FLORA_CAP}u);
		draws[k * 4u + 2u] = u32(A.x);
		draws[k * 4u + 3u] = 0u;
	}
`;

// THE DRAW
export const vf_flora = `
	${common}
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
	@group(0) @binding(2) var terrainFields: texture_2d<f32>;
	@group(0) @binding(3) var skyLUT: texture_2d<f32>;
	@group(0) @binding(4) var skySampler: sampler;
	@group(0) @binding(5) var windTexture: texture_2d<f32>;
	@group(0) @binding(6) var windSampler: sampler;
	@group(0) @binding(14) var<storage, read> vertices: array<vec4f>;
	@group(0) @binding(15) var<storage, read> kinds: array<vec4f>;
	@group(0) @binding(16) var<storage, read> big: array<vec4f>;
	@group(0) @binding(18) var<storage, read> placed: array<vec4f>;

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) normal: vec3f,
		@location(2) groundNormal: vec3f,
		@location(3) color: vec3f,
		@location(4) up: f32,
		@location(5) distant: f32,
		@location(6) uv: vec2f,
		@location(7) @interpolate(flat) mat: f32,
		@location(8) @interpolate(flat) seed: f32,
	};

	${moonShapes}
	${windShapes}
	${sunShadowShapes(0)}

	fn terrainNormal(xz: vec2f) -> vec3f {
		let n = vec2i(textureDimensions(terrainFields));
		let grid = vec2i(floor((xz + vec2f(UBO.terrain.x, UBO.terrain.x)) / UBO.terrain.y));
		let a = textureLoad(terrainFields, ((grid % n) + n) % n, 0);
		return vec3f(a.z, sqrt(max(1.0 - a.z * a.z - a.w * a.w, 0.0)), a.w);
	}

	// a vertex of a kind's, shaped, turned, sized and set at foot: its season on it, and the wind's sway
	fn plantVertex(kind: u32, v: u32, foot: vec3f, yaw: f32, size: f32, tone: f32, bloom: f32, groundNormal: vec3f, distant: f32, isBig: bool) -> VertexOutput {
		var output: VertexOutput;
		output.pos = vec4f(2.0, 2.0, 2.0, 1.0);
		let K0 = kinds[kind * 3u];
		let K1 = kinds[kind * 3u + 1u];
		let P = vertices[v * 4u];
		let N = vertices[v * 4u + 1u];
		var color = vertices[v * 4u + 2u].rgb;
		let T = vertices[v * 4u + 3u];		// xy: where on its leaf or petal it is, z: what it is (floraKinds.js: HD)
		var p = P.xyz;
		let flags = u32(K1.w);
		// (out of its season a flower's head is folded away into nothing, each plant's its own day)
		if (N.w > 0.5 && bloom > UBO.season.x) { p = vec3f(0.0, p.y, 0.0); }
		if ((flags & 2u) != 0u) { color = mix(color, vec3f(0.42, 0.26, 0.10), 0.85 * UBO.season.y); }
		else { color = mix(color, color * vec3f(1.2, 1.0, 0.55), 0.5 * UBO.season.y); }
		if (!isBig) { p.y *= 1.0 - 0.85 * UBO.season.z; }
		color = mix(color, vec3f(0.92, 0.94, 0.97), UBO.season.z * smoothstep(0.3, 1.0, P.w) * select(0.5, 0.85, isBig));
		color *= 0.85 + 0.3 * tone;
		let c = cos(yaw); let s = sin(yaw);
		var local = vec3f(p.x * c - p.z * s, p.y, p.x * s + p.z * c) * size;
		let air = windAt(foot.xz, UBO.windScroll, UBO.windBlow);
		let shiver = sin(UBO.windBlow.w * (2.5 + 2.0 * tone) + tone * 6.2832) * (0.3 + 0.7 * air.z) * UBO.windScroll.w;
		local += vec3f(air.x + 0.3 * shiver, 0.0, air.y + 0.3 * shiver) * UBO.wind.x * P.w * P.w * min(size, 2.0 * UBO.alpine.z) * select(0.35, 0.12, isBig);
		let world = foot + local;
		output.pos = UBO.viewProjectionMatrix * vec4f(world, 1.0);
		output.worldPos = world;
		output.normal = vec3f(N.x * c - N.z * s, N.y, N.x * s + N.z * c);
		output.groundNormal = groundNormal;
		output.color = color;
		output.up = P.w;
		output.distant = distant;
		output.uv = T.xy;
		output.mat = T.z;
		output.seed = tone;
		return output;
	}

	@vertex
	fn vertexSmall(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
		// (its kind from its vertex: each kind's draw starts at its own first vertex. Its own share of the list from that)
		let kind = u32(vertices[vertexIndex * 4u + 2u].w);
		let o = (kind * ${FLORA_CAP}u + instanceIndex) * ${FLORA_INSTANCE}u;
		let A = placed[o]; let B = placed[o + 1u]; let C = placed[o + 2u];
		let gn = vec3f(C.x, sqrt(max(1.0 - C.x * C.x - C.y * C.y, 0.0)), C.y);
		return plantVertex(kind, vertexIndex, A.xyz, B.x, B.y, B.z, C.z, gn, B.w, false);
	}

	@vertex
	fn vertexBig(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
		let A = big[instanceIndex * 2u];
		let B = big[instanceIndex * 2u + 1u];
		let distant = saturate(length(A.xz - UBO.cameraPosition.xz) / UBO.grid.y);
		let K0 = kinds[u32(A.w) * 3u];
		if (vertexIndex >= u32(K0.y)) { var none: VertexOutput; none.pos = vec4f(2.0, 2.0, 2.0, 1.0); return none; }
		return plantVertex(u32(A.w), u32(K0.x) + vertexIndex, A.xyz, B.x, B.y * UBO.alpine.z, B.z, random(instanceIndex * 2654435761u + 17u), terrainNormal(A.xz), distant, true);
	}

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;
	${skyLookupShapes}

	struct FragInput {
		@location(0) worldPos: vec3f,
		@location(1) normal: vec3f,
		@location(2) groundNormal: vec3f,
		@location(3) color: vec3f,
		@location(4) up: f32,
		@location(5) distant: f32,
		@location(6) uv: vec2f,
		@location(7) @interpolate(flat) mat: f32,
		@location(8) @interpolate(flat) seed: f32,
	};

	/*
		THE HD TEXTURES (HD Textures and Models): what is drawn on a leaf, a petal, a frond, a blade, a mass of leaves, moss and stone,
		from where on it the pixel is (uv) and what it is (mat, floraKinds.js: HD). A shade to multiply its color by, worked out
		here, nothing read from a picture:
			a leaf			its midrib, the veins off it either side out towards its tip, darker round its edge, lighter towards its tip
			a leaflet		lighter towards its tip, with its own midrib
			a petal			streaks out from the middle, deeper towards it, and its tip paler
			a blade			drier and paler up towards its tip
			a mass of leaves	small leaves all over it, each its own shade, darker in the gaps between
			moss			fine speckle, with the odd paler tip
			stone			speckled grain, and spots of lichen
	*/
	fn hdHash(p: vec2f) -> f32 {
		return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
	}
	fn hdShade(mat: f32, uv: vec2f, seed: f32) -> vec3f {
		if (mat < 0.5) { return vec3f(1.0, 1.0, 1.0); }
		if (mat < 1.5) {
			let across = abs(uv.y);
			let rib = 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.09, across));
			let lines = abs(fract(uv.x * 5.0 - across * 1.3 + seed * 3.0) - 0.5);
			let veins = 1.0 + 0.14 * (1.0 - smoothstep(0.0, 0.07, lines)) * step(0.1, across);
			let edge = mix(1.0, 0.8, smoothstep(0.72, 1.0, across));
			return vec3f(1.0, 1.0, 1.0) * rib * veins * edge * mix(0.88, 1.1, uv.x);
		}
		if (mat < 2.5) {
			let tip = abs(uv.y);
			return vec3f(1.0, 1.0, 1.0) * mix(0.85, 1.12, tip) * (1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.1, abs(fract(uv.x * 7.0) - 0.5))));
		}
		if (mat < 3.5) {
			let streaks = 0.86 + 0.14 * cos(uv.y * 9.0 + seed * 6.0);
			let deep = mix(vec3f(0.72, 0.62, 0.5), vec3f(1.0, 1.0, 1.0), smoothstep(0.0, 0.45, uv.x));
			return deep * streaks * mix(1.0, 1.12, smoothstep(0.7, 1.0, uv.x));
		}
		if (mat < 4.5) {
			return mix(vec3f(0.85, 0.85, 0.85), vec3f(1.12, 1.08, 0.86), saturate(uv.x));
		}
		if (mat < 5.5) {
			let g = uv * vec2f(9.0, 7.0) + vec2f(seed * 13.0, seed * 7.0);
			let cell = floor(g);
			let f = fract(g) - vec2f(0.5, 0.5) - (vec2f(hdHash(cell), hdHash(cell + vec2f(3.1, 1.7))) - vec2f(0.5, 0.5)) * 0.5;
			let leafy = 1.0 - smoothstep(0.25, 0.5, length(f * vec2f(1.0, 1.6)));
			return vec3f(1.0, 1.0, 1.0) * (0.78 + 0.4 * hdHash(cell + vec2f(7.0, 2.0))) * mix(0.68, 1.06, leafy);
		}
		if (mat < 6.5) {
			let g = floor(uv * 34.0);
			return vec3f(1.0, 1.0, 1.0) * (0.8 + 0.35 * hdHash(g)) * mix(1.0, 1.35, step(0.93, hdHash(g + vec2f(5.0, 3.0))));
		}
		let g = floor(uv * 26.0);
		let lichen = step(0.9, hdHash(floor(uv * 6.0) + vec2f(seed * 10.0, 1.0)));
		return mix(vec3f(1.0, 1.0, 1.0) * (0.84 + 0.3 * hdHash(g)), vec3f(1.25, 1.25, 0.85), lichen * 0.6);
	}

	// (into the sun's shadow maps, sunShadows.js: nothing to work out, its depth is all)
	@fragment
	fn fragmentShadow(input: FragInput) {
	}

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let toCamera = normalize(Lights.camPos.xyz - input.worldPos);
		var n = normalize(input.normal);
		if (dot(n, toCamera) < 0.0) { n = -n; }
		let N = normalize(mix(n, normalize(input.groundNormal), mix(0.35, 0.9, smoothstep(0.05, 0.5, input.distant))));
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.1 + daylight * (0.34 + 0.72 * saturate(dot(N, L)) * sunShadow(input.worldPos, L));		// (THE SUN'S SHADOWS)
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		let amongst = 0.6 + 0.4 * input.up;
		var albedo = input.color;
		if (UBO.fill2.z > 0.5) { albedo *= hdShade(input.mat, input.uv, input.seed); }
		var color = albedo * amongst * (light * sunTint + moonLight(N));
		if (UBO.grid.w > 0.5) {
			let to = input.worldPos - Lights.camPos.xyz;
			color = mix(color, fogColorAt(to), 1.0 - exp(-pow(length(to) / UBO.grid.z, 2.0)));
		}
		return vec4f(color, 1.0);
	}
`;
