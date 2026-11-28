import { INK, SOFT, FAINT, RED, HAND, PAPER } from './charcoal.js'
import { hideLoading, showLoading } from './loading.js'
import * as core from './accountCore.js'

/*
	THE MAIN MENU: the first thing on the page, before any of the game is loaded (main.js loads it once something is chosen here). Charcoal
	on paper, as the journal (charcoal.js). In the middle:
		New Survival		a new game of the Survival mode (gameMode 'Hunting'): what this browser kept of the last one (the inventory,
							the body, the bank, the towns: every key of it, SURVIVAL_KEYS) cleared first. The saves on the account stay
		New Observation		the camera flying over the world (gameMode 'Observe')
		War Mode			the War game mode ('War': war.js)
		Horde Mode			the Horde ('Horde': horde.js)
		Load Save			the account's save slots (accountCore.js), on the right: one clicked is loaded. Struck out until logged in with
							one; and a save file from this computer, under it
		Join Game			a room code (and a name to go by), on the right: the Survival mode, joined to the game with that code (net.js)
	THE ACCOUNT, top right: log in, sign up, a new password, log out. Logging in looks for the account's saves.
	What is chosen is given back to main.js ({ mode, join }) and the loading screen comes back (loading.js). A save already waiting (the game
	loaded one: the page loaded again with it, saveGame.js) goes straight on, with no menu.
*/
const SURVIVAL_KEYS = (key) => /^(survival|town)/.test(key) && key != 'survivalSaveLoading';
const MODES = { survival: 'Hunting', observe: 'Observe', war: 'War', horde: 'Horde' };

const style = document.createElement('style');
style.textContent = `
#menu { position: fixed; inset: 0; z-index: 30; background: url(${PAPER}); color: ${INK}; font-family: ${HAND}; overflow: hidden; user-select: none; transition: opacity 0.4s; }
#menu::after { content: ""; position: absolute; inset: 0; pointer-events: none; box-shadow: inset 0 0 160px rgba(60, 40, 22, 0.45); }
#menu .m-title { position: absolute; left: 0; right: 0; top: 9vh; text-align: center; font-size: clamp(34px, 6vh, 60px); letter-spacing: 0.06em; filter: url(#charcoal); }
#menu .m-sub { text-align: center; font-size: 15px; color: ${SOFT}; margin-top: 4px; letter-spacing: 0.04em; }
#menu .m-list { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -46%); display: flex; flex-direction: column; align-items: center; gap: 8px; z-index: 1; }
#menu .m-item { font: inherit; font-size: clamp(20px, 3.4vh, 30px); color: ${INK}; background: none; border: none; padding: 2px 16px; cursor: pointer; position: relative; }
#menu .m-item::after { content: ""; position: absolute; left: 14%; right: 14%; bottom: 2px; height: 2px; background: ${INK}; transform: scaleX(0); transition: transform 0.25s; filter: url(#charcoal); }
#menu .m-item:hover:not(:disabled)::after, #menu .m-item.m-on::after { transform: scaleX(1); }
#menu .m-item:disabled { color: ${SOFT}; cursor: default; text-decoration: line-through; text-decoration-thickness: 2px; }
#menu .m-small { font: inherit; font-size: 13px; color: ${SOFT}; background: none; border: none; cursor: pointer; text-decoration: underline; margin-top: 4px; }
#menu .m-account { position: absolute; top: 18px; right: 26px; font-size: 15px; text-align: right; z-index: 2; }
#menu .m-account button { font: inherit; color: ${INK}; background: none; border: none; cursor: pointer; text-decoration: underline; padding: 0 0 0 12px; }
#menu .m-side { position: absolute; right: 6vw; top: 22vh; width: min(340px, 40vw); padding: 16px 20px 18px; border: 1.8px solid ${INK}; border-radius: 4px 7px 3px 6px; outline: 1px solid ${FAINT}; outline-offset: 2px; background: rgba(240, 232, 212, 0.55); z-index: 2; }
#menu .m-side h3 { margin: 0 0 8px; font-size: 19px; font-weight: normal; border-bottom: 2px solid ${INK}; display: inline-block; filter: url(#charcoal); }
#menu .m-side label { display: block; font-size: 13px; color: ${SOFT}; margin: 8px 0 2px; }
#menu .m-side input { width: 100%; box-sizing: border-box; font: inherit; font-size: 15px; color: ${INK}; background: rgba(255, 252, 240, 0.5); border: none; border-bottom: 1.6px solid ${INK}; padding: 3px 4px; outline: none; }
#menu .m-btn { font: inherit; font-size: 15px; color: ${INK}; background: transparent; border: 1.6px solid ${INK}; border-radius: 4px 2px 5px 3px; padding: 2px 12px; margin: 12px 8px 0 0; cursor: pointer; }
#menu .m-btn:hover:not(:disabled) { background: rgba(43, 37, 32, 0.12); }
#menu .m-btn:disabled { opacity: 0.4; cursor: default; }
#menu .m-link { font: inherit; font-size: 13px; color: ${INK}; background: none; border: none; padding: 0; margin: 12px 12px 0 0; cursor: pointer; text-decoration: underline; }
#menu .m-slot { display: block; width: 100%; text-align: left; font: inherit; color: ${INK}; background: none; border: 1.4px solid ${INK}; border-radius: 3px 6px 2px 5px; padding: 8px 10px; margin-top: 10px; cursor: pointer; }
#menu .m-slot:hover:not(:disabled) { background: rgba(43, 37, 32, 0.1); }
#menu .m-slot:disabled { cursor: default; color: ${SOFT}; }
#menu .m-slot .m-when { font-size: 12px; color: ${SOFT}; }
#menu .m-msg { margin-top: 12px; font-size: 14px; }
#menu .m-err { margin-top: 12px; font-size: 14px; color: ${RED}; font-weight: bold; }
@media (max-width: 760px) { #menu .m-side { left: 16px; right: 16px; width: auto; top: auto; bottom: 16px; } #menu .m-list { top: 40%; } }
`;
document.head.appendChild(style);

