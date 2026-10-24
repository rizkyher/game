import * as THREE from 'three';
import { Noise2D } from '../utils/Noise';
import { clamp, distToSegment2D, lerp, smoothstep } from '../utils/math';
import {
	ARENA,
	CELL,
	CRYPT,
	CROSSROADS,
	COURTYARD,
	FALLS,
	GATE,
	GRID,
	GROTTO,
	HEIGHTS,
	HL_RAMP_A,
	HL_RAMP_B,
	HOLLOW,
	ISLES,
	LAKE,
	LIBRARY,
	MILLPOND,
	RING,
	RIVER_LOWER,
	RIVER_UPPER,
	SHRINE,
	SPIRE,
	TEMPLE,
	WORLD_HALF,
	WORLD_SIZE,
	WAYSTONES,
	edgeDistance,
	forestMask,
	roadDistance,
	sanctuaryMask,
	type Point2
} from './WorldLayout';

const V = GRID + 1;

interface FlattenZone {
	x: number;
	z: number;
	r: number;
	fall: number;
	target: number;
	/** 0..1, how strongly to flatten. */
	k: number;
}

interface Stream {
	pts: Point2[];
	cum: number[];
	levels: number[];
	step: number;
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
	halfWidth: number;
}

export interface StreamSampleOut {
	d: number;
	level: number;
	dx: number;
	dz: number;
}

/** Circular areas kept free of scattered vegetation (structures, plazas). */
export interface Clearing {
	x: number;
	z: number;
	r: number;
}

/**
 * Deterministic heightfield shared by rendering, physics and gameplay queries. Heights
 * live on a (GRID+1)^2 lattice covering the whole world.
 */
export class Terrain {
	readonly heights = new Float32Array(V * V);
	/** Grass density 0..1. */
	readonly density = new Float32Array(V * V);
	readonly forest = new Float32Array(V * V);
	readonly highland = new Float32Array(V * V);
	readonly water = new Uint8Array(V * V);
	readonly clearings: Clearing[] = [];
	lakeLevel = 0;
	millLevel = 0;
	readonly upper: Stream;
	readonly lower: Stream;
	private noise: Noise2D;
	private zones: FlattenZone[] = [];
	private segT = { t: 0 };
	private sq: StreamSampleOut = { d: 0, level: 0, dx: 0, dz: 0 };

	constructor(seed: number) {
		this.noise = new Noise2D(seed);
		this.setupZones();
		this.upper = this.buildStream(RIVER_UPPER, 4.2, 1.4, null);
		this.lower = this.buildStream(RIVER_LOWER, 4.6, 1.3, this.lakeLevel);
		this.fill();
	}

	// ---------------------------------------------------------------- shape

	private plateauEdge(z: number): number {
		return 84 + Math.sin(z * 0.025 + 1) * 9 + this.noise.noise(z * 0.018, 3.3) * 6;
	}

	private plateauMask(x: number, z: number): number {
		const e = this.plateauEdge(z);
		const south = 206 + Math.sin(x * 0.035 + 2) * 7 + this.noise.noise(x * 0.02, 8.1) * 4;
		const m = smoothstep(e - 4, e + 3, x) * smoothstep(south + 7, south - 6, z) * smoothstep(-122, -110, z);
		return m;
	}

