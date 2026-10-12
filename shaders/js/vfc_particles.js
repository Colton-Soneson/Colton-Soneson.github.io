import { windShapes } from './vf_wind.js';
import { moonShapes } from './f_moon.js';
import { cloudShadeShapes } from './vfc_clouds.js';

export const PARTICLE_WORKGROUP_SIZE = 64;
export const LEAF_VERTICES = 6;			// a leaf is one flat card: 2 triangles
export const SPRAY_VERTICES = 6;
export const RAIN_VERTICES = 6;
export const LEAF_ROCK = 0.95;			// how far a falling leaf tips over each way as it rocks, radians

/*
	The particles: leaves blowing off the trees, spray off the crests of the waves, and rain. See particles.js for what runs when.

	LEAVES and SPRAY are kept: each one has a place and a speed in a buffer, and a compute shader moves them all on a little
	every frame (c_leaves, c_spray). RAIN is not kept at all: where a drop is can be worked out from the time alone, so it
	is, in the vertex shader that draws it (vf_rain).

	All three are drawn the way the grass and the trees are, with no models and no vertex buffers: one instance is one
	particle, and the vertex shader makes a small card for it out of the number of the vertex.
*/

const particleUniforms =
`
	struct ParticleUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz, w: time in seconds
		cameraRight : vec4f,		// xyz: which way is right on the screen, in the world. w: how heavy a leaf is (1 = as it comes)
		cameraUp : vec4f,			// xyz: and up
		windScroll : vec4f,			// these two are what windAt takes, see vf_wind.js
		windBlow : vec4f,
		step : vec4f,				// x: seconds since the last frame, y: the speed of the wind in world units a second, z: the number of the frame, w: how readily leaves let go
		terrain : vec4f,			// x: half the width of the terrain, y: size of a terrain grid cell, z: sea level, w: world units in a metre
		counts : vec4f,				// x: how many places leaves can come from, y: how many things stand in their way, z: how many vertices of water there are to look for crests in, w: rain, 0 to 1
		cloudMap : vec4f,			// where the cloud coverage map is: what cloudShadeAt takes (vfc_clouds.js)
		amounts : vec4f,			// x: size of a leaf, y: how much spray, z: how far from the camera rain is drawn, w: how much rain
	}
	@group(0) @binding(0) var<uniform> PU: ParticleUniforms;

	// one leaf, or one bit of spray
	struct Particle
	{
		position : vec3f,
		life : f32,			// seconds it has left (of whatever it is doing, see state)
		velocity : vec3f,
		state : f32,
		extra : vec4f,		// a leaf's x: how far through its rocking it is, y: how far it has been tumbled over, z: which way its length points (all in radians)
							// spray's xy: the way the crest it came off runs (along x and z), z: half the length of its line, w: a number of its own
	}

	//------------------RANDOM-----------------
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

	// the corner of a card for a vertex number: 2 triangles, each corner -1 or 1 along x and y
	fn cardCorner(vertexIndex: u32) -> vec2f {
		var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
		return corners[vertexIndex];
	}
`;

