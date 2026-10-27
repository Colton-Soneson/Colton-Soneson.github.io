import { DEPTH_FORMAT, depthTest, DEPTH_CLEAR } from './depthMode.js'
import {device} from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { vf_plane } from '../shaders/js/vf_plane.js'

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import { stripWeight } from './terrainGenerator.js'
import * as forest from './forest.js'
import * as boulders from './boulders.js'
import * as town from './town.js'
import * as boat from './boat.js'
import * as ballistics from './ballistics.js'
import * as wind from './wind.js'
import * as hunting from './hunting.js'
import * as players from './players.js'
import * as weapons from './weapons.js'
import * as lewis from './lewis.js'
import * as vm from './viewmodel.js'
import * as help from './controlsHelp.js'
import * as pointLights from './pointLights.js'
import { addChoice, announceSpawn } from './radialMenu.js'

//the planes fade into the horizon color, read from the sky view LUT (same as everything else)
import {skyViewLUTtexture} from './atmosphere.js'

//GET THE LIGHT CREATION OUT OF THE MAIN
import {uniformBufferLights} from './rotatingCube.js'

/*
	THE BIPLANE: a Bristol F.2b Fighter of 1918, two seats: the pilot in front, with a Vickers gun firing through the propeller, and
	behind him the gunner, standing, with a Lewis gun on a Scarff ring. From the spawn menu (Vehicles, Biplane): put on open level
	ground where the crosshair points, or, if there is none, at the end of the landing strip (terrainGenerator.js). One each.
	F at a cockpit, on foot, climbs into that seat (hunting.js: addRides); F again climbs out, on the ground (or the water) and stopped.

	THE PILOT
		the mouse			the stick (MOUSE_STICK): left and right to roll, back to pull the nose up and forward to push it down. It
							stays where it is put, easing back to the middle by itself (MOUSE_CENTRE), so a small move is a small
							turn and nothing twitches; a mark in the middle of the screen shows where it is
		W / S				the stick forward and back too: the nose down and up (the elevators), on top of the mouse's
		A / D				the stick left and right: roll (the ailerons, on all four wings)
		Q / E				the rudder: the nose left and right
		Alt (held)			look round (the mouse turns the head instead of the stick); let go, the view comes back to the front
		middle click		the Vickers gun (held), synchronised to fire between the propeller's blades, VICKERS_RATE rounds a second
							of its own round (ballistics.js: .303 Vickers, dropping less). Its sight on the cowling in front of the
							pilot: a ring, and a bead out along the gun, lined up with the eye (THE SIGHT)
		Alt + look + wheel	the controls in the cockpit, as the ropes on a boat (LEVERS). On the instrument board two knobs pulled
							out towards the pilot on their cables, as in a light aeroplane: on the left the throttle, on the right
							the mixture (red), each pushed in by the wheel going up (the throttle open, the mixture rich) and
							pulled out going down. On the left wall the pitch trim (up the wheel trims the nose up: TRIM) and
							under it the bomb release (up the wheel drops a set: THE BOMBS); on the right wall the parking brake
							(up the wheel to put it on) and under it the flaps (up the wheel lowers them a notch: FLAPS.notches).
							The crosshair on one says what it is and how far it is set
	THE TRIM: a share of the elevators' throw (TRIM, all the way over) held on top of the stick, so it flies level hands off.
	THE BOMBS (BOMBS): racks under the fuselage and either lower wing, a bomb on each. The release lever pulled drops the three of them,
		a moment apart, and springs back; the racks are loaded again from the plane's stores BOMBS.reload seconds later (the panel says
		so), BOMBS.sets times over before it has to land on the strip or have a supply pack for more. A bomb falls with the plane's own
		way on it (ballistics.js: its round, carried) and bursts where it lands as a howitzer's shell does (shipGuns.js: THE BURST)
	THE FLAPS: on the lower wing's trailing edge, inboard of the ailerons, let down (as far as the lever says, over FLAPS.seconds)
		they give more lift (FLAPS.lift: it flies slower before it stalls, for landing), more drag (FLAPS.drag) and push the nose down a
		little (FLAPS.nose)
	THE ENGINE, a Rolls-Royce Falcon: stopped until the throttle is opened with the mixture about right, when it catches (someone
	swings the propeller). Its power is the throttle's and the air's (thinner as it climbs: the density, DENSITY_HEIGHT) and the
	MIXTURE's: each height has its best (MIXTURE_BEST: full rich at the sea, leaner as it climbs), and the further off that the
	lever is the less power it makes. Well off (ROUGH) it runs rough and misfires, and far off (DIES) it stops, until the lever is
	put back and it catches again (with the propeller windmilling, or the throttle open). The mixture all the way lean and the
	throttle shut stops it. It burns its fuel as hard as it is run (FUEL_SECONDS at full power).
	THE GUNNER: the mouse aims the ring and the gun (wherever the gunner looks, all the way round), left click fires (held), right
		click along the sights, R a fresh pan (LEWIS_PANS of them aboard). Not through the plane's own wings and tail: the gun is held
		off them
	THE INSTRUMENTS (the pilot's, along the bottom): the whiskey compass's card, the engine's revolutions, the mixture (the lever
	against the best for the height), the fuel, and the angle of attack (with where the wings stall), and the airspeed and height.

	HOW IT FLIES: one rigid body, in metres and seconds (its own directions: +x its left wing, +y up, +z out of the nose, the origin at
	its centre of gravity), stepped STEP seconds at a time. Through the air (its velocity less the wind's: wind.js, gusting, its
	changes felt over WIND_EASE, slowed near the ground, GROUND_WIND, and stronger higher up, WIND_HEIGHT) the wings give lift and drag from their angle of attack (CL rising with it to the stall,
	STALL, and falling away past it), the fuselage and the fin push against a sideslip, and the propeller pulls (its power over
	its speed, up to STATIC_THRUST standing). The elevators, the ailerons and the rudder turn it, each as hard as the air on them is
	(and the propeller's wash on the tail, on the ground), and it is steady by itself: the tail keeps its nose into the airflow, the
	wings' dihedral levels them. On the ground it stands on its two wheels and its tail skid: springs into the ground, the wheels
	roll (and the brake holds them), the skid drags. Anything else that touches the ground (the nose, the wings, the tail) or a
	tree, a boulder or a house, or the wheels coming down too hard (CRASH_SINK), or the water: it is wrecked, and whoever is in it
	hurt or killed (by how hard it hit).
	A GENTLE LANDING (the throttle back under LANDING.throttle, within LANDING.over of the ground): the wheels may come down harder
	(LANDING.sink), and a wingtip, the tail or the nose that touches the ground going slowly and not hard (LANDING.scrape, LANDING.slow)
	scrapes along it instead, the airframe a little the worse for it (LANDING.wear a second).
	THE FLOATS (FLOATS): E at the wheels, on foot, with the plane down on the land and stopped, puts a pair of floats on in their
	place, and E at the floats the wheels back (not on the water). On the water it floats on them: each float a spring on the water
	(FLOATS.spring), dragged through it the more the deeper it rides, most at about FLOATS.hump (until it is up on them, planing),
	so it can take off from the water and land on it. It can still land on the land on them (they slide). They make it slower and
	turn less (FLOATS.drag: about 15% off its top speed; FLOATS.turn), and they are something more to hit. Floating slowly it is held level as the boats are (settings.boatSteadying:
	boat.js's THE STEADYING), less and less as it gathers speed (STEADY_FADE).
	SMOKE: shot about past half its HEALTH it trails smoke, more and more the worse it is, and flames too near the end (SMOKE).
	ON THE LANDING STRIP, stopped, with the parking brake on: it is refuelled, rearmed and repaired, RELOAD_SECONDS (a ring says how
	long).
	Or anywhere on the ground with a SUPPLY PACK (a weapon from the spawn menu, one at a time: a horse's saddlebags give one).

	THE MESH (PLANE_MESH): PLANE_TRIANGLES (no more than 4000), made with viewmodel.js's meshBuilder (part + 32 x material, the
	materials vf_plane.js's): the fuselage lofted from the radiator back to the tail, its two cockpits open, the cowling, the exhausts
	and the Vickers on top; the upper wing (cut out over the pilot) and the lower, each in two halves, their airfoil lofted out to
	rounded tips with dihedral, the ailerons on all four (PARTS.AILERON); the interplane and cabane struts and the bracing wires; the
	tailplane, the elevators, the fin and the rudder; the undercarriage's V struts, its axle and two wheels, the tail skid; the
	propeller and its blur; inside, the instrument board, the seat, the stick and the levers; and on the ring the Lewis gun (lewis.js).

	WHO FLIES IT (in a game with others, net.js): as a horse: its authority works its sums (the pilot, once in the seat), and the
	others draw it from its states, FOLLOW_DELAY behind. The gunner is wherever its own machine says, and fires from there.
*/
const STEP = 1 / 120;
const MASS = 1290;					// kg
const WING_AREA = 37.6;				// square metres, both wings
const CHORD = 1.68, SPAN = 11.9;
const INERTIA = [1900, 3400, 1700];	// kg m²: about its x (pitch), y (yaw) and z (roll)
const CL0 = 0.12, CL_ALPHA = 4.4, STALL = 0.27, CD0 = 0.039, INDUCED = 0.075;
const LIFT = 1.4;					// the wings' lift, times the airfoil's above (its drag as it was): more lift for the same angle
const CM0 = -0.015, CM_ALPHA = 0.55, CM_Q = -10, CM_ELEVATOR = -0.22;
const CL_BETA = 0.06, CL_AILERON = 0.09, CL_P = -0.5, CL_R = 0.05;
const CN_BETA = 0.06, CN_RUDDER = 0.045, CN_R = -0.14, CN_AILERON = 0.006;
const CY_BETA = -0.5;
const POWER = 410000, PROP_EFFICIENCY = 0.78, STATIC_THRUST = 6000;	// watts, -, newtons
const PROP_DISC = 6.6;				// square metres: the propeller's wash over the tail (the rudder and the elevators on the ground)
export const RPM_MAX = 1850, RPM_IDLE = 480;
const DENSITY_HEIGHT = 8500;		// metres
const MIXTURE_BEST = 2000;			// metres: full rich at the sea, all the way lean this high
const ROUGH = 0.28, DIES = 0.45;	// how far off the best the mixture is for the engine to run rough, and to stop
const FUEL_SECONDS = 420;			// a full tank at full power
const WIND_HEIGHT = 600;			// metres: the wind a third again as strong this high up
const WIND_EASE = 2.5;				// seconds a change in the wind takes to be felt
const GROUND_WIND = 0.4, LIFTED_WIND = 40;	// of the wind right by the ground, and metres over it before it is all of it
const CONTROL_RATE = 3.2;			// how fast the stick and the rudder follow the keys
const BRAKE = 0.75, BRAKE_FADE = 14;	// how hard the parking brake holds, stopped; and the metres a second rolling by which it has all but faded
const CRASH_SINK = 6.5;				// metres a second coming down on the wheels
// a gentle landing (see A GENTLE LANDING at the top): the throttle under this, within this many metres of the ground; the wheels may come
//		down this hard; a hard point coming down slower than scrape, going slower than slow, scrapes instead of wrecking it; health lost a
//		second scraping; how much harder the springs are damped (less bouncing)
const LANDING = { throttle: 0.15, over: 8, sink: 9.5, scrape: 4, slow: 32, wear: 4, damp: 1.6 };
// the floats (see THE FLOATS at the top): the drag of the airframe with them (times), the controls (times), each float point a spring
//		on the water (newtons a metre) and its damping, the water's drag along (times its push up), most at hump metres a second, and
//		on the land, sliding on them
const FLOATS = { drag: 1.63, turn: 0.85, spring: 7000, damp: 2600, water: 0.09, hump: 7, humpDrag: 0.2, land: 0.12 };
// the smoke (see SMOKE at the top): puffs a second at half health and at none, and the share of its health under which flames come too
const SMOKE = { least: 2, most: 16, flames: 0.2 };
const NEAR_SEATED = 0.3;			// metres: the camera's near plane in a cockpit (the nearest thing to the pilot's eye, the Aldis sight, is 0.45 m off;
								//		any nearer and, with the usual depth buffer, the far ground loses its depth: noise)
const LETHAL = 18;					// metres a second hitting the ground: no one gets up
const WRECK_SECONDS = 12;
const HEALTH = 60;					// how much shooting it takes: rifle rounds' hits (each round its damage, ballistics.ROUNDS)
const DEBRIS_SECONDS = 40;			// the pieces lie about this long
const GONE_SECONDS = 20;			// and the plane itself (which says it is in pieces, to the others) is taken away after this
const CHUTE_OVER = 12;				// metres over the ground: thrown out higher than this, the parachute opens
export const RELOAD_SECONDS = 20;
const VICKERS = 500, VICKERS_RATE = 11.6;	// rounds, and rounds a second (1.4 times the real gun's 8.3)
// the flaps (see THE FLAPS at the top): their notches (degrees), the lift and the drag let all the way down (to the wings' coefficients),
//		how much they push the nose down (to its pitching coefficient), and seconds from up to all the way down
const FLAPS = { notches: [0, 15, 30], lift: 0.3, drag: 0.035, nose: 0.02, seconds: 2.5 };
// the mouse's stick (see THE PILOT at the top): all the way over for this much the view would have turned (radians), and the seconds it
//		takes to ease most of the way back to the middle
const MOUSE_STICK = 0.3, MOUSE_CENTRE = 2.5;
const LOOK_BACK = 0.15;				// seconds for the view to come back to the front once Alt is let go
const LOOK_HOME = 0.03;				// radians: until the view is this near the front again the mouse does not move the stick
const TRIM = 0.3;					// of the elevators' throw, the trim all the way over
// THE BOMBS (see the top): the racks (where each bomb hangs, on the plane), the sets aboard, the seconds before the racks are full
//		again, seconds between the bombs of a set, and how long the lever stays pulled
const BOMBS = { racks: [[0, -0.86, 0.15], [1.7, -1.02, -0.05], [-1.7, -1.02, -0.05]], sets: 4, reload: 10, apart: 0.12, lever: 0.6 };
const LEVER_REACH = 0.1;			// metres off the line of sight a control's knob can be and still be the one looked at
const LEWIS_PANS = 6;
const FOLLOW_DELAY = 0.15;
const SPAWN_REACH = 90;				// metres
const REACH = 3.2;					// metres from the eye a seat or a lever is worked from
const LEVER_NOTCH = 0.05;			// of a lever's whole way, a notch of the wheel
export const MAX_PLANES = 24;		// (the War's twelve, up to twenty without the schooners, and the players')

const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const smooth = (v) => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };

// The mesh (see THE MESH at the top)
//-------------------------------------------------
export const PARTS = { BODY: 0, PROP: 1, BLUR: 2, AILERON: [3, 4, 5, 6], ELEVATOR: 7, RUDDER: 8, STICK: 9, THROTTLE: 10, MIXTURE: 11, BRAKE: 12, RING: 13, GUN: 14, PAN: 15, HIDDEN: 16, WING_L: 17, WING_R: 18, FLOATS: 19, WHEELS: 20, FLAP: [21, 22], FLAP_LEVER: 23, TRIM: 24, BOMB_LEVER: 25 };
const PART_COUNT = 26;
const M = { WOOD: 0, BLUED: 1, BRASS: 2, DARK: 9, WING: 20, FUSE: 21, COWL: 22, STRUT: 23, PROP: 24, RADIATOR: 25, TYRE: 26, LEATHER: 27, GLASS: 28, IRON: 29, RUDDER: 30, PANEL: 31, BLUR: 32, WIRE: 33, INSIDE: 34, SILK: 35, FIRE: 36, KNOB: 37, BOMB: 38 };
const HUB = [0, 0.05, 2.96];
// the floats: how far out from the middle each is, and their shape: [z, half width, keel, top] from the bow back
const FLOAT_X = 1.05;
const FLOAT_SHAPE = [[3.0, 0.03, -2.2, -2.0], [2.5, 0.24, -2.35, -1.9], [1.5, 0.31, -2.42, -1.85], [0.0, 0.32, -2.44, -1.85], [-1.2, 0.28, -2.37, -1.9], [-2.2, 0.14, -2.28, -1.98], [-2.6, 0.03, -2.22, -2.06]];
const PROP_RADIUS = 1.45;
const WINGS = [{ y: 1.05, le: 0.78, cut: true }, { y: -0.79, le: 0.48, cut: false }];	// the upper and the lower: the root's underside, its leading edge
const DIHEDRAL = 0.05;
const AILERON_SPAN = [3.42, 5.55], AILERON_HINGE = 0.78;
const FLAP_SPAN = [0.5, 3.3];			// along the lower wing (either side), hinged where the ailerons are
const PILOT_EYE = [0, 0.82, -0.42];
// THE SIGHT (the Vickers'): its ring (where along the plane, its radius) on a post off the gun's jacket, and its bead further out, each
//		as high as the pilot's eye and on the line the gun fires along (a little up: see pilotGun)
const SIGHT = { ring: 0.68, radius: 0.045, bead: 2.0 };
const RING = [0, 0.56, -1.52], RING_RADIUS = 0.45;
const MOUNT = [0, 0.84, -1.14];		// the top of the Scarff ring's arm (on the ring, turned with it)
const GUN_PIVOT = [0, -0.02, -0.04];	// where on the Lewis gun (in its own space) the mount holds it
const ELEVATOR_HINGE = [0.38, -4.85], RUDDER_HINGE = -4.95;
const STICK_FOOT = [0, -0.42, -0.3];
// the cockpit's controls (see THE PILOT at the top). The levers on the walls: where each turns, and how long it is (how far either way of
//		upright they go: LEVER_SWING, radians, along the plane: forward is +); the lower of each wall's two is shorter than the upper and
//		further back, so their knobs never meet. The knobs on the instrument board: where each comes out of it, and how far it pulls out
//		towards the pilot (pull)
const LEVERS = { trim: { at: [0.4, 0.1, -0.1], length: 0.17, part: PARTS.TRIM, name: 'Pitch trim', keys: 'Wheel: up trims the nose up, down trims it down' },
	bombs: { at: [0.4, -0.07, -0.22], length: 0.13, part: PARTS.BOMB_LEVER, name: 'Bomb release', keys: 'Wheel: up drops a set of three bombs' },
	brake: { at: [-0.4, 0.1, -0.1], length: 0.17, part: PARTS.BRAKE, name: 'Parking brake', keys: 'Wheel: up puts it on, down lets it off' },
	flaps: { at: [-0.4, -0.07, -0.22], length: 0.13, part: PARTS.FLAP_LEVER, name: 'Flaps', keys: 'Wheel: up lowers them a notch (0, 15, 30 degrees), down raises them' },
	throttle: { at: [0.2, 0.36, 0.03], pull: 0.09, part: PARTS.THROTTLE, name: 'Throttle', keys: 'Wheel: up pushes it in (open), down pulls it out (shut)' },
	mixture: { at: [-0.2, 0.36, 0.03], pull: 0.09, part: PARTS.MIXTURE, name: 'Mixture (choke)', keys: 'Wheel: up pushes it in (richer), down pulls it out (leaner)' } };
