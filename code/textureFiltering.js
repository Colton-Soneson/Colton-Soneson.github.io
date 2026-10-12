import {device} from './deviceSelection.js'

import { settings } from './settings.js';

/*
	Anisotropic filtering, for everything that is drawn from a picture: the buildings and the billboards of the far trees.
	(The land, the water, the grass and the near trees are not: their colors are worked out for each pixel, there is no
	picture to filter.)

	A surface seen at a low angle covers far more of its picture along the line of sight than across it. Ordinary filtering
	has one choice of how blurred a copy of the picture to read (the mip level), and has to pick the one that suits the long
	way, which smears the short way. Anisotropic filtering reads the sharper copy several times along the long way instead:
	up to as many times as the setting says, 1 (off), 2, 4, 8 or 16.

	It needs the smaller copies to exist, so this also makes them (generateMipmaps) for pictures that come without.
*/

// the setting, brought to one of the levels there are
export function filteringLevel() {
	const asked = Number(settings.anisotropicFiltering) || 1;
	return [16, 8, 4, 2].find((level) => asked >= level) ?? 1;
}

// A sampler at the level the setting asks for. One is kept for each level, so this can be called every frame.
//		Whoever holds a bind group with one in has to make the bind group again when filteringLevel() changes
const samplers = new Map();
export function filteredSampler() {
	const level = filteringLevel();
	if (!samplers.has(level)) {
		samplers.set(level, device.createSampler({
			label: "anisotropic sampler, " + level + "x",
			magFilter: 'linear',
			minFilter: 'linear',
			mipmapFilter: 'linear',		// (all three have to be linear for anisotropy to be allowed)
			maxAnisotropy: level,
		}));
	}
	return samplers.get(level);
}

// how many copies a picture of this size has, each half the size of the last, down to 1 pixel
export function mipLevelsFor(width, height) {
	return Math.floor(Math.log2(Math.max(width, height))) + 1;
}

const mipShaderModule = device.createShaderModule({
	label: "mipmap maker",
	code: `
		@group(0) @binding(0) var larger: texture_2d<f32>;
		@group(0) @binding(1) var largerSampler: sampler;

		struct VertexOutput {
			@builtin(position) pos: vec4f,
			@location(0) uv: vec2f,
		};

		// one triangle that covers the whole picture
		@vertex
		fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
			var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
			var output: VertexOutput;
			output.pos = vec4f(corners[vertexIndex], 0.0, 1.0);
			output.uv = corners[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5, 0.5);
			return output;
		}

		@fragment
		fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
			return textureSampleLevel(larger, largerSampler, input.uv, 0.0);
		}
	`
});

const mipSampler = device.createSampler({
	magFilter: 'linear',
	minFilter: 'linear',
});

const mipPipelines = new Map();	// one for each texture format asked for

// Fills in every smaller copy of a texture from the one above it: each pixel the average of the 4 it covers.
//		The texture has to have been made with all its levels (mipLevelCount: mipLevelsFor(...)) and RENDER_ATTACHMENT usage
export function generateMipmaps(texture) {
	if (!mipPipelines.has(texture.format)) {
		mipPipelines.set(texture.format, device.createRenderPipeline({
			label: "mipmap maker pipeline, " + texture.format,
			layout: 'auto',
			vertex: { module: mipShaderModule, entryPoint: "vertexMain" },
			fragment: { module: mipShaderModule, entryPoint: "fragmentMain", targets: [{ format: texture.format }] },
			primitive: { topology: 'triangle-list' },
		}));
	}
	const pipeline = mipPipelines.get(texture.format);

	const encoder = device.createCommandEncoder();
	for (let level = 1; level < texture.mipLevelCount; level++) {
		const pass = encoder.beginRenderPass({
			colorAttachments: [{
				view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
				loadOp: "clear",
				storeOp: "store",
			}],
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }) },
				{ binding: 1, resource: mipSampler },
			],
		}));
		pass.draw(3, 1, 0, 0);
		pass.end();
	}
	device.queue.submit([encoder.finish()]);
}
