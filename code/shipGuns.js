import {canvas} from './deviceSelection.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import * as transformations from './transformations.js'
import * as boat from './boat.js'
import { VESSELS, MATERIALS, MAX_PARTS } from './vessels.js'
import * as hunting from './hunting.js'
import * as ballistics from './ballistics.js'
import * as plane from './plane.js'
import * as players from './players.js'
import * as deer from './deer.js'
import * as horde from './horde.js'
import * as weapons from './weapons.js'
import * as lewis from './lewis.js'
import * as vm from './viewmodel.js'
import * as help from './controlsHelp.js'
import * as npcs from './npcs.js'
import * as town from './town.js'

/*
	THE SCHOONER'S GUNS AND STORES (vessels.js: where each is, and its mesh; boat.js draws their parts where this says, partsFor;
	hunting.js puts the walker in their seats, onBoatSeat, works the stores, onBoatUse, and climbs the masts to the crow's nests).
		THE HOWITZERS		six, three a side: short 80mm guns on a pivot. Standing on deck at one (looking at it): middle click opens
							its breech (or shuts it), and R held for LOAD_SECONDS with it open puts in the round in the hands (one from
							the stack: carried in, up and round, and pushed home), a ring at the top of the screen filling as it goes (as
							the biplane's reloading, plane.js). F mans it, to aim and fire it only: behind it, the view along it, and it
							turns and is raised to where the gunner looks (YAW either way of straight out over the side, PITCH); left click
							with its breech shut and a round in it fires it: a shell (ballistics.js's 80mm round), bursting where it lands
							(THE BURST). F again stands up
		THE CROW'S NESTS	up each mast (its ladder: hunting.js), a Lewis gun on a pintle. F in the nest mans it: the view behind it, all
							the way round but not into its own mast. As the biplane's gunner's (left click fires, right click along the
							sights, R a fresh pan, NEST_PANS of them); E at it standing in the nest with a supply pack in the hands fills
							its pans again. A lookout (npcShips.js) mans one with npcNest: it has all the pans it wants
		THE STORES			the stack of rounds by the mainmast (F: a round in the hands), the pile of supply packs by the wheel (F: one,
							plane.js's: it fills a biplane up too), and the barrel of wood (F: planks in the hands). With the planks in
							the hands at either mast's foot, R held for REPAIR_SECONDS mends REPAIR of her health (boat.js: where she is
							sailed): a plank held up to her and a hammer driving it home, a blow every STRIKE seconds, and the ring
	THE MODELS in the hands (each under 100 triangles): the round (its brass case, its copper driving band, its steel shell to a point),
		the planks (two, one on the other), and the hammer (its handle, its head, its claw)
	THE BURST: a shell goes off where it stops: a ball of fire (plane.js's) and a bang (sound.js), and, fired here, what is round it
	hurt by how near it is, out to BURST.radius: the houses (town.js: the host's, every burst it sees), the boats (boat.js), the biplanes (plane.js), the others (players.js: as if hit,
	in the head, the chest or a leg by how near; alone, this player), the NPCs (npcs.js), the deer (deer.js) and the horde (horde.js).
	An NPC's shell (the schooner's crew, npcShips.js: npcGun) hurts the players as npcs.js says. On every machine:
	a shell fired somewhere else is flown here too (net.js), and bursts here, for its fire and its bang
	THE OTHERS: a gun one of them mans is turned to where they look (players.js), on every machine; and on a joiner, one the host's NPCs man
	to where they look (npcs.crewLook). Its breech and its pans are the
	gunner's own: kept on the gunner's machine
	In metres, on the boat (its own directions: +x to port, +y up, +z to the bow)
*/
const YAW = 1.2;					// radians either way of straight out over the side
const PITCH = [-0.08, 0.8];			// radians down and up
const LOAD_SECONDS = 3;
const BREECH_SECONDS = 0.4;
const RECOIL = 0.28;				// metres the barrel runs back firing
const REPAIR_SECONDS = 3, REPAIR = 0.05;	// a piece of wood: R held this long at a mast mends this much of her health
const MAST_REACH = 1.4;				// metres from a mast's middle to mend her there
const STRIKE = 0.45;				// seconds between the hammer's blows, mending
const NEST_PANS = 4;
const NEAR_SEATED = 0.2;			// metres: the near plane manning a gun (it is close; any nearer and the far ground loses its depth: noise)
const BURST = { radius: 8, boat: 30, plane: 40 };	// metres, and the health off a boat and a biplane right by it
const LEWIS_PIVOT = [0, -0.03, -0.1];	// where on the Lewis gun (lewis.js) it turns on its pintle

const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const wrap = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
const about = (point, rotation) => mat4.multiply(mat4.translation(point), mat4.multiply(rotation, mat4.translation(point.map((v) => -v))));
const locked = () => document.pointerLockElement == canvas;

