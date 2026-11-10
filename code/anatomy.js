import { ROUNDS } from './ballistics.js'

/*
	THE ANATOMY of the wild animals (deer.js, beasts.js, rabbits.js): what is inside each, where, and what a round going through it does.
	Every place here is in metres in the animal's own frame: y up from the ground under it, z forwards to its head, x across (+x its
	right). A deer's head and neck go down as it grazes (bent: as deerSpheres bends them).
		BODY		its hitbox (each animal's own file takes it from here): balls [x, y, z, radius, bent]. The body, the neck and the head,
					the legs: balls enough that a round cannot go between two of them through the animal (its model's outline, near enough)
		ORGANS		inside it: the brain, the spine (a few pieces of it, round sticks), the heart, the lungs (each its own), the liver and the
					guts (the stomach and the gut, one). Each but the spine an egg (a ball stretched along x, y and z)
	A ROUND THROUGH IT (woundOf): from where it went in (the hitbox's skin: ballistics.js stops it there) along the way it was going, through
	the body until it comes out of the other side (its exit), or until it has gone as far through as it can (PENETRATION: metres of animal,
	less for the spine's bone it went through), where it stays. Every organ on that way is hit.
	WHAT IT DOES (bleedOf): a brain or the spine hit, it drops where it stands. Otherwise each organ hit bleeds it at its own pace (LETHAL:
	seconds it lives with that one alone), as much more as the round is heavier (its damage, ballistics.js): the paces of all its wounds
	add up, and it runs until its blood is gone. Only meat hit (no organ), it bleeds too, but slowly (LETHAL.meat: minutes).
	THE PELT (peltQuality): how cleanly it was killed. Each hole in it takes off (a round's way out more than its way in, a big round on a
	small animal far more: SIZE, CALIBRE), each shot after the first, a gut shot (its contents through the meat and the hide), every second
	it took to die, and a round too light for the animal (NEED). Out of 100: its stars (QUALITY in items.js).
	THE RECORD of a dead one (recordOf): its wounds, how long it took, what killed it and its pelt, for the inspection (inspect.js). A joiner's
	shot is worked out again by the host, from only where it went in and the way it went (cleanWound)
*/

// how far a round goes through an animal (metres), before it stays in it. The spine's bone takes BONE more
const PENETRATION = { '7.62x54R': 1.25, '.303 British': 1.15, '.303 Vickers': 1.15, '.45-70': 1.5, '.45 Colt': 0.5, '7.63 Mauser': 0.45, '00 buck': 0.3,
	hatchet: 0.14, knife: 0.12, stone: 0.02, chop: 0.12, stab: 0.16 };
const BONE = 0.3;
const GAP = 0.08;			// metres between two of the body's balls that are still one body (two that only nearly meet)
// seconds an animal lives with only that organ hit, by a round of damage 1 (see WHAT IT DOES)
const LETHAL = { heart: 4, lungLeft: 12, lungRight: 12, liver: 35, guts: 90, meat: 240 };
export const ORGAN_NAMES = { brain: 'Brain', spine: 'Spine', heart: 'Heart', lungLeft: 'Left lung', lungRight: 'Right lung', liver: 'Liver', guts: 'Stomach and gut', meat: 'Meat only' };
const ORDER = ['brain', 'spine', 'heart', 'lungLeft', 'lungRight', 'liver', 'guts'];
// how big a round's holes are (its calibre, against a rifle's), how big each animal is against them (a rabbit's skin is small), and the
//		round each needs to go down cleanly (its damage, ballistics.js: a shot's pellets together)
const CALIBRE = { '7.62x54R': 1, '.303 British': 1, '.303 Vickers': 1, '.45-70': 1.6, '.45 Colt': 1.2, '7.63 Mauser': 0.8, '00 buck': 0.35, hatchet: 1.4, knife: 0.6, stone: 0.3, chop: 1.2, stab: 0.5 };
const SIZE = { rabbit: 4, wolf: 1.5, deer: 1, bear: 0.75, moose: 0.6 };
const NEED = { rabbit: 0.2, wolf: 0.5, deer: 0.75, bear: 1.1, moose: 1.1 };
export const KIND_NAMES = { deer: 'Deer', moose: 'Moose', bear: 'Bear', wolf: 'Wolf', rabbit: 'Rabbit' };

