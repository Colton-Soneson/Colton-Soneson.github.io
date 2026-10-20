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
	SAILING: a vessel to sail (vessels.js: the dinghy, something like an RS Quest, or the schooner, something like HMS Pickle).
	In the Sailing game mode (settings.gameMode) the one settings.sailingVessel names is put in the sea offshore, with the
	player at the helm (hunting.js walks the player about on it, climbs its ladder, takes the helm and lets it go, and works
	the controls through this file). It is made so it can be put in the Hunting game mode as well.

	FLOATING. The water's surface is only known on the GPU (the waves are made there). So the water is asked (water.js,
	setWaterProbes) for its height and its slope under the vessel's COLUMNS: places under the hull, each standing for a piece
	of it. The answers come back a frame or two later, so each is moved on to where the column is now along the slope it had,
	and on in time at the rate it was rising. A column pushes up with the weight of the water it puts aside (Archimedes): the
	hull's sections are a V near the keel, so it puts aside more and more water the deeper it goes. It pushes along the
	water's normal, not straight up: on the face of a wave the boat is pushed down it. And it is damped, against the water
	rising and falling, or the boat would bounce for ever.

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
*/
const RHO_WATER = 1025;				// kg per cubic metre
const RHO_AIR = 1.225;
const GRAVITY = 9.81;
const CREW_MASS = 85;
const SUBSTEP = 1 / 120;			// seconds: the boat is moved in steps no longer than this
const REACH = 3.2;					// metres from the eye a control can be worked from

// The vessel, and how it is now
//-------------------------------------------------
let vessel = VESSELS.Dinghy;
// in metres, in the world's directions. q turns the boat's own directions into the world's (x to port, y up, z to the bow)
const boat = {
	exists: false,
	p: [0, 0, 0], v: [0, 0, 0],		// its centre of mass, and how fast that goes
	q: [1, 0, 0, 0], w: [0, 0, 0],	// which way it is turned (w, x, y, z), and how fast it turns (radians a second, about the world's axes)
	centre: [0, 0, 0],				// where on it the centre of mass is (it moves with the crew)
	sails: [],						// each sail: { hoist (0 to 1), sheet (0 all out to 1 all in), angle (out to port, radians), fill, shake,
									//		and how far up and in it is wanted (hoistWant, sheetWant: it gets there at the vessel's pace) }
	rudder: 0,						// over to port (the bow goes to port), radians
	anchor: null,					// down: { x, y, z (on the bottom, metres), rode (metres let out), holding }
	hovered: -1,					// the control the crosshair is on
	time: 0,
	rising: [],						// each column's water: the last height that came back (metres), when, and how fast it was rising
	message: '', messageAge: 99,
};
export const boatStats = { vessel: '', triangles: 0, speed: 0, heel: 0, trueWind: 0, apparentWind: 0, apparentAngle: 0, trueAngle: 0, attacks: [], driveAhead: 0, wet: 0, probesBack: 0, aground: false,
	bowFreeboard: 0 };	// (how far the deck at the bow is over the water there, metres: under it with green water on the foredeck)

const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / (len(a) || 1));

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
const toWorldMetres = (local) => add(boat.p, rotate(boat.q, sub(local, boat.centre)));
const toLocal = (worldMetres) => add(unrotate(boat.q, sub(worldMetres, boat.p)), boat.centre);
// how fast a place on the boat is going (metres a second)
const velocityAt = (local) => add(boat.v, cross(boat.w, rotate(boat.q, sub(local, boat.centre))));

// A group (see vessels.js): how far it is turned, and hoisted
function groupAngle(g) {
	const group = vessel.groups[g];
	if (group.kind == 'rudder') return boat.rudder;
	if (group.kind == 'wheel') return boat.rudder * group.turns;
	return boat.sails[group.sail].angle;
}
function groupHoist(g) {
	const group = vessel.groups[g];
	return group.kind == 'sail' ? boat.sails[group.sail].hoist : 1;
}
// where a point of the mesh is now, moved as vf_boat.js moves it (all but the curve of a sail's cloth)
function placeOnBoat(p, g, role) {
	if (g < 0) return p;
	const group = vessel.groups[g];
	let q = [...p];
	if (role == ROLE.CLOTH || role == ROLE.HOISTED) {
		const h = groupHoist(g);
		if (group.mode == 1) q = add(group.ref, scale(sub(q, group.ref), h));
		else q[1] = group.ref[1] + (q[1] - group.ref[1]) * h;
	}
	return add(group.pivot, turnAbout(sub(q, group.pivot), unit(group.axis), -groupAngle(g)));
}

