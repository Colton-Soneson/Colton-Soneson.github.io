import {canvas} from './deviceSelection.js'
import { settings } from './settings.js';

import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as help from './controlsHelp.js'
import { ITEMS, SLOTS, SLOT_NAMES, HANDS, HAND_NAMES, ICONS, handSlots, sizeOf, nameOf, tintOf, weightOf, dollars, placeFor, QUALITY, qualityOf } from './items.js'
import * as inventory from './inventory.js'
import * as survival from './survival.js'
import * as loot from './loot.js'
import * as bedrolls from './bedrolls.js'
import * as campfires from './campfires.js'
import * as camp from './camp.js'
import * as crafting from './crafting.js'
import * as rabbits from './rabbits.js'
import * as medical from './medical.js'
import * as stations from './stations.js'
import * as journal from './journalUI.js'
import * as spit from './spit.js'

/*
	THE INVENTORY of the Survival game mode: in the journal (journalUI.js): pulled out and opened in the hands, its pages written in charcoal. I (or E at a container, loot.js) opens it, I, Tab, Esc or F shuts it. Four columns, and a fifth
	under its small Crafting tab (crafting.js: a six by six grid to lay things out in, any way round, and what they make in the output slot, dragged
	out of it into the inventory or off on to the ground), or its First Aid tab (medical.js: a man after Leonardo's, each limb as it is: right click one for what can be done for it):
		GEAR		what is worn, a slot each (items.js: SLOTS)
		EQUIPPED	the hands: primary, secondary, item 1 to 4 (what T offers, survival.js), the pocket (one cell: the money, say); and under
					them how the walker is (the needs, what it feels like, what the clothes come to, what is carried against what can be)
		BACKPACK	its grid, the pouches attached to it (a slot each, and each one's grid), and the extra's grid (a webbing belt)
		CONTAINER	what is being searched (loot.js), its grid, when there is one; or a tent's slots, or a horse's saddlebags (camp.js):
					a slot each for what goes there and nothing else
	DRAGGING: hold the mouse on a thing and take it where it is to go: a slot it is for, a place in a grid it fits (R turns it as it goes),
	on to a stack of its own kind, or off the screen altogether to put it down on the ground (a pile, loot.js). Double click: into the
	container being searched or out of it, or on or off. Right click: what can be done with it (eat, drink, sleep, put on, take off,
	put down). Hovering, what it is.
*/
const CELL = 42;					// pixels
const SLOT = 68;

const ui = { open: false, container: null, camp: null, drag: null, menu: null, crafting: false, aid: false, spit: null };
export const uiState = ui;
const root = document.createElement('div');
root.style.cssText = `position: fixed; inset: 0; z-index: 20; display: none; background: rgba(12, 10, 8, 0.75); color: ${journal.INK}; font: 12px ${journal.HAND}; user-select: none; overflow: auto;`;
document.body.appendChild(root);
const tip = document.createElement('div');
tip.className = 'jr-page';
tip.style.cssText = `position: fixed; z-index: 22; pointer-events: none; display: none; max-width: 260px; padding: 6px 9px; border: 1.5px solid ${journal.INK}; border-radius: 3px; font: 12px ${journal.HAND};`;
document.body.appendChild(tip);

const html = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const panel = (title, body) => `<div style="padding: 4px 8px 6px; margin-bottom: 10px;">
	<div class="jr-title">${title.charAt(0) + title.slice(1).toLowerCase()}</div><div>${body}</div></div>`;
function icon(item, w, h) {
	const it = ITEMS[item.type];
	// (turned: the picture drawn upright in the turned box's shape, and turned with it)
	const [iw, ih] = item.rot ? [h, w] : [w, h];
	return `<svg viewBox="0 0 40 40" preserveAspectRatio="xMidYMid meet" style="position:absolute; left:50%; top:50%; width:${iw}px; height:${ih}px; transform: translate(-50%, -50%)${item.rot ? ' rotate(90deg)' : ''}; opacity: 0.95;">
		<path d="${ICONS[it.icon] ?? ICONS.pouch}" fill="${journal.INK}" fill-opacity="0.62" stroke="${journal.INK}" stroke-width="1.3" stroke-linejoin="round" fill-rule="evenodd" style="filter:url(#charcoal);"/></svg>`;
}
// a thing, drawn in a box w x h pixels
function thing(item, w, h, src) {
	const it = ITEMS[item.type];
	return `<div class="it" data-uid="${item.uid}" data-src="${src}" style="position:absolute; inset:2px; border-radius:3px 5px 2px 4px; background:rgba(43,37,32,0.07); border:1.3px solid rgba(43,37,32,0.7); cursor:grab; overflow:hidden;">
		<div style="position:absolute; inset:0;">${icon(item, w - 12, h - 12)}</div>
		<div style="position:absolute; left:3px; top:1px; font-size:9px; color:${journal.INK}; white-space:nowrap; overflow:hidden; max-width:${w - 8}px;">${html(it.name)}</div>
		${it.pelt ? `<div style="position:absolute; left:3px; bottom:1px; font-size:9px; letter-spacing:-1px; color:${journal.INK};">${'★'.repeat(qualityOf(item))}</div>` : ''}
		${it.money ? `<div style="position:absolute; right:3px; bottom:1px; font-size:10px; font-weight:bold; color:${journal.INK};">${dollars(item.count)}</div>`
			: item.count > 1 ? `<div style="position:absolute; right:3px; bottom:1px; font-size:12px; font-weight:bold; color:${journal.INK};">${item.count}</div>` : ''}</div>`;
}
function slotBox(key, name, item, w = SLOT, h = SLOT) {
	return `<div class="slot" data-slot="${key}" style="position:relative; width:${w}px; height:${h}px; border:1.3px dashed rgba(43,37,32,0.55); border-radius:4px 2px 5px 3px;">
		${item ? thing(item, w, h, key) : `<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; font-size:10px; color:rgba(43,37,32,0.5); padding:4px;">${html(name)}</div>`}</div>`;
}
function gridBox(id, grid, items, src) {
	let cells = '';
	for (const item of items) {
		const [w, h] = sizeOf(item);
		cells += `<div style="position:absolute; left:${item.x * CELL}px; top:${item.y * CELL}px; width:${w * CELL}px; height:${h * CELL}px;">${thing(item, w * CELL, h * CELL, src)}</div>`;
	}
	return `<div class="grid" data-grid="${id}" style="position:relative; width:${grid[0] * CELL}px; height:${grid[1] * CELL}px; background-image: linear-gradient(rgba(43,37,32,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(43,37,32,0.3) 1px, transparent 1px); background-size:${CELL}px ${CELL}px; border:1.6px solid ${journal.INK};">${cells}</div>`;
}

