export const LIGHTNING_VERTICES = 6;	// a piece of a bolt is one card: 2 triangles

/*
	A bolt of lightning. See lightning.js for what a bolt is and when there is one.

	The bolt is a string of straight pieces. One instance is one piece: where it starts, where it ends, how wide it is and
	how bright. The vertex shader makes each a card lying along the piece and turned about it to face the camera, a good
	deal wider than the bolt itself, and the fragment shader draws across it a thin white core with a blue glow to either
	side. It is added to the picture, not laid over it: light on top of whatever is there.

	A bolt is far thinner than a pixel from any distance it can be seen whole at, so its width is never let get under a
	pixel and a half: far off it is drawn as wide as that takes.
*/
export const vf_lightning =
`
	struct LightningUniforms
	{
		viewProjectionMatrix : mat4x4f,
		cameraPosition : vec4f,		// xyz, w: how much of the picture a pixel covers, as distance across per distance away
		look : vec4f,				// x: how bright the bolt is at this moment, 0 gone
	}
	@group(0) @binding(0) var<uniform> LU: LightningUniforms;

	struct VertexInput {
		@builtin(vertex_index) vertexIndex: u32,
		@location(0) start: vec4f,		// xyz: one end of the piece, w: half its width, world units
		@location(1) finish: vec4f,		// xyz: the other end, w: how bright it is next to the main stroke
	};

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) across: f32,		// -1 to 1 across the card
		@location(1) bright: f32,
	};

	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {
		var corners = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
		let corner = corners[input.vertexIndex];
		let place = mix(input.start.xyz, input.finish.xyz, corner.y);
		let toCamera = LU.cameraPosition.xyz - place;
		let sideways = normalize(cross(input.finish.xyz - input.start.xyz, toCamera) + vec3f(0.0001, 0.0, 0.0));
		// the card is 7 times as wide as the bolt, to hold its glow
		let halfWidth = max(input.start.w, 1.5 * LU.cameraPosition.w * length(toCamera)) * 7.0;

		var output: VertexOutput;
		output.pos = LU.viewProjectionMatrix * vec4f(place + sideways * corner.x * halfWidth, 1.0);
		output.across = corner.x;
		output.bright = input.finish.w * LU.look.x;
		return output;
	}

	@fragment
	fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
		let fromMiddle = abs(input.across) * 7.0;		// in widths of the bolt
		let core = exp(-fromMiddle * fromMiddle * 1.6);
		let glow = exp(-fromMiddle * 0.75) * (1.0 - abs(input.across));
		let light = vec3f(1.0, 1.0, 1.0) * core * 1.6 + vec3f(0.45, 0.6, 1.0) * glow * 0.45;
		return vec4f(light * input.bright, 1.0);
	}
`;
