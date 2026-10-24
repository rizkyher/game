import * as THREE from 'three';
import type { Terrain } from '../world/TerrainGenerator';

export type ParticleKind =
	| 'pollen'
	| 'sparkle'
	| 'dust'
	| 'splash'
	| 'honey'
	| 'trail'
	| 'stars'
	| 'mist'
	| 'seeds'
	| 'spores'
	| 'confetti'
	| 'wind'
	| 'swirl'
	| 'feather';

interface Preset {
	colors: number[];
	size: [number, number];
	grow: number;
	speed: [number, number];
	up: number;
	gravity: number;
	drag: number;
	life: [number, number];
	alpha: number;
}

const PRESETS: Record<ParticleKind, Preset> = {
	pollen: { colors: [0xffe14d, 0xffc928, 0xfff3a0], size: [0.22, 0.42], grow: 0, speed: [2, 6], up: 1, gravity: -2.5, drag: 1.6, life: [1, 2], alpha: 1 },
	sparkle: { colors: [0xffffff, 0xfff6c2, 0xffe082], size: [0.18, 0.34], grow: -0.5, speed: [4, 9], up: 0.5, gravity: 0, drag: 3.5, life: [0.4, 0.8], alpha: 1 },
	dust: { colors: [0xd9c3a0, 0xc7b08a, 0xe8dcc4], size: [0.8, 1.6], grow: 1.2, speed: [1.5, 4], up: 0.6, gravity: 0.6, drag: 2.2, life: [0.7, 1.3], alpha: 0.55 },
	splash: { colors: [0xe8f7ff, 0xb5e4ff, 0xffffff], size: [0.3, 0.6], grow: 0, speed: [4, 9], up: 9, gravity: -26, drag: 0.6, life: [0.6, 1.1], alpha: 0.9 },
	honey: { colors: [0xffa000, 0xffb300, 0xff8f00], size: [0.25, 0.45], grow: 0, speed: [1, 4], up: 2, gravity: -16, drag: 0.8, life: [0.6, 1.1], alpha: 1 },
	trail: { colors: [0xffffff, 0xfff8e1], size: [0.35, 0.55], grow: 1.4, speed: [0, 0.6], up: 0, gravity: 0, drag: 2, life: [0.35, 0.6], alpha: 0.45 },
	stars: { colors: [0xffeb3b, 0xffffff], size: [0.3, 0.45], grow: -0.3, speed: [1.5, 3], up: 2.5, gravity: -1, drag: 1.5, life: [0.6, 1], alpha: 1 },
	mist: { colors: [0xffffff, 0xeaf6ff], size: [2, 4], grow: 1.5, speed: [1, 3], up: 2.5, gravity: 1, drag: 1, life: [1.6, 2.6], alpha: 0.22 },
	seeds: { colors: [0xffffff, 0xf5f5f0], size: [0.25, 0.4], grow: 0, speed: [1.5, 4], up: 2.5, gravity: 0.25, drag: 0.6, life: [3, 5], alpha: 0.95 },
	spores: { colors: [0xb39ddb, 0xa5d6a7, 0xce93d8], size: [0.6, 1.2], grow: 1.6, speed: [2, 5], up: 1.5, gravity: 0.3, drag: 1.4, life: [1.4, 2.4], alpha: 0.55 },
	confetti: { colors: [0xff5252, 0xffeb3b, 0x69f0ae, 0x40c4ff, 0xe040fb, 0xff9100], size: [0.25, 0.4], grow: 0, speed: [5, 11], up: 6, gravity: -9, drag: 1.2, life: [1, 1.8], alpha: 1 },
	wind: { colors: [0xffffff], size: [0.18, 0.3], grow: 0, speed: [0, 0.5], up: 0, gravity: 0, drag: 0, life: [0.7, 1.2], alpha: 0.55 },
	swirl: { colors: [0xffcc80, 0xffe0b2, 0xc5e1a5], size: [0.35, 0.6], grow: 0, speed: [0.5, 1.5], up: 0, gravity: 0, drag: 0.5, life: [2, 3], alpha: 0.8 },
	feather: { colors: [0xc0644a, 0x8d5a44, 0xf0e0d0], size: [0.4, 0.7], grow: 0, speed: [3, 7], up: 3, gravity: -3, drag: 2, life: [1.2, 2], alpha: 1 }
};

const MAX = 3000;
const MAX_DEBRIS = 180;
const _c = new THREE.Color();

