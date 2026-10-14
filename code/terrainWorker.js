import { makeChunkBuilder } from './terrainGenerator.js'

/*
	Makes terrain chunks off the main thread (see terrain.js, THE WORKER). A chunk is thousands of samples of the noise, a few
	milliseconds each, and flying fast asks for many of them a second: on the main thread that was time taken out of the frames.

	Messages in:
		{ land: generation, params, grids }		a new land: the params it was made from and its chunkGrids (see makeChunkBuilder)
		{ generation, x0, z0, size, cells }		make this chunk of that land
	Messages out:
		{ generation, x0, z0, size, vertices, minY, maxY }		the chunk (vertices handed over, not copied)
	A chunk asked for of a land that has since been replaced is not made: the answer would be thrown away anyway.
*/
let generation = -1;
let builder = null;

self.onmessage = (event) => {
	const message = event.data;
	if (message.land !== undefined) {
		generation = message.land;
		builder = makeChunkBuilder(message.params, message.grids);
		return;
	}
	if (message.generation !== generation || !builder) {
		self.postMessage({ generation: message.generation, x0: message.x0, z0: message.z0, size: message.size, vertices: null });
		return;
	}
	const mesh = builder.buildChunk(message.x0, message.z0, message.size, message.cells);
	self.postMessage({ generation: generation, x0: message.x0, z0: message.z0, size: message.size, vertices: mesh.vertices, minY: mesh.minY, maxY: mesh.maxY }, [mesh.vertices.buffer]);
};
