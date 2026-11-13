import { settings } from './settings.js';
import * as terrain from './terrain.js'
import * as town from './town.js'
import * as treasury from './treasury.js'
import * as survivalNet from './survivalNet.js'
import * as survivalWar from './survivalWar.js'
import * as players from './players.js'
import * as npcs from './npcs.js'
import * as help from './controlsHelp.js'
import * as inventory from './inventory.js'

/*
	WHAT THE TOWNS THINK OF THE PLAYERS (the Survival mode's): every player stands somewhere with every town, 0 to 1 (START to begin with),
	a percentage in the journal (inventoryUI.js: its Towns tab). What the player does there moves it:
		killed			one of its townsfolk (survivalWar.js: onFolkHarm), WRONGS.kill; one of its horsemen, WRONGS.rider; hurt, WRONGS.hurt
		stolen from		WRONGS.steal, and more by what was taken (worth, in dollars: wrong(k, 'steal', worth)): a farm's crops, a cart's chest
		work done		a quest (quests.js): by what it paid (DONE)
		given money		at its hall (the librarian: shops.js), by how much (DONATE)
	and NATION of each change to every other town of its nation (survivalWar.js: nationOf), as they hear of it.
	WHAT IT CHANGES: what its shops ask and pay (priceFactor, sellFactor: PRICES), how much work there is for the player (questsOffered), and
	under HOSTILE its horsemen ride at the player on sight (npcs.js: hostileTo, by the group's town).
	IN A GAME the host keeps everyone's by name, as the bank keeps the money (shops.js): what a joiner does is sent to it (opinionDo,
	opinionGive), it tells the joiner where it stands (opinionIs), and it keeps them in its browser (SAVED) and so in the save file
*/
const START = 0.5;
const WRONGS = { kill: 0.2, rider: 0.12, hurt: 0.04, steal: 0.05, stealPer: 0.004 };	// stealPer: more for each dollar it was worth
const NATION = 0.3;
const DONATE = { most: 0.25, dollars: 40 };		// a gift's worth to the town: most * (1 - e^(-dollars / dollars)): $40 about 16%
const DONE = { least: 0.04, perDollar: 0.004, most: 0.12 };
const PRICES = { swing: 0.5 };					// what a shop asks is 1 + swing * (0.5 - opinion) of the price: from 25% more to 25% less
export const HOSTILE = 0.15;
const SAVED = 'townOpinions';

export const opinionStats = { changes: 0, told: 0 };
const store = new Map();			// name -> Map(town's number -> 0 to 1): the host's
let mine = new Map();				// this player's, as the host has told it (a joiner's)
const savedKey = () => SAVED + ':' + (settings.terrainSeed ?? 0);
let loadedFor = null;
function load() {
	if (loadedFor === savedKey()) return;
	loadedFor = savedKey();
	store.clear();
	try { for (const [name, list] of Object.entries(JSON.parse(localStorage.getItem(loadedFor) ?? '{}'))) store.set(name, new Map(Object.entries(list).map(([k, v]) => [Number(k), Math.min(Math.max(Number(v) || 0, 0), 1)]))); } catch (e) { /* (none) */ }
}
function keep() { try { localStorage.setItem(savedKey(), JSON.stringify(Object.fromEntries([...store].map(([n, m]) => [n, Object.fromEntries(m)])))); } catch (e) { /* */ } }
const myName = () => { try { return localStorage.getItem('huntName') || 'me'; } catch (e) { return 'me'; } };
const nameOfId = (id) => id === 'me' ? myName() : players.otherList().find((o) => o.id === id)?.name ?? null;
const idOfName = (name) => name == myName() ? 'me' : players.otherList().find((o) => o.name == name)?.id ?? null;
const listeners = [];
export function onChange(fn) { listeners.push(fn); }
const told = () => listeners.forEach((fn) => fn());

