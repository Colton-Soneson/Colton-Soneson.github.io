import { FOLIAGE_LEAVES, FOLIAGE_FROND, FOLIAGE_TUFT } from '../../code/treeGenerator.js';

export const FOLIAGE_VERTICES = 18;		// every piece of foliage is 3 flat cards, 2 triangles each
export const BILLBOARD_VERTICES = 12;	// a billboard is 2 cards: the tree from the side and from above

/*
	The forest. See treeGenerator.js for what a tree is made of and forest.js for what is drawn when.

	HIERARCHICAL INSTANCING
		Nothing here has a vertex buffer. What the GPU holds is a hierarchy, and every level of it is stored once:
			the forest			a list of trees: where each one stands, how old it is, which archetype it is
			an archetype		one full grown tree of a species, as a list of parts: arc sections (the wood) and pieces of foliage
			a part				a tube or three cards, which the vertex shader makes out of nothing but the vertex number
		A draw call is "these trees x these parts". One instance is one part of one tree, so the instance number is split in two:
			which tree = instance / parts per tree			which part = instance % parts per tree
		Ten thousand trees share a dozen archetypes, so a tree costs 64 bytes however many branches it has.

	TESSELLATION
		WebGPU has no tessellation shaders, so the same job is done the way the grass does without mesh shaders: an arc section is
		stored as a curve (3 points and 2 radii) and the vertex shader builds the tube around it, with as many sides and as many
		rings along the curve as the draw call asks for. forest.js asks for a lot on a thick trunk next to the camera and
		for very little on a twig far away (see TESSELLATION in forest.js). The curve is the same, only how finely it is cut changes.

	BILLBOARDS
		Far enough away a tree is a few dozen pixels, and drawing thousands of those branch by branch is a waste. So each
		archetype has its picture taken at start up, at a few ages, from the side and from above (the bake: the same shaders
		as below, drawing into a texture). A far tree is then 2 flat cards with those pictures on. The pictures dont hold the
		tree as it was lit, they hold what it is made of: its color, which way each pixel faces, and how deep into the tree it is.
		So a billboard is lit every frame by the same sums as the real tree, and follows the sun (see vf_forestBillboard).

	GROWING
		Every part knows the age of the tree at which it is born. A part that isnt born yet is not drawn, one that is part way
		through being born is drawn part way along its curve, and everything gets thicker the longer ago it was born.
		So the same archetype is the seedling, the sapling and the old tree. Nothing is ever scaled up as a whole.
		A tree's age is not stored, it is worked out from the forest's clock (see treeAge), so every tree grows a little
		every frame without anything being sent to the GPU.

	DYING
		A dead tree keeps the times it died and will fall, on the same clock. From those: its foliage browns and drops piece by
		piece, its wood greys (treeDryness), it turns over about its foot (treeFallen), and it dissolves into the ground (treeGone).
*/

import { windShapes } from './vf_wind.js';
import { moonShapes } from './f_moon.js';

const structs =
`
	struct ForestUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz, and w: time in seconds (for the wind)
		clock : vec4f,				// x: the forest's clock in years, y: wind strength, zw: wind direction
		world : vec4f,				// x: world units in a metre, y: horizon fog distance, z: 1.0 if the atmosphere is on, w: how far the broadleaved trees have turned for the fall, 0 to 1
		atlas : vec4f,				// the billboard pictures. x: how many to a row, y: how many rows, z: how many are side views (the views from above come after), w: ages per archetype
		bake : vec4f,				// only while a billboard is being baked. x: the view (1.0 from the side, 2.0 from above), y: half the depth of the view, z: its height
		life : vec4f,				// x: how long a dead tree takes to fall over, y: and then to go back into the ground. Years of the forest's clock
		windScroll : vec4f,			// these two are what windAt takes, see vf_wind.js
		windBlow : vec4f,
	}
	@group(0) @binding(0) var<uniform> UBO: ForestUniforms;

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

	// one tree of the forest
	struct Tree
	{
		position : vec4f,	// xyz: where it stands, w: which way it is turned (radians)
		life : vec4f,		// x, y: its age in years is x + y * the forest's clock. z: when it died, w: when it falls (on the forest's clock, a huge number while it lives)
		shape : vec4f,		// x: its size next to the average, y: which archetype it is, zw: how far it leans (sideways per unit of height)
		more : vec4f,		// x: how it falls (see toWorldDirection), y: its own random number, z: how many years it takes to dry out, w: how much smaller than a full grown tree it looks (for the level of detail)
	}
	@group(0) @binding(2) var<storage, read> trees: array<Tree>;

	// the trees each draw call draws, as numbers into the list above
	@group(0) @binding(3) var<storage, read> visible: array<u32>;

	// one arc section of an archetype: a quadratic bezier with a radius at each end (buildSections in treeGenerator.js)
	struct Section
	{
		start : vec4f,		// xyz: p0, w: radius at p0 when full grown
		control : vec4f,	// xyz: p1, w: the age p0 is born
		end : vec4f,		// xyz: p2, w: radius at p2 when full grown
		life : vec4f,		// x: the age p2 is born, y: the age the wood is shed, z: distance along the branch at p0, w: level (0 trunk)
	}
	@group(0) @binding(4) var<storage, read> sections: array<Section>;

	// one piece of foliage of an archetype (buildFoliage in treeGenerator.js)
	struct Foliage
	{
		middle : vec4f,		// xyz, w: the age it starts
		u : vec4f,			// xyz: half of the card along the branch, w: the age it is shed
		v : vec4f,			// xyz: half of the card across the branch, w: what it is drawn as
		more : vec4f,		// x: a random number, y: the age it is full size, z: how far back along u it starts from, w: height in the crown
	}
	@group(0) @binding(5) var<storage, read> foliage: array<Foliage>;

	// what is the same for every tree of an archetype
	struct Archetype
	{
		size : vec4f,		// x: the age it is full grown, y: height, z: crown radius, w: height of the bottom of the crown (full grown, world units)
		growth : vec4f,		// xy: c and p of the height curve, z: trunk radius at the ground, w: species
		bark : vec4f,
		barkHigh : vec4f,	// the bark of the upper trunk and the branches
		leaf : vec4f,
		dry : vec4f,
	}
	@group(0) @binding(6) var<storage, read> archetypes: array<Archetype>;

	@group(0) @binding(7) var skyLUT: texture_2d<f32>;
	@group(0) @binding(8) var skySampler: sampler;

	// one billboard picture: an archetype at one age
	struct BillboardCell
	{
		size : vec4f,		// what the picture shows, world units. x: half its width, y: its top, z: its bottom, w: the height the view from above is drawn at
		more : vec4f,		// x: how grown the tree in the picture is (its height as a fraction of full grown)
	}
	@group(0) @binding(9) var<storage, read> billboardCells: array<BillboardCell>;
	@group(0) @binding(10) var billboardColor: texture_2d<f32>;		// rgb: the color of the tree, unlit. a: how much of the pixel is tree
	@group(0) @binding(11) var billboardShape: texture_2d<f32>;		// rg: which way it faces, b: how deep into the tree it is, a: 1.0 leaf to 0.5 wood
	@group(0) @binding(12) var billboardSampler: sampler;

	@group(0) @binding(13) var windTexture: texture_2d<f32>;		// where the gusts are, see wind.js
	@group(0) @binding(14) var windSampler: sampler;

	// what one draw call draws
	struct DrawUniforms
	{
		listStart : u32,		// where its trees start in the visible list
		partStart : u32,		// the first section (or piece of foliage) it draws
		partCount : u32,		// and how many of them, for each tree
		sides : u32,			// tessellation: sides around the tube
		rings : u32,			// and pieces along it
		kept : u32,				// how many of its parts (the first so many) the next level of detail still draws
		foliageSize : f32,		// foliage is drawn this much bigger (the levels of detail that draw less of it draw it larger)
		nextFoliageSize : f32,	// and how much bigger the next level of detail draws it
		fade : vec4f,			// distances. x to y: where it turns into the next level of detail, z to w: where it dissolves away to nothing
	}
	@group(1) @binding(0) var<uniform> Draw: DrawUniforms;
`;

