import { settings } from './settings.js';

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as ballistics from './ballistics.js'
import * as hunting from './hunting.js'
import * as players from './players.js'
import * as weapons from './weapons.js'
import * as deer from './deer.js'
import * as town from './town.js'
import * as townFolk from './townFolk.js'
import * as pointLights from './pointLights.js'
import * as help from './controlsHelp.js'

/*
	THE HORDE game mode: the Hunting walker and its guns (hunting.js, weapons.js), against rounds of feral deer, the way Call of
	Duty's Zombies goes, that behave as the freakers of Days Gone do. They are the deer of deer.js (the same mesh, hitbox and
	ground), drawn darker and mangy with eyes that glow (vf_deer.js, feral). The herds of deer.js are hidden while it is on.

	THE ROUNDS. Round 1 is hordeFirstWave deer, and each round hordeWaveGrowth times the one before, up to hordeMaxWave. They come
		in packs (PACK: a pack is a horde), one every PACK_SECONDS, from SPAWN_AWAY round one of the players (behind it, where it
		cannot see), as long as there are fewer than hordeAliveCap out at once. The round is over when the last of it is down:
		hordeBreakSeconds, and the next. Each round they are tougher (roundHealth: HEALTH more each round to round 9, then
		ROUND_HEALTH_LATE times more) and faster: each pack walks, runs or sprints (PACES), more of them running each round
		(paceShares). A player who is down stays down until the round is over (with others in the game; alone, the run is over).
		All of them down: the run is over (GAME OVER, how far it got), and a new one starts after OVER_SECONDS.
	POINTS (each player's own): POINTS_START to begin, HIT_POINTS a hit, KILL_POINTS a kill, HEAD_POINTS a kill in the head,
		SUPER_POINTS a super deer. They buy the guns from the spawn menu (PRICES, kept until the player is down) and the
		ammunition from a horse's saddlebags (AMMO_PRICE). The revolver is free, and in the hands at the start.
	POWER-UPS: a deer shot dead now and then (POWER_CHANCE, at the most POWERS_A_ROUND a round) leaves one behind, glowing green,
		for POWER_SECONDS. Walked into (POWER_REACH), it is everyone's: Max Ammo (every gun full), Insta-Kill (any hit kills, for
		EFFECT_SECONDS), Double Points (EFFECT_SECONDS), Nuke (every deer out drops dead, NUKE_POINTS to everyone).
	HEALTH comes back by itself (REGEN_DELAY after the last lunge, REGEN_RATE a second).

	HOW A HORDE MOVES (the freakers' way)
		as one body		the first of it leads (the leader), and the rest flow after it along the way it went (its trail), in
						rows FILE_GAP across and ROW_GAP behind, the way a river goes. Where the ground beside the trail cannot be
						walked on (water, a cliff, a narrow way between houses) they close in on the trail itself, so a horde
						squeezes through a gap and spreads out again after it
		apart			none of them on top of another: each pushed away from the ones closer than APART
		round things	before each step a deer looks a little way ahead, and turns aside until it finds ground it can walk on:
						not water, not ground steeper than deer.js's STEEPEST, not the houses of the towns. They will not swim, so a
						walker in the water or on a boat cannot be reached, and they pace the shore
	WHAT IT KNOWS. What it hunts (its prey) is a player, or a townsperson (THE TOWNSFOLK)
		sight			each deer looks ahead (SIGHT_COS either side of its heading) as far as SIGHT_DAY, SIGHT_NIGHT in the dark,
						over the land (a hill in between hides the prey). Closer than CLOSE_SENSE it knows the prey is there
						whichever way it faces. Each deer looks every SENSE_SECONDS or so
		sound			every gunshot is heard as far as HEAR (the round's): the horde goes to where it came from, and the deer
						within FRENZY_HEAR of that know just where it was. Running is heard out to RUN_HEARD
		the scent		a new pack has a player's scent: it comes to about where it is (SCENT_ERROR off)
		the alarm		a deer that has seen its prey goes into a frenzy, and passes it on: every deer within SPREAD of it goes
						into one too a moment later (SPREAD_DELAY), and so on, so the alarm runs through the horde like a wave
	WHAT IT DOES (each horde's state)
		hunt			on the scent: the leader trots to where the prey is thought to be (TROT, or the pack's pace if less)
		chase			the prey seen: at the pack's pace (faster in the dark: NIGHT_PACE). The deer in a frenzy close enough
						(DIRECT) go straight for the nearest prey, and round it as they come in (SURROUND: some one way, some the
						other), so it is soon ringed. They are solid to the walker (hunting.addMovers): ringed, it cannot get out
		search			out of sight for LOSE_SECONDS: they go to where it was last seen and spread out round it looking
						(SEARCH_SPREAD), for SEARCH_SECONDS, then pick up a player's scent again (hunt)
		the lunge		within LUNGE_REACH a deer lunges, head down (LUNGE_SECONDS): hordeDamage off a player's health and a
						shove (SHOVE). Then a rest (LUNGE_REST). A player up on something more than LEAP over the ground cannot be
						reached: they mill under it. A townsperson lunged at turns into a super deer
		lost			a horde that has not come within sight of a player for LOST_SECONDS (stuck behind a mountain, a lake)
						comes round again from somewhere else
	SHOT. Each deer has the round's health (roundHealth). A hit takes off the part's share (HIT, PART_DAMAGE) times the round's
		(ballistics.ROUNDS), and staggers it (STAGGER_SECONDS, pushed back). Down, it falls on to its side, lies there and sinks
		into the ground (FALL_SECONDS, LIE_SECONDS, SINK_SECONDS).

	THE TOWNSFOLK (townFolk.js) fight. One out of doors with a deer within MILITIA_SIGHT takes out a gun (its own, of the players':
		MILITIA_GUNS, the same rounds), stands where it is and shoots at the nearest (MILITIA aims a little off, waits between shots,
		and reloads), and once there have been none about for CALM_SECONDS goes home. Its shots are heard by the horde. A deer that
		gets to it turns it: in its place a SUPER deer, SUPER_SIZE times as big, its health SUPER_HEALTH times, its lunge twice the
		harm. The towns are whole again with a new run.

	MULTIPLAYER (net.js, hordeNet). The host runs it all: the rounds, every deer, the power-ups and the townsfolk's fight. Its
		deer go to the others with the rest of the animals (hordeShare, hordeFollow); a joiner's shot that hits one goes to the
		host with the part it hit and the round (hordeShot), and the host says what it earned (hordePoints). What the run is
		doing goes to everyone HUD_RATE times a second (hordeState, hordeHeard), and what happens at once as it happens
		(hordeEvent: a new run, a round over, a power-up). The host takes the lunges off everyone's health, and gives it back.
*/
const MAX_HORDE = 600;				// deer alive at once at the most
const PACK = [6, 40];				// deer in a pack: a third of the round, between these
const PACK_SECONDS = 5;
const SPAWN_AWAY = [110, 170];		// metres from the player a pack starts
const SPAWN_SPREAD = 1.4;			// metres times the square root of its size: how far a new pack is spread round its middle
const SCENT_ERROR = 25;				// metres off the player that a pack on the scent is going to
const WALK = 1.3, TROT = 4.2;		// metres a second
const PACES = [2.4, 4.6, 6.3];		// metres a second a pack chases at: walkers, runners, sprinters (the walker runs at 6.9)
const NIGHT_PACE = 1.15;			// times as fast in the dark
const OWN_PACE = 0.1;				// each its own pace, this much either way
const SIGHT_DAY = 85, SIGHT_NIGHT = 45, SIGHT_COS = 0.42;	// metres; the cosine of the angle either side of its heading it sees (65 degrees)
const CLOSE_SENSE = 9;				// metres
const SENSE_SECONDS = 0.5;
const HEAR = { '7.62x54R': 380, '00 buck': 320, '.45 Colt': 260, '.45-70': 420 };	// metres a shot is heard
const FRENZY_HEAR = 0.35;			// of that, the deer that know just where it came from
const RUN_HEARD = 22;				// metres
const SPREAD = 16;					// metres
const SPREAD_DELAY = [0.15, 0.5];	// seconds
const LOSE_SECONDS = 7, SEARCH_SECONDS = 14, SEARCH_SPREAD = 22;
const LOST_SECONDS = 60;
const STUCK_SECONDS = 8;
const DIRECT = 30;					// metres
const SURROUND = 7;					// metres
const APART = 1.1;					// metres
const BODY = 1.3;					// metres from a prey, the closest a deer comes
const TRAIL_SPACING = 1.5, ROW_GAP = 1.4, FILE_GAP = 1.2;	// metres
const LUNGE_REACH = 1.9, LUNGE_SECONDS = 0.5, LUNGE_HIT = 0.22, LUNGE_REST = [1.4, 2.6];	// metres, seconds
const LEAP = 2.0;					// metres
const SHOVE = 3.0;					// metres a second
const HEALTH = 100, ROUND_HEALTH = 35, ROUND_HEALTH_LATE = 1.1;
const HIT = ['belly', 'belly', 'chest', 'chest', 'head', 'leg', 'leg'];	// which part each of deer.js's DEER_SPHERES is
const PART_DAMAGE = { head: 250, chest: 70, belly: 55, leg: 30 };
const STAGGER_SECONDS = 0.45;
const FALL_SECONDS = 0.6, LIE_SECONDS = 4, SINK_SECONDS = 2.5, SINK_DEPTH = 0.7;
const GROUND_NEAR = 80;				// metres from the camera or a player: further off, the cheap ground (land.heightAt) is close enough
const FIRST_BREAK = 8, OVER_SECONDS = 8;
const SUPER_SIZE = 4, SUPER_HEALTH = 4, SUPER_PACE = 4.8;
const POINTS_START = 500, HIT_POINTS = 10, KILL_POINTS = 60, HEAD_POINTS = 100, SUPER_POINTS = 500, NUKE_POINTS = 400;
const PRICES = { revolver: 0, rifle: 500, shotgun: 1000, sharps: 1500, staff: 5000 };	// (the rest free: the discs, empty hands)
const AMMO_PRICE = 300;
const POWER_CHANCE = 0.035, POWERS_A_ROUND = 4, POWER_SECONDS = 30, POWER_REACH = 2.2, EFFECT_SECONDS = 30;
const POWERS = { ammo: 'Max Ammo', insta: 'Insta-Kill', double: 'Double Points', nuke: 'Nuke' };
const REGEN_DELAY = 4, REGEN_RATE = 30;
const MILITIA_SIGHT = 40, CALM_SECONDS = 6, DRAW_SECONDS = 0.8;
// the townsfolk's guns: the players' (how long it is drawn, as players.js), how far off they aim (radians), seconds between shots, rounds and reload
const MILITIA_GUNS = {
	rifle: { round: '7.62x54R', spread: 0.012, every: 1.6, holds: 5, reload: 4, pellets: 1 },
	shotgun: { round: '00 buck', spread: 0.05, every: 1.1, holds: 5, reload: 4.5, pellets: 9 },
	revolver: { round: '.45 Colt', spread: 0.03, every: 0.6, holds: 6, reload: 5, pellets: 1 },
	sharps: { round: '.45-70', spread: 0.006, every: 2.8, holds: 1, reload: 0, pellets: 1 },
};
const MILITIA_SHARES = [['rifle', 0.35], ['shotgun', 0.25], ['revolver', 0.25], ['sharps', 0.15]];
const HUD_RATE = 5;

