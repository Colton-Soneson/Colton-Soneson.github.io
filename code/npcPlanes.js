import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as plane from './plane.js'
import * as lewis from './lewis.js'
import * as ballistics from './ballistics.js'
import * as npcs from './npcs.js'
import * as boat from './boat.js'
import * as town from './town.js'

/*
	THE AIRMEN (npcs.js's people): PER_STRIP biplanes (plane.js) to the landing strip, each with its pilot and its gunner, flown by the
	same sums as the players' (their stick, their rudder, their throttle and their mixture: THE AUTOPILOT), out of the strip's hangar
	(their home: beside the end of the strip).

	ON PATROL (boids): they circle over the strip (PATROL: its height, the circle's size, and its middle wandering about the strip), each
		steering by the three rules of a flock, the separation strongest of them (as far apart as they can be: on opposite sides of the
		circle, at different heights), the alignment and the cohesion weak (they keep to the same circle, the same way round).
	ATTACKED (npcs.js: a hit on the plane or on its crew; the two planes are allies, so both come): at whoever fired.
	THE DOGFIGHT (the attacker in a plane): BASIC FIGHTER MANOEUVRES
		attack		the nose put on the lead (where the target will be when the rounds get there: npcs.leadDirection) and the Vickers
					fired in bursts while it is on it (AIM_CONE, VICKERS_RANGE)
		pass		at the merge (passing each other close, or overshooting) it holds on through and past for PASS_SECONDS, the
					gunner's Lewis on the target as it goes by behind
		turn		then it turns to come round again, one of two ways by THE ENERGY (its height and speed against the target's):
					more energy, a TWO-CIRCLE fight: it turns towards the side the target passed on (nose to tail, each on its own
					circle: the faster turn wins, which energy buys); less, a ONE-CIRCLE fight: it turns away from that side (both on
					the one circle, nose to nose: the tighter turn wins, which is the slower one's), throttled back to turn tight
		defend		the target behind it and its nose on it: a break turn, hard into it at full throttle, to spoil its aim; or, close
					and closing (it is about to overshoot), ROLLING SCISSORS: it pulls up and rolls over towards the target, again and
					again the other way (SCISSORS), throttled back, so the one that is faster ends up out in front
		yo-yo		closing too fast on the target's tail: up out of its turn (a high yo-yo), trading the speed for height, to come
					back down on it rather than overshoot
		extend		too slow to fight (SLOW): the nose down and the throttle open to get its speed back, then a zoom climb (ZOOM:
					the speed into height) and back in. With a lot more energy than the target it does not turn with it at all:
					boom and zoom, a diving pass and a zoom away up
	THE GROUND ATTACK (the attacker on the ground, or on the water): swooping strafing runs. Out to SETUP away from the target and
		up to ATTACK_HEIGHT over it, round, in level until the target is DIVE_ANGLE under the nose, then down at it firing, pulled out at
		PULL_OUT over the ground in a climbing turn, the gunner firing back at the target as it climbs away, and round again.
	NOT INTO THE GROUND (looked for along where it is going, LOOK_AHEAD seconds out: FLOOR over the land or the sea, less when it is
		diving at something) nor off the edge of the world: either is put first.
	THE GUNS: the Vickers along the plane's nose; the Lewis on the ring wherever the gunner turns it, not into the wings or the tail
		(plane.js: masked), its pan changed after PAN rounds. Bursts of each, BURST seconds, REST between.
	THE CREW: shot dead in the air, the pilot slumps on the stick and the plane goes down; whoever is aboard when it is wrecked or shot to
		pieces is killed. Each comes back at the hangar, and stands there; a plane is wheeled out to the end of the strip for the
		pilot once the old one is gone, the gunner climbs in too if he is there, and it takes off (TAKE_OFF) and goes back on patrol.
	THE WAR (war.js: addWarFlight): each side's planes, in its colour (plane.js: p.team), up over its own town, each with a task: DEFEND
		(round over its own town, after the other side's planes that come near it: WAR.defend), SHIPS (strafing runs at the other side's
		schooners, and while there are none, the village) and VILLAGE (BOMBING RUNS at the other side's houses: level at WAR.bombHeight over
		one still standing, near and the worse for wear, the bombs let go where they will fall on it, then away and round again; between, strafing the other
		side out in its town). Whatever its task, one of theirs coming at it close (WAR.threat) is fought first. The bombs are only for
		houses. Lost, it is up again WAR.relaunch later, over its own town; while it is on, the strip's own are put away.
	Metres and seconds (the plane's p and v are; the people's places are world units)
*/
const PER_STRIP = 2;
const PATROL = { height: 300, radius: 700, wander: 600, apart: 900, stagger: 70 };	// metres: over the strip, the circle, its middle's wandering, flock separation, height between them
const CRUISE = 44, FIGHT = 56;			// metres a second
const MAX_G = 4.5;
const TURN_GAIN = 1.0;					// radians a second the path is swung for every radian it is off (TURN_MOST at the most)
const TURN_MOST = 0.9;
const AIM_INTEGRAL = 0.5;				// (see fly)
const BANK_EASE = 0.35;					// seconds the bank wanted takes to follow the turn wanted (or it rolls back and forth after every jink)
const FLOOR = 80, LOW_FLOOR = 40;		// metres over the land (diving at something: LOW_FLOOR)
const LOOK_AHEAD = 5, LOW_LOOK = 2.2;	// seconds (diving: LOW_LOOK)
const AIM_CONE = 0.012;					// radians: the Vickers fires with the lead within this of the nose (and AIM_SLACK metres)
const AIM_SLACK = 2.5;
const VICKERS_RANGE = 420, LEWIS_RANGE = 330;	// metres
const BURST = [0.7, 1.6], REST = [0.4, 1.4];	// seconds
const PASS_SECONDS = 2.5;
const SCISSORS = 3.2;					// seconds each way
const SLOW = 30;						// metres a second
const ZOOM = 4;							// seconds climbing
const SETUP = 850, ATTACK_HEIGHT = 260, DIVE_ANGLE = 0.42, PULL_OUT = 110;	// metres, radians
const TAKE_OFF = { rotate: 27, climb: 0.18, done: 60 };	// metres a second to lift the tail and climb, radians climbing, metres up it is on patrol
const SPREAD = { vickers: 0.006, lewis: 0.012 };	// radians
const EDGE = 250;						// metres from the edge of the world it turns back
const WAR = { relaunch: 60, patrol: 300, defend: 2500, threat: 700, bombHeight: 170, bombSpeed: 46, bombLine: 14, runIn: 700, lineIn: 140 };	// see THE WAR at the top (metres, seconds)
const RELAUNCH = 6;						// seconds after the pilot is back at the hangar (and the old plane gone) a new one is out