const common =
`
	const PI: f32 = 3.14159265;
	const TWIG_RADIUS: f32 = 0.012;		// metres, the same as in treeGenerator.js
	const OFF_SCREEN: vec4f = vec4f(2.0, 2.0, 2.0, 1.0);	// a part that isnt drawn has every vertex put here, which makes triangles with no area

	//------------------RANDOM-----------------
	fn hash21(p: vec2f) -> f32 {
		return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
	}

	// smooth noise, 0 to 1, that repeats every period along x (so it can wrap right round a trunk with no seam)
	fn wrappedNoise(p: vec2f, period: f32) -> f32 {
		let cell = floor(p);
		let f = fract(p);
		let blend = f * f * (3.0 - 2.0 * f);
		let x0 = cell.x % period;
		let x1 = (cell.x + 1.0) % period;
		let a = hash21(vec2f(x0, cell.y));
		let b = hash21(vec2f(x1, cell.y));
		let c = hash21(vec2f(x0, cell.y + 1.0));
		let d = hash21(vec2f(x1, cell.y + 1.0));
		return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
	}

	//------------------THE TREE-----------------
	fn treeAge(tree: Tree) -> f32 {
		return tree.life.x + tree.life.y * UBO.clock.x;
	}

	// height of a tree at an age as a fraction of its full height: the same curve as heightFraction in treeGenerator.js
	fn heightFraction(archetype: Archetype, age: f32) -> f32 {
		let u = saturate(age / archetype.size.x);
		return pow((1.0 - exp(-archetype.growth.x * u)) / (1.0 - exp(-archetype.growth.x)), archetype.growth.y);
	}

	//------------------DYING-----------------
	// how dried out a dead tree is: 0.0 alive, 1.0 bare
	fn treeDryness(tree: Tree) -> f32 {
		return saturate((UBO.clock.x - tree.life.z) / max(tree.more.z, 0.0001));
	}

	// how far over a dead tree has fallen: 0.0 standing, 1.0 on the ground. Slow to start and fastest as it lands, like anything toppling
	fn treeFallen(tree: Tree) -> f32 {
		let t = saturate((UBO.clock.x - tree.life.w) / UBO.life.x);
		return t * t;
	}

	// and how far a fallen tree has gone back into the ground: 0.0 just landed, 1.0 gone. It lies there a while first
	fn treeGone(tree: Tree) -> f32 {
		return smoothstep(0.35, 1.0, (UBO.clock.x - tree.life.w - UBO.life.x) / UBO.life.y);
	}

	// a direction in the tree's own space to the world: the lean (a shear, the tree is pushed over rather than turned) and then its turn
	fn toWorldDirection(tree: Tree, v: vec3f) -> vec3f {
		let leaned = vec3f(v.x + tree.shape.z * v.y, v.y, v.z + tree.shape.w * v.y);
		let c = cos(tree.position.w);
		let s = sin(tree.position.w);
		let turned = vec3f(c * leaned.x + s * leaned.z, leaned.y, c * leaned.z - s * leaned.x);

		// a dead tree falling: turned about its foot, away from upright and over towards the way it falls.
		//		more.x holds both numbers of the fall: its whole part is the direction (in hundredths of a radian),
		//		its fraction is how far over the tree ends up (in half turns: 0.5 is flat on level ground)
		let fallen = treeFallen(tree);
		if (fallen <= 0.0) {
			return turned;
		}
		let direction = floor(tree.more.x) / 100.0;
		let angle = fallen * fract(tree.more.x) * PI;
		let axis = vec3f(sin(direction), 0.0, -cos(direction));		// level, and square to the way it falls
		return turned * cos(angle) + cross(axis, turned) * sin(angle) + axis * dot(axis, turned) * (1.0 - cos(angle));	// rodrigues' rotation formula
	}

	// and a point: sized, then the same, then moved to where the tree stands. A fallen tree sinks a little as it goes
	fn toWorld(tree: Tree, local: vec3f) -> vec3f {
		return tree.position.xyz + toWorldDirection(tree, local * tree.shape.x) - vec3f(0.0, treeGone(tree) * 2.0 * UBO.world.x, 0.0);
	}

	${windShapes}

	// Wind. How far a point of a tree is pushed, from where it is in the tree: the whole tree bends from its foot (most at the top),
	//		and on top of that every branch waves on its own (most at its end, so by how far out from the trunk it is)
	fn windPush(tree: Tree, archetype: Archetype, local: vec3f) -> vec3f {
		let time = UBO.cameraPosition.w;
		// the wind where the tree stands, from the wind texture (see wind.js): the same gusts that cross the grass get here after it
		let air = windAt(tree.position.xz, UBO.windScroll, UBO.windBlow);
		let hard = length(air.xy);
		let direction = normalize(air.xy + vec2f(0.0001, 0.0));
		let up = saturate(local.y / archetype.size.y);
		let outward = length(local.xz);
		let own = tree.more.y * 6.2832;
		// the tree leans over with the wind and rocks about that lean, each one in its own time
		let bend = hard * (0.62 + 0.3 * sin(time * 1.3 + own) + 0.12 * sin(time * 2.9 + own * 1.7)) * up * up * archetype.size.y * 0.012;
		let lively = 0.35 + 0.65 * hard;	// the branches never quite stop, and thrash in a gust
		let wave = sin(time * 2.1 + own + local.y * 0.4 + outward * 0.7) * outward * 0.035 * lively;
		let blowing = UBO.clock.y * (1.0 - treeFallen(tree));	// a tree on the ground has stopped swaying
		let push = (bend + wave) * blowing * tree.shape.x;
		return vec3f(direction.x * push, sin(time * 1.7 + own + outward) * outward * 0.012 * blowing * lively, direction.y * push);
	}

	// the egg the crown of a tree is taken to be, as the tree stands now. x: its top, y: its bottom (heights above the foot), z: its radius
	fn crownShape(tree: Tree, archetype: Archetype, age: f32) -> vec3f {
		let grown = heightFraction(archetype, age);
		return vec3f(archetype.size.y * tree.shape.x * grown,
					 archetype.size.w * tree.shape.x * grown * grown,			// a young tree is green nearly to the ground
					 archetype.size.z * tree.shape.x * mix(0.25, 1.0, grown));
	}

	/*
		How much sun and sky a point in a tree gets, without a shadow map (the forest is far outside the box the shadow map covers).
		The crown is taken to be an egg shape full of leaves, and the light is dimmed by how far it has to come through that
		to reach the point. So the side of a tree away from the sun is in the shade of its own crown, and the inside is darker
		than the outside.
			crown		the egg, from crownShape
			offset		from the foot of the tree to the point, world space
		Returns x: how much of the sun gets there, y: how much of the sky
	*/
	fn crownLight(crown: vec3f, offset: vec3f) -> vec2f {
		let radii = vec3f(crown.z, max((crown.x - crown.y) * 0.5, 0.01), crown.z);
		let q = (offset - vec3f(0.0, (crown.x + crown.y) * 0.5, 0.0)) / radii;		// in the space where the crown is a ball of radius 1

		let L = normalize(Lights.sunPos.xyz);
		let l = normalize(L / radii);
		// how far along the way to the sun the edge of the ball is: |q + s * l| = 1
		let along = dot(q, l);
		let inside = along * along - (dot(q, q) - 1.0);
		var through = 0.0;
		if (inside > 0.0) {
			let near = -along - sqrt(inside);
			let far = -along + sqrt(inside);
			through = max(far, 0.0) - max(near, 0.0);
		}
		let sun = exp(-through * 1.1);
		let sky = mix(0.45, 1.0, saturate(length(q))) * mix(0.8, 1.0, saturate(q.y * 0.5 + 0.5));
		return vec2f(sun, sky);
	}

	//------------------LEVEL OF DETAIL-----------------
	// the distance the level of detail goes by: how far off the tree is, made further for a small tree. A sapling close by
	//		covers no more of the screen than an old tree a long way off and gets the same detail. forest.js sorts the trees with the same sum
	fn detailDistance(tree: Tree) -> f32 {
		return distance(tree.position.xyz, UBO.cameraPosition.xyz) * tree.more.w;
	}

	// One level of detail turns into the next without a pop: over the last stretch of its distance the parts the next level
	//		wont draw shrink away to nothing, and (for foliage) the ones it will draw swell to the size it draws them.
	//		By the end of the stretch the tree is exactly what the next level draws. 0 = not started, 1 = done
	fn towardsNextLevel(detail: f32) -> f32 {
		return smoothstep(Draw.fade.x, Draw.fade.y, detail);
	}

	// And a tree can dissolve: more and more of its pixels are left out, chosen by a fixed pattern of noise on the screen.
	//		No blending needed. It does where the last level of detail ends, and when it has fallen and is going back into
	//		the ground. How far dissolved a tree is, 0.0 not at all to 1.0 gone
	fn dissolveAmount(tree: Tree, detail: f32) -> f32 {
		return max(smoothstep(Draw.fade.z, Draw.fade.w, detail), treeGone(tree));
	}

	// true = this pixel is left out
	fn dissolved(pixel: vec2f, amount: f32) -> bool {
		let noise = fract(52.9829189 * fract(0.06711056 * pixel.x + 0.00583715 * pixel.y));	// interleaved gradient noise (Jimenez)
		return noise >= 1.0 - amount;
	}

	//------------------LIGHT-----------------
	const HORIZON_LIFT: f32 = 0.016;	// see f_water

	// The color the sky pass puts on screen for a world direction, the same lookup as f_sky, f_water and the terrain use
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

	// the same light as the terrain: a little at night, sky light through the day, and the sun on top where it reaches.
	//		diffuse: how much the surface faces the sun, light: from crownLight
	fn lit(albedo: vec3f, diffuse: f32, light: vec2f, worldPos: vec3f) -> vec3f {
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let amount = 0.09 + daylight * (0.34 * light.y + 0.72 * diffuse * light.x);
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		// (and the moon's, by how much sky the point can see: there is no telling here which way the surface faces)
		var color = albedo * (amount * sunTint + moonGlow() * 0.2 * light.y);

		// and the same fade into the horizon
		if (UBO.world.z > 0.5) {
			let toTree = worldPos - Lights.camPos.xyz;
			let horizonColor = skyColorAt(vec3f(toTree.x, HORIZON_LIFT * length(toTree.xz), toTree.z));
			let fog = 1.0 - exp(-pow(length(toTree) / UBO.world.y, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return color;
	}

	// every tree a slightly different green: one a bit yellower, the next a bit bluer
	fn treeTint(treeRandom: f32) -> vec3f {
		return mix(vec3f(1.12, 1.02, 0.78), vec3f(0.88, 1.0, 1.12), treeRandom);
	}

	// The fall. Every tree turns its own color (yellow, orange, the odd deep red) and in its own time: some are well on
	//		before others have started. The color is as light or dark as the leaf was, so the shading of the crown is kept.
	//		amount: how far the fall has come on, 0 to 1 (0 for a conifer, which does not turn)
	fn autumnLeaf(leaf: vec3f, treeRandom: f32, amount: f32) -> vec3f {
		let early = fract(treeRandom * 3.71);
		let turned = smoothstep(0.55 * early, 0.55 * early + 0.45, amount);
		let hue = fract(treeRandom * 7.31);
		var color = mix(vec3f(0.88, 0.64, 0.1), vec3f(0.86, 0.38, 0.06), smoothstep(0.2, 0.6, hue));
		color = mix(color, vec3f(0.62, 0.13, 0.07), smoothstep(0.7, 0.95, hue));
		return mix(leaf, color * dot(leaf, vec3f(1.0, 1.0, 1.0)) * 1.25, turned);
	}

	// foliage lit. N: which way it faces
	fn litLeaf(albedo: vec3f, N: vec3f, light: vec2f, worldPos: vec3f) -> vec3f {
		let L = normalize(Lights.sunPos.xyz);
		// leaves are soft and let light through, so the light wraps round further than it would on something solid
		let diffuse = saturate((dot(N, L) + 0.4) / 1.4);
		let color = lit(albedo, diffuse, light, worldPos);

		// and looking towards the sun through the edge of a crown the leaves glow, lit from behind
		let toCamera = normalize(Lights.camPos.xyz - worldPos);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let glow = pow(saturate(dot(-toCamera, L)), 5.0) * light.x * daylight;
		let fog = 1.0 - exp(-pow(distance(Lights.camPos.xyz, worldPos) / UBO.world.y, 2.0));
		return color + albedo * vec3f(1.3, 1.25, 0.6) * glow * 0.45 * (1.0 - fog);
	}

	//------------------BAKING BILLBOARDS-----------------
	// What a pixel of a billboard picture keeps, so that it can be lit again later with the sun anywhere (see vf_forestBillboard).
	//		The tree being baked stands at the origin, so a world position is also the offset from its foot. leaf: 1.0 foliage, 0.5 wood
	struct BakeOutput {
		@location(0) color: vec4f,
		@location(1) shape: vec4f,
	};

	fn baked(albedo: vec3f, normal: vec3f, worldPos: vec3f, leaf: f32) -> BakeOutput {
		// in the picture's own directions: x to its right, y up it, z out of it towards the camera that took it.
		//		the side view looks along -z, so those are the world's. The view from above has the world's -z up the picture and looks down y
		var facing = normal;
		var depth = worldPos.z / UBO.bake.y * 0.5 + 0.5;
		if (UBO.bake.x > 1.5) {
			facing = vec3f(normal.x, -normal.z, normal.y);
			depth = worldPos.y / UBO.bake.z;
		}
		var output: BakeOutput;
		output.color = vec4f(albedo, 1.0);
		output.shape = vec4f(facing.xy * 0.5 + vec2f(0.5, 0.5), saturate(depth), leaf);
		return output;
	}
`;

