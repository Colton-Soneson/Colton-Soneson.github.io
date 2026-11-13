import { settings } from './settings.js';

import * as war from './war.js'
import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as players from './players.js'
import * as town from './town.js'
import * as townFolk from './townFolk.js'
import * as ballistics from './ballistics.js'
import * as help from './controlsHelp.js'
import * as npcs from './npcs.js'
import * as npcPlanes from './npcPlanes.js'
import * as npcRiders from './npcRiders.js'
import * as npcShips from './npcShips.js'
import * as trains from './trains.js'
import * as survivalNet from './survivalNet.js'
import * as atmosphere from './atmosphere.js'
import * as townEconomy from './townEconomy.js'
import { sides } from './sides.js'

/*
	THE WARS OF THE SURVIVAL MODE (settings.gameMode 'Hunting'): the War game mode's fighting (war.js, and its forces: npcPlanes.js, npcRiders.js,
	npcShips.js, the same as ever), between the nations of the towns, in a world that goes on. The War game mode itself is as it was.
		THE NATIONS		a town and every town it has taken (townEconomy.js: its owner, and so on up), by the name of the one at the top of
						them ('n' and its number); or a player's ('p:' and its name), with the towns it has taken
		A WAR			between two nations: the one that began it (the attacker), and the one with the town it is after (the defender, and
						that town its target). One at a time in the world (MOST_WARS), and WAR.grace days between one and the next
		WHO BEGINS ONE	a nation of towns, once its forces come to WAR.ready of what its towns can keep (townEconomy.js: CAPS) and its defense
						budgets to WAR.chest (paid out of them as it begins), goes to war with the town of another nation nearest to any of
						its own. Or a player who is no one's man (with no allegiance), at a town's hall: on that town's nation, as its own
						nation (and with the forces of whatever towns it has taken)
		THE FORCES		each town of either side puts out what its defense budget has bought (townEconomy.js: UNITS), no more: its horsemen,
						its biplanes (their tasks in turn: TASKS) and its schooners (only with a dock, and a way by sea). The attacker's go
						for the target; the defender's for the attacker's town nearest the target (the staging town), or about their own
						town if it has none (a player's), and their first schooner guards its port. A horseman, a crew or a schooner lost is
						lost to its town for good (it does not come back as the War game mode's do: RETIRE seconds on it is gone), and one
						its town buys while the war goes on is sent out (REINFORCE)
		THE TOWNSFOLK	of either side's towns are on their nation's side, and fight as the War game mode's do (MILITIA: war.js's); killed,
						each is one fewer of its town's people (townEconomy.js: folkDied)
		THE END			with WAR.surrender of its houses down the target may give in: every WAR.weigh seconds, if what it has left (its
						nation's forces, weighed by WEIGHT, and its townsfolk) is less than WAR.odds of what the other side has (and its players),
						it does. Every house of it down, or every one of its people dead, it has lost. Either way it is the attacker's
						now (and the towns it held go to the next of them). The attacker's forces all gone, it has lost; WAR.most days on,
						it is over as it stands; a player's nation can make peace when it likes (at a hall). The rebuilding (townEconomy.js)
						waits until it is over
		ABSTRACT		a war for a town whose tile is not here is fought as the world tracker has it (abstractWar): no forces out, the two
					sides weighed against each other, the town going down and the forces lost by that; and ended as any war is
	THE PLAYERS		no one's, until one goes to a town's hall (the library: its clerk, shops.js) and pledges itself to that town's nation;
						it can give that up there whenever it likes. A player that has begun a war is on its own nation's side. Whoever is
						on a side is the other side's enemy, and sees its own side's people blue, the other's red (npcs.js: tint; sides.js:
						the flags). They come back after they are down as the Survival mode has them
	MULTIPLAYER: the host has the wars (as it has the NPCs). Everyone is told what wars there are (swState, every SHARE seconds when it has
	changed, and at once to a joiner as it comes in) and its townsfolk fighting, and hears what is said of them (swSaid). A joiner's
	declaring and making peace go to the host (swDeclare, swPeace). Each player's side goes with its state (net.js: mySide). Who owns which
	town, and who of its people are dead, go with the economy (townEconomy.js).
	Metres and seconds, days by the world's clock (atmosphere.js: sunCycles)
*/
const MOST_WARS = 1;
const WAR = { think: 1 / 8, ready: 0.5, chest: 300, grace: 1, most: 3, surrender: 0.5, weigh: 10, odds: 0.8, over: 20 };
const WEIGHT = { riders: 1, planes: 3, ships: 4, folk: 0.05, player: 4 };
const TASKS = ['defend', 'village', 'ships', 'village', 'defend', 'ships'];
const RETIRE = 20, REINFORCE = 5;
const FOLK_HEALTH = 100, FOLK_HARM = 70;
const MILITIA = { sight: 40, calm: 6, look: 0.3, draw: 0.8 };
const MILITIA_GUNS = [
	{ gun: 'rifle', round: '7.62x54R', spread: 0.012, every: 1.6 },
	{ gun: 'revolver', round: '.45 Colt', spread: 0.03, every: 0.7 },
	{ gun: 'sharps', round: '.45-70', spread: 0.006, every: 2.8 },
];
const SHARE = 1;
const ALLEGIANCE = 'survivalAllegiance';

const metre = () => settings.forestUnitsPerMetre;
const survival = () => settings.gameMode == 'Hunting';
const here = () => survivalNet.authority();
const clock = () => atmosphere.sunCycles;
export const survivalWarStats = { deserted: 0, declared: 0, ended: 0, lost: 0, reinforced: 0, killed: 0, surrendered: 0, taken: 0 };

