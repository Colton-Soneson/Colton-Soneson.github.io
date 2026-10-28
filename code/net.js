import { canvas } from './deviceSelection.js'
import { settings } from './settings.js';
import { imguiParams, gui } from './imguiLoader.js';
import * as atmosphere from './atmosphere.js'
import * as hunting from './hunting.js'
import * as ballistics from './ballistics.js'
import * as transformations from './transformations.js'
import * as players from './players.js'
import * as forest from './forest.js'
import * as deer from './deer.js'
import * as birds from './birds.js'
import * as geese from './geese.js'
import * as boat from './boat.js'
import * as horse from './horse.js'
import * as plane from './plane.js'
import * as discgolf from './discgolf.js'
import * as water from './water.js'
import * as weapons from './weapons.js'
import * as staff from './staff.js'
import * as townFolk from './townFolk.js'
import * as horde from './horde.js'
import * as npcs from './npcs.js'
import * as town from './town.js'
import * as war from './war.js'
import { onSpawn } from './radialMenu.js'
import { PRESETS } from './graphicsPresets.js';

/*
	MULTIPLAYER, for the Hunting game mode: one player hosts, the others join. The site is only files (GitHub Pages), with no
	server of its own, so the players' browsers talk to each other directly (WebRTC). The host is the middle: every joiner
	is connected to the host alone, and the host passes on what each one says to the others.

	HOW THEY FIND EACH OTHER. Two browsers need a go-between to find each other before they can talk. Either way works, and a
	host takes both at once:
		a room code			the host gets a short code (ROOM_CODE_LENGTH letters) and the others type it in. PeerJS's free
							public server introduces them (PEERJS_SCRIPT, loaded only when it is used), and after that the
							game goes straight between the browsers
		invite codes		no one in between at all. The host makes an invite code for each player and sends it to them
							(a chat, an email), they paste it in and get a reply code, send that back, and the host pastes it in.
							The codes carry what WebRTC needs to connect (SDP and its ICE candidates), compressed
	Either way the browsers find a way through to each other with the help of a STUN server (ICE_SERVERS). Some networks
	(strict company ones, some mobile carriers) let nothing through without a relay (TURN), which this does not have.

	WHAT GOES BETWEEN THEM (as JSON, t: what it is)
		joiner to host		hello (its name), st (its state), shot, hit (it hit someone), up (it is up again after being shot), spell (a
							spell cast with the staff, or its beam while it is on: passed on to the others, but for the hawks, which the
							host calls up itself),
							veh+ and veh- (a vehicle it put out, or took away), vs (the states of the vehicles it sails), claim (it
							took a vehicle's helm), vctl (a control worked on a vehicle someone else sails)
		(a shot comes with the clock it was fired by, w: see THE SHOTS HEARD)
		host to joiners		welcome (its id, who is there, the world, the clock, the scores, the vehicles, the disc golf course), join,
							leave, world, clock, course (the disc golf course's holes, when they change), sts (everyone's states), shot,
							hp (someone's health), down (someone was shot dead), score, and veh+, veh-, vs, vctl passed on, auth (who
							sails a vehicle now), and tp (go to this place: the host's Bring button)
		the horde			(horde.js, the Horde game mode) joiner to host: hpick (a power-up walked into). Host to joiners: horde
							(the run, HORDE_RATE times a second: its round, the power-ups, the townsfolk fighting and turned), hfx (what
							just happened: a new run, a round, a power-up taken), hpts (points earned), shove (a deer's lunge)
		the NPCs			(npcs.js and its kinds) joiner to host: npcHit (one of them hit: the part, the round), npcAttack (one of their
							vehicles hit), npcBlast (its own shell or bomb burst: the NPCs and the war's townsfolk round it, on the host). Host to joiners: npcs (the people, PEOPLE_RATE times a second, on the fast channel), npcShots
							(their rounds this frame, for their trails). Their vehicles go as everyone's do (owned by 'npc', sailed by the
							host), and their harm to a player as hp and down, by 'npc'
	A state is [x, y, z (its feet), heading, pitch, speed, alive, out hunting, the vehicle it is on (its id, or ''), where on it
	(x, y, z, metres in the vehicle's own directions), sitting (0 standing, 1 sitting, 2 astride), what it holds], STATE_RATE
	times a second, on the fast channel (no waiting for what was lost: the next one is newer anyway). So are the vehicles' states.
	Everything else on the game channel, in order.

	THE VEHICLES (boats, boat.js; the horses; and the biplanes, plane.js, flown by their pilot's machine): everyone's. Each is sailed (or ridden) on one machine, its authority: whoever
	put it out, until someone takes its helm (claim: the host says so, auth). The authority sends its state VEHICLE_RATE times a
	second, and everyone else draws it from those (see WHO SAILS IT in boat.js). Who is on board, and where, comes with each
	player's own state, so the authority has their weight on the boat as well. A rope hauled or the anchor let go by someone
	who is not its authority goes to the authority (vctl), through the host. When a player leaves, the host sails what it
	sailed. A joiner's own vehicles from before it joined are taken away (they would not be the host's); leaving, it keeps its own.
	THE SEA is the same on every machine (the waves are drawn from settings.waterSeed, see gaussianNoise in water.js), and its
	clock is the host's (clock: the waves' time too), so a boat rides the same waves everywhere.

	THE HOST KEEPS:
		the world		every setting but how well each one draws (WORLD_KEYS: everything but LOCAL_KEYS: the seeds of the
						land, the forest and the weather, the length of a day, the season, the animals, the look of the
						water and the grass...). A joiner takes the host's and keeps them, and its controls for them are
						greyed out until it leaves (lockControls). Its graphics settings stay its own
		the clock		the world's day (sunCycles in atmosphere.js), sent every CLOCK_SECONDS. A joiner more than
						CLOCK_SLACK days out is put right. The weather and the seasons are drawn from the day, so they follow. With it
						the townsfolk's clock (townFolk.js: what they are doing is worked out from it, so they follow too)
		the forest		its trees (see MULTIPLAYER in forest.js): a joiner asks for the whole forest once its own is planted with
						the host's settings (forest?), and gets it in pieces (big: BIG_PIECE characters each, a few at a time
						so the channel's buffer never holds more than BIG_BUFFER). From then on, every TREES_SECONDS, the trees
						that came, died or went, and the growth of TREES_GROWTH more round the forest (trees). Each lot is
						numbered, and the whole forest says the last it has in it: the joiner keeps the lots from when it asks
						and uses the later ones once the forest is in (some come before its first piece). Planted again on
						either side (its settings changed): asked for again
		the animals	the deer, the hawks and the geese live on the host alone. ANIMAL_RATE times a second it sends each
						joiner where they are and what they are doing (animals: ANIMAL_RECORD floats each, the ones within
						ANIMAL_NEAR of the joiner every time, the rest one time in ANIMAL_FAR_EVERY), and the joiner draws them
						ANIMAL_DELAY behind, in between (its own stop: deerFollow, hawkFollow, geeseFollow). A joiner's shot
						that hits one tells the host (animal), and the host has it fall
		health			everyone's: a bullet that hits someone is seen by whoever fired it (players.js: they see where the
						others are, and it is their shot), who tells the host the part it hit. The host takes DAMAGE off and
						says what is left. At 0 that player is down, and the host counts the kill
		the course		the disc golf course's holes as the host laid them out (discgolf.courseShare): sent with the welcome and
						whenever they change, and a joiner plays on those, not its own
		the horde		in the Horde game mode (horde.js, see MULTIPLAYER there): its deer go with the animals, its run goes to
						everyone (horde), and a joiner is put in the Horde game mode while the host is in it (and back out to Hunting
						when it is not). A joiner's shot that hits one of its deer says the part and the round, and the host says what
						it earned (hpts). Their lunges take health off as the bullets do (by 'horde'), and the host gives it back
						in time. Everyone's gunshots are heard by the horde, and the townsfolk's shots go to everyone for their trails
	The host can also move the players about (the Multiplayer window): Bring takes one to where the host is (tp), Go To takes the
	host to one.
*/
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
const PEERJS_SCRIPT = 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const ROOM_PREFIX = 'webgpu-life-hunt-';		// (the public server is shared with everyone who uses PeerJS: the room codes are kept to ours)
const ROOM_CODE_LENGTH = 5;
const ROOM_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';	// (no 0 and O, 1 and I)
const INVITE_PREFIX = 'HUNT-INVITE-', REPLY_PREFIX = 'HUNT-REPLY-';
const GATHER_SECONDS = 4;			// the most to wait for the ICE candidates before the code is made
const STATE_RATE = 20;				// a second
const CLOCK_SECONDS = 1;
const CLOCK_SLACK = 0.002;			// days: 0.6 seconds of a 5 minute day
const MAX_PLAYERS = 8;
const TREES_SECONDS = 0.25;
const TREES_GROWTH = 400;			// trees' growth sent every TREES_SECONDS: 1600 a second, round a forest of 30 thousand in 20 seconds
const BIG_PIECE = 60000;			// characters
const ANIMAL_RATE = 10;				// a second
const ANIMAL_RECORD = 12;			// floats: id, x, y, z, heading, six of the animal's own, alive (see deerShare in deer.js, hawkShare in birds.js)
const ANIMAL_NEAR = 600;				// metres
const ANIMAL_FAR_EVERY = 10;
const ANIMAL_DELAY = 0.2;			// seconds
const HORDE_RATE = 5;				// a second
const PEOPLE_RATE = 10;				// a second: the NPCs' people (npcs.js)
const VEHICLE_RATE = 15;			// a second
const WAVE_SLACK = 0.12;			// step time (water.js): a joiner whose waves are further out than this from the host's is put right
const FOLK_SLACK = 0.5;				// seconds: the same for the townsfolk's clock (townFolk.js)
const TREES_PER_MESSAGE = 1000;		// trees in full in one message: about 120 thousand characters, under what one message can hold
const BIG_BUFFER = 1000000;			// bytes
export const DAMAGE = { head: 100, chest: 70, belly: 55, leg: 30 };
// The settings a joiner keeps its own: how well it draws (everything a graphics preset sets, and the rest of the same kind),
//		where it looks from, the debug views, and what each machine works out for itself (read only). Every other setting is
//		the host's (see THE HOST KEEPS)
const LOCAL_KEYS = new Set([
	...Object.values(PRESETS).flatMap((preset) => Object.keys(preset)),
	'step', 'sunCycleCount', 'forestYear', 'forestTreeCount', 'seasonNow', 'snowCover', 'weatherNow', 'shadowMapCenter',
	'enableSound', 'soundVolume',
	'camPosX', 'camPosY', 'camPosZ', 'camFarPlane', 'camNearPlane', 'gameMode', 'huntingLookSensitivity', 'cameraFlyMode', 'cameraFlySpeed', 'camYaw', 'camPitch',
	'heightMapResolution', 'topDownCameraHeight', 'shadowMapSize', 'shadowMapPCFKernelSize', 'shadowMapAcneBias',
	'enablePostEffects', 'enableScreenShadows', 'screenShadowStrength', 'screenShadowThickness', 'screenShadowContrast', 'enableSSAO', 'ssaoRadius',
	'ssaoStrength', 'enableSSR', 'ssrStrength', 'ssrDistance', 'displayScreenShading',
	'renderResolution', 'dynamicResolution', 'dynamicResolutionTarget', 'antiAliasing', 'smaaEdgeThreshold', 'fxaaSubpixel', 'fxaaEdgeThreshold', 'anisotropicFiltering',
	'terrainResolution', 'terrainFarBake', 'terrainDetailDistance', 'terrainRockVeins', 'terrainGroundDetail', 'terrainDepthBias', 'terrainRockDetail',
	'enableGrass', 'grassTotalBladeCount', 'grassTotalHARDLIMIT', 'grassDrawDistance', 'grassLodRings', 'grassLodNearDistance', 'grassLodFarBlades',
	'landOcclusion', 'boulderDrawDistance',
	'forestDetailDistance', 'forestMidDistance', 'forestThinnedRings', 'forestBillboardDistance', 'forestDrawDistance',
	'cloudSteps', 'cloudResolution', 'cloudDrawDistance', 'displayCloudCoverage',
	'enableLightShafts', 'lightShaftStrength', 'enableUnderwater', 'causticStrength',
	'enableLeaves', 'leavesAllYear', 'leafAmount', 'leafSize', 'leafWeight', 'enableSeaSpray', 'sprayAmount', 'enableRain', 'rainAmount', 'rainDistance', 'enableSnow', 'snowAmount',
	'waterTileResolution', 'waterCascadeResolution', 'waterTileInstanceCount',
	'atmosphereNeedsTransmittanceRebuild', 'atmosphereViewLUTTextureSizeX', 'atmosphereViewLUTTextureSizeY', 'atmosphereTransmittanceTextureSizeX', 'atmosphereTransmittanceTextureSizeY',
	'showDebug', 'showDebugIcons', 'activateSkybox', 'displayHeightMap', 'displayDepthMapDebugRange', 'displayShadowMapDepth', 'displayOceanSpectrum',
	'displayWaterInitialHeight', 'displayWaveHeightRealization', 'displayWaterPreComp', 'displayWaterFFT', 'displayWaterShifted',
	'displayWaterDisplacementSpectrum', 'displayWaterDisplacement', 'displayShoreDistance', 'displayShoreDistanceDebugRange',
	'displaySkyViewLUTtexture', 'displayTransmittanceLUTtexture', 'displayWindTexture', 'displayLightingMode', 'debugTextureRescaleSize',
]);
// where the sun and the moon are: worked out from the clock while the sun goes round, the host's own settings while it stands still
const SUN_KEYS = ['sunPosX', 'sunPosY', 'sunPosZ', 'moonPosX', 'moonPosY', 'moonPosZ', 'sunCycleAngle'];
// the host's: every setting there is (as settings.js makes them), but those
const WORLD_KEYS = Object.keys(settings).filter((key) => !LOCAL_KEYS.has(key) && !SUN_KEYS.includes(key));

