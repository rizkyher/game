import * as THREE from 'three';
import type { Terrain } from './TerrainGenerator';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { HIVE, LANDMARKS, WORLD_SEED, edgeDistance, landmark } from './Biomes';
import { Noise2D } from '../utils/Noise';
import { Random } from '../utils/Random';
import { SpatialHash, type SpatialItem } from '../utils/SpatialHash';
import { merge, prep } from '../utils/geometry';
import { tintMaterial, windMaterial } from './Materials';
import {
	branchGeometry,
	bushGeometry,
	canopyGeometry,
	fernGeometry,
	flowerShape,
	mushroomGeometry,
	rockGeometry,
	trunkGeometry,
	type FlowerShape,
	type FlowerType
} from './Flora';

export interface VegLayer {
	mesh: THREE.InstancedMesh;
	/** Max render distance for this layer (before the global draw distance clamp). */
	maxDist: number;
	total: number;
	/** Layers that thin out on lower graphics presets. */
	densityScaled: boolean;
	wobble?: THREE.InstancedBufferAttribute;
}

export interface ChunkLike {
	minX: number;
	minZ: number;
	size: number;
	index: number;
	group: THREE.Group;
	layers: VegLayer[];
}

export interface FlowerRef extends SpatialItem {
	y: number;
	r: number;
	type: FlowerType;
	layer: VegLayer;
	index: number;
	scale: number;
	pollen: number;
	nectarAt: number;
	wobble: number;
	wobbleX: number;
	wobbleZ: number;
	hitCooldown: number;
	hidden: boolean;
	respawnAt: number;
	matrix: THREE.Matrix4;
}

const FLOWER_TYPES: FlowerType[] = ['daisy', 'tulip', 'sunflower', 'lavender', 'rose', 'dandelion'];

const PALETTES: Record<FlowerType, number[]> = {
	daisy: [0xffffff, 0xffffff, 0xffb3d9, 0xc8a2ff, 0xfff07a, 0x9fd8ff, 0xff9e80],
	tulip: [0xff3b3b, 0xff8c2a, 0xffd23a, 0xff6fae, 0xa35bff, 0xfff6f0],
	sunflower: [0xffcc1f, 0xffb31a, 0xffd84a],
	lavender: [0x9b6bd6, 0xb388ff, 0x8a5cc7],
	rose: [0xe0193a, 0xff7aa8, 0xfff4f0, 0xffd75e, 0xff7f6a],
	dandelion: [0xffffff]
};

const FLOWER_DIST: Record<FlowerType, number> = {
	daisy: 175,
	tulip: 175,
	sunflower: 9999,
	lavender: 230,
	rose: 175,
	dandelion: 160
};

const CANOPY = [0x3f9a3f, 0x4caf50, 0x5cb85c, 0x2e8b57, 0x6bbf59, 0x48a848];
const CANOPY_SPECIAL = [0xe07ab8, 0xffb347, 0x9b7fe0, 0xf06292];

export interface TreeSpec {
	x: number;
	z: number;
	y: number;
	h: number;
	r: number;
	yaw: number;
	special: boolean;
}

/**
 * Scatters flowers, trees, rocks, mushrooms, ferns and bushes per chunk using deterministic
 * noise + RNG, and keeps a spatial index of flower heads for gameplay interaction.
 */
export class Vegetation {
	readonly flowers = new SpatialHash<FlowerRef>(16);
	readonly allFlowers: FlowerRef[] = [];
	readonly trees: TreeSpec[] = [];
	private shapes = new Map<FlowerType, FlowerShape>();
	private flowerMats = new Map<FlowerType, THREE.Material>();
	private noise = new Noise2D(WORLD_SEED + 17);
	private wobbling = new Set<FlowerRef>();
	private exclusions: { x: number; z: number; r: number }[] = [];
	private geos: Record<string, THREE.BufferGeometry> = {};
	private mats: Record<string, THREE.Material> = {};
	private m = new THREE.Matrix4();
	private q = new THREE.Quaternion();
	private v = new THREE.Vector3();
	private s = new THREE.Vector3();
	private c = new THREE.Color();
	private up = new THREE.Vector3(0, 1, 0);
	density = 1;

