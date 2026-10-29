import { motionShapes } from './motionShapes.js';
import { itemMaterials } from './f_itemMaterials.js';
/*
	A gun in the hunter's hands (viewmodel.js: the shotgun, the revolver, the Sharps rifle), drawn the way the rifle is (see vf_rifle.js):
	in the camera's own space, in metres, with its own near plane and its own depth, over the finished frame.

	Each vertex says which part of the gun it is (shape.w % 32) and what it is made of (shape.w / 32, a whole number). Each part has a
	matrix (parts), worked out on the CPU each frame: where it is on the gun now (the pump slid back, the cylinder turned, the
	breech block dropped, a shell on its way into the magazine, an empty case thrown out). A part not there is drawn as nothing (its
	matrix scaled to 0). Then the whole gun is put where it is held (gun).
	The materials: 0 walnut, 1 blued steel, 2 brass, 3 lead and copper, 4 a shotgun shell's red hull, 5 case hardened steel (the
	colours of the quench mottled through it), 6 a scope's black, 7 its lens, 8 nickel, 9 dark rubber, 10 a darker wood, and the
	plastic of the golf discs: 11 orange, 12 blue, 13 yellow, and 14 the face of a revolver's cylinder (blued, with its six chambers
	CHAMBER_OUT from its middle: the dark holes of the empty ones, see revolver.js), 15 the pale wood of the wizard's staff, 16 the gem
	in its head, which shines by itself (staff.js), 17 the top of a Lewis gun's pan (blued, ribbed out from its middle: the mesh's own
	origin, see lewis.js), 18 the khaki canvas of a supply pack and 19 its leather straps (plane.js).
	The glow: a light of its own at the mesh's origin (the staff's gem is there), falling on the rest of the mesh near it.
	The light is the sun's or the moon's, turned into the camera's space, the same strength as everything else gets.
*/
export const vf_viewmodel =
`
	struct ViewmodelUniforms
	{
		projection : mat4x4f,
		gun : mat4x4f,
		light : vec4f,			// xyz: towards the light, in the camera's space, w: how strong it is straight on
		ambient : vec4f,		// x: the light from everywhere, y: daylight 0 to 1
		glow : vec4f,			// rgb: the colour of the light at the mesh's origin, a: how strong (0: none)
		parts : array<mat4x4f, 32>,
	}
	@group(0) @binding(0) var<uniform> VU: ViewmodelUniforms;

	const PI: f32 = 3.14159265;
	${itemMaterials}
	const CHAMBER_OUT: f32 = 0.0125;	// metres from a revolver cylinder's middle to a chamber's (CHAMBER_RADIUS in revolver.js)
	const CHAMBER_HOLE: f32 = 0.0058;	// a chamber's radius

	struct VertexOutput {
		@builtin(position) pos: vec4f,
		@location(0) viewPos: vec3f,
		@location(1) @interpolate(flat) material: f32,
		@location(2) shape: vec3f,
	};

	@vertex
	fn vertexMain(@location(0) shape: vec4f) -> VertexOutput {
		let code = i32(shape.w + 0.5);
		let part = code % 32;
		let material = code / 32;
		let placed = (VU.parts[part] * vec4f(shape.xyz, 1.0)).xyz;
		let viewPos = (VU.gun * vec4f(placed, 1.0)).xyz;
		var output: VertexOutput;
		output.pos = VU.projection * vec4f(viewPos, 1.0);
		output.viewPos = viewPos;
		output.material = f32(material);
		output.shape = shape.xyz;
		return output;
	}

	fn shade(input: VertexOutput) -> vec4f {
		var N = normalize(cross(dpdx(input.viewPos), dpdy(input.viewPos)));
		if (dot(N, input.viewPos) > 0.0) {
			N = -N;
		}
		let V = normalize(-input.viewPos);
		let L = normalize(VU.light.xyz);
		let diffuse = saturate(dot(N, L));
		let H = normalize(L + V);
		let m = i32(input.material + 0.5);
		var albedo = vec3f(0.5, 0.5, 0.5);
		var gloss = 0.1;
		var power = 24.0;
		var metal = false;
		switch (m) {
			case 0: {
				let grain = 0.85 + 0.15 * sin(input.shape.z * 240.0 + sin(input.shape.y * 80.0) * 2.0);
				albedo = vec3f(0.36, 0.19, 0.08) * grain; gloss = 0.15;
			}
			case 1: { albedo = vec3f(0.055, 0.06, 0.07); gloss = 0.55; power = 48.0; }
			case 2: { albedo = vec3f(0.62, 0.46, 0.2); gloss = 0.8; power = 32.0; metal = true; }
			case 3: { albedo = vec3f(0.45, 0.42, 0.4); gloss = 0.4; metal = true; }
			case 4: { albedo = vec3f(0.55, 0.06, 0.05); gloss = 0.3; }
			case 5: {
				let mottle = 0.5 + 0.5 * sin(input.shape.x * 400.0 + input.shape.z * 230.0) * sin(input.shape.y * 310.0 - input.shape.z * 170.0);
				albedo = mix(vec3f(0.13, 0.15, 0.2), vec3f(0.3, 0.25, 0.18), mottle); gloss = 0.6; power = 40.0; metal = true;
			}
			case 6: { albedo = vec3f(0.03, 0.03, 0.035); gloss = 0.25; power = 20.0; }
			case 7: { albedo = vec3f(0.05, 0.08, 0.14); gloss = 1.4; power = 64.0; }
			case 8: { albedo = vec3f(0.62, 0.63, 0.65); gloss = 0.9; power = 40.0; metal = true; }
			case 9: { albedo = vec3f(0.05, 0.045, 0.04); gloss = 0.05; }
			case 10: {
				let grain = 0.85 + 0.15 * sin(input.shape.z * 260.0 + sin(input.shape.x * 90.0) * 2.0);
				albedo = vec3f(0.22, 0.12, 0.06) * grain; gloss = 0.2;
			}
			case 11: { albedo = vec3f(0.95, 0.42, 0.08); gloss = 0.35; }
			case 12: { albedo = vec3f(0.12, 0.42, 0.95); gloss = 0.35; }
			case 13: { albedo = vec3f(0.95, 0.82, 0.12); gloss = 0.35; }
			case 15: {
				let grain = 0.9 + 0.1 * sin(input.shape.y * 70.0 + sin(input.shape.x * 300.0 + input.shape.z * 260.0) * 1.8);
				albedo = vec3f(0.8, 0.78, 0.72) * grain; gloss = 0.12; power = 16.0;
			}
			case 16: {
				// the gem: its own light, a little brighter on the facets turned to the eye, and a glint
				let facing = saturate(dot(N, V));
				let shining = VU.glow.rgb * (0.7 + 1.3 * VU.glow.a) * (0.65 + 0.45 * facing) + vec3f(1.0) * pow(saturate(dot(N, H)), 40.0) * 0.6;
				return vec4f(shining, 1.0);
			}
			case 17: {
				// the pan: ribs out from its middle, the rounds' tiers between them
				let ribs = abs(fract(atan2(input.shape.x, input.shape.z) / (2.0 * PI) * 25.0) - 0.5);
				let fromMiddle = length(input.shape.xz);
				albedo = vec3f(0.055, 0.06, 0.07) * select(1.0, 0.55, ribs < 0.12 && fromMiddle > 0.03); gloss = 0.5; power = 40.0;
			}
			case 18: {
				let weave = 0.92 + 0.08 * sin(input.shape.x * 900.0) * sin(input.shape.y * 900.0 + input.shape.z * 900.0);
				albedo = vec3f(0.42, 0.38, 0.25) * weave; gloss = 0.04;
			}
			case 19: { albedo = vec3f(0.26, 0.15, 0.07); gloss = 0.25; power = 18.0; }
			case 14: {
				// the nearest of the six chambers round the cylinder's middle (the mesh's own x, y: it turns with it)
				let at = input.shape.xy;
				let k = round(atan2(at.x, at.y) / (PI / 3.0));
				let chamber = CHAMBER_OUT * vec2f(sin(k * PI / 3.0), cos(k * PI / 3.0));
				let off = length(at - chamber);
				albedo = vec3f(0.055, 0.06, 0.07); gloss = 0.55; power = 48.0;
				if (off < CHAMBER_HOLE) { albedo = vec3f(0.006, 0.006, 0.007); gloss = 0.0; }
				else if (off < CHAMBER_HOLE + 0.0007) { albedo = vec3f(0.12, 0.12, 0.13); }
			}
			default: {
				// (the items of the Survival mode: f_itemMaterials.js)
				if (m >= 20) { let im = itemMaterial(m, input.shape); albedo = im.rgb; gloss = im.a; metal = m == 29; }
			}
		}
		let shine = pow(saturate(dot(N, H)), power) * gloss;
		let lit = VU.ambient.x + VU.light.w * diffuse;
		var color = albedo * lit + select(vec3f(0.7, 0.75, 0.85), albedo, metal) * shine * VU.light.w + albedo * 0.4 * VU.ambient.x + itemGlow(m);
		// the glow's light, on whatever is near it
		if (VU.glow.a > 0.0) {
			let d = length(input.shape);
			color += albedo * VU.glow.rgb * VU.glow.a * 0.0025 / (0.0025 + d * d);
		}
		return vec4f(color, 1.0);
	}

	// the colour, and THE MOTION (motionShapes.js: temporalAA.js)
	${motionShapes}
	@fragment
	fn fragmentMain(input: VertexOutput) -> FrameOut {
		return FrameOut(shade(input), vec4f(0.0, 0.0, 0.0, 1.0));
	}
`;