// THE ANIMALS (see the top)
const egg = (name, at, radii, bent = false) => ({ name, at, radii, bent });
const spine = (points, radius, bentFrom = Infinity) => points.slice(1).map((to, k) => ({ name: 'spine', from: points[k], to, radius, bent: k >= bentFrom }));
const lungs = (x, y, z, radii) => [egg('lungLeft', [-x, y, z], radii), egg('lungRight', [x, y, z], radii)];
export const ANATOMY = {
	deer: {
		// rump, middle, chest, neck, head (bent), front legs, hind legs (horde.js names these seven by their order), and the belly and the
		//		brisket between rump, middle and chest
		body: [[0, 0.97, -0.42, 0.2], [0, 0.98, 0, 0.21], [0, 1.0, 0.38, 0.2], [0, 1.25, 0.56, 0.1, true], [0, 1.47, 0.74, 0.11, true], [0, 0.45, 0.4, 0.14], [0, 0.45, -0.45, 0.14],
			[0, 0.98, -0.21, 0.17], [0, 0.98, 0.19, 0.17]],
		organs: [
			egg('brain', [0, 1.51, 0.71], [0.035, 0.03, 0.04], true),
			...spine([[0, 1.03, -0.62], [0, 1.07, -0.3], [0, 1.06, 0], [0, 1.08, 0.3], [0, 1.12, 0.47], [0, 1.29, 0.56], [0, 1.41, 0.62]], 0.03, 4),
			egg('heart', [0, 0.88, 0.4], [0.05, 0.065, 0.055]),
			...lungs(0.06, 1.0, 0.3, [0.065, 0.1, 0.14]),
			egg('liver', [0.03, 0.93, 0.1], [0.1, 0.07, 0.06]),
			egg('guts', [0, 0.93, -0.25], [0.13, 0.12, 0.24]),
		],
	},
	moose: {
		// rump, chest, head, legs, the belly between, the muzzle, the hump over the shoulders
		body: [[0, 1.45, -0.5, 0.42], [0, 1.5, 0.4, 0.45], [0, 1.95, 1.2, 0.26], [0, 0.6, 0, 0.4], [0, 1.4, -0.05, 0.42], [0, 1.88, 1.75, 0.15], [0, 1.72, 0.88, 0.3]],
		organs: [
			egg('brain', [0, 2.1, 1.34], [0.07, 0.06, 0.08]),
			...spine([[0, 1.55, -0.9], [0, 1.64, -0.5], [0, 1.7, -0.05], [0, 1.86, 0.42], [0, 1.9, 0.8], [0, 2.05, 1.2]], 0.06),
			egg('heart', [0, 1.22, 0.55], [0.1, 0.12, 0.11]),
			...lungs(0.12, 1.52, 0.42, [0.13, 0.22, 0.25]),
			egg('liver', [0.05, 1.42, 0.02], [0.18, 0.12, 0.12]),
			egg('guts', [0, 1.38, -0.5], [0.28, 0.26, 0.38]),
		],
	},
	bear: {
		// rump, chest, head, the snout
		body: [[0, 0.75, -0.45, 0.42], [0, 0.85, 0.2, 0.46], [0, 0.95, 0.85, 0.26], [0, 0.96, 1.22, 0.13]],
		organs: [
			egg('brain', [0, 1.06, 1.02], [0.06, 0.05, 0.07]),
			...spine([[0, 0.9, -0.75], [0, 0.98, -0.42], [0, 1.02, -0.05], [0, 1.08, 0.3], [0, 1.05, 0.6], [0, 1.0, 0.9]], 0.05),
			egg('heart', [0, 0.62, 0.36], [0.09, 0.1, 0.1]),
			...lungs(0.12, 0.86, 0.3, [0.12, 0.17, 0.2]),
			egg('liver', [0.04, 0.74, 0], [0.16, 0.1, 0.1]),
			egg('guts', [0, 0.66, -0.4], [0.26, 0.22, 0.3]),
		],
	},
	wolf: {
		// rump, middle, neck, the belly between, the head, the shoulders
		body: [[0, 0.55, -0.3, 0.18], [0, 0.6, 0.15, 0.2], [0, 0.72, 0.62, 0.14], [0, 0.58, -0.08, 0.17], [0, 0.86, 0.8, 0.1], [0, 0.64, 0.42, 0.17]],
		organs: [
			egg('brain', [0, 0.87, 0.73], [0.03, 0.028, 0.036]),
			...spine([[0, 0.65, -0.5], [0, 0.68, -0.25], [0, 0.7, 0.05], [0, 0.73, 0.3], [0, 0.75, 0.46], [0, 0.82, 0.64]], 0.022),
			egg('heart', [0, 0.5, 0.3], [0.04, 0.05, 0.05]),
			...lungs(0.045, 0.62, 0.25, [0.05, 0.08, 0.11]),
			egg('liver', [0.01, 0.56, 0.05], [0.07, 0.05, 0.05]),
			egg('guts', [0, 0.56, -0.22], [0.1, 0.09, 0.14]),
		],
	},
	rabbit: {
		body: [[0, 0.13, -0.03, 0.1], [0, 0.18, 0.13, 0.06]],
		organs: [
			egg('brain', [0, 0.185, 0.15], [0.015, 0.013, 0.018]),
			...spine([[0, 0.17, -0.11], [0, 0.18, 0], [0, 0.18, 0.08]], 0.009),
			egg('heart', [0, 0.1, 0.05], [0.014, 0.015, 0.016]),
			...lungs(0.016, 0.125, 0.04, [0.018, 0.025, 0.03]),
			egg('liver', [0, 0.11, -0.01], [0.03, 0.02, 0.02]),
			egg('guts', [0, 0.11, -0.07], [0.045, 0.042, 0.05]),
		],
	},
};

