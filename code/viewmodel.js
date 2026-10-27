import {device} from './deviceSelection.js'
import { frameTexture, drawn } from './deviceSelection.js'
import {canvas} from './deviceSelection.js'
import {context} from './deviceSelection.js'
import {canvasFormat} from './deviceSelection.js'
import {onRenderResize} from './deviceSelection.js'
import * as profiler from './profiler.js'

import { mat4, vec3 } from 'https://wgpu-matrix.org/dist/3.x/wgpu-matrix.module.js';

import { settings } from './settings.js';

import { vf_viewmodel } from '../shaders/js/vf_viewmodel.js'

import * as transformations from './transformations.js'
import * as temporalAA from './temporalAA.js'
import { lightNow } from './lighting.js'
import * as ballistics from './ballistics.js'

/*
	What the guns in the hunter's hands have in common (shotgun.js, revolver.js, sharps.js; the Mosin-Nagant, rifle.js, is its own):
		meshBuilder		a gun's mesh made of boxes, tapered sections and tubes, each triangle with its part (what moves it) and its
						material (see vf_viewmodel.js). Its triangles are counted
		Viewmodel		draws a mesh over the finished frame, in the camera's space, with its own depth: the gun where it is held
						(gun) and each part where it is on the gun (parts). And a glow (the staff's gem, staff.js): its colour and
						how strong, lighting what is round the mesh's own origin
		holdMatrix		where a gun is held: at the hip, at the eye, or between, with its sway, recoil, cant and roll (as rifle.js)
		shoot			the shots out of its muzzle: aimed, along the line of sight tipped up to come back down on it at the zero; from
						the hip, at the middle of the view the zero off, give or take a spread
		ammoBox			the box in the bottom right its ammunition is shown in, and the little pictures of rounds, shells and cases
	A gun's own space is in metres, the bore along +z out of the muzzle, +y up, the origin at the front of the receiver (as the rifle's).
*/
const GRAVITY = 9.81;
export const MOST_PARTS = 32;

