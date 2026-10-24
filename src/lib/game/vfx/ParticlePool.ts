import * as THREE from 'three';
import { TILE, type TileName } from './Textures';

export interface EmitParams {
	count: number;
	x: number;
	y: number;
	z: number;
	/** Random spawn offset radius (sphere). */
	spread: number;
	/** Base velocity added to every particle. */
	vx: number;
	vy: number;
	vz: number;
	/** Random spherical speed range. */
	speedMin: number;
	speedMax: number;
	/** Extra upward kick (scaled 0.5..1 per particle). */
	up: number;
	lifeMin: number;
	lifeMax: number;
	sizeMin: number;
	sizeMax: number;
	/** End size multiplier. */
	sizeEnd: number;
	color: THREE.Color;
	colorEnd: THREE.Color;
	alpha: number;
	alphaEnd: number;
	/** HDR multiplier on colour (>1 feeds bloom). */
	intensity: number;
	tile: TileName;
	/** World-units of length per m/s of velocity (0 = round billboard). */
	stretch: number;
	drag: number;
	gravity: number;
	spin: number;
	/** Orbit an attractor (tornadoes): -1 = ballistic. */
	attractor: number;
	orbitRadius: number;
	orbitSpeed: number;
	orbitRise: number;
}

export function defaultParams(): EmitParams {
	return {
		count: 1,
		x: 0,
		y: 0,
		z: 0,
		spread: 0,
		vx: 0,
		vy: 0,
		vz: 0,
		speedMin: 0,
		speedMax: 0,
		up: 0,
		lifeMin: 0.5,
		lifeMax: 1,
		sizeMin: 0.3,
		sizeMax: 0.5,
		sizeEnd: 1,
		color: new THREE.Color(1, 1, 1),
		colorEnd: new THREE.Color(1, 1, 1),
		alpha: 1,
		alphaEnd: 0,
		intensity: 1,
		tile: 'glow',
		stretch: 0,
		drag: 1,
		gravity: 0,
		spin: 0,
		attractor: -1,
		orbitRadius: 1,
		orbitSpeed: 2,
		orbitRise: 2
	};
}

const VERT = /* glsl */ `
	attribute vec3 iPos;
	attribute vec4 iColor;
	attribute vec4 iParams;
	attribute vec3 iVel;
	varying vec2 vUv;
	varying vec4 vColor;
	void main() {
		vColor = iColor;
		vec4 mv = viewMatrix * vec4(iPos, 1.0);
		float size = iParams.x;
		vec2 corner = position.xy;
		if (iParams.w > 0.0) {
			vec3 v = (viewMatrix * vec4(iVel, 0.0)).xyz;
			float sp = length(v.xy);
			vec2 dir = sp > 0.0001 ? v.xy / sp : vec2(0.0, 1.0);
			vec2 perp = vec2(-dir.y, dir.x);
			float len = size + sp * iParams.w;
			mv.xy += dir * corner.y * len + perp * corner.x * size;
		} else {
			float c = cos(iParams.y);
			float s = sin(iParams.y);
			mv.xy += vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
		}
		gl_Position = projectionMatrix * mv;
		// Atlas is 4 columns x 2 rows; row 0 is the top of the (flipY) canvas texture.
		float tile = iParams.z;
		vec2 uv = position.xy + 0.5;
		vUv = vec2((mod(tile, 4.0) + uv.x) / 4.0, 1.0 - (floor(tile / 4.0) + 1.0 - uv.y) / 2.0);
	}
`;

const FRAG_ADD = /* glsl */ `
	uniform sampler2D uAtlas;
	varying vec2 vUv;
	varying vec4 vColor;
	void main() {
		float m = texture2D(uAtlas, vUv).a;
		float a = m * vColor.a;
		if (a < 0.003) discard;
		gl_FragColor = vec4(vColor.rgb * a, a);
	}
`;

const FRAG_ALPHA = /* glsl */ `
	uniform sampler2D uAtlas;
	varying vec2 vUv;
	varying vec4 vColor;
	void main() {
		vec4 t = texture2D(uAtlas, vUv);
		float a = t.a * vColor.a;
		if (a < 0.01) discard;
		gl_FragColor = vec4(vColor.rgb * t.rgb, a);
	}
`;

/**
 * CPU-simulated, GPU-instanced billboard particles. One draw call per pool; a ring buffer
 * recycles the oldest particles when full, so there are no per-frame allocations.
 */
