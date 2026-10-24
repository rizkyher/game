import * as THREE from 'three';
import type { Collider, RigidBody } from '@dimforge/rapier3d-compat';
import type { GameContext } from '../core/context';
import type { Combatant, Element, HitInfo, HitResult, Hurtbox, StatusApplication } from '../combat/types';
import { ELEMENT_COLORS, HitTag, newUid } from '../combat/types';
import type { CombatantSource } from '../combat/CombatSystem';
import { StatusSet } from '../combat/StatusEffects';
import type { BossHud } from '../core/types';
import { GROUPS } from '../physics/PhysicsWorld';
import { ARENA, HEIGHTS } from '../world/WorldLayout';
import { dampAngle, wrapAngle } from '../utils/math';
import { segSegDist2 } from '../utils/collide';
import { AzrakRig, type BossAnim, type BossPose } from './BossModel';

const FLOOR = HEIGHTS.arenaFloor;
const CENTER = new THREE.Vector3(ARENA.x, FLOOR, ARENA.z);
/** The boss keeps inside this radius of the arena centre. */
const ROAM_R = ARENA.r - 5;
const MAX_HP = 3400;
const PHASES = [0.66, 0.33];
const RADIUS = 1.8;
const HEIGHT = 7.2;
const START = new THREE.Vector3(ARENA.x, FLOOR, ARENA.z - 15);
const CRYSTAL = ELEMENT_COLORS.crystal;
const TELE = { normal: 0xff8a3a, heavy: 0xff2a3a, magic: 0xd040ff };

type State = 'dormant' | 'intro' | 'idle' | 'move' | 'attack' | 'stagger' | 'transition' | 'overheat' | 'dying' | 'dead';
type AttackId = 'cleave' | 'cleave2' | 'fist' | 'volley' | 'slam' | 'spikes' | 'rain' | 'beam' | 'bombs' | 'delayed' | 'leap';

interface AttackDef {
	id: AttackId;
	minPhase: number;
	range: [number, number];
	weight: number;
	cooldown: number;
	duration: number;
	melee?: boolean;
}

const ATTACKS: Record<AttackId, AttackDef> = {
	cleave: { id: 'cleave', minPhase: 1, range: [0, 8.5], weight: 3, cooldown: 3, duration: 2.0, melee: true },
	cleave2: { id: 'cleave2', minPhase: 2, range: [0, 9], weight: 0, cooldown: 0, duration: 1.6, melee: true },
	fist: { id: 'fist', minPhase: 1, range: [0, 9.5], weight: 2.4, cooldown: 6, duration: 4.2, melee: true },
	volley: { id: 'volley', minPhase: 1, range: [5, 45], weight: 2.2, cooldown: 4.5, duration: 2.2 },
	slam: { id: 'slam', minPhase: 1, range: [0, 13], weight: 1.6, cooldown: 8, duration: 2.6 },
	spikes: { id: 'spikes', minPhase: 2, range: [5, 30], weight: 2.2, cooldown: 6, duration: 2.4 },
	rain: { id: 'rain', minPhase: 2, range: [0, 45], weight: 1.8, cooldown: 11, duration: 3.0 },
	beam: { id: 'beam', minPhase: 2, range: [7, 45], weight: 1.5, cooldown: 16, duration: 5.1 },
	leap: { id: 'leap', minPhase: 2, range: [12, 50], weight: 1.4, cooldown: 9, duration: 2.6 },
	bombs: { id: 'bombs', minPhase: 3, range: [0, 45], weight: 1.4, cooldown: 14, duration: 2.0 },
	delayed: { id: 'delayed', minPhase: 3, range: [0, 30], weight: 1.8, cooldown: 9, duration: 3.4 }
};

const BASE_AFFINITY: Partial<Record<Element, number>> = { ice: 0.9, lightning: 1.1, crystal: 0.3 };

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
const _st = { s: 0, t: 0 };

interface HitOpts {
	knockback?: number;
	heavy?: boolean;
	parryable?: boolean;
	blockable?: boolean;
	status?: StatusApplication[];
	name: string;
	tags?: number;
	element?: Element;
}

// ------------------------------------------------------------------ pillars & bombs

/** Floating crystal obelisk on a stone plinth. Charged pillars shield Azrak and can be shattered. */
class Pillar implements Combatant {
	readonly uid = newUid();
	readonly team = 'enemy' as const;
	readonly name = 'Resonance Pillar';
	readonly position: THREE.Vector3;
	readonly radius = 1.1;
	readonly height = 7;
	readonly statuses = new StatusSet();
	readonly hurtboxes: Hurtbox[];
	alive = false;
	hp = 1;
	maxHp = 1;
	level = 12;
	state: 'dormant' | 'charged' | 'broken' = 'dormant';
	readonly crystal: THREE.Mesh;
	readonly mat: THREE.MeshStandardMaterial;
	readonly link: THREE.Mesh;
	private flashK = 0;
	private shatterT = -1;
	private seed = Math.random() * 10;

	constructor(
		private boss: BossFight,
		pos: THREE.Vector3,
		crystalGeo: THREE.BufferGeometry,
		linkGeo: THREE.BufferGeometry,
		linkMat: THREE.Material,
		group: THREE.Group
	) {
		this.position = pos.clone();
		this.mat = new THREE.MeshStandardMaterial({ color: 0xd8c0ff, emissive: 0x6030a0, emissiveIntensity: 0.4, roughness: 0.2, flatShading: true });
		this.crystal = new THREE.Mesh(crystalGeo, this.mat);
		this.crystal.castShadow = true;
		this.crystal.position.set(pos.x, FLOOR + 4.4, pos.z);
		group.add(this.crystal);
		this.link = new THREE.Mesh(linkGeo, linkMat);
		this.link.visible = false;
		this.link.frustumCulled = false;
		group.add(this.link);
		this.hurtboxes = [{ a: new THREE.Vector3(pos.x, FLOOR + 3.1, pos.z), b: new THREE.Vector3(pos.x, FLOOR + 5.7, pos.z), r: 1.0, weak: 1 }];
	}

	affinity(el: Element): number {
		return el === 'lightning' ? 1.5 : el === 'wind' ? 1.2 : el === 'ice' ? 0.8 : el === 'crystal' ? 0 : 1;
	}

	defense(): number {
		return 0;
	}

	invulnerable(): boolean {
		return false;
	}

	aimPoint(out: THREE.Vector3): THREE.Vector3 {
		return out.copy(this.crystal.position);
	}

	charge(hp: number): void {
		if (this.state === 'broken') return;
		this.state = 'charged';
		this.alive = true;
		this.hp = this.maxHp = hp;
		this.flashK = 1;
	}

	onHit(_hit: HitInfo, result: HitResult): void {
		this.flashK = 1;
		this.statuses.clear();
		if (result.killed) {
			this.shatter();
			this.boss.onPillarBroken(this);
		}
	}

	shatter(): void {
		this.state = 'broken';
		this.alive = false;
		this.shatterT = 0;
	}

	reset(): void {
		this.state = 'dormant';
		this.alive = false;
		this.hp = this.maxHp = 1;
		this.shatterT = -1;
		this.crystal.visible = true;
		this.crystal.scale.set(1, 1, 1);
		this.link.visible = false;
		this.statuses.clear();
	}

	update(dt: number, time: number, core: THREE.Vector3, bossVisible: boolean): void {
		this.flashK = Math.max(0, this.flashK - dt * 4);
		const c = this.crystal;
		if (this.shatterT >= 0) {
			this.shatterT += dt;
			c.scale.setScalar(Math.max(0.001, 1 - this.shatterT * 4));
			if (this.shatterT > 0.25) c.visible = false;
			this.link.visible = false;
			return;
		}
		const charged = this.state === 'charged';
		c.position.y = FLOOR + 4.4 + Math.sin(time * 1.3 + this.seed) * 0.25;
		c.rotation.y = time * (charged ? 1.4 : 0.25) + this.seed;
		this.mat.emissive.setHex(charged ? 0xc050ff : 0x6030a0);
		this.mat.emissiveIntensity = (charged ? 2.4 + Math.sin(time * 5 + this.seed) * 0.6 : 0.35) + this.flashK * 4;
		this.hurtboxes[0].a.set(c.position.x, c.position.y - 1.3, c.position.z);
		this.hurtboxes[0].b.set(c.position.x, c.position.y + 1.3, c.position.z);
		// Energy tether to Azrak's core while charged.
		this.link.visible = charged && bossVisible;
		if (this.link.visible) {
			_v.subVectors(core, c.position);
			const len = _v.length();
			this.link.position.copy(c.position);
			_q.setFromUnitVectors(UP, _v.normalize());
			this.link.quaternion.copy(_q);
			this.link.scale.set(1, len, 1);
		}
	}
}

/** Crystal that Azrak seeds around the arena; explodes when its fuse runs out unless shattered first. */
class CrystalBomb implements Combatant {
	readonly uid = newUid();
	readonly team = 'enemy' as const;
	readonly name = 'Volatile Crystal';
	readonly position = new THREE.Vector3();
	readonly radius = 0.8;
	readonly height = 2;
	readonly statuses = new StatusSet();
	readonly hurtboxes: Hurtbox[] = [{ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.85, weak: 1 }];
	alive = false;
	hp = 40;
	maxHp = 40;
	level = 12;
	fuse = 0;
	tele = -1;
	readonly mesh: THREE.Mesh;
	readonly mat: THREE.MeshStandardMaterial;

