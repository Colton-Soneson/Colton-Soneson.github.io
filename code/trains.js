import { settings } from './settings.js';
import * as terrain from './terrain.js'
import * as npcs from './npcs.js'
import * as props from './props.js'
import * as loot from './loot.js'
import * as treasury from './treasury.js'
import * as townOpinion from './townOpinion.js'
import * as survivalNet from './survivalNet.js'
import * as inventory from './inventory.js'
import { TRAIN_CARS } from './workMeshes.js'
import { RAIL_FLOATS } from './terrainGenerator.js'
import { ITEMS, makeItem } from './items.js'

/*
	THE TRAINS (the Survival mode's): on each continent's main line (terrainGenerator.js: THE MAIN LINE; terrain.land.railLines), TRAIN.count of
	them, one each way, from one end to the other and back, stopping at its stations (footpaths.js: THE STATIONS, those of the tiles here) for
	TRAIN.dwell seconds. Four cars (workMeshes.js: TRAIN_CARS): the engine and its tender, two coaches, the express car. Old western.
		ITS PEOPLE		its engineer and his fireman on the footplate, and between TRAIN.gunmen of its guards in the coaches, on their roofs and
						platforms and in the express car: all of one group (npcs.js), its railroad's town's (the first station's: its horsemen's
						hostility, townOpinion.js). Whoever they are hostile to (shot at, robbed) within TRAIN.range they shoot at, from where they
						are, as it goes
		ROBBED			its engineer shot dead, it brakes to a stand and stays there (TRAIN.lost seconds, then it is put to rights, everyone back);
						its strongbox, in the express car (loot.js: trainChest), anyone's for the taking, the guards after whoever takes from it,
						and its railroad's town thinking the less of them
		TROOPS			a troop train (carryTroops: survivalWar.js) from one town's station to another's, its horsemen landed there one by one
						as the war's, then on to the end of the line and gone
	IN A GAME the host runs them; everyone is told where each is along its line (trainsIs), and draws it there on the same line (it is the
	same everywhere). Metres and seconds; places in world units
*/
const TRAIN = { count: 2, cruise: 13, accel: 0.35, brake: 0.8, dwell: 30, end: 45, gap: 1.2, cars: ['trainLoco', 'trainCoach', 'trainCoach', 'trainExpress'], gunmen: [20, 30],
	range: 150, look: 0.4, fire: [1.4, 3.2], lost: 240, draw: 2500, tell: 4, top: 0.42, land: 1.2 };
// what is in the express car's strongbox ([type, chance, most]), filled at each end of the line
const VALUABLES = [['money', 1, 12000], ['money', 0.6, 8000], ['rifle', 0.3], ['revolver', 0.4], ['rifleRounds', 0.6, 40], ['coltRounds', 0.5, 30], ['antibiotics', 0.3, 2], ['bandage', 0.4, 4], ['sewingKit', 0.2]].filter(([t]) => ITEMS[t]);

const metre = () => settings.forestUnitsPerMetre;
export const trainStats = { trains: 0, stops: 0, shots: 0, robbed: 0, stopped: 0, troopsLanded: 0 };
const trains = [];
export const trainsForTest = trains;
export const stopsForTest = (line) => stopsOf(line).map((s) => Math.round(s.d));
const worth = (item) => item.type == 'money' ? (item.count ?? 0) / 100 : (ITEMS[item.type]?.price ?? 1) * (item.count ?? 1);