// where a player stands with town k: this player (name left out), or anyone by name (the host's)
export function opinionOf(k, name = null) {
	if (name === null && !survivalNet.authority()) return mine.get(k) ?? START;
	load();
	return store.get(name ?? myName())?.get(k) ?? START;
}
// what a town's shops ask and pay of the price (shops.js), and how much work its townsfolk have for the player (quests.js)
export const priceFactor = (k) => 1 + PRICES.swing * (0.5 - opinionOf(k));
export const sellFactor = (k) => 1 - PRICES.swing * (0.5 - opinionOf(k));
export const questsOffered = (k) => { const o = opinionOf(k); return o < 0.25 ? 0 : o < 0.5 ? 1 : o < 0.8 ? 2 : 3; };
export const hostileName = (k, name) => opinionOf(k, name) < HOSTILE;

// (the host's) so much on a player's standing with town k (by name), a share of it to the rest of its nation, said to the player
function apply(name, k, delta, why) {
	if (!name || k < 0 || !delta) return;
	load();
	if (!store.has(name)) store.set(name, new Map());
	const m = store.get(name);
	const nation = survivalWar.nationOf(k);
	const before = m.get(k) ?? START;
	for (const j of new Set([k, ...survivalWar.townsOf(nation)])) m.set(j, Math.min(Math.max((m.get(j) ?? START) + delta * (j == k ? 1 : NATION), 0), 1));
	opinionStats.changes++;
	keep();
	const id = idOfName(name), now = m.get(k);
	if (id === 'me') { said(k, before, now, why); told(); }
	else if (id !== null) survivalNet.sendTo(id, 'opinionIs', { list: [...m], town: k, before, why });
}
function said(k, before, now, why) {
	if (Math.round(now * 100) == Math.round(before * 100)) return;
	help.toast(`${town.townName(k)} ${now > before ? 'thinks better' : 'thinks less'} of you${why ? ` (${why})` : ''}: ${Math.round(now * 100)}%`, 3);
}
// a change to where this player stands with town k (sent to the host from a joiner)
export function change(k, delta, why = '') {
	if (k < 0 || !delta) return;
	if (survivalNet.authority()) apply(myName(), k, delta, why);
	else survivalNet.send('opinionDo', { town: k, delta: Math.max(Math.min(delta, DONE.most), -1), why: String(why).slice(0, 40) });
}
// (the host's) a change for whoever did it: this player ('me') or a joiner's id
export function changeFor(who, k, delta, why = '') { if (survivalNet.authority()) apply(nameOfId(who), k, delta, why); }
// a wrong done to town k by whoever did it (the host's: it is where they are seen): 'kill', 'rider', 'hurt', 'steal' (worth: dollars)
export function wrong(who, k, kind, worth = 0) {
	const amount = (WRONGS[kind] ?? 0) + (kind == 'steal' ? WRONGS.stealPer * worth : 0);
	const why = { kill: 'you killed one of its people', rider: 'you killed one of its horsemen', hurt: 'you shot one of its people', steal: 'you stole from it' }[kind];
	changeFor(who, k, -amount, why);
}
// what work done is worth to a town's opinion: by what it paid (quests.js)
export const doneWorth = (dollars) => Math.min(DONE.least + DONE.perDollar * dollars, DONE.most);
// money given to town k at its hall: from this player's pocket into its treasury, and the town's opinion up by its worth (DONATE)
export function donate(t, cents) {
	if (cents <= 0 || !inventory.pay(cents)) return false;
	const k = treasury.townNumber(t);
	if (survivalNet.authority()) given(myName(), t, cents);
	else survivalNet.send('opinionGive', { town: k, cents });
	return true;
}
function given(name, t, cents) {
	const dollars = cents / 100;
	treasury.pay(t, dollars, 'A gift');
	apply(name, treasury.townNumber(t), DONATE.most * (1 - Math.exp(-dollars / DONATE.dollars)), 'your gift');
}

// (the town is m.town: a message's k is its kind, survivalNet.js)
survivalNet.on('opinionDo', (m, from) => { const k = Number(m.town); if (Number.isFinite(k)) apply(nameOfId(from), k, Math.max(Math.min(Number(m.delta) || 0, DONE.most), -1), String(m.why ?? '')); });
survivalNet.on('opinionGive', (m, from) => { const t = (terrain.land?.towns ?? [])[Number(m.town)]; const cents = Math.max(0, Math.floor(Number(m.cents) || 0)); if (t && cents) given(nameOfId(from), t, cents); });
survivalNet.on('opinionIs', (m) => { mine = new Map((m.list ?? []).map(([k, v]) => [Number(k), Number(v)])); opinionStats.told++; if (m.why !== undefined && m.town !== undefined) said(Number(m.town), Number(m.before ?? START), mine.get(Number(m.town)) ?? START, m.why); told(); });
survivalNet.on('opinionAsk', (m, from) => { load(); const name = nameOfId(from); survivalNet.sendTo(from, 'opinionIs', { list: [...(store.get(name) ?? new Map())] }); });
survivalNet.onJoin?.((id) => { load(); survivalNet.sendTo(id, 'opinionIs', { list: [...(store.get(nameOfId(id)) ?? new Map())] }); });

