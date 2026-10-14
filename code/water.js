import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { c_water } from '../shaders/js/vfc_water.js'
import { c_h0k } from '../shaders/js/vfc_water.js'
import { c_h0kConj } from '../shaders/js/vfc_water.js'
import { c_hkt } from '../shaders/js/vfc_water.js'
import { c_IFFT_2D } from '../shaders/js/vfc_water.js'
import { c_PreComp } from '../shaders/js/vfc_water.js'
import { c_RealizationToArray } from '../shaders/js/vfc_water.js'
import { c_ArrayToTexture } from '../shaders/js/vfc_water.js'
import { c_Shift } from '../shaders/js/vfc_water.js'
import { c_ShoreScan } from '../shaders/js/vfc_water.js'
import { c_ShoreDistance } from '../shaders/js/vfc_water.js'
import { v_water } from '../shaders/js/vfc_water.js'
import { f_water } from '../shaders/js/vfc_water.js'
import { WATER_WORKGROUP_SIZE } from '../shaders/js/vfc_water.js'
import { FFT_WORKGROUP_SIZE } from '../shaders/js/vfc_water.js'
import { PRECOMP_WORKGROUP_SIZE } from '../shaders/js/vfc_water.js'
import { SHORE_FIELD_DOWNSCALE } from '../shaders/js/vfc_water.js'

import * as transformations from './transformations.js'
import * as scene from './scene.js'
import * as terrain from './terrain.js'	//the water reads where the land is, everywhere in the world, from terrain.terrainWaterTexture
import * as primitives from '../models/primitives.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

//the water reflects the sky and fogs into the horizon colour, both read from the sky view LUT
import {skyViewLUTtexture} from './atmosphere.js'
import * as screenEffects from './screenEffects.js'
import * as clouds from './clouds.js'

// compute shaders and buffers
//-------------------------------------------------
const waterComputeShaderModule = device.createShaderModule({
  label: "c_water",
  code: c_water	
});

const waterSpectrumComputeShaderModule = device.createShaderModule({
  label: "c_h0k",
  code: c_h0k	
});

const waterConjComputeShaderModule = device.createShaderModule({
  label: "c_h0kConj",
  code: c_h0kConj	
});

const waterButterflyPassComputeShaderModule = device.createShaderModule({
  label: "c_IFFT_2D",
  code: c_IFFT_2D	
});

const waterShiftPassComputeShaderModule = device.createShaderModule({
  label: "c_Shift",
  code: c_Shift	
});

const waterShoreScanComputeShaderModule = device.createShaderModule({
  label: "c_ShoreScan",
  code: c_ShoreScan
});

const waterShoreDistanceComputeShaderModule = device.createShaderModule({
  label: "c_ShoreDistance",
  code: c_ShoreDistance
});

const waterButterflyPassPreCompComputeShaderModule = device.createShaderModule({
  label: "c_PreComp",
  code: c_PreComp	
});

const waterRealizationToArrayComputeShaderModule = device.createShaderModule({
  label: "c_RealizationToArray",
  code: c_RealizationToArray	
});

const waterAtoTComputeShaderModule = device.createShaderModule({
  label: "c_ArrayToTexture",
  code: c_ArrayToTexture	
});

const waterWaveHeightRealizationComputeShaderModule = device.createShaderModule({
  label: "c_hkt",
  code: c_hkt	
});

const waterFragShaderModule = device.createShaderModule({
  label: "f_water",
  code: f_water	
});

const waterVertexShaderModule = device.createShaderModule({
  label: "v_water",
  code: v_water	
});

//anim
let currentFrameTime = performance.now();
let lastFrameTime = 0.0;
let step = 0.0;

//random for initial wave map
function gaussianRandom(mean, standardDeviation) {
	//BoxMuller transform
	let a = Math.random();
	let b = Math.random();
	let z = Math.sqrt(-2.0 * Math.log(a)) * Math.cos(2.0 * Math.PI * b);
	return z * standardDeviation + mean;
}

function gaussianClampedRandom(mean, standardDeviation) {
	let a = Math.random();
	let b = Math.random();
	let z = Math.sqrt(-2.0 * Math.log(a)) * Math.cos(2.0 * Math.PI * b);
	z = z * standardDeviation + mean;

	// Normalize to [0, 1], the 3 is to get the majority of the generated numbers on the curve
	const min = mean - 3 * standardDeviation;
	const max = mean + 3 * standardDeviation;
	return Math.min(1, Math.max(0, (z - min) / (max - min)));
}

function complexGaussianRandom(mean, standardDeviation, arrayLength) {
	const result = [];
	for(let i = 0; i < arrayLength; ++i) {
		//TRUE GAUSSIAN, typically from ~-3 to 3 range
		const rk = gaussianRandom(mean, standardDeviation);
		const ik = gaussianRandom(mean, standardDeviation);
		
		////Gaussian clamped from 0 to 1, normalized distribution, for Phillips Spectrum dont use
		//const r = gaussianClampedRandom(mean, standardDeviation);
		//const i = gaussianClampedRandom(mean, standardDeviation);
		
		result.push(rk);
		result.push(ik);
	}
	console.log("Water tile res sqrd: ", arrayLength);
	return result;
}