// The water, from the probes (see FLOATING at the top)
//-------------------------------------------------
// the volume a column puts aside, sunk d metres
const sunkVolume = (column, d) => d <= 0 ? 0 : column.area * (d < vessel.vDepth ? d * d / (2 * vessel.vDepth) : d - vessel.vDepth / 2);

// ask the water about each column, where it is now (world units)
function askWater() {
	const m = metre();
	water.setWaterProbes(vessel.columns.map((c) => {
		const at = toWorldMetres([c.x, c.bottom, c.z]);
		return [at[0] * m, at[2] * m];
	}));
}

// what came back: each column's water as a height and a slope at the place it was asked about, moved on in time as it was rising
let lastProbeFrames = -1;
function readWater(now) {
	const m = metre();
	const probes = water.waterProbes;
	const fresh = probes.frames != lastProbeFrames && probes.count >= vessel.columns.length && settings.enableWater;
	if (!fresh) return;
	lastProbeFrames = probes.frames;
	for (let i = 0; i < vessel.columns.length; i++) {
		const d = probes.data, o = i * 8;
		const height = d[o + 2] / m, ny = Math.max(d[o + 4], 0.2);
		const was = boat.rising[i];
		const rate = was ? clamp((height - was.height) / Math.max((now - was.at) / 1000, 0.008), -6, 6) : 0;
		boat.rising[i] = { x: d[o] / m, z: d[o + 1] / m, height, slopeX: -d[o + 3] / ny, slopeZ: -d[o + 5] / ny, normal: [d[o + 3], ny, d[o + 5]], at: now, rate: was ? was.rate + (rate - was.rate) * 0.5 : 0 };
	}
}

// the water's height at column i, at world (x, z) metres, now. Flat still water before anything has come back
function waterUnder(i, x, z, now) {
	const r = boat.rising[i];
	const still = settings.waterWorldPosY / metre();
	if (!r || !settings.enableWater) return { height: still, normal: [0, 1, 0], rate: 0 };
	const ahead = Math.min((now - r.at) / 1000, 0.2);
	return { height: r.height + r.slopeX * (x - r.x) + r.slopeZ * (z - r.z) + r.rate * ahead, normal: r.normal, rate: r.rate };
}

