import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

import { settings } from './settings.js';

import { vf_grass } from '../shaders/js/vfc_grass.js'
import { GRASS_MAX_RINGS } from '../shaders/js/vfc_grass.js'
import { GRASS_RING_SEGMENTS } from '../shaders/js/vfc_grass.js'
import { GRASS_RING_SHIFT } from '../shaders/js/vfc_grass.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import { FOREST_THRESHOLD } from './terrainGenerator.js'
import * as wind from './wind.js'
import { weatherNow, seasonNow } from './weather.js'

//the grass fades into the horizon color, read from the sky view LUT (same as the water and the land)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	Procedural grass on the grassland zones. See the top of vfc_grass.js for how it works.

	There is nothing to keep on this side but one small uniform buffer: no blade model and no vertex buffer.
	The field is one draw call for each level of detail ring, one instance per blade and a few vertices per instance,
	and the vertex shader places and shapes every blade itself from the terrain texture that terrain.js keeps.
*/

//time
let startTime = Date.now();

const grassShaderModule = device.createShaderModule({
  label: "vf_grass",
  code: vf_grass
});

const grassUniformBuffer = device.createBuffer({
  label: "grass Uniform",
  size: 512,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

//linear sampling
const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

/*
	The level of detail rings, from the settings. Returns one { side, cellSize, radius, segments } for each:
		radius		how far out the ring reaches. The first reaches grassLodNearDistance, the last the draw distance, and the ones
					between are spaced so each is the same number of times further out than the one before
		side		blades along one side of its square grid. The blade count is shared out between the rings: every ring gets
					grassLodFarBlades times the blades of the ring inside it
		cellSize	so the grid just covers the ring
		segments	pieces each of its blades is cut into
*/
function grassRings() {
	const count = Math.min(Math.max(Math.round(settings.grassLodRings), 1), GRASS_MAX_RINGS);
	const far = Math.max(settings.grassDrawDistance, 1);
	const near = Math.min(Math.max(settings.grassLodNearDistance, 1), far);
	const growth = count > 1 ? Math.pow(far / near, 1 / (count - 1)) : 1;
	const share = Math.min(Math.max(settings.grassLodFarBlades, 0.05), 1);

	let shares = 0;
	for (let ring = 0; ring < count; ring++) {
		shares += Math.pow(share, ring);
	}

	const rings = [];
	for (let ring = 0; ring < count; ring++) {
		const radius = count > 1 ? near * Math.pow(growth, ring) : far;
		const blades = settings.grassTotalBladeCount * Math.pow(share, ring) / shares;
		const side = Math.min(Math.max(Math.floor(Math.sqrt(blades)), 1), 4000);	// (4000 a side is 16 million blades, all the instance number has room for)
		rings.push({ side: side, cellSize: 2 * radius / side, radius: radius, segments: GRASS_RING_SEGMENTS[ring] });
	}
	return rings;
}

function grassUniformBufferUpdates() {
	const bufferResult = [];

	const viewProjectionMatrix = transformations.getViewProj();
	for(let i = 0; i < 16; i++) {
		bufferResult.push(viewProjectionMatrix[i]);
	}

	bufferResult.push(settings.camPosX);
	bufferResult.push(settings.camPosY);
	bufferResult.push(settings.camPosZ);
	bufferResult.push((Date.now() - startTime) / 1000.0);	//time in seconds

	//terrain
	bufferResult.push(settings.terrainWorldSize * 0.5);
	bufferResult.push(terrain.land.cellSize);
	bufferResult.push(settings.waterWorldPosY);
	bufferResult.push(settings.terrainBeachHeight);

	//blade
	//(as tall as the season has it: cut down over the winter, grown back over the spring. And bowed under snow)
	bufferResult.push(settings.grassBladeHeight * seasonNow.grassHeight * (1 - 0.3 * weatherNow.snowCover));
	bufferResult.push(settings.grassBladeWidth);
	bufferResult.push(FOREST_THRESHOLD);
	bufferResult.push(settings.grassWindStrength);

	//grid
	const rings = grassRings();
	bufferResult.push(rings.length);
	bufferResult.push(settings.grassDrawDistance);
	bufferResult.push(settings.waterHorizonFogDistance);
	bufferResult.push(settings.enableAtmosphere ? 1 : 0);

	//wind
	bufferResult.push(...wind.windUniformValues());	//the two rows windAt takes (vf_wind.js)
	bufferResult.push(settings.windDirection[0]);
	bufferResult.push(settings.windDirection[1]);
	bufferResult.push(settings.terrainBankHeight);
	bufferResult.push(0);

	//clumps
	bufferResult.push(settings.grassClumpSize);
	bufferResult.push(settings.grassClumpPull);
	bufferResult.push(settings.grassClumpHeight);
	bufferResult.push(settings.grassClumpFacing);
	bufferResult.push(settings.grassClumpColor);
	bufferResult.push(seasonNow.hay, weatherNow.snowCover, 0);

	//the rings, and nothing for the ones there are not
	for (let ring = 0; ring < GRASS_MAX_RINGS; ring++) {
		if (ring < rings.length) {
			bufferResult.push(rings[ring].side, rings[ring].cellSize, rings[ring].radius, rings[ring].segments);
		} else {
			bufferResult.push(1, 1, 0, 1);
		}
	}

	const result = new Float32Array(bufferResult);
	device.queue.writeBuffer(grassUniformBuffer, 0, result.buffer, result.byteOffset, result.byteLength);
}

// Layouts
//-------------------------------------------------
const bindGroupVFLayout = device.createBindGroupLayout({
  label: "Grass Bind Group VF Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: {}
  },
  {
    binding: 1,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,	//lights
    buffer: {}
  },
  {
    binding: 2,								//terrain fields, read texel by texel in the vertex shader
    visibility: GPUShaderStage.VERTEX,
    texture: {
		sampleType: 'unfilterable-float',
	}
  },
  {
    binding: 3,								//sky view LUT
    visibility: GPUShaderStage.FRAGMENT,
    texture: {}
  },
  {
    binding: 4,
    visibility: GPUShaderStage.FRAGMENT,
    sampler: {}
  },
  {
    binding: 5,								//the wind texture, read in the vertex shader to bend the blades
    visibility: GPUShaderStage.VERTEX,
    texture: {}
  },
  {
    binding: 6,
    visibility: GPUShaderStage.VERTEX,
    sampler: {}
  }
  ]
});

