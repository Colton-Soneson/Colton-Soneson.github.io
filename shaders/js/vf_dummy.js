import { moonShapes } from './f_moon.js';

/*
	The other players drawn, as crash test dummies (players.js: the mesh, 90 triangles in metres, and the rifle they carry, 12).

	One mesh, drawn once for every player (instancing). What moves is done here, from each vertex's part (shape.w):
		0			the pelvis, with the player's own colour round it (a belt)
		1			the chest
		2			the neck and the head: tipped up and down with where the player looks (pitch), about the neck
		3, 4		the left upper arm and forearm		with the rifle, tipped with the look about the shoulders: the rifle
		5, 6		the right upper arm and forearm		is held where the player is looking
		7, 8		the left thigh and shin				swing from the hip with the walk, the shin bending back at the knee as
		9, 10		the right thigh and shin			the leg comes forward
		11			the rifle
	Then the whole dummy is turned to its heading, made its size and put in its place. A dead one has gone over on to its back,
	about its feet. A hit one flashes red for a moment.
	The colours are a crash test dummy's: yellow, the joints black, and the black and yellow quartered circles on the sides of
	the head and on the chest.
*/
export const vf_dummy =
`
	struct DummyUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz
		look : vec4f,				// x: horizon fog distance, y: 1.0 if the atmosphere is on
	}
	@group(0) @binding(0) var<uniform> DU: DummyUniforms;

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
	@group(0) @binding(2) var skyLUT: texture_2d<f32>;
	@group(0) @binding(3) var skySampler: sampler;

	struct VertexInput {
		@location(0) shape: vec4f,		// xyz: the mesh, in metres, standing on y = 0 and facing +z. w: which part (see the top of the file)
		@location(1) place: vec4f,		// this player: xyz where its feet are, w: world units to the metre
		@location(2) pose: vec4f,		// x: heading (radians, round from +z towards +x), y: pitch (radians, up), z: where it is in its stride (radians), w: walking, 0 to 1
		@location(3) state: vec4f,		// x: gone over, 0 standing to 1 flat on its back, y: hit, 1 just hit fading to 0, z: its colour (0 to 1 round the hues)
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) onDummy: vec4f,		// xyz: where on the mesh as it was made, w: the part
		@location(2) @interpolate(flat) state: vec4f,
	};

	fn turnX(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x, v.y * cos(angle) - v.z * sin(angle), v.y * sin(angle) + v.z * cos(angle)); }
	fn turnY(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) + v.z * sin(angle), v.y, v.z * cos(angle) - v.x * sin(angle)); }

	const NECK: vec3f = vec3f(0.0, 1.55, 0.0);
	const SHOULDERS: vec3f = vec3f(0.0, 1.45, 0.0);
	const HIP_Y: f32 = 0.95;
	const KNEE_Y: f32 = 0.5;

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		var p = input.shape.xyz;
		let part = i32(input.shape.w + 0.5);
		let pitch = input.pose.y;

		if (part == 2) {
			p = NECK + turnX(p - NECK, -0.6 * pitch);
		} else if ((part >= 3 && part <= 6) || part == 11) {
			p = SHOULDERS + turnX(p - SHOULDERS, -pitch);
		} else if (part >= 7 && part <= 10) {
			// a leg: the left and the right half a stride apart
			let left = part <= 8;
			let phase = input.pose.z + select(3.14159265, 0.0, left);
			let walking = input.pose.w;
			let hip = vec3f(select(-0.1, 0.1, left), HIP_Y, 0.0);
			if (part == 8 || part == 10) {
				let knee = vec3f(p.x, KNEE_Y, 0.0);
				p = knee + turnX(p - knee, -max(sin(phase), 0.0) * 0.9 * walking);
			}
			p = hip + turnX(p - hip, cos(phase) * 0.5 * walking);
		}

		// a dead one goes over on to its back, about its heels
		let over = input.state.x * 1.5;
		let fallen = turnX(p, -over) + vec3f(0.0, 0.12 * sin(over), 0.0);
		let position = input.place.xyz + turnY(fallen, input.pose.x) * input.place.w;

		var output: VertexOutput;
		output.pos = DU.viewProjectionMatrix * vec4f(position, 1.0);
		output.worldPos = position;
		output.onDummy = vec4f(input.shape.xyz, f32(part));
		output.state = input.state;
		return output;
	}

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;	// see f_water

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

	// a hue (0 to 1) as a colour
	fn hueColor(h: f32) -> vec3f {
		return saturate(abs(fract(vec3f(h) + vec3f(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0);
	}

	// black and yellow quarters in a circle round (a, b) on a face, 1 where black
	fn quartered(u: f32, v: f32, radius: f32) -> f32 {
		if (u * u + v * v > radius * radius) {
			return 0.0;
		}
		return select(0.0, 1.0, u * v > 0.0);
	}

	struct FragInput {
		@location(0) worldPos: vec3f,
		@location(1) onDummy: vec4f,
		@location(2) @interpolate(flat) state: vec4f,
	};

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let toDummy = input.worldPos - Lights.camPos.xyz;
		let away = length(toDummy);
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		if (dot(N, toDummy) > 0.0) {
			N = -N;
		}

		let at = input.onDummy.xyz;
		let part = i32(input.onDummy.w + 0.5);
		let yellow = vec3f(0.86, 0.66, 0.08);
		let black = vec3f(0.035, 0.035, 0.04);
		var albedo = yellow;
		if (part == 0) {
			albedo = mix(yellow, hueColor(input.state.z) * 0.8, step(0.96, at.y));		// the belt
		} else if (part == 4 || part == 6 || part == 8 || part == 10) {
			albedo = mix(black, yellow, smoothstep(0.0, 0.02, abs(at.y - select(1.3, 0.5, part >= 8)) - 0.05));	// the elbows and the knees
		} else if (part == 11) {
			albedo = vec3f(0.2, 0.12, 0.06);
		} else if (part == 2) {
			if (at.y < 1.6) {
				albedo = black;		// the neck
			} else if (abs(at.x) > 0.095) {
				albedo = mix(yellow, black, quartered(at.z - 0.01, at.y - 1.71, 0.065));		// the sides of the head
			}
		} else if (part == 1 && at.z > 0.105) {
			albedo = mix(yellow, black, quartered(at.x - 0.08, at.y - 1.36, 0.06));			// the chest
		}

		// the same light as everything else
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.09 + daylight * (0.34 + 0.72 * saturate(dot(N, L)));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		var color = albedo * (light * sunTint + moonLight(N));
		color = mix(color, vec3f(0.9, 0.05, 0.03), 0.7 * input.state.y);

		if (DU.look.y > 0.5) {
			let horizonColor = skyColorAt(vec3f(toDummy.x, HORIZON_LIFT * length(toDummy.xz), toDummy.z));
			let fog = 1.0 - exp(-pow(away / DU.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, 1.0);
	}
`;
