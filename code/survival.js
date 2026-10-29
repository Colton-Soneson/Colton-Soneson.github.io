import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as hunting from './hunting.js'
import * as players from './players.js'
import * as weapons from './weapons.js'
import * as ballistics from './ballistics.js'
import * as help from './controlsHelp.js'
import * as radialMenu from './radialMenu.js'
import * as survivalNet from './survivalNet.js'
import * as atmosphere from './atmosphere.js'
import { weatherNow, seasonNow } from './weather.js'
import { ITEMS, HANDS, HAND_NAMES } from './items.js'
import * as inventory from './inventory.js'
import * as outfits from './outfits.js'

/*
	THE SURVIVAL game mode (settings.gameMode 'Hunting': the menu calls it Survival): what the walker needs, and what it costs it not to have
	it. Each need goes from 0 (none) to 100 (as bad as it gets); the temperature from -100 (freezing) through 0 (comfortable) to 100
	(overheating). NEEDS says how fast each grows.
		hunger		grows all the time (faster running, and in the cold). Bread and sausage (items.js: food) take it away
		thirst		grows all the time (faster running, and in the heat). Water and beer (drink), or E at a lake's edge: a drink (DRINK)
		tiredness	grows all the time (faster running). Sleeping on a bedroll laid out (bedrolls.js: SLEEP) takes it away; beer adds a little
		stress		comes in jolts: shot near (a round past within NEAR_MISS), hurt, the horde close. It ebbs away once it has been calm a
					while (CALM), faster by a campfire; beer takes it down
		temperature	the body warmed or chilled towards what it FEELS LIKE: the air (the season, the time of day, the weather, how high up, the
					wind) and the clothes worn (inventory.js: wornStats, their insulation), less for being wet (the rain through what is not
					waterproof, the water swum in, and SWEAT: running, or too warm, through what does not let it out), more by a campfire
					(survivalTools.js: fireWarmth). Comfortable in COMFORT
		the load	everything carried and worn (inventory.js: wornStats, load) against what the clothes let it carry (capacity): over it, the
					walker is slower (OVERLOAD) and tires faster
		armour		what the clothes come to is told to the damage (outfits.js: setArmour): a share of every hit stopped
	WHAT IT COSTS: past half way, each slows the walker (pace), shakes the aim (the view sways: SHAKE), and the worst of them blurs the
	eyes; at the end of any of them, health goes (STARVE a second: players.hurtSelf, so in a game the host takes it off). Down, it all
	starts again, and what was carried is left on the body (loot.js), the walker back with the start kit.
	GOD MODE (the host's, or alone: settings.survivalGodMode): every equippable in the game on T, and the vehicles and the magic as they were.
	Otherwise T has only what is in the hands (inventory.js: the equippables) and the map.
	THE START: in the summer (settings.seasonStart), in the morning, the first weather of the day sunny (weather.js), and going round as ever
	after.
*/
const NEEDS = { hunger: 100 / (45 * 60), thirst: 100 / (30 * 60), tired: 100 / (60 * 60) };	// a second, before what makes them faster
const RUNNING = 1.6;
const COMFORT = [14, 28];					// °C it feels like, comfortable between
const CHILL = 0.07, HEAT = 0.06, RECOVER = 0.6;	// the temperature a second, for every °C out of comfort, and back to 0
const NEAR_MISS = 3;						// metres
const STRESS = { nearMiss: 7, hurt: 14, horde: 3, calm: 15, ebb: 1.4, fire: 2.5 };	// jolts, a second, seconds before it ebbs, a second
const SLEEP = { rate: 100 / 40, most: 600, slow: 0.5, slowFire: 0.3 };	// tiredness a second asleep; seconds at the most; how fast the needs come on asleep on a bedroll, and by a fire
const DRY = { air: 0.008, fire: 0.002 };
const SWEAT = { run: 0.012, heat: 0.0015, from: 24, most: 0.6 };	// wetness a second running, and for every °C it feels like over from; no wetter than most
const OVERLOAD = { pace: 0.6, least: 0.45 };	// pace lost for every share over what can be carried, and the slowest		// wetness a second dried in the air, and more for every °C of a fire's warmth
const DRINK = 30;
const STARVE = 0.25;						// health a second, at the end of any of them
const SHAKE = 0.012;						// radians, the most the view sways
const SEASON_AIR = [13, 23, 10, -3];		// °C: spring, summer, fall, winter