export const hordeStats = { phase: 'off', round: 0, alive: 0, toSpawn: 0, hordes: 0, corpses: 0, kills: 0, frenzied: 0, lunges: 0, hits: 0, best: 0, ms: 0, points: 0, fighting: 0, turned: 0, supers: 0, powers: 0, folkShots: 0, folkHits: 0 };	// for anyone who wants to show it

// what net.js tells this file, and does for it (see MULTIPLAYER at the top)
export const hordeNet = {
	role: 'off',				// 'off', 'host', 'joining', 'joined'
	others: () => [],			// the other players: [{ id, x, y, z, alive, hunting, speed }]
	hurtOther: null,			// host: (id, damage, shove [vx, vz]) a lunge on one of the others
	healOther: null,			// host: (id, amount) health back
	points: null,				// host: (id, points, why) what one of the others earned
	event: null,				// host: (event) to everyone else
	shot: null,					// host: (from, directions, round) a townsperson's shot, for its trail on the others' screens
	pick: null,					// joiner: (power id) walked into one
};
const joined = () => hordeNet.role == 'joined';
const together = () => hordeNet.role == 'host' && hordeNet.others().length > 0;

const run = { phase: 'off', round: 0, timer: 0, toSpawn: 0, spawnTimer: 0, kills: 0, best: 0, powersThisRound: 0, insta: 0, double: 0 };	// off, break (before a round), round, over
const me = { points: 0, owned: new Set(), hurtAt: -1e9, gained: 0 };
let shared = null;		// joiner: the host's state of the run, as it last came (hordeState)
let followed = null;	// joiner: the host's deer, as they are now
let hordes = [];		// { deer: [], pace, state, goal, lastKnown, prey, unseen, far, timer, trail, nearest, stuck, milling, files }
let corpses = [];		// { deer, t, side, roll, sink }
let powers = [];		// { id, kind, x, y, z, age }
const militia = new Map();	// townsperson's index -> { gun, x, y, z, heading, pitch, mag, next, drawn, calm, target, look }
const otherHurtAt = new Map();	// host: the others' last lunge, for their health coming back
let lastTime = performance.now();
let nextId = 1, nextPower = 1;

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);
const ease = (v) => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
const between = ([low, high]) => low + (high - low) * Math.random();
const metre = () => settings.forestUnitsPerMetre;
const hordeMode = () => settings.gameMode == 'Horde';
const turnTo = (from, to, k) => { let turn = to - from; turn -= Math.PI * 2 * Math.round(turn / (Math.PI * 2)); return from + turn * k; };
const angleBetween = (a, b) => { let d = b - a; d -= Math.PI * 2 * Math.round(d / (Math.PI * 2)); return Math.abs(d); };
// how dark it is: 0 in the day to 1 at night (the light of vf_deer.js)
function darkness() {
	const length = Math.hypot(settings.sunPosX, settings.sunPosY, settings.sunPosZ) || 1;
	return 1 - ease((settings.sunPosY / length + 0.08) / 0.33);
}
export const roundSize = (round) => Math.min(Math.round(settings.hordeFirstWave * Math.pow(settings.hordeWaveGrowth, round - 1)), settings.hordeMaxWave);
export const roundHealth = (round) => round <= 9 ? HEALTH * (1 + ROUND_HEALTH / 100 * (round - 1)) : roundHealth(9) * Math.pow(ROUND_HEALTH_LATE, round - 9);
// the shares of walkers, runners and sprinters in a round
function paceShares(round) {
	const sprint = clamp((round - 4) / 6, 0, 0.8), run = clamp((round - 1) / 4, 0, 1) * (1 - sprint);
	return [1 - sprint - run, run, sprint];
}
const living = () => hordes.reduce((sum, horde) => sum + horde.deer.length, 0);

// The prey
//-------------------------------------------------
// everyone a deer can go for: the players out and alive, and the townsfolk out of doors. { key, kind, id, x, y (its feet), z, eye,
//		ground, speed, reachable }
let preys = [], preyByKey = new Map();
function gatherPreys() {
	const m = metre();
	preys = [];
	const mine = hunting.hunterPlace();
	if (mine.active && hunting.hunterLife.alive) {
		const ground = hunting.meshGroundAt(mine.x, mine.z);
		const aboard = mine.on == 'deck' || mine.on == 'seat' || mine.on == 'ladder';
		preys.push({ key: 'me', kind: 'player', id: 'me', x: mine.x, y: mine.y, z: mine.z, eye: mine.y + (mine.on == 'saddle' ? 0.9 : 1.6) * m, ground,
			speed: Math.hypot(mine.vx, mine.vz) / m, reachable: !aboard && !mine.swimming && mine.y - ground < LEAP * m });
	}
	for (const other of hordeNet.others()) {
		if (!other.alive || !other.hunting) continue;
		const ground = hunting.meshGroundAt(other.x, other.z);
		preys.push({ key: 'p' + other.id, kind: 'player', id: other.id, x: other.x, y: other.y, z: other.z, eye: other.y + 1.6 * m, ground, speed: other.speed,
			reachable: other.y - ground < LEAP * m && other.y > settings.waterWorldPosY - 0.8 * m });
	}
	townFolk.folkOut((person) => {
		const p = person.place;
		preys.push({ key: 'f' + person.index, kind: 'folk', id: person.index, x: p.x, y: p.y, z: p.z, eye: p.y + 1.6 * m, ground: p.y, speed: 0, reachable: true });
	});
	preyByKey = new Map(preys.map((prey) => [prey.key, prey]));
}
const playerPreys = () => preys.filter((prey) => prey.kind == 'player');
function nearestPrey(x, z, players = false) {
	let best = null, bestD = Infinity;
	for (const prey of preys) {
		if (players && prey.kind != 'player') continue;
		const d = Math.hypot(prey.x - x, prey.z - z);
		if (d < bestD) { bestD = d; best = prey; }
	}
	return best;
}

// a lunge that got there: a player hurt and shoved, a townsperson turned
function hurtPrey(horde, one, prey) {
	const damage = settings.hordeDamage * (one.size > 1 ? 2 : 1);
	const away = Math.hypot(prey.x - one.x, prey.z - one.z) || 1, shove = [(prey.x - one.x) / away * SHOVE, (prey.z - one.z) / away * SHOVE];
	hordeStats.hits++;
	if (prey.key == 'me') {
		const life = players.localLife();
		if (!life.alive) return;
		// (in a game with others the host keeps everyone's health, its own too: net.js)
		if (hordeNet.role == 'host') hordeNet.hurtOther?.('me', damage, null);
		else players.setLocalHealth(life.health - damage, '', 'Overrun by the horde');
		hunting.shoveHunter(shove[0], shove[1]);
		me.hurtAt = performance.now() / 1000;
	} else if (prey.kind == 'player') {
		hordeNet.hurtOther?.(prey.id, damage, shove);
		otherHurtAt.set(prey.id, performance.now() / 1000);
	} else {
		turnVillager(horde, prey);
	}
}

