import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as survivalNet from './survivalNet.js'
import * as help from './controlsHelp.js'
import * as hunting from './hunting.js'

/*
	THE TOWNS' TREASURIES: every town has an account at its bank (shops.js shows it), in cents, by the town's place in the land's list. What its
	hunters bring back to the butcher (npcHunters.js) and what its schooner lands from a whale (npcShips.js, whaling.js) goes into it, and its
	taxes; and out of it into its budgets (townEconomy.js: take).
	In a game the host keeps them (survivalNet.js): pay() does nothing on a joiner (the NPCs are the host's), everyone is told each one as it changes
	(treasuryIs) and a joiner come in of all of them, and the host keeps them in its browser (SAVED) from one visit to the next, by the land's seed.
*/
const SAVED = 'townTreasuries';
const NEAR_TOLD = 300;				// metres: a player this near the town hears of it
const accounts = new Map();			// town's number -> cents
const listeners = [];
export function onChange(fn) { listeners.push(fn); }
const told = () => listeners.forEach((fn) => fn());
const savedKey = () => SAVED + ':' + (settings.terrainSeed ?? 0);
let loadedFor = null;
function load() {
	if (loadedFor === savedKey()) return;
	loadedFor = savedKey();
	accounts.clear();
	try { for (const [k, v] of Object.entries(JSON.parse(localStorage.getItem(loadedFor) ?? '{}'))) accounts.set(Number(k), Math.max(0, Math.floor(v) || 0)); } catch (e) { /* (none) */ }
}
export const townNumber = (t) => (terrain.land?.towns ?? []).indexOf(t);
export function centsOf(k) { load(); return accounts.get(k) ?? 0; }
export const stats = { paid: 0 };
const placeOf = (t) => { const b = t.buildings?.[0]; return b ? [b.x, b.z] : [0, 0]; };
function said(at, dollars, why) {
	const p = hunting.hunterPlace(), m = settings.forestUnitsPerMetre;
	if (p.active && Math.hypot(p.x - at[0], p.z - at[1]) < NEAR_TOLD * m) help.toast(`${why}: $${dollars} to the town's treasury`, 3);
}
// so much into a town's account (the host's, or alone), and why (said to the players near it)
export function pay(t, dollars, why = '') {
	const k = townNumber(t);
	if (k < 0 || !survivalNet.authority()) return false;
	load();
	accounts.set(k, centsOf(k) + Math.round(dollars * 100));
	stats.paid += dollars;
	try { localStorage.setItem(savedKey(), JSON.stringify(Object.fromEntries(accounts))); } catch (e) { /* */ }
	const at = placeOf(t);
	survivalNet.send('treasuryIs', { list: [[k, accounts.get(k)]], why, at, dollars });
	if (why) said(at, dollars, why);
	told();
	return true;
}
// so much out of a town's account, for its budgets (townEconomy.js): false if it has not got it (the host's, or alone)
export function take(t, dollars) {
	const k = townNumber(t), cents = Math.round(dollars * 100);
	if (k < 0 || !survivalNet.authority() || cents <= 0) return false;
	load();
	if (centsOf(k) < cents) return false;
	accounts.set(k, centsOf(k) - cents);
	try { localStorage.setItem(savedKey(), JSON.stringify(Object.fromEntries(accounts))); } catch (e) { /* */ }
	survivalNet.send('treasuryIs', { list: [[k, accounts.get(k)]] });
	told();
	return true;
}
// (the save file's: survivalSave.js)
export const treasuryRecord = () => { load(); return { key: savedKey(), text: JSON.stringify(Object.fromEntries(accounts)) }; };
export function treasuryAdopt(list) {
	accounts.clear();
	for (const [k, v] of Object.entries(list ?? {})) accounts.set(Number(k), Math.max(0, Math.floor(v) || 0));
	loadedFor = savedKey();
	try { localStorage.setItem(savedKey(), JSON.stringify(Object.fromEntries(accounts))); } catch (e) { /* */ }
	survivalNet.send('treasuryIs', everything());
	told();
}
survivalNet.on('treasuryIs', (m) => {
	if (survivalNet.authority()) return;
	load();
	for (const [k, cents] of m.list ?? []) accounts.set(Number(k), Math.max(0, Math.floor(cents) || 0));
	if (m.why && Array.isArray(m.at)) said(m.at.map(Number), Number(m.dollars) || 0, m.why);
	told();
});
const everything = () => ({ list: [...accounts.entries()] });
survivalNet.on('treasuryAsk', (m, from) => { if (survivalNet.authority()) { load(); survivalNet.sendTo(from, 'treasuryIs', everything()); } });
survivalNet.onJoin((id) => { load(); survivalNet.sendTo(id, 'treasuryIs', everything()); });
export const forTest = () => ({ ...stats, accounts: Object.fromEntries(accounts) });