export const status = { hunger: 10, thirst: 10, tired: 10, stress: 0, temperature: 0, feels: 20, wet: 0, asleep: 0 };
export const survivalStats = { drinks: 0, eaten: 0, slept: 0, bodies: 0 };
const on = () => inventory.survivalOn() && hunting.hunterPlace().active;
export const godMode = () => !!settings.survivalGodMode && survivalNet.role() != 'joined';
inventory.setGodMode(godMode);

// what is told when the walker is near something that warms or calms (survivalTools.js: the campfires): fn(x, y, z) gives { warmth, calm }
const fireSources = [];
export function setFireNear(fn) { fireSources.push(fn); }
function fireNear(x, y, z) {
	let warmth = 0, calm = 0;
	for (const fn of fireSources) { const f = fn(x, y, z); warmth = Math.max(warmth, f.warmth); calm = Math.max(calm, f.calm); }
	return { warmth, calm };
}
// a roof over the walker (camp.js: the tents): fn(x, y, z) true. Under one the rain and the snow keep off, and the wind mostly
let shelterAt = () => false;
export function setShelter(fn) { shelterAt = fn; }

// EATEN, DRUNK, SLEPT (what the item does: items.js)
export function consume(type) {
	const it = ITEMS[type];
	if (!it) return false;
	if (it.food) { status.hunger = Math.max(status.hunger - it.food, 0); survivalStats.eaten++; }
	if (it.drink) status.thirst = Math.min(Math.max(status.thirst - it.drink, 0), 100);
	if (it.stress) status.stress = Math.max(status.stress + it.stress, 0);
	if (it.tired) status.tired = Math.min(status.tired + it.tired, 100);
	return true;
}
export function sleep() {
	if (!hunting.hunterPlace().grounded || hunting.hunterPlace().swimming) { help.toast('Lie down on firm ground to sleep'); return false; }
	status.asleep = SLEEP.most;
	survivalStats.slept++;
	return true;
}
// woken: by being hurt, or a key
const wake = () => { if (status.asleep > 0) { status.asleep = 0; help.toast('Awake'); } };
window.addEventListener('keydown', (e) => { if (status.asleep > 0 && ['KeyE', 'Space', 'Escape', 'KeyW'].includes(e.code)) wake(); });

// STRESS: a round past near (not this player's own)
ballistics.onPass((ax, ay, az, bx, by, bz, bullet) => {
	if (!on() || !bullet.remote && !bullet.npc) return;
	const me = hunting.hunterPlace(), m = settings.forestUnitsPerMetre, y = me.y + 1.5 * m;
	const d = [bx - ax, by - ay, bz - az], L = Math.hypot(...d) || 1;
	const t = Math.min(Math.max(((me.x - ax) * d[0] + (y - ay) * d[1] + (me.z - az) * d[2]) / (L * L), 0), 1);
	const off = Math.hypot(ax + d[0] * t - me.x, ay + d[1] * t - y, az + d[2] * t - me.z) / m;
	if (off < NEAR_MISS) { status.stress = Math.min(status.stress + STRESS.nearMiss, 100); calmFor = 0; }
});
let calmFor = 0;

// E at a lake's edge: a drink
hunting.onUse((place) => {
	if (!on() || place.on != 'land') return false;
	const land = terrain.land, m = settings.forestUnitsPerMetre;
	const look = [Math.sin(settings.camYaw), -Math.cos(settings.camYaw)];
	for (const ahead of [0.6, 1.2, 2]) {
		const x = place.x + look[0] * ahead * m, z = place.z + look[1] * ahead * m;
		if (land.heightAt(x, z) < settings.waterWorldPosY + 0.05 * m && Math.abs(place.y - settings.waterWorldPosY) < 1.5 * m) {
			if (land.zoneAt(x, z) != terrain.ZONE_LAKE) { help.toast('Salt water: not to drink'); return true; }
			status.thirst = Math.max(status.thirst - DRINK, 0);
			survivalStats.drinks++;
			help.toast('A drink from the lake');
			return true;
		}
	}
	return false;
});
hunting.addPrompt(() => {
	if (!on() || hunting.hunterPlace().on != 'land') return null;
	const p = hunting.hunterPlace(), land = terrain.land, m = settings.forestUnitsPerMetre;
	const x = p.x + Math.sin(settings.camYaw) * 1.2 * m, z = p.z - Math.cos(settings.camYaw) * 1.2 * m;
	return land.heightAt(x, z) < settings.waterWorldPosY && land.zoneAt(x, z) == terrain.ZONE_LAKE && settings.camPitch < -0.25 ? { name: 'Lake water', keys: 'E drink' } : null;
});

