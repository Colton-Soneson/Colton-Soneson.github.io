import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as town from './town.js'
import * as townFolk from './townFolk.js'
import * as treasury from './treasury.js'
import * as survivalNet from './survivalNet.js'
import * as atmosphere from './atmosphere.js'
import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import { BUILDING_TYPES } from './townLayout.js'
import { seasonNow, SEASON_WINTER } from './weather.js'

/*
	THE TOWNS' ECONOMY (the Survival mode's: settings.gameMode 'Hunting'): every town lives off what its businesses bring in, and spends it.
		TAXES		every building of a town still standing pays it so much a day (TAX, by its kind), as much of it as there are people left
					in the town to work it: into the town's account (treasury.js), with what its hunters and whalers bring in
		THE BUDGETS	what is in the account (over FLOAT) is shared out into three, in turn:
						food		first: what it takes to feed everyone FOOD.reserve days (FOOD.head a person a day, FOOD.winter as much
									again in the winter). It is eaten out of every day
						works		the mending and the building again (WORKS): its share of what is left (SHARE.works), to WORKS.most
						defense		the rest: the town's forces (UNITS: horsemen, biplanes, schooners, only with a dock), bought one at a
									time up to its caps (CAPS) and paid for every day they are kept (upkeep). Short of that, one is let go
		THE PEOPLE	one to every building (townFolk.js). With the food stores empty they starve, STARVE of them a day (one at least every
					STARVE_ONE days): so a town that brings in too little to feed everyone dwindles until it can. With them half full and some
					gone, one comes back (or comes to live there) every GROW days. A town starts with its stores full
		AID			a town under another (taken over: its owner, or the town at the top of it) is sent what it is short of by it, if it has it
					to spare: food, when its stores are under half of what it keeps (from the other's, down to half of what that keeps), and
					the money for building a house again when it has one down and cannot pay for it
		RUINS		a town whose people are all gone is ruins: nothing comes in, its budgets are gone and so are its forces, and its houses stand
					as they were left. CLAIM days on, the nearest town with people in it takes it over for nothing (its owner, the town at the
					top of it: war.js's nations), and SETTLE of its own go to live there; from then it grows as any town does
		THE WORKS	every MEND.every seconds each house of it that is hurt and still standing is mended by MEND.amount, for that share of what it
					would cost to build again (costOf); one that is down is built again whole for all of it, REBUILD days after the money is
					paid, one at a time, and not while the town is at war (atWar: war.js's survival wars set it)
	THE WORLD TRACKER (a world of tiles, terrain.js): a town whose tile is not here goes on all the same, as what was last seen of it
					(seen: what its buildings pay in a day, how many people it has, whether it has a dock: each time it is here), or as a
					town of the world mostly is (TRACK) if it has never been. Its taxes, its food, its budgets and its forces as any town's,
					a whale landed every TRACK.whaleEvery days if it has a dock (as its schooner would), and its people starving or coming
					back by number (lost). Nothing is mended or built again: it has no houses here. As it comes, those of its people that
					were lost are its dead (the first of them)
	Everything that comes by the day keeps time by the world's clock (atmosphere.js: sunCycles), times settings.townEconomyPace.
	MULTIPLAYER: the host keeps it all (survivalNet.js: authority). Everyone is told how each town stands (economyIs, ECONOMY_SHARE seconds
	apart when it has changed, and at once to a joiner as it comes in), who of its people are dead with it (townFolk.js: setDead), and
	what is said of it to the players near it (economySaid). The houses' damage goes as town.js sends it. The host keeps it in its browser
	(SAVED) from one visit to the next, by the land's seed.
	Dollars here (cents in the budgets, as in treasury.js)
*/
const TAX = { bakery: 6, library: 2, shack: 4, shop: 5, chapel: 1, hotel: 10, inn: 8, warehouse: 7, tower: 1, townhouse: 1.5, mansard: 3, timbered: 3, turret: 1, cottages: 1, gabled: 2 };	// dollars a day
const FOOD = { head: 0.6, reserve: 2, winter: 0.5 };	// dollars a person a day; days of it kept; more in the winter
const FLOAT = 2000;						// cents left in the account, not shared out
const SHARE = { works: 0.35 };			// of what is left once the food is seen to
const WORKS = { most: 150000 };			// cents the works keep at the most (the rest to defense)
export const UNITS = {
	riders: { name: 'horseman', cost: 40, upkeep: 0.8 },
	planes: { name: 'biplane', cost: 150, upkeep: 3 },
	ships: { name: 'schooner', cost: 300, upkeep: 5 },
};
export const CAPS = { riders: 15, planes: 6, ships: 4 };	// a town's (war.js's FORCES)
const STARVE = 0.25, STARVE_ONE = 1 / 12, GROW = 1 / 6;	// of the people a day, days; days
const CLAIM = 0.5, SETTLE = 3;			// days a ruin lies before it is taken over, and people who go to live there
const MEND = { every: 5, amount: 0.01 };
const REBUILD = { perCubicMetre: 0.15, least: 60, days: 1 / 8 };
const ECONOMY_SHARE = 2;				// seconds
const TRACK = { taxes: 480, people: 160, whale: 300, whaleEvery: 0.5 };	// THE WORLD TRACKER: dollars a day, people, dollars, days
const SAVED = 'townEconomy';
const NEAR_SAID = 300;					// metres: a player this near the town hears what happens to it

