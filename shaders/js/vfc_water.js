import { settings } from '../../code/settings.js';

export const WATER_WORKGROUP_SIZE = [32, 1, 1];
export const FFT_WORKGROUP_SIZE = [8, 8, 1];
export const PRECOMP_WORKGROUP_SIZE = [1, 8, 1];

export const c_water = 
`
	struct WaterSpaces
	{
		modelViewProjectionMatrix : mat4x4f,
	}
	@group(0) @binding(0) var<uniform> Spaces: WaterSpaces;
	
	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveSteepness: f32,	
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
		@location(5) planeYPos: f32,
		@location(6) waveLength: f32,
		@location(7) oceanPlanePhysicalSize: f32,
		@location(8) windSpeed: f32,
	};
	@group(0) @binding(1) var<uniform> WU: WaterUniforms;
	
	
	//remember hidden padding, just use this struct for math and variables
	//	kept as vec4f to do matrix mult easier
	struct Vertex {
		pos: vec4f,
		uv: vec2f,
		norm: vec4f,
	};
	
	@group(0) @binding(2) var<storage, read_write> waterVertexData: array<f32>;
	@group(0) @binding(3) var<storage, read_write> waterIndexData: array<u32>;
	
	@group(0) @binding(4) var finalWaveHeightTexture : texture_storage_2d<rgba32float, read>;

fn gerstnerWave(position: vec3f, waveLength: f32, waveSteepness: f32, windDirection: vec2f, step: f32) -> vec3f {
		let k = (2 * 3.14) / waveLength;     		// Wave number
		let A = waveSteepness / k;;       			// Amplitude
		let c = sqrt(9.81/k);						// Speed, based on gravity constant and wave number
		let omega = k * c;   						// Angular frequency
		let normWaveDir = normalize(windDirection);	// Wave Direction Normalized
		let time = WU.step * 0.01;  				// Current time adjusted to a hundreth	
	
		//Gerstners
		let f = k * (dot(normWaveDir, position.xz) - c * time);
		let new_x = position.x + (normWaveDir.x * (A * cos(f)));
	    let new_z = position.z + (normWaveDir.y * (A * cos(f)));
		let new_y = position.y + (A * sin(f));
		
		return vec3f(new_x, new_y, new_z);
}

@compute @workgroup_size(${WATER_WORKGROUP_SIZE[0]}, ${WATER_WORKGROUP_SIZE[1]}, ${WATER_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		
		var gIndex = GlobalIvocationID.x;
		
		//------------------------------FORM GRID-------------------------------
		
		let fPerVertexData = u32(3 + 2 + 3);
	
		let gridWidth = u32(WU.resolution);
		
		let vertGridPosX = f32(gIndex) % f32(gridWidth);
		let vertGridPosZ = f32(gIndex) / f32(gridWidth);
		
		let oVertInd = gIndex * fPerVertexData;
		
		//------------------[REALISTIC] FFT Oceanographic Waves-----------------
		
		//just for now, only x as height
		var waveHeight = textureLoad(finalWaveHeightTexture, vec2u(u32(vertGridPosX), u32(vertGridPosZ))).x;
		
		//Taking Depth into account
		let attenuation = 1.0; //0.0 to 1.0 from shallow to full depth
		let rippleScale = 0.2;  // depends on wave magnitude. Ripples will be "spikey", this decides shallow water ripple height
								//		typically its a percent of wave at full height. so 0.1 to 0.3 is good for approachin shallows
								//		while >1.0 is bigger than regular waves
								//		perhaps just tie this with attenutation for depth
		let shallowFactor = 1.0 - attenuation;
		let deepDisplacement = waveHeight * attenuation;
		
		// boost high freq detail by exaggerating deviation from local mean
		// squaring preserves sign and amplifies peaks/troughs
		let rippleDetail = sign(waveHeight) * (waveHeight * waveHeight) * shallowFactor * rippleScale;
		var waveHeightAdj = (deepDisplacement + rippleDetail) + WU.planeYPos;
		
		//var waveHeightAdj = (waveHeight * 1.5) + WU.planeYPos;	//old general multiplier for height
		
		var position = vec3f(vertGridPosX,
							 waveHeightAdj,
							 vertGridPosZ);
	
		waterVertexData[oVertInd + 0] = position.x;
		waterVertexData[oVertInd + 1] = position.y;
		waterVertexData[oVertInd + 2] = position.z;
		waterVertexData[oVertInd + 3] = 0.5;
		waterVertexData[oVertInd + 4] = 0.5;
		waterVertexData[oVertInd + 5] = 0;
		waterVertexData[oVertInd + 6] = 0;
		waterVertexData[oVertInd + 7] = 1;
		
		
		//--------------------FORM TRIANGLES IN INDEX BUFFER---------------------
		// Generate triangles: use the grid to form triangles between four points
		let gridIndexX = f32(gIndex) % f32(gridWidth);
		let gridIndexZ = f32(gIndex) / f32(gridWidth);
	
		// For each square, define two triangles
		if (gridIndexX < f32(gridWidth - 1) && gridIndexZ < f32(gridWidth - 1)) {
			let baseIndex = gIndex;
	
			// First triangle (bottom-left, top-left, bottom-right)
			waterIndexData[gIndex * 6 + 0] = baseIndex;
			waterIndexData[gIndex * 6 + 1] = baseIndex + 1;
			waterIndexData[gIndex * 6 + 2] = baseIndex + gridWidth;
	
			// Second triangle (bottom-right, top-left, top-right)
			waterIndexData[gIndex * 6 + 3] = baseIndex + gridWidth;
			waterIndexData[gIndex * 6 + 4] = baseIndex + 1;
			waterIndexData[gIndex * 6 + 5] = baseIndex + gridWidth + 1;
		}
		
	}
`;

