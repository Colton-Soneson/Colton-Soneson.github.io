/*
	The controls, on the left side of the picture: what the keys do where the player is now (on foot, swimming, on a boat's deck, at
	its helm, on a horse: hunting.js and horse.js say), and under that what they do to the gun or the disc in its hands (each
	weapon says, setWeaponHelp). Made again only when what it says changes.

	And a word in the middle of the picture now and then (toast): why a boat could not be put where the player pointed, and so on.
*/
const panel = document.createElement('div');
panel.style.cssText = 'position: fixed; left: 16px; top: 50%; transform: translateY(-50%); z-index: 5; pointer-events: none; display: none; max-width: 250px; padding: 9px 12px; border-radius: 6px; background: rgba(0, 0, 0, 0.5); color: #e8e8e8; font: 12px/1.35 system-ui, sans-serif; user-select: none;';
document.body.appendChild(panel);
const toastBox = document.createElement('div');
toastBox.style.cssText = 'position: fixed; left: 50%; top: 30%; transform: translateX(-50%); z-index: 6; pointer-events: none; padding: 6px 14px; border-radius: 5px; background: rgba(0, 0, 0, 0.65); color: #f2c46d; font: 14px system-ui, sans-serif; opacity: 0; transition: opacity 0.25s;';
document.body.appendChild(toastBox);

let place = null, weapon = null, shown = '';
const html = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function section(title, lines) {
	return `<div style="font-size: 10px; letter-spacing: 0.08em; color: rgba(232, 232, 232, 0.6); text-transform: uppercase; margin-bottom: 3px;">${html(title)}</div>`
		+ lines.map(([keys, what]) => `<div style="display: flex; gap: 8px; margin-top: 2px;">${keys ? `<span style="flex: none; min-width: 64px; font-weight: 600; color: #fff;">${html(keys)}</span>` : ''}<span style="color: rgba(232, 232, 232, 0.8);">${html(what)}</span></div>`).join('');
}
function redraw() {
	const parts = [];
	if (place) parts.push(section(place.title, place.lines));
	if (weapon && (!place || place.withWeapon)) parts.push(section(weapon.title, weapon.lines));
	const text = parts.join('<div style="height: 1px; margin: 7px 0; background: rgba(255, 255, 255, 0.15);"></div>');
	if (text == shown) return;
	shown = text;
	panel.innerHTML = text;
	panel.style.display = text ? '' : 'none';
}

// where the player is: a title and [keys, what they do] lines, or null for nothing. withWeapon: whether the gun's go under it
//		(not at a helm, where the hands are on the tiller)
export function showHelp(title, lines = [], withWeapon = true) {
	place = title === null ? null : { title, lines, withWeapon };
	redraw();
}
// the gun or the disc in the hands: a title and lines, or null for none
export function setWeaponHelp(title, lines = []) {
	weapon = title === null ? null : { title, lines };
	redraw();
}

let toastTimer = 0;
export function toast(text, seconds = 2.2) {
	toastBox.textContent = text;
	toastBox.style.opacity = '1';
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => { toastBox.style.opacity = '0'; }, seconds * 1000);
}

// for testing: what it says now
export function helpText() {
	return panel.innerText;
}
