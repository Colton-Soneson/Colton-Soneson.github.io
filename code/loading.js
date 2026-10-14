/*
	The loading screen (index.html): it is up from the moment the page is, before any of the scripts have downloaded, so nobody
	looks at a black page wondering if anything is happening. As the page gets further, it says what it is doing and moves its
	bar on, and once the first frames are drawn (frameDrawn, from rotatingCube.js) it fades away.

	Most of the loading is long stretches of work that never let the browser draw (generating the land is a few seconds of it),
	so the bar does not creep, it steps: at each stage, the stage is shown and the page waits for it to be drawn before it carries on
	(showStage). The ring spins all through, even while the page is busy.

	On a page without the loading screen in it (the test pages) all of this does nothing.
*/

const screen = () => document.getElementById('loading');

// If something went wrong in a way that never reached the screen (an old copy of a file left in the browser's cache, say),
//		the frames can be running behind a loading screen that never hears they are. So it also goes by itself once nothing has
//		moved it on for this long. (A failure that did reach it, see index.html, stays up)
const GIVE_UP_MILLISECONDS = 20000;
let giveUp = 0;

// says what is being done now, and moves the bar to share (0 to 1) of the way
export function setLoadingStage(text, share) {
	const element = screen();
	if (!element) return;
	element.querySelector('.loading-stage').textContent = text;
	element.querySelector('.loading-bar > div').style.width = Math.round(share * 100) + '%';
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

// the first frames are drawn: the loading screen fades out and goes
export function finishLoading() {
	const element = screen();
	clearTimeout(giveUp);
	if (!element || element.classList.contains('loading-done')) return;
	setLoadingStage('Ready', 1);
	element.classList.add('loading-done');
	setTimeout(() => element.remove(), 700);
}
