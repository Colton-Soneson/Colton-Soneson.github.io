import {canvas} from './deviceSelection.js'
import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as transformations from './transformations.js'
import * as boat from './boat.js'
import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import * as props from './props.js'
import * as smoke from './smoke.js'
import * as atmosphere from './atmosphere.js'
import * as survivalNet from './survivalNet.js'
import * as treasury from './treasury.js'
import { WHALE_STAGES } from './creatureMeshes.js'

/*
	WHALING: the whales, and the schooner's harpoons (vessels.js: where they stand on her bow, either side).
	THE WHALES: WHALES of them in all the sea, swimming from one deep place to another, down and up to blow. 800 triangles (creatureMeshes.js). One that is gone comes back again a RESPAWN (days) later, far off.
	THE HARPOON GUNS: F at one mans it, the view along it (as her howitzers, shipGuns.js; left click fires). A harpoon flies (SPEED, falling), a cable out to it from her bow all the way (as the anchor's rode: boat.js).
		Its cable runs out at CABLE, or it lands in the sea: it is hauled back. RELOAD seconds after it is back it can be fired again.
	FAST TO A WHALE: a harpoon that meets one sticks. She REELs it in (at REEL, whatever it does), and once it is at her side it dies there, lying alongside, and is cut up: over an ninth of a day (FLENSE: by the
		world's clock) it goes through WHALE_STAGES, four of them, down to just bones, and is gone. All that time oil and blubber go into her chest (OIL, BLUBBER, at the rate it goes), to be seen by E at it.
	LANDED: a player's schooner with anything in her chest within PORT metres of the end of a town's dock, off the side of her hull: it is gone from the chest, and PAID goes to that town's treasury (treasury.js). A crew's is locked to the dock (npcShips.js) and lands it there (landAt).
	A SCHOONER'S CREW (npcShips.js) hunts them (jobFor: chase, hold while reeling and cutting, home), and fires its own (npcFire).
	MULTIPLAYER: the host keeps it all. The whales go with the animals (net.js: whaleShare, whaleFollow). The guns, harpoons and chests are sent GEAR_RATE times a second (whaleGear); a joiner's shot and aim are asked for (harpoonFire, harpoonAim).
	In metres and seconds (their places world units).
*/
const WHALES = 3;
const RESPAWN = 1;					// days
const SWIM = 2.6;					// metres a second
const DEEP = 28;					// metres of water it keeps to
const LEG = 700;					// metres at a time
const SPEED = 62, GRAVITY = 9.81;	// a harpoon: metres a second
const CABLE = 150;					// metres
const HAUL = 22;					// metres a second a harpoon that missed comes back
const REEL = 7;						// metres a second a whale is brought in
const RELOAD = 6;					// seconds
const FLENSE = 1 / 9;				// of a day
const OIL = 40, BLUBBER = 90;		// barrels and hundredweight out of one whale
const PORT = 10, PAID = 300;
const SIDE_REACH = 7;				// metres between her side and a whale brought alongside
const HUNT = 1800;					// metres a crew goes after one from
const NPC_RANGE = 75;				// metres a crew's harpoon is fired from
const YAW = 1.2, PITCH = [-0.6, 0.6];
const GEAR_RATE = 5;
const DRAW = 2200;					// metres

const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const wrap = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const clock = () => atmosphere.sunCycles;
const here = () => survivalNet.authority();
const locked = () => document.pointerLockElement == canvas;
export const whalingStats = { whales: 0, fired: 0, struck: 0, flensed: 0, landed: 0 };

// THE GEAR of a boat (all of it the host's, a joiner's as heard): its guns, each { yaw, pitch, wait (seconds), harpoon: null or { state 'fly', 'fast', 'haul'; at (world units), v (metres a second), whale } }, and its chest
const gear = new Map();		// boat's id -> { guns, chest: { oil, blubber } }
function gearOf(b) {
	let g = gear.get(b.id);
	if (!g) { g = { guns: (b.vessel.harpoons ?? []).map(() => ({ yaw: 0, pitch: 0.1, wait: 0, harpoon: null })), chest: { oil: 0, blubber: 0 } }; gear.set(b.id, g); }
	return g;
}
export const chestOf = (b) => gearOf(b).chest;
const schooners = () => boat.boats.filter((b) => b.vessel.harpoons && b.exists !== false && b.destroyed < 0);
// the gun's way: on the boat, and in the world
const aimLocal = (G) => [Math.sin(G.yaw) * Math.cos(G.pitch), Math.sin(G.pitch), Math.cos(G.yaw) * Math.cos(G.pitch)];
const pivotOf = (b, V) => b.frame.toWorld(V.pivot);
const muzzleOf = (b, V, G) => b.frame.toWorld(V.pivot.map((v, i) => v + aimLocal(G)[i] * 0.6));

