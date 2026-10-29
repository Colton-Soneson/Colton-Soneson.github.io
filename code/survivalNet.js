/*
	THE SURVIVAL game mode's messages (loot.js, survivalTools.js, survival.js), between the players of a game (net.js carries them, as
	{ t: 'sv', k: what it is, ... }). The host keeps what everyone shares (what is in each container, the campfires): a joiner asks it,
	and it tells everyone. Alone (no game), this machine is the host of it all.
		send(k, data)		from a joiner, to the host; from the host, to every joiner
		sendTo(id, k, data)	from the host, to one joiner
		on(k, fn)			fn(data, from): from a joiner's id (on the host), or 'host' (on a joiner)
		onJoin(fn)			on the host, a joiner come in: fn(id), to send it what there is
	authority(): whether this machine keeps the shared things (the host, or alone)
*/
export const link = { role: () => 'off', myId: () => 0, toHost: null, toAll: null, toOne: null };
const handlers = new Map(), joinListeners = [];

export const role = () => link.role();
export const authority = () => role() != 'joined';
export const myId = () => link.myId();
export function on(kind, fn) { handlers.set(kind, fn); }
export function onJoin(fn) { joinListeners.push(fn); }
export function send(kind, data = {}) {
	const message = { t: 'sv', k: kind, ...data };
	if (role() == 'joined') link.toHost?.(message);
	else if (role() == 'host') link.toAll?.(message);
}
export function sendTo(id, kind, data = {}) { if (role() == 'host') link.toOne?.(id, { t: 'sv', k: kind, ...data }); }
// (net.js: a message heard, and a joiner come in)
export function heard(message, from) { handlers.get(message.k)?.(message, from); }
export function joined(id) { for (const fn of joinListeners) fn(id); }
