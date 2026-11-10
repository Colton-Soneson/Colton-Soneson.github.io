import { device } from './deviceSelection.js'

import { mat4 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';
import { vf_inspect } from '../shaders/js/vf_inspect.js'

import * as hunting from './hunting.js'
import * as transformations from './transformations.js'
import * as help from './controlsHelp.js'
import * as survivalNet from './survivalNet.js'
import * as journal from './journalUI.js'
import * as deer from './deer.js'
import * as beasts from './beasts.js'
import * as rabbits from './rabbits.js'
import { CREATURE_MESHES } from './creatureMeshes.js'
import { ITEMS, QUALITY, dollars } from './items.js'
import { ANATOMY, ORGAN_NAMES, KIND_NAMES, bend, angleOf, cleanRecord } from './anatomy.js'

/*
	THE INSPECTION of a dead wild animal (a deer, a moose, a bear, a wolf or a rabbit): F at one lying there (within REACH, the eye on it), and a
	page of the journal on it. Tab, F or Esc shut it (journalUI.js). Only the wild ones: what their record says (anatomy.js recordOf, kept by
	deer.js, beasts.js, rabbits.js), the host's (a joiner asks for it: inspect, inspected).
		THE DRAWING	the animal standing, as it was when it was hit (a deer's head as it held it), drawn in charcoal (vf_inspect.js) in a box
					on the page: each shot's way in (a mark, and an arrow along the way it came), and its way out (a mark of red chalk) if it
					went through. Drag it to turn it about, the wheel to come nearer.
		THE X-RAY	(its button, or X) the body only its outline, and inside it the brain, the spine, the heart, the lungs, the liver and the
					guts: the ones hit in red chalk; the round's way through them, and where it stayed if it did not come out
		THE PAGE	what killed it and how long it took, each shot (its round, how far, the way it came in, what it went through, whether it
					came out: a button each, if more than one), and its pelt's quality and what the butcher pays for it (a rabbit
					shot has none: only a snared one's comes whole)
*/
const REACH = 2.8;			// metres from the eye, as a hatchet's (survivalTools.js)
const PELT = { deer: 'deerHide', moose: 'mooseHide', bear: 'bearHide', wolf: 'wolfPelt', rabbit: 'rabbitPelt' };
const MARK = { deer: 1, moose: 1.7, bear: 1.4, wolf: 0.75, rabbit: 0.3 };	// how big the marks are drawn, for how big it is
const SELL = 0.5;			// of a pelt's price, the butcher pays (shops.js)
const VIEW = [520, 380];	// page pixels

// WHICH ONE: the dead one the eye is on, within reach: { kind, id }, or null
function inView() {
	const p = hunting.hunterPlace();
	if (!hunting.hunterLife.alive || p.on != 'land' || p.swimming) return null;
	const eye = [settings.camPosX, settings.camPosY, settings.camPosZ], look = transformations.getCameraForward(), reach = REACH * settings.forestUnitsPerMetre;
	const d = deer.corpseInReach(eye, look, reach, true);
	if (d != null) return { kind: 'deer', id: d };
	const b = beasts.corpseInReach(eye, look, reach);
	if (b) return { kind: b.kind, id: b.id };
	const r = rabbits.corpseInReach(eye, look, reach);
	return r != null ? { kind: 'rabbit', id: r } : null;
}
const recordFor = (kind, id) => kind == 'deer' ? deer.deerRecord(id) : kind == 'rabbit' ? rabbits.rabbitRecord(id) : ANATOMY[kind] ? beasts.beastRecord(id) : null;
let asked = null;			// a joiner: the one it has asked the host for
function inspect(found) {
	if (survivalNet.authority()) { const record = recordFor(found.kind, found.id); if (record) show(record); else help.toast('Nothing to make of it'); return; }
	asked = found;
	survivalNet.send('inspect', found);
}
survivalNet.on('inspect', (msg, from) => { if (survivalNet.authority()) survivalNet.sendTo(from, 'inspected', { kind: String(msg.kind), id: Number(msg.id), record: recordFor(String(msg.kind), Number(msg.id)) }); });
survivalNet.on('inspected', (msg) => {
	if (!asked || asked.id !== msg.id || asked.kind !== msg.kind) return;
	asked = null;
	const record = cleanRecord(msg.record);
	if (record) show(record); else help.toast('Nothing to make of it');
});
hunting.onVehicleUse(() => { const found = inView(); if (!found) return false; inspect(found); return true; });
// (in the Survival mode survivalTools.js says so, with its cuts)
hunting.addPrompt(() => { if (settings.gameMode == 'Hunting') return null; const found = inView(); return found ? { name: 'Dead ' + KIND_NAMES[found.kind].toLowerCase(), keys: 'F: look it over' } : null; });

// THE PAGE (see the top)
const state = { record: null, pick: 0, xray: false, yaw: 0, pitch: 0.22, distance: 3, target: [0, 1, 0], radius: 1, dirty: true };
const shotsOf = (record) => [...new Set(record.wounds.map((w) => w.shot))];
const time = (s) => s <= 0 ? 'At once' : s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
const CAUSE = { ...ORGAN_NAMES, meat: 'Loss of blood', blast: 'A shell bursting', maul: 'Mauled' };
const row = (label, value) => `<div class="jr-row" style="padding: 4px 2px;"><span class="jr-need">${label}</span><span style="text-align: right;">${value}</span></div>`;
function show(record) {
	const shots = shotsOf(record);
	// (the shot that killed it first: the one through what killed it)
	const killing = shots.findIndex((s) => record.wounds.some((w) => w.shot == s && w.organs.includes(record.cause)));
	Object.assign(state, { record, pick: Math.max(killing, 0), xray: false, dirty: true });
	aimAt(record);
	journal.openMenu(menu, settings.gameMode == 'Hunting');
}
const menu = {
	render() {
		const R = state.record, shots = shotsOf(R), pick = shots[state.pick], W = R.wounds.filter((w) => w.shot == pick);
		const w = W[0], rounds = W.filter((one) => one.entry);
		const stars = R.quality.stars, worth = QUALITY[stars].worth, pelt = ITEMS[PELT[R.kind]];
		const organs = [...new Set(W.flatMap((one) => one.organs))];
		const throughName = organs.filter((n) => n != 'meat').map((n) => ORGAN_NAMES[n]).join(', ') || ORGAN_NAMES.meat;
		const other = w?.other == 'blast' ? 'A shell burst by it' : w?.other == 'maul' ? 'Wolves, or a fall' : null;
		const title = 'Dead ' + KIND_NAMES[R.kind].toLowerCase() + (R.kind == 'deer' ? (R.buck ? ', a buck' : ', a doe') : '');
		const button = (act, label, on = false) => `<button class="jr-btn" data-act="${act}" style="${on ? 'background: rgba(43,37,32,0.18); font-weight: bold;' : ''}">${label}</button>`;
		return `<div style="display: flex; gap: 24px; align-items: flex-start;">
			<div>
				<div class="jr-title">${title}</div>
				<div class="jr-box" data-slot="inspect-view" style="width: ${VIEW[0]}px; height: ${VIEW[1]}px; position: relative; cursor: grab;"></div>
				<div style="display: flex; gap: 8px; margin-top: 9px; flex-wrap: wrap; align-items: center;">
					${button('xray', 'X-ray', state.xray)}
					${shots.length > 1 ? shots.map((s, k) => button('shot:' + k, 'Shot ' + (k + 1), k == state.pick)).join('') : ''}
					<span class="jr-need" style="margin-left: auto;">${state.xray ? 'Red: what it went through' : 'Dark: in · red: out'}</span>
				</div>
			</div>
			<div style="width: 290px; font-size: 13px;">
				<div class="jr-title">How it died</div>
				${row('Killed by', CAUSE[R.cause] ?? R.cause)}
				${row('Time to die', time(R.seconds))}
				${row('Shots', shots.length)}
				<div class="jr-title" style="margin-top: 12px;">${shots.length > 1 ? 'Shot ' + (state.pick + 1) : 'The shot'}</div>
				${other ? row('What', other) : `
				${row('Round', (w.round ?? '') + (rounds.length > 1 ? ` (${rounds.length} pellets)` : ''))}
				${row('From', w.metres == null ? '?' : w.metres + ' m')}
				${row('Angle', angleOf(w.dir))}
				${row('Through', throughName)}
				${row('Came out', rounds.some((one) => one.exit) ? (rounds.length > 1 ? `${rounds.filter((one) => one.exit).length} of ${rounds.length}` : 'Yes') : 'No: it stayed in')}`}
				<div class="jr-title" style="margin-top: 12px;">The pelt</div>
				${R.kind == 'rabbit' ? `${row('Clean kill', R.quality.score + ' of 100')}${row('Pelt', 'None: only a snare keeps one whole')}` : `
				${row('Quality', `<span style="letter-spacing: 1px;">${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}</span> ${QUALITY[stars].name}`)}
				${row('Clean kill', R.quality.score + ' of 100')}
				${row('The butcher pays', dollars(Math.floor(Math.round(pelt.price * 100) * SELL * worth)) + (worth != 1 ? ` (${worth < 1 ? '' : '+'}${Math.round((worth - 1) * 100)}%)` : ''))}`}
			</div>
		</div>
		<div class="jr-need" style="margin-top: 10px;">Drag to turn it, the wheel to come nearer · X: x-ray · Tab, F or Esc: close</div>`;
	},
	act(value) {
		if (value == 'xray') state.xray = !state.xray;
		else if (value.startsWith('shot:')) state.pick = Number(value.slice(5)) || 0;
		state.dirty = true;
	},
	shown(page) {
		page.querySelector('[data-slot="inspect-view"]')?.appendChild(view.canvas);
		if (!view.running) { view.running = true; requestAnimationFrame(frame); }
	},
};
window.addEventListener('keydown', (e) => {
	if (journal.menuOpen() !== menu || e.code != 'KeyX' || e.repeat) return;
	state.xray = !state.xray; state.dirty = true;
	journal.refreshMenu();
});

// THE MODELS, as triangles of [x, y, z, id] (see vf_inspect.js for the ids)
function animal(out, record, headDown) {
	if (record.kind == 'deer') {
		const M = deer.DEER_MESH;
		for (let v = 0; v < M.length; v += 4) {
			const part = M[v + 3];
			if (part == 6 && !record.buck) continue;		// (a buck's antlers)
			const p = part == 1 || part == 6 ? bend([M[v], M[v + 1], M[v + 2]], headDown) : [M[v], M[v + 1], M[v + 2]];
			out.push(p[0], p[1], p[2], 1);
		}
		return;
	}
	const M = CREATURE_MESHES[record.kind].data;
	for (let v = 0; v < M.length; v += 4) out.push(M[v], M[v + 1], M[v + 2], 1);
}
// an egg (a ball stretched along x, y and z), a stick between two points, a cone from its foot to its tip
function egg(out, c, radii, id, rings = 8, around = 12) {
	const at = (i, k) => { const a = i / rings * Math.PI, b = k / around * Math.PI * 2; return [c[0] + Math.sin(a) * Math.cos(b) * radii[0], c[1] + Math.cos(a) * radii[1], c[2] + Math.sin(a) * Math.sin(b) * radii[2]]; };
	for (let i = 0; i < rings; i++) for (let k = 0; k < around; k++) {
		const A = at(i, k), B = at(i + 1, k), C = at(i + 1, k + 1), D = at(i, k + 1);
		out.push(...A, id, ...B, id, ...C, id, ...A, id, ...C, id, ...D, id);
	}
}
function across(d) {
	const other = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
	let u = [d[1] * other[2] - d[2] * other[1], d[2] * other[0] - d[0] * other[2], d[0] * other[1] - d[1] * other[0]];
	const l = Math.hypot(...u); u = u.map((v) => v / l);
	return [u, [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]]];
}
function stick(out, p, q, r0, r1, id, sides = 8) {
	const axis = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], l = Math.hypot(...axis);
	if (l < 1e-6) return;
	const [u, w] = across(axis.map((v) => v / l));
	const ring = (c, r) => Array.from({ length: sides }, (_, k) => { const a = k / sides * Math.PI * 2; return [0, 1, 2].map((i) => c[i] + (u[i] * Math.cos(a) + w[i] * Math.sin(a)) * r); });
	const A = ring(p, r0), B = ring(q, r1);
	for (let k = 0; k < sides; k++) { const n = (k + 1) % sides; out.push(...A[k], id, ...B[k], id, ...B[n], id, ...A[k], id, ...B[n], id, ...A[n], id); }
	if (r1 == 0) return;
	for (let k = 1; k < sides - 1; k++) out.push(...B[0], id, ...B[k], id, ...B[k + 1], id);
}
const ball = (out, c, r, id) => egg(out, c, [r, r, r], id, 6, 9);
const along = (p, d, t) => [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];

