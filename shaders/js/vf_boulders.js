import { TERRAIN_ZONES, ZONE_MOUNTAIN, ZONE_SNOW } from '../../code/terrainGenerator.js';
import { rockShapes } from './vf_terrain.js';
import { groundTextures } from './f_groundTextures.js';
import { moonShapes } from './f_moon.js';

// a zone's color from terrainGenerator.js written out as a WGSL vec3f, so the colors only live in one place
const zoneColor = (zone) => `vec3f(${TERRAIN_ZONES[zone].color.map((c) => c.toFixed(3)).join(', ')})`;

/*
	The boulders. See boulderGenerator.js for their shapes and where they lie, boulders.js for what is drawn when.

	One mesh per shape of boulder, drawn once for every boulder of that shape (instancing): each instance brings where it is,
	how big, which way it lies and its own proportions, and the vertex shader puts the mesh there.

	They are made of the mountain: the same rock color, the same cracks and breaks worked out for every pixel (rockShapes, from
	the terrain's shader), the same light, and snow on top of the ones that lie above the snow line. The ones standing in the
	sea are wet and dark from the waves up to a little above the water, and green with weed below it.
*/
export const vf_boulders =
`
	struct BoulderUniforms
	{
		viewProjectionMatrix : mat4x4f,
		seaLevel : f32,				// world y of the sea surface
		snowLine : f32,				// rock higher than this above the sea has snow on it
		horizonFogDistance : f32,	// distance from the camera where things are about two thirds faded into the horizon
		atmosphereEnabled : f32,	// 1.0 while the atmosphere pass is keeping the sky LUT up to date
		pixelSize : f32,			// how much one pixel covers, as distance across per distance away from the camera
		rockDetail : f32,			// how strongly the small shapes of the rock show
		drawDistance : f32,			// how far off boulders are drawn. They shrink into the ground over the last part of it
		rockVeins : f32,			// how strongly the veins of the rock show
		snowCover : f32,			// how much snow has fallen and is lying, 0 to 1 (weather.js)
	}
	@group(0) @binding(0) var<uniform> UBO: BoulderUniforms;

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
		@location(0) pos: vec3f,			// the mesh: a boulder about 1 across, sitting on y = 0
		@location(1) norm: vec3f,
		@location(2) place: vec4f,			// this boulder: xyz where it lies, w how far across it is
		@location(3) lie: vec4f,			// x: its turn, yz: how far it is tipped over each way (radians), w: a random number
		@location(4) proportions: vec4f,	// xyz: its own squash, w: which shape (not needed here)
	};

	struct VertexOutput {				//into frag
		@builtin(position) pos: vec4f,
		@location(0) worldPos: vec3f,
		@location(1) fragNormal: vec3f,
		@location(2) up: f32,			// how far up the boulder, 0 at the ground to about 1 at its top
		@location(3) @interpolate(flat) tone: f32,
	};

	// v turned by an angle about one of the axes
	fn turnX(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x, v.y * cos(angle) - v.z * sin(angle), v.y * sin(angle) + v.z * cos(angle)); }
	fn turnY(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) + v.z * sin(angle), v.y, v.z * cos(angle) - v.x * sin(angle)); }
	fn turnZ(v: vec3f, angle: f32) -> vec3f { return vec3f(v.x * cos(angle) - v.y * sin(angle), v.x * sin(angle) + v.y * cos(angle), v.z); }

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		var output: VertexOutput;

		// the last stretch before the draw distance it sinks into the ground, so boulders dont blink in and out as the camera moves
		let away = distance(input.place.xyz, Lights.camPos.xyz);
		let shown = 1.0 - smoothstep(0.85 * UBO.drawDistance, UBO.drawDistance, away);

		// squashed to its own proportions, tipped over, turned, made its size, put in its place
		let squashed = input.pos * input.proportions.xyz;
		let lying = turnY(turnZ(turnX(squashed, input.lie.y), input.lie.z), input.lie.x);
		let position = input.place.xyz + lying * input.place.w * shown;

		// squashing a shape squashes its normals the other way: a face that was leaning over stands up straighter
		let normal = turnY(turnZ(turnX(input.norm / input.proportions.xyz, input.lie.y), input.lie.z), input.lie.x);

		output.pos = UBO.viewProjectionMatrix * vec4f(position, 1.0);
		output.worldPos = position;
		output.fragNormal = normal;
		output.up = input.pos.y;
		output.tone = input.lie.w;
		return output;
	}

	const COLOR_MOUNTAIN: vec3f  = ${zoneColor(ZONE_MOUNTAIN)};
	const COLOR_SNOW: vec3f      = ${zoneColor(ZONE_SNOW)};
	const COLOR_MOSS: vec3f      = vec3f(0.2, 0.27, 0.11);

	const PI: f32 = 3.14159265;
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
	${rockShapes}
	${groundTextures}

	//same as vertexoutput without builtin bits
	struct FragInput {
		@location(0) worldPos: vec3f,
		@location(1) fragNormal: vec3f,
		@location(2) up: f32,
		@location(3) @interpolate(flat) tone: f32,
	};

	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		let faceNormal = normalize(input.fragNormal);
		let toRock = input.worldPos - Lights.camPos.xyz;
		let away = length(toRock);

		//------------------THE SMALL SHAPES-----------------
		// the same as the mountain's (see fragmentMain in vf_terrain.js): the face is lit as if it leaned the way the rock stands out
		let detail = rockDetail(input.worldPos, away * UBO.pixelSize);
		let along = detail.yzw - faceNormal * dot(detail.yzw, faceNormal);
		let rockNormal = normalize(faceNormal - along * UBO.rockDetail);
		let crevice = 1.0 - detail.x;

		//------------------ROCK-----------------
		// the mountain's stone, every boulder a little lighter or darker than the next
		let stains = noise(input.worldPos.xz / 640.0 + vec2f(41.0, 7.0));
		var albedo = COLOR_MOUNTAIN * mix(vec3f(0.94, 0.97, 1.04), vec3f(1.1, 1.0, 0.88), stains) * mix(0.84, 1.1, input.tone);
		albedo *= mix(1.03, 0.68, crevice);
		// the same veins as the mountain it came off (marbleRock, in f_groundTextures.js)
		albedo *= mix(vec3f(1.0, 1.0, 1.0), marbleRock(input.worldPos, away * UBO.pixelSize).rgb, UBO.rockVeins);
		// moss, on the tops and shoulders of the ones low enough down for anything to grow on them
		let height = input.worldPos.y - UBO.seaLevel;
		let moss = smoothstep(0.55, 0.85, rockNormal.y) * (1.0 - smoothstep(0.3 * UBO.snowLine, 0.55 * UBO.snowLine, height)) * smoothstep(0.35, 0.6, noise(input.worldPos.xz / 3.1));
		albedo = mix(albedo, COLOR_MOSS * mix(1.1, 0.8, crevice), moss * 0.8);
		// in the sea: wet as far up as the waves splash (the line wanders round the rock), and weed on it from the waterline down
		let splashed = 1.0 - smoothstep(0.6, 3.2, height + 1.2 * (noise(input.worldPos.xz / 2.3) - 0.5));
		albedo = mix(albedo, vec3f(0.07, 0.11, 0.06), 0.7 * (1.0 - smoothstep(-1.5, 0.4, height)));
		albedo *= mix(1.0, 0.55, splashed);

		//------------------SNOW-----------------
		// above the snow line it lies on whatever of the boulder faces up
		let snowBand = 0.1 * UBO.snowLine;
		let altitude = (height - UBO.snowLine) / snowBand;
		//		(and so does snow that has fallen, wherever the boulder is. Not at the waterline: the sea keeps that clear)
		let snow = max(smoothstep(-1.0, 0.6, altitude), smoothstep(0.0, 0.6, UBO.snowCover) * smoothstep(1.0, 3.0, height)) * smoothstep(0.35, 0.6, rockNormal.y);
		albedo = mix(albedo, COLOR_SNOW, snow);
		let N = normalize(mix(rockNormal, faceNormal, 0.65 * snow));

		//------------------LIGHT-----------------
		// the same light as the terrain. Less of the sky gets to the foot of a boulder, where it meets the ground, and into its cracks
		let L = normalize(Lights.sunPos.xyz);
		let daylight = smoothstep(-0.08, 0.25, L.y);
		let diffuse = mix(saturate(dot(N, L)), saturate((dot(N, L) + 0.3) / 1.3), snow);
		let skyLight = (0.09 + daylight * 0.34) * mix(0.55, 1.0, smoothstep(0.0, 0.45, input.up)) * mix(1.0, 0.6, crevice * (1.0 - snow));
		let sunLight = daylight * 0.72 * diffuse;
		let sunTint = mix(vec3f(1.0, 1.0, 1.0), Lights.sunCol.rgb, 0.3 * (1.0 - saturate(L.y * 3.0)));
		var color = albedo * ((skyLight * mix(vec3f(1.0, 1.0, 1.0), vec3f(0.78, 0.88, 1.08), snow) + sunLight) * sunTint + moonLight(N));

		// and the same fade into the horizon
		if (UBO.atmosphereEnabled > 0.5) {
			let horizonColor = skyColorAt(vec3f(toRock.x, HORIZON_LIFT * length(toRock.xz), toRock.z));
			let fog = 1.0 - exp(-pow(away / UBO.horizonFogDistance, 2.0));
			color = mix(color, horizonColor, fog);
		}

		return vec4f(color, 1.0);
	}
`;