function render() {
	if (!ui.open) return;
	const I = inventory.inv, worn = inventory.wornStats(), S = survival.status;
	const gear = [['headHat', 'headFace'], ['torsoInner', 'torsoOuter'], ['legsInner', 'legsOuter'], ['feetInner', 'feetOuter'], ['wrist', 'extra']]
		.map((row) => `<div style="display:flex; gap:8px; margin-bottom:8px;">${row.map((s) => slotBox('worn:' + s, SLOT_NAMES[s], I.worn[s])).join('')}</div>`).join('')
		+ slotBox('worn:backpack', 'Backpack', I.worn.backpack, SLOT * 2 + 8, SLOT);
	const hands = `<div style="margin-bottom:8px;">${slotBox('hand:primary', 'Primary weapon', I.hands.primary, 222, 64)}</div>
		<div style="margin-bottom:8px;">${slotBox('hand:secondary', 'Secondary weapon', I.hands.secondary, 160, 64)}</div>
		<div style="display:flex; gap:6px;">${['item1', 'item2', 'item3', 'item4'].map((h) => slotBox('hand:' + h, HAND_NAMES[h], I.hands[h], 56, 56)).join('')}</div>
		<div style="display:flex; align-items:center; gap:10px; margin-top:10px;"><span style="font-size:12px; font-weight:bold;">Pocket</span>${gridBox('pocket', ITEMS.pocket.grid, I.pocket.contents, 'grid:pocket')}
		<span>${dollars(inventory.moneyCarried())} carried</span></div>`;
	const bar = (name, v, colour) => `<div style="display:flex; justify-content:space-between; margin-top:5px;"><span>${name}</span><span>${Math.round(v)}%</span></div>
		<div style="height:8px; border:1.2px solid ${journal.INK}; border-radius:2px 3px 2px 4px; overflow:hidden;"><div style="height:100%; width:${v}%; background: repeating-linear-gradient(115deg, ${colour} 0 2px, transparent 2px 4px);"></div></div>`;
	const tone = (v) => v < 50 ? journal.INK : v < 80 ? '#5a3a20' : journal.RED;
	const t = S.temperature;
	const status = bar('Hunger', S.hunger, tone(S.hunger)) + bar('Thirst', S.thirst, tone(S.thirst)) + bar('Wetness', S.wet * 100, journal.INK) + bar('Tiredness', S.tired, tone(S.tired)) + bar('Stress', S.stress, tone(S.stress))
		+ `<div style="display:flex; justify-content:space-between; margin-top:5px;"><span>Temperature</span><span>${t < -50 ? 'Freezing' : t < -15 ? 'Cold' : t > 50 ? 'Overheating' : t > 15 ? 'Warm' : 'Comfortable'}</span></div>
		<div style="position:relative; height:8px; border:1.2px solid ${journal.INK}; border-radius:2px 3px 2px 4px; overflow:hidden;"><div style="position:absolute; left:${t < 0 ? 50 + t / 2 : 50}%; width:${Math.abs(t) / 2}%; height:100%; background: repeating-linear-gradient(115deg, ${t < 0 ? journal.INK : journal.RED} 0 2px, transparent 2px 4px);"></div><div style="position:absolute; left:50%; width:1.5px; height:100%; background:${journal.INK};"></div></div>
		<div style="margin-top:8px; line-height:1.55;">Feels like <b>${S.feels.toFixed(0)}°C</b> (air ${survival.airTemperature().toFixed(0)}°C)<br>
		Clothes: warmth +${worn.warmth.toFixed(1)}°C · rain kept off ${Math.round(worn.waterproof * 100)}%<br>Sweat ${worn.sweat >= 0 ? 'let out' : 'held in'} ${Math.round(Math.abs(worn.sweat) * 100)}% · armour ${Math.round(worn.armour * 100)}%<br>
		<span style="color:${worn.load > worn.capacity ? journal.RED : journal.INK};">Load ${worn.load.toFixed(1)} / ${worn.capacity.toFixed(0)} kg${worn.load > worn.capacity ? ' (slowed)' : ''}</span></div>`;
	let pack = '';
	const P = I.worn.backpack;
	if (P) {
		pack += panel(html(ITEMS[P.type].name).toUpperCase(), gridBox('pack', ITEMS[P.type].grid, P.contents, 'grid:pack'));
		let att = `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">${P.attached.map((p, k) => slotBox('attach:' + k, 'Pouch', p, 72, 56)).join('')}</div>`;
		P.attached.forEach((p, k) => { if (p) att += `<div style="margin:6px 0 2px;">${html(ITEMS[p.type].name)}</div>` + gridBox('attach' + k, ITEMS[p.type].grid, p.contents, 'grid:attach' + k); });
		pack += panel('BACKPACK ATTACHMENTS', att);
	} else pack += panel('BACKPACK', '<div style="color:rgba(43,37,32,0.5);">No backpack worn</div>');
	const E = I.worn.extra;
	if (E && ITEMS[E.type].grid) pack += panel(html(ITEMS[E.type].name).toUpperCase(), gridBox('extra', ITEMS[E.type].grid, E.contents, 'grid:extra'));
	let found = '';
	const C = ui.container && loot.containerById(ui.container);
	if (C) found = panel(html(loot.label(C)).toUpperCase(), C.items ? gridBox('loot', C.grid, C.items, 'loot') : '<div>Searching…</div>');
	if (ui.spit) {
		const S = ui.spit, on = S.meat ? { uid: -7, type: spit.typeNow(S.meat), count: 1, x: 0, y: 0, rot: 0 } : null, k = S.meat?.cook ?? 0;
		found = panel('COOKING SPIT', `${slotBox('spit', 'Raw meat', on, 96, 84)}<div style="margin-top:8px; line-height:1.5; max-width:200px;">${S.meat ? `${Math.round(Math.min(k, 1) * 100)}% cooked${k >= 1.75 ? ', burnt' : k >= 1 ? ': take it off before it burns' : ''}<br>` : ''}Drag raw meat on to it (venison, rabbit, wolf, bear, rat, moose); drag it off to take it</div>`);
	}
	if (ui.camp) {
		const h = camp.holder(ui.camp), said = camp.describe(ui.camp);
		if (!h) found = panel(ui.camp.kind == 'bags' ? 'SADDLEBAGS' : 'TENT', '<div>Opening…</div>');
		else found = panel(said.title, `<div style="display:grid; grid-template-columns: repeat(2, ${SLOT + 14}px); gap:8px;">${Object.keys(camp.slotsOf(ui.camp)).map((s) => `<div><div style="font-size:10px; margin-bottom:2px;">${html(camp.SLOT_NAMES[s])}</div>${slotBox('camp:' + s, camp.SLOT_NAMES[s], h.slots[s], SLOT + 14, SLOT)}</div>`).join('')}</div>
			<div style="margin-top:8px; line-height:1.5; max-width:180px;">${said.lines.map(html).join('<br>')}</div>`);
	}
	const tab = (key, name, on) => `<span data-tab="${key}" style="display:inline-block; padding:3px 14px; margin-right:4px; border:1.4px solid ${journal.INK}; border-bottom:none; border-radius:6px 8px 0 0; cursor:pointer; font-size:12px; font-weight:${on ? 'bold' : 'normal'}; background:url(${journal.PAPER}); color:${journal.INK}; opacity:${on ? 1 : 0.72};">${name.charAt(0) + name.slice(1).toLowerCase()}</span>`;
	const recipe = crafting.recipeNow();
	const craftColumn = ui.crafting ? `<div>${panel('CRAFTING', `<div style="display:flex; gap:12px; align-items:center;">${gridBox('craft', inventory.CRAFT_GRID, I.craft, 'grid:craft')}
		<div style="text-align:center;"><div style="font-size:18px; margin-bottom:4px;">⇒</div>${slotBox('craftOut', 'Output', crafting.outputNow(), 84, 84)}</div></div>
		<div style="margin-top:8px; max-width:360px; line-height:1.5;">${recipe ? html(crafting.describe(recipe)) : 'Lay things out in the grid, any way round'}<br><span style="color:rgba(43,37,32,0.6);">Makes: ${crafting.RECIPES.map((r) => html(crafting.describe(r))).join(' · ')}</span>${inventory.isGod() ? `<div style="margin-top:8px;"><b>God mode, free:</b><div style="display:flex; flex-wrap:wrap; gap:5px; margin-top:4px;">${crafting.freeMakes().map((type) => `<button class="jr-btn" data-free="${type}">${html(ITEMS[type].name)}</button>`).join('')}</div></div>` : ''}</div>`)}</div>` : '';
	root.innerHTML = `<div style="position:fixed; left:32px; top:4px; z-index:1;">${tab('bag', 'INVENTORY', !ui.crafting && !ui.aid)}${tab('craft', 'CRAFTING', ui.crafting)}${tab('aid', 'FIRST AID', ui.aid)}</div><div class="jr-spread" style="position:relative; display:flex; gap:16px; padding:18px 22px 34px; align-items:flex-start; min-width:max-content; margin:auto; margin-top:30px; margin-bottom:12px;">
		<div>${panel('GEAR', gear)}</div>
		<div style="width:250px;">${panel('EQUIPPED', hands)}${panel('CONDITION', status)}</div>
		<div>${pack}</div>
		${found ? `<div>${found}</div>` : ''}
		${craftColumn}
		${ui.aid ? `<div>${firstAidPanel()}</div>` : ''}
		<div style="position:absolute; left:22px; right:22px; bottom:8px; text-align:center; font-size:11px; color:rgba(43,37,32,0.62);">Drag to move · R turns · drop off the screen to put it down · double click: in or out · right click: more · Tab, I, Esc or F to close</div>
	</div>`;
}