// THE NATIONS (see the top)
//-------------------------------------------------
const townList = () => terrain.land?.towns ?? [];
const numberOf = (t) => townList().indexOf(t);
// (a town of the world not here counts, as the world tracker keeps it: townEconomy.js)
const lived = (k) => { const t = townList()[k]; return !!t && (town.housesOf(t).length > 0 || townEconomy.tracked(t)) && !townEconomy.stateOf(k)?.ruined; };
const present = (k) => town.housesOf(townList()[k] ?? { buildings: [] }).length > 0;
export function nationOf(k) { const r = townEconomy.rootOf(k); return typeof r == 'string' ? r : 'n' + r; }
export const townsOf = (nation) => townList().map((t, k) => k).filter((k) => lived(k) && nationOf(k) == nation);
export function nationName(nation) {
	if (!nation) return 'no one';
	if (nation.startsWith('p:')) return `${nation.slice(2)}'s nation`;
	return town.townName(Number(nation.slice(1)));
}
const leadOf = (nation) => nation?.startsWith('n') ? Number(nation.slice(1)) : nation;		// (what a town taken by it is owned by: townEconomy.js)
const myName = () => { try { return (localStorage.getItem('huntName') || 'Wanderer').trim().slice(0, 20) || 'Wanderer'; } catch (e) { return 'Wanderer'; } };
export const myNation = () => 'p:' + myName();

// THE WARS: each { id, attacker, defender, target (its town's number), staging (or -1), began (the day), phase 'war' or 'over', outcome, overAt }
let wars = [];					// (on a joiner: as the host said)
let lastEnded = -1e9;
let nextId = 1;
const active = () => wars.filter((w) => w.phase == 'war');
export const warsNow = () => wars.map((w) => ({ ...w }));
export const atWarNation = (nation) => active().some((w) => w.attacker == nation || w.defender == nation);
const enemiesNow = (a, b) => !!a && !!b && a != b && active().some((w) => (w.attacker == a && w.defender == b) || (w.attacker == b && w.defender == a));
townEconomy.atWar.fn = (k) => survival() && atWarNation(nationOf(k));

// THE PLAYERS (see the top): this one's allegiance (a nation, or none), kept in the browser
let allegiance = null;
try { allegiance = localStorage.getItem(ALLEGIANCE) || null; } catch (e) { /* */ }
const keepAllegiance = () => { try { if (allegiance) localStorage.setItem(ALLEGIANCE, allegiance); else localStorage.removeItem(ALLEGIANCE); } catch (e) { /* */ } };
export const allegianceNow = () => allegiance;
// the side this player is on (net.js sends it with its state): its allegiance, or its own nation while that is at war or has towns
export function mySide() {
	if (!survival()) return null;
	if (allegiance) return allegiance;
	const mine = myNation();
	return atWarNation(mine) ? mine : null;
}
export function pledge(k) {
	const nation = nationOf(k);
	if (atWarNation(myNation())) { help.toast('Make peace first: your own nation is at war'); return false; }
	allegiance = nation;
	keepAllegiance();
	help.toast(`You have pledged yourself to ${nationName(nation)}`, 3);
	return true;
}
export function renounce() {
	if (!allegiance) return false;
	help.toast(`You are no longer ${nationName(allegiance)}'s: you are your own man`, 3);
	allegiance = null;
	keepAllegiance();
	return true;
}
// whether a war can be begun now, and why not: '' if it can
export function whyNotWar(attacker, target) {
	if (!lived(target)) return 'There is no town there to go to war with';
	const defender = nationOf(target);
	if (defender == attacker) return 'That is your own';
	if (active().length >= MOST_WARS) return 'There is a war on already';
	const wait = WAR.grace - (clock() - lastEnded);
	if (wait > 0) return `It is too soon after the last war: ${Math.ceil(wait * 24)} hours more`;
	return '';
}
// a player's war on a town's nation (from its hall): the host begins it
export function declareMine(target) {
	if (allegiance) { help.toast('You are pledged to a nation: renounce it first'); return false; }
	const why = whyNotWar(myNation(), target);
	if (why) { help.toast(why); return false; }
	if (here()) begin(myNation(), target);
	else survivalNet.send('swDeclare', { nation: myNation(), target });
	return true;
}
export function peaceMine() {
	const w = active().find((one) => one.attacker == myNation() || one.defender == myNation());
	if (!w) return false;
	if (here()) end(w, 'peace');
	else survivalNet.send('swPeace', { nation: myNation() });
	return true;
}
survivalNet.on('swDeclare', (m) => { if (here() && typeof m.nation == 'string' && m.nation.startsWith('p:') && !whyNotWar(m.nation, Number(m.target))) begin(m.nation.slice(0, 40), Number(m.target)); });
survivalNet.on('swPeace', (m) => { if (!here()) return; const w = active().find((one) => one.attacker == m.nation || one.defender == m.nation); if (w) end(w, 'peace'); });

