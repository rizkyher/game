import * as THREE from 'three';
import { blob, merge, mergeVerticesByPosition, place, prep } from '../utils/geometry';
import { Random } from '../utils/Random';

/**
 * Procedural geometry for plants, rocks and trees. Every builder returns a single merged,
 * vertex-coloured geometry with its base at y = 0 so it can be instanced.
 */

export type FlowerType = 'daisy' | 'tulip' | 'sunflower' | 'lavender' | 'rose' | 'dandelion';

export interface FlowerShape {
	geo: THREE.BufferGeometry;
	/** Local geometry height (for wind bending). */
	height: number;
	/** Local head centre and radius (for interaction). */
	head: THREE.Vector3;
	headRadius: number;
}

/** Flat lobed petal disc (fan). Lobes count = petals. */
function petalFan(R: number, lobes: number, inner: number, cup: number, segs = lobes * 4): THREE.BufferGeometry {
	const pos: number[] = [0, 0, 0];
	for (let i = 0; i <= segs; i++) {
		const t = (i / segs) * Math.PI * 2;
		const lobe = Math.pow(Math.abs(Math.cos((t * lobes) / 2)), 0.7);
		const r = R * (inner + (1 - inner) * lobe);
		pos.push(Math.cos(t) * r, cup * (r / R) * (r / R), Math.sin(t) * r);
	}
	const idx: number[] = [];
	for (let i = 0; i < segs; i++) idx.push(0, i + 2, i + 1);
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setIndex(idx);
	g.computeVertexNormals();
	return g;
}

function leaf(len: number, width: number): THREE.BufferGeometry {
	const g = new THREE.SphereGeometry(1, 5, 3);
	g.scale(width, 0.05, len * 0.5);
	g.translate(0, 0, len * 0.5);
	return g;
}

function stem(h: number, r0: number, r1: number, color: number): THREE.BufferGeometry {
	const g = new THREE.CylinderGeometry(r1, r0, h, 5, 1, true);
	g.translate(0, h / 2, 0);
	return prep(g, color);
}