//-------------------------------THE WHALES-------------------------------
let whales = [], builtFor = null, nextId = 1, spawnQueue = [];
let followed = null;			// joiner: the host's
const surface = () => settings.waterWorldPosY;
const depthAt = (x, z) => (surface() - terrain.land.heightAt(x, z)) / metre();
function spot() {
	const m = metre(), half = settings.terrainWorldSize * 0.5 - 200 * m;
	for (let k = 0; k < 60; k++) {
		const x = (Math.random() * 2 - 1) * half, z = (Math.random() * 2 - 1) * half;
		if (depthAt(x, z) > DEEP && Math.hypot(x - settings.camPosX, z - settings.camPosZ) > 500 * m) return [x, z];
	}
	return null;
}
function newWhale() {
	const at = spot();
	if (!at) return null;
	return { id: nextId++, x: at[0], z: at[1], y: surface() - 4 * metre(), heading: Math.random() * 6.28, swim: Math.random() * 6.28, dive: Math.random() * 6.28, pitch: 0, roll: 0, own: Math.random(), state: 'swim', target: null, blown: 0, boat: null, side: 1, since: 0, stage: 0 };
}
function build() {
	builtFor = terrain.land;
	whales = []; spawnQueue = [];
	for (let k = 0; k < WHALES; k++) { const w = newWhale(); if (w) whales.push(w); }
}
function swim(w, dt) {
	const m = metre();
	if (!w.target || Math.hypot(w.target[0] - w.x, w.target[1] - w.z) < 30 * m) {
		for (let k = 0; k < 10; k++) {
			const a = Math.random() * 6.28, x = w.x + Math.sin(a) * LEG * m, z = w.z + Math.cos(a) * LEG * m, half = settings.terrainWorldSize * 0.5 - 100 * m;
			if (Math.abs(x) < half && Math.abs(z) < half && depthAt(x, z) > DEEP && depthAt((x + w.x) / 2, (z + w.z) / 2) > DEEP) { w.target = [x, z]; break; }
		}
	}
	const look = [w.x + Math.sin(w.heading) * 60 * m, w.z + Math.cos(w.heading) * 60 * m];
	let want = w.target ? Math.atan2(w.target[0] - w.x, w.target[1] - w.z) : w.heading;
	if (depthAt(look[0], look[1]) < DEEP * 0.6) { want = w.heading + 1.2; w.target = null; }
	w.heading += wrap(want - w.heading) * Math.min(dt * 0.25, 1);
	w.x += Math.sin(w.heading) * SWIM * m * dt;
	w.z += Math.cos(w.heading) * SWIM * m * dt;
	w.swim += dt * 1.1;
	// down and up, and at the top of it a blow
	w.dive += dt * 0.12;
	const under = 1.3 + 5 * (0.5 + 0.5 * Math.sin(w.dive));
	const before = w.y;
	w.y = surface() - under * m;
	w.pitch += (clamp((w.y - before) / Math.max(dt, 1e-3) / (SWIM * m) * 2, -0.35, 0.35) - w.pitch) * Math.min(dt, 1);
}
// brought in: towards a place off her side, level with her middle, floating with its back out of the water
function sideOf(w, b) { const at = b.frame.toWorld([w.side * (Math.abs(b.vessel.beam ?? 3) + SIDE_REACH), 0, 0]); at[1] = surface() - 0.4 * metre(); return at; }
function reel(w, b, dt) {
	const m = metre(), to = sideOf(w, b), dx = to[0] - w.x, dz = to[2] - w.z, far = Math.hypot(dx, dz);
	if (far < 3 * m) { die(w, b); return; }
	const step = Math.min(REEL * m * dt, far);
	w.x += dx / far * step; w.z += dz / far * step;
	w.y += (to[1] - w.y) * Math.min(dt * 0.6, 1);
	w.heading += wrap(Math.atan2(dx, dz) - w.heading) * Math.min(dt * 0.8, 1);
	w.swim += dt * 3.5;
}
function die(w, b) {
	w.state = 'dead';
	w.since = clock();
	w.stage = 1;
	w.lastShare = 0;
	whalingStats.flensed++;
	const g = gearOf(b);
	g.guns.forEach((G) => { if (G.harpoon?.whale === w.id) { G.harpoon = null; G.wait = RELOAD; } });
}
// cut up (see the top), its oil and blubber in her chest by how far gone it is
function flense(w, b, dt) {
	const k = (clock() - w.since) / FLENSE, m = metre();
	if (b?.exists !== false && b?.destroyed < 0) {
		const to = sideOf(w, b), heading = b.frame.heading();
		w.x += (to[0] - w.x) * Math.min(dt * 2, 1); w.y += (to[1] - w.y) * Math.min(dt * 2, 1); w.z += (to[2] - w.z) * Math.min(dt * 2, 1);
		w.heading += wrap(heading - w.heading) * Math.min(dt, 1);
		const C = gearOf(b).chest, share = Math.min(k, 1) - (w.lastShare ?? 0);
		if (share > 0) { C.oil += OIL * share; C.blubber += BLUBBER * share; w.lastShare = Math.min(k, 1); }
	}
	w.roll += (1.15 - w.roll) * Math.min(dt * 0.4, 1);
	w.pitch += (0 - w.pitch) * Math.min(dt, 1);
	w.stage = clamp(Math.floor(k * WHALE_STAGES.length) + 1, 1, WHALE_STAGES.length);
	if (k >= 1) {
		whales.splice(whales.indexOf(w), 1);
		spawnQueue.push(clock() + RESPAWN);
	}
}

