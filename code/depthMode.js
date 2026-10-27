import { canvas, gpuInfo, gpuIsFallback } from './deviceSelection.js'
import { PRESETS, detectStartingPreset } from './graphicsPresets.js';

/*
	THE DEPTH BUFFER of the frame: the usual one, or REVERSED-Z.
		the usual		24 bits, 0 at the near plane and 1 at the far plane, things nearer the camera passing the depth test ('less').
						A perspective puts nearly all of its steps close to the camera: far off one step of it spans many world
						units (it grows as the square of the distance), and what is worked out from the depth there flickers
		reversed-Z		32 bit floating point, 1 at the near plane and 0 at the far plane ('greater'). A float's steps are finest
						near 0, which is now far off, and that undoes the perspective's crowding: the depth is about as fine at
						every distance (far off, about a thousand times finer than the usual)
	Which is decided once, as the page loads, because every pipeline that draws into the frame's depth is made with it: what the
	user last chose (a graphics preset picked, or the setting ticked: remembered in the browser, REMEMBERED), otherwise what the
	preset the page starts on has (graphicsPresets.js: on for High and Ultra). Choosing differently later takes effect when the
	page is loaded again.
	Everything that draws into the frame's depth, clears it, or reads it back (the sky, the screen space shadows and ambient
	occlusion, the light shafts, the point lights, the clouds) asks here: DEPTH_FORMAT, depthTest, DEPTH_CLEAR, and in its
	shader depthShapes (shaders/js/depthShapes.js). The rifle's, the gun in the hands' and the forest's bake each keep their own
	depth, the usual way: they have projections of their own. So do the shadow maps and the height map
*/
const REMEMBERED = 'reversedDepth';

function decide() {
	// (for testing: ?depth=reversed or ?depth=usual in the page's address)
	const asked = new URLSearchParams(location.search).get('depth');
	if (asked == 'reversed' || asked == 'usual') return asked == 'reversed';
	try {
		const saved = localStorage.getItem(REMEMBERED);
		if (saved === '1' || saved === '0') return saved === '1';
	} catch (e) { /* (no storage: from the preset) */ }
	const start = detectStartingPreset({
		gpu: gpuInfo,
		fallback: gpuIsFallback,
		mobile: navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent),
		pixels: canvas.width * canvas.height,
		memory: navigator.deviceMemory ?? 0,
	});
	return !!PRESETS[start.preset]?.reversedDepth;
}
export const reversedDepth = decide();
export const DEPTH_FORMAT = reversedDepth ? 'depth32float' : 'depth24plus';
// what the depth is cleared to: nothing drawn, as far away as it gets
export const DEPTH_CLEAR = reversedDepth ? 0.0 : 1.0;
// a depth test written the usual way ('less': nearer passes), as it is in this mode
const FLIPPED = { 'less': 'greater', 'less-equal': 'greater-equal', 'greater': 'less', 'greater-equal': 'less-equal' };
export const depthTest = (compare) => reversedDepth ? FLIPPED[compare] ?? compare : compare;
// the user's choice, for the next time the page loads (imguiLoader.js)
export function rememberDepthChoice(on) {
	try { localStorage.setItem(REMEMBERED, on ? '1' : '0'); } catch (e) { /* (nowhere to keep it) */ }
}