// a deer's head and neck as it holds them (headDown, 0 up to 1 grazing): a point of them bent down about the neck's foot, as deerSpheres does
export function bend(p, headDown) {
	if (!headDown) return p;
	const down = 1.25 * headDown, ry = p[1] - 1.08, rz = p[2] - 0.45;
	return [p[0], 1.08 + ry * Math.cos(down) - rz * Math.sin(down), 0.45 + ry * Math.sin(down) + rz * Math.cos(down)];
}

// an animal's frame (see the top): from the world (world units) into it (metres), and back. at: its foot, heading: which way it faces,
//		scale: world units a metre of it (a deer's size in it)
export function frameOf(at, heading, scale) {
	const c = Math.cos(heading), s = Math.sin(heading);
	return {
		toLocal: ([x, y, z]) => { const dx = (x - at[0]) / scale, dz = (z - at[2]) / scale; return [dx * c - dz * s, (y - at[1]) / scale, dx * s + dz * c]; },
		dirToLocal: ([x, y, z]) => { const L = Math.hypot(x, y, z) || 1; return [(x * c - z * s) / L, y / L, (x * s + z * c) / L]; },
		toWorld: ([x, y, z]) => [at[0] + (x * c + z * s) * scale, at[1] + y * scale, at[2] + (z * c - x * s) * scale],
	};
}

