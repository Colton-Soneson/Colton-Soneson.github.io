import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as ballistics from './ballistics.js'
import * as props from './props.js'
import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import * as deer from './deer.js'
import * as inventory from './inventory.js'
import * as loot from './loot.js'
import * as survivalNet from './survivalNet.js'

/*
	THE RABBITS, and what catches them. COUNT of them, each with a home in the woods, hopping about it a little way at a time and sitting a while: mainly in the woods (where a place to go
	is drawn by lot, ZONES says how likely it is to be kept), out on to the grassland and the marshes round the ponds now and then.
	A SNARE (loot.js: a trap, set from the inventory screen, setSnare): any rabbit within LURE of one that is set goes straight to it. Whichever gets there first is ensnared and gone, and the
	snare holds what it comes to (loot.fillTrap: small bones, a pelt, the meat); the others go back to their wandering. Emptied, it is set again.
	SHOT (ballistics.js): it falls where it is, and lies (LIE seconds; in the Survival mode LIE_SURVIVAL) for a hatchet or a knife (survivalTools.js: harvest: the meat, and only one time
	in twenty small bones). Another comes RESPAWN seconds later, out of sight.
	MULTIPLAYER, as the deer (net.js: the animals): they live on the host, which sends them as records, and a joiner draws those (rabbitFollow). A joiner's shot says so to the host
	(rabbitShot), and its cuts are asked for (survivalTools.js). In metres and seconds (their places world units).
*/
const COUNT = 70;
const HOP = 2.4, DASH = 3.4;		// metres a second: wandering, and going to a snare
const HOP_LENGTH = 0.8;				// metres a hop
const WANDER = 60;					// metres round its home
const SIT = [3, 12];				// seconds
const LURE = 50;					// metres a snare draws them from
const LOOK = 0.6;					// seconds between looks round for a snare
const SNARED_AT = 0.45;				// metres
const GIVE_UP = 40;					// seconds getting no nearer to a snare, and it leaves it be for as long again
const LIE = 8, LIE_SURVIVAL = 400;
const RESPAWN = 90;
const BONES = 0.05;
const DRAW = 180;					// metres
const SNARE_AHEAD = 1.4;			// metres in front of the walker it is set
const SPHERES = [[0, 0.13, -0.03, 0.1], [0, 0.18, 0.13, 0.06]];

const metre = () => settings.forestUnitsPerMetre;
const hidden = () => settings.gameMode == 'Horde';
export const rabbitStats = { rabbits: 0, snared: 0, shot: 0, respawned: 0, corpses: 0 };

let rabbits = [], corpses = [], respawns = [], builtFor = null, nextId = 1, clock = 0;
let followed = null;				// joiner: the host's, as they are now
export const rabbitShot = { report: null };

