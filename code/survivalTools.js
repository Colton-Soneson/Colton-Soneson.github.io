import {canvas} from './deviceSelection.js'

import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import * as terrain from './terrain.js'
import * as transformations from './transformations.js'
import * as hunting from './hunting.js'
import * as weapons from './weapons.js'
import * as ballistics from './ballistics.js'
import * as help from './controlsHelp.js'
import * as vm from './viewmodel.js'
import * as smoke from './smoke.js'
import * as pointLights from './pointLights.js'
import * as props from './props.js'
import * as campfires from './campfires.js'
import * as survivalNet from './survivalNet.js'
import { MESHES } from './itemMeshes.js'
import { ITEMS, HANDS, makeItem, handSlots } from './items.js'
import * as inventory from './inventory.js'
import * as survival from './survival.js'
import * as loot from './loot.js'
import * as deer from './deer.js'
import * as forest from './forest.js'
import * as camp from './camp.js'

/*
	THE TOOLS of the Survival mode, in the hands (from T: survival.js; each one a weapons.js weapon, its item the one it was taken up from):
		lighter		left click: at a campfire laid ready (campfires.js), it is lit; otherwise the lighter, lit or put out. Lit, it is a
					little light (a moving light: pointLights.js)
		hatchet		left click: a blow (a short round, ballistics.js 'chop'): it hurts what it hits. A tree hit enough times (CHOPS: more
					for a taller one) comes down (forest.js: fellTree, the host's to do: fell, felled back), and gives firewood by how tall
					it was (WOOD_METRES of it a firewood). Right click held, then left: thrown (ballistics.js 'hatchet'): it flies, hurts what it hits, and lies where it
					comes down (a pile, loot.js) for E to pick up, glowing as the discs do (discgolf.js) and marked through anything (MARK)
		knife		left click: a stab ('stab'). Right click held, then left: thrown, as the hatchet
		(either, at a dead deer within BUTCHER_REACH: a cut of venison off it, deer.js: butcher; the host's to say, a joiner asks: butcher,
		butchered back. Cooked at a campfire: campfires.js)
		stone		left click: one thrown (a stack of them; a bird is brought down by one)
		food, drink	left click: eaten, or drunk (survival.js: consume), and one fewer
		compass		held face up in front: its card turns to keep its N to the north (the land's -z: survivalMap.js draws it north up),
					and the bearing the walker faces is written under it
		carry		the camp's big things (camp.js), carried in the arms: left click, the tent pitched in front, or the stove or the rain
					collector put in its place in the tent looked at
		watch		worn on the wrist, taken up from T: the wrist raised, its hands at the world's time (survival.js: the sun's angle),
					and the time written under it
	THE CAMPFIRES are campfires.js's.
	THE THINGS OUT IN THE WORLD (props.js): the crates and caches, the bodies' sacks and the piles (loot.js), the campfires, and what is
	in the air thrown. One looked at glows.
	GOD MODE (survival.js): every equippable on T as a ring of its own (everyEquippable), taken up out of nowhere and not used up.
*/
const CHOPS = { least: 3, most: 6, metres: 8 };	// blows a tree takes: least, and one more for every so many metres tall, up to most
const WOOD_METRES = 5;				// metres of tree a firewood (one at the least, six at the most)
const THROW = { hatchet: 16, knife: 18, stone: 20 };	// metres a second
const SWING = { chop: 0.42, stab: 0.3, throw: 0.32, eat: 1.3, light: 0.25 };
const RAISE = 0.35;					// seconds the compass and the watch take to come up	// seconds
const BUTCHER_REACH = 2.8;			// metres from the eye a dead deer is cut from
const MARK = 90;					// metres the thrown things lying out are marked through anything
const SHOW_REACH = 300;				// metres the props are drawn out to
const TOOL_WEAPONS = ['lighter', 'hatchet', 'knife', 'stone', 'eat', 'compass', 'watch', 'carry'];
const nowSeconds = () => performance.now() / 1000;