function generateHermitianSymmetricComplexGaussian(resolution) {
	const size = resolution * resolution;
	const data = new Float32Array(size * 2); // real + imag for each texel

	const N = resolution;

	for (let y = 0; y < N; y++) {
		for (let x = 0; x < N; x++) {
			const i = y * N + x;
			const jx = (N - x) % N;
			const jy = (N - y) % N;
			const j = jy * N + jx;

			if (i < j) {
				const real = gaussianRandom(0, 1);
				const imag = gaussianRandom(0, 1);

				data[i * 2 + 0] = real;
				data[i * 2 + 1] = imag;

				data[j * 2 + 0] = real;
				data[j * 2 + 1] = -imag;
			}
			else if (i === j) {
				// Pure real (self-conjugate)
				const real = gaussianRandom(0, 1);
				data[i * 2 + 0] = real;
				data[i * 2 + 1] = 0.0;
			}
			// else: already assigned in a previous iteration
		}
	}

	return data;
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function complexGaussianRandomForH0(arrayLength) {
	const result = [];
	for(let i = 0; i < arrayLength; ++i) {
		const u0 = 2.0 * Math.PI * clamp(Math.random(), 0.001, 1.0);
		const v0 = Math.sqrt(-2.0 * Math.log(clamp(Math.random(), 0.001, 1.0)));
		const u1 = 2.0 * Math.PI * clamp(Math.random(), 0.001, 1.0);	//this would be a different call to random
		const v1 = Math.sqrt(-2.0 * Math.log(clamp(Math.random(), 0.001, 1.0)));
		
		
		result.push(v0 * Math.cos(u0));	//gauss k real
		result.push(v0 * Math.sin(u0));	//gauss k imag
		result.push(v1 * Math.cos(u1));	//gauss -k real
		result.push(v1 * Math.sin(u1));	//gause -k imag
	}
	return result;
}


//const complexGaussArray = new Float32Array(complexGaussianRandom(0.0, 1.0, 2.0 * settings.waterTileResolution * settings.waterTileResolution));	//4: kr, ki, -kr, -ki
const complexGaussArray = new Float32Array(complexGaussianRandomForH0(settings.waterTileResolution * settings.waterTileResolution));	//4: kr, ki, -kr, -ki
console.log("gauss array length: ", complexGaussArray.byteLength / 4);
//const complexGaussArray = generateHermitianSymmetricComplexGaussian(settings.waterTileResolution);
//console.log("Complex Gaussian Num Array: ", complexGaussArray);

//bit reversed indices
function reverseBits(x, bitSize = 32) {
    let result = 0;
    for (let i = 0; i < bitSize; i++) {
        if (x & (1 << i)) {
            result |= 1 << ((bitSize - 1) - i);
        }
    }
    return result >>> 0; // Ensure unsigned
}

function bitReversedIndicies(arrayLength) {
	const result = [];
    const bits = Math.log2(arrayLength);
    for (let i = 0; i < arrayLength; i++)
    {
        let x = reverseBits(i);
        x = ((x << bits) | (x >>> (32 - bits))) >>> 0;
        result.push(x);
    }
	return result;
}
const bitReversedIndicesArray = new Float32Array(bitReversedIndicies(settings.waterTileResolution));
console.log("Bit Reversed Indices Array: ", bitReversedIndicesArray);

//if settings change live, this will have to be changed out from constants													!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
let waterPlaneVertexStride = (3 + 2 + 3);
let totalTileCount = settings.waterTileInstanceCount * settings.waterTileInstanceCount;

// Level of detail. The tiles sit in square rings around the tile the camera is over, and every ring out halves the mesh resolution:
//		ring 0 has one cell per wave texel, ring 1 one per 2 texels, ring 2 one per 4... down to a 2x2 cell tile at the least
//		A tile slot always belongs to the same ring, so its buffers are sized once for the mesh that ring needs
function getTileLayout() {
	const half = Math.floor(settings.waterTileInstanceCount / 2);
	const cellsForRing = (ring) => Math.max(settings.waterTileResolution / Math.pow(2, ring), 2);
	const ringOf = (col, row) => Math.max(Math.abs(col), Math.abs(row));
	// 1 when the tile over an edge has a coarser mesh. Off the outside of the grid is the flat horizon plane, which has nothing to match up with
	const isCoarser = (col, row, cells) => (ringOf(col, row) <= half && cellsForRing(ringOf(col, row)) < cells) ? 1 : 0;

	const layout = [];
	for (let row = -half; row <= half; row++) {		//same order as getTileOffsets
		for (let col = -half; col <= half; col++) {
			const cells = cellsForRing(ringOf(col, row));
			layout.push({
				cells: cells,										//cells along one side
				vertexCount: (cells + 1) * (cells + 1),
				indexCount: cells * cells * 6,						//2 triangles per cell
				coarserEdges: [isCoarser(col - 1, row, cells), isCoarser(col + 1, row, cells),
								isCoarser(col, row - 1, cells), isCoarser(col, row + 1, cells)],	//-x, +x, -z, +z
			});
		}
	}
	return layout;
}
let waterTileLayout = getTileLayout();

// distance from the camera where the open ocean waves have flattened out. The camera can be anywhere over the middle tile,
//		so this is the nearest the outside edge of the tile grid can ever be to it: by there the water has to be flat to meet the horizon plane
function getWaveFadeDistance() {
	return Math.max((settings.waterTileInstanceCount - 1) * 0.5, 0.45) * settings.waterGridSize;
}

//model list specific
const uboOffset = 256;	//this is a defaulted max for UBO, nothing I wrote equals up to 256, its a limiter
const totalwaterUniformArraySize = 320; //(4 * 4 * 4) 4x4 matrix for MVP, forget the rest for in shader
const waterUniformBuffer = device.createBuffer({
  label: "water space Uniform",
  size: totalwaterUniformArraySize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

//compute water anim data
const uniformArrayComputewater= 256;	//default for now
const uniformBufferComputeWaterPreMesh = device.createBuffer({
  label: "water Compute settings Uniform Buffer for Pre Mesh and Cascades",
  size: uniformArrayComputewater,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

const waterComputeUniformBuffers = [];
for (let i = 0; i < totalTileCount; i++) {
    waterComputeUniformBuffers.push(device.createBuffer({
        label: `water compute uniform tile ${i}`,
        size: uniformArrayComputewater,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }));
}

// The butterfly passes' settings (direction, stage, which ping pong buffer to read): one slot for every pass of an IFFT, written
//		once (writeButterflySlots) and picked with a dynamic offset. They never change for a resolution, and with one slot each
//		every pass of the water can go in one command encoder and one submit (see waterIFFT), instead of a submit for every pass
//		so that the next pass's settings could be written over the last's
const BUTTERFLY_SLOT = 256;			// bytes from one slot to the next (the least a dynamic offset can step)
const MAX_FFT_STAGES = 12;			// log2 of the largest tile resolution there could be, with room to spare
const uniformBufferComputeButterfly = device.createBuffer({
  label: "water Compute Butterfly settings Uniform Buffer",
  size: BUTTERFLY_SLOT * 2 * MAX_FFT_STAGES,	// a slot for every horizontal stage, then every vertical one
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

let uniformBufferComplexGaussian = device.createBuffer({
  label: "water Spectrum Compute Complex Gaussian Array Buffer",
  size: complexGaussArray.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});
device.queue.writeBuffer(uniformBufferComplexGaussian, /*bufferOffset=*/0, complexGaussArray); //copy vertex data to buffer

let uniformBufferBitReversedIndices = device.createBuffer({
  label: "water butterfly bit reversed indices Array Buffer",
  size: bitReversedIndicesArray.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});
device.queue.writeBuffer(uniformBufferBitReversedIndices, /*bufferOffset=*/0, bitReversedIndicesArray); //copy vertex data to buffer

//conversion for texture to f32 array, makes the passing faster and easier to manage with RW capabilities
const lengthOfTwoElementWaterTileArray = settings.waterTileResolution * settings.waterTileResolution * 2 * 4; // real and imaginary per vertex by float size
let uniformBufferRtoA = device.createBuffer({
  label: "water Realization to Array  Array Buffer",
  size: lengthOfTwoElementWaterTileArray,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
});
let uniformBufferPingPong = device.createBuffer({
  label: "water Ping Pong Array Buffer",
  size: lengthOfTwoElementWaterTileArray,
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
});


const waterVertexBuffers = [];
const waterIndexBuffers = [];

for (let i = 0; i < totalTileCount; i++) {
    waterVertexBuffers.push(device.createBuffer({
        label: `water vertex buffer tile ${i}`,
        size: waterTileLayout[i].vertexCount * waterPlaneVertexStride * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));
    waterIndexBuffers.push(device.createBuffer({
        label: `water index buffer tile ${i}`,
        size: waterTileLayout[i].indexCount * Uint32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));
}

// Horizon plane: one flat ring of water from the outside edge of the tile grid out to (as good as) infinity. 4 quads, 8 vertices.
//		the tiles have flattened out by their outside edge, so it meets them with no seam, and the vertex shader keeps it from being clipped at the far plane
const horizonPlaneReach = 1000000.0;
const waterHorizonVertexBuffer = device.createBuffer({
	label: "water horizon plane vertex buffer",
	size: 8 * waterPlaneVertexStride * Float32Array.BYTES_PER_ELEMENT,
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
const waterHorizonIndices = new Uint32Array([0,1,5, 0,5,4,  1,2,6, 1,6,5,  2,3,7, 2,7,6,  3,0,4, 3,4,7]);	//inner corners 0-3, outer corners 4-7
const waterHorizonIndexBuffer = device.createBuffer({
	label: "water horizon plane index buffer",
	size: waterHorizonIndices.byteLength,
	usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(waterHorizonIndexBuffer, 0, waterHorizonIndices);

function waterHorizonPlaneUpdate(originX, originZ) {
	const inner = settings.waterTileInstanceCount * settings.waterGridSize * 0.5;	//outside edge of the tile grid
	const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

	const verts = [];
	for (const reach of [inner, inner + horizonPlaneReach]) {
		for (const [signX, signZ] of corners) {
			verts.push(originX + signX * reach, settings.waterWorldPosY, originZ + signZ * reach);	//position
			verts.push(0.0, 1000.0);	//uv slot: no foam, and bottomless so its never see-through
			verts.push(0.0, 1.0, 0.0);	//normal straight up
		}
	}
	device.queue.writeBuffer(waterHorizonVertexBuffer, 0, new Float32Array(verts));
}

//Phillips Spectrum
export let phillipsSpectrumTexture = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

//h0k without conj
export let h0k = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

export let h0Minusk = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

//inital Water Height map h0(k) and h0(-k)
export let initialWaterHeightMap = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

export let hkt = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

export let waveHeightRealization = device.createTexture({
  label: "wave Height Realization Texture",
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
});

//frequency domain horizontal displacement, written alongside hkt
export let displacementRealizationTexture = device.createTexture({
  label: "water displacement realization Texture for choppy waves",
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
});

export let preCompTexture = device.createTexture({
  size: [Math.log2(settings.waterTileResolution), settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

//wont be available for debug view as its an inbetween
export let pingPongIFFTTexture = device.createTexture({
  label: "ping pong IFFT Texture",
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
});

export let finalIFFTOutput = device.createTexture({
  label: "final IFFT Texture",
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
});

let prePingPongIFFTTexture = device.createTexture({
  label: "pre ping pong IFFT Texture",
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
});

export let preShiftFinalWaveHeightTexture = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});


export let finalWaveHeightTexture = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

//spatial horizontal displacement after its own IFFT, x: Dx, y: Dz
export let finalDisplacementTexture = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

//shore distance field, a low resolution companion to the top down height map. Sized off the height map, not the water tile, so it never needs rebuilding
const shoreFieldResolution = settings.heightMapResolution / SHORE_FIELD_DOWNSCALE;

//x: how many texels up or down the column the nearest land is
let shoreScanTexture = device.createTexture({
  label: "water shore scan Texture",
  size: [shoreFieldResolution, shoreFieldResolution],
  format: 'r32float',
  usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

//x: world distance to the nearest land
export let shoreDistanceTexture = device.createTexture({
  label: "water shore distance Texture",
  size: [shoreFieldResolution, shoreFieldResolution],
  format: 'r32float',
  usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

//linear sampling
const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

// tile snapping. Infinite ocean needs tiles to spawn and lock according to camera position
//		tiles are centered on their offset, so rounding keeps the camera over the middle tile (the one with the full detail mesh)
function getSnappedTileOrigin(camX, camZ, tileSize) {
    return [
        Math.round(camX / tileSize) * tileSize,
        Math.round(camZ / tileSize) * tileSize
    ];
}

function getTileOffsets(camX, camZ) {
    const size = settings.waterGridSize;	//WAS oceanPlanePhysicalSize until that was just used for Phillips calc
    const [snapX, snapZ] = getSnappedTileOrigin(camX, camZ, size); 	// offsets based on camera snapped position
    const half = Math.floor(settings.waterTileInstanceCount / 2);
    
    const offsets = [];
    for (let row = -half; row <= half; row++) {
        for (let col = -half; col <= half; col++) {
            offsets.push([
                snapX + col * size,
                0,
                snapZ + row * size
            ]);
        }
    }
    return offsets;
}

function getwaterComputeInfo(tileOffsetX = 0, tileOffsetZ = 0, tile = null) {
	const waterCompBuffer = [];
	
	waterCompBuffer.push(settings.camPosX);
	waterCompBuffer.push(settings.camPosY);
	waterCompBuffer.push(settings.camPosZ);
	waterCompBuffer.push(1);	//padding
	
	waterCompBuffer.push(settings.windDirection[0]);
	waterCompBuffer.push(settings.windDirection[1]);
	
	waterCompBuffer.push(settings.waterTileResolution);
	waterCompBuffer.push(settings.waterWaveSteepness);
	waterCompBuffer.push(step);	
	waterCompBuffer.push(settings.waterWorldPosY);
	waterCompBuffer.push(settings.waterWaveLength);
	waterCompBuffer.push(settings.waterOceanPlanePhysicalSize);
	waterCompBuffer.push(settings.waterWindSpeed);
	
	waterCompBuffer.push(tileOffsetX);
	waterCompBuffer.push(tileOffsetZ);
	waterCompBuffer.push(0);	//padding: a vec2f in a uniform struct has to start on an 8 byte boundary, without this the shader read gridSize.y as 0

	// square grid
	waterCompBuffer.push(settings.waterGridSize);
	waterCompBuffer.push(settings.waterGridSize);

	// level of detail of the tile being built. Only the mesh pass reads these, the passes before it stop at the values above
	waterCompBuffer.push(tile ? tile.cells : settings.waterTileResolution);
	waterCompBuffer.push(getWaveFadeDistance());
	const coarserEdges = tile ? tile.coarserEdges : [0, 0, 0, 0];
	for (let i = 0; i < 4; i++) {
		waterCompBuffer.push(coarserEdges[i]);
	}

	// look settings for the mesh pass, same order as the end of WaterUniforms in c_water
	waterCompBuffer.push(settings.waterChoppiness);
	waterCompBuffer.push(settings.waterFoamThreshold);
	waterCompBuffer.push(settings.waterFoamFade);
	waterCompBuffer.push(settings.waterShoreZone);
	waterCompBuffer.push(settings.waterShoreWaveHeight);
	waterCompBuffer.push(settings.waterShoreBreakDistance);
	waterCompBuffer.push(settings.waterShoreSteepness);
	waterCompBuffer.push(settings.waterShoreWaveLength1);
	waterCompBuffer.push(settings.waterShoreWaveLength2);
	waterCompBuffer.push(settings.waterShoreWaveSpeed);
	waterCompBuffer.push(settings.waterFullDepth);
	waterCompBuffer.push(settings.waterShallowRippleScale);
	waterCompBuffer.push(settings.waterDeepSeaDepth);
	waterCompBuffer.push(settings.waterSwellHeight);
	waterCompBuffer.push(settings.waterSwellLength);
	waterCompBuffer.push(settings.waterSwellSteepness);
	waterCompBuffer.push(settings.waterSwellSpeed);
	waterCompBuffer.push(settings.waterSwellShoreDistance);

	// the terrain grid, so the mesh pass can look a world position up in the terrain's texture. A size of 0 tells it there is no land
	waterCompBuffer.push(settings.enableTerrain ? settings.terrainWorldSize * 0.5 : 0);
	waterCompBuffer.push(terrain.land.cellSize);
	
		
	return new Float32Array(waterCompBuffer);
}

function waterMeshUniformBufferUpdates(numInstances, tileOffset) {
		
		const bufferResult = [];
		//const adjustedPos = [centerWaterPlanePosition[0] + pos[0], 
		//					centerWaterPlanePosition[1] + pos[1], 
		//					centerWaterPlanePosition[2] + pos[2]];
		
		//for now this will be model mat, but its should just be default everything to save time (but scale might be good to avoid model crap)
		const modelMatrix = transformations.getModelMatrix(new Float32Array([0.0,0.0,0.0]), 
															new Float32Array([0.0,0.0,0.0]),
															new Float32Array([1.0,1.0,1.0]));
		const modelViewMat = mat4.mul(transformations.getViewMatrix(), modelMatrix);
		const modelViewProjectionMatrix = mat4.mul(transformations.projectionMatrix, modelViewMat);
		
		const topDownVP = transformations.getTopDownViewProjectionMat();
		const topDownInverseVP = mat4.invert(topDownVP);
				
		for(let i = 0; i < 16; i++) {
			bufferResult.push(modelViewProjectionMatrix[i]);
		}
		
		for(let i = 0; i < 16; i++) {
			bufferResult.push(topDownVP[i]);
		}
		
		for(let i = 0; i < 16; i++) {
			bufferResult.push(topDownInverseVP[i]);
		}
		
		bufferResult.push(settings.heightMapResolution);
		bufferResult.push(settings.heightMapResolution);

		//for the fragment shader: whether there is a sky LUT to reflect and fog into, and how far out the fog sets in
		bufferResult.push(settings.enableAtmosphere ? 1 : 0);
		bufferResult.push(settings.waterHorizonFogDistance);
		bufferResult.push(settings.waterClarityDepth);

		bufferResult.push(0, 0, 0);	//(the vec4f after this has to start on a 16 byte boundary, and with these three in front of it it does)

		//and for the reflections it finds on the screen: the two numbers of the projection matrix that turn a depth back into a distance,
		//		how strongly they show (not at all if there is no copy of the frame to find them in), and how far out they are looked for
		bufferResult.push(transformations.projectionMatrix[10]);
		bufferResult.push(transformations.projectionMatrix[14]);
		bufferResult.push(screenEffects.sceneCopyReady ? settings.ssrStrength : 0);
		bufferResult.push(settings.ssrDistance);

		//and where the cloud coverage map is, for the shadows of the clouds on the water
		bufferResult.push(...clouds.cloudMapValues());
		
		const result = new Float32Array(bufferResult);
		
		device.queue.writeBuffer(waterUniformBuffer, 
								0,
								result.buffer,
								result.byteOffset,
								result.byteLength);
}

function waterComputeBuffersUpdate(targetWaterComputeBuffer, tileX = 0, tileZ = 0, tile = null) {
	const gcInfo = getwaterComputeInfo(tileX, tileZ, tile);

	device.queue.writeBuffer(targetWaterComputeBuffer, 
									0,	//apparently uniform buffer size defaults to a need of 256 
									gcInfo.buffer,
									gcInfo.byteOffset,
									gcInfo.byteLength);
}

// Writes the settings of every butterfly pass for this many stages into its slot: the horizontal passes, then the vertical,
//		the ping pong buffer read from swapping at each one. Only when the number of stages changes (the tile resolution)
let butterflyStagesWritten = 0;
function writeButterflySlots(stages) {
	if (stages === butterflyStagesWritten) {
		return;
	}
	butterflyStagesWritten = stages;
	const slots = new Float32Array(BUTTERFLY_SLOT / 4 * 2 * stages);
	let pingPong = false;
	for (let direction = 0; direction < 2; direction++) {
		for (let stage = 0; stage < stages; stage++) {
			slots.set([direction, stage, pingPong ? 1.0 : 0.0, 1.0], (direction * stages + stage) * BUTTERFLY_SLOT / 4);	//(the last is padding, to keep the alignment)
			pingPong = !pingPong;
		}
	}
	device.queue.writeBuffer(uniformBufferComputeButterfly, 0, slots);
}

// the dynamic offset of a butterfly pass's slot
const butterflySlot = (direction, stage) => (direction * butterflyStagesWritten + stage) * BUTTERFLY_SLOT;

// Bind groups are made once and kept, and only made again when one of the things in them has been replaced (the textures and
//		buffers that go with the tile resolution, the copies of the frame that go with the window's size...). parts: everything
//		in the bind group that can be replaced. Making them every frame was most of the CPU time of the water
const bindGroupCache = new Map();
function cachedBindGroup(name, parts, make) {
	const kept = bindGroupCache.get(name);
	if (kept && kept.parts.length === parts.length && kept.parts.every((part, i) => part === parts[i])) {
		return kept.group;
	}
	const group = make();
	bindGroupCache.set(name, { parts: parts, group: group });
	return group;
}

// Layouts
//-------------------------------------------------
// Create the bind group layout and pipeline layout.
const bindGroupVFLayout = device.createBindGroupLayout({
  label: "water Bind Group VF Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: {
		type: 'uniform'
	} 
  },
  {
    binding: 1,
    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
    buffer: {
		type: 'uniform'
	}
  },
  {
    binding: 2,								//sky view LUT
    visibility: GPUShaderStage.FRAGMENT,
    texture: {}
  },
  {
    binding: 3,
    visibility: GPUShaderStage.FRAGMENT,
    sampler: {}
  },
  {
    binding: 6,								//the frame as it stood before the water, to find reflections in. See screenEffects.js
    visibility: GPUShaderStage.FRAGMENT,
    texture: {}
  },
  {
    binding: 7,								//and its depth
    visibility: GPUShaderStage.FRAGMENT,
    texture: { sampleType: 'depth' }
  },
  {
    binding: 8,								//the clouds from above: their shadows on the water. See clouds.js
    visibility: GPUShaderStage.FRAGMENT,
    texture: {}
  },
  {
    binding: 9,
    visibility: GPUShaderStage.FRAGMENT,
    sampler: {}
  }
  ]
});

const bindGroupCLayout = device.createBindGroupLayout({
  label: "water Bind Group C Layout",
  entries: [{
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//spaces
    buffer: {} 
  },
  {
    binding: 1,
    visibility: GPUShaderStage.COMPUTE,	//settings
    buffer: {} 
  },
  {
	binding: 2,								
    visibility:  GPUShaderStage.COMPUTE,	//output vertex data for all blades
    buffer: {
		type: "storage",
		access: "read-write",
	}
  },
  {
	binding: 3,								
    visibility:  GPUShaderStage.COMPUTE,	//output index data for all blades
    buffer: {
		type: "storage",
		access: "read-write",
	}
  },
  {
    binding: 4,								//inTexture for initial wave height map
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",   // Format must match the swap chain texture
		access: "read-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
    binding: 5,
    visibility: GPUShaderStage.COMPUTE,
    texture: {
		sampleType: 'depth',
	},
  },
  {
    binding: 6,								//inTexture for final horizontal displacement
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",
		access: "read-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
    binding: 7,								//inTexture for shore distance field
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "r32float",
		access: "read-only",
		dimension: "2d",
    }
  },
  {
    binding: 8,								//the whole world's land: ground height and distance to shore
    visibility:  GPUShaderStage.COMPUTE,
    texture: {
		sampleType: 'unfilterable-float',
	}
  }
  ]
});

const bindGroupShoreScanCLayout = device.createBindGroupLayout({
  label: "water Bind Group Shore Scan C Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//spaces
    buffer: {}
  },
  {
    binding: 1,
    visibility: GPUShaderStage.COMPUTE,	//settings
    buffer: {}
  },
  {
    binding: 2,								//top down height map
    visibility: GPUShaderStage.COMPUTE,
    texture: {
		sampleType: 'depth',
	},
  },
  {
    binding: 3,								//outTexture for column scan
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "r32float",
		access: "write-only",
		dimension: "2d",
    }
  }
  ]
});

const bindGroupShoreDistanceCLayout = device.createBindGroupLayout({
  label: "water Bind Group Shore Distance C Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//spaces
    buffer: {}
  },
  {
    binding: 1,								//inTexture for column scan
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "r32float",
		access: "read-only",
		dimension: "2d",
    }
  },
  {
    binding: 2,								//outTexture for shore distance field
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "r32float",
		access: "write-only",
		dimension: "2d",
    }
  }
  ]
});

const bindGroupSpectrumCLayout = device.createBindGroupLayout({
  label: "water Bind Group Spectrum C Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//settings
    buffer: {} 
  },
  {
    binding: 1,								//outTexture for PS
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",   // Format must match the swap chain texture
		access: "write-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
    binding: 2,								//outTexture for PS
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",   // Format must match the swap chain texture
		access: "write-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
	binding: 3,								
    visibility:  GPUShaderStage.COMPUTE,
    buffer: {
		type: "storage",
		access: "read-write",
	}
  }
  ]
});

const bindGroupConjCLayout = device.createBindGroupLayout({
  label: "water Bind Group H0K Conjugate C Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//settings
    buffer: {} 
  },
  {
    binding: 1,								//in h0k
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",   // Format must match the swap chain texture
		access: "read-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
    binding: 2,								//outTexture for initialHeight
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",   // Format must match the swap chain texture
		access: "write-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  }
  ]
});

const bindGroupRealizationCLayout = device.createBindGroupLayout({
  label: "water Bind Group HKT Realization C Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//settings
    buffer: {} 
  },
  {
    binding: 1,								//inTexture for initial Height
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",   // Format must match the swap chain texture
		access: "read-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
    binding: 2,								//outTexture for waveHeightRealization
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",   // Format must match the swap chain texture
		access: "write-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
    binding: 3,								//outTexture for water displacement realization
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",
		access: "write-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  }
  ]
});

const bindGroupRtoACLayout = device.createBindGroupLayout({
  label: "water Bind Group RtoA C Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//settings
    buffer: {} 
  },
  {
    binding: 1,								//outTexture for pingpong
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",   // changed for high precisions
		access: "read-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
	binding: 2,								
    visibility:  GPUShaderStage.COMPUTE,
    buffer: {
		type: "storage",
		access: "read-write",
	}
  }
  ]
});

const bindGroupAtoTCLayout = device.createBindGroupLayout({
  label: "water Bind Group AtoT C Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//settings
    buffer: {} 
  },
  {
	binding: 1,								
    visibility:  GPUShaderStage.COMPUTE,
    buffer: {
		type: "storage",
		access: "read-write",
	}
  },
  {
    binding: 2,
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",   // changed for high precisions
		access: "write-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  ]
});

const bindGroupButterflyPreCompCLayout = device.createBindGroupLayout({
  label: "water Bind Group Butterfly Pre Comp C Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//settings
    buffer: {} 
  },
  {
    binding: 1,								//outTexture for pingpong
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",   // changed for high precisions
		access: "write-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
    binding: 2,
    visibility: GPUShaderStage.COMPUTE,	//settings
    buffer: {} 
  },
  {
	binding: 3,								
    visibility:  GPUShaderStage.COMPUTE,
    buffer: {
		type: "storage",
		access: "read-write",
	}
  }
  ]
});