	constructor(
		private terrain: Terrain,
		private physics: PhysicsWorld
	) {
		for (const t of FLOWER_TYPES) {
			const shape = flowerShape(t);
			this.shapes.set(t, shape);
			this.flowerMats.set(
				t,
				windMaterial(
					{ vertexColors: true, side: THREE.DoubleSide },
					{ height: shape.height, amount: t === 'sunflower' ? 0.9 : 0.6, wobble: true, tint: true }
				)
			);
		}
		this.geos.trunk = trunkGeometry();
		this.geos.branch = branchGeometry();
		this.geos.canopy = canopyGeometry();
		this.geos.mushroom = mushroomGeometry(true);
		this.geos.glow = mushroomGeometry(false);
		this.geos.fern = fernGeometry();
		this.geos.bush = bushGeometry(11);
		this.geos.rock = rockGeometry(7);
		this.mats.bark = new THREE.MeshLambertMaterial({ vertexColors: true });
		this.mats.canopy = windMaterial({ vertexColors: true }, { height: 1, amount: 0.05, tint: true });
		this.mats.tint = tintMaterial({ vertexColors: true });
		this.mats.rock = tintMaterial({ vertexColors: true, flatShading: true });
		this.mats.fern = windMaterial({ vertexColors: true, side: THREE.DoubleSide }, { height: 3.6, amount: 0.35 });
		this.mats.glow = new THREE.MeshBasicMaterial({ vertexColors: true });
		this.mats.vine = new THREE.MeshLambertMaterial({ vertexColors: true });

		for (const l of LANDMARKS) {
			if (['picnic', 'garden', 'fairyRing', 'hollowTree', 'hollowLog', 'elderTree', 'birdNest'].includes(l.id)) {
				this.exclusions.push({ x: l.x, z: l.z, r: l.id === 'elderTree' ? 34 : l.id === 'birdNest' ? 14 : 30 });
			}
		}
		this.exclusions.push({ x: HIVE.x, z: HIVE.z, r: 66 });
		this.exclusions.push({ x: terrain.pond.x, z: terrain.pond.z, r: 58 });
		this.exclusions.push({ x: -120, z: 70, r: 14 }); // cherry tree near the picnic
	}

	private excluded(x: number, z: number, pad = 0): boolean {
		for (const e of this.exclusions) {
			const dx = x - e.x;
			const dz = z - e.z;
			const r = e.r + pad;
			if (dx * dx + dz * dz < r * r) return true;
		}
		return false;
	}

