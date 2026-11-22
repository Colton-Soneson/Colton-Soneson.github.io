import {canvas} from './deviceSelection.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as town from './town.js'
import * as townFolk from './townFolk.js'
import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as vm from './viewmodel.js'
import { MESHES } from './itemMeshes.js'
import * as inventory from './inventory.js'
import * as survival from './survival.js'

/*
	THE MAP of the Survival mode: from T (its own place there: survival.js) or M. It is pulled out and opened in the hands (the map's
	model, itemMeshes.js: its two side panels folding out, raised to the eyes: PULL seconds), and then it fills the screen; M, Esc, T or a
	right click puts it away again.
	It is drawn by hand in charcoal (drawLand), each tile of land on its own sheet of ink (INKS), from above, north up (-z), and shows only:
		the lie of the land		contour lines every CONTOUR metres over the sea (every INDEX of them heavier), and hatching down the
								steep slopes
		the shore				heavy, and the sea hatched across
		the ponds				the lakes (the land's lake zone), outlined, their water rippled
		the towns				each one's ground shaded across, its streets, and its name (a town of a tile not here: where the survey
								found it, a dot and its name)
		the airstrip			outlined, and named
		the paths				dashed
	There is nothing of where the walker is on it: it has to be read.
	THE VIEW: it opens on the tile the walker is on, filling the paper as it always has. Drag it to move about the country, the wheel to come
	nearer (ZOOM_IN) or go further out, as far as the whole world, every continent of it. It goes where it is sent smoothly (EASE: the wheel
	about the point under the mouse), and a flung drag glides on a little (GLIDE). The paper stays as it is, the drawing moves on it: the
	paper (its fibres, its folds), the north arrow, the title, the chart and the smudges are drawn once each time it is opened (MARKS), the
	tiles' ink once each (and again only when the tile comes in close, or its towns are found), and only those put together again each
	frame: so the charcoal never flickers.
		INKS		each tile's drawing, two ways: from further out (LOW: a smaller sheet, a coarser grid) and close (SIZE, GRID: the
					drawing as the map always had it), the close one only once the tile is CLOSE_FROM across on the map, and only
					KEEP_CLOSE of those kept. Drawn a few at a time, the nearest the view's middle first, the far ones' until then
					their place shaded. A tile here draws its land as it is (terrain.js: mapLandOf); one far off its far ground (its
					heights alone, coarse), until it comes
		THE SEA		every tile of sea, and all round the world, hatched across
	IN A WORLD OF TILES (terrain.js, world.js): in a corner THE CHART of the whole world: each land tile (shaded by its continent) and each
	tile of sea, the towns the world knows of (as the survey found them, terrain.js) each a dot and its name, and what the map shows now ringed.
*/
const SIZE = 1600;					// pixels across the map's drawing (a tile's close drawing too)
const GRID = 300;					// heights looked at across a tile, close
const LOW = { px: 400, grid: 110 };	// a tile's drawing from further out
const CLOSE_FROM = 700;				// pixels a tile is across on the map from which its close drawing is wanted
const CLOSER = { from: 1800, px: 2800 };	// and from which it is drawn finer (the same drawing, more pixels: sharp when come nearer)
const KEEP_CLOSE = 8;
const ZOOM_IN = 4;					// the nearest: a tile this many times the paper across
const EASE = 9, GLIDE = 5;			// a second
const CONTOUR = 25, INDEX = 4;		// metres, and every how many a heavy one
const PULL = 0.55, OPEN = 0.25;		// seconds

const ink = '#2b2520';
let rand = Math.random;				// (the charcoal's wobble: the same every frame for what is drawn every frame, the ring on the chart)
const seeded = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const TILE = () => settings.terrainWorldSize;
const keyOf = (tx, tz) => terrain.world ? tx + ',' + tz : 'land';
const canvasOf = (px) => { const c = document.createElement('canvas'); c.width = c.height = px; return c; };

