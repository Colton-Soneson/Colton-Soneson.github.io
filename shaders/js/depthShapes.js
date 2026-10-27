import { reversedDepth } from '../../code/depthMode.js';

/*
	The frame's depth as the shaders that read it back see it (see depthMode.js): the usual (0 near, 1 far) or reversed-Z (1 near,
	0 far). Put into a shader's text where it is written:
		DEPTH_NEAR, DEPTH_FAR	what the depth is at the near and at the far plane (and where nothing was drawn: the sky)
		skyTest(d)				true where the depth d is nothing drawn at all
		nextDepthOut(d)			the next depth the texture can hold, further off than d (how coarse it is there)
	A depth turned back into a distance with the projection's own numbers needs nothing from here: those numbers come from the
	projection as it is in either mode
*/
export const DEPTH_NEAR = reversedDepth ? '1.0' : '0.0';
export const DEPTH_FAR = reversedDepth ? '0.0' : '1.0';
export const skyTest = (d) => reversedDepth ? `(${d} <= 0.0)` : `(${d} >= 1.0)`;
// (24 bits fixed point: a step of 1 / 2^24. 32 bit float: a step of the depth's own size over 2^23, smaller the further off)
export const nextDepthOut = (d) => reversedDepth ? `max(${d} - ${d} * 1.2e-7, 1e-30)` : `min(${d} + 1.0 / 16777216.0, 0.99999994)`;
