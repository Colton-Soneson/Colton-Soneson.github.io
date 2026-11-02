import * as vm from './viewmodel.js'

/*
	THE MODELS of what lives and what catches it, drawn by props.js (the materials are f_itemMaterials.js's), in metres, each with its head to +z:
		rabbit		under 70 triangles; rabbitDead the same, on its side (rabbits.js)
		trap		the snare, under 90 triangles: a stake, a bent sapling and its loop of sinew; trapSprung the sapling up and a dead rabbit hanging from it, under 90
		antlersCut, sinewCoil, rabbitPelt, smallBones: lying on the ground
		fish		six kinds (fish.js), each under 40 triangles
		whale		16 metres, 800 triangles at the most; whaleStage1 to 4, what is left of one as it is cut up at a ship's side: blubber off in strips, the flesh,
					the ribs showing, and at the last only bones (whaling.js)
		harpoonGun, harpoonBarrel, harpoon, cable (a unit long, a unit round: stretched between two points), shipChest: the schooner's whaling gear
		crownCover	a tree's crown as the sky sees it, a unit tall and a unit round (skyCover.js)
		moose, wolf, bear	each under 450 triangles, standing on y = 0 (beasts.js). Their parts walk them (vf_props.js: the hips, knees and necks there are these): 0 the body, 1 the neck and head, 2 to 5 the legs (left front, right front, left hind, right hind)
		flareSpark, flareBall	a flare climbing, and burning (flares.js)
		catTabby, catBlack, rat	the towns' (critters.js): a cat under 200 triangles, a rat under 50. Their parts walk them as the beasts' do (vf_props.js: RIGS): 1 the head, 2 to 5 the legs
*/
const COAT = 63, BELLY = 64, BONE = 65, WHALE_BACK = 66, WHALE_BELLY = 67, FLESH = 68, BLUBBER = 69, ANTLER = 70, IRON = 73, BOARDS = 30, HANDLE = 34, ROPE = 35, BRASS = 2, DARK = 9;
const INK = 43;

// a ring of corners round z at (cx, cy): rx across, ry up
const ringZ = (z, rx, ry, n, cy = 0, cx = 0) => Array.from({ length: n }, (_, k) => { const a = (k + 0.5) / n * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z]; });

//-------------------------------THE RABBIT-------------------------------
function rabbit() {
	const m = vm.meshBuilder();
	// the body: rump to chest (30 + 3), the head (8 + 4), the ears (4), the tail (2), the hind legs (12) and the front ones (4)
	m.loft([ringZ(-0.13, 0.05, 0.06, 5, 0.1), ringZ(-0.08, 0.075, 0.085, 5, 0.12), ringZ(0.03, 0.065, 0.075, 5, 0.12), ringZ(0.1, 0.045, 0.06, 5, 0.14)], COAT, 0, [0]);
	m.loft([ringZ(0.09, 0.04, 0.045, 4, 0.18), ringZ(0.19, 0.016, 0.02, 4, 0.17)], COAT, 0, [0, 1]);
	for (const s of [-1, 1]) {
		m.quad([s * 0.012, 0.21, 0.12], [s * 0.035, 0.21, 0.1], [s * 0.05, 0.33, 0.06], [s * 0.028, 0.33, 0.075], 0, COAT);
		m.strut([s * 0.055, 0.1, -0.07], [s * 0.06, 0.005, 0.03], 0.03, 0.012, 3, COAT);
		m.quad([s * 0.035 - 0.012, 0.09, 0.08], [s * 0.035 + 0.012, 0.09, 0.08], [s * 0.035 + 0.01, 0, 0.1], [s * 0.035 - 0.01, 0, 0.1], 0, COAT);
	}
	m.quad([-0.022, 0.15, -0.135], [0.022, 0.15, -0.135], [0.022, 0.09, -0.165], [-0.022, 0.09, -0.165], 0, BELLY);
	return m;
}
// dead, on its side, or hanging by the neck from where it is at
function rabbitDeadBody(m, at = [0, 0, 0], hang = false) {
	const P = (x, y, z) => hang ? [at[0] + y - 0.05, at[1] - z - 0.17, at[2] + x] : [at[0] + y - 0.05, at[1] + x + 0.06, at[2] + z];
	const ring = (z, r) => [0, 1, 2, 3].map((k) => { const a = (k + 0.5) / 4 * Math.PI * 2; return P(Math.cos(a) * r, 0.05 + Math.sin(a) * r, z); });
	m.loft([ring(-0.13, 0.045), ring(-0.03, 0.065), ring(0.1, 0.042), ring(0.17, 0.018)], COAT, 0, [0, 1]);
	for (const s of [-1, 1]) m.tri(P(s * 0.015, 0.09, 0.14), P(s * 0.015, 0.09, 0.12), P(s * 0.02, 0.1, 0.27), 0, COAT);
	m.tri(P(0, 0.04, -0.13), P(0.03, 0.06, -0.13), P(0.015, 0.05, -0.17), 0, BELLY);
	return m;
}
const rabbitDead = () => rabbitDeadBody(vm.meshBuilder());