export function flowerShape(type: FlowerType): FlowerShape {
	switch (type) {
		case 'daisy': {
			const parts = [
				stem(5, 0.16, 0.11, 0x4c8a2e),
				prep(place(leaf(1.9, 0.32), 0, 1.4, 0, -0.5, 0), 0x5a9e36),
				prep(place(leaf(1.6, 0.28), 0, 2.4, 0, -0.5, Math.PI), 0x5a9e36),
				prep(place(petalFan(1.55, 12, 0.32, 0.28), 0, 5, 0), 0xffffff, 1),
				prep(place(new THREE.SphereGeometry(0.5, 6, 4), 0, 5.1, 0, 0, 0, 0, 1, 0.55, 1), 0xffc928)
			];
			return { geo: merge(parts), height: 5, head: new THREE.Vector3(0, 5.1, 0), headRadius: 1.6 };
		}
		case 'tulip': {
			const parts = [stem(6, 0.16, 0.12, 0x4f8f30)];
			for (const s of [-1, 1]) {
				const l = new THREE.ConeGeometry(0.5, 4, 4);
				l.scale(1, 1, 0.22);
				parts.push(prep(place(l, s * 0.35, 2, 0, 0, 0, s * -0.35), 0x5aa03a));
			}
			for (let k = 0; k < 6; k++) {
				const p = new THREE.SphereGeometry(0.62, 5, 4);
				p.scale(0.55, 1.05, 0.28);
				p.translate(0, 0.62, 0.32);
				p.rotateX(0.18 + (k % 2) * 0.1);
				p.rotateY((k * Math.PI) / 3);
				p.translate(0, 6, 0);
				parts.push(prep(p, 0xffffff, 1));
			}
			parts.push(prep(place(new THREE.SphereGeometry(0.3, 4, 3), 0, 6.5, 0), 0xf4d35e));
			return { geo: merge(parts), height: 6, head: new THREE.Vector3(0, 6.6, 0), headRadius: 1.1 };
		}
		case 'sunflower': {
			const parts = [stem(18, 0.42, 0.3, 0x4a8a2c)];
			const lh = [5, 8.5, 12, 14.5];
			lh.forEach((y, i) => parts.push(prep(place(leaf(4.6, 1.3), 0, y, 0, -0.35, i * 1.9), 0x4f9a33)));
			const head: THREE.BufferGeometry[] = [
				prep(place(new THREE.CylinderGeometry(2.1, 1.4, 0.7, 14), 0, -0.1, 0), 0x3f7a2a),
				prep(place(petalFan(4.1, 22, 0.5, -0.35), 0, 0.3, 0), 0xffffff, 1),
				prep(place(new THREE.CylinderGeometry(2.35, 2.35, 0.5, 18), 0, 0.45, 0), 0x5b3417),
				prep(place(new THREE.CylinderGeometry(1.4, 1.4, 0.56, 14), 0, 0.5, 0), 0x3d220f)
			];
			const headGeo = merge(head);
			headGeo.rotateX(1.15);
			headGeo.translate(0, 18, 0.6);
			parts.push(headGeo);
			return { geo: merge(parts), height: 18, head: new THREE.Vector3(0, 18, 0.9), headRadius: 4.3 };
		}
		case 'lavender': {
			const rng = new Random(31);
			const parts: THREE.BufferGeometry[] = [];
			for (let i = 0; i < 6; i++) {
				const l = new THREE.ConeGeometry(0.18, 2.2, 3);
				parts.push(prep(place(l, 0, 1, 0, rng.range(-0.5, 0.5), rng.range(0, 6), rng.range(-0.5, 0.5)), 0x7d9a6a));
			}
			for (let i = 0; i < 7; i++) {
				const h = rng.range(5.2, 7);
				const tilt = rng.range(0.05, 0.3);
				const yaw = (i / 7) * Math.PI * 2 + rng.range(-0.3, 0.3);
				const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(yaw), Math.cos(tilt), Math.sin(tilt) * Math.sin(yaw));
				const s = new THREE.CylinderGeometry(0.05, 0.07, h, 4, 1, true);
				s.translate(0, h / 2, 0);
				s.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
				parts.push(prep(s, 0x6f8f4f));
				// Bud spike: a knobbly tapered cylinder instead of many little spheres.
				const spike = new THREE.CylinderGeometry(0.16, 0.3, 2.2, 5, 4);
				const sp = spike.attributes.position;
				for (let v = 0; v < sp.count; v++) {
					const k = 1 + 0.25 * Math.sin(sp.getY(v) * 9 + v);
					sp.setXYZ(v, sp.getX(v) * k, sp.getY(v), sp.getZ(v) * k);
				}
				spike.computeVertexNormals();
				spike.translate(0, h - 1.1, 0);
				spike.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
				parts.push(prep(spike, 0xffffff, 1));
			}
			return { geo: merge(parts), height: 7, head: new THREE.Vector3(0, 5.8, 0), headRadius: 2.1 };
		}
		case 'rose': {
			const parts = [stem(5, 0.13, 0.1, 0x3f7a2c)];
			parts.push(prep(place(leaf(1.4, 0.45), 0, 2, 0, -0.6, 0.4), 0x3f8a33));
			parts.push(prep(place(leaf(1.2, 0.4), 0, 3.1, 0, -0.6, 2.8), 0x3f8a33));
			for (let k = 0; k < 5; k++) {
				const c = new THREE.ConeGeometry(0.18, 0.6, 3);
				c.translate(0, 0.3, 0.25);
				c.rotateX(1.2);
				c.rotateY((k / 5) * Math.PI * 2);
				c.translate(0, 4.9, 0);
				parts.push(prep(c, 0x3f7a2c));
			}
			const rings = [
				{ n: 5, r: 0.72, s: [0.95, 0.7, 0.32], off: 0.55, tilt: 0.6, y: 0.3 },
				{ n: 4, r: 0.6, s: [0.8, 0.75, 0.3], off: 0.36, tilt: 0.3, y: 0.45 },
				{ n: 3, r: 0.45, s: [0.7, 0.8, 0.3], off: 0.18, tilt: 0.1, y: 0.6 }
			];
			rings.forEach((ring, ri) => {
				for (let k = 0; k < ring.n; k++) {
					const p = new THREE.SphereGeometry(ring.r, 5, 4);
					p.scale(ring.s[0], ring.s[1], ring.s[2]);
					p.translate(0, ring.y, ring.off);
					p.rotateX(ring.tilt);
					p.rotateY((k / ring.n) * Math.PI * 2 + ri * 0.5);
					p.translate(0, 5, 0);
					parts.push(prep(p, 0xffffff, 1));
				}
			});
			parts.push(prep(place(new THREE.SphereGeometry(0.3, 5, 3), 0, 5.75, 0, 0, 0, 0, 1, 1.3, 1), 0xffffff, 1));
			return { geo: merge(parts), height: 5, head: new THREE.Vector3(0, 5.5, 0), headRadius: 1.3 };
		}
		case 'dandelion': {
			const parts = [stem(5.4, 0.1, 0.08, 0x5c9a3a)];
			for (let k = 0; k < 5; k++) {
				const l = new THREE.ConeGeometry(0.4, 2.6, 3);
				l.scale(1, 1, 0.15);
				l.translate(0, 1.3, 0);
				l.rotateX(1.05);
				l.rotateY((k / 5) * Math.PI * 2);
				parts.push(prep(l, 0x5a9a36));
			}
			parts.push(prep(place(new THREE.SphereGeometry(0.28, 6, 4), 0, 5.4, 0), 0x6a9a3a));
			const puff = mergeVerticesByPosition(new THREE.IcosahedronGeometry(1.2, 1));
			puff.computeVertexNormals();
			parts.push(prep(place(puff, 0, 5.9, 0), 0xf6f6ee));
			return { geo: merge(parts), height: 5.9, head: new THREE.Vector3(0, 5.9, 0), headRadius: 1.4 };
		}
	}
}