// THE CHART (see the top): the whole world, in the top left corner (what the map shows now ringed over it each frame: ringChart)
const CHART = { size: 420, at: [40, 40] };
let chartAt = null;			// (its tiles' place on the paper: { lo, cell })
function chart(ctx) {
	const W = terrain.world, S = settings.terrainWorldSize, { size, at } = CHART;
	const keys = [...W.tiles.values()], lo = Math.min(...keys.map((t) => Math.min(t.tx, t.tz))), hi = Math.max(...keys.map((t) => Math.max(t.tx, t.tz)));
	const span = hi - lo + 1, cell = size / span;
	chartAt = { lo, cell };
	const cx = (tx) => at[0] + (tx - lo) * cell, cz = (tz) => at[1] + (tz - lo) * cell;
	ctx.save();
	ctx.fillStyle = 'rgba(230, 220, 196, 0.92)';
	ctx.fillRect(at[0] - 12, at[1] - 12, size + 24, size + 60);
	charcoal(ctx, [[at[0] - 12, at[1] - 12], [at[0] + size + 12, at[1] - 12], [at[0] + size + 12, at[1] + size + 48], [at[0] - 12, at[1] + size + 48], [at[0] - 12, at[1] - 12]], { width: 2, passes: 2, alpha: 0.7 });
	for (const t of keys) {
		const x = cx(t.tx), z = cz(t.tz);
		if (t.kind == 'sea') { ctx.globalAlpha = 0.25; for (let s = 2; s < cell; s += 5) charcoal(ctx, [[x + 2, z + s], [x + cell - 2, z + s]], { width: 0.6, passes: 1, alpha: 0.5, jitter: 0.3 }); continue; }
		ctx.globalAlpha = 0.18 + 0.06 * (t.continent % 4);
		ctx.fillStyle = ink;
		ctx.fillRect(x + 1, z + 1, cell - 2, cell - 2);
	}
	ctx.globalAlpha = 1;
	// (the towns: where the survey or the land put them)
	ctx.font = 'italic 12px "Segoe Print", "Bradley Hand", cursive';
	for (const t of terrain.townSlots) {
		if (t.none || (!t.surveyed && !t.loaded)) continue;
		const mid = town.townMiddle(t), x = at[0] + (mid.x / S + 0.5 - lo) * cell, z = at[1] + (mid.z / S + 0.5 - lo) * cell;
		ctx.fillStyle = ink;
		ctx.beginPath(); ctx.arc(x, z, 3, 0, Math.PI * 2); ctx.fill();
		ctx.fillText(town.townName(t.slot), x + 4, z - 3);
	}
	ctx.font = 'italic 22px "Segoe Print", "Bradley Hand", cursive';
	ctx.fillStyle = ink;
	ctx.fillText('The Known World', at[0], at[1] + size + 34);
	ctx.restore();
}
// (what the map shows now, ringed on the chart, as the tile it showed was: the same wobble every frame)
function ringChart(ctx) {
	if (!terrain.world || !chartAt) return;
	const S = TILE(), { size, at } = CHART, { lo, cell } = chartAt, half = SIZE / 2 / view.scale;
	const fx = (x) => Math.min(Math.max(at[0] + (x / S + 0.5 - lo) * cell, at[0] - 6), at[0] + size + 6), fz = (z) => Math.min(Math.max(at[1] + (z / S + 0.5 - lo) * cell, at[1] - 6), at[1] + size + 6);
	const x0 = fx(view.x - half) - 3, x1 = fx(view.x + half) + 3, z0 = fz(view.z - half) - 3, z1 = fz(view.z + half) + 3;
	rand = seeded(17);
	charcoal(ctx, [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]], { width: 2.6, passes: 3, alpha: 0.9 });
	rand = Math.random;
}
const sheet = document.createElement('canvas');
sheet.width = sheet.height = SIZE;

// a charcoal stroke: the line gone over a few times, each a little off, faint and heavy in places
function charcoal(ctx, points, { width = 1.6, passes = 3, alpha = 0.55, jitter = 1.2, dash = null } = {}) {
	for (let pass = 0; pass < passes; pass++) {
		ctx.beginPath();
		ctx.lineWidth = width * (0.7 + rand() * 0.6);
		ctx.globalAlpha = alpha * (0.6 + rand() * 0.4);
		ctx.setLineDash(dash ?? []);
		points.forEach(([x, y], k) => {
			const jx = x + (rand() - 0.5) * jitter, jy = y + (rand() - 0.5) * jitter;
			if (k == 0) ctx.moveTo(jx, jy); else ctx.lineTo(jx, jy);
		});
		ctx.stroke();
	}
	ctx.globalAlpha = 1;
	ctx.setLineDash([]);
}