// The rounds
//-------------------------------------------------
function clearHordes() {
	hordes = [];
	corpses = [];
	powers = [];
	for (const index of militia.keys()) townFolk.setFight(index, null, false);
	militia.clear();
}
// a new run: from the first round, the points and the guns as they start, the towns whole again
function startRun() {
	clearHordes();
	Object.assign(run, { phase: 'break', round: 0, timer: FIRST_BREAK, toSpawn: 0, spawnTimer: 0, kills: 0, powersThisRound: 0, insta: 0, double: 0 });
	event({ k: 'start' });
}
function beginRound() {
	run.round++;
	run.phase = 'round';
	run.toSpawn = roundSize(run.round);
	run.spawnTimer = 0;
	run.powersThisRound = 0;
	event({ k: 'round', round: run.round });
}
function endRound() {
	run.phase = 'break';
	run.timer = settings.hordeBreakSeconds;
	event({ k: 'roundOver', round: run.round });
}
// what happens at once, here and (from the host) everywhere
function event(e) {
	if (!joined()) hordeNet.event?.(e);
	hordeEvent(e);
}
// joiner: what the host says just happened (and the host's own, here)
export function hordeEvent(e) {
	if (e.k == 'start') {
		inRun = true;
		me.points = POINTS_START;
		me.owned = new Set(['revolver']);
		townFolk.restoreFolk();
		if (hunting.hunterLife.alive) startingGun();
		help.toast('The horde is coming', 3);
	} else if (e.k == 'round') {
		announce(`ROUND ${e.round}`, '#c01818');
	} else if (e.k == 'roundOver') {
		announce(`ROUND ${e.round} SURVIVED`, '#e8e8e8');
	} else if (e.k == 'power') {
		announce(POWERS[e.kind] + '!', '#7dff6a');
		if (e.kind == 'ammo') weapons.refill();
		if (e.kind == 'nuke') nukeFlash = 1;
	} else if (e.k == 'turned') {
		players.addFeed('A townsperson has turned');
	} else if (e.k == 'over') {
		announce('GAME OVER', '#c01818');
	}
}
// the guns as they start (the revolver in the hands), and nothing bought
function startingGun() {
	weapons.resetWeapons();
	weapons.equipWeapon('revolver');
}
// up again near one of the others who is up, if any (players.js asks): a little way off it, on ground it can stand on
players.placeRespawn(() => {
	if (!hordeMode()) return null;
	const m = metre();
	const up = players.otherList().filter((other) => other.view && other.view.alive && other.view.hunting);
	if (up.length == 0) return null;
	const v = up[Math.floor(Math.random() * up.length)].view;
	for (let attempt = 0; attempt < 20; attempt++) {
		const a = Math.random() * Math.PI * 2, r = (6 + 6 * Math.random()) * m, x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
		if (walkable(x, z)) return { x, z };
	}
	return { x: v.x, z: v.z };
});
players.onRespawn(() => {
	if (!hordeMode()) return;
	me.owned = new Set(['revolver']);
	startingGun();
});

// somewhere a pack can start: walkable, round from `angle` (away from the player), not in the sea or a town
function spawnSpot(prey, angle) {
	const m = metre();
	for (let attempt = 0; attempt < 40; attempt++) {
		const a = angle + (Math.random() - 0.5) * (0.8 + attempt * 0.08), out = between(SPAWN_AWAY) * m * (attempt < 30 ? 1 : 0.6);
		const x = prey.x + Math.sin(a) * out, z = prey.z + Math.cos(a) * out;
		if (walkable(x, z) && terrain.land.zoneAt(x, z) != terrain.ZONE_TOWN) return [x, z];
	}
	return null;
}
function behind(prey) {
	if (prey.key != 'me') return Math.random() * Math.PI * 2;
	const forward = transformations.getCameraForward();
	return Math.atan2(-forward[0], -forward[2]);
}
function newDeer(x, z, prey, size = 1) {
	return { id: nextId++, x, z, y: terrain.land.heightAt(x, z), heading: prey ? Math.atan2(prey.x - x, prey.z - z) : Math.random() * 6.28, stride: Math.random() * 6.28, walking: 0, headDown: 0,
		own: Math.random(), slope: 0, ground: null, health: roundHealth(Math.max(run.round, 1)) * (size > 1 ? SUPER_HEALTH : 1), frenzy: false, alertIn: -1, lunge: -1, rest: 0, stagger: 0, hop: 0,
		sense: Math.random() * SENSE_SECONDS, pace: 1 + (Math.random() * 2 - 1) * OWN_PACE, rank: 0, mill: null, millTimer: 0, target: null, size };
}
function newHorde(count, at, prey, pace) {
	const m = metre();
	const horde = { deer: [], pace, state: 'hunt', goal: null, lastKnown: [prey.x, prey.z], prey: prey.key, unseen: 0, far: 0, timer: 0, trail: [], nearest: Infinity, stuck: STUCK_SECONDS, milling: false, files: 1 };
	const spread = SPAWN_SPREAD * Math.sqrt(count) * m;
	for (let k = 0; k < count; k++) {
		let x = at[0], z = at[1];
		for (let attempt = 0; attempt < 6; attempt++) {
			const a = Math.random() * Math.PI * 2, r = spread * Math.sqrt(Math.random());
			if (walkable(at[0] + Math.cos(a) * r, at[1] + Math.sin(a) * r)) { x = at[0] + Math.cos(a) * r; z = at[1] + Math.sin(a) * r; break; }
		}
		horde.deer.push(newDeer(x, z, prey));
	}
	scent(horde, prey);
	ranks(horde);
	return horde;
}
// a pack of the round, round one of the players
function spawnPack() {
	const targets = playerPreys();
	if (targets.length == 0) return;
	const prey = targets[Math.floor(Math.random() * targets.length)];
	const size = Math.min(run.toSpawn, clamp(Math.round(roundSize(run.round) / 3), PACK[0], PACK[1]), Math.min(settings.hordeAliveCap, MAX_HORDE) - living());
	if (size <= 0) return;
	const at = spawnSpot(prey, behind(prey));
	if (!at) return;
	const shares = paceShares(run.round);
	let r = Math.random(), kind = 0;
	while (kind < 2 && r > shares[kind]) { r -= shares[kind]; kind++; }
	hordes.push(newHorde(size, at, prey, PACES[kind]));
	run.toSpawn -= size;
}
// the horde on a player's scent: going to about where it is
function scent(horde, prey) {
	const m = metre(), a = Math.random() * Math.PI * 2, off = SCENT_ERROR * m * Math.sqrt(Math.random());
	horde.state = 'hunt';
	horde.prey = prey.key;
	horde.goal = [prey.x + Math.cos(a) * off, prey.z + Math.sin(a) * off];
	horde.nearest = Infinity;
	horde.stuck = STUCK_SECONDS;
	horde.milling = false;
}
// its places in the rows behind the leader: the nearest to it first
function ranks(horde) {
	const lead = horde.deer[0];
	if (!lead) return;
	horde.deer.sort((a, b) => Math.hypot(a.x - lead.x, a.z - lead.z) - Math.hypot(b.x - lead.x, b.z - lead.z));
	horde.deer.forEach((one, k) => { one.rank = k; });
	horde.files = clamp(Math.round(Math.sqrt(horde.deer.length) * 0.7), 1, 9);
	horde.trail = [];
}
// a horde that has lost its way (LOST_SECONDS) brought round again, out of sight of a player
function bringRound(horde) {
	const targets = playerPreys();
	if (targets.length == 0) return;
	const prey = targets[Math.floor(Math.random() * targets.length)];
	const at = spawnSpot(prey, behind(prey));
	if (!at) return;
	const m = metre(), spread = SPAWN_SPREAD * Math.sqrt(horde.deer.length) * m;
	for (const one of horde.deer) {
		const a = Math.random() * Math.PI * 2, r = spread * Math.sqrt(Math.random());
		const x = at[0] + Math.cos(a) * r, z = at[1] + Math.sin(a) * r;
		[one.x, one.z] = walkable(x, z) ? [x, z] : at;
		one.ground = null;
		one.frenzy = false;
		one.alertIn = -1;
	}
	horde.far = 0;
	scent(horde, prey);
	ranks(horde);
}

// Moving
//-------------------------------------------------
// ground a deer can go on: deer.js's walkable, and not in a house of the towns (a super deer, size times as big, keeps further off them)
function walkable(x, z, size = 1) {
	if (!deer.walkable(x, z)) return false;
	let free = true;
	const m = metre(), margin = (0.3 + 0.15 * (size - 1)) * m;
	town.boxesNear(x, z, margin + 0.1 * m, (bx, bz, half, bottom, top) => {
		if (free && top - bottom > 1.0 * m && Math.abs(x - bx) < half + margin && Math.abs(z - bz) < half + margin) free = false;
	});
	return free;
}
// the deer near each place (APART, SPREAD), in cells of CELL metres: rebuilt every frame
const CELL = 2;
let cells = new Map();
function fillCells() {
	const s = CELL * metre();
	cells = new Map();
	for (const horde of hordes) for (const one of horde.deer) {
		const key = Math.floor(one.x / s) * 65536 + Math.floor(one.z / s);
		let list = cells.get(key);
		if (!list) cells.set(key, list = []);
		list.push(one);
	}
}
function near(x, z, reach, each) {
	const s = CELL * metre(), r = Math.ceil(reach / s);
	const cx = Math.floor(x / s), cz = Math.floor(z / s);
	for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
		const list = cells.get((cx + i) * 65536 + cz + j);
		if (list) for (const one of list) each(one);
	}
}

