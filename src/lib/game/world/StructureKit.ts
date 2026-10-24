import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Terrain } from './Terrain';
import { blob, merge, place, prep } from '../utils/geometry';
import { glowMaterial } from './Materials';
import { Noise2D } from '../utils/Noise';

export type MatKey = 'stone' | 'arcane' | 'warm' | 'verdant' | 'plain';

export interface PartOpts {
	rx?: number;
	ry?: number;
	rz?: number;
	glow?: number;
	collide?: boolean;
}

/** A finished structure: merged meshes plus a bounding circle for distance culling. */
export interface Structure {
	name: string;
	group: THREE.Group;
	x: number;
	z: number;
	radius: number;
}

const noise = new Noise2D(31337);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

/** Shared materials for all architecture. */
export class StructureMaterials {
	readonly mats: Record<MatKey, THREE.Material>;
	constructor() {
		this.mats = {
			stone: glowMaterial({ vertexColors: true, roughness: 0.92, glow: 0x6fe0ff, glowStrength: 2.4, pulse: 0.35 }),
			arcane: glowMaterial({ vertexColors: true, roughness: 0.85, glow: 0xb87aff, glowStrength: 2.6, pulse: 0.45 }),
			warm: glowMaterial({ vertexColors: true, roughness: 0.85, glow: 0xffa848, glowStrength: 2.2, pulse: 0.12 }),
			verdant: glowMaterial({ vertexColors: true, roughness: 0.9, glow: 0x7dffa8, glowStrength: 2.2, pulse: 0.4 }),
			plain: new THREE.MeshLambertMaterial({ vertexColors: true })
		};
	}
	dispose(): void {
		for (const m of Object.values(this.mats)) m.dispose();
	}
}

/**
 * Accumulates prepared parts per material for one structure, then merges them into a few
 * meshes. Also creates static colliders for solid parts.
 */
export class Kit {
	private buckets = new Map<MatKey, THREE.BufferGeometry[]>();
	private name = '';
	private cx = 0;
	private cz = 0;
	private radius = 10;

	constructor(
		readonly physics: PhysicsWorld,
		readonly terrain: Terrain,
		private materials: StructureMaterials
	) {}

	gy(x: number, z: number): number {
		return this.terrain.heightAt(x, z);
	}

	begin(name: string, x: number, z: number, radius: number): this {
		this.buckets.clear();
		this.name = name;
		this.cx = x;
		this.cz = z;
		this.radius = radius;
		return this;
	}

	add(m: MatKey, geo: THREE.BufferGeometry): void {
		let b = this.buckets.get(m);
		if (!b) {
			b = [];
			this.buckets.set(m, b);
		}
		b.push(geo);
	}

