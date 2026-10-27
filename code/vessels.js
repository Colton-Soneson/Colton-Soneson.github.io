/*
	The vessels that can be sailed (boat.js sails them, vf_boat.js draws them, hunting.js walks about on them). Each is a mesh and
	everything boat.js needs to know to float it, sail it and let the player work it, all in metres: +x to port (the left, looking
	forward), +y up, +z to the bow.

	THE MESH: 12 numbers a vertex: where (x, y, z) and its material (MATERIALS, coloured in vf_boat.js); a sail's (u, v): up it
	from the foot and across it from the luff, 0 to 1; its group (what moves it, GROUPS below, -1 for nothing) and its role in
	the group (ROLE); the control it belongs to (the cleat, the seat, the wheel, the ladder: it glows with the crosshair on it,
	-1 for none), the rope it is (ropes, -1 for none), the piece it falls with once it is shot to pieces (pieces, 0 for none), and
	the part it is (a gun's, turned as shipGuns.js says: 1 to MAX_PARTS, 0 for none).

	A GROUP is something on the boat that turns about an axis: the rudder, the steering wheel, or a sail with its spars. A sail's
	group is also hoisted: its cloth (and the gaff that holds its head up) comes down towards ref as it is lowered: mode 0 down
	to the boom (ref.y), mode 1 in to its tack (ref, a staysail coming down its stay), mode 2 up to its yard (ref.y, a square sail
	furled). The cloth is filled by the wind or shakes as it luffs, and the whole group swings about its axis.

	A SAIL (sails): its group, its area, how far out its sheet lets it go (eased) and how far in it pulls it (hauled), radians
	from straight aft. A square sail (fixed) is not let fly by its braces: it is braced round as far as they say, on whichever
	side the wind takes it, and it can be taken aback. centre: the middle of its cloth, where its force acts.

	THE HULL is lofted from STATIONS: at each z, the keel and points up the side from it (port), and its sheer, the top of the side.
	Under the hull are COLUMNS that the water is asked about (see FLOATING in boat.js): x, z, the bottom of the hull there and the
	area of hull each stands for. And the rest: the helm (where the player sits or stands to steer), the ladders up each side, the
	controls, and how hard the hull is to push through the water and to turn. reach: metres from the centre to the furthest of
	it (the bowsprit, the boom's end), and footprint: places along it (z) where the water under it is looked at before it is put
	in the sea (spawn.keel: how far its keel goes under the water).

	SHOT TO PIECES (boat.js): health, how much shooting it takes (rifle rounds' hits), and sinkSeconds, how long it takes to go down
	after. Its PIECES fall: each a mast (or the bowsprit) with whatever it carries, turned over about its foot (the bowsprit with
	the jib on it rolled over to one side), height: how tall it is, which is how long it takes to fall. Up to MAX_PIECES.
*/

// what each triangle is made of (see the fragment shader in vf_boat.js)
export const MATERIALS = {
	HULL: 0, DECK: 1, FLOOR: 2, DARK: 3, WOOD: 4, ALUMINIUM: 5, DINGHY_MAIN: 6, DINGHY_JIB: 7, WIRE: 8, ROPE_BLUE: 9, ROPE_RED: 10,
	ROPE_TAN: 11, CHROME: 12, GALVANISED: 13, CLEAT: 14, PLANKING: 15, SPAR: 16, CANVAS: 17, IRON: 18, BRASS: 19, RED: 20, FLAG: 21, TAR: 22, LAMP: 23,
};
// what a vertex is to its group: turned with it, a sail's cloth, a spar that goes up and down with the cloth (a gaff), a rope, the stowed anchor
export const ROLE = { RIGID: 0, CLOTH: 1, HOISTED: 2, ROPE: 3, STOWED: 4 };
export const MAX_GROUPS = 8;
export const MAX_ROPES = 8;
export const MAX_PIECES = 3;
export const MAX_PARTS = 22;
const M = MATERIALS;

// A mesh being made. The material, group, role, control and rope set on it go on every triangle made after
function makeMesh() {
	const v = [];
	const mesh = {
		material: 0, group: -1, role: 0, control: -1, rope: -1, piece: 0, part: 0,
		with(style) { Object.assign(mesh, { group: -1, role: 0, control: -1, rope: -1, piece: 0, part: 0 }, style); return mesh; },
		tri(a, b, c, uv = [[0, 0], [0, 0], [0, 0]]) {
			[a, b, c].forEach((p, k) => v.push(p[0], p[1], p[2], mesh.material, uv[k][0], uv[k][1], mesh.group, mesh.role, mesh.control, mesh.rope, mesh.piece, mesh.part));
		},
		quad(a, b, c, d) { mesh.tri(a, b, c); mesh.tri(a, c, d); },
		// a tube from a to b with any number of sides, radius ra at a and rb at b
		tube(a, b, ra, rb, sides) {
			const axis = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], length = Math.hypot(...axis);
			const d = axis.map((x) => x / length);
			const other = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
			let u = [d[1] * other[2] - d[2] * other[1], d[2] * other[0] - d[0] * other[2], d[0] * other[1] - d[1] * other[0]];
			const ul = Math.hypot(...u); u = u.map((x) => x / ul);
			const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
			const ring = (c, r) => Array.from({ length: sides }, (_, k) => { const t = (k + 0.5) / sides * Math.PI * 2; return [0, 1, 2].map((i) => c[i] + (u[i] * Math.cos(t) + w[i] * Math.sin(t)) * r); });
			const A = ring(a, ra), B = ring(b, rb);
			for (let k = 0; k < sides; k++) mesh.quad(A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k]);
		},
		// a box, [x0, x1], [y0, y1], [z0, z1]. skip: faces left off (0 -x, 1 +x, 2 -y, 3 +y, 4 -z, 5 +z)
		box([x0, x1], [y0, y1], [z0, z1], skip = []) {
			const c = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
			const faces = [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]];
			faces.forEach((f, k) => { if (!skip.includes(k)) mesh.quad(c(f[0]), c(f[1]), c(f[2]), c(f[3])); });
		},
		// a little four sided cleat (or belaying pin, or block), size s
		cleat([x, y, z], s = 1) {
			const top = [x, y + 0.05 * s, z], a = [x - 0.04 * s, y, z - 0.04 * s], b = [x + 0.04 * s, y, z - 0.04 * s], c = [x, y, z + 0.05 * s];
			mesh.tri(a, b, top); mesh.tri(b, c, top); mesh.tri(c, a, top); mesh.tri(a, c, b);
		},
		// a sail, made flat in rows up it (so it can be curved): its luff from tack up to head, its leech from clew up to peak (a gaff
		//		sail's, or a square sail's: four sided) or up to the head (three sided). roach: how far its leech bows out aft
		sail(tack, head, clew, peak, rows, roach = 0) {
			const top = peak ?? head;
			const at = (t, s) => {
				const luff = tack.map((x, i) => x + (head[i] - x) * t);
				const leech = clew.map((x, i) => x + (top[i] - x) * t);
				leech[2] -= roach * Math.sin(Math.PI * t);
				return { p: luff.map((x, i) => x + (leech[i] - x) * s), uv: [t, s] };
			};
			for (let r = 0; r < rows; r++) {
				const t0 = r / rows, t1 = (r + 1) / rows;
				const low = [0, 0.5, 1].map((s) => at(t0, s));
				if (!peak && r == rows - 1) {
					const tip = at(1, 0);
					mesh.tri(low[0].p, low[1].p, tip.p, [low[0].uv, low[1].uv, tip.uv]);
					mesh.tri(low[1].p, low[2].p, tip.p, [low[1].uv, low[2].uv, [1, 1]]);
					continue;
				}
				const high = [0, 0.5, 1].map((s) => at(t1, s));
				for (let k = 0; k < 2; k++) {
					mesh.tri(low[k].p, low[k + 1].p, high[k + 1].p, [low[k].uv, low[k + 1].uv, high[k + 1].uv]);
					mesh.tri(low[k].p, high[k + 1].p, high[k].p, [low[k].uv, high[k + 1].uv, high[k].uv]);
				}
			}
		},
		done() { return new Float32Array(v); },
	};
	return mesh;
}