// one deer a step towards `to` at pace (world units a second), round water, cliffs and houses, kept APART from the others and off
//		the prey. Stands where it is if no way on can be walked
function step(one, to, pace, elapsed, prey) {
	const m = metre(), size = one.size;
	const dx = to[0] - one.x, dz = to[1] - one.z, far = Math.hypot(dx, dz);
	let moved = 0;
	if (far > 0.3 * m) {
		const want = Math.atan2(dx, dz), look = 3 * m * Math.sqrt(size);
		let heading = null;
		for (const turn of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4]) {
			if (far < look || walkable(one.x + Math.sin(want + turn) * look, one.z + Math.cos(want + turn) * look, size)) { heading = want + turn; break; }
		}
		if (heading !== null) {
			const turned = angleBetween(one.heading, heading);
			one.heading = turnTo(one.heading, heading, Math.min(elapsed * 5, 1));
			moved = Math.min(pace * elapsed * (turned > 1.6 ? 0.5 : 1), far);
			one.x += Math.sin(one.heading) * moved;
			one.z += Math.cos(one.heading) * moved;
		}
	}
	// apart from the others
	let px = 0, pz = 0;
	near(one.x, one.z, APART * m * Math.max(size, 1), (other) => {
		if (other === one) return;
		const room = APART * m * (size + other.size) / 2;
		const ox = one.x - other.x, oz = one.z - other.z, apart = Math.hypot(ox, oz) || 0.01;
		if (apart < room) { px += ox / apart * (room - apart); pz += oz / apart * (room - apart); }
	});
	const push = Math.min(Math.hypot(px, pz), 4 * m * elapsed), pl = Math.hypot(px, pz) || 1;
	if (push > 0 && walkable(one.x + px / pl * push, one.z + pz / pl * push, size)) { one.x += px / pl * push; one.z += pz / pl * push; moved += push * 0.5; }
	// and never in the prey: no closer than BODY to it
	if (prey) {
		const body = BODY * m * (size > 1 ? size * 0.55 : 1);
		const ox = one.x - prey.x, oz = one.z - prey.z, apart = Math.hypot(ox, oz);
		if (apart < body) {
			const k = apart > 0.01 ? body / apart : 0;
			one.x = k ? prey.x + ox * k : prey.x - Math.sin(one.heading) * body;
			one.z = k ? prey.z + oz * k : prey.z - Math.cos(one.heading) * body;
		}
	}
	one.stride += moved / (1.4 * m * size) * Math.PI * 2;
	one.walking += (clamp(moved / Math.max(elapsed, 1e-4) / (WALK * m * size), 0, 1.4) - one.walking) * Math.min(elapsed * 6, 1);
	return far - moved;
}

// the place a deer of the horde keeps behind the leader: on the trail, its row back, its file across. On the trail itself where
//		that cannot be walked on
function slotOf(horde, one) {
	const m = metre(), trail = horde.trail, lead = horde.deer[0];
	const row = Math.floor(one.rank / horde.files) + 1, file = one.rank % horde.files - (horde.files - 1) / 2;
	let back = row * ROW_GAP * m;
	let ax = lead.x, az = lead.z;
	const place = (x, z, across) => {
		const wide = [x + across[0] * file * FILE_GAP * m, z + across[1] * file * FILE_GAP * m];
		return walkable(wide[0], wide[1]) ? wide : [x, z];
	};
	for (let k = 0; k < trail.length; k++) {
		const [bx, bz] = trail[k], piece = Math.hypot(bx - ax, bz - az);
		if (piece >= back) {
			const f = back / (piece || 1);
			return place(ax + (bx - ax) * f, az + (bz - az) * f, [(az - bz) / (piece || 1), (bx - ax) / (piece || 1)]);
		}
		back -= piece;
		ax = bx; az = bz;
	}
	// (the trail is not that long yet: behind the leader, the way it faces)
	const fx = Math.sin(lead.heading), fz = Math.cos(lead.heading);
	return place(ax - fx * back, az - fz * back, [fz, -fx]);
}

// whether the land is in the way between a deer's eyes and the prey's
function canSee(one, prey) {
	const m = metre(), y0 = one.y + 1.4 * m * one.size;
	for (let k = 1; k < 8; k++) {
		const f = k / 8;
		if (terrain.land.heightAt(one.x + (prey.x - one.x) * f, one.z + (prey.z - one.z) * f) > y0 + (prey.eye - y0) * f) return false;
	}
	return true;
}

// a deer into a frenzy: its horde after the prey, and the deer round it to follow it in a moment (see the alarm at the top)
function frenzy(horde, one, prey) {
	if (!one.frenzy) {
		one.frenzy = true;
		near(one.x, one.z, SPREAD * metre(), (other) => { if (!other.frenzy && other.alertIn < 0) other.alertIn = between(SPREAD_DELAY); });
	}
	if (prey) {
		one.target = prey.key;
		horde.state = 'chase';
		horde.prey = prey.key;
		horde.unseen = 0;
		horde.lastKnown = [prey.x, prey.z];
		horde.milling = false;
	}
}

// a gunshot at `from`, heard by every horde within its reach (see sound at the top). by: the prey that fired it (its key)
export function heardShot(from, round, by = 'me') {
	if (run.phase != 'round' && run.phase != 'over') return;
	const m = metre(), reach = (HEAR[round] ?? 300) * m;
	const prey = preyByKey.get(by) ?? { key: by, x: from[0], z: from[2] };
	for (const horde of hordes) {
		let closest = Infinity;
		for (const one of horde.deer) closest = Math.min(closest, Math.hypot(one.x - from[0], one.z - from[2]));
		if (closest > reach) continue;
		if (horde.state != 'chase') {
			horde.state = 'hunt';
			horde.goal = [from[0], from[2]];
			horde.nearest = Infinity;
			horde.stuck = STUCK_SECONDS;
			horde.milling = false;
		}
		horde.lastKnown = [from[0], from[2]];
		for (const one of horde.deer) if (Math.hypot(one.x - from[0], one.z - from[2]) < reach * FRENZY_HEAR) frenzy(horde, one, preyByKey.has(by) ? prey : null);
		if (horde.state == 'chase') horde.unseen = Math.max(horde.unseen, LOSE_SECONDS * 0.5);	// (heard, not seen: lost again soon if not seen)
	}
}
ballistics.onLocalFire((from, directions, round) => { if (!joined()) heardShot(from, round, 'me'); });

