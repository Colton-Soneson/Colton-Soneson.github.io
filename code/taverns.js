import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as props from './props.js'
import * as townFolk from './townFolk.js'
import * as shops from './shops.js'
import { setGrassHoles } from './computeGrass.js'
import * as footmen from './footmen.js'
import { TAVERN, TAVERN_ROOM } from './workMeshes.js'
import { KINDS } from './footmen.js'

/*
	THE TAVERNS: out in the grasslands, by the roads between the towns (the land's roads: terrain.land.paths, footpaths.js), a tavern every
	so often (SITES): beside the road (OFF its edge), its door to it, on ground level enough for it, well away from the towns (AWAY) and
	the farms, and SPACING from each other (MOST on a land at the most). Where they are comes of the land alone, so everyone has the same.
	INSIDE (workMeshes.js: tavernInside, lit as a room is): its door open, a step up to it, the floor (hunting.js: addFloor) and the room
	downstairs, the counter, two tables each with a bench either side, the hearth. The walls (a run of small squares, a gap at the door), the
	counter and the tables are in the walker's way (hunting.js: addStill), and the sign's post and the porch's; the benches are stepped on.
	No grass grows under it (computeGrass.js: setGrassHoles). Drawn within DRAW, inside within NEAR.
	THE KEEPER stands behind his counter, and trades (shops.js: the tavernkeeper's, E at him): drink and a bite, and the men drinking there to
	hire. His prices are his nearest town's.
	THE PATRONS: men sitting on the benches (SEATS of them, most of them taken: a seat's kind, by the tavern and the seat), always there,
	riflemen, shotgun raiders and snipers (footmen.js: KINDS, each in his kind's hat), each now and then lifting his tankard to his mouth and
	putting it down (SIP: vf_dummy.js's drinking, THE GESTURES; the tankard drawn in his hand, at the place the same sums put it), his head
	back as he drinks, and looking about the room. HIRED (fireteams.js: hireFootman; recruit), one of the kind asked for gets up and goes
	out of the door (footmen.js: via), and is the player's; his seat stays empty REFILL seconds, then another sits down there. Each machine
	keeps its own (who has been hired is the host's: a joiner sees them all sitting).
	Metres (places in world units)
*/
const SITES = { every: 70, off: 9, level: 0.8 };		// metres along a road between places looked at; off its edge to the tavern's middle; most it may rise across it
const AWAY = 450;					// metres from a town
const FARMS = 120;					// and from a farm
const SPACING = 1400;				// metres between taverns
const MOST = 4;						// on a land (a tile of the world) at the most
const DRAW = 900;					// metres
const NEAR = 160;					// metres: the room drawn, and the people in it
const SEATS = 2;					// men to a bench, at most (two benches to a table)
const TAKEN = 0.75;					// of the seats, at the start
const SIP = { every: [7, 14], seconds: 2.6, tip: 0.45 };	// seconds between sips, seconds a sip takes, radians the head goes back
const REFILL = 180;					// seconds an emptied seat stays empty
const NAMES = ["The Drover's Rest", 'The Crossed Keys', 'The Wagon Wheel', 'The Lone Elm', 'The Rusty Spur', 'The Stag and Hound', "The Ferryman's Arms", 'The Plough and Star'];

const metre = () => settings.forestUnitsPerMetre;
let taverns = [], builtFor = null, pathsSeen = -1;
export const tavernStats = { taverns: 0, hired: 0 };