/** Pooled point-sprite particles plus instanced debris shards. No per-frame allocations. */
export class Effects {
	readonly points: THREE.Points;
	readonly debris: THREE.InstancedMesh;
	private pos = new Float32Array(MAX * 3);
	private vel = new Float32Array(MAX * 3);
	private col = new Float32Array(MAX * 4);
	private size = new Float32Array(MAX);
	private size0 = new Float32Array(MAX);
	private grow = new Float32Array(MAX);
	private life = new Float32Array(MAX);
	private maxLife = new Float32Array(MAX);
	private grav = new Float32Array(MAX);
	private drag = new Float32Array(MAX);
	private alpha0 = new Float32Array(MAX);
	private head = 0;
	private active = 0;
	private geo: THREE.BufferGeometry;
	private mat: THREE.ShaderMaterial;
	// debris
	private dPos = new Float32Array(MAX_DEBRIS * 3);
	private dVel = new Float32Array(MAX_DEBRIS * 3);
	private dRot = new Float32Array(MAX_DEBRIS * 3);
	private dSpin = new Float32Array(MAX_DEBRIS * 3);
	private dLife = new Float32Array(MAX_DEBRIS);
	private dScale = new Float32Array(MAX_DEBRIS);
	private dHead = 0;
	private m = new THREE.Matrix4();
	private q = new THREE.Quaternion();
	private e = new THREE.Euler();
	private v = new THREE.Vector3();
	private s = new THREE.Vector3();
	windX = 0;
	windZ = 0;

