import * as THREE from 'three';
import type { Terrain } from '../world/Terrain';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _dir = new THREE.Vector3();
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);

// ------------------------------------------------------------------ lights

interface LightSlot {
	light: THREE.PointLight;
	life: number;
	maxLife: number;
	peak: number;
	/** Held by a persistent owner (projectile) until released. */
	held: boolean;
	priority: number;
}

/**
 * A fixed number of point lights (constant count avoids shader recompiles). Short flashes
 * and projectiles borrow them; when all are busy the weakest is stolen.
 */
export class LightPool {
	readonly slots: LightSlot[] = [];

	constructor(scene: THREE.Scene, count: number) {
		for (let i = 0; i < count; i++) {
			const light = new THREE.PointLight(0xffffff, 0, 14, 2);
			light.castShadow = false;
			scene.add(light);
			this.slots.push({ light, life: 0, maxLife: 1, peak: 0, held: false, priority: 0 });
		}
	}

	private pick(priority: number): LightSlot | null {
		let best: LightSlot | null = null;
		for (const s of this.slots) {
			if (!s.held && s.life <= 0) return s;
			if (!best || s.priority < best.priority) best = s;
		}
		return best && best.priority <= priority ? best : null;
	}

	flash(pos: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, distance: number, duration: number, priority = 1): void {
		const s = this.pick(priority);
		if (!s) return;
		s.held = false;
		s.light.position.copy(pos);
		s.light.color.set(color);
		s.light.distance = distance;
		s.peak = intensity;
		s.light.intensity = intensity;
		s.life = duration;
		s.maxLife = duration;
		s.priority = priority;
	}

	hold(color: THREE.ColorRepresentation, intensity: number, distance: number, priority = 0.5): LightSlot | null {
		const s = this.pick(priority);
		if (!s) return null;
		s.held = true;
		s.light.color.set(color);
		s.light.intensity = intensity;
		s.light.distance = distance;
		s.priority = priority;
		s.life = 1;
		return s;
	}

	release(s: LightSlot | null): void {
		if (!s) return;
		s.held = false;
		s.life = 0;
		s.light.intensity = 0;
		s.priority = 0;
	}

	update(dt: number): void {
		for (const s of this.slots) {
			if (s.held) continue;
			if (s.life > 0) {
				s.life -= dt;
				const t = Math.max(0, s.life / s.maxLife);
				s.light.intensity = s.peak * t * t;
				if (s.life <= 0) {
					s.light.intensity = 0;
					s.priority = 0;
				}
			}
		}
	}
}

// ------------------------------------------------------------------ generic timed pool

interface Timed {
	mesh: THREE.Mesh;
	mat: THREE.ShaderMaterial;
	life: number;
	maxLife: number;
	active: boolean;
}

abstract class MeshPool<T extends Timed> {
	readonly items: T[] = [];
	private next = 0;
	protected acquire(): T {
		for (let k = 0; k < this.items.length; k++) {
			const it = this.items[(this.next + k) % this.items.length];
			if (!it.active) {
				this.next = (this.next + k + 1) % this.items.length;
				return it;
			}
		}
		// All busy: recycle the oldest-ish.
		const it = this.items[this.next];
		this.next = (this.next + 1) % this.items.length;
		return it;
	}
	clear(): void {
		for (const it of this.items) {
			it.active = false;
			it.mesh.visible = false;
		}
	}
	dispose(): void {
		for (const it of this.items) {
			it.mesh.geometry.dispose();
			it.mat.dispose();
		}
	}
}

// ------------------------------------------------------------------ shockwave rings

interface Ring extends Timed {
	r0: number;
	r1: number;
	alpha: number;
}

const RING_FRAG = /* glsl */ `
	uniform vec3 uColor;
	uniform float uAlpha;
	uniform float uThick;
	varying vec2 vUv;
	void main() {
		float r = length(vUv * 2.0 - 1.0);
		float inner = 1.0 - uThick;
		float band = smoothstep(inner - 0.02, inner + uThick * 0.5, r) * (1.0 - smoothstep(1.0 - uThick * 0.25, 1.0, r));
		float a = band * uAlpha;
		if (a < 0.003) discard;
		gl_FragColor = vec4(uColor * a, a);
	}
`;