const LEVER_SWING = 0.6;
// the wing's airfoil: [along the chord, up (of the chord)] round from the leading edge, over the top to the trailing edge, back under
const AIRFOIL = [[0, 0], [0.07, 0.042], [0.3, 0.068], [0.65, 0.05], [1, 0.004], [0.65, -0.004], [0.3, -0.008], [0.07, -0.012]];

const PLANE_MESH = (() => {
	const m = vm.meshBuilder();
	const P = PARTS;
	// THE FUSELAGE: rings across it, [z, half width, bottom, top], from the radiator back to the tail post. The cockpits open in its top
	const FUSE = [[2.78, 0.4, -0.42, 0.44], [2.5, 0.44, -0.5, 0.48], [1.62, 0.45, -0.56, 0.5], [0.8, 0.45, -0.6, 0.52], [0.05, 0.45, -0.62, 0.52],
		[-0.7, 0.44, -0.62, 0.52], [-1.1, 0.43, -0.61, 0.51], [-1.95, 0.4, -0.58, 0.5], [-2.5, 0.37, -0.52, 0.48], [-3.6, 0.25, -0.3, 0.43],
		[-4.6, 0.12, -0.05, 0.37], [-5.0, 0.05, 0.12, 0.3]];
	const ring = ([z, hw, yb, yt]) => {
		const e1 = Math.min(0.05, hw * 0.3), e2 = Math.min(0.16, (yt - yb) * 0.3, hw * 0.6);
		return [[-hw + e1, yb, z], [hw - e1, yb, z], [hw, yb + e1, z], [hw, yt - e2, z], [hw - e2, yt, z], [-hw + e2, yt, z], [-hw, yt - e2, z], [-hw, yb + e1, z]];
	};
	// (the cowling to the end of the engine, the linen after; the cockpits, 4 and 6, open on top)
	for (let k = 0; k < FUSE.length - 1; k++) m.loft([ring(FUSE[k]), ring(FUSE[k + 1])], k < 2 ? M.COWL : M.FUSE, P.BODY, k == 0 ? [0] : k == FUSE.length - 2 ? [1] : [], k == 4 || k == 6 ? [3, 4, 5] : []);
	// the radiator's face over the front of it
	m.loft([ring(FUSE[0]).map(([x, y, z]) => [x * 0.9, y * 0.9 + 0.01, z + 0.005]), ring(FUSE[0]).map(([x, y, z]) => [x * 0.9, y * 0.9 + 0.01, z + 0.006])], M.RADIATOR, P.BODY, [1], [0, 1, 2, 3, 4, 5, 6, 7]);
	// the leather round the cockpits, the floors, the instrument board, the pilot's seat
	for (const [z0, z1] of [[0.05, -0.7], [-1.1, -1.95]]) {
		const y = 0.44, hw = 0.39;
		const corners = [[hw, y, z0], [-hw, y, z0], [-hw, y, z1], [hw, y, z1]];
		for (let k = 0; k < 4; k++) m.strut(corners[k], corners[(k + 1) % 4], 0.035, 0.035, 3, M.LEATHER);
		m.quad([hw, -0.45, z0], [-hw, -0.45, z0], [-hw, -0.45, z1], [hw, -0.45, z1], P.BODY, M.INSIDE);
	}
	m.quad([0.42, -0.1, 0.03], [-0.42, -0.1, 0.03], [-0.4, 0.46, 0.03], [0.4, 0.46, 0.03], P.BODY, M.PANEL);
	m.section(-0.62, [0.2, -0.42, -0.18], -0.42, [0.2, -0.42, -0.18], M.LEATHER, P.BODY, [0, 1]);
	// THE SIGHT (see SIGHT): the ring (12 pieces of it) on its post down to the gun, and the bead on its post
	const sightY = (z) => PILOT_EYE[1] + 0.004 * (z - PILOT_EYE[2]);
	for (let k = 0; k < 12; k++) {
		const a0 = k / 12 * Math.PI * 2, a1 = (k + 1) / 12 * Math.PI * 2, y = sightY(SIGHT.ring), r = SIGHT.radius;
		m.strut([Math.sin(a0) * r, y + Math.cos(a0) * r, SIGHT.ring], [Math.sin(a1) * r, y + Math.cos(a1) * r, SIGHT.ring], 0.003, 0.003, 3, M.BLUED);
	}
	m.strut([0, 0.597, SIGHT.ring], [0, sightY(SIGHT.ring) - SIGHT.radius, SIGHT.ring], 0.005, 0.004, 4, M.BLUED);
	m.strut([0, 0.597, SIGHT.bead], [0, sightY(SIGHT.bead) - 0.008, SIGHT.bead], 0.004, 0.003, 4, M.BLUED);
	m.ball([0, sightY(SIGHT.bead), SIGHT.bead], 0.009, 4, M.BRASS);
	// the windscreen and the Aldis sight along the top in front of the pilot
	m.quad([0.22, 0.5, 0.17], [-0.22, 0.5, 0.17], [-0.2, 0.72, 0.1], [0.2, 0.72, 0.1], P.BODY, M.GLASS);
	m.tube(0.16, 0.62, -0.05, 0.028, 0.55, 0.028, 6, M.BLUED, P.BODY, [0, 1]);
	// the Vickers on top of the cowling: its breech, the jacket round its barrel, the muzzle (44)
	m.section(0.12, [0.05, 0.5, 0.6], 0.5, [0.05, 0.5, 0.6], M.BLUED, P.BODY, [0, 1]);
	m.tube(0, 0.555, 0.5, 0.042, 2.22, 0.042, 8, M.BLUED);
	m.tube(0, 0.555, 2.22, 0.03, 2.34, 0.018, 8, M.BLUED);
	// the exhausts along either side of the cowling
	for (const s of [1, -1]) m.strut([s * 0.47, 0.22, 2.35], [s * 0.49, 0.15, 0.55], 0.035, 0.042, 4, M.IRON);

	// THE WINGS: each half lofted out from the middle through its stations, its airfoil laid out at each (its chord, the leading
	//		edge's z, the trailing edge cut back to how far along the chord). Then the ailerons
	const station = (wing, x, cutTo = 1, chordScale = 1, back = 0) => {
		const c = CHORD * chordScale, y = wing.y + Math.abs(x) * DIHEDRAL, le = wing.le - back;
		return AIRFOIL.map(([t, up]) => { const tt = t * cutTo; return [x, y + up * CHORD * (t == 1 ? 1 : 1) * chordScale, le - c * tt]; });
	};
	for (const wing of WINGS) {
		for (const s of [1, -1]) {
			const stations = [];
			if (wing.cut) stations.push(station(wing, 0, 0.7), station(wing, s * 0.6, 0.7), station(wing, s * 0.75));
			// (the lower's trailing edge cut back between FLAP_SPAN for the flaps)
			else stations.push(station(wing, 0), station(wing, s * FLAP_SPAN[0]), station(wing, s * FLAP_SPAN[0], AILERON_HINGE), station(wing, s * FLAP_SPAN[1], AILERON_HINGE), station(wing, s * FLAP_SPAN[1]));
			stations.push(station(wing, s * (AILERON_SPAN[0] - 0.04)), station(wing, s * AILERON_SPAN[0], AILERON_HINGE), station(wing, s * AILERON_SPAN[1], AILERON_HINGE),
				station(wing, s * 5.95, AILERON_HINGE * 0.95, 0.72, 0.12));
			m.loft(stations, M.WING, s > 0 ? P.WING_L : P.WING_R, [1]);
		}
	}
	// the flaps: the same, along the lower wing between FLAP_SPAN, left and right
	for (const [s, k] of [[1, 0], [-1, 1]]) {
		const wing = WINGS[1];
		const across = (x) => { const y = wing.y + Math.abs(x) * DIHEDRAL, z = wing.le - CHORD * AILERON_HINGE; return [[x, y + 0.03 * CHORD, z], [x, y + 0.004 * CHORD, wing.le - CHORD], [x, y - 0.004 * CHORD, z]]; };
		m.loft([across(s * FLAP_SPAN[0]), across(s * FLAP_SPAN[1])], M.WING, P.FLAP[k], [0, 1]);
	}
	// the ailerons: from the hinge to the trailing edge, upper left, upper right, lower left, lower right
	WINGS.forEach((wing, w) => {
		for (const [s, k] of [[1, 0], [-1, 1]]) {
			const across = (x) => { const y = wing.y + Math.abs(x) * DIHEDRAL, z = wing.le - CHORD * AILERON_HINGE; return [[x, y + 0.03 * CHORD, z], [x, y + 0.004 * CHORD, wing.le - CHORD], [x, y - 0.004 * CHORD, z]]; };
			m.loft([across(s * AILERON_SPAN[0]), across(s * AILERON_SPAN[1])], M.WING, P.AILERON[w * 2 + k], [0, 1]);
		}
	});
	// the struts: the cabane up from the fuselage to the upper wing, the interplane between the wings (two bays a side), and the wires
	//		bracing each bay across, front and back
	for (const s of [1, -1]) for (const z of [0.62, -0.45]) m.strut([s * 0.36, 0.5, z], [s * 0.42, WINGS[0].y + 0.42 * DIHEDRAL, z], 0.03, 0.03, 4, M.STRUT);
	const strutAt = (x, front, upper) => { const wing = WINGS[upper ? 0 : 1]; return [x, wing.y + Math.abs(x) * DIHEDRAL + (upper ? 0 : 0.06 * CHORD), wing.le - CHORD * (front ? 0.2 : 0.75)]; };
	for (const s of [1, -1]) {
		const side = s > 0 ? P.WING_L : P.WING_R;		// (the struts and wires of a side go with its wings)
		for (const x of [2.55, 5.0]) for (const front of [true, false]) m.strut(strutAt(s * x, front, false), strutAt(s * x, front, true), 0.032, 0.032, 4, M.STRUT, side);
		for (const [x0, x1] of [[0.45, 2.55], [2.55, 5.0]]) for (const front of [true, false]) {
			m.strut(strutAt(s * x0, front, false), strutAt(s * x1, front, true), 0.007, 0.007, 3, M.WIRE, side);
			m.strut(strutAt(s * x0, front, true), strutAt(s * x1, front, false), 0.007, 0.007, 3, M.WIRE, side);
		}
	}

	// THE TAIL: the tailplane on top of the fuselage, the elevators behind it, either side of the rudder; the fin and the rudder
	const tailplane = (x) => { const c = Math.abs(x) > 1.7 ? 0.45 : 0.6, y = ELEVATOR_HINGE[0]; return [[x, y, -4.25 - (0.6 - c)], [x, y + 0.035 * c * 1.4, -4.25 - (0.6 - c) - c * 0.35], [x, y, ELEVATOR_HINGE[1]], [x, y - 0.035 * c * 1.4, -4.25 - (0.6 - c) - c * 0.35]]; };
	m.loft([tailplane(1.8), tailplane(0.25), tailplane(-0.25), tailplane(-1.8)], M.WING, P.BODY, [0, 1]);
	for (const s of [1, -1]) {
		const across = (x) => { const y = ELEVATOR_HINGE[0]; return [[x, y + 0.012, ELEVATOR_HINGE[1]], [x, y, ELEVATOR_HINGE[1] - (Math.abs(x) > 1.6 ? 0.36 : 0.5)], [x, y - 0.012, ELEVATOR_HINGE[1]]]; };
		m.loft([across(s * 0.08), across(s * 1.85)], M.WING, P.ELEVATOR, [0, 1]);
	}
	m.prismX([[-4.35, 0.36], [RUDDER_HINGE, 0.36], [RUDDER_HINGE, 1.25], [-4.7, 1.22]], -0.03, 0.03, M.FUSE);
	m.prismX([[RUDDER_HINGE, 0.0], [-5.45, 0.06], [-5.6, 0.55], [-5.5, 1.05], [RUDDER_HINGE, 1.27]], -0.024, 0.024, M.RUDDER, P.RUDDER);
	m.strut([0, -0.02, -4.85], [0, -0.42, -5.2], 0.03, 0.025, 4, M.IRON);

	// THE UNDERCARRIAGE: the V struts down to the axle, the axle, the wheels (a tyre, and the linen over the spokes either side). All
	//		of it P.WHEELS: gone with the floats on
	for (const s of [1, -1]) for (const z of [1.0, 0.15]) m.strut([s * 0.3, -0.6, z], [s * 0.95, -1.3, 0.6], 0.03, 0.028, 4, M.STRUT, P.WHEELS);
	m.strut([0.98, -1.3, 0.6], [-0.98, -1.3, 0.6], 0.025, 0.025, 4, M.IRON, P.WHEELS);
	for (const s of [1, -1]) {
		const rim = (x) => m.ringAt([x, -1.3, 0.6], [0, 1, 0], [0, 0, 1], Array.from({ length: 12 }, (_, k) => { const a = (k + 0.5) / 12 * Math.PI * 2; return [Math.cos(a) * 0.33, Math.sin(a) * 0.33]; }));
		const inner = rim(s * 0.96), outer = rim(s * 1.08);
		m.loft([inner, outer], M.TYRE, P.WHEELS);
		for (const r of [inner, outer]) m.loft([r, r], M.FUSE, P.WHEELS, [0], Array.from({ length: 12 }, (_, k) => k));
	}
	// THE FLOATS (P.FLOATS: only with them on): a pair of long pontoons, a V under each, lofted from FLOAT_SHAPE, each on two struts
	//		up to the fuselage, and a spreader between them
	for (const s of [1, -1]) {
		const rings = FLOAT_SHAPE.map(([z, hw, bottom, top]) => {
			const x = s * FLOAT_X, mid = (bottom + top) / 2 + 0.04;
			return [[x, top, z], [x + hw * 0.8, top - 0.03, z], [x + hw, mid, z], [x, bottom, z], [x - hw, mid, z], [x - hw * 0.8, top - 0.03, z]];
		});
		m.loft(rings, M.FUSE, P.FLOATS, [0, 1]);
		for (const z of [1.1, -0.5]) m.strut([s * 0.3, -0.6, z], [s * FLOAT_X, -1.87, z + 0.15], 0.03, 0.028, 4, M.STRUT, P.FLOATS);
	}
	m.strut([FLOAT_X, -1.9, 0.2], [-FLOAT_X, -1.9, 0.2], 0.025, 0.025, 4, M.IRON, P.FLOATS);

	// THE PROPELLER: its boss (22), two blades lofted out from it, twisted (68), and its blur (22)
	m.tube(HUB[0], HUB[1], 2.78, 0.1, HUB[2] + 0.03, 0.07, 8, M.IRON, P.PROP, [1]);
	const BLADE = [[0.12, 0.14, 0.06], [0.4, 0.2, 0.04], [0.8, 0.18, 0.026], [1.15, 0.15, 0.018], [PROP_RADIUS, 0.07, 0.01]];
	for (const s of [1, -1]) {
		const rings = BLADE.map(([r, c, t]) => {
			const twist = Math.atan(2.4 / (2 * Math.PI * Math.max(r, 0.2)));
			const u = [Math.cos(twist) * c / 2, 0, Math.sin(twist) * c / 2], w = [-Math.sin(twist) * t / 2, 0, Math.cos(twist) * t / 2];
			const at = [HUB[0], HUB[1] + r, HUB[2]];
			return [[u[0], u[2]], [w[0], w[2]], [-u[0], -u[2]], [-w[0], -w[2]]].map(([x, z]) => [s * (at[0] + x), HUB[1] + s * (at[1] - HUB[1]), at[2] + z]);
		});
		m.loft(rings, M.PROP, P.PROP, [1]);
	}
	m.loft([0, 1].map(() => Array.from({ length: 24 }, (_, k) => { const a = k / 24 * Math.PI * 2; return [HUB[0] + Math.cos(a) * PROP_RADIUS, HUB[1] + Math.sin(a) * PROP_RADIUS, HUB[2] + 0.04]; })), M.BLUR, P.BLUR, [0], Array.from({ length: 24 }, (_, k) => k));

	// INSIDE THE PILOT'S COCKPIT: the stick (made standing straight up from its foot) and the levers (made standing straight up
	//		from where each turns: see partsNow)
	m.strut(STICK_FOOT, [STICK_FOOT[0], STICK_FOOT[1] + 0.5, STICK_FOOT[2]], 0.014, 0.012, 4, M.BLUED, P.STICK);
	m.ball([STICK_FOOT[0], STICK_FOOT[1] + 0.52, STICK_FOOT[2]], 0.03, 4, M.LEATHER, P.STICK);
	for (const lever of Object.values(LEVERS)) {
		if (lever.pull) {
			// a knob on the board: its bezel, and its shaft (long enough to be seen pulled all the way out) and its knob, made pushed in
			const [x, y, z] = lever.at;
			m.tube(x, y, z, 0.016, z - 0.006, 0.016, 8, M.BRASS, P.BODY, [1]);
			m.strut([x, y, z + lever.pull], [x, y, z - 0.03], 0.005, 0.005, 4, M.BLUED, lever.part);
			m.ball([x, y, z - 0.045], 0.019, 4, lever.part == P.MIXTURE ? M.KNOB : M.DARK, lever.part);
			continue;
		}
		m.strut(lever.at, [lever.at[0], lever.at[1] + lever.length, lever.at[2]], 0.008, 0.007, 4, M.BLUED, lever.part);
		m.ball([lever.at[0], lever.at[1] + lever.length + 0.018, lever.at[2]], 0.022, 4, lever.part == P.BRAKE ? M.BRASS : lever.part == P.BOMB_LEVER ? M.KNOB : M.WOOD, lever.part);
	}
	// (the walls the levers stand against)
	for (const s of [1, -1]) m.quad([s * 0.43, -0.1, 0.0], [s * 0.43, -0.1, -0.34], [s * 0.43, 0.2, -0.34], [s * 0.43, 0.2, 0.0], P.BODY, M.BLUED);

	// THE SCARFF RING round the gunner's cockpit (72) and its arm up to the gun (8), turned together; and the Lewis gun on it
	for (let k = 0; k < 12; k++) {
		const a0 = k / 12 * Math.PI * 2, a1 = (k + 1) / 12 * Math.PI * 2;
		m.strut([RING[0] + Math.sin(a0) * RING_RADIUS, RING[1], RING[2] + Math.cos(a0) * RING_RADIUS], [RING[0] + Math.sin(a1) * RING_RADIUS, RING[1], RING[2] + Math.cos(a1) * RING_RADIUS], 0.022, 0.022, 3, M.BLUED, P.RING);
	}
	m.strut([RING[0], RING[1], RING[2] + RING_RADIUS], MOUNT, 0.016, 0.016, 4, M.BLUED, P.RING);
	lewis.buildLewis(vm.remapParts(m, (part) => part == 1 ? P.PAN : part >= 4 ? P.HIDDEN : P.GUN));
	return { data: m.done(), triangles: m.count() };
})();
export const PLANE_TRIANGLES = PLANE_MESH.triangles;
const PLANE_VERTICES = PLANE_MESH.data.length / 4;

