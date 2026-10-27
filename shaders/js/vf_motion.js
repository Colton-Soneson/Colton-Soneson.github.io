/*
	THE MOTION of everything that did not say how it moved (temporalAA.js): where each pixel's point was on the screen the frame
	before, from where it is now (the depth read back, through this frame's view and projection the other way) and the camera of the
	frame before. That is all the motion of the land, the trees, the houses, the water and the sky: they stay where they are and only
	the camera moves. What moves of itself (a biplane, a boat, a horse) has drawn its own already, and is kept: this is blended in only
	where nothing has been written (the motion's alpha: 1 where it has)
		out		xy: where it was less where it is now, as a share of the screen (y down), both without THE JITTER (transformations.js)
*/
export const vf_motion =
`
	struct MotionUniforms
	{
		invViewProj : mat4x4f,		// this frame's, as it was drawn (with the jitter): from the depth back to the world
		prevViewProj : mat4x4f,		// the frame before's, without the jitter
		viewProj : mat4x4f,			// this frame's, without the jitter
		size : vec4f,				// the frame's pixels across and down, and one over each
	}
	@group(0) @binding(0) var<uniform> MU: MotionUniforms;
	@group(0) @binding(1) var depthTexture: texture_depth_2d;

	// one triangle that covers the whole screen
	@vertex
	fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
		var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
		return vec4f(corners[vertexIndex], 0.0, 1.0);
	}

	// a point in clip space as a place on the screen (0 to 1 across, and down)
	fn screenOf(clip: vec4f) -> vec2f {
		let n = clip.xy / clip.w;
		return vec2f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5);
	}

	@fragment
	fn fragmentMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
		let depth = textureLoad(depthTexture, vec2i(pos.xy), 0);
		let uv = pos.xy * MU.size.zw;
		let back = MU.invViewProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
		let world = vec4f(back.xyz / back.w, 1.0);
		return vec4f(screenOf(MU.prevViewProj * world) - screenOf(MU.viewProj * world), 0.0, 1.0);
	}
`;
