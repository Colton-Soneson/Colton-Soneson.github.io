import { settings } from './settings.js';
import { sunCycles } from './atmosphere.js';
import { seededRandom } from './terrainGenerator.js';

/*
	The weather, and the seasons it comes in.

	THE SEASONS
		A year is four seasons of seasonLength days each (a day is one round of the sun, see sunCycles in atmosphere.js):
		spring, summer, fall, winter. What each one does:
			spring		more rain storms, and more wind. The grass, cut down over the winter, grows back a little every day
						and is at its full height by the last one
			summer		the storms have lightning in them more often than not, and half of them bring a tornado or a hurricane
			fall		the broadleaved trees turn, the grass goes the color of hay, and leaves come down off the trees
						(the leaf particles, particles.js: this is the only season they fall in)
			winter		the storms are winter storms: snow, not rain, no lightning and no tornadoes. Snow builds up on the
						ground while it falls (see SNOW). The grass gets shorter every day
		Nothing changes at a stroke: the colors turn over the first days of a season.

	THE WEATHER
		Every day has two weathers, one for each half of it. Which ones is drawn by lot, a fresh draw for every half day,
		so a day can have the same weather twice:
			sunny, with some cloud		about 53 in 100
			overcast					about 21 in 100
			storm						about 26 in 100		(spring and winter have more storms: see SEASON_WEATHER)
		The lot is drawn from the number of the half day and the weather seed, so the same day always has the same weather,
		and the days can be run forwards at any speed (the time multiplier) without it changing what they hold.

		One weather does not snap to the next: over the first part of each half day everything about the sky is eased from
		what it was to what it is now.

		Overcast is the HIGH cloud closing over, not the low: a grey sheet far above the peaks, with the same broken cloud
		under it as a fair day has. Only a storm fills in the low layer.

	WHAT A STORM CAN BRING (each drawn by lot with the storm)
		a cumulonimbus		when sunny weather turns to storm, 1 time in 5: a single thunderhead standing far higher than
							the rest of the cloud. It builds as the storm comes on and lasts as long as the storm does
		lightning			see lightning.js
		a tornado			a funnel from the cloud to the ground, wandering about over the land (twisterDensity in vfc_clouds.js)
		a hurricane			a spiral of cloud thousands of units across turning round a clear eye, out at sea (weatherAt in
							vfc_clouds.js). Its outer arms reach the land, and bring its rain and its wind with them
		Under a tornado or a hurricane the light goes green.

	And apart from all that, a day has 1 chance in 10 of a SHELF CLOUD: a long low wedge of cloud standing off the coast,
	somewhere out round the edge of the world, from a little after that day's sunrise to a little before the next
	(drawn by lot for the day, not the half day: see drawDay).

	SNOW (the "snowbuild")
		While a winter storm is snowing, snow settles on the ground: weatherNow.snowCover climbs from 0 to 1. Once the
		storm is over it melts away again, over 2 days. If it snows again before it has gone, it builds back up from
		wherever it had got to. The Trigger Snowbuild control starts one by hand, whatever the season.
		Everything that can have snow lying on it reads snowCover: the land (which also works out what is under cover,
		see SNOWBUILD in vf_terrain.js), the boulders, the grass.

	Nothing here draws anything. It only keeps seasonNow and weatherNow, the numbers the clouds are made from (clouds.js)
	and that anything else that cares about the season or the weather can read.
*/

export const WEATHER_SUNNY = 0;
export const WEATHER_OVERCAST = 1;
export const WEATHER_STORM = 2;
export const WEATHER_NAMES = ["sunny", "overcast", "storm"];

export const SEASON_NAMES = ["spring", "summer", "fall", "winter"];
export const SEASON_SPRING = 0;
export const SEASON_SUMMER = 1;
export const SEASON_FALL = 2;
export const SEASON_WINTER = 3;

/*
	What the weather is like in each season.
		chance		how likely each of sunny, overcast and storm is. They add up to 1
		lightning	how likely a storm is to have lightning in it
		cyclone		how likely a storm is to bring a tornado or a hurricane (one or the other, an even chance of each)
		wind		how much harder the wind blows than the wind speed setting says
*/
const SEASON_WEATHER = [
	{ chance: [0.44, 0.20, 0.36], lightning: 0.45, cyclone: 0.25, wind: 1.45 },			// spring
	{ chance: [0.5325, 0.2125, 0.255], lightning: 0.9, cyclone: 0.5, wind: 1.0 },		// summer
	{ chance: [0.5325, 0.2125, 0.255], lightning: 0.45, cyclone: 0.25, wind: 1.1 },		// fall
	{ chance: [0.38, 0.17, 0.45], lightning: 0.0, cyclone: 0.0, wind: 1.15 },			// winter
];