// THE FORCES (see the top)
//-------------------------------------------------
// each: { kind, k (its town), side, obj (the rider, the flight or the schooner), had (whether it was out last frame), retireAt }
let units = [];
const sideOfWar = (w, nation) => nation == w.attacker ? 'attacker' : 'defender';
const middleOf = (k) => town.townMiddle(townList()[k]);
function nearestOf(list, k) {
	const at = middleOf(k);
	let best = -1, bestD = Infinity;
	for (const j of list) { const mid = middleOf(j), d = Math.hypot(mid.x - at.x, mid.z - at.z); if (d < bestD) { bestD = d; best = j; } }
	return best;
}
const forcesOf = (k) => townEconomy.stateOf(k)?.forces ?? { riders: 0, planes: 0, ships: 0 };
const outOf = (k, kind) => units.filter((u) => u.k == k && u.kind == kind && u.retireAt < 0).length;
// one more of a town's out, for its side of the war
function putOut(w, k, kind) {
	const side = nationOf(k), t = townList()[k], attacking = side == w.attacker;
	const enemy = townList()[attacking ? w.target : (w.staging >= 0 ? w.staging : w.target)];
	const n = outOf(k, kind) + (kind == 'riders' ? aboardOf(k) : 0);
	let obj = null;
	// (horsemen that cannot ride there, over the water: the shipbuilders' to carry, THE SHIPBUILDERS; and those that can go there by the
	//		main line, the trains', BY TRAIN)
	if (kind == 'riders' && attacking && (!overLand(t, enemy) || byTrain(t, enemy))) return null;
	if (kind == 'riders') obj = npcRiders.addWarRider(side, t, enemy, n);
	if (kind == 'planes') obj = npcPlanes.addWarFlight(side, t, enemy, attacking || w.staging >= 0 ? TASKS[n % TASKS.length] : 'defend', n);
	if (kind == 'ships') {
		if (!t.dock) return null;
		const guard = !attacking && (n == 0 || w.staging < 0 || !enemy.dock || !seaWay(t, enemy));
		if (!guard && !seaWay(t, enemy)) return null;
		obj = npcShips.addWarShip(t, side, guard, guard ? null : enemy);
	}
	if (!obj) return null;
	const u = { kind, k, side, obj, had: false, retireAt: -1 };
	units.push(u);
	return u;
}
// THE SHIPBUILDERS: a town at war with one over the water (another land: its horsemen cannot ride there) builds a troop ship at its dock (two
//		shipwrights at work on it, BUILD seconds), one at a time, and puts as many of its horsemen aboard as it has out of the war (they are
//		still its, under its cap), up to BUILD.carry. She lands them at the other town's dock (npcShips.js: A TROOP SHIP), each a horseman of
//		the war there (its unit), and blows up; lost on the way, so are they. Then the next is built
const BUILD = { seconds: 70, carry: 10, wrights: 2 };
const yards = new Map();		// a town's number -> { wrights: [people], built (seconds of work on the one being built), ship, aboard }
const aboardOf = (k) => (yards.get(k)?.aboard ?? 0) + (entrained.get(k)?.aboard ?? 0);
// BY TRAIN (trains.js: A TROOP TRAIN): a town at war with one on the same main line, far enough off (RAIL_WAR.far), sends its horsemen by
//		train, RAIL_WAR.carry at a time, one train at a time; they are landed at the other's station as the war's, and the next goes
const RAIL_WAR = { far: 6000, carry: 10, least: 3 };
const entrained = new Map();		// a town's number -> { train, aboard }
function byTrain(a, b) { const A = town.townMiddle(a), B = town.townMiddle(b); return Math.hypot(A.x - B.x, A.z - B.z) > RAIL_WAR.far && trains.onSameLine(a, b); }
function railTroops(w) {
	for (const k of townsOf(w.attacker)) {
		const t = townList()[k], enemy = townList()[w.target];
		if (!present(k) || !overLand(t, enemy) || !byTrain(t, enemy)) continue;
		let E = entrained.get(k);
		if (!E) entrained.set(k, E = { train: null, aboard: 0 });
		if (E.train && trains.troopTrainDone(E.train)) { E.train = null; E.aboard = 0; }
		if (E.train) continue;
		const spare = forcesOf(k).riders - outOf(k, 'riders') - aboardOf(k);
		if (spare < RAIL_WAR.least) continue;
		const count = Math.min(spare, RAIL_WAR.carry), side = nationOf(k);
		E.train = trains.carryTroops(t, enemy, count, (x, z) => {
			const r = npcRiders.addWarRider(side, t, enemy, outOf(k, 'riders'));
			npcRiders.landWarRider(r, x, z);
			units.push({ kind: 'riders', k, side, obj: r, had: false, retireAt: -1 });
			E.aboard = Math.max(E.aboard - 1, 0);
		});
		if (E.train) { E.aboard = count; survivalWarStats.troopTrains = (survivalWarStats.troopTrains ?? 0) + 1; }
	}
}
export const entrainedForTest = () => [...entrained.entries()].map(([k, E]) => ({ k, aboard: E.aboard, train: !!E.train }));
// (whether a town's horsemen can ride to another: the same land, a continent of the world, world.js)
function overLand(a, b) {
	if (!terrain.world) return true;
	const S = settings.terrainWorldSize, at = (t) => { const M = town.townMiddle(t); return terrain.world.tiles.get(Math.round(M.x / S) + ',' + Math.round(M.z / S))?.continent ?? -1; };
	return at(a) == at(b);
}
function shipbuilders(w, dt) {
	for (const k of townsOf(w.attacker)) {
		const t = townList()[k], enemy = townList()[w.target];
		if (!present(k) || !t.dock || !enemy?.dock || overLand(t, enemy) || !seaWay(t, enemy)) continue;
		let Y = yards.get(k);
		if (!Y) {
			Y = { wrights: [], built: 0, ship: null, aboard: 0 };
			const D = npcShips.dockOf(t), m = settings.forestUnitsPerMetre, { a } = t.dock;
			for (let n = 0; n < BUILD.wrights; n++) {
				const p = npcs.makePerson('shipwright', { hat: 'beanie', gun: 'none', name: 'shipwright' });
				const x = a[0] + (D.out[0] * (4 + n * 3) + D.side[0] * 4) * m, z = a[2] + (D.out[1] * (4 + n * 3) + D.side[1] * 4) * m;
				p.place = { x, y: terrain.land.groundAt(x, z), z, heading: Math.atan2(-D.side[0], -D.side[1]), sit: 0 };
				Y.wrights.push(p);
			}
			yards.set(k, Y);
		}
		// (her horsemen landed or lost: the yard is free)
		if (Y.ship && npcShips.troopShipDone(Y.ship)) {
			const lost = Y.lostCount ?? 0;
			if (lost > 0) { const F = forcesOf(k); F.riders = Math.max(F.riders - lost, 0); survivalWarStats.lost += lost; }
			Y.ship = null; Y.aboard = 0; Y.built = 0;
		}
		if (Y.ship) { Y.lostCount = npcShips.troopsLost(Y.ship); continue; }
		const spare = forcesOf(k).riders - outOf(k, 'riders');
		for (const p of Y.wrights) p.armsDown = spare > 0 ? 0 : 1;
		if (spare <= 0 || (Y.built += dt) < BUILD.seconds) continue;
		const count = Math.min(spare, BUILD.carry), side = nationOf(k);
		Y.ship = npcShips.addTroopShip(t, side, enemy, count, (x, z, n) => {
			const r = npcRiders.addWarRider(side, t, enemy, outOf(k, 'riders'));
			npcRiders.landWarRider(r, x, z);
			units.push({ kind: 'riders', k, side, obj: r, had: false, retireAt: -1 });
			Y.aboard = Math.max(Y.aboard - 1, 0);
		});
		if (Y.ship) { Y.aboard = count; survivalWarStats.troopShips = (survivalWarStats.troopShips ?? 0) + 1; }
		Y.built = 0;
	}
}
function clearYards() { for (const Y of yards.values()) for (const p of Y.wrights) npcs.removePerson(p); yards.clear(); }
export const yardsForTest = () => [...yards.entries()].map(([k, Y]) => ({ k, built: Math.round(Y.built), aboard: Y.aboard, ship: !!Y.ship, wrights: Y.wrights.length }));
// (whether there is a way by sea from one town to another: found once, it is long work)
const seaWays = new Map();
function seaWay(from, to) {
	const key = numberOf(from) + '>' + numberOf(to);
	if (!seaWays.has(key)) seaWays.set(key, !!npcShips.warSeaWay(from, to));
	return seaWays.get(key);
}
function muster(w) {
	for (const nation of [w.attacker, w.defender]) {
		for (const k of townsOf(nation)) {
			// (only a town here puts its forces out: one not here fights as the world tracker has it, ABSTRACT)
			if (!present(k)) continue;
			const F = forcesOf(k);
			for (const kind of ['riders', 'planes', 'ships']) for (let n = outOf(k, kind); n < F[kind]; n++) if (!putOut(w, k, kind)) break;
		}
	}
}
// whether a unit is out (on its horse, in the air, afloat), so its going is a loss
function isOut(u) {
	if (u.kind == 'riders') return u.obj.person.alive;
	if (u.kind == 'planes') return !!u.obj.plane;
	return !!u.obj.boat;
}
function stopComingBack(u) {
	if (u.kind == 'riders') u.obj.person.respawnIn = 1e9;
	if (u.kind == 'planes') u.obj.relaunch = 1e9;
	if (u.kind == 'ships') { u.obj.lostAt = 1e12; for (const p of u.obj.people) if (!p.alive) p.respawnIn = 1e9; }
}
function takeAway(u) {
	if (u.kind == 'riders') npcRiders.removeWarRider(u.obj);
	if (u.kind == 'planes') npcPlanes.removeWarFlight(u.obj);
	if (u.kind == 'ships') npcShips.removeWarShip(u.obj);
}
function watchUnits(now) {
	for (const u of [...units]) {
		const out = isOut(u);
		if (u.had && !out && u.retireAt < 0) {
			// (lost: for good, to its town)
			const F = forcesOf(u.k);
			if (F[u.kind] > 0) F[u.kind]--;
			u.retireAt = now + RETIRE;
			stopComingBack(u);
			survivalWarStats.lost++;
		}
		u.had = out || u.had && u.retireAt < 0;
		if (u.retireAt >= 0 && now >= u.retireAt) { takeAway(u); units.splice(units.indexOf(u), 1); }
	}
	// (more out than its town keeps now, its defense short of their pay: the last of them goes home)
	for (const u of [...units].reverse()) if (u.retireAt < 0 && outOf(u.k, u.kind) > forcesOf(u.k)[u.kind]) { takeAway(u); units.splice(units.indexOf(u), 1); survivalWarStats.deserted++; }
}
const strengthOf = (nation) => townsOf(nation).reduce((sum, k) => { const F = forcesOf(k); return sum + F.riders * WEIGHT.riders + F.planes * WEIGHT.planes + F.ships * WEIGHT.ships; }, 0);

