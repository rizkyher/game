import * as THREE from 'three';
import { Noise2D } from '../utils/Noise';
import { clamp, distToSegment2D, lerp, smoothstep } from '../utils/math';
import {
	CELL,
	GRID,
	HIVE,
	STREAM_PATH,
	WORLD_HALF,
	WORLD_SIZE,
	edgeDistance,
	landmark,
	ridgeZ,
	type Point2
} from './Biomes';

const V = GRID + 1;

interface FlattenZone {
	x: number;
	z: number;
	r: number;
	fall: number;
	target: number;
}

export interface StreamSample {
	x: number;
	z: number;
	/** Water surface height. */
	y: number;
	/** Unit flow direction. */
	dx: number;
	dz: number;
}

const TRAIL: Point2[] = [
	{ x: -95, z: 95 },
	{ x: -30, z: 75 },
	{ x: 40, z: 55 },
	{ x: 110, z: 25 },
	{ x: 150, z: 8 }
];

/**
 * Generates the deterministic heightfield shared by rendering, physics and gameplay queries.
 * Heights live on a (GRID+1)^2 lattice covering the whole world.
 */
export class Terrain {
	readonly heights = new Float32Array(V * V);
	readonly density = new Float32Array(V * V);
	readonly forest = new Float32Array(V * V);
	readonly water = new Uint8Array(V * V);
	readonly stream: StreamSample[] = [];
	pondLevel = 0;
	readonly pond = landmark('pond');
	private noise: Noise2D;
	private zones: FlattenZone[] = [];
	private segT = { t: 0 };
	private streamCum: number[] = [];
	private streamLevels: number[] = [];
	private streamStep = 2;

	constructor(seed: number) {
		this.noise = new Noise2D(seed);
		this.setupZones();
		this.buildStreamProfile();
		this.fill();
	}

	private baseHeight(x: number, z: number): number {
		const n = this.noise;
		let h = n.fbm(x * 0.0035, z * 0.0035, 4) * 7 + n.fbm(x * 0.018 + 100, z * 0.018, 3) * 1.2;
		const zr = ridgeZ(x) + n.noise(x * 0.03, 7.3) * 4;
		const plateau = smoothstep(zr + 6, zr - 6, z);
		const bumps = n.fbm(x * 0.006 + 50, z * 0.006 - 30, 4);
		h += plateau * (16 + bumps * 9 + Math.max(0, n.noise(x * 0.02, z * 0.02)) * 3);
		const e = edgeDistance(x, z);
		const m = smoothstep(392, 492, e);
		h += m * m * (75 + n.fbm(x * 0.012 - 9, z * 0.012 + 4, 4) * 40);
		return h;
	}

	private setupZones(): void {
		const add = (x: number, z: number, r: number, fall: number) =>
			this.zones.push({ x, z, r, fall, target: this.baseHeight(x, z) });
		add(HIVE.x, HIVE.z, 62, 30);
		const pic = landmark('picnic');
		add(pic.x, pic.z, 34, 25);
		const gar = landmark('garden');
		add(gar.x, gar.z, 30, 20);
		add(this.pond.x, this.pond.z, 70, 30);
		const fr = landmark('fairyRing');
		add(fr.x, fr.z, 26, 16);
		const log = landmark('hollowLog');
		add(log.x, log.z, 32, 18);
		const ht = landmark('hollowTree');
		add(ht.x, ht.z, 18, 14);
		HIVE.groundY = this.zones[0].target;
		this.pondLevel = this.zones[3].target - 1.9;
	}

	/** Height after flattening, before carving water. */
	private shapedHeight(x: number, z: number): number {
		let h = this.baseHeight(x, z);
		for (const zn of this.zones) {
			const dx = x - zn.x;
			const dz = z - zn.z;
			const d2 = dx * dx + dz * dz;
			const outer = zn.r + zn.fall;
			if (d2 > outer * outer) continue;
			const mask = smoothstep(outer, zn.r, Math.sqrt(d2));
			h = lerp(h, zn.target, mask);
		}
		return h;
	}

	private buildStreamProfile(): void {
		const pts = STREAM_PATH;
		let cum = 0;
		this.streamCum = [0];
		for (let i = 1; i < pts.length; i++) {
			cum += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
			this.streamCum.push(cum);
		}
		const total = cum;
		let level = Infinity;
		for (let s = 0; s <= total + 0.001; s += this.streamStep) {
			const p = this.pointAlong(s);
			level = Math.min(level, this.shapedHeight(p.x, p.z) - 1.3);
			const end = s / total;
			// Ease the last stretch into the pond surface.
			const y = end > 0.92 ? lerp(level, this.pondLevel + 0.15, smoothstep(0.92, 1, end)) : level;
			this.streamLevels.push(y);
			this.stream.push({ x: p.x, z: p.z, y, dx: p.dx, dz: p.dz });
		}
	}

