import { settings } from './settings.js';
import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as inventory from './inventory.js'
import * as boat from './boat.js'
import * as npcs from './npcs.js'
import * as npcRiders from './npcRiders.js'
import * as npcShips from './npcShips.js'
import * as shops from './shops.js'
import * as help from './controlsHelp.js'
import { owned, setOwnedValue } from './owned.js'

/*
	THE ENLISTED (the Survival mode's): the men the player has hired, and their FIRETEAMS.
		HORSEMEN	hired at any town's inn (HORSEMAN dollars a man, MOST of them), each on a horse of his own (npcRiders.js: addHired), with
					the player wherever they are on the land. Down, he is back in a while near them, out of sight
		THE SCHOONER	the player's own, with the crew hired for her (owned.js, npcShips.js: hireCrew), while she is out: one unit
	FIRETEAMS: TEAMS of them, each a number. A unit is in one or none. A team goes one way only, as its first unit does (by land: the
		horsemen; by water: the schooner): a unit that goes the other way is not let into it (the Enlisted page says so).
		ITS FORMATION (FORMATIONS, as in Mount & Blade): where each of its horsemen rides about its middle (its anchor), the way it faces.
		WHERE IT GOES: with no orders, after the player (its anchor SPACING.behind them, facing the way they look); the unassigned ride with
		them loose. Sent somewhere (order: from the map, survivalMap.js: a team picked, Space at the place), a land team's anchor goes there
		across country (npcRiders.js: landRouteBetween) at its PACE, facing the way it goes, and stands there; a water team's schooner sails
		there by sea (npcShips.js: orderHired). Recall: after the player again.
	LEFT BEHIND: a horseman far from his place (FAR) while the team is after the player is brought on to just behind them (the player went
		on by sea or by rail).
	Kept with what the player owns (owned.js: horsemen, teamOf, formations), so in the save file. Only where the people are run (alone, or
	the host: npcs.runsHere).
*/
export const TEAMS = 4;
export const MOST = 12;
export const HORSEMAN = 20;				// dollars
export const FORMATIONS = {
	line: { name: 'Line', about: 'abreast, two deep' },
	close: { name: 'Close order', about: 'a tight line, shoulder to shoulder' },
	loose: { name: 'Loose', about: 'a wide, open line' },
	column: { name: 'Column', about: 'two abreast, one behind another' },
	wedge: { name: 'Wedge', about: 'a point at the front, the rest back either side' },
	square: { name: 'Square', about: 'a block, as many deep as wide' },
	circle: { name: 'Circle', about: 'a ring about the middle, facing out' },
	scatter: { name: 'Scatter', about: 'spread out at random' },
};
const SPACING = { gap: 5, behind: 12 };	// metres between horsemen; and the middle of one after the player, behind them
const PACE = 3.2;						// metres a second a sent land team's anchor moves at
const FAR = 400;						// metres
const NAMES = ['Abner', 'Silas', 'Eli', 'Jed', 'Amos', 'Caleb', 'Wade', 'Gus', 'Hollis', 'Rufus', 'Virgil', 'Clem'];

const metre = () => settings.forestUnitsPerMetre;
const teams = Array.from({ length: TEAMS }, (_, k) => ({ number: k + 1, anchor: null, heading: 0, order: null }));	// order: { to: [x, z], route: [[x, z]...], at }
const loose = { number: 0, anchor: null, heading: 0, order: null };		// (the unassigned: after the player, loose)
const horsemen = [];				// { key, name, r (npcRiders.js's) }
export const fireStats = { horsemen: 0, orders: 0 };

