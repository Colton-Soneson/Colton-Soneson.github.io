import { settings } from './settings.js';

import * as transformations from './transformations.js'
import * as terrain from './terrain.js'
import * as water from './water.js'
import * as wind from './wind.js'
import * as ballistics from './ballistics.js'
import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as plane from './plane.js'
import * as boat from './boat.js'
import * as birds from './birds.js'
import * as geese from './geese.js'
import * as deer from './deer.js'
import * as horde from './horde.js'
import * as townMask from './townMask.js'
import * as town from './town.js'
import { lightNow } from './lighting.js'

/*
	THE SOUND, all of it made here as it plays (Web Audio): not a byte of it is downloaded. Noise and oscillators, shaped by filters
	and envelopes, from what the world is doing this frame. The browser only lets a page make sound once it has been clicked or a key
	pressed, so it starts then. settings.enableSound and settings.soundVolume (the Sound folder) turn it off or down.

	THE LISTENER is the camera: its place (in metres), the way it looks and its up. Everything with a place is heard from there (a
	PannerNode each: quieter further off, and to the left or the right), late by the time sound takes to get there (SPEED_OF_SOUND),
	duller far off (the air takes the high notes: AIR), with an echo of the land (REVERB, more of it the further off). Under the water
	everything is muffled.

	THE AMBIENCE, loops of noise always playing, each turned up and down from what is round the camera (looked at every LOOK_SECONDS:
	the land under rings of points round it, AROUND), and faded out the higher it is over the ground (GROUND_FADE):
		wind in the grass		a soft rushing, as hard as the wind blows (wind.js) and gusting with it, where there is grass; the leaves
								hissing in it where there are trees; and the roar of a strong wind (and of the air past a biplane's
								cockpit, as fast as it flies)
		through the undergrowth	the walker pushing through the grass and the brush on foot, in the woods or the grassland off the footpaths,
								and on a town's grass (off its streets and walls: townMask.onTownWork)
								(footpaths.js): a dry hiss (BRUSH_BAND) fluttering quickly and unevenly as it goes (BRUSH_FLUTTER), as loud
								as it is going fast (BRUSH_PACE), none standing still, on a path, riding, in a seat or swimming
		the beach				the waves breaking on the shore: each one a crash, the wash running up and back, every WAVE_SECONDS or
								so, as loud as the shore is near (the nearest water from the land, or land from the water)
		the sea					the slosh of open water round the camera, near it or on it (on a boat, more)
		crickets				at night, in the grass
	THE WILDLIFE: songbirds in the day, a phrase now and then from somewhere round about, more of them in the trees; the hawks (birds.js)
	screaming as they circle, near enough; the geese (geese.js) honking as they fly over; the deer (deer.js) snorting close by; the
	horde (horde.js) growling, the frenzied ones louder.
	THE GUNS (ballistics.onAnyShot): every round's report, each its own (REPORTS: the crack of the powder, the boom under it and the
	rumble after, by how big a round it is and how fast), wherever it was fired (the others' and the townsfolk's as well); and the
	workings of the gun in the hands (weapons.actionSound): the click on nothing, a bolt, a pump, a lever, a hammer cocked, a round
	pushed in, a pan.
	THE ENGINES: each biplane's Falcon (plane.js), a V12: its firing (six beats a turn) and its propeller's chop (two blades), as fast as
	it turns, rough when it misfires, higher coming and lower going (Doppler), up to ENGINES of them, the nearest.
*/
const SPEED_OF_SOUND = 343;			// metres a second
const AIR = 140;					// metres: this far off a sound has lost half its brightness
const LOOK_SECONDS = 0.3;
const AROUND = [8, 20, 45];			// metres: the rings of points round the camera the land is looked at
const GROUND_FADE = 90;				// metres over the ground: the ground's sounds gone
const BRUSH_BAND = { below: 1200, centre: 2600, width: 0.8 };	// hertz: the undergrowth's hiss, cut away under below, round centre (and its Q)
const BRUSH_FLUTTER = [[4.7, 0.13], [7.9, 0.1], [12.3, 0.08]];	// its flutter: wobbles a second, and how far each turns its loudness up and down
const BRUSH_PACE = 4;				// metres a second: walking this fast it is as loud as it gets (running, a little louder still)
const WAVE_SECONDS = [6.5, 10];
const ENGINES = 3;
const MOST_SHOTS = 24;				// reports at once, at the most (a Lewis gun and a few others)
// each round's report: the crack (its bandpass, how loud), the boom (the sweep down, how loud, how long it rings) and the rumble after
const REPORTS = {
	'7.62x54R': { crack: [3400, 1.0], boom: [170, 48, 0.9, 0.13], rumble: [900, 0.6, 0.35] },
	'.303 British': { crack: [3200, 0.85], boom: [160, 50, 0.8, 0.1], rumble: [850, 0.5, 0.28] },
	'.303 Vickers': { crack: [3200, 0.85], boom: [160, 50, 0.8, 0.1], rumble: [850, 0.5, 0.28] },
	'00 buck': { crack: [2200, 0.7], boom: [125, 40, 1.2, 0.18], rumble: [620, 0.8, 0.45] },
	'.45 Colt': { crack: [2000, 0.6], boom: [115, 45, 1.0, 0.14], rumble: [700, 0.55, 0.3] },
	'.45-70': { crack: [2400, 0.8], boom: [95, 34, 1.35, 0.22], rumble: [560, 0.85, 0.5] },
	'7.63 Mauser': { crack: [4200, 0.9], boom: [210, 60, 0.6, 0.08], rumble: [1000, 0.4, 0.22] },
	'80mm': { crack: [1100, 1.3], boom: [80, 30, 1.7, 0.3], rumble: [260, 1.2, 0.9] },
};

