import { settings } from '../../code/settings.js';
export const SKY_WORKGROUP_SIZE = [32, 1, 1];

//if a ray travels from point A to point B through the atmosphere, what fraction of light survives
export const c_transmittance_LUT =
`
	// Atmosphere constants
	const PLANET_RADIUS: f32 = 6371e3;
	const ATMOS_RADIUS:  f32 = 6471e3;
	const TRANSMIT_W:    u32 = 256u;
	const TRANSMIT_H:    u32 = 64u;
	const STEPS:         u32 = 40u;
	
	// Rayleigh / Mie coefficients
	const rayleighScatter: vec3f = vec3f(5.802e-6, 13.558e-6, 33.1e-6);
	const mieScatter:      f32   = 21e-6;
	const mieAbsorb:       f32   = 1.11e-6;
	const ozoneAbsorb:     vec3f = vec3f(0.65e-6, 1.881e-6, 0.085e-6);
	
	const rayleighH: f32 = 8500.0;
	const mieH:      f32 = 1200.0;
	
	@group(0) @binding(0) var transmitOut: texture_storage_2d<rgba16float, write>;
	
	fn raySphereIntersect(ro: vec3f, rd: vec3f, r: f32) -> vec2f {
		let b = dot(ro, rd);
		let c = dot(ro, ro) - r * r;
		let disc = b*b - c;
		if (disc < 0.0) { return vec2f(-1.0); }
		let s = sqrt(disc);
		return vec2f(-b - s, -b + s);
	}
	
	fn sampleExtinction(h: f32) -> vec3f {
		let altKm = max(h, 0.0);
		let rayleigh = rayleighScatter * exp(-altKm / rayleighH);
		let mie      = (mieScatter + mieAbsorb) * exp(-altKm / mieH);
		// Ozone tent function peaks at 25km
		let ozone    = ozoneAbsorb * max(0.0, 1.0 - abs(altKm - 25000.0) / 15000.0);
		return rayleigh + mie + ozone;
	}
	
	// UV → (altitude, cos zenith angle)
	fn uvToSkyParams(uv: vec2f) -> vec2f {
		let cosTheta = uv.x * 2.0 - 1.0;
		let h = mix(PLANET_RADIUS, ATMOS_RADIUS, uv.y);
		return vec2f(h, cosTheta);
	}
	
	@compute @workgroup_size(${SKY_WORKGROUP_SIZE[0]}, 1, 1)
	fn computeMain(@builtin(global_invocation_id) gid: vec3<u32>) {
		let dims = vec2u(TRANSMIT_W, TRANSMIT_H);
		if (gid.x >= dims.x || gid.y >= dims.y) { return; }
	
		let uv = (vec2f(gid.xy) + 0.5) / vec2f(dims);
		let params   = uvToSkyParams(uv);
		let altitude = params.x;
		let cosTheta = params.y;
		let sinTheta = sqrt(1.0 - cosTheta * cosTheta);
	
		let ro = vec3f(0.0, altitude, 0.0);
		let rd = vec3f(sinTheta, cosTheta, 0.0);
	
		// March to atmosphere top
		let hit = raySphereIntersect(ro, rd, ATMOS_RADIUS);
		if (hit.y < 0.0) {
			textureStore(transmitOut, gid.xy, vec4f(1.0));
			return;
		}
		let tMax = hit.y;
		let dt   = tMax / f32(STEPS);
	
		var opticalDepth = vec3f(0.0);
		for (var i = 0u; i < STEPS; i++) {
			let t   = (f32(i) + 0.5) * dt;
			let pos = ro + rd * t;
			let h   = length(pos) - PLANET_RADIUS;
			opticalDepth += sampleExtinction(h) * dt;
		}
	
		let transmittance = exp(-opticalDepth);
		textureStore(transmitOut, vec2i(gid.xy), vec4f(transmittance, 1.0));
	}
`;

