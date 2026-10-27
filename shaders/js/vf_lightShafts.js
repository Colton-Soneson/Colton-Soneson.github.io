import { cloudShadeShapes } from './vfc_clouds.js';
import { DEPTH_NEAR, DEPTH_FAR, skyTest } from './depthShapes.js';

export const SHAFT_STEPS = 20;			// steps along each ray through the air
export const WATER_SHAFT_STEPS = 22;	// and through the water
export const SCREEN_SHAFT_STEPS = 36;	// and across the screen towards the sun
export const BEAM_STEPS = 40;			// and through a beam of light (the staff's, staff.js)
export const MOST_BEAMS = 4;

/*
	Light you can see in the air and in the water: the shafts of sun that come down between clouds (crepuscular rays),
	and, with the camera under the sea, everything that makes it look like under the sea. See lightShafts.js for when it runs.

	Both are the same idea. Air and water are not perfectly clear: a little of the light passing through is knocked sideways
	towards the eye by what is in them (haze, silt). Where the sun reaches, that shows as a faint glow in the air itself.
	Where something is in the sun's way it does not. So the pattern of what is in the way is drawn in the air as shafts.
	To find them a ray is walked out from every pixel, and at every step the question is: does the sun reach this point?

	IN THE AIR what is in the way is the clouds. The clouds already keep a picture of their own shadows taken from above (the
	coverage map, c_cloudCoverage in vfc_clouds.js), which the ground reads its cloud shadows from. A point in the air is in
	the shadow that falls on the ground further along the way the sun shines, so the same picture answers for any height
	(cloudShadeAt). The glow is strongest looking towards the sun, as it is from any haze, and there is more haze low down.

	That finds the broad shafts that stand in the air under a broken sky. The ones that fan out from the sun itself, past
	the edge of a cloud or the shoulder of a mountain, are far too fine for a picture of the clouds from above. They are found
	on the screen instead (Mitchell, "Volumetric Light Scattering as a Post-Process", GPU Gems 3): shafts of sun all point
	at the sun, so on the screen they all lie along lines through the place the sun is drawn. For every pixel a line is
	walked from it to the sun's place, and what is counted is how much of that line is open sky: not land, and not covered
	by cloud (the cloud march keeps how much of what is behind it shows through). A pixel whose line runs behind a cloud
	is in that cloud's shadow, and one just past its edge is in the light.

	UNDER WATER what is in the way is the surface. Every wave is a lens: a crest bends the light passing through it together
	and the trough next to it spreads it out. On the sea bed that makes the bright moving net of caustics, and in the water
	between the surface and the bed the same net shows as shafts.
		the caustic map		worked out once a frame from the water's own wave heights (vf_causticMap): how sharply the
							surface curves at every point of the tile of waves. A lens is as strong as it is curved
		how bright			light that passed through the surface at one point lands, d deeper, a little to one side:
							by d times the slope of the surface there (times 0.25, which is what bending into water
							comes to). Where neighbouring rays land closer together than they set out it is brighter,
							by as much as they closed up: 1 / (1 + 0.25 d curve), with curve below 0 under a crest
	and besides the light:
		the water itself	takes the red out of everything first and the blue last, and hides it altogether a hundred
							units off, in its own blue green
		the surface			from underneath only a round window straight overhead shows the sky (Snell's window: light
							from the whole sky is bent into a cone 97 degrees across). Outside it the surface is a
							mirror, and what it mirrors is the dark water. That much is drawn by the water itself
							(the end of f_water): here it only gets the glare of the sun through it

	A BEAM (the staff's Light Beam, staff.js): a cone of light from a point, out along a direction. The same haze
	shows it: every ray is walked through the stretch of it that could be in the cone, and what of it is inside is added, more
	of it near the point it comes from and nearer its middle, less towards its far end. The haze sends most of it on the way it
	was going (as for the sun: phase), so it is brightest seen from in front of it, plainest from the side, and faint from
	behind, along it, as its caster sees it. It is added as light that builds up and evens out (1 - e^-x), never past white.
	Whatever it falls on is lit by it too.
*/

