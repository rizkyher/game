import * as THREE from 'three';
import type { Terrain } from './Terrain';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Random, hash2 } from '../utils/Random';
import { Noise2D } from '../utils/Noise';
import { WORLD_HALF, edgeDistance, hollowMask, roadDistance, sanctuaryMask } from './WorldLayout';
import { glowMaterial, windMaterial } from './Materials';
import * as F from './Flora';

export interface SiteInfo {
	x: number;
	z: number;
	h: number;
	slope: number;
	forest: number;
	high: number;
	sanct: number;
	hollow: number;
	vale: number;
	edge: number;
	n: number;
}

export interface LayerDef {
	id: string;
	geo: THREE.BufferGeometry;
	mat: THREE.Material;
	lo?: { geo: THREE.BufferGeometry; mat: THREE.Material; dist: number };
	/** Stratified sample spacing in metres. */
	cell: number;
	maxDist: number;
	shadow: boolean;
	maxSlope: number;
	roadClear: number;
	scale: [number, number];
	sink?: number;
	tilt?: number;
	prob(s: SiteInfo): number;
	collider?(physics: PhysicsWorld, x: number, y: number, z: number, s: number): void;
	/** Instances are kept out of clearings by this extra padding (default: excluded entirely). */
	clearingPad?: number;
	/** Scales with the quality preset's vegetation density. */
	optional?: boolean;
}

export interface Instance {
	x: number;
	y: number;
	z: number;
	s: number;
	ry: number;
	rx: number;
	rz: number;
}

/** Scattered instances of one layer that fall inside one chunk. */
export interface LayerBucket {
	layer: LayerDef;
	items: Instance[];
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Defines every scattered vegetation/rock layer, scatters them deterministically over the
 * world (creating static colliders for trunks, rocks and crystals) and builds per-chunk
 * instanced meshes on demand.
 */
export class Vegetation {
	readonly layers: LayerDef[] = [];
	private materials: THREE.Material[] = [];
	private geometries: THREE.BufferGeometry[] = [];
	private noise = new Noise2D(5150);
	density = 1;

	constructor(
		private terrain: Terrain,
		private physics: PhysicsWorld
	) {
		this.defineLayers();
	}

	private track<T extends THREE.Material>(m: T): T {
		this.materials.push(m);
		return m;
	}

	private geo(g: THREE.BufferGeometry): THREE.BufferGeometry {
		this.geometries.push(g);
		return g;
	}

