import { settings } from './settings.js';

import * as hunting from './hunting.js'
import * as players from './players.js'
import * as help from './controlsHelp.js'
import * as weapons from './weapons.js'
import * as atmosphere from './atmosphere.js'
import * as survivalNet from './survivalNet.js'
import * as hearing from './hearing.js'
import { ITEMS } from './items.js'
import * as inventory from './inventory.js'
import * as survival from './survival.js'

/*
	WHAT IS WRONG WITH THE WALKER, in the Survival mode. Its own to keep, on its own machine (saved with it: SAVED), as its needs are (survival.js). Shown as MOODLES, down the right of the
	screen (as Project Zomboid's), and in full on the inventory screen's first aid tab (inventoryUI.js: right click a limb, what can be done for it: actionsFor).

	THE LIMBS (head, torso, arms, legs) each have what has happened to them:
		cut			minor: off a wild animal, or walking without shoes or socks (BAREFOOT: on a leg). Heals by itself (CUT.heals), but CUT.roll days on it has its chance of having gone bad, by what was
					done for it: nothing 15%, bandaged or disinfected only 5%, both 0%
		laceration	major: only off wolves and bears, and blows and thrown blades from other players. Bleeds (BLEED) until it is bandaged. It wants disinfecting, sewing up and bandaging, and then heals
					(LACERATION.heals). Bandaged without being sewn, it will do for a while, but the bandage is ruined in LACERATION.ruins days (it bleeds again), with a chance (LACERATION.ruined) of infection.
		infected	gone bad: FEVER comes of it, FEVER_AFTER days on, unless antibiotics get there first
		broken		from a long fall (a leg) or a moose: wants a splint and a bandage both, and then it is mended. A broken leg cannot run or jump and goes at half pace; a broken arm shakes the aim.
	THE ILLNESSES, each with what it does (ILLNESS). Only a fever can kill:
		fever		from an infection. Health goes slowly down to FEVER.floor over FEVER.falls days, and stays there; FEVER.lasts days after that it kills. Cured by antibiotics and, after them, FEVER.sleep days' worth of sleep
		parasites	stomach pains, from raw wolf or bear meat (items.js: parasites). Health down to PARASITES.floor until cured: antibiotics, at once
		cough		from being cold and wet. Heard further off by everything (hearing.js), and shakes the aim as it comes
		headache	from thirst and tiredness. The eyes dark at the edges and the aim unsteady
		dizziness	from hunger, thirst, losing blood or a bad fall. The view sways, it cannot run
	The health is taken as any is (players.hurtSelf: in a game, off the host); while it is being held down the health does not come back (players.healthLimits).
	Times are days of the world's clock (atmosphere.js): the night slept away counts in full, and they go on from where they were if the clock is moved (saved, against SAVED).
*/
const SAVED = 'survivalBody';
const LIMBS = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];
export const LIMB_NAMES = { head: 'Head', torso: 'Torso', armL: 'Left arm', armR: 'Right arm', legL: 'Left leg', legR: 'Right leg' };
const CUT = { roll: 0.25, heals: 0.6 };
const INFECT = { none: 0.15, one: 0.05, both: 0 };
const LACERATION = { roll: 0.3, untreated: 0.4, unclean: 0.2, ruins: 0.3, ruined: 0.5, heals: 1.2 };
const BLEED = { a: 0.14, least: 15 };			// health a second, and it will not take it under that
const FEVER_AFTER = 0.2;
const FEVER = { falls: 1, floor: 20, lasts: 2, sleep: 1 };
const PARASITES = { floor: 40, fall: 0.25 };	// health a second
const BAREFOOT = 0.002;						// the chance of a cut, every metre walked with neither shoes nor socks
const FALL = { least: 22, most: 60 };			// the harm of a fall (hunting.js: FALLING) from which it can break a leg, and at which it certainly has
const COUGH = { lasts: 0.5 }, HEADACHE = { lasts: 0.15 }, DIZZY = { lasts: 0.12 };
// what each does: pace (the walk), tired and hunger (how fast they grow: stamina), sway (of the aim), blur and dark (of the eyes), noise (heard further off: hearing.js), noRun
export const ILLNESS = {
	fever: { name: 'Fever', pace: 0.82, tired: 1.5, sway: 0.25, blur: 0.9, dark: 0.12, tint: 'rgba(120, 40, 10, 0.1)', noise: 1.1, detail: 'Burning up. Health falls to 20%. Antibiotics, then a full day\'s worth of sleep, or it kills' },
	parasites: { name: 'Stomach pains', pace: 0.9, tired: 1.2, hunger: 1.6, noise: 1, detail: 'Parasites. Health falls to 40% until cured. Hungrier, weaker. Antibiotics cure it at once' },
	cough: { name: 'Cough', tired: 1.25, noise: 1.8, sway: 0.1, detail: 'Animals hear you from much further off, and it jolts your aim. Goes with warmth and time' },
	headache: { name: 'Headache', pace: 0.95, sway: 0.3, dark: 0.22, noise: 1, detail: 'Dark at the edges, an unsteady aim. Drink and rest' },
	dizzy: { name: 'Dizzy', pace: 0.85, sway: 0.75, blur: 0.5, noRun: true, noise: 1, detail: 'The view swims, and you cannot run. Eat, drink, stop the bleeding' },
};
const clock = () => atmosphere.sunCycles;
const fresh = () => ({ limbs: Object.fromEntries(LIMBS.map((k) => [k, { cut: null, laceration: null, infected: null, broken: null }])), fever: null, parasites: false, cough: 0, headache: 0, dizzy: 0 });
let body = fresh();
export const bodyNow = () => body;
export const medicalStats = { cuts: 0, lacerations: 0, infections: 0, fevers: 0, broken: 0, cured: 0, barefoot: 0 };
const on = () => inventory.survivalOn() && hunting.hunterPlace().active;

