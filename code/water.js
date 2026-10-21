import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { c_water } from '../shaders/js/vfc_water.js'
import { c_spectrum } from '../shaders/js/vfc_water.js'
import { c_hkt } from '../shaders/js/vfc_water.js'
import { c_IFFT_2D } from '../shaders/js/vfc_water.js'
import { c_PreComp } from '../shaders/js/vfc_water.js'
import { c_waveMaps } from '../shaders/js/vfc_water.js'
import { c_ShoreScan } from '../shaders/js/vfc_water.js'
import { c_ShoreDistance } from '../shaders/js/vfc_water.js'
import { v_water } from '../shaders/js/vfc_water.js'
import { f_water } from '../shaders/js/vfc_water.js'
import { WATER_WORKGROUP_SIZE } from '../shaders/js/vfc_water.js'
import { FFT_WORKGROUP_SIZE } from '../shaders/js/vfc_water.js'
import { PRECOMP_WORKGROUP_SIZE } from '../shaders/js/vfc_water.js'
import { SHORE_FIELD_DOWNSCALE } from '../shaders/js/vfc_water.js'
import { CASCADE_UNIFORM_FLOATS } from '../shaders/js/vfc_water.js'
import { ROCKS_MOST } from '../shaders/js/vfc_water.js'

import * as transformations from './transformations.js'
import * as scene from './scene.js'
import * as terrain from './terrain.js'	//the water reads where the land is, everywhere in the world, from terrain.terrainWaterTexture
import { refractSwell } from './waveRefraction.js'	//which way the swell runs over the shallows, from the depth of the water
import * as primitives from '../models/primitives.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

//the water reflects the sky and fogs into the horizon colour, both read from the sky view LUT
import {skyViewLUTtexture} from './atmosphere.js'
import * as screenEffects from './screenEffects.js'
import * as clouds from './clouds.js'
import { weatherNow } from './weather.js'	//storms blow harder over the sea too, and raise it

// compute shaders and buffers
//-------------------------------------------------
const waterComputeShaderModule = device.createShaderModule({
  label: "c_water",
  code: c_water	
});

const waterSpectrumComputeShaderModule = device.createShaderModule({
  label: "c_spectrum",
  code: c_spectrum
});

const waterButterflyPassComputeShaderModule = device.createShaderModule({
  label: "c_IFFT_2D",
  code: c_IFFT_2D
});

