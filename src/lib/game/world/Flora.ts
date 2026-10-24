import * as THREE from 'three';
import { Random } from '../utils/Random';
import { blob, gradientY, merge, place, prep } from '../utils/geometry';
import { Noise2D } from '../utils/Noise';

/**
 * Procedural prototype meshes for scattered vegetation and rocks. Every prototype is one
 * merged geometry with baked vertex colours (and an aGlow mask), so a whole layer of a
 * chunk renders as a single instanced draw.
 */

const noise = new Noise2D(9091);
const _v = new THREE.Vector3();
const _col = new THREE.Color();

/** Displace a cylinder-ish geometry radially with noise and twist it around Y. */
function gnarl(geo: THREE.BufferGeometry, amount: number, twist: number, seed: number): THREE.BufferGeometry {
	const pos = geo.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		_v.fromBufferAttribute(pos, i);
		const a = Math.atan2(_v.z, _v.x);
		const r = Math.hypot(_v.x, _v.z);
		const n = noise.noise(a * 1.6 + seed, _v.y * 0.35 + seed * 2.1);
		const r2 = r * (1 + n * amount);
		const a2 = a + _v.y * twist;
		pos.setXYZ(i, Math.cos(a2) * r2, _v.y, Math.sin(a2) * r2);
	}
	geo.computeVertexNormals();
	return geo;
}

/** Colour vertices by their normal's Y: upward-facing faces take `top` (moss, snow, light). */
function topTint(geo: THREE.BufferGeometry, top: THREE.ColorRepresentation, threshold = 0.55, amount = 1): THREE.BufferGeometry {
	const n = geo.attributes.normal;
	const c = geo.attributes.color;
	const t = new THREE.Color(top);
	for (let i = 0; i < n.count; i++) {
		const k = THREE.MathUtils.smoothstep(n.getY(i), threshold, 1) * amount;
		_col.setRGB(c.getX(i), c.getY(i), c.getZ(i)).lerp(t, k);
		c.setXYZ(i, _col.r, _col.g, _col.b);
	}
	return geo;
}

/** Darken vertices toward the bottom of a canopy blob (fake ambient occlusion). */
function canopyShade(geo: THREE.BufferGeometry, light: THREE.ColorRepresentation, dark: THREE.ColorRepresentation): THREE.BufferGeometry {
	const pos = geo.attributes.position;
	const n = geo.attributes.normal;
	const arr = new Float32Array(pos.count * 3);
	const cl = new THREE.Color(light);
	const cd = new THREE.Color(dark);
	for (let i = 0; i < pos.count; i++) {
		const k = THREE.MathUtils.clamp(n.getY(i) * 0.5 + 0.5, 0, 1);
		_col.copy(cd).lerp(cl, k * k);
		arr[i * 3] = _col.r;
		arr[i * 3 + 1] = _col.g;
		arr[i * 3 + 2] = _col.b;
	}
	geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
	return geo;
}

function canopyBlob(r: number, detail: number, light: number, dark: number, seed: number): THREE.BufferGeometry {
	const g = blob(r, detail, 0.22, seed);
	g.computeVertexNormals();
	canopyShade(g, light, dark);
	return prep(g);
}

// ------------------------------------------------------------------ trees