const metre = () => settings.forestUnitsPerMetre;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export const soundStats = { running: false, shots: 0, birds: 0, calls: 0, engines: 0, actions: 0, bangs: 0, levels: {} };

// The graph (made once the page has been clicked)
//-------------------------------------------------
let ctx = null, master = null, muffle = null, effects = null, ambience = null, reverb = null, analyser = null;
let white = null, brown = null;
const beds = {};		// each loop: { gain (its GainNode), ... }
function start() {
	if (ctx) { if (ctx.state == 'suspended') ctx.resume().catch(() => {}); return; }
	try { ctx = new AudioContext(); } catch (error) { return; }
	build();
}
for (const type of ['pointerdown', 'keydown', 'mousedown']) window.addEventListener(type, start, true);

function build() {
	const rate = ctx.sampleRate;
	// two seconds of noise, white and brown (the white run through a leaky sum: deeper)
	white = ctx.createBuffer(1, rate * 2, rate);
	brown = ctx.createBuffer(1, rate * 2, rate);
	const w = white.getChannelData(0), b = brown.getChannelData(0);
	let last = 0;
	for (let i = 0; i < w.length; i++) { w[i] = Math.random() * 2 - 1; last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5; }
	// the echo of the land: a second and a half of noise dying away, a little different each ear
	const length = Math.floor(rate * 1.6);
	const tail = ctx.createBuffer(2, length, rate);
	for (let c = 0; c < 2; c++) { const d = tail.getChannelData(c); for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2) * (i < rate * 0.012 ? i / (rate * 0.012) : 1); }
	const compressor = ctx.createDynamicsCompressor();
	compressor.threshold.value = -14; compressor.ratio.value = 6; compressor.attack.value = 0.003; compressor.release.value = 0.2;
	muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000;
	master = ctx.createGain(); master.gain.value = 0;
	analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
	muffle.connect(master); master.connect(compressor); compressor.connect(ctx.destination); compressor.connect(analyser);
	effects = ctx.createGain(); effects.connect(muffle);
	ambience = ctx.createGain(); ambience.connect(muffle);
	reverb = ctx.createConvolver(); reverb.buffer = tail;
	const wet = ctx.createGain(); wet.gain.value = 0.55; reverb.connect(wet); wet.connect(muffle);

	// THE AMBIENCE (see the top)
	const loop = (buffer, ...chain) => {
		const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
		let node = source;
		for (const next of chain) { node.connect(next); node = next; }
		const gain = ctx.createGain(); gain.gain.value = 0; node.connect(gain); gain.connect(ambience);
		source.start(0, Math.random() * 2);
		return gain;
	};
	const filter = (type, frequency, Q = 0.7) => { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = Q; return f; };
	beds.grass = loop(white, filter('bandpass', 950, 0.45), filter('lowpass', 3200));
	// through the undergrowth: its hiss, and its flutter (a few wobbles a little out of step with each other, on its loudness)
	const flutter = ctx.createGain(); flutter.gain.value = 1 - BRUSH_FLUTTER.reduce((sum, [, depth]) => sum + depth, 0);
	for (const [rate, depth] of BRUSH_FLUTTER) {
		const wobble = ctx.createOscillator(); wobble.frequency.value = rate * (0.9 + 0.2 * Math.random());
		const amount = ctx.createGain(); amount.gain.value = depth;
		wobble.connect(amount); amount.connect(flutter.gain); wobble.start();
	}
	beds.brush = loop(white, filter('highpass', BRUSH_BAND.below, 0.7), filter('bandpass', BRUSH_BAND.centre, BRUSH_BAND.width), flutter);
	beds.leaves = loop(white, filter('highpass', 3200), filter('peaking', 6000, 1));
	beds.roar = loop(brown, filter('lowpass', 320));
	beds.surfFilter = filter('lowpass', 700, 0.5);
	beds.surfSwell = ctx.createGain(); beds.surfSwell.gain.value = 0.1;
	beds.surf = loop(white, beds.surfFilter, beds.surfSwell);
	beds.surfLow = loop(brown, filter('lowpass', 260));
	beds.sloshSwell = ctx.createGain(); beds.sloshSwell.gain.value = 0.5;
	beds.slosh = loop(brown, filter('lowpass', 520), beds.sloshSwell);
	beds.splash = loop(white, filter('bandpass', 1400, 1.2));
	// crickets: a high note pulsing thirty times a second, in chirps
	const cricket = ctx.createOscillator(); cricket.frequency.value = 4600;
	const pulse = ctx.createOscillator(); pulse.type = 'square'; pulse.frequency.value = 29;
	const pulseDepth = ctx.createGain(); pulseDepth.gain.value = 0.5;
	const pulsed = ctx.createGain(); pulsed.gain.value = 0.5;
	pulse.connect(pulseDepth); pulseDepth.connect(pulsed.gain);
	beds.chirp = ctx.createGain(); beds.chirp.gain.value = 0;
	beds.crickets = ctx.createGain(); beds.crickets.gain.value = 0;
	cricket.connect(pulsed); pulsed.connect(beds.chirp); beds.chirp.connect(beds.crickets); beds.crickets.connect(ambience);
	cricket.start(); pulse.start();
	soundStats.running = true;
}