// what is in the hands: its item (or one out of nowhere, god mode)
const held = { item: null, virtual: false };
export const toolStats = { chops: 0, firewood: 0, thrown: 0, eaten: 0, blows: 0, venison: 0 };
function holdItem(item, virtual = false) {
	const it = ITEMS[item.type];
	if (!it?.weapon) return false;
	held.item = item; held.virtual = virtual;
	tool.state = 'ready'; tool.t = 0; tool.raised = false;
	weapons.equipWeapon(it.weapon);
	return weapons.weaponState.current == it.weapon;
}
survival.setHoldItem((item) => holdItem(item));
camp.onHold((item) => holdItem(item));
const CARRIED_MESH = { tent: 'tentBundle', tentStove: 'stovePacked', rainCollector: 'collectorPacked' };
survival.setWatchChoice({ label: 'Wristwatch', detail: 'Raise the wrist to read it', act: () => { weapons.equipWeapon('watch'); return weapons.weaponState.current == 'watch'; } });
survival.setEveryEquippable(() => Object.values(ITEMS).filter((it) => handSlots(it.type).length).map((it) => ({ label: it.name, detail: it.detail ?? 'Out of nowhere (god mode)', act: () => holdItem(makeItem(it.type, it.stack ?? 1), true) })));
const usedUp = (count = 1) => {
	if (held.virtual || !held.item) return;
	for (let k = 0; k < count; k++) inventory.useOne(held.item);
	if (held.item.count <= 0 || !inventory.everything().some(({ item }) => item === held.item)) { held.item = null; weapons.equipWeapon('none'); }
};

// THE MODELS in the hands
const views = {};
for (const name of ['lighter', 'hatchet', 'knife', 'stone', 'bread', 'sausage', 'venison', 'cookedVenison', 'smokedFish', 'water', 'beer', 'compass', 'watchArm', 'tentBundle', 'stovePacked', 'collectorPacked']) views[name] = new vm.Viewmodel('held ' + name, MESHES[name].data);
const meshFor = (type) => views[type] ? type : null;

const tool = { state: 'ready', t: 0, raised: false, lit: false, chops: 0, fired: false, up: 0 };
const name = () => weapons.weaponState.current;
const usable = () => TOOL_WEAPONS.includes(name()) && weapons.holding(name()) && !hunting.input.menuOpen && document.pointerLockElement == canvas;
for (const w of TOOL_WEAPONS) weapons.addWeapon(w, { label: { lighter: 'Lighter', hatchet: 'Hatchet', knife: 'Small knife', stone: 'Throwing stones', eat: 'Food', compass: 'Compass', watch: 'Wristwatch', carry: 'Carried' }[w], detail: '', menu: null,
	equip: () => { tool.state = 'ready'; tool.t = 0; tool.raised = false; tool.up = 0; if (w != 'lighter') tool.lit = false; },
	reset: () => {}, help: () => helpFor(w), drawn: () => draw(w) });
function helpFor(w) {
	const it = held.item ? ITEMS[held.item.type] : null;
	if (w == 'lighter') return ['Lighter', [['Left click', tool.lit ? 'put out (at the ground, with firewood: a campfire)' : 'light']]];
	if (w == 'hatchet') return ['Hatchet', [['Left click', 'a blow (a tree: firewood)'], ['Right held + left', 'throw it']]];
	if (w == 'knife') return ['Small knife', [['Left click', 'stab'], ['Right held + left', 'throw it']]];
	if (w == 'stone') return ['Throwing stones', [['Left click', `throw one (${held.item?.count ?? 0} left)`]]];
	if (w == 'compass') return ['Compass', [['Turn', 'its N stays to the north']]];
	if (w == 'watch') return ['Wristwatch', [['T', 'put the wrist down again']]];
	if (w == 'carry') return [it?.name ?? 'Carried', [['Left click', it?.camp == 'tent' ? 'pitch it here' : 'put it in the tent you look at']]];
	return [it?.name ?? 'Food', [['Left click', it?.drink && !it?.food ? 'drink' : 'eat']]];
}

// THE INPUT
window.addEventListener('mousedown', (e) => {
	if (!usable()) return;
	if (e.button == 2) { tool.raised = true; return; }
	if (e.button != 0 || tool.state != 'ready') return;
	const w = name();
	if (w == 'lighter') { lighterClick(); return; }
	if (w == 'carry') { carryClick(); return; }
	if (w == 'eat') { start('eat'); weapons.actionSound('eat'); return; }
	if (w == 'stone' || ((w == 'hatchet' || w == 'knife') && tool.raised)) { start('throw'); weapons.actionSound('swish'); return; }
	if (w == 'hatchet') { start('chop'); weapons.actionSound('swish'); return; }
	if (w == 'knife') { start('stab'); weapons.actionSound('swish'); }
});
window.addEventListener('mouseup', (e) => { if (e.button == 2) tool.raised = false; });
function start(state) { tool.state = state; tool.t = 0; tool.fired = false; }