/*
	The wood. Each instance is one arc section of one tree, each vertex a point on the tube around it.
	The tube is a grid: Draw.rings pieces along the curve, Draw.sides around it, 2 triangles to a square of the grid.
*/
export const vf_forestWood = structs + common +
`
	struct WoodOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) normal: vec3f,
		@location(2) bark: vec3f,			// x: around the trunk 0 to 1, y: metres along the branch, z: radius in metres
		@location(3) light: vec2f,			// sun and sky reaching it, see crownLight
		@location(4) up: f32,				// 0 at the foot of the tree to 1 at the top of a full grown one
		@location(5) @interpolate(flat) archetype: u32,
		@location(6) @interpolate(flat) dissolve: f32,		// see dissolveAmount
		@location(7) @interpolate(flat) treeRandom: f32,
		@location(8) @interpolate(flat) dry: f32,			// see treeDryness
	};

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> WoodOutput {
		var output: WoodOutput;
		output.pos = OFF_SCREEN;

		//------------------WHICH PART OF WHICH TREE-----------------
		let tree = trees[visible[Draw.listStart + instanceIndex / Draw.partCount]];
		let part = instanceIndex % Draw.partCount;
		let section = sections[Draw.partStart + part];
		let archetypeIndex = u32(tree.shape.y);
		let archetype = archetypes[archetypeIndex];
		let age = treeAge(tree);

		//------------------IS IT THERE YET-----------------
		let bornStart = section.control.w;
		let bornEnd = section.life.x;
		if (age <= bornStart || age >= section.life.y) {
			return output;
		}
		// level of detail: the thinner wood, which the next level leaves out, thins away to nothing on the way there
		let detail = detailDistance(tree);
		let kept = select(1.0 - towardsNextLevel(detail), 1.0, part < Draw.kept);
		if (kept <= 0.0) {
			return output;
		}
		// part way through growing: the tube only runs as far along the curve as the tree has got
		let grownTo = saturate((age - bornStart) / max(bornEnd - bornStart, 0.0001));

		//------------------WHICH VERTEX OF THE TUBE-----------------
		// 6 vertices to a square of the grid: (0,0) (1,0) (0,1), (0,1) (1,0) (1,1)
		let square = vertexIndex / 6u;
		let corner = vertexIndex % 6u;
		let cornerSide = u32(corner == 1u || corner == 4u || corner == 5u);
		let cornerRing = u32(corner == 2u || corner == 3u || corner == 5u);
		let around = f32(square % Draw.sides + cornerSide) / f32(Draw.sides);			// 0 to 1 round the tube
		// 0 to 1 along the curve, and a touch over at both ends: neighbouring sections overlap by a hair, so no crack shows where they meet
		let t = mix(-0.012, 1.012, f32(square / Draw.sides + cornerRing) / f32(Draw.rings)) * grownTo;

		//------------------THE CURVE-----------------
		let p0 = section.start.xyz;
		let p1 = section.control.xyz;
		let p2 = section.end.xyz;
		let middle = mix(mix(p0, p1, t), mix(p1, p2, t), t);
		let heading = normalize(mix(p1 - p0, p2 - p1, t));

		// two directions across the curve to build the ring on. Both come from one fixed direction for the whole section,
		//		so the rings of a section all line up and the tube isnt twisted
		let chord = normalize(p2 - p0);
		let fixed = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(chord.y) > 0.9);
		let across1 = normalize(cross(fixed, heading));
		let across2 = cross(heading, across1);
		let outwards = across1 * cos(around * 2.0 * PI) + across2 * sin(around * 2.0 * PI);

		//------------------HOW THICK-----------------
		// wood gets thicker every year. It starts at twig thickness when it is born and reaches the radius it was given when
		//		the tree is full grown, and an old tree carries on thickening slowly after that
		let metre = UBO.world.x;
		let fullGrown = archetype.size.x;
		let born = mix(bornStart, bornEnd, t);
		let thickened = pow(saturate((age - born) / max(fullGrown - born, 0.001)), 0.9) * (1.0 + 0.3 * saturate((age - fullGrown) / fullGrown));
		var radius = TWIG_RADIUS * metre + max(mix(section.start.w, section.end.w, t) - TWIG_RADIUS * metre, 0.0) * thickened;

		// the foot of the trunk isnt round: it swells out into the roots. Only shows where there are sides enough to carry it
		if (section.life.w < 0.5) {
			let foot = exp(-middle.y / (0.022 * archetype.size.y));
			radius *= 1.0 + 0.16 * foot * sin(around * 2.0 * PI * 5.0 + tree.more.y * 40.0);
		}

		// a twig far away is thinner than a pixel and would flicker in and out. Never let it get thinner than about half a pixel
		let centre = toWorld(tree, middle) + windPush(tree, archetype, middle);
		radius = max(radius * tree.shape.x, distance(centre, UBO.cameraPosition.xyz) * 0.0006) * kept;

		let normal = normalize(toWorldDirection(tree, outwards));
		let position = centre + normal * radius;

		output.pos = UBO.viewProjectionMatrix * vec4f(position, 1.0);
		output.worldPos = position;
		output.normal = normal;
		output.bark = vec3f(around, (section.life.z + t * distance(p0, p2)) / metre, radius / metre);
		output.light = crownLight(crownShape(tree, archetype, age), position - tree.position.xyz);
		output.up = middle.y / archetype.size.y;
		output.archetype = archetypeIndex;
		output.dissolve = dissolveAmount(tree, detail);
		output.dry = treeDryness(tree);
		output.treeRandom = tree.more.y;
		return output;
	}

	//same as vertexoutput without builtin bits
	struct WoodInput {
		@builtin(position) pixel: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) normal: vec3f,
		@location(2) bark: vec3f,
		@location(3) light: vec2f,
		@location(4) up: f32,
		@location(5) @interpolate(flat) archetype: u32,
		@location(6) @interpolate(flat) dissolve: f32,		// see dissolveAmount
		@location(7) @interpolate(flat) treeRandom: f32,
		@location(8) @interpolate(flat) dry: f32,			// see treeDryness
	};

	fn barkColor(input: WoodInput) -> vec3f {
		let archetype = archetypes[input.archetype];

		//------------------BARK-----------------
		// ridges running up the trunk, about 5cm wide: so more of them round a thick trunk than a thin branch
		let ridges = max(round(2.0 * PI * input.bark.z / 0.05), 3.0);
		let grain = wrappedNoise(vec2f(input.bark.x * ridges, input.bark.y * 1.6), ridges);
		let blotch = wrappedNoise(vec2f(input.bark.x * 3.0, input.bark.y * 0.35 + input.treeRandom * 50.0), 3.0);
		let thick = smoothstep(0.02, 0.12, input.bark.z);		// twigs are smooth, the furrows come with age

		// the upper trunk and the branches have younger, thinner bark (on a pine it is the orange of the top of the tree)
		var albedo = mix(archetype.bark.rgb, archetype.barkHigh.rgb, smoothstep(0.4, 0.72, input.up));
		albedo *= mix(1.0, 0.62 + 0.6 * grain, thick) * (0.85 + 0.3 * blotch);
		if (archetype.growth.w > 2.5) {
			// birch: white, with dark bands across it, and dark and furrowed like any other tree at the foot of an old one
			let bands = wrappedNoise(vec2f(input.bark.x * 4.0, input.bark.y * 5.0), 4.0) * wrappedNoise(vec2f(input.bark.x * 2.0, input.bark.y * 1.3 + 7.0), 2.0);
			let dark = max(smoothstep(0.34, 0.44, bands), thick * (1.0 - smoothstep(0.02, 0.09, input.up)) * smoothstep(0.35, 0.6, grain));
			albedo = mix(albedo, vec3f(0.1, 0.09, 0.08), dark * 0.9);
		}
		// dead wood weathers to grey as it dries
		let grey = dot(albedo, vec3f(0.4, 0.4, 0.4)) * vec3f(1.05, 1.0, 0.94);
		return mix(albedo, grey, 0.7 * input.dry);
	}

	@fragment
	fn fragmentMain(input: WoodInput) -> @location(0) vec4f {
		if (dissolved(input.pixel.xy, input.dissolve)) {
			discard;
		}
		let L = normalize(Lights.sunPos.xyz);
		let diffuse = saturate(dot(normalize(input.normal), L));
		return vec4f(lit(barkColor(input), diffuse, input.light, input.worldPos), 1.0);
	}

	// for a billboard picture: what it is, not how it is lit
	@fragment
	fn fragmentBake(input: WoodInput) -> BakeOutput {
		return baked(barkColor(input), normalize(input.normal), input.worldPos, 0.5);
	}
`;

