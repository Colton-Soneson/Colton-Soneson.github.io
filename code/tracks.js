import { settings } from './settings.js';

import * as hunting from './hunting.js'
import * as transformations from './transformations.js'
import * as atmosphere from './atmosphere.js'
import * as props from './props.js'
import * as deer from './deer.js'
import * as beasts from './beasts.js'
import * as rabbits from './rabbits.js'
import { highlightState } from './highlights.js'

/*
	THE TRACKS (as theHunter: Call of the Wild's): the animals within REACH of the player (deer.js, beasts.js, rabbits.js: trackList) leave
	FOOTPRINTS as they go, a hoof's or a paw's (KINDS: how far apart, the print's model and size), one foot then the other, turned the way
	the animal went; and one that bleeds leaves BLOOD, the more often the faster it bleeds (and a pool where it stands). Those further off
	leave none, so that there are never too many of them (MOST at the most).
	Each lasts an eighth of the world's day (LASTS: atmosphere.js, sunCycles), wearing out as it goes (smaller, fainter), and is gone.
	V HELD (highlights.js: the inspection): every track near (DRAW) glows, and over each is an arrow the way the animal went: there is no
	need to go to them. CLOSE to one (within CLOSE of the walker, the nearest), a card over it: a print's animal, whether male or female,
	about what it weighs, how fast it was going (and whether walking, trotting or running); blood's, how much blood the animal had left and
	how fast it was bleeding; each with an arrow the way it went, as the walker sees it.
	Each machine lays its own from the animals as it has them (a joiner's from the host's records: no blood on them, the wounds being
	the host's). Metres and seconds (places in world units)
*/
const REACH = 300;					// metres from the player the animals leave tracks within
const LASTS = 1 / 8;				// of a day
const DRAW = 140;					// metres they are drawn within
const CLOSE = 2.6;					// metres: the card over the nearest
const MOST = 2500;
// each kind's: metres between prints (one foot then the other), the model, how big it is drawn, how far apart its feet go side to side
const KINDS = {
	deer: { every: 0.75, model: 'hoofPrint', scale: 1, apart: 0.11 },
	moose: { every: 0.95, model: 'hoofPrint', scale: 1.8, apart: 0.16 },
	wolf: { every: 0.7, model: 'pawPrint', scale: 1.15, apart: 0.08 },
	bear: { every: 0.8, model: 'pawPrint', scale: 2.4, apart: 0.16 },
	rabbit: { every: 0.45, model: 'pawPrint', scale: 0.55, apart: 0.04 },
};
const BLOOD_EVERY = [6, 0.8];		// metres between drops bleeding slowly, and fast (a tenth of its blood a second, and more)
const GAITS = [[1.8, 'walking'], [4.5, 'trotting'], [Infinity, 'running']];	// metres a second up to which it is going so

const metre = () => settings.forestUnitsPerMetre;
const day = () => atmosphere.sunCycles;
const sources = [deer.trackList, beasts.trackList, rabbits.trackList];
let tracks = [];					// { blood, x, y, z, heading, at (day), kind, name, male, weight, speed (metres a second), left, rate, size }
const seen = new Map();				// an animal's id -> { x, z, walked, bled, side, speed, t }
export const trackStats = { tracks: 0, prints: 0, blood: 0, drawn: 0, card: null };

