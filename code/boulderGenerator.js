/*
	Boulders. Pure maths, no GPU in here: boulders.js takes what this makes and puts it on screen.

	Two things are made:
		the shapes		a few boulders, each a ball knocked about until it looks like a rock (see buildBoulderMesh)
		the places		where they lie on the land (see placeBoulders). A mountain sheds rock: it comes off the crest and the
						faces and ends up at the foot, where the slope eases off. So boulders lie scattered along the foot of every
						range, in loose fields with long gaps between them. And along the main ridges there are small
						outcrops, knots of standing rock that the crest has weathered down around.
*/

import { seededRandom } from './terrainGenerator.js'
import { MOUNTAIN_THRESHOLD } from './terrainGenerator.js'

export const BOULDER_SHAPES = 4;			// how many different boulders there are
export const BOULDER_VERTEX_FLOATS = 6;		// position (3), normal (3)
export const BOULDER_FLOATS = 12;			// one boulder on the land, see placeBoulders

//-------------------------------SHAPES-------------------------------
// A ball made of triangles: an icosahedron (20 triangles), with every triangle cut into 4 and pushed back out on to the ball, detail times over.
//		Returns the corners as directions, [x, y, z] each of length 1, and the triangles as 3 corner numbers each
function buildBall(detail) {
	const t = (1 + Math.sqrt(5)) / 2;
	let corners = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
		.map((c) => { const l = Math.hypot(...c); return c.map((v) => v / l); });
	let triangles = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
					 [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

	for (let pass = 0; pass < detail; pass++) {
		const middles = new Map();	// the new corner in the middle of each edge, so the two triangles that share the edge share it too
		const middle = (a, b) => {
			const key = Math.min(a, b) + ":" + Math.max(a, b);
			if (!middles.has(key)) {
				const m = [corners[a][0] + corners[b][0], corners[a][1] + corners[b][1], corners[a][2] + corners[b][2]];
				const l = Math.hypot(...m);
				corners.push(m.map((v) => v / l));
				middles.set(key, corners.length - 1);
			}
			return middles.get(key);
		};
		const cut = [];
		for (const [a, b, c] of triangles) {
			const ab = middle(a, b), bc = middle(b, c), ca = middle(c, a);
			cut.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
		}
		triangles = cut;
	}
	return { corners, triangles };
}

/*
	One boulder, about 1 across, sitting on y = 0.
		shape		which boulder, 0 to BOULDER_SHAPES - 1. The same number is always the same boulder
		detail		how many times the ball's triangles are cut into 4: 2 gives 320 triangles, 1 gives 80 (for far away)

	A ball is turned into a rock in three steps, each done to the corners of its triangles:
		1. lumps	pushed in and out by a few slow waves, so it is no longer round
		2. breaks	a real boulder is a piece broken off something bigger, and its faces are the breaks. A handful of flat
					planes are set against the ball at random and whatever sticks out past one is pressed flat on to it
		3. the base	and one more plane underneath, so it sits on the ground instead of balancing on a point
	The normals are per triangle, not smoothed across the corners: the flat faces and hard edges are the look.

	Returns a Float32Array of triangles, 3 corners each, BOULDER_VERTEX_FLOATS per corner: position (3), normal (3)
*/
export function buildBoulderMesh(shape, detail) {
	const random = seededRandom(shape * 7717 + 31);
	const { corners, triangles } = buildBall(detail);

	const waves = Array.from({ length: 3 }, () => [2 + 2.5 * random(), 2 + 2.5 * random(), 2 + 2.5 * random(), random() * 6.28, random() * 6.28, random() * 6.28]);
	const breaks = Array.from({ length: 9 }, () => {
		const z = random() * 2 - 1, turn = random() * 6.2832, flat = Math.sqrt(1 - z * z);
		return [flat * Math.cos(turn), z, flat * Math.sin(turn), 0.6 + 0.3 * random()];	// which way the plane faces, and how far out from the middle it is
	});
	breaks.push([0, -1, 0, 0.5]);	// the base

	const points = corners.map((d) => {
		let lump = 1;
		for (const [fx, fy, fz, px, py, pz] of waves) lump += 0.07 * Math.sin(fx * d[0] + px) * Math.sin(fy * d[1] + py) * Math.sin(fz * d[2] + pz);
		const p = [d[0] * lump, d[1] * lump, d[2] * lump];
		for (const [nx, ny, nz, out] of breaks) {
			const past = p[0] * nx + p[1] * ny + p[2] * nz - out;
			if (past > 0) { p[0] -= nx * past; p[1] -= ny * past; p[2] -= nz * past; }
		}
		return [p[0] * 0.5, (p[1] + 0.5) * 0.5, p[2] * 0.5];	// from 2 across to 1 across, and up on to y = 0
	});

	const mesh = new Float32Array(triangles.length * 3 * BOULDER_VERTEX_FLOATS);
	triangles.forEach(([a, b, c], i) => {
		const pa = points[a], pb = points[b], pc = points[c];
		const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
		let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
		const l = Math.hypot(...n) || 1;
		n = n.map((value) => value / l);
		// (out of the boulder: away from its middle, whichever way round the triangle's corners happen to run)
		if (n[0] * pa[0] + n[1] * (pa[1] - 0.25) + n[2] * pa[2] < 0) n = n.map((value) => -value);
		[pa, pb, pc].forEach((p, k) => mesh.set([p[0], p[1], p[2], n[0], n[1], n[2]], (i * 3 + k) * BOULDER_VERTEX_FLOATS));
	});
	return mesh;
}

//-------------------------------PLACES-------------------------------
/*
	Where the boulders lie.
		land		generateTerrain's result
		params		seed, amount (1 = the usual number, 0 = none), seaLevel, unitsPerMetre

	Returns a Float32Array, BOULDER_FLOATS per boulder:
		 0  x, y, z			 3  size: how far across it is, world units
		 4  turn			 5  tip, 6  tip the other way (radians: it lies however it landed)		 7  a random number
		 8  squash x, y, z: its own proportions (some are slabs, some are stumps)					11  which shape, 0 to BOULDER_SHAPES - 1
*/
export function placeBoulders(land, params) {
	const random = seededRandom(params.seed * 4391 + 77);
	const half = land.cells * land.cellSize * 0.5;
	const metre = params.unitsPerMetre;
	const boulders = [];

	const add = (x, z, size, tall) => {
		const squash = [0.8 + 0.5 * random(), (0.6 + 0.5 * random()) * tall, 0.8 + 0.5 * random()];
		// sunk in a little: nothing that has lain on a hillside for a few thousand years is still sitting on top of it.
		//		And further on a slope, by about what the ground falls away across the width of it, or its downhill side would hang in the air
		const level = Math.max(land.normalAt(x, z)[1], 0.3);
		const fall = Math.min(Math.sqrt(1 - level * level) / level, 1.5);
		const y = land.groundAt(x, z) - (0.22 * squash[1] + 0.4 * fall) * size;
		boulders.push(x, y, z, size, random() * 6.2832, (random() - 0.5) * 0.6, (random() - 0.5) * 0.6, random(), squash[0], squash[1], squash[2], Math.floor(random() * BOULDER_SHAPES));
	};

	// the grid point nearest a place, for reading the land's grids
	const pointAt = (x, z) => Math.round(Math.min(Math.max((z + half) / land.cellSize, 0), land.cells)) * land.points + Math.round(Math.min(Math.max((x + half) / land.cellSize, 0), land.cells));

	//---at the foot of the mountains
	// Spots are tried at random all over the land and kept where the ground is right: around where the forest gives way to
	//		bare mountain, and not on a slope a boulder would have rolled on down. Most of the foot is left empty though:
	//		boulders come in fields, below the gullies and faces that feed them, so a spot also has to be in one of the patches a slow noise picks out
	const fields = (x, z) => Math.sin(x / 190 + 1.3) * Math.sin(z / 230 - 0.7) + 0.6 * Math.sin((x + z) / 97 + 2.1) * Math.sin((x - z) / 121);
	const wanted = Math.round(420 * params.amount);
	for (let attempt = 0, found = 0; attempt < wanted * 600 && found < wanted; attempt++) {
		const x = (random() * 2 - 1) * half, z = (random() * 2 - 1) * half;
		const i = pointAt(x, z);
		const cover = land.covers[i];
		if (cover < MOUNTAIN_THRESHOLD - 0.1 || cover > MOUNTAIN_THRESHOLD + 0.12) continue;
		if (land.normals[i * 3 + 1] < 0.62 || land.heights[i] < params.seaLevel + 6) continue;
		if (fields(x, z) < 0.25) continue;

		// mostly small, the odd one the size of a house
		const size = (1.1 + 4.2 * Math.pow(random(), 2.6)) * metre;
		add(x, z, size, 1);
		found++;
		// and a big one usually has a few bits of itself lying round it
		for (let bit = 0; size > 2.4 * metre && bit < 3 && random() < 0.6; bit++) {
			const angle = random() * 6.2832, away = size * (0.7 + 0.8 * random());
			add(x + Math.cos(angle) * away, z + Math.sin(angle) * away, size * (0.2 + 0.25 * random()), 1);
		}
	}

	//---on the ridgelines
	// every so often along the main ridges: a knot of rocks standing on the crest, taller than they are wide
	const crests = land.ridgeCrests;
	const outcrops = Math.round(110 * params.amount);
	for (let outcrop = 0; outcrop < outcrops && crests.length > 0; outcrop++) {
		const at = Math.floor(random() * crests.length / 2) * 2;
		const x = crests[at], z = crests[at + 1];
		const rocks = 2 + Math.floor(random() * 4);
		for (let rock = 0; rock < rocks; rock++) {
			const angle = random() * 6.2832, away = random() * 3.2 * metre;
			add(x + Math.cos(angle) * away, z + Math.sin(angle) * away, (0.9 + 2.0 * random()) * metre, 1.3 + 0.8 * random());
		}
	}

	return new Float32Array(boulders);
}