/*
	The foliage. Each instance is one piece of foliage of one tree: 3 flat cards, and the fragment shader draws the leaves or
	the needles on them and throws away the pixels in between.
		broad leaves, pine tufts	3 cards through one middle, at right angles to each other: a clump that looks the same from anywhere
		spruce fronds				1 card flat along the branch, and 2 hanging from the branch either side of it, like a roof
*/
export const vf_forestFoliage = structs + common +
`
	struct FoliageOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) cardNormal: vec3f,
		@location(2) crownNormal: vec3f,	// the way out of the crown from here: lights the tree as one rounded shape instead of as a heap of flat cards
		@location(3) uv: vec2f,
		@location(4) light: vec2f,			// sun and sky reaching it, see crownLight
		@location(5) @interpolate(flat) look: vec4f,		// x: what it is drawn as, y: its random number, z: which of its 3 cards, w: height in the crown
		@location(6) @interpolate(flat) archetype: u32,
		@location(7) @interpolate(flat) dissolve: f32,		// see dissolveAmount
		@location(8) @interpolate(flat) treeRandom: f32,
		@location(9) @interpolate(flat) dry: f32,			// see treeDryness
	};

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> FoliageOutput {
		var output: FoliageOutput;
		output.pos = OFF_SCREEN;

		//------------------WHICH PART OF WHICH TREE-----------------
		let tree = trees[visible[Draw.listStart + instanceIndex / Draw.partCount]];
		let part = instanceIndex % Draw.partCount;
		let piece = foliage[Draw.partStart + part];
		let archetypeIndex = u32(tree.shape.y);
		let archetype = archetypes[archetypeIndex];
		let age = treeAge(tree);

		//------------------IS IT THERE YET-----------------
		if (age <= piece.middle.w || age >= piece.u.w) {
			return output;
		}
		// level of detail: the pieces the next level leaves out shrink away on the way there, the ones it keeps swell to cover for them
		let detail = detailDistance(tree);
		let next = towardsNextLevel(detail);
		let detailSize = select(Draw.foliageSize * (1.0 - next), mix(Draw.foliageSize, Draw.nextFoliageSize, next), part < Draw.kept);
		if (detailSize <= 0.0) {
			return output;
		}
		// it starts small at the point of the branch before its own, and rides the growing tip out to its place
		let grown = saturate((age - piece.middle.w) / max(piece.more.y - piece.middle.w, 0.0001));
		let kind = piece.v.w;
		// a dead tree drops its foliage as it dries: every piece at its own moment, shrivelling up as it goes
		let dry = treeDryness(tree);
		let dropsAt = 0.35 + 0.6 * piece.more.x;
		let hanging = 1.0 - smoothstep(dropsAt - 0.2, dropsAt, dry);
		if (hanging <= 0.0) {
			return output;
		}
		let size = mix(0.35, 1.0, grown) * detailSize * sqrt(hanging);
		let along = normalize(piece.u.xyz);
		var middle = piece.middle.xyz - along * piece.more.z * (1.0 - grown);

		//------------------WHICH CARD, WHICH CORNER-----------------
		let card = vertexIndex / 6u;
		let corner = vertexIndex % 6u;
		let cornerX = f32(corner == 1u || corner == 4u || corner == 5u);
		let cornerY = f32(corner == 2u || corner == 3u || corner == 5u);

		var u = piece.u.xyz;
		var v = piece.v.xyz;
		let w = normalize(cross(u, v)) * length(v);		// the third direction, at right angles to the card
		if (kind == ${FOLIAGE_FROND}.0) {
			u *= grown;			// a frond is as long as the piece of branch it is on has got
			v *= size;
			if (card > 0u) {
				// the two hanging sides: from the branch outwards and down
				let side = f32(card) * 2.0 - 3.0;
				v = (normalize(piece.v.xyz) * side * 0.5 + vec3f(0.0, -0.87, 0.0)) * length(v) * 0.75;
				middle += v;
			}
		} else {
			u *= size;
			v *= size;
			if (card == 1u) { v = w * size; }
			if (card == 2u) { u = w * size; }
		}
		let local = middle + u * (cornerX * 2.0 - 1.0) + v * (cornerY * 2.0 - 1.0);

		let push = windPush(tree, archetype, local);
		// leaves flutter on top of the sway of their branch, every card out of step with the next
		let flutter = sin(UBO.cameraPosition.w * 5.3 + piece.more.x * 40.0 + f32(vertexIndex)) * 0.03 * UBO.clock.y * UBO.world.x * (1.0 - dry);
		let position = toWorld(tree, local) + push + vec3f(0.0, flutter, 0.0);

		output.pos = UBO.viewProjectionMatrix * vec4f(position, 1.0);
		output.worldPos = position;
		output.cardNormal = normalize(toWorldDirection(tree, cross(u, v)));
		// out from a point on the trunk, a bit under half way up the tree as it stands now
		let heart = vec3f(0.0, archetype.size.y * heightFraction(archetype, age) * 0.45, 0.0);
		output.crownNormal = normalize(toWorldDirection(tree, local - heart));
		output.uv = vec2f(cornerX, cornerY);
		output.light = crownLight(crownShape(tree, archetype, age), position - tree.position.xyz);
		output.look = vec4f(kind, piece.more.x, f32(card), piece.more.w);
		output.archetype = archetypeIndex;
		output.dissolve = dissolveAmount(tree, detail);
		output.dry = treeDryness(tree);
		output.treeRandom = tree.more.y;
		return output;
	}

	//------------------WHAT IS DRAWN ON A CARD-----------------
	// each returns x: 1.0 where there is leaf and 0.0 where there is a gap, y: a shade for that leaf

	// One layer of broad leaves. The card is cut into square cells and each cell holds one leaf: a pointed oval, turned and nudged at random
	fn leafLayer(uv: vec2f, cells: f32, seed: f32) -> vec2f {
		let grid = uv * cells;
		let cell = floor(grid) + vec2f(seed, seed * 1.7);
		let turn = hash21(cell) * 2.0 * PI;
		let nudge = vec2f(hash21(cell + vec2f(5.2, 1.3)), hash21(cell + vec2f(9.1, 7.7))) - vec2f(0.5, 0.5);
		let p = fract(grid) - vec2f(0.5, 0.5) - nudge * 0.36;
		// the leaf's own axes: -1 at the stalk to 1 at the tip, and across. Every leaf its own size
		let leafSize = 0.2 + 0.12 * hash21(cell + vec2f(2.9, 4.1));
		let lengthways = (p.x * cos(turn) + p.y * sin(turn)) / leafSize;
		let across = (p.y * cos(turn) - p.x * sin(turn)) / leafSize;
		let width = 0.5 * (1.0 - lengthways * lengthways) * (1.0 - 0.3 * lengthways);	// widest below the middle, a point at the tip
		let leaf = step(abs(lengthways), 1.0) * step(abs(across), width);
		let rib = 1.0 - 0.22 * (1.0 - smoothstep(0.0, 0.07, abs(across)));	// the darker line of the midrib
		return vec2f(leaf, (0.78 + 0.44 * hash21(cell + vec2f(3.3, 8.8))) * rib);
	}

	// broad leaves: two layers of them, the second out of step with the first, inside a round clump
	fn leaves(uv: vec2f, seed: f32) -> vec2f {
		let first = leafLayer(uv, 6.0, seed * 13.0);
		// (turned, so its cells dont line up with the first layer's)
		let second = leafLayer(vec2f(uv.x * 0.8 + uv.y * 0.6, uv.y * 0.8 - uv.x * 0.6) + vec2f(0.37, 0.61), 5.0, seed * 29.0 + 3.0);
		let clump = step(distance(uv, vec2f(0.5, 0.5)), 0.5);
		return vec2f(max(first.x, second.x) * clump, mix(second.y * 0.85, first.y, first.x));
	}

	// a spruce frond: the twig down the middle, side shoots slanting off it towards the tip, and the needles breaking those up
	fn frond(uv: vec2f, seed: f32) -> vec2f {
		let along = uv.x;						// 0 the trunk end, 1 the tip end
		let across = abs(uv.y * 2.0 - 1.0);		// 0 on the twig, 1 at the edge of the card
		let shoots = fract(along * 7.0 - across * 1.5 + seed);
		// the needles: fine teeth along both edges of every shoot
		let needles = hash21(vec2f(floor(across * 26.0), floor(along * 7.0 - across * 1.5 + seed) + seed * 91.0));
		let reach = (1.0 - 0.6 * along * along) * (0.75 + 0.25 * hash21(vec2f(floor(along * 7.0 - across * 1.5 + seed), seed)));
		let spray = step(abs(shoots - 0.4), 0.22 + 0.16 * needles) * step(across, reach);
		let twig = step(across, 0.04);
		return vec2f(max(spray, twig), mix(0.7 + 0.5 * needles, 0.55, twig * (1.0 - spray)));
	}

	// pine needles: bursts of long needles fanning out from a point, one burst to a cell
	fn tuft(uv: vec2f, seed: f32) -> vec2f {
		let grid = uv * 3.0;
		let cell = floor(grid) + vec2f(seed * 17.0, seed * 5.0);
		let p = fract(grid) - vec2f(0.5, 0.5) - (vec2f(hash21(cell), hash21(cell + vec2f(4.4, 2.2))) - vec2f(0.5, 0.5)) * 0.2;
		let outward = length(p);
		let angle = atan2(p.y, p.x) / (2.0 * PI) + 0.5;
		let needle = fract(angle * 15.0 + hash21(cell + vec2f(1.1, 6.6)));
		let burst = step(needle, 0.45) * step(outward, 0.47 - 0.12 * hash21(cell + vec2f(floor(angle * 15.0), 0.0)));
		let clump = step(distance(uv, vec2f(0.5, 0.5)), 0.5);
		return vec2f(burst * clump, 0.75 + 0.45 * hash21(cell + vec2f(floor(angle * 15.0), 2.0)));
	}

	//same as vertexoutput without builtin bits
	struct FoliageInput {
		@builtin(position) pixel: vec4f,
		@builtin(front_facing) front: bool,
		@location(0) worldPos: vec3f,
		@location(1) cardNormal: vec3f,
		@location(2) crownNormal: vec3f,
		@location(3) uv: vec2f,
		@location(4) light: vec2f,
		@location(5) @interpolate(flat) look: vec4f,
		@location(6) @interpolate(flat) archetype: u32,
		@location(7) @interpolate(flat) dissolve: f32,		// see dissolveAmount
		@location(8) @interpolate(flat) treeRandom: f32,
		@location(9) @interpolate(flat) dry: f32,			// see treeDryness
	};

	// rgb: the color of the foliage at this pixel, before the tree's own tint. a: 0.0 in the gaps between the leaves
	fn foliageColor(input: FoliageInput) -> vec4f {
		var drawn: vec2f;
		let seed = input.look.y + input.look.z * 0.31;
		if (input.look.x == ${FOLIAGE_FROND}.0) {
			drawn = frond(input.uv, seed);
		} else if (input.look.x == ${FOLIAGE_TUFT}.0) {
			drawn = tuft(input.uv, seed);
		} else {
			drawn = leaves(input.uv, seed);
		}
		// every clump a different shade, and the top of the crown lighter than the bottom
		let albedo = archetypes[input.archetype].leaf.rgb * drawn.y * (0.82 + 0.36 * input.look.y) * mix(0.8, 1.12, input.look.w);
		return vec4f(albedo, drawn.x);
	}

	// a card is flat and seen from both sides. Lit mostly as part of the rounded crown, a little by which way the card itself faces
	fn foliageNormal(input: FoliageInput) -> vec3f {
		var cardNormal = normalize(input.cardNormal);
		if (!input.front) {
			cardNormal = -cardNormal;
		}
		return normalize(mix(cardNormal, normalize(input.crownNormal), 0.7));
	}

	@fragment
	fn fragmentMain(input: FoliageInput) -> @location(0) vec4f {
		if (dissolved(input.pixel.xy, input.dissolve)) {
			discard;
		}
		let leaf = foliageColor(input);
		if (leaf.a < 0.5) {
			discard;
		}
		// the foliage of a dead tree browns before it drops, a clump at a time: the color its species goes, as light or dark as the leaf was
		let archetype = archetypes[input.archetype];
		let brown = archetype.dry.rgb * (dot(leaf.rgb, vec3f(1.0, 1.0, 1.0)) / dot(archetype.leaf.rgb, vec3f(1.0, 1.0, 1.0)));
		let living = autumnLeaf(leaf.rgb * treeTint(input.treeRandom), input.treeRandom, select(0.0, UBO.world.w, archetype.growth.w > 1.5));
		let albedo = mix(living, brown, smoothstep(0.0, 0.5, input.dry * (0.6 + 0.8 * input.look.y)));
		return vec4f(litLeaf(albedo, foliageNormal(input), input.light, input.worldPos), 1.0);
	}

	// for a billboard picture: what it is, not how it is lit
	@fragment
	fn fragmentBake(input: FoliageInput) -> BakeOutput {
		let leaf = foliageColor(input);
		if (leaf.a < 0.5) {
			discard;
		}
		return baked(leaf.rgb, foliageNormal(input), input.worldPos, 1.0);
	}
`;

