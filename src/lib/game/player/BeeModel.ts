import * as THREE from 'three';
import { canvasTexture } from '../utils/geometry';
import { damp, dampFactor } from '../utils/math';

export type Expression = 'happy' | 'determined' | 'surprised' | 'dizzy' | 'worried' | 'sleepy' | 'angry';

interface BeeMaterials {
	stripes: THREE.MeshStandardMaterial;
	yellow: THREE.MeshStandardMaterial;
	dark: THREE.MeshStandardMaterial;
	eye: THREE.MeshStandardMaterial;
	pupil: THREE.MeshBasicMaterial;
	wing: THREE.MeshStandardMaterial;
	cheek: THREE.MeshBasicMaterial;
}

let sharedGeo: Record<string, THREE.BufferGeometry> | null = null;

function geometries(): Record<string, THREE.BufferGeometry> {
	if (sharedGeo) return sharedGeo;
	const abdomen = new THREE.SphereGeometry(0.5, 24, 16);
	abdomen.rotateX(Math.PI / 2);
	abdomen.scale(1.05, 0.95, 1.35);
	const wingShape = new THREE.Shape();
	wingShape.moveTo(0, 0);
	wingShape.bezierCurveTo(0.25, 0.35, 0.95, 0.42, 1.1, 0.12);
	wingShape.bezierCurveTo(1.15, -0.1, 0.6, -0.22, 0, 0);
	const wing = new THREE.ShapeGeometry(wingShape, 10);
	wing.rotateX(-Math.PI / 2);
	const antenna = new THREE.TubeGeometry(
		new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.02, 0.22, 0.05), new THREE.Vector3(0.08, 0.38, 0.18), new THREE.Vector3(0.16, 0.44, 0.32)]),
		8,
		0.022,
		5
	);
	const mouth = new THREE.TorusGeometry(0.075, 0.018, 6, 14, Math.PI);
	mouth.rotateZ(Math.PI);
	sharedGeo = {
		abdomen,
		thorax: new THREE.SphereGeometry(0.4, 18, 14),
		head: new THREE.SphereGeometry(0.4, 20, 16),
		eye: new THREE.SphereGeometry(0.16, 14, 12),
		pupil: new THREE.SphereGeometry(0.085, 10, 8),
		glint: new THREE.SphereGeometry(0.03, 6, 4),
		lid: new THREE.SphereGeometry(0.175, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
		brow: new THREE.CapsuleGeometry(0.022, 0.12, 3, 6).rotateZ(Math.PI / 2),
		cheek: new THREE.SphereGeometry(0.07, 8, 6).scale(1, 0.6, 0.4),
		mouth,
		mouthO: new THREE.SphereGeometry(0.06, 8, 6).scale(1, 1.2, 0.5),
		antenna,
		tip: new THREE.SphereGeometry(0.06, 8, 6),
		wing,
		leg: new THREE.CapsuleGeometry(0.03, 0.32, 3, 5).translate(0, -0.16, 0),
		foot: new THREE.SphereGeometry(0.045, 6, 4),
		stinger: new THREE.ConeGeometry(0.07, 0.3, 8).rotateX(-Math.PI / 2),
		crown: new THREE.CylinderGeometry(0.2, 0.17, 0.16, 5, 1, true)
	};
	return sharedGeo;
}

function stripeTexture(): THREE.CanvasTexture {
	return canvasTexture(8, 128, (ctx) => {
		ctx.fillStyle = '#ffc61a';
		ctx.fillRect(0, 0, 8, 128);
		ctx.fillStyle = '#2b2118';
		for (const [y, h] of [
			[34, 16],
			[62, 16],
			[90, 16],
			[114, 14]
		])
			ctx.fillRect(0, y, 8, h);
	});
}

function makeMaterials(variant: 'player' | 'worker' | 'queen' | 'guard'): BeeMaterials {
	const tex = stripeTexture();
	const yellowHex = variant === 'queen' ? 0xffb300 : variant === 'guard' ? 0xffa726 : 0xffc61a;
	return {
		stripes: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, color: variant === 'worker' ? 0xfff0c0 : 0xffffff }),
		yellow: new THREE.MeshStandardMaterial({ color: yellowHex, roughness: 0.75 }),
		dark: new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.45 }),
		eye: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 }),
		pupil: new THREE.MeshBasicMaterial({ color: 0x15110e }),
		wing: new THREE.MeshStandardMaterial({ color: 0xe6f6ff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
		cheek: new THREE.MeshBasicMaterial({ color: 0xff8fab, transparent: true, opacity: 0.8 })
	};
}

const workerMats: Partial<Record<string, BeeMaterials>> = {};

/**
 * Procedural cartoon bee. Forward is +Z. `tilt` handles pitch/roll/barrel-roll so the root
 * can carry the heading (yaw) only.
 */
export class BeeModel {
	readonly root = new THREE.Group();
	readonly tilt = new THREE.Group();
	readonly body = new THREE.Group();
	/** Where held objects dangle from. */
	readonly holdPoint = new THREE.Object3D();
	readonly mats: BeeMaterials;
	private wings: THREE.Object3D[] = [];
	private legs: THREE.Object3D[] = [];
	private antennae: THREE.Object3D[] = [];
	private lids: THREE.Mesh[] = [];
	private brows: THREE.Mesh[] = [];
	private pupils: THREE.Mesh[] = [];
	private mouth: THREE.Mesh;
	private mouthO: THREE.Mesh;
	private stinger: THREE.Mesh;
	private expression: Expression = 'happy';
	private expressionTimer = 0;
	private blinkTimer = 2;
	private blink = 0;
	private flapPhase = Math.random() * 10;
	private antennaVel = new THREE.Vector2();
	private antennaPos = new THREE.Vector2();
	private squash = 0;
	private squashVel = 0;
	private stingOut = 0;
	private lidTarget = 0.15;
	private baseYellow = new THREE.Color();
	private baseStripe = new THREE.Color();
	private coat = new THREE.Color();
	private ownsMats: boolean;

	constructor(variant: 'player' | 'worker' | 'queen' | 'guard' = 'player', scale = 1) {
		const g = geometries();
		this.ownsMats = variant === 'player';
		this.mats = this.ownsMats ? makeMaterials('player') : (workerMats[variant] ??= makeMaterials(variant));
		this.baseYellow.copy(this.mats.yellow.color);
		this.baseStripe.copy(this.mats.stripes.color);
		const m = this.mats;
		this.root.add(this.tilt);
		this.tilt.add(this.body);
		this.root.scale.setScalar(scale);

		const abdomen = new THREE.Mesh(g.abdomen, m.stripes);
		abdomen.position.set(0, -0.02, -0.45);
		abdomen.rotation.x = -0.18;
		const thorax = new THREE.Mesh(g.thorax, m.yellow);
		thorax.position.set(0, 0.04, 0.12);
		const head = new THREE.Mesh(g.head, m.dark);
		head.position.set(0, 0.12, 0.58);
		head.scale.set(1, 0.95, 0.92);
		this.body.add(abdomen, thorax, head);

		const face = new THREE.Group();
		face.position.copy(head.position);
		this.body.add(face);
		for (const s of [-1, 1]) {
			const eye = new THREE.Mesh(g.eye, m.eye);
			eye.position.set(0.16 * s, 0.1, 0.27);
			eye.scale.set(1, 1.15, 0.8);
			const pupil = new THREE.Mesh(g.pupil, m.pupil);
			pupil.position.set(0.012 * s, -0.01, 0.12);
			eye.add(pupil);
			const glint = new THREE.Mesh(g.glint, m.eye);
			glint.position.set(0.03, 0.04, 0.07);
			pupil.add(glint);
			this.pupils.push(pupil);
			const lid = new THREE.Mesh(g.lid, m.dark);
			lid.position.copy(eye.position);
			lid.scale.set(1.02, 1.17, 0.85);
			face.add(eye, lid);
			this.lids.push(lid);
			const brow = new THREE.Mesh(g.brow, m.dark);
			brow.position.set(0.16 * s, 0.33, 0.27);
			face.add(brow);
			this.brows.push(brow);
			const cheek = new THREE.Mesh(g.cheek, m.cheek);
			cheek.position.set(0.25 * s, -0.08, 0.27);
			cheek.rotation.y = 0.5 * s;
			face.add(cheek);
		}
		this.mouth = new THREE.Mesh(g.mouth, m.eye);
		this.mouth.position.set(0, -0.12, 0.37);
		this.mouthO = new THREE.Mesh(g.mouthO, m.pupil);
		this.mouthO.position.set(0, -0.13, 0.37);
		this.mouthO.visible = false;
		face.add(this.mouth, this.mouthO);

		for (const s of [-1, 1]) {
			const pivot = new THREE.Group();
			pivot.position.set(0.12 * s, 0.32, 0.12);
			const ant = new THREE.Mesh(g.antenna, m.dark);
			ant.scale.x = s;
			const tip = new THREE.Mesh(g.tip, m.dark);
			tip.position.set(0.16 * s, 0.44, 0.32);
			pivot.add(ant, tip);
			face.add(pivot);
			this.antennae.push(pivot);
		}

		// Two big front wings + two small hind wings.
		const wingDefs = [
			{ s: 1, scale: 1.05, z: 0.18, y: 0.38 },
			{ s: -1, scale: 1.05, z: 0.18, y: 0.38 },
			{ s: 1, scale: 0.65, z: -0.02, y: 0.34 },
			{ s: -1, scale: 0.65, z: -0.02, y: 0.34 }
		];
		for (const w of wingDefs) {
			const pivot = new THREE.Group();
			pivot.position.set(0.1 * w.s, w.y, w.z);
			const mesh = new THREE.Mesh(g.wing, m.wing);
			mesh.scale.set(w.scale * w.s, 1, w.scale);
			mesh.rotation.y = -0.35 * w.s;
			mesh.renderOrder = 5;
			pivot.add(mesh);
			pivot.userData.side = w.s;
			pivot.userData.hind = w.scale < 1;
			this.body.add(pivot);
			this.wings.push(pivot);
		}

		for (let i = 0; i < 6; i++) {
			const s = i % 2 ? 1 : -1;
			const row = Math.floor(i / 2);
			const pivot = new THREE.Group();
			pivot.position.set(0.17 * s, -0.22, 0.28 - row * 0.17);
			const leg = new THREE.Mesh(g.leg, m.dark);
			const foot = new THREE.Mesh(g.foot, m.dark);
			foot.position.y = -0.34;
			pivot.add(leg, foot);
			pivot.rotation.z = 0.35 * s;
			pivot.userData.side = s;
			pivot.userData.row = row;
			this.body.add(pivot);
			this.legs.push(pivot);
		}

		this.stinger = new THREE.Mesh(g.stinger, m.dark);
		this.stinger.position.set(0, -0.08, -1.12);
		this.body.add(this.stinger);

		if (variant === 'queen') {
			const crown = new THREE.Mesh(g.crown, new THREE.MeshStandardMaterial({ color: 0xffd54f, metalness: 0.7, roughness: 0.25, side: THREE.DoubleSide }));
			crown.position.set(0, 0.5, 0.55);
			this.body.add(crown);
		}

		this.holdPoint.position.set(0, -0.7, 0.15);
		this.body.add(this.holdPoint);

		this.body.traverse((o) => {
			if (o instanceof THREE.Mesh && o.material !== m.wing) o.castShadow = true;
		});
	}

	setExpression(e: Expression, duration = 0): void {
		this.expression = e;
		this.expressionTimer = duration;
	}

	getExpression(): Expression {
		return this.expression;
	}

	/** Squash-and-stretch kick, e.g. on impacts. */
	bonk(amount: number): void {
		this.squashVel -= amount * 8;
	}

	setSting(active: boolean): void {
		this.stingOut = active ? 1 : 0;
	}

	/** Tints the bee for honey coating (amber) or wetness (darker). */
	setCoat(honey: number, wet: number): void {
		this.coat.setRGB(1, 1, 1).lerp(new THREE.Color(1, 0.7, 0.25), honey * 0.7);
		this.coat.multiplyScalar(1 - wet * 0.35);
		this.mats.yellow.color.copy(this.baseYellow).multiply(this.coat);
		this.mats.stripes.color.copy(this.baseStripe).multiply(this.coat);
	}

	/**
	 * @param flap 0..1 wing effort (hover ~0.5, boost 1)
	 * @param accel local acceleration (x = lateral, y = vertical) for antenna lag
	 */
	update(dt: number, time: number, flap: number, accel: THREE.Vector2, droop = 0): void {
		// Wings: fast rotation about the body axis, blurred by transparency.
		const freq = 16 + flap * 18;
		this.flapPhase += dt * freq * Math.PI * 2;
		const amp = (0.55 + flap * 0.5) * (1 - droop * 0.7);
		for (const w of this.wings) {
			const s = w.userData.side as number;
			const ph = this.flapPhase + (w.userData.hind ? 0.6 : 0);
			w.rotation.z = (Math.sin(ph) * amp + 0.25 - droop * 0.8) * s;
			w.rotation.x = Math.cos(ph) * 0.18;
		}
		// Legs dangle with a little lag.
		for (const l of this.legs) {
			const s = l.userData.side as number;
			const row = l.userData.row as number;
			l.rotation.x = 0.3 + row * 0.25 + Math.sin(time * 3 + row) * 0.12 - accel.y * 0.02;
			l.rotation.z = (0.35 + Math.sin(time * 2.4 + row * 1.3) * 0.08) * s;
		}
		// Antennae: damped spring driven by acceleration.
		const k = 60;
		const c = 7;
		this.antennaVel.x += (-k * this.antennaPos.x - c * this.antennaVel.x - accel.x * 0.6) * dt;
		this.antennaVel.y += (-k * this.antennaPos.y - c * this.antennaVel.y - accel.y * 0.6) * dt;
		this.antennaPos.addScaledVector(this.antennaVel, dt);
		this.antennaPos.clampScalar(-0.9, 0.9);
		for (const a of this.antennae) {
			a.rotation.x = this.antennaPos.y * 0.5 + Math.sin(time * 4) * 0.05;
			a.rotation.z = this.antennaPos.x * 0.5;
		}
		// Squash spring.
		this.squashVel += (-180 * this.squash - 12 * this.squashVel) * dt;
		this.squash += this.squashVel * dt;
		const sq = Math.max(-0.35, Math.min(0.35, this.squash));
		this.body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
		this.stinger.position.z = damp(this.stinger.position.z, -1.12 - this.stingOut * 0.35, 18, dt);

		this.updateFace(dt, time);
	}

