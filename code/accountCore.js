/*
	THE ACCOUNTS AND THE SAVE SLOTS, the calls (the main menu's, menu.js, before any of the game is loaded; and the game's, accounts.js: the
	journal's Saves page): a player signs up with a username, an email and a password, logs in with the email and the password, and has
	SLOTS save slots kept on the site's own database (Supabase: its Auth for the accounts, its Data API for the saves table,
	supabase/schema.sql), each slot the game's save file (saveGame.js: the same as the one downloaded) and what the slot shows of it (a
	name, the day). Nothing here imports the game: it is all fetch, so the menu can use it with nothing else loaded.
	THE SESSION is kept in the browser (SESSION_KEY), renewed with its refresh token before it runs out, so a player stays logged in.
	The links in the emails (confirming the account, a new password) come back to this page with the session in the address (#): taken
	from there (emailLink), a new password's saying so, for the menu to ask for one.
	THE KEY here (KEY) is the project's publishable key: made to be in a web page. What anyone can do with it is only what the database's
	rules let them (row level security: a player their own profile and saves, and nothing else).
	LOADING A SAVE (startSave): the save file read (its FORMAT, its version, gzipped JSON: as saveGame.js writes it) and put where the
	settings take it from as the game loads (settings.js: SAVE_LOADING, the same name).
*/
const URL_BASE = 'https://ejbbykxdbfcwaeyaigto.supabase.co';
const KEY = 'sb_publishable_j4Z5X3fGAgkjn_yNH2zaYg_R7S2d5iY';
export const SLOTS = 3;
const SESSION_KEY = 'huntAccountSession';
const RENEW = 60;					// seconds before the session runs out it is renewed
const SAVE_LOADING = 'survivalSaveLoading';		// (settings.js's)
const FORMAT = [0x48, 0x53, 0x56, 0x31];		// (saveGame.js's: 'HSV1')

export const account = { session: null, profile: null, slots: null };	// slots: [{ slot, name, day, updated_at } or null] ×SLOTS, null while not known
const listeners = [];
// told whenever the account or its slots change: fn()
export function onAccount(fn) { listeners.push(fn); }
const told = () => { for (const fn of listeners) fn(); };

// THE CALLS (see the top)
async function call(path, { method = 'GET', body = null, auth = true, headers = {} } = {}) {
	if (auth) await fresh();
	const response = await fetch(URL_BASE + path, {
		method,
		headers: { apikey: KEY, 'Content-Type': 'application/json', ...(auth && account.session ? { Authorization: `Bearer ${account.session.access_token}` } : {}), ...headers },
		body: body === null ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let data = null;
	try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
	if (!response.ok) throw new Error(data?.msg ?? data?.error_description ?? data?.message ?? data?.error ?? `Error ${response.status}`);
	return data;
}
function keep(s) {
	account.session = s && s.access_token ? { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600), user: { id: s.user?.id, email: s.user?.email } } : null;
	try { account.session ? localStorage.setItem(SESSION_KEY, JSON.stringify(account.session)) : localStorage.removeItem(SESSION_KEY); } catch (e) { /* (nowhere to keep it) */ }
}
// renewed before it runs out (see THE SESSION at the top)
async function fresh() {
	const s = account.session;
	if (!s || s.expires_at - Date.now() / 1000 > RENEW) return;
	try { keep(await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token }, auth: false })); }
	catch (e) { keep(null); account.profile = null; account.slots = null; told(); }
}
export const loggedIn = () => !!account.session;
export async function whoAmI() {
	if (!account.session) { account.profile = null; return null; }
	const rows = await call(`/rest/v1/profiles?select=username&id=eq.${account.session.user.id}`);
	account.profile = rows?.[0] ?? { username: account.session.user.email };
	told();
	return account.profile;
}
export async function loadSlots() {
	if (!account.session) { account.slots = null; told(); return null; }
	const rows = await call('/rest/v1/saves?select=slot,name,day,updated_at&order=slot');
	account.slots = Array.from({ length: SLOTS }, (_, k) => rows.find((r) => r.slot == k + 1) ?? null);
	told();
	return account.slots;
}

