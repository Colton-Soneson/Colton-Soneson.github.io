import { device, canTimestamp } from './deviceSelection.js'

// GPU time of every pass in the frame, for the Performance window (see imguiLoader.js)
//-------------------------------------------------
// Each pass that wants timing asks for timestamps() in its descriptor: the GPU writes the time into a query set as the pass
//		starts and again as it ends. At the end of the frame the times are copied out to a buffer that the CPU reads a frame
//		or two later (mapAsync), so nothing ever waits on the GPU.
// The passes are filed under the sections that are open when they ask (section('Water', ...)), which is how the window
//		knows to put the butterfly passes under Water. Passes with the same name in the same place are added together (×8).
// While timing is off timestamps() gives back undefined, which a pass descriptor takes as no timing at all.

const MAX_PASSES = 256;		// timed passes in one frame. Any past this are left untimed (and counted in untimedPasses)
const READBACK_BUFFERS = 4;	// frames that can be waiting on their times at once. A frame with none free is skipped
const AVERAGE_FRAMES = 30;	// for the averaged view

export const timing = {
	enabled: false,		// the window's Enable: times the CPU, the frames and (where the GPU can) every pass. Nothing is timed while it is off
	average: false,		// show the mean of the last 30 frames, instead of the last frame alone
	supported: canTimestamp,
};

let querySet = null;
let resolveBuffer = null;
const freeReadbacks = [];
if (canTimestamp) {
	querySet = device.createQuerySet({ label: "profiler timestamps", type: 'timestamp', count: MAX_PASSES * 2 });
	resolveBuffer = device.createBuffer({
		label: "profiler resolve buffer",
		size: MAX_PASSES * 2 * 8,
		usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
	});
	for (let i = 0; i < READBACK_BUFFERS; i++) {
		freeReadbacks.push(device.createBuffer({
			label: "profiler readback buffer " + i,
			size: MAX_PASSES * 2 * 8,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
		}));
	}
}

// this frame
let recording = false;
let sections = [];
let passes = [];		// { path, shader } in the order they were asked for. Pass i writes queries 2i and 2i + 1
let untimed = 0;
let cpuStart = 0;
let lastFrameStart = 0;

// the latest frame whose times have come back. tree: the rows for the window, in frame order
//		{ name, shader, ms, count, key, children }. total: every timed pass added up
export const latest = { tree: [], total: 0, passCount: 0, untimedPasses: 0, cpuMs: 0, frameMs: 0, frame: 0, skippedFrames: 0 };
const history = new Map();	// key -> the last AVERAGE_FRAMES times of a row with no children, for the averaged view
let frameNumber = 0;

export function beginFrame() {
	const now = performance.now();
	latest.frameMs = lastFrameStart ? now - lastFrameStart : 0;
	lastFrameStart = now;
	if (latest.frameMs > 0 && timing.enabled && !graphs.paused) {
		series.frame.push(latest.frameMs);
	}
	cpuStart = now;
	recording = timing.enabled && canTimestamp;
	sections = [];
	passes = [];
	untimed = 0;
	cpuName = null;
	cpuThisFrame.clear();
}

/*
	CPU TIME, a stretch of the frame at a time. cpuMark(name) ends the stretch before it and starts one called name, so a few
	marks down the frame (rotatingCube.js) account for all of it with nothing in between. cpuFrameDone ends the last one.
	Only while Enable is ticked. What the window shows is each stretch averaged over the last frames (CPU_SMOOTHING),
	as one frame's own times jump about too much to read. In the order the stretches first came in the frame
*/
const CPU_SMOOTHING = 0.1;		// how much of each new frame goes into the average
let cpuName = null, cpuFrom = 0;
const cpuThisFrame = new Map();
const cpuAverage = new Map();
export const cpuTimes = [];		// [{ name, ms }]: the averages
export function cpuMark(name) {
	if (!timing.enabled) {
		return;
	}
	const now = performance.now();
	if (cpuName) cpuThisFrame.set(cpuName, (cpuThisFrame.get(cpuName) ?? 0) + now - cpuFrom);
	cpuName = name;
	cpuFrom = now;
}
export function cpuFrameDone() {
	if (!timing.enabled) {
		return;
	}
	cpuMark(null);
	if (!graphs.paused) {
		let frameCpu = 0;
		for (const ms of cpuThisFrame.values()) frameCpu += ms;
		series.cpu.push(frameCpu);
	}
	for (const [name, ms] of cpuThisFrame) {
		cpuAverage.set(name, cpuAverage.has(name) ? cpuAverage.get(name) + (ms - cpuAverage.get(name)) * CPU_SMOOTHING : ms);
	}
	for (const name of cpuAverage.keys()) {
		if (!cpuThisFrame.has(name)) cpuAverage.set(name, cpuAverage.get(name) * (1 - CPU_SMOOTHING));	// a stretch that did not happen this frame cost nothing in it
	}
	cpuTimes.length = 0;
	for (const [name, ms] of cpuAverage) cpuTimes.push({ name: name, ms: ms });
}