// a place on a tavern (metres: across, and towards its door from its middle) in the world
function on(t, u, w) {
	const m = metre(), c = Math.cos(t.yaw), s = Math.sin(t.yaw);
	return [t.x + (u * c + w * s) * m, t.z + (w * c - u * s) * m];
}
// and the other way: a place in the world on a tavern ([across, towards its door] metres)
function local(t, x, z) {
	const m = metre(), c = Math.cos(t.yaw), s = Math.sin(t.yaw), dx = (x - t.x) / m, dz = (z - t.z) / m;
	return [dx * c - dz * s, dx * s + dz * c];
}
const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
const kindFor = (r) => r < 0.45 ? 'rifleman' : r < 0.75 ? 'raider' : 'sniper';
// THE SITES (see the top), from the land's roads as they are now
function build() {
	const land = terrain.land, m = metre();
	builtFor = land;
	pathsSeen = land?.paths?.length ?? 0;
	taverns = [];
	if (!land) return;
	const towns = (land.towns ?? []).filter((t) => t.buildings?.length || t.approx).map((t) => t.site ? [t.site.x, t.site.z] : t.approx ?? [t.buildings[0].x, t.buildings[0].z]);
	const farms = (land.farms ?? []).map((f) => [f.x, f.z]);
	const perTile = new Map();
	for (const path of land.paths ?? []) {
		if (path.kind != 'road' || path.hidden || path.rail) continue;
		let since = 0;
		for (let k = 1; k < path.points.length; k++) {
			const a = path.points[k - 1], b = path.points[k], len = Math.hypot(b[0] - a[0], b[2] - a[2]);
			since += len;
			if (since < SITES.every * m || len < 1e-3) continue;
			since = 0;
			const dx = (b[0] - a[0]) / len, dz = (b[2] - a[2]) / len;
			for (const side of [1, -1]) {
				const out = ((path.half ?? 3 * m) + SITES.off * m) * side, x = b[0] - dz * out, z = b[2] + dx * out;
				const tile = terrain.world ? Math.round(x / settings.terrainWorldSize) + ',' + Math.round(z / settings.terrainWorldSize) : 'land';
				if ((perTile.get(tile) ?? 0) >= MOST || !terrain.inWorld(x, z, 50 * m) || land.zoneAt(x, z) != terrain.ZONE_GRASSLAND) continue;
				if (towns.some(([tx, tz]) => Math.hypot(tx - x, tz - z) < AWAY * m) || farms.some(([fx, fz]) => Math.hypot(fx - x, fz - z) < FARMS * m)) continue;
				if (taverns.some((t) => Math.hypot(t.x - x, t.z - z) < SPACING * m)) continue;
				// (level enough: the ground under its corners and its sign within SITES.level of each other, and none of it under water)
				const yaw = Math.atan2(dz * side, -dx * side);
				const probe = { x, z, yaw };
				const ys = [[-5.5, -4], [5.5, -4], [-5.5, 4], [5.5, 4], [0, 0], [3.6, 6.2]].map(([u, w]) => { const [px, pz] = on(probe, u, w); return land.heightAt(px, pz); });
				if (Math.max(...ys) - Math.min(...ys) > SITES.level * m || Math.min(...ys) < settings.waterWorldPosY + 0.6 * m) continue;
				const n = taverns.length;
				// (its floor over the highest of the ground under it)
				let top = -Infinity;
				for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { const [px, pz] = on(probe, -5 + 2.5 * i, -3.5 + 1.75 * j); top = Math.max(top, land.groundAt(px, pz)); }
				const t = { x, z, yaw, y: top + 0.2 * m, name: NAMES[Math.abs(Math.round(x * 7 + z * 13)) % NAMES.length], number: n };
				taverns.push(t);
				perTile.set(tile, (perTile.get(tile) ?? 0) + 1);
				break;
			}
		}
	}
	// THE KEEPER (see the top): behind his counter, facing the door; his town the nearest. THE PATRONS: on the benches, facing their tables
	const R = TAVERN_ROOM;
	for (const t of taverns) {
		t.floor = t.y + R.floor * metre();
		t.seats = [];
		R.tables.forEach(([tx, tz], k) => {
			for (const side of [-1, 1]) for (let j = 0; j < SEATS; j++) {
				const u = tx + (j - (SEATS - 1) / 2) * 0.7, w = tz + side * R.bench.off, n = t.seats.length, [x, z] = on(t, u, w);
				t.seats.push({ u, w, side, x, z, y: t.floor + R.bench.h * metre(), heading: t.yaw + (side > 0 ? Math.PI : 0),
					kind: hash(t.number, n) < TAKEN ? kindFor(hash(n, t.number + 7)) : null, back: 0, hue: hash(n + 3, t.number), sip: SIP.every[0] + hash(n, 5) * (SIP.every[1] - SIP.every[0]), at: hash(n, 9) * SIP.every[1] });
			}
		});
		const [kx, kz] = on(t, 0, R.counter.z[0] - 0.45), near = (land.towns ?? []).filter((o) => o.buildings?.length).sort((p, q) => Math.hypot(p.buildings[0].x - t.x, p.buildings[0].z - t.z) - Math.hypot(q.buildings[0].x - t.x, q.buildings[0].z - t.z))[0];
		const [dx, dz] = on(t, -0.6, TAVERN.d / 2 + 2.5);
		t.keeper = { index: -1000 - t.number, profession: { name: 'tavernkeeper' }, town: near ?? null, hue: (t.number * 0.37) % 1,
			place: { x: kx, y: t.floor, z: kz, heading: t.yaw, stride: 0, walking: 0 }, door: { x: dx, z: dz, heading: t.yaw }, tavern: t,
			seated: (kind) => t.seats.filter((one) => one.kind == kind).length, recruit: (kind) => recruit(t, kind) };
	}
	tavernStats.taverns = taverns.length;
	setGrassHoles('taverns', taverns.map((t) => [t.x, t.z, 7 * metre(), 7 * metre()]));
}
terrain.onTiles(() => { builtFor = null; });

