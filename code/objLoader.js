/*
	Loading .obj model files. Each of the four loaders below reads one part of a file (the vertices, the uvs, the normals, the
	faces), and a model needs all four. They share one download of the file (fileText): it is fetched once, however many of
	them read it, instead of once for each. And prefetchFiles starts the downloads of a whole list of files at once, so they
	come in side by side instead of one after another (see the top of models/primitives.js).
*/
const downloads = new Map();	// url -> the promise of its text, or of its blob for a picture

// the text of a file, fetched the first time it is asked for
export function fileText(url) {
	if (!downloads.has(url)) {
		downloads.set(url, fetch(url).then((response) => response.text()));
	}
	return downloads.get(url);
}

// the same for a picture (a texture), as a blob
export function fileBlob(url) {
	if (!downloads.has(url)) {
		downloads.set(url, fetch(url).then((response) => response.blob()));
	}
	return downloads.get(url);
}

// starts every download on the list now. Pictures (.png, .jpg) as blobs, the rest as text
export function prefetchFiles(urls) {
	for (const url of urls) {
		if (/\.(png|jpe?g)$/i.test(url)) fileBlob(url);
		else fileText(url);
	}
}

export async function loadObjFileVerts(url) {
    const text = await fileText(url);
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
	
	//console.log(vertices);
    return new Float32Array(vertices);
}

export async function loadObjFileUVs(url) {
    const text = await fileText(url);
    const UVs = [];
	
	console.log("Model UV Load");

    const lines = text.split('\n');
    for (const line of lines) {
        const parts = line.trim().split(' ');
        if (parts[0] === 'vt') {
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            UVs.push(x, y);
        }
    }
	
	//console.log(UVs);
    return new Float32Array(UVs);
}

export async function loadObjFileNormals(url) {
    const text = await fileText(url);
    const normals = [];
	
	console.log("Model Normal Load");

    const lines = text.split('\n');
    for (const line of lines) {
        const parts = line.trim().split(' ');
        if (parts[0] === 'vn') {
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const z = parseFloat(parts[3]);
            normals.push(x, y, z);
        }
    }
	
	//console.log(normals);
    return new Float32Array(normals);
}

//THIS IS ESSENTIALLY A LIST OF LOCATIONS
//includes v, vt, and vn in that order
//  pushing 9 element LOCATIONS at a time: 3 v, 3 vt, 3 vn
//		push in as same order file makes it to be: v1,vt1,vn1,v2,vt2,vn2,...
export async function loadObjFileFaces(url) {
    const text = await fileText(url);
    const faces = [];
	
	console.log("Model Face Load");

    const lines = text.split('\n');
    for (const line of lines) {
        const parts = line.trim().split(' ');		
        if (parts[0] === 'f') {
			const subParts1 = parts[1].split('/');
			const subParts2 = parts[2].split('/');
			const subParts3 = parts[3].split('/');
			
			//v1, vt1, vn1
			faces.push(parseFloat(subParts1[0]));
			faces.push(parseFloat(subParts1[1]));
			faces.push(parseFloat(subParts1[2]));
			
			//v2, vt2, vn2
			faces.push(parseFloat(subParts2[0]));
			faces.push(parseFloat(subParts2[1]));
			faces.push(parseFloat(subParts2[2]));
			
			//v3, vt3, vn3
			faces.push(parseFloat(subParts3[0]));
			faces.push(parseFloat(subParts3[1]));
			faces.push(parseFloat(subParts3[2]));
        }
    }
	
	//console.log(faces);
    return new Float32Array(faces);
}

