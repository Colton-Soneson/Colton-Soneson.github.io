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
import { c_Shift } from '../shaders/js/vfc_water.js'
import { v_water } from '../shaders/js/vfc_water.js'
import { f_water } from '../shaders/js/vfc_water.js'
import { WATER_WORKGROUP_SIZE } from '../shaders/js/vfc_water.js'
import { FFT_WORKGROUP_SIZE } from '../shaders/js/vfc_water.js'
import { PRECOMP_WORKGROUP_SIZE } from '../shaders/js/vfc_water.js'

import * as transformations from './transformations.js'
import * as scene from './scene.js'
import * as primitives from '../models/primitives.js'


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

const complexGaussArray = new Float32Array(complexGaussianRandom(0.0, 1.0, settings.waterTileResolution * settings.waterTileResolution));	//4: kr, ki, -kr, -ki
console.log("gauss array length: ", complexGaussArray.byteLength / 4);

//const complexGaussArray = generateHermitianSymmetricComplexGaussian(settings.waterTileResolution);
//console.log("Complex Gaussian Num Array: ", complexGaussArray);

const centerWaterPlanePosition = [-(settings.waterTileResolution * 0.5), 0.0, -(settings.waterTileResolution * 0.5)];

//if settings change live, this will have to be changed out from constants													!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
const waterPlaneNumberOfVerts = settings.waterTileResolution * settings.waterTileResolution;
const waterPlaneVertexStride = (3 + 2 + 3);
const waterEntityModelsStride = waterPlaneNumberOfVerts * waterPlaneVertexStride;	//number of floats