	private pointAlong(s: number): { x: number; z: number; dx: number; dz: number } {
		const pts = STREAM_PATH;
		for (let i = 1; i < pts.length; i++) {
			if (s <= this.streamCum[i] || i === pts.length - 1) {
				const segLen = this.streamCum[i] - this.streamCum[i - 1];
				const t = clamp((s - this.streamCum[i - 1]) / segLen, 0, 1);
				const dx = (pts[i].x - pts[i - 1].x) / segLen;
				const dz = (pts[i].z - pts[i - 1].z) / segLen;
				return { x: lerp(pts[i - 1].x, pts[i].x, t), z: lerp(pts[i - 1].z, pts[i].z, t), dx, dz };
			}
		}
		return { x: pts[0].x, z: pts[0].z, dx: 0, dz: 1 };
	}

	/** Distance to the stream centreline and the water level at the closest point. */
	streamQuery(x: number, z: number, out: { d: number; level: number; dx: number; dz: number }): void {
		const pts = STREAM_PATH;
		let best = Infinity;
		let bestS = 0;
		let bi = 1;
		for (let i = 1; i < pts.length; i++) {
			const d = distToSegment2D(x, z, pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z, this.segT);
			if (d < best) {
				best = d;
				bi = i;
				bestS = this.streamCum[i - 1] + this.segT.t * (this.streamCum[i] - this.streamCum[i - 1]);
			}
		}
		const fi = bestS / this.streamStep;
		const i0 = Math.min(this.streamLevels.length - 1, Math.floor(fi));
		const i1 = Math.min(this.streamLevels.length - 1, i0 + 1);
		out.d = best;
		out.level = lerp(this.streamLevels[i0], this.streamLevels[i1], fi - i0);
		const segLen = this.streamCum[bi] - this.streamCum[bi - 1];
		out.dx = (pts[bi].x - pts[bi - 1].x) / segLen;
		out.dz = (pts[bi].z - pts[bi - 1].z) / segLen;
	}

	private fill(): void {
		const n = this.noise;
		const sq = { d: 0, level: 0, dx: 0, dz: 0 };
		let minSX = Infinity;
		let maxSX = -Infinity;
		let minSZ = Infinity;
		let maxSZ = -Infinity;
		for (const p of STREAM_PATH) {
			minSX = Math.min(minSX, p.x - 16);
			maxSX = Math.max(maxSX, p.x + 16);
			minSZ = Math.min(minSZ, p.z - 16);
			maxSZ = Math.max(maxSZ, p.z + 16);
		}
		const pond = this.pond;
		const pondR = 52;
		for (let iz = 0; iz < V; iz++) {
			const z = -WORLD_HALF + iz * CELL;
			for (let ix = 0; ix < V; ix++) {
				const x = -WORLD_HALF + ix * CELL;
				const i = iz * V + ix;
				let h = this.shapedHeight(x, z);
				let wet = 0;
				let streamD = Infinity;
				if (x > minSX && x < maxSX && z > minSZ && z < maxSZ) {
					this.streamQuery(x, z, sq);
					streamD = sq.d;
					if (sq.d < 14) {
						const bed = sq.level - 1.9;
						const channel = smoothstep(11, 4, sq.d);
						h = lerp(h, Math.min(h, bed), channel);
						const bank = smoothstep(5, 7.5, sq.d) * smoothstep(13.5, 9, sq.d);
						h = Math.max(h, lerp(h, sq.level + 0.5, bank));
						if (sq.d < 6.5) wet = 1;
					}
				}
				const pd = Math.hypot(x - pond.x, z - pond.z);
				if (pd < pondR) {
					const t = pd / pondR;
					h -= 7.5 * (1 - t * t);
					if (h < this.pondLevel) wet = 1;
				}
				this.heights[i] = h;
				this.water[i] = wet;

				// Biome masks used for colour, grass density and scattering.
				const zr = ridgeZ(x);
				const f = smoothstep(zr + 14, zr - 4, z);
				this.forest[i] = f;
				let dens = lerp(0.65 + 0.35 * n.noise(x * 0.02 + 40, z * 0.02), 0.32, f);
				const e = edgeDistance(x, z);
				dens *= 1 - smoothstep(420, 470, e);
				if (wet) dens = 0;
				if (streamD < 8) dens *= smoothstep(6, 8, streamD);
				const hd = Math.hypot(x - HIVE.x, z - HIVE.z);
				if (hd < HIVE.stumpRadius + 3) dens = 0;
				const td = this.trailDistance(x, z);
				if (td < 6) dens *= 0.12 + 0.88 * smoothstep(3, 6, td);
				this.density[i] = clamp(dens, 0, 1);
			}
		}
		// Steep slopes (the ridge cliff, mountains) get no grass.
		for (let iz = 1; iz < V - 1; iz++) {
			for (let ix = 1; ix < V - 1; ix++) {
				const i = iz * V + ix;
				const gx = (this.heights[i + 1] - this.heights[i - 1]) / (2 * CELL);
				const gz = (this.heights[i + V] - this.heights[i - V]) / (2 * CELL);
				const slope = Math.sqrt(gx * gx + gz * gz);
				if (slope > 0.7) this.density[i] *= 1 - smoothstep(0.7, 1.1, slope);
			}
		}
		// Picnic blanket footprint.
		const pic = landmark('picnic');
		for (let iz = 0; iz < V; iz++) {
			const z = -WORLD_HALF + iz * CELL;
			if (Math.abs(z - pic.z) > 16) continue;
			for (let ix = 0; ix < V; ix++) {
				const x = -WORLD_HALF + ix * CELL;
				if (Math.abs(x - pic.x) < 21) this.density[iz * V + ix] = 0;
			}
		}
	}