// THE FIRST AID TAB (see the top): the man in his circle and square, each limb coloured by the worst on it, and what is wrong by name
const LIMB_SHAPES = {
	head: '<circle cx="110" cy="52" r="13"/>',
	torso: '<path d="M96 67 L124 67 L128 80 L124 118 L118 130 L102 130 L96 118 L92 80 Z"/>',
	armL: '<path d="M93 72 L60 72 L24 66 L23 73 L58 83 L92 84 Z"/>',
	armR: '<path d="M127 72 L160 72 L196 66 L197 73 L162 83 L128 84 Z"/>',
	legL: '<path d="M101 130 L109 134 L104 170 L94 212 L82 212 L88 172 Z"/>',
	legR: '<path d="M119 130 L111 134 L116 170 L126 212 L138 212 L132 172 Z"/>',
};
function firstAidPanel() {
	const fill = (conditions) => conditions.length ? conditions[conditions.length - 1][1] : 'rgba(43, 37, 32, 0.08)';
	const limbs = Object.keys(LIMB_SHAPES).map((k) => { const c = medical.conditionsOf(k); return `<g data-limb="${k}" style="cursor:context-menu;" fill="${fill(c)}" stroke="#3a2c1c" stroke-width="1"><title>${medical.LIMB_NAMES[k]}: right click to treat</title>${LIMB_SHAPES[k]}</g>`; }).join('');
	const drawing = `<svg viewBox="0 0 220 240" width="300" height="327" style="display:block; filter:url(#charcoal);">
		<circle cx="110" cy="122" r="104" fill="none" stroke="#6b5233" stroke-width="1.2"/><rect x="18" y="30" width="184" height="184" fill="none" stroke="#6b5233" stroke-width="1.2"/>
		<path d="M93 74 L52 46 L24 30 M127 74 L168 46 L196 30 M101 130 L70 176 L44 214 M119 130 L150 176 L176 214" fill="none" stroke="#6b5233" stroke-width="1.6" opacity="0.55"/>
		<path d="M110 30 L110 214 M18 122 L202 122" stroke="#6b5233" stroke-width="0.4" opacity="0.5"/>
		${limbs}</svg>`;
	const rows = Object.keys(LIMB_SHAPES).map((k) => { const c = medical.conditionsOf(k); return `<div style="padding:3px 0; border-bottom:1px dashed rgba(43,37,32,0.25);"><b>${medical.LIMB_NAMES[k]}</b>: ${c.length ? c.map(([t, colour]) => `<span style="color:${colour};">${html(t)}</span>`).join(' · ') : '<span style="color:rgba(43,37,32,0.55);">fine</span>'}</div>`; }).join('');
	const sick = medical.moodles().filter(([key]) => medical.ILLNESS[key]).map(([key]) => { const I = medical.ILLNESS[key]; return `<div style="margin-top:4px;"><b style="color:${journal.RED};">${html(I.name)}</b>: <span>${html(I.detail)}</span></div>`; }).join('');
	return panel('FIRST AID', `<div style="display:flex; gap:12px; align-items:flex-start;">${drawing}<div style="width:260px; line-height:1.45;">${rows}${sick || '<div style="margin-top:8px; color:rgba(43,37,32,0.55);">No illness</div>'}<div style="margin-top:8px; font-size:11px; color:rgba(43,37,32,0.6);">Right click a limb to treat it</div></div></div>`);
}
medical.onChange(() => render());