function zoneWeight(x, z) {
	const zone = terrain.land.zoneAt(x, z);
	return zone == terrain.ZONE_FOREST ? 1 : zone == terrain.ZONE_GRASSLAND ? 0.2 : zone == terrain.ZONE_MARSH ? 0.2 : 0;
}
function wanderTarget(r) {
	const m = metre();
	for (let k = 0; k < 10; k++) {
		const a = Math.random() * Math.PI * 2, out = WANDER * m * Math.sqrt(Math.random()), x = r.home[0] + Math.cos(a) * out, z = r.home[1] + Math.sin(a) * out;
		if (Math.random() < zoneWeight(x, z) && deer.walkable(x, z)) return [x, z];
	}
	return [...r.home];
}
function newRabbit(home, x = home[0], z = home[1]) {
	return { id: nextId++, x, z, y: 0, heading: Math.random() * 6.28, hop: Math.random() * 6.28, moving: 0, own: Math.random(), home, state: 'sit', timer: SIT[0] + Math.random() * (SIT[1] - SIT[0]), target: null, look: Math.random() * LOOK, trap: null, nearest: Infinity, stuck: 0, ignore: new Map(), ground: null };
}
function build() {
	builtFor = terrain.land;
	rabbits = []; corpses = []; respawns = [];
	const spots = terrain.land.findSpawnPoints(terrain.ZONE_FOREST, COUNT, { seed: 71, minSpacing: 30, maxSlope: 0.5 }).filter((s) => deer.walkable(s.x, s.z));
	for (const s of spots) rabbits.push(newRabbit([s.x, s.z]));
}
function hopTowards(r, to, pace, dt) {
	const m = metre(), dx = to[0] - r.x, dz = to[1] - r.z, far = Math.hypot(dx, dz);
	if (far < 0.1 * m) return far;
	const want = Math.atan2(dx, dz);
	let heading = want;
	for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 2, -2]) if (far < 1.5 * m || deer.walkable(r.x + Math.sin(want + turn) * 1.5 * m, r.z + Math.cos(want + turn) * 1.5 * m)) { heading = want + turn; break; }
	let off = heading - r.heading;
	off -= Math.PI * 2 * Math.round(off / (Math.PI * 2));
	r.heading += off * Math.min(dt * 5, 1);
	const step = Math.min(pace * m * dt, far);
	r.x += Math.sin(r.heading) * step;
	r.z += Math.cos(r.heading) * step;
	r.hop += step / (HOP_LENGTH * m) * Math.PI;
	return far - step;
}
function advance(dt) {
	if (followed) { rabbitStats.rabbits = followed.filter((o) => o.alive).length; return; }
	if (!terrain.land || hidden()) return;
	if (terrain.land !== builtFor) build();
	clock += dt;
	const m = metre(), traps = loot.trapList().filter((c) => !loot.trapSprung(c));
	for (const r of [...rabbits]) {
		// a snare (see the top)
		r.look -= dt;
		if (r.look <= 0) {
			r.look = LOOK;
			let best = null, bestD = LURE * m;
			for (const c of traps) {
				if ((r.ignore.get(c.id) ?? -1) > clock) continue;
				const d = Math.hypot(c.at[0] - r.x, c.at[2] - r.z);
				if (d < bestD) { bestD = d; best = c; }
			}
			if (best && r.trap !== best.id) { r.trap = best.id; r.nearest = Infinity; r.stuck = 0; }
			if (!best) r.trap = null;
		}
		const trap = r.trap && traps.find((c) => c.id === r.trap);
		if (r.trap && !trap) r.trap = null;
		if (trap) {
			const left = hopTowards(r, [trap.at[0], trap.at[2]], DASH, dt);
			r.moving += (1 - r.moving) * Math.min(dt * 5, 1);
			if (left < r.nearest - 0.5 * m) { r.nearest = left; r.stuck = 0; } else if ((r.stuck += dt) > GIVE_UP) { r.ignore.set(trap.id, clock + GIVE_UP); r.trap = null; }
			if (left < SNARED_AT * m && loot.fillTrap(trap.id)) {
				rabbits.splice(rabbits.indexOf(r), 1);
				respawns.push({ at: clock + RESPAWN, home: r.home });
				rabbitStats.snared++;
				continue;
			}
		} else if (r.state == 'sit') {
			r.moving += (0 - r.moving) * Math.min(dt * 5, 1);
			if ((r.timer -= dt) <= 0) { r.state = 'hop'; r.target = wanderTarget(r); }
		} else {
			r.moving += (1 - r.moving) * Math.min(dt * 5, 1);
			if (hopTowards(r, r.target, HOP, dt) < 0.3 * m) { r.state = 'sit'; r.timer = SIT[0] + Math.random() * (SIT[1] - SIT[0]); }
		}
		r.y = deer.groundUnder(r);
	}
	for (const c of corpses) c.t += dt;
	corpses = corpses.filter((c) => c.t < (settings.gameMode == 'Hunting' ? LIE_SURVIVAL : LIE));
	while (respawns.length && respawns[0].at <= clock) {
		const { home } = respawns.shift();
		// (out of sight of the camera, somewhere in its home woods)
		const r = newRabbit(home);
		const [x, z] = wanderTarget(r);
		if (Math.hypot(x - settings.camPosX, z - settings.camPosZ) > 40 * m && deer.walkable(x, z)) { r.x = x; r.z = z; }
		rabbits.push(r);
		rabbitStats.respawned++;
	}
	rabbitStats.rabbits = rabbits.length;
	rabbitStats.corpses = corpses.length;
}

// Shot (see the top)
const spheresOf = (r) => {
	const m = metre(), c = Math.cos(r.heading), s = Math.sin(r.heading);
	return SPHERES.map(([x, y, z, radius]) => [r.x + (x * c + z * s) * m, r.y + y * m, r.z + (z * c - x * s) * m, radius * m]);
};
const aroundOf = (r) => [r.x, r.y + 0.15 * metre(), r.z, 0.4 * metre()];
ballistics.addTarget((ax, ay, az, bx, by, bz) => {
	if (hidden()) return null;
	const list = followed ? followed.filter((o) => o.alive) : rabbits;
	const found = ballistics.crossAnimals(ax, ay, az, bx, by, bz, list, spheresOf, aroundOf);
	return found && { t: found.t, what: 'rabbit', hit: () => { if (followed) rabbitShot.report?.(found.animal.id, [0, 0, 0]); else kill(found.animal); } };
}, () => {
	const out = [];
	if (!hidden()) for (const r of followed ? followed.filter((o) => o.alive) : rabbits) out.push(...aroundOf(r));
	return out;
});
function kill(r) {
	const at = rabbits.indexOf(r);
	if (at < 0) return;
	rabbits.splice(at, 1);
	corpses.push({ rabbit: r, t: 0 });
	respawns.push({ at: clock + RESPAWN, home: r.home });
	respawns.sort((a, b) => a.at - b.at);
	rabbitStats.shot++;
}
export function killRabbitById(id) { const r = rabbits.find((o) => o.id === id); if (r) kill(r); }