// The horde, a frame on
//-------------------------------------------------
function advanceHorde(horde, elapsed) {
	const m = metre(), dark = darkness();
	const nightPace = 1 + (NIGHT_PACE - 1) * dark;
	const sight = (SIGHT_DAY + (SIGHT_NIGHT - SIGHT_DAY) * dark) * m;
	if (horde.deer.length == 0) return;
	const lead = horde.deer[0];
	let prey = preyByKey.get(horde.prey) ?? null;

	// what they see and hear: each deer the prey nearest it
	for (const one of horde.deer) {
		if (one.alertIn >= 0 && (one.alertIn -= elapsed) < 0) frenzy(horde, one, preyByKey.get(one.target ?? horde.prey) ?? null);
		if ((one.sense -= elapsed) > 0 || preys.length == 0) continue;
		one.sense += SENSE_SECONDS * (0.8 + 0.4 * Math.random());
		const seen = nearestPrey(one.x, one.z);
		const dx = seen.x - one.x, dz = seen.z - one.z, far = Math.hypot(dx, dz);
		const ahead = (dx * Math.sin(one.heading) + dz * Math.cos(one.heading)) / (far || 1);
		if (far < CLOSE_SENSE * m * one.size || (far < sight && ahead > SIGHT_COS && canSee(one, seen)) || (seen.speed > settings.huntingWalkSpeed * 1.3 && far < RUN_HEARD * m)) {
			frenzy(horde, one, seen);
			if (seen.key == horde.prey) horde.unseen = 0;
		}
	}
	prey = preyByKey.get(horde.prey) ?? null;
	const anyPlayer = playerPreys().some((p) => Math.hypot(p.x - lead.x, p.z - lead.z) < sight);
	horde.far = anyPlayer ? 0 : horde.far + elapsed;
	if (horde.far > LOST_SECONDS && horde.state != 'chase') { bringRound(horde); return; }

	// what the horde as a whole is doing
	if (horde.state == 'chase') {
		horde.unseen += elapsed;
		if (prey && horde.unseen < LOSE_SECONDS) horde.lastKnown = [prey.x, prey.z];
		horde.goal = horde.lastKnown;
		if (horde.unseen >= LOSE_SECONDS || !prey) {
			horde.state = 'search';
			horde.timer = SEARCH_SECONDS;
			horde.milling = false;
			for (const one of horde.deer) { one.frenzy = false; one.target = null; }
		}
	} else if (horde.state == 'search') {
		horde.goal = horde.lastKnown;
		if (horde.milling && (horde.timer -= elapsed) <= 0) {
			const targets = playerPreys();
			if (targets.length) scent(horde, nearestPrey(lead.x, lead.z, true));
			else horde.timer = SEARCH_SECONDS;
		}
	}
	const pace = (horde.state == 'chase' ? horde.pace * nightPace : horde.state == 'hunt' || (horde.state == 'search' && !horde.milling) ? Math.min(TROT, horde.pace) : WALK) * m;

	// the leader: to the goal. On the scent, no nearer for a while: a way round, off to one side
	const left = lead.lunge >= 0 ? Infinity : step(lead, horde.goal, pace * lead.pace * (lead.size > 1 ? SUPER_PACE / horde.pace : 1) * (lead.stagger > 0 ? 0.3 : 1), elapsed, prey);
	if (horde.state == 'hunt') {
		if (left < horde.nearest - 1 * m) { horde.nearest = left; horde.stuck = STUCK_SECONDS; }
		else if ((horde.stuck -= elapsed) <= 0) {
			const a = Math.random() * Math.PI * 2;
			horde.goal = [horde.goal[0] + Math.cos(a) * 40 * m, horde.goal[1] + Math.sin(a) * 40 * m];
			horde.nearest = Infinity;
			horde.stuck = STUCK_SECONDS;
		}
		if (left < 6 * m) {
			// got to where the scent said, and nothing there: looking round for it
			horde.state = 'search';
			horde.lastKnown = horde.goal;
			horde.timer = SEARCH_SECONDS;
			horde.milling = true;
		}
	} else if (horde.state == 'search' && !horde.milling && left < 6 * m) {
		horde.milling = true;
		horde.timer = SEARCH_SECONDS;
	}
	const last = horde.trail[0] ?? [lead.x - Math.sin(lead.heading) * 0.01, lead.z - Math.cos(lead.heading) * 0.01];
	if (Math.hypot(lead.x - last[0], lead.z - last[1]) > TRAIL_SPACING * m) {
		horde.trail.unshift([lead.x, lead.z]);
		const longest = (Math.ceil(horde.deer.length / horde.files) + 4) * ROW_GAP / TRAIL_SPACING + 8;
		if (horde.trail.length > longest) horde.trail.length = Math.ceil(longest);
	}

	// the rest: in their places behind the leader, or (in a frenzy, close) straight for the nearest prey and round it, or looking round
	for (const one of horde.deer) {
		const mine = (one.target && preyByKey.get(one.target)) || prey;
		const toPrey = mine ? Math.hypot(mine.x - one.x, mine.z - one.z) : Infinity;
		if (one !== lead) {
			let to, speed = pace;
			if (horde.state == 'chase' && one.frenzy && toPrey < DIRECT * m) {
				to = [mine.x, mine.z];
				if (toPrey < SURROUND * m) {
					// round it as it comes in: across, one way or the other, less the closer it is
					const side = one.own < 0.5 ? 1 : -1, round = clamp((toPrey - 1.4 * m) / (SURROUND * m), 0, 1) * 0.8;
					to = [mine.x + (mine.z - one.z) * side * round, mine.z - (mine.x - one.x) * side * round];
				}
			} else if (horde.milling) {
				if (!one.mill || (one.millTimer -= elapsed) <= 0) {
					const a = Math.random() * Math.PI * 2, r = SEARCH_SPREAD * m * Math.sqrt(Math.random());
					one.mill = [horde.lastKnown[0] + Math.cos(a) * r, horde.lastKnown[1] + Math.sin(a) * r];
					one.millTimer = 3 + 5 * Math.random();
				}
				to = one.mill;
				speed = WALK * m * 1.3;
			} else {
				to = slotOf(horde, one);
				const behind = Math.hypot(to[0] - one.x, to[1] - one.z);
				speed = pace * clamp(behind / (3 * m), 0.3, 1.25);
			}
			if (one.size > 1) speed *= SUPER_PACE / horde.pace;
			if (one.lunge < 0) step(one, to, speed * one.pace * (one.stagger > 0 ? 0.3 : 1), elapsed, mine);
		}

		// the lunge
		const reach = LUNGE_REACH * m * (one.size > 1 ? one.size * 0.6 : 1);
		if (one.lunge >= 0) {
			const t0 = one.lunge;
			one.lunge += elapsed;
			if (mine) one.heading = turnTo(one.heading, Math.atan2(mine.x - one.x, mine.z - one.z), Math.min(elapsed * 8, 1));
			if (t0 < LUNGE_HIT && one.lunge >= LUNGE_HIT && mine && mine.reachable && toPrey < reach + 0.5 * m) hurtPrey(horde, one, mine);
			if (one.lunge >= LUNGE_SECONDS) { one.lunge = -1; one.rest = between(LUNGE_REST); }
		} else if ((one.rest -= elapsed) <= 0 && mine && mine.reachable && one.stagger <= 0 && toPrey < reach) {
			one.lunge = 0;
			frenzy(horde, one, mine);
			hordeStats.lunges++;
		}
		one.stagger -= elapsed;
		const lunging = one.lunge >= 0 ? Math.sin(Math.PI * one.lunge / LUNGE_SECONDS) : 0;
		const reachUp = mine ? clamp((mine.y - mine.ground) / m, 0, LEAP) : 0;
		one.hop = lunging * (0.25 + 0.5 * reachUp) * m;

		// the head: down to lunge, up to run, now and then down while milling
		const wanted = one.lunge >= 0 ? 1 : horde.milling && one.walking < 0.3 && one.own > 0.6 ? 0.8 : 0;
		one.headDown += (wanted - one.headDown) * Math.min(elapsed * (one.lunge >= 0 ? 12 : 3), 1);
		// on the ground, tipped to its slope
		const seen = Math.hypot(one.x - settings.camPosX, one.z - settings.camPosZ) < GROUND_NEAR * m || preys.some((p) => p.kind == 'player' && Math.hypot(one.x - p.x, one.z - p.z) < GROUND_NEAR * m);
		one.y = seen ? deer.groundUnder(one) : terrain.land.heightAt(one.x, one.z);
		const fx = Math.sin(one.heading) * 0.8 * m * one.size, fz = Math.cos(one.heading) * 0.8 * m * one.size;
		one.slope += (Math.atan2(terrain.land.heightAt(one.x + fx, one.z + fz) - terrain.land.heightAt(one.x - fx, one.z - fz), 1.6 * m * one.size) - one.slope) * Math.min(elapsed * 4, 1);
	}
}

// Shot
//-------------------------------------------------
// a deer's hitbox (deer.js's, lifted by its hop): the nearest of them the line from a to b goes into, of a list: { t, one, part }
function crossDeer(ax, ay, az, bx, by, bz, list) {
	const m = metre(), mx = (ax + bx) / 2, mz = (az + bz) / 2, reach = Math.hypot(bx - ax, bz - az) / 2 + 2 * m;
	let best = null;
	for (const one of list) {
		const r = reach + 2 * m * (one.size - 1);
		if (Math.abs(one.x - mx) > r || Math.abs(one.z - mz) > r) continue;
		const lifted = one.hop ? { ...one, y: one.y + one.hop } : one;
		const [x, y, z, around] = deer.deerAround(lifted);
		if (ballistics.crossSphere(ax, ay, az, bx, by, bz, x, y, z, around) === null) continue;
		deer.deerSpheres(lifted).forEach(([sx, sy, sz, sr], k) => {
			const t = ballistics.crossSphere(ax, ay, az, bx, by, bz, sx, sy, sz, sr);
			if (t !== null && (!best || t < best.t)) best = { t, one, part: HIT[k] };
		});
	}
	return best;
}
ballistics.addTarget((ax, ay, az, bx, by, bz) => {
	if (followed) {
		const found = crossDeer(ax, ay, az, bx, by, bz, followed.filter((one) => one.alive));
		return found && { t: found.t, what: 'horde deer', hit: (velocity, bullet) => {
			players.markHit(found.part == 'head');
			if (bullet?.shooter != 'folk') hordeShot.report?.(found.one.id, velocity, found.part, bullet?.round);
		} };
	}
	if (hordes.length == 0) return null;
	const found = crossDeer(ax, ay, az, bx, by, bz, hordes.flatMap((horde) => horde.deer));
	if (!found) return null;
	const horde = hordes.find((h) => h.deer.includes(found.one));
	return { t: found.t, what: 'horde deer', hit: (velocity, bullet) => {
		const folk = bullet?.shooter == 'folk';
		if (!folk) players.markHit(found.part == 'head');
		hitDeer(horde, found.one, found.part, bullet?.round, velocity, folk ? 'folk' : 'me');
	} };
});

// a hit: by 'me', 'folk' (a townsperson) or one of the others (its id: it says so, hordeShot)
function hitDeer(horde, one, part, round, velocity, by) {
	if (!horde || !horde.deer.includes(one)) return;
	if (by == 'folk') hordeStats.folkHits++;
	const before = one.health;
	one.health -= run.insta > 0 ? Infinity : PART_DAMAGE[part] * (ballistics.ROUNDS[round]?.damage ?? 1);
	if (one.health > 0) {
		// staggered back, and in a frenzy
		one.stagger = STAGGER_SECONDS;
		one.lunge = -1;
		const speed = Math.hypot(velocity[0], velocity[2]) || 1, m = metre();
		const bx = one.x + velocity[0] / speed * 0.4 * m / one.size, bz = one.z + velocity[2] / speed * 0.4 * m / one.size;
		if (walkable(bx, bz, one.size)) { one.x = bx; one.z = bz; }
		frenzy(horde, one, by == 'folk' ? null : preyByKey.get(by == 'me' ? 'me' : 'p' + by) ?? null);
		if (before > 0) givePoints(by, HIT_POINTS);
		return;
	}
	killDeer(horde, one, velocity);
	givePoints(by, one.size > 1 ? SUPER_POINTS : part == 'head' ? HEAD_POINTS : KILL_POINTS);
	// now and then a power-up where it fell
	if (run.powersThisRound < POWERS_A_ROUND && Math.random() < POWER_CHANCE) {
		const kinds = Object.keys(POWERS);
		powers.push({ id: nextPower++, kind: kinds[Math.floor(Math.random() * kinds.length)], x: one.x, y: one.y, z: one.z, age: 0 });
		run.powersThisRound++;
	}
}
function killDeer(horde, one, velocity) {
	horde.deer.splice(horde.deer.indexOf(one), 1);
	// over on to the side the shot pushed it to (its right is (cos, -sin) of its heading)
	const side = velocity[0] * Math.cos(one.heading) - velocity[2] * Math.sin(one.heading) > 0 ? 1 : -1;
	corpses.push({ deer: one, t: 0, side, roll: 0, sink: 0 });
	run.kills++;
	hordeStats.kills++;
	// a new leader: the next nearest, and the places behind it again
	if (one.rank == 0 && horde.deer.length > 0) ranks(horde);
}