	constructor(
		private boss: BossFight,
		geo: THREE.BufferGeometry,
		group: THREE.Group
	) {
		this.mat = new THREE.MeshStandardMaterial({ color: 0xffd0f0, emissive: 0xff40c0, emissiveIntensity: 2, roughness: 0.2, flatShading: true });
		this.mesh = new THREE.Mesh(geo, this.mat);
		this.mesh.visible = false;
		group.add(this.mesh);
	}

	affinity(el: Element): number {
		return el === 'crystal' ? 0 : 1;
	}

	defense(): number {
		return 0;
	}

	invulnerable(): boolean {
		return false;
	}

	aimPoint(out: THREE.Vector3): THREE.Vector3 {
		return out.copy(this.position).setY(this.position.y + 1);
	}

	arm(pos: THREE.Vector3, fuse: number, tele: number): void {
		this.position.copy(pos);
		this.alive = true;
		this.hp = this.maxHp;
		this.fuse = fuse;
		this.tele = tele;
		this.mesh.visible = true;
		this.mesh.position.copy(pos).setY(pos.y + 1);
		this.hurtboxes[0].a.copy(this.mesh.position).setY(pos.y + 0.5);
		this.hurtboxes[0].b.copy(this.mesh.position).setY(pos.y + 1.5);
		this.statuses.clear();
	}

	onHit(_hit: HitInfo, result: HitResult): void {
		this.statuses.clear();
		if (result.killed) this.boss.onBombShattered(this);
	}

	disarm(): void {
		this.alive = false;
		this.mesh.visible = false;
		this.tele = -1;
	}
}

// ------------------------------------------------------------------ the fight

/**
 * Azrak, the Crystal Tyrant: arena trigger and intro cutscene, a three-phase attack FSM
 * (cleaves, crushing fist with an exposed core, shard volleys, shockwaves, spike lines,
 * prism rain, a sweeping prism beam that overheats, leaps, volatile crystals, delayed
 * slams), Resonance Pillars that ward him, phase transitions, death and reset.
 */
export class BossFight implements CombatantSource, Combatant {
	readonly uid = newUid();
	readonly team = 'enemy' as const;
	readonly name = 'Azrak';
	readonly position = START.clone();
	readonly radius = RADIUS;
	readonly height = HEIGHT;
	readonly statuses = new StatusSet();
	readonly hurtboxes: Hurtbox[] = [
		{ a: new THREE.Vector3(), b: new THREE.Vector3(), r: RADIUS, weak: 1 },
		{ a: new THREE.Vector3(), b: new THREE.Vector3(), r: 1.0, weak: 1.25 }
	];
	alive = false;
	hp = MAX_HP;
	maxHp = MAX_HP;
	level = 12;
	/** True from the intro until the death sequence ends (HUD, music, quest beacon). */
	active = false;

	private rig = new AzrakRig();
	private anim: BossAnim = { pose: 'dormant', speed: 0, telegraph: 0, exposed: false, warded: false, phase: 1, charge: 0 };
	private group = new THREE.Group();
	private state: State = 'dormant';
	private stateT = 0;
	private stateDur = 0;
	private phase = 1;
	private yaw = 0;
	private prevYaw = 0;
	private prevPosition = START.clone();
	private renderPosition = START.clone();
	private speed = 0;
	private time = 0;
	private attack: AttackDef | null = null;
	private atkT = 0;
	private fired = new Set<string>();
	private queue: AttackId[] = [];
	private cooldowns = new Map<AttackId, number>();
	private last: AttackId | null = null;
	private pendingMelee: AttackId | null = null;
	private teles: number[] = [];
	private pending: { at: number; fn: () => void }[] = [];
	private exposedT = 0;
	private brokenT = 0;
	private poise = 300;
	private maxPoise = 300;
	private pose: BossPose = 'dormant';
	private target = new THREE.Vector3();
	private leapFrom = new THREE.Vector3();
	private beam: ReturnType<GameContext['vfx']['beams']['acquire']> = null;
	private beamYaw = 0;
	private beamTick = 0;
	private beamEnd = new THREE.Vector3();
	private shockwaves: { r: number; max: number; speed: number; hit: boolean; center: THREE.Vector3; dmg: number }[] = [];
	private pillars: Pillar[] = [];
	private bombs: CrystalBomb[] = [];
	private body: RigidBody;
	private collider: Collider;
	private barrier: Collider | null = null;
	private barrierMesh: THREE.Mesh;
	private barrierMat: THREE.ShaderMaterial;
	private geos: THREE.BufferGeometry[] = [];
	private mats: THREE.Material[] = [];
	private stepT = 0;
	private wardNotified = false;
	private coreNotified = false;
	private core = new THREE.Vector3();
	private victoryT = -1;
	private linkMat: THREE.ShaderMaterial;

	constructor(private ctx: GameContext) {
		this.statuses.controlResist = 0.25;
		this.group.name = 'boss';
		ctx.scene.add(this.group, this.rig.root);
		const { body, collider } = ctx.physics.createCharacter(START.x, FLOOR + HEIGHT / 2, START.z, RADIUS, HEIGHT / 2 - RADIUS, GROUPS.enemy, { kind: 'enemy', ref: this });
		this.body = body;
		this.collider = collider;

		// Pillars on their plinths.
		const crystalGeo = this.g(new THREE.OctahedronGeometry(1, 0));
		crystalGeo.scale(0.85, 2.0, 0.85);
		const plinthGeo = this.g(new THREE.CylinderGeometry(1.25, 1.5, 2.0, 8));
		plinthGeo.translate(0, 1.0, 0);
		const capGeo = this.g(new THREE.TorusGeometry(1.2, 0.12, 4, 16));
		const linkGeo = this.g(new THREE.CylinderGeometry(0.1, 0.1, 1, 6, 1, true));
		linkGeo.translate(0, 0.5, 0);
		const linkMat = (this.linkMat = this.m(
			new THREE.ShaderMaterial({
				uniforms: { uTime: { value: 0 } },
				vertexShader: /* glsl */ `
					varying vec2 vUv;
					void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
				`,
				fragmentShader: /* glsl */ `
					uniform float uTime;
					varying vec2 vUv;
					void main() {
						float p = 0.5 + 0.5 * sin(vUv.y * 30.0 - uTime * 8.0);
						vec3 c = mix(vec3(0.8, 0.3, 1.0), vec3(1.0, 0.8, 1.0), p);
						float a = 0.5 + p * 0.5;
						gl_FragColor = vec4(c * a * 2.0, a);
					}
				`,
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending
			})
		));
		const plinthMat = this.m(new THREE.MeshStandardMaterial({ color: 0x4f4a5e, roughness: 0.9, flatShading: true }));
		const capMat = this.m(new THREE.MeshStandardMaterial({ color: 0x201030, emissive: 0xb070ff, emissiveIntensity: 1.5 }));
		for (const p of ctx.world.structures.anchors.arenaPillars) {
			const plinth = new THREE.Mesh(plinthGeo, plinthMat);
			plinth.position.set(p.x, FLOOR - 0.05, p.z);
			plinth.castShadow = plinth.receiveShadow = true;
			const cap = new THREE.Mesh(capGeo, capMat);
			cap.position.set(p.x, FLOOR + 2.0, p.z);
			cap.rotation.x = Math.PI / 2;
			this.group.add(plinth, cap);
			ctx.physics.addCylinder(p.x, FLOOR + 1.0, p.z, 1.0, 1.45, { kind: 'static', material: 'stone' });
			this.pillars.push(new Pillar(this, p, crystalGeo, linkGeo, linkMat, this.group));
		}
		const bombGeo = this.g(new THREE.OctahedronGeometry(0.7, 0));
		bombGeo.scale(1, 1.6, 1);
		for (let i = 0; i < 6; i++) this.bombs.push(new CrystalBomb(this, bombGeo, this.group));

		// Crystal wall that seals the crypt entrance during the fight.
		this.barrierMat = this.m(
			new THREE.ShaderMaterial({
				uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
				vertexShader: /* glsl */ `
					varying vec2 vUv;
					void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
				`,
				fragmentShader: /* glsl */ `
					uniform float uTime;
					uniform float uAlpha;
					varying vec2 vUv;
					void main() {
						vec2 c = vUv - 0.5;
						float hex = abs(sin(vUv.x * 40.0 + uTime) * sin(vUv.y * 30.0 - uTime * 0.8));
						float edge = smoothstep(0.5, 0.38, max(abs(c.x), abs(c.y)));
						float a = (0.25 + smoothstep(0.8, 1.0, hex) * 0.5) * edge * uAlpha;
						vec3 col = mix(vec3(0.7, 0.2, 1.0), vec3(1.0, 0.6, 0.95), hex);
						gl_FragColor = vec4(col * a * 1.8, a);
					}
				`,
				transparent: true,
				depthWrite: false,
				side: THREE.DoubleSide,
				blending: THREE.CustomBlending,
				blendSrc: THREE.OneFactor,
				blendDst: THREE.OneFactor
			})
		);
		this.barrierMesh = new THREE.Mesh(this.g(new THREE.PlaneGeometry(9.5, 12)), this.barrierMat);
		this.barrierMesh.position.set(ARENA.x, FLOOR + 6, ARENA.z + ARENA.r + 0.4);
		this.barrierMesh.visible = false;
		this.group.add(this.barrierMesh);
		this.reset();
	}