// OPEN AND SHUT
export function openInventory(containerId = null) {
	if (!inventory.survivalOn() || !hunting.hunterPlace().active) return;
	ui.open = true;
	ui.container = containerId;
	ui.camp = null;
	ui.spit = null;
	journal.pull(() => { if (ui.open) { root.style.display = 'flex'; render(); } });
	render();
}
export function closeInventory() {
	if (!ui.open) return;
	ui.open = false;
	ui.container = null;
	ui.camp = null;
	ui.spit = null;
	ui.drag = null;
	closeMenu();
	tip.style.display = 'none';
	root.style.display = 'none';
	journal.put();
}
loot.onOpen((id) => openInventory(id));
// a tent's slots, or a horse's saddlebags (camp.js)
export function openCamp(ref) {
	openInventory();
	if (!ui.open) return;
	ui.camp = ref;
	render();
}
camp.onOpen((ref) => openCamp(ref));
// a cooking spit's slot (spit.js)
spit.onOpen((item) => { openInventory(); if (ui.open) { ui.spit = item; render(); } });
camp.onChange(() => render());
window.addEventListener('keydown', (e) => {
	if ((e.code == 'KeyI' || e.code == 'Tab') && inventory.survivalOn()) {
		if (e.code == 'Tab') e.preventDefault();		// (not round the page's controls)
		if (e.repeat) return;
		if (ui.open) closeInventory(); else if (document.pointerLockElement == canvas && !hunting.input.menuOpen && !journal.journalOut()) openInventory();
	}
	else if ((e.code == 'Escape' || e.code == 'KeyF') && ui.open) closeInventory();
	else if (e.code == 'KeyR' && ui.drag) { ui.drag.rot = 1 - ui.drag.rot; drawGhost(); }
});
inventory.onChange(() => render());
loot.onContents((id) => { if (ui.open && (id == ui.container || !loot.containerById(ui.container))) { if (!loot.containerById(ui.container)) ui.container = null; render(); } });
// walked away from what it was searching: that column goes
export function inventoryUIUpdate() {
	if (!ui.open) return;
	if (!inventory.survivalOn() || !hunting.hunterLife.alive) { closeInventory(); return; }
	const C = ui.container && loot.containerById(ui.container);
	const p = hunting.hunterPlace(), m = settings.forestUnitsPerMetre;
	if (C && Math.hypot(C.at[0] - p.x, C.at[2] - p.z) > 4 * m) { ui.container = null; render(); }
	if (ui.camp && !camp.nearEnough(ui.camp)) { ui.camp = null; render(); }
}