// The hull's shape, from its stations: [z, [x, y] of the keel and up the port side to the sheer]
function hullShape(stations) {
	const at = (z, pick) => {
		if (z <= stations[0][0]) return pick(stations[0]);
		for (let i = 0; i < stations.length - 1; i++) {
			const a = stations[i], b = stations[i + 1];
			if (z <= b[0]) return pick(a) + (pick(b) - pick(a)) * (z - a[0]) / (b[0] - a[0]);
		}
		return pick(stations[stations.length - 1]);
	};
	const top = stations[0][1].length - 1;
	const inside = (z) => z >= stations[0][0] && z <= stations[stations.length - 1][0];
	return {
		halfBreadth: (z) => inside(z) ? at(z, (s) => s[1][top][0]) : 0,
		sheer: (z) => at(z, (s) => s[1][top][1]),
		keel: (z) => at(z, (s) => s[1][0][1]),
		point: (z, k) => [at(z, (s) => s[1][k][0]), at(z, (s) => s[1][k][1])],
		// the widest the hull is at height y, at z (the half breadth there)
		widthAt: (z, y) => {
			let widest = 0;
			for (let k = 0; k < top; k++) {
				const a = [at(z, (s) => s[1][k][0]), at(z, (s) => s[1][k][1])], b = [at(z, (s) => s[1][k + 1][0]), at(z, (s) => s[1][k + 1][1])];
				if ((y - a[1]) * (y - b[1]) <= 0 && a[1] != b[1]) widest = Math.max(widest, a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]));
			}
			return widest;
		},
	};
}

// the hull's sides (port and starboard both facing out) and its transom, from the stations
function loftHull(mesh, stations) {
	const section = (s, side) => s[1].map(([x, y]) => [side * x, y, s[0]]);
	for (let i = 0; i < stations.length - 1; i++) {
		const A = section(stations[i], 1), B = section(stations[i + 1], 1);
		const As = section(stations[i], -1), Bs = section(stations[i + 1], -1);
		for (let k = 0; k < A.length - 1; k++) {
			mesh.quad(A[k], A[k + 1], B[k + 1], B[k]);
			mesh.quad(As[k], Bs[k], Bs[k + 1], As[k + 1]);
		}
	}
	// the transom: a fan from the keel, facing aft
	const P = section(stations[0], 1), S = section(stations[0], -1);
	const ring = [...P.slice(1).reverse(), ...S.slice(1)];
	for (let k = 0; k < ring.length - 1; k++) mesh.tri(P[0], ring[k], ring[k + 1]);
	mesh.tri(P[0], ring[ring.length - 1], ring[0]);	// (and across the top, from one side's sheer to the other's)
}

// how far along a rope or a section of tube the boat's controls are numbered: each vessel's own, from 0
function controlsOf(list) {
	return list.map((control, id) => ({ id, radius: 0.2, ...control }));
}