const ROUND = ballistics.ROUNDS['.303 British'], VICKERS_ROUND = ballistics.ROUNDS['.303 Vickers'];
const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const { dot, cross, norm, wrap } = npcs;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const A = plane.AIRFRAME;
const seaLevel = () => settings.waterWorldPosY / metre();
const halfWorld = () => settings.terrainWorldSize * 0.5 / metre();
const groundAt = (x, z) => Math.max(terrain.land.heightAt(x * metre(), z * metre()) / metre(), seaLevel());	// (metres: the land, or the sea over it)

export const airStats = { planes: 0, launches: 0, vickers: 0, lewis: 0, crashes: 0, shotDown: 0, phases: {} };

// The flights
//-------------------------------------------------
// each: { pilot, gunner (npcs.js people), plane (plane.js's, or null), index, wingmen (the others), group, phase, phaseAt, fight (its
//		memory: side, circle, reversals, the ground run's way out), guns ({ since, burst, rest } each), pan, relaunch, slump }
const flights = [];
let builtFor = null, hangar = null, strip = null;

function makeFlights(land) {
	clearFlights();
	strip = land.strip;
	if (!strip) return;
	const m = metre();
	// the hangar: beside the strip's end nearer its middle... out from its side, by its first end
	const side = [-strip.az, strip.ax];
	const endAt = (end, along, out) => ({ x: strip.x + strip.ax * end * (strip.half - along * m) + side[0] * out * m, z: strip.z + strip.az * end * (strip.half - along * m) + side[1] * out * m });
	const h = endAt(-1, 25, strip.flat / m + 14);
	hangar = { x: h.x, z: h.z, heading: Math.atan2(-side[0], -side[1]), endAt };
	const groups = [];
	for (let k = 0; k < PER_STRIP; k++) {
		const group = npcs.makeGroup();
		groups.forEach((g) => npcs.allyGroups(g, group));
		groups.push(group);
		const spot = (n) => ({ x: hangar.x + side[0] * 0 + strip.ax * (k * 6 + n * 2.5) * m, z: hangar.z + strip.az * (k * 6 + n * 2.5) * m, heading: hangar.heading });
		const pilot = npcs.makePerson('pilot', { hat: 'aviator', gun: 'none', group, home: spot(0), name: 'pilot' });
		const gunner = npcs.makePerson('gunner', { hat: 'aviator', gun: 'none', group, home: spot(1), name: 'air gunner' });
		const f = { pilot, gunner, plane: null, index: k, group, phase: 'patrol', phaseAt: 0, fight: {}, guns: { vickers: gunState(), lewis: gunState() }, pan: lewis.PAN, panChange: -1, relaunch: RELAUNCH, slump: null, aim: [0, 0.05, -1], seat: { pilot: 'aboard', gunner: 'aboard' } };
		flights.push(f);
		launchAirborne(f);
	}
	for (const f of flights) if (!f.war) f.wingmen = flights.filter((o) => o !== f && !o.war);
	airStats.planes = flights.length;
}
const gunState = () => ({ since: 0, burst: 0, rest: 0, owed: 0 });
// (the strip's own, or which)
function clearFlights(which = (f) => !f.war) {
	for (const f of flights.filter(which)) {
		npcs.removePerson(f.pilot); npcs.removePerson(f.gunner);
		if (f.plane?.exists) { plane.removePlane(f.plane); npcs.announce('plane', null, f.plane); }
		flights.splice(flights.indexOf(f), 1);
	}
}

// a new plane: in the air on patrol (the first, as the world begins), or at the end of the strip to take off
function newPlane(f, x, z, heading) {
	const p = plane.spawnPlane(x, z, { heading, owner: 'npc', authority: 0 });	// (authority: this machine, alone or the host)
	p.team = f.war?.side ?? null;
	p.crew.pilot = f.pilot.id;
	p.crew.gunner = f.seat.gunner == 'aboard' ? f.gunner.id : null;
	p.brake = false;
	p.mixture = plane.mixtureBest(p.p[1] - seaLevel());
	f.plane = p;
	f.slump = null;
	f.fight = {};
	airStats.launches++;
	npcs.announce('plane', p, null);
	return p;
}
function launchAirborne(f) {
	const m = metre(), a = f.index / PER_STRIP * Math.PI * 2;
	const x = strip.x + Math.cos(a) * PATROL.radius * m, z = strip.z + Math.sin(a) * PATROL.radius * m;
	const heading = Math.atan2(-Math.sin(a), -Math.cos(a));		// (round the circle the way patrol goes)
	const p = newPlane(f, x, z, heading);
	const forward = [Math.sin(heading), 0, -Math.cos(heading)], l = norm(cross([0, 1, 0], forward));
	p.q = plane.fromAxes(l, [0, 1, 0], forward);
	p.p[1] = groundAt(p.p[0], p.p[2]) + PATROL.height + f.index * PATROL.stagger;
	p.v = scale(forward, CRUISE);
	Object.assign(p.engine, { on: true, rpm: 1500 });
	p.throttle = 0.6;
	setPhase(f, 'patrol');
}
function launchFromStrip(f) {
	// (from the end that has it taking off into the wind: the wind blows along windDirection)
	const dir = settings.windDirection;
	const end = f.end = dir[0] * strip.ax + dir[1] * strip.az < 0 ? -1 : 1;
	const at = hangar.endAt(end, 14, 0);
	newPlane(f, at.x, at.z, Math.atan2(-end * strip.ax, end * strip.az));
	f.plane.throttle = 0;
	setPhase(f, 'takeoff');
}
function setPhase(f, phase) {
	if (f.phase != phase) { f.phase = phase; f.phaseAt = npcs.now(); airStats.phases[phase] = (airStats.phases[phase] ?? 0) + 1; }
}
const inPhase = (f) => npcs.now() - f.phaseAt;