export const netStats = { role: 'off', id: 0, players: 0, roomCode: '', status: '', sent: 0, received: 0, statesHeard: 0 };	// for anyone who wants to show it

// Links: one other player, whichever way it was made
//-------------------------------------------------
// { open, sendGame(message), sendFast(message), close(), onMessage, onOpen, onClose }
function makeLink() {
	return { open: false, onMessage: () => {}, onOpen: () => {}, onClose: () => {}, closed: false };
}
function send(channel, message) {
	if (channel && channel.readyState === 'open') {
		channel.send(JSON.stringify(message));
		netStats.sent++;
	}
}
// a link over a WebRTC connection of our own, with a game channel (reliable, in order) and a fast one (neither)
function rtcLink(pc, game, fast) {
	const link = makeLink();
	link.pc = pc;
	const wire = (channel) => {
		channel.onmessage = (event) => { netStats.received++; try { link.onMessage(JSON.parse(event.data)); } catch (error) { console.warn('net: a message that could not be read', error); } };
		channel.onclose = () => lose();
	};
	const lose = () => { if (link.closed) return; link.closed = true; link.open = false; link.onClose(); };
	const ready = () => {
		if (!link.open && link.game?.readyState === 'open' && link.fast?.readyState === 'open') { link.open = true; link.onOpen(); }
	};
	const take = (channel) => {
		if (channel.label == 'game') link.game = channel; else link.fast = channel;
		wire(channel);
		channel.onopen = ready;
		ready();
	};
	if (game) take(game);
	if (fast) take(fast);
	pc.ondatachannel = (event) => take(event.channel);
	pc.onconnectionstatechange = () => { if (pc.connectionState == 'failed' || pc.connectionState == 'closed') lose(); };
	link.sendGame = (message) => send(link.game, message);
	link.sendFast = (message) => send(link.fast, message);
	link.buffered = () => link.game?.bufferedAmount ?? 0;
	link.close = () => { try { pc.close(); } catch (error) {} lose(); };
	return link;
}
// a link over a PeerJS connection: one channel, reliable, for everything
function peerLink(connection) {
	const link = makeLink();
	const lose = () => { if (link.closed) return; link.closed = true; link.open = false; link.onClose(); };
	connection.on('open', () => { link.open = true; link.onOpen(); });
	connection.on('data', (data) => { netStats.received++; try { link.onMessage(typeof data == 'string' ? JSON.parse(data) : data); } catch (error) { console.warn('net: a message that could not be read', error); } });
	connection.on('close', lose);
	connection.on('error', lose);
	const sendIt = (message) => { if (link.open) { connection.send(JSON.stringify(message)); netStats.sent++; } };
	link.sendGame = sendIt;
	link.sendFast = sendIt;
	link.buffered = () => (connection.dataChannel?.bufferedAmount ?? 0) + (connection.bufferSize ?? 0) * BIG_PIECE;
	link.close = () => { try { connection.close(); } catch (error) {} lose(); };
	return link;
}

// Invite codes
//-------------------------------------------------
async function packCode(prefix, object) {
	const bytes = new TextEncoder().encode(JSON.stringify(object));
	const zipped = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
	let text = '';
	for (const byte of zipped) text += String.fromCharCode(byte);
	return prefix + btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function unpackCode(prefix, code) {
	code = (code || '').replace(/\s+/g, '');
	if (!code.startsWith(prefix)) throw new Error(prefix == INVITE_PREFIX ? 'That is not an invite code (it starts ' + INVITE_PREFIX + ')' : 'That is not a reply code (it starts ' + REPLY_PREFIX + ')');
	const text = atob(code.slice(prefix.length).replace(/-/g, '+').replace(/_/g, '/'));
	const bytes = Uint8Array.from(text, (c) => c.charCodeAt(0));
	const unzipped = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
	return JSON.parse(new TextDecoder().decode(unzipped));
}
// bytes as text and back, and squeezed and back
function bytesToText(bytes) {
	let text = '';
	for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
	return btoa(text);
}
function textToBytes(text) {
	const raw = atob(text), bytes = new Uint8Array(raw.length);
	for (let k = 0; k < raw.length; k++) bytes[k] = raw.charCodeAt(k);
	return bytes;
}
const floatsToText = (floats) => bytesToText(new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength));
const textToFloats = (text) => { const bytes = textToBytes(text); return new Float32Array(bytes.buffer, 0, bytes.byteLength / 4); };
const squeeze = async (bytes, how) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(how == 'in' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'))).arrayBuffer());

// something too big for one message (the forest), in pieces, waiting while the channel is full
async function sendBig(link, kind, meta, floats) {
	const text = bytesToText(await squeeze(new Uint8Array(floats.buffer, floats.byteOffset, floats.byteLength), 'in'));
	const pieces = Math.ceil(text.length / BIG_PIECE);
	for (let k = 0; k < pieces; k++) {
		while (link.open && link.buffered() > BIG_BUFFER) await new Promise((done) => setTimeout(done, 20));
		if (!link.open) return;
		link.sendGame({ t: 'big', kind, meta, n: pieces, k, d: text.slice(k * BIG_PIECE, (k + 1) * BIG_PIECE) });
	}
}
let bigParts = null;		// joiner: the pieces of a big one on its way
async function bigPiece(message) {
	if (!bigParts || bigParts.kind != message.kind || bigParts.n != message.n) bigParts = { kind: message.kind, n: message.n, parts: [], got: 0 };
	if (bigParts.parts[message.k] === undefined) { bigParts.parts[message.k] = message.d; bigParts.got++; }
	netStats.status = 'Getting the ' + message.kind + '… ' + Math.round(bigParts.got / bigParts.n * 100) + '%';
	if (bigParts.got < bigParts.n) return null;
	const done = bigParts;
	bigParts = null;
	const bytes = await squeeze(textToBytes(done.parts.join('')), 'out');
	return new Float32Array(bytes.buffer, 0, bytes.byteLength / 4);
}

// waits until the connection has found its ways in (ICE candidates), or GATHER_SECONDS: the code carries them all
function gathered(pc) {
	return new Promise((done) => {
		if (pc.iceGatheringState == 'complete') return done();
		pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState == 'complete') done(); });
		setTimeout(done, GATHER_SECONDS * 1000);
	});
}