// HIRED (see THE PATRONS at the top): one of that kind up from his seat (the nearest the door), and his way out: { at, via }, or null
function recruit(t, kind) {
	const seat = t.seats.filter((one) => one.kind == kind).sort((a, b) => b.w - a.w)[0];
	if (!seat) return null;
	seat.kind = null;
	seat.back = performance.now() / 1000 + REFILL;
	const Z = TAVERN.d / 2, aisle = on(t, seat.u, seat.w + seat.side * 0.5), inside = on(t, 0, Z - 0.6), outside = on(t, 0, Z + 2.4);
	tavernStats.hired++;
	return { at: { x: seat.x, z: seat.z, heading: seat.heading }, via: [aisle, inside, outside] };
}
// the floor (and the step up to the door, half its height): the walker's (hunting.js: addFloor) and a footman's going out (footmen.js)
function floorAt(x, z, highest = Infinity) {
	const m = metre();
	for (const t of taverns) {
		if (Math.abs(t.x - x) > 9 * m || Math.abs(t.z - z) > 9 * m) continue;
		const [u, w] = local(t, x, z), X = TAVERN.w / 2, Z = TAVERN.d / 2;
		const y = Math.abs(u) < X && Math.abs(w) < Z ? t.floor : Math.abs(u) < 1.5 && w >= Z && w < Z + 0.55 ? t.y + 0.1 * m : Math.abs(u) < 1.5 && w >= Z + 0.55 && w < Z + 1.1 ? t.y - 0.25 * m : -Infinity;
		if (y > -Infinity && y <= highest) return y;
	}
	return -Infinity;
}
hunting.addFloor((x, z, highest) => floorAt(x, z, highest));
footmen.setFloor((x, z) => floorAt(x, z));
// the walls in the walker's way: small squares along them (a gap at the open door), the counter, the tables, the hearth, the sign's post,
//		the porch's posts
function walls(x, z, reach, add) {
	const m = metre(), R = TAVERN_ROOM;
	for (const t of taverns) {
		if (Math.hypot(t.x - x, t.z - z) > reach + 12 * m) continue;
		const X = TAVERN.w / 2, Z = TAVERN.d / 2, at = (u, w, half = 0.3, top = TAVERN.h) => { const [px, pz] = on(t, u, w); add(px, pz, half * m, t.y - m, t.y + top * m); };
		for (let u = -X; u <= X + 0.01; u += 0.5) { at(u, -Z); if (Math.abs(u) > TAVERN.door + 0.25) at(u, Z); }
		for (let w = -Z; w <= Z + 0.01; w += 0.5) { at(-X, w); at(X, w); }
		at(-X - 0.15, 0, 0.6);
		for (let u = -R.counter.x; u <= R.counter.x + 0.01; u += 0.5) at(u, (R.counter.z[0] + R.counter.z[1]) / 2, 0.25, R.floor + R.counter.h);
		for (const [tx, tz] of R.tables) at(tx, tz, R.table.half, R.floor + R.table.h);
		at(-X + 0.4, 0, 0.6, R.floor + 1.4);
		at(TAVERN.sign[0], TAVERN.sign[1], 0.15);
		for (const s of [-1, 1]) at(s * 1.5, Z + 1.53, 0.1);
	}
}
hunting.addStill(walls);
footmen.setWalls(walls);
// THE PATRONS (see the top): a sip now (0 to 1: the tankard on the table to at the mouth), seconds into its round
const sipNow = (seat, now) => { const s = (now + seat.at) % seat.sip; return Math.min(Math.max(s / 0.5, 0), 1) * Math.min(Math.max((SIP.seconds - s) / 0.5, 0), 1) * (s < SIP.seconds ? 1 : 0); };
// where his hand is (vf_dummy.js's sums: the right shoulder, the upper arm's way and the forearm's, by how far the tankard is lifted), sat
//		down, and the world's
const DRINK_REST = [[0.1864, -0.5592, 0.8078], [0.0995, -0.0298, 0.9946]], DRINK_UP = [[0.3928, -0.3143, 0.8642], [0.3164, 0.8416, -0.4376]];
const unit = (v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); };
function handOf(seat, a) {
	const U = unit(DRINK_REST[0].map((v, i) => v + (DRINK_UP[0][i] - v) * a)), F = unit(DRINK_REST[1].map((v, i) => v + (DRINK_UP[1][i] - v) * a));
	const p = [-0.22 + U[0] * 0.3196 + F[0] * 0.318, 1.45 + U[1] * 0.3196 + F[1] * 0.318 - 0.9, U[2] * 0.3196 + F[2] * 0.318];
	const c = Math.cos(seat.heading), s = Math.sin(seat.heading), m = metre();
	return [seat.x + (p[0] * c + p[2] * s) * m, seat.y + p[1] * m, seat.z + (p[2] * c - p[0] * s) * m];
}
// the keepers and the patrons, drawn as the townsfolk are (the keepers found as they are to trade with)
townFolk.addFolkSource((each) => {
	const now = performance.now() / 1000;
	for (const t of taverns) {
		const p = t.keeper.place;
		if (Math.hypot(p.x - settings.camPosX, p.z - settings.camPosZ) > NEAR * metre()) continue;
		each({ hat: 'tricorn', x: p.x, y: p.y, z: p.z, heading: p.heading, stride: 0, walking: 0, hue: t.keeper.hue, armsDown: 1, look: 0.5 * Math.sin(now * 0.3 + t.number) });
		for (const seat of t.seats) {
			if (!seat.kind) continue;
			const a = sipNow(seat, now);
			each({ hat: KINDS[seat.kind].hat, x: seat.x, y: seat.y, z: seat.z, heading: seat.heading, sit: 1, stride: 0, walking: 0, hue: seat.hue, pitch: SIP.tip * a,
				look: a > 0 ? 0 : 0.7 * Math.sin(now * 0.23 + seat.hue * 20) * Math.max(Math.sin(now * 0.11 + seat.hue * 9), 0), gesture: { kind: 4, amount: a, phase: 0 } });
		}
	}
});
shops.addTraders((each) => { for (const t of taverns) each(t.keeper); });