// The Lewis guns in the nests: the gun's mesh (lewis.js) put into the schooner's (vessels.js), once, before it is first drawn. Its
//		pan its own part (turned a round a shot), the rest of the gun the other; without the bipod's legs and the spent case
(function lewisInTheNests() {
	const V = VESSELS.Schooner, M = MATERIALS;
	const material = { 0: M.WOOD, 1: M.IRON, 2: M.BRASS, 9: M.DARK, 17: M.IRON };
	const m = vm.meshBuilder();
	lewis.buildLewis(m);
	const data = m.done(), out = Array.from(V.mesh);
	for (const N of V.nests) {
		for (let t = 0; t < data.length; t += 12) {
			const firstPart = Math.round(data[t + 3]) % 32;
			if (firstPart >= 4) continue;
			for (let k = 0; k < 3; k++) {
				const o = t + k * 4, code = Math.round(data[o + 3]), part = code % 32;
				out.push(N.pivot[0] + data[o] - LEWIS_PIVOT[0], N.pivot[1] + data[o + 1] - LEWIS_PIVOT[1], N.pivot[2] + data[o + 2] - LEWIS_PIVOT[2],
					material[(code - part) / 32] ?? M.IRON, 0, 0, -1, 0, N.control, -1, N.piece, part == 1 ? N.part + 1 : N.part);
			}
		}
	}
	V.mesh = new Float32Array(out);
	V.triangles = V.mesh.length / 36;
})();

// The guns' states: each boat's, here. A howitzer: where it is turned and raised to, its breech (open, 0 to 1, and which way it is
//		going), loaded, loading (seconds into it), recoil (1 just fired, back to 0). A nest's gun: where it is turned and raised to,
//		its pan and its spare pans, and its cycling as the biplane's gunner's (plane.js)
const states = new WeakMap();
function stateOf(b) {
	let s = states.get(b);
	if (!s) {
		s = { guns: (b.vessel.guns ?? []).map(() => ({ yaw: 0, pitch: 0.12, open: 0, wantOpen: false, loaded: false, loading: 0, recoil: 0 })),
			nests: (b.vessel.nests ?? []).map(() => ({ yaw: 0, pitch: 0, pan: lewis.PAN, spare: NEST_PANS, since: 0, changing: -1, turn: 0, cycle: 1 })) };
		states.set(b, s);
	}
	return s;
}