// a place in the world (world units) as the listener has it (metres)
const toMetres = (p) => [p[0] / metre(), p[1] / metre(), p[2] / metre()];
function listenerPlace() { return [settings.camPosX / metre(), settings.camPosY / metre(), settings.camPosZ / metre()]; }
// a sound's way out to the world from a place (metres): far off, late, dull, with more echo. Gives { input (connect to it), delay (s), distance }
function placed(at, { ref = 8, echo = 1, bus = effects } = {}) {
	const here = listenerPlace();
	const distance = Math.hypot(at[0] - here[0], at[1] - here[1], at[2] - here[2]);
	const panner = ctx.createPanner();
	panner.panningModel = 'equalpower'; panner.distanceModel = 'inverse'; panner.refDistance = ref; panner.rolloffFactor = 1; panner.maxDistance = 10000;
	panner.positionX.value = at[0]; panner.positionY.value = at[1]; panner.positionZ.value = at[2];
	const dull = ctx.createBiquadFilter(); dull.type = 'lowpass'; dull.frequency.value = 18000 / (1 + distance / AIR);
	dull.connect(panner); panner.connect(bus);
	const send = ctx.createGain(); send.gain.value = echo * (0.08 + Math.min(distance / 700, 0.55)); dull.connect(send); send.connect(reverb);
	return { input: dull, delay: distance / SPEED_OF_SOUND, distance };
}
// noise through a filter, enveloped: up in attack, down to nothing by decay (time constant)
function noise({ to, when, attack = 0.002, peak = 1, decay = 0.1, length = 0.6, type = 'bandpass', frequency = 1000, Q = 0.8, buffer = white }) {
	const source = ctx.createBufferSource(); source.buffer = buffer;
	const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = frequency; f.Q.value = Q;
	const g = ctx.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(peak, when + attack); g.gain.setTargetAtTime(0, when + attack, decay);
	source.connect(f); f.connect(g); g.connect(to);
	source.start(when, Math.random() * 1.2, length + attack);
	return { source, filter: f, gain: g };
}
// a tone, swept from f0 to f1 over sweep seconds, enveloped
function tone({ to, when, f0, f1 = f0, sweep = 0.1, type = 'sine', peak = 1, attack = 0.004, decay = 0.08, length = 0.5 }) {
	const o = ctx.createOscillator(); o.type = type;
	o.frequency.setValueAtTime(f0, when); if (f1 != f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), when + sweep);
	const g = ctx.createGain(); g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(peak, when + attack); g.gain.setTargetAtTime(0, when + attack, decay);
	o.connect(g); g.connect(to);
	o.start(when); o.stop(when + attack + length);
	return { osc: o, gain: g };
}

// THE GUNS (see the top)
//-------------------------------------------------
let recent = [];
ballistics.onAnyShot((from, round) => {
	if (!ctx || ctx.state != 'running' || ballistics.ROUNDS[round]?.carried) return;		// (a bomb let go is no report)
	const now = ctx.currentTime;
	const at = toMetres(from);
	// (the others' shells come as nine pellets, each fired here for its trail: one report)
	recent = recent.filter((r) => now - r.t < 0.05);
	if (recent.some((r) => Math.hypot(r.at[0] - at[0], r.at[1] - at[1], r.at[2] - at[2]) < 0.5)) return;
	recent.push({ t: now, at });
	if (shotsPlaying >= MOST_SHOTS) return;
	report(at, REPORTS[round] ?? REPORTS['7.62x54R']);
});
let shotsPlaying = 0;
function report(at, R) {
	const way = placed(at, { ref: 10, echo: 1.2 });
	if (way.distance > 3000) return;
	const when = ctx.currentTime + way.delay + 0.005;
	const loud = ctx.createGain(); loud.gain.value = 0.9; loud.connect(way.input);
	noise({ to: loud, when, peak: R.crack[1], decay: 0.018, length: 0.15, frequency: R.crack[0], Q: 0.7 });
	noise({ to: loud, when, peak: R.crack[1] * 0.5, decay: 0.008, length: 0.06, type: 'highpass', frequency: 5000 });
	tone({ to: loud, when, f0: R.boom[0], f1: R.boom[1], sweep: 0.25, peak: R.boom[2], decay: R.boom[3], length: R.boom[3] * 6 });
	noise({ to: loud, when: when + 0.004, peak: R.rumble[1], attack: 0.01, decay: R.rumble[2], length: R.rumble[2] * 5, type: 'lowpass', frequency: R.rumble[0], Q: 0.5, buffer: brown });
	soundStats.shots++;
	shotsPlaying++;
	setTimeout(() => { shotsPlaying--; }, (way.delay + 1.2) * 1000);
}

