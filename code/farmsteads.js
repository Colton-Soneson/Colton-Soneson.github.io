import { settings } from './settings.js';
import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import * as props from './props.js'
import * as atmosphere from './atmosphere.js'
import * as survivalNet from './survivalNet.js'
import * as inventory from './inventory.js'
import * as npcs from './npcs.js'
import * as npcRiders from './npcRiders.js'
import * as townOpinion from './townOpinion.js'
import * as treasury from './treasury.js'
import { setGrassHoles } from './computeGrass.js'
import { seasonNow, SEASON_WINTER } from './weather.js'
import { ITEMS, makeItem } from './items.js'
import { BUILDING_TYPES } from './townLayout.js'
import { FARM_CABIN } from './workMeshes.js'

/*
	THE FARMS OF THE RIVER TOWNS (footpaths.js: THE FARMS plans where each is, with the land: terrain.land.farms): a cabin at its near end
	and PLOTS of wheat past it, sixteen of them, each PLOTS.w by PLOTS.d metres, and the farmer who works them (the Survival mode's).
		THE CROPS		each plot grows to ripe in GROW days from when it was sown (the farms.js beds' models: wheat1 to wheat4), hardly at all in
						the winter (WINTER times as fast). The farmer goes from plot to plot, and a ripe one he reaps (it is sown again). What the
						farm earns its town is the town's economy's (townEconomy.js: THE FARM)
		STOLEN			E at a ripe plot: its wheat (YIELD) into the player's bags, the plot sown again, and the town after them: POSSE horsemen
						out of its inn (npcRiders.js: addPosse), and its opinion of them the less by what it was worth (townOpinion.js: wrong)
	IN A GAME the host keeps the plots (when each was sown) and runs the farmer: a joiner asks to take a plot's wheat (farmTake: farmGot
	back), and everyone is told when a plot is sown (farmSown), a joiner come in of every farm's. Metres and days; places in world units
*/
const PLOTS = { cols: 4, rows: 4, w: 3, d: 4, gap: 0.6, from: -6.5 };	// metres, across and along the farm, the first row this far along it
const CABIN = [-4, -11];				// metres: the cabin's middle on the farm (its door to the town: -z)
const GROW = 3, WINTER = 0.25;			// days to ripe, and as fast in the winter
const YIELD = 4;						// wheat from a plot
const POSSE = 5;
const REACH = 2.6;						// metres
const DRAW = 450;						// metres
const FARMER = { pace: 1.2, rest: [4, 10], reap: 4 };	// metres a second, seconds

const metre = () => settings.forestUnitsPerMetre;
const day = () => atmosphere.sunCycles;
export const farmStats = { farms: 0, reaped: 0, stolen: 0, posses: 0 };
const farms = new Map();				// key -> { key, plan, t, k, plots: [sown], farmer, walk }
export const farmsForTest = farms;
export const plotInViewForTest = () => { const v = plotInView(); return v && { i: v.i, ripe: ripe(v.f.plots[v.i]) }; };

// a place on a farm (metres: across, along it from its middle) in the world, on its ground
function onFarm(f, u, w) {
	const m = metre(), a = f.plan.yaw, x = f.plan.x + (Math.cos(a) * u + Math.sin(a) * w) * m, z = f.plan.z + (-Math.sin(a) * u + Math.cos(a) * w) * m;
	return [x, terrain.land.groundAt(x, z), z];
}
const plotAt = (i) => { const c = i % PLOTS.cols, r = Math.floor(i / PLOTS.cols); return [(c - (PLOTS.cols - 1) / 2) * (PLOTS.w + PLOTS.gap), PLOTS.from + PLOTS.d / 2 + r * (PLOTS.d + PLOTS.gap)]; };
const grownOf = (sown) => Math.min(Math.max((day() - sown) / GROW * (seasonNow.index == SEASON_WINTER ? WINTER : 1), 0), 1);
const ripe = (sown) => grownOf(sown) >= 1;
const townOfPlan = (plan) => terrain.world ? terrain.land.towns.find((t) => t.tile == plan.tile && t.k == plan.town) : terrain.land.towns[plan.town];
function innOf(t) {
	const b = t.buildings?.find((one) => BUILDING_TYPES[one.type].name == 'inn') ?? t.buildings?.find((one) => !one.onPier);
	if (!b) return null;
	const out = b.depth / 2 + 6 * metre();
	return { x: b.x + Math.sin(b.yaw) * out, z: b.z + Math.cos(b.yaw) * out, heading: b.yaw, town: t };
}