/*
	LEAVES
	What a leaf is doing is its state:
		0	still on the tree (not drawn). life is how long until it lets go, which runs down faster in a wind
		1	in the air (see HOW A LEAF FALLS)
		2	knocked: it touched something, lost its way and is dropping straight down
		3	on the ground, where it lies a couple of seconds, shrinking away, and then goes back to being 0 on some tree

	THINGS IN THE WAY (obstacles: tree trunks, boulders, the buildings, as upright cylinders)
		Air does not go through a tree trunk, it goes round it, and a leaf in that air goes round with it, the way water
		parts round a rock in a river. So near anything in the way, the part of the wind that blows AT it is taken off and
		put on along its side instead, more and more the closer the leaf is. Only a leaf that still gets to the surface
		(a gust drove it in) counts as touching, and goes to state 2. The ground is not one of these: that is where leaves land.
		But rising ground is seen coming: the height of the land a little way ahead of the leaf is looked up, and if it is
		higher than the leaf the air carries it up and over (as Ghost of Tsushima's leaves do: its wind talk describes
		"taking several height map samples out in front of each particle and giving it an upwards velocity in advance").

	HOW A LEAF FALLS
		Two things act on it, and nothing else:
			gravity		the same 9.81 metres a second every second as on anything
			drag		the air pushes on it by how fast it is moving THROUGH the air, towards whatever the air is doing.
						That is all the wind is to a leaf: with no wind the drag slows its fall, in a wind the same drag
						carries it off sideways, and in the rising air of a gust it can lift it
		The two settle against each other at the speed where the drag is as strong as the weight: about 2 metres a second
		for a leaf lying level in the air (more for a heavier one, see Leaf Weight), and nearly twice that for one on edge,
		which has much less of itself to the air.

		And a leaf does not stay level. It ROCKS, tipping over one way and then back the other every couple of seconds,
		and each time it is tipped it slides off down its own slope. So it comes down in swoops from side to side, faster
		through the middle of each. Only air going past it hard (a gust arriving, or the moment it is let go into a wind)
		tumbles it right over. How far through its rocking it is, how far it has been tumbled and which way it points are
		kept with the leaf, so the leaf that is drawn is leaning the way the one that is falling is.
*/
export const c_leaves =
`
	${particleUniforms}

	@group(0) @binding(1) var<storage, read_write> leaves: array<Particle>;
	@group(0) @binding(2) var<storage, read> sources: array<vec4f>;		// where leaves come from. xyz: the middle of a tree's crown, w: its radius
	@group(0) @binding(3) var<storage, read> obstacles: array<vec4f>;	// what stands in their way. x, z: where, as x and y. z: its radius, w: the height of its top
	@group(0) @binding(4) var windTexture: texture_2d<f32>;
	@group(0) @binding(5) var windSampler: sampler;
	@group(0) @binding(6) var terrainFields: texture_2d<f32>;			// per terrain grid point: height, cover, normal.x, normal.z

	${windShapes}

	// the height of the ground at a place, bilinear between the 4 grid points around it. Water counts as ground: a leaf lands on it
	fn groundAt(xz: vec2f) -> f32 {
		let maxPoint = vec2f(textureDimensions(terrainFields)) - vec2f(1.001, 1.001);
		let grid = clamp((xz + vec2f(PU.terrain.x, PU.terrain.x)) / PU.terrain.y, vec2f(0.0, 0.0), maxPoint);
		let base = vec2i(floor(grid));
		let f = fract(grid);
		let a = textureLoad(terrainFields, base, 0).x;
		let b = textureLoad(terrainFields, base + vec2i(1, 0), 0).x;
		let c = textureLoad(terrainFields, base + vec2i(0, 1), 0).x;
		let d = textureLoad(terrainFields, base + vec2i(1, 1), 0).x;
		return max(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), PU.terrain.z);
	}

	@compute @workgroup_size(${PARTICLE_WORKGROUP_SIZE})
	fn computeMain(@builtin(global_invocation_id) id: vec3u) {
		let index = id.x;
		if (index >= arrayLength(&leaves)) {
			return;
		}
		var leaf = leaves[index];
		let elapsed = PU.step.x;
		let metre = PU.terrain.w;
		let own = random(index * 7919u + 13u);							// this leaf's own number, the same for all its lives
		let chance = index * 9781u + u32(PU.step.z) * 104729u;			// and a different draw every frame

		if (leaf.state < 0.5) {
			//------------------ON THE TREE-----------------
			leaf.life -= elapsed * PU.step.w * (0.3 + PU.windScroll.w);
			if (leaf.life <= 0.0) {
				let count = u32(PU.counts.x);
				if (count == 0u) {
					leaf.life = 1.0;	// no trees near: ask again in a while
				} else {
					let tree = sources[min(u32(random(chance) * f32(count)), count - 1u)];
					// from somewhere in the crown, more often out near its edge
					let turn = random(chance + 1u) * 6.2832;
					let rise = random(chance + 2u) * 2.0 - 1.0;
					let level = sqrt(1.0 - rise * rise);
					leaf.position = tree.xyz + vec3f(cos(turn) * level, rise * 0.8, sin(turn) * level) * tree.w * sqrt(random(chance + 3u));
					leaf.velocity = vec3f(0.0, 0.0, 0.0);
					leaf.extra = vec4f(random(chance + 6u) * 6.2832, 0.0, random(chance + 7u) * 6.2832, 0.0);
					leaf.state = 1.0;
					leaf.life = 40.0;
				}
			}
		} else if (leaf.state < 2.5) {
			//------------------IN THE AIR-----------------
			if (leaf.state < 1.5) {
				// the air where the leaf is
				let wind = windAt(leaf.position.xz, PU.windScroll, PU.windBlow);
				var air = wind.xy * PU.step.y;
				// in a gust the air is rising as well, for as long as the gust is passing
				var rising = max(wind.z - 0.6, 0.0) * 2.2 * (0.6 + 0.4 * wind.w) * PU.step.y * 0.45;

				// round whatever stands in the way (see THINGS IN THE WAY above)
				var touched = false;
				let count = u32(PU.counts.y);
				for (var i = 0u; i < count; i++) {
					let thing = obstacles[i];
					if (leaf.position.y > thing.w) {
						continue;	// over the top of it
					}
					let away = leaf.position.xz - thing.xy;
					let apart = length(away);
					let reach = thing.z * 2.6 + 1.5;
					if (apart < thing.z + 0.12) {
						touched = true;
					} else if (apart < reach) {
						let outward = away / apart;
						let near = 1.0 - smoothstep(thing.z, reach, apart);
						let towards = min(dot(air, outward), 0.0);		// how fast the air is blowing at it (below 0), nothing if it blows away
						var along = vec2f(-outward.y, outward.x);		// round its side: whichever way round the air is already leaning
						if (dot(air, along) < 0.0) {
							along = -along;
						}
						air += (-outward * towards + along * (-towards)) * near;
					}
				}

				// and over ground that rises ahead of it
				let pace = length(leaf.velocity.xz);
				if (pace > 0.5) {
					let ahead = groundAt(leaf.position.xz + leaf.velocity.xz / pace * (2.0 + 0.6 * pace));
					rising += clamp((ahead + 1.2 * metre - leaf.position.y) * 2.0, 0.0, 1.5 * pace);
				}

				// (see HOW A LEAF FALLS above)
				// the rocking, a little quicker the harder the air is going past. And air going past hard turns it right over
				let passing = length(vec3f(air.x, rising, air.y) - leaf.velocity);
				let handed = select(-1.0, 1.0, fract(own * 13.7) > 0.5);
				leaf.extra.x += elapsed * (1.5 + 1.3 * own) * (0.7 + 0.03 * passing / metre);
				leaf.extra.y += elapsed * handed * min(max(passing / metre - 2.5, 0.0) * 0.7, 4.5);
				leaf.extra.y -= elapsed * 0.6 * sin(2.0 * leaf.extra.y);		// (left alone it comes back to level, one way up or the other)
				leaf.extra.z += elapsed * handed * (0.3 + 0.6 * fract(own * 7.1));
				let tilt = ${LEAF_ROCK} * sin(leaf.extra.x) + leaf.extra.y;
				let level = vec2f(-sin(leaf.extra.z), cos(leaf.extra.z));		// across the leaf, as it would lie flat (the same in vf_leaves)

				let gravity = 9.81 * metre;
				let weight = PU.cameraRight.w * (0.85 + 0.35 * fract(own * 3.3));
				let faceOn = cos(tilt) * cos(tilt);								// 1 lying level in the air, 0 on edge
				let dragDown = 5.0 * (0.45 + 0.75 * faceOn) / weight;
				let dragAcross = 3.6 / weight;
				// tipped, it slides off down its own slope
				let slide = -level * (gravity * 0.9 * sin(tilt) * cos(tilt));
				// (the drag is worked out for the end of the step, not the start: that way a long frame cant make it overshoot)
				let acrossSpeed = (leaf.velocity.xz + elapsed * (slide + dragAcross * air)) / (1.0 + dragAcross * elapsed);
				let downSpeed = (leaf.velocity.y + elapsed * (dragDown * rising - gravity)) / (1.0 + dragDown * elapsed);
				leaf.velocity = vec3f(acrossSpeed.x, downSpeed, acrossSpeed.y);

				if (touched) {
					leaf.state = 2.0;
					leaf.velocity *= 0.08;
				}
			} else {
				// knocked: straight down, on edge
				leaf.velocity += (vec3f(0.0, -2.6 * metre, 0.0) - leaf.velocity) * min(elapsed * 3.0, 1.0);
			}

			leaf.position += leaf.velocity * elapsed;
			leaf.life -= elapsed;

			let ground = groundAt(leaf.position.xz) + 0.05;
			if (leaf.position.y <= ground) {
				leaf.position.y = ground;
				leaf.velocity = vec3f(0.0, 0.0, 0.0);
				leaf.state = 3.0;
				leaf.life = 2.5;
			} else if (leaf.life <= 0.0 || distance(leaf.position.xz, PU.cameraPosition.xz) > 320.0) {
				// blown clean away: back to a tree
				leaf.state = 0.0;
				leaf.life = random(chance + 5u) * 4.0;
			}
		} else {
			//------------------ON THE GROUND-----------------
			leaf.life -= elapsed;
			if (leaf.life <= 0.0) {
				leaf.state = 0.0;
				leaf.life = random(chance + 5u) * 3.0;
			}
		}

		leaves[index] = leaf;
	}
`;