//-------------------------------THE HARPOONS-------------------------------
export function fire(b, k, shooter = 'me') {
	const V = b.vessel.harpoons?.[k], g = gearOf(b), G = g.guns[k];
	if (!V || G.harpoon || G.wait > 0) return false;
	if (!here()) { survivalNet.send('harpoonFire', { boat: b.id, gun: k, yaw: G.yaw, pitch: G.pitch }); return true; }
	const dir = b.frame.directionToWorld(aimLocal(G));
	const v = b.frame.velocityAt ? b.frame.velocityAt(V.pivot) : [0, 0, 0], m = metre();
	G.harpoon = { state: 'fly', at: muzzleOf(b, V, G), v: dir.map((d, i) => d * SPEED + (v[i] ?? 0) / m), whale: null };
	whalingStats.fired++;
	return true;
}
survivalNet.on('harpoonFire', (m) => {
	if (!here()) return;
	const b = boat.boatById(m.boat);
	if (!b) return;
	const G = gearOf(b).guns[m.gun];
	if (G) { G.yaw = clamp(Number(m.yaw) || 0, -YAW, YAW); G.pitch = clamp(Number(m.pitch) || 0, ...PITCH); fire(b, m.gun); }
});
survivalNet.on('harpoonAim', (m) => {
	if (!here()) return;
	const b = boat.boatById(m.boat), G = b && gearOf(b).guns[m.gun];
	if (G) { G.yaw = clamp(Number(m.yaw) || 0, -YAW, YAW); G.pitch = clamp(Number(m.pitch) || 0, ...PITCH); }
});
// a whale's body as a line from nose to tail, and how far a point is from it
function struck(at, w) {
	const m = metre(), s = Math.sin(w.heading), c = Math.cos(w.heading);
	const dx = at[0] - w.x, dy = at[1] - w.y, dz = at[2] - w.z, along = clamp((dx * s + dz * c) / m, -7.5, 8);
	return Math.hypot(dx - s * along * m, dy, dz - c * along * m) < 2.4 * m;
}
function flyHarpoons(b, g, dt) {
	const m = metre();
	g.guns.forEach((G, k) => {
		G.wait = Math.max(G.wait - dt, 0);
		const H = G.harpoon;
		if (!H) return;
		const V = b.vessel.harpoons[k], from = pivotOf(b, V);
		if (H.state == 'fly') {
			H.v[1] -= GRAVITY * dt;
			for (let i = 0; i < 3; i++) H.at[i] += H.v[i] * m * dt;
			const w = whales.find((o) => o.state == 'swim' && struck(H.at, o));
			if (w) {
				H.state = 'fast'; H.whale = w.id; H.v = [0, 0, 0];
				H.off = [H.at[0] - w.x, H.at[1] - w.y, H.at[2] - w.z];
				w.state = 'reel'; w.boat = b.id;
				// (whichever side of her it is nearer, it comes alongside)
				const local = b.frame.toLocal([w.x, w.y, w.z]);
				w.side = local[0] >= 0 ? 1 : -1;
				whalingStats.struck++;
				return;
			}
			const far = Math.hypot(H.at[0] - from[0], H.at[1] - from[1], H.at[2] - from[2]) / m;
			if (far > CABLE || H.at[1] < surface() - 2 * m) H.state = 'haul';
		} else if (H.state == 'fast') {
			const w = whales.find((o) => o.id === H.whale);
			if (!w) { G.harpoon = null; G.wait = RELOAD; return; }
			H.at = [w.x + H.off[0], w.y + H.off[1], w.z + H.off[2]];
		} else {
			const d = [from[0] - H.at[0], from[1] - H.at[1], from[2] - H.at[2]], far = Math.hypot(...d);
			if (far < 2 * m) { G.harpoon = null; G.wait = RELOAD; return; }
			for (let i = 0; i < 3; i++) H.at[i] += d[i] / far * Math.min(HAUL * m * dt, far);
			H.v = d.map((v) => v / far * HAUL);
		}
	});
}
// LANDED (see the top)
function landed(b, g) {
	// (a crew's is landed at her dock: npcShips.js)
	if (b.owner == 'npc' || g.chest.oil + g.chest.blubber < 0.01) return;
	if (whales.some((w) => w.boat === b.id && (w.state == 'dead' || w.state == 'reel'))) return;
	const m = metre(), half = 9;		// metres: her hull either way of her middle
	const at = b.frame.toWorld([0, 0, 0]).map((v) => v / m);
	for (const t of terrain.land.towns ?? []) {
		if (!t.dock) continue;
		const D = [t.dock.b[0] / m, t.dock.b[2] / m];
		if (Math.hypot(at[0] - D[0], at[2] - D[1]) > PORT + half) continue;
		g.chest.oil = 0; g.chest.blubber = 0;
		treasury.pay(t, PAID, 'Whale oil and blubber landed');
		whalingStats.landed++;
		return;
	}
}

