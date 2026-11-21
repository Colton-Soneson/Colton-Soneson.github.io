/*
	THE RIVERS' FLECKS (code/riverFlecks.js): bits of foam and light carried on the rivers' water near the camera. A few thousand of them,
	each riding one stretch of a river (STRETCHES: its two ends, their water's height and half width, and how fast it runs), down it at the
	water's speed, keeping to its own lane across it, born at a random place on a random stretch near the camera and gone when its time is
	up or it has run off the end of its stretch.
	THEY GO ROUND THINGS: where a fleck is, the frame's own depth (what was drawn before the water) is looked at. Something solid standing
	there, within a little of the fleck (a rock in the stream, the walker's legs, a boat's hull): it is in the way. The fleck is slowed,
	and pushed off sideways to whichever side the depth says is clear (looked at half a metre each way across the stream), and it piles
	up there as foam (its splash, which makes it brighter) before it slips round and goes on. Only what is on the screen is known about:
	off it the flecks run straight.
*/
export const FLECKS = 6000;			// how many there are
export const FLECK_FLOATS = 12;		// 3 vec4s each
export const FLECK_WORKGROUP = 64;
export const FLECK_STRETCHES = 256;	// the most stretches near the camera they are born on
const common = `
	struct FleckUniforms {
		viewProjection: mat4x4f,
		camera: vec4f,		// xyz, w: seconds
		step: vec4f,		// x: seconds since the last frame, y: how many stretches, z: world units to the metre, w: daylight 0 to 1
		depth: vec4f,		// x, y: depthA, depthB (a depth to a distance along the view: depthB / (depth + depthA)), z: 1 with the frame's depth to look at
		screen: vec4f,		// xy: the size of the frame's depth, in pixels
	}
	@group(0) @binding(0) var<uniform> U: FleckUniforms;
	struct Fleck {
		at: vec4f,			// xyz where it is, w how long it has been going (seconds)
		go: vec4f,			// xy its velocity over the ground (world units a second), z its stretch, w its splash 0 to 1
		own: vec4f,			// x how long it lasts, y its lane (across the stream, -1 to 1), z its own random number, w its size (metres)
	}
	struct Stretch {
		a: vec4f,			// one end: x, y (its water), z, w its half width
		b: vec4f,			// the other
		more: vec4f,		// x how fast the water runs (world units a second)
	}
	fn hash(value: u32) -> u32 {
		var x = value;
		x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
		return x;
	}
	fn random(seed: u32) -> f32 { return f32(hash(seed)) / 4294967295.0; }
`;