// WHAT IT FEELS LIKE (see the top): °C
export function airTemperature() {
	const sunUp = Math.max(Math.min(settings.sunPosY / 50, 1), -1);
	const day = sunUp > 0 ? 4 * sunUp : 6 * sunUp;
	const storm = weatherNow.rain > 0.5 || weatherNow.snow > 0.5 ? 5 : 0;
	const p = hunting.hunterPlace(), up = Math.max((p.y - settings.waterWorldPosY) / settings.forestUnitsPerMetre, 0);
	return SEASON_AIR[seasonNow.index] + day - weatherNow.gloom * 4 - storm - up * 0.0065 - (weatherNow.snow > 0 ? 3 : 0);
}
function feelsLike(wornWarmth, waterproof, fire) {
	const wind = settings.waterWindSpeed * (1 + (weatherNow.rain + weatherNow.snow) * 0.8);
	return airTemperature() + wornWarmth - status.wet * 9 - wind * 0.35 * (1 - Math.min(waterproof, 0.6)) + fire;
}

// The hours (for the watch): the sun's angle, 0 at six in the morning
export const hoursNow = () => (6 + settings.sunCycleAngle / (Math.PI * 2) * 24) % 24;
export function clockText() {
	const h = hoursNow(), hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
	return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// Once a frame
//-------------------------------------------------
let lastTime = performance.now(), wasAlive = true, starving = 0, lastHealth = players.HEALTH, wobble = 0;
export function survivalUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	inventory.inventoryUpdate(dt);
	if (!on()) { nightOff(); hunting.effects.pace = 1; hunting.effects.frozen = false; outfits.setArmour('me', 0); shown(false); return; }
	const p = hunting.hunterPlace(), life = players.localLife();
	// down: what was carried left on the body; up again: the start kit, and fresh
	if (wasAlive && !life.alive) { bodyListeners.forEach((fn) => fn([p.x, p.y, p.z], inventory.takeAll())); survivalStats.bodies++; }
	if (!wasAlive && life.alive) { inventory.startKit(); Object.assign(status, { hunger: 10, thirst: 10, tired: 10, stress: 0, temperature: 0, wet: 0, asleep: 0 }); }
	wasAlive = life.alive;
	if (!life.alive) { shown(true); return; }
	// hurt: woken, and stressed
	if (life.health < lastHealth - 0.5) { wake(); status.stress = Math.min(status.stress + STRESS.hurt, 100); calmFor = 0; }
	lastHealth = life.health;

	const moving = Math.hypot(p.vx ?? 0, p.vz ?? 0) / settings.forestUnitsPerMetre;
	// (the clock stopped in the settings: the night slept away moves it on all the same)
	if (nightPhase.on && !settings.atmosphereSunRotationDemo) atmosphere.sunCycle(2 * Math.PI * dt * settings.timeCycleMultiplier * nightPhase.factor / Math.max(settings.dayLengthSeconds, 1));
	needs(dt * atmosphere.timeBoost.factor, p, moving > settings.huntingWalkSpeed * 1.3 ? RUNNING : 1);		// (as fast as the clock: the night slept away)
	nightWatch(dt);

	// WHAT IT COSTS (see the top)
	const bad = (v, from) => Math.max((v - from) / (100 - from), 0);
	const worn = inventory.wornStats(), over = Math.max(worn.load / worn.capacity - 1, 0);
	outfits.setArmour('me', worn.armour);
	hunting.effects.pace = (1 - 0.18 * bad(status.hunger, 60)) * (1 - 0.25 * bad(status.thirst, 60)) * (1 - 0.25 * bad(status.tired, 60)) * (1 - 0.2 * bad(-status.temperature, 50))
		* Math.max(1 - over * OVERLOAD.pace, OVERLOAD.least);
	hunting.effects.frozen = status.asleep > 0;
	const shake = Math.max(bad(status.tired, 50), bad(status.stress, 40), bad(-status.temperature, 40), bad(status.hunger, 75));
	if (shake > 0 && status.asleep <= 0) {
		wobble += dt;
		const dy = Math.sin(wobble * 1.3) * Math.cos(wobble * 0.7), dp = Math.sin(wobble * 1.9 + 1);
		settings.camYaw += (dy * SHAKE * shake - lastWobble[0]);
		settings.camPitch += (dp * SHAKE * 0.6 * shake - lastWobble[1]);
		lastWobble = [dy * SHAKE * shake, dp * SHAKE * 0.6 * shake];
	} else lastWobble = [0, 0];
	shown(true);
}
let lastWobble = [0, 0];
// THE NEEDS for dt seconds (each frame, as fast as the clock runs: the night slept away too), run: how much faster running makes them
function needs(dt, p, run = 1) {
	const worn = inventory.wornStats(), fire = fireNear(p.x, p.y, p.z);
	// asleep on a bedroll they come on more slowly, by a fire more slowly still (SLEEP.slow)
	const slow = status.asleep > 0 ? (fire.warmth > 0 ? SLEEP.slowFire : SLEEP.slow) : 1;
	// wet: in the water at once, in the rain through what is not waterproof; dried in the air, faster by a fire
	const roof = shelterAt(p.x, p.y, p.z);
	if (p.swimming) status.wet = 1;
	else {
		const sweating = status.wet < SWEAT.most ? ((run > 1 ? SWEAT.run : 0) + Math.max(status.feels - SWEAT.from, 0) * SWEAT.heat) * (1 - worn.sweat) : 0;
		status.wet = Math.min(Math.max(status.wet + ((roof ? 0 : weatherNow.rain + weatherNow.snow * 0.5) * (1 - worn.waterproof) * 0.02 + sweating - DRY.air - fire.warmth * DRY.fire) * dt, 0), 1);
	}
	status.feels = feelsLike(worn.warmth, roof ? 0.9 : worn.waterproof, fire.warmth + (roof ? 2 : 0));
	const below = COMFORT[0] - status.feels, above = status.feels - COMFORT[1];
	if (below > 0) status.temperature = Math.max(status.temperature - below * CHILL * slow * dt, -100);
	else if (above > 0) status.temperature = Math.min(status.temperature + above * HEAT * slow * dt, 100);
	else status.temperature += -Math.sign(status.temperature) * Math.min(Math.abs(status.temperature), RECOVER * dt);
	const cold = status.temperature < -40 ? 1.3 : 1, hot = status.temperature > 40 ? 1.5 : 1;
	status.hunger = Math.min(status.hunger + NEEDS.hunger * run * cold * slow * dt, 100);
	status.thirst = Math.min(status.thirst + NEEDS.thirst * run * hot * slow * dt, 100);
	if (status.asleep > 0) {
		status.asleep -= dt;
		status.tired = Math.max(status.tired - SLEEP.rate * dt, 0);
	} else status.tired = Math.min(status.tired + NEEDS.tired * (run > 1 ? 1.5 : 1) * (1 + Math.max(worn.load / worn.capacity - 1, 0)) * dt, 100);
	// stress: the horde close jolts it; calm a while, it ebbs (faster by a fire)
	if (hordeNear(p)) { status.stress = Math.min(status.stress + STRESS.horde * dt, 100); calmFor = 0; }
	calmFor += dt;
	if (calmFor > STRESS.calm || fire.calm > 0) status.stress = Math.max(status.stress - (STRESS.ebb + fire.calm * STRESS.fire) * dt, 0);
	// at the end of any of them: health goes
	const worst = [status.hunger, status.thirst, Math.abs(status.temperature)].find((v) => v >= 100);
	if (worst !== undefined) {
		starving += STARVE * dt;
		if (starving >= 1) {
			const how = status.hunger >= 100 ? 'Starved' : status.thirst >= 100 ? 'Died of thirst' : status.temperature <= -100 ? 'Froze to death' : 'Died of the heat';
			players.hurtSelf(Math.floor(starving), how);
			starving -= Math.floor(starving);
		}
	}
}