const SIMPLE_VERT = /* glsl */ `
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

function additiveMat(frag: string, uniforms: Record<string, THREE.IUniform>, vert = SIMPLE_VERT): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms,
		vertexShader: vert,
		fragmentShader: frag,
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide,
		blending: THREE.CustomBlending,
		blendSrc: THREE.OneFactor,
		blendDst: THREE.OneFactor
	});
}

export class RingPool extends MeshPool<Ring> {
	constructor(scene: THREE.Scene, count: number) {
		super();
		const geo = new THREE.PlaneGeometry(2, 2);
		for (let i = 0; i < count; i++) {
			const mat = additiveMat(RING_FRAG, { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uThick: { value: 0.2 } });
			const mesh = new THREE.Mesh(i === 0 ? geo : geo.clone(), mat);
			mesh.visible = false;
			mesh.frustumCulled = false;
			mesh.renderOrder = 18;
			scene.add(mesh);
			this.items.push({ mesh, mat, life: 0, maxLife: 1, active: false, r0: 0, r1: 1, alpha: 1 });
		}
	}

	/** Expanding ring. `normal` orients the ring plane (default: lying on the ground). */
	spawn(pos: THREE.Vector3, color: THREE.ColorRepresentation, r0: number, r1: number, duration: number, opts: { normal?: THREE.Vector3; thick?: number; intensity?: number; alpha?: number } = {}): void {
		const it = this.acquire();
		it.active = true;
		it.life = duration;
		it.maxLife = duration;
		it.r0 = r0;
		it.r1 = r1;
		it.alpha = opts.alpha ?? 1;
		it.mesh.visible = true;
		it.mesh.position.copy(pos);
		_q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), opts.normal ?? UP);
		it.mesh.quaternion.copy(_q);
		(it.mat.uniforms.uColor.value as THREE.Color).set(color).multiplyScalar(opts.intensity ?? 2.5);
		it.mat.uniforms.uThick.value = opts.thick ?? 0.18;
		it.mesh.scale.setScalar(r0);
	}

	update(dt: number): void {
		for (const it of this.items) {
			if (!it.active) continue;
			it.life -= dt;
			if (it.life <= 0) {
				it.active = false;
				it.mesh.visible = false;
				continue;
			}
			const t = 1 - it.life / it.maxLife;
			const e = 1 - Math.pow(1 - t, 3);
			it.mesh.scale.setScalar(it.r0 + (it.r1 - it.r0) * e);
			it.mat.uniforms.uAlpha.value = it.alpha * (1 - t) * (t < 0.1 ? t / 0.1 : 1);
		}
	}
}

// ------------------------------------------------------------------ magic circles

interface Circle extends Timed {
	spin: number;
	radius: number;
	fadeIn: number;
	follow: THREE.Vector3 | null;
	offsetY: number;
	alpha: number;
	ground: boolean;
}

const CIRCLE_FRAG = /* glsl */ `
	uniform sampler2D uMap;
	uniform vec3 uColor;
	uniform float uAlpha;
	varying vec2 vUv;
	void main() {
		float m = texture2D(uMap, vUv).a;
		float a = m * uAlpha;
		if (a < 0.003) discard;
		gl_FragColor = vec4(uColor * a, a);
	}
