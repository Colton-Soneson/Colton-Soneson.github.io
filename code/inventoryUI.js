import {canvas} from './deviceSelection.js'
import { settings } from './settings.js';

import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as help from './controlsHelp.js'
import { ITEMS, SLOTS, SLOT_NAMES, HANDS, HAND_NAMES, ICONS, handSlots, sizeOf, nameOf, tintOf, weightOf, dollars } from './items.js'
import * as inventory from './inventory.js'
import * as survival from './survival.js'
import * as loot from './loot.js'
import * as bedrolls from './bedrolls.js'
import * as campfires from './campfires.js'
import * as camp from './camp.js'

/*
	THE INVENTORY SCREEN of the Survival game mode: I (or E at a container, loot.js) opens it, I or Esc shuts it. Four columns:
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

const ui = { open: false, container: null, camp: null, drag: null, menu: null };
export const uiState = ui;
const root = document.createElement('div');
root.style.cssText = 'position: fixed; inset: 0; z-index: 20; display: none; background: rgba(10, 8, 6, 0.86); color: #e6dcc8; font: 12px Georgia, "Times New Roman", serif; user-select: none; overflow: auto;';
document.body.appendChild(root);
const tip = document.createElement('div');
tip.style.cssText = 'position: fixed; z-index: 22; pointer-events: none; display: none; max-width: 240px; padding: 6px 8px; background: rgba(28, 22, 16, 0.96); border: 1px solid #6a5a44; border-radius: 4px; font: 12px Georgia, serif; color: #efe4cc;';
document.body.appendChild(tip);

const html = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const panel = (title, body) => `<div style="background: rgba(40, 32, 24, 0.92); border: 1px solid #5a4a36; border-radius: 6px; padding: 10px 12px; margin-bottom: 12px;">
	<div style="font-size: 11px; letter-spacing: 0.18em; color: #b8a888; margin-bottom: 8px;">${title}</div>${body}</div>`;
function icon(item, w, h) {
	const it = ITEMS[item.type];
	// (turned: the picture drawn upright in the turned box's shape, and turned with it)
	const [iw, ih] = item.rot ? [h, w] : [w, h];
	return `<svg viewBox="0 0 40 40" preserveAspectRatio="xMidYMid meet" style="position:absolute; left:50%; top:50%; width:${iw}px; height:${ih}px; transform: translate(-50%, -50%)${item.rot ? ' rotate(90deg)' : ''}; opacity: 0.95;">
		<path d="${ICONS[it.icon] ?? ICONS.pouch}" fill="${tintOf(item)}" stroke="rgba(0,0,0,0.6)" stroke-width="1" fill-rule="evenodd"/></svg>`;
}
// a thing, drawn in a box w x h pixels
function thing(item, w, h, src) {
	const it = ITEMS[item.type];
	return `<div class="it" data-uid="${item.uid}" data-src="${src}" style="position:absolute; inset:2px; border-radius:3px; background:rgba(80,66,48,0.55); border:1px solid rgba(200,180,140,0.35); cursor:grab; overflow:hidden;">
		<div style="position:absolute; inset:0;">${icon(item, w - 12, h - 12)}</div>
		<div style="position:absolute; left:3px; top:1px; font-size:9px; color:#f0e6d0; text-shadow:0 0 2px #000; white-space:nowrap; overflow:hidden; max-width:${w - 8}px;">${html(it.name)}</div>
		${it.money ? `<div style="position:absolute; right:3px; bottom:1px; font-size:10px; font-weight:bold; color:#f8e8a8; text-shadow:0 0 2px #000;">${dollars(item.count)}</div>`
			: item.count > 1 ? `<div style="position:absolute; right:3px; bottom:1px; font-size:11px; font-weight:bold; text-shadow:0 0 2px #000;">${item.count}</div>` : ''}</div>`;
}
function slotBox(key, name, item, w = SLOT, h = SLOT) {
	return `<div class="slot" data-slot="${key}" style="position:relative; width:${w}px; height:${h}px; border:1px dashed rgba(200,180,140,0.35); border-radius:4px; background:rgba(0,0,0,0.25);">
		${item ? thing(item, w, h, key) : `<div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; text-align:center; font-size:10px; color:rgba(220,200,170,0.45); padding:4px;">${html(name)}</div>`}</div>`;
}
function gridBox(id, grid, items, src) {
	let cells = '';
	for (const item of items) {
		const [w, h] = sizeOf(item);
		cells += `<div style="position:absolute; left:${item.x * CELL}px; top:${item.y * CELL}px; width:${w * CELL}px; height:${h * CELL}px;">${thing(item, w * CELL, h * CELL, src)}</div>`;
	}
	return `<div class="grid" data-grid="${id}" style="position:relative; width:${grid[0] * CELL}px; height:${grid[1] * CELL}px; background-image: linear-gradient(rgba(200,180,140,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(200,180,140,0.18) 1px, transparent 1px); background-size:${CELL}px ${CELL}px; border:1px solid rgba(200,180,140,0.35); background-color: rgba(0,0,0,0.3);">${cells}</div>`;
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
		<div style="display:flex; align-items:center; gap:10px; margin-top:10px;"><span style="font-size:11px; letter-spacing:0.18em; color:#b8a888;">POCKET</span>${gridBox('pocket', ITEMS.pocket.grid, I.pocket.contents, 'grid:pocket')}
		<span style="color:#cfc2a8;">${dollars(inventory.moneyCarried())} carried</span></div>`;
	const bar = (name, v, colour) => `<div style="display:flex; justify-content:space-between; margin-top:5px;"><span>${name}</span><span>${Math.round(v)}%</span></div>
		<div style="height:7px; background:rgba(255,255,255,0.12); border-radius:3px; overflow:hidden;"><div style="height:100%; width:${v}%; background:${colour};"></div></div>`;
	const tone = (v) => v < 50 ? '#8ab06a' : v < 80 ? '#d8b04a' : '#d0583e';
	const t = S.temperature;
	const status = bar('Hunger', S.hunger, tone(S.hunger)) + bar('Thirst', S.thirst, tone(S.thirst)) + bar('Wetness', S.wet * 100, S.wet < 0.3 ? '#6a9ac8' : S.wet < 0.7 ? '#4a7ab8' : '#2a5aa8') + bar('Tiredness', S.tired, tone(S.tired)) + bar('Stress', S.stress, tone(S.stress))
		+ `<div style="display:flex; justify-content:space-between; margin-top:5px;"><span>Temperature</span><span>${t < -50 ? 'Freezing' : t < -15 ? 'Cold' : t > 50 ? 'Overheating' : t > 15 ? 'Warm' : 'Comfortable'}</span></div>
		<div style="position:relative; height:7px; background:rgba(255,255,255,0.12); border-radius:3px; overflow:hidden;"><div style="position:absolute; left:${t < 0 ? 50 + t / 2 : 50}%; width:${Math.abs(t) / 2}%; height:100%; background:${t < 0 ? '#6aa0d0' : '#d07a4a'};"></div><div style="position:absolute; left:50%; width:1px; height:100%; background:#fff8;"></div></div>
		<div style="margin-top:8px; line-height:1.6; color:#cfc2a8;">Feels like <b>${S.feels.toFixed(0)}°C</b> (air ${survival.airTemperature().toFixed(0)}°C)<br>
		Clothes: warmth +${worn.warmth.toFixed(1)}°C · rain kept off ${Math.round(worn.waterproof * 100)}%<br>Sweat ${worn.sweat >= 0 ? 'let out' : 'held in'} ${Math.round(Math.abs(worn.sweat) * 100)}% · armour ${Math.round(worn.armour * 100)}%<br>
		<span style="color:${worn.load > worn.capacity ? '#f08a6a' : '#cfc2a8'};">Load ${worn.load.toFixed(1)} / ${worn.capacity.toFixed(0)} kg${worn.load > worn.capacity ? ' (slowed)' : ''}</span></div>`;
	let pack = '';
	const P = I.worn.backpack;
	if (P) {
		pack += panel(html(ITEMS[P.type].name).toUpperCase(), gridBox('pack', ITEMS[P.type].grid, P.contents, 'grid:pack'));
		let att = `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">${P.attached.map((p, k) => slotBox('attach:' + k, 'Pouch', p, 72, 56)).join('')}</div>`;
		P.attached.forEach((p, k) => { if (p) att += `<div style="margin:6px 0 2px; color:#b8a888;">${html(ITEMS[p.type].name)}</div>` + gridBox('attach' + k, ITEMS[p.type].grid, p.contents, 'grid:attach' + k); });
		pack += panel('BACKPACK ATTACHMENTS', att);
	} else pack += panel('BACKPACK', '<div style="color:rgba(220,200,170,0.5);">No backpack worn</div>');
	const E = I.worn.extra;
	if (E && ITEMS[E.type].grid) pack += panel(html(ITEMS[E.type].name).toUpperCase(), gridBox('extra', ITEMS[E.type].grid, E.contents, 'grid:extra'));
	let found = '';
	const C = ui.container && loot.containerById(ui.container);
	if (C) found = panel(html(loot.label(C)).toUpperCase(), C.items ? gridBox('loot', C.grid, C.items, 'loot') : '<div style="color:#b8a888;">Searching…</div>');
	if (ui.camp) {
		const h = camp.holder(ui.camp), said = camp.describe(ui.camp);
		if (!h) found = panel(ui.camp.kind == 'bags' ? 'SADDLEBAGS' : 'TENT', '<div style="color:#b8a888;">Opening…</div>');
		else found = panel(said.title, `<div style="display:grid; grid-template-columns: repeat(2, ${SLOT + 14}px); gap:8px;">${Object.keys(camp.slotsOf(ui.camp)).map((s) => `<div><div style="font-size:10px; color:#b8a888; margin-bottom:2px;">${html(camp.SLOT_NAMES[s])}</div>${slotBox('camp:' + s, camp.SLOT_NAMES[s], h.slots[s], SLOT + 14, SLOT)}</div>`).join('')}</div>
			<div style="margin-top:8px; color:#cfc2a8; line-height:1.5; max-width:180px;">${said.lines.map(html).join('<br>')}</div>`);
	}
	root.innerHTML = `<div style="display:flex; gap:16px; padding:24px; align-items:flex-start; min-width:max-content; margin:auto;">
		<div>${panel('GEAR', gear)}</div>
		<div style="width:250px;">${panel('EQUIPPED', hands)}${panel('CONDITION', status)}</div>
		<div>${pack}</div>
		${found ? `<div>${found}</div>` : ''}
		<div style="position:fixed; left:24px; bottom:12px; color:rgba(220,200,170,0.6);">Drag to move · R turns · drop off the screen to put it down · double click: in or out · right click: more · Tab, I or Esc to close</div>
	</div>`;
}

// OPEN AND SHUT
export function openInventory(containerId = null) {
	if (!inventory.survivalOn() || !hunting.hunterPlace().active) return;
	ui.open = true;
	ui.container = containerId;
	ui.camp = null;
	root.style.display = 'flex';
	hunting.input.menuOpen = true;
	if (document.pointerLockElement) document.exitPointerLock();
	render();
}
export function closeInventory() {
	if (!ui.open) return;
	ui.open = false;
	ui.container = null;
	ui.camp = null;
	ui.drag = null;
	closeMenu();
	tip.style.display = 'none';
	root.style.display = 'none';
	hunting.input.menuOpen = false;
	canvas.requestPointerLock?.()?.catch?.(() => {});
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
camp.onChange(() => render());
window.addEventListener('keydown', (e) => {
	if ((e.code == 'KeyI' || e.code == 'Tab') && inventory.survivalOn()) {
		if (e.code == 'Tab') e.preventDefault();		// (not round the page's controls)
		if (e.repeat) return;
		if (ui.open) closeInventory(); else if (document.pointerLockElement == canvas) openInventory();
	}
	else if (e.code == 'Escape' && ui.open) closeInventory();
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
	if (el.dataset.src == 'loot') loot.take(ui.container, item.uid);
	else if (el.dataset.src.startsWith('camp:')) camp.take(ui.camp, el.dataset.src.slice(5));
	else if (ui.camp && campSlotFor(item)) camp.put(ui.camp, campSlotFor(item), item);
	else if (ui.container) { const where = whereOf(el.dataset.src); inventory.remove(item); if (!loot.putInto(ui.container, item)) inventory.put(where, item, item.x, item.y, item.rot); }
	else quickEquip(item, el.dataset.src);
	render();
});

// RIGHT CLICK: what can be done with it
const menuBox = document.createElement('div');
menuBox.style.cssText = 'position: fixed; z-index: 24; display: none; background: rgba(28, 22, 16, 0.97); border: 1px solid #6a5a44; border-radius: 4px; font: 13px Georgia, serif; color: #efe4cc; min-width: 140px;';
document.body.appendChild(menuBox);
function closeMenu() { menuBox.style.display = 'none'; ui.menu = null; }
root.addEventListener('contextmenu', (e) => {
	e.preventDefault();
	const el = e.target.closest('.it');
	if (!el) { closeMenu(); return; }
	const src = el.dataset.src, item = find(src, Number(el.dataset.uid));
	if (!item) return;
	const it = ITEMS[item.type], acts = [];
	if (src == 'loot') acts.push(['Take', () => loot.take(ui.container, item.uid)]);
	else if (src.startsWith('camp:')) acts.push(['Take out', () => camp.take(ui.camp, src.slice(5))]);
	else {
		if (it.food) acts.push(['Eat', () => useItem(item, src)]);
		if (it.drink && !it.food) acts.push(['Drink', () => useItem(item, src)]);
		if (it.use == 'deploy') acts.push(['Deploy', () => useItem(item, src)]);
		if (it.use == 'pitch') acts.push(['Pitch tent', () => { if (camp.pitch(item)) closeInventory(); }]);
		if (ui.camp && campSlotFor(item)) acts.push([ui.camp.kind == 'tent' ? 'Into the tent' : 'Into the saddlebags', () => camp.put(ui.camp, campSlotFor(item), item)]);
		if (item.type == 'firewood') acts.push(['Build campfire', () => { const at = campfires.buildSpot(); if (!at) { help.toast('No room for a fire here'); return; } inventory.useOne(item); campfires.build(at); closeInventory(); help.toast('Campfire laid: light it with the lighter'); }]);
		if (item.type == 'venison') acts.push(['Cook on the fire', () => campfires.cook(item)]);
		const on = src.startsWith('worn') || src.startsWith('hand') || src.startsWith('attach');
		if (on) acts.push(['Take off', () => quickEquip(item, src)]);
		else if (typeof it.slot == 'string' || handSlots(item.type).length) acts.push([typeof it.slot == 'string' && it.slot != 'attachment' ? 'Wear' : 'Equip', () => quickEquip(item, src)]);
		if (ui.container) acts.push(['Into ' + loot.label(loot.containerById(ui.container)).toLowerCase(), () => { const where = whereOf(src); inventory.remove(item); if (!loot.putInto(ui.container, item)) inventory.put(where, item, item.x, item.y, item.rot); }]);
		if (item.count > 1) acts.push(['Split', () => { const half = Math.floor(item.count / 2); item.count -= half; const part = { ...structuredClone(item), uid: Math.floor(Math.random() * 1e12), count: half }; if (!inventory.give(part)) { item.count += half; help.toast('No room to split it'); } inventory.changed(); }]);
		acts.push(['Put down', () => dropOwn(item)]);
	}
	menuBox.innerHTML = acts.map(([name], k) => `<div data-k="${k}" style="padding:6px 12px; cursor:pointer;" onmouseover="this.style.background='rgba(200,160,100,0.25)'" onmouseout="this.style.background=''">${html(name)}</div>`).join('');
	menuBox.style.left = e.clientX + 'px';
	menuBox.style.top = e.clientY + 'px';
	menuBox.style.display = '';
	ui.menu = acts;
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
	if (kg > 0) lines.push(`${kg < 1 ? Math.round(kg * 1000) + ' g' : kg.toFixed(1) + ' kg'}${it.price ? ' · worth ' + dollars(it.price * 100) : ''}`);
	tip.innerHTML = `<b>${html(nameOf(item))}</b>${item.count > 1 && !it.money ? ` × ${item.count}` : ''}<div style="margin-top:4px; color:#cfc2a8; line-height:1.5;">${lines.map(html).join('<br>')}</div>`;
	tip.style.display = '';
	tip.style.left = (e.clientX + 14) + 'px';
	tip.style.top = (e.clientY + 14) + 'px';
}