	private g<T extends THREE.BufferGeometry>(x: T): T {
		this.geos.push(x);
		return x;
	}

	private m<T extends THREE.Material>(x: T): T {
		this.mats.push(x);
		return x;
	}

	// ------------------------------------------------------------------ Combatant

	forEachCombatant(fn: (c: Combatant) => void): void {
		if (!this.active) return;
		if (this.alive && this.state !== 'intro') fn(this);
		for (const p of this.pillars) if (p.alive) fn(p);
		for (const b of this.bombs) if (b.alive) fn(b);
	}

	private get warded(): boolean {
		return this.pillars.some((p) => p.state === 'charged');
	}

	private get exposed(): boolean {
		return this.exposedT > 0 || this.state === 'stagger' || this.state === 'overheat';
	}

	affinity(el: Element): number {
		return (BASE_AFFINITY[el] ?? 1) * (this.warded ? 0.25 : 1) * (this.brokenT > 0 ? 1.4 : 1);
	}

	defense(): number {
		return this.exposed ? 20 : 40;
	}

	aimPoint(out: THREE.Vector3): THREE.Vector3 {
		return out.copy(this.position).setY(this.position.y + 4.4);
	}

	invulnerable(): boolean {
		return this.state === 'intro' || this.state === 'transition' || this.state === 'dying' || this.state === 'dead' || this.state === 'dormant';
	}

	onHit(hit: HitInfo, result: HitResult): void {
		const ctx = this.ctx;
		this.rig.flash(result.crit ? 1 : 0.6);
		if (this.state === 'dying' || this.state === 'dead') return;
		const frac = this.hp / this.maxHp;
		// Phase thresholds cannot be skipped by one big hit.
		if (this.phase < 3 && frac <= PHASES[this.phase - 1]) {
			this.hp = Math.max(this.hp, Math.round(this.maxHp * PHASES[this.phase - 1]));
			this.alive = true;
			result.killed = false;
			this.beginTransition(this.phase + 1);
			return;
		}
		if (result.killed) {
			this.beginDeath();
			return;
		}
		if (result.weak && !this.coreNotified) {
			this.coreNotified = true;
			ctx.ui.notify('Weak point!', "Strikes on Azrak's exposed core always crit.", 'info');
		}
		if (hit.poise > 0 && !(hit.tags & HitTag.DOT) && !this.warded && (this.state === 'attack' || this.state === 'idle' || this.state === 'move')) {
			this.poise -= hit.poise * (hit.heavy ? 1.3 : 1);
			if (this.poise <= 0) {
				this.poise = this.maxPoise;
				this.stagger(2.4, 'STAGGERED');
			}
		}
	}

	/** Perfectly parried cleaves knock the Tyrant off balance. */
	onParried(): void {
		if (this.state !== 'attack' || !this.attack || !this.attack.id.startsWith('cleave')) return;
		this.stagger(1.8, 'GUARD BROKEN');
	}

	// ------------------------------------------------------------------ external hooks

	onPillarBroken(p: Pillar): void {
		const ctx = this.ctx;
		_v.copy(p.crystal.position);
		ctx.vfx.burst(_v, 'shard', 0xf0c0ff, 0x7020c0, 40, 11, 1.1, 0.4, { gravity: -12 });
		ctx.vfx.explosion(_v, 3, CRYSTAL);
		ctx.audio.sfx('barrier_break', _v);
		ctx.feel.shake(0.3);
		const left = this.pillars.filter((x) => x.state === 'charged').length;
		ctx.numbers.spawn(_v2.copy(_v).setY(_v.y + 2), left > 0 ? `PILLAR SHATTERED · ${left} LEFT` : 'WARD SHATTERED', 'reaction');
		if (left === 0) this.breakWard();
	}

	onBombShattered(b: CrystalBomb): void {
		const ctx = this.ctx;
		if (b.tele >= 0) ctx.vfx.telegraphs.cancel(b.tele);
		b.aimPoint(_v);
		ctx.vfx.burst(_v, 'shard', 0xffd0f0, 0xa02080, 22, 7, 0.7, 0.25, { gravity: -12 });
		ctx.audio.sfx('reaction_shatter', _v, { volume: 0.6 });
		b.disarm();
	}

	// ------------------------------------------------------------------ helpers

	private enter(s: State, dur = 0): void {
		this.state = s;
		this.stateT = 0;
		this.stateDur = dur;
	}

	private once(key: string, t: number): boolean {
		if (this.atkT < t || this.fired.has(key)) return false;
		this.fired.add(key);
		return true;
	}

	private schedule(delay: number, fn: () => void): void {
		this.pending.push({ at: this.time + delay, fn });
	}

	private tele(shape: 'circle' | 'cone' | 'line' | 'ring', x: number, z: number, yaw: number, size: number, dur: number, color: number, opts: { length?: number; angle?: number; inner?: number } = {}): number {
		const i = this.ctx.vfx.telegraphs.spawn(shape, x, z, yaw, size, dur, color, { ...opts, floorY: FLOOR });
		this.teles.push(i);
		return i;
	}

	private cancelTeles(): void {
		for (const i of this.teles) this.ctx.vfx.telegraphs.cancel(i);
		this.teles.length = 0;
	}

	private forward(out: THREE.Vector3, yaw = this.yaw): THREE.Vector3 {
		return out.set(Math.sin(yaw), 0, Math.cos(yaw));
	}

	private yawToPlayer(): number {
		const p = this.ctx.player.position;
		return Math.atan2(p.x - this.position.x, p.z - this.position.z);
	}

	private distToPlayer(): number {
		const p = this.ctx.player.position;
		return Math.hypot(p.x - this.position.x, p.z - this.position.z);
	}

	/** Keeps a point inside the arena floor. */
	private clampArena(p: THREE.Vector3, r = ROAM_R + 3): THREE.Vector3 {
		const dx = p.x - CENTER.x;
		const dz = p.z - CENTER.z;
		const d = Math.hypot(dx, dz);
		if (d > r) {
			p.x = CENTER.x + (dx / d) * r;
			p.z = CENTER.z + (dz / d) * r;
		}
		p.y = FLOOR;
		return p;
	}

	private hitPlayer(dmg: number, dir: THREE.Vector3, o: HitOpts): HitResult | null {
		const ctx = this.ctx;
		const player = ctx.player;
		if (!player.alive) return null;
		const phaseK = this.phase === 3 ? 1.15 : 1;
		return ctx.combat.applyHit(player, {
			source: 'enemy',
			attacker: this,
			element: o.element ?? 'crystal',
			damage: dmg * phaseK,
			point: player.aimPoint(new THREE.Vector3()),
			dir: dir.clone(),
			knockback: o.knockback ?? 6,
			poise: 0,
			heavy: o.heavy ?? false,
			critChance: 0,
			critMult: 1.5,
			status: o.status,
			tags: o.tags ?? HitTag.MELEE,
			parryable: o.parryable ?? false,
			blockable: o.blockable ?? true,
			attackName: o.name
		});
	}

	/** Circular area on the floor; jumping high enough clears it. */
	private aoe(center: THREE.Vector3, radius: number, dmg: number, o: HitOpts, maxAbove = 2.6): boolean {
		const p = this.ctx.player.position;
		const d = Math.hypot(p.x - center.x, p.z - center.z);
		if (d > radius + this.ctx.player.radius || p.y - FLOOR > maxAbove) return false;
		this.hitPlayer(dmg, _v3.set(p.x - center.x, 0, p.z - center.z), { tags: HitTag.AOE, ...o });
		return true;
	}

	private meleeCone(radius: number, halfAngle: number, dmg: number, o: HitOpts): void {
		const p = this.ctx.player.position;
		_v.subVectors(p, this.position);
		if (_v.y > 5 || _v.y < -2) return;
		_v.setY(0);
		const d = _v.length();
		if (d > radius + this.ctx.player.radius) return;
		const ang = Math.abs(wrapAngle(Math.atan2(_v.x, _v.z) - this.yaw));
		if (ang > halfAngle && d > RADIUS + 1) return;
		this.hitPlayer(dmg, _v.normalize(), o);
	}

	/** Crater burst used by fists, slams and delayed slams. */
	private crater(at: THREE.Vector3, radius: number, big: boolean): void {
		const ctx = this.ctx;
		ctx.vfx.explosion(_v.copy(at).setY(FLOOR + 0.3), radius * 0.8, CRYSTAL);
		ctx.vfx.dust(_v.copy(at).setY(FLOOR + 0.1), big ? 1.6 : 1.1, 0xb8a8c8);
		const n = big ? 10 : 7;
		for (let i = 0; i < n; i++) {
			const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
			const r = radius * (0.65 + Math.random() * 0.3);
			ctx.vfx.spikes.spawn(at.x + Math.cos(a) * r, FLOOR, at.z + Math.sin(a) * r, 1.1 + Math.random() * 0.9, CRYSTAL, 1.4, i * 0.015, 0.5);
		}
		ctx.vfx.rings.spawn(_v.copy(at).setY(FLOOR + 0.15), CRYSTAL, 0.5, radius * 1.3, 0.45, { thick: 0.3, intensity: 2.6 });
		ctx.feel.shake(big ? 0.7 : 0.4);
		ctx.audio.sfx('boss_slam', at, { volume: big ? 1 : 0.75 });
	}

	// ------------------------------------------------------------------ fight flow