function createVFBindGroupGrass() {
	return device.createBindGroup({
			label: "Grass VF bind group",
			layout: bindGroupVFLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: grassUniformBuffer }
			},
			{
				binding: 1,
				resource: { buffer: uniformBufferLights }
			},
			{
				binding: 2,
				resource: terrain.terrainFieldsTexture.createView()
			},
			{
				binding: 3,
				resource: skyViewLUTtexture.createView()
			},
			{
				binding: 4,
				resource: linSampler
			},
			{
				binding: 5,
				resource: wind.windTextureView
			},
			{
				binding: 6,
				resource: wind.windSampler
			}
			]
		});
}

// Pipeline
//-------------------------------------------------
const grassPipeline = device.createRenderPipeline({
  label: "grass VF pipeline",
  layout: device.createPipelineLayout({
	label: "grass VF Pipeline Layout",
	bindGroupLayouts: [ bindGroupVFLayout ],
  }),
	vertex: {
		module: grassShaderModule,
		entryPoint: "vertexMain",
		buffers: []					// none: the vertex shader makes every blade from its vertex and instance number
	},
	fragment: {
		module: grassShaderModule,
		entryPoint: "fragmentMain",
		targets: [{
		format: canvasFormat
		}]
	},

	primitive: {
		topology: 'triangle-strip',	// one strip per blade, a new strip starts with every instance
		cullMode: 'none',			// blades are seen from both sides
	},

	depthStencil: {
		depthWriteEnabled: true,
		depthCompare: 'less',
		format: 'depth24plus',
	},
});

export function grassPass(aEncoder, mainpassDepthTexture) {

	// nothing to grow on without the land
	if (!settings.enableTerrain || !terrain.terrainFieldsTexture) {
		return;
	}

	grassUniformBufferUpdates();

	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{
		view: context.getCurrentTexture().createView(),
		loadOp: "load",
		clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
		storeOp: "store",
		}],
		depthStencilAttachment: {
			view: mainpassDepthTexture.createView(),
			depthLoadOp: 'load',
			depthStoreOp: 'store',
		},
	});

	pass.setPipeline(grassPipeline);
	pass.setBindGroup(0, createVFBindGroupGrass());

	// one draw call to a ring: 2 vertices for every piece of a blade and 1 for its tip, one instance for every cell of the ring's grid.
	//		The instance numbers of a ring start at the ring's number shifted up, which is how the vertex shader knows the ring
	grassRings().forEach((ring, number) => {
		pass.draw(ring.segments * 2 + 1, ring.side * ring.side, 0, number * Math.pow(2, GRASS_RING_SHIFT));		// draw(vertexCount, instanceCount, firstVertex, firstInstance)
	});

	pass.end();
}
