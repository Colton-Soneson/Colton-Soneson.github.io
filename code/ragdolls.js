import { device } from './deviceSelection.js'
import { settings } from './settings.js'
import * as terrain from './terrain.js'
import * as townFolk from './townFolk.js'
import * as outfits from './outfits.js'
import { floorAt } from './townFloor.js'
import { ragBuffer, RAG_MOST, RAG_PARTS, RAG_PART_FLOATS } from './ragBuffer.js'

/*
	THE RAGDOLLS: a person shot (an NPC, npcs.js; one of the townsfolk, townFolk.js) does not just tip over. Its body is a ragdoll: SIXTEEN
	POINTS (the pelvis, the chest, the neck, the head; each arm's shoulder, elbow and hand; each leg's hip, knee and foot), each moving on
	its own under gravity (Verlet: where it is and where it was), held together by LINKS (its bones, kept their length, and the braces
	that make the torso a box and hold the head on), kept from folding through itself (RANGES), and stopped by the ground (and floated by
	the sea). The dummy is drawn from them, each of its parts turned and set where its bones now are (vf_dummy.js: THE RAGDOLL).
	THE HIT ITSELF: the round's push, at the place it went in (pushed hardest at the points nearest it, a little all over).
	AND HOW IT TAKES IT (as the games with "active ragdolls" do: the body still tries to stand while it can): MUSCLES pull every point
	towards where it would be if the body were standing as it was, as hard as the body still can. How hard, and for how long, is the
	wound's (part: where it was hit):
		the head		nothing: down at once, limp
		the chest		knocked back a step, the knees going under it as the strength goes, over within a second
		the belly		doubled over it, folding forward and down, a little slower
		a leg			that leg gone from under it at once: down on to that side
		and a hand goes to the wound (CLUTCH), held there as long as there is strength in it
	ONE THAT LIVES (not killed, on its feet: a stagger): knocked about by the hit, the muscles weak at first and coming back, until it
	stands as it was again and goes back to what it was doing (drawn as itself again). On a horse, in a seat: no stagger, only the
	flash of the hit.
	A dead one lies where it falls until its person is gone (npcs.js: DOWN_SECONDS), or for CORPSE_SECONDS (the townsfolk), still once it
	has come to rest (asleep: no more working out). At most RAG_MOST at once: the oldest dead one goes for a new one.
	World units throughout, settings.forestUnitsPerMetre to the metre
*/
const CORPSE_SECONDS = 40;
const STEP = 1 / 60;
const ITERATIONS = 10;
const GRAVITY = 9.81;

// the points, as the dummy's mesh was made (metres: standing on y 0, facing +z, holding a rifle: the a arm parts 3 and 4, the b arm 5
//		and 6, the a leg 7 and 8, the b leg 9 and 10, as vf_dummy.js names them)
const REST = [
	[0, 0.95, 0], [0, 1.3, 0], [0, 1.55, 0], [0, 1.78, 0.01],
	[-0.22, 1.45, 0], [-0.2, 1.24, 0.24], [-0.03, 1.31, 0.5],
	[0.22, 1.45, 0], [0.22, 1.2, 0.1], [0.07, 1.29, 0.24],
	[0.1, 0.95, 0], [0.1, 0.5, 0], [0.1, 0.06, 0.03],
	[-0.1, 0.95, 0], [-0.1, 0.5, 0], [-0.1, 0.06, 0.03],
];
const N = REST.length;
const PELVIS = 0, CHEST = 1, NECK = 2, HEAD = 3, A_SH = 4, A_EL = 5, A_HA = 6, B_SH = 7, B_EL = 8, B_HA = 9, A_HIP = 10, A_KN = 11, A_FT = 12, B_HIP = 13, B_KN = 14, B_FT = 15;
const RADIUS = [0.13, 0.15, 0.07, 0.12, 0.06, 0.05, 0.05, 0.06, 0.05, 0.05, 0.08, 0.07, 0.06, 0.08, 0.07, 0.06];
const HEAVY = [0.4, 0.4, 0.8, 0.7, 0.8, 1, 1, 0.8, 1, 1, 0.6, 0.9, 1, 0.6, 0.9, 1];		// (how far each gives when a link pulls: the torso least)
const LINKS = [[PELVIS, CHEST], [CHEST, NECK], [NECK, HEAD], [CHEST, A_SH], [CHEST, B_SH], [A_SH, B_SH], [A_SH, A_EL], [A_EL, A_HA], [B_SH, B_EL], [B_EL, B_HA],
	[PELVIS, A_HIP], [PELVIS, B_HIP], [A_HIP, B_HIP], [A_HIP, A_KN], [A_KN, A_FT], [B_HIP, B_KN], [B_KN, B_FT],
	// (the braces: the torso a box, the neck set in the shoulders, the head held over the chest)
	[A_SH, A_HIP], [B_SH, B_HIP], [A_SH, B_HIP], [B_SH, A_HIP], [NECK, A_SH], [NECK, B_SH], [CHEST, A_HIP], [CHEST, B_HIP], [HEAD, CHEST]];