// PeerJS
//-------------------------------------------------
let peerjsLoading = null;
function loadPeerJS() {
	if (window.Peer) return Promise.resolve(window.Peer);
	peerjsLoading ??= new Promise((done, fail) => {
		const script = document.createElement('script');
		script.src = PEERJS_SCRIPT;
		script.onload = () => window.Peer ? done(window.Peer) : fail(new Error('PeerJS did not load'));
		script.onerror = () => { peerjsLoading = null; fail(new Error('Could not load PeerJS')); };
		document.head.appendChild(script);
	});
	return peerjsLoading;
}
function roomCode() {
	let code = '';
	for (let k = 0; k < ROOM_CODE_LENGTH; k++) code += ROOM_LETTERS[Math.floor(Math.random() * ROOM_LETTERS.length)];
	return code;
}

// The animals (see THE HOST KEEPS)
//-------------------------------------------------
const ANIMALS = [
	{ kind: 'deer', share: deer.deerShare, follow: deer.deerFollow, kill: deer.killDeerById, shot: deer.deerShot, angles: [4] },
	{ kind: 'hawk', share: birds.hawkShare, follow: birds.hawkFollow, kill: birds.killHawkById, shot: birds.hawkShot, angles: [4, 6] },
	{ kind: 'goose', share: geese.geeseShare, follow: geese.geeseFollow, kill: geese.killGooseById, shot: geese.gooseShot, angles: [4, 6] },
	{ kind: 'horde', share: horde.hordeShare, follow: horde.hordeFollow, kill: horde.killHordeById, shot: horde.hordeShot, angles: [4] },
];
const tracks = new Map(ANIMALS.map((animal) => [animal.kind, new Map()]));	// joiner: kind -> id -> the last few records heard, [{ at, r }]
let animalTick = 0, lastAnimals = 0;

// a joiner's shot that hits one of the host's animals goes to the host
for (const animal of ANIMALS) {
	animal.shot.report = (id, velocity, part, round) => { if (role == 'joined') hostLink.sendGame({ t: 'animal', kind: animal.kind, id, v: velocity, p: part, r: round }); };
}
// host: every animal, to each joiner. The ones within ANIMAL_NEAR of it every time, the rest every ANIMAL_FAR_EVERY-th time
function sendAnimals() {
	animalTick++;
	const full = animalTick % ANIMAL_FAR_EVERY == 0;
	const near = ANIMAL_NEAR * settings.forestUnitsPerMetre;
	const shares = ANIMALS.map((animal) => animal.share());
	for (const joiner of joiners.values()) {
		if (!joiner.link.open) continue;
		const at = joiner.state;
		const d = {};
		ANIMALS.forEach((animal, k) => {
			let records = shares[k];
			if (!full && at) {
				const kept = [];
				for (let i = 0; i < records.length; i += ANIMAL_RECORD) {
					if (Math.hypot(records[i + 1] - at[0], records[i + 3] - at[2]) < near) kept.push(...records.subarray(i, i + ANIMAL_RECORD));
				}
				records = new Float32Array(kept);
			}
			d[animal.kind] = floatsToText(records);
		});
		joiner.link.sendFast({ t: 'animals', full, d });
	}
}
// joiner: what the host says its animals are doing
function heardAnimals(message) {
	const at = performance.now() / 1000;
	for (const animal of ANIMALS) {
		const text = message.d[animal.kind];
		if (text === undefined) continue;
		const records = textToFloats(text), track = tracks.get(animal.kind), seen = new Set();
		for (let i = 0; i < records.length; i += ANIMAL_RECORD) {
			const id = records[i];
			seen.add(id);
			let samples = track.get(id);
			if (!samples) track.set(id, samples = []);
			samples.push({ at, r: records.slice(i, i + ANIMAL_RECORD) });
			if (samples.length > 4) samples.shift();
		}
		// (only a full list says which are gone)
		if (message.full) for (const id of [...track.keys()]) if (!seen.has(id)) track.delete(id);
	}
}
// joiner: each animal where it was ANIMAL_DELAY ago, in between the two records either side of then
function followAnimals() {
	const now = performance.now() / 1000 - ANIMAL_DELAY;
	for (const animal of ANIMALS) {
		const out = [];
		for (const samples of tracks.get(animal.kind).values()) {
			let a = samples[0], b = samples[samples.length - 1];
			for (let k = 0; k < samples.length - 1; k++) {
				if (samples[k].at <= now && samples[k + 1].at >= now) { a = samples[k]; b = samples[k + 1]; break; }
			}
			const f = b.at > a.at ? Math.min(Math.max((now - a.at) / (b.at - a.at), 0), 1) : 1;
			for (let i = 0; i < ANIMAL_RECORD; i++) {
				let change = b.r[i] - a.r[i];
				if (animal.angles.includes(i)) change -= Math.PI * 2 * Math.round(change / (Math.PI * 2));
				out.push(i == 0 || i == ANIMAL_RECORD - 1 ? b.r[i] : a.r[i] + change * f);
			}
		}
		animal.follow(new Float32Array(out));
	}
}
function stopFollowingAnimals() {
	for (const animal of ANIMALS) {
		animal.follow(null);
		tracks.get(animal.kind).clear();
	}
}

// The game
//-------------------------------------------------
let role = 'off';				// 'off', 'host', 'joining', 'joined'
let myId = 0;
let myName = loadName();
let nextId = 1;
const joiners = new Map();		// host: id -> { id, name, link, state }
const invites = new Map();		// host: invite -> { pc, link }
let hostLink = null;			// joiner: its link to the host
let peer = null;				// this player's PeerJS peer, if it has one
let worldFromHost = null;		// joiner: the host's WORLD_KEYS
let worldSent = '';				// host: the last world it sent
let courseSent = '';			// host: the last disc golf course it sent
const names = new Map();		// id -> name, everyone's, this player too
const health = new Map();		// host: id -> health
const scores = new Map();		// id -> { kills, deaths }
let lastState = 0, lastClock = 0, lastWorldCheck = 0, lastTrees = 0, lastHorde = 0, lastPeople = 0, lastWar = 0;
let npcShots = [];		// host: the NPCs' rounds since the last were sent: [from, direction, round]
let treesSent = 0;		// host: the number of the last lot of trees sent. The whole forest says which it already has in it
// joiner: the forest (see the forest above). asked: waiting for it. have: it has the host's, from the host's planting
//		hostPlanting, while its own was planted localPlanting. queue: changes that came while the forest was on its way
const forestSync = { need: false, asked: false, have: false, hostPlanting: -1, localPlanting: -1, queue: [] };

function loadName() {
	try { return localStorage.getItem('huntName') || 'Hunter ' + Math.floor(10 + Math.random() * 90); } catch (error) { return 'Hunter ' + Math.floor(10 + Math.random() * 90); }
}
export function setName(name) {
	myName = String(name || '').trim().slice(0, 20) || myName;
	try { localStorage.setItem('huntName', myName); } catch (error) {}
	names.set(myId, myName);
}
const nameOf = (id) => names.get(id) ?? 'someone';
// the thrower's name over each golf disc, in a game
discgolf.setNameLookup((id) => role == 'host' || role == 'joined' ? nameOf(id) : null);
const say = (status) => { netStats.status = status; refreshPanel(); };

function worldNow() {
	const world = {};
	const keys = settings.atmosphereSunRotationDemo ? WORLD_KEYS : [...WORLD_KEYS, ...SUN_KEYS];
	for (const key of keys) world[key] = ArrayBuffer.isView(settings[key]) ? Array.from(settings[key]) : settings[key];
	return world;
}
function scoreList() {
	return [...names.entries()].map(([id, name]) => [id, name, scores.get(id)?.kills ?? 0, scores.get(id)?.deaths ?? 0]);
}
function everyone() {
	return [...names.entries()].map(([id, name]) => ({ id, name }));
}
function toAll(message, except = -1) {
	for (const joiner of joiners.values()) if (joiner.id !== except && joiner.link.open) joiner.link.sendGame(message);
}
function toAllFast(message, except = -1) {
	for (const joiner of joiners.values()) if (joiner.id !== except && joiner.link.open) joiner.link.sendFast(message);
}

// The vehicles (see THE VEHICLES at the top)
//-------------------------------------------------
// each kind of vehicle: how to list them, find one, say what it is now, follow what is heard of it, put one out from what is
//		heard, take it away, and give it to whoever sails it
const VEHICLES = {
	boat: {
		list: () => boat.boats,
		byId: (id) => boat.boatById(id),
		share: (b) => boat.boatShare(b),
		heard: (s) => boat.boatHeard(s),
		spawn: (s) => boat.spawnFromShare(s),
		remove: (b) => boat.removeBoat(b),
		takeOver: (b, authority) => boat.takeOver(b, authority),
		local: () => boat.setLocalId(myId),
	},
	horse: {
		list: () => horse.horses,
		byId: (id) => horse.horseById(id),
		share: (h) => horse.horseShare(h),
		heard: (s) => horse.horseHeard(s),
		spawn: (s) => horse.horseFromShare(s),
		remove: (h) => horse.removeHorse(h),
		takeOver: (h, authority) => horse.takeOver(h, authority),
		local: () => horse.setLocalId(myId),
	},
	plane: {
		list: () => plane.planes,
		byId: (id) => plane.planeById(id),
		share: (p) => plane.planeShare(p),
		heard: (s) => plane.planeHeard(s),
		spawn: (s) => plane.planeFromShare(s),
		remove: (p) => plane.removePlane(p),
		takeOver: (p, authority) => plane.takeOver(p, authority),
		local: () => plane.setLocalId(myId),
	},
};
players.addVehicleFrames((id) => horse.horseById(id)?.frame);
players.addVehicleFrames((id) => plane.planeById(id)?.frame);
const kindOf = (id) => Object.keys(VEHICLES).find((kind) => VEHICLES[kind].byId(id));
const allVehicles = () => Object.entries(VEHICLES).flatMap(([kind, V]) => V.list().map((v) => ({ kind, v })));
let lastVehicles = 0;

