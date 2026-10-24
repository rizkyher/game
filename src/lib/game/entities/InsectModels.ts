import * as THREE from 'three';
import { merge, place, prep } from '../utils/geometry';

/**
 * Procedural creature models, built from primitives and then *baked* into as few meshes as
 * possible (typically 1 body + 1–2 animated parts) to keep draw calls low. Forward is +Z.
 */
export interface CreatureModel {
	root: THREE.Group;
	/** Animated pivots (wings or legs). */
	parts: THREE.Object3D[];
	/** Extra animated bits (e.g. a firefly's glow). */
	extra: THREE.Object3D[];
}

const mats = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
	let m = mats.get(key);
	if (!m) {
		m = make();
		mats.set(key, m);
	}
	return m;
}
const vc = () => mat('vc', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
const vcGloss = () => mat('vcg', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1 }));
const vcWing = () => mat('vcw', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }));
const clearWing = () => mat('clear', () => new THREE.MeshStandardMaterial({ color: 0xe6f6ff, roughness: 0.1, side: THREE.DoubleSide, transparent: true, opacity: 0.45, depthWrite: false }));

const geoCache = new Map<string, THREE.BufferGeometry>();
function cached(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
	let g = geoCache.get(key);
	if (!g) {
		g = build();
		geoCache.set(key, g);
	}
	return g;
}

/** Merges every mesh under `obj` (in obj's local space) into one vertex-coloured geometry. */
function bake(obj: THREE.Object3D): THREE.BufferGeometry {
	obj.updateMatrixWorld(true);
	const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
	const geos: THREE.BufferGeometry[] = [];
	obj.traverse((o) => {
		if (!(o instanceof THREE.Mesh)) return;
		const g = (o.geometry as THREE.BufferGeometry).clone();
		g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
		geos.push(g.attributes.color ? g : prep(g, (o.material as THREE.MeshStandardMaterial).color ?? 0xffffff));
	});
	return merge(geos);
}

function eyes(parts: THREE.BufferGeometry[], x: number, y: number, z: number, r: number, spread: number): void {
	for (const s of [-1, 1]) {
		parts.push(prep(place(new THREE.SphereGeometry(r, 8, 6), x + spread * s, y, z), 0xffffff));
		parts.push(prep(place(new THREE.SphereGeometry(r * 0.55, 6, 4), x + spread * s, y, z + r * 0.6), 0x111111));
	}
}

function wingShape(w: number, h: number, round = 0.6): THREE.BufferGeometry {
	const s = new THREE.Shape();
	s.moveTo(0, 0);
	s.bezierCurveTo(w * 0.3, h * round, w * 0.9, h, w, h * 0.3);
	s.bezierCurveTo(w * 1.05, -h * 0.2, w * 0.5, -h * 0.5, 0, 0);
	const g = new THREE.ShapeGeometry(s, 6);
	g.rotateX(-Math.PI / 2);
	return g;
}

/** Builds a posed leg hierarchy, used either baked into the body or as one animated mesh per leg. */
function legGroup(color: number, len: number, side: number, bend: number): THREE.Group {
	const hip = new THREE.Group();
	hip.rotation.z = 1.1 * side;
	const upper = prep(new THREE.CylinderGeometry(0.06 * len, 0.08 * len, len, 4).translate(0, -len / 2, 0), color);
	const lower = prep(new THREE.CylinderGeometry(0.04 * len, 0.06 * len, len * 1.1, 4).translate(0, -len * 0.55, 0), color);
	const m = vc();
	const knee = new THREE.Group();
	knee.position.y = -len;
	knee.rotation.z = -bend * 1.6 * side;
	knee.add(new THREE.Mesh(lower, m));
	hip.add(new THREE.Mesh(upper, m), knee);
	return hip;
}

function addLegs(root: THREE.Object3D, count: number, color: number, len: number, spread: number, z0: number, dz: number, y: number, bend: number): THREE.Group[] {
	const out: THREE.Group[] = [];
	for (let i = 0; i < count; i++) {
		const side = i % 2 ? 1 : -1;
		const row = Math.floor(i / 2);
		const hip = legGroup(color, len, side, bend);
		hip.position.set(spread * side, y, z0 - row * dz);
		hip.userData.side = side;
		hip.userData.row = row;
		root.add(hip);
		out.push(hip);
	}
	return out;
}

function single(geo: THREE.BufferGeometry, material: THREE.Material, shadow: boolean): THREE.Mesh {
	const m = new THREE.Mesh(geo, material);
	m.castShadow = shadow;
	return m;
}

