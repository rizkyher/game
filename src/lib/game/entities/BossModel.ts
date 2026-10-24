import * as THREE from 'three';
import { damp, lerp } from '../utils/math';

/** Pose names the fight logic drives; each maps to target joint angles. */
export type BossPose =
	| 'dormant'
	| 'idle'
	| 'walk'
	| 'cleaveWind'
	| 'cleaveHit'
	| 'cleave2Wind'
	| 'cleave2Hit'
	| 'raise'
	| 'slamDown'
	| 'stuck'
	| 'cast'
	| 'punchGround'
	| 'summon'
	| 'beamCharge'
	| 'beam'
	| 'roar'
	| 'kneel'
	| 'dying';

export interface BossAnim {
	pose: BossPose;
	/** Speed (m/s) for the walk cycle. */
	speed: number;
	/** 0..1 glow on the fists / core before an attack lands. */
	telegraph: number;
	/** Core open and blazing (weak point). */
	exposed: boolean;
	/** Prism Ward (pillar shield) active. */
	warded: boolean;
	phase: number;
	/** 0..1 beam charge (core brightness). */
	charge: number;
}

interface Pose {
	torsoX: number;
	torsoY: number;
	hips: number;
	headX: number;
	shR: [number, number, number];
	shL: [number, number, number];
	elR: number;
	elL: number;
}

const WHITE = new THREE.Color(0xffffff);

const P = (torsoX: number, torsoY: number, hips: number, headX: number, shR: [number, number, number], shL: [number, number, number], elR: number, elL: number): Pose => ({ torsoX, torsoY, hips, headX, shR, shL, elR, elL });

/** Target joint angles per pose. Shoulder angles: x = swing forward(-)/back(+), y = twist, z = out(+R / -L). */
const POSES: Record<BossPose, Pose> = {
	dormant: P(0.55, 0, -1.3, 0.6, [-0.4, 0, 0.1], [-0.4, 0, -0.1], -1.4, -1.4),
	idle: P(0.12, 0, 0, 0.05, [-0.25, 0, 0.32], [-0.25, 0, -0.32], -0.55, -0.55),
	walk: P(0.16, 0, 0, 0.05, [-0.2, 0, 0.3], [-0.2, 0, -0.3], -0.5, -0.5),
	cleaveWind: P(-0.05, 0.85, 0, -0.05, [-0.6, 0, 1.55], [-0.5, 0, -0.4], -0.25, -0.9),
	cleaveHit: P(0.25, -0.75, -0.15, 0.1, [-1.5, 0, -0.35], [0.1, 0, -0.5], -0.15, -0.6),
	cleave2Wind: P(-0.05, -0.85, 0, -0.05, [-0.5, 0, 0.4], [-0.6, 0, -1.55], -0.9, -0.25),
	cleave2Hit: P(0.25, 0.75, -0.15, 0.1, [0.1, 0, 0.5], [-1.5, 0, 0.35], -0.6, -0.15),
	raise: P(-0.35, 0, 0.1, -0.35, [-2.85, 0, 0.25], [-2.85, 0, -0.25], -0.35, -0.35),
	slamDown: P(0.75, 0, -0.7, 0.25, [-1.15, 0, 0.12], [-1.15, 0, -0.12], -0.1, -0.1),
	stuck: P(0.85, 0, -0.85, 0.35, [-1.0, 0, 0.18], [-1.0, 0, -0.18], -0.05, -0.05),
	cast: P(0.0, 0.25, 0, 0.0, [-1.55, 0.2, 0.15], [-0.3, 0, -0.5], -0.1, -0.8),
	punchGround: P(0.6, -0.2, -0.5, 0.25, [-0.5, 0, 0.5], [-1.2, 0, -0.1], -0.6, -0.05),
	summon: P(-0.4, 0, 0.05, -0.6, [-2.6, 0, 0.75], [-2.6, 0, -0.75], -0.25, -0.25),
	beamCharge: P(0.35, 0, -0.35, 0.2, [0.45, 0, 0.9], [0.45, 0, -0.9], -1.1, -1.1),
	beam: P(-0.1, 0, -0.25, -0.05, [0.7, 0, 1.1], [0.7, 0, -1.1], -0.6, -0.6),
	roar: P(-0.45, 0, 0.0, -0.75, [-0.3, 0, 1.35], [-0.3, 0, -1.35], -0.7, -0.7),
	kneel: P(0.6, 0, -1.1, 0.55, [-0.1, 0, 0.35], [-0.1, 0, -0.35], -0.2, -0.2),
	dying: P(0.9, 0, -1.4, 0.8, [0.0, 0, 0.5], [0.0, 0, -0.5], -0.1, -0.1)
};