export const c_Shift =
`
	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveSteepness: f32,	
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
		@location(5) planeYPos: f32,
		@location(6) waveLength: f32,
		@location(7) oceanPlanePhysicalSize: f32,
		@location(8) windSpeed: f32,
	};
	@group(0) @binding(0) var<uniform> WU: WaterUniforms;

	@group(0) @binding(1) var inTexture : texture_storage_2d<rgba32float, read>;
	@group(0) @binding(2) var outTexture : texture_storage_2d<rgba32float, write>;
	

	@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		var gIndex = GlobalInvocationID;
		var val = textureLoad(inTexture, gIndex.xy);
		let N2 = WU.resolution;																		// THIS HAS TO BE POWER OF TWO REPLACE ONCE DONE TESTING!!!!!!!!
		
		//permute and scale
		var permute = val * (1.0 - 2.0 * f32((gIndex.x + gIndex.y) % 2u));
		
		//checkerboard style
		//var permute = vec4f(0.,0.,0.,0.);
		//if ((gIndex.x + gIndex.y) % 2u == 0) {
		//	permute = val;
		//} else {
		//	permute = -val;
		//}
		
		textureStore(outTexture, gIndex.xy, vec4f(permute.x / N2, permute.x / N2, permute.x / N2, 1.0));
	}
`;


