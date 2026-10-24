import * as THREE from 'three';
import type { Terrain } from '../world/Terrain';
import { ParticlePool, defaultParams, type EmitParams } from './ParticlePool';
import { createParticleAtlas, createRuneCircle, type TileName } from './Textures';
import { ArcPool, BeamPool, CirclePool, LightPool, RingPool, ShieldBubble, SpikePool, TelegraphPool } from './VfxPrimitives';
import type { Element } from '../combat/types';
import { ELEMENT_COLORS } from '../combat/types';

export type ProjectileKind = 'fireball' | 'iceShard' | 'windBlade' | 'shadowBolt' | 'hexBolt' | 'crystalShard' | 'arcaneOrb' | 'reflected';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const _q = new THREE.Quaternion();
const FWD = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);

const CORE_VERT = /* glsl */ `
	varying vec3 vN;
	varying vec3 vView;
	void main() {
		vec4 wp = modelMatrix * vec4(position, 1.0);
		vN = normalize(mat3(modelMatrix) * normal);
		vView = normalize(cameraPosition - wp.xyz);
		gl_Position = projectionMatrix * viewMatrix * wp;
	}
`;

const CORE_FRAG = /* glsl */ `
	uniform vec3 uColor;
	uniform vec3 uHot;
	uniform float uAlpha;
	varying vec3 vN;
	varying vec3 vView;
	void main() {
		float f = abs(dot(normalize(vN), vView));
		vec3 col = mix(uColor, uHot, pow(f, 2.0));
		float a = (0.35 + pow(f, 1.5) * 0.65) * uAlpha;
		gl_FragColor = vec4(col * a, a);
	}
`;

/** Flat crescent in the XZ plane bulging toward +Z; uv.x runs along the arc, uv.y inner→outer. */
function crescentGeometry(inner: number, outer: number, span: number, seg: number): THREE.BufferGeometry {
	const pos: number[] = [];
	const uv: number[] = [];
	const idx: number[] = [];
	for (let i = 0; i <= seg; i++) {
		const t = i / seg;
		const a = Math.PI / 2 - span / 2 + span * t;
		// Thicker in the middle, sharp at the tips.
		const w = Math.sin(t * Math.PI);
		const ri = outer - (outer - inner) * w;
		pos.push(Math.cos(a) * ri, 0, Math.sin(a) * ri, Math.cos(a) * outer, 0, Math.sin(a) * outer);
		uv.push(t, 0, t, 1);
		if (i > 0) {
			const b = (i - 1) * 2;
			idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
	g.setIndex(idx);
	g.computeVertexNormals();
	return g;
}

function additive(frag: string, vert: string, uniforms: Record<string, THREE.IUniform>, side: THREE.Side = THREE.FrontSide): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		uniforms,
		vertexShader: vert,
		fragmentShader: frag,
		transparent: true,
		depthWrite: false,
		side,
		blending: THREE.CustomBlending,
		blendSrc: THREE.OneFactor,
		blendDst: THREE.OneFactor
	});
}

/** Visual stand-in for one projectile in flight. */
export class ProjectileVisual {
	readonly group = new THREE.Group();
	readonly core: THREE.Mesh;
	readonly halo: THREE.Sprite;
	readonly shard: THREE.Mesh;
	readonly blade: THREE.Mesh;
	readonly coreMat: THREE.ShaderMaterial;
	readonly shardMat: THREE.MeshStandardMaterial;
	readonly bladeMat: THREE.ShaderMaterial;
	readonly haloMat: THREE.SpriteMaterial;
	kind: ProjectileKind = 'fireball';
	active = false;
	trailAcc = 0;
	spin = 0;
	scale = 1;
	private coreR = 0.3;

	constructor(coreGeo: THREE.BufferGeometry, shardGeo: THREE.BufferGeometry, bladeGeo: THREE.BufferGeometry, glowTex: THREE.Texture) {
		this.coreMat = additive(CORE_FRAG, CORE_VERT, { uColor: { value: new THREE.Color() }, uHot: { value: new THREE.Color() }, uAlpha: { value: 1 } });
		this.core = new THREE.Mesh(coreGeo, this.coreMat);
		this.haloMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
		this.halo = new THREE.Sprite(this.haloMat);
		this.shardMat = new THREE.MeshStandardMaterial({ color: 0xbff4ff, emissive: 0x3ac8ff, emissiveIntensity: 1.6, roughness: 0.1, metalness: 0.2, flatShading: true, transparent: true, opacity: 0.9 });
		this.shard = new THREE.Mesh(shardGeo, this.shardMat);
		this.bladeMat = additive(
			/* glsl */ `
				uniform vec3 uColor;
				varying vec2 vUv;
				void main() {
					float edge = smoothstep(0.0, 0.6, vUv.y);
					float tip = sin(vUv.x * 3.14159);
					float a = edge * tip * 0.95;
					gl_FragColor = vec4(uColor * a * (1.0 + edge * 1.5), a);
				}
			`,
			/* glsl */ `
				varying vec2 vUv;
				void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
			`,
			{ uColor: { value: new THREE.Color() } },
			THREE.DoubleSide
		);
		this.blade = new THREE.Mesh(bladeGeo, this.bladeMat);
		this.group.add(this.core, this.halo, this.shard, this.blade);
		this.group.visible = false;
		this.core.renderOrder = 19;
		this.halo.renderOrder = 19;
		this.blade.renderOrder = 19;
	}

	setup(kind: ProjectileKind, scale: number): void {
		this.kind = kind;
		this.scale = scale;
		this.active = true;
		this.group.visible = true;
		this.trailAcc = 0;
		this.spin = Math.random() * Math.PI * 2;
		this.core.visible = true;
		this.halo.visible = true;
		this.shard.visible = false;
		this.blade.visible = false;
		const cc = this.coreMat.uniforms.uColor.value as THREE.Color;
		const hot = this.coreMat.uniforms.uHot.value as THREE.Color;
		let coreR = 0.32;
		let haloS = 2.2;
		switch (kind) {
			case 'fireball':
				cc.setHex(0xff4a10).multiplyScalar(2.5);
				hot.setHex(0xfff0b0).multiplyScalar(3.5);
				this.haloMat.color.setHex(0xff7a2a).multiplyScalar(1.3);
				coreR = 0.36;
				haloS = 2.6;
				break;
			case 'iceShard':
				cc.setHex(0x3ad8ff).multiplyScalar(1.5);
				hot.setHex(0xe8ffff).multiplyScalar(2.2);
				this.haloMat.color.setHex(0x5ae6ff).multiplyScalar(0.9);
				this.shard.visible = true;
				this.shardMat.emissive.setHex(0x3ac8ff);
				this.shardMat.color.setHex(0xbff4ff);
				coreR = 0.14;
				haloS = 1.4;
				break;
			case 'crystalShard':
				cc.setHex(0xd060ff).multiplyScalar(1.8);
				hot.setHex(0xffd0ff).multiplyScalar(2.2);
				this.haloMat.color.setHex(0xd070ff);
				this.shard.visible = true;
				this.shardMat.emissive.setHex(0xb040ff);
				this.shardMat.color.setHex(0xe8b0ff);
				coreR = 0.16;
				haloS = 1.8;
				break;
			case 'windBlade':
				cc.setHex(0x7dffc4).multiplyScalar(1.4);
				hot.setHex(0xffffff).multiplyScalar(2);
				this.haloMat.color.setHex(0x7dffc4).multiplyScalar(0.6);
				(this.bladeMat.uniforms.uColor.value as THREE.Color).setHex(0xa8ffe0).multiplyScalar(1.6);
				this.blade.visible = true;
				coreR = 0.12;
				haloS = 1.6;
				break;
			case 'shadowBolt':
				cc.setHex(0x7a10ff).multiplyScalar(2);
				hot.setHex(0xffb0ff).multiplyScalar(2.5);
				this.haloMat.color.setHex(0xb030ff);
				coreR = 0.3;
				haloS = 2.2;
				break;
			case 'hexBolt':
				cc.setHex(0xff2aa0).multiplyScalar(2.2);
				hot.setHex(0xffffff).multiplyScalar(2.5);
				this.haloMat.color.setHex(0xff40c0);
				coreR = 0.2;
				haloS = 1.8;
				break;
			case 'arcaneOrb':
			case 'reflected':
				cc.setHex(0xffd070).multiplyScalar(2.2);
				hot.setHex(0xffffff).multiplyScalar(3);
				this.haloMat.color.setHex(0xffe0a0);
				coreR = 0.3;
				haloS = 2.4;
				break;
		}
		this.coreR = coreR * scale;
		this.core.scale.setScalar(this.coreR);
		this.halo.scale.setScalar(haloS * scale);
		this.shard.scale.setScalar(scale);
		this.blade.scale.setScalar(scale * (kind === 'windBlade' ? 1.4 : 1));
		this.coreMat.uniforms.uAlpha.value = 1;
	}

