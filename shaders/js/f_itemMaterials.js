/*
	THE ITEMS' MATERIALS (items.js: the Survival mode's things), 20 and up: shared by the hands (vf_viewmodel.js) and the world (vf_props.js).
	itemMaterial(m, at): albedo (rgb) and gloss (a); itemGlow(m): what shines by itself (the lighter's flame, a fire's embers)
		20 bread's crust		21 its crumb			22 sausage				23 green glass (beer)		24 clear glass (water)
		25 paper (the map)		26 grey wool			27 stone				28 a flame					29 bright steel (a blade)
		30 a crate's boards		31 sacking				32 charcoal				33 a red label				34 a handle's wood
		35 rope					36 embers				37 canvas				38 ash						39 raw meat
		40 meat seared			41 a dummy's yellow		42 leather				43 ink						44 white enamel
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
			default: { return vec4f(0.5, 0.5, 0.5, 0.1); }
		}
	}
	fn itemGlow(m: i32) -> vec3f {
		if (m == 28) { return vec3f(2.4, 1.3, 0.35); }
		if (m == 36) { return vec3f(1.6, 0.45, 0.08); }
		return vec3f(0.0);
	}
`;
