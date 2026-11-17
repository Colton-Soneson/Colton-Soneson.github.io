import * as terrain from './terrain.js'

/*
	THE TOWNS' FLOOR: what is drawn of a town's ground work (townGround.js), as a floor to stand on: for the walker (hunting.js: addFloor,
	townFolk.js puts it there) and the townsfolk (townFolk.js: their walks laid along it). The land under a town is a grid much coarser
	than a street (terrain.js; hunting.js reads its corners, as it is drawn), and where a street runs along the edge of a terrace, or
	stairs go down the step from one to the next, the land under them is metres below what is drawn. So what walks there walks on what
	is drawn instead:
		the streets		their ribbons, as wide as they are drawn (up to the houses' walls)
		the lanes		out to the hamlets: theirs
		the links		the lanes and the stairs between the streets, from the edge of one to the edge of the next (townLayout.js:
						LINK_EDGE, link.foot and link.head); the stairs as a slope through the middles of their treads (half a step up)
		the plaza		its flags
		the bridges		the town's own (over a river or a cove), their decks
	floorAt(x, z, highest): the highest of them under (x, z) that is no higher than highest (world units), or -Infinity
*/
const LIFT = 0.06;			// (townGround.js: the ground work stands this far over the land)
const STEP_RISE = 0.34;		// (townGround.js: the stairs' steps, at the most)
const BUCKET = 24;			// world units

// a town's pieces, in buckets of the world: each a run from a to b (its ends' heights), half wide either side of it, or (rect) a
//		rectangle as long as the run and half wide
const made = new WeakMap();		// (by the town's streets: a town's slot filled when its tile comes, townSlots in terrain.js)
function indexOf(town) {
	let ix = made.get(town.streets);
	if (ix) return ix;
	const list = [];
	const run = (a, b, half, up = LIFT, rect = false) => {
		const ex = b[0] - a[0], ez = b[2] - a[2];
		list.push({ ax: a[0], az: a[2], ay: a[1] + up, by: b[1] + up, ex, ez, ll: ex * ex + ez * ez, half, rect });
	};
	for (const s of town.streets) for (let j = 0; j < s.points.length - 1; j++) run(s.points[j], s.points[j + 1], (s.width + 1.0) / 2);
	for (const l of town.lanes ?? []) for (let j = 0; j < l.points.length - 1; j++) run(l.points[j], l.points[j + 1], (l.width + 0.6) / 2);
	for (const l of town.links) {
		const A = l.foot ?? l.a, B = l.head ?? l.b, rise = Math.abs(B[1] - A[1]), steps = Math.max(Math.ceil(rise / STEP_RISE), 1);
		run(A, B, l.width / 2, LIFT + (l.stairs ? rise / steps / 2 : 0));
	}
	for (const b of town.bridges ?? []) for (let j = 0; j < b.points.length - 1; j++) run(b.points[j], b.points[j + 1], b.width / 2);
	if (town.plaza) {
		const P = town.plaza;
		run([P.x - P.tx * P.long, P.y + 0.01, P.z - P.tz * P.long], [P.x + P.tx * P.long, P.y + 0.01, P.z + P.tz * P.long], P.deep, LIFT, true);
	}
	const buckets = new Map();
	let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
	list.forEach((p, k) => {
		const lo = [Math.min(p.ax, p.ax + p.ex) - p.half, Math.min(p.az, p.az + p.ez) - p.half], hi = [Math.max(p.ax, p.ax + p.ex) + p.half, Math.max(p.az, p.az + p.ez) + p.half];
		x0 = Math.min(x0, lo[0]); z0 = Math.min(z0, lo[1]); x1 = Math.max(x1, hi[0]); z1 = Math.max(z1, hi[1]);
		for (let bx = Math.floor(lo[0] / BUCKET); bx <= Math.floor(hi[0] / BUCKET); bx++) for (let bz = Math.floor(lo[1] / BUCKET); bz <= Math.floor(hi[1] / BUCKET); bz++) {
			const key = bx * 100000 + bz;
			if (!buckets.has(key)) buckets.set(key, []);
			buckets.get(key).push(k);
		}
	});
	ix = { list, buckets, x0, x1, z0, z1 };
	made.set(town.streets, ix);
	return ix;
}

export function floorAt(x, z, highest = Infinity) {
	let floor = -Infinity;
	for (const town of terrain.land?.towns ?? []) {
		if (!town?.streets?.length) continue;
		const ix = indexOf(town);
		if (x < ix.x0 || x > ix.x1 || z < ix.z0 || z > ix.z1) continue;
		for (const k of ix.buckets.get(Math.floor(x / BUCKET) * 100000 + Math.floor(z / BUCKET)) ?? []) {
			const p = ix.list[k];
			let s = p.ll > 0 ? ((x - p.ax) * p.ex + (z - p.az) * p.ez) / p.ll : 0;
			if (p.rect && (s < 0 || s > 1)) continue;
			s = Math.min(Math.max(s, 0), 1);
			if (Math.hypot(x - p.ax - p.ex * s, z - p.az - p.ez * s) > p.half) continue;
			const y = p.ay + (p.by - p.ay) * s;
			if (y <= highest && y > floor) floor = y;
		}
	}
	return floor;
}