// THE TOWNSFOLK (see the top)
//-------------------------------------------------
const folkHealth = new Map();
const militia = new Map();
const folkSide = (person) => { const k = numberOf(person.town); return k >= 0 && survival() ? nationOf(k) : null; };
const inWar = (side) => !!side && atWarNation(side);
npcs.addTargets((add) => {
	if (!survival() || !active().length) return;
	const m = metre();
	townFolk.folkOut((person) => {
		const p = person.place, side = folkSide(person);
		if (inWar(side)) add({ id: 'folk:' + person.index, kind: 'folk', x: p.x, y: p.y + 1.2 * m, z: p.z, feet: p.y, alive: true, vehicle: null, sit: 0, heading: p.heading, side });
	});
});
// told when one of the townsfolk is hurt or killed: fn(person, who did it (npcs.js: firedBy), killed) (townOpinion.js)
const folkHarmListeners = [];
export function onFolkHarm(fn) { folkHarmListeners.push(fn); }
function harmFolk(index, amount, who = null, person = null) {
	const left = (folkHealth.get(index) ?? FOLK_HEALTH) - amount;
	folkHealth.set(index, left);
	if (person) for (const fn of folkHarmListeners) fn(person, who, left <= 0);
	if (left <= 0) {
		militia.delete(index);
		townFolk.killFolk(index);
		townEconomy.folkDied(index);
		folkHealth.delete(index);
		survivalWarStats.killed++;
	}
}
function onLand(t) {
	const ground = terrain.land.heightAt(t.x, t.z);
	return ground > settings.waterWorldPosY && (t.feet ?? t.y) - ground < 3 * metre();
}
// MILITIA (war.js's): each one out of doors, the nearest of the other side on the land near it shot at
function fightBack(dt) {
	const m = metre(), enemies = npcs.targets().filter((t) => t.alive && t.kind != 'folk' && t.side && onLand(t));
	townFolk.folkOut((person) => {
		const p = person.place, side = folkSide(person);
		if (!inWar(side)) return;
		let f = militia.get(person.index);
		const nearest = (x, z, reach) => {
			let best = null, bestD = reach;
			const eye = [x, p.y + 1.5 * m, z];
			for (const e of enemies) { if (!enemiesNow(e.side, side)) continue; const d = Math.hypot(e.x - x, e.z - z); if (d < bestD && npcs.clearLine(eye, [e.x, e.y, e.z])) { bestD = d; best = e; } }
			return best;
		};
		if (!f) {
			if ((person.index + Math.floor(performance.now() / 300)) % 4 != 0) return;
			const seen = nearest(p.x, p.z, MILITIA.sight * m);
			if (!seen) return;
			f = { G: MILITIA_GUNS[person.index % MILITIA_GUNS.length], x: p.x, y: p.y, z: p.z, heading: p.heading, pitch: 0, next: 0, drawn: 0, calm: 0, target: seen, look: 0 };
			militia.set(person.index, f);
		}
		if ((f.look -= dt) <= 0) { f.target = nearest(f.x, f.z, MILITIA.sight * 1.3 * m); f.look = MILITIA.look; }
		if (!f.target) {
			if ((f.calm += dt) > MILITIA.calm) { militia.delete(person.index); townFolk.setFight(person.index, null, true); return; }
		} else {
			f.calm = 0;
			const t = f.target, want = Math.atan2(t.x - f.x, t.z - f.z), far = Math.hypot(t.x - f.x, t.z - f.z);
			f.heading += npcs.wrap(want - f.heading) * Math.min(dt * 6, 1);
			f.pitch += (Math.atan2(t.y - (f.y + 1.35 * m), far) - f.pitch) * Math.min(dt * 6, 1);
			f.drawn += dt;
			f.next -= dt;
			if (f.drawn > MILITIA.draw && f.next <= 0 && Math.abs(npcs.wrap(want - f.heading)) < 0.1) {
				const muzzle = [f.x + Math.sin(f.heading) * 0.9 * m, f.y + 1.35 * m, f.z + Math.cos(f.heading) * 0.9 * m];
				npcs.fireAt({ id: 'folk:' + person.index }, muzzle, t, { round: f.G.round, spread: f.G.spread, spreadFar: 0.004 });
				f.next = f.G.every;
			}
		}
		townFolk.setFight(person.index, { x: f.x, y: f.y, z: f.z, heading: f.heading, pitch: f.pitch, gun: f.drawn > 0.25 ? f.G.gun : 'none' });
	});
}
function calmAll() { for (const index of militia.keys()) townFolk.setFight(index, null, true); militia.clear(); folkHealth.clear(); }