// The parts (boat.js draws them where these say): each gun turned to its state; the gun this player mans in the nest drawn in its
//		hands instead (gunnerPass)
const IDENTITY = mat4.identity();
function howitzerAim(V, yaw, pitch) { return mat4.multiply(mat4.rotationY(yaw), mat4.rotationZ(V.side * pitch)); }
function lewisAim(yaw, pitch) { return mat4.multiply(mat4.rotationY(yaw), mat4.rotationX(-pitch)); }
function partsFor(b) {
	const guns = b.vessel.guns, nests = b.vessel.nests;
	if (!guns && !nests) return null;
	const s = stateOf(b), parts = Array.from({ length: MAX_PARTS }, () => IDENTITY);
	guns?.forEach((V, k) => {
		const G = s.guns[k];
		lookOfOther(b, V.seat, (yaw, pitch) => { G.yaw = clamp(howitzerYaw(V, yaw), -YAW, YAW); G.pitch = clamp(pitch, ...PITCH); });
		const crew = !npcs.runsHere() && npcs.crewLook(b.id, V.seat);
		if (crew) { G.yaw = clamp(howitzerYaw(V, crew.yaw), -YAW, YAW); G.pitch = clamp(crew.pitch, ...PITCH); }
		const turn = about(V.pivot, mat4.rotationY(G.yaw));
		const barrel = mat4.multiply(about(V.pivot, howitzerAim(V, G.yaw, G.pitch)), mat4.translation([-V.side * RECOIL * Math.sin(Math.PI * Math.min(G.recoil, 1)) * (G.recoil > 0 ? 1 : 0), 0, 0]));
		parts[V.part - 1] = turn;
		parts[V.part] = barrel;
		parts[V.part + 1] = mat4.multiply(barrel, mat4.translation([0, -0.2 * G.open, 0]));
	});
	nests?.forEach((N, k) => {
		const L = s.nests[k];
		lookOfOther(b, N.stand, (yaw, pitch) => { L.yaw = yaw; L.pitch = clamp(pitch, -0.6, 1.2); });
		const crew = !npcs.runsHere() && npcs.crewLook(b.id, N.stand);
		if (crew) { L.yaw = crew.yaw; L.pitch = clamp(crew.pitch, -0.6, 1.2); }
		const mine = my && my.boat === b && my.nest === k;
		const gun = mine ? vm.HIDDEN : about(N.pivot, lewisAim(L.yaw, L.pitch));
		const pan = N.pivot.map((v, i) => v + lewis.PAN_AT[i] - LEWIS_PIVOT[i]);
		parts[N.part - 1] = gun;
		parts[N.part] = mine ? vm.HIDDEN : mat4.multiply(gun, about(pan, mat4.rotationY(-L.turn / 25 * Math.PI * 2)));
	});
	return parts;
}
boat.setPartsSource(partsFor);
// a howitzer's turn (round from straight out over its side) for a look along yaw (from +z, towards +x, on the boat)
function howitzerYaw(V, yaw) {
	const dx = Math.sin(yaw), dz = Math.cos(yaw);
	return Math.atan2(-V.side * dz, V.side * dx);
}
// one of the others manning the seat at local (metres on the boat): fn(yaw, pitch), where they look, on the boat
function lookOfOther(b, local, fn) {
	if (my && my.boat === b && dist(my.local, local) < 0.4) return;
	for (const other of players.othersAboard()) {
		if (other.vehicle !== b.id || Math.hypot(other.local[0] - local[0], other.local[2] - local[2]) > 0.5) continue;
		const view = players.otherList().find((o) => o.id === other.id)?.view;
		if (!view) return;
		const d = b.frame.directionToLocal([Math.sin(view.heading) * Math.cos(view.pitch), Math.sin(view.pitch), Math.cos(view.heading) * Math.cos(view.pitch)]);
		fn(Math.atan2(d[0], d[2]), Math.asin(clamp(d[1], -1, 1)));
		return;
	}
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// What this player carries (THE STORES): a round, or a piece of wood (a supply pack is plane.js's)
const carry = { round: false, wood: false };
// THE MODELS (see the top), in metres along +z. The round, its base at z -0.15 (76 triangles)
const ROUND_MESH = (() => {
	const m = vm.meshBuilder();
	const ring = (z, r) => m.ringAt([0, 0, z], [1, 0, 0], [0, 1, 0], Array.from({ length: 6 }, (_, k) => { const a = (k + 0.5) / 6 * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r]; }));
	m.loft([ring(-0.15, 0.049), ring(-0.14, 0.043), ring(0.075, 0.042)], 2, 0, [0]);		// the case, its rim, closed at its base
	m.loft([ring(0.075, 0.044), ring(0.095, 0.044)], 3);									// the driving band
	m.loft([ring(0.095, 0.041), ring(0.15, 0.035), ring(0.2, 0.019), ring(0.23, 0.003)], 1);	// the shell, to its point
	return m.done();
})();
// the planks: two boards, the top one a little along (48)
const WOOD_MESH = (() => {
	const m = vm.meshBuilder();
	m.section(-0.42, [0.065, -0.012, 0.012], 0.42, [0.065, -0.012, 0.012], 15, 0, [0, 1]);
	m.section(-0.36, [0.06, 0.013, 0.036], 0.47, [0.06, 0.013, 0.036], 15, 0, [0, 1]);
	return m.done();
})();
// the hammer: its grip at the origin, its handle up +y, its head across it along z, the face forward (+z), the claw back (about 60)
const HAMMER_MESH = (() => {
	const m = vm.meshBuilder();
	m.strut([0, -0.05, 0], [0, 0.29, 0], 0.015, 0.012, 6, 0);
	m.section(-0.045, [0.016, 0.282, 0.318], 0.055, [0.016, 0.282, 0.318], 1, 0, [0, 1]);
	m.section(0.055, [0.012, 0.288, 0.312], 0.075, [0.013, 0.287, 0.313], 1, 0, [1]);
	m.section(-0.045, [0.014, 0.29, 0.316], -0.11, [0.004, 0.262, 0.282], 1, 0, [1]);
	return m.done();
})();
const roundView = new vm.Viewmodel('80mm round', ROUND_MESH), woodView = new vm.Viewmodel('Wood', WOOD_MESH), hammerView = new vm.Viewmodel('Hammer', HAMMER_MESH);
// how each is held: the round low at the side, its point ahead; loading, up and round to point straight ahead (LOAD_HOLD) and pushed away
//		into the breech; the planks under the arm; mending, a plank held up across in front (PLANK_HOLD) and the hammer in the other hand
const CARRY_HOLD = { x: 0.13, y: -0.25, z: -0.42, yaw: -0.45, pitch: -0.25 };
const LOAD_HOLD = { x: 0.02, y: -0.19, z: -0.5, yaw: 0, pitch: -0.12 };
const WOOD_HOLD = { x: 0.17, y: -0.27, z: -0.5, yaw: 0.12, pitch: -0.08 };
const PLANK_HOLD = { x: -0.04, y: -0.13, z: -0.55, yaw: 1.45, pitch: 0.05 };
const HAMMER_HOLD = { x: 0.2, y: -0.24, z: -0.4, yaw: -0.25, pitch: 0 };
const still = { aimed: 0, bob: 0, kick: 0 };
function roundMatrix() {
	const k = loading.share;
	if (k <= 0) return vm.holdMatrix(CARRY_HOLD, CARRY_HOLD, still);
	const up = vm.ease(Math.min(k / 0.4, 1)), home = vm.ease(Math.max((k - 0.4) / 0.6, 0));
	const hold = Object.fromEntries(Object.keys(CARRY_HOLD).map((key) => [key, CARRY_HOLD[key] + (LOAD_HOLD[key] - CARRY_HOLD[key]) * up]));
	hold.z -= 0.45 * home; hold.y -= 0.06 * home;
	return vm.holdMatrix(hold, hold, still);
}
// the planks, and the hammer swung (raised back slowly, brought down fast on the plank)
function drawWood() {
	if (mending <= 0) { woodView.draw(vm.holdMatrix(WOOD_HOLD, WOOD_HOLD, still), []); return; }
	woodView.draw(vm.holdMatrix(PLANK_HOLD, PLANK_HOLD, still), []);
	const t = (mending % STRIKE) / STRIKE, swing = t < 0.75 ? -0.7 * vm.ease(t / 0.75) : -0.7 + 1.6 * ((t - 0.75) / 0.25);
	hammerView.draw(mat4.rotateX(vm.holdMatrix(HAMMER_HOLD, HAMMER_HOLD, still), -swing), []);
}
weapons.addWeapon('round', { label: '80mm round', detail: 'For a howitzer', menu: null, equip: () => {}, reset: () => { carry.round = false; },
	drawn: () => roundView.draw(roundMatrix(), []),
	help: () => ['80mm round', [['Middle click', 'at a howitzer: open or shut its breech'], ['R (held)', 'at a howitzer, its breech open: load it'], ['F', 'at a howitzer: man it (aim and fire)']]] });