// ONCE A FRAME (rotatingCube.js): made again as the land changes; drawn
export function tavernsUpdate() {
	if (!terrain.land) return;
	if (builtFor !== terrain.land || (terrain.land.paths?.length ?? 0) != pathsSeen) build();
	const draw = DRAW * metre(), near = NEAR * metre(), now = performance.now() / 1000;
	for (const t of taverns) {
		if (Math.abs(t.x - settings.camPosX) > draw || Math.abs(t.z - settings.camPosZ) > draw) continue;
		props.show('tavern', props.place([t.x, t.y, t.z], t.yaw));
		if (Math.hypot(t.x - settings.camPosX, t.z - settings.camPosZ) > near) continue;
		props.show('tavernInside', props.place([t.x, t.y, t.z], t.yaw), undefined, [1, 0, 0, 0]);
		for (const seat of t.seats) {
			// (an emptied seat taken again, in time, by a new man)
			if (!seat.kind && seat.back && now > seat.back) { seat.kind = kindFor(Math.random()); seat.back = 0; seat.hue = Math.random(); }
			if (!seat.kind) continue;
			// his tankard: in his hand, on the table or at his mouth (tipped up to it)
			const a = sipNow(seat, now), h = handOf(seat, a);
			props.show('mug', props.place([h[0], h[1] - 0.06 * metre(), h[2]], seat.heading + Math.PI / 2, 0, -1.1 * a), undefined, [1, 0, 0, 0]);
		}
	}
}
// for testing
export const tavernsForTest = () => taverns.map((t) => ({ x: t.x, z: t.z, y: t.y, floor: t.floor, yaw: t.yaw, name: t.name, keeper: t.keeper.place, door: t.keeper.door, seats: t.seats.map((s) => ({ kind: s.kind, x: s.x, z: s.z, y: s.y, heading: s.heading })) }));
