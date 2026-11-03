import { settings, savedWorld, SAVE_LOADING } from './settings.js';
import { gui } from './imguiLoader.js';

import * as terrain from './terrain.js'
import * as atmosphere from './atmosphere.js'
import * as hunting from './hunting.js'
import * as help from './controlsHelp.js'
import * as net from './net.js'
import * as survivalNet from './survivalNet.js'
import * as inventory from './inventory.js'
import * as medical from './medical.js'
import * as survival from './survival.js'
import * as shops from './shops.js'
import * as cabins from './cabins.js'
import * as treasury from './treasury.js'
import * as townEconomy from './townEconomy.js'
import * as survivalWar from './survivalWar.js'
import * as town from './town.js'
import * as townFolk from './townFolk.js'
import * as forest from './forest.js'
import * as camp from './camp.js'
import * as campfires from './campfires.js'
import * as bedrolls from './bedrolls.js'
import * as loot from './loot.js'
import * as mining from './mining.js'

/*
	THE SAVE FILE (the Survival mode's): everything a player has done to the world and has with them, in one small file to download, and
	to load again on any machine (the Survival menu's Save and Load, or Ctrl+S to save).
		WHAT IS IN IT		the world (every setting the land, the forest, the weather and the rest are made from: net.js's worldSettings,
							as a joiner is given them; and its clock and the townsfolk's), what the browser keeps of it (stored: the
							inventory, the body, the needs, the bank, the cabins with their stations, farms and chests, the towns' treasuries
							and economy, the bedroll last slept on, the allegiance, the name), where the player is, and what has been done
							to the world that is not kept in the browser (things): the houses' damage, the tents, the campfires, the bedrolls
							laid out, the bodies and piles and snares, what is in the caches, the veins worked and the mushrooms picked, the
							trees brought down (forest.js: felled) and the wars on. Nothing that comes from the seed is in it: that is made
							again, the same
		THE FILE			FORMAT (4 bytes), its version (2), nothing (2), then the whole of it as JSON, gzipped (CompressionStream): a few
							kilobytes
		LOADING				the file read and its version checked, then put in the session's storage and the page loaded again: so the world
							is made from it from the start. settings.js writes back what is kept in the browser and puts in the world's
							settings before anything reads them (savedWorld), and once the world is made (ready) the rest is put back here
	MULTIPLAYER: anyone can save (a joiner's file has the world as the host has told it, and its own things). Loading is for one alone or a
	host (it leaves the game, as the page loads again): a joiner leaves first. The host's world, loaded, is everyone's as they join.
*/
const FORMAT = [0x48, 0x53, 0x56, 0x31];		// 'HSV1'
const VERSION = 1;
const EXTENSION = '.huntsave';
const READY_WAIT = 2;							// seconds after the world is made before the rest is put back (the caches made)
const READY_MOST = 90;							// seconds: put back as it is, ready or not

export const saveStats = { saved: 0, bytes: 0, json: 0, loaded: 0, applied: null };

// WHAT IS IN IT (see the top)
//-------------------------------------------------
const kept = (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } };
export function collect() {
	const stored = {};
	for (const r of [inventory.inventoryRecord(), medical.medicalRecord(), survival.statusRecord(), shops.bankRecord(), cabins.cabinsRecord(), treasury.treasuryRecord(), townEconomy.economyRecord()]) stored[r.key] = r.text;
	for (const key of ['survivalSlept', 'survivalAllegiance', 'huntName']) { const text = kept(key); if (text !== null) stored[key] = text; }
	const p = hunting.hunterPlace();
	return {
		version: VERSION, savedAt: new Date().toISOString(),
		world: { settings: net.worldSettings(), clock: [atmosphere.sunCycles, settings.sunCycleAngle], folk: townFolk.folkClock() },
		stored,
		player: { at: [p.x, p.y, p.z], yaw: settings.camYaw, pitch: settings.camPitch, active: !!p.active },
		things: {
			houses: town.housesRecord(), tents: camp.campRecord(), fires: campfires.firesRecord(), rolls: bedrolls.rollsRecord(), loot: loot.lootRecord(),
			mining: mining.miningRecord(), felled: forest.felledRecord(), wars: survivalWar.warsRecord(),
		},
	};
}