// Points (see POINTS at the top): to this player, or (the host) to one of the others
function givePoints(by, points) {
	if (by == 'folk') return;
	points *= run.double > 0 ? 2 : 1;
	if (by == 'me') hordePoints(points);
	else hordeNet.points?.(by, points);
}
// points this player earned (the host says so, for a joiner)
export function hordePoints(points) {
	me.points += points;
	me.gained += points;
	popPoints(points);
}
// the guns bought, and the ammunition (weapons.js, hunting.js ask): true if it may be had, the price taken
weapons.gateEquip((name) => {
	if (!hordeMode() || me.owned.has(name) || !(name in PRICES)) return true;
	if (me.points < PRICES[name]) { help.toast(`${PRICES[name]} points to buy (you have ${me.points})`); return false; }
	me.points -= PRICES[name];
	me.owned.add(name);
	return true;
});
weapons.priceTag((name) => hordeMode() && name in PRICES && !me.owned.has(name) ? ` · ${PRICES[name] ? PRICES[name] + ' points' : 'free'}` : '');
hunting.gateRefill(() => {
	if (!hordeMode()) return true;
	if (me.points < AMMO_PRICE) { help.toast(`Ammunition: ${AMMO_PRICE} points (you have ${me.points})`); return false; }
	me.points -= AMMO_PRICE;
	return true;
});

// for the walker (hunting.js): every living deer of the horde within reach, as a box: they are solid
hunting.addMovers((x, z, reach, add) => {
	const m = metre();
	const list = followed ? followed.filter((one) => one.alive) : hordes.flatMap((horde) => horde.deer);
	for (const one of list) {
		if (Math.abs(one.x - x) < reach + one.size * m && Math.abs(one.z - z) < reach + one.size * m) add(one.x, one.z, 0.3 * m * one.size, one.y, one.y + 1.2 * m * one.size);
	}
});

// The townsfolk (see THE TOWNSFOLK at the top)
//-------------------------------------------------
function militiaGun(index) {
	let r = (index * 0.6180339 + 0.31) % 1;
	for (const [gun, share] of MILITIA_SHARES) { if (r < share) return gun; r -= share; }
	return 'rifle';
}
function advanceMilitia(elapsed) {
	const m = metre();
	const all = hordes.flatMap((horde) => horde.deer);
	const nearestDeer = (x, z, reach) => {
		let best = null, bestD = reach;
		for (const one of all) { const d = Math.hypot(one.x - x, one.z - z); if (d < bestD) { bestD = d; best = one; } }
		return best;
	};
	let fighting = 0;
	townFolk.folkOut((person) => {
		const p = person.place;
		let f = militia.get(person.index);
		if (!f) {
			if (all.length == 0 || (person.index + Math.floor(performance.now() / 300)) % 4 != 0) return;		// (each looks round now and then)
			const seen = nearestDeer(p.x, p.z, MILITIA_SIGHT * m);
			if (!seen) return;
			const gun = militiaGun(person.index);
			f = { gun, x: p.x, y: p.y, z: p.z, heading: p.heading, pitch: 0, mag: MILITIA_GUNS[gun].holds, next: 0, drawn: 0, calm: 0, target: seen, look: 0 };
			militia.set(person.index, f);
		}
		fighting++;
		const G = MILITIA_GUNS[f.gun];
		if (!all.includes(f.target) || (f.look -= elapsed) <= 0) { f.target = nearestDeer(f.x, f.z, MILITIA_SIGHT * 1.3 * m); f.look = 0.3; }
		if (!f.target) {
			if ((f.calm += elapsed) > CALM_SECONDS) { militia.delete(person.index); townFolk.setFight(person.index, null, true); return; }
		} else {
			f.calm = 0;
			const t = f.target, ty = t.y + (1.0 * t.size) * m + t.hop;
			const want = Math.atan2(t.x - f.x, t.z - f.z), far = Math.hypot(t.x - f.x, t.z - f.z);
			f.heading = turnTo(f.heading, want, Math.min(elapsed * 6, 1));
			f.pitch += (Math.atan2(ty - (f.y + 1.35 * m), far) - f.pitch) * Math.min(elapsed * 6, 1);
			f.drawn += elapsed;
			f.next -= elapsed;
			if (f.drawn > DRAW_SECONDS && f.next <= 0 && angleBetween(f.heading, want) < 0.1) {
				// a shot (or a shell's pellets), a little off where it aims
				const muzzle = [f.x + Math.sin(f.heading) * 0.9 * m, f.y + 1.35 * m, f.z + Math.cos(f.heading) * 0.9 * m];
				const aim = [t.x - muzzle[0], ty - muzzle[1], t.z - muzzle[2]], length = Math.hypot(...aim);
				const dirs = [];
				for (let k = 0; k < G.pellets; k++) dirs.push(aim.map((v) => v / length + (Math.random() - 0.5) * 2 * G.spread));
				for (const dir of dirs) ballistics.fire(muzzle, dir, { round: G.round, quiet: true, shooter: 'folk' });
				hordeNet.shot?.(muzzle, dirs, G.round);
				hordeStats.folkShots++;
				heardShot(muzzle, G.round, 'f' + person.index);
				f.mag--;
				f.next = G.every;
				if (f.mag <= 0) { f.mag = G.holds; f.next = Math.max(G.reload, G.every); }
			}
		}
		townFolk.setFight(person.index, { x: f.x, y: f.y, z: f.z, heading: f.heading, pitch: f.pitch, gun: f.drawn > 0.25 ? f.gun : 'none' });
	});
	hordeStats.fighting = fighting;
}
// a townsperson a deer got to: a super deer in its place
function turnVillager(horde, prey) {
	militia.delete(prey.id);
	townFolk.turnFolk(prey.id);
	preyByKey.delete(prey.key);
	preys = preys.filter((p) => p !== prey);
	// (where there is room for it: round where the townsperson stood)
	let at = [prey.x, prey.z];
	for (let r = 1; r <= 8 && !walkable(at[0], at[1], SUPER_SIZE); r++) {
		for (let k = 0; k < 8; k++) {
			const x = prey.x + Math.cos(k / 8 * Math.PI * 2) * r * metre(), z = prey.z + Math.sin(k / 8 * Math.PI * 2) * r * metre();
			if (walkable(x, z, SUPER_SIZE)) { at = [x, z]; break; }
		}
	}
	const big = newDeer(at[0], at[1], null, SUPER_SIZE);
	big.frenzy = true;
	big.rank = horde.deer.length;
	horde.deer.push(big);
	hordeStats.turned++;
	event({ k: 'turned' });
}

// The power-ups (see POWER-UPS at the top)
//-------------------------------------------------
function advancePowers(elapsed) {
	const m = metre();
	for (const power of powers) power.age += elapsed;
	powers = powers.filter((power) => power.age < POWER_SECONDS);
	for (const power of [...powers]) {
		for (const prey of playerPreys()) {
			if (Math.hypot(prey.x - power.x, prey.z - power.z) < POWER_REACH * m && Math.abs(prey.y - power.y) < 3 * m) { takePower(power.id); break; }
		}
	}
}
// host: a power-up walked into (here, or by one of the others: hordePick)
function takePower(id) {
	const power = powers.find((p) => p.id == id);
	if (!power) return;
	powers = powers.filter((p) => p !== power);
	if (power.kind == 'insta') run.insta = EFFECT_SECONDS;
	if (power.kind == 'double') run.double = EFFECT_SECONDS;
	if (power.kind == 'nuke') {
		// every deer out down at once, and the points to everyone
		for (const horde of hordes) for (const one of [...horde.deer]) killDeer(horde, one, [Math.random() - 0.5, 0, Math.random() - 0.5]);
		hordes = [];
		hordePoints(NUKE_POINTS);
		for (const other of hordeNet.others()) hordeNet.points?.(other.id, NUKE_POINTS);
	}
	event({ k: 'power', kind: power.kind });
}
export function hordePick(id) { if (!joined()) takePower(id); }

// Per frame
//-------------------------------------------------
export function hordeUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.05);
	lastTime = now;
	const t0 = performance.now();
	advance(elapsed);
	hordeStats.ms = performance.now() - t0;
}
// for testing: the horde moved on by a number of seconds
export function simulateHorde(total) {
	for (let done = 0; done < total; done += 0.05) advance(0.05);
}

