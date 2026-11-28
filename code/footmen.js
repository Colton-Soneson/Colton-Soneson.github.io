import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as forest from './forest.js'
import * as boulders from './boulders.js'
import * as town from './town.js'
import * as deer from './deer.js'
import * as npcs from './npcs.js'

/*
	THE FOOTMEN (the Survival mode's: hired at a tavern, taverns.js, each in one of the player's fireteams or none, fireteams.js): men on foot,
	of three KINDS
		rifleman		the Mosin–Nagant (7.62x54R): middling health, a middling reach and pace, a middling rate of fire
		raider			the Mossberg (00 buckshot, PELLETS a shell): little health, but fast; goes in close, and fires quickly
		sniper			the Sharps (.45-70): little health, a long reach and a slow rate of fire; slow on his feet
	Each goes to his place in his fireteam's formation (the squad says where, as the horsemen's: npcRiders.js), at its pace (quicker to catch
	up, no faster than his kind can go), round what is in the way (as the town's hunters: npcHunters.js, blocked), and stands there facing
	the way it faces. And he fights whoever is hostile to the player (npcs.js: foesOfMine) as his orders let him (rules: the squad's, see
	fireteams.js THE COMMANDS): in his reach and in sight, he stops and shoots (FIRE: how far off his aim goes, more the further off);
	further, within as far as he may go after them, he closes on them first; holding, he only shoots, and does not move; falling back, at
	no one. DOWN: he lies there, and is back RESPAWN seconds later where the squad says (home: out of the player's sight, near them).
	HIRED OUT OF A TAVERN (taverns.js), he gets up from his bench and goes out of its door first (via: the way out, walked as it is,
	nothing in the way), on its floor (setFloor) while he is in it.
	Metres and seconds (places in world units). Only where the people are run (alone, or the host: npcs.runsHere)
*/
export const KINDS = {
	rifleman: { name: 'Rifleman', health: 100, walk: 1.4, run: 4.2, gun: 'rifle', round: '7.62x54R', reach: 160, every: [2.2, 3.2], spread: 0.006, spreadFar: 0.002, hat: 'peaked', price: 15,
		about: 'A Mosin–Nagant: steady at a middling range' },
	raider: { name: 'Shotgun raider', health: 60, walk: 1.6, run: 6.2, gun: 'shotgun', round: '00 buck', pellets: 9, choke: 0.045, reach: 20, every: [0.9, 1.3], spread: 0.01, spreadFar: 0, hat: 'beanie', price: 12,
		about: 'A Mossberg: quick on his feet and deadly close, but he does not last' },
	sniper: { name: 'Sniper', health: 55, walk: 1.2, run: 3.0, gun: 'sharps', round: '.45-70', reach: 420, every: [4.5, 6], spread: 0.0015, spreadFar: 0.0006, hat: 'flatCap', price: 25,
		about: 'A Sharps with a scope: a long reach, a slow shot, slow on his feet, and he does not last' },
};
const RESPAWN = 45;				// seconds
const LOOK = 0.35;				// seconds between looks round for who to fight
const THINK = 0.25;				// seconds between looks ahead for what is in the way
const FAN = [0, 0.4, -0.4, 0.8, -0.8, 1.3, -1.3, 1.9, -1.9, 2.6, -2.6];
const PROBES = [1.5, 3.5];		// metres
const STUCK = 3, ASIDE = 2;		// seconds
const STRIDE = 1.4;				// metres a stride
const CHASE = 180;				// metres he goes after anyone within, by his orders (as the horsemen)
const HOLDING = 60;				// a reach no more than this in his orders: he holds where he is (fireteams.js: HOLD_REACH)

const metre = () => settings.forestUnitsPerMetre;
const men = [];
// a floor over the land where there is one (taverns.js's): fn(x, z) its height there, or -Infinity
let floorAt = () => -Infinity;
export function setFloor(fn) { floorAt = fn; }
// and more in the way (taverns.js's walls): fn(x, z, reach, add) as hunting.js's addStill
let walls = () => {};
export function setWalls(fn) { walls = fn; }
const groundOf = (f) => Math.max(deer.groundUnder(f), floorAt(f.x, f.z));
export const footStats = { men: 0, shots: 0, down: 0 };