	trailDistance(x: number, z: number): number {
		if (x < -110 || x > 165 || z < -10 || z > 110) return Infinity;
		let best = Infinity;
		for (let i = 1; i < TRAIL.length; i++) {
			best = Math.min(best, distToSegment2D(x, z, TRAIL[i - 1].x, TRAIL[i - 1].z, TRAIL[i].x, TRAIL[i].z));
		}
		return best;
	}

	private cellCoords(x: number, z: number): { ix: number; iz: number; fx: number; fz: number } {
		const gx = clamp((x + WORLD_HALF) / CELL, 0, GRID - 0.0001);
		const gz = clamp((z + WORLD_HALF) / CELL, 0, GRID - 0.0001);
		const ix = Math.floor(gx);
		const iz = Math.floor(gz);
		return { ix, iz, fx: gx - ix, fz: gz - iz };
	}

	/** Ground height using the same triangulation as the render mesh and physics heightfield. */
	heightAt(x: number, z: number): number {
		const gx = clamp((x + WORLD_HALF) / CELL, 0, GRID - 0.0001);
		const gz = clamp((z + WORLD_HALF) / CELL, 0, GRID - 0.0001);
		const ix = Math.floor(gx);
		const iz = Math.floor(gz);
		const fx = gx - ix;
		const fz = gz - iz;
		const i = iz * V + ix;
		const h00 = this.heights[i];
		const h10 = this.heights[i + 1];
		const h01 = this.heights[i + V];
		const h11 = this.heights[i + V + 1];
		if (fx > fz) return h00 + fx * (h10 - h00) + fz * (h11 - h10);
		return h00 + fz * (h01 - h00) + fx * (h11 - h01);
	}

	normalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
		const e = 1.5;
		const hl = this.heightAt(x - e, z);
		const hr = this.heightAt(x + e, z);
		const hd = this.heightAt(x, z - e);
		const hu = this.heightAt(x, z + e);
		return out.set(hl - hr, 2 * e, hd - hu).normalize();
	}

	sampleGrid(arr: Float32Array, x: number, z: number): number {
		const c = this.cellCoords(x, z);
		const i = c.iz * V + c.ix;
		const a = lerp(arr[i], arr[i + 1], c.fx);
		const b = lerp(arr[i + V], arr[i + V + 1], c.fx);
		return lerp(a, b, c.fz);
	}

	densityAt(x: number, z: number): number {
		return this.sampleGrid(this.density, x, z);
	}

	forestAt(x: number, z: number): number {
		return this.sampleGrid(this.forest, x, z);
	}

	private sq = { d: 0, level: 0, dx: 0, dz: 0 };

	/**
	 * Water surface height at (x, z) or -Infinity when there is no water.
	 * Optionally writes the current direction (stream flow) into `flow`.
	 */
	waterLevelAt(x: number, z: number, flow?: THREE.Vector3): number {
		const pd = Math.hypot(x - this.pond.x, z - this.pond.z);
		if (pd < 50) {
			flow?.set(0, 0, 0);
			return this.pondLevel;
		}
		if (x > -320 && x < -165 && z > -400 && z < 185) {
			this.streamQuery(x, z, this.sq);
			if (this.sq.d < 6.5) {
				flow?.set(this.sq.dx, 0, this.sq.dz);
				return this.sq.level;
			}
		}
		return -Infinity;
	}

	/** Builds a render chunk covering [ix0, ix0+size] x [iz0, iz0+size] lattice cells with the given vertex step. */
	buildChunkGeometry(ix0: number, iz0: number, size: number, step: number): THREE.BufferGeometry {
		const n = size / step;
		const verts = (n + 1) * (n + 1);
		const skirtVerts = 4 * n;
		const positions = new Float32Array((verts + skirtVerts) * 3);
		const normals = new Float32Array((verts + skirtVerts) * 3);
		const colors = new Float32Array((verts + skirtVerts) * 3);
		const tmpN = new THREE.Vector3();
		const col = new THREE.Color();
		let p = 0;
		for (let j = 0; j <= n; j++) {
			for (let i = 0; i <= n; i++) {
				const ix = ix0 + i * step;
				const iz = iz0 + j * step;
				const idx = iz * V + ix;
				const x = -WORLD_HALF + ix * CELL;
				const z = -WORLD_HALF + iz * CELL;
				positions[p * 3] = x;
				positions[p * 3 + 1] = this.heights[idx];
				positions[p * 3 + 2] = z;
				this.latticeNormal(ix, iz, tmpN);
				normals[p * 3] = tmpN.x;
				normals[p * 3 + 1] = tmpN.y;
				normals[p * 3 + 2] = tmpN.z;
				this.colorAt(ix, iz, tmpN.y, col);
				colors[p * 3] = col.r;
				colors[p * 3 + 1] = col.g;
				colors[p * 3 + 2] = col.b;
				p++;
			}
		}
		const indices: number[] = [];
		for (let j = 0; j < n; j++) {
			for (let i = 0; i < n; i++) {
				const a = j * (n + 1) + i; // (x0, z0)
				const b = a + 1; // (x1, z0)
				const c = a + n + 1; // (x0, z1)
				const d = c + 1; // (x1, z1)
				// Diagonal a-d matches the heightfield triangulation used by heightAt().
				indices.push(a, d, b, a, c, d);
			}
		}
		// Skirts hide cracks between chunks rendered at different LODs.
		const border: number[] = [];
		for (let i = 0; i < n; i++) border.push(i); // top edge
		for (let j = 0; j < n; j++) border.push(j * (n + 1) + n); // right edge
		for (let i = n; i > 0; i--) border.push(n * (n + 1) + i); // bottom edge
		for (let j = n; j > 0; j--) border.push(j * (n + 1)); // left edge
		const skirtStart = p;
		for (const b of border) {
			positions[p * 3] = positions[b * 3];
			positions[p * 3 + 1] = positions[b * 3 + 1] - 3;
			positions[p * 3 + 2] = positions[b * 3 + 2];
			normals[p * 3] = normals[b * 3];
			normals[p * 3 + 1] = normals[b * 3 + 1];
			normals[p * 3 + 2] = normals[b * 3 + 2];
			colors[p * 3] = colors[b * 3];
			colors[p * 3 + 1] = colors[b * 3 + 1];
			colors[p * 3 + 2] = colors[b * 3 + 2];
			p++;
		}
		for (let k = 0; k < border.length; k++) {
			const a = border[k];
			const b = border[(k + 1) % border.length];
			const sa = skirtStart + k;
			const sb = skirtStart + ((k + 1) % border.length);
			indices.push(a, b, sa, b, sb, sa);
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
		geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
		geo.setIndex(indices);
		geo.computeBoundingSphere();
		geo.computeBoundingBox();
		return geo;
	}

	private latticeNormal(ix: number, iz: number, out: THREE.Vector3): THREE.Vector3 {
		const l = this.heights[iz * V + Math.max(0, ix - 1)];
		const r = this.heights[iz * V + Math.min(GRID, ix + 1)];
		const d = this.heights[Math.max(0, iz - 1) * V + ix];
		const u = this.heights[Math.min(GRID, iz + 1) * V + ix];
		return out.set(l - r, 2 * CELL, d - u).normalize();
	}

	private colorAt(ix: number, iz: number, ny: number, out: THREE.Color): THREE.Color {
		const i = iz * V + ix;
		const x = -WORLD_HALF + ix * CELL;
		const z = -WORLD_HALF + iz * CELL;
		const h = this.heights[i];
		const f = this.forest[i];
		const nz = this.noise.noise(x * 0.03 + 11, z * 0.03 - 5);
		const nz2 = this.noise.noise(x * 0.11, z * 0.11);
		// Meadow: bright greens with sunny patches.
		// (Linear-space values: they read noticeably lighter on screen.)
		const meadow = _c1.setRGB(0.2, 0.47, 0.08).lerp(_c2.setRGB(0.42, 0.6, 0.1), 0.5 + nz * 0.5);
		meadow.lerp(_c3.setRGB(0.15, 0.38, 0.07), Math.max(0, nz2) * 0.35);
		// Forest floor: mossy greens with leaf-litter browns.
		const forest = _c4.setRGB(0.08, 0.22, 0.06).lerp(_c5.setRGB(0.24, 0.15, 0.06), Math.max(0, nz) * 0.6);
		forest.lerp(_c3.setRGB(0.05, 0.16, 0.06), Math.max(0, nz2) * 0.4);
		out.copy(meadow).lerp(forest, f);
		// Dirt trail.
		const td = this.trailDistance(x, z);
		if (td < 6) out.lerp(_c1.setRGB(0.55, 0.38, 0.18), smoothstep(6, 2.5, td) * 0.85);
		// Rock on steep slopes.
		const rock = smoothstep(0.82, 0.6, ny);
		if (rock > 0) out.lerp(_c1.setRGB(0.33, 0.28, 0.23).lerp(_c2.setRGB(0.22, 0.2, 0.18), nz2 * 0.5 + 0.5), rock);
		// Misty peaks: lavender rock and snow caps.
		if (h > 40) {
			out.lerp(_c1.setRGB(0.6, 0.58, 0.66), smoothstep(40, 75, h) * 0.8);
			out.lerp(_c2.setRGB(0.96, 0.97, 1), smoothstep(92, 110, h + nz * 6));
		}
		// Sandy pond shore and stream bed.
		const pd = Math.hypot(x - this.pond.x, z - this.pond.z);
		if (pd < 60) out.lerp(_c1.setRGB(0.72, 0.6, 0.32), smoothstep(60, 47, pd) * (h < this.pondLevel + 1.5 ? 1 : 0.6));
		if (h < this.pondLevel - 0.5 && pd < 52) out.lerp(_c2.setRGB(0.2, 0.25, 0.12), 0.6);
		if (this.water[i]) out.lerp(_c1.setRGB(0.25, 0.2, 0.12), 0.7);
		const hd = Math.hypot(x - HIVE.x, z - HIVE.z);
		if (hd < 60) out.lerp(_c1.setRGB(0.32, 0.52, 0.1), smoothstep(60, 40, hd) * 0.4);
		return out;
	}

	/** RGBA half-float texture: height, grass density, forestness. Sampled by the grass shader. */
	createDataTexture(): THREE.DataTexture {
		const data = new Uint16Array(V * V * 4);
		for (let i = 0; i < V * V; i++) {
			data[i * 4] = THREE.DataUtils.toHalfFloat(this.heights[i]);
			data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(this.density[i]);
			data[i * 4 + 2] = THREE.DataUtils.toHalfFloat(this.forest[i]);
			data[i * 4 + 3] = THREE.DataUtils.toHalfFloat(this.water[i]);
		}
		const tex = new THREE.DataTexture(data, V, V, THREE.RGBAFormat, THREE.HalfFloatType);
		tex.magFilter = THREE.LinearFilter;
		tex.minFilter = THREE.LinearFilter;
		tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
		tex.needsUpdate = true;
		return tex;
	}

	/** Heights in Rapier's column-major layout (row = z, column = x). */
	heightfieldData(): { nrows: number; ncols: number; heights: Float32Array; scale: { x: number; y: number; z: number } } {
		const out = new Float32Array(V * V);
		for (let iz = 0; iz < V; iz++) {
			for (let ix = 0; ix < V; ix++) out[iz + ix * V] = this.heights[iz * V + ix];
		}
		return { nrows: GRID, ncols: GRID, heights: out, scale: { x: WORLD_SIZE, y: 1, z: WORLD_SIZE } };
	}
}

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _c3 = new THREE.Color();
const _c4 = new THREE.Color();
const _c5 = new THREE.Color();
