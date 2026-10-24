import * as THREE from 'three';
import { blob, merge, place, prep } from '../utils/geometry';

export type PropKind =
	| 'cup'
	| 'plate'
	| 'basket'
	| 'domino'
	| 'sugar'
	| 'jar'
	| 'balloon'
	| 'apple'
	| 'beachball'
	| 'cherry'
	| 'berry'
	| 'acorn'
	| 'pinecone'
	| 'pebble'
	| 'twig'
	| 'puffball'
	| 'wateringcan'
	| 'trowel'
	| 'pot'
	| 'gnome'
	| 'waxblock'
	| 'honeyjar'
	| 'honeyglob'
	| 'waxplug'
	| 'duck'
	| 'boat';

export type ColliderShape =
	| { type: 'ball'; r: number; y?: number }
	| { type: 'cuboid'; hx: number; hy: number; hz: number; y?: number }
	| { type: 'cylinder'; hh: number; r: number; y?: number }
	| { type: 'capsule'; hh: number; r: number; y?: number; axis?: 'x' | 'y' | 'z' };

export type PropSound = 'wood' | 'glass' | 'ceramic' | 'soft' | 'metal' | 'plant' | 'rubber' | 'paper';

export interface BreakSpec {
	/** Impact speed (m/s) from the bee that breaks it. */
	speed: number;
	/** Contact force threshold for prop/world impacts. */
	force: number;
	sting?: boolean;
	effect: 'shatter' | 'pop' | 'spores' | 'honey' | 'crunch';
	color: number;
}

export interface PropDef {
	name: string;
	parts: { geo: THREE.BufferGeometry; mat: THREE.Material }[];
	shape: ColliderShape;
	mass: number;
	restitution: number;
	friction: number;
	linDamp: number;
	angDamp: number;
	gravity: number;
	pickup: boolean;
	sound: PropSound;
	floats?: boolean;
	breakable?: BreakSpec;
	/** Chaos trick when knocked over (tipped past 60°). */
	tipTrick?: string;
}

let cache: Record<PropKind, PropDef> | null = null;

function stripes(geo: THREE.BufferGeometry, a: number, b: number, bands: number): THREE.BufferGeometry {
	geo.computeBoundingBox();
	const min = geo.boundingBox!.min.y;
	const h = geo.boundingBox!.max.y - min;
	const ca = new THREE.Color(a);
	const cb = new THREE.Color(b);
	const pos = geo.attributes.position;
	const col = geo.attributes.color;
	for (let i = 0; i < pos.count; i++) {
		const t = (pos.getY(i) - min) / h;
		const c = Math.floor(t * bands) % 2 ? ca : cb;
		col.setXYZ(i, c.r, c.g, c.b);
	}
	return geo;
}