const html = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = (t) => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); };
const ui = { side: null, busy: false, msg: '', err: '' };	// side: 'login', 'signup', 'forgot', 'newPassword', 'load', 'join', or null
let root = null, chosen = null;

function render() {
	if (!root) return;
	const A = core.account, dis = ui.busy ? 'disabled' : '';
	const saves = (A.slots ?? []).filter(Boolean).length;
	const account = A.session
		? `<b>${html(A.profile?.username ?? A.session.user.email)}</b><button data-act="logout" ${dis}>Log out</button><button data-act="side:newPassword">Password</button>`
		: `<button data-act="side:login">Log in</button><button data-act="side:signup">Sign up</button>`;
	let side = '';
	if (ui.side == 'login') side = `<h3>Log in</h3><label>Email</label><input data-f="email" type="email" autocomplete="email"><label>Password</label><input data-f="password" type="password" autocomplete="current-password">
		<div><button class="m-btn" data-act="login" ${dis}>Log in</button><button class="m-link" data-act="side:forgot">Forgot password</button><button class="m-link" data-act="side:signup">Sign up</button></div>`;
	else if (ui.side == 'signup') side = `<h3>Sign up</h3><div class="m-when" style="font-size:13px; color:${SOFT};">Three saves kept on the site, to load from anywhere</div>
		<label>Username</label><input data-f="username" autocomplete="username" maxlength="20"><label>Email</label><input data-f="email" type="email" autocomplete="email"><label>Password</label><input data-f="password" type="password" autocomplete="new-password">
		<div><button class="m-btn" data-act="signup" ${dis}>Sign up</button><button class="m-link" data-act="side:login">I have an account</button></div>`;
	else if (ui.side == 'forgot') side = `<h3>A new password</h3><label>Email</label><input data-f="email" type="email" autocomplete="email">
		<div><button class="m-btn" data-act="forgot" ${dis}>Email me a link</button><button class="m-link" data-act="side:login">Back</button></div>`;
	else if (ui.side == 'newPassword') side = `<h3>Set a password</h3><label>New password</label><input data-f="password" type="password" autocomplete="new-password">
		<div><button class="m-btn" data-act="setPassword" ${dis}>Set it</button><button class="m-link" data-act="side:">Not now</button></div>`;
	else if (ui.side == 'load') {
		const rows = (A.slots ?? Array(core.SLOTS).fill(undefined)).map((s, k) => s === undefined ? `<button class="m-slot" disabled>Slot ${k + 1} · …</button>`
			: s ? `<button class="m-slot" data-act="load:${k + 1}" ${dis}><b>${html(s.name || 'Day ' + s.day)}</b><div class="m-when">Slot ${k + 1} · day ${s.day} · ${html(when(s.updated_at))}</div></button>`
			: `<button class="m-slot" disabled>Slot ${k + 1} · empty</button>`).join('');
		side = `<h3>Load a save</h3>${rows}<div><button class="m-link" data-act="side:">Close</button></div>`;
	} else if (ui.side == 'join') {
		let name = '';
		try { name = localStorage.getItem('huntName') || ''; } catch (e) { /* */ }
		side = `<h3>Join a game</h3><label>Your name</label><input data-f="name" maxlength="20" value="${html(name)}"><label>Room code (the host's)</label><input data-f="code" maxlength="5" style="text-transform:uppercase; letter-spacing:0.2em;">
			<div><button class="m-btn" data-act="join" ${dis}>Join</button><button class="m-link" data-act="side:">Close</button></div>`;
	}
	const typed = Object.fromEntries([...root.querySelectorAll('[data-f]')].map((el) => [el.dataset.f, el.value]));
	root.innerHTML = `<div class="m-title">WebGPU Life<div class="m-sub">a world drawn in charcoal</div></div>
		<div class="m-account">${account}</div>
		<div class="m-list">
			<button class="m-item" data-act="new:survival" ${dis}>New Survival</button>
			<button class="m-item" data-act="new:observe" ${dis}>New Observation</button>
			<button class="m-item" data-act="new:war" ${dis}>War Mode</button>
			<button class="m-item" data-act="new:horde" ${dis}>Horde Mode</button>
			<button class="m-item ${ui.side == 'load' ? 'm-on' : ''}" data-act="side:load" ${saves && !ui.busy ? '' : 'disabled'} title="${A.session ? (saves ? '' : 'No saves on your account yet') : 'Log in to load your saves'}">Load Save</button>
			<button class="m-item ${ui.side == 'join' ? 'm-on' : ''}" data-act="side:join" ${dis}>Join Game</button>
			<button class="m-small" data-act="file">or open a save file from this computer</button>
		</div>
		${side || ui.msg || ui.err ? `<div class="m-side">${side}${ui.msg ? `<div class="m-msg">${html(ui.msg)}</div>` : ''}${ui.err ? `<div class="m-err">${html(ui.err)}</div>` : ''}</div>` : ''}`;
	for (const el of root.querySelectorAll('[data-f]')) if (typed[el.dataset.f] !== undefined && el.type != 'password') el.value = typed[el.dataset.f];
	root.querySelector('.m-side input')?.focus();
}
const field = (name) => root.querySelector(`[data-f="${name}"]`)?.value.trim() ?? '';
const password = () => root.querySelector('[data-f="password"]')?.value ?? '';
async function run(work) {
	ui.busy = true; ui.err = ''; ui.msg = ''; render();
	try { ui.msg = (await work()) ?? ''; } catch (e) { ui.err = e.message || String(e); }
	ui.busy = false; render();
}
function start(mode, more = {}) {
	if (chosen) chosen({ mode, ...more });
	chosen = null;
	root.style.opacity = '0';
	setTimeout(() => { root.remove(); root = null; }, 420);
	showLoading('Getting ready');
}
function newGame(kind) {
	if (kind == 'survival') {
		// (a new Survival game: what this browser kept of the last one cleared, SURVIVAL_KEYS)
		const keys = [];
		try { for (let k = 0; k < localStorage.length; k++) if (SURVIVAL_KEYS(localStorage.key(k))) keys.push(localStorage.key(k)); } catch (e) { /* */ }
		if (keys.length && !confirm('Start a new Survival game? The game kept in this browser is cleared (the saves on your account are kept).')) return;
		for (const key of keys) localStorage.removeItem(key);
	}
	start(MODES[kind]);
}
async function loadFrom(bytes) {
	await core.startSave(bytes);
	start('Hunting', { loaded: true });
}
const picker = document.createElement('input');
picker.type = 'file';
picker.accept = '.huntsave';
picker.style.display = 'none';
picker.addEventListener('change', () => {
	const file = picker.files?.[0];
	picker.value = '';
	if (file) run(async () => { await loadFrom(new Uint8Array(await file.arrayBuffer())); return ''; });
});

