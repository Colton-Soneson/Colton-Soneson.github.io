/*
	THE MOTION (temporalAA.js) of what moves of itself: its fragment shader writes, as well as its colour, where the point was on the
	screen the frame before less where it is now (a share of the screen, y down), with alpha 1 (written: vf_motion.js leaves it be).
	nowClip, prevClip: the point through this frame's view projection and the last frame's (both without the jitter), the last's after
	the thing's own move back to where it was
	REACTIVE (z, 0 to 1): something see-through drawn with holes in it (a propeller's blur, a puff of fire: screen door), whose pixels are
	now it and now what is behind it. TAA (c_taa.js) leans on this frame there, and does not let its motion stand for the pixels round it
	(what is seen through its holes has a motion of its own); FSR 3 (c_fsr3.js) has it as AMD's reactive mask
*/
export const motionShapes =
`
	struct FrameOut {
		@location(0) color: vec4f,
		@location(1) motion: vec4f,
	};
	fn motionOf(nowClip: vec4f, prevClip: vec4f) -> vec4f {
		return reactiveMotionOf(nowClip, prevClip, 0.0);
	}
	fn reactiveMotionOf(nowClip: vec4f, prevClip: vec4f, reactive: f32) -> vec4f {
		let now = nowClip.xy / nowClip.w;
		let prev = prevClip.xy / prevClip.w;
		return vec4f((prev - now) * vec2f(0.5, -0.5), reactive, 1.0);
	}
`;