// A mesh being made
//-------------------------------------------------
export function meshBuilder() {
	const tris = [];
	const code = (part, material) => part + MOST_PARTS * material;
	const b = {
		tri(a, c, d, part, material) { tris.push([a, c, d, code(part, material)]); },
		quad(a, c, d, e, part, material) { b.tri(a, c, d, part, material); b.tri(a, d, e, part, material); },
		// a box between two rectangles across the gun: [x half width, y bottom, y top] at z0 and z1. caps: which ends are closed (0, 1). skip: sides
		//		left open (0 bottom, 1 right, 2 top, 3 left)
		section(z0, r0, z1, r1, material, part = 0, caps = [], skip = []) {
			const ring = (z, [h, lo, hi]) => [[-h, lo, z], [h, lo, z], [h, hi, z], [-h, hi, z]];
			const A = ring(z0, r0), B = ring(z1, r1);
			for (let k = 0; k < 4; k++) if (!skip.includes(k)) b.quad(A[k], A[(k + 1) % 4], B[(k + 1) % 4], B[k], part, material);
			if (caps.includes(0)) b.quad(A[0], A[1], A[2], A[3], part, material);
			if (caps.includes(1)) b.quad(B[0], B[1], B[2], B[3], part, material);
		},
		// a tube along z, round (x, y), any number of sides. caps: 0 the back, 1 the front
		tube(x, y, z0, r0, z1, r1, sides, material, part = 0, caps = [], turn = 0.5) {
			const ring = (z, r) => Array.from({ length: sides }, (_, k) => { const a = (k + turn) / sides * Math.PI * 2; return [x + Math.cos(a) * r, y + Math.sin(a) * r, z]; });
			const A = ring(z0, r0), B = ring(z1, r1);
			for (let k = 0; k < sides; k++) b.quad(A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k], part, material);
			if (caps.includes(0)) for (let k = 1; k < sides - 1; k++) b.tri(A[0], A[k], A[k + 1], part, material);
			if (caps.includes(1)) for (let k = 1; k < sides - 1; k++) b.tri(B[0], B[k + 1], B[k], part, material);
		},
		// a flat disc across the gun at z, round (x, y), any number of sides (a lens)
		disc(x, y, z, r, sides, material, part = 0) {
			const at = (k) => { const a = (k + 0.5) / sides * Math.PI * 2; return [x + Math.cos(a) * r, y + Math.sin(a) * r, z]; };
			for (let k = 1; k < sides - 1; k++) b.tri(at(0), at(k), at(k + 1), part, material);
		},
		// a tube between any two points, any number of sides
		strut(p, q, r0, r1, sides, material, part = 0) {
			const axis = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], l = Math.hypot(...axis), d = axis.map((v) => v / l);
			const other = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
			let u = [d[1] * other[2] - d[2] * other[1], d[2] * other[0] - d[0] * other[2], d[0] * other[1] - d[1] * other[0]];
			const ul = Math.hypot(...u); u = u.map((v) => v / ul);
			const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
			const ring = (c, r) => Array.from({ length: sides }, (_, k) => { const a = (k + 0.5) / sides * Math.PI * 2; return [0, 1, 2].map((i) => c[i] + (u[i] * Math.cos(a) + w[i] * Math.sin(a)) * r); });
			const A = ring(p, r0), B = ring(q, r1);
			for (let k = 0; k < sides; k++) b.quad(A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k], part, material);
		},
		// a loft through rings of corners (each ring the same number of corners, in order round it): its sides (skip: those left
		//		open, side k from corner k to the next), and the first ring (caps 0) and the last (1) closed
		loft(rings, material, part = 0, caps = [], skip = []) {
			const n = rings[0].length;
			for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < n; k++) if (!skip.includes(k)) b.quad(rings[i][k], rings[i][(k + 1) % n], rings[i + 1][(k + 1) % n], rings[i + 1][k], part, material);
			const last = rings[rings.length - 1];
			if (caps.includes(0)) for (let k = 1; k < n - 1; k++) b.tri(rings[0][0], rings[0][k], rings[0][k + 1], part, material);
			if (caps.includes(1)) for (let k = 1; k < n - 1; k++) b.tri(last[0], last[k + 1], last[k], part, material);
		},
		// a ring across the gun at z: a box [x half width, y bottom, y top] with its corners cut off by bevel (8 corners), or not (4)
		across(z, [h, lo, hi], bevel = 0) {
			if (!bevel) return [[-h, lo, z], [h, lo, z], [h, hi, z], [-h, hi, z]];
			const e = Math.min(bevel, h * 0.9, (hi - lo) * 0.45);
			return [[-h + e, lo, z], [h - e, lo, z], [h, lo + e, z], [h, hi - e, z], [h - e, hi, z], [-h + e, hi, z], [-h, hi - e, z], [-h, lo + e, z]];
		},
		// a ring of corners [[u, w], ...] about a middle c, in the directions u and w (unit vectors): for a loft that does not go along z
		ringAt(c, u, w, corners) {
			return corners.map(([a, d]) => [0, 1, 2].map((i) => c[i] + u[i] * a + w[i] * d));
		},
		// an outline of [x, y] corners (convex, in order) pushed back along z from z0 to z1, its ends closed (ends: which)
		prismZ(outline, z0, z1, material, part = 0, ends = [0, 1]) {
			b.loft([outline.map(([x, y]) => [x, y, z0]), outline.map(([x, y]) => [x, y, z1])], material, part, ends);
		},
		// an outline of [z, y] corners (convex, in order) across the gun from x0 to x1, its sides closed
		prismX(outline, x0, x1, material, part = 0, ends = [0, 1]) {
			b.loft([outline.map(([z, y]) => [x0, y, z]), outline.map(([z, y]) => [x1, y, z])], material, part, ends);
		},
		// a ball (a knob), sides round, at c: two rings and a point each end
		ball(c, r, sides, material, part = 0) {
			const ring = (y, s) => Array.from({ length: sides }, (_, k) => { const a = (k + 0.5) / sides * Math.PI * 2; return [c[0] + Math.cos(a) * r * s, c[1] + y * r, c[2] + Math.sin(a) * r * s]; });
			const A = ring(-0.5, 0.87), B = ring(0.5, 0.87), top = [c[0], c[1] + r, c[2]], bottom = [c[0], c[1] - r, c[2]];
			for (let k = 0; k < sides; k++) {
				const n = (k + 1) % sides;
				b.quad(A[k], A[n], B[n], B[k], part, material);
				b.tri(B[k], B[n], top, part, material);
				b.tri(A[n], A[k], bottom, part, material);
			}
		},
		count() { return tris.length; },
		done() {
			const data = [];
			for (const [a, c, d, k] of tris) for (const p of [a, c, d]) data.push(p[0], p[1], p[2], k);
			return new Float32Array(data);
		},
	};
	return b;
}