// THE PAPER: warm, uneven, folded twice
const paper = canvasOf(SIZE);
function drawPaper() {
	const ctx = paper.getContext('2d');
	ctx.fillStyle = '#e6dcc4';
	ctx.fillRect(0, 0, SIZE, SIZE);
	for (let k = 0; k < 9000; k++) { ctx.fillStyle = `rgba(${90 + Math.random() * 60}, ${70 + Math.random() * 40}, 40, ${Math.random() * 0.06})`; ctx.fillRect(Math.random() * SIZE, Math.random() * SIZE, 2 + Math.random() * 6, 1 + Math.random() * 3); }
	ctx.strokeStyle = 'rgba(90, 70, 50, 0.18)';
	for (const f of [SIZE / 3, SIZE * 2 / 3]) { ctx.beginPath(); ctx.moveTo(f, 0); ctx.lineTo(f, SIZE); ctx.stroke(); }
	ctx.beginPath(); ctx.moveTo(0, SIZE / 2); ctx.lineTo(SIZE, SIZE / 2); ctx.stroke();
}
// THE MARKS over the drawing: the north arrow, the title, the chart, the smudges of the charcoal
const marks = canvasOf(SIZE);
function drawMarks() {
	const ctx = marks.getContext('2d');
	ctx.clearRect(0, 0, SIZE, SIZE);
	ctx.strokeStyle = ink;
	ctx.lineCap = 'round'; ctx.lineJoin = 'round';
	ctx.font = 'bold 40px "Segoe Print", "Bradley Hand", cursive';
	ctx.fillStyle = ink;
	ctx.fillText('N', SIZE - 90, 90);
	charcoal(ctx, [[SIZE - 78, 170], [SIZE - 78, 100]], { width: 3, passes: 3, alpha: 0.8 });
	charcoal(ctx, [[SIZE - 90, 118], [SIZE - 78, 100], [SIZE - 66, 118]], { width: 3, passes: 3, alpha: 0.8 });
	ctx.font = 'italic 34px "Segoe Print", "Bradley Hand", cursive';
	ctx.fillText('Survey of the Country', 50, SIZE - 50);
	if (terrain.world) chart(ctx);
	for (let k = 0; k < 40; k++) {
		const x = Math.random() * SIZE, y = Math.random() * SIZE, r = 30 + Math.random() * 90;
		const g = ctx.createRadialGradient(x, y, 0, x, y, r);
		g.addColorStop(0, 'rgba(40, 32, 26, 0.06)'); g.addColorStop(1, 'rgba(40, 32, 26, 0)');
		ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
	}
}