function clicked(event) {
	const el = event.target.closest('[data-act]');
	if (!el || el.disabled) return;
	const [act, arg] = el.dataset.act.split(':');
	if (act == 'side') { ui.side = arg || null; ui.err = ui.msg = ''; render(); if (arg == 'load' && core.loggedIn()) run(() => core.loadSlots().then(() => '')); return; }
	if (act == 'new') newGame(arg);
	else if (act == 'file') picker.click();
	else if (act == 'login') run(async () => { await core.logIn(field('email'), password()); ui.side = (core.account.slots ?? []).some(Boolean) ? 'load' : null; return `Logged in as ${core.account.profile?.username}`; });
	else if (act == 'signup') run(async () => { const r = await core.signUp(field('username'), field('email'), password()); ui.side = core.loggedIn() ? null : 'login'; return r; });
	else if (act == 'forgot') run(() => core.sendReset(field('email')));
	else if (act == 'setPassword') run(async () => { const r = await core.setPassword(password()); ui.side = null; return r; });
	else if (act == 'logout') run(async () => { await core.logOut(); ui.side = null; return 'Logged out'; });
	else if (act == 'load') run(async () => { await loadFrom(await core.slotBytes(Number(arg))); return ''; });
	else if (act == 'join') {
		const code = field('code').toUpperCase(), name = field('name');
		if (!/^[A-Z0-9]{5}$/.test(code)) { ui.err = 'A room code is 5 letters'; render(); return; }
		try { if (name) localStorage.setItem('huntName', name.slice(0, 20)); } catch (e) { /* */ }
		start('Hunting', { join: code });
	}
}

// THE MENU, shown: given back once something is chosen (see the top)
export function startMenu() {
	if (core.saveWaiting()) { showLoading('Loading the save'); return Promise.resolve({ mode: 'Hunting', loaded: true }); }
	hideLoading();
	root = document.createElement('div');
	root.id = 'menu';
	document.body.appendChild(root);
	root.addEventListener('click', clicked);
	root.addEventListener('keydown', (event) => { if (event.key == 'Enter') root.querySelector('.m-side .m-btn')?.click(); });
	core.onAccount(render);
	render();
	// (back from an email's link: logged in, or to set a new password)
	core.emailLink().then((kind) => { if (kind == 'recovery') ui.side = 'newPassword'; else if (kind == 'login') ui.msg = `Logged in as ${core.account.profile?.username}`; render(); })
		.catch((e) => { ui.err = e.message || String(e); render(); });
	return new Promise((resolve) => { chosen = resolve; });
}