	private startIntro(): void {
		const ctx = this.ctx;
		this.active = true;
		this.alive = true;
		this.enter('intro', 4.8);
		ctx.targeting.clear();
		this.barrier = ctx.physics.addBarrier(ARENA.x, FLOOR + 6, ARENA.z + ARENA.r + 0.4, 4.9, 6, 0.6);
		this.barrierMesh.visible = true;
		ctx.flow.cutscene(true);
		const p = ctx.player.position;
		const from = new THREE.Vector3(p.x * 0.6, FLOOR + 3.4, Math.min(p.z + 7, ARENA.z + ARENA.r - 1));
		const look = new THREE.Vector3(this.position.x, FLOOR + 5.2, this.position.z);
		ctx.cameraCtl.cutscene(from, new THREE.Vector3(START.x + 8, FLOOR + 3.2, START.z + 14), look, 4.6);
		ctx.audio.sfx('boss_charge', this.position, { volume: 1, pitch: 0.6 });
		ctx.feel.shake(0.25);
	}

	private stepIntro(): void {
		const ctx = this.ctx;
		const t = this.stateT;
		this.yaw = dampAngle(this.yaw, 0, 2, 1 / 60);
		if (t > 1.0 && this.pose === 'dormant') {
			this.pose = 'idle';
			ctx.vfx.sparkle(this.aimPoint(_v), 0xd090ff, 40);
		}
		if (t > 2.2 && this.pose === 'idle') {
			this.pose = 'roar';
			ctx.audio.sfx('boss_roar', this.position);
			ctx.audio.setMood('boss', 1);
			ctx.feel.shake(0.9);
			ctx.vfx.rings.spawn(_v.copy(this.position).setY(FLOOR + 0.2), CRYSTAL, 1, 30, 1.2, { thick: 0.25, intensity: 3 });
			ctx.vfx.burst(this.aimPoint(_v), 'shard', 0xf0c0ff, 0x8020c0, 50, 14, 1.2, 0.35, { gravity: -8 });
			ctx.ui.banner('Azrak', 'The Crystal Tyrant', 'boss');
		}
		if (t >= this.stateDur) {
			this.pose = 'idle';
			ctx.flow.cutscene(false);
			this.enter('idle', 1.2);
			ctx.ui.notify('Azrak, the Crystal Tyrant', 'Watch the ground for warnings. His crystal core is exposed after heavy attacks.', 'quest');
		}
	}

	private beginTransition(next: number): void {
		const ctx = this.ctx;
		this.interrupt();
		this.phase = next;
		this.anim.phase = next;
		this.maxPoise = next === 3 ? 360 : 320;
		this.poise = this.maxPoise;
		this.exposedT = 0;
		this.enter('transition', 3.4);
		this.pose = 'roar';
		ctx.audio.sfx('boss_roar', this.position, { pitch: next === 3 ? 0.85 : 1 });
		ctx.audio.setMood('boss', next);
		ctx.world.sky.gloom = next === 2 ? 0.55 : 1;
		ctx.feel.shake(1);
		ctx.feel.slowMo(0.4, 0.5);
		ctx.vfx.rings.spawn(_v.copy(this.position).setY(FLOOR + 0.3), next === 3 ? 0xff3a8a : CRYSTAL, 1, 18, 0.8, { thick: 0.35, intensity: 3.5 });
		ctx.vfx.burst(this.aimPoint(_v), 'shard', 0xffd0ff, next === 3 ? 0xff2060 : 0x8020c0, 60, 16, 1.3, 0.4, { gravity: -9 });
		if (this.distToPlayer() < 14) {
			const p = ctx.player.position;
			this.hitPlayer(8, _v2.set(p.x - this.position.x, 0, p.z - this.position.z), { name: "Tyrant's Roar", knockback: 16, tags: HitTag.AOE });
		}
		ctx.ui.banner(next === 2 ? 'Phase II' : 'Phase III', next === 2 ? 'Azrak draws on the Resonance Pillars' : 'The Tyrant shatters his restraints', 'boss');
	}

	private stepTransition(): void {
		const ctx = this.ctx;
		const t = this.stateT;
		if (t > 1.6 && !this.fired.has('pillars')) {
			this.fired.add('pillars');
			const idx = this.phase === 2 ? [0, 2, 4, 6] : [1, 3, 5, 7];
			for (const i of idx) {
				const p = this.pillars[i];
				if (!p) continue;
				p.charge(this.phase === 2 ? 170 : 210);
				ctx.vfx.bolt(this.rig.corePosition(_v), p.crystal.position, CRYSTAL, 0.6, 0.4);
				ctx.vfx.sparkle(p.crystal.position, 0xe0a0ff, 24);
			}
			ctx.audio.sfx('barrier_up', this.position);
			if (!this.wardNotified) {
				this.wardNotified = true;
				ctx.ui.notify('Prism Ward', "Shatter the glowing Resonance Pillars to break Azrak's ward. Lightning cracks crystal fastest.", 'warning');
			}
		}
		if (t >= this.stateDur) {
			this.fired.clear();
			this.pose = 'idle';
			this.enter('idle', 0.5);
		}
	}

	private breakWard(): void {
		const ctx = this.ctx;
		this.brokenT = 7;
		ctx.feel.slowMo(0.35, 0.6);
		ctx.audio.sfx('barrier_break', this.position, { pitch: 0.7 });
		ctx.vfx.burst(this.aimPoint(_v), 'shard', 0xf8e0ff, 0x9030e0, 60, 13, 1.2, 0.4, { gravity: -10 });
		if (this.state !== 'dying' && this.state !== 'transition') this.stagger(3.5, 'WARD SHATTERED');
	}

	private stagger(seconds: number, label: string): void {
		const ctx = this.ctx;
		this.interrupt();
		this.enter('stagger', seconds);
		this.exposedT = seconds;
		this.pose = 'kneel';
		ctx.audio.sfx('stagger', this.position, { pitch: 0.6 });
		ctx.numbers.spawn(_v.copy(this.position).setY(this.position.y + HEIGHT + 0.5), label, 'reaction');
		ctx.feel.shake(0.35);
	}

	private beginDeath(): void {
		const ctx = this.ctx;
		this.interrupt();
		this.alive = false;
		this.enter('dying', 4.6);
		this.pose = 'dying';
		ctx.targeting.clear();
		ctx.feel.slowMo(0.3, 1.4);
		ctx.feel.shake(1);
		ctx.audio.sfx('boss_death', this.position);
		for (const p of this.pillars) {
			if (p.state !== 'charged') continue;
			p.shatter();
			ctx.vfx.burst(p.crystal.position, 'shard', 0xf0c0ff, 0x7020c0, 30, 10, 1.1, 0.4, { gravity: -12 });
		}
		for (const b of this.bombs) if (b.alive) this.onBombShattered(b);
		this.shockwaves.length = 0;
	}

	private stepDying(dt: number): void {
		const ctx = this.ctx;
		const t = this.stateT;
		this.rig.corePosition(this.core);
		if (Math.random() < dt * 8 && t < 3.2) {
			_v.copy(this.core).add(_v2.set((Math.random() - 0.5) * 3, (Math.random() - 0.3) * 4, (Math.random() - 0.5) * 3));
			ctx.vfx.burst(_v, 'shard', 0xffe0ff, 0xa040ff, 10, 6, 0.8, 0.25, { gravity: -6 });
			ctx.vfx.bolt(_v, _v2.copy(_v).add(_v3.set((Math.random() - 0.5) * 4, 8 + Math.random() * 6, (Math.random() - 0.5) * 4)), 0xf0c0ff, 0.35, 0.25);
		}
		if (t > 3.0 && !this.fired.has('burst')) {
			this.fired.add('burst');
			ctx.vfx.explosion(this.core, 8, CRYSTAL);
			ctx.vfx.rings.spawn(_v.copy(this.position).setY(FLOOR + 0.3), 0xffffff, 1, 34, 1.2, { thick: 0.3, intensity: 4 });
			ctx.vfx.burst(this.core, 'shard', 0xffffff, 0xc060ff, 80, 18, 1.6, 0.45, { gravity: -8 });
			ctx.vfx.lights.flash(this.core, 0xf0c0ff, 60, 50, 1.2, 5);
			ctx.feel.shake(1);
			ctx.audio.sfx('explosion', this.core, { pitch: 0.5 });
		}
		this.rig.dissolve(Math.max(0, Math.min(1, (t - 3.0) / 1.2)));
		ctx.world.sky.gloom = Math.max(0, 1 - t / 4);
		if (t >= this.stateDur) {
			this.fired.clear();
			this.enter('dead');
			this.active = false;
			this.removeBarrier();
			this.body.setEnabled(false);
			ctx.events.emit('bossDefeated', {});
			ctx.ui.banner('Azrak has fallen', 'The Broken Seal is restored', 'victory');
			ctx.audio.sfx('victory');
			this.victoryT = 2.5;
		}
	}

	private removeBarrier(): void {
		if (this.barrier) this.ctx.physics.removeCollider(this.barrier);
		this.barrier = null;
		this.barrierMesh.visible = false;
	}

	/** Drop whatever attack is under way (stagger, phase change, death). */
	private interrupt(): void {
		this.cancelTeles();
		if (this.beam) {
			this.ctx.vfx.beams.release(this.beam);
			this.beam = null;
		}
		this.attack = null;
		this.queue.length = 0;
		this.pendingMelee = null;
		this.fired.clear();
		this.anim.telegraph = 0;
		this.anim.charge = 0;
	}