// A TILE OF LAND, in ink (see INKS at the top): its own sheet, SIZE across in its drawing (made px across), N heights across it
function drawLand(ctx, key, land, tx, tz, N, near) {
	const TILE_S = TILE(), all = terrain.land;
	const half = TILE_S / 2, m = settings.forestUnitsPerMetre, sea = settings.waterWorldPosY;
	const ox = tx * TILE_S, oz = tz * TILE_S;		// (the tile drawn: its middle)
	const px = (x) => (x - ox + half) / (half * 2) * SIZE, pz = (z) => (z - oz + half) / (half * 2) * SIZE;
	const inTile = (x, z, out = 0) => Math.abs(x - ox) <= half + out && Math.abs(z - oz) <= half + out;
	ctx.strokeStyle = ink;
	ctx.lineCap = 'round'; ctx.lineJoin = 'round';

	// the heights over the sea (metres) on a grid across it, and the zones
	const cell = SIZE / (N - 1), H = new Float32Array(N * N), Z = new Uint8Array(N * N);
	for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
		const x = ox - half + i / (N - 1) * half * 2, z = oz - half + j / (N - 1) * half * 2;
		H[j * N + i] = (land.heightAt(x, z) - sea) / m;
		Z[j * N + i] = land.zoneAt(x, z);
	}
	// the sea: hatched across (a row every second point of the close drawing's grid, whatever this one's: the same on every sheet)
	ctx.globalAlpha = 0.18;
	const rowStep = 2 * SIZE / (GRID - 1);
	for (let y = 0; y <= SIZE + 0.01; y += rowStep) {
		const j = Math.min(Math.round(y / cell), N - 1);
		let run = null;
		for (let i = 0; i <= N; i++) {
			const wet = i < N && H[j * N + i] < 0 && Z[j * N + i] != terrain.ZONE_LAKE;
			if (wet && run === null) run = i;
			if (!wet && run !== null) { ctx.beginPath(); ctx.lineWidth = 1; ctx.moveTo(run * cell, y + rand()); ctx.lineTo((i - 1) * cell, y + rand()); ctx.stroke(); run = null; }
		}
	}
	ctx.globalAlpha = 1;
	// the contours (marching squares), the shore heaviest
	const level = (v) => {
		const segs = [];
		for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
			const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i + 1], d = H[(j + 1) * N + i];
			const code = (a > v) | ((b > v) << 1) | ((c > v) << 2) | ((d > v) << 3);
			if (code == 0 || code == 15) continue;
			const t = (p, q) => (v - p) / (q - p || 1e-6);
			const top = [(i + t(a, b)) * cell, j * cell], right = [(i + 1) * cell, (j + t(b, c)) * cell], bottom = [(i + t(d, c)) * cell, (j + 1) * cell], left = [i * cell, (j + t(a, d)) * cell];
			const edges = { 1: [left, top], 2: [top, right], 3: [left, right], 4: [right, bottom], 5: [left, top, right, bottom], 6: [top, bottom], 7: [left, bottom],
				8: [bottom, left], 9: [top, bottom], 10: [top, right, bottom, left], 11: [right, bottom], 12: [right, left], 13: [top, right], 14: [left, top] }[code];
			for (let k = 0; k < edges.length; k += 2) segs.push([edges[k], edges[k + 1]]);
		}
		return segs;
	};
	let most = 0;
	for (const h of H) most = Math.max(most, h);
	for (let v = CONTOUR; v < most; v += CONTOUR) {
		const heavy = Math.round(v / CONTOUR) % INDEX == 0;
		for (const seg of level(v)) charcoal(ctx, seg, { width: heavy ? 1.5 : 0.8, passes: heavy ? 2 : 1, alpha: heavy ? 0.55 : 0.32, jitter: 0.6 });
	}
	for (const seg of level(0)) charcoal(ctx, seg, { width: 2.6, passes: 3, alpha: 0.75, jitter: 1.0 });
	// the steep slopes: short strokes down them (as many on the sheet whatever its grid: every second point of the close one's)
	const every = Math.max(1, Math.round(2 * (N - 1) / (GRID - 1)));
	for (let j = 1; j < N - 1; j += every) for (let i = 1; i < N - 1; i += every) {
		const gx = (H[j * N + i + 1] - H[j * N + i - 1]) / (2 * cell), gz = (H[(j + 1) * N + i] - H[(j - 1) * N + i]) / (2 * cell);
		const g = Math.hypot(gx, gz);
		if (g < 0.5 || H[j * N + i] < 0) continue;
		const l = Math.min(g * 2.2, 7), x = i * cell, y = j * cell;
		charcoal(ctx, [[x, y], [x - gx / g * l, y - gz / g * l]], { width: 0.9, passes: 1, alpha: Math.min(0.15 + g * 0.08, 0.5), jitter: 0.4 });
	}
	// the ponds: outlined and rippled
	for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
		if (Z[j * N + i] != terrain.ZONE_LAKE || H[j * N + i] >= 0.5) continue;
		const edge = [Z[j * N + i + 1], Z[(j + 1) * N + i], Z[j * N + i - 1], Z[(j - 1) * N + i]].some((z) => z != terrain.ZONE_LAKE);
		if (edge) charcoal(ctx, [[i * cell - 1, j * cell], [i * cell + cell + 1, j * cell + 0.5]], { width: 2, passes: 2, alpha: 0.6 });
		else if ((i + j) % 3 == 0) charcoal(ctx, [[i * cell - 2, j * cell], [i * cell, j * cell - 1], [i * cell + 2, j * cell]], { width: 0.8, passes: 1, alpha: 0.4 });
	}
	// the towns: their ground shaded, their streets, and their names (those in this tile; one not here yet, where the survey found it)
	(all.towns ?? []).forEach((t, k) => {
		if (!t.buildings?.length) {
			if (!terrain.world || t.tile !== key || t.none || (!t.surveyed && !t.loaded)) return;
			const mid = town.townMiddle(t), cx = px(mid.x), cy = pz(mid.z);
			ctx.fillStyle = ink; ctx.globalAlpha = 0.85;
			ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.fill();
			ctx.font = 'italic 30px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
			ctx.fillText(town.townName(t.slot ?? k), cx + 14, cy - 10);
			ctx.globalAlpha = 1;
			return;
		}
		const mid = town.townMiddle(t);
		if (!inTile(mid.x, mid.z, mid.reach)) return;
		const r = mid.reach / (half * 2) * SIZE, cx = px(mid.x), cy = pz(mid.z);
		ctx.save();
		ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
		for (let s = -r; s < r; s += 5) charcoal(ctx, [[cx + s - r, cy - r], [cx + s + r, cy + r]], { width: 0.8, passes: 1, alpha: 0.22, jitter: 1 });
		ctx.restore();
		const ways = townFolk.makeWays(t);
		ways.nodes.forEach((n, a) => { for (const [b] of n.ways) if (b > a) charcoal(ctx, [[px(n.x), pz(n.z)], [px(ways.nodes[b].x), pz(ways.nodes[b].z)]], { width: 2.2, passes: 2, alpha: 0.6, jitter: 0.5 }); });
		ctx.font = 'italic 30px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
		ctx.fillStyle = ink; ctx.globalAlpha = 0.85;
		ctx.fillText(town.townName(k), cx + r * 0.8, cy - r * 0.8);
		ctx.globalAlpha = 1;
	});
	if (!near) return;
	// the airstrips (every tile's here: this one's)
	for (const S of all.strips ?? [all.strip].filter(Boolean)) {
		if (!inTile(S.x, S.z)) continue;
		const along = [S.ax, S.az], across = [-S.az, S.ax], w = S.width / 2;
		const c = (u, v) => [px(S.x + along[0] * u + across[0] * v), pz(S.z + along[1] * u + across[1] * v)];
		charcoal(ctx, [c(-S.half, -w), c(S.half, -w), c(S.half, w), c(-S.half, w), c(-S.half, -w)], { width: 2.4, passes: 3, alpha: 0.75 });
		charcoal(ctx, [c(-S.half * 0.9, 0), c(S.half * 0.9, 0)], { width: 1, passes: 1, alpha: 0.5, dash: [10, 8] });
		ctx.font = 'italic 24px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
		ctx.fillStyle = ink;
		const [lx, ly] = c(0, w * 3);
		ctx.fillText('Airstrip', lx, ly);
	}
	// the paths: dashed (those through this tile: the sheet cuts them off at its edge, the next tile's sheet goes on with them)
	//		(the roads solid and heavier, a tunnel thin and dotted through its mountain; another tile's half of a gate's stretch is its own)
	for (const path of all.paths ?? []) {
		if (path.hidden || !path.points.some(([x, , z]) => inTile(x, z, 200))) continue;
		const line = path.points.map(([x, , z]) => [px(x), pz(z)]);
		if (path.kind == 'rail' || path.rail) charcoal(ctx, line, { width: 2.2, passes: 1, alpha: 0.85, dash: [10, 3], jitter: 0.2 });
		else if (path.kind == 'road' || path.kind == 'bridge') charcoal(ctx, line, { width: 3.2, passes: 2, alpha: 0.75, jitter: 0.6 });
		else if (path.kind == 'tunnel') charcoal(ctx, line, { width: 1.4, passes: 1, alpha: 0.6, dash: [2, 5], jitter: 0.3 });
		else charcoal(ctx, line, { width: 1.6, passes: 2, alpha: 0.6, dash: [7, 6], jitter: 0.8 });
	}
}