// what is drawn, into the solid layer and the ghost one (see vf_inspect.js), for the record, the shot picked, and the x-ray
function build() {
	const R = state.record, A = ANATOMY[R.kind], s = MARK[R.kind];
	const pick = shotsOf(R)[state.pick], picked = R.wounds.find((w) => w.shot == pick && w.entry);
	const headDown = (picked ?? R.wounds.find((w) => w.entry))?.headDown ?? 0;
	const solid = [], ghost = [];
	animal(state.xray ? ghost : solid, R, headDown);
	const hit = new Set(R.wounds.flatMap((w) => w.organs));
	if (state.xray) for (const o of A.organs) {
		const id = hit.has(o.name) ? 3 : 2, placed = (p) => o.bent ? bend(p, headDown) : p;
		if (o.name == 'spine') { const p = placed(o.from), q = placed(o.to); stick(solid, p, q, o.radius, o.radius, id); ball(solid, p, o.radius * 1.25, id); ball(solid, q, o.radius * 1.25, id); }
		else egg(solid, placed(o.at), o.radii, id);
	}
	for (const w of R.wounds) {
		if (!w.entry || !w.dir) continue;
		const mine = w.shot == pick, d = w.dir;
		// the way it came: an arrow up to where it went in
		stick(solid, along(w.entry, d, -0.6 * s), along(w.entry, d, -0.08 * s), 0.007 * s, 0.007 * s, mine ? 5 : 7, 6);
		stick(solid, along(w.entry, d, -0.1 * s), along(w.entry, d, -0.012 * s), 0.024 * s, 0, mine ? 5 : 7, 10);
		ball(solid, w.entry, 0.018 * s, mine ? 5 : 7);
		if (w.exit) ball(solid, w.exit, 0.028 * s, mine ? 6 : 7);
		if (state.xray && w.end) {
			stick(solid, w.entry, w.end, 0.006 * s, 0.006 * s, mine ? 4 : 7, 6);
			if (!w.exit) ball(solid, w.end, 0.014 * s, 8);
		}
	}
	return { solid: new Float32Array(solid), ghost: new Float32Array(ghost) };
}
// the camera's first place: where the shot came from (the side it went in), a little in front and above; all of it in view
function aimAt(record) {
	const M = record.kind == 'deer' ? deer.DEER_MESH : CREATURE_MESHES[record.kind].data;
	const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
	for (let v = 0; v < M.length; v += 4) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], M[v + i]); hi[i] = Math.max(hi[i], M[v + i]); }
	state.target = lo.map((v, i) => (v + hi[i]) / 2);
	state.radius = Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2;
	state.distance = state.radius / Math.sin(FOV / 2) * 0.78;
	const w = record.wounds.find((one) => one.dir);
	const d = w ? w.dir : [1, 0, 0];
	state.yaw = Math.atan2(-d[0], -d[2]) + (Math.abs(d[0]) > 0.3 ? -Math.sign(d[0]) * 0.3 : 0.3);
	state.pitch = 0.22;
}