// CARRIED (see the top): the tent pitched, or an attachment into the tent looked at
function carryClick() {
	const item = held.item, it = item && ITEMS[item.type];
	if (!it) return;
	let done = false;
	if (it.camp == 'tent') done = camp.pitch(item);
	else {
		const v = camp.inView();
		if (!v) { help.toast('Look at your tent to set it up in it'); return; }
		const slot = Object.keys(camp.TENT_SLOTS).find((s) => camp.TENT_SLOTS[s] == it.camp && !v.tent.slots[s]);
		if (!slot) { help.toast('That tent has one already'); return; }
		done = camp.put({ kind: 'tent', id: v.tent.id }, slot, item);
		if (done) help.toast(it.name + ' set up in the tent');
	}
	if (done) { held.item = null; weapons.equipWeapon('none'); }
}

// THE LIGHTER: at a campfire laid ready, it is lit (campfires.js); otherwise the lighter itself, lit or put out
function lighterClick() {
	weapons.actionSound('flick');
	const stove = camp.stoveInView();
	if (stove && !camp.stoveBurning(stove)) {
		if (stove.stove.fuel <= 0) { help.toast('No wood in the stove: E to put some in'); start('light'); return; }
		tool.lit = true;
		camp.stoveLight(stove.id);
		help.toast('The stove catches');
		start('light');
		return;
	}
	const f = campfires.inView();
	if (f && campfires.stageOf(f) == 'laid') {
		tool.lit = true;
		campfires.light(f.id);
		help.toast('The campfire catches');
		start('light');
		return;
	}
	if (f && campfires.stageOf(f) == 'dead') help.toast('Burnt out: E to lay more wood on it');
	tool.lit = !tool.lit;
	start('light');
}

// THE SWINGS, throws and meals, once a frame
function act(dt) {
	if (tool.state == 'ready') return;
	tool.t += dt;
	const w = name(), T = SWING[tool.state] ?? 0.3;
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ], f = transformations.getCameraForward(), m = settings.forestUnitsPerMetre;
	if (!tool.fired && tool.t > T * 0.45) {
		tool.fired = true;
		if (tool.state == 'chop' || tool.state == 'stab') {
			const carcass = deer.corpseInReach(eye, f, BUTCHER_REACH * m);
			if (carcass != null) butcher(carcass);
			else ballistics.fire(eye, f, { round: tool.state });
			toolStats.blows++;
		}
		if (tool.state == 'throw' && held.item) {
			const it = held.item, kind = it.type == 'stone' ? 'stone' : it.type;
			const one = held.virtual ? makeItem(it.type) : it.type == 'stone' ? makeItem('stone') : it;
			const p = hunting.hunterPlace(), up = 0.1;
			const dir = [f[0], f[1] + up, f[2]], L = Math.hypot(...dir), speed = THROW[kind] * m;
			ballistics.fire(eye.map((v, i) => v + f[i] * 0.4 * m), dir.map((v, i) => v / L * speed + (i == 0 ? p.vx ?? 0 : i == 2 ? p.vz ?? 0 : 0)), { round: kind, extra: { item: one } });
			toolStats.thrown++;
			if (!held.virtual) { if (it.type == 'stone') usedUp(); else { inventory.remove(it); held.item = null; } }
		}
	}
	if (tool.t >= T) {
		if (tool.state == 'eat' && held.item) {
			survival.consume(held.item.type);
			toolStats.eaten++;
			usedUp();
		}
		const gone = tool.state == 'throw' && !held.item;
		tool.state = 'ready';
		if (gone) weapons.equipWeapon('none');
	}
}
// A TREE DOWN (see the top): the host brings it down; the one who chopped it gets the firewood
function fell(index, direction) {
	const height = forest.fellTree(index, direction);
	return height > 0 ? Math.min(Math.max(Math.round(height / WOOD_METRES), 1), 6) : 0;
}
function felled(wood) {
	if (!wood) { help.toast('It will not come down'); return; }
	toolStats.felled = (toolStats.felled ?? 0) + 1;
	toolStats.firewood += wood;
	weapons.actionSound('chop');
	for (let left = wood; left > 0; left -= ITEMS.firewood.stack) {
		const pile = makeItem('firewood', Math.min(left, ITEMS.firewood.stack));
		if (!inventory.give(pile)) loot.dropHere([pile]);
	}
	help.toast(`Timber! ${wood} firewood`, 2.5);
}
survivalNet.on('fell', (msg, from) => { if (survivalNet.authority()) survivalNet.sendTo(from, 'felled', { wood: fell(Number(msg.index), Number(msg.direction) || 0) }); });
survivalNet.on('felled', (msg) => felled(Number(msg.wood) || 0));

