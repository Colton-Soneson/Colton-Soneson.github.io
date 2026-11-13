import { settings } from './settings.js';
import * as terrain from './terrain.js'
import * as town from './town.js'
import * as treasury from './treasury.js'
import * as atmosphere from './atmosphere.js'
import * as survivalNet from './survivalNet.js'
import * as inventory from './inventory.js'
import * as help from './controlsHelp.js'
import * as townOpinion from './townOpinion.js'
import { ITEMS, makeItem } from './items.js'
import { seededRandom } from './terrainGenerator.js'

/*
	THE QUESTS of the Survival mode: work the townsfolk who trade (shops.js: TRADES) have for a player, to suit their trade. Offered in their
	shop (its WORK, under what they sell), taken on there, kept in the journal (inventoryUI.js: its Quests tab), and handed in where they say:
		BRING		so many of a thing the trade wants (WANTS, and why), to the one who asked: paid REWARD times what it is worth (VALUE, or its
					price), from the town's treasury (treasury.js) if it has it
		CARRY		the banker's strongbox to another town's bank, the town clerk's letter to another town's hall: given when taken on (into the
					bags), paid when handed in there, by how far it is (CARRY)
	Either way the town thinks the better of the player for it (townOpinion.js: doneWorth, of what it paid; a carry, both towns).
	What a trade of a town has on offer is drawn by lot for the town, the trade and the day (the world's clock: one world clock), the same all
	day and for everyone: as many as the town thinks well enough of the player for (townOpinion.js: questsOffered), and not one already
	taken or done today. A player has MOST at once, kept in the browser (SAVED, by the land's seed) and so in the save file. In a game each
	player's are their own: what a quest pays a town's treasury, a joiner tells the host of (questPaid)
*/
const MOST = 6;
const REWARD = 2.5;
const SAVED = 'survivalQuests';
// what each trade wants brought, how many (from, to), and why
const WANTS = {
	butcher: [['venison', 4, 8, 'for the smokehouse'], ['rabbitMeat', 3, 6, 'for the pies'], ['mooseMeat', 2, 4, 'for a wedding feast'], ['deerHide', 2, 3, 'to sell on']],
	baker: [['wheat', 6, 12, 'the mill is short'], ['mushroom', 5, 10, 'for the pies']],
	fisherman: [['rock', 6, 12, 'for net weights'], ['sinew', 3, 6, 'for fishing line']],
	innkeeper: [['mushroom', 6, 12, 'for the stew'], ['wolfPelt', 1, 2, 'a bounty: the wolves are at the sheep'], ['boneAlcohol', 1, 2, 'the cellar is dry']],
	blacksmith: [['ironOre', 4, 8, 'for the forge'], ['rock', 8, 14, 'to mend the forge']],
	tailor: [['deerHide', 2, 4, 'for leather coats'], ['rabbitPelt', 3, 6, 'for fur collars']],
	outfitter: [['wolfPelt', 1, 2, 'for a winter coat'], ['bearHide', 1, 1, 'a rug for a rich man'], ['sinew', 4, 8, 'for bowstrings']],
};
// and what the banker and the town clerk send to the other towns
const CARRIES = { banker: { item: 'strongbox', why: 'to the bank' }, librarian: { item: 'letter', why: 'to the town hall' } };
const CARRY = { least: 5, perKm: 2.5, most: 80 };	// dollars
// dollars a thing is worth to a quest, where it has no price (items.js)
const VALUE = { venison: 1.5, rabbitMeat: 0.6, mooseMeat: 2, deerHide: 2, wheat: 0.4, mushroom: 0.4, rock: 0.15, sinew: 0.5, wolfPelt: 4, bearHide: 8, boneAlcohol: 2, ironOre: 0.8, rabbitPelt: 0.8 };

export const questStats = { taken: 0, done: 0, abandoned: 0 };
const today = () => Math.floor(atmosphere.sunCycles);
const savedKey = () => SAVED + ':' + (settings.terrainSeed ?? 0);
let state = null;		// { active: [quest], done: { id: day } }
function load() {
	if (state && state.key == savedKey()) return state;
	state = { key: savedKey(), active: [], done: {} };
	try { const r = JSON.parse(localStorage.getItem(state.key) ?? 'null'); if (r) { state.active = r.active ?? []; state.done = r.done ?? {}; } } catch (e) { /* (none) */ }
	return state;
}
function keep() {
	// (what was done before today is let go: it is not offered again anyway)
	for (const [id, day] of Object.entries(state.done)) if (day < today() - 1) delete state.done[id];
	try { localStorage.setItem(state.key, JSON.stringify({ active: state.active, done: state.done })); } catch (e) { /* */ }
	listeners.forEach((fn) => fn());
}
const listeners = [];
export function onChange(fn) { listeners.push(fn); }
export const activeQuests = () => load().active.slice();
const worth = (type) => ITEMS[type]?.price || VALUE[type] || 0.5;
const dollars = (cents) => '$' + (cents / 100).toFixed(2);
const towns = () => terrain.land?.towns ?? [];
const centreOf = (t) => { const b = t?.buildings?.[0]; return b ? [b.x, b.z] : t?.approx ?? null; };