// a vehicle put out here, or taken away here (the spawn menu): to everyone
function announceVehicle(kind, v, removed) {
	const message = removed ? { t: 'veh-', kind, id: v.id } : { t: 'veh+', kind, s: VEHICLES[kind].share(v) };
	if (role == 'host') toAll(message);
	else if (role == 'joined') hostLink.sendGame(message);
}
onSpawn((kind, v, removed) => {
	if (v) announceVehicle(kind, v, false);
	if (removed) announceVehicle(kind, removed, true);
});
// heard of one put out, or taken away
function vehicleHeard(message) {
	const V = VEHICLES[message.kind];
	if (!V) return;
	if (message.t == 'veh+') {
		const old = V.byId(message.s.id);
		if (old) V.remove(old);
		V.spawn(message.s);
	} else {
		const v = V.byId(message.id);
		if (v) V.remove(v);
	}
}
// who sails one now: the host says
function setAuthority(id, authority) {
	const kind = kindOf(id);
	if (!kind) return;
	VEHICLES[kind].takeOver(VEHICLES[kind].byId(id), authority);
	if (role == 'host') toAll({ t: 'auth', id, a: authority });
}
// this player took a vehicle's helm (or its reins): it sails it from now on
function claimVehicle(v) {
	if (role == 'off' || v.authority === myId) return;
	if (role == 'host') setAuthority(v.id, myId);
	else if (role == 'joined') hostLink.sendGame({ t: 'claim', id: v.id });
}
hunting.onTakeHelm((b) => claimVehicle(b));
plane.onTakeControls((p) => claimVehicle(p));
// a control worked on a vehicle sailed somewhere else: to its authority, through the host
function routeControl(id, what) {
	const kind = kindOf(id);
	if (!kind) return;
	const v = VEHICLES[kind].byId(id);
	if (v.authority === myId) { if (kind == 'boat') boat.workControl(v, what); if (kind == 'plane') plane.workControl(v, what); return; }
	if (role == 'host') joiners.get(v.authority)?.link.sendGame({ t: 'vctl', id, what });
	else if (role == 'joined') hostLink.sendGame({ t: 'vctl', id, what });
}
boat.onRemoteControl((b, what) => routeControl(b.id, what));
plane.onRemoteControl((p, what) => routeControl(p.id, what));
// the states of the vehicles sailed here, VEHICLE_RATE times a second
function sendVehicles() {
	const mine = allVehicles().filter(({ v }) => v.authority === myId).map(({ kind, v }) => ({ ...VEHICLES[kind].share(v), vk: kind }));
	if (mine.length == 0) return;
	if (role == 'host') toAllFast({ t: 'vs', l: mine });
	else if (role == 'joined') hostLink.sendFast({ t: 'vs', l: mine });
}
function vehicleStates(list) {
	for (const s of list) VEHICLES[s.vk]?.heard(s);
}
// who is on each vehicle sailed here: the others, from where their states say they are (this player's own is set by hunting.js)
function crewFromStates() {
	const aboard = players.othersAboard();
	horse.setOtherRiders(aboard.filter((other) => horse.horseById(other.vehicle)).map((other) => [other.id, other.vehicle]));
	plane.setOtherCrew(aboard.filter((other) => plane.planeById(other.vehicle)));
	for (const b of boat.boats) {
		if (!boat.sailedHere(b)) continue;
		for (const who of [...b.crew.keys()]) if (who !== 'me' && !String(who).startsWith('npc:')) b.crew.delete(who);
		for (const other of aboard) if (other.vehicle === b.id) boat.setCrew(b, other.id, [other.local[0], other.local[1] + (other.sit ? 0.35 : 0.9), other.local[2]]);
	}
}
// leaving a game: the others' vehicles go, this player's own stay (and are its own again, out of any game)
function vehiclesAfterLeaving() {
	for (const { kind, v } of allVehicles()) {
		const V = VEHICLES[kind];
		// (the host's NPCs' own stay with it: npcs.js still runs them)
		if (v.owner === 'npc' && role == 'host') { V.takeOver(v, 0); continue; }
		if (v.owner !== myId) { V.remove(v); continue; }
		v.owner = 0;
		V.takeOver(v, 0);
	}
}

function beginGame() {
	names.clear();
	names.set(myId, myName);
	scores.clear();
	health.clear();
	health.set(myId, players.HEALTH);
	players.setInGame(true);
	if (settings.gameMode == 'Observe') { settings.gameMode = 'Hunting'; imguiParams.gameMode = 'Hunting'; }
	players.respawn();
}

// Hosting
//-------------------------------------------------
export function hostGame() {
	if (role != 'off') leaveGame();
	role = 'host';
	myId = 0;
	nextId = 1;
	beginGame();
	forest.forestShare(true);
	say('Hosting');
	openRoom();
}
// the room code, through PeerJS. Hosting goes on without it if it cannot be had
async function openRoom() {
	try {
		const Peer = await loadPeerJS();
		if (role != 'host') return;
		const code = roomCode();
		peer = new Peer(ROOM_PREFIX + code, { config: { iceServers: ICE_SERVERS } });
		peer.on('open', () => { netStats.roomCode = code; refreshPanel(); });
		peer.on('connection', (connection) => {
			if (role != 'host' || joiners.size >= MAX_PLAYERS - 1) { connection.on('open', () => connection.close()); return; }
			takeJoiner(peerLink(connection));
		});
		peer.on('error', (error) => {
			if (error.type == 'unavailable-id' && role == 'host') { peer.destroy(); peer = null; openRoom(); return; }
			console.warn('net: PeerJS', error);
			if (!netStats.roomCode) say('Hosting. Room codes are not available (' + (error.type || error.message) + '): use invite codes');
		});
		peer.on('disconnected', () => { if (role == 'host' && peer && !peer.destroyed) peer.reconnect(); });
	} catch (error) {
		say('Hosting. Room codes are not available (' + error.message + '): use invite codes');
	}
}
// an invite code for one more player
export async function makeInvite() {
	if (role != 'host') throw new Error('Not hosting');
	const invite = Math.random().toString(36).slice(2, 8);
	const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
	const game = pc.createDataChannel('game', { ordered: true });
	const fast = pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
	const link = rtcLink(pc, game, fast);
	invites.set(invite, { pc, link });
	link.onClose = () => invites.delete(invite);
	takeJoiner(link, invite);
	await pc.setLocalDescription(await pc.createOffer());
	await gathered(pc);
	return packCode(INVITE_PREFIX, { v: 1, i: invite, sdp: pc.localDescription.sdp });
}
// the reply code a player sent back
export async function acceptReply(code) {
	const reply = await unpackCode(REPLY_PREFIX, code);
	const invite = invites.get(reply.i);
	if (!invite) throw new Error('That reply is for an invite this game did not make (or it has been used)');
	await invite.pc.setRemoteDescription({ type: 'answer', sdp: reply.sdp });
	say('Connecting a player…');
}
// a joiner on its way in: it says hello once its link is open, and then it is in the game
function takeJoiner(link, invite = null) {
	link.onMessage = (message) => {
		if (message.t == 'hello' && !link.joiner) {
			if (invite) invites.delete(invite);
			const id = nextId++;
			const joiner = { id, name: String(message.name || 'Hunter').slice(0, 20), link, state: null };
			link.joiner = joiner;
			joiners.set(id, joiner);
			names.set(id, joiner.name);
			health.set(id, players.HEALTH);
			players.addOther(id, joiner.name);
			link.sendGame({ t: 'welcome', id, players: everyone(), world: worldNow(), clock: [atmosphere.sunCycles, settings.sunCycleAngle], waves: water.waveClock(), folk: townFolk.folkClock(), scores: scoreList(),
				vehicles: allVehicles().map(({ kind, v }) => ({ kind, s: VEHICLES[kind].share(v) })), course: discgolf.courseShare(), houses: town.housesShare(true) });
			toAll({ t: 'join', id, name: joiner.name }, id);
			players.addFeed(joiner.name + ' joined');
			say('Hosting');
			return;
		}
		if (link.joiner) fromJoiner(link.joiner, message);
	};
	link.onClose = () => {
		if (invite) invites.delete(invite);
		const joiner = link.joiner;
		if (!joiner || !joiners.has(joiner.id)) return;
		joiners.delete(joiner.id);
		names.delete(joiner.id);
		health.delete(joiner.id);
		players.removeOther(joiner.id);
		toAll({ t: 'leave', id: joiner.id });
		// what it sailed, the host sails now
		for (const { v } of allVehicles()) if (v.authority === joiner.id) setAuthority(v.id, myId);
		players.addFeed(joiner.name + ' left');
		refreshPanel();
	};
}
function fromJoiner(joiner, message) {
	if (message.t == 'st') {
		joiner.state = message.s;
		players.otherState(joiner.id, message.s);
		netStats.statesHeard++;
	} else if (message.t == 'shot') {
		const delay = heardDelay('j' + joiner.id, message.w);
		ballistics.fireRemote(message.from, message.dirs, { shooter: joiner.id, round: message.r, delay });
		toAll({ t: 'shot', id: joiner.id, from: message.from, dirs: message.dirs, r: message.r, w: clockNow() + delay }, joiner.id);
		horde.heardShot(message.from, message.r, 'p' + joiner.id);
	} else if (message.t == 'hit') {
		applyHit(joiner.id, message.target, message.part, message.r);
	} else if (message.t == 'up') {
		setHealth(joiner.id, players.HEALTH, joiner.id, '');
	} else if (message.t == 'animal') {
		ANIMALS.find((animal) => animal.kind == message.kind)?.kill(message.id, message.v, message.p, message.r, joiner.id);
	} else if (message.t == 'hpick') {
		horde.hordePick(message.id);
	} else if (message.t == 'forest?') {
		sendBig(joiner.link, 'forest', { p: forest.plantings, s: treesSent }, forest.forestSnapshot());
	} else if (message.t == 'veh+' || message.t == 'veh-') {
		vehicleHeard(message);
		toAll(message, joiner.id);
	} else if (message.t == 'vs') {
		vehicleStates(message.l);
		toAllFast(message, joiner.id);
	} else if (message.t == 'dthrow' || message.t == 'drest' || message.t == 'dgone' || message.t == 'dscore') {
		discHeard(message, joiner.id);
		toAll(message, joiner.id);
	} else if (message.t == 'spell') {
		staff.remoteSpell(joiner.id, message);
		if (message.k == 'beam' && message.on) toAllFast({ ...message, id: joiner.id }, joiner.id);
		else if (message.k != 'hawks') toAll({ ...message, id: joiner.id }, joiner.id);
	} else if (message.t == 'folkShot') {
		townFolk.folkShotHeard(message.i, message.at);
		toAll(message, joiner.id);
	} else if (message.t == 'claim') {
		setAuthority(message.id, joiner.id);
	} else if (message.t == 'vctl') {
		routeControl(message.id, message.what);
	} else if (message.t == 'npcHit') {
		npcs.shotHeard(message.id, message.part, message.r, joiner.id);
	} else if (message.t == 'npcAttack') {
		npcs.attackHeard(message.v, joiner.id);
	} else if (message.t == 'npcBlast' && Array.isArray(message.at)) {
		// (a joiner's shell or bomb: the NPCs and the war's townsfolk round it, by it)
		const at = message.at.map(Number), radius = Math.min(Math.max(Number(message.r) || 0, 0), 60 * settings.forestUnitsPerMetre);
		npcs.blast(at, radius, joiner.id);
		npcs.war.blastFolk?.(at, radius);
	} else if (message.t == 'selfHurt') {
		npcs.npcNet.hurt(joiner.id, Math.min(Math.max(Number(message.a) || 0, 0), 200), String(message.how ?? '').slice(0, 60));
	}
}
// the host's word on a hit: DAMAGE off the target's health (the round's share of it), and at 0 it is down
function applyHit(shooter, target, part, round) {
	const before = health.get(target);
	if (before === undefined || before <= 0 || !(part in DAMAGE) || shooter === target) return;
	const after = Math.max(before - Math.round(DAMAGE[part] * (ballistics.ROUNDS[round]?.damage ?? 1)), 0);
	setHealth(target, after, shooter, part);
	if (after <= 0) {
		const killer = scores.get(shooter) ?? { kills: 0, deaths: 0 };
		killer.kills++;
		scores.set(shooter, killer);
		const victim = scores.get(target) ?? { kills: 0, deaths: 0 };
		victim.deaths++;
		scores.set(target, victim);
		const down = { t: 'down', id: target, by: shooter, part };
		toAll(down);
		heard(down);
		const score = { t: 'score', list: scoreList() };
		toAll(score);
		heard(score);
	}
}
function setHealth(id, value, by, part) {
	health.set(id, value);
	const message = { t: 'hp', id, hp: value, by, part };
	toAll(message);
	heard(message);
}