// where a line (from a along d, d of length 1) goes in and out of a ball: [t in, t out], or null
function throughBall(a, d, c, r) {
	const ox = a[0] - c[0], oy = a[1] - c[1], oz = a[2] - c[2];
	const b = ox * d[0] + oy * d[1] + oz * d[2], q = ox * ox + oy * oy + oz * oz - r * r, h = b * b - q;
	if (h < 0) return null;
	const s = Math.sqrt(h);
	return [-b - s, -b + s];
}
// and an egg: the line made into one through a ball of radius 1
function throughEgg(a, d, c, radii) {
	const A = [(a[0] - c[0]) / radii[0], (a[1] - c[1]) / radii[1], (a[2] - c[2]) / radii[2]], D = [d[0] / radii[0], d[1] / radii[1], d[2] / radii[2]];
	const L = Math.hypot(...D);
	const t = throughBall(A, [D[0] / L, D[1] / L, D[2] / L], [0, 0, 0], 1);
	return t && [t[0] / L, t[1] / L];
}
// and a stick (a round one, from p to q): the nearest the line comes to it, and where along the line that is. Hit if nearer than its radius
function throughStick(a, d, p, q, radius) {
	const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [a[0] - p[0], a[1] - p[1], a[2] - p[2]];
	const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2], ud = u[0] * d[0] + u[1] * d[1] + u[2] * d[2], uw = u[0] * w[0] + u[1] * w[1] + u[2] * w[2], dw = d[0] * w[0] + d[1] * w[1] + d[2] * w[2];
	const det = uu - ud * ud;
	let s = det > 1e-9 ? (uw - ud * dw) / det : 0;		// (along the stick, 0 to 1)
	s = Math.min(Math.max(s, 0), 1);
	const near = [p[0] + u[0] * s, p[1] + u[1] * s, p[2] + u[2] * s];
	const t = (near[0] - a[0]) * d[0] + (near[1] - a[1]) * d[1] + (near[2] - a[2]) * d[2];
	const x = [a[0] + d[0] * t - near[0], a[1] + d[1] * t - near[1], a[2] + d[2] * t - near[2]];
	return Math.hypot(...x) <= radius ? t : null;
}

/*
	A ROUND THROUGH IT (see the top). kind: which animal (ANATOMY), entry and dir: where it went in and the way it went (its frame, dir of
	length 1), round: ballistics.js's, headDown: a deer's. Returns the wound: { round, entry, dir, exit (or null: it stayed in), end (where it
	came out or stayed), organs: their names, in the order it went through them ('meat' if none), headDown }
*/
export function woundOf(kind, entry, dir, round, headDown = 0) {
	const A = ANATOMY[kind];
	const placed = (p, bent) => bent ? bend(p, headDown) : p;
	// how far through the body it goes before it is out of it: from the first ball on its way, the far side of every one it goes on into
	//		without leaving the body (GAP)
	const spans = A.body.map(([x, y, z, r, bent]) => throughBall(entry, dir, placed([x, y, z], bent), r)).filter((s) => s && s[1] > 0).sort((p, q) => p[0] - q[0]);
	let out = spans.length ? Math.max(spans[0][1], 0) : 0;
	for (const [t0, t1] of spans) if (t0 <= out + GAP) out = Math.max(out, t1);
	// the organs on that way, nearest first
	const met = [];
	for (const o of A.organs) {
		if (o.name == 'spine') {
			const t = throughStick(entry, dir, placed(o.from, o.bent), placed(o.to, o.bent), o.radius);
			if (t !== null && t >= -0.02 && t <= out) met.push({ name: 'spine', t: Math.max(t, 0) });
		} else {
			const t = throughEgg(entry, dir, placed(o.at, o.bent), o.radii);
			if (t && t[1] >= 0 && t[0] <= out) met.push({ name: o.name, t: Math.max(t[0], 0) });
		}
	}
	met.sort((p, q) => p.t - q.t);
	// as far as it can go: less again past the spine's bone
	let left = PENETRATION[round] ?? 0.4, stopped = null;
	const organs = [];
	for (const m of met) {
		if (m.t > left) { stopped = left; break; }
		if (!organs.includes(m.name)) organs.push(m.name);
		if (m.name == 'spine') left -= BONE;
		if (left <= m.t) { stopped = Math.max(m.t, 0.01); break; }
	}
	if (stopped === null && left < out) stopped = left;
	const at = (t) => [entry[0] + dir[0] * t, entry[1] + dir[1] * t, entry[2] + dir[2] * t];
	const exit = stopped === null ? at(out) : null;
	return { round, entry: entry.map(round3), dir: dir.map(round3), exit: exit && exit.map(round3), end: (exit ?? at(stopped)).map(round3), organs: organs.length ? organs : ['meat'], headDown: round3(headDown) };
}
const round3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(Math.max(Number(v) || 0, lo), hi);

