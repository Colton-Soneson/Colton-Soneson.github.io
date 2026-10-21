import {device} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { vf_boat } from '../shaders/js/vf_boat.js'
import { VESSELS, ROLE, MAX_GROUPS, MAX_ROPES } from './vessels.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as water from './water.js'
import * as boulders from './boulders.js'
import { windAtPoint } from './wind.js'
import { weatherNow } from './weather.js'

//the boat fades into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	SAILING: the vessels in the sea (vessels.js: the dinghy, something like an RS Quest, and the schooner, something like HMS
	Pickle). There can be several at once (boats, up to MAX_BOATS): the spawn menu (radialMenu.js) puts one where the player
	points, and in a game with others each player's are everyone's (net.js). hunting.js walks the player about on them, climbs
	their ladders, takes the helm and lets it go, and works the controls through this file.

	WHO SAILS IT. Each boat is sailed (its sums worked out, below) on one machine only: its authority. That is whoever is at its
	helm, or whoever put it in the sea while nobody is. Everyone else is told where it is, how it is turned and how its sails
	are set a number of times a second (net.js), and draws it there, a little behind, in between (follow). A player standing on a
	boat someone else sails is kept where it is on the boat, so it goes where the boat goes on every machine. A boat sailed
	here knows where the others on it are (setCrew, from what they send) and heels and trims to their weight too. A rope worked or
	the anchor let go on a boat sailed somewhere else is sent there (remoteControl), and done there.

	FLOATING. The water's surface is only known on the GPU (the waves are made there). So the water is asked (water.js,
	setWaterProbes) for its height and its slope under each sailed boat's COLUMNS: places under the hull, each standing for a
	piece of it. Each boat has its own run of the probes (probeSlot), kept for as long as the boat is. The answers come back a
	frame or two later, so each is moved on to where the column is now along the slope it had, and on in time at the rate it was
	rising. A column pushes up with the weight of the water it puts aside (Archimedes): the hull's sections are a V near the
	keel, so it puts aside more and more water the deeper it goes. It pushes along the water's normal, not straight up: on the
	face of a wave the boat is pushed down it. And it is damped, against the water rising and falling, or the boat would bounce
	for ever.

	SAILING. The wind over the sea (the same as the waves are made by: settings.waterOceanWindSpeed and the weather, with its
	gusts from wind.js), less the boat's own speed, is the apparent wind the sails feel. A fore and aft sail swings to leeward
	as far as its sheet lets it: let it out further than the wind needs and it streams out along the wind (it luffs, and
	shakes), pull it in and the wind meets it at an angle (the angle of attack). A square sail is braced round as far as its
	braces say instead, and stays there: with the wind too far forward it is taken aback. Lift and drag (Cl, Cd) from that
	angle, like a wing: lift grows up to about 17 degrees, past that it stalls and it is mostly drag, side on (running before
	the wind) it is all drag. The force acts at the middle of the sail's cloth: it drives the boat on, heels it over and turns
	it (weather helm). The force is from the wind across the sail only: a boat heeled right over has less sail to the wind.
	The keel (or centreboard) and the rudder are foils in the water the same way: the keel stops the boat being blown sideways
	(a little leeway still), the rudder turns it, but only as fast as the water goes past it. The hull drags, more and more as
	it goes faster, and steeply more past its hull speed.
	A dinghy's helm leans out to windward. Past the vessel's heelLimit it is pushed back up hard: it does not capsize.

	THE CONTROLS (see hunting.js for which key is which): each sail's halyard (raise and lower it) and sheet (pull it in or let
	it out; a square sail's braces), the tiller or the wheel (A and D, at the helm), the anchor (G). Each control is something
	on the boat: the crosshair on it says what it is, and the scroll wheel says how far it is wanted. It is then hauled (or let
	go) there as fast as the vessel's halyards and sheets go (halyardSeconds, sheetSeconds: from one end to the other).
	THE ANCHOR goes to the bottom under the bow, with as much rode as three times the depth (up to the vessel's rode). Once the
	boat has drifted the rode tight, the anchor holds the bow, and the boat swings round to the wind. Too deep, and it hangs.

	AGROUND and against boulders it stops: the ground under the keel, the centreboard or the rudder pushes up and drags, and a
	boulder (boulders.js) pushes the hull away.

	PUTTING ONE IN THE SEA (spawnSpot): where the player's crosshair meets the water, no more than SPAWN_REACH from its eyes, and
	only where the water is deep enough all round the hull for its keel to clear the bottom by SPAWN_CLEARANCE (it is not to
	touch the shore). It is turned 50 degrees off the wind, on the tack nearer the way the player looks, with its sheets let go,
	so it sits there with its sails luffing until they are hauled in. Failing that, whichever way round fits. And it is put there
	at anchor (anchorAtSpawn: the rode already laid out upwind, so it holds at once), or a boat left alone in a blow would drift
	away faster than its sailor can swim after it. G brings the anchor up.
*/
const RHO_WATER = 1025;				// kg per cubic metre
const RHO_AIR = 1.225;
const GRAVITY = 9.81;
const CREW_MASS = 85;
const SUBSTEP = 1 / 120;			// seconds: a boat is moved in steps no longer than this
const REACH = 3.2;					// metres from the eye a control can be worked from
export const MAX_BOATS = 16;
export const SPAWN_REACH = 50;		// metres
const SPAWN_CLEARANCE = 0.4;		// metres of water under the keel, all round, for a boat to be put there
const PROBE_SKIP = 3;				// the first lots of probes that come back for a boat are someone else's (the boat that had its slot before)
const FOLLOW_DELAY = 0.15;			// seconds behind the last state heard that a boat sailed somewhere else is drawn

// The boats, and how each one is now
//-------------------------------------------------
// each, in metres, in the world's directions. q turns the boat's own directions into the world's (x to port, y up, z to the bow)
//		{ id, owner, authority, vessel,
//		  p, v (its centre of mass, and how fast that goes), q, w (which way it is turned (w, x, y, z), and how fast it turns,
//		  radians a second about the world's axes), centre (where on it the centre of mass is: it moves with the crew),
//		  sails: { hoist (0 to 1), sheet (0 all out to 1 all in), angle (out to port, radians), fill, shake, and how far up and in
//		  it is wanted (hoistWant, sheetWant: it gets there at the vessel's pace) },
//		  rudder (over to port, the bow goes to port, radians), anchor (down: { x, y, z (on the bottom, metres), rode, holding }),
//		  hovered (the control the crosshair is on), time, rising (each column's water: the last height that came back, when, how
//		  fast it was rising), crew (who is on it: id -> the middle of them, metres on the boat), message, messageAge,
//		  track (sailed somewhere else: the last few states heard), frame (its places into the world and back, see makeFrame), stats }
export const boats = [];
const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / (len(a) || 1));

// who this machine is, for which boats it sails (net.js says, in a game with others)
let localId = 0;
export function setLocalId(id) { localId = id; }
export const sailedHere = (b) => b.authority === localId;
export const isMine = (b) => b.owner === localId;

// a quaternion turning v, and the boat's directions in the world
function rotate(q, v) {
	const [w, x, y, z] = q;
	const t = scale(cross([x, y, z], v), 2);
	return add(add(v, scale(t, w)), cross([x, y, z], t));
}
function unrotate(q, v) {
	return rotate([q[0], -q[1], -q[2], -q[3]], v);
}
// v turned about the axis (length 1) by angle, the right hand way (Rodrigues: as turnAbout in vf_boat.js)
function turnAbout(v, axis, angle) {
	const c = Math.cos(angle), s = Math.sin(angle);
	return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}
