import * as THREE from 'three';
import type { EnemyKind } from './EnemyTypes';
import { blob } from '../utils/geometry';
import { clamp, damp, lerp } from '../utils/math';

export type EnemyAnimPhase = 'idle' | 'move' | 'alert' | 'windup' | 'active' | 'recover' | 'stagger' | 'evade' | 'dead' | 'cast';

export interface EnemyAnimState {
	speed: number;
	phase: EnemyAnimPhase;
	/** 0..1 progress through the current phase. */
	t: number;
	attackId: string;
	frozen: boolean;
	stunned: boolean;
	burning: boolean;
	shocked: boolean;
	wet: boolean;
	barrier: boolean;
	exposed: boolean;
}

export interface EnemyVisual {
	readonly root: THREE.Group;
	update(dt: number, s: EnemyAnimState): void;
	flash(amount: number): void;
	/** 0..1 attack wind-up glow. */
	telegraph(amount: number): void;
	handPosition(out: THREE.Vector3): THREE.Vector3;
	dissolve(t: number): void;
	dispose(): void;
}

const _c = new THREE.Color();
const ICE = new THREE.Color(0xbfefff);

/** Shared geometry/material helpers for enemy rigs. */
abstract class RigBase implements EnemyVisual {
	readonly root = new THREE.Group();
	protected body = new THREE.Group();
	protected geos: THREE.BufferGeometry[] = [];
	protected mats: THREE.MeshStandardMaterial[] = [];
	protected skinMats: THREE.MeshStandardMaterial[] = [];
	protected glowMats: THREE.MeshStandardMaterial[] = [];
	protected baseColors = new Map<THREE.MeshStandardMaterial, THREE.Color>();
	protected baseEmissive = new Map<THREE.MeshStandardMaterial, THREE.Color>();
	protected time = Math.random() * 10;
	protected flashAmt = 0;
	protected tele = 0;
	protected glowBase = 2;
	private barrierMesh: THREE.Mesh | null = null;

	constructor() {
		this.root.add(this.body);
	}

	protected mat(p: THREE.MeshStandardMaterialParameters, skin = true): THREE.MeshStandardMaterial {
		const m = new THREE.MeshStandardMaterial(p);
		this.mats.push(m);
		if (skin) this.skinMats.push(m);
		this.baseColors.set(m, m.color.clone());
		this.baseEmissive.set(m, m.emissive.clone());
		return m;
	}

	protected glow(color: number, intensity = 2): THREE.MeshStandardMaterial {
		const m = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
		this.mats.push(m);
		this.glowMats.push(m);
		return m;
	}

	protected mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Mesh {
		this.geos.push(geo);
		const m = new THREE.Mesh(geo, mat);
		m.position.set(x, y, z);
		m.rotation.set(rx, ry, rz);
		m.scale.set(sx, sy, sz);
		m.castShadow = true;
		parent.add(m);
		return m;
	}

	protected group(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
		const g = new THREE.Group();
		g.position.set(x, y, z);
		parent.add(g);
		return g;
	}

	protected barrier(radius: number, y: number): void {
		const mat = new THREE.ShaderMaterial({
			uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
			vertexShader: /* glsl */ `
				varying vec3 vN; varying vec3 vV; varying vec3 vL;
				void main() {
					vL = position;
					vec4 wp = modelMatrix * vec4(position, 1.0);
					vN = normalize(mat3(modelMatrix) * normal);
					vV = normalize(cameraPosition - wp.xyz);
					gl_Position = projectionMatrix * viewMatrix * wp;
				}`,
			fragmentShader: /* glsl */ `
				uniform float uTime; uniform float uAlpha;
				varying vec3 vN; varying vec3 vV; varying vec3 vL;
				void main() {
					float f = pow(1.0 - abs(dot(vN, vV)), 2.0);
					float rune = smoothstep(0.92, 1.0, sin(vL.y * 9.0 + uTime * 3.0) * sin(atan(vL.z, vL.x) * 8.0));
					float a = (f * 0.85 + rune * 0.4 + 0.05) * uAlpha;
					gl_FragColor = vec4(vec3(1.0, 0.25, 0.85) * a * 2.0, a);
				}`,
			transparent: true,
			depthWrite: false,
			blending: THREE.CustomBlending,
			blendSrc: THREE.OneFactor,
			blendDst: THREE.OneFactor
		});
		const geo = new THREE.IcosahedronGeometry(radius, 3);
		this.geos.push(geo);
		this.barrierMesh = new THREE.Mesh(geo, mat);
		this.barrierMesh.position.y = y;
		this.barrierMesh.visible = false;
		this.root.add(this.barrierMesh);
	}

	flash(amount: number): void {
		this.flashAmt = Math.max(this.flashAmt, amount);
	}

	telegraph(amount: number): void {
		this.tele = amount;
	}

	abstract handPosition(out: THREE.Vector3): THREE.Vector3;
	protected abstract animate(dt: number, s: EnemyAnimState): void;

	update(dt: number, s: EnemyAnimState): void {
		const frozen = s.frozen;
		this.time += frozen ? 0 : dt;
		if (!frozen) this.animate(dt, s);
		this.flashAmt = Math.max(0, this.flashAmt - dt * 6);
		const t = this.time;
		for (const m of this.skinMats) {
			const base = this.baseColors.get(m)!;
			const em = this.baseEmissive.get(m)!;
			m.color.copy(base);
			if (frozen) m.color.lerp(ICE, 0.65);
			else if (s.wet) m.color.multiplyScalar(0.7);
			m.emissive.copy(em);
			if (frozen) m.emissive.lerp(_c.setHex(0x3ab8ff), 0.6);
			if (s.burning) m.emissive.add(_c.setRGB(0.9, 0.25, 0.02).multiplyScalar(0.4 + 0.3 * Math.sin(t * 24)));
			if (s.shocked) m.emissive.add(_c.setRGB(0.45, 0.4, 1).multiplyScalar(Math.random() < 0.3 ? 0.9 : 0.1));
			if (this.flashAmt > 0) m.emissive.add(_c.setRGB(1, 1, 1).multiplyScalar(this.flashAmt * 0.8));
			m.roughness = s.wet ? 0.25 : frozen ? 0.15 : 0.8;
		}
		const pulse = 1 + Math.sin(t * 4) * 0.15;
		for (const g of this.glowMats) g.emissiveIntensity = (this.glowBase + this.tele * 6) * pulse * (s.exposed ? 1.8 : 1);
		if (this.barrierMesh) {
			const u = (this.barrierMesh.material as THREE.ShaderMaterial).uniforms;
			u.uAlpha.value = damp(u.uAlpha.value, s.barrier ? 1 : 0, 10, dt);
			u.uTime.value = t;
			this.barrierMesh.visible = u.uAlpha.value > 0.02;
			this.barrierMesh.rotation.y = t * 0.6;
		}
	}

	dissolve(t: number): void {
		const k = clamp(t, 0, 1);
		for (const m of this.mats) {
			m.transparent = true;
			m.opacity = 1 - k;
			m.depthWrite = k < 0.5;
		}
		this.body.scale.setScalar(1 - k * 0.35);
		this.body.position.y = -k * 0.4;
	}

	dispose(): void {
		for (const g of this.geos) g.dispose();
		for (const m of this.mats) m.dispose();
		if (this.barrierMesh) (this.barrierMesh.material as THREE.Material).dispose();
	}
}

// ------------------------------------------------------------------ Forest Wraith

class WraithRig extends RigBase {
	private torso: THREE.Group;
	private head: THREE.Group;
	private armL: THREE.Group;
	private armR: THREE.Group;
	private foreL: THREE.Group;
	private foreR: THREE.Group;
	private tatters: THREE.Mesh[] = [];
	private handR: THREE.Group;

	constructor() {
		super();
		const cloak = this.mat({ color: 0x0f1d1e, emissive: 0x0a3a30, emissiveIntensity: 0.6, roughness: 0.85, side: THREE.DoubleSide });
		const bark = this.mat({ color: 0x2a2018, emissive: 0x000000, roughness: 0.9 });
		const bone = this.mat({ color: 0x9aa89a, roughness: 0.6 });
		const eye = this.glow(0x6affd0, 3);
		const vein = this.glow(0x3affb0, 1.5);
		this.glowBase = 1.8;
		this.torso = this.group(this.body, 0, 1.15, 0);
		// Cloak body: an open cone whose hem breaks into tatters.
		const coneGeo = new THREE.ConeGeometry(0.55, 1.5, 12, 4, true);
		this.mesh(coneGeo, cloak, this.torso, 0, -0.35, 0, Math.PI, 0, 0, 1, 1, 0.8);
		this.mesh(new THREE.SphereGeometry(0.3, 12, 10), cloak, this.torso, 0, 0.3, 0, 0, 0, 0, 1.15, 0.95, 0.9);
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * Math.PI * 2;
			const t = this.mesh(new THREE.ConeGeometry(0.14, 0.7, 4), cloak, this.torso, Math.cos(a) * 0.42, -1.15, Math.sin(a) * 0.36, Math.PI, a, 0);
			this.tatters.push(t);
		}
		// Glowing corruption veins.
		for (let i = 0; i < 5; i++) {
			const a = (i / 5) * Math.PI * 2 + 0.3;
			this.mesh(new THREE.BoxGeometry(0.03, 0.8, 0.02), vein, this.torso, Math.cos(a) * 0.36, -0.3, Math.sin(a) * 0.3, 0.2, a, 0);
		}
		// Bark spikes on the shoulders.
		for (const s of [-1, 1]) {
			for (let i = 0; i < 3; i++) this.mesh(new THREE.ConeGeometry(0.06, 0.45 - i * 0.08, 5), bark, this.torso, s * (0.22 + i * 0.08), 0.42 + i * 0.05, -0.05 - i * 0.05, -0.4, 0, s * (-0.6 - i * 0.2));
		}
		// Hood with an empty dark face and glowing eyes.
		this.head = this.group(this.torso, 0, 0.55, 0.02);
		this.mesh(new THREE.SphereGeometry(0.24, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), cloak, this.head, 0, 0, -0.02, -0.25, 0, 0, 1, 1.15, 1.1);
		this.mesh(new THREE.ConeGeometry(0.15, 0.35, 8), cloak, this.head, 0, 0.22, -0.1, -0.6);
		this.mesh(new THREE.SphereGeometry(0.17, 10, 8), this.mat({ color: 0x020404, roughness: 1 }, false), this.head, 0, -0.03, 0.05);
		for (const s of [-1, 1]) this.mesh(new THREE.SphereGeometry(0.035, 8, 6), eye, this.head, s * 0.07, 0.0, 0.19, 0, 0, 0, 1.4, 0.7, 0.6);
		// Long arms ending in claws.
		const makeArm = (side: number): [THREE.Group, THREE.Group, THREE.Group] => {
			const sh = this.group(this.torso, side * 0.32, 0.32, 0);
			this.mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.55, 6), cloak, sh, 0, -0.27, 0);
			const fore = this.group(sh, 0, -0.55, 0);
			this.mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.55, 6), bone, fore, 0, -0.27, 0);
			const hand = this.group(fore, 0, -0.56, 0);
			for (let f = 0; f < 3; f++) this.mesh(new THREE.ConeGeometry(0.025, 0.38, 4), vein, hand, (f - 1) * 0.05, -0.16, 0.05, 0.35, 0, (f - 1) * 0.2);
			return [sh, fore, hand];
		};
		[this.armL, this.foreL] = makeArm(1);
		let h: THREE.Group;
		[this.armR, this.foreR, h] = makeArm(-1);
		this.handR = h;
	}

	handPosition(out: THREE.Vector3): THREE.Vector3 {
		this.handR.updateWorldMatrix(true, false);
		return out.setFromMatrixPosition(this.handR.matrixWorld);
	}

	protected animate(dt: number, s: EnemyAnimState): void {
		const t = this.time;
		const bob = Math.sin(t * 2.2) * 0.08;
		this.torso.position.y = 1.15 + bob;
		let lean = clamp(s.speed * 0.05, 0, 0.4);
		let armX = -0.3 + Math.sin(t * 1.7) * 0.1;
		let armZ = 0.35;
		let foreX = -0.3;
		let twist = 0;
		switch (s.phase) {
			case 'windup':
				armX = lerp(-0.3, 1.2, s.t);
				armZ = 0.9;
				foreX = -1.2;
				lean = -0.15;
				twist = s.attackId === 'claw2' ? -0.5 * s.t : 0.5 * s.t;
				if (s.attackId === 'lunge') {
					lean = 0.3 * s.t;
					armX = 0.9;
				}
				break;
			case 'active':
				armX = -1.7;
				armZ = 0.2;
				foreX = -0.1;
				lean = 0.45;
				twist = s.attackId === 'claw2' ? 0.6 : -0.6;
				break;
			case 'recover':
				armX = lerp(-1.4, -0.3, s.t);
				lean = lerp(0.4, 0.05, s.t);
				break;
			case 'stagger':
				lean = -0.5;
				armX = -1.0;
				armZ = 1.2;
				break;
			case 'evade':
				lean = -0.2;
				armZ = 1.0;
				break;
			case 'alert':
				armZ = 0.8;
				lean = -0.1;
				break;
		}
		this.torso.rotation.x = damp(this.torso.rotation.x, lean, 12, dt);
		this.torso.rotation.y = damp(this.torso.rotation.y, twist, 14, dt);
		for (const [arm, fore, side] of [
			[this.armL, this.foreL, 1],
			[this.armR, this.foreR, -1]
		] as [THREE.Group, THREE.Group, number][]) {
			arm.rotation.x = damp(arm.rotation.x, armX + Math.sin(t * 3 + side) * 0.08, 16, dt);
			arm.rotation.z = damp(arm.rotation.z, side * armZ, 14, dt);
			fore.rotation.x = damp(fore.rotation.x, foreX, 16, dt);
		}
		this.tatters.forEach((m, i) => {
			m.rotation.x = Math.PI + Math.sin(t * 5 + i * 1.3) * 0.25 - s.speed * 0.04;
		});
		this.head.rotation.z = Math.sin(t * 0.9) * 0.12;
	}
}

// ------------------------------------------------------------------ Crystal Golem

class GolemRig extends RigBase {
	private torso: THREE.Group;
	private head: THREE.Group;
	private armL: THREE.Group;
	private armR: THREE.Group;
	private legL!: THREE.Group;
	private legR!: THREE.Group;
	private core: THREE.Mesh;
	private coreMat: THREE.MeshStandardMaterial;
	private fistR: THREE.Group;
	private phase = 0;

	constructor() {
		super();
		const rock = this.mat({ color: 0x5a5468, roughness: 0.92, flatShading: true });
		const rockDark = this.mat({ color: 0x3e3a4a, roughness: 0.95, flatShading: true });
		const crystal = this.glow(0xb060ff, 1.6);
		this.coreMat = this.glow(0xff70e0, 2.5);
		this.glowBase = 1.6;
		const boulder = (r: number, seed: number) => {
			const g = blob(r, 1, 0.22, seed);
			g.computeVertexNormals();
			return g;
		};
		this.torso = this.group(this.body, 0, 1.6, 0);
		this.mesh(boulder(0.85, 1), rock, this.torso, 0, 0.45, 0, 0, 0, 0, 1.15, 1.0, 0.85);
		this.mesh(boulder(0.6, 2), rockDark, this.torso, 0, -0.25, 0, 0, 0, 0, 1, 0.8, 0.85);
		// Exposed chest core (the weak point).
		this.core = this.mesh(new THREE.IcosahedronGeometry(0.28, 1), this.coreMat, this.torso, 0, 0.42, 0.66);
		this.mesh(new THREE.TorusGeometry(0.34, 0.06, 6, 14), rockDark, this.torso, 0, 0.42, 0.62);
		// Crystal growths on the back and shoulders.
		for (let i = 0; i < 7; i++) {
			const a = -1.2 + (i / 6) * 2.4;
			const c = new THREE.OctahedronGeometry(1, 0);
			c.scale(0.14, 0.55 + (i % 3) * 0.2, 0.14);
			this.mesh(c, crystal, this.torso, Math.sin(a) * 0.7, 0.9 + Math.cos(a) * 0.15, -0.45, -0.5, 0, -a * 0.6);
		}
		this.head = this.group(this.torso, 0, 1.2, 0.15);
		this.mesh(boulder(0.32, 3), rock, this.head, 0, 0, 0, 0, 0, 0, 1.1, 0.8, 1);
		this.mesh(new THREE.BoxGeometry(0.36, 0.06, 0.05), this.glow(0xff8af0, 3), this.head, 0, 0.02, 0.3);
		const makeArm = (side: number): [THREE.Group, THREE.Group] => {
			const sh = this.group(this.torso, side * 1.05, 0.75, 0);
			this.mesh(boulder(0.42, 4 + side), rock, sh, 0, 0, 0);
			const c = new THREE.OctahedronGeometry(1, 0);
			c.scale(0.12, 0.5, 0.12);
			this.mesh(c, crystal, sh, side * 0.15, 0.4, -0.05, 0, 0, -side * 0.5);
			this.mesh(boulder(0.3, 6 + side), rockDark, sh, 0, -0.55, 0, 0, 0, 0, 0.9, 1.3, 0.9);
			const fist = this.group(sh, 0, -1.15, 0.05);
			this.mesh(boulder(0.42, 8 + side), rock, fist, 0, 0, 0, 0, 0, 0, 1, 0.9, 1.05);
			return [sh, fist];
		};
		[this.armL] = makeArm(1);
		[this.armR, this.fistR] = makeArm(-1);
		for (const side of [-1, 1]) {
			const leg = this.group(this.body, side * 0.5, 1.0, 0);
			this.mesh(boulder(0.36, 10 + side), rockDark, leg, 0, -0.45, 0, 0, 0, 0, 0.9, 1.3, 0.9);
			this.mesh(boulder(0.34, 12 + side), rock, leg, 0, -0.9, 0.08, 0, 0, 0, 1.1, 0.6, 1.3);
			if (side < 0) this.legR = leg;
			else this.legL = leg;
		}
	}

	handPosition(out: THREE.Vector3): THREE.Vector3 {
		this.fistR.updateWorldMatrix(true, false);
		return out.setFromMatrixPosition(this.fistR.matrixWorld);
	}

	protected animate(dt: number, s: EnemyAnimState): void {
		const t = this.time;
		if (s.phase === 'move') this.phase += dt * s.speed * 1.4;
		const step = Math.sin(this.phase);
		let armX = 0.1;
		let armZ = 0.15;
		let lean = 0;
		let torsoY = 1.6 + (s.phase === 'move' ? Math.abs(Math.cos(this.phase)) * 0.08 : Math.sin(t * 1.2) * 0.02);
		switch (s.phase) {
			case 'windup':
				if (s.attackId === 'shockwave') {
					armX = lerp(0.1, -2.6, s.t);
					armZ = 0.4;
					lean = -0.2 * s.t;
					torsoY += 0.15 * s.t;
				} else {
					armX = lerp(0.1, -2.9, s.t);
					armZ = 0.25;
					lean = -0.25 * s.t;
				}
				break;
			case 'active':
				armX = s.attackId === 'shockwave' ? -0.2 : -0.9;
				armZ = 0.2;
				lean = 0.45;
				torsoY -= 0.25;
				break;
			case 'recover':
				armX = lerp(-0.9, 0.1, s.t * s.t);
				lean = lerp(0.45, 0, s.t);
				torsoY -= 0.25 * (1 - s.t);
				break;
			case 'stagger':
				lean = -0.35;
				armX = -0.6;
				armZ = 0.8;
				break;
		}
		this.torso.position.y = damp(this.torso.position.y, torsoY, 10, dt);
		this.torso.rotation.x = damp(this.torso.rotation.x, lean, 8, dt);
		this.torso.rotation.z = s.phase === 'move' ? step * 0.06 : damp(this.torso.rotation.z, 0, 4, dt);
		const swing = s.phase === 'move' ? step * 0.4 : 0;
		this.armL.rotation.x = damp(this.armL.rotation.x, armX - swing, 9, dt);
		this.armR.rotation.x = damp(this.armR.rotation.x, armX + swing, 9, dt);
		this.armL.rotation.z = damp(this.armL.rotation.z, armZ, 8, dt);
		this.armR.rotation.z = damp(this.armR.rotation.z, -armZ, 8, dt);
		this.legL.rotation.x = swing * 0.8;
		this.legR.rotation.x = -swing * 0.8;
		this.head.rotation.y = Math.sin(t * 0.5) * 0.25;
		const exposed = s.phase === 'recover' || s.phase === 'stagger';
		this.core.scale.setScalar(exposed ? 1.25 + Math.sin(t * 10) * 0.08 : 1);
		this.coreMat.emissiveIntensity = exposed ? 6 : 2.5;
	}
}

// ------------------------------------------------------------------ Corrupted Mage

class MageRig extends RigBase {
	private torso: THREE.Group;
	private head: THREE.Group;
	private armL: THREE.Group;
	private armR: THREE.Group;
	private staff: THREE.Group;
	private orb: THREE.Mesh;
	private handL: THREE.Group;
	private skirt: THREE.Mesh;

	constructor() {
		super();
		const robe = this.mat({ color: 0x241228, emissive: 0x200818, emissiveIntensity: 0.6, roughness: 0.8, side: THREE.DoubleSide });
		const trim = this.mat({ color: 0x6a1e5a, emissive: 0x6a0a50, emissiveIntensity: 0.8, roughness: 0.5 });
		const mask = this.mat({ color: 0xd8d0c8, roughness: 0.5 });
		const wood = this.mat({ color: 0x2a1a14, roughness: 0.8 });
		const eye = this.glow(0xff40c0, 3);
		const orbMat = this.glow(0xd040ff, 3);
		this.glowBase = 2.2;
		this.torso = this.group(this.body, 0, 1.05, 0);
		this.skirt = this.mesh(new THREE.ConeGeometry(0.5, 1.15, 12, 2, true), robe, this.torso, 0, -0.5, 0, 0, 0, 0, 1, 1, 0.9);
		this.mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.55, 10), robe, this.torso, 0, 0.27, 0);
		this.mesh(new THREE.TorusGeometry(0.49, 0.025, 6, 20), trim, this.torso, 0, -1.06, 0, Math.PI / 2, 0, 0, 1, 0.9, 1);
		this.mesh(new THREE.BoxGeometry(0.06, 0.5, 0.02), trim, this.torso, 0, 0.25, 0.2);
		for (const s of [-1, 1]) this.mesh(new THREE.SphereGeometry(0.13, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), trim, this.torso, s * 0.25, 0.5, 0, 0, 0, s * -0.4);
		this.head = this.group(this.torso, 0, 0.72, 0);
		this.mesh(new THREE.SphereGeometry(0.2, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), robe, this.head, 0, 0.02, -0.02, -0.3, 0, 0, 1, 1.25, 1.15);
		this.mesh(new THREE.ConeGeometry(0.12, 0.3, 8), robe, this.head, 0, 0.18, -0.14, -0.9);
		this.mesh(new THREE.SphereGeometry(0.13, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), mask, this.head, 0, -0.02, 0.07, Math.PI / 2 + 0.2, 0, 0, 1, 0.8, 1.1);
		for (const s of [-1, 1]) this.mesh(new THREE.SphereGeometry(0.025, 6, 6), eye, this.head, s * 0.05, 0.0, 0.18);
		const makeArm = (side: number): [THREE.Group, THREE.Group] => {
			const sh = this.group(this.torso, side * 0.27, 0.45, 0);
			this.mesh(new THREE.CylinderGeometry(0.05, 0.11, 0.6, 8, 1, true), robe, sh, 0, -0.3, 0);
			const hand = this.group(sh, 0, -0.62, 0);
			this.mesh(new THREE.SphereGeometry(0.045, 8, 6), mask, hand, 0, 0, 0);
			return [sh, hand];
		};
		[this.armL, this.handL] = makeArm(1);
		let handR: THREE.Group;
		[this.armR, handR] = makeArm(-1);
		this.staff = this.group(handR, 0, 0, 0);
		this.mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.8, 6), wood, this.staff, 0, 0.35, 0);
		this.mesh(new THREE.TorusGeometry(0.11, 0.015, 6, 14), trim, this.staff, 0, 1.28, 0);
		this.orb = this.mesh(new THREE.OctahedronGeometry(0.1, 1), orbMat, this.staff, 0, 1.28, 0);
		this.barrier(1.25, 1.0);
	}

	handPosition(out: THREE.Vector3): THREE.Vector3 {
		this.handL.updateWorldMatrix(true, false);
		return out.setFromMatrixPosition(this.handL.matrixWorld).add(new THREE.Vector3(0, 0.05, 0));
	}

	protected animate(dt: number, s: EnemyAnimState): void {
		const t = this.time;
		const float = Math.sin(t * 1.8) * 0.04;
		this.torso.position.y = 1.05 + float;
		let armLX = -0.15;
		let armLZ = 0.25;
		let armRX = -0.4;
		let lean = clamp(s.speed * 0.03, 0, 0.2);
		switch (s.phase) {
			case 'windup':
			case 'cast':
				armLX = lerp(-0.15, -1.5, s.t);
				armLZ = 0.15;
				armRX = lerp(-0.4, -1.2, s.t);
				lean = -0.1;
				break;
			case 'active':
				armLX = -1.6;
				armLZ = 0;
				armRX = -1.3;
				lean = 0.05;
				break;
			case 'recover':
				armLX = lerp(-1.4, -0.15, s.t);
				armRX = lerp(-1.2, -0.4, s.t);
				break;
			case 'stagger':
				lean = -0.4;
				armLZ = 1.0;
				break;
			case 'evade':
				lean = 0.2;
				break;
		}
		this.torso.rotation.x = damp(this.torso.rotation.x, lean, 10, dt);
		this.armL.rotation.x = damp(this.armL.rotation.x, armLX, 14, dt);
		this.armL.rotation.z = damp(this.armL.rotation.z, armLZ, 12, dt);
		this.armR.rotation.x = damp(this.armR.rotation.x, armRX, 12, dt);
		this.armR.rotation.z = damp(this.armR.rotation.z, -0.2, 12, dt);
		this.orb.rotation.y = t * 2;
		this.orb.scale.setScalar(1 + this.tele * 0.8 + Math.sin(t * 6) * 0.08);
		this.skirt.rotation.y = Math.sin(t * 1.3) * 0.1;
		this.head.rotation.y = Math.sin(t * 0.7) * 0.2;
	}
}

export function createEnemyVisual(kind: EnemyKind): EnemyVisual {
	switch (kind) {
		case 'wraith':
			return new WraithRig();
		case 'golem':
			return new GolemRig();
		case 'mage':
			return new MageRig();
	}
}
