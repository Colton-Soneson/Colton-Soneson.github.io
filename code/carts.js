import { settings } from './settings.js';
import * as terrain from './terrain.js'
import * as horse from './horse.js'
import * as npcs from './npcs.js'
import * as npcRiders from './npcRiders.js'
import * as townFolk from './townFolk.js'
import * as props from './props.js'
import * as loot from './loot.js'
import * as treasury from './treasury.js'
import * as townOpinion from './townOpinion.js'
import * as survivalNet from './survivalNet.js'
import * as inventory from './inventory.js'
import * as hunting from './hunting.js'
import * as tunnels from './tunnels.js'
import { WAGON } from './workMeshes.js'
import { BUILDING_TYPES } from './townLayout.js'
import { ITEMS, makeItem } from './items.js'

/*
	THE TRADING CARTS (the Survival mode's): a horse-drawn wagon of a town's (workMeshes.js: wagon), its driver up on the seat, out along the
	roads (footpaths.js: THE ROADS; the riders' net of them, npcRiders.js: buildRoads) to another town's inn and back again, its goods in a
	strongbox at its tail (loot.js: cartChest) and as many horsemen riding with it as they are worth guarding (GUARDS: npcRiders.js,
	addEscort). Home again, its town is paid for the trip (PROFIT: by how far it went, and for what of its goods came back), and it sets out
	again after a rest with new goods, and new guards for any lost.
		WHICH		every town there is here with an inn, and another town it can get to by the roads within CART.farthest; at the most
					CART.most of them at once, those of the towns nearest the players
		ATTACKED	its driver, its horse or a guard shot at: all of them hostile to whoever fired (npcs.js: its group), and it stands while
					they fight. Its driver dead, it is lost: its goods are anyone's, and it is gone CART.lost seconds on, and its town sends
					another out in time
		ROBBED		anything taken out of its strongbox (loot.js: onTaken): its guards after whoever took it, and its town thinking the less of
					them by what it was worth (townOpinion.js: wrong, 'steal')
	IN A GAME the host runs them (their people and their horses are npcs.js's and horse.js's, shared as theirs are) and tells everyone where
	each wagon is (cartsIs, CART.tell times a second): a joiner draws it there, its strongbox with it.
	Metres and seconds; places in world units
*/
const CART = { pace: 2.2, rest: [40, 90], first: [5, 45], farthest: 9000, nearest: 250, most: 4, lost: 90, tell: 5, gap: 4 };
const GUARDS = { least: 2, most: 6, per: 60 };			// guards: 2, and one more for every $60 of goods over that, 6 at the most
const PROFIT = { base: 30, perKm: 8 };					// dollars a round trip earns its town (all of its goods back)
// what a cart carries ([type, chance, most]), rolled for each trip
const GOODS = [['money', 0.7, 3000], ['bread', 0.6, 4], ['sausage', 0.5, 4], ['smokedFish', 0.4, 3], ['beer', 0.4, 4], ['cookedVenison', 0.3, 3], ['nails', 0.4, 30],
	['ironBar', 0.35, 3], ['wheat', 0.4, 6], ['deerHide', 0.3, 3], ['wolfPelt', 0.15, 2], ['rifleRounds', 0.4, 20], ['shells', 0.35, 12], ['coltRounds', 0.35, 18],
	['bandage', 0.3, 3], ['alcohol', 0.3, 2], ['sewingKit', 0.15, 1], ['antibiotics', 0.1, 1]].filter(([type]) => ITEMS[type]);

const metre = () => settings.forestUnitsPerMetre;
export const cartStats = { carts: 0, trips: 0, paid: 0, robbed: 0, lost: 0 };
const carts = [];
export const cartsForTest = carts;
const worth = (item) => item.type == 'money' ? (item.count ?? 0) / 100 : (ITEMS[item.type]?.price ?? 1) * (item.count ?? 1);