// a plane or a boat shot to pieces (plane.js, boat.js): a crack, a deep thump that rolls on, and the bits of it coming apart after
function bang(at) {
	if (!ctx || ctx.state != 'running') return;
	const way = placed(toMetres(at), { ref: 18, echo: 1.6 });
	if (way.distance > 4000) return;
	const when = ctx.currentTime + way.delay + 0.005;
	noise({ to: way.input, when, peak: 1.3, decay: 0.05, length: 0.3, frequency: 1400, Q: 0.6 });
	tone({ to: way.input, when, f0: 70, f1: 28, sweep: 0.6, peak: 1.5, decay: 0.35, length: 2 });
	noise({ to: way.input, when: when + 0.01, peak: 1.0, attack: 0.03, decay: 0.7, length: 3.5, type: 'lowpass', frequency: 300, Q: 0.5, buffer: brown });
	for (let k = 0; k < 6; k++) noise({ to: way.input, when: when + 0.15 + Math.random() * 0.9, peak: 0.25, decay: 0.02, length: 0.08, frequency: 900 + Math.random() * 2000, Q: 2 });
	soundStats.bangs++;
}
plane.onBreak(bang);
boat.onBreak(bang);
town.onCollapse((at) => { bang(at); bang(at); });		// (a house coming down: twice over)
ballistics.onBurst((at) => bang(at));		// (a howitzer's shell: shipGuns.js)

// the workings of the gun in the hands: small, close, dry (see weapons.actionSound)
const ACTIONS = {
	click: [[0, 'tick', 3200, 0.5]],
	bolt: [[0, 'slide', 1500, 0.55, 0.09], [0.06, 'tick', 2400, 0.45]],
	turn: [[0, 'tick', 1900, 0.4], [0.03, 'slide', 1100, 0.25, 0.05]],
	pump: [[0, 'slide', 1200, 0.65, 0.07], [0.05, 'tick', 2000, 0.5]],
	lever: [[0, 'slide', 900, 0.45, 0.1], [0.08, 'tick', 1700, 0.4]],
	cock: [[0, 'tick', 2600, 0.35], [0.05, 'tick', 3000, 0.5]],
	load: [[0, 'slide', 2200, 0.25, 0.04], [0.05, 'tick', 2800, 0.3]],
	eject: [[0, 'slide', 1800, 0.3, 0.05], [0.2, 'tick', 4200, 0.15]],
	gate: [[0, 'tick', 2300, 0.35]],
	tick: [[0, 'tick', 3600, 0.25]],
	clip: [[0, 'slide', 1600, 0.5, 0.25], [0.3, 'tick', 2600, 0.35]],
	pan: [[0, 'thud', 260, 0.6], [0.05, 'tick', 1800, 0.45]],
	deploy: [[0, 'thud', 180, 0.5], [0.15, 'slide', 700, 0.35, 0.2], [0.4, 'tick', 1500, 0.35]],
	knock: [[0, 'thud', 420, 0.7], [0.005, 'tick', 1300, 0.45]],
	shell: [[0, 'slide', 700, 0.45, 0.22], [0.24, 'thud', 160, 0.75], [0.27, 'tick', 2100, 0.35]],
};
weapons.setSoundHook((kind) => {
	if (!ctx || ctx.state != 'running') return;
	const now = ctx.currentTime;
	for (const [after, what, frequency, peak, length = 0.04] of ACTIONS[kind] ?? []) {
		const when = now + after;
		if (what == 'tick') { noise({ to: effects, when, peak: peak * 0.6, decay: 0.006, length: 0.04, frequency, Q: 4 }); tone({ to: effects, when, f0: frequency * 1.7, peak: peak * 0.15, decay: 0.008, length: 0.04 }); }
		if (what == 'slide') noise({ to: effects, when, attack: length * 0.3, peak: peak * 0.4, decay: length * 0.5, length: length * 2, frequency, Q: 1.5 });
		if (what == 'thud') { tone({ to: effects, when, f0: frequency, f1: frequency * 0.6, sweep: 0.08, peak: peak * 0.6, decay: 0.05, length: 0.2 }); noise({ to: effects, when, peak: peak * 0.3, decay: 0.03, length: 0.1, type: 'lowpass', frequency: 900 }); }
	}
	soundStats.actions++;
});

