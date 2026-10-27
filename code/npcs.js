import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as ballistics from './ballistics.js'
import * as hunting from './hunting.js'
import * as players from './players.js'
import * as townFolk from './townFolk.js'
import * as horse from './horse.js'
import * as plane from './plane.js'
import * as boat from './boat.js'
import { announceSpawn } from './radialMenu.js'

/*
	THE NPCS: people who live in the world and go about it in its vehicles, run by this machine (in a game with others, by the host:
	npcNet): the riders going between the towns (npcRiders.js), the airmen of the landing strip (npcPlanes.js), and the schooner's
	crew and the dinghies' sailors (npcShips.js). This file is what all of them are; those say what each kind does.

	A PERSON (makePerson): its kind, its hat (townFolk.js makes them), its colour, its gun, its group (its crew: they are hostile
		together), where its place is now (its kind's file puts it there each frame: on a horse, in a cockpit, at a gun, on its feet)
		and its health. DRAWN as the townsfolk are (townFolk.addFolkSource): the dummy in the hat of its trade, sitting, astride or
		standing as its place says, a gun in its hands while it fights.
	SHOT (by a bullet fired here that is not one of theirs): HARM off its health by the part hit (as the players: DAMAGE in net.js),
		times the round's (ballistics.ROUNDS). At none it is down: off whatever it was on, over on to its back where it fell (or
		under the water), and gone DOWN_SECONDS later. Back at its home RESPAWN_SECONDS after it fell, as its kind's file has it (a
		new horse, a new plane, the end of the dock: onRespawn). A shell bursting near it (shipGuns.js) is a hit too.
	HOSTILE (attacked): shot at (it, its horse, its plane, its boat: whoever fired a bullet that hit any of them), its group and its
		group's allies are hostile to the one who fired for HOSTILE_SECONDS after the last of it. Its kind's file says what it does
		about it. A NEAR MISS is as good as a hit: a round going by one of their planes within NEAR_MISS.plane metres of it, or by one of
		their boats within NEAR_MISS.boat of her (past her reach, vessels.js), once a round.
	THEIR GUNS (fireAt): a round from a muzzle at a target, led for where the target is going and raised for how far the round falls,
		off by the shooter's spread (more the further), times the AI difficulty's (ballistics.aimSpread). npc: they hit the players (THE
		PLAYERS), not each other.
	THE PLAYERS (targets): this player out hunting (alone or the host), and the others in a game, wherever they are (on foot, on a
		horse, in a plane, on a boat), with how fast each is going. A round of theirs that hits one: this player alone, its health
		down here (it heals as after a crash); in a game, the host takes it off (npcNet.hurt) as it does a horde deer's lunge.
	MULTIPLAYER (net.js, npcNet): the host runs them all, their vehicles too (owned by 'npc', sailed by the host: net.js sends them as it
		does the players', and is told when one is put out or taken away: announce). A joiner runs none of its own while it is in a game
		(runsHere): the host sends it its people (peopleShare, PEOPLE_RATE times a second: each one's place in the vehicle it is in, its
		anchor, or on the ground), and it draws them on its own vehicles as it draws them (peopleHeard, follow). Their rounds go to it too,
		for their trails and their reports (npcNet.fired). A joiner's hit on one, or on its horse, its plane or its boat, goes to the host
		(npcNet.shot, npcNet.attack), which does the rest.
	THE WAR (war.js: war): every one of them on one of two sides (person.side, its group's), hostile to everyone on the other: the players
		by the side each chose (war.sideOf), the other side's people, and what war.js adds (addTargets: the townsfolk). Their rounds hit the
		other side's people and not their own (and the players, either side's: team damage). Each is drawn bright red if it is on the other
		side from the one looking, bright blue if on its own (vf_dummy.js; with no side chosen, each its own side's colour).
	In metres and seconds (the world in world units, settings.forestUnitsPerMetre to the metre)
*/
const HOSTILE_SECONDS = 90;
const DOWN_SECONDS = 25;
export const RESPAWN_SECONDS = 30;
const HEALTH = 100;
const HARM = { head: 100, chest: 70, belly: 55, leg: 30 };	// (as net.js's DAMAGE)
const NEAR_MISS = { plane: 15, boat: 8 };						// metres

