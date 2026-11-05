import { settings } from './settings.js';
import { stepFor } from './rates.js'

import * as terrain from './terrain.js'
import * as ballistics from './ballistics.js'
import * as props from './props.js'
import * as atmosphere from './atmosphere.js'
import * as npcs from './npcs.js'
import * as deer from './deer.js'
import * as rabbits from './rabbits.js'
import * as hearing from './hearing.js'
import * as medical from './medical.js'
import * as survivalNet from './survivalNet.js'

/*
	THE WILD ANIMALS THAT FIGHT BACK. Each model under 450 triangles (creatureMeshes.js), walking by the rig in vf_props.js.
		MOOSE	solo, MOOSE_COUNT of them, each with a stretch of marsh round a pond of its own. A player within its AGGRO it goes for, until they are off its ground (LEASH from its home). A lot of health, hits hard, and can break bones
		WOLVES	PACKS of three to six, keeping to the woods and the mountains (ZONES). A pack hunts: the nearest rabbit or deer within SCENT, all of them after it, and only that one. Then all round it to eat (EAT seconds), and a while before the next
				(HUNT_AGAIN). A player within AGGRO it fights by PACK TACTICS: they spread out in a ring round the player (RING metres off, each to its own side), and one at a time (LUNGE seconds apart) goes in, bites and falls back. Half of them down, the rest run
		BEARS	rare, BEAR_COUNT, each living where the woods meet the mountains (a forest place within EDGE of the mountain zone). Territorial as a moose, high health and high damage
	Any of them a player shoots at comes for them, wherever. What a player is heard at (hearing.js: sick): further off with a cough, and it follows further.
	A DEAD ONE lies there (LIE seconds), and is cut up a cut at a time with a hatchet or a knife (survivalTools.js: CUTS). Another comes RESPAWN days later.
	HURT: as all NPCs' harm (npcs.hurtPlayer), and what it did to the limbs is the victim's to work out (medical.js: mauled; told by the host: mauled).
	MULTIPLAYER, as the deer (net.js: ANIMALS): they live on the host, which sends them as records (beastShare; own says which kind), and a joiner draws those (beastFollow). A joiner's shot says so to the host (beastShot), and its cuts are asked for.
	In metres and seconds (their places world units). Not in the Horde game mode, and only in the Survival mode do they go for the players (hearing.js: listeners).
*/
export const KINDS = {
	moose: { number: 1, model: 'moose', dead: 'moose', health: 420, walk: 1.2, run: 6.5, damage: 34, reach: 3.2, every: 2.2, aggro: 15, leash: 45, wander: 30, spheres: [[0, 1.45, -0.5, 0.42], [0, 1.5, 0.4, 0.45], [0, 1.95, 1.2, 0.26], [0, 0.6, 0, 0.4]], around: 2.2, cuts: ['mooseHide', 'sinew', 'bigBones', 'mooseMeat', 'sinew', 'mooseMeat', 'sinew', 'bigBones', 'mooseMeat', 'sinew', 'mooseMeat'], respawn: 1 },
	wolf: { number: 2, model: 'wolf', dead: 'wolf', health: 85, walk: 1.8, run: 8.2, damage: 13, reach: 1.9, every: 1.3, aggro: 28, leash: 110, wander: 140, spheres: [[0, 0.55, -0.3, 0.18], [0, 0.6, 0.15, 0.2], [0, 0.72, 0.62, 0.14]], around: 1, cuts: ['wolfMeat', 'smallBones', 'wolfMeat'], respawn: 1 },
	bear: { number: 3, model: 'bear', dead: 'bear', health: 400, walk: 1.1, run: 7, damage: 46, reach: 2.6, every: 2.0, aggro: 25, leash: 60, wander: 35, spheres: [[0, 0.75, -0.45, 0.42], [0, 0.85, 0.2, 0.46], [0, 0.95, 0.85, 0.26]], around: 1.6, cuts: ['bearHide', 'bigBones', 'bearMeat', 'bearMeat', 'bigBones', 'bearMeat'], respawn: 2 },
};
const NUMBER_KIND = Object.fromEntries(Object.entries(KINDS).map(([k, K]) => [K.number, k]));
const MOOSE_COUNT = 6, BEAR_COUNT = 3, PACKS = 3, PACK_SIZE = [3, 6];
const ZONES = () => [terrain.ZONE_FOREST, terrain.ZONE_MOUNTAIN, terrain.ZONE_SNOW];
const EDGE = 120;					// metres: from a forest place to the mountains, for a bear's home
const SCENT = 220;					// metres a pack smells what it hunts
const CATCH = 2;					// metres
const EAT = [30, 45];				// seconds
const HUNT_AGAIN = [60, 140];		// seconds
const RING = 11;					// metres off a player a pack holds
const LUNGE = 2.4;					// seconds between one going in and the next
const REST = [6, 18];				// seconds standing about
const HURT = 70;					// health off for a rifle round (ballistics.js: its damage times this)
const LIE = 8, LIE_SURVIVAL = 400;
const FALL = 0.8;					// seconds
const DRAW = 420;					// metres
const WOLF_SINEW = 0.4;

