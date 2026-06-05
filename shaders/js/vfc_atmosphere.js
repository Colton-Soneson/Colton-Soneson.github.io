import { settings } from '../../code/settings.js';
export const SKY_WORKGROUP_SIZE = [32, 1, 1];

/*
	raymarching: stepping along a ray through the atmosphere in fixed increments and accumulating a value at each step.
	
	For the transmittance LUT, a ray is fired from a point at some altitude toward the top of the atmosphere. It gets divided into 40 equal steps (dt = tMax / STEPS), 
	and at each step it samples the local extinction (how much light gets absorbed/scattered at that altitude) and adds it to a running opticalDepth total. At the end, 
	exp(-opticalDepth) converts that accumulated extinction into a survival fraction — Beer-Lambert law.
	
	For the sky view LUT, same idea but now it's also asking at each step "how much sunlight reaches this point from the sun direction?" which it gets cheaply 
	by looking up the transmittance LUT instead of marching another ray. It accumulates scattered light (scatterR, scatterM) weighted by how much throughput 
	has survived to that point along the view ray.
	
	The reason it's called "marching" rather than just integration is that you're literally stepping forward along the ray one chunk at a time, 
	reading the medium's properties at each position, rather than solving an analytical integral
*/


// If a ray travels from point A to point B through the atmosphere, what fraction of light survives
// Stored as a 256x64 texture: X axis = cos(zenith angle), Y axis = altitude.
// Only needs to be computed once — no sun direction or camera dependence.
export const c_transmittance_LUT =
`
	// Atmosphere constants
	const PLANET_RADIUS: f32 = 6371e3;
	const ATMOS_RADIUS:  f32 = 6471e3;
	
	// LUT dimensions: 256 cos(zenith) steps x 64 altitude steps
	const TRANSMIT_W:    u32 = 256u;
	const TRANSMIT_H:    u32 = 64u;
	
	// number of raymarch steps along each path. more = more accurate but slower
	const STEPS:         u32 = 40u;
	
	// Rayleigh / Mie coefficients
	const rayleighScatter: vec3f = vec3f(5.802e-6, 13.558e-6, 33.1e-6);		// constant, Rayleigh scattering coefficients, Higher for blue wavelengths (this is why the sky is blue)
	const mieScatter:      f32   = 21e-6;									// Mie scattering and absorption from aerosols or haze, wavelength-independent
	const mieAbsorb:       f32   = 1.11e-6;
	const ozoneAbsorb:     vec3f = vec3f(0.65e-6, 1.881e-6, 0.085e-6);		// absorbs green/red
	
	// Exponential scale heights: density halves every H meters
	const rayleighH: f32 = 8500.0;
	const mieH:      f32 = 1200.0;
	
	@group(0) @binding(0) var transmitOut: texture_storage_2d<rgba16float, write>;
	
	// Returns the two ray-sphere intersection distances (t0, t1)
	// 	if disc < 0, no intersection then returns (-1, -1)
	fn raySphereIntersect(ro: vec3f, rd: vec3f, r: f32) -> vec2f {
		let b = dot(ro, rd);
		let c = dot(ro, ro) - r * r;
		let disc = b*b - c;
		if (disc < 0.0) { return vec2f(-1.0); }
		let s = sqrt(disc);
		return vec2f(-b - s, -b + s);
	}
	
	// Total extinction (scattering + absorption) at a given altitude in meters
	// 		extinction = how much light is removed per meter traveled at this height
	fn sampleExtinction(h: f32) -> vec3f {
		let altKm = max(h, 0.0);
		let rayleigh = rayleighScatter * exp(-altKm / rayleighH); 		// Rayleigh: exponential falloff with altitude
		let mie      = (mieScatter + mieAbsorb) * exp(-altKm / mieH);	// Mie: total extinction is scatter + absorption, same exponential falloff
		// Ozone tent function peaks at 25km
		let ozone    = ozoneAbsorb * max(0.0, 1.0 - abs(altKm - 25000.0) / 15000.0);
		return rayleigh + mie + ozone;
	}
	
	// Maps a LUT texel UV to physical sky parameters
	// 		U encodes cos(zenith angle): 0 = looking down, 1 = looking up
	// 		V encodes altitude linearly between planet surface and atmosphere top
	fn uvToSkyParams(uv: vec2f) -> vec2f {
		let cosTheta = uv.x * 2.0 - 1.0;
		let h = mix(PLANET_RADIUS, ATMOS_RADIUS, uv.y);
		return vec2f(h, cosTheta);
	}
	
	@compute @workgroup_size(${SKY_WORKGROUP_SIZE[0]}, 1, 1)
	fn computeMain(@builtin(global_invocation_id) gid: vec3<u32>) {
		let dims = vec2u(TRANSMIT_W, TRANSMIT_H);
		if (gid.x >= dims.x || gid.y >= dims.y) { return; }
	
		// Convert texel index to UV, then to (altitude, cosTheta)
		let uv = (vec2f(gid.xy) + 0.5) / vec2f(dims);
		let params   = uvToSkyParams(uv);
		let altitude = params.x;
		let cosTheta = params.y;
		let sinTheta = sqrt(1.0 - cosTheta * cosTheta);
	
		//place ray origin at this altitude, aimed at the encoded zenith angle
		let ro = vec3f(0.0, altitude, 0.0);
		let rd = vec3f(sinTheta, cosTheta, 0.0);
	
		// March to atmosphere top, find where ray exit atmosphere
		let hit = raySphereIntersect(ro, rd, ATMOS_RADIUS);
		if (hit.y < 0.0) {
			textureStore(transmitOut, gid.xy, vec4f(1.0));	// ray doesn't hit atmosphere
			return;
		}
		let tMax = hit.y; 				// distance to atmosphere top along this ray
		let dt   = tMax / f32(STEPS);
	
		// Accumulate optical depth: integral of extinction along the ray
		// 		higher optical depth = more light removed = darker
		var opticalDepth = vec3f(0.0);
		for (var i = 0u; i < STEPS; i++) {
			let t   = (f32(i) + 0.5) * dt;			// sample at step midpoint
			let pos = ro + rd * t;
			let h   = length(pos) - PLANET_RADIUS;	// altitude at this sample point
			opticalDepth += sampleExtinction(h) * dt;
		}
	
		// Beer-Lambert law: transmittance = e^(-opticalDepth)
		// 		result is per-channel (RGB) since Rayleigh is wavelength dependent
		let transmittance = exp(-opticalDepth);
		textureStore(transmitOut, vec2i(gid.xy), vec4f(transmittance, 1.0));
	}
`;