// THE FARMS THERE ARE, as the land comes and goes
function farmsNow() {
	const plans = terrain.land?.farms ?? [];
	const keys = new Set();
	for (const plan of plans) {
		const key = (plan.tile ?? 'land') + ':' + Math.round(plan.x) + ',' + Math.round(plan.z);
		keys.add(key);
		if (farms.has(key)) continue;
		const t = townOfPlan(plan);
		if (!t) continue;
		// (sown at different times, so they ripen one after another: the same on every machine until the host says)
		const plots = Array.from({ length: PLOTS.cols * PLOTS.rows }, (_, i) => Math.floor(day()) - ((Math.sin(i * 12.9898 + plan.x * 0.013) * 43758.5453) % 1 + 1) % 1 * GROW);
		farms.set(key, { key, plan, t, k: treasury.townNumber(t), plots, farmer: null, walk: null });
	}
	for (const [key, f] of [...farms]) if (!keys.has(key)) { if (f.farmer) npcs.removePerson(f.farmer); farms.delete(key); }
	farmStats.farms = farms.size;
	holes();
}
terrain.onTiles(() => farmsNow());
let madeFor = null;
// (no grass on the plots, nor under the cabin)
function holes() {
	const list = [];
	for (const f of farms.values()) {
		for (let i = 0; i < f.plots.length; i++) { const [u, w] = plotAt(i), [x, , z] = onFarm(f, u, w); list.push([x, z, 2.2 * metre(), 2.2 * metre()]); }
		const [x, , z] = onFarm(f, ...CABIN); list.push([x, z, 3 * metre(), 3 * metre()]);
	}
	setGrassHoles('farmsteads', list);
}
// the cabin's walls in the walker's way (hunting.js: addStill): small squares along them, a gap at the door
hunting.addStill((x, z, reach, add) => {
	const m = metre();
	for (const f of farms.values()) {
		const [cx, cy, cz] = onFarm(f, ...CABIN);
		if (Math.hypot(cx - x, cz - z) > reach + 8 * m) continue;
		const X = FARM_CABIN.w / 2, Z = FARM_CABIN.d / 2, a = f.plan.yaw + Math.PI;
		const at = (u, w) => add(cx + (Math.cos(a) * u + Math.sin(a) * w) * m, cz + (-Math.sin(a) * u + Math.cos(a) * w) * m, 0.2 * m, cy - m, cy + FARM_CABIN.h * m);
		for (let u = -X; u <= X + 0.01; u += 0.35) { at(u, -Z); if (Math.abs(u) > FARM_CABIN.door + 0.2) at(u, Z); }
		for (let w = -Z; w <= Z + 0.01; w += 0.35) { at(-X, w); at(X, w); }
	}
});

// THE PLOT LOOKED AT, near enough: { f, i } or null
function plotInView() {
	if (!inventory.survivalOn()) return null;
	const p = hunting.hunterPlace(), m = metre(), look = [Math.sin(settings.camYaw), -Math.cos(settings.camYaw)];
	if (!p.active || p.on != 'land') return null;
	let best = null, bestD = REACH + 2;
	for (const f of farms.values()) {
		if (Math.hypot(f.plan.x - p.x, f.plan.z - p.z) > 30 * m) continue;
		for (let i = 0; i < f.plots.length; i++) {
			const [x, , z] = onFarm(f, ...plotAt(i)), dx = (x - p.x) / m, dz = (z - p.z) / m, d = Math.hypot(dx, dz);
			if (d < bestD && (d < 1.6 || (dx * look[0] + dz * look[1]) / d > 0.6)) { best = { f, i }; bestD = d; }
		}
	}
	return best;
}
hunting.addPrompt(() => { const s = plotInView(); if (!s) return null; const g = grownOf(s.f.plots[s.i]); return g >= 1 ? { name: 'Wheat, ripe (the farm\'s)', keys: 'E take it' } : { name: `Wheat, ${Math.round(g * 100)}% grown${seasonNow.index == SEASON_WINTER ? ' (hardly growing: it is winter)' : ''}` }; });
hunting.onUse(() => {
	const s = plotInView();
	if (!s || !ripe(s.f.plots[s.i])) return false;
	if (survivalNet.authority()) got(take(s.f.key, s.i, 'me'));
	else survivalNet.send('farmTake', { key: s.f.key, i: s.i });
	return true;
});
// (the host's) a plot's wheat taken by who: sown again, and the town after them. How many it gave
function take(key, i, who) {
	const f = farms.get(key);
	if (!f || !ripe(f.plots[i])) return 0;
	sow(f, i);
	farmStats.stolen++;
	const inn = innOf(f.t);
	if (inn && npcRiders.posseFor(who).length == 0) { npcRiders.addPosse(inn, f.k, who, POSSE); farmStats.posses++; }
	townOpinion.wrong(who, f.k, 'steal', YIELD * (ITEMS.wheat?.price ?? 1));
	return YIELD;
}
function got(count) {
	if (!count) return;
	for (let n = 0; n < count; n++) inventory.give(makeItem('wheat'));
	help.toast(`${count} wheat taken: the farm's town has sent its horsemen after you`, 3);
}
survivalNet.on('farmTake', (m, from) => { if (survivalNet.authority()) survivalNet.sendTo(from, 'farmGot', { count: take(String(m.key), Number(m.i), from) }); });
survivalNet.on('farmGot', (m) => got(Number(m.count) || 0));
// a plot sown (the host's: everyone told)
function sow(f, i) { f.plots[i] = day(); survivalNet.send('farmSown', { key: f.key, plots: f.plots }); }
survivalNet.on('farmSown', (m) => { const f = farms.get(String(m.key)); if (f && !survivalNet.authority() && Array.isArray(m.plots)) f.plots = m.plots.map(Number); });
survivalNet.onJoin((id) => { for (const f of farms.values()) survivalNet.sendTo(id, 'farmSown', { key: f.key, plots: f.plots }); });