// A DEAD DEER (see the top): a cut of venison off it, the host's to say
function butcher(id) {
	weapons.actionSound('chop');
	if (survivalNet.authority()) gotMeat(deer.butcher(id));
	else survivalNet.send('butcher', { id });
}
function gotMeat(ok) {
	if (!ok) { help.toast('Nothing more on it to cut'); return; }
	toolStats.venison++;
	const meat = makeItem('venison');
	if (!inventory.give(meat)) loot.dropHere([meat]);
	help.toast('Raw venison');
}
survivalNet.on('butcher', (msg, from) => { if (survivalNet.authority()) survivalNet.sendTo(from, 'butchered', { ok: deer.butcher(Number(msg.id)) }); });
survivalNet.on('butchered', (msg) => gotMeat(!!msg.ok));
hunting.addPrompt(() => {
	if (!inventory.survivalOn() || hunting.hunterPlace().on != 'land') return null;
	if (deer.corpseInReach([settings.camPosX, settings.camPosY, settings.camPosZ], transformations.getCameraForward(), BUTCHER_REACH * settings.forestUnitsPerMetre) == null) return null;
	return { name: 'Dead deer', keys: name() == 'hatchet' || name() == 'knife' ? 'Left click: cut venison' : 'A hatchet or a knife: cut venison' };
});

// where a thrown thing came down: lying there, to be picked up; a blow on a tree: firewood in time
ballistics.onStop((at, bullet, what) => {
	if (bullet.round == 'chop' && what == 'trunk') {
		weapons.actionSound('chop');
		toolStats.chops++;
		const m = settings.forestUnitsPerMetre, tree = forest.treeNear(at[0], at[2], 1.5 * m);
		if (!tree) return;
		if (tree.planted) { help.toast('One of the town\'s trees: leave it be'); return; }
		if (tool.chopTree !== tree.index) { tool.chopTree = tree.index; tool.chops = 0; }
		const needed = Math.min(CHOPS.least + Math.floor(tree.height / CHOPS.metres), CHOPS.most);
		if (++tool.chops < needed) { help.toast(`Chopping: ${tool.chops} of ${needed}`, 0.8); return; }
		tool.chops = 0; tool.chopTree = null;
		const p = hunting.hunterPlace(), direction = Math.atan2(tree.z - p.z, tree.x - p.x);
		if (survivalNet.authority()) felled(fell(tree.index, direction));
		else survivalNet.send('fell', { index: tree.index, direction });
		return;
	}
	if (bullet.round == 'chop' || bullet.round == 'stab') { if (what) weapons.actionSound('knock'); return; }
	const item = bullet.extra?.item;
	if (!item) return;
	const land = terrain.land, g = land.heightAt(at[0], at[2]);
	loot.dropHere([item], [at[0], Math.max(g, settings.waterWorldPosY), at[2]]);
});