const TOWER_CHANCE = 0.2;						// of a cumulonimbus, when sunny turns to storm
const CHANGE_SHARE = 0.3;						// how much of a half day the change from the last weather takes
const SHELF_CHANCE = 0.1;						// of a shelf cloud, each day
const SHELF_CHANGE = 0.12;						// how much of a day it takes to build, and to go again at the end
const SHORT_GRASS = 0.35;						// how tall the grass is at the end of the winter, next to its full height
const SNOW_BUILD_SECONDS = 14;					// how long snow takes to cover the ground once it starts to fall
const SNOW_MELT_DAYS = 2;						// and how long it takes to go

/*
	What each weather's sky is made of. Heights are in world units above the sea.
		coverage	how much of the sky has cloud in it, 0 to 1
		kind		what shape the clouds are: 0 a flat sheet (stratus), 0.5 heaped (cumulus), 1 towering
		density		how thick the cloud itself is: thin cloud lets the sun through, thick cloud is dark underneath
		base		the height of the bottom of the low cloud layer. Low enough that the mountains stand up through it
		depth		how deep the layer is, top to bottom
		middle		how much of the sky the middle layer covers (small heaps in fields, high above the low layer: altocumulus)
		rain		0 to 1. In winter it comes down as snow
		cirrus		how much cloud there is in the high layer, above it all
		sheet		what that high cloud is: 0 streaks of cirrus, 1 a sheet that closes the whole sky
		gloom		how much darker than white the cloud is lit: rain cloud is grey right through
*/
const WEATHER_SKIES = [
	// sunny with partial clouds: fair weather cumulus, with cirrus high above
	{ coverage: 0.42, kind: 0.55, density: 1.0, base: 500, depth: 520, middle: 0.4, rain: 0.0, cirrus: 0.7, sheet: 0.0, gloom: 0.0 },
	// overcast: the high layer closed into a grey sheet (cirrostratus), and the same broken cloud under it as on a fair day, lit flat and grey
	{ coverage: 0.46, kind: 0.5, density: 0.95, base: 540, depth: 500, middle: 0.45, rain: 0.0, cirrus: 1.0, sheet: 1.0, gloom: 0.22 },
	// storm: nimbostratus, low, deep, dark and raining
	{ coverage: 0.98, kind: 0.7, density: 1.7, base: 430, depth: 980, middle: 0.35, rain: 1.0, cirrus: 0.7, sheet: 0.6, gloom: 0.55 },
];

// The season right now.
//		index, name		which (see SEASON_NAMES)
//		progress		how far through it, 0 to 1
//		grassHeight		how tall the grass stands, next to its full height
//		hay				how far the grass has gone the color of hay, 0 to 1
//		autumn			how far the broadleaved trees have turned, 0 to 1
//		leafFall		whether leaves are coming down off the trees
export const seasonNow = { index: SEASON_SUMMER, name: "summer", progress: 0, grassHeight: 1, hay: 0, autumn: 0, leafFall: false };

// Everything about the weather right now.
//		tower		the cumulonimbus: x and z of where it stands, its radius, and how built up it is (0 none)
//		shelf		the shelf cloud. It lies along part of a circle: x and z of the middle of the circle, its radius, how built up the
//					cloud is (0 none), which way from the middle of the circle the middle of the cloud is (radians), and half the angle it spans
//		skyCover	how much of the sky is closed over, 0 to 1, by the low cloud or by the high sheet: how grey and dim the day is
//		snow		how hard it is snowing, 0 to 1 (rain: how hard it is raining. Never both)
//		snowCover	how much snow is lying, 0 to 1 (see SNOW)
//		lightning	how much lightning the storm has in it, 0 none
//		tornado		x and z of where it is, the radius of the funnel where it meets the cloud, how built up it is (0 none)
//		hurricane	x and z of its eye, its radius, how built up it is (0 none)
//		spin		how far the hurricane has turned, radians, and the tornado's own clock, seconds
//		green		how green the light has gone, 0 to 1
//		wind		how much harder the wind blows than the wind speed setting says: the season's wind and the storm's
export const weatherNow = {
	mode: WEATHER_SUNNY, from: WEATHER_SUNNY, change: 1,
	coverage: 0.42, kind: 0.55, density: 1.0, base: 500, depth: 520, middle: 0.4, rain: 0, cirrus: 0.7, sheet: 0, gloom: 0,
	tower: [0, 0, 1800, 0],
	shelf: [0, -1200, 5400, 0, Math.PI / 2, 0.62],
	skyCover: 0,
	snow: 0, snowCover: 0,
	lightning: 0,
	tornado: [0, -900, 130, 0],
	hurricane: [0, 6000, 5200, 0],
	spin: [0, 0],
	green: 0,
	wind: 1,
};