// THE DINGHY: an RS Quest, more or less. 4.3 metres, a mainsail and a jib, sailed from the seat at the back
//-------------------------------------------------
function dinghy() {
	const STATIONS = [
		[-2.15, [[0, 0.12], [0.55, 0.16], [0.72, 0.32], [0.74, 0.62]]],
		[-1.4, [[0, 0.04], [0.62, 0.10], [0.82, 0.30], [0.85, 0.64]]],
		[-0.5, [[0, 0.0], [0.62, 0.07], [0.84, 0.28], [0.865, 0.65]]],
		[0.4, [[0, 0.0], [0.56, 0.08], [0.80, 0.30], [0.84, 0.67]]],
		[1.2, [[0, 0.03], [0.40, 0.13], [0.64, 0.36], [0.70, 0.71]]],
		[1.8, [[0, 0.12], [0.20, 0.24], [0.38, 0.46], [0.45, 0.75]]],
		[2.15, [[0, 0.30], [0, 0.45], [0, 0.6], [0, 0.78]]],
	];
	const hull = hullShape(STATIONS);
	const FLOOR = 0.30, SIDE_DECK = 0.2, FOREDECK_AFT = 0.4;
	const SEAT = { z0: -1.85, z1: -1.45, top: 0.58 };
	const seatZ = (SEAT.z0 + SEAT.z1) / 2;
	const deckHeight = (x, z) => {
		const half = hull.halfBreadth(z);
		if (half <= 0 || Math.abs(x) > half) return null;
		if (z > FOREDECK_AFT || Math.abs(x) > half - SIDE_DECK) return hull.sheer(z) + 0.01;
		if (z >= SEAT.z0 && z <= SEAT.z1) return SEAT.top;
		return FLOOR;
	};
	const MAST_Z = 0.85, BOOM_END = [0, 1.45, -1.55];
	const JIB_TACK = [0, 0.80, 2.02], JIB_HEAD = [0, 4.50, 0.95], JIB_CLEW = [0, 0.95, 0.2];
	const MAIN_SHEET_BLOCK = [0, 0.36, -1.45], JIB_CLEATS = [[0.62, 0.68, -0.3], [-0.62, 0.68, -0.3]];
	const BOW_FITTING = [0, 0.78, 2.12];
	const LADDER = { x: 0.92, z0: -0.95, z1: -0.6, bottom: -0.5, top: 0.7 };		// (x: out to either side, starboard -x and port +x)
	const ladderZ = (LADDER.z0 + LADDER.z1) / 2;
	const SIDES = [-1, 1];

	const controls = controlsOf([
		{ kind: 'halyard', sail: 0, at: [0.07, 1.02, MAST_Z], name: 'Mainsail halyard', keys: 'Scroll up to raise · down to lower' },
		{ kind: 'halyard', sail: 1, at: [-0.07, 1.02, MAST_Z], name: 'Jib halyard', keys: 'Scroll up to raise · down to lower' },
		{ kind: 'sheet', sail: 0, at: MAIN_SHEET_BLOCK, name: 'Main sheet', keys: 'Scroll up to haul in · down to ease out' },
		{ kind: 'sheet', sail: 1, at: JIB_CLEATS[0], name: 'Jib sheet', keys: 'Scroll up to haul in · down to ease out' },
		{ kind: 'sheet', sail: 1, at: JIB_CLEATS[1], name: 'Jib sheet', keys: 'Scroll up to haul in · down to ease out' },
		{ kind: 'helm', at: [0, SEAT.top + 0.05, seatZ], name: 'Helm seat', keys: 'F sit and take the tiller', radius: 0.5 },
		...SIDES.map((side, k) => ({ kind: 'ladder', ladder: k, at: [side * LADDER.x, 0.1, ladderZ], name: 'Ladder', keys: 'F climb aboard', radius: 0.45 })),
		{ kind: 'anchor', at: [0, 0.82, 1.72], name: 'Anchor', keys: 'G drop it or bring it up', radius: 0.3 },
	]);
	const control = (kind, sail) => controls.find((c) => c.kind == kind && (sail === undefined || c.sail == sail || c.ladder == sail)).id;

	const mesh = makeMesh();
	// the hull (72) and the transom (5)
	mesh.with({ material: M.HULL });
	loftHull(mesh, STATIONS);
	// the foredeck (5), the side decks (12), the sides of the cockpit (12), the bulkhead (2), the floor (6)
	const sheer = (i, side, inset = 0) => { const s = STATIONS[i][1][3]; return [side * (s[0] - inset), s[1] + 0.01, STATIONS[i][0]]; };
	mesh.with({ material: M.DECK });
	for (let i = 3; i < 5; i++) mesh.quad(sheer(i, 1), sheer(i, -1), sheer(i + 1, -1), sheer(i + 1, 1));
	mesh.tri(sheer(5, 1), sheer(5, -1), sheer(6, 1));
	for (let i = 0; i < 3; i++) {
		for (const side of [1, -1]) {
			mesh.quad(sheer(i, side), sheer(i, side, SIDE_DECK), sheer(i + 1, side, SIDE_DECK), sheer(i + 1, side));
			const a = sheer(i, side, SIDE_DECK), b = sheer(i + 1, side, SIDE_DECK);
			mesh.quad(a, b, [b[0], FLOOR, b[2]], [a[0], FLOOR, a[2]]);
		}
	}
	mesh.with({ material: M.FLOOR });
	for (let i = 0; i < 3; i++) {
		const a = sheer(i, 1, SIDE_DECK), b = sheer(i + 1, 1, SIDE_DECK);
		mesh.quad([a[0], FLOOR, a[2]], [-a[0], FLOOR, a[2]], [-b[0], FLOOR, b[2]], [b[0], FLOOR, b[2]]);
	}
	const bulkhead = sheer(3, 1, SIDE_DECK);
	mesh.with({ material: M.DECK });
	mesh.quad([bulkhead[0], FLOOR, FOREDECK_AFT], [-bulkhead[0], FLOOR, FOREDECK_AFT], [-bulkhead[0], bulkhead[1], FOREDECK_AFT], [bulkhead[0], bulkhead[1], FOREDECK_AFT]);
	// the seat (6), the centreboard's case (8) and the board (10)
	mesh.with({ material: M.WOOD, control: control('helm') });
	mesh.box([-0.66, 0.66], [FLOOR, SEAT.top], [SEAT.z0, SEAT.z1], [0, 1, 2]);
	mesh.with({ material: M.DARK });
	mesh.box([-0.04, 0.04], [FLOOR, 0.6], [-0.35, FOREDECK_AFT - 0.01], [2, 5]);
	mesh.box([-0.012, 0.012], [-0.85, 0.02], [-0.05, 0.35], [3]);
	// the rudder's blade (12) and the tiller (10), turned together about the rudder's hinge
	mesh.with({ material: M.DARK, group: 0 });
	mesh.box([-0.015, 0.015], [-0.6, 0.62], [-2.47, -2.2]);
	mesh.with({ material: M.WOOD, group: 0 });
	mesh.box([-0.025, 0.025], [0.6, 0.66], [-2.3, -1.2], [4]);
	// the mast (12), the boom (10), the forestay and the shrouds (18)
	mesh.with({ material: M.ALUMINIUM, piece: 1 });
	mesh.tube([0, FLOOR, MAST_Z], [0, 6.2, MAST_Z], 0.045, 0.028, 6);
	mesh.with({ material: M.ALUMINIUM, group: 1, piece: 1 });
	mesh.tube([0, 1.45, MAST_Z], BOOM_END, 0.04, 0.035, 4);
	mesh.tri([0.03, 1.48, -1.55], [-0.03, 1.48, -1.55], [0, 1.41, -1.55]);
	mesh.tri([0.03, 1.48, -1.55], [0, 1.41, -1.55], [0.03, 1.42, -1.55]);
	mesh.with({ material: M.WIRE, piece: 1 });
	mesh.tube(BOW_FITTING, [0, 4.62, 0.87], 0.008, 0.008, 3);
	mesh.tube([0.84, 0.68, 0.5], [0.03, 4.62, 0.85], 0.006, 0.006, 3);
	mesh.tube([-0.84, 0.68, 0.5], [-0.03, 4.62, 0.85], 0.006, 0.006, 3);
	// the sails (28)
	mesh.with({ material: M.DINGHY_MAIN, group: 1, role: ROLE.CLOTH, piece: 1 });
	mesh.sail([0, 1.5, 0.81], [0, 6.05, 0.81], [0, 1.5, -1.5], null, 4, 0.32);
	mesh.with({ material: M.DINGHY_JIB, group: 2, role: ROLE.CLOTH, piece: 2 });
	mesh.sail(JIB_TACK, JIB_HEAD, JIB_CLEW, null, 4, 0.05);
	// the ropes (18): thin tubes from z = 0 to 1, laid where they go by the shader
	[M.ROPE_BLUE, M.ROPE_RED, M.ROPE_TAN].forEach((material, rope) => {
		mesh.with({ material, role: ROLE.ROPE, rope });
		mesh.tube([0, 0, 0], [0, 0, 1], 0.01, 0.01, 3);
	});
	// the ladders, one each side (30 each): two rails and three rungs
	const L = LADDER;
	SIDES.forEach((side, k) => {
		mesh.with({ material: M.CHROME, control: control('ladder', k) });
		const x0 = side * L.x, lean = -side * 0.04;
		for (const z of [L.z0, L.z1]) mesh.tube([x0, L.bottom, z], [x0 + lean, L.top, z], 0.015, 0.015, 3);
		for (const y of [-0.3, 0.05, 0.4]) {
			const x = x0 + lean * (y - L.bottom) / (L.top - L.bottom);
			mesh.tube([x, y, L.z0], [x, y, L.z1], 0.012, 0.012, 3);
		}
	});
	// the anchor on the foredeck (10)
	mesh.with({ material: M.GALVANISED, role: ROLE.STOWED, control: control('anchor') });
	mesh.tube([0, 0.8, 1.55], [0, 0.8, 1.9], 0.02, 0.02, 3);
	mesh.tri([0.12, 0.79, 1.5], [-0.12, 0.79, 1.5], [0, 0.79, 1.68]);
	mesh.tri([0.12, 0.79, 1.5], [0, 0.79, 1.68], [-0.12, 0.79, 1.5]);
	mesh.tri([0.06, 0.79, 1.9], [-0.06, 0.79, 1.9], [0, 0.83, 1.86]);
	mesh.tri([0.06, 0.79, 1.9], [0, 0.83, 1.86], [-0.06, 0.79, 1.9]);
	// the cleats (20)
	for (const c of controls) if (c.kind == 'halyard' || c.kind == 'sheet') { mesh.with({ material: M.CLEAT, control: c.id }); mesh.cleat(c.at); }

	const columns = [];
	for (const z of [-1.9, -1.1, -0.3, 0.5, 1.3]) {
		const x = 0.62 * hull.halfBreadth(z) / 0.865;
		for (const side of [1, -1]) columns.push({ x: side * x, z, bottom: hull.keel(z) + 0.08, area: 0.48 * Math.min(1, hull.halfBreadth(z) / 0.75), top: hull.sheer(z) });
	}
	columns.push({ x: 0, z: 1.85, bottom: 0.2, area: 0.2, top: hull.sheer(1.85) });

	const ring = [];
	for (const z of [-2.1, -1.2, -0.3, 0.6, 1.4]) for (const side of [1, -1]) ring.push([side * hull.halfBreadth(z) * 0.95, 0.4, z]);
	ring.push([0, 0.5, 2.1], [0, 0.1, -1.0], [0, 0.1, 0.8]);

	return {
		name: 'Dinghy', mesh: mesh.done(),
		health: 40, sinkSeconds: 12,
		pieces: [{ foot: [0, FLOOR, MAST_Z], height: 6.2 }, { foot: JIB_TACK, height: 4.6 }],
		halfBreadth: hull.halfBreadth, sheerHeight: hull.sheer, deckHeight,
		mass: 130, centre: [0, 0.35, -0.15], inertia: [330, 380, 150],
		columns, vDepth: 0.2, columnTop: 0.75, heaveDamping: 450,
		hullDrag: { linear: 15, quadratic: 22, hullSpeed: 2.4, wave: 20 }, slip: { linear: 300, quadratic: 400 },
		keel: { at: [0, -0.3, 0.15], area: 0.55 },
		rudder: { at: [0, -0.15, -2.3], area: 0.13, scull: 1.0, most: 0.6, seconds: 1.2 },
		damping: { yaw: [200, 900, 300], roll: 700, pitch: 900 },
		heelLimit: 0.6, heelStiffness: 8000, heelDamping: 600, pitchLimit: 0.45, pitchStiffness: 9000,
		groups: [
			{ kind: 'rudder', pivot: [0, 0, -2.2], axis: [0, 1, 0] },
			{ kind: 'sail', sail: 0, pivot: [0, 0, MAST_Z], axis: [0, 1, 0], mode: 0, ref: [0, 1.5, 0], chord: 2.35, taper: 0.8 },
			{ kind: 'sail', sail: 1, pivot: JIB_TACK, axis: JIB_HEAD.map((v, i) => v - JIB_TACK[i]), mode: 1, ref: JIB_TACK, chord: 1.9, taper: 0.9 },
		],
		sails: [
			{ name: 'Mainsail', group: 1, area: 7.5, eased: 1.45, hauled: 0.05, centre: [0, 3.0, 0.05], start: { hoist: 1, sheet: 0 } },
			{ name: 'Jib', group: 2, area: 3.0, eased: 1.15, hauled: 0.17, centre: [0, 2.05, 1.06], start: { hoist: 1, sheet: 0 } },
		],
		mainSail: 0, halyardSeconds: 4, sheetSeconds: 3,
		ropes: [
			{ from: BOOM_END, group: 1, role: ROLE.RIGID, to: [MAIN_SHEET_BLOCK], sag: 0.03 },
			{ from: JIB_CLEW, group: 2, role: ROLE.CLOTH, to: JIB_CLEATS, sag: 0.05 },
			{ rode: true, sag: 0.4 },
		],
		controls,
		helm: { at: [0, SEAT.top, seatZ], eye: 0.8, seated: true, hike: true, hikeX: 0.7, hikeOut: 1.0, standAt: [0, FLOOR, SEAT.z1 + 0.3], tiller: 'tiller' },
		ladders: SIDES.map((side, k) => ({ x: side * L.x, z: ladderZ, top: L.top, foot: [side * (L.x + 0.35), -0.6, ladderZ], over: [side * (L.x - 0.05), L.top + 0.1, ladderZ], inside: [side * 0.35, FLOOR, ladderZ], seconds: 1.4, control: control('ladder', k) })),
		reach: 3.0, footprint: [-2.1, -1.2, -0.3, 0.6, 1.4, 2.0],
		bow: BOW_FITTING, anchor: { rode: 40, stiffness: 2500, damping: 1800, most: 6000 },
		groundPoints: [[0, 0, -2.0], [0, 0, -1.0], [0, 0, 0], [0, 0.03, 1.0], [0, 0.25, 2.0], [0, -0.85, 0.15], [0, -0.6, -2.33]],
		groundGrip: { stiffness: 40000, damping: 2000, friction: 1500 }, rockStiffness: 30000, rockDamping: 2000, rockReach: 12,
		hullRing: ring,
		paint: { top: [0.86, 0.87, 0.85], band: [0.06, 0.12, 0.3], bandY: [0.5, 0.58], bottom: [0.86, 0.87, 0.85], bottomY: -100, inside: [0.86, 0.87, 0.85], ports: null },
		spawn: { depth: 4, clear: 30, clearDepth: 2.5, draft: 0.12, keel: 1.0 },
	};
}