// her crew's, locked at her town's dock (npcShips.js): landed, and paid
export function landAt(b, t) {
	const g = gearOf(b);
	if (g.chest.oil + g.chest.blubber < 0.01) return false;
	g.chest.oil = 0; g.chest.blubber = 0;
	treasury.pay(t, PAID, 'Whale oil and blubber landed');
	whalingStats.landed++;
	return true;
}
//-------------------------------WHAT A CREW DOES (npcShips.js)-------------------------------
/*
	A schooner's job, from where she is (metres): { kind: 'hold' } (a whale on her line, or alongside: she lies there); { kind: 'home' } (her chest has something in it, and it is all aboard: back to her dock);
	{ kind: 'chase', at: [x, z], whale } (the nearest whale there is); or null
*/
export function jobFor(b) {
	if (!here() || !settings.enableWhales) return null;
	const g = gearOf(b), m = metre();
	if (whales.some((w) => w.boat === b.id && (w.state == 'dead' || w.state == 'reel'))) return { kind: 'hold' };
	if (g.chest.oil + g.chest.blubber > 0.01) return { kind: 'home' };
	const at = b.frame.toWorld([0, 0, 0]);
	let best = null, bestD = HUNT * m;
	for (const w of whales) {
		if (w.state != 'swim') continue;
		const d = Math.hypot(w.x - at[0], w.z - at[2]);
		if (d < bestD) { bestD = d; best = w; }
	}
	return best ? { kind: 'chase', at: [best.x / m, best.z / m], whale: best, d: bestD / m } : null;
}
// the crew's man at the bow, each frame of a chase: the gun on the side she bears turned to lead it, and fired once it is in range and in front
export function npcFire(b, w, dt) {
	const g = gearOf(b), m = metre();
	const local = b.frame.toLocal([w.x, w.y, w.z]);
	const k = local[0] >= 0 ? 0 : 1, G = g.guns[g.guns[k].harpoon ? 1 - k : k], V = b.vessel.harpoons[g.guns.indexOf(G)];
	const from = pivotOf(b, V), d = Math.hypot(w.x - from[0], w.z - from[2]) / m, t = d / SPEED;
	const ahead = [w.x + Math.sin(w.heading) * SWIM * m * t, w.y + 0.4 * m + 0.5 * GRAVITY * t * t * m, w.z + Math.cos(w.heading) * SWIM * m * t];
	const dir = b.frame.directionToLocal([ahead[0] - from[0], ahead[1] - from[1], ahead[2] - from[2]]), L = Math.hypot(...dir) || 1;
	const yaw = Math.atan2(dir[0], dir[2]), pitch = Math.asin(clamp(dir[1] / L, -1, 1));
	G.yaw += clamp(yaw - G.yaw, -dt * 1.5, dt * 1.5);
	G.pitch += clamp(pitch - G.pitch, -dt * 1.5, dt * 1.5);
	if (d < NPC_RANGE && Math.abs(yaw) < YAW && Math.abs(yaw - G.yaw) < 0.04 && Math.abs(pitch - G.pitch) < 0.04 && pitch > PITCH[0] && pitch < PITCH[1]) fire(b, g.guns.indexOf(G), 'npc');
}