const bindGroupButterflyCLayout = device.createBindGroupLayout({
  label: "water Bind Group Butterfly C Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//settings
    buffer: {} 
  },
  /*
  {
    binding: 1,								//inTexture
    visibility:  GPUShaderStage.COMPUTE,
    texture: {
		sampleType: "unfilterable-float"
	}
  },
  {
    binding: 2,								//outTexture
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",  
		access: "write-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  */
  {
	binding: 1,								
    visibility:  GPUShaderStage.COMPUTE,	//pingpongA
    buffer: {
		type: "storage",
		access: "read-write",
	}
  },
  {
	binding: 2,								
    visibility:  GPUShaderStage.COMPUTE,	//pingpongB
    buffer: {
		type: "storage",
		access: "read-write",
	}
  },
  {
    binding: 3,
    visibility: GPUShaderStage.COMPUTE,	//settings: the pass's own slot, see writeButterflySlots
    buffer: { hasDynamicOffset: true }
  },
  {
    binding: 4,								//precomp buffer
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",   // Format must match the swap chain texture
		access: "read-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  }
  ]
});

const bindGroupShiftCLayout = device.createBindGroupLayout({
  label: "water Bind Group Shift C Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//settings
    buffer: {} 
  },
  {
    binding: 1,								//inTexture for waveHeightRealization
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",   // Format must match the swap chain texture
		access: "read-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  },
  {
    binding: 2,								//outTexture for pingpong
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",   // Format must match the swap chain texture
		access: "write-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
    }
  }
  ]
});