	/** Back to the dormant (or defeated) state: player death, loading a save. */
	reset(): void {
		const ctx = this.ctx;
		this.interrupt();
		this.pending.length = 0;
		this.shockwaves.length = 0;
		for (const p of this.pillars) p.reset();
		for (const b of this.bombs) {
			if (b.tele >= 0) ctx.vfx.telegraphs.cancel(b.tele);
			b.disarm();
		}
		this.removeBarrier();
		const defeated = ctx.save.data.bossDefeated;
		this.phase = 1;
		this.anim.phase = 1;
		this.hp = this.maxHp;
		this.poise = this.maxPoise = 300;
		this.exposedT = this.brokenT = 0;
		this.cooldowns.clear();
		this.last = null;
		this.active = false;
		this.alive = !defeated;
		this.victoryT = -1;
		this.statuses.clear();
		this.enter(defeated ? 'dead' : 'dormant');
		this.pose = 'dormant';
		this.rig.reset();
		this.rig.root.visible = !defeated;
		for (const p of this.pillars) p.crystal.visible = true;
		ctx.world.sky.gloom = 0;
		this.yaw = this.prevYaw = 0;
		this.speed = 0;
		this.teleport(START);
		this.body.setEnabled(!defeated);
		this.collider.setEnabled(!defeated);
	}

	private teleport(p: THREE.Vector3): void {
		this.position.copy(p).setY(FLOOR);
		this.prevPosition.copy(this.position);
		this.renderPosition.copy(this.position);
		this.body.setTranslation({ x: p.x, y: FLOOR + HEIGHT / 2, z: p.z }, true);
		this.body.setNextKinematicTranslation({ x: p.x, y: FLOOR + HEIGHT / 2, z: p.z });
		this.updateHurtboxes();
	}

	// ------------------------------------------------------------------ decision making

	private chooseAttack(): AttackDef | null {
		const ctx = this.ctx;
		const next = this.queue.shift();
		if (next) return ATTACKS[next];
		const d = this.distToPlayer();
		const ranged = ctx.profile.rangedRate();
		let total = 0;
		const cands: [AttackDef, number][] = [];
		for (const a of Object.values(ATTACKS)) {
			if (a.minPhase > this.phase || a.weight <= 0) continue;
			if ((this.cooldowns.get(a.id) ?? 0) > this.time) continue;
			let w = a.weight;
			if (a.id === this.last) w *= 0.25;
			const inRange = d >= a.range[0] && d <= a.range[1];
			if (!inRange) {
				if (a.melee && d > a.range[1]) w *= 0.35;
				else continue;
			}
			if (d > 14) w *= a.melee ? 0.4 : 1.5;
			if (d < 6 && !a.melee && a.id !== 'slam' && a.id !== 'rain') w *= 0.5;
			// Players who kite at range get chased down.
			if (a.id === 'leap') w *= 1 + ranged * 2;
			if (a.id === 'slam' && d < 7) w *= 1.6;
			cands.push([a, w]);
			total += w;
		}
		if (!cands.length) return null;
		let r = Math.random() * total;
		for (const [a, w] of cands) {
			r -= w;
			if (r <= 0) return a;
		}
		return cands[cands.length - 1][0];
	}

	private startAttack(a: AttackDef): void {
		const ctx = this.ctx;
		this.attack = a;
		this.atkT = 0;
		this.fired.clear();
		this.last = a.id;
		const cdK = this.phase === 3 ? 0.75 : 1;
		this.cooldowns.set(a.id, this.time + a.cooldown * cdK * (0.85 + Math.random() * 0.3));
		// Phase III is faster, except for attacks whose timeline is fixed by the beam/leap arcs.
		const fixed = a.id === 'beam' || a.id === 'leap';
		this.enter('attack', a.duration * (this.phase === 3 && !fixed ? 0.88 : 1));
		switch (a.id) {
			case 'cleave':
			case 'cleave2': {
				const wind = a.id === 'cleave' ? (this.phase === 3 ? 0.7 : 0.85) : 0.55;
				this.pose = a.id === 'cleave' ? 'cleaveWind' : 'cleave2Wind';
				this.tele('cone', this.position.x, this.position.z, this.yaw, 8.5, wind, TELE.normal, { angle: 1.15 });
				ctx.audio.sfx('windup_golem', this.position, { pitch: 0.6 });
				break;
			}
			case 'fist':
				this.pose = 'raise';
				this.forward(this.target).multiplyScalar(5.5).add(this.position);
				this.tele('circle', this.target.x, this.target.z, 0, 4.2, 1.3, TELE.heavy);
				ctx.audio.sfx('boss_charge', this.position, { pitch: 0.8 });
				break;
			case 'volley':
				this.pose = 'cast';
				ctx.audio.sfx('boss_charge', this.position, { pitch: 1.3, volume: 0.7 });
				break;
			case 'slam':
				this.pose = 'raise';
				this.tele('ring', this.position.x, this.position.z, 0, 6, 0.95, TELE.heavy, { inner: 0.6 });
				ctx.audio.sfx('boss_charge', this.position, { pitch: 0.7 });
				break;
			case 'spikes':
				this.pose = 'cast';
				this.yaw = this.yawToPlayer();
				for (const off of this.phase === 3 ? [-0.38, 0, 0.38] : [0]) {
					this.forward(_v, this.yaw + off).multiplyScalar(2).add(this.position);
					this.tele('line', _v.x, _v.z, this.yaw + off, 1.5, 0.9, TELE.magic, { length: 27 });
				}
				ctx.audio.sfx('mage_chant', this.position, { pitch: 0.6 });
				break;
			case 'rain':
				this.pose = 'summon';
				ctx.audio.sfx('boss_roar', this.position, { volume: 0.5, pitch: 1.4 });
				break;
			case 'beam':
				this.pose = 'beamCharge';
				this.yaw = this.yawToPlayer();
				this.beamYaw = this.yaw;
				this.forward(_v).multiplyScalar(2).add(this.position);
				this.tele('line', _v.x, _v.z, this.yaw, 1.4, 1.5, TELE.magic, { length: 32 });
				ctx.audio.sfx('boss_charge', this.position, { pitch: 0.55 });
				break;
			case 'leap':
				this.pose = 'raise';
				this.leapFrom.copy(this.position);
				break;
			case 'bombs':
				this.pose = 'summon';
				ctx.audio.sfx('mage_chant', this.position, { pitch: 0.8 });
				break;
			case 'delayed':
				this.pose = 'raise';
				ctx.audio.sfx('boss_charge', this.position, { pitch: 0.9 });
				break;
		}
	}

	// ------------------------------------------------------------------ attack timelines