// a line's: how far along it each point is, and a place at a distance along it (world units: x, y in the world on its rails' tops, z)
const lengthsOf = new WeakMap();
function lengths(line) {
	let L = lengthsOf.get(line);
	if (!L) {
		const P = line.points, n = P.length / RAIL_FLOATS;
		L = new Float64Array(n);
		for (let i = 1; i < n; i++) L[i] = L[i - 1] + Math.hypot(P[i * RAIL_FLOATS] - P[(i - 1) * RAIL_FLOATS], P[i * RAIL_FLOATS + 2] - P[(i - 1) * RAIL_FLOATS + 2]);
		lengthsOf.set(line, L);
	}
	return L;
}
function pointAt(line, d) {
	const L = lengths(line), P = line.points, n = L.length;
	d = Math.min(Math.max(d, 0), L[n - 1]);
	let lo = 0, hi = n - 1;
	while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (L[mid] <= d) lo = mid; else hi = mid; }
	const t = (d - L[lo]) / Math.max(L[hi] - L[lo], 1e-6), a = lo * RAIL_FLOATS, b = hi * RAIL_FLOATS;
	return [P[a] + (P[b] - P[a]) * t, P[a + 1] + (P[b + 1] - P[a + 1]) * t + settings.waterWorldPosY + TRAIN.top, P[a + 2] + (P[b + 2] - P[a + 2]) * t];
}
const trainLength = () => TRAIN.cars.reduce((s, c) => s + TRAIN_CARS[c].length + TRAIN.gap, -TRAIN.gap) * metre();
// each car's middle, which way it faces and its tip: [{ model, at, heading, pitch }] (the engine first, at the lead, ahead the way it goes)
function carsOf(line, lead, dir) {
	const m = metre(), out = [];
	let back = 0;
	for (const model of TRAIN.cars) {
		const len = TRAIN_CARS[model].length * m, mid = lead - dir * (back + len / 2);
		const f = pointAt(line, mid + dir * len * 0.35), r = pointAt(line, mid - dir * len * 0.35), at = pointAt(line, mid);
		out.push({ model, at, heading: Math.atan2(f[0] - r[0], f[2] - r[2]), pitch: Math.atan2(f[1] - r[1], Math.hypot(f[0] - r[0], f[2] - r[2])) });
		back += len + TRAIN.gap * m;
	}
	return out;
}
const onCar = (car, [u, v, w]) => { const m = metre(), fx = Math.sin(car.heading), fz = Math.cos(car.heading); return [car.at[0] + (fx * w + fz * u) * m, car.at[1] + (v + w * Math.sin(car.pitch)) * m, car.at[2] + (fz * w - fx * u) * m]; };

// a line's stations here, as distances along it, with their towns
function stopsOf(line) {
	const L = lengths(line);
	return (terrain.land?.stations ?? []).filter((s) => s.line === line.id).map((s) => {
		const t = terrain.world ? terrain.land.towns.find((one) => one.tile == s.tile && one.k == s.town) : terrain.land.towns[s.town];
		return { d: L[s.s], t, at: s.at };
	});
}