//model list specific
const uboOffset = 256;	//this is a defaulted max for UBO, nothing I wrote equals up to 256, its a limiter
const totalwaterUniformArraySize = 64; //(4 * 4 * 4) 4x4 matrix for MVP, forget the rest for in shader
const waterUniformBuffer = device.createBuffer({
  label: "water space Uniform",
  size: totalwaterUniformArraySize,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

//compute water anim data
const uniformArrayComputewater= 128;	//default for now
const uniformBufferComputewater = device.createBuffer({
  label: "water Compute settings Uniform Buffer",
  size: uniformArrayComputewater,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

const uniformArrayComputeButterfly = 128;	//default for now
const uniformBufferComputeButterfly = device.createBuffer({
  label: "water Compute Butterfly settings Uniform Buffer",
  size: uniformArrayComputeButterfly,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});

const uniformBufferComplexGaussian = device.createBuffer({
  label: "water Spectrum Compute Complex Gaussian Array Buffer",
  size: complexGaussArray.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,	//this makes it another GPUBuffer Object but this time uniform
});
device.queue.writeBuffer(uniformBufferComplexGaussian, /*bufferOffset=*/0, complexGaussArray); //copy vertex data to buffer


let totalwaterVertexBuffer;
export function waterUpdateStorageVertexBuffer() {
	const totalwaterVertexArray = waterEntityModelsStride * Float32Array.BYTES_PER_ELEMENT;		// i dont think this is correct
	const GVB = device.createBuffer({
		label: "total water vertices",		//just helps to identify object, can be anything you type
		size: totalwaterVertexArray,
		usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,	//its use is for vertex data, and that you want to copy data into it, ALSO for use as storage buffer in compute
	});
	
	totalwaterVertexBuffer = GVB;
}
waterUpdateStorageVertexBuffer(); // run the function

let totalwaterIndexBuffer;
const totalPlaneTriangles = ((settings.waterTileResolution - 1) * (settings.waterTileResolution - 1));	//grid cells / tris per cell (2)
export function waterUpdateStorageIndexBuffer() {
	const totalwaterIndexArray = totalPlaneTriangles * (3 + 2 + 3) * Float32Array.BYTES_PER_ELEMENT;
	const GIB = device.createBuffer({
		label: "total water indices",	
		size: totalwaterIndexArray,
		usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,	//its use is for vertex data, and that you want to copy data into it, ALSO for use as storage buffer in compute
	});
	
	totalwaterIndexBuffer = GIB;
}
waterUpdateStorageIndexBuffer(); // run the function



//Phillips Spectrum
export const phillipsSpectrumTexture = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

//h0k without conj
export const h0k = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

export const h0Minusk = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

//inital Water Height map h0(k) and h0(-k)
export const initialWaterHeightMap = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

export const hkt = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

export let waveHeightRealization = device.createTexture({
  label: "wave Height Realization Texture",
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

export const preCompTexture = device.createTexture({
  size: [Math.log2(settings.waterTileResolution), settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

//wont be available for debug view as its an inbetween
export let pingPongIFFTTexture = device.createTexture({
  label: "ping pong IFFT Texture",
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

export let preShiftFinalWaveHeightTexture = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});


export const finalWaveHeightTexture = device.createTexture({
  size: [settings.waterTileResolution, settings.waterTileResolution],
  format: 'rgba32float',
  usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING,
});

//linear sampling
const linSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
});

function getwaterComputeInfo() {
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

		
	return new Float32Array(waterCompBuffer);
}

function waterVFUniformBufferUpdates(numInstances, pos) {
	
		const bufferResult = [];
		const adjustedPos = [centerWaterPlanePosition[0] + pos[0], 
							centerWaterPlanePosition[1] + pos[1], 
							centerWaterPlanePosition[2] + pos[2]];
		
		//for now this will be model mat, but its should just be default everything to save time (but scale might be good to avoid model crap)
		const modelMatrix = transformations.getModelMatrix(new Float32Array(adjustedPos), 
															new Float32Array([0.0,0.0,0.0]),
															new Float32Array([1.0,1.0,1.0]));
		const modelViewMat = mat4.mul(transformations.getViewMatrix(), modelMatrix);
		const modelViewProjectionMatrix = mat4.mul(transformations.projectionMatrix, modelViewMat);
		
		for(let i = 0; i < 16; i++) {
			bufferResult.push(modelViewProjectionMatrix[i]);
		}
		
		const result = new Float32Array(bufferResult);
		
		device.queue.writeBuffer(waterUniformBuffer, 
								0,
								result.buffer,
								result.byteOffset,
								result.byteLength);
}

function waterComputeBuffersUpdate() {
	
	const bufferResult = [];
	
	//for now this will be model mat, but its should just be default everything to save time (but scale might be good to avoid model crap)
	const modelMatrix = transformations.getModelMatrix(new Float32Array(centerWaterPlanePosition), 
														new Float32Array([0.0,0.0,0.0]), 
														new Float32Array([1.0,1.0,1.0]));
	const modelViewMat = mat4.mul(transformations.getViewMatrix(), modelMatrix);
	const modelViewProjectionMatrix = mat4.mul(transformations.projectionMatrix, modelViewMat);
	
	for(let i = 0; i < 16; i++) {
		bufferResult.push(modelViewProjectionMatrix[i]);
	}
	
	const result = new Float32Array(bufferResult);
	
	device.queue.writeBuffer(waterUniformBuffer, 
							0,
							result.buffer,
							result.byteOffset,
							result.byteLength);
	
	const gcInfo = getwaterComputeInfo();

	device.queue.writeBuffer(uniformBufferComputewater, 
									0,	//apparently uniform buffer size defaults to a need of 256 
									gcInfo.buffer,
									gcInfo.byteOffset,
									gcInfo.byteLength);
}

function waterComputeButterflyBufferUpdate(direction, stage) {
	
	const bufferResult = [];
	
	bufferResult.push(direction);
	bufferResult.push(stage);
	
	//NECESSARY TO KEEP MIN ALIGNMENT
	bufferResult.push(1.0);	//padding0
	bufferResult.push(1.0); //padding1
	
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
  label: "water Bind Group Realization C Layout",
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
  }
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
			}
			]
		});
}

function createCompBindGroupwater() {
	
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
				resource: { buffer: uniformBufferComputewater }
			},
			{
				binding: 2,
				resource: { buffer: totalwaterVertexBuffer }
			},
			{
				binding: 3,
				resource: { buffer: totalwaterIndexBuffer }
			},
			{
				binding: 4,
				resource: finalWaveHeightTexture.createView()
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
				resource: { buffer: uniformBufferComputewater }
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
				resource: { buffer: uniformBufferComputewater }
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
				resource: { buffer: uniformBufferComputewater }
			},
			{
				binding: 1,
				resource: initialWaterHeightMap.createView()
			},
			{
				binding: 2,
				resource: waveHeightRealization.createView()
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
				resource: { buffer: uniformBufferComputewater }
			},
			{
				binding: 1,
				resource: preCompTexture.createView()
			},
			{
				binding: 2,
				resource: { buffer: uniformBufferComputeButterfly }
			}
			]
		});
	return result;
}