// Joining
//-------------------------------------------------
function beginJoining() {
	if (role != 'off') leaveGame();
	role = 'joining';
}
// with a room code (PeerJS)
export async function joinRoom(code) {
	code = String(code || '').trim().toUpperCase();
	if (code.length != ROOM_CODE_LENGTH) throw new Error('A room code is ' + ROOM_CODE_LENGTH + ' letters');
	beginJoining();
	say('Finding the room…');
	const Peer = await loadPeerJS();
	peer = new Peer({ config: { iceServers: ICE_SERVERS } });
	peer.on('error', (error) => {
		if (role != 'joining') return;
		say(error.type == 'peer-unavailable' ? 'There is no game with that room code' : 'Could not join (' + (error.type || error.message) + ')');
		leaveGame(false);
	});
	peer.on('open', () => {
		if (role != 'joining') return;
		say('Connecting…');
		joinWith(peerLink(peer.connect(ROOM_PREFIX + code, { reliable: true, serialization: 'raw' })));
	});
}
// with an invite code: gives back the reply code to send to the host
export async function joinInvite(code) {
	const offer = await unpackCode(INVITE_PREFIX, code);
	beginJoining();
	const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
	joinWith(rtcLink(pc, null, null));
	await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
	await pc.setLocalDescription(await pc.createAnswer());
	await gathered(pc);
	say('Send the reply code to the host, then wait for them to paste it in');
	return packCode(REPLY_PREFIX, { v: 1, i: offer.i, sdp: pc.localDescription.sdp });
}
function joinWith(link) {
	hostLink = link;
	link.onOpen = () => link.sendGame({ t: 'hello', name: myName });
	link.onMessage = heard;
	link.onClose = () => {
		if (role == 'off') return;
		const was = role;
		leaveGame(false);
		say(was == 'joined' ? 'The host has gone' : 'Could not connect');
	};
}

// what the host says (and the host says it to itself as well, for the ones it handles the same way)
function heard(message) {
	switch (message.t) {
		case 'welcome':
			role = 'joined';
			myId = message.id;
			// (this player's own vehicles from before go: the host's world has its own)
			for (const { kind, v } of allVehicles()) VEHICLES[kind].remove(v);
			for (const V of Object.values(VEHICLES)) V.local();
			for (const { kind, s } of message.vehicles ?? []) VEHICLES[kind]?.spawn(s);
			discgolf.setLocalId(myId);
			discgolf.discsForNewGame();
			discgolf.courseFromHost(message.course ?? []);
			town.housesHeard(message.houses ?? [], true);
			staff.setLocalId(myId);
			if (message.waves !== undefined) water.setWaveClock(message.waves);
			if (message.folk !== undefined) townFolk.setFolkClock(message.folk);
			beginGame();
			for (const { id, name } of message.players) {
				names.set(id, name);
				if (id !== myId) players.addOther(id, name);
			}
			names.set(myId, myName);
			worldFromHost = message.world;
			applyWorld();
			if (settings.atmosphereSunRotationDemo) atmosphere.setSunClock(message.clock[0], message.clock[1]);
			forest.forestFollow(true);
			for (const track of tracks.values()) track.clear();
			Object.assign(forestSync, { need: true, asked: false, have: false, hostPlanting: -1, localPlanting: -1, queue: [] });
			setScores(message.scores);
			say('In the game');
			break;
		case 'join':
			names.set(message.id, message.name);
			players.addOther(message.id, message.name);
			players.addFeed(message.name + ' joined');
			refreshPanel();
			break;
		case 'leave':
			players.addFeed(nameOf(message.id) + ' left');
			names.delete(message.id);
			players.removeOther(message.id);
			refreshPanel();
			break;
		case 'world':
			worldFromHost = message.world;
			break;
		case 'course':
			discgolf.courseFromHost(message.holes);
			break;
		case 'houses':
			town.housesHeard(message.l);
			break;
		case 'tp':
			if (!hunting.hunterPlace().active) break;
			hunting.teleportHunter(...message.to);
			players.addFeed(nameOf(0) + ' brought you to them');
			break;
		case 'clock':
			if (settings.atmosphereSunRotationDemo && Math.abs(atmosphere.sunCycles - message.clock[0]) > CLOCK_SLACK) atmosphere.setSunClock(message.clock[0], message.clock[1]);
			if (message.waves !== undefined && Math.abs(water.waveClock() - message.waves) > WAVE_SLACK) water.setWaveClock(message.waves);
			if (message.folk !== undefined && Math.abs(townFolk.folkClock() - message.folk) > FOLK_SLACK) townFolk.setFolkClock(message.folk);
			if (forestSync.have) {
				if (Math.abs(forest.clock - message.forest[0]) > 0.05) forest.setForestClock(message.forest[0]);
				// planted again, there or here: the forest again
				if (message.forest[1] != forestSync.hostPlanting || forest.plantings != forestSync.localPlanting) Object.assign(forestSync, { need: true, asked: false, have: false, queue: [] });
			}
			break;
		case 'big':
			bigPiece(message).then((floats) => {
				if (!floats || message.kind != 'forest' || role != 'joined') return;
				if (!forest.forestAdopt(floats)) { Object.assign(forestSync, { need: true, asked: false }); return; }
				Object.assign(forestSync, { need: false, asked: false, have: true, hostPlanting: message.meta.p, localPlanting: forest.plantings });
				// what happened while it was on its way: the lots sent after it was taken
				for (const queued of forestSync.queue) if (queued.s > message.meta.s) forest.forestApplyChanges(textToFloats(queued.r), textToFloats(queued.g));
				forestSync.queue = [];
				say('In the game');
			});
			break;
		case 'animals':
			heardAnimals(message);
			break;
		case 'trees':
			if (forestSync.have) forest.forestApplyChanges(textToFloats(message.r), textToFloats(message.g));
			else if (forestSync.asked) forestSync.queue.push(message);	// (kept from the moment it asked: some can come before the forest's first piece)
			break;
		case 'sts':
			for (const [id, ...s] of message.l) if (id !== myId) { players.otherState(id, s); netStats.statesHeard++; }
			break;
		case 'shot':
			if (message.id !== myId) ballistics.fireRemote(message.from, message.dirs, { shooter: message.id, round: message.r, delay: heardDelay('host', message.w) });
			break;
		case 'hp':
			if (message.id === myId) players.setLocalHealth(message.hp, message.by === myId || message.by === 'horde' || message.by === 'npc' ? '' : nameOf(message.by), message.by === 'horde' ? 'Overrun by the horde' : message.by === 'npc' ? message.part : '');
			else if (message.part) players.otherHit(message.id);
			break;
		case 'down':
			players.addFeed(message.by === 'horde' ? nameOf(message.id) + ' was overrun' : message.by === 'npc' ? nameOf(message.id) + ': ' + String(message.part).toLowerCase()
				: nameOf(message.by) + ' shot ' + nameOf(message.id) + (message.part == 'head' ? ' (head)' : ''));
			break;
		case 'score':
			setScores(message.list);
			break;
		case 'veh+':
		case 'veh-':
			vehicleHeard(message);
			break;
		case 'vs':
			vehicleStates(message.l);
			break;
		case 'auth':
			setAuthority(message.id, message.a);
			break;
		case 'dthrow':
		case 'drest':
		case 'dgone':
		case 'dscore':
			discHeard(message);
			break;
		case 'vctl':
			routeControl(message.id, message.what);
			break;
		case 'spell':
			if (message.id !== myId) staff.remoteSpell(message.id, message);
			break;
		case 'folkShot':
			townFolk.folkShotHeard(message.i, message.at);
			break;
		case 'horde':
			// the host's run, and its game mode: in the Horde game mode while the host is
			if (role != 'joined') break;
			if (message.s.on != (settings.gameMode == 'Horde')) { settings.gameMode = message.s.on ? 'Horde' : 'Hunting'; imguiParams.gameMode = settings.gameMode; }
			horde.hordeHeard(message.s);
			break;
		case 'war':
			// the host's war, and its game mode: in the War game mode while the host is (war.js)
			if (role != 'joined') break;
			if (message.s.on != (settings.gameMode == 'War')) { settings.gameMode = message.s.on ? 'War' : 'Hunting'; imguiParams.gameMode = settings.gameMode; }
			war.warHeard(message.s);
			break;
		case 'wfx':
			if (role == 'joined') war.warEventHeard(message.e);
			break;
		case 'hfx':
			if (role == 'joined') horde.hordeEvent(message.e);
			break;
		case 'hpts':
			horde.hordePoints(message.p);
			break;
		case 'shove':
			hunting.shoveHunter(message.v[0], message.v[1]);
			break;
		case 'npcs':
			if (role == 'joined') npcs.peopleHeard(message.l);
			break;
		case 'npcShots':
			if (role == 'joined') for (const [from, dir, round, w] of message.l) ballistics.fireRemote(from, [dir], { shooter: 'npc', round, delay: heardDelay('host', w) });
			break;
	}
}
function setScores(list) {
	scores.clear();
	for (const [id, name, kills, deaths] of list) scores.set(id, { kills, deaths });
	refreshPanel();
}
// a joiner keeps the host's world, whatever its own controls say
function applyWorld() {
	if (!worldFromHost) return;
	for (const [key, value] of Object.entries(worldFromHost)) {
		if (LOCAL_KEYS.has(key)) continue;
		for (const holder of [settings, imguiParams]) {
			if (holder === imguiParams && !(key in imguiParams)) continue;
			if (ArrayBuffer.isView(holder[key]) && Array.isArray(value)) holder[key].set(value);
			else holder[key] = value;
		}
	}
	if (lockedControls.length == 0) lockControls(true);
}
// a joiner's controls for the host's settings, greyed out while it is in the game (and the buttons that change the world)
let lockedControls = [];
function lockControls(on) {
	if (!on) {
		for (const control of lockedControls) control.enable();
		lockedControls = [];
		return;
	}
	const hosts = new Set(Object.keys(worldFromHost ?? {}));
	for (const control of gui.controllersRecursive()) {
		const theirs = (control.object === imguiParams && hosts.has(control.property)) || control.property == 'trigger';
		if (theirs && !control._disabled) {
			control.disable();
			lockedControls.push(control);
		}
	}
}

