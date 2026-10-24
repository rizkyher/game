import * as THREE from 'three';
import type { Element } from '../combat/types';
import { ELEMENT_COLORS } from '../combat/types';
import { clamp, damp, dampAngle, lerp } from '../utils/math';

export type AnimAction =
	| 'none'
	| 'castWindup'
	| 'castRelease'
	| 'castRecover'
	| 'charge'
	| 'channel'
	| 'shield'
	| 'parry'
	| 'dodge'
	| 'dash'
	| 'hit'
	| 'dead'
	| 'ultimate'
	| 'interact';

/** Everything the animation layer needs to know about the character this frame. */
export interface CharacterAnimInput {
	/** Horizontal speed (m/s). */
	speed: number;
	runSpeed: number;
	grounded: boolean;
	vy: number;
	/** Movement direction relative to facing (x = strafe right, z = forward), length <= 1. */
	moveLocalX: number;
	moveLocalZ: number;
	sprinting: boolean;
	action: AnimAction;
	/** Progress 0..1 through the current action phase. */
	actionT: number;
	castHand: 'L' | 'R' | 'both';
	/** Camera/aim pitch (radians, up positive). */
	aimPitch: number;
	/** 0..1 during the double-jump flip, -1 otherwise. */
	flipT: number;
	/** Yaw rate for leaning into turns. */
	turnRate: number;
	/** 0..1 charge level. */
	charge: number;
	inWater: boolean;
}

/** Swappable character visual (procedural today, rigged GLB later). */
export interface CharacterVisual {
	readonly root: THREE.Object3D;
	update(dt: number, input: CharacterAnimInput): void;
	handPosition(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3;
	chestPosition(out: THREE.Vector3): THREE.Vector3;
	setElement(el: Element): void;
	flash(amount: number): void;
	setVisible(v: boolean): void;
	dispose(): void;
}

const C = {
	robe: 0x23214f,
	robeDark: 0x161436,
	inner: 0xe8dcc0,
	trim: 0xd4a64a,
	sash: 0x7a1e34,
	skin: 0xf0c8a8,
	hair: 0xe8e4f4,
	leather: 0x3a2a22,
	gauntlet: 0x2a2c3a
};

interface Spring {
	angle: number;
	vel: number;
}

function spring(s: Spring, target: number, k: number, d: number, dt: number): number {
	const acc = (target - s.angle) * k - s.vel * d;
	s.vel += acc * dt;
	s.angle += s.vel * dt;
	return s.angle;
}

/**
 * THE ARCANIST — a procedural, jointed mage model. Robe panels follow the thighs, the cape
 * and hair use damped springs, gauntlets and ornaments glow in the current element, and a
 * floating grimoire opens while casting. Poses are blended procedurally from gameplay state.
 */
export class PlayerModel implements CharacterVisual {
	readonly root = new THREE.Group();
	private body = new THREE.Group();
	private hips = new THREE.Group();
	private spine = new THREE.Group();
	private chest = new THREE.Group();
	private neck = new THREE.Group();
	private head = new THREE.Group();
	private shoulderL = new THREE.Group();
	private shoulderR = new THREE.Group();
	private elbowL = new THREE.Group();
	private elbowR = new THREE.Group();
	private handL = new THREE.Group();
	private handR = new THREE.Group();
	private thighL = new THREE.Group();
	private thighR = new THREE.Group();
	private kneeL = new THREE.Group();
	private kneeR = new THREE.Group();
	private panels: { g: THREE.Group; side: number; front: boolean }[] = [];
	private cape: THREE.Group[] = [];
	private capeSprings: Spring[] = [];
	private hairStrands: THREE.Group[] = [];
	private hairSprings: Spring[] = [];
	private book = new THREE.Group();
	private bookCoverL = new THREE.Group();
	private bookCoverR = new THREE.Group();
	private motes: THREE.Mesh[] = [];
	private materials: THREE.Material[] = [];
	private geometries: THREE.BufferGeometry[] = [];
	private glowMat: THREE.MeshStandardMaterial;
	private clothMats: THREE.MeshStandardMaterial[] = [];
	private elementColor = new THREE.Color(ELEMENT_COLORS.fire);
	private phase = 0;
	private time = 0;
	private flashAmt = 0;
	private glowPulse = 0;
	private flipAngle = 0;
	private deadT = 0;
	private bookOpen = 0;
	private smooth = new Map<THREE.Object3D, THREE.Euler>();