// THE AUTOPILOT: the plane's controls worked to swing its flight path to want (a direction, length 1, in the world) at speed (metres a
//		second), turning no harder than maxG, the throttle as given (or as the speed needs). aim: the rudder helps put the nose right on
//		it (for the guns)
function fly(f, want, speed, { maxG = MAX_G, throttle = null, aim = false } = {}) {
	const p = f.plane;
	const fwd = plane.rotate(p.q, [0, 0, 1]);
	const V = len(p.v);
	const vd = V > 8 ? scale(p.v, 1 / V) : fwd;
	// (aiming, it is the nose that is to be on it, not the path: the nose is up off the path by the angle of attack, and to the side by
	//		any slip)
	const nose = want;
	if (aim) want = norm(sub(want, sub(fwd, vd)));
	// the turn wanted: the path swung towards want as fast as the angle between them asks, the wings holding it up against gravity too
	const c = clamp(dot(vd, want), -1, 1), angle = Math.acos(c);
	let across = sub(want, scale(vd, c));
	across = len(across) < 1e-3 ? plane.rotate(p.q, [0, 1, 0]) : norm(across);
	let accel = scale(across, Math.min(angle * TURN_GAIN, TURN_MOST) * Math.max(V, 15));
	// (aiming, what the wings fall short of, a little more each moment it stays off: an integral, or it never quite gets there)
	if (aim) {
		if (angle < 0.12) f.aimSum = add(f.aimSum ?? [0, 0, 0], scale(across, angle * AIM_INTEGRAL * f.dt));
		f.aimSum ??= [0, 0, 0];
		if (len(f.aimSum) > 0.05) f.aimSum = scale(norm(f.aimSum), 0.05);
		accel = add(accel, scale(sub(f.aimSum, scale(vd, dot(f.aimSum, vd))), Math.max(V, 15)));
	} else f.aimSum = null;
	const gravity = [0, -9.81, 0];
	let lift = sub(accel, sub(gravity, scale(vd, dot(gravity, vd))));
	let n = len(lift);
	if (n > maxG * 9.81) { lift = scale(lift, maxG * 9.81 / n); n = maxG * 9.81; }
	// roll: the wings' up to the lift wanted
	const upNow = n > 1 ? scale(lift, 1 / n) : [0, 1, 0];
	f.upWant = f.upWant ? norm(add(f.upWant, scale(sub(upNow, f.upWant), Math.min(f.dt / BANK_EASE, 1)))) : upNow;
	const ub = plane.unrotate(p.q, f.upWant);
	const rollOff = Math.atan2(-ub[0], ub[1]);
	// pitch: the angle of attack that gives that much lift, held by the elevator's trim for it and how far off it is. (Not much pulled
	//		until the wings are rolled to it, or it pulls the wrong way)
	const pulled = n * (Math.abs(rollOff) < 0.5 ? 1 : Math.max(Math.cos(rollOff), 0.15));
	const rho = 1.225 * Math.exp(-(p.p[1] - seaLevel()) / A.DENSITY_HEIGHT);
	const q = 0.5 * rho * Math.max(p.airspeed, 12) ** 2;
	const cl = pulled * A.MASS / (q * A.WING_AREA * A.LIFT);
	const alpha = clamp((cl - A.CL0) / A.CL_ALPHA, -0.12, A.STALL * 0.85);
	const trim = (A.CM0 + A.CM_ALPHA * alpha) / -A.CM_ELEVATOR * 0.85;
	f.alphaSum = clamp((f.alphaSum ?? 0) + (alpha - p.alpha) * 0.02, -0.3, 0.3);
	const elevator = trim + 3.2 * (alpha - p.alpha) + f.alphaSum + 0.35 * p.w[0];
	const aileron = 1.3 * rollOff - 0.75 * p.w[2];
	// the rudder: no sideslip, and, aiming, the nose on to it
	let rudder = 2.5 * (p.beta ?? 0) * clamp((p.airspeed - 15) / 10, 0, 1);
	if (aim) { const wb = plane.unrotate(p.q, nose); rudder += clamp(2.5 * Math.atan2(wb[0], wb[2]), -0.5, 0.5) - 0.6 * p.w[1]; }
	p.input = { elevator: clamp(elevator, -1, 1), aileron: clamp(aileron, -1, 1), rudder: clamp(rudder, -1, 1) };
	p.throttle = throttle ?? clamp(0.55 + 0.07 * (speed - p.airspeed), 0.05, 1);
}

// NOT INTO THE GROUND (see the top): how much clearance is left along where it is going, the least over LOOK_AHEAD seconds (metres)
function clearance(p, look = LOOK_AHEAD) {
	let least = Infinity;
	for (let t = 0; t <= look; t += 0.5) {
		const x = p.p[0] + p.v[0] * t, y = p.p[1] + p.v[1] * t, z = p.p[2] + p.v[2] * t;
		least = Math.min(least, y - groundAt(x, z));
	}
	return least;
}
// the way wanted, put right if it would go into the ground (floor: the least it keeps over it, looking look seconds ahead) or off the
//		edge of the world
function safe(f, want, floor = FLOOR, look = LOOK_AHEAD) {
	const p = f.plane, m = metre();
	const clear = clearance(p, look), V = len(p.v);
	const level = norm([p.v[0], 0, p.v[2]]);
	if (clear < floor) {
		// up: the harder the closer it is
		const climb = clamp(0.25 + (floor - clear) / floor * 0.6, 0.25, 0.85);
		f.avoiding = true;
		return norm(add(scale(level, Math.cos(climb)), [0, Math.sin(climb), 0]));
	}
	f.avoiding = false;
	// (and it does not dive at the ground faster than it can get out of)
	const over = p.p[1] - groundAt(p.p[0], p.p[2]);
	if (want[1] < 0 && over < floor * 2.2) want = norm([want[0], want[1] * clamp((over - floor) / (floor * 1.2), 0, 1), want[2]]);
	// (going out past EDGE from the edge of the world: turned back in, the harder the further out)
	const edge = halfWorld() - EDGE;
	for (const k of [0, 2]) {
		const past = Math.abs(p.p[k]) - edge;
		if (past > 0 && p.v[k] * Math.sign(p.p[k]) > 0) { want = [...want]; want[k] -= Math.sign(p.p[k]) * Math.min(past / EDGE, 1) * 2; want = norm(want); }
	}
	return want;
}