export function ancientTree(seed: number): THREE.BufferGeometry {
	const rng = new Random(seed);
	const parts: THREE.BufferGeometry[] = [];
	const trunk = new THREE.CylinderGeometry(1.0, 1.9, 14, 14, 10);
	trunk.translate(0, 6.6, 0);
	gnarl(trunk, 0.22, 0.05, seed);
	gradientY(trunk, 0x2a1d14, 0x5a4636);
	parts.push(prep(trunk));
	// Buttress roots.
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * Math.PI * 2 + rng.range(-0.3, 0.3);
		const root = new THREE.CylinderGeometry(0.12, 0.85, 5.5, 7, 3);
		root.translate(0, 2.75, 0);
		gradientY(root, 0x3b2a1c, 0x2a1d14);
		place(root, Math.cos(a) * 0.9, -0.4, Math.sin(a) * 0.9, rng.range(1.0, 1.25), -a + Math.PI / 2, 0, 1, 1, 1);
		parts.push(prep(root));
	}
	// Branches.
	for (let i = 0; i < 4; i++) {
		const a = (i / 4) * Math.PI * 2 + rng.range(-0.4, 0.4);
		const br = new THREE.CylinderGeometry(0.25, 0.6, 7, 7, 2);
		br.translate(0, 3.5, 0);
		gradientY(br, 0x3e2c1e, 0x5a4636);
		place(br, Math.cos(a) * 0.4, rng.range(10, 12.5), Math.sin(a) * 0.4, rng.range(0.75, 1.0), -a + Math.PI / 2, 0, 1, 1, 1);
		parts.push(prep(br));
	}
	// Layered canopy.
	const canopy = [
		[0, 19.5, 0, 6.5],
		[4.8, 16.5, 1.5, 5.2],
		[-4.2, 17, -2.5, 5.4],
		[1.5, 16.2, -5, 4.8],
		[-2.5, 15.8, 4.5, 4.8],
		[3.5, 21, -2.5, 4.2],
		[-3, 21.5, 2, 4]
	];
	canopy.forEach(([x, y, z, r], i) => {
		const g = canopyBlob(r * rng.range(0.9, 1.1), 1, 0x3f8a5a, 0x0e3326, seed * 13 + i);
		place(g, x, y, z, 0, rng.range(0, 6), 0, 1, 0.78, 1);
		parts.push(g);
	});
	// Bioluminescent hanging moss.
	for (let i = 0; i < 16; i++) {
		const a = rng.range(0, Math.PI * 2);
		const r = rng.range(2.5, 6.5);
		const len = rng.range(1.5, 3.8);
		const strand = new THREE.CylinderGeometry(0.06, 0.16, len, 4, 1);
		strand.translate(0, -len / 2, 0);
		const g = prep(strand, 0x7ff0d8, 1);
		place(g, Math.cos(a) * r, rng.range(13.5, 15.5), Math.sin(a) * r);
		parts.push(g);
	}
	return merge(parts);
}

export function forestTree(seed: number, light = 0x4f9a52, dark = 0x143a22, bark = 0x4a3526): THREE.BufferGeometry {
	const rng = new Random(seed);
	const parts: THREE.BufferGeometry[] = [];
	const trunk = new THREE.CylinderGeometry(0.28, 0.5, 7, 7, 4);
	trunk.translate(0, 3.5, 0);
	gnarl(trunk, 0.15, 0.06, seed);
	gradientY(trunk, 0x2c1f15, bark);
	parts.push(prep(trunk));
	const blobs = [
		[0, 8.4, 0, 3.2],
		[1.8, 7, 0.6, 2.4],
		[-1.6, 7.2, -0.9, 2.5],
		[0.3, 9.9, -0.4, 2.1]
	];
	blobs.forEach(([x, y, z, r], i) => {
		const g = canopyBlob(r * rng.range(0.85, 1.15), 1, light, dark, seed * 7 + i);
		place(g, x, y, z, 0, rng.range(0, 6), 0, 1, 0.85, 1);
		parts.push(g);
	});
	return merge(parts);
}

/** Low-detail stand-in used by distant chunks. */
export function treeLod(height: number, radius: number, light: number, dark: number): THREE.BufferGeometry {
	const trunk = new THREE.CylinderGeometry(radius * 0.12, radius * 0.18, height * 0.6, 5, 1);
	trunk.translate(0, height * 0.3, 0);
	const crown = new THREE.IcosahedronGeometry(radius, 0);
	crown.computeVertexNormals();
	canopyShade(crown, light, dark);
	place(crown, 0, height * 0.75, 0, 0, 0, 0, 1, 0.8, 1);
	return merge([prep(trunk, 0x3a2a1e), prep(crown)]);
}