export const c_IFFT_2D =
`
	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveSteepness: f32,	
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
		@location(5) planeYPos: f32,
		@location(6) waveLength: f32,
		@location(7) oceanPlanePhysicalSize: f32,
		@location(8) windSpeed: f32,
	};
	@group(0) @binding(0) var<uniform> WU: WaterUniforms;
	
	//@group(0) @binding(1) var inTexture : texture_2d<f32>;
	//@group(0) @binding(2) var outTexture : texture_storage_2d<rgba32float, write>;
	
	@group(0) @binding(1) var<storage, read_write> pingPongA: array<f32>;
	@group(0) @binding(2) var<storage, read_write> pingPongB: array<f32>;
	
	struct ButterflyUniforms {
		@location(0) direction: f32,
		@location(1) stage: f32,
		@location(2) pingPong: f32,
		
		@location(3) padding0: f32,
	};
	@group(0) @binding(3) var<uniform> BU: ButterflyUniforms;

	@group(0) @binding(4) var preCompTexture : texture_storage_2d<rgba32float, read>;

	fn complexMul(a: vec2f, b: vec2f) -> vec2f {
		return vec2f(
			a.x * b.x - a.y * b.y,
			a.x * b.y + a.y * b.x
		);
	}
	
	fn complexConj(z: vec2f) -> vec2f {
		return vec2f(z.x, -z.y);
	}
	
	fn complexAdd(a: vec2f, b: vec2f) -> vec2f {
		return vec2f(a.x + b.x, a.y + b.y);
	}
	
	fn complexSub(a: vec2f, b: vec2f) -> vec2f {
		return vec2f(a.x - b.x, a.y - b.y);
	}
	
	fn complexExp(a: vec2f) -> vec2f {
		return vec2f(cos(a.y), sin(a.y)) * exp(a.x);
	}

	@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		
		var gIndex = GlobalInvocationID.xy;
		
		// Determine which direction to process (horizontal or vertical)
		let direction = BU.direction;
		let res = u32(WU.resolution);
		
		if (BU.direction == 0.0) {
			// Horizontal pass (IFFT along rows)
			
			let preCompData = textureLoad(preCompTexture, vec2u(u32(BU.stage), gIndex.x));
			let inputIndices = vec2u(u32(preCompData.z), u32(preCompData.w));
			
			if(BU.pingPong == 0.0) {
				// Load data from input texture (real and imaginary parts of h0k)
				//let a = textureLoad(inTexture, vec2u(inputIndices.x, gIndex.y),0).xy;
				//let b = textureLoad(inTexture, vec2u(inputIndices.y, gIndex.y),0).xy;
				
				let a = vec2f(pingPongA[(gIndex.y * res + inputIndices.x) * 2 + 0], pingPongA[(gIndex.y * res + inputIndices.x) * 2 + 1]);
				let b = vec2f(pingPongA[(gIndex.y * res + inputIndices.y) * 2 + 0], pingPongA[(gIndex.y * res + inputIndices.y) * 2 + 1]);
				
				// Perform FFT butterfly operation (we could swap this depending on the FFT stage)		
				let p = vec2f(a.x, a.y);
				let q = vec2f(b.x, b.y);
				let w = vec2f(preCompData.x, preCompData.y);
				let result = complexAdd(p, complexMul(w,q));
				
				// Store the result back into the output texture
				//textureStore(outTexture, gIndex.xy, vec4f(result.x, result.y, 0.0, 1.0));
				pingPongB[(gIndex.y * res + gIndex.x) * 2 + 0] = result.x;
				pingPongB[(gIndex.y * res + gIndex.x) * 2 + 1] = result.y;
				
			} else {
				// Load data from input texture (real and imaginary parts of h0k)
				//let a = textureLoad(inTexture, vec2u(inputIndices.x, gIndex.y),0).xy;
				//let b = textureLoad(inTexture, vec2u(inputIndices.y, gIndex.y),0).xy;
				
				let a = vec2f(pingPongB[(gIndex.y * res + inputIndices.x) * 2 + 0], pingPongB[(gIndex.y * res + inputIndices.x) * 2 + 1]);
				let b = vec2f(pingPongB[(gIndex.y * res + inputIndices.y) * 2 + 0], pingPongB[(gIndex.y * res + inputIndices.y) * 2 + 1]);
				
				// Perform FFT butterfly operation (we could swap this depending on the FFT stage)		
				let p = vec2f(a.x, a.y);
				let q = vec2f(b.x, b.y);
				let w = vec2f(preCompData.x, preCompData.y);
				let result = complexAdd(p, complexMul(w,q));
				
				// Store the result back into the output texture
				//textureStore(outTexture, gIndex.xy, vec4f(result.x, result.y, 0.0, 1.0));
				pingPongA[(gIndex.y * res + gIndex.x) * 2 + 0] = result.x;
				pingPongA[(gIndex.y * res + gIndex.x) * 2 + 1] = result.y;
				
			}
			
		} else {
			// Vertical pass (IFFT along columns)
				
			let preCompData = textureLoad(preCompTexture, vec2u(u32(BU.stage), gIndex.y));
			let inputIndices = vec2u(u32(preCompData.z), u32(preCompData.w));
			
			if(BU.pingPong == 0.0) {
				// Load data from input texture (real and imaginary parts of h0k)
				//let a = textureLoad(inTexture, vec2u(gIndex.x, inputIndices.x),0).xy;
				//let b = textureLoad(inTexture, vec2u(gIndex.x, inputIndices.y),0).xy;
				
				let a = vec2f(pingPongA[(inputIndices.x * res + gIndex.x) * 2 + 0], pingPongA[(inputIndices.x * res + gIndex.x) * 2 + 1]);
				let b = vec2f(pingPongA[(inputIndices.y * res + gIndex.x) * 2 + 0], pingPongA[(inputIndices.y * res + gIndex.x) * 2 + 1]);
	
				// Perform FFT butterfly operation (we could swap this depending on the FFT stage)
				let p = vec2f(a.x, a.y);
				let q = vec2f(b.x, b.y);
				let w = vec2f(preCompData.x, preCompData.y);
				let result = complexAdd(p, complexMul(w,q));
				
				// Store the result back into the output texture
				//textureStore(outTexture, gIndex.xy, vec4f(result.x, result.y, 0.0, 1.0));
				pingPongB[(gIndex.y * res + gIndex.x) * 2 + 0] = result.x;
				pingPongB[(gIndex.y * res + gIndex.x) * 2 + 1] = result.y;
				
			} else {
				// Load data from input texture (real and imaginary parts of h0k)
				//let a = textureLoad(inTexture, vec2u(gIndex.x, inputIndices.x),0).xy;
				//let b = textureLoad(inTexture, vec2u(gIndex.x, inputIndices.y),0).xy;
				
				let a = vec2f(pingPongB[(inputIndices.x * res + gIndex.x) * 2 + 0], pingPongB[(inputIndices.x * res + gIndex.x) * 2 + 1]);
				let b = vec2f(pingPongB[(inputIndices.y * res + gIndex.x) * 2 + 0], pingPongB[(inputIndices.y * res + gIndex.x) * 2 + 1]);
	
				// Perform FFT butterfly operation (we could swap this depending on the FFT stage)
				let p = vec2f(a.x, a.y);
				let q = vec2f(b.x, b.y);
				let w = vec2f(preCompData.x, preCompData.y);
				let result = complexAdd(p, complexMul(w,q));
				
				// Store the result back into the output texture
				//textureStore(outTexture, gIndex.xy, vec4f(result.x, result.y, 0.0, 1.0));
				pingPongA[(gIndex.y * res + gIndex.x) * 2 + 0] = result.x;
				pingPongA[(gIndex.y * res + gIndex.x) * 2 + 1] = result.y;
			}
		}
	}
`;