/*
	THE GRAPHS: the last SERIES_LENGTH frames of three things, for the graphs in the Performance window. While Enable is ticked
	and the graphs are not paused (graphs.paused, the window's Pause Graphs).
		frame	the time from the start of one frame to the start of the next
		cpu		the CPU time of the frame (all of CPU TIME's stretches added up)
		gpu		the GPU time of the frame: every timed pass added up (copies between passes are not timed). It comes back a frame
				or two after the frame, and not for a frame skipped (see endFrame)
	Each can say its average and its lows: what the slow frames run at. The 5% low is the frame slower than 95% of them, the
	1% low the one slower than 99%. A stutter that the average hides shows up there.
*/
const SERIES_LENGTH = 600;		// about 10 seconds at 60 frames a second
class Series {
	constructor() {
		this.values = new Float32Array(SERIES_LENGTH);
		this.next = 0;
		this.count = 0;
	}
	push(value) {
		this.values[this.next] = value;
		this.next = (this.next + 1) % SERIES_LENGTH;
		this.count = Math.min(this.count + 1, SERIES_LENGTH);
	}
	clear() {
		this.next = 0;
		this.count = 0;
	}
	// oldest first
	recent() {
		const out = new Float32Array(this.count);
		for (let i = 0; i < this.count; i++) out[i] = this.values[(this.next - this.count + i + SERIES_LENGTH) % SERIES_LENGTH];
		return out;
	}
	// { average, worst5, worst1 } in ms: the mean, and the values 95% and 99% of the rest are under
	stats() {
		if (this.count == 0) return { average: 0, worst5: 0, worst1: 0 };
		const sorted = this.recent().sort();
		const at = (share) => sorted[Math.min(Math.floor(sorted.length * share), sorted.length - 1)];
		return { average: sorted.reduce((sum, value) => sum + value, 0) / sorted.length, worst5: at(0.95), worst1: at(0.99) };
	}
}
export const SERIES_FRAMES = SERIES_LENGTH;
export const series = { frame: new Series(), cpu: new Series(), gpu: new Series() };
export const graphs = { paused: false };

// starts the graphs and the CPU averages again from nothing (when Enable is ticked: what was there is from before it was off)
export function clearTimes() {
	for (const each of Object.values(series)) each.clear();
	cpuAverage.clear();
	cpuTimes.length = 0;
}

// { average, low5, low1 } in frames a second, over the frame times there are
export function frameRates() {
	const { average, worst5, worst1 } = series.frame.stats();
	return average > 0 ? { average: 1000 / average, low5: 1000 / worst5, low1: 1000 / worst1 } : { average: 0, low5: 0, low1: 0 };
}

// file the passes asked for inside run() under name. Gives back what run() does
export function section(name, run) {
	sections.push(name);
	try {
		return run();
	} finally {
		sections.pop();
	}
}

// for a pass descriptor's timestampWrites. name: what the pass does, shader: the shader it runs
export function timestamps(name, shader) {
	return timestampsIn(sections, name, shader);
}

function timestampsIn(path, name, shader) {
	if (!recording) {
		return undefined;
	}
	if (passes.length >= MAX_PASSES) {
		untimed++;
		return undefined;
	}
	const i = passes.length;
	passes.push({ path: [...path, name], shader: shader });
	return { querySet: querySet, beginningOfPassWriteIndex: i * 2, endOfPassWriteIndex: i * 2 + 1 };
}

// One render pass that draws with more than one shader. Ordinarily it stays one pass. While timing is on, each part gets a
//		pass of its own (the ones after the first load what the one before stored), as a pass can only be timed whole.
//		next(name, shader) gives the pass to draw the next part with: set the pipeline and the bind groups again on it.
//		The parts go under the sections that were open when this was called
export function renderPassParts(aEncoder, descriptor) {
	const path = [...sections];
	let pass = null;
	let after = descriptor;
	return {
		next(name, shader) {
			if (pass && !recording) {
				return pass;
			}
			if (pass) {
				pass.end();
				after = loadedAgain(descriptor);
			}
			pass = aEncoder.beginRenderPass({ ...after, timestampWrites: timestampsIn(path, name, shader) });
			return pass;
		},
		end() {
			(pass ?? aEncoder.beginRenderPass(descriptor)).end();	// with no parts the clears still happen
		},
	};
}