// a town's horseman down (npcs.js), by a player: a wrong to its town (the host's, where the NPCs are)
npcs.onDown((person, who) => {
	if (!survivalNet.authority() || who === null || who === undefined || settings.gameMode != 'Hunting') return;
	const k = person.group?.town ?? -1;
	if (k >= 0) wrong(who, k, 'rider');
});
// one of its townsfolk shot or killed (survivalWar.js: onFolkHarm)
// (once every module is loaded: survivalWar.js may still be loading when this one is, trains.js)
queueMicrotask(() => survivalWar.onFolkHarm((person, who, killed) => {
	if (!survivalNet.authority() || who === null || who === undefined) return;
	const k = treasury.townNumber(person.town);
	if (k >= 0) wrong(who, k, killed ? 'kill' : 'hurt');
}));
// and a town's horsemen at a player it has come to hate (npcs.js: hostileTo, for a group with a town)
npcs.setTownHostility((k, who) => { const name = nameOfId(who); return name !== null && hostileName(k, name); });

// THE JOURNAL'S TOWNS TAB (inventoryUI.js): every town there is, where the player stands with it and whose it is, and the wars on
export function journalHtml(html) {
	const list = (terrain.land?.towns ?? []).map((t, k) => ({ t, k })).filter(({ t }) => t && !t.none && (t.buildings?.length || t.approx));
	const bar = (o) => `<span style="display:inline-block; width:90px; height:8px; border:1px solid rgba(43,37,32,0.7); vertical-align:middle; margin:0 6px;"><span style="display:block; height:100%; width:${Math.round(o * 100)}%; background:${o < HOSTILE ? '#8a2a1a' : o < 0.4 ? '#9a6a2a' : '#3a5a2a'};"></span></span>`;
	const rows = list.map(({ k }) => {
		const o = opinionOf(k), nation = survivalWar.nationOf(k);
		const word = o < HOSTILE ? 'hostile' : o < 0.3 ? 'wary of you' : o < 0.55 ? 'neutral' : o < 0.8 ? 'friendly' : 'it trusts you';
		return `<div style="padding:3px 0; break-inside:avoid;"><b>${html(town.townName(k))}</b>${bar(o)}${Math.round(o * 100)}% · ${word}<div style="font-size:11px; color:rgba(43,37,32,0.62); margin-left:2px;">${nation == 'n' + k ? 'its own' : 'held by ' + html(survivalWar.nationName(nation))}</div></div>`;
	}).join('') || '<div>No towns yet</div>';
	const wars = survivalWar.warsNow().filter((w) => w.phase == 'war');
	const warRows = wars.length ? wars.map((w) => `<div style="padding:3px 0;"><b>${html(survivalWar.nationName(w.attacker))}</b> against <b>${html(survivalWar.nationName(w.defender))}</b> <span style="font-size:11px; color:rgba(43,37,32,0.62);">for ${html(town.townName(w.target))}</span></div>`).join('') : '<div>No war is being fought</div>';
	return { towns: rows, wars: warRows };
}

// (the save file's: saveGame.js) the browser's record of them
export const opinionRecord = () => { load(); return { key: savedKey(), text: JSON.stringify(Object.fromEntries([...store].map(([n, m]) => [n, Object.fromEntries(m)]))) }; };
// (for testing) a player's standing with every town, by name (the host's)
export const opinionsForTest = (name = null) => { load(); return Object.fromEntries(store.get(name ?? myName()) ?? new Map()); };
export function setForTest(k, value, name = null) { load(); if (!store.has(name ?? myName())) store.set(name ?? myName(), new Map()); store.get(name ?? myName()).set(k, value); keep(); told(); }