export function pineTree(seed: number): THREE.BufferGeometry {
	const rng = new Random(seed);
	const parts: THREE.BufferGeometry[] = [];
	const trunk = new THREE.CylinderGeometry(0.15, 0.35, 9, 6, 2);
	trunk.translate(0, 4.5, 0);
	parts.push(prep(trunk, 0x3b2a20));
	const tiers = 5;
	for (let i = 0; i < tiers; i++) {
		const t = i / (tiers - 1);
		const r = THREE.MathUtils.lerp(3.0, 0.9, t) * rng.range(0.9, 1.1);
		const h = THREE.MathUtils.lerp(3.2, 2.0, t);
		const cone = new THREE.ConeGeometry(r, h, 8, 1);
		cone.translate(0, h / 2, 0);
		gnarl(cone, 0.1, 0, seed + i);
		gradientY(cone, 0x1b3a3a, 0x3f7a62);
		place(cone, 0, 2.5 + i * 1.7, 0, 0, rng.range(0, 6));
		parts.push(prep(cone));
	}
	return merge(parts);
}

export function deadTree(seed: number): THREE.BufferGeometry {
	const rng = new Random(seed);
	const parts: THREE.BufferGeometry[] = [];
	const trunk = new THREE.CylinderGeometry(0.22, 0.55, 8, 7, 5);
	trunk.translate(0, 4, 0);
	gnarl(trunk, 0.2, 0.12, seed);
	gradientY(trunk, 0x2b2430, 0x6b6070);
	parts.push(prep(trunk));
	const branch = (x: number, y: number, z: number, len: number, rx: number, ry: number, r: number, depth: number) => {
		const b = new THREE.CylinderGeometry(r * 0.4, r, len, 5, 1);
		b.translate(0, len / 2, 0);
		gradientY(b, 0x4a4050, 0x7b7080);
		place(b, x, y, z, rx, ry, 0);
		parts.push(prep(b));
		if (depth > 0) {
			const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
			const tip = new THREE.Vector3(0, len, 0).applyMatrix4(m);
			for (let k = 0; k < 2; k++) branch(tip.x, tip.y, tip.z, len * 0.6, rx + rng.range(-0.5, 0.5), ry + rng.range(-1.2, 1.2), r * 0.55, depth - 1);
		}
	};
	for (let i = 0; i < 4; i++) branch(0, rng.range(4.5, 7), 0, rng.range(2.5, 3.5), rng.range(0.6, 1.1), (i / 4) * Math.PI * 2 + rng.range(-0.4, 0.4), 0.22, 1);
	return merge(parts);
}

export function bush(seed: number, light = 0x5a9a48, dark = 0x1c3a1c): THREE.BufferGeometry {
	const rng = new Random(seed);
	const parts: THREE.BufferGeometry[] = [];
	for (let i = 0; i < 4; i++) {
		const g = canopyBlob(rng.range(0.7, 1.1), 1, light, dark, seed + i);
		place(g, rng.range(-0.8, 0.8), rng.range(0.5, 0.9), rng.range(-0.8, 0.8), 0, 0, 0, 1, 0.8, 1);
		parts.push(g);
	}
	return merge(parts);
}

export function fern(seed: number): THREE.BufferGeometry {
	const rng = new Random(seed);
	const parts: THREE.BufferGeometry[] = [];
	const fronds = 8;
	for (let i = 0; i < fronds; i++) {
		const a = (i / fronds) * Math.PI * 2 + rng.range(-0.2, 0.2);
		const len = rng.range(1.1, 1.6);
		// Arched frond: three-segment strip with a pinnate silhouette.
		const pos: number[] = [];
		const segs = 4;
		for (let s = 0; s <= segs; s++) {
			const t = s / segs;
			const w = Math.sin(t * Math.PI) * 0.28 + 0.02;
			const y = Math.sin(t * Math.PI * 0.75) * 0.75;
			const r = t * len;
			pos.push(-w, y, r, w, y, r);
		}
		const idx: number[] = [];
		for (let s = 0; s < segs; s++) {
			const b = s * 2;
			idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
		}
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
		g.setIndex(idx);
		g.computeVertexNormals();
		gradientY(g, 0x1f5a3a, 0x6fc070);
		place(g, 0, 0, 0, 0, a, 0);
		parts.push(prep(g));
	}
	return merge(parts);
}