//for a given view direction from the camera, what color is the sky?
export const c_skyView_LUT =
`
	const PI: f32 = 3.14159265;
	const PLANET_RADIUS: f32 = 6371e3;
	const ATMOS_RADIUS:  f32 = 6471e3;
	const SKY_W: u32 = 192u;
	const SKY_H: u32 = 108u;
	const STEPS: u32 = 32u;
	
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
	
	fn sampleTransmittance(h: f32, cosTheta: f32) -> vec3f {
		let u = cosTheta * 0.5 + 0.5;
		let v = (h - PLANET_RADIUS) / (ATMOS_RADIUS - PLANET_RADIUS);
		return textureSampleLevel(transmitLUT, lutSampler, vec2f(u, v), 0.0).rgb;
	}
	
	fn phaseRayleigh(cosAngle: f32) -> f32 {
		return (3.0 / (16.0 * 3.14159)) * (1.0 + cosAngle * cosAngle);
	}
	fn phaseMie(cosAngle: f32, g: f32) -> f32 {
		let g2 = g * g;
		return (3.0 * (1.0 - g2)) / (8.0 * 3.14159 * (2.0 + g2))
			* (1.0 + cosAngle * cosAngle) / pow(1.0 + g2 - 2.0*g*cosAngle, 1.5);
	}
	
	// UV → azimuth/elevation view direction
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
	
		let uv  = (vec2f(gid.xy) + 0.5) / vec2f(dims);
		let rd  = uvToRd(uv);
		let ro  = vec3f(0.0, PLANET_RADIUS + SU.cameraPosition.y, 0.0);
		let sun = normalize(SU.sunDir.xyz);
	
		let cosAngle = dot(rd, sun);
		let phaseR   = phaseRayleigh(cosAngle);
		let phaseM   = phaseMie(cosAngle, 0.8);
	
		let hitAtmos = raySphereIntersect(ro, rd, ATMOS_RADIUS);
		let hitGround = raySphereIntersect(ro, rd, PLANET_RADIUS);
	
		var tMax = hitAtmos.y;
		if (hitGround.x > 0.0) { tMax = hitGround.x; }
		if (tMax < 0.0) {
			textureStore(skyOut, vec2i(gid.xy), vec4f(0.0));
			return;
		}
	
		let dt = tMax / f32(STEPS);
		var scatterR = vec3f(0.0);
		var scatterM = vec3f(0.0);
		var throughput = vec3f(1.0);
	
		for (var i = 0u; i < STEPS; i++) {
			let t   = (f32(i) + 0.5) * dt;
			let pos = ro + rd * t;
			let h   = length(pos) - PLANET_RADIUS;
			let alt = max(h, 0.0);
	
			let cosZenithSun = dot(normalize(pos), sun);
			let transmitToSun = sampleTransmittance(length(pos), cosZenithSun);
			let transmitStep  = sampleTransmittance(length(pos), dot(normalize(pos), rd));
	
			let densR = exp(-alt / rayleighH) * dt;
			let densM = exp(-alt / mieH) * dt;
	
			scatterR += throughput * transmitToSun * rayleighScatter * densR;
			scatterM += throughput * transmitToSun * mieScatter * densM;
			throughput *= exp(-(rayleighScatter * densR + (mieScatter + 1.11e-6) * densM));
		}
	
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
							input.fragUV.y * 2.0 - 1.0,
							1.0, 
							1.0);
		let worldH = Sky.invViewProj * ndc;
		let rd     = normalize(worldH.xyz / worldH.w - Sky.cameraPosition.xyz);
		
		// TODO
		// 	corrected rd (not sure if this whole thing should be flipped or if this space version is actually correct)
		let rd_corrected = -rd;
		
		let uv    = rdToUV(rd_corrected);
		let color = textureSample(skyLUT, skySampler, uv).rgb;
	
		// Exposure tone mapping
		let exposed = 1.0 - exp(-color * 10.0);
		return vec4f(pow(exposed, vec3f(1.0/2.2)), 1.0);
}
`;