// a place on the boat (metres) in the world (metres), and back
const toWorldMetres = (b, local) => add(b.p, rotate(b.q, sub(local, b.centre)));
const toLocal = (b, worldMetres) => add(unrotate(b.q, sub(worldMetres, b.p)), b.centre);
// how fast a place on the boat is going (metres a second)
const velocityAt = (b, local) => add(b.v, cross(b.w, rotate(b.q, sub(local, b.centre))));

// where a boat is, for whoever is on it (hunting.js): its places into the world (world units) and back, how fast a place on it
//		goes (world units a second), its heading (radians, as settings.camYaw), its up, its heel
function makeFrame(b) {
	return {
		toWorld(local) { return scale(toWorldMetres(b, local), metre()); },
		toLocal(world) { return toLocal(b, scale(world, 1 / metre())); },
		velocityAt(local) { return scale(velocityAt(b, local), metre()); },
		heading() { const f = rotate(b.q, [0, 0, 1]); return Math.atan2(f[0], -f[2]); },
		up() { return rotate(b.q, [0, 1, 0]); },
		directionToLocal(world) { return unrotate(b.q, world); },
		directionToWorld(local) { return rotate(b.q, local); },
		windwardSide() { return (b.sails[b.vessel.mainSail]?.angle ?? 0) >= 0 ? -1 : 1; },	// which side the wind comes from: -1 starboard, +1 port (the main is out the other side)
	};
}

// A group (see vessels.js): how far it is turned, and hoisted
function groupAngle(b, g) {
	const group = b.vessel.groups[g];
	if (group.kind == 'rudder') return b.rudder;
	if (group.kind == 'wheel') return b.rudder * group.turns;
	return b.sails[group.sail].angle;
}
function groupHoist(b, g) {
	const group = b.vessel.groups[g];
	return group.kind == 'sail' ? b.sails[group.sail].hoist : 1;
}
// where a point of the mesh is now, moved as vf_boat.js moves it (all but the curve of a sail's cloth)
function placeOnBoat(b, p, g, role) {
	if (g < 0) return p;
	const group = b.vessel.groups[g];
	let q = [...p];
	if (role == ROLE.CLOTH || role == ROLE.HOISTED) {
		const h = groupHoist(b, g);
		if (group.mode == 1) q = add(group.ref, scale(sub(q, group.ref), h));
		else q[1] = group.ref[1] + (q[1] - group.ref[1]) * h;
	}
	return add(group.pivot, turnAbout(sub(q, group.pivot), unit(group.axis), -groupAngle(b, g)));
}

// The water, from the probes (see FLOATING at the top)
//-------------------------------------------------
// the volume a column puts aside, sunk d metres
const sunkVolume = (V, column, d) => d <= 0 ? 0 : column.area * (d < V.vDepth ? d * d / (2 * V.vDepth) : d - V.vDepth / 2);

// each boat's run of the probes: the first one, and how many. Freed when the boat goes, and given to the next that fits
const probeSlots = [];		// [{ boat, from, count }], in order along the probes
function takeProbeSlot(b) {
	const count = b.vessel.columns.length;
	let from = 0;
	for (const slot of probeSlots) {
		if (slot.from - from >= count) break;
		from = slot.from + slot.count;
	}
	if (from + count > water.PROBES_MOST) return null;
	const slot = { boat: b, from, count };
	probeSlots.push(slot);
	probeSlots.sort((x, y) => x.from - y.from);
	b.probeSkip = PROBE_SKIP;
	b.rising = [];
	return slot;
}
function freeProbeSlot(b) {
	const at = probeSlots.findIndex((slot) => slot.boat === b);
	if (at >= 0) probeSlots.splice(at, 1);
	b.probeSlot = null;
}

// ask the water about each sailed boat's columns, where they are now (world units). A slot nobody is using asks about nowhere much
function askWater() {
	const m = metre();
	const end = probeSlots.reduce((most, slot) => Math.max(most, slot.from + slot.count), 0);
	const places = Array.from({ length: end }, () => [0, 0]);
	for (const slot of probeSlots) {
		slot.boat.vessel.columns.forEach((c, i) => {
			const at = toWorldMetres(slot.boat, [c.x, c.bottom, c.z]);
			places[slot.from + i] = [at[0] * m, at[2] * m];
		});
	}
	water.setWaterProbes(places);
}

// what came back: each column's water as a height and a slope at the place it was asked about, moved on in time as it was rising
let lastProbeFrames = -1;
function readWater(now) {
	const m = metre();
	const probes = water.waterProbes;
	const fresh = probes.frames != lastProbeFrames && settings.enableWater;
	if (!fresh) return;
	lastProbeFrames = probes.frames;
	for (const slot of probeSlots) {
		const b = slot.boat;
		if (probes.count < slot.from + slot.count) continue;
		if (b.probeSkip > 0) { b.probeSkip--; continue; }
		for (let i = 0; i < slot.count; i++) {
			const d = probes.data, o = (slot.from + i) * 8;
			const height = d[o + 2] / m, ny = Math.max(d[o + 4], 0.2);
			const was = b.rising[i];
			const rate = was ? clamp((height - was.height) / Math.max((now - was.at) / 1000, 0.008), -6, 6) : 0;
			b.rising[i] = { x: d[o] / m, z: d[o + 1] / m, height, slopeX: -d[o + 3] / ny, slopeZ: -d[o + 5] / ny, normal: [d[o + 3], ny, d[o + 5]], at: now, rate: was ? was.rate + (rate - was.rate) * 0.5 : 0 };
		}
	}
}

// the water's height at column i of a boat, at world (x, z) metres, now. Flat still water before anything has come back
function waterUnder(b, i, x, z, now) {
	const r = b.rising[i];
	const still = settings.waterWorldPosY / metre();
	if (!r || !settings.enableWater) return { height: still, normal: [0, 1, 0], rate: 0 };
	const ahead = Math.min((now - r.at) / 1000, 0.2);
	return { height: r.height + r.slopeX * (x - r.x) + r.slopeZ * (z - r.z) + r.rate * ahead, normal: r.normal, rate: r.rate };
}

// The wind (see SAILING at the top)
//-------------------------------------------------
// the true wind at a boat, metres a second along x and z: the wind over the sea, gusting
function trueWind(b) {
	const m = metre();
	const dir = settings.windDirection, length = Math.hypot(dir[0], dir[1]) || 1;
	const speed = settings.waterOceanWindSpeed * weatherNow.wind;
	const gust = windAtPoint(b.p[0] * m, b.p[2] * m)[2];
	const s = speed * (0.85 + 0.3 * gust);
	return [dir[0] / length * s, 0, dir[1] / length * s];
}

// lift and drag of a sail at angle of attack a (radians, 0 to pi / 2): up to about 17 degrees it lifts more and more, past that it stalls
function sailCoefficients(a) {
	let lift;
	if (a <= 0.3) lift = 5.0 * a;
	else if (a <= 0.5) lift = 1.5 - (a - 0.3) * 1.5;
	else lift = 1.43 * Math.sin(2 * a);
	const s = Math.sin(a);
	return { lift, drag: 0.06 + 1.25 * s * s + 0.06 * lift * lift };
}