// A DEAD ONE: the one the eye is on (its id, or null), and what comes of cutting it up (the host's to say): the meat, a very small chance of small bones
export function corpseInReach(eye, look, reach) {
	if (hidden()) return null;
	const list = followed ? followed.filter((o) => !o.alive) : corpses.map((c) => c.rabbit);
	let best = null, bestD = reach;
	for (const o of list) {
		const to = [o.x - eye[0], o.y + 0.1 * metre() - eye[1], o.z - eye[2]], d = Math.hypot(...to);
		if (d < bestD && (to[0] * look[0] + to[1] * look[1] + to[2] * look[2]) / (d || 1) > 0.7) { best = o; bestD = d; }
	}
	return best ? best.id : null;
}
export function harvest(id) {
	const at = corpses.findIndex((c) => c.rabbit.id == id);
	if (at < 0) return null;
	corpses.splice(at, 1);
	return Math.random() < BONES ? ['rabbitMeat', 'smallBones'] : ['rabbitMeat'];
}

// A SNARE SET (see the top): one out of the inventory, on the ground in front of the walker
export function setSnare(item) {
	const p = hunting.hunterPlace(), m = metre(), land = terrain.land;
	if (p.on != 'land' || p.swimming) { help.toast('On firm ground'); return false; }
	const yaw = settings.camYaw, x = p.x + Math.sin(yaw) * SNARE_AHEAD * m, z = p.z - Math.cos(yaw) * SNARE_AHEAD * m, y = land.heightAt(x, z);
	if (y < settings.waterWorldPosY + 0.1 * m || Math.abs(y - p.y) > 1.2 * m) { help.toast('No room to set it there'); return false; }
	inventory.useOne(item);
	loot.setTrap([x, land.groundAt(x, z), z], -yaw);
	help.toast('Snare set: rabbits within 50 m will come to it');
	return true;
}

// MULTIPLAYER (see the top): [id, x, y, z, heading, hop, 0, moving, own, 0, 0, alive]
export function rabbitShare() {
	const out = [];
	for (const r of rabbits) out.push(r.id, r.x, r.y, r.z, r.heading, r.hop, 0, r.moving, r.own, 0, 0, 1);
	for (const c of corpses) { const r = c.rabbit; out.push(r.id, r.x, r.y, r.z, r.heading, 0, 0, 0, r.own, 0, 0, 0); }
	return new Float32Array(out);
}
export function rabbitFollow(records) {
	if (!records) { followed = null; return; }
	followed = [];
	for (let k = 0; k < records.length; k += 12) followed.push({ id: records[k], x: records[k + 1], y: records[k + 2], z: records[k + 3], heading: records[k + 4], hop: records[k + 5], moving: records[k + 7], alive: records[k + 11] > 0.5 });
}

// Once a frame: moved on, and drawn near the camera
let lastTime = performance.now();
export function rabbitsUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.05);
	lastTime = now;
	if (!settings.enableRabbits) return;
	advance(dt);
	if (hidden()) return;
	const m = metre(), reach = DRAW * m, cx = settings.camPosX, cz = settings.camPosZ;
	const near = (o) => Math.abs(o.x - cx) < reach && Math.abs(o.z - cz) < reach;
	const show = (o, alive) => {
		if (!near(o)) return;
		if (alive) {
			// each hop: up and over, tipped back going up and forward coming down
			const up = Math.abs(Math.sin(o.hop)) * 0.16 * o.moving, tip = -Math.cos(o.hop) * 0.35 * o.moving * Math.sign(Math.sin(o.hop) || 1);
			props.show('rabbit', props.place([o.x, o.y + up * m, o.z], o.heading, tip));
		} else props.show('rabbitDead', props.place([o.x, o.y, o.z], o.heading));
	};
	if (followed) for (const o of followed) show(o, o.alive);
	else { for (const r of rabbits) show(r, true); for (const c of corpses) show(c.rabbit, false); }
}
// for testing
export const rabbitsForTest = () => (followed ?? rabbits).map((o) => ({ id: o.id, x: o.x, y: o.y, z: o.z, state: o.state, trap: o.trap }));