// LAID (see the top)
function lay(a) {
	const m = metre(), K = KINDS[a.kind] ?? KINDS.deer, now = performance.now() / 1000;
	let s = seen.get(a.id);
	if (!s) { seen.set(a.id, { x: a.x, z: a.z, walked: 0, bled: 0, side: 1, speed: 0, t: now, heading: 0 }); return; }
	const dt = Math.max(now - s.t, 1e-3), dx = a.x - s.x, dz = a.z - s.z, d = Math.hypot(dx, dz) / m;
	s.t = now;
	// (a jump: put somewhere else, a joiner's records late: nothing laid across it)
	if (d > 20) { Object.assign(s, { x: a.x, z: a.z, walked: 0 }); return; }
	s.speed += (d / dt - s.speed) * Math.min(dt * 3, 1);
	if (d > 1e-4) s.heading = Math.atan2(dx, dz);
	const every = K.every * a.size * (s.speed > 4.5 ? 1.8 : s.speed > 1.8 ? 1.3 : 1);
	s.walked += d;
	while (s.walked >= every) {
		s.walked -= every;
		// (between where it was and where it is: as far back as it has walked on since the print)
		const back = s.walked / Math.max(d, 1e-4), x = a.x - dx * Math.min(back, 1), z = a.z - dz * Math.min(back, 1);
		s.side = -s.side;
		const across = K.apart * a.size * s.side * m;
		add({ blood: false, x: x + Math.cos(s.heading) * across, y: a.y, z: z - Math.sin(s.heading) * across, heading: s.heading, kind: a.kind, name: a.name, male: a.male, weight: a.weight, speed: s.speed, size: K.scale * a.size, model: K.model });
		trackStats.prints++;
	}
	// blood: the faster it bleeds the closer the drops (and standing, a drop now and then where it stands: a pool)
	if (a.blood) {
		const fast = Math.min(a.blood.rate / 0.1, 1), spacing = BLOOD_EVERY[0] + (BLOOD_EVERY[1] - BLOOD_EVERY[0]) * fast;
		s.bled += d + dt * 0.4 * (0.3 + fast);
		if (s.bled >= spacing) {
			s.bled = 0;
			add({ blood: true, x: a.x + (Math.random() - 0.5) * 0.3 * m, y: a.y, z: a.z + (Math.random() - 0.5) * 0.3 * m, heading: s.heading, kind: a.kind, name: a.name, left: a.blood.left, rate: a.blood.rate, size: 0.8 + 0.6 * fast, model: 'bloodDrop' });
			trackStats.blood++;
		}
	}
	s.x = a.x; s.z = a.z;
}
function add(t) {
	t.at = day();
	t.turn = Math.random() * 0.3 - 0.15;
	tracks.push(t);
	if (tracks.length > MOST) tracks.splice(0, tracks.length - MOST);
}

// THE CARD (see the top): the nearest track within CLOSE, written over it
const card = document.createElement('div');
card.style.cssText = 'position: fixed; z-index: 6; pointer-events: none; display: none; transform: translate(-50%, -100%); padding: 6px 10px 7px; min-width: 132px; border-radius: 6px; background: rgba(18, 16, 12, 0.74); border: 1px solid rgba(240, 220, 170, 0.45); color: #f1e8d4; font: 12px Georgia, "Times New Roman", serif; line-height: 1.45; box-shadow: 0 2px 10px rgba(0,0,0,0.35);';
document.body.appendChild(card);
function screenOf(at) {
	const M = transformations.getViewProj();
	const w = M[3] * at[0] + M[7] * at[1] + M[11] * at[2] + M[15];
	if (w <= 0) return null;
	const x = (M[0] * at[0] + M[4] * at[1] + M[8] * at[2] + M[12]) / w, y = (M[1] * at[0] + M[5] * at[1] + M[9] * at[2] + M[13]) / w;
	return [(x * 0.5 + 0.5) * window.innerWidth, (0.5 - y * 0.5) * window.innerHeight];
}
const title = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const ARROW = (deg) => `<span style="display:inline-block; transform: rotate(${deg.toFixed(0)}deg); color:#f2c46d; font-size:15px; line-height:1;">&#x2191;</span>`;
function showCard(t, me) {
	if (!t) { card.style.display = 'none'; trackStats.card = null; return; }
	const m = metre(), up = 0.25 * m, at = [t.x, t.y + up, t.z];
	const s = screenOf(at), ahead = screenOf([t.x + Math.sin(t.heading) * m, t.y + up, t.z + Math.cos(t.heading) * m]);
	if (!s) { card.style.display = 'none'; return; }
	// (the arrow as the way it went looks from here: up the screen, away)
	const deg = ahead ? Math.atan2(ahead[0] - s[0], s[1] - ahead[1]) * 180 / Math.PI : 0;
	const age = (day() - t.at) / LASTS, fresh = age < 0.25 ? 'fresh' : age < 0.6 ? 'a while old' : 'old, wearing out';
	let html;
	if (t.blood) {
		html = `<div style="font-weight:bold; color:#e6a59a;">Blood · ${title(t.name)}</div>`
			+ `<div>Blood left: <b>${Math.round(t.left * 100)}%</b></div><div>Bleeding: <b>${(t.rate * 100).toFixed(1)}%</b> a second</div>`;
	} else {
		const gait = GAITS.find(([v]) => t.speed <= v)[1];
		html = `<div style="font-weight:bold;">${title(t.name)} · ${t.male ? 'male' : 'female'}</div>`
			+ `<div>About <b>${t.weight} kg</b></div><div>${title(gait)}: <b>${t.speed.toFixed(1)} m/s</b></div>`;
	}
	card.innerHTML = html + `<div style="display:flex; align-items:center; gap:6px; margin-top:2px; opacity:0.85;">${ARROW(deg)}<span>went this way · ${fresh}</span></div>`;
	card.style.left = s[0].toFixed(0) + 'px';
	card.style.top = (s[1] - 8).toFixed(0) + 'px';
	card.style.display = '';
	trackStats.card = { blood: t.blood, name: t.name, deg: Math.round(deg) };
}