//-------------------------------THE SNARE-------------------------------
function trapBase(m) {
	// a stake (6), the sapling's foot (6), the trigger stick (6), the short log under it all (8)
	m.strut([0.16, 0, 0], [0.16, 0.34, 0.02], 0.016, 0.011, 3, HANDLE);
	m.strut([-0.28, 0, -0.04], [-0.26, 0.26, -0.03], 0.02, 0.015, 3, HANDLE);
	m.strut([0.16, 0.2, 0.01], [-0.02, 0.17, 0.02], 0.007, 0.006, 3, BOARDS);
	m.tube(0, 0.03, -0.16, 0.03, 0.16, 0.028, 4, BOARDS, 0, []);
}
function trap() {
	const m = vm.meshBuilder();
	trapBase(m);
	// the sapling bent down over it (12), the line (2) and the loop of sinew standing open on the ground (12)
	m.strut([-0.26, 0.26, -0.03], [-0.1, 0.5, -0.01], 0.015, 0.011, 3, HANDLE);
	m.strut([-0.1, 0.5, -0.01], [0.13, 0.42, 0.01], 0.011, 0.006, 3, HANDLE);
	m.quad([0.125, 0.42, 0.01], [0.135, 0.42, 0.01], [0.0, 0.16, 0.025], [-0.01, 0.16, 0.025], 0, ROPE);
	const ring = (r) => Array.from({ length: 6 }, (_, k) => { const a = k / 6 * Math.PI * 2; return [-0.02 + Math.cos(a) * r, 0.13 + Math.sin(a) * r * 0.9, 0.03]; });
	m.loft([ring(0.1), ring(0.085)], ROPE, 0);
	return m;
}
function trapSprung() {
	const m = vm.meshBuilder();
	trapBase(m);
	// the sapling sprung up straight (6), the line hanging from it (2), and the rabbit in the loop
	m.strut([-0.26, 0.26, -0.03], [-0.17, 0.82, 0.0], 0.015, 0.007, 3, HANDLE);
	m.quad([-0.175, 0.82, 0.0], [-0.165, 0.82, 0.0], [-0.1, 0.56, 0.0], [-0.11, 0.56, 0.0], 0, ROPE);
	rabbitDeadBody(m, [-0.05, 0.58, 0.0], true);
	return m;
}

