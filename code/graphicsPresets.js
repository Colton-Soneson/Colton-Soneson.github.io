/*
	Graphics presets, and the check that picks one for the machine the page is running on.

	PRESETS		the settings each preset sets. High is the settings as they come (settings.js), the others step down and up from it.
				A preset only sets these: everything else is the user's, and choosing a preset leaves it alone

	Which preset to start on (detectStartingPreset)
		WebGPU says a little about the GPU: who made it and which generation it is (adapter.info, see deviceSelection.js), and
		whether it is a software stand-in. The browser says whether it is a phone. That is enough for a first guess and no more,
		so it is only where the check below starts. With nothing to go on it starts on Medium.

	The check (PresetCheck): a built in benchmark
		The frame rate is measured over a few seconds at a time, from when the GPU has finished each frame (not when it was sent:
		a GPU that is behind would look fast). Under MIN_FPS the preset goes down one and it measures again. It stops for good:
			- at GOOD_FPS or better: the preset is kept, and Preset Override is ticked
			- when the user ticks Preset Override, or picks a preset themselves
			- on the lowest preset: there is nowhere left to go
		Between the two it carries on measuring, so a preset that drops under MIN_FPS later (a storm, the forest) still steps down.
		The first seconds after the page loads or the preset changes are not counted: chunks, bakes and the forest are still being made.
		While the page is hidden the browser runs it at 1 frame a second, so nothing is counted then either.

		GOOD_FPS is 55, not 60: the main loop runs every 17 milliseconds (main.js), so 58.8 is the most it can ever do.
*/

export const PRESET_NAMES = ['very low', 'low', 'medium', 'high', 'ultra'];

export const PRESETS = {
	'very low': {
		terrainResolution: 512, terrainDetailDistance: 1.0, terrainFarBake: 128, terrainRockDetail: 0, terrainRockVeins: 0, terrainGroundDetail: 0,
		dynamicResolution: true,
		shadowMapPCFKernelSize: 0, enableScreenShadows: false, enableSSAO: false, enableSSR: false, enableLightShafts: false,
		antiAliasing: 'fxaa', anisotropicFiltering: 2,
		grassTotalBladeCount: 100000, grassDrawDistance: 250, grassLodRings: 3,
		forestDetailDistance: 25, forestMidDistance: 80, forestThinnedRings: 2, forestBillboardDistance: 220, forestDrawDistance: 2500,
		boulderDrawDistance: 800, waterTileResolution: 256, cloudSteps: 20, cloudDrawDistance: 20000,
	},
	'low': {
		terrainResolution: 1024, terrainDetailDistance: 1.0, terrainFarBake: 128, terrainRockDetail: 1, terrainRockVeins: 0, terrainGroundDetail: 1,
		dynamicResolution: true,
		shadowMapPCFKernelSize: 0, enableScreenShadows: true, enableSSAO: false, enableSSR: true, enableLightShafts: true,
		antiAliasing: 'fxaa', anisotropicFiltering: 4,
		grassTotalBladeCount: 200000, grassDrawDistance: 450, grassLodRings: 4,
		forestDetailDistance: 40, forestMidDistance: 120, forestThinnedRings: 2, forestBillboardDistance: 300, forestDrawDistance: 3500,
		boulderDrawDistance: 1500, waterTileResolution: 256, cloudSteps: 28, cloudDrawDistance: 26000,
	},
	'medium': {
		terrainResolution: 2048, terrainDetailDistance: 1.25, terrainFarBake: 128, terrainRockDetail: 1, terrainRockVeins: 1, terrainGroundDetail: 1,
		dynamicResolution: false,
		shadowMapPCFKernelSize: 1, enableScreenShadows: true, enableSSAO: true, enableSSR: true, enableLightShafts: true,
		antiAliasing: 'smaa', anisotropicFiltering: 8,
		grassTotalBladeCount: 300000, grassDrawDistance: 700, grassLodRings: 5,
		forestDetailDistance: 50, forestMidDistance: 150, forestThinnedRings: 2, forestBillboardDistance: 360, forestDrawDistance: 4500,
		boulderDrawDistance: 2000, waterTileResolution: 256, cloudSteps: 36, cloudDrawDistance: 32000,
	},
	'high': {
		terrainResolution: 4096, terrainDetailDistance: 1.25, terrainFarBake: 128, terrainRockDetail: 1, terrainRockVeins: 1, terrainGroundDetail: 1,
		dynamicResolution: false,
		shadowMapPCFKernelSize: 1, enableScreenShadows: true, enableSSAO: true, enableSSR: true, enableLightShafts: true,
		antiAliasing: 'smaa', anisotropicFiltering: 8,
		grassTotalBladeCount: 420000, grassDrawDistance: 900, grassLodRings: 6,
		forestDetailDistance: 60, forestMidDistance: 180, forestThinnedRings: 2, forestBillboardDistance: 420, forestDrawDistance: 5000,
		boulderDrawDistance: 2500, waterTileResolution: 512, cloudSteps: 48, cloudDrawDistance: 36000,
	},
	'ultra': {
		terrainResolution: 8192, terrainDetailDistance: 1.5, terrainFarBake: 256, terrainRockDetail: 1, terrainRockVeins: 1, terrainGroundDetail: 1,
		dynamicResolution: false,
		shadowMapPCFKernelSize: 2, enableScreenShadows: true, enableSSAO: true, enableSSR: true, enableLightShafts: true,
		antiAliasing: 'smaa', anisotropicFiltering: 16,
		grassTotalBladeCount: 600000, grassDrawDistance: 1200, grassLodRings: 7,
		forestDetailDistance: 80, forestMidDistance: 240, forestThinnedRings: 2, forestBillboardDistance: 600, forestDrawDistance: 7000,
		boulderDrawDistance: 3500, waterTileResolution: 512, cloudSteps: 64, cloudDrawDistance: 45000,
	},
};

