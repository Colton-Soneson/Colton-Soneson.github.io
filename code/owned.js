import { settings } from './settings.js';

import * as inventory from './inventory.js'
import * as survival from './survival.js'
import * as shops from './shops.js'
import * as help from './controlsHelp.js'
import * as boat from './boat.js'
import * as horse from './horse.js'
import * as radialMenu from './radialMenu.js'
import * as npcShips from './npcShips.js'
import * as npcs from './npcs.js'
import { VESSELS } from './vessels.js'

/*
	WHAT THE PLAYER OWNS (the Survival mode's): a vehicle bought is theirs for good (OWNED: kept in the browser, and in the save file:
	saveGame.js), and brought out with the wheel (T: its Vehicles, survival.js setGarageChoice) wherever they are. One of each out at a
	time: brought out again, the one out before is put away.
		the schooner	bought from a sea captain (shops.js: THE HARBOUR), and launched at his town's dock. From the wheel: on the water the
						crosshair is on (radialMenu.js: launchBoat). Her crew (npcShips.js: hireCrew) aboard her whenever she is out:
						hired from a sea captain too, CREWMAN a man, as many as she has guns and crow's nests (the gunners first)
		the biplane		bought at a landing strip's control tower (controlTower.js), which brings it out (setPlaneOut): at the nearest strip
		the horse		bought from the outfitter (shops.js), brought round to them (horse.js: bringHorse)
	PRICES in dollars.
*/
export const PRICES = { schooner: 400, crewman: 25, plane: 300, horse: 30 };
export const CREW_MOST = VESSELS.Schooner.guns.length + VESSELS.Schooner.nests.length;
const SAVED = 'survivalOwned';

export const owned = { schooner: false, crew: 0, plane: false, horse: false, horsemen: 0, teamOf: {}, formations: [] };	// (horsemen, teamOf, formations: fireteams.js's)
try { Object.assign(owned, JSON.parse(localStorage.getItem(SAVED) ?? '{}')); } catch (e) { /* (none) */ }
owned.crew = Math.min(Math.max(Math.floor(owned.crew) || 0, 0), CREW_MOST);
owned.horsemen = Math.min(Math.max(Math.floor(owned.horsemen) || 0, 0), 12);
if (!owned.teamOf || typeof owned.teamOf != 'object' || Array.isArray(owned.teamOf)) owned.teamOf = {};
if (!Array.isArray(owned.formations)) owned.formations = [];
const keep = () => { try { localStorage.setItem(SAVED, JSON.stringify(owned)); } catch (e) { /* (nowhere to keep it) */ } };
// (the save file's: saveGame.js, as it is kept here)
export const ownedRecord = () => ({ key: SAVED, text: JSON.stringify(owned) });
const ownedListeners = [];
export function onOwnedChange(fn) { ownedListeners.push(fn); }
const changed = () => { keep(); for (const fn of ownedListeners) fn(); };
// one of them set (fireteams.js's), and kept
export function setOwnedValue(key, value) { owned[key] = value; changed(); }

// THE SCHOONER
//-------------------------------------------------
const mySchooner = () => boat.boats.find((b) => b.exists && b.destroyed < 0 && boat.isMine(b) && b.vessel.name == 'Schooner') ?? null;
// her crew aboard her, as many as are hired (the people are run here: alone, or the host)
function crewAboard(b) {
	if (!b || owned.crew <= 0) return;
	if (!npcs.runsHere()) { help.toast('Your crew sails only in a game you host', 3); return; }
	npcShips.hireCrew(b, owned.crew);
}
// launched beside the end of a town's dock (or, with no room there, where the crosshair is), her crew aboard
export function launchAtDock(town) {
	const berth = town?.dock ? npcShips.berthBeside(npcShips.dockOf(town)) : null;
	if (!berth) return bringSchooner();
	for (const old of boat.boats.filter((b) => boat.isMine(b) && b.vessel.name == 'Schooner')) { boat.removeBoat(old); radialMenu.announceSpawn('boat', null, old); }
	const b = boat.spawnBoat(berth.x, berth.z, 'Schooner', { yaw: Math.atan2(Math.sin(berth.course), -Math.cos(berth.course)), anchored: true });
	radialMenu.announceSpawn('boat', b, null);
	crewAboard(b);
	help.toast('Your schooner lies beside the end of the dock, at anchor (G on board to raise it)', 4);
	return true;
}
// from the wheel: on the water the crosshair is on
export function bringSchooner() {
	if (!radialMenu.launchBoat('Schooner')) return false;
	crewAboard(mySchooner());
	return true;
}