`;

export class CirclePool extends MeshPool<Circle> {
	constructor(scene: THREE.Scene, count: number, map: THREE.Texture) {
		super();
		const geo = new THREE.PlaneGeometry(2, 2);
		geo.rotateX(-Math.PI / 2);
		for (let i = 0; i < count; i++) {
			const mat = additiveMat(CIRCLE_FRAG, { uMap: { value: map }, uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } });
			const mesh = new THREE.Mesh(geo, mat);
			mesh.visible = false;
			mesh.frustumCulled = false;
			mesh.renderOrder = 17;
			scene.add(mesh);
			this.items.push({ mesh, mat, life: 0, maxLife: 1, active: false, spin: 1, radius: 1, fadeIn: 0.15, follow: null, offsetY: 0, alpha: 1, ground: true });
		}
	}

	/** Spawns a rotating rune circle; returns its index so callers can end it early. */
	spawn(
		pos: THREE.Vector3,
		radius: number,
		color: THREE.ColorRepresentation,
		duration: number,
		opts: { spin?: number; follow?: THREE.Vector3; offsetY?: number; intensity?: number; normal?: THREE.Vector3; fadeIn?: number; alpha?: number } = {}
	): number {
		const it = this.acquire();
		it.active = true;
		it.life = duration;
		it.maxLife = duration;
		it.spin = opts.spin ?? 1.2;
		it.radius = radius;
		it.fadeIn = opts.fadeIn ?? 0.15;
		it.follow = opts.follow ?? null;
		it.offsetY = opts.offsetY ?? 0.06;
		it.alpha = opts.alpha ?? 1;
		it.ground = !opts.normal;
		it.mesh.visible = true;
		it.mesh.position.copy(pos);
		it.mesh.position.y += it.offsetY;
		if (opts.normal) {
			_q.setFromUnitVectors(UP, opts.normal);
			it.mesh.quaternion.copy(_q);
		} else it.mesh.quaternion.identity();
		it.mesh.scale.setScalar(radius * 0.4);
		(it.mat.uniforms.uColor.value as THREE.Color).set(color).multiplyScalar(opts.intensity ?? 2.2);
		return this.items.indexOf(it);
	}

	end(index: number, fade = 0.2): void {
		const it = this.items[index];
		if (!it || !it.active) return;
		it.life = Math.min(it.life, fade);
		it.maxLife = Math.max(it.maxLife, fade);
	}

	update(dt: number): void {
		for (const it of this.items) {
			if (!it.active) continue;
			it.life -= dt;
			if (it.life <= 0) {
				it.active = false;
				it.mesh.visible = false;
				continue;
			}
			const age = it.maxLife - it.life;
			const inK = Math.min(1, age / it.fadeIn);
			const outK = Math.min(1, it.life / 0.25);
			const ease = 1 - Math.pow(1 - inK, 3);
			it.mesh.scale.setScalar(it.radius * (0.4 + 0.6 * ease));
			if (it.ground) it.mesh.rotation.y += it.spin * dt;
			else it.mesh.rotateY(it.spin * dt);
			if (it.follow) {
				it.mesh.position.copy(it.follow);
				it.mesh.position.y += it.offsetY;
			}
			it.mat.uniforms.uAlpha.value = it.alpha * inK * outK;
		}
	}
}

// ------------------------------------------------------------------ telegraphs

export type TelegraphShape = 'circle' | 'cone' | 'line' | 'ring';

interface Telegraph extends Timed {
	duration: number;
	hold: number;
	shape: TelegraphShape;
	size: number;
	length: number;
	floorY: number | undefined;
}

const TELE_VERT = /* glsl */ `
	attribute vec2 aLocal;
	varying vec2 vLocal;
	void main() {
		vLocal = aLocal;
		gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
	}
`;

const TELE_FRAG = /* glsl */ `
	uniform vec3 uColor;
	uniform float uProgress;
	uniform float uAlpha;
	uniform float uShape;
	uniform float uAngle;
	uniform float uInner;
	uniform float uTime;
	varying vec2 vLocal;
	void main() {
		float r = length(vLocal);
		float inside;
		float edge;
		float fill;
		if (uShape < 0.5) {
			inside = step(r, 1.0);
			edge = smoothstep(0.88, 0.97, r) * inside;
			fill = step(r, uProgress);
		} else if (uShape < 1.5) {
			float ang = abs(atan(vLocal.x, vLocal.y));
			inside = step(r, 1.0) * step(ang, uAngle);
			edge = max(smoothstep(0.9, 0.98, r), smoothstep(uAngle - 0.06, uAngle, ang)) * inside;
			fill = step(r, uProgress);
		} else if (uShape < 2.5) {
			inside = step(abs(vLocal.x), 1.0) * step(0.0, vLocal.y) * step(vLocal.y, 1.0);
			edge = max(smoothstep(0.82, 0.98, abs(vLocal.x)), smoothstep(0.97, 1.0, vLocal.y)) * inside;
			fill = step(vLocal.y, uProgress);
		} else {
			inside = step(r, 1.0) * step(uInner, r);
			edge = (smoothstep(0.92, 0.99, r) + (1.0 - smoothstep(uInner, uInner + 0.04, r))) * inside;
			fill = step(r, uInner + (1.0 - uInner) * uProgress);
		}
		float stripes = 0.5 + 0.5 * sin((vLocal.x + vLocal.y) * 18.0 - uTime * 6.0);
		float a = inside * (0.12 + fill * (0.28 + stripes * 0.08) + edge * 0.85) * uAlpha;
		if (a < 0.003) discard;
		gl_FragColor = vec4(uColor * a, a);
	}