// THE WORK ON OFFER at town k from a trade: drawn by lot for the town, the trade and the day
export function offers(k, trade) {
	const s = load(), day = today(), n = townOpinion.questsOffered(k);
	const random = seededRandom(((settings.terrainSeed ?? 0) * 7919 + k * 104729 + [...trade].reduce((h, c) => h * 31 + c.charCodeAt(0), 7) * 13 + day * 2654435761) >>> 0);
	const out = [];
	for (let q = 0; q < n; q++) {
		const id = `${day}:${k}:${trade}:${q}`;
		let quest = null;
		if (CARRIES[trade]) {
			// (to another town there is: the nearest of a few at random, so most of it is the ones round about)
			const here = centreOf(towns()[k]);
			const others = towns().map((t, j) => ({ j, at: centreOf(t) })).filter(({ j, at }) => j != k && at && here && !towns()[j]?.none);
			if (!others.length) { random(); continue; }
			others.sort((a, b) => Math.hypot(a.at[0] - here[0], a.at[1] - here[1]) - Math.hypot(b.at[0] - here[0], b.at[1] - here[1]));
			const to = others[Math.min(Math.floor(random() * random() * others.length), others.length - 1)];
			const km = Math.hypot(to.at[0] - here[0], to.at[1] - here[1]) / settings.forestUnitsPerMetre / 1000;
			const pay = Math.min(CARRY.least + CARRY.perKm * km, CARRY.most);
			quest = { id, k, trade, kind: 'carry', type: CARRIES[trade].item, count: 1, to: to.j, reward: Math.round(pay) * 100, why: CARRIES[trade].why };
		} else if (WANTS[trade]) {
			let pick = Math.floor(random() * WANTS[trade].length);
			for (let again = 0; again < 4 && [...out, ...s.active.filter((a) => a.k == k && a.trade == trade)].some((o) => o.type == WANTS[trade][pick][0]); again++) pick = Math.floor(random() * WANTS[trade].length);
			const [type, lo, hi, why] = WANTS[trade][pick];
			const count = lo + Math.floor(random() * (hi - lo + 1));
			quest = { id, k, trade, kind: 'bring', type, count, reward: Math.max(3, Math.round(count * worth(type) * REWARD)) * 100, why };
		}
		if (quest && !s.done[id] && !s.active.some((a) => a.id == id)) out.push(quest);
	}
	return out;
}
// how many of a thing are in the bags (the grids: what can be handed over, as the shops buy from)
const inBags = (type) => inventory.everything().filter(({ item, where }) => where.kind == 'grid' && item.type == type).reduce((n, { item }) => n + (item.count ?? 1), 0);
export const haveFor = (q) => inBags(q.type);
// taken on: into the journal, and a carry's strongbox or letter into the bags
export function take(quest) {
	const s = load();
	if (s.active.length >= MOST) { help.toast(`You have ${MOST} quests already: finish or drop one (the journal's Quests)`); return false; }
	if (quest.kind == 'carry') {
		const item = makeItem(quest.type, 1);
		if (!inventory.give(item)) { help.toast('No room in your bags for it'); return false; }
	}
	s.active.push({ ...quest, taken: today() });
	questStats.taken++;
	keep();
	help.toast(quest.kind == 'carry' ? `Taken on: the ${ITEMS[quest.type].name.toLowerCase()} for ${town.townName(quest.to)}` : `Taken on: ${quest.count} ${ITEMS[quest.type].name.toLowerCase()} for the ${quest.trade}`);
	return true;
}
// handed in here (town k, a trade): the things given over, the reward paid, the town's opinion up
export function handIn(id, k, trade) {
	const s = load(), q = s.active.find((a) => a.id == id);
	if (!q || trade != q.trade || k != (q.kind == 'carry' ? q.to : q.k)) return false;
	if (inBags(q.type) < q.count) { help.toast(`You have ${inBags(q.type)} of ${q.count}`); return false; }
	let left = q.count;
	for (const { item } of inventory.everything().filter(({ item, where }) => where.kind == 'grid' && item.type == q.type)) {
		while (left > 0 && (item.count ?? 1) > 0 && inventory.everything().some((e) => e.item === item)) { inventory.useOne(item); left--; }
		if (left <= 0) break;
	}
	inventory.receive(q.reward);
	// (out of the town's treasury, as much of it as it has: the host's)
	const t = towns()[k];
	if (survivalNet.authority()) treasury.take(t, Math.min(q.reward, treasury.centsOf(k)) / 100);
	else survivalNet.send('questPaid', { town: k, cents: q.reward });	// (town: a message's k is its kind, survivalNet.js)
	const worthDone = townOpinion.doneWorth(q.reward / 100);
	townOpinion.change(k, worthDone, 'the work you did');
	if (q.kind == 'carry') townOpinion.change(q.k, worthDone * 0.5, 'you carried for it');
	s.active = s.active.filter((a) => a.id != id);
	s.done[id] = today();
	questStats.done++;
	keep();
	help.toast(`Done: paid ${dollars(q.reward)}`);
	return true;
}
export function abandon(id) {
	const s = load();
	if (!s.active.some((a) => a.id == id)) return false;
	s.active = s.active.filter((a) => a.id != id);
	s.done[id] = today();
	questStats.abandoned++;
	keep();
	return true;
}
survivalNet.on('questPaid', (m) => { const k = Number(m.town), t = towns()[k]; if (t) treasury.take(t, Math.min(Math.max(Number(m.cents) || 0, 0), treasury.centsOf(k)) / 100); });

