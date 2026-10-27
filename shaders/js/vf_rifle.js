import { motionShapes } from './motionShapes.js';
/*
	The rifle in the hunter's hands (see rifle.js for the rifle itself, its triangles, and what it does).

	It is drawn in the camera's own space, in metres: the camera at the origin looking down -z. That keeps it steady wherever
	the hunter is in the world, and lets it have its own near plane (1 cm) and its own depth, so it never pokes into a tree
	or the ground in front of it. gun is where the rifle is held this frame (at the hip or at the eye, the recoil, the
	walk), from the rifle's own space (+z out of the muzzle) into the camera's.

	What moves, by each vertex's part (shape.w, a whole number: part + 32 x material, as viewmodel.js's meshBuilder makes them):
		part 1, the bolt		turned up about the bore by boltLift, and drawn back by boltBack (metres)
		part 2, the trigger		back by trigger, 0 to 1
		parts 3 to 6, rounds	each made with its base at the origin, moved to rounds[part - 3].xyz. rounds[].w: 0 not
								there (every corner put on one point, so nothing is drawn), 1 an empty case (the bullet
								left out), 2 a round. The thrown out one (part 5) turns over about its middle by spin
		material 0 is the wood, 1 the blued steel, 2 the brass of a case, 3 the copper of a bullet, 4 the dark of the bore
	The light is the sun's or the moon's, turned into the camera's space (lightNow in lighting.js): the same strength as
	everything else gets. Faces are lit flat, from their slope across the screen.
*/
export const vf_rifle =
`
	struct RifleUniforms
	{
		projection : mat4x4f,
		gun : mat4x4f,
		moves : vec4f,			// x: bolt turned up (radians), y: bolt drawn back (metres), z: trigger pulled, 0 to 1
		light : vec4f,			// xyz: towards the light, in the camera's space, w: how strong it is straight on
		ambient : vec4f,		// x: the light from everywhere, y: daylight 0 to 1
		rounds : array<vec4f, 4>,	// where each round's base is (rifle.js, THE ROUNDS), w: 0 not there, 1 an empty case, 2 a round
		spin : vec4f,			// x, y: how far the thrown out one has turned about its own x and y (radians)
	}
	@group(0) @binding(0) var<uniform> RU: RifleUniforms;

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) viewPos: vec3f,
		@location(1) @interpolate(flat) material: f32,
		@location(2) shape: vec3f,
	};

	const BORE: vec2f = vec2f(0.0, 0.002);		// where the bolt turns about, x and y
	const ROUND_MIDDLE: vec3f = vec3f(0.0, 0.0, 0.0385);	// what the thrown out round turns about

	@vertex
	fn vertexMain(@location(0) shape: vec4f) -> VertexOutput {
		let code = i32(shape.w + 0.5);
		let part = code % 32;
		let material = code / 32;
		var p = shape.xyz;
		if (part == 1) {
			let a = RU.moves.x;
			let q = p.xy - BORE;
			p = vec3f(BORE + vec2f(q.x * cos(a) - q.y * sin(a), q.x * sin(a) + q.y * cos(a)), p.z - RU.moves.y);
		} else if (part == 2) {
			p.z -= 0.007 * RU.moves.z;
		} else if (part >= 3) {
			let placed = RU.rounds[part - 3];
			if (placed.w < 0.5 || (material == 3 && placed.w < 1.5)) {
				p = placed.xyz;
			} else {
				if (part == 5) {
					var q = p - ROUND_MIDDLE;
					let a = RU.spin.x;
					let b = RU.spin.y;
					q = vec3f(q.x, q.y * cos(a) - q.z * sin(a), q.y * sin(a) + q.z * cos(a));
					q = vec3f(q.x * cos(b) + q.z * sin(b), q.y, q.z * cos(b) - q.x * sin(b));
					p = ROUND_MIDDLE + q;
				}
				p += placed.xyz;
			}
		}
		let viewPos = (RU.gun * vec4f(p, 1.0)).xyz;
		var output: VertexOutput;
		output.pos = RU.projection * vec4f(viewPos, 1.0);
		output.viewPos = viewPos;
		output.material = f32(material);
		output.shape = shape.xyz;
		return output;
	}

	fn shade(input: VertexOutput) -> vec4f {
		var N = normalize(cross(dpdx(input.viewPos), dpdy(input.viewPos)));
		if (dot(N, input.viewPos) > 0.0) {
			N = -N;
		}
		let V = normalize(-input.viewPos);
		let L = normalize(RU.light.xyz);
		let diffuse = saturate(dot(N, L));

		var color: vec3f;
		if (input.material < 0.5) {
			// the wood: a red brown birch stock under shellac, the grain running along it
			let grain = 0.85 + 0.15 * sin(input.shape.z * 220.0 + sin(input.shape.y * 90.0) * 2.0);
			let albedo = vec3f(0.33, 0.16, 0.07) * grain;
			let shine = pow(saturate(dot(N, normalize(L + V))), 24.0) * 0.12;
			color = albedo * (RU.ambient.x + RU.light.w * diffuse) + vec3f(shine) * RU.light.w;
		} else if (input.material < 1.5) {
			// the steel: blued, nearly black, with a hard highlight
			let albedo = vec3f(0.06, 0.065, 0.075);
			let shine = pow(saturate(dot(N, normalize(L + V))), 48.0) * 0.55;
			color = albedo * (RU.ambient.x + RU.light.w * diffuse) + vec3f(0.7, 0.75, 0.85) * shine * RU.light.w + albedo * 0.6 * RU.ambient.x;
		} else if (input.material > 3.5) {
			// the dark of the bore
			color = vec3f(0.012, 0.012, 0.014) * (RU.ambient.x + RU.light.w * 0.2);
		} else {
			// the brass of a case, or the copper wash of a bullet: a metal, its highlight its own colour
			var albedo = vec3f(0.62, 0.46, 0.2);
			if (input.material > 2.5) {
				albedo = vec3f(0.55, 0.28, 0.15);
			}
			let shine = pow(saturate(dot(N, normalize(L + V))), 32.0) * 0.8;
			color = albedo * (RU.ambient.x + RU.light.w * diffuse) * 0.8 + albedo * shine * RU.light.w;
		}
		return vec4f(color, 1.0);
	}

	// the colour, and THE MOTION (motionShapes.js: temporalAA.js)
	${motionShapes}
	@fragment
	fn fragmentMain(input: VertexOutput) -> FrameOut {
		return FrameOut(shade(input), vec4f(0.0, 0.0, 0.0, 1.0));
	}
`;