// sail i's force (newtons, the boat's directions), and it swung to where the wind and its sheet (or braces) put it.
//		apparent: the wind it feels, the boat's directions
function sailForce(b, i, apparent, dt) {
	const sail = b.vessel.sails[i], s = b.sails[i];
	// the wind across the sail: less what is along the mast
	const across = [apparent[0], 0, apparent[2]];
	const speed = Math.hypot(across[0], across[2]);
	// where the wind would blow it (out to port from straight aft), and how far the sheet lets it go
	const free = Math.atan2(across[0], -across[2]);
	const most = sail.eased + (sail.hauled - sail.eased) * s.sheet;
	// a fore and aft sail goes with the wind as far as the sheet lets it. A square sail is braced round as far as it says, on
	//		the side the wind takes it to
	let wanted = sail.fixed ? (Math.sign(free) || 1) * most : clamp(free, -most, most);
	// dead before the wind it stays on the side it is on, until the wind is well round on the other side of it (then it gybes)
	if (Math.abs(free) > Math.PI - 0.35 && s.angle != 0) wanted = Math.sign(s.angle) * most;
	// it swings there, quicker the harder it blows (and across the boat in a gybe). A yard is braced round slowly
	const rate = (sail.fixed ? 0.5 : 2.5 + speed * 0.4) * dt;
	s.angle += clamp(wanted - s.angle, -rate, rate);
	const angle = s.angle;
	const chord = [Math.sin(angle), 0, -Math.cos(angle)];
	const flow = speed > 0.01 ? [across[0] / speed, 0, across[2] / speed] : [0, 0, -1];
	const along = dot(chord, flow);
	const attack = Math.acos(clamp(Math.abs(along), 0, 1));
	s.attack = attack;
	s.shake = !sail.fixed && s.hoist > 0.02 ? clamp(1 - attack / 0.1, 0, 1) * clamp(speed / 2, 0, 1) : 0;
	if (s.hoist < 0.02 || speed < 0.01) {
		s.fill = 0;
		return [0, 0, 0];
	}
	const { lift, drag } = sailCoefficients(attack);
	// lift: square to the wind, away from the side the sail turns it to (the sail taken as a line, pointing on downwind)
	const line = along >= 0 ? chord : scale(chord, -1);
	const l = dot(line, flow);
	let liftDir = [-(line[0] - l * flow[0]), 0, -(line[2] - l * flow[2])];
	const ll = Math.hypot(liftDir[0], liftDir[2]);
	liftDir = ll > 1e-4 ? [liftDir[0] / ll, 0, liftDir[2] / ll] : [0, 0, 0];
	const push = 0.5 * RHO_AIR * speed * speed * sail.area * s.hoist;
	const force = [push * (lift * liftDir[0] + drag * flow[0]), 0, push * (lift * liftDir[2] + drag * flow[2])];
	// the sail bellies out to whichever side the wind pushes it
	const normal = [Math.cos(angle), 0, Math.sin(angle)];
	s.fill = Math.sign(dot(force, normal)) * clamp(speed / 5, 0, 1) * (1 - 0.8 * s.shake);
	return force;
}

// A foil in the water (the keel, the rudder): a flat plate turned angle about y, pushing back square to itself as the water
//		meets it at an angle, up to where it stalls. local: where on the boat. Newtons, in the world
//		scull: the water going past it at least this fast (metres a second), as if the tiller were worked to and fro to turn a boat that is
//		hardly moving (or it could never be turned out of irons)
function foilForce(b, local, angle, area, wetness, scull = 0) {
	const v = unrotate(b.q, velocityAt(b, local));
	if (scull > 0 && Math.abs(v[2]) < scull) v[2] = scull;
	const chord = [-Math.sin(angle), 0, Math.cos(angle)], normal = [Math.cos(angle), 0, Math.sin(angle)];
	const across = dot(v, normal), along = dot(v, chord);
	const speed2 = across * across + along * along;
	if (speed2 < 1e-6) return [0, 0, 0];
	const attack = Math.atan2(across, Math.abs(along));
	const push = clamp(2 * Math.PI * Math.sin(attack), -1.3, 1.3);
	const f = -0.5 * RHO_WATER * speed2 * area * push * wetness;
	return rotate(b.q, [normal[0] * f, 0, normal[2] * f]);
}