export const c_ArrayToTexture =
`
	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveSteepness: f32,	
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
		@location(5) planeYPos: f32,
		@location(6) waveLength: f32,
		@location(7) oceanPlanePhysicalSize: f32,
		@location(8) windSpeed: f32,
	};
	@group(0) @binding(0) var<uniform> WU: WaterUniforms;
	
	@group(0) @binding(1) var<storage, read_write> inArray: array<f32>;
	@group(0) @binding(2) var outTexture : texture_storage_2d<rgba32float, write>;

	@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		let gIndex = GlobalInvocationID.xy;	
				
		let singleDimensionIndex = gIndex.y * u32(WU.resolution) + gIndex.x;	//so this is going row by row, make sure the parsing matches in FFT
		
		textureStore(outTexture, gIndex.xy, vec4f(inArray[singleDimensionIndex * 2 + 0], inArray[singleDimensionIndex * 2 + 1], 0.0, 1.0));
	}
`;

export const c_RealizationToArray =
`
	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveSteepness: f32,	
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
		@location(5) planeYPos: f32,
		@location(6) waveLength: f32,
		@location(7) oceanPlanePhysicalSize: f32,
		@location(8) windSpeed: f32,
	};
	@group(0) @binding(0) var<uniform> WU: WaterUniforms;
	
	@group(0) @binding(1) var inTexture : texture_storage_2d<rgba32float, read>;
	@group(0) @binding(2) var<storage, read_write> outArray: array<f32>;

	@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		let gIndex = GlobalInvocationID.xy;	
		
		let pull = textureLoad(inTexture, gIndex);
		
		let singleDimensionIndex = gIndex.y * u32(WU.resolution) + gIndex.x;	//so this is going row by row, make sure the parsing matches in FFT
		
		outArray[singleDimensionIndex * 2 + 0] = pull.x;	//real
		outArray[singleDimensionIndex * 2 + 1] = pull.y;	//imaginary
	}
`;

export const c_PreComp =
`
	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveSteepness: f32,	
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
		@location(5) planeYPos: f32,
		@location(6) waveLength: f32,
		@location(7) oceanPlanePhysicalSize: f32,
		@location(8) windSpeed: f32,
	};
	@group(0) @binding(0) var<uniform> WU: WaterUniforms;

	@group(0) @binding(1) var preCompTexture : texture_storage_2d<rgba32float, write>;
			
	struct ButterflyUniforms {
		@location(0) direction: f32,
		@location(1) stage: f32,	
	};
	@group(0) @binding(2) var<uniform> BU: ButterflyUniforms;
	
	@group(0) @binding(3) var<storage, read_write> bitReversedIndices: array<f32>;

	
	fn complexExp(a: vec2f) -> vec2f {
		return vec2f(cos(a.y), sin(a.y)) * exp(a.x);
	}
	
	fn bitReverse(n: u32, bits: u32) -> u32 {
		var reversed: u32 = 0u;
		var i: u32 = 0u;
		var r = n;
		while (i < bits) {
			reversed = (reversed << 1u) | (r & 1u);  // Shift reversed and OR with the lowest bit of n
			r = r >> 1u;  // Shift n to the right
			i = i + 1u;
		}
		return reversed;
	}
	
	fn uncenterIndex(index: u32, resolution: u32) -> u32 {
		let half = resolution / 2u;
		return (index + half) % resolution;
	}

	@compute @workgroup_size(${PRECOMP_WORKGROUP_SIZE[0]}, ${PRECOMP_WORKGROUP_SIZE[1]}, ${PRECOMP_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalInvocationID: vec3<u32>
	) {
		var gIndex = vec2i(i32(GlobalInvocationID.x), i32(GlobalInvocationID.y));	//x is by num stages, y is by full resolution
		var k = (f32(gIndex.y) * (WU.resolution / pow(2.0, f32(gIndex.x) + 1.0))) % WU.resolution;
		var twiddle = vec2f(cos((2.0 * 3.14159 * k) / WU.resolution), 
							-sin((2.0 * 3.14159 * k) / WU.resolution));	//maybe this isnt negative
		var butterflySpan = pow(2.0, f32(gIndex.x));
		var butterflyWing = 0u;
		
		let stageSize = 1u << u32(gIndex.x);        // 2^stage
		let stageSize2 = stageSize << 1u;      // 2^(stage + 1)
		
		if ((u32(gIndex.y) % stageSize2) < stageSize) {
			butterflyWing = 1u;
		}
		
		if(gIndex.x == 0) {
			if(butterflyWing == 1u) {
				textureStore(preCompTexture, vec2i(gIndex.x, gIndex.y), vec4f(twiddle.x, twiddle.y, bitReversedIndices[gIndex.y], bitReversedIndices[gIndex.y + 1]));
			} else {
				textureStore(preCompTexture, vec2i(gIndex.x, gIndex.y), vec4f(twiddle.x, twiddle.y, bitReversedIndices[gIndex.y - 1], bitReversedIndices[gIndex.y]));
			}
			
		} else {
			if(butterflyWing == 1u) {
				textureStore(preCompTexture, vec2i(gIndex.x, gIndex.y), vec4f(twiddle.x, twiddle.y, f32(gIndex.y), f32(gIndex.y) + butterflySpan));
			} else {
				textureStore(preCompTexture, vec2i(gIndex.x, gIndex.y), vec4f(twiddle.x, twiddle.y, f32(gIndex.y) - butterflySpan, f32(gIndex.y)));
			}
		}
		
		
		//var gIndex = GlobalInvocationID;	//x is by num stages, y is by full resolution
		//var yIndex = 0u;
		//let res = u32(WU.resolution);
		//let shiftedIndex = uncenterIndex(gIndex.y, res);
		//if(gIndex.x == 0) {
		//	yIndex = bitReverse(shiftedIndex, u32(log2(f32(res))));
		//} else {
		//	yIndex = shiftedIndex;
		//}
		//		
		////based on "Realtime GPGPU FFT  Ocean Water Simulation" by Fynn-Jorin Flügge
		//let span = 1u << gIndex.x;
		//let twiddleK = (yIndex % span);
		//let theta = 2.0 * 3.14159 * f32(twiddleK) / f32(span * 2u);
		//let twiddle = vec2f(cos(theta), -sin(theta));		//positive sin for fft, neg for ifft
		//
		//let stageSize = span * 2u;
		//let group = yIndex / stageSize;
		//let offset = yIndex % span;
		//
		//let a = group * stageSize + offset;
		//let b = a + span;
		//
		//textureStore(preCompTexture, vec2u(gIndex.x, a), vec4f(twiddle.x, twiddle.y, f32(a), f32(b)));
		//textureStore(preCompTexture, vec2u(gIndex.x, b), vec4f(-twiddle.x, -twiddle.y, f32(a), f32(b)));
	}
`;

