import { skyLookupShapes } from './vfc_atmosphere.js';

/*
	The rivers' water (rivers.js draws it, terrainGenerator.js THE RIVERS lays the rivers out and cuts their channels).

	Each river is a ribbon at the height of its water, a little wider than the water so its edges are under the banks. Over it:
		THE SURFACE		ripples, worked out in the river's own frame (how far along it, how far across) and carried down it with the water:
						faster and rougher where it falls steeply (its fall: the drop of its water over the way along), as rapids are
		WHAT IS UNDER	the frame as it stood before the water (screenEffects.js: the bed and anything in the water), through the water:
						the further the eye looks through it, the less of the bed and the more of the water's own color (Beer-Lambert:
						ABSORB a metre, and the light the water sends back itself, SCATTER), a little bent by the ripples
		THE SKY			reflected as much as the angle lets it (Schlick's Fresnel), and the sun glinting off it
		FOAM			on the rapids, and a little at the edges
	And faded into the horizon as everything else is, and soft at the shore where the water gets thin
*/
export const vf_rivers =
`
	struct RiverUniforms
	{
		viewProjectionMatrix : mat4x4f,
		time : f32,					// seconds
		fogDistance : f32,			// where things are about two thirds faded into the horizon
		atmosphereEnabled : f32,
		metre : f32,				// world units to the metre
		depthA : f32,				// the projection's numbers that turn a depth back into a distance along the view: depthB / (depth + depthA)
		depthB : f32,
		sceneReady : f32,			// 1.0 when the frame before the water was kept this frame (screenEffects.js)
		pad : f32,
	}
	@group(0) @binding(0) var<uniform> UBO: RiverUniforms;

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
	@group(0) @binding(2) var skyLUT: texture_2d<f32>;
	@group(0) @binding(3) var skySampler: sampler;
	@group(0) @binding(4) var sceneColor: texture_2d<f32>;
	@group(0) @binding(5) var sceneDepth: texture_depth_2d;

	const PI: f32 = 3.14159265;
	${skyLookupShapes}

	const ABSORB: vec3f = vec3f(0.42, 0.17, 0.12);		// how much of the light a metre of river water takes, red to blue
	const SCATTER: vec3f = vec3f(0.05, 0.10, 0.09);		// the light it sends back of its own, in full daylight

	struct VertexInput {
		@location(0) pos: vec3f,
		@location(1) river: vec4f,		// x: how far along it (world units from its head), y: how far across (-1 and 1 at the water's edge), z: its half width, w: its fall
		@location(2) flow: vec2f,		// which way it runs (length 1)
		@location(3) depth: f32,		// how deep it is in the middle (world units)
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) river: vec4f,
		@location(2) flow: vec2f,
		@location(3) viewDepth: f32,	// the distance along the view, as the depth buffer's own (clip w)
	};

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		var output: VertexOutput;
		output.pos = UBO.viewProjectionMatrix * vec4f(input.pos, 1.0);
		output.worldPos = input.pos;
		output.river = input.river;
		output.flow = input.flow;
		output.viewDepth = output.pos.w;
		return output;
	}

	fn hash(p: vec2f) -> f32 {
		let q = fract(p * vec2f(0.1031, 0.1030));
		let r = q + dot(q, q.yx + 33.33);
		return fract((r.x + r.y) * r.x);
	}
	// value noise, smooth between whole numbers
	fn noise(p: vec2f) -> f32 {
		let i = floor(p);
		let f = fract(p);
		let u = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x), u.y);
	}
	// the ripples: three sizes of them, the small ones stretched along the flow a little less than the big
	fn ripples(p: vec2f) -> f32 {
		return 0.55 * noise(p * vec2f(0.6, 1.0)) + 0.3 * noise(p * vec2f(1.6, 2.1) + 7.3) + 0.15 * noise(p * vec2f(3.7, 4.3) - 2.1);
	}

	@fragment
	fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
		let m = UBO.metre;
		let fall = input.river.w;
		let flow = normalize(input.flow);
		let side = vec2f(-flow.y, flow.x);

		//------------------THE SURFACE-----------------
		// carried along at the speed of the water: a slow river about 0.6 metres a second, rapids up to 4
		let speed = clamp(0.6 + 30.0 * fall, 0.6, 4.0) * m;
		let p = vec2f(input.river.x - speed * UBO.time, input.river.y * input.river.z) / (1.4 * m);
		let e = 0.08;
		let h0 = ripples(p);
		let slope = vec2f(ripples(p + vec2f(e, 0.0)) - h0, ripples(p + vec2f(0.0, e)) - h0) / e;
		let rough = 0.06 + 0.3 * smoothstep(0.01, 0.08, fall);
		let g = (flow * slope.x + side * slope.y) * rough;
		let N = normalize(vec3f(-g.x, 1.0, -g.y));

		let toEye = Lights.camPos.xyz - input.worldPos;
		let away = length(toEye);
		let V = toEye / away;

		//------------------WHAT IS UNDER-----------------
		// how far the eye looks through the water to what is behind it
		var through = 1.0 * m;
		var behind = vec3f(0.30, 0.28, 0.22) * 0.6;
		if (UBO.sceneReady > 0.5) {
			let size = vec2f(textureDimensions(sceneDepth));
			let here = vec2i(input.pos.xy);
			let d = textureLoad(sceneDepth, here, 0);
			let further = UBO.depthB / (d + UBO.depthA) - input.viewDepth;
			through = max(further, 0.0) * away / max(input.viewDepth, 0.001);
			// (bent by the ripples, by more the deeper it is; not on to anything in front of the water)
			let bent = vec2i(clamp(input.pos.xy + N.xz * 40.0 * saturate(through / (2.0 * m)), vec2f(0.0), size - vec2f(1.0)));
			let bentDepth = textureLoad(sceneDepth, bent, 0);
			let bentFurther = UBO.depthB / (bentDepth + UBO.depthA) - input.viewDepth;
			behind = textureLoad(sceneColor, select(here, bent, bentFurther > 0.0), 0).rgb;
		}
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let kept = exp(-ABSORB * through / m);
		var color = behind * kept + SCATTER * (0.15 + 0.85 * daylight) * (1.0 - kept);

		//------------------THE SKY-----------------
		let R = reflect(-V, N);
		let fresnel = 0.02 + 0.98 * pow(1.0 - saturate(dot(N, V)), 5.0);
		let sky = skyColorAt(vec3f(R.x, max(R.y, 0.02), R.z));
		color = mix(color, sky, fresnel);
		color += Lights.sunCol.rgb * pow(saturate(dot(R, L)), 900.0) * 1.6 * daylight;

		//------------------FOAM-----------------
		let rapids = smoothstep(0.03, 0.14, fall) * smoothstep(0.45, 0.75, ripples(p * 2.3 + 11.0));
		let edge = 0.35 * smoothstep(0.8, 1.0, abs(input.river.y)) * smoothstep(0.4, 0.7, ripples(p * 3.1 - 5.0));
		let foam = saturate(rapids + edge);
		color = mix(color, vec3f(0.85, 0.88, 0.88) * (0.25 + 0.75 * daylight), foam * 0.8);

		// and the same fade into the horizon
		if (UBO.atmosphereEnabled > 0.5) {
			let fog = 1.0 - exp(-pow(away / UBO.fogDistance, 2.0));
			color = mix(color, fogColorAt(-toEye), fog);
		}
		// (soft at the shore, where it is thin)
		let alpha = select(1.0, smoothstep(0.0, 0.35 * m, through), UBO.sceneReady > 0.5);
		return vec4f(color, alpha);
	}
`;