weapons.addWeapon('wood', { label: 'Planks', detail: 'For mending the schooner', menu: null, equip: () => {}, reset: () => { carry.wood = false; },
	drawn: () => drawWood(),
	help: () => ['Planks', [['R (held)', 'at either mast: mend her']]] });
weapons.gateEquip((name) => (name != 'round' || carry.round) && (name != 'wood' || carry.wood));
const putDown = () => { if (weapons.weaponState.current == 'round' || weapons.weaponState.current == 'wood') weapons.equipWeapon('none'); };

// F at the stores, and E at a nest's gun with a supply pack (hunting.js)
hunting.onBoatUse(useStores);
function useStores(b, control) {
	if (control.kind == 'shells') {
		if (carry.round) help.toast('You have a round already', 1.5);
		else { carry.round = true; carry.wood = false; weapons.equipWeapon('round'); weapons.actionSound('load'); }
		return true;
	}
	if (control.kind == 'packs') {
		if (!plane.giveSupply()) help.toast('You have a supply pack already', 1.5);
		return true;
	}
	if (control.kind == 'barrel') {
		if (carry.wood) help.toast('You have wood already', 1.5);
		else { carry.wood = true; carry.round = false; weapons.equipWeapon('wood'); }
		return true;
	}
	if (control.kind == 'nestGun') {
		const L = stateOf(b).nests[control.nest];
		if (plane.takeSupply()) { L.pan = lewis.PAN; L.spare = NEST_PANS; weapons.actionSound('pan'); help.toast('The Lewis gun\'s pans filled', 2); }
		else help.toast('Bring a supply pack from the pile by the wheel', 2.5);
		return true;
	}
	return false;
}