export function mushroomGeometry(spots: boolean): THREE.BufferGeometry {
	const parts = [prep(place(new THREE.CylinderGeometry(0.2, 0.3, 1, 8, 1, true), 0, 0.5, 0), 0xf1e6cf)];
	const cap = new THREE.SphereGeometry(0.85, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
	cap.scale(1, 0.62, 1);
	parts.push(prep(place(cap, 0, 0.92, 0), 0xffffff, 1));
	parts.push(prep(place(new THREE.CircleGeometry(0.84, 12), 0, 0.92, 0, Math.PI / 2, 0, 0), 0xe8d6b8));
	if (spots) {
		const rng = new Random(5);
		for (let i = 0; i < 7; i++) {
			const a = rng.range(0, Math.PI * 2);
			const el = rng.range(0.25, 1.2);
			const x = Math.cos(a) * Math.cos(el) * 0.85;
			const z = Math.sin(a) * Math.cos(el) * 0.85;
			const y = 0.92 + Math.sin(el) * 0.85 * 0.62;
			parts.push(prep(place(new THREE.SphereGeometry(0.11, 5, 3), x, y, z, 0, 0, 0, 1, 0.5, 1), 0xffffff));
		}
	}
	return merge(parts);
}

export function fernGeometry(): THREE.BufferGeometry {
	const parts: THREE.BufferGeometry[] = [];
	for (let k = 0; k < 7; k++) {
		const f = new THREE.ConeGeometry(0.45, 3.6, 3, 1);
		f.scale(1, 1, 0.12);
		f.translate(0, 1.8, 0);
		f.rotateX(0.95 + (k % 2) * 0.25);
		f.rotateY((k / 7) * Math.PI * 2);
		parts.push(prep(f, k % 2 ? 0x3f8a3a : 0x4e9a40));
	}
	return merge(parts);
}

export function bushGeometry(seed: number): THREE.BufferGeometry {
	const rng = new Random(seed);
	const parts: THREE.BufferGeometry[] = [];
	for (let i = 0; i < 4; i++) {
		const b = blob(rng.range(0.6, 1), 1, 0.2, seed + i);
		b.translate(rng.range(-0.7, 0.7), rng.range(0.55, 1.1), rng.range(-0.7, 0.7));
		parts.push(prep(b, i % 2 ? 0xffffff : 0xe6f0e0, 1));
	}
	return merge(parts);
}

export function rockGeometry(seed: number): THREE.BufferGeometry {
	const g = blob(1, 1, 0.3, seed);
	g.scale(1, 0.7, 1);
	g.translate(0, 0.35, 0);
	return prep(g, 0xffffff, 1);
}

export function trunkGeometry(): THREE.BufferGeometry {
	const g = new THREE.CylinderGeometry(0.6, 1, 1, 12, 8, true);
	g.translate(0, 0.5, 0);
	const pos = g.attributes.position;
	const v = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		v.fromBufferAttribute(pos, i);
		const a = Math.atan2(v.z, v.x);
		let s = 1 + 0.045 * Math.sin(a * 9 + v.y * 4);
		if (v.y < 0.16) s *= 1 + ((0.16 - v.y) / 0.16) * (0.55 + 0.4 * Math.cos(a * 5));
		pos.setXYZ(i, v.x * s, v.y, v.z * s);
	}
	g.computeVertexNormals();
	const geo = prep(g);
	const col = geo.attributes.color;
	const c = new THREE.Color();
	for (let i = 0; i < pos.count; i++) {
		const y = pos.getY(i);
		c.setHex(0x5e3d26).lerp(new THREE.Color(0x8a6142), Math.min(1, y * 1.4));
		col.setXYZ(i, c.r, c.g, c.b);
	}
	return geo;
}

export function branchGeometry(): THREE.BufferGeometry {
	const g = new THREE.CylinderGeometry(0.45, 1, 1, 7, 1, true);
	g.translate(0, 0.5, 0);
	return prep(g, 0x75503a);
}

export function canopyGeometry(): THREE.BufferGeometry {
	return prep(blob(1, 1, 0.16, 3), 0xffffff, 1);
}