// what npcs.js, townFolk.js and the flags ask of the war: the Survival mode's here, the War game mode's (war.js) otherwise
//-------------------------------------------------
let warModeOn = npcs.war.on;
Object.defineProperty(npcs.war, 'on', { get: () => warModeOn || (survival() && active().length > 0), set: (v) => { warModeOn = v; }, configurable: true });
const theirs = { sideOf: npcs.war.sideOf, shooterSide: npcs.war.shooterSide, houseFor: npcs.war.houseFor, blastFolk: npcs.war.blastFolk, take: townFolk.folkHit.take, code: sides.code };
npcs.war.sideOf = (id) => {
	if (!survival()) return theirs.sideOf(id);
	if (id === 'me') return mySide();
	return players.otherList().find((other) => other.id == id)?.view?.side ?? null;
};
npcs.war.shooterSide = (id) => {
	if (!survival()) return theirs.shooterSide(id);
	const k = String(id).startsWith('folk:') ? Number(String(id).slice(5)) : -1, person = k >= 0 ? townFolk.folkPerson(k) : null;
	return person ? folkSide(person) : null;
};
npcs.war.enemies = (a, b) => survival() ? enemiesNow(a, b) : a != b;
// (as the one looking stands to it: its own side blue, the other side red, anyone else neither)
const tintOf = (side) => { const mine = mySide(); return !mine ? 0 : side == mine ? 2 : enemiesNow(mine, side) ? 1 : 0; };
Object.defineProperty(npcs.war, 'tint', { get: () => survival() ? tintOf : null, set: () => {}, configurable: true });
sides.code = (team) => survival() && team && team != 'red' && team != 'blue' ? tintOf(team) : theirs.code(team);
// the house of an enemy's town to aim at: of those standing in the towns of the nations at war with side, the war's own first (the
//		target for the attacker, the staging town for the defender), the nearest, the worse for wear the more so
const HURT_FIRST = 300;
npcs.war.houseFor = (side, from) => {
	if (!survival()) return theirs.houseFor?.(side, from) ?? null;
	const w = active().find((one) => one.attacker == side || one.defender == side);
	if (!w) return null;
	const enemy = side == w.attacker ? w.defender : w.attacker, first = side == w.attacker ? w.target : w.staging;
	const list = townsOf(enemy);
	let best = null, bestD = Infinity;
	for (const k of first >= 0 && list.includes(first) ? [first] : list) for (const h of town.housesOf(townList()[k])) {
		if (h.damage >= 1) continue;
		const b = h.building, d = Math.hypot(b.x - from[0], b.z - from[2]) - h.damage * HURT_FIRST * metre();
		if (d < bestD) { bestD = d; best = h; }
	}
	return best && { x: best.building.x, y: best.building.y + best.height * 0.4, z: best.building.z };
};
npcs.war.blastFolk = (at, radius) => {
	if (!survival()) { theirs.blastFolk?.(at, radius); return; }
	if (!active().length || !here()) return;
	townFolk.folkOut((person) => {
		if (!inWar(folkSide(person))) return;
		const p = person.place, d = Math.hypot(p.x - at[0], p.y + metre() - at[1], p.z - at[2]);
		if (d < radius) harmFolk(person.index, 130 * (1 - d / radius));
	});
};
townFolk.folkHit.take = (person, bullet) => {
	if (!survival()) return theirs.take ? theirs.take(person, bullet) : false;
	// (out of a war, a player's round still hurts them: and their town hears of it, townOpinion.js)
	const who = npcs.firedBy(bullet), fighting = active().length && inWar(folkSide(person));
	if (!fighting && (who === null || who === undefined)) return false;
	if (here()) harmFolk(person.index, FOLK_HARM * (ballistics.ROUNDS[bullet?.round]?.damage ?? 1), who, person);
	return true;
};

