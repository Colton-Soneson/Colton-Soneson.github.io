/*
	CHARCOAL ON PAPER: the look of the journal (journalUI.js), the main menu (menu.js) and the loading screen (loading.js). The inks, the
	hand it is written in, the paper (PAPER: a picture of it, made here), and the charcoal's wobble (CHARCOAL_FILTER: an SVG filter, put in
	the page once: url(#charcoal)). Nothing of the game is imported here: the menu has it before anything else is loaded.
*/
export const INK = '#2b2520', SOFT = 'rgba(43, 37, 32, 0.55)', FAINT = 'rgba(43, 37, 32, 0.25)', RED = '#7a2a18';
export const HAND = '"Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';

// THE PAPER
function makePaper() {
	const c = document.createElement('canvas');
	c.width = c.height = 512;
	const ctx = c.getContext('2d');
	let seed = 7;
	const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
	ctx.fillStyle = '#e6dcc4';
	ctx.fillRect(0, 0, 512, 512);
	for (let k = 0; k < 2600; k++) { ctx.fillStyle = `rgba(${90 + random() * 60}, ${70 + random() * 40}, 40, ${random() * 0.06})`; ctx.fillRect(random() * 512, random() * 512, 2 + random() * 6, 1 + random() * 3); }
	for (let k = 0; k < 16; k++) {
		const x = random() * 512, y = random() * 512, r = 30 + random() * 70, g = ctx.createRadialGradient(x, y, 0, x, y, r);
		g.addColorStop(0, 'rgba(40, 32, 26, 0.05)'); g.addColorStop(1, 'rgba(40, 32, 26, 0)');
		ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
	}
	return c.toDataURL('image/png');
}
export const PAPER = makePaper();

// THE CHARCOAL'S WOBBLE, once in the page
if (!document.getElementById('charcoal')) {
	const defs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	defs.setAttribute('style', 'position: absolute; width: 0; height: 0;');
	defs.innerHTML = '<filter id="charcoal" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.05 0.08" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G"/></filter>';
	document.body.appendChild(defs);
}
