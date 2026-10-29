import {canvas} from './deviceSelection.js'
import { settings } from './settings.js';

import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import * as atmosphere from './atmosphere.js'
import * as players from './players.js'
import * as townFolk from './townFolk.js'
import * as survivalNet from './survivalNet.js'
import { ITEMS, ICONS, makeItem, nameOf, tintOf, dollars } from './items.js'
import { CLOTHES, COLOURS } from './clothing.js'
import * as inventory from './inventory.js'
import * as loot from './loot.js'
import * as horse from './horse.js'

/*
	THE SHOPS of the Survival mode: E at one of the townsfolk (townFolk.js) who has a TRADE, within REACH and looked at, opens its shop (and
	it stops where it is, turned to the walker, until the shop shuts).
		food		the baker, the butcher, the fisherman, the innkeeper: each sells its own (sells) and buys any food
		clothes		the tailor (the clothes), the outfitter (boots, the backpacks and their pouches, the extras, the tools): each buys clothes and
					gear back. A piece of clothing is bought in the colour chosen (clothing.js: its five)
		bank		the banker: money put in or taken out (BANK)
	What a thing costs is its price (items.js, clothing.js), in dollars; what a shop pays for one is SELL of that. Money is items.js's money:
	cents, any amount in one stack (inventory.js: pay, receive). The shops have no end of anything, and are the same for everyone, so there
	is nothing about them to send.
	THE BANK keeps every player's money by name, and adds INTEREST to it for every day of the world's clock (atmosphere.js: sunCycles: one
	world clock) that goes by. In a game the host keeps the accounts (survivalNet.js): a joiner asks what it has (bankAsk), puts money in
	(bankPut: paid out here first) and takes it out (bankTake: the host says how much it may, bankIs), and the host's are kept in its
	browser (SAVED) from one visit to the next.
*/
const REACH = 2.6;					// metres
const SELL = 0.5;					// of the price
const INTEREST = 0.03;				// a day
const SAVED = 'survivalBank';
const FOOD = Object.keys(ITEMS).filter((type) => ITEMS[type].food || ITEMS[type].drink);
const GEAR = ['tent', 'tentStove', 'rainCollector', 'haversack', 'rucksack', 'framePack', 'ammoPouch', 'utilityPouch', 'bedrollStrap', 'bedroll', 'compass', 'watch', 'knife', 'hatchet', 'lighter'];
const HORSE = 30;					// dollars: a saddled horse (the outfitter's: horse.js brings it round, its saddlebags for the camp, camp.js)
const CLOTHING = Object.keys(CLOTHES);
const TAILORED = CLOTHING.filter((type) => CLOTHES[type].slot != 'feetOuter' && CLOTHES[type].slot != 'extra');
const OUTFITTED = [...CLOTHING.filter((type) => CLOTHES[type].slot == 'feetOuter' || CLOTHES[type].slot == 'extra'), ...GEAR];
export const TRADES = {
	baker: { title: 'Bakery', sells: ['bread'], buys: FOOD },
	butcher: { title: 'Butcher', sells: ['sausage', 'venison', 'cookedVenison'], buys: FOOD },
	fisherman: { title: 'Fish', sells: ['smokedFish', 'water'], buys: FOOD },
	innkeeper: { title: 'Inn', sells: ['beer', 'water', 'bread', 'sausage', 'cookedVenison'], buys: FOOD },
	tailor: { title: 'Tailor', sells: TAILORED, buys: [...CLOTHING, ...GEAR] },
	outfitter: { title: 'Outfitter', sells: OUTFITTED, buys: [...CLOTHING, ...GEAR], horse: true },
	banker: { title: 'Bank', bank: true },
};
const cents = (type) => Math.round((ITEMS[type]?.price ?? 0) * 100);
const offer = (type) => Math.floor(cents(type) * SELL);
const title = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// THE ONE LOOKED AT, within REACH, who trades
export function traderInView() {
	if (!inventory.survivalOn() || !settings.enableTownFolk) return null;
	const p = hunting.hunterPlace(), m = settings.forestUnitsPerMetre;
	if (!p.active || p.on != 'land') return null;
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ];
	const look = [Math.sin(settings.camYaw) * Math.cos(settings.camPitch), Math.sin(settings.camPitch), -Math.cos(settings.camYaw) * Math.cos(settings.camPitch)];
	let best = null, bestOff = 0.3;
	townFolk.folkEach((person) => {
		const q = person.place;
		if (!q || person.turned || person.dead || !TRADES[person.profession.name]) return;
		const to = [q.x - eye[0], q.y + 1.2 * m - eye[1], q.z - eye[2]], d = Math.hypot(...to);
		if (d > REACH * m + 0.8 * m) return;
		const off = 1 - (to[0] * look[0] + to[1] * look[1] + to[2] * look[2]) / (d || 1);
		if (off < bestOff) { bestOff = off; best = person; }
	});
	return best;
}
hunting.onUse(() => { const person = traderInView(); if (!person) return false; openShop(person); return true; });
hunting.addPrompt(() => { const person = traderInView(); return person ? { name: title(person.profession.name), keys: TRADES[person.profession.name].bank ? 'E bank' : 'E trade' } : null; });

