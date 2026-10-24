import * as THREE from 'three';
import type { Terrain } from './TerrainGenerator';
import type { Vegetation, VegLayer, ChunkLike } from './Vegetation';
import { CELL, GRID, WORLD_HALF } from './Biomes';

export const CHUNK_CELLS = 64;
export const CHUNKS_PER_SIDE = GRID / CHUNK_CELLS;
export const CHUNK_SIZE = CHUNK_CELLS * CELL;

export class Chunk implements ChunkLike {
	readonly group = new THREE.Group();
	readonly layers: VegLayer[] = [];
	readonly minX: number;
	readonly minZ: number;
	readonly size = CHUNK_SIZE;
	terrainHi!: THREE.Mesh;
	terrainLo!: THREE.Mesh;
	lastDist = 0;

	constructor(
		readonly cx: number,
		readonly cz: number,
		readonly index: number
	) {
		this.minX = -WORLD_HALF + cx * CHUNK_SIZE;
		this.minZ = -WORLD_HALF + cz * CHUNK_SIZE;
	}

	distanceTo(x: number, z: number): number {
		const dx = Math.max(this.minX - x, 0, x - (this.minX + this.size));
		const dz = Math.max(this.minZ - z, 0, z - (this.minZ + this.size));
		return Math.sqrt(dx * dx + dz * dz);
	}
}

/**
 * Splits the world into a grid of chunks. Each chunk owns two terrain LODs and its
 * instanced vegetation; visibility is driven by distance from the camera (plus three's
 * own frustum culling per mesh).
 */
export class ChunkManager {
	readonly chunks: Chunk[] = [];
	readonly root = new THREE.Group();
	drawDistance = 500;
	lodDistance = 210;
	detailScale = 1;
	private timer = 0;
	private lastX = Infinity;
	private lastZ = Infinity;
	private terrainMat: THREE.MeshLambertMaterial;

	constructor(terrain: Terrain, vegetation: Vegetation, onProgress?: (t: number) => void) {
		this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true });
		this.root.name = 'chunks';
		let i = 0;
		for (let cz = 0; cz < CHUNKS_PER_SIDE; cz++) {
			for (let cx = 0; cx < CHUNKS_PER_SIDE; cx++) {
				const chunk = new Chunk(cx, cz, i++);
				const ix0 = cx * CHUNK_CELLS;
				const iz0 = cz * CHUNK_CELLS;
				chunk.terrainHi = new THREE.Mesh(terrain.buildChunkGeometry(ix0, iz0, CHUNK_CELLS, 1), this.terrainMat);
				chunk.terrainLo = new THREE.Mesh(terrain.buildChunkGeometry(ix0, iz0, CHUNK_CELLS, 4), this.terrainMat);
				chunk.terrainHi.receiveShadow = true;
				chunk.terrainLo.receiveShadow = true;
				chunk.terrainLo.visible = false;
				chunk.group.add(chunk.terrainHi, chunk.terrainLo);
				vegetation.populate(chunk);
				this.chunks.push(chunk);
				this.root.add(chunk.group);
				onProgress?.(i / (CHUNKS_PER_SIDE * CHUNKS_PER_SIDE));
			}
		}
	}

	update(dt: number, cam: THREE.Vector3, force = false): void {
		this.timer -= dt;
		const moved = Math.abs(cam.x - this.lastX) + Math.abs(cam.z - this.lastZ);
		if (!force && this.timer > 0 && moved < 8) return;
		this.timer = 0.25;
		this.lastX = cam.x;
		this.lastZ = cam.z;
		for (const ch of this.chunks) {
			const d = ch.distanceTo(cam.x, cam.z);
			ch.lastDist = d;
			const visible = d < this.drawDistance;
			ch.group.visible = visible;
			if (!visible) continue;
			const hi = d < this.lodDistance;
			ch.terrainHi.visible = hi;
			ch.terrainLo.visible = !hi;
			for (const l of ch.layers) {
				l.mesh.visible = d < Math.min(this.drawDistance, l.maxDist * this.detailScale);
			}
		}
	}

	/** Extra meshes (landmarks) can be attached to the chunk they sit in for distance culling. */
	chunkAt(x: number, z: number): Chunk {
		const cx = Math.min(CHUNKS_PER_SIDE - 1, Math.max(0, Math.floor((x + WORLD_HALF) / CHUNK_SIZE)));
		const cz = Math.min(CHUNKS_PER_SIDE - 1, Math.max(0, Math.floor((z + WORLD_HALF) / CHUNK_SIZE)));
		return this.chunks[cz * CHUNKS_PER_SIDE + cx];
	}

	dispose(): void {
		for (const ch of this.chunks) {
			ch.terrainHi.geometry.dispose();
			ch.terrainLo.geometry.dispose();
			for (const l of ch.layers) {
				l.mesh.dispose();
			}
			ch.group.traverse((o) => {
				if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && o !== ch.terrainHi && o !== ch.terrainLo) o.geometry.dispose();
			});
		}
		this.terrainMat.dispose();
	}
}