// THE WILDLIFE (see the top)
//-------------------------------------------------
// a songbird's phrase from a place: one of a few kinds of song, each note a quick sweep
function birdsong(at) {
	const way = placed(at, { ref: 6, echo: 0.6, bus: ambience });
	const when = ctx.currentTime + way.delay;
	const kind = Math.floor(Math.random() * 4);
	const base = 2600 + Math.random() * 2200;
	const notes = kind == 0 ? 3 + Math.floor(Math.random() * 4) : kind == 1 ? 2 : kind == 2 ? 8 + Math.floor(Math.random() * 8) : 4;
	for (let k = 0; k < notes; k++) {
		const t = when + (kind == 2 ? k * 0.045 : k * (0.11 + Math.random() * 0.08));
		const up = kind == 1 ? 1.35 : kind == 3 ? 0.7 : 0.85 + Math.random() * 0.5;
		const f = base * (kind == 3 ? 1 + k * 0.08 : 0.85 + Math.random() * 0.35);
		tone({ to: way.input, when: t, f0: f, f1: f * up, sweep: kind == 2 ? 0.03 : 0.07, peak: 0.12, attack: 0.008, decay: kind == 2 ? 0.015 : 0.035, length: 0.15 });
	}
	soundStats.birds++;
}
// a hawk's scream: a long high note falling away, a little rough
function hawkCall(at) {
	const way = placed(at, { ref: 25, echo: 1 });
	const when = ctx.currentTime + way.delay;
	const { osc, gain } = tone({ to: way.input, when, f0: 2900, f1: 1700, sweep: 0.9, type: 'sawtooth', peak: 0.12, attack: 0.05, decay: 0.45, length: 1.6 });
	const rough = ctx.createOscillator(); rough.frequency.value = 55; const depth = ctx.createGain(); depth.gain.value = 140;
	rough.connect(depth); depth.connect(osc.frequency); rough.start(when); rough.stop(when + 1.6);
	soundStats.calls++;
}
// a goose's honk: a nasal note, a vowel over it
function honk(at) {
	const way = placed(at, { ref: 20, echo: 1 });
	const when = ctx.currentTime + way.delay;
	const vowel = ctx.createBiquadFilter(); vowel.type = 'bandpass'; vowel.frequency.value = 1100; vowel.Q.value = 3; vowel.connect(way.input);
	const f = 330 + Math.random() * 90;
	tone({ to: vowel, when, f0: f * 1.15, f1: f, sweep: 0.12, type: 'sawtooth', peak: 0.9, attack: 0.015, decay: 0.09, length: 0.35 });
	if (Math.random() < 0.5) tone({ to: vowel, when: when + 0.22, f0: f * 1.1, f1: f * 0.95, sweep: 0.1, type: 'sawtooth', peak: 0.7, attack: 0.015, decay: 0.07, length: 0.3 });
	soundStats.calls++;
}
// a deer's snort: a burst of breath; a feral one's growl: low, rasping, longer, the frenzied louder and harsher
function snort(at) {
	const way = placed(at, { ref: 6, echo: 0.5 });
	noise({ to: way.input, when: ctx.currentTime + way.delay, attack: 0.02, peak: 0.5, decay: 0.09, length: 0.4, frequency: 900, Q: 0.9 });
	soundStats.calls++;
}
function growl(at, frenzy, size = 1) {
	const way = placed(at, { ref: 6 * size, echo: 0.7 });
	const when = ctx.currentTime + way.delay;
	const length = 0.5 + Math.random() * 0.6;
	const throat = ctx.createBiquadFilter(); throat.type = 'bandpass'; throat.frequency.value = (frenzy ? 650 : 480) / Math.sqrt(size); throat.Q.value = 2; throat.connect(way.input);
	const f = (frenzy ? 120 : 85) / size;
	const { osc } = tone({ to: throat, when, f0: f, f1: f * 0.8, sweep: length, type: 'sawtooth', peak: frenzy ? 0.9 : 0.5, attack: 0.06, decay: length * 0.5, length: length * 1.6 });
	const rasp = ctx.createOscillator(); rasp.frequency.value = 23 + Math.random() * 10; const depth = ctx.createGain(); depth.gain.value = f * 0.35;
	rasp.connect(depth); depth.connect(osc.frequency); rasp.start(when); rasp.stop(when + length * 1.6);
	noise({ to: throat, when, attack: 0.05, peak: frenzy ? 0.35 : 0.2, decay: length * 0.5, length: length * 1.5, frequency: 700, Q: 1 });
	soundStats.calls++;
}