export function glowMushrooms(seed: number, capColor: number): THREE.BufferGeometry {
	const rng = new Random(seed);
	const parts: THREE.BufferGeometry[] = [];
	const n = 3 + rng.int(0, 2);
	for (let i = 0; i < n; i++) {
		const s = i === 0 ? 1 : rng.range(0.4, 0.75);
		const x = i === 0 ? 0 : rng.range(-0.7, 0.7);
		const z = i === 0 ? 0 : rng.range(-0.7, 0.7);
		const h = 0.8 * s;
		const stem = new THREE.CylinderGeometry(0.07 * s, 0.11 * s, h, 6);
		stem.translate(0, h / 2, 0);
		parts.push(prep(place(stem, x, 0, z, rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15)), 0xd8e6e0, 0.25));
		const cap = new THREE.SphereGeometry(0.42 * s, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
		cap.scale(1, 0.62, 1);
		parts.push(prep(place(cap, x, h * 0.95, z), capColor, 1));
		const gill = new THREE.CircleGeometry(0.4 * s, 10);
		gill.rotateX(Math.PI / 2);
		parts.push(prep(place(gill, x, h * 0.95, z), 0x203a3a, 0.4));
	}
	return merge(parts);
}

export function glowFlowers(seed: number, bulb: number): THREE.BufferGeometry {
	const rng = new Random(seed);
	const parts: THREE.BufferGeometry[] = [];
	for (let i = 0; i < 5; i++) {
		const h = rng.range(0.5, 1.1);
		const x = rng.range(-0.35, 0.35);
		const z = rng.range(-0.35, 0.35);
		const tilt = rng.range(-0.25, 0.25);
		const stem = new THREE.CylinderGeometry(0.015, 0.025, h, 4);
		stem.translate(0, h / 2, 0);
		parts.push(prep(place(stem, x, 0, z, tilt, rng.range(0, 6), 0), 0x2f6a4a));
		const b = new THREE.SphereGeometry(0.07, 6, 4);
		b.scale(1, 1.4, 1);
		parts.push(prep(place(b, x + Math.sin(tilt) * h * 0.3, h, z), bulb, 1));
		const leaf = new THREE.PlaneGeometry(0.1, 0.35);
		leaf.translate(0, 0.17, 0);
		parts.push(prep(place(leaf, x, 0.05, z, 0.6, rng.range(0, 6), 0), 0x2f7a50));
	}
	return merge(parts);
}

export function wildflowers(seed: number, colors: number[]): THREE.BufferGeometry {
	const rng = new Random(seed);
	const parts: THREE.BufferGeometry[] = [];
	for (let i = 0; i < 7; i++) {
		const h = rng.range(0.3, 0.65);
		const x = rng.range(-0.5, 0.5);
		const z = rng.range(-0.5, 0.5);
		const stem = new THREE.CylinderGeometry(0.012, 0.02, h, 3);
		stem.translate(0, h / 2, 0);
		parts.push(prep(place(stem, x, 0, z), 0x3f7a2a));
		const petals = new THREE.CircleGeometry(0.09, 5);
		petals.rotateX(-Math.PI / 2 + rng.range(-0.3, 0.3));
		parts.push(prep(place(petals, x, h, z), rng.pick(colors)));
		const center = new THREE.SphereGeometry(0.03, 4, 3);
		parts.push(prep(place(center, x, h + 0.02, z), 0xffe070));
	}
	return merge(parts);
}