// THE WAR, from beginning to end (the host's)
//-------------------------------------------------
function begin(attacker, target) {
	const defender = nationOf(target), mine = townsOf(attacker);
	const w = { id: nextId++, attacker, defender, target, staging: mine.length ? nearestOf(mine, target) : -1, began: clock(), phase: 'war', outcome: null, overAt: -1 };
	wars.push(w);
	survivalWarStats.declared++;
	// (a nation of towns pays for it out of their defense)
	if (attacker.startsWith('n')) { let owed = WAR.chest * 100; for (const k of mine) { const s = townEconomy.stateOf(k), paid = Math.min(s.defense, owed); s.defense -= paid; owed -= paid; } }
	muster(w);
	say({ k: 'war', attacker, defender, target, text: `${nationName(attacker)} has declared war on ${nationName(defender)}`, under: `for ${town.townName(target)}` });
	return w;
}
function end(w, outcome) {
	w.phase = 'over';
	w.outcome = outcome;
	w.overAt = performance.now() / 1000;
	lastEnded = clock();
	survivalWarStats.ended++;
	const won = outcome == 'surrendered' || outcome == 'taken';
	if (won) {
		// (the target the attacker's, and the towns it held the next of them's)
		const held = townList().map((t, k) => k).filter((k) => k != w.target && townEconomy.stateOf(k)?.owner === w.target && lived(k));
		if (held.length) { townEconomy.setOwner(held[0], held[0]); for (const k of held.slice(1)) townEconomy.setOwner(k, held[0]); }
		townEconomy.setOwner(w.target, leadOf(w.attacker));
		if (outcome == 'surrendered') survivalWarStats.surrendered++; else survivalWarStats.taken++;
	}
	const text = outcome == 'surrendered' ? `${town.townName(w.target)} has surrendered to ${nationName(w.attacker)}`
		: outcome == 'taken' ? `${nationName(w.attacker)} has taken ${town.townName(w.target)}`
		: outcome == 'beaten' ? `${nationName(w.attacker)}'s forces are spent: ${town.townName(w.target)} holds`
		: outcome == 'peace' ? `${nationName(w.attacker)} and ${nationName(w.defender)} have made peace`
		: `The war for ${town.townName(w.target)} is over: neither side could win it`;
	say({ k: 'end', outcome, attacker: w.attacker, defender: w.defender, target: w.target, text });
	for (const u of units) takeAway(u);
	units = [];
	calmAll();
}
const standingOf = (k) => { const H = town.housesOf(townList()[k]); return H.length ? H.filter((h) => h.damage < 1).length / H.length : abstractStanding.get(k) ?? 1; };
// ABSTRACT (see the top): a war for a town not here, as the world tracker has it. How much of it stands goes down by how the two sides
//		weigh against each other (ABSTRACT.fall a day at the most), and each side loses forces to the other the same way (ABSTRACT.losses a day)
const ABSTRACT = { fall: 0.6, losses: 2 };
const abstractStanding = new Map();
function abstractWar(w, days) {
	const att = Math.max(strengthOf(w.attacker), w.attacker.startsWith('p:') ? WEIGHT.player : 0), def = sideStrength(w.defender), share = att / Math.max(att + def, 1);
	abstractStanding.set(w.target, Math.max((abstractStanding.get(w.target) ?? 1) - ABSTRACT.fall * share * days, 0));
	for (const [nation, against] of [[w.attacker, 1 - share], [w.defender, share]]) {
		let lose = ABSTRACT.losses * against * days;
		for (const k of townsOf(nation)) {
			const F = forcesOf(k);
			for (const kind of ['riders', 'planes', 'ships']) while (lose >= 1 && F[kind] > 0) { F[kind]--; lose--; }
		}
	}
}
// how much a side has left (see THE END at the top): its nation's forces, its townsfolk, its players
function sideStrength(nation) {
	const folk = townsOf(nation).reduce((sum, k) => sum + townEconomy.peopleOf(k).alive, 0);
	const playersOn = (mySide() == nation && hunting.hunterLife.alive ? 1 : 0) + players.otherList().filter((o) => o.view?.side == nation).length;
	return strengthOf(nation) + folk * WEIGHT.folk + playersOn * WEIGHT.player;
}
let thinkDue = -1, weighDue = 0, reinforceDue = 0, shareDue = 0, sharedKey = '';
function think() {
	if (active().length >= MOST_WARS || clock() - lastEnded < WAR.grace) return;
	const nations = [...new Set(townList().map((t, k) => k).filter(lived).map(nationOf))].filter((n) => n.startsWith('n'));
	for (const nation of nations.sort(() => Math.random() - 0.5)) {
		const mine = townsOf(nation);
		let have = 0, most = 0, chest = 0;
		for (const k of mine) {
			const F = forcesOf(k), t = townList()[k];
			have += F.riders + F.planes + F.ships;
			most += townEconomy.CAPS.riders + townEconomy.CAPS.planes + (t.dock || t.surveyed?.dock ? townEconomy.CAPS.ships : 0);
			chest += townEconomy.stateOf(k).defense / 100;
		}
		if (have < WAR.ready * most || chest < WAR.chest) continue;
		// (the nearest town of another nation's)
		const others = townList().map((t, k) => k).filter((k) => lived(k) && nationOf(k) != nation);
		let target = -1, best = Infinity;
		for (const j of others) for (const k of mine) { const a = middleOf(j), b = middleOf(k), d = Math.hypot(a.x - b.x, a.z - b.z); if (d < best) { best = d; target = j; } }
		if (target >= 0) { begin(nation, target); return; }
	}
}
function warsUpdate(dt) {
	const now = performance.now() / 1000, day = clock();
	if (day >= thinkDue) { thinkDue = day + WAR.think; think(); }
	for (const w of active()) {
		// (a nation gone: what was left of it taken, or given up)
		if (!townsOf(w.defender).length || !lived(w.target)) { end(w, 'taken'); continue; }
		if (w.attacker.startsWith('n') && !townsOf(w.attacker).length) { end(w, 'beaten'); continue; }
	}
	watchUnits(now);
	if (!active().length) { if (yards.size) clearYards(); entrained.clear(); return; }
	for (const w of active()) { shipbuilders(w, dt); railTroops(w); }
	fightBack(dt);
	if (now >= reinforceDue) { reinforceDue = now + REINFORCE; for (const w of active()) muster(w); }
	if (now >= weighDue) {
		weighDue = now + WAR.weigh;
		for (const w of active()) {
			if (!present(w.target)) abstractWar(w, WAR.weigh / Math.max(settings.dayLengthSeconds, 1));
			const standing = standingOf(w.target), people = townEconomy.peopleOf(w.target).alive;
			if (standing <= 0 || people <= 0) { end(w, 'taken'); continue; }
			if (standing <= WAR.surrender && sideStrength(w.defender) < WAR.odds * sideStrength(w.attacker)) { end(w, 'surrendered'); continue; }
			if (w.attacker.startsWith('n') && strengthOf(w.attacker) <= 0) { end(w, 'beaten'); continue; }
			if (day - w.began > WAR.most) end(w, 'over');
		}
	}
}