// THE ENGINES (see the top)
//-------------------------------------------------
const voices = new Map();		// plane id -> { nodes }
function engineVoice() {
	const v = {};
	v.out = ctx.createGain(); v.out.gain.value = 0;
	v.panner = ctx.createPanner(); v.panner.panningModel = 'equalpower'; v.panner.distanceModel = 'inverse'; v.panner.refDistance = 7; v.panner.rolloffFactor = 1; v.panner.maxDistance = 10000;
	v.tone = ctx.createBiquadFilter(); v.tone.type = 'lowpass'; v.tone.frequency.value = 900; v.tone.Q.value = 0.8;
	const shaper = ctx.createWaveShaper();
	const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(2.2 * x); }
	shaper.curve = curve;
	v.fire = ctx.createOscillator(); v.fire.type = 'sawtooth';
	v.under = ctx.createOscillator(); v.under.type = 'square';
	const fireGain = ctx.createGain(); fireGain.gain.value = 0.5;
	const underGain = ctx.createGain(); underGain.gain.value = 0.35;
	v.fire.connect(fireGain); v.under.connect(underGain);
	// the propeller's chop: the sound beaten at the blades' passing
	v.chop = ctx.createGain(); v.chop.gain.value = 0.7;
	v.blade = ctx.createOscillator(); v.blade.frequency.value = 40;
	const bladeDepth = ctx.createGain(); bladeDepth.gain.value = 0.3;
	v.blade.connect(bladeDepth); bladeDepth.connect(v.chop.gain);
	fireGain.connect(shaper); underGain.connect(shaper); shaper.connect(v.tone); v.tone.connect(v.chop); v.chop.connect(v.out);
	// the exhaust's and the propeller's noise
	v.hiss = ctx.createGain(); v.hiss.gain.value = 0;
	const hissSource = ctx.createBufferSource(); hissSource.buffer = white; hissSource.loop = true;
	const hissFilter = ctx.createBiquadFilter(); hissFilter.type = 'bandpass'; hissFilter.frequency.value = 1200; hissFilter.Q.value = 0.4;
	hissSource.connect(hissFilter); hissFilter.connect(v.hiss); v.hiss.connect(v.chop);
	v.out.connect(v.panner); v.panner.connect(effects);
	const send = ctx.createGain(); send.gain.value = 0.15; v.out.connect(send); send.connect(reverb);
	v.fire.start(); v.under.start(); v.blade.start(); hissSource.start(0, Math.random());
	v.sources = [v.fire, v.under, v.blade, hissSource];
	return v;
}
function stopVoice(v) {
	v.out.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
	setTimeout(() => { for (const s of v.sources) { try { s.stop(); } catch (error) {} } v.out.disconnect(); }, 600);
}
function engines(now) {
	const here = listenerPlace();
	const place = hunting.hunterPlace();
	const near = plane.planes.filter((p) => p.engine.rpm > 40).map((p) => ({ p, at: toMetres(p.frame.toWorld([0, 0.05, 2.6])) }))
		.map((one) => ({ ...one, d: Math.hypot(one.at[0] - here[0], one.at[1] - here[1], one.at[2] - here[2]) })).filter((one) => one.d < 3000).sort((a, b) => a.d - b.d).slice(0, ENGINES);
	const wanted = new Set(near.map((one) => one.p.id));
	for (const [id, v] of voices) if (!wanted.has(id)) { stopVoice(v); voices.delete(id); }
	for (const { p, at, d } of near) {
		let v = voices.get(p.id);
		if (!v) { v = engineVoice(); voices.set(p.id, v); }
		// coming nearer, higher; going away, lower (not in it)
		const aboard = place.vehicle === p.id;
		const toward = d > 1 ? -(p.v[0] * (at[0] - here[0]) + p.v[1] * (at[1] - here[1]) + p.v[2] * (at[2] - here[2])) / d : 0;
		const doppler = aboard ? 1 : clamp(SPEED_OF_SOUND / (SPEED_OF_SOUND - clamp(toward, -150, 150)), 0.7, 1.45);
		const rpm = p.engine.rpm, turn = rpm / 60;
		const k = 0.08;
		v.fire.frequency.setTargetAtTime(Math.max(turn * 6, 8) * doppler, now, k);
		v.under.frequency.setTargetAtTime(Math.max(turn * 3, 4) * doppler, now, k);
		v.blade.frequency.setTargetAtTime(Math.max(turn * 2, 2) * doppler, now, k);
		v.tone.frequency.setTargetAtTime((400 + rpm * 0.9) * (aboard ? 0.8 : 1), now, k);
		const running = p.engine.on ? 1 : 0.25;
		const rough = p.engine.misfire > 0 ? 0.3 : 1;
		v.out.gain.setTargetAtTime((0.12 + 0.3 * rpm / plane.RPM_MAX) * running * rough, now, 0.04);
		v.hiss.gain.setTargetAtTime(0.25 * rpm / plane.RPM_MAX, now, 0.1);
		v.panner.positionX.setTargetAtTime(at[0], now, 0.03); v.panner.positionY.setTargetAtTime(at[1], now, 0.03); v.panner.positionZ.setTargetAtTime(at[2], now, 0.03);
	}
	soundStats.engines = voices.size;
}

// Per frame (see the top)
//-------------------------------------------------
const around = { grass: 0, forest: 0, water: 0, shore: 1e9, beach: 0, over: 0, at: 0, undergrowth: false };
const timers = { bird: 2, hawk: 3, geese: 1, deer: 2, horde: 0.5, wave: 0, chirp: 0 };
let lastTime = performance.now();
// what is round the camera (see THE AMBIENCE at the top)
function lookAround() {
	const land = terrain.land, m = metre();
	if (!land) return;
	const sea = settings.waterWorldPosY;
	const x = settings.camPosX, z = settings.camPosZ;
	const ground = land.heightAt(x, z);
	const wet = (gx, gz) => land.heightAt(gx, gz) < sea;
	const hereWet = wet(x, z);
	let grass = 0, forest = 0, waterAround = 0, weight = 0, shore = hereWet ? 0 : 1e9, beach = 0;
	const zoneWeight = (zone, w) => {
		if (zone == terrain.ZONE_GRASSLAND || zone == terrain.ZONE_MARSH || zone == terrain.ZONE_TOWN) grass += w;
		if (zone == terrain.ZONE_FOREST) { forest += w; grass += w * 0.5; }
		if (zone == terrain.ZONE_BEACH) beach = 1;
	};
	zoneWeight(land.zoneAt(x, z), 2);
	weight += 2;
	if (hereWet) waterAround += 2;
	for (const r of AROUND) {
		for (let k = 0; k < 8; k++) {
			const a = k / 8 * Math.PI * 2, gx = x + Math.cos(a) * r * m, gz = z + Math.sin(a) * r * m;
			const w = 1 / (1 + r / 15);
			weight += w;
			const isWet = wet(gx, gz);
			if (isWet) waterAround += w;
			else zoneWeight(land.zoneAt(gx, gz), w);
			if (isWet != hereWet) shore = Math.min(shore, hereWet ? 0 : r);
		}
	}
	// over the water: how far to the nearest land, the other way round
	if (hereWet) {
		shore = 1e9;
		for (const r of [10, 25, 50, 90, 150]) {
			for (let k = 0; k < 8 && shore > 1e8; k++) { const a = k / 8 * Math.PI * 2; if (!wet(x + Math.cos(a) * r * m, z + Math.sin(a) * r * m)) shore = r; }
			if (shore < 1e8) break;
		}
	}
	// under the walker's feet: the woods, the grassland or a town's grass, off the footpaths
	const feet = hunting.hunterPlace(), underfoot = land.zoneAt(feet.x, feet.z);
	const grassy = underfoot == terrain.ZONE_FOREST || underfoot == terrain.ZONE_GRASSLAND || (underfoot == terrain.ZONE_TOWN && !townMask.onTownWork(feet.x, feet.z));
	const undergrowth = grassy && !land.onPath?.(feet.x, feet.z);
	Object.assign(around, { grass: settings.enableGrass ? grass / weight : 0, forest: forest / weight, water: waterAround / weight, shore, beach, over: (settings.camPosY - Math.max(ground, sea)) / m, undergrowth });
}