	private defineLayers(): void {
		const lambert = this.track(new THREE.MeshLambertMaterial({ vertexColors: true }));
		const leafWind = this.track(windMaterial({ vertexColors: true }, { height: 10, amount: 0.22 }));
		const oakWind = this.track(windMaterial({ vertexColors: true }, { height: 10, amount: 0.2 }));
		const pineWind = this.track(windMaterial({ vertexColors: true }, { height: 13, amount: 0.15 }));
		const lowWind = this.track(windMaterial({ vertexColors: true, side: THREE.DoubleSide }, { height: 1.4, amount: 0.3 }));
		const ancientMat = this.track(glowMaterial({ vertexColors: true, roughness: 0.9, glow: 0x6ff5d8, glowStrength: 1.6, pulse: 0.4, sway: { height: 22, amount: 0.22 } }));
		const cyanShroom = this.track(glowMaterial({ vertexColors: true, roughness: 0.5, glow: 0x46f0ff, glowStrength: 2.4 }));
		const pinkShroom = this.track(glowMaterial({ vertexColors: true, roughness: 0.5, glow: 0xff5ae0, glowStrength: 2.4 }));
		const blueFlower = this.track(glowMaterial({ vertexColors: true, roughness: 0.6, glow: 0x6fb8ff, glowStrength: 2.8, sway: { height: 1, amount: 0.25 }, side: THREE.DoubleSide }));
		const violetCrystal = this.track(glowMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.15, glow: 0xb070ff, glowStrength: 1.8, flatShading: true }));
		const cyanCrystal = this.track(glowMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.15, glow: 0x50e8ff, glowStrength: 1.8, flatShading: true }));
		const runeStone = this.track(glowMaterial({ vertexColors: true, roughness: 0.85, glow: 0x7fd8ff, glowStrength: 2.2, pulse: 0.5 }));

		const ancientLo = this.geo(F.treeLod(20, 9, 0x3f8a5a, 0x0e3326));
		const forestLo = this.geo(F.treeLod(9.5, 3.6, 0x4f9a52, 0x143a22));
		const oakLo = this.geo(F.treeLod(9.5, 3.6, 0x9aac4a, 0x2f4a1a));
		const pineLo = this.geo(F.treeLod(11, 2.6, 0x3f7a62, 0x1b3a3a));

		this.layers.push(
			{
				id: 'ancient',
				geo: this.geo(F.ancientTree(11)),
				mat: ancientMat,
				lo: { geo: ancientLo, mat: lambert, dist: 170 },
				cell: 30,
				maxDist: 700,
				shadow: true,
				maxSlope: 0.5,
				roadClear: 9,
				scale: [0.85, 1.25],
				sink: 0.4,
				prob: (s) => (s.forest > 0.65 ? 0.55 : 0),
				collider: (ph, x, y, z, sc) => ph.addCylinder(x, y + 6 * sc, z, 6 * sc, 1.55 * sc, { kind: 'static', material: 'wood' })
			},
			{
				id: 'forestTree',
				geo: this.geo(F.forestTree(21)),
				mat: leafWind,
				lo: { geo: forestLo, mat: lambert, dist: 120 },
				cell: 8.5,
				maxDist: 520,
				shadow: true,
				maxSlope: 0.7,
				roadClear: 5,
				scale: [0.8, 1.35],
				sink: 0.2,
				prob: (s) => s.forest * 0.62 * (0.6 + 0.4 * s.n) + s.vale * 0.025 * Math.max(0, s.n),
				collider: (ph, x, y, z, sc) => ph.addCylinder(x, y + 2.5 * sc, z, 2.5 * sc, 0.42 * sc, { kind: 'static', material: 'wood' })
			},
			{
				id: 'oakTree',
				geo: this.geo(F.forestTree(33, 0x9aac4a, 0x2f4a1a, 0x5a4030)),
				mat: oakWind,
				lo: { geo: oakLo, mat: lambert, dist: 120 },
				cell: 15,
				maxDist: 520,
				shadow: true,
				maxSlope: 0.6,
				roadClear: 6,
				scale: [0.9, 1.4],
				sink: 0.2,
				prob: (s) => (s.vale + s.hollow * 0.6) * 0.16 * Math.max(0, 0.3 + s.n),
				collider: (ph, x, y, z, sc) => ph.addCylinder(x, y + 2.5 * sc, z, 2.5 * sc, 0.42 * sc, { kind: 'static', material: 'wood' })
			},
			{
				id: 'pine',
				geo: this.geo(F.pineTree(41)),
				mat: pineWind,
				lo: { geo: pineLo, mat: lambert, dist: 120 },
				cell: 11,
				maxDist: 560,
				shadow: true,
				maxSlope: 0.95,
				roadClear: 5,
				scale: [0.8, 1.5],
				sink: 0.2,
				prob: (s) => s.high * 0.2 + (s.edge < 75 && s.h > 12 && s.h < 70 ? 0.42 : 0) + s.sanct * 0.05,
				collider: (ph, x, y, z, sc) => ph.addCylinder(x, y + 2 * sc, z, 2 * sc, 0.32 * sc, { kind: 'static', material: 'wood' })
			},
			{
				id: 'deadTree',
				geo: this.geo(F.deadTree(51)),
				mat: lambert,
				cell: 14,
				maxDist: 420,
				shadow: true,
				maxSlope: 0.7,
				roadClear: 6,
				scale: [0.8, 1.3],
				sink: 0.2,
				prob: (s) => s.sanct * 0.32 + s.high * 0.02,
				collider: (ph, x, y, z, sc) => ph.addCylinder(x, y + 2 * sc, z, 2 * sc, 0.4 * sc, { kind: 'static', material: 'wood' })
			},
			{
				id: 'bush',
				geo: this.geo(F.bush(61)),
				mat: leafWind,
				cell: 6,
				maxDist: 170,
				shadow: false,
				maxSlope: 0.8,
				roadClear: 4,
				scale: [0.7, 1.4],
				sink: 0.15,
				optional: true,
				prob: (s) => s.forest * 0.22 + s.vale * 0.06 + s.hollow * 0.08
			},
			{
				id: 'fern',
				geo: this.geo(F.fern(71)),
				mat: lowWind,
				cell: 3.2,
				maxDist: 85,
				shadow: false,
				maxSlope: 0.8,
				roadClear: 3,
				scale: [0.8, 1.5],
				optional: true,
				prob: (s) => s.forest * 0.45
			},
			{
				id: 'shroomCyan',
				geo: this.geo(F.glowMushrooms(81, 0x40d8ff)),
				mat: cyanShroom,
				cell: 6.5,
				maxDist: 150,
				shadow: false,
				maxSlope: 0.8,
				roadClear: 3,
				scale: [0.8, 1.8],
				optional: true,
				prob: (s) => s.forest * 0.24
			},
			{
				id: 'shroomPink',
				geo: this.geo(F.glowMushrooms(91, 0xff58d8)),
				mat: pinkShroom,
				cell: 9,
				maxDist: 150,
				shadow: false,
				maxSlope: 0.8,
				roadClear: 3,
				scale: [0.8, 1.6],
				optional: true,
				prob: (s) => s.forest * 0.12 + s.sanct * 0.06
			},
			{
				id: 'glowFlower',
				geo: this.geo(F.glowFlowers(101, 0x8fd0ff)),
				mat: blueFlower,
				cell: 4.2,
				maxDist: 90,
				shadow: false,
				maxSlope: 0.8,
				roadClear: 2.5,
				scale: [0.9, 1.4],
				optional: true,
				prob: (s) => s.forest * 0.28 + s.hollow * 0.05
			},
			{
				id: 'flowersWarm',
				geo: this.geo(F.wildflowers(111, [0xffd84a, 0xfff2d0, 0xff9a4a])),
				mat: lowWind,
				cell: 3.4,
				maxDist: 80,
				shadow: false,
				maxSlope: 0.7,
				roadClear: 2.5,
				scale: [0.9, 1.4],
				optional: true,
				prob: (s) => (s.vale + s.hollow) * 0.3 * (0.5 + 0.5 * s.n)
			},
			{
				id: 'flowersCool',
				geo: this.geo(F.wildflowers(121, [0xb08aff, 0xff8ad0, 0x8ac8ff])),
				mat: lowWind,
				cell: 4,
				maxDist: 80,
				shadow: false,
				maxSlope: 0.7,
				roadClear: 2.5,
				scale: [0.9, 1.4],
				optional: true,
				prob: (s) => (s.vale + s.hollow) * 0.22 * (0.5 - 0.5 * s.n) + s.high * 0.08
			},
			{
				id: 'heather',
				geo: this.geo(F.heather(131)),
				mat: lowWind,
				cell: 3,
				maxDist: 85,
				shadow: false,
				maxSlope: 0.85,
				roadClear: 2.5,
				scale: [0.9, 1.7],
				optional: true,
				prob: (s) => s.high * 0.5
			},
			{
				id: 'rock',
				geo: this.geo(F.rock(141, 0x6a6470)),
				mat: lambert,
				cell: 11,
				maxDist: 360,
				shadow: true,
				maxSlope: 2,
				roadClear: 4,
				scale: [0.6, 2.2],
				sink: 0.35,
				tilt: 0.3,
				prob: (s) => (0.05 + Math.min(0.4, s.slope * 0.4)) * (1 - s.forest * 0.6) + (s.edge < 70 ? 0.15 : 0),
				collider: (ph, x, y, z, sc) => {
					if (sc > 0.9) ph.addBall(x, y + 0.1 * sc, z, 0.85 * sc, { kind: 'static', material: 'stone' });
				}
			},
			{
				id: 'mossRock',
				geo: this.geo(F.rock(151, 0x4a4a46, 0x3f7a3a)),
				mat: lambert,
				cell: 10,
				maxDist: 300,
				shadow: true,
				maxSlope: 2,
				roadClear: 4,
				scale: [0.7, 2.4],
				sink: 0.35,
				tilt: 0.3,
				prob: (s) => s.forest * 0.2,
				collider: (ph, x, y, z, sc) => {
					if (sc > 0.9) ph.addBall(x, y + 0.1 * sc, z, 0.85 * sc, { kind: 'static', material: 'stone' });
				}
			},
			{
				id: 'crystalViolet',
				geo: this.geo(F.crystalCluster(161, 0x9a60ff)),
				mat: violetCrystal,
				cell: 15,
				maxDist: 480,
				shadow: true,
				maxSlope: 1.2,
				roadClear: 5,
				scale: [0.7, 1.8],
				sink: 0.2,
				tilt: 0.2,
				prob: (s) => s.high * 0.22 + s.sanct * 0.14,
				collider: (ph, x, y, z, sc) => ph.addCylinder(x, y + 1 * sc, z, 1 * sc, 0.7 * sc, { kind: 'static', material: 'stone' })
			},
			{
				id: 'crystalCyan',
				geo: this.geo(F.crystalCluster(171, 0x3ad8ff, 1.2)),
				mat: cyanCrystal,
				cell: 21,
				maxDist: 480,
				shadow: true,
				maxSlope: 1.2,
				roadClear: 5,
				scale: [0.7, 1.6],
				sink: 0.2,
				tilt: 0.2,
				prob: (s) => s.high * 0.14 + s.forest * 0.025,
				collider: (ph, x, y, z, sc) => ph.addCylinder(x, y + 1 * sc, z, 1 * sc, 0.7 * sc, { kind: 'static', material: 'stone' })
			},
			{
				id: 'runeStone',
				geo: this.geo(F.standingStone(181, 0x7fd8ff)),
				mat: runeStone,
				cell: 28,
				maxDist: 360,
				shadow: true,
				maxSlope: 0.5,
				roadClear: 5,
				scale: [0.9, 1.3],
				sink: 0.3,
				tilt: 0.08,
				prob: (s) => s.high * 0.14 + s.vale * 0.015,
				collider: (ph, x, y, z, sc) => ph.addCuboid(x, y + 2 * sc, z, 0.6 * sc, 2 * sc, 0.4 * sc)
			}
		);
		for (const l of this.layers) {
			l.geo.computeBoundingSphere();
			l.lo?.geo.computeBoundingSphere();
		}
	}

	site(x: number, z: number, out: SiteInfo): SiteInfo {
		const t = this.terrain;
		out.x = x;
		out.z = z;
		out.h = t.heightAt(x, z);
		out.slope = t.slopeAt(x, z);
		out.forest = t.forestAt(x, z);
		out.high = t.highlandAt(x, z);
		out.sanct = sanctuaryMask(x, z);
		out.hollow = hollowMask(x, z);
		out.vale = Math.max(0, 1 - out.forest - out.high - out.sanct - out.hollow);
		out.edge = edgeDistance(x, z);
		out.n = this.noise.fbm(x * 0.02, z * 0.02, 2);
		return out;
	}

	/**
	 * Scatter every layer across the world. Returns instances bucketed by chunk index.
	 * Colliders are created for all instances up front (cheap, and enemies far from the
	 * camera still need them); only GPU meshes are streamed.
	 */
	scatter(chunkOf: (x: number, z: number) => number, chunkCount: number): LayerBucket[][] {
		const out: LayerBucket[][] = [];
		for (let i = 0; i < chunkCount; i++) out.push([]);
		const site: SiteInfo = { x: 0, z: 0, h: 0, slope: 0, forest: 0, high: 0, sanct: 0, hollow: 0, vale: 0, edge: 0, n: 0 };
		const t = this.terrain;
		this.layers.forEach((layer, li) => {
			const rng = new Random(1000 + li * 7919);
			const n = Math.floor((WORLD_HALF * 2) / layer.cell);
			const buckets = new Map<number, LayerBucket>();
			for (let gz = 0; gz < n; gz++) {
				for (let gx = 0; gx < n; gx++) {
					const roll = hash2(gx, gz, li * 31 + 7);
					const x = -WORLD_HALF + (gx + rng.next()) * layer.cell;
					const z = -WORLD_HALF + (gz + rng.next()) * layer.cell;
					if (roll > 0.92) continue; // Leave some natural gaps everywhere.
					this.site(x, z, site);
					if (site.edge < 4) continue;
					if (site.slope > layer.maxSlope) continue;
					// Cheap probability roll first; road/water/clearing tests are the expensive part.
					const p = layer.prob(site);
					if (p <= 0 || hash2(gx * 3 + 1, gz * 5 + 2, li) > p) continue;
					if (roadDistance(x, z) < layer.roadClear) continue;
					if (t.inClearing(x, z, layer.clearingPad ?? 0)) continue;
					if (t.waterLevelAt(x, z) > -1e6) continue;
					const s = layer.scale[0] + rng.next() * (layer.scale[1] - layer.scale[0]);
					const tilt = layer.tilt ?? 0.04;
					const inst: Instance = {
						x,
						y: site.h - (layer.sink ?? 0) * s,
						z,
						s,
						ry: rng.next() * Math.PI * 2,
						rx: (rng.next() - 0.5) * tilt,
						rz: (rng.next() - 0.5) * tilt
					};
					layer.collider?.(this.physics, inst.x, inst.y, inst.z, s);
					const ci = chunkOf(x, z);
					let b = buckets.get(ci);
					if (!b) {
						b = { layer, items: [] };
						buckets.set(ci, b);
						out[ci].push(b);
					}
					b.items.push(inst);
				}
			}
		});
		return out;
	}

	/** Builds the instanced meshes for one chunk's bucket (hi and optional lo). */
	buildMeshes(bucket: LayerBucket): { hi: THREE.InstancedMesh; lo: THREE.InstancedMesh | null } {
		const layer = bucket.layer;
		let items = bucket.items;
		if (layer.optional && this.density < 1) {
			// Deterministic thinning keeps the same plants when the preset changes.
			items = items.filter((it) => hash2(Math.floor(it.x * 10), Math.floor(it.z * 10), 77) < this.density);
		}
		const make = (geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean) => {
			const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
			mesh.count = items.length;
			for (let i = 0; i < items.length; i++) {
				const it = items[i];
				_p.set(it.x, it.y, it.z);
				_q.setFromEuler(_e.set(it.rx, it.ry, it.rz, 'YXZ'));
				_s.setScalar(it.s);
				mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
			}
			mesh.instanceMatrix.needsUpdate = true;
			mesh.castShadow = shadow;
			mesh.receiveShadow = !shadow || layer.id === 'rock' || layer.id === 'mossRock';
			mesh.computeBoundingSphere();
			mesh.name = layer.id;
			return mesh;
		};
		const hi = make(layer.geo, layer.mat, layer.shadow);
		const lo = layer.lo ? make(layer.lo.geo, layer.lo.mat, false) : null;
		return { hi, lo };
	}

	dispose(): void {
		for (const g of this.geometries) g.dispose();
		for (const m of this.materials) m.dispose();
	}
}