export const c_hkt =
`
	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveSteepness: f32,	
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
		@location(5) planeYPos: f32,
		@location(6) waveLength: f32,
		@location(7) oceanPlanePhysicalSize: f32,
		@location(8) windSpeed: f32,
	};
	@group(0) @binding(0) var<uniform> WU: WaterUniforms;
	
	@group(0) @binding(1) var initialHeightField : texture_storage_2d<rgba32float, read>;
	@group(0) @binding(2) var waveHeightRealization : texture_storage_2d<rgba32float, write>;

fn complexMul(a: vec2f, b: vec2f) -> vec2f {
    return vec2f(
        a.x * b.x - a.y * b.y,
        a.x * b.y + a.y * b.x
    );
}

fn complexConj(z: vec2f) -> vec2f {
    return vec2f(z.x, -z.y);
}


@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		
		var gIndex = GlobalIvocationID.xy;
		let gridWidth = u32(WU.resolution);
		let vertGridPosX = gIndex.x;
		let vertGridPosZ = gIndex.y;
			
		// vector fields with e^it
		// https://www.youtube.com/watch?v=v0YEaeIClKY
		// e : eulers number (2.7...)
		// i : sqrt(-1), will take this 1D equation and create orthogonal vector of velocity, velocity WILL be 90deg of that position
		// t : time
		// e^it = cosx + isinx    this is how we remove the sin and cos that gerstners rely on
		
		//tessendorf paper
		//	the test parameters are ones from section 3.5
		//https://people.computing.clemson.edu/~jtessen/reports/papers_files/coursenotes2002.pdf
		let e = f32(2.71828);		// eulers num, but the "exp(f32 x)" function does e^x 
		let pi = f32(3.14159);		//PI
		let g = f32(9.18);			//grav constant
		
		//"waveheight is a random variable of horizontal position and time, h(x,t)"
		// wave number = grid point number
		// Lx and Lz are the actually lengths in meters of the patch
		// discrete sample points is the WU.resolution
		
		let oceanSizeL = WU.oceanPlanePhysicalSize;	//the size of the tile, what to scale the grid by
		let deltaK = ((2.0 * pi) / oceanSizeL);
		let kx = deltaK * (f32(vertGridPosX) - (WU.resolution / 2.0));
		let ky = deltaK * (f32(vertGridPosZ) - (WU.resolution / 2.0));
		let k = vec2f(kx, ky);	
											
		let D = 1.0;
		
		let w2 = g * length(k);				//frequency squared, infinite depth
		
		//THE BELOW IS FOR WAVE SPEED (FREQUENCY) NOT HEIGHT
		//let w2 = g * length(k) * tan(length(k) * D);			//frequency squared, adjusted for depth
		//let w2 = g * k * (1 + (k * k) * (LS * LS));		//frequency squared, but for small waves < 1cm
		
		let w = sqrt(w2);
		
		let h0Data = textureLoad(initialHeightField, vec2u(u32(vertGridPosX), u32(vertGridPosZ)));
		let h0k = h0Data.xy;
		let h0NegkConj = h0Data.zw;
		
		let t = WU.step;
		let cos_wt = cos(w * t);
		let sin_wt = sin(w * t);
	
		let exponent = vec2f(cos_wt, sin_wt);      // e^{iωt}
		let exponent_inv = vec2f(cos_wt, -sin_wt);	//it is supposed to be the H0-k conjugate multiplied by inverse exp
		
		let term1 = complexMul(h0k, exponent);
		let term2 = complexMul(h0NegkConj, exponent_inv);
		
		let hkt = term1 + term2;
		
		//DEBUG, visualizing hKt directly will show an inward collapse, this is how hKt is supposed to workgroup_size
		//			the waveHeightRealization should actually be hXt.  
		
		textureStore(waveHeightRealization, vec2u(u32(vertGridPosX), u32(vertGridPosZ)), vec4f(hkt.x, hkt.y,0.0,1.0));
	}
`;