//for a given view direction from the camera (azimuth + elevation), what color is the sky?
// 		stored as a 192x108 texture covering the full sphere of directions
//		recomputed when sun changes directions
// 		Each texel does a full raymarch through the atmosphere, but samples the transmittance LUT instead of raymarching toward the sun at each step
export const c_skyView_LUT =
`
	const PI: f32 = 3.14159265;
	const PLANET_RADIUS: f32 = 6371e3;
	const ATMOS_RADIUS:  f32 = 6471e3;
	const SKY_W: u32 = 192u;
	const SKY_H: u32 = 108u;
	const STEPS: u32 = 32u; // fewer than transmittance LUT since this could run every frame
	
	const rayleighScatter: vec3f = vec3f(5.802e-6, 13.558e-6, 33.1e-6);
	const mieScatter:      f32   = 21e-6;
	const rayleighH: f32 = 8500.0;
	const mieH:      f32 = 1200.0;
	
	struct SkyUniforms {
		invViewProj:    mat4x4f,
		sunDir:         vec4f,
		cameraPosition: vec4f,
	};
	@group(0) @binding(0) var<uniform> SU: SkyUniforms;
	@group(0) @binding(1) var transmitLUT: texture_2d<f32>;
	@group(0) @binding(2) var lutSampler:  sampler;
	@group(0) @binding(3) var skyOut:      texture_storage_2d<rgba16float, write>;
	
	fn raySphereIntersect(ro: vec3f, rd: vec3f, r: f32) -> vec2f {
		let b = dot(ro, rd);
		let c = dot(ro, ro) - r * r;
		let disc = b*b - c;
		if (disc < 0.0) { return vec2f(-1.0); }
		let s = sqrt(disc);
		return vec2f(-b - s, -b + s);
	}
	
	// Look up how much light survives from a point at altitude h toward direction cosTheta, this is a time saver
	// 		Maps (h, cosTheta) to the transmittance LUT UV space and samples it
	fn sampleTransmittance(h: f32, cosTheta: f32) -> vec3f {
		let u = cosTheta * 0.5 + 0.5;
		let v = (h - PLANET_RADIUS) / (ATMOS_RADIUS - PLANET_RADIUS);
		return textureSampleLevel(transmitLUT, lutSampler, vec2f(u, v), 0.0).rgb;
	}
	
	// Rayleigh phase function: how much light scatters toward the viewer at this angle
	// 		symmetric -> scatters equally forward and backward, more at 0 and 180 degrees
	fn phaseRayleigh(cosAngle: f32) -> f32 {
		return (3.0 / (16.0 * 3.14159)) * (1.0 + cosAngle * cosAngle);
	}
	
	// Mie phase function (Henyey-Greenstein approximation)
	// 		g controls the forward scattering lobe: g=0.8 gives a tight glow around the sun
	fn phaseMie(cosAngle: f32, g: f32) -> f32 {
		let g2 = g * g;
		return (3.0 * (1.0 - g2)) / (8.0 * 3.14159 * (2.0 + g2))
			* (1.0 + cosAngle * cosAngle) / pow(1.0 + g2 - 2.0*g*cosAngle, 1.5);
	}
	
	// Maps a LUT texel UV to a world-space view direction
	// 		U covers full azimuth [0, 2PI]
	//		V covers elevation [-PI/2, PI/2]
	fn uvToRd(uv: vec2f) -> vec3f {
		let azimuth   = uv.x * 2.0 * PI;
		let elevation = (uv.y - 0.5) * PI;  // -PI/2..PI/2
		let cosEl = cos(elevation);
		return vec3f(cosEl * cos(azimuth), sin(elevation), cosEl * sin(azimuth));
	}
	
	@compute @workgroup_size(${SKY_WORKGROUP_SIZE[0]}, 1, 1)
	fn computeMain(@builtin(global_invocation_id) gid: vec3<u32>) {
		let dims = vec2u(SKY_W, SKY_H);
		if (gid.x >= dims.x || gid.y >= dims.y) { return; }
	
		// convert texel to view direction for this LUT entry
		let uv  = (vec2f(gid.xy) + 0.5) / vec2f(dims);
		let rd  = uvToRd(uv);
		
		// place ray origin at camera altitude above planet center
		let ro  = vec3f(0.0, PLANET_RADIUS + SU.cameraPosition.y, 0.0);
		let sun = normalize(SU.sunDir.xyz);
	
		// Compute phase values once -> they only depend on the angle between view and sun, which is constant along the ray for a given LUT texel
		let cosAngle = dot(rd, sun);
		let phaseR   = phaseRayleigh(cosAngle);
		let phaseM   = phaseMie(cosAngle, 0.8);
	
		// find where the ray hits the atmosphere and ground
		let hitAtmos = raySphereIntersect(ro, rd, ATMOS_RADIUS);
		let hitGround = raySphereIntersect(ro, rd, PLANET_RADIUS);
	
		// March to whichever is closer: atmosphere exit or ground hit
		var tMax = hitAtmos.y;
		if (hitGround.x > 0.0) { tMax = hitGround.x; }			// ground blocks the ray (check effect on water grid)
		if (tMax < 0.0) {
			textureStore(skyOut, vec2i(gid.xy), vec4f(0.0));	// Ray points away from atmosphere entirely so write black
			return;
		}
	
		let dt = tMax / f32(STEPS);
		var scatterR = vec3f(0.0);		// accumulated Rayleigh scattered light
		var scatterM = vec3f(0.0);		// accumulated Mie scattered light
		var throughput = vec3f(1.0); 	// how much light still survives along the view ray so far
	
		for (var i = 0u; i < STEPS; i++) {
			let t   = (f32(i) + 0.5) * dt;			// sample at step midpoint to reduce errors
			let pos = ro + rd * t;
			let h   = length(pos) - PLANET_RADIUS;	// altitude at this sample point
			let alt = max(h, 0.0);					// Clamp underground samples to sea level		TODO MAKE THIS MATCH WATER PLANE HEIGHT ADJUSTMENT
	
			// How much sunlight reaches this point from the sun direction (via LUT lookup)
			let cosZenithSun = dot(normalize(pos), sun);
			let transmitToSun = sampleTransmittance(length(pos), cosZenithSun);
			
			// TODO, use for god rays (nope)? Higher atmospheres? Thick Haze? UnderWater?
			//let transmitStep  = sampleTransmittance(length(pos), dot(normalize(pos), rd));
	
			// Particle density at this altitude * step size = amount of medium this step passes through
			let densR = exp(-alt / rayleighH) * dt;
			let densM = exp(-alt / mieH) * dt;
	
			// Accumulate in-scattered light
			scatterR += throughput * transmitToSun * rayleighScatter * densR;
			scatterM += throughput * transmitToSun * mieScatter * densM;
			
			// Attenuate throughput by how much this step absorbed/scattered away (Beer-Lambert)
			throughput *= exp(-(rayleighScatter * densR + (mieScatter + 1.11e-6) * densM));
		}
	
		// combine Rayleigh and Mie contributions, weighted by their phase functions
		let color = scatterR * phaseR + scatterM * phaseM;
		textureStore(skyOut, vec2i(gid.xy), vec4f(color, 1.0));
}
`;