function advance(elapsed) {
	const on = hordeMode() && terrain.land && hunting.hunterPlace().active;
	if (!on || joined()) {
		if (run.phase != 'off') { clearHordes(); run.phase = 'off'; }
		if (on) joinerFrame(elapsed);
		show(elapsed);
		return;
	}
	if (run.phase == 'off') startRun();
	gatherPreys();
	run.insta = Math.max(run.insta - elapsed, 0);
	run.double = Math.max(run.double - elapsed, 0);

	// the run: a break, the round, the next. All the players down: over, and again
	const anyoneUp = hunting.hunterLife.alive || hordeNet.others().some((other) => other.alive && other.hunting);
	if (run.phase == 'over') {
		if ((run.timer -= elapsed) <= 0) startRun();
	} else if (!anyoneUp && run.phase == 'round') {
		run.phase = 'over';
		run.timer = OVER_SECONDS;
		run.best = Math.max(run.best, run.round);
		event({ k: 'over', round: run.round });
	} else if (run.phase == 'break') {
		if ((run.timer -= elapsed) <= 0) beginRound();
	} else if (run.phase == 'round') {
		if (run.toSpawn > 0 && (run.spawnTimer -= elapsed) <= 0) {
			spawnPack();
			run.spawnTimer = PACK_SECONDS;
		}
		if (run.toSpawn <= 0 && living() == 0) endRound();
	}

	hordes = hordes.filter((horde) => horde.deer.length > 0);
	fillCells();
	for (const horde of hordes) advanceHorde(horde, elapsed);
	advanceMilitia(elapsed);
	advancePowers(elapsed);
	regen(elapsed);

	// the shot ones: over on to their sides, a while lying there, down into the ground, gone
	for (const corpse of corpses) {
		corpse.t += elapsed;
		const one = corpse.deer;
		one.walking = 0;
		one.hop = 0;
		one.headDown += (0.35 - one.headDown) * Math.min(elapsed * 4, 1);
		corpse.roll = -corpse.side * 1.45 * ease(corpse.t / FALL_SECONDS);
		corpse.sink = SINK_DEPTH * ease((corpse.t - FALL_SECONDS - LIE_SECONDS) / SINK_SECONDS);
	}
	corpses = corpses.filter((corpse) => corpse.t < FALL_SECONDS + LIE_SECONDS + SINK_SECONDS);

	Object.assign(hordeStats, { phase: run.phase, round: run.round, toSpawn: run.toSpawn, hordes: hordes.length, alive: living(), corpses: corpses.length, best: run.best, powers: powers.length,
		frenzied: hordes.reduce((sum, horde) => sum + horde.deer.filter((one) => one.frenzy).length, 0), supers: hordes.reduce((sum, horde) => sum + horde.deer.filter((one) => one.size > 1).length, 0) });
	show(elapsed);
}
// health coming back (see HEALTH at the top): this player's, and (the host) the others'
let regenTick = 0;
function regen(elapsed) {
	const now = performance.now() / 1000, life = players.localLife();
	if (life.alive && life.health < players.HEALTH && now - me.hurtAt > REGEN_DELAY && hordeNet.role != 'host') players.setLocalHealth(Math.min(life.health + REGEN_RATE * elapsed, players.HEALTH), '');
	if ((regenTick += elapsed) < 0.5) return;
	if (hordeNet.role == 'host' && life.alive && life.health < players.HEALTH && now - me.hurtAt > REGEN_DELAY) hordeNet.healOther?.('me', REGEN_RATE * regenTick);
	for (const [id, at] of otherHurtAt) {
		if (now - at > REGEN_DELAY) hordeNet.healOther?.(id, REGEN_RATE * regenTick);
		if (now - at > REGEN_DELAY + players.HEALTH / REGEN_RATE + 1) otherHurtAt.delete(id);
	}
	regenTick = 0;
}
// a player who is down: kept down until the round is over (with others), or the run starts again (players.js asks)
players.holdRespawn(() => {
	if (!hordeMode()) return false;
	const phase = joined() ? shared?.phase : run.phase;
	if (phase == 'over') return 'Back for the next run';
	return phase == 'round' && (joined() || together()) ? 'Back when the round is over' : false;
});

// Multiplayer (see MULTIPLAYER at the top)
//-------------------------------------------------
// host: the run as it is now, for everyone (HUD_RATE times a second)
export function hordeState() {
	if (!hordeMode() || run.phase == 'off') return { on: false };
	const fights = [...militia.entries()].map(([index, f]) => [index, ...[f.x, f.y, f.z, f.heading, f.pitch].map((v) => Math.round(v * 100) / 100), f.drawn > 0.25 ? f.gun : 'none']);
	return { on: true, phase: run.phase, round: run.round, timer: Math.round(run.timer * 10) / 10, left: run.toSpawn + living(), best: run.best, kills: run.kills,
		insta: Math.round(run.insta), double: Math.round(run.double), chase: hudWord(), powers: powers.map((p) => [p.id, p.kind, Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10, Math.round(p.z * 10) / 10, Math.round(p.age)]),
		fights, turned: townFolk.turnedList() };
}
// joiner: the host's word on the run
export function hordeHeard(state) {
	shared = state;
	if (!state.on) { inRun = false; return; }
	// (come into a run that was already going: the points and the guns as a run starts)
	if (!inRun) { inRun = true; me.points = POINTS_START; me.owned = new Set(['revolver']); }
	// the townsfolk's fight, as the host has it (and the ones it is over for go home)
	const now = new Set(state.fights.map((f) => f[0]));
	for (const index of militia.keys()) if (!now.has(index)) { townFolk.setFight(index, null, true); militia.delete(index); }
	for (const [index, x, y, z, heading, pitch, gun] of state.fights) {
		const f = militia.get(index);
		if (!f) militia.set(index, { x, y, z, heading, pitch, gun, want: [heading, pitch] });
		else Object.assign(f, { x, y, z, gun, want: [heading, pitch] });
	}
	townFolk.setTurned(state.turned);
}
// joiner, each frame: the townsfolk's fight eased towards what the host said, the power-ups walked into
function joinerFrame(elapsed) {
	for (const [index, f] of militia) {
		f.heading = turnTo(f.heading, f.want[0], Math.min(elapsed * 8, 1));
		f.pitch += (f.want[1] - f.pitch) * Math.min(elapsed * 8, 1);
		townFolk.setFight(index, { x: f.x, y: f.y, z: f.z, heading: f.heading, pitch: f.pitch, gun: f.gun });
	}
	const mine = hunting.hunterPlace(), m = metre();
	if (!hunting.hunterLife.alive || !shared?.powers) return;
	for (const [id, , x, y, z] of shared.powers) {
		if (Math.hypot(mine.x - x, mine.z - z) < POWER_REACH * m && Math.abs(mine.y - y) < 3 * m && !asked.has(id)) { asked.add(id); hordeNet.pick?.(id); }
	}
}
const asked = new Set();
let inRun = false;		// joiner: in the host's run
// the host's deer go to the others as the animals do (net.js): [id, x, y, z, heading, stride, head down, walking, own + 2 x size, slope, roll,
//		0 down / 1 / 2 in a frenzy], the shot ones too
export function hordeShare() {
	const out = [];
	for (const horde of hordes) for (const one of horde.deer) out.push(one.id, one.x, one.y + one.hop, one.z, one.heading, one.stride, one.headDown, one.walking, one.own + 2 * one.size, one.slope, 0, one.frenzy ? 2 : 1);
	for (const corpse of corpses) { const one = corpse.deer; out.push(one.id, one.x, one.y - corpse.sink * metre() * settings.deerSize * one.size, one.z, one.heading, one.stride, one.headDown, 0, one.own + 2 * one.size, one.slope, corpse.roll, 0); }
	return new Float32Array(out);
}
// joiner: the host's deer, as hordeShare's records, or null for none
export function hordeFollow(records) {
	if (!records) { followed = null; return; }
	followed = [];
	for (let at = 0; at < records.length; at += 12) {
		const size = Math.floor(records[at + 8] / 2);
		followed.push({ id: records[at], x: records[at + 1], y: records[at + 2], z: records[at + 3], heading: records[at + 4], stride: records[at + 5], headDown: records[at + 6],
			walking: records[at + 7], own: records[at + 8] - 2 * size, size, slope: records[at + 9], roll: records[at + 10], alive: records[at + 11] > 0.5, frenzy: records[at + 11] > 1.5, hop: 0 });
	}
}
// a joiner's shot that hit one of the host's deer: report(id, velocity, part, round) (net.js sends it to the host)
export const hordeShot = { report: null };
// host: one of the others' shots hit one
export function killHordeById(id, velocity, part, round, by) {
	for (const horde of hordes) {
		const one = horde.deer.find((d) => d.id === id);
		if (one) { hitDeer(horde, one, HIT.includes(part) ? part : 'chest', round, velocity, by); return; }
	}
}

// The horde drawn with the deer (deer.js): feral, and in a frenzy brighter in the eyes
deer.addDrawn((put) => {
	const size = metre() * settings.deerSize;
	if (followed) {
		for (const one of followed) put(one.x, one.y, one.z, one.heading, one.stride, one.headDown, one.walking, one.own, one.slope, one.roll, one.frenzy ? 2 : 1, one.size);
		return;
	}
	for (const horde of hordes) for (const one of horde.deer) put(one.x, one.y + one.hop, one.z, one.heading, one.stride, one.headDown, one.walking, one.own, one.slope, 0, one.frenzy ? 2 : 1, one.size);
	for (const corpse of corpses) { const one = corpse.deer; put(one.x, one.y - corpse.sink * size * one.size, one.z, one.heading, one.stride, one.headDown, 0, one.own, one.slope, corpse.roll, 1, one.size); }
});