//-------------------------------WHAT COMES OFF THEM-------------------------------
function antlersCut() {
	const m = vm.meshBuilder();
	for (const s of [-1, 1]) {
		const a = [s * 0.02, 0.04, 0], b = [s * 0.17, 0.05, 0.1], c = [s * 0.26, 0.05, 0.26], d = [s * 0.2, 0.05, 0.42];
		m.strut(a, b, 0.018, 0.015, 3, ANTLER); m.strut(b, c, 0.015, 0.012, 3, ANTLER); m.strut(c, d, 0.012, 0.004, 3, ANTLER);
		m.strut(b, [s * 0.1, 0.05, 0.23], 0.012, 0.003, 3, ANTLER);
		m.strut(c, [s * 0.36, 0.05, 0.36], 0.01, 0.003, 3, ANTLER);
	}
	return m;
}
function sinewCoil() {
	const m = vm.meshBuilder();
	const ring = (r, y) => Array.from({ length: 8 }, (_, k) => { const a = k / 8 * Math.PI * 2; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
	m.loft([ring(0.05, 0.005), ring(0.065, 0.02), ring(0.05, 0.035), ring(0.035, 0.02), ring(0.05, 0.005)], ROPE, 0);
	return m;
}
function rabbitPelt() {
	const m = vm.meshBuilder();
	m.prismX([[-0.16, 0], [-0.12, 0.07], [0.02, 0.09], [0.15, 0.04], [0.17, 0], [0.15, -0.04], [0.02, -0.09], [-0.12, -0.07]], -0.004, 0.004, COAT);
	return m;
}
function smallBones() {
	const m = vm.meshBuilder();
	for (const [a, b] of [[[-0.08, 0.01, -0.03], [0.08, 0.01, 0.03]], [[-0.05, 0.015, 0.05], [0.07, 0.015, -0.04]], [[0, 0.02, -0.07], [0.02, 0.02, 0.07]]]) m.strut(a, b, 0.007, 0.007, 3, BONE);
	return m;
}

//-------------------------------THE FISH-------------------------------
// a fish: length L, as high as h and as wide as w at its thickest, its tail forked wide by tail, a fin on its back as high as fin.
//		(Rings of 4: 24, closed at nose and tail: 4, its tail: 2, its back fin: 1, its side fins: 2): under 40
function fish(L, h, w, tail, fin, material, deep = 0.6) {
	const m = vm.meshBuilder();
	const ring = (t, s) => ringZ(L * (t - 0.5), w * s, h * s, 4);
	m.loft([ring(1, 0.12), ring(deep, 1), ring(0.32, 0.72), ring(0.08, 0.14)], material, 0, [0, 1]);
	const z = -L * 0.42;
	m.tri([0, 0, z], [0, tail * h * 1.4, -L * 0.58], [0, -tail * h * 1.4, -L * 0.58], 0, material);
	m.tri([0, tail * h * 1.4, -L * 0.58], [0, 0, -L * 0.5], [0, -tail * h * 1.4, -L * 0.58], 0, material);
	m.tri([0, h * 0.9, L * 0.1], [0, h * 0.8, -L * 0.14], [0, h * (0.8 + fin), -L * 0.08], 0, material);
	m.tri([w * 0.8, -h * 0.3, L * 0.14], [w * 0.8, -h * 0.5, L * 0.02], [w * 2, -h * 0.9, -L * 0.02], 0, material);
	m.tri([-w * 0.8, -h * 0.3, L * 0.14], [-w * 0.8, -h * 0.5, L * 0.02], [-w * 2, -h * 0.9, -L * 0.02], 0, material);
	return m;
}
const FISH_MODELS = {
	fishTrout: () => fish(0.36, 0.045, 0.024, 0.8, 0.5, 74), fishCarp: () => fish(0.5, 0.09, 0.05, 0.8, 0.9, 75, 0.56),
	fishHerring: () => fish(0.26, 0.032, 0.014, 1.2, 0.5, 76), fishMackerel: () => fish(0.36, 0.036, 0.022, 1.4, 0.8, 77),
	fishCod: () => fish(0.75, 0.09, 0.07, 0.7, 0.6, 78, 0.65), fishTuna: () => fish(1.5, 0.18, 0.14, 1.8, 1.0, 79, 0.56),
};

//-------------------------------THE WHALE-------------------------------
// the body's rings, nose to tail: [z, half its width, half its height, how high its middle is]
const WHALE_RINGS = [[8.0, 0.25, 0.22, 0], [7.5, 0.6, 0.55, 0.02], [6.8, 0.95, 0.9, 0.04], [6.0, 1.25, 1.2, 0.05], [5.0, 1.5, 1.45, 0.05], [4.0, 1.65, 1.6, 0.04], [3.0, 1.72, 1.68, 0.03], [2.0, 1.75, 1.72, 0.02],
	[1.0, 1.72, 1.7, 0.02], [0, 1.65, 1.62, 0.02], [-1.0, 1.52, 1.5, 0.02], [-2.0, 1.36, 1.35, 0.03], [-3.0, 1.15, 1.15, 0.05], [-4.0, 0.92, 0.93, 0.08], [-4.8, 0.72, 0.74, 0.1], [-5.5, 0.54, 0.58, 0.12],
	[-6.1, 0.4, 0.44, 0.13], [-6.6, 0.28, 0.32, 0.13], [-7.0, 0.2, 0.22, 0.12], [-7.35, 0.13, 0.14, 0.1], [-7.6, 0.08, 0.08, 0.08]];
const SIDES = 16;
const BELLY_SIDES = [8, 9, 10, 11, 12, 13, 14, 15], BACK_SIDES = [0, 1, 2, 3, 4, 5, 6, 7];		// (corner k is at k + 0.5 of 16 round from +x, up first: the first eight are its back)
const NO_SIDES = Array.from({ length: SIDES }, (_, k) => k);
// the body from where it starts to where it stops (rings), shrunk by shrink, its back and its belly each of what they are made of (by where along it, z)
function whaleBody(m, { shrink = () => 1, back = () => WHALE_BACK, belly = () => WHALE_BELLY, from = 0, to = WHALE_RINGS.length - 1, caps = true } = {}) {
	const rings = WHALE_RINGS.slice(from, to + 1).map(([z, w, h, y]) => ringZ(z, w * shrink(z), h * shrink(z), SIDES, y));
	for (let i = 0; i < rings.length - 1; i++) {
		const z = WHALE_RINGS[from + i][0], two = [rings[i], rings[i + 1]];
		m.loft(two, back(z), 0, [], BELLY_SIDES);
		m.loft(two, belly(z), 0, [], BACK_SIDES);
	}
	if (caps) { m.loft([rings[0], rings[0]], WHALE_BELLY, 0, [0], NO_SIDES); m.loft([rings[rings.length - 1], rings[rings.length - 1]], WHALE_BACK, 0, [1], NO_SIDES); }
}
function whaleFins(m, material = WHALE_BACK) {
	// the flukes (20 each), the flippers (20 each), the little fin on its back (8)
	for (const s of [-1, 1]) {
		m.loft([[[s * 0.02, 0.1, -7.2], [s * 0.1, 0.13, -7.2], [s * 2.0, 0.1, -8.2], [s * 2.3, 0.05, -8.1], [s * 0.8, 0.03, -7.7], [s * 0.02, 0.03, -7.65]], [[s * 0.02, 0.1, -7.2], [s * 0.1, 0.08, -7.2], [s * 2.0, 0.07, -8.2], [s * 2.3, 0.02, -8.1], [s * 0.8, 0.0, -7.7], [s * 0.02, 0.0, -7.65]]], material, 0, [0, 1]);
		m.loft([[[s * 1.5, -0.6, 3.9], [s * 1.5, -0.4, 3.1], [s * 3.2, -1.3, 2.3], [s * 3.6, -1.5, 2.6], [s * 3.0, -1.4, 3.3], [s * 2.0, -0.9, 3.9]], [[s * 1.5, -0.75, 3.9], [s * 1.5, -0.55, 3.1], [s * 3.2, -1.4, 2.3], [s * 3.6, -1.6, 2.6], [s * 3.0, -1.5, 3.3], [s * 2.0, -1.05, 3.9]]], material, 0, [0, 1]);
	}
	m.loft([[[0, 0.8, -3.2], [0.12, 0.8, -3.9], [0, 1.45, -4.3]], [[0, 0.7, -3.2], [-0.12, 0.7, -3.9], [0, 1.45, -4.3]]], material, 0, [0, 1]);
}
const whaleEyes = (m) => { for (const s of [-1, 1]) m.ball([s * 1.3, 0.05, 5.9], 0.1, 5, INK); };
function whale() {
	const m = vm.meshBuilder();
	whaleBody(m);
	whaleFins(m);
	whaleEyes(m);
	return m;
}
// (stage 1: long strips of blubber cut away along its back)
function whaleStage1() {
	const m = vm.meshBuilder();
	whaleBody(m, { back: (z) => Math.sin(z * 1.6) > 0 ? BLUBBER : WHALE_BACK });
	whaleFins(m);
	whaleEyes(m);
	return m;
}
// (stage 2: the blubber off the most of it, the flesh showing, thinner)
function whaleStage2() {
	const m = vm.meshBuilder();
	whaleBody(m, { shrink: (z) => z > 4 || z < -5 ? 0.95 : 0.84, back: (z) => z > 5 ? WHALE_BACK : Math.sin(z * 2.3) > -0.3 ? FLESH : BLUBBER, belly: (z) => z > 5 ? WHALE_BELLY : BLUBBER });
	whaleFins(m);
	return m;
}
// the spine (a square tube, joint by joint), the skull, the jaws
function skeleton(m) {
	const spine = WHALE_RINGS.filter((_, k) => k % 2 == 0).map(([z, , , y]) => [0, y + 0.35, z]);
	for (let k = 0; k < spine.length - 1; k++) m.strut(spine[k], spine[k + 1], 0.2 * (1 - k * 0.08), 0.2 * (1 - (k + 1) * 0.08), 4, BONE);
	m.loft([ringZ(7.9, 0.2, 0.12, 6, 0.1), ringZ(6.2, 0.75, 0.32, 6, 0.3), ringZ(4.9, 0.55, 0.45, 6, 0.3)], BONE, 0, [0, 1]);
	for (const s of [-1, 1]) m.strut([s * 0.7, 0.1, 6.3], [s * 0.2, -0.45, 7.9], 0.1, 0.05, 3, BONE);
}
function ribs(m, count, material = BONE) {
	for (let k = 0; k < count; k++) {
		const z = 4.2 - k * 0.62, f = Math.sin((k + 2) / (count + 2) * Math.PI);
		for (const s of [-1, 1]) {
			const a = [s * 0.12, 0.35, z], b = [s * 1.45 * f, 0.15, z - 0.1], c = [s * 1.2 * f, -1.1 * f, z - 0.2];
			m.strut(a, b, 0.07, 0.06, 3, material);
			m.strut(b, c, 0.06, 0.035, 3, material);
		}
	}
}
// (stage 3: only scraps of flesh on the ribs)
function whaleStage3() {
	const m = vm.meshBuilder();
	skeleton(m);
	ribs(m, 11);
	whaleBody(m, { from: 11, to: 17, shrink: () => 0.6, back: () => FLESH, belly: () => BLUBBER, caps: false });
	for (const s of [-1, 1]) m.strut([s * 0.25, 0.1, -7.2], [s * 1.8, 0.05, -7.9], 0.05, 0.02, 3, BONE);
	return m;
}
// (stage 4: just bones)
function whaleStage4() {
	const m = vm.meshBuilder();
	skeleton(m);
	ribs(m, 12);
	for (const s of [-1, 1]) {
		m.strut([s * 0.25, 0.1, -7.2], [s * 1.8, 0.05, -7.9], 0.05, 0.02, 3, BONE);
		m.strut([s * 1.4, -0.3, 3.8], [s * 3.2, -1.3, 2.7], 0.06, 0.03, 3, BONE);
	}
	return m;
}
export const WHALE_STAGES = ['whaleStage1', 'whaleStage2', 'whaleStage3', 'whaleStage4'];

//-------------------------------THE WHALING GEAR-------------------------------
// where it stands on the rail: a pedestal for the barrel to swing on
function harpoonGun() {
	const m = vm.meshBuilder();
	m.strut([0, 0, 0], [0, 0.85, 0], 0.11, 0.07, 6, IRON);
	m.strut([0, 0, 0], [0, 0.06, 0], 0.2, 0.2, 6, DARK);
	return m;
}
// turning about its own origin, its muzzle to +z, with its handles behind
function harpoonBarrel() {
	const m = vm.meshBuilder();
	m.tube(0, 0, -0.45, 0.06, 0.55, 0.05, 8, IRON, 0, [0, 1]);
	m.tube(0, 0, 0.46, 0.065, 0.55, 0.065, 8, BRASS, 0);
	m.strut([0, 0, -0.45], [0, -0.14, -0.7], 0.018, 0.018, 4, HANDLE);
	m.strut([-0.15, -0.14, -0.7], [0.15, -0.14, -0.7], 0.018, 0.018, 4, HANDLE);
	return m;
}
// its point at +z: the shaft, the head, two barbs
function harpoon() {
	const m = vm.meshBuilder();
	m.strut([0, 0, -0.9], [0, 0, 0.5], 0.018, 0.016, 5, HANDLE);
	m.strut([0, 0, 0.5], [0, 0, 0.9], 0.045, 0.002, 6, IRON);
	for (const s of [-1, 1]) m.tri([0, 0, 0.72], [0, 0, 0.5], [s * 0.1, 0, 0.45], 0, IRON);
	return m;
}
function cable() {
	const m = vm.meshBuilder();
	m.tube(0, 0, 0, 1, 1, 1, 4, ROPE, 0, []);
	return m;
}
function shipChest() {
	const m = vm.meshBuilder();
	m.section(-0.35, [0.55, 0, 0.5], 0.35, [0.55, 0, 0.5], BOARDS, 0, [0, 1]);
	m.section(-0.36, [0.56, 0.5, 0.62], 0.36, [0.56, 0.5, 0.62], HANDLE, 0, [0, 1]);
	return m;
}
function crownCover() {
	const m = vm.meshBuilder();
	const ring = (y, r) => Array.from({ length: 6 }, (_, k) => { const a = k / 6 * Math.PI * 2; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
	m.loft([ring(0, 0.85), ring(0.35, 1), ring(1, 0.1)], BOARDS, 0, [0, 1]);
	return m;
}

//-------------------------------THE BEASTS-------------------------------
// the body in rings along z (each [z, half its width, its bottom, its top]), a neck and a head up from it in rings of [y, z, half its width, half its height], its legs, in the part the rig wants them
function quadruped(m, { body, neck, head, legs, material, foot = material, ears = [] }) {
	const across = (z, w, a, b, n) => Array.from({ length: n }, (_, k) => { const t = (k + 0.5) / n * Math.PI * 2; return [Math.cos(t) * w, (a + b) / 2 + Math.sin(t) * (b - a) / 2, z]; });
	m.loft(body.map(([z, w, a, b]) => across(z, w, a, b, 8)), material, 0, [0, 1]);
	const tipped = (y, z, w, h) => Array.from({ length: 6 }, (_, k) => { const t = (k + 0.5) / 6 * Math.PI * 2; return [Math.cos(t) * w, y + Math.sin(t) * h, z + Math.sin(t) * h * 0.25]; });
	m.loft(neck.map(([y, z, w, h]) => tipped(y, z, w, h)), material, 1);
	m.loft(head.map(([y, z, w, h]) => tipped(y, z, w, h)), material, 1, [0, 1]);
	for (const [a, b, c] of ears) for (const s of [-1, 1]) { m.tri([s * a[0], a[1], a[2]], [s * b[0], b[1], b[2]], [s * c[0], c[1], c[2]], 1, material); m.tri([s * a[0], a[1], a[2]], [s * c[0], c[1], c[2]], [s * b[0], b[1], b[2]], 1, material); }
	legs.forEach(([x, z, rings], k) => {
		const ring = ([y, w, d, off = 0]) => [[x - w, y, z - d + off], [x + w, y, z - d + off], [x + w, y, z + d + off], [x - w, y, z + d + off]];
		m.loft(rings.map(ring), k < 0 ? material : material, 2 + k);
		m.loft([ring(rings[rings.length - 2]), ring(rings[rings.length - 1])], foot, 2 + k);
	});
}
const legsOf = (x, front, hind, top, knee, low) => [[-x, front, top], [x, front, top], [-x, hind, knee], [x, hind, knee]].map(([a, z, r]) => [a, z, r ?? low]);
function moose() {
	const m = vm.meshBuilder(), M = 80;
	const front = [[1.3, 0.1, 0.17], [0.66, 0.05, 0.075], [0.28, 0.035, 0.045, 0.01], [0.07, 0.042, 0.055, 0.02], [0, 0.05, 0.07, 0.03]], hind = [[1.28, 0.11, 0.24], [0.68, 0.05, 0.08, -0.03], [0.3, 0.036, 0.045, 0.01], [0.07, 0.042, 0.055, 0.02], [0, 0.05, 0.07, 0.03]];
	quadruped(m, { material: M, foot: DARK,
		body: [[-1.08, 0.08, 1.35, 1.5], [-0.96, 0.24, 1.14, 1.66], [-0.55, 0.32, 1.0, 1.74], [-0.05, 0.34, 0.98, 1.82], [0.42, 0.36, 0.96, 2.0], [0.8, 0.3, 1.04, 2.04], [1.02, 0.14, 1.32, 1.92]],
		neck: [[1.6, 0.86, 0.17, 0.27], [1.8, 1.04, 0.13, 0.2], [1.95, 1.2, 0.11, 0.15], [2.02, 1.32, 0.1, 0.13]],
		head: [[2.1, 1.28, 0.1, 0.13], [2.06, 1.46, 0.12, 0.15], [1.94, 1.68, 0.1, 0.13], [1.82, 1.86, 0.1, 0.1], [1.74, 1.98, 0.075, 0.07]],
		ears: [[[0.08, 2.2, 1.28], [0.1, 2.15, 1.2], [0.24, 2.32, 1.22]]],
		legs: [[-0.2, 0.68, front], [0.2, 0.68, front], [-0.2, -0.78, hind], [0.2, -0.78, hind]] });
	// a bell under its throat (part 1), and its antlers: a beam out to a broad palm, tines along its edge
	m.strut([0, 1.78, 1.5], [0, 1.45, 1.46], 0.05, 0.02, 3, M, 1);
	for (const s of [-1, 1]) {
		m.strut([s * 0.08, 2.2, 1.26], [s * 0.42, 2.34, 1.2], 0.045, 0.035, 4, ANTLER, 1);
		const P = [[0.42, 2.3, 1.1], [0.9, 2.52, 1.0], [1.08, 2.66, 1.22], [0.72, 2.6, 1.42], [0.4, 2.42, 1.34]].map(([x, y, z]) => [s * x, y, z]);
		for (let k = 1; k < 4; k++) { m.tri(P[0], P[k], P[k + 1], 1, ANTLER); m.tri(P[0], P[k + 1], P[k], 1, ANTLER); }
		for (const [a, b] of [[P[1], [s * 1.08, 2.8, 0.9]], [P[2], [s * 1.3, 2.86, 1.26]], [P[3], [s * 0.86, 2.86, 1.54]]]) m.strut(a, b, 0.03, 0.006, 3, ANTLER, 1);
	}
	return m;
}
function wolf() {
	const m = vm.meshBuilder(), W = 81;
	const front = [[0.58, 0.04, 0.06], [0.3, 0.022, 0.03], [0.12, 0.016, 0.02, 0.005], [0.03, 0.02, 0.026, 0.012], [0, 0.022, 0.034, 0.016]], hind = [[0.58, 0.05, 0.085], [0.3, 0.024, 0.03, -0.03], [0.12, 0.016, 0.02, -0.005], [0.03, 0.02, 0.026, 0.012], [0, 0.022, 0.034, 0.016]];
	quadruped(m, { material: W, foot: INK,
		body: [[-0.6, 0.05, 0.55, 0.68], [-0.5, 0.11, 0.46, 0.73], [-0.25, 0.135, 0.44, 0.74], [0.05, 0.14, 0.42, 0.76], [0.3, 0.15, 0.4, 0.8], [0.46, 0.13, 0.46, 0.82], [0.56, 0.07, 0.56, 0.78]],
		neck: [[0.68, 0.48, 0.09, 0.13], [0.76, 0.58, 0.075, 0.1], [0.82, 0.66, 0.065, 0.08], [0.84, 0.7, 0.06, 0.07]],
		head: [[0.86, 0.66, 0.06, 0.07], [0.86, 0.74, 0.078, 0.08], [0.82, 0.84, 0.05, 0.05], [0.79, 0.94, 0.03, 0.028], [0.77, 1.0, 0.018, 0.018]],
		ears: [[[0.02, 0.93, 0.7], [0.07, 0.92, 0.66], [0.06, 1.03, 0.65]]],
		legs: [[-0.09, 0.38, front], [0.09, 0.38, front], [-0.09, -0.42, hind], [0.09, -0.42, hind]] });
	// the tail: a brush, down and out behind
	m.loft([ringZ(-0.58, 0.035, 0.035, 5, 0.66), ringZ(-0.78, 0.05, 0.055, 5, 0.5), ringZ(-0.96, 0.012, 0.012, 5, 0.34)], W, 0, [1]);
	return m;
}
function bear() {
	const m = vm.meshBuilder(), B = 82;
	const front = [[0.72, 0.09, 0.13], [0.34, 0.075, 0.09], [0.14, 0.07, 0.09, 0.01], [0.04, 0.08, 0.11, 0.03], [0, 0.08, 0.13, 0.04]], hind = [[0.72, 0.12, 0.17], [0.34, 0.08, 0.1, -0.02], [0.14, 0.07, 0.09, 0.01], [0.04, 0.08, 0.11, 0.03], [0, 0.08, 0.14, 0.05]];
	quadruped(m, { material: B, foot: B,
		body: [[-0.86, 0.14, 0.52, 0.88], [-0.74, 0.3, 0.34, 1.02], [-0.42, 0.42, 0.28, 1.08], [-0.05, 0.46, 0.27, 1.12], [0.3, 0.44, 0.28, 1.2], [0.58, 0.34, 0.36, 1.18], [0.76, 0.18, 0.56, 1.06]],
		neck: [[0.88, 0.74, 0.2, 0.24], [0.94, 0.86, 0.17, 0.2], [0.98, 0.96, 0.15, 0.17], [1.0, 1.02, 0.14, 0.15]],
		head: [[1.02, 0.98, 0.15, 0.16], [1.02, 1.08, 0.18, 0.18], [0.96, 1.22, 0.11, 0.11], [0.9, 1.32, 0.075, 0.07], [0.86, 1.4, 0.05, 0.045]],
		ears: [[[0.07, 1.17, 1.02], [0.15, 1.14, 0.98], [0.15, 1.26, 0.98]]],
		legs: [[-0.26, 0.56, front], [0.26, 0.56, front], [-0.28, -0.6, hind], [0.28, -0.6, hind]] });
	return m;
}
void legsOf;
function flareSpark() { const m = vm.meshBuilder(); m.ball([0, 0, 0], 0.12, 5, 84); return m; }
function flareBall() { const m = vm.meshBuilder(); m.ball([0, 0, 0], 0.55, 8, 84); return m; }

// a cat: the body in rings along z, a head (1), legs a strut each (2 to 5: left front, right front, left hind, right hind), a tail curling up behind
function cat(coat, belly) {
	const m = vm.meshBuilder(), ring = (z, w, lo, hi, n = 6) => Array.from({ length: n }, (_, k) => { const t = (k + 0.5) / n * Math.PI * 2; return [Math.cos(t) * w, (lo + hi) / 2 + Math.sin(t) * (hi - lo) / 2, z]; });
	m.loft([ring(-0.2, 0.04, 0.17, 0.25), ring(-0.14, 0.07, 0.13, 0.27), ring(0.04, 0.065, 0.13, 0.26), ring(0.16, 0.055, 0.15, 0.27)], coat, 0, [0, 1]);
	m.quad([-0.05, 0.135, -0.12], [0.05, 0.135, -0.12], [0.045, 0.135, 0.12], [-0.045, 0.135, 0.12], 0, belly);
	// the head and its ears
	const head = (y, z, w, h) => Array.from({ length: 5 }, (_, k) => { const t = (k + 0.5) / 5 * Math.PI * 2; return [Math.cos(t) * w, y + Math.sin(t) * h, z]; });
	m.loft([head(0.27, 0.15, 0.04, 0.04), head(0.29, 0.21, 0.055, 0.048), head(0.27, 0.27, 0.03, 0.028)], coat, 1, [0, 1]);
	for (const s of [-1, 1]) { m.tri([s * 0.018, 0.325, 0.2], [s * 0.05, 0.325, 0.21], [s * 0.038, 0.37, 0.205], 1, coat); m.tri([s * 0.018, 0.325, 0.2], [s * 0.038, 0.37, 0.205], [s * 0.05, 0.325, 0.21], 1, coat); }
	// the legs
	[[-0.04, 0.12], [0.04, 0.12], [-0.045, -0.13], [0.045, -0.13]].forEach(([x, z], k) => m.strut([x, 0.2, z], [x, 0, z + 0.01], 0.022, 0.014, 3, coat, 2 + k));
	// the tail
	m.strut([0, 0.22, -0.2], [0, 0.2, -0.32], 0.016, 0.014, 3, coat);
	m.strut([0, 0.2, -0.32], [0, 0.3, -0.4], 0.014, 0.012, 3, coat);
	m.strut([0, 0.3, -0.4], [0, 0.4, -0.38], 0.012, 0.006, 3, coat);
	return m;
}
function rat() {
	const m = vm.meshBuilder(), R = 110, ring = (z, w, lo, hi) => [[-w, lo, z], [0, (lo + hi) / 2 - (hi - lo) * 0.7, z], [w, lo, z], [w * 0.8, hi, z], [-w * 0.8, hi, z]].slice(0, 4).map((p, k) => k == 1 ? [0, lo - 0.002, z] : p);
	m.loft([ring(-0.07, 0.015, 0.012, 0.035), ring(-0.03, 0.03, 0.01, 0.06), ring(0.03, 0.025, 0.012, 0.052)], R, 0, [0]);
	// the head: a point (1), ears
	m.tri([-0.022, 0.015, 0.03], [0.022, 0.015, 0.03], [0, 0.03, 0.09], 1, R);
	m.tri([0.022, 0.015, 0.03], [-0.022, 0.05, 0.03], [0, 0.03, 0.09], 1, R);
	m.tri([-0.022, 0.05, 0.03], [-0.022, 0.015, 0.03], [0, 0.03, 0.09], 1, R);
	m.tri([0.022, 0.05, 0.03], [-0.022, 0.05, 0.03], [0, 0.03, 0.09], 1, R);
	m.tri([0.022, 0.015, 0.03], [0.022, 0.05, 0.03], [0, 0.03, 0.09], 1, R);
	for (const s of [-1, 1]) m.tri([s * 0.01, 0.05, 0.035], [s * 0.028, 0.05, 0.03], [s * 0.022, 0.068, 0.033], 1, R);
	// the legs: a triangle each (2 to 5), and the tail
	[[-0.022, 0.035], [0.022, 0.035], [-0.024, -0.045], [0.024, -0.045]].forEach(([x, z], k) => m.tri([x, 0.035, z - 0.01], [x, 0.035, z + 0.01], [x, 0, z + 0.004], 2 + k, R));
	m.tri([-0.005, 0.02, -0.07], [0.005, 0.02, -0.07], [0, 0.008, -0.2], 0, R);
	m.tri([0.005, 0.02, -0.07], [-0.005, 0.02, -0.07], [0, 0.008, -0.2], 0, R);
	return m;
}
const MAKERS = { catTabby: () => cat(108, 111), catBlack: () => cat(109, 109), rat, moose, wolf, bear, flareSpark, flareBall, rabbit, rabbitDead, trap, trapSprung, antlersCut, sinewCoil, rabbitPelt, smallBones, ...FISH_MODELS, whale, whaleStage1, whaleStage2, whaleStage3, whaleStage4, harpoonGun, harpoonBarrel, harpoon, cable, shipChest, crownCover };
export const CREATURE_MESHES = Object.fromEntries(Object.entries(MAKERS).map(([name, make]) => { const m = make(); return [name, { data: m.done(), triangles: m.count() }]; }));
export const creatureStats = Object.fromEntries(Object.entries(CREATURE_MESHES).map(([name, mesh]) => [name, mesh.triangles]));
