/*
	Moonlight, for any shader that lights something. It needs the Lights uniforms of the shader it goes in to have moonPos in them
	(xyz: towards the moon, w: how bright it is. Filled in by getLightsInfo in rotatingCube.js).

	The moon is a second, much weaker sun: cold where the sun is warm, and only worth counting once the sun has gone, so it
	fades in as the daylight fades out. Next to it the sky of a moonlit night gives a little light of its own from all round.
*/
export const moonShapes =
`
	// the moon as a light: its color and how strong it is right now. Nothing while it is under the horizon or the sun is well up
	fn moonGlow() -> vec3f {
		let toMoon = normalize(Lights.moonPos.xyz);
		let risen = smoothstep(-0.06, 0.12, toMoon.y);
		let night = 1.0 - smoothstep(-0.08, 0.25, normalize(Lights.sunPos.xyz).y);
		return vec3f(0.55, 0.7, 1.0) * Lights.moonPos.w * risen * night;
	}

	// what it adds to the light on a surface that faces along normal: a little from the whole sky, more where it faces the moon
	fn moonLight(normal: vec3f) -> vec3f {
		return moonGlow() * (0.08 + 0.3 * saturate(dot(normal, normalize(Lights.moonPos.xyz))));
	}
`;