function createCompBindGroupButterflyWater(inTexture, outTexture) {
	
	const result = 
		device.createBindGroup({
			label: "water Comp Butterfly bind group",
			layout: bindGroupButterflyCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: uniformBufferComputewater }
			},
			{
				binding: 1,
				resource: inTexture.createView()
			},
			{
				binding: 2,
				resource: outTexture.createView()
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
				resource: { buffer: uniformBufferComputewater }
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

export function waterPass(aEncoder, mainpassDepthTexture) {
	
	step++;
	
	//redirectWindDirectionTemp();	//just for testing wave redirection from CPU side
	
	if(waterPipelineUpdateFlag) {
		recreateWaterPipeline(waterPipelineTopologyType)
		waterPipelineUpdateFlag = false;
	}
	
	// Start a compute pass place and animate the instances
	const bindCGroup = createCompBindGroupwater();
	const bindSpectrumCGroup = createCompBindGroupSpectrumWater();
	const bindConjCGroup = createCompBindGroupConjWater();
	const bindRealizationCGroup = createCompBindGroupRealizationWater();
	waterComputeBuffersUpdate();
	
	//initial Height Map h0(k)
	if(step == 1)
	{
		//h0k
		const computeInitialHeightPass = aEncoder.beginComputePass();
		computeInitialHeightPass.setPipeline(waterSpectrumComputePipeline);
		computeInitialHeightPass.setBindGroup(0, bindSpectrumCGroup);
		computeInitialHeightPass.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0],
													settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
		computeInitialHeightPass.end();
		
		//h0-k conj
		const computeConjPass = aEncoder.beginComputePass();
		computeConjPass.setPipeline(waterConjComputePipeline);
		computeConjPass.setBindGroup(0, bindConjCGroup);
		computeConjPass.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0],
										   settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
		computeConjPass.end();
	}
	
	//hkt
	const computeHKTPass = aEncoder.beginComputePass();
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
	const stages = Math.log2(settings.waterTileResolution);
	
	//pre compute twiddle values
	let bindButterflyPreCompCGroup = createCompBindGroupButterflyPreCompWater();
	const computePreCompPass = aEncoder.beginComputePass();
	computePreCompPass.setPipeline(waterButterflyPreCompComputePipeline);
	computePreCompPass.setBindGroup(0, bindButterflyPreCompCGroup);
	computePreCompPass.dispatchWorkgroups(stages / PRECOMP_WORKGROUP_SIZE[0],
											settings.waterTileResolution / PRECOMP_WORKGROUP_SIZE[1]);
	computePreCompPass.end();
	
	// ping pong a texture between the shader thats capable of both horizontal or vertical passes
	let pingPongA = waveHeightRealization;
	let pingPongB = pingPongIFFTTexture;
		
	//horizontal FFT
	for(let stage = 0; stage < stages; stage++) {
		let bindButterflyCGroup = createCompBindGroupButterflyWater(pingPongA, pingPongB);
		
		waterComputeButterflyBufferUpdate(0.0, stage);	//set the direction, and stage count
		const computeIFFTPassH = aEncoder.beginComputePass();
			
		computeIFFTPassH.setPipeline(waterButterflyComputePipeline);
		computeIFFTPassH.setBindGroup(0, bindButterflyCGroup);
		
		computeIFFTPassH.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0], 
												settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
	
		computeIFFTPassH.end();
		
		[pingPongA, pingPongB] = [pingPongB, pingPongA];
	}
	
	//check correct input to vertFFT
	let finalInput = (stages % 2 == 0) ? pingPongA : pingPongB;
	pingPongA = finalInput;
	pingPongB = (finalInput === pingPongA) ? pingPongB : pingPongA;
	
	for(let stage = 0; stage < stages; stage++) {
		let bindButterflyCGroup = createCompBindGroupButterflyWater(pingPongA, pingPongB);
		
		waterComputeButterflyBufferUpdate(1.0, stage);	//set the direction, and stage count
		const computeIFFTPassV = aEncoder.beginComputePass();
			
		computeIFFTPassV.setPipeline(waterButterflyComputePipeline);
		computeIFFTPassV.setBindGroup(0, bindButterflyCGroup);
		
		computeIFFTPassV.dispatchWorkgroups(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0], 
										  settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]);
	
		computeIFFTPassV.end();
		
		[pingPongA, pingPongB] = [pingPongB, pingPongA];
	}
	
	//aEncoder.copyTextureToTexture(
	//	{texture: pingPongA},
	//	{texture: preShiftFinalWaveHeightTexture},
	//	{width: settings.waterTileResolution, height: settings.waterTileResolution}
	//)
	//aEncoder.copyTextureToTexture(
	//	{texture: pingPongB},
	//	{texture: finalWaveHeightTexture},
	//	{width: settings.waterTileResolution, height: settings.waterTileResolution}
	//)
	
	
	//check correct final
	const finalIFFTOutput = (stages % 2 == 0) ? pingPongA : pingPongB;
	
	aEncoder.copyTextureToTexture(
		{texture: finalIFFTOutput},
		{texture: preShiftFinalWaveHeightTexture},
		{width: settings.waterTileResolution, height: settings.waterTileResolution}
	)
	
	//Shift and Copy
	let bindShiftCGroup = createCompBindGroupShiftWater(finalIFFTOutput, finalWaveHeightTexture);
	const computeShiftPass = aEncoder.beginComputePass();
	computeShiftPass.setPipeline(waterShiftComputePipeline);
	computeShiftPass.setBindGroup(0, bindShiftCGroup);
	computeShiftPass.dispatchWorkgroups(Math.ceil(settings.waterTileResolution / FFT_WORKGROUP_SIZE[0]), 
													Math.ceil(settings.waterTileResolution / FFT_WORKGROUP_SIZE[1]));
	computeShiftPass.end();
	
	//---------------------------MESH ASSEMBLY-------------------------
	//grid mesh compute pass
	const computePass = aEncoder.beginComputePass();
	
	computePass.setPipeline(waterComputePipeline);
	computePass.setBindGroup(0, bindCGroup);
	
	computePass.dispatchWorkgroups(Math.ceil( (settings.waterTileResolution * settings.waterTileResolution) / WATER_WORKGROUP_SIZE[0]));			//you want to do it per vertex, not per cell
	computePass.end();
		
	const bindVFGroups = createVFBindGroupswater();
	waterVFUniformBufferUpdates(1, [0,0,0]);
	
	// start a pass to render the water instances
	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{
		view: context.getCurrentTexture().createView(),
		loadOp: "load",
		clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
		storeOp: "store",
		}],
		depthStencilAttachment: {
			view: mainpassDepthTexture.createView(),
			
			//depth testing
			depthLoadOp: 'load',	
			depthStoreOp: 'store',
		},
	});

	pass.setPipeline(waterPipeline);					// shaders used, layout of vertex data, other relevant state data
	pass.setVertexBuffer(0, totalwaterVertexBuffer);	
	pass.setIndexBuffer(totalwaterIndexBuffer, 'uint32');	
	
	//3 instance view in viewport
	//
	//		  | \			  / |		instance 2
	//		  |__\___________/__|
	//  	     |\			/|			instance 1	
	//		     |_\_______/_|
	//		       |\	  /|
	//		       | \	 / |			instance 0
	//		       |__\ /__|
	//		    	  CAM
	
	
	//console.log("water vert buf: ", totalwaterVertexBuffer)
	
	let prevModCombo = 0;
	//for(let i = 0; i < settings.waterTileInstanceCount; ++i)
	{
		let mod = waterEntityModelsStride / (primitives.totalStride / 4);	//ACTUAL
		//console.log("mod: ", mod);
		pass.setBindGroup(0, bindVFGroups);
		//pass.draw(mod, 1/*i*/, prevModCombo);		// def for draw here is draw(vertexCount, instanceCount, firstVertex)
		pass.drawIndexed(totalPlaneTriangles * (3 + 2 + 3), 1, 0, 0, 0); // Drawing the mesh
		prevModCombo += mod;
	}
	prevModCombo = 0;
		
	pass.end();
}