import {onRenderResize} from './deviceSelection.js'

import * as hunting from './hunting.js'
import * as transformations from './transformations.js'
import * as ballistics from './ballistics.js'

/*
	THE SCOPES (sharps.js's, rifle.js's): looking through one, the view magnified (and the mouse slowed as much), black round the eyepiece's
	circle, and THE RETICLE over it: in the first focal plane (it grows and shrinks with the magnification, so its marks are always the
	same angle on the target), a "Christmas tree". Each rifle's its own (makeScope): its round, the range it is zeroed at, the height of
	its line of sight over the bore, its field of view (field degrees across the eyepiece, over its magnification).
	THE RETICLE: thick posts from the edge in to POSTS milliradians off the middle, a fine cross between them with a mark every milliradian
	(a tenth of a metre at a hundred), and under the middle the tree: a row every milliradian down (ROWS of them), each with dots a
	milliradian apart for the wind, wider the further down, and the range that row is for (holdovers: the round's flight worked out as
	ballistics.js flies it, aimed as vm.shoot aims). The magnification and the zero are written under the eyepiece.
	Only the scope in use touches the view: one not looked through leaves it as it is (but for the frame it was let go of).
*/
const POSTS = 6;
const ROWS = 12;
const EYEPIECE = 0.92;				// of the picture's height (or width, if narrower) the eyepiece's circle is across