//-------------------------------MANNING ONE-------------------------------
let my = null;		// { boat, k, local, heading }
const clicks = { left: false };
window.addEventListener('mousedown', (e) => { if (my && locked() && e.button == 0) clicks.left = true; });
hunting.onBoatSeat((b, control) => control.kind == 'harpoon' ? { rides, seat: 'harpoon' + control.harpoon } : null);
hunting.onBoatUse((b, control) => {
	if (control.kind != 'whaleChest') return false;
	const C = gearOf(b).chest;
	help.toast(C.oil + C.blubber > 0.01 ? `In the chest: ${C.oil.toFixed(0)} barrels of whale oil, ${C.blubber.toFixed(0)} cwt of blubber. Worth $${PAID} at a town's dock` : 'The chest is empty', 3.5);
	return true;
});
const seatOf = (b, seat) => { const k = Number(seat.slice(7)); return { k, V: b.vessel.harpoons[k] }; };
const rides = {
	inView() { return null; },
	board(b, seat) {
		const { k, V } = seatOf(b, seat);
		my = { boat: b, k, local: V.stand, heading: null };
		transformations.setSeatedNear(0.2 * metre());
		help.toast('The harpoon gun: left click to fire', 3);
		return true;
	},
	ride(b, seat, { use }, seconds) {
		const { k, V } = seatOf(b, seat), leaving = { boat: b, local: V.stand };
		if (!b.exists || !my || my.boat !== b) return { left: leaving };
		if (use) { rides.leave(b, seat); return { left: leaving }; }
		const heading = b.frame.heading();
		if (my.heading !== null) settings.camYaw += wrap(heading - my.heading);
		my.heading = heading;
		const up = b.frame.up(), lean = [up[0] * 0.5, 0.5 + up[1] * 0.5, up[2] * 0.5], ll = Math.hypot(...lean);
		transformations.viewUp.splice(0, 3, ...lean.map((v) => v / ll));
		const look = b.frame.directionToLocal(transformations.getCameraForward());
		const G = gearOf(b).guns[k];
		G.yaw = clamp(Math.atan2(look[0], look[2]), -YAW, YAW);
		G.pitch = clamp(Math.asin(clamp(look[1], -1, 1)), ...PITCH);
		aimSoon -= seconds;
		if (!here() && aimSoon <= 0) { aimSoon = 1 / GEAR_RATE; survivalNet.send('harpoonAim', { boat: b.id, gun: k, yaw: G.yaw, pitch: G.pitch }); }
		if (clicks.left) fire(b, k);
		clicks.left = false;
		const eye = b.frame.toWorld(V.eye);
		settings.camPosX = eye[0]; settings.camPosY = eye[1]; settings.camPosZ = eye[2];
		boat.setCrew(b, 'me', [V.stand[0], V.stand[1] + 0.9, V.stand[2]]);
		const H = G.harpoon, state = H ? { fly: 'harpoon away', fast: 'FAST to a whale: reeling in', haul: 'hauling back' }[H.state] : G.wait > 0 ? `reloading: ${Math.ceil(G.wait)} s` : 'loaded';
		return { feet: b.frame.toWorld(V.stand), eye, velocity: b.frame.velocityAt(V.stand), prompt: { name: 'Harpoon gun', keys: `${state} · left click to fire` } };
	},
	leave() { my = null; clicks.left = false; transformations.setSeatedNear(null); },
	local(b, seat) { return { local: [...seatOf(b, seat).V.stand], sit: 0 }; },
	help() { return ['Harpoon gun', [['Mouse', 'aim'], ['Left click', 'fire'], ['F', 'stand up']]]; },
};
let aimSoon = 0;
hunting.addRides(rides);