export const MIN_FPS = 30;			// under this, the preset steps down
export const GOOD_FPS = 55;			// at this or over, the check is done (see the top of the file)
const SETTLE_SECONDS = 4;			// not counted after the page loads or the preset changes
const WINDOW_SECONDS = 5;			// frames are counted over this long at a time

// A first guess at the preset from what the browser says about the machine. gpu: the adapter's info (vendor, architecture,
//		description), fallback: whether it is a software stand-in, mobile: a phone or tablet, pixels: how many the canvas has.
//		Returns { preset, reason }
export function detectStartingPreset({ gpu = {}, fallback = false, mobile = false, pixels = 0, memory = 0 } = {}) {
	const vendor = (gpu.vendor ?? '').toLowerCase();
	const architecture = (gpu.architecture ?? '').toLowerCase();
	const description = (gpu.description ?? '').toLowerCase();
	const said = [vendor, architecture].filter((part) => part).join(' ') || 'nothing about the GPU';

	if (fallback || /swiftshader|llvmpipe|software|basic render/.test(description + ' ' + vendor)) {
		return { preset: 'very low', reason: 'software rendering' };
	}

	let preset = null;
	if (mobile || /qualcomm|arm|imagination|samsung|mali|adreno|powervr/.test(vendor + ' ' + description)) {
		preset = memory > 0 && memory <= 3 ? 'very low' : 'low';	// phones and tablets (deviceMemory is in GB, Chrome only)
	} else if (vendor.includes('nvidia')) {
		// the generations before Turing (2018) as medium, the ones after as high, and the newest two as ultra
		preset = /ada|blackwell/.test(architecture) ? 'ultra' : /turing|ampere/.test(architecture) ? 'high' : architecture ? 'medium' : 'high';
	} else if (vendor.includes('amd') || vendor.includes('ati')) {
		// RDNA cards are the newer ones. (An AMD GPU built into the processor says so in its architecture far less reliably, so this is a guess)
		preset = /rdna-?[34]/.test(architecture) ? 'ultra' : /rdna/.test(architecture) ? 'high' : 'medium';
	} else if (vendor.includes('intel')) {
		// Arc (xe-hpg) is a graphics card; the rest are built into the processor
		preset = /xe-hpg|xe2-hpg/.test(architecture) ? 'high' : /xe|gen-12/.test(architecture) ? 'low' : 'very low';
	} else if (vendor.includes('apple')) {
		preset = 'medium';
	}

	if (!preset) {
		return { preset: 'medium', reason: vendor || architecture ? 'no guess for ' + said : 'nothing known about the GPU' };
	}
	// a very big canvas (past 1440p) is a lot more pixels to draw: one down
	if (pixels > 2560 * 1440 * 1.1 && preset !== 'very low') {
		preset = PRESET_NAMES[PRESET_NAMES.indexOf(preset) - 1];
		return { preset, reason: said + ', on a very big screen' };
	}
	return { preset, reason: said };
}

/*
	The check itself, with no browser in it so it can be tested on its own. Each frame, frame(now, finished, hidden):
		now: performance.now(), finished: how many frames the GPU has finished since the last call, hidden: the page is hidden.
	It returns what to do: null, { lower: preset name }, or { done: why }
	state: 'settling', 'measuring' or 'done'. fps: the last measurement
*/
export class PresetCheck {
	constructor(preset, now) {
		this.preset = preset;
		this.state = 'settling';
		this.fps = 0;
		this.why = '';
		this.settle(now);
	}

	settle(now) {
		this.state = 'settling';
		this.until = now + SETTLE_SECONDS * 1000;
		this.frames = 0;
	}

	// stopped from outside: the user ticked Preset Override or chose a preset
	stop(why) {
		this.state = 'done';
		this.why = why;
	}

	// the user took the override off again: start checking from the preset there is now
	restart(preset, now) {
		this.preset = preset;
		this.why = '';
		this.settle(now);
	}

	frame(now, finished, hidden) {
		if (this.state == 'done') {
			return null;
		}
		if (hidden) {
			this.settle(now);		// (and again from the start once it is shown)
			return null;
		}
		if (this.state == 'settling') {
			if (now >= this.until) {
				this.state = 'measuring';
				this.from = now;
				this.frames = 0;
			}
			return null;
		}

		this.frames += finished;
		if (now - this.from < WINDOW_SECONDS * 1000) {
			return null;
		}
		this.fps = this.frames / ((now - this.from) / 1000);
		this.from = now;
		this.frames = 0;

		if (this.fps >= GOOD_FPS) {
			this.stop('reached ' + Math.round(this.fps) + ' fps');
			return { done: this.why, override: true };
		}
		if (this.fps < MIN_FPS) {
			const index = PRESET_NAMES.indexOf(this.preset);
			if (index <= 0) {
				this.stop('lowest preset, ' + Math.round(this.fps) + ' fps');
				return { done: this.why, override: false };
			}
			this.preset = PRESET_NAMES[index - 1];
			this.settle(now);
			return { lower: this.preset };
		}
		return null;	// between the two: keep it, and keep watching
	}
}