/*
	The far trees. Each instance is one tree, drawn as 2 cards with its archetype's pictures on them:
		the side view		stands upright on the tree's foot and turns to face the camera (only ever about the upright, so the tree doesnt lean back)
		the view from above	lies flat at the height of the crown. It only shows when the camera is well above the tree,
							where the upright card is seen nearly edge on from the top

	Which picture: an archetype has one for each of a few ages. The tree uses the first one at least as grown as it is, drawn
	smaller by however much less grown it is. So billboards grow smoothly too, and only change picture a few times in a life.

	Lighting: a pixel of the picture says what color the tree is there, which way it faces and how deep into the tree it is, in
	the picture's own directions (see baked). The card knows where those directions point in the world, so each pixel is put
	back where it was in the tree and lit as the real thing is: same crown shading, same sun, same fog.
*/
export const vf_forestBillboard = structs + common +
`
	struct BillboardOutput {
		@builtin(position) pos: vec4f,
		@location(0) uv: vec2f,								// in the atlas
		@location(1) across: vec2f,							// where on the card, world units from the tree's foot. side view: sideways and up. from above: x and -z
		@location(2) @interpolate(flat) foot: vec3f,
		@location(3) @interpolate(flat) towards: vec3f,		// the level direction from the tree to the camera
		@location(4) @interpolate(flat) crown: vec3f,		// see crownShape
		@location(5) @interpolate(flat) look: vec4f,		// x: 0.0 the side view, 1.0 the view from above, y: the tree's random number, z: its detail distance, w: how much the view from above shows
		@location(6) @interpolate(flat) depth: vec2f,		// x: half the depth of the side view, y: the height of the view from above, world units
		@location(7) @interpolate(flat) right: vec3f,		// the side view's own directions in the world: across it,
		@location(8) @interpolate(flat) trunk: vec3f,		//		and up it (straight up, until the tree falls)
		@location(9) @interpolate(flat) dying: vec3f,		// x: see treeDryness, y: see treeGone, z: how far it has turned for the fall (see autumnLeaf)
		@location(10) @interpolate(flat) dryColor: vec4f,	// rgb: the color its foliage dries to, a: how bright its living foliage is, to match
	};

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> BillboardOutput {
		var output: BillboardOutput;

		let tree = trees[visible[Draw.listStart + instanceIndex]];
		let archetypeIndex = u32(tree.shape.y);
		let archetype = archetypes[archetypeIndex];
		let age = treeAge(tree);
		let grown = heightFraction(archetype, age);

		//------------------WHICH PICTURE-----------------
		// the first of its archetype's pictures that is at least as grown as the tree is
		let pictures = u32(UBO.atlas.w);
		var picture = pictures - 1u;
		for (var i = 0u; i < pictures; i++) {
			if (billboardCells[archetypeIndex * pictures + i].more.x >= grown) {
				picture = i;
				break;
			}
		}
		var slot = archetypeIndex * pictures + picture;
		let cell = billboardCells[slot];
		let fit = tree.shape.x * grown / cell.more.x;	// the tree's own size, and smaller by however much less grown it is than its picture

		//------------------WHICH CARD, WHICH CORNER-----------------
		let card = vertexIndex / 6u;
		let corner = vertexIndex % 6u;
		let cornerX = f32(corner == 1u || corner == 4u || corner == 5u);
		let cornerY = f32(corner == 2u || corner == 3u || corner == 5u);

		let foot = tree.position.xyz;
		let toCamera = UBO.cameraPosition.xyz - foot;
		let towards = normalize(vec3f(toCamera.x, 0.0, toCamera.z) + vec3f(0.00001, 0.0, 0.0));
		// the way the trunk points: up (with the tree's lean), until it is dead and falling. The card stands along it,
		//		turned about it to face the camera as squarely as it can
		let trunk = normalize(toWorldDirection(tree, vec3f(0.0, 1.0, 0.0)));
		let right = normalize(cross(trunk, towards) + vec3f(0.00001, 0.0, 0.0));
		let fallen = treeFallen(tree);

		var position: vec3f;
		var across: vec2f;
		if (card == 0u) {
			across = vec2f((cornerX * 2.0 - 1.0) * cell.size.x, mix(cell.size.z, cell.size.y, cornerY)) * fit;
			position = foot + right * across.x + trunk * across.y;
		} else {
			across = vec2f(cornerX * 2.0 - 1.0, cornerY * 2.0 - 1.0) * cell.size.x * fit;
			position = foot + vec3f(across.x, cell.size.w * fit, -across.y);
			slot += u32(UBO.atlas.z);
		}
		// the whole card sways with the tree
		position += windPush(tree, archetype, vec3f(0.0, (position.y - foot.y) / tree.shape.x, 0.0));
		position.y -= treeGone(tree) * 2.0 * UBO.world.x;	// a fallen tree sinks a little as it goes, see toWorld

		output.pos = UBO.viewProjectionMatrix * vec4f(position, 1.0);
		let slotsPerRow = u32(UBO.atlas.x);
		output.uv = (vec2f(f32(slot % slotsPerRow), f32(slot / slotsPerRow)) + vec2f(cornerX, 1.0 - cornerY)) / UBO.atlas.xy;
		output.across = across;
		output.foot = foot;
		output.towards = towards;
		output.crown = crownShape(tree, archetype, age);
		// how far above the tree the camera is: the view from above comes in between about 25 and 50 degrees up
		let above = toCamera.y - cell.size.w * fit;
		// (and not once the tree is falling: that picture is of a standing tree)
		output.look = vec4f(f32(card), tree.more.y, detailDistance(tree), smoothstep(0.42, 0.77, above / length(toCamera)) * (1.0 - fallen));
		output.depth = vec2f(cell.size.x, cell.size.y) * fit;
		output.right = right;
		output.trunk = trunk;
		output.dying = vec3f(treeDryness(tree), treeGone(tree), select(0.0, UBO.world.w, archetype.growth.w > 1.5));
		output.dryColor = vec4f(archetype.dry.rgb, dot(archetype.leaf.rgb, vec3f(1.0, 1.0, 1.0)));
		return output;
	}

	//same as vertexoutput without builtin bits
	struct BillboardInput {
		@builtin(position) pixel: vec4f,
		@location(0) uv: vec2f,
		@location(1) across: vec2f,
		@location(2) @interpolate(flat) foot: vec3f,
		@location(3) @interpolate(flat) towards: vec3f,
		@location(4) @interpolate(flat) crown: vec3f,
		@location(5) @interpolate(flat) look: vec4f,
		@location(6) @interpolate(flat) depth: vec2f,
		@location(7) @interpolate(flat) right: vec3f,
		@location(8) @interpolate(flat) trunk: vec3f,
		@location(9) @interpolate(flat) dying: vec3f,
		@location(10) @interpolate(flat) dryColor: vec4f,
	};

	// interleaved gradient noise (Jimenez): a fixed pattern on the screen, 0 to 1, as even as noise gets
	fn screenNoise(pixel: vec2f) -> f32 {
		return fract(52.9829189 * fract(0.06711056 * pixel.x + 0.00583715 * pixel.y));
	}

	@fragment
	fn fragmentMain(input: BillboardInput) -> @location(0) vec4f {
		let color = textureSample(billboardColor, billboardSampler, input.uv);
		let shape = textureSample(billboardShape, billboardSampler, input.uv);
		let fromAbove = input.look.x > 0.5;

		//------------------IS THIS PIXEL DRAWN-----------------
		// the billboard takes over from the last mesh level of detail pixel by pixel: it draws exactly the pixels that
		//		level leaves out (see dissolved), so between them the tree is always whole. And dissolves itself at the draw distance
		let noise = screenNoise(input.pixel.xy);
		if (noise < 1.0 - smoothstep(Draw.fade.x, Draw.fade.y, input.look.z) || noise >= 1.0 - smoothstep(Draw.fade.z, Draw.fade.w, input.look.z)) {
			discard;
		}
		// a second pattern, so that what follows doesnt line up with the above
		let noise2 = screenNoise(input.pixel.xy + vec2f(47.0, 17.0));
		if (fromAbove && noise2 >= input.look.w) {
			discard;
		}
		// fallen and going back into the ground, the same way the meshes do
		if (noise >= 1.0 - input.dying.y) {
			discard;
		}
		// Far away one pixel of the picture is many leaves and the gaps between them, and its alpha is how much of it is leaf.
		//		Drawing the pixel that share of the time keeps a thin crown thin, where a plain cut off would fill it in or lose it
		if (smoothstep(0.08, 0.55, color.a) <= noise2) {
			discard;
		}

		// A dead tree drops its foliage as it dries. The picture cant lose its leaves one by one, so it loses them in small
		//		patches (the same patches every frame: they are fixed to the picture, not the screen), each at its own moment
		let leaf = saturate(shape.a * 2.0 - 1.0);
		let clump = hash21(floor(input.uv * UBO.atlas.xy * vec2f(12.0, 24.0)));
		if (leaf > 0.5 && input.dying.x > 0.35 + 0.6 * clump) {
			discard;
		}

		//------------------PUT THE PIXEL BACK IN THE TREE-----------------
		let facing = shape.rg * 2.0 - vec2f(1.0, 1.0);
		let outwards = sqrt(saturate(1.0 - dot(facing, facing)));	// the part of the normal that points out of the picture
		var N: vec3f;
		var offset: vec3f;		// from the foot of the tree, world space
		if (fromAbove) {
			N = vec3f(facing.x, outwards, -facing.y);
			offset = vec3f(input.across.x, shape.b * input.depth.y, -input.across.y);
		} else {
			let nearer = cross(input.right, input.trunk);		// out of the picture, towards the camera
			N = input.right * facing.x + input.trunk * facing.y + nearer * outwards;
			offset = input.right * input.across.x + input.trunk * input.across.y + nearer * (shape.b * 2.0 - 1.0) * input.depth.x;
		}
		N = normalize(N);
		let worldPos = input.foot + offset;

		//------------------LIGHT-----------------
		let light = crownLight(input.crown, offset);
		let L = normalize(Lights.sunPos.xyz);
		// drying out: the wood greys and the foliage browns, as on the meshes (see barkColor and the foliage's fragmentMain)
		let grey = dot(color.rgb, vec3f(0.4, 0.4, 0.4)) * vec3f(1.05, 1.0, 0.94);
		let brown = input.dryColor.rgb * (dot(color.rgb, vec3f(1.0, 1.0, 1.0)) / input.dryColor.a);
		let leafColor = mix(autumnLeaf(color.rgb * treeTint(input.look.y), input.look.y, input.dying.z), brown, smoothstep(0.0, 0.5, input.dying.x * (0.6 + 0.8 * clump)));

		let wood = lit(mix(color.rgb, grey, 0.7 * input.dying.x), saturate(dot(N, L)), light, worldPos);
		let leafy = litLeaf(leafColor, N, light, worldPos);
		return vec4f(mix(wood, leafy, leaf), 1.0);
	}
`;