// THE UNITS (see the top): { key, kind ('horseman', 'schooner'), mode ('land', 'water'), name }
const mySchooner = () => boat.boats.find((b) => b.exists && b.destroyed < 0 && boat.isMine(b) && b.vessel.name == 'Schooner') ?? null;
export function units() {
	const list = [];
	for (let k = 0; k < (owned.horsemen ?? 0); k++) list.push({ key: 'h' + k, kind: 'horseman', mode: 'land', name: NAMES[k % NAMES.length] });
	if (owned.schooner) list.push({ key: 'schooner', kind: 'schooner', mode: 'water', name: 'Your schooner' });
	return list;
}
export const teamOf = (key) => owned.teamOf?.[key] ?? 0;
export const formationOf = (n) => owned.formations?.[n - 1] ?? 'line';
// a team's way of going: as its units go ('land', 'water'), or null with none in it
export function modeOf(n) { return units().find((u) => teamOf(u.key) == n)?.mode ?? null; }
export function assign(key, n) {
	const u = units().find((one) => one.key === key);
	if (!u) return false;
	const mode = modeOf(n);
	if (n && mode && mode != u.mode && teamOf(key) != n) { help.toast(`Team ${n} goes by ${mode}: ${u.kind == 'schooner' ? 'she sails' : 'he rides'}`, 3); return false; }
	setOwnedValue('teamOf', { ...(owned.teamOf ?? {}), [key]: n });
	for (const t of teams) if (!modeOf(t.number)) { t.order = null; t.anchor = null; }		// (a team left with no one: its orders gone)
	return true;
}
export function setFormation(n, f) {
	if (!FORMATIONS[f]) return;
	const list = [...(owned.formations ?? [])];
	while (list.length < TEAMS) list.push('line');
	list[n - 1] = f;
	setOwnedValue('formations', list);
}

// HIRED (shops.js: at an inn)
export function hireHorseman(townThing) {
	if (!npcs.runsHere()) { help.toast('Your men ride only in a game you host', 3); return false; }
	if ((owned.horsemen ?? 0) >= MOST) { help.toast(`You have ${MOST} horsemen: as many as you can lead`); return false; }
	if (!inventory.pay(HORSEMAN * 100)) { help.toast('Not enough money'); return false; }
	setOwnedValue('horsemen', (owned.horsemen ?? 0) + 1);
	const inn = townThing ? npcRiders.innFor(townThing) : null;
	spawnFor(units().filter((u) => u.kind == 'horseman').pop(), inn);
	help.toast(`${NAMES[(owned.horsemen - 1) % NAMES.length]} rides with you (${owned.horsemen} of ${MOST}). The journal's Enlisted page puts him in a fireteam`, 4);
	return true;
}
shops.addOffers((tradeName, person) => {
	if (tradeName != 'innkeeper' || !inventory.survivalOn()) return [];
	const n = owned.horsemen ?? 0;
	return [n >= MOST
		? { id: 'horseman', icon: 'revolver', tint: '#6a4a2a', name: `Your horsemen: ${n} of ${MOST}`, detail: 'As many as you can lead. The journal\'s Enlisted page puts them in fireteams', price: null, label: null, act: null }
		: { id: 'horseman', icon: 'revolver', tint: '#6a4a2a', name: `Hire a horseman (${n} of ${MOST})`, detail: 'A man with his own horse and revolver: he rides with you and fights whoever is hostile to you. Put him in a fireteam on the journal\'s Enlisted page, and send it about from the map', price: HORSEMAN * 100, label: 'Hire', act: () => hireHorseman(person.town) }];
});