const smooth = (t) => { const c = Math.min(Math.max(t, 0), 1); return c * c * (3 - 2 * c); };

//-------------------------------SEASONS-------------------------------
// which season it is a number of days in, and how far through it: [index, progress]
function seasonAt(days) {
	const held = SEASON_NAMES.indexOf(settings.seasonMode);
	if (held >= 0) {
		return [held, 0.6];		// (held at a little past its middle: far enough in that everything about it shows)
	}
	const length = Math.max(settings.seasonLength, 0.25);
	const seasons = days / length + Math.max(SEASON_NAMES.indexOf(settings.seasonStart), 0);
	return [((Math.floor(seasons) % 4) + 4) % 4, seasons - Math.floor(seasons)];
}

function seasonUpdate() {
	const [index, progress] = seasonAt(sunCycles);
	seasonNow.index = index;
	seasonNow.name = SEASON_NAMES[index];
	seasonNow.progress = progress;

	// the grass: a step shorter each day of the winter, a step taller each day of the spring (the steps are eased, not sudden)
	const days = Math.max(Math.round(settings.seasonLength), 1);
	const stepped = (Math.floor(progress * days) + smooth((progress * days) % 1)) / days;
	seasonNow.grassHeight = index == SEASON_WINTER ? 1 - (1 - SHORT_GRASS) * stepped : index == SEASON_SPRING ? SHORT_GRASS + (1 - SHORT_GRASS) * stepped : 1;

	// the colors: turning over the first part of the fall, staying through the winter, and going back over the first part of the spring
	seasonNow.hay = index == SEASON_FALL ? smooth(progress / 0.25) : index == SEASON_WINTER ? 1 : index == SEASON_SPRING ? 1 - smooth(progress / 0.4) : 0;
	seasonNow.autumn = index == SEASON_FALL ? smooth(progress / 0.3) : index == SEASON_WINTER ? 1 : index == SEASON_SPRING ? 1 - smooth(progress / 0.3) : 0;
	seasonNow.leafFall = index == SEASON_FALL;

	settings.seasonNow = seasonNow.name;	// for the controls to show
}

//-------------------------------THE LOTS-------------------------------
// The lot for a half day: which weather it has, and everything else that is drawn with it.
//		tower, where		for the cumulonimbus
//		winter				the storm (if it is one) is a winter storm
//		lightning			the storm has lightning
//		cyclone				0 none, 1 a tornado, 2 a hurricane. cycloneWhere: whereabouts, 0 to 1
function drawHalfDay(halfDay) {
	const random = seededRandom((Math.imul(halfDay + 1013, 2654435761) ^ Math.imul(settings.weatherSeed + 7, 40503)) >>> 0);
	random(); random();		// the first numbers out of neighbouring seeds are too alike
	const season = seasonAt(halfDay / 2)[0];
	const rules = SEASON_WEATHER[season];

	let lot = random();
	let mode = WEATHER_NAMES.length - 1;
	if (halfDay <= 0) lot = 0;		// (the first half day, and before it: sunny, to start the world in)
	for (let i = 0; i < rules.chance.length; i++) {
		if (lot < rules.chance[i]) {
			mode = i;
			break;
		}
		lot -= rules.chance[i];
	}
	const drawn = { mode: mode, tower: random(), where: random(), winter: season == SEASON_WINTER, lightning: random() < rules.lightning, cyclone: 0, cycloneWhere: 0, wind: rules.wind };
	if (random() < rules.cyclone) {
		drawn.cyclone = random() < 0.5 ? 1 : 2;
	}
	drawn.cycloneWhere = random();
	return drawn;
}