// One step of a boat (see the top)
//-------------------------------------------------
function stepBoat(b, dt, now) {
	const m = metre();
	const V = b.vessel;
	const stats = b.stats;
	// the centre of mass: the hull's, and the crew's where they are
	const crew = [...b.crew.values()];
	const mass = V.mass + crew.length * CREW_MASS;
	let centre = scale(V.centre, V.mass);
	for (const c of crew) centre = add(centre, scale(c, CREW_MASS));
	centre = scale(centre, 1 / mass);
	// (the crew moving about moves the centre of mass on the boat, not the boat)
	const moved = sub(centre, b.centre);
	if (len(moved) > 0) {
		b.p = add(b.p, rotate(b.q, moved));
		b.centre = centre;
	}
	// how hard it is to turn about its own axes (x: pitch, y: yaw, z: roll), the crew's share as well
	const inertia = [...V.inertia];
	for (const c of crew) {
		const r = sub(c, centre);
		inertia[0] += CREW_MASS * (r[1] * r[1] + r[2] * r[2]);
		inertia[1] += CREW_MASS * (r[0] * r[0] + r[2] * r[2]);
		inertia[2] += CREW_MASS * (r[0] * r[0] + r[1] * r[1]);
	}

	let force = [0, -GRAVITY * mass, 0];
	let torque = [0, 0, 0];
	const push = (f, local) => {
		force = add(force, f);
		torque = add(torque, cross(rotate(b.q, sub(local, b.centre)), f));
	};
	const pushWorld = (f, worldPoint) => {
		force = add(force, f);
		torque = add(torque, cross(sub(worldPoint, b.p), f));
	};
	const axisX = rotate(b.q, [1, 0, 0]), axisY = rotate(b.q, [0, 1, 0]), axisZ = rotate(b.q, [0, 0, 1]);

	// floating: each column, as deep as it is in the water
	let wet = 0;
	const bowColumn = V.columns.length - 1;
	V.columns.forEach((c, i) => {
		const bottom = toWorldMetres(b, [c.x, c.bottom, c.z]);
		const under = waterUnder(b, i, bottom[0], bottom[2], now);
		if (i == bowColumn) stats.bowFreeboard = toWorldMetres(b, [c.x, c.top ?? V.columnTop, c.z])[1] - under.height;
		const d = clamp(under.height - bottom[1], 0, (c.top ?? V.columnTop) - c.bottom);
		if (d <= 0) return;
		const share = Math.min(d / V.vDepth, 1);
		wet += share / V.columns.length;
		const lift = RHO_WATER * GRAVITY * sunkVolume(V, c, d);
		const n = under.normal, nl = len(n);
		const at = [c.x, c.bottom + d * 0.5, c.z];
		const rising = velocityAt(b, at)[1] - under.rate;
		push([n[0] / nl * lift, n[1] / nl * lift - V.heaveDamping * c.area * share * rising, n[2] / nl * lift], at);
	});

	// the water: the hull dragging, the keel and the rudder
	const middle = V.keel.at;
	const v = unrotate(b.q, velocityAt(b, middle));
	const ahead = v[2], sideways = v[0];
	const H = V.hullDrag, S = V.slip;
	const drag = -(H.linear * ahead + H.quadratic * ahead * Math.abs(ahead) + H.wave * Math.sign(ahead) * Math.max(Math.abs(ahead) - H.hullSpeed, 0) ** 2) * wet;
	const slip = -(S.linear * sideways + S.quadratic * sideways * Math.abs(sideways)) * wet;
	push(rotate(b.q, [slip, 0, drag]), middle);
	push(foilForce(b, V.keel.at, 0, V.keel.area, wet), V.keel.at);
	push(foilForce(b, V.rudder.at, b.rudder, V.rudder.area, wet, V.rudder.scull), V.rudder.at);
	// turning about its own axes is damped by the water too, yawing the more the faster it goes
	const spin = unrotate(b.q, b.w);
	const [ya, yb, yc] = V.damping.yaw;
	const yawDamp = -((ya + yb * Math.abs(ahead)) * spin[1] + yc * spin[1] * Math.abs(spin[1])) * Math.max(wet, 0.2);
	torque = add(torque, add(add(scale(axisY, yawDamp), scale(axisZ, -V.damping.roll * spin[2] * Math.max(wet, 0.2))), scale(axisX, -V.damping.pitch * spin[0] * Math.max(wet, 0.2))));

	// the sails
	const wind = trueWind(b);
	let driveAhead = 0;
	V.sails.forEach((sail, i) => {
		const at = placeOnBoat(b, sail.centre, sail.group, ROLE.CLOTH);
		const f = sailForce(b, i, unrotate(b.q, sub(wind, velocityAt(b, at))), dt);
		push(rotate(b.q, f), at);
		driveAhead += f[2];
	});

	// not over: past the heel limit pushed back up hard (and not up on its nose or its tail either)
	//		(heeled to starboard is turned + about the boat's z: back up is turning it - about it)
	const heel = Math.asin(clamp(axisX[1], -1, 1));		// + with the port side up: heeled to starboard
	if (Math.abs(heel) > V.heelLimit) torque = add(torque, scale(axisZ, -Math.sign(heel) * V.heelStiffness * (Math.abs(heel) - V.heelLimit) - V.heelDamping * spin[2]));
	const pitch = Math.asin(clamp(axisZ[1], -1, 1));
	if (Math.abs(pitch) > V.pitchLimit) torque = add(torque, scale(axisX, Math.sign(pitch) * V.pitchStiffness * (Math.abs(pitch) - V.pitchLimit)));

	// the anchor: the rode pulls the bow back towards it once it is tight
	if (b.anchor && b.anchor.holding) {
		const bow = toWorldMetres(b, V.bow);
		const reach = Math.sqrt(Math.max(b.anchor.rode * b.anchor.rode - (bow[1] - b.anchor.y) ** 2, 1));
		const off = [bow[0] - b.anchor.x, 0, bow[2] - b.anchor.z];
		const distance = Math.hypot(off[0], off[2]);
		if (distance > reach) {
			// (a rope: it only pulls, damped both ways so the boat does not bounce off the end of it, and no harder than it holds)
			const toward = [-off[0] / distance, 0, -off[2] / distance];
			const vb = velocityAt(b, V.bow);
			const A = V.anchor;
			const pull = clamp(A.stiffness * (distance - reach) - A.damping * dot(vb, toward), 0, A.most);
			push(scale(toward, pull), V.bow);
		}
	}

	// aground, and against boulders
	let aground = false;
	const land = terrain.land;
	if (land && settings.enableTerrain) {
		const G = V.groundGrip;
		for (const point of V.groundPoints) {
			const at = toWorldMetres(b, point);
			const ground = land.heightAt(at[0] * m, at[2] * m) / m;
			if (at[1] >= ground) continue;
			aground = true;
			const vp = velocityAt(b, point);
			const into = ground - at[1];
			pushWorld([-G.friction * vp[0], G.stiffness * into - G.damping * Math.min(vp[1], 0), -G.friction * vp[2]], at);
		}
	}
	for (const rock of b.nearRocks) {
		for (const point of V.hullRing) {
			const at = toWorldMetres(b, point);
			if (at[1] < rock.bottom || at[1] > rock.top) continue;
			const dx = at[0] - rock.x, dz = at[2] - rock.z, distance = Math.hypot(dx, dz);
			if (distance >= rock.radius || distance < 1e-4) continue;
			const out = [dx / distance, 0, dz / distance];
			const vp = velocityAt(b, point);
			pushWorld(scale(out, V.rockStiffness * (rock.radius - distance) - V.rockDamping * Math.min(dot(vp, out), 0)), at);
		}
	}
	// and against the other boats: their hull rings pushed apart, each boat taking its share by its weight
	for (const other of boats) {
		if (other === b || !other.exists) continue;
		const reachBoth = b.vessel.reach + other.vessel.reach;
		if (Math.hypot(other.p[0] - b.p[0], other.p[2] - b.p[2]) > reachBoth) continue;
		for (const point of V.hullRing) {
			const at = toWorldMetres(b, point);
			const there = toLocal(other, at);
			const half = other.vessel.halfBreadth(there[2]);
			if (half <= 0 || Math.abs(there[0]) >= half || there[1] > other.vessel.sheerHeight(there[2]) || there[1] < -1) continue;
			const outLocal = [Math.sign(there[0]) || 1, 0, 0];
			const out = rotate(other.q, outLocal);
			const into = half - Math.abs(there[0]);
			const vp = sub(velocityAt(b, point), velocityAt(other, there));
			pushWorld(scale(out, V.rockStiffness * 0.5 * into - V.rockDamping * Math.min(dot(vp, out), 0)), at);
		}
	}

	// moved on
	b.v = add(b.v, scale(force, dt / mass));
	const t = unrotate(b.q, torque);
	const turnBy = rotate(b.q, [t[0] / inertia[0], t[1] / inertia[1], t[2] / inertia[2]]);
	b.w = add(b.w, scale(turnBy, dt));
	b.p = add(b.p, scale(b.v, dt));
	const [qw, qx, qy, qz] = b.q, [wx, wy, wz] = b.w;
	const dq = [-wx * qx - wy * qy - wz * qz, wx * qw + wy * qz - wz * qy, wy * qw + wz * qx - wx * qz, wz * qw + wx * qy - wy * qx];
	b.q = b.q.map((c, k) => c + 0.5 * dq[k] * dt);
	const ql = Math.hypot(...b.q);
	b.q = b.q.map((c) => c / ql);

	// not off the edge of the world
	const edge = settings.terrainWorldSize * 0.5 / m - 5;
	b.p[0] = clamp(b.p[0], -edge, edge);
	b.p[2] = clamp(b.p[2], -edge, edge);

	const mainAt = placeOnBoat(b, V.sails[V.mainSail].centre, V.sails[V.mainSail].group, ROLE.CLOTH);
	const apparent = unrotate(b.q, sub(wind, velocityAt(b, mainAt)));
	const tw = unrotate(b.q, wind);
	Object.assign(stats, {
		speed: unrotate(b.q, b.v)[2], heel, wet, aground, driveAhead,
		trueWind: len(wind), apparentWind: Math.hypot(apparent[0], apparent[2]),
		apparentAngle: Math.atan2(-apparent[0], -apparent[2]),		// where the apparent wind comes from: 0 dead ahead, + from port
		trueAngle: Math.atan2(-tw[0], -tw[2]),
		attacks: b.sails.map((s) => s.attack ?? 0),
	});
}

function gatherRocks(b) {
	b.nearRocks = [];
	if (!settings.enableBoulders) return;
	const m = metre();
	boulders.bouldersNear(b.p[0] * m, b.p[2] * m, b.vessel.rockReach * m, (x, z, half, bottom, top) => {
		b.nearRocks.push({ x: x / m, z: z / m, radius: half / m, bottom: bottom / m, top: top / m });
	});
}

