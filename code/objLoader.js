export async function loadObjFileVerts(url) {
    const response = await fetch(url);
    const text = await response.text();
    const vertices = [];
	
	console.log("Model Vert Load");
	
    const lines = text.split('\n');
    for (const line of lines) {
        const parts = line.trim().split(' ');
        if (parts[0] === 'v') {
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const z = parseFloat(parts[3]);
            vertices.push(x, y, z);
        }
    }
	
	console.log(vertices);
    return new Float32Array(vertices);
}

//cant have n or vt right now
export async function loadObjFileFaces(url) {
    const response = await fetch(url);
    const text = await response.text();
    const faces = [];
	
	console.log("Model Face Load");

    const lines = text.split('\n');
    for (const line of lines) {
        const parts = line.trim().split(' ');
        if (parts[0] === 'f') {
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const z = parseFloat(parts[3]);
            faces.push(x, y, z);
        }
    }
	
	console.log(faces);
    return new Float32Array(faces);
}