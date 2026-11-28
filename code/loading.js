/*
	The loading screen (index.html): charcoal on paper, as the journal and the map are. Up from the moment the page is, before any of the
	scripts have downloaded, it gives way to the main menu (menu.js: hideLoading), and comes back once something has been chosen
	(showLoading). As the page gets further, it says what it is doing and moves its bar on (drawn in charcoal), and once the first frames
	are drawn (frameDrawn, from rotatingCube.js) it is done.

	Most of the loading is long stretches of work that never let the browser draw (generating the land is a few seconds of it),
	so the bar does not creep, it steps: at each stage, the stage is shown and the page waits for it to be drawn before it carries on
	(showStage). A hand with its stick of charcoal sketches all through, even while the page is busy (it moves by transform alone).

	THE MAP BEING DRAWN: once the land is made, the map (survivalMap.js: mapReady, its paper and its drawing, as the map in the game shows
	it) is laid on the screen, and drawn on to its paper a stroke at a time (BLOBS: patches of it, the middle first, wobbling outwards),
	as far as the loading has got (from the land made, LAND, to done). Done, the rest of it is drawn in (FINISH seconds), a ring is drawn
	round where the player comes in, the view comes down on to it (ZOOM seconds: the map's own scale times NEAR), and the screen fades
	(FADE), and what wanted to know (onLoaded: survivalMap.js, the map put away in the hands) is told.

	On a page without the loading screen in it (the test pages) all of this does nothing.
*/

const screen = () => document.getElementById('loading');

// If something went wrong in a way that never reached the screen (an old copy of a file left in the browser's cache, say),
//		the frames can be running behind a loading screen that never hears they are. So it also goes by itself once nothing has
//		moved it on for this long. (A failure that did reach it, see index.html, stays up)
const GIVE_UP_MILLISECONDS = 20000;
const LAND = 0.35;					// the share of the loading done once the land is made
const BLOBS = 260;
const FINISH = 0.9, ZOOM = 1.8, FADE = 0.6;	// seconds
const NEAR = 3.2;
let giveUp = 0;

export function hideLoading() { screen()?.classList.add('loading-hidden'); }
export function showLoading(text = 'Getting ready') {
	const element = screen();
	if (!element) return;
	element.classList.remove('loading-hidden');
	setLoadingStage(text, 0.05);
}

// says what is being done now, and moves the bar to share (0 to 1) of the way (and the map that far drawn)
let shareNow = 0;
export function setLoadingStage(text, share) {
	const element = screen();
	if (!element) return;
	shareNow = share;
	element.querySelector('.loading-stage').textContent = text;
	element.querySelector('.loading-bar > div').style.width = Math.round(share * 100) + '%';
	map.target = Math.max(map.target, Math.min(Math.max((share - LAND) / (1 - LAND), 0), 1) * 0.92);
	clearTimeout(giveUp);
	giveUp = setTimeout(() => {
		if (!element.classList.contains('loading-failed')) finishLoading();
	}, GIVE_UP_MILLISECONDS);
}

// Called at the end of every frame (rotatingCube.js). The forest is planted on the second frame, which takes a moment, so the
//		screen says so after the first, and goes after the third
let framesDrawn = 0;
export function frameDrawn() {
	framesDrawn++;
	if (framesDrawn == 1) {
		setLoadingStage('Planting the forest', 0.85);
	} else if (framesDrawn == 3) {
		finishLoading();
	}
}

// the same, and then waits until it is on the screen: for before a long stretch of work that would keep it from being drawn
export async function showStage(text, share) {
	if (!screen()) return;
	setLoadingStage(text, share);
	// a frame drawn, or a tenth of a second if frames are not being drawn (the tab is hidden)
	await Promise.race([
		new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))),
		new Promise((resolve) => setTimeout(resolve, 100)),
	]);
}