// in the way of one walking at (x, z) with his feet at feet: water, a tree, a boulder, a house
function blocked(x, z, feet) {
	const m = metre(), land = terrain.land;
	if (!terrain.inWorld(x, z, 20) || land.heightAt(x, z) < settings.waterWorldPosY + 0.3 * m || !deer.walkable(x, z)) return true;
	let hit = false;
	const box = (bx, bz, r, bottom, top) => { if (!hit && top > feet + 0.5 * m && bottom < feet + 1.8 * m && Math.abs(x - bx) < r + 0.4 * m && Math.abs(z - bz) < r + 0.4 * m) hit = true; };
	if (settings.enableForest) forest.trunksNear(x, z, m, box);
	if (settings.enableBoulders) boulders.bouldersNear(x, z, 2 * m, box);
	town.boxesNear(x, z, m, box);
	walls(x, z, m, box);
	return hit;
}
function place(f, walking) {
	f.person.place = { x: f.x, y: f.y, z: f.z, heading: f.heading, sit: 0, stride: f.person.stride ?? 0, walking };
	f.person.walking = walking;
}
// a step towards (x, z) at pace (metres a second), round what is in the way: how far off he still is
function walkTo(f, to, pace, dt) {
	const m = metre(), dx = to[0] - f.x, dz = to[1] - f.z, far = Math.hypot(dx, dz);
	if (far < 0.3 * m) { place(f, 0); return far; }
	f.think -= dt;
	if (Math.hypot(f.x - f.lastAt[0], f.z - f.lastAt[1]) > 0.5 * m) { f.lastAt = [f.x, f.z]; f.stuck = 0; }
	else if ((f.stuck += dt) > STUCK) { f.stuck = 0; f.aside = ASIDE; f.wanted = f.heading + (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random()); }
	if (f.aside > 0) f.aside -= dt;
	else if (f.think <= 0) {
		f.think = THINK;
		const want = Math.atan2(dx, dz);
		f.wanted = want;
		for (const off of FAN) {
			const a = want + off;
			if (!PROBES.some((d) => d * m < far + m && blocked(f.x + Math.sin(a) * d * m, f.z + Math.cos(a) * d * m, f.y))) { f.wanted = a; break; }
		}
	}
	let off = f.wanted - f.heading;
	off -= Math.PI * 2 * Math.round(off / (Math.PI * 2));
	f.heading += off * Math.min(dt * 6, 1);
	const step = Math.min(pace * m * dt, far), nx = f.x + Math.sin(f.heading) * step, nz = f.z + Math.cos(f.heading) * step;
	if (!blocked(nx, nz, f.y)) { f.x = nx; f.z = nz; }
	f.y = groundOf(f);
	f.person.stride = (f.person.stride ?? 0) + step / (STRIDE * m) * Math.PI;
	place(f, Math.min(pace / 1.4, 1));
	return far - step;
}
// a shot (or a shell's pellets) at the target, from his muzzle
function shoot(f, target, K) {
	const m = metre(), p = f.person, muzzle = [f.x + Math.sin(f.heading) * 0.8 * m, f.y + 1.45 * m, f.z + Math.cos(f.heading) * 0.8 * m];
	for (let k = 0; k < (K.pellets ?? 1); k++) npcs.fireAt(p, muzzle, target, { round: K.round, spread: K.pellets ? K.choke : K.spread, spreadFar: K.spreadFar });
	footStats.shots++;
}

// HIRED (fireteams.js): a man of a kind, his group (the player's hired: npcs.js), where he starts ({ x, z, heading }), his squad (as
//		npcRiders.addHired's: spot(), moving(), pace(), facing(), home(), rules()). He is his own place for the fireteams (x, z; exists): as
//		a horseman's horse
export function addHired(kind, group, at, squad, name, via = []) {
	const K = KINDS[kind];
	const person = npcs.makePerson('footman', { hat: K.hat, gun: K.gun, home: at, name, group });
	person.health = K.health;
	const f = { kind, person, squad, x: at.x, z: at.z, y: 0, heading: at.heading ?? 0, exists: true, wanted: at.heading ?? 0, think: 0, stuck: 0, aside: 0, lastAt: [at.x, at.z], look: Math.random() * LOOK, enemyId: null, seen: false, fire: 1, via: [...via] };
	f.horse = f;		// (where fireteams.js looks for a horseman's horse)
	f.y = groundOf(f);
	place(f, 0);
	men.push(f);
	footStats.men = men.length;
	return f;
}
export const hasMan = (f) => men.includes(f);
export function removeHired(f) {
	const k = men.indexOf(f);
	if (k >= 0) men.splice(k, 1);
	npcs.removePerson(f.person);
	footStats.men = men.length;
}
// put somewhere at once (left far behind, brought on)
export function placeHired(f, x, z, heading) { Object.assign(f, { x, z, heading, ground: null, via: [] }); f.y = groundOf(f); place(f, 0); }