// a mesh being made (meshBuilder's), its parts numbered again by map(part): so one mesh's maker can put it into another (the Lewis gun
//		on the biplane's ring, plane.js)
export function remapParts(m, map) {
	const at = { tri: 3, quad: 4, section: 5, tube: 8, disc: 6, strut: 6, loft: 2, prismZ: 4, prismX: 4, ball: 4 };
	const mapped = { ...m };
	for (const [name, k] of Object.entries(at)) mapped[name] = (...args) => { args[k] = map(args[k] ?? 0); return m[name](...args); };
	return mapped;
}

// Where it is held (as gunMatrix in rifle.js): hip and aim are { x, y, z, yaw, pitch } in the camera's space. s: { aimed (0 to 1), bob,
//		kick (recoil, 0 to 1), roll, tilt, drop, kickBack (metres the recoil pushes it back), kickUp (radians it lifts the muzzle) }
// a ring at the top of the screen filling up as something is done (the biplane's reloading, plane.js; a howitzer loaded and the schooner
//		mended, shipGuns.js): show(share done, 0 to 1, seconds left, what it says big, what it says under that), hide()
export function progressRing() {
	const box = document.createElement('div');
	box.style.cssText = 'position: fixed; left: 50%; top: 5%; transform: translateX(-50%); z-index: 6; pointer-events: none; display: none; text-align: center; font-family: system-ui, sans-serif; color: #e8e8e8; text-shadow: 0 0 3px #000;';
	document.body.appendChild(box);
	let shown = '';
	return {
		show(k, left, title, detail) {
			box.style.display = '';
			const key = [Math.round(k * 200), left, title, detail].join('|');
			if (key == shown) return;
			shown = key;
			const r = 30, c = 2 * Math.PI * r;
			box.innerHTML = `<svg width="84" height="84" viewBox="-42 -42 84 84" style="display: block; margin: 0 auto;"><circle r="${r}" fill="rgba(0, 0, 0, 0.5)" stroke="rgba(255, 255, 255, 0.18)" stroke-width="7"/>`
				+ `<circle r="${r}" fill="none" stroke="#f2c46d" stroke-width="7" stroke-linecap="round" stroke-dasharray="${(c * Math.min(Math.max(k, 0), 1)).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90)"/>`
				+ `<text y="6" font-size="17" font-weight="700" fill="#fff" text-anchor="middle">${left}</text></svg>`
				+ `<div style="font-size: 13px; font-weight: 600; letter-spacing: 0.06em; margin-top: 4px;">${title}</div><div style="font-size: 11px; color: rgba(232, 232, 232, 0.75);">${detail}</div>`;
		},
		hide() { box.style.display = 'none'; },
	};
}
// the hands on horseback (hunting.js sets it each frame, from horse.riderLag; 0 off a horse): metres up and radians of pitch the gun goes,
//		in time with the horse's stride (instead of the walk's sway: as the sway, less with it at the eye)
export const ride = { y: 0, pitch: 0 };
export function holdMatrix(hip, aim, s) {
	const a = s.aimed;
	const mix = (p, q) => p + (q - p) * a;
	const sway = 1 - 0.7 * a;
	const x = mix(hip.x, aim.x) + Math.sin(s.bob) * 0.007 * sway;
	const y = mix(hip.y, aim.y) - Math.abs(Math.cos(s.bob)) * 0.006 * sway - (s.drop ?? 0) + ride.y * sway;
	const z = mix(hip.z, aim.z) + s.kick * (s.kickBack ?? 0.045);
	let m = mat4.translation([x, y, z]);
	m = mat4.rotateY(m, mix(hip.yaw, aim.yaw) + Math.sin(s.bob) * 0.008 * sway);
	m = mat4.rotateX(m, mix(hip.pitch, aim.pitch) + s.kick * (s.kickUp ?? 0.11) + (s.tilt ?? 0) + ride.pitch * sway);
	m = mat4.rotateZ(m, s.roll ?? 0);
	return mat4.scale(m, [1, 1, -1]);		// (the gun's +z, out of the muzzle, is the camera's -z)
}

