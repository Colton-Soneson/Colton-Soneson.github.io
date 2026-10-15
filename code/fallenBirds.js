import { settings } from './settings.js';

/*
	Shot birds: the hawks (birds.js) and the geese (geese.js) both hand theirs over to this. A bird that is hit stops flying:
	its wings go limp and half fold, it tumbles, and it falls under gravity, carried on a little by the way it was flying and
	the push of the shot, the air slowing it, until it comes down on the ground or the water. There it lies on its side
	(LIE_SECONDS), sinks out of sight (SINK_SECONDS) and is gone. A bird shot where it sits (a hawk in its tree, a goose on
	the water) falls from there.
	The bird's own record goes on being used for it (x, y, z, its velocity, heading, nose, bank, beat, beating, folded): it is
	drawn the same way as a living one.

	And its hitbox, for either: balls [x, y, z, radius] in the bird's own space, a wingspan of 1 heading along +z (see each
	file's), turned to the way the bird is flying, nose up or down, and its wings left out while they are folded.
*/
const LIE_SECONDS = 6, SINK_SECONDS = 3;
const GRAVITY = 9.81;

// a bird's hitbox in the world. lift(x, y, z) moves a ball's middle for the bird's own pose first (a goose's neck going up), or null
export function birdSpheres(bird, spheres, size, nose, lift = null) {
	const c = Math.cos(bird.heading), s = Math.sin(bird.heading), cn = Math.cos(-nose), sn = Math.sin(-nose);
	const out = [];
	for (const [x0, y0, z0, r, wing] of spheres) {
		if (wing && bird.folded > 0.5) continue;
		let [x, y, z] = lift ? lift(x0, y0, z0) : [x0, y0, z0];
		// nosed up (about x, as turnX in the shaders), then turned to its heading (turnY)
		[y, z] = [y * cn - z * sn, y * sn + z * cn];
		out.push([bird.x + (x * c + z * s) * size, bird.y + y * size, bird.z + (z * c - x * s) * size, r * size]);
	}
	return out;
}

// a bird just shot: what is kept of it while it falls. velocity: the bullet's, world units a second
export function fallen(bird, velocity) {
	const speed = Math.hypot(...velocity) || 1;
	const push = 5 * settings.forestUnitsPerMetre / speed;
	bird.vx = (bird.vx ?? 0) * 0.6 + velocity[0] * push;
	bird.vy = (bird.vy ?? 0) * 0.3 + velocity[1] * push;
	bird.vz = (bird.vz ?? 0) * 0.6 + velocity[2] * push;
	bird.beating = 0;
	return { bird: bird, t: 0, falling: true, down: 0, spin: (Math.random() < 0.5 ? -1 : 1) * (2 + 3 * Math.random()) };
}

/*
	The fallen moved on a moment. surfaceAt(x, z): the ground or the water there. depth: how far down it goes when it sinks
	(world units). Returns the ones still to be seen
*/
export function moveFallen(list, elapsed, surfaceAt, depth) {
	const metre = settings.forestUnitsPerMetre;
	for (const one of list) {
		const bird = one.bird;
		one.t += elapsed;
		if (one.falling) {
			bird.vy -= GRAVITY * metre * elapsed;
			const drag = Math.exp(-elapsed * 0.5);
			bird.vx *= drag; bird.vz *= drag;
			bird.x += bird.vx * elapsed; bird.y += bird.vy * elapsed; bird.z += bird.vz * elapsed;
			bird.bank += one.spin * elapsed;
			bird.nose += (-0.9 - bird.nose) * Math.min(elapsed * 2, 1);
			bird.folded += (0.45 - bird.folded) * Math.min(elapsed * 3, 1);
			const surface = surfaceAt(bird.x, bird.z);
			if (bird.y <= surface) {
				bird.y = surface;
				one.falling = false;
				one.down = one.t;
				one.side = Math.sign(Math.sin(bird.bank)) || 1;
			}
		} else {
			// lying on its side, then down into the ground
			bird.bank += (1.35 * one.side - bird.bank) * Math.min(elapsed * 5, 1);
			bird.nose += (0 - bird.nose) * Math.min(elapsed * 5, 1);
			bird.folded += (0.6 - bird.folded) * Math.min(elapsed * 3, 1);
			const sinking = Math.min(Math.max((one.t - one.down - LIE_SECONDS) / SINK_SECONDS, 0), 1);
			bird.y = surfaceAt(bird.x, bird.z) - depth * sinking;
		}
		bird.beating = 0;
	}
	return list.filter((one) => one.falling || one.t - one.down < LIE_SECONDS + SINK_SECONDS);
}