const waterWaveMapsComputeShaderModule = device.createShaderModule({
  label: "c_waveMaps",
  code: c_waveMaps
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

//anim: the waves' clock, in step time. It goes on by WAVE_STEPS_A_SECOND of real time (a frame's worth at 60 a second used to be
//		0.025, and the sea looks as it did at 60), and in a game with others the host's is everyone's (net.js: setWaveClock)
let step = 0.0;
const WAVE_STEPS_A_SECOND = 1.5;
let lastStepTime = performance.now();
export function waveClock() { return step; }
export function setWaveClock(value) { step = value; }

//random for initial wave map: one complex number for each texel of each cascade, its real and imaginary parts
//		independent standard normal draws (Box-Muller). Each is drawn from a hash of the seed (settings.waterSeed), the cascade and
//		the wave the texel stands for (its wave numbers, from the middle of the grid), not from a running random sequence. So every
//		machine with the same seed has the same sea, whatever its cascade resolution (a finer one only has more of the short
//		waves): the players in a game together see the same waves, and a boat sailed on one machine rides them on all of them
function hashUnit(seed, cascade, x, y, salt) {
	let h = 0x811c9dc5;
	for (const v of [seed, cascade, x, y, salt]) {
		h = Math.imul(h ^ (v | 0), 0x5bd1e995);
		h ^= h >>> 15;
		h = Math.imul(h, 0x27d4eb2d) ^ (h >>> 13);
	}
	h ^= h >>> 16;
	return ((h >>> 0) + 0.5) / 4294967296;
}
function gaussianNoise(res, cascades) {
	const noise = new Float32Array(res * res * cascades * 2);
	const seed = Math.round(settings.waterSeed);
	for (let c = 0; c < cascades; c++) {
		for (let y = 0; y < res; y++) {
			for (let x = 0; x < res; x++) {
				const i = c * res * res + y * res + x;
				const nx = x - res / 2, ny = y - res / 2;
				const radius = Math.sqrt(-2.0 * Math.log(hashUnit(seed, c, nx, ny, 1)));
				const angle = 2.0 * Math.PI * hashUnit(seed, c, nx, ny, 2);
				noise[i * 2 + 0] = radius * Math.cos(angle);
				noise[i * 2 + 1] = radius * Math.sin(angle);
			}
		}
	}
	return noise;
}
let noiseSeed = null;		// the seed the noise in the buffer was drawn with

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

// The cascades: the same sea simulated at three sizes, and added together where the mesh is built (c_water). The swell needs a tile
//		kilometres across to hold enough waves round its peak to look like a sea rather than a few sine waves, and the shortest
//		waves need texels a world unit or two across: one tile cant do both. Each cascade carries its own band of wavelengths
//		(the longest in 0, see cascadeBands), so nothing is counted twice. The sizes dont divide into each other, so the sum
//		of them only repeats every few kilometres, far past the edge of the tiles
const CASCADE_SIZES = [7919, 1531, 397];		// world units, one tile of each cascade
const CASCADE_COUNT = CASCADE_SIZES.length;
const WAVE_REPEAT_TIME = 1000;					// the sea comes back to where it started after this long (see c_hkt), in step time
const WAVE_SHORTEST_TEXELS = 4;				// the shortest wave a cascade carries, in its own texels. Bilinear filtering draws shorter ones badly
const WAVE_SHORTEST_CELLS = 3;					// and none shorter than this many cells of the finest mesh, which couldnt carry them
const BAND_RESOLUTION = 128;					// where the bands between the cascades fall is worked out for this resolution, whatever the
												//		cascades really are (see cascadeBands): the same waves in the same cascade on every machine

// the band of wave numbers (radians per world unit) each cascade carries, [from, to). Where one band ends and the next begins is the
//		same at every resolution (BAND_RESOLUTION's), so a wave is in the same cascade, on the same texel, on every machine (see
//		gaussianNoise). Only the last band reaches up as far as the real resolution lets it: a finer one has more of the short waves
function cascadeBands() {
	const res = settings.waterCascadeResolution;
	const bands = [];
	let low = 0.5 * 2.0 * Math.PI / CASCADE_SIZES[0];	// everything but the k = 0 texel, which carries nothing
	for (let c = 0; c < CASCADE_COUNT; c++) {
		let high = 2.0 * Math.PI / (WAVE_SHORTEST_TEXELS * CASCADE_SIZES[c] / (c == CASCADE_COUNT - 1 ? res : Math.min(res, BAND_RESOLUTION)));
		if (c == CASCADE_COUNT - 1) {
			high = Math.min(high, 2.0 * Math.PI / (WAVE_SHORTEST_CELLS * settings.waterGridSize / settings.waterTileResolution));
		}
		high = Math.max(high, low);
		bands.push([low, high]);
		low = high;
	}
	return bands;
}

// The sea's spectrum, from the settings (see c_spectrum). It works in metres and seconds
const GRAVITY = 9.81;
const SWELL_GAMMA = 5.0;		// how sharp the peak of the swell's spectrum is (JONSWAP's gamma), the same as in c_spectrum

function jonswap(omega, alpha, peak, gamma) {
	const sigma = omega <= peak ? 0.07 : 0.09;
	const peakSharpening = Math.exp(-((omega - peak) ** 2) / (2.0 * sigma * sigma * peak * peak));
	return alpha * GRAVITY * GRAVITY / omega ** 5 * Math.exp(-1.25 * (peak / omega) ** 4) * gamma ** peakSharpening;
}

// TMA, the same as in c_spectrum
function depthAttenuation(omega, depth) {
	const omegaH = omega * Math.sqrt(depth / GRAVITY);
	if (omegaH <= 1.0) return 0.5 * omegaH * omegaH;
	if (omegaH < 2.0) return 1.0 - 0.5 * (2.0 - omegaH) ** 2;
	return 1.0;
}

function spectrumParameters() {
	const unitsPerMetre = settings.forestUnitsPerMetre;		// the scale of the whole world (the trees are made in metres)
	const depth = Math.max(settings.waterDeepSeaDepth / unitsPerMetre, 1.0);
	const windLength = Math.hypot(settings.windDirection[0], settings.windDirection[1]) || 1;
	const windDirection = [settings.windDirection[0] / windLength, settings.windDirection[1] / windLength];

	// the wind sea: JONSWAP's fit to how far the wind has blown over open water (the fetch), up to a fully developed sea.
	//		Past a dimensionless fetch of about 22000 the waves are as big as that wind can make them
	const windSpeed = seaWindSpeed();
	let windAlpha = 0.0;
	let windPeak = 1.0;
	if (windSpeed > 0.1) {
		const fetch = Math.min(settings.waterFetch * 1000.0 * GRAVITY / (windSpeed * windSpeed), 22000.0);
		windAlpha = 0.076 * Math.pow(fetch, -0.22);
		windPeak = 22.0 * GRAVITY / windSpeed * Math.pow(fetch, -1.0 / 3.0);
	}

	// the swell: its peak from its wavelength, and its energy scaled so that its significant wave height (4 times its rms height) is the setting
	const swellK = 2.0 * Math.PI / Math.max(settings.waterSwellLength / unitsPerMetre, 1.0);
	const swellPeak = Math.sqrt(GRAVITY * swellK * Math.tanh(swellK * depth));
	const swellHeight = settings.waterSwellHeight / unitsPerMetre;
	let swellAlpha = 0.0;
	if (swellHeight > 0.0) {
		// of the swell's spectrum at an alpha of 1, by the trapezium rule over all the frequencies that matter: as far as the top
		//		of cascade 0, which is the only one that has the swell (see c_spectrum)
		const topK = cascadeBands()[0][1] * unitsPerMetre;
		let energy = 0.0;
		const from = 0.3 * swellPeak;
		const to = Math.max(Math.min(6.0 * swellPeak, Math.sqrt(GRAVITY * topK * Math.tanh(topK * depth))), 1.1 * from);
		const steps = 2000;
		for (let i = 0; i <= steps; i++) {
			const omega = from + (to - from) * i / steps;
			energy += jonswap(omega, 1.0, swellPeak, SWELL_GAMMA) * depthAttenuation(omega, depth) * (i == 0 || i == steps ? 0.5 : 1.0);
		}
		energy *= (to - from) / steps;
		swellAlpha = (swellHeight / 4.0) ** 2 / energy;
	}
	const swellAngle = Math.atan2(windDirection[1], windDirection[0]) + settings.waterSwellDirection * Math.PI / 180.0;

	// how high the open sea's crests stand: a third of its significant wave height, the swell's and the wind sea's together
	//		(the wind sea's from its JONSWAP energy, the gamma of 3.3 adding about half again). The light through the crests is
	//		at its brightest there (f_water)
	const windSeaHeight = windAlpha > 0.0 ? 4.0 * Math.sqrt(1.5 * windAlpha * GRAVITY * GRAVITY / (5.0 * windPeak ** 4)) : 0.0;
	const crestHeight = 0.35 * Math.hypot(swellHeight, windSeaHeight) * unitsPerMetre;

	return {
		unitsPerMetre: unitsPerMetre,
		depth: depth,
		windDirection: windDirection,
		windSpeed: windSpeed,
		windAlpha: windAlpha,
		windPeak: windPeak,
		swellAlpha: swellAlpha,
		swellPeak: swellPeak,
		swellSpread: settings.waterSwellSpread,
		swellDirection: [Math.cos(swellAngle), Math.sin(swellAngle)],
		crestHeight: crestHeight,
		windSeaHeight: windSeaHeight * unitsPerMetre,	// significant wave height of the wind sea, world units
	};
}

// The wind over the open sea, metres per second: its own setting (it blows harder there than over the land: nothing in its way),
//		times what the season and the weather add, the same as over the land (wind.js). So a storm raises the sea
function seaWindSpeed() {
	return settings.waterOceanWindSpeed * weatherNow.wind;
}

// everything the spectrum is made from: when any of it changes, the spectrum is made again (see waterPass)
//		The wind over the sea changes all the time with the weather: it counts as changed once it has moved by 3%. Made again
//		from the same random numbers, the waves only grow or calm, they dont jump
function spectrumSettingsKey() {
	return [Math.round(Math.log(Math.max(seaWindSpeed(), 0.05)) / Math.log(1.03)), settings.windDirection[0], settings.windDirection[1], settings.waterFetch,
			settings.waterSwellHeight, settings.waterSwellLength, settings.waterSwellSpread, settings.waterSwellDirection,
			settings.waterDeepSeaDepth, settings.forestUnitsPerMetre, settings.waterGridSize, settings.waterTileResolution, settings.waterCascadeResolution].join(',');
}
let spectrum = spectrumParameters();
let lastSpectrumSettings = spectrumSettingsKey();
let spectrumDirty = true;		// the spectrum (and the butterfly passes' twiddle factors) need making before the next frame

//if settings change live, this will have to be changed out from constants													!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
let waterPlaneVertexStride = (3 + 2 + 3 + 1);	// position, the uv slot (foam and depth), normal, and how peaked the water is

// the water's own vertex layout: the scene's, and one more number
const waterVertexBufferLayout = {
	arrayStride: waterPlaneVertexStride * Float32Array.BYTES_PER_ELEMENT,
	attributes: [
		{ format: "float32x3", offset: 0, shaderLocation: 0 },		// position
		{ format: "float32x2", offset: 12, shaderLocation: 1 },		// uv slot: x the foam breaking now (below 0 on a lake), y the depth
		{ format: "float32x3", offset: 20, shaderLocation: 2 },		// normal, as long as 1 + the foam left lying on the water
		{ format: "float32", offset: 32, shaderLocation: 3 },		// how peaked the water is, for the light through the crests
	],
};
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

// Each cascade's settings (the CascadeUniforms of c_spectrum, c_hkt and c_waveMaps), written every frame for the time (writeCascadeUniforms)
const cascadeUniformBuffers = [];
for (let c = 0; c < CASCADE_COUNT; c++) {
	cascadeUniformBuffers.push(device.createBuffer({
		label: `water cascade ${c} uniform`,
		size: 256,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	}));
}


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
			verts.push(0.0);			//and no crests
		}
	}
	device.queue.writeBuffer(waterHorizonVertexBuffer, 0, new Float32Array(verts));
}