const metre = () => settings.forestUnitsPerMetre;
const hidden = () => settings.gameMode == 'Horde';
const clock = () => atmosphere.sunCycles;
export const beastStats = { moose: 0, wolf: 0, bear: 0, killed: 0, bites: 0, packKills: 0, corpses: 0 };
export const beastShot = { report: null };

let beasts = [], packs = [], corpses = [], respawns = [], builtFor = null, nextId = 1, now = 0;
let followed = null;			// joiner: the host's, as they are now

function make(kind, x, z, home, pack = null) {
	return { id: nextId++, kind, x, z, y: 0, home, pack, heading: Math.random() * 6.28, stride: Math.random() * 6.28, walking: 0, headDown: 0, health: KINDS[kind].health, state: 'rest', timer: Math.random() * 8, target: null, enemy: null, due: 0, slope: 0, ground: null, side: 0, biteAt: 0 };
}
const inZones = (x, z, zones) => zones.includes(terrain.land.zoneAt(x, z));
function nearMountains(x, z) {
	const m = metre();
	for (let a = 0; a < 8; a++) if (terrain.land.zoneAt(x + Math.cos(a * 0.785) * EDGE * m, z + Math.sin(a * 0.785) * EDGE * m) == terrain.ZONE_MOUNTAIN) return true;
	return false;
}
function spawnMoose(k, land = terrain.land) {
	const spots = land.findSpawnPoints(terrain.ZONE_MARSH, MOOSE_COUNT * 8, { seed: 91, minSpacing: 90, maxSlope: 0.4 }).filter((s) => deer.walkable(s.x, s.z));
	const s = spots[k % Math.max(spots.length, 1)];
	return s ? make('moose', s.x, s.z, [s.x, s.z]) : null;
}
function spawnBear(k, land = terrain.land) {
	const spots = land.findSpawnPoints(terrain.ZONE_FOREST, 400, { seed: 97, minSpacing: 40, maxSlope: 0.5 }).filter((s) => deer.walkable(s.x, s.z) && nearMountains(s.x, s.z));
	const s = spots[k * 37 % Math.max(spots.length, 1)];
	return s ? make('bear', s.x, s.z, [s.x, s.z]) : null;
}
function makePack(k, land = terrain.land, tile = 'land') {
	const spots = land.findSpawnPoints(terrain.ZONE_FOREST, 40, { seed: 103, minSpacing: 200, maxSlope: 0.5 }).filter((s) => deer.walkable(s.x, s.z));
	const s = spots[k * 11 % Math.max(spots.length, 1)];
	if (!s) return null;
	const P = { id: k, tile, home: [s.x, s.z], state: 'roam', target: null, prey: null, timer: 20 + Math.random() * 60, lunge: 0, enemy: null, size: PACK_SIZE[0] + Math.floor(Math.random() * (PACK_SIZE[1] - PACK_SIZE[0] + 1)) };
	packs.push(P);
	for (let n = 0; n < P.size; n++) { const w = make('wolf', s.x + (Math.random() - 0.5) * 12, s.z + (Math.random() - 0.5) * 12, P.home, P); w.side = (n / P.size) * Math.PI * 2; w.tile = tile; beasts.push(w); }
	return P;
}
// (in a world of tiles, terrain.js: each tile of land its own, made as it comes and gone with it)
terrain.onTiles((added, removed) => {
	if (builtFor !== terrain.land) return;
	if (removed.length) { beasts = beasts.filter((b) => !removed.includes(b.tile)); packs = packs.filter((P) => !removed.includes(P.tile)); respawns = respawns.filter((R) => !removed.includes(R.tile)); }
	const fresh = terrain.landsHere().filter(({ key }) => added.includes(key) && !beasts.some((b) => b.tile == key) && !packs.some((P) => P.tile == key));
	const made = builtFor;
	if (fresh.length) return (function* () { for (const { key, land } of fresh) for (const step of beastSteps(land, key)) { step(); yield; if (builtFor !== made) return; } })();
}, { later: true });
const landOf = (tile) => terrain.landsHere().find((one) => one.key == tile)?.land ?? terrain.land;
function build() {
	builtFor = terrain.land;
	beasts = []; packs = []; corpses = []; respawns = [];
	for (const { key, land } of terrain.landsHere()) beastsOf(land, key);
}
function beastsOf(land, tile) {
	for (const step of beastSteps(land, tile)) step();
}
// (a kind at a time: a tile's own beasts can come a kind a step, see the listener above)
const beastSteps = (land, tile) => [
	() => { for (let k = 0; k < MOOSE_COUNT; k++) { const b = spawnMoose(k, land); if (b) { b.number = k; b.tile = tile; beasts.push(b); } } },
	() => { for (let k = 0; k < BEAR_COUNT; k++) { const b = spawnBear(k, land); if (b) { b.number = k; b.tile = tile; beasts.push(b); } } },
	() => { for (let k = 0; k < PACKS; k++) makePack(k, land, tile); },
];