// SIGNING UP, LOGGING IN, OUT, A NEW PASSWORD
const NAME_RULE = /^[A-Za-z0-9_]{3,20}$/;
const back = () => location.origin + location.pathname;
export async function signUp(username, email, password) {
	if (!NAME_RULE.test(username)) throw new Error('A username is 3 to 20 letters, numbers or _');
	if (password.length < 6) throw new Error('A password is 6 characters at the least');
	if (await call('/rest/v1/rpc/username_taken', { method: 'POST', body: { name: username }, auth: false })) throw new Error('That username is taken');
	const r = await call(`/auth/v1/signup?redirect_to=${encodeURIComponent(back())}`, { method: 'POST', body: { email, password, data: { username } }, auth: false });
	// (confirming the email first, if the project asks for it: no session until the link in it is followed)
	if (r?.access_token) { keep(r); await whoAmI(); await loadSlots(); return 'Signed up and logged in'; }
	return `Nearly there: follow the link in the email sent to ${email}, then log in`;
}
export async function logIn(email, password) {
	keep(await call('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password }, auth: false }));
	await whoAmI();
	await loadSlots();
}
export async function logOut() {
	try { if (account.session) await call('/auth/v1/logout', { method: 'POST' }); } catch (e) { /* (gone already) */ }
	keep(null); account.profile = null; account.slots = null;
	told();
}
export async function sendReset(email) {
	await call(`/auth/v1/recover?redirect_to=${encodeURIComponent(back())}`, { method: 'POST', body: { email }, auth: false });
	return `If ${email} has an account, an email is on its way with a link to set a new password`;
}
export async function setPassword(password) {
	if (password.length < 6) throw new Error('A password is 6 characters at the least');
	await call('/auth/v1/user', { method: 'PUT', body: { password } });
	return 'Password changed';
}

// THE SLOTS
const toBase64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export async function saveSlot(slot, name, day, bytes) {
	await call('/rest/v1/saves?on_conflict=user_id,slot', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
		body: { user_id: account.session.user.id, slot, name: (name || `Day ${day}`).slice(0, 40), day, data: toBase64(bytes), updated_at: new Date().toISOString() } });
	await loadSlots();
	return `Saved in slot ${slot}`;
}
export async function slotBytes(slot) {
	const rows = await call(`/rest/v1/saves?select=data&slot=eq.${slot}`);
	if (!rows?.[0]) throw new Error('That slot is empty');
	return fromBase64(rows[0].data);
}
export async function clearSlot(slot) {
	await call(`/rest/v1/saves?slot=eq.${slot}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
	await loadSlots();
	return `Slot ${slot} cleared`;
}

// LOADING A SAVE (see the top): the file's bytes read, and put where the game takes it from as it loads. false: not a save file
async function through(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
export async function startSave(bytes) {
	if (bytes.length < 8 || FORMAT.some((b, k) => bytes[k] != b)) throw new Error('That is not a save file');
	const save = JSON.parse(new TextDecoder().decode(await through(bytes.subarray(8), new DecompressionStream('gzip'))));
	if (!save || typeof save != 'object' || !save.world || !save.stored) throw new Error('That save file is damaged');
	sessionStorage.setItem(SAVE_LOADING, JSON.stringify(save));
	return save;
}
export function saveWaiting() { try { return !!sessionStorage.getItem(SAVE_LOADING); } catch (e) { return false; } }

// THE SESSION (see the top): kept from before; or come back from an email's link with one in the address. Gives 'recovery' when it was
//		the link for a new password, 'login' for another, or null
try { keep(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null')); } catch (e) { account.session = null; }
export async function emailLink() {
	const hash = new URLSearchParams(location.hash.slice(1));
	if (hash.get('error_description')) { history.replaceState(null, '', location.pathname + location.search); throw new Error(hash.get('error_description')); }
	if (!hash.get('access_token')) { if (account.session) { await fresh(); if (account.session) { try { await whoAmI(); await loadSlots(); } catch (e) { /* (offline) */ } } } return null; }
	keep({ access_token: hash.get('access_token'), refresh_token: hash.get('refresh_token'), expires_in: Number(hash.get('expires_in')) || 3600, user: null });
	history.replaceState(null, '', location.pathname + location.search);
	try { const user = await call('/auth/v1/user'); keep({ ...account.session, user }); await whoAmI(); await loadSlots(); } catch (e) { keep(null); throw e; }
	return hash.get('type') == 'recovery' ? 'recovery' : 'login';
}