// THE THINGS OUT IN THE WORLD (see the top), and the marks over this player's thrown ones lying out
const MESH_OF = { tent: 'tentBundle', tentStove: 'stovePacked', rainCollector: 'collectorPacked', compass: 'compass', smokedFish: 'smokedFish', hatchet: 'hatchet', knife: 'knife', stone: 'stone', bread: 'bread', sausage: 'sausage', venison: 'venison', cookedVenison: 'cookedVenison', water: 'water', beer: 'beer', firewood: 'firewood', bedroll: 'bedroll', lighter: 'lighter' };
const marks = document.createElement('div');
marks.style.cssText = 'position: fixed; inset: 0; pointer-events: none; z-index: 4; font: 11px system-ui, sans-serif;';
document.body.appendChild(marks);
function screenOf(at) {
	const c = vec3.transformMat4(at, transformations.getViewProj());
	const w = transformations.getViewProj();
	const cw = w[3] * at[0] + w[7] * at[1] + w[11] * at[2] + w[15];
	if (cw <= 0) return null;
	return [(c[0] * 0.5 + 0.5) * innerWidth, (0.5 - c[1] * 0.5) * innerHeight];
}
function showWorld() {
	const m = settings.forestUnitsPerMetre, t = nowSeconds();
	const looked = loot.inView();
	let markHtml = '';
	for (const c of loot.containerList()) {
		const d = Math.hypot(c.at[0] - settings.camPosX, c.at[2] - settings.camPosZ) / m;
		if (d > SHOW_REACH) continue;
		const glow = c === looked ? [1.0, 0.82, 0.45, 0.55] : [0, 0, 0, 0];
		if (c.kind == 'crate' || c.kind == 'cache') props.show('crate', props.place(c.at, c.yaw ?? 0, 0, 0, c.kind == 'cache' ? 1.25 : 1), glow);
		else if (c.kind == 'body' || c.kind == 'npcBody') props.show('sack', props.place(c.at, 0, 0, 0, 1.2), glow);
		else if (c.kind == 'pile') {
			const one = c.items?.length == 1 ? c.items[0] : null, mesh = one && MESH_OF[one.type];
			// (a thrown hatchet or knife lying out: glowing, as the discs do, and marked)
			const tool = one && (one.type == 'hatchet' || one.type == 'knife');
			const pulse = tool ? [1.0, 0.55, 0.12, 0.35 + 0.25 * Math.sin(t * 4)] : glow;
			if (mesh) props.show(mesh, props.place([c.at[0], c.at[1] + 0.03 * m, c.at[2]], (c.id.length * 1.3) % 6.28, 0, Math.PI / 2), c === looked ? glow : pulse);
			else props.show('sack', props.place(c.at, 0, 0, 0, 0.6), glow);
			if (tool && d < MARK) {
				const s = screenOf([c.at[0], c.at[1] + 0.4 * m, c.at[2]]);
				if (s) markHtml += `<div style="position:absolute; left:${s[0]}px; top:${s[1]}px; transform:translate(-50%,-100%); color:#ffb04a; text-shadow:0 0 3px #000; text-align:center;">◆<br>${ITEMS[one.type].name} · ${Math.round(d)} m</div>`;
			}
		}
	}
	marks.innerHTML = markHtml;
	// in the air: what has been thrown, turning over as it goes
	for (const round of ['hatchet', 'knife', 'stone']) for (const b of ballistics.flyingOf(round)) {
		const heading = Math.atan2(b.v[0], b.v[2]);
		props.show(round, props.place(b.at, heading, -t * 14, 0));
	}
}

// IN THE HANDS (see the top): the model where it is held, as it is being used
function draw(w) {
	const it = held.item ? ITEMS[held.item.type] : null;
	const mesh = w == 'eat' ? meshFor(held.item?.type) : w == 'watch' ? 'watchArm' : w == 'carry' ? CARRIED_MESH[held.item?.type] : w;
	if (!mesh || !views[mesh]) return;
	const s = tool.state, k = SWING[s] ? Math.min(tool.t / SWING[s], 1) : 0;
	let x = 0.2, y = -0.24, z = -0.42, yaw = -0.15, pitch = 0, roll = 0;
	const parts = [];
	if (w == 'lighter') {
		x = 0.13; y = -0.17; z = -0.33;
		parts[1] = tool.lit ? mat4.multiply(mat4.translation([0.019, 0.036, 0]), mat4.multiply(mat4.rotationZ(-1.9), mat4.translation([-0.019, -0.036, 0]))) : vm.IDENTITY;
		parts[2] = tool.lit ? mat4.scaling([1, 0.85 + 0.25 * Math.sin(nowSeconds() * 23), 1]) : vm.HIDDEN;
	} else if (w == 'hatchet') {
		y = -0.42; z = -0.45; pitch = -0.25;
		if (tool.raised && s == 'ready') { y = -0.28; pitch = 0.9; x = 0.24; }
		if (s == 'chop') { const a = Math.sin(k * Math.PI); pitch = 0.9 - k * 2.2; y = -0.36 + a * 0.08; z = -0.45 - a * 0.12; }
		if (s == 'throw') { pitch = 0.9 - k * 3; z = -0.45 - k * 0.3; }
	} else if (w == 'knife') {
		x = 0.17; y = -0.2; z = -0.38; pitch = 0.1;
		if (tool.raised && s == 'ready') { y = -0.12; pitch = 0.6; }
		if (s == 'stab') z = -0.38 - Math.sin(k * Math.PI) * 0.22;
		if (s == 'throw') { pitch = 0.6 - k * 2; z = -0.38 - k * 0.3; }
	} else if (w == 'compass') {
		// face up, tipped towards the eye, coming up into view; its card turned against the way the walker faces
		const k = vm.ease(tool.up);
		x = 0.02; y = -0.3 + k * 0.13; z = -0.3; yaw = 0; pitch = 0.95;
		parts[1] = mat4.rotationY(-settings.camYaw);
	} else if (w == 'watch') {
		// the forearm across the view from the left, the wrist turned up; the hands at the time
		const k = vm.ease(tool.up);
		x = 0.0; y = -0.34 + k * 0.2; z = -0.34; yaw = 0.8; pitch = 0.85; roll = 0;
		const hours = survival.hoursNow(), turn = (f) => mat4.rotationY(f * Math.PI * 2);
		parts[1] = turn((hours % 12) / 12); parts[2] = turn((hours % 1)); parts[3] = turn((hours * 60) % 1);
	} else if (w == 'carry') {
		// in both arms, low in front
		x = 0.0; y = held.item?.type == 'tent' ? -0.42 : -0.62; z = held.item?.type == 'tent' ? -0.55 : -0.7; yaw = held.item?.type == 'tent' ? Math.PI / 2 : 0.2; pitch = 0;
	} else if (w == 'stone') {
		x = 0.17; y = -0.18; z = -0.34;
		if (s == 'throw') { y = -0.1 + k * 0.05; z = -0.34 - k * 0.4; }
	} else {
		// food and drink: to the mouth and back
		const a = s == 'eat' ? Math.sin(Math.min(k * 1.6, 1) * Math.PI * 0.5) * (k > 0.8 ? (1 - k) * 5 : 1) : 0;
		x = 0.16 - a * 0.14; y = -0.22 + a * 0.15; z = -0.36 + a * 0.12; pitch = it?.drink && !it?.food ? a * 1.2 : 0;
	}
	let mtx = mat4.translation([x, y, z]);
	if (w == 'watch') mtx = mat4.rotateZ(mtx, -0.25);
	mtx = mat4.rotateY(mtx, yaw);
	mtx = mat4.rotateX(mtx, pitch);
	mtx = mat4.rotateZ(mtx, roll);
	mtx = mat4.scale(mtx, [1, 1, -1]);
	views[mesh].draw(mtx, parts, w == 'lighter' && tool.lit ? [1.0, 0.6, 0.2, 1.6] : [0, 0, 0, 0]);
}

