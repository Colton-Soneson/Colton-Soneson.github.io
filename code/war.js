import { settings } from './settings.js';

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

/*
	THE WAR game mode: two of the towns (the first two that have houses: SIDES, red the first, blue the second) at war with each other,
	each with its forces (FORCES), the players on whichever side each chose. With fewer than two towns, or the NPCs off, it cannot be.
		THE FORCES, each side's, all of them npcs.js's people on its side (npcs.war)
			planes		npcPlanes.js (addWarFlight): two defend their own town, two go for the other's houses with their bombs, two
						for its schooners; up again a minute after they are lost
			horsemen	npcRiders.js (addWarRider): out of their own town's inn, after the other's townsfolk; back on a new horse at the
						inn after they are down, to ride over again
			schooners	npcShips.js (addWarShip): out of their own town's dock, shelling the other's houses; the next sails 5 seconds
						after one is lost. None for a side whose town has no dock, or no way by sea to the other's (npcShips.warSeaWay):
						it has FORCES.noSea more planes instead, for the other's houses, and it is said as the war begins
		THE TOWNSFOLK are on their own town's side. They are not killed by a round of their own side's townsfolk, but by anything else of
			FOLK_HEALTH (a hit in the chest of FOLK_HARM, times the round's), a shell, a bomb; killed, they do not come back until it is over.
			They fight as the horde's townsfolk do (horde.js: MILITIA): one out of doors with one of the other side's within MILITIA.sight
			(on the land) takes out its gun, stands and shoots at it, and goes home once there have been none about for MILITIA.calm. And
			every REPAIR.every seconds each house of theirs that is hurt and still standing is mended by REPAIR.amount if one of them is out
			within REPAIR.near of it (town.js: mendHouse).
		THE PLAYERS choose their side (THE CHOICE, as it begins: a button for each side, or 1 and 2). One with none chosen is no one's
			enemy. They come back after they are down in their own town. Hits on their own side count (team damage). Each NPC is drawn
			bright red if it is on the other side to the one looking, bright blue if on its own; the planes and the schooners' flags are
			in their side's colour.
		THE END: when the last house of a town is down, the other side has won. OVER_SECONDS later the game mode is Hunting again, the
			forces gone, the towns whole and their people all back.
	MULTIPLAYER: the host runs it (as it runs the NPCs: npcs.js); what it is doing goes to everyone (warState, warHeard: the sides, how
	much of each town stands, the townsfolk fighting and the dead), and the game mode with it (net.js). Each player's side goes with its
	state (net.js: myState), so the host knows who is whose enemy.
	Metres and seconds (the world in world units)
*/
const SIDES = ['red', 'blue'];
const FORCES = { planes: ['defend', 'defend', 'village', 'village', 'ships', 'ships'], riders: 15, ships: 4, noSea: 4 };	// noSea: more planes for a side with no schooners
const FOLK_HEALTH = 100, FOLK_HARM = 70;
const MILITIA = { sight: 40, calm: 6, look: 0.3, draw: 0.8 };
// the townsfolk's guns (as horde.js's): the round, how far off they aim (radians), seconds between shots
const MILITIA_GUNS = [
	{ gun: 'rifle', round: '7.62x54R', spread: 0.012, every: 1.6 },
	{ gun: 'revolver', round: '.45 Colt', spread: 0.03, every: 0.7 },
	{ gun: 'sharps', round: '.45-70', spread: 0.006, every: 2.8 },
];
const REPAIR = { every: 5, amount: 0.01, near: 20 };
const OVER_SECONDS = 25;

const metre = () => settings.forestUnitsPerMetre;
const warMode = () => settings.gameMode == 'War';

// what net.js says of this machine: 'off', 'host' or 'joined'; and a player's side, of the others (by its state)
export const warNet = { role: 'off' };
const joined = () => warNet.role == 'joined';

export const warStats = { phase: 'off', fighting: 0, killed: 0, mended: 0, standing: [] };
const war = { phase: 'off', sides: [], winner: null, timer: 0, repair: 0, check: 0 };	// off, war, over. sides: [{ side, town, name, houses }]
let mySide = null;			// this player's side ('red', 'blue' or null: none chosen yet)
let shared = null;			// joiner: the host's word on it (warState)
const folkHealth = new Map();	// townsperson's index -> health (the host's)
const militia = new Map();		// townsperson's index -> { gun, x, y, z, heading, pitch, next, drawn, calm, target, look }

// THE SIDES
//-------------------------------------------------
const sideOfTown = (t) => war.sides.find((s) => s.town === t)?.side ?? null;
const sideOf = (side) => war.sides.find((s) => s.side == side);
const otherSide = (side) => side == 'red' ? 'blue' : 'red';
npcs.war.sideOf = (id) => {
	if (id === 'me') return mySide;
	return players.otherList().find((other) => other.id == id)?.view?.side ?? null;
};
npcs.war.shooterSide = (id) => {
	const k = String(id).startsWith('folk:') ? Number(String(id).slice(5)) : -1;
	return k >= 0 ? sideOfTown(townFolk.folkPerson(k)?.town) : null;
};
// the house of the other side's town to aim at from (world units): of those still standing, the nearest, the worse for wear the more so
//		(HURT_FIRST metres nearer for all of it), so a house is finished off before it is mended; where to aim, its middle
const HURT_FIRST = 300;
npcs.war.houseFor = (side, from) => {
	const enemy = sideOf(otherSide(side));
	if (!enemy) return null;
	let best = null, bestD = Infinity;
	for (const h of enemy.houses) {
		if (h.damage >= 1) continue;
		const b = h.building, d = Math.hypot(b.x - from[0], b.z - from[2]) - h.damage * HURT_FIRST * metre();
		if (d < bestD) { bestD = d; best = h; }
	}
	return best && { x: best.building.x, y: best.building.y + best.height * 0.4, z: best.building.z };
};
// this player's side, as its state sends it (net.js)
export const mySideNow = () => war.phase != 'off' || shared?.on ? mySide : null;

// THE TOWNSFOLK (see the top)
//-------------------------------------------------
// each out of doors as something for the other side to fight (npcs.js)
npcs.addTargets((add) => {
	if (war.phase != 'war') return;
	const m = metre();
	townFolk.folkOut((person) => {
		const p = person.place, side = sideOfTown(person.town);
		if (side) add({ id: 'folk:' + person.index, kind: 'folk', x: p.x, y: p.y + 1.2 * m, z: p.z, feet: p.y, alive: true, vehicle: null, sit: 0, heading: p.heading, side });
	});
});
// a hit on one (townFolk.js): the host takes it off its health; elsewhere nothing (the host sees it too)
townFolk.folkHit.take = (person, bullet) => {
	if (war.phase != 'war') return false;
	if (!joined()) harmFolk(person.index, FOLK_HARM * (ballistics.ROUNDS[bullet?.round]?.damage ?? 1));
	return true;
};
// a shell's burst: every one of them within radius (world units) of it hurt by how near
npcs.war.blastFolk = (at, radius) => {
	if (war.phase != 'war' || joined()) return;
	townFolk.folkOut((person) => {
		const p = person.place, d = Math.hypot(p.x - at[0], p.y + metre() - at[1], p.z - at[2]);
		if (d < radius) harmFolk(person.index, 130 * (1 - d / radius));
	});
};
function harmFolk(index, amount) {
	const left = (folkHealth.get(index) ?? FOLK_HEALTH) - amount;
	folkHealth.set(index, left);
	if (left <= 0) {
		militia.delete(index);
		townFolk.killFolk(index);
		warStats.killed++;
	}
}
// MILITIA (see the top): each one out of doors, the nearest of the other side on the land near it shot at
function fightBack(dt) {
	const m = metre(), enemies = npcs.targets().filter((t) => t.alive && t.kind != 'folk' && t.side && onLand(t));
	let fighting = 0;
	townFolk.folkOut((person) => {
		const p = person.place, side = sideOfTown(person.town);
		if (!side) return;
		let f = militia.get(person.index);
		const nearest = (x, z, reach) => {
			let best = null, bestD = reach;
			for (const e of enemies) { if (e.side == side) continue; const d = Math.hypot(e.x - x, e.z - z); if (d < bestD) { bestD = d; best = e; } }
			return best;
		};
		if (!f) {
			if ((person.index + Math.floor(performance.now() / 300)) % 4 != 0) return;		// (each looks round now and then)
			const seen = nearest(p.x, p.z, MILITIA.sight * m);
			if (!seen) return;
			const G = MILITIA_GUNS[person.index % MILITIA_GUNS.length];
			f = { G, x: p.x, y: p.y, z: p.z, heading: p.heading, pitch: 0, next: 0, drawn: 0, calm: 0, target: seen, look: 0 };
			militia.set(person.index, f);
		}
		fighting++;
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
	warStats.fighting = fighting;
}
// on the land: not up in the air, nor out on the water
function onLand(t) {
	const ground = terrain.land.heightAt(t.x, t.z);
	return ground > settings.waterWorldPosY && (t.feet ?? t.y) - ground < 3 * metre();
}
// REPAIR (see the top): each house of theirs hurt and standing, mended a little if one of its people is out near it
function mend() {
	const m = metre(), near = REPAIR.near * m;
	const out = [];
	townFolk.folkOut((person) => out.push(person));
	for (const s of war.sides) {
		const theirs = out.filter((person) => person.town === s.town);
		for (const h of s.houses) {
			if (h.damage <= 0 || h.damage >= 1) continue;
			const b = h.building, c = Math.cos(b.yaw), sn = Math.sin(b.yaw);
			const by = theirs.some((person) => {
				const dx = person.place.x - b.x, dz = person.place.z - b.z, u = dx * c - dz * sn, w = dx * sn + dz * c;
				return Math.hypot(Math.max(Math.abs(u) - b.width / 2, 0), Math.max(Math.abs(w) - b.depth / 2, 0)) < near;
			});
			if (by) { town.mendHouse(h, REPAIR.amount); warStats.mended++; }
		}
	}
}

// THE WAR, from beginning to end
//-------------------------------------------------
function startWar() {
	const land = terrain.land;
	const towns = (land.towns ?? []).filter((t) => t.buildings.filter((b) => !b.onPier).length > 10).slice(0, 2);
	if (towns.length < 2 || !npcs.on()) {
		help.toast(towns.length < 2 ? 'The War needs two towns' : 'The War needs the NPCs on (Terrain: NPCs)', 4);
		toHunting();
		return;
	}
	war.sides = towns.map((t, k) => ({ side: SIDES[k], town: t, name: town.townName(land.towns.indexOf(t)), houses: town.housesOf(t) }));
	war.winner = null;
	war.repair = 0;
	war.check = 0;
	town.restoreHouses();
	townFolk.restoreFolk();
	folkHealth.clear();
	militia.clear();
	npcs.war.on = true;
	const noShips = [];
	for (const s of war.sides) {
		const enemy = sideOf(otherSide(s.side)).town;
		FORCES.planes.forEach((task, k) => npcPlanes.addWarFlight(s.side, s.town, enemy, task, k));
		for (let k = 0; k < FORCES.riders; k++) npcRiders.addWarRider(s.side, s.town, enemy, k);
		// (schooners only with a dock, and a way by sea from it to the other town: otherwise they would only run aground)
		if (npcShips.warSeaWay(s.town, enemy)) for (let k = 0; k < FORCES.ships; k++) npcShips.addWarShip(s.town, s.side);
		else {
			// (and in their place more planes, at the other town's houses)
			for (let k = 0; k < FORCES.noSea; k++) npcPlanes.addWarFlight(s.side, s.town, enemy, 'village', FORCES.planes.length + k);
			noShips.push(s.name);
		}
	}
	if (noShips.length) help.toast(`${noShips.join(' and ')}: no way by sea to the other town, so ${FORCES.noSea} more planes instead of schooners`, 5);
	war.phase = 'war';
	announce('WAR', '#e8e8e8', `${war.sides[0].name} against ${war.sides[1].name}`);
	if (!mySide) showChoice();
}
function endWar() {
	npcPlanes.clearWarFlights();
	npcRiders.clearWarRiders();
	npcShips.clearWarShips();
	for (const index of militia.keys()) townFolk.setFight(index, null, false);
	militia.clear();
	folkHealth.clear();
	npcs.war.on = false;
	war.phase = 'off';
	war.sides = [];
	townFolk.restoreFolk();
	town.restoreHouses();
	mySide = null;
	hideChoice();
}
// how much of a side's town still stands (0 to 1)
const standing = (s) => s.houses.filter((h) => h.damage < 1).length / Math.max(s.houses.length, 1);
// the game mode back to Hunting (through the menu's control: horde.js's hook)
function toHunting() {
	import('./horde.js').then((horde) => { if (horde.modeHook.set) horde.modeHook.set('Hunting'); else settings.gameMode = 'Hunting'; });
}

let lastTime = performance.now();
export function warUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	const on = warMode() && terrain.land && hunting.hunterPlace().active;
	if (joined()) { show(); return; }
	if (!on) {
		if (war.phase != 'off') endWar();
		show();
		return;
	}
	if (war.phase == 'off') { startWar(); if (war.phase == 'off') return; }
	if (war.phase == 'war') {
		fightBack(dt);
		if ((war.repair += dt) >= REPAIR.every) { war.repair = 0; mend(); }
		if ((war.check += dt) >= 1) {
			war.check = 0;
			const fallen = war.sides.find((s) => standing(s) == 0);
			if (fallen) {
				war.winner = otherSide(fallen.side);
				war.phase = 'over';
				war.timer = OVER_SECONDS;
				warEvent({ k: 'won', winner: war.winner, fallen: fallen.name, by: sideOf(war.winner).name });
			}
		}
	} else if (war.phase == 'over' && (war.timer -= dt) <= 0) {
		endWar();
		toHunting();
	}
	warStats.phase = war.phase;
	warStats.standing = war.sides.map((s) => Math.round(standing(s) * 100));
	show();
}

// a player down comes back in its own town, near the middle of it, somewhere it can stand (players.js asks)
players.placeRespawn(() => {
	if (!warMode() || !mySide) return null;
	const s = war.sides.find((one) => one.side == mySide) ?? null;
	const t = s?.town ?? (terrain.land.towns ?? [])[shared?.sides?.findIndex((one) => one.side == mySide) ?? -1];
	return t ? spotIn(t) : null;
});
// a place to stand in a town: before the door of one of its houses
function spotIn(t) {
	const list = t.buildings.filter((b) => !b.onPier), b = list[Math.floor(Math.random() * list.length)], out = b.depth / 2 + 3 * metre();
	return { x: b.x + Math.sin(b.yaw) * out, z: b.z + Math.cos(b.yaw) * out };
}

// MULTIPLAYER (see the top)
//-------------------------------------------------
// host: the war as it is now, for everyone
export function warState() {
	if (!warMode() || war.phase == 'off') return { on: false };
	const r = (v) => Math.round(v * 100) / 100;
	return { on: true, phase: war.phase, winner: war.winner, timer: Math.round(war.timer), sides: war.sides.map((s) => ({ side: s.side, name: s.name, standing: r(standing(s)), houses: s.houses.length })),
		fights: [...militia.entries()].map(([index, f]) => [index, ...[f.x, f.y, f.z, f.heading, f.pitch].map(r), f.drawn > 0.25 ? f.G.gun : 'none']), dead: townFolk.deadList(), mine: mySide };
}
// joiner: the host's word on it
const shownFights = new Set();
export function warHeard(state) {
	const was = shared?.on;
	shared = state;
	npcs.war.on = !!state.on;
	if (!state.on) {
		if (was) { for (const index of shownFights) townFolk.setFight(index, null, true); shownFights.clear(); townFolk.restoreFolk(); mySide = null; hideChoice(); }
		return;
	}
	if (!was) announce('WAR', '#e8e8e8', state.sides.map((s) => s.name).join(' against '));
	if (!mySide && !choosing) showChoice();
	townFolk.setDead(state.dead ?? []);
	const now = new Set(state.fights.map((f) => f[0]));
	for (const index of shownFights) if (!now.has(index)) townFolk.setFight(index, null, true);
	shownFights.clear();
	for (const [index, x, y, z, heading, pitch, gun] of state.fights) { townFolk.setFight(index, { x, y, z, heading, pitch, gun }); shownFights.add(index); }
}
// what happens at once (the end), here and (from the host) everywhere
export const warEvents = { send: null };
function warEvent(e) {
	warEvents.send?.(e);
	warEventHeard(e);
}
export function warEventHeard(e) {
	if (e.k == 'won') announce(e.winner == 'red' ? 'RED WINS' : 'BLUE WINS', e.winner == 'red' ? '#ff5a4a' : '#6aa8ff', `${e.fallen} has fallen to ${e.by}`, 8000);
}

// What is shown over the picture
//-------------------------------------------------
const hud = document.createElement('div');
hud.style.cssText = 'position: fixed; left: 50%; top: 14px; transform: translateX(-50%); z-index: 5; pointer-events: none; display: none; padding: 6px 16px; border-radius: 6px; background: rgba(0, 0, 0, 0.5); color: #e8e8e8; font: 13px system-ui, sans-serif; text-align: center; white-space: nowrap;';
const banner = document.createElement('div');
banner.style.cssText = 'position: fixed; left: 50%; top: 24%; transform: translateX(-50%); z-index: 5; pointer-events: none; font: 700 46px/1.1 Georgia, "Times New Roman", serif; letter-spacing: 0.06em; text-shadow: 0 0 10px rgba(0, 0, 0, 0.9), 0 0 2px #000; opacity: 0; transition: opacity 0.4s; white-space: nowrap; text-align: center;';
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
const COLOURS = { red: '#ff5a4a', blue: '#6aa8ff' };
function show() {
	const s = joined() ? shared : war.phase != 'off' ? warState() : null;
	const on = !!(s && s.on && warMode() && hunting.hunterPlace().active);
	hud.style.display = on ? '' : 'none';
	if (!on) return;
	const towns = s.sides.map((x) => `<span style="color: ${COLOURS[x.side]}; font-weight: 600;">${x.name}</span> ${Math.round(x.standing * 100)}% standing`).join(' · ');
	const me = mySide ? `You: <span style="color: ${COLOURS[mySide]}; font-weight: 600;">${mySide == 'red' ? 'Red' : 'Blue'}</span> · ` : 'Choose your side: 1 Red · 2 Blue · ';
	const end = s.phase == 'over' ? `<div style="font-size: 15px; font-weight: 600; color: ${COLOURS[s.winner]};">${s.winner == 'red' ? 'Red' : 'Blue'} has won · Hunting again in ${Math.max(s.timer, 0)} s</div>` : '';
	const text = `<div style="font-size: 15px; font-weight: 600;">WAR</div><div>${me}${towns}</div>${end}`;
	if (text != hudShown) { hudShown = text; hud.innerHTML = text; }
}

// THE CHOICE (see THE PLAYERS at the top): a button for each side, or 1 and 2
const chooser = document.createElement('div');
chooser.style.cssText = 'position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 8; display: none; width: min(440px, calc(100vw - 32px)); box-sizing: border-box; padding: 18px 20px; border-radius: 10px; background: rgba(12, 10, 8, 0.9); color: #f2e6c4; font-family: system-ui, sans-serif; text-align: center; box-shadow: 0 6px 30px rgba(0, 0, 0, 0.6);';
document.body.appendChild(chooser);
let choosing = false;
function showChoice() {
	const sides = joined() ? shared?.sides ?? [] : war.sides;
	if (!sides.length) return;
	choosing = true;
	const count = (side) => (side == mySide ? 1 : 0) + players.otherList().filter((o) => o.view?.side == side).length;
	chooser.innerHTML = '<div style="font: 700 26px Georgia, serif; margin-bottom: 4px;">Choose your side</div><div style="font-size: 13px; color: rgba(242, 230, 196, 0.75); margin-bottom: 14px;">Your own side\'s people show blue, the other side\'s red</div>'
		+ '<div style="display: flex; gap: 12px; flex-wrap: wrap;">' + sides.map((s, k) => `<button data-side="${s.side}" style="flex: 1; min-width: 160px; padding: 12px; border: 2px solid ${COLOURS[s.side]}; border-radius: 8px; background: rgba(255, 255, 255, 0.06); color: #f2e6c4; font: 600 16px system-ui, sans-serif; cursor: pointer;">${k + 1} · ${s.side == 'red' ? 'Red' : 'Blue'}<div style="font-weight: 400; font-size: 13px; margin-top: 4px;">${s.name} · ${count(s.side)} player${count(s.side) == 1 ? '' : 's'}</div></button>`).join('') + '</div>';
	for (const button of chooser.querySelectorAll('button')) button.onclick = () => choose(button.dataset.side);
	chooser.style.display = '';
	if (document.pointerLockElement) document.exitPointerLock();
}
function hideChoice() { choosing = false; chooser.style.display = 'none'; }
export function choose(side) {
	mySide = side;
	hideChoice();
	const s = joined() ? null : war.sides.find((one) => one.side == side);
	const t = s?.town ?? (terrain.land.towns ?? [])[(shared?.sides ?? []).findIndex((one) => one.side == side)];
	if (t) { const at = spotIn(t); hunting.placeHunter(at.x, at.z); }
	help.toast(`You are with ${side == 'red' ? 'Red' : 'Blue'}: ${s?.name ?? shared?.sides?.find((one) => one.side == side)?.name ?? ''}`, 3);
}
window.addEventListener('keydown', (event) => {
	if (!choosing || event.repeat) return;
	const sides = joined() ? shared?.sides ?? [] : war.sides;
	if (event.code == 'Digit1' && sides[0]) choose(sides[0].side);
	if (event.code == 'Digit2' && sides[1]) choose(sides[1].side);
});

// for testing
export function warForTest() { return { ...war, sides: war.sides.map((s) => ({ side: s.side, name: s.name, houses: s.houses.length, standing: standing(s) })), mySide, militia: militia.size, folkHurt: folkHealth.size }; }
export function chooseForTest(side) { choose(side); }
export const warSharedForTest = () => shared;
export const choosingForTest = () => choosing;
