import { vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import * as transformations from './transformations.js'
import * as hunting from './hunting.js'
import * as players from './players.js'
import * as npcs from './npcs.js'
import * as townFolk from './townFolk.js'
import * as deer from './deer.js'
import * as loot from './loot.js'
import * as campfires from './campfires.js'
import * as bedrolls from './bedrolls.js'
import * as camp from './camp.js'
import * as beasts from './beasts.js'
import * as stations from './stations.js'
import * as critters from './critters.js'
import * as cabins from './cabins.js'
import { nameOf } from './items.js'
import * as inventory from './inventory.js'
import { TRADES } from './shops.js'
import * as terrain from './terrain.js'
import * as town from './town.js'
import * as trains from './trains.js'
import * as carts from './carts.js'
import * as horse from './horse.js'
import * as rabbits from './rabbits.js'
import * as whaling from './whaling.js'

/*
	V HELD: WHAT IS WHAT. A little box over everything near enough to matter: the things lying about (loot.js: a crate, a body, a pile, or
	the one thing in a pile by its name), the campfires and the bedrolls, a dead deer, and over the heads of the people: the NPCs (npcs.js:
	a horseman, a pilot...), the townsfolk by their trade (and whether they trade, shops.js), and the other players by name. Things within
	THINGS of the walker, people within PEOPLE; the nearest MOST of them.
	IN THE OBSERVE MODE (the camera flying): as far out as settings.observeInspectRadius (metres, at the top of the controls), every NPC
	and townsman, the towns' names over them, where the trains, the trading carts and the horses are, as they go, and the wild animals
	(the deer, the moose, wolves and bears, the rabbits, the whales: their records as the host sends them, deer.js and the rest), each
	with how far off it is; the nearest WIDE_MOST of them.
*/
const THINGS = 30;					// metres
const PEOPLE = 70;
const MOST = 60;
const WIDE_MOST = 300;
const RANK = { town: 0, moving: 1, player: 2, person: 3, animal: 3, thing: 4 };

const layer = document.createElement('div');
layer.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: 6; display: none; font: 12px Georgia, "Times New Roman", serif;';
document.body.appendChild(layer);
let held = false;
window.addEventListener('keydown', (e) => { if (e.code == 'KeyV' && !e.target?.matches?.('input')) held = true; }, true);
window.addEventListener('keyup', (e) => { if (e.code == 'KeyV') held = false; }, true);
window.addEventListener('blur', () => { held = false; });
export const highlightState = { get held() { return held; }, set held(v) { held = v; }, shown: 0 };

const title = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
function screenOf(at) {
	const m = transformations.getViewProj();
	const w = m[3] * at[0] + m[7] * at[1] + m[11] * at[2] + m[15];
	if (w <= 0) return null;
	const c = vec3.transformMat4(at, m);
	if (Math.abs(c[0]) > 1.1 || Math.abs(c[1]) > 1.1) return null;
	return [(c[0] * 0.5 + 0.5) * innerWidth, (0.5 - c[1] * 0.5) * innerHeight];
}
const observing = () => settings.gameMode == 'Observe';
// every one there is to show: [at (world units), text, kind ('thing', 'person', 'player', 'town', 'moving')]
function gather() {
	const m = settings.forestUnitsPerMetre, out = [];
	if (observing()) {
		// (the towns: their names over their middles; the trains, the carts, the horses)
		(terrain.land?.towns ?? []).forEach((t, k) => {
			if (!t.buildings?.length) return;
			const mid = town.townMiddle(t), y = terrain.land.groundAt(mid.x, mid.z);
			out.push([[mid.x, y + 45 * m, mid.z], town.townName(t.slot ?? k), 'town']);
		});
		for (const t of trains.trainsForTest) {
			const head = t.cars?.[0]?.at;
			if (head) out.push([[head[0], head[1] + 7 * m, head[2]], (t.troops ? 'Troop train' : 'Train') + ' · ' + (t.phase == 'run' ? (Math.abs(t.speed) > 0.5 ? 'running' : 'stopped') : t.phase) + ' · ' + t.people.filter((p) => p.alive).length + ' aboard', 'moving']);
		}
		for (const c of carts.cartsForTest) if (c.at && c.at[1]) out.push([[c.at[0], c.at[1] + 4 * m, c.at[2]], 'Trading cart · ' + c.phase + (c.guards ? ' · ' + c.guards + ' guards' : ''), 'moving']);
		for (const h of horse.horses) if (h.exists !== false && !h.rider) out.push([[h.x, h.y + 2.2 * m, h.z], 'Horse', 'moving']);
		// (the wild animals: 12 numbers a record, the place at 1 to 3, alive at 11; a beast's kind's number at 8)
		const animals = (records, name, up) => { for (let i = 0; i + 11 < records.length; i += 12) if (records[i + 11] > 0.5) out.push([[records[i + 1], records[i + 2] + up * m, records[i + 3]], name(records, i), 'animal']); };
		const BEAST = { 1: 'Moose', 2: 'Wolf', 3: 'Bear' };
		animals(deer.deerShare(), () => 'Deer', 1.9);
		animals(beasts.beastShare(), (r, i) => BEAST[Math.round(r[i + 8])] ?? 'Animal', 2.2);
		animals(rabbits.rabbitShare(), () => 'Rabbit', 0.6);
		animals(whaling.whaleShare(), () => 'Whale', 4);
	}
	if (inventory.survivalOn()) {
		for (const c of loot.containerList()) {
			const one = c.kind == 'pile' && c.items?.length == 1 ? c.items[0] : null;
			out.push([[c.at[0], c.at[1] + 0.5 * m, c.at[2]], one ? nameOf(one) + (one.count > 1 ? ' × ' + one.count : '') : loot.label(c), 'thing']);
		}
		for (const f of campfires.fireSpots()) out.push([[f.at[0], f.at[1] + 0.7 * m, f.at[2]], f.name, 'thing']);
		for (const r of bedrolls.rollsForTest()) out.push([[r.at[0], r.at[1] + 0.3 * m, r.at[2]], 'Canvas bedroll', 'thing']);
		for (const c of camp.campSpots()) out.push([c.at, c.name, 'thing']);
		for (const c of beasts.deadSpots()) out.push([c.at, c.name, 'thing']);
		for (const c of critters.deadSpots()) out.push([c.at, c.name, 'thing']);
		for (const c of stations.stationSpots()) out.push([c.at, c.name, 'thing']);
		for (const c of cabins.cabinSpots()) out.push([c.at, c.name, 'thing']);
		for (const c of deer.deerCorpses()) if (c.y !== undefined) out.push([[c.x, c.y + 0.8 * m, c.z], c.meat > 0 ? 'Dead deer (cut it up: hatchet or knife)' : 'Dead deer', 'thing']);
	}
	if (npcs.on()) for (const person of npcs.people) {
		const p = person.place;
		if (!p || person.gone) continue;
		out.push([[p.x, p.y + 2.05 * m, p.z], (person.alive ? '' : 'Dead ') + (person.alive ? title(person.name) : person.name), 'person']);
	}
	if (settings.enableTownFolk) townFolk.folkEach((person) => {
		const p = person.place;
		if (!p || person.turned || person.dead) return;
		const trade = inventory.survivalOn() ? TRADES[person.profession.name] : null;
		out.push([[p.x, p.y + 2.15 * m, p.z], title(person.profession.name) + (trade ? (trade.bank ? ' · bank' : ' · trades') : ''), 'person']);
	});
	for (const o of players.otherList()) if (o.view?.hunting) out.push([[o.view.x, o.view.y + 2.1 * m, o.view.z], o.name ?? 'Player', 'player']);
	return out;
}
const STYLE = {
	thing: 'background: rgba(30, 24, 16, 0.82); border: 1px solid #b8955a; color: #f4e6c4;',
	town: 'background: rgba(40, 30, 14, 0.85); border: 1px solid #e0b860; color: #fff0c8; font-size: 15px; font-weight: bold;',
	moving: 'background: rgba(44, 20, 18, 0.82); border: 1px solid #d08060; color: #ffe4d8;',
	animal: 'background: rgba(22, 34, 16, 0.82); border: 1px solid #8ab060; color: #eaf6d8;',
	person: 'background: rgba(20, 26, 34, 0.8); border: 1px solid #7a9ac0; color: #e4ecf8;',
	player: 'background: rgba(20, 40, 24, 0.8); border: 1px solid #7ac08a; color: #e4f8e8;',
};
// once a frame
export function highlightsUpdate() {
	const wide = observing();
	const on = held && (wide || hunting.hunterPlace().active) && !hunting.input.menuOpen;
	layer.style.display = on ? '' : 'none';
	if (!on) { highlightState.shown = 0; return; }
	const m = settings.forestUnitsPerMetre, eye = [settings.camPosX, settings.camPosY, settings.camPosZ], radius = settings.observeInspectRadius ?? 2000;
	const reach = (kind) => wide ? radius : kind == 'thing' ? THINGS : PEOPLE;
	const near = gather().map(([at, text, kind]) => [at, text, kind, Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]) / m])
		.filter(([, , kind, d]) => d < reach(kind)).sort((a, b) => (wide ? RANK[a[2]] - RANK[b[2]] : 0) || a[3] - b[3]).slice(0, wide ? WIDE_MOST : MOST);
	let html = '';
	const placed = [];		// (flying: the boxes put up, so one does not go over another: the towns' first, then what moves, then the nearest people)
	for (const [at, text0, kind, d] of near) {
		const s = screenOf(at);
		if (!s) continue;
		if (wide) {
			const w = (text0.length + 8) * (kind == 'town' ? 8 : 6.5) + 14, top = s[1] - 20;
			if (placed.some((p) => Math.abs(p[0] - s[0]) < (p[2] + w) / 2 && Math.abs(p[1] - top) < 19)) continue;
			placed.push([s[0], top, w]);
		}
		// (flying, how far off each is)
		const text = wide ? text0 + ' · ' + (d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km') : text0;
		const fade = wide ? Math.max(0.6, 1 - 0.4 * d / radius) : Math.max(0.55, 1 - d / reach(kind));
		html += `<div style="position:absolute; left:${s[0].toFixed(0)}px; top:${s[1].toFixed(0)}px; transform:translate(-50%, -100%); padding:2px 7px; border-radius:3px; white-space:nowrap; opacity:${fade.toFixed(2)}; ${STYLE[kind]}">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>`;
	}
	layer.innerHTML = html;
	highlightState.shown = near.length;
}
