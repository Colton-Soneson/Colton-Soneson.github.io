/*
	THE KINDS OF DEER (deer.js, vf_deer.js, inspect.js). All of them the one mesh (deer.js: DEER_MESH, a white-tailed deer's, in its
	metres), made the kind's size, its ears and its tail drawn bigger or smaller, its own antlers (each kind's are a part of the mesh of
	their own: antlers, 6 on) and its own coat (vf_deer.js: THE COATS).

	OWN (a deer's number, deer.own): its kind times 4, and its antlers (0 a female, 1 a male with them, 2 a male whose antlers have
	been cut off, 3 a female with antlers of her own: a caribou's, smaller), and its tone (a fraction: how dark or pale its coat).

	Each kind: its name, the male's and the female's, its size (times a white-tailed deer's: a female; the male male times that), its ears and
	its tail (times the mesh's), its antlers' part, how many of its group are males, and how big its groups are, where it lives (the forest, or
	the forest and the grass, ZONES), how often it is the kind of a group of deer (weight: the elk and the caribou are groups of their own,
	see deer.js THE GROUPS), and the meat on it (more cuts of venison and sinew than a white-tailed deer's).
*/
export const DEER_KINDS = [
	{ name: 'white-tailed deer', male: 'buck', female: 'doe', size: 1.0, males: 1.1, ears: 1.0, tail: 1.0, antlers: 6, bucks: 0.65, group: [1, 3], grass: false, weight: 3, more: 0 },
	{ name: 'mule deer', male: 'buck', female: 'doe', size: 1.08, males: 1.12, ears: 1.6, tail: 0.75, antlers: 7, bucks: 0.6, group: [1, 4], grass: false, weight: 2, more: 1 },
	{ name: 'black-tailed deer', male: 'buck', female: 'doe', size: 0.92, males: 1.08, ears: 1.3, tail: 0.95, antlers: 7, bucks: 0.6, group: [1, 3], grass: false, weight: 2, more: 0 },
	{ name: 'fallow deer', male: 'buck', female: 'doe', size: 0.88, males: 1.12, ears: 1.05, tail: 1.15, antlers: 8, bucks: 0.55, group: [2, 4], grass: false, weight: 1, more: 0 },
	{ name: 'roe deer', male: 'buck', female: 'doe', size: 0.72, males: 1.04, ears: 1.15, tail: 0.12, antlers: 9, bucks: 0.55, group: [1, 3], grass: false, weight: 1, more: -2 },
	{ name: 'elk', male: 'bull', female: 'cow', size: 1.5, males: 1.12, ears: 1.0, tail: 0.5, antlers: 10, bucks: 0.4, group: [3, 6], grass: true, weight: 0, more: 4 },
	{ name: 'caribou', male: 'bull', female: 'cow', size: 1.18, males: 1.1, ears: 0.75, tail: 0.6, antlers: 11, bucks: 0.45, group: [3, 6], grass: true, weight: 0, more: 2, cowAntlers: true },
];
export const ELK = 5, CARIBOU = 6;

export const kindOf = (own) => Math.min(Math.max(Math.floor(own / 4), 0), DEER_KINDS.length - 1);
export const antlersOf = (own) => Math.floor(own) % 4;				// (see OWN)
export const isMale = (own) => { const a = antlersOf(own); return a == 1 || a == 2; };
export const hasAntlers = (own) => { const a = antlersOf(own); return a == 1 || a == 3; };
export const sizeOfOwn = (own) => DEER_KINDS[kindOf(own)].size * (isMale(own) ? DEER_KINDS[kindOf(own)].males : 1);
export const cutAntlers = (own) => kindOf(own) * 4 + (isMale(own) ? 2 : 0) + (own - Math.floor(own));
export function newOwn(kind) {
	const K = DEER_KINDS[kind], male = Math.random() < K.bucks;
	return kind * 4 + (male ? 1 : K.cowAntlers ? 3 : 0) + Math.random() * 0.999;
}
// a group's kind of deer: by their weights
export function pickKind() {
	const total = DEER_KINDS.reduce((sum, K) => sum + K.weight, 0);
	let r = Math.random() * total;
	for (let k = 0; k < DEER_KINDS.length; k++) if ((r -= DEER_KINDS[k].weight) < 0) return k;
	return 0;
}

// the ears, the tail and a cow's antlers as vf_deer.js draws them (the same, for inspect.js): a point of the mesh of the part, for the kind,
//		or null when the kind has none of it (another kind's antlers, or none)
export const EAR_FOOT = [0.045, 1.55, 0.645], TAIL_FOOT = [0, 1.06, -0.66], ANTLER_FOOT = [0.03, 1.555, 0.655];
const about = (p, foot, side, k) => [foot[0] * side + (p[0] - foot[0] * side) * k, foot[1] + (p[1] - foot[1]) * k, foot[2] + (p[2] - foot[2]) * k];
export function shapeOf(own, p, part) {
	const K = DEER_KINDS[kindOf(own)];
	if (part > 5.5) {
		if (Math.round(part) != K.antlers || !hasAntlers(own)) return null;
		return antlersOf(own) == 3 ? about(p, ANTLER_FOOT, Math.sign(p[0]) || 1, 0.55) : p;
	}
	if (part > 1.1 && part < 1.4) return about(p, EAR_FOOT, Math.sign(p[0]) || 1, K.ears);
	if (part > 0.1 && part < 0.4) return about(p, TAIL_FOOT, 1, K.tail);
	return p;
}