// WHERE A THING IS (src: 'worn:slot', 'hand:slot', 'attach:k', 'grid:id', 'loot')
function find(src, uid) {
	if (src == 'loot') return loot.containerById(ui.container)?.items?.find((i) => i.uid == uid) ?? null;
	if (src.startsWith('camp:')) return camp.holder(ui.camp)?.slots[src.slice(5)] ?? null;
	if (src == 'craftOut') return crafting.outputNow();
	if (src == 'spit') return ui.spit?.meat ? { uid: -7, type: spit.typeNow(ui.spit.meat), count: 1, x: 0, y: 0, rot: 0 } : null;
	if (src == 'grid:craft') return inventory.inv.craft.find((i) => i.uid == uid) ?? null;
	return inventory.everything().find(({ item }) => item.uid == uid)?.item ?? null;
}
const whereOf = (src) => {
	const [kind, key] = src.split(':');
	if (kind == 'worn' || kind == 'hand') return { kind, slot: key };
	if (kind == 'attach') return { kind, index: Number(key) };
	if (kind == 'grid') return { kind, grid: key };
	return null;
};
// a thing taken from where it was (the inventory) to where it is to go: true if it went (it goes back if not)
function moveOwn(item, src, to, x = 0, y = 0, rot = item.rot) {
	const from = whereOf(src), was = { x: item.x, y: item.y, rot: item.rot };
	inventory.remove(item);
	if (inventory.put(to, item, x, y, rot)) return true;
	inventory.put(from, Object.assign(item, was), was.x, was.y, was.rot);
	return false;
}
// the first place it is for, worn or in the hands; or back into the pack
function quickEquip(item, src) {
	const it = ITEMS[item.type];
	if (src.startsWith('worn') || src.startsWith('hand') || src.startsWith('attach')) {
		inventory.remove(item);
		if (!inventory.give(item)) { loot.dropHere([item]); help.toast('No room: put down'); }
		return;
	}
	const targets = [];
	if (typeof it.slot == 'string' && it.slot != 'attachment') targets.push({ kind: 'worn', slot: it.slot });
	for (const h of handSlots(item.type)) targets.push({ kind: 'hand', slot: h });
	if (it.slot == 'attachment') (inventory.inv.worn.backpack?.attached ?? []).forEach((_, k) => targets.push({ kind: 'attach', index: k }));
	for (const to of targets) if (inventory.accepts(to, item)) { moveOwn(item, src, to); return; }
	help.toast('Nowhere free to put it on');
}
function useItem(item, src) {
	const it = ITEMS[item.type];
	if (!(it.food || it.drink || it.use)) return;
	if (src == 'loot') { help.toast('Take it first'); return; }
	if (it.use == 'deploy') { if (bedrolls.deploy(item)) closeInventory(); return; }
	if (survival.consume(item.type)) inventory.useOne(item);
}
// the first empty slot of what is open (a tent, the saddlebags) a thing goes in, or null
function campSlotFor(item) {
	const h = ui.camp && camp.holder(ui.camp), slots = camp.slotsOf(ui.camp);
	if (!h) return null;
	return Object.keys(slots).find((s) => slots[s] == ITEMS[item.type].camp && !h.slots[s]) ?? null;
}
// WHAT THE CRAFTING MAKES, dragged out of its slot (see the top): into a grid or a slot it goes in, on to a stack of its kind, or off on to the ground. Only
//		then is what went into it used up
function dropMade(item, el, mx, my, rot) {
	const gridEl = el?.closest('.grid'), slotEl = el?.closest('.slot'), onto = el?.closest('.it');
	if (onto && onto.dataset.src != 'craftOut' && onto.dataset.src != 'loot') {
		const target = find(onto.dataset.src, Number(onto.dataset.uid));
		if (target?.type == item.type && (ITEMS[item.type].stack ?? 1) > 1) {
			const made = crafting.take();
			if (made && inventory.stackOnto(target, made) > 0 && !inventory.give(made)) loot.dropHere([made]);
			return;
		}
	}
	if (gridEl && gridEl.dataset.grid != 'loot') {
		const r = gridEl.getBoundingClientRect(), [w, h] = sizeOf({ ...item, rot });
		const x = Math.round((mx - r.left) / CELL - w / 2), y = Math.round((my - r.top) / CELL - h / 2), to = { kind: 'grid', grid: gridEl.dataset.grid };
		if (!inventory.accepts(to, item, x, y, rot)) { help.toast('It does not go there'); return; }
		inventory.put(to, crafting.take(), x, y, rot);
		return;
	}
	if (slotEl) {
		const key = slotEl.dataset.slot, to = key.startsWith('camp:') || key == 'craftOut' ? null : whereOf(key);
		if (!to) return;
		if (!inventory.accepts(to, item)) { help.toast('It does not go there'); return; }
		inventory.put(to, crafting.take());
		return;
	}
	if (!el?.closest('[data-grid], .slot')) { const made = crafting.take(); if (made) loot.dropHere([made]); }
}
function dropOwn(item) {
	inventory.remove(item);
	loot.dropHere([item]);
}

