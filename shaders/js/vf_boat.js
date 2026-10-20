import { moonShapes } from './f_moon.js';
import { skyLookupShapes } from './vfc_atmosphere.js';
import { MAX_GROUPS, MAX_ROPES } from '../../code/vessels.js';

/*
	The vessel being sailed, drawn (vessels.js: its mesh, in metres, +x to port, +y up, +z to the bow; boat.js: where it is).

	One mesh, drawn once. What moves is moved here, from each vertex's group and role (see vessels.js), with the boat's state in
	the uniforms. A group turns about its axis: the rudder (and a tiller) about its hinge, a wheel about its axle, a sail and
	its spars about its mast or its stay. A sail's cloth is first hoisted (towards its boom, its tack or its yard, by how far up
	it is), and a gaff with it, then filled by the wind (a curve across it, to leeward) or shaking while it luffs. A rope is a
	thin tube made 0 to 1 along z, laid here between two ends boat.js works out, sagging. The anchor where it is stowed is not
	there while it is down. Then all of it is put where the boat is (the model matrix: turned, made world units, and moved).

	The colours: the hull painted as the vessel says (a colour above, a band along it, the bottom below the water, the inside
	of the bulwarks, and gunports in the band), decks, wood, spars, sailcloth, rope, iron and brass. The control the crosshair
	is on glows.
*/
export const vf_boat =
`
	struct BoatUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz, w: seconds
		look : vec4f,				// x: horizon fog distance, y: 1.0 if the atmosphere is on, z: the control the crosshair is on (-1 for none), w: 1.0 with the anchor down
		model : mat4x4f,			// the boat's metres into the world
		paintTop : vec4f,			// the hull's colours. rgb, and w: up to where the bottom is painted
		paintBand : vec4f,			//		the band along it, w: from
		paintBottom : vec4f,		//		the bottom, w: the band up to
		paintInside : vec4f,		//		the inside of the bulwarks
		ports : vec4f,				// gunports in the band: x: the first's z, y: apart, z: how many, w: half their width
		spare : vec4f,
		groups : array<vec4f, ${MAX_GROUPS * 4}>,	// each: pivot (xyz, w: how it is hoisted), axis (xyz, w: turned by), state (hoisted, filled, shaking, chord), towards (xyz, w: taper)
		ropes : array<vec4f, ${MAX_ROPES * 2}>,		// each: one end (xyz, w: sag), the other end
	}
	@group(0) @binding(0) var<uniform> BU: BoatUniforms;

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
		@location(0) shape: vec4f,		// xyz: the mesh, in metres. w: its material
		@location(1) onSail: vec4f,		// x: up a sail, 0 at the foot to 1 at the head, y: across it, 0 at the luff to 1 at the leech. z: its group, w: its role
		@location(2) extra: vec4f,		// x: the control it is part of, y: the rope it is
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) onBoat: vec4f,		// xyz: where on the mesh as it was made, w: the material
		@location(2) onSail: vec2f,
		@location(3) @interpolate(flat) control: f32,
	};

	// turned about the axis (length 1) by angle, the right hand way (Rodrigues)
	fn turnAbout(v: vec3f, axis: vec3f, angle: f32) -> vec3f {
		return v * cos(angle) + cross(axis, v) * sin(angle) + axis * dot(axis, v) * (1.0 - cos(angle));
	}

	// a sail's curve across it, filled by the wind (metres, + to port before it is swung): deepest a third of the way back from the luff,
	//		and shallower towards the head. Shaking while it luffs: a ripple running back along it
	fn sailCurve(onSail: vec2f, chord: f32, fill: f32, shaking: f32) -> f32 {
		let across = onSail.y;
		let curve = chord * 0.11 * fill * (1.0 - onSail.x * 0.5) * sin(3.14159265 * pow(across, 0.8));
		let ripple = shaking * 0.09 * chord * across * sin(BU.cameraPosition.w * 23.0 - across * 9.0 + onSail.x * 4.0);
		return curve + ripple;
	}

	// a rope: the tube made along z from 0 to 1 laid from a to b, sagging by sag metres in the middle
	fn rope(shape: vec3f, a: vec3f, b: vec3f, sag: f32) -> vec3f {
		let along = b - a;
		let length = max(length(along), 0.0001);
		let d = along / length;
		let other = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(d.y) > 0.9);
		let u = normalize(cross(d, other));
		let w = cross(d, u);
		return a + along * shape.z + (u * shape.x + w * shape.y) * step(0.0005, length) - vec3f(0.0, sag * 4.0 * shape.z * (1.0 - shape.z), 0.0);
	}

	const RIGID: i32 = 0;
	const CLOTH: i32 = 1;
	const HOISTED: i32 = 2;
	const ROPE: i32 = 3;
	const STOWED: i32 = 4;
	const FLAG: i32 = 21;

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		var p = input.shape.xyz;
		let material = i32(input.shape.w + 0.5);
		let group = i32(input.onSail.z + 0.5 * sign(input.onSail.z));
		let role = i32(input.onSail.w + 0.5);

		if (role == ROPE) {
			let r = i32(input.extra.y + 0.5);
			let a = BU.ropes[r * 2];
			p = rope(p, a.xyz, BU.ropes[r * 2 + 1].xyz, a.w);
		} else if (role == STOWED && BU.look.w > 0.5) {
			p = vec3f(0.0, 0.0, 0.0);	// (the anchor is out: all of it one point, nothing drawn)
		} else if (group >= 0) {
			let pivot = BU.groups[group * 4];
			let axis = BU.groups[group * 4 + 1];
			let state = BU.groups[group * 4 + 2];
			let towards = BU.groups[group * 4 + 3];
			if (role == CLOTH || role == HOISTED) {
				// hoisted: down to the boom, in to the tack, or up to the yard
				if (pivot.w > 0.5 && pivot.w < 1.5) {
					p = towards.xyz + (p - towards.xyz) * state.x;
				} else {
					p.y = towards.y + (p.y - towards.y) * state.x;
				}
			}
			if (role == CLOTH) {
				let chord = state.w * (1.0 - input.onSail.x * towards.w) * select(1.0, state.x, pivot.w > 0.5 && pivot.w < 1.5);
				p.x += sailCurve(input.onSail.xy, chord, state.y, state.z);
			}
			if (material == FLAG) {
				let fly = saturate((-p.z - 7.95) / 1.9);
				p.x += fly * 0.25 * sin(BU.cameraPosition.w * 11.0 + fly * 5.0);
			}
			p = pivot.xyz + turnAbout(p - pivot.xyz, axis.xyz, -axis.w);
		}

		let world = (BU.model * vec4f(p, 1.0)).xyz;
		var output: VertexOutput;
		output.pos = BU.viewProjectionMatrix * vec4f(world, 1.0);
		output.worldPos = world;
		output.onBoat = vec4f(input.shape.xyz, f32(material));
		output.onSail = input.onSail.xy;
		output.control = input.extra.x;
		return output;
	}

	const PI: f32 = 3.14159265;
	const HORIZON_LIFT: f32 = 0.016;	// see f_water

	${skyLookupShapes}

	${moonShapes}

	struct FragInput {
		@builtin(front_facing) outside: bool,
		@location(0) worldPos: vec3f,
		@location(1) onBoat: vec4f,
		@location(2) onSail: vec2f,
		@location(3) @interpolate(flat) control: f32,
	};

	// the hull's paint at a place on it: the bottom, the band along it (with its gunports), above it. Seen from inside, the bulwarks
	fn hullPaint(at: vec3f, outside: bool) -> vec3f {
		if (!outside && BU.paintInside.x + BU.paintInside.y + BU.paintInside.z > 0.0 && at.y > BU.paintTop.w + 0.6) {
			return BU.paintInside.rgb;
		}
		if (at.y < BU.paintTop.w) {
			return BU.paintBottom.rgb;
		}
		if (at.y >= BU.paintBand.w && at.y <= BU.paintBottom.w) {
			let port = (at.z - BU.ports.x) / BU.ports.y;
			let nearest = clamp(round(port), 0.0, BU.ports.z - 1.0);
			let inPort = BU.ports.z > 0.5 && abs(at.z - (BU.ports.x + nearest * BU.ports.y)) < BU.ports.w;
			return select(BU.paintBand.rgb, BU.paintTop.rgb, inPort);
		}
		return BU.paintTop.rgb;
	}

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let toBoat = input.worldPos - Lights.camPos.xyz;
		let away = length(toBoat);
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		if (dot(N, toBoat) > 0.0) {
			N = -N;
		}

		let at = input.onBoat.xyz;
		let material = i32(input.onBoat.w + 0.5);
		let uv = input.onSail;
		let sailcloth = vec3f(0.88, 0.87, 0.82);
		let wood = vec3f(0.47, 0.31, 0.16);
		var albedo = vec3f(0.5, 0.5, 0.5);
		var seeThrough = 0.0;	// sailcloth lets the light through: lit from behind, it glows
		var glow = 0.0;
		switch (material) {
			case 0: { albedo = hullPaint(at, input.outside); }
			case 1: { albedo = vec3f(0.6, 0.62, 0.64); }
			case 2: { albedo = vec3f(0.5, 0.52, 0.55); }
			case 3: { albedo = vec3f(0.13, 0.13, 0.14); }
			case 4: { albedo = wood; }
			case 5: { albedo = vec3f(0.62, 0.64, 0.67); }
			case 6: { albedo = mix(sailcloth, vec3f(0.7, 0.12, 0.1), step(0.86, uv.x)); seeThrough = 0.55; }		// a red head
			case 7: { albedo = mix(sailcloth, vec3f(0.12, 0.25, 0.6), step(uv.x, 0.06)); seeThrough = 0.55; }		// a blue foot
			case 8: { albedo = vec3f(0.22, 0.2, 0.18); }
			case 9: { albedo = vec3f(0.14, 0.27, 0.65); }
			case 10: { albedo = vec3f(0.7, 0.16, 0.1); }
			case 11: { albedo = vec3f(0.72, 0.65, 0.48); }
			case 12: { albedo = vec3f(0.7, 0.71, 0.73); }
			case 13: { albedo = vec3f(0.48, 0.49, 0.5); }
			case 14: { albedo = vec3f(0.06, 0.06, 0.07); }
			case 15: {
				// planking, fore and aft, the seams tarred
				let seam = smoothstep(0.0, 0.012, abs(fract(at.x / 0.16) - 0.5) - 0.48);
				albedo = mix(vec3f(0.68, 0.58, 0.42), vec3f(0.25, 0.2, 0.15), seam);
			}
			case 16: { albedo = vec3f(0.55, 0.38, 0.2); }
			case 17: {
				// canvas, sewn in cloths up the sail
				let seam = 1.0 - smoothstep(0.0, 0.04, abs(fract(uv.y * 9.0) - 0.5) - 0.44);
				albedo = mix(vec3f(0.86, 0.81, 0.69), vec3f(0.78, 0.72, 0.6), 1.0 - seam);
				seeThrough = 0.5;
			}
			case 18: { albedo = vec3f(0.08, 0.08, 0.09); }
			case 19: { albedo = vec3f(0.75, 0.58, 0.25); }
			case 20: { albedo = vec3f(0.5, 0.15, 0.1); }
			case 21: {
				// the red ensign: the union in the corner by the staff
				let fly = saturate((-at.z - 7.95) / 1.9);
				let hoist = saturate((at.y - 17.65) / 1.2);
				albedo = vec3f(0.65, 0.08, 0.07);
				if (fly < 0.45 && hoist > 0.5) {
					let stripe = min(abs(fly - 0.225) * 4.0, abs(hoist - 0.75) * 4.0);
					albedo = select(vec3f(0.1, 0.12, 0.4), select(vec3f(0.95, 0.95, 0.95), vec3f(0.7, 0.08, 0.07), stripe < 0.08), stripe < 0.2);
				}
				seeThrough = 0.6;
			}
			case 22: { albedo = vec3f(0.07, 0.065, 0.06); }
			case 23: { albedo = vec3f(1.0, 0.85, 0.5); glow = 1.0; }
			default: {}
		}

		// the same light as everything else. Cloth is lit from either side, and glows with the sun behind it
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let facing = dot(N, L);
		let lit = max(facing, -facing * seeThrough);
		let light = 0.09 + daylight * (0.34 + 0.72 * saturate(lit));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		var color = albedo * (light * sunTint + moonLight(N));
		color = mix(color, albedo * 1.5, glow * (1.0 - daylight * 0.7));		// (the lantern, lit)

		// what the crosshair is on
		if (input.control >= 0.0 && abs(input.control - BU.look.z) < 0.5) {
			color = mix(color, vec3f(1.0, 0.85, 0.35), 0.35 + 0.2 * sin(BU.cameraPosition.w * 6.0));
		}

		if (BU.look.y > 0.5) {
			let horizonColor = fogColorAt(toBoat);
			let fog = 1.0 - exp(-pow(away / BU.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, 1.0);
	}
`;