// where it touches the ground (see HOW IT FLIES): the wheels and the skid, and what must never touch
const GEAR = [{ at: [1.02, -1.63, 0.6], wheel: true }, { at: [-1.02, -1.63, 0.6], wheel: true }, { at: [0, -0.43, -5.2], wheel: false }];
// with the floats on: under each float, at its bow, its step and its stern
const FLOAT_GEAR = [1, -1].flatMap((s) => [[2.3, -2.3], [0.2, -2.43], [-1.9, -2.26]].map(([z, y]) => ({ at: [s * FLOAT_X, y, z], float: true })));
const HARD = [[0, 0.0, 2.85], [0, -0.62, -1.0], [0, 1.25, -5.0], [0, 0.36, -5.4], [5.95, WINGS[0].y + 0.3, -0.1], [-5.95, WINGS[0].y + 0.3, -0.1],
	[5.95, WINGS[1].y + 0.3, -0.4], [-5.95, WINGS[1].y + 0.3, -0.4], [0, HUB[1] - PROP_RADIUS + 0.05, HUB[2]], [3, WINGS[1].y + 0.15, -0.2], [-3, WINGS[1].y + 0.15, -0.2]];
// the seats: where the crosshair finds each from outside, where whoever is in it is (local, for the others: net.js), and their eye
export const SEATS = {
	pilot: { look: [0, 0.35, -0.35], radius: 0.6, at: [0, -0.3, -0.45], eye: PILOT_EYE, sit: 1, name: 'Pilot\'s seat', keys: 'F climb in' },
	gunner: { look: [0, 0.35, -1.5], radius: 0.6, at: [0, -0.45, -1.55], eye: [0, 1.15, -1.55], sit: 0, name: 'Gunner\'s ring', keys: 'F climb in' },
};
// bullets stop at it (and hurt it, see SHOT TO PIECES): spheres along the fuselage and the wings
const SPHERES = [[0, 0, 2.0, 0.6], [0, 0, 1.2, 0.65], [0, 0.05, 0.4, 0.7], [0, 0.05, -0.4, 0.7], [0, 0.05, -1.2, 0.65], [0, 0.05, -2.0, 0.6],
	[0, 0.1, -2.8, 0.5], [0, 0.2, -3.6, 0.45], [0, 0.4, -4.3, 0.45], [0, 0.6, -4.9, 0.5],
	...[1.5, 3.2, 4.9].flatMap((x) => [[x, WINGS[0].y + 0.1, 0.0, 0.55], [-x, WINGS[0].y + 0.1, 0.0, 0.55], [x, WINGS[1].y + 0.1, -0.3, 0.55], [-x, WINGS[1].y + 0.1, -0.3, 0.55]])];
// and with the floats on, along them too
const FLOAT_SPHERES = [1, -1].flatMap((s) => [2.1, 0.7, -0.7, -2.0].map((z) => [s * FLOAT_X, -2.15, z, 0.45]));

export const planeStats = { planes: 0, triangles: PLANE_TRIANGLES, drawn: 0, crashes: 0, reloads: 0, shots: 0, hits: 0, destroyed: 0, debris: 0, bombs: 0 };

// SHOT TO PIECES (see the top): the pieces it breaks into, each its parts, the middle it turns about (metres, on the plane), how it is
//		thrown (metres a second, on the plane), and how it falls: how fast it spins (radians a second about each axis, at the most), how much
//		the air holds it back (the wings flutter down, the fuselage drops), and how far its middle is off the ground lying there
const PIECES = [
	{ parts: [PARTS.BODY, PARTS.ELEVATOR, PARTS.RUDDER, PARTS.STICK, PARTS.THROTTLE, PARTS.MIXTURE, PARTS.BRAKE, PARTS.FLAP_LEVER, PARTS.TRIM, PARTS.BOMB_LEVER, PARTS.RING, PARTS.GUN, PARTS.PAN, PARTS.FLOATS, PARTS.WHEELS], centre: [0, 0, -1], kick: [0, -1, 0], scatter: 2, spin: [0.8, 0.6, 1.6], drag: 0.03, rest: 0.9 },
	{ parts: [PARTS.WING_L, PARTS.AILERON[0], PARTS.AILERON[2], PARTS.FLAP[0]], centre: [3, 0.15, -0.2], kick: [5, 3, 0], scatter: 3, spin: [2.5, 1.2, 3.5], drag: 0.9, rest: 0.6 },
	{ parts: [PARTS.WING_R, PARTS.AILERON[1], PARTS.AILERON[3], PARTS.FLAP[1]], centre: [-3, 0.15, -0.2], kick: [-5, 3, 0], scatter: 3, spin: [2.5, 1.2, 3.5], drag: 0.9, rest: 0.6 },
	{ parts: [PARTS.PROP], centre: HUB, kick: [0, 2, 6], scatter: 3, spin: [7, 7, 14], drag: 0.15, rest: 0.15 },
];

