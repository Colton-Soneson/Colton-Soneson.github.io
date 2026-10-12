import { settings } from './settings.js';
import { sunCycles } from './atmosphere.js';
import { seededRandom } from './terrainGenerator.js';

/*
	The weather.

	Every day (one round of the sun, see sunCycles in atmosphere.js) has two weathers, one for each half of it. Which ones is
	drawn by lot, a fresh draw for every half day, so a day can have the same weather twice:
		sunny, with some cloud		45 in 100
		overcast					25 in 100
		storm						30 in 100
	The lot is drawn from the number of the half day and the weather seed, so the same day always has the same weather, and
	the days can be run forwards at any speed (the time multiplier) without it changing what they hold.

	One weather does not snap to the next: over the first part of each half day everything about the sky is eased from what it
	was to what it is now. And when sunny weather turns to storm there is 1 chance in 5 that it comes in under a cumulonimbus,
	a single thunderhead standing far higher than the rest of the cloud. It builds as the storm comes on and lasts as long as
	the storm does.

	Nothing here draws anything. It only keeps weatherNow, the numbers the clouds are made from (clouds.js) and that anything
	else that cares about the weather can read.
*/

export const WEATHER_SUNNY = 0;
export const WEATHER_OVERCAST = 1;
export const WEATHER_STORM = 2;
export const WEATHER_NAMES = ["sunny", "overcast", "storm"];

const WEATHER_CHANCE = [0.45, 0.25, 0.30];		// how likely each is, they add up to 1
const TOWER_CHANCE = 0.2;						// of a cumulonimbus, when sunny turns to storm
const CHANGE_SHARE = 0.3;						// how much of a half day the change from the last weather takes

/*
	What each weather's sky is made of. Heights are in world units above the sea.
		coverage	how much of the sky has cloud in it, 0 to 1
		kind		what shape the clouds are: 0 a flat sheet (stratus), 0.5 heaped (cumulus), 1 towering
		density		how thick the cloud itself is: thin cloud lets the sun through, thick cloud is dark underneath
		base		the height of the bottom of the low cloud layer. Low enough that the mountains stand up through it
		depth		how deep the layer is, top to bottom
		middle		how much of the sky the middle layer covers (small heaps in fields, high above the low layer: altocumulus)
		rain		0 to 1
		cirrus		how much high, thin, streaky cloud there is above it all
		gloom		how much darker than white the cloud is lit: rain cloud is grey right through
*/
const WEATHER_SKIES = [
	// sunny with partial clouds: fair weather cumulus, with cirrus high above
	{ coverage: 0.42, kind: 0.55, density: 1.0, base: 500, depth: 520, middle: 0.4, rain: 0.0, cirrus: 0.7, gloom: 0.0 },
	// overcast: stratocumulus, a lumpy grey sheet with few gaps
	{ coverage: 0.86, kind: 0.2, density: 0.9, base: 560, depth: 480, middle: 0.55, rain: 0.0, cirrus: 0.35, gloom: 0.25 },
	// storm: nimbostratus, low, deep, dark and raining
	{ coverage: 0.98, kind: 0.7, density: 1.7, base: 430, depth: 980, middle: 0.35, rain: 1.0, cirrus: 0.0, gloom: 0.55 },
];

// everything about the weather right now. tower: the cumulonimbus, x and z of where it stands, its radius, and how built up it is (0 none)
export const weatherNow = {
	mode: WEATHER_SUNNY, from: WEATHER_SUNNY, change: 1,
	coverage: 0.42, kind: 0.55, density: 1.0, base: 500, depth: 520, middle: 0.4, rain: 0, cirrus: 0.7, gloom: 0,
	tower: [0, 0, 1800, 0],
};