/*
	THE NIGHT SLEPT AWAY: once everyone in the game who is up and about (alive, in the Survival mode) is asleep, for NIGHT.wait seconds, the
	host runs the world's clock fast (atmosphere.js: timeBoost: the sun, the seasons, the weather, the forest and the fires go with it), so
	that NIGHT.hours (a third of a day) go by in NIGHT.seconds, and tells everyone (nightPhase): each one's needs come on as fast as the
	clock goes (asleep, so slowly). Once the hours are past, everyone wakes. If anyone gets up first, the clock goes back to its own pace
	there and then, and the night is that much shorter; if they all lie down again before it is over, the night goes on to the same end
	(until). Alone, this player is everyone. A joiner says when it goes to sleep and wakes (sleeping)
*/
const NIGHT = { wait: 2.5, hours: 8, seconds: 10 };
const sleepers = new Map();		// the host: joiner -> asleep
let allAsleepFor = 0, saidAsleep = false;
export const nightStats = { nights: 0 };
export const nightPhase = { on: false, factor: 1, until: 0 };
survivalNet.on('sleeping', (m, from) => sleepers.set(from, !!m.on));
survivalNet.on('nightPhase', (m) => { if (survivalNet.role() != 'joined') return; setNightPhase(!!m.on, Number(m.factor) || 1, Number(m.until) || 0); if (m.done) morning(); });
function setNightPhase(on, factor = 1, until = nightPhase.until) {
	Object.assign(nightPhase, { on, factor: on ? Math.max(factor, 1) : 1, until });
	atmosphere.timeBoost.factor = nightPhase.factor;
}
// the night over: everyone up, rested
function morning() {
	nightStats.nights++;
	if (status.asleep > 0) { status.asleep = 0; status.tired = Math.min(status.tired, 5); help.toast('Morning: the night has passed', 3); }
}
function nightWatch(dt) {
	const asleep = status.asleep > 0;
	if (asleep != saidAsleep) { saidAsleep = asleep; if (survivalNet.role() == 'joined') survivalNet.send('sleeping', { on: asleep }); }
	if (!survivalNet.authority()) return;
	const others = players.otherList().filter((o) => o.view?.alive && o.view?.hunting);
	const everyone = asleep && others.every((o) => sleepers.get(o.id));
	if (nightPhase.on) {
		const done = atmosphere.sunCycles >= nightPhase.until;
		if (everyone && !done) return;
		setNightPhase(false);
		survivalNet.send('nightPhase', { on: false, done });
		if (done) morning();
		return;
	}
	if (!everyone) { allAsleepFor = 0; return; }
	if ((allAsleepFor += dt) < NIGHT.wait) return;
	allAsleepFor = 0;
	if (!(nightPhase.until > atmosphere.sunCycles)) nightPhase.until = atmosphere.sunCycles + NIGHT.hours / 24;
	const factor = NIGHT.hours / 24 * Math.max(settings.dayLengthSeconds, 1) / (NIGHT.seconds * Math.max(settings.timeCycleMultiplier, 0.01));
	setNightPhase(true, factor, nightPhase.until);
	survivalNet.send('nightPhase', { on: true, factor, until: nightPhase.until });
}
// (not in the Survival mode, or down: the clock at its own pace)
function nightOff() { if (nightPhase.on && survivalNet.authority()) { setNightPhase(false); survivalNet.send('nightPhase', { on: false, done: false }); } }
// the horde close (horde.js tells, setHordeNear): fn(place) true
let hordeNear = () => false;
export function setHordeNear(fn) { hordeNear = fn; }
// down: told where, and what was carried (loot.js leaves it there)
const bodyListeners = [];
export function onBody(fn) { bodyListeners.push(fn); }