// Putting one in the sea (see PUTTING ONE IN THE SEA at the top)
//-------------------------------------------------
// whether a vessel fits at (x, z) world units turned to yaw (as settings.camYaw): deep enough under all of it. null if so, or what is wrong
function footprintClear(V, x, z, yaw) {
	const land = terrain.land;
	if (!land || !settings.enableTerrain) return null;
	const m = metre();
	const sea = settings.waterWorldPosY;
	const half = settings.terrainWorldSize * 0.5 - 30 * m;
	if (Math.abs(x) > half || Math.abs(z) > half) return 'Too near the edge of the world';
	const ahead = [Math.sin(yaw), -Math.cos(yaw)], side = [-ahead[1], ahead[0]];
	const need = V.spawn.keel + SPAWN_CLEARANCE;
	for (const along of V.footprint) {
		for (const out of [-1, -0.5, 0, 0.5, 1]) {
			const across = out * (V.halfBreadth(along) + 0.6);
			const px = x + (ahead[0] * along + side[0] * across) * m, pz = z + (ahead[1] * along + side[1] * across) * m;
			const depth = (sea - land.heightAt(px, pz)) / m;
			if (depth < need) return depth < 0 ? 'Too close to the shore' : 'Too shallow there';
		}
	}
	return null;
}

// the two ways a boat can point 50 degrees off the wind (as settings.camYaw)
function offTheWind() {
	const dir = settings.windDirection, length = Math.hypot(dir[0], dir[1]) || 1;
	const from = Math.atan2(-dir[0] / length, dir[1] / length);		// (the yaw that looks into the wind)
	const off = 50 * Math.PI / 180;
	return [from + off, from - off];
}
// where a vessel would go from the eye (world units) looking along look (length 1), turned off the wind on the tack nearer the way the
//		eye looks (or round until it fits): { x, z, yaw } or { reason }
export function spawnSpot(name, eye, look) {
	const V = VESSELS[name];
	if (!V) return { reason: 'No such vessel' };
	const m = metre();
	const sea = settings.waterWorldPosY;
	const land = terrain.land;
	// along the line of sight to where it comes down to the water (or the land first)
	if (look[1] > -0.005) return { reason: 'Point down at the water' };
	const toSea = (eye[1] - sea) / -look[1];
	if (toSea > SPAWN_REACH * m) return { reason: `Point at water within ${SPAWN_REACH} m` };
	if (toSea < 0) return { reason: 'Point at the water' };
	if (land && settings.enableTerrain) {
		for (let t = 0; t <= toSea; t += 0.5 * m) {
			if (land.heightAt(eye[0] + look[0] * t, eye[2] + look[2] * t) > eye[1] + look[1] * t) return { reason: 'Point at the water, not the land' };
		}
	}
	const x = eye[0] + look[0] * toSea, z = eye[2] + look[2] * toSea;
	const facing = Math.atan2(look[0], -look[2]);
	const apart = (a) => Math.abs(Math.atan2(Math.sin(a - facing), Math.cos(a - facing)));
	const tacks = offTheWind().sort((a, b) => apart(a) - apart(b));
	let reason = null;
	for (let k = 0; k < 12; k++) {
		const yaw = k < 2 ? tacks[k] : tacks[0] + (k % 2 ? 1 : -1) * Math.ceil((k - 1) / 2) * Math.PI / 5;
		const wrong = footprintClear(V, x, z, yaw);
		if (!wrong) return { x, z, yaw };
		reason ??= wrong;
	}
	return { reason };
}

// a new boat (the vessel named) at (x, z) world units, still, turned to yaw (as settings.camYaw), with its sails as the vessel
//		starts them and their sheets let all the way out: they stream out along the wind (luffing), and it sits there until they
//		are pulled in. Or 50 degrees off the wind, with no yaw given. owner: whose it is (net.js). id: its name in a game with others
let nextBoatNumber = 1;
export function spawnBoat(x, z, name, { yaw = null, owner = localId, id = null, authority = owner, anchored = false } = {}) {
	const vessel = VESSELS[name] ?? VESSELS.Dinghy;
	const m = metre();
	if (yaw === null) yaw = offTheWind()[0];
	// (turned about y from +z: the boat's bow, +z, to the way yaw points)
	const turn = Math.atan2(Math.sin(yaw), -Math.cos(yaw));
	const b = {
		id: id ?? `${owner}:${nextBoatNumber++}`, owner, authority, vessel, exists: true,
		q: [Math.cos(turn / 2), 0, Math.sin(turn / 2), 0], centre: [...vessel.centre], v: [0, 0, 0], w: [0, 0, 0],
		sails: vessel.sails.map((sail) => ({ hoist: sail.start.hoist, sheet: sail.start.sheet, hoistWant: sail.start.hoist, sheetWant: sail.start.sheet, angle: 0, fill: 0, shake: 0, attack: 0 })),
		rudder: 0, anchor: null, hovered: -1, time: 0, rising: [], crew: new Map(), message: '', messageAge: 99,
		track: [], nearRocks: [], rocksAt: 0, probeSlot: null, probeSkip: 0, gpu: null,
		stats: { vessel: vessel.name, triangles: vessel.triangles, speed: 0, heel: 0, trueWind: 0, apparentWind: 0, apparentAngle: 0, trueAngle: 0, attacks: [], driveAhead: 0, wet: 0, aground: false,
			bowFreeboard: 0 },	// (how far the deck at the bow is over the water there, metres: under it with green water on the foredeck)
	};
	b.p = add([x / m, 0, z / m], rotate(b.q, b.centre));
	b.p[1] = settings.waterWorldPosY / m - vessel.spawn.draft + b.centre[1];
	b.frame = makeFrame(b);
	if (boats.length >= MAX_BOATS) removeBoat(boats.find((one) => one.crew.size == 0) ?? boats[0]);
	boats.push(b);
	if (sailedHere(b)) b.probeSlot = takeProbeSlot(b);
	gatherRocks(b);
	if (anchored) anchorAtSpawn(b);
	return b;
}

// a boat just put in the sea, at anchor: the anchor on the bottom upwind of the bow, as far off as its rode lets it lie
function anchorAtSpawn(b) {
	const m = metre();
	const V = b.vessel;
	const land = terrain.land;
	if (!land || !settings.enableTerrain) return;
	const bow = toWorldMetres(b, V.bow);
	const bottom = land.heightAt(bow[0] * m, bow[2] * m) / m;
	const depth = settings.waterWorldPosY / m - bottom;
	if (depth >= V.anchor.rode - 2) return;		// (too deep to hold: it is left to drift)
	const rode = Math.min(V.anchor.rode, 3 * depth + 2);
	const dir = settings.windDirection, length = Math.hypot(dir[0], dir[1]) || 1;
	// as far upwind as the rode reaches down to the bottom there (the bottom upwind may be higher or lower than under the bow)
	let out = rode * 0.9, y = bottom;
	for (let k = 0; k < 6; k++) {
		y = Math.min(land.heightAt((bow[0] - dir[0] / length * out) * m, (bow[2] - dir[1] / length * out) * m) / m, settings.waterWorldPosY / m - 0.5);
		out = Math.sqrt(Math.max(rode * rode - (bow[1] - y) ** 2, 1)) * 0.98;
	}
	b.anchor = { x: bow[0] - dir[0] / length * out, y, z: bow[2] - dir[1] / length * out, rode, holding: true };
}

export function removeBoat(b) {
	const at = boats.indexOf(b);
	if (at < 0) return;
	boats.splice(at, 1);
	b.exists = false;
	freeProbeSlot(b);
	b.gpu?.buffer.destroy();
	if (boats.length == 0) water.setWaterProbes([]);
}
export function removeAllBoats() {
	for (const b of [...boats]) removeBoat(b);
}
export function boatById(id) {
	return boats.find((b) => b.id === id) ?? null;
}