	/** Raw height before flattening zones and water carving. */
	private baseHeight(x: number, z: number): number {
		const n = this.noise;
		const road = roadDistance(x, z);
		const roadK = 1 - smoothstep(4, 10, road) * 1;
		const detail = 1 - roadK * 0.85;
		let h = 5 + n.fbm(x * 0.0042, z * 0.0042, 4) * 7 + n.fbm(x * 0.021 + 100, z * 0.021, 3) * 1.1 * detail;
		// Forest: hillier, with a raised shelf in the north-west carrying the upper river.
		const f = forestMask(x, z);
		h += f * (2 + n.fbm(x * 0.011 + 30, z * 0.011 - 12, 4) * 6 * detail);
		const shelfEdge = 149 + Math.sin(x * 0.06) * 3;
		const shelf = smoothstep(shelfEdge + 2, shelfEdge - 4, z) * smoothstep(-168, -196, x);
		h += shelf * 12;
		// Highlands plateau with cliffs.
		const pm = this.plateauMask(x, z);
		if (pm > 0) {
			const ph = HEIGHTS.plateau + n.fbm(x * 0.008 - 40, z * 0.008 + 7, 3) * 4 * detail;
			h = lerp(h, ph, pm);
		}
		// Ramp up to the plateau.
		const rd = distToSegment2D(x, z, HL_RAMP_A.x, HL_RAMP_A.z, HL_RAMP_B.x, HL_RAMP_B.z, this.segT);
		if (rd < 16) {
			const t = this.segT.t;
			const rampH = lerp(7.5, HEIGHTS.plateau, smoothstep(0, 1, t));
			h = lerp(h, Math.max(h, rampH), smoothstep(16, 8, rd));
		}
		// Ridge between the vale and the sanctuary, broken only by the gate canyon.
		const ridge = smoothstep(-100, -116, z) * smoothstep(-166, -150, z);
		if (ridge > 0) {
			const canyon = smoothstep(GATE.halfWidth + 9, GATE.halfWidth + 2, Math.abs(x - GATE.x));
			h += ridge * (1 - canyon) * (34 + n.fbm(x * 0.02, z * 0.02 + 9, 3) * 12);
		}
		// Sanctuary terrace.
		const s = sanctuaryMask(x, z);
		if (s > 0) h = lerp(h, HEIGHTS.terrace + n.fbm(x * 0.012, z * 0.012 - 50, 3) * 1.6 * detail, s);
		// Mountains ringing the world.
		const e = edgeDistance(x, z);
		const m = smoothstep(58, 6, e);
		h += m * m * (64 + n.fbm(x * 0.013 - 9, z * 0.013 + 4, 4) * 30);
		// Western cliffs above the grotto.
		const g = smoothstep(26, 10, Math.hypot(x - (GROTTO.x - 18), z - GROTTO.z));
		h += g * 10;
		return h;
	}