export function heather(seed: number): THREE.BufferGeometry {
	const rng = new Random(seed);
	const parts: THREE.BufferGeometry[] = [];
	for (let i = 0; i < 4; i++) {
		const g = blob(rng.range(0.22, 0.35), 0, 0.3, seed + i);
		g.computeVertexNormals();
		const top = rng.chance(0.65) ? 0x9a5ac8 : 0xc88ae0;
		canopyShade(g, top, 0x3a2a4a);
		place(g, rng.range(-0.45, 0.45), 0.22, rng.range(-0.45, 0.45), 0, 0, 0, 1, 0.75, 1);
		parts.push(prep(g));
	}
	return merge(parts);
}

// ------------------------------------------------------------------ rocks and crystals

export function rock(seed: number, base: number, top?: number): THREE.BufferGeometry {
	const g = blob(1, 1, 0.3, seed);
	g.scale(1.3, 0.75, 1.1);
	g.computeVertexNormals();
	const p = prep(g, base);
	const pos = p.attributes.position;
	const c = p.attributes.color;
	// Slight colour noise per vertex.
	for (let i = 0; i < pos.count; i++) {
		const k = 0.85 + noise.noise(pos.getX(i) * 2 + seed, pos.getZ(i) * 2) * 0.15;
		c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
	}
	if (top !== undefined) topTint(p, top, 0.45, 0.9);
	return p;
}

export function crystalCluster(seed: number, color: number, tall = 1): THREE.BufferGeometry {
	const rng = new Random(seed);
	const parts: THREE.BufferGeometry[] = [];
	const base = blob(0.9, 0, 0.3, seed);
	base.scale(1.2, 0.45, 1.2);
	base.computeVertexNormals();
	parts.push(prep(base, 0x3a3346));
	const n = 5 + rng.int(0, 3);
	_col.setHex(color);
	for (let i = 0; i < n; i++) {
		const h = (i === 0 ? 2.6 : rng.range(1.0, 2.0)) * tall;
		const r = i === 0 ? 0.45 : rng.range(0.2, 0.35);
		const c = new THREE.OctahedronGeometry(1, 0);
		c.scale(r, h * 0.5, r);
		c.translate(0, h * 0.42, 0);
		const a = rng.range(0, Math.PI * 2);
		const off = i === 0 ? 0 : rng.range(0.3, 0.8);
		const shade = new THREE.Color(color).multiplyScalar(rng.range(0.7, 1.1));
		parts.push(prep(place(c, Math.cos(a) * off, 0, Math.sin(a) * off, i === 0 ? 0 : rng.range(0.15, 0.55), a, 0), shade, i === 0 ? 1 : rng.range(0.55, 0.9)));
	}
	return merge(parts);
}

export function standingStone(seed: number, rune: number): THREE.BufferGeometry {
	const rng = new Random(seed);
	const h = rng.range(3.2, 4.4);
	const stone = new THREE.BoxGeometry(1.2, h, 0.7, 2, 4, 1);
	stone.translate(0, h / 2, 0);
	const pos = stone.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const y = pos.getY(i) / h;
		const k = 1 - y * 0.25;
		pos.setX(i, pos.getX(i) * k + noise.noise(i * 0.7, seed) * 0.08);
		pos.setZ(i, pos.getZ(i) * k);
	}
	stone.computeVertexNormals();
	const parts = [prep(stone, 0x5a5466)];
	topTint(parts[0], 0x5f7a4a, 0.7, 0.6);
	for (let i = 0; i < 3; i++) {
		const glyph = new THREE.BoxGeometry(0.5, 0.08, 0.05);
		parts.push(prep(place(glyph, 0, h * (0.35 + i * 0.15), 0.37, 0, 0, rng.range(-0.6, 0.6)), rune, 1));
		const glyphB = new THREE.BoxGeometry(0.06, 0.32, 0.05);
		parts.push(prep(place(glyphB, rng.range(-0.15, 0.15), h * (0.35 + i * 0.15), 0.37), rune, 1));
	}
	return merge(parts);
}