/*
	Shrinks a picture: each pixel of the target is the average of a square block of the source. Used twice over by the
	billboard bake: a tree is drawn several times too big and shrunk into its place in the atlas (which smooths its edges),
	and then the whole atlas is halved again and again to make its mip levels.

	Pixels with no tree in them have no color worth averaging, so everything is weighted by how much tree each source pixel has.
	Otherwise the edges of every tree would be darkened by the empty black around them.
*/
export const vf_forestAtlas =
`
	struct AtlasUniforms
	{
		origin : vec2f,		// the pixel of the target the picture starts at
		shrink : f32,		// source pixels to a target pixel, along each side
		spare : f32,
	}
	@group(0) @binding(0) var<uniform> UBO: AtlasUniforms;
	@group(0) @binding(1) var sourceColor: texture_2d<f32>;
	@group(0) @binding(2) var sourceShape: texture_2d<f32>;

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
		// one triangle big enough to cover the whole target
		return vec4f(f32((vertexIndex << 1u) & 2u) * 2.0 - 1.0, f32(vertexIndex & 2u) * 2.0 - 1.0, 0.0, 1.0);
	}

	struct AtlasOutput {
		@location(0) color: vec4f,
		@location(1) shape: vec4f,
	};

	@fragment
	fn fragmentMain(@builtin(position) pixel: vec4f) -> AtlasOutput {
		let shrink = u32(UBO.shrink);
		let first = vec2u(pixel.xy - UBO.origin) * shrink;
		var color = vec3f(0.0, 0.0, 0.0);
		var shape = vec4f(0.0, 0.0, 0.0, 0.0);
		var covered = 0.0;
		for (var y = 0u; y < shrink; y++) {
			for (var x = 0u; x < shrink; x++) {
				let c = textureLoad(sourceColor, first + vec2u(x, y), 0);
				color += c.rgb * c.a;
				shape += textureLoad(sourceShape, first + vec2u(x, y), 0) * c.a;
				covered += c.a;
			}
		}
		var output: AtlasOutput;
		output.color = vec4f(color / max(covered, 0.0001), covered / f32(shrink * shrink));
		output.shape = shape / max(covered, 0.0001);
		return output;
	}
`;
