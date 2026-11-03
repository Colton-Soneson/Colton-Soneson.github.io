import { makeChunkBuilder } from './terrainGenerator.js'

/*
	Makes terrain chunks off the main thread (see terrain.js, THE WORKER). A chunk is thousands of samples of the noise, a few
	milliseconds each, and flying fast asks for many of them a second: on the main thread that was time taken out of the frames.

	Messages in:
		{ land: generation, tile, params, grids }	a new land: the params it was made from and its chunkGrids (see makeChunkBuilder). In a world of
													tiles (world.js), one of these for each tile, each its own builder
		{ drop: tile }								a tile's builder no longer wanted
		{ generation, tile, x0, z0, size, cells }	make this chunk of that land (of that tile)
	Messages out:
		{ generation, tile, x0, z0, size, vertices, minY, maxY }	the chunk (vertices handed over, not copied)
	A chunk asked for of a land that has since been replaced is not made: the answer would be thrown away anyway.
*/
let generation = -1;
const builders = new Map();		// a land's tile (world.js; 'land' for the one land of old) -> its chunk builder

// (the tile worker's grids come over a port of their own: tileWorker.js)
self.onmessage = (event) => {
	if (event.data.port) { event.data.port.onmessage = heard; return; }
	heard(event);
};
function heard(event) {
	const message = event.data;
	const tile = message.tile ?? 'land';
	if (message.land !== undefined) {
		// (a new land: every tile's builder gone with the old one's. A tile of the same land: added to them)
		if (message.land !== generation) { generation = message.land; builders.clear(); }
		builders.set(tile, makeChunkBuilder(message.params, message.grids));
		return;
	}
	if (message.drop !== undefined) { builders.delete(message.drop); return; }
	const builder = builders.get(tile);
	if (message.generation !== generation || !builder) {
		self.postMessage({ generation: message.generation, tile, x0: message.x0, z0: message.z0, size: message.size, vertices: null });
		return;
	}
	const mesh = builder.buildChunk(message.x0, message.z0, message.size, message.cells);
	self.postMessage({ generation: generation, tile, x0: message.x0, z0: message.z0, size: message.size, vertices: mesh.vertices, minY: mesh.minY, maxY: mesh.maxY }, [mesh.vertices.buffer]);
}