// THE BIPLANE: brought out by the control tower (controlTower.js says how: fn() false if it could not)
let planeOut = () => { help.toast('Go to a landing strip'); return false; };
export function setPlaneOut(fn) { planeOut = fn; }

// THE WHEEL (see the top)
survival.setGarageChoice(() => {
	const items = [];
	if (owned.schooner) items.push({ label: 'Schooner', detail: owned.crew ? `Yours, on the water you point at · ${owned.crew} crew aboard` : 'Yours, on the water you point at', act: bringSchooner });
	if (owned.plane) items.push({ label: 'Biplane', detail: 'Yours, at the nearest landing strip', act: () => planeOut() });
	if (owned.horse) items.push({ label: 'Horse', detail: 'Yours, saddled, brought round to you', act: () => horse.bringHorse() });
	return items.length ? { label: 'Vehicles', detail: 'Yours: bring one out', items } : null;
});

// BOUGHT (shops.js: addOffers)
//-------------------------------------------------
export function buy(what, then = null) {
	if (owned[what]) return true;
	if (!inventory.pay(PRICES[what] * 100)) { help.toast('Not enough money'); return false; }
	owned[what] = true;
	changed();
	help.toast(`Yours: the ${what == 'plane' ? 'biplane' : what}. Bring it out any time from T`, 4);
	then?.();
	return true;
}
export function hire() {
	if (owned.crew >= CREW_MOST) { help.toast('She has a man for every gun and nest'); return false; }
	if (!inventory.pay(PRICES.crewman * 100)) { help.toast('Not enough money'); return false; }
	owned.crew++;
	changed();
	// (aboard her now, if she is out)
	const b = mySchooner();
	if (b && npcs.runsHere()) npcShips.hireCrew(b, owned.crew);
	help.toast(`${owned.crew} of ${CREW_MOST} hired: ${owned.crew <= VESSELS.Schooner.guns.length ? 'a gunner' : 'a lookout'}`, 2.5);
	return true;
}
const offer = (id, icon, tint, name, detail, price, label, act) => ({ id, icon, tint, name, detail, price, label, act });
shops.addOffers((tradeName, person) => {
	if (tradeName == 'sea captain') {
		const list = [owned.schooner
			? offer('schooner', 'compass', '#6a5a3a', 'Your schooner', 'Launched beside the end of the dock: her guns and crow\'s nests manned by the crew you hired', null, 'Launch here', () => launchAtDock(person.town))
			: offer('schooner', 'compass', '#6a5a3a', 'A topsail schooner', '18 m, six howitzers and two crow\'s nests. Yours for good: launched here now, and from T wherever there is water', PRICES.schooner * 100, 'Buy', () => buy('schooner', () => launchAtDock(person.town)))];
		list.push(owned.crew >= CREW_MOST
			? offer('crew', 'knife', '#6a6a7a', `Your crew: ${owned.crew} of ${CREW_MOST}`, 'A man on every gun and in every nest. They fire on whoever is hostile to you', null, null, null)
			: offer('crew', 'knife', '#6a6a7a', `Hire a crewman (${owned.crew} of ${CREW_MOST})`, `A ${owned.crew < VESSELS.Schooner.guns.length ? 'gunner for a howitzer' : 'lookout for a crow\'s nest'}: aboard your schooner whenever she is out, firing on whoever is hostile to you. You sail her`, PRICES.crewman * 100, 'Hire', hire));
		return list;
	}
	if (tradeName == 'outfitter') return [owned.horse
		? offer('horse', 'haversack', '#6a4a2a', 'Your horse', 'Brought round for you (and from T, anywhere)', null, 'Bring it', () => horse.bringHorse())
		: offer('horse', 'haversack', '#6a4a2a', 'Saddled horse', 'Yours for good: brought round now, and from T anywhere. Its saddlebags carry the camp (a tent, its stove, its rain collector, two bedrolls)', PRICES.horse * 100, 'Buy', () => buy('horse', () => horse.bringHorse()))];
	return [];
});

// for testing
export function setOwnedForTest(values) { Object.assign(owned, values); changed(); }