// ON PATROL (see the top): the circle round the wandering middle, the flock's three rules
function patrol(f, dt) {
	const p = f.plane, t = npcs.now();
	// (round the strip; in the war, its own town defending, the other's otherwise)
	const C = f.war ? (f.war.task == 'defend' ? f.war.home : f.war.enemy) : strip;
	// (the circle kept inside the world)
	const inside = halfWorld() - EDGE - PATROL.radius - 100;
	const centre = [clamp(C.x / metre() + Math.cos(t * 0.011) * PATROL.wander, -inside, inside), 0, clamp(C.z / metre() + Math.sin(t * 0.017) * PATROL.wander, -inside, inside)];
	const r = [p.p[0] - centre[0], 0, p.p[2] - centre[2]], d = Math.max(Math.hypot(r[0], r[2]), 1);
	const out = scale(r, 1 / d), round = [-out[2], 0, out[0]];	// (round the circle: all of them the same way)
	let want = add(round, scale(out, -clamp((d - PATROL.radius) / PATROL.radius, -1, 1) * 1.2));
	for (const o of f.wingmen) {
		const q = o.plane;
		if (!q || !q.exists || q.wreck >= 0 || q.destroyed >= 0) continue;
		const to = sub(q.p, p.p), apart = len(to);
		// separation (strongest), alignment, cohesion
		if (apart < PATROL.apart) want = add(want, scale(norm([-to[0], 0, -to[2]]), 2.2 * (PATROL.apart - apart) / PATROL.apart));
		want = add(want, scale(norm([q.v[0], 0, q.v[2]]), 0.15));
		if (apart > PATROL.apart * 2) want = add(want, scale(norm([to[0], 0, to[2]]), 0.25));
	}
	want = norm([want[0], 0, want[2]]);
	const height = Math.max(groundAt(C.x / metre(), C.z / metre()) + PATROL.height, groundAt(p.p[0], p.p[2]) + PATROL.height * 0.7) + f.index * PATROL.stagger;
	want = norm(add(want, [0, clamp((height - p.p[1]) / 200, -0.25, 0.3), 0]));
	fly(f, safe(f, want), CRUISE, { maxG: 2.2 });
}

// TAKING OFF: down the strip, the tail up, lifted off, and climbing away straight ahead
function takeOff(f, dt) {
	const p = f.plane;
	const heading = Math.atan2(-f.end * strip.ax, f.end * strip.az);
	const ahead = [Math.sin(heading), 0, -Math.cos(heading)];
	p.brake = false;
	p.mixture = plane.mixtureBest(p.p[1] - seaLevel());
	const over = p.p[1] - groundAt(p.p[0], p.p[2]);
	if (p.contacts > 0) {
		// (the throttle opened over a few seconds; kept straight down the strip by the rudder, its swing damped, or it ground loops)
		p.throttle = Math.min(inPhase(f) / 4, 1);
		const ab = plane.unrotate(p.q, ahead), ub = plane.unrotate(p.q, [0, 1, 0]);
		p.input = { elevator: p.airspeed > TAKE_OFF.rotate ? 0.45 : 0, aileron: clamp(1.5 * Math.atan2(-ub[0], ub[1]) - 0.6 * p.w[2], -1, 1), rudder: clamp(2 * Math.atan2(ab[0], ab[2]) - 1.2 * p.w[1], -1, 1) };
		return;
	}
	fly(f, safe(f, norm(add(scale(ahead, Math.cos(TAKE_OFF.climb)), [0, Math.sin(TAKE_OFF.climb), 0])), 10), CRUISE, { throttle: 1, maxG: 2 });
	if (over > TAKE_OFF.done) setPhase(f, 'patrol');
}