	constructor() {
		this.glowMat = this.mat({ color: 0xffffff, emissive: ELEMENT_COLORS.fire, emissiveIntensity: 2.5, roughness: 0.3 });
		this.build();
		this.root.add(this.body);
		this.root.traverse((o) => {
			if ((o as THREE.Mesh).isMesh) {
				o.castShadow = true;
				o.receiveShadow = false;
			}
		});
	}

	private mat(p: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
		const m = new THREE.MeshStandardMaterial(p);
		this.materials.push(m);
		return m;
	}

	private g<T extends THREE.BufferGeometry>(geo: T): T {
		this.geometries.push(geo);
		return geo;
	}

	private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Mesh {
		const m = new THREE.Mesh(this.g(geo), mat);
		m.position.set(x, y, z);
		m.rotation.set(rx, ry, rz);
		m.scale.set(sx, sy, sz);
		parent.add(m);
		return m;
	}

	private build(): void {
		const robe = this.mat({ color: C.robe, roughness: 0.82 });
		const robeDark = this.mat({ color: C.robeDark, roughness: 0.85, side: THREE.DoubleSide });
		const inner = this.mat({ color: C.inner, roughness: 0.85 });
		const trim = this.mat({ color: C.trim, roughness: 0.32, metalness: 0.85 });
		const sash = this.mat({ color: C.sash, roughness: 0.75 });
		const skin = this.mat({ color: C.skin, roughness: 0.6 });
		const hair = this.mat({ color: C.hair, roughness: 0.55, emissive: 0x302a50, emissiveIntensity: 0.25 });
		const leather = this.mat({ color: C.leather, roughness: 0.7 });
		const gauntlet = this.mat({ color: C.gauntlet, roughness: 0.35, metalness: 0.75 });
		const eyeMat = this.mat({ color: 0x1a1a2a, emissive: 0x6ad8ff, emissiveIntensity: 0.6, roughness: 0.2 });
		this.clothMats.push(robe, inner, sash);
		const glow = this.glowMat;

		this.body.add(this.hips);
		this.hips.position.y = 0.98;
		this.hips.add(this.spine);
		this.spine.position.y = 0.06;
		this.spine.add(this.chest);
		this.chest.position.y = 0.26;
		this.chest.add(this.neck);
		this.neck.position.y = 0.3;
		this.neck.add(this.head);
		this.head.position.y = 0.09;

		// --- Torso layers
		this.mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.3, 12), robe, this.spine, 0, 0.13, 0, 0, 0, 0, 1, 1, 0.8);
		this.mesh(new THREE.CylinderGeometry(0.19, 0.155, 0.34, 14), robe, this.chest, 0, 0.12, 0, 0, 0, 0, 1, 1, 0.72);
		// V-neck inner layer and gold lapels.
		this.mesh(new THREE.BoxGeometry(0.1, 0.24, 0.03), inner, this.chest, 0, 0.17, 0.125, -0.12);
		this.mesh(new THREE.BoxGeometry(0.035, 0.27, 0.02), trim, this.chest, 0.06, 0.16, 0.13, -0.12, 0, 0.3);
		this.mesh(new THREE.BoxGeometry(0.035, 0.27, 0.02), trim, this.chest, -0.06, 0.16, 0.13, -0.12, 0, -0.3);
		// Amulet.
		this.mesh(new THREE.OctahedronGeometry(0.035, 0), glow, this.chest, 0, 0.1, 0.14, 0, 0, 0, 1, 1.4, 0.6);
		this.mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 16), trim, this.chest, 0, 0.1, 0.135);
		// Sash and belt gem.
		this.mesh(new THREE.CylinderGeometry(0.175, 0.18, 0.08, 14), sash, this.spine, 0, 0.0, 0, 0, 0, 0, 1, 1, 0.82);
		this.mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), trim, this.spine, 0, 0.0, 0.15);
		this.mesh(new THREE.OctahedronGeometry(0.022, 0), glow, this.spine, 0, 0.0, 0.17);
		const tail = this.mesh(new THREE.BoxGeometry(0.06, 0.32, 0.015), sash, this.spine, 0.1, -0.16, 0.12, 0.1, 0, 0.12);
		tail.name = 'sashTail';
		// Shoulder mantle and pauldrons.
		this.mesh(new THREE.CylinderGeometry(0.16, 0.27, 0.16, 16, 1, true), robeDark, this.chest, 0, 0.26, -0.01, 0, 0, 0, 1, 1, 0.8);
		this.mesh(new THREE.TorusGeometry(0.265, 0.012, 6, 24), trim, this.chest, 0, 0.18, -0.01, Math.PI / 2, 0, 0, 1, 0.8, 1);
		for (const side of [-1, 1]) {
			this.mesh(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), robe, this.chest, side * 0.22, 0.27, 0, 0, 0, side * -0.35, 1.1, 0.9, 1);
			this.mesh(new THREE.TorusGeometry(0.075, 0.01, 6, 16), trim, this.chest, side * 0.235, 0.255, 0, Math.PI / 2, 0, side * -0.35);
		}
		// Hood resting on the back of the shoulders.
		this.mesh(new THREE.SphereGeometry(0.17, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), robeDark, this.chest, 0, 0.3, -0.1, -1.9, 0, 0, 1, 0.75, 1.1);

		// --- Head
		this.mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.1, 8), skin, this.neck, 0, 0.0, 0);
		this.mesh(new THREE.SphereGeometry(0.105, 18, 14), skin, this.head, 0, 0.08, 0.005, 0, 0, 0, 0.95, 1.08, 1);
		for (const side of [-1, 1]) {
			this.mesh(new THREE.SphereGeometry(0.014, 8, 6), eyeMat, this.head, side * 0.038, 0.09, 0.093, 0, 0, 0, 1.2, 0.8, 0.6);
			this.mesh(new THREE.BoxGeometry(0.035, 0.007, 0.01), hair, this.head, side * 0.038, 0.115, 0.095, 0, 0, side * -0.15);
			this.mesh(new THREE.ConeGeometry(0.018, 0.05, 6), skin, this.head, side * 0.1, 0.09, -0.005, 0, 0, side * -1.2);
		}
		this.mesh(new THREE.ConeGeometry(0.012, 0.03, 4), skin, this.head, 0, 0.07, 0.11, 1.4);
		// Hair: swept crown, fringe and a long tail.
		this.mesh(new THREE.SphereGeometry(0.118, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), hair, this.head, 0, 0.1, -0.012, -0.25, 0, 0, 1.02, 1, 1.08);
		for (let i = 0; i < 5; i++) {
			const x = -0.06 + i * 0.03;
			this.mesh(new THREE.ConeGeometry(0.025, 0.09, 5), hair, this.head, x, 0.15, 0.085, 2.3 + (i % 2) * 0.2, 0, x * 3);
		}
		for (const side of [-1, 1]) this.mesh(new THREE.ConeGeometry(0.03, 0.2, 6), hair, this.head, side * 0.09, 0.04, 0.03, Math.PI + 0.15, 0, side * 0.12);
		// Circlet with a small gem.
		this.mesh(new THREE.TorusGeometry(0.108, 0.006, 6, 28), trim, this.head, 0, 0.125, 0.0, Math.PI / 2 - 0.25, 0, 0);
		this.mesh(new THREE.OctahedronGeometry(0.014, 0), glow, this.head, 0, 0.15, 0.105);
		let parent: THREE.Object3D = this.head;
		for (let i = 0; i < 4; i++) {
			const seg = new THREE.Group();
			seg.position.set(0, i === 0 ? 0.08 : -0.1, i === 0 ? -0.1 : 0);
			parent.add(seg);
			this.mesh(new THREE.ConeGeometry(0.04 - i * 0.007, 0.12, 6), hair, seg, 0, -0.05, 0, Math.PI);
			this.hairStrands.push(seg);
			this.hairSprings.push({ angle: 0, vel: 0 });
			parent = seg;
		}

		// --- Arms with bell sleeves and gauntlets
		for (const side of [-1, 1] as const) {
			const sh = side > 0 ? this.shoulderL : this.shoulderR;
			const el = side > 0 ? this.elbowL : this.elbowR;
			const hand = side > 0 ? this.handL : this.handR;
			sh.position.set(side * 0.215, 0.24, 0);
			this.chest.add(sh);
			this.mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.28, 10), robe, sh, 0, -0.14, 0);
			el.position.set(0, -0.28, 0);
			sh.add(el);
			// Bell sleeve flaring from the elbow.
			this.mesh(new THREE.CylinderGeometry(0.06, 0.105, 0.2, 12, 1, true), robeDark, el, 0, -0.07, 0);
			this.mesh(new THREE.TorusGeometry(0.103, 0.01, 6, 18), trim, el, 0, -0.17, 0, Math.PI / 2);
			// Gauntlet.
			this.mesh(new THREE.CylinderGeometry(0.043, 0.05, 0.2, 10), gauntlet, el, 0, -0.15, 0);
			this.mesh(new THREE.TorusGeometry(0.047, 0.008, 6, 14), trim, el, 0, -0.07, 0, Math.PI / 2);
			this.mesh(new THREE.TorusGeometry(0.045, 0.007, 6, 14), trim, el, 0, -0.23, 0, Math.PI / 2);
			for (let k = 0; k < 3; k++) this.mesh(new THREE.BoxGeometry(0.008, 0.06, 0.01), glow, el, Math.sin((k - 1) * 0.8) * 0.048, -0.15, Math.cos((k - 1) * 0.8) * 0.048, 0, (k - 1) * 0.8, 0);
			hand.position.set(0, -0.27, 0);
			el.add(hand);
			this.mesh(new THREE.BoxGeometry(0.07, 0.085, 0.035), gauntlet, hand, 0, -0.04, 0.0);
			this.mesh(new THREE.OctahedronGeometry(0.02, 0), glow, hand, 0, -0.035, 0.022);
			for (let f = 0; f < 4; f++) this.mesh(new THREE.BoxGeometry(0.014, 0.05, 0.018), leather, hand, -0.024 + f * 0.016, -0.1, 0.0);
			this.mesh(new THREE.BoxGeometry(0.016, 0.045, 0.018), leather, hand, side * 0.04, -0.06, 0.012, 0, 0, side * 0.5);
		}

		// --- Legs (mostly under the robe) and boots
		for (const side of [-1, 1] as const) {
			const th = side > 0 ? this.thighL : this.thighR;
			const kn = side > 0 ? this.kneeL : this.kneeR;
			th.position.set(side * 0.095, -0.02, 0);
			this.hips.add(th);
			this.mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.44, 10), robeDark, th, 0, -0.22, 0);
			kn.position.set(0, -0.44, 0);
			th.add(kn);
			this.mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.38, 10), leather, kn, 0, -0.2, 0);
			this.mesh(new THREE.CylinderGeometry(0.065, 0.058, 0.1, 10), leather, kn, 0, -0.04, 0);
			this.mesh(new THREE.TorusGeometry(0.06, 0.008, 6, 14), trim, kn, 0, -0.08, 0, Math.PI / 2);
			this.mesh(new THREE.BoxGeometry(0.085, 0.06, 0.2), leather, kn, 0, -0.41, 0.045);
		}

		// --- Robe skirt: four panels that swing with the legs, plus an inner layer.
		for (const [side, front] of [
			[-1, true],
			[1, true],
			[-1, false],
			[1, false]
		] as [number, boolean][]) {
			const g = new THREE.Group();
			g.position.set(side * 0.06, 0.02, front ? 0.04 : -0.04);
			this.hips.add(g);
			const shape = new THREE.CylinderGeometry(0.11, 0.26, 0.82, 10, 4, true, 0, Math.PI / 2);
			shape.translate(0, -0.41, 0);
			const startAngle = front ? (side > 0 ? 0 : -Math.PI / 2) : side > 0 ? Math.PI / 2 : Math.PI;
			this.mesh(shape, robeDark, g, 0, 0, 0, 0, startAngle, 0);
			const outer = new THREE.CylinderGeometry(0.115, 0.27, 0.78, 10, 4, true, 0, Math.PI / 2);
			outer.translate(0, -0.39, 0);
			this.mesh(outer, robe, g, 0, 0, 0, 0, startAngle, 0);
			const hem = new THREE.CylinderGeometry(0.272, 0.275, 0.04, 10, 1, true, 0, Math.PI / 2);
			this.mesh(hem, trim, g, 0, -0.77, 0, 0, startAngle, 0);
			this.panels.push({ g, side, front });
		}
		const innerSkirt = new THREE.CylinderGeometry(0.1, 0.2, 0.7, 12, 1, true);
		innerSkirt.translate(0, -0.35, 0);
		this.mesh(innerSkirt, inner, this.hips, 0, 0, 0.02, 0, 0, 0, 1, 1, 0.9);

		// --- Cape (four spring-driven segments)
		parent = this.chest;
		for (let i = 0; i < 4; i++) {
			const seg = new THREE.Group();
			seg.position.set(0, i === 0 ? 0.26 : -0.26, i === 0 ? -0.14 : 0);
			parent.add(seg);
			const w0 = 0.34 + i * 0.05;
			const w1 = 0.34 + (i + 1) * 0.05;
			const geo = new THREE.BufferGeometry();
			geo.setAttribute('position', new THREE.Float32BufferAttribute([-w0 / 2, 0, 0, w0 / 2, 0, 0, w1 / 2, -0.27, 0, -w1 / 2, -0.27, 0], 3));
			geo.setIndex([0, 2, 1, 0, 3, 2]);
			geo.computeVertexNormals();
			this.mesh(geo, robeDark, seg, 0, 0, 0);
			if (i === 3) {
				const edge = new THREE.BoxGeometry(w1, 0.025, 0.012);
				this.mesh(edge, trim, seg, 0, -0.27, 0);
			}
			this.cape.push(seg);
			this.capeSprings.push({ angle: 0.1, vel: 0 });
			parent = seg;
		}

		// --- Floating grimoire
		this.book.position.set(-0.42, 1.05, -0.15);
		this.root.add(this.book);
		const coverMat = this.mat({ color: 0x5a1e2e, roughness: 0.6 });
		const pageMat = this.mat({ color: 0xf2e6c8, roughness: 0.9, emissive: 0xffe0a0, emissiveIntensity: 0.15 });
		this.mesh(new THREE.BoxGeometry(0.03, 0.22, 0.16), pageMat, this.book, 0, 0, 0);
		this.mesh(new THREE.BoxGeometry(0.035, 0.235, 0.012), coverMat, this.book, 0, 0, -0.085);
		for (const [g, side] of [
			[this.bookCoverL, 1],
			[this.bookCoverR, -1]
		] as [THREE.Group, number][]) {
			g.position.set(side * 0.018, 0, -0.085);
			this.book.add(g);
			this.mesh(new THREE.BoxGeometry(0.008, 0.235, 0.17), coverMat, g, side * 0.004, 0, 0.085);
			this.mesh(new THREE.OctahedronGeometry(0.018, 0), glow, g, side * 0.01, 0, 0.085);
		}

		// --- Orbiting elemental motes (aura)
		for (let i = 0; i < 3; i++) {
			const m = this.mesh(new THREE.SphereGeometry(0.03, 8, 6), glow, this.root, 0, 1, 0);
			m.castShadow = false;
			this.motes.push(m);
		}
	}

	setElement(el: Element): void {
		this.elementColor.setHex(ELEMENT_COLORS[el]);
		this.glowMat.emissive.copy(this.elementColor);
		this.glowPulse = 1;
	}

	flash(amount: number): void {
		this.flashAmt = Math.max(this.flashAmt, amount);
	}

	setVisible(v: boolean): void {
		this.root.visible = v;
	}

	handPosition(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 {
		const h = side === 'L' ? this.handL : this.handR;
		h.updateWorldMatrix(true, false);
		return out.set(0, -0.05, 0.03).applyMatrix4(h.matrixWorld);
	}

	chestPosition(out: THREE.Vector3): THREE.Vector3 {
		this.chest.updateWorldMatrix(true, false);
		return out.set(0, 0.12, 0.1).applyMatrix4(this.chest.matrixWorld);
	}

	/** Smoothly drives a joint toward a target rotation. */
	private pose(o: THREE.Object3D, x: number, y: number, z: number, rate: number, dt: number): void {
		let e = this.smooth.get(o);
		if (!e) {
			e = new THREE.Euler(x, y, z);
			this.smooth.set(o, e);
		}
		e.x = dampAngle(e.x, x, rate, dt);
		e.y = dampAngle(e.y, y, rate, dt);
		e.z = dampAngle(e.z, z, rate, dt);
		o.rotation.set(e.x, e.y, e.z);
	}

	update(dt: number, a: CharacterAnimInput): void {
		this.time += dt;
		const t = this.time;
		const run = clamp(a.speed / Math.max(1, a.runSpeed), 0, 1.6);
		const moving = a.speed > 0.4 && a.grounded;
		// Stride phase advances with distance travelled.
		if (moving) this.phase += (a.speed * dt) / (a.sprinting ? 1.9 : 1.55) * Math.PI;
		const ph = this.phase;
		const sw = Math.sin(ph);
		const cw = Math.cos(ph);
		const R = 18; // joint smoothing rate

		// ------------------------------------------------ locomotion base pose
		let hipsY = 0.98;
		let hipsRoll = 0;
		let spineX = 0;
		let spineY = 0;
		let chestY = 0;
		let headX = -a.aimPitch * 0.45;
		let thighLx = 0;
		let thighRx = 0;
		let kneeL = 0.05;
		let kneeR = 0.05;
		let shLx = 0.05;
		let shRx = 0.05;
		let shLz = 0.12;
		let shRz = -0.12;
		let shLy = 0;
		let shRy = 0;
		let elL = -0.25;
		let elR = -0.25;
		let bodyX = 0;
		let bodyZ = 0;

		if (a.grounded) {
			if (moving) {
				const amp = lerp(0.35, 0.8, Math.min(1, run));
				// Legs swing relative to the movement direction (strafing turns the stride).
				const dirSign = a.moveLocalZ < -0.3 ? -1 : 1;
				thighLx = -sw * amp * dirSign;
				thighRx = sw * amp * dirSign;
				kneeL = Math.max(0, cw) * amp * 1.3 + 0.08;
				kneeR = Math.max(0, -cw) * amp * 1.3 + 0.08;
				hipsY = 0.98 - Math.abs(cw) * 0.05 * run - run * 0.03;
				hipsRoll = sw * 0.06 * run;
				spineX = 0.08 + run * 0.12 + (a.sprinting ? 0.15 : 0);
				shLx = sw * amp * 0.9;
				shRx = -sw * amp * 0.9;
				elL = -0.4 - Math.max(0, -sw) * 0.6;
				elR = -0.4 - Math.max(0, sw) * 0.6;
				chestY = sw * 0.12 * run;
				bodyZ = clamp(-a.moveLocalX * 0.12, -0.15, 0.15);
			} else {
				// Idle: breathing and a gentle sway.
				const breath = Math.sin(t * 1.8);
				hipsY = 0.98 + breath * 0.006;
				spineX = 0.02 + breath * 0.015;
				shLz = 0.14 + breath * 0.02;
				shRz = -0.14 - breath * 0.02;
				chestY = Math.sin(t * 0.6) * 0.04;
				elL = -0.3;
				elR = -0.3;
			}
		} else {
			// Airborne: tuck legs on the way up, reach down when falling.
			const up = clamp(a.vy / 8, -1, 1);
			thighLx = -0.5 * Math.max(0, up) - 0.15;
			thighRx = -0.2 * Math.max(0, up) + 0.15;
			kneeL = 0.9 * Math.max(0.2, up);
			kneeR = 0.6 * Math.max(0.2, up);
			shLz = 0.5 + Math.max(0, -up) * 0.4;
			shRz = -0.5 - Math.max(0, -up) * 0.4;
			shLx = -0.3;
			shRx = -0.3;
			spineX = 0.05;
		}
		bodyZ += clamp(-a.turnRate * 0.04, -0.2, 0.2);

		// ------------------------------------------------ actions overlay the upper body
		const aimArm = -(Math.PI / 2 + clamp(a.aimPitch, -0.9, 0.9));
		const ease = (x: number) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
		let bookTarget = 0;
		let fast = false;
		switch (a.action) {
			case 'castWindup': {
				const k = ease(a.actionT);
				fast = true;
				bookTarget = 0.6;
				if (a.castHand === 'both') {
					shLx = lerp(shLx, -0.9, k);
					shRx = lerp(shRx, -0.9, k);
					shLz = 0.25;
					shRz = -0.25;
					elL = -1.6 * k;
					elR = -1.6 * k;
					spineX += 0.1 * k;
				} else {
					const L = a.castHand === 'L';
					// Draw back the casting hand, twist the torso.
					if (L) {
						shLx = lerp(shLx, 0.6, k);
						elL = lerp(elL, -1.7, k);
						shLz = 0.3;
					} else {
						shRx = lerp(shRx, 0.6, k);
						elR = lerp(elR, -1.7, k);
						shRz = -0.3;
					}
					chestY += (L ? 0.45 : -0.45) * k;
				}
				break;
			}
			case 'castRelease':
			case 'castRecover': {
				const rel = a.action === 'castRelease';
				const k = rel ? ease(a.actionT * 1.6) : 1 - ease(a.actionT) * 0.85;
				fast = rel;
				bookTarget = 0.8;
				const L = a.castHand === 'L';
				const both = a.castHand === 'both';
				if (both || L) {
					shLx = lerp(shLx, aimArm, k);
					elL = lerp(elL, -0.08, k);
					shLz = lerp(shLz, both ? -0.1 : 0.0, k);
				}
				if (both || !L) {
					shRx = lerp(shRx, aimArm, k);
					elR = lerp(elR, -0.08, k);
					shRz = lerp(shRz, both ? 0.1 : 0.0, k);
				}
				if (!both) chestY += (L ? -0.35 : 0.35) * k;
				spineX -= 0.06 * k;
				break;
			}
			case 'charge': {
				const c = a.charge;
				bookTarget = 1;
				// Both hands gather energy in front of the chest; crouch slightly as it builds.
				shLx = -1.0 - c * 0.15;
				shRx = -1.0 - c * 0.15;
				shLz = 0.55;
				shRz = -0.55;
				shLy = -0.5;
				shRy = 0.5;
				elL = -1.5;
				elR = -1.5;
				spineX += 0.08 + c * 0.1;
				hipsY -= c * 0.06;
				thighLx -= c * 0.25;
				thighRx += c * 0.15;
				kneeL += c * 0.35;
				kneeR += c * 0.35;
				break;
			}
			case 'channel':
			case 'ultimate': {
				bookTarget = 1;
				shLx = aimArm;
				shRx = aimArm;
				shLz = -0.12;
				shRz = 0.12;
				elL = -0.05;
				elR = -0.05;
				spineX -= 0.08;
				if (a.action === 'ultimate') {
					shLx = -2.6;
					shRx = -2.6;
					shLz = 0.5;
					shRz = -0.5;
					headX = -0.4;
					spineX = -0.25;
				}
				break;
			}
			case 'shield': {
				shLx = -1.35;
				shLz = 0.15;
				elL = -0.35;
				shRx = 0.2;
				shRz = -0.4;
				elR = -0.6;
				chestY -= 0.25;
				spineX += 0.06;
				hipsY -= 0.04;
				kneeL += 0.15;
				kneeR += 0.15;
				break;
			}
			case 'parry': {
				const k = ease(a.actionT * 1.4);
				fast = true;
				shRx = lerp(-1.6, -1.2, k);
				shRz = lerp(-0.9, 0.6, k);
				shRy = lerp(0.6, -0.6, k);
				elR = -0.2;
				chestY += lerp(-0.4, 0.5, k);
				shLx = 0.3;
				shLz = 0.5;
				break;
			}
			case 'dodge': {
				fast = true;
				// Low evasive roll handled by bodyX below; tuck the limbs.
				hipsY = 0.62;
				thighLx = -1.4;
				thighRx = -1.2;
				kneeL = 2.0;
				kneeR = 1.9;
				shLx = -1.2;
				shRx = -1.2;
				elL = -1.6;
				elR = -1.6;
				spineX = 0.8;
				bodyX = a.actionT * Math.PI * 2;
				break;
			}
			case 'dash': {
				fast = true;
				spineX = 0.55;
				shLx = 0.9;
				shRx = 0.9;
				shLz = 0.35;
				shRz = -0.35;
				elL = -0.2;
				elR = -0.2;
				thighLx = 0.5;
				thighRx = -0.2;
				kneeL = 0.9;
				kneeR = 0.5;
				break;
			}
			case 'hit': {
				fast = true;
				const k = Math.sin(clamp(a.actionT, 0, 1) * Math.PI);
				spineX = -0.45 * k;
				headX = 0.3 * k;
				shLx = -0.6 * k;
				shRx = -0.6 * k;
				shLz = 0.7 * k;
				shRz = -0.7 * k;
				break;
			}
			case 'interact': {
				shRx = -1.2;
				elR = -0.3;
				break;
			}
		}

		// ------------------------------------------------ flips, death, global body
		if (a.flipT >= 0) {
			this.flipAngle = ease(a.flipT) * Math.PI * 2;
			thighLx = -1.2;
			thighRx = -1.0;
			kneeL = 1.8;
			kneeR = 1.7;
			shLz = 0.9;
			shRz = -0.9;
		} else this.flipAngle = 0;
		if (a.action === 'dead') {
			// Fall onto the back, pivoting at the feet.
			this.deadT = Math.min(1, this.deadT + dt * 1.6);
			const k = ease(this.deadT);
			bodyX = -k * 1.45;
			shLz = 1.2 * k;
			shRz = -1.2 * k;
			thighLx = -0.4 * k;
			kneeL = 0.6 * k;
			headX = -0.3 * k;
		} else this.deadT = 0;

		const rate = fast ? 30 : R;
		const spinning = a.action === 'dodge' || a.flipT >= 0;
		this.hips.position.y = damp(this.hips.position.y, hipsY, fast ? 20 : 14, dt);
		this.pose(this.body, bodyX + this.flipAngle, 0, bodyZ, spinning ? 60 : 10, dt);
		if (spinning) this.body.rotation.x = bodyX + this.flipAngle;
		const rx = this.body.rotation.x;
		if (a.action === 'dead') this.body.position.set(0, 0.14 * ease(this.deadT), 0);
		else if (rx !== 0) {
			// Rolls and flips turn about the waist: offset so the pivot stays put.
			const piv = spinning ? 0.6 : 0.9;
			this.body.position.set(0, piv - piv * Math.cos(rx), -piv * Math.sin(rx));
		} else this.body.position.set(0, 0, 0);
		this.pose(this.hips, 0, 0, hipsRoll, R, dt);
		this.pose(this.spine, spineX, spineY, 0, rate, dt);
		this.pose(this.chest, 0, chestY, 0, rate, dt);
		this.pose(this.head, headX, -chestY * 0.6, 0, R, dt);
		this.pose(this.shoulderL, shLx, shLy, shLz, rate, dt);
		this.pose(this.shoulderR, shRx, shRy, shRz, rate, dt);
		this.pose(this.elbowL, elL, 0, 0, rate, dt);
		this.pose(this.elbowR, elR, 0, 0, rate, dt);
		this.pose(this.thighL, thighLx, 0, 0.03, rate, dt);
		this.pose(this.thighR, thighRx, 0, -0.03, rate, dt);
		this.pose(this.kneeL, kneeL, 0, 0, rate, dt);
		this.pose(this.kneeR, kneeR, 0, 0, rate, dt);
		this.handL.rotation.set(-0.1, 0, 0.1);
		this.handR.rotation.set(-0.1, 0, -0.1);

		// Robe panels follow the legs on their side.
		for (const p of this.panels) {
			const th = p.side > 0 ? this.thighL : this.thighR;
			const legX = th.rotation.x;
			const k = p.front ? Math.min(0, legX) * 0.75 + Math.max(0, legX) * 0.25 : Math.max(0, legX) * 0.75 + Math.min(0, legX) * 0.2;
			const flare = a.grounded ? 0 : 0.18;
			p.g.rotation.set(k + (p.front ? -flare : flare), 0, p.side * (0.04 + flare * 0.5 + Math.abs(legX) * 0.06));
		}

		// Cape and hair springs react to speed and vertical motion.
		const flow = clamp(a.speed * 0.09 + Math.max(0, -a.vy) * 0.06 + (a.action === 'dash' ? 0.6 : 0), 0, 1.3);
		const wave = Math.sin(t * 6 + a.speed) * 0.04 * (0.3 + flow);
		for (let i = 0; i < this.cape.length; i++) {
			const target = (i === 0 ? 0.12 + flow * 0.55 : flow * 0.12) + wave * (i + 1) * 0.5 + Math.max(0, a.vy) * -0.02;
			const ang = spring(this.capeSprings[i], target, 120, 10, dt);
			this.cape[i].rotation.x = ang;
		}
		for (let i = 0; i < this.hairStrands.length; i++) {
			const target = (i === 0 ? 0.25 : 0.1) + flow * 0.18 + Math.sin(t * 3 + i) * 0.03;
			this.hairStrands[i].rotation.x = spring(this.hairSprings[i], target, 90, 8, dt);
		}

		// Grimoire: hovers at the hip, swings to the front and opens while casting.
		this.bookOpen = damp(this.bookOpen, bookTarget, 8, dt);
		const bo = this.bookOpen;
		this.book.position.set(lerp(-0.42, -0.3, bo), lerp(1.05, 1.3, bo) + Math.sin(t * 2.2) * 0.03, lerp(-0.15, 0.32, bo));
		this.book.rotation.set(lerp(0.2, -0.5, bo), lerp(0.3, 0.6, bo) + Math.sin(t * 0.8) * 0.1, lerp(0.15, 0, bo));
		this.bookCoverL.rotation.y = bo * 1.25;
		this.bookCoverR.rotation.y = -bo * 1.25;
		this.book.visible = a.action !== 'dead' && a.action !== 'dodge';

		// Aura motes orbit the body; tighter and brighter while casting.
		const casting = a.action !== 'none' && a.action !== 'dodge' && a.action !== 'dead' && a.action !== 'hit';
		for (let i = 0; i < this.motes.length; i++) {
			const m = this.motes[i];
			const ang = t * (casting ? 4 : 1.6) + (i * Math.PI * 2) / 3;
			const r = casting ? 0.45 : 0.6;
			m.position.set(Math.cos(ang) * r, 1.0 + Math.sin(t * 1.3 + i * 2) * 0.35 + (casting ? 0.2 : 0), Math.sin(ang) * r);
			m.visible = a.action !== 'dead';
		}

		// Element glow intensity: pulse on element swap, brighter with charge.
		this.glowPulse = Math.max(0, this.glowPulse - dt * 2);
		this.flashAmt = Math.max(0, this.flashAmt - dt * 5);
		this.glowMat.emissiveIntensity = 2.2 + Math.sin(t * 3) * 0.4 + this.glowPulse * 3 + a.charge * 3 + (casting ? 1 : 0);
		for (const m of this.clothMats) m.emissive.setRGB(this.flashAmt, this.flashAmt * 0.3, this.flashAmt * 0.3);
	}

	dispose(): void {
		for (const g of this.geometries) g.dispose();
		for (const m of this.materials) m.dispose();
	}
}