	private setupZones(): void {
		const add = (x: number, z: number, r: number, fall: number, k = 1, target?: number) => {
			this.zones.push({ x, z, r, fall, target: target ?? this.baseHeight(x, z), k });
		};
		add(HOLLOW.x, HOLLOW.z, HOLLOW.r + 6, 26, 1, HEIGHTS.hollow);
		add(CROSSROADS.x + 14, CROSSROADS.z - 10, 22, 16, 0.9);
		add(SHRINE.x, SHRINE.z, 20, 14, 1);
		add(LAKE.x, LAKE.z, LAKE.r + 6, 16, 1, 5);
		add(FALLS.x, FALLS.z + 9, 9, 6, 1, 5);
		add(MILLPOND.x, MILLPOND.z, MILLPOND.r + 5, 12, 1, 3.4);
		add(RING.x, RING.z, RING.r + 2, 12, 1);
		add(SPIRE.x, SPIRE.z, 20, 12, 1);
		add(ISLES.x, ISLES.z, 30, 14, 0.6);
		add(GATE.x, GATE.z, 11, 10, 0.9);
		add(COURTYARD.x, COURTYARD.z, 38, 14, 1, HEIGHTS.terrace);
		add(TEMPLE.x, TEMPLE.z, 18, 10, 1);
		add(LIBRARY.x, LIBRARY.z, 18, 10, 1);
		add(GROTTO.x + 6, GROTTO.z, 9, 8, 1);
		this.lakeLevel = 5 - 1.4;
		this.millLevel = 3.4 - 1.2;
		this.clearings.push(
			{ x: HOLLOW.x, z: HOLLOW.z, r: HOLLOW.r + 4 },
			{ x: CROSSROADS.x + 18, z: CROSSROADS.z - 12, r: 12 },
			{ x: SHRINE.x, z: SHRINE.z, r: 17 },
			{ x: RING.x, z: RING.z, r: RING.r + 1 },
			{ x: SPIRE.x, z: SPIRE.z, r: 14 },
			{ x: GATE.x, z: GATE.z, r: 16 },
			{ x: COURTYARD.x, z: COURTYARD.z, r: 36 },
			{ x: TEMPLE.x, z: TEMPLE.z, r: 18 },
			{ x: LIBRARY.x, z: LIBRARY.z, r: 18 },
			{ x: ARENA.x, z: ARENA.z, r: ARENA.r + 4 },
			{ x: GROTTO.x + 6, z: GROTTO.z, r: 8 }
		);
		for (const w of WAYSTONES) this.clearings.push({ x: w.x, z: w.z, r: 5 });
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
			const mask = smoothstep(outer, zn.r, Math.sqrt(d2)) * zn.k;
			h = lerp(h, zn.target, mask);
		}
		// Sunken arena bowl and the crypt stair that leads into it.
		const ad = Math.hypot(x - ARENA.x, z - ARENA.z);
		if (ad < ARENA.r + 4) h = lerp(h, HEIGHTS.arenaFloor, smoothstep(ARENA.r + 3.5, ARENA.r + 0.5, ad));
		if (Math.abs(x - CRYPT.x) < CRYPT.halfWidth + 1 && z < CRYPT.z0 + 1 && z > CRYPT.z1 - 2) {
			const t = clamp((CRYPT.z0 - z) / (CRYPT.z0 - CRYPT.stairEnd), 0, 1);
			h = lerp(HEIGHTS.terrace, HEIGHTS.arenaFloor, t);
		}
		return h;
	}

	private buildStream(pts: Point2[], halfWidth: number, depth: number, endLevel: number | null): Stream {
		const cum = [0];
		let total = 0;
		for (let i = 1; i < pts.length; i++) {
			total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
			cum.push(total);
		}
		const st: Stream = { pts, cum, levels: [], step: 2, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, halfWidth };
		for (const p of pts) {
			st.minX = Math.min(st.minX, p.x - 18);
			st.maxX = Math.max(st.maxX, p.x + 18);
			st.minZ = Math.min(st.minZ, p.z - 18);
			st.maxZ = Math.max(st.maxZ, p.z + 18);
		}
		let level = Infinity;
		for (let s = 0; s <= total + 0.001; s += st.step) {
			const p = this.pointAlong(st, s);
			level = Math.min(level, this.shapedHeight(p.x, p.z) - depth);
			if (endLevel !== null) level = Math.max(level, endLevel - 0.05);
			st.levels.push(level);
		}
		if (endLevel !== null) {
			// Ease the outflow into the millpond surface.
			const n = st.levels.length;
			for (let i = 0; i < n; i++) {
				const t = i / (n - 1);
				if (t > 0.85) st.levels[i] = lerp(st.levels[i], this.millLevel + 0.1, smoothstep(0.85, 1, t));
			}
		}
		return st;
	}

	private pointAlong(st: Stream, s: number): { x: number; z: number; dx: number; dz: number } {
		const pts = st.pts;
		for (let i = 1; i < pts.length; i++) {
			if (s <= st.cum[i] || i === pts.length - 1) {
				const segLen = st.cum[i] - st.cum[i - 1];
				const t = clamp((s - st.cum[i - 1]) / segLen, 0, 1);
				const dx = (pts[i].x - pts[i - 1].x) / segLen;
				const dz = (pts[i].z - pts[i - 1].z) / segLen;
				return { x: lerp(pts[i - 1].x, pts[i].x, t), z: lerp(pts[i - 1].z, pts[i].z, t), dx, dz };
			}
		}
		return { x: pts[0].x, z: pts[0].z, dx: 0, dz: 1 };
	}

	streamQuery(st: Stream, x: number, z: number, out: StreamSampleOut): void {
		const pts = st.pts;
		let best = Infinity;
		let bestS = 0;
		let bi = 1;
		for (let i = 1; i < pts.length; i++) {
			const d = distToSegment2D(x, z, pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z, this.segT);
			if (d < best) {
				best = d;
				bi = i;
				bestS = st.cum[i - 1] + this.segT.t * (st.cum[i] - st.cum[i - 1]);
			}
		}
		const fi = bestS / st.step;
		const i0 = Math.min(st.levels.length - 1, Math.floor(fi));
		const i1 = Math.min(st.levels.length - 1, i0 + 1);
		out.d = best;
		out.level = lerp(st.levels[i0], st.levels[i1], fi - i0);
		const segLen = st.cum[bi] - st.cum[bi - 1];
		out.dx = (pts[bi].x - pts[bi - 1].x) / segLen;
		out.dz = (pts[bi].z - pts[bi - 1].z) / segLen;
	}

	streamSamples(st: Stream): { x: number; z: number; y: number; dx: number; dz: number }[] {
		const out: { x: number; z: number; y: number; dx: number; dz: number }[] = [];
		for (let i = 0; i < st.levels.length; i++) {
			const p = this.pointAlong(st, i * st.step);
			out.push({ x: p.x, z: p.z, y: st.levels[i], dx: p.dx, dz: p.dz });
		}
		return out;
	}

	private carveStream(st: Stream, x: number, z: number, h: number): { h: number; wet: boolean; d: number } {
		if (x < st.minX || x > st.maxX || z < st.minZ || z > st.maxZ) return { h, wet: false, d: Infinity };
		this.streamQuery(st, x, z, this.sq);
		const sq = this.sq;
		const hw = st.halfWidth;
		if (sq.d < hw * 3.2) {
			const bed = sq.level - 1.6;
			const channel = smoothstep(hw * 1.9, hw * 0.7, sq.d);
			h = lerp(h, Math.min(h, bed), channel);
			const bank = smoothstep(hw, hw * 1.5, sq.d) * smoothstep(hw * 3.1, hw * 2, sq.d);
			h = Math.max(h, lerp(h, sq.level + 0.4, bank));
		}
		return { h, wet: sq.d < hw * 1.15, d: sq.d };
	}

	private fill(): void {
		const n = this.noise;
		for (let iz = 0; iz < V; iz++) {
			const z = -WORLD_HALF + iz * CELL;
			for (let ix = 0; ix < V; ix++) {
				const x = -WORLD_HALF + ix * CELL;
				const i = iz * V + ix;
				let h = this.shapedHeight(x, z);
				let wet = false;
				let streamD = Infinity;
				// The upper river stops at the lip of the falls.
				if (z < FALLS.z + 2) {
					const r = this.carveStream(this.upper, x, z, h);
					h = r.h;
					wet ||= r.wet;
					streamD = Math.min(streamD, r.d);
				}
				const r2 = this.carveStream(this.lower, x, z, h);
				h = r2.h;
				wet ||= r2.wet;
				streamD = Math.min(streamD, r2.d);
				// Lake (with the plunge pool under the falls) and the millpond.
				const ld = Math.min(Math.hypot((x - LAKE.x) * 0.95, z - LAKE.z) / LAKE.r, Math.hypot(x - FALLS.x, z - (FALLS.z + 8)) / 11);
				if (ld < 1.25) {
					const t = Math.min(1, ld);
					h -= 6.5 * (1 - t * t) * smoothstep(1.25, 0.9, ld);
					if (h < this.lakeLevel) wet = true;
				}
				const md = Math.hypot(x - MILLPOND.x, z - MILLPOND.z) / MILLPOND.r;
				if (md < 1.25) {
					const t = Math.min(1, md);
					h -= 4 * (1 - t * t) * smoothstep(1.25, 0.9, md);
					if (h < this.millLevel) wet = true;
				}
				this.heights[i] = h;
				this.water[i] = wet ? 1 : 0;

				const f = forestMask(x, z);
				this.forest[i] = f;
				const hl = this.plateauMask(x, z) * (1 - sanctuaryMask(x, z));
				this.highland[i] = hl;
				let dens = lerp(0.75 + 0.25 * n.noise(x * 0.02 + 40, z * 0.02), 0.45, f);
				dens = lerp(dens, 0.55 + 0.3 * n.noise(x * 0.03, z * 0.03 + 9), hl);
				dens *= lerp(1, 0.45, sanctuaryMask(x, z));
				const e = edgeDistance(x, z);
				dens *= 1 - smoothstep(30, 8, e);
				if (wet) dens = 0;
				if (streamD < 8) dens *= smoothstep(5, 8, streamD);
				const rd = roadDistance(x, z);
				if (rd < 5) dens *= 0.08 + 0.92 * smoothstep(2.5, 5, rd);
				this.density[i] = clamp(dens, 0, 1);
			}
		}
		// Steep slopes get no grass.
		for (let iz = 1; iz < V - 1; iz++) {
			for (let ix = 1; ix < V - 1; ix++) {
				const i = iz * V + ix;
				const gx = (this.heights[i + 1] - this.heights[i - 1]) / (2 * CELL);
				const gz = (this.heights[i + V] - this.heights[i - V]) / (2 * CELL);
				const slope = Math.sqrt(gx * gx + gz * gz);
				if (slope > 0.65) this.density[i] *= 1 - smoothstep(0.65, 1.0, slope);
			}
		}
		// Plazas and structure footprints.
		for (const c of this.clearings) {
			const r = c.r;
			const ix0 = Math.max(0, Math.floor((c.x - r + WORLD_HALF) / CELL));
			const ix1 = Math.min(GRID, Math.ceil((c.x + r + WORLD_HALF) / CELL));
			const iz0 = Math.max(0, Math.floor((c.z - r + WORLD_HALF) / CELL));
			const iz1 = Math.min(GRID, Math.ceil((c.z + r + WORLD_HALF) / CELL));
			for (let iz = iz0; iz <= iz1; iz++) {
				for (let ix = ix0; ix <= ix1; ix++) {
					const x = -WORLD_HALF + ix * CELL;
					const z = -WORLD_HALF + iz * CELL;
					const d = Math.hypot(x - c.x, z - c.z);
					if (d < r) this.density[iz * V + ix] *= smoothstep(r * 0.8, r, d) * 0.6;
				}
			}
		}
	}

	// ---------------------------------------------------------------- queries

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

	slopeAt(x: number, z: number): number {
		const e = 1.5;
		const gx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
		const gz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
		return Math.sqrt(gx * gx + gz * gz);
	}

	sampleGrid(arr: Float32Array, x: number, z: number): number {
		const gx = clamp((x + WORLD_HALF) / CELL, 0, GRID - 0.0001);
		const gz = clamp((z + WORLD_HALF) / CELL, 0, GRID - 0.0001);
		const ix = Math.floor(gx);
		const iz = Math.floor(gz);
		const fx = gx - ix;
		const fz = gz - iz;
		const i = iz * V + ix;
		const a = lerp(arr[i], arr[i + 1], fx);
		const b = lerp(arr[i + V], arr[i + V + 1], fx);
		return lerp(a, b, fz);
	}

	densityAt(x: number, z: number): number {
		return this.sampleGrid(this.density, x, z);
	}

	forestAt(x: number, z: number): number {
		return this.sampleGrid(this.forest, x, z);
	}

	highlandAt(x: number, z: number): number {
		return this.sampleGrid(this.highland, x, z);
	}

	inClearing(x: number, z: number, pad = 0): boolean {
		for (const c of this.clearings) {
			const dx = x - c.x;
			const dz = z - c.z;
			const r = c.r + pad;
			if (dx * dx + dz * dz < r * r) return true;
		}
		return false;
	}

	/**
	 * Water surface height at (x, z) or -Infinity when there is no water.
	 * Optionally writes the current direction (river flow) into `flow`.
	 */
	waterLevelAt(x: number, z: number, flow?: THREE.Vector3): number {
		const ld = Math.min(Math.hypot((x - LAKE.x) * 0.95, z - LAKE.z) / LAKE.r, Math.hypot(x - FALLS.x, z - (FALLS.z + 8)) / 11);
		if (ld < 1.2) {
			flow?.set(0, 0, 0);
			return this.heightAt(x, z) < this.lakeLevel + 0.02 ? this.lakeLevel : -Infinity;
		}
		if (Math.hypot(x - MILLPOND.x, z - MILLPOND.z) < MILLPOND.r * 1.2) {
			flow?.set(0, 0, 0);
			return this.heightAt(x, z) < this.millLevel + 0.02 ? this.millLevel : -Infinity;
		}
		for (const st of [this.upper, this.lower]) {
			if (x < st.minX || x > st.maxX || z < st.minZ || z > st.maxZ) continue;
			if (st === this.upper && z > FALLS.z + 2) continue;
			this.streamQuery(st, x, z, this.sq);
			if (this.sq.d < st.halfWidth * 1.25 && this.heightAt(x, z) < this.sq.level + 0.05) {
				flow?.set(this.sq.dx, 0, this.sq.dz);
				return this.sq.level;
			}
		}
		return -Infinity;
	}

	// ---------------------------------------------------------------- render data

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
				const a = j * (n + 1) + i;
				const b = a + 1;
				const c = a + n + 1;
				const d = c + 1;
				// Diagonal a-d matches the heightfield triangulation used by heightAt().
				indices.push(a, d, b, a, c, d);
			}
		}
		// Skirts hide cracks between chunks rendered at different LODs.
		const border: number[] = [];
		for (let i = 0; i < n; i++) border.push(i);
		for (let j = 0; j < n; j++) border.push(j * (n + 1) + n);
		for (let i = n; i > 0; i--) border.push(n * (n + 1) + i);
		for (let j = n; j > 0; j--) border.push(j * (n + 1));
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

	/** Vertex colour (linear space) for a lattice point. */
	colorAt(ix: number, iz: number, ny: number, out: THREE.Color): THREE.Color {
		const i = iz * V + ix;
		const x = -WORLD_HALF + ix * CELL;
		const z = -WORLD_HALF + iz * CELL;
		const h = this.heights[i];
		const f = this.forest[i];
		const hl = this.highland[i];
		const s = sanctuaryMask(x, z);
		const nz = this.noise.noise(x * 0.03 + 11, z * 0.03 - 5);
		const nz2 = this.noise.noise(x * 0.11, z * 0.11);
		// Vale: warm golden-hour greens.
		out.setRGB(0.19, 0.4, 0.07).lerp(_c2.setRGB(0.42, 0.52, 0.1), 0.5 + nz * 0.5);
		out.lerp(_c3.setRGB(0.13, 0.32, 0.07), Math.max(0, nz2) * 0.35);
		// Forest floor: deep teal moss and loam.
		if (f > 0) {
			_c1.setRGB(0.05, 0.2, 0.12).lerp(_c2.setRGB(0.16, 0.12, 0.05), Math.max(0, nz) * 0.6);
			_c1.lerp(_c3.setRGB(0.03, 0.16, 0.14), Math.max(0, nz2) * 0.5);
			out.lerp(_c1, f);
		}
		// Highlands: heather, sage and lavender.
		if (hl > 0) {
			_c1.setRGB(0.27, 0.32, 0.18).lerp(_c2.setRGB(0.36, 0.22, 0.42), Math.max(0, nz) * 0.7);
			_c1.lerp(_c3.setRGB(0.42, 0.42, 0.24), Math.max(0, nz2) * 0.3);
			out.lerp(_c1, hl);
		}
		// Sanctuary: pale ashen grass.
		if (s > 0) {
			_c1.setRGB(0.2, 0.24, 0.16).lerp(_c2.setRGB(0.26, 0.2, 0.3), 0.5 + nz * 0.5);
			out.lerp(_c1, s);
		}
		// Roads: packed earth; flagstones in the sanctuary.
		const rd = roadDistance(x, z);
		if (rd < 5.5) {
			const k = smoothstep(5.5, 2.2, rd) * 0.9;
			if (s > 0.5) {
				const tile = (Math.floor(x / 1.6) + Math.floor(z / 1.6)) & 1;
				_c1.setRGB(0.36, 0.34, 0.38).multiplyScalar(tile ? 1 : 0.86);
			} else _c1.setRGB(0.45, 0.32, 0.17).lerp(_c2.setRGB(0.36, 0.27, 0.16), nz2 * 0.5 + 0.5);
			out.lerp(_c1, k);
		}
		// Plazas.
		const hd = Math.hypot(x - HOLLOW.x, z - HOLLOW.z);
		if (hd < 16) out.lerp(_c1.setRGB(0.48, 0.4, 0.3).multiplyScalar(((Math.floor(x / 1.4) + Math.floor(z / 1.4)) & 1) * 0.08 + 0.92), smoothstep(16, 13, hd));
		const cd = Math.hypot(x - COURTYARD.x, z - COURTYARD.z);
		if (cd < 30) {
			const tile = (Math.floor(x / 2) + Math.floor(z / 2)) & 1;
			out.lerp(_c1.setRGB(0.34, 0.33, 0.37).multiplyScalar(tile ? 1 : 0.84), smoothstep(30, 26, cd) * (0.7 + nz2 * 0.25));
		}
		const ad = Math.hypot(x - ARENA.x, z - ARENA.z);
		if (ad < ARENA.r + 1) {
			const ring = Math.abs(((ad % 6) + 6) % 6 - 3) < 0.2 ? 0.75 : 1;
			out.copy(_c1.setRGB(0.27, 0.25, 0.32).multiplyScalar(ring * (0.92 + nz2 * 0.08)));
		}
		if (Math.abs(x - CRYPT.x) < CRYPT.halfWidth && z < CRYPT.z0 && z > CRYPT.z1) out.setRGB(0.2, 0.19, 0.22);
		// Rock on steep slopes.
		const rock = smoothstep(0.8, 0.55, ny);
		if (rock > 0) {
			_c1.setRGB(0.3, 0.26, 0.24).lerp(_c2.setRGB(0.2, 0.19, 0.2), nz2 * 0.5 + 0.5);
			if (hl > 0.3) _c1.lerp(_c3.setRGB(0.3, 0.24, 0.36), 0.6);
			if (s > 0.3) _c1.lerp(_c3.setRGB(0.24, 0.2, 0.3), 0.6);
			if (f > 0.5) _c1.lerp(_c3.setRGB(0.16, 0.2, 0.15), 0.4);
			out.lerp(_c1, rock);
		}
		// Mountain peaks: violet rock and snow.
		if (h > 46) {
			out.lerp(_c1.setRGB(0.42, 0.38, 0.5), smoothstep(46, 72, h) * 0.75);
			out.lerp(_c2.setRGB(0.92, 0.93, 1), smoothstep(84, 100, h + nz * 6));
		}
		// Shores and beds.
		if (this.water[i]) out.lerp(_c1.setRGB(0.18, 0.16, 0.1), 0.75);
		else {
			const lakeD = Math.hypot(x - LAKE.x, z - LAKE.z);
			if (lakeD < LAKE.r + 8 && h < this.lakeLevel + 1.4) out.lerp(_c1.setRGB(0.55, 0.47, 0.3), 0.6);
		}
		return out;
	}

	/** RGBA half-float texture: height, grass density, forest, highland. Sampled by the grass shader. */
	createDataTexture(): THREE.DataTexture {
		const data = new Uint16Array(V * V * 4);
		for (let i = 0; i < V * V; i++) {
			data[i * 4] = THREE.DataUtils.toHalfFloat(this.heights[i]);
			data[i * 4 + 1] = THREE.DataUtils.toHalfFloat(this.density[i]);
			data[i * 4 + 2] = THREE.DataUtils.toHalfFloat(this.forest[i]);
			data[i * 4 + 3] = THREE.DataUtils.toHalfFloat(this.highland[i]);
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