// DRAGGING (see the top)
const ghost = document.createElement('div');
ghost.style.cssText = 'position: fixed; z-index: 23; pointer-events: none; display: none; opacity: 0.85;';
document.body.appendChild(ghost);
function drawGhost() {
	const d = ui.drag;
	if (!d) { ghost.style.display = 'none'; return; }
	const turned = { ...d.item, rot: d.rot };
	const [w, h] = sizeOf(turned);
	ghost.style.display = '';
	ghost.style.width = w * CELL + 'px';
	ghost.style.height = h * CELL + 'px';
	ghost.innerHTML = `<div style="position:relative; width:100%; height:100%;">${thing(turned, w * CELL, h * CELL, '')}</div>`;
	ghost.style.left = (d.mx - CELL / 2) + 'px';
	ghost.style.top = (d.my - CELL / 2) + 'px';
}
root.addEventListener('pointerdown', (e) => {
	if (e.button != 0) return;
	closeMenu();
	const tabEl = e.target.closest('[data-tab]');
	if (tabEl) { ui.crafting = tabEl.dataset.tab == 'craft'; ui.aid = tabEl.dataset.tab == 'aid'; render(); return; }
	const freeEl = e.target.closest('[data-free]');
	if (freeEl) { crafting.makeFree(freeEl.dataset.free); render(); return; }
	const el = e.target.closest('.it');
	if (!el) return;
	const item = find(el.dataset.src, Number(el.dataset.uid));
	if (!item) return;
	ui.drag = { item, src: el.dataset.src, rot: item.rot, mx: e.clientX, my: e.clientY, moved: false };
	e.preventDefault();
});
window.addEventListener('pointermove', (e) => {
	if (ui.open && !ui.drag) showTip(e);
	const d = ui.drag;
	if (!d) return;
	d.mx = e.clientX; d.my = e.clientY;
	if (!d.moved && Math.hypot(e.movementX, e.movementY) > 0) { d.moved = true; tip.style.display = 'none'; }
	if (d.moved) drawGhost();
});
window.addEventListener('pointerup', (e) => {
	const d = ui.drag;
	if (!d) return;
	ui.drag = null;
	ghost.style.display = 'none';
	if (!d.moved) return;
	drop(d, e.clientX, e.clientY);
	render();
});
function drop(d, mx, my) {
	const el = document.elementFromPoint(mx, my);
	const { item, src, rot } = d;
	if (src == 'craftOut') { dropMade(item, el, mx, my, rot); return; }
	// (the spit's slot: off it anywhere else; on to it, raw meat, one piece)
	const spitSlot = el?.closest('.slot')?.dataset.slot == 'spit';
	if (src == 'spit') { if (!spitSlot) spit.takeOff(ui.spit); return; }
	if (spitSlot) { if (src != 'loot' && !src.startsWith('camp:')) spit.put(ui.spit, item); return; }
	const fromLoot = src == 'loot';
	// (a tent's or the saddlebags' slots: out of one anywhere but another of them, in on to one)
	const campSlot = el?.closest('.slot')?.dataset.slot?.startsWith('camp:') ? el.closest('.slot').dataset.slot.slice(5) : null;
	if (src.startsWith('camp:')) { if (!campSlot) camp.take(ui.camp, src.slice(5)); return; }
	if (campSlot) { if (!fromLoot) camp.put(ui.camp, campSlot, item); return; }
	// on a stack of its own kind
	const onto = el?.closest('.it');
	if (onto && Number(onto.dataset.uid) != item.uid && onto.dataset.src != 'loot' && !fromLoot) {
		const target = find(onto.dataset.src, Number(onto.dataset.uid));
		if (target && target.type == item.type && (ITEMS[item.type].stack ?? 1) > 1) {
			if (inventory.stackOnto(target, item) == 0) inventory.remove(item);
			return;
		}
	}
	const gridEl = el?.closest('.grid'), slotEl = el?.closest('.slot');
	if (gridEl) {
		const r = gridEl.getBoundingClientRect(), [w, h] = sizeOf({ ...item, rot });
		const x = Math.round((mx - r.left) / CELL - w / 2), y = Math.round((my - r.top) / CELL - h / 2);
		const id = gridEl.dataset.grid;
		if (id == 'loot') {
			if (fromLoot) loot.moveIn(ui.container, item.uid, x, y, rot);
			else { const where = whereOf(src), was = { x: item.x, y: item.y, rot: item.rot }; inventory.remove(item); if (!loot.putInto(ui.container, item, x, y, rot)) inventory.put(where, Object.assign(item, was), was.x, was.y, was.rot); }
			return;
		}
		if (fromLoot) loot.take(ui.container, item.uid, { where: { kind: 'grid', grid: id }, x, y, rot });
		else moveOwn(item, src, { kind: 'grid', grid: id }, x, y, rot);
		return;
	}
	if (slotEl) {
		const to = whereOf(slotEl.dataset.slot);
		if (fromLoot) loot.take(ui.container, item.uid, { where: to, x: 0, y: 0, rot });
		else if (!moveOwn(item, src, to)) help.toast('It does not go there');
		return;
	}
	// off every column: put down
	if (!el?.closest('[data-grid], .slot') && !fromLoot) dropOwn(item);
}
root.addEventListener('dblclick', (e) => {
	const el = e.target.closest('.it');
	if (!el) return;
	const item = find(el.dataset.src, Number(el.dataset.uid));
	if (!item) return;
	if (el.dataset.src == 'spit') spit.takeOff(ui.spit);
	else if (ui.spit && spit.isRaw(item.type) && el.dataset.src != 'loot') spit.put(ui.spit, item);
	else if (el.dataset.src == 'craftOut') crafting.makeIntoInventory();
	else if (el.dataset.src == 'grid:craft') { inventory.remove(item); if (!inventory.give(item)) loot.dropHere([item]); }
	else if (el.dataset.src == 'loot') loot.take(ui.container, item.uid);
	else if (ui.crafting && !el.dataset.src.startsWith('camp:') && !el.dataset.src.startsWith('worn') && !el.dataset.src.startsWith('hand') && !el.dataset.src.startsWith('attach')) {
		// (the crafting tab open: into the grid, wherever it fits)
		const at = placeFor(inventory.CRAFT_GRID, inventory.inv.craft, item), where = whereOf(el.dataset.src), was = { x: item.x, y: item.y, rot: item.rot };
		if (!at || ITEMS[item.type].money) help.toast('It does not go in the grid');
		else { inventory.remove(item); if (!inventory.put({ kind: 'grid', grid: 'craft' }, item, at.x, at.y, at.rot)) inventory.put(where, Object.assign(item, was), was.x, was.y, was.rot); }
	}
	else if (el.dataset.src.startsWith('camp:')) camp.take(ui.camp, el.dataset.src.slice(5));
	else if (ui.camp && campSlotFor(item)) camp.put(ui.camp, campSlotFor(item), item);
	else if (ui.container) { const where = whereOf(el.dataset.src); inventory.remove(item); if (!loot.putInto(ui.container, item)) inventory.put(where, item, item.x, item.y, item.rot); }
	else quickEquip(item, el.dataset.src);
	render();
});