// a step towards a place, round water and cliffs: how far off it still is
function moveTo(b, to, pace, dt) {
	const m = metre(), dx = to[0] - b.x, dz = to[1] - b.z, far = Math.hypot(dx, dz);
	if (far < 0.2 * m) return far;
	const want = Math.atan2(dx, dz), look = 3 * m;
	let heading = want;
	// (and a wolf, unless it is fighting, round whatever is off its own ground)
	const own = b.kind == 'wolf' && b.pack?.state != 'fight', room = (x, z) => deer.walkable(x, z) && (!own || inZones(x, z, ZONES()));
	for (const turn of [0, 0.5, -0.5, 1, -1, 1.6, -1.6, 2.4, -2.4]) if (far < look || room(b.x + Math.sin(want + turn) * look, b.z + Math.cos(want + turn) * look)) { heading = want + turn; break; }
	let off = heading - b.heading;
	off -= Math.PI * 2 * Math.round(off / (Math.PI * 2));
	b.heading += off * Math.min(dt * 4, 1);
	const step = Math.min(pace * m * dt * (Math.abs(off) > 1.6 ? 0.5 : 1), far), toX = b.x + Math.sin(b.heading) * step, toZ = b.z + Math.cos(b.heading) * step;
	// (no further: on its own ground, it does not step off it. Off it already, it comes back)
	if (own && !inZones(toX, toZ, ZONES()) && inZones(b.x, b.z, ZONES())) { standing(b, dt); return far; }
	b.x = toX;
	b.z = toZ;
	b.stride += step / (1.5 * m) * Math.PI * 2;
	b.walking += (Math.min(pace / KINDS[b.kind].walk, 1.3) - b.walking) * Math.min(dt * 4, 1);
	return far - step;
}
// towards a player, as far as arm's length off them (no further: it does not stand in them): how far off it is
function closeOn(b, L, pace, stop, dt) {
	const far = Math.hypot(L.x - b.x, L.z - b.z);
	if (far > stop) return moveTo(b, [L.x + (b.x - L.x) / far * stop, L.z + (b.z - L.z) / far * stop], pace, dt) + stop;
	let off = Math.atan2(L.x - b.x, L.z - b.z) - b.heading;
	off -= Math.PI * 2 * Math.round(off / (Math.PI * 2));
	b.heading += off * Math.min(dt * 5, 1);
	standing(b, dt);
	return far;
}
function roamTarget(b, zones) {
	const m = metre(), K = KINDS[b.kind];
	for (let k = 0; k < 10; k++) {
		const a = Math.random() * 6.28, out = K.wander * m * Math.sqrt(Math.random()), x = b.home[0] + Math.cos(a) * out, z = b.home[1] + Math.sin(a) * out;
		if ((!zones || inZones(x, z, zones)) && deer.walkable(x, z)) return [x, z];
	}
	return [...b.home];
}
const standing = (b, dt) => { b.walking += (0 - b.walking) * Math.min(dt * 5, 1); };
function bite(b, L) {
	const K = KINDS[b.kind];
	b.due = now + K.every;
	b.biteAt = now;
	beastStats.bites++;
	npcs.hurtPlayer(L.id, K.damage, `Killed by a ${b.kind}`);
	if (L.id === 'me') medical.mauled(b.kind);
	else survivalNet.sendTo(L.id, 'mauled', { kind: b.kind });
}
const heardNow = (x, z, reach) => {
	let best = null, bestD = Infinity;
	for (const L of hearing.listeners()) { const d = Math.hypot(L.x - x, L.z - z); if (d < reach * L.sick && d < bestD) { bestD = d; best = L; } }
	return best;
};
const stillThere = (id) => id != null ? hearing.listeners().find((L) => L.id === id) ?? null : null;