// Rotations: quaternions [x, y, z, w], the plane's own directions into the world's
//-------------------------------------------------
const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
function rotate(q, v) {
	const [x, y, z, w] = q;
	const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
	return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
const unrotate = (q, v) => rotate([-q[0], -q[1], -q[2], q[3]], v);
const normalizeQ = (q) => { const l = Math.hypot(...q) || 1; return q.map((v) => v / l); };
// from the plane's three directions in the world (left, up, forward)
function fromAxes(l, u, f) {
	const t = l[0] + u[1] + f[2];
	let q;
	if (t > 0) { const s = Math.sqrt(t + 1) * 2; q = [(u[2] - f[1]) / s, (f[0] - l[2]) / s, (l[1] - u[0]) / s, s / 4]; }
	else if (l[0] > u[1] && l[0] > f[2]) { const s = Math.sqrt(1 + l[0] - u[1] - f[2]) * 2; q = [s / 4, (u[0] + l[1]) / s, (f[0] + l[2]) / s, (u[2] - f[1]) / s]; }
	else if (u[1] > f[2]) { const s = Math.sqrt(1 + u[1] - l[0] - f[2]) * 2; q = [(u[0] + l[1]) / s, s / 4, (f[1] + u[2]) / s, (f[0] - l[2]) / s]; }
	else { const s = Math.sqrt(1 + f[2] - l[0] - u[1]) * 2; q = [(f[0] + l[2]) / s, (f[1] + u[2]) / s, s / 4, (l[1] - u[0]) / s]; }
	return normalizeQ(q);
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
function slerp(a, b, t) {
	let d = dot(a, b) + a[3] * b[3];
	const bb = d < 0 ? b.map((v) => -v) : b;
	d = Math.abs(d);
	if (d > 0.9995) return normalizeQ(a.map((v, k) => v + (bb[k] - v) * t));
	const th = Math.acos(d), s = Math.sin(th);
	return a.map((v, k) => (v * Math.sin((1 - t) * th) + bb[k] * Math.sin(t * th)) / s);
}

// The planes
//-------------------------------------------------
// each: { id, owner, authority, exists, p (its centre of gravity, metres in the world), q (its rotation), v (metres a second), w (its
//		turning, radians a second, about its own x, y, z), throttle, mixture (1 full rich), brake, engine { on, rpm, catching, cough },
//		fuel (0 to 1), vickers (rounds), flaps (the lever's notch, 0 to 2) and flap (how far down they are now, 0 to 1), trim (-1 nose down
//		to 1 nose up), bombs (sets aboard), bombWait (seconds before the racks are full again), bombLever (seconds it stays pulled),
//		dropping (the set going: the seconds to each of its bombs), controls { elevator, aileron, rudder } (-1 to 1, as the stick and the bar are), crew { pilot,
//		gunner } ('me', a player's number, or null), wreck (seconds since it crashed, or -1), reload (seconds parked on the strip, -1
//		done), supplied (how many times it has been), track, frame }
export const planes = [];
let localId = 0;
export function setLocalId(id) { localId = id; }
export const flownHere = (p) => p.authority === localId;
export const isMine = (p) => p.owner === localId;
let nextNumber = 1;

function makeFrame(p) {
	return {
		toWorld(local) { const r = rotate(p.q, local), m = metre(); return [(p.p[0] + r[0]) * m, (p.p[1] + r[1]) * m, (p.p[2] + r[2]) * m]; },
		toLocal(world) { const m = metre(); return unrotate(p.q, [world[0] / m - p.p[0], world[1] / m - p.p[1], world[2] / m - p.p[2]]); },
		heading() { const f = rotate(p.q, [0, 0, 1]); return Math.atan2(f[0], -f[2]); },	// (as settings.camYaw)
		up() { return rotate(p.q, [0, 1, 0]); },
		velocityAt(local) { const r = rotate(p.q, local), w = rotate(p.q, p.w), c = cross(w, r), m = metre(); return [(p.v[0] + c[0]) * m, (p.v[1] + c[1]) * m, (p.v[2] + c[2]) * m]; },
	};
}

// on the ground at (x, z) world units, facing heading (as settings.camYaw), sat on its wheels and its skid
function restingOn(x, z, heading) {
	const m = metre();
	const tilt = Math.atan2(GEAR[2].at[1] - GEAR[0].at[1], GEAR[0].at[2] - GEAR[2].at[2]);	// (its tail down on the skid)
	const f = [Math.sin(heading) * Math.cos(tilt), Math.sin(tilt), -Math.cos(heading) * Math.cos(tilt)];
	const u = norm(cross(f, cross([0, 1, 0], f))), l = norm(cross(u, f));
	const q = fromAxes(l, u, f);
	const ground = terrain.land ? terrain.land.groundAt(x, z) / m : 0;
	const wheel = rotate(q, GEAR[0].at);
	return { p: [x / m, ground - wheel[1] + 0.02, z / m], q };
}

export function spawnPlane(x, z, { heading = 0, owner = localId, id = null, authority = owner } = {}) {
	const rest = restingOn(x, z, heading);
	const p = { id: id ?? `${owner}:p${nextNumber++}`, owner, authority, exists: true, p: rest.p, q: rest.q, v: [0, 0, 0], w: [0, 0, 0],
		throttle: 0, mixture: 1, brake: true, engine: { on: false, rpm: 0, catching: 0, cough: 0, rough: 0, stopped: '' }, fuel: 1, vickers: VICKERS,
		controls: { elevator: 0, aileron: 0, rudder: 0 }, input: null, crew: { pilot: null, gunner: null }, wreck: -1, impact: 0, reload: 0, supplied: 0,
		health: HEALTH, destroyed: -1, floats: false, flaps: 0, flap: 0, trim: 0, bombs: BOMBS.sets, bombWait: 0, bombLever: 0, dropping: [], smokeDue: 0, prop: 0, track: [], ground: null, contacts: 0, alpha: 0, airspeed: 0, firing: false, since: 0, rear: { pan: lewis.PAN, spare: LEWIS_PANS, since: 0, changing: -1, turn: 0, cycle: 1, seen: 0 } };
	p.frame = makeFrame(p);
	if (planes.length >= MAX_PLANES) removePlane(planes.find((one) => !one.crew.pilot && !one.crew.gunner) ?? planes[0]);
	planes.push(p);
	return p;
}
export function removePlane(p) {
	const at = planes.indexOf(p);
	if (at < 0) return;
	planes.splice(at, 1);
	p.exists = false;
}
export const planeById = (id) => planes.find((p) => p.id === id) ?? null;

// a plane where the crosshair points (the spawn menu), or at the end of the landing strip: the player's own old one goes
export function spawnSpot(eye, look) {
	const land = terrain.land;
	if (!land || !settings.enableTerrain) return { reason: 'There is no land' };
	const m = metre();
	const heading = Math.atan2(look[0], -look[2]);
	for (let t = 1 * m; t <= SPAWN_REACH * m; t += 0.5 * m) {
		const x = eye[0] + look[0] * t, y = eye[1] + look[1] * t, z = eye[2] + look[2] * t;
		const ground = land.heightAt(x, z);
		if (y > ground && y > settings.waterWorldPosY) continue;
		if (ground < settings.waterWorldPosY + 0.5 * m) break;
		const step = 6 * m;
		const level = [[step, 0], [-step, 0], [0, step], [0, -step]].every(([dx, dz]) => Math.abs(land.heightAt(x + dx, z + dz) - ground) < 0.12 * step);
		let blocked = false;
		const near = 9 * m, near2 = near * near;
		const check = (tx, tz) => { if ((tx - x) ** 2 + (tz - z) ** 2 < near2) blocked = true; };
		if (settings.enableForest) forest.trunksNear(x, z, near, (tx, tz) => check(tx, tz));
		if (settings.enableBoulders) boulders.bouldersNear(x, z, near, (tx, tz) => check(tx, tz));
		town.boxesNear(x, z, near, (tx, tz) => check(tx, tz));
		if (level && !blocked) return { x, z, heading };
		break;
	}
	// the landing strip, facing along it from its end the player is nearer
	const s = land.strip;
	if (s) {
		const u = (eye[0] - s.x) * s.ax + (eye[2] - s.z) * s.az, end = u < 0 ? -1 : 1;
		const x = s.x + s.ax * end * (s.half - 12 * m), z = s.z + s.az * end * (s.half - 12 * m);
		return { x, z, heading: Math.atan2(-end * s.ax, end * s.az), strip: true };
	}
	return { reason: `Point at open, level ground within ${SPAWN_REACH} m` };
}
function bringPlane() {
	const spot = spawnSpot([settings.camPosX, settings.camPosY, settings.camPosZ], transformations.getCameraForward());
	if (spot.reason) { help.toast(spot.reason); return false; }
	for (const old of planes.filter((p) => isMine(p))) {
		if (old.crew.pilot === 'me' || old.crew.gunner === 'me') continue;
		removePlane(old);
		announceSpawn('plane', null, old);
	}
	const p = spawnPlane(spot.x, spot.z, { heading: spot.heading });
	announceSpawn('plane', p, null);
	help.toast(spot.strip ? 'Your biplane is waiting at the end of the landing strip' : 'A biplane: F at a cockpit to climb in', 3);
	return true;
}
addChoice('Vehicles', { label: 'Biplane', detail: 'A Bristol Fighter, two seats: pilot and gunner', act: bringPlane });

// The air (see HOW IT FLIES at the top)
//-------------------------------------------------
const seaLevel = () => settings.waterWorldPosY / metre();
const altitude = (p) => p.p[1] - seaLevel();
export const mixtureBest = (height) => clamp(1 - height / MIXTURE_BEST, 0.12, 1);
// the wind where it is, metres a second in the world: wind.js's, gusting, stronger higher up, a little up and down in it, and slowed by
//		the ground under it (GROUND_WIND: as much as it is right down on it, all of it LIFTED_WIND over it)
function windAt(p) {
	const m = metre();
	const [wx, wz, gust, flutter] = wind.windAtPoint(p.p[0] * m, p.p[2] * m);
	const l = Math.hypot(wx, wz) || 1;
	const over = p.p[1] - Math.max(groundAt(p, p.p[0], p.p[2]), seaLevel());
	const speed = wind.windSpeedNow() * (0.85 + 0.3 * gust) * (1 + 0.3 * clamp(altitude(p) / WIND_HEIGHT, 0, 1)) * (GROUND_WIND + (1 - GROUND_WIND) * smooth(over / LIFTED_WIND));
	return [wx / l * speed, flutter * speed * 0.08, wz / l * speed];
}
// what the plane feels of it: a gust comes on over WIND_EASE seconds, not all at once
function windFelt(p, dt) {
	const now = windAt(p);
	if (!p.wind) p.wind = now;
	const k = Math.min(dt / WIND_EASE, 1);
	for (let i = 0; i < 3; i++) p.wind[i] += (now[i] - p.wind[i]) * k;
	return p.wind;
}

// the ground under (x, z) metres, metres: the land's grid, put right by the exact ground under the plane (worked out again as it goes)
function groundAt(p, x, z) {
	const land = terrain.land, m = metre();
	if (!land) return -1e9;
	if (!p.ground || Math.hypot(p.p[0] - p.ground.x, p.p[2] - p.ground.z) > 2) p.ground = { x: p.p[0], z: p.p[2], off: (land.groundAt(p.p[0] * m, p.p[2] * m) - land.heightAt(p.p[0] * m, p.p[2] * m)) / m };
	return land.heightAt(x * m, z * m) / m + p.ground.off;
}

// The engine (see THE ENGINE at the top)
function engineStep(p, dt) {
	const e = p.engine;
	const best = mixtureBest(altitude(p));
	const off = Math.abs(p.mixture - best);
	const crewed = !!p.crew.pilot;
	if (e.on) {
		if (p.fuel <= 0) { e.on = false; e.stopped = 'Out of fuel'; }
		else if (off > DIES && (e.cough += dt) > 1.2) { e.on = false; e.stopped = p.mixture > best ? 'The engine flooded: lean the mixture' : 'The engine starved: richen the mixture'; }
		else if (p.mixture < 0.03 && p.throttle < 0.03) { e.on = false; e.stopped = 'Engine off'; }
		if (off <= DIES) e.cough = 0;
	} else {
		// it catches: the throttle open (or the propeller windmilling) with the mixture near enough right
		const windmill = e.rpm > 300;
		if (crewed && p.fuel > 0 && off < ROUGH && (p.throttle > 0.04 || windmill) && p.mixture > 0.05) {
			e.catching += dt;
			if (e.catching > (windmill ? 0.5 : 1.4)) { e.on = true; e.catching = 0; e.stopped = ''; }
		} else e.catching = 0;
	}
	const sigma = Math.exp(-altitude(p) / DENSITY_HEIGHT);
	const quality = clamp(1 - 2.5 * off * off, 0, 1);
	// running rough: misfires, more of them the further off the mixture
	e.rough = e.on && off > ROUGH ? clamp((off - ROUGH) / (DIES - ROUGH), 0, 1) : 0;
	if (e.rough > 0 && Math.random() < dt * (3 + 8 * e.rough)) e.misfire = 0.12 + 0.2 * Math.random();
	e.misfire = Math.max((e.misfire ?? 0) - dt, 0);
	const windmill = Math.max(p.airspeed - 8, 0) * 14;
	const want = e.on ? Math.max(RPM_IDLE + (RPM_MAX - RPM_IDLE) * p.throttle * quality * Math.pow(sigma, 0.4) * (e.misfire > 0 ? 0.45 : 1), windmill * 0.9) : windmill;
	e.rpm += (want - e.rpm) * Math.min(dt / (e.on ? 0.7 : 1.6), 1);
	e.power = e.on ? POWER * (e.rpm / RPM_MAX) * quality * sigma * (e.misfire > 0 ? 0.35 : 1) : 0;
	if (e.on) p.fuel = Math.max(p.fuel - dt / FUEL_SECONDS * (0.15 + 0.85 * e.rpm / RPM_MAX) * (0.6 + 0.4 * quality), 0);
	p.prop = (p.prop + e.rpm / 60 * Math.PI * 2 * dt) % (Math.PI * 2);
}

// a plane's sums for dt seconds (see HOW IT FLIES at the top)
function stepPlane(p, dt) {
	if (p.wreck >= 0) { p.wreck += dt; return; }
	const input = p.input ?? { elevator: 0, aileron: 0, rudder: 0 };
	if (!p.crew.pilot) p.input = null;
	for (const key of ['elevator', 'aileron', 'rudder']) {
		const want = input[key];
		p.controls[key] += clamp(want - p.controls[key], -CONTROL_RATE * dt, CONTROL_RATE * dt);
	}
	engineStep(p, dt);
	p.flap += clamp(p.flaps / (FLAPS.notches.length - 1) - p.flap, -dt / FLAPS.seconds, dt / FLAPS.seconds);

	const rho = 1.225 * Math.exp(-altitude(p) / DENSITY_HEIGHT);
	const air = windFelt(p, dt);
	const vAir = [p.v[0] - air[0], p.v[1] - air[1], p.v[2] - air[2]];
	const vb = unrotate(p.q, vAir);
	const V = Math.max(Math.hypot(...vb), 0.01);
	const q = 0.5 * rho * V * V;
	const alpha = Math.atan2(-vb[1], vb[2]);
	const beta = Math.asin(clamp(vb[0] / V, -1, 1));
	p.alpha = alpha; p.airspeed = Math.hypot(...vb); p.beta = beta;
	const forward = V > 2 && vb[2] > 0;
	// (going slowly forward, the air coming from the side is not a sideslip the wings and the fin feel as one)
	const slipping = smooth(vb[2] / 15);
	// the wings: lift up to the stall, falling away past it, and the drag
	let cl;
	if (Math.abs(alpha) < STALL) cl = CL0 + CL_ALPHA * alpha;
	else {
		const peak = CL0 + CL_ALPHA * STALL * Math.sign(alpha);
		const past = Math.abs(alpha) - STALL;
		cl = peak * Math.max(1 - past * 2.2, 0.55) * (1 - smooth(past / 0.6)) + 1.1 * Math.sin(2 * alpha) * smooth(past / 0.6);
	}
	cl += FLAPS.lift * p.flap;
	if (!forward) cl = 1.1 * Math.sin(2 * alpha) * 0.6;
	const cd = CD0 * (p.floats ? FLOATS.drag : 1) + INDUCED * cl * cl + 1.2 * Math.sin(alpha) ** 2 + FLAPS.drag * p.flap;
	const d = vb.map((v) => v / V);
	const liftDir = norm([0, d[2], -d[1]]);
	const force = [0, 0, 0], moment = [0, 0, 0];
	const add = (f) => { force[0] += f[0]; force[1] += f[1]; force[2] += f[2]; };
	add(liftDir.map((v) => v * q * WING_AREA * cl * LIFT));
	add(d.map((v) => -v * q * WING_AREA * cd));
	add([q * WING_AREA * CY_BETA * beta * 0.25 * slipping, 0, 0]);
	// the propeller: its power over its speed, up to what it pulls standing
	const thrust = Math.min(STATIC_THRUST * (p.engine.rpm / RPM_MAX) ** 2, p.engine.power * PROP_EFFICIENCY / Math.max(vb[2], 8));
	add([0, 0, thrust]);
	// the controls and the steadiness, each as hard as the air on it is (the tail in the propeller's wash too)
	const tailQ = q + 0.5 * thrust / PROP_DISC;
	const rate = (w, length) => w * length / (2 * Math.max(V, 12));
	const c = p.floats ? { elevator: p.controls.elevator * FLOATS.turn, aileron: p.controls.aileron * FLOATS.turn, rudder: p.controls.rudder * FLOATS.turn } : p.controls;
	const damp = Math.min(V / 12, 1);
	moment[0] = q * WING_AREA * CHORD * ((CM0 + FLAPS.nose * p.flap) * damp + CM_ALPHA * clamp(alpha, -0.6, 0.6) * damp + CM_Q * rate(p.w[0], CHORD)) + tailQ * WING_AREA * CHORD * CM_ELEVATOR * (c.elevator + TRIM * p.trim);
	moment[2] = q * WING_AREA * SPAN * (CL_BETA * beta * slipping + CL_AILERON * c.aileron + CL_P * rate(p.w[2], SPAN) + CL_R * rate(p.w[1], SPAN));
	moment[1] = q * WING_AREA * SPAN * (CN_BETA * beta * slipping + CN_AILERON * c.aileron + CN_R * rate(p.w[1], SPAN)) + tailQ * WING_AREA * SPAN * CN_RUDDER * c.rudder;
	// into the world
	const world = rotate(p.q, force);
	world[1] -= MASS * 9.81;

	// THE GROUND: the wheels and the skid, springs into it; the wheels roll, the brake holds them, the skid drags. With the floats on,
	//		the floats instead: on the land they slide, on the water they float (see THE FLOATS at the top)
	p.contacts = 0;
	p.afloat = 0;
	let hardest = 0;
	const sea = seaLevel();
	const gentle = p.throttle < LANDING.throttle && p.p[1] - Math.max(groundAt(p, p.p[0], p.p[2]), sea) < LANDING.over;
	const wr = rotate(p.q, p.w);
	const pointVelocity = (r) => [p.v[0] + (wr[1] * r[2] - wr[2] * r[1]), p.v[1] + (wr[2] * r[0] - wr[0] * r[2]), p.v[2] + (wr[0] * r[1] - wr[1] * r[0])];
	const fw = norm([rotate(p.q, [0, 0, 1])[0], 0, rotate(p.q, [0, 0, 1])[2]]), side = [-fw[2], 0, fw[0]];
	// (a push up at a point, and its rubbing along and across the surface, as hard as roll and slide times the push)
	const push = (r, vel, n, roll, slide) => {
		const f = [0, n, 0];
		const along = vel[0] * fw[0] + vel[2] * fw[2], across = vel[0] * side[0] + vel[2] * side[2];
		const fa = -along * roll * n / Math.max(Math.abs(along), 0.25), fs = -across * slide * n / Math.max(Math.abs(across), 0.25);
		f[0] += fw[0] * fa + side[0] * fs; f[2] += fw[2] * fa + side[2] * fs;
		add3(world, f);
		const tb = unrotate(p.q, cross(r, f));
		moment[0] += tb[0]; moment[1] += tb[1]; moment[2] += tb[2];
	};
	for (const g of p.floats ? FLOAT_GEAR : GEAR) {
		const r = rotate(p.q, g.at);
		const at = [p.p[0] + r[0], p.p[1] + r[1], p.p[2] + r[2]];
		const ground = groundAt(p, at[0], at[2]), wet = ground < sea;
		if (wet && at[1] < sea && !g.float) { crash(p, Math.hypot(...p.v), 'water'); return; }
		const into = (wet ? sea : ground) - at[1];
		if (into <= 0) continue;
		p.contacts++;
		const vel = pointVelocity(r);
		hardest = Math.max(hardest, -vel[1]);
		if (g.float && wet) {
			p.afloat++;
			// floating: a softer spring, and the water's drag along it (most at the hump, before it is up on the floats)
			const n = Math.max(FLOATS.spring * (settings.buoyancy ?? 1) * into - FLOATS.damp * vel[1], 0), speed = Math.hypot(vel[0], vel[2]);
			push(r, vel, n, FLOATS.water + FLOATS.humpDrag * Math.exp(-(((speed - FLOATS.hump) / 4) ** 2)), 0.6);
			continue;
		}
		const n = Math.max(110000 * into - 9000 * (gentle ? LANDING.damp : 1) * vel[1], 0);
		// along the ground: rolling along the plane, sliding across it (the parking brake holds hard only near a stop: a wheel that
		//		locked at speed would put it on its nose)
		const along = vel[0] * fw[0] + vel[2] * fw[2];
		const roll = g.float ? FLOATS.land : g.wheel ? (p.brake ? BRAKE * clamp(1 - Math.abs(along) / BRAKE_FADE, 0.12, 1) : 0.035) : 0.45;
		push(r, vel, n, roll, g.wheel ? 0.9 : g.float ? 0.7 : 0.5);
	}
	if (hardest > (gentle ? LANDING.sink : CRASH_SINK)) { crash(p, hardest, 'landing'); return; }
	// anything else that touches the ground (or the water): wrecked, or, landing gently, scraping along it
	const speed = Math.hypot(...p.v);
	for (const h of HARD) {
		const r = rotate(p.q, h);
		const at = [p.p[0] + r[0], p.p[1] + r[1], p.p[2] + r[2]];
		const ground = groundAt(p, at[0], at[2]), surface = Math.max(ground, ground < sea ? sea : -1e9);
		if (at[1] >= surface - 0.05) continue;
		const vel = pointVelocity(r);
		if (gentle && -vel[1] < LANDING.scrape && speed < LANDING.slow) {
			push(r, vel, Math.max(80000 * (surface - at[1]) - 9000 * vel[1], 0), ground < sea ? 1.0 : 0.6, 0.6);
			p.health = Math.max(p.health - LANDING.wear * dt, 1);
			p.contacts++;
			continue;
		}
		p.wreckAt = h; crash(p, speed, 'ground'); return;
	}

	// on: the velocity and the place, the turning and the rotation
	for (let k = 0; k < 3; k++) p.v[k] += world[k] / MASS * dt;
	for (let k = 0; k < 3; k++) p.p[k] += p.v[k] * dt;
	const w = p.w, I = INERTIA;
	const gyro = [w[1] * w[2] * (I[1] - I[2]), w[2] * w[0] * (I[2] - I[0]), w[0] * w[1] * (I[0] - I[1])];
	for (let k = 0; k < 3; k++) w[k] += (moment[k] + gyro[k]) / I[k] * dt;
	for (let k = 0; k < 3; k++) w[k] = clamp(w[k], -6, 6);
	p.q = normalizeQ(qmul(p.q, [w[0] * dt / 2, w[1] * dt / 2, w[2] * dt / 2, 1]));
	steadyOnWater(p, dt);
	// stopped on the ground: still (no creeping)
	if (!p.floats && p.contacts == 3 && Math.hypot(...p.v) < 0.05 && p.engine.rpm < RPM_IDLE * 1.2 && (p.brake || p.throttle < 0.02)) { p.v = [0, p.v[1] * 0.5, 0]; p.w = p.w.map((v) => v * 0.5); }
	// not off the edge of the world: it slides along it (going out over it is taken away), and the pilot is told to turn back
	const edge = settings.terrainWorldSize * 0.5 / metre() - 20;
	for (const k of [0, 2]) {
		if (Math.abs(p.p[k]) <= edge) continue;
		p.p[k] = clamp(p.p[k], -edge, edge);
		if (p.v[k] * Math.sign(p.p[k]) > 0) p.v[k] = 0;
		if (p.crew.pilot === 'me' && !(p.edgeSaid > performance.now() - 4000)) { p.edgeSaid = performance.now(); help.toast('The edge of the world: turn back', 2.5); }
	}
}
const add3 = (a, b) => { a[0] += b[0]; a[1] += b[1]; a[2] += b[2]; };
// on its floats on the water, held level as the boats are (boat.js: THE STEADYING), while it is slow: none of it from STEADY_FADE[0]
//		metres a second up to STEADY_FADE[1], so it can lift its nose to take off
const STEADY_FADE = [8, 14], STEADY_TIME = 0.25;
function steadyOnWater(p, dt) {
	const s = clamp(settings.boatSteadying ?? 0, 0, 1) * (1 - smooth((p.airspeed - STEADY_FADE[0]) / (STEADY_FADE[1] - STEADY_FADE[0])));
	if (!p.floats || !p.afloat || s <= 0) return;
	const k = s >= 1 ? 1 : 1 - Math.pow(1 - s, dt / STEADY_TIME);
	const f = rotate(p.q, [0, 0, 1]), turn = Math.atan2(f[0], f[2]);
	let level = [0, Math.sin(turn / 2), 0, Math.cos(turn / 2)];
	if (dot(level, p.q) + level[3] * p.q[3] < 0) level = level.map((c) => -c);
	p.q = normalizeQ(p.q.map((c, i) => c + (level[i] - c) * k));
	p.w = [p.w[0] * (1 - k), p.w[1], p.w[2] * (1 - k)];
}

// trees, boulders and houses: any of its hard points (and its wheels) in one
function struck(p) {
	const m = metre();
	if (!terrain.land) return false;
	const centre = p.frame.toWorld([0, 0, 0]);
	const ground = terrain.land.heightAt(centre[0], centre[2]);
	if (centre[1] - ground > 45 * m) return false;
	const points = [...HARD, ...GEAR.map((g) => g.at)].map((h) => p.frame.toWorld(h));
	let hit = false;
	const test = (x, z, half, bottom, top) => {
		for (const q of points) if (Math.abs(q[0] - x) < half + 0.15 * m && Math.abs(q[2] - z) < half + 0.15 * m && q[1] > bottom && q[1] < top) hit = true;
	};
	const reach = 8 * m;
	if (settings.enableForest) forest.trunksNear(centre[0], centre[2], reach, test);
	if (settings.enableBoulders) boulders.bouldersNear(centre[0], centre[2], reach, (x, z, half, bottom, top) => { if (top - bottom > 0.6 * m) test(x, z, half, bottom, top); });
	town.boxesNear(centre[0], centre[2], reach, test);
	return hit;
}

// Wrecked (see HOW IT FLIES at the top): it stops where it is, and whoever is in it is hurt, by how hard it hit
const crashListeners = [];
export function onCrash(fn) { crashListeners.push(fn); }
function crash(p, speed, how) {
	if (p.wreck >= 0) return;
	p.wreck = 0;
	p.impact = speed;
	p.wreckHow = how;
	p.v = [0, 0, 0];
	p.w = [0, 0, 0];
	p.engine.on = false;
	p.engine.rpm = 0;
	planeStats.crashes++;
	for (const fn of crashListeners) fn(p, speed, how);
	hurtCrew(p);
}
// this player, if aboard a plane that has just been wrecked (here, or by its pilot's machine)
function hurtCrew(p) {
	const seat = mySeat(p);
	if (!seat) return;
	leaveSeat(p, seat, true);
	const life = players.localLife();
	const speed = p.impact;
	if (speed >= LETHAL) players.setLocalHealth(0, '', 'Crashed the biplane');
	else players.setLocalHealth(Math.max(life.health - clamp(speed * 4, 15, 90), 1), '', 'Crashed the biplane');
	help.toast(p.wreckHow == 'water' ? 'Into the sea!' : 'Crashed!', 2.5);
}

// The seats (hunting.js: addRides)
//-------------------------------------------------
// the seat this player is in on a plane, or null
const mySeat = (p) => p.crew.pilot === 'me' ? 'pilot' : p.crew.gunner === 'me' ? 'gunner' : null;
const look = { yaw: 0, pitch: 0, setYaw: null, setPitch: null };	// where the eyes are turned, in the plane's own directions (see seatView)
let flying = null;		// { plane, seat }: this player's
function board(p, seat) {
	if (p.crew[seat] && p.crew[seat] !== 'me') { help.toast('Someone is in that seat'); return false; }
	p.crew[seat] = 'me';
	flying = { plane: p, seat };
	look.yaw = 0; look.pitch = seat == 'gunner' ? 0.1 : 0;
	look.setYaw = look.setPitch = null;
	stick.elevator = stick.aileron = 0;
	if (seat == 'pilot') { for (const fn of helmListeners) fn(p); help.toast('The mouse flies it · hold Alt to look round and scroll on a control: throttle and mixture on the board, trim and bombs on the left wall, brake and flaps on the right', 6); }
	else help.toast('The Lewis gun: aim with the mouse, left click to fire, R a fresh pan', 3.5);
	return true;
}
const helmListeners = [];
// told when this player takes the pilot's seat: fn(plane) (net.js: the pilot flies it)
export function onTakeControls(fn) { helmListeners.push(fn); }
// out of the seat: down on the ground by the plane's left side (or wherever the plane is, wrecked)
function leaveSeat(p, seat, thrown = false) {
	transformations.setSeatedNear(null);
	showStick(false);
	hunting.crosshair.hidden = false;
	if (p.crew[seat] === 'me') p.crew[seat] = null;
	if (flying && flying.plane === p) flying = null;
	transformations.viewUp.splice(0, 3, 0, 1, 0);
	const at = p.frame.toWorld([thrown ? 3.5 : 2.2, 0, seat == 'pilot' ? -0.4 : -1.5]);
	return { x: at[0], z: at[2] };
}

// the eyes in a seat, and the view: turned by the mouse in the plane's own directions (hunting.js turns settings.camYaw and camPitch;
//		what it turned them by since the last frame is turned here), into the world as the plane is
function seatView(p, seat) {
	const wrap = (a) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2));
	transformations.setSeatedNear(NEAR_SEATED * metre());
	if (look.setYaw !== null) {
		// (the gunner all the way round on the ring, the pilot as far as a head turns)
		look.yaw = seat == 'gunner' ? wrap(look.yaw + wrap(settings.camYaw - look.setYaw)) : clamp(look.yaw + wrap(settings.camYaw - look.setYaw), -2.6, 2.6);
		look.pitch = clamp(look.pitch + (settings.camPitch - look.setPitch), -1.1, 1.3);
	}
	const d = [-Math.sin(look.yaw) * Math.cos(look.pitch), Math.sin(look.pitch), Math.cos(look.yaw) * Math.cos(look.pitch)];
	const f = rotate(p.q, d);
	settings.camYaw = Math.atan2(f[0], -f[2]);
	settings.camPitch = Math.asin(clamp(f[1], -1, 1));
	look.setYaw = settings.camYaw; look.setPitch = settings.camPitch;
	const up = rotate(p.q, [0, 1, 0]);
	transformations.viewUp.splice(0, 3, ...up);
	const eye = p.frame.toWorld(SEATS[seat].eye);
	settings.camPosX = eye[0]; settings.camPosY = eye[1]; settings.camPosZ = eye[2];
	return { eye, local: d };
}