export class ParticlePool {
	readonly mesh: THREE.Mesh;
	private max: number;
	private head = 0;
	private active = 0;
	/** One past the highest slot used since the pool was last idle. */
	private span = 0;
	// simulation state
	private pos: Float32Array;
	private vel: Float32Array;
	private c0: Float32Array;
	private c1: Float32Array;
	private size0: Float32Array;
	private size1: Float32Array;
	private rot: Float32Array;
	private rotVel: Float32Array;
	private life: Float32Array;
	private maxLife: Float32Array;
	private drag: Float32Array;
	private grav: Float32Array;
	private attr: Int8Array;
	private orbA: Float32Array;
	private orbR: Float32Array;
	// GPU attributes
	private aPos: THREE.InstancedBufferAttribute;
	private aColor: THREE.InstancedBufferAttribute;
	private aParams: THREE.InstancedBufferAttribute;
	private aVel: THREE.InstancedBufferAttribute;
	private geo: THREE.InstancedBufferGeometry;
	private mat: THREE.ShaderMaterial;
	/** Up to 8 moving attractor points (tornado centres). */
	readonly attractors = new Float32Array(8 * 3);
	/** Global multiplier on emission counts (quality preset). */
	scale = 1;

	constructor(atlas: THREE.Texture, max: number, additive: boolean) {
		this.max = max;
		this.pos = new Float32Array(max * 3);
		this.vel = new Float32Array(max * 3);
		this.c0 = new Float32Array(max * 4);
		this.c1 = new Float32Array(max * 4);
		this.size0 = new Float32Array(max);
		this.size1 = new Float32Array(max);
		this.rot = new Float32Array(max);
		this.rotVel = new Float32Array(max);
		this.life = new Float32Array(max);
		this.maxLife = new Float32Array(max);
		this.drag = new Float32Array(max);
		this.grav = new Float32Array(max);
		this.attr = new Int8Array(max).fill(-1);
		this.orbA = new Float32Array(max);
		this.orbR = new Float32Array(max);
		this.geo = new THREE.InstancedBufferGeometry();
		this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
		this.geo.setIndex([0, 1, 2, 0, 2, 3]);
		this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
		this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
		this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
		this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
		this.geo.setAttribute('iPos', this.aPos);
		this.geo.setAttribute('iColor', this.aColor);
		this.geo.setAttribute('iParams', this.aParams);
		this.geo.setAttribute('iVel', this.aVel);
		this.geo.instanceCount = 0;
		this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
		this.mat = new THREE.ShaderMaterial({
			uniforms: { uAtlas: { value: atlas } },
			vertexShader: VERT,
			fragmentShader: additive ? FRAG_ADD : FRAG_ALPHA,
			transparent: true,
			depthWrite: false,
			// Additive pool outputs premultiplied colour, so blend One/One.
			blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
			blendSrc: THREE.OneFactor,
			blendDst: THREE.OneFactor
		});
		this.mesh = new THREE.Mesh(this.geo, this.mat);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = additive ? 20 : 15;
	}

	emit(p: EmitParams): void {
		const count = Math.max(1, Math.round(p.count * this.scale));
		const tile = TILE[p.tile];
		for (let n = 0; n < count; n++) {
			const i = this.head;
			this.head = (this.head + 1) % this.max;
			const i3 = i * 3;
			const i4 = i * 4;
			let ox = 0;
			let oy = 0;
			let oz = 0;
			if (p.spread > 0) {
				// Uniform-ish point in a sphere.
				do {
					ox = Math.random() * 2 - 1;
					oy = Math.random() * 2 - 1;
					oz = Math.random() * 2 - 1;
				} while (ox * ox + oy * oy + oz * oz > 1);
				ox *= p.spread;
				oy *= p.spread;
				oz *= p.spread;
			}
			this.pos[i3] = p.x + ox;
			this.pos[i3 + 1] = p.y + oy;
			this.pos[i3 + 2] = p.z + oz;
			const u = Math.random() * 2 - 1;
			const th = Math.random() * Math.PI * 2;
			const r = Math.sqrt(1 - u * u);
			const sp = p.speedMin + Math.random() * (p.speedMax - p.speedMin);
			this.vel[i3] = Math.cos(th) * r * sp + p.vx;
			this.vel[i3 + 1] = u * sp + p.vy + p.up * (0.5 + Math.random() * 0.5);
			this.vel[i3 + 2] = Math.sin(th) * r * sp + p.vz;
			const k = p.intensity;
			this.c0[i4] = p.color.r * k;
			this.c0[i4 + 1] = p.color.g * k;
			this.c0[i4 + 2] = p.color.b * k;
			this.c0[i4 + 3] = p.alpha;
			this.c1[i4] = p.colorEnd.r * k;
			this.c1[i4 + 1] = p.colorEnd.g * k;
			this.c1[i4 + 2] = p.colorEnd.b * k;
			this.c1[i4 + 3] = p.alphaEnd;
			const s = p.sizeMin + Math.random() * (p.sizeMax - p.sizeMin);
			this.size0[i] = s;
			this.size1[i] = s * p.sizeEnd;
			this.rot[i] = Math.random() * Math.PI * 2;
			this.rotVel[i] = (Math.random() - 0.5) * 2 * p.spin;
			const life = p.lifeMin + Math.random() * (p.lifeMax - p.lifeMin);
			if (this.life[i] <= 0) this.active++;
			this.life[i] = life;
			this.maxLife[i] = life;
			this.drag[i] = p.drag;
			this.grav[i] = p.gravity;
			this.attr[i] = p.attractor;
			if (p.attractor >= 0) {
				this.orbA[i] = Math.random() * Math.PI * 2;
				this.orbR[i] = p.orbitRadius * (0.5 + Math.random() * 0.7);
				this.vel[i3] = p.orbitSpeed * (0.7 + Math.random() * 0.6);
				this.vel[i3 + 1] = p.orbitRise * (0.6 + Math.random() * 0.8);
				this.vel[i3 + 2] = (Math.random() - 0.3) * 0.6;
			}
			this.aParams.array[i4 + 2] = tile;
			this.aParams.array[i4 + 3] = p.stretch;
			if (i + 1 > this.span) this.span = i + 1;
		}
		this.geo.instanceCount = this.span;
	}