// THE FILE (see the top)
//-------------------------------------------------
async function through(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
export async function encode(save) {
	const json = new TextEncoder().encode(JSON.stringify(save)), packed = await through(json, new CompressionStream('gzip'));
	const out = new Uint8Array(8 + packed.length);
	out.set(FORMAT, 0);
	new DataView(out.buffer).setUint16(4, VERSION, true);
	out.set(packed, 8);
	saveStats.json = json.length;
	return out;
}
export async function decode(bytes) {
	if (bytes.length < 8 || FORMAT.some((b, k) => bytes[k] != b)) throw new Error('That is not a save file');
	const version = new DataView(bytes.buffer, bytes.byteOffset).getUint16(4, true);
	if (version > VERSION) throw new Error('That save is from a newer version of the game');
	const save = JSON.parse(new TextDecoder().decode(await through(bytes.subarray(8), new DecompressionStream('gzip'))));
	if (!save || typeof save != 'object' || !save.world || !save.stored) throw new Error('That save file is damaged');
	return save;
}
const fileName = () => `survival-seed${settings.terrainSeed}-day${Math.floor(atmosphere.sunCycles) + 1}${EXTENSION}`;
// saved: the file made and handed to the browser to download
export async function saveGame() {
	if (!inventory.survivalOn()) { help.toast('Saving is for the Survival mode'); return null; }
	inventory.save();
	const bytes = await encode(collect());
	const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })), a = document.createElement('a');
	a.href = url;
	a.download = fileName();
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10000);
	saveStats.saved++;
	saveStats.bytes = bytes.length;
	help.toast(`Saved: ${a.download} (${Math.max(1, Math.round(bytes.length / 1024))} KB)`, 3);
	return bytes;
}
// loaded: read, put in the session's storage, and the page loaded again (see LOADING at the top)
export async function loadGame(bytes) {
	if (survivalNet.role() == 'joined') { help.toast('Leave the game first: loading is for one alone, or a host'); return false; }
	let save;
	try { save = await decode(bytes); } catch (e) { help.toast(e.message || 'That save file could not be read', 4); return false; }
	try { sessionStorage.setItem(SAVE_LOADING, JSON.stringify(save)); } catch (e) { help.toast('There is no room in the browser to load it', 4); return false; }
	saveStats.loaded++;
	help.toast('Loading the save…', 2);
	setTimeout(() => location.reload(), 150);
	return true;
}
const picker = document.createElement('input');
picker.type = 'file';
picker.accept = EXTENSION;
picker.style.display = 'none';
document.body.appendChild(picker);
picker.addEventListener('change', async () => {
	const file = picker.files?.[0];
	picker.value = '';
	if (file) loadGame(new Uint8Array(await file.arrayBuffer()));
});
export function chooseFile() { picker.click(); }
// the Survival menu's buttons, and Ctrl+S
const folder = gui.foldersRecursive().find((f) => f._title == 'Survival');
if (folder) {
	folder.add({ save: () => saveGame() }, 'save').name('Save Game (download)');
	folder.add({ load: () => chooseFile() }, 'load').name('Load Game (a save file)');
}
window.addEventListener('keydown', (event) => {
	if (event.code != 'KeyS' || !(event.ctrlKey || event.metaKey) || !inventory.survivalOn()) return;
	event.preventDefault();
	if (!event.repeat) saveGame();
});

// PUT BACK, once the world is made (see LOADING at the top)
//-------------------------------------------------
let pending = savedWorld, readySince = -1, started = performance.now(), clockSet = false, placedEarly = false;
function ready() {
	const land = terrain.land;
	if (!land || !forest.forestReady()) return false;
	// (in a world of tiles: the tile the player was on here too, if it is one of the world's: terrain.js streams it in as the walker is there)
	const P = pending.player;
	if (terrain.world && P?.active && Array.isArray(P.at)) {
		const S = settings.terrainWorldSize, key = Math.round(P.at[0] / S) + ',' + Math.round(P.at[2] / S);
		if (terrain.world.tiles.has(key) && !terrain.tilesLoaded().some((t) => t.key == key)) return false;
	}
	if ((land.towns ?? []).some((t) => t.buildings.length) && !town.housesReady()) return false;
	return hunting.hunterPlace().active;
}
export function savesUpdate() {
	if (!pending) return;
	// (the clock at once: everything that counts the days counts from it)
	if (!clockSet) {
		clockSet = true;

		const [cycles, angle] = pending.world?.clock ?? [];
		if (Number.isFinite(Number(cycles))) atmosphere.setSunClock(Number(cycles), Number(angle) || settings.sunCycleAngle);
		if (Number.isFinite(Number(pending.world?.folk))) townFolk.setFolkClock(Number(pending.world.folk));
	}
	// (and the walker where it was, as soon as there is one, for a start: so the tiles round it come in)
	const P = pending.player;
	if (!placedEarly && terrain.world && P?.active && Array.isArray(P.at) && hunting.hunterPlace().active) { placedEarly = true; hunting.placeHunter(Number(P.at[0]), Number(P.at[2])); }
	const now = performance.now() / 1000;
	if (ready()) { if (readySince < 0) readySince = now; }
	else readySince = -1;
	if (!(readySince >= 0 && now - readySince >= READY_WAIT) && now - started / 1000 < READY_MOST) return;
	const T = pending.things ?? {}, report = {};
	const step = (name, fn) => { try { report[name] = fn() ?? true; } catch (e) { report[name] = 'failed: ' + e.message; } };
	step('houses', () => town.housesAdopt(T.houses));
	step('tents', () => camp.campAdopt(T.tents));
	step('fires', () => campfires.firesAdopt(T.fires));
	step('rolls', () => bedrolls.rollsAdopt(T.rolls));
	step('loot', () => loot.lootAdopt(T.loot));
	step('mining', () => mining.miningAdopt(T.mining));
	step('felled', () => forest.felledAdopt(T.felled));
	step('wars', () => survivalWar.warsAdopt(T.wars));
	step('player', () => {
		const P = pending.player;
		if (!P?.active || !Array.isArray(P.at)) return false;
		hunting.placeHunter(Number(P.at[0]), Number(P.at[2]));
		settings.camYaw = Number(P.yaw) || 0;
		settings.camPitch = Number(P.pitch) || 0;
		return true;
	});
	saveStats.applied = report;
	pending = null;
	help.toast(`Loaded: day ${Math.floor(atmosphere.sunCycles) + 1}`, 3);
}

// for testing
export const savePendingForTest = () => !!pending;