// A LONE ONE (a moose, a bear: see the top)
function stepLone(b, dt) {
	const K = KINDS[b.kind], m = metre();
	const L = stillThere(b.enemy) ?? heardNow(b.x, b.z, K.aggro * m);
	if (L && Math.hypot(L.x - b.home[0], L.z - b.home[1]) < K.leash * m * L.sick || (L && b.enemy === L.id && Math.hypot(b.x - b.home[0], b.z - b.home[1]) < K.leash * 2.5 * m)) {
		if (b.enemy === null) b.enemy = L.id;
		const left = closeOn(b, L, K.run, K.reach * 0.7 * m, dt);
		if (left < K.reach * m && now > b.due) bite(b, L);
		return;
	}
	b.enemy = null;
	if (b.state == 'rest') {
		standing(b, dt);
		b.headDown += (1 - b.headDown) * Math.min(dt, 1);
		if ((b.timer -= dt) <= 0) { b.state = 'walk'; b.target = roamTarget(b, b.kind == 'moose' ? [terrain.ZONE_MARSH, terrain.ZONE_GRASSLAND, terrain.ZONE_FOREST] : ZONES()); }
	} else {
		b.headDown += (0 - b.headDown) * Math.min(dt * 2, 1);
		if (moveTo(b, b.target, K.walk, dt) < m) { b.state = 'rest'; b.timer = REST[0] + Math.random() * (REST[1] - REST[0]); }
	}
}