// THE SEA, every tile of it and round the world: hatched across, as the sea on the land's sheets. And a tile of land not drawn yet: shaded
const seaInk = canvasOf(SIZE / 2), unknownInk = canvasOf(SIZE / 4);
(() => {
	let ctx = seaInk.getContext('2d');
	ctx.scale(0.5, 0.5); ctx.strokeStyle = ink; ctx.globalAlpha = 0.18;
	const cell = SIZE / (GRID - 1);
	for (let j = 0; j < GRID; j += 2) { ctx.beginPath(); ctx.lineWidth = 1; ctx.moveTo(0, j * cell + Math.random()); ctx.lineTo(SIZE, j * cell + Math.random()); ctx.stroke(); }
	ctx = unknownInk.getContext('2d');
	ctx.scale(0.25, 0.25); ctx.strokeStyle = ink; ctx.lineCap = 'round';
	for (let s = -SIZE; s < SIZE; s += 24) charcoal(ctx, [[s, 0], [s + SIZE, SIZE]], { width: 3, passes: 1, alpha: 0.16, jitter: 4 });
})();

// a tile of the sea on the map: its hatching, as a sheet of ink from further out; nearer, drawn as lines, as sharp as the land's
//		(the same rows, a little off each, the same each frame)
function sea(ctx, tx, tz, sx, sz, w) {
	if (w < SIZE * 1.1) { ctx.drawImage(seaInk, sx, sz, w, w); return; }
	const k = w / SIZE, step = 2 * SIZE / (GRID - 1), r = seeded((tx * 7919 + tz * 104729) >>> 0);
	ctx.save();
	ctx.strokeStyle = ink; ctx.globalAlpha = 0.18; ctx.lineWidth = k;
	ctx.beginPath();
	for (let y = 0; y <= SIZE + 0.01; y += step) {
		const a = r(), b = r(), Y = sz + y * k;
		if (Y < -2 || Y > SIZE + 2) continue;
		ctx.moveTo(Math.max(sx, -2), Y + a * k); ctx.lineTo(Math.min(sx + w, SIZE + 2), Y + b * k);
	}
	ctx.stroke();
	ctx.restore();
}