// [a, b, nearest, furthest] metres: a leg or an arm not folded flat, not stretched past straight; the head not down in the chest
const RANGES = [[A_HIP, A_FT, 0.3, 0.9], [B_HIP, B_FT, 0.3, 0.9], [A_SH, A_HA, 0.16, 0.6], [B_SH, B_HA, 0.16, 0.6], [HEAD, PELVIS, 0.62, 0.86],
	[A_KN, B_KN, 0.1, 1.0], [A_FT, B_FT, 0.1, 1.3], [A_HA, CHEST, 0.12, 0.8], [B_HA, CHEST, 0.12, 0.8]];
const REST_LENGTH = LINKS.map(([a, b]) => Math.hypot(...REST[a].map((v, i) => v - REST[b][i])));

// THE PARTS the dummy is drawn in (vf_dummy.js): each from a point (its joint), along to another (its bone), and turned about it as
//		its torso is (side: two points across it) or as it was the frame before (a limb: no twist from one frame to the next)
const PARTS = [
	{ at: PELVIS, to: CHEST, side: [B_HIP, A_HIP] }, { at: CHEST, to: NECK, side: [B_SH, A_SH] }, { at: NECK, to: HEAD, side: [B_SH, A_SH] },
	{ at: A_SH, to: A_EL }, { at: A_EL, to: A_HA }, { at: B_SH, to: B_EL }, { at: B_EL, to: B_HA },
	{ at: A_HIP, to: A_KN }, { at: A_KN, to: A_FT }, { at: B_HIP, to: B_KN }, { at: B_KN, to: B_FT },
	{ at: CHEST, to: NECK, side: [B_SH, A_SH] },		// (what it held: gone, folded into the chest)
];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const smooth = (a, b, v) => { const t = Math.min(Math.max((v - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
// a frame from a bone and a direction across it: its three axes
const frame = (along, across) => { const u = norm(along), s = norm(sub(across, u.map((v) => v * dot(across, u)))); return [u, s, cross(u, s)]; };
const REST_FRAMES = PARTS.map((part) => frame(sub(REST[part.to], REST[part.at]), part.side ? sub(REST[part.side[0]], REST[part.side[1]]) : [1, 0, 0]));

// turned as the dummy is turned (vf_dummy.js, npcs.js): about x, y and z
const turnX = ([x, y, z], a) => [x, y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)];
const turnY = ([x, y, z], a) => [x * Math.cos(a) + z * Math.sin(a), y, z * Math.cos(a) - x * Math.sin(a)];
const turnZ = ([x, y, z], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a), z];
const metre = () => settings.forestUnitsPerMetre;

// the points of a body standing (or sat) as it is drawn: armsDown, its arms at its sides (else holding something out in front); sit
function posedPoints(place, armsDown, sit, lower = 0, hunch = 0) {
	const m = metre(), out = [];
	for (let k = 0; k < N; k++) {
		let p = [...REST[k]];
		if (armsDown) {
			if (k == A_EL) p = [-0.24, 1.2, 0.02]; else if (k == A_HA) p = [-0.25, 0.95, 0.06];
			if (k == B_EL) p = [0.24, 1.2, 0.02]; else if (k == B_HA) p = [0.25, 0.95, 0.06];
		}
		if (sit > 0.5) {
			if (k == A_KN || k == B_KN) p = [p[0], 0.95, 0.45];
			if (k == A_FT || k == B_FT) p = [p[0], 0.5, 0.5];
			p[1] -= 0.9;
		}
		// (doubled over: everything over the hips folded forward about them)
		if (hunch && p[1] > 0.95) { const q = turnX([p[0], p[1] - 0.95, p[2]], hunch); p = [q[0], q[1] + 0.95, q[2]]; }
		p[1] -= lower;
		const w = turnY(turnX(turnZ(p, place.tilt?.[1] ?? 0), place.tilt?.[0] ?? 0), place.heading ?? 0);
		out.push([place.x + w[0] * m, place.y + w[1] * m, place.z + w[2] * m]);
	}
	return out;
}

// THE GROUND under a ragdoll: the land (and a town's streets and stairs) at its pelvis, and its slope, looked at now and then
function groundOf(rag) {
	const p = rag.p, x = p[PELVIS * 3], z = p[PELVIS * 3 + 2], land = terrain.land;
	if (!land) return;
	let y = land.groundAt(x, z);
	const floor = floorAt(x, z, y + 3 * metre());
	if (Number.isFinite(floor) && floor > y) y = floor;
	const n = land.normalAt?.(x, z) ?? [0, 1, 0];
	rag.ground = { x, z, y, n };
}
const groundY = (rag, x, z) => { const g = rag.ground; return g ? g.y - (g.n[0] * (x - g.x) + g.n[2] * (z - g.z)) / Math.max(g.n[1], 0.3) : -Infinity; };

const rags = [];
export const ragStats = { active: 0, asleep: 0, steps: 0 };
const places = new WeakMap();		// a person -> where it was last seen, and when (its velocity, for the ragdoll it becomes)
// told where a person is drawn each frame (npcs.js): so a ragdoll made of it goes on at the speed it was going
export function trackPlace(person, place) {
	const now = performance.now() / 1000, was = places.get(person);
	const v = was && now > was.t ? [(place.x - was.x) / (now - was.t), (place.y - was.y) / (now - was.t), (place.z - was.z) / (now - was.t)] : [0, 0, 0];
	places.set(person, { x: place.x, y: place.y, z: place.z, t: now, v: Math.hypot(...v) < 80 * metre() ? v : [0, 0, 0] });
}

/*
	A HIT on a person: person (its object, npcs.js's or townFolk.js's), place ({ x, y, z, heading, tilt, sit } as it is drawn), look
	({ hat, hue, outfit, side }: drawn so), hit ({ at: [x, y, z] where the round went in, dir: [x, y, z] the way it was going, part:
	'head', 'chest', 'belly' or 'leg', power: how hard, 1 a rifle's }, or null: down without a known hit), killed, armsDown
*/
export function ragHit(person, place, look, hit, killed, armsDown = true) {
	if (!place || settings.enableRagdolls === false) return null;
	let rag = rags.find((r) => r.owner === person);
	if (!rag) {
		// (a stagger only on its feet)
		if (!killed && (place.sit ?? 0) > 0.05) return null;
		if (rags.length >= RAG_MOST) {
			const oldest = rags.filter((r) => r.dead).sort((a, b) => b.age - a.age)[0];
			if (!oldest) return null;
			drop(oldest);
		}
		const pts = posedPoints(place, armsDown, place.sit ?? 0);
		const v = places.get(person)?.v ?? [0, 0, 0];
		const p = new Float32Array(N * 3), q = new Float32Array(N * 3);
		pts.forEach((w, k) => { for (let i = 0; i < 3; i++) { p[k * 3 + i] = w[i]; q[k * 3 + i] = w[i] - v[i] * STEP; } });
		rag = { pt: pointOf, owner: person, look, p, q, age: 0, dead: false, life: 0, part: null, strength: 0, limp: new Float32Array(N).fill(1), clutch: null,
			anchor: { x: place.x, y: place.y, z: place.z, heading: place.heading ?? 0, tilt: place.tilt }, armsDown, sit: place.sit ?? 0, stumble: [0, 0],
			frames: PARTS.map((part) => part.side ? null : frame(sub(pts[part.to], pts[part.at]), turnY([1, 0, 0], place.heading ?? 0))), still: 0, asleep: false, slot: -1, accum: 0 };
		rags.push(rag);
		person.rag = rag;
		groundOf(rag);
	}
	rag.look = look ?? rag.look;
	rag.asleep = false; rag.still = 0;
	const m = metre();
	if (hit) {
		// THE HIT ITSELF: a push at the points near where it went in, and a little all over
		const power = Math.min(Math.max(hit.power ?? 1, 0.4), 2.5), dir = norm(hit.dir), at = hit.at;
		const dv = (k, speed) => { for (let i = 0; i < 3; i++) rag.q[k * 3 + i] -= dir[i] * speed * m * STEP; };
		let nearest = 0, best = Infinity;
		for (let k = 0; k < N; k++) {
			const d = Math.hypot(rag.p[k * 3] - at[0], rag.p[k * 3 + 1] - at[1], rag.p[k * 3 + 2] - at[2]) / m;
			if (d < best) { best = d; nearest = k; }
			dv(k, power * (0.35 + 3.2 * Math.exp(-((d / 0.25) ** 2))));
		}
		// a hand to the wound (CLUTCH): the other side's to the chest or the belly, the near one to a leg; held between the two points
		//		nearest where it went in, where along between them it was
		if (hit.part != 'head') {
			const side = dot(sub(at, [rag.p[PELVIS * 3], 0, rag.p[PELVIS * 3 + 2]]), sub(rag.pt(B_SH), rag.pt(A_SH)));
			const hand = hit.part == 'leg' ? (side > 0 ? B_HA : A_HA) : (side > 0 ? A_HA : B_HA);
			const second = [...Array(N).keys()].filter((k) => k != nearest && k != hand && k != A_EL && k != B_EL && k != A_HA && k != B_HA)
				.sort((a, b) => Math.hypot(...sub(rag.pt(a), at)) - Math.hypot(...sub(rag.pt(b), at)))[0];
			const a = rag.pt(nearest), b = rag.pt(second), ab = sub(b, a);
			rag.clutch = { hand, a: nearest, b: second, t: Math.min(Math.max(dot(sub(at, a), ab) / Math.max(dot(ab, ab), 1e-6), 0), 1) };
		}
		rag.part = hit.part;
		rag.stumble = [dir[0] * 0.35 * power * m, dir[2] * 0.35 * power * m];
	}
	if (killed) { rag.dead = true; rag.life = 0; rag.part = rag.part ?? hit?.part ?? null; }
	else { rag.life = 0; }
	// HOW IT TAKES IT: the leg hit gives under it
	rag.limp.fill(1);
	if (rag.part == 'leg' && hit) {
		const leg = Math.hypot(...sub(rag.pt(A_KN), hit.at)) < Math.hypot(...sub(rag.pt(B_KN), hit.at)) ? [A_KN, A_FT] : [B_KN, B_FT];
		for (const k of leg) rag.limp[k] = killed ? 0 : 0.35;
	}
	return rag;
}
// (where a point of a ragdoll is)
function pointOf(k) { return [this.p[k * 3], this.p[k * 3 + 1], this.p[k * 3 + 2]]; }
function drop(rag) {
	const k = rags.indexOf(rag);
	if (k >= 0) rags.splice(k, 1);
	if (rag.owner && rag.owner.rag === rag) rag.owner.rag = null;
}
// a person come back (npcs.js: revive), or taken away: its ragdoll gone
export function ragForget(person) { const rag = rags.find((r) => r.owner === person); if (rag) drop(rag); }

// MUSCLES: how hard the body still pulls towards standing, by how long since the hit (THE HIT, HOW IT TAKES IT at the top)
function strengthOf(rag) {
	const t = rag.life;
	if (!rag.dead) return 0.3 + 0.7 * smooth(0.05, 0.6, t);
	switch (rag.part) {
		case 'head': return 0;
		case 'chest': return 0.55 * (1 - smooth(0.0, 0.9, t));
		case 'belly': return 0.65 * (1 - smooth(0.2, 1.3, t));
		case 'leg': return 0.6 * (1 - smooth(0.0, 1.1, t));
		default: return 0.3 * (1 - smooth(0.0, 0.6, t));
	}
}
// where the muscles pull each point to: standing as it was (a dead one: sagging down as its strength goes, a step back from the hit,
//		doubled over a belly wound); one that lives, where its person is now
function targetsOf(rag) {
	const live = !rag.dead && rag.owner?.place;
	const place = live ? rag.owner.place : rag.anchor;
	const t = rag.life, m = metre();
	if (live) return posedPoints({ ...place, sit: 0 }, rag.armsDown, 0, (rag.part == 'leg' ? 0.25 : 0.08) * (1 - smooth(0.3, 1.2, t)));
	const fall = smooth(0, rag.part == 'belly' ? 1.4 : 1.0, t);
	const go = smooth(0, 0.7, t);
	return posedPoints({ x: place.x + rag.stumble[0] * go, y: place.y, z: place.z + rag.stumble[1] * go, heading: place.heading, tilt: null }, rag.armsDown, 0,
		0.65 * fall, rag.part == 'belly' ? 0.9 * go : rag.part == 'chest' ? -0.25 * go : 0);
}

function stepRag(rag) {
	const p = rag.p, q = rag.q, m = metre();
	const g = GRAVITY * m * STEP * STEP;
	// moved on: as fast as it was going, less a little
	for (let k = 0; k < N; k++) {
		for (let i = 0; i < 3; i++) {
			const v = (p[k * 3 + i] - q[k * 3 + i]) * 0.993;
			q[k * 3 + i] = p[k * 3 + i];
			p[k * 3 + i] += v;
		}
		p[k * 3 + 1] -= g;
	}
	// MUSCLES (and the hand to the wound)
	const strength = strengthOf(rag);
	rag.strength = strength;
	if (strength > 0.001) {
		const targets = targetsOf(rag), pull = 1 - Math.exp(-STEP * 22 * strength);
		for (let k = 0; k < N; k++) for (let i = 0; i < 3; i++) p[k * 3 + i] += (targets[k][i] - p[k * 3 + i]) * pull * rag.limp[k];
	}
	const c = rag.clutch;
	if (c && (strength > 0.05 || !rag.dead)) {
		const a = rag.pt(c.a), b = rag.pt(c.b), w = [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * c.t), pull = 1 - Math.exp(-STEP * 30);
		for (let i = 0; i < 3; i++) p[c.hand * 3 + i] += (w[i] - p[c.hand * 3 + i]) * pull;
	}
	// THE BONES AND THE BRACES, and no folding through itself
	for (let it = 0; it < ITERATIONS; it++) {
		for (let l = 0; l < LINKS.length; l++) {
			const [a, b] = LINKS[l];
			satisfy(p, a, b, REST_LENGTH[l] * m, REST_LENGTH[l] * m);
		}
		for (const [a, b, lo, hi] of RANGES) satisfy(p, a, b, lo * m, hi * m);
	}
	// THE GROUND (a little friction on it), and THE SEA (it floats, slowly)
	const sea = settings.waterWorldPosY;
	for (let k = 0; k < N; k++) {
		const x = p[k * 3], z = p[k * 3 + 2], floor = groundY(rag, x, z) + RADIUS[k] * m;
		if (p[k * 3 + 1] < floor) {
			p[k * 3 + 1] = floor;
			q[k * 3 + 1] = Math.max(q[k * 3 + 1], floor - 0.02 * m);
			q[k * 3] += (p[k * 3] - q[k * 3]) * 0.35;
			q[k * 3 + 2] += (p[k * 3 + 2] - q[k * 3 + 2]) * 0.35;
		}
		if (p[k * 3 + 1] < sea && floor < sea) {
			p[k * 3 + 1] += GRAVITY * 1.15 * m * STEP * STEP * Math.min((sea - p[k * 3 + 1]) / (0.3 * m), 1);
			for (let i = 0; i < 3; i++) q[k * 3 + i] += (p[k * 3 + i] - q[k * 3 + i]) * 0.08;
		}
	}
}
function satisfy(p, a, b, lo, hi) {
	const dx = p[b * 3] - p[a * 3], dy = p[b * 3 + 1] - p[a * 3 + 1], dz = p[b * 3 + 2] - p[a * 3 + 2];
	const d = Math.hypot(dx, dy, dz) || 1e-6;
	const want = d < lo ? lo : d > hi ? hi : d;
	if (want == d) return;
	const wa = HEAVY[a], wb = HEAVY[b], s = (d - want) / d / (wa + wb);
	p[a * 3] += dx * s * wa; p[a * 3 + 1] += dy * s * wa; p[a * 3 + 2] += dz * s * wa;
	p[b * 3] -= dx * s * wb; p[b * 3 + 1] -= dy * s * wb; p[b * 3 + 2] -= dz * s * wb;
}

// THE PARTS' MATRICES, for the shader (ragBuffer.js)
const partData = new Float32Array(RAG_MOST * RAG_PARTS * RAG_PART_FLOATS);
function writeParts(rag, slot) {
	const m = metre();
	PARTS.forEach((part, k) => {
		const at = rag.pt(part.at), along = sub(rag.pt(part.to), at);
		let f;
		if (part.side) f = frame(along, sub(rag.pt(part.side[0]), rag.pt(part.side[1])));
		else { f = frame(along, rag.frames[k][1]); rag.frames[k] = f; }
		const r = REST_FRAMES[k], o = REST[part.at];
		// R = f (as columns) times r (as rows): from the mesh's frame to the frame now
		const o2 = (slot * RAG_PARTS + k) * RAG_PART_FLOATS;
		for (let i = 0; i < 3; i++) {
			const row = [0, 1, 2].map((j) => (f[0][i] * r[0][j] + f[1][i] * r[1][j] + f[2][i] * r[2][j]) * m);
			partData.set([row[0], row[1], row[2], at[i] - (row[0] * o[0] + row[1] * o[1] + row[2] * o[2])], o2 + i * 4);
		}
	});
}

// Per frame (npcs.js npcUpdate): every ragdoll moved on, its limbs written for the shader
//-------------------------------------------------
export function ragUpdate(elapsed) {
	ragStats.active = rags.length; ragStats.asleep = 0;
	for (const rag of [...rags]) {
		rag.age += elapsed;
		rag.life += elapsed;
		const owner = rag.owner;
		// gone: its person gone (npcs.js), come back to life, or a corpse long enough
		if ((owner && (owner.gone || !owner.place)) || (!owner && rag.age > CORPSE_SECONDS) || (rag.dead && owner && owner.alive)) { drop(rag); continue; }
		if (rag.asleep) { ragStats.asleep++; continue; }
		rag.accum += Math.min(elapsed, 0.1);
		if (Math.floor(rag.age * 10) != Math.floor((rag.age - elapsed) * 10)) groundOf(rag);
		let moved = 0;
		while (rag.accum >= STEP) {
			rag.accum -= STEP;
			stepRag(rag);
			ragStats.steps++;
			for (let k = 0; k < N * 3; k++) moved = Math.max(moved, Math.abs(rag.p[k] - rag.q[k]));
		}
		// one that lives, standing again as it was: itself again
		if (!rag.dead && rag.life > 0.7) {
			const t = targetsOf(rag);
			let off = 0;
			for (let k = 0; k < N; k++) off = Math.max(off, Math.hypot(...sub(rag.pt(k), t[k])));
			if (off < 0.07 * metre() || rag.life > 2.2) { drop(rag); continue; }
		}
		// at rest: asleep
		rag.still = moved < 0.0015 * metre() && rag.strength < 0.01 ? rag.still + elapsed : 0;
		if (rag.dead && rag.still > 1.0) rag.asleep = true;
	}
	rags.forEach((rag, slot) => { rag.slot = slot; writeParts(rag, slot); });
	if (rags.length) device.queue.writeBuffer(ragBuffer, 0, partData, 0, rags.length * RAG_PARTS * RAG_PART_FLOATS);
}

// drawn with the townsfolk, each in its own look, its parts the ragdoll's (vf_dummy.js: THE RAGDOLL)
townFolk.addFolkSource((each) => {
	for (const rag of rags) {
		const pelvis = rag.pt(PELVIS), look = rag.look ?? {};
		each({ x: pelvis[0], y: pelvis[1], z: pelvis[2], heading: 0, fallen: 0, hit: rag.owner?.hit ?? 0, hue: look.hue ?? 0, sit: 0, gun: 'none', armsDown: 1,
			hat: look.hat, side: look.side ?? 0, outfit: look.outfit, rag: rag.slot + 1 });
	}
});
export const ragsForTest = () => rags;

// the townsfolk (townFolk.js): staggered by a hit they live through, and a ragdoll when killed (one of its own, left lying: CORPSE_SECONDS)
const folkLook = (person) => ({ hat: person.profession.hat, hue: person.hue, outfit: outfits.npcOutfit(person.profession.name, person.index), side: 0 });
townFolk.folkRagHook.hit = (person) => { ragHit(person, person.place, folkLook(person), person.lastHit, false, true); };
townFolk.folkRagHook.death = (person) => {
	const rag = ragHit(person, person.place, folkLook(person), person.lastHit, true, true);
	person.lastHit = null;
	if (rag) { rag.owner = null; person.rag = null; }
};