export function butterflyModel(color: number, accent: number): CreatureModel {
	const root = new THREE.Group();
	root.add(
		single(
			cached('butterfly-body', () =>
				merge([
					prep(place(new THREE.CapsuleGeometry(0.16, 1.4, 3, 6), 0, 0, 0, Math.PI / 2, 0, 0), 0x2b2118),
					prep(place(new THREE.SphereGeometry(0.24, 8, 6), 0, 0.05, 0.85), 0x2b2118),
					prep(place(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 3), 0.15, 0.45, 1.1, 0.6, 0, -0.3), 0x2b2118),
					prep(place(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 3), -0.15, 0.45, 1.1, 0.6, 0, 0.3), 0x2b2118)
				])
			),
			vc(),
			false
		)
	);
	const wingGeo = cached(`butterfly-wing-${color}-${accent}`, () => {
		const fore = prep(wingShape(2.2, 1.6, 0.8).rotateY(0.5), color);
		const hind = prep(wingShape(1.6, 1.1, 0.5).rotateY(-0.6).translate(0, -0.01, -0.2), accent);
		const spot = prep(place(new THREE.CircleGeometry(0.28, 8).rotateX(-Math.PI / 2), 1.3, 0.01, 0.9), 0xffffff);
		return merge([fore, hind, spot]);
	});
	const parts: THREE.Object3D[] = [];
	for (const side of [1, -1]) {
		const pivot = new THREE.Group();
		pivot.position.set(0.1 * side, 0.08, 0.1);
		const w = single(wingGeo, vcWing(), false);
		w.scale.x = side;
		pivot.add(w);
		pivot.userData.side = side;
		root.add(pivot);
		parts.push(pivot);
	}
	return { root, parts, extra: [] };
}

export function ladybugModel(): CreatureModel {
	const root = new THREE.Group();
	const geo = cached('ladybug', () => {
		const tmp = new THREE.Group();
		const parts: THREE.BufferGeometry[] = [
			prep(place(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.15, 0, 0, 0, 0, 0.9, 0.75, 1.1), 0xe53935),
			prep(place(new THREE.CircleGeometry(0.98, 14), 0, 0.15, 0, Math.PI / 2, 0, 0, 0.9, 1, 1.1), 0x1b1b1b),
			prep(place(new THREE.SphereGeometry(0.45, 10, 8), 0, 0.2, 1), 0x1b1b1b),
			prep(place(new THREE.BoxGeometry(0.05, 0.02, 2.2), 0, 0.92, 0), 0x1b1b1b)
		];
		for (const [x, z] of [
			[0.45, 0.45],
			[-0.45, 0.45],
			[0.55, -0.3],
			[-0.55, -0.3],
			[0.2, -0.75],
			[-0.2, -0.75]
		]) {
			const y = Math.sqrt(Math.max(0, 1 - (x / 0.9) ** 2 - (z / 1.1) ** 2)) * 0.75 + 0.14;
			parts.push(prep(place(new THREE.SphereGeometry(0.18, 6, 4), x, y, z, 0, 0, 0, 1, 0.35, 1), 0x1b1b1b));
		}
		eyes(parts, 0, 0.35, 1.32, 0.12, 0.2);
		tmp.add(new THREE.Mesh(merge(parts), vc()));
		addLegs(tmp, 6, 0x1b1b1b, 0.35, 0.55, 0.45, 0.45, 0.15, 0.7);
		return bake(tmp);
	});
	root.add(single(geo, vcGloss(), false));
	return { root, parts: [], extra: [] };
}

export function stagBeetleModel(): CreatureModel {
	const root = new THREE.Group();
	const geo = cached('beetle', () => {
		const tmp = new THREE.Group();
		const parts: THREE.BufferGeometry[] = [
			prep(place(new THREE.SphereGeometry(1, 12, 8), 0, 0.7, -0.6, 0, 0, 0, 1.1, 0.6, 1.6), 0x4e2a16),
			prep(place(new THREE.SphereGeometry(0.8, 10, 8), 0, 0.75, 1.1, 0, 0, 0, 1, 0.55, 0.8), 0x3e2010),
			prep(place(new THREE.SphereGeometry(0.6, 10, 8), 0, 0.7, 1.95, 0, 0, 0, 1.2, 0.6, 0.8), 0x2e1708),
			prep(place(new THREE.BoxGeometry(0.04, 0.02, 3.1), 0, 1.31, -0.6), 0x1b0e05)
		];
		for (const s of [-1, 1]) {
			const mand = new THREE.CylinderGeometry(0.1, 0.18, 1.8, 5).translate(0, 0.9, 0);
			mand.rotateX(Math.PI / 2 - 0.2);
			mand.rotateY(-0.35 * s);
			parts.push(prep(place(mand, 0.4 * s, 0.75, 2.3), 0x5a3018));
			parts.push(prep(place(new THREE.ConeGeometry(0.14, 0.5, 4), 0.68 * s, 0.75, 3.85, Math.PI / 2, 0, -0.9 * s), 0x5a3018));
		}
		eyes(parts, 0, 0.95, 2.35, 0.12, 0.42);
		tmp.add(new THREE.Mesh(merge(parts), vc()));
		addLegs(tmp, 6, 0x2e1708, 0.65, 0.75, 1, 0.75, 0.6, 0.8);
		return bake(tmp);
	});
	root.add(single(geo, vcGloss(), true));
	return { root, parts: [], extra: [] };
}

