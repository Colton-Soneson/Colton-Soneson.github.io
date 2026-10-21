/*
	How a golf disc flies (discgolf.js throws them; this file is only the sums, in metres and seconds, with no world in it, so the
	course can be laid out from how far one goes too).

	A disc is a spinning wing. Its state: where it is (p), how fast it goes (v), which way its face looks (n: up, for a flat disc), and
	how fast it spins (spin, radians a second: + anticlockwise seen from above, a left handed backhand or a right handed forehand;
	- clockwise, a right handed backhand). Three things act on it:
		gravity		down
		lift		square to its flight, towards its face: 1/2 rho A v^2 CL, CL = CL0 + CLA alpha
		drag		back along its flight: 1/2 rho A v^2 CD, CD = CD0 + CDA (alpha - ALPHA0)^2
	alpha, the angle of attack: how far the air meets its underside (its nose up against its flight). And a pitching moment, nose
	up or down: 1/2 rho A d v^2 CM. On a spinning disc a moment does not pitch it: it turns the disc's face round the way it flies
	(gyroscopic precession), at the moment over (its moment of inertia times its spin). Spinning clockwise (a right handed
	backhand), nose up rolls it to the left: it banks, its lift leans left with it, and it curves left. That is FADE, at the end of
	a flight, slow. Fast, the moment goes nose down for a disc with TURN, and it rolls the other way first.
	Each disc is a set of those numbers (DISCS), made to fly as its flight numbers say (speed, glide, turn, fade): a fairway driver
	goes about 100 metres for a good arm (thrown 7 degrees up, a little nose down), turning a little right, then fading left; a
	midrange about 75, a putter about 55, dead straight and then a gentle fade. (The numbers were searched for until the flights
	came out so: a disc's lift grows with the square of its speed, so one thrown softer goes a good deal less far. See
	speedForPower in discgolf.js for the throw.)
*/
export const RHO = 1.225;
export const GRAVITY = 9.81;
export const MASS = 0.175;
export const RADIUS = 0.106;
const AREA = Math.PI * RADIUS * RADIUS;
const INERTIA = 0.5 * MASS * RADIUS * RADIUS;	// about its spin axis
const ALPHA0 = -4 * Math.PI / 180;				// where its drag is least

// each disc: its lift (CL0, CLA), its drag (CD0, CDA), its moment (CM0 + CMA alpha, less TURN times its speed over turnSpeed squared:
//		nose down the faster it goes), the speed a good arm throws it at (fastest, metres a second), and its flight numbers
export const DISCS = {
	driver: { name: 'Fairway driver', flight: [7, 5, -1, 2], CL0: 0.211, CLA: 6.93, CD0: 0.0418, CDA: 0.754, CM0: 0.02, CMA: 0.267, TURN: 0.0235, turnSpeed: 24, fastest: 25, spin: 75 },
	midrange: { name: 'Midrange', flight: [5, 5, -1, 1], CL0: 0.287, CLA: 5.8, CD0: 0.038, CDA: 2.99, CM0: 0.0256, CMA: 0.558, TURN: 0.0249, turnSpeed: 21, fastest: 21.5, spin: 65 },
	putter: { name: 'Putter', flight: [2, 3, 0, 1], CL0: 0.149, CLA: 7.0, CD0: 0.14, CDA: 1.42, CM0: -0.0021, CMA: 0.0533, TURN: 0.0, turnSpeed: 17, fastest: 17.5, spin: 55 },
};

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => scale(a, 1 / (len(a) || 1));
// v turned about the axis (length 1) by angle
function turnAbout(v, axis, angle) {
	const c = Math.cos(angle), s = Math.sin(angle);
	return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

// A disc thrown: from p, along yaw (radians, as settings.camYaw: 0 to -z, + to the right) and pitch (up), at speed (metres a second),
//		hyzer (radians: + its outside edge down: for a clockwise spin, rolled left), nose (radians, + nose up, against its flight: a
//		thrown disc leaves the hand a little nose down to the way it goes, and its spin holds its face where it is in the air: as its
//		flight bends down the air meets its underside more and more, and it glides), spin (radians a second, - clockwise from above)
export function launch(kind, p, { yaw, pitch, speed, hyzer = 0, nose = -0.03, spin }) {
	const D = DISCS[kind];
	const forward = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
	const right = [Math.cos(yaw), 0, Math.sin(yaw)];
	const level = [Math.sin(yaw), 0, -Math.cos(yaw)];
	// face square to its flight, tipped by its nose, then rolled about the way it goes by its hyzer
	let n = turnAbout(cross(right, forward), right, nose);
	// (hyzer rolls the outside edge down: for a clockwise spin, a right handed backhand, the outside is the right)
	const sideDown = Math.sign(spin ?? -1) || -1;
	n = turnAbout(n, level, sideDown * hyzer);
	return { kind, p: [...p], v: scale(forward, speed), n: unit(n), spin: spin ?? -D.spin * speed / D.fastest, t: 0 };
}

// on through the air by dt seconds (no ground, no trees: see discgolf.js for what it meets)
export function fly(s, dt) {
	const D = DISCS[s.kind];
	const speed = len(s.v);
	if (speed < 1e-4) { s.v[1] -= GRAVITY * dt; s.p = add(s.p, scale(s.v, dt)); s.t += dt; return s; }
	const along = scale(s.v, 1 / speed);
	const sinA = Math.max(Math.min(-dot(along, s.n), 1), -1);
	const alpha = Math.asin(sinA);
	const q = 0.5 * RHO * AREA * speed * speed;
	// lift: towards its face, square to its flight. Drag: back along it
	let liftDir = add(s.n, scale(along, -dot(s.n, along)));
	const ll = len(liftDir);
	liftDir = ll > 1e-6 ? scale(liftDir, 1 / ll) : [0, 1, 0];
	const CL = D.CL0 + D.CLA * alpha;
	const CD = D.CD0 + D.CDA * (alpha - ALPHA0) * (alpha - ALPHA0);
	const force = add(add(scale(liftDir, q * CL), scale(along, -q * CD)), [0, -GRAVITY * MASS, 0]);
	s.v = add(s.v, scale(force, dt / MASS));
	s.p = add(s.p, scale(s.v, dt));
	// the moment: its precession rolls the face round the line of flight
	const CM = D.CM0 + D.CMA * alpha - D.TURN * (speed / D.turnSpeed) ** 2;
	const moment = q * 2 * RADIUS * CM;
	if (Math.abs(s.spin) > 0.5) {
		const rollRate = moment / (INERTIA * s.spin);		// (+ rolls its face to the right about the flight: a nose up moment on a clockwise disc rolls it left)
		s.n = unit(turnAbout(s.n, along, rollRate * dt));
	}
	// the spin slows a little in the air
	s.spin *= Math.exp(-0.05 * dt);
	s.t += dt;
	return s;
}

// for laying out a course: where a disc thrown from the ground lands, on flat ground (metres along, metres to the right)
export function flatThrow(kind, { speed, pitch = 0.12, hyzer = 0, nose = -0.03, height = 1.2 } = {}) {
	const s = launch(kind, [0, height, 0], { yaw: 0, pitch, speed: speed ?? DISCS[kind].fastest, hyzer, nose });
	for (let k = 0; k < 20000 && s.p[1] > 0; k++) fly(s, 1 / 240);
	return { along: -s.p[2], right: s.p[0], seconds: s.t };
}