// THE DOGFIGHT (see the top), at a target in a plane (T)
function dogfight(f, enemy, T, dt) {
	const p = f.plane, F = f.fight;
	const fwd = plane.rotate(p.q, [0, 0, 1]), up = plane.rotate(p.q, [0, 1, 0]), right = scale(plane.rotate(p.q, [1, 0, 0]), -1);
	const R = sub(T.p, p.p), range = len(R), Rn = scale(R, 1 / Math.max(range, 1));
	const tf = plane.rotate(T.q, [0, 0, 1]);
	const myAngle = Math.acos(clamp(dot(fwd, Rn), -1, 1));			// how far off my nose it is
	const itsAngle = Math.acos(clamp(dot(tf, scale(Rn, -1)), -1, 1));	// how far off its nose I am
	const closing = -dot(sub(T.v, p.v), Rn);
	const energy = (q) => q.p[1] + dot(q.v, q.v) / (2 * 9.81);
	const ahead = energy(p) - energy(T);		// metres of energy (height) more than it
	const V = len(p.v), m = metre();
	const target = { x: T.p[0] * m, y: T.p[1] * m, z: T.p[2] * m, v: scale(T.v, m) };
	const muzzle = p.frame.toWorld(plane.MUZZLE);
	const lead = npcs.leadDirection(muzzle, target, VICKERS_ROUND);
	const sideOf = Math.sign(dot(R, right)) || 1;		// (+ the target is to my right)

	// what to do now
	let phase = f.phase;
	const behindMe = itsAngle < 0.75 && myAngle > 2.0 && range < 500;
	if (phase == 'patrol' || phase == 'takeoff') phase = 'attack';
	if (V < SLOW && phase != 'extend' && phase != 'scissors' && !(myAngle < 0.8 && range < 300)) phase = 'extend';
	else if (behindMe && !['defend', 'scissors', 'extend'].includes(phase)) phase = 'defend';
	if (phase != f.phase) { setPhase(f, phase); F.reversals = 0; F.side = sideOf; }

	let want = lead, speed = FIGHT, throttle = null, maxG = MAX_G, aim = false;
	switch (f.phase) {
		case 'attack': {
			aim = myAngle < 0.3;
			// the merge, or overshooting: on through and past
			if (range < 45 || (range < 90 && closing > 30) || (myAngle > 1.6 && range < 220 && closing > 0)) { setPhase(f, 'pass'); F.passSide = sideOf; F.zoom = ahead > 120; break; }
			// closing too fast on its tail: a high yo-yo
			if (itsAngle > 2.3 && range < 160 && closing > 18) { setPhase(f, 'yoyo'); break; }
			// closing on it as fast as it can from far off, and from close in no faster than it can keep its aim
			throttle = range > 250 ? 1 : clamp(0.6 + 0.04 * (8 - closing), 0.2, 1);
			break;
		}
		case 'pass': {
			want = F.zoom ? norm(add(scale(norm([p.v[0], 0, p.v[2]]), 0.8), [0, 0.6, 0])) : norm([p.v[0], 0, p.v[2]]);
			throttle = 1;
			if (inPhase(f) > PASS_SECONDS) {
				// the turn back: towards the side it passed on with more energy (two circles), away from it with less (one circle)
				F.circle = ahead >= -30 ? 'two' : 'one';
				F.turn = F.circle == 'two' ? sideOf : -sideOf;
				setPhase(f, 'turn');
			}
			break;
		}
		case 'turn': {
			const level = norm([p.v[0], 0, p.v[2]]), toSide = norm(cross([0, 1, 0], level));	// (cross(up, forward): to the left)
			want = norm(add(level, scale(toSide, -F.turn * 3)));
			if (F.circle == 'one') { throttle = 0.55; want = norm(add(want, [0, -0.05, 0])); }
			else throttle = 1;
			if (myAngle < 1.3 || inPhase(f) > 18) setPhase(f, 'attack');
			break;
		}
		case 'defend': {
			if (range < 230 && closing > 4 && V > SLOW + 6) { setPhase(f, 'scissors'); F.reversals = 0; F.side = sideOf; break; }
			// the break: hard into it
			const level = norm([p.v[0], 0, p.v[2]]), toSide = norm(cross([0, 1, 0], level));
			want = norm(add(level, scale(toSide, -sideOf * 4)));
			throttle = 1;
			maxG = MAX_G + 0.5;
			if (!behindMe || inPhase(f) > 10) setPhase(f, 'attack');
			break;
		}
		case 'scissors': {
			// up and over towards it, rolling, slowed: and again the other way
			if (inPhase(f) > SCISSORS * ((F.reversals ?? 0) + 1)) { F.reversals = (F.reversals ?? 0) + 1; F.side = -F.side; }
			const toSide = scale(right, F.side);
			want = norm(add(add(scale(fwd, 0.35), scale(up, 0.75)), scale(toSide, 0.75)));
			throttle = 0.5;
			if (myAngle < 1.0 && itsAngle > 1.2) setPhase(f, 'attack');		// (it went past: it is in front now)
			else if (F.reversals >= 4 || V < SLOW - 9) setPhase(f, 'extend');
			break;
		}
		case 'yoyo': {
			want = norm(add(Rn, [0, 0.9, 0]));
			throttle = 0.5;
			if (inPhase(f) > 3) setPhase(f, 'attack');
			break;
		}
		case 'extend': {
			// the speed back (down), then up into a zoom climb, then back in
			const level = norm([p.v[0], 0, p.v[2]]);
			if (!F.zooming && V > FIGHT - 4) { F.zooming = true; F.zoomAt = npcs.now(); }
			want = F.zooming ? norm(add(scale(level, 0.75), [0, 0.65, 0])) : norm(add(level, [0, -0.35, 0]));
			throttle = 1;
			if ((F.zooming && npcs.now() - F.zoomAt > ZOOM) || (myAngle < 0.8 && range < 300 && V > SLOW)) { F.zooming = false; setPhase(f, 'attack'); }
			break;
		}
	}
	fly(f, safe(f, want), speed, { throttle, maxG, aim });
	// the Vickers: the lead on the nose, in reach
	f.aimOff = Math.acos(clamp(dot(fwd, lead), -1, 1));
	const onNose = f.aimOff < AIM_CONE + AIM_SLACK / Math.max(range, 40);
	vickers(f, dt, onNose && range < VICKERS_RANGE && npcs.clearLine(muzzle, [target.x, target.y, target.z]), target);
}

// THE GROUND ATTACK (see the top), at a target on the land or the water
function groundAttack(f, enemy, dt) {
	const p = f.plane, F = f.fight, m = metre();
	const tp = [enemy.x / m, enemy.y / m, enemy.z / m];
	const flat = [tp[0] - p.p[0], 0, tp[2] - p.p[2]], across = Math.hypot(flat[0], flat[2]);
	const height = p.p[1] - tp[1], over = p.p[1] - groundAt(p.p[0], p.p[2]);
	const level = norm([p.v[0], 0, p.v[2]]);
	if (!['setup', 'inbound', 'dive', 'pullout'].includes(f.phase)) { setPhase(f, 'setup'); F.away = across > 1 ? scale(norm(flat), -1) : level; }
	let want = level, throttle = null, floor = FLOOR, aim = false;
	const muzzle = p.frame.toWorld(plane.MUZZLE);
	switch (f.phase) {
		case 'setup': {
			// out to SETUP from it, up to ATTACK_HEIGHT over it
			const spot = [tp[0] + F.away[0] * SETUP, tp[1] + ATTACK_HEIGHT, tp[2] + F.away[2] * SETUP];
			const to = sub(spot, p.p);
			want = norm([to[0], clamp(to[1] / 300, -0.3, 0.4) * Math.hypot(to[0], to[2]), to[2]]);
			if (Math.hypot(to[0], to[2]) < 200 || inPhase(f) > 40) setPhase(f, 'inbound');
			break;
		}
		case 'inbound': {
			want = norm([flat[0], clamp((tp[1] + ATTACK_HEIGHT - p.p[1]) / 150, -0.2, 0.3) * across, flat[2]]);
			if (Math.atan2(height, across) > DIVE_ANGLE) setPhase(f, 'dive');
			else if (inPhase(f) > 40) setPhase(f, 'setup');
			break;
		}
		case 'dive': {
			const target = { x: enemy.x, y: enemy.y, z: enemy.z, v: enemy.v };
			want = npcs.leadDirection(muzzle, target, VICKERS_ROUND);
			throttle = 0.45;
			floor = LOW_FLOOR;
			aim = true;
			const fwd = plane.rotate(p.q, [0, 0, 1]);
			const range = Math.hypot(enemy.x - muzzle[0], enemy.y - muzzle[1], enemy.z - muzzle[2]) / m;
			// (strafing: anywhere about it will do)
			const onNose = Math.acos(clamp(dot(fwd, want), -1, 1)) < AIM_CONE * 2 + AIM_SLACK * 2 / Math.max(range, 40);
			vickers(f, dt, onNose && range < VICKERS_RANGE * 1.3 && npcs.clearLine(muzzle, [enemy.x, enemy.y + 0.5 * m, enemy.z]), target);
			if (over < PULL_OUT || range < 150) { setPhase(f, 'pullout'); F.away = level; F.breakSide = Math.random() < 0.5 ? 1 : -1; }
			break;
		}
		case 'pullout': {
			// (climbing away and round to one side: the target off to the side of the tail, where the gunner can get at it)
			const toSide = norm(cross([0, 1, 0], level));
			want = norm(add(add(scale(level, Math.cos(0.45)), scale(toSide, F.breakSide * 0.55)), [0, Math.sin(0.45), 0]));
			throttle = 1;
			if (over > ATTACK_HEIGHT * 0.8 || inPhase(f) > 15) setPhase(f, 'setup');
			break;
		}
	}
	if (f.phase != 'dive') vickers(f, dt, false, null);
	fly(f, safe(f, want, floor, f.phase == 'dive' ? LOW_LOOK : LOOK_AHEAD), FIGHT, { throttle, aim, maxG: f.phase == 'pullout' ? MAX_G + 0.5 : MAX_G });
}