// The caustic map: how sharply the water's surface curves, at every texel of the tile of waves. Out: r, the curve (rise per unit per unit: under 0 on a crest)
export const vf_causticMap =
`
	struct CausticUniforms
	{
		texel : f32,		// the world size of one texel of the wave texture
		mapSize : f32,		// texels along a side of the caustic map
	}
	@group(0) @binding(0) var<uniform> UBO: CausticUniforms;
	@group(0) @binding(1) var waveTexture: texture_2d<f32>;		// y: the height of the finest cascade of waves (see c_waveMaps in vfc_water.js)
	@group(0) @binding(2) var waveSampler: sampler;				// wrapping round, the cascade repeats

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
		var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
		return vec4f(corners[vertexIndex], 0.0, 1.0);
	}

	// the height of the waves at a place on the tile, 0 to 1 across it. The tile repeats, so off one edge is in from the other
	fn heightAt(uv: vec2f) -> f32 {
		return textureSampleLevel(waveTexture, waveSampler, uv, 0.0).y;
	}

	@fragment
	fn fragmentMain(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
		// the map covers one tile of the waves, whatever their resolution
		let uv = fragCoord.xy / UBO.mapSize;
		let toX = vec2f(1.0 / f32(textureDimensions(waveTexture).x), 0.0);	// one texel of the waves
		let toZ = toX.yx;
		// how much higher the 4 points round this one stand than it does, over the distance to them squared (the Laplacian).
		//		Taken over 1 texel and over 2 and the two mixed: the finest ripples alone would make a net too fine to see
		let here = heightAt(uv);
		let near = heightAt(uv + toX) + heightAt(uv - toX) + heightAt(uv + toZ) + heightAt(uv - toZ) - 4.0 * here;
		let wide = heightAt(uv + 2.0 * toX) + heightAt(uv - 2.0 * toX) + heightAt(uv + 2.0 * toZ) + heightAt(uv - 2.0 * toZ) - 4.0 * here;
		let curve = (0.5 * near + 0.5 * wide / 4.0) / (UBO.texel * UBO.texel);
		return vec4f(curve, 0.0, 0.0, 1.0);
	}
`;