// The wind (see SAILING at the top)
//-------------------------------------------------
// the true wind at the boat, metres a second along x and z: the wind over the sea, gusting
function trueWind() {
	const m = metre();
	const dir = settings.windDirection, length = Math.hypot(dir[0], dir[1]) || 1;
	const speed = settings.waterOceanWindSpeed * weatherNow.wind;
	const gust = windAtPoint(boat.p[0] * m, boat.p[2] * m)[2];
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
function sailForce(i, apparent, dt) {
	const sail = vessel.sails[i], s = boat.sails[i];
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
function foilForce(local, angle, area, wetness, scull = 0) {
	const v = unrotate(boat.q, velocityAt(local));
	if (scull > 0 && Math.abs(v[2]) < scull) v[2] = scull;
	const chord = [-Math.sin(angle), 0, Math.cos(angle)], normal = [Math.cos(angle), 0, Math.sin(angle)];
	const across = dot(v, normal), along = dot(v, chord);
	const speed2 = across * across + along * along;
	if (speed2 < 1e-6) return [0, 0, 0];
	const attack = Math.atan2(across, Math.abs(along));
	const push = clamp(2 * Math.PI * Math.sin(attack), -1.3, 1.3);
	const f = -0.5 * RHO_WATER * speed2 * area * push * wetness;
	return rotate(boat.q, [normal[0] * f, 0, normal[2] * f]);
}

// One step of the boat (see the top)
//-------------------------------------------------
let crewLocal = null;
function stepBoat(dt, now) {
	const m = metre();
	const V = vessel;
	// the centre of mass: the hull's, and the crew's where they are
	const mass = V.mass + (crewLocal ? CREW_MASS : 0);
	const centre = crewLocal ? scale(add(scale(V.centre, V.mass), scale(crewLocal, CREW_MASS)), 1 / mass) : V.centre;
	// (the crew moving about moves the centre of mass on the boat, not the boat)
	const moved = sub(centre, boat.centre);
	if (len(moved) > 0) {
		boat.p = add(boat.p, rotate(boat.q, moved));
		boat.centre = centre;
	}
	// how hard it is to turn about its own axes (x: pitch, y: yaw, z: roll), the crew's share as well
	const inertia = [...V.inertia];
	if (crewLocal) {
		const r = sub(crewLocal, centre);
		inertia[0] += CREW_MASS * (r[1] * r[1] + r[2] * r[2]);
		inertia[1] += CREW_MASS * (r[0] * r[0] + r[2] * r[2]);
		inertia[2] += CREW_MASS * (r[0] * r[0] + r[1] * r[1]);
	}

	let force = [0, -GRAVITY * mass, 0];
	let torque = [0, 0, 0];
	const push = (f, local) => {
		force = add(force, f);
		torque = add(torque, cross(rotate(boat.q, sub(local, boat.centre)), f));
	};
	const pushWorld = (f, worldPoint) => {
		force = add(force, f);
		torque = add(torque, cross(sub(worldPoint, boat.p), f));
	};
	const axisX = rotate(boat.q, [1, 0, 0]), axisY = rotate(boat.q, [0, 1, 0]), axisZ = rotate(boat.q, [0, 0, 1]);

	// floating: each column, as deep as it is in the water
	let wet = 0;
	const bowColumn = V.columns.length - 1;
	V.columns.forEach((c, i) => {
		const bottom = toWorldMetres([c.x, c.bottom, c.z]);
		const under = waterUnder(i, bottom[0], bottom[2], now);
		if (i == bowColumn) boatStats.bowFreeboard = toWorldMetres([c.x, c.top ?? V.columnTop, c.z])[1] - under.height;
		const d = clamp(under.height - bottom[1], 0, (c.top ?? V.columnTop) - c.bottom);
		if (d <= 0) return;
		const share = Math.min(d / V.vDepth, 1);
		wet += share / V.columns.length;
		const lift = RHO_WATER * GRAVITY * sunkVolume(c, d);
		const n = under.normal, nl = len(n);
		const at = [c.x, c.bottom + d * 0.5, c.z];
		const rising = velocityAt(at)[1] - under.rate;
		push([n[0] / nl * lift, n[1] / nl * lift - V.heaveDamping * c.area * share * rising, n[2] / nl * lift], at);
	});

	// the water: the hull dragging, the keel and the rudder
	const middle = V.keel.at;
	const v = unrotate(boat.q, velocityAt(middle));
	const ahead = v[2], sideways = v[0];
	const H = V.hullDrag, S = V.slip;
	const drag = -(H.linear * ahead + H.quadratic * ahead * Math.abs(ahead) + H.wave * Math.sign(ahead) * Math.max(Math.abs(ahead) - H.hullSpeed, 0) ** 2) * wet;
	const slip = -(S.linear * sideways + S.quadratic * sideways * Math.abs(sideways)) * wet;
	push(rotate(boat.q, [slip, 0, drag]), middle);
	push(foilForce(V.keel.at, 0, V.keel.area, wet), V.keel.at);
	push(foilForce(V.rudder.at, boat.rudder, V.rudder.area, wet, V.rudder.scull), V.rudder.at);
	// turning about its own axes is damped by the water too, yawing the more the faster it goes
	const spin = unrotate(boat.q, boat.w);
	const [ya, yb, yc] = V.damping.yaw;
	const yawDamp = -((ya + yb * Math.abs(ahead)) * spin[1] + yc * spin[1] * Math.abs(spin[1])) * Math.max(wet, 0.2);
	torque = add(torque, add(add(scale(axisY, yawDamp), scale(axisZ, -V.damping.roll * spin[2] * Math.max(wet, 0.2))), scale(axisX, -V.damping.pitch * spin[0] * Math.max(wet, 0.2))));

	// the sails
	const wind = trueWind();
	let driveAhead = 0;
	V.sails.forEach((sail, i) => {
		const at = placeOnBoat(sail.centre, sail.group, ROLE.CLOTH);
		const f = sailForce(i, unrotate(boat.q, sub(wind, velocityAt(at))), dt);
		push(rotate(boat.q, f), at);
		driveAhead += f[2];
	});

	// not over: past the heel limit pushed back up hard (and not up on its nose or its tail either)
	//		(heeled to starboard is turned + about the boat's z: back up is turning it - about it)
	const heel = Math.asin(clamp(axisX[1], -1, 1));		// + with the port side up: heeled to starboard
	if (Math.abs(heel) > V.heelLimit) torque = add(torque, scale(axisZ, -Math.sign(heel) * V.heelStiffness * (Math.abs(heel) - V.heelLimit) - V.heelDamping * spin[2]));
	const pitch = Math.asin(clamp(axisZ[1], -1, 1));
	if (Math.abs(pitch) > V.pitchLimit) torque = add(torque, scale(axisX, Math.sign(pitch) * V.pitchStiffness * (Math.abs(pitch) - V.pitchLimit)));

	// the anchor: the rode pulls the bow back towards it once it is tight
	if (boat.anchor && boat.anchor.holding) {
		const bow = toWorldMetres(V.bow);
		const reach = Math.sqrt(Math.max(boat.anchor.rode * boat.anchor.rode - (bow[1] - boat.anchor.y) ** 2, 1));
		const off = [bow[0] - boat.anchor.x, 0, bow[2] - boat.anchor.z];
		const distance = Math.hypot(off[0], off[2]);
		if (distance > reach) {
			// (a rope: it only pulls, damped both ways so the boat does not bounce off the end of it, and no harder than it holds)
			const toward = [-off[0] / distance, 0, -off[2] / distance];
			const vb = velocityAt(V.bow);
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
			const at = toWorldMetres(point);
			const ground = land.heightAt(at[0] * m, at[2] * m) / m;
			if (at[1] >= ground) continue;
			aground = true;
			const vp = velocityAt(point);
			const into = ground - at[1];
			pushWorld([-G.friction * vp[0], G.stiffness * into - G.damping * Math.min(vp[1], 0), -G.friction * vp[2]], at);
		}
	}
	for (const rock of nearRocks) {
		for (const point of V.hullRing) {
			const at = toWorldMetres(point);
			if (at[1] < rock.bottom || at[1] > rock.top) continue;
			const dx = at[0] - rock.x, dz = at[2] - rock.z, distance = Math.hypot(dx, dz);
			if (distance >= rock.radius || distance < 1e-4) continue;
			const out = [dx / distance, 0, dz / distance];
			const vp = velocityAt(point);
			pushWorld(scale(out, V.rockStiffness * (rock.radius - distance) - V.rockDamping * Math.min(dot(vp, out), 0)), at);
		}
	}

	// moved on
	boat.v = add(boat.v, scale(force, dt / mass));
	const t = unrotate(boat.q, torque);
	const turnBy = rotate(boat.q, [t[0] / inertia[0], t[1] / inertia[1], t[2] / inertia[2]]);
	boat.w = add(boat.w, scale(turnBy, dt));
	boat.p = add(boat.p, scale(boat.v, dt));
	const [qw, qx, qy, qz] = boat.q, [wx, wy, wz] = boat.w;
	const dq = [-wx * qx - wy * qy - wz * qz, wx * qw + wy * qz - wz * qy, wy * qw + wz * qx - wx * qz, wz * qw + wx * qy - wy * qx];
	boat.q = boat.q.map((c, k) => c + 0.5 * dq[k] * dt);
	const ql = Math.hypot(...boat.q);
	boat.q = boat.q.map((c) => c / ql);

	// not off the edge of the world
	const edge = settings.terrainWorldSize * 0.5 / m - 5;
	boat.p[0] = clamp(boat.p[0], -edge, edge);
	boat.p[2] = clamp(boat.p[2], -edge, edge);

	const mainAt = placeOnBoat(V.sails[V.mainSail].centre, V.sails[V.mainSail].group, ROLE.CLOTH);
	const apparent = unrotate(boat.q, sub(wind, velocityAt(mainAt)));
	const tw = unrotate(boat.q, wind);
	Object.assign(boatStats, {
		speed: unrotate(boat.q, boat.v)[2], heel, wet, aground, driveAhead,
		trueWind: len(wind), apparentWind: Math.hypot(apparent[0], apparent[2]),
		apparentAngle: Math.atan2(-apparent[0], -apparent[2]),		// where the apparent wind comes from: 0 dead ahead, + from port
		trueAngle: Math.atan2(-tw[0], -tw[2]),
		attacks: boat.sails.map((s) => s.attack ?? 0),
	});
}

let nearRocks = [];
function gatherRocks() {
	nearRocks = [];
	if (!settings.enableBoulders) return;
	const m = metre();
	boulders.bouldersNear(boat.p[0] * m, boat.p[2] * m, vessel.rockReach * m, (x, z, half, bottom, top) => {
		nearRocks.push({ x: x / m, z: z / m, radius: half / m, bottom: bottom / m, top: top / m });
	});
}

// Putting it in the sea
//-------------------------------------------------
// somewhere offshore near (x, z) world units: open sea deep enough for the vessel (and not more than 60 metres deep, to anchor
//		in), with no land or shallows close round it
function offshoreSpot(x, z) {
	const land = terrain.land;
	const m = metre();
	if (!land || !settings.enableTerrain) return [x, z];
	const sea = settings.waterWorldPosY;
	const half = settings.terrainWorldSize * 0.5 - 60 * m;
	const want = vessel.spawn;
	const lakeAt = (px, pz) => {
		const i = Math.round((px + settings.terrainWorldSize * 0.5) / land.cellSize), j = Math.round((pz + settings.terrainWorldSize * 0.5) / land.cellSize);
		return land.lakes && land.lakes[clamp(j, 0, land.points - 1) * land.points + clamp(i, 0, land.points - 1)] > 0.5;
	};
	const deep = (px, pz, least) => (sea - land.heightAt(px, pz)) / m >= least;
	for (const radius of [100, 160, 240, 340, 480, 650, 900, 1200]) {
		for (let k = 0; k < 32; k++) {
			const a = k / 32 * Math.PI * 2;
			const px = x + Math.cos(a) * radius * m, pz = z + Math.sin(a) * radius * m;
			if (Math.abs(px) > half || Math.abs(pz) > half) continue;
			const depth = (sea - land.heightAt(px, pz)) / m;
			if (depth < want.depth || depth > 60 || lakeAt(px, pz)) continue;
			let clear = true;
			for (let n = 0; n < 8 && clear; n++) {
				const b = n / 8 * Math.PI * 2;
				clear = deep(px + Math.cos(b) * want.clear * m, pz + Math.sin(b) * want.clear * m, want.clearDepth);
			}
			if (clear) return [px, pz];
		}
	}
	return [x, z];
}

// a new boat (the vessel named, settings.sailingVessel if none is) at (x, z) world units, still, 50 degrees off the wind with its
//		sails as the vessel starts them and their sheets let all the way out: they stream out along the wind (luffing), and it sits
//		there until they are pulled in
export function spawnBoat(x, z, name = settings.sailingVessel) {
	vessel = VESSELS[name] ?? VESSELS.Dinghy;
	const m = metre();
	const dir = settings.windDirection, length = Math.hypot(dir[0], dir[1]) || 1;
	const wind = [dir[0] / length, dir[1] / length];
	const off = Math.PI - 50 * Math.PI / 180;	// from the way the wind blows to 50 degrees off where it comes from
	const ahead = [wind[0] * Math.cos(off) - wind[1] * Math.sin(off), wind[0] * Math.sin(off) + wind[1] * Math.cos(off)];
	const yaw = Math.atan2(ahead[0], ahead[1]);		// turned about y from +z
	boat.q = [Math.cos(yaw / 2), 0, Math.sin(yaw / 2), 0];
	boat.centre = [...vessel.centre];
	boat.p = add([x / m, 0, z / m], rotate(boat.q, boat.centre));
	boat.p[1] = settings.waterWorldPosY / m - vessel.spawn.draft + boat.centre[1];
	boat.v = [0, 0, 0];
	boat.w = [0, 0, 0];
	boat.sails = vessel.sails.map((sail) => ({ hoist: sail.start.hoist, sheet: sail.start.sheet, hoistWant: sail.start.hoist, sheetWant: sail.start.sheet, angle: 0, fill: 0, shake: 0, attack: 0 }));
	Object.assign(boat, { exists: true, rudder: 0, anchor: null, rising: [], hovered: -1 });
	boatStats.vessel = vessel.name;
	boatStats.triangles = vessel.triangles;
	panelShown = '';
	gatherRocks();
}

// the boat put somewhere offshore near (x, z) world units
export function spawnBoatOffshore(x, z, name = settings.sailingVessel) {
	vessel = VESSELS[name] ?? VESSELS.Dinghy;
	const [px, pz] = offshoreSpot(x, z);
	spawnBoat(px, pz, name);
}

export function boatExists() {
	return boat.exists;
}
export function vesselName() {
	return boat.exists ? vessel.name : '';
}
export function removeBoat() {
	boat.exists = false;
	water.setWaterProbes([]);
}

// The shape of it, for walking about on it and bumping into it (hunting.js). Metres, on the boat
//-------------------------------------------------
// half the boat's width at its sheer, at z (0 off either end), and how high the top of its side is
export function halfBreadth(z) { return vessel.halfBreadth(z); }
export function sheerHeight(z) { return vessel.sheerHeight(z); }
// what a foot comes down on at (x, z): its deck, or whatever stands on it. null off the boat
export function deckHeight(x, z) { return vessel.deckHeight(x, z); }
// where the helm is: { at (where the player's feet are), eye (over that), seated, hike, hikeX, hikeOut, standAt }
export function helm() { return vessel.helm; }
// the ladder: { x, z, top, foot (in the water), over (the top of the side), inside (on deck), seconds (to climb) }
export function ladder() { return vessel.ladder; }

// The controls (see THE CONTROLS at the top)
//-------------------------------------------------
// the control the eye is looking at (eye and look in world units), within reach: { id, kind, sail, name, keys, value } or null.
//		usable(control): which of them count (one that cannot be used from where the eye is does not hide one behind it)
export function controlInView(eye, look, usable = () => true) {
	if (!boat.exists) return null;
	const m = metre();
	const eyeM = scale(eye, 1 / m);
	let best = null, bestAlong = Infinity;
	for (const control of vessel.controls) {
		if (!usable(control)) continue;
		const at = toWorldMetres(control.at);
		const to = sub(at, eyeM);
		const along = dot(to, look);
		if (along < 0 || along > REACH) continue;
		const off = len(sub(to, scale(look, along)));
		if (off < control.radius && along < bestAlong) {
			best = control;
			bestAlong = along;
		}
	}
	if (!best) return null;
	const s = boat.sails[best.sail];
	return { ...best, value: best.kind == 'halyard' ? s.hoist : best.kind == 'sheet' ? s.sheet : undefined,
		want: best.kind == 'halyard' ? s.hoistWant : best.kind == 'sheet' ? s.sheetWant : undefined };
}

// a control asked for further up or in (+) or down or out (-) by amount (the whole of it is 1): the scroll wheel
export function nudgeControl(control, amount) {
	const s = boat.sails[control.sail];
	if (!s) return;
	if (control.kind == 'halyard') s.hoistWant = clamp(s.hoistWant + amount, 0, 1);
	if (control.kind == 'sheet') s.sheetWant = clamp(s.sheetWant + amount, 0, 1);
}

// each sail hauled up or let down, and its sheet in or out, towards where it is wanted, at the vessel's pace
function haulRopes(dt) {
	const toward = (v, to, step) => v < to ? Math.min(v + step, to) : Math.max(v - step, to);
	for (const s of boat.sails) {
		s.hoist = toward(s.hoist, s.hoistWant, dt / vessel.halyardSeconds);
		s.sheet = toward(s.sheet, s.sheetWant, dt / vessel.sheetSeconds);
	}
}

// the tiller or the wheel: + to turn to port (A), - to starboard (D), for dt seconds. It stays where it is put
export function steer(direction, dt) {
	const R = vessel.rudder;
	boat.rudder = clamp(boat.rudder + direction * dt / R.seconds * R.most, -R.most, R.most);
}

// the anchor down, or up again
export function toggleAnchor() {
	if (!boat.exists) return;
	if (boat.anchor) {
		boat.anchor = null;
		say('Anchor up');
		return;
	}
	const m = metre();
	const bow = toWorldMetres(vessel.bow);
	const land = terrain.land;
	const bottom = land && settings.enableTerrain ? land.heightAt(bow[0] * m, bow[2] * m) / m : bow[1] - 1000;
	const depth = settings.waterWorldPosY / m - bottom;
	const most = vessel.anchor.rode;
	const rode = Math.min(most, 3 * depth + 2);
	const holding = depth < most - 2;
	boat.anchor = { x: bow[0], y: Math.max(bottom, bow[1] - most), z: bow[2], rode, holding };
	say(holding ? `Anchor down in ${depth.toFixed(0)} m` : `Too deep to anchor (${depth.toFixed(0)} m): it hangs`);
}

// who is on the boat: local, the middle of the crew (metres on the boat), or null with nobody on it
export function setCrew(local) {
	crewLocal = local;
}
// the control the crosshair is on (-1 for none), to light it up
export function setHovered(id) {
	boat.hovered = id;
}

function say(message) {
	boat.message = message;
	boat.messageAge = 0;
}

// where the boat is, for whoever is on it (hunting.js): its places into the world (world units) and back, how fast a place on it
//		goes (world units a second), its heading (radians, as settings.camYaw), its up, its heel
export const boatFrame = {
	toWorld(local) { return scale(toWorldMetres(local), metre()); },
	toLocal(world) { return toLocal(scale(world, 1 / metre())); },
	velocityAt(local) { return scale(velocityAt(local), metre()); },
	heading() { const f = rotate(boat.q, [0, 0, 1]); return Math.atan2(f[0], -f[2]); },
	up() { return rotate(boat.q, [0, 1, 0]); },
	directionToLocal(world) { return unrotate(boat.q, world); },
	directionToWorld(local) { return rotate(boat.q, local); },
	windwardSide() { return (boat.sails[vessel.mainSail]?.angle ?? 0) >= 0 ? -1 : 1; },	// which side the wind comes from: -1 starboard, +1 port (the main is out the other side)
};

// Per frame
//-------------------------------------------------
let lastTime = performance.now();
let rocksGatheredAt = 0;
export function boatUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	const on = boat.exists && settings.enableWater;
	panel.style.display = on && crewLocal ? '' : 'none';
	if (!on) {
		water.setWaterProbes([]);
		return;
	}
	readWater(now);
	if (now - rocksGatheredAt > 500) {
		gatherRocks();
		rocksGatheredAt = now;
	}
	haulRopes(elapsed);
	for (let left = elapsed; left > 1e-6; left -= SUBSTEP) stepBoat(Math.min(left, SUBSTEP), now);
	boat.time += elapsed;
	boat.messageAge += elapsed;
	boatStats.probesBack = water.waterProbes.frames;
	askWater();
	showPanel();
}

// for testing: the boat's state, and controls set straight ({ rudder, sails: [{ hoist, sheet }] })
export function boatState() {
	return { vessel: vessel.name, p: scale(boat.p, metre()), v: [...boat.v], q: [...boat.q], sails: boat.sails.map((s) => ({ ...s })), rudder: boat.rudder,
		anchor: boat.anchor && { ...boat.anchor }, stats: { ...boatStats }, heading: boatFrame.heading() };
}
export function setBoatControls(values) {
	if ('rudder' in values) boat.rudder = values.rudder;
	(values.sails ?? []).forEach((s, i) => {
		if (!boat.sails[i] || !s) return;
		Object.assign(boat.sails[i], s);
		if ('hoist' in s) boat.sails[i].hoistWant = s.hoist;
		if ('sheet' in s) boat.sails[i].sheetWant = s.sheet;
	});
}

// The panel, in the bottom right while on the boat
//-------------------------------------------------
const panel = document.createElement('div');
panel.style.cssText = 'position: fixed; right: 16px; bottom: 16px; z-index: 5; pointer-events: none; display: none; padding: 10px 14px; border-radius: 6px; background: rgba(0, 0, 0, 0.55); color: #e8e8e8; font-family: system-ui, sans-serif; font-size: 12px; user-select: none; width: 230px;';
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
function windDial() {
	const arrow = (angle, length, color) => {
		const x = 30 - Math.sin(angle) * 26, y = 30 - Math.cos(angle) * 26;
		const tx = 30 - Math.sin(angle) * (26 - length), ty = 30 - Math.cos(angle) * (26 - length);
		return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/><circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="2.4" fill="${color}"/>`;
	};
	return `<svg width="60" height="60" viewBox="0 0 60 60" style="display: block;"><circle cx="30" cy="30" r="27" fill="none" stroke="rgba(255, 255, 255, 0.25)"/>`
		+ `<path d="M30 17 C34 22 34 36 33 42 L27 42 C26 36 26 22 30 17 Z" fill="rgba(255, 255, 255, 0.75)"/>`
		+ arrow(boatStats.trueAngle, 14, '#ffffff') + arrow(boatStats.apparentAngle, 10, '#f2c46d') + `</svg>`;
}
function showPanel() {
	if (!crewLocal) return;
	const s = boatStats;
	const anchor = boat.anchor ? (boat.anchor.holding ? 'down' : 'hanging') : 'up';
	const message = boat.messageAge < 2.5 ? boat.message : '';
	const key = [knots(s.speed).toFixed(1), knots(s.trueWind).toFixed(0), knots(s.apparentWind).toFixed(0), (s.apparentAngle * 20).toFixed(0), (s.trueAngle * 20).toFixed(0),
		...boat.sails.map((x) => `${x.hoist.toFixed(2)},${x.sheet.toFixed(2)},${x.shake > 0.5}`), boat.rudder.toFixed(2), anchor, message].join('|');
	if (key == panelShown) return;
	panelShown = key;
	const label = 'font-size: 10px; letter-spacing: 0.08em; color: rgba(232, 232, 232, 0.6);';
	const rows = vessel.sails.map((sail, i) => {
		const x = boat.sails[i];
		return `<div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;"><div style="width: 64px; color: rgba(232, 232, 232, ${x.hoist > 0.02 ? 0.85 : 0.45}); font-size: 11px;">${sail.name}${x.shake > 0.5 ? ' ~' : ''}</div>${bar(x.hoist)}${bar(x.sheet)}</div>`;
	}).join('');
	panel.innerHTML =
		`<div style="display: flex; align-items: center; gap: 12px;">${windDial()}<div>`
		+ `<div style="font-size: 26px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums;">${Math.abs(knots(s.speed)).toFixed(1)}<span style="font-size: 12px; font-weight: 400; margin-left: 3px;">kn</span></div>`
		+ `<div style="${label} margin-top: 4px;">WIND ${knots(s.trueWind).toFixed(0)} KN</div><div style="${label} color: #f2c46d;">APPARENT ${knots(s.apparentWind).toFixed(0)} KN</div></div></div>`
		+ `<div style="display: flex; gap: 6px; margin-top: 8px; ${label}"><div style="width: 64px;"></div><div style="flex: 1;">${vessel.sails.some((x) => x.fixed) ? 'SET' : 'HOISTED'}</div><div style="flex: 1;">TRIM</div></div>`
		+ rows
		+ `<div style="display: flex; align-items: center; gap: 6px; margin-top: 6px;"><div style="width: 64px; color: rgba(232, 232, 232, 0.85); font-size: 11px;">${vessel.helm.tiller == 'wheel' ? 'Wheel' : 'Tiller'}</div>${bar(-boat.rudder / vessel.rudder.most, true)}</div>`
		+ `<div style="margin-top: 7px; font-size: 11px; letter-spacing: 0.08em; font-weight: 600;">ANCHOR ${anchor.toUpperCase()}</div>`
		+ (message ? `<div style="margin-top: 3px; color: #f2c46d;">${message}</div>` : '');
}