// THE FARMER (the host's): from plot to plot, reaping the ripe
function stepFarmer(f, dt) {
	const m = metre();
	if (!f.farmer) {
		f.farmer = npcs.makePerson('farmer', { hat: 'boater', gun: 'shotgun', home: null, name: 'farmer' });
		f.farmer.group.town = f.k;
		const [x, y, z] = onFarm(f, CABIN[0] + 2.5, CABIN[1] + 1);
		f.farmer.place = { x, y, z, heading: f.plan.yaw, sit: 0 };
		f.walk = { to: null, rest: 2 };
	}
	const p = f.farmer, w = f.walk;
	if (!p.alive) return;
	if (w.rest > 0) { w.rest -= dt; p.walking = 0; return; }
	if (w.to === null) {
		const ripeOnes = f.plots.map((s, i) => [s, i]).filter(([s]) => ripe(s)).map(([, i]) => i);
		w.to = ripeOnes.length ? ripeOnes[Math.floor(Math.random() * ripeOnes.length)] : Math.floor(Math.random() * f.plots.length);
	}
	const [u, v] = plotAt(w.to), [tx, , tz] = onFarm(f, u - PLOTS.w / 2 - 0.3, v);
	const dx = tx - p.place.x, dz = tz - p.place.z, d = Math.hypot(dx, dz);
	if (d < 0.3 * m) {
		if (ripe(f.plots[w.to])) { sow(f, w.to); farmStats.reaped++; }
		w.to = null;
		w.rest = FARMER.rest[0] + Math.random() * (FARMER.rest[1] - FARMER.rest[0]) + (ripe(f.plots[w.to ?? 0]) ? FARMER.reap : 0);
		p.walking = 0;
		return;
	}
	const step = Math.min(FARMER.pace * m * dt, d), x = p.place.x + dx / d * step, z = p.place.z + dz / d * step;
	p.place = { x, y: terrain.land.groundAt(x, z), z, heading: Math.atan2(dx, dz), sit: 0 };
	p.walking = 1;
	p.stride = ((p.stride ?? 0) + dt * FARMER.pace * 1.6) % 1000;
}

// Per frame
export function farmsteadsUpdate(dt) {
	if (!terrain.land) return;
	if (madeFor !== terrain.land) { madeFor = terrain.land; for (const f of farms.values()) if (f.farmer) npcs.removePerson(f.farmer); farms.clear(); farmsNow(); }
	const on = inventory.survivalOn();
	const m = metre(), eye = [settings.camPosX, settings.camPosZ];
	for (const f of farms.values()) {
		if (on && survivalNet.authority() && npcs.on()) stepFarmer(f, dt);
		else if (f.farmer && survivalNet.authority()) { npcs.removePerson(f.farmer); f.farmer = null; }
		if (Math.hypot(f.plan.x - eye[0], f.plan.z - eye[1]) > DRAW * m) continue;
		// (the cabin, its door to the town; the plots, each its bed and its wheat as grown as it is)
		props.show('farmCabin', props.place(onFarm(f, ...CABIN), f.plan.yaw + Math.PI));
		for (let i = 0; i < f.plots.length; i++) {
			const at = onFarm(f, ...plotAt(i)), model = props.place(at, f.plan.yaw), sx = PLOTS.w / 2.1, sz = PLOTS.d / 2.1;
			props.show('farmBed', props.stretched(model, sx, 1, sz));
			const g = grownOf(f.plots[i]);
			if (g > 0.02) props.show(['wheat1', 'wheat2', 'wheat3', 'wheat4'][Math.min(Math.floor(g * 4), 3)], props.stretched(model, sx, 1, sz));
		}
	}
}
