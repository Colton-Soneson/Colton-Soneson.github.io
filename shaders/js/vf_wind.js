/*
	The wind at a place, for any shader that has something the wind moves. See wind.js for the texture this reads and how it is made.

	A shader that wants it binds the wind texture and its sampler under the names windTexture and windSampler, puts the two rows
	of numbers from windUniformValues() (wind.js) somewhere in its uniforms, and puts windShapes into its code.

	The texture is read twice: once wide, for the gusts, and once five times finer and sliding twice as fast, for the smaller
	stirrings inside them. (5 and 10 are whole numbers on purpose: the slide is kept inside one tile, and when it wraps round,
	a whole number of tiles is all the finer reading jumps by, which is no jump at all.)
*/
export const windShapes =
`
	// The wind at a place on the ground.
	//		scroll	xy: how far the wind texture has slid, z: 1 / the size of a tile, w: how hard the wind pushes
	//		blow	xy: the way the wind blows (1 long), z: gustiness, w: time in seconds
	// Returns xy: the wind there along x and z, about 1 long in a steady breeze, nothing in a calm, 2 in the middle of a gust.
	//		z: how much of a gust the place is in, 0 to 1. w: turbulence, -1 to 1, for the flutter of small things
	fn windAt(xz: vec2f, scroll: vec4f, blow: vec4f) -> vec4f {
		let wide = textureSampleLevel(windTexture, windSampler, (xz - scroll.xy) * scroll.z, 0.0);
		let fine = textureSampleLevel(windTexture, windSampler, (xz * 5.0 - scroll.xy * 10.0) * scroll.z + vec2f(0.37, 0.61), 0.0);

		let gust = smoothstep(0.25, 0.75, wide.r * 0.6 + fine.r * 0.4);
		let strength = scroll.w * (1.0 + (2.0 * gust - 1.0) * blow.z);
		// the air does not all go the same way: it is turned aside round the gusts
		let swirl = (wide.ba * 2.0 - 1.0) + 0.5 * (fine.ba * 2.0 - 1.0);
		let direction = normalize(blow.xy + swirl * 0.6 * blow.z);
		return vec4f(direction * strength, gust, fine.g * 2.0 - 1.0);
	}
`;
