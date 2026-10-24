import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Terrain } from './TerrainGenerator';
import { Sky } from './Sky';
import { Vegetation } from './Vegetation';
import { ChunkManager } from './ChunkManager';
import { Water } from './Water';
import { Hive } from './Hive';
import { Features } from './Features';
import { grassGeometry, grassMaterial, windUniforms } from './Materials';
import { HIVE, LANDMARKS, REGION_NAMES, WORLD_HALF, WORLD_SEED, WORLD_SIZE, HIVE_CHAMBERS, isInsideHive, regionAt, type RegionId } from './Biomes';
import { Noise2D } from '../utils/Noise';
import { smoothstep } from '../utils/math';

export interface GrassQuality {
	blades: number;
	area: number;
}

const MAX_BLADES = 46000;

/** Builds and owns the static world: terrain, sky, vegetation chunks, water, hive and landmarks. */
export class WorldManager {
	terrain!: Terrain;
	sky!: Sky;
	vegetation!: Vegetation;
	chunks!: ChunkManager;
	water!: Water;
	hive!: Hive;
	features!: Features;
	grass!: THREE.Mesh;
	readonly wind = new THREE.Vector2(0.6, 0.2);
	/** 0..1 envelope of the current strong gust. */
	gust = 0;
	readonly gustDir = new THREE.Vector2(1, 0);
	private gustTimer = 18;
	private gustTime = 0;
	private windNoise = new Noise2D(WORLD_SEED + 99);
	private dataTex!: THREE.DataTexture;
	private grassUniforms!: { uCenter: { value: THREE.Vector2 }; uPlayer: { value: THREE.Vector3 }; uArea: { value: number }; uRadius: { value: number } };

	private constructor(readonly scene: THREE.Scene) {}

	/** Builds the world in phases, yielding between them so the loading screen can repaint. */
	static async create(scene: THREE.Scene, physics: PhysicsWorld, progress: (t: number, label: string) => void): Promise<WorldManager> {
		const w = new WorldManager(scene);
		const tick = () => new Promise((r) => setTimeout(r, 0));
		progress(0.12, 'Sculpting hills');
		await tick();
		w.terrain = new Terrain(WORLD_SEED);
		const hf = w.terrain.heightfieldData();
		physics.addHeightfield(hf.nrows, hf.ncols, hf.heights, hf.scale);
		w.sky = new Sky(scene);

		progress(0.25, 'Growing flowers & trees');
		await tick();
		w.vegetation = new Vegetation(w.terrain, physics);
		w.chunks = new ChunkManager(w.terrain, w.vegetation);
		scene.add(w.chunks.root);

		progress(0.66, 'Filling the pond');
		await tick();
		w.water = new Water(w.terrain, physics);
		scene.add(w.water.group);

		progress(0.72, 'Building the hive');
		await tick();
		w.hive = new Hive(physics);
		scene.add(w.hive.group);

		progress(0.78, 'Hiding secrets');
		await tick();
		w.features = new Features(w.terrain, physics, w.vegetation, w.chunks);
		scene.add(w.features.group);

		w.dataTex = w.terrain.createDataTexture();
		const mat = grassMaterial(w.dataTex);
		w.grassUniforms = mat.userData.uniforms;
		w.grass = new THREE.Mesh(grassGeometry(MAX_BLADES, 92, WORLD_SEED), mat);
		w.grass.frustumCulled = false;
		w.grass.receiveShadow = true;
		scene.add(w.grass);
		return w;
	}

	setGrassQuality(q: GrassQuality): void {
		(this.grass.geometry as THREE.InstancedBufferGeometry).instanceCount = Math.min(MAX_BLADES, q.blades);
		this.grassUniforms.uArea.value = q.area;
		this.grassUniforms.uRadius.value = q.area / 2;
		this.grass.visible = q.blades > 0;
	}

	setDrawDistance(d: number): void {
		this.chunks.drawDistance = d;
		this.sky.setDrawDistance(d);
	}

	/** Region with hive interior awareness. */
	regionAt(p: THREE.Vector3): RegionId {
		return regionAt(p.x, p.y, p.z);
	}

