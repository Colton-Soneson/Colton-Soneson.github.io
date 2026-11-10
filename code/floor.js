import { device } from './deviceSelection.js'

/*
	THE FOREST FLOOR's map: what the roots and the windthrown trees do to the ground round the camera (forest.js makes it: THE FLOOR), for what
	stands on the ground to read (vf_terrain.js, vfc_grass.js: floorShapes). A picture from straight above, FLOOR_SPAN world units across round
	the camera (in steps, so it stays put while the camera moves a little), FLOOR_TEXELS along a side, of
		r	how far the soil is heaved up, over the roots where they run shallow under it and banked round them where they come out of it
		g	how much of the ground they cover there, 0 to 1: bare soil and moss, no litter, no grass
		b	how deep a pit is, where a root plate was torn out of the ground
		a	how high a mound, where the soil the plate held fell off it as it rotted
	(r, b, a in world units). It is read with the view it was last made with (floorUniformBuffer: forest.js writes it the frame after, so
	what reads it always reads the picture and the view together), and fades out over its edge.
*/
export const FLOOR_TEXELS = 2048;
export const FLOOR_SPAN = 320;
export const FLOOR_FORMAT = 'rgba16float';
export const floorTexture = device.createTexture({ label: 'forest floor map', size: [FLOOR_TEXELS, FLOOR_TEXELS], format: FLOOR_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
export const floorView = floorTexture.createView();
export const floorSampler = device.createSampler({ label: 'forest floor sampler', magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
// the view it was made with (16 floats) and x: 1.0 while there is one to read
export const floorUniformBuffer = device.createBuffer({ label: 'forest floor Uniform', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

// the WGSL that reads it, for a shader with it at these bindings of group 0: floorAt(xz) the map at a world position (all 0 off it)
export const floorShapes = (texture, sampler, uniforms) => `
	struct FloorUniforms
	{
		matrix : mat4x4f,		// the view it was made with (from straight above)
		look : vec4f,			// x: 1.0 if there is one
	}
	@group(0) @binding(${texture}) var floorMap: texture_2d<f32>;
	@group(0) @binding(${sampler}) var floorSampler: sampler;
	@group(0) @binding(${uniforms}) var<uniform> FLOOR: FloorUniforms;

	fn floorAt(xz: vec2f) -> vec4f {
		if (FLOOR.look.x < 0.5) {
			return vec4f(0.0, 0.0, 0.0, 0.0);
		}
		let c = FLOOR.matrix * vec4f(xz.x, 0.0, xz.y, 1.0);
		let uv = vec2f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
		let edge = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
		if (edge >= 0.5) {
			return vec4f(0.0, 0.0, 0.0, 0.0);
		}
		return textureSampleLevel(floorMap, floorSampler, uv, 0.0) * (1.0 - smoothstep(0.38, 0.49, edge));
	}
`;