// THE SCHOONER: a naval topsail schooner of about 1800, something like HMS Pickle. 18 metres on deck, two masts with a gaff
//		sail on each, a staysail and a jib out on the bowsprit, a square topsail on the foremast. Steered with a wheel. Her hull is
//		black with a yellow band along her gunports and coppered below the water. Armed (shipGuns.js works all of this): six little
//		80mm howitzers on pivots where her carronades would be, a crow's nest up each mast with a Lewis gun in it (shipGuns.js puts
//		the gun in her mesh) and a ladder up the front of the mast to it, a stack of rounds aft of the mainmast, a pile of supply
//		packs by the wheel, and a barrel of wood for mending her
//-------------------------------------------------
function schooner() {
	// keel, garboard, bilge low, bilge, the turn of the side, the deck's edge, the top of the bulwark
	const STATIONS = [
		[-9.0, [[0, 0.0], [0.15, 0.3], [0.9, 1.6], [1.9, 2.6], [2.3, 3.4], [2.35, 4.0], [2.3, 4.9]]],
		[-6.75, [[0, 0.05], [0.25, 0.35], [1.3, 1.3], [2.3, 2.2], [2.75, 3.2], [2.8, 3.85], [2.75, 4.75]]],
		[-4.5, [[0, 0.15], [0.3, 0.45], [1.6, 1.1], [2.6, 2.0], [2.9, 3.1], [2.92, 3.75], [2.85, 4.65]]],
		[-2.25, [[0, 0.25], [0.3, 0.55], [1.7, 1.1], [2.7, 2.0], [2.95, 3.1], [2.95, 3.7], [2.9, 4.6]]],
		[0, [[0, 0.35], [0.3, 0.65], [1.7, 1.2], [2.7, 2.05], [2.95, 3.1], [2.95, 3.7], [2.9, 4.6]]],
		[2.25, [[0, 0.5], [0.28, 0.8], [1.5, 1.4], [2.5, 2.2], [2.85, 3.15], [2.85, 3.75], [2.8, 4.65]]],
		[4.5, [[0, 0.65], [0.22, 1.0], [1.1, 1.75], [2.05, 2.5], [2.5, 3.25], [2.55, 3.85], [2.5, 4.75]]],
		[6.75, [[0, 0.9], [0.15, 1.3], [0.6, 2.2], [1.3, 2.9], [1.75, 3.4], [1.85, 4.0], [1.8, 4.9]]],
		[9.0, [[0, 1.6], [0, 2.2], [0, 2.8], [0, 3.3], [0, 3.7], [0, 4.15], [0, 5.0]]],
	];
	const hull = hullShape(STATIONS);
	const DECK_EDGE = 5, BULWARK = 0.2;
	const deckY = (z) => hull.point(z, DECK_EDGE)[1];
	const deckHalf = (z) => hull.point(z, DECK_EDGE)[0] - BULWARK;
	const FORE = 4.0, MAIN = -2.2;		// the masts
	const WHEEL = [0, 5.0, -6.85];
	const GUNS = [-4.6, -1.0, 2.6];
	// what stands on the deck: [x0, x1, z0, z1, height over the deck]. The masts, the hatches, the wheel, the guns
	// the guns (one a side at each of GUNS), the crow's nests (each up its mast: its floor's height), the stack of rounds, the pile of
	//		supply packs and the barrel of wood (where on the deck)
	const GUN_SPOTS = GUNS.flatMap((z) => [[z, 1], [z, -1]]);
	const NESTS = [{ name: 'Foremast', z: FORE, floor: 19.4, piece: 1 }, { name: 'Mainmast', z: MAIN, floor: 19.8, piece: 2 }];
	const SHELLS = [0.9, -3.3], PACKS = [-1.2, -6.0], BARREL = [-1.2, 0.8];
	const OBSTACLES = [
		[-0.35, 0.35, FORE - 0.35, FORE + 0.35, 9], [-0.35, 0.35, MAIN - 0.35, MAIN + 0.35, 9],
		[-0.8, 0.8, 0.0, 1.6, 0.6], [-0.6, 0.6, -5.0, -4.0, 0.7], [-0.2, 0.2, -7.15, -6.85, 1.2],
		...GUNS.flatMap((z) => [[1.6, 2.2, z - 0.3, z + 0.3, 0.7], [-2.2, -1.6, z - 0.3, z + 0.3, 0.7]]),
		[SHELLS[0] - 0.3, SHELLS[0] + 0.3, SHELLS[1] - 0.25, SHELLS[1] + 0.25, 0.5], [PACKS[0] - 0.3, PACKS[0] + 0.3, PACKS[1] - 0.3, PACKS[1] + 0.3, 0.6],
		[BARREL[0] - 0.33, BARREL[0] + 0.33, BARREL[1] - 0.33, BARREL[1] + 0.33, 0.85],
	];
	const deckHeight = (x, z) => {
		const half = deckHalf(z);
		if (!(half > 0) || Math.abs(x) > half || z < -8.8 || z > 8.4) return null;
		const deck = deckY(z);
		for (const [x0, x1, z0, z1, h] of OBSTACLES) if (x >= x0 && x <= x1 && z >= z0 && z <= z1) return deck + h;
		return deck;
	};

	// the rig
	// (the booms, along the feet of the fore and main sails, BOOMS over the deck: over the heads of whoever walks it)
	const BOOMS = { fore: 6.5, main: 6.6 };
	const FORESAIL = { tack: [0, BOOMS.fore + 0.1, 3.85], throat: [0, 13.4, 3.85], peak: [0, 16.9, -0.7], clew: [0, BOOMS.fore + 0.1, -1.5] };
	const MAINSAIL = { tack: [0, BOOMS.main + 0.1, -2.4], throat: [0, 14.9, -2.4], peak: [0, 18.9, -7.9], clew: [0, BOOMS.main + 0.1, -11.3] };
	const STAYSAIL = { tack: [0, 4.45, 8.85], head: [0, 15.5, 4.2], clew: [0, 5.2, 4.7] };
	const JIB = { tack: [0, 6.2, 15.6], head: [0, 23.5, 4.2], clew: [0, 6.3, 7.5] };
	const TOPSAIL = { yard: 18.8, foot: 14.8, head: 4.0, footHalf: 4.6 };
	const centreOf = (...points) => [0, 1, 2].map((i) => points.reduce((s, p) => s + p[i], 0) / points.length);
	const quadArea = (a, b, c, d) => {
		const pts = [a, b, c, d];
		let s = 0;
		for (let i = 0; i < 4; i++) { const p = pts[i], q = pts[(i + 1) % 4]; s += p[2] * q[1] - q[2] * p[1]; }
		return Math.abs(s) / 2;
	};
	const triArea = (a, b, c) => Math.abs((b[2] - a[2]) * (c[1] - a[1]) - (c[2] - a[2]) * (b[1] - a[1])) / 2;
	const BOW_FITTING = [2.0, 4.7, 7.4];		// the cathead the anchor hangs from

	const deckAt = (x, z, over = 0.05) => [x, deckY(z) + over, z];
	const rail = (side, z, over = 0.1) => [side * (hull.point(z, 6)[0] - 0.1), hull.point(z, 6)[1] + over, z];
	const controls = controlsOf([
		{ kind: 'halyard', sail: 0, at: deckAt(0.45, FORE, 0.4), name: 'Foresail halyard', keys: 'Scroll up to hoist · down to lower' },
		{ kind: 'halyard', sail: 2, at: deckAt(-0.45, FORE, 0.4), name: 'Staysail halyard', keys: 'Scroll up to hoist · down to lower' },
		{ kind: 'halyard', sail: 3, at: deckAt(0, FORE + 0.45, 0.4), name: 'Jib halyard', keys: 'Scroll up to hoist · down to lower' },
		{ kind: 'halyard', sail: 4, at: deckAt(0, FORE - 0.45, 0.4), name: 'Topsail halyard', keys: 'Scroll up to set · down to furl' },
		{ kind: 'halyard', sail: 1, at: deckAt(0.45, MAIN, 0.4), name: 'Mainsail halyard', keys: 'Scroll up to hoist · down to lower' },
		{ kind: 'sheet', sail: 0, at: deckAt(0, -1.2), name: 'Fore sheet', keys: 'Scroll up to haul in · down to ease out' },
		{ kind: 'sheet', sail: 1, at: [0, 4.95, -8.6], name: 'Main sheet', keys: 'Scroll up to haul in · down to ease out' },
		{ kind: 'sheet', sail: 2, at: rail(1, 3.4), name: 'Staysail sheet', keys: 'Scroll up to haul in · down to ease out' },
		{ kind: 'sheet', sail: 2, at: rail(-1, 3.4), name: 'Staysail sheet', keys: 'Scroll up to haul in · down to ease out' },
		{ kind: 'sheet', sail: 3, at: rail(1, 1.2), name: 'Jib sheet', keys: 'Scroll up to haul in · down to ease out' },
		{ kind: 'sheet', sail: 3, at: rail(-1, 1.2), name: 'Jib sheet', keys: 'Scroll up to haul in · down to ease out' },
		{ kind: 'sheet', sail: 4, at: rail(1, -0.4), name: 'Topsail braces', keys: 'Scroll up to brace up sharp · down to square away' },
		{ kind: 'sheet', sail: 4, at: rail(-1, -0.4), name: 'Topsail braces', keys: 'Scroll up to brace up sharp · down to square away' },
		{ kind: 'helm', at: WHEEL, name: 'Wheel', keys: 'F take the wheel', radius: 0.8 },
		...[-1, 1].map((side, k) => ({ kind: 'ladder', ladder: k, at: [side * 3.0, 3.2, 1.5], name: 'Boarding ladder', keys: 'F climb aboard', radius: 0.7 })),
		{ kind: 'anchor', at: BOW_FITTING, name: 'Anchor', keys: 'G let go or weigh anchor', radius: 0.6 },
		// the guns, the stores, the masts' ladders, and up in each nest its gun and the top of its ladder
		...GUN_SPOTS.map(([z, side], k) => ({ kind: 'gun', gun: k, at: [side * 1.55, deckY(z) + 1.1, z], name: 'Howitzer', keys: 'Middle click: breech · R (held): load · F man it (aim and fire)', radius: 0.45 })),
		{ kind: 'shells', at: deckAt(SHELLS[0], SHELLS[1], 0.4), name: '80mm rounds', keys: 'F take a round', radius: 0.45 },
		{ kind: 'packs', at: deckAt(PACKS[0], PACKS[1], 0.5), name: 'Supply packs', keys: 'F take a supply pack', radius: 0.5 },
		{ kind: 'barrel', at: deckAt(BARREL[0], BARREL[1], 0.85), name: 'Wood', keys: 'F take some planks', radius: 0.45 },
		...NESTS.map((n, k) => ({ kind: 'mast', mast: k, at: deckAt(0, n.z + 0.45, 1.2), name: n.name, keys: 'F climb to the crow\'s nest · R held with wood: mend her', radius: 0.5 })),
		...NESTS.map((n, k) => ({ kind: 'nestGun', nest: k, at: [0, n.floor + 1.1, n.z + 1.25], name: 'Lewis gun', keys: 'F man the gun · E with a supply pack: fill its pans', radius: 0.45 })),
		...NESTS.map((n, k) => ({ kind: 'nestDown', nest: k, at: [0, n.floor + 0.3, n.z + 0.42], name: 'Ladder', keys: 'F climb down', radius: 0.4 })),
	]);
	// (the pins and cleats are big enough to find with the crosshair on a deck that rolls)
	for (const c of controls) if (c.kind == 'halyard' || c.kind == 'sheet') c.radius = 0.3;
	const control = (kind, k) => controls.find((c) => c.kind == kind && (k === undefined || c.ladder == k)).id;
	const controlOf = (kind, key, k) => controls.find((c) => c.kind == kind && c[key] == k).id;

	const mesh = makeMesh();
	// the hull (192), its transom (11) and the keel under it (6)
	mesh.with({ material: M.HULL });
	loftHull(mesh, STATIONS);
	mesh.with({ material: M.TAR });
	const k0 = [0, 0.0, -8.9], k1 = [0, 1.2, 8.7];
	mesh.quad([0.12, k0[1], k0[2]], [0.12, k1[1], k1[2]], [0.12, k1[1] - 0.4, k1[2]], [0.12, k0[1] - 0.45, k0[2]]);
	mesh.quad([-0.12, k0[1], k0[2]], [-0.12, k0[1] - 0.45, k0[2]], [-0.12, k1[1] - 0.4, k1[2]], [-0.12, k1[1], k1[2]]);
	mesh.quad([0.12, k0[1] - 0.45, k0[2]], [0.12, k1[1] - 0.4, k1[2]], [-0.12, k1[1] - 0.4, k1[2]], [-0.12, k0[1] - 0.45, k0[2]]);
	// the deck (16), and the cap along the top of the bulwarks (32)
	mesh.with({ material: M.PLANKING });
	const edge = (i, side) => { const [x, y] = STATIONS[i][1][DECK_EDGE]; return [side * x, y, STATIONS[i][0]]; };
	for (let i = 0; i < STATIONS.length - 1; i++) mesh.quad(edge(i, 1), edge(i + 1, 1), edge(i + 1, -1), edge(i, -1));
	mesh.with({ material: M.TAR });
	const capOut = (i, side) => { const [x, y] = STATIONS[i][1][6]; return [side * x, y, STATIONS[i][0]]; };
	const capIn = (i, side) => { const [x, y] = STATIONS[i][1][6]; return [side * Math.max(x - 0.18, 0), y, STATIONS[i][0]]; };
	for (let i = 0; i < STATIONS.length - 1; i++) {
		mesh.quad(capOut(i, 1), capIn(i, 1), capIn(i + 1, 1), capOut(i + 1, 1));
		mesh.quad(capOut(i, -1), capOut(i + 1, -1), capIn(i + 1, -1), capIn(i, -1));
	}
	// the bowsprit (8), the masts and topmasts (40)
	mesh.with({ material: M.SPAR, piece: 3 });
	mesh.tube([0, 4.4, 8.4], [0, 6.35, 16.0], 0.2, 0.1, 4);
	mesh.with({ material: M.SPAR, piece: 1 });
	mesh.tube([0, deckY(FORE), FORE], [0, 19.5, FORE], 0.28, 0.2, 6);
	mesh.tube([0, 18.5, FORE], [0, 25.0, FORE], 0.14, 0.08, 4);
	mesh.with({ material: M.SPAR, piece: 2 });
	mesh.tube([0, deckY(MAIN), MAIN], [0, 21.0, MAIN], 0.3, 0.22, 6);
	mesh.tube([0, 20.0, MAIN], [0, 27.0, MAIN], 0.14, 0.08, 4);
	// the booms and the gaffs, turned with their sails (32), and the topsail's yard (8)
	mesh.with({ material: M.SPAR, group: 2, piece: 1 });
	mesh.tube([0, BOOMS.fore, FORE - 0.3], [0, BOOMS.fore, -1.6], 0.14, 0.12, 4);
	mesh.with({ material: M.SPAR, group: 2, role: ROLE.HOISTED, piece: 1 });
	mesh.tube([0, 13.5, FORE - 0.3], [0, 17.0, -0.8], 0.12, 0.09, 4);
	mesh.with({ material: M.SPAR, group: 3, piece: 2 });
	mesh.tube([0, BOOMS.main, MAIN - 0.3], [0, BOOMS.main, -11.5], 0.17, 0.13, 4);
	mesh.with({ material: M.SPAR, group: 3, role: ROLE.HOISTED, piece: 2 });
	mesh.tube([0, 15.0, MAIN - 0.3], [0, 19.0, -8.0], 0.13, 0.1, 4);
	mesh.with({ material: M.SPAR, group: 6, piece: 1 });
	mesh.tube([0, TOPSAIL.yard, FORE + TOPSAIL.head], [0, TOPSAIL.yard, FORE - TOPSAIL.head], 0.12, 0.12, 4);
	// the sails (76)
	mesh.with({ material: M.CANVAS, group: 2, role: ROLE.CLOTH, piece: 1 });
	mesh.sail(FORESAIL.tack, FORESAIL.throat, FORESAIL.clew, FORESAIL.peak, 4);
	mesh.with({ material: M.CANVAS, group: 3, role: ROLE.CLOTH, piece: 2 });
	mesh.sail(MAINSAIL.tack, MAINSAIL.throat, MAINSAIL.clew, MAINSAIL.peak, 4);
	mesh.with({ material: M.CANVAS, group: 4, role: ROLE.CLOTH, piece: 1 });
	mesh.sail(STAYSAIL.tack, STAYSAIL.head, STAYSAIL.clew, null, 4);
	mesh.with({ material: M.CANVAS, group: 5, role: ROLE.CLOTH, piece: 3 });
	mesh.sail(JIB.tack, JIB.head, JIB.clew, null, 4);
	mesh.with({ material: M.CANVAS, group: 6, role: ROLE.CLOTH, piece: 1 });
	const T = TOPSAIL;
	mesh.sail([0, T.foot, FORE + T.footHalf], [0, T.yard - 0.2, FORE + T.head], [0, T.foot, FORE - T.footHalf], [0, T.yard - 0.2, FORE - T.head], 4);
	// the ensign, flying from the main gaff's peak (2)
	mesh.with({ material: M.FLAG, group: 3, role: ROLE.HOISTED, piece: 2 });
	mesh.quad([0, 18.85, -7.95], [0, 18.85, -9.85], [0, 17.65, -9.85], [0, 17.65, -7.95]);
	// the standing rigging (72): the shrouds, the forestay, the jib stay, the stay between the masts, the bobstay
	for (const side of [1, -1]) {
		mesh.with({ material: M.WIRE, piece: 1 });
		for (const z of [FORE, FORE - 1.0]) mesh.tube(rail(side, z, -0.1), [side * 0.25, 18.5, FORE], 0.04, 0.035, 3);
		mesh.with({ material: M.WIRE, piece: 2 });
		for (const z of [MAIN, MAIN - 1.0]) mesh.tube(rail(side, z, -0.1), [side * 0.27, 20.0, MAIN], 0.04, 0.035, 3);
	}
	mesh.with({ material: M.WIRE, piece: 1 });
	mesh.tube(STAYSAIL.tack, [0, 16.0, FORE + 0.15], 0.04, 0.04, 3);
	mesh.with({ material: M.WIRE, piece: 3 });
	mesh.tube([0, 6.25, 15.8], [0, 24.0, FORE + 0.1], 0.035, 0.035, 3);
	mesh.with({ material: M.WIRE, piece: 2 });
	mesh.tube([0, 19.0, FORE - 0.1], [0, 20.5, MAIN + 0.2], 0.035, 0.035, 3);
	mesh.with({ material: M.WIRE, piece: 3 });
	mesh.tube([0, 6.25, 15.7], [0, 2.6, 8.8], 0.04, 0.04, 3);
	// the running rigging (30): the four sheets and the anchor's cable, laid where they go by the shader
	[M.ROPE_TAN, M.ROPE_TAN, M.ROPE_TAN, M.ROPE_TAN, M.ROPE_TAN].forEach((material, rope) => {
		mesh.with({ material, role: ROLE.ROPE, rope });
		mesh.tube([0, 0, 0], [0, 0, 1], rope == 4 ? 0.06 : 0.03, rope == 4 ? 0.06 : 0.03, 3);
	});
	// the hatches (20)
	mesh.with({ material: M.WOOD });
	mesh.box([-0.8, 0.8], [deckY(0.8), deckY(0.8) + 0.6], [0.0, 1.6], [2]);
	mesh.box([-0.6, 0.6], [deckY(-4.5), deckY(-4.5) + 0.7], [-5.0, -4.0], [2]);
	// the wheel: its stand (10), and the wheel itself (24), turned with the rudder
	mesh.with({ material: M.WOOD, control: control('helm') });
	mesh.box([-0.15, 0.15], [deckY(-7.0), WHEEL[1] - 0.1], [-7.1, -6.95], [2]);
	mesh.with({ material: M.WOOD, group: 1, control: control('helm') });
	const rim = (r, k) => { const a = k / 8 * Math.PI * 2; return [WHEEL[0] + Math.cos(a) * r, WHEEL[1] + Math.sin(a) * r, WHEEL[2]]; };
	for (let k = 0; k < 8; k++) mesh.quad(rim(0.55, k), rim(0.63, k), rim(0.63, k + 1), rim(0.55, k + 1));
	mesh.with({ material: M.BRASS, group: 1, control: control('helm') });
	for (let k = 0; k < 4; k++) {
		const a = k / 4 * Math.PI, c = Math.cos(a), s = Math.sin(a), w = 0.025, r = 0.78;
		mesh.quad([WHEEL[0] - c * r - s * w, WHEEL[1] - s * r + c * w, WHEEL[2] + 0.01], [WHEEL[0] + c * r - s * w, WHEEL[1] + s * r + c * w, WHEEL[2] + 0.01],
			[WHEEL[0] + c * r + s * w, WHEEL[1] + s * r - c * w, WHEEL[2] + 0.01], [WHEEL[0] - c * r + s * w, WHEEL[1] - s * r - c * w, WHEEL[2] + 0.01]);
	}
	// the rudder, hung off the sternpost (12)
	mesh.with({ material: M.TAR, group: 0 });
	mesh.box([-0.1, 0.1], [0.05, 2.9], [-10.1, -9.0]);
	// THE HOWITZERS (100 each), made pointing out over the side, level: a post on the deck; on it the yoke, turned (part 1 + 3k); in
	//		the yoke the barrel on its trunnions, raised (2 + 3k); and its breech block, sliding down out of the barrel (3 + 3k)
	const span = (a, b) => [Math.min(a, b), Math.max(a, b)];
	GUN_SPOTS.forEach(([z, side], k) => {
		const deck = deckY(z), px = side * 1.95, py = deck + 1.05, c = controlOf('gun', 'gun', k);
		mesh.with({ material: M.IRON });
		mesh.box(span(px - 0.12, px + 0.12), [deck, py - 0.17], [z - 0.12, z + 0.12], [2, 3]);
		mesh.with({ material: M.IRON, part: 1 + 3 * k, control: c });
		mesh.box(span(px - 0.22, px + 0.22), [py - 0.17, py - 0.12], [z - 0.22, z + 0.22], [2]);
		for (const s of [-1, 1]) mesh.box(span(px - 0.16, px + 0.16), [py - 0.12, py + 0.12], span(z + s * 0.16, z + s * 0.2), [2]);
		mesh.with({ material: M.DARK, part: 2 + 3 * k, control: c });
		mesh.tube([px - side * 0.35, py, z], [px + side * 1.0, py, z], 0.12, 0.085, 8);
		mesh.tube([px + side * 0.94, py, z], [px + side * 1.03, py, z], 0.105, 0.105, 8);
		mesh.tube([px, py, z - 0.21], [px, py, z + 0.21], 0.05, 0.05, 6);
		mesh.with({ material: M.BRASS, part: 3 + 3 * k, control: c });
		mesh.box(span(px - side * 0.47, px - side * 0.35), [py - 0.11, py + 0.11], [z - 0.11, z + 0.11]);
	});
	// THE STACK OF ROUNDS (144) aft of the mainmast: six standing in a low rack, their brass cases and their noses
	mesh.with({ material: M.WOOD, control: controlOf('shells', 'kind', 'shells') });
	const stackDeck = deckY(SHELLS[1]);
	mesh.box([SHELLS[0] - 0.3, SHELLS[0] + 0.3], [stackDeck, stackDeck + 0.18], [SHELLS[1] - 0.25, SHELLS[1] + 0.25], [2]);
	for (const dx of [-0.18, 0, 0.18]) for (const dz of [-0.12, 0.12]) {
		const x = SHELLS[0] + dx, z = SHELLS[1] + dz;
		mesh.with({ material: M.BRASS, control: controlOf('shells', 'kind', 'shells') });
		mesh.tube([x, stackDeck + 0.18, z], [x, stackDeck + 0.42, z], 0.042, 0.042, 6);
		mesh.with({ material: M.IRON, control: controlOf('shells', 'kind', 'shells') });
		mesh.tube([x, stackDeck + 0.42, z], [x, stackDeck + 0.52, z], 0.042, 0.006, 6);
	}
	// THE SUPPLY PACKS (48) by the wheel: a crate, and three canvas packs on and against it
	const packDeck = deckY(PACKS[1]);
	mesh.with({ material: M.WOOD, control: controlOf('packs', 'kind', 'packs') });
	mesh.box([PACKS[0] - 0.3, PACKS[0] + 0.3], [packDeck, packDeck + 0.35], [PACKS[1] - 0.3, PACKS[1] + 0.3], [2]);
	mesh.with({ material: M.CANVAS, control: controlOf('packs', 'kind', 'packs') });
	mesh.box([PACKS[0] - 0.26, PACKS[0] + 0.02], [packDeck + 0.35, packDeck + 0.58], [PACKS[1] - 0.25, PACKS[1] - 0.02], [2]);
	mesh.box([PACKS[0] + 0.0, PACKS[0] + 0.27], [packDeck + 0.35, packDeck + 0.55], [PACKS[1] + 0.0, PACKS[1] + 0.25], [2]);
	mesh.box([PACKS[0] - 0.24, PACKS[0] + 0.24], [packDeck + 0.58, packDeck + 0.74], [PACKS[1] - 0.2, PACKS[1] + 0.05], [2]);
	// THE BARREL OF WOOD (84) by the main hatch: bellied out in its middle, and the ends of the planks sticking up out of it
	const barrelDeck = deckY(BARREL[1]);
	mesh.with({ material: M.WOOD, control: controlOf('barrel', 'kind', 'barrel') });
	const hoop = (y, r) => Array.from({ length: 10 }, (_, k) => { const a = (k + 0.5) / 10 * Math.PI * 2; return [BARREL[0] + Math.cos(a) * r, y, BARREL[1] + Math.sin(a) * r]; });
	const hoops = [hoop(barrelDeck, 0.28), hoop(barrelDeck + 0.4, 0.33), hoop(barrelDeck + 0.8, 0.29)];
	for (let r = 0; r < 2; r++) for (let k = 0; k < 10; k++) mesh.quad(hoops[r][k], hoops[r][(k + 1) % 10], hoops[r + 1][(k + 1) % 10], hoops[r + 1][k]);
	for (let k = 1; k < 9; k++) mesh.tri(hoops[2][0], hoops[2][k + 1], hoops[2][k]);
	mesh.with({ material: M.SPAR, control: controlOf('barrel', 'kind', 'barrel') });
	for (const [dx, dz, h] of [[-0.1, -0.05, 1.15], [0.08, 0.1, 1.05], [0.05, -0.12, 1.2]]) mesh.box([BARREL[0] + dx - 0.03, BARREL[0] + dx + 0.03], [barrelDeck + 0.6, barrelDeck + h], [BARREL[1] + dz - 0.07, BARREL[1] + dz + 0.07], [2]);
	// THE CROW'S NESTS (60 each) up each mast: a floor and a wall round it, falling with its mast; and the ladder (86) up the front of
	//		the mast from the deck to it
	NESTS.forEach((n, k) => {
		const octagon = (r, y) => Array.from({ length: 8 }, (_, j) => { const a = (j + 0.5) / 8 * Math.PI * 2; return [Math.cos(a) * r, y, n.z + Math.sin(a) * r]; });
		mesh.with({ material: M.WOOD, piece: n.piece });
		const top = octagon(0.95, n.floor), under = octagon(0.95, n.floor - 0.12), rimOut = octagon(0.95, n.floor + 0.95), rimIn = octagon(0.88, n.floor + 0.95), inside = octagon(0.88, n.floor);
		for (let j = 0; j < 8; j++) {
			const i = (j + 1) % 8;
			mesh.quad(under[j], under[i], top[i], top[j]);
			mesh.quad(top[j], top[i], rimOut[i], rimOut[j]);
			mesh.quad(inside[j], rimIn[j], rimIn[i], inside[i]);
			mesh.quad(rimIn[j], rimOut[j], rimOut[i], rimIn[i]);
		}
		for (let j = 1; j < 7; j++) { mesh.tri(top[0], top[j], top[j + 1]); mesh.tri(under[0], under[j + 1], under[j]); }
		mesh.with({ material: M.SPAR, piece: n.piece, control: controlOf('mast', 'mast', k) });
		const foot = deckY(n.z), lz = n.z + 0.4;
		for (const s of [-1, 1]) mesh.tube([s * 0.22, foot, lz], [s * 0.22, n.floor + 1.0, lz], 0.025, 0.025, 3);
		for (let y = foot + 0.35; y < n.floor + 0.9; y += 0.4) mesh.quad([-0.22, y, lz - 0.02], [0.22, y, lz - 0.02], [0.22, y, lz + 0.02], [-0.22, y, lz + 0.02]);
	});
	// the boarding ladders, hung over each side (22 each)
	const ladderSide = 3.0, ladderZ = 1.5;
	[-1, 1].forEach((side, k) => {
		const ladderX = side * ladderSide;
		mesh.with({ material: M.ROPE_TAN, control: control('ladder', k) });
		for (const dz of [-0.25, 0.25]) mesh.tube([ladderX, 2.0, ladderZ + dz], [ladderX - side * 0.05, hull.point(ladderZ, 6)[1] + 0.05, ladderZ + dz], 0.025, 0.025, 3);
		mesh.with({ material: M.WOOD, control: control('ladder', k) });
		for (let r = 0; r < 5; r++) {
			const y = 2.2 + r * 0.5;
			mesh.quad([ladderX - 0.06, y, ladderZ - 0.27], [ladderX - 0.06, y, ladderZ + 0.27], [ladderX + 0.06, y, ladderZ + 0.27], [ladderX + 0.06, y, ladderZ - 0.27]);
		}
	});
	// the anchor, hanging at the cathead (20)
	mesh.with({ material: M.IRON, role: ROLE.STOWED, control: control('anchor') });
	const A = BOW_FITTING;
	mesh.tube([A[0] + 0.25, A[1] - 0.15, A[2]], [A[0] + 0.25, A[1] - 2.1, A[2]], 0.07, 0.07, 4);
	mesh.tube([A[0] + 0.25, A[1] - 0.35, A[2] - 0.7], [A[0] + 0.25, A[1] - 0.35, A[2] + 0.7], 0.05, 0.05, 4);
	mesh.tri([A[0] + 0.25, A[1] - 2.1, A[2]], [A[0] + 0.25, A[1] - 1.5, A[2] - 0.6], [A[0] + 0.25, A[1] - 1.8, A[2] - 0.2]);
	mesh.tri([A[0] + 0.25, A[1] - 2.1, A[2]], [A[0] + 0.25, A[1] - 1.8, A[2] + 0.2], [A[0] + 0.25, A[1] - 1.5, A[2] + 0.6]);
	mesh.tri([A[0] + 0.25, A[1] - 2.1, A[2]], [A[0] + 0.25, A[1] - 1.9, A[2] - 0.15], [A[0] + 0.25, A[1] - 1.9, A[2] + 0.15]);
	mesh.tri([A[0] + 0.25, A[1] - 1.5, A[2] - 0.6], [A[0] + 0.25, A[1] - 1.5, A[2] + 0.6], [A[0] + 0.25, A[1] - 1.75, A[2]]);
	// the pins the halyards are made fast to, and the blocks and cleats of the sheets and braces (52)
	for (const c of controls) if (c.kind == 'halyard' || c.kind == 'sheet') { mesh.with({ material: M.CLEAT, control: c.id }); mesh.cleat(c.at, 2.5); }
	// the stern lantern (6)
	mesh.with({ material: M.LAMP });
	mesh.box([-0.12, 0.12], [5.0, 5.45], [-9.0, -8.76], [2, 4, 5]);

	// the water asked about under it: 8 stations, each side, and the forefoot (17). Each as wide as the hull is between the water and a
	//		metre over it (the bow flares out above the water: pushed under, it holds her up), and holding her up as far as the deck
	const columns = [];
	for (const z of [-7.6, -5.6, -3.6, -1.6, 0.4, 2.4, 4.4, 6.4]) {
		const half = (hull.widthAt(z, 2.6) + hull.widthAt(z, 3.6)) / 2;
		for (const side of [1, -1]) columns.push({ x: side * half * 0.55, z, bottom: hull.keel(z) + 0.25, area: half * 2.0 * 0.95, top: deckY(z) });
	}
	columns.push({ x: 0, z: 8.0, bottom: hull.keel(8.0) + 0.6, area: 3.0, top: deckY(8.0) });

	const ring = [];
	for (const z of [-8.5, -5.5, -2.5, 0.5, 3.5, 6.5]) for (const side of [1, -1]) ring.push([side * hull.widthAt(z, 3.0) * 0.97, 3.0, z]);
	ring.push([0, 3.4, 8.9], [0, 6.2, 15.6], [0, BOOMS.main, -11.3], [0, 1.0, -9.5]);

	const sailCentre = (...p) => centreOf(...p);
	return {
		name: 'Schooner', mesh: mesh.done(),
		health: 160, sinkSeconds: 30,
		// the howitzers: which side, where each turns and is raised about, where its gunner sits and looks from, its barrel's length
		//		out from its pivot, and its first part (the yoke; the barrel and the breech next); its control
		guns: GUN_SPOTS.map(([z, side], k) => ({ side, z, pivot: [side * 1.95, deckY(z) + 1.05, z], seat: [side * 0.95, deckY(z), z], eye: [side * 0.9, deckY(z) + 1.5, z],
			muzzle: 1.03, part: 1 + 3 * k, control: controlOf('gun', 'gun', k) })),
		// the crow's nests: where the walker stands in each (at the top of its ladder), its Lewis gun's pivot and its parts (the gun,
		//		then its pan), which piece it falls with, the foot of its ladder on the deck; its controls
		nests: NESTS.map((n, k) => ({ name: n.name, z: n.z, floor: n.floor, piece: n.piece, stand: [0, n.floor, n.z + 0.6], pivot: [0, n.floor + 1.1, n.z + 0.6],
			eye: [0, n.floor + 1.5, n.z + 0.75], part: 19 + 2 * k, foot: [0, deckY(n.z), n.z + 0.65], climb: 7.5,
			control: controlOf('nestGun', 'nest', k), mast: controlOf('mast', 'mast', k), down: controlOf('nestDown', 'nest', k) })),
		pieces: [{ foot: [0, deckY(FORE), FORE], height: 25 }, { foot: [0, deckY(MAIN), MAIN], height: 27 }, { foot: [0, 4.4, 8.4], height: 8 }],
		halfBreadth: (z) => z < -8.8 || z > 8.4 ? 0 : hull.halfBreadth(z), sheerHeight: hull.sheer, deckHeight,
		mass: 90000, centre: [0, 2.1, -2.0], inertia: [2.3e6, 2.3e6, 6.0e5],	// (her weight a little aft of where she floats from: she trims down by the stern)
		columns, vDepth: 1.8, columnTop: 3.8, heaveDamping: 1500,
		hullDrag: { linear: 200, quadratic: 300, hullSpeed: 5.2, wave: 8000 }, slip: { linear: 8000, quadratic: 15000 },
		keel: { at: [0, 1.0, 0.5], area: 18 },
		rudder: { at: [0, 1.2, -9.6], area: 4.0, scull: 2.5, most: 0.6, seconds: 3.0 },
		damping: { yaw: [1e5, 3e5, 4e5], roll: 4e5, pitch: 1.5e6 },
		heelLimit: 0.6, heelStiffness: 6e6, heelDamping: 4e5, pitchLimit: 0.35, pitchStiffness: 2e7,
		groups: [
			{ kind: 'rudder', pivot: [0, 0, -9.0], axis: [0, 1, 0] },
			{ kind: 'wheel', pivot: WHEEL, axis: [0, 0, 1], turns: 4 },
			{ kind: 'sail', sail: 0, pivot: [0, 0, FORE], axis: [0, 1, 0], mode: 0, ref: [0, BOOMS.fore + 0.1, 0], chord: 5.3, taper: 0.1 },
			{ kind: 'sail', sail: 1, pivot: [0, 0, MAIN], axis: [0, 1, 0], mode: 0, ref: [0, BOOMS.main + 0.1, 0], chord: 8.5, taper: 0.35 },
			{ kind: 'sail', sail: 2, pivot: STAYSAIL.tack, axis: STAYSAIL.head.map((v, i) => v - STAYSAIL.tack[i]), mode: 1, ref: STAYSAIL.tack, chord: 4.4, taper: 0.9 },
			{ kind: 'sail', sail: 3, pivot: JIB.tack, axis: JIB.head.map((v, i) => v - JIB.tack[i]), mode: 1, ref: JIB.tack, chord: 8.0, taper: 0.9 },
			{ kind: 'sail', sail: 4, pivot: [0, 0, FORE], axis: [0, 1, 0], mode: 2, ref: [0, T.yard, 0], chord: 8.6, taper: 0 },
		],
		sails: [
			{ name: 'Foresail', group: 2, area: quadArea(FORESAIL.tack, FORESAIL.throat, FORESAIL.peak, FORESAIL.clew), eased: 1.4, hauled: 0.1, centre: sailCentre(FORESAIL.tack, FORESAIL.throat, FORESAIL.peak, FORESAIL.clew), start: { hoist: 1, sheet: 0 } },
			{ name: 'Mainsail', group: 3, area: quadArea(MAINSAIL.tack, MAINSAIL.throat, MAINSAIL.peak, MAINSAIL.clew), eased: 1.4, hauled: 0.08, centre: sailCentre(MAINSAIL.tack, MAINSAIL.throat, MAINSAIL.peak, MAINSAIL.clew), start: { hoist: 1, sheet: 0 } },
			{ name: 'Staysail', group: 4, area: triArea(STAYSAIL.tack, STAYSAIL.head, STAYSAIL.clew), eased: 1.1, hauled: 0.2, centre: sailCentre(STAYSAIL.tack, STAYSAIL.head, STAYSAIL.clew), start: { hoist: 1, sheet: 0 } },
			{ name: 'Jib', group: 5, area: triArea(JIB.tack, JIB.head, JIB.clew), eased: 1.1, hauled: 0.18, centre: sailCentre(JIB.tack, JIB.head, JIB.clew), start: { hoist: 1, sheet: 0 } },
			{ name: 'Topsail', group: 6, area: (2 * T.head + 2 * T.footHalf) / 2 * (T.yard - 0.2 - T.foot), eased: Math.PI / 2, hauled: 0.8, fixed: true,
				centre: [0, (T.yard + T.foot) / 2, FORE], start: { hoist: 0, sheet: 0 } },
		],
		mainSail: 1, halyardSeconds: 12, sheetSeconds: 6,
		ropes: [
			{ from: [0, BOOMS.fore, -1.6], group: 2, role: ROLE.RIGID, to: [deckAt(0, -1.2)], sag: 0.1 },
			{ from: [0, BOOMS.main, -11.3], group: 3, role: ROLE.RIGID, to: [[0, 4.95, -8.6]], sag: 0.1 },
			{ from: STAYSAIL.clew, group: 4, role: ROLE.CLOTH, to: [rail(1, 3.4), rail(-1, 3.4)], sag: 0.15 },
			{ from: JIB.clew, group: 5, role: ROLE.CLOTH, to: [rail(1, 1.2), rail(-1, 1.2)], sag: 0.25 },
			{ rode: true, sag: 2.0 },
		],
		controls,
		helm: { at: [0, deckY(-7.6), -7.6], eye: 1.65, seated: false, hike: false, standAt: [0, deckY(-7.6), -7.6], tiller: 'wheel' },
		ladders: [-1, 1].map((side, k) => ({ x: side * ladderSide, z: ladderZ, top: hull.point(ladderZ, 6)[1], foot: [side * (ladderSide + 0.45), 1.4, ladderZ], over: [side * (ladderSide - 0.2), hull.point(ladderZ, 6)[1] + 0.3, ladderZ],
			inside: [side * 2.2, deckY(ladderZ), ladderZ], seconds: 3.0, control: control('ladder', k) })),
		reach: 17, footprint: [-9.0, -6.0, -3.0, 0, 3.0, 6.0, 8.5],
		bow: BOW_FITTING, anchor: { rode: 120, stiffness: 2e5, damping: 2.7e5, most: 3e5 },
		groundPoints: [[0, 0, -8.5], [0, 0.15, -4.5], [0, 0.35, 0], [0, 0.65, 4.5], [0, 1.6, 8.8], [0, 0.05, -10.0]],
		groundGrip: { stiffness: 3e7, damping: 1.5e6, friction: 1e6 }, rockStiffness: 2e7, rockDamping: 1e6, rockReach: 40,
		hullRing: ring,
		paint: { top: [0.05, 0.05, 0.06], band: [0.78, 0.6, 0.24], bandY: [3.95, 4.42], bottom: [0.6, 0.36, 0.22], bottomY: 2.65, inside: [0.5, 0.17, 0.11], ports: { z0: GUNS[0], spacing: GUNS[1] - GUNS[0], count: GUNS.length, half: 0.3 } },
		spawn: { depth: 9, clear: 60, clearDepth: 5, draft: 2.6, keel: 3.1 },
	};
}

export const VESSELS = { Dinghy: dinghy(), Schooner: schooner() };
export const VESSEL_NAMES = Object.keys(VESSELS);
for (const vessel of Object.values(VESSELS)) vessel.triangles = vessel.mesh.length / 12 / 3;