// THE GUNS (see the top): bursts, while it is wanted (on) and there is something to fire at
function burstOn(g, dt, on) {
	g.since += dt;
	if (!on) { g.burst = 0; g.rest = Math.max(g.rest - dt, 0); return false; }
	if (g.rest > 0) { g.rest -= dt; return false; }
	if (g.burst <= 0) g.burst = BURST[0] + Math.random() * (BURST[1] - BURST[0]);
	g.burst -= dt;
	if (g.burst <= 0) { g.rest = REST[0] + Math.random() * (REST[1] - REST[0]); return false; }
	return true;
}
function vickers(f, dt, on, target) {
	const p = f.plane, g = f.guns.vickers;
	if (!burstOn(g, dt, on && f.pilot.alive) || !target) { g.owed = 0; return; }
	g.owed += dt * A.VICKERS_RATE;
	const m = metre(), fwd = plane.rotate(p.q, [0, 0.004, 1]);
	while (g.owed >= 1) {
		g.owed -= 1;
		// (from the muzzle where the plane will be a moment on: it goes 60 metres a second)
		const muzzle = p.frame.toWorld(plane.MUZZLE);
		npcs.fireAt(f.pilot, muzzle, target, { round: '.303 Vickers', spread: SPREAD.vickers, spreadFar: 0.002, aimAt: norm(fwd) });
		airStats.vickers++;
	}
	p.vickers = 500;
}
// the gunner: the ring turned to the target (the lead), and fired when it is clear of the plane's own wings and tail
function rearGun(f, enemy, dt) {
	const p = f.plane, g = f.guns.lewis, m = metre();
	const gunner = f.gunner;
	gunner.fighting = false;
	if (!enemy || !gunner.alive || f.seat.gunner != 'aboard') { burstOn(g, dt, false); f.aim = [0, 0.05, -1]; p.npcAim = f.aim; return; }
	const mount = p.frame.toWorld(plane.MOUNT);
	const target = { x: enemy.x, y: enemy.y, z: enemy.z, v: enemy.v };
	const range = Math.hypot(enemy.x - mount[0], enemy.y - mount[1], enemy.z - mount[2]) / m;
	const dir = npcs.leadDirection(mount, target, ROUND);
	const local = plane.unrotate(p.q, dir);
	// the ring turns at its pace towards it
	const k = Math.min(dt * 2.5, 1);
	f.aim = norm(f.aim.map((v, i) => v + (local[i] - v) * k));
	p.npcAim = f.aim;
	// the pan changed when it is empty
	if (f.panChange >= 0) { f.panChange += dt; if (f.panChange > 2.2) { f.panChange = -1; f.pan = lewis.PAN; p.rear.turn = 0; } burstOn(g, dt, false); return; }
	const onIt = Math.acos(clamp(dot(f.aim, local), -1, 1)) < 0.05;
	const clear = !plane.masked(f.aim) && range < LEWIS_RANGE && npcs.clearLine(mount, [enemy.x, enemy.y, enemy.z]);
	if (!burstOn(g, dt, onIt && clear)) { g.owed = 0; return; }
	gunner.fighting = true;
	g.owed += dt * lewis.RATE;
	while (g.owed >= 1 && f.pan > 0) {
		g.owed -= 1;
		const aimWorld = plane.rotate(p.q, f.aim);
		const muzzle = add(mount, scale(aimWorld, 1.0 * m));
		npcs.fireAt(gunner, muzzle, target, { round: '.303 British', spread: SPREAD.lewis, spreadFar: 0.004, aimAt: aimWorld });
		f.pan--;
		p.rear.turn++;
		airStats.lewis++;
	}
	if (f.pan <= 0) f.panChange = 0;
}

// THE CREW (see the top)
//-------------------------------------------------
function placeCrew(f) {
	const p = f.plane;
	for (const [seat, person] of [['pilot', f.pilot], ['gunner', f.gunner]]) {
		if (f.seat[seat] == 'aboard' && p && p.exists && p.destroyed < 0) {
			// sat (or, the gunner, stood, turned on the ring to where the gun points) in the cockpit, tipped as the plane is; hidden
			//		there once dead
			const at = p.frame.toWorld(plane.SEATS[seat].at);
			const facing = seat == 'gunner' ? norm([f.aim[0], 0, f.aim[2]]) : [0, 0, 1];
			const { heading, tilt } = npcs.tipped(plane.rotate(p.q, facing), plane.rotate(p.q, [0, 1, 0]));
			person.place = { x: at[0], y: at[1], z: at[2], heading, tilt, sit: plane.SEATS[seat].sit };
			person.anchor = { vehicle: p.id, local: plane.SEATS[seat].at, facing };
			person.gone = !person.alive;
			person.armsDown = seat == 'gunner' ? 0 : 1;
		} else if (f.seat[seat] == 'home') {
			// standing at the hangar (shot there, it lies where it stood: npcs.js)
			person.place = { x: person.home.x, y: terrain.land.groundAt(person.home.x, person.home.z), z: person.home.z, heading: person.home.heading, sit: 0 };
			person.anchor = null;
			person.armsDown = 1;
		}
	}
}
// the plane wrecked or shot to pieces: whoever is aboard killed (by whoever shot at it last)
function lostPlane(f) {
	for (const [seat, person] of [['pilot', f.pilot], ['gunner', f.gunner]]) {
		if (f.seat[seat] != 'aboard') continue;
		if (person.alive) npcs.harm(person, 1000, f.group.lastShotBy, 'crash');
		person.gone = true;
		person.place = person.anchor = null;
		f.seat[seat] = 'dead';
	}
	f.plane = null;
	f.relaunch = f.war ? WAR.relaunch : RELAUNCH;
}
plane.onCrash((p) => { const f = flights.find((one) => one.plane === p); if (f) { airStats.crashes++; lostPlane(f); } });
plane.onBreak((at, p) => { const f = flights.find((one) => one.plane === p); if (f) { airStats.shotDown++; lostPlane(f); } });
// each plane's crew's group (npcs.js: a shot at the plane is a shot at them)
npcs.addVehicleGroups((id) => flights.find((f) => f.plane?.id === id)?.group ?? null);