// A TRAIN (host): its people in their places, its strongbox filled
function makeTrain(line, k, troops = null) {
	const total = lengths(line)[lengths(line).length - 1], group = npcs.makeGroup(), stops = stopsOf(line);
	group.town = stops[0]?.t ? treasury.townNumber(stops[0].t) : -1;
	const dir = troops ? troops.dir : k % 2 ? -1 : 1;
	const train = { id: troops ? 'troops:' + Math.random().toString(36).slice(2, 7) : line.id + ':' + k, line, total, s: troops ? troops.from : dir > 0 ? trainLength() + k * total * 0.3 : total - k * total * 0.3,
		dir, speed: 0, phase: 'run', wait: 0, group, people: [], places: [], chest: null, lostAt: -1, troops, look: 0 };
	const crew = (kind, hat, car, local, sit, gun) => { const p = npcs.makePerson(kind, { hat, gun, group, name: kind }); p.sit = sit; train.people.push(p); train.places.push({ car, local, sit }); return p; };
	train.engineer = crew('engineer', 'peaked', 0, TRAIN_CARS.trainLoco.people[0], 0, 'none');
	crew('fireman', 'beanie', 0, TRAIN_CARS.trainLoco.people[1], 0, 'none');
	if (!troops) {
		const want = TRAIN.gunmen[0] + Math.floor(Math.random() * (TRAIN.gunmen[1] - TRAIN.gunmen[0] + 1));
		const spots = [];
		TRAIN.cars.forEach((model, car) => { if (car > 0) for (const local of TRAIN_CARS[model].people) spots.push([car, local]); });
		for (let n = 0; n < want; n++) { const [car, local] = spots[n % spots.length], again = Math.floor(n / spots.length); crew('guard', 'stetson', car, [local[0] * (again % 2 ? -1 : 1), local[1], local[2] + again * 0.8], local[1] > 3 ? 0 : 1, 'rifle'); }
	}
	trains.push(train);
	trainStats.trains = trains.length;
	if (!troops) fill(train);
	return train;
}
function fill(train) {
	if (train.chest) loot.removeContainer(train.chest);
	const items = [];
	for (const [type, chance, most = 1] of VALUABLES) if (Math.random() < chance) items.push(makeItem(type, 1 + Math.floor(Math.random() * most)));
	const express = carsOf(train.line, train.s, train.dir)[3];
	train.chest = loot.addCartChest(train.id + ':box' + Math.floor(Math.random() * 1e6), onCar(express, [1.7, 1.2, 0]), items, 'trainChest').id;
}
function remove(train) {
	for (const p of train.people) npcs.removePerson(p);
	if (train.chest) loot.removeContainer(train.chest);
	trains.splice(trains.indexOf(train), 1);
	trainStats.trains = trains.length;
}
// (put to rights: everyone back, its strongbox filled again)
function mend(train) {
	for (const p of train.people) if (!p.alive) npcs.revive(p);
	train.phase = 'run'; train.lostAt = -1; train.group.hostile.clear();
	fill(train);
}

// ONE TRAIN for dt seconds (host)
function stepTrain(train, dt) {
	const m = metre(), now = npcs.now();
	// (its engineer shot dead: it brakes to a stand, and stays)
	if (!train.engineer.alive && train.phase != 'stopped') { train.phase = 'stopped'; train.lostAt = now; trainStats.stopped++; }
	if (train.phase == 'stopped' && now - train.lostAt > TRAIN.lost) mend(train);
	let want = TRAIN.cruise * Math.max(settings.horseSpeed, 0.1);
	if (train.phase == 'stopped') want = 0;
	if (train.phase == 'dwell') { want = 0; if ((train.wait -= dt) <= 0) train.phase = 'run'; }
	// (the next place it stops ahead: a station, its troops' station, or the end of the line)
	if (train.phase == 'run') {
		const ahead = (d) => (d - train.s) * train.dir;
		const stops = train.troops ? [{ d: train.troops.to, troop: true }] : stopsOf(train.line);
		const end = train.dir > 0 ? train.total : trainLength();
		let next = { d: end, end: true };
		for (const s of stops) if (ahead(s.d) > -0.5 * m && ahead(s.d) < ahead(next.d)) next = s;
		const left = ahead(next.d) / m;
		want = Math.min(want, Math.sqrt(2 * TRAIN.brake * Math.max(left, 0)) + 0.3);
		if (left < 2 && train.speed < 4) {
			train.speed = 0;
			if (next.troop) { train.troops.landing = true; train.phase = 'landing'; }
			else if (next.end) {
				// (the end of the line: round, and its strongbox filled again; a troop train gone)
				if (train.troops) { remove(train); return; }
				train.s -= train.dir * trainLength(); train.dir = -train.dir; train.phase = 'dwell'; train.wait = TRAIN.end; fill(train);
			} else { train.phase = 'dwell'; train.wait = TRAIN.dwell; trainStats.stops++; }
			train.s += train.dir * 3 * m;
		}
	}
	if (train.phase == 'landing') {
		want = 0;
		const T = train.troops;
		if ((T.next = (T.next ?? 0) - dt) <= 0 && T.landed < T.count) {
			T.next = TRAIN.land;
			const [x, , z] = T.at ? [T.at[0], 0, T.at[1]] : pointAt(train.line, train.s);
			T.land(x + (T.landed % 3 - 1) * 3 * m, z + Math.floor(T.landed / 3) * 3 * m, T.landed);
			T.landed++; trainStats.troopsLanded++;
		}
		if (T.landed >= T.count) train.phase = 'run';
	}
	train.speed += Math.min(Math.max(want - train.speed, -TRAIN.brake * dt), TRAIN.accel * dt);
	train.s = Math.min(Math.max(train.s + train.dir * train.speed * m * dt, 0), train.total);
	// its people in their places, and the guards at whoever they are hostile to
	const cars = carsOf(train.line, train.s, train.dir);
	const look = (train.look -= dt) <= 0;
	if (look) train.look = TRAIN.look;
	train.people.forEach((p, k) => {
		const pl = train.places[k], car = cars[pl.car], [x, y, z] = onCar(car, pl.local);
		if (p.alive) p.place = { x, y, z, heading: car.heading + (pl.local[0] > 0.3 ? Math.PI / 2 : pl.local[0] < -0.3 ? -Math.PI / 2 : 0), sit: pl.sit };
		p.anchor = null;
		if (!p.alive || p.kind != 'guard') return;
		if (look) {
			const found = npcs.enemiesOf(train.group, x, y + 1.5 * m, z).find((e) => e.d < TRAIN.range * m);
			p.enemy = found && npcs.clearLine([x, y + 1.5 * m, z], [found.x, found.y, found.z]) ? found.id : null;
		}
		const t = p.enemy ? npcs.targetById(p.enemy) : null;
		p.fighting = !!t?.alive;
		if (!p.fighting) return;
		const muzzle = [x, y + 1.45 * m, z];
		p.aim = Math.atan2(t.y - muzzle[1], Math.hypot(t.x - muzzle[0], t.z - muzzle[2]));
		p.place.heading = Math.atan2(t.x - x, t.z - z);
		if ((p.fire = (p.fire ?? Math.random() * 2) - dt) <= 0) { p.fire = TRAIN.fire[0] + Math.random() * (TRAIN.fire[1] - TRAIN.fire[0]); npcs.fireAt(p, muzzle, t, { spread: 0.02, spreadFar: 0.008 }); trainStats.shots++; }
	});
	const box = train.chest && loot.containerById(train.chest);
	if (box) box.at = onCar(cars[3], [1.7, 1.2, 0]);
	train.cars = cars;
}