// The levers (see THE PILOT at the top): the one the eye looks at, its value now (0 to 1)
//		(the trim's lever forward is the nose down; the bomb release's is pulled back)
function leverValue(p, name) {
	return name == 'throttle' ? p.throttle : name == 'mixture' ? p.mixture : name == 'flaps' ? p.flaps / (FLAPS.notches.length - 1) : name == 'trim' ? (1 - p.trim) / 2
		: name == 'bombs' ? (p.bombLever > 0 ? 0 : 0.5) : p.brake ? 1 : 0;
}
// where a control's knob is now (metres on the plane): a lever's swung, a board knob's pulled out
function leverKnob(p, name) {
	const L = LEVERS[name], value = leverValue(p, name);
	if (L.pull) return [L.at[0], L.at[1], L.at[2] - 0.045 - L.pull * (1 - value)];
	const a = (value - 0.5) * 2 * LEVER_SWING;
	return [L.at[0], L.at[1] + Math.cos(a) * (L.length + 0.018), L.at[2] + Math.sin(a) * (L.length + 0.018)];
}
// how each control is moved (the parts, partsNow)
function leverMatrix(p, name) {
	const L = LEVERS[name], value = leverValue(p, name);
	return L.pull ? mat4.translation([0, 0, -L.pull * (1 - value)]) : about(L.at, mat4.rotationX((value - 0.5) * 2 * LEVER_SWING));
}
function leverInView(p, eye, dir) {
	let best = null, bestAlong = Infinity;
	for (const name of Object.keys(LEVERS)) {
		const at = p.frame.toWorld(leverKnob(p, name));
		const to = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]];
		const along = dot(to, dir);
		if (along < 0 || along > 1.5 * metre()) continue;
		const off = Math.hypot(to[0] - dir[0] * along, to[1] - dir[1] * along, to[2] - dir[2] * along);
		if (off < LEVER_REACH * metre() && along < bestAlong) { best = name; bestAlong = along; }
	}
	return best;
}
let litLever = null;
// a lever worked (here, by its pilot, or sent on to the plane's authority: net.js), and what the supply pack does: what { lever, by } or
//		{ resupply: true }
let remoteControl = null;
export function onRemoteControl(fn) { remoteControl = fn; }
export function workControl(p, what) {
	if (what.resupply) { resupply(p); return; }
	if (what.damage) { hurtPlane(p, what.damage); return; }
	if (what.floats !== undefined) { setFloats(p, what.floats); return; }
	if (what.lever == 'throttle') p.throttle = clamp(p.throttle + what.by, 0, 1);
	if (what.lever == 'mixture') p.mixture = clamp(p.mixture + what.by, 0, 1);
	if (what.lever == 'brake') p.brake = what.by > 0;
	if (what.lever == 'flaps') p.flaps = clamp(p.flaps + Math.sign(what.by), 0, FLAPS.notches.length - 1);
	if (what.lever == 'trim') p.trim = clamp(p.trim + what.by * 2, -1, 1);
	if (what.lever == 'bombs' && what.by > 0) releaseBombs(p);
}
function control(p, what) {
	if (flownHere(p)) workControl(p, what);
	else remoteControl?.(p, what);
}

// The ride, for hunting.js (see addRides there): a seat in view from outside, climbing in, and a frame in the seat
//-------------------------------------------------
hunting.addRides({
	// the cockpit the crosshair is on, on foot: { vehicle, seat, name, keys } or null
	inView(eye, dir) {
		const m = metre();
		let best = null, bestAlong = Infinity;
		for (const p of planes) {
			if (p.wreck >= 0) continue;
			const centre = p.frame.toWorld([0, 0, 0]);
			if (Math.hypot(centre[0] - eye[0], centre[2] - eye[2]) > (REACH + 6) * m) continue;
			for (const [seat, S] of Object.entries(SEATS)) {
				const at = p.frame.toWorld(S.look);
				const to = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]];
				const along = dot(to, dir);
				if (along < 0 || along > REACH * m) continue;
				const off = Math.hypot(to[0] - dir[0] * along, to[1] - dir[1] * along, to[2] - dir[2] * along);
				if (off < S.radius * m && along < bestAlong) { best = { vehicle: p, seat, name: p.crew[seat] ? S.name + ' (taken)' : S.name, keys: S.keys }; bestAlong = along; }
			}
		}
		return best;
	},
	board(p, seat) { return board(p, seat); },
	// in the seat, for seconds: keys (a Set of codes held), use (F pressed), scrolled (the wheel's pixels, down +). Gives the place
	//		of the walker in the world { feet, eye, velocity }, or { left: { x, z } } having got out (or been thrown out)
	ride(p, seat, { keys, use, scrolled }, seconds) {
		if (thrownOut) { const left = thrownOut; thrownOut = null; return { left }; }
		if (!p.exists || mySeat(p) !== seat || p.wreck >= 0 || p.destroyed >= 0) return { left: leaveSeat(p, seat, p.wreck >= 0) };
		// the pilot: the mouse is the stick (what it turned the view by since the last frame moves it, and it eases back to the middle),
		//		unless Alt is held, when it turns the head; let go, the head comes back to the front
		const freeLook = keys.has('AltLeft') || keys.has('AltRight');
		if (seat == 'pilot' && !freeLook && look.setYaw !== null) {
			// (the mouse as it moved, turned into radians as the view would have turned: not the view's own turn, which stops at straight
			//		up and down. Not while the view is still coming back to the front after looking round: LOOK_HOME)
			const turn = 0.0025 * settings.huntingLookSensitivity;
			const home = Math.abs(look.yaw) < LOOK_HOME && Math.abs(look.pitch) < LOOK_HOME;
			if (home) {
				stick.aileron = clamp(stick.aileron + mouseMoved.x * turn / MOUSE_STICK, -1, 1);
				stick.elevator = clamp(stick.elevator + mouseMoved.y * turn / MOUSE_STICK, -1, 1);
			}
			settings.camYaw = look.setYaw; settings.camPitch = look.setPitch;
			const back = Math.min(seconds / LOOK_BACK, 1);
			look.yaw -= look.yaw * back; look.pitch -= look.pitch * back;
		}
		mouseMoved.x = mouseMoved.y = 0;
		const ease = Math.exp(-seconds / MOUSE_CENTRE);
		stick.aileron *= ease; stick.elevator *= ease;
		showStick(seat == 'pilot' && !freeLook);
		hunting.crosshair.hidden = seat == 'pilot' && !freeLook;		// (the ring sight is the pilot's)
		const { eye, local } = seatView(p, seat);
		const m = metre();
		if (seat == 'pilot') {
			p.input = { elevator: clamp((keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0) + stick.elevator, -1, 1), aileron: clamp((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + stick.aileron, -1, 1),
				rudder: (keys.has('KeyQ') ? 1 : 0) - (keys.has('KeyE') ? 1 : 0) };
			// a lever in view, and the wheel on it
			litLever = leverInView(p, eye, transformations.getCameraForward());
			if (litLever && scrolled) control(p, { lever: litLever, by: -Math.sign(scrolled) * (litLever == 'brake' || litLever == 'flaps' || litLever == 'bombs' ? 1 : LEVER_NOTCH * Math.max(Math.round(Math.abs(scrolled) / 100), 1)) });
		} else litLever = null;
		pickedLocal = local;
		// F: out, on the ground (or the water) and stopped
		if (use) {
			if (p.wreck < 0 && (p.contacts < 2 || Math.hypot(...p.v) > 1.5)) help.toast('Land and stop first');
			else return { left: leaveSeat(p, seat) };
		}
		const feet = p.frame.toWorld(SEATS[seat].at), going = p.frame.velocityAt(SEATS[seat].at);
		// the lever the crosshair is on: what it is and how far it is set
		const value = litLever ? leverValue(p, litLever) : 0;
		return { feet, eye, velocity: going, prompt: litLever ? { name: LEVERS[litLever].name, keys: LEVERS[litLever].keys, value, want: value } : null };
	},
	// got out some other way (placed somewhere else, shot): out of the seat
	leave(p, seat) { leaveSeat(p, seat); },
	// where the walker is on it (for the others: net.js), and whether it sits
	local(p, seat) { return { local: [...SEATS[seat].at], sit: SEATS[seat].sit }; },
	help(p, seat) {
		if (seat == 'pilot') return ['Biplane: the pilot', [
			['Mouse', 'the stick: left and right roll, back and forward nose up and down'],
			['W / S', 'stick forward and back: nose down and up'],
			['A / D', 'roll left and right'],
			['Q / E', 'rudder: nose left and right'],
			['Alt (hold)', 'look round'],
			['Middle click', 'the Vickers gun (hold)'],
			['Alt + look + wheel', 'board: throttle, mixture · left wall: trim, bombs · right wall: brake, flaps'],
			['F', 'climb out (landed and stopped)'],
		]];
		return ['Biplane: the gunner', [
			['Mouse', 'aim the Lewis gun on its ring'],
			['Left click', 'fire (hold)'],
			['Right click', 'along the sights (hold)'],
			['R', 'a fresh pan'],
			['F', 'climb out (landed and stopped)'],
		]];
	},
});
let pickedLocal = [0, 0, 1];
// the mouse's stick (see THE PILOT at the top): -1 to 1, as the keys are
const stick = { elevator: 0, aileron: 0 };
// its mark in the middle of the screen: a ring, and a dot where the stick is (forward up, back down)
const stickBox = document.createElement('div');
stickBox.style.cssText = 'position: fixed; left: 50%; top: 50%; width: 64px; height: 64px; margin: -32px 0 0 -32px; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.35); pointer-events: none; display: none; z-index: 5;';
const stickDot = document.createElement('div');
stickDot.style.cssText = 'position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: rgba(255, 230, 150, 0.85); box-shadow: 0 0 2px #000;';
stickBox.appendChild(stickDot);
document.body.appendChild(stickBox);
function showStick(on) {
	stickBox.style.display = on ? '' : 'none';
	if (on) stickDot.style.transform = `translate(${(stick.aileron * 28).toFixed(1)}px, ${(stick.elevator * 28).toFixed(1)}px)`;
}
// how far the mouse has moved since the last frame (pixels), in the pilot's seat
const mouseMoved = { x: 0, y: 0 };
window.addEventListener('mousemove', (event) => { if (flying?.seat == 'pilot' && locked() && !hunting.input.menuOpen) { mouseMoved.x += event.movementX; mouseMoved.y += event.movementY; } });
// (Alt, held to look round, does nothing else here: not the browser's menu)
for (const type of ['keydown', 'keyup']) window.addEventListener(type, (event) => { if (flying && (event.code == 'AltLeft' || event.code == 'AltRight')) event.preventDefault(); }, true);

// who is in each seat of the planes flown here, from the others' states (net.js): [{ id, vehicle, local }]
export function setOtherCrew(aboard) {
	for (const p of planes) for (const seat of ['pilot', 'gunner']) if (p.crew[seat] !== 'me' && !String(p.crew[seat]).startsWith('npc:')) p.crew[seat] = null;
	for (const other of aboard) {
		const p = planeById(other.vehicle);
		if (!p) continue;
		const seat = other.local[2] > -1.0 ? 'pilot' : 'gunner';
		if (p.crew[seat] !== 'me') { p.crew[seat] = other.id; p.otherAim ??= {}; p.otherAim[seat] = other; }
	}
}

// The guns
//-------------------------------------------------
let middleHeld = false, leftHeld = false, rightHeld = false, panAsked = false;
const locked = () => document.pointerLockElement == canvas;
window.addEventListener('mousedown', (event) => {
	if (!flying || !locked() || hunting.input.menuOpen) return;
	if (event.button == 1) { middleHeld = true; event.preventDefault(); }
	if (event.button == 0) leftHeld = true;
	if (event.button == 2) rightHeld = true;
});
window.addEventListener('mouseup', (event) => {
	if (event.button == 1) middleHeld = false;
	if (event.button == 0) leftHeld = false;
	if (event.button == 2) rightHeld = false;
});
window.addEventListener('keydown', (event) => {
	if (flying && flying.seat == 'gunner' && locked() && event.code == 'KeyR' && !event.repeat) panAsked = true;
});
document.addEventListener('pointerlockchange', () => { if (!locked()) middleHeld = leftHeld = rightHeld = false; });

const MUZZLE = [0, 0.555, 2.36];
// the pilot's Vickers: down the line of the plane, between the blades (as fast as the synchronising gear lets it)
function pilotGun(p, dt) {
	p.since = Math.min(p.since + dt, 1 / VICKERS_RATE);
	if (!middleHeld || p.wreck >= 0) return;
	if (p.vickers <= 0) { if (p.since >= 1 / VICKERS_RATE) { help.toast('The Vickers is empty: land on the strip, or bring a supply pack'); p.since = -1; } return; }
	if (p.since < 1 / VICKERS_RATE) return;
	p.since = 0;
	p.vickers--;
	const from = p.frame.toWorld(MUZZLE);
	const dir = rotate(p.q, [0, 0.004, 1]);
	ballistics.fire(from, dir, { round: '.303 Vickers' });
	planeStats.shots++;
}
// the gunner's Lewis: where the gunner looks, unless the plane is in the way
export const gunnerStats = { masked: false };
function masked(d) {
	return (d[2] > 0.42 && d[1] < 0.38) || (d[1] < -0.2 && Math.abs(d[0]) < 0.55) || (d[2] < -0.75 && d[1] < 0.15 && Math.abs(d[0]) < 0.35);
}
function gunnerGun(p, dt) {
	const g = p.rear;
	// supplied since this gunner last looked: full again
	if (g.seen < p.supplied) { g.seen = p.supplied; g.pan = lewis.PAN; g.spare = LEWIS_PANS; }
	g.since = Math.min(g.since + dt, 1 / lewis.RATE);
	g.cycle = Math.min(g.cycle + dt * lewis.RATE * 1.6, 1);
	if (panAsked && g.changing < 0) {
		if (g.spare <= 0) help.toast('No more pans aboard: land on the strip, or bring a supply pack');
		else if (g.pan < lewis.PAN) { g.changing = 0; weapons.actionSound('pan'); }
	}
	panAsked = false;
	if (g.changing >= 0) {
		g.changing += dt;
		if (g.changing >= 2.2) { g.changing = -1; g.pan = lewis.PAN; g.spare--; g.turn = 0; weapons.actionSound('pan'); }
		return;
	}
	gunnerStats.masked = masked(pickedLocal);
	if (!leftHeld || p.wreck >= 0) return;
	if (gunnerStats.masked) { if (g.since >= 1 / lewis.RATE) { help.toast('The wings are in the way', 0.8); g.since = 0; } return; }
	if (g.pan <= 0) { if (g.since >= 1 / lewis.RATE) { help.toast('The pan is empty: R for another', 1.2); g.since = 0; } return; }
	if (g.since < 1 / lewis.RATE) return;
	g.since = 0;
	g.pan--;
	g.turn++;
	g.cycle = 0;
	const axes = vm.cameraAxes();
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ];
	const from = [0, 1, 2].map((k) => eye[k] + axes.forward[k] * 0.9 * metre() - axes.up[k] * 0.15 * metre());
	const spread = rightHeld ? 0.002 : 0.006;
	const dir = [0, 1, 2].map((k) => axes.forward[k] + axes.right[k] * (Math.random() - 0.5) * spread * 2 + axes.up[k] * (Math.random() - 0.5) * spread * 2);
	ballistics.fire(from, dir, { round: '.303 British' });
	planeStats.shots++;
	settings.camPitch += 0.0015;
}

