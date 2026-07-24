import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'

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
import { v_water } from '../shaders/js/vfc_water.js'
import { f_water } from '../shaders/js/vfc_water.js'
import { WATER_WORKGROUP_SIZE } from '../shaders/js/vfc_water.js'
import { FFT_WORKGROUP_SIZE } from '../shaders/js/vfc_water.js'
import { PRECOMP_WORKGROUP_SIZE } from '../shaders/js/vfc_water.js'

import * as transformations from './transformations.js'
import * as scene from './scene.js'
import * as primitives from '../models/primitives.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

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
let waterPlaneNumberOfVerts = settings.waterTileResolution * settings.waterTileResolution;
let waterPlaneVertexStride = (3 + 2 + 3);
let waterEntityModelsStride = waterPlaneNumberOfVerts * waterPlaneVertexStride;	//number of floats
let totalTileCount = settings.waterTileInstanceCount * settings.waterTileInstanceCount;
let totalPlaneTriangles = ((settings.waterTileResolution - 1) * (settings.waterTileResolution - 1));	//grid cells / tris per cell (2)

//model list specific
const uboOffset = 256;	//this is a defaulted max for UBO, nothing I wrote equals up to 256, its a limiter
const totalwaterUniformArraySize = 256; //(4 * 4 * 4) 4x4 matrix for MVP, forget the rest for in shader
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

const uniformArrayComputeButterfly = 256;	//default for now
const uniformBufferComputeButterfly = device.createBuffer({
  label: "water Compute Butterfly settings Uniform Buffer",
  size: uniformArrayComputeButterfly,
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
        size: waterEntityModelsStride * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));
    waterIndexBuffers.push(device.createBuffer({
        label: `water index buffer tile ${i}`,
        size: totalPlaneTriangles * 6 * Float32Array.BYTES_PER_ELEMENT,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }));
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

export let slopeRealizationTexture = device.createTexture({
  label: "water slope realization Texture for normals",
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

//linear sampling
const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

// tile snapping. Infinite ocean needs tiles to spawn and lock according to camera position
function getSnappedTileOrigin(camX, camZ, tileSize) {
    return [
        Math.floor(camX / tileSize) * tileSize,
        Math.floor(camZ / tileSize) * tileSize
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

function getwaterComputeInfo(tileOffsetX = 0, tileOffsetZ = 0) {
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
	
	// square grid
	waterCompBuffer.push(settings.waterGridSize);
	waterCompBuffer.push(settings.waterGridSize);
	
		
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
		
		//padding
		bufferResult.push(0);
		bufferResult.push(0);
		
		const result = new Float32Array(bufferResult);
		
		device.queue.writeBuffer(waterUniformBuffer, 
								0,
								result.buffer,
								result.byteOffset,
								result.byteLength);
}

function waterComputeBuffersUpdate(targetWaterComputeBuffer, tileX = 0, tileZ = 0) {	
	const gcInfo = getwaterComputeInfo(tileX, tileZ);

	device.queue.writeBuffer(targetWaterComputeBuffer, 
									0,	//apparently uniform buffer size defaults to a need of 256 
									gcInfo.buffer,
									gcInfo.byteOffset,
									gcInfo.byteLength);
}

function waterComputeButterflyBufferUpdate(direction, stage, pingpong) {
	
	const bufferResult = [];
	
	bufferResult.push(direction);
	bufferResult.push(stage);
	bufferResult.push(pingpong);

	
	//NECESSARY TO KEEP MIN ALIGNMENT
	bufferResult.push(1.0); //padding0
	
	const result = new Float32Array(bufferResult);
	
	device.queue.writeBuffer(uniformBufferComputeButterfly, 
									0,	//apparently uniform buffer size defaults to a need of 256 
									result.buffer,
									result.byteOffset,
									result.byteLength);
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
    binding: 6,								//inTexture for slope realization
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",
		access: "read-only",
		dimension: "2d",
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
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
    binding: 3,								//outTexture for water slope realization
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
    visibility: GPUShaderStage.COMPUTE,	//settings
    buffer: {} 
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
function createVFBindGroupswater() {
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
			}
			]
		});
}

function createCompBindGroupwater(vertexBuffer, indexBuffer, computeUniformBuffer) {
	
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
				resource: slopeRealizationTexture.createView()
			}
			]
		});
	return result;
}