`;

const TELE_SEG = 20;

/**
 * Ground decals that warn about incoming attacks. Vertices are draped over the terrain when
 * placed; the fill grows with the wind-up so the moment of impact is readable.
 */
export class TelegraphPool extends MeshPool<Telegraph> {
	private time = 0;

	constructor(
		scene: THREE.Scene,
		count: number,
		private terrain: Terrain
	) {
		super();
		for (let i = 0; i < count; i++) {
			const geo = new THREE.PlaneGeometry(2, 2, TELE_SEG, TELE_SEG);
			const local = new Float32Array(geo.attributes.position.count * 2);
			geo.setAttribute('aLocal', new THREE.BufferAttribute(local, 2));
			geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
			const mat = additiveMat(
				TELE_FRAG,
				{
					uColor: { value: new THREE.Color() },
					uProgress: { value: 0 },
					uAlpha: { value: 0 },
					uShape: { value: 0 },
					uAngle: { value: 0.5 },
					uInner: { value: 0.5 },
					uTime: { value: 0 }
				},
				TELE_VERT
			);
			mat.polygonOffset = true;
			mat.polygonOffsetFactor = -2;
			mat.polygonOffsetUnits = -4;
			const mesh = new THREE.Mesh(geo, mat);
			mesh.visible = false;
			mesh.frustumCulled = false;
			mesh.renderOrder = 16;
			scene.add(mesh);
			this.items.push({ mesh, mat, life: 0, maxLife: 1, active: false, duration: 1, hold: 0.15, shape: 'circle', size: 1, length: 1, floorY: undefined });
		}
	}

	/**
	 * @param yaw facing (cone/line point along +Z rotated by yaw)
	 * @param size radius (circle/cone/ring) or half-width (line)
	 * @param length line length
	 * @param floorY when set, drape onto a flat floor instead of the terrain
	 */
	spawn(
		shape: TelegraphShape,
		x: number,
		z: number,
		yaw: number,
		size: number,
		duration: number,
		color: THREE.ColorRepresentation,
		opts: { length?: number; angle?: number; inner?: number; floorY?: number; hold?: number } = {}
	): number {
		const it = this.acquire();
		it.active = true;
		it.duration = duration;
		it.hold = opts.hold ?? 0.18;
		it.life = duration + it.hold;
		it.maxLife = it.life;
		it.mesh.visible = true;
		const u = it.mat.uniforms;
		u.uShape.value = shape === 'circle' ? 0 : shape === 'cone' ? 1 : shape === 'line' ? 2 : 3;
		u.uAngle.value = opts.angle ?? 0.6;
		u.uInner.value = opts.inner ?? 0.6;
		(u.uColor.value as THREE.Color).set(color).multiplyScalar(1.6);
		it.shape = shape;
		it.size = size;
		it.length = opts.length ?? size;
		it.floorY = opts.floorY;
		this.drape(it, x, z, yaw);
		return this.items.indexOf(it);
	}

	/** Re-aim a live telegraph (tracking attacks) without resetting its fill. */
	reposition(index: number, x: number, z: number, yaw: number): void {
		const it = this.items[index];
		if (it && it.active) this.drape(it, x, z, yaw);
	}

	/** Lays the decal's vertices over the terrain (or a flat floor) around (x, z). */
	private drape(it: Telegraph, x: number, z: number, yaw: number): void {
		const geo = it.mesh.geometry;
		const pos = geo.attributes.position as THREE.BufferAttribute;
		const loc = geo.attributes.aLocal as THREE.BufferAttribute;
		const c = Math.cos(yaw);
		const s = Math.sin(yaw);
		const n = TELE_SEG + 1;
		for (let j = 0; j < n; j++) {
			for (let i = 0; i < n; i++) {
				const idx = j * n + i;
				const lx = (i / TELE_SEG) * 2 - 1;
				let ly = (j / TELE_SEG) * 2 - 1;
				let wx: number;
				let wz: number;
				if (it.shape === 'line') {
					ly = (ly + 1) / 2;
					wx = lx * it.size;
					wz = ly * it.length;
				} else {
					wx = lx * it.size;
					wz = ly * it.size;
				}
				// Rotate local (x, z) by yaw (local +Z = facing).
				const gx = x + wx * c + wz * s;
				const gz = z - wx * s + wz * c;
				const gy = (it.floorY ?? this.terrain.heightAt(gx, gz)) + 0.12;
				pos.setXYZ(idx, gx, gy, gz);
				loc.setXY(idx, lx, ly);
			}
		}
		pos.needsUpdate = true;
		loc.needsUpdate = true;
	}

	cancel(index: number): void {
		const it = this.items[index];
		if (!it) return;
		it.active = false;
		it.mesh.visible = false;
	}

	update(dt: number): void {
		this.time += dt;
		for (const it of this.items) {
			if (!it.active) continue;
			it.life -= dt;
			if (it.life <= 0) {
				it.active = false;
				it.mesh.visible = false;
				continue;
			}
			const age = it.maxLife - it.life;
			const u = it.mat.uniforms;
			u.uProgress.value = Math.min(1, age / it.duration);
			u.uTime.value = this.time;
			const flash = age > it.duration ? 1.6 : 1;
			u.uAlpha.value = Math.min(1, age / 0.12) * flash * (age > it.duration ? it.life / it.hold : 1);
		}
	}
}

// ------------------------------------------------------------------ lightning arcs

interface Arc extends Timed {
	a: THREE.Vector3;
	b: THREE.Vector3;
	width: number;
	jag: number;
	regen: number;
	pts: THREE.Vector3[];
	follow: (() => void) | null;
}

const ARC_PTS = 18;

const ARC_FRAG = /* glsl */ `
	uniform vec3 uColor;
	uniform float uAlpha;
	varying vec2 vUv;
	void main() {
		float d = abs(vUv.y - 0.5) * 2.0;
		float core = 1.0 - smoothstep(0.0, 0.25, d);
		float glow = 1.0 - smoothstep(0.0, 1.0, d);
		vec3 col = uColor * glow * 1.2 + vec3(1.0) * core * 2.5;
		float a = (glow * 0.7 + core) * uAlpha;
		if (a < 0.003) discard;
		gl_FragColor = vec4(col * uAlpha, a);
	}