// RIGHT CLICK: what can be done with it
const menuBox = document.createElement('div');
menuBox.className = 'jr-page';
menuBox.style.cssText = `position: fixed; z-index: 24; display: none; border: 1.5px solid ${journal.INK}; border-radius: 3px; font: 13px ${journal.HAND}; min-width: 140px;`;
document.body.appendChild(menuBox);
function closeMenu() { menuBox.style.display = 'none'; ui.menu = null; }
function showMenu(acts, e) {
	menuBox.innerHTML = acts.map(([name], k) => `<div data-k="${k}" style="padding:6px 12px; cursor:pointer;" onmouseover="this.style.background='rgba(43,37,32,0.14)'" onmouseout="this.style.background=''">${html(name)}</div>`).join('');
	menuBox.style.left = e.clientX + 'px';
	menuBox.style.top = e.clientY + 'px';
	menuBox.style.display = '';
	ui.menu = acts;
}
root.addEventListener('contextmenu', (e) => {
	e.preventDefault();
	// a limb, on the first aid tab: what can be done for it
	const limb = e.target.closest('[data-limb]');
	if (limb) { showMenu(medical.actionsFor(limb.dataset.limb).map((a) => [a.label, a.act]), e); return; }
	const el = e.target.closest('.it');
	if (!el) { closeMenu(); return; }
	const src = el.dataset.src, item = find(src, Number(el.dataset.uid));
	if (!item) return;
	const it = ITEMS[item.type], acts = [];
	if (src == 'spit') acts.push(['Take it off', () => spit.takeOff(ui.spit)]);
	else if (src == 'craftOut') acts.push(['Make it', () => crafting.makeIntoInventory()]);
	else if (src == 'loot') acts.push(['Take', () => loot.take(ui.container, item.uid)]);
	else if (src.startsWith('camp:')) acts.push(['Take out', () => camp.take(ui.camp, src.slice(5))]);
	else {
		if (it.food) acts.push(['Eat', () => useItem(item, src)]);
		if (it.drink && !it.food) acts.push(['Drink', () => useItem(item, src)]);
		if (it.use == 'deploy') acts.push(['Deploy', () => useItem(item, src)]);
		if (it.use == 'pitch') acts.push(['Pitch tent', () => { if (camp.pitch(item)) closeInventory(); }]);
		if (ui.camp && campSlotFor(item)) acts.push([ui.camp.kind == 'tent' ? 'Into the tent' : 'Into the saddlebags', () => camp.put(ui.camp, campSlotFor(item), item)]);
		if (item.type == 'firewood') acts.push(['Build campfire', () => { const at = campfires.buildSpot(); if (!at) { help.toast('No room for a fire here'); return; } inventory.useOne(item); campfires.build(at); closeInventory(); help.toast('Campfire laid: light it with the lighter'); }]);
		if (ui.spit && spit.isRaw(item.type)) acts.push(['Put on the spit', () => spit.put(ui.spit, item)]);
		if (spit.isRaw(item.type) && camp.burningNear(hunting.hunterPlace().x, hunting.hunterPlace().z, 3)) acts.push(['Cook on the stove', () => campfires.cook(item)]);
		if (it.use == 'station') acts.push(['Set it up', () => { if (stations.place(item)) closeInventory(); }]);
		if (it.use == 'trap') acts.push(['Set the snare', () => { if (rabbits.setSnare(item)) closeInventory(); }]);
		const on = src.startsWith('worn') || src.startsWith('hand') || src.startsWith('attach');
		if (on) acts.push(['Take off', () => quickEquip(item, src)]);
		else if (typeof it.slot == 'string' || handSlots(item.type).length) acts.push([typeof it.slot == 'string' && it.slot != 'attachment' ? 'Wear' : 'Equip', () => quickEquip(item, src)]);
		if (ui.container) acts.push(['Into ' + loot.label(loot.containerById(ui.container)).toLowerCase(), () => { const where = whereOf(src); inventory.remove(item); if (!loot.putInto(ui.container, item)) inventory.put(where, item, item.x, item.y, item.rot); }]);
		if (item.count > 1) acts.push(['Split', () => { const half = Math.floor(item.count / 2); item.count -= half; const part = { ...structuredClone(item), uid: Math.floor(Math.random() * 1e12), count: half }; if (!inventory.give(part)) { item.count += half; help.toast('No room to split it'); } inventory.changed(); }]);
		acts.push(['Put down', () => dropOwn(item)]);
	}
	showMenu(acts, e);
});
menuBox.addEventListener('click', (e) => {
	const k = Number(e.target.closest('[data-k]')?.dataset.k);
	const act = ui.menu?.[k];
	closeMenu();
	act?.[1]();
	render();
});