export const c_h0kConj =
`
	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveSteepness: f32,	
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
		@location(5) planeYPos: f32,
		@location(6) waveLength: f32,
		@location(7) oceanPlanePhysicalSize: f32,
		@location(8) windSpeed: f32,
	};
	@group(0) @binding(0) var<uniform> WU: WaterUniforms;
	
	@group(0) @binding(1) var inH0KTexture : texture_storage_2d<rgba32float, read>;
	@group(0) @binding(2) var initialHeightField : texture_storage_2d<rgba32float, write>;

	fn complexConj(z: vec2f) -> vec2f {
		return vec2f(z.x, -z.y);
	}

@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		
		var gIndex = GlobalIvocationID.xy;
		let res = u32(WU.resolution);
		
		let data = textureLoad(inH0KTexture, gIndex);
		let h0NegkConj = complexConj(data.zw);
		textureStore(initialHeightField, gIndex, vec4f(data.x, data.y, h0NegkConj.x, h0NegkConj.y));
		
		
		//let negIndices = vec2u((u32(WU.resolution) - gIndex.x) % u32(WU.resolution), 
		//						(u32(WU.resolution) - gIndex.y) % u32(WU.resolution));
		//let h0k = textureLoad(inH0KTexture, gIndex).xy;
		//let h0NegkConj = complexConj(textureLoad(inH0KTexture, negIndices).xy);
		//
		////final
		//textureStore(initialHeightField, gIndex, vec4f(h0k.x, h0k.y, h0NegkConj.x, h0NegkConj.y));
		
		
		//debug CONJ SYM test, if we see blue, we fail
		//let h0k = textureLoad(inH0KTexture, gIndex).xy;
		//let h0Negk = textureLoad(inH0KTexture, vec2u((res - gIndex.x) % res, (res - gIndex.y) % res)).xy;
		//let h0kConj = complexConj(h0k);
		//
		//let epsilon = 0.0001;
		//let isEqual = abs(h0Negk.x - h0kConj.x) < epsilon && abs(h0Negk.y - h0kConj.y) < epsilon;
		//let blue = select(1.0, 0.0, isEqual); // 1.0 = fail, 0.0 = pass
		//textureStore(initialHeightField, gIndex, vec4f(0, 0, blue, 1));
	}
`;