// The shape of one, for walking about on it and bumping into it (hunting.js). Metres, on the boat
//-------------------------------------------------
// half the boat's width at its sheer, at z (0 off either end), and how high the top of its side is
export function halfBreadth(b, z) { return b.vessel.halfBreadth(z); }
export function sheerHeight(b, z) { return b.vessel.sheerHeight(z); }
// what a foot comes down on at (x, z): its deck, or whatever stands on it. null off the boat
export function deckHeight(b, x, z) { return b.vessel.deckHeight(x, z); }
// where the helm is: { at (where the player's feet are), eye (over that), seated, hike, hikeX, hikeOut, standAt }
export function helm(b) { return b.vessel.helm; }
// the ladders, one each side: [{ x, z, top, foot (in the water), over (the top of the side), inside (on deck), seconds (to climb) }]
export function ladders(b) { return b.vessel.ladders; }

// The controls (see THE CONTROLS at the top)
//-------------------------------------------------
// the control the eye is looking at on any boat (eye and look in world units), within reach: { boat, id, kind, sail, name, keys, value }
//		or null. usable(boat, control): which of them count (one that cannot be used from where the eye is does not hide one behind it)
export function controlInView(eye, look, usable = () => true) {
	const m = metre();
	const eyeM = scale(eye, 1 / m);
	let best = null, bestAlong = Infinity, bestBoat = null;
	for (const b of boats) {
		if (Math.hypot(b.p[0] - eyeM[0], b.p[2] - eyeM[2]) > b.vessel.reach + REACH) continue;
		for (const control of b.vessel.controls) {
			if (!usable(b, control)) continue;
			const at = toWorldMetres(b, control.at);
			const to = sub(at, eyeM);
			const along = dot(to, look);
			if (along < 0 || along > REACH) continue;
			const off = len(sub(to, scale(look, along)));
			if (off < control.radius && along < bestAlong) {
				best = control;
				bestAlong = along;
				bestBoat = b;
			}
		}
	}
	if (!best) return null;
	return controlValue(bestBoat, best);
}
export function controlValue(b, control) {
	const s = b.sails[control.sail];
	return { ...control, boat: b, value: control.kind == 'halyard' ? s.hoist : control.kind == 'sheet' ? s.sheet : undefined,
		want: control.kind == 'halyard' ? s.hoistWant : control.kind == 'sheet' ? s.sheetWant : undefined };
}

// told of a control worked on a boat sailed somewhere else (net.js sends it there): fn(boat, what)
let remoteControl = null;
export function onRemoteControl(fn) { remoteControl = fn; }

// a control asked for further up or in (+) or down or out (-) by amount (the whole of it is 1): the scroll wheel
export function nudgeControl(b, control, amount) {
	if (!sailedHere(b)) { remoteControl?.(b, { kind: 'nudge', control: control.id, amount }); return; }
	const s = b.sails[control.sail];
	if (!s) return;
	if (control.kind == 'halyard') s.hoistWant = clamp(s.hoistWant + amount, 0, 1);
	if (control.kind == 'sheet') s.sheetWant = clamp(s.sheetWant + amount, 0, 1);
}
// a control worked from somewhere else, on a boat sailed here
export function workControl(b, what) {
	if (what.kind == 'nudge') {
		const control = b.vessel.controls[what.control];
		if (control) nudgeControl(b, control, what.amount);
	} else if (what.kind == 'anchor') {
		toggleAnchor(b);
	}
}

// each sail hauled up or let down, and its sheet in or out, towards where it is wanted, at the vessel's pace
function haulRopes(b, dt) {
	const toward = (v, to, step) => v < to ? Math.min(v + step, to) : Math.max(v - step, to);
	for (const s of b.sails) {
		s.hoist = toward(s.hoist, s.hoistWant, dt / b.vessel.halyardSeconds);
		s.sheet = toward(s.sheet, s.sheetWant, dt / b.vessel.sheetSeconds);
	}
}

// the tiller or the wheel: + to turn to port (A), - to starboard (D), for dt seconds. It stays where it is put
export function steer(b, direction, dt) {
	const R = b.vessel.rudder;
	b.rudder = clamp(b.rudder + direction * dt / R.seconds * R.most, -R.most, R.most);
}

// the anchor down, or up again
export function toggleAnchor(b) {
	if (!b.exists) return;
	if (!sailedHere(b)) { remoteControl?.(b, { kind: 'anchor' }); return; }
	if (b.anchor) {
		b.anchor = null;
		say(b, 'Anchor up');
		return;
	}
	const m = metre();
	const V = b.vessel;
	const bow = toWorldMetres(b, V.bow);
	const land = terrain.land;
	const bottom = land && settings.enableTerrain ? land.heightAt(bow[0] * m, bow[2] * m) / m : bow[1] - 1000;
	const depth = settings.waterWorldPosY / m - bottom;
	const most = V.anchor.rode;
	const rode = Math.min(most, 3 * depth + 2);
	const holding = depth < most - 2;
	b.anchor = { x: bow[0], y: Math.max(bottom, bow[1] - most), z: bow[2], rode, holding };
	say(b, holding ? `Anchor down in ${depth.toFixed(0)} m` : `Too deep to anchor (${depth.toFixed(0)} m): it hangs`);
}

// who is on a boat: who (an id: 'me' for this player, a player's number for the others) and where the middle of them is (metres on
//		the boat), or null once they are off it
export function setCrew(b, who, local) {
	if (!b) return;
	if (local) b.crew.set(who, local);
	else b.crew.delete(who);
}
// off every boat
export function leaveAllBoats(who) {
	for (const b of boats) b.crew.delete(who);
}
// the control the crosshair is on (-1 for none), to light it up
export function setHovered(b, id) {
	for (const other of boats) other.hovered = other === b ? id : -1;
}

function say(b, message) {
	b.message = message;
	b.messageAge = 0;
}