	place(pos: THREE.Vector3, vel: THREE.Vector3, dt: number, time: number): void {
		this.group.position.copy(pos);
		_v.copy(vel).normalize();
		_q.setFromUnitVectors(FWD, _v);
		this.group.quaternion.copy(_q);
		this.spin += dt * (this.kind === 'windBlade' ? 0 : 6);
		if (this.kind === 'iceShard' || this.kind === 'crystalShard') this.shard.rotation.z = this.spin;
		const flick = 0.9 + Math.sin(time * 40 + this.spin) * 0.1;
		this.halo.material.opacity = flick;
		this.core.scale.setScalar(this.coreR * (this.kind === 'fireball' ? flick : 1));
	}

	hide(): void {
		this.active = false;
		this.group.visible = false;
	}
}

interface TornadoVisual {
	group: THREE.Group;
	shells: THREE.Mesh[];
	mats: THREE.ShaderMaterial[];
	active: boolean;
	attractor: number;
	fire: boolean;
	acc: number;
	radius: number;
}

const TORNADO_VERT = /* glsl */ `
	uniform float uTime;
	uniform float uTwist;
	varying vec2 vUv;
	varying float vH;
	void main() {
		vUv = uv;
		vec3 p = position;
		float h = p.y;
		vH = h;
		float a = h * uTwist + uTime * 3.0;
		float c = cos(a);
		float s = sin(a);
		p.xz = mat2(c, -s, s, c) * p.xz;
		p.xz += vec2(sin(uTime * 2.0 + h * 1.3), cos(uTime * 1.7 + h)) * 0.15 * h;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
	}
`;

const TORNADO_FRAG = /* glsl */ `
	uniform vec3 uColor;
	uniform float uTime;
	uniform float uAlpha;
	varying vec2 vUv;
	varying float vH;
	float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
	float noise(vec2 p) {
		vec2 i = floor(p); vec2 f = fract(p);
		vec2 u = f * f * (3.0 - 2.0 * f);
		return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
	}
	void main() {
		float n = noise(vec2(vUv.x * 9.0 - uTime * 2.5, vUv.y * 5.0 - uTime * 3.5));
		float streak = smoothstep(0.45, 0.85, n);
		float fade = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
		float a = streak * fade * uAlpha;
		gl_FragColor = vec4(uColor * a, a);
	}
`;

/**
 * Composes particles, rings, rune circles, arcs, beams, spikes and lights into readable,
 * element-specific spell effects. All effect pieces are pooled.
 */
export class MagicVFX {
	readonly add: ParticlePool;
	readonly alpha: ParticlePool;
	readonly rings: RingPool;
	readonly circles: CirclePool;
	readonly telegraphs: TelegraphPool;
	readonly arcs: ArcPool;
	readonly beams: BeamPool;
	readonly spikes: SpikePool;
	readonly shield: ShieldBubble;
	readonly lights: LightPool;
	private atlas: THREE.Texture;
	private rune: THREE.Texture;
	private glowTex: THREE.Texture;
	private projectiles: ProjectileVisual[] = [];
	private tornados: TornadoVisual[] = [];
	private shared: THREE.BufferGeometry[] = [];
	private p: EmitParams = defaultParams();
	private time = 0;
	/** Scales particle counts (quality preset). */
	quality = 1;