export function spiderModel(): CreatureModel {
	const root = new THREE.Group();
	const body = cached('spider-body', () => {
		const parts: THREE.BufferGeometry[] = [
			prep(place(new THREE.SphereGeometry(1.25, 14, 10), 0, 1.6, -1.2, 0, 0, 0, 1, 0.9, 1.15), 0x3b2a4a),
			prep(place(new THREE.SphereGeometry(0.75, 12, 8), 0, 1.4, 0.55), 0x2a1d36)
		];
		for (let i = 0; i < 4; i++) parts.push(prep(place(new THREE.SphereGeometry(0.22, 6, 4), 0, 2.45 - i * 0.15, -1.2 - i * 0.35 + 0.4, 0, 0, 0, 1.6, 0.4, 1), 0xb388ff));
		eyes(parts, 0, 1.75, 1.15, 0.17, 0.25);
		for (const s of [-1, 1]) parts.push(prep(place(new THREE.SphereGeometry(0.1, 6, 4), 0.48 * s, 1.95, 1.05), 0xff5252));
		return merge(parts);
	});
	root.add(single(body, vcGloss(), true));
	// Legs stay animated (one baked mesh per leg).
	const legGeo = [-1, 1].map((side) => cached(`spider-leg-${side}`, () => bake(legGroup(0x2a1d36, 1.35, side, 1.1))));
	const parts: THREE.Object3D[] = [];
	for (let i = 0; i < 8; i++) {
		const side = i % 2 ? 1 : -1;
		const row = Math.floor(i / 2);
		const hip = new THREE.Group();
		hip.position.set(0.55 * side, 1.5, 0.9 - row * 0.42);
		// bake() keeps only the leg's internal pose; the hip splay lives on the pivot.
		hip.rotation.z = 1.1 * side;
		hip.add(single(legGeo[side < 0 ? 0 : 1], vcGloss(), true));
		hip.userData.side = side;
		hip.userData.row = row;
		root.add(hip);
		parts.push(hip);
	}
	return { root, parts, extra: [] };
}

export function birdModel(): CreatureModel {
	const root = new THREE.Group();
	const body = cached('bird-body', () => {
		const parts: THREE.BufferGeometry[] = [
			prep(place(new THREE.SphereGeometry(2.6, 16, 12), 0, 0, 0, 0, 0, 0, 1, 0.95, 1.35), 0x8d5a44),
			prep(place(new THREE.SphereGeometry(2.2, 14, 10), 0, -0.35, 0.9, 0, 0, 0, 0.95, 0.85, 1), 0xf26b38),
			prep(place(new THREE.SphereGeometry(1.7, 14, 10), 0, 1.4, 3), 0x7a4a36),
			prep(place(new THREE.ConeGeometry(0.42, 1.5, 8), 0, 1.25, 4.9, Math.PI / 2, 0, 0), 0xffb300),
			prep(place(new THREE.BoxGeometry(2.2, 0.25, 3), 0, 0.4, -3.8, -0.25, 0, 0), 0x6d4030)
		];
		eyes(parts, 0, 1.75, 4.3, 0.36, 0.75);
		for (const s of [-1, 1]) {
			parts.push(prep(place(new THREE.CylinderGeometry(0.12, 0.12, 2, 5), 0.8 * s, -3, 0.2), 0xffb74d));
			parts.push(prep(place(new THREE.BoxGeometry(0.9, 0.12, 0.9), 0.8 * s, -4, 0.5), 0xffb74d));
		}
		return merge(parts);
	});
	root.add(single(body, vc(), true));
	const wingGeo = cached('bird-wing', () =>
		merge([prep(place(new THREE.SphereGeometry(1, 10, 6), 2.2, 0, -0.3, 0, 0, 0, 2.4, 0.25, 1.4), 0x7a4a36), prep(place(new THREE.SphereGeometry(1, 8, 6), 3.8, 0, -0.8, 0, 0, 0, 1.4, 0.18, 0.9), 0x5d3a2a)])
	);
	const ws: THREE.Object3D[] = [];
	for (const side of [1, -1]) {
		const pivot = new THREE.Group();
		pivot.position.set(1.3 * side, 0.9, 0.2);
		const w = single(wingGeo, vc(), true);
		w.scale.x = side;
		pivot.add(w);
		pivot.userData.side = side;
		root.add(pivot);
		ws.push(pivot);
	}
	return { root, parts: ws, extra: [] };
}