// Sailed somewhere else (see WHO SAILS IT at the top)
//-------------------------------------------------
// what is sent of a boat sailed here: where it is and how it moves, its rudder, its sails, its anchor
export function boatShare(b) {
	const r = (v) => Math.round(v * 10000) / 10000;
	return {
		id: b.id, n: b.vessel.name, o: b.owner, a: b.authority,
		p: b.p.map(r), q: b.q.map(r), v: b.v.map(r), w: b.w.map(r), c: b.centre.map(r), r: r(b.rudder),
		s: b.sails.map((s) => [r(s.hoist), r(s.sheet), r(s.angle), r(s.fill), r(s.shake), r(s.hoistWant), r(s.sheetWant)]),
		k: b.anchor ? [r(b.anchor.x), r(b.anchor.y), r(b.anchor.z), r(b.anchor.rode), b.anchor.holding ? 1 : 0] : null,
		m: b.messageAge < 2.5 ? b.message : '',
	};
}
// a boat put out somewhere else (net.js): as its state says, sailed where it says
export function spawnFromShare(s) {
	const m = metre();
	const b = spawnBoat(s.p[0] * m, s.p[2] * m, s.n, { owner: s.o, id: s.id, authority: s.a });
	b.p = [...s.p]; b.q = [...s.q]; b.v = [...s.v]; b.w = [...s.w]; b.centre = [...s.c]; b.rudder = s.r;
	s.s.forEach((x, i) => { if (b.sails[i]) Object.assign(b.sails[i], { hoist: x[0], sheet: x[1], angle: x[2], fill: x[3], shake: x[4], hoistWant: x[5], sheetWant: x[6] }); });
	b.anchor = s.k ? { x: s.k[0], y: s.k[1], z: s.k[2], rode: s.k[3], holding: s.k[4] > 0.5 } : null;
	if (!sailedHere(b)) b.track.push({ at: performance.now() / 1000, s });
	return b;
}
// a state heard of a boat sailed somewhere else: kept, to draw it in between
export function boatHeard(share) {
	const b = boatById(share.id);
	if (!b || sailedHere(b)) return;
	b.track.push({ at: performance.now() / 1000, s: share });
	if (b.track.length > 8) b.track.shift();
	if (share.m && share.m != b.message) say(b, share.m);
}
// a boat sailed somewhere else, where it was FOLLOW_DELAY ago: in between the two states either side of then (and on from the last
//		one at the speed it was going, if nothing newer has come)
function follow(b, now) {
	const track = b.track;
	if (track.length == 0) return;
	const at = now - FOLLOW_DELAY;
	let a = track[0], c = track[track.length - 1];
	for (let k = 0; k < track.length - 1; k++) {
		if (track[k].at <= at && track[k + 1].at >= at) { a = track[k]; c = track[k + 1]; break; }
	}
	const f = c.at > a.at ? clamp((at - a.at) / (c.at - a.at), 0, 1) : 1;
	const ahead = at > c.at ? Math.min(at - c.at, 0.5) : 0;
	const mix = (x, y) => x.map((v, i) => v + (y[i] - v) * f);
	const A = a.s, C = c.s;
	b.p = add(mix(A.p, C.p), scale(C.v, ahead));
	// (the shorter way round between the two turns)
	const qc = dot([A.q[1], A.q[2], A.q[3]], [C.q[1], C.q[2], C.q[3]]) + A.q[0] * C.q[0] < 0 ? C.q.map((v) => -v) : C.q;
	const q = mix(A.q, qc), ql = Math.hypot(...q);
	b.q = q.map((v) => v / ql);
	b.v = mix(A.v, C.v);
	b.w = mix(A.w, C.w);
	b.centre = mix(A.c, C.c);
	b.rudder = A.r + (C.r - A.r) * f;
	C.s.forEach((s, i) => {
		const was = A.s[i] ?? s, sail = b.sails[i];
		if (!sail) return;
		Object.assign(sail, { hoist: was[0] + (s[0] - was[0]) * f, sheet: was[1] + (s[1] - was[1]) * f, angle: was[2] + (s[2] - was[2]) * f, fill: was[3] + (s[3] - was[3]) * f, shake: s[4], hoistWant: s[5], sheetWant: s[6] });
	});
	b.anchor = C.k ? { x: C.k[0], y: C.k[1], z: C.k[2], rode: C.k[3], holding: C.k[4] > 0.5 } : null;
}
// a boat taken over here (its helm taken, or whoever sailed it gone): sailed on from where it was last drawn
export function takeOver(b, authority = localId) {
	b.authority = authority;
	b.track = [];
	if (sailedHere(b)) { if (!b.probeSlot) b.probeSlot = takeProbeSlot(b); }
	else freeProbeSlot(b);
}

// Per frame
//-------------------------------------------------
let lastTime = performance.now();
export function boatUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	const on = boats.length > 0 && settings.enableWater;
	const mine = boats.find((b) => b.crew.has('me'));
	panel.style.display = on && mine ? '' : 'none';
	if (!on) {
		if (probeSlots.length == 0) water.setWaterProbes([]);
		return;
	}
	readWater(now);
	for (const b of boats) {
		if (!sailedHere(b)) {
			follow(b, now / 1000);
		} else {
			if (!b.probeSlot) b.probeSlot = takeProbeSlot(b);
			if (now - b.rocksAt > 500) {
				gatherRocks(b);
				b.rocksAt = now;
			}
			haulRopes(b, elapsed);
			for (let left = elapsed; left > 1e-6; left -= SUBSTEP) stepBoat(b, Math.min(left, SUBSTEP), now);
		}
		b.time += elapsed;
		b.messageAge += elapsed;
	}
	askWater();
	if (mine) showPanel(mine);
}

// for testing: a boat's state (the first one, if none is named), and its controls set straight ({ rudder, sails: [{ hoist, sheet }] })
export function boatState(b = boats[0]) {
	if (!b) return null;
	return { id: b.id, vessel: b.vessel.name, p: scale(b.p, metre()), v: [...b.v], q: [...b.q], sails: b.sails.map((s) => ({ ...s })), rudder: b.rudder,
		anchor: b.anchor && { ...b.anchor }, stats: { ...b.stats, probesBack: water.waterProbes.frames }, heading: b.frame.heading(), authority: b.authority, crew: [...b.crew.keys()] };
}
export function setBoatControls(values, b = boats[0]) {
	if (!b) return;
	if ('rudder' in values) b.rudder = values.rudder;
	(values.sails ?? []).forEach((s, i) => {
		if (!b.sails[i] || !s) return;
		Object.assign(b.sails[i], s);
		if ('hoist' in s) b.sails[i].hoistWant = s.hoist;
		if ('sheet' in s) b.sails[i].sheetWant = s.sheet;
	});
}

// The panel, in the bottom right while on a boat
//-------------------------------------------------
const panel = document.createElement('div');
panel.style.cssText = 'position: fixed; right: 16px; top: 50%; transform: translateY(-50%); z-index: 5; pointer-events: none; display: none; padding: 10px 14px; border-radius: 6px; background: rgba(0, 0, 0, 0.55); color: #e8e8e8; font-family: system-ui, sans-serif; font-size: 12px; user-select: none; width: 230px;';
document.body.appendChild(panel);
let panelShown = '';