// THE PACK (see the top)
function stepPack(P, dt) {
	const m = metre(), K = KINDS.wolf, wolves = beasts.filter((b) => b.pack === P);
	if (!wolves.length) return;
	const lead = wolves[0];
	// half down: they run
	if (wolves.length < Math.ceil(P.size / 2) && P.state == 'fight') { P.state = 'roam'; P.enemy = null; P.timer = 40; P.target = [...P.home]; P.targetAge = 0; for (const w of wolves) w.lunging = false; }
	// (at a kill they only mind one who comes close)
	const L = stillThere(P.enemy) ?? heardNow(lead.x, lead.z, K.aggro * (P.state == 'eat' ? 0.6 : 1) * m);
	if (L && Math.hypot(L.x - lead.x, L.z - lead.z) < K.leash * m * L.sick && wolves.length >= Math.ceil(P.size / 2)) { P.state = 'fight'; P.enemy = L.id; }
	else if (P.state == 'fight') { P.state = 'roam'; P.enemy = null; P.target = null; for (const w of wolves) w.lunging = false; }
	P.timer -= dt;
	if (P.state == 'fight') {
		// the ring round them, each to its own side; one at a time goes in
		P.lunge -= dt;
		const near = wolves.filter((w) => Math.hypot(w.x - L.x, w.z - L.z) < (RING + 3) * m);
		const going = wolves.find((w) => w.lunging);
		if (!going && P.lunge <= 0 && near.length) { near[Math.floor(Math.random() * near.length)].lunging = true; P.lunge = LUNGE; }
		for (const w of wolves) {
			if (w.lunging) {
				const left = closeOn(w, L, K.run * 1.15, K.reach * 0.7 * m, dt);
				if (left < K.reach * m) { if (now > w.due) bite(w, L); w.lunging = false; }
			} else {
				const a = w.side + Math.atan2(L.x - lead.x, L.z - lead.z) * 0.2 + now * 0.08;
				moveTo(w, [L.x + Math.sin(a) * RING * m, L.z + Math.cos(a) * RING * m], K.run * 0.8, dt);
			}
		}
		return;
	}
	if (P.state == 'hunt') {
		// after it: the one they all want; the first there has it
		const prey = P.prey.type == 'deer' ? deer.deerById(P.prey.id) : rabbits.rabbitById(P.prey.id);
		// (gone, or gone off their ground: they let it go)
		if (!prey || !inZones(prey.x, prey.z, ZONES())) { P.state = 'roam'; P.prey = null; P.timer = 15; P.target = null; return; }
		for (const w of wolves) {
			const left = moveTo(w, [prey.x + Math.sin(w.side) * 1.5 * m, prey.z + Math.cos(w.side) * 1.5 * m], K.run, dt);
			if (left < CATCH * m) {
				if (P.prey.type == 'deer') deer.killDeerById(prey.id, [Math.sin(w.heading), 0, Math.cos(w.heading)]);
				else rabbits.killRabbitById(prey.id);
				P.state = 'eat'; P.at = [prey.x, prey.z]; P.timer = EAT[0] + Math.random() * (EAT[1] - EAT[0]);
				beastStats.packKills++;
				break;
			}
		}
		return;
	}
	if (P.state == 'eat') {
		// all round it, heads down; and when they have done, nothing is left of it
		for (const w of wolves) {
			const a = w.side, left = moveTo(w, [P.at[0] + Math.sin(a) * 1.3 * m, P.at[1] + Math.cos(a) * 1.3 * m], K.walk * 1.5, dt);
			if (left < 0.5 * m) { standing(w, dt); w.heading += (Math.atan2(P.at[0] - w.x, P.at[1] - w.z) - w.heading) * Math.min(dt, 1); w.headDown += (1 - w.headDown) * Math.min(dt * 2, 1); }
		}
		if (P.timer <= 0) {
			if (P.prey.type == 'deer') deer.eaten(P.prey.id); else rabbits.harvest(P.prey.id);
			P.state = 'roam'; P.prey = null; P.target = null; P.timer = HUNT_AGAIN[0] + Math.random() * (HUNT_AGAIN[1] - HUNT_AGAIN[0]);
		}
		return;
	}
	// roaming: from place to place, the leader in front; time to hunt, the nearest
	if (P.timer <= 0) {
		// (only what is on their own ground: they do not leave the woods and the mountains for it)
		const mine = (o) => o && inZones(o.x, o.z, ZONES()) ? o : null;
		const D = mine(deer.nearestDeer(lead.x, lead.z, SCENT * m)), R = mine(rabbits.nearestRabbit(lead.x, lead.z, SCENT * m));
		const dd = D ? Math.hypot(D.x - lead.x, D.z - lead.z) : Infinity, dr = R ? Math.hypot(R.x - lead.x, R.z - lead.z) : Infinity;
		if (D || R) { P.prey = dd < dr ? { type: 'deer', id: D.id } : { type: 'rabbit', id: R.id }; P.state = 'hunt'; return; }
		P.timer = 20;
	}
	P.targetAge = (P.targetAge ?? 0) + dt;
	if (!P.target || P.targetAge > 45 || Math.hypot(P.target[0] - lead.x, P.target[1] - lead.z) < 4 * m) { P.target = roamTarget(lead, ZONES()); P.targetAge = 0; }
	wolves.forEach((w, k) => {
		w.headDown += (0 - w.headDown) * Math.min(dt * 2, 1);
		if (k == 0) { moveTo(w, P.target, K.walk * 1.5, dt); return; }
		const back = (2.5 + 1.2 * k) * m, s = k % 2 ? 1 : -1;
		const place = [lead.x - Math.sin(lead.heading) * back + Math.cos(lead.heading) * s * 1.8 * m, lead.z - Math.cos(lead.heading) * back - Math.sin(lead.heading) * s * 1.8 * m];
		const far = Math.hypot(place[0] - w.x, place[1] - w.z);
		if (far > 0.6 * m) moveTo(w, place, K.walk * 1.5 * Math.min(Math.max(far / (2 * m), 0.4), 2.5), dt); else standing(w, dt);
	});
}