// WHERE THEY ARE (see the top)
// the player: where they are, and the way they face (radians, round from +z towards +x)
function me() {
	const p = hunting.hunterPlace();
	return { x: p.x, z: p.z, heading: Math.atan2(Math.sin(settings.camYaw), -Math.cos(settings.camYaw)), active: p.active };
}
const right = (h) => [-Math.cos(h), Math.sin(h)], ahead = (h) => [Math.sin(h), Math.cos(h)];
// a team's middle: sent somewhere, where its anchor is; otherwise behind the player
function anchorOf(t) {
	if (t.order && t.anchor) return t.anchor;
	const P = me(), f = ahead(P.heading), back = (t === loose ? 0.6 : 1) * SPACING.behind * metre();
	return { x: P.x - f[0] * back, z: P.z - f[1] * back };
}
const headingOf = (t) => t.order && t.anchor ? t.heading : me().heading;
// its place in the formation: x across (to the right), z forward of the middle, metres, for the k-th of n
export function slot(f, k, n) {
	const s = SPACING.gap;
	if (f == 'close' || f == 'line' || f == 'loose') {
		const g = f == 'close' ? 0.6 * s : f == 'loose' ? 1.9 * s : s, cols = Math.min(n, f == 'close' ? 6 : 8);
		return [((k % cols) - (Math.min(cols, n - Math.floor(k / cols) * cols) - 1) / 2) * g, -Math.floor(k / cols) * g];
	}
	if (f == 'column') return [((k % 2) - (n > 1 ? 0.5 : 0)) * s * 0.8, -Math.floor(k / 2) * s * 1.2];
	if (f == 'wedge') { const row = Math.ceil(k / 2), side = k % 2 ? 1 : -1; return [k ? side * row * s * 0.8 : 0, -row * s]; }
	if (f == 'square') { const w = Math.ceil(Math.sqrt(n)); return [((k % w) - (w - 1) / 2) * s, ((w - 1) / 2 - Math.floor(k / w)) * s]; }
	if (f == 'circle') { const r = Math.max(s * n / (2 * Math.PI), s * 0.8), a = k / n * Math.PI * 2; return [Math.sin(a) * r, Math.cos(a) * r]; }
	// scatter: the same place each time, at random about the middle
	const a = k * 2.39996, r = s * 1.4 * Math.sqrt(k + 0.5) * (0.75 + 0.5 * ((k * 0.618) % 1));
	return [Math.cos(a) * r, Math.sin(a) * r];
}
function placeOf(t, members, h) {
	const k = members.indexOf(h), n = members.length, A = anchorOf(t), head = headingOf(t), m = metre();
	const [x, z] = slot(t === loose ? 'loose' : formationOf(t.number), Math.max(k, 0), Math.max(n, 1)), R = right(head), F = ahead(head);
	return [A.x + (R[0] * x + F[0] * z) * m, A.z + (R[1] * x + F[1] * z) * m];
}
const teamFor = (h) => { const n = teamOf(h.key); return n && modeOf(n) == 'land' ? teams[n - 1] : loose; };
const membersOf = (t) => horsemen.filter((h) => teamFor(h) === t);
// where one comes back (down, or brought on): behind the player, off to a side, on dry land
function homeFor() {
	const P = me(), f = ahead(P.heading), m = metre(), dry = settings.waterWorldPosY + 0.5 * m;
	for (const out of [40, 30, 55, 20, 70]) for (const side of [0, 1, -1]) {
		const x = P.x - f[0] * out * m + f[1] * side * 15 * m, z = P.z - f[1] * out * m - f[0] * side * 15 * m;
		if (terrain.land && terrain.land.heightAt(x, z) > dry) return { x, z, heading: P.heading };
	}
	return { x: P.x, z: P.z, heading: P.heading };
}
function spawnFor(u, at = null) {
	if (!u || horsemen.some((h) => h.key === u.key)) return;
	const h = { key: u.key, name: u.name, r: null };
	const group = (horsemen[0]?.r?.person.group) ?? Object.assign(npcs.makeGroup(), { hired: true });
	const squad = {
		spot: () => placeOf(teamFor(h), membersOf(teamFor(h)), h),
		moving: () => { const t = teamFor(h); return t.order ? !!t.order.route && t.order.at < t.order.route.length : Math.hypot(hunting.hunterPlace().vx ?? 0, hunting.hunterPlace().vz ?? 0) > 0.3 * metre(); },
		pace: () => teamFor(h).order ? PACE : Math.max(Math.hypot(hunting.hunterPlace().vx ?? 0, hunting.hunterPlace().vz ?? 0) / metre(), 1.5),
		facing: () => headingOf(teamFor(h)),
		home: () => homeFor(),
	};
	h.r = npcRiders.addHired(group, at ?? homeFor(), squad, 'your horseman ' + u.name);
	horsemen.push(h);
}