// INKS (see the top): key -> { land, near, towns, low, close, usedAt }
const inks = new Map();
let inksFor = null;			// (the land they were drawn for: all drawn again for a new one)
const townsKnown = (key) => terrain.world ? terrain.townSlots.filter((t) => t.tile === key && !t.none && (t.surveyed || t.loaded)).length + ':' + terrain.townSlots.filter((t) => t.tile === key && t.buildings?.length).length : '';
function inkOf(key) {
	const found = terrain.mapLandOf(key);
	if (!found?.land) return null;
	let e = inks.get(key);
	const towns = townsKnown(key);
	if (!e || (found.near && !e.near) || e.towns != towns || (found.near && e.land !== found.land)) {
		e = { land: found.land, near: found.near, towns, low: null, close: null, usedAt: 0 };
		inks.set(key, e);
	}
	return e;
}
const closePx = (w) => w >= CLOSER.from ? CLOSER.px : SIZE;
function drawInk(key, e, close, w = 0) {
	const [tx, tz] = terrain.world ? key.split(',').map(Number) : [0, 0];
	const px = close ? closePx(w) : LOW.px, c = canvasOf(px), ctx = c.getContext('2d');
	ctx.scale(px / SIZE, px / SIZE);
	drawLand(ctx, key, e.land, tx, tz, close ? GRID : LOW.grid, e.near);
	if (close) {
		e.close = c;
		// (no more than KEEP_CLOSE kept: the longest unused let go)
		const kept = [...inks.values()].filter((one) => one.close).sort((a, b) => b.usedAt - a.usedAt);
		let budget = KEEP_CLOSE * SIZE * SIZE;		// (the finer ones count for more)
		for (const one of kept) { budget -= one.close.width ** 2; if (budget < 0 && one !== e) one.close = null; }
	} else e.low = c;
}

// THE VIEW (see the top): where its middle is (world units) and how big it is drawn (pixels of the paper a world unit), where it is going
const view = { x: 0, z: 0, scale: 1, toScale: 1, anchor: null, vx: 0, vz: 0, drag: null, dirty: true, wanted: [] };
const limits = () => {
	const [lo, hi] = terrain.worldEdges();
	return { lo, hi, least: SIZE / ((hi - lo) * 1.06), most: ZOOM_IN * SIZE / TILE() };
};
function clampView() {
	const { lo, hi, least, most } = limits();
	view.scale = Math.min(Math.max(view.scale, least), most);
	view.toScale = Math.min(Math.max(view.toScale, least), most);
	view.x = Math.min(Math.max(view.x, lo), hi);
	view.z = Math.min(Math.max(view.z, lo), hi);
}
// the paper put together: the paper, the tiles' ink where they are, the marks, the ring on the chart
function compose() {
	const ctx = sheet.getContext('2d');
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalAlpha = 1;
	ctx.drawImage(paper, 0, 0);
	const S = TILE(), k = view.scale, left = view.x - SIZE / 2 / k, top = view.z - SIZE / 2 / k, w = S * k;
	const tx0 = Math.floor(left / S + 0.5), tx1 = Math.floor((left + SIZE / k) / S + 0.5), tz0 = Math.floor(top / S + 0.5), tz1 = Math.floor((top + SIZE / k) / S + 0.5);
	const wanted = [], now = performance.now();
	for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
		const sx = ((tx - 0.5) * S - left) * k, sz = ((tz - 0.5) * S - top) * k;
		const key = keyOf(tx, tz), isLand = terrain.world ? terrain.world.tiles.get(key)?.kind == 'land' : tx == 0 && tz == 0;
		if (!isLand) { sea(ctx, tx, tz, sx, sz, w); continue; }
		const e = inkOf(key);
		if (!e) { ctx.drawImage(unknownInk, sx, sz, w, w); continue; }
		e.usedAt = now;
		const close = w >= CLOSE_FROM;
		const away = Math.hypot(sx + w / 2 - SIZE / 2, sz + w / 2 - SIZE / 2);
		if (!e.low) wanted.push({ key, e, close: false, away, w });
		if (close && (!e.close || e.close.width < closePx(w))) wanted.push({ key, e, close: true, away, w });
		const img = (close ? e.close : null) ?? e.low ?? e.close;
		ctx.drawImage(img ?? unknownInk, sx, sz, w, w);
	}
	view.wanted = wanted.sort((a, b) => a.close - b.close || a.away - b.away);
	ctx.drawImage(marks, 0, 0);
	ctx.strokeStyle = ink; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
	ringChart(ctx);
}
// a frame of it open: the view moved on, a few tiles' ink drawn, put together again if anything changed
function mapFrame(dt) {
	if (inksFor !== terrain.land) { inks.clear(); inksFor = terrain.land; view.dirty = true; }
	const before = [view.x, view.z, view.scale];
	if (view.anchor) {
		// (the wheel: the scale eased in its logarithm, the point under the mouse kept there)
		const a = view.anchor, s = Math.exp(Math.log(view.scale) + (Math.log(view.toScale) - Math.log(view.scale)) * Math.min(dt * EASE, 1));
		view.scale = Math.abs(Math.log(s / view.toScale)) < 1e-4 ? view.toScale : s;
		view.x = a.wx - (a.sx - SIZE / 2) / view.scale;
		view.z = a.wz - (a.sz - SIZE / 2) / view.scale;
		if (view.scale == view.toScale) view.anchor = null;
	} else if (!view.drag && (view.vx || view.vz)) {
		view.x += view.vx * dt; view.z += view.vz * dt;
		const slow = Math.exp(-GLIDE * dt);
		view.vx *= slow; view.vz *= slow;
		if (Math.hypot(view.vx, view.vz) * view.scale < 4) view.vx = view.vz = 0;
	}
	clampView();
	if (before[0] != view.x || before[1] != view.z || before[2] != view.scale) view.dirty = true;
	// (the tiles' ink still wanted: a close one at a time, or a few far ones, in a few milliseconds)
	const t0 = performance.now();
	for (const w of view.wanted) {
		if (performance.now() - t0 > 12) break;
		if (w.close ? w.e.close?.width >= closePx(w.w) : w.e.low) continue;
		drawInk(w.key, w.e, w.close, w.w);
		view.dirty = true;
		if (w.close) break;
	}
	view.wanted = [];
	if (view.dirty) { compose(); view.dirty = false; }
}
// opened: the paper and the marks drawn again, the view on the walker's tile filling the paper (as the map always opened), that tile drawn
function prepare() {
	if (!terrain.land) return;
	if (inksFor !== terrain.land) { inks.clear(); inksFor = terrain.land; }
	drawPaper();
	drawMarks();
	const S = TILE(), p0 = hunting.hunterPlace();
	const tile = terrain.world ? [Math.round(p0.x / S), Math.round(p0.z / S)] : [0, 0];
	Object.assign(view, { x: tile[0] * S, z: tile[1] * S, scale: SIZE / S, toScale: SIZE / S, anchor: null, vx: 0, vz: 0, drag: null, dirty: true });
	const key = keyOf(tile[0], tile[1]), e = inkOf(key);
	if (e && !e.close) drawInk(key, e, true);
	compose();
	view.dirty = false;
}