export function dragonflyModel(color: number): CreatureModel {
	const root = new THREE.Group();
	root.add(
		single(
			cached(`dragonfly-${color}`, () =>
				merge([
					prep(place(new THREE.CylinderGeometry(0.12, 0.2, 4.2, 6), 0, 0, -2, Math.PI / 2, 0, 0), color),
					prep(place(new THREE.SphereGeometry(0.42, 10, 8), 0, 0, 0.2, 0, 0, 0, 1, 0.9, 1.3), color),
					prep(place(new THREE.SphereGeometry(0.34, 8, 6), 0.26, 0.12, 0.85), 0x26c6da),
					prep(place(new THREE.SphereGeometry(0.34, 8, 6), -0.26, 0.12, 0.85), 0x26c6da)
				])
			),
			vcGloss(),
			false
		)
	);
	const wingGeo = cached('dragonfly-wing', () => {
		const a = wingShape(2.6, 0.6, 0.4).translate(0, 0, 0.3);
		const b = wingShape(2.4, 0.55, 0.4).translate(0, 0, -0.2);
		return merge([prep(a), prep(b)]);
	});
	const ws: THREE.Object3D[] = [];
	for (const side of [1, -1]) {
		const pivot = new THREE.Group();
		pivot.position.set(0.1 * side, 0.25, 0);
		const w = single(wingGeo, clearWing(), false);
		w.scale.x = side;
		pivot.add(w);
		pivot.userData.side = side;
		root.add(pivot);
		ws.push(pivot);
	}
	return { root, parts: ws, extra: [] };
}

export function snailModel(): CreatureModel {
	const root = new THREE.Group();
	root.add(
		single(
			cached('snail', () => {
				const parts: THREE.BufferGeometry[] = [prep(place(new THREE.CapsuleGeometry(0.55, 2.4, 3, 8), 0, 0.45, 0.2, Math.PI / 2, 0, 0), 0xc8b090)];
				for (let i = 0; i < 4; i++) {
					const r = 1.3 - i * 0.28;
					parts.push(prep(place(new THREE.TorusGeometry(r, 0.42 - i * 0.07, 6, 14), 0, 1.6 + i * 0.12, -0.3 + i * 0.08, 0, Math.PI / 2, 0), i % 2 ? 0xc0743a : 0xa85d2a));
				}
				for (const s of [-1, 1]) {
					parts.push(prep(place(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 4), 0.25 * s, 1.1, 1.55, 0.4, 0, 0.25 * s), 0xc8b090));
					parts.push(prep(place(new THREE.SphereGeometry(0.14, 6, 4), 0.38 * s, 1.6, 1.78), 0x2b2118));
				}
				return merge(parts);
			}),
			vcGloss(),
			true
		)
	);
	return { root, parts: [], extra: [] };
}

export function fireflyModel(): CreatureModel {
	const root = new THREE.Group();
	root.add(
		single(
			cached('firefly', () => {
				const w = wingShape(0.6, 0.3);
				return merge([
					prep(place(new THREE.CapsuleGeometry(0.12, 0.4, 2, 5), 0, 0, 0.2, Math.PI / 2, 0, 0), 0x3e2f20),
					prep(place(w.clone(), 0.05, 0.12, 0.2, 0, 0, 0.5), 0xdfeffa),
					prep(place(w, -0.05, 0.12, 0.2, 0, 0, -0.5, -1, 1, 1), 0xdfeffa)
				]);
			}),
			vc(),
			false
		)
	);
	const glow = new THREE.Mesh(
		cached('firefly-glow', () => new THREE.SphereGeometry(0.28, 8, 6)),
		mat('glow', () => new THREE.MeshBasicMaterial({ color: 0xd4ff6a }))
	);
	glow.position.z = -0.25;
	root.add(glow);
	return { root, parts: [], extra: [glow] };
}

export function disposeInsectMaterials(): void {
	for (const m of mats.values()) m.dispose();
	mats.clear();
	for (const g of geoCache.values()) g.dispose();
	geoCache.clear();
}