// THE SEATS: F at a howitzer or a nest's gun (hunting.js: onBoatSeat), and what is done in them (addRides)
let my = null;		// { boat, kind: 'gun' or 'nest', gun or nest, local (where it is, metres on the boat), heading (the boat's, last frame) }
hunting.onBoatSeat((b, control) => {
	if (control.kind == 'gun') return { rides, seat: 'gun' + control.gun };
	if (control.kind == 'nestGun') return { rides, seat: 'nest' + control.nest };
	return null;
});
const seatOf = (b, seat) => seat.startsWith('gun') ? { kind: 'gun', k: Number(seat.slice(3)), V: b.vessel.guns[Number(seat.slice(3))] } : { kind: 'nest', k: Number(seat.slice(4)), V: b.vessel.nests[Number(seat.slice(4))] };
const rides = {
	inView() { return null; },
	board(b, seat) {
		const { kind, k, V } = seatOf(b, seat), local = kind == 'gun' ? V.seat : V.stand;
		if (players.othersAboard().some((o) => o.vehicle === b.id && Math.hypot(o.local[0] - local[0], o.local[2] - local[2]) < 0.5)) { help.toast('Someone is on that gun'); return false; }
		my = { boat: b, kind, gun: kind == 'gun' ? k : -1, nest: kind == 'nest' ? k : -1, local, heading: null };
		transformations.setSeatedNear(NEAR_SEATED * metre());
		help.toast(kind == 'gun' ? 'Middle click: the breech · R held: load a round · left click: fire' : 'The Lewis gun: left click to fire, R a fresh pan', 3.5);
		return true;
	},
	ride(b, seat, { use }, seconds) {
		const { kind, k, V } = seatOf(b, seat);
		const leaving = { boat: b, local: kind == 'gun' ? V.seat : V.stand, nest: kind == 'nest' ? k : undefined };
		if (!b.exists || !my || my.boat !== b) return { left: leaving };
		if (use) { rides.leave(b, seat); return { left: leaving }; }
		// the view turns as the boat turns (as on its deck: hunting.js), and leans with it a little
		const heading = b.frame.heading();
		if (my.heading !== null) settings.camYaw += wrap(heading - my.heading);
		my.heading = heading;
		const up = b.frame.up(), lean = [up[0] * 0.5, 0.5 + up[1] * 0.5, up[2] * 0.5], ll = Math.hypot(...lean);
		transformations.viewUp.splice(0, 3, ...lean.map((v) => v / ll));
		const look = b.frame.directionToLocal(transformations.getCameraForward());
		const yaw = Math.atan2(look[0], look[2]), pitch = Math.asin(clamp(look[1], -1, 1));
		const s = stateOf(b);
		let prompt;
		if (kind == 'gun') prompt = workHowitzer(b, s.guns[k], V, yaw, pitch, seconds);
		else prompt = workNestGun(b, s.nests[k], V, yaw, pitch, look, seconds);
		const eye = b.frame.toWorld(V.eye);
		settings.camPosX = eye[0]; settings.camPosY = eye[1]; settings.camPosZ = eye[2];
		boat.setCrew(b, 'me', [leaving.local[0], leaving.local[1] + 0.9, leaving.local[2]]);
		return { feet: b.frame.toWorld(leaving.local), eye, velocity: b.frame.velocityAt(leaving.local), prompt };
	},
	leave(b, seat) {
		my = null;
		clicks.left = clicks.middle = false;
		transformations.setSeatedNear(null);
	},
	local(b, seat) { const { kind, V } = seatOf(b, seat); return { local: [...(kind == 'gun' ? V.seat : V.stand)], sit: 0 }; },
	help(b, seat) {
		return seatOf(b, seat).kind == 'gun' ? ['Howitzer', [
			['Mouse', 'aim'],
			['Middle click', 'open or shut the breech'],
			['R (held)', 'with a round, the breech open: load it'],
			['Left click', 'fire (the breech shut)'],
			['F', 'stand up'],
		]] : ['Crow\'s nest Lewis gun', [
			['Mouse', 'aim (not into the mast)'],
			['Left click', 'fire (hold)'],
			['Right click', 'along the sights (hold)'],
			['R', 'a fresh pan'],
			['F', 'stand up'],
		]];
	},
};
hunting.addRides(rides);

// the mouse and R, manning a gun
const clicks = { left: false, middle: false, leftHeld: false, rightHeld: false, rHeld: false, rPressed: false };
window.addEventListener('mousedown', (event) => {
	if (!my || !locked()) return;
	if (event.button == 0) { clicks.left = true; clicks.leftHeld = true; }
	if (event.button == 1) { clicks.middle = true; event.preventDefault(); }
	if (event.button == 2) clicks.rightHeld = true;
});
window.addEventListener('mouseup', (event) => {
	if (event.button == 0) clicks.leftHeld = false;
	if (event.button == 2) clicks.rightHeld = false;
});
window.addEventListener('keydown', (event) => { if (event.code == 'KeyR') { if (!event.repeat) clicks.rPressed = true; clicks.rHeld = true; } });
window.addEventListener('keyup', (event) => { if (event.code == 'KeyR') clicks.rHeld = false; });