// THE BANK (see the top): the accounts (where they are kept), and this player's as last heard
const accounts = new Map();		// name -> { cents, day }
try { for (const [name, a] of Object.entries(JSON.parse(localStorage.getItem(SAVED) ?? '{}'))) accounts.set(name, { cents: Math.max(0, Math.floor(a.cents) || 0), day: Number(a.day) || 0 }); } catch (e) { /* (none) */ }
const keep = () => { try { localStorage.setItem(SAVED, JSON.stringify(Object.fromEntries(accounts))); } catch (e) { /* */ } };
const today = () => Math.floor(atmosphere.sunCycles);
const myName = () => { try { return localStorage.getItem('huntName') || 'me'; } catch (e) { return 'me'; } };
function account(name) {
	const a = accounts.get(name) ?? { cents: 0, day: today() };
	const days = today() - a.day;
	if (days > 0) { a.cents = Math.floor(a.cents * Math.pow(1 + INTEREST, days)); a.day = today(); }
	else if (days < 0) a.day = today();
	accounts.set(name, a);
	return a;
}
// (the host's word on a name's account: put in, taken out (as much as there is): what it has, and what was taken)
function bankDo(name, put, take) {
	const a = account(name);
	a.cents += Math.max(0, Math.floor(put) || 0);
	const took = Math.min(Math.max(0, Math.floor(take) || 0), a.cents);
	a.cents -= took;
	keep();
	return { cents: a.cents, took };
}
const nameOfJoiner = (id) => players.otherList().find((o) => o.id === id)?.name ?? 'player ' + id;
survivalNet.on('bankAsk', (m, from) => survivalNet.sendTo(from, 'bankIs', bankDo(nameOfJoiner(from), 0, 0)));
survivalNet.on('bankPut', (m, from) => survivalNet.sendTo(from, 'bankIs', bankDo(nameOfJoiner(from), m.cents, 0)));
survivalNet.on('bankTake', (m, from) => survivalNet.sendTo(from, 'bankIs', bankDo(nameOfJoiner(from), 0, m.cents)));
survivalNet.on('bankIs', (m) => banked(m));
const bank = { cents: null };
function banked({ cents, took = 0 }) {
	bank.cents = Math.max(0, Math.floor(cents) || 0);
	if (took > 0 && !inventory.receive(took)) { loot.dropHere([makeItem('money', took)]); help.toast('No room for it: on the ground'); }
	render();
}
function bankAsk(put = 0, take = 0) {
	if (survivalNet.authority()) banked(bankDo(myName(), put, take));
	else survivalNet.send(put ? 'bankPut' : take ? 'bankTake' : 'bankAsk', { cents: put || take });
}
export const bankForTest = () => ({ ...bank, accounts: Object.fromEntries(accounts) });