// THE MOUSE on it: drag to move about, the wheel to come nearer and go further out
const toPaper = (e) => { const r = sheet.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * SIZE, (e.clientY - r.top) / r.height * SIZE]; };
sheet.addEventListener('pointerdown', (e) => {
	if (e.button != 0) return;
	view.drag = { at: toPaper(e), t: performance.now() };
	view.anchor = null; view.vx = view.vz = 0;
	view.toScale = view.scale;
	sheet.setPointerCapture?.(e.pointerId);
	sheet.style.cursor = 'grabbing';
	e.preventDefault();
});
sheet.addEventListener('pointermove', (e) => {
	if (!view.drag) return;
	const at = toPaper(e), now = performance.now(), dt = Math.max((now - view.drag.t) / 1000, 1e-3);
	const dx = (at[0] - view.drag.at[0]) / view.scale, dz = (at[1] - view.drag.at[1]) / view.scale;
	view.x -= dx; view.z -= dz;
	view.vx = view.vx * 0.5 + (-dx / dt) * 0.5; view.vz = view.vz * 0.5 + (-dz / dt) * 0.5;
	view.drag = { at, t: now };
	clampView();
	view.dirty = true;
});
const letGo = (e) => {
	if (!view.drag) return;
	if (performance.now() - view.drag.t > 80) view.vx = view.vz = 0;		// (held still before letting go: no glide)
	view.drag = null;
	sheet.style.cursor = 'grab';
	sheet.releasePointerCapture?.(e.pointerId);
};
sheet.addEventListener('pointerup', letGo);
sheet.addEventListener('pointercancel', letGo);
sheet.addEventListener('wheel', (e) => {
	e.preventDefault(); e.stopPropagation();
	const [sx, sz] = toPaper(e);
	const { least, most } = limits();
	// (the point under the mouse, where the view is going)
	const s = view.scale, wx = view.x + (sx - SIZE / 2) / s, wz = view.z + (sz - SIZE / 2) / s;
	view.toScale = Math.min(Math.max(view.toScale * Math.exp(-e.deltaY * 0.0015), least), most);
	view.anchor = { wx, wz, sx, sz };
	view.vx = view.vz = 0;
}, { passive: false });

// THE SCREEN
const overlay = document.createElement('div');
overlay.style.cssText = 'position: fixed; inset: 0; z-index: 15; display: none; background: rgba(12, 10, 8, 0.75); align-items: center; justify-content: center; transition: opacity 0.25s;';
sheet.style.cssText = 'max-width: 96vw; max-height: 94vh; width: auto; height: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.6); border-radius: 2px; cursor: grab; touch-action: none;';
overlay.appendChild(sheet);
// (and a button to put it away: the mouse is let go while the map is out, so it can be clicked)
const closer = document.createElement('button');
closer.textContent = '✕  Close map';
closer.style.cssText = 'position: absolute; top: 18px; right: 22px; padding: 8px 14px; border: 1px solid #8a7452; border-radius: 4px; background: rgba(60, 46, 30, 0.92); color: #f0e4c8; font: 14px Georgia, serif; letter-spacing: 0.06em; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.5);';
closer.addEventListener('click', () => closeMap());
overlay.appendChild(closer);
document.body.appendChild(overlay);