	private stepAttack(dt: number): void {
		const ctx = this.ctx;
		const a = this.attack!;
		const t = this.atkT;
		const player = ctx.player;
		switch (a.id) {
			case 'cleave':
			case 'cleave2': {
				const first = a.id === 'cleave';
				const wind = first ? (this.phase === 3 ? 0.7 : 0.85) : 0.55;
				this.anim.telegraph = Math.min(1, t / wind);
				if (t < wind * 0.65) {
					this.yaw = dampAngle(this.yaw, this.yawToPlayer(), 3, dt);
					if (this.teles.length) ctx.vfx.telegraphs.reposition(this.teles[this.teles.length - 1], this.position.x, this.position.z, this.yaw);
				}
				if (this.once('hit', wind)) {
					this.anim.telegraph = 0;
					this.pose = first ? 'cleaveHit' : 'cleave2Hit';
					this.meleeCone(8.5, 1.15, first ? 30 : 26, { name: first ? 'Tyrant Cleave' : 'Backhand', knockback: 10, parryable: true, blockable: true });
					for (let i = 0; i <= 8; i++) {
						const ang = this.yaw + (first ? 1 : -1) * (1.1 - (i / 8) * 2.2);
						_v.set(this.position.x + Math.sin(ang) * 5.5, FLOOR + 1.2, this.position.z + Math.cos(ang) * 5.5);
						ctx.vfx.burst(_v, 'shard', 0xf0d0ff, 0x8040e0, 3, 5, 0.5, 0.25, { gravity: -6 });
					}
					ctx.audio.sfx('swing_golem', this.position, { pitch: 0.6, volume: 1 });
					ctx.feel.shake(0.3);
					if (first && this.phase >= 2 && Math.random() < (this.phase === 3 ? 0.8 : 0.5)) {
						this.queue.push('cleave2');
						if (this.phase === 3 && Math.random() < 0.6) this.queue.push('fist');
					}
				}
				if (this.once('recover', wind + 0.35)) this.pose = 'idle';
				break;
			}
			case 'fist': {
				this.anim.telegraph = Math.min(1, t / 1.3);
				if (t < 0.7) {
					this.yaw = dampAngle(this.yaw, this.yawToPlayer(), 2.5, dt);
					this.forward(this.target).multiplyScalar(5.5).add(this.position);
					this.clampArena(this.target);
					if (this.teles.length) ctx.vfx.telegraphs.reposition(this.teles[this.teles.length - 1], this.target.x, this.target.z, 0);
				}
				if (this.once('slam', 1.3)) {
					this.anim.telegraph = 0;
					this.pose = 'slamDown';
					this.aoe(this.target, 4.2, 44, { name: 'Crushing Fist', heavy: true, knockback: 13, blockable: true });
					this.crater(this.target, 4.2, true);
					ctx.feel.hitStop(0.05);
				}
				if (this.once('stuck', 1.5)) {
					this.pose = 'stuck';
					this.exposedT = this.phase === 3 ? 1.9 : 2.5;
					ctx.numbers.spawn(this.rig.corePosition(_v).setY(_v.y + 1.5), 'CORE EXPOSED', 'reaction');
				}
				if (this.once('rise', 1.5 + (this.phase === 3 ? 1.9 : 2.5))) this.pose = 'idle';
				break;
			}
			case 'volley': {
				this.yaw = dampAngle(this.yaw, this.yawToPlayer(), 4, dt);
				this.anim.telegraph = Math.min(1, t / 0.8);
				if (t < 0.8 && Math.random() < 0.7) ctx.vfx.gather('crystal', this.rig.handPosition('R', _v), t / 0.8);
				if (this.once('fire1', 0.8)) this.fireFan(this.phase === 1 ? 5 : 7, 0);
				if (this.phase === 3 && this.once('fire2', 1.35)) this.fireFan(6, 0.065);
				if (this.once('recover', 1.5)) {
					this.pose = 'idle';
					this.anim.telegraph = 0;
				}
				break;
			}
			case 'slam': {
				this.anim.telegraph = Math.min(1, t / 0.95);
				if (this.once('impact', 0.95)) {
					this.pose = 'slamDown';
					this.anim.telegraph = 0;
					this.shockwave();
				}
				if (this.phase === 3) {
					if (this.once('raise2', 1.25)) this.pose = 'raise';
					if (this.once('impact2', 1.75)) {
						this.pose = 'slamDown';
						this.shockwave();
					}
				}
				if (this.once('recover', this.phase === 3 ? 2.2 : 1.5)) this.pose = 'idle';
				break;
			}
			case 'spikes': {
				this.anim.telegraph = Math.min(1, t / 0.9);
				if (this.once('erupt', 0.9)) {
					this.pose = 'punchGround';
					this.anim.telegraph = 0;
					ctx.feel.shake(0.3);
					ctx.audio.sfx('boss_slam', this.position, { volume: 0.7, pitch: 1.2 });
					for (const off of this.phase === 3 ? [-0.38, 0, 0.38] : [0]) this.spikeLine(this.yaw + off);
				}
				if (this.once('recover', 1.6)) this.pose = 'idle';
				break;
			}
			case 'rain': {
				if (Math.random() < dt * 20) ctx.vfx.burst(this.rig.handPosition(Math.random() < 0.5 ? 'L' : 'R', _v), 'glow', 0xffe0ff, CRYSTAL, 2, 4, 0.6, 0.2, { up: 8, intensity: 2.5 });
				if (this.once('call', 0.6)) this.prismRain();
				if (this.once('recover', 1.6)) this.pose = 'idle';
				break;
			}
			case 'beam':
				this.stepBeam(dt);
				break;
			case 'leap':
				this.stepLeap(dt);
				break;
			case 'bombs': {
				if (this.once('spawn', 0.6)) this.seedBombs();
				if (this.once('recover', 1.3)) this.pose = 'idle';
				break;
			}
			case 'delayed': {
				this.yaw = dampAngle(this.yaw, this.yawToPlayer(), 3, dt);
				for (let i = 0; i < 4; i++) {
					if (this.once(`mark${i}`, 0.3 + i * 0.45)) {
						_v.copy(player.position);
						this.clampArena(_v);
						const at = _v.clone();
						this.tele('circle', at.x, at.z, 0, 3.2, 1.4, TELE.heavy);
						this.schedule(1.4, () => {
							this.aoe(at, 3.2, 30, { name: 'Delayed Slam', heavy: true, knockback: 9, blockable: true });
							this.crater(at, 3.2, false);
						});
					}
				}
				if (this.once('down', 1.7)) this.pose = 'slamDown';
				if (this.once('recover', 2.6)) this.pose = 'idle';
				break;
			}
		}
		if (this.state === 'attack' && this.atkT >= this.stateDur) this.endAttack();
	}

	private endAttack(): void {
		if (this.beam) {
			this.ctx.vfx.beams.release(this.beam);
			this.beam = null;
		}
		this.attack = null;
		this.cancelTeles();
		this.anim.telegraph = 0;
		this.anim.charge = 0;
		this.pose = 'idle';
		this.enter('idle', this.queue.length ? 0.05 : this.phase === 3 ? 0.35 : 0.7);
	}

	private fireFan(n: number, offset: number): void {
		const ctx = this.ctx;
		const player = ctx.player;
		const origin = this.rig.handPosition('R', new THREE.Vector3());
		const speed = 22;
		const tt = origin.distanceTo(player.position) / speed;
		player.aimPoint(_v).addScaledVector(player.velocity, tt * 0.6);
		const dir = _v.sub(origin).normalize();
		for (let i = 0; i < n; i++) {
			const ang = (i - (n - 1) / 2) * 0.13 + offset;
			const d = dir.clone().applyAxisAngle(UP, ang);
			ctx.spells.enemyProjectile({
				kind: 'crystalShard',
				origin: origin.clone(),
				dir: d,
				speed,
				damage: 15 * (this.phase === 3 ? 1.15 : 1),
				element: 'crystal',
				radius: 0.4,
				attacker: this,
				homing: i === Math.floor(n / 2) ? player : null,
				homingRate: 0.8,
				knockback: 4,
				parryable: true,
				blockable: true,
				scale: 1.6,
				life: 3
			});
		}
		ctx.vfx.castBurst('crystal', origin, dir, true);
		ctx.audio.sfx('mage_bolt', origin, { pitch: 0.7, volume: 0.9 });
	}

	private shockwave(): void {
		const ctx = this.ctx;
		const c = this.position.clone().setY(FLOOR);
		this.shockwaves.push({ r: 2, max: 27, speed: 15, hit: false, center: c, dmg: 24 });
		ctx.vfx.rings.spawn(_v.copy(c).setY(FLOOR + 0.35), CRYSTAL, 2, 27, 27 / 15, { thick: 0.12, intensity: 3 });
		this.crater(c, 3.5, true);
	}

	private stepShockwaves(dt: number): void {
		const ctx = this.ctx;
		const player = ctx.player;
		for (let i = this.shockwaves.length - 1; i >= 0; i--) {
			const w = this.shockwaves[i];
			w.r += w.speed * dt;
			if (Math.random() < 0.9) {
				const a = Math.random() * Math.PI * 2;
				_v.set(w.center.x + Math.cos(a) * w.r, FLOOR + 0.1, w.center.z + Math.sin(a) * w.r);
				ctx.vfx.dust(_v, 0.3, 0xc8a8e8);
			}
			if (!w.hit && player.alive) {
				const d = Math.hypot(player.position.x - w.center.x, player.position.z - w.center.z);
				// Jump over the wave front.
				if (Math.abs(d - w.r) < 0.9 && player.position.y - FLOOR < 1.0) {
					w.hit = true;
					this.hitPlayer(w.dmg, _v2.set(player.position.x - w.center.x, 0, player.position.z - w.center.z), { name: 'Shockwave', heavy: true, knockback: 9, tags: HitTag.AOE, blockable: true });
				}
			}
			if (w.r >= w.max) this.shockwaves.splice(i, 1);
		}
	}

	private spikeLine(yaw: number): void {
		const ctx = this.ctx;
		const fx = Math.sin(yaw);
		const fz = Math.cos(yaw);
		const state = { hit: false };
		for (let k = 0; k < 16; k++) {
			const x = this.position.x + fx * (2.5 + k * 1.65);
			const z = this.position.z + fz * (2.5 + k * 1.65);
			if (Math.hypot(x - CENTER.x, z - CENTER.z) > ARENA.r) break;
			this.schedule(k * 0.045, () => {
				ctx.vfx.spikes.spawn(x, FLOOR, z, 1.6 + Math.random() * 0.7, CRYSTAL, 1.5, 0, 0.35);
				if (k % 3 === 0) ctx.vfx.dust(_v.set(x, FLOOR + 0.1, z), 0.6, 0xc0a0e0);
				if (state.hit) return;
				const p = ctx.player.position;
				if (Math.hypot(p.x - x, p.z - z) < 1.7 + ctx.player.radius && p.y - FLOOR < 2.2) {
					state.hit = true;
					const r = this.hitPlayer(30, _v2.set(p.x - x, 0, p.z - z), { name: 'Crystal Spikes', knockback: 5, tags: HitTag.AOE, blockable: true });
					// Launched into the air by the eruption.
					if (r && !r.blocked && ctx.player.alive) ctx.player.velocity.y = Math.max(ctx.player.velocity.y, 8);
				}
			});
		}
	}

	private prismRain(): void {
		const ctx = this.ctx;
		const player = ctx.player;
		const n = this.phase === 3 ? 11 : 7;
		for (let i = 0; i < n; i++) {
			const at = new THREE.Vector3();
			if (i === 0) at.copy(player.position).addScaledVector(player.velocity, 0.6);
			else {
				const a = Math.random() * Math.PI * 2;
				const r = 3 + Math.random() * 8;
				at.set(player.position.x + Math.cos(a) * r, 0, player.position.z + Math.sin(a) * r);
			}
			this.clampArena(at);
			const delay = 1.1 + i * 0.14;
			this.tele('circle', at.x, at.z, 0, 2.7, delay, TELE.magic);
			this.schedule(delay, () => {
				ctx.vfx.bolt(_v.copy(at).setY(FLOOR + 30), _v2.copy(at).setY(FLOOR + 0.2), 0xf0c0ff, 1.1, 0.3);
				ctx.vfx.explosion(_v.copy(at).setY(FLOOR + 0.4), 2.4, CRYSTAL);
				for (let k = 0; k < 3; k++) ctx.vfx.spikes.spawn(at.x + (Math.random() - 0.5) * 2.4, FLOOR, at.z + (Math.random() - 0.5) * 2.4, 0.9 + Math.random() * 0.5, CRYSTAL, 1.1, 0, 0.6);
				ctx.audio.sfx('impact_crystal', at, { volume: 0.9 });
				ctx.feel.shake(0.12);
				this.aoe(at, 2.7, 24, { name: 'Prism Rain', knockback: 6, tags: HitTag.AOE, blockable: true });
			});
		}
	}