	constructor(
		scene: THREE.Scene,
		private terrain: Terrain
	) {
		this.geo = new THREE.BufferGeometry();
		this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
		this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
		this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
		this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
		this.mat = new THREE.ShaderMaterial({
			transparent: true,
			depthWrite: false,
			uniforms: { uScale: { value: 600 } },
			vertexShader: /* glsl */ `
				uniform float uScale;
				attribute vec4 aColor;
				attribute float aSize;
				varying vec4 vColor;
				void main() {
					vColor = aColor;
					vec4 mv = modelViewMatrix * vec4(position, 1.0);
					gl_PointSize = aSize * uScale / max(0.1, -mv.z);
					gl_Position = projectionMatrix * mv;
				}
			`,
			fragmentShader: /* glsl */ `
				varying vec4 vColor;
				void main() {
					vec2 c = gl_PointCoord - 0.5;
					float d = length(c);
					float a = smoothstep(0.5, 0.18, d) * vColor.a;
					if (a < 0.02) discard;
					gl_FragColor = vec4(vColor.rgb * (1.0 + (0.3 - d) * 0.6), a);
					#include <colorspace_fragment>
				}
			`
		});
		this.points = new THREE.Points(this.geo, this.mat);
		this.points.frustumCulled = false;
		this.points.renderOrder = 10;
		scene.add(this.points);

		const shard = new THREE.TetrahedronGeometry(0.35, 0);
		const dMat = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 });
		this.debris = new THREE.InstancedMesh(shard, dMat, MAX_DEBRIS);
		this.debris.frustumCulled = false;
		this.debris.castShadow = false;
		for (let i = 0; i < MAX_DEBRIS; i++) {
			this.debris.setMatrixAt(i, this.m.makeScale(0, 0, 0));
			this.debris.setColorAt(i, _c.setRGB(1, 1, 1));
		}
		scene.add(this.debris);
	}

	setViewport(height: number, fovDeg: number): void {
		this.mat.uniforms.uScale.value = height / (2 * Math.tan((fovDeg * Math.PI) / 360));
	}

	emit(kind: ParticleKind, p: THREE.Vector3, count: number, spread = 0.5, dir?: THREE.Vector3, dirSpeed = 0): void {
		const pr = PRESETS[kind];
		for (let n = 0; n < count; n++) {
			const i = this.head;
			this.head = (this.head + 1) % MAX;
			const i3 = i * 3;
			this.pos[i3] = p.x + (Math.random() - 0.5) * spread * 2;
			this.pos[i3 + 1] = p.y + (Math.random() - 0.5) * spread * 2;
			this.pos[i3 + 2] = p.z + (Math.random() - 0.5) * spread * 2;
			// Random direction on a sphere.
			const u = Math.random() * 2 - 1;
			const th = Math.random() * Math.PI * 2;
			const r = Math.sqrt(1 - u * u);
			const sp = pr.speed[0] + Math.random() * (pr.speed[1] - pr.speed[0]);
			this.vel[i3] = Math.cos(th) * r * sp + (dir ? dir.x * dirSpeed : 0);
			this.vel[i3 + 1] = u * sp + pr.up * (0.5 + Math.random() * 0.5) + (dir ? dir.y * dirSpeed : 0);
			this.vel[i3 + 2] = Math.sin(th) * r * sp + (dir ? dir.z * dirSpeed : 0);
			_c.setHex(pr.colors[(Math.random() * pr.colors.length) | 0]);
			this.col[i * 4] = _c.r;
			this.col[i * 4 + 1] = _c.g;
			this.col[i * 4 + 2] = _c.b;
			this.col[i * 4 + 3] = pr.alpha;
			this.alpha0[i] = pr.alpha;
			const s = pr.size[0] + Math.random() * (pr.size[1] - pr.size[0]);
			this.size0[i] = s;
			this.size[i] = s;
			this.grow[i] = pr.grow;
			const life = pr.life[0] + Math.random() * (pr.life[1] - pr.life[0]);
			if (this.life[i] <= 0) this.active++;
			this.life[i] = life;
			this.maxLife[i] = life;
			this.grav[i] = pr.gravity;
			this.drag[i] = pr.drag;
		}
	}

	/** Spawn tumbling shards (breakables, impacts). */
	shatter(p: THREE.Vector3, color: number, count: number, speed = 8, scale = 1): void {
		_c.setHex(color);
		for (let n = 0; n < count; n++) {
			const i = this.dHead;
			this.dHead = (this.dHead + 1) % MAX_DEBRIS;
			const i3 = i * 3;
			this.dPos[i3] = p.x + (Math.random() - 0.5);
			this.dPos[i3 + 1] = p.y + Math.random() * 0.5;
			this.dPos[i3 + 2] = p.z + (Math.random() - 0.5);
			this.dVel[i3] = (Math.random() - 0.5) * speed * 2;
			this.dVel[i3 + 1] = Math.random() * speed + speed * 0.4;
			this.dVel[i3 + 2] = (Math.random() - 0.5) * speed * 2;
			for (let k = 0; k < 3; k++) {
				this.dRot[i3 + k] = Math.random() * 6;
				this.dSpin[i3 + k] = (Math.random() - 0.5) * 18;
			}
			this.dLife[i] = 1.6 + Math.random();
			this.dScale[i] = (0.6 + Math.random() * 0.9) * scale;
			this.debris.setColorAt(i, _c);
		}
		if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;
	}

	update(dt: number): void {
		if (this.active > 0) {
			let alive = 0;
			for (let i = 0; i < MAX; i++) {
				if (this.life[i] <= 0) continue;
				this.life[i] -= dt;
				const i3 = i * 3;
				if (this.life[i] <= 0) {
					this.size[i] = 0;
					this.col[i * 4 + 3] = 0;
					continue;
				}
				alive++;
				const dr = Math.exp(-this.drag[i] * dt);
				this.vel[i3] = this.vel[i3] * dr + this.windX * dt * 0.6;
				this.vel[i3 + 1] = this.vel[i3 + 1] * dr + this.grav[i] * dt;
				this.vel[i3 + 2] = this.vel[i3 + 2] * dr + this.windZ * dt * 0.6;
				this.pos[i3] += this.vel[i3] * dt;
				this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
				this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
				const t = 1 - this.life[i] / this.maxLife[i];
				this.size[i] = Math.max(0, this.size0[i] * (1 + this.grow[i] * t));
				this.col[i * 4 + 3] = this.alpha0[i] * (t < 0.1 ? t / 0.1 : 1 - Math.max(0, (t - 0.6) / 0.4));
			}
			this.active = alive;
			(this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
			(this.geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
			(this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
		}
		let dirty = false;
		for (let i = 0; i < MAX_DEBRIS; i++) {
			if (this.dLife[i] <= 0) continue;
			dirty = true;
			this.dLife[i] -= dt;
			const i3 = i * 3;
			this.dVel[i3 + 1] -= 26 * dt;
			this.dPos[i3] += this.dVel[i3] * dt;
			this.dPos[i3 + 1] += this.dVel[i3 + 1] * dt;
			this.dPos[i3 + 2] += this.dVel[i3 + 2] * dt;
			const ground = this.terrain.heightAt(this.dPos[i3], this.dPos[i3 + 2]) + 0.15;
			if (this.dPos[i3 + 1] < ground) {
				this.dPos[i3 + 1] = ground;
				this.dVel[i3 + 1] = Math.abs(this.dVel[i3 + 1]) * 0.35;
				this.dVel[i3] *= 0.6;
				this.dVel[i3 + 2] *= 0.6;
				this.dSpin[i3] *= 0.6;
				this.dSpin[i3 + 2] *= 0.6;
			}
			for (let k = 0; k < 3; k++) this.dRot[i3 + k] += this.dSpin[i3 + k] * dt;
			const sc = this.dLife[i] <= 0 ? 0 : this.dScale[i] * Math.min(1, this.dLife[i] * 2);
			this.e.set(this.dRot[i3], this.dRot[i3 + 1], this.dRot[i3 + 2]);
			this.q.setFromEuler(this.e);
			this.v.set(this.dPos[i3], this.dPos[i3 + 1], this.dPos[i3 + 2]);
			this.s.setScalar(sc);
			this.debris.setMatrixAt(i, this.m.compose(this.v, this.q, this.s));
		}
		if (dirty) this.debris.instanceMatrix.needsUpdate = true;
	}

	dispose(): void {
		this.geo.dispose();
		this.mat.dispose();
		this.debris.geometry.dispose();
		(this.debris.material as THREE.Material).dispose();
	}
}
