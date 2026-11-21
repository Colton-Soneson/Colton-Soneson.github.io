import { skyLUTUVShapes } from './vfc_atmosphere.js';
import { DEPTH_NEAR, DEPTH_FAR, skyTest } from './depthShapes.js';
export const CLOUD_SHAPE_SIZE = 128;		// texels along each side of the shape noise, a cube
export const CLOUD_DETAIL_SIZE = 64;		// and of the detail noise
export const CLOUD_NOISE_WORKGROUP = 4;		// the noise is made in blocks of 4 x 4 x 4 texels
export const CLOUD_MAP_SIZE = 256;			// texels along each side of the cloud coverage map
export const CLOUD_MAP_WORKGROUP = 8;
export const CLOUD_CELLS_SIZE = 512;		// texels along each side of the heaps' map (c_cloudCells)
export const CLOUD_CELLS_WORKGROUP = 8;

/*
	Volumetric clouds, the way they have been done in games since Horizon Zero Dawn (Schneider, "The Real-time Volumetric
	Cloudscapes of Horizon Zero Dawn", 2015) and are in Microsoft Flight Simulator 2020: the clouds are not models, they are
	a density, a number for every point of a slab of sky that says how much cloud is there, and a picture of them is made by
	walking a ray out from every pixel through the slab and adding up what it meets (ray marching).

	THE LAYERS
		low			the one the weather is made of: heaps (cumulus) in fair weather, a lumpy sheet when it is overcast, deep
					dark rain cloud in a storm. Its bottom is well under the height of the mountains, which stand up through it
		middle		small heaps in wide fields, far above the peaks (altocumulus). Thin: there to give the sky depth
		high		ice, higher again. In fair weather cirrus: long fibres combed out by the wind. When it is overcast
					this is the layer that closes over, into one grey sheet from horizon to horizon (cirrostratus), and
					the low cloud under it stays broken
		Each ray walks through all three, in whichever order it meets them: from the ground the low one first, from
		above them all the high one first.

		And now and then a SHELF CLOUD (shelfDensity): a long low wedge of cloud standing off the coast, the front edge of
		weather out at sea. It is part of the low layer and is walked with it.

	WHAT A STORM CAN BRING (weather.js says when)
		a tornado		a funnel of cloud from the bottom of the low layer to the ground (twisterDensity). Walked with
						the low layer, which for as long as there is one is taken to reach all the way down
		a hurricane		not a cloud of its own but a pattern in where the low cloud is: a clear eye, a wall of cloud
						round it, and arms that wind out from the wall (weatherAt)
		lightning		its flash, as light inside the cloud round where it struck (the bolt itself is lightning.js)

	WHERE THERE IS CLOUD (cloudDensity)
		the weather map		a picture laid over the world from above that says, place by place, how much cloud there is.
							It drifts with the wind. The weather (weather.js) says how much of it counts as cloud.
		the heaps			the low layer is not one slab of noise cut off at a height (from above, every top would be at
							that height: a flat floor of cloud). It is heaps, each its own cloud, after Guerrilla's Nubis
							(Schneider, "Nubis, Evolved", 2022) and what Flight Simulator shows: c_cloudCells lays domes over
							the sky every frame, a flat bottom and a rounded top each, every one its own size and height,
							from puffs to towering heaps several times as tall as they are wide, and the billows eat into
							each from its surface (heapDensity). The same map says how far it is to the nearest heap, and the
							march strides across the clear air between them (heapGap): tall clouds cost little more than flat ones
		the deck			on a day thick with cloud (a storm), the sheet the heaps stand up out of (layerDensity)
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

	DYNAMIC RESOLUTION (the march's levels: clouds.js, settings.cloudResolution 0)
		A near cloud fills a lot of the screen and shows every bulb; a far one is a few pixels and soft with haze. So the march is
		made in levels, coarsest first (an eighth or a quarter of the frame's size), each twice as fine as the last, the finest the
		frame's own. Each level's pixels start from the coarser level's: where it met no cloud nearer than the level's reach (LV.size.z:
		twice as far for every halving of the size), its picture is taken up as it is (cheap); where it did, or where the pixel lies on
		the edge of something solid with cloud behind it (the coarser pixels saw past it or into it), it is marched again, finely.
		Each level says how near the cloud it met was (the second target: where the ray had first lost a little of the sky behind).

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
		layer : vec4f,				// x: height of the bottom of the clouds, y: of the top of the tallest heap there can be, z: their size across in x (settings.cloudSizeX), w: half the width of the world
		weather : vec4f,			// x: coverage, y: kind (0 sheet, 0.5 heaps, 1 towers), z: density, w: their size across in z
		scroll : vec4f,				// xy: how far the clouds have drifted, z: 1 / the size of a tile of the weather map, w: gloom (how grey the cloud is)
		tower : vec4f,				// the cumulonimbus. xy: where it stands (x, z), z: its radius, w: how built up it is, 0 none
		screen : vec4f,				// xy: the size of the picture the march draws (half the screen), zw: the two numbers that turn a depth into a distance
		map : vec4f,				// the coverage map. xy: the middle of it (x, z), z: 1 / its width, w: the height its shadows are worked out at
		quality : vec4f,			// x: steps along a ray, y: how far off clouds are drawn, z: where they fade into the haze, w: rain, 0 to 1
		middle : vec4f,				// the middle layer. x: height of its bottom, y: of its top, z: how much of the sky it covers (0 none), w: how thick it is
		shape : vec4f,				// x: how tall a cumulonimbus stands over the bottom of the layer, y: how sharp the edge of a heap is, z: how tall the tallest heap of a fair day is, w: of a towering day
		moon : vec4f,				// xyz: towards the moon, w: the angle from the middle of its disc to its edge, radians
		moonLook : vec4f,			// x: how strongly the disc shows, 0 none
		high : vec4f,				// the high layer. x: height of its bottom, y: of its top, z: how much of it there is (0 none), w: 0 cirrus to 1 a closed sheet
		highLook : vec4f,			// x: how thick it is, y: how much of the sun it lets down on to the layers under it, z: how far off it fades into the haze
		shelf : vec4f,				// the shelf cloud: it lies along part of a circle. xy: the middle of the circle (x, z), z: its radius, w: how built up the cloud is, 0 none
		shelfLook : vec4f,			// x: which way from the middle of the circle the middle of the cloud is (radians, round from +x towards +z), y: half the angle it spans, z: height of its bottom, w: of its top
		tornado : vec4f,			// xy: where it is (x, z), z: the radius of the funnel where it meets the cloud, w: how built up it is, 0 none
		hurricane : vec4f,			// xy: where its eye is (x, z), z: its radius, w: how built up it is, 0 none
		storm : vec4f,				// x: how far the hurricane has turned (radians), y: the tornado's clock (seconds), z: how green the light is, 0 to 1, w: how bright the lightning is at this moment
		strike : vec4f,				// xyz: where in the cloud the lightning's light is, w: how far it spreads
		cells : vec4f,				// the heaps' map (c_cloudCells). xy: its middle, in the clouds' frame (the world less how far they have drifted), z: 1 / its width, w: the width of a texel of it
		heaps : vec4f,				// x: the size of a heap's cell, yz: how far a heap leans downwind (x, z) for every unit up, w: how deep the deck is
		// the look, from the settings of the same names (settings.js: THE HEAPS)
		heapLook : vec4f,			// x: Bulb Size, y: Bulb Depth, z: Edge Thickness, w: Ragged Bottoms
		heapGrow : vec4f,			// x: Heap Amount, y: Small Puffs, z: Heap Width, w: Height Variety
		heapRise : vec4f,			// x: More Towering, y: Steep Sides, z: Lobed Outline, w: Wispy Edges
		deck : vec4f,				// x: Deck From Coverage, y: Stride Clear Air (1 on), z: Sun Walk Steps, w: Shadow Reach
		glow : vec4f,				// x: Silver Lining (g), y: Back Glow (g, under 0), z: Back Glow Share, w: Multiple Scattering
		shade : vec4f,				// x: Self Shadow, y: Dark Crevices, z: Dark Undersides, w: Skylight
		upper : vec4f,				// x: Cirrus Size, y: Middle Size, z: Scatter Reach, w: Fine Detail Fades From
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
	@group(0) @binding(9) var cloudCells: texture_2d<f32>;		// the heaps' map (c_cloudCells)

	const SHAPE_TILE: f32 = 1500.0;		// world size of one tile of the shape noise: a billow is about a third of this (times the clouds' size: shapeSize)
	const DETAIL_TILE: f32 = 380.0;
	// the clouds' size (the settings): the shape noise's tile x, y and z times this. Up and down a little smaller than across, so a heap has
	//		heads one over another up its side, not one billow from its bottom to its top
	//		(the layers' depths take the clouds' height: clouds.js)
	fn shapeSize() -> vec3f { return vec3f(CU.layer.z, 0.7 * sqrt(CU.layer.z * CU.weather.w), CU.weather.w); }
	const CROWN: vec2f = vec2f(0.28, 1.0);		// the lowest a heap's top stands, of the layer's depth (its highest the top of the layer)
	// and the detail noise's: less (a worn edge is fine however big the cloud)
	fn detailSize() -> vec3f { return sqrt(shapeSize()); }
	const SHELF_WIDTH: f32 = 1150.0;	// how far a shelf cloud runs back from its middle line, and forward of it to its front edge

	// left behind by cloudDensity and middleDensity: how far into the body of the cloud the point is, 0 at its edge, before the
	//		fine noise has worn the edges. The light is worked out from it (see "folds" at the top of the file)
	var<private> cloudBody: f32;
	// and by cloudDensity: how much of the cloud at the point is shelf cloud, 0 to 1 (it is lit darker: it stands in the shadow of its own weather)
	var<private> cloudShelf: f32;
	// and how far up its own cloud the point is, 0 its bottom to 1 its top (a heap's own height, not the layer's): it is lit from the
	//		sky above at the top and darkens down to its flat bottom
	var<private> cloudUp: f32;
	// set by the march: how far off the point it is reading is (the fine wear of a heap is let go far off)
	var<private> marchFar: f32;

	fn remap(value: f32, fromLow: f32, fromHigh: f32, toLow: f32, toHigh: f32) -> f32 {
		return toLow + (value - fromLow) / (fromHigh - fromLow) * (toHigh - toLow);
	}

	// how high the clouds can reach anywhere: the top of the layer, or of the thunderhead if there is one
	fn cloudCeiling() -> f32 {
		return max(CU.layer.y, CU.layer.x + CU.shape.x * step(0.001, CU.tower.w));
	}

	// and how low: the bottom of the layer, or of the shelf cloud if there is one and it hangs lower
	fn cloudFloor() -> f32 {
		let withShelf = min(CU.layer.x, mix(CU.layer.x, CU.shelfLook.z, step(0.001, CU.shelf.w)));
		return mix(withShelf, min(withShelf, CU.map.w), step(0.001, CU.tornado.w));		// (a tornado comes all the way down, to the height of the sea)
	}

	fn mountainsUnder(xz: vec2f) -> f32 {
		return textureSampleLevel(mountainMap, clampSampler, (xz + vec2f(CU.layer.w, CU.layer.w)) / (2.0 * CU.layer.w), 0.0).r;
	}

	// The weather over a place. x: how much cloud, 0 to 1. y: what kind. z: how far it is from the middle of the cumulonimbus, in radii of it
	fn weatherAt(xz: vec2f) -> vec3f {
		let map = textureSampleLevel(weatherMap, repeatSampler, (xz - CU.scroll.xy) * CU.scroll.z, 0.0);
		let mountains = textureSampleLevel(mountainMap, clampSampler, (xz + vec2f(CU.layer.w, CU.layer.w)) / (2.0 * CU.layer.w), 0.0).r;

		// the weather map is cloud wherever it is above a line, and the coverage sets the line. Cloud gathers over mountains
		let field = map.r * 0.75 + map.a * 0.25 + 0.06 * mountains;
		// (never quite all the way: heaped cloud always has the shape noise cutting bays and towers into it. A sheet or a rain cloud is let fill in)
		var cover = saturate(remap(field, 1.0 - CU.weather.x, 1.0 - CU.weather.x + 0.3, 0.0, 1.0)) * mix(0.66, 1.0, smoothstep(0.7, 0.95, CU.weather.x));
		var kind = saturate(CU.weather.y + (map.g - 0.5) * 0.35);

		// THE HURRICANE. Inside its radius where the cloud is, is not left to the weather map: it is drawn.
		//		the eye		clear, right in the middle
		//		the wall	a ring of solid cloud round the eye, the tallest cloud in the storm
		//		the arms	two bands of cloud winding out from the wall. The further out along an arm, the further round
		//					it has got (a spiral whose angle grows with the logarithm of the distance, which is what
		//					keeps the arms the same shape at every size), and the whole of it turns
		if (CU.hurricane.w > 0.0) {
			let fromEye = xz - CU.hurricane.xy;
			let outward = length(fromEye) / CU.hurricane.z;		// 0 in the eye, 1 at the outer edge
			if (outward < 1.0) {
				let bearing = atan2(fromEye.y, fromEye.x);
				let arms = 0.5 + 0.5 * sin(2.0 * bearing + 7.5 * log(max(outward, 0.03)) - 2.0 * CU.storm.x);
				let banded = smoothstep(0.3, 0.7, arms + 0.5 * (field - 0.5)) * (1.0 - smoothstep(0.7, 1.0, outward));
				let wall = 1.0 - smoothstep(0.1, 0.34, outward);
				let eye = smoothstep(0.035, 0.06, outward);
				let share = CU.hurricane.w * (1.0 - smoothstep(0.85, 1.0, outward));
				cover = mix(cover, max(wall, banded) * eye, share);
				kind = mix(kind, mix(0.6, 1.0, wall), share);
			}
		}
		return vec3f(cover, kind, distance(xz, CU.tower.xy) / CU.tower.z);
	}

	// how much cloud there is at a height through the layer (0 its bottom, 1 its top), for a kind of cloud
	fn cloudProfile(h: f32, kind: f32) -> f32 {
		let sheet = smoothstep(0.0, 0.06, h) * (1.0 - smoothstep(0.16, 0.32, h));
		// (a heap full up most of its own height: its top is its crown, layerDensity: THE TOPS, rounded off over its last part)
		let heaps = smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.6, 1.0, h));
		let towers = smoothstep(0.0, 0.07, h) * (1.0 - smoothstep(0.7, 1.0, h));
		return mix(mix(sheet, heaps, saturate(kind * 2.0)), towers, saturate(kind * 2.0 - 1.0));
	}

	/*
		THE SHELF CLOUD. Cold air pouring out ahead of weather at sea lifts the warm air in front of it into one long roll,
		and what is seen from the land is a dark wedge along the horizon: thin at its front edge, low down, and thickening
		back into a bank, with its face laid down in level plates like a stack of slates.
		Here it lies along part of a circle round the middle of the land, so it stands off the coast whichever way it is.
			across		where a point is across it: -1 its front edge (the side towards the land), 0 its middle line, 1 its back
			roof		how high its top is there, as a share of its full height: low over the front edge, full further back
	*/
	fn shelfDensity(p: vec3f) -> f32 {
		if (CU.shelf.w <= 0.0 || p.y <= CU.shelfLook.z || p.y >= CU.shelfLook.w) {
			return 0.0;
		}
		let fromMiddle = p.xz - CU.shelf.xy;
		let across = (length(fromMiddle) - CU.shelf.z) / SHELF_WIDTH;
		if (abs(across) >= 1.0) {
			return 0.0;
		}
		// how far round from the middle of the cloud, 0 to 1 at either end of it
		let turned = atan2(fromMiddle.y, fromMiddle.x) - CU.shelfLook.x;
		let around = abs(turned - 6.2831853 * round(turned / 6.2831853)) / CU.shelfLook.y;
		if (around >= 1.0) {
			return 0.0;
		}
		let h = (p.y - CU.shelfLook.z) / (CU.shelfLook.w - CU.shelfLook.z);
		// its outline is pushed in and out by the billows, slowly: it is a smooth cloud, not a heaped one
		let drifted = p - vec3f(CU.scroll.x, 0.0, CU.scroll.y) * 0.3;
		let shape = textureSampleLevel(shapeNoise, repeatSampler, drifted * vec3f(1.0, 2.2, 1.0) / (SHAPE_TILE * 1.6 * shapeSize()), 0.0);
		// the plates: going back from the front edge the top goes up in steps, each a level deck with a short rise to the next
		let back = smoothstep(-1.0, 0.4, across + 0.16 * (shape.r - 0.5));
		let tier = (floor(back * 5.0) + smoothstep(0.5, 1.0, fract(back * 5.0))) / 5.0;
		let roof = (0.2 + 0.8 * tier) * (0.92 + 0.16 * shape.g);
		// and its underside is ragged: scraps of cloud hang down from it
		let underside = 0.14 * shape.b * smoothstep(-0.9, -0.3, across);
		let inside = (1.0 - smoothstep(roof - 0.05, roof, h)) * smoothstep(underside, underside + 0.05, h)
					* smoothstep(-1.0, -0.94, across) * (1.0 - smoothstep(0.55, 1.0, across)) * (1.0 - smoothstep(0.7, 1.0, around));
		return inside * CU.shelf.w;
	}

	/*
		THE TORNADO: a funnel of cloud from the bottom of the low layer down to the ground.
			up			how far up it a point is: 0 at the ground (the height of the sea: the land hides whatever of it is under the land), 1 where it meets the cloud
			the funnel	narrow at the ground, widening slowly at first and then fast into the cloud. Its middle line is not
						straight, it leans and snakes, and the whole thing wanders (weather.js moves it)
			the turning	its outline is pushed in and out by the shape noise, read in a frame that turns round the middle
						line, faster lower down: that is what makes it look as if it spins
			the wall cloud	the cloud it hangs from bulges down round the top of it
			the debris	round its foot, a low wide cloud of everything it has picked up
		As it builds it comes down out of the cloud: the bottom of it is the last part to appear.
	*/
	fn twisterDensity(p: vec3f) -> f32 {
		if (CU.tornado.w <= 0.0 || p.y >= CU.layer.x + 60.0 || p.y <= CU.map.w) {
			return 0.0;
		}
		let up = saturate((p.y - CU.map.w) / (CU.layer.x - CU.map.w));
		let clock = CU.storm.y;
		let middle = CU.tornado.xy + vec2f(sin(up * 2.7 + clock * 0.31), cos(up * 2.1 + clock * 0.23)) * CU.tornado.z * 0.55 * (1.0 - up);
		let fromMiddle = p.xz - middle;
		let outward = length(fromMiddle);
		if (outward > CU.tornado.z * 3.4) {
			return 0.0;
		}
		let turn = atan2(fromMiddle.y, fromMiddle.x) + clock * (1.9 - 1.2 * up) + up * 5.0;
		let churn = textureSampleLevel(shapeNoise, repeatSampler, vec3f(cos(turn) * outward, p.y * 0.4 - clock * 14.0, sin(turn) * outward) / 300.0, 0.0).r;

		let radius = CU.tornado.z * (0.14 + 0.86 * pow(up, 2.6));
		let reached = smoothstep(1.02 - 1.15 * CU.tornado.w, 1.12 - 1.15 * CU.tornado.w, up);		// how far down it has come
		let funnel = (1.0 - smoothstep(0.5, 1.0, outward / radius + 0.55 * (churn - 0.5))) * reached;
		let wallCloud = (1.0 - smoothstep(1.2, 3.2, outward / CU.tornado.z + 0.6 * (churn - 0.5))) * smoothstep(0.72, 0.9, up) * 0.8 * saturate(CU.tornado.w * 2.0);
		let debris = (1.0 - smoothstep(0.0, 0.2, up)) * (1.0 - smoothstep(0.25, 1.0, outward / (CU.tornado.z * 1.1))) * smoothstep(0.3, 0.7, churn) * 0.6 * smoothstep(0.85, 1.0, CU.tornado.w);
		return max(funnel, max(wallCloud, debris));
	}

	// THE DECK: on a day thick with cloud (a storm, a hurricane's arms), the sheet the heaps stand up out of, CU.heaps.w deep: the billows over
	//		a line the coverage sets, as deep as the weather's kind has it (a sheet, or lumps). Only where the weather is past DECK_FROM: on a
	//		fair day the heaps stand alone. And the cumulonimbus the weather stands when it says so (CU.tower). detailed: with the edges worn
	fn layerDensity(p: vec3f, detailed: bool) -> f32 {
		let deck = smoothstep(CU.deck.x, 1.0, CU.weather.x);
		let h = (p.y - CU.layer.x) / max(CU.heaps.w, 1.0);				// how far up through the deck
		let towerH = (p.y - CU.layer.x) / max(CU.shape.x, 1.0);		// and through the cumulonimbus
		// (most of the time there is neither, and the weather need not be read)
		if (p.y <= CU.layer.x || ((h >= 1.0 || deck <= 0.0) && (CU.tower.w <= 0.0 || towerH >= 1.0))) {
			return 0.0;
		}
		let weather = weatherAt(p.xz);
		// (the cumulonimbus leans downwind with height as the heaps do, its anvil furthest: towerFrom)
		let fromTower = towerFrom(p);
		let inTower = CU.tower.w > 0.0 && fromTower < TOWER_REACH && towerH < 1.0;
		if ((h >= 1.0 || deck <= 0.0 || weather.x <= 0.0) && !inTower) {
			return 0.0;
		}

		// the billows. They drift with the weather map, and lean over a little with height, as cloud does in wind that is faster higher up
		let drifted = p - vec3f(CU.scroll.x, 0.0, CU.scroll.y) * (1.0 + 0.25 * min(h, 1.0));
		let shape = textureSampleLevel(shapeNoise, repeatSampler, drifted / (SHAPE_TILE * shapeSize()), 0.0);
		let worley = shape.g * 0.5 + shape.b * 0.3 + shape.a * 0.2;
		// the heads on the heaps: the same noise three times finer, cut out of the heaps
		let heads = textureSampleLevel(shapeNoise, repeatSampler, drifted / (SHAPE_TILE * 0.31 * shapeSize()) + vec3f(0.17, 0.43, 0.71), 0.0).g;
		let billows = saturate(remap(saturate(remap(shape.r, worley - 1.0, 1.0, 0.0, 1.0)), (1.0 - heads) * 0.42, 1.0, 0.0, 1.0));

		var density = 0.0;
		if (h < 1.0 && deck > 0.0 && weather.x > 0.0) {
			density = saturate(remap(billows * cloudProfile(h, weather.y), 1.0 - weather.x, 1.0, 0.0, 1.0)) * weather.x * deck;
		}
		var thickest = mix(0.55, 1.25, min(h, 1.0));		// thicker towards the top, where the water has had longer to condense
		var up = h;

		// The cumulonimbus: a column that swells out on its way up and spreads at the top into the anvil, where it meets air
		//		it cannot rise through. Its outline is pushed in and out by the billows, or it would be a turned shape
		//		Built as a heap is (heapDensity): how far in from its outline a point is, with bulbs carved back into it, here three
		//		times the size of a heap's, so it is a mountain of heads, not a column of fine fur. The anvil is carved less: it is smoother
		if (inTower) {
			let anvil = smoothstep(0.7, 0.95, towerH);
			let girth = 0.55 + 0.15 * sin(towerH * 3.14159) + 1.3 * anvil;
			let big = textureSampleLevel(shapeNoise, repeatSampler, drifted / (HEAP_TILE * 3.0 * CU.heapLook.x * shapeSize()) + vec3f(0.5, 0.2, 0.8), 0.0);
			let smaller = textureSampleLevel(shapeNoise, repeatSampler, drifted / (HEAP_TILE * CU.heapLook.x * shapeSize()) + vec3f(0.3, 0.7, 0.1), 0.0).g;
			let bulbs = saturate(remap(big.g, BULBS.x, BULBS.y, 0.0, 1.0)) * 0.5 + saturate(remap(smaller, BULBS.x, BULBS.y, 0.0, 1.0)) * 0.3
						+ saturate(remap(big.r, BULBS.z, BULBS.w, 0.0, 1.0)) * 0.2;
			let inside = saturate(min((1.0 - fromTower / girth) * 2.5, (1.0 - towerH) * 8.0));
			let carved = (1.0 - bulbs) * mix(0.75, 0.35, anvil) * CU.heapLook.y / 0.82;
			let towering = saturate((inside - carved) * 6.0) * smoothstep(0.0, 0.03, towerH) * CU.tower.w;
			if (towering > density) {
				density = towering;
				thickest = mix(0.9, 1.5, towerH);
				up = towerH;
			}
		}
		if (density <= 0.0) {
			return 0.0;
		}
		cloudBody = max(cloudBody, density);
		cloudUp = max(cloudUp, saturate(up));

		if (detailed) {
			// wispy at the bottom (the detail is cut out of the cloud), billowy higher up (its inverse is). Read from a place
			//		pushed about by the shape noise, and only the outside of the cloud is worn: its body is solid
			let fine = textureSampleLevel(detailNoise, repeatSampler, (drifted + (shape.gba - vec3f(0.5, 0.5, 0.5)) * 110.0 * detailSize()) / (DETAIL_TILE * detailSize()), 0.0).rgb;
			let fineWorley = fine.r * 0.5 + fine.g * 0.3 + fine.b * 0.2;
			let wear = mix(fineWorley, 1.0 - fineWorley, saturate(h * 5.0));
			let worn = 0.62 * (1.0 - 0.8 * smoothstep(CU.upper.w, CU.upper.w + 13000.0, marchFar));
			density = saturate(remap(density, wear * worn * (1.0 - 0.45 * density), 1.0, 0.0, 1.0));
		}
		// the edge of a heap is sharp: a little way in it is already nearly as thick as it gets. (A sheet is left soft)
		let crisp = CU.shape.y * saturate(weather.y * 2.0);
		density = mix(density, 1.0 - pow(1.0 - density, 4.0), crisp);
		return density * CU.weather.z * thickest;
	}

	/*
		THE HEAPS (cumulus, and on a stormy day towering cumulus): not a slab of noise cut off at a height, but clouds, each its own. c_cloudCells
		lays them out over the sky every frame (each a dome, its own size and its own height: see there) and leaves, for every place, how
		high the heaps stand over it, how far it is to the edge of the nearest one, and how big and how tall the one over it is (heapsAt).
		A point under a dome is cloud by how far it is from the dome's surface (up to it, or out to the edge of its footprint, as a share of
		its size: inside), and the billows eat in from that surface (HEAP_ERODE of the way in at most): heads on heads, so the outline and
		the top of every heap are cauliflower, and no two heaps stand as high. The bottom is flat, as a heap's is (where the air it rose in
		got cool enough). And the same map says how far a ray can go before it can come to a heap (heapGap): the march strides across the
		clear air between them in one go, and walks the cloud finely
	*/
	const HEAP_TILE: f32 = 2400.0;		// the bulbs of a heap: the shape noise's tile, world units (times the clouds' size, and Bulb Size)
	//		(how far in from its surface the bulbs may eat, of the way to its middle: Bulb Depth. How far in from its surface a heap is
	//		all the way thick, a share of its height going down and its radius going in: Edge Thickness. Where the deck starts: CU.deck.x)
	const BULBS: vec4f = vec4f(0.3, 0.68, 0.62, 0.85);		// how the shape noise lies (5% and 95% of it): xy its Worley, zw its Perlin-Worley

	// the heaps' map (c_cloudCells) over a world place: x: how high the heaps stand over it, above the bottom of the layer (0: none),
	//		y: how far it is to the edge of the nearest one's footprint (world units, under 0 inside), z: the radius of the one over it, w: how tall that one is
	fn heapsAt(xz: vec2f) -> vec4f {
		let uv = (xz - CU.scroll.xy - CU.cells.xy) * CU.cells.z + vec2f(0.5, 0.5);
		if (any(uv <= vec2f(0.0, 0.0)) || any(uv >= vec2f(1.0, 1.0))) {
			return vec4f(0.0, 1000000.0, 1.0, 1.0);
		}
		return textureSampleLevel(cloudCells, clampSampler, uv, 0.0);
	}
	// how far a point is from the middle line of the cumulonimbus, in its radii (CU.tower.z): it leans downwind with height, half as
	//		far as a heap does, and its anvil is drawn out downwind further. It reaches TOWER_REACH of them at most
	const TOWER_REACH: f32 = 2.3;
	fn towerFrom(p: vec3f) -> f32 {
		let up = max(p.y - CU.layer.x, 0.0);
		return length(p.xz - CU.tower.xy - CU.heaps.yz * up * 0.5) / max(CU.tower.z, 1.0);
	}
	// (where over the map a point is: a heap leans over downwind, the higher up it the further)
	fn heapsUnder(p: vec3f) -> vec2f {
		return p.xz - CU.heaps.yz * (p.y - CU.layer.x);
	}

	fn heapDensity(p: vec3f, detailed: bool) -> f32 {
		let up = p.y - CU.layer.x;
		if (up <= 0.0 || p.y >= CU.layer.y || CU.cells.z <= 0.0) {
			return 0.0;
		}
		let m = heapsAt(heapsUnder(p));
		if (m.x <= up || m.y >= 0.0) {
			return 0.0;
		}
		let inside = saturate(min((m.x - up) / (CU.heapLook.z * max(m.w, 1.0)), -m.y / (CU.heapLook.z * max(m.z, 1.0))));
		// the bulbs: the Worley (round heads, a big one, and smaller ones three times finer on it), with the Perlin-Worley
		//		to break them up. Each spread out over 0 to 1 (BULBS: how the noise lies, 5% and 95% of it), or the heads hardly show
		let drifted = p - vec3f(CU.scroll.x, 0.0, CU.scroll.y);
		let shape = textureSampleLevel(shapeNoise, repeatSampler, drifted / (HEAP_TILE * CU.heapLook.x * shapeSize()), 0.0);
		let heads = textureSampleLevel(shapeNoise, repeatSampler, drifted / (HEAP_TILE * CU.heapLook.x * 0.3 * shapeSize()) + vec3f(0.17, 0.43, 0.71), 0.0).g;
		let bulbs = saturate(remap(shape.g, BULBS.x, BULBS.y, 0.0, 1.0)) * 0.5 + saturate(remap(heads, BULBS.x, BULBS.y, 0.0, 1.0)) * 0.25
					+ saturate(remap(shape.r, BULBS.z, BULBS.w, 0.0, 1.0)) * 0.25;
		// (a flat bottom, a little uneven: the cloud starts all at once where the air it rose in got cool enough)
		let bottom = CU.heapLook.w * (1.0 - shape.b) * shapeSize().y;
		// (the bulbs carve the surface back into the heap; past it the cloud thickens over only a short way, its skin, CU.shape.y:
		//		Crispness. A thick soft skin is lit grey all over, as light gets into it from nowhere)
		let skin = mix(500.0, 60.0, CU.shape.y) * shapeSize().y;
		let zone = CU.heapLook.z * max(min(m.w, m.z), 1.0);
		var density = saturate((inside - (1.0 - bulbs) * CU.heapLook.y) * zone / skin) * smoothstep(bottom, bottom + 50.0, up);
		if (density <= 0.0) {
			return 0.0;
		}
		let along = saturate(up / max(m.w, 1.0));		// how far up its own heap
		cloudBody = max(cloudBody, density);
		cloudUp = max(cloudUp, along);
		if (detailed) {
			// wispy at its foot, billowy above: the fine noise, pushed about by the shape noise, wears only the outside
			let fine = textureSampleLevel(detailNoise, repeatSampler, (drifted + (shape.gba - vec3f(0.5, 0.5, 0.5)) * 110.0 * detailSize()) / (DETAIL_TILE * detailSize()), 0.0).rgb;
			let fineWorley = fine.r * 0.5 + fine.g * 0.3 + fine.b * 0.2;
			let wear = mix(fineWorley, 1.0 - fineWorley, saturate(along * 5.0));
			// (less of it far off, where it is finer than a pixel and would only be grain)
			let worn = CU.heapRise.w * (1.0 - 0.8 * smoothstep(CU.upper.w, CU.upper.w + 13000.0, marchFar));
			density = saturate(remap(density, wear * worn * (1.0 - 0.45 * density), 1.0, 0.0, 1.0));
		}
		density = mix(density, 1.0 - pow(1.0 - density, 4.0), CU.shape.y);
		return density * CU.weather.z * mix(0.75, 1.3, along);
	}

	// How far a ray can go from a point before it could come to a heap (world units), for the march to stride across the clear air
	//		between them. Outside every heap's footprint: the way across to the nearest one's edge, a little short of what the map says
	//		(the lobes of a footprint make its number no true distance, the heaps lean with height, and the map is in texels). Over a
	//		heap: up off the top of its dome, and only a little way, as the top of the one beside it may stand higher. 0 in a heap, or in the deck
	const PUFF_CELL: f32 = 0.42;		// the puffs' cells, of the heaps' (c_cloudCells)
	fn heapGap(p: vec3f) -> f32 {
		let up = p.y - CU.layer.x;
		let m = heapsAt(heapsUnder(p));
		var gap = 0.0;
		if (m.y > 0.0) {
			gap = min((m.y * 0.7 - CU.cells.w) / 1.15, CU.heaps.x);
		} else {
			gap = min((up - m.x) * 0.5, CU.heaps.x * PUFF_CELL * 0.2);
		}
		if (CU.weather.x > CU.deck.x) {
			gap = min(gap, up - CU.heaps.w);
		}
		if (CU.tower.w > 0.0) {
			gap = min(gap, (towerFrom(p) - TOWER_REACH) * CU.tower.z * 0.7);
		}
		return gap;
	}
	// whether the heaps are all there is in the low layer (the deck and the cumulonimbus do not count: heapGap keeps out of them). The others are not in the map
	fn heapsOnly() -> bool {
		return CU.shelf.w <= 0.0 && CU.tornado.w <= 0.0 && CU.deck.y > 0.5;
	}

	// How much cloud there is at a point: the low layer, or the shelf cloud where there is more of that
	fn cloudDensity(p: vec3f, detailed: bool) -> f32 {
		cloudBody = 0.0;
		cloudShelf = 0.0;
		cloudUp = 0.0;
		let layered = max(layerDensity(p, detailed), heapDensity(p, detailed));
		let shelf = shelfDensity(p);
		if (shelf * 2.2 > layered) {
			cloudBody = max(cloudBody, shelf);
			cloudShelf = 1.0;
			return shelf * 2.2 * max(CU.weather.z, 1.0);
		}
		// (a tornado is lit dark as well: it hangs under the thickest of the storm)
		let twister = twisterDensity(p);
		if (twister * 2.6 > layered) {
			cloudBody = max(cloudBody, twister);
			cloudShelf = 1.0;
			return twister * 2.6;
		}
		return layered;
	}

	// How much cloud there is at a point of the middle layer: the same billows, read smaller, in fields of their own
	fn middleDensity(p: vec3f, detailed: bool) -> f32 {
		let h = (p.y - CU.middle.x) / (CU.middle.y - CU.middle.x);
		if (CU.middle.z <= 0.0 || h <= 0.0 || h >= 1.0) {
			return 0.0;
		}
		let drifted = p - vec3f(CU.scroll.x, 0.0, CU.scroll.y) * 1.35;		// (the wind is faster up there)
		let map = textureSampleLevel(weatherMap, repeatSampler, drifted.xz * CU.scroll.z * 1.9 / middleWiden() + vec2f(0.37, 0.11), 0.0);
		let cover = saturate(remap(map.a * 0.55 + map.g * 0.45, 1.0 - CU.middle.z, 1.0 - CU.middle.z + 0.22, 0.0, 1.0));
		if (cover <= 0.0) {
			return 0.0;
		}
		let shape = textureSampleLevel(shapeNoise, repeatSampler, drifted / (SHAPE_TILE * 0.42 * middleWiden() * shapeSize()) + vec3f(0.3, 0.6, 0.1), 0.0);
		let worley = shape.g * 0.5 + shape.b * 0.3 + shape.a * 0.2;
		let billows = saturate(remap(shape.r, worley - 1.0, 1.0, 0.0, 1.0));
		let profile = smoothstep(0.0, 0.2, h) * (1.0 - smoothstep(0.45, 1.0, h));
		var density = saturate(remap(billows * profile, 1.0 - 0.8 * cover, 1.0, 0.0, 1.0)) * cover;
		if (density <= 0.0) {
			return 0.0;
		}
		cloudBody = density;
		if (detailed) {
			let fine = textureSampleLevel(detailNoise, repeatSampler, drifted / (DETAIL_TILE * 0.6 * middleWiden() * detailSize()), 0.0).rgb;
			let wear = 1.0 - (fine.r * 0.5 + fine.g * 0.3 + fine.b * 0.2);
			density = saturate(remap(density, wear * 0.5 * (1.0 - 0.45 * density), 1.0, 0.0, 1.0));
		}
		density = mix(density, 1.0 - pow(1.0 - density, 4.0), CU.shape.y);
		return density * CU.middle.w * 0.8;
	}

	// (how much bigger the high layer's streaks and fibres are than at first, when it was lower: Cirrus Size. And the middle layer's heaps: Middle Size)
	fn highWiden() -> f32 { return max(CU.upper.x, 0.1); }
	fn middleWiden() -> f32 { return max(CU.upper.y, 0.1); }
	// How much cloud there is at a point of the high layer. Ice, not water, so no heaps: either cirrus, long fibres combed
	//		out by the wind that curl over at their ends (mares' tails), or, when the weather is overcast, a sheet that
	//		closes the sky from one side to the other (CU.high.w: 0 the one, 1 the other). detailed: with the fibres in it
	fn highDensity(p: vec3f, detailed: bool) -> f32 {
		let h = (p.y - CU.high.x) / (CU.high.y - CU.high.x);
		if (CU.high.z <= 0.0 || h <= 0.0 || h >= 1.0) {
			return 0.0;
		}
		let drifted = (p.xz - CU.scroll.xy * 1.6) * CU.scroll.z / highWiden();		// (the wind is faster again up there)
		// the weather map read long and thin makes streaks, and read from a place pushed aside by itself the streaks curl at their ends
		let curl = textureSampleLevel(weatherMap, repeatSampler, drifted * 2.3 + vec2f(0.61, 0.13), 0.0).ga - vec2f(0.5, 0.5);
		let streaks = textureSampleLevel(weatherMap, repeatSampler, drifted * vec2f(1.2, 3.9) + curl * 0.07, 0.0).b * 0.6
					+ textureSampleLevel(weatherMap, repeatSampler, drifted * vec2f(4.1, 11.3) + curl * 0.16 + vec2f(0.3, 0.7), 0.0).b * 0.4;
		// there is more of it over the mountains
		let amount = CU.high.z * mix(0.9, 1.45, mountainsUnder(p.xz));
		let wisps = smoothstep(1.0 - 0.58 * amount, 1.0 - 0.58 * amount + 0.36, streaks);
		// (a sheet has no gaps in it, only thicker and thinner stretches)
		let cover = mix(wisps, 0.7 + 0.3 * streaks, CU.high.w);
		if (cover <= 0.0) {
			return 0.0;
		}
		// thickest through its middle, thinning to nothing above and below
		var density = cover * 4.0 * h * (1.0 - h);
		cloudBody = density;
		if (detailed) {
			// the fibres: the fine noise read stretched out the way the streaks run, which takes most of the cloud away between them. Much less of that in a sheet
			//		(ten times as long as they are wide, and bent by the same push that curls the streaks)
			let fine = textureSampleLevel(detailNoise, repeatSampler, vec3f((p.x - CU.scroll.x * 1.6) / (9000.0 * highWiden()), p.y / 900.0, (p.z - CU.scroll.y * 1.6) / (900.0 * highWiden())) + vec3f(curl.x, 0.0, curl.y) * 0.22, 0.0).rgb;
			let fibres = fine.r * 0.4 + fine.g * 0.35 + fine.b * 0.25;
			density *= mix(mix(0.3, 1.45, smoothstep(0.3, 0.7, fibres)), 0.85 + 0.3 * fibres, CU.high.w);
		}
		return density * CU.highLook.x;
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
	THE HEAPS' MAP: where the heaps of the low layer stand, made fresh every frame over the stretch of sky round the camera
	(heapDensity reads it). Two sizes of heap, each in a grid of cells with at most one in each cell: the heaps (CU.heaps.x across a
	cell) and the puffs between and on them (PUFF_CELL of that). Each one is a dome: a footprint, round with lobes pushed out of it,
	and a top that rises from its edge steeply and rounds over (the taller it is for its width, the steeper its sides), as tall as
	the weather lets it (a fair day's tallest CU.shape.z, a towering day's CU.shape.w) and no two alike. Whether a cell has one
	and how big it grows comes from the weather over it: where the weather map has a field of cloud the cells fill, out to its
	edges thinning to scattered puffs, and as the weather builds or clears they grow and shrink rather than come and go.
	Laid out in the clouds' own frame (the world less how far they have drifted), so they drift whole.
		r	how high the heaps stand over the place, above the bottom of the layer (0: none)
		g	how far it is to the edge of the nearest one's footprint, under 0 inside one. No further than the map can know: the
			3 x 3 cells round a place are looked at, and a heap in a cell further off is at least that far away
		b, a	the radius and the full height of the heap that stands highest over it
*/
export const c_cloudCells =
`
	${cloudUniforms}
	${cloudDensity}

	@group(0) @binding(10) var cellsOut: texture_storage_2d<rgba16float, write>;

	fn hash4(cell: vec2f) -> vec4f {
		var q = fract(cell.xyxy * vec4f(0.1031, 0.1030, 0.0973, 0.1099));
		q += dot(q, q.wzxy + vec4f(33.33, 33.33, 33.33, 33.33));
		return fract((q.xxyz + q.yzzw) * q.zywx);
	}

	struct Dome {
		top: f32,			// how high it stands over the place (0 outside it)
		edge: f32,			// how far the place is from the edge of its footprint, under 0 inside
		radius: f32,
		tallest: f32,
	}

	// the heap of one cell, as it stands over cs (a place in the clouds' frame). size: the cell's. puff: one of the small ones
	fn domeOf(cs: vec2f, cell: vec2f, size: f32, puff: bool) -> Dome {
		var dome = Dome(0.0, 1000000.0, 1.0, 1.0);
		let seed = cell + select(vec2f(0.0, 0.0), vec2f(113.0, 71.0), puff);
		let r = hash4(seed);
		let s = hash4(seed.yx + vec2f(37.0, 59.0));
		let middle = (cell + vec2f(0.5, 0.5) + (r.xy - vec2f(0.5, 0.5)) * 0.4) * size;
		let weather = weatherAt(middle + CU.scroll.xy);
		// (how far it has grown: the more cloud the weather has over the cell, the likelier there is a heap in it and the bigger)
		let grow = saturate((weather.x * select(1.6 * CU.heapGrow.x, 2.2 * CU.heapGrow.y, puff) - r.z) * 3.0);
		if (grow <= 0.0) {
			return dome;
		}
		let towering = saturate((weather.y - 0.5) * 2.2 + CU.heapRise.x);
		let big = mix(s.x, r.w, 0.5);		// (a bigger heap is a taller one, mostly)
		dome.radius = size * mix(0.3, 0.46, big) * mix(0.75, 1.0, weather.x) * mix(0.55, 1.0, grow) * CU.heapGrow.z;
		if (puff) {
			dome.tallest = CU.shape.z * mix(0.12, 0.3, s.y);
		} else {
			dome.tallest = mix(CU.shape.z, CU.shape.w, towering) * mix(1.0 - 0.78 * CU.heapGrow.w, 1.0, pow(mix(s.y, big, 0.5), 1.6));
		}
		dome.tallest *= mix(0.35, 1.0, grow);
		let away = cs - middle;
		let d = length(away);
		let bearing = atan2(away.y, away.x);
		let reach = dome.radius * (1.0 + CU.heapRise.z * (0.16 * sin(3.0 * bearing + s.z * 6.2832) + 0.09 * sin(5.0 * bearing + s.w * 6.2832)));
		dome.edge = d - reach;
		if (d < reach) {
			// (a low wide heap is a flat dome, steep at its edge; a tall one an egg on end, rounding over into its head)
			let tall = saturate(dome.tallest / (dome.radius * 3.0));
			let sides = mix(2.6, 2.0, tall) * CU.heapRise.y;
			dome.top = dome.tallest * pow(1.0 - pow(d / reach, sides), mix(0.45, 0.62, tall));
		}
		return dome;
	}

	@compute @workgroup_size(${CLOUD_CELLS_WORKGROUP}, ${CLOUD_CELLS_WORKGROUP})
	fn computeMain(@builtin(global_invocation_id) id: vec3u) {
		if (id.x >= ${CLOUD_CELLS_SIZE}u || id.y >= ${CLOUD_CELLS_SIZE}u) {
			return;
		}
		let cs = CU.cells.xy + ((vec2f(id.xy) + vec2f(0.5, 0.5)) / ${CLOUD_CELLS_SIZE}.0 - vec2f(0.5, 0.5)) / CU.cells.z;
		var top = 0.0;
		var edge = 1000000.0;
		var radius = 1.0;
		var tallest = 1.0;
		for (var octave = 0; octave < 2; octave++) {
			let puff = octave == 1;
			let size = CU.heaps.x * select(1.0, PUFF_CELL, puff);
			let cell = floor(cs / size);
			for (var j = -1; j <= 1; j++) {
				for (var i = -1; i <= 1; i++) {
					let dome = domeOf(cs, cell + vec2f(f32(i), f32(j)), size, puff);
					edge = min(edge, dome.edge);
					if (dome.top > top) {
						top = dome.top;
						radius = dome.radius;
						tallest = dome.tallest;
					}
				}
			}
		}
		// (a heap in a cell the map did not look at is at least this far off: its middle is a cell and a half away, less the most it
		//		can be pushed off its cell's middle and the furthest its lobes reach)
		let reachMost = 0.46 * CU.heapGrow.z * (1.0 + 0.25 * CU.heapRise.z);
		edge = min(edge, CU.heaps.x * PUFF_CELL * max(1.3 - reachMost, 0.05) * 0.95);
		textureStore(cellsOut, id.xy, vec4f(top, max(edge, -30000.0), radius, tallest));
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
		let bottom = cloudFloor();
		let enter = vec3f(xz.x, CU.map.w, xz.y) + toLight * ((bottom - CU.map.w) / toLight.y);
		let stride = (ceiling - bottom) / toLight.y / f32(SHADOW_STEPS);
		var inTheWay = 0.0;
		for (var i = 0; i < SHADOW_STEPS; i++) {
			inTheWay += cloudDensity(enter + toLight * (stride * (f32(i) + 0.5)), false) * stride;
		}

		// the sun has to get through the high layer as well: one reading of it, half way up, where the way to the sun crosses it.
		//		Cirrus takes a little off the sun. The sheet of an overcast day takes most of it
		let highMiddle = 0.5 * (CU.high.x + CU.high.y);
		let highThere = highDensity(vec3f(xz.x, CU.map.w, xz.y) + toLight * ((highMiddle - CU.map.w) / toLight.y), false);
		let highInTheWay = highThere * 0.67 * (CU.high.y - CU.high.x) / toLight.y;

		// and straight up
		let rise = (ceiling - bottom) / f32(OVERHEAD_STEPS);
		var overhead = 0.0;
		for (var i = 0; i < OVERHEAD_STEPS; i++) {
			overhead += cloudDensity(vec3f(xz.x, bottom + rise * (f32(i) + 0.5), xz.y), false) * rise;
		}
		let cover = 1.0 - exp(-overhead * 0.016);
		// (a closed sheet overhead counts as cloud overhead. Cirrus does not: there is blue between the fibres)
		let highOverhead = saturate(highDensity(vec3f(xz.x, highMiddle, xz.y), false) / max(CU.highLook.x, 0.0001)) * CU.high.w;

		// rain falls out of the deep of the cloud, not from under its ragged edges
		let rain = smoothstep(0.55, 0.9, cover) * CU.quality.w;
		textureStore(coverageOut, id.xy, vec4f(exp(-inTheWay * 0.008 - highInTheWay * 0.009), max(cover, 0.8 * highOverhead), rain, 1.0));
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
	// the level of the march this is (see DYNAMIC RESOLUTION at the top)
	struct MarchLevel {
		size : vec4f,		// xy: the size it draws at, z: how near (world units) cloud must be met to be marched again here, w: 1 if there is a coarser level to start from
		before : mat4x4f,	// the view projection of the frame before (THE UPDATE RATE)
		rate : vec4f,		// x: every how many frames a pixel is marched (settings.cloudUpdateEvery), y: which of them this frame is, z: 1 if what this level drew the frame before can be carried over
		drift : vec4f,		// xy: how far the clouds have drifted since the frame before, world units
	}
	@group(0) @binding(10) var<uniform> LV: MarchLevel;
	@group(0) @binding(11) var coarserLight: texture_2d<f32>;	// the coarser level: what this target 0 is
	@group(0) @binding(12) var coarserNear: texture_2d<f32>;	// and target 1: how near the cloud it met was (world units; 1e9 none)
	@group(0) @binding(13) var beforeLight: texture_2d<f32>;	// what this level drew the frame before: target 0
	@group(0) @binding(14) var beforeNear: texture_2d<f32>;		// and target 1
	struct Marched {
		@location(0) light: vec4f,		// rgb: the light the clouds send to the eye, a: how much of what is behind them shows through
		@location(1) near: vec2f,		// x: how far along the ray it first lost a little of what is behind, y: how far the ray went (to the solid thing drawn there: 1e9 the sky)
	}

	/*
		THE UPDATE RATE (settings.cloudUpdateEvery, N). A pixel is marched one frame in N: which frame by where it stands in a 4 by 4
		block (a Bayer pattern, so the pixels marched in any one frame are spread evenly over the screen, not in rows: THE UPDATE RATE,
		PACKED, below, for how they are marched). The rest carry
		over what they drew the frame before: the cloud they met is looked for where the camera of that frame saw it, after the wind
		has moved it on (LV.before, LV.drift), and the light there is taken. Not carried over (marched, whatever the frame): what
		went off the edge of the frame before, and a pixel whose ray now ends somewhere else (a tree or a hill has come in front of
		it, or gone): what the frame before saw down it is not what is there now
	*/
	struct Carried {
		light: vec4f,
		near: f32,
		ok: bool,
	}
	const CARRY_FAR: f32 = 1000000.0;		// (how far off a ray that met no cloud is taken to have looked: a direction only)
	fn carriedOver(origin: vec3f, direction: vec3f, pixel: vec2f, solid: f32) -> Carried {
		var kept = Carried(vec4f(0.0, 0.0, 0.0, 1.0), 1000000000.0, false);
		let size = vec2i(LV.size.xy);
		var was = textureLoad(beforeNear, min(vec2i(pixel), size - vec2i(1, 1)), 0).xy;
		var uv = vec2f(0.0, 0.0);
		// (twice: where it is looked for depends on how far off the cloud was, and that is read where it is looked for)
		for (var k = 0; k < 2; k++) {
			let reach = min(select(was.x, CARRY_FAR, was.x > 999999999.0), solid);
			let earlier = LV.before * vec4f(origin + direction * reach - vec3f(LV.drift.x, 0.0, LV.drift.y), 1.0);
			if (earlier.w <= 0.0) {
				return kept;
			}
			let ndc = earlier.xy / earlier.w;
			uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
			if (any(uv < vec2f(0.0, 0.0)) || any(uv > vec2f(1.0, 1.0))) {
				return kept;
			}
			was = textureLoad(beforeNear, min(vec2i(uv * LV.size.xy), size - vec2i(1, 1)), 0).xy;
		}
		if (abs(was.y - solid) > 0.12 * min(was.y, solid)) {
			return kept;
		}
		kept.light = textureSampleLevel(beforeLight, clampSampler, uv, 0.0);
		kept.near = was.x;
		kept.ok = true;
		return kept;
	}
	const SEEN: f32 = 0.98;			// (a little: what shows through dropping under this)

	const PI: f32 = 3.14159265;
	const MOST_SKIPS: i32 = 128;		// strides across the clear air between the heaps (heapGap), at most, per ray
	const FAR_STRIDE: f32 = 0.006;		// a step through a heap is at least this much of how far off it is
	const MIDDLE_LIGHT_STEPS: i32 = 3;
	// THE WALK TOWARDS THE SUN (cloudToLight): from this far off (world units) its steps go down, to LIGHT_LOD_STEPS this much further
	const LIGHT_LOD_FROM: f32 = 8000.0;
	const LIGHT_LOD_OVER: f32 = 16000.0;
	const LIGHT_LOD_STEPS: f32 = 2.0;
	const SCATTER: f32 = 0.03;			// how much of the light a unit of cloud of density 1 scatters, per world unit

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
		let corner = vec2f(f32((vertexIndex << 1u) & 2u), f32(vertexIndex & 2u));
		return vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
	}

	${skyLUTUVShapes}

	// the light of the sky from a direction, as the sky view LUT has it (not yet exposed for the screen)
	fn skyLight(direction: vec3f) -> vec3f {
		return textureSampleLevel(skyLUT, clampSampler, skyLUTUV(direction), 0.0).rgb;
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

	// how much cloud lies between a point and the sun: a walk towards it, in steps that grow, out through the rest of a tall heap,
	//		and one reading far off, for the shadow one heap casts on the next
	fn cloudToLight(p: vec3f) -> f32 {
		var inTheWay = 0.0;
		var reach = 0.0;
		// (far off, fewer steps, each the longer, over the same reach: the shading of a far heap is broad, and this walk is most of
		//		what the longest rays cost, low along the layer through heap after heap. They are what the march waits for)
		let lod = smoothstep(LIGHT_LOD_FROM, LIGHT_LOD_FROM + LIGHT_LOD_OVER, marchFar);
		let steps = max(i32(round(mix(CU.deck.z, min(CU.deck.z, LIGHT_LOD_STEPS), lod))), 1);
		var stride = 40.0 * CU.deck.w * (pow(1.8, CU.deck.z) - 1.0) / (pow(1.8, f32(steps)) - 1.0);
		for (var i = 0; i < steps; i++) {
			inTheWay += cloudDensity(p + CU.lightDirection.xyz * (reach + 0.5 * stride), false) * stride;
			reach += stride;
			stride *= 1.8;
		}
		inTheWay += cloudDensity(p + CU.lightDirection.xyz * 2400.0 * CU.deck.w, false) * 600.0 * CU.deck.w;
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

	//------------------THE RAY-----------------
	// of a pixel of this level: where it starts, which way it goes, and how far it can go: to whatever solid thing was drawn at the
	//		pixel, if anything was (1e9: the sky). (The march is a half, a third or a quarter of the size of the frame, see cloudResolution:
	//		the depth is read at the matching place)
	struct Ray {
		origin: vec3f,
		direction: vec3f,
		ndc: vec2f,
		solid: f32,
	}
	fn rayAt(pixel: vec2f) -> Ray {
		let uv = pixel / LV.size.xy;
		let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
		let nearPoint = CU.invViewProjectionMatrix * vec4f(ndc, ${DEPTH_NEAR}, 1.0);
		let farPoint = CU.invViewProjectionMatrix * vec4f(ndc, ${DEPTH_FAR}, 1.0);
		let origin = CU.cameraPosition.xyz;
		let direction = normalize(farPoint.xyz / farPoint.w - nearPoint.xyz / nearPoint.w);
		let depthSize = vec2i(textureDimensions(depthTexture));
		let depth = textureLoad(depthTexture, min(vec2i(pixel * vec2f(depthSize) / LV.size.xy), depthSize - vec2i(1, 1)), 0);
		var solid = 1000000000.0;
		if (!${skyTest('depth')}) {
			let scenePoint = CU.invViewProjectionMatrix * vec4f(ndc, depth, 1.0);
			solid = distance(scenePoint.xyz / scenePoint.w, origin);
		}
		return Ray(origin, direction, ndc, solid);
	}

	//------------------THE LEVEL-----------------
	// from the coarser level (see DYNAMIC RESOLUTION at the top): the nearest cloud it met round here, and whether this pixel is on
	//		the edge of something solid that the coarser pixels round it saw past, or into. ok: no cloud near enough here to be
	//		marched at this level, and what the coarser one has is taken
	fn fromCoarser(pixel: vec2f, ray: Ray) -> Carried {
		var taken = Carried(vec4f(0.0, 0.0, 0.0, 1.0), 1000000000.0, false);
		if (LV.size.w < 0.5) {
			return taken;
		}
		let depthSize = vec2i(textureDimensions(depthTexture));
		let coarseSize = vec2i(textureDimensions(coarserNear));
		let ratio = vec2f(depthSize) / vec2f(coarseSize);
		let middle = vec2i(round(pixel * vec2f(coarseSize) / LV.size.xy - vec2f(0.5, 0.5)));
		var nearest = 1000000000.0;
		var edge = false;
		for (var j = -1; j <= 1; j++) {
			for (var i = -1; i <= 1; i++) {
				let texel = clamp(middle + vec2i(i, j), vec2i(0, 0), coarseSize - vec2i(1, 1));
				nearest = min(nearest, textureLoad(coarserNear, texel, 0).r);
				if (abs(i) + abs(j) <= 1) {
					let there = textureLoad(depthTexture, min(vec2i((vec2f(texel) + vec2f(0.5, 0.5)) * ratio), depthSize - vec2i(1, 1)), 0);
					var thereSolid = 1000000000.0;
					if (!${skyTest('there')}) {
						let p = CU.invViewProjectionMatrix * vec4f(ray.ndc, there, 1.0);
						thereSolid = distance(p.xyz / p.w, ray.origin);
					}
					edge = edge || abs(thereSolid - ray.solid) > 0.15 * min(thereSolid, ray.solid);
				}
			}
		}
		if (nearest > LV.size.z && !(edge && nearest < 999999999.0)) {
			taken = Carried(textureSampleLevel(coarserLight, clampSampler, pixel / LV.size.xy, 0.0), nearest, true);
		}
		return taken;
	}

	// The stretches of a ray that are inside the three layers. (The high layer is followed much further out than the others:
	//		it is so high that a ray only a little above the horizon has a very long way to go to reach it, and a sheet
	//		that stopped half way down the sky would not be an overcast one)
	fn stretchesOf(ray: Ray) -> array<vec2f, 3> {
		let furthest = min(CU.quality.y, ray.solid);
		var stretches = array<vec2f, 3>(
			stretchBetween(ray.origin, ray.direction, cloudFloor(), cloudCeiling(), furthest),
			stretchBetween(ray.origin, ray.direction, CU.middle.x, CU.middle.y, furthest),
			stretchBetween(ray.origin, ray.direction, CU.high.x, CU.high.y, min(CU.highLook.z * 1.8, ray.solid)));
		if (CU.middle.z <= 0.0) {
			stretches[1] = vec2f(0.0, -1.0);
		}
		if (CU.high.z <= 0.0) {
			stretches[2] = vec2f(0.0, -1.0);
		}
		return stretches;
	}
	// (no cloud along it at all: nothing to march, and nothing to carry over)
	fn noStretch(stretches: array<vec2f, 3>) -> bool {
		return stretches[0].y <= stretches[0].x && stretches[1].y <= stretches[1].x && stretches[2].y <= stretches[2].x;
	}
	const CLEAR = Marched(vec4f(0.0, 0.0, 0.0, 1.0), vec2f(1000000000.0, 1000000000.0));

	// the march of one pixel of the level
	fn marchPixel(pixel: vec2f) -> Marched {
		let ray = rayAt(pixel);
		let origin = ray.origin;
		let direction = ray.direction;
		let solid = ray.solid;
		let coarse = fromCoarser(pixel, ray);
		if (coarse.ok) {
			return Marched(coarse.light, vec2f(coarse.near, solid));
		}
		var stretches = stretchesOf(ray);
		if (noStretch(stretches)) {
			return Marched(vec4f(0.0, 0.0, 0.0, 1.0), vec2f(1000000000.0, solid));
		}
		let fragCoord = vec4f(pixel, 0.0, 1.0);

		// which to walk first: whichever the ray comes to first (a layer it never comes to goes last, and is passed over)
		var comesTo = array<f32, 3>(0.0, 0.0, 0.0);
		for (var k = 0; k < 3; k++) {
			comesTo[k] = select(1000000000.0 + f32(k), stretches[k].x, stretches[k].y > stretches[k].x);
		}
		var order = array<i32, 3>(0, 1, 2);
		for (var sweep = 0; sweep < 2; sweep++) {
			for (var k = 0; k < 2 - sweep; k++) {
				if (comesTo[order[k]] > comesTo[order[k + 1]]) {
					let held = order[k];
					order[k] = order[k + 1];
					order[k + 1] = held;
				}
			}
		}

		var light = vec3f(0.0, 0.0, 0.0);		// what the clouds send to the eye
		var through = 1.0;						// how much of what is behind them still shows

		//------------------THE LIGHT-----------------
		let cosAngle = dot(direction, CU.lightDirection.xyz);
		// (straight on and a little back: the silver lining, and the faint brightening of a cloud with the sun behind the viewer)
		let lobes = mix(phase(cosAngle, CU.glow.x), phase(cosAngle, CU.glow.y), CU.glow.z);
		let ambientHigh = skyLight(vec3f(0.0, 1.0, 0.0)) + skyLight(normalize(vec3f(CU.lightDirection.x, 0.35, CU.lightDirection.z)));
		let ambientLow = skyLight(normalize(vec3f(direction.x, 0.08, direction.z)));
		let grey = 1.0 - 0.75 * CU.scroll.w;
		let jitter = pixelNoise(fragCoord.xy);
		var seen = 1000000000.0;				// (how far along it first lost a little of what is behind: Marched.near)

		// the three layers, the nearest first
		for (var turn = 0; turn < 3; turn++) {
			let which = order[turn];			// 0 the low layer, 1 the middle, 2 the high
			let stretch = stretches[which];
			if (stretch.y <= stretch.x) {
				continue;
			}
			// (the thinner the layer and the less there is to find in it, the fewer the steps)
			var steps = i32(CU.quality.x);
			var shortest = 12.0;
			var longest = 46.0;
			var hazeDistance = CU.quality.z;
			if (which == 1) {
				steps = max(steps / 3, 8);
			}
			if (which == 2) {
				steps = max(steps / 4, 8);
				shortest = 24.0;
				longest = 140.0;
				hazeDistance = CU.highLook.z;
			}

			//------------------THE MARCH-----------------
			// The steps start short (no shorter than the detail they could find) and each is a little longer than the last, by
			//		however much it takes for them to reach the end of the stretch between them. A ray that grazes along a layer for
			//		miles walks the near cloud as finely as one that goes straight up through it, and the far cloud coarsely
			let reachOut = stretch.y - stretch.x;
			let first = clamp(reachOut / f32(steps), shortest, longest);
			// (a long stretch gets more steps as well, up to 3 times as many: stretched over too few, the far steps are so long
			//		that where each one happens to land shows, as stripes across the far cloud)
			let longer = log(max(reachOut / (first * f32(steps)), 1.0));
			steps = i32(f32(steps) * clamp(1.0 + longer, 1.0, 3.0));
			let growth = 1.7 * log(max(reachOut / (first * f32(steps)), 1.0)) / f32(steps);
			var stride = first;
			// every pixel takes each step at a different place along it: grain instead of bands, however long the step
			let along = fract(jitter + 0.618 * f32(turn));
			var stepStart = stretch.x;
			// (through the low layer's heaps, the clear air between them is crossed in strides as long as the heaps' map says is
			//		clear, and they are not counted as steps: heapGap)
			let skipping = which == 0 && heapsOnly();
			var skips = 0;
			for (var i = 0; i < steps; i++) {
				let travelled = stepStart + stride * along;
				if (travelled >= stretch.y || through < 0.01) {
					break;
				}
				let p = origin + direction * travelled;
				if (skipping && skips < MOST_SKIPS) {
					let gap = heapGap(p);
					if (gap > stride * 1.5) {
						stepStart += gap;
						stride = max(stride, stepStart * FAR_STRIDE);
						skips++;
						i--;
						continue;
					}
				}
				var density = 0.0;
				var h = 0.0;
				if (which == 1) {
					density = middleDensity(p, true);
					h = saturate((p.y - CU.middle.x) / (CU.middle.y - CU.middle.x));
				} else if (which == 2) {
					density = highDensity(p, true);
					h = saturate((p.y - CU.high.x) / (CU.high.y - CU.high.x));
				} else {
					marchFar = travelled;
					density = cloudDensity(p, true);
					h = select(saturate(cloudUp), saturate((p.y - CU.shelfLook.z) / (CU.shelfLook.w - CU.shelfLook.z)), cloudShelf > 0.0);		// (up its own heap; or the shelf cloud, or the tornado under it)
				}
				if (density > 0.0) {
					let body = cloudBody;
					let shelfShare = select(0.0, cloudShelf, which == 0);
					var inTheWay = 0.0;
					var sunDown = CU.highLook.y;		// the sun on the lower two layers has come through the high one
					var skyDown = 1.0 + 2.6 * (1.0 - CU.highLook.y);		// and what the high layer took off the sun it sends down as its own even light
					if (which == 1) {
						inTheWay = middleToLight(p) * SCATTER;
					} else if (which == 2) {
						// (no walk towards the sun for this one: it is a thin even layer, and what is in the way is near
						//		enough what is here, for as far as there is still to go up through it)
						inTheWay = density * (CU.high.y - p.y) / max(CU.lightDirection.y, 0.2) * SCATTER * 0.7;
						sunDown = 1.0;
						skyDown = 1.0;
					} else {
						inTheWay = cloudToLight(p) * SCATTER * CU.shade.x;
					}

					// the light that gets here from the sun and is sent on to the eye. Three times over, each time weaker,
					//		reaching deeper and less particular about direction: it stands in for the light that bounces about inside
					var sun = 0.0;
					var weaker = 1.0;
					var deeper = 1.0;
					var rounder = 1.0;
					for (var bounce = 0; bounce < 3; bounce++) {
						sun += weaker * exp(-inTheWay * deeper) * mix(1.0 / (4.0 * PI), lobes, rounder);
						weaker *= CU.glow.w;
						deeper *= CU.upper.z;
						rounder *= 0.5;
					}
					// folds: more light is scattered in to the body of a cloud than to its thin edges, and less to its underside
					//		(not in the high layer: ice in a thin sheet has no body to speak of)
					if (which < 2) {
						sun *= (1.0 - CU.shade.y + CU.shade.y * pow(saturate(body * 2.4), mix(0.45, 1.1, h))) * mix(1.0 - CU.shade.z, 1.0, smoothstep(0.0, 0.3, h));
					}
					// and from the sky: from above in the top of the cloud, only from the horizon down in the bottom of it
					let ambient = mix(ambientLow, ambientHigh * 0.5, h) * CU.lightColor.a * mix(0.3, 1.0, h) * CU.shade.w;
					var lit = (CU.lightColor.rgb * sun * sunDown * 4.0 * PI * grey + ambient * skyDown * grey * 0.3) * (1.0 - 0.45 * shelfShare);
					// the green of the light under a tornado or a hurricane
					lit *= mix(vec3f(1.0, 1.0, 1.0), vec3f(0.62, 1.06, 0.54), CU.storm.z);
					// lightning: light from inside the cloud itself, round where it struck, and a little of it everywhere
					if (CU.storm.w > 0.0) {
						let toStrike = p - CU.strike.xyz;
						lit += vec3f(0.72, 0.8, 1.0) * CU.storm.w * (0.55 * exp(-dot(toStrike, toStrike) / (CU.strike.w * CU.strike.w)) + 0.012);
					}

					// Far off the clouds go into the haze like everything else: there is less and less of them, and they
					//		just fade away into the sky behind them
					let hazed = exp(-pow(travelled / hazeDistance, 2.0));
					// what this step adds, and what it hides of everything further on (Hillaire's energy conserving sum)
					let fade = exp(-density * SCATTER * stride * hazed);
					light += through * lit * (1.0 - fade);
					through *= fade;
					if (through < SEEN && seen > 999999999.0) {
						seen = travelled;
					}
				}
				stepStart += stride;
				stride *= 1.0 + growth;
				if (skipping) {
					stride = max(stride, stepStart * FAR_STRIDE);
				}
			}
		}

		return Marched(vec4f(light, through), vec2f(seen, solid));
	}

	// every pixel of the level marched (the Update Every of 1, or nothing from the frame before to carry over)
	@fragment
	fn fragmentMain(@builtin(position) fragCoord: vec4f) -> Marched {
		return marchPixel(fragCoord.xy);
	}

	/*
		THE UPDATE RATE, PACKED. Only this frame's pixels (marchedNow's) are marched, and packed close together into a small target
		of their own (packedMain), so that the GPU, which runs pixels in groups and waits for the slowest of a group, has whole
		groups marching and none just waiting: spread out among the rest, every group would have one, and nothing would be saved.
		Its pixel x, y is slot x % slots of the 4 by 4 block x / slots, y: the slot-th of the block's cells whose Bayer number is
		this frame's (phaseStart). Then resolveMain lays them out at their places in the level, and fills the rest: from the coarser
		level where there is no cloud near enough to march here, carried over from the frame before where it can be, and else from
		the nearest pixel of the block marched this frame that saw as far (an edge that has just come out from behind something)
	*/
	fn phaseStart(p: u32) -> u32 {
		let n = u32(LV.rate.x);
		return (p * 16u + n - 1u) / n;
	}
	@fragment
	fn packedMain(@builtin(position) fragCoord: vec4f) -> Marched {
		var unbayer = array<u32, 16>(0u, 10u, 2u, 8u, 5u, 15u, 7u, 13u, 1u, 11u, 3u, 9u, 4u, 14u, 6u, 12u);
		let c = vec2u(fragCoord.xy);
		let slots = u32(LV.rate.w);
		let p = u32(LV.rate.y);
		let v = phaseStart(p) + c.x % slots;
		let cell = unbayer[min(v, 15u)];
		let pixel = vec2u(c.x / slots, c.y) * 4u + vec2u(cell % 4u, cell / 4u);
		if (v >= phaseStart(p + 1u) || any(pixel >= vec2u(LV.size.xy))) {
			return CLEAR;
		}
		return marchPixel(vec2f(pixel) + vec2f(0.5, 0.5));
	}

	@group(0) @binding(15) var packedLight: texture_2d<f32>;	// packedMain's: this frame's marched pixels
	@group(0) @binding(16) var packedNear: texture_2d<f32>;
	@fragment
	fn resolveMain(@builtin(position) fragCoord: vec4f) -> Marched {
		var bayer = array<u32, 16>(0u, 8u, 2u, 10u, 12u, 4u, 14u, 6u, 3u, 11u, 1u, 9u, 15u, 7u, 13u, 5u);
		var unbayer = array<u32, 16>(0u, 10u, 2u, 8u, 5u, 15u, 7u, 13u, 1u, 11u, 3u, 9u, 4u, 14u, 6u, 12u);
		let pixel = vec2u(fragCoord.xy);
		let slots = u32(LV.rate.w);
		let p = u32(LV.rate.y);
		let first = phaseStart(p);
		let last = phaseStart(p + 1u);
		let block = pixel / 4u;
		let v = bayer[(pixel.y & 3u) * 4u + (pixel.x & 3u)];
		if (v >= first && v < last) {
			let at = vec2i(vec2u(block.x * slots + v - first, block.y));
			return Marched(textureLoad(packedLight, at, 0), textureLoad(packedNear, at, 0).xy);
		}
		let ray = rayAt(fragCoord.xy);
		let coarse = fromCoarser(fragCoord.xy, ray);
		if (coarse.ok) {
			return Marched(coarse.light, vec2f(coarse.near, ray.solid));
		}
		if (noStretch(stretchesOf(ray))) {
			return Marched(vec4f(0.0, 0.0, 0.0, 1.0), vec2f(1000000000.0, ray.solid));
		}
		let carried = carriedOver(ray.origin, ray.direction, fragCoord.xy, ray.solid);
		if (carried.ok) {
			return Marched(carried.light, vec2f(carried.near, ray.solid));
		}
		var best = vec2i(0, 0);
		var bestScore = 1.0e30;
		for (var k = first; k < last; k++) {
			let cell = unbayer[k];
			let there = block * 4u + vec2u(cell % 4u, cell / 4u);
			let at = vec2i(vec2u(block.x * slots + k - first, block.y));
			let saw = textureLoad(packedNear, at, 0).y;
			let score = distance(vec2f(there), vec2f(pixel)) + 8.0 * abs(saw - ray.solid) / max(min(saw, ray.solid), 1.0);
			if (score < bestScore) {
				bestScore = score;
				best = at;
			}
		}
		return Marched(textureLoad(packedLight, best, 0), vec2f(textureLoad(packedNear, best, 0).x, ray.solid));
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
		//		(the march is a half, a third or a quarter of the size of the frame: see cloudResolution)
		let ratio = vec2f(fullSize) / vec2f(halfSize);
		let place = fragCoord.xy / ratio - vec2f(0.5, 0.5);
		let base = vec2i(round(place));
		var total = vec4f(0.0, 0.0, 0.0, 0.0);
		var weights = 0.0;
		for (var j = -1; j <= 1; j++) {
			for (var i = -1; i <= 1; i++) {
				let texel = clamp(base + vec2i(i, j), vec2i(0, 0), halfSize - vec2i(1, 1));
				let there = viewDistance(textureLoad(depthTexture, min(vec2i(vec2f(texel) * ratio), fullSize - vec2i(1, 1)), 0));
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
		if (CU.moonLook.x > 0.0 && ${skyTest('textureLoad(depthTexture, vec2i(fragCoord.xy), 0)')}) {
			let ndc = vec2f(fragCoord.x / f32(fullSize.x) * 2.0 - 1.0, 1.0 - fragCoord.y / f32(fullSize.y) * 2.0);
			let nearPoint = CU.invViewProjectionMatrix * vec4f(ndc, ${DEPTH_NEAR}, 1.0);
			let farPoint = CU.invViewProjectionMatrix * vec4f(ndc, ${DEPTH_FAR}, 1.0);
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