const knots = (metresPerSecond) => metresPerSecond * 1.94384;
// a little bar, 0 to 1 (or -1 to 1 from the middle)
function bar(value, centred = false) {
	const fill = centred
		? `<div style="position: absolute; top: 0; bottom: 0; left: ${50 + Math.min(value, 0) * 50}%; width: ${Math.abs(value) * 50}%; background: #e0b44a;"></div><div style="position: absolute; top: -2px; bottom: -2px; left: 50%; width: 1px; background: rgba(255, 255, 255, 0.6);"></div>`
		: `<div style="height: 100%; width: ${value * 100}%; background: #8fc3e8;"></div>`;
	return `<div style="flex: 1; position: relative; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.15); overflow: hidden;">${fill}</div>`;
}
// the wind on a dial: the boat pointing up, the true wind (white) and the apparent wind (yellow) blowing in from where they come from
function windDial(s) {
	const arrow = (angle, length, color) => {
		const x = 30 - Math.sin(angle) * 26, y = 30 - Math.cos(angle) * 26;
		const tx = 30 - Math.sin(angle) * (26 - length), ty = 30 - Math.cos(angle) * (26 - length);
		return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/><circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="2.4" fill="${color}"/>`;
	};
	return `<svg width="60" height="60" viewBox="0 0 60 60" style="display: block;"><circle cx="30" cy="30" r="27" fill="none" stroke="rgba(255, 255, 255, 0.25)"/>`
		+ `<path d="M30 17 C34 22 34 36 33 42 L27 42 C26 36 26 22 30 17 Z" fill="rgba(255, 255, 255, 0.75)"/>`
		+ arrow(s.trueAngle, 14, '#ffffff') + arrow(s.apparentAngle, 10, '#f2c46d') + `</svg>`;
}
// (a boat sailed somewhere else has no wind sums here: its speed is worked out from how it moves, the wind from the weather)
function followedStats(b) {
	const s = b.stats;
	s.speed = unrotate(b.q, b.v)[2];
	const wind = trueWind(b), tw = unrotate(b.q, wind), app = sub(tw, unrotate(b.q, b.v));
	s.trueWind = len(wind);
	s.trueAngle = Math.atan2(-tw[0], -tw[2]);
	s.apparentWind = Math.hypot(app[0], app[2]);
	s.apparentAngle = Math.atan2(-app[0], -app[2]);
}
function showPanel(b) {
	if (!sailedHere(b)) followedStats(b);
	const s = b.stats, vessel = b.vessel;
	const anchor = b.anchor ? (b.anchor.holding ? 'down' : 'hanging') : 'up';
	const message = b.messageAge < 2.5 ? b.message : '';
	const key = [b.id, knots(s.speed).toFixed(1), knots(s.trueWind).toFixed(0), knots(s.apparentWind).toFixed(0), (s.apparentAngle * 20).toFixed(0), (s.trueAngle * 20).toFixed(0),
		...b.sails.map((x) => `${x.hoist.toFixed(2)},${x.sheet.toFixed(2)},${x.shake > 0.5}`), b.rudder.toFixed(2), anchor, message].join('|');
	if (key == panelShown) return;
	panelShown = key;
	const label = 'font-size: 10px; letter-spacing: 0.08em; color: rgba(232, 232, 232, 0.6);';
	const rows = vessel.sails.map((sail, i) => {
		const x = b.sails[i];
		return `<div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;"><div style="width: 64px; color: rgba(232, 232, 232, ${x.hoist > 0.02 ? 0.85 : 0.45}); font-size: 11px;">${sail.name}${x.shake > 0.5 ? ' ~' : ''}</div>${bar(x.hoist)}${bar(x.sheet)}</div>`;
	}).join('');
	panel.innerHTML =
		`<div style="display: flex; align-items: center; gap: 12px;">${windDial(s)}<div>`
		+ `<div style="font-size: 26px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums;">${Math.abs(knots(s.speed)).toFixed(1)}<span style="font-size: 12px; font-weight: 400; margin-left: 3px;">kn</span></div>`
		+ `<div style="${label} margin-top: 4px;">WIND ${knots(s.trueWind).toFixed(0)} KN</div><div style="${label} color: #f2c46d;">APPARENT ${knots(s.apparentWind).toFixed(0)} KN</div></div></div>`
		+ `<div style="display: flex; gap: 6px; margin-top: 8px; ${label}"><div style="width: 64px;"></div><div style="flex: 1;">${vessel.sails.some((x) => x.fixed) ? 'SET' : 'HOISTED'}</div><div style="flex: 1;">TRIM</div></div>`
		+ rows
		+ `<div style="display: flex; align-items: center; gap: 6px; margin-top: 6px;"><div style="width: 64px; color: rgba(232, 232, 232, 0.85); font-size: 11px;">${vessel.helm.tiller == 'wheel' ? 'Wheel' : 'Tiller'}</div>${bar(-b.rudder / vessel.rudder.most, true)}</div>`
		+ `<div style="margin-top: 7px; font-size: 11px; letter-spacing: 0.08em; font-weight: 600;">ANCHOR ${anchor.toUpperCase()}</div>`
		+ (message ? `<div style="margin-top: 3px; color: #f2c46d;">${message}</div>` : '');
}

// Drawing them
//-------------------------------------------------
const UNIFORM_FLOATS = 64 + MAX_GROUPS * 16 + MAX_ROPES * 8;
const boatShaderModule = device.createShaderModule({ label: "vf_boat", code: vf_boat });
const meshBuffers = {};
for (const [name, v] of Object.entries(VESSELS)) {
	meshBuffers[name] = device.createBuffer({ label: `boat mesh ${name}`, size: v.mesh.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	device.queue.writeBuffer(meshBuffers[name], 0, v.mesh);
}
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const boatPipeline = device.createRenderPipeline({
	label: "boat pipeline",
	layout: 'auto',
	vertex: {
		module: boatShaderModule,
		entryPoint: "vertexMain",
		buffers: [{ arrayStride: 48, attributes: [
			{ format: "float32x4", offset: 0, shaderLocation: 0 },
			{ format: "float32x4", offset: 16, shaderLocation: 1 },
			{ format: "float32x4", offset: 32, shaderLocation: 2 },
		] }],
	},
	fragment: { module: boatShaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
});

// one boat's uniforms (each has its own buffer: they are all written before the pass is sent)
function writeBoatUniforms(b) {
	const m = metre();
	const V = b.vessel;
	if (!b.gpu) b.gpu = { buffer: device.createBuffer({ label: `boat Uniform ${b.id}`, size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), bindGroup: null, lut: null };
	// the boat's metres into the world: about its centre of mass, turned, made world units
	const turn = mat4.fromQuat([b.q[1], b.q[2], b.q[3], b.q[0]]);
	let model = mat4.translation(scale(b.p, m));
	model = mat4.scale(model, [m, m, m]);
	model = mat4.multiply(model, turn);
	model = mat4.translate(model, scale(b.centre, -1));

	const u = new Float32Array(UNIFORM_FLOATS);
	u.set(transformations.getViewProj(), 0);
	u.set([settings.camPosX, settings.camPosY, settings.camPosZ, b.time], 16);
	u.set([settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, b.hovered, b.anchor ? 1 : 0], 20);
	u.set(model, 24);
	const P = V.paint;
	u.set([...P.top, P.bottomY], 40);
	u.set([...P.band, P.bandY[0]], 44);
	u.set([...P.bottom, P.bandY[1]], 48);
	u.set([...P.inside, 0], 52);
	u.set(P.ports ? [P.ports.z0, P.ports.spacing, P.ports.count, P.ports.half] : [0, 1, 0, 0], 56);
	// the groups: where each turns about, how far, and how its sail is hoisted, filled and shaking
	V.groups.forEach((group, g) => {
		const o = 64 + g * 16;
		const s = group.kind == 'sail' ? b.sails[group.sail] : null;
		u.set([...group.pivot, group.mode ?? 0], o);
		u.set([...unit(group.axis), groupAngle(b, g)], o + 4);
		u.set([s ? s.hoist : 1, s ? s.fill : 0, s ? s.shake : 0, group.chord ?? 0], o + 8);
		u.set([...(group.ref ?? [0, 0, 0]), group.taper ?? 0], o + 12);
	});
	// the ropes' ends: a sheet from where its sail is now to the block or cleat on the side it is on, the rode down to the anchor
	V.ropes.forEach((rope, r) => {
		const o = 64 + MAX_GROUPS * 16 + r * 8;
		let a, c, sag = rope.sag;
		if (rope.rode) {
			a = V.bow;
			c = b.anchor ? toLocal(b, [b.anchor.x, b.anchor.y, b.anchor.z]) : V.bow;
		} else {
			a = placeOnBoat(b, rope.from, rope.group, rope.role);
			c = rope.to.length == 1 ? rope.to[0] : rope.to[a[0] >= 0 ? 0 : 1];
		}
		u.set([...a, sag], o);
		u.set([...c, 0], o + 4);
	});
	device.queue.writeBuffer(b.gpu.buffer, 0, u);

	if (!b.gpu.bindGroup || b.gpu.lut !== skyViewLUTtexture) {
		b.gpu.lut = skyViewLUTtexture;
		b.gpu.bindGroup = device.createBindGroup({
			label: "boat bind group",
			layout: boatPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: b.gpu.buffer } },
				{ binding: 1, resource: { buffer: uniformBufferLights } },
				{ binding: 2, resource: skyViewLUTtexture.createView() },
				{ binding: 3, resource: linSampler },
			],
		});
	}
}

// with the solid things
export function boatPass(aEncoder, mainpassDepthTexture) {
	if (boats.length == 0 || !settings.enableWater) return;
	for (const b of boats) writeBoatUniforms(b);
	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Boats', 'vf_boat'),
	});
	pass.setPipeline(boatPipeline);
	for (const b of boats) {
		pass.setBindGroup(0, b.gpu.bindGroup);
		pass.setVertexBuffer(0, meshBuffers[b.vessel.name]);
		pass.draw(b.vessel.mesh.length / 12, 1, 0, 0);
	}
	pass.end();
}