export function soundUpdate() {
	const now = performance.now();
	const elapsed = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (!ctx || ctx.state != 'running' || !master) return;
	const t = ctx.currentTime;
	const on = settings.enableSound;
	master.gain.setTargetAtTime(on ? settings.soundVolume : 0, t, 0.05);
	if (!on) return;
	// the listener: the camera
	const here = listenerPlace(), f = transformations.getCameraForward(), up = transformations.viewUp, L = ctx.listener;
	if (L.positionX) {
		L.positionX.setValueAtTime(here[0], t); L.positionY.setValueAtTime(here[1], t); L.positionZ.setValueAtTime(here[2], t);
		L.forwardX.setValueAtTime(f[0], t); L.forwardY.setValueAtTime(f[1], t); L.forwardZ.setValueAtTime(f[2], t);
		L.upX.setValueAtTime(up[0], t); L.upY.setValueAtTime(up[1], t); L.upZ.setValueAtTime(up[2], t);
	} else { L.setPosition(...here); L.setOrientation(...f, ...up); }
	// under the water: muffled
	const surface = water.cameraWater.height ?? settings.waterWorldPosY;
	const under = settings.enableWater && settings.camPosY < surface - 0.2 * metre();
	muffle.frequency.setTargetAtTime(under ? 450 : 20000, t, 0.08);

	timers.look = (timers.look ?? 0) - elapsed;
	if (timers.look <= 0) { lookAround(); timers.look = LOOK_SECONDS; }
	const ground = clamp(1 - around.over / GROUND_FADE, 0, 1);
	const light = lightNow(), day = light.daylight, night = 1 - smoothish(day);
	const blow = clamp(wind.windSpeedNow() / 15, 0, 1.6);
	const gust = wind.windAtPoint(settings.camPosX, settings.camPosZ)[2];
	const place = hunting.hunterPlace();
	const ride = place.vehicle ? plane.planeById(place.vehicle) : null;
	const rush = ride ? clamp(ride.airspeed / 50, 0, 1.5) : 0;
	const set = (node, value, k = 0.3) => node.gain.setTargetAtTime(value, t, k);
	set(beds.grass, 0.4 * blow * (0.55 + 0.9 * gust) * around.grass * ground);
	// through the undergrowth, on foot off the paths: as loud as the walker is going fast
	const onFoot = place.active && place.on == 'land' && place.grounded && !place.swimming && hunting.hunterLife.alive && around.undergrowth;
	const pace = onFoot ? Math.hypot(place.vx ?? 0, place.vz ?? 0) / metre() : 0;
	set(beds.brush, 0.35 * clamp(pace / BRUSH_PACE, 0, 1.3), 0.12);
	set(beds.leaves, 0.12 * blow * (0.3 + 1.2 * gust) * around.forest * ground);
	set(beds.roar, 0.05 * blow * blow * (0.5 + gust) + 0.3 * rush * rush);
	// the beach: as near as the shore is, a wave at a time
	const shoreGain = around.shore > 1e8 ? 0 : (0.5 + 0.5 * around.beach) / (1 + Math.pow(around.shore / 22, 1.5));
	set(beds.surf, 0.55 * shoreGain * ground, 0.5);
	set(beds.surfLow, 0.35 * shoreGain * ground, 0.5);
	timers.wave -= elapsed;
	if (timers.wave <= 0) {
		timers.wave = WAVE_SECONDS[0] + Math.random() * (WAVE_SECONDS[1] - WAVE_SECONDS[0]);
		const s = beds.surfSwell.gain, fr = beds.surfFilter.frequency;
		s.cancelScheduledValues(t); fr.cancelScheduledValues(t);
		s.setValueAtTime(s.value, t); s.linearRampToValueAtTime(1, t + 0.5); s.setTargetAtTime(0.45, t + 0.6, 0.6); s.setTargetAtTime(0.08, t + 2.6, 1.4);
		fr.setValueAtTime(fr.value, t); fr.linearRampToValueAtTime(2600, t + 0.45); fr.setTargetAtTime(1100, t + 0.7, 0.8); fr.setTargetAtTime(500, t + 3, 1.5);
	}
	// the open water: round the camera, near it, on a boat more
	const aboardBoat = place.on == 'deck' || place.on == 'seat' || place.on == 'ladder';
	const sea = around.water * clamp(1 - around.over / 35, 0, 1) + (aboardBoat ? 0.4 : 0) + (place.swimming ? 0.5 : 0);
	set(beds.slosh, 0.4 * sea, 0.5);
	beds.sloshSwell.gain.setTargetAtTime(0.45 + 0.55 * Math.max(Math.sin(now / 1000 * 1.3) * Math.sin(now / 1000 * 0.47 + 1), 0), t, 0.4);
	set(beds.splash, 0.06 * sea * (0.4 + Math.max(Math.sin(now / 1000 * 2.1 + Math.sin(now / 1000 * 0.7) * 2), 0)), 0.15);
	// crickets, at night in the grass, in chirps
	set(beds.crickets, 0.035 * night * night * around.grass * ground, 1);
	timers.chirp -= elapsed;
	if (timers.chirp <= 0) {
		timers.chirp = 0.45 + Math.random() * 0.5;
		const g = beds.chirp.gain;
		g.setValueAtTime(0, t); g.linearRampToValueAtTime(1, t + 0.02); g.setValueAtTime(1, t + 0.12); g.linearRampToValueAtTime(0, t + 0.16);
	}

	// the wildlife (see the top)
	const lively = (around.grass + around.forest * 1.5) * ground;
	timers.bird -= elapsed;
	if (timers.bird <= 0) {
		timers.bird = (1.5 + Math.random() * 4.5) / Math.max(lively, 0.15);
		if (day > 0.3 && lively > 0.15 && Math.random() < day) {
			const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 40;
			birdsong([here[0] + Math.cos(a) * r, here[1] + 2 + Math.random() * 7, here[2] + Math.sin(a) * r]);
		}
	}
	const m = metre();
	timers.hawk -= elapsed;
	if (timers.hawk <= 0) {
		timers.hawk = 3;
		const near = birds.birdPlaces().filter((b) => !b.landed && Math.hypot(b.x / m - here[0], b.y / m - here[1], b.z / m - here[2]) < 260);
		if (near.length && Math.random() < 0.35) { const b = near[Math.floor(Math.random() * near.length)]; hawkCall(toMetres([b.x, b.y, b.z])); }
	}
	timers.geese -= elapsed;
	if (timers.geese <= 0) {
		timers.geese = 0.7 + Math.random() * 1.2;
		const flock = geese.geesePlaces().filter((g) => Math.hypot(g.x / m - here[0], g.y / m - here[1], g.z / m - here[2]) < 380);
		if (flock.length && Math.random() < (flock[0].landed ? 0.15 : 0.7)) { const g = flock[Math.floor(Math.random() * flock.length)]; honk(toMetres([g.x, g.y + 0.5 * m, g.z])); }
	}
	timers.deer -= elapsed;
	if (timers.deer <= 0) {
		timers.deer = 1;
		const close = [];
		deer.deerNear(settings.camPosX, settings.camPosZ, 45 * m, (x, y, z) => close.push([x, y + 1.1 * m, z]));
		if (close.length && Math.random() < 0.12) snort(toMetres(close[Math.floor(Math.random() * close.length)]));
	}
	timers.horde -= elapsed;
	if (timers.horde <= 0) {
		timers.horde = 0.35;
		const close = [];
		horde.hordeNear(settings.camPosX, settings.camPosZ, 80 * m, (x, y, z, frenzy, size) => close.push([[x, y + 1.1 * m * (size ?? 1), z], frenzy, size ?? 1]));
		for (let k = 0; k < Math.min(close.length, 2); k++) {
			const [at, frenzy, size] = close[Math.floor(Math.random() * close.length)];
			if (Math.random() < (frenzy ? 0.45 : 0.15)) growl(toMetres(at), frenzy, size);
		}
	}
	engines(t);
	// for testing: how loud it is coming out, and each loop
	if (analyser) {
		const data = new Float32Array(analyser.fftSize);
		analyser.getFloatTimeDomainData(data);
		let sum = 0, peak = 0;
		for (const v of data) { sum += v * v; peak = Math.max(peak, Math.abs(v)); }
		soundStats.levels = { rms: Math.sqrt(sum / data.length), peak, grass: beds.grass.gain.value, leaves: beds.leaves.gain.value, roar: beds.roar.gain.value, brush: beds.brush.gain.value, surf: beds.surf.gain.value,
			slosh: beds.slosh.gain.value, crickets: beds.crickets.gain.value, shore: around.shore, water: around.water, grassAround: around.grass, forestAround: around.forest };
	}
}
const smoothish = (v) => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };
// for testing: start the sound without a click (the harness's browser lets it)
export function startForTest() { start(); return ctx?.state; }