// Drawing it
//-------------------------------------------------
const UNIFORM_FLOATS = 64 + MAX_GROUPS * 16 + MAX_ROPES * 8;
const boatShaderModule = device.createShaderModule({ label: "vf_boat", code: vf_boat });
const meshBuffers = {};
for (const [name, v] of Object.entries(VESSELS)) {
	meshBuffers[name] = device.createBuffer({ label: `boat mesh ${name}`, size: v.mesh.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	device.queue.writeBuffer(meshBuffers[name], 0, v.mesh);
}
const boatUniformBuffer = device.createBuffer({ label: "boat Uniform", size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
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
let boatBindGroup = null, boundLUT = null;

// with the solid things
export function boatPass(aEncoder, mainpassDepthTexture) {
	if (!boat.exists || !settings.enableWater) return;
	const m = metre();
	// the boat's metres into the world: about its centre of mass, turned, made world units
	const turn = mat4.fromQuat([boat.q[1], boat.q[2], boat.q[3], boat.q[0]]);
	let model = mat4.translation(scale(boat.p, m));
	model = mat4.scale(model, [m, m, m]);
	model = mat4.multiply(model, turn);
	model = mat4.translate(model, scale(boat.centre, -1));

	const u = new Float32Array(UNIFORM_FLOATS);
	u.set(transformations.getViewProj(), 0);
	u.set([settings.camPosX, settings.camPosY, settings.camPosZ, boat.time], 16);
	u.set([settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, boat.hovered, boat.anchor ? 1 : 0], 20);
	u.set(model, 24);
	const P = vessel.paint;
	u.set([...P.top, P.bottomY], 40);
	u.set([...P.band, P.bandY[0]], 44);
	u.set([...P.bottom, P.bandY[1]], 48);
	u.set([...P.inside, 0], 52);
	u.set(P.ports ? [P.ports.z0, P.ports.spacing, P.ports.count, P.ports.half] : [0, 1, 0, 0], 56);
	// the groups: where each turns about, how far, and how its sail is hoisted, filled and shaking
	vessel.groups.forEach((group, g) => {
		const o = 64 + g * 16;
		const s = group.kind == 'sail' ? boat.sails[group.sail] : null;
		u.set([...group.pivot, group.mode ?? 0], o);
		u.set([...unit(group.axis), groupAngle(g)], o + 4);
		u.set([s ? s.hoist : 1, s ? s.fill : 0, s ? s.shake : 0, group.chord ?? 0], o + 8);
		u.set([...(group.ref ?? [0, 0, 0]), group.taper ?? 0], o + 12);
	});
	// the ropes' ends: a sheet from where its sail is now to the block or cleat on the side it is on, the rode down to the anchor
	vessel.ropes.forEach((rope, r) => {
		const o = 64 + MAX_GROUPS * 16 + r * 8;
		let a, b, sag = rope.sag;
		if (rope.rode) {
			a = vessel.bow;
			b = boat.anchor ? toLocal([boat.anchor.x, boat.anchor.y, boat.anchor.z]) : vessel.bow;
		} else {
			a = placeOnBoat(rope.from, rope.group, rope.role);
			b = rope.to.length == 1 ? rope.to[0] : rope.to[a[0] >= 0 ? 0 : 1];
		}
		u.set([...a, sag], o);
		u.set([...b, 0], o + 4);
	});
	device.queue.writeBuffer(boatUniformBuffer, 0, u);

	if (!boatBindGroup || boundLUT !== skyViewLUTtexture) {
		boundLUT = skyViewLUTtexture;
		boatBindGroup = device.createBindGroup({
			label: "boat bind group",
			layout: boatPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: boatUniformBuffer } },
				{ binding: 1, resource: { buffer: uniformBufferLights } },
				{ binding: 2, resource: skyViewLUTtexture.createView() },
				{ binding: 3, resource: linSampler },
			],
		});
	}
	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Boat', 'vf_boat'),
	});
	pass.setPipeline(boatPipeline);
	pass.setBindGroup(0, boatBindGroup);
	pass.setVertexBuffer(0, meshBuffers[vessel.name]);
	pass.draw(vessel.mesh.length / 12, 1, 0, 0);
	pass.end();
}