// WHAT HAPPENS TO IT
export function wound(kind, limb = LIMBS[Math.floor(Math.random() * LIMBS.length)]) {
	if (!inventory.survivalOn() || !hunting.hunterLife.alive) return;
	const L = body.limbs[limb];
	if (kind == 'cut' && !L.laceration && !L.cut) { L.cut = { at: clock(), clean: false, bandaged: false, rolled: false }; medicalStats.cuts++; help.toast(`A cut on your ${LIMB_NAMES[limb].toLowerCase()}: first aid in the inventory`, 3); }
	else if (kind == 'laceration' && !L.laceration) { L.cut = null; L.laceration = { at: clock(), clean: false, sewn: false, bandaged: 0, ruined: false, rolled: false }; medicalStats.lacerations++; help.toast(`Your ${LIMB_NAMES[limb].toLowerCase()} is laid open and bleeding: first aid in the inventory`, 3.5); }
	else if (kind == 'broken' && !L.broken) { L.broken = { splint: false, bandage: false }; medicalStats.broken++; help.toast(`Your ${LIMB_NAMES[limb].toLowerCase()} is broken: a splint and a bandage`, 3.5); }
	changed();
}
function infect(limb) {
	const L = body.limbs[limb];
	if (L.infected) return;
	L.infected = { at: clock() };
	medicalStats.infections++;
	help.toast(`Your ${LIMB_NAMES[limb].toLowerCase()} has gone bad: antibiotics, before a fever comes of it`, 3.5);
	changed();
}
function feverStarts() {
	if (body.fever) return;
	body.fever = { at: clock(), floorAt: null, dosed: false, slept: 0 };
	medicalStats.fevers++;
	help.toast('You have a fever. Antibiotics and a full day\'s sleep, or it will kill you', 4);
	changed();
}
// a wild animal's attack on the walker (beasts.js; told by the host if it is a joiner's): what it did, by the table of what it is
const MAULS = { moose: [['broken', 0.3], ['cut', 0.5]], wolf: [['laceration', 0.3], ['cut', 0.6]], bear: [['laceration', 0.65], ['cut', 0.3]] };
export function mauled(kind) {
	let r = Math.random();
	for (const [what, chance] of MAULS[kind] ?? []) {
		if (r < chance) { wound(what, what == 'broken' ? ['armL', 'armR', 'legL', 'legR', 'torso'][Math.floor(Math.random() * 5)] : undefined); break; }
		r -= chance;
	}
	weapons.actionSound('knock');
}
survivalNet.on('mauled', (m) => mauled(m.kind));
// a blow or a thrown blade from another player (net.js: applyHit): laid open, where it hit
const PART_LIMB = { head: ['head'], chest: ['torso', 'armL', 'armR'], belly: ['torso'], leg: ['legL', 'legR'] };
survivalNet.meleeHit.fn = (target, part) => {
	const limbs = PART_LIMB[part] ?? LIMBS, limb = limbs[Math.floor(Math.random() * limbs.length)];
	if (target === 'me') wound('laceration', limb);
	else survivalNet.sendTo(target, 'sliced', { limb });
};
survivalNet.on('sliced', (m) => { if (LIMBS.includes(m.limb)) wound('laceration', m.limb); });
// a long fall (hunting.js: onFall): a leg, likely by how far
function fell(harm) {
	if (harm >= FALL.least && Math.random() < Math.min((harm - FALL.least) / (FALL.most - FALL.least) + 0.25, 1)) wound('broken', Math.random() < 0.5 ? 'legL' : 'legR');
	if (harm >= FALL.least) body.dizzy = clock() + DIZZY.lasts;
}
hunting.onFall(fell);
// raw meat (items.js: parasites)
survival.onEaten((type) => {
	const chance = ITEMS[type]?.parasites ?? 0;
	if (chance > 0 && !body.parasites && Math.random() < chance) { body.parasites = true; help.toast('Your stomach turns: parasites. Antibiotics', 3.5); changed(); }
});
// asleep at the inn: eight hours of it, at a stroke (survival.js)
survival.onRoomSlept((hours) => { if (body.fever?.dosed) body.fever.slept += hours / 24; });