//-------------------------------MULTIPLAYER-------------------------------
// [id, x, y, z, heading, swim, stage (0 alive), 0, own, pitch, roll, alive]
export function whaleShare() {
	const out = [];
	for (const w of whales) out.push(w.id, w.x, w.y, w.z, w.heading, w.swim, w.state == 'dead' ? w.stage : 0, 0, w.own, w.pitch, w.roll, w.state == 'dead' ? 0 : 1);
	return new Float32Array(out);
}
export function whaleFollow(records) {
	if (!records) { followed = null; return; }
	followed = [];
	for (let k = 0; k < records.length; k += 12) followed.push({ id: records[k], x: records[k + 1], y: records[k + 2], z: records[k + 3], heading: records[k + 4], swim: records[k + 5], stage: Math.round(records[k + 6]), pitch: records[k + 9], roll: records[k + 10] });
}
function sendGear() {
	const r = (v) => Math.round(v * 100) / 100, list = [];
	for (const b of schooners()) {
		const g = gearOf(b);
		list.push([b.id, r(g.chest.oil), r(g.chest.blubber), g.guns.map((G) => [r(G.yaw), r(G.pitch), r(G.wait), G.harpoon ? [G.harpoon.state, ...G.harpoon.at.map(r), ...G.harpoon.v.map(r), G.harpoon.whale ?? 0] : null])]);
	}
	survivalNet.send('whaleGear', { list });
}
survivalNet.on('whaleGear', (m) => {
	if (here()) return;
	for (const [id, oil, blubber, guns] of m.list ?? []) {
		const b = boat.boatById(id);
		if (!b?.vessel.harpoons) continue;
		const g = gearOf(b);
		g.chest.oil = Number(oil) || 0; g.chest.blubber = Number(blubber) || 0;
		guns.forEach((S, k) => {
			const G = g.guns[k];
			if (!G || !S) return;
			if (!(my?.boat === b && my.k == k)) { G.yaw = S[0]; G.pitch = S[1]; }
			G.wait = S[2];
			G.harpoon = S[3] ? { state: S[3][0], at: S[3].slice(1, 4), v: S[3].slice(4, 7), whale: S[3][7] || null } : null;
		});
	}
});