// The leaves drawn: a card each, leaning the way the leaf is as it falls (see HOW A LEAF FALLS), flat once it has landed, cut to the outline of a leaf in the fragment shader
export const vf_leaves =
`
	${particleUniforms}

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
	@group(0) @binding(2) var<storage, read> leaves: array<Particle>;

	${moonShapes}

	struct LeafOutput {
		@builtin(position) pos: vec4f,
		@location(0) card: vec2f,		// where on the card, -1 to 1 each way
		@location(1) normal: vec3f,
		@location(2) tone: f32,
	};

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> LeafOutput {
		var output: LeafOutput;
		output.pos = vec4f(2.0, 2.0, 2.0, 1.0);		// (a leaf still on its tree has every vertex put here, off the screen)
		let leaf = leaves[instanceIndex];
		if (leaf.state < 0.5) {
			return output;
		}
		let own = random(instanceIndex * 7919u + 13u);
		let corner = cardCorner(vertexIndex);

		// which way it faces: its length level, pointing wherever it has swung round to, and tipped about its length by its
		//		rocking and tumbling (the same numbers c_leaves falls by). Flat on the ground
		let along = vec3f(cos(leaf.extra.z), 0.0, sin(leaf.extra.z));
		let level = vec3f(-along.z, 0.0, along.x);
		var tilt = ${LEAF_ROCK} * sin(leaf.extra.x) + leaf.extra.y;
		var size = PU.amounts.x * (0.7 + 0.6 * own);
		if (leaf.state > 2.5) {
			tilt = 0.0;
			size *= saturate(leaf.life / 1.2);		// it goes by shrinking away
		}
		let side = level * cos(tilt) + vec3f(0.0, 1.0, 0.0) * sin(tilt);

		let position = leaf.position + (along * corner.x + side * corner.y * 0.55) * size;
		output.pos = PU.viewProjectionMatrix * vec4f(position, 1.0);
		output.card = corner;
		output.normal = cross(along, side);
		output.tone = fract(own * 37.0);
		return output;
	}

	@fragment
	fn fragmentMain(input: LeafOutput) -> @location(0) vec4f {
		// the outline: an oval that comes to a point at both ends
		if (abs(input.card.y) > (1.0 - input.card.x * input.card.x) * 0.95 + 0.05) {
			discard;
		}
		// green ones, yellow ones, and brown ones that were ready to fall anyway
		var albedo = mix(vec3f(0.2, 0.36, 0.1), vec3f(0.6, 0.5, 0.12), smoothstep(0.25, 0.55, input.tone));
		albedo = mix(albedo, vec3f(0.42, 0.22, 0.08), smoothstep(0.6, 0.9, input.tone));
		albedo *= 1.0 - 0.3 * (1.0 - smoothstep(0.0, 0.12, abs(input.card.y)));		// the rib

		// the same light as everything else, on whichever side of the leaf is seen
		let L = normalize(Lights.sunPos.xyz);
		let N = normalize(input.normal);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.09 + daylight * (0.34 + 0.72 * (0.3 + 0.7 * abs(dot(N, L))));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		return vec4f(albedo * (light * sunTint + moonLight(N)), 1.0);
	}
`;

