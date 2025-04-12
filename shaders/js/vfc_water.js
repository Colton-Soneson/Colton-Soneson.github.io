import { settings } from '../../code/settings.js';

export const WATER_WORKGROUP_SIZE = [32, 1, 1];	//stick to 1 for now to get understanding

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
	
	@group(0) @binding(4) var phillipsSpectrumOutTexture : texture_storage_2d<rgba8unorm, write>;

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

fn gerstner(vertGridPosX: f32, vertGridPosZ: f32) -> vec3f {
	
		//---------------------WAVE EQUATION ON GRID POINTS----------------------
		//https://www.youtube.com/watch?v=kGEqaX4Y4bQ
		//https://catlikecoding.com/unity/tutorials/flow/waves/
	
		var position = vec3f(vertGridPosX, WU.planeYPos, vertGridPosZ);
		
		//LARGE ROLLING WAVES
		//wave A
		position = gerstnerWave(position, WU.waveLength, WU.waveSteepness, WU.windDirection, WU.step);

		//wave B
		position = gerstnerWave(position, 10.0, 0.2, vec2f(0.2,-0.3), WU.step * 1.2);
		
		//MEDIUM STEEP WAVE
		position = gerstnerWave(position, 5.0, 0.2, vec2f(0.0, 0.6), WU.step * 1.75);
		
		//SMALL STEEP WAVES
		//wave D
		position = gerstnerWave(position, 0.5, 0.8 / (position.y * 0.5), vec2f(-0.1,-0.4), WU.step * 2.0);
		
		//wave E
		position = gerstnerWave(position, 0.2, 0.6 / (position.y * 0.25), vec2f(0.5,0.1), WU.step * 3.0);
		
		return position;
}


fn FFT(vertGridPosX: f32, vertGridPosZ: f32) -> vec3f {
	
	//an FFTs are methods of rapid sum evaluation
	
	// vector fields with e^it
	// https://www.youtube.com/watch?v=v0YEaeIClKY
	// e : eulers number (2.7...)
	// i : sqrt(-1), will take this 1D equation and create orthogonal vector of velocity, velocity WILL be 90deg of that position
	// t : time
	// e^it = cosx + isinx    this is how we remove the sin and cos that gerstners rely on
	
	//tessendorf paper
	//https://people.computing.clemson.edu/~jtessen/reports/papers_files/coursenotes2002.pdf
	let e = f32(2.71828);		// eulers num, but the "exp(f32 x)" function does e^x 
	let pi = f32(3.14159);		//PI
	let g = f32(9.18);			//grav constant
	
	
	//let lambda = f32(0.0);		//wavelength
	//let k = (2 * pi) / lambda;	//wavevector
	//let D = f32(99999);			//water depth
	//let LS = f32(1.0);			//magnitude of surface tension effect
	//
	//let w2 = g * k;				//frequency squared, infinite depth
	//let w2_withDepth = g * k * tan(k * D);			//frequency squared, adjusted for depth
	//let w2_rippleWaves = g * k * (1 + (k * k) * (LS * LS));		//frequency squared, but for small waves < 1cm
	
	//"waveheight is a random variable of horizontal position and time, h(x,t)"
	// wave number = grid point number
	// Lx and Lz are the actually lengths in meters of the patch
	// discrete sample points is the WU.resolution
	
	let oceanSizeL = 100.0;	//the size of the tile, what to scale the grid by
	let kx = ((2.0 * pi) / oceanSizeL) * (vertGridPosX - (WU.resolution / 2.0));
	let ky = ((2.0 * pi) / oceanSizeL) * (vertGridPosZ - (WU.resolution / 2.0));
	let k = vec2f(kx, ky);	//THE WAVE VECTOR FOR OCEAN PATCH
	
	//phillips spectrum
	let V = 30.0; 			//wind speed, i made this up
	let L = (V * V) / g;	//largest possible waves from a continuous wind
	let A = 0.01;			//"a numeric constant" ???
	let wHat = normalize(WU.windDirection);	//wind direction
	let kHat = normalize(k);
	let kw = dot(kHat, wHat);
	let k4 = dot(k,k) * dot(k,k);
	
	var PS = 0.0;
	if(k4 != 0.0) {
		//dont divide by 0
		PS = A * (exp(-1.0 / dot(k * L, k * L))/  k4) * (kw * kw);
	}
	
	//THIS IS FOR DEBUG FOR NOW
	//	the "* 1e6" portion was done to give better visuals in debug mode, its suggested to do so. However I don't believe it should be done for the waves themselves.
	textureStore(phillipsSpectrumOutTexture, vec2u(u32(vertGridPosX), u32(vertGridPosZ)), vec4<f32>(PS * 1e6,0.0,0.0,1.0));

	var position = vec3f(0.0,0.0,0.0);
	
	
	
	return position;
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
		
		//-----------------------[BASIC] Gerstner Waves-------------------------
		//var position = gerstner(vertGridPosX, vertGridPosZ);
		
		//------------------[REALISTIC] FFT Oceanographic Waves-----------------
		var position = FFT(vertGridPosX, vertGridPosZ);
	
		
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
