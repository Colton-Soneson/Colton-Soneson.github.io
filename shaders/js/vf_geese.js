import { moonShapes } from './f_moon.js';

/*
	The geese drawn. See geese.js for the goose itself (its 25 triangles) and how they fly. Much the same as the hawks
	(vf_birds.js), but a goose is solid, not a flat sheet:
		the beat	every wing vertex knows how far out along the wing it is (0 at the body, 1 at the tip, negative for the left).
					The wing is lifted and dropped by that, squared, so it bends from the shoulder. Geese beat deep and steadily
		folded		on the ground or the water the wings are drawn in along the body, and the neck goes up from where it joins
					the body (the vertices marked 2 are the neck and the head)
		the light	from the faces as they are after all that: the face's own slope, worked out for every pixel from how the
					position changes across the screen (dpdx, dpdy). No normals have to be kept in the mesh, and a wing that has
					been bent is lit as it is bent
	The colors are a Canada goose's: grey brown back and wings, darker flight feathers, pale breast and belly, white under the
	tail, black neck and head with a white strap under the chin.
*/
export const vf_geese =
`
	struct GooseUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz
		look : vec4f,				// x: horizon fog distance, y: 1.0 if the atmosphere is on
	}
	@group(0) @binding(0) var<uniform> GU: GooseUniforms;

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
		@location(0) shape: vec4f,		// xyz: the mesh, a goose 1 across from wing tip to wing tip, heading along +z. w: how far out along a wing, or 2 on the neck and head
		@location(1) place: vec4f,		// this goose: xyz where it is, w: its wingspan, world units
		@location(2) pose: vec4f,		// x: its heading (radians, round from +z towards +x), y: nose up, z: banked, w: where its wings are in their beat (radians)
		@location(3) state: vec4f,		// x: how hard it is beating its wings, 0 gliding to 1, y: how folded they are (on the ground), 0 to 1, z: a number of its own
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) onGoose: vec4f,	// xyz: where on the mesh as it was made, w: how far out along a wing (2 on the neck and head)
		@location(2) @interpolate(flat) tone: f32,
	};

	fn turnX(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x, v.y * cos(angle) - v.z * sin(angle), v.y * sin(angle) + v.z * cos(angle)); }
	fn turnY(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) + v.z * sin(angle), v.y, v.z * cos(angle) - v.x * sin(angle)); }
	fn turnZ(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) - v.y * sin(angle), v.x * sin(angle) + v.y * cos(angle), v.z); }

	const NECK_FOOT: vec3f = vec3f(0.0, 0.02, 0.12);

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		let neck = input.shape.w > 1.5;
		let outAlong = select(abs(input.shape.w), 0.0, neck);
		var p = input.shape.xyz;
		let folded = input.state.y;

		// the beat: deep, from a little above level down to well below it. Gliding, the wings are held level
		let lift = (0.03 + 0.3 * input.state.x * sin(input.pose.w)) * outAlong * outAlong;
		p.y += lift;
		p.x *= 1.0 - 0.45 * abs(lift) * outAlong;
		// folded: drawn in to the body and swept back along it
		let fold = folded * outAlong;
		p.x *= 1.0 - 0.8 * fold;
		p.z -= 0.18 * fold;
		p.y = mix(p.y, 0.03 * outAlong, folded);
		// the neck up, swung about where it joins the body (in the air it is held straight out in front)
		if (neck) {
			let up = 1.2 * folded;
			let along = p - NECK_FOOT;
			p = NECK_FOOT + vec3f(along.x, along.y * cos(up) + along.z * sin(up), along.z * cos(up) - along.y * sin(up));
		}

		let turned = turnY(turnX(turnZ(p, input.pose.z), -input.pose.y), input.pose.x);
		let position = input.place.xyz + turned * input.place.w;

		var output: VertexOutput;
		output.pos = GU.viewProjectionMatrix * vec4f(position, 1.0);
		output.worldPos = position;
		output.onGoose = vec4f(input.shape.xyz, select(outAlong, 2.0, neck));
		output.tone = input.state.z;
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

	struct FragInput {
		@location(0) worldPos: vec3f,
		@location(1) onGoose: vec4f,
		@location(2) @interpolate(flat) tone: f32,
	};

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let toGoose = input.worldPos - Lights.camPos.xyz;
		let away = length(toGoose);
		// the face as it is, turned towards the eye (the wings are seen from both sides)
		var N = normalize(cross(dpdx(input.worldPos), dpdy(input.worldPos)));
		if (dot(N, toGoose) > 0.0) {
			N = -N;
		}

		let at = input.onGoose.xyz;
		let tone = mix(0.88, 1.1, input.tone);
		var albedo = vec3f(0.4, 0.34, 0.27) * tone;						// the back: grey brown
		if (input.onGoose.w > 1.5) {
			// the neck and the head black, and the white strap under the chin
			albedo = vec3f(0.045, 0.04, 0.04);
			if (at.z > 0.37 && at.z < 0.47 && at.y < 0.012) {
				albedo = vec3f(0.86, 0.85, 0.82);
			}
		} else if (input.onGoose.w > 0.0) {
			// the wings: the outer flight feathers darker
			albedo = mix(vec3f(0.37, 0.32, 0.26) * tone, vec3f(0.17, 0.15, 0.13), smoothstep(0.55, 0.8, input.onGoose.w));
		} else if (at.z < -0.15 && at.y < 0.015) {
			albedo = vec3f(0.9, 0.89, 0.86);								// white under the tail
		} else if (at.y < -0.015) {
			albedo = vec3f(0.74, 0.69, 0.6) * tone;							// the pale breast and belly
		}

		// the same light as everything else
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let light = 0.09 + daylight * (0.34 + 0.72 * saturate(dot(N, L)));
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		var color = albedo * (light * sunTint + moonLight(N));

		// and the same fade into the horizon
		if (GU.look.y > 0.5) {
			let horizonColor = skyColorAt(vec3f(toGoose.x, HORIZON_LIFT * length(toGoose.xz), toGoose.z));
			let fog = 1.0 - exp(-pow(away / GU.look.x, 2.0));
			color = mix(color, horizonColor, fog);
		}
		return vec4f(color, 1.0);
	}
`;