// a round that has just hit an animal (ballistics.js's bullet, stopped where it went in): its wound. at, heading, scale: the animal's (see
//		frameOf), headDown: a deer's. Its shot: the pellets of a shell are one (who: whose machine fired it)
export function woundFrom(kind, bullet, at, heading, scale, headDown = 0, who = 'me') {
	const F = frameOf(at, heading, scale);
	const w = woundOf(kind, F.toLocal([bullet.x, bullet.y, bullet.z]), F.dirToLocal([bullet.vx, bullet.vy, bullet.vz]), bullet.round, headDown);
	w.metres = bullet.from ? Math.round(Math.hypot(bullet.x - bullet.from[0], bullet.y - bullet.from[1], bullet.z - bullet.from[2]) / scale) : null;
	w.shot = who + ':' + (bullet.shot ?? Math.random());
	return w;
}
// what's in a blow that is not a round's (a shell bursting near it, a wolf's teeth): its wound
export const otherWound = (what) => ({ round: what, entry: null, dir: null, exit: null, end: null, organs: ['meat'], other: what, shot: what + ':' + Math.random() });

// a joiner's wound (net.js), as it said it: worked out again from where it went in and the way, or null
export function cleanWound(raw, kind) {
	if (!raw || typeof raw != 'object' || !ANATOMY[kind]) return null;
	if (raw.other == 'blast' || raw.other == 'maul') return otherWound(raw.other);
	const v3 = (p) => Array.isArray(p) && p.length == 3 && p.every((v) => Number.isFinite(v)) ? p.map((v) => clamp(v, -5, 5)) : null;
	const entry = v3(raw.entry), d = v3(raw.dir), L = d && Math.hypot(...d);
	if (!entry || !L) return null;
	const w = woundOf(kind, entry, d.map((v) => v / L), ROUNDS[raw.round] ? raw.round : '7.62x54R', clamp(raw.headDown, 0, 1));
	w.metres = raw.metres == null ? null : Math.round(clamp(raw.metres, 0, 9999));
	w.shot = 'j' + String(raw.shot ?? Math.random()).slice(0, 32);
	return w;
}

// WHAT IT DOES (see the top): 0 (it drops at once), seconds until it dies of these wounds, or Infinity (none)
export function bleedOf(wounds) {
	let pace = 0;
	for (const w of wounds) {
		if (w.other) return 0;
		const power = Math.min(Math.max(ROUNDS[w.round]?.damage ?? 1, 0.2), 1.5);
		if (w.organs.includes('brain') || w.organs.includes('spine')) return 0;
		for (const name of w.organs) if (LETHAL[name]) pace += power / LETHAL[name];
	}
	return pace > 0 ? 1 / pace : Infinity;
}
// what killed it: the worst of its wounds' organs (or what else: a shell, a wolf)
export function causeOf(wounds) {
	const other = wounds.find((w) => w.other);
	if (other) return other.other;
	for (const name of ORDER) if (wounds.some((w) => w.organs.includes(name))) return name;
	return 'meat';
}
export const vital = (w) => w.organs.some((name) => name != 'meat');