// the lot for a whole day: whether it has a shelf cloud, and whereabouts
function drawDay(day) {
	const random = seededRandom((Math.imul(day + 7919, 1597334677) ^ Math.imul(settings.weatherSeed + 3, 69069)) >>> 0);
	random(); random();
	return { shelf: random() < SHELF_CHANCE, where: random() };
}

// what a lot comes to, as amounts: how much rain, snow, lightning, tornado and hurricane it has (only a storm has any)
function stormOf(drawn) {
	const storm = drawn.mode == WEATHER_STORM;
	return {
		rain: storm && !drawn.winter ? 1 : 0,
		snow: storm && drawn.winter ? 1 : 0,
		lightning: storm && !drawn.winter && drawn.lightning ? 1 : 0,
		tornado: storm && !drawn.winter && drawn.cyclone == 1 ? 1 : 0,
		hurricane: storm && !drawn.winter && drawn.cyclone == 2 ? 1 : 0,
	};
}

// The weather the control holds it at: one of the plain three, or a storm with one particular thing in it
const HELD_WEATHER = {
	"sunny": { mode: WEATHER_SUNNY },
	"overcast": { mode: WEATHER_OVERCAST },
	"storm": { mode: WEATHER_STORM },
	"thunderstorm": { mode: WEATHER_STORM, lightning: true },
	"winter storm": { mode: WEATHER_STORM, winter: true },
	"tornado": { mode: WEATHER_STORM, lightning: true, cyclone: 1 },
	"hurricane": { mode: WEATHER_STORM, lightning: true, cyclone: 2 },
};
export const WEATHER_MODES = ["auto", ...Object.keys(HELD_WEATHER)];

let lastTime = performance.now();
let lastCycles = null;
let snowBuilding = false;		// a snowbuild set off by hand is still on its way up
let snowTriggers = 0;			// how many times the Trigger Snowbuild control had been pressed, last time it was looked at