// THE SHOP'S WORK (shops.js): what this one has on offer, and what of the player's it can hand in here
export function workHtml(k, trade, html, button) {
	const row = (left, right) => `<div style="display:flex; align-items:center; gap:10px; padding:6px 8px; border-bottom:1px solid rgba(200,180,140,0.15);"><div>${left}</div><div style="margin-left:auto; display:flex; align-items:center;">${right}</div></div>`;
	const describe = (q) => q.kind == 'carry' ? `Carry the ${html(ITEMS[q.type].name.toLowerCase())} to ${html(town.townName(q.to))}, ${html(q.why)}` : `Bring ${q.count} ${html(ITEMS[q.type].name.toLowerCase())}: ${html(q.why)}`;
	let out = '';
	for (const q of load().active.filter((a) => a.trade == trade && (a.kind == 'carry' ? a.to : a.k) == k)) {
		const have = haveFor(q);
		out += row(`<b>Hand in:</b> ${describe(q)} <span style="font-size:11px; color:#b8a888;">you have ${have} of ${q.count}</span>`, `<span style="margin-right:4px;">${dollars(q.reward)}</span>${button('q:give:' + q.id, 'Hand in', have >= q.count ? '' : 'disabled')}`);
	}
	for (const q of offers(k, trade)) out += row(describe(q), `<span style="margin-right:4px;">${dollars(q.reward)}</span>${button('q:take:' + q.id, 'Take on')}`);
	const none = townOpinion.questsOffered(k) == 0 ? 'They have no work for someone they think so little of' : 'Nothing more today';
	return `<div style="font-size:11px; letter-spacing:0.18em; color:#b8a888; margin:10px 8px 4px;">WORK</div>${out || `<div style="padding:6px 8px; color:#9a8a70;">${none}</div>`}`;
}
// a shop's click on its work (shops.js): true if it was one
export function act(act, k, trade) {
	if (act.startsWith('q:take:')) { const q = offers(k, trade).find((o) => o.id == act.slice(7)); if (q) take(q); return true; }
	if (act.startsWith('q:give:')) { handIn(act.slice(7), k, trade); return true; }
	return false;
}

// THE JOURNAL'S QUESTS TAB (inventoryUI.js)
export function journalHtml(html) {
	const list = load().active;
	if (!list.length) return '<div style="max-width:420px; line-height:1.5;">No work taken on. The townsfolk who trade have it: the butcher, the baker, the smith and the rest, the banker and the town clerk to carry for them. Ask in their shops</div>';
	return list.map((q) => {
		const where = q.kind == 'carry' ? `to the ${q.trade == 'banker' ? 'bank' : 'town hall'} at ${html(town.townName(q.to))}` : `to the ${html(q.trade)} at ${html(town.townName(q.k))}`;
		const what = q.kind == 'carry' ? `Carry the ${html(ITEMS[q.type].name.toLowerCase())}` : `Bring ${q.count} ${html(ITEMS[q.type].name.toLowerCase())} <span style="color:rgba(43,37,32,0.62);">(${Math.min(haveFor(q), q.count)} of ${q.count})</span>`;
		return `<div style="padding:5px 0; border-bottom:1px solid rgba(43,37,32,0.18); max-width:460px;"><div>${what}, ${where}</div><div style="font-size:11px; color:rgba(43,37,32,0.62);">${html(q.why)} · pays ${dollars(q.reward)} · <span data-quest-drop="${html(q.id)}" style="text-decoration:underline; cursor:pointer;">give it up</span></div></div>`;
	}).join('');
}
// (the save file's) the browser's record of them
export const questsRecord = () => { load(); return { key: savedKey(), text: JSON.stringify({ active: state.active, done: state.done }) }; };
