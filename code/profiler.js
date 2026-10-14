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
	enabled: false,		// the window's Enable
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
	cpuStart = now;
	recording = timing.enabled && canTimestamp;
	sections = [];
	passes = [];
	untimed = 0;
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