// SENT SOMEWHERE (see the top): team n to (x, z) (world units). { ok, why, route }
export function order(n, x, z) {
	const mode = modeOf(n), t = teams[n - 1], m = metre();
	if (!mode) return { ok: false, why: `Team ${n} has no one in it` };
	fireStats.orders++;
	if (mode == 'water') {
		const b = mySchooner();
		if (!b) return { ok: false, why: 'Your schooner is not out: bring her out from T' };
		if (terrain.land.heightAt(x, z) > settings.waterWorldPosY - 2 * m) return { ok: false, why: 'She sails: send her to open water' };
		const route = npcShips.orderHired(b, x, z);
		if (!route) return { ok: false, why: 'No way there by sea' };
		return { ok: true, route };
	}
	if (terrain.land.heightAt(x, z) < settings.waterWorldPosY + 0.3 * m) return { ok: false, why: 'They ride: send them on to dry land' };
	const members = membersOf(t).filter((h) => h.r?.horse?.exists);
	if (!members.length) return { ok: false, why: `Team ${n}'s horsemen are not here yet` };
	const from = { x: members.reduce((s, h) => s + h.r.horse.x, 0) / members.length, z: members.reduce((s, h) => s + h.r.horse.z, 0) / members.length };
	const route = npcRiders.landRouteBetween([from.x, from.z], [x, z]) ?? [[x, z]];
	t.anchor = { ...from };
	t.heading = Math.atan2(route[0][0] - from.x, route[0][1] - from.z);
	t.order = { to: [x, z], route, at: 0 };
	return { ok: true, route };
}
export function recall(n) {
	const t = teams[n - 1];
	t.order = null; t.anchor = null;
	if (modeOf(n) == 'water') { const b = mySchooner(); if (b) npcShips.cancelHiredOrder(b); }
}

// THE MAP's (survivalMap.js): each team with anyone out, where it is (the middle of its horsemen, or its schooner), its way on (world units, or
//		null), and whether it is sent somewhere
export function mapTeams() {
	const out = [];
	for (const t of teams) {
		const mode = modeOf(t.number);
		if (mode == 'land') {
			const list = membersOf(t).filter((h) => h.r?.person.alive && h.r.horse?.exists);
			if (!list.length) continue;
			const x = list.reduce((s, h) => s + h.r.horse.x, 0) / list.length, z = list.reduce((s, h) => s + h.r.horse.z, 0) / list.length;
			const route = t.order ? [[t.anchor.x, t.anchor.z], ...t.order.route.slice(t.order.at)] : null;
			out.push({ number: t.number, mode, x, z, route, sent: !!t.order, men: list.length });
		} else if (mode == 'water') {
			const b = mySchooner();
			if (!b) continue;
			const at = b.frame.toWorld([0, 0, 0]), route = npcShips.hiredOrderOf(b);
			out.push({ number: t.number, mode, x: at[0], z: at[2], route: route?.length ? [[at[0], at[2]], ...route] : null, sent: !!route?.length, men: 1 });
		}
	}
	return out;
}