const metre = () => settings.forestUnitsPerMetre;
const survivalMode = () => settings.gameMode == 'Hunting';
const pace = () => settings.townEconomyPace ?? 1;
export const economyStats = { aided: 0, taxed: 0, eaten: 0, starved: 0, grown: 0, bought: 0, disbanded: 0, mended: 0, rebuilt: 0, ruined: 0, claimed: 0 };

// every town's: { food, works, defense (cents), forces { riders, planes, ships }, owner (the number of the town at the top of it), ruined,
//		ruinedAt (the day), starve, grow (days towards the next), owed (dollars of taxes not yet paid in), rebuilding ({ house, at }), dead (its people's indexes) }
const towns = new Map();
const blank = (k) => ({ seen: null, lost: 0, whaleDue: 0, fresh: true, food: 0, works: 0, defense: 0, forces: { riders: 0, planes: 0, ships: 0 }, owner: k, ruined: false, ruinedAt: -1, starve: 0, grow: 0, owed: 0, rebuilding: null, dead: [] });
const townList = () => terrain.land?.towns ?? [];
export const townOf = (k) => townList()[k];
export function stateOf(k) {
	if (!townOf(k)) return null;
	let s = towns.get(k);
	if (!s) { s = blank(k); towns.set(k, s); }
	return s;
}
// the town at the top of k (the one that owns it, and so on up), or the player's nation at the top of it (survivalWar.js: 'p:' and its name)
export function rootOf(k) {
	for (let n = 0, at = k; n < 64; n++) { if (typeof at == 'string') return at; const s = stateOf(at); if (!s || s.owner === at) return at; at = s.owner; }
	return k;
}
// a town taken (survivalWar.js): its owner now the town, or the player's nation, that took it
export function setOwner(k, owner) { const s = stateOf(k); if (s) s.owner = owner; }
// one of a town's people killed in a war (survivalWar.js): one fewer of them (townFolk.js is told with the rest: showDead)
export function folkDied(index) {
	const person = townFolk.folkPerson(index), k = person ? treasury.townNumber(person.town) : -1, s = k >= 0 ? stateOf(k) : null;
	if (!s || s.dead.includes(index)) return;
	s.dead.push(index);
	if (peopleOf(k).alive == 0) { ruin(k); say(k, `${town.townName(k)} has fallen: it is ruins`, 6); }
}
// war.js's survival wars: whether a town is at war (no building again while it is)
export const atWar = { fn: () => false };