	private stepBeam(dt: number): void {
		const ctx = this.ctx;
		const t = this.atkT;
		const charge = 1.5;
		const sweep = 3.6;
		this.rig.corePosition(this.core);
		if (t < charge) {
			this.anim.charge = t / charge;
			this.yaw = dampAngle(this.yaw, this.yawToPlayer(), 1.2, dt);
			this.beamYaw = this.yaw;
			if (this.teles.length) {
				this.forward(_v).multiplyScalar(2).add(this.position);
				ctx.vfx.telegraphs.reposition(this.teles[this.teles.length - 1], _v.x, _v.z, this.yaw);
			}
			if (Math.random() < 0.8) ctx.vfx.gather('crystal', this.core, t / charge);
			return;
		}
		if (t < charge + sweep) {
			if (!this.beam) {
				this.beam = ctx.vfx.beams.acquire(0xff80f0);
				this.pose = 'beam';
				this.cancelTeles();
				ctx.audio.sfx('void_burst', this.position, { pitch: 0.5, volume: 1 });
				ctx.feel.shake(0.4);
			}
			this.anim.charge = 1;
			// Sweep towards the player at a limited turn rate: outrun it, get close, or hide behind a plinth.
			const want = this.yawToPlayer();
			const rate = this.phase === 3 ? 0.75 : 0.5;
			this.beamYaw += Math.max(-rate * dt, Math.min(rate * dt, wrapAngle(want - this.beamYaw)));
			this.yaw = this.beamYaw;
			const reach = 26;
			const fx = Math.sin(this.beamYaw);
			const fz = Math.cos(this.beamYaw);
			let len = reach;
			// Plinths block the low part of the beam.
			for (const p of ctx.world.structures.anchors.arenaPillars) {
				const ox = p.x - this.core.x;
				const oz = p.z - this.core.z;
				const along = ox * fx + oz * fz;
				if (along <= 0 || along > len) continue;
				const perp = Math.abs(ox * fz - oz * fx);
				if (perp > 1.45) continue;
				const s = along - Math.sqrt(1.45 * 1.45 - perp * perp);
				const hAt = this.core.y + (FLOOR - this.core.y) * (s / reach);
				if (hAt - FLOOR < 2.0) len = Math.max(0, s);
			}
			this.beamEnd.set(this.core.x + fx * len, this.core.y + (FLOOR - this.core.y) * (len / reach), this.core.z + fz * len);
			if (this.beam) ctx.vfx.beams.aim(this.beam, this.core, this.beamEnd, 0.55 + Math.sin(this.time * 40) * 0.08);
			if (Math.random() < 0.9) {
				ctx.vfx.burst(this.beamEnd, 'spark', 0xffffff, CRYSTAL, 3, 7, 0.4, 0.12, { up: 3, stretch: 0.05, intensity: 3 });
				if (Math.random() < 0.3) ctx.vfx.dust(this.beamEnd, 0.4, 0xd0a0ff);
			}
			ctx.vfx.lights.flash(this.beamEnd, 0xff80f0, 6, 8, 0.08, 2);
			this.beamTick -= dt;
			const player = ctx.player;
			if (this.beamTick <= 0 && player.alive) {
				_a.copy(player.position).setY(player.position.y + 0.3);
				_b.copy(player.position).setY(player.position.y + 1.6);
				const d2 = segSegDist2(this.core, this.beamEnd, _a, _b, _st);
				if (d2 < 1.1 * 1.1) {
					this.beamTick = 0.2;
					this.hitPlayer(10, _v2.set(fx, 0, fz), { name: 'Prism Beam', knockback: 2.5, tags: HitTag.BEAM, blockable: true, element: 'arcane' });
				}
			}
			return;
		}
		if (this.beam) {
			ctx.vfx.beams.release(this.beam);
			this.beam = null;
		}
		// Overheated: the core vents and lies open.
		const dur = this.phase === 3 ? 4 : 4.5;
		this.attack = null;
		this.anim.charge = 0;
		this.enter('overheat', dur);
		this.exposedT = dur;
		this.pose = 'kneel';
		ctx.numbers.spawn(_v.copy(this.core).setY(this.core.y + 2), 'OVERHEATED', 'reaction');
		ctx.audio.sfx('stagger', this.position, { pitch: 0.5 });
	}

	private stepLeap(dt: number): void {
		const ctx = this.ctx;
		const t = this.atkT;
		const crouch = 0.55;
		const air = 1.0;
		if (t < crouch) {
			this.yaw = dampAngle(this.yaw, this.yawToPlayer(), 4, dt);
			return;
		}
		if (this.once('jump', crouch)) {
			// Land just short of the player so we don't come down on top of them.
			const p = ctx.player.position;
			_v.set(this.position.x - p.x, 0, this.position.z - p.z);
			const d = _v.length();
			if (d > 0.01) _v.multiplyScalar(Math.min(d, 3) / d);
			this.target.copy(p).add(_v);
			this.clampArena(this.target, ROAM_R);
			this.leapFrom.copy(this.position);
			this.tele('circle', this.target.x, this.target.z, 0, 5, air, TELE.heavy);
			this.pose = 'raise';
			ctx.audio.sfx('boss_charge', this.position, { pitch: 1.2 });
			ctx.vfx.dust(_v.copy(this.position).setY(FLOOR + 0.1), 1.2, 0xb8a8c8);
		}
		if (t < crouch + air) {
			const s = (t - crouch) / air;
			this.position.lerpVectors(this.leapFrom, this.target, s);
			this.position.y = FLOOR + Math.sin(s * Math.PI) * 7;
			this.yaw = Math.atan2(this.target.x - this.leapFrom.x, this.target.z - this.leapFrom.z);
			if (s > 0.6) this.pose = 'slamDown';
			return;
		}
		if (this.once('land', crouch + air)) {
			this.position.copy(this.target).setY(FLOOR);
			this.aoe(this.target, 5, 36, { name: 'Tyrant Leap', heavy: true, knockback: 13, tags: HitTag.AOE, blockable: true });
			this.crater(this.target, 5, true);
			this.exposedT = 1.4;
			ctx.feel.hitStop(0.05);
		}
		if (this.once('recover', crouch + air + 1.0)) this.pose = 'idle';
	}

	private seedBombs(): void {
		const ctx = this.ctx;
		const p = ctx.player.position;
		const placed: THREE.Vector3[] = [];
		const count = 5;
		for (const b of this.bombs) {
			if (placed.length >= count) break;
			if (b.alive) continue;
			for (let tries = 0; tries < 12; tries++) {
				const a = Math.random() * Math.PI * 2;
				const r = 6 + Math.random() * (ROAM_R - 4);
				_v.set(CENTER.x + Math.cos(a) * r, FLOOR, CENTER.z + Math.sin(a) * r);
				if (Math.hypot(_v.x - p.x, _v.z - p.z) < 5) continue;
				if (Math.hypot(_v.x - this.position.x, _v.z - this.position.z) < 4) continue;
				if (placed.some((q) => q.distanceTo(_v) < 4.5)) continue;
				const fuse = 3.6 + placed.length * 0.3;
				const tele = this.ctx.vfx.telegraphs.spawn('circle', _v.x, _v.z, 0, 4.5, fuse, TELE.magic, { floorY: FLOOR, hold: 0.05 });
				b.arm(_v, fuse, tele);
				placed.push(_v.clone());
				ctx.vfx.bolt(this.rig.handPosition('R', _v2), b.aimPoint(_v3), CRYSTAL, 0.4, 0.3);
				break;
			}
		}
		ctx.audio.sfx('crystal', this.position, { pitch: 0.7 });
		if (placed.length) ctx.ui.notify('Volatile Crystals', 'Shatter them before they detonate!', 'warning');
	}

	private stepBombs(dt: number): void {
		const ctx = this.ctx;
		for (const b of this.bombs) {
			if (!b.alive) continue;
			b.fuse -= dt;
			const k = Math.max(0, 1 - b.fuse / 3.6);
			b.mat.emissiveIntensity = 2 + k * 6 + Math.sin(this.time * (8 + k * 30)) * (1 + k * 2);
			b.mesh.rotation.y += dt * (1 + k * 6);
			b.mesh.scale.setScalar(1 + k * 0.35);
			if (b.fuse <= 0) {
				b.aimPoint(_v);
				ctx.vfx.explosion(_v, 4.5, 0xff60d0);
				ctx.vfx.burst(_v, 'shard', 0xffd0f0, 0xff2090, 30, 12, 0.9, 0.3, { gravity: -10 });
				ctx.audio.sfx('explosion', _v, { pitch: 1.2 });
				ctx.feel.shake(0.35);
				this.aoe(b.position, 4.5, 34, { name: 'Volatile Crystal', heavy: true, knockback: 11, tags: HitTag.AOE, blockable: true }, 3.5);
				b.disarm();
			}
		}
	}

