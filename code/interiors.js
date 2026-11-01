import { settings } from './settings.js';

import * as town from './town.js'
import * as props from './props.js'
import * as hunting from './hunting.js'
import * as smoke from './smoke.js'
import * as pointLights from './pointLights.js'
import * as townFolk from './townFolk.js'
import * as inventory from './inventory.js'
import { seededRandom } from './terrainGenerator.js'
import { TOWN_METRE } from './townLayout.js'
import { MODELS, ROOMS, HANG_AT, planOf, shellName } from './interiorMeshes.js'

/*
	INSIDE THE HOUSES: the shell of each house near the camera (interiorMeshes.js: planOf, its rooms by its trade), and what is in its rooms, set out by the rooms' tags
	(FURNISHED: what each must have, then by lot whatever else shares a tag and fits). It is made from the house's own number (b.seed: the same on every machine) the first
	time it is wanted, so everyone in a game finds the same things in the same places, and nothing about it has to be sent. A house that has come down (town.js) has none.
		DRAWN		the shell and all that is in it, of the MOST_DRAWN nearest within DRAW of the camera (props.js, lit as a room)
		IN THE WAY	what stands on the floor (hunting.js: addStill), and its floor to stand on (addFloor: over the ground, that is cut down under it: townLayout.js)
		FIRE		a fireplace, a stove, an oven: flames (smoke.js) and, for the nearest few, its light. The lamps light up at night (pointLights.js: LIGHTS at a time)
		THE TRADES	who works there is found behind the counter when not out on an errand (townFolk.js: INDOORS: the Survival mode's, within SPOT_NEAR)
	In world units in a house's own space: x along its front, z out of its front (as townBuildings.js).
*/
const U = TOWN_METRE;				// world units to the metre, here
const DRAW = 120;					// world units
const MOST_DRAWN = 6;
const LIGHTS = 3;
const SPOT_NEAR = 130;				// world units
const BUCKET = 64;
const INDOOR = [1, 0, 0, 0], NO_GLOW = [0, 0, 0, 0];