// THE BOMBS (see the top)
//-------------------------------------------------
// the lever pulled: a set going, if the racks are full
function releaseBombs(p) {
	p.bombLever = BOMBS.lever;
	if (p.dropping.length) return;
	if (p.bombs <= 0) { if (mySeat(p)) help.toast('No bombs left: land on the strip, or bring a supply pack', 2.5); return; }
	if (p.bombWait > 0) { if (mySeat(p)) help.toast(`The racks are being loaded: ${Math.ceil(p.bombWait)} s`, 1.5); return; }
	p.bombs--;
	p.bombWait = BOMBS.reload;
	p.dropping = BOMBS.racks.map((_, k) => k * BOMBS.apart);
	planeStats.bombs++;
}
// for dt seconds: each bomb of a set going falls from its rack, with the plane's way on it and a little push down; the racks loaded again
function bombStep(p, dt) {
	p.bombLever = Math.max(p.bombLever - dt, 0);
	if (!p.dropping.length) p.bombWait = Math.max(p.bombWait - dt, 0);
	const m = metre();
	p.dropping = p.dropping.map((t) => t - dt);
	while (p.dropping.length && p.dropping[0] <= 0) {
		const rack = BOMBS.racks[BOMBS.racks.length - p.dropping.length];
		p.dropping.shift();
		const going = p.frame.velocityAt(rack), down = rotate(p.q, [0, -1.5 * m, 0]);
		const from = p.frame.toWorld(rack), dir = going.map((v, i) => v + down[i]);
		if (p.bombShooter) { ballistics.fire(from, dir, { round: 'bomb', shooter: p.bombShooter, npc: true, quiet: true }); p.bombFired?.(from, dir); }
		else ballistics.fire(from, dir, { round: 'bomb' });
	}
}
// an NPC's bombs (npcPlanes.js): a set let go as the lever would, the bombs theirs (shooter: the pilot's id; fired: told of each, for the
//		others in a game)
export function dropBombs(p, shooter, fired = null) { p.bombShooter = shooter; p.bombFired = fired; releaseBombs(p); }
// the side a plane is on in the war (war.js: p.team), as the shader has it
const sideCode = (team) => team == 'red' ? 1 : team == 'blue' ? 2 : 0;
// the racks with a bomb on each (drawn): not while they are being loaded, nor with none left
const racksFull = (p) => p.bombs > 0 && p.bombWait <= 0 && !p.dropping.length && p.destroyed < 0;

// Refuelled and rearmed
//-------------------------------------------------
function resupply(p) {
	p.fuel = 1;
	p.vickers = VICKERS;
	p.bombs = BOMBS.sets;
	p.supplied++;
	planeStats.reloads++;
}
// the landing strip: on it, stopped, the brake on
function onStrip(p) {
	const s = terrain.land?.strip;
	if (!s) return false;
	const at = p.frame.toWorld([0, 0, 0]);
	return stripWeight(s, at[0], at[2]) >= 1;
}
function parked(p) { return p.wreck < 0 && p.brake && p.contacts >= 3 && Math.hypot(...p.v) < 0.4 && onStrip(p); }

// The floats (see THE FLOATS at the top)
//-------------------------------------------------
// the plane whose wheels (or floats) the eye is on, near enough to work, or null
function undercarriageInView() {
	const m = metre(), eye = [settings.camPosX, settings.camPosY, settings.camPosZ], dir = transformations.getCameraForward();
	let best = null, bestAlong = Infinity;
	for (const p of planes) {
		if (p.destroyed >= 0 || p.wreck >= 0 || mySeat(p)) continue;
		const at = p.frame.toWorld([0, -1.55, 0.5]), to = [at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]];
		const along = dot(to, dir);
		if (along < 0 || along > REACH * m) continue;
		const off = Math.hypot(to[0] - dir[0] * along, to[1] - dir[1] * along, to[2] - dir[2] * along);
		if (off < 1.3 * m && along < bestAlong) { best = p; bestAlong = along; }
	}
	return best;
}
const onWater = (p) => groundAt(p, p.p[0], p.p[2]) < seaLevel();
hunting.addPrompt(() => {
	const p = undercarriageInView();
	return p && { name: p.floats ? 'Floats' : 'Wheels', keys: p.floats ? 'F fit the wheels' : 'F fit floats (land and take off on the water)' };
});
hunting.onVehicleUse(() => {
	const p = undercarriageInView();
	if (!p) return false;
	if (p.contacts == 0 || Math.hypot(...p.v) > 0.5) help.toast('Only with it down and stopped', 2);
	else if (p.floats && onWater(p)) help.toast('Not on the water: it would sink', 2);
	else if (!flownHere(p)) remoteControl?.(p, { floats: !p.floats });
	else setFloats(p, !p.floats);
	return true;
});
// on, or off: up or down onto them (they are deeper than the wheels)
function setFloats(p, on) {
	if (p.floats == on || p.destroyed >= 0) return;
	p.floats = on;
	p.p[1] += on ? 0.85 : 0.05;
	p.v = [0, 0, 0];
	help.toast(on ? 'Floats on: it can land on the water' : 'Wheels on', 2);
}

// a shell bursting (shipGuns.js) at (world units), fired here: every plane within radius (metres) of it hurt, amount at the most, less
//		the further off it is (bullet: the shell)
export function blast(at, radius, amount, bullet = null) {
	const m = metre();
	for (const p of planes) {
		if (p.destroyed >= 0) continue;
		const c = p.frame.toWorld([0, 0, -0.5]), d = Math.max(Math.hypot(c[0] - at[0], c[1] - at[1], c[2] - at[2]) / m - 3, 0);
		if (d < radius) { damage(p, amount * (1 - d / radius)); for (const fn of shotListeners) fn(p, bullet); }
	}
}

// THE SUPPLY PACK: one at a time, from a horse's saddlebags; at a landed plane, left click: it is refuelled and rearmed
//-------------------------------------------------
const supply = { have: false };
// the supply pack: its canvas body rounded off, swelling in the middle, the flap over its top, two leather straps round it with brass
//		buckles, and a red can of fuel strapped to its side with its handle (about 100 triangles)
const PACK_MESH = (() => {
	const m = vm.meshBuilder();
	const body = (z, s) => m.across(z, [0.15 * s, -0.14, 0.12 * s], 0.04);
	m.loft([body(-0.12, 0.92), body(0, 1.03), body(0.12, 0.92)], 18, 0, [0, 1]);
	m.section(-0.02, [0.158, 0.07, 0.128], 0.13, [0.158, 0.03, 0.128], 18, 0, [1]);
	for (const x of [-0.07, 0.07]) {
		// (a strap: a band round the body, 36 mm wide, at x; its buckle on the front)
		m.prismX([[-0.126, -0.146], [0.126, -0.146], [0.126, 0.13], [-0.126, 0.13]], x - 0.018, x + 0.018, 19);
		m.prismZ([[x - 0.022, 0.05], [x + 0.022, 0.05], [x + 0.022, 0.088], [x - 0.022, 0.088]], 0.126, 0.134, 2);
	}
	// the can, on the right side, and its handle over its top
	m.prismZ([[0.155, -0.13], [0.26, -0.13], [0.26, 0.09], [0.155, 0.09]], -0.08, 0.06, 4);
	m.strut([0.21, 0.09, -0.05], [0.21, 0.125, -0.02], 0.008, 0.008, 3, 3);
	m.strut([0.21, 0.125, -0.02], [0.21, 0.09, 0.02], 0.008, 0.008, 3, 3);
	return m.done();
})();
const packView = new vm.Viewmodel('Supply pack', PACK_MESH);
const PACK_HOLD = { x: 0.16, y: -0.24, z: -0.5, yaw: -0.4, pitch: -0.1 };
weapons.addWeapon('supply', { label: 'Supply pack', detail: 'Fuel and ammunition for a landed biplane: one at a time, from a horse\'s saddlebags', equip: () => {},
	reset: () => { supply.have = false; },
	drawn: () => packView.draw(vm.holdMatrix(PACK_HOLD, PACK_HOLD, { aimed: 0, bob: 0, kick: 0 }), []),
	help: () => ['Supply pack', [['Left click', 'at a landed biplane: refuel and rearm it'], ['', 'Another from a horse\'s saddlebags']]] });
weapons.gateEquip((name) => {
	if (name != 'supply' || supply.have) return true;
	help.toast('Take a supply pack from a horse\'s saddlebags first (E at them)', 3);
	return false;
});
hunting.onRefill(() => { if (supply.have) return ''; supply.have = true; return 'a supply pack taken'; });
// one put in the hands (shipGuns.js: the pile on the schooner's deck), and one used up (its crow's nests' guns): true if there was one
export function giveSupply() { if (supply.have) return false; supply.have = true; weapons.equipWeapon('supply'); return true; }
export function takeSupply() {
	if (!supply.have || !weapons.holding('supply')) return false;
	supply.have = false;
	weapons.equipWeapon('none');
	return true;
}
window.addEventListener('mousedown', (event) => {
	if (event.button == 0 && weapons.holding('supply') && locked() && !hunting.input.menuOpen) useSupply();
});
function useSupply() {
	const place = hunting.hunterPlace(), m = metre();
	const p = planes.find((one) => one.wreck < 0 && Math.hypot(one.p[0] * m - place.x, one.p[2] * m - place.z) < 7 * m);
	if (!p) { help.toast('Walk up to a landed biplane'); return; }
	if (p.contacts < 2 || Math.hypot(...p.v) > 1) { help.toast('It has to be landed and stopped'); return; }
	control(p, { resupply: true });
	supply.have = false;
	weapons.equipWeapon('none');
	help.toast('Biplane refuelled and rearmed', 2.5);
}
export function supplyState() { return { ...supply }; }
export function supplyForTest() { if (weapons.holding('supply')) useSupply(); }
export function giveSupplyForTest() { supply.have = true; }

// Flown somewhere else (as WHO SAILS IT in boat.js)
//-------------------------------------------------
export function planeShare(p) {
	const r = (v) => Math.round(v * 1000) / 1000, r5 = (v) => Math.round(v * 100000) / 100000;
	return { id: p.id, o: p.owner, a: p.authority, p: p.p.map(r), q: p.q.map(r5), v: p.v.map(r), w: p.w.map(r), th: r(p.throttle), mx: r(p.mixture), br: p.brake ? 1 : 0,
		rpm: Math.round(p.engine.rpm), on: p.engine.on ? 1 : 0, rough: r(p.engine.rough), fuel: r(p.fuel), vk: p.vickers, c: [p.controls.elevator, p.controls.aileron, p.controls.rudder].map(r),
		wr: r(p.wreck), im: r(p.impact), rl: r(p.reload), sp: p.supplied, ct: p.contacts, hp: r(p.health), dx: r(p.destroyed), fl: p.floats ? 1 : 0, fp: p.flaps, fd: r(p.flap), tr: r(p.trim), bm: p.bombs, bw: r(p.bombWait), bl: r(p.bombLever), tm: p.team ?? null };
}
export function planeFromShare(s) {
	const p = spawnPlane(0, 0, { owner: s.o, id: s.id, authority: s.a });
	applyShare(p, s);
	if (!flownHere(p)) p.track.push({ at: performance.now() / 1000, s });
	return p;
}
function applyShare(p, s) {
	Object.assign(p, { p: [...s.p], q: [...s.q], v: [...s.v], w: [...s.w], throttle: s.th, mixture: s.mx, brake: !!s.br, fuel: s.fuel, vickers: s.vk, reload: s.rl, supplied: s.sp, contacts: s.ct });
	p.engine.rpm = s.rpm; p.engine.on = !!s.on; p.engine.rough = s.rough;
	p.controls = { elevator: s.c[0], aileron: s.c[1], rudder: s.c[2] };
	if (s.wr >= 0 && p.wreck < 0) { p.wreck = s.wr; p.impact = s.im; hurtCrew(p); }
	if (s.hp !== undefined) p.health = s.hp;
	if (s.fl !== undefined) p.floats = !!s.fl;
	if (s.fp !== undefined) { p.flaps = s.fp; p.flap = s.fd; }
	if (s.bm !== undefined) Object.assign(p, { trim: s.tr, bombs: s.bm, bombWait: s.bw, bombLever: s.bl });
	if (s.tm !== undefined) p.team = s.tm;
	if (s.dx >= 0 && p.destroyed < 0) breakUp(p);
	p.wreck = s.wr;
}
export function planeHeard(s) {
	const p = planeById(s.id);
	if (!p || flownHere(p)) return;
	if (s.tm !== undefined) p.team = s.tm;
	p.track.push({ at: performance.now() / 1000, s });
	if (p.track.length > 8) p.track.shift();
}
function follow(p, now) {
	const track = p.track;
	if (track.length == 0) return;
	const at = now - FOLLOW_DELAY;
	let a = track[0], c = track[track.length - 1];
	for (let k = 0; k < track.length - 1; k++) if (track[k].at <= at && track[k + 1].at >= at) { a = track[k]; c = track[k + 1]; break; }
	const f = c.at > a.at ? clamp((at - a.at) / (c.at - a.at), 0, 1) : 1;
	applyShare(p, c.s);
	p.p = a.s.p.map((v, k) => v + (c.s.p[k] - v) * f);
	p.q = slerp(a.s.q, c.s.q, f);
	p.prop = (p.prop + p.engine.rpm / 60 * Math.PI * 2 / 60) % (Math.PI * 2);
}
export function takeOver(p, authority = localId) {
	p.authority = authority;
	p.track = [];
}

// Shot: a bullet stops at a plane (it is not hurt). Not at the one its shooter is in. Told: fn(plane, bullet) (npcs.js: its crew know they
//		are shot at)
const shotListeners = [];
export function onPlaneShot(fn) { shotListeners.push(fn); }
ballistics.addTarget((ax, ay, az, bx, by, bz, bullet) => {
	const m = metre();
	let best = null;
	for (const p of planes) {
		if (p.destroyed >= 0) continue;
		const aboard = bullet?.remote || bullet?.npc ? p.crew.pilot === bullet.shooter || p.crew.gunner === bullet.shooter : mySeat(p) !== null;
		if (aboard) continue;
		const centre = p.frame.toWorld([0, 0.3, -1]);
		if (ballistics.crossSphere(ax, ay, az, bx, by, bz, centre[0], centre[1], centre[2], 7.5 * m) === null) continue;
		for (const [x, y, z, r] of p.floats ? [...SPHERES, ...FLOAT_SPHERES] : SPHERES) {
			const c = p.frame.toWorld([x, y, z]);
			const t = ballistics.crossSphere(ax, ay, az, bx, by, bz, c[0], c[1], c[2], r * m);
			if (t !== null && (!best || t < best.t)) best = { t, p };
		}
	}
	// (a bullet fired here hurts it; the others' are theirs to say, and do)
	return best && { t: best.t, what: 'plane', hit: () => {
		if (bullet?.remote) return;
		damage(best.p, ballistics.ROUNDS[bullet?.round]?.damage ?? 1);
		for (const fn of shotListeners) fn(best.p, bullet);
	} };
});

// Shot to pieces (see the top)
//-------------------------------------------------
// hit by a bullet fired here: its health down here, if it is flown here, or where it is flown (net.js)
function damage(p, amount) {
	if (p.destroyed >= 0 || p.wreck >= 0) return;
	planeStats.hits++;
	if (flownHere(p)) hurtPlane(p, amount);
	else remoteControl?.(p, { damage: amount });
}
function hurtPlane(p, amount) {
	if (p.destroyed >= 0) return;
	p.health = Math.max(p.health - amount, 0);
	if (p.health <= 0) breakUp(p);
}
const breakListeners = [];
// told when a plane (or a boat: boat.js) is shot to pieces: fn(where, world units; the plane) (sound.js: the bang, npcPlanes.js)
export function onBreak(fn) { breakListeners.push(fn); }
let debris = [], puffs = [];
let thrownOut = null;		// this player, thrown out of a plane in pieces: where, how fast, whether its parachute opens (ride gives it to hunting.js)
// to pieces: each piece flung off as the plane was going, a ball of fire, and whoever is in it thrown out
function breakUp(p) {
	p.destroyed = Math.max(p.destroyed, 0);
	p.engine.on = false;
	planeStats.destroyed++;
	const parts = partsNow(p);
	parts[PARTS.PROP] = about(HUB, mat4.rotationZ(p.prop));
	for (const piece of PIECES) {
		const r = rotate(p.q, piece.centre), kick = rotate(p.q, piece.kick);
		debris.push({ piece, team: p.team, parts: parts.map((matrix, k) => piece.parts.includes(k) ? matrix : HIDDEN), p: p.p.map((v, i) => v + r[i]), q: [...p.q],
			v: p.v.map((v, i) => v + kick[i] + (Math.random() - 0.5) * piece.scatter), w: piece.spin.map((s) => (Math.random() * 2 - 1) * s), age: 0, settled: false });
	}
	const at = p.frame.toWorld([0, 0.3, -0.5]);
	explode(at, 1.6);
	for (const fn of breakListeners) fn(at, p);
	const seat = mySeat(p);
	if (seat) bailOut(p, seat);
}
// thrown out of the seat as it breaks up: with the plane's way on it, up a little, under a parachute if it is high enough
function bailOut(p, seat) {
	const m = metre();
	const at = p.frame.toWorld(SEATS[seat].at), going = p.frame.velocityAt(SEATS[seat].at);
	leaveSeat(p, seat);
	const ground = terrain.land ? Math.max(terrain.land.heightAt(at[0], at[2]), settings.waterWorldPosY) : at[1];
	thrownOut = { x: at[0], y: at[1], z: at[2], vx: going[0] * 0.5, vy: Math.max(going[1], 0) * 0.4 + 3 * m, vz: going[2] * 0.5, chute: at[1] - ground > CHUTE_OVER * m };
	help.toast(thrownOut.chute ? 'Shot down! Your parachute opens' : 'Shot down!', 3);
}
// shot about (see SMOKE at the top): smoke from the engine, more the worse it is, and near the end flames with it
function smokeFrom(p, dt) {
	const worse = 1 - p.health / (HEALTH * 0.5);
	if (worse <= 0) return;
	p.smokeDue += dt * (SMOKE.least + (SMOKE.most - SMOKE.least) * Math.min(worse, 1));
	const m = metre();
	while (p.smokeDue >= 1 && puffs.length < 600) {
		p.smokeDue -= 1;
		const at = p.frame.toWorld([(Math.random() - 0.5) * 0.4, 0.3 + Math.random() * 0.2, 1.6 + Math.random() * 0.6]);
		const flame = p.health < HEALTH * SMOKE.flames && Math.random() < 0.35;
		puffs.push({ p: at.map((v) => v / m), v: [p.v[0] * 0.15 + (Math.random() - 0.5), p.v[1] * 0.15 + 0.8 + Math.random(), p.v[2] * 0.15 + (Math.random() - 0.5)],
			size: flame ? 0.3 + 0.2 * Math.random() : 0.3 + 0.3 * Math.random() + 0.3 * worse, life: flame ? 0.6 : 2.2 + 1.2 * Math.random(), age: 0, smoke: !flame, grow: 1.7 });
	}
	p.smokeDue = Math.min(p.smokeDue, 1);
}