// Leaving
//-------------------------------------------------
export function leaveGame(quietly = true) {
	const wasHost = role == 'host';
	if (role == 'joined' || role == 'host') vehiclesAfterLeaving();
	role = 'off';
	for (const joiner of joiners.values()) joiner.link.close();
	joiners.clear();
	for (const invite of invites.values()) invite.link.close();
	invites.clear();
	if (hostLink) { const link = hostLink; hostLink = null; link.close(); }
	if (peer) { try { peer.destroy(); } catch (error) {} peer = null; }
	worldFromHost = null;
	lockControls(false);
	netStats.roomCode = '';
	forest.forestShare(false);
	forest.forestFollow(false);
	stopFollowingAnimals();
	bigParts = null;
	forestSync.have = forestSync.need = forestSync.asked = false;
	names.clear();
	scores.clear();
	health.clear();
	myId = 0;
	for (const V of Object.values(VEHICLES)) V.local();
	discgolf.setLocalId(0);
	discgolf.discsForNewGame();
	discgolf.courseFromHost(null);
	staff.setLocalId(0);
	courseSent = '';
	players.setInGame(false);
	if (quietly) say(wasHost ? 'Stopped hosting' : '');
	refreshPanel();
}

// The golf discs (see IN A GAME WITH OTHERS in discgolf.js): this player's throws, where they come to rest, picked up, a hole finished
//-------------------------------------------------
function discSend(message) {
	if (role == 'host') toAll(message);
	else if (role == 'joined') hostLink.sendGame(message);
}
const r3 = (v) => Math.round(v * 1000) / 1000;
discgolf.onThrow(({ id, kind, owner, s }) => discSend({ t: 'dthrow', id, kind, owner, s: { p: s.p.map(r3), v: s.v.map(r3), n: s.n.map((v) => Math.round(v * 1e5) / 1e5), spin: r3(s.spin) } }));
discgolf.onRest(({ id, p, n, state, hole }) => discSend({ t: 'drest', id, p: p.map(r3), n: n.map(r3), state, hole }));
discgolf.onGone((id) => discSend({ t: 'dgone', id }));
discgolf.onScore(({ hole, throws, par }) => {
	const message = { t: 'dscore', name: myName, hole, throws, par };
	discSend(message);
	if (role != 'off') discHeard(message);
});
function discHeard(message) {
	if (message.t == 'dthrow') discgolf.remoteThrow(message);
	else if (message.t == 'drest') discgolf.remoteRest(message);
	else if (message.t == 'dgone') discgolf.remoteGone(message.id);
	else if (message.t == 'dscore') {
		const score = message.throws - message.par;
		players.addFeed(`${message.name}: hole ${message.hole} in ${message.throws} (${score == 0 ? 'par' : score > 0 ? '+' + score : score})`);
	}
}

// The staff's spells (see IN A GAME WITH OTHERS in staff.js): a strike or the hawks once, the beam STATE_RATE times a second while it is on
//-------------------------------------------------
let beamSent = 0;
staff.onCast((spell) => {
	if (role != 'host' && role != 'joined') return;
	const r = (v) => Math.round(v * 10000) / 10000;
	if (spell.k == 'beam') {
		const now = performance.now() / 1000;
		if (spell.on && now - beamSent < 1 / STATE_RATE) return;
		beamSent = now;
		const message = { t: 'spell', id: myId, k: 'beam', on: spell.on ? 1 : 0, from: spell.from.map(r), way: spell.way.map(r), strength: r(spell.strength) };
		if (role == 'host') spell.on ? toAllFast(message) : toAll(message);
		else spell.on ? hostLink.sendFast(message) : hostLink.sendGame(message);
		return;
	}
	const message = { t: 'spell', id: myId, k: spell.k, at: spell.at.map(r) };
	if (role == 'host') { if (spell.k != 'hawks') toAll(message); }
	else hostLink.sendGame(message);
});

// a townsperson shot here: everyone sees it run home from the same time (see SHOT in townFolk.js)
townFolk.onFolkShot((i, at) => {
	const message = { t: 'folkShot', i, at };
	if (role == 'host') toAll(message);
	else if (role == 'joined') hostLink.sendGame(message);
});

// What is sent of this player's own doings
//-------------------------------------------------
function myState() {
	const place = hunting.hunterPlace();
	const forward = transformations.getCameraForward();
	const metre = settings.forestUnitsPerMetre;
	const r = (v) => Math.round(v * 1000) / 1000;
	const on = place.vehicle ?? place.boat ?? '';
	const b = place.boat ? boat.boatById(place.boat) : null;
	const sit = place.on == 'saddle' ? 2 : place.on == 'seat' && b && boat.helm(b).seated ? 1 : place.on == 'aboard' ? place.sit : 0;
	return [...[place.x, place.y, place.z, Math.atan2(forward[0], forward[2]), settings.camPitch, Math.hypot(place.vx ?? 0, place.vz ?? 0) / metre,
		hunting.hunterLife.alive ? 1 : 0, place.active ? 1 : 0].map(r), on, ...(on ? place.local.map(r) : [0, 0, 0]), sit, weapons.weaponState.current, place.chute ? 1 : 0, war.mySideNow() ?? 0];
}
ballistics.onLocalFire((from, directions, round) => {
	const r3 = (v) => Math.round(v * 1000) / 1000;
	const dirs = directions.map((d) => d.map(r3));
	if (role == 'host') toAll({ t: 'shot', id: myId, from, dirs, r: round, w: clockNow() });
	else if (role == 'joined') hostLink.sendGame({ t: 'shot', from, dirs, r: round, w: clockNow() });
});
players.onShot((target, part, round) => {
	if (role == 'host') applyHit(myId, target, part, round);
	else if (role == 'joined') hostLink.sendGame({ t: 'hit', target, part, r: round });
});
players.onRespawn(() => {
	if (role == 'host') setHealth(myId, players.HEALTH, myId, '');
	else if (role == 'joined') hostLink.sendGame({ t: 'up' });
});

// Per frame: after the hunter has moved and the rifle has fired
// The horde (see the horde at the top): what horde.js asks of the game
horde.hordeNet.others = () => role != 'host' ? [] : players.otherList().filter((other) => other.view).map((other) => ({ id: other.id, x: other.view.x, y: other.view.y, z: other.view.z,
	alive: other.view.alive, hunting: other.view.hunting, speed: other.view.speed }));