// ROBBED (see the top)
loot.onTaken((c, item, who) => {
	if (c.kind != 'trainChest') return;
	const train = trains.find((one) => one.chest === c.id);
	if (!train) return;
	trainStats.robbed++;
	npcs.provoke(train.group, who);
	if (train.group.town >= 0) townOpinion.wrong(who, train.group.town, 'steal', worth(item));
});

// A TROOP TRAIN (see the top): count horsemen from town a's station to town b's on the same line, each landed there by land(x, z, n). Null if
//		there is no such way
export function carryTroops(a, b, count, land) {
	for (const line of terrain.land?.railLines ?? []) {
		const stops = stopsOf(line), from = stops.find((s) => s.t === a), to = stops.find((s) => s.t === b);
		if (!from || !to) continue;
		const dir = to.d > from.d ? 1 : -1;
		return makeTrain(line, 0, { from: from.d, to: to.d, dir, count, landed: 0, land, at: to.at });
	}
	return null;
}
export const troopTrainDone = (train) => !trains.includes(train);
export const onSameLine = (a, b) => (terrain.land?.railLines ?? []).some((line) => { const stops = stopsOf(line); return stops.some((s) => s.t === a) && stops.some((s) => s.t === b); });

// WHERE THEY ARE, for a joiner: on the host's lines (sent it once each: trainLine), each where the host says it is along its line
const seen = new Map();		// id -> { line, s, dir, speed, drawn }
const hostLines = new Map();	// (a joiner's) id -> the host's line
const toldLines = new Set();
function tellLine(line, to = null) {
	const msg = { id: line.id, points: Array.from(line.points, (v) => Math.round(v * 100) / 100), length: line.length };
	if (to === null) survivalNet.send('trainLine', msg); else survivalNet.sendTo(to, 'trainLine', msg);
}
survivalNet.on('trainLine', (m) => { if (!survivalNet.authority() && Array.isArray(m.points)) hostLines.set(String(m.id), { id: String(m.id), points: new Float32Array(m.points), length: Number(m.length) || 0 }); });
survivalNet.onJoin((id) => { const sent = new Set(); for (const t of trains) if (!t.troops && !sent.has(t.line.id)) { sent.add(t.line.id); tellLine(t.line, id); } });
survivalNet.on('trainsIs', (msg) => {
	if (survivalNet.authority()) return;
	trainStats.heard = (trainStats.heard ?? 0) + 1;
	const lines = hostLines;
	const now = new Set();
	for (const [id, lineId, s, dir, speed] of msg.list ?? []) {
		const line = lines.get(lineId);
		if (!line) continue;
		now.add(id);
		const was = seen.get(id);
		seen.set(id, { line, s, dir, speed, drawn: was && was.dir == dir ? was.drawn : s });
	}
	for (const id of [...seen.keys()]) if (!now.has(id)) seen.delete(id);
});
export const trainsSeenForTest = () => [...seen.entries()].map(([id, t]) => ({ id, s: Math.round(t.s), dir: t.dir }));
let tellIn = 0, madeFor = null, madeLines = '';

