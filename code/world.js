/*
	THE WORLD: the lands and the seas, laid out on a grid of tiles, each a square of settings.terrainWorldSize (the size today's island is
	made in), its middle at (tx, tz) times that. Pure maths, no GPU in here: terrain.js streams the tiles near the camera in from it
	(terrainGenerator.js makes each, terrainWorker.js off the main thread), and the world tracker (worldTracker.js) keeps the rest going.
		HOME		the tile at (0, 0): today's island, made just as it ever was (it has no land round it, so its coast is the one the
					world's edge always made: terrainGenerator.js, openSea)
		LAND		LAND tiles in all (home among them), in CONTINENTS: tiles side by side make one land mass across them (a coast only
					where a land tile meets one that is not land), each continent kept from sharing a side with another (they may meet at
					a corner, a strait between them), the home island with sea on all four sides (a continent may meet it at a corner), and all of them as near home as that lets them be: each starts on the free tile nearest home (a little
					at random among the nearest, NEAR), and grows the way home is. Each land tile has
					its own towns: 0 to 2 (TOWNS: how likely each), the home tile its settings.terrainTownCount
		SEA			SEA tiles: open sea with a sea bed under it (the shelf and the drop-off of the land beside it, and the deep bed past
					that), round the continents and in the straits between them, the nearest first
		BEYOND		everything else: the endless sea with no bed under it, as there has always been round the island
	The same seed always lays out the same world (seededRandom: settings.terrainSeed).
	A tile's key is "tx,tz".
*/
import { seededRandom } from './terrainGenerator.js'

export const GRID = 12;							// tiles along a side of the world: tx and tz from -GRID / 2 to GRID / 2 - 1
export const LAND = 40, SEA = 30;
export const CONTINENTS = [4, 8];				// how many continents (the home island one of them)
const TOWNS = [0.2, 0.4, 0.4];					// of a land tile (not home): no town, one, two
const NEAR = 1.5;								// tiles: how much at random a continent's first tile is, among those nearest home
const INWARD = 0.8;								// how much a continent grows towards home, against the rest (see layoutWorld)

export const keyOf = (tx, tz) => tx + ',' + tz;
export const HOME = keyOf(0, 0);