export function makeScope({ round, zero, height, field = 20 }) {
	// how far the bullet drops below the line of sight, in milliradians, at each range
	const R = ballistics.ROUNDS[round];
	const time = zero / (R.velocity * (1 - R.drag * zero / 2));
	const up = (height + 0.5 * 9.81 * time * time) / zero;
	let x = 0, y = -height, vx = R.velocity / Math.hypot(1, up), vy = vx * up;
	const hold = [];
	const dt = 1 / 2000;
	for (let t = 0; t < 4 && x < 1000; t += dt) {
		const speed = Math.hypot(vx, vy), slow = Math.max(1 - R.drag * speed * dt, 0);
		vx *= slow; vy = vy * slow - 9.81 * dt;
		x += vx * dt; y += vy * dt;
		hold.push([x, -y / x * 1000]);
	}
	// the range (metres) a row this many milliradians down is for, or null past the end of the flight worked out
	const rangeFor = (mils) => { for (let k = 1; k < hold.length; k++) if (hold[k][0] > zero && hold[k][1] >= mils) return hold[k][0]; return null; };

	const canvas = document.createElement('canvas');
	canvas.style.cssText = 'position: fixed; inset: 0; width: 100%; height: 100%; z-index: 4; pointer-events: none; display: none;';
	document.body.appendChild(canvas);
	let drawnFor = '', magnification = 1, using = false;
	onRenderResize(() => { drawnFor = ''; });

	function drawReticle() {
		const W = canvas.clientWidth || innerWidth, H = canvas.clientHeight || innerHeight;
		const dpr = Math.min(devicePixelRatio || 1, 2);
		canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
		const c = canvas.getContext('2d');
		c.setTransform(dpr, 0, 0, dpr, 0, 0);
		const cx = W / 2, cy = H / 2, radius = Math.min(W, H) * EYEPIECE / 2;
		// black round the eyepiece, a soft dark edge inside it
		c.fillStyle = '#000';
		c.beginPath(); c.rect(0, 0, W, H); c.arc(cx, cy, radius, 0, Math.PI * 2, true); c.fill();
		const edge = c.createRadialGradient(cx, cy, radius * 0.86, cx, cy, radius);
		edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(0,0,0,0.85)');
		c.fillStyle = edge;
		c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2); c.fill();
		// a milliradian in pixels, as the view is magnified now (first focal plane: magnified with it)
		const mil = H / 2 / Math.tan(transformations.verticalViewAngle / 2) * 0.001;
		c.save();
		c.beginPath(); c.arc(cx, cy, radius, 0, Math.PI * 2); c.clip();
		c.strokeStyle = '#000'; c.fillStyle = '#000';
		c.lineWidth = Math.max(mil * 0.3, 3);
		for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1]]) { c.beginPath(); c.moveTo(cx + dx * POSTS * mil, cy + dy * POSTS * mil); c.lineTo(cx + dx * radius, cy + dy * radius); c.stroke(); }
		c.lineWidth = Math.max(mil * 0.04, 1);
		c.beginPath(); c.moveTo(cx - POSTS * mil, cy); c.lineTo(cx + POSTS * mil, cy); c.moveTo(cx, cy - POSTS * mil); c.lineTo(cx, cy + (ROWS + 0.5) * mil); c.stroke();
		for (let k = 1; k <= 5; k++) {
			const long = k == 5 ? 0.5 : 0.25;
			c.beginPath();
			for (const s of [-1, 1]) { c.moveTo(cx + s * k * mil, cy - long * mil); c.lineTo(cx + s * k * mil, cy + long * mil); }
			c.moveTo(cx - long * mil, cy - k * mil); c.lineTo(cx + long * mil, cy - k * mil);
			c.stroke();
		}
		// the tree
		const font = Math.max(Math.min(mil * 0.42, 15), 9);
		c.font = `${font}px system-ui, sans-serif`;
		c.textBaseline = 'middle';
		for (let row = 1; row <= ROWS; row++) {
			const ry = cy + row * mil;
			c.beginPath(); c.moveTo(cx - 0.3 * mil, ry); c.lineTo(cx + 0.3 * mil, ry); c.stroke();
			const wide = Math.min(1 + Math.floor(row / 2), 6);
			for (let k = 1; k <= wide; k++) for (const s of [-1, 1]) { c.beginPath(); c.arc(cx + s * k * mil, ry, Math.max(mil * 0.07, 1.3), 0, Math.PI * 2); c.fill(); }
			if (mil >= 7 && (row % 2 == 0 || mil > 22)) {
				const range = rangeFor(row);
				c.textAlign = 'right';
				c.fillText(String(row), cx - (wide + 0.6) * mil, ry);
				if (range) { c.textAlign = 'left'; c.fillText(Math.round(range / 10) * 10 + ' m', cx + (wide + 0.6) * mil, ry); }
			}
		}
		c.restore();
		c.fillStyle = 'rgba(232, 232, 232, 0.8)';
		c.font = '13px system-ui, sans-serif';
		c.textAlign = 'center';
		c.fillText(`${magnification.toFixed(1)}×   ·   zeroed at ${zero} m`, cx, Math.min(cy + radius + 18, H - 12));
	}
	// how much the view is narrowed at a magnification: the scope's field across the eyepiece, the picture as wide as that makes it
	function viewZoom(power) {
		const W = innerWidth, H = innerHeight;
		const across = Math.min(W, H) * EYEPIECE, fieldNow = field / power * Math.PI / 180;
		const vertical = 2 * Math.atan(Math.tan(fieldNow / 2) * H / across);
		return Math.tan(transformations.baseVerticalViewAngle / 2) / Math.tan(vertical / 2);
	}
	return {
		ranges: Array.from({ length: ROWS }, (_, k) => [k + 1, rangeFor(k + 1)]),
		// once a frame: looked through (or not) at a magnification
		show(scoped, power) {
			if (!scoped && !using) return;
			using = scoped;
			magnification = power;
			const zoom = scoped ? viewZoom(power) : 1;
			transformations.setZoom(zoom);
			hunting.input.lookScale = 1 / zoom;
			canvas.style.display = scoped ? '' : 'none';
			if (!scoped) return;
			const key = [power, innerWidth, innerHeight, transformations.verticalViewAngle].join();
			if (key != drawnFor) { drawnFor = key; drawReticle(); }
		},
	};
}