export const vf_lightShafts =
`
	struct ShaftUniforms
	{
		invViewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz
		lightDirection : vec4f,		// xyz: towards the sun, 1 long. w: how much daylight there is, 0 to 1
		lightColor : vec4f,			// rgb: the color of the sun's light. a: how strong the shafts in the air are, 0 none
		water : vec4f,				// x: the height of the sea, y: the world size of a tile of waves, z: how strong the caustics are, w: 1.0 if the sea is drawn
		cloudMap : vec4f,			// where the cloud coverage map is: what cloudShadeAt takes (vfc_clouds.js)
		air : vec4f,				// x: the height of the bottom of the clouds, y: how far the shafts are followed, z: 1.0 if there are clouds, w: how bright the lightning is on the scene at this moment
		screen : vec4f,				// xy: the size of the picture, zw: 1 / that
		viewProjectionMatrix : mat4x4f,
		beams : array<vec4f, ${2 * MOST_BEAMS}>,	// each beam two: where it starts (xyz) and how long it is (w, world units), its way (xyz, as long as it is strong, 0 to 1) and the tan of half its cone (w)
		beamCount : vec4f,				// x: how many beams, yzw: unused
	}
	@group(0) @binding(0) var<uniform> SU: ShaftUniforms;
	@group(0) @binding(1) var frame: texture_2d<f32>;			// the finished picture (a copy of it)
	@group(0) @binding(2) var depthTexture: texture_depth_2d;
	@group(0) @binding(3) var cloudMap: texture_2d<f32>;
	@group(0) @binding(4) var cloudMapSampler: sampler;
	@group(0) @binding(5) var causticMap: texture_2d<f32>;
	@group(0) @binding(6) var causticSampler: sampler;			// repeating: the tile of waves is laid end to end over the sea
	@group(0) @binding(7) var cloudTexture: texture_2d<f32>;	// the cloud march. a: how much of what is behind the clouds shows through

	${cloudShadeShapes}

	const PI: f32 = 3.14159265;
	const HAZE: f32 = 0.00009;										// how much of the light a unit of air at sea level sends on towards the eye
	const HAZE_HEIGHT: f32 = 900.0;									// the haze thins out with height: by this much higher there is about a third of it
	const WATER_FADE: vec3f = vec3f(0.042, 0.015, 0.011);			// how fast water takes each of red, green and blue out of the light, per unit
	const WATER_COLOR: vec3f = vec3f(0.035, 0.24, 0.33);			// what is left: the color of the water itself
	const WATER_REACH: f32 = 150.0;									// how far through the water its shafts are followed

	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
		var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
		return vec4f(corners[vertexIndex], 0.0, 1.0);
	}

	fn pixelNoise(pixel: vec2f) -> f32 {
		return fract(52.9829189 * fract(dot(pixel, vec2f(0.06711056, 0.00583715))));
	}

	// Henyey-Greenstein: how much of the light going one way is sent on another, by the cosine of the angle between. g: towards 1, nearly all of it straight on
	fn phase(cosAngle: f32, g: f32) -> f32 {
		let g2 = g * g;
		return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * cosAngle, 1.5));
	}

	// How bright the light is at a point under the sea, next to what it would be under a flat calm: over 1 where the waves
	//		above have gathered it, under 1 where they have spread it (see UNDER WATER at the top of the file).
	//		toSunInWater: the way back up to the sun as it runs once it is in the water
	//		fine: with the finest of the net in it (for a surface it lands on. The shafts in the water are too far apart
	//		along a ray to follow anything that fine, and are made from the wide pattern alone)
	fn causticAt(point: vec3f, toSunInWater: vec3f, fine: bool) -> f32 {
		let under = SU.water.x - point.y;
		if (under <= 0.0) {
			return 1.0;
		}
		// where the light that gets here came through the surface. Read at two sizes: the waves as they are, and again
		//		wider and offset, which stands in for the longer waves of the cascades the map isnt made from
		//		(the cascades are read at world position / their size, so the map lines up with the surface overhead)
		let cameThrough = point.xz + toSunInWater.xz / toSunInWater.y * under;
		let uv = cameThrough / SU.water.y;
		var curve = 0.9 * textureSampleLevel(causticMap, causticSampler, uv * 0.23 + vec2f(0.31, 0.67), 0.0).r;
		if (fine) {
			curve = textureSampleLevel(causticMap, causticSampler, uv, 0.0).r + 0.35 * textureSampleLevel(causticMap, causticSampler, uv * 0.37 + vec2f(0.31, 0.67), 0.0).r;
		}
		// (no brighter than 3 times: a perfect lens would bring it all to one point. And the further down, the more the
		//		net is smeared out, by everything in the water that scatters light, until it is all the same again)
		let gathered = 1.0 / max(abs(1.0 + 0.25 * min(under, 45.0) * curve * SU.water.z), 0.33);
		return mix(gathered, 1.0, smoothstep(25.0, 110.0, under));
	}

	const BEAM_COLOR: vec3f = vec3f(1.0, 0.94, 0.8);

	// How much light a beam (see A BEAM at the top) sends to the eye along a ray, and how much falls on what the ray ends at
	fn beamLight(k: i32, origin: vec3f, direction: vec3f, solid: f32, jitter: f32) -> vec2f {
		let start = SU.beams[2 * k].xyz;
		let reach = SU.beams[2 * k].w;
		let strength = length(SU.beams[2 * k + 1].xyz);
		let way = SU.beams[2 * k + 1].xyz / max(strength, 0.0001);
		let spread = SU.beams[2 * k + 1].w;
		// the stretch of the ray that could be in it: as far as the far end of the beam from the camera
		let far = min(solid, distance(origin, start) + reach * 1.05);
		var lit = 0.0;
		var previous = 0.0;
		for (var i = 0; i < ${BEAM_STEPS}; i++) {
			let following = far * pow((f32(i) + 1.0) / f32(${BEAM_STEPS}), 1.7);
			let p = origin + direction * mix(previous, following, jitter);
			let v = p - start;
			let along = dot(v, way);
			if (along > 0.0 && along < reach) {
				let across = length(v - way * along);
				let edge = along * spread + 0.4;
				let inside = 1.0 - smoothstep(0.55 * edge, edge, across);
				lit += inside * pow(1.0 - along / reach, 1.4) / (1.0 + along * 0.004) * (following - previous) / (0.5 + edge * 0.5);
			}
			previous = following;
		}
		// what the ray ends at, if it is in the beam
		var onIt = 0.0;
		if (solid < 100000.0) {
			let v = origin + direction * solid - start;
			let along = dot(v, way);
			if (along > 0.0 && along < reach) {
				let edge = along * spread + 0.4;
				onIt = (1.0 - smoothstep(0.6 * edge, edge, length(v - way * along))) * pow(1.0 - along / reach, 1.2) * 40.0 / (40.0 + along);
			}
		}
		return vec2f(lit, onIt) * strength;
	}

	@fragment
	fn fragmentMain(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
		let pixel = vec2i(fragCoord.xy);
		var color = textureLoad(frame, pixel, 0).rgb;

		// Lightning: for the moment it lasts, everything is lit by it. The whole picture is brightened and bleached a
		//		little towards its blue white (which is how a flash looks: too short and too bright to see colors by)
		if (SU.air.w > 0.0) {
			let bright = dot(color, vec3f(0.3, 0.5, 0.2));
			color = mix(color, vec3f(0.85, 0.9, 1.0) * (bright + 0.06), 0.25 * saturate(SU.air.w)) * (1.0 + 1.1 * SU.air.w);
		}

		//------------------THE RAY-----------------
		let uv = fragCoord.xy * SU.screen.zw;
		let ndc = vec2f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
		let nearPoint = SU.invViewProjectionMatrix * vec4f(ndc, ${DEPTH_NEAR}, 1.0);
		let farPoint = SU.invViewProjectionMatrix * vec4f(ndc, ${DEPTH_FAR}, 1.0);
		let origin = SU.cameraPosition.xyz;
		let direction = normalize(farPoint.xyz / farPoint.w - nearPoint.xyz / nearPoint.w);

		// how far it goes: to whatever was drawn at this pixel, if anything was
		let depth = textureLoad(depthTexture, pixel, 0);
		var solid = 1000000000.0;
		if (!${skyTest('depth')}) {
			let scenePoint = SU.invViewProjectionMatrix * vec4f(ndc, depth, 1.0);
			solid = distance(scenePoint.xyz / scenePoint.w, origin);
		}

		let toSun = SU.lightDirection.xyz;
		let daylight = SU.lightDirection.w;
		let cosAngle = dot(direction, toSun);
		let jitter = pixelNoise(fragCoord.xy);

		// the beams (see A BEAM at the top): what they fall on lit, and the air they pass through glowing
		for (var k = 0; k < i32(SU.beamCount.x); k++) {
			let light = beamLight(k, origin, direction, solid, jitter);
			let glow = 1.0 - exp(-light.x * phase(dot(SU.beams[2 * k + 1].xyz, -direction) / max(length(SU.beams[2 * k + 1].xyz), 0.0001), 0.5) * 4.5);
			color += color * BEAM_COLOR * light.y * 2.2 + BEAM_COLOR * glow * 0.9;
		}

		if (origin.y < SU.water.x && SU.water.w > 0.5) {
			//------------------UNDER WATER-----------------
			// the sun's light once it is in the water: bent towards straight down (Snell's law, water's index is 1.33)
			let level = toSun.xz / 1.33;
			let toSunInWater = vec3f(level.x, sqrt(max(1.0 - dot(level, level), 0.01)), level.y);
			// what light there is down here: the day's, less under cloud, and less the deeper the camera is
			let cloud = cloudShadeAt(origin, toSun, SU.cloudMap).r;
			let down = SU.water.x - origin.y;
			let light = (0.1 + 0.9 * daylight) * mix(0.45, 1.0, cloud) * exp(-down * 0.012);
			let sunLight = SU.lightColor.rgb * daylight * cloud * exp(-down * 0.012);
			let fog = WATER_COLOR * light;

			let reach = min(solid, 4000.0);
			let hit = origin + direction * reach;
			// is it the surface that was drawn here, seen from underneath?
			let isSurface = hit.y > SU.water.x - 2.5 && direction.y > 0.0;
			if (isSurface) {
				// the glare of the sun, where it stands in the window overhead
				color += sunLight * pow(saturate(dot(direction, toSunInWater)), 90.0) * 1.6;
			} else if (solid < 100000.0) {
				// the caustics, on whatever is under the water: the bed, the rocks
				color *= 1.0 + (causticAt(hit, toSunInWater, true) - 1.0) * daylight * cloud;
			}
			// the water between: it takes the color out of what is behind it and puts its own in
			let left = exp(-WATER_FADE * reach);
			color = color * left + fog * (vec3f(1.0, 1.0, 1.0) - left);

			// the shafts: the same net of light, in the water itself
			let far = min(reach, WATER_REACH);
			let stride = far / f32(${WATER_SHAFT_STEPS});
			var shafts = 0.0;
			for (var i = 0; i < ${WATER_SHAFT_STEPS}; i++) {
				let travelled = (f32(i) + jitter) * stride;
				let p = origin + direction * travelled;
				let under = SU.water.x - p.y;
				if (under > 0.0) {
					shafts += max(causticAt(p, toSunInWater, false) - 0.8, 0.0) * exp(-under * 0.03) * exp(-travelled * 0.02) * stride;
				}
			}
			// (most of it straight on, as in the air: the shafts are brightest looking up along them towards the sun)
			color += sunLight * vec3f(0.5, 0.9, 1.0) * shafts * (0.008 + 0.18 * phase(dot(direction, toSunInWater), 0.6));
			return vec4f(color, 1.0);
		}

		//------------------IN THE AIR-----------------
		if (SU.lightColor.a <= 0.0 || SU.air.z < 0.5) {
			return vec4f(color, 1.0);
		}
		//------------------ACROSS THE SCREEN-----------------
		// (see the top of the file) only with the sun in front of the camera, and fading as it goes off the side of the picture
		let sunPoint = SU.viewProjectionMatrix * vec4f(origin + toSun * 10000.0, 1.0);
		if (sunPoint.w > 0.0) {
			let sunUV = sunPoint.xy / sunPoint.w * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
			let offScreen = max(max(abs(sunUV.x - 0.5), abs(sunUV.y - 0.5)) - 0.5, 0.0);
			let showing = 1.0 - smoothstep(0.0, 0.7, offScreen);
			if (showing > 0.0) {
				var open = 0.0;
				var reaches = 1.0;
				for (var i = 0; i < ${SCREEN_SHAFT_STEPS}; i++) {
					let at = clamp(mix(uv, sunUV, (f32(i) + jitter) / f32(${SCREEN_SHAFT_STEPS})), vec2f(0.001, 0.001), vec2f(0.999, 0.999));
					let sky = select(0.0, 1.0, ${skyTest('textureLoad(depthTexture, vec2i(at * SU.screen.xy), 0)')});
					let through = textureSampleLevel(cloudTexture, cloudMapSampler, at, 0.0).a;
					open += sky * through * through * reaches;
					reaches *= 0.97;		// light from further along the line counts for less: a shaft thins out away from the gap it came through
				}
				// brightest towards the sun, gone a quarter of the sky away from it
				let near = pow(saturate(cosAngle), 5.0);
				color += SU.lightColor.rgb * SU.lightColor.a * (open / f32(${SCREEN_SHAFT_STEPS})) * near * showing * 0.27;
			}
		}

		// the stretch of the ray that is under the clouds: the only place their shadows are
		var startAt = 0.0;
		var endAt = min(solid, SU.air.y);
		if (direction.y > 0.0001) {
			endAt = min(endAt, (SU.air.x - origin.y) / direction.y);
		} else if (origin.y > SU.air.x) {
			startAt = (SU.air.x - origin.y) / min(direction.y, -0.0001);
		}
		if (endAt <= startAt) {
			return vec4f(color, 1.0);
		}
		// (the steps get longer as they go: what is near fills more of the picture)
		var lit = 0.0;
		var previous = startAt;
		for (var i = 0; i < ${SHAFT_STEPS}; i++) {
			let following = startAt + (endAt - startAt) * pow((f32(i) + 1.0) / f32(${SHAFT_STEPS}), 1.6);
			let p = origin + direction * mix(previous, following, jitter);
			let haze = exp(-max(p.y - SU.water.x, 0.0) / HAZE_HEIGHT);
			// (the edge of a cloud's shadow is drawn in sharper than the map has it: a shaft is seen by its edge)
			lit += smoothstep(0.3, 0.8, cloudShadeAt(p, toSun, SU.cloudMap).r) * haze * (following - previous);
			previous = following;
		}
		// a little every way, most of it nearly straight on
		let towards = 0.1 + phase(cosAngle, 0.72);
		color += SU.lightColor.rgb * SU.lightColor.a * lit * HAZE * towards;
		return vec4f(color, 1.0);
	}
`;