/**
 * Azrak, the Crystal Tyrant: a seven-metre stone-and-crystal giant with a caged core in its
 * chest, a crown of spikes and orbiting shards. Procedural, jointed, posed by name.
 */
export class AzrakRig {
	readonly root = new THREE.Group();
	private hips = new THREE.Group();
	private torso = new THREE.Group();
	private head = new THREE.Group();
	private shR = new THREE.Group();
	private shL = new THREE.Group();
	private elR = new THREE.Group();
	private elL = new THREE.Group();
	private fistR = new THREE.Group();
	private fistL = new THREE.Group();
	private legR = new THREE.Group();
	private legL = new THREE.Group();
	private kneeR = new THREE.Group();
	private kneeL = new THREE.Group();
	private halo = new THREE.Group();
	private core: THREE.Mesh;
	private coreLight: THREE.PointLight;
	private ribs: THREE.Mesh[] = [];
	private ward: THREE.Mesh;
	private wardMat: THREE.ShaderMaterial;
	private stone: THREE.MeshStandardMaterial;
	private crystal: THREE.MeshStandardMaterial;
	private coreMat: THREE.MeshStandardMaterial;
	private eyeMat: THREE.MeshStandardMaterial;
	private fistMat: THREE.MeshStandardMaterial;
	private geos: THREE.BufferGeometry[] = [];
	private t = 0;
	private flashK = 0;
	private walkPhase = 0;
	private cur: Pose = { ...POSES.dormant, shR: [...POSES.dormant.shR], shL: [...POSES.dormant.shL] };
	private dissolveK = 0;
	private crystalBase = new THREE.Color(0xd070ff);
	private crystalRage = new THREE.Color(0xff3a8a);
	private tmpC = new THREE.Color();