`;

/** Jagged, flickering camera-facing ribbons for lightning and chain effects. */
export class ArcPool extends MeshPool<Arc> {
	constructor(
		scene: THREE.Scene,
		count: number,
		private camera: THREE.Camera
	) {
		super();
		for (let i = 0; i < count; i++) {
			const geo = new THREE.BufferGeometry();
			const pos = new Float32Array(ARC_PTS * 2 * 3);
			const uv = new Float32Array(ARC_PTS * 2 * 2);
			const idx: number[] = [];
			for (let k = 0; k < ARC_PTS; k++) {
				uv[k * 4] = k / (ARC_PTS - 1);
				uv[k * 4 + 1] = 0;
				uv[k * 4 + 2] = k / (ARC_PTS - 1);
				uv[k * 4 + 3] = 1;
				if (k > 0) {
					const b = (k - 1) * 2;
					idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
				}
			}
			geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
			geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
			geo.setIndex(idx);
			geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
			const mat = additiveMat(ARC_FRAG, { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 } });
			const mesh = new THREE.Mesh(geo, mat);
			mesh.visible = false;
			mesh.frustumCulled = false;
			mesh.renderOrder = 19;
			scene.add(mesh);
			const pts: THREE.Vector3[] = [];
			for (let k = 0; k < ARC_PTS; k++) pts.push(new THREE.Vector3());
			this.items.push({ mesh, mat, life: 0, maxLife: 1, active: false, a: new THREE.Vector3(), b: new THREE.Vector3(), width: 0.3, jag: 0.6, regen: 0, pts, follow: null });
		}
	}

	spawn(a: THREE.Vector3, b: THREE.Vector3, color: THREE.ColorRepresentation, duration: number, width = 0.35, jag = 0.8): number {
		const it = this.acquire();
		it.active = true;
		it.life = duration;
		it.maxLife = duration;
		it.a.copy(a);
		it.b.copy(b);
		it.width = width;
		it.jag = jag;
		it.regen = 0;
		it.follow = null;
		it.mesh.visible = true;
		(it.mat.uniforms.uColor.value as THREE.Color).set(color).multiplyScalar(2.2);
		this.build(it);
		return this.items.indexOf(it);
	}

	/** Update endpoints of a live arc (for channels and arcs tied to moving targets). */
	move(index: number, a: THREE.Vector3, b: THREE.Vector3, extend = 0): void {
		const it = this.items[index];
		if (!it || !it.active) return;
		it.a.copy(a);
		it.b.copy(b);
		if (extend > 0) {
			it.life = Math.max(it.life, extend);
			it.maxLife = Math.max(it.maxLife, it.life);
		}
	}

	private build(it: Arc): void {
		const pts = it.pts;
		const n = ARC_PTS;
		const len = it.a.distanceTo(it.b);
		_v.subVectors(it.b, it.a);
		// Perpendicular basis for displacement.
		const dir = _dir.copy(_v).normalize();
		const p1 = _p1.crossVectors(dir, Math.abs(dir.y) > 0.9 ? RIGHT : UP).normalize();
		const p2 = _p2.crossVectors(dir, p1);
		for (let k = 0; k < n; k++) {
			const t = k / (n - 1);
			const env = Math.sin(t * Math.PI);
			const amp = it.jag * Math.min(1, len / 6) * env;
			pts[k].copy(it.a).addScaledVector(_v, t);
			if (k > 0 && k < n - 1) {
				pts[k].addScaledVector(p1, (Math.random() - 0.5) * 2 * amp);
				pts[k].addScaledVector(p2, (Math.random() - 0.5) * 2 * amp);
			}
		}
		this.writeRibbon(it);
	}

	private writeRibbon(it: Arc): void {
		const pos = it.mesh.geometry.attributes.position as THREE.BufferAttribute;
		const cam = this.camera.position;
		const pts = it.pts;
		for (let k = 0; k < ARC_PTS; k++) {
			const prev = pts[Math.max(0, k - 1)];
			const next = pts[Math.min(ARC_PTS - 1, k + 1)];
			_v.subVectors(next, prev).normalize();
			_v2.subVectors(cam, pts[k]).normalize();
			_s.crossVectors(_v, _v2).normalize().multiplyScalar(it.width * 0.5);
			pos.setXYZ(k * 2, pts[k].x - _s.x, pts[k].y - _s.y, pts[k].z - _s.z);
			pos.setXYZ(k * 2 + 1, pts[k].x + _s.x, pts[k].y + _s.y, pts[k].z + _s.z);
		}
		pos.needsUpdate = true;
	}

	update(dt: number): void {
		for (const it of this.items) {
			if (!it.active) continue;
			it.life -= dt;
			if (it.life <= 0) {
				it.active = false;
				it.mesh.visible = false;
				continue;
			}
			it.regen -= dt;
			if (it.regen <= 0) {
				it.regen = 0.045;
				this.build(it);
			} else this.writeRibbon(it);
			const t = it.life / it.maxLife;
			it.mat.uniforms.uAlpha.value = Math.min(1, t * 3) * (0.75 + Math.random() * 0.25);
		}
	}
}

// ------------------------------------------------------------------ beams

const BEAM_FRAG = /* glsl */ `
	uniform vec3 uColor;
	uniform float uAlpha;
	uniform float uTime;
	varying vec2 vUv;
	void main() {
		float around = abs(vUv.x - 0.5) * 2.0;
		float core = 1.0 - smoothstep(0.0, 0.5, abs(sin(vUv.x * 3.14159 * 2.0)));
		float flow = 0.6 + 0.4 * sin(vUv.y * 60.0 - uTime * 30.0);
		float a = (0.35 + core * 0.65) * flow * uAlpha;
		gl_FragColor = vec4((uColor * (1.0 + flow) + vec3(core) * 1.5) * a, a);
	}
