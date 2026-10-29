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
	It is drawn by hand in charcoal (drawMap), once for each land, from above, north up (-z), and shows only:
		the lie of the land		contour lines every CONTOUR metres over the sea (every INDEX of them heavier), and hatching down the
								steep slopes
		the shore				heavy, and the sea hatched across
		the ponds				the lakes (the land's lake zone), outlined, their water rippled
		the towns				each one's ground shaded across, its streets, and its name
		the airstrip			outlined, and named
		the paths				dashed
	There is nothing of where the walker is on it: it has to be read.
*/
const SIZE = 1600;					// pixels across the map's drawing
const GRID = 300;					// heights looked at across it
const CONTOUR = 25, INDEX = 4;		// metres, and every how many a heavy one
const PULL = 0.55, OPEN = 0.25;		// seconds

const ink = '#2b2520';
let drawnFor = null;
const sheet = document.createElement('canvas');
sheet.width = sheet.height = SIZE;

// a charcoal stroke: the line gone over a few times, each a little off, faint and heavy in places
function charcoal(ctx, points, { width = 1.6, passes = 3, alpha = 0.55, jitter = 1.2, dash = null } = {}) {
	for (let pass = 0; pass < passes; pass++) {
		ctx.beginPath();
		ctx.lineWidth = width * (0.7 + Math.random() * 0.6);
		ctx.globalAlpha = alpha * (0.6 + Math.random() * 0.4);
		ctx.setLineDash(dash ?? []);
		points.forEach(([x, y], k) => {
			const jx = x + (Math.random() - 0.5) * jitter, jy = y + (Math.random() - 0.5) * jitter;
			if (k == 0) ctx.moveTo(jx, jy); else ctx.lineTo(jx, jy);
		});
		ctx.stroke();
	}
	ctx.globalAlpha = 1;
	ctx.setLineDash([]);
}
function drawMap() {
	const land = terrain.land;
	if (!land || drawnFor === land) return;
	drawnFor = land;
	const ctx = sheet.getContext('2d');
	const half = settings.terrainWorldSize / 2, m = settings.forestUnitsPerMetre, sea = settings.waterWorldPosY;
	const px = (x) => (x + half) / (half * 2) * SIZE, pz = (z) => (z + half) / (half * 2) * SIZE;
	// the paper: warm, uneven, folded twice
	ctx.fillStyle = '#e6dcc4';
	ctx.fillRect(0, 0, SIZE, SIZE);
	for (let k = 0; k < 9000; k++) { ctx.fillStyle = `rgba(${90 + Math.random() * 60}, ${70 + Math.random() * 40}, 40, ${Math.random() * 0.06})`; ctx.fillRect(Math.random() * SIZE, Math.random() * SIZE, 2 + Math.random() * 6, 1 + Math.random() * 3); }
	ctx.strokeStyle = 'rgba(90, 70, 50, 0.18)';
	for (const f of [SIZE / 3, SIZE * 2 / 3]) { ctx.beginPath(); ctx.moveTo(f, 0); ctx.lineTo(f, SIZE); ctx.stroke(); }
	ctx.beginPath(); ctx.moveTo(0, SIZE / 2); ctx.lineTo(SIZE, SIZE / 2); ctx.stroke();
	ctx.strokeStyle = ink;
	ctx.lineCap = 'round'; ctx.lineJoin = 'round';

	// the heights over the sea (metres) on a grid across it, and the zones
	const N = GRID, cell = SIZE / (N - 1), H = new Float32Array(N * N), Z = new Uint8Array(N * N);
	for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
		const x = -half + i / (N - 1) * half * 2, z = -half + j / (N - 1) * half * 2;
		H[j * N + i] = (land.heightAt(x, z) - sea) / m;
		Z[j * N + i] = land.zoneAt(x, z);
	}
	// the sea: hatched across
	ctx.globalAlpha = 0.18;
	for (let j = 0; j < N; j += 2) {
		let run = null;
		for (let i = 0; i <= N; i++) {
			const wet = i < N && H[j * N + i] < 0 && Z[j * N + i] != terrain.ZONE_LAKE;
			if (wet && run === null) run = i;
			if (!wet && run !== null) { ctx.beginPath(); ctx.lineWidth = 1; ctx.moveTo(run * cell, j * cell + Math.random()); ctx.lineTo((i - 1) * cell, j * cell + Math.random()); ctx.stroke(); run = null; }
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
	// the steep slopes: short strokes down them
	for (let j = 1; j < N - 1; j += 2) for (let i = 1; i < N - 1; i += 2) {
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
	// the towns: their ground shaded, their streets, and their names
	(land.towns ?? []).forEach((t, k) => {
		if (!t.buildings?.length) return;
		const mid = town.townMiddle(t), r = mid.reach / (half * 2) * SIZE, cx = px(mid.x), cy = pz(mid.z);
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
	// the airstrip
	const S = land.strip;
	if (S) {
		const along = [S.ax, S.az], across = [-S.az, S.ax], w = S.width / 2;
		const c = (u, v) => [px(S.x + along[0] * u + across[0] * v), pz(S.z + along[1] * u + across[1] * v)];
		charcoal(ctx, [c(-S.half, -w), c(S.half, -w), c(S.half, w), c(-S.half, w), c(-S.half, -w)], { width: 2.4, passes: 3, alpha: 0.75 });
		charcoal(ctx, [c(-S.half * 0.9, 0), c(S.half * 0.9, 0)], { width: 1, passes: 1, alpha: 0.5, dash: [10, 8] });
		ctx.font = 'italic 24px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
		ctx.fillStyle = ink;
		const [lx, ly] = c(0, w * 3);
		ctx.fillText('Airstrip', lx, ly);
	}
	// the paths: dashed
	for (const path of land.paths ?? []) charcoal(ctx, path.points.map(([x, , z]) => [px(x), pz(z)]), { width: 1.6, passes: 2, alpha: 0.6, dash: [7, 6], jitter: 0.8 });
	// the north arrow, and a title
	ctx.font = 'bold 40px "Segoe Print", "Bradley Hand", cursive';
	ctx.fillStyle = ink;
	ctx.fillText('N', SIZE - 90, 90);
	charcoal(ctx, [[SIZE - 78, 170], [SIZE - 78, 100]], { width: 3, passes: 3, alpha: 0.8 });
	charcoal(ctx, [[SIZE - 90, 118], [SIZE - 78, 100], [SIZE - 66, 118]], { width: 3, passes: 3, alpha: 0.8 });
	ctx.font = 'italic 34px "Segoe Print", "Bradley Hand", cursive';
	ctx.fillText('Survey of the Country', 50, SIZE - 50);
	// the smudges of the charcoal
	for (let k = 0; k < 40; k++) {
		const x = Math.random() * SIZE, y = Math.random() * SIZE, r = 30 + Math.random() * 90;
		const g = ctx.createRadialGradient(x, y, 0, x, y, r);
		g.addColorStop(0, 'rgba(40, 32, 26, 0.06)'); g.addColorStop(1, 'rgba(40, 32, 26, 0)');
		ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
	}
}

// THE SCREEN
const overlay = document.createElement('div');
overlay.style.cssText = 'position: fixed; inset: 0; z-index: 15; display: none; background: rgba(12, 10, 8, 0.75); align-items: center; justify-content: center; transition: opacity 0.25s;';
sheet.style.cssText = 'max-width: 96vw; max-height: 94vh; width: auto; height: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.6); border-radius: 2px;';
overlay.appendChild(sheet);
// (and a button to put it away: the mouse is let go while the map is out, so it can be clicked)
const closer = document.createElement('button');
closer.textContent = '✕  Close map';
closer.style.cssText = 'position: absolute; top: 18px; right: 22px; padding: 8px 14px; border: 1px solid #8a7452; border-radius: 4px; background: rgba(60, 46, 30, 0.92); color: #f0e4c8; font: 14px Georgia, serif; letter-spacing: 0.06em; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.5);';
closer.addEventListener('click', () => closeMap());
overlay.appendChild(closer);
document.body.appendChild(overlay);

// THE MAP IN THE HANDS (see the top)
const view = new vm.Viewmodel('held map', MESHES.map.data);
const state = { phase: 'away', t: 0, before: 'none' };
export const mapState = state;
export function openMap() {
	if (!inventory.survivalOn() || !hunting.hunterPlace().active || state.phase != 'away') return false;
	drawMap();
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
	if (e.code == 'Escape' && (state.phase == 'open' || state.phase == 'pulling')) closeMap();
});
window.addEventListener('mousedown', (e) => { if (e.button == 2 && state.phase == 'open') closeMap(); }, true);
let lastTime = performance.now();
export function mapUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (state.phase == 'away') return;
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
	view.draw(mtx, parts);
}
export const mapForTest = () => ({ phase: state.phase, drawn: drawnFor === terrain.land });
export function drawMapForTest() { drawMap(); return sheet.toDataURL('image/png'); }