/*
	SPRAY
	Where the crests are is already known: the water's own compute pass works out how hard the surface is being squeezed
	together at every vertex of its mesh (the foam factor, see the jacobian in c_water), and keeps it in the vertex buffer.
	So a bit of spray that has run out picks a vertex of the water at random (from the tile under the camera), and if the
	water is foaming there, that is where it starts again. No crest, no spray, and the more foam the more of it.

	A crest is a line, and what comes off it comes off all along it. So one bit of spray is not a puff but a short LINE of
	it, lying along the crest it started from: the crest runs across the way the wave is travelling, and the wave travels
	the way its face leans, which the water's normal at that vertex gives. Lines from neighbouring vertices of the same
	crest overlap end to end, and the spray stands along the crest as the crest is shaped.

	Two kinds, by the sign of state (whose size is how long this one lasts in all):
		spritz (+)	a line of droplets thrown up off the crest and forwards, that falls back. Quick and bright
		mist (-)	the fine part, a thin ribbon that hangs over the crest and drifts off down wind
*/
export const c_spray =
`
	${particleUniforms}

	@group(0) @binding(1) var<storage, read_write> spray: array<Particle>;
	@group(0) @binding(2) var<storage, read> waterVertices: array<f32>;		// the water mesh under the camera, 8 numbers a vertex: position, foam, depth, normal
	@group(0) @binding(3) var windTexture: texture_2d<f32>;
	@group(0) @binding(4) var windSampler: sampler;

	${windShapes}

	@compute @workgroup_size(${PARTICLE_WORKGROUP_SIZE})
	fn computeMain(@builtin(global_invocation_id) id: vec3u) {
		let index = id.x;
		if (index >= arrayLength(&spray)) {
			return;
		}
		var drop = spray[index];
		let elapsed = PU.step.x;
		let chance = index * 9781u + u32(PU.step.z) * 104729u;

		if (drop.life > 0.0) {
			let wind = windAt(drop.position.xz, PU.windScroll, PU.windBlow).xy * PU.step.y;
			if (drop.state > 0.0) {
				// a spurt: thrown, and falling
				drop.velocity.y -= 9.0 * PU.terrain.w * elapsed;
				drop.velocity += (vec3f(wind.x, drop.velocity.y, wind.y) - drop.velocity) * min(elapsed * 0.8, 1.0);
			} else {
				// mist: carried off on the wind, sinking slowly
				drop.velocity += (vec3f(wind.x, -0.3, wind.y) - drop.velocity) * min(elapsed * 1.6, 1.0);
			}
			drop.position += drop.velocity * elapsed;
			drop.life -= elapsed;
		} else {
			let count = u32(PU.counts.z);
			if (count > 0u && random(chance) < PU.amounts.y) {
				let first = min(u32(random(chance + 1u) * f32(count)), count - 1u) * 8u;
				let foam = waterVertices[first + 3u];
				if (foam > 0.25 && random(chance + 2u) < foam) {
					let crest = vec3f(waterVertices[first], waterVertices[first + 1u], waterVertices[first + 2u]);
					// which way the wave is going: the way its face leans, or with the wind where the water is too level to say.
					//		And of the two ways along that, the one the wind blows
					var travel = vec2f(waterVertices[first + 5u], waterVertices[first + 7u]);
					if (length(travel) < 0.06) {
						travel = PU.windBlow.xy;
					}
					travel = normalize(travel + vec2f(0.0001, 0.0));
					if (dot(travel, PU.windBlow.xy) < 0.0) {
						travel = -travel;
					}
					let crestLine = vec2f(-travel.y, travel.x);
					let slid = (random(chance + 3u) - 0.5) * 2.0;		// somewhere along the crest from the vertex
					drop.position = crest + vec3f(crestLine.x * slid, 0.15, crestLine.y * slid);
					if (random(chance + 5u) < 0.7) {
						let lasts = 0.55 + 0.6 * random(chance + 6u);
						let thrown = (1.0 + 2.5 * random(chance + 7u)) * foam;
						drop.velocity = vec3f(travel.x * thrown, (2.5 + 4.0 * random(chance + 8u)) * foam, travel.y * thrown);
						drop.extra = vec4f(crestLine, 2.0 + 3.5 * random(chance + 9u), random(chance + 10u));
						drop.life = lasts;
						drop.state = lasts;
					} else {
						let lasts = 1.4 + 1.6 * random(chance + 6u);
						drop.velocity = vec3f(0.0, 0.4 + 0.9 * random(chance + 8u), 0.0);
						drop.extra = vec4f(crestLine, 3.0 + 4.0 * random(chance + 9u), random(chance + 10u));
						drop.life = lasts;
						drop.state = -lasts;
					}
				}
			}
		}
		spray[index] = drop;
	}
`;

