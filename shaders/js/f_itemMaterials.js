/*
	THE ITEMS' MATERIALS (items.js: the Survival mode's things), 20 and up: shared by the hands (vf_viewmodel.js) and the world (vf_props.js).
	itemMaterial(m, at): albedo (rgb) and gloss (a); itemGlow(m): what shines by itself (the lighter's flame, a fire's embers)
		20 bread's crust		21 its crumb			22 sausage				23 green glass (beer)		24 clear glass (water)
		25 paper (the map)		26 grey wool			27 stone				28 a flame					29 bright steel (a blade)
		30 a crate's boards		31 sacking				32 charcoal				33 a red label				34 a handle's wood
		35 rope					36 embers				37 canvas				38 ash						39 raw meat
		40 meat seared			41 a dummy's yellow		42 leather				43 ink						44 white enamel
		(the rooms, interiorMeshes.js)
		45 warm plaster			46 green wallpaper		47 dark panelling		48 chequered tiles			49 floor boards
		50 flagstones			51 a ceiling			52 polished wood		53 red cloth				54 green cloth
		55 blue cloth			56 leaves				57 terracotta			58 a painting				59 cream cloth
		60 books' spines		61 a window (vf_props.js)	62 a lamp's glass		71 blue wallpaper			72 firebrick
		(what lives, creatureMeshes.js)
		63 rabbit's coat		64 rabbit's belly		65 bone					66 whale's back				67 whale's belly
		68 flesh				69 blubber				70 antler				73 harpoon iron
		80 moose				81 wolf					82 bear					84 a flare's fire			85 flare gun orange
		74 trout				75 carp					76 herring				77 mackerel					78 cod					79 tuna
*/
export const itemMaterials =
`
	fn itemMaterial(m: i32, at: vec3f) -> vec4f {
		let grain = 0.9 + 0.1 * sin(at.x * 320.0 + sin(at.z * 210.0) * 2.0);
		switch (m) {
			case 20: { return vec4f(vec3f(0.62, 0.38, 0.16) * (0.85 + 0.15 * sin(at.x * 140.0) * sin(at.z * 170.0)), 0.15); }
			case 21: { return vec4f(0.9, 0.8, 0.58, 0.02); }
			case 22: { return vec4f(0.42, 0.13, 0.08, 0.55); }
			case 23: { return vec4f(0.1, 0.26, 0.08, 1.2); }
			case 24: { return vec4f(0.55, 0.66, 0.72, 1.2); }
			case 25: { return vec4f(vec3f(0.84, 0.79, 0.66) * (0.985 + 0.015 * sin(at.x * 90.0 + at.y * 140.0)), 0.05); }
			case 26: { return vec4f(0.36, 0.34, 0.31, 0.03); }
			case 27: { return vec4f(vec3f(0.44, 0.43, 0.41) * (0.85 + 0.15 * sin(at.x * 90.0 + at.y * 70.0)), 0.1); }
			case 28: { return vec4f(1.0, 0.7, 0.25, 0.0); }
			case 29: { return vec4f(0.6, 0.62, 0.64, 1.1); }
			case 30: { return vec4f(vec3f(0.48, 0.34, 0.19) * grain, 0.08); }
			case 31: { return vec4f(0.5, 0.42, 0.29, 0.02); }
			case 32: { return vec4f(0.08, 0.07, 0.06, 0.05); }
			case 33: { return vec4f(0.6, 0.12, 0.09, 0.2); }
			case 34: { return vec4f(vec3f(0.5, 0.33, 0.17) * grain, 0.2); }
			case 35: { return vec4f(0.58, 0.5, 0.33, 0.02); }
			case 36: { return vec4f(0.2, 0.06, 0.02, 0.0); }
			case 38: { return vec4f(vec3f(0.5, 0.48, 0.45) * (0.85 + 0.15 * sin(at.x * 300.0 + at.z * 210.0)), 0.02); }
			case 37: { return vec4f(vec3f(0.6, 0.53, 0.36) * (0.93 + 0.07 * sin(at.x * 700.0) * sin(at.z * 700.0)), 0.04); }
			case 39: { return vec4f(vec3f(0.5, 0.1, 0.08) * (0.85 + 0.15 * sin(at.x * 260.0 + at.z * 190.0)), 0.6); }
			case 40: { return vec4f(vec3f(0.3, 0.15, 0.07) * (0.7 + 0.3 * sin(at.x * 420.0) * sin(at.z * 380.0)), 0.25); }
			case 41: { return vec4f(0.86, 0.66, 0.08, 0.3); }
			case 42: { return vec4f(0.25, 0.15, 0.08, 0.2); }
			case 43: { return vec4f(0.03, 0.03, 0.035, 0.1); }
			case 44: { return vec4f(0.92, 0.9, 0.85, 0.4); }
			case 45: { return vec4f(vec3f(0.74, 0.68, 0.56) * (0.96 + 0.04 * sin(at.x * 9.0 + at.y * 7.0 + at.z * 8.0)), 0.02); }
			case 46: { return vec4f(mix(vec3f(0.3, 0.42, 0.32), vec3f(0.42, 0.53, 0.4), step(0.0, sin((at.x + at.z) * 25.0))), 0.04); }
			case 47: { return vec4f(vec3f(0.27, 0.17, 0.1) * (0.9 + 0.1 * sin((at.x + at.z) * 13.0)), 0.25); }
			case 48: { let c = (floor(at.x * 3.0) + floor(at.z * 3.0)) % 2.0; return vec4f(mix(vec3f(0.82, 0.8, 0.74), vec3f(0.22, 0.24, 0.26), abs(c)), 0.5); }
			case 49: { let p = floor(at.x * 5.0); return vec4f(vec3f(0.44, 0.3, 0.17) * (0.85 + 0.15 * sin(p * 7.3)) * (0.94 + 0.06 * sin(at.z * 40.0 + p)) * (0.75 + 0.25 * smoothstep(0.0, 0.06, abs(fract(at.x * 5.0) - 0.5))), 0.12); }
			case 50: { let u = fract(at.xz * 1.4); let e = min(min(u.x, 1.0 - u.x), min(u.y, 1.0 - u.y)); return vec4f(vec3f(0.42, 0.4, 0.37) * (0.7 + 0.3 * smoothstep(0.0, 0.05, e)) * (0.9 + 0.1 * sin(floor(at.x * 1.4) * 5.0 + floor(at.z * 1.4) * 3.0)), 0.08); }
			case 51: { return vec4f(0.68, 0.64, 0.56, 0.0); }
			case 52: { return vec4f(vec3f(0.3, 0.17, 0.09) * grain, 0.6); }
			case 53: { return vec4f(0.52, 0.1, 0.09, 0.03); }
			case 54: { return vec4f(0.14, 0.32, 0.17, 0.03); }
			case 55: { return vec4f(0.14, 0.2, 0.42, 0.03); }
			case 56: { return vec4f(vec3f(0.16, 0.42, 0.14) * (0.8 + 0.2 * sin(at.x * 70.0 + at.y * 50.0)), 0.15); }
			case 57: { return vec4f(0.62, 0.32, 0.18, 0.08); }
			case 58: { let w = sin(at.x * 16.0 + sin(at.y * 11.0) * 2.0); return vec4f(mix(mix(vec3f(0.2, 0.34, 0.5), vec3f(0.7, 0.62, 0.4), smoothstep(-0.2, 0.3, at.y * 5.0 + w * 0.2)), vec3f(0.3, 0.42, 0.2), smoothstep(0.4, 1.0, w) * 0.5), 0.2); }
			case 59: { return vec4f(0.8, 0.75, 0.62, 0.03); }
			case 60: { let b = floor(at.x * 26.0 + at.z * 26.0); return vec4f(vec3f(0.3 + 0.3 * sin(b * 2.1), 0.2 + 0.2 * sin(b * 3.7), 0.15 + 0.2 * sin(b * 5.3)), 0.1); }
			case 61: { return vec4f(0.6, 0.7, 0.8, 1.0); }
			case 62: { return vec4f(0.9, 0.8, 0.55, 1.0); }
			case 63: { return vec4f(vec3f(0.42, 0.32, 0.22) * (0.88 + 0.12 * sin(at.x * 120.0) * sin(at.z * 90.0)), 0.02); }
			case 64: { return vec4f(0.8, 0.75, 0.66, 0.02); }
			case 65: { return vec4f(0.86, 0.82, 0.7, 0.12); }
			case 66: { return vec4f(vec3f(0.2, 0.23, 0.28) * (0.9 + 0.1 * sin(at.x * 3.0 + at.z * 1.3)), 0.5); }
			case 67: { return vec4f(0.68, 0.7, 0.7, 0.4); }
			case 68: { return vec4f(vec3f(0.48, 0.12, 0.1) * (0.8 + 0.2 * sin(at.z * 4.0) * sin(at.x * 6.0)), 0.6); }
			case 69: { return vec4f(0.86, 0.76, 0.56, 0.6); }
			case 70: { return vec4f(vec3f(0.62, 0.52, 0.36) * (0.88 + 0.12 * sin(at.y * 120.0)), 0.25); }
			case 71: { return vec4f(mix(vec3f(0.26, 0.32, 0.44), vec3f(0.36, 0.42, 0.54), step(0.0, sin((at.x + at.z) * 18.0))), 0.04); }
			case 72: { let u = fract(vec2f((at.x + at.z) * 6.0 + floor(at.y * 12.0) * 0.5, at.y * 12.0)); return vec4f(vec3f(0.4, 0.2, 0.14) * (0.65 + 0.35 * step(0.08, min(u.x, u.y))), 0.05); }
			case 73: { return vec4f(0.2, 0.2, 0.22, 0.8); }
			case 80: { return vec4f(mix(vec3f(0.3, 0.2, 0.13), vec3f(0.62, 0.5, 0.36), smoothstep(0.85, 0.4, at.y)) * (0.97 + 0.03 * sin(at.y * 9.0 + at.z * 5.0)), 0.04); }
			case 81: { return vec4f(mix(vec3f(0.42, 0.41, 0.4), vec3f(0.78, 0.74, 0.66), smoothstep(0.66, 0.42, at.y)) * (0.95 + 0.05 * sin(at.y * 17.0 + at.z * 11.0)), 0.04); }
			case 82: { return vec4f(vec3f(0.36, 0.23, 0.13) * (0.96 + 0.04 * sin(at.y * 11.0 + at.z * 7.0)), 0.04); }
			case 84: { return vec4f(1.0, 0.8, 0.7, 0.0); }
			case 86: { return vec4f(0.8, 0.9, 0.97, 0.75); }
			case 88: { return vec4f(vec3f(0.36, 0.34, 0.33) * (0.88 + 0.12 * sin(at.x * 19.0 + at.y * 13.0 + at.z * 23.0)), 0.08); }
			case 89: { return vec4f(0.52, 0.24, 0.1, 0.55); }
			case 90: { return vec4f(vec3f(0.2, 0.135, 0.08) * (0.86 + 0.14 * sin(at.x * 37.0 + at.z * 53.0)), 0.02); }
			case 91: { return vec4f(0.3, 0.46, 0.13, 0.1); }
			case 92: { return vec4f(0.78, 0.62, 0.25, 0.1); }
			case 93: { return vec4f(0.1, 0.1, 0.11, 0.55); }
			case 94: { return vec4f(vec3f(0.42, 0.38, 0.34) * (0.86 + 0.14 * sin(at.x * 31.0 + at.y * 47.0) * sin(at.z * 29.0 + at.y * 41.0)), 0.05); }
			case 95: { return vec4f(0.55, 0.3, 0.14, 0.15); }
			case 96: { return vec4f(0.82, 0.77, 0.64, 0.05); }
			case 97: { return vec4f(vec3f(0.5, 0.29, 0.14) * (0.9 + 0.1 * sin(at.x * 25.0)), 0.06); }
			case 98: { return vec4f(0.13, 0.29, 0.23, 0.55); }
			case 99: { return vec4f(0.12, 0.13, 0.15, 0.9); }
			case 100: { return vec4f(0.72, 0.64, 0.42, 0.03); }
			case 101: { return vec4f(0.58, 0.44, 0.27, 0.08); }
			case 102: { return vec4f(0.27, 0.16, 0.09, 0.2); }
			case 103: { return vec4f(vec3f(0.74, 0.54, 0.33) * (0.92 + 0.08 * sin(at.x * 21.0) * sin(at.x * 3.1 + 1.0)), 0.08); }
			case 104: { return vec4f(vec3f(0.55, 0.38, 0.22) * (0.9 + 0.1 * sin(at.x * 44.0)), 0.1); }
			case 105: { return vec4f(vec3f(0.4, 0.39, 0.37) * (0.86 + 0.14 * sin(at.x * 23.0 + at.y * 9.0) * sin(at.z * 19.0 + at.y * 17.0)), 0.05); }
			case 106: { return vec4f(0.03, 0.028, 0.027, 0.02); }
			case 107: { return vec4f(0.3, 0.1, 0.03, 0.0); }
			case 85: { return vec4f(0.85, 0.32, 0.06, 0.5); }
			case 74: { return vec4f(mix(vec3f(0.3, 0.34, 0.2) * (0.75 + 0.25 * step(0.2, sin(at.x * 300.0) * sin(at.z * 240.0))), vec3f(0.78, 0.66, 0.62), smoothstep(0.012, -0.018, at.y)), 0.7); }
			case 75: { return vec4f(mix(vec3f(0.62, 0.44, 0.16), vec3f(0.86, 0.72, 0.42), smoothstep(0.02, -0.03, at.y)), 0.8); }
			case 76: { return vec4f(mix(vec3f(0.22, 0.34, 0.46), vec3f(0.82, 0.86, 0.9), smoothstep(0.01, -0.012, at.y)), 1.3); }
			case 77: { return vec4f(mix(vec3f(0.12, 0.34, 0.32) * (0.5 + 0.5 * step(0.0, sin(at.z * 110.0 + at.y * 90.0))), vec3f(0.84, 0.86, 0.84), smoothstep(0.004, -0.018, at.y)), 1.2); }
			case 78: { return vec4f(mix(vec3f(0.34, 0.32, 0.22) * (0.8 + 0.2 * sin(at.x * 180.0 + at.z * 130.0)), vec3f(0.8, 0.8, 0.74), smoothstep(0.02, -0.05, at.y)), 0.5); }
			case 79: { return vec4f(mix(vec3f(0.06, 0.1, 0.24), vec3f(0.72, 0.76, 0.8), smoothstep(0.06, -0.08, at.y)), 1.4); }
			default: { return vec4f(0.5, 0.5, 0.5, 0.1); }
		}
	}
	fn itemGlow(m: i32) -> vec3f {
		if (m == 28) { return vec3f(2.4, 1.3, 0.35); }
		if (m == 36) { return vec3f(1.6, 0.45, 0.08); }
		if (m == 62) { return vec3f(1.5, 1.05, 0.5); }
		if (m == 84) { return vec3f(9.0, 3.6, 2.4); }
		if (m == 107) { return vec3f(2.4, 0.95, 0.25); }
		return vec3f(0.0);
	}
`;
