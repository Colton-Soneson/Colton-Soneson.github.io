/*
	The wisps bullets leave (see ballistics.js). Each piece of a trail is one instance: a strip from one point of the flight to the
	next, two triangles, turned about its own length to face the eye. It starts as a thin line and, over the fade, widens out,
	drifts a little up and sideways (each piece its own way, so the trail goes ragged as it spreads), and fades away. Across
	its width it is soft: densest down the middle, nothing at the edges.
*/
export const vf_trail =
`
	struct TrailUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraNow : vec4f,		// xyz: the camera, w: the clock now (seconds, as the trail's ages are kept)
		look : vec4f,			// x: how long a piece takes to fade, y: world units to the metre
		light : vec4f,			// x: how bright the air is: dim at night
	}
	@group(0) @binding(0) var<uniform> TU: TrailUniforms;

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) across: f32,		// -1 to 1 across the strip
		@location(1) fade: f32,			// how strong it still is, 1 new to 0 gone
	};

	fn wobble(seed: f32) -> vec3f {
		return vec3f(sin(seed * 12.9898), 0.0, cos(seed * 78.233)) * 0.5;
	}

	@vertex
	fn vertexMain(@builtin(vertex_index) corner: u32, @location(0) start: vec4f, @location(1) finish: vec4f) -> VertexOutput {
		// which end of the piece and which side: two triangles from 6 corners (0 1 2, 3 4 5)
		let end = select(0.0, 1.0, corner == 1u || corner == 4u || corner == 5u);
		let side = select(-1.0, 1.0, corner == 2u || corner == 3u || corner == 5u);
		let point = mix(start, finish, end);
		let age = max(TU.cameraNow.w - point.w, 0.0);
		let gone = saturate(age / TU.look.x);
		let metre = TU.look.y;

		// spreading and drifting as it ages
		let width = metre * (0.025 + 0.3 * sqrt(gone));
		let drift = (vec3f(0.0, 0.35, 0.0) + wobble(point.w * 37.0)) * metre * gone;	// (by the point's own time: the two pieces that share it drift it the same way)
		let at = point.xyz + drift;

		// turned about its length to face the eye
		let along = normalize(finish.xyz - start.xyz + vec3f(0.0, 0.00001, 0.0));
		let toEye = normalize(TU.cameraNow.xyz - at);
		let out = normalize(cross(along, toEye) + vec3f(0.00001, 0.0, 0.0));

		var output: VertexOutput;
		output.pos = TU.viewProjectionMatrix * vec4f(at + out * width * side, 1.0);
		output.across = side;
		output.fade = (1.0 - gone) * (1.0 - gone) * select(1.0, 0.0, age <= 0.0 && point.w <= 0.0);
		return output;
	}

	@fragment
	fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
		let soft = 1.0 - input.across * input.across;
		let alpha = 0.5 * soft * input.fade;
		if (alpha < 0.003) {
			discard;
		}
		return vec4f(vec3f(0.86, 0.87, 0.88) * TU.light.x, alpha);
	}
`;