function stepFlight(f, dt) {
	f.dt = dt;
	// the dead back at the hangar in time; and a new plane for the pilot there, once the old one is gone
	//		(shot standing at the hangar: dead there. Dead in the plane: dead once the plane is lost, lostPlane)
	if (!f.war) for (const [seat, person] of [['pilot', f.pilot], ['gunner', f.gunner]]) {
		if (f.seat[seat] == 'home' && !person.alive) f.seat[seat] = 'dead';
		if (f.seat[seat] == 'dead' && person.respawnIn <= 0 && person.respawnIn > -1) { npcs.revive(person); f.seat[seat] = 'home'; }
	}
	const p = f.plane;
	if (p && !p.exists) { lostPlane(f); return; }		// (taken away: as good as lost)
	if (!p && f.war) {
		// (a side's, in the war: up again over its own town WAR.relaunch after it was lost, both of them in it)
		if ((f.relaunch -= dt) <= 0) {
			for (const person of [f.pilot, f.gunner]) if (!person.alive) npcs.revive(person);
			f.seat = { pilot: 'aboard', gunner: 'aboard' };
			launchOverTown(f);
		}
		return;
	}
	if (!p) {
		placeCrew(f);
		if (f.seat.pilot == 'home') {
			f.relaunch -= dt;
			// (one at a time off the strip)
			const busy = flights.some((o) => o !== f && o.phase == 'takeoff' && o.plane && inPhase(o) < 12);
			if (f.relaunch <= 0 && !busy) {
				if (f.seat.gunner == 'home') f.seat.gunner = 'aboard';
				f.seat.pilot = 'aboard';
				launchFromStrip(f);
			}
		}
		return;
	}
	p.fuel = 1;
	p.mixture = plane.mixtureBest(p.p[1] - seaLevel());
	// the pilot dead: slumped on the stick, the plane going down
	if (!f.pilot.alive) {
		f.slump ??= { elevator: -0.35, aileron: (Math.random() < 0.5 ? -1 : 1) * 0.45, rudder: 0 };
		p.input = f.slump;
		rearGun(f, null, dt);
		placeCrew(f);
		return;
	}
	const m = metre();
	const enemies = npcs.enemiesOf(f.group, p.p[0] * m, p.p[1] * m, p.p[2] * m);
	if (f.war) { warFlight(f, enemies, dt); placeCrew(f); return; }
	const enemy = enemies[0] ?? null;
	if (f.phase == 'takeoff') takeOff(f, dt);
	else if (!enemy) {
		if (f.phase != 'patrol') setPhase(f, 'patrol');
		patrol(f, dt);
		vickers(f, dt, false, null);
	} else {
		const T = enemy.vehicle ? plane.planeById(enemy.vehicle) : null;
		if (T && T.wreck < 0 && T.destroyed < 0 && T.p[1] - groundAt(T.p[0], T.p[2]) > 8) dogfight(f, enemy, T, dt);
		else groundAttack(f, enemy, dt);
	}
	rearGun(f, enemy && enemy.d < LEWIS_RANGE * 1.2 * m ? enemy : null, dt);
	placeCrew(f);
}

