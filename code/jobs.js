/*
	JOBS: work that need not all be done at once, done a little at a time: some of each frame, as much as JOB_MS allows, the most urgent
	first. Mostly what a tile of the world brings with it (terrain.js), worked out before anyone needs it.
	A job is a generator function: each step does a piece of the work and yields, and it is carried on from there the next time round.
	This is Game Engine Architecture's event queue (14.7.9: the work handed in when it comes up, and done when it is safe and there is
	room for it) with its jobs (7.6.5, 14.6.4.2: asked for without waiting, picked up later).
		addJob(name, work, { priority, key })	work: function* () { ... yield ... }. A higher priority goes first; the same, in the order
												they came. key: what it belongs to, for cancelJobs
		cancelJobs(key)							the jobs handed in with that key dropped, done or not (a tile gone before its work was). Or
												key(theirs): those it says yes to
		runJobs()								once a frame (rotatingCube.js): a step at least, then as many more as the time allows
*/
const JOB_MS = 2;				// milliseconds of each frame for the jobs
// how soon each kind of job is wanted (a higher first): what the camera will want as soon as it gets to a tile (the flock and the skein
//		over it: quick ones), what can be seen (the towns, their people), what lives there (the animals and people that come with a tile),
//		and last what no one can see (the trees of a tile gone, let go)
export const SOON = 2, SEEN = 1, LIVES = 0, UNSEEN = -1;

const queue = [];				// { name, it (the generator), priority, key }, the next first
export const jobStats = { waiting: 0, done: 0, steps: 0, lastMs: 0, mostMs: 0 };

export function addJob(name, work, { priority = 0, key = null } = {}) {
	const job = { name, it: work(), priority, key };
	let at = queue.length;
	while (at > 0 && queue[at - 1].priority < priority) at--;
	queue.splice(at, 0, job);
	jobStats.waiting = queue.length;
	return job;
}
export function cancelJobs(key) {
	const drop = typeof key == 'function' ? key : (theirs) => theirs === key;
	for (let k = queue.length - 1; k >= 0; k--) {
		if (!drop(queue[k].key)) continue;
		try { queue[k].it.return(); } catch (error) { /* (its finally went wrong: dropped all the same) */ }		// (so its finally is done)
		queue.splice(k, 1);
	}
	jobStats.waiting = queue.length;
}
export function runJobs(ms = JOB_MS) {
	const t0 = performance.now();
	while (queue.length) {
		const job = queue[0];
		let done = true;
		try { done = job.it.next().done; } catch (error) { console.warn('A job went wrong, and was dropped:', job.name, error); }
		jobStats.steps++;
		if (done) {
			queue.splice(queue.indexOf(job), 1);		// (a step may have handed in a more urgent one, ahead of it)
			jobStats.done++;
		}
		if (performance.now() - t0 >= ms) break;
	}
	jobStats.waiting = queue.length;
	jobStats.lastMs = performance.now() - t0;
	jobStats.mostMs = Math.max(jobStats.mostMs, jobStats.lastMs);
}
// for testing: everything waiting, done now
export const finishJobs = () => runJobs(Infinity);
// for testing: what is waiting, by name
export const queueForTest = () => queue.map((job) => job.name);
