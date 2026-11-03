/*
	THE SIDES' COLOURS: what a plane's or a schooner's flag shows of its side (plane.js, boat.js: its team), as the shaders have it: 1 red, 2 blue,
	0 none. In the War game mode (war.js) the sides are 'red' and 'blue' and each shows its own; in the Survival mode's wars (survivalWar.js)
	the sides are nations, and each shows as it stands to the one looking (survivalWar.js puts its own in: code)
*/
export const sides = { code: (team) => team == 'red' ? 1 : team == 'blue' ? 2 : 0 };