export const v_sky =
`		
	struct VertexInput {
		@builtin(instance_index) instanceIdx : u32,
		@location(0) pos: vec2f,
		@location(1) uv: vec2f,
	};
	
	struct VertexOutput {				//into frag
		@builtin(position) pos: vec4f,
		@location(0) fragUV: vec2f,
	};
	
	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {	
	
		var output: VertexOutput;
		output.pos = vec4f(input.pos.x, input.pos.y, 1.0, 1.0);
		output.fragUV = input.uv;
		
		return output;
	}
`;

export const f_sky =
`
	struct FragInput {
		@location(0) fragUV:    vec2f,
	};
	
	struct SkyUniforms {
		invViewProj:    mat4x4f,
		sunDir:         vec4f,
		cameraPosition: vec4f,
	};
	@group(0) @binding(0) var<uniform> Sky: SkyUniforms;
	@group(0) @binding(1) var skyLUT:    texture_2d<f32>;
	@group(0) @binding(2) var skySampler: sampler;
	
	const PI: f32 = 3.14159265;
	
	fn rdToUV(rd: vec3f) -> vec2f {
		let azimuth   = atan2(rd.z, rd.x);
		let elevation = asin(clamp(rd.y, -1.0, 1.0));
		return vec2f(azimuth / (2.0 * PI) + 0.5, elevation / PI + 0.5);
	}
	
	@fragment
	fn fragmentMain(input: FragInput) -> @location(0) vec4f {
		// Reconstruct view ray from NDC position
		let ndc    = vec4f(input.fragUV.x * 2.0 - 1.0,
							-(input.fragUV.y * 2.0 - 1.0),
							1.0, 
							1.0);
		let worldH = Sky.invViewProj * ndc;
		let rd     = normalize(worldH.xyz / worldH.w);// - Sky.cameraPosition.xyz);
		
		// TODO
		// 	corrected rd (not sure if this whole thing should be flipped or if this space version is actually correct)
		let rd_corrected = vec3f(-rd.x, rd.y, -rd.z);
		
		let uv    = rdToUV(rd_corrected);
		let color = textureSample(skyLUT, skySampler, uv).rgb;
	
		// Exposure tone mapping
		let exposed = 1.0 - exp(-color * 10.0);
		return vec4f(pow(exposed, vec3f(1.0/2.2)), 1.0);
}
`;