//-------------------------------DRAWN-------------------------------
// a matrix from a boat's own directions: its origin at `at` (world units), +z along dir (in the world), its scale
function aimedAt(b, at, dir, scale = metre()) {
	const up0 = b ? b.frame.up() : [0, 1, 0], l = Math.hypot(...dir) || 1, z = dir.map((v) => v / l);
	let x = [up0[1] * z[2] - up0[2] * z[1], up0[2] * z[0] - up0[0] * z[2], up0[0] * z[1] - up0[1] * z[0]];
	const lx = Math.hypot(...x) || 1; x = x.map((v) => v / lx);
	const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
	return new Float32Array([x[0] * scale, x[1] * scale, x[2] * scale, 0, y[0] * scale, y[1] * scale, y[2] * scale, 0, z[0] * scale, z[1] * scale, z[2] * scale, 0, at[0], at[1], at[2], 1]);
}
// a length of cable from a to b, sagging a little as the anchor's does
function cableBetween(a, b) {
	const m = metre(), far = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), sag = Math.min(far * 0.04, 4 * m), N = 5;
	const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
	for (let k = 0; k < N; k++) {
		const p = at(k / N), q = at((k + 1) / N), d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], L = Math.hypot(...d);
		if (L < 1e-3) continue;
		const M = aimedAt(null, p, d, 0.03 * m);
		M[8] = d[0]; M[9] = d[1]; M[10] = d[2];
		props.show('cable', M);
	}
}
function drawGear() {
	const m = metre(), cx = settings.camPosX, cz = settings.camPosZ;
	for (const b of boat.boats) {
		const list = b.vessel.harpoons;
		if (!list || b.destroyed >= 0) continue;
		const at = b.frame.toWorld([0, 0, 0]);
		if (Math.hypot(at[0] - cx, at[2] - cz) > DRAW * m) continue;
		const g = gearOf(b), ahead = b.frame.directionToWorld([0, 0, 1]);
		list.forEach((V, k) => {
			const G = g.guns[k], foot = b.frame.toWorld(V.foot), pivot = pivotOf(b, V), dir = b.frame.directionToWorld(aimLocal(G));
			props.show('harpoonGun', aimedAt(b, foot, ahead));
			if (!(my?.boat === b && my.k == k)) props.show('harpoonBarrel', aimedAt(b, pivot, dir));
			const H = G.harpoon;
			if (!H) { if (G.wait <= 0) props.show('harpoon', aimedAt(b, pivot.map((v, i) => v + dir[i] * 0.9 * m), dir)); return; }
			const speed = Math.hypot(...H.v);
			const away = H.state == 'fast' || speed < 0.1 ? [pivot[0] - H.at[0], pivot[1] - H.at[1], pivot[2] - H.at[2]].map((v) => -v) : H.state == 'haul' ? H.v.map((v) => -v) : H.v;
			props.show('harpoon', aimedAt(null, H.at, away));
			cableBetween(pivot, H.at);
		});
		const C = list.chest;
		if (C) props.show('shipChest', aimedAt(b, b.frame.toWorld(C), ahead));
	}
	const show = (w, alive, stage) => {
		if (Math.hypot(w.x - cx, w.z - cz) > DRAW * m) return;
		const name = alive ? 'whale' : WHALE_STAGES[clamp(stage, 1, WHALE_STAGES.length) - 1];
		props.show(name, props.place([w.x, w.y, w.z], w.heading, w.pitch, w.roll), undefined, alive ? [0, 0.05, w.swim * 3, -16] : undefined);
		// its blow, at the top of a breath
		if (alive && w.y > surface() - 2 * m && Math.random() < 0.02) smoke.addPuff({ at: [w.x + Math.sin(w.heading) * 5 * m, surface() + 1.5 * m, w.z + Math.cos(w.heading) * 5 * m], v: [0, 3.5, 0], size: 0.5, grow: 2.2, life: 2.5, kind: 2, rise: 0.8 });
	};
	if (followed) for (const w of followed) show(w, w.stage == 0, w.stage);
	else for (const w of whales) show(w, w.state != 'dead', w.stage);
}

//-------------------------------ONCE A FRAME-------------------------------
let lastTime = performance.now(), gearDue = 0;
export function whalingUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.05);
	lastTime = now;
	if (!settings.enableWhales || !settings.enableWater || !terrain.land) return;
	if (here()) {
		if (terrain.land !== builtFor) build();
		while (spawnQueue.length && spawnQueue[0] <= clock()) { spawnQueue.shift(); const w = newWhale(); if (w) whales.push(w); }
		for (const w of [...whales]) {
			const b = w.boat !== null ? boat.boatById(w.boat) : null;
			if (w.state == 'swim') swim(w, dt);
			else if (w.state == 'reel') {
				// (her lost, or the line let go: it swims off)
				if (b && b.destroyed < 0 && gearOf(b).guns.some((G) => G.harpoon?.whale === w.id)) reel(w, b, dt);
				else { w.state = 'swim'; w.boat = null; }
			} else flense(w, b, dt);
		}
		for (const b of schooners()) {
			const g = gearOf(b);
			flyHarpoons(b, g, dt);
			landed(b, g);
		}
		if ((gearDue -= dt) <= 0) { gearDue = 1 / GEAR_RATE; sendGear(); }
	}
	whalingStats.whales = (followed ?? whales).length;
	drawGear();
}
// for testing
export const whalesForTest = () => ({ ...whalingStats, whales: (followed ?? whales).map((w) => ({ id: w.id, x: w.x, y: w.y, z: w.z, state: w.state, stage: w.stage, boat: w.boat })), chests: [...gear.entries()].map(([id, g]) => [id, g.chest]) });
export function whaleToForTest(i, x, z) { const w = whales[i]; if (w) { w.x = x; w.z = z; w.target = null; } return !!w; }
export function strikeForTest(i, b) { const w = whales[i]; if (!w) return false; const G = gearOf(b).guns[0]; G.harpoon = { state: 'fast', at: [w.x, w.y, w.z], off: [0, 0, 0], v: [0, 0, 0], whale: w.id }; w.state = 'reel'; w.boat = b.id; w.side = 1; return true; }