const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export const wrap = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
export const on = () => settings.enableNPCs && settings.enableTerrain && !!terrain.land;

// What the game asks of it (net.js, see MULTIPLAYER at the top): what this machine is in a game ('off' alone, 'host', 'joined'), the others
//		in the game, the harm to one of them, and what a joiner tells the host (a hit on one of them, on their vehicles) and the host the
//		joiners (their rounds)
export const npcNet = { roleNow: () => 'off', others: () => [], hurt: null, shot: null, attack: null, fired: null };
// THE WAR (see the top, war.js): whether it is on; a player's side ('me' or another's id: 'red', 'blue', or null for none chosen yet); the
//		side of a shooter npcs.js does not know (a townsperson's: 'folk:' and its number); the nearest house of the other side's still standing
//		(houseFor(side, from, world units): { x, y (its middle), z }); and the townsfolk round a shell's burst hurt (blastFolk(at, radius))
export const war = { on: false, sideOf: () => null, shooterSide: () => null, houseFor: null, blastFolk: null };
const targetSources = [];
// more for them to fight in the war (war.js: the townsfolk): fn(add), add({ id, kind, x, y (its chest), z, feet, alive, vehicle, sit, heading, side })
export function addTargets(fn) { targetSources.push(fn); }
export const sideOfShooter = (id) => people.find((p) => p.id === id)?.side ?? war.shooterSide(id) ?? null;
// how one of the war's people is coloured to the one looking (vf_dummy.js): 1 the other side (red), 2 its own (blue); with no side chosen,
//		each its own side's colour
function sideTint(side) {
	const mine = war.sideOf('me');
	return mine ? (side == mine ? 2 : 1) : side == 'red' ? 1 : 2;
}
// whether this machine runs the NPCs (alone, or the host)
export const runsHere = () => npcNet.roleNow() != 'joined';
// one of their vehicles put out (added) or taken away (removed): for the others, if this machine runs them (radialMenu.js: net.js hears)
export function announce(kind, added, removed) { if (runsHere()) announceSpawn(kind, added, removed); }
// a round of theirs fired (from, along dir, world units; round): to the joiners, for its trail
export function shotFired(from, dir, round) { if (npcNet.roleNow() == 'host') npcNet.fired?.(from, dir, round); }

export const npcStats = { people: 0, alive: 0, drawn: 0, shots: 0, hits: 0, playerHits: 0, killed: 0, respawned: 0 };

// The people
//-------------------------------------------------
export const people = [];
let nextNumber = 1;
// a person: kind (what it is, for the feed: 'rider', 'pilot', ...), hat, gun (players.js's HELD_LENGTH names, held while it fights),
//		group (its crew: { hostile, allies }), home ({ x, z, heading }, world units)
export function makePerson(kind, { hat, gun = 'rifle', group = null, home = null, hue = Math.random(), name = kind } = {}) {
	const person = { id: `npc:${kind}${nextNumber++}`, kind, name, hat, gun, hue, group: group ?? makeGroup(), home, health: HEALTH, alive: true, down: 0, gone: false,
		place: null, hit: 0, fighting: false, aim: 0, armsDown: 0, look: 0, stride: 0, walking: 0, respawnIn: -1 };
	person.side = person.group.side ?? null;
	people.push(person);
	person.group.members.push(person);
	return person;
}
export function removePerson(person) {
	const at = people.indexOf(person);
	if (at >= 0) people.splice(at, 1);
	const k = person.group.members.indexOf(person);
	if (k >= 0) person.group.members.splice(k, 1);
}
// a crew: hostile is who it is hostile to (id -> until when, seconds), allies the other groups it fights alongside
export function makeGroup() { return { members: [], hostile: new Map(), allies: [], lastShotBy: null }; }
export function allyGroups(a, b) { a.allies.push(b); b.allies.push(a); }

