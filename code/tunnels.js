import { settings } from './settings.js';
import * as terrain from './terrain.js'
import { setStillLights } from './pointLights.js'
import { tunnelLamps } from './townGround.js'

/*
	UNDERFOOT IN A TUNNEL, AND ON A ROAD'S BRIDGE (footpaths.js plans them: terrain.land.tunnels, each { kind ('tunnel' or 'bridge'), a, b
	(the ends of its floor, or its deck, [x, y, z]), half (its half width), height (a tunnel's, floor to crown) }). The land under a tunnel
	is the mountain over it, so what a walker or a horse stands on is asked here first (hunting.js: groundUnder; horse.js):
		floorAt(x, z, y)		the floor of the tunnel (or the deck of the bridge) a walker at y is on or in, or null: in a tunnel from a
								little under its floor up to its crown (on the mountain over it, the land as ever); on a bridge from a
								little under its deck up (under it, in the water, the land as ever)
		keepIn(p, radius, y)	in one (as floorAt has it), p ({ x, z }) moved back off its walls or over its parapets to radius from them
	Their lamps (townGround.js: tunnelLamps) are lights (pointLights.js), lit by day as well: it is dark in there.
*/
const UNDER = 3;					// world units: how far under a floor or a deck it still holds one up (a step down on to it)
const DECK = 0.36;					// how far over its line a bridge's deck is (townGround.js: lifted, and its ribbon over that)
const LAMP = { radius: 18, colour: [1.0, 0.72, 0.42], strength: 3.2 };

export const tunnelStats = { floors: 0, kept: 0 };
const list = () => terrain.land?.tunnels ?? [];
// (where along it a place is, 0 to 1, how far off its line, and its floor there)
const found = { s: 0, across: 0, floor: 0, lead: 0 };
function along(t, x, z) {
	const ex = t.b[0] - t.a[0], ez = t.b[2] - t.a[2], ll = ex * ex + ez * ez || 1, l = Math.sqrt(ll);
	found.s = ((x - t.a[0]) * ex + (z - t.a[2]) * ez) / ll;
	found.lead = t.kind == 'bridge' ? 0 : LEAD / l;
	found.across = ((x - t.a[0]) * ez - (z - t.a[2]) * ex) / l;
	const s = Math.min(Math.max(found.s, 0), 1);
	found.floor = t.a[1] + (t.b[1] - t.a[1]) * s + (t.kind == 'bridge' ? DECK + (t.rise ?? 0) * Math.sin(Math.PI * s) : 0);
	return found;
}
const LEAD = 1.5;					// world units: a tunnel's floor from this far out of its portals (its road cut on in under it: footpaths.js)
const inside = (t, f, y) => f.s >= -f.lead && f.s <= 1 + f.lead && Math.abs(f.across) <= t.half && y >= f.floor - UNDER && (t.kind == 'bridge' || y <= f.floor + t.height - 1);
// (a quick look first: is it near the box round it at all)
const near = (t, x, z) => x > Math.min(t.a[0], t.b[0]) - t.half - 2 && x < Math.max(t.a[0], t.b[0]) + t.half + 2 && z > Math.min(t.a[2], t.b[2]) - t.half - 2 && z < Math.max(t.a[2], t.b[2]) + t.half + 2;

export function floorAt(x, z, y) {
	for (const t of list()) {
		if (!near(t, x, z)) continue;
		const f = along(t, x, z);
		if (inside(t, f, y)) { tunnelStats.floors++; return f.floor; }
	}
	return null;
}
// (from where it was: in one there, it stays in it, off its sides)
export function keepIn(p, radius, y, fromX = p.x, fromZ = p.z) {
	for (const t of list()) {
		if (!near(t, fromX, fromZ)) continue;
		const was = along(t, fromX, fromZ);
		if (!inside(t, was, y)) continue;
		const f = along(t, p.x, p.z), most = t.half - radius;
		if (f.s < 0 || f.s > 1 || Math.abs(f.across) <= most) return;
		const l = Math.hypot(t.b[0] - t.a[0], t.b[2] - t.a[2]) || 1, nx = (t.b[2] - t.a[2]) / l, nz = -(t.b[0] - t.a[0]) / l, back = f.across - Math.sign(f.across) * most;
		p.x -= nx * back; p.z -= nz * back;
		tunnelStats.kept++;
		return;
	}
}

// the lamps' lights, for the tunnels there are
let lampsFor = null;
function lampsNow() {
	const tunnels = terrain.land?.paths?.filter((p) => p.kind == 'tunnel') ?? [];
	setStillLights('tunnels', tunnels.flatMap((p) => tunnelLamps(p)).map((at) => ({ at, radius: LAMP.radius, colour: LAMP.colour, strength: LAMP.strength, night: false })));
}
terrain.onTiles(() => lampsNow());
export function tunnelsUpdate() { if (lampsFor !== terrain.land) { lampsFor = terrain.land; lampsNow(); } }