function step(f, dt) {
	const m = metre(), p = f.person, K = KINDS[f.kind], S = f.squad;
	// down: lying there; back in a while near the player
	if (!p.alive) {
		p.fighting = false;
		if (p.respawnIn <= 0 && p.respawnIn > -1) {
			npcs.revive(p);
			p.health = K.health;
			const home = S.home();
			placeHired(f, home.x, home.z, home.heading);
		}
		return;
	}
	// (out of the tavern first, the way out as it is)
	if (f.via.length) {
		const [vx, vz] = f.via[0], dx = vx - f.x, dz = vz - f.z, d = Math.hypot(dx, dz), stepTo = Math.min(K.walk * m * dt, d);
		if (d > 1e-4) { f.heading = Math.atan2(dx, dz); f.x += dx / d * stepTo; f.z += dz / d * stepTo; }
		f.y = groundOf(f);
		p.stride = (p.stride ?? 0) + stepTo / (STRIDE * m) * Math.PI;
		place(f, 1);
		if (d - stepTo < 0.2 * m) f.via.shift();
		return;
	}
	// who to fight, by his orders: none falling back; holding, only those in his reach
	const rules = S.rules?.() ?? null, holding = rules && rules.reach > 0 && rules.reach <= HOLDING;
	const after = rules?.reach === 0 ? 0 : holding ? K.reach : Math.max(K.reach, rules?.reach ?? CHASE);
	if ((f.look -= dt) <= 0) {
		f.look += LOOK;
		const found = after > 0 ? npcs.foesOfMine(f.x, f.y + 1.5 * m, f.z).find((e) => e.d < after * m) : null;
		f.enemyId = found?.id ?? null;
		f.seen = !!found && npcs.clearLine([f.x, f.y + 1.5 * m, f.z], [found.x, found.y, found.z]);
	}
	const t = f.enemyId ? npcs.targetById(f.enemyId) : null;
	const enemy = t && t.alive ? { ...t, d: Math.hypot(t.x - f.x, t.z - f.z) } : null;
	if (enemy) {
		p.fighting = true;
		p.aim = Math.atan2(enemy.y - f.y - 1.45 * m, enemy.d);
		if (enemy.d < K.reach * m && f.seen) {
			// in his reach and in sight: still, turned to them, firing
			let off = Math.atan2(enemy.x - f.x, enemy.z - f.z) - f.heading;
			off -= Math.PI * 2 * Math.round(off / (Math.PI * 2));
			f.heading += off * Math.min(dt * 6, 1);
			place(f, 0);
			if ((f.fire -= dt) <= 0 && Math.abs(off) < 0.2) { f.fire = K.every[0] + Math.random() * (K.every[1] - K.every[0]); shoot(f, enemy, K); }
			return;
		}
		// further (or out of sight): closer, at a run, unless he holds
		if (!holding) { walkTo(f, [enemy.x, enemy.z], K.run, dt); return; }
	}
	p.fighting = false;
	// to his place in the formation, at its pace (faster to catch up, no faster than he can go); there, facing the way it faces
	const [tx, tz] = S.spot(), d = Math.hypot(tx - f.x, tz - f.z) / m, moving = S.moving();
	if (d < 1.2 && !moving) {
		let off = S.facing() - f.heading;
		off -= Math.PI * 2 * Math.round(off / (Math.PI * 2));
		f.heading += off * Math.min(dt * 3, 1);
		place(f, 0);
		return;
	}
	const pace = Math.min(d > 25 ? K.run : d > 6 ? (K.walk + K.run) / 2 : moving ? Math.max(S.pace(), K.walk * 0.6) : K.walk, K.run);
	walkTo(f, [tx, tz], pace, dt);
}

// ONCE A FRAME (rotatingCube.js)
let lastTime = performance.now();
export function footmenUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	footStats.down = 0;
	for (const f of men) { step(f, dt); if (!f.person.alive) footStats.down++; }
}
// for testing
export const footmenForTest = () => men.map((f) => ({ kind: f.kind, x: f.x, z: f.z, alive: f.person.alive, health: f.person.health, fighting: f.person.fighting, enemy: f.enemyId }));