// a lunge on a player ('me': the host): health off, by 'horde', and a shove
horde.hordeNet.hurtOther = (id, damage, shove) => {
	if (role != 'host') return;
	if (id == 'me') id = myId;
	const before = health.get(id);
	if (before === undefined || before <= 0) return;
	const after = Math.max(before - damage, 0);
	setHealth(id, after, 'horde', 'horde');
	if (shove && id !== myId) joiners.get(id)?.link.sendGame({ t: 'shove', v: shove });
	if (after <= 0) {
		const down = { t: 'down', id, by: 'horde', part: '' };
		toAll(down);
		heard(down);
	}
};
horde.hordeNet.healOther = (id, amount) => {
	if (role != 'host') return;
	if (id == 'me') id = myId;
	const before = health.get(id);
	if (before === undefined || before <= 0 || before >= players.HEALTH) return;
	setHealth(id, Math.min(Math.round(before + amount), players.HEALTH), id, '');
};
horde.hordeNet.points = (id, points) => { if (role == 'host') joiners.get(id)?.link.sendGame({ t: 'hpts', p: points }); };
horde.hordeNet.event = (e) => { if (role == 'host') toAll({ t: 'hfx', e }); };
horde.hordeNet.shot = (from, directions, round) => {
	const r3 = (v) => Math.round(v * 1000) / 1000;
	if (role == 'host' && joiners.size > 0) toAll({ t: 'shot', id: 'folk', from: from.map(r3), dirs: directions.map((d) => d.map(r3)), r: round, w: clockNow() });
};
horde.hordeNet.pick = (id) => { if (role == 'joined') hostLink.sendGame({ t: 'hpick', id }); };

// The NPCs (see the NPCs at the top): what npcs.js asks of the game
npcs.npcNet.roleNow = () => role;
town.townNet.roleNow = () => role;
horde.hordeNet.nameOf = (id) => id == 'me' || id === myId ? myName : nameOf(id);
// the war's news (war.js: who won) to everyone
war.warEvents.send = (e) => { if (role == 'host') toAll({ t: 'wfx', e }); };
const HOUSES_SECONDS = 0.5;		// (town.js's SHARE_SECONDS)
let lastHouses = 0;
npcs.npcNet.others = () => {
	if (role != 'host') return [];
	const aboard = new Map(players.othersAboard().map((other) => [other.id, other.vehicle]));
	return players.otherList().filter((other) => other.view?.hunting).map((other) => ({ id: other.id, x: other.view.x, y: other.view.y, z: other.view.z, alive: other.view.alive,
		heading: other.view.heading, sit: other.view.sit, vehicle: aboard.get(other.id) ?? null }));
};
// a round of theirs that hit a player (by 'npc', how: what is said)
npcs.npcNet.hurt = (id, amount, how) => {
	if (role != 'host') return;
	if (id == 'me') id = myId;
	const before = health.get(id);
	if (before === undefined || before <= 0) return;
	const after = Math.max(Math.round(before - amount), 0);
	setHealth(id, after, 'npc', how);
	if (after <= 0) {
		const down = { t: 'down', id, by: 'npc', part: how };
		toAll(down);
		heard(down);
	}
};
npcs.npcNet.shot = (id, part, round) => { if (role == 'joined') hostLink.sendGame({ t: 'npcHit', id, part, r: round }); };
npcs.npcNet.attack = (vehicle) => { if (role == 'joined') hostLink.sendGame({ t: 'npcAttack', v: vehicle }); };
npcs.npcNet.blast = (at, radius) => { const r3 = (v) => Math.round(v * 1000) / 1000; if (role == 'joined') hostLink.sendGame({ t: 'npcBlast', at: at.map(r3), r: r3(radius) }); };
// this player hurt by its own doing (a fall): the host takes it off, as an NPC's round
players.selfHurt.send = (amount, how) => {
	if (role == 'host') npcs.npcNet.hurt('me', amount, how);
	else if (role == 'joined') hostLink.sendGame({ t: 'selfHurt', a: amount, how });
};
npcs.npcNet.fired = (from, dir, round) => { const r3 = (v) => Math.round(v * 1000) / 1000; if (joiners.size) npcShots.push([from.map(r3), dir.map(r3), round, clockNow()]); };
/*
	THE SHOTS HEARD: a shot comes with the clock of the machine it was fired on (w, seconds). Messages do not come evenly (several frames'
	at once, now and then), and a burst heard as it comes would be bunched up, its rounds on top of each other. So each is heard a little
	later: at its own time on the other machine's clock, plus the most it has lately taken any of that machine's to get here (a jitter
	buffer: SHOT_BUFFER at the most). The rounds of a burst are heard as far apart as they were fired
*/
const SHOT_BUFFER = 0.25;			// seconds
const clockNow = () => Math.round(performance.now()) / 1000;
const lateness = new Map();			// where from -> the most its shots lately took to get here (seconds, the clocks' difference with it)
function heardDelay(source, w) {
	if (typeof w != 'number') return 0;
	const gap = performance.now() / 1000 - w;
	const most = Math.max(gap, (lateness.get(source) ?? gap) - 0.01);
	lateness.set(source, most);
	return Math.min(Math.max(most - gap, 0), SHOT_BUFFER);
}

export function netUpdate() {
	if (!buttonAdded) addButton();
	horde.hordeNet.role = role;
	war.warNet.role = role;
	if (role == 'joined') applyWorld();
	if (role != 'host' && role != 'joined') { netStats.role = role; return; }
	const now = performance.now() / 1000;
	if (now - lastVehicles >= 1 / VEHICLE_RATE) {
		lastVehicles = now;
		sendVehicles();
	}
	crewFromStates();

	if (now - lastState >= 1 / STATE_RATE) {
		lastState = now;
		const mine = myState();
		if (role == 'joined') {
			hostLink.sendFast({ t: 'st', s: mine });
		} else {
			const all = [[myId, ...mine]];
			for (const joiner of joiners.values()) if (joiner.state) all.push([joiner.id, ...joiner.state]);
			for (const joiner of joiners.values()) if (joiner.link.open) joiner.link.sendFast({ t: 'sts', l: all.filter((row) => row[0] !== joiner.id) });
		}
	}
	if (role == 'joined') followAnimals();
	if (role == 'host' && joiners.size > 0 && now - lastAnimals >= 1 / ANIMAL_RATE) {
		lastAnimals = now;
		sendAnimals();
	}
	if (role == 'host' && joiners.size > 0 && now - lastHorde >= 1 / HORDE_RATE) {
		lastHorde = now;
		toAll({ t: 'horde', s: horde.hordeState() });
	}
	if (role == 'host' && joiners.size > 0 && now - lastWar >= 1 / HORDE_RATE) {
		lastWar = now;
		toAll({ t: 'war', s: war.warState() });
	}
	if (role == 'host' && joiners.size > 0 && now - lastPeople >= 1 / PEOPLE_RATE) {
		lastPeople = now;
		toAllFast({ t: 'npcs', l: npcs.peopleShare() });
	}
	if (role == 'host' && npcShots.length) {
		if (joiners.size > 0) toAll({ t: 'npcShots', l: npcShots });
		npcShots = [];
	}
	if (role == 'joined' && forestSync.need && !forestSync.asked && forest.forestReady()) {
		forestSync.asked = true;
		hostLink.sendGame({ t: 'forest?' });
	}
	if (role == 'host') {
		if (now - lastClock >= CLOCK_SECONDS) {
			lastClock = now;
			toAll({ t: 'clock', clock: [atmosphere.sunCycles, settings.sunCycleAngle], forest: [forest.clock, forest.plantings], waves: water.waveClock(), folk: townFolk.folkClock() });
		}
		if (now - lastTrees >= TREES_SECONDS) {
			lastTrees = now;
			const changes = forest.forestChanges(TREES_GROWTH);	// (taken whether anyone is there or not, so they never pile up)
			if (changes) treesSent++;
			if (changes && joiners.size > 0) {
				const step = TREES_PER_MESSAGE * forest.SHARE_RECORD;
				for (let at = 0; at < changes.records.length || at == 0; at += step) {
					const records = changes.records.subarray(at, at + step), growth = at == 0 ? changes.growth : new Float32Array(0);
					if (records.length || growth.length) toAll({ t: 'trees', s: treesSent, r: floatsToText(records), g: floatsToText(growth) });
				}
			}
		}
		if (now - lastWorldCheck >= 1) {
			lastWorldCheck = now;
			const world = worldNow(), text = JSON.stringify(world);
			if (text != worldSent) { worldSent = text; toAll({ t: 'world', world }); }
		}
		// the houses whose damage has changed (town.js)
		if (now - lastHouses >= HOUSES_SECONDS) {
			lastHouses = now;
			const changed = town.housesShare();
			if (changed.length && joiners.size) toAll({ t: 'houses', l: changed });
		}
		// the course, as soon as it is laid out again (turned on or off, a new one)
		const holes = discgolf.courseShare(), course = JSON.stringify(holes);
		if (course != courseSent) {
			courseSent = course;
			toAll({ t: 'course', holes });
		}
	}
	netStats.role = role;
	netStats.id = myId;
	netStats.players = names.size;
}

// for testing
export function netStatus() {
	return { role, id: myId, vehicles: allVehicles().map(({ kind, v }) => ({ kind, id: v.id, owner: v.owner, authority: v.authority, crew: v.crew instanceof Map ? [...v.crew.keys()] : Object.values(v.crew ?? {}).filter(Boolean) })), waves: water.waveClock(), name: myName, names: Object.fromEntries(names), health: Object.fromEntries(health), scores: Object.fromEntries(scores), roomCode: netStats.roomCode, status: netStats.status, others: players.otherList(), forest: { ...forestSync, queue: forestSync.queue.length },
		animals: Object.fromEntries(ANIMALS.map((animal) => [animal.kind, [...tracks.get(animal.kind).entries()].map(([id, samples]) => { const r = samples[samples.length - 1].r; return { id, x: r[1], y: r[2], z: r[3], alive: r[11] > 0.5 }; })])) };
}