//multi bind group
function makeVFBindGroupswater() {
	return device.createBindGroup({
			label: "water VF bind group",
			layout: bindGroupVFLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: waterUniformBuffer }
			},
			{
				binding: 1,
				resource: { buffer: uniformBufferLights }
			},
			{
				binding: 2,
				resource: skyViewLUTtexture.createView()
			},
			{
				binding: 3,
				resource: linSampler
			},
			{
				binding: 6,
				resource: screenEffects.sceneColorTexture.createView()
			},
			{
				binding: 7,
				resource: screenEffects.sceneDepthTexture.createView()
			},
			{
				binding: 8,
				resource: clouds.cloudCoverageView
			},
			{
				binding: 9,
				resource: clouds.cloudMapSampler
			}
			]
		});
}

function makeCompBindGroupwater(vertexBuffer, indexBuffer, computeUniformBuffer) {
	
	const result = 
		device.createBindGroup({
			label: "water Comp bind group",
			layout: bindGroupCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: waterUniformBuffer }
			},
			{
				binding: 1,
				resource: { buffer: computeUniformBuffer }
			},
			{
				binding: 2,
				resource: { buffer: vertexBuffer }
				//resource: { buffer: totalwaterVertexBuffer }
			},
			{
				binding: 3,
				resource: { buffer: indexBuffer }
				//resource: { buffer: totalwaterIndexBuffer }
			},
			{
				binding: 4,
				resource: finalWaveHeightTexture.createView()
			},
			{
				binding: 5,
				resource: scene.heightMapView
			},
			{
				binding: 6,
				resource: finalDisplacementTexture.createView()
			},
			{
				binding: 7,
				resource: shoreDistanceTexture.createView()
			},
			{
				binding: 8,
				resource: terrain.terrainWaterTexture.createView()
			}
			]
		});
	return result;
}