// THE DRAWING (see vf_inspect.js)
const FOV = 0.62;
const LAYER = 'rgba16float';
const format = navigator.gpu.getPreferredCanvasFormat();
const view = { canvas: document.createElement('canvas'), running: false, size: [0, 0], solid: null, ghost: null, depth: null, pageGroup: null, buffers: { solid: null, ghost: null }, counts: { solid: 0, ghost: 0 } };
view.canvas.style.cssText = 'width: 100%; height: 100%; display: block; touch-action: none;';
const context = view.canvas.getContext('webgpu');
context.configure({ device, format, alphaMode: 'premultiplied' });
const module = device.createShaderModule({ label: 'vf_inspect', code: vf_inspect });
const modelUniforms = device.createBuffer({ label: 'inspection model Uniform', size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const pageUniforms = device.createBuffer({ label: 'inspection page Uniform', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const modelPipeline = device.createRenderPipeline({
	label: 'inspection model pipeline', layout: 'auto',
	vertex: { module, entryPoint: 'drawVertex', buffers: [{ arrayStride: 16, attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }, { format: 'float32', offset: 12, shaderLocation: 1 }] }] },
	fragment: { module, entryPoint: 'drawFragment', targets: [{ format: LAYER }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
});
const pagePipeline = device.createRenderPipeline({
	label: 'inspection page pipeline', layout: 'auto',
	vertex: { module, entryPoint: 'fullVertex' },
	fragment: { module, entryPoint: 'fullFragment', targets: [{ format }] },
	primitive: { topology: 'triangle-list' },
});
const modelGroup = device.createBindGroup({ layout: modelPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: modelUniforms } }] });

function resize() {
	const k = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(Math.round(view.canvas.clientWidth * k), 16), h = Math.max(Math.round(view.canvas.clientHeight * k), 16);
	if (w == view.size[0] && h == view.size[1]) return;
	view.size = [w, h];
	view.canvas.width = w; view.canvas.height = h;
	for (const t of [view.solid, view.ghost, view.depth]) t?.destroy();
	const layer = (label) => device.createTexture({ label, size: [w, h], format: LAYER, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
	view.solid = layer('inspection solid'); view.ghost = layer('inspection ghost');
	view.depth = device.createTexture({ label: 'inspection depth', size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
	view.pageGroup = device.createBindGroup({ layout: pagePipeline.getBindGroupLayout(0), entries: [
		{ binding: 0, resource: { buffer: pageUniforms } }, { binding: 1, resource: view.solid.createView() }, { binding: 2, resource: view.ghost.createView() }] });
}
function upload() {
	const built = build();
	for (const name of ['solid', 'ghost']) {
		const data = built[name];
		view.counts[name] = data.length / 4;
		if (!data.length) continue;
		if (!view.buffers[name] || view.buffers[name].size < data.byteLength) {
			view.buffers[name]?.destroy();
			view.buffers[name] = device.createBuffer({ label: 'inspection ' + name, size: Math.ceil(data.byteLength * 1.5 / 16) * 16, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
		}
		device.queue.writeBuffer(view.buffers[name], 0, data);
	}
}
function frame() {
	if (journal.menuOpen() !== menu || !view.canvas.isConnected) { view.running = false; return; }
	draw();
	requestAnimationFrame(frame);
}
function draw() {
	resize();
	if (state.dirty) { upload(); state.dirty = false; }
	const [w, h] = view.size, T = state.target;
	const eye = [T[0] + Math.sin(state.yaw) * Math.cos(state.pitch) * state.distance, T[1] + Math.sin(state.pitch) * state.distance, T[2] + Math.cos(state.yaw) * Math.cos(state.pitch) * state.distance];
	const viewProjection = mat4.multiply(mat4.perspective(FOV, w / h, 0.02, 60), mat4.lookAt(eye, T, [0, 1, 0]));
	// (the light from over the shoulder: up, and a little to the left of the eye)
	const f = [T[0] - eye[0], T[1] - eye[1], T[2] - eye[2]], fl = Math.hypot(...f), right = [-f[2] / fl, 0, f[0] / fl];
	const light = [-right[0] * 0.45 - f[0] / fl * 0.6, 0.7, -right[2] * 0.45 - f[2] / fl * 0.6], ll = Math.hypot(...light);
	device.queue.writeBuffer(modelUniforms, 0, new Float32Array([...viewProjection, ...eye, 1, ...light.map((v) => v / ll), 0]));
	device.queue.writeBuffer(pageUniforms, 0, new Float32Array([w, h, w / Math.max(view.canvas.clientWidth, 1), 0, state.xray ? 1 : 0, 0, 0, 0]));
	const encoder = device.createCommandEncoder({ label: 'inspection' });
	for (const name of ['solid', 'ghost']) {
		const pass = encoder.beginRenderPass({
			colorAttachments: [{ view: view[name].createView(), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }],
			depthStencilAttachment: { view: view.depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
		});
		if (view.counts[name]) { pass.setPipeline(modelPipeline); pass.setBindGroup(0, modelGroup); pass.setVertexBuffer(0, view.buffers[name]); pass.draw(view.counts[name]); }
		pass.end();
	}
	const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store' }] });
	pass.setPipeline(pagePipeline); pass.setBindGroup(0, view.pageGroup); pass.draw(3);
	pass.end();
	device.queue.submit([encoder.finish()]);
}
// turned about by dragging, nearer by the wheel
let drag = null;
view.canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; view.canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
view.canvas.addEventListener('pointermove', (e) => {
	if (!drag) return;
	state.yaw -= (e.clientX - drag[0]) * 0.01;
	state.pitch = Math.min(Math.max(state.pitch + (e.clientY - drag[1]) * 0.008, -0.35), 1.3);
	drag = [e.clientX, e.clientY];
});
view.canvas.addEventListener('pointerup', () => { drag = null; });
view.canvas.addEventListener('wheel', (e) => { e.preventDefault(); const far = state.radius / Math.sin(FOV / 2); state.distance = Math.min(Math.max(state.distance * Math.pow(1.1, Math.sign(e.deltaY)), far * 0.35), far * 1.6); }, { passive: false });

// for testing: the page open on a record, and what it draws
export const inspectForTest = { show, state, menu, view, build, inView, recordFor, draw };