export const c_h0k =
`
	struct WaterUniforms {
		@location(0) cameraPosition: vec4f,
		@location(1) windDirection: vec2f,
		@location(2) resolution: f32,			//the resolution of the plane is fixed, however, converge closer to camera position
		@location(3) waveSteepness: f32,	
		@location(4) step: f32,					//to be used in place of time, but locked to frame rate i suppose
		@location(5) planeYPos: f32,
		@location(6) waveLength: f32,
		@location(7) oceanPlanePhysicalSize: f32,
		@location(8) windSpeed: f32,
	};
	@group(0) @binding(0) var<uniform> WU: WaterUniforms;
	
	@group(0) @binding(1) var phillipsSpectrumOutTexture : texture_storage_2d<rgba32float, write>;
	@group(0) @binding(2) var outH0KTexture : texture_storage_2d<rgba32float, write>;
	
	@group(0) @binding(3) var<storage, read_write> complexGaussArray: array<f32>;

	fn complexAdd(a: vec2f, b: vec2f) -> vec2f {
		return vec2f(a.x + b.x, a.y + b.y);
	}
	
	fn complexMul(a: vec2f, b: vec2f) -> vec2f {
		return vec2f(
			a.x * b.x - a.y * b.y,
			a.x * b.y + a.y * b.x
		);
	}
	
	fn complexConj(z: vec2f) -> vec2f {
		return vec2f(z.x, -z.y);
	}
	

fn phillipsSpectrum(kx: f32, ky: f32) -> f32 {
	let pi = f32(3.14159);		//PI
	let g = f32(9.18);			//grav constant
	
	//"waveheight is a random variable of horizontal position and time, h(x,t)"
	// wave number = grid point number
	// Lx and Lz are the actually lengths in meters of the patch
	// discrete sample points is the WU.resolution
	
	let K = vec2f(kx, ky);		//GRID OF WAVE VECTORS
	
	var kMag = length(K);			// italic k, magnitude
	if(kMag < 0.0001) {		//avoid blowout
		kMag = 0.0001;		//allowing the kMag at a minimum means the top row of the texture and left column will contain noise
	}
	
	

	//check for kx, kz, w
	//let w2 = g * length(k);
	//let w = sqrt(w2);
	//textureStore(outH0KTexture, vec2u(u32(vertGridPosX), u32(vertGridPosZ)), vec4f(kx,ky,w,1.0));
	
	
	//phillips spectrum
	// These slides also help: https://www.cs.ubc.ca/~rbridson/courses/533d-winter-2005/cs533d-slides-mar9.pdf
	
	let V = WU.windSpeed; 			//wind speed, i made this up
	let L = (V * V) / g;	//largest possible waves from a continuous wind
	let Lmin = 0.01;			//minimum wavelength in meters
	let kLmin2 = (kMag * Lmin) * (kMag * Lmin);
	let A = 10.0;			//"a numeric constant" ???
	
	let kHat = normalize(K); //vec2f(K.x / kMag, K.y / kMag);		// hat k, unit vector
	let wHat = normalize(WU.windDirection);			// hat w, wind direction, normalized input just incase
	let kHwH = dot(kHat, wHat);						// hat k dot hat w 
	let kHwHX = kHwH * kHwH; 						//RAISING THIS X TIMES INCREASES WIND INFLUENCE MORE
	let kMagLSqr = (kMag * L) * (kMag * L);			
	var kMagDenomX = kMag * kMag * kMag * kMag;		//4 is standard ill use 2
	//kMag4 = max(kMag4, 0.1);
	
	var PhK = 0.0;
	if(kMag != 0.0) {
		//dont divide by 0
		//PhK = A * (exp(-1.0 / kL2) * supression /  k4) * kw6;
		//PhK = A * (1.0 / k4) * exp((-1.0 / kL2) - kLmin2) * (kw * kw);
		
		PhK = A * (exp(-1.0 / kMagLSqr) / kMagDenomX) * kHwHX;
		PhK *= exp(-kLmin2);	//high freq supression (avoiding spikes)
	}
	
	return PhK;
}

fn h0(vertGridPosX: u32, vertGridPosZ: u32) {
	
	//BEST PAGE for all of this
	//https://barthpaleologue.github.io/Blog/posts/ocean-simulation-webgpu/#:~:text=Okay%2C%20so%20we%20need%20a,w%5E=%E2%88%A3w%E2%88%A3w
	
	let pi = f32(3.14159);
	
	let oceanSizeL = WU.oceanPlanePhysicalSize;	//the size of the tile, what to scale the grid by
	let deltaK = ((2.0 * pi) / oceanSizeL);
	let kx = deltaK * (f32(vertGridPosX) - (WU.resolution / 2.0));
	let ky = deltaK * (f32(vertGridPosZ) - (WU.resolution / 2.0));
	
	var PhK = phillipsSpectrum(kx, ky);	
	
	//DEBUG
	// PhK = (cos(kx * 2.0) * cos(kx * 2.0) - sin(ky * 2.0) * sin(ky * 2.0));
	
	
	//THIS IS FOR DEBUG FOR NOW
	// this is a check to see for spikes
	let compressedDynamicRangePhk = sqrt(min(max(PhK, 0.01), 3000.0));
	textureStore(phillipsSpectrumOutTexture, vec2u(vertGridPosX, vertGridPosZ), vec4<f32>(compressedDynamicRangePhk,compressedDynamicRangePhk,compressedDynamicRangePhk,1.0));
	
	let index = vertGridPosX + u32(WU.resolution) * vertGridPosZ;
	let offset = index * 4u;
	let gauss = vec2f(complexGaussArray[offset], complexGaussArray[offset + 1u]);
	//let gauss = vec2f(1.0,1.0);
	
	//DEBUG NOISE
	//let gauss = vec2f(1.0,1.0);
	//var gcheck = length(gauss);
	//if(gcheck > 3.0) {
	//	textureStore(phillipsSpectrumOutTexture, vec2u(vertGridPosX, vertGridPosZ), vec4<f32>(1.,0.,0.,1.));
	//} else if (gcheck < -0.0) {
	//	textureStore(phillipsSpectrumOutTexture, vec2u(vertGridPosX, vertGridPosZ), vec4<f32>(0.,1.,0.,1.));
	//} else {
	//	textureStore(phillipsSpectrumOutTexture, vec2u(vertGridPosX, vertGridPosZ), vec4<f32>(length(gauss),length(gauss),length(gauss),1.0));
	//}
	
	let minClampVal = 0.0001;			//if PhK returns 0, or is wayyy too low, find this (reduces the 0 line split effect)
	let maxClampVal = 3000.0;
	var clampedPhK = sqrt(min(max(PhK, minClampVal), maxClampVal));
	let scale = (1.0 / sqrt(2.0));
	let h0k = scale * (gauss * clampedPhK);				//max is used incase PhK is 0, which sqrt(0) would be NaN

	//textureStore(outH0KTexture, vec2u(vertGridPosX, vertGridPosZ), vec4f(h0k.x, h0k.y,0.0,0.0));		// storing h0k
	
	//DEBUG check for random gauss
	//textureStore(outH0KTexture, vec2u(u32(vertGridPosX), u32(vertGridPosZ)), vec4(length(gauss), length(gaussNegK), 0.0,1.0));
	
	//let h0Negk = complexConj(h0k);
	//let negIndices = vec2u((u32(WU.resolution) - vertGridPosX ) % u32(WU.resolution), 
	//						(u32(WU.resolution) - vertGridPosZ ) % u32(WU.resolution));
	//
	//if(vertGridPosX > u32(WU.resolution) / 2u || 
	//	(vertGridPosX == u32(WU.resolution) / 2u && vertGridPosZ > u32(WU.resolution) / 2u)) {
	//	return;
	//}
	//
	//textureStore(outH0KTexture, negIndices, vec4f(h0Negk.x, h0Negk.y,0.0,0.0));
	
	//with Phillips -k
	let gaussNeg = vec2f(complexGaussArray[offset + 2u], complexGaussArray[offset + 3u]);
	//let gaussNeg = vec2f(1.0,1.0);
	var PhNegK = phillipsSpectrum(-kx, -ky);	
	var clampedPhNegK = sqrt(min(max(PhNegK, minClampVal), maxClampVal));
	let h0Negk = scale * (gaussNeg * clampedPhNegK);				//max is used incase PhK is 0, which sqrt(0) would be NaN
	textureStore(outH0KTexture, vec2u(vertGridPosX, vertGridPosZ), vec4f(h0k.x, h0k.y, h0Negk.x, h0Negk.y));
	
	
	//Just h0k Output
	//textureStore(outH0KTexture, vec2u(vertGridPosX, vertGridPosZ), vec4f(h0k.x, h0k.y,0.0,0.0));

	
}

@compute @workgroup_size(${FFT_WORKGROUP_SIZE[0]}, ${FFT_WORKGROUP_SIZE[1]}, ${FFT_WORKGROUP_SIZE[2]})	
    fn computeMain(
		@builtin(global_invocation_id) GlobalIvocationID: vec3<u32>
	) {
		
		var gIndex = GlobalIvocationID;
		
		//------------------------------FORM GRID-------------------------------
		let gridWidth = u32(WU.resolution);
		let vertGridPosX = gIndex.x;
		let vertGridPosZ = gIndex.y;
		
		//-----------------------------------
		h0(vertGridPosX, vertGridPosZ);
		
		
	}
`;