// the camera's own directions in the world: right, up, and forward
export function cameraAxes() {
	const right = transformations.getCameraRight(), forward = transformations.getCameraForward();
	const up = [right[1] * forward[2] - right[2] * forward[1], right[2] * forward[0] - right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]];
	return { right, up, forward };
}
// a point in the camera's space (metres) out in the world (world units)
export function toWorld(p, axes) {
	const metre = settings.forestUnitsPerMetre;
	return [0, 1, 2].map((k) => [settings.camPosX, settings.camPosY, settings.camPosZ][k] + (axes.right[k] * p[0] + axes.up[k] * p[1] - axes.forward[k] * p[2]) * metre);
}

// The shots out of a gun's muzzle (see the top): muzzle, the muzzle in the gun's space; gun, where it is held; aimed, 0 to 1; sight,
//		how high its line of sight is over the bore (metres); zero, the range its sights are set for (metres); spread, radians either
//		way from the hip; round, which (ballistics.ROUNDS); pellets, how many (a shotgun's: each its own way, by choke, radians)
export function shoot({ muzzle, gun, aimed, sight, zero, spread, round, pellets = 1, choke = 0 }) {
	const axes = cameraAxes();
	const metre = settings.forestUnitsPerMetre;
	const from = toWorld(vec3.transformMat4(muzzle, gun), axes);
	const R = ballistics.ROUNDS[round];
	let centre;
	if (aimed > 0.85) {
		// along the line of sight, tipped up to come back down on to it at the zero
		const time = zero / (R.velocity * (1 - R.drag * zero / 2));
		const up = (sight + 0.5 * GRAVITY * time * time) / zero;
		centre = [0, 1, 2].map((k) => axes.forward[k] + axes.up[k] * up);
	} else {
		const at = [0, 1, 2].map((k) => [settings.camPosX, settings.camPosY, settings.camPosZ][k] + axes.forward[k] * zero * metre);
		const sx = (Math.random() * 2 - 1) * spread, sy = (Math.random() * 2 - 1) * spread;
		centre = [0, 1, 2].map((k) => (at[k] - from[k]) / (zero * metre) + axes.right[k] * sx + axes.up[k] * sy);
	}
	const directions = [];
	for (let k = 0; k < pellets; k++) {
		if (pellets == 1) { directions.push(centre); break; }
		// a pellet: off the middle by a little, round the bore (gaussian, the choke the spread of it)
		const r = choke * Math.sqrt(-2 * Math.log(Math.max(Math.random(), 1e-6))), a = Math.random() * Math.PI * 2;
		directions.push([0, 1, 2].map((i) => centre[i] + axes.right[i] * r * Math.cos(a) + axes.up[i] * r * Math.sin(a)));
	}
	ballistics.fireVolley(from, directions, { round });
	return { from, directions };
}