	update(dt: number): void {
		if (this.active <= 0) {
			// Idle: restart the ring at slot 0 so the live range stays compact.
			this.geo.instanceCount = 0;
			this.span = 0;
			this.head = 0;
			return;
		}
		const P = this.aPos.array as Float32Array;
		const C = this.aColor.array as Float32Array;
		const Q = this.aParams.array as Float32Array;
		const Vv = this.aVel.array as Float32Array;
		let alive = 0;
		const n = this.span;
		for (let i = 0; i < n; i++) {
			const i3 = i * 3;
			const i4 = i * 4;
			if (this.life[i] <= 0) {
				Q[i4] = 0;
				continue;
			}
			this.life[i] -= dt;
			if (this.life[i] <= 0) {
				Q[i4] = 0;
				C[i4 + 3] = 0;
				continue;
			}
			alive++;
			const a = this.attr[i];
			if (a >= 0) {
				// Orbit: angular speed in vel.x, rise in vel.y, radius drift in vel.z.
				this.orbA[i] += this.vel[i3] * dt;
				this.orbR[i] = Math.max(0.2, this.orbR[i] + this.vel[i3 + 2] * dt);
				const cx = this.attractors[a * 3];
				const cy = this.attractors[a * 3 + 1];
				const cz = this.attractors[a * 3 + 2];
				const rise = (this.maxLife[i] - this.life[i]) * this.vel[i3 + 1];
				const rr = this.orbR[i] * (1 + rise * 0.12);
				const nx = cx + Math.cos(this.orbA[i]) * rr;
				const nz = cz + Math.sin(this.orbA[i]) * rr;
				const ny = cy + rise;
				Vv[i3] = (nx - this.pos[i3]) / Math.max(dt, 1e-4);
				Vv[i3 + 1] = (ny - this.pos[i3 + 1]) / Math.max(dt, 1e-4);
				Vv[i3 + 2] = (nz - this.pos[i3 + 2]) / Math.max(dt, 1e-4);
				this.pos[i3] = nx;
				this.pos[i3 + 1] = ny;
				this.pos[i3 + 2] = nz;
			} else {
				const dr = Math.exp(-this.drag[i] * dt);
				this.vel[i3] *= dr;
				this.vel[i3 + 1] = this.vel[i3 + 1] * dr + this.grav[i] * dt;
				this.vel[i3 + 2] *= dr;
				this.pos[i3] += this.vel[i3] * dt;
				this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
				this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
				Vv[i3] = this.vel[i3];
				Vv[i3 + 1] = this.vel[i3 + 1];
				Vv[i3 + 2] = this.vel[i3 + 2];
			}
			this.rot[i] += this.rotVel[i] * dt;
			const t = 1 - this.life[i] / this.maxLife[i];
			P[i3] = this.pos[i3];
			P[i3 + 1] = this.pos[i3 + 1];
			P[i3 + 2] = this.pos[i3 + 2];
			const fadeIn = t < 0.08 ? t / 0.08 : 1;
			C[i4] = this.c0[i4] + (this.c1[i4] - this.c0[i4]) * t;
			C[i4 + 1] = this.c0[i4 + 1] + (this.c1[i4 + 1] - this.c0[i4 + 1]) * t;
			C[i4 + 2] = this.c0[i4 + 2] + (this.c1[i4 + 2] - this.c0[i4 + 2]) * t;
			C[i4 + 3] = (this.c0[i4 + 3] + (this.c1[i4 + 3] - this.c0[i4 + 3]) * t) * fadeIn;
			Q[i4] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
			Q[i4 + 1] = this.rot[i];
		}
		this.active = alive;
		this.geo.instanceCount = this.span;
		this.aPos.needsUpdate = true;
		this.aColor.needsUpdate = true;
		this.aParams.needsUpdate = true;
		this.aVel.needsUpdate = true;
	}

	get count(): number {
		return this.active;
	}

	clear(): void {
		this.life.fill(0);
		this.active = 0;
		this.span = 0;
		this.head = 0;
		this.geo.instanceCount = 0;
	}

	dispose(): void {
		this.geo.dispose();
		this.mat.dispose();
	}
}