// THE PEOPLE (see the top)
//-------------------------------------------------
const folkOf = (t) => { const list = []; townFolk.folkEach((p) => { if (p.town === t) list.push(p); }); return list; };
// (THE WORLD TRACKER: what the survey says of a town not yet seen: terrain.js)
terrain.onSurvey(() => {
	townList().forEach((t, k) => {
		const s = stateOf(k);
		if (!t.surveyed || !s || s.seen) return;
		s.seen = { taxes: t.surveyed.types.reduce((n, type) => n + (TAX[BUILDING_TYPES[type].name] ?? 1), 0), people: t.surveyed.types.length, dock: t.surveyed.dock };
	});
});
// (THE WORLD TRACKER: a town of the world not here, by number; one here, each of them)
export const tracked = (t) => !!t && !t.buildings?.length && !!t.tile && !t.none && !!terrain.land?.worldTiles;
export function peopleOf(k) {
	const t = townOf(k), s = stateOf(k);
	if (tracked(t)) { const all = s?.seen?.people ?? TRACK.people; return { all, alive: Math.max(all - (s?.lost ?? 0), 0) }; }
	const all = folkOf(t), dead = new Set(s?.dead ?? []);
	return { all: all.length, alive: all.filter((p) => !dead.has(p.index)).length };
}
// our dead put to townFolk.js (the host's word on a joiner), every town's
let deadShown = '';
function showDead() {
	const list = [...towns.values()].flatMap((s) => s.dead).sort((a, b) => a - b), key = list.join(',');
	if (key == deadShown) return;
	deadShown = key;
	townFolk.setDead(list);
}

// what a house would cost to build again (dollars): by how big it is
export function costOf(h) {
	const b = h.building, m = metre();
	return Math.max(REBUILD.least, (b.width / m) * (b.depth / m) * (h.height / m) * REBUILD.perCubicMetre);
}
const foodNeed = (k, alive) => alive * FOOD.head * (seasonNow.index == SEASON_WINTER ? 1 + FOOD.winter : 1);	// dollars a day

