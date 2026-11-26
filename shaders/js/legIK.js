/*
	THE LEGS, by inverse kinematics (vf_dummy.js's people, vf_deer.js, vf_horse.js, vf_props.js's four-legged animals). A leg is two bones
	in the plane it swings in (the body's own y up and z forward, its x left as it is): the hip (or the shoulder) to the knee, and the knee
	to the foot. Where the foot is to be is worked out first (legStep: on the ground and going back under the body for half its stride, as
	fast as the body goes on over it, then lifted and brought forward again), and the two bones are laid to reach it (legReach), within
	THE BONE RESTRICTIONS:
		the knee bends one way only (bend: +1 its point forward, a person's knee, a four-legged animal's front knee (the wrist); -1 its point
			behind, a hind leg's hock), from flex.x to flex.y radians and no further either way: never through straight and back the wrong
			way, as a leg swung about from its hip with its shin turned by a fixed amount does on one side of its stride
		the hip swings from swing.x to swing.y radians
	A foot out of reach is reached towards as far as the leg goes. Every angle is from straight down, + towards +z (forward). legMove then
	takes a point of the leg as it was made (standing straight, the hip over the knee over the foot) to where the bones have it.
*/
export const legIK = `
	// a point turned about x by angle, so that straight down goes to that angle (+ towards +z)
	fn legTurn(v: vec3f, angle: f32) -> vec3f {
		let c = cos(angle);
		let s = sin(angle);
		return vec3f(v.x, v.y * c + v.z * s, -v.y * s + v.z * c);
	}
	// the foot in its stride, (y, z) from rest (where it stands): going forward through the air while sin(phase) > 0, lifted lift at
	//		the most; on the ground going back the rest. half: half its stride
	fn legStep(rest: vec2f, phase: f32, half: f32, lift: f32) -> vec2f {
		return rest + vec2f(lift * max(sin(phase), 0.0), -half * cos(phase));
	}
	// how far the body comes down for a leg of length long (hip to foot, straight) to reach half a stride either way with its foot on the
	//		ground, and a little more (give, a share of long) so that the knee is never quite straight under it
	fn legDrop(long: f32, half: f32, give: f32) -> f32 {
		return long - sqrt(max(long * long - half * half, 0.0)) + give * long;
	}
	// the two bones laid to reach the foot ((y, z), hip the same): x the thigh's angle, y the shin's, zw where the knee is (y, z)
	fn legReach(hip: vec2f, upper: f32, lower: f32, foot: vec2f, bend: f32, flex: vec2f, swing: vec2f) -> vec4f {
		let D = foot - hip;
		let far = max(length(D), 1e-5);
		let toward = atan2(D.y, -D.x);
		// (the reach the knee's restriction allows: straightest, the furthest; bent the most, the nearest)
		let most = sqrt(upper * upper + lower * lower + 2.0 * upper * lower * cos(flex.x));
		let least = sqrt(upper * upper + lower * lower + 2.0 * upper * lower * cos(flex.y));
		let d = clamp(far, least, most);
		let open = acos(clamp((upper * upper + d * d - lower * lower) / (2.0 * upper * d), -1.0, 1.0));
		let thigh = clamp(toward + bend * open, swing.x, swing.y);
		let knee = hip + upper * vec2f(-cos(thigh), sin(thigh));
		// the shin from there to the foot (where it can be reached), its bend kept within the knee's restriction
		let S = hip + D / far * d - knee;
		let off = thigh - atan2(S.y, -S.x);
		let bent = clamp(atan2(sin(off), cos(off)) * bend, flex.x, flex.y);
		return vec4f(thigh, thigh - bend * bent, knee);
	}
	// a point of the leg as it was made (the hip at hip, the knee straight under it at kneeY) where the bones have it (legReach's): the
	//		thigh's (above) about the hip, the shin's about the knee, taken to where the knee is now
	fn legMove(p: vec3f, hip: vec3f, kneeY: f32, above: bool, pose: vec4f) -> vec3f {
		if (above) {
			return hip + legTurn(p - hip, pose.x);
		}
		return vec3f(p.x, pose.z, pose.w) + legTurn(p - vec3f(p.x, kneeY, hip.z), pose.y);
	}
`;
