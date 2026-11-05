import { settings } from './settings.js';
import * as hunting from './hunting.js'
import * as players from './players.js'

/*
	RATES: how often a thing far from everyone is moved on. A thing no one is near can be a frame or more behind, and catch up (Game Engine
	Architecture 14.6.4.2: AI that updates only every few seconds). Within `seen` of anyone (the camera, the walker, the others in a game)
	a thing is moved on every frame, as ever. Further off, out past where it is drawn, every few frames, the further the fewer (BANDS):
	each on a frame of its own among the few (its slot in a ring of frames, so that they do not all come due at once), and moved on then by
	all the time since it last was. So where it gets to is the same, in fewer steps; and nothing out there is seen.
		rateFrame()						once a frame, before anything asks (rotatingCube.js): where everyone is, and the frame counted
		stepFor(thing, x, z, dt, seen)	the seconds to move the thing (it is at x, z) on by this frame, dt the frame's: 0 if not its frame
*/
const BANDS = [[1, 4], [2, 16], [4, 60]];		// further than seen times the first: every the second frames
const MOST = 1.5;								// seconds a thing is moved on by at once at the most (what is left over, the next time)

let frame = 0, viewers = [];
export const rateStats = { moved: 0, skipped: 0 };
export function rateFrame() {
	frame++;
	viewers = [[settings.camPosX, settings.camPosZ]];
	const me = hunting.hunterPlace();
	if (me.active) viewers.push([me.x, me.z]);
	for (const other of players.otherList()) if (other.view) viewers.push([other.view.x, other.view.z]);
	rateStats.moved = 0;
	rateStats.skipped = 0;
}
let nextSlot = 0;
export function stepFor(thing, x, z, dt, seen) {
	thing.owed = (thing.owed ?? 0) + dt;
	// (how far the nearest of them is, across the square round it: never more than the true distance, so nothing seen is ever slowed)
	let away = Infinity;
	for (const [vx, vz] of viewers) away = Math.min(away, Math.max(Math.abs(x - vx), Math.abs(z - vz)));
	let every = 1;
	for (const [far, frames] of BANDS) if (away > seen * far) every = frames;
	if (every > 1 && (frame + (thing.slot ??= nextSlot++)) % every != 0) {
		rateStats.skipped++;
		return 0;
	}
	const step = Math.min(thing.owed, MOST);
	thing.owed -= step;
	rateStats.moved++;
	return step;
}