// the inn of a town (a rider's home: npcRiders.js), or its first house: { x, z, heading, town }
function innOf(t) {
	const b = t.buildings?.find((one) => BUILDING_TYPES[one.type].name == 'inn') ?? t.buildings?.find((one) => !one.onPier);
	if (!b) return null;
	const out = b.depth / 2 + 6 * metre();
	return { x: b.x + Math.sin(b.yaw) * out, z: b.z + Math.cos(b.yaw) * out, heading: b.yaw, town: t };
}

// A CART (host): its route out by the roads, and the place along it it has come to
function makeCart(t, inn, other, route) {
	const lengths = [0];
	for (let i = 1; i < route.length; i++) lengths.push(lengths[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
	const group = npcs.makeGroup();
	group.town = treasury.townNumber(t);
	const cart = { id: 'cart' + group.town, t, k: group.town, inn, other, route, lengths, length: lengths[lengths.length - 1], s: 0, dir: 1, phase: 'home',
		wait: CART.first[0] + Math.random() * (CART.first[1] - CART.first[0]), speed: 0, heading: 0, pitch: 0, at: [route[0][0], 0, route[0][1]], spin: 0,
		horse: null, driver: null, group, chest: null, value: 0, lostFor: -1, guards: 0 };
	// (a guard's place round it: slot 0 ahead of the horse, 1 behind, then either side of it, then wider)
	const SPOTS = [[0, 9], [0, -7], [-3.2, 1], [3.2, 1], [-3.4, -4], [3.4, -4]];
	cart.guardSpot = (slot) => {
		const [u, w] = SPOTS[slot % SPOTS.length], m = metre(), fx = Math.sin(cart.heading), fz = Math.cos(cart.heading);
		return [cart.at[0] + (fx * w + fz * u) * m, cart.at[2] + (fz * w - fx * u) * m];
	};
	carts.push(cart);
	place(cart);
	cartStats.carts = carts.length;
	return cart;
}
// along its route: s (world units along it from its town) to where it is, and which way it faces (dir: 1 out, -1 back)
function pointAt(cart, s) {
	const { route, lengths } = cart;
	s = Math.min(Math.max(s, 0), cart.length);
	let i = 1;
	while (i < lengths.length - 1 && lengths[i] < s) i++;
	const t = (s - lengths[i - 1]) / Math.max(lengths[i] - lengths[i - 1], 1e-6);
	return [route[i - 1][0] + (route[i][0] - route[i - 1][0]) * t, route[i - 1][1] + (route[i][1] - route[i - 1][1]) * t];
}
// (the ground under a place: a tunnel's floor, a bridge's deck: tunnels.js)
const groundAt = (x, z, y = Infinity) => tunnels.floorAt(x, z, y) ?? terrain.land.groundAt(x, z);
function place(cart) {
	const m = metre(), [x, z] = pointAt(cart, cart.s), ahead = pointAt(cart, cart.s + cart.dir * 3 * m), behind = pointAt(cart, cart.s - cart.dir * 3 * m);
	const want = Math.atan2(ahead[0] - behind[0], ahead[1] - behind[1]);
	cart.heading += npcs.wrap(want - cart.heading) * (cart.placed ? 0.15 : 1);
	cart.placed = true;
	const fx = Math.sin(cart.heading), fz = Math.cos(cart.heading), y = groundAt(x, z, cart.at[1] + 2 * m);
	const front = groundAt(x + fx * WAGON.front.z * m, z + fz * WAGON.front.z * m, y + 2 * m), rear = groundAt(x + fx * WAGON.rear.z * m, z + fz * WAGON.rear.z * m, y + 2 * m);
	cart.pitch = Math.atan2(front - rear, (WAGON.front.z - WAGON.rear.z) * m);
	cart.at = [x, (front + rear) / 2, z];
}
// a point on the wagon (metres, its own: x across, y up, z forward) in the world
function onWagon(cart, [u, v, w]) {
	const m = metre(), fx = Math.sin(cart.heading), fz = Math.cos(cart.heading), up = v + w * Math.sin(cart.pitch);
	return [cart.at[0] + (fx * w + fz * u) * m, cart.at[1] + up * m, cart.at[2] + (fz * w - fx * u) * m];
}

// LOADED for a trip (host): its goods into its strongbox, guards for them, a driver and a horse if it has none
function load(cart) {
	const items = [];
	for (const [type, chance, most] of GOODS) if (Math.random() < chance) items.push(makeItem(type, 1 + Math.floor(Math.random() * most)));
	cart.chest = loot.addCartChest(cart.id + ':box' + cartStats.trips, onWagon(cart, WAGON.chest), items).id;
	cart.value = loot.containerById(cart.chest).items.reduce((sum, item) => sum + worth(item), 0);
	if (!cart.driver?.alive) {
		if (cart.driver) npcs.removePerson(cart.driver);
		cart.driver = npcs.makePerson('carter', { hat: 'bowler', gun: 'shotgun', home: cart.inn, name: 'carter', group: cart.group });
	}
	if (!cart.horse?.exists) {
		const [hx, , hz] = onWagon(cart, [0, 0, WAGON.horse]);
		cart.horse = horse.spawnHorse(hx, hz, { heading: cart.heading, owner: 'npc', authority: 0, coat: Math.random() });
		npcs.announce('horse', cart.horse, null);
	}
	horse.setRider(cart.horse, cart.driver.id);
	const want = Math.min(GUARDS.most, GUARDS.least + Math.max(Math.floor((cart.value - GUARDS.per) / GUARDS.per), 0));
	const have = npcRiders.escortsOf(cart).length;
	for (let k = have; k < want; k++) npcRiders.addEscort(cart, k, cart.inn);
	cart.guards = want;
}
// home again (host): its town paid for what it brought back, its strongbox put away
function home(cart) {
	const box = loot.containerById(cart.chest), left = box ? box.items.reduce((sum, item) => sum + worth(item), 0) : 0;
	const share = cart.value > 0 ? Math.min(left / cart.value, 1) : 1, km = cart.length * 2 / metre() / 1000;
	const dollars = Math.round((PROFIT.base + PROFIT.perKm * km) * share);
	if (dollars > 0) treasury.pay(cart.t, dollars, 'A trading cart back');
	cartStats.trips++; cartStats.paid += dollars;
	if (cart.chest) loot.removeContainer(cart.chest);
	cart.chest = null;
}
function remove(cart) {
	npcRiders.removeEscorts(cart);
	if (cart.driver) npcs.removePerson(cart.driver);
	if (cart.horse?.exists && cart.horse.rider !== 'me') { horse.removeHorse(cart.horse); npcs.announce('horse', null, cart.horse); }
	if (cart.chest) loot.removeContainer(cart.chest);
	carts.splice(carts.indexOf(cart), 1);
	cartStats.carts = carts.length;
}

// ONE CART for dt seconds (host)
function stepCart(cart, dt) {
	const m = metre(), driver = cart.driver;
	if (cart.phase == 'lost') {
		cart.speed = 0;
		if ((cart.lostFor -= dt) <= 0) { const { t, inn, other, route } = cart; remove(cart); makeCart(t, inn, other, route); }
		return;
	}
	if (driver && !driver.alive) {
		// (its driver shot dead: lost, its goods anyone's)
		cart.phase = 'lost'; cart.lostFor = CART.lost; cartStats.lost++;
		npcRiders.removeEscorts(cart);
		if (cart.horse?.exists) horse.setRider(cart.horse, null);
		return;
	}
	const fighting = (driver?.fighting) || npcRiders.escortsOf(cart).some((r) => r.person.fighting) || [...cart.group.hostile.values()].some((until) => until > npcs.now());
	let want = 0;
	if (cart.phase == 'home' || cart.phase == 'there') {
		if ((cart.wait -= dt) <= 0) {
			if (cart.phase == 'home') { load(cart); cart.phase = 'out'; cart.dir = 1; }
			else { cart.phase = 'back'; cart.dir = -1; }
		}
	} else if (!fighting) {
		// (its guards fallen behind: it waits for them)
		const behind = npcRiders.escortsOf(cart).some((r) => Math.hypot(r.horse.x - cart.at[0], r.horse.z - cart.at[2]) > 30 * m);
		want = behind ? 0.6 : CART.pace * Math.max(settings.horseSpeed, 0.1);
	}
	cart.speed += Math.min(Math.max(want - cart.speed, -1.5 * dt), 0.6 * dt);
	if (cart.phase == 'out' || cart.phase == 'back') {
		cart.s += cart.dir * cart.speed * m * dt;
		if (cart.phase == 'out' && cart.s >= cart.length) { cart.s = cart.length; cart.phase = 'there'; cart.wait = CART.rest[0] + Math.random() * (CART.rest[1] - CART.rest[0]); }
		if (cart.phase == 'back' && cart.s <= 0) { cart.s = 0; cart.phase = 'home'; cart.wait = CART.rest[0] + Math.random() * (CART.rest[1] - CART.rest[0]); home(cart); }
	}
	place(cart);
	if (driver) {
		const [x, y, z] = onWagon(cart, WAGON.seat);
		driver.place = { x, y, z, heading: cart.heading, sit: 1 };
		driver.anchor = null;
	}
	if (cart.horse?.exists) {
		const [hx, , hz] = onWagon(cart, [0, 0, WAGON.horse]);
		Object.assign(cart.horse, { x: hx, z: hz, heading: cart.heading, speed: cart.speed, input: null, ground: null });
	}
}

// WHICH (see the top): the carts there should be on the land there is now (host)
let madeFor = null, madeVersion = -1;
function makeCarts() {
	const land = terrain.land;
	const roads = npcRiders.roadsFor(land);
	const m = metre(), players = [hunting.hunterPlace()];
	const towns = (land.towns ?? []).filter((t) => t.buildings?.length && !t.none).map((t) => ({ t, inn: innOf(t) })).filter((o) => o.inn);
	// (those of the towns nearest the players first)
	towns.sort((a, b) => Math.hypot(a.inn.x - players[0].x, a.inn.z - players[0].z) - Math.hypot(b.inn.x - players[0].x, b.inn.z - players[0].z));
	for (const cart of [...carts]) if (!towns.some((o) => o.t === cart.t) || !towns.some((o) => o.t === cart.other.t)) remove(cart);
	for (const { t, inn } of towns) {
		if (carts.length >= CART.most) break;
		if (carts.some((c) => c.t === t)) continue;
		// (to the nearest other town it can get to by the roads, not too near, not too far)
		let best = null;
		for (const o of towns) {
			if (o.t === t) continue;
			const d = Math.hypot(o.inn.x - inn.x, o.inn.z - inn.z);
			if (d < CART.nearest * m || d > CART.farthest * m || (best && d >= best.d)) continue;
			const a = roads.nearest(inn.x, inn.z), b = roads.nearest(o.inn.x, o.inn.z);
			const way = a >= 0 && b >= 0 ? townFolk.wayBetween(roads, a, b) : null;
			if (way && way.length > 1) best = { o, d, route: [[inn.x, inn.z], ...way.map((k) => [roads.nodes[k].x, roads.nodes[k].z]), [o.inn.x, o.inn.z]] };
		}
		if (best) makeCart(t, inn, best.o, best.route);
	}
}

// ROBBED (see the top)
loot.onTaken((c, item, who) => {
	if (c.kind != 'cartChest') return;
	const cart = carts.find((one) => one.chest === c.id);
	if (!cart || cart.phase == 'lost') return;
	cartStats.robbed++;
	npcs.provoke(cart.group, who);
	townOpinion.wrong(who, cart.k, 'steal', worth(item));
});
// (a hit on its horse: on its people, npcs.js)
npcs.addVehicleGroups((id) => carts.find((c) => c.horse?.id === id)?.group ?? null);

// WHERE THEY ARE, for a joiner (see IN A GAME at the top)
const seen = new Map();		// a joiner's: id -> { at, heading, pitch, speed, chest, spin, drawn }
survivalNet.on('cartsIs', (msg) => {
	if (survivalNet.authority()) return;
	const now = new Set();
	for (const [id, x, y, z, heading, pitch, speed, chest] of msg.list ?? []) {
		now.add(id);
		const was = seen.get(id);
		seen.set(id, { at: [x, y, z], heading, pitch, speed, chest, spin: was?.spin ?? 0, drawn: was?.drawn ?? [x, y, z], drawnHeading: was?.drawnHeading ?? heading });
	}
	for (const id of [...seen.keys()]) if (!now.has(id)) seen.delete(id);
});
let tellIn = 0;
export const cartsSeenForTest = () => [...seen.entries()].map(([id, c]) => ({ id, at: c.at, chest: c.chest }));

// DRAWN (every machine): the wagon, its four wheels turned as it rolls
function draw(at, heading, pitch, spin) {
	const m = metre(), fx = Math.sin(heading), fz = Math.cos(heading);
	props.show('wagon', props.place(at, heading, pitch));
	for (const axle of [WAGON.rear, WAGON.front]) for (const s of [-1, 1]) {
		const u = s * axle.x, w = axle.z, rise = w * Math.sin(pitch);
		const wheel = [at[0] + (fx * w + fz * u) * m, at[1] + (axle.r + rise) * m, at[2] + (fz * w - fx * u) * m];
		props.show('wagonWheel', props.place(wheel, heading, -spin * WAGON.rear.r / axle.r, 0, axle.r));
	}
}

// Per frame
export function cartsUpdate(dt) {
	if (!terrain.land || !inventory.survivalOn() || !npcs.on()) {	// (a war of the Survival mode's: they go on)
		if (carts.length && survivalNet.authority()) for (const cart of [...carts]) remove(cart);
		return;
	}
	if (survivalNet.authority()) {
		const version = terrain.land.paths.length;
		if (madeFor !== terrain.land || madeVersion !== version) { madeFor = terrain.land; madeVersion = version; makeCarts(); }
		for (const cart of [...carts]) stepCart(cart, dt);
		for (const cart of carts) {
			cart.spin += cart.dir * cart.speed * dt / WAGON.rear.r;
			draw(cart.at, cart.heading, cart.pitch, cart.spin);
			const box = cart.chest && loot.containerById(cart.chest);
			if (box) box.at = onWagon(cart, [WAGON.chest[0], WAGON.chest[1], WAGON.chest[2] - 0.4]);
		}
		if ((tellIn -= dt) <= 0 && survivalNet.role() == 'host') {
			tellIn = 1 / CART.tell;
			const r = (v) => Math.round(v * 100) / 100;
			survivalNet.send('cartsIs', { list: carts.map((c) => [c.id, r(c.at[0]), r(c.at[1]), r(c.at[2]), r(c.heading), r(c.pitch), r(c.speed * c.dir), c.chest]) });
		}
		return;
	}
	// (a joiner: each where the host last said, eased to it)
	for (const c of seen.values()) {
		const k = Math.min(dt * 6, 1);
		c.drawn = c.drawn.map((v, i) => v + (c.at[i] - v) * k);
		c.drawnHeading += npcs.wrap(c.heading - c.drawnHeading) * k;
		c.spin += c.speed * dt / WAGON.rear.r;
		draw(c.drawn, c.drawnHeading, c.pitch, c.spin);
		const box = c.chest && loot.containerById(c.chest);
		if (box) { const fx = Math.sin(c.drawnHeading), fz = Math.cos(c.drawnHeading), m = metre(), back = WAGON.chest[2] - 0.4; box.at = [c.drawn[0] + fx * back * m, c.drawn[1] + WAGON.chest[1] * m, c.drawn[2] + fz * back * m]; }
	}
}