	regionName(p: THREE.Vector3): string {
		if (isInsideHive(p.x, p.y, p.z)) {
			const h = p.y - HIVE.baseY;
			const ch = HIVE_CHAMBERS.find((c) => h >= c.min && h < c.max);
			return ch ? ch.name : REGION_NAMES.hive;
		}
		return REGION_NAMES[this.regionAt(p)];
	}

	hiveChamberAt(p: THREE.Vector3): string | null {
		if (!isInsideHive(p.x, p.y, p.z)) return null;
		const h = p.y - HIVE.baseY;
		const ch = HIVE_CHAMBERS.find((c) => h >= c.min && h < c.max);
		return ch ? ch.id : null;
	}

	update(dt: number, time: number, camera: THREE.Camera, player: THREE.Vector3): void {
		// Wind: slowly wandering breeze plus occasional strong gusts.
		const wa = this.windNoise.noise(time * 0.02, 3) * Math.PI;
		const ws = 0.55 + 0.3 * this.windNoise.noise(time * 0.05, 9);
		this.gustTimer -= dt;
		if (this.gustTimer <= 0 && this.gustTime <= 0) {
			this.gustTime = 4;
			this.gustTimer = 20 + (Math.sin(time * 1.7) * 0.5 + 0.5) * 18;
			this.gustDir.set(Math.cos(wa), Math.sin(wa));
		}
		if (this.gustTime > 0) {
			this.gustTime -= dt;
			const t = 4 - this.gustTime;
			this.gust = smoothstep(0, 0.8, t) * (1 - smoothstep(2.8, 4, t));
		} else this.gust = 0;
		this.wind.set(Math.cos(wa), Math.sin(wa)).multiplyScalar(ws + this.gust * 1.4);
		windUniforms.uTime.value = time;
		windUniforms.uWind.value.copy(this.wind);

		this.sky.update(dt, time, player, camera);
		this.chunks.update(dt, camera.position);
		this.vegetation.update(dt, time);
		this.grassUniforms.uCenter.value.set(player.x, player.z);
		this.grassUniforms.uPlayer.value.copy(player);

		// Interior streaming: hive interior details + lights only near the hive.
		const hd = Math.hypot(player.x - HIVE.x, player.z - HIVE.z);
		this.hive.interior.visible = hd < 170;
		this.hive.setLightLevel(1 - smoothstep(80, 150, hd));
	}

	/** Small top-down colour map for the world map overlay. */
	buildMapCanvas(size = 256): HTMLCanvasElement {
		const canvas = document.createElement('canvas');
		canvas.width = canvas.height = size;
		const ctx = canvas.getContext('2d')!;
		const img = ctx.createImageData(size, size);
		const t = this.terrain;
		for (let j = 0; j < size; j++) {
			for (let i = 0; i < size; i++) {
				const x = -WORLD_HALF + ((i + 0.5) / size) * WORLD_SIZE;
				const z = -WORLD_HALF + ((j + 0.5) / size) * WORLD_SIZE;
				const h = t.heightAt(x, z);
				const f = t.forestAt(x, z);
				let r = 120 - f * 60;
				let g = 190 - f * 70;
				let b = 80 - f * 20;
				const shade = Math.max(-25, Math.min(40, h * 0.9));
				r += shade;
				g += shade;
				b += shade;
				if (h > 45) {
					const k = smoothstep(45, 100, h);
					r = r * (1 - k) + 200 * k;
					g = g * (1 - k) + 196 * k;
					b = b * (1 - k) + 214 * k;
				}
				if (t.waterLevelAt(x, z) > h) {
					r = 70;
					g = 160;
					b = 220;
				}
				if (Math.hypot(x - HIVE.x, z - HIVE.z) < 37) {
					r = 240;
					g = 180;
					b = 60;
				}
				const k = (j * size + i) * 4;
				img.data[k] = r;
				img.data[k + 1] = g;
				img.data[k + 2] = b;
				img.data[k + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
		return canvas;
	}

	get landmarks() {
		return LANDMARKS;
	}

	dispose(): void {
		this.sky.dispose();
		this.chunks.dispose();
		this.vegetation.dispose();
		this.water.dispose();
		this.hive.dispose();
		this.features.dispose();
		this.grass.geometry.dispose();
		(this.grass.material as THREE.Material).dispose();
		this.dataTex.dispose();
	}
}
