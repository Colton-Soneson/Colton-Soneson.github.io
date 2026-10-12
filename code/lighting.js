import { settings } from './settings.js';

const smoothstep = (from, to, x) => { const t = Math.min(Math.max((x - from) / (to - from), 0), 1); return t * t * (3 - 2 * t); };

/*
	The light that matters right now: the sun by day, the moon by night. For the things that are worked out once for the whole
	frame and need to know which of the two is doing the lighting (the screen space shadows, the clouds and their shadows).
		direction	towards it, 1 long
		direct		how strong its own light is on a surface square on to it
		ambient		how strong the light from everywhere else is
		daylight	how much daylight there is, 0 to 1: the curve everything lights itself by (smoothstep(-0.08, 0.25, height of the sun))
		moonlight	how strong the moon's light is, 0 with no moon up
		isMoon		true while it is the moon
	direct and ambient are by the same numbers the terrain lights itself by (see the light in vf_terrain.js, and f_moon.js).
*/
export function lightNow() {
	const sunLength = Math.hypot(settings.sunPosX, settings.sunPosY, settings.sunPosZ) || 1;
	const sun = [settings.sunPosX / sunLength, settings.sunPosY / sunLength, settings.sunPosZ / sunLength];
	const daylight = smoothstep(-0.08, 0.25, sun[1]);

	const moonLength = Math.hypot(settings.moonPosX, settings.moonPosY, settings.moonPosZ) || 1;
	const moon = [settings.moonPosX / moonLength, settings.moonPosY / moonLength, settings.moonPosZ / moonLength];
	// (0.75: about how bright the moon's blue is, see moonGlow)
	const moonlight = settings.enableMoon ? 0.75 * settings.moonBrightness * smoothstep(-0.06, 0.12, moon[1]) * (1 - daylight) : 0;

	// whichever of the two is the stronger casts the shadows, and the other's light counts as coming from everywhere
	if (0.72 * daylight >= 0.3 * moonlight) {
		return { direction: sun, direct: 0.72 * daylight, ambient: 0.09 + 0.34 * daylight + 0.2 * moonlight, daylight: daylight, moonlight: moonlight, isMoon: false };
	}
	return { direction: moon, direct: 0.3 * moonlight, ambient: 0.09 + 0.7 * daylight + 0.08 * moonlight, daylight: daylight, moonlight: moonlight, isMoon: true };
}
