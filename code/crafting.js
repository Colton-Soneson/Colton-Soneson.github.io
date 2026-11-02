import { ITEMS, makeItem } from './items.js'
import * as inventory from './inventory.js'
import * as loot from './loot.js'

/*
	THE CRAFTING of the Survival mode: what is laid out in the six by six grid on the inventory screen (inventoryUI.js; inventory.js keeps it), in
	any order and anywhere in it, against the RECIPES. It makes something when it has at least what a recipe needs of each kind, and nothing of
	any other kind in the way. Only what the recipe needs is used up: the rest of a stack stays where it is.
	What it makes stands in the output slot (outputNow) until it is dragged out into the inventory or off on to the ground (take): only then is
	what went into it used up. It all happens in the player's own inventory, so there is nothing about it to send: what comes of it on the ground
	goes the way anything put down goes (loot.js).
*/
export const RECIPES = [
	{ makes: 'trap', count: 1, needs: { firewood: 1, sinew: 1 } },
	{ makes: 'smelter', count: 1, needs: { rock: 3 } },
	{ makes: 'anvil', count: 1, needs: { ironBar: 3 } },
	{ makes: 'mortar', count: 1, needs: { rock: 2, firewood: 1 } },
	{ makes: 'bedroll', count: 1, needs: { deerHide: 1 } },
	{ makes: 'bedroll', count: 1, needs: { mooseHide: 1 } },
	{ makes: 'bedroll', count: 1, needs: { bearHide: 1 } },
];

function laidOut() {
	const counts = {};
	for (const item of inventory.inv.craft) counts[item.type] = (counts[item.type] ?? 0) + item.count;
	return counts;
}
export function recipeNow() {
	const counts = laidOut(), kinds = Object.keys(counts);
	if (!kinds.length) return null;
	return RECIPES.find((r) => kinds.every((k) => r.needs[k]) && Object.entries(r.needs).every(([k, n]) => (counts[k] ?? 0) >= n)) ?? null;
}
// what stands in the output slot: the same thing until the recipe changes (it is what is being dragged)
let shown = null;
export function outputNow() {
	const recipe = recipeNow();
	if (!recipe) { shown = null; return null; }
	if (shown?.recipe !== recipe) shown = { recipe, item: makeItem(recipe.makes, recipe.count) };
	return shown.item;
}
// what the recipe took out of the grid. Gives the thing made (it is the caller's to put somewhere), or null
export function take() {
	const recipe = recipeNow();
	if (!recipe) return null;
	const made = shown?.recipe === recipe ? shown.item : makeItem(recipe.makes, recipe.count);
	for (const [type, need] of Object.entries(recipe.needs)) {
		let left = need;
		for (const item of [...inventory.inv.craft]) {
			if (item.type != type || left <= 0) continue;
			const part = Math.min(item.count, left);
			left -= part;
			item.count -= part;
			if (item.count <= 0) inventory.remove(item);
		}
	}
	shown = null;
	inventory.changed();
	return made;
}
// made, and off into the inventory wherever it fits, or on the ground
export function makeIntoInventory() {
	const made = take();
	if (made && !inventory.give(made)) loot.dropHere([made]);
	return !!made;
}
export const describe = (recipe) => `${ITEMS[recipe.makes].name}: ${Object.entries(recipe.needs).map(([k, n]) => `${n} ${ITEMS[k].name.toLowerCase()}`).join(' + ')}`;