// THE SHOP SCREEN
const shop = { person: null, trade: null, amount: '' };
export const shopState = shop;
const root = document.createElement('div');
root.style.cssText = 'position: fixed; inset: 0; z-index: 21; display: none; background: rgba(10, 8, 6, 0.8); color: #e6dcc8; font: 13px Georgia, "Times New Roman", serif; overflow: auto;';
document.body.appendChild(root);
const html = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const button = (act, label, more = '') => `<button data-act="${act}" ${more} style="padding:4px 10px; margin-left:6px; border:1px solid #8a7452; border-radius:4px; background:#4a3a28; color:#f0e4c8; font:inherit; cursor:pointer;">${label}</button>`;
const picture = (type, tint) => `<svg viewBox="0 0 40 40" style="width:28px; height:28px; flex:none;"><path d="${ICONS[ITEMS[type].icon] ?? ICONS.pouch}" fill="${tint}" stroke="rgba(0,0,0,0.6)" fill-rule="evenodd"/></svg>`;
function render() {
	if (!shop.person) return;
	const trade = shop.trade, carried = inventory.moneyCarried();
	const row = (left, right) => `<div style="display:flex; align-items:center; gap:10px; padding:6px 8px; border-bottom:1px solid rgba(200,180,140,0.15);">${left}<div style="margin-left:auto; display:flex; align-items:center;">${right}</div></div>`;
	let body = '';
	if (trade.bank) {
		body = `<div style="padding:8px;">In the bank: <b>${bank.cents === null ? '…' : dollars(bank.cents)}</b> · it earns ${Math.round(INTEREST * 100)}% every day</div>
			<div style="padding:8px; display:flex; align-items:center;">$ <input data-amount value="${html(shop.amount)}" placeholder="0.00" style="width:90px; margin:0 6px; padding:4px; background:#1e1812; color:#f0e4c8; border:1px solid #6a5a44; border-radius:4px; font:inherit;">
			${button('put', 'Put in')}${button('take', 'Take out')}${button('putAll', 'Put in all')}${button('takeAll', 'Take out all')}</div>`;
	} else {
		let buy = '';
		for (const type of trade.sells) {
			const it = ITEMS[type];
			const colours = it.clothing ? it.colours.map((c, k) => `<span data-act="buy" data-type="${type}" data-colour="${k}" title="${c}" style="display:inline-block; width:16px; height:16px; margin-left:4px; border-radius:3px; border:1px solid #000; background:${COLOURS[c]}; cursor:pointer;"></span>`).join('') : button('buy', 'Buy', `data-type="${type}"`);
			buy += row(`${picture(type, it.clothing ? COLOURS[it.colours[0]] : it.tint)}<div><div>${html(it.name)}</div><div style="font-size:11px; color:#b8a888;">${html(it.detail ?? '')}</div></div>`, `<span style="margin-right:4px;">${dollars(cents(type))}</span>${colours}`);
		}
		if (trade.horse) buy = row(`${picture('haversack', '#6a4a2a')}<div><div>Saddled horse</div><div style="font-size:11px; color:#b8a888;">Brought round for you: its saddlebags carry the camp (a tent, its stove, its rain collector, two bedrolls)</div></div>`,
			`<span style="margin-right:4px;">${dollars(HORSE * 100)}</span>${button('horse', 'Buy')}`) + buy;
		let sell = '';
		const mine = inventory.everything().filter(({ item, where }) => where.kind == 'grid' && trade.buys.includes(item.type) && offer(item.type) > 0);
		for (const { item } of mine) sell += row(`${picture(item.type, tintOf(item))}<div>${html(nameOf(item))}${item.count > 1 ? ` × ${item.count}` : ''}</div>`, `<span>${dollars(offer(item.type))}</span>${button('sell', 'Sell', `data-uid="${item.uid}"`)}`);
		body = `<div style="display:flex; gap:16px; align-items:flex-start;">
			<div style="flex:1; min-width:300px;"><div style="font-size:11px; letter-spacing:0.18em; color:#b8a888; margin:6px 8px;">FOR SALE</div>${buy}</div>
			<div style="flex:1; min-width:260px;"><div style="font-size:11px; letter-spacing:0.18em; color:#b8a888; margin:6px 8px;">YOURS TO SELL (from your bags)</div>${sell || '<div style="padding:8px; color:#9a8a70;">Nothing they would buy</div>'}</div></div>`;
	}
	root.innerHTML = `<div style="margin:auto; width:min(860px, calc(100vw - 32px)); background:rgba(40,32,24,0.96); border:1px solid #5a4a36; border-radius:6px; padding:12px 16px;">
		<div style="display:flex; align-items:center; margin-bottom:8px;"><div style="font-size:16px; letter-spacing:0.12em;">${html(trade.title.toUpperCase())}${trade.title != title(shop.person.profession.name) ? ' · ' + html(title(shop.person.profession.name)) : ''}</div>
		<div style="margin-left:auto;">You carry <b>${dollars(carried)}</b>${button('close', 'Close')}</div></div>${body}
		<div style="margin-top:8px; font-size:11px; color:#9a8a70;">They pay ${Math.round(SELL * 100)}% of the price · Esc, Tab or E to leave</div></div>`;
	const input = root.querySelector('[data-amount]');
	if (input) input.addEventListener('input', () => { shop.amount = input.value; });
}
export function openShop(person) {
	shop.person = person;
	// (it stops, and turns to the walker, while they trade: townFolk.js, as the horde leads one)
	const q = person.place, p = hunting.hunterPlace();
	if (q) townFolk.setLed(person.index, { ...q, heading: Math.atan2(p.x - q.x, p.z - q.z), walking: 0 });
	shop.trade = TRADES[person.profession.name];
	root.style.display = 'flex';
	hunting.input.menuOpen = true;
	if (document.pointerLockElement) document.exitPointerLock();
	if (shop.trade.bank) bankAsk();
	render();
}
export function closeShop() {
	if (!shop.person) return;
	townFolk.setLed(shop.person.index, null);
	shop.person = null;
	root.style.display = 'none';
	hunting.input.menuOpen = false;
	hunting.releaseKeys();
	canvas.requestPointerLock?.()?.catch?.(() => {});
}
// buying, selling, the bank
export function buy(type, colour = null) {
	const price = cents(type);
	if (!inventory.pay(price)) { help.toast('Not enough money'); return false; }
	const item = makeItem(type, 1, colour);
	if (!inventory.give(item)) { loot.dropHere([item]); help.toast('No room for it: on the ground at your feet'); }
	else help.toast('Bought: ' + nameOf(item));
	return true;
}
export function buyHorse() {
	if (!inventory.pay(HORSE * 100)) { help.toast('Not enough money'); return false; }
	if (!horse.bringHorse()) { inventory.receive(HORSE * 100); return false; }
	return true;
}
export function sell(uid) {
	const found = inventory.everything().find(({ item }) => item.uid == uid)?.item;
	if (!found || !shop.trade?.buys?.includes(found.type)) return false;
	const price = offer(found.type);
	inventory.useOne(found);
	inventory.receive(price);
	help.toast('Sold for ' + dollars(price));
	return true;
}
function amountOf() { return Math.max(0, Math.round((parseFloat(shop.amount) || 0) * 100)); }
root.addEventListener('click', (e) => {
	const el = e.target.closest('[data-act]');
	if (!el) return;
	const act = el.dataset.act;
	if (act == 'close') { closeShop(); return; }
	if (act == 'buy') buy(el.dataset.type, el.dataset.colour !== undefined ? Number(el.dataset.colour) : null);
	if (act == 'horse') buyHorse();
	if (act == 'sell') sell(Number(el.dataset.uid));
	if (act == 'put' || act == 'putAll') {
		const amount = act == 'putAll' ? inventory.moneyCarried() : amountOf();
		if (amount <= 0) return;
		if (!inventory.pay(amount)) { help.toast('You do not carry that much'); return; }
		bankAsk(amount, 0);
	}
	if (act == 'take' || act == 'takeAll') {
		const amount = act == 'takeAll' ? bank.cents ?? 0 : amountOf();
		if (amount > 0) bankAsk(0, amount);
	}
	render();
});
window.addEventListener('keydown', (e) => {
	if (!shop.person || e.target?.matches?.('input')) return;
	if (e.code == 'Escape' || e.code == 'Tab' || e.code == 'KeyE') { e.preventDefault(); closeShop(); }
});
inventory.onChange(() => render());

// Once a frame: walked away, or the trader gone in, the shop shuts
export function shopsUpdate() {
	if (!shop.person) return;
	const q = shop.person.place, p = hunting.hunterPlace(), m = settings.forestUnitsPerMetre;
	if (!inventory.survivalOn() || !hunting.hunterLife.alive || !q || Math.hypot(q.x - p.x, q.z - p.z) > 5 * m) closeShop();
}