// the lot for a half day: which weather it has, and 2 more random numbers that belong to it (for the cumulonimbus)
function drawHalfDay(halfDay) {
	const random = seededRandom((Math.imul(halfDay + 1013, 2654435761) ^ Math.imul(settings.weatherSeed + 7, 40503)) >>> 0);
	random(); random();		// the first numbers out of neighbouring seeds are too alike
	let lot = random();
	let mode = WEATHER_NAMES.length - 1;
	for (let i = 0; i < WEATHER_CHANCE.length; i++) {
		if (lot < WEATHER_CHANCE[i]) {
			mode = i;
			break;
		}
		lot -= WEATHER_CHANCE[i];
	}
	return { mode: mode, tower: random(), where: random() };
}

const smooth = (t) => { const c = Math.min(Math.max(t, 0), 1); return c * c * (3 - 2 * c); };

// Once a frame: works out what the weather is at this moment
export function weatherUpdate() {
	const now = sunCycles * 2;		// in half days
	const halfDay = Math.floor(now);
	const into = now - halfDay;		// how far into this half day, 0 to 1

	let current = drawHalfDay(halfDay);
	let last = drawHalfDay(halfDay - 1);
	let change = smooth(into / CHANGE_SHARE);

	// the control can hold the weather at one kind, or stop it changing
	if (settings.weatherMode != "auto") {
		const held = Math.max(WEATHER_NAMES.indexOf(settings.weatherMode), 0);
		current = { mode: held, tower: 1, where: 0.5 };
		last = current;
		change = 1;
	}

	const from = WEATHER_SKIES[last.mode], to = WEATHER_SKIES[current.mode];
	for (const key of Object.keys(to)) {
		weatherNow[key] = from[key] + (to[key] - from[key]) * change;
	}
	weatherNow.coverage = Math.min(Math.max(weatherNow.coverage + settings.cloudCoverageBias, 0), 1);
	weatherNow.mode = current.mode;
	weatherNow.from = last.mode;
	weatherNow.change = change;

	// The cumulonimbus. It comes in with a storm that follows sunny weather, 1 time in 5, building as the weather changes.
	//		If this half day is a storm that began under one, it is still there. And it goes as the storm goes
	let towerAmount = 0, towerLot = null;
	if (current.mode == WEATHER_STORM && last.mode == WEATHER_SUNNY && current.tower < TOWER_CHANCE) {
		towerAmount = change;
		towerLot = current;
	} else if (current.mode == WEATHER_STORM && last.mode == WEATHER_STORM) {
		// a storm that carries on: find the half day it began, and whether it began under one
		let began = halfDay - 1;
		for (let i = 0; i < 6 && drawHalfDay(began - 1).mode == WEATHER_STORM; i++) {
			began--;
		}
		const beginning = drawHalfDay(began);
		if (drawHalfDay(began - 1).mode == WEATHER_SUNNY && beginning.tower < TOWER_CHANCE) {
			towerAmount = 1;
			towerLot = beginning;
		}
	} else if (last.mode == WEATHER_STORM && current.mode != WEATHER_STORM) {
		// the storm is passing: so is its thunderhead, if it had one
		let began = halfDay - 1;
		for (let i = 0; i < 6 && drawHalfDay(began - 1).mode == WEATHER_STORM; i++) {
			began--;
		}
		const beginning = drawHalfDay(began);
		if (drawHalfDay(began - 1).mode == WEATHER_SUNNY && beginning.tower < TOWER_CHANCE) {
			towerAmount = 1 - change;
			towerLot = beginning;
		}
	}
	if (settings.weatherMode != "auto") {
		towerAmount = settings.cloudForceTower ? 1 : 0;
		towerLot = current;
	}
	if (towerLot) {
		// somewhere out round the middle of the world, a good way off, so that it is seen whole
		const bearing = towerLot.where * Math.PI * 2;
		weatherNow.tower[0] = Math.cos(bearing) * 3600;
		weatherNow.tower[1] = Math.sin(bearing) * 3600 - 1200;
		weatherNow.tower[2] = 1900;
	}
	weatherNow.tower[3] = towerAmount;

	// for the controls to show
	settings.weatherNow = change >= 1 || last.mode == current.mode ? WEATHER_NAMES[current.mode] : WEATHER_NAMES[last.mode] + " > " + WEATHER_NAMES[current.mode];
}
