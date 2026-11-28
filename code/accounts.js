import * as inventory from './inventory.js'
import * as atmosphere from './atmosphere.js'
import * as survivalNet from './survivalNet.js'
import * as saveGame from './saveGame.js'
import * as core from './accountCore.js'

/*
	THE SAVES PAGE of the journal (inventoryUI.js: its Saves tab, top right): the player's account's SLOTS (accountCore.js: kept on the
	site, logged in from the main menu, menu.js), each to save the game into (over what is there: its name asked for), to load (the page
	loaded again with it, as a save file is: saveGame.js), or to clear; and on this computer, the game saved to a file (downloaded) or
	loaded from one, and back out to the main menu. Written as the rest of the journal is (charcoal on paper: journalUI.js's styles).
	What it is doing is written under it (said).
*/
let said = { text: '', bad: false }, busy = false, asked = false;
const changed = [];
// told when the page should be written again: fn() (inventoryUI.js)
export function onChange(fn) { changed.push(fn); }
const tell = () => { for (const fn of changed) fn(); };
core.onAccount(tell);

async function run(work) {
	busy = true; said = { text: '…', bad: false }; tell();
	try { said = { text: (await work()) ?? '', bad: false }; }
	catch (e) { said = { text: e.message || String(e), bad: true }; }
	busy = false; tell();
}
async function saveTo(slot) {
	if (!inventory.survivalOn()) throw new Error('Saving is for the Survival mode');
	const day = Math.floor(atmosphere.sunCycles) + 1, was = core.account.slots?.[slot - 1];
	const name = prompt(`A name for slot ${slot}`, was?.name || `Day ${day}`);
	if (name === null) return '';
	inventory.save();
	return core.saveSlot(slot, name.trim(), day, await saveGame.encode(saveGame.collect()));
}
async function loadFrom(slot) {
	if (survivalNet.role() == 'joined') throw new Error('Leave the game first: loading is for one alone, or a host');
	await saveGame.loadGame(await core.slotBytes(slot));
	return 'Loading…';
}

// THE PAGE: { left, right } (html: the journal's own escaping)
const when = (t) => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
export function journalHtml(html) {
	const A = core.account, dis = busy ? 'disabled' : '', survival = inventory.survivalOn();
	// (the slots asked for once a page is shown: the account's as the site has them now)
	if (A.session && !asked) { asked = true; run(() => core.loadSlots().then(() => '')); }
	let left;
	if (!A.session) {
		left = `<div style="max-width:380px; line-height:1.6;">Not logged in. Log in from the main menu (top right) to keep three saves on the site, and load them from anywhere.<br><br>You can still save to a file on this computer (right).</div>`;
	} else {
		const rows = (A.slots ?? Array(core.SLOTS).fill(undefined)).map((s, k) => {
			const n = k + 1;
			const shown = s === undefined ? '<span class="jr-need">…</span>' : s ? `<b>${html(s.name || 'Day ' + s.day)}</b><div class="jr-need">Day ${s.day} · ${html(when(s.updated_at))}</div>` : '<span class="jr-need">Empty</span>';
			return `<div class="jr-row"><div style="min-width:180px;"><div class="jr-need">Slot ${n}</div>${shown}</div><div style="white-space:nowrap;">
				<button class="jr-btn" data-acct="save:${n}" ${survival ? dis : 'disabled'}>${s ? 'Save over' : 'Save here'}</button>
				${s ? `<button class="jr-btn" data-acct="load:${n}" ${dis}>Load</button> <button class="jr-btn" data-acct="clear:${n}" ${dis}>Clear</button>` : ''}</div></div>`;
		}).join('');
		left = `<div class="jr-need" style="margin-bottom:6px;">Logged in as <b>${html(A.profile?.username ?? A.session.user.email)}</b></div>${rows}`;
	}
	const right = `<div style="margin:6px 0;"><button class="jr-btn" data-acct="download" ${survival ? '' : 'disabled'}>Save to a file</button></div>
		<div style="margin:6px 0;"><button class="jr-btn" data-acct="upload">Load from a file</button></div>
		<div style="margin:18px 0 6px;"><button class="jr-btn" data-acct="menu">Quit to the main menu</button></div>
		${said.text ? `<div style="margin-top:10px; max-width:280px; ${said.bad ? 'color:#7a2a18; font-weight:bold;' : ''}">${html(said.text)}</div>` : ''}`;
	return { left, right };
}
// a click on it (data-acct's value)
export function act(value) {
	const [what, n] = value.split(':'), slot = Number(n);
	if (busy) return;
	if (what == 'save') { if (!core.account.slots?.[slot - 1] || confirm(`Save over slot ${slot}?`)) run(() => saveTo(slot)); }
	else if (what == 'load') { if (confirm(`Load slot ${slot}? What is not saved of this game is lost`)) run(() => loadFrom(slot)); }
	else if (what == 'clear') { if (confirm(`Clear slot ${slot}?`)) run(() => core.clearSlot(slot)); }
	else if (what == 'download') run(async () => { await saveGame.saveGame(); return 'Saved to a file (in your downloads)'; });
	else if (what == 'upload') saveGame.chooseFile();
	else if (what == 'menu') { if (confirm('Back to the main menu? What is not saved of this game is lost')) location.reload(); }
}
// (the page shown again: its slots asked for again)
export function shown() { asked = false; }