// FURNISHED (see the top): what is in a house's rooms, in its own space: [{ name, x, y, z, yaw }], and where whoever works there stands
function furnish(plan, random) {
	const out = [];
	let spot = null;
	const pick = (list) => list[Math.floor(random() * list.length)];
	for (const R of plan.rooms) {
		const K = ROOMS[R.tag], taken = [], surfaces = [], hung = [];
		const width = R.x1 - R.x0, depth = R.z1 - R.z0;
		// what is to be kept clear: in front of each way in and out of it, and the way between them
		const ways = [];
		for (const D of plan.doors) if (D.x > R.x0 && D.x < R.x1 && Math.abs(R.z1 - plan.inner.z1) < 0.5) { taken.push({ x0: D.x - D.w / 2 - 0.8, x1: D.x + D.w / 2 + 0.8, z0: R.z1 - 5, z1: R.z1, h: 9 }); ways.push([D.x, R.z1 - 2]); }
		for (const g of plan.gaps) {
			if (g.along == 'x' && g.c > R.x0 && g.c < R.x1 && (Math.abs(g.at - R.z0) < 0.4 || Math.abs(g.at - R.z1) < 0.4)) { const front = Math.abs(g.at - R.z0) < 0.4; taken.push({ x0: g.c - g.w / 2 - 0.5, x1: g.c + g.w / 2 + 0.5, z0: front ? R.z0 : R.z1 - 4, z1: front ? R.z0 + 4 : R.z1, h: 9 }); ways.push([g.c, front ? R.z0 + 2 : R.z1 - 2]); }
			if (g.along == 'z' && g.c > R.z0 && g.c < R.z1 && (Math.abs(g.at - R.x0) < 0.4 || Math.abs(g.at - R.x1) < 0.4)) { const left = Math.abs(g.at - R.x0) < 0.4; taken.push({ x0: left ? R.x0 : R.x1 - 4, x1: left ? R.x0 + 4 : R.x1, z0: g.c - g.w / 2 - 0.5, z1: g.c + g.w / 2 + 0.5, h: 9 }); ways.push([left ? R.x0 + 2 : R.x1 - 2, g.c]); }
		}
		// (from the first of them, the way in, across and then along: an L, not all the square between)
		for (let k = 1; k < ways.length; k++) {
			const [a, c] = ways[0], [b, d] = ways[k];
			taken.push({ x0: Math.min(a, b) - 1.3, x1: Math.max(a, b) + 1.3, z0: c - 1.3, z1: c + 1.3, h: 9 }, { x0: b - 1.3, x1: b + 1.3, z0: Math.min(c, d) - 1.3, z1: Math.max(c, d) + 1.3, h: 9 });
		}
		const clear = (r) => r.x0 >= R.x0 && r.x1 <= R.x1 && r.z0 >= R.z0 && r.z1 <= R.z1 && !taken.some((t) => r.x0 < t.x1 && t.x0 < r.x1 && r.z0 < t.z1 && t.z0 < r.z1);
		const rect = (x, z, hw, hd, yaw) => { const across = Math.abs(Math.sin(yaw)) > 0.5, a = (across ? hd : hw) * U, b = (across ? hw : hd) * U; return { x0: x - a, x1: x + a, z0: z - b, z1: z + b }; };
		const stand = (name, x, y, z, yaw) => {
			const M = MODELS[name];
			out.push({ name, x, y, z, yaw });
			if (M.top) surfaces.push({ name, x, y: y + M.top * U, z, yaw, hw: M.hw, hd: M.hd, on: 0 });
		};
		const settle = (name, x, z, yaw) => {
			const M = MODELS[name], r = rect(x, z, M.hw + 0.03, M.hd + 0.03, yaw);
			if (!clear(r)) return false;
			taken.push({ ...r, h: M.h });
			stand(name, x, plan.floorY, z, yaw);
			return true;
		};
		// each anchor: where one may go, tried a few times by lot. false if it found no room
		const place = (name) => {
			const M = MODELS[name];
			if (name == 'altar') return settle(name, (R.x0 + R.x1) / 2, R.z0 + 2.2, 0);
			switch (M.anchor) {
				case 'counter': {
					// across the room, room behind it for whoever serves
					for (const off of [0, 2, -2, 4, -4, 6, -6, 9, -9]) {
						const cx = (R.x0 + R.x1) / 2 + off, cz = R.z0 + (M.hd + 1.25) * U;
						if (settle(name, cx, cz, 0)) { spot ??= { x: cx, z: R.z0 + 1.1, heading: 0 }; return true; }
					}
					return false;
				}
				case 'wall': {
					for (let k = 0; k < 24; k++) {
						const side = Math.floor(random() * 4), along = random();
						const dx = (M.hw + 0.2) * U, dz = (M.hd + 0.05) * U;
						const [x, z, yaw] = side == 0 ? [R.x0 + dx + (width - 2 * dx) * along, R.z0 + dz, 0] : side == 1 ? [R.x0 + dx + (width - 2 * dx) * along, R.z1 - dz, Math.PI]
							: side == 2 ? [R.x0 + dz, R.z0 + dx + (depth - 2 * dx) * along, Math.PI / 2] : [R.x1 - dz, R.z0 + dx + (depth - 2 * dx) * along, -Math.PI / 2];
						if (settle(name, x, z, yaw)) return true;
					}
					return false;
				}
				case 'corner': {
					const dx = (M.hw + 0.05) * U, dz = (M.hd + 0.05) * U, corners = [[R.x0 + dx, R.z0 + dz, 0], [R.x1 - dx, R.z0 + dz, 0], [R.x0 + dx, R.z1 - dz, Math.PI], [R.x1 - dx, R.z1 - dz, Math.PI]];
					const first = Math.floor(random() * 4);
					for (let k = 0; k < 4; k++) { const [x, z, yaw] = corners[(first + k) % 4]; if (settle(name, x, z, yaw)) return true; }
					return false;
				}
				case 'centre': {
					// a seat by a table if there is one, or anywhere it fits
					const table = surfaces.find((s) => s.hw >= 0.6 && s.hd >= 0.4);
					for (let k = 0; k < 20; k++) {
						if ((name == 'chair' || name == 'stool') && table) {
							const a = random() * Math.PI * 2, r = (Math.max(table.hw, table.hd) + 0.42) * U, x = table.x + Math.cos(a) * r, z = table.z + Math.sin(a) * r;
							if (settle(name, x, z, Math.atan2(table.x - x, table.z - z))) return true;
							continue;
						}
						const yaw = pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
						if (settle(name, R.x0 + 1.5 + (width - 3) * random(), R.z0 + 1.5 + (depth - 3) * random(), yaw)) return true;
					}
					return false;
				}
				case 'floor': {
					out.push({ name, x: (R.x0 + R.x1) / 2, y: plan.floorY + 0.02, z: (R.z0 + R.z1) / 2, yaw: width < depth ? Math.PI / 2 : 0 });
					return true;
				}
				case 'hang': {
					const y = HANG_AT * U;
					for (let k = 0; k < 24; k++) {
						const side = Math.floor(random() * 4), along = 0.1 + 0.8 * random();
						const [x, z, yaw] = side == 0 ? [R.x0 + width * along, R.z0 + 0.03, 0] : side == 1 ? [R.x0 + width * along, R.z1 - 0.03, Math.PI] : side == 2 ? [R.x0 + 0.03, R.z0 + depth * along, Math.PI / 2] : [R.x1 - 0.03, R.z0 + depth * along, -Math.PI / 2];
						const a = rect(x, z, M.hw + 0.05, 0.1, yaw);
						if (taken.some((t) => t.h * U > y - M.h * U && a.x0 < t.x1 && t.x0 < a.x1 && a.z0 < t.z1 && t.z0 < a.z1)) continue;
						if (hung.some((t) => a.x0 < t.x1 && t.x0 < a.x1 && a.z0 < t.z1 && t.z0 < a.z1)) continue;
						// (not on a window, nor over a way through)
						if (plan.windows.some((W) => W.nx == 0 ? Math.abs(W.x - x) < W.w / 2 + M.hw * U && (W.nz > 0 ? side == 1 : side == 0) : Math.abs(W.z - z) < W.w / 2 + M.hw * U && (W.nx > 0 ? side == 3 : side == 2))) continue;
						hung.push(a);
						out.push({ name, x, y, z, yaw });
						return true;
					}
					return false;
				}
				case 'top': {
					const under = M.on ? surfaces.filter((s) => s.name == M.on) : surfaces;
					for (let k = 0; k < 10 && under.length; k++) {
						const s = pick(under);
						if (s.on > 3) continue;
						s.on++;
						const a = (random() - 0.5) * 2 * Math.max(s.hw - M.hw - 0.04, 0) * U, b = (random() - 0.5) * 2 * Math.max(s.hd - M.hd - 0.04, 0) * U, c = Math.cos(s.yaw), n = Math.sin(s.yaw);
						out.push({ name, x: s.x + a * c + b * n, y: s.y, z: s.z - a * n + b * c, yaw: random() * 6.28 });
						return true;
					}
					return false;
				}
			}
			return false;
		};
		// a chapel's pews, in two rows either side of its aisle, facing its altar
		if (K.rows) {
			const M = MODELS[K.rows], mid = (R.x0 + R.x1) / 2, far = Math.min(M.hw * U + 1.4, width / 4 + 0.8);
			for (const name of K.must) if (name == 'altar') place(name);
			for (let z = R.z0 + 7; z < R.z1 - 5; z += 3.2) for (const s of [-1, 1]) settle(K.rows, mid + s * far, z, Math.PI);
		}
		for (const name of K.must) if (!(K.rows && name == 'altar')) place(name);
		for (const [anchor, count] of Object.entries(K.fill ?? {})) {
			const choices = Object.keys(MODELS).filter((name) => MODELS[name].anchor == anchor && name != 'ceilingLamp' && !MODELS[name].on && MODELS[name].tags.some((tag) => K.tags.includes(tag)));
			if (!choices.length) continue;
			for (let k = 0; k < count; k++) place(pick(choices));
		}
		// a lamp from every ceiling (two in a long room), whatever else
		const lamps = Math.max(width, depth) > 16 ? 2 : 1;
		for (let k = 0; k < lamps; k++) out.push({ name: 'ceilingLamp', x: width >= depth ? R.x0 + width * (k + 0.5) / lamps : (R.x0 + R.x1) / 2, y: plan.ceil, z: width < depth ? R.z0 + depth * (k + 0.5) / lamps : (R.z0 + R.z1) / 2, yaw: 0 });
	}
	return { props: out, spot: spot ?? { x: (plan.rooms[0].x0 + plan.rooms[0].x1) / 2, z: plan.rooms[0].z0 + 1.5, heading: 0 } };
}