// What is shown over the picture (THE ROUNDS, POINTS, POWER-UPS)
//-------------------------------------------------
const hud = document.createElement('div');
hud.style.cssText = 'position: fixed; inset: 0; z-index: 5; pointer-events: none; display: none; font-family: system-ui, sans-serif; overflow: hidden;';
// the round, in the bottom left over the health: chalk marks to 5, then the number, in red (the way Zombies shows it)
const roundBox = document.createElement('div');
roundBox.style.cssText = 'position: absolute; left: 20px; bottom: 74px; height: 64px; display: flex; align-items: flex-end; gap: 7px; color: #b3110f; font: 700 64px/1 Georgia, "Times New Roman", serif; text-shadow: 0 0 6px rgba(0, 0, 0, 0.9), 0 0 2px #000;';
// the points, in the bottom right over the ammunition, and what was just earned beside them
const pointsBox = document.createElement('div');
pointsBox.style.cssText = 'position: absolute; right: 18px; bottom: 96px; text-align: right; color: #f2e6c4; font: 700 26px/1 Georgia, "Times New Roman", serif; text-shadow: 0 0 4px #000, 0 0 2px #000;';
const popBox = document.createElement('div');
popBox.style.cssText = 'position: absolute; right: 18px; bottom: 126px; width: 120px; height: 120px; overflow: visible;';
// in the middle at the top: what the horde is doing, the break's count down, the power-ups in force
const topBox = document.createElement('div');
topBox.style.cssText = 'position: absolute; left: 50%; top: 14px; transform: translateX(-50%); padding: 6px 16px; border-radius: 6px; background: rgba(0, 0, 0, 0.5); color: #e8e8e8; font-size: 13px; text-align: center; white-space: nowrap;';
// a word across the middle: ROUND 3, a power-up taken, GAME OVER
const bannerBox = document.createElement('div');
bannerBox.style.cssText = 'position: absolute; left: 50%; top: 24%; transform: translateX(-50%); font: 700 46px/1.1 Georgia, "Times New Roman", serif; letter-spacing: 0.06em; text-shadow: 0 0 10px rgba(0, 0, 0, 0.9), 0 0 2px #000; opacity: 0; transition: opacity 0.4s; white-space: nowrap; text-align: center;';
const flashBox = document.createElement('div');
flashBox.style.cssText = 'position: absolute; inset: 0; background: #fff; opacity: 0;';
const powerLayer = document.createElement('div');
powerLayer.style.cssText = 'position: absolute; inset: 0;';
hud.append(flashBox, powerLayer, roundBox, pointsBox, popBox, topBox, bannerBox);
document.body.appendChild(hud);
let bannerTimer = 0, nukeFlash = 0, shownKey = '';
const powerEls = new Map();		// power id -> element

function announce(text, colour) {
	bannerBox.textContent = text;
	bannerBox.style.color = colour;
	bannerBox.style.opacity = '1';
	clearTimeout(bannerTimer);
	bannerTimer = setTimeout(() => { bannerBox.style.opacity = '0'; }, 2600);
}
function popPoints(points) {
	const el = document.createElement('div');
	el.textContent = '+' + points;
	el.style.cssText = `position: absolute; right: ${Math.random() * 30}px; bottom: 0; color: ${points >= 100 ? '#ffd24a' : '#f2e6c4'}; font: 700 18px Georgia, serif; text-shadow: 0 0 3px #000; transition: transform 0.9s ease-out, opacity 0.9s ease-in;`;
	popBox.appendChild(el);
	requestAnimationFrame(() => { el.style.transform = `translate(${-20 - Math.random() * 40}px, -60px)`; el.style.opacity = '0'; });
	setTimeout(() => el.remove(), 1000);
}
function hudWord() {
	return hordes.some((horde) => horde.state == 'chase') ? 'chase' : hordes.some((horde) => horde.state == 'search') ? 'search' : hordes.length ? 'hunt' : '';
}
// the round as chalk marks (1 to 5) or a number
function roundMarks(round) {
	if (round <= 0) return '';
	if (round > 5) return String(round);
	let marks = '';
	for (let k = 0; k < Math.min(round, 4); k++) marks += '<div style="width: 7px; height: 56px; background: currentColor; border-radius: 2px; transform: rotate(' + (k % 2 ? 3 : -2) + 'deg); box-shadow: 0 0 5px #000;"></div>';
	if (round == 5) marks = '<div style="position: relative; display: flex; gap: 7px;">' + marks + '<div style="position: absolute; left: -8px; top: 24px; width: 64px; height: 7px; background: currentColor; border-radius: 2px; transform: rotate(-24deg); box-shadow: 0 0 5px #000;"></div></div>';
	return marks;
}
function show(elapsed) {
	const s = joined() ? shared : hordeMode() && run.phase != 'off' ? { on: true, phase: run.phase, round: run.round, timer: run.timer, left: run.toSpawn + living(), best: run.best, kills: run.kills,
		insta: run.insta, double: run.double, chase: hudWord(), powers: powers.map((p) => [p.id, p.kind, p.x, p.y, p.z, p.age]) } : null;
	const on = !!(s && s.on && hordeMode() && hunting.hunterPlace().active);
	hud.style.display = on ? '' : 'none';
	nukeFlash = Math.max(nukeFlash - elapsed * 1.2, 0);
	flashBox.style.opacity = nukeFlash * 0.85;
	hordeStats.points = me.points;
	if (!on) { showPowers([]); return; }

	const word = s.chase == 'chase' ? '<span style="color: #ff6a4d;">They have seen you</span>' : s.chase == 'search' ? '<span style="color: #f2c46d;">They are looking for you</span>' : s.chase == 'hunt' ? '<span style="color: rgba(232, 232, 232, 0.7);">On your scent</span>' : '';
	const effects = [s.insta > 0 ? `<span style="color: #7dff6a;">Insta-Kill ${Math.ceil(s.insta)}</span>` : '', s.double > 0 ? `<span style="color: #7dff6a;">Double Points ${Math.ceil(s.double)}</span>` : ''].filter(Boolean).join(' · ');
	let top = '';
	if (s.phase == 'break') top = `<div style="font-size: 15px; font-weight: 600;">Round ${s.round + 1} in ${Math.max(Math.ceil(s.timer), 0)} s · ${roundSize(s.round + 1)} deer</div>`;
	else if (s.phase == 'round') top = `<div style="font-size: 15px; font-weight: 600;">${s.left} left</div>${word ? `<div style="font-size: 12px;">${word}</div>` : ''}`;
	else if (s.phase == 'over') top = `<div style="font-size: 15px; font-weight: 600; color: #ff6a4d;">You survived ${Math.max(s.round - 1, 0)} round${s.round == 2 ? '' : 's'} · ${s.kills} deer down</div><div style="font-size: 12px; color: rgba(232, 232, 232, 0.7);">Best: round ${s.best} · again in ${Math.max(Math.ceil(s.timer), 0)} s</div>`;
	if (effects) top += `<div style="font-size: 12px; margin-top: 2px;">${effects}</div>`;
	const key = [top, s.round, me.points].join('|');
	if (key != shownKey) {
		shownKey = key;
		topBox.innerHTML = top;
		topBox.style.display = top ? '' : 'none';
		roundBox.innerHTML = roundMarks(s.round);
		pointsBox.textContent = me.points;
	}
	showPowers(s.powers ?? []);
}
// the power-ups where they lie: a green glow on the ground (pointLights.js) and their name over it, blinking as they run out
function showPowers(list) {
	const seen = new Set(), viewProj = transformations.getViewProj(), m = metre();
	const W = innerWidth, H = innerHeight;
	list.forEach(([id, kind, x, y, z, age], k) => {
		seen.add(id);
		let el = powerEls.get(id);
		if (!el) {
			el = document.createElement('div');
			el.style.cssText = 'position: absolute; transform: translate(-50%, -50%); padding: 4px 9px; border-radius: 12px; border: 2px solid #7dff6a; background: rgba(20, 60, 15, 0.55); color: #d9ffd0; font: 700 12px system-ui, sans-serif; letter-spacing: 0.06em; white-space: nowrap; box-shadow: 0 0 14px #5cff3a, inset 0 0 8px #5cff3a; text-transform: uppercase;';
			el.textContent = POWERS[kind];
			powerLayer.appendChild(el);
			powerEls.set(id, el);
		}
		const bob = (1.1 + 0.15 * Math.sin(performance.now() / 300 + id)) * m;
		const p = [x, y + bob, z, 1];
		const c = [0, 1, 2, 3].map((r) => viewProj[r] * p[0] + viewProj[4 + r] * p[1] + viewProj[8 + r] * p[2] + viewProj[12 + r] * p[3]);
		const shown = c[3] > 0.1 && (age < POWER_SECONDS - 8 || Math.floor(performance.now() / 180) % 2 == 0);
		el.style.display = shown ? '' : 'none';
		if (shown) { el.style.left = (c[0] / c[3] * 0.5 + 0.5) * W + 'px'; el.style.top = (0.5 - c[1] / c[3] * 0.5) * H + 'px'; }
		if (k < 4) pointLights.setMovingLight('power' + k, { at: [x, y + 1.0 * m, z], radius: 8 * m, colour: [0.35, 1.0, 0.25], strength: 2.5, night: false });
	});
	for (let k = list.length; k < 4; k++) pointLights.setMovingLight('power' + k, null);
	for (const [id, el] of powerEls) if (!seen.has(id)) { el.remove(); powerEls.delete(id); }
}

// for testing
export function hordeList() {
	return hordes.map((horde) => ({ state: horde.state, milling: horde.milling, goal: horde.goal, lastKnown: horde.lastKnown, prey: horde.prey, unseen: horde.unseen, far: horde.far, pace: horde.pace, trail: horde.trail.length,
		deer: horde.deer.map((one) => ({ x: one.x, y: one.y, z: one.z, frenzy: one.frenzy, health: one.health, lunge: one.lunge, walking: one.walking, size: one.size, target: one.target })) }));
}
export function hordeRun() { return { ...run, points: me.points, owned: [...me.owned] }; }
export function hordeFollowed() { return followed; }
export function hordePowers() { return powers.map((p) => ({ ...p })); }
export function hordeShared() { return shared; }
export function skipBreak() { if (run.phase == 'break') run.timer = 0; }
// for testing: a power-up at (x, z), and points
export function dropPower(kind, x, z) { powers.push({ id: nextPower++, kind, x, y: terrain.land.heightAt(x, z), z, age: 0 }); }
export function givePointsForTest(points) { me.points += points; }
// the Start Again button (imguiLoader.js)
export function restartHorde() { if (run.phase != 'off' && !joined()) startRun(); }
// for testing: a super deer at (x, z), in the first horde
export function superForTest(x, z) { const big = newDeer(x, z, null, SUPER_SIZE); big.rank = hordes[0].deer.length; hordes[0].deer.push(big); return big; }