// THE DAY (see the top): the host's, in days of the world's clock
let lastClock = null;
function live(k, t, days) {
	const s = stateOf(k), houses = town.housesOf(t), away = tracked(t);
	// (here: what it is, kept for when it is not; and those lost while it was not here, its dead)
	if (!away) {
		s.seen = { taxes: houses.reduce((n, h) => n + (TAX[BUILDING_TYPES[h.building.type].name] ?? 1), 0), people: folkOf(t).length, dock: !!t.dock };
		if (s.lost > 0) { const dead = new Set(s.dead); s.dead.push(...folkOf(t).filter((p) => !dead.has(p.index)).slice(0, s.lost).map((p) => p.index)); s.lost = 0; }
	}
	const { all, alive } = peopleOf(k);
	if (s.ruined) {
		// (taken over by the nearest with people in it, CLAIM days on)
		if (atmosphere.sunCycles - s.ruinedAt >= CLAIM / pace()) claim(k);
		return;
	}
	// (a town's stores start full)
	if (s.fresh) { s.fresh = false; s.food = Math.round(foodNeed(k, alive) * FOOD.reserve * 100); }
	// TAXES: every building standing, as much of it as there are people to work it
	const working = all ? alive / all : 0;
	let taxes = away ? s.seen?.taxes ?? TRACK.taxes : 0;
	for (const h of houses) if (h.damage < 1) taxes += TAX[BUILDING_TYPES[h.building.type].name] ?? 1;
	s.owed += taxes * working * days;
	// (THE WORLD TRACKER: a whale landed now and then, as its schooner would)
	if (away && s.seen?.dock && (s.whaleDue += days) >= TRACK.whaleEvery) { s.whaleDue = 0; treasury.pay(t, TRACK.whale); }
	if (s.owed >= 5) { const whole = Math.floor(s.owed); s.owed -= whole; treasury.pay(t, whole); economyStats.taxed += whole; }
	// AID: from the town at the top of it, what it is short of
	const root = rootOf(k);
	if (typeof root == 'number' && root != k) aid(k, t, root, alive, houses);
	// the food eaten
	const eaten = Math.round(foodNeed(k, alive) * days * 100);
	economyStats.eaten += Math.min(eaten, s.food) / 100;
	s.food = Math.max(s.food - eaten, 0);
	// THE BUDGETS: what is in the account shared out, the food first
	const spare = treasury.centsOf(k) - FLOAT;
	if (spare > 0 && treasury.take(t, spare / 100)) {
		const toFood = Math.min(spare, Math.max(Math.round(foodNeed(k, Math.max(alive, 1)) * FOOD.reserve * 100) - s.food, 0));
		s.food += toFood;
		const rest = spare - toFood, toWorks = Math.min(Math.round(rest * SHARE.works), Math.max(WORKS.most - s.works, 0));
		s.works += toWorks;
		s.defense += rest - toWorks;
	}
	// the forces: paid for, then one more bought (the kind furthest short of its cap), or one let go
	let upkeep = 0;
	for (const [kind, U] of Object.entries(UNITS)) upkeep += s.forces[kind] * U.upkeep;
	s.defense -= Math.round(upkeep * days * 100);
	if (s.defense < 0) {
		s.defense = 0;
		const dear = Object.keys(UNITS).filter((kind) => s.forces[kind] > 0).sort((a, b) => UNITS[b].cost - UNITS[a].cost)[0];
		if (dear) { s.forces[dear]--; economyStats.disbanded++; }
	} else {
		const kinds = Object.keys(UNITS).filter((kind) => s.forces[kind] < capOf(t, kind)).sort((a, b) => s.forces[a] / capOf(t, a) - s.forces[b] / capOf(t, b));
		const kind = kinds[0];
		if (kind && s.defense >= UNITS[kind].cost * 100) { s.defense -= UNITS[kind].cost * 100; s.forces[kind]++; economyStats.bought++; }
	}
	// THE PEOPLE: starving with the stores empty, coming back with them half full
	if (s.food <= 0 && alive > 0) {
		s.starve += Math.max(alive * STARVE, 1 / STARVE_ONE) * days;
		for (; s.starve >= 1 && !s.ruined; s.starve--) starveOne(k, t);
	} else s.starve = 0;
	if (s.food >= foodNeed(k, Math.max(alive, 1)) * FOOD.reserve * 50 && alive < all) {
		if ((s.grow += days) >= GROW) { s.grow = 0; if (away) s.lost = Math.max(s.lost - 1, 0); else s.dead.shift(); economyStats.grown++; }
	} else s.grow = 0;

	// THE WORKS: one that is down built again (not at war; and not one not here: it has no houses here)
	if (away) return;
	if (s.rebuilding) {
		const h = houses.find((one) => one.index == s.rebuilding.house);
		if (!h || h.damage < 1) s.rebuilding = null;
		else if (atmosphere.sunCycles >= s.rebuilding.at) { town.rebuildHouse(h); s.rebuilding = null; economyStats.rebuilt++; say(k, `${town.townName(k)} has built a house again`); }
	} else if (!atWar.fn(k)) {
		const down = houses.find((h) => h.damage >= 1), cost = down && Math.round(costOf(down) * 100);
		if (down && s.works >= cost) { s.works -= cost; s.rebuilding = { house: down.index, at: atmosphere.sunCycles + REBUILD.days / pace() }; }
	}
}
function aid(k, t, root, alive, houses) {
	const s = stateOf(k), R = stateOf(root), keep = (j, n) => Math.round(foodNeed(j, Math.max(n, 1)) * FOOD.reserve * 100);
	// (it shares its stores down to half what it keeps: its taxes fill them again)
	const want = keep(k, alive), short = Math.round(want / 2) - s.food, spare = R.food - Math.round(keep(root, peopleOf(root).alive) / 2);
	if (short > 0 && spare > 0) { const sent = Math.min(want - s.food, spare); R.food -= sent; s.food += sent; economyStats.aided += sent / 100; }
	const down = !s.rebuilding && houses.find((h) => h.damage >= 1);
	if (down && !atWar.fn(k)) {
		const cost = Math.round(costOf(down) * 100), need = cost - s.works;
		if (need > 0 && R.works >= need) { R.works -= need; s.works += need; economyStats.aided += need / 100; }
	}
}
const capOf = (t, kind) => kind == 'ships' && !t.dock && !t.surveyed?.dock ? 0 : CAPS[kind];	// (a town not here: as the survey found it, terrain.js)
function starveOne(k, t) {
	const s = stateOf(k);
	if (tracked(t)) {
		const left = peopleOf(k).alive;
		if (left <= 0) return;
		s.lost++;
		economyStats.starved++;
		if (left == 1) ruin(k);
		return;
	}
	const dead = new Set(s.dead), living = folkOf(t).filter((p) => !dead.has(p.index));
	if (!living.length) return;
	const p = living[Math.floor(Math.random() * living.length)];
	s.dead.push(p.index);
	economyStats.starved++;
	if (living.length == 1) {
		ruin(k);
		say(k, `${town.townName(k)} has starved: it is ruins`, 6);
	} else say(k, `${town.townName(k)} is starving: the food stores are empty`);
}
function ruin(k) {
	const s = stateOf(k);
	Object.assign(s, { ruined: true, ruinedAt: atmosphere.sunCycles, food: 0, works: 0, defense: 0, forces: { riders: 0, planes: 0, ships: 0 }, rebuilding: null, starve: 0, grow: 0 });
	// (and whatever it owned is its own again)
	for (const [j, o] of towns) if (j != k && o.owner === k) o.owner = j;
	economyStats.ruined++;
}
// a ruin taken over: by the nearest town with people in it, for nothing
function claim(k) {
	const t = townOf(k), at = town.townMiddle(t);
	let best = null, bestD = Infinity;
	townList().forEach((other, j) => {
		if (j == k || stateOf(j).ruined || (!town.housesOf(other).length && !tracked(other))) return;
		const mid = town.townMiddle(other), d = Math.hypot(mid.x - at.x, mid.z - at.z);
		if (d < bestD) { bestD = d; best = j; }
	});
	if (best === null) return;
	const s = stateOf(k);
	s.ruined = false;
	s.ruinedAt = -1;
	s.owner = rootOf(best);
	s.dead.splice(0, SETTLE);
	economyStats.claimed++;
	say(k, `${town.townName(best)} has taken over the ruins of ${town.townName(k)}`, 5);
}
// THE WORKS: the hurt houses mended a little, as the works can pay for it
function mendAll() {
	townList().forEach((t, k) => {
		const s = stateOf(k);
		if (s.ruined) return;
		for (const h of town.housesOf(t)) {
			if (h.damage <= 0 || h.damage >= 1) continue;
			const amount = Math.min(MEND.amount * pace(), h.damage), cost = Math.round(costOf(h) * amount * 100);
			if (s.works < cost) break;
			s.works -= cost;
			town.mendHouse(h, amount);
			economyStats.mended++;
		}
	});
}