	private makeLayer(
		chunk: ChunkLike,
		geo: THREE.BufferGeometry,
		mat: THREE.Material,
		count: number,
		maxDist: number,
		opts: { shadow?: boolean; densityScaled?: boolean; wobble?: boolean; name?: string }
	): VegLayer {
		const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
		mesh.name = opts.name ?? 'veg';
		mesh.count = count;
		mesh.castShadow = !!opts.shadow;
		mesh.receiveShadow = true;
		let wobble: THREE.InstancedBufferAttribute | undefined;
		if (opts.wobble) {
			// Per-instance attribute; geometry is shared so we clone a lightweight wrapper per layer.
			const g = new THREE.InstancedBufferGeometry();
			g.index = geo.index;
			for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
			wobble = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 3), 3);
			wobble.setUsage(THREE.DynamicDrawUsage);
			g.setAttribute('aWobble', wobble);
			mesh.geometry = g;
		}
		const layer: VegLayer = { mesh, maxDist, total: count, densityScaled: !!opts.densityScaled, wobble };
		chunk.layers.push(layer);
		chunk.group.add(mesh);
		return layer;
	}

	private finishLayer(layer: VegLayer): void {
		layer.mesh.instanceMatrix.needsUpdate = true;
		if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
		layer.mesh.computeBoundingSphere();
		layer.mesh.computeBoundingBox();
	}

	populate(chunk: ChunkLike): void {
		const rng = new Random(WORLD_SEED * 31 + chunk.index * 7919);
		this.scatterFlowers(chunk, rng);
		this.scatterTrees(chunk, rng);
		this.scatterSmall(chunk, rng);
	}

	private flowerWeights(x: number, z: number, d: number, f: number, out: number[]): number {
		const n = this.noise;
		const meadow = 1 - f;
		const roses = landmark('roses');
		const lav = landmark('lavender');
		const sun = landmark('sunflowers');
		const dRose = Math.hypot(x - roses.x, z - roses.z);
		const dLav = Math.hypot(x - lav.x, z - lav.z);
		const dSun = Math.hypot(x - sun.x, z - sun.z);
		out[0] = d * (0.28 + 0.5 * Math.max(0, n.noise(x * 0.012 + 3, z * 0.012))) * (meadow * 0.9 + 0.15);
		out[1] = d * 0.45 * Math.max(0, n.noise(x * 0.014 - 40, z * 0.014 + 9)) * (meadow + 0.25);
		out[2] = dSun < 62 ? 0.32 * (1 - dSun / 70) + 0.05 : d * 0.012 * meadow;
		const row = Math.abs(Math.sin((z - lav.z) * 0.32));
		out[3] = dLav < 72 ? (row > 0.55 ? 0.95 : 0.02) * (1 - Math.max(0, dLav - 55) / 17) : d * 0.03 * meadow;
		out[4] = dRose < 46 ? 0.7 : d * 0.09 * meadow * Math.max(0, n.noise(x * 0.02 + 70, z * 0.02 - 70) + 0.2);
		out[5] = d * 0.07 * meadow;
		return out[0] + out[1] + out[2] + out[3] + out[4] + out[5];
	}

	private scatterFlowers(chunk: ChunkLike, rng: Random): void {
		const placements: Record<FlowerType, { x: number; y: number; z: number; s: number; yaw: number }[]> = {
			daisy: [],
			tulip: [],
			sunflower: [],
			lavender: [],
			rose: [],
			dandelion: []
		};
		const w = [0, 0, 0, 0, 0, 0];
		const candidates = 560;
		for (let i = 0; i < candidates; i++) {
			const x = chunk.minX + rng.next() * chunk.size;
			const z = chunk.minZ + rng.next() * chunk.size;
			const d = this.terrain.densityAt(x, z);
			if (d < 0.05) continue;
			if (this.excluded(x, z, -10)) continue;
			const f = this.terrain.forestAt(x, z);
			const total = this.flowerWeights(x, z, d, f, w);
			if (rng.next() > Math.min(1, total)) continue;
			let pick = rng.next() * total;
			let t = 0;
			for (; t < 5; t++) {
				pick -= w[t];
				if (pick <= 0) break;
			}
			const type = FLOWER_TYPES[t];
			const y = this.terrain.heightAt(x, z) - 0.15;
			placements[type].push({ x, y, z, s: rng.range(0.8, 1.28), yaw: rng.range(0, Math.PI * 2) });
		}
		for (const type of FLOWER_TYPES) {
			const list = placements[type];
			if (!list.length) continue;
			const shape = this.shapes.get(type)!;
			const layer = this.makeLayer(chunk, shape.geo, this.flowerMats.get(type)!, list.length, FLOWER_DIST[type], {
				shadow: type === 'sunflower',
				densityScaled: type !== 'sunflower',
				wobble: true,
				name: type
			});
			const pal = PALETTES[type];
			list.forEach((p, i) => {
				this.q.setFromAxisAngle(this.up, p.yaw);
				this.s.setScalar(p.s);
				this.v.set(p.x, p.y, p.z);
				const matrix = new THREE.Matrix4().compose(this.v, this.q, this.s);
				layer.mesh.setMatrixAt(i, matrix);
				layer.mesh.setColorAt(i, this.c.setHex(pal[rng.int(0, pal.length - 1)]));
				const head = shape.head.clone().multiplyScalar(p.s).applyQuaternion(this.q);
				const ref: FlowerRef = {
					x: p.x + head.x,
					z: p.z + head.z,
					y: p.y + head.y,
					r: shape.headRadius * p.s,
					type,
					layer,
					index: i,
					scale: p.s,
					pollen: 1,
					nectarAt: 0,
					wobble: 0,
					wobbleX: 0,
					wobbleZ: 0,
					hitCooldown: 0,
					hidden: false,
					respawnAt: 0,
					matrix
				};
				this.flowers.insert(ref);
				this.allFlowers.push(ref);
				if (type === 'sunflower') {
					this.physics.addCylinder(p.x, p.y + 8.5 * p.s, p.z, 8.5 * p.s, 0.45 * p.s, { kind: 'static', material: 'plant' });
				}
			});
			this.finishLayer(layer);
		}
	}

	private scatterTrees(chunk: ChunkLike, rng: Random): void {
		const cell = 30;
		const specs: TreeSpec[] = [];
		for (let gx = 0; gx < chunk.size / cell; gx++) {
			for (let gz = 0; gz < chunk.size / cell; gz++) {
				const x = chunk.minX + (gx + rng.range(0.15, 0.85)) * cell;
				const z = chunk.minZ + (gz + rng.range(0.15, 0.85)) * cell;
				const f = this.terrain.forestAt(x, z);
				const p = f > 0.6 ? 0.82 : f > 0.3 ? 0.3 : 0.018;
				if (!rng.chance(p)) continue;
				if (this.excluded(x, z)) continue;
				if (edgeDistance(x, z) > 455) continue;
				if (this.terrain.waterLevelAt(x, z) > -Infinity) continue;
				const sq = { d: 0, level: 0, dx: 0, dz: 0 };
				this.terrain.streamQuery(x, z, sq);
				if (sq.d < 16) continue;
				const forest = f > 0.5;
				const h = forest ? rng.range(58, 102) : rng.range(30, 46);
				specs.push({
					x,
					z,
					y: this.terrain.heightAt(x, z),
					h,
					r: h * rng.range(0.05, 0.065),
					yaw: rng.range(0, Math.PI * 2),
					special: rng.chance(0.1)
				});
			}
		}
		if (!specs.length) return;
		this.buildTrees(chunk, specs, rng);
	}

	/** Builds instanced trunks/branches/canopies + colliders for a set of trees (also used for landmark trees). */
	buildTrees(chunk: ChunkLike, specs: TreeSpec[], rng: Random): void {
		const branches: THREE.Matrix4[] = [];
		const canopies: { m: THREE.Matrix4; c: number }[] = [];
		const vines: THREE.BufferGeometry[] = [];
		const trunkLayer = this.makeLayer(chunk, this.geos.trunk, this.mats.bark, specs.length, 9999, { shadow: true, name: 'trunk' });
		const a = new THREE.Vector3();
		const b = new THREE.Vector3();
		specs.forEach((t, i) => {
			this.trees.push(t);
			this.q.setFromAxisAngle(this.up, t.yaw);
			this.v.set(t.x, t.y - 1, t.z);
			this.s.set(t.r, t.h * 0.93, t.r);
			trunkLayer.mesh.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
			a.set(t.x, t.y - 2, t.z);
			b.set(t.x, t.y + t.h * 0.5, t.z);
			this.physics.addCapsuleBetween(a, b, t.r * 0.86);
			a.copy(b);
			b.set(t.x, t.y + t.h * 0.92, t.z);
			this.physics.addCapsuleBetween(a, b, t.r * 0.66);
			const palette = t.special ? CANOPY_SPECIAL : CANOPY;
			const color = palette[rng.int(0, palette.length - 1)];
			const nb = rng.int(3, 5);
			for (let k = 0; k < nb; k++) {
				const hb = t.h * rng.range(0.42, 0.8);
				const yaw = t.yaw + (k / nb) * Math.PI * 2 + rng.range(-0.4, 0.4);
				const pitch = rng.range(0.75, 1.15);
				const len = t.h * rng.range(0.26, 0.4);
				const dir = new THREE.Vector3(Math.sin(pitch) * Math.cos(yaw), Math.cos(pitch), Math.sin(pitch) * Math.sin(yaw));
				const base = new THREE.Vector3(t.x, t.y + hb, t.z);
				const br = t.r * 0.33;
				const q = new THREE.Quaternion().setFromUnitVectors(this.up, dir);
				branches.push(new THREE.Matrix4().compose(base, q, new THREE.Vector3(br, len, br)));
				const tip = base.clone().addScaledVector(dir, len);
				const mid = base.clone().addScaledVector(dir, t.r * 0.8);
				this.physics.addCapsuleBetween(mid, tip, br * 0.75);
				for (let c = 0; c < 1; c++) {
					const sc = t.h * rng.range(0.13, 0.18);
					const p = tip.clone().add(new THREE.Vector3(rng.range(-1, 1) * sc * 0.5, rng.range(0, 0.6) * sc, rng.range(-1, 1) * sc * 0.5));
					canopies.push({ m: new THREE.Matrix4().compose(p, this.q.clone(), new THREE.Vector3(sc, sc * 0.78, sc)), c: color });
				}
				// Hanging vines from some branches in the forest.
				if (t.h > 50 && rng.chance(0.45)) {
					const start = base.clone().addScaledVector(dir, len * rng.range(0.45, 0.8));
					const drop = rng.range(10, 26);
					const pts = [start];
					for (let s = 1; s <= 4; s++) {
						pts.push(start.clone().add(new THREE.Vector3(Math.sin(s * 1.3 + k) * 1.2, -drop * (s / 4), Math.cos(s * 1.1 + k) * 1.2)));
					}
					const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, 0.16, 3, false);
					vines.push(prep(tube, rng.chance(0.5) ? 0x4a8a3a : 0x3c7a34));
					if (rng.chance(0.6)) {
						const leafBall = new THREE.IcosahedronGeometry(0.7, 0);
						const end = pts[pts.length - 1];
						leafBall.translate(end.x, end.y, end.z);
						vines.push(prep(leafBall, 0x56a346));
					}
				}
			}
			const top = new THREE.Vector3(t.x, t.y + t.h * 0.93, t.z);
			const nc = rng.int(4, 6);
			for (let c = 0; c < nc; c++) {
				const sc = t.h * rng.range(0.15, 0.23);
				const ang = (c / nc) * Math.PI * 2;
				const off = c === 0 ? 0 : t.h * rng.range(0.1, 0.17);
				const p = top.clone().add(new THREE.Vector3(Math.cos(ang) * off, rng.range(-0.06, 0.08) * t.h, Math.sin(ang) * off));
				canopies.push({ m: new THREE.Matrix4().compose(p, this.q.clone(), new THREE.Vector3(sc, sc * 0.75, sc)), c: color });
			}
		});
		this.finishLayer(trunkLayer);
		const branchLayer = this.makeLayer(chunk, this.geos.branch, this.mats.bark, branches.length, 9999, { shadow: true, name: 'branch' });
		branches.forEach((m, i) => branchLayer.mesh.setMatrixAt(i, m));
		this.finishLayer(branchLayer);
		const canopyLayer = this.makeLayer(chunk, this.geos.canopy, this.mats.canopy, canopies.length, 9999, { shadow: true, name: 'canopy' });
		canopies.forEach((cp, i) => {
			canopyLayer.mesh.setMatrixAt(i, cp.m);
			this.c.setHex(cp.c).offsetHSL(rng.range(-0.02, 0.02), 0, rng.range(-0.06, 0.06));
			canopyLayer.mesh.setColorAt(i, this.c);
		});
		this.finishLayer(canopyLayer);
		if (vines.length) {
			const vineMesh = new THREE.Mesh(merge(vines), this.mats.vine);
			chunk.group.add(vineMesh);
		}
	}

	private scatterSmall(chunk: ChunkLike, rng: Random): void {
		type P = { x: number; y: number; z: number; s: number; yaw: number; c: number };
		const lists: Record<'mushroom' | 'glow' | 'fern' | 'bush' | 'rock', P[]> = { mushroom: [], glow: [], fern: [], bush: [], rock: [] };
		const sq = { d: 0, level: 0, dx: 0, dz: 0 };
		for (let i = 0; i < 320; i++) {
			const x = chunk.minX + rng.next() * chunk.size;
			const z = chunk.minZ + rng.next() * chunk.size;
			if (this.excluded(x, z, -6)) continue;
			if (this.terrain.waterLevelAt(x, z) > -Infinity) continue;
			const f = this.terrain.forestAt(x, z);
			const e = edgeDistance(x, z);
			const y = this.terrain.heightAt(x, z);
			const r = rng.next();
			const yaw = rng.range(0, Math.PI * 2);
			this.terrain.streamQuery(x, z, sq);
			const nearStream = sq.d < 20;
			if (e > 400) {
				if (r < 0.22) lists.rock.push({ x, y: y - 0.6, z, s: rng.range(2, 7), yaw, c: rng.pick([0x9a94a6, 0x8c8698, 0xb0aabb]) });
				continue;
			}
			if (f > 0.5) {
				if (r < 0.1) lists.mushroom.push({ x, y, z, s: rng.range(1.2, 3.6), yaw, c: rng.pick([0xe53935, 0xff7043, 0xa1887f, 0xd81b60, 0xffb74d]) });
				else if (r < 0.14) lists.glow.push({ x, y, z, s: rng.range(1, 2.4), yaw, c: rng.pick([0x5ef2ff, 0xb18cff, 0x7dffb0]) });
				else if (r < 0.38) lists.fern.push({ x, y: y - 0.1, z, s: rng.range(0.9, 1.8), yaw, c: 0 });
				else if (r < 0.44) lists.bush.push({ x, y: y - 0.3, z, s: rng.range(2.5, 5), yaw, c: rng.pick([0x2f7d32, 0x388e3c, 0x43a047]) });
				else if (r < (nearStream ? 0.58 : 0.47)) lists.rock.push({ x, y: y - 0.4, z, s: rng.range(1, 4.5), yaw, c: rng.pick([0x8d9a7a, 0x7f8c74, 0x9e9a8c]) });
			} else {
				if (r < 0.025) lists.bush.push({ x, y: y - 0.3, z, s: rng.range(2.5, 5.5), yaw, c: rng.pick([0x5ea845, 0x6abf4b, 0x4f9a3a]) });
				else if (r < (nearStream ? 0.12 : 0.04)) lists.rock.push({ x, y: y - 0.4, z, s: rng.range(1, 3.5), yaw, c: rng.pick([0xb8b0a0, 0xa9a294, 0xc4bcae]) });
				else if (r < 0.05) lists.mushroom.push({ x, y, z, s: rng.range(1, 2), yaw, c: rng.pick([0xe53935, 0xffb74d]) });
			}
		}
		const add = (key: keyof typeof lists, geo: THREE.BufferGeometry, mat: THREE.Material, maxDist: number, shadow: boolean, scaled: boolean) => {
			const list = lists[key];
			if (!list.length) return;
			const layer = this.makeLayer(chunk, geo, mat, list.length, maxDist, { shadow, densityScaled: scaled, name: key });
			list.forEach((p, i) => {
				this.q.setFromAxisAngle(this.up, p.yaw);
				this.v.set(p.x, p.y, p.z);
				this.s.setScalar(p.s);
				if (key === 'rock') this.s.set(p.s, p.s * rng.range(0.6, 1.1), p.s * rng.range(0.8, 1.2));
				layer.mesh.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
				if (key !== 'fern') layer.mesh.setColorAt(i, this.c.setHex(p.c));
				if (key === 'rock' && p.s > 2.2) this.physics.addBall(p.x, p.y + 0.35 * p.s, p.z, 0.72 * Math.min(this.s.x, this.s.y * 1.4, this.s.z));
				if (key === 'mushroom' && p.s > 2.8) {
					this.physics.addCylinder(p.x, p.y + p.s * 0.5, p.z, p.s * 0.5, p.s * 0.24, { kind: 'static', material: 'plant' });
					this.physics.addCylinder(p.x, p.y + p.s * 1.05, p.z, p.s * 0.2, p.s * 0.8, { kind: 'bouncy', material: 'soft' });
				}
			});
			this.finishLayer(layer);
		};
		add('mushroom', this.geos.mushroom, this.mats.tint, 170, false, true);
		add('glow', this.geos.glow, this.mats.glow, 220, false, false);
		add('fern', this.geos.fern, this.mats.fern, 160, false, true);
		add('bush', this.geos.bush, this.mats.tint, 240, false, false);
		add('rock', this.geos.rock, this.mats.rock, 230, false, false);
	}

	/** Called on contact: makes a flower wobble in the push direction. */
	touchFlower(f: FlowerRef, dirX: number, dirZ: number, strength: number): void {
		const len = Math.hypot(dirX, dirZ) || 1;
		f.wobbleX = dirX / len;
		f.wobbleZ = dirZ / len;
		f.wobble = Math.min(1.6, Math.max(f.wobble, strength));
		this.wobbling.add(f);
	}

	hideFlower(f: FlowerRef, time: number, respawnDelay: number): void {
		f.hidden = true;
		f.respawnAt = time + respawnDelay;
		this.m.copy(f.matrix);
		this.m.scale(this.v.setScalar(0.0001));
		f.layer.mesh.setMatrixAt(f.index, this.m);
		f.layer.mesh.instanceMatrix.needsUpdate = true;
		this.wobbling.add(f);
	}

	isFlowerVisible(f: FlowerRef): boolean {
		return !f.hidden && f.index < f.layer.mesh.count;
	}

	update(dt: number, time: number): void {
		for (const f of this.wobbling) {
			if (f.hidden) {
				if (time > f.respawnAt) {
					f.hidden = false;
					f.pollen = 1;
					f.layer.mesh.setMatrixAt(f.index, f.matrix);
					f.layer.mesh.instanceMatrix.needsUpdate = true;
				} else continue;
			}
			f.wobble *= Math.exp(-2.6 * dt);
			if (f.hitCooldown > 0) f.hitCooldown -= dt;
			const attr = f.layer.wobble;
			if (attr) {
				attr.setXYZ(f.index, f.wobbleX, f.wobbleZ, f.wobble);
				attr.needsUpdate = true;
			}
			if (f.wobble < 0.01 && f.hitCooldown <= 0) {
				f.wobble = 0;
				if (attr) attr.setXYZ(f.index, 0, 0, 0);
				this.wobbling.delete(f);
			}
		}
	}

	setDensity(d: number, chunks: ChunkLike[]): void {
		this.density = d;
		for (const ch of chunks) {
			for (const l of ch.layers) if (l.densityScaled) l.mesh.count = Math.max(0, Math.floor(l.total * d));
		}
	}

	dispose(): void {
		for (const g of Object.values(this.geos)) g.dispose();
		for (const m of Object.values(this.mats)) m.dispose();
		for (const s of this.shapes.values()) s.geo.dispose();
		for (const m of this.flowerMats.values()) m.dispose();
	}
}
