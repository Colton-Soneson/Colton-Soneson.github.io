/*
	THE INSPECTION's drawing of a dead animal (inspect.js), as if done in charcoal on the journal's page.
	THE MODEL (drawVertex, drawFragment): each thing drawn into a layer of its own (rgba16float): how lit it is (r, its faces' own way to
	the light: flat, as cut from paper), what it is (g: its id, below), how far it is (b: metres from the eye), and that something is there
	(a). The solid layer holds what is seen as it is (the animal, or in the x-ray its organs, the round's way through it); the ghost layer
	the animal's body over them in the x-ray.
	THE PAGE (fullVertex, fullFragment): those layers drawn as charcoal would be, over the paper (the canvas is clear where nothing is):
		cel shading	three bands of how lit: the light left bare, the half hatched one way, the dark crossed the other
		the lines	where one thing meets another, or nothing, or where its depth jumps (one leg in front of the body): an edge, each
					line shaken a little by the hand
		the tooth	charcoal only takes on the raised grain of the paper: every stroke broken up by it
		the ghost	in the x-ray, the body only its outline and a faint wash over the organs
	The ids: 1 the body, 2 an organ (3 one that was hit), 4 the round's way through, 5 where it went in (and the arrow of the way it
	came), 6 where it came out, 7 another shot's, 8 the round where it stayed
*/
export const vf_inspect =
`
	struct ModelUniforms
	{
		viewProjection : mat4x4f,
		eye : vec4f,			// the camera (the animal's frame, metres)
		light : vec4f,			// towards the light
	}
	@group(0) @binding(0) var<uniform> M: ModelUniforms;

	struct ModelOut {
		@builtin(position) pos: vec4f,
		@location(0) world: vec3f,
		@location(1) @interpolate(flat) id: f32,
		@location(2) depth: f32,
	}
	@vertex
	fn drawVertex(@location(0) p: vec3f, @location(1) id: f32) -> ModelOut {
		var o: ModelOut;
		o.pos = M.viewProjection * vec4f(p, 1.0);
		o.world = p;
		o.id = id;
		o.depth = o.pos.w;
		return o;
	}
	@fragment
	fn drawFragment(o: ModelOut) -> @location(0) vec4f {
		var n = normalize(cross(dpdx(o.world), dpdy(o.world)));
		if (dot(n, M.eye.xyz - o.world) < 0.0) { n = -n; }
		let lit = clamp(dot(n, M.light.xyz) * 0.5 + 0.5, 0.0, 1.0);
		return vec4f(lit, o.id, o.depth, 1.0);
	}

	struct PageUniforms
	{
		size : vec4f,			// x, y: the canvas (pixels), z: its pixels to a page's pixel
		mode : vec4f,			// x: the x-ray (1) or not (0)
	}
	@group(0) @binding(0) var<uniform> P: PageUniforms;
	@group(0) @binding(1) var solid: texture_2d<f32>;
	@group(0) @binding(2) var ghost: texture_2d<f32>;

	@vertex
	fn fullVertex(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
		let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
		return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
	}

	fn hash(p: vec2f) -> f32 {
		var q = fract(p * vec2f(123.34, 456.21));
		q += dot(q, q + 45.32);
		return fract(q.x * q.y);
	}
	fn noise(p: vec2f) -> f32 {
		let i = floor(p);
		let f = fract(p);
		let u = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x), u.y);
	}
	fn at(t: texture_2d<f32>, p: vec2i) -> vec4f {
		let s = vec2i(textureDimensions(t)) - vec2i(1);
		return textureLoad(t, clamp(p, vec2i(0), s), 0);
	}
	// how much of a line there is at p in a layer (see the lines), r pixels each way
	fn edge(t: texture_2d<f32>, p: vec2i, r: i32) -> f32 {
		let c = at(t, p);
		var offsets = array<vec2i, 4>(vec2i(r, 0), vec2i(-r, 0), vec2i(0, r), vec2i(0, -r));
		var e = 0.0;
		var bend = 0.0;
		for (var k = 0; k < 4; k++) {
			let s = at(t, p + offsets[k]);
			if (abs(s.a - c.a) > 0.5 || (c.a > 0.5 && abs(s.g - c.g) > 0.5)) { e = 1.0; }
			if (c.a > 0.5 && s.a > 0.5) { bend += s.b - c.b; }
		}
		if (c.a > 0.5 && abs(bend) > 0.05 * c.b) { e = max(e, 0.85); }
		return e;
	}
	// hatching: strokes along x + slant * y, spacing page pixels apart, broken now and then where the hand lifted
	fn hatch(px: vec2f, slant: f32, spacing: f32) -> f32 {
		let t = (px.x + slant * px.y) / spacing;
		let along = (px.y - slant * px.x) / spacing;
		let f = fract(t + (noise(vec2f(along * 0.15, floor(t))) - 0.5) * 0.25);
		let width = 0.22 + 0.12 * noise(vec2f(floor(t) * 3.1, along * 0.3));
		let stroke = 1.0 - smoothstep(width * 0.3, width * 0.5, abs(f - 0.5));
		return stroke * step(0.22, noise(vec2f(floor(t) * 7.3, along * 0.09)));
	}

	@fragment
	fn fullFragment(@builtin(position) fp: vec4f) -> @location(0) vec4f {
		let ink = vec3f(0.169, 0.145, 0.125);
		let sanguine = vec3f(0.5, 0.17, 0.09);
		let k = P.size.z;
		let p = vec2i(fp.xy);
		let px = fp.xy / k;
		// (the hand: the lines looked for a little off where they are, a slow wander)
		let q = p + vec2i(vec2f(noise(px * 0.045) - 0.5, noise(px * 0.045 + vec2f(17.0, 3.0)) - 0.5) * 2.4 * k);
		let r = max(i32(round(k)), 1);
		let tooth = smoothstep(0.18, 0.7, noise(px * 0.8) * 0.55 + noise(px * 2.1 + vec2f(5.0, 9.0)) * 0.45);

		var colour = ink;
		var alpha = 0.0;
		let s = at(solid, p);
		if (s.a > 0.5) {
			let id = i32(round(s.g));
			var wash = 0.05 + (1.0 - s.r) * 0.16;		// (a smudge, darker the less lit)
			var hatched = 1.0;
			if (id == 2) { wash = 0.2; }
			if (id == 3) { wash = 0.5; colour = sanguine; }
			if (id == 4) { wash = 0.85; colour = sanguine * 0.8; hatched = 0.0; }
			if (id == 5) { wash = 0.85; hatched = 0.0; }
			if (id == 6) { wash = 0.8; colour = sanguine; hatched = 0.0; }
			if (id == 7) { wash = 0.3; hatched = 0.0; }
			if (id == 8) { wash = 0.9; hatched = 0.0; }
			var h = 0.0;
			if (s.r < 0.56) { h = hatch(px, 1.0, 4.5) * 0.55; }
			if (s.r < 0.34) { h = max(h, hatch(px, -1.0, 5.5) * 0.7); }
			alpha = wash + h * hatched * (1.0 - wash);
		}
		let e = edge(solid, q, r);
		if (e > 0.0) { colour = mix(colour, ink, 0.6); alpha = max(alpha, e); }

		if (P.mode.x > 0.5) {
			let g = at(ghost, p);
			var ga = edge(ghost, q, r) * 0.7;
			if (g.a > 0.5) {
				ga = max(ga, 0.05);
				if (g.r < 0.45) { ga = max(ga, hatch(px, 1.0, 7.0) * 0.14); }
			}
			let together = ga + alpha * (1.0 - ga);
			colour = (ink * ga + colour * alpha * (1.0 - ga)) / max(together, 1e-4);
			alpha = together;
		}
		alpha = alpha * mix(0.55, 1.0, tooth);
		return vec4f(colour * alpha, alpha);
	}
`;