// ONCE A FRAME (rotatingCube.js): the tracks laid, worn, drawn
export function tracksUpdate() {
	const me = hunting.hunterPlace(), m = metre();
	const now = day();
	tracks = tracks.filter((t) => now - t.at < LASTS && now >= t.at);
	trackStats.tracks = tracks.length;
	if (!me.active || !settings.enableTracks) { showCard(null); seen.clear(); return; }
	const reach = REACH * m, here = new Set();
	for (const list of sources) for (const a of list()) {
		if (Math.abs(a.x - me.x) > reach || Math.abs(a.z - me.z) > reach || Math.hypot(a.x - me.x, a.z - me.z) > reach) continue;
		here.add(a.id);
		lay(a);
	}
	for (const id of [...seen.keys()]) if (!here.has(id)) seen.delete(id);
	// drawn, worn by their age; with V held glowing, and an arrow over each the way it went
	const inspect = highlightState.held, draw = DRAW * m;
	let nearest = null, nearestD = CLOSE * m;
	trackStats.drawn = 0;
	for (const t of tracks) {
		const dx = t.x - settings.camPosX, dz = t.z - settings.camPosZ;
		if (Math.abs(dx) > draw || Math.abs(dz) > draw) continue;
		const age = (now - t.at) / LASTS, worn = 1 - 0.45 * age;
		const glow = inspect ? (t.blood ? [1.0, 0.15, 0.1, 0.9 * (1 - age * 0.6)] : [0.95, 0.8, 0.35, 0.8 * (1 - age * 0.6)]) : undefined;
		props.show(t.model, props.place([t.x, t.y, t.z], t.heading + t.turn, 0, 0, t.size * worn), glow);
		if (inspect) props.show('trackArrow', props.place([t.x, t.y + 0.04 * m, t.z], t.heading, 0, 0, t.blood ? 1.2 : 0.9 + 0.3 * t.size), [0.9, 0.75, 0.3, 0.4]);
		trackStats.drawn++;
		const d = Math.hypot(t.x - me.x, t.z - me.z);
		if (d < nearestD) { nearestD = d; nearest = t; }
	}
	showCard(nearest, me);
}
// for testing
export const tracksForTest = () => tracks.map((t) => ({ blood: t.blood, x: t.x, z: t.z, heading: t.heading, kind: t.kind, name: t.name, male: t.male, weight: t.weight, speed: t.speed, left: t.left, rate: t.rate, age: (day() - t.at) / LASTS }));
export function addForTest(t) { add({ y: 0, heading: 0, kind: 'deer', name: 'white-tailed deer', male: true, weight: 80, speed: 1.2, size: 1, model: t.blood ? 'bloodDrop' : 'hoofPrint', ...t }); }