// what is said of a town, to the players near it (everyone's)
function say(k, text, seconds = 4) {
	const mid = town.townMiddle(townOf(k));
	survivalNet.send('economySaid', { text, at: [mid.x, mid.z], seconds });
	heardSaid(text, [mid.x, mid.z], seconds);
}
function heardSaid(text, at, seconds) {
	const p = hunting.hunterPlace();
	if (p.active && Math.hypot(p.x - at[0], p.z - at[1]) < NEAR_SAID * metre()) help.toast(text, seconds);
}
survivalNet.on('economySaid', (m) => { if (!survivalNet.authority() && Array.isArray(m.at)) heardSaid(String(m.text ?? ''), m.at.map(Number), Number(m.seconds) || 4); });

// Per frame
//-------------------------------------------------
const LIVE_EVERY = 0.5;					// seconds between the towns' days being lived (what has gone by of them, all at once)
let shareDue = 0, mendDue = 0, liveDue = 0, sharedKey = '', wasSurvival = false;
export function economyUpdate() {
	const land = terrain.land;
	if (!land) return;
	load();
	if (!survivalMode() || !settings.enableTownFolk) { wasSurvival = false; lastClock = null; return; }
	// (back in the Survival mode from another: our dead put back, the other's put right)
	if (!wasSurvival) { wasSurvival = true; deadShown = ''; }
	showDead();
	if (!survivalNet.authority()) return;
	const now = performance.now() / 1000;
	if (now >= liveDue) {
		liveDue = now + LIVE_EVERY;
		const clock = atmosphere.sunCycles, days = lastClock === null ? 0 : Math.min(Math.max(clock - lastClock, 0), 2) * pace();
		lastClock = clock;
		if (days > 0) townList().forEach((t, k) => { if (town.housesOf(t).length || tracked(t)) live(k, t, days); });
	}
	if (now >= mendDue) { mendDue = now + MEND.every; mendAll(); }
	if (now >= shareDue) {
		shareDue = now + ECONOMY_SHARE;
		const state = everything(), key = JSON.stringify(state);
		if (key != sharedKey) { sharedKey = key; survivalNet.send('economyIs', state); save(); }
	}
}