// a howitzer manned (see THE HOWITZERS at the top): gives the prompt in the corner
//		(manned it is aimed and fired only: its breech and its loading are done standing at it, see THE HOWITZERS)
function workHowitzer(b, G, V, yaw, pitch, dt) {
	G.yaw = clamp(howitzerYaw(V, yaw), -YAW, YAW);
	G.pitch = clamp(pitch, ...PITCH);
	if (clicks.middle || clicks.rPressed) help.toast('Stand up (F) to open the breech and load it', 2);
	clicks.middle = clicks.rPressed = false;
	if (clicks.left) {
		if (G.open > 0) help.toast('Shut the breech first (stand up, middle click)', 1.5);
		else if (!G.loaded) help.toast('Not loaded: stand up and load it', 1.5);
		else fireHowitzer(b, G, V);
	}
	clicks.left = false;
	return { name: 'Howitzer', keys: `${G.open > 0.5 ? 'Breech open' : 'Breech shut'} · ${G.loaded ? 'loaded' : 'empty'} · left click to fire` };
}
// (shooter: an NPC's id, npcShips.js: its shell, and no kick to this player's view)
function fireHowitzer(b, G, V, shooter = null) {
	const aim = howitzerAim(V, G.yaw, G.pitch);
	const along = [aim[0] * V.side, aim[1] * V.side, aim[2] * V.side];		// (its first column: where it turns +x)
	const muzzle = b.frame.toWorld(V.pivot.map((v, i) => v + along[i] * V.muzzle));
	const dir = b.frame.directionToWorld(along);
	if (shooter) { ballistics.fire(muzzle, dir, { round: '80mm', shooter, npc: true, quiet: true }); npcs.shotFired(muzzle, dir, '80mm'); }
	else ballistics.fire(muzzle, dir, { round: '80mm' });
	plane.muzzleBlast(muzzle, dir);
	G.loaded = false;
	G.recoil = 1;
	if (!shooter) settings.camPitch += 0.02;
	gunStats.shells++;
}
// a howitzer an NPC mans (npcShips.js): turned to look along yaw and pitch (radians, on the boat, as a player at it would look), its recoil
//		run out over dt seconds, and fired if it is asked to and loaded (the NPC's own loading is npcShips.js's). Gives whether that look is
//		within what the gun turns and is raised to
export function npcGun(b, k, { yaw, pitch, dt, fire = false, shooter = null }) {
	const V = b.vessel.guns[k], G = stateOf(b).guns[k];
	const turn = howitzerYaw(V, yaw);
	G.yaw = clamp(turn, -YAW, YAW);
	G.pitch = clamp(pitch, ...PITCH);
	G.recoil = Math.max(G.recoil - dt * 1.4, 0);
	G.open = 0;
	const inArc = Math.abs(turn) <= YAW && pitch >= PITCH[0] && pitch <= PITCH[1];
	if (fire && inArc && G.loaded) fireHowitzer(b, G, V, shooter);
	return inArc;
}
export function npcLoad(b, k) { stateOf(b).guns[k].loaded = true; }
// a nest's Lewis gun an NPC mans (npcShips.js): turned to look along look (a direction on the boat; null: left as it is), its pan changed as
//		it runs out, and fired at its rate if it is asked to and not into its own mast. Gives the muzzle (world units) of a round to fire now,
//		or null
export function npcNest(b, k, { look, dt, fire = false }) {
	const N = b.vessel.nests[k], L = stateOf(b).nests[k];
	L.since = Math.min(L.since + dt, 1 / lewis.RATE);
	L.cycle = Math.min(L.cycle + dt * lewis.RATE * 1.6, 1);
	if (L.changing >= 0) {
		L.changing += dt;
		if (L.changing >= 2.2) { L.changing = -1; L.pan = lewis.PAN; L.turn = 0; }
		return null;
	}
	if (!look) return null;
	L.yaw = Math.atan2(look[0], look[2]);
	L.pitch = clamp(Math.asin(clamp(look[1], -1, 1)), -0.6, 1.2);
	const mast = look[2] < -0.2 && Math.abs(look[0]) < 0.35 && look[1] < 0.85;
	if (!fire || mast || L.since < 1 / lewis.RATE) return null;
	if (L.pan <= 0) { L.changing = 0; return null; }
	L.since = 0; L.pan--; L.turn++; L.cycle = 0;
	gunStats.lewis++;
	const along = [Math.sin(L.yaw) * Math.cos(L.pitch), Math.sin(L.pitch), Math.cos(L.yaw) * Math.cos(L.pitch)];
	return b.frame.toWorld(N.pivot.map((v, i) => v + along[i] * 0.9));
}