// The cascades' textures and buffers, all sized by the cascade resolution (made again when it changes, see recreateResolutionDependentResources)
//		the spectrum ones hold every cascade one above the other, the maps the mesh pass reads are one texture each, so they can wrap round
export let oceanSpectrumTexture;		// the spectrum's amplitudes as a picture, for the debug view (c_spectrum)
export let initialSpectrumTexture;		// h0(k) and conj(h0(-k)), made when the settings change and animated from every frame (c_hkt)
export let preCompTexture;				// the butterfly passes' twiddle factors and which elements to combine (c_PreComp)
export const waveTextures = [];			// one a cascade, x: Dx, y: height, z: Dz, w: dDx/dz (c_waveMaps)
export const slopeTextures = [];		// one a cascade, x: dh/dx, y: dh/dz, z: dDx/dx, w: dDz/dz
export const foamTextures = [];			// one a cascade, x: the foam it has made, kept from frame to frame and fading (c_waveMaps)
let waveNoiseBuffer;					// the complex gaussian random numbers the spectrum is multiplied by, one for each texel of each cascade
let bitReversedIndicesBuffer;
// the butterfly passes ping pong between these. 2 layers a cascade (the height, then the displacement), a complex number a texel.
//		c_hkt writes into fftBufferA, and after an even number of stages the result is back in fftBufferA for c_waveMaps
let fftBufferA;
let fftBufferB;