// THE MAP BEING DRAWN (see the top)
const map = { canvas: null, paper: null, sheet: null, at: null, blobs: [], shown: 0, target: 0, last: 0, ring: null };
// the map's (survivalMap.js): give() gives { paper, sheet (canvases, the same size), at() (where the player comes in, on them: [x, y], or null) }
export function mapReady(give) {
	const element = screen();
	if (!element || element.classList.contains('loading-hidden') || element.classList.contains('loading-done')) return;
	let made;
	try { made = give(); } catch (e) { console.warn('loading: the map', e); return; }
	if (!made?.sheet) return;
	Object.assign(map, made);
	const N = made.sheet.width;
	map.canvas = document.createElement('canvas');
	map.canvas.width = map.canvas.height = N;
	map.canvas.className = 'loading-map';
	element.querySelector('.loading-sheet').appendChild(map.canvas);
	element.classList.add('loading-has-map');
	// (the strokes: the middle first, out to the edges, each its own size, a little out of order)
	let seed = 11;
	const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
	map.blobs = Array.from({ length: BLOBS }, () => {
		const a = random() * Math.PI * 2, d = Math.sqrt(random()) * 0.72 * N;
		return { x: N / 2 + Math.cos(a) * d, y: N / 2 + Math.sin(a) * d, r: N * (0.07 + random() * 0.06), order: d + random() * N * 0.18, tilt: random() * Math.PI };
	}).sort((p, q) => p.order - q.order);
	map.target = Math.max(map.target, Math.min(Math.max((shareNow - LAND) / (1 - LAND), 0), 1) * 0.92);
	map.last = performance.now();
	requestAnimationFrame(drawMap);
}
function drawMap(now) {
	if (!map.canvas) return;
	const dt = Math.min((now - map.last) / 1000, 0.1);
	map.last = now;
	map.shown += (map.target - map.shown) * Math.min(dt * 3, 1);
	if (map.target - map.shown < 0.002) map.shown = map.target;
	const ctx = map.canvas.getContext('2d'), N = map.canvas.width;
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.drawImage(map.paper, 0, 0);
	const n = Math.floor(map.shown * map.blobs.length);
	if (n > 0) {
		ctx.save();
		ctx.beginPath();
		for (let k = 0; k < n; k++) { const b = map.blobs[k]; ctx.moveTo(b.x + b.r, b.y); ctx.ellipse(b.x, b.y, b.r, b.r * 0.72, b.tilt, 0, Math.PI * 2); }
		ctx.clip();
		ctx.drawImage(map.sheet, 0, 0);
		ctx.restore();
	}
	if (map.shown >= 1) ctx.drawImage(map.sheet, 0, 0);
	// (the ring round where the player comes in, gone over twice)
	if (map.ring && map.at) {
		const [x, y] = map.at, r = N * 0.035, k = Math.min(map.ring, 1);
		ctx.strokeStyle = '#2b2520'; ctx.lineCap = 'round';
		for (const [w, off, rr] of [[N * 0.004, 0, r], [N * 0.0025, 0.4, r * 1.12]]) {
			ctx.lineWidth = w;
			ctx.beginPath();
			ctx.arc(x, y, rr, off - Math.PI / 2, off - Math.PI / 2 + k * Math.PI * 2.05);
			ctx.stroke();
		}
	}
	requestAnimationFrame(drawMap);
}

// told once the loading is all done and the screen is gone: fn()
const loadedListeners = [];
export function onLoaded(fn) { loadedListeners.push(fn); }
const loaded = () => { for (const fn of loadedListeners) { try { fn(); } catch (e) { console.warn('loading:', e); } } };

// the first frames are drawn: the rest of the map drawn in, the view down on to where the player comes in, and the screen faded out
export async function finishLoading() {
	const element = screen();
	clearTimeout(giveUp);
	if (!element || element.classList.contains('loading-done') || element.classList.contains('loading-finishing')) return;
	element.classList.add('loading-finishing');
	setLoadingStage('Ready', 1);
	if (map.canvas) {
		map.target = 1;
		await new Promise((r) => setTimeout(r, FINISH * 1000));
		map.shown = 1;
		map.at = map.at?.() ?? null;
		if (map.at) {
			// (the ring drawn round it, then the view down on to it)
			for (let t = 0; t <= 1; t += 0.05) { map.ring = t; await new Promise((r) => setTimeout(r, 18)); }
			map.ring = 1;
			const rect = map.canvas.getBoundingClientRect(), N = map.canvas.width;
			const px = map.at[0] / N, py = map.at[1] / N;
			const dx = innerWidth / 2 - (rect.left + px * rect.width), dy = innerHeight / 2 - (rect.top + py * rect.height);
			map.canvas.style.transformOrigin = `${(px * 100).toFixed(2)}% ${(py * 100).toFixed(2)}%`;
			map.canvas.style.transition = `transform ${ZOOM}s cubic-bezier(0.55, 0, 0.3, 1)`;
			map.canvas.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${NEAR})`;
			element.classList.add('loading-zooming');
			await new Promise((r) => setTimeout(r, ZOOM * 1000));
		}
	}
	element.classList.add('loading-done');
	loaded();
	setTimeout(() => { map.canvas = null; element.remove(); }, FADE * 1000 + 100);
}