// a ball of fire at a place (world units), size times a plane's: a flash of light, and puffs that burn out into smoke
export function explode(at, size = 1) {
	const m = metre();
	const centre = [at[0] / m, at[1] / m, at[2] / m];
	for (let k = 0; k < 7; k++) {
		const a = Math.random() * Math.PI * 2, r = Math.random() * 1.6 * size;
		puffs.push({ p: [centre[0] + Math.cos(a) * r, centre[1] + (Math.random() - 0.3) * 1.5 * size, centre[2] + Math.sin(a) * r], v: [Math.cos(a) * 2, 1.5 + Math.random() * 2, Math.sin(a) * 2],
			size: (0.8 + Math.random() * 0.9) * size, life: 1.8 + Math.random() * 1.6, age: -k * 0.04 });
	}
	flash = { at: [...at], age: 0, size };
}
let flash = null;
boat.onBreak((at) => explode(at, 2.2));
// a gun's blast at its muzzle (world units), along dir (shipGuns.js): a flash of light, and a few puffs of smoke blown out along it
export function muzzleBlast(at, dir) {
	const m = metre(), l = Math.hypot(...dir) || 1;
	for (let k = 0; k < 4; k++) {
		const speed = 3 + 4 * Math.random();
		puffs.push({ p: at.map((v) => v / m), v: dir.map((d, i) => d / l * speed + (i == 1 ? 0.6 : 0) + (Math.random() - 0.5) * 0.8), size: 0.25 + 0.2 * Math.random(),
			life: 1.6 + Math.random(), age: -k * 0.05, smoke: true, grow: 2.0 });
	}
	flash = { at: [...at], age: 0, size: 0.4 };
}
// the pieces fall: spinning down through the air (the wings held back by it), and lie where they come down (or sink in the sea)
function stepDebris(dt) {
	const m = metre(), sea = seaLevel();
	for (const d of debris) {
		d.age += dt;
		if (d.settled) continue;
		const ground = terrain.land ? terrain.land.heightAt(d.p[0] * m, d.p[2] * m) / m : -1e9;
		if (ground < sea && d.p[1] < sea) {
			// in the sea: down slowly, out of sight
			d.v = [d.v[0] * Math.exp(-2 * dt), -0.7, d.v[2] * Math.exp(-2 * dt)];
			d.w = d.w.map((v) => v * Math.exp(-dt));
			if (d.p[1] < sea - 10) d.gone = true;
		} else {
			d.v[1] -= 9.81 * dt;
			const k = Math.exp(-d.piece.drag * dt);
			d.v = d.v.map((v) => v * k);
		}
		for (let i = 0; i < 3; i++) d.p[i] += d.v[i] * dt;
		d.q = normalizeQ(qmul(d.q, [d.w[0] * dt / 2, d.w[1] * dt / 2, d.w[2] * dt / 2, 1]));
		if (ground >= sea && d.p[1] - d.piece.rest < ground) { d.p[1] = ground + d.piece.rest; d.settled = true; }
	}
	debris = debris.filter((d) => !d.gone && d.age < DEBRIS_SECONDS);
	for (const puff of puffs) { puff.age += dt; for (let i = 0; i < 3; i++) puff.p[i] += puff.v[i] * dt * Math.exp(-puff.age); puff.v[1] += 0.8 * dt; }
	puffs = puffs.filter((puff) => puff.age < puff.life);
	if (flash) {
		flash.age += dt;
		pointLights.setMovingLight('explosion', flash.age < 0.6 ? { at: flash.at, radius: 40 * m * flash.size, colour: [1.0, 0.62, 0.3], strength: 8 * (1 - flash.age / 0.6), night: false } : null);
		if (flash.age >= 0.6) flash = null;
	}
	planeStats.debris = debris.length;
}
export function debrisState() { return debris.map((d) => ({ p: [...d.p], settled: d.settled, parts: d.piece.parts.length })); }

// Per frame
//-------------------------------------------------
let lastTime = performance.now();
export function planeUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (!terrain.land) return;
	stepDebris(elapsed);
	for (const p of planes) if (p.destroyed < 0 && p.wreck < 0) smokeFrom(p, elapsed);
	for (const p of [...planes]) {
		// in pieces: only its pieces are left (stepDebris), and it goes after a while
		if (p.destroyed >= 0) {
			p.destroyed += elapsed;
			if (flownHere(p) && p.destroyed > GONE_SECONDS) { removePlane(p); announceSpawn('plane', null, p); }
			continue;
		}
		if (flownHere(p)) {
			for (let left = elapsed; left > 1e-6; left -= STEP) stepPlane(p, Math.min(left, STEP));
			bombStep(p, elapsed);
			if (p.wreck < 0 && struck(p)) crash(p, Math.hypot(...p.v), 'struck');
			// the strip: parked, it is refuelled and rearmed after RELOAD_SECONDS
			if (parked(p)) {
				if (p.reload >= 0) { p.reload += elapsed; if (p.reload >= RELOAD_SECONDS) { resupply(p); p.health = HEALTH; p.reload = -1; help.toast('Refuelled, rearmed and repaired', 2.5); } }
			} else p.reload = 0;
			if (p.wreck > WRECK_SECONDS) { removePlane(p); announceSpawn('plane', null, p); continue; }
		} else follow(p, now / 1000);
		if (flying && flying.plane === p) {
			if (flying.seat == 'pilot') pilotGun(p, elapsed);
			else gunnerGun(p, elapsed);
		}
	}
	planeStats.planes = planes.length;
	showInstruments();
	showReload();
}

// for testing: a plane's state, and the keys held for its pilot
export function planeState(p = planes[0]) {
	if (!p) return null;
	const f = rotate(p.q, [0, 0, 1]), u = rotate(p.q, [0, 1, 0]);
	return { id: p.id, p: [...p.p], v: [...p.v], speed: Math.hypot(...p.v), airspeed: p.airspeed, alpha: p.alpha, altitude: altitude(p), heading: Math.atan2(f[0], -f[2]), pitch: Math.asin(f[1]), bank: Math.atan2(-u[0] * f[2] + u[2] * f[0], u[1]),
		rpm: p.engine.rpm, on: p.engine.on, stopped: p.engine.stopped, rough: p.engine.rough, fuel: p.fuel, throttle: p.throttle, mixture: p.mixture, best: mixtureBest(altitude(p)), brake: p.brake,
		contacts: p.contacts, wreck: p.wreck, how: p.wreckHow, reload: p.reload, vickers: p.vickers, crew: { ...p.crew }, rear: { ...p.rear }, controls: { ...p.controls }, flaps: p.flaps, flap: p.flap, stick: { ...stick }, trim: p.trim, bombs: p.bombs, bombWait: p.bombWait };
}
export function setPlaneForTest(p, values) { Object.assign(p, values); if (values.engineOn !== undefined) p.engine.on = values.engineOn; }
export function hardForTest(p) { return { sea: seaLevel(), off: p.ground?.off, points: HARD.map((h) => { const r = rotate(p.q, h), at = [p.p[0] + r[0], p.p[1] + r[1], p.p[2] + r[2]]; return [at[1], groundAt(p, at[0], at[2])].map((v) => Math.round(v * 100) / 100); }) }; }
export function stepForTest(p, seconds) { for (let t = 0; t < seconds; t += STEP) stepPlane(p, STEP); }
export function fireForTest(middle, left) { middleHeld = middle; leftHeld = left; }
export function lookForTest(yaw, pitch) { look.yaw = yaw; look.pitch = pitch; look.setYaw = null; }
export function lookAtLeverForTest(name) {
	const k = leverKnob(flying.plane, name), e = SEATS[flying.seat].eye, d = [k[0] - e[0], k[1] - e[1], k[2] - e[2]], l = Math.hypot(...d);
	lookForTest(Math.atan2(-d[0], d[2]), Math.asin(d[1] / l));
}
export function boardForTest(p, seat) { return board(p, seat); }
export function floatsForTest(p, on) { setFloats(p, on); }
export function puffsForTest() { return puffs.length; }
export { restingOn, fromAxes, rotate, unrotate, masked, MUZZLE, MOUNT };
// the airframe's numbers, for flying it from outside (npcPlanes.js: its autopilot)
export const AIRFRAME = { MASS, WING_AREA, CL0, CL_ALPHA, STALL, LIFT, CM0, CM_ALPHA, CM_ELEVATOR, DENSITY_HEIGHT, VICKERS_RATE, HEALTH };

// Drawing them
//-------------------------------------------------
const UNIFORM_FLOATS = 16 + 16 + 4 + 4 + 4 + PART_COUNT * 16;
const shaderModule = device.createShaderModule({ label: "vf_plane", code: vf_plane });
const meshBuffer = device.createBuffer({ label: "plane mesh", size: PLANE_MESH.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(meshBuffer, 0, PLANE_MESH.data);
const linSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const pipeline = device.createRenderPipeline({
	label: "plane pipeline",
	layout: 'auto',
	vertex: { module: shaderModule, entryPoint: "vertexMain", buffers: [{ arrayStride: 16, attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }] }] },
	fragment: { module: shaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: depthTest('less'), format: DEPTH_FORMAT },
});
const slots = Array.from({ length: MAX_PLANES }, (_, k) => ({ buffer: device.createBuffer({ label: `plane ${k} Uniform`, size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), bindGroup: null, lut: null }));
const startSeconds = performance.now() / 1000;
const IDENTITY = mat4.identity(), HIDDEN = mat4.scaling([0, 0, 0]);
const about = (point, rotation) => mat4.multiply(mat4.translation(point), mat4.multiply(rotation, mat4.translation(point.map((v) => -v))));

// where each part is now (see THE MESH at the top)
function partsNow(p) {
	const parts = Array.from({ length: PART_COUNT }, () => IDENTITY);
	parts[PARTS.FLOATS] = p.floats ? IDENTITY : HIDDEN;
	parts[PARTS.WHEELS] = p.floats ? HIDDEN : IDENTITY;
	const blur = smooth((p.engine.rpm - 300) / 600);
	parts[PARTS.PROP] = blur > 0.97 ? HIDDEN : about(HUB, mat4.rotationZ(p.prop));
	parts[PARTS.BLUR] = blur > 0.02 ? IDENTITY : HIDDEN;
	const c = p.controls;
	WINGS.forEach((wing, w) => {
		for (const [s, k] of [[1, 0], [-1, 1]]) {
			const hinge = [0, wing.y + 4.5 * DIHEDRAL + 0.013 * CHORD, wing.le - CHORD * AILERON_HINGE];
			parts[PARTS.AILERON[w * 2 + k]] = about(hinge, mat4.rotationX(-s * c.aileron * 0.35));
		}
	});
	parts[PARTS.ELEVATOR] = about([0, ELEVATOR_HINGE[0], ELEVATOR_HINGE[1]], mat4.rotationX((c.elevator + TRIM * p.trim) * 0.42));
	// the flaps, down at the back as far as they are let down (the lower wing's hinge, halfway out along them)
	const flapHinge = [0, WINGS[1].y + (FLAP_SPAN[0] + FLAP_SPAN[1]) / 2 * DIHEDRAL + 0.013 * CHORD, WINGS[1].le - CHORD * AILERON_HINGE];
	parts[PARTS.FLAP[0]] = parts[PARTS.FLAP[1]] = about(flapHinge, mat4.rotationX(-p.flap * FLAPS.notches[FLAPS.notches.length - 1] * Math.PI / 180));
	parts[PARTS.RUDDER] = about([0, 0, RUDDER_HINGE], mat4.rotationY(c.rudder * 0.45));
	parts[PARTS.STICK] = about(STICK_FOOT, mat4.multiply(mat4.rotationX(-c.elevator * 0.3), mat4.rotationZ(c.aileron * 0.3)));
	for (const [name, L] of Object.entries(LEVERS)) parts[L.part] = leverMatrix(p, name);
	// the ring and the gun: turned to where the gunner looks (this player's view, or the gunner's state over the network). Hidden from
	//		this player's own eyes in the gunner's seat (it draws the gun in its hands: drawGunner)
	let aim = [0, 0.05, -1];
	if (p.crew.gunner === 'me') aim = pickedLocal;
	else if (p.npcAim) aim = p.npcAim;		// (npcPlanes.js: its gunner's, in the plane's own directions)
	else if (p.otherAim?.gunner) {
		const o = players.otherList().find((one) => one.id === p.crew.gunner)?.view;
		if (o) aim = unrotate(p.q, [Math.sin(o.heading) * Math.cos(o.pitch), Math.sin(o.pitch), Math.cos(o.heading) * Math.cos(o.pitch)]);
	}
	const yaw = Math.atan2(aim[0], aim[2]), pitch = Math.asin(clamp(aim[1], -1, 1));
	const ring = about(RING, mat4.rotationY(yaw));
	parts[PARTS.RING] = ring;
	const gun = mat4.multiply(ring, mat4.multiply(mat4.translation(MOUNT), mat4.multiply(mat4.rotationX(-pitch), mat4.translation(GUN_PIVOT.map((v) => -v)))));
	const mine = p.crew.gunner === 'me';
	parts[PARTS.GUN] = mine ? HIDDEN : gun;
	parts[PARTS.PAN] = mine ? HIDDEN : mat4.multiply(gun, mat4.multiply(mat4.translation(lewis.PAN_AT), mat4.rotationY(-p.rear.turn / 25 * Math.PI * 2)));
	parts[PARTS.HIDDEN] = HIDDEN;
	return parts;
}

// the model: its metres into the world, and tumbled over on the ground once wrecked
function modelMatrix(p) {
	const m = metre();
	const l = rotate(p.q, [1, 0, 0]), u = rotate(p.q, [0, 1, 0]), f = rotate(p.q, [0, 0, 1]);
	return new Float32Array([l[0] * m, l[1] * m, l[2] * m, 0, u[0] * m, u[1] * m, u[2] * m, 0, f[0] * m, f[1] * m, f[2] * m, 0, p.p[0] * m, p.p[1] * m, p.p[2] * m, 1]);
}

// the pieces' and the puffs' and the canopies' meshes: a ball (a puff of fire, made as big as it is) and a parachute (its harness at the
//		origin, its canopy over it, the lines down from its edge)
const EFFECTS = (() => {
	const m = vm.meshBuilder();
	m.ball([0, 0, 0], 1, 8, M.FIRE);
	const puff = m.count() * 3;
	const ring = (r, y) => m.ringAt([0, y, 0], [1, 0, 0], [0, 0, 1], Array.from({ length: 12 }, (_, k) => { const a = (k + 0.5) / 12 * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r]; }));
	m.loft([ring(2.7, 3.5), ring(2.35, 4.25), ring(1.5, 4.75), ring(0.2, 4.95)], M.SILK, 0, [1]);
	for (let k = 0; k < 12; k += 2) { const a = (k + 0.5) / 12 * Math.PI * 2; m.strut([0, 1.55, 0], [Math.cos(a) * 2.7, 3.5, Math.sin(a) * 2.7], 0.012, 0.012, 3, M.WIRE); }
	const canopy = m.count() * 3 - puff;
	// a bomb (its middle at the origin, its nose to +z): its body lofted round, and four fins at its tail
	const round = (z, r) => m.ringAt([0, 0, z], [1, 0, 0], [0, 1, 0], Array.from({ length: 8 }, (_, k) => { const a = (k + 0.5) / 8 * Math.PI * 2; return [Math.cos(a) * r, Math.sin(a) * r]; }));
	m.loft([round(0.5, 0.02), round(0.38, 0.09), round(0.1, 0.11), round(-0.25, 0.1), round(-0.45, 0.04)], M.BOMB, 0, [0, 1]);
	for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) m.quad([x * 0.03, y * 0.03, -0.38], [x * 0.14, y * 0.14, -0.42], [x * 0.14, y * 0.14, -0.58], [x * 0.03, y * 0.03, -0.55], 0, M.BOMB);
	return { data: m.done(), puff, canopy, bomb: m.count() * 3 - puff - canopy };
})();
const effectsBuffer = device.createBuffer({ label: "plane effects mesh", size: EFFECTS.data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(effectsBuffer, 0, EFFECTS.data);
const extraSlots = [];		// uniform buffers for whatever else is drawn: the pieces, the puffs, the canopies (made as they are needed)
const NONE = Array.from({ length: PART_COUNT }, () => IDENTITY);

// with the solid things: the planes, their pieces, the fire, and the parachutes (this player's, and the others' in a game)
export function planePass(aEncoder, mainpassDepthTexture) {
	const m = metre();
	const draws = [];
	const place = (p, q, s = 1) => { const l = rotate(q, [s, 0, 0]), u = rotate(q, [0, s, 0]), f = rotate(q, [0, 0, s]); return new Float32Array([l[0] * m, l[1] * m, l[2] * m, 0, u[0] * m, u[1] * m, u[2] * m, 0, f[0] * m, f[1] * m, f[2] * m, 0, p[0] * m, p[1] * m, p[2] * m, 1]); };
	for (const p of planes.slice(0, MAX_PLANES)) {
		if (p.destroyed >= 0) continue;
		const lit = flying && flying.plane === p && litLever ? LEVERS[litLever].part : -1;
		draws.push({ model: modelMatrix(p), parts: partsNow(p), look: [lit, smooth((p.engine.rpm - 300) / 600)], state: [p.wreck >= 0 ? Math.min(p.wreck / 2, 1) : 0, 0], mesh: meshBuffer, first: 0, count: PLANE_VERTICES, side: sideCode(p.team) });
	}
	// a piece: the plane's mesh with everything but the piece hidden, turned about its middle
	for (const d of debris) {
		const c = d.piece.centre, r = rotate(d.q, c);
		draws.push({ model: place(d.p.map((v, i) => v - r[i]), d.q), parts: d.parts, look: [-1, 0], state: [0.55, 0], mesh: meshBuffer, first: 0, count: PLANE_VERTICES, side: sideCode(d.team) });
	}
	for (const puff of puffs) {
		if (puff.age < 0) continue;
		const k = puff.age / puff.life;
		// (a puff of smoke is drawn as a fire's is once it has burnt out: past the fire in it)
		draws.push({ model: place(puff.p, [0, 0, 0, 1], puff.size * (0.5 + (puff.grow ?? 1.6) * Math.sqrt(k))), parts: NONE, look: [-1, 0], state: [0, puff.smoke ? 0.45 + 0.55 * k : k], mesh: effectsBuffer, first: 0, count: EFFECTS.puff });
	}
	// the parachutes: this player's own, and the others' (their states say)
	const chutes = [];
	const mine = hunting.hunterPlace();
	if (mine.chute) chutes.push([mine.x / m, mine.y / m, mine.z / m]);
	for (const other of players.otherList()) if (other.view?.chute && other.view.alive) chutes.push([other.view.x / m, other.view.y / m, other.view.z / m]);
	for (const at of chutes) draws.push({ model: place(at, [0, 0, 0, 1]), parts: NONE, look: [-1, 0], state: [0, 0], mesh: effectsBuffer, first: EFFECTS.puff, count: EFFECTS.canopy });
	// the bombs: on the racks, and falling (each turned to the way it goes)
	const bombDraw = (at, q) => draws.push({ model: place(at, q), parts: NONE, look: [-1, 0], state: [0, 0], mesh: effectsBuffer, first: EFFECTS.puff + EFFECTS.canopy, count: EFFECTS.bomb });
	for (const p of planes) if (racksFull(p)) for (const rack of BOMBS.racks) { const r = rotate(p.q, rack); bombDraw(p.p.map((v, i) => v + r[i]), p.q); }
	for (const b of ballistics.flyingOf('bomb')) {
		const f = norm(b.v), l = norm(cross([0, 1, 0], Math.abs(f[1]) > 0.99 ? [1, 0, 0] : f)), u = cross(f, l);
		bombDraw(b.at.map((v) => v / m), fromAxes(l, u, f));
	}
	if (draws.length == 0) { planeStats.drawn = 0; return; }

	const pass = aEncoder.beginRenderPass({
		colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: "load", storeOp: "store" }],
		depthStencilAttachment: { view: mainpassDepthTexture.createView(), depthLoadOp: 'load', depthStoreOp: 'store' },
		timestampWrites: profiler.timestamps('Planes', 'vf_plane'),
	});
	pass.setPipeline(pipeline);
	draws.forEach((draw, k) => {
		let slot = k < slots.length ? slots[k] : extraSlots[k - slots.length];
		if (!slot) { slot = { buffer: device.createBuffer({ label: `plane extra ${k} Uniform`, size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }), bindGroup: null, lut: null }; extraSlots.push(slot); }
		const u = new Float32Array(UNIFORM_FLOATS);
		u.set(transformations.getViewProj(), 0);
		u.set(draw.model, 16);
		u.set([settings.camPosX, settings.camPosY, settings.camPosZ, performance.now() / 1000 - startSeconds], 32);
		u.set([settings.waterHorizonFogDistance, settings.enableAtmosphere ? 1 : 0, draw.look[0], draw.look[1]], 36);
		u.set([draw.state[0], m, draw.state[1], draw.side ?? 0], 40);
		draw.parts.forEach((matrix, j) => u.set(matrix, 44 + j * 16));
		device.queue.writeBuffer(slot.buffer, 0, u);
		if (!slot.bindGroup || slot.lut !== skyViewLUTtexture) {
			slot.lut = skyViewLUTtexture;
			slot.bindGroup = device.createBindGroup({ label: `plane ${k} bind group`, layout: pipeline.getBindGroupLayout(0), entries: [
				{ binding: 0, resource: { buffer: slot.buffer } },
				{ binding: 1, resource: { buffer: uniformBufferLights } },
				{ binding: 2, resource: skyViewLUTtexture.createView() },
				{ binding: 3, resource: linSampler },
			] });
		}
		pass.setBindGroup(0, slot.bindGroup);
		pass.setVertexBuffer(0, draw.mesh);
		pass.draw(draw.count, 1, draw.first, 0);
	});
	pass.end();
	planeStats.drawn = draws.length;
}

