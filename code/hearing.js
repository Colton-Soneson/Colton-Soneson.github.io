import { settings } from './settings.js';

import * as hunting from './hunting.js'
import * as players from './players.js'
import * as survivalNet from './survivalNet.js'
import { onAnyShot } from './ballistics.js'

/*
	WHAT THE ANIMALS HEAR of the players (deer.js and rabbits.js are spooked by it, beasts.js tracks by it). Each player has two numbers:
		moving	how much noise it is making, however it goes: a share of an ordinary walk (still, crouched, running), and all that is wrong with it on top
		sick	only what is wrong with it (medical.js: a cough), never under 1: how much further than it would the beasts hear it
	The animals live on the host, and a joiner tells it its own when they change (noise). Everyone's place is known (players.js).
	GUNSHOTS (ballistics.js: onAnyShot, every shot fired: the players', anyone else's in the game, the NPCs'): each heard by the animals
	within its round's LOUD (metres, times how keen the animal's ears are), for SHOT_MEMORY seconds. Thrown things and blows are not heard.
	In every game mode but the Horde.
*/
const LOUD = { '7.62x54R': 900, '.303 British': 850, '.303 Vickers': 850, '.45-70': 950, '.45 Colt': 550, '7.63 Mauser': 500, '00 buck': 700, '80mm': 1600, bomb: 1600 };
const SHOT_MEMORY = 3;			// seconds
const shots = [];				// { x, z, at (performance.now() seconds), loud }
onAnyShot((from, round) => {
	const loud = LOUD[round];
	if (!loud || settings.gameMode == 'Horde') return;
	const now = performance.now() / 1000;
	while (shots.length && now - shots[0].at > SHOT_MEMORY) shots.shift();
	shots.push({ x: from[0], z: from[2], at: now, loud });
});
// the newest shot heard at (x, z) (keen: times as far as most hear it) fired after since (performance.now() seconds): { x, z, at } or null
export function gunshotHeard(x, z, since = 0, keen = 1) {
	const m = settings.forestUnitsPerMetre;
	for (let k = shots.length - 1; k >= 0; k--) {
		const S = shots[k];
		if (S.at <= since) break;
		if (Math.hypot(S.x - x, S.z - z) < S.loud * keen * m) return S;
	}
	return null;
}
export const hearingClock = () => performance.now() / 1000;
const mine = { moving: 1, sick: 1 };
let said = { moving: 1, sick: 1 };
const others = new Map();		// id -> { moving, sick }

export function setMine(moving, sick) {
	mine.moving = moving; mine.sick = sick;
	if (Math.abs(moving - said.moving) > 0.1 || Math.abs(sick - said.sick) > 0.05) {
		said = { moving, sick };
		if (survivalNet.role() == 'joined') survivalNet.send('noise', said);
	}
}
survivalNet.on('noise', (m, from) => others.set(from, { moving: Number(m.moving) || 1, sick: Number(m.sick) || 1 }));

// everyone out and alive: [{ id ('me', or a player's number), x, y (its feet), z, moving, sick }]
export function listeners() {
	const out = [], me = hunting.hunterPlace();
	// (only the Survival mode's animals mind the players)
	if (settings.gameMode != 'Hunting') return out;
	if (me.active && hunting.hunterLife.alive && me.on == 'land') out.push({ id: 'me', x: me.x, y: me.y, z: me.z, ...mine });
	for (const o of players.otherList()) if (o.view?.hunting && o.view.alive !== false) out.push({ id: o.id, x: o.view.x, y: o.view.y, z: o.view.z, ...(others.get(o.id) ?? { moving: 1, sick: 1 }) });
	return out;
}
// the nearest who would be heard at (x, z) within reach (world units, for one going at an ordinary walk), or null
export function heardBy(x, z, reach) {
	let best = null, bestD = Infinity;
	for (const L of listeners()) {
		const d = Math.hypot(L.x - x, L.z - z);
		if (d < reach * L.moving && d < bestD) { best = L; bestD = d; }
	}
	return best;
}
export const survivalMode = () => settings.gameMode == 'Hunting';