// a nest's Lewis gun manned (see THE CROW'S NESTS at the top), as the biplane's gunner's (plane.js): gives the prompt in the corner
function workNestGun(b, L, V, yaw, pitch, look, dt) {
	L.yaw = yaw; L.pitch = clamp(pitch, -0.6, 1.2);
	L.since = Math.min(L.since + dt, 1 / lewis.RATE);
	L.cycle = Math.min(L.cycle + dt * lewis.RATE * 1.6, 1);
	if (clicks.rPressed && L.changing < 0) {
		if (L.spare <= 0) help.toast('No more pans: bring a supply pack (E at the gun with it)', 2.5);
		else if (L.pan < lewis.PAN) { L.changing = 0; weapons.actionSound('pan'); }
	}
	clicks.rPressed = false;
	if (L.changing >= 0) {
		L.changing += dt;
		if (L.changing >= 2.2) { L.changing = -1; L.pan = lewis.PAN; L.spare--; L.turn = 0; weapons.actionSound('pan'); }
	} else if (clicks.leftHeld && hunting.hunterLife.alive) {
		// (not into its own mast: aft of the gunner, low)
		const mast = look[2] < -0.2 && Math.abs(look[0]) < 0.35 && look[1] < 0.85;
		if (mast) { if (L.since >= 1 / lewis.RATE) { help.toast('The mast is in the way', 0.8); L.since = 0; } }
		else if (L.pan <= 0) { if (L.since >= 1 / lewis.RATE) { help.toast('The pan is empty: R for another', 1.2); L.since = 0; } }
		else if (L.since >= 1 / lewis.RATE) {
			L.since = 0; L.pan--; L.turn++; L.cycle = 0;
			const axes = vm.cameraAxes(), eye = [settings.camPosX, settings.camPosY, settings.camPosZ];
			const from = [0, 1, 2].map((i) => eye[i] + axes.forward[i] * 0.9 * metre() - axes.up[i] * 0.15 * metre());
			const spread = clicks.rightHeld ? 0.002 : 0.006;
			const dir = [0, 1, 2].map((i) => axes.forward[i] + axes.right[i] * (Math.random() - 0.5) * spread * 2 + axes.up[i] * (Math.random() - 0.5) * spread * 2);
			ballistics.fire(from, dir, { round: '.303 British' });
			settings.camPitch += 0.0015;
			gunStats.lewis++;
		}
	}
	clicks.left = false;
	return { name: 'Lewis gun', keys: L.changing >= 0 ? 'Changing the pan' : `${L.pan} in the pan · ${L.spare} spare pan${L.spare == 1 ? '' : 's'}` };
}

// over the finished frame: the Lewis gun in the nest this player mans, in its hands (rotatingCube.js), as the biplane's gunner's
const NEST_HOLD = { x: 0.1, y: -0.16, z: -0.44, yaw: 0.02, pitch: 0.0 };
const NEST_AIM = { x: 0, y: -0.085, z: -0.32, yaw: 0, pitch: 0 };
let nestAimed = 0;
export function gunnerPass() {
	if (!my || my.kind != 'nest' || !hunting.hunterLife.alive) { nestAimed = 0; return; }
	const L = stateOf(my.boat).nests[my.nest];
	nestAimed = clamp(nestAimed + (clicks.rightHeld && L.changing < 0 ? 1 : -1) * 0.05, 0, 1);
	hunting.crosshair.hidden = nestAimed > 0.3;
	const matrix = vm.holdMatrix(NEST_HOLD, NEST_AIM, { aimed: nestAimed, bob: 0, kick: L.cycle < 1 ? 0.4 * (1 - L.cycle) : 0, kickBack: 0.02, kickUp: 0.01 });
	const parts = lewis.lewisParts({ down: 0, turn: L.turn, cycle: L.cycle, changing: L.changing >= 0 ? L.changing / 2.2 * 2.6 : -1, cases: [] });
	parts[4] = parts[5] = parts[6] = vm.HIDDEN;
	lewis.drawMounted(matrix, parts);
}

// MENDING (see THE STORES at the top): wood in the hands, at a mast's foot on the deck, R held
let mending = 0;
function mendStep(dt) {
	const place = hunting.hunterPlace();
	const b = place.on == 'deck' && place.boat ? boat.boatById(place.boat) : null;
	const mast = b?.vessel.nests?.find((N) => Math.hypot(place.local[0], place.local[2] - N.z) < MAST_REACH);
	if (!mast || !weapons.holding('wood') || !clicks.rHeld) { mending = 0; return false; }
	if (b.health >= b.vessel.health) { if (clicks.rPressed) help.toast('She needs no mending', 1.5); clicks.rPressed = false; return false; }
	clicks.rPressed = false;
	// (a knock each time the hammer comes down)
	if (Math.floor(mending / STRIKE) != Math.floor((mending + dt) / STRIKE)) weapons.actionSound('knock');
	mending += dt;
	ring.show(mending / REPAIR_SECONDS, Math.ceil(REPAIR_SECONDS - mending), 'MENDING', 'Hammering a plank into her');
	if (mending >= REPAIR_SECONDS) {
		mending = 0;
		boat.mend(b, REPAIR * b.vessel.health);
		carry.wood = false;
		putDown();
		help.toast(`Mended: ${Math.min(Math.ceil((b.health + REPAIR * b.vessel.health) / b.vessel.health * 100), 100)}% of her hull`, 2);
		gunStats.mended++;
	}
	return true;
}

