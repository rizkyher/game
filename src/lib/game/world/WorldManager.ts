import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Terrain } from './Terrain';
import { Sky, SUN_DIR } from './Sky';
import { Vegetation } from './Vegetation';
import { ChunkManager } from './ChunkManager';
import { Water } from './Water';
import { Structures } from './Structures';
import { Ambience } from './Ambience';
import { grassGeometry, grassMaterial, worldUniforms } from './Materials';
import { GRID, REGIONS, WORLD_HALF, regionAt, regionWeights, type RegionId, type RegionWeights } from './WorldLayout';

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));
const _c = new THREE.Color();

/**
 * Owns everything static about the world: terrain (render + physics heightfield), sky and
 * atmosphere, streamed vegetation chunks, water, architecture and ambient effects.
 */
export class WorldManager {
	readonly terrain: Terrain;
	readonly sky: Sky;
	readonly vegetation: Vegetation;
	readonly chunks: ChunkManager;
	readonly water: Water;
	readonly structures: Structures;
	readonly ambience: Ambience;
	readonly grass: THREE.Mesh;
	private grassMat: THREE.MeshLambertMaterial;
	private dataTex: THREE.DataTexture;
	readonly weights: RegionWeights = { hollow: 0, vale: 1, forest: 0, highlands: 0, sanctuary: 0 };
	region: RegionId = 'vale';
	private regionTimer = 0;
	private grassBlades = 32000;
	private grassArea = 84;

	private constructor(
		private scene: THREE.Scene,
		physics: PhysicsWorld,
		terrain: Terrain,
		sky: Sky,
		vegetation: Vegetation,
		chunks: ChunkManager,
		water: Water,
		structures: Structures
	) {
		this.terrain = terrain;
		this.sky = sky;
		this.vegetation = vegetation;
		this.chunks = chunks;
		this.water = water;
		this.structures = structures;
		this.dataTex = terrain.createDataTexture();
		this.grassMat = grassMaterial(this.dataTex);
		this.grass = new THREE.Mesh(grassGeometry(this.grassBlades, this.grassArea, 99), this.grassMat);
		this.grass.frustumCulled = false;
		this.grass.receiveShadow = true;
		this.grass.name = 'grass';
		this.ambience = new Ambience(terrain);
		scene.add(chunks.root, water.group, structures.root, this.grass, this.ambience.motes, this.ambience.shafts);
		void physics;
	}

	static async create(scene: THREE.Scene, physics: PhysicsWorld, onProgress: (t: number, label: string) => void): Promise<WorldManager> {
		onProgress(0.08, 'Shaping the land of Aetherfall');
		await yieldFrame();
		const terrain = new Terrain(1337);
		const hf = terrain.heightfieldData();
		physics.addHeightfield(hf.nrows, hf.ncols, hf.heights, hf.scale);
		onProgress(0.2, 'Kindling the sky');
		await yieldFrame();
		const sky = new Sky(scene);
		onProgress(0.26, 'Raising ancient ruins');
		await yieldFrame();
		const structures = new Structures(physics, terrain);
		onProgress(0.36, 'Growing the Eldergrove');
		await yieldFrame();
		const vegetation = new Vegetation(terrain, physics);
		const chunks = new ChunkManager(terrain, vegetation);
		onProgress(0.48, 'Filling rivers and the Moonwell');
		await yieldFrame();
		const water = new Water(terrain, SUN_DIR, sky.fogColor);
		return new WorldManager(scene, physics, terrain, sky, vegetation, chunks, water, structures);
	}

	setGrassQuality(blades: number, area: number): void {
		if (blades === this.grassBlades && area === this.grassArea) return;
		this.grassBlades = blades;
		this.grassArea = area;
		this.grass.geometry.dispose();
		this.grass.geometry = grassGeometry(blades, area, 99);
		const u = this.grassMat.userData.uniforms;
		u.uArea.value = area;
		u.uRadius.value = area / 2;
	}

	setDrawDistance(d: number): void {
		this.chunks.drawDistance = d;
		this.chunks.lodDistance = Math.min(220, d * 0.42);
		this.sky.setDrawDistance(d);
	}

	setVegetationDensity(k: number): void {
		if (this.vegetation.density === k) return;
		this.vegetation.density = k;
		this.chunks.rebuildVegetation();
	}

	regionName(p: THREE.Vector3): string {
		return REGIONS[regionAt(p.x, p.z)].name;
	}

	update(dt: number, time: number, camera: THREE.Camera, focus: THREE.Vector3): void {
		worldUniforms.uTime.value = time;
		worldUniforms.uPlayer.value.copy(focus);
		const w = worldUniforms.uWind.value;
		w.set(0.45 + Math.sin(time * 0.13) * 0.25, 0.22 + Math.cos(time * 0.09) * 0.15);
		const u = this.grassMat.userData.uniforms;
		u.uCenter.value.set(camera.position.x, camera.position.z);
		this.chunks.update(dt, camera.position);
		this.regionTimer -= dt;
		if (this.regionTimer <= 0) {
			this.regionTimer = 0.2;
			regionWeights(focus.x, focus.z, this.weights);
			this.region = regionAt(focus.x, focus.z);
		}
		this.sky.applyRegions(this.weights, dt);
		this.sky.update(time, focus, camera);
		this.structures.update(time, camera.position, this.chunks.drawDistance);
		_c.setHex(REGIONS[this.region].motes);
		this.ambience.update(camera.position, this.terrain.heightAt(camera.position.x, camera.position.z), _c, this.sky.gloom);
	}

	/** Top-down shaded map image for the world map. */
	buildMapCanvas(size: number): HTMLCanvasElement {
		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const ctx = canvas.getContext('2d')!;
		const img = ctx.createImageData(size, size);
		const t = this.terrain;
		const col = new THREE.Color();
		const n = new THREE.Vector3();
		const light = new THREE.Vector3(-0.5, 0.75, -0.4).normalize();
		const V = GRID + 1;
		for (let py = 0; py < size; py++) {
			for (let px = 0; px < size; px++) {
				const x = -WORLD_HALF + ((px + 0.5) / size) * WORLD_HALF * 2;
				const z = -WORLD_HALF + ((py + 0.5) / size) * WORLD_HALF * 2;
				const ix = Math.min(GRID, Math.round((x + WORLD_HALF) / 2));
				const iz = Math.min(GRID, Math.round((z + WORLD_HALF) / 2));
				t.normalAt(x, z, n);
				t.colorAt(ix, iz, n.y, col);
				if (t.water[iz * V + ix]) col.setRGB(0.08, 0.25, 0.4);
				const shade = 0.55 + Math.max(0, n.dot(light)) * 0.75;
				col.multiplyScalar(shade);
				col.convertLinearToSRGB();
				const i = (py * size + px) * 4;
				img.data[i] = Math.min(255, col.r * 255);
				img.data[i + 1] = Math.min(255, col.g * 255);
				img.data[i + 2] = Math.min(255, col.b * 255);
				img.data[i + 3] = 255;
			}
		}
		ctx.putImageData(img, 0, 0);
		return canvas;
	}

	dispose(): void {
		this.scene.remove(this.chunks.root, this.water.group, this.structures.root, this.grass, this.ambience.motes, this.ambience.shafts);
		this.chunks.dispose();
		this.vegetation.dispose();
		this.water.dispose();
		this.structures.dispose();
		this.ambience.dispose();
		this.grass.geometry.dispose();
		this.grassMat.dispose();
		this.dataTex.dispose();
		this.sky.dispose();
	}
}