export const v_water =
`
	//TODO: remove this after the input from compute shader comes in!!!!!!!!!!!!!
	//			at that point, we wont have to do modelViewProjections at all, its just read already adjusted vertex data and output
	struct WaterUniforms 
	{
		modelViewProjectionMatrix : mat4x4f,
	}
	@group(0) @binding(0) var<uniform> UBO: WaterUniforms;
		
	struct VertexInput {
		@builtin(instance_index) instanceIdx : u32,
		@location(0) pos: vec3f,
		@location(1) uv: vec2f,
		@location(2) norm: vec3f,
	};
	
	struct VertexOutput {				//into frag
		@builtin(position) pos: vec4f,
		@location(0) fragUV: vec2f,
		@location(1) fragPos: vec4f,
		@location(2) fragNormal: vec3f,
		@location(3) pointInWave: f32,
	};
	
	@vertex
	fn vertexMain(input: VertexInput) -> VertexOutput {	
	
	var output: VertexOutput;
    output.pos = UBO.modelViewProjectionMatrix * vec4f(input.pos.x, input.pos.y, input.pos.z, 1.0);
    
	output.pointInWave = (input.pos.y + 16.0) * 0.045;	//hardcode, 16.0 is the -y pos of the plane
	
    output.fragPos = output.pos;
	output.fragNormal = input.norm;
    output.fragUV = input.uv;
    
    return output;
	}
`;

export const f_water =
`
	//same as vertexoutput without builtin bits
	struct FragInput {
		@location(0) fragUV: vec2f,
		@location(1) fragPos: vec4f,
		@location(2) fragNormal: vec3f,
		@location(3) pointInWave: f32,
	};

	fn lerp(a: vec4<f32>, b: vec4<f32>, t: f32) -> vec4<f32> {
		return a + t * (b - a);
	}	

	@fragment
	fn fragmentMain(input: FragInput) -> //could also use input: VertexOutput instead because its contained within the same file here
		@location(0) vec4f {
		
		let baseBlue = vec4f(0.486,0.486,0.788,1.0);
		let deepBlue = vec4f(0.125,0.125,0.451,1.0);
		let peakCrest = vec4f(0.957, 0.957, 0.969, 1.0);
		
		return vec4f(lerp(lerp(baseBlue, peakCrest, input.pointInWave), deepBlue, 1.0 - input.pointInWave).xyz, 1.0);
	}
`;