// ONCE A FRAME (rotatingCube.js)
let lastTime = performance.now();
export function fireteamsUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	const on = inventory.survivalOn() && npcs.on() && npcs.runsHere() && hunting.hunterPlace().active && !!terrain.land;
	if (!on) { for (const h of horsemen.splice(0)) if (h.r && npcRiders.hasRider(h.r)) npcRiders.removeHired(h.r); fireStats.horsemen = 0; return; }
	// (every horseman hired out with them; one the riders lost (cleared) put out again)
	const want = units().filter((u) => u.kind == 'horseman');
	for (const h of [...horsemen]) if (!want.some((u) => u.key === h.key) || !npcRiders.hasRider(h.r)) { if (npcRiders.hasRider(h.r)) npcRiders.removeHired(h.r); horsemen.splice(horsemen.indexOf(h), 1); }
	for (const u of want) spawnFor(u);
	fireStats.horsemen = horsemen.length;
	// a sent team's middle on along its way, facing the way it goes; there, it stands
	const m = metre();
	for (const t of teams) {
		if (!t.order) continue;
		if (modeOf(t.number) != 'land') { t.order = null; continue; }
		const R = t.order.route;
		if (t.order.at >= R.length) continue;
		const [tx, tz] = R[t.order.at], dx = tx - t.anchor.x, dz = tz - t.anchor.z, d = Math.hypot(dx, dz), step = PACE * m * dt;
		// (not on ahead of its horsemen: it waits for them)
		const list = membersOf(t).filter((h) => h.r?.person.alive && h.r.horse?.exists), behind = list.length ? Math.max(...list.map((h) => Math.hypot(h.r.horse.x - t.anchor.x, h.r.horse.z - t.anchor.z))) : 0;
		if (behind > 45 * m) continue;
		if (d > 0.01) t.heading = Math.atan2(dx, dz);
		if (d <= step) { t.anchor.x = tx; t.anchor.z = tz; t.order.at++; }
		else { t.anchor.x += dx / d * step; t.anchor.z += dz / d * step; }
	}
	// LEFT BEHIND (see the top)
	for (const h of horsemen) {
		const t = teamFor(h), r = h.r;
		if (t.order || !r?.person.alive || !r.horse?.exists) continue;
		const [x, z] = placeOf(t, membersOf(t), h);
		if (Math.hypot(r.horse.x - x, r.horse.z - z) > FAR * m) { const home = homeFor(); npcRiders.placeHired(r, home.x, home.z, home.heading); }
	}
}

