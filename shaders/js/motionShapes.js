/*
	THE MOTION (temporalAA.js) of what moves of itself: its fragment shader writes, as well as its colour, where the point was on the
	screen the frame before less where it is now (a share of the screen, y down), with alpha 1 (written: vf_motion.js leaves it be).
	nowClip, prevClip: the point through this frame's view projection and the last frame's (both without the jitter), the last's after
	the thing's own move back to where it was
*/
export const motionShapes =
`
	struct FrameOut {
		@location(0) color: vec4f,
		@location(1) motion: vec4f,
	};
	fn motionOf(nowClip: vec4f, prevClip: vec4f) -> vec4f {
		let now = nowClip.xy / nowClip.w;
		let prev = prevClip.xy / prevClip.w;
		return vec4f((prev - now) * vec2f(0.5, -0.5), 0.0, 1.0);
	}
`;