`;

export interface Beam {
	mesh: THREE.Mesh;
	mat: THREE.ShaderMaterial;
	active: boolean;
}

/** Cylinder beams that are re-aimed every frame (channelled ray, boss prism beam). */
export class BeamPool {
	readonly beams: Beam[] = [];
	private time = 0;

	constructor(scene: THREE.Scene, count: number) {
		const geo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
		geo.translate(0, 0.5, 0);
		for (let i = 0; i < count; i++) {
			const mat = additiveMat(BEAM_FRAG, { uColor: { value: new THREE.Color() }, uAlpha: { value: 0 }, uTime: { value: 0 } });
			const mesh = new THREE.Mesh(geo, mat);
			mesh.visible = false;
			mesh.frustumCulled = false;
			mesh.renderOrder = 19;
			scene.add(mesh);
			this.beams.push({ mesh, mat, active: false });
		}
	}

	acquire(color: THREE.ColorRepresentation): Beam | null {
		const b = this.beams.find((x) => !x.active);
		if (!b) return null;
		b.active = true;
		b.mesh.visible = true;
		(b.mat.uniforms.uColor.value as THREE.Color).set(color).multiplyScalar(2);
		b.mat.uniforms.uAlpha.value = 1;
		return b;
	}

	aim(b: Beam, from: THREE.Vector3, to: THREE.Vector3, radius: number, alpha = 1): void {
		_v.subVectors(to, from);
		const len = _v.length();
		b.mesh.position.copy(from);
		_q.setFromUnitVectors(UP, _v.normalize());
		b.mesh.quaternion.copy(_q);
		b.mesh.scale.set(radius, len, radius);
		b.mat.uniforms.uAlpha.value = alpha;
	}

	release(b: Beam | null): void {
		if (!b) return;
		b.active = false;
		b.mesh.visible = false;
	}

	update(dt: number): void {
		this.time += dt;
		for (const b of this.beams) if (b.active) b.mat.uniforms.uTime.value = this.time;
	}

	dispose(): void {
		this.beams[0]?.mesh.geometry.dispose();
		for (const b of this.beams) b.mat.dispose();
	}
}

// ------------------------------------------------------------------ crystal spikes

interface Spike {
	x: number;
	y: number;
	z: number;
	scale: number;
	tilt: number;
	yaw: number;
	life: number;
	maxLife: number;
	delay: number;
	active: boolean;
}

/** Instanced ice/crystal spikes that erupt from the ground, hold, then sink. */
export class SpikePool {
	readonly mesh: THREE.InstancedMesh;
	private spikes: Spike[] = [];
	private color = new THREE.Color();
	private dirty = false;

	constructor(scene: THREE.Scene, count: number) {
		const geo = new THREE.OctahedronGeometry(1, 0);
		geo.scale(0.35, 1.6, 0.35);
		geo.translate(0, 1.0, 0);
		const mat = new THREE.MeshStandardMaterial({ roughness: 0.15, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.92 });
		mat.onBeforeCompile = (shader) => {
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <emissivemap_fragment>',
				'#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance += vColor.rgb * 0.9;\n#endif'
			);
		};
		this.mesh = new THREE.InstancedMesh(geo, mat, count);
		this.mesh.frustumCulled = false;
		this.mesh.castShadow = false;
		for (let i = 0; i < count; i++) {
			this.spikes.push({ x: 0, y: 0, z: 0, scale: 1, tilt: 0, yaw: 0, life: 0, maxLife: 1, delay: 0, active: false });
			this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
			this.mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
		}
		this.mesh.count = count;
		scene.add(this.mesh);
	}

	spawn(x: number, y: number, z: number, scale: number, color: THREE.ColorRepresentation, duration: number, delay = 0, tilt = 0.25): void {
		let idx = this.spikes.findIndex((s) => !s.active);
		if (idx < 0) idx = Math.floor(Math.random() * this.spikes.length);
		const s = this.spikes[idx];
		s.active = true;
		s.x = x;
		s.y = y;
		s.z = z;
		s.scale = scale;
		s.tilt = (Math.random() - 0.5) * tilt * 2;
		s.yaw = Math.random() * Math.PI * 2;
		s.life = duration;
		s.maxLife = duration;
		s.delay = delay;
		this.mesh.setColorAt(idx, this.color.set(color));
		if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
	}

	update(dt: number): void {
		let any = false;
		for (let i = 0; i < this.spikes.length; i++) {
			const s = this.spikes[i];
			if (!s.active) continue;
			any = true;
			if (s.delay > 0) {
				s.delay -= dt;
				this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
				continue;
			}
			s.life -= dt;
			if (s.life <= 0) {
				s.active = false;
				this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
				continue;
			}
			const age = s.maxLife - s.life;
			const grow = Math.min(1, age / 0.1);
			const sink = Math.min(1, s.life / 0.35);
			const k = s.scale * (1 - Math.pow(1 - grow, 3)) * sink;
			_q.setFromEuler(_e.set(s.tilt, s.yaw, s.tilt * 0.5));
			_v.set(s.x, s.y - (1 - sink) * s.scale * 1.5, s.z);
			_s.set(k, k, k);
			this.mesh.setMatrixAt(i, _m.compose(_v, _q, _s));
		}
		if (any || this.dirty) {
			this.mesh.instanceMatrix.needsUpdate = true;
			this.dirty = any;
		}
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		(this.mesh.material as THREE.Material).dispose();
	}
}

// ------------------------------------------------------------------ shield bubble

const SHIELD_VERT = /* glsl */ `
	varying vec3 vN;
	varying vec3 vView;
	varying vec3 vLocal;
	void main() {
		vLocal = position;
		vec4 wp = modelMatrix * vec4(position, 1.0);
		vN = normalize(mat3(modelMatrix) * normal);
		vView = normalize(cameraPosition - wp.xyz);
		gl_Position = projectionMatrix * viewMatrix * wp;
	}