	// ------------------------------------------------------------------ simulation

	fixedUpdate(dt: number): void {
		const ctx = this.ctx;
		this.time += dt;
		this.prevPosition.copy(this.position);
		this.prevYaw = this.yaw;
		for (let i = this.pending.length - 1; i >= 0; i--) {
			if (this.time >= this.pending[i].at) {
				const p = this.pending[i];
				this.pending.splice(i, 1);
				p.fn();
			}
		}
		this.stepShockwaves(dt);
		this.stepBombs(dt);
		if (this.state === 'dead') return;
		if (this.state === 'dormant') {
			const p = ctx.player.position;
			if (ctx.playing && ctx.player.alive && ctx.interactables.sealOpen && Math.hypot(p.x - CENTER.x, p.z - CENTER.z) < ARENA.r - 6 && p.y < FLOOR + 4) this.startIntro();
			return;
		}
		this.stateT += dt;
		this.exposedT = Math.max(0, this.exposedT - dt);
		this.brokenT = Math.max(0, this.brokenT - dt);
		if (this.alive) {
			this.statuses.update(dt, (dmg, el) => {
				if (!this.alive) return;
				ctx.combat.applyHit(this, {
					source: 'player',
					attacker: ctx.player,
					element: el,
					damage: dmg,
					point: this.aimPoint(new THREE.Vector3()),
					dir: new THREE.Vector3(),
					knockback: 0,
					poise: 0,
					heavy: false,
					critChance: 0,
					critMult: 1,
					tags: HitTag.DOT
				});
			});
		}
		const canAct = this.statuses.canAct() && !this.statuses.immobilized();
		this.speed = 0;
		switch (this.state) {
			case 'intro':
				this.stepIntro();
				break;
			case 'transition':
				this.stepTransition();
				break;
			case 'dying':
				this.stepDying(dt);
				break;
			case 'stagger':
			case 'overheat':
				if (this.state === 'overheat' && Math.random() < dt * 10) {
					this.rig.corePosition(_v).add(_v2.set((Math.random() - 0.5) * 2, 1 + Math.random(), (Math.random() - 0.5) * 2));
					ctx.vfx.burst(_v, 'smoke', 0xf0e0ff, 0x806090, 1, 1.5, 1.2, 0.8, { up: 3, alpha: true });
				}
				if (this.stateT >= this.stateDur) {
					this.pose = 'idle';
					this.enter('idle', 0.4);
				}
				break;
			case 'idle':
				if (!ctx.player.alive) {
					this.pose = 'roar';
					break;
				}
				this.yaw = dampAngle(this.yaw, this.yawToPlayer(), 2.5, dt);
				if (canAct && this.stateT >= this.stateDur) {
					const a = this.chooseAttack();
					if (a) {
						const d = this.distToPlayer();
						if (a.melee && d > a.range[1]) {
							this.pendingMelee = a.id;
							this.enter('move', 3.5);
							this.pose = 'walk';
						} else this.startAttack(a);
					}
				}
				break;
			case 'move': {
				const d = this.distToPlayer();
				const a = this.pendingMelee ? ATTACKS[this.pendingMelee] : null;
				if (!ctx.player.alive || !a) {
					this.enter('idle', 0.5);
					break;
				}
				if (d <= a.range[1] - 0.5) {
					this.pendingMelee = null;
					this.startAttack(a);
					break;
				}
				if (this.stateT > this.stateDur) {
					// Couldn't catch them: punish from range instead.
					this.pendingMelee = null;
					this.startAttack(ATTACKS[this.phase >= 2 && (this.cooldowns.get('leap') ?? 0) <= this.time ? 'leap' : 'volley']);
					break;
				}
				if (!canAct) break;
				this.yaw = dampAngle(this.yaw, this.yawToPlayer(), 3, dt);
				const sp = (this.phase === 3 ? 4.6 : 3.6) * this.statuses.moveMult();
				this.forward(_v);
				this.position.addScaledVector(_v, sp * dt);
				this.clampArena(this.position, ROAM_R);
				this.speed = sp;
				break;
			}
			case 'attack':
				if (canAct) {
					this.atkT += dt;
					this.stateT = this.atkT;
					this.stepAttack(dt);
				}
				break;
		}
		this.stepFootsteps(dt);
		this.syncBody();
	}

	private stepFootsteps(dt: number): void {
		if (this.speed <= 0) return;
		this.stepT -= dt;
		if (this.stepT > 0) return;
		this.stepT = 0.62;
		const ctx = this.ctx;
		ctx.vfx.dust(_v.copy(this.position).setY(FLOOR + 0.1), 0.6, 0xb8a8c8);
		ctx.audio.sfx('golem_slam', this.position, { volume: 0.3, pitch: 0.55 });
		if (this.distToPlayer() < 18) ctx.feel.shake(0.06);
	}

	/** Move the kinematic body; let the player pass through while overlapping so nobody gets stuck. */
	private syncBody(): void {
		const p = this.ctx.player.position;
		const d = Math.hypot(p.x - this.position.x, p.z - this.position.z);
		const overlap = d < RADIUS + this.ctx.player.radius + 0.05 || this.position.y > FLOOR + 0.5;
		const solid = this.alive && this.state !== 'dead' && !overlap;
		if (this.collider.isEnabled() !== solid) this.collider.setEnabled(solid);
		this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y + HEIGHT / 2, z: this.position.z });
	}

	postStep(): void {
		this.updateHurtboxes();
	}

	private updateHurtboxes(): void {
		const p = this.position;
		const body = this.hurtboxes[0];
		body.a.set(p.x, p.y + 1.6, p.z);
		body.b.set(p.x, p.y + 5.4, p.z);
		const core = this.hurtboxes[1];
		const kneel = this.pose === 'kneel' || this.pose === 'stuck' || this.pose === 'slamDown';
		const fx = Math.sin(this.yaw) * 1.4;
		const fz = Math.cos(this.yaw) * 1.4;
		core.a.set(p.x + fx, p.y + (kneel ? 3.2 : 4.6), p.z + fz);
		core.b.copy(core.a);
		core.r = this.exposed ? 1.2 : 0.9;
		core.weak = this.exposed ? 2.4 : 1.25;
	}

	update(dt: number, alpha: number): void {
		const ctx = this.ctx;
		// The arena is far from everything else: skip its visuals until the player is close.
		const pp = ctx.player.position;
		const near = Math.hypot(pp.x - CENTER.x, pp.z - CENTER.z) < 230;
		this.group.visible = near;
		if (!near && !this.active) {
			this.rig.root.visible = false;
			return;
		}
		if (this.state !== 'dead') this.rig.root.visible = true;
		this.renderPosition.lerpVectors(this.prevPosition, this.position, alpha);
		const root = this.rig.root;
		root.position.copy(this.renderPosition);
		root.rotation.y = this.prevYaw + wrapAngle(this.yaw - this.prevYaw) * alpha;
		const a = this.anim;
		a.pose = this.pose;
		a.speed = this.speed;
		a.exposed = this.exposed;
		a.warded = this.warded && this.state !== 'dying';
		if (this.state !== 'dead' || this.victoryT >= 0) this.rig.update(dt, a);
		this.rig.corePosition(this.core);
		const visible = root.visible;
		for (const p of this.pillars) p.update(dt, this.time, this.core, visible);
		this.linkMat.uniforms.uTime.value = this.time;
		this.barrierMat.uniforms.uTime.value = this.time;
		this.barrierMat.uniforms.uAlpha.value += ((this.barrier ? 1 : 0) - this.barrierMat.uniforms.uAlpha.value) * Math.min(1, dt * 3);
		this.barrierMesh.visible = this.barrierMat.uniforms.uAlpha.value > 0.01;
		if (this.victoryT >= 0) {
			this.victoryT -= dt;
			if (this.victoryT < 0) {
				root.visible = false;
				ctx.flow.victory();
			}
		}
		// Ambient crystal motes around the awake Tyrant.
		if (this.active && this.alive && Math.random() < dt * 6) {
			_v.copy(this.renderPosition).add(_v2.set((Math.random() - 0.5) * 5, 1 + Math.random() * 6, (Math.random() - 0.5) * 5));
			ctx.vfx.burst(_v, 'glow', 0xffe0ff, this.phase === 3 ? 0xff3080 : CRYSTAL, 1, 0.6, 1.2, 0.12, { up: 1, intensity: 2 });
		}
	}

	hud(): BossHud | null {
		if (!this.active || (this.state === 'intro' && this.stateT < 2.2)) return null;
		return {
			name: 'Azrak',
			title: 'The Crystal Tyrant',
			hp: Math.ceil(this.hp),
			maxHp: this.maxHp,
			phase: this.phase,
			phases: PHASES,
			shield: this.pillars.filter((p) => p.state === 'charged').length,
			broken: this.brokenT > 0
		};
	}

	dispose(): void {
		const ctx = this.ctx;
		this.interrupt();
		this.removeBarrier();
		ctx.scene.remove(this.group, this.rig.root);
		this.rig.dispose();
		for (const p of this.pillars) p.mat.dispose();
		for (const b of this.bombs) b.mat.dispose();
		for (const g of this.geos) g.dispose();
		for (const m of this.mats) m.dispose();
	}
}