	constructor(
		private scene: THREE.Scene,
		camera: THREE.Camera,
		private terrain: Terrain
	) {
		this.atlas = createParticleAtlas();
		this.rune = createRuneCircle();
		this.glowTex = this.makeGlowTexture();
		this.add = new ParticlePool(this.atlas, 5000, true);
		this.alpha = new ParticlePool(this.atlas, 1800, false);
		scene.add(this.add.mesh, this.alpha.mesh);
		this.rings = new RingPool(scene, 28);
		this.circles = new CirclePool(scene, 18, this.rune);
		this.telegraphs = new TelegraphPool(scene, 28, terrain);
		this.arcs = new ArcPool(scene, 28, camera);
		this.beams = new BeamPool(scene, 6);
		this.spikes = new SpikePool(scene, 120);
		this.shield = new ShieldBubble(scene);
		this.lights = new LightPool(scene, 4);
		// Projectile visuals.
		const coreGeo = new THREE.SphereGeometry(1, 16, 12);
		const shardGeo = new THREE.OctahedronGeometry(1, 0);
		shardGeo.scale(0.16, 0.16, 0.75);
		const bladeGeo = crescentGeometry(0.55, 1.0, Math.PI * 0.75, 24);
		bladeGeo.translate(0, 0, -0.6);
		this.shared.push(coreGeo, shardGeo, bladeGeo);
		for (let i = 0; i < 48; i++) {
			const v = new ProjectileVisual(coreGeo, shardGeo, bladeGeo, this.glowTex);
			scene.add(v.group);
			this.projectiles.push(v);
		}
		// Tornado visuals.
		const shellGeo = new THREE.CylinderGeometry(1.6, 0.35, 7, 20, 10, true);
		shellGeo.translate(0, 3.5, 0);
		this.shared.push(shellGeo);
		for (let i = 0; i < 4; i++) {
			const group = new THREE.Group();
			const shells: THREE.Mesh[] = [];
			const mats: THREE.ShaderMaterial[] = [];
			for (let k = 0; k < 3; k++) {
				const mat = new THREE.ShaderMaterial({
					uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: k * 3 }, uAlpha: { value: 1 }, uTwist: { value: 0.7 + k * 0.25 } },
					vertexShader: TORNADO_VERT,
					fragmentShader: TORNADO_FRAG,
					transparent: true,
					depthWrite: false,
					side: THREE.DoubleSide,
					blending: THREE.CustomBlending,
					blendSrc: THREE.OneFactor,
					blendDst: THREE.OneFactor
				});
				const m = new THREE.Mesh(shellGeo, mat);
				m.scale.set(1 - k * 0.22, 1 - k * 0.08, 1 - k * 0.22);
				m.renderOrder = 18;
				m.frustumCulled = false;
				group.add(m);
				shells.push(m);
				mats.push(mat);
			}
			group.visible = false;
			scene.add(group);
			this.tornados.push({ group, shells, mats, active: false, attractor: i, fire: false, acc: 0, radius: 3 });
		}
	}

	private makeGlowTexture(): THREE.Texture {
		const c = document.createElement('canvas');
		c.width = c.height = 128;
		const ctx = c.getContext('2d')!;
		const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
		g.addColorStop(0, 'rgba(255,255,255,1)');
		g.addColorStop(0.2, 'rgba(255,255,255,0.7)');
		g.addColorStop(0.5, 'rgba(255,255,255,0.18)');
		g.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 128, 128);
		const t = new THREE.CanvasTexture(c);
		t.colorSpace = THREE.SRGBColorSpace;
		return t;
	}

	setQuality(k: number): void {
		this.quality = k;
		this.add.scale = k;
		this.alpha.scale = k;
	}

	// ---------------------------------------------------------------- emit helpers

	/** Resets and returns the shared parameter block for one emission. */
	private P(x: number, y: number, z: number, count: number, tile: TileName, color: number, colorEnd = color): EmitParams {
		const p = this.p;
		p.count = count;
		p.x = x;
		p.y = y;
		p.z = z;
		p.spread = 0;
		p.vx = p.vy = p.vz = 0;
		p.speedMin = 0;
		p.speedMax = 0;
		p.up = 0;
		p.lifeMin = 0.4;
		p.lifeMax = 0.8;
		p.sizeMin = 0.2;
		p.sizeMax = 0.4;
		p.sizeEnd = 1;
		p.color.setHex(color);
		p.colorEnd.setHex(colorEnd);
		p.alpha = 1;
		p.alphaEnd = 0;
		p.intensity = 1;
		p.tile = tile;
		p.stretch = 0;
		p.drag = 1;
		p.gravity = 0;
		p.spin = 0;
		p.attractor = -1;
		return p;
	}

	// ---------------------------------------------------------------- projectiles

	projectile(kind: ProjectileKind, scale = 1): ProjectileVisual | null {
		const v = this.projectiles.find((x) => !x.active);
		if (!v) return null;
		v.setup(kind, scale);
		return v;
	}

	/** Per-step trail emission for a projectile visual. */
	trail(v: ProjectileVisual, pos: THREE.Vector3, vel: THREE.Vector3, dt: number): void {
		v.place(pos, vel, dt, this.time);
		v.trailAcc += dt;
		const rate = 1 / 60;
		if (v.trailAcc < rate) return;
		v.trailAcc = 0;
		const s = v.scale;
		switch (v.kind) {
			case 'fireball': {
				let p = this.P(pos.x, pos.y, pos.z, 3, 'flame', 0xffc070, 0xff3a00);
				p.spread = 0.18 * s;
				p.speedMin = 0.3;
				p.speedMax = 1.2;
				p.vx = -vel.x * 0.06;
				p.vy = -vel.y * 0.06 + 0.6;
				p.vz = -vel.z * 0.06;
				p.lifeMin = 0.18;
				p.lifeMax = 0.35;
				p.sizeMin = 0.45 * s;
				p.sizeMax = 0.8 * s;
				p.sizeEnd = 0.3;
				p.intensity = 2.4;
				p.spin = 3;
				this.add.emit(p);
				p = this.P(pos.x, pos.y, pos.z, 2, 'spark', 0xffd080, 0xff5010);
				p.spread = 0.2;
				p.speedMin = 1;
				p.speedMax = 3;
				p.up = 1.5;
				p.gravity = -4;
				p.lifeMin = 0.3;
				p.lifeMax = 0.7;
				p.sizeMin = 0.05;
				p.sizeMax = 0.09;
				p.stretch = 0.05;
				p.intensity = 3;
				this.add.emit(p);
				p = this.P(pos.x, pos.y, pos.z, 1, 'smoke', 0x3a2a24, 0x1a1414);
				p.spread = 0.2;
				p.vy = 0.8;
				p.lifeMin = 0.5;
				p.lifeMax = 0.9;
				p.sizeMin = 0.5 * s;
				p.sizeMax = 0.8 * s;
				p.sizeEnd = 2.2;
				p.alpha = 0.35;
				this.alpha.emit(p);
				break;
			}
			case 'iceShard':
			case 'crystalShard': {
				const ice = v.kind === 'iceShard';
				let p = this.P(pos.x, pos.y, pos.z, 1, 'glow', ice ? 0xbff6ff : 0xffb0ff, ice ? 0x2a8aff : 0x8a20ff);
				p.lifeMin = 0.15;
				p.lifeMax = 0.25;
				p.sizeMin = 0.35 * s;
				p.sizeMax = 0.45 * s;
				p.sizeEnd = 0.2;
				p.intensity = 1.8;
				this.add.emit(p);
				p = this.P(pos.x, pos.y, pos.z, 1, 'star', 0xffffff, ice ? 0x5ae6ff : 0xd070ff);
				p.spread = 0.15;
				p.speedMin = 0.2;
				p.speedMax = 0.8;
				p.lifeMin = 0.3;
				p.lifeMax = 0.6;
				p.sizeMin = 0.08;
				p.sizeMax = 0.16;
				p.intensity = 2.5;
				p.spin = 4;
				this.add.emit(p);
				if (ice) {
					p = this.P(pos.x, pos.y, pos.z, 1, 'smoke', 0xd8f6ff, 0xa8d8ff);
					p.spread = 0.1;
					p.vy = -0.3;
					p.lifeMin = 0.4;
					p.lifeMax = 0.7;
					p.sizeMin = 0.25;
					p.sizeMax = 0.4;
					p.sizeEnd = 2.4;
					p.alpha = 0.3;
					this.alpha.emit(p);
				}
				break;
			}
			case 'windBlade': {
				let p = this.P(pos.x, pos.y, pos.z, 2, 'spark', 0xd8fff0, 0x5affb0);
				p.spread = 0.5 * s;
				p.vx = vel.x * 0.4;
				p.vy = vel.y * 0.4;
				p.vz = vel.z * 0.4;
				p.lifeMin = 0.15;
				p.lifeMax = 0.3;
				p.sizeMin = 0.04;
				p.sizeMax = 0.07;
				p.stretch = 0.06;
				p.alpha = 0.7;
				p.intensity = 1.6;
				this.add.emit(p);
				if (Math.random() < 0.35) {
					p = this.P(pos.x, pos.y, pos.z, 1, 'leaf', 0x8fe070, 0x4a9a3a);
					p.spread = 0.4;
					p.speedMin = 1;
					p.speedMax = 3;
					p.gravity = -2;
					p.lifeMin = 0.6;
					p.lifeMax = 1.1;
					p.sizeMin = 0.12;
					p.sizeMax = 0.2;
					p.spin = 8;
					p.alpha = 1;
					p.alphaEnd = 0;
					this.alpha.emit(p);
				}
				break;
			}
			case 'shadowBolt':
			case 'hexBolt': {
				const hex = v.kind === 'hexBolt';
				const p = this.P(pos.x, pos.y, pos.z, 2, 'glow', hex ? 0xff60d0 : 0xb050ff, hex ? 0x600030 : 0x300060);
				p.spread = 0.15 * s;
				p.speedMin = 0.2;
				p.speedMax = 0.8;
				p.lifeMin = 0.25;
				p.lifeMax = 0.45;
				p.sizeMin = 0.4 * s;
				p.sizeMax = 0.6 * s;
				p.sizeEnd = 0.2;
				p.intensity = 1.8;
				this.add.emit(p);
				break;
			}
			case 'arcaneOrb':
			case 'reflected': {
				const p = this.P(pos.x, pos.y, pos.z, 2, 'star', 0xffffff, 0xffc050);
				p.spread = 0.2;
				p.speedMin = 0.3;
				p.speedMax = 1;
				p.lifeMin = 0.25;
				p.lifeMax = 0.5;
				p.sizeMin = 0.15;
				p.sizeMax = 0.3;
				p.intensity = 2.5;
				p.spin = 3;
				this.add.emit(p);
				break;
			}
		}
	}

	releaseProjectile(v: ProjectileVisual | null): void {
		v?.hide();
	}

	// ---------------------------------------------------------------- casting

	/** Gathering energy at the hand during wind-up / charge. `t` is 0..1. */
	gather(el: Element, pos: THREE.Vector3, t: number): void {
		const col = ELEMENT_COLORS[el];
		const r = 0.9 - t * 0.3;
		_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(r);
		const p = this.P(pos.x + _v.x, pos.y + _v.y, pos.z + _v.z, 1, el === 'lightning' ? 'spark' : 'glow', 0xffffff, col);
		p.vx = -_v.x * 3.5;
		p.vy = -_v.y * 3.5;
		p.vz = -_v.z * 3.5;
		p.drag = 0;
		p.lifeMin = 0.2;
		p.lifeMax = 0.26;
		p.sizeMin = 0.08 + t * 0.06;
		p.sizeMax = 0.14 + t * 0.08;
		p.stretch = el === 'lightning' ? 0.05 : 0;
		p.intensity = 2.5;
		this.add.emit(p);
		const q = this.P(pos.x, pos.y, pos.z, 1, 'glow', col, col);
		q.lifeMin = q.lifeMax = 0.06;
		q.sizeMin = q.sizeMax = 0.3 + t * 0.6;
		q.alpha = 0.8;
		q.alphaEnd = 0.6;
		q.intensity = 2 + t * 2;
		this.add.emit(q);
	}

	/** Release flash: muzzle ring, sparks and a light pop. */
	castBurst(el: Element, pos: THREE.Vector3, dir: THREE.Vector3, big = false): void {
		const col = ELEMENT_COLORS[el];
		this.rings.spawn(pos, col, 0.1, big ? 1.8 : 0.9, big ? 0.35 : 0.22, { normal: dir, thick: 0.35, intensity: 2.5 });
		const p = this.P(pos.x, pos.y, pos.z, big ? 18 : 8, 'spark', 0xffffff, col);
		p.speedMin = 2;
		p.speedMax = big ? 9 : 6;
		p.vx = dir.x * 4;
		p.vy = dir.y * 4;
		p.vz = dir.z * 4;
		p.drag = 4;
		p.lifeMin = 0.12;
		p.lifeMax = 0.3;
		p.sizeMin = 0.04;
		p.sizeMax = 0.08;
		p.stretch = 0.05;
		p.intensity = 3;
		this.add.emit(p);
		this.lights.flash(pos, col, big ? 18 : 8, big ? 14 : 9, big ? 0.25 : 0.12, 1);
	}

	// ---------------------------------------------------------------- impacts

	impact(el: Element, pos: THREE.Vector3, scale = 1, normal?: THREE.Vector3): void {
		const col = ELEMENT_COLORS[el];
		const n = normal ?? UP;
		switch (el) {
			case 'fire': {
				let p = this.P(pos.x, pos.y, pos.z, 16, 'flame', 0xffe0a0, 0xff3000);
				p.spread = 0.3 * scale;
				p.speedMin = 2;
				p.speedMax = 6 * scale;
				p.up = 2;
				p.drag = 3;
				p.lifeMin = 0.25;
				p.lifeMax = 0.5;
				p.sizeMin = 0.5 * scale;
				p.sizeMax = 1.0 * scale;
				p.sizeEnd = 0.2;
				p.intensity = 2.6;
				p.spin = 4;
				this.add.emit(p);
				p = this.P(pos.x, pos.y, pos.z, 14, 'spark', 0xffe080, 0xff4000);
				p.speedMin = 4;
				p.speedMax = 10 * scale;
				p.up = 3;
				p.gravity = -12;
				p.drag = 1.5;
				p.lifeMin = 0.4;
				p.lifeMax = 0.9;
				p.sizeMin = 0.05;
				p.sizeMax = 0.1;
				p.stretch = 0.04;
				p.intensity = 3;
				this.add.emit(p);
				p = this.P(pos.x, pos.y, pos.z, 5, 'smoke', 0x4a3a34, 0x1a1616);
				p.spread = 0.4;
				p.speedMin = 0.5;
				p.speedMax = 1.5;
				p.up = 1.5;
				p.lifeMin = 0.8;
				p.lifeMax = 1.4;
				p.sizeMin = 0.8 * scale;
				p.sizeMax = 1.3 * scale;
				p.sizeEnd = 2.5;
				p.alpha = 0.45;
				this.alpha.emit(p);
				this.flashSprite(pos, 0xffb060, 2.2 * scale, 0.12, 3);
				this.lights.flash(pos, 0xff7a2a, 14 * scale, 10, 0.25, 2);
				break;
			}
			case 'ice': {
				let p = this.P(pos.x, pos.y, pos.z, 12, 'shard', 0xe8ffff, 0x5ae6ff);
				p.speedMin = 3;
				p.speedMax = 8 * scale;
				p.up = 2;
				p.gravity = -16;
				p.drag = 1;
				p.lifeMin = 0.4;
				p.lifeMax = 0.8;
				p.sizeMin = 0.1;
				p.sizeMax = 0.22;
				p.stretch = 0.03;
				p.intensity = 1.8;
				p.spin = 10;
				this.add.emit(p);
				p = this.P(pos.x, pos.y, pos.z, 6, 'smoke', 0xe0f6ff, 0xb0d8ff);
				p.spread = 0.3;
				p.speedMin = 0.5;
				p.speedMax = 1.8;
				p.lifeMin = 0.6;
				p.lifeMax = 1.0;
				p.sizeMin = 0.6 * scale;
				p.sizeMax = 1.0 * scale;
				p.sizeEnd = 2.2;
				p.alpha = 0.4;
				this.alpha.emit(p);
				p = this.P(pos.x, pos.y, pos.z, 8, 'star', 0xffffff, 0x8af0ff);
				p.spread = 0.5;
				p.speedMin = 0.5;
				p.speedMax = 2;
				p.lifeMin = 0.3;
				p.lifeMax = 0.6;
				p.sizeMin = 0.1;
				p.sizeMax = 0.22;
				p.intensity = 2.5;
				p.spin = 5;
				this.add.emit(p);
				this.rings.spawn(pos, col, 0.2, 1.4 * scale, 0.25, { normal: n, thick: 0.3 });
				this.lights.flash(pos, 0x6ae0ff, 8 * scale, 8, 0.2, 1);
				break;
			}
			case 'lightning': {
				let p = this.P(pos.x, pos.y, pos.z, 22, 'spark', 0xffffff, col);
				p.speedMin = 6;
				p.speedMax = 15 * scale;
				p.drag = 5;
				p.lifeMin = 0.12;
				p.lifeMax = 0.3;
				p.sizeMin = 0.04;
				p.sizeMax = 0.08;
				p.stretch = 0.05;
				p.intensity = 4;
				this.add.emit(p);
				p = this.P(pos.x, pos.y, pos.z, 3, 'star', 0xffffff, col);
				p.lifeMin = 0.1;
				p.lifeMax = 0.18;
				p.sizeMin = 1.2 * scale;
				p.sizeMax = 1.8 * scale;
				p.intensity = 3;
				p.spin = 2;
				this.add.emit(p);
				for (let i = 0; i < 3; i++) {
					_v.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).normalize().multiplyScalar(1.2 + Math.random() * 1.5 * scale);
					this.arcs.spawn(pos, _v2.copy(pos).add(_v), col, 0.12, 0.12, 0.4);
				}
				this.flashSprite(pos, 0xe8e0ff, 2.5 * scale, 0.08, 4);
				this.lights.flash(pos, 0xb8a4ff, 16 * scale, 11, 0.15, 2);
				break;
			}
			case 'wind': {
				let p = this.P(pos.x, pos.y, pos.z, 14, 'spark', 0xffffff, col);
				p.speedMin = 4;
				p.speedMax = 9 * scale;
				p.drag = 4;
				p.lifeMin = 0.15;
				p.lifeMax = 0.35;
				p.sizeMin = 0.04;
				p.sizeMax = 0.07;
				p.stretch = 0.06;
				p.alpha = 0.8;
				p.intensity = 1.8;
				this.add.emit(p);
				p = this.P(pos.x, pos.y, pos.z, 8, 'leaf', 0x9ae070, 0x4a9a3a);
				p.speedMin = 3;
				p.speedMax = 6;
				p.up = 2;
				p.gravity = -3;
				p.lifeMin = 0.8;
				p.lifeMax = 1.4;
				p.sizeMin = 0.12;
				p.sizeMax = 0.22;
				p.spin = 10;
				this.alpha.emit(p);
				p = this.P(pos.x, pos.y, pos.z, 4, 'smoke', 0xe8fff4, 0xc8f0e0);
				p.speedMin = 1;
				p.speedMax = 3;
				p.lifeMin = 0.4;
				p.lifeMax = 0.7;
				p.sizeMin = 0.6;
				p.sizeMax = 1.0;
				p.sizeEnd = 2.5;
				p.alpha = 0.25;
				this.alpha.emit(p);
				this.rings.spawn(pos, col, 0.3, 2.0 * scale, 0.3, { normal: n, thick: 0.15, intensity: 1.6 });
				break;
			}
			default: {
				const p = this.P(pos.x, pos.y, pos.z, 12, 'spark', 0xffffff, col);
				p.speedMin = 3;
				p.speedMax = 8 * scale;
				p.drag = 3;
				p.lifeMin = 0.2;
				p.lifeMax = 0.45;
				p.sizeMin = 0.05;
				p.sizeMax = 0.1;
				p.stretch = 0.04;
				p.intensity = 3;
				this.add.emit(p);
				this.flashSprite(pos, col, 1.6 * scale, 0.1, 2.5);
				this.lights.flash(pos, col, 8 * scale, 8, 0.15, 1);
			}
		}
	}

	/** Quick bright billboard flash. */
	flashSprite(pos: THREE.Vector3, color: number, size: number, life: number, intensity: number): void {
		const p = this.P(pos.x, pos.y, pos.z, 1, 'glow', color, color);
		p.lifeMin = p.lifeMax = life;
		p.sizeMin = p.sizeMax = size;
		p.sizeEnd = 1.4;
		p.intensity = intensity;
		this.add.emit(p);
	}

	// ---------------------------------------------------------------- big spells

	/** Flame Explosion: flash, fireball bloom, shockwave, embers and rising smoke. */
	explosion(pos: THREE.Vector3, radius: number, color = 0xff6a1a): void {
		const r = radius;
		this.flashSprite(pos, 0xfff0c0, r * 2.2, 0.15, 4);
		let p = this.P(pos.x, pos.y + 0.5, pos.z, 40, 'flame', 0xffe8a0, 0xff2a00);
		p.spread = r * 0.25;
		p.speedMin = r * 1.2;
		p.speedMax = r * 3;
		p.up = r * 0.8;
		p.drag = 4;
		p.lifeMin = 0.35;
		p.lifeMax = 0.7;
		p.sizeMin = r * 0.35;
		p.sizeMax = r * 0.6;
		p.sizeEnd = 0.25;
		p.intensity = 3;
		p.spin = 3;
		this.add.emit(p);
		p = this.P(pos.x, pos.y + 0.5, pos.z, 50, 'spark', 0xffe080, 0xff3000);
		p.speedMin = r * 2;
		p.speedMax = r * 5;
		p.up = r * 1.5;
		p.gravity = -14;
		p.drag = 1.2;
		p.lifeMin = 0.6;
		p.lifeMax = 1.4;
		p.sizeMin = 0.06;
		p.sizeMax = 0.12;
		p.stretch = 0.04;
		p.intensity = 3.5;
		this.add.emit(p);
		p = this.P(pos.x, pos.y + 0.8, pos.z, 18, 'smoke', 0x3a2c28, 0x141010);
		p.spread = r * 0.4;
		p.speedMin = r * 0.3;
		p.speedMax = r * 0.8;
		p.up = r * 0.6;
		p.drag = 1.2;
		p.lifeMin = 1.3;
		p.lifeMax = 2.2;
		p.sizeMin = r * 0.4;
		p.sizeMax = r * 0.7;
		p.sizeEnd = 2.4;
		p.alpha = 0.55;
		this.alpha.emit(p);
		const g = this.terrain.heightAt(pos.x, pos.z);
		_v.set(pos.x, Math.max(g + 0.15, pos.y - 0.4), pos.z);
		this.rings.spawn(_v, color, 0.5, r * 1.5, 0.45, { thick: 0.25, intensity: 3 });
		this.rings.spawn(_v, 0xffd080, 0.3, r * 1.0, 0.3, { thick: 0.4, intensity: 3 });
		this.circles.spawn(_v, r * 1.1, color, 0.6, { spin: 2.5, fadeIn: 0.05, intensity: 2.5 });
		this.lights.flash(pos, 0xff7a2a, 40, r * 5, 0.45, 3);
	}

	/** Frost Nova: ring of erupting ice spikes, freezing mist and a crystalline ring. */
	frostNova(pos: THREE.Vector3, radius: number): void {
		const g = this.terrain.heightAt(pos.x, pos.z);
		_v.set(pos.x, g + 0.1, pos.z);
		this.rings.spawn(_v, 0x8af0ff, 0.5, radius * 1.1, 0.4, { thick: 0.25, intensity: 3 });
		this.rings.spawn(_v, 0xffffff, 0.3, radius * 0.8, 0.3, { thick: 0.5, intensity: 2 });
		this.circles.spawn(_v, radius, 0x6ae0ff, 0.9, { spin: -1.5, fadeIn: 0.05, intensity: 2.5 });
		const n = Math.round(10 + radius * 2.5);
		for (let i = 0; i < n; i++) {
			const a = (i / n) * Math.PI * 2 + Math.random() * 0.2;
			for (const k of [0.45, 0.8]) {
				const rr = radius * k * (0.9 + Math.random() * 0.2);
				const x = pos.x + Math.cos(a) * rr;
				const z = pos.z + Math.sin(a) * rr;
				this.spikes.spawn(x, this.terrain.heightAt(x, z) - 0.2, z, (k > 0.6 ? 0.8 : 1.15) * (0.7 + Math.random() * 0.5), 0x7ae8ff, 1.3, (rr / radius) * 0.12, 0.45);
			}
		}
		let p = this.P(pos.x, g + 0.6, pos.z, 30, 'smoke', 0xeaf8ff, 0xb8e0ff);
		p.spread = 0.6;
		p.speedMin = radius * 1.5;
		p.speedMax = radius * 2.2;
		p.drag = 3;
		p.lifeMin = 0.8;
		p.lifeMax = 1.4;
		p.sizeMin = 1.0;
		p.sizeMax = 1.8;
		p.sizeEnd = 2.2;
		p.alpha = 0.45;
		this.alpha.emit(p);
		p = this.P(pos.x, g + 1, pos.z, 40, 'shard', 0xffffff, 0x5ae6ff);
		p.speedMin = radius * 1.2;
		p.speedMax = radius * 2.5;
		p.up = 3;
		p.gravity = -14;
		p.drag = 1;
		p.lifeMin = 0.5;
		p.lifeMax = 1;
		p.sizeMin = 0.1;
		p.sizeMax = 0.25;
		p.intensity = 2;
		p.spin = 12;
		this.add.emit(p);
		this.lights.flash(pos, 0x6ae0ff, 30, radius * 4, 0.5, 3);
	}

	/** Lightning arc between two points with spark bursts at both ends. */
	bolt(from: THREE.Vector3, to: THREE.Vector3, color = ELEMENT_COLORS.lightning, width = 0.45, life = 0.22): void {
		this.arcs.spawn(from, to, color, life, width, 1.1);
		this.arcs.spawn(from, to, 0xffffff, life * 0.7, width * 0.45, 0.7);
		// Branches.
		_v.subVectors(to, from);
		for (let i = 0; i < 2; i++) {
			const t = 0.3 + Math.random() * 0.4;
			_v2.copy(from).addScaledVector(_v, t);
			const b = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(1.5 + Math.random() * 2);
			this.arcs.spawn(_v2, b.add(_v2), color, life * 0.6, width * 0.4, 0.5);
		}
		this.lights.flash(to, color, 18, 12, 0.15, 2);
	}

	/** Tornado: start a visual; returns a handle index. */
	tornadoStart(pos: THREE.Vector3, radius: number, fire: boolean): number {
		const t = this.tornados.find((x) => !x.active);
		if (!t) return -1;
		t.active = true;
		t.fire = fire;
		t.radius = radius;
		t.acc = 0;
		t.group.visible = true;
		t.group.position.copy(pos);
		t.group.scale.setScalar(radius / 3);
		this.tornadoColor(t);
		return this.tornados.indexOf(t);
	}

	private tornadoColor(t: TornadoVisual): void {
		t.mats.forEach((m, k) => {
			(m.uniforms.uColor.value as THREE.Color).setHex(t.fire ? (k === 0 ? 0xff4a10 : 0xffa040) : k === 0 ? 0x9affd8 : 0xe8fff6).multiplyScalar(t.fire ? 1.8 : 0.9);
			m.uniforms.uAlpha.value = t.fire ? 1 : 0.7;
		});
	}

	tornadoIgnite(h: number): void {
		const t = this.tornados[h];
		if (!t || t.fire) return;
		t.fire = true;
		t.radius *= 1.35;
		t.group.scale.setScalar(t.radius / 3);
		this.tornadoColor(t);
		this.explosion(t.group.position.clone().add(new THREE.Vector3(0, 1.5, 0)), 2.5);
	}

	tornadoUpdate(h: number, pos: THREE.Vector3, dt: number, fade = 1): void {
		const t = this.tornados[h];
		if (!t) return;
		t.group.position.copy(pos);
		for (const m of t.mats) {
			m.uniforms.uTime.value += dt;
			m.uniforms.uAlpha.value = (t.fire ? 1 : 0.7) * fade;
		}
		const a = this.add.attractors;
		a[t.attractor * 3] = pos.x;
		a[t.attractor * 3 + 1] = pos.y;
		a[t.attractor * 3 + 2] = pos.z;
		const b = this.alpha.attractors;
		b[t.attractor * 3] = pos.x;
		b[t.attractor * 3 + 1] = pos.y;
		b[t.attractor * 3 + 2] = pos.z;
		t.acc += dt;
		if (t.acc < 1 / 30) return;
		t.acc = 0;
		const r = t.radius;
		let p = this.P(pos.x, pos.y, pos.z, 3, t.fire ? 'flame' : 'spark', t.fire ? 0xffd080 : 0xffffff, t.fire ? 0xff3000 : 0x7dffc4);
		p.attractor = t.attractor;
		p.orbitRadius = r * 0.45;
		p.orbitSpeed = 7;
		p.orbitRise = 4.5;
		p.lifeMin = 0.8;
		p.lifeMax = 1.4;
		p.sizeMin = t.fire ? 0.4 : 0.05;
		p.sizeMax = t.fire ? 0.8 : 0.09;
		p.stretch = t.fire ? 0 : 0.05;
		p.intensity = t.fire ? 2.5 : 1.6;
		p.alpha = 0.9;
		this.add.emit(p);
		p = this.P(pos.x, pos.y, pos.z, 1, t.fire ? 'smoke' : 'leaf', t.fire ? 0x3a2a24 : 0x8ad870, t.fire ? 0x1a1414 : 0x4a9a3a);
		p.attractor = t.attractor;
		p.orbitRadius = r * 0.55;
		p.orbitSpeed = 5.5;
		p.orbitRise = 3.5;
		p.lifeMin = 1.2;
		p.lifeMax = 1.8;
		p.sizeMin = t.fire ? 0.8 : 0.15;
		p.sizeMax = t.fire ? 1.3 : 0.25;
		p.spin = 8;
		p.alpha = t.fire ? 0.5 : 1;
		this.alpha.emit(p);
		// Dust skirt at the base.
		p = this.P(pos.x, pos.y + 0.2, pos.z, 1, 'smoke', 0xd8c8a8, 0xb8a888);
		p.spread = r * 0.5;
		p.speedMin = 2;
		p.speedMax = 4;
		p.lifeMin = 0.5;
		p.lifeMax = 0.9;
		p.sizeMin = 0.8;
		p.sizeMax = 1.3;
		p.sizeEnd = 1.8;
		p.alpha = 0.3;
		this.alpha.emit(p);
	}

	tornadoEnd(h: number): void {
		const t = this.tornados[h];
		if (!t) return;
		t.active = false;
		t.group.visible = false;
	}

	// ---------------------------------------------------------------- reactions & feedback

	reaction(id: string, pos: THREE.Vector3, radius = 2.5): void {
		switch (id) {
			case 'thermal_shock': {
				let p = this.P(pos.x, pos.y, pos.z, 26, 'smoke', 0xffffff, 0xd8e8f0);
				p.spread = 0.5;
				p.speedMin = 2;
				p.speedMax = 5;
				p.up = 3;
				p.drag = 2.5;
				p.lifeMin = 0.8;
				p.lifeMax = 1.5;
				p.sizeMin = 0.8;
				p.sizeMax = 1.6;
				p.sizeEnd = 2.6;
				p.alpha = 0.6;
				this.alpha.emit(p);
				p = this.P(pos.x, pos.y, pos.z, 20, 'shard', 0xffffff, 0xff8040);
				p.speedMin = 5;
				p.speedMax = 10;
				p.gravity = -14;
				p.lifeMin = 0.4;
				p.lifeMax = 0.8;
				p.sizeMin = 0.1;
				p.sizeMax = 0.2;
				p.intensity = 2.5;
				p.spin = 12;
				this.add.emit(p);
				this.rings.spawn(pos, 0xffb080, 0.3, radius * 1.2, 0.35, { normal: UP, thick: 0.3, intensity: 3 });
				this.flashSprite(pos, 0xfff0e0, 3, 0.15, 3);
				this.lights.flash(pos, 0xffc0a0, 20, 10, 0.3, 2);
				break;
			}
			case 'overcharge': {
				for (let i = 0; i < 6; i++) {
					_v.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(radius * (0.6 + Math.random() * 0.6));
					this.arcs.spawn(pos, _v2.copy(pos).add(_v), 0x9ad0ff, 0.35, 0.2, 0.6);
				}
				const p = this.P(pos.x, pos.y, pos.z, 30, 'spark', 0xffffff, 0x6ab0ff);
				p.speedMin = 6;
				p.speedMax = 14;
				p.drag = 4;
				p.lifeMin = 0.2;
				p.lifeMax = 0.5;
				p.sizeMin = 0.05;
				p.sizeMax = 0.1;
				p.stretch = 0.05;
				p.intensity = 4;
				this.add.emit(p);
				this.rings.spawn(pos, 0x6ab0ff, 0.3, radius * 1.4, 0.3, { thick: 0.25, intensity: 3 });
				this.flashSprite(pos, 0xd8e8ff, 3.5, 0.12, 4);
				this.lights.flash(pos, 0x8ab0ff, 30, 12, 0.3, 3);
				break;
			}
			case 'shatter': {
				let p = this.P(pos.x, pos.y, pos.z, 40, 'shard', 0xffffff, 0x5ae6ff);
				p.speedMin = 6;
				p.speedMax = 14;
				p.up = 3;
				p.gravity = -18;
				p.drag = 0.8;
				p.lifeMin = 0.5;
				p.lifeMax = 1.0;
				p.sizeMin = 0.15;
				p.sizeMax = 0.35;
				p.intensity = 2.5;
				p.spin = 15;
				this.add.emit(p);
				p = this.P(pos.x, pos.y, pos.z, 12, 'star', 0xffffff, 0x9af0ff);
				p.spread = 0.8;
				p.speedMin = 1;
				p.speedMax = 4;
				p.lifeMin = 0.3;
				p.lifeMax = 0.6;
				p.sizeMin = 0.3;
				p.sizeMax = 0.6;
				p.intensity = 3;
				this.add.emit(p);
				for (let i = 0; i < 8; i++) {
					const a = (i / 8) * Math.PI * 2;
					const x = pos.x + Math.cos(a) * radius * 0.6;
					const z = pos.z + Math.sin(a) * radius * 0.6;
					this.spikes.spawn(x, this.terrain.heightAt(x, z) - 0.2, z, 0.7, 0xbff6ff, 0.6, 0, 0.8);
				}
				this.rings.spawn(pos, 0xbff6ff, 0.3, radius * 1.3, 0.3, { normal: UP, thick: 0.3, intensity: 3 });
				this.flashSprite(pos, 0xffffff, 3, 0.1, 4);
				this.lights.flash(pos, 0x9af0ff, 22, 10, 0.25, 2);
				break;
			}
			case 'fire_tornado':
				this.explosion(pos, 2.4);
				break;
			case 'accelerated': {
				const p = this.P(pos.x, pos.y, pos.z, 10, 'spark', 0xffffff, 0x7dffc4);
				p.speedMin = 3;
				p.speedMax = 6;
				p.drag = 3;
				p.lifeMin = 0.2;
				p.lifeMax = 0.4;
				p.sizeMin = 0.04;
				p.sizeMax = 0.08;
				p.stretch = 0.06;
				p.intensity = 2.5;
				this.add.emit(p);
				this.rings.spawn(pos, 0x7dffc4, 0.2, 1.4, 0.2, { thick: 0.3, intensity: 2.5 });
				break;
			}
			default:
				this.impact('arcane', pos, 1.2);
		}
	}

	/** Enemy dissolve: crystalline fragments and rising motes. */
	death(pos: THREE.Vector3, color: number, size = 1): void {
		let p = this.P(pos.x, pos.y, pos.z, 30, 'shard', 0xffffff, color);
		p.spread = 0.5 * size;
		p.speedMin = 2;
		p.speedMax = 6 * size;
		p.up = 3;
		p.gravity = -10;
		p.lifeMin = 0.6;
		p.lifeMax = 1.2;
		p.sizeMin = 0.12 * size;
		p.sizeMax = 0.3 * size;
		p.intensity = 2;
		p.spin = 10;
		this.add.emit(p);
		p = this.P(pos.x, pos.y, pos.z, 26, 'glow', color, 0xffffff);
		p.spread = 0.8 * size;
		p.speedMin = 0.3;
		p.speedMax = 1.2;
		p.vy = 2.5;
		p.drag = 0.5;
		p.lifeMin = 1.0;
		p.lifeMax = 2.0;
		p.sizeMin = 0.1;
		p.sizeMax = 0.25;
		p.sizeEnd = 0.2;
		p.intensity = 2.5;
		this.add.emit(p);
		this.rings.spawn(pos, color, 0.3, 2.5 * size, 0.5, { thick: 0.2, intensity: 2 });
		this.lights.flash(pos, color, 16, 10, 0.4, 1);
	}

	hitSpark(pos: THREE.Vector3, color: number, crit = false): void {
		const p = this.P(pos.x, pos.y, pos.z, crit ? 16 : 7, 'spark', 0xffffff, color);
		p.speedMin = 3;
		p.speedMax = crit ? 10 : 6;
		p.drag = 4;
		p.lifeMin = 0.1;
		p.lifeMax = 0.25;
		p.sizeMin = 0.04;
		p.sizeMax = 0.08;
		p.stretch = 0.05;
		p.intensity = 3;
		this.add.emit(p);
		if (crit) this.flashSprite(pos, 0xfff0c0, 1.6, 0.1, 3);
	}

	parry(pos: THREE.Vector3): void {
		this.flashSprite(pos, 0xffffff, 4, 0.18, 5);
		const p = this.P(pos.x, pos.y, pos.z, 2, 'star', 0xffffff, 0xffd070);
		p.lifeMin = p.lifeMax = 0.35;
		p.sizeMin = p.sizeMax = 3;
		p.sizeEnd = 0.3;
		p.intensity = 4;
		p.spin = 2;
		this.add.emit(p);
		this.rings.spawn(pos, 0xffd070, 0.2, 3.5, 0.35, { normal: _v.set(0, 0, 1), thick: 0.2, intensity: 3.5 });
		this.rings.spawn(pos, 0xffffff, 0.2, 2.5, 0.25, { thick: 0.3, intensity: 3 });
		this.lights.flash(pos, 0xffe0a0, 30, 10, 0.3, 3);
	}

	block(pos: THREE.Vector3): void {
		const p = this.P(pos.x, pos.y, pos.z, 12, 'spark', 0xffffff, 0x7ad8ff);
		p.speedMin = 4;
		p.speedMax = 8;
		p.drag = 4;
		p.lifeMin = 0.15;
		p.lifeMax = 0.3;
		p.sizeMin = 0.04;
		p.sizeMax = 0.08;
		p.stretch = 0.05;
		p.intensity = 3;
		this.add.emit(p);
		this.shield.flashHit();
	}

	levelUp(pos: THREE.Vector3): void {
		for (let i = 0; i < 3; i++) this.rings.spawn(_v.set(pos.x, pos.y + 0.1 + i * 0.8, pos.z), 0xffd070, 0.3, 2.6, 0.7 + i * 0.15, { thick: 0.15, intensity: 3 });
		this.circles.spawn(pos, 2.4, 0xffd070, 1.4, { spin: 1.5, intensity: 2.5 });
		const p = this.P(pos.x, pos.y, pos.z, 60, 'star', 0xffffff, 0xffc040);
		p.spread = 1.2;
		p.vy = 4;
		p.speedMin = 0.5;
		p.speedMax = 2;
		p.drag = 1;
		p.lifeMin = 0.8;
		p.lifeMax = 1.6;
		p.sizeMin = 0.1;
		p.sizeMax = 0.25;
		p.intensity = 3;
		p.spin = 4;
		this.add.emit(p);
		this.lights.flash(pos, 0xffd070, 30, 12, 0.8, 3);
	}

	sparkle(pos: THREE.Vector3, color: number, count = 14): void {
		const p = this.P(pos.x, pos.y, pos.z, count, 'star', 0xffffff, color);
		p.spread = 0.4;
		p.speedMin = 1;
		p.speedMax = 3;
		p.up = 1.5;
		p.drag = 2;
		p.lifeMin = 0.4;
		p.lifeMax = 0.8;
		p.sizeMin = 0.1;
		p.sizeMax = 0.22;
		p.intensity = 3;
		p.spin = 4;
		this.add.emit(p);
	}

	heal(pos: THREE.Vector3, color = 0x7aff9a): void {
		const p = this.P(pos.x, pos.y, pos.z, 26, 'glow', color, 0xffffff);
		p.spread = 0.8;
		p.vy = 2.5;
		p.speedMin = 0.2;
		p.speedMax = 0.6;
		p.lifeMin = 0.6;
		p.lifeMax = 1.1;
		p.sizeMin = 0.08;
		p.sizeMax = 0.18;
		p.intensity = 2.5;
		this.add.emit(p);
		this.rings.spawn(pos, color, 0.3, 1.6, 0.5, { thick: 0.2, intensity: 2 });
	}

	dust(pos: THREE.Vector3, strength: number, color = 0xc8b898): void {
		const p = this.P(pos.x, pos.y + 0.1, pos.z, Math.round(4 + strength * 10), 'smoke', color, color);
		p.spread = 0.3;
		p.speedMin = 1 + strength * 2;
		p.speedMax = 2 + strength * 4;
		p.vy = 0.3;
		p.drag = 4;
		p.lifeMin = 0.4;
		p.lifeMax = 0.8;
		p.sizeMin = 0.4;
		p.sizeMax = 0.7;
		p.sizeEnd = 2;
		p.alpha = 0.35;
		this.alpha.emit(p);
	}

	splash(pos: THREE.Vector3, strength = 1): void {
		const p = this.P(pos.x, pos.y, pos.z, Math.round(10 * strength), 'glow', 0xe8faff, 0xa8d8ff);
		p.spread = 0.3;
		p.speedMin = 1;
		p.speedMax = 3 * strength;
		p.up = 4 * strength;
		p.gravity = -18;
		p.lifeMin = 0.4;
		p.lifeMax = 0.8;
		p.sizeMin = 0.1;
		p.sizeMax = 0.2;
		p.intensity = 1.2;
		p.alpha = 0.8;
		this.add.emit(p);
		this.rings.spawn(_v.copy(pos).setY(pos.y + 0.05), 0xc8f0ff, 0.2, 1.2 * strength, 0.5, { thick: 0.15, intensity: 1.2 });
	}

	/** Afterimage/streak behind a dodge or dash. */
	dashTrail(pos: THREE.Vector3, el: Element, strong: boolean): void {
		const col = ELEMENT_COLORS[el];
		_c.setHex(col);
		_c2.setHex(0xffffff);
		const p = this.P(pos.x, pos.y, pos.z, strong ? 4 : 2, 'glow', 0xffffff, col);
		p.spread = 0.5;
		p.lifeMin = 0.2;
		p.lifeMax = 0.35;
		p.sizeMin = 0.4;
		p.sizeMax = 0.7;
		p.sizeEnd = 0.2;
		p.alpha = 0.5;
		p.intensity = 1.5;
		this.add.emit(p);
		if (strong) {
			const q = this.P(pos.x, pos.y, pos.z, 3, 'spark', 0xffffff, col);
			q.spread = 0.4;
			q.speedMin = 1;
			q.speedMax = 3;
			q.lifeMin = 0.2;
			q.lifeMax = 0.4;
			q.sizeMin = 0.04;
			q.sizeMax = 0.07;
			q.stretch = 0.04;
			q.intensity = 2.5;
			this.add.emit(q);
		}
	}

	doubleJump(pos: THREE.Vector3, el: Element): void {
		const col = ELEMENT_COLORS[el];
		this.rings.spawn(pos, col, 0.3, 1.6, 0.3, { thick: 0.3, intensity: 2.5 });
		this.circles.spawn(pos, 1.0, col, 0.35, { spin: 4, fadeIn: 0.04, intensity: 2.2, offsetY: 0 });
		const p = this.P(pos.x, pos.y, pos.z, 12, 'star', 0xffffff, col);
		p.spread = 0.3;
		p.speedMin = 1;
		p.speedMax = 3;
		p.vy = -1.5;
		p.lifeMin = 0.25;
		p.lifeMax = 0.5;
		p.sizeMin = 0.08;
		p.sizeMax = 0.16;
		p.intensity = 2.5;
		this.add.emit(p);
	}

	/** Generic emission helper for systems that need a one-off burst. */
	burst(pos: THREE.Vector3, tile: TileName, color: number, colorEnd: number, count: number, speed: number, life: number, size: number, opts: { gravity?: number; up?: number; stretch?: number; intensity?: number; alpha?: boolean; spread?: number } = {}): void {
		const p = this.P(pos.x, pos.y, pos.z, count, tile, color, colorEnd);
		p.spread = opts.spread ?? 0.2;
		p.speedMin = speed * 0.4;
		p.speedMax = speed;
		p.up = opts.up ?? 0;
		p.gravity = opts.gravity ?? 0;
		p.lifeMin = life * 0.6;
		p.lifeMax = life;
		p.sizeMin = size * 0.6;
		p.sizeMax = size;
		p.stretch = opts.stretch ?? 0;
		p.intensity = opts.intensity ?? 2;
		p.drag = 2;
		if (opts.alpha) {
			p.alpha = 0.5;
			p.sizeEnd = 2;
			this.alpha.emit(p);
		} else this.add.emit(p);
	}

	update(dt: number): void {
		this.time += dt;
		this.add.update(dt);
		this.alpha.update(dt);
		this.rings.update(dt);
		this.circles.update(dt);
		this.telegraphs.update(dt);
		this.arcs.update(dt);
		this.beams.update(dt);
		this.spikes.update(dt);
		this.lights.update(dt);
	}

	/** Remove every transient effect (respawn, loading a save). */
	clearAll(): void {
		this.add.clear();
		this.alpha.clear();
		this.rings.clear();
		this.circles.clear();
		this.telegraphs.clear();
		this.arcs.clear();
		for (const v of this.projectiles) v.hide();
		for (const t of this.tornados) {
			t.active = false;
			t.group.visible = false;
		}
		for (const b of this.beams.beams) this.beams.release(b);
	}

	dispose(): void {
		this.add.dispose();
		this.alpha.dispose();
		this.rings.dispose();
		this.circles.dispose();
		this.telegraphs.dispose();
		this.arcs.dispose();
		this.beams.dispose();
		this.spikes.dispose();
		this.shield.dispose();
		for (const v of this.projectiles) {
			v.coreMat.dispose();
			v.shardMat.dispose();
			v.bladeMat.dispose();
			v.haloMat.dispose();
			this.scene.remove(v.group);
		}
		for (const t of this.tornados) {
			t.mats.forEach((m) => m.dispose());
			this.scene.remove(t.group);
		}
		for (const g of this.shared) g.dispose();
		this.atlas.dispose();
		this.rune.dispose();
		this.glowTex.dispose();
	}
}