// WHAT CAN BE DONE FOR IT (inventoryUI.js: right clicking a limb): [{ label, act }]. Done with what is carried
const have = (type) => inventory.everything().find(({ item }) => item.type == type)?.item ?? null;
function usedUp(type, name) {
	const item = have(type);
	if (!item) { help.toast(`You have no ${name}`); return false; }
	inventory.useOne(item);
	return true;
}
export const anythingToDose = () => body.parasites || !!body.fever && !body.fever.dosed || LIMBS.some((k) => body.limbs[k].infected);
export function actionsFor(limb) {
	const L = body.limbs[limb], acts = [], W = L.laceration ?? L.cut, stock = (type) => (have(type) ? '' : ' (none carried)');
	const act = (label, type, name, fn) => acts.push({ label: label + stock(type), act: () => { if (usedUp(type, name)) { fn(); changed(); } } });
	if (W && !W.clean) act('Disinfect with alcohol', 'alcohol', 'alcohol tincture', () => { W.clean = true; help.toast('Disinfected'); });
	if (L.laceration && !L.laceration.sewn) act('Sew it up', 'sewingKit', 'sewing kit', () => { L.laceration.sewn = true; help.toast('Sewn up'); });
	if (L.cut && !L.cut.bandaged) act('Bandage it', 'bandage', 'bandage', () => { L.cut.bandaged = true; help.toast('Bandaged'); });
	if (L.laceration && (!L.laceration.bandaged || L.laceration.ruined)) act(L.laceration.ruined ? 'Change the ruined bandage' : 'Bandage it', 'bandage', 'bandage', () => { L.laceration.bandaged = clock(); L.laceration.ruined = false; help.toast('Bandaged'); });
	if (L.broken && !L.broken.splint) act('Set a splint', 'splint', 'splint', () => { L.broken.splint = true; mended(limb); });
	if (L.broken && !L.broken.bandage) act('Bandage the break', 'bandage', 'bandage', () => { L.broken.bandage = true; mended(limb); });
	if (anythingToDose()) act('Take antibiotics', 'antibiotics', 'antibiotics', dosed);
	if (!acts.length) acts.push({ label: 'Nothing to be done for it', act: () => {} });
	return acts;
}
function mended(limb) {
	const L = body.limbs[limb];
	if (L.broken?.splint && L.broken.bandage) { L.broken = null; help.toast(`Your ${LIMB_NAMES[limb].toLowerCase()} is set`); }
	else help.toast('It wants a splint and a bandage both');
}
function dosed() {
	let cured = false;
	for (const k of LIMBS) if (body.limbs[k].infected) { body.limbs[k].infected = null; if (body.limbs[k].laceration) body.limbs[k].laceration.rolled = true; cured = true; }
	if (body.parasites) { body.parasites = false; cured = true; help.toast('The parasites are gone'); }
	if (body.fever && !body.fever.dosed) { body.fever.dosed = true; help.toast('Antibiotics taken. Now sleep: a full day\'s worth, and the fever will break', 4); }
	else if (cured) help.toast('Antibiotics taken: the infection is gone');
	medicalStats.cured++;
}
const listeners = [];
export function onChange(fn) { listeners.push(fn); }
function changed() { for (const fn of listeners) fn(); saveSoon = 1; }

