import { device } from './deviceSelection.js'

/*
	THE RAGDOLLS' LIMBS, as the dummy's shader reads them (ragdolls.js writes them, vf_dummy.js: THE RAGDOLL): for each ragdoll RAG_PARTS
	parts of the dummy (the pelvis, the chest, the head, the upper arms and forearms, the thighs and shins, what it held), each a 3 by 4
	matrix (3 vec4s: a row each, its translation in w) from the mesh as it was made (metres) to the world. On its own, so the shaders'
	users (players.js, townFolk.js, outfits.js) can bind it without anything else
*/
export const RAG_MOST = 24;
export const RAG_PARTS = 12;
export const RAG_PART_FLOATS = 12;
export const RAG_BINDING = 4;
export const ragBuffer = device.createBuffer({ label: 'ragdoll limbs', size: RAG_MOST * RAG_PARTS * RAG_PART_FLOATS * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
export const ragEntry = () => ({ binding: RAG_BINDING, resource: { buffer: ragBuffer } });