// STANDING AT A HOWITZER (see THE HOWITZERS at the top): the one looked at, its breech (middle click) and the round put in it (R held)
const loading = { share: 0, seconds: 0, gun: null };
const ring = vm.progressRing();
let middleAtGun = false;
window.addEventListener('mousedown', (event) => { if (event.button == 1 && !my && locked() && !hunting.input.menuOpen && gunInView()) { middleAtGun = true; event.preventDefault(); } });
function gunInView() {
	const c = hunting.controlNow();
	if (c?.kind != 'gun') return null;
	const b = boat.boatById(c.boat);
	const k = b?.vessel.controls[c.id]?.gun;
	return k === undefined ? null : { b, k, G: stateOf(b).guns[k] };
}
function standAtGun(dt) {
	const at = hunting.hunterPlace().on == 'deck' ? gunInView() : null;
	if (middleAtGun && at) { at.G.wantOpen = !at.G.wantOpen; weapons.actionSound(at.G.wantOpen ? 'bolt' : 'gate'); }
	middleAtGun = false;
	const G = at?.G;
	if (clicks.rPressed && G) {
		if (!carry.round && !G.loaded) help.toast('No round: take one from the stack by the mainmast (F)', 2);
		else if (carry.round && G.open < 1) help.toast('Open the breech first (middle click)', 1.5);
		else if (G.loaded) help.toast('It is loaded already', 1.5);
	}
	if (G && clicks.rHeld && carry.round && G.open >= 1 && !G.loaded && (!loading.gun || loading.gun === G)) {
		loading.gun = G;
		loading.seconds += dt;
		loading.share = Math.min(loading.seconds / LOAD_SECONDS, 1);
		ring.show(loading.share, Math.ceil(LOAD_SECONDS - loading.seconds), 'LOADING', 'A round into the howitzer');
		if (loading.seconds >= LOAD_SECONDS) {
			G.loaded = true;
			carry.round = false;
			putDown();
			weapons.actionSound('shell');
			help.toast('Loaded: shut the breech (middle click), then man it (F) to fire', 3);
			Object.assign(loading, { share: 0, seconds: 0, gun: null });
		}
		return true;
	}
	Object.assign(loading, { share: 0, seconds: 0, gun: null });
	return false;
}
// every howitzer's breech going to where it is wanted, and its recoil running out (theirs, npcShips.js, are worked by npcGun)
function easeGuns(dt) {
	for (const b of boat.boats) {
		const s = states.get(b);
		if (!s) continue;
		for (const G of s.guns) {
			G.open = G.wantOpen ? Math.min(G.open + dt / BREECH_SECONDS, 1) : Math.max(G.open - dt / BREECH_SECONDS, 0);
			G.recoil = Math.max(G.recoil - dt * 1.4, 0);
		}
	}
}

// THE BURST (see the top)
ballistics.onBurst((at, bullet) => {
	plane.explode(at, 1.3);
	gunStats.bursts++;
	town.blast(at, bullet.round);
	if (bullet.remote) return;
	const m = metre();
	boat.blast(at, BURST.radius, BURST.boat, bullet);
	plane.blast(at, BURST.radius, BURST.plane, bullet);
	// (an NPC's shell hurts the players as npcs.js says; this player's, the others and the NPCs)
	if (bullet.npc) npcs.blastPlayers(at, BURST.radius * m);
	else { players.blast(at, BURST.radius * m); npcs.blast(at, BURST.radius * m); }
	if (npcs.war.on) { if (bullet.npc) npcs.blast(at, BURST.radius * m, bullet.shooter); npcs.war.blastFolk?.(at, BURST.radius * m); }
	deer.blast(at, BURST.radius * 0.7 * m);
	horde.blast(at, BURST.radius * 0.8 * m);
});

// Per frame
//-------------------------------------------------
export const gunStats = { shells: 0, lewis: 0, bursts: 0, mended: 0 };
let lastTime = performance.now();
export function shipGunsUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (my && (!my.boat.exists || hunting.hunterPlace().on != 'aboard')) rides.leave(my.boat, '');
	easeGuns(dt);
	const busy = !my && (mendStep(dt) || standAtGun(dt));
	if (!busy) ring.hide();
	if (!my) clicks.rPressed = false;
}

// for testing: what this player carries, a gun's state, and the buttons, as if pressed
export function carryForTest() { return { ...carry, loading: loading.share, mending }; }
export function middleAtGunForTest() { middleAtGun = true; }
export function heldTriangles() { return { round: roundView.triangles, planks: woodView.triangles, hammer: hammerView.triangles }; }
export function gunForTest(b, k) { return { ...stateOf(b).guns[k] }; }
export function nestForTest(b, k) { return { ...stateOf(b).nests[k] }; }
export function clickForTest({ left = false, middle = false, leftHeld = null, rHeld = null } = {}) {
	if (left) clicks.left = true;
	if (middle) clicks.middle = true;
	if (leftHeld !== null) clicks.leftHeld = leftHeld;
	if (rHeld !== null) { clicks.rHeld = rHeld; if (rHeld) clicks.rPressed = true; }
}
export const ridesForTest = rides;
export function useForTest(b, kind, k = 0) { return useStores(b, { kind, nest: k }); }