// The spray drawn: each a ribbon lying along its crest and turned about its length to face the camera, white with a little blue in it.
//		A spritz is droplets, each a dot in a cell of a grid laid over the ribbon. Mist is the ribbon itself, soft
export const vf_spray =
`
	${particleUniforms}

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
	@group(0) @binding(2) var<storage, read> spray: array<Particle>;

	${moonShapes}

	struct SprayOutput {
		@builtin(position) pos: vec4f,
		@location(0) card: vec2f,			// where on the ribbon: x along the crest, y up it, -1 to 1 each way
		@location(1) strength: f32,
		@location(2) look: vec3f,			// x: 1.0 for mist, 0.0 for a spritz, y: droplets along the ribbon, z: a number of its own
		@location(3) distant: f32,			// 0 near the camera, 1 far enough off that a droplet is smaller than a pixel
	};

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> SprayOutput {
		var output: SprayOutput;
		output.pos = vec4f(2.0, 2.0, 2.0, 1.0);
		let drop = spray[instanceIndex];
		if (drop.life <= 0.0) {
			return output;
		}
		let corner = cardCorner(vertexIndex);
		let age = 1.0 - drop.life / abs(drop.state);		// 0 just thrown up, 1 gone
		let mist = step(drop.state, 0.0);

		// along the crest, and "up" the ribbon: square to both the crest and the line of sight, so the ribbon faces the camera.
		//		(looked at from the end, along the crest, there is no such way: there it stands upright, and is seen edge on as a sheet would be)
		let crestLine = normalize(vec3f(drop.extra.x, 0.0, drop.extra.y) + vec3f(0.0001, 0.0, 0.0));
		let toCamera = normalize(PU.cameraPosition.xyz - drop.position);
		var upRibbon = cross(crestLine, toCamera);
		if (upRibbon.y < 0.0) {
			upRibbon = -upRibbon;
		}
		upRibbon = normalize(upRibbon + vec3f(0.0, 0.25, 0.0));

		// a spritz starts as a thin line on the crest and opens upwards as the droplets fly, mist swells as it thins out
		let halfLength = drop.extra.z * (1.0 + 0.35 * age);
		let halfHeight = mix(0.2 + 2.6 * age, 0.7 + 2.4 * age, mist);
		let position = drop.position + crestLine * corner.x * halfLength + upRibbon * corner.y * halfHeight;
		output.pos = PU.viewProjectionMatrix * vec4f(position, 1.0);
		output.card = corner;
		// in at once, out slowly
		output.strength = smoothstep(0.0, 0.1, age) * (1.0 - age) * mix(0.95, 0.22, mist);
		output.look = vec3f(mist, drop.extra.z * 2.2, drop.extra.w);
		output.distant = smoothstep(25.0, 120.0, distance(PU.cameraPosition.xyz, drop.position));
		return output;
	}

	// One droplet to a cell of a grid: somewhere in its cell, its own size, and some cells empty. p: where, in cells
	fn droplets(p: vec2f, seed: u32) -> f32 {
		let cell = vec2u(p);
		let id = hash((cell.x * 73856093u) ^ (cell.y * 19349663u) ^ seed);
		if (random(id) < 0.35) {
			return 0.0;
		}
		let middle = vec2f(0.28, 0.28) + 0.44 * vec2f(random(id + 1u), random(id + 2u));
		let radius = 0.14 + 0.2 * random(id + 3u);
		return 1.0 - smoothstep(0.35 * radius, radius, distance(fract(p), middle));
	}

	@fragment
	fn fragmentMain(input: SprayOutput) -> @location(0) vec4f {
		// thickest along the middle of the line and running out to both ends, thickest at the crest and thinning upwards
		let alongLine = saturate(1.0 - input.card.x * input.card.x);
		let upLine = input.card.y * 0.5 + 0.5;
		var cover = 0.0;
		if (input.look.x > 0.5) {
			cover = alongLine * alongLine * saturate(1.0 - input.card.y * input.card.y);
			cover *= cover;
		} else {
			let seed = u32(input.look.z * 65535.0);
			let p = vec2f((input.card.x * 0.5 + 0.5) * input.look.y, upLine * 4.0) + vec2f(1.0, 1.0);
			let drops = max(droplets(p, seed), 0.8 * droplets(p * 2.3 + vec2f(7.0, 3.0), seed + 77u));
			// (and a little of the fine stuff between the droplets, so a line of them reads as one thing. From far off that is all of it)
			cover = mix(drops + 0.22, 0.6, input.distant) * sqrt(alongLine) * (1.0 - upLine * upLine * upLine);
		}
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let color = vec3f(0.86, 0.93, 1.0) * (0.12 + 0.88 * daylight) + moonGlow() * 0.5;
		return vec4f(color, saturate(cover) * input.strength);
	}
`;