// THE WAR (see the top)
//-------------------------------------------------
// one of a side's planes: its task 'defend', 'ships' or 'village', up over its own town (home) against the other's (enemy)
export function addWarFlight(side, home, enemy, task, index) {
	const group = npcs.makeGroup();
	group.side = side;
	const pilot = npcs.makePerson('pilot', { hat: 'aviator', gun: 'none', group, name: 'pilot' });
	const gunner = npcs.makePerson('gunner', { hat: 'aviator', gun: 'none', group, name: 'air gunner' });
	const f = { pilot, gunner, plane: null, index, group, phase: 'patrol', phaseAt: 0, fight: {}, guns: { vickers: gunState(), lewis: gunState() }, pan: lewis.PAN, panChange: -1, relaunch: 0, slump: null,
		aim: [0, 0.05, -1], seat: { pilot: 'aboard', gunner: 'aboard' }, war: { side, task, home: town.townMiddle(home), enemy: town.townMiddle(enemy) } };
	flights.push(f);
	for (const o of flights) if (o.war?.side == side) o.wingmen = flights.filter((x) => x !== o && x.war?.side == side);
	launchOverTown(f);
	return f;
}
export function clearWarFlights() { clearFlights((f) => !!f.war); }
// up over its own town, on its way round it
function launchOverTown(f) {
	const W = f.war, m = metre(), a = Math.random() * Math.PI * 2, r = 250 + f.index * 70;
	const x = W.home.x / m + Math.cos(a) * r, z = W.home.z / m + Math.sin(a) * r;
	const heading = Math.atan2(-Math.sin(a), -Math.cos(a));
	const p = newPlane(f, x * m, z * m, heading);
	p.team = W.side;
	const forward = [Math.sin(heading), 0, -Math.cos(heading)], l = norm(cross([0, 1, 0], forward));
	p.q = plane.fromAxes(l, [0, 1, 0], forward);
	p.p[1] = groundAt(p.p[0], p.p[2]) + WAR.patrol + f.index * PATROL.stagger;
	p.v = scale(forward, CRUISE);
	Object.assign(p.engine, { on: true, rpm: 1500 });
	p.throttle = 0.6;
	setPhase(f, 'patrol');
}
// whether a plane is coming at another: close, its nose on it
function comingAt(T, p) {
	const to = sub(p.p, T.p), d = len(to);
	return d < WAR.threat && dot(plane.rotate(T.q, [0, 0, 1]), scale(to, 1 / Math.max(d, 1))) > Math.cos(0.5);
}
// what one of a side's does now (see THE WAR at the top)
function warFlight(f, enemies, dt) {
	const p = f.plane, m = metre(), W = f.war;
	const planeOf = (e) => e.vehicle ? plane.planeById(e.vehicle) : null;
	const air = enemies.filter((e) => { const T = planeOf(e); return T && T.wreck < 0 && T.destroyed < 0 && T.p[1] - groundAt(T.p[0], T.p[2]) > 8; });
	const at = [p.p[0] * m, p.p[1] * m, p.p[2] * m];
	let choice = null;
	// itself first
	const threat = air.find((e) => comingAt(planeOf(e), p));
	if (threat) choice = { plane: threat };
	if (!choice && W.task == 'defend') {
		const near = air.find((e) => Math.hypot(e.x - W.home.x, e.z - W.home.z) < W.home.reach + WAR.defend * m);
		if (near) choice = { plane: near };
	}
	if (!choice && W.task == 'ships') {
		const ship = enemies.find((e) => e.vehicle && boat.boatById(e.vehicle));
		if (ship) choice = { ground: ship };
	}
	// (the ships' with none of theirs out: on to the village while there are none)
	if (!choice && (W.task == 'village' || W.task == 'ships')) {
		// (the racks loaded again in the air: the war goes on)
		if (p.bombs <= 0 && p.bombWait <= 0) p.bombs = 1;
		if (['bombSetup', 'bomb', 'bombAway'].includes(f.phase) && f.fight.house) choice = { house: f.fight.house };
		else if (p.bombs > 0 && p.bombWait <= 0 && !p.dropping.length) { const h = npcs.war.houseFor?.(W.side, at); if (h) choice = { house: h }; }
		if (!choice) {
			const ground = enemies.find((e) => !air.includes(e) && !(e.vehicle && planeOf(e)) && Math.hypot(e.x - W.enemy.x, e.z - W.enemy.z) < W.enemy.reach + 400 * m);
			if (ground) choice = { ground };
		}
	}
	if (choice?.house) bombRun(f, choice.house, dt);
	else if (choice?.plane) dogfight(f, choice.plane, planeOf(choice.plane), dt);
	else if (choice?.ground) groundAttack(f, choice.ground, dt);
	else {
		if (f.phase != 'patrol') setPhase(f, 'patrol');
		patrol(f, dt);
		vickers(f, dt, false, null);
	}
	const near = enemies[0];
	rearGun(f, near && near.d < LEWIS_RANGE * 1.2 * m ? near : null, dt);
}
// a BOMBING RUN (see THE WAR at the top) at a house: { x, y (its middle), z } world units. Out to the start of a line through it
//		(WAR.runIn back from it, the side the plane is on), round on to the line, along it level at WAR.bombHeight over the house, kept
//		on it, and the bombs let go where they will come down on the house, carried on with the plane's way; then away, and round again
function bombRun(f, H, dt) {
	const p = f.plane, F = f.fight, m = metre();
	const tp = [H.x / m, H.y / m, H.z / m], alt = tp[1] + WAR.bombHeight;
	const level = norm([p.v[0], 0, p.v[2]]);
	if (!['bombSetup', 'bomb', 'bombAway'].includes(f.phase)) {
		F.house = H;
		const back = norm([p.p[0] - tp[0], 0, p.p[2] - tp[2]]);
		F.line = scale(back, -1);			// (the way along the line: through the house, away from the start)
		F.start = [tp[0] + back[0] * WAR.runIn, tp[2] + back[2] * WAR.runIn];
		setPhase(f, 'bombSetup');
	}
	if (f.phase == 'bombSetup') {
		// to the start, and turned on to the line when it is there (or near enough, a while on)
		const to = [F.start[0] - p.p[0], 0, F.start[1] - p.p[2]], d = Math.hypot(to[0], to[2]);
		const want = d > 1 ? norm([to[0], clamp((alt - p.p[1]) / 150, -0.25, 0.25) * d, to[2]]) : F.line;
		fly(f, safe(f, want), CRUISE, { maxG: 3 });
		if (d < 120 || inPhase(f) > 30) setPhase(f, 'bomb');
	} else if (f.phase == 'bomb') {
		// along the line, on to it: off it by e (metres, across), steered back in over the next WAR.lineIn
		const L = F.line, across = [-L[2], 0, L[0]];
		const rel = [p.p[0] - tp[0], 0, p.p[2] - tp[2]], e = dot(rel, across), toGo = -dot(rel, L);
		const want = norm(add(add(L, scale(across, -clamp(e / WAR.lineIn, -1, 1))), [0, clamp((alt - p.p[1]) / 150, -0.25, 0.25), 0]));
		const fall = Math.sqrt(2 * Math.max(p.p[1] - tp[1], 1) / 9.81), carry = dot([p.v[0], 0, p.v[2]], L) * fall;
		if (toGo > 0 && toGo < carry + 4 && Math.abs(e) < WAR.bombLine) {
			plane.dropBombs(p, f.pilot.id, (from, dir) => npcs.shotFired(from, dir, 'bomb'));
			setPhase(f, 'bombAway');
			F.away = level;
		} else if (toGo < -40 || inPhase(f) > 35) { setPhase(f, 'bombAway'); F.away = level; }		// (past it, or too long at it: round again)
		fly(f, safe(f, want), WAR.bombSpeed, { maxG: 2.5 });
	} else {
		// away, climbing a little, and round for the next
		fly(f, safe(f, norm(add(F.away ?? level, [0, 0.1, 0]))), CRUISE, { throttle: 1 });
		if (inPhase(f) > 6) { setPhase(f, 'patrol'); F.house = null; }
	}
	vickers(f, dt, false, null);
}

// Per frame (after npcs.js's)
//-------------------------------------------------
export function planesUpdate(dt) {
	const land = terrain.land;
	if (!npcs.on() || !npcs.runsHere()) {
		if (flights.length && (!settings.enableNPCs || !npcs.runsHere())) { clearFlights(() => true); builtFor = null; }
		return;
	}
	// (in THE WAR only the sides' fly: the strip's own are put away until it is over)
	if (npcs.war.on) { if (flights.some((f) => !f.war)) clearFlights(); builtFor = null; }
	else if (land !== builtFor) { builtFor = land; makeFlights(land); }
	for (const f of [...flights]) stepFlight(f, dt);
}

// for testing
export function flightList() {
	return flights.map((f) => {
		const p = f.plane;
		return { pilot: f.pilot.id, alive: [f.pilot.alive, f.gunner.alive], seat: { ...f.seat }, phase: f.phase, plane: p && { id: p.id, p: p.p.map((v) => Math.round(v)), speed: Math.round(len(p.v)), over: Math.round(p.p[1] - groundAt(p.p[0], p.p[2])), health: p.health, throttle: Math.round(p.throttle * 100) / 100, engine: p.engine.on, input: p.input, avoiding: f.avoiding } };
	});
}
export const flightsForTest = flights;
export const hangarForTest = () => hangar;