// Hostile (see HOSTILE at the top)
//-------------------------------------------------
let clock = 0;
export const now = () => clock;
// the group was shot at by who ('me', or another player's id): it, and its allies, are hostile to them
export function provoke(group, who) {
	if (who === null || who === undefined) return;
	for (const g of [group, ...group.allies]) { g.hostile.set(who, clock + HOSTILE_SECONDS); g.lastShotBy = who; }
}
// whether a group is hostile to who now
export const hostileTo = (group, who) => (group.hostile.get(who) ?? -1) > clock;
// who it is hostile to now, of the targets (targets()), nearest first from (x, y, z) world units
// (each group's list made once a frame: every one of a crew asks)
const hostileThisFrame = new Map();
export function enemiesOf(group, x, y, z) {
	let list = hostileThisFrame.get(group);
	if (!list) {
		const hostile = war.on && group.side ? (t) => !!t.side && t.side != group.side : (t) => t.kind == 'player' && hostileTo(group, t.id);
		list = targets().filter((t) => t.alive && hostile(t));
		hostileThisFrame.set(group, list);
	}
	return list.map((t) => ({ ...t, d: Math.hypot(t.x - x, t.y - y, t.z - z) })).sort((a, b) => a.d - b.d);
}
// who fired a bullet, as hostility goes: this player for its own, another player's id for theirs (net.js: npcNet.shot), none for theirs
export const firedBy = (bullet) => bullet?.npc ? null : bullet?.remote ? bullet.shooter : bullet?.shooter == 'folk' ? null : bullet?.by ?? 'me';