// over the finished frame: the gunner's Lewis gun, in its hands on the ring (weapons.js draws the guns held, rotatingCube.js this)
const GUNNER_HOLD = { x: 0.1, y: -0.16, z: -0.44, yaw: 0.02, pitch: 0.0 };
const GUNNER_AIM = { x: 0, y: -0.085, z: -0.32, yaw: 0, pitch: 0 };
let gunnerAimed = 0;
export function gunnerPass() {
	if (!flying || flying.seat != 'gunner' || !hunting.hunterLife.alive) { gunnerAimed = 0; return; }
	const g = flying.plane.rear;
	gunnerAimed = clamp(gunnerAimed + (rightHeld && g.changing < 0 ? 1 : -1) * 0.05, 0, 1);
	hunting.crosshair.hidden = gunnerAimed > 0.3;
	const matrix = vm.holdMatrix(GUNNER_HOLD, GUNNER_AIM, { aimed: gunnerAimed, bob: 0, kick: g.cycle < 1 ? 0.4 * (1 - g.cycle) : 0, kickBack: 0.02, kickUp: 0.01 });
	const parts = lewis.lewisParts({ down: 0, turn: g.turn, cycle: g.cycle, changing: g.changing >= 0 ? g.changing / 2.2 * 2.6 : -1, cases: [] });
	parts[4] = parts[5] = parts[6] = vm.HIDDEN;
	lewis.drawMounted(matrix, parts);
}

// The instruments (see THE INSTRUMENTS at the top), along the bottom in the pilot's seat; the gunner's pans in the bottom right
//-------------------------------------------------
const panel = document.createElement('div');
panel.style.cssText = 'position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); z-index: 5; pointer-events: none; display: none; gap: 10px; align-items: flex-end; font-family: system-ui, sans-serif; color: #e8e8e8; user-select: none;';
document.body.appendChild(panel);
const gunnerBox = vm.ammoBox();
let panelShown = '', gunnerShown = '';
const DIAL = 'width: 92px; height: 92px; display: block;';
function dial(value, low, high, ticks, label, unit, { red = null, green = null, needle = '#f2f2f2' } = {}) {
	const a = (v) => (-0.75 + 1.5 * clamp((v - low) / (high - low), 0, 1)) * Math.PI;	// round from -135 to +135 degrees
	const pt = (v, r) => [(Math.sin(a(v)) * r).toFixed(1), (-Math.cos(a(v)) * r).toFixed(1)];
	const arc = (from, to, colour) => { const [x0, y0] = pt(from, 38), [x1, y1] = pt(to, 38); return `<path d="M${x0} ${y0} A38 38 0 ${Math.abs(a(to) - a(from)) > Math.PI ? 1 : 0} 1 ${x1} ${y1}" stroke="${colour}" stroke-width="5" fill="none"/>`; };
	let svg = `<svg style="${DIAL}" viewBox="-46 -46 92 92"><circle r="44" fill="#16130f" stroke="#6b5a3e" stroke-width="3"/>`;
	if (green) svg += arc(green[0], green[1], '#4f9a45');
	if (red) svg += arc(red[0], red[1], '#b03228');
	for (const t of ticks) { const [x0, y0] = pt(t, 33), [x1, y1] = pt(t, 40), [tx, ty] = pt(t, 25); svg += `<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}" stroke="#d8d0c0" stroke-width="1.5"/><text x="${tx}" y="${+ty + 3}" font-size="8" fill="#d8d0c0" text-anchor="middle">${Math.abs(t) >= 1000 ? t / 1000 : t}</text>`; }
	const [nx, ny] = pt(value, 36);
	svg += `<line x1="0" y1="0" x2="${nx}" y2="${ny}" stroke="${needle}" stroke-width="2.5"/><circle r="3.5" fill="#888"/>`;
	svg += `<text y="17" font-size="8.5" fill="#d8d0c0" text-anchor="middle" letter-spacing="0.5">${label}</text><text y="27" font-size="7" fill="#a89c88" text-anchor="middle">${unit}</text></svg>`;
	return svg;
}
// the whiskey compass: its card turning behind the lubber line, the heading under it
function compass(heading) {
	const deg = ((heading * 180 / Math.PI) % 360 + 360) % 360;
	const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
	let marks = '';
	for (let d = Math.floor((deg - 60) / 15) * 15; d <= deg + 60; d += 15) {
		const x = (d - deg) * 1.4, n = ((d % 360) + 360) % 360;
		if (Math.abs(x) > 50) continue;		// (only what shows through the window)
		marks += `<line x1="${x.toFixed(1)}" y1="${names[n] ? 4 : 10}" x2="${x.toFixed(1)}" y2="16" stroke="#2a2418" stroke-width="1.4"/>`;
		if (names[n]) marks += `<text x="${x.toFixed(1)}" y="30" font-size="11" font-weight="700" fill="#2a2418" text-anchor="middle">${names[n]}</text>`;
		else if (n % 30 == 0) marks += `<text x="${x.toFixed(1)}" y="29" font-size="8" fill="#2a2418" text-anchor="middle">${n / 10}</text>`;
	}
	return `<svg style="width: 140px; height: 92px; display: block;" viewBox="-70 -46 140 92"><rect x="-68" y="-44" width="136" height="88" rx="10" fill="#16130f" stroke="#6b5a3e" stroke-width="3"/>`
		+ `<rect x="-56" y="-18" width="112" height="40" rx="8" fill="#d9caa4"/>`
		+ `<g transform="translate(0 -18)">${marks}</g><line x1="0" y1="-22" x2="0" y2="24" stroke="#c02a1e" stroke-width="2"/>`
		+ `<text y="36" font-size="9" fill="#d8d0c0" text-anchor="middle">COMPASS ${Math.round(deg).toString().padStart(3, '0')}°</text></svg>`;
}
// the mixture: the lever against the best for the height (green), rough either side of it (amber), and what it says
function mixtureGauge(p) {
	const best = mixtureBest(altitude(p));
	const y = (v) => (40 - 80 * v).toFixed(1);
	const band = (from, to, colour) => `<rect x="-9" y="${y(clamp(to, 0, 1))}" width="18" height="${(80 * (clamp(to, 0, 1) - clamp(from, 0, 1))).toFixed(1)}" fill="${colour}"/>`;
	const off = p.mixture - best;
	const word = Math.abs(off) > DIES ? (off > 0 ? 'FLOODING' : 'STARVING') : Math.abs(off) > ROUGH ? (off > 0 ? 'TOO RICH' : 'TOO LEAN') : Math.abs(off) < 0.08 ? 'BEST' : off > 0 ? 'RICH' : 'LEAN';
	const colour = Math.abs(off) > ROUGH ? '#ff6a4d' : Math.abs(off) < 0.08 ? '#7dd67a' : '#f2c46d';
	return `<svg style="width: 70px; height: 92px; display: block;" viewBox="-35 -46 70 92"><rect x="-33" y="-44" width="66" height="88" rx="8" fill="#16130f" stroke="#6b5a3e" stroke-width="3"/>`
		+ `<rect x="-9" y="-40" width="18" height="80" fill="#2a2418"/>` + band(best - DIES, best + DIES, '#7a3a20') + band(best - ROUGH, best + ROUGH, '#8a7a30') + band(best - 0.08, best + 0.08, '#4f9a45')
		+ `<line x1="-14" y1="${y(p.mixture)}" x2="14" y2="${y(p.mixture)}" stroke="#f2f2f2" stroke-width="3"/><text x="-20" y="-32" font-size="7" fill="#a89c88">R</text><text x="-20" y="38" font-size="7" fill="#a89c88">L</text></svg>`
		+ `<div style="text-align: center; font-size: 9px; letter-spacing: 0.06em; color: ${colour}; margin-top: -2px;">MIXTURE<br>${word}</div>`;
}
function showInstruments() {
	const p = flying?.seat == 'pilot' ? flying.plane : null;
	const on = !!p && hunting.hunterLife.alive;
	panel.style.display = on ? 'flex' : 'none';
	const g = flying?.seat == 'gunner' ? flying.plane.rear : null;
	gunnerBox.style.display = g && hunting.hunterLife.alive ? '' : 'none';
	if (g) {
		const key = [g.pan, g.spare, g.changing >= 0, gunnerStats.masked, Math.ceil(flying.plane.health / HEALTH * 20)].join();
		if (key != gunnerShown) {
			gunnerShown = key;
			gunnerBox.innerHTML = vm.ammoHtml({ count: g.pan, carried: g.spare * lewis.PAN, groups: [{ icons: lewis.panPicture(g.pan), label: 'PAN' }],
				state: `${g.spare} SPARE PAN${g.spare == 1 ? '' : 'S'} · AIRFRAME ${Math.ceil(flying.plane.health / HEALTH * 100)}%`, next: g.changing >= 0 ? 'Changing the pan' : gunnerStats.masked ? 'The wings are in the way' : 'Hold left click to fire', message: '' });
		}
	}
	if (!on) return;
	const s = planeState(p);
	const kmh = Math.round(p.airspeed * 3.6), height = Math.round(altitude(p));
	const key = [Math.round(s.heading * 180 / Math.PI), Math.round(s.rpm / 20), Math.round(p.mixture * 50), Math.round(mixtureBest(altitude(p)) * 50), Math.round(p.fuel * 100), Math.round(p.alpha * 180 / Math.PI), kmh, height, p.brake, p.flaps, Math.round(p.trim * 20), p.bombs, Math.ceil(p.bombWait), Math.round(p.throttle * 20), p.vickers, p.engine.on, p.engine.stopped, Math.ceil(p.health / HEALTH * 100)].join();
	if (key == panelShown) return;
	panelShown = key;
	const box = 'padding: 6px; border-radius: 8px; background: rgba(0, 0, 0, 0.45);';
	const aoa = p.airspeed > 5 ? p.alpha * 180 / Math.PI : 0;
	panel.innerHTML = `<div style="${box}">${compass(s.heading)}</div>`
		+ `<div style="${box}">${dial(s.rpm, 0, 2200, [0, 500, 1000, 1500, 2000], 'ENGINE', 'R.P.M.', { red: [1950, 2200], green: [1400, 1850] })}</div>`
		+ `<div style="${box}">${mixtureGauge(p)}</div>`
		+ `<div style="${box}">${dial(p.fuel * 100, 0, 100, [0, 25, 50, 75, 100], 'FUEL', 'per cent', { red: [0, 12] })}</div>`
		+ `<div style="${box}">${dial(aoa, -10, 30, [-10, 0, 10, 20, 30], 'ATTACK', 'degrees', { red: [STALL * 180 / Math.PI, 30], green: [0, 9] })}</div>`
		+ `<div style="${box} font-size: 12px; line-height: 1.55; min-width: 108px;"><div><b>${kmh}</b> km/h air</div><div><b>${height}</b> m high</div><div>Throttle <b>${Math.round(p.throttle * 100)}%</b></div>`
		+ `<div style="color: ${p.brake ? '#f2c46d' : 'rgba(232, 232, 232, 0.6)'};">Brake ${p.brake ? 'ON' : 'off'}</div><div>Flaps <b>${FLAPS.notches[p.flaps]}°</b></div><div>Trim <b>${p.trim == 0 ? 'level' : (p.trim > 0 ? 'nose up ' : 'nose down ') + Math.round(Math.abs(p.trim) * 100) + '%'}</b></div>`
			+ `<div>Vickers <b>${p.vickers}</b></div>` + (p.bombs <= 0 ? '<div style="color: #ff6a4d;">No bombs</div>' : p.bombWait > 0 ? `<div style="color: #f2c46d;">Bombs reloading <b>${Math.ceil(p.bombWait)}</b> s</div>` : `<div>Bombs <b>${p.bombs}</b> set${p.bombs == 1 ? '' : 's'} ready</div>`) + (p.floats ? '<div>On floats</div>' : '')
		+ `<div style="color: ${p.health < HEALTH * 0.35 ? '#ff6a4d' : p.health < HEALTH * 0.7 ? '#f2c46d' : 'rgba(232, 232, 232, 0.85)'};">Airframe <b>${Math.ceil(p.health / HEALTH * 100)}%</b></div>`
		+ (p.engine.on ? '' : `<div style="color: #ff6a4d;">${p.engine.stopped || 'Engine stopped: open the throttle'}</div>`) + `</div>`;
}

// the ring while a plane is refuelled and rearmed on the strip: for whoever is in it, or near it (viewmodel.js's)
const reloadRing = vm.progressRing();
function showReload() {
	const place = hunting.hunterPlace(), m = metre();
	const p = planes.find((one) => one.reload > 0 && (mySeat(one) || Math.hypot(one.p[0] * m - place.x, one.p[2] * m - place.z) < 30 * m));
	if (!p || !place.active) { reloadRing.hide(); return; }
	reloadRing.show(clamp(p.reload / RELOAD_SECONDS, 0, 1), Math.ceil(RELOAD_SECONDS - p.reload), 'RELOADING', 'Refuelling and rearming the biplane');
}