function createCompBindGroupSpectrumWater() {
	
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

function createCompBindGroupConjWater() {
	
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

function createCompBindGroupRealizationWater() {
	
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
				resource: slopeRealizationTexture.createView()
			}
			]
		});
	return result;
}

function createCompBindGroupRtoAWater() {
	
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
				resource: waveHeightRealization.createView()
			},
			{
				binding: 2,
				resource: { buffer: uniformBufferRtoA }
			}
			]
		});
	return result;
}

function createCompBindGroupAtoTWater(inPingPong) {
	
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

function createCompBindGroupButterflyPreCompWater() {
	
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
				resource: { buffer: uniformBufferComputeButterfly }
			},
			{
				binding: 3,
				resource: { buffer: uniformBufferBitReversedIndices }
			}
			]
		});
	return result;
}

function createCompBindGroupButterflyWater(/*inTexture, outTexture*/) {
	
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
				resource: { buffer: uniformBufferComputeButterfly }
			},
			{
				binding: 4,
				resource: preCompTexture.createView()
			}
			]
		});
	return result;
}

function createCompBindGroupShiftWater(inTexture, outTexture) {
	
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

const waterVFPipelineLayout = device.createPipelineLayout({
  label: "water VF Pipeline Layout",
  bindGroupLayouts: [ bindGroupVFLayout ],
});

const waterCompPipelineLayout = device.createPipelineLayout({
  label: "water comp Pipeline Layout",
  bindGroupLayouts: [ bindGroupCLayout ],
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
		format: canvasFormat			// we used textures from canvas context, and value saved from canvasFormat for format, so pass the same here
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

let lastWaterTileResolution = settings.waterTileResolution;
let lastWaterTileInstanceCount = settings.waterTileInstanceCount;
let lastWaterOceanPlanePhysicalSize = settings.waterOceanPlanePhysicalSize;
let lastWaterGridSize = settings.waterGridSize;
let lastWaterWindSpeed = settings.waterWindSpeed;
let lastWaterWaveLength = settings.waterWaveLength;
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
	slopeRealizationTexture.destroy();
    preCompTexture.destroy();
    pingPongIFFTTexture.destroy();
    finalIFFTOutput.destroy();
    prePingPongIFFTTexture.destroy();
    preShiftFinalWaveHeightTexture.destroy();
    finalWaveHeightTexture.destroy();

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
	
	waterPlaneNumberOfVerts = res * res;
    waterEntityModelsStride = waterPlaneNumberOfVerts * waterPlaneVertexStride;
    totalPlaneTriangles     = (res - 1) * (res - 1);
	totalTileCount = settings.waterTileInstanceCount * settings.waterTileInstanceCount;

    phillipsSpectrumTexture = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    h0k                     = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    h0Minusk                = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    initialWaterHeightMap   = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    hkt                     = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    waveHeightRealization   = device.createTexture({ label: "wave Height Realization Texture", size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    slopeRealizationTexture   = device.createTexture({ label: "water slope realization texture for normals", size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    preCompTexture          = device.createTexture({ size: [stages, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    pingPongIFFTTexture     = device.createTexture({ label: "ping pong IFFT Texture", size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    finalIFFTOutput         = device.createTexture({ label: "final IFFT Texture", size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    prePingPongIFFTTexture  = device.createTexture({ label: "pre ping pong IFFT Texture", size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    preShiftFinalWaveHeightTexture = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });
    finalWaveHeightTexture  = device.createTexture({ size: [res, res], format: 'rgba32float', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING });

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
            size: waterEntityModelsStride * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }));
        waterIndexBuffers.push(device.createBuffer({
            label: `water index buffer tile ${i}`,
            size: totalPlaneTriangles * 6 * Float32Array.BYTES_PER_ELEMENT,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        }));
    }

    // reset step so h0k gets regenerated next frame
    step = 0;
	resolutionRebuildPending = false;
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
		settings.waterWaveLength !== lastWaterWaveLength) {
		
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
	
	//initial Height Map h0(k)
	if(step == 0)
	{
		const encoderHk = device.createCommandEncoder();
		
		//h0k
		const computeInitialHeightPass = encoderHk.beginComputePass();
		const bindSpectrumCGroup = createCompBindGroupSpectrumWater();
		computeInitialHeightPass.setPipeline(waterSpectrumComputePipeline);
		computeInitialHeightPass.setBindGroup(0, bindSpectrumCGroup);
		computeInitialHeightPass.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0],
													settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
		computeInitialHeightPass.end();
		
		//h0-k conj
		const computeConjPass = encoderHk.beginComputePass();
		const bindConjCGroup = createCompBindGroupConjWater();
		computeConjPass.setPipeline(waterConjComputePipeline);
		computeConjPass.setBindGroup(0, bindConjCGroup);
		computeConjPass.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0],
										   settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
		computeConjPass.end();
		
		device.queue.submit([encoderHk.finish()]);
	}
	
	const stages = Math.log2(settings.waterTileResolution);
	let IFFTBuffer;
	
	if(currentFrameTime - lastFrameTime > 1.0 / 30.0){
		
		const encoderPrePass = device.createCommandEncoder();
		
		step += 0.025;
		
		//hkt
		const computeHKTPass = encoderPrePass.beginComputePass();
		const bindRealizationCGroup = createCompBindGroupRealizationWater();
		computeHKTPass.setPipeline(waterRealizationComputePipeline);
		computeHKTPass.setBindGroup(0, bindRealizationCGroup);
		computeHKTPass.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0],
										settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
		computeHKTPass.end();
		
		//copy just to debug view it
		encoderPrePass.copyTextureToTexture(
			{texture: waveHeightRealization},
			{texture: hkt},	
			{width: settings.waterTileResolution, height: settings.waterTileResolution}
		)
		
		//-----------------------------IFFT-------------------------------
		//FFT start, the buttefly group starts with waveHeightRealization ONLY ONCE
		
		
		//pre compute twiddle values
		let bindButterflyPreCompCGroup = createCompBindGroupButterflyPreCompWater();
		const computePreCompPass = encoderPrePass.beginComputePass();
		computePreCompPass.setPipeline(waterButterflyPreCompComputePipeline);
		computePreCompPass.setBindGroup(0, bindButterflyPreCompCGroup);
		computePreCompPass.dispatchWorkgroups(stages / PRECOMP_WORKGROUP_SIZE[0],
												settings.waterTileResolution / PRECOMP_WORKGROUP_SIZE[1]);
		computePreCompPass.end();
		
		
		//convert RGBA32Float to F32ARRAY for speed and RW access
		let bindRtoACGroup = createCompBindGroupRtoAWater();
		const computeRtoAPass = encoderPrePass.beginComputePass();
		computeRtoAPass.setPipeline(waterRtoAComputePipeline);
		computeRtoAPass.setBindGroup(0, bindRtoACGroup);
		computeRtoAPass.dispatchWorkgroups(settings.waterTileResolution  / FFT_WORKGROUP_SIZE[0],
												settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
		computeRtoAPass.end();
		//console.log("Wave Height Realization F32 array: ", uniformBufferRtoA);
		
		// ping pong a texture between the shader thats capable of both horizontal or vertical passes
		
		device.queue.submit([encoderPrePass.finish()]);
		
		let pingPong = false;
		let pingPongSwitch = 0.0;
		
		//horizontal FFT
		for(let stageH = 0; stageH < stages; stageH++) {
			
			pingPongSwitch = pingPong ? 1.0 : 0.0;

			waterComputeButterflyBufferUpdate(0.0, stageH, pingPongSwitch);	//set the direction, and stage count
			
			let encoder = device.createCommandEncoder();  // NEW encoder per stage
			const computeIFFTPassH = encoder.beginComputePass();	
			let bindButterflyCGroup = createCompBindGroupButterflyWater(/*uniformBufferRtoA, uniformBufferPingPong*/);	
			computeIFFTPassH.setPipeline(waterButterflyComputePipeline);
			computeIFFTPassH.setBindGroup(0, bindButterflyCGroup);
			
			computeIFFTPassH.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0], 
													settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
		
			computeIFFTPassH.end();
			
			const commandBuffer = encoder.finish();
			device.queue.submit([commandBuffer]);  // Submit this stage
		
			// Optional: await GPU idle to ensure write-read order
			//await device.queue.onSubmittedWorkDone();
			
			pingPong = !pingPong;
		}
		
		for(let stageV = 0; stageV < stages; stageV++) {
			pingPongSwitch = pingPong ? 1.0 : 0.0;
			
			waterComputeButterflyBufferUpdate(1.0, stageV, pingPongSwitch);	//set the direction, and stage count
			
			let encoder = device.createCommandEncoder();  // NEW encoder per stage
			const computeIFFTPassV = encoder.beginComputePass();
			let bindButterflyCGroup = createCompBindGroupButterflyWater(/*uniformBufferRtoA, uniformBufferPingPong*/);	
			computeIFFTPassV.setPipeline(waterButterflyComputePipeline);
			computeIFFTPassV.setBindGroup(0, bindButterflyCGroup);
			
			computeIFFTPassV.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0], 
											settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
		
			computeIFFTPassV.end();
			
			const commandBuffer = encoder.finish();
			device.queue.submit([commandBuffer]);  // Submit this stage
		
			// Optional: await GPU idle to ensure write-read order
			//await device.queue.onSubmittedWorkDone();
			
			pingPong = !pingPong;
		}
		
		//check correct final
		IFFTBuffer = pingPong ? uniformBufferPingPong : uniformBufferRtoA;
	}
	
	let aEncoder = device.createCommandEncoder();
	
	//convert F32ARRAY to RGBA32Float for speed and RW access
	let bindAtoTCGroup = createCompBindGroupAtoTWater(IFFTBuffer);
	const computeAtoTPass = aEncoder.beginComputePass();
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
	const computeShiftPass = aEncoder.beginComputePass();
	computeShiftPass.setPipeline(waterShiftComputePipeline);
	computeShiftPass.setBindGroup(0, bindShiftCGroup);
	computeShiftPass.dispatchWorkgroups(Math.ceil(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0]), 
													Math.ceil(settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]));
	computeShiftPass.end();
	
	lastFrameTime = currentFrameTime;
	
	
	//---------------------------MESH ASSEMBLY-------------------------
	const tileOffsets = getTileOffsets(settings.camPosX, settings.camPosZ);
	
	// Compute pass — builds mesh for each tile
	const computePass = aEncoder.beginComputePass();
	computePass.setPipeline(waterComputePipeline);
	
	for (let i = 0; i < tileOffsets.length; i++) {
		
		waterMeshUniformBufferUpdates(1, tileOffsets[i]);	// spaces update
		
		// Write each tile's offset into its own buffer — safe because each is independent
		waterComputeBuffersUpdate(waterComputeUniformBuffers[i], tileOffsets[i][0], tileOffsets[i][2]);
		
		const bindCGroup = createCompBindGroupwater(
			waterVertexBuffers[i],
			waterIndexBuffers[i],
			waterComputeUniformBuffers[i]   // tile-specific buffer
		);
		computePass.setBindGroup(0, bindCGroup);
		computePass.dispatchWorkgroups(
			Math.ceil((settings.waterTileResolution * settings.waterTileResolution) / WATER_WORKGROUP_SIZE[0])
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
	});
	pass.setPipeline(waterPipeline);
	
	for (let i = 0; i < tileOffsets.length; i++) {
		//waterMeshUniformBufferUpdates(1, tileOffsets[i]);	// spaces update
		//waterComputeBuffersUpdate(tileOffsets[i][0], tileOffsets[i][2]);	// tile index update
		
		pass.setBindGroup(0, createVFBindGroupswater());
		pass.setVertexBuffer(0, waterVertexBuffers[i]);
		pass.setIndexBuffer(waterIndexBuffers[i], 'uint32');
		pass.drawIndexed(totalPlaneTriangles * 6, 1, 0, 0, 0);
	}
	
	pass.end();
	
	const commandBuffer = aEncoder.finish();
	device.queue.submit([commandBuffer]);
}