// Per frame
//-------------------------------------------------
let lastTime = performance.now();
export function survivalWarUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	// (out of the Survival mode: whatever war there was put away, as it stood)
	if (!survival() || !terrain.land || !settings.enableTownFolk) {
		if (here() && active().length) { for (const u of units) takeAway(u); units = []; calmAll(); }
		if (yards.size) clearYards();
		show();
		return;
	}
	// (an allegiance to a nation that is no more: none)
	if (allegiance && terrain.land && townEconomy.stateOf(0) && !townsOf(allegiance).length) { allegiance = null; keepAllegiance(); }
	if (here()) {
		if (npcs.on() && npcs.runsHere()) warsUpdate(dt);
		// (the over a while after: shown, then gone)
		wars = wars.filter((w) => w.phase == 'war' || now / 1000 - w.overAt < WAR.over);
		if (now / 1000 >= shareDue) {
			shareDue = now / 1000 + SHARE;
			const state = stateNow(), key = JSON.stringify(state);
			if (key != sharedKey) { sharedKey = key; survivalNet.send('swState', state); }
		}
	}
	show();
}

// MULTIPLAYER (see the top)
//-------------------------------------------------
const r2 = (v) => Math.round(v * 100) / 100;
function stateNow() {
	return { wars: wars.map((w) => ({ id: w.id, attacker: w.attacker, defender: w.defender, target: w.target, staging: w.staging, began: r2(w.began), phase: w.phase, outcome: w.outcome, standing: r2(standingOf(w.target)) })),
		lastEnded: r2(lastEnded), fights: [...militia.entries()].map(([index, f]) => [index, ...[f.x, f.y, f.z, f.heading, f.pitch].map(r2), f.drawn > 0.25 ? f.G.gun : 'none']) };
}
const shownFights = new Set();
survivalNet.on('swState', (m) => {
	if (here()) return;
	const now = performance.now() / 1000;
	wars = (m.wars ?? []).map((w) => ({ id: Number(w.id), attacker: String(w.attacker), defender: String(w.defender), target: Number(w.target), staging: Number(w.staging), began: Number(w.began), phase: w.phase == 'war' ? 'war' : 'over', outcome: w.outcome ?? null, standing: Number(w.standing), overAt: w.phase == 'war' ? -1 : now }));
	lastEnded = Number(m.lastEnded) || -1e9;
	const fights = Array.isArray(m.fights) ? m.fights : [];
	const showing = new Set(fights.map((f) => f[0]));
	for (const index of shownFights) if (!showing.has(index)) townFolk.setFight(index, null, true);
	shownFights.clear();
	for (const [index, x, y, z, heading, pitch, gun] of fights) { townFolk.setFight(index, { x, y, z, heading, pitch, gun }); shownFights.add(index); }
});
survivalNet.onJoin((id) => survivalNet.sendTo(id, 'swState', stateNow()));
// what is said of a war (everyone's): a banner for its beginning and its end
function say(e) { survivalNet.send('swSaid', e); heardSaid(e); }
function heardSaid(e) {
	const mine = mySide(), us = mine && (e.attacker == mine || e.defender == mine);
	if (e.k == 'war') announce('WAR', '#e8e8e8', String(e.text) + (e.under ? ' ' + String(e.under) : ''), 6000);
	if (e.k == 'end') announce(us ? (((e.outcome == 'surrendered' || e.outcome == 'taken') ? e.attacker : e.outcome == 'beaten' ? e.defender : null) == mine ? 'VICTORY' : e.outcome == 'peace' || e.outcome == 'over' ? 'PEACE' : 'DEFEAT') : 'THE WAR IS OVER', '#f2e6c4', String(e.text), 7000);
}
survivalNet.on('swSaid', (m) => { if (!here()) heardSaid(m); });

// What is shown over the picture (as war.js's)
//-------------------------------------------------
const hud = document.createElement('div');
hud.style.cssText = 'position: fixed; left: 50%; top: 14px; transform: translateX(-50%); z-index: 5; pointer-events: none; display: none; padding: 6px 16px; border-radius: 6px; background: rgba(0, 0, 0, 0.5); color: #e8e8e8; font: 13px system-ui, sans-serif; text-align: center; white-space: nowrap; max-width: calc(100vw - 32px); overflow: hidden; text-overflow: ellipsis;';
const banner = document.createElement('div');
banner.style.cssText = 'position: fixed; left: 50%; top: 24%; transform: translateX(-50%); z-index: 5; pointer-events: none; font: 700 46px/1.1 Georgia, "Times New Roman", serif; letter-spacing: 0.06em; text-shadow: 0 0 10px rgba(0, 0, 0, 0.9), 0 0 2px #000; opacity: 0; transition: opacity 0.4s; text-align: center; max-width: calc(100vw - 32px);';
document.body.append(hud, banner);
let bannerTimer = 0, hudShown = '';
function announce(text, colour, under = '', ms = 3200) {
	banner.textContent = text;
	banner.style.color = colour;
	if (under) { const line = document.createElement('div'); line.style.cssText = 'font: 600 18px system-ui, sans-serif; letter-spacing: 0.02em; margin-top: 8px; color: #f2e6c4;'; line.textContent = under; banner.appendChild(line); }
	banner.style.opacity = '1';
	clearTimeout(bannerTimer);
	bannerTimer = setTimeout(() => { banner.style.opacity = '0'; }, ms);
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function show() {
	const on = survival() && hunting.hunterPlace().active && wars.length > 0;
	hud.style.display = on ? '' : 'none';
	if (!on) return;
	const mine = mySide(), colour = (n) => !mine ? '#e8d8b8' : n == mine ? '#6aa8ff' : enemiesNow(mine, n) ? '#ff5a4a' : '#e8d8b8';
	const lines = wars.map((w) => {
		const head = `<span style="color: ${colour(w.attacker)}; font-weight: 600;">${esc(nationName(w.attacker))}</span> against <span style="color: ${colour(w.defender)}; font-weight: 600;">${esc(nationName(w.defender))}</span>`;
		return w.phase == 'war' ? `${head} · ${esc(town.townName(w.target))} ${Math.round((here() ? standingOf(w.target) : w.standing) * 100)}% standing` : `${head} · over`;
	});
	const me = mine ? `You: <span style="color: #6aa8ff; font-weight: 600;">${esc(nationName(mine))}</span>` : 'You: your own man';
	const text = `<div style="font-size: 15px; font-weight: 600;">WAR</div><div>${lines.join('<br>')}</div><div style="font-size: 12px; opacity: 0.85;">${me}</div>`;
	if (text != hudShown) { hudShown = text; hud.innerHTML = text; }
}

// THE HALL (shops.js: the clerk's screen, at the library): the town's nation, the wars, this player's allegiance
//-------------------------------------------------
export function hallHtml(k, button) {
	if (k < 0) return '';
	const nation = nationOf(k), towns = townsOf(nation).map((j) => town.townName(j)), mine = myNation(), mineAtWar = atWarNation(mine);
	const line = (text, note = '') => `<div style="padding:4px 8px;">${text}${note ? ` <span style="font-size:11px; color:#b8a888;">${note}</span>` : ''}</div>`;
	let out = nation == 'n' + k ? line(`${esc(town.townName(k))} answers to no other town`, towns.length > 1 ? `its nation's towns: ${esc(towns.join(', '))}` : '')
		: line(`${esc(town.townName(k))} is held by <b>${esc(nationName(nation))}</b>`, `its nation's towns: ${esc(towns.join(', '))}`);
	const now = active();
	out += now.length ? now.map((w) => line(`At war: <b>${esc(nationName(w.attacker))}</b> against <b>${esc(nationName(w.defender))}</b>, for ${esc(town.townName(w.target))}`, `${Math.round(standingOf(w.target) * 100)}% of it standing`)).join('')
		: line('There is no war on', clock() - lastEnded < WAR.grace ? `no new one for ${Math.ceil((WAR.grace - (clock() - lastEnded)) * 24)} hours` : '');
	const mineTowns = townsOf(mine).map((j) => town.townName(j));
	out += line(allegiance ? `You are pledged to <b>${esc(nationName(allegiance))}</b>` : 'You are your own man: pledged to no one', mineTowns.length ? `your nation's towns: ${esc(mineTowns.join(', '))}` : '');
	let buttons = '';
	if (allegiance != nation && nation != mine) buttons += button('sw:pledge', `Pledge yourself to ${esc(nationName(nation))}`);
	if (allegiance) buttons += button('sw:renounce', 'Give up your allegiance');
	if (!allegiance && nation != mine && !mineAtWar) buttons += button('sw:war', `Declare war on ${esc(nationName(nation))}`);
	if (mineAtWar) buttons += button('sw:peace', 'Make peace');
	return out + `<div style="padding:8px 2px; display:flex; flex-wrap:wrap; gap:6px;">${buttons}</div>`;
}
export function hallAct(act, k) {
	if (act == 'sw:pledge') pledge(k);
	if (act == 'sw:renounce') renounce();
	if (act == 'sw:war') declareMine(k);
	if (act == 'sw:peace') peaceMine();
}

// (the save file's: saveGame.js) the wars on, and when the last was over; put back, each musters again
export const warsRecord = () => ({ wars: active().map((w) => ({ id: w.id, attacker: w.attacker, defender: w.defender, target: w.target, staging: w.staging, began: w.began })), lastEnded, nextId });
export function warsAdopt(r) {
	for (const u of units) takeAway(u);
	units = [];
	calmAll();
	wars = (r?.wars ?? []).filter((w) => typeof w.attacker == 'string' && typeof w.defender == 'string').map((w) => ({ id: Number(w.id), attacker: w.attacker, defender: w.defender, target: Number(w.target), staging: Number(w.staging), began: Number(w.began) || clock(), phase: 'war', outcome: null, overAt: -1 }));
	lastEnded = Number.isFinite(Number(r?.lastEnded)) ? Number(r.lastEnded) : -1e9;
	nextId = Math.max(Number(r?.nextId) || 1, ...wars.map((w) => w.id + 1));
	reinforceDue = 0;
}
// for testing
export const survivalWarForTest = () => ({ ...survivalWarStats, wars: warsNow(), units: units.map((u) => ({ kind: u.kind, k: u.k, side: u.side, out: isOut(u), retiring: u.retireAt >= 0 })), militia: militia.size, allegiance, mySide: mySide(), lastEnded });
export function beginForTest(attacker, target) { return begin(attacker, target); }
export function endForTest(outcome) { const w = active()[0]; if (w) end(w, outcome); }
export function graceForTest() { lastEnded = -1e9; thinkDue = -1; }
export const thinkingForTest = () => ({ thinkDue, day: clock(), lastEnded, active: active().length, npcsOn: npcs.on(), runsHere: npcs.runsHere(),
	nations: [...new Set(townList().map((t, k) => k).filter(lived).map(nationOf))], lived: townList().map((t, k) => lived(k)) });
export const unitsForTest = () => units;