`;

const SHIELD_FRAG = /* glsl */ `
	uniform vec3 uColor;
	uniform float uAlpha;
	uniform float uTime;
	uniform float uHit;
	varying vec3 vN;
	varying vec3 vView;
	varying vec3 vLocal;
	void main() {
		float fres = pow(1.0 - abs(dot(vN, vView)), 2.2);
		// Hexagon-ish lattice from three sine waves.
		vec3 p = vLocal * 7.0;
		float h = abs(sin(p.x + p.y * 0.5)) * abs(sin(p.y - p.z * 0.5)) * abs(sin(p.z + p.x * 0.5));
		float lattice = smoothstep(0.08, 0.0, h) * 0.8;
		float scan = 0.5 + 0.5 * sin(vLocal.y * 10.0 - uTime * 4.0);
		float a = (fres * 0.9 + lattice * (0.35 + scan * 0.3) + 0.04 + uHit * 0.5) * uAlpha;
		gl_FragColor = vec4(uColor * a * (1.0 + uHit * 2.0), a);
	}
`;

export class ShieldBubble {
	readonly mesh: THREE.Mesh;
	private mat: THREE.ShaderMaterial;
	private alpha = 0;
	private target = 0;
	private hit = 0;
	private time = 0;

	constructor(scene: THREE.Scene) {
		this.mat = new THREE.ShaderMaterial({
			uniforms: { uColor: { value: new THREE.Color(0x7ad8ff).multiplyScalar(1.8) }, uAlpha: { value: 0 }, uTime: { value: 0 }, uHit: { value: 0 } },
			vertexShader: SHIELD_VERT,
			fragmentShader: SHIELD_FRAG,
			transparent: true,
			depthWrite: false,
			blending: THREE.CustomBlending,
			blendSrc: THREE.OneFactor,
			blendDst: THREE.OneFactor
		});
		this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 4), this.mat);
		this.mesh.visible = false;
		this.mesh.renderOrder = 21;
		scene.add(this.mesh);
	}

	set(on: boolean, color?: THREE.ColorRepresentation): void {
		this.target = on ? 1 : 0;
		if (color !== undefined) (this.mat.uniforms.uColor.value as THREE.Color).set(color).multiplyScalar(1.8);
	}

	flashHit(): void {
		this.hit = 1;
	}

	update(dt: number, center: THREE.Vector3): void {
		this.time += dt;
		this.alpha += (this.target - this.alpha) * (1 - Math.exp(-14 * dt));
		this.hit = Math.max(0, this.hit - dt * 4);
		this.mesh.visible = this.alpha > 0.01;
		if (!this.mesh.visible) return;
		this.mesh.position.copy(center);
		this.mesh.scale.setScalar(0.85 + this.alpha * 0.15 + this.hit * 0.08);
		this.mat.uniforms.uAlpha.value = this.alpha;
		this.mat.uniforms.uTime.value = this.time;
		this.mat.uniforms.uHit.value = this.hit;
	}

	dispose(): void {
		this.mesh.geometry.dispose();
		this.mat.dispose();
	}
}