/*
	RAIN
	Nothing is kept for a raindrop. Drop number i starts from a place that is worked out from i alone, falls at a steady
	speed, slanted by the wind, and whenever it leaves the box of air round the camera it comes back in on the other side:
	its place is just (where it started + how far it has fallen since time 0), wrapped into the box. So the box is always
	full of rain, the same drops whichever way the camera goes, and it costs nothing but drawing them.

	Each is a thin streak along the way it is falling. It only shows where it is raining: under deep cloud, by the blue
	channel of the cloud coverage map (c_cloudCoverage), so walking out from under a storm walks out of the rain.
*/
export const vf_rain =
`
	${particleUniforms}

	@group(0) @binding(1) var cloudMap: texture_2d<f32>;
	@group(0) @binding(2) var cloudMapSampler: sampler;

	${cloudShadeShapes}

	struct RainOutput {
		@builtin(position) pos: vec4f,
		@location(0) card: vec2f,
		@location(1) strength: f32,
	};

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> RainOutput {
		var output: RainOutput;
		output.pos = vec4f(2.0, 2.0, 2.0, 1.0);
		if (PU.counts.w <= 0.0) {
			return output;
		}
		let corner = cardCorner(vertexIndex);
		let box = vec3f(PU.amounts.z * 2.0, PU.amounts.z * 1.3, PU.amounts.z * 2.0);
		let start = vec3f(random(instanceIndex * 3u + 1u), random(instanceIndex * 3u + 2u), random(instanceIndex * 3u + 3u)) * box;

		// falling at about 9 metres a second, and leaning with the wind
		let velocity = vec3f(PU.windBlow.x * PU.step.y * 0.9, -9.0 * PU.terrain.w * (0.85 + 0.3 * random(instanceIndex + 77u)), PU.windBlow.y * PU.step.y * 0.9);
		let fallen = start + velocity * PU.cameraPosition.w;
		let middle = PU.cameraPosition.xyz;
		let position = middle + (fract((fallen - middle) / box) - vec3f(0.5, 0.5, 0.5)) * box;

		// is it raining here?
		let raining = cloudShadeAt(position, vec3f(0.0, 1.0, 0.0), PU.cloudMap).b;
		// thinner rain is fewer drops: each drop has its own point at which it joins in
		let joins = random(instanceIndex + 991u);
		if (raining * PU.amounts.w <= joins) {
			return output;
		}

		// a streak: as long as the drop falls in a fortieth of a second, and a hair wide, turned to face the camera
		let fallDirection = normalize(velocity);
		let toCamera = normalize(middle - position);
		let across = normalize(cross(fallDirection, toCamera));
		let streak = position + fallDirection * corner.y * length(velocity) * 0.0125 + across * corner.x * 0.012 * PU.terrain.w;
		output.pos = PU.viewProjectionMatrix * vec4f(streak, 1.0);
		output.card = corner;
		// fading out towards the edge of the box, so drops do not pop as they wrap round
		let fromMiddle = abs(position - middle) / (box * 0.5);
		output.strength = (1.0 - smoothstep(0.75, 1.0, max(fromMiddle.x, max(fromMiddle.y, fromMiddle.z)))) * saturate(PU.counts.w);
		return output;
	}

	@fragment
	fn fragmentMain(input: RainOutput) -> @location(0) vec4f {
		let soft = (1.0 - abs(input.card.x)) * (1.0 - input.card.y * input.card.y);
		return vec4f(0.72, 0.78, 0.86, 0.34 * soft * input.strength);
	}
`;