// Drawing one
//-------------------------------------------------
const UNIFORM_FLOATS = 16 + 16 + 4 + 4 + 4 + MOST_PARTS * 16;
const shaderModule = device.createShaderModule({ label: "vf_viewmodel", code: vf_viewmodel });
const pipeline = device.createRenderPipeline({
	label: "viewmodel pipeline",
	layout: 'auto',
	vertex: { module: shaderModule, entryPoint: "vertexMain", buffers: [{ arrayStride: 16, attributes: [{ format: "float32x4", offset: 0, shaderLocation: 0 }] }] },
	fragment: { module: shaderModule, entryPoint: "fragmentMain", targets: [{ format: canvasFormat }, { format: temporalAA.MOTION_FORMAT }] },
	primitive: { topology: 'triangle-list', cullMode: 'none' },
	depthStencil: { depthWriteEnabled: true, depthCompare: 'less', format: 'depth24plus' },
});
// its own depth, at the canvas's size (made again when that changes)
const makeDepth = () => device.createTexture({ label: "viewmodel depth", size: [drawn.width, drawn.height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
let depth = makeDepth();
onRenderResize(() => { depth.destroy(); depth = makeDepth(); });
export const HIDDEN = mat4.scaling([0, 0, 0]);
export const IDENTITY = mat4.identity();

export class Viewmodel {
	constructor(label, mesh) {
		this.label = label;
		this.vertices = mesh.length / 4;
		this.triangles = this.vertices / 3;
		this.mesh = device.createBuffer({ label: `${label} mesh`, size: mesh.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
		device.queue.writeBuffer(this.mesh, 0, mesh);
		this.uniforms = device.createBuffer({ label: `${label} Uniform`, size: UNIFORM_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		this.bindGroup = device.createBindGroup({ label: `${label} bind group`, layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.uniforms } }] });
	}
	// over the finished frame: the gun where it is held, each of its parts where it is on it (missing ones as they were made), and a
	//		glow ([r, g, b, how strong]: see Viewmodel at the top)
	draw(gun, parts, glow = [0, 0, 0, 0]) {
		const projection = transformations.jittered(mat4.perspective(transformations.baseVerticalViewAngle, drawn.width / drawn.height, 0.01, 10));
		const light = lightNow();
		const view = transformations.getViewMatrix();
		const L = [0, 1, 2].map((k) => view[k] * light.direction[0] + view[4 + k] * light.direction[1] + view[8 + k] * light.direction[2]);
		const u = new Float32Array(UNIFORM_FLOATS);
		u.set(projection, 0);
		u.set(gun, 16);
		u.set([L[0], L[1], L[2], light.direct * 1.3], 32);
		u.set([light.ambient, light.daylight, 0, 0], 36);
		u.set(glow, 40);
		for (let k = 0; k < MOST_PARTS; k++) u.set(parts[k] ?? IDENTITY, 44 + k * 16);
		device.queue.writeBuffer(this.uniforms, 0, u);
		const encoder = device.createCommandEncoder({ label: this.label });
		const pass = encoder.beginRenderPass({
			colorAttachments: [{ view: frameTexture().createView(), loadOp: "load", storeOp: "store" }, { view: temporalAA.motionView(), loadOp: "load", storeOp: "store" }],
			depthStencilAttachment: { view: depth.createView(), depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'discard' },
			timestampWrites: profiler.timestamps(this.label, 'vf_viewmodel'),
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, this.bindGroup);
		pass.setVertexBuffer(0, this.mesh);
		pass.draw(this.vertices, 1, 0, 0);
		pass.end();
		device.queue.submit([encoder.finish()]);
	}
}

// The ammunition box, in the bottom right (as the rifle's)
//-------------------------------------------------
export function ammoBox() {
	const box = document.createElement('div');
	box.style.cssText = 'position: fixed; right: 16px; bottom: 16px; z-index: 5; pointer-events: none; display: none; padding: 10px 14px 9px; border-radius: 6px; background: rgba(0, 0, 0, 0.55); color: #e8e8e8; font-family: system-ui, sans-serif; text-align: right; user-select: none;';
	document.body.appendChild(box);
	return box;
}
// a rifle round standing on its base: 'live', 'spent' (the case alone) or 'empty' (an outline)
export function roundIcon(kind, height = 30) {
	const empty = kind == 'empty';
	const fill = empty ? 'none' : '#c9a043', edge = empty ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.45)';
	const bullet = kind == 'live' ? '<path d="M2.4 9 L4 1.2 L5.6 9 Z" fill="#b5653a" stroke="rgba(0, 0, 0, 0.45)" stroke-width="0.6"/>' : '';
	return `<svg width="${height * 0.3}" height="${height}" viewBox="0 0 8 28" style="display: block; opacity: ${kind == 'spent' ? 0.55 : 1}">${bullet}`
		+ `<path d="M2.4 9 L5.6 9 L7 12.5 L7 25.5 L1 25.5 L1 12.5 Z" fill="${fill}" stroke="${edge}" stroke-width="0.7"/>`
		+ `<rect x="0.4" y="25.5" width="7.2" height="2" fill="${fill}" stroke="${edge}" stroke-width="0.6"/></svg>`;
}
// a shotgun shell standing on its brass: 'live', 'spent' (the hull, its crimp open) or 'empty'
export function shellIcon(kind) {
	const empty = kind == 'empty';
	const hull = empty ? 'none' : '#a3241c', edge = empty ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.45)';
	const top = kind == 'live' ? '<path d="M1.2 3 L4.5 1 L7.8 3 Z" fill="#7e1a14"/>' : '';
	return `<svg width="11" height="30" viewBox="0 0 9 28" style="display: block; opacity: ${kind == 'spent' ? 0.55 : 1}">${top}`
		+ `<rect x="1" y="3" width="7" height="18" fill="${hull}" stroke="${edge}" stroke-width="0.7"/>`
		+ `<rect x="0.6" y="21" width="7.8" height="6" fill="${empty ? 'none' : '#c9a043'}" stroke="${edge}" stroke-width="0.6"/></svg>`;
}
export const LABEL = 'font-size: 10px; letter-spacing: 0.08em; color: rgba(232, 232, 232, 0.6); margin-top: 3px; text-align: center;';
// the box's rows: the big number, the pictures, a word under them, the state of the action, what to do next, a message
export function ammoHtml({ count, groups, state, next, message, carried }) {
	return `<div style="display: flex; align-items: flex-end; justify-content: flex-end; gap: 12px;">`
		+ `<div style="text-align: center;"><div style="font-size: 30px; font-weight: 600; line-height: 1; font-variant-numeric: tabular-nums;">${count}</div><div style="${LABEL}">+${carried} CARRIED</div></div>`
		+ groups.map((g, i) => (i ? `<div style="width: 1px; align-self: stretch; background: rgba(255, 255, 255, 0.2);"></div>` : '') + `<div><div style="display: flex; gap: 3px; justify-content: center;">${g.icons}</div><div style="${LABEL}">${g.label}</div></div>`).join('')
		+ `</div>`
		+ `<div style="margin-top: 7px; font-size: 12px; letter-spacing: 0.1em; font-weight: 600;">${state}</div>`
		+ `<div style="margin-top: 2px; font-size: 12px; color: rgba(232, 232, 232, 0.75); min-height: 15px;">${next}</div>`
		+ (message ? `<div style="margin-top: 2px; font-size: 12px; color: #f2c46d;">${message}</div>` : '');
}

// small sums the guns share
export const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
export const ease = (v) => { v = clamp01(v); return v * v * (3 - 2 * v); };
export const toward = (v, to, step) => v < to ? Math.min(v + step, to) : Math.max(v - step, to);
// the wheel's pixels for a notch of it (lines or pages, as pixels)
export const wheelPixels = (event) => event.deltaY * (event.deltaMode == 1 ? 40 : event.deltaMode == 2 ? 800 : 1);