	/** Box with its centre at (x, y, z). */
	box(m: MatKey, x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.ColorRepresentation, o: PartOpts = {}): void {
		const g = new THREE.BoxGeometry(w, h, d);
		place(g, x, y, z, o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
		this.add(m, prep(g, color, o.glow ?? 0));
		if (o.collide) this.physics.addCuboid(x, y, z, w / 2, h / 2, d / 2, o.ry ?? 0, { kind: 'static', material: 'stone' }, o.rx ?? 0, o.rz ?? 0);
	}

	/** Cylinder standing on (x, y, z). */
	cyl(m: MatKey, x: number, y: number, z: number, rTop: number, rBot: number, h: number, seg: number, color: THREE.ColorRepresentation, o: PartOpts = {}): void {
		const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
		g.translate(0, h / 2, 0);
		place(g, x, y, z, o.rx ?? 0, o.ry ?? 0, o.rz ?? 0);
		this.add(m, prep(g, color, o.glow ?? 0));
		if (o.collide) this.physics.addCylinder(x, y + h / 2, z, h / 2, Math.max(rTop, rBot), { kind: 'static', material: 'stone' });
	}

	/** Arbitrary geometry with a transform. */
	geo(m: MatKey, g: THREE.BufferGeometry, color: THREE.ColorRepresentation | undefined, x: number, y: number, z: number, o: PartOpts & { s?: number; sy?: number } = {}): void {
		place(g, x, y, z, o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, o.s ?? 1, o.sy ?? o.s ?? 1, o.s ?? 1);
		this.add(m, prep(g, color, o.glow ?? 0));
	}

	/** Lumpy boulder; collides as a ball when `collide`. */
	rock(x: number, y: number, z: number, s: number, color: THREE.ColorRepresentation, seed: number, o: { sy?: number; collide?: boolean; moss?: number } = {}): void {
		const g = blob(1, 1, 0.3, seed);
		g.scale(1.25 * s, (o.sy ?? 0.8) * s, 1.1 * s);
		g.rotateY(seed * 1.7);
		g.translate(x, y, z);
		g.computeVertexNormals();
		const p = prep(g, color);
		if (o.moss !== undefined) {
			const n = p.attributes.normal;
			const c = p.attributes.color;
			const moss = new THREE.Color(o.moss);
			const tmp = new THREE.Color();
			for (let i = 0; i < n.count; i++) {
				const k = THREE.MathUtils.smoothstep(n.getY(i), 0.45, 0.95);
				tmp.setRGB(c.getX(i), c.getY(i), c.getZ(i)).lerp(moss, k);
				c.setXYZ(i, tmp.r, tmp.g, tmp.b);
			}
		}
		this.add('plain', p);
		if (o.collide) this.physics.addBall(x, y, z, Math.min(1.25, o.sy ?? 0.8) * s * 0.95, { kind: 'static', material: 'stone' });
	}

	/** Classical column: plinth, fluted-ish shaft and capital. `broken` snaps the shaft. */
	column(m: MatKey, x: number, z: number, h: number, r: number, color: number, o: { y?: number; broken?: number; collide?: boolean; glowBand?: boolean } = {}): void {
		const y = o.y ?? this.gy(x, z) - 0.2;
		this.box(m, x, y + 0.25, z, r * 2.6, 0.5, r * 2.6, shade(color, 0.85));
		const shaftH = o.broken ? h * o.broken : h;
		const g = new THREE.CylinderGeometry(r * 0.92, r, shaftH, 12, 4);
		g.translate(0, shaftH / 2, 0);
		if (o.broken) {
			// Jagged break at the top.
			const pos = g.attributes.position;
			for (let i = 0; i < pos.count; i++) {
				if (pos.getY(i) > shaftH - 0.01) pos.setY(i, shaftH - Math.abs(noise.noise(pos.getX(i) * 3 + x, pos.getZ(i) * 3 + z)) * r * 1.4);
			}
			g.computeVertexNormals();
		}
		g.translate(x, y + 0.5, z);
		this.add(m, prep(g, color));
		if (o.glowBand) this.cyl(m, x, y + 0.5 + shaftH * 0.35, z, r * 1.02, r * 1.02, 0.18, 12, color, { glow: 1 });
		if (!o.broken) this.box(m, x, y + 0.5 + h + 0.2, z, r * 2.5, 0.4, r * 2.5, shade(color, 0.9));
		if (o.collide !== false) this.physics.addCylinder(x, y + (shaftH + 0.5) / 2, z, (shaftH + 0.5) / 2, r * 1.1, { kind: 'static', material: 'stone' });
	}

	/** Round arch of voussoir blocks between two pillars, facing along `ry`. */
	arch(m: MatKey, x: number, z: number, ry: number, width: number, pillarH: number, thick: number, color: number, o: { y?: number; glow?: boolean } = {}): void {
		const y = o.y ?? this.gy(x, z) - 0.2;
		const c = Math.cos(ry);
		const s = Math.sin(ry);
		const half = width / 2;
		const pw = thick * 1.1;
		for (const side of [-1, 1]) {
			const px = x + c * side * (half + pw / 2);
			const pz = z - s * side * (half + pw / 2);
			this.box(m, px, y + pillarH / 2, pz, pw, pillarH, thick, color, { ry, collide: true });
		}
		const segs = 9;
		const r = half + pw / 2;
		for (let i = 0; i < segs; i++) {
			const a0 = (i / segs) * Math.PI;
			const a1 = ((i + 1) / segs) * Math.PI;
			const am = (a0 + a1) / 2;
			const lx = Math.cos(am) * r;
			const ly = Math.sin(am) * r;
			const len = 2 * r * Math.sin((a1 - a0) / 2) + 0.05;
			const g = new THREE.BoxGeometry(len, pw, thick);
			g.rotateZ(am + Math.PI / 2);
			g.translate(lx, ly, 0);
			g.rotateY(ry);
			g.translate(x, y + pillarH, z);
			this.add(m, prep(g, i === Math.floor(segs / 2) && o.glow ? shade(color, 1.1) : shade(color, 0.95 + (i % 2) * 0.06), i === Math.floor(segs / 2) && o.glow ? 1 : 0));
		}
	}

	/**
	 * Straight wall from (x0, z0) to (x1, z1), optionally with arched window openings and a
	 * ragged (ruined) top.
	 */
	wall(m: MatKey, x0: number, z0: number, x1: number, z1: number, h: number, thick: number, color: number, o: { y?: number; windows?: number; ruin?: number; collide?: boolean; seed?: number } = {}): void {
		const dx = x1 - x0;
		const dz = z1 - z0;
		const len = Math.hypot(dx, dz);
		const ry = Math.atan2(-dz, dx);
		const y = o.y ?? Math.min(this.gy(x0, z0), this.gy(x1, z1)) - 0.3;
		const n = Math.max(1, Math.round(len / 2.2));
		const seg = len / n;
		const seed = o.seed ?? 0;
		for (let i = 0; i < n; i++) {
			const t = (i + 0.5) / n;
			const cx = x0 + dx * t;
			const cz = z0 + dz * t;
			let sh = h;
			if (o.ruin) sh = h * (1 - o.ruin * Math.max(0, noise.noise(i * 0.6 + seed, 3.1) * 0.5 + 0.5 - 0.15));
			sh = Math.max(0.8, sh);
			const window = o.windows && i % 2 === 1 && sh > h * 0.7;
			if (window) {
				const sill = h * 0.3;
				const top = h * 0.75;
				this.box(m, cx, y + sill / 2, cz, seg + 0.02, sill, thick, shade(color, 0.97), { ry });
				if (sh > top) this.box(m, cx, y + (top + sh) / 2, cz, seg + 0.02, sh - top, thick, shade(color, 1.0), { ry });
			} else this.box(m, cx, y + sh / 2, cz, seg + 0.02, sh, thick, shade(color, 0.94 + (i % 3) * 0.04), { ry });
		}
		if (o.collide !== false) {
			this.physics.addCuboid((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2, len / 2, h / 2, thick / 2, ry, { kind: 'static', material: 'stone' });
		}
	}

	/** Gabled roof prism, ridge along local X. */
	gableRoof(m: MatKey, x: number, y: number, z: number, w: number, d: number, h: number, ry: number, color: number): void {
		const hw = w / 2;
		const hd = d / 2;
		const verts = [
			-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
			-hw, h, 0, hw, h, 0
		];
		const idx = [0, 4, 1, 1, 4, 5, 3, 2, 4, 2, 5, 4, 0, 3, 4, 1, 5, 2, 0, 1, 2, 0, 2, 3];
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
		g.setIndex(idx);
		const ng = g.toNonIndexed();
		g.dispose();
		ng.computeVertexNormals();
		place(ng, x, y, z, 0, ry, 0);
		this.add(m, prep(ng, color));
	}

	/** Floating rock island: grassy top disc over an inverted craggy cone. */
	isle(x: number, y: number, z: number, r: number, seed: number, top = 0x5a7a4a): THREE.BufferGeometry {
		const cone = new THREE.ConeGeometry(r, r * 1.8, 9, 4);
		cone.rotateX(Math.PI);
		cone.translate(0, -r * 0.9, 0);
		const pos = cone.attributes.position;
		for (let i = 0; i < pos.count; i++) {
			_v.fromBufferAttribute(pos, i);
			const k = 1 + noise.noise(_v.x * 0.8 + seed, _v.y * 0.8 + _v.z * 0.5) * 0.28;
			pos.setXYZ(i, _v.x * k, _v.y, _v.z * k);
		}
		cone.computeVertexNormals();
		const capG = new THREE.CylinderGeometry(r * 1.02, r * 0.95, 0.5, 12);
		capG.translate(0, -0.15, 0);
		const parts = [prep(cone, 0x5a5066), prep(capG, top)];
		const g = merge(parts);
		g.translate(x, y, z);
		return g;
	}

	end(): Structure {
		const group = new THREE.Group();
		group.name = this.name;
		for (const [m, geos] of this.buckets) {
			if (!geos.length) continue;
			const g = merge(geos);
			g.computeBoundingSphere();
			const mesh = new THREE.Mesh(g, this.materials.mats[m]);
			mesh.castShadow = true;
			mesh.receiveShadow = true;
			group.add(mesh);
		}
		this.buckets.clear();
		return { name: this.name, group, x: this.cx, z: this.cz, radius: this.radius };
	}
}

export function shade(hex: number, k: number): THREE.Color {
	return new THREE.Color(hex).multiplyScalar(k);
}

/** Small helper for instanced decor (e.g. lantern posts) sharing one geometry. */
export function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, transforms: { x: number; y: number; z: number; ry?: number; s?: number }[]): THREE.InstancedMesh {
	const mesh = new THREE.InstancedMesh(geo, mat, transforms.length);
	transforms.forEach((t, i) => {
		_q.setFromEuler(_e.set(0, t.ry ?? 0, 0));
		mesh.setMatrixAt(i, _m.compose(_v.set(t.x, t.y, t.z), _q, new THREE.Vector3().setScalar(t.s ?? 1)));
	});
	mesh.instanceMatrix.needsUpdate = true;
	mesh.computeBoundingSphere();
	mesh.castShadow = true;
	return mesh;
}