// each limb as the first aid screen says it: [what, colour]
export function conditionsOf(limb) {
	const L = body.limbs[limb], out = [];
	if (L.cut) out.push([`Cut${L.cut.clean ? ', disinfected' : ''}${L.cut.bandaged ? ', bandaged' : ''}`, '#d8b04a']);
	if (L.laceration) { const W = L.laceration; out.push([`Laceration${W.clean ? ', disinfected' : ''}${W.sewn ? ', sewn' : ''}${W.ruined ? ', bandage ruined' : W.bandaged ? ', bandaged' : ', bleeding'}`, '#e05a4a']); }
	if (L.infected) out.push(['Infected', '#b050c0']);
	if (L.broken) out.push([`Broken${L.broken.splint ? ', splinted' : ''}${L.broken.bandage ? ', bandaged' : ''}`, '#e08a3a']);
	return out;
}

// THE MOODLES: what is shown of it down the right of the screen
const box = document.createElement('div');
box.style.cssText = 'position: fixed; right: 16px; top: 96px; z-index: 5; pointer-events: none; display: none; font: 11px system-ui, sans-serif; color: #eee; width: 112px;';
document.body.appendChild(box);
const GLYPH = { fever: '🌡', parasites: '🦠', cough: '💨', headache: '🤕', dizzy: '💫', cut: '🩹', laceration: '🩸', infected: '☣', broken: '🦴' };
export function moodles() {
	const out = [], severity = (k) => k > 0.66 ? 3 : k > 0.33 ? 2 : 1;
	if (body.fever) out.push(['fever', ILLNESS.fever.name, body.fever.floorAt !== null ? 3 : severity((clock() - body.fever.at) / FEVER.falls)]);
	if (body.parasites) out.push(['parasites', ILLNESS.parasites.name, 2]);
	if (clock() < body.cough) out.push(['cough', ILLNESS.cough.name, 1]);
	if (clock() < body.headache) out.push(['headache', ILLNESS.headache.name, 1]);
	if (clock() < body.dizzy) out.push(['dizzy', ILLNESS.dizzy.name, 2]);
	const count = (test) => LIMBS.filter((k) => test(body.limbs[k])).length;
	if (count((L) => L.cut)) out.push(['cut', 'Cut', 1]);
	if (count((L) => L.laceration)) out.push(['laceration', 'Laceration', count((L) => L.laceration && !L.laceration.bandaged || L.laceration?.ruined) ? 3 : 2]);
	if (count((L) => L.infected)) out.push(['infected', 'Infected', 3]);
	if (count((L) => L.broken)) out.push(['broken', 'Broken bone', 2]);
	return out;
}
const TONE = ['', 'rgba(150, 120, 40, 0.8)', 'rgba(170, 80, 30, 0.85)', 'rgba(170, 30, 30, 0.9)'];
let shownAt = 0, shownHtml = '';
function drawMoodles(now) {
	if (now - shownAt < 200) return;
	shownAt = now;
	const html = moodles().map(([key, name, level]) => `<div style="display:flex; align-items:center; gap:6px; margin-bottom:4px; padding:3px 6px; border-radius:6px; background:${TONE[level]}; border:1px solid rgba(255,255,255,0.25);"><span style="font-size:15px; line-height:1;">${GLYPH[key]}</span><span>${name}</span></div>`).join('');
	if (html != shownHtml) { shownHtml = html; box.innerHTML = html; }
}