// T: in the Survival mode only the hands' (and the map), but in god mode (see the top). The map's own place is the map's (survivalMap.js)
let mapChoice = null, everything = () => [];
export function setMapChoice(choice) { mapChoice = choice; }
export function setEveryEquippable(fn) { everything = fn; }
let holdItem = null, watchChoice = null;
export function setHoldItem(fn) { holdItem = fn; }
export function setWatchChoice(choice) { watchChoice = choice; }
radialMenu.setRootSource((root) => {
	if (!inventory.survivalOn()) return root;
	if (godMode()) return { label: 'God mode', items: [{ label: 'Items', detail: 'Every equippable in the game', items: everything() }, ...root.items, ...(mapChoice ? [mapChoice] : [])] };
	const items = HANDS.filter((h) => inventory.inv.hands[h]).map((h) => {
		const item = inventory.inv.hands[h], it = ITEMS[item.type];
		return { label: it.name, detail: HAND_NAMES[h] + (item.count > 1 ? ` · ${item.count}` : ''), act: () => holdItem?.(item) ?? false };
	});
	if (watchChoice && inventory.inv.worn.wrist?.type == 'watch') items.push(watchChoice);
	items.push({ label: 'Empty hands', detail: 'Put away what you hold', act: () => { weapons.equipWeapon('none'); return true; } });
	if (mapChoice) items.push(mapChoice);
	return { label: 'Equipped', items };
});