function loadedAgain(descriptor) {
	const result = { ...descriptor };
	result.colorAttachments = descriptor.colorAttachments.map((attachment) => attachment && { ...attachment, loadOp: "load" });
	if (descriptor.depthStencilAttachment) {
		const depth = { ...descriptor.depthStencilAttachment };
		if (depth.depthLoadOp) depth.depthLoadOp = "load";
		if (depth.stencilLoadOp) depth.stencilLoadOp = "load";
		result.depthStencilAttachment = depth;
	}
	return result;
}

// after the frame's last submit: copy the times out, and read them once the GPU is done with them
export function endFrame() {
	latest.cpuMs = performance.now() - cpuStart;
	if (!recording) {
		return;
	}
	recording = false;
	const frame = passes;
	const untimedPasses = untimed;
	if (frame.length == 0) {
		return;
	}
	const readback = freeReadbacks.pop();
	if (!readback) {
		latest.skippedFrames++;		// the GPU is more than READBACK_BUFFERS frames behind
		return;
	}
	const bytes = frame.length * 2 * 8;
	const encoder = device.createCommandEncoder({ label: "profiler resolve" });
	encoder.resolveQuerySet(querySet, 0, frame.length * 2, resolveBuffer, 0);
	encoder.copyBufferToBuffer(resolveBuffer, 0, readback, 0, bytes);
	device.queue.submit([encoder.finish()]);

	readback.mapAsync(GPUMapMode.READ, 0, bytes).then(() => {
		const stamps = new BigUint64Array(readback.getMappedRange(0, bytes));
		const ms = frame.map((pass, i) => {
			const begin = stamps[i * 2], end = stamps[i * 2 + 1];
			return begin > 0n && end > begin ? Number(end - begin) / 1e6 : 0;	// nanoseconds. A pass that never ran leaves zeros
		});
		readback.unmap();
		freeReadbacks.push(readback);
		if (!graphs.paused) {
			series.gpu.push(ms.reduce((sum, each) => sum + each, 0));
		}
		buildTree(frame, ms, untimedPasses);
	}, () => {
		freeReadbacks.push(readback);	// the device went away
	});
}

// the rows for the window: passes filed under their sections, the same pass in the same place added up
function buildTree(frame, ms, untimedPasses) {
	frameNumber++;
	const top = { children: new Map() };
	frame.forEach((pass, i) => {
		let node = top;
		pass.path.forEach((name, depth) => {
			let child = node.children.get(name);
			if (!child) {
				child = { name: name, shader: null, ms: 0, count: 0, key: pass.path.slice(0, depth + 1).join('/'), children: new Map() };
				node.children.set(name, child);
			}
			node = child;
		});
		node.shader = pass.shader;
		node.ms += ms[i];
		node.count++;
	});

	// leaves: averaged if asked for. Sections: what is under them added up
	const finish = (node) => {
		const children = [...node.children.values()];
		if (children.length == 0) {
			let kept = history.get(node.key);
			if (!kept) {
				kept = { values: new Float32Array(AVERAGE_FRAMES), next: 0, filled: 0 };
				history.set(node.key, kept);
			}
			kept.values[kept.next] = node.ms;
			kept.next = (kept.next + 1) % AVERAGE_FRAMES;
			kept.filled = Math.min(kept.filled + 1, AVERAGE_FRAMES);
			kept.seen = frameNumber;
			if (timing.average) {
				let sum = 0;
				for (let i = 0; i < kept.filled; i++) sum += kept.values[i];
				node.ms = sum / kept.filled;
			}
		} else {
			node.ms = children.reduce((sum, child) => sum + finish(child), 0);
		}
		node.children = children;
		return node.ms;
	};
	const tree = [...top.children.values()];
	latest.total = tree.reduce((sum, node) => sum + finish(node), 0);
	latest.tree = tree;
	latest.passCount = frame.length;
	latest.untimedPasses = untimedPasses;
	latest.frame = frameNumber;

	// forget rows that have not run for a while
	if (frameNumber % 120 == 0) {
		for (const [key, kept] of history) {
			if (frameNumber - kept.seen > 120) history.delete(key);
		}
	}
}