function makeCompBindGroupShoreScanWater() {

	const result =
		device.createBindGroup({
			label: "water Comp shore scan bind group",
			layout: bindGroupShoreScanCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: waterUniformBuffer }
			},
			{
				binding: 1,
				resource: { buffer: uniformBufferComputeWaterPreMesh }
			},
			{
				binding: 2,
				resource: scene.heightMapView
			},
			{
				binding: 3,
				resource: shoreScanTexture.createView()
			}
			]
		});
	return result;
}

function makeCompBindGroupShoreDistanceWater() {

	const result =
		device.createBindGroup({
			label: "water Comp shore distance bind group",
			layout: bindGroupShoreDistanceCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: waterUniformBuffer }
			},
			{
				binding: 1,
				resource: shoreScanTexture.createView()
			},
			{
				binding: 2,
				resource: shoreDistanceTexture.createView()
			}
			]
		});
	return result;
}

function makeCompBindGroupSpectrumWater() {
	
	const result = 
		device.createBindGroup({
			label: "water Comp spectrum bind group",
			layout: bindGroupSpectrumCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: uniformBufferComputeWaterPreMesh }
			},
			{
				binding: 1,
				resource: phillipsSpectrumTexture.createView()
			},
			{
				binding: 2,
				resource: h0k.createView()
			},
			{
				binding: 3,
				resource: { buffer: uniformBufferComplexGaussian }
			}
			]
		});
	return result;
}

function makeCompBindGroupConjWater() {
	
	const result = 
		device.createBindGroup({
			label: "water Comp Conj bind group",
			layout: bindGroupConjCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: uniformBufferComputeWaterPreMesh }
			},
			{
				binding: 1,
				resource: h0k.createView()
			},
			{
				binding: 2,
				resource: initialWaterHeightMap.createView()
			}
			]
		});
	return result;
}

function makeCompBindGroupRealizationWater() {
	
	const result = 
		device.createBindGroup({
			label: "water Comp Realization bind group",
			layout: bindGroupRealizationCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: uniformBufferComputeWaterPreMesh }
			},
			{
				binding: 1,
				resource: initialWaterHeightMap.createView()
			},
			{
				binding: 2,
				resource: waveHeightRealization.createView()
			},
			{
				binding: 3,
				resource: displacementRealizationTexture.createView()
			}
			]
		});
	return result;
}

function makeCompBindGroupRtoAWater(inTexture) {

	const result =
		device.createBindGroup({
			label: "water Comp RtoA bind group",
			layout: bindGroupRtoACLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: uniformBufferComputeWaterPreMesh }
			},
			{
				binding: 1,
				resource: inTexture.createView()
			},
			{
				binding: 2,
				resource: { buffer: uniformBufferRtoA }
			}
			]
		});
	return result;
}

function makeCompBindGroupAtoTWater(inPingPong) {
	
	const result = 
		device.createBindGroup({
			label: "water Comp AtoT bind group",
			layout: bindGroupAtoTCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: uniformBufferComputeWaterPreMesh }
			},
			{
				binding: 1,
				resource: { buffer: inPingPong }
			},
			{
				binding: 2,
				resource: finalIFFTOutput.createView()
			}
			]
		});
	return result;
}

function makeCompBindGroupButterflyPreCompWater() {
	
	const result = 
		device.createBindGroup({
			label: "water Comp Butterfly Pre Comp bind group",
			layout: bindGroupButterflyPreCompCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: uniformBufferComputeWaterPreMesh }
			},
			{
				binding: 1,
				resource: preCompTexture.createView()
			},
			{
				binding: 2,
				resource: { buffer: uniformBufferComputeButterfly, size: 16 }	//(the precompute does not read it)
			},
			{
				binding: 3,
				resource: { buffer: uniformBufferBitReversedIndices }
			}
			]
		});
	return result;
}

function makeCompBindGroupButterflyWater(/*inTexture, outTexture*/) {
	
	const result = 
		device.createBindGroup({
			label: "water Comp Butterfly bind group",
			layout: bindGroupButterflyCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: uniformBufferComputeWaterPreMesh }
			},
			/*
			{
				binding: 1,
				resource: inTexture.createView()
			},
			{
				binding: 2,
				resource: outTexture.createView()
			},
			*/
			{
				binding: 1,
				resource: { buffer: uniformBufferRtoA }
			},
			{
				binding: 2,
				resource: { buffer: uniformBufferPingPong }
			},
			{
				binding: 3,
				resource: { buffer: uniformBufferComputeButterfly, size: 16 }	//(one slot of it, picked with a dynamic offset: see writeButterflySlots)
			},
			{
				binding: 4,
				resource: preCompTexture.createView()
			}
			]
		});
	return result;
}

function makeCompBindGroupShiftWater(inTexture, outTexture) {
	
	const result = 
		device.createBindGroup({
			label: "water Comp Shift bind group",
			layout: bindGroupShiftCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: uniformBufferComputeWaterPreMesh }
			},
			{
				binding: 1,
				resource: inTexture.createView()
			},
			{
				binding: 2,
				resource: outTexture.createView()
			}
			]
		});
	return result;
}


// The bind groups the water uses, kept (see cachedBindGroup): each with the things in it that can be replaced
const objectIds = new WeakMap();
let nextObjectId = 1;
const idOf = (object) => {
	if (!objectIds.has(object)) objectIds.set(object, nextObjectId++);
	return objectIds.get(object);
};
function createVFBindGroupswater() {
	return cachedBindGroup('vf', [skyViewLUTtexture, screenEffects.sceneColorTexture, screenEffects.sceneDepthTexture, clouds.cloudCoverageView], makeVFBindGroupswater);
}
function createCompBindGroupwater(vertexBuffer, indexBuffer, computeUniformBuffer) {
	return cachedBindGroup('mesh' + idOf(computeUniformBuffer), [vertexBuffer, indexBuffer, computeUniformBuffer, finalWaveHeightTexture, scene.heightMapView, finalDisplacementTexture, shoreDistanceTexture, terrain.terrainWaterTexture],
		() => makeCompBindGroupwater(vertexBuffer, indexBuffer, computeUniformBuffer));
}
function createCompBindGroupShoreScanWater() {
	return cachedBindGroup('shoreScan', [shoreScanTexture, scene.heightMapView], makeCompBindGroupShoreScanWater);
}
function createCompBindGroupShoreDistanceWater() {
	return cachedBindGroup('shoreDistance', [shoreScanTexture, shoreDistanceTexture], makeCompBindGroupShoreDistanceWater);
}
function createCompBindGroupSpectrumWater() {
	return cachedBindGroup('spectrum', [phillipsSpectrumTexture, h0k, uniformBufferComplexGaussian], makeCompBindGroupSpectrumWater);
}
function createCompBindGroupConjWater() {
	return cachedBindGroup('conj', [h0k, initialWaterHeightMap], makeCompBindGroupConjWater);
}
function createCompBindGroupRealizationWater() {
	return cachedBindGroup('realization', [initialWaterHeightMap, waveHeightRealization, displacementRealizationTexture], makeCompBindGroupRealizationWater);
}
function createCompBindGroupRtoAWater(inTexture) {
	return cachedBindGroup('rtoa' + idOf(inTexture), [inTexture, uniformBufferRtoA], () => makeCompBindGroupRtoAWater(inTexture));
}
function createCompBindGroupAtoTWater(inPingPong) {
	return cachedBindGroup('atot' + idOf(inPingPong), [inPingPong, finalIFFTOutput], () => makeCompBindGroupAtoTWater(inPingPong));
}
function createCompBindGroupButterflyPreCompWater() {
	return cachedBindGroup('precomp', [preCompTexture, uniformBufferBitReversedIndices], makeCompBindGroupButterflyPreCompWater);
}
function createCompBindGroupButterflyWater() {
	return cachedBindGroup('butterfly', [uniformBufferRtoA, uniformBufferPingPong, preCompTexture], makeCompBindGroupButterflyWater);
}
function createCompBindGroupShiftWater(inTexture, outTexture) {
	return cachedBindGroup('shift' + idOf(inTexture) + ':' + idOf(outTexture), [inTexture, outTexture], () => makeCompBindGroupShiftWater(inTexture, outTexture));
}