// HOVERING: what it is
function showTip(e) {
	const el = e.target.closest?.('.it');
	if (!el || !root.contains(el)) { tip.style.display = 'none'; return; }
	const item = find(el.dataset.src, Number(el.dataset.uid));
	if (!item) { tip.style.display = 'none'; return; }
	const it = ITEMS[item.type], lines = [];
	const share = (v, name) => { if (v) lines.push(`${name} ${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`); };
	if (typeof it.slot == 'string') lines.push(it.slot == 'attachment' ? 'A pouch for a backpack' : 'Worn: ' + SLOT_NAMES[it.slot]);
	else if (handSlots(item.type).length) lines.push('Equipped: ' + [...new Set(handSlots(item.type).map((h) => h.startsWith('item') ? 'item slots' : HAND_NAMES[h].toLowerCase()))].join(', '));
	share(it.insulation, 'Insulation'); share(it.water, 'Water resistance'); share(it.sweat, 'Sweat resistance'); share(it.carry, 'Carrying'); share(it.armour, 'Armour');
	if (it.money) lines.push(dollars(item.count));
	if (it.grid) lines.push(`Holds ${it.grid[0]} × ${it.grid[1]}${it.attach ? `, ${it.attach} pouch${it.attach > 1 ? 'es' : ''}` : ''}`);
	if (it.ammo) lines.push(`For the ${ITEMS[it.ammo]?.name ?? it.ammo}`);
	if (it.detail) lines.push(it.detail);
	const kg = weightOf(item);
	if (kg > 0) lines.push(`${kg < 1 ? Math.round(kg * 1000) + ' g' : kg.toFixed(1) + ' kg'}${it.price ? ' · worth ' + dollars(Math.round(it.price * 100 * (QUALITY[qualityOf(item)]?.worth ?? 1))) : ''}`);
	tip.innerHTML = `<b>${html(nameOf(item))}</b>${item.count > 1 && !it.money ? ` × ${item.count}` : ''}<div style="margin-top:4px; line-height:1.5;">${lines.map(html).join('<br>')}</div>`;
	tip.style.display = '';
	tip.style.left = (e.clientX + 14) + 'px';
	tip.style.top = (e.clientY + 14) + 'px';
}