// Shot (see SHOT at the top)
//-------------------------------------------------
const downListeners = [];
// told when one of them is down: fn(person, who shot it)
export function onDown(fn) { downListeners.push(fn); }
export function harm(person, amount, who, how = 'shot') {
	if (!person.alive) return;
	person.health -= amount;
	person.hit = 1;
	provoke(person.group, who);
	if (person.health > 0) return;
	person.alive = false;
	person.down = 0;
	person.respawnIn = RESPAWN_SECONDS;
	npcStats.killed++;
	for (const fn of downListeners) fn(person, who, how);
	if (who === 'me') players.addFeed(`You shot the ${person.name}`);
}
// (each one's hitbox: the players' dummy's, players.js, tipped as it is drawn: tilt)
function spheresOf(person) {
	const p = person.place;
	if (!p) return [];
	if (!p.tilt) return players.dummySpheres(p, 0, p.sit ?? 0);
	return players.dummySpheres({ x: 0, y: 0, z: 0, heading: 0 }, 0, p.sit ?? 0).map(([x, y, z, r, part]) => {
		const v = turnY(turnX(turnZ([x, y, z], p.tilt[1]), p.tilt[0]), p.heading);
		return [p.x + v[0], p.y + v[1], p.z + v[2], r, part];
	});
}
// (turned as vf_dummy.js turns: about x, y and z, radians)
const turnX = ([x, y, z], a) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
const turnY = ([x, y, z], a) => [x * Math.cos(a) + z * Math.sin(a), y, z * Math.cos(a) - x * Math.sin(a)];
const turnZ = ([x, y, z], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
// a person sat or stood in something that is tipped (a plane, a boat): its heading and tilt (vf_dummy.js) from that thing's forward and
//		up in the world
export function tipped(forward, up) {
	const heading = Math.atan2(forward[0], forward[2]);
	const f = turnY(forward, -heading), u = turnY(up, -heading);
	const a = -Math.asin(clamp(f[1], -1, 1));
	return { heading, tilt: [a, Math.atan2(-u[0], u[1] * Math.cos(a) + u[2] * Math.sin(a))] };
}
ballistics.addTarget((ax, ay, az, bx, by, bz, bullet) => {
	// (one of theirs: in the war, the other side's people; otherwise none of them)
	const from = bullet?.npc ? (war.on ? sideOfShooter(bullet.shooter) : null) : undefined;
	if (!on() || from === null) return null;
	const m = metre(), mx = (ax + bx) / 2, mz = (az + bz) / 2, reach = Math.hypot(bx - ax, bz - az) / 2 + 2 * m;
	let best = null;
	for (const person of people) {
		const p = person.place;
		if (!person.alive || !p || (from && person.side == from) || Math.abs(p.x - mx) > reach || Math.abs(p.z - mz) > reach) continue;
		if (ballistics.crossSphere(ax, ay, az, bx, by, bz, p.x, p.y + 1.0 * m, p.z, 1.3 * m) === null) continue;
		for (const [x, y, z, r, part] of spheresOf(person)) {
			const t = ballistics.crossSphere(ax, ay, az, bx, by, bz, x, y, z, r);
			if (t !== null && (!best || t < best.t)) best = { t, person, part };
		}
	}
	return best && { t: best.t, what: 'npc', hit: (velocity, bullet) => {
		npcStats.hits++;
		if (!bullet?.npc) players.markHit(best.part == 'head');
		const who = bullet?.npc ? bullet.shooter : firedBy(bullet);
		if (runsHere()) harm(best.person, HARM[best.part] * (ballistics.ROUNDS[bullet?.round]?.damage ?? 1), who);
		else npcNet.shot?.(best.person.id, best.part, bullet?.round);
	} };
}, () => {
	const m = metre(), list = [];
	for (const person of people) { const p = person.place; if (person.alive && p) list.push(p.x, p.y + 1.0 * m, p.z, 2.2 * m); }
	return list;
});
// their vehicles: whose group each is (each kind's file says: fn(vehicle id) gives the group on it, or null). A hit on one is a hit on them
const groupFinders = [];
export function addVehicleGroups(fn) { groupFinders.push(fn); }
function vehicleShot(id, bullet) {
	const who = firedBy(bullet);
	if (!who || !String(id).startsWith('npc:')) return;
	if (runsHere()) attackHeard(id, who);
	else npcNet.attack?.(id);
}
horse.onHorseShot((h, bullet) => vehicleShot(h.id, bullet));
plane.onPlaneShot((p, bullet) => vehicleShot(p.id, bullet));
boat.onBoatShot((b, bullet) => vehicleShot(b.id, bullet));
// A NEAR MISS (see HOSTILE at the top): a round going by one of their planes or boats (on a joiner, its own rounds: the host sees the others')
ballistics.onPass((ax, ay, az, bx, by, bz, bullet) => {
	if (!on() || (bullet.remote && !runsHere()) || !firedBy(bullet)) return;
	const m = metre(), a = [ax, ay, az], b = [bx, by, bz];
	const near = (id, centre, reach) => {
		if (!String(id).startsWith('npc:') || bullet.nearMissed?.has(id) || distanceToLine(centre, a, b) > reach * m) return;
		(bullet.nearMissed ??= new Set()).add(id);
		vehicleShot(id, bullet);
	};
	for (const p of plane.planes) if (p.destroyed < 0) near(p.id, p.frame.toWorld([0, 0, 0]), NEAR_MISS.plane);
	for (const s of boat.boats) if (s.destroyed < 0) near(s.id, s.frame.toWorld([0, 1, 0]), s.vessel.reach + NEAR_MISS.boat);
});
// how far a point is from the line from a to b (all world units)
function distanceToLine(p, a, b) {
	const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
	const t = clamp(dot(ap, ab) / Math.max(dot(ab, ab), 1e-9), 0, 1);
	return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}
// a vehicle of theirs attacked (by who): its group hostile (a joiner's attack, heard by the host: net.js)
export function attackHeard(id, who) {
	for (const find of groupFinders) { const group = find(id); if (group) { provoke(group, who); return; } }
}
// a joiner's hit, heard by the host (net.js)
export function shotHeard(id, part, round, who) {
	const person = people.find((one) => one.id === id);
	if (person && part in HARM) harm(person, HARM[part] * (ballistics.ROUNDS[round]?.damage ?? 1), who);
}
// a shell bursting (shipGuns.js) at (world units), fired here: each of them within radius (world units) hurt by how near
export function blast(at, radius, who = 'me') {
	for (const person of people) {
		const p = person.place;
		if (!person.alive || !p) continue;
		const d = Math.hypot(p.x - at[0], p.y + metre() - at[1], p.z - at[2]);
		if (d < radius) harm(person, 130 * (1 - d / radius), who, 'shell');
	}
}

// The players (see THE PLAYERS at the top)
//-------------------------------------------------
// each: { id ('me' or a player's number), x, y, z (its chest, world units), v (world units a second), alive, vehicle (the vehicle it is
//		in or on: its id, or null), sit, heading }
const lastSeen = new Map();		// id -> { x, y, z, v, at }: how fast each is going, from where it was
let targetList = [], targetIds = new Map();
// one of the targets by its id, as it is this frame (or undefined)
export const targetById = (id) => targetIds.get(id);
export const targets = () => targetList;
function gatherTargets() {
	const m = metre(), list = [];
	const me = hunting.hunterPlace();
	if (me.active && runsHere()) {
		list.push({ id: 'me', kind: 'player', side: war.on ? war.sideOf('me') : null, x: me.x, y: me.y + (me.sit ? 0.5 : 1.2) * m, z: me.z, feet: me.y, alive: hunting.hunterLife.alive, vehicle: me.vehicle ?? me.boat ?? null, sit: me.on == 'saddle' ? 2 : me.sit ?? 0,
			heading: Math.atan2(Math.sin(settings.camYaw), -Math.cos(settings.camYaw)), swimming: me.swimming });
	}
	for (const other of npcNet.others()) list.push({ ...other, kind: 'player', side: war.on ? war.sideOf(other.id) : null, y: other.y + (other.sit ? 0.5 : 1.2) * m, feet: other.y });
	// (in the war: their own people, and the townsfolk)
	if (war.on) {
		for (const person of people) {
			const p = person.place;
			if (!person.alive || !p || person.remote || !person.side || person.gone) continue;
			list.push({ id: person.id, kind: 'npc', x: p.x, y: p.y + (p.sit ? 0.5 : 1.2) * m, z: p.z, feet: p.y, alive: true, vehicle: person.anchor?.vehicle ?? null, sit: p.sit ?? 0, heading: p.heading, side: person.side });
		}
		for (const fn of targetSources) fn((t) => list.push(t));
	}
	for (const t of list) {
		const seen = lastSeen.get(t.id);
		if (seen && clock > seen.at) {
			const dt = clock - seen.at, k = Math.min(dt / 0.25, 1);
			const v = [(t.x - seen.x) / dt, (t.y - seen.y) / dt, (t.z - seen.z) / dt];
			// (a jump of more than 100 metres a second is a teleport, not a speed)
			t.v = Math.hypot(...v) > 100 * m ? [0, 0, 0] : seen.v.map((was, i) => was + (v[i] - was) * k);
		} else t.v = seen?.v ?? [0, 0, 0];
		lastSeen.set(t.id, { x: t.x, y: t.y, z: t.z, v: t.v, at: clock });
	}
	if (lastSeen.size > list.length * 2 + 50) for (const [id, seen] of lastSeen) if (clock - seen.at > 3) lastSeen.delete(id);
	targetList = list;
	targetIds = new Map(list.map((t) => [t.id, t]));
	hostileThisFrame.clear();
}

// Their guns (see THEIR GUNS at the top)
//-------------------------------------------------
// a round of round from muzzle (world units) at target ({ x, y, z, v }), off by spread radians (and spreadFar more for every 100
//		metres), or along aimAt (a direction) if it is given. Gives the direction it went
export function fireAt(person, muzzle, target, { round = '7.62x54R', spread = 0.01, spreadFar = 0.004, aimAt = null } = {}) {
	const m = metre(), R = ballistics.ROUNDS[round] ?? ballistics.ROUNDS['7.62x54R'];
	const dir = aimAt ?? leadDirection(muzzle, target, R);
	const d = Math.hypot(target.x - muzzle[0], target.y - muzzle[1], target.z - muzzle[2]) / m;
	const off = (spread + spreadFar * d / 100) * ballistics.aimSpread();
	// (off to a side, across the line, by a random amount)
	const side = norm(cross(dir, Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), up = cross(side, dir);
	const a = Math.random() * Math.PI * 2, r = off * Math.sqrt(Math.random());
	const shot = norm(dir.map((v, i) => v + side[i] * Math.cos(a) * r + up[i] * Math.sin(a) * r));
	ballistics.fire(muzzle, shot, { round, shooter: person.id, npc: true, quiet: true });
	shotFired(muzzle, shot, round);
	npcStats.shots++;
	return shot;
}
// the way to point to hit a target from muzzle: where it will be when the round gets there, and up for how far the round drops (a
//		round leaves at its own speed whichever way the gun is going: ballistics.js)
export function leadDirection(muzzle, target, R) {
	const m = metre();
	let at = [target.x, target.y, target.z];
	const tv = target.v ?? [0, 0, 0];
	for (let k = 0; k < 3; k++) {
		const d = Math.hypot(at[0] - muzzle[0], at[1] - muzzle[1], at[2] - muzzle[2]) / m;
		const t = flightTime(R, d);
		at = [target.x + tv[0] * t, target.y + tv[1] * t, target.z + tv[2] * t];
		at[1] += 0.5 * 9.81 * (R.gravity ?? 1) * t * t * m;
	}
	return norm([at[0] - muzzle[0], at[1] - muzzle[1], at[2] - muzzle[2]]);
}
// seconds for a round to go d metres (slowed by the air: ballistics.js's drag)
export const flightTime = (R, d) => (Math.exp(R.drag * d) - 1) / (R.drag * R.velocity);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

// whether the land is in the way between two places (world units)
export function clearLine(a, b, steps = 16) {
	const land = terrain.land;
	if (!land) return true;
	for (let k = 1; k < steps; k++) {
		const t = k / steps, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
		if (land.heightAt(x, z) > y) return false;
	}
	return true;
}

// a round of theirs at the players: this player (alone, or the host) and, the host, the others (see THE PLAYERS at the top)
ballistics.addTarget((ax, ay, az, bx, by, bz, bullet) => {
	if (!bullet?.npc || !runsHere()) return null;
	let best = null;
	for (const t of targets()) {
		if (!t.alive || t.kind != 'player') continue;
		if (ballistics.crossSphere(ax, ay, az, bx, by, bz, t.x, t.y, t.z, 1.5 * metre()) === null) continue;
		const view = { x: t.x, y: t.feet, z: t.z, heading: t.heading ?? 0 };
		for (const [x, y, z, r, part] of players.dummySpheres(view, 0, t.sit ?? 0)) {
			const hitAt = ballistics.crossSphere(ax, ay, az, bx, by, bz, x, y, z, r);
			if (hitAt !== null && (!best || hitAt < best.t)) best = { t: hitAt, target: t, part };
		}
	}
	return best && { t: best.t, what: 'player', hit: (velocity, bullet) => {
		npcStats.playerHits++;
		const shooter = people.find((one) => one.id === bullet.shooter);
		hurtPlayer(best.target.id, HARM[best.part] * (ballistics.ROUNDS[bullet.round]?.damage ?? 1), `Shot by ${shooter ? 'the ' + shooter.name : 'someone'}`);
	} };
}, () => {
	if (!runsHere()) return [];
	const list = [];
	for (const t of targets()) if (t.alive && t.kind == 'player') list.push(t.x, t.y, t.z, 2.5 * metre());
	return list;
});
// a shell of theirs bursting at (world units): each of the players within radius (world units) hurt by how near
export function blastPlayers(at, radius) {
	for (const t of targets()) {
		const d = Math.hypot(t.x - at[0], t.y - at[1], t.z - at[2]);
		if (t.alive && t.kind == 'player' && d < radius) hurtPlayer(t.id, 110 * (1 - d / radius), 'Caught in a shell burst');
	}
}
// harm to a player: this one alone, here; in a game, through the host
export function hurtPlayer(id, amount, how) {
	if (npcNet.roleNow() == 'host') { npcNet.hurt?.(id, amount, how); return; }
	if (id !== 'me') return;
	const life = players.localLife();
	if (life.alive) players.setLocalHealth(life.health - amount, '', how);
}

// Drawing them (as the townsfolk, see the top)
//-------------------------------------------------
townFolk.addFolkSource((each) => {
	if (!on()) return;
	let drawn = 0;
	for (const person of people) {
		const p = person.place;
		if (!p || person.gone) continue;
		each({ x: p.x, y: p.y, z: p.z, heading: p.heading, tilt: p.tilt, pitch: person.fighting ? person.aim : 0, stride: person.stride, walking: person.walking, fallen: person.alive ? 0 : Math.min(person.down / 0.6, 1),
			hit: person.hit, hue: person.hue, sit: person.alive ? p.sit ?? 0 : 0, gun: person.fighting && person.alive ? person.gun : 'none', armsDown: person.armsDown, look: person.look, hat: person.hat,
			side: war.on && person.side ? sideTint(person.side) : 0 });
		drawn++;
	}
	npcStats.drawn = drawn;
});

// Per frame (before the kinds' files: npcRiders.js and the rest each do their own after this)
//-------------------------------------------------
let lastTime = performance.now();
export function npcUpdate() {
	const nowMs = performance.now();
	const elapsed = Math.min((nowMs - lastTime) / 1000, 0.1);
	lastTime = nowMs;
	clock += elapsed;
	if (!on()) return 0;
	if (runsHere() && remote.size) clearRemote();
	if (!runsHere()) follow();
	gatherTargets();
	let alive = 0;
	for (const person of people) {
		person.hit = Math.max(person.hit - elapsed * 2, 0);
		if (person.alive) { alive++; continue; }
		person.down += elapsed;
		if (person.down > DOWN_SECONDS) person.gone = true;
		if (person.respawnIn > 0) person.respawnIn -= elapsed;
	}
	npcStats.people = people.length;
	npcStats.alive = alive;
	return elapsed;
}
// MULTIPLAYER (see the top): the people as the host sends them. Each: [id, hat, colour, alive, down (seconds), gone, the vehicle it is in ('' for
//		none), where (in the vehicle, metres: local x, y, z; or on the ground, world units: x, y, z), which way (in the vehicle: a direction
//		in its own directions; or a heading and nothing), sitting, fighting, aim, arms down, gun, kind, side ('' for none)]
export function peopleShare() {
	const r = (v) => Math.round(v * 1000) / 1000;
	return people.filter((p) => !p.remote).map((p) => {
		const a = p.anchor, pl = p.place;
		const where = a ? [...a.local, ...a.facing] : pl ? [pl.x, pl.y, pl.z, pl.heading, 0, 0] : [0, 0, 0, 0, 0, 0];
		return [p.id, p.hat, r(p.hue), p.alive ? 1 : 0, r(p.down), p.gone || !pl ? 1 : 0, a ? a.vehicle : '', ...where.map(r), pl?.sit ?? 0, p.fighting ? 1 : 0, r(p.aim), p.armsDown, p.gun, p.kind, p.side ?? ''];
	});
}
// a joiner: the host's people as they are now (net.js), in place of any it had
const remote = new Map();
export function peopleHeard(list) {
	const seen = new Set();
	for (const [id, hat, hue, alive, down, gone, vehicle, a0, a1, a2, b0, b1, b2, sit, fighting, aim, armsDown, gun, kind, side] of list) {
		let p = remote.get(id);
		if (!p) {
			p = { id, kind, name: kind, hat, gun, hue, group: makeGroup(), home: null, health: HEALTH, alive: true, down: 0, gone: false, place: null, hit: 0, fighting: false, aim: 0, armsDown: 0, look: 0, stride: 0, walking: 0, respawnIn: -1, remote: true };
			people.push(p);
			remote.set(id, p);
		}
		Object.assign(p, { hat, hue, alive: !!alive, gone: !!gone, fighting: !!fighting, aim, armsDown, gun, kind, sit, side: side || null });
		p.down = alive ? 0 : Math.max(p.down, down);
		p.anchor = vehicle ? { vehicle, local: [a0, a1, a2], facing: [b0, b1, b2] } : null;
		if (!vehicle) p.place = { x: a0, y: a1, z: a2, heading: b0, sit };
		seen.add(id);
	}
	for (const [id, p] of remote) if (!seen.has(id)) { removePerson(p); remote.delete(id); }
}
// a joiner, each frame: each of the host's people in its vehicle as this machine draws it (and the vehicle told who is in it: a horse's
//		rider, a plane's crew and its gunner's aim, so this player cannot climb in on top of them)
const frameOf = (id) => horse.horseById(id)?.frame ?? plane.planeById(id)?.frame ?? boat.boatById(id)?.frame ?? null;
function follow() {
	for (const p of remote.values()) {
		const a = p.anchor;
		if (!a) continue;
		const frame = frameOf(a.vehicle);
		if (!frame) { p.place = null; continue; }
		const at = frame.toWorld(a.local), ahead = frame.toWorld(a.local.map((v, i) => v + a.facing[i])), over = frame.toWorld([a.local[0], a.local[1] + 1, a.local[2]]);
		const { heading, tilt } = tipped(norm(ahead.map((v, i) => v - at[i])), norm(over.map((v, i) => v - at[i])));
		p.place = { x: at[0], y: at[1], z: at[2], heading, tilt: p.sit == 2 ? null : tilt, sit: p.sit };
		const h = horse.horseById(a.vehicle);
		if (h && h.rider !== 'me') horse.setRider(h, p.alive ? p.id : null);
		const q = plane.planeById(a.vehicle);
		if (q) {
			const seat = p.kind == 'pilot' ? 'pilot' : 'gunner';
			if (q.crew[seat] !== 'me') q.crew[seat] = p.alive ? p.id : null;
			if (seat == 'gunner') q.npcAim = [a.facing[0] * Math.cos(p.aim), Math.sin(p.aim), a.facing[2] * Math.cos(p.aim)];
		}
	}
}
// a joiner: where the host's person at local (metres, on a vehicle: its anchor) looks, its facing round and its aim up: { yaw, pitch } or
//		null (shipGuns.js turns the gun they man to it)
export function crewLook(vehicle, local) {
	for (const p of remote.values()) {
		const a = p.anchor;
		if (p.alive && a && a.vehicle === vehicle && Math.hypot(a.local[0] - local[0], a.local[1] - local[1], a.local[2] - local[2]) < 0.05) return { yaw: Math.atan2(a.facing[0], a.facing[2]), pitch: p.aim };
	}
	return null;
}
function clearRemote() { for (const p of remote.values()) removePerson(p); remote.clear(); }

// back up again, at full health (its kind's file puts it where it comes back)
export function revive(person) {
	Object.assign(person, { health: HEALTH, alive: true, down: 0, gone: false, respawnIn: -1, hit: 0, fighting: false });
	npcStats.respawned++;
}

// for testing
export function npcList() {
	return people.map((p) => ({ id: p.id, kind: p.kind, alive: p.alive, health: p.health, place: p.place && { ...p.place }, fighting: p.fighting, hostile: [...p.group.hostile.entries()].filter(([, until]) => until > clock).map(([id]) => id), respawnIn: p.respawnIn }));
}
export function hurtForTest(person, amount, who = 'me') { harm(person, amount, who); }