// A HOUSE'S (see the top): what is in it, in the world, made the first time it is wanted
const interiors = new WeakMap();
export const interiorStats = { made: 0, drawnHouses: 0, drawnProps: 0 };
function interiorOf(h) {
	let I = interiors.get(h);
	if (I) return I;
	const b = h.building, plan = planOf(b.type, b.variant ?? 0), c = Math.cos(b.yaw), s = Math.sin(b.yaw), scale = U / settings.forestUnitsPerMetre;
	const world = (u, y, w) => [b.x + u * c + w * s, b.y + y, b.z - u * s + w * c];
	const { props: list, spot } = furnish(plan, seededRandom(Math.floor(b.seed * 1e9) + 11));
	I = { plan, shell: props.place([b.x, b.y, b.z], b.yaw, 0, 0, scale), name: shellName(b.type, b.variant ?? 0), props: [], boxes: [], lights: [], fires: [],
		spot: { at: world(spot.x, plan.floorY, spot.z), heading: b.yaw + spot.heading } };
	for (const p of list) {
		const M = MODELS[p.name], at = world(p.x, p.y, p.z);
		I.props.push({ name: p.name, model: props.place(at, b.yaw + p.yaw, 0, 0, scale) });
		// what stands on the floor is in the way: squares along its longer side
		if (M.solid !== false && !['hang', 'top', 'ceil', 'floor'].includes(M.anchor)) {
			const a = Math.max(M.hw, 0.14) * U, e = Math.max(M.hd, 0.14) * U, half = Math.min(a, e), turn = b.yaw + p.yaw, ca = Math.cos(turn), sa = Math.sin(turn);
			for (let u = -a + half; u <= a - half + 0.01; u += Math.max(half * 1.4, 0.4)) for (let w = -e + half; w <= e - half + 0.01; w += Math.max(half * 1.4, 0.4)) I.boxes.push(at[0] + u * ca + w * sa, at[2] - u * sa + w * ca, half, at[1], at[1] + M.h * U);
		}
		if (M.light) I.lights.push({ at: [at[0], at[1] - (M.anchor == 'ceil' ? 1.3 * U : 0), at[2]], radius: 9 * U, colour: [1.0, 0.76, 0.45], strength: 1.0, night: true });
		if (M.fire) {
			const t = b.yaw + p.yaw, ca = Math.cos(t), sa = Math.sin(t), [fx, fy, fz] = M.fire;
			const flame = [at[0] + (fx * ca + fz * sa) * U, at[1] + fy * U, at[2] + (-fx * sa + fz * ca) * U];
			I.fires.push(flame);
			I.lights.push({ at: [flame[0] + sa * 0.8 * U, flame[1] + 0.3 * U, flame[2] + ca * 0.8 * U], radius: 7 * U, colour: [1.0, 0.5, 0.2], strength: 1.3, night: false, flicker: true });
		}
	}
	interiors.set(h, I);
	interiorStats.made++;
	return I;
}