function advance(dt) {
	if (followed) { beastStats.wolf = followed.filter((o) => o.alive && o.kind == 'wolf').length; return; }
	if (!terrain.land || hidden()) return;
	if (terrain.land !== builtFor) build();
	now += dt;
	// (one far from everyone, out past where it is drawn, less often, and its ground and slope with it: rates.js. A pack goes as one)
	const seen = DRAW * metre();
	for (const b of beasts) b.step = stilled ? dt : 0;
	if (!stilled) {
		for (const b of beasts) if (b.kind != 'wolf') { const s = stepFor(b, b.x, b.z, dt, seen); if (s) { stepLone(b, s); b.step = s; } }
		for (const P of packs) {
			const lead = beasts.find((b) => b.pack === P), s = stepFor(P, lead?.x ?? P.home[0], lead?.z ?? P.home[1], dt, seen);
			if (!s) continue;
			stepPack(P, s);
			for (const b of beasts) if (b.pack === P) b.step = s;
		}
	}
	for (const b of beasts) {
		if (!b.step) continue;
		b.y = deer.groundUnder(b);
		const fx = Math.sin(b.heading) * 0.9 * metre(), fz = Math.cos(b.heading) * 0.9 * metre();
		b.slope += (Math.atan2(terrain.land.heightAt(b.x + fx, b.z + fz) - terrain.land.heightAt(b.x - fx, b.z - fz), 1.8 * metre()) - b.slope) * Math.min(b.step * 4, 1);
	}
	for (const c of corpses) c.t += dt;
	const lie = settings.gameMode == 'Hunting' ? LIE_SURVIVAL : LIE;
	corpses = corpses.filter((c) => c.t < lie && c.cuts.length);
	for (let k = respawns.length - 1; k >= 0; k--) {
		if (respawns[k].at > clock()) continue;
		const R = respawns.splice(k, 1)[0];
		if (R.kind == 'moose') { const b = spawnMoose(R.number, landOf(R.tile)); if (b) { b.number = R.number; b.tile = R.tile; beasts.push(b); } }
		else if (R.kind == 'bear') { const b = spawnBear(R.number, landOf(R.tile)); if (b) { b.number = R.number; b.tile = R.tile; beasts.push(b); } }
		else if (R.pack && beasts.filter((b) => b.pack === R.pack).length < R.pack.size) { const w = make('wolf', R.pack.home[0], R.pack.home[1], R.pack.home, R.pack); w.side = Math.random() * 6.28; beasts.push(w); }
	}
	for (const kind of Object.keys(KINDS)) beastStats[kind] = beasts.filter((b) => b.kind == kind).length;
	beastStats.corpses = corpses.length;
}

// SHOT (see the top)
const spheresOf = (b) => {
	const m = metre(), c = Math.cos(b.heading), s = Math.sin(b.heading);
	return KINDS[b.kind].spheres.map(([x, y, z, r]) => [b.x + (x * c + z * s) * m, b.y + y * m, b.z + (z * c - x * s) * m, r * m]);
};
const aroundOf = (b) => [b.x, b.y + KINDS[b.kind].around * 0.5 * metre(), b.z, KINDS[b.kind].around * metre()];
const living = () => followed ? followed.filter((o) => o.alive) : beasts;
ballistics.addTarget((ax, ay, az, bx, by, bz) => {
	if (hidden()) return null;
	const found = ballistics.crossAnimals(ax, ay, az, bx, by, bz, living(), spheresOf, aroundOf);
	return found && { t: found.t, what: found.animal.kind, hit: (velocity, bullet) => {
		if (bullet?.npc) return;
		if (followed) beastShot.report?.(found.animal.id, velocity, 'body', bullet?.round);
		else hurtBeast(found.animal, velocity, bullet?.round, 'me');
	} };
}, () => { const out = []; if (!hidden()) for (const b of living()) out.push(...aroundOf(b)); return out; });
function hurtBeast(b, velocity, round, who) {
	b.health -= HURT * (ballistics.ROUNDS[round]?.damage ?? 1);
	// (whoever did that it goes for: a whole pack)
	if (b.pack) { b.pack.state = 'fight'; b.pack.enemy = who; }
	else b.enemy = who;
	if (b.health > 0) return;
	beasts.splice(beasts.indexOf(b), 1);
	const side = velocity[0] * Math.cos(b.heading) - velocity[2] * Math.sin(b.heading) > 0 ? 1 : -1;
	// (a wolf has a little sinew on it, now and then)
	corpses.push({ beast: b, t: 0, side, cuts: [...KINDS[b.kind].cuts, ...(b.kind == 'wolf' && Math.random() < WOLF_SINEW ? ['sinew'] : [])] });
	respawns.push({ at: clock() + KINDS[b.kind].respawn, kind: b.kind, number: b.number, pack: b.pack, tile: b.tile });
	beastStats.killed++;
}
export function killBeastById(id, velocity, part, round, who) { const b = beasts.find((o) => o.id === id); if (b) hurtBeast(b, velocity ?? [0, 0, 0], round, who ?? 'me'); }

