import * as THREE from 'three';
import type { Terrain } from './Terrain';
import type { Vegetation, LayerBucket, LayerDef } from './Vegetation';
import { CELL, GRID, WORLD_HALF } from './WorldLayout';
import { terrainMaterial } from './Materials';

export const CHUNK_CELLS = 40;
export const CHUNKS_PER_SIDE = GRID / CHUNK_CELLS;
export const CHUNK_SIZE = CHUNK_CELLS * CELL;

interface BuiltLayer {
	def: LayerDef;
	hi: THREE.InstancedMesh;
	lo: THREE.InstancedMesh | null;
}

export class Chunk {
	readonly group = new THREE.Group();
	readonly minX: number;
	readonly minZ: number;
	readonly size = CHUNK_SIZE;
	buckets: LayerBucket[] = [];
	layers: BuiltLayer[] = [];
	terrainHi: THREE.Mesh | null = null;
	terrainLo: THREE.Mesh | null = null;
	built = false;
	queued = false;
	lastDist = Infinity;

	constructor(
		readonly cx: number,
		readonly cz: number,
		readonly index: number
	) {
		this.minX = -WORLD_HALF + cx * CHUNK_SIZE;
		this.minZ = -WORLD_HALF + cz * CHUNK_SIZE;
		this.group.name = `chunk-${cx}-${cz}`;
	}

	distanceTo(x: number, z: number): number {
		const dx = Math.max(this.minX - x, 0, x - (this.minX + this.size));
		const dz = Math.max(this.minZ - z, 0, z - (this.minZ + this.size));
		return Math.sqrt(dx * dx + dz * dz);
	}
}

/**
 * Streams the world in 80 m chunks. Scatter data and colliders exist for the whole world;
 * terrain and vegetation GPU meshes are built when a chunk comes within range (a small
 * per-frame budget) and released when it falls far behind. Visible chunks pick terrain and
 * tree LODs by distance, and three.js frustum-culls each mesh.
 */
export class ChunkManager {
	readonly chunks: Chunk[] = [];
	readonly root = new THREE.Group();
	drawDistance = 520;
	lodDistance = 200;
	detailScale = 1;
	private timer = 0;
	private lastX = Infinity;
	private lastZ = Infinity;
	private queue: Chunk[] = [];
	private terrainMat: THREE.MeshLambertMaterial;
	builtCount = 0;