// MULTIPLAYER, and what is kept (see the top)
//-------------------------------------------------
const record = (s) => ({ seen: s.seen && { ...s.seen }, lost: s.lost, whaleDue: s.whaleDue, fresh: s.fresh, food: s.food, works: s.works, defense: s.defense, forces: { ...s.forces }, owner: s.owner, ruined: s.ruined, ruinedAt: s.ruinedAt, starve: s.starve, grow: s.grow, owed: s.owed, rebuilding: s.rebuilding && { ...s.rebuilding }, dead: [...s.dead] });
function adopt(list) {
	towns.clear();
	for (const [k, r] of list ?? []) {
		const s = blank(Number(k));
		for (const key of ['food', 'works', 'defense', 'owner', 'ruinedAt', 'starve', 'grow', 'owed']) if (Number.isFinite(Number(r?.[key]))) s[key] = Number(r[key]);
		if (typeof r?.owner == 'string' && r.owner.startsWith('p:')) s.owner = r.owner.slice(0, 40);
		s.ruined = !!r?.ruined;
		s.fresh = !!r?.fresh;
		s.lost = Math.max(0, Math.floor(Number(r?.lost) || 0));
		s.whaleDue = Number(r?.whaleDue) || 0;
		s.seen = r?.seen && Number.isFinite(Number(r.seen.taxes)) ? { taxes: Number(r.seen.taxes), people: Math.max(0, Math.floor(Number(r.seen.people) || 0)), dock: !!r.seen.dock } : null;
		for (const kind of Object.keys(UNITS)) s.forces[kind] = Math.max(0, Math.floor(Number(r?.forces?.[kind]) || 0));
		s.rebuilding = r?.rebuilding && Number.isFinite(Number(r.rebuilding.house)) ? { house: Number(r.rebuilding.house), at: Number(r.rebuilding.at) || 0 } : null;
		s.dead = Array.isArray(r?.dead) ? r.dead.map(Number).filter(Number.isFinite) : [];
		towns.set(Number(k), s);
	}
}
export const everything = () => ({ list: [...towns.entries()].map(([k, s]) => [k, record(s)]) });
survivalNet.on('economyIs', (m) => { if (!survivalNet.authority()) { adopt(m.list); listeners.forEach((fn) => fn()); } });
survivalNet.onJoin((id) => survivalNet.sendTo(id, 'economyIs', everything()));
const listeners = [];
export function onChange(fn) { listeners.push(fn); }

const savedKey = () => SAVED + ':' + (settings.terrainSeed ?? 0);
let loadedFor = null;
function load() {
	if (loadedFor === savedKey()) return;
	loadedFor = savedKey();
	towns.clear();
	try { adopt(JSON.parse(localStorage.getItem(loadedFor) ?? '{"list":[]}').list); } catch (e) { /* (none) */ }
	deadShown = '';
}
function save() {
	if (!survivalNet.authority()) return;
	try { localStorage.setItem(savedKey(), JSON.stringify(everything())); } catch (e) { /* */ }
	listeners.forEach((fn) => fn());
}
// (the save file's: survivalSave.js)
export function economyRecord() { load(); return { key: savedKey(), text: JSON.stringify(everything()) }; }
export function economyAdopt(state) { adopt(state?.list); loadedFor = savedKey(); deadShown = ''; save(); }

// for the banker's screen (shops.js): how a town stands, in dollars
export function summaryOf(k) {
	const s = stateOf(k);
	if (!s) return null;
	const people = peopleOf(k), need = foodNeed(k, Math.max(people.alive, 1));
	return { food: s.food / 100, works: s.works / 100, defense: s.defense / 100, forces: { ...s.forces }, people, ruined: s.ruined, owner: s.owner, root: rootOf(k),
		foodDays: s.food / 100 / need, starving: s.food <= 0 && people.alive > 0, rebuilding: !!s.rebuilding };
}

// for testing
export const economyForTest = () => ({ ...economyStats, towns: [...towns.entries()].map(([k, s]) => ({ k, ...record(s), people: peopleOf(k) })) });
export function setForTest(k, values) { Object.assign(stateOf(k), values); }
export function starveForTest(k) { const t = townOf(k); if (t) starveOne(k, t); }