export const c_riverFlecks = `
	${common}
	@group(0) @binding(1) var<storage, read_write> flecks: array<Fleck>;
	@group(0) @binding(2) var<storage, read> stretches: array<Stretch>;
	@group(0) @binding(3) var sceneDepth: texture_depth_2d;

	// what is drawn at a world point, as a distance along the view (1e9: nothing, or off the screen), and the point's own
	fn solidAt(p: vec3f) -> vec2f {
		let clip = U.viewProjection * vec4f(p, 1.0);
		if (clip.w <= 0.0 || U.depth.z < 0.5) { return vec2f(1.0e9, clip.w); }
		let ndc = clip.xy / clip.w;
		if (any(abs(ndc) > vec2f(1.0, 1.0))) { return vec2f(1.0e9, clip.w); }
		let pixel = vec2i((ndc * vec2f(0.5, -0.5) + vec2f(0.5, 0.5)) * U.screen.xy);
		let d = textureLoad(sceneDepth, clamp(pixel, vec2i(0, 0), vec2i(U.screen.xy) - vec2i(1, 1)), 0);
		return vec2f(U.depth.y / (d + U.depth.x), clip.w);
	}
	// in the way: something solid there, from a little in front of the point to a hand's width behind it (a far hill behind is not)
	fn blocked(p: vec3f) -> bool {
		let s = solidAt(p);
		let m = U.step.z;
		return s.x < s.y - 0.03 * m && s.x > s.y - 1.5 * m;
	}

	@compute @workgroup_size(${FLECK_WORKGROUP})
	fn update(@builtin(global_invocation_id) id: vec3u) {
		let i = id.x;
		if (i >= ${FLECKS}u) { return; }
		var f = flecks[i];
		let count = u32(U.step.y);
		let m = U.step.z;
		let dt = U.step.x;
		var k = u32(f.go.z);
		var dead = f.at.w >= f.own.x || k >= count || count == 0u;
		if (!dead) {
			let s = stretches[k];
			let run = s.b.xz - s.a.xz;
			let len = max(length(run), 0.001);
			let dir = run / len;
			let side = vec2f(-dir.y, dir.x);
			let rel = f.at.xz - s.a.xz;
			let t = dot(rel, dir) / len;
			let half = mix(s.a.w, s.b.w, saturate(t));
			let across = dot(rel, side) / max(half, 0.001);
			dead = t > 1.02 || t < -0.05 || abs(across) > 1.05;
			if (!dead) {
				// the water's pull: down the stretch at its speed, and back towards its own lane
				let want = dir * s.more.x + side * (f.own.y - across) * half * 0.6;
				var v = mix(f.go.xy, want, saturate(dt * 2.5));
				// THEY GO ROUND THINGS: something solid just ahead, or where it is: pushed to the clear side, slowed, and piled up as foam
				let ahead = vec3f(f.at.x + dir.x * 0.25 * m, f.at.y, f.at.z + dir.y * 0.25 * m);
				var splash = f.go.w * exp(-dt * 1.5);
				if (blocked(ahead) || blocked(f.at.xyz)) {
					let left = blocked(vec3f(ahead.x + side.x * 0.5 * m, ahead.y, ahead.z + side.y * 0.5 * m));
					let right = blocked(vec3f(ahead.x - side.x * 0.5 * m, ahead.y, ahead.z - side.y * 0.5 * m));
					var way = select(1.0, -1.0, f.own.z > 0.5);
					if (left && !right) { way = -1.0; }
					if (right && !left) { way = 1.0; }
					v = dir * dot(v, dir) * 0.25 + side * way * s.more.x * 1.6;
					splash = min(splash + dt * 3.0, 1.0);
				}
				f.go = vec4f(v, f.go.z, splash);
				let p = f.at.xz + v * dt;
				let tt = saturate(dot(p - s.a.xz, dir) / len);
				f.at = vec4f(p.x, mix(s.a.y, s.b.y, tt) + 0.02 * m, p.y, f.at.w + dt);
			}
		}
		if (dead) {
			if (count == 0u) { f.at.w = 1.0e9; flecks[i] = f; return; }
			// born again, on a random stretch near the camera, a random way along it and across it
			let seed = hash(i * 7919u + u32(U.camera.w * 60.0) * 104729u);
			k = hash(seed) % count;
			let s = stretches[k];
			let t = random(seed + 1u);
			let lane = (random(seed + 2u) * 2.0 - 1.0) * 0.85;
			let run = s.b.xz - s.a.xz;
			let dir = run / max(length(run), 0.001);
			let side = vec2f(-dir.y, dir.x);
			let half = mix(s.a.w, s.b.w, t);
			let p = mix(s.a.xz, s.b.xz, t) + side * lane * half;
			f.at = vec4f(p.x, mix(s.a.y, s.b.y, t) + 0.02 * m, p.y, 0.0);
			f.go = vec4f(dir * s.more.x, f32(k), 0.0);
			f.own = vec4f(3.0 + 5.0 * random(seed + 3u), lane, random(seed + 4u), 0.04 + 0.09 * random(seed + 5u) * random(seed + 6u));
		}
		flecks[i] = f;
	}
`;

export const vf_riverFlecks = `
	${common}
	@group(0) @binding(1) var<storage, read> flecks: array<Fleck>;

	struct Out {
		@builtin(position) pos: vec4f,
		@location(0) uv: vec2f,
		@location(1) shade: vec2f,		// x how strongly it shows, y its splash
	}
	@vertex
	fn vertexMain(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
		var o: Out;
		o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
		let f = flecks[i];
		let life = f.at.w / max(f.own.x, 0.001);
		if (life >= 1.0) { return o; }
		let m = U.step.z;
		let away = distance(f.at.xyz, U.camera.xyz);
		let fade = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.75, 1.0, life)) * (1.0 - smoothstep(45.0 * m, 80.0 * m, away));
		if (fade <= 0.0) { return o; }
		// a flat little shape on the water, drawn out along the way it goes (more as it is pushed about), bigger as foam piles up
		let speed = length(f.go.xy);
		let along = select(vec2f(1.0, 0.0), f.go.xy / speed, speed > 0.0001);
		let size = f.own.w * m * (1.0 + 1.4 * f.go.w);
		var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
		let corner = corners[v];
		let stretch = 1.0 + min(speed / m, 3.0) * 0.35;
		let offset = along * corner.x * size * stretch + vec2f(-along.y, along.x) * corner.y * size;
		o.pos = U.viewProjection * vec4f(f.at.x + offset.x, f.at.y, f.at.z + offset.y, 1.0);
		o.uv = corner;
		o.shade = vec2f(fade, f.go.w);
		return o;
	}
	@fragment
	fn fragmentMain(input: Out) -> @location(0) vec4f {
		let r = dot(input.uv, input.uv);
		if (r > 1.0) { discard; }
		let soft = 1.0 - smoothstep(0.2, 1.0, r);
		let light = 0.18 + 0.82 * U.step.w;
		let alpha = soft * input.shade.x * (0.32 + 0.45 * input.shade.y);
		return vec4f(vec3f(0.92, 0.95, 0.95) * light, alpha);
	}
`;