// THE MAP IN THE HANDS (see the top)
const held = new vm.Viewmodel('held map', MESHES.map.data);
const state = { phase: 'away', t: 0, before: 'none' };
export const mapState = state;
export function openMap() {
	if (!inventory.survivalOn() || !hunting.hunterPlace().active || state.phase != 'away') return false;
	prepare();
	state.before = weapons.weaponState.current;
	weapons.equipWeapon('none');
	state.phase = 'pulling'; state.t = 0;
	hunting.input.menuOpen = true;
	if (document.pointerLockElement) document.exitPointerLock();
	return true;
}
export function closeMap() {
	if (state.phase == 'away' || state.phase == 'putting') return;
	state.phase = 'putting'; state.t = 0;
	overlay.style.opacity = '0';
	setTimeout(() => { if (state.phase != 'open') overlay.style.display = 'none'; }, 260);
}
survival.setMapChoice({ label: 'Map', detail: 'Pull out the map', act: () => openMap() });
window.addEventListener('keydown', (e) => {
	if (e.code == 'KeyM' && !e.repeat && !e.target?.matches?.('input')) { if (state.phase == 'away') { if (document.pointerLockElement == canvas) openMap(); } else closeMap(); }
	if ((e.code == 'Escape' || e.code == 'Tab' || e.code == 'KeyF') && (state.phase == 'open' || state.phase == 'pulling')) { e.preventDefault(); closeMap(); }
});
window.addEventListener('mousedown', (e) => { if (e.button == 2 && state.phase == 'open') closeMap(); }, true);
let lastTime = performance.now();
export function mapUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (state.phase == 'away') return;
	if (state.phase == 'open') mapFrame(dt);
	if (!inventory.survivalOn() || !hunting.hunterLife.alive) { state.phase = 'putting'; state.t = PULL; }
	state.t += dt;
	if (state.phase == 'pulling' && state.t >= PULL) {
		state.phase = 'open';
		overlay.style.display = 'flex';
		overlay.style.opacity = '0';
		requestAnimationFrame(() => { overlay.style.opacity = '1'; });
	}
	if (state.phase == 'putting' && state.t >= PULL) {
		state.phase = 'away';
		overlay.style.display = 'none';
		hunting.input.menuOpen = false;
		hunting.releaseKeys();
		if (hunting.hunterLife.alive && inventory.survivalOn()) canvas.requestPointerLock?.()?.catch?.(() => {});
		if (state.before != 'none') weapons.equipWeapon(state.before);
	}
}
// over the finished frame (rotatingCube.js, with the guns): the map being pulled out, or put away
export function mapPass() {
	if (state.phase != 'pulling' && state.phase != 'putting') return;
	const k = vm.ease(state.phase == 'pulling' ? state.t / PULL : 1 - state.t / PULL);
	const unfold = vm.ease(Math.max(k * 1.6 - 0.6, 0));
	const parts = [];
	for (const [s, part] of [[-1, 1], [1, 2]]) {
		const hinge = s * 0.11;
		parts[part] = mat4.multiply(mat4.translation([hinge, 0, 0]), mat4.multiply(mat4.rotationY(s * (1 - unfold) * 2.9), mat4.translation([-hinge, 0, 0])));
	}
	let mtx = mat4.translation([0.05 * (1 - k), -0.38 + k * 0.36, -0.55 + k * 0.2]);
	mtx = mat4.rotateX(mtx, -1.1 * (1 - k) - 0.05);
	mtx = mat4.scale(mtx, [1, 1, -1]);
	held.draw(mtx, parts);
}
export const mapForTest = () => ({ phase: state.phase, drawn: inksFor === terrain.land, view: { x: view.x, z: view.z, scale: view.scale }, inks: [...inks.values()].map((e) => (e.close ? 'C' : '') + (e.low ? 'L' : '')).join('') });
export function drawMapForTest() { prepare(); return sheet.toDataURL('image/png'); }
// (for a test: the view put somewhere (scale: paper pixels a world unit), every tile's ink drawn there, and the paper as it is then)
export function viewMapForTest(x, z, scale) {
	if (inksFor !== terrain.land) prepare();
	Object.assign(view, { x, z, scale, toScale: scale, anchor: null, vx: 0, vz: 0 });
	clampView();
	for (let k = 0; k < 400; k++) { compose(); if (!view.wanted.length) break; for (const w of view.wanted) if (!(w.close ? w.e.close?.width >= closePx(w.w) : w.e.low)) drawInk(w.key, w.e, w.close, w.w); }
	compose();
	return sheet.toDataURL('image/png');
}
export const mapFrameForTest = (dt) => mapFrame(dt);
export const mapViewForTest = () => view;