// Once a frame: works out what the season and the weather are at this moment
export function weatherUpdate() {
	const clock = performance.now();
	const elapsed = Math.min((clock - lastTime) / 1000, 0.1);
	lastTime = clock;

	seasonUpdate();

	const now = sunCycles * 2;		// in half days
	const halfDay = Math.floor(now);
	const into = now - halfDay;		// how far into this half day, 0 to 1

	let current = drawHalfDay(halfDay);
	let last = drawHalfDay(halfDay - 1);
	let change = smooth(into / CHANGE_SHARE);

	// the control can hold the weather at one kind, or stop it changing
	const held = HELD_WEATHER[settings.weatherMode];
	if (held) {
		current = Object.assign({ tower: 1, where: 0.5, winter: false, lightning: false, cyclone: 0, cycloneWhere: 0.25, wind: SEASON_WEATHER[seasonNow.index].wind }, held);
		last = current;
		change = 1;
	}

	const from = WEATHER_SKIES[last.mode], to = WEATHER_SKIES[current.mode];
	for (const key of Object.keys(to)) {
		weatherNow[key] = from[key] + (to[key] - from[key]) * change;
	}
	weatherNow.coverage = Math.min(Math.max(weatherNow.coverage + settings.cloudCoverageBias, 0), 1);
	// (without the high layer there is no sheet to close the sky)
	weatherNow.skyCover = Math.max(smooth((weatherNow.coverage - 0.6) / 0.35), settings.cloudLayers >= 3 ? weatherNow.sheet : 0);
	weatherNow.mode = current.mode;
	weatherNow.from = last.mode;
	weatherNow.change = change;

	// what the storm has in it, eased in and out with the weather
	const stormFrom = stormOf(last), stormTo = stormOf(current);
	const eased = (key) => stormFrom[key] + (stormTo[key] - stormFrom[key]) * change;
	weatherNow.rain = eased("rain");
	weatherNow.snow = eased("snow");
	weatherNow.lightning = eased("lightning");
	const tornado = eased("tornado"), hurricane = eased("hurricane");
	// (snow cloud is not the black of rain cloud: it is thinner, and the snow in the air under it throws the light about)
	weatherNow.gloom -= 0.27 * weatherNow.snow;
	weatherNow.density -= 0.55 * weatherNow.snow;

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
	if (held) {
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

	// The shelf cloud: there for the whole of a day that drew one, building at its start and going at its end.
	//		The control can stand one up whatever the day drew, out to sea south of the start
	const day = Math.floor(sunCycles), intoDay = sunCycles - day;
	const dayLot = drawDay(day);
	let shelfAmount = dayLot.shelf && !held ? smooth(intoDay / SHELF_CHANGE) * (1 - smooth((intoDay - (1 - SHELF_CHANGE)) / SHELF_CHANGE)) : 0;
	let shelfBearing = dayLot.where * Math.PI * 2;
	if (settings.cloudForceShelf) {
		shelfAmount = 1;
		shelfBearing = Math.PI / 2;
	}
	weatherNow.shelf[3] = shelfAmount;
	weatherNow.shelf[4] = shelfBearing;

	// The tornado: somewhere on the land north of the start, wandering slowly about. Where is from whichever of the two
	//		half days has it (coming in, it is this one. Going out, the last)
	weatherNow.spin[0] += elapsed * 0.035;
	weatherNow.spin[1] += elapsed;
	const cycloneLot = stormOf(current).tornado + stormOf(current).hurricane > 0 ? current : last;
	{
		const bearing = cycloneLot.cycloneWhere * Math.PI * 2, wander = weatherNow.spin[1];
		weatherNow.tornado[0] = Math.cos(bearing) * 520 + Math.sin(wander * 0.021) * 260 + Math.sin(wander * 0.057) * 90;
		weatherNow.tornado[1] = -820 + Math.sin(bearing) * 360 + Math.cos(wander * 0.017) * 220 + Math.cos(wander * 0.049) * 90;
		weatherNow.tornado[3] = tornado;
		// the hurricane: its eye well out to sea, far enough that the whole of it can be seen from a height, near enough that its arms come over the land
		weatherNow.hurricane[0] = Math.cos(bearing) * 6200;
		weatherNow.hurricane[1] = Math.sin(bearing) * 6200 - 600;
		weatherNow.hurricane[3] = hurricane;
	}
	weatherNow.green = Math.max(tornado, hurricane);
	// (round a hurricane the rest of the sky opens up a little: its cloud is drawn in to the spiral, and the spiral should be seen)
	weatherNow.coverage -= 0.26 * hurricane;

	// the wind: the season's, more in any storm, and a gale under a tornado or a hurricane
	const stormy = (last.mode == WEATHER_STORM ? 1 - change : 0) + (current.mode == WEATHER_STORM ? change : 0);
	weatherNow.wind = (last.wind + (current.wind - last.wind) * change) * (1 + 0.5 * stormy) * (1 + 0.5 * tornado + 0.9 * hurricane);

	// The snow on the ground (see SNOW at the top). It builds by the clock on the wall, so that it can be watched building
	//		even with the days stopped. It melts by the days
	if (settings.snowbuildTriggers !== snowTriggers) {
		snowTriggers = settings.snowbuildTriggers;
		snowBuilding = true;
	}
	const days = lastCycles === null ? 0 : Math.min(Math.max(sunCycles - lastCycles, 0), 0.5);
	lastCycles = sunCycles;
	if (weatherNow.snow > 0.25 || snowBuilding) {
		weatherNow.snowCover = Math.min(weatherNow.snowCover + elapsed / SNOW_BUILD_SECONDS, 1);
		if (weatherNow.snowCover >= 1) {
			snowBuilding = false;
		}
	} else {
		weatherNow.snowCover = Math.max(weatherNow.snowCover - days / SNOW_MELT_DAYS, 0);
	}
	settings.snowCover = Math.round(weatherNow.snowCover * 100) / 100;

	// for the controls to show
	const extras = [];
	if (weatherNow.snow > 0.01) extras.push("snow");
	if (weatherNow.lightning > 0.01) extras.push("lightning");
	if (tornado > 0.01) extras.push("tornado");
	if (hurricane > 0.01) extras.push("hurricane");
	if (shelfAmount > 0) extras.push("shelf cloud");
	settings.weatherNow = (change >= 1 || last.mode == current.mode ? WEATHER_NAMES[current.mode] : WEATHER_NAMES[last.mode] + " > " + WEATHER_NAMES[current.mode])
		+ (extras.length ? " (" + extras.join(", ") + ")" : "");
}