// THE NEEDS SHOWN (as the health is, bottom left: players.js), each a bar, and the load once it is near what can be carried; and the eyes blurred and dark
const box = document.createElement('div');
box.style.cssText = 'position: fixed; left: 232px; bottom: 16px; width: 200px; padding: 8px 10px; border-radius: 6px; background: rgba(0, 0, 0, 0.55); color: #e8e8e8; font: 11px system-ui, sans-serif; z-index: 5; pointer-events: none; display: none;';
document.body.appendChild(box);
const veil = document.createElement('div');
veil.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: 4; display: none;';
document.body.appendChild(veil);
const BARS = [['hunger', 'Hunger'], ['thirst', 'Thirst'], ['temperature', 'Temperature'], ['wet', 'Wetness'], ['tired', 'Tiredness'], ['stress', 'Stress']];
let shownAt = 0;
function shown(visible) {
	box.style.display = visible ? '' : 'none';
	if (!visible) { veil.style.display = 'none'; return; }
	const now = performance.now();
	if (now - shownAt < 150) return;
	shownAt = now;
	const colour = (v) => v < 50 ? '#7cc46a' : v < 80 ? '#e0b84a' : '#e05a4a';
	let html = '';
	for (const [key, name] of BARS) {
		const v = key == 'wet' ? status.wet * 100 : status[key];
		if (key == 'temperature') {
			const left = v < 0 ? 50 + v / 2 : 50, width = Math.abs(v) / 2;
			html += `<div style="display:flex;justify-content:space-between;margin-top:3px;"><span>${name}</span><span>${status.feels.toFixed(0)}°C${v < -50 ? ' cold' : v > 50 ? ' hot' : ''}</span></div>`
				+ `<div style="position:relative;height:6px;border-radius:3px;background:rgba(255,255,255,0.15);overflow:hidden;"><div style="position:absolute;left:${left}%;width:${width}%;height:100%;background:${v < 0 ? '#6aa8e0' : '#e07a4a'};"></div><div style="position:absolute;left:50%;width:1px;height:100%;background:rgba(255,255,255,0.5);"></div></div>`;
		} else {
			html += `<div style="display:flex;justify-content:space-between;margin-top:3px;"><span>${name}</span><span>${Math.round(v)}%</span></div>`
				+ `<div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.15);overflow:hidden;"><div style="height:100%;width:${v}%;background:${colour(v)};"></div></div>`;
		}
	}
	const worn = inventory.wornStats();
	if (worn.load > worn.capacity * 0.85) html += `<div style="margin-top:4px;color:${worn.load > worn.capacity ? '#f08a6a' : '#e8d08a'};">Load ${worn.load.toFixed(1)} / ${worn.capacity.toFixed(0)} kg${worn.load > worn.capacity ? ': slowed' : ''}</div>`;
	if (status.asleep > 0) html += `<div style="margin-top:4px;color:#c8c0f0;">${nightPhase.on ? `The night passes: ${Math.max(0, NIGHT.hours - (nightPhase.until - atmosphere.sunCycles) * 24).toFixed(1)} of ${NIGHT.hours} hours`
		: `Asleep${players.otherList().length ? ' (the night passes when everyone sleeps)' : ''}`} · E to wake</div>`;
	box.innerHTML = html;
	// the eyes: thirst and tiredness blur, and asleep the screen goes dark
	const blur = Math.max(Math.max((status.thirst - 85) / 15, 0), Math.max((status.tired - 90) / 10, 0)) * 2;
	const dark = status.asleep > 0 ? 0.92 : Math.max((status.tired - 80) / 20, 0) * 0.35;
	veil.style.display = blur > 0 || dark > 0 ? '' : 'none';
	veil.style.background = `radial-gradient(ellipse at center, rgba(0,0,0,${dark * 0.4}) 40%, rgba(0,0,0,${Math.min(dark * 1.2, 0.97)}) 100%)`;
	veil.style.backdropFilter = blur > 0 ? `blur(${blur.toFixed(1)}px)` : '';
}

// what is kept with the inventory (inventory.js saves it): the needs
const SAVED = 'survivalStatus';
try { Object.assign(status, JSON.parse(localStorage.getItem(SAVED) ?? '{}'), { asleep: 0 }); } catch (e) { /* (fresh) */ }
window.addEventListener('beforeunload', () => { try { localStorage.setItem(SAVED, JSON.stringify(status)); } catch (e) { /* */ } });

// for testing
export function setStatusForTest(values) { Object.assign(status, values); }
