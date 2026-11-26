import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as transformations from './transformations.js'
import * as inventory from './inventory.js'
import * as npcs from './npcs.js'
import * as radialMenu from './radialMenu.js'
import * as fireteams from './fireteams.js'
import * as help from './controlsHelp.js'

/*
	THE COMMAND WHEEL (B, held, in the Survival mode: radialMenu.js's other wheel): the player's fireteams (fireteams.js), each with anyone
	in it (and All of them), and under each what it can be told (fireteams.js: THE COMMANDS): Formation (a ring of them: formed up on
	the player in it), Charge, Fire at will, Hold, Retreat. A water team (the schooner) has no formation. What was told is said in the
	middle of the picture. Where the player looks (lookPoint: the ground or the water the crosshair is on, within LOOK_REACH) is where a
	charge goes with no one to charge at.
*/
const LOOK_REACH = 400;		// metres

const metre = () => settings.forestUnitsPerMetre;
// where the crosshair is on the ground or the water, [x, z] world units, or null (the sky, or further than LOOK_REACH)
function lookPoint() {
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ], look = transformations.getCameraForward(), m = metre();
	if (!terrain.land) return null;
	const surface = (x, z) => Math.max(terrain.land.heightAt(x, z), settings.waterWorldPosY);
	for (let d = 2 * m; d < LOOK_REACH * m; d += 2 * m) {
		const x = eye[0] + look[0] * d, y = eye[1] + look[1] * d, z = eye[2] + look[2] * d;
		if (y <= surface(x, z)) return [x, z];
	}
	return null;
}
function tell(n, what) {
	const r = fireteams.command(n, what, lookPoint());
	help.toast(r.said, 3);
	return r.ok;
}
// a team's ring: what it can be told (n: 0, all of them)
function ordersFor(n) {
	const land = n == 0 ? [1, 2, 3, 4].some((k) => fireteams.modeOf(k) == 'land') : fireteams.modeOf(n) == 'land';
	const items = [];
	if (land) items.push({ label: 'Formation', detail: 'Formed up on you', items: Object.entries(fireteams.FORMATIONS).map(([key, F]) => (
		{ label: F.name, detail: F.about, act: () => tell(n, 'form:' + key) })) });
	items.push(
		{ label: 'Charge', detail: 'At the nearest foe, or where you look', act: () => tell(n, 'charge') },
		{ label: 'Fire at will', detail: 'After anyone hostile they see', act: () => tell(n, 'fire') },
		{ label: 'Hold', detail: 'Where they are: shooting only at those within reach', act: () => tell(n, 'hold') },
		{ label: 'Retreat', detail: 'Back to you, fighting no one on the way', act: () => tell(n, 'retreat') },
	);
	return items;
}
function top() {
	const teams = [1, 2, 3, 4].filter((k) => fireteams.modeOf(k));
	return { label: 'Command', items: [
		...teams.map((k) => ({ label: `Team ${k}`, detail: fireteams.modeOf(k) == 'water' ? 'Your schooner' : 'Horsemen', items: ordersFor(k) })),
		...(teams.length > 1 ? [{ label: 'All', detail: 'Every team', items: ordersFor(0) }] : []),
	] };
}
// it opens in the Survival mode, out on foot and alive, with a team that has anyone in it
function canOpen() {
	if (!inventory.survivalOn() || settings.gameMode == 'Observe' || !hunting.hunterPlace().active || !hunting.hunterLife.alive) return false;
	if (!npcs.runsHere()) { help.toast('Your men ride only in a game you host', 3); return false; }
	if (![1, 2, 3, 4].some((k) => fireteams.modeOf(k))) { help.toast('No one to command: hire horsemen at an inn, and put them in a fireteam on the journal\'s Enlisted page', 4); return false; }
	return true;
}
radialMenu.addWheel('KeyB', top, canOpen);
// for testing
export const lookPointForTest = () => lookPoint();