// The Multiplayer window
//-------------------------------------------------
const panel = document.createElement('div');
panel.style.cssText = 'position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 30; width: min(440px, calc(100vw - 32px)); max-height: calc(100vh - 32px); overflow-y: auto; box-sizing: border-box; padding: 16px 18px; border-radius: 8px; background: #15181f; color: #e4e6ea; font: 13px/1.45 system-ui, sans-serif; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6); display: none;';
document.body.appendChild(panel);
const panelState = { view: 'start', invite: '', reply: '', error: '' };
const styles = {
	button: 'padding: 7px 12px; border: 0; border-radius: 5px; background: #3a6ff0; color: #fff; font: inherit; cursor: pointer;',
	quiet: 'padding: 7px 12px; border: 1px solid #3a3f4a; border-radius: 5px; background: transparent; color: #e4e6ea; font: inherit; cursor: pointer;',
	input: 'width: 100%; box-sizing: border-box; padding: 7px 9px; border: 1px solid #3a3f4a; border-radius: 5px; background: #0e1015; color: #e4e6ea; font: inherit;',
	code: 'width: 100%; box-sizing: border-box; height: 64px; padding: 7px 9px; border: 1px solid #3a3f4a; border-radius: 5px; background: #0e1015; color: #cfd3da; font: 11px/1.3 ui-monospace, monospace; resize: vertical; word-break: break-all;',
	label: 'margin: 12px 0 5px; font-size: 11px; letter-spacing: 0.06em; color: #9aa1ad; text-transform: uppercase;',
	room: 'font: 600 26px/1 ui-monospace, monospace; letter-spacing: 0.15em;',
};
const html = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function openPanel() {
	if (document.pointerLockElement) document.exitPointerLock();
	panel.style.display = '';
	refreshPanel();
}
function closePanel() {
	panel.style.display = 'none';
}
function refreshPanel() {
	if (panel.style.display == 'none') return;
	const s = panelState;
	let body = '';
	const header = `<div style="display: flex; justify-content: space-between; align-items: center;"><div style="font-size: 16px; font-weight: 600;">Multiplayer</div><button data-do="close" style="${styles.quiet} padding: 2px 9px;">×</button></div>`;
	const status = netStats.status ? `<div style="margin-top: 8px; color: #9fc3ff;">${html(netStats.status)}</div>` : '';
	const error = s.error ? `<div style="margin-top: 8px; color: #ff9b8a;">${html(s.error)}</div>` : '';
	// (the host can take anyone to where it is, or go to them)
	const moveButtons = (id) => role == 'host' && id !== myId
		? `<div style="display: flex; gap: 6px; margin-top: 3px;"><button data-do="bring" data-id="${id}" style="${styles.quiet} padding: 2px 8px; font-size: 12px;">Bring here</button><button data-do="goTo" data-id="${id}" style="${styles.quiet} padding: 2px 8px; font-size: 12px;">Go to</button></div>` : '';
	const playerList = () => `<div style="${styles.label}">Players</div>` + scoreList().map(([id, name, kills, deaths]) =>
		`<div style="padding: 3px 0; border-bottom: 1px solid #23272f;"><div style="display: flex; justify-content: space-between;"><span><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; background: hsl(${Math.round(players.hueOf(id) * 360)}, 70%, 55%);"></span>${html(name)}${id === myId ? ' (you)' : ''}${id === 0 ? ' · host' : ''}</span><span style="color: #9aa1ad;">${kills} kills · ${deaths} deaths</span></div>${moveButtons(id)}</div>`).join('');

	if (role == 'off' || (role == 'joining' && s.view == 'start')) {
		body = `<div style="${styles.label}">Your name</div><input data-field="name" style="${styles.input}" maxlength="20" value="${html(myName)}">`
			+ `<div style="${styles.label}">Host</div><button data-do="host" style="${styles.button}">Host a game</button>`
			+ `<div style="${styles.label}">Join with a room code</div><div style="display: flex; gap: 8px;"><input data-field="room" style="${styles.input} text-transform: uppercase; font-family: ui-monospace, monospace; letter-spacing: 0.1em;" maxlength="${ROOM_CODE_LENGTH}" placeholder="ABCDE"><button data-do="joinRoom" style="${styles.button}">Join</button></div>`
			+ `<div style="${styles.label}">Or join with an invite code</div><textarea data-field="invite" style="${styles.code}" placeholder="${INVITE_PREFIX}…"></textarea><div style="margin-top: 8px;"><button data-do="joinInvite" style="${styles.quiet}">Next</button></div>`;
	} else if (role == 'joining') {
		body = s.reply
			? `<div style="${styles.label}">Send this reply code back to the host</div><textarea readonly style="${styles.code}">${html(s.reply)}</textarea><div style="margin-top: 8px; display: flex; gap: 8px;"><button data-do="copyReply" style="${styles.button}">Copy</button><button data-do="leave" style="${styles.quiet}">Cancel</button></div>`
			: `<div style="margin-top: 12px;"><button data-do="leave" style="${styles.quiet}">Cancel</button></div>`;
	} else if (role == 'host') {
		body = `<div style="${styles.label}">Room code</div>`
			+ (netStats.roomCode ? `<div style="display: flex; align-items: center; gap: 12px;"><span style="${styles.room}">${netStats.roomCode}</span><button data-do="copyRoom" style="${styles.quiet}">Copy</button></div><div style="margin-top: 4px; color: #9aa1ad;">Friends type this in to join (through PeerJS).</div>` : `<div style="color: #9aa1ad;">Getting one…</div>`)
			+ `<div style="${styles.label}">Or invite with codes (no one in between)</div>`
			+ (s.invite
				? `<div style="color: #9aa1ad;">1. Send them this invite code.</div><textarea readonly style="${styles.code}">${html(s.invite)}</textarea><div style="margin: 6px 0 8px;"><button data-do="copyInvite" style="${styles.quiet}">Copy</button></div><div style="color: #9aa1ad;">2. Paste the reply code they send back.</div><textarea data-field="reply" style="${styles.code}" placeholder="${REPLY_PREFIX}…"></textarea><div style="margin-top: 8px; display: flex; gap: 8px;"><button data-do="acceptReply" style="${styles.button}">Connect</button><button data-do="newInvite" style="${styles.quiet}">Another invite</button></div>`
				: `<button data-do="newInvite" style="${styles.quiet}">Make an invite code</button>`)
			+ playerList() + `<div style="margin-top: 14px;"><button data-do="leave" style="${styles.quiet}">Stop hosting</button></div>`;
	} else if (role == 'joined') {
		body = playerList() + `<div style="margin-top: 14px;"><button data-do="leave" style="${styles.quiet}">Leave the game</button></div>`;
	}
	// (what is being typed is kept over the redraw)
	const kept = {};
	for (const field of panel.querySelectorAll('[data-field]')) kept[field.dataset.field] = field.value;
	panel.innerHTML = header + status + error + body;
	for (const field of panel.querySelectorAll('[data-field]')) if (kept[field.dataset.field] !== undefined && field.dataset.field != 'name') field.value = kept[field.dataset.field];
}
panel.addEventListener('click', async (event) => {
	const action = event.target?.dataset?.do;
	if (!action) return;
	const field = (name) => panel.querySelector(`[data-field="${name}"]`)?.value ?? '';
	const s = panelState;
	s.error = '';
	const copy = (text) => { try { navigator.clipboard.writeText(text); } catch (error) {} };
	try {
		if (action == 'close') return closePanel();
		if (field('name')) setName(field('name'));
		if (action == 'host') { s.invite = ''; hostGame(); }
		else if (action == 'joinRoom') { s.view = 'joining'; s.reply = ''; await joinRoom(field('room')); }
		else if (action == 'joinInvite') { s.view = 'joining'; s.reply = ''; refreshPanel(); s.reply = await joinInvite(field('invite')); }
		else if (action == 'newInvite') { s.invite = ''; say('Making an invite code…'); s.invite = await makeInvite(); say('Hosting'); }
		else if (action == 'acceptReply') { await acceptReply(field('reply')); s.invite = ''; }
		else if (action == 'copyInvite') copy(s.invite);
		else if (action == 'copyReply') copy(s.reply);
		else if (action == 'copyRoom') copy(netStats.roomCode);
		else if (action == 'leave') { s.view = 'start'; s.reply = ''; s.invite = ''; leaveGame(); }
		else if (action == 'bring' || action == 'goTo') movePlayer(action, Number(event.target.dataset.id));
	} catch (error) {
		s.error = error.message || String(error);
		if (role == 'joining' && !hostLink?.open) { s.view = 'start'; }
	}
	refreshPanel();
});
// the host's Bring here (that player to where the host stands) and Go to (the host to that player)
export function movePlayer(action, id) {
	if (role != 'host') return;
	const joiner = joiners.get(id);
	if (!joiner) throw new Error('That player has gone');
	if (action == 'bring') {
		const place = hunting.hunterPlace();
		if (!place.active) throw new Error('Go out hunting first (Hunting and Sailing)');
		joiner.link.sendGame({ t: 'tp', to: [place.x, place.y, place.z] });
		say('Brought ' + joiner.name + ' to you');
	} else {
		if (!joiner.state || !hunting.hunterPlace().active) throw new Error(joiner.state ? 'Go out hunting first (Hunting and Sailing)' : 'Not heard from them yet');
		hunting.teleportHunter(joiner.state[0], joiner.state[1], joiner.state[2]);
		say('Went to ' + joiner.name);
	}
}

// keys typed in the window are for it, not the walker
panel.addEventListener('keydown', (event) => event.stopPropagation());

// the button that opens it, with the game modes. Added on the first frame: the controls are not made yet when this file is
//		first run (imguiLoader.js is still on its way in)
let buttonAdded = false;
function addButton() {
	buttonAdded = true;
	const modes = gui.foldersRecursive().find((folder) => folder._title == 'Game Modes') ?? gui;
	modes.add({ open: openPanel }, 'open').name('Multiplayer…');
}
