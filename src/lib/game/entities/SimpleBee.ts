import * as THREE from 'three';
import { merge, place, prep } from '../utils/geometry';
import type { Expression } from '../player/BeeModel';

type Variant = 'worker' | 'queen' | 'guard';

const geoCache = new Map<Variant, { body: THREE.BufferGeometry; wing: THREE.BufferGeometry }>();
let bodyMat: THREE.MeshStandardMaterial | null = null;
let wingMat: THREE.MeshStandardMaterial | null = null;

function buildBody(variant: Variant): THREE.BufferGeometry {
	const yellow = variant === 'queen' ? 0xffa000 : variant === 'guard' ? 0xff8f00 : 0xffcf33;
	const dark = 0x2b2118;
	const abdomen = new THREE.SphereGeometry(0.5, 14, 10);
	abdomen.rotateX(Math.PI / 2);
	abdomen.scale(1.05, 0.95, variant === 'queen' ? 1.7 : 1.35);
	abdomen.rotateX(-0.18);
	abdomen.translate(0, -0.02, variant === 'queen' ? -0.6 : -0.45);
	const ab = prep(abdomen);
	// Bake the stripes into vertex colours along the body axis.
	const pos = ab.attributes.position;
	const col = ab.attributes.color;
	const cy = new THREE.Color(yellow);
	const cd = new THREE.Color(dark);
	for (let i = 0; i < pos.count; i++) {
		const z = pos.getZ(i);
		const c = z < -0.85 ? cd : Math.floor((z + 2) * 4.2) % 2 ? cd : cy;
		col.setXYZ(i, c.r, c.g, c.b);
	}
	const parts = [
		ab,
		prep(place(new THREE.SphereGeometry(0.4, 12, 8), 0, 0.04, 0.12), yellow),
		prep(place(new THREE.SphereGeometry(0.4, 12, 10), 0, 0.12, 0.58, 0, 0, 0, 1, 0.95, 0.92), dark),
		prep(place(new THREE.ConeGeometry(0.07, 0.3, 6), 0, -0.08, variant === 'queen' ? -1.42 : -1.12, -Math.PI / 2, 0, 0), dark)
	];
	for (const s of [-1, 1]) {
		parts.push(prep(place(new THREE.SphereGeometry(0.16, 10, 8), 0.16 * s, 0.22, 0.85, 0, 0, 0, 1, 1.15, 0.8), 0xffffff));
		parts.push(prep(place(new THREE.SphereGeometry(0.085, 8, 6), 0.17 * s, 0.21, 0.97), 0x15110e));
		parts.push(prep(place(new THREE.SphereGeometry(0.07, 6, 4), 0.25 * s, 0.04, 0.85, 0, 0, 0, 1, 0.6, 0.4), 0xff8fab));
		const ant = new THREE.CylinderGeometry(0.022, 0.022, 0.5, 4);
		parts.push(prep(place(ant, 0.16 * s, 0.62, 0.75, 0.55, 0, -0.35 * s), dark));
		parts.push(prep(place(new THREE.SphereGeometry(0.06, 6, 4), 0.26 * s, 0.82, 0.88), dark));
		for (let row = 0; row < 3; row++) {
			const leg = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 4);
			parts.push(prep(place(leg, 0.2 * s, -0.36, 0.28 - row * 0.17, 0.3 + row * 0.25, 0, 0.35 * s), dark));
		}
	}
	if (variant === 'queen') {
		const crown = new THREE.CylinderGeometry(0.2, 0.17, 0.16, 5, 1, true);
		parts.push(prep(place(crown, 0, 0.5, 0.55), 0xffd54f));
	}
	if (variant === 'guard') {
		// A little helmet so guards read differently.
		parts.push(prep(place(new THREE.SphereGeometry(0.43, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.2, 0.55), 0x90a4ae));
	}
	return merge(parts);
}

function buildWing(): THREE.BufferGeometry {
	const shape = new THREE.Shape();
	shape.moveTo(0, 0);
	shape.bezierCurveTo(0.25, 0.35, 0.95, 0.42, 1.1, 0.12);
	shape.bezierCurveTo(1.15, -0.1, 0.6, -0.22, 0, 0);
	const fore = new THREE.ShapeGeometry(shape, 6);
	fore.rotateX(-Math.PI / 2);
	fore.rotateY(-0.35);
	const hind = fore.clone().scale(0.62, 1, 0.62);
	hind.translate(0, -0.04, -0.2);
	return merge([prep(fore), prep(hind)]);
}

/**
 * Low draw-call bee for NPCs: one merged body mesh + one mesh per wing side (3 draws),
 * versus ~35 for the fully expressive player model.
 */
export class SimpleBee {
	readonly root = new THREE.Group();
	private wings: THREE.Mesh[] = [];
	private phase = Math.random() * 10;

	constructor(variant: Variant, scale: number) {
		let g = geoCache.get(variant);
		if (!g) {
			g = { body: buildBody(variant), wing: buildWing() };
			geoCache.set(variant, g);
		}
		bodyMat ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
		wingMat ??= new THREE.MeshStandardMaterial({ color: 0xe6f6ff, roughness: 0.1, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
		const body = new THREE.Mesh(g.body, bodyMat);
		body.castShadow = true;
		this.root.add(body);
		for (const s of [1, -1]) {
			const w = new THREE.Mesh(g.wing, wingMat);
			w.position.set(0.1 * s, 0.38, 0.16);
			w.scale.x = s;
			w.userData.side = s;
			this.root.add(w);
			this.wings.push(w);
		}
		this.root.scale.setScalar(scale);
	}

	setExpression(_e: Expression, _duration = 0): void {}

	update(dt: number, _time: number, flap: number): void {
		this.phase += dt * (16 + flap * 18) * Math.PI * 2;
		const amp = 0.55 + flap * 0.5;
		for (const w of this.wings) w.rotation.z = (Math.sin(this.phase) * amp + 0.25) * (w.userData.side as number);
	}

	dispose(): void {}

	static disposeShared(): void {
		for (const g of geoCache.values()) {
			g.body.dispose();
			g.wing.dispose();
		}
		geoCache.clear();
		bodyMat?.dispose();
		wingMat?.dispose();
		bodyMat = wingMat = null;
	}
}