// ONCE A FRAME
let lastTime = performance.now(), wasAlive = true, owedHurt = 0, lastAt = null, coughIn = 8, thinkIn = 0, saveSoon = 0, offset = null;
export function medicalUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	const limits = players.healthLimits;
	if (!on()) { box.style.display = 'none'; limits.cap = 100; limits.noHeal = false; survival.resetModifiers(); hunting.effects.noRun = hunting.effects.noJump = false; hearing.setMine(1, 1); return; }
	// (the world's clock is not saved: what was saved is put back against it)
	if (offset === null) { offset = clock() - savedClock; shift(offset); }
	const life = players.localLife(), S = survival.status, p = hunting.hunterPlace(), today = clock();
	if (wasAlive && !life.alive) { body = fresh(); survival.resetModifiers(); hunting.effects.noRun = hunting.effects.noJump = false; changed(); }
	wasAlive = life.alive;
	if (!life.alive) { box.style.display = 'none'; return; }
	box.style.display = '';
	drawMoodles(now);
	let bleeding = false;
	for (const k of LIMBS) {
		const L = body.limbs[k];
		if (L.cut) {
			const C = L.cut;
			if (!C.rolled && today - C.at > CUT.roll) { C.rolled = true; if (Math.random() < (C.clean && C.bandaged ? INFECT.both : C.clean || C.bandaged ? INFECT.one : INFECT.none)) infect(k); }
			if (today - C.at > CUT.heals) { L.cut = null; changed(); }
		}
		if (L.laceration) {
			const W = L.laceration;
			if (!W.bandaged || W.ruined) bleeding = true;
			if (W.bandaged && !W.sewn && !W.ruined && today - W.bandaged > LACERATION.ruins) { W.ruined = true; help.toast('The bandage is ruined: it wants sewing up', 3); if (Math.random() < LACERATION.ruined) infect(k); changed(); }
			if (!W.rolled && today - W.at > LACERATION.roll) { W.rolled = true; if (Math.random() < (W.clean ? 0 : W.bandaged ? LACERATION.unclean : LACERATION.untreated)) infect(k); }
			if (W.clean && W.sewn && W.bandaged && !W.ruined && today - W.bandaged > LACERATION.heals) { L.laceration = null; help.toast(`Your ${LIMB_NAMES[k].toLowerCase()} has healed`); changed(); }
		}
		if (L.infected && !body.fever && today - L.infected.at > FEVER_AFTER) feverStarts();
	}
	// THE FEVER (see the top)
	let cap = 100;
	if (body.fever) {
		const F = body.fever, gone = Math.min((today - F.at) / FEVER.falls, 1);
		cap = 100 - (100 - FEVER.floor) * gone;
		if (gone >= 1 && F.floorAt === null) F.floorAt = today;
		if (F.dosed && S.asleep > 0 && lastAt !== null) F.slept += Math.max(today - lastAt, 0);
		if (F.dosed && F.slept >= FEVER.sleep) { body.fever = null; medicalStats.cured++; help.toast('The fever has broken', 3.5); changed(); }
		else if (F.floorAt !== null && today - F.floorAt >= FEVER.lasts) { players.hurtSelf(1000, 'Died of a fever'); body = fresh(); return; }
	}
	lastAt = today;
	if (body.parasites) cap = Math.min(cap, PARASITES.floor);
	// the health held down to it, a little at a time (never to nothing: only the fever, above, kills)
	if (life.health > cap + 0.5) owedHurt += (body.fever ? Math.max(life.health - cap, 0.3) * dt : PARASITES.fall * dt);
	if (bleeding && life.health > BLEED.least) owedHurt += BLEED.a * dt;
	if (owedHurt >= 1) { const whole = Math.floor(owedHurt); owedHurt -= whole; survival.sickHurt(whole); }
	limits.cap = cap;
	limits.noHeal = bleeding || cap < 100;
	// well: in a game (where nothing else mends it), its health comes back by degrees
	if (!limits.noHeal && life.health < 100 && survivalNet.role() != 'off') { healOwed += 0.4 * dt; if (healOwed >= 1) { players.healSelf(Math.floor(healOwed)); healOwed -= Math.floor(healOwed); } }
	// WHERE THE REST COME FROM (see the top), looked at every so often
	if ((thinkIn -= dt) <= 0) {
		thinkIn = 5;
		if (S.wet > 0.45 && S.temperature < -25 && Math.random() < 0.12) body.cough = today + COUGH.lasts;
		if ((S.thirst > 72 || S.tired > 78) && Math.random() < 0.25) body.headache = today + HEADACHE.lasts;
		if ((S.hunger > 85 || S.thirst > 85 || life.health < 35 || bleeding) && Math.random() < 0.2) body.dizzy = today + DIZZY.lasts;
		if (body.fever && Math.random() < 0.2) body.headache = Math.max(body.headache, today + HEADACHE.lasts);
	}
	// WITHOUT SHOES OR SOCKS (see the top): by the metre
	const moved = Math.hypot(p.vx ?? 0, p.vz ?? 0) / settings.forestUnitsPerMetre * dt, worn = inventory.inv.worn;
	if (p.on == 'land' && p.grounded && !p.swimming && moved > 0 && !worn.feetOuter && !worn.feetInner && Math.random() < BAREFOOT * moved) { medicalStats.barefoot++; wound('cut', Math.random() < 0.5 ? 'legL' : 'legR'); }

	// WHAT IT ALL DOES
	const M = survival.modifiers;
	survival.resetModifiers();
	const active = [body.fever && ILLNESS.fever, body.parasites && ILLNESS.parasites, today < body.cough && ILLNESS.cough, today < body.headache && ILLNESS.headache, today < body.dizzy && ILLNESS.dizzy].filter(Boolean);
	let sick = 1, noRun = false, noJump = false;
	for (const I of active) {
		M.pace *= I.pace ?? 1; M.tired *= I.tired ?? 1; M.hunger *= I.hunger ?? 1; M.sway = Math.max(M.sway, I.sway ?? 0); M.blur = Math.max(M.blur, I.blur ?? 0); M.dark = Math.max(M.dark, I.dark ?? 0);
		sick = Math.max(sick, I.noise ?? 1);
		if (I.noRun) noRun = true;
	}
	const legs = ['legL', 'legR'].filter((k) => body.limbs[k].broken).length, arms = ['armL', 'armR'].filter((k) => body.limbs[k].broken).length;
	if (legs) { M.pace *= legs == 2 ? 0.35 : 0.5; noRun = true; noJump = true; M.tired *= 1.3; }
	if (arms) M.sway = Math.max(M.sway, 0.45 * arms);
	hunting.effects.noRun = noRun;
	hunting.effects.noJump = noJump;
	// a fit of coughing now and then: the aim jolted
	if (today < body.cough && (coughIn -= dt) <= 0) { coughIn = 6 + Math.random() * 14; settings.camPitch += 0.02 + Math.random() * 0.02; weapons.actionSound('knock'); help.toast('*cough*', 0.7); }
	// heard: how it goes (hearing.js)
	const speed = Math.hypot(p.vx ?? 0, p.vz ?? 0) / settings.forestUnitsPerMetre, pace = speed < 0.2 ? 0.5 : speed > settings.huntingWalkSpeed * 1.3 ? 1.6 : 1;
	hearing.setMine(pace * (1 - 0.5 * hunting.crouch.amount) * sick, sick);
	if (saveSoon > 0 && (saveSoon -= dt) <= 0) save();
}
let healOwed = 0;
const SHIFTED = ['at', 'bandaged'];
function shift(by) {
	if (!by) return;
	for (const k of LIMBS) for (const W of [body.limbs[k].cut, body.limbs[k].laceration, body.limbs[k].infected]) if (W) for (const key of SHIFTED) if (typeof W[key] == 'number' && W[key]) W[key] += by;
	if (body.fever) { body.fever.at += by; if (body.fever.floorAt !== null) body.fever.floorAt += by; }
	for (const key of ['cough', 'headache', 'dizzy']) if (body[key]) body[key] += by;
}
let savedClock = 0;
function save() { try { localStorage.setItem(SAVED, JSON.stringify({ body, clock: clock() })); } catch (e) { /* */ } }
try { const raw = JSON.parse(localStorage.getItem(SAVED) ?? 'null'); if (raw?.body?.limbs) { body = { ...fresh(), ...raw.body }; savedClock = Number(raw.clock) || 0; } } catch (e) { /* (fresh) */ }
window.addEventListener('beforeunload', save);
// for testing
export const fallForTest = fell;
export const bodyForTest = () => ({ body, stats: medicalStats, moodles: moodles() });
export function setBodyForTest(fn) { fn(body); changed(); }