function createWaveResources() {
	const res = settings.waterCascadeResolution;
	const storage = GPUTextureUsage.COPY_SRC | GPUTextureUsage.STORAGE_BINDING;

	oceanSpectrumTexture = device.createTexture({ label: "water ocean spectrum Texture", size: [res, res * CASCADE_COUNT], format: 'rgba32float', usage: storage });
	initialSpectrumTexture = device.createTexture({ label: "water initial spectrum h0(k) Texture", size: [res, res * CASCADE_COUNT], format: 'rgba32float', usage: storage });
	preCompTexture = device.createTexture({ label: "water butterfly pre comp Texture", size: [Math.log2(res), res], format: 'rgba32float', usage: storage });
	waveTextures.length = 0;
	slopeTextures.length = 0;
	foamTextures.length = 0;
	for (let c = 0; c < CASCADE_COUNT; c++) {
		waveTextures.push(device.createTexture({ label: `water wave cascade ${c} Texture`, size: [res, res], format: 'rgba16float', usage: storage | GPUTextureUsage.TEXTURE_BINDING }));
		slopeTextures.push(device.createTexture({ label: `water wave slope cascade ${c} Texture`, size: [res, res], format: 'rgba16float', usage: storage | GPUTextureUsage.TEXTURE_BINDING }));
		foamTextures.push(device.createTexture({ label: `water foam cascade ${c} Texture`, size: [res, res], format: 'r32float', usage: storage | GPUTextureUsage.TEXTURE_BINDING }));
	}

	const noise = gaussianNoise(res, CASCADE_COUNT);
	noiseSeed = settings.waterSeed;
	waveNoiseBuffer = device.createBuffer({ label: "water spectrum gaussian noise Buffer", size: noise.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
	device.queue.writeBuffer(waveNoiseBuffer, 0, noise);

	const bitReversed = new Float32Array(bitReversedIndicies(res));
	bitReversedIndicesBuffer = device.createBuffer({ label: "water butterfly bit reversed indices Array Buffer", size: bitReversed.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
	device.queue.writeBuffer(bitReversedIndicesBuffer, 0, bitReversed);

	const fftSize = res * res * CASCADE_COUNT * 2 * 2 * Float32Array.BYTES_PER_ELEMENT;
	fftBufferA = device.createBuffer({ label: "water FFT ping pong Buffer A", size: fftSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
	fftBufferB = device.createBuffer({ label: "water FFT ping pong Buffer B", size: fftSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
}

function destroyWaveResources() {
	for (const texture of [oceanSpectrumTexture, initialSpectrumTexture, preCompTexture, ...waveTextures, ...slopeTextures, ...foamTextures]) {
		texture.destroy();
	}
	for (const buffer of [waveNoiseBuffer, bitReversedIndicesBuffer, fftBufferA, fftBufferB]) {
		buffer.destroy();
	}
}
createWaveResources();

// The swell, turned by the shallows (see waveRefraction.js): for every point of a coarse grid over the land, how far behind a crest
//		out in the open sea it runs and which way. Made again when the land is a new one, or the swell runs another way or at another
//		period, or the sea is at another level: a few tens of milliseconds, now and then. Kept in a texture for the mesh pass,
//		which bends the swell's crests round by it. x: the delay, world units, yz: the gradient of the arrival time, w: the depth
export let refraction = { points: 2, cellSize: 1, data: new Float32Array(16) };
export let refractionTexture = null;
let lastRefractionSettings = null;
const landIds = new WeakMap();
let nextLandId = 1;

function updateRefraction() {
	const land = settings.enableTerrain ? terrain.land : null;
	if (land && !landIds.has(land)) landIds.set(land, nextLandId++);
	const key = [land ? landIds.get(land) : 0, spectrum.swellDirection[0], spectrum.swellDirection[1], spectrum.swellPeak,
				 settings.waterWorldPosY, settings.forestUnitsPerMetre, settings.terrainWorldSize].join(',');
	if (key === lastRefractionSettings && refractionTexture) {
		return;
	}
	lastRefractionSettings = key;

	if (land) {
		refraction = refractSwell({
			heights: land.heights, lakes: land.lakes, points: land.points, worldSize: settings.terrainWorldSize,
			seaLevel: settings.waterWorldPosY, unitsPerMetre: settings.forestUnitsPerMetre,
			direction: spectrum.swellDirection, omega: spectrum.swellPeak, every: Math.max(1, Math.round((land.points - 1) / 256)),
		});
	} else {
		// no land: open sea everywhere, the swell runs straight on (2 x 2 points of it)
		const open = new Float32Array(16);
		for (let p = 0; p < 4; p++) open.set([0, spectrum.swellDirection[0], spectrum.swellDirection[1], 1000], p * 4);
		refraction = { points: 2, cellSize: 1, data: open };
	}
	if (!refractionTexture || refractionTexture.width != refraction.points) {
		if (refractionTexture) refractionTexture.destroy();
		refractionTexture = device.createTexture({
			label: "water swell refraction Texture",
			size: [refraction.points, refraction.points],
			format: 'rgba32float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});
	}
	device.queue.writeTexture({ texture: refractionTexture }, refraction.data, { bytesPerRow: refraction.points * 16, rowsPerImage: refraction.points }, [refraction.points, refraction.points]);
}

// The boulders standing in the sea near the camera, for the water round them (see Boulders In The Sea in c_water). boulders.js
//		hands over how to find them (setRockFinder, from rotatingCube.js: water.js cant import boulders.js, it would go round in a circle)
let findRocks = null;
export function setRockFinder(finder) {
	findRocks = finder;
}
const ROCK_REACH = 700;		// how far from the camera they are looked for
const rockBuffer = device.createBuffer({
	label: "water boulders uniform",
	size: (ROCKS_MOST * 2 + 1) * 16,
	usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});
const rockData = new Float32Array((ROCKS_MOST * 2 + 1) * 4);
export const rockStats = { found: 0, used: 0 };	// how many boulders stand in the sea near the camera, and how many the water was told about

// which way the swell runs at a place: the gradient of the refraction map (as the mesh pass reads it), or straight on off the map
function swellHeadingAt(x, z) {
	const half = settings.terrainWorldSize * 0.5;
	if (refraction.points < 3 || Math.abs(x) >= half || Math.abs(z) >= half) {
		return spectrum.swellDirection;
	}
	const i = Math.round((x + half) / refraction.cellSize), j = Math.round((z + half) / refraction.cellSize);
	const p = (j * refraction.points + i) * 4;
	const length = Math.hypot(refraction.data[p + 1], refraction.data[p + 2]) || 1;
	return [refraction.data[p + 1] / length, refraction.data[p + 2] / length];
}

// every boulder near the camera whose foot is under the still water and whose top is at it or over it (or only just under), the nearest first
function gatherRocks() {
	const rocks = [];
	if (settings.enableBoulderWater && settings.enableBoulders && findRocks) {
		const sea = settings.waterWorldPosY;
		findRocks(settings.camPosX, settings.camPosZ, ROCK_REACH, (x, z, half, bottom, top) => {
			if (bottom < sea + 0.5 && top > sea - 1.0) {
				rocks.push([x, z, half * 1.15, top - sea, Math.hypot(x - settings.camPosX, z - settings.camPosZ)]);
			}
		});
		rocks.sort((a, b) => a[4] - b[4]);
	}
	const count = Math.min(rocks.length, ROCKS_MOST);
	rockStats.found = rocks.length;
	rockStats.used = count;
	for (let r = 0; r < count; r++) {
		const [x, z, radius, standing] = rocks[r];
		const runs = swellHeadingAt(x, z);
		rockData.set([x, z, radius, standing, runs[0], runs[1], 0, 0], r * 8);
	}
	rockData.set([count, 0, 0, 0], ROCKS_MOST * 8);
	device.queue.writeBuffer(rockBuffer, 0, rockData);
}

// for the caustics under the sea (lightShafts.js): the finest cascade, and the world size of one tile of it
export function causticWaves() {
	return { texture: waveTextures[CASCADE_COUNT - 1], size: CASCADE_SIZES[CASCADE_COUNT - 1] };
}

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

//the cascades' maps: linear, and wrapping round, as each cascade repeats
export const waveSampler = device.createSampler({
  label: "water wave cascade sampler",
  magFilter: 'linear',
  minFilter: 'linear',
  addressModeU: 'repeat',
  addressModeV: 'repeat',
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
	
	waterCompBuffer.push(settings.waterCascadeResolution);	//the size of the FFT, for the butterfly passes
	waterCompBuffer.push(settings.waterWaveSteepness);
	waterCompBuffer.push(step);	
	waterCompBuffer.push(settings.waterWorldPosY);
	waterCompBuffer.push(settings.waterWaveLength);
	waterCompBuffer.push(0);	//oceanPlanePhysicalSize: nothing reads it now, each cascade has its own size (CASCADE_SIZES)
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
	waterCompBuffer.push(settings.waterShallowRideHigh ? 1 : 0);
	waterCompBuffer.push(settings.forestUnitsPerMetre);	//unitsPerMetre: the scale of the world, for the speed of the shore waves
	waterCompBuffer.push(settings.waterFullDepth);
	waterCompBuffer.push(settings.waterShallowRippleScale);

	// the terrain grid, so the mesh pass can look a world position up in the terrain's texture. A size of 0 tells it there is no land
	waterCompBuffer.push(settings.enableTerrain ? settings.terrainWorldSize * 0.5 : 0);
	waterCompBuffer.push(terrain.land.cellSize);

	// the cascades, and where the shortest of their waves fade out: by a tile out from the camera, before the
	//		coarser rings of tiles, whose cells are too big to carry them
	waterCompBuffer.push(...CASCADE_SIZES);
	waterCompBuffer.push(0.5 * settings.waterGridSize);
	waterCompBuffer.push(1.0 * settings.waterGridSize);

	// the swell, for the mesh pass to turn it by the refraction map, and how soon the wind cascades feel the bottom
	//		(the middle of the band of wave numbers each carries)
	waterCompBuffer.push(spectrum.swellDirection[0], spectrum.swellDirection[1], spectrum.swellPeak);
	const bands = cascadeBands();
	waterCompBuffer.push(Math.sqrt(bands[1][0] * bands[1][1]), Math.sqrt(bands[2][0] * bands[2][1]));
	// and the heights of the swell and the wind sea out at sea, for the surf zone to hold them to the depth
	waterCompBuffer.push(settings.waterSwellHeight, spectrum.windSeaHeight);
	
		
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

		//the still sea, and how high its crests stand, for the light through them
		bufferResult.push(settings.waterWorldPosY, spectrum.crestHeight, 0);	//(the vec4f after this has to start on a 16 byte boundary, and with these three in front of it it does)

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

// The foam a cascade makes on its own (c_waveMaps): one cascade alone squeezes the surface less than all of them together, so it
//		breaks into foam a little sooner. And what it made is half gone after FOAM_HALF_LIFE of step time
const CASCADE_FOAM_EASE = 0.45;
const FOAM_HALF_LIFE = 2.0;
let foamKeep = Math.pow(0.5, 0.025 / FOAM_HALF_LIFE);	// (made again each frame for the step time it went on by, see waterPass)

// Each cascade's settings, in the order of CascadeUniforms (vfc_water.js)
function writeCascadeUniforms() {
	const bands = cascadeBands();
	for (let c = 0; c < CASCADE_COUNT; c++) {
		const values = new Float32Array(CASCADE_UNIFORM_FLOATS);	// (set throws if this list ever grows past the struct)
		values.set([
			settings.waterCascadeResolution, CASCADE_SIZES[c], bands[c][0], bands[c][1],
			spectrum.unitsPerMetre, spectrum.depth, step % WAVE_REPEAT_TIME, WAVE_REPEAT_TIME,
			spectrum.windDirection[0], spectrum.windDirection[1], spectrum.windSpeed, spectrum.windAlpha,
			spectrum.windPeak, spectrum.swellAlpha, spectrum.swellPeak, spectrum.swellSpread,
			spectrum.swellDirection[0], spectrum.swellDirection[1], c, settings.waterChoppiness,
			settings.waterFoamThreshold + CASCADE_FOAM_EASE, settings.waterFoamFade, foamKeep, 0,
		]);
		device.queue.writeBuffer(cascadeUniformBuffers[c], 0, values);
	}
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
    binding: 4,								//the cascades' sampler
    visibility:  GPUShaderStage.COMPUTE,
    sampler: {}
  },
  {
    binding: 5,
    visibility: GPUShaderStage.COMPUTE,
    texture: {
		sampleType: 'depth',
	},
  },
  // the cascades' maps (c_waveMaps): 6, 10 and 12 the waves, 9, 11 and 13 their slopes
  ...[6, 9, 10, 11, 12, 13].map((binding) => ({
    binding: binding,
    visibility: GPUShaderStage.COMPUTE,
    texture: {}
  })),
  // the swell turned by the shallows (see waveRefraction.js)
  {
    binding: 16,
    visibility: GPUShaderStage.COMPUTE,
    texture: { sampleType: 'unfilterable-float' }
  },
  // the boulders standing in the sea
  {
    binding: 17,
    visibility: GPUShaderStage.COMPUTE,
    buffer: {}
  },
  // and the foam the wind waves (cascades 1 and 2) have left
  ...[14, 15].map((binding) => ({
    binding: binding,
    visibility: GPUShaderStage.COMPUTE,
    texture: { sampleType: 'unfilterable-float' }
  })),
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
    visibility: GPUShaderStage.COMPUTE,	//this cascade's settings
    buffer: {}
  },
  {
	binding: 1,								//the gaussian random numbers
    visibility:  GPUShaderStage.COMPUTE,
    buffer: {
		type: "read-only-storage",
	}
  },
  {
    binding: 2,								//outTexture for h0(k) and conj(h0(-k)), every cascade
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",
		access: "write-only",
		dimension: "2d",
    }
  },
  {
    binding: 3,								//outTexture for the spectrum's picture
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",
		access: "write-only",
		dimension: "2d",
    }
  }
  ]
});

const bindGroupRealizationCLayout = device.createBindGroupLayout({
  label: "water Bind Group HKT Realization C Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//this cascade's settings
    buffer: {}
  },
  {
    binding: 1,								//inTexture for h0(k) and conj(h0(-k))
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba32float",
		access: "read-only",
		dimension: "2d",
    }
  },
  {
	binding: 2,								//the butterfly passes' first buffer
    visibility:  GPUShaderStage.COMPUTE,
    buffer: {
		type: "storage",
	}
  }
  ]
});

const bindGroupWaveMapsCLayout = device.createBindGroupLayout({
  label: "water Bind Group Wave Maps C Layout",
  entries: [
  {
    binding: 0,
    visibility: GPUShaderStage.COMPUTE,	//this cascade's settings
    buffer: {}
  },
  {
	binding: 1,								//the butterfly passes' result
    visibility:  GPUShaderStage.COMPUTE,
    buffer: {
		type: "read-only-storage",
	}
  },
  {
    binding: 2,								//outTexture for the waves
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba16float",
		access: "write-only",
		dimension: "2d",
    }
  },
  {
    binding: 3,								//outTexture for their slopes
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "rgba16float",
		access: "write-only",
		dimension: "2d",
    }
  },
  {
    binding: 4,								//the foam, read and written back
    visibility:  GPUShaderStage.COMPUTE,
    storageTexture: {
        format: "r32float",
		access: "read-write",
		dimension: "2d",
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
				resource: waveSampler
			},
			{
				binding: 5,
				resource: scene.heightMapView
			},
			// the cascades' maps, each wave map then its slopes
			...[[6, 9], [10, 11], [12, 13]].flatMap(([waveBinding, slopeBinding], c) => [
				{ binding: waveBinding, resource: waveTextures[c].createView() },
				{ binding: slopeBinding, resource: slopeTextures[c].createView() },
			]),
			{ binding: 14, resource: foamTextures[1].createView() },
			{ binding: 15, resource: foamTextures[2].createView() },
			{ binding: 16, resource: refractionTexture.createView() },
			{ binding: 17, resource: { buffer: rockBuffer } },
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

function makeCompBindGroupSpectrumWater(c) {

	const result =
		device.createBindGroup({
			label: `water Comp spectrum bind group cascade ${c}`,
			layout: bindGroupSpectrumCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: cascadeUniformBuffers[c] }
			},
			{
				binding: 1,
				resource: { buffer: waveNoiseBuffer }
			},
			{
				binding: 2,
				resource: initialSpectrumTexture.createView()
			},
			{
				binding: 3,
				resource: oceanSpectrumTexture.createView()
			}
			]
		});
	return result;
}

function makeCompBindGroupRealizationWater(c) {

	const result =
		device.createBindGroup({
			label: `water Comp Realization bind group cascade ${c}`,
			layout: bindGroupRealizationCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: cascadeUniformBuffers[c] }
			},
			{
				binding: 1,
				resource: initialSpectrumTexture.createView()
			},
			{
				binding: 2,
				resource: { buffer: fftBufferA }
			}
			]
		});
	return result;
}