const waterVFPipelineLayout = device.createPipelineLayout({
  label: "water VF Pipeline Layout",
  bindGroupLayouts: [ bindGroupVFLayout ],
});

const waterCompPipelineLayout = device.createPipelineLayout({
  label: "water comp Pipeline Layout",
  bindGroupLayouts: [ bindGroupCLayout ],
});

const waterShoreScanCompPipelineLayout = device.createPipelineLayout({
  label: "water shore scan Pipeline Layout",
  bindGroupLayouts: [ bindGroupShoreScanCLayout ],
});

const waterShoreDistanceCompPipelineLayout = device.createPipelineLayout({
  label: "water shore distance Pipeline Layout",
  bindGroupLayouts: [ bindGroupShoreDistanceCLayout ],
});

const waterSpectrumCompPipelineLayout = device.createPipelineLayout({
  label: "water initial height map Pipeline Layout",
  bindGroupLayouts: [ bindGroupSpectrumCLayout ],
});

const waterConjCompPipelineLayout = device.createPipelineLayout({
  label: "water h0k Conj add Pipeline Layout",
  bindGroupLayouts: [ bindGroupConjCLayout ],
});

const waterRealizationCompPipelineLayout = device.createPipelineLayout({
  label: "water height Realization map Pipeline Layout",
  bindGroupLayouts: [ bindGroupRealizationCLayout ],
});

const waterButterflyCompPreCompPipelineLayout = device.createPipelineLayout({
  label: "water 2D IFFT Pre Comp Pipeline Layout",
  bindGroupLayouts: [ bindGroupButterflyPreCompCLayout ],
});

const waterRtoACompPipelineLayout = device.createPipelineLayout({
  label: "water RtoA Pipeline Layout",
  bindGroupLayouts: [ bindGroupRtoACLayout ],
});

const waterAtoTCompPipelineLayout = device.createPipelineLayout({
  label: "water AtoT Pipeline Layout",
  bindGroupLayouts: [ bindGroupAtoTCLayout ],
});

const waterButterflyCompPipelineLayout = device.createPipelineLayout({
  label: "water 2D IFFT Pipeline Layout",
  bindGroupLayouts: [ bindGroupButterflyCLayout ],
});

const waterShiftCompPipelineLayout = device.createPipelineLayout({
  label: "water Shift Pipeline Layout",
  bindGroupLayouts: [ bindGroupShiftCLayout ],
});


// Pipelines
//-------------------------------------------------
//WebGPU handles render and computer pipelines seperately, they cannot be combined as one
let waterPipeline;
let waterPipelineUpdateFlag = false;
let waterPipelineTopologyType = 'triangle-list';

export function waterPipelineSignalUpdate(inputTopology) {
	waterPipelineUpdateFlag = true;
	waterPipelineTopologyType = inputTopology;
}

function recreateWaterPipeline(inputTopology) {
  waterPipeline = device.createRenderPipeline({
  label: "water VF pipeline",
  layout: waterVFPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	vertex: {							// vertex stage details
		module: waterVertexShaderModule,	
		entryPoint: "vertexMain",		// our name of function, as you can have multiple vertex/fragment functions in one shader module
		buffers: [scene.vertexBufferLayout]	// GPUVertexBufferLayout that describe data packed into vertex buffers used
	},
	fragment: {							// fragment stage details
		module: waterFragShaderModule,		
		entryPoint: "fragmentMain",
		targets: [{						// array of dictionaries giving details (like the texture "format") of color attachments pipeline outputs to
		format: canvasFormat,			// we used textures from canvas context, and value saved from canvasFormat for format, so pass the same here
		blend: {						// the shallows are see-through: alpha blends the water over the terrain already drawn underneath it
			color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
			alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
		}
		}]
	},
	
	primitive: {
		topology: inputTopology,
	
		// Backface culling since the cube is solid piece of geometry.
		// Faces pointing away from the camera will be occluded by faces
		// pointing toward the camera.
		cullMode: 'none',
	},
	
	depthStencil: {
		depthWriteEnabled: true,
		depthCompare: 'less',
		format: 'depth24plus',
	},
});
}
recreateWaterPipeline(waterPipelineTopologyType);

// Compute Pipeline has to be seperate
const waterComputePipeline = device.createComputePipeline({
  label: "water C pipeline",
  layout: waterCompPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	compute: {
		module: waterComputeShaderModule,
		entryPoint: "computeMain",
	},
});

const waterShoreScanComputePipeline = device.createComputePipeline({
  label: "water Shore Scan C pipeline",
  layout: waterShoreScanCompPipelineLayout,
	compute: {
		module: waterShoreScanComputeShaderModule,
		entryPoint: "computeMain",
	},
});

const waterShoreDistanceComputePipeline = device.createComputePipeline({
  label: "water Shore Distance C pipeline",
  layout: waterShoreDistanceCompPipelineLayout,
	compute: {
		module: waterShoreDistanceComputeShaderModule,
		entryPoint: "computeMain",
	},
});

const waterSpectrumComputePipeline = device.createComputePipeline({
  label: "water Spectrum C pipeline",
  layout: waterSpectrumCompPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	compute: {
		module: waterSpectrumComputeShaderModule,
		entryPoint: "computeMain",
	},
});

const waterConjComputePipeline = device.createComputePipeline({
  label: "water Conj C pipeline",
  layout: waterConjCompPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	compute: {
		module: waterConjComputeShaderModule,
		entryPoint: "computeMain",
	},
});

const waterRealizationComputePipeline = device.createComputePipeline({
  label: "water Realization C pipeline",
  layout: waterRealizationCompPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	compute: {
		module: waterWaveHeightRealizationComputeShaderModule,
		entryPoint: "computeMain",
	},
});

const waterButterflyPreCompComputePipeline = device.createComputePipeline({
  label: "water Butterfly Pre Comp C pipeline",
  layout: waterButterflyCompPreCompPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	compute: {
		module: waterButterflyPassPreCompComputeShaderModule,
		entryPoint: "computeMain",
	},
});

const waterRtoAComputePipeline = device.createComputePipeline({
  label: "water RtoA C pipeline",
  layout: waterRtoACompPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	compute: {
		module: waterRealizationToArrayComputeShaderModule,
		entryPoint: "computeMain",
	},
});

const waterAtoTComputePipeline = device.createComputePipeline({
  label: "water AtoT C pipeline",
  layout: waterAtoTCompPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	compute: {
		module: waterAtoTComputeShaderModule,
		entryPoint: "computeMain",
	},
});

const waterButterflyComputePipeline = device.createComputePipeline({
  label: "water Butterfly C pipeline",
  layout: waterButterflyCompPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	compute: {
		module: waterButterflyPassComputeShaderModule,
		entryPoint: "computeMain",
	},
});

const waterShiftComputePipeline = device.createComputePipeline({
  label: "water Shift C pipeline",
  layout: waterShiftCompPipelineLayout,	//allows for use of same bind groups as the renderpipeline
	compute: {
		module: waterShiftPassComputeShaderModule,
		entryPoint: "computeMain",
	},
});


function redirectWindDirectionTemp() {
	settings.windDirection[0] = Math.cos(step * 0.75);
	//settings.windDirection[1] = Math.sin(step * 0.00053);
}

// The mesh of the tile under the camera, as the water's compute pass last left it, for the spray to look for crests in (particles.js):
//		8 numbers a vertex, the 4th of them the foam. Nothing while the tiles are being made again
export function waterCrestVertices() {
	if (resolutionRebuildPending || waterVertexBuffers.length == 0 || waterVertexBuffers.length != waterTileLayout.length) {
		return null;
	}
	const middle = Math.floor(waterVertexBuffers.length / 2);	// the tiles are in rows, so the middle one of the list is the middle one of the grid
	return { buffer: waterVertexBuffers[middle], count: waterTileLayout[middle].vertexCount };
}

let lastWaterTileResolution = settings.waterTileResolution;
let lastWaterTileInstanceCount = settings.waterTileInstanceCount;
let lastWaterOceanPlanePhysicalSize = settings.waterOceanPlanePhysicalSize;
let lastWaterGridSize = settings.waterGridSize;
let lastWaterWindSpeed = settings.waterWindSpeed;
let lastWaterWaveLength = settings.waterWaveLength;
let lastWindDirection = [settings.windDirection[0], settings.windDirection[1]];
let resolutionRebuildPending = false;

async function recreateResolutionDependentResources() {
	// wait for GPU to finish all submitted work before destroying anything
    await device.queue.onSubmittedWorkDone();
	
    // destroy old textures
    phillipsSpectrumTexture.destroy();
    h0k.destroy();
    h0Minusk.destroy();
    initialWaterHeightMap.destroy();
    hkt.destroy();
    waveHeightRealization.destroy();
	displacementRealizationTexture.destroy();
    preCompTexture.destroy();
    pingPongIFFTTexture.destroy();
    finalIFFTOutput.destroy();
    prePingPongIFFTTexture.destroy();
    preShiftFinalWaveHeightTexture.destroy();
    finalWaveHeightTexture.destroy();
    finalDisplacementTexture.destroy();

    // destroy old buffers
    uniformBufferRtoA.destroy();
    uniformBufferPingPong.destroy();
    uniformBufferBitReversedIndices.destroy();
    uniformBufferComplexGaussian.destroy();
	
	// destroy old tile buffers
    for (let i = 0; i < waterVertexBuffers.length; i++) {
        waterVertexBuffers[i].destroy();
        waterIndexBuffers[i].destroy();
    }
    waterVertexBuffers.length = 0;
    waterIndexBuffers.length = 0;
	
	for (let i = 0; i < waterComputeUniformBuffers.length; i++) {
		waterComputeUniformBuffers[i].destroy();
	}
	waterComputeUniformBuffers.length = 0;

    // recreate with new resolution
    const res = settings.waterTileResolution;
    const len2 = res * res * 2 * 4;
    const stages = Math.log2(res);
	
	totalTileCount = settings.waterTileInstanceCount * settings.waterTileInstanceCount;
	waterTileLayout = getTileLayout();

    phillipsSpectrumTexture = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    h0k                     = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    h0Minusk                = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    initialWaterHeightMap   = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    hkt                     = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    waveHeightRealization   = device.createTexture({ label: "wave Height Realization Texture", size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    displacementRealizationTexture = device.createTexture({ label: "water displacement realization Texture for choppy waves", size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    preCompTexture          = device.createTexture({ size: [stages, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    pingPongIFFTTexture     = device.createTexture({ label: "ping pong IFFT Texture", size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    finalIFFTOutput         = device.createTexture({ label: "final IFFT Texture", size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    prePingPongIFFTTexture  = device.createTexture({ label: "pre ping pong IFFT Texture", size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    preShiftFinalWaveHeightTexture = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    finalWaveHeightTexture  = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    finalDisplacementTexture = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });

    // recreate buffers
    const newComplexGauss = new Float32Array(complexGaussianRandomForH0(res * res));
    const newBitReversed  = new Float32Array(bitReversedIndicies(res));

    uniformBufferComplexGaussian = device.createBuffer({ label: "water Spectrum Compute Complex Gaussian Array Buffer", size: newComplexGauss.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniformBufferComplexGaussian, 0, newComplexGauss);

    uniformBufferBitReversedIndices = device.createBuffer({ label: "water butterfly bit reversed indices Array Buffer", size: newBitReversed.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(uniformBufferBitReversedIndices, 0, newBitReversed);

    uniformBufferRtoA    = device.createBuffer({ label: "water Realization to Array Buffer", size: len2, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    uniformBufferPingPong = device.createBuffer({ label: "water Ping Pong Array Buffer", size: len2, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });

	// recreate tile vertex/index buffers
    for (let i = 0; i < totalTileCount; i++) {
		waterComputeUniformBuffers.push(device.createBuffer({
			label: `water compute uniform tile ${i}`,
			size: uniformArrayComputewater,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		}));
        waterVertexBuffers.push(device.createBuffer({
            label: `water vertex buffer tile ${i}`,
            size: waterTileLayout[i].vertexCount * waterPlaneVertexStride * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }));
        waterIndexBuffers.push(device.createBuffer({
            label: `water index buffer tile ${i}`,
            size: waterTileLayout[i].indexCount * Uint32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }));
    }

    // reset step so h0k gets regenerated next frame
    step = 0;
	resolutionRebuildPending = false;
}

// Runs the 2D IFFT on a frequency domain texture and returns the buffer holding the result (still needs the array to texture and shift passes)
//		every IFFT shares the same two ping pong buffers, so a result has to be read out of them before the next IFFT starts
function waterIFFT(aEncoder, spectrumTexture, stages) {
	
	//convert RGBA32Float to F32ARRAY for speed and RW access
	const computeRtoAPass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('To Array', 'c_RealizationToArray') });
	computeRtoAPass.setPipeline(waterRtoAComputePipeline);
	computeRtoAPass.setBindGroup(0, createCompBindGroupRtoAWater(spectrumTexture));
	computeRtoAPass.dispatchWorkgroups(settings.waterTileResolution  / FFT_WORKGROUP_SIZE[0],
											settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
	computeRtoAPass.end();
	
	// ping pong a buffer between the shader thats capable of both horizontal or vertical passes. Each stage is one dispatch
	//		with its own settings (its slot, see writeButterflySlots); the GPU finishes one dispatch's writes before the next reads them
	const bindButterflyCGroup = createCompBindGroupButterflyWater();
	writeButterflySlots(stages);
	for (let direction = 0; direction < 2; direction++) {
		const computeIFFTPass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps(direction == 0 ? 'Butterfly Horizontal' : 'Butterfly Vertical', 'c_IFFT_2D') });
		computeIFFTPass.setPipeline(waterButterflyComputePipeline);
		for (let stage = 0; stage < stages; stage++) {
			computeIFFTPass.setBindGroup(0, bindButterflyCGroup, [butterflySlot(direction, stage)]);
			computeIFFTPass.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0],
												settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
		}
		computeIFFTPass.end();
	}
	
	// the result is in whichever buffer the last stage wrote: there are always an even number of them (horizontal and vertical), so the one it started in
	return uniformBufferRtoA;
}

export function waterPass(mainpassDepthTexture) {
	
	if (settings.waterTileResolution !== lastWaterTileResolution ||
		settings.waterTileInstanceCount !== lastWaterTileInstanceCount ||
		settings.waterGridSize !== lastWaterGridSize) {
		
        lastWaterTileResolution = settings.waterTileResolution;
		lastWaterTileInstanceCount = settings.waterTileInstanceCount;
		lastWaterGridSize = settings.waterGridSize;

        if (!resolutionRebuildPending) {
            resolutionRebuildPending = true;
            recreateResolutionDependentResources(); // fire async, don't await
        }
    }
	
	// force recalculate H0K due to phillips spectrum input change
	if (settings.waterOceanPlanePhysicalSize !== lastWaterOceanPlanePhysicalSize ||
		settings.waterWindSpeed !== lastWaterWindSpeed ||
		settings.windDirection[0] !== lastWindDirection[0] || settings.windDirection[1] !== lastWindDirection[1] ||	//the waves run with the wind
		settings.waterWaveLength !== lastWaterWaveLength) {

		lastWindDirection = [settings.windDirection[0], settings.windDirection[1]];
		
		lastWaterOceanPlanePhysicalSize = settings.waterOceanPlanePhysicalSize;
		lastWaterWindSpeed = settings.waterWindSpeed;
		lastWaterWaveLength = settings.waterWaveLength;
		step = 0;
	}
	
	// skip the entire pass while rebuild is in flight
    if (resolutionRebuildPending) return;
	
	currentFrameTime = performance.now();
	
	//redirectWindDirectionTemp();	//just for testing wave redirection from CPU side
	
	if(waterPipelineUpdateFlag) {
		recreateWaterPipeline(waterPipelineTopologyType)
		waterPipelineUpdateFlag = false;
	}
	
	// Start a compute pass place and animate the instances
	waterComputeBuffersUpdate(uniformBufferComputeWaterPreMesh);	// !!!!!! for cascades pre mesh UBO will have to be updated on size
	
	// everything the water does in a frame goes in this one encoder, and is sent off in one submit at the end (see waterIFFT)
	const aEncoder = device.createCommandEncoder();

	//initial Height Map h0(k)
	if(step == 0)
	{
		
		//h0k
		const computeInitialHeightPass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Spectrum h0(k)', 'c_h0k') });
		const bindSpectrumCGroup = createCompBindGroupSpectrumWater();
		computeInitialHeightPass.setPipeline(waterSpectrumComputePipeline);
		computeInitialHeightPass.setBindGroup(0, bindSpectrumCGroup);
		computeInitialHeightPass.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0],
													settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
		computeInitialHeightPass.end();
		
		//h0-k conj
		const computeConjPass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Spectrum Conjugate h0(-k)', 'c_h0kConj') });
		const bindConjCGroup = createCompBindGroupConjWater();
		computeConjPass.setPipeline(waterConjComputePipeline);
		computeConjPass.setBindGroup(0, bindConjCGroup);
		computeConjPass.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0],
										   settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
		computeConjPass.end();
		
	}
	
	const stages = Math.log2(settings.waterTileResolution);
	let IFFTBuffer;
	
	if(currentFrameTime - lastFrameTime > 1.0 / 30.0){
		
		
		step += 0.025;
		
		//hkt
		const computeHKTPass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Realization h(k,t)', 'c_hkt') });
		const bindRealizationCGroup = createCompBindGroupRealizationWater();
		computeHKTPass.setPipeline(waterRealizationComputePipeline);
		computeHKTPass.setBindGroup(0, bindRealizationCGroup);
		computeHKTPass.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0],
										settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
		computeHKTPass.end();
		
		//copy just to debug view it
		aEncoder.copyTextureToTexture(
			{texture: waveHeightRealization},
			{texture: hkt},	
			{width: settings.waterTileResolution, height: settings.waterTileResolution}
		)
		
		//-----------------------------IFFT-------------------------------
		//FFT start, the buttefly group starts with waveHeightRealization ONLY ONCE
		
		
		//pre compute twiddle values
		let bindButterflyPreCompCGroup = createCompBindGroupButterflyPreCompWater();
		const computePreCompPass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Twiddle Precompute', 'c_PreComp') });
		computePreCompPass.setPipeline(waterButterflyPreCompComputePipeline);
		computePreCompPass.setBindGroup(0, bindButterflyPreCompCGroup);
		computePreCompPass.dispatchWorkgroups(stages / PRECOMP_WORKGROUP_SIZE[0],
												settings.waterTileResolution / PRECOMP_WORKGROUP_SIZE[1]);
		computePreCompPass.end();
		
		
		
		//horizontal displacement goes through the IFFT first, all the way out to its final texture
		//		it shares the ping pong buffers and finalIFFTOutput with the wave height, which gets loaded into them straight after
		//		(filed under its own name in the Performance window, as is the wave height's below)
		const displacementIFFTBuffer = profiler.section('Displacement IFFT', () => waterIFFT(aEncoder, displacementRealizationTexture, stages));


		const computeDisplacementAtoTPass = aEncoder.beginComputePass({ timestampWrites: profiler.section('Displacement IFFT', () => profiler.timestamps('To Texture', 'c_ArrayToTexture')) });
		computeDisplacementAtoTPass.setPipeline(waterAtoTComputePipeline);
		computeDisplacementAtoTPass.setBindGroup(0, createCompBindGroupAtoTWater(displacementIFFTBuffer));
		computeDisplacementAtoTPass.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0],
														settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
		computeDisplacementAtoTPass.end();
		
		const computeDisplacementShiftPass = aEncoder.beginComputePass({ timestampWrites: profiler.section('Displacement IFFT', () => profiler.timestamps('Shift', 'c_Shift')) });
		computeDisplacementShiftPass.setPipeline(waterShiftComputePipeline);
		computeDisplacementShiftPass.setBindGroup(0, createCompBindGroupShiftWater(finalIFFTOutput, finalDisplacementTexture));
		computeDisplacementShiftPass.dispatchWorkgroups(Math.ceil(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0]),
														Math.ceil(settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]));
		computeDisplacementShiftPass.end();
		
		
		//wave height, read out of the buffers by the array to texture and shift passes below
		IFFTBuffer = profiler.section('Height IFFT', () => waterIFFT(aEncoder, waveHeightRealization, stages));
	}
	
	
	//convert F32ARRAY to RGBA32Float for speed and RW access
	let bindAtoTCGroup = createCompBindGroupAtoTWater(IFFTBuffer);
	const computeAtoTPass = aEncoder.beginComputePass({ timestampWrites: profiler.section('Height IFFT', () => profiler.timestamps('To Texture', 'c_ArrayToTexture')) });
	computeAtoTPass.setPipeline(waterAtoTComputePipeline);
	computeAtoTPass.setBindGroup(0, bindAtoTCGroup);
	computeAtoTPass.dispatchWorkgroups(settings.waterTileResolution  / FFT_WORKGROUP_SIZE[0],
											settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
	computeAtoTPass.end();
	
	aEncoder.copyTextureToTexture(
		{texture: finalIFFTOutput},
		{texture: preShiftFinalWaveHeightTexture},
		{width: settings.waterTileResolution, height: settings.waterTileResolution});
	
	
	//Shift and Copy
	let bindShiftCGroup = createCompBindGroupShiftWater(finalIFFTOutput, finalWaveHeightTexture);
	const computeShiftPass = aEncoder.beginComputePass({ timestampWrites: profiler.section('Height IFFT', () => profiler.timestamps('Shift', 'c_Shift')) });
	computeShiftPass.setPipeline(waterShiftComputePipeline);
	computeShiftPass.setBindGroup(0, bindShiftCGroup);
	computeShiftPass.dispatchWorkgroups(Math.ceil(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0]), 
													Math.ceil(settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]));
	computeShiftPass.end();
	
	lastFrameTime = currentFrameTime;
	
	
	//---------------------------SHORE DISTANCE-------------------------
	// distance from the water around the camera to the nearest land, worked out from the top down height map
	//		two small passes: nearest land up/down each column, then combined sideways. The mesh assembly aims the shore waves with the result
	//		(the spaces buffer these read is the one waterMeshUniformBufferUpdates fills in below, written before this encoder is submitted)
	const shoreDispatch = Math.ceil(shoreFieldResolution / FFT_WORKGROUP_SIZE[0]);

	const computeShoreScanPass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Shore Scan', 'c_ShoreScan') });
	computeShoreScanPass.setPipeline(waterShoreScanComputePipeline);
	computeShoreScanPass.setBindGroup(0, createCompBindGroupShoreScanWater());
	computeShoreScanPass.dispatchWorkgroups(shoreDispatch, shoreDispatch);
	computeShoreScanPass.end();

	const computeShoreDistancePass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Shore Distance', 'c_ShoreDistance') });
	computeShoreDistancePass.setPipeline(waterShoreDistanceComputePipeline);
	computeShoreDistancePass.setBindGroup(0, createCompBindGroupShoreDistanceWater());
	computeShoreDistancePass.dispatchWorkgroups(shoreDispatch, shoreDispatch);
	computeShoreDistancePass.end();


	//---------------------------MESH ASSEMBLY-------------------------
	const tileOffsets = getTileOffsets(settings.camPosX, settings.camPosZ);
	
	// Compute pass — builds mesh for each tile
	const computePass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Mesh Build', 'c_water') });
	computePass.setPipeline(waterComputePipeline);
	
	waterMeshUniformBufferUpdates(1, tileOffsets[0]);	// spaces update, the same for every tile so once is enough

	for (let i = 0; i < tileOffsets.length; i++) {
		
		// Write each tile's offset into its own buffer — safe because each is independent
		waterComputeBuffersUpdate(waterComputeUniformBuffers[i], tileOffsets[i][0], tileOffsets[i][2], waterTileLayout[i]);
		
		const bindCGroup = createCompBindGroupwater(
			waterVertexBuffers[i],
			waterIndexBuffers[i],
			waterComputeUniformBuffers[i]   // tile-specific buffer
		);
		computePass.setBindGroup(0, bindCGroup);
		computePass.dispatchWorkgroups(
			Math.ceil(waterTileLayout[i].vertexCount / WATER_WORKGROUP_SIZE[0])
		);
	}
	
	computePass.end();
	
	// Render pass — draws each tile
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
		timestampWrites: profiler.timestamps('Surface', 'v_water + f_water'),
	});
	pass.setPipeline(waterPipeline);
	pass.setBindGroup(0, createVFBindGroupswater());	// the same for every tile and the horizon plane

	for (let i = 0; i < tileOffsets.length; i++) {
		//waterMeshUniformBufferUpdates(1, tileOffsets[i]);	// spaces update
		//waterComputeBuffersUpdate(tileOffsets[i][0], tileOffsets[i][2]);	// tile index update

		pass.setVertexBuffer(0, waterVertexBuffers[i]);
		pass.setIndexBuffer(waterIndexBuffers[i], 'uint32');
		pass.drawIndexed(waterTileLayout[i].indexCount, 1, 0, 0, 0);
	}

	// horizon plane, carries the sea on from the outside edge of the tiles
	const [tileOriginX, tileOriginZ] = getSnappedTileOrigin(settings.camPosX, settings.camPosZ, settings.waterGridSize);
	waterHorizonPlaneUpdate(tileOriginX, tileOriginZ);
	pass.setVertexBuffer(0, waterHorizonVertexBuffer);
	pass.setIndexBuffer(waterHorizonIndexBuffer, 'uint32');
	pass.drawIndexed(waterHorizonIndices.length, 1, 0, 0, 0);
	
	pass.end();
	
	const commandBuffer = aEncoder.finish();
	device.queue.submit([commandBuffer]);
}