	private updateFace(dt: number, time: number): void {
		if (this.expressionTimer > 0) {
			this.expressionTimer -= dt;
			if (this.expressionTimer <= 0) this.expression = 'happy';
		}
		this.blinkTimer -= dt;
		if (this.blinkTimer <= 0) {
			this.blink = 1;
			this.blinkTimer = 2 + Math.random() * 3;
		}
		this.blink = Math.max(0, this.blink - dt * 8);
		let lid = 0.1;
		let browAngle = 0;
		let browY = 0.33;
		let mouthO = false;
		let pupilScale = 1;
		let smile = 1;
		switch (this.expression) {
			case 'determined':
				lid = 0.45;
				browAngle = -0.45;
				browY = 0.3;
				smile = 0.6;
				break;
			case 'angry':
				lid = 0.5;
				browAngle = -0.7;
				browY = 0.29;
				smile = -0.8;
				break;
			case 'surprised':
				lid = 0;
				browY = 0.4;
				mouthO = true;
				pupilScale = 0.7;
				break;
			case 'dizzy':
				lid = 0.25;
				browAngle = 0.3;
				mouthO = true;
				break;
			case 'worried':
				lid = 0.2;
				browAngle = 0.45;
				browY = 0.36;
				smile = -0.6;
				break;
			case 'sleepy':
				lid = 0.75;
				smile = 0.3;
				break;
		}
		this.lidTarget = Math.max(lid, this.blink);
		const f = dampFactor(16, dt);
		for (let i = 0; i < 2; i++) {
			const s = i === 0 ? -1 : 1;
			const lidM = this.lids[i];
			// Lid is a dome: rotated back (-x) it hides inside the head, rotated forward it covers the eye.
			lidM.rotation.x += (-1.45 + this.lidTarget * 2.9 - lidM.rotation.x) * f;
			const brow = this.brows[i];
			brow.rotation.z += (browAngle * -s - brow.rotation.z) * f;
			brow.position.y += (browY - brow.position.y) * f;
			const p = this.pupils[i];
			p.scale.setScalar(p.scale.x + (pupilScale - p.scale.x) * f);
			if (this.expression === 'dizzy') {
				p.position.x = 0.012 * s + Math.cos(time * 12 + i * Math.PI) * 0.05;
				p.position.y = -0.01 + Math.sin(time * 12 + i * Math.PI) * 0.05;
			} else {
				p.position.x += (0.012 * s - p.position.x) * f;
				p.position.y += (-0.01 - p.position.y) * f;
			}
		}
		this.mouth.visible = !mouthO;
		this.mouthO.visible = mouthO;
		this.mouth.scale.y += (smile - this.mouth.scale.y) * f;
	}

	dispose(): void {
		if (this.ownsMats) {
			for (const mat of Object.values(this.mats)) {
				(mat as THREE.Material & { map?: THREE.Texture | null }).map?.dispose();
				(mat as THREE.Material).dispose();
			}
		}
	}
}