function draw(line, s, dir) {
	const eye = [settings.camPosX, settings.camPosZ], far = TRAIN.draw * metre();
	const cars = carsOf(line, s, dir);
	if (cars.every((c) => Math.hypot(c.at[0] - eye[0], c.at[2] - eye[1]) > far)) return cars;
	for (const car of cars) props.show(car.model, props.place(car.at, car.heading, car.pitch));
	return cars;
}

// Per frame
export function trainsUpdate(dt) {
	if (!terrain.land || !inventory.survivalOn() || !npcs.on()) {	// (a war of the Survival mode's: they run on, carrying its troops)
		if (trains.length && survivalNet.authority()) for (const t of [...trains]) remove(t);
		madeFor = null;
		return;
	}
	if (survivalNet.authority()) {
		// (each line there is here: its trains)
		const lines = terrain.land.railLines ?? [], key = lines.map((l) => l.id).join('|');
		if (madeFor !== terrain.land || key != madeLines) {
			madeFor = terrain.land; madeLines = key;
			// (by its id: each tile here has its own copy of its continent's line, and the one taken may be another's now)
			for (const t of [...trains]) { const now = lines.find((l) => l.id === t.line.id); if (!now) remove(t); else t.line = now; }
			for (const line of lines) for (let k = 0; k < TRAIN.count; k++) if (!trains.some((t) => t.line.id === line.id && t.id == line.id + ':' + k)) makeTrain(line, k);
		}
		for (const train of [...trains]) stepTrain(train, dt);
		for (const train of trains) draw(train.line, train.s, train.dir);
		if ((tellIn -= dt) <= 0 && survivalNet.role() == 'host') {
			tellIn = 1 / TRAIN.tell;
			// (a line the joiners have not had yet)
			for (const t of trains) if (!toldLines.has(t.line.id)) { toldLines.add(t.line.id); tellLine(t.line); }
			survivalNet.send('trainsIs', { list: trains.map((t) => [t.id, t.line.id, Math.round(t.s * 10) / 10, t.dir, Math.round(t.speed * 100) / 100]) });
		}
		return;
	}
	for (const t of seen.values()) {
		t.s += t.dir * t.speed * metre() * dt;
		t.drawn += (t.s - t.drawn) * Math.min(dt * 4, 1);
		const cars = draw(t.line, t.drawn, t.dir);
		const box = [...loot.containerList()].find((c) => c.kind == 'trainChest' && Math.hypot(c.at[0] - cars[3].at[0], c.at[2] - cars[3].at[2]) < 40 * metre());
		if (box) box.at = onCar(cars[3], [1.7, 1.2, 0]);
	}
}