function makeCompBindGroupWaveMapsWater(c) {

	const result =
		device.createBindGroup({
			label: `water Comp Wave Maps bind group cascade ${c}`,
			layout: bindGroupWaveMapsCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: cascadeUniformBuffers[c] }
			},
			{
				binding: 1,
				resource: { buffer: fftBufferA }
			},
			{
				binding: 2,
				resource: waveTextures[c].createView()
			},
			{
				binding: 3,
				resource: slopeTextures[c].createView()
			},
			{
				binding: 4,
				resource: foamTextures[c].createView()
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
				resource: { buffer: bitReversedIndicesBuffer }
			}
			]
		});
	return result;
}

function makeCompBindGroupButterflyWater() {

	const result =
		device.createBindGroup({
			label: "water Comp Butterfly bind group",
			layout: bindGroupButterflyCLayout,
			entries: [
			{
				binding: 0,
				resource: { buffer: uniformBufferComputeWaterPreMesh }
			},
			{
				binding: 1,
				resource: { buffer: fftBufferA }
			},
			{
				binding: 2,
				resource: { buffer: fftBufferB }
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
	return cachedBindGroup('mesh' + idOf(computeUniformBuffer), [vertexBuffer, indexBuffer, computeUniformBuffer, ...waveTextures, ...slopeTextures, ...foamTextures, refractionTexture, scene.heightMapView, shoreDistanceTexture, terrain.terrainWaterTexture],
		() => makeCompBindGroupwater(vertexBuffer, indexBuffer, computeUniformBuffer));
}
function createCompBindGroupShoreScanWater() {
	return cachedBindGroup('shoreScan', [shoreScanTexture, scene.heightMapView], makeCompBindGroupShoreScanWater);
}
function createCompBindGroupShoreDistanceWater() {
	return cachedBindGroup('shoreDistance', [shoreScanTexture, shoreDistanceTexture], makeCompBindGroupShoreDistanceWater);
}
function createCompBindGroupSpectrumWater(c) {
	return cachedBindGroup('spectrum' + c, [initialSpectrumTexture, oceanSpectrumTexture, waveNoiseBuffer], () => makeCompBindGroupSpectrumWater(c));
}
function createCompBindGroupRealizationWater(c) {
	return cachedBindGroup('realization' + c, [initialSpectrumTexture, fftBufferA], () => makeCompBindGroupRealizationWater(c));
}
function createCompBindGroupWaveMapsWater(c) {
	return cachedBindGroup('waveMaps' + c, [fftBufferA, waveTextures[c], slopeTextures[c], foamTextures[c]], () => makeCompBindGroupWaveMapsWater(c));
}
function createCompBindGroupButterflyPreCompWater() {
	return cachedBindGroup('precomp', [preCompTexture, bitReversedIndicesBuffer], makeCompBindGroupButterflyPreCompWater);
}
function createCompBindGroupButterflyWater() {
	return cachedBindGroup('butterfly', [fftBufferA, fftBufferB, preCompTexture], makeCompBindGroupButterflyWater);
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
  label: "water initial spectrum Pipeline Layout",
  bindGroupLayouts: [ bindGroupSpectrumCLayout ],
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

const waterWaveMapsCompPipelineLayout = device.createPipelineLayout({
  label: "water Wave Maps Pipeline Layout",
  bindGroupLayouts: [ bindGroupWaveMapsCLayout ],
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
		buffers: [waterVertexBufferLayout]	// GPUVertexBufferLayout that describe data packed into vertex buffers used
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

const waterWaveMapsComputePipeline = device.createComputePipeline({
  label: "water Wave Maps C pipeline",
  layout: waterWaveMapsCompPipelineLayout,
	compute: {
		module: waterWaveMapsComputeShaderModule,
		entryPoint: "computeMain",
	},
});


function redirectWindDirectionTemp() {
	settings.windDirection[0] = Math.cos(step * 0.75);
	//settings.windDirection[1] = Math.sin(step * 0.00053);
}

// The surface at a few places, read back to this side for anything floating on it (boat.js). The GPU makes the waves, and only
//		it knows where the surface is: so each frame the places asked for (setWaterProbes) go through the same sums as the mesh
//		(probeMain in c_water) and come back a frame or two later (mapAsync, never waited for). waterProbes holds the last that came
//		back, 8 numbers a place: x, z asked about, the height of the surface there, its normal (x, y, z), the depth of the still
//		water, the foam. In world units
//		And one more after them, always: under the camera (cameraWater), for whether it is under the water (lightShafts.js) and for a
//		swimmer to float on the waves (hunting.js)
export const PROBES_MOST = 320;
const PROBE_FLOATS = 8;
export const waterProbes = { count: 0, data: new Float32Array((PROBES_MOST + 1) * PROBE_FLOATS), at: 0, frames: 0 };
// the surface under the camera, as the last probe found it: where it was asked (x, z), its height, its normal, when (performance.now)
export const cameraWater = { x: 0, z: 0, height: null, normal: [0, 1, 0], at: 0 };
const probeAsk = new Float32Array((PROBES_MOST + 1) * PROBE_FLOATS);
let probeAskCount = 0;
const probeBuffer = device.createBuffer({ label: "water probes", size: probeAsk.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
const probeNoIndices = device.createBuffer({ label: "water probes (no index data)", size: 16, usage: GPUBufferUsage.STORAGE });
const probeReadBuffers = [0, 1, 2].map((k) => ({ buffer: device.createBuffer({ label: `water probes read back ${k}`, size: probeAsk.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), busy: false }));
const waterProbePipeline = device.createComputePipeline({
	label: "water probes C pipeline",
	layout: waterCompPipelineLayout,
	compute: { module: waterComputeShaderModule, entryPoint: "probeMain" },
});

// the places to read the surface at from now on: [[x, z], ...] (world units), up to PROBES_MOST. The results come back in the same order
export function setWaterProbes(places) {	// (the camera's is added after them: cameraWater)
	probeAskCount = Math.min(places.length, PROBES_MOST);
	for (let i = 0; i < probeAskCount; i++) {
		probeAsk[i * PROBE_FLOATS] = places[i][0];
		probeAsk[i * PROBE_FLOATS + 1] = places[i][1];
	}
}

// in waterPass, once the tiles are made: the probes, through the uniforms of the tile under the camera, and copied out to be read
function probeWater(aEncoder, uniformBuffer) {
	// (the camera's, after the ones asked for)
	probeAsk[probeAskCount * PROBE_FLOATS] = settings.camPosX;
	probeAsk[probeAskCount * PROBE_FLOATS + 1] = settings.camPosZ;
	const count = probeAskCount + 1;
	device.queue.writeBuffer(probeBuffer, 0, probeAsk, 0, count * PROBE_FLOATS);
	const probePass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Probes', 'c_water probeMain') });
	probePass.setPipeline(waterProbePipeline);
	probePass.setBindGroup(0, cachedBindGroup('probes', [uniformBuffer, ...waveTextures, ...slopeTextures, ...foamTextures, refractionTexture, scene.heightMapView, shoreDistanceTexture, terrain.terrainWaterTexture],
		() => makeCompBindGroupwater(probeBuffer, probeNoIndices, uniformBuffer)));
	probePass.dispatchWorkgroups(Math.ceil(count / WATER_WORKGROUP_SIZE[0]));
	probePass.end();
	const read = probeReadBuffers.find((r) => !r.busy);
	if (!read) {
		return null;	// (all three still on their way back: this frame's is not read)
	}
	aEncoder.copyBufferToBuffer(probeBuffer, 0, read.buffer, 0, count * PROBE_FLOATS * 4);
	return { read, count };
}

// after the submit: when it is back, it is the latest
function readProbesBack(sent) {
	sent.read.busy = true;
	sent.read.buffer.mapAsync(GPUMapMode.READ, 0, sent.count * PROBE_FLOATS * 4).then(() => {
		waterProbes.data.set(new Float32Array(sent.read.buffer.getMappedRange(0, sent.count * PROBE_FLOATS * 4)));
		sent.read.buffer.unmap();
		waterProbes.count = sent.count - 1;
		const o = (sent.count - 1) * PROBE_FLOATS, d = waterProbes.data;
		Object.assign(cameraWater, { x: d[o], z: d[o + 1], height: d[o + 2], normal: [d[o + 3], d[o + 4], d[o + 5]], at: performance.now() });
		waterProbes.at = performance.now();
		waterProbes.frames++;
		sent.read.busy = false;
	}, () => { sent.read.busy = false; });
}

// The mesh of the tile under the camera, as the water's compute pass last left it, for the spray to look for crests in (particles.js):
//		9 numbers a vertex, the 4th of them the foam. Nothing while the tiles are being made again
export function waterCrestVertices() {
	if (resolutionRebuildPending || waterVertexBuffers.length == 0 || waterVertexBuffers.length != waterTileLayout.length) {
		return null;
	}
	const middle = Math.floor(waterVertexBuffers.length / 2);	// the tiles are in rows, so the middle one of the list is the middle one of the grid
	return { buffer: waterVertexBuffers[middle], count: waterTileLayout[middle].vertexCount };
}

let lastWaterTileResolution = settings.waterTileResolution;
let lastWaterTileInstanceCount = settings.waterTileInstanceCount;
let lastWaterGridSize = settings.waterGridSize;
let lastWaterCascadeResolution = settings.waterCascadeResolution;
let resolutionRebuildPending = false;

async function recreateResolutionDependentResources() {
	// wait for GPU to finish all submitted work before destroying anything
    await device.queue.onSubmittedWorkDone();

    // the cascades' textures and buffers, made again at the new resolution
	destroyWaveResources();
	createWaveResources();

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

	totalTileCount = settings.waterTileInstanceCount * settings.waterTileInstanceCount;
	waterTileLayout = getTileLayout();

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

    // the new textures have no spectrum in them yet
	spectrumDirty = true;
	resolutionRebuildPending = false;
}

// The 2D IFFT of every field of every cascade at once (2 layers of the buffers a cascade), out of fftBufferA and back into it
//		ping pong a buffer between the shader thats capable of both horizontal or vertical passes. Each stage is one dispatch
//		with its own settings (its slot, see writeButterflySlots); the GPU finishes one dispatch's writes before the next reads them
//		(the result is in whichever buffer the last stage wrote: there are always an even number of them, so the one it started in)
function waterIFFT(aEncoder, stages) {
	const res = settings.waterCascadeResolution;
	const bindButterflyCGroup = createCompBindGroupButterflyWater();
	writeButterflySlots(stages);
	for (let direction = 0; direction < 2; direction++) {
		const computeIFFTPass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps(direction == 0 ? 'Butterfly Horizontal' : 'Butterfly Vertical', 'c_IFFT_2D') });
		computeIFFTPass.setPipeline(waterButterflyComputePipeline);
		for (let stage = 0; stage < stages; stage++) {
			computeIFFTPass.setBindGroup(0, bindButterflyCGroup, [butterflySlot(direction, stage)]);
			computeIFFTPass.dispatchWorkgroups(res / FFT_WORKGROUP_SIZE[0], res / FFT_WORKGROUP_SIZE[1], CASCADE_COUNT * 2);
		}
		computeIFFTPass.end();
	}
}

export function waterPass(mainpassDepthTexture) {

	if (settings.waterTileResolution !== lastWaterTileResolution ||
		settings.waterTileInstanceCount !== lastWaterTileInstanceCount ||
		settings.waterGridSize !== lastWaterGridSize ||
		settings.waterCascadeResolution !== lastWaterCascadeResolution) {

        lastWaterTileResolution = settings.waterTileResolution;
		lastWaterTileInstanceCount = settings.waterTileInstanceCount;
		lastWaterGridSize = settings.waterGridSize;
		lastWaterCascadeResolution = settings.waterCascadeResolution;

        if (!resolutionRebuildPending) {
            resolutionRebuildPending = true;
            recreateResolutionDependentResources(); // fire async, don't await
        }
    }

	// make the spectrum again when anything it is made from has changed. The time carries on: the waves change, the clock doesnt jump
	const spectrumSettings = spectrumSettingsKey();
	if (spectrumSettings !== lastSpectrumSettings) {
		lastSpectrumSettings = spectrumSettings;
		spectrum = spectrumParameters();
		spectrumDirty = true;
	}

	// skip the entire pass while rebuild is in flight
    if (resolutionRebuildPending) return;

	updateRefraction();
	gatherRocks();

	//redirectWindDirectionTemp();	//just for testing wave redirection from CPU side

	if(waterPipelineUpdateFlag) {
		recreateWaterPipeline(waterPipelineTopologyType)
		waterPipelineUpdateFlag = false;
	}

	// Start a compute pass place and animate the instances
	waterComputeBuffersUpdate(uniformBufferComputeWaterPreMesh);

	// the waves' clock on by the real time since the last frame (no more than a tenth of a second of it)
	const stepNow = performance.now();
	const stepBy = Math.min((stepNow - lastStepTime) / 1000, 0.1) * WAVE_STEPS_A_SECOND;
	lastStepTime = stepNow;
	step += stepBy;
	foamKeep = Math.pow(0.5, stepBy / FOAM_HALF_LIFE);
	// a new seed: the same grid drawn again (net.js may have changed it to the host's)
	if (settings.waterSeed !== noiseSeed && waveNoiseBuffer) {
		noiseSeed = settings.waterSeed;
		device.queue.writeBuffer(waveNoiseBuffer, 0, gaussianNoise(settings.waterCascadeResolution, CASCADE_COUNT));
		spectrumDirty = true;
	}
	writeCascadeUniforms();

	// everything the water does in a frame goes in this one encoder, and is sent off in one submit at the end (see waterIFFT)
	const aEncoder = device.createCommandEncoder();
	const res = settings.waterCascadeResolution;
	const stages = Math.log2(res);
	const fftDispatch = res / FFT_WORKGROUP_SIZE[0];

	//initial spectrum h0(k) and conj(h0(-k)), and the twiddle factors. Only when the settings or the resolution have changed
	if (spectrumDirty) {
		const computeInitialHeightPass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Spectrum h0(k)', 'c_spectrum') });
		computeInitialHeightPass.setPipeline(waterSpectrumComputePipeline);
		for (let c = 0; c < CASCADE_COUNT; c++) {
			computeInitialHeightPass.setBindGroup(0, createCompBindGroupSpectrumWater(c));
			computeInitialHeightPass.dispatchWorkgroups(fftDispatch, fftDispatch);
		}
		computeInitialHeightPass.end();

		const computePreCompPass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Twiddle Precompute', 'c_PreComp') });
		computePreCompPass.setPipeline(waterButterflyPreCompComputePipeline);
		computePreCompPass.setBindGroup(0, createCompBindGroupButterflyPreCompWater());
		computePreCompPass.dispatchWorkgroups(stages / PRECOMP_WORKGROUP_SIZE[0], res / PRECOMP_WORKGROUP_SIZE[1]);
		computePreCompPass.end();

		spectrumDirty = false;
	}

	//hkt: every cascade animated to this frame's time, straight into the butterfly passes' first buffer
	const computeHKTPass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Realization h(k,t)', 'c_hkt') });
	computeHKTPass.setPipeline(waterRealizationComputePipeline);
	for (let c = 0; c < CASCADE_COUNT; c++) {
		computeHKTPass.setBindGroup(0, createCompBindGroupRealizationWater(c));
		computeHKTPass.dispatchWorkgroups(fftDispatch, fftDispatch);
	}
	computeHKTPass.end();

	//-----------------------------IFFT-------------------------------
	waterIFFT(aEncoder, stages);

	// out of the buffer into the maps the mesh pass reads
	const computeWaveMapsPass = aEncoder.beginComputePass({ timestampWrites: profiler.timestamps('Wave Maps', 'c_waveMaps') });
	computeWaveMapsPass.setPipeline(waterWaveMapsComputePipeline);
	for (let c = 0; c < CASCADE_COUNT; c++) {
		computeWaveMapsPass.setBindGroup(0, createCompBindGroupWaveMapsWater(c));
		computeWaveMapsPass.dispatchWorkgroups(fftDispatch, fftDispatch);
	}
	computeWaveMapsPass.end();


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

	// the surface where anything floating on it asked (boat.js)
	const probesSent = probeWater(aEncoder, waterComputeUniformBuffers[Math.floor(tileOffsets.length / 2)]);
	
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
	if (probesSent) {
		readProbesBack(probesSent);
	}
}