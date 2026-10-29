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
import { nameOf } from './items.js'
import * as inventory from './inventory.js'
import { TRADES } from './shops.js'

/*
	V HELD: WHAT IS WHAT. A little box over everything near enough to matter: the things lying about (loot.js: a crate, a body, a pile, or
	the one thing in a pile by its name), the campfires and the bedrolls, a dead deer, and over the heads of the people: the NPCs (npcs.js:
	a horseman, a pilot...), the townsfolk by their trade (and whether they trade, shops.js), and the other players by name. Things within
	THINGS of the walker, people within PEOPLE; the nearest MOST of them.
*/
const THINGS = 30;					// metres
const PEOPLE = 70;
const MOST = 60;

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
// every one there is to show: [at (world units), text, kind ('thing', 'person', 'player')]
function gather() {
	const m = settings.forestUnitsPerMetre, out = [];
	if (inventory.survivalOn()) {
		for (const c of loot.containerList()) {
			const one = c.kind == 'pile' && c.items?.length == 1 ? c.items[0] : null;
			out.push([[c.at[0], c.at[1] + 0.5 * m, c.at[2]], one ? nameOf(one) + (one.count > 1 ? ' × ' + one.count : '') : loot.label(c), 'thing']);
		}
		for (const f of campfires.fireSpots()) out.push([[f.at[0], f.at[1] + 0.7 * m, f.at[2]], f.name, 'thing']);
		for (const r of bedrolls.rollsForTest()) out.push([[r.at[0], r.at[1] + 0.3 * m, r.at[2]], 'Canvas bedroll', 'thing']);
		for (const c of camp.campSpots()) out.push([c.at, c.name, 'thing']);
		for (const c of deer.deerCorpses()) if (c.y !== undefined) out.push([[c.x, c.y + 0.8 * m, c.z], c.meat > 0 ? 'Dead deer (venison: hatchet or knife)' : 'Dead deer', 'thing']);
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
	person: 'background: rgba(20, 26, 34, 0.8); border: 1px solid #7a9ac0; color: #e4ecf8;',
	player: 'background: rgba(20, 40, 24, 0.8); border: 1px solid #7ac08a; color: #e4f8e8;',
};
// once a frame
export function highlightsUpdate() {
	const on = held && hunting.hunterPlace().active && !hunting.input.menuOpen;
	layer.style.display = on ? '' : 'none';
	if (!on) { highlightState.shown = 0; return; }
	const m = settings.forestUnitsPerMetre, eye = [settings.camPosX, settings.camPosY, settings.camPosZ];
	const near = gather().map(([at, text, kind]) => [at, text, kind, Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]) / m])
		.filter(([, , kind, d]) => d < (kind == 'thing' ? THINGS : PEOPLE)).sort((a, b) => a[3] - b[3]).slice(0, MOST);
	let html = '';
	for (const [at, text, kind, d] of near) {
		const s = screenOf(at);
		if (!s) continue;
		const fade = Math.max(0.55, 1 - d / (kind == 'thing' ? THINGS : PEOPLE));
		html += `<div style="position:absolute; left:${s[0].toFixed(0)}px; top:${s[1].toFixed(0)}px; transform:translate(-50%, -100%); padding:2px 7px; border-radius:3px; white-space:nowrap; opacity:${fade.toFixed(2)}; ${STYLE[kind]}">${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>`;
	}
	layer.innerHTML = html;
	highlightState.shown = near.length;
}