// THE PELT (see the top): out of 100, and its stars (1 to 5, QUALITY in items.js). wounds with their shots, seconds: how long it took to die
export function peltQuality(kind, wounds, seconds = 0) {
	if (wounds.some((w) => w.other)) return { score: 10, stars: 1 };
	let score = 100;
	const shots = new Map();
	for (const w of wounds) {
		const big = (CALIBRE[w.round] ?? 1) * (SIZE[kind] ?? 1);
		score -= 2 + 4 * big + (w.exit ? 6 * big : 0);
		shots.set(w.shot, (shots.get(w.shot) ?? 0) + (ROUNDS[w.round]?.damage ?? 1));
	}
	if (wounds.some((w) => w.organs.includes('guts'))) score -= 12;
	score -= Math.max(shots.size - 1, 0) * 8;
	score -= Math.min(seconds * 0.5, 30);
	const heaviest = Math.max(0, ...shots.values()), need = NEED[kind] ?? 0.5;
	score -= Math.max(need - heaviest, 0) / need * 20;
	score = Math.max(Math.min(Math.round(score), 100), 0);
	return { score, stars: starsOf(score) };
}
export const starsOf = (score) => score >= 85 ? 5 : score >= 70 ? 4 : score >= 50 ? 3 : score >= 30 ? 2 : 1;
// a whole one (a rabbit in a snare): not a mark on it
export const WHOLE = { score: 100, stars: 5 };

// THE RECORD (see the top): kind, its wounds, seconds from the first to its death, and what more the inspection draws it with (more: a
//		deer's size and whether a buck)
export function recordOf(kind, wounds, seconds, more = {}) {
	const s = Math.max(Math.round(seconds * 10) / 10, 0);
	return { kind, wounds, seconds: s, cause: causeOf(wounds), quality: peltQuality(kind, wounds, s), ...more };
}
// the same, heard from the host (a joiner's inspection): made sane, or null
export function cleanRecord(raw) {
	if (!raw || typeof raw != 'object' || !ANATOMY[raw.kind]) return null;
	const v3 = (p) => Array.isArray(p) && p.length == 3 && p.every((v) => Number.isFinite(v)) ? p.map((v) => clamp(v, -5, 5)) : null;
	const wounds = (Array.isArray(raw.wounds) ? raw.wounds : []).slice(0, 40).map((w) => ({
		round: String(w?.round ?? '').slice(0, 24), entry: v3(w?.entry), dir: v3(w?.dir), exit: v3(w?.exit), end: v3(w?.end), headDown: clamp(w?.headDown, 0, 1),
		organs: (Array.isArray(w?.organs) ? w.organs : []).filter((n) => ORGAN_NAMES[n]).slice(0, 8), metres: w?.metres == null ? null : Math.round(clamp(w.metres, 0, 9999)),
		other: w?.other == 'blast' || w?.other == 'maul' ? w.other : undefined, shot: String(w?.shot ?? '').slice(0, 32),
	}));
	for (const w of wounds) if (!w.organs.length) w.organs = ['meat'];
	const q = raw.quality ?? {};
	return { kind: raw.kind, wounds, seconds: clamp(raw.seconds, 0, 1e5), cause: ORGAN_NAMES[raw.cause] || raw.cause == 'blast' || raw.cause == 'maul' ? raw.cause : causeOf(wounds),
		quality: { score: Math.round(clamp(q.score, 0, 100)), stars: Math.round(clamp(q.stars, 1, 5)) }, size: clamp(raw.size ?? 1, 0.5, 2), buck: !!raw.buck, snared: !!raw.snared };
}

// THE WAY IT CAME IN, said: from a wound's way through the animal (its frame: +x its right, +z to its head)
export function angleOf(dir) {
	if (!dir) return '';
	const across = Math.hypot(dir[0], dir[2]) || 1, f = dir[2] / across, side = dir[0] > 0 ? 'left' : 'right';
	let said = f > 0.94 ? 'From behind' : f < -0.94 ? 'Head on' : f > 0.34 ? `Quartering away, from its ${side}` : f < -0.34 ? `Quartering to, from its ${side}` : `Broadside, from its ${side}`;
	if (dir[1] < -0.5) said += ', from above';
	else if (dir[1] > 0.5) said += ', from below';
	return said;
}