/** Lazily built shared geometry/material for every prop kind. */
export function propDefs(): Record<PropKind, PropDef> {
	if (cache) return cache;
	const std = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.02 });
	const shiny = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.15 });
	const metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6 });
	const glass = new THREE.MeshStandardMaterial({ color: 0xdff6ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
	const honey = new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0xff7b00, emissiveIntensity: 0.3, roughness: 0.15 });
	const cupMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide });

	const cupGeo = (() => {
		const body = new THREE.CylinderGeometry(1.6, 1.2, 4, 18, 8, true);
		const bodyP = stripes(prep(body), 0xff6f91, 0xffffff, 6);
		const bottom = prep(place(new THREE.CircleGeometry(1.2, 18), 0, -2, 0, Math.PI / 2, 0, 0), 0xffffff);
		return merge([bodyP, bottom]);
	})();
	const dominoGeo = (() => {
		const parts = [prep(new THREE.BoxGeometry(1.6, 3.4, 0.6), 0xfff8e7)];
		const dots: [number, number][] = [
			[0, 0.85],
			[-0.4, -0.5],
			[0.4, -1.2],
			[0.4, -0.5],
			[-0.4, -1.2]
		];
		for (const s of [1, -1])
			for (const [x, y] of dots) parts.push(prep(place(new THREE.CircleGeometry(0.16, 8), x, y, 0.31 * s, 0, s < 0 ? Math.PI : 0, 0), 0x222222));
		parts.push(prep(place(new THREE.BoxGeometry(1.4, 0.08, 0.62), 0, 0.15, 0), 0x333333));
		return merge(parts);
	})();
	const jarGeo = (inner: number) => {
		const shell = new THREE.CylinderGeometry(1.4, 1.4, 3, 16, 1, true);
		const contents = merge([prep(new THREE.CylinderGeometry(1.25, 1.25, 2.3, 16), inner), prep(place(new THREE.CylinderGeometry(1.5, 1.5, 0.5, 16), 0, 1.6, 0), 0xd84315)]);
		contents.translate(0, -0.25, 0);
		return { shell, contents };
	};
	const jam = jarGeo(0xc2185b);
	const hj = jarGeo(0xffa000);
	const balloonGeo = merge([prep(place(new THREE.SphereGeometry(2.2, 20, 14), 0, 0, 0, 0, 0, 0, 1, 1.15, 1)), prep(place(new THREE.ConeGeometry(0.3, 0.5, 8), 0, -2.6, 0, Math.PI, 0, 0))]);
	const beachGeo = (() => {
		const g = prep(new THREE.SphereGeometry(3, 24, 16));
		const pos = g.attributes.position;
		const col = g.attributes.color;
		const palette = [0xff5252, 0xffffff, 0x2196f3, 0xffeb3b, 0xffffff, 0x4caf50].map((h) => new THREE.Color(h));
		for (let i = 0; i < pos.count; i++) {
			const a = Math.atan2(pos.getZ(i), pos.getX(i));
			const seg = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 6) % 6;
			const c = Math.abs(pos.getY(i)) > 2.75 ? palette[1] : palette[seg];
			col.setXYZ(i, c.r, c.g, c.b);
		}
		return g;
	})();
	const cherryGeo = merge([
		prep(place(new THREE.SphereGeometry(0.75, 12, 10), -0.35, 0, 0), 0xd50000),
		prep(place(new THREE.SphereGeometry(0.7, 12, 10), 0.45, 0.1, 0.2), 0xc51162),
		prep(place(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 4), 0, 1.4, 0.05, 0, 0, 0.1), 0x4e7d2e)
	]);
	const appleGeo = merge([
		prep(place(new THREE.SphereGeometry(1.6, 16, 12), 0, 0, 0, 0, 0, 0, 1, 0.92, 1), 0xe53935),
		prep(place(new THREE.CylinderGeometry(0.08, 0.1, 0.8, 5), 0, 1.6, 0), 0x5d4037),
		prep(place(new THREE.SphereGeometry(0.4, 6, 4), 0.35, 1.7, 0, 0, 0, 0, 1, 0.2, 0.5), 0x66bb6a)
	]);
	const acornGeo = merge([
		prep(place(new THREE.SphereGeometry(0.7, 12, 10), 0, -0.15, 0, 0, 0, 0, 1, 1.3, 1), 0xc68642),
		prep(place(new THREE.SphereGeometry(0.75, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.3, 0), 0x6d4c33),
		prep(place(new THREE.CylinderGeometry(0.08, 0.1, 0.4, 5), 0, 1.05, 0), 0x5d4037)
	]);
	const pineGeo = (() => {
		const parts: THREE.BufferGeometry[] = [];
		for (let i = 0; i < 6; i++) parts.push(prep(place(new THREE.ConeGeometry(0.9 - i * 0.12, 0.6, 8), 0, -0.9 + i * 0.36, 0, 0, i * 0.5, 0), i % 2 ? 0x8d6e63 : 0x6d4c41));
		return merge(parts);
	})();
	const gnomeGeo = merge([
		prep(place(new THREE.CylinderGeometry(1.4, 2, 3.5, 12), 0, -1.6, 0), 0x1e88e5),
		prep(place(new THREE.SphereGeometry(1.05, 14, 10), 0, 0.8, 0), 0xffccbc),
		prep(place(new THREE.ConeGeometry(1.1, 2.6, 12), 0, -0.4, 0.55, 0.25, 0, 0), 0xfafafa),
		prep(place(new THREE.ConeGeometry(1.15, 3, 12), 0, 2.8, 0, -0.15, 0, 0), 0xe53935),
		prep(place(new THREE.SphereGeometry(0.28, 8, 6), 0, 0.85, 1.05), 0xff8a80),
		prep(place(new THREE.SphereGeometry(0.12, 6, 4), -0.38, 1.15, 0.92), 0x212121),
		prep(place(new THREE.SphereGeometry(0.12, 6, 4), 0.38, 1.15, 0.92), 0x212121),
		prep(place(new THREE.CylinderGeometry(0.6, 0.6, 1.2, 8), 0, -3.9, 0.6), 0x5d4037)
	]);
	const canGeo = merge([
		prep(new THREE.CylinderGeometry(2, 2.1, 3.4, 18), 0x43a047),
		prep(place(new THREE.CylinderGeometry(0.25, 0.4, 4, 8), 2.6, 0.6, 0, 0, 0, -0.9), 0x388e3c),
		prep(place(new THREE.CylinderGeometry(0.7, 0.4, 0.6, 10), 4.3, 1.8, 0, 0, 0, -0.9), 0x2e7d32),
		prep(place(new THREE.TorusGeometry(1.4, 0.22, 6, 16, Math.PI), -1.2, 1.6, 0, 0, 0, 0.6), 0x2e7d32)
	]);
	const trowelGeo = merge([
		prep(place(new THREE.ConeGeometry(1, 3, 4), 0, 0, 1.5, Math.PI / 2, Math.PI / 4, 0, 1, 1, 0.18), 0xb0bec5),
		prep(place(new THREE.CylinderGeometry(0.35, 0.4, 3, 8), 0, 0, -1.4, Math.PI / 2, 0, 0), 0x8d4e2a)
	]);
	const potGeo = merge([
		prep(new THREE.CylinderGeometry(1.8, 1.3, 3, 14, 1), 0xd2693e),
		prep(place(new THREE.TorusGeometry(1.8, 0.28, 6, 16), 0, 1.45, 0, Math.PI / 2, 0, 0), 0xc25a30),
		prep(place(new THREE.CylinderGeometry(1.55, 1.55, 0.2, 14), 0, 1.35, 0), 0x4e342e),
		prep(place(blob(0.9, 1, 0.2, 3), 0, 2.2, 0), 0x66bb6a)
	]);
	const duckGeo = merge([
		prep(place(new THREE.SphereGeometry(1.4, 14, 10), 0, 0, 0, 0, 0, 0, 1.2, 0.8, 1), 0xffeb3b),
		prep(place(new THREE.SphereGeometry(0.85, 12, 10), 0, 1.15, 0.7), 0xffeb3b),
		prep(place(new THREE.ConeGeometry(0.35, 0.8, 8), 0, 1.0, 1.65, Math.PI / 2, 0, 0, 1, 1, 0.6), 0xff9800),
		prep(place(new THREE.SphereGeometry(0.13, 6, 4), -0.35, 1.4, 1.35), 0x212121),
		prep(place(new THREE.SphereGeometry(0.13, 6, 4), 0.35, 1.4, 1.35), 0x212121)
	]);
	const boatGeo = merge([
		prep(place(new THREE.CylinderGeometry(2.6, 1.6, 1.2, 4, 1), 0, 0, 0, 0, Math.PI / 4, 0, 1.6, 1, 0.7), 0xfafafa),
		prep(place(new THREE.ConeGeometry(1.4, 3, 3), 0, 2, 0, 0, 0, 0, 1, 1, 0.15), 0xf5f5f5)
	]);
	const basketGeo = (() => {
		const box = prep(new THREE.BoxGeometry(9, 5, 6, 9, 5, 6));
		const pos = box.attributes.position;
		const col = box.attributes.color;
		const a = new THREE.Color(0xc68a4a);
		const b = new THREE.Color(0xa86f35);
		for (let i = 0; i < pos.count; i++) {
			const c = (Math.floor(pos.getX(i) + 10) + Math.floor(pos.getY(i) + 10) + Math.floor(pos.getZ(i) + 10)) % 2 ? a : b;
			col.setXYZ(i, c.r, c.g, c.b);
		}
		return merge([
			box,
			prep(place(new THREE.TorusGeometry(3.6, 0.35, 6, 20, Math.PI), 0, 2.5, 0), 0x8d5a2b),
			prep(place(new THREE.BoxGeometry(9.4, 0.5, 6.4), 0, 2.6, 0), 0xe8463c)
		]);
	})();

	const d = (o: Partial<PropDef> & Pick<PropDef, 'name' | 'parts' | 'shape' | 'mass' | 'sound'>): PropDef => ({
		restitution: 0.25,
		friction: 0.7,
		linDamp: 0.15,
		angDamp: 0.4,
		gravity: 1,
		pickup: o.mass <= 2,
		...o
	});

	cache = {
		cup: d({ name: 'Paper Cup', parts: [{ geo: cupGeo, mat: cupMat }], shape: { type: 'cylinder', hh: 2, r: 1.45 }, mass: 0.7, sound: 'paper', tipTrick: 'cup_tip' }),
		plate: d({ name: 'Plate', parts: [{ geo: stripes(prep(new THREE.CylinderGeometry(2.6, 2.1, 0.3, 20)), 0x90caf9, 0xffffff, 2), mat: shiny }], shape: { type: 'cylinder', hh: 0.15, r: 2.5 }, mass: 0.6, sound: 'ceramic' }),
		basket: d({ name: 'Picnic Basket', parts: [{ geo: basketGeo, mat: std }], shape: { type: 'cuboid', hx: 4.5, hy: 2.5, hz: 3 }, mass: 6, sound: 'wood' }),
		domino: d({ name: 'Domino', parts: [{ geo: dominoGeo, mat: shiny }], shape: { type: 'cuboid', hx: 0.8, hy: 1.7, hz: 0.3 }, mass: 0.45, sound: 'wood', friction: 0.5, restitution: 0.1 }),
		sugar: d({ name: 'Sugar Cube', parts: [{ geo: prep(new THREE.BoxGeometry(1.4, 1.4, 1.4), 0xfffdf7), mat: std }], shape: { type: 'cuboid', hx: 0.7, hy: 0.7, hz: 0.7 }, mass: 0.3, sound: 'soft' }),
		jar: d({
			name: 'Jam Jar',
			parts: [
				{ geo: jam.contents, mat: shiny },
				{ geo: jam.shell, mat: glass }
			],
			shape: { type: 'cylinder', hh: 1.5, r: 1.45 },
			mass: 1.4,
			sound: 'glass',
			breakable: { speed: 15, force: 900, effect: 'shatter', color: 0xc2185b }
		}),
		balloon: d({ name: 'Balloon', parts: [{ geo: balloonGeo, mat: shiny }], shape: { type: 'ball', r: 2.2 }, mass: 0.12, sound: 'rubber', gravity: -0.18, linDamp: 1.6, angDamp: 2, restitution: 0.6, breakable: { speed: 9, force: 99999, sting: true, effect: 'pop', color: 0xff5252 } }),
		apple: d({ name: 'Apple', parts: [{ geo: appleGeo, mat: shiny }], shape: { type: 'ball', r: 1.55 }, mass: 1.2, sound: 'plant' }),
		beachball: d({ name: 'Beach Ball', parts: [{ geo: beachGeo, mat: shiny }], shape: { type: 'ball', r: 3 }, mass: 0.7, sound: 'rubber', restitution: 0.85, linDamp: 0.3, floats: true }),
		cherry: d({ name: 'Cherries', parts: [{ geo: cherryGeo, mat: shiny }], shape: { type: 'ball', r: 0.85 }, mass: 0.4, sound: 'plant' }),
		berry: d({ name: 'Wild Berry', parts: [{ geo: prep(new THREE.SphereGeometry(0.65, 10, 8), 0x7b1fa2), mat: shiny }], shape: { type: 'ball', r: 0.65 }, mass: 0.3, sound: 'plant' }),
		acorn: d({ name: 'Acorn', parts: [{ geo: acornGeo, mat: std }], shape: { type: 'ball', r: 0.8 }, mass: 0.5, sound: 'wood' }),
		pinecone: d({ name: 'Pinecone', parts: [{ geo: pineGeo, mat: std }], shape: { type: 'ball', r: 0.9 }, mass: 0.6, sound: 'wood' }),
		pebble: d({ name: 'Pebble', parts: [{ geo: prep(blob(0.9, 1, 0.25, 8), 0x9e9e9e), mat: std }], shape: { type: 'ball', r: 0.85 }, mass: 1.3, sound: 'ceramic' }),
		twig: d({ name: 'Twig', parts: [{ geo: prep(place(new THREE.CapsuleGeometry(0.22, 5, 3, 6), 0, 0, 0, 0, 0, Math.PI / 2), 0x6d4c33), mat: std }], shape: { type: 'capsule', hh: 2.5, r: 0.25, axis: 'x' }, mass: 0.6, sound: 'wood' }),
		puffball: d({ name: 'Puffball', parts: [{ geo: prep(place(new THREE.SphereGeometry(1.6, 14, 10), 0, 0, 0, 0, 0, 0, 1, 0.85, 1), 0xf3e5c8), mat: std }], shape: { type: 'ball', r: 1.45 }, mass: 0.6, sound: 'soft', breakable: { speed: 7, force: 300, sting: true, effect: 'spores', color: 0xd7ccc8 } }),
		wateringcan: d({ name: 'Watering Can', parts: [{ geo: canGeo, mat: metal }], shape: { type: 'cylinder', hh: 1.7, r: 2.1 }, mass: 4, sound: 'metal' }),
		trowel: d({ name: 'Garden Trowel', parts: [{ geo: trowelGeo, mat: metal }], shape: { type: 'cuboid', hx: 0.8, hy: 0.3, hz: 2.9 }, mass: 1.5, sound: 'metal' }),
		pot: d({ name: 'Flower Pot', parts: [{ geo: potGeo, mat: std }], shape: { type: 'cylinder', hh: 1.5, r: 1.7 }, mass: 2.5, sound: 'ceramic', pickup: false, breakable: { speed: 20, force: 1500, effect: 'crunch', color: 0xd2693e } }),
		gnome: d({ name: 'Garden Gnome', parts: [{ geo: gnomeGeo, mat: shiny }], shape: { type: 'cylinder', hh: 2.8, r: 1.6, y: -0.6 }, mass: 9, sound: 'ceramic', tipTrick: 'gnome' }),
		waxblock: d({ name: 'Wax Block', parts: [{ geo: prep(new THREE.BoxGeometry(2, 2, 2), 0xf6c453), mat: std }], shape: { type: 'cuboid', hx: 1, hy: 1, hz: 1 }, mass: 0.9, sound: 'soft' }),
		honeyjar: d({
			name: 'Honey Jar',
			parts: [
				{ geo: hj.contents, mat: honey },
				{ geo: hj.shell, mat: glass }
			],
			shape: { type: 'cylinder', hh: 1.5, r: 1.45 },
			mass: 1.4,
			sound: 'glass',
			breakable: { speed: 15, force: 900, effect: 'honey', color: 0xffa000 }
		}),
		honeyglob: d({ name: 'Honey Glob', parts: [{ geo: new THREE.SphereGeometry(1.1, 14, 10).scale(1, 1.3, 1), mat: honey }], shape: { type: 'ball', r: 1.1 }, mass: 0.6, sound: 'soft', breakable: { speed: 30, force: 220, effect: 'honey', color: 0xffa000 } }),
		waxplug: d({ name: 'Wax Plug', parts: [{ geo: prep(new THREE.CylinderGeometry(4.6, 4.2, 1.4, 18), 0xe8b04a), mat: std }], shape: { type: 'cylinder', hh: 0.7, r: 4.5 }, mass: 3, sound: 'soft' }),
		duck: d({ name: 'Rubber Duck', parts: [{ geo: duckGeo, mat: shiny }], shape: { type: 'ball', r: 1.4 }, mass: 0.5, sound: 'rubber', floats: true, linDamp: 0.6 }),
		boat: d({ name: 'Paper Boat', parts: [{ geo: boatGeo, mat: std }], shape: { type: 'cuboid', hx: 2.4, hy: 0.6, hz: 1.4 }, mass: 0.4, sound: 'paper', floats: true, linDamp: 0.8 })
	};
	return cache;
}
