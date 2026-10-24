import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Noise2D } from './Noise';

const _color = new THREE.Color();

/**
 * Normalises a geometry for merging: indexed, position + normal + color + aTint only.
 * The colour is baked into a vertex-colour attribute so many parts can share one material.
 */
export function prep(geo: THREE.BufferGeometry, color?: THREE.ColorRepresentation, tint = 0): THREE.BufferGeometry {
	let g = geo;
	if (!g.index) {
		g = mergeVerticesSafe(g);
	}
	for (const name of Object.keys(g.attributes)) {
		if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
	}
	// aTint = 1 marks vertices that take the per-instance colour (petals, caps); 0 keeps the baked colour.
	g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(tint), 1));
	if (!g.attributes.normal) g.computeVertexNormals();
	if (color !== undefined || !g.attributes.color) {
		_color.set(color ?? 0xffffff);
		const count = g.attributes.position.count;
		const arr = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			arr[i * 3] = _color.r;
			arr[i * 3 + 1] = _color.g;
			arr[i * 3 + 2] = _color.b;
		}
		g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
	}
	return g;
}

function mergeVerticesSafe(g: THREE.BufferGeometry): THREE.BufferGeometry {
	const count = g.attributes.position.count;
	const index = new Uint32Array(count);
	for (let i = 0; i < count; i++) index[i] = i;
	g.setIndex(new THREE.BufferAttribute(index, 1));
	return g;
}

/** Merge prepared geometries into one (all must be produced by `prep`). */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
	const merged = mergeGeometries(geos, false);
	for (const g of geos) g.dispose();
	if (!merged) throw new Error('Failed to merge geometries');
	return merged;
}

export function place(
	geo: THREE.BufferGeometry,
	x: number,
	y: number,
	z: number,
	rx = 0,
	ry = 0,
	rz = 0,
	sx = 1,
	sy = sx,
	sz = sx
): THREE.BufferGeometry {
	const m = new THREE.Matrix4().compose(
		new THREE.Vector3(x, y, z),
		// YXZ: tilt (x) first, then yaw (y) — "lean outward, then spin around the stem".
		new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
		new THREE.Vector3(sx, sy, sz)
	);
	geo.applyMatrix4(m);
	return geo;
}

/** Shade vertices along an axis from colour a (low) to colour b (high). */
export function gradientY(geo: THREE.BufferGeometry, a: THREE.ColorRepresentation, b: THREE.ColorRepresentation): THREE.BufferGeometry {
	const ca = new THREE.Color(a);
	const cb = new THREE.Color(b);
	const pos = geo.attributes.position;
	geo.computeBoundingBox();
	const min = geo.boundingBox!.min.y;
	const max = geo.boundingBox!.max.y;
	const arr = new Float32Array(pos.count * 3);
	for (let i = 0; i < pos.count; i++) {
		const t = (pos.getY(i) - min) / Math.max(0.0001, max - min);
		_color.copy(ca).lerp(cb, t);
		arr[i * 3] = _color.r;
		arr[i * 3 + 1] = _color.g;
		arr[i * 3 + 2] = _color.b;
	}
	geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
	return geo;
}

const blobNoise = new Noise2D(4242);

/** Lumpy sphere used for canopies, bushes and clouds. */
export function blob(radius: number, detail: number, lumpiness: number, seed: number): THREE.BufferGeometry {
	const geo = new THREE.IcosahedronGeometry(radius, detail);
	const pos = geo.attributes.position;
	const v = new THREE.Vector3();
	// Icosahedron is non-indexed with duplicated verts; displace deterministically by position so seams stay closed.
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		const n = blobNoise.noise(v.x * 0.9 + seed * 3.1, v.y * 0.9 + v.z * 0.7 - seed);
		v.multiplyScalar(1 + n * lumpiness);
		pos.setXYZ(i, v.x, v.y, v.z);
	}
	const merged = mergeVerticesByPosition(geo);
	merged.computeVertexNormals();
	return merged;
}

/** Collapses duplicate vertices so normals are smooth (icosahedrons come non-indexed). */
export function mergeVerticesByPosition(geo: THREE.BufferGeometry): THREE.BufferGeometry {
	const pos = geo.attributes.position;
	const map = new Map<string, number>();
	const newPos: number[] = [];
	const index: number[] = [];
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const y = pos.getY(i);
		const z = pos.getZ(i);
		const key = `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
		let idx = map.get(key);
		if (idx === undefined) {
			idx = newPos.length / 3;
			newPos.push(x, y, z);
			map.set(key, idx);
		}
		index.push(idx);
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
	out.setIndex(index);
	geo.dispose();
	return out;
}

/** Extracts flat arrays for a Rapier trimesh collider (world transform applied). */
export function trimeshData(geo: THREE.BufferGeometry, matrix?: THREE.Matrix4): { vertices: Float32Array; indices: Uint32Array } {
	const g = matrix ? geo.clone().applyMatrix4(matrix) : geo;
	const pos = g.attributes.position;
	const vertices = new Float32Array(pos.count * 3);
	for (let i = 0; i < pos.count; i++) {
		vertices[i * 3] = pos.getX(i);
		vertices[i * 3 + 1] = pos.getY(i);
		vertices[i * 3 + 2] = pos.getZ(i);
	}
	let indices: Uint32Array;
	if (g.index) {
		indices = new Uint32Array(g.index.count);
		for (let i = 0; i < g.index.count; i++) indices[i] = g.index.getX(i);
	} else {
		indices = new Uint32Array(pos.count);
		for (let i = 0; i < pos.count; i++) indices[i] = i;
	}
	if (matrix) g.dispose();
	return { vertices, indices };
}

/** Canvas texture helper for small procedural textures (stripes, checkers). */
export function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d')!;
	draw(ctx);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	return tex;
}