// the houses in buckets of the world (made again for a new land: town.js's list)
let bucketsFor = null, buckets = new Map();
function housesAt(x, z, reach, each) {
	const list = town.houseList();
	if (bucketsFor !== list) {
		bucketsFor = list;
		buckets = new Map();
		for (const h of list) {
			const key = Math.floor(h.building.x / BUCKET) * 100000 + Math.floor(h.building.z / BUCKET);
			if (!buckets.has(key)) buckets.set(key, []);
			buckets.get(key).push(h);
		}
	}
	for (let bx = Math.floor((x - reach) / BUCKET); bx <= Math.floor((x + reach) / BUCKET); bx++) for (let bz = Math.floor((z - reach) / BUCKET); bz <= Math.floor((z + reach) / BUCKET); bz++) {
		for (const h of buckets.get(bx * 100000 + bz) ?? []) each(h);
	}
}
// its own space, for a place in the world
function localOf(b, x, z) {
	const dx = x - b.x, dz = z - b.z, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
	return [dx * c - dz * s, dx * s + dz * c];
}
// (the reach of the biggest house: from its middle to a corner)
const WIDEST = 40;
// IN THE WAY (see the top)
hunting.addStill((x, z, reach, add) => {
	housesAt(x, z, reach + WIDEST, (h) => {
		if (h.damage >= 1 || Math.hypot(h.building.x - x, h.building.z - z) > reach + WIDEST) return;
		const B = interiorOf(h).boxes;
		for (let k = 0; k < B.length; k += 5) add(B[k], B[k + 1], B[k + 2], B[k + 3], B[k + 4]);
	});
});
hunting.addFloor((x, z, highest) => {
	let floor = -Infinity;
	housesAt(x, z, WIDEST, (h) => {
		const b = h.building;
		if (h.damage >= 1) return;
		const plan = planOf(b.type, b.variant ?? 0), y = b.y + plan.floorY;
		if (y > highest || y <= floor) return;
		const [u, w] = localOf(b, x, z), I = plan.inner;
		const inside = (u > I.x0 - 0.4 && u < I.x1 + 0.4 && w > I.z0 - 0.4 && w < I.z1 + 0.4) || plan.doors.some((D) => Math.abs(u - D.x) < D.w / 2 + 0.3 && w >= I.z1 - 0.4 && w < D.z + 0.3);
		if (inside) floor = y;
	});
	return floor;
});
// whether (x, z) is inside a house (and not outside its door): a place's own question
export function insideHouse(x, z) {
	let found = null;
	housesAt(x, z, WIDEST, (h) => {
		const [u, w] = localOf(h.building, x, z), I = planOf(h.building.type, h.building.variant ?? 0).inner;
		if (h.damage < 1 && u > I.x0 && u < I.x1 && w > I.z0 && w < I.z1) found = h;
	});
	return found;
}

// THE TRADES (see the top)
townFolk.setIndoorSpot((person) => {
	if (!inventory.survivalOn() || !person.building) return null;
	const b = person.building;
	if (Math.abs(b.x - settings.camPosX) > SPOT_NEAR || Math.abs(b.z - settings.camPosZ) > SPOT_NEAR) return null;
	const h = town.houseList().find((one) => one.building === b);
	if (!h || h.damage >= 1) return null;
	const { at, heading } = interiorOf(h).spot;
	return { x: at[0], y: at[1], z: at[2], heading, stride: 0, walking: 0, indoors: true };
});

// Once a frame: the nearest drawn, their fires, the nearest lights
let puffClock = 0, lastTime = performance.now();
export function interiorsUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	const lit = [];
	if (settings.enableTerrain && town.houseList().length) {
		const cx = settings.camPosX, cz = settings.camPosZ, near = [];
		housesAt(cx, cz, DRAW + WIDEST, (h) => {
			const d = Math.hypot(h.building.x - cx, h.building.z - cz);
			if (h.damage < 1 && d < DRAW + Math.max(h.building.width, h.building.depth) / 2) near.push({ h, d });
		});
		near.sort((a, b) => a.d - b.d);
		let drawn = 0;
		puffClock += dt;
		const puffs = puffClock > 0.09;
		if (puffs) puffClock = 0;
		for (const { h } of near.slice(0, MOST_DRAWN)) {
			const I = interiorOf(h);
			props.show(I.name, I.shell, NO_GLOW, INDOOR);
			for (const p of I.props) props.show(p.name, p.model, NO_GLOW, INDOOR);
			drawn += I.props.length;
			for (const light of I.lights) { const d = Math.hypot(light.at[0] - cx, light.at[1] - settings.camPosY, light.at[2] - cz); if (d < 34) lit.push({ light, d }); }
			if (puffs) for (const f of I.fires) if (Math.hypot(f[0] - cx, f[2] - cz) < 50) smoke.addPuff({ at: [f[0] + (Math.random() - 0.5) * 0.5, f[1], f[2] + (Math.random() - 0.5) * 0.5], v: [0, 0.8, 0], size: 0.13, grow: 0.6, life: 0.5, kind: 0, rise: 0.9 });
		}
		interiorStats.drawnHouses = Math.min(near.length, MOST_DRAWN);
		interiorStats.drawnProps = drawn;
	}
	lit.sort((a, b) => a.d - b.d);
	for (let k = 0; k < LIGHTS; k++) {
		const L = lit[k]?.light;
		pointLights.setMovingLight('room' + k, L ? { at: L.at, radius: L.radius, colour: L.colour, strength: L.strength * (L.flicker ? 0.88 + 0.12 * Math.sin(now * 0.017 + k * 3) * Math.sin(now * 0.0073 + k) : 1), night: L.night } : null);
	}
}
// for testing: what is in a house (its place in town.js's list)
export function interiorForTest(i) {
	const h = town.houseList()[i];
	if (!h) return null;
	const I = interiorOf(h);
	return { props: I.props.map((p) => p.name), boxes: I.boxes.length / 5, lights: I.lights.length, fires: I.fires.length, spot: I.spot, rooms: I.plan.rooms.map((R) => R.tag), doors: I.plan.doors };
}