// A DEAD ONE (see the top): the one the eye is on, within reach; and the next cut off it (the host's to say)
export function corpseInReach(eye, look, reach) {
	if (hidden()) return null;
	const list = followed ? followed.filter((o) => !o.alive) : corpses.map((c) => c.beast);
	let best = null, bestD = reach * 1.6;
	for (const o of list) {
		const to = [o.x - eye[0], o.y + 0.4 * metre() - eye[1], o.z - eye[2]], d = Math.hypot(...to);
		if (d < bestD && (to[0] * look[0] + to[1] * look[1] + to[2] * look[2]) / (d || 1) > 0.65) { best = o; bestD = d; }
	}
	return best ? { id: best.id, kind: best.kind } : null;
}
export function cut(id) {
	const c = corpses.find((one) => one.beast.id == id);
	if (!c?.cuts.length) return null;
	return c.cuts.shift();
}

// MULTIPLAYER (see the top): [id, x, y, z, heading, stride, head down, walking, its kind's number, slope, roll, alive]
export function beastShare() {
	const out = [];
	for (const b of beasts) out.push(b.id, b.x, b.y, b.z, b.heading, b.stride, b.headDown, b.walking, KINDS[b.kind].number, b.slope, 0, 1);
	for (const c of corpses) { const b = c.beast; out.push(b.id, b.x, b.y, b.z, b.heading, 0, 0.4, 0, KINDS[b.kind].number, b.slope, c.side * Math.min(c.t / FALL, 1) * 1.45, 0); }
	return new Float32Array(out);
}
export function beastFollow(records) {
	if (!records) { followed = null; return; }
	followed = [];
	for (let k = 0; k < records.length; k += 12) followed.push({ id: records[k], x: records[k + 1], y: records[k + 2], z: records[k + 3], heading: records[k + 4], stride: records[k + 5], headDown: records[k + 6], walking: records[k + 7], kind: NUMBER_KIND[Math.round(records[k + 8])] ?? 'wolf', slope: records[k + 9], roll: records[k + 10], alive: records[k + 11] > 0.5 });
}

// Once a frame: on they go, and drawn near the camera
let lastTime = performance.now();
export function beastsUpdate() {
	const t = performance.now(), dt = Math.min((t - lastTime) / 1000, 0.05);
	lastTime = t;
	if (!settings.enableBeasts) return;
	advance(dt);
	if (hidden()) return;
	const m = metre(), reach = DRAW * m, cx = settings.camPosX, cz = settings.camPosZ;
	const show = (o, roll) => {
		if (Math.abs(o.x - cx) > reach || Math.abs(o.z - cz) > reach) return;
		const K = KINDS[o.kind];
		props.show(K.model, props.place([o.x, o.y + (roll ? 0.3 * m * Math.abs(Math.sin(roll)) : 0), o.z], o.heading, o.slope, roll), undefined, undefined, [o.stride, Math.min(o.walking, 1.2), o.headDown, K.number]);
	};
	if (followed) for (const o of followed) show(o, o.roll);
	else {
		for (const b of beasts) show(b, 0);
		for (const c of corpses) show(c.beast, c.side * Math.min(c.t / FALL, 1) * 1.45);
	}
}
// what a dead one is called (highlights.js)
export const deadSpots = () => (followed ? followed.filter((o) => !o.alive) : corpses.map((c) => c.beast)).map((o) => ({ at: [o.x, o.y + 0.8 * metre(), o.z], name: `Dead ${o.kind} (cut it up: hatchet or knife)` }));
// for testing
let stilled = false;
export function stillForTest(on) { stilled = on; }
export const beastsForTest = () => ({ ...beastStats, list: (followed ?? beasts).map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y, z: b.z, health: b.health, state: b.state, enemy: b.enemy, alive: b.alive ?? true })), packs: packs.map((P) => ({ state: P.state, size: P.size, prey: P.prey, timer: P.timer })), corpses: corpses.map((c) => ({ id: c.beast.id, kind: c.beast.kind, cuts: c.cuts.length })) });
export const beastForTest = (id) => beasts.find((b) => b.id === id);
export function packTimerForTest(k, v) { if (packs[k]) packs[k].timer = v; return packs[k]; }