// what the compass and the watch say, written under them
const readout = document.createElement('div');
readout.style.cssText = 'position: fixed; left: 50%; bottom: 20%; transform: translateX(-50%); padding: 3px 10px; border-radius: 4px; background: rgba(0, 0, 0, 0.5); color: #efe4cc; font: 13px Georgia, serif; z-index: 5; pointer-events: none; display: none;';
document.body.appendChild(readout);
const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function readoutUpdate(dt) {
	const w = name(), on = (w == 'compass' || w == 'watch') && weapons.holding(w);
	tool.up = on ? Math.min(tool.up + dt / RAISE, 1) : 0;
	if (!on || tool.up < 1) { readout.style.display = 'none'; return; }
	let text;
	if (w == 'compass') { const deg = ((settings.camYaw * 180 / Math.PI) % 360 + 360) % 360; text = `${POINTS[Math.round(deg / 45) % 8]} · ${Math.round(deg)}°`; }
	else text = survival.clockText();
	readout.style.display = '';
	if (readout.textContent != text) readout.textContent = text;
}

// Once a frame
let lastTime = performance.now();
export function survivalToolsUpdate() {
	const now = performance.now(), dt = Math.min((now - lastTime) / 1000, 0.1);
	lastTime = now;
	if (!inventory.survivalOn()) { marks.innerHTML = ''; readout.style.display = 'none'; pointLights.setMovingLight('lighter', null); return; }
	act(dt);
	readoutUpdate(dt);
	showWorld();
	const p = hunting.hunterPlace(), m = settings.forestUnitsPerMetre;
	pointLights.setMovingLight('lighter', name() == 'lighter' && tool.lit && weapons.holding('lighter') ? { at: [p.x, p.y + 1.5 * m, p.z], radius: 6 * m, colour: [1.0, 0.65, 0.3], strength: 1.4, night: false } : null);
	// (the item held gone from the hands, from the inventory screen: put away)
	if (held.item && !held.virtual && TOOL_WEAPONS.includes(name()) && !HANDS.some((h) => inventory.inv.hands[h] === held.item)) { held.item = null; weapons.equipWeapon('none'); }
}
// for testing
export const toolForTest = () => ({ ...tool, held: held.item?.type ?? null });