// the world for a seed: { tiles: Map key -> { tx, tz, kind ('land', 'sea'), continent, towns }, continents: [{ id, tiles: [keys] }] }
export function layoutWorld(seed, homeTowns = 2) {
	const random = seededRandom((seed ?? 0) * 104729 + 7);
	const lo = -GRID / 2, hi = GRID / 2 - 1;
	const inside = (tx, tz) => tx >= lo && tx <= hi && tz >= lo && tz <= hi;
	const tiles = new Map();
	const owner = new Map();		// key -> continent
	const around = (tx, tz, f) => { for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) f(tx + dx, tz + dz); };
	// (a tile can join continent c if it shares no side with another's: they may meet at a corner, where the sea comes in between them as a
	//		strait (terrainGenerator.js: openSea). The tiles round home are kept clear, but may be touched)
	const free = (tx, tz, c) => {
		if (!inside(tx, tz) || owner.has(keyOf(tx, tz))) return false;
		for (const [x, z] of [[tx + 1, tz], [tx - 1, tz], [tx, tz + 1], [tx, tz - 1]]) { const o = owner.get(keyOf(x, z)); if (o !== undefined && o !== c && o !== -1) return false; }
		return true;
	};
	const fromHome = (tx, tz) => Math.max(Math.abs(tx), Math.abs(tz)) + 0.3 * Math.hypot(tx, tz);
	// THE HOME island: alone, with nothing round it
	owner.set(HOME, 0);
	const continents = [{ id: 0, tiles: [HOME] }];
	for (const [x, z] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) owner.set(keyOf(x, z), -1);		// (kept clear: no land sharing a side with it; a continent may meet it at a corner)
	// the others: how many, how big (at least 3 tiles each), where each starts
	const count = CONTINENTS[0] - 1 + Math.floor(random() * (CONTINENTS[1] - CONTINENTS[0] + 1));
	const left = LAND - 1;
	const weights = Array.from({ length: count }, () => 0.5 + random());
	const total = weights.reduce((a, b) => a + b, 0);
	const sizes = weights.map((w) => Math.max(3, Math.round(w / total * left)));
	while (sizes.reduce((a, b) => a + b, 0) > left) sizes[sizes.indexOf(Math.max(...sizes))]--;
	while (sizes.reduce((a, b) => a + b, 0) < left) sizes[sizes.indexOf(Math.min(...sizes))]++;
	for (let c = 1; c <= count; c++) {
		// (the free tile nearest home, a little at random among the nearest)
		let start = null, best = Infinity;
		for (let tz = lo; tz <= hi; tz++) for (let tx = lo; tx <= hi; tx++) {
			if (!free(tx, tz, c)) continue;
			const score = fromHome(tx, tz) + random() * NEAR;
			if (score < best) { best = score; start = [tx, tz]; }
		}
		if (!start) break;
		const mine = [keyOf(...start)];
		owner.set(mine[0], c);
		// (grown a tile at a time on to a free tile beside one of its own: the ones with more of its own round them first, so it comes out
		//		as a land mass, not a string of tiles)
		while (mine.length < sizes[c - 1]) {
			const options = [];
			for (const k of mine) {
				const [x, z] = k.split(',').map(Number);
				for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
					if (!free(nx, nz, c)) continue;
					let near = 0;
					around(nx, nz, (ax, az) => { if (owner.get(keyOf(ax, az)) === c) near++; });
					options.push({ k: keyOf(nx, nz), w: 1 + near * near + random() * 2 - INWARD * fromHome(nx, nz) });
				}
			}
			if (!options.length) break;
			options.sort((a, b) => b.w - a.w);
			const pick = options[Math.floor(random() * Math.min(3, options.length))].k;
			owner.set(pick, c);
			mine.push(pick);
		}
		continents.push({ id: c, tiles: mine });
	}
	// (whatever land could not be grown where it was wanted, on to the smallest continent that has room)
	let short = LAND - continents.reduce((a, c) => a + c.tiles.length, 0);
	for (const c of [...continents.slice(1)].sort((a, b) => a.tiles.length - b.tiles.length)) {
		for (let k = 0; k < c.tiles.length && short > 0; k++) {
			const [x, z] = c.tiles[k].split(',').map(Number);
			for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) if (short > 0 && free(nx, nz, c.id)) { owner.set(keyOf(nx, nz), c.id); c.tiles.push(keyOf(nx, nz)); short--; }
		}
	}
	for (const c of continents) for (const k of c.tiles) {
		const [tx, tz] = k.split(',').map(Number);
		const roll = random(), towns = k == HOME ? homeTowns : roll < TOWNS[0] ? 0 : roll < TOWNS[0] + TOWNS[1] ? 1 : 2;
		tiles.set(k, { key: k, tx, tz, kind: 'land', continent: c.id, towns });
	}
	// THE SEA tiles: next to the land, those beside the most of it (and the straits between two continents) first, the home island's all round
	const candidates = [];
	for (let tz = lo; tz <= hi; tz++) for (let tx = lo; tx <= hi; tx++) {
		const k = keyOf(tx, tz);
		if (tiles.has(k)) continue;
		const touching = new Set();
		let landNear = 0;
		around(tx, tz, (x, z) => { const t = tiles.get(keyOf(x, z)); if (t) { landNear++; touching.add(t.continent); } });
		if (!landNear) continue;
		candidates.push({ k, tx, tz, w: landNear + (touching.size > 1 ? 6 : 0) + (touching.has(0) ? 20 : 0) + random() });
	}
	candidates.sort((a, b) => b.w - a.w);
	for (const c of candidates.slice(0, SEA)) tiles.set(c.k, { key: c.k, tx: c.tx, tz: c.tz, kind: 'sea', continent: -1, towns: 0 });
	return { seed, tiles, continents, landKeys: [...tiles.values()].filter((t) => t.kind == 'land').map((t) => t.key) };
}

// what the land of a tile is made from: the land's params (terrain.js: getTerrainParams), put in its place in the world, with the world's
//		land tiles for its coasts (terrainGenerator.js: openSea), and its own towns. The landing strip is the home tile's alone
export function tileParams(base, world, key) {
	const t = world.tiles.get(key);
	if (!t) return null;
	return { ...base, center: [t.tx * base.worldSize, t.tz * base.worldSize], tile: key, world: { size: base.worldSize, land: world.landKeys },
		townCount: t.kind == 'land' ? (key == HOME ? base.townCount : t.towns) : 0, landingStrip: key == HOME && base.landingStrip, footpaths: t.kind == 'land' && base.footpaths };
}
// the tile a world position is in (its key), and its middle
export const tileAt = (x, z, size) => keyOf(Math.round(x / size), Math.round(z / size));