// THE ENLISTED PAGE (inventoryUI.js: the journal's Enlisted tab): its writing, and a click on it (act: data-fire's value). Written by hand in
//		charcoal as the rest of the journal is: no buttons, the choices written out, the one taken ringed, one that cannot be struck out
const INK = '#2b2520', SOFT = 'rgba(43, 37, 32, 0.55)';
// (a choice: a word or a number written, ringed when it is the one, struck out when it cannot be)
const mark = (label, act, on, shut = null) => `<span ${shut ? `title="${shut}"` : `data-fire="${act}"`} style="display:inline-block; min-width:14px; padding:0 6px; margin:1px 1px; text-align:center; line-height:1.35; cursor:${shut ? 'default' : 'pointer'}; border:1.6px solid ${on ? INK : 'transparent'}; border-radius:52% 46% 55% 44% / 50% 55% 45% 52%; ${on ? 'font-weight:bold;' : ''} ${shut ? `color:${SOFT}; text-decoration:line-through; opacity:0.55;` : ''} filter:url(#charcoal);">${label}</span>`;
// (little charcoal sketches: a horse's head, a sail over a hull)
const SKETCH = 'fill="none" stroke="#2b2520" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
const HORSE = `<svg viewBox="0 0 20 18" width="20" height="18" style="vertical-align:-4px; margin-right:5px; filter:url(#charcoal);"><path ${SKETCH} d="M5 16 L6 9 Q6 4 11 3 L13 1 L13.5 3.5 Q17 5 17.5 9 L15.5 10 L13 8 L11 10 L10 16"/><path ${SKETCH} d="M8 5 Q6 7 6.5 10"/></svg>`;
const SAIL = `<svg viewBox="0 0 20 18" width="20" height="18" style="vertical-align:-4px; margin-right:5px; filter:url(#charcoal);"><path ${SKETCH} d="M10 1 L10 13 M10 2 L16 12 L10 12 M9 4 L4 12 L9 12 M2 14 Q10 18 18 14"/></svg>`;
export function journalHtml(html) {
	const list = units(), on = npcs.runsHere();
	const status = (n) => {
		const mode = modeOf(n), t = teams[n - 1];
		if (!mode) return 'no one in it';
		if (mode == 'water') return mySchooner() ? (npcShips.hiredOrderOf(mySchooner())?.length ? 'sailing where she was sent' : 'with you, or lying where she was sent') : 'laid up: bring her out from T';
		return t.order ? (t.order.at >= t.order.route.length ? 'holding where they were sent' : 'riding where they were sent') : 'riding with you';
	};
	const unitRow = (u) => {
		const n = teamOf(u.key);
		const choices = [0, ...teams.map((t) => t.number)].map((k) => {
			const mode = k ? modeOf(k) : null, shut = k && mode && mode != u.mode && n != k ? `Team ${k} goes by ${mode}` : null;
			return mark(k || '–', `assign:${u.key}:${k}`, k == n, shut);
		}).join('');
		return `<div style="display:flex; align-items:center; justify-content:space-between; gap:16px; padding:5px 0; border-bottom:1px solid rgba(43,37,32,0.18);"><span>${u.kind == 'schooner' ? SAIL : HORSE}${html(u.name)} <span style="font-size:11px; color:${SOFT};">by ${u.mode}</span></span><span style="white-space:nowrap;">${choices}</span></div>`;
	};
	const teamBox = (t) => {
		const mode = modeOf(t.number), f = formationOf(t.number), men = list.filter((u) => teamOf(u.key) == t.number);
		const forms = mode == 'water'
			? `<span style="font-size:12px; color:${SOFT};">One ship: no formation</span>`
			: Object.entries(FORMATIONS).map(([k, F]) => `<span title="${F.about}">${mark(F.name, `form:${t.number}:${k}`, k == f)}</span>`).join(' ');
		return `<div class="jr-box" style="padding:8px 12px; margin-bottom:12px; width:340px;">
			<div style="display:flex; justify-content:space-between; align-items:baseline; border-bottom:1.6px solid ${INK}; filter:url(#charcoal); padding-bottom:2px;"><b style="font-size:16px;">Team ${t.number}</b><span style="font-size:11px; color:${SOFT};">${mode ? 'by ' + mode + ' · ' : ''}${status(t.number)}</span></div>
			<div style="margin:6px 0 4px; font-size:13px;">${men.length ? men.map((u) => (u.kind == 'schooner' ? SAIL : HORSE) + html(u.name)).join(' &nbsp; ') : `<span style="color:${SOFT};">Put men in it on the left</span>`}</div>
			<div style="font-size:12px; margin-top:6px;">Formation:</div><div style="font-size:13px; line-height:1.7;">${forms}</div>
			${mode ? `<div style="margin-top:6px; font-size:13px;"><span data-fire="recall:${t.number}" style="text-decoration:underline; cursor:pointer;">recall them: with me</span></div>` : ''}
		</div>`;
	};
	const left = list.length
		? list.map(unitRow).join('')
		: `<div style="max-width:380px; line-height:1.55;">No one enlisted yet. Hire horsemen at a town's inn, and a crew for your schooner from a sea captain</div>`;
	return { left: `${on ? '' : `<div style="color:#7a2a18; font-weight:bold;">Your men ride only in a game you host</div>`}<div style="font-size:11px; color:${SOFT}; margin-bottom:6px; max-width:380px;">Which team: – none, or 1 to ${TEAMS}. A team goes one way only, by land or by water</div>${left}`,
		right: teams.map(teamBox).join(''),
		help: 'On the map (M): left click a team\'s square, then Space with the mouse where it is to go. Recall brings it back to you' };
}
export function act(value) {
	const [what, a, b] = value.split(':');
	if (what == 'assign') assign(a, Number(b));
	else if (what == 'form') setFormation(Number(a), b);
	else if (what == 'recall') recall(Number(a));
}
// for testing
export const fireteamsForTest = () => ({ teams: teams.map((t) => ({ number: t.number, mode: modeOf(t.number), order: t.order && { to: t.order.to, at: t.order.at, of: t.order.route.length }, anchor: t.anchor })), horsemen: horsemen.map((h) => ({ key: h.key, team: teamOf(h.key), x: h.r?.horse?.x, z: h.r?.horse?.z, alive: h.r?.person.alive })) });