	constructor(
		private terrain: Terrain,
		private vegetation: Vegetation
	) {
		this.terrainMat = terrainMaterial();
		this.root.name = 'chunks';
		let i = 0;
		for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) {
			for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
				const ch = new Chunk(cx, cz, i++);
				this.chunks.push(ch);
				this.root.add(ch.group);
			}
		}
		const buckets = vegetation.scatter((x, z) => this.chunkIndexAt(x, z), this.chunks.length);
		this.chunks.forEach((c, idx) => (c.buckets = buckets[idx]));
	}

	chunkIndexAt(x: number, z: number): number {
		const cx = Math.min(CHUNKS_PER_SIDE - 1, Math.max(0, Math.floor((x + WORLD_HALF) / CHUNK_SIZE)));
		const cz = Math.min(CHUNKS_PER_SIDE - 1, Math.max(0, Math.floor((z + WORLD_HALF) / CHUNK_SIZE)));
		return cz * CHUNKS_PER_SIDE + cx;
	}

	chunkAt(x: number, z: number): Chunk {
		return this.chunks[this.chunkIndexAt(x, z)];
	}

	private build(ch: Chunk): void {
		if (ch.built) return;
		const ix0 = ch.cx * CHUNK_CELLS;
		const iz0 = ch.cz * CHUNK_CELLS;
		ch.terrainHi = new THREE.Mesh(this.terrain.buildChunkGeometry(ix0, iz0, CHUNK_CELLS, 1), this.terrainMat);
		ch.terrainLo = new THREE.Mesh(this.terrain.buildChunkGeometry(ix0, iz0, CHUNK_CELLS, 4), this.terrainMat);
		ch.terrainHi.receiveShadow = true;
		ch.terrainLo.receiveShadow = true;
		ch.terrainLo.visible = false;
		ch.group.add(ch.terrainHi, ch.terrainLo);
		for (const b of ch.buckets) {
			if (b.items.length === 0) continue;
			const { hi, lo } = this.vegetation.buildMeshes(b);
			ch.group.add(hi);
			if (lo) {
				lo.visible = false;
				ch.group.add(lo);
			}
			ch.layers.push({ def: b.layer, hi, lo });
		}
		ch.built = true;
		ch.queued = false;
		this.builtCount++;
		this.applyVisibility(ch);
	}

	private unload(ch: Chunk): void {
		if (!ch.built) return;
		ch.terrainHi?.geometry.dispose();
		ch.terrainLo?.geometry.dispose();
		if (ch.terrainHi) ch.group.remove(ch.terrainHi);
		if (ch.terrainLo) ch.group.remove(ch.terrainLo);
		ch.terrainHi = ch.terrainLo = null;
		for (const l of ch.layers) {
			ch.group.remove(l.hi);
			l.hi.dispose();
			if (l.lo) {
				ch.group.remove(l.lo);
				l.lo.dispose();
			}
		}
		ch.layers = [];
		ch.built = false;
		this.builtCount--;
	}

	/** Rebuild vegetation meshes (after a density change) without touching terrain. */
	rebuildVegetation(): void {
		for (const ch of this.chunks) {
			if (!ch.built) continue;
			this.unload(ch);
			this.build(ch);
		}
	}

	private applyVisibility(ch: Chunk): void {
		const d = ch.lastDist;
		const visible = d < this.drawDistance;
		ch.group.visible = visible;
		if (!visible || !ch.built) return;
		const hi = d < this.lodDistance;
		ch.terrainHi!.visible = hi;
		ch.terrainLo!.visible = !hi;
		for (const l of ch.layers) {
			const maxD = Math.min(this.drawDistance, l.def.maxDist * (l.def.lo ? 1 : this.detailScale));
			const show = d < maxD;
			if (l.lo) {
				const near = d < l.def.lo!.dist * this.detailScale;
				l.hi.visible = show && near;
				l.lo.visible = show && !near;
			} else l.hi.visible = show;
		}
	}

	/** Synchronously builds every chunk within the draw distance (loading screen). */
	prewarm(pos: THREE.Vector3, onProgress?: (t: number) => void): void {
		const list = this.chunks.filter((c) => c.distanceTo(pos.x, pos.z) < this.drawDistance + 40);
		list.forEach((c, i) => {
			c.lastDist = c.distanceTo(pos.x, pos.z);
			this.build(c);
			onProgress?.((i + 1) / list.length);
		});
		this.update(0, pos, true);
	}

	update(dt: number, cam: THREE.Vector3, force = false): void {
		// Stream: build at most one queued chunk per frame (nearest first).
		if (this.queue.length) {
			const ch = this.queue.shift()!;
			if (ch.queued) this.build(ch);
		}
		this.timer -= dt;
		const moved = Math.abs(cam.x - this.lastX) + Math.abs(cam.z - this.lastZ);
		if (!force && this.timer > 0 && moved < 6) return;
		this.timer = 0.25;
		this.lastX = cam.x;
		this.lastZ = cam.z;
		const load = this.drawDistance + 60;
		const unload = this.drawDistance + 180;
		for (const ch of this.chunks) {
			ch.lastDist = ch.distanceTo(cam.x, cam.z);
			if (!ch.built && !ch.queued && ch.lastDist < load) {
				ch.queued = true;
				this.queue.push(ch);
			} else if (ch.built && ch.lastDist > unload) this.unload(ch);
			else if (ch.queued && ch.lastDist > unload) ch.queued = false;
			this.applyVisibility(ch);
		}
		if (this.queue.length > 1) this.queue.sort((a, b) => a.lastDist - b.lastDist);
	}

	dispose(): void {
		for (const ch of this.chunks) this.unload(ch);
		this.terrainMat.dispose();
	}
}