	constructor() {
		const g = <T extends THREE.BufferGeometry>(x: T) => (this.geos.push(x), x);
		this.stone = new THREE.MeshStandardMaterial({ color: 0x3c3650, roughness: 0.85, metalness: 0.05, flatShading: true });
		this.crystal = new THREE.MeshStandardMaterial({ color: 0xe8c8ff, emissive: 0xb050ff, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.1, flatShading: true });
		this.fistMat = new THREE.MeshStandardMaterial({ color: 0xd8b8ff, emissive: 0x9040e0, emissiveIntensity: 1.0, roughness: 0.25, flatShading: true });
		this.coreMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xff60e0, emissiveIntensity: 4, roughness: 0.1 });
		this.eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa0ff, emissiveIntensity: 0 });
		const stone = this.stone;
		const crystal = this.crystal;
		const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.torso) => {
			const m = new THREE.Mesh(geo, mat);
			m.position.set(x, y, z);
			m.castShadow = true;
			parent.add(m);
			return m;
		};
		const shard = (h: number, r: number) => {
			const c = g(new THREE.ConeGeometry(r, h, 5));
			c.translate(0, h / 2, 0);
			return c;
		};

		// Hips and legs.
		this.hips.position.y = 2.9;
		this.root.add(this.hips);
		const pelvis = g(new THREE.IcosahedronGeometry(1, 0));
		pelvis.scale(1.35, 0.7, 0.95);
		mesh(pelvis, stone, 0, 0, 0, this.hips);
		const thigh = g(new THREE.CylinderGeometry(0.55, 0.42, 1.6, 6));
		thigh.translate(0, -0.8, 0);
		const shin = g(new THREE.CylinderGeometry(0.5, 0.62, 1.5, 6));
		shin.translate(0, -0.75, 0);
		const foot = g(new THREE.BoxGeometry(1.0, 0.45, 1.5));
		for (const [leg, knee, side] of [
			[this.legR, this.kneeR, 1],
			[this.legL, this.kneeL, -1]
		] as const) {
			leg.position.set(side * 0.8, -0.2, 0);
			this.hips.add(leg);
			mesh(thigh, stone, 0, 0, 0, leg);
			knee.position.y = -1.55;
			leg.add(knee);
			mesh(shin, stone, 0, 0, 0, knee);
			mesh(foot, stone, 0, -1.4, 0.2, knee);
			const ks = mesh(shard(0.7, 0.22), crystal, 0, 0.05, 0.4, knee);
			ks.rotation.x = 1.1;
		}

		// Torso: faceted chest with a caged core.
		this.torso.position.y = 0.4;
		this.hips.add(this.torso);
		const chest = g(new THREE.IcosahedronGeometry(1, 0));
		chest.scale(1.9, 1.65, 1.25);
		chest.translate(0, 1.55, 0);
		mesh(chest, stone);
		const belly = g(new THREE.CylinderGeometry(0.95, 1.2, 1.0, 7));
		belly.translate(0, 0.35, 0);
		mesh(belly, stone);
		this.core = mesh(g(new THREE.OctahedronGeometry(0.48, 0)), this.coreMat, 0, 1.55, 1.05);
		this.core.scale.set(1, 1.35, 0.8);
		this.coreLight = new THREE.PointLight(0xff60e0, 6, 16, 2);
		this.coreLight.position.set(0, 1.55, 1.6);
		this.torso.add(this.coreLight);
		const rib = g(new THREE.BoxGeometry(0.16, 1.5, 0.22));
		for (let i = 0; i < 4; i++) {
			const r = mesh(rib, stone, (i - 1.5) * 0.36, 1.55, 1.22);
			r.rotation.z = (i - 1.5) * 0.18;
			this.ribs.push(r);
		}
		// Crystal growths on the back and shoulders.
		const backShard = shard(2.0, 0.42);
		for (let i = 0; i < 5; i++) {
			const s = mesh(backShard, crystal, (i - 2) * 0.55, 2.0 + Math.abs(i - 2) * -0.15, -0.9);
			s.rotation.set(-0.65, 0, (i - 2) * -0.32);
			s.scale.setScalar(1 - Math.abs(i - 2) * 0.18);
		}

		// Head with a crown of spikes.
		this.head.position.set(0, 3.15, 0.25);
		this.torso.add(this.head);
		const skull = g(new THREE.OctahedronGeometry(0.62, 0));
		skull.scale(1, 0.9, 1.05);
		mesh(skull, stone, 0, 0.3, 0, this.head);
		const jaw = g(new THREE.BoxGeometry(0.75, 0.3, 0.6));
		mesh(jaw, stone, 0, -0.08, 0.15, this.head);
		const eye = g(new THREE.BoxGeometry(0.2, 0.07, 0.06));
		for (const sx of [-0.2, 0.2]) {
			const e = mesh(eye, this.eyeMat, sx, 0.34, 0.56, this.head);
			e.rotation.z = sx > 0 ? -0.25 : 0.25;
		}
		for (let i = 0; i < 7; i++) {
			const a = (i / 6 - 0.5) * 2.2;
			const s = mesh(shard(1.1 - Math.abs(i - 3) * 0.12, 0.13), crystal, Math.sin(a) * 0.5, 0.65, Math.cos(a) * 0.2 - 0.15, this.head);
			s.rotation.set(-0.3, 0, -a * 0.55);
		}

		// Arms.
		const upper = g(new THREE.CylinderGeometry(0.5, 0.42, 1.7, 6));
		upper.translate(0, -0.85, 0);
		const fore = g(new THREE.CylinderGeometry(0.46, 0.62, 1.6, 6));
		fore.translate(0, -0.8, 0);
		const pauldron = g(new THREE.IcosahedronGeometry(0.85, 0));
		const fist = g(new THREE.DodecahedronGeometry(0.85, 0));
		fist.scale(1, 1.05, 1.1);
		for (const [sh, el, fistG, side] of [
			[this.shR, this.elR, this.fistR, 1],
			[this.shL, this.elL, this.fistL, -1]
		] as const) {
			sh.position.set(side * 2.0, 2.55, 0);
			this.torso.add(sh);
			mesh(pauldron, stone, side * 0.15, 0.1, 0, sh);
			for (let i = 0; i < 3; i++) {
				const s = mesh(shard(1.2 - i * 0.25, 0.2), crystal, side * (0.3 + i * 0.12), 0.5, (i - 1) * 0.35, sh);
				s.rotation.set((i - 1) * 0.4, 0, -side * (0.5 + i * 0.15));
			}
			mesh(upper, stone, 0, 0, 0, sh);
			el.position.y = -1.65;
			sh.add(el);
			mesh(fore, stone, 0, 0, 0, el);
			fistG.position.y = -1.95;
			el.add(fistG);
			mesh(fist, this.fistMat, 0, 0, 0, fistG);
			for (let i = 0; i < 4; i++) {
				const k = mesh(shard(0.45, 0.12), crystal, (i - 1.5) * 0.32, -0.35, 0.65, fistG);
				k.rotation.x = 1.9;
			}
		}

		// Orbiting shard halo behind the shoulders.
		this.halo.position.set(0, 2.6, -1.4);
		this.torso.add(this.halo);
		const haloShard = g(new THREE.OctahedronGeometry(0.35, 0));
		haloShard.scale(0.6, 1.8, 0.6);
		for (let i = 0; i < 9; i++) {
			const a = (i / 9) * Math.PI * 2;
			const s = mesh(haloShard, crystal, Math.cos(a) * 2.4, Math.sin(a) * 2.4, 0, this.halo);
			s.rotation.z = a + Math.PI / 2;
		}

		// Prism Ward bubble (pillar shield).
		this.wardMat = new THREE.ShaderMaterial({
			uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
			vertexShader: /* glsl */ `
				varying vec3 vN;
				varying vec3 vV;
				varying vec3 vP;
				void main() {
					vec4 wp = modelMatrix * vec4(position, 1.0);
					vP = position;
					vN = normalize(mat3(modelMatrix) * normal);
					vV = normalize(cameraPosition - wp.xyz);
					gl_Position = projectionMatrix * viewMatrix * wp;
				}
			`,
			fragmentShader: /* glsl */ `
				uniform float uTime;
				uniform float uAlpha;
				varying vec3 vN;
				varying vec3 vV;
				varying vec3 vP;
				void main() {
					float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);
					float hex = abs(sin(vP.x * 2.6 + uTime) * sin(vP.y * 2.6 - uTime * 0.7) * sin(vP.z * 2.6));
					vec3 c = mix(vec3(0.85, 0.35, 1.0), vec3(0.4, 0.9, 1.0), 0.5 + 0.5 * sin(vP.y * 0.8 + uTime * 1.5));
					float a = (f * 0.9 + smoothstep(0.85, 1.0, hex) * 0.35) * uAlpha;
					gl_FragColor = vec4(c * a * 1.6, a);
				}
			`,
			transparent: true,
			depthWrite: false,
			blending: THREE.CustomBlending,
			blendSrc: THREE.OneFactor,
			blendDst: THREE.OneFactor
		});
		this.ward = new THREE.Mesh(g(new THREE.IcosahedronGeometry(4.6, 2)), this.wardMat);
		this.ward.position.y = 4.2;
		this.ward.scale.set(1, 1.2, 1);
		this.ward.visible = false;
		this.root.add(this.ward);
	}

	handPosition(side: 'L' | 'R', out: THREE.Vector3): THREE.Vector3 {
		return (side === 'R' ? this.fistR : this.fistL).getWorldPosition(out);
	}

	corePosition(out: THREE.Vector3): THREE.Vector3 {
		return this.core.getWorldPosition(out);
	}

	headPosition(out: THREE.Vector3): THREE.Vector3 {
		return this.head.getWorldPosition(out);
	}

	flash(k: number): void {
		this.flashK = Math.max(this.flashK, k);
	}

	/** 0 = intact, 1 = gone. */
	dissolve(k: number): void {
		this.dissolveK = k;
	}

	update(dt: number, a: BossAnim): void {
		this.t += dt;
		const t = this.t;
		const target = POSES[a.pose];
		const fast = a.pose === 'cleaveHit' || a.pose === 'cleave2Hit' || a.pose === 'slamDown' || a.pose === 'punchGround' ? 16 : a.pose === 'dormant' || a.pose === 'dying' ? 1.6 : 6;
		const c = this.cur;
		c.torsoX = damp(c.torsoX, target.torsoX, fast, dt);
		c.torsoY = damp(c.torsoY, target.torsoY, fast, dt);
		c.hips = damp(c.hips, target.hips, fast * 0.7, dt);
		c.headX = damp(c.headX, target.headX, fast, dt);
		for (let i = 0; i < 3; i++) {
			c.shR[i] = damp(c.shR[i], target.shR[i], fast, dt);
			c.shL[i] = damp(c.shL[i], target.shL[i], fast, dt);
		}
		c.elR = damp(c.elR, target.elR, fast, dt);
		c.elL = damp(c.elL, target.elL, fast, dt);

		// Walk cycle and breathing layered on top.
		const walkK = Math.min(1, a.speed / 3);
		this.walkPhase += dt * a.speed * 1.15;
		const sw = Math.sin(this.walkPhase) * 0.5 * walkK;
		const breathe = Math.sin(t * 1.4) * 0.03;
		this.hips.position.y = 2.9 + c.hips + Math.abs(Math.cos(this.walkPhase)) * 0.12 * walkK;
		this.legR.rotation.x = sw + Math.min(0, c.hips) * 0.9;
		this.legL.rotation.x = -sw + Math.min(0, c.hips) * 0.9;
		this.kneeR.rotation.x = Math.max(0, -sw) * 0.8 + Math.max(0, -c.hips) * 1.4;
		this.kneeL.rotation.x = Math.max(0, sw) * 0.8 + Math.max(0, -c.hips) * 1.4;
		this.torso.rotation.set(c.torsoX + breathe, c.torsoY + sw * 0.15, 0);
		this.torso.scale.setScalar(1 + breathe * 0.3);
		this.head.rotation.x = c.headX - c.torsoX * 0.4;
		this.shR.rotation.set(c.shR[0] - sw * 0.35, c.shR[1], c.shR[2]);
		this.shL.rotation.set(c.shL[0] + sw * 0.35, c.shL[1], c.shL[2]);
		this.elR.rotation.x = c.elR;
		this.elL.rotation.x = c.elL;
		this.halo.rotation.z = t * (0.4 + a.phase * 0.25);

		// Colour, glow and the core.
		const rage = a.phase >= 3 ? 1 : 0;
		this.tmpC.copy(this.crystalBase).lerp(this.crystalRage, rage);
		this.flashK = Math.max(0, this.flashK - dt * 6);
		const awake = a.pose === 'dormant' ? 0.15 : 1;
		this.crystal.emissive.copy(this.tmpC);
		this.crystal.emissiveIntensity = (1.4 + Math.sin(t * 2.2) * 0.25 + this.flashK * 2.5) * awake;
		this.fistMat.emissive.copy(this.tmpC);
		this.fistMat.emissiveIntensity = (0.8 + a.telegraph * 4 + this.flashK * 2) * awake;
		this.stone.emissive.setRGB(this.flashK * 0.5, this.flashK * 0.35, this.flashK * 0.6);
		this.eyeMat.emissiveIntensity = lerp(this.eyeMat.emissiveIntensity, a.pose === 'dormant' ? 0 : 5 + rage * 3, Math.min(1, dt * 3));
		this.eyeMat.emissive.copy(this.tmpC).lerp(WHITE, 0.4);
		const coreK = (a.exposed ? 9 : 3.2) + a.charge * 10 + Math.sin(t * (a.exposed ? 9 : 3)) * (a.exposed ? 2 : 0.6);
		this.coreMat.emissive.copy(this.tmpC).lerp(WHITE, a.exposed ? 0.35 : 0.1);
		this.coreMat.emissiveIntensity = coreK * awake;
		this.core.scale.set(1 + a.charge * 0.5, 1.35 + a.charge * 0.6, 0.8 + a.charge * 0.4);
		this.core.rotation.y = t * (1 + a.charge * 6);
		this.coreLight.color.copy(this.tmpC);
		this.coreLight.intensity = (a.exposed ? 14 : 5) * awake + a.charge * 20;
		// The rib cage opens when the core is exposed.
		this.ribs.forEach((r, i) => {
			const open = a.exposed ? 1 : 0;
			r.position.x = damp(r.position.x, (i - 1.5) * (0.36 + open * 0.42), 8, dt);
			r.rotation.z = (i - 1.5) * (0.18 + open * 0.35);
		});
		this.ward.visible = a.warded || this.wardMat.uniforms.uAlpha.value > 0.02;
		this.wardMat.uniforms.uAlpha.value = damp(this.wardMat.uniforms.uAlpha.value, a.warded ? 1 : 0, 4, dt);
		this.wardMat.uniforms.uTime.value = t;
		this.ward.rotation.y = t * 0.2;

		if (this.dissolveK > 0) {
			const k = this.dissolveK;
			this.root.scale.setScalar(Math.max(0.001, 1 - k * 0.15));
			this.root.visible = k < 0.999;
			this.stone.transparent = this.crystal.transparent = true;
			this.stone.opacity = this.crystal.opacity = this.fistMat.opacity = Math.max(0, 1 - k);
			this.fistMat.transparent = true;
		}
	}

	reset(): void {
		this.dissolveK = 0;
		this.root.visible = true;
		this.root.scale.setScalar(1);
		this.stone.transparent = this.crystal.transparent = this.fistMat.transparent = false;
		this.stone.opacity = this.crystal.opacity = this.fistMat.opacity = 1;
		this.cur = { ...POSES.dormant, shR: [...POSES.dormant.shR], shL: [...POSES.dormant.shL] };
		this.wardMat.uniforms.uAlpha.value = 0;
	}

	dispose(): void {
		for (const g of this.geos) g.dispose();
		for (const m of [this.stone, this.crystal, this.coreMat, this.eyeMat, this.fistMat, this.wardMat]) m.dispose();
	}
}
