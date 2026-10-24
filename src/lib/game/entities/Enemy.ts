import * as THREE from 'three';
import type { Collider, KinematicCharacterController, RigidBody } from '@dimforge/rapier3d-compat';
import type { GameContext } from '../core/context';
import type { Combatant, Element, HitInfo, HitResult, Hurtbox } from '../combat/types';
import { HitTag, newUid } from '../combat/types';
import { StatusSet } from '../combat/StatusEffects';
import { GROUPS } from '../physics/PhysicsWorld';
import { ARCHETYPES, type EnemyArchetype, type EnemyKind } from './EnemyTypes';
import { createEnemyVisual, type EnemyAnimState, type EnemyVisual } from './EnemyModels';
import { EnemyAI } from './EnemyAI';
import { dampAngle, wrapAngle } from '../utils/math';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

export interface EnemySpawnOpts {
	yaw?: number;
	encounter?: string;
	/** Multiplier on HP and damage for tougher variants. */
	elite?: boolean;
	level?: number;
}

/** A regular foe: physics body, stats, statuses, poise and an AI brain. */
export class Enemy implements Combatant {
	readonly uid = newUid();
	readonly team = 'enemy' as const;
	readonly def: EnemyArchetype;
	readonly name: string;
	readonly statuses = new StatusSet();
	readonly position = new THREE.Vector3();
	readonly prevPosition = new THREE.Vector3();
	readonly renderPosition = new THREE.Vector3();
	readonly velocity = new THREE.Vector3();
	/** Knockback / pull velocity layered on top of AI movement. */
	readonly external = new THREE.Vector3();
	/** Desired horizontal velocity from the AI. */
	readonly desired = new THREE.Vector3();
	readonly home = new THREE.Vector3();
	readonly hurtboxes: Hurtbox[] = [];
	readonly radius: number;
	readonly height: number;
	readonly ai: EnemyAI;
	readonly model: EnemyVisual;
	readonly anim: EnemyAnimState = { speed: 0, phase: 'idle', t: 0, attackId: '', frozen: false, stunned: false, burning: false, shocked: false, wet: false, barrier: false, exposed: false };
	yaw = 0;
	private prevYaw = 0;
	hp: number;
	maxHp: number;
	level: number;
	alive = true;
	poise: number;
	maxPoise: number;
	private poiseTimer = 0;
	barrierHp = 0;
	barrierTime = 0;
	grounded = false;
	encounter: string | null;
	elite: boolean;
	damageMult: number;
	/** Time since death (for the dissolve) or -1 while alive. */
	deadT = -1;
	removed = false;
	lastHitTime = -100;
	private body: RigidBody;
	private collider: Collider;
	private cc: KinematicCharacterController;
	private lootDropped = false;

	constructor(
		private ctx: GameContext,
		kind: EnemyKind,
		pos: THREE.Vector3,
		opts: EnemySpawnOpts = {}
	) {
		this.def = ARCHETYPES[kind];
		this.elite = !!opts.elite;
		this.name = (this.elite ? 'Elder ' : '') + this.def.name;
		this.encounter = opts.encounter ?? null;
		this.level = opts.level ?? this.def.level + (this.elite ? 2 : 0);
		const lvlK = 1 + (this.level - this.def.level) * 0.12;
		this.maxHp = Math.round(this.def.hp * lvlK * (this.elite ? 1.6 : 1));
		this.hp = this.maxHp;
		this.damageMult = lvlK * (this.elite ? 1.25 : 1);
		this.maxPoise = this.def.poise * (this.elite ? 1.4 : 1);
		this.poise = this.maxPoise;
		this.radius = this.def.radius;
		this.height = this.def.height;
		const half = Math.max(0.05, this.height / 2 - this.radius);
		const y = ctx.world.terrain.heightAt(pos.x, pos.z);
		this.position.set(pos.x, y, pos.z);
		this.prevPosition.copy(this.position);
		this.renderPosition.copy(this.position);
		this.home.copy(this.position);
		const { body, collider } = ctx.physics.createCharacter(pos.x, y + this.height / 2 + 0.02, pos.z, this.radius, half, GROUPS.enemy, { kind: 'enemy', ref: this });
		this.body = body;
		this.collider = collider;
		this.cc = ctx.physics.world.createCharacterController(0.03);
		this.cc.setUp({ x: 0, y: 1, z: 0 });
		this.cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
		this.cc.enableAutostep(0.5, 0.2, false);
		this.cc.enableSnapToGround(0.5);
		this.yaw = this.prevYaw = opts.yaw ?? Math.random() * Math.PI * 2;
		this.hurtboxes.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: this.radius + 0.1, weak: 1 });
		if (this.def.weak) this.hurtboxes.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: this.def.weak.radius, weak: this.def.weak.mult });
		if (kind === 'golem') this.statuses.controlResist = 0.6;
		this.model = createEnemyVisual(kind);
		if (this.elite) this.model.root.scale.setScalar(1.15);
		ctx.scene.add(this.model.root);
		this.ai = new EnemyAI(ctx, this);
		this.updateHurtboxes();
	}

	// ------------------------------------------------------------------ Combatant

	affinity(el: Element): number {
		return this.def.affinity[el] ?? 1;
	}

	defense(): number {
		const exposed = this.ai.state === 'stagger' || this.statuses.has('exposed');
		return this.def.defense * (exposed ? 0.4 : 1);
	}

	aimPoint(out: THREE.Vector3): THREE.Vector3 {
		return out.copy(this.position).setY(this.position.y + this.def.hover + this.height * 0.58);
	}

	invulnerable(): boolean {
		return this.ai.state === 'blink';
	}

	/** Mage barriers soak damage before health. */
	absorb(damage: number): number {
		if (this.barrierHp <= 0) return 0;
		const a = Math.min(this.barrierHp, damage);
		this.barrierHp -= a;
		if (this.barrierHp <= 0) {
			this.barrierTime = 0;
			this.ctx.vfx.burst(this.aimPoint(_v), 'shard', 0xff80e0, 0xa020ff, 26, 9, 0.7, 0.25, { gravity: -10 });
			this.ctx.audio.sfx('barrier_break', this.position);
			this.ctx.numbers.spawn(_v, 'BARRIER BROKEN', 'reaction');
		}
		return a;
	}

	onHit(hit: HitInfo, result: HitResult): void {
		const ctx = this.ctx;
		this.lastHitTime = ctx.time;
		this.model.flash(result.crit ? 1 : 0.7);
		this.ai.onDamaged(hit);
		if (result.killed) {
			this.die(hit);
			return;
		}
		// Knockback scaled by mass; heavier impacts pop light foes into the air.
		if (hit.knockback > 0 && !this.statuses.has('frozen')) {
			_d.copy(hit.dir).setY(0);
			if (_d.lengthSq() < 1e-4) _d.subVectors(this.position, hit.point).setY(0);
			_d.normalize().multiplyScalar(hit.knockback * this.def.mass * (this.ai.state === 'attack' && this.ai.phase === 'windup' ? 0.6 : 1));
			this.external.add(_d);
			if (hit.heavy) this.velocity.y = Math.max(this.velocity.y, 3 * this.def.mass);
		}
		// Poise break → stagger (interrupts attacks).
		if (hit.poise > 0 && !(hit.tags & HitTag.DOT)) {
			this.poise -= hit.poise * (hit.heavy ? 1.3 : 1);
			this.poiseTimer = 3;
			if (this.poise <= 0) {
				this.poise = this.maxPoise;
				this.ai.stagger(this.def.staggerTime);
				ctx.numbers.spawn(_v.copy(this.position).setY(this.position.y + this.height + 0.4), 'STAGGER', 'reaction');
				ctx.audio.sfx('stagger', this.position);
			}
		}
	}

	/** A perfect parry breaks the attacker's guard. */
	onParried(): void {
		this.ai.stagger(this.def.kind === 'golem' ? 2.4 : 1.8);
		this.statuses.apply({ id: 'exposed', duration: 2.6 });
		this.poise = this.maxPoise;
	}

	/** Tornado pull: drags toward the centre and lifts light foes. */
	pull(center: THREE.Vector3, strength: number, radius: number, dt: number): void {
		if (!this.alive || this.statuses.has('frozen')) return;
		_d.subVectors(center, this.position).setY(0);
		const dist = _d.length();
		if (dist < 0.01) return;
		const k = Math.min(1, dist / radius);
		_d.normalize();
		// Swirl tangentially as well as inward.
		const tx = -_d.z;
		const tz = _d.x;
		this.external.x += (_d.x * strength * k + tx * strength * 0.6) * dt * 6 * this.def.mass;
		this.external.z += (_d.z * strength * k + tz * strength * 0.6) * dt * 6 * this.def.mass;
		if (dist < radius && this.def.mass > 0.5) this.velocity.y = Math.max(this.velocity.y, 4.5 * this.def.mass);
	}

	private die(hit: HitInfo): void {
		const ctx = this.ctx;
		this.alive = false;
		this.deadT = 0;
		this.ai.die();
		this.statuses.clear();
		this.barrierHp = 0;
		ctx.physics.world.removeRigidBody(this.body);
		ctx.physics.untag(this.collider);
		ctx.vfx.death(this.aimPoint(_v), this.def.color, this.def.kind === 'golem' ? 1.6 : 1);
		ctx.audio.sfx(`death_${this.def.kind}`, this.position);
		ctx.feel.hitStop(hit.heavy ? 0.09 : 0.06);
		if (!this.lootDropped) {
			this.lootDropped = true;
			ctx.pickups.dropFrom(this);
		}
	}

	// ------------------------------------------------------------------ simulation

	fixedUpdate(dt: number): void {
		if (!this.alive) {
			this.deadT += dt;
			return;
		}
		const ctx = this.ctx;
		this.prevPosition.copy(this.position);
		this.prevYaw = this.yaw;
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
		if (!this.alive) return;
		this.poiseTimer -= dt;
		if (this.poiseTimer <= 0) this.poise = Math.min(this.maxPoise, this.poise + this.maxPoise * 0.25 * dt);
		if (this.barrierTime > 0) {
			this.barrierTime -= dt;
			if (this.barrierTime <= 0) this.barrierHp = 0;
		}
		// Standing in water soaks the foe (feeds Overcharge).
		const wl = ctx.world.terrain.waterLevelAt(this.position.x, this.position.z);
		if (wl > this.position.y + 0.2) this.statuses.apply({ id: 'wet', duration: 5 });

		this.ai.fixedUpdate(dt);

		// Integrate: AI wish velocity (scaled by slows) + external impulses + gravity.
		const mm = this.statuses.moveMult();
		this.velocity.x = this.desired.x * mm + this.external.x;
		this.velocity.z = this.desired.z * mm + this.external.z;
		this.velocity.y -= 30 * dt;
		if (this.velocity.y < -40) this.velocity.y = -40;
		this.external.multiplyScalar(Math.exp(-5 * dt));
		this.cc.computeColliderMovement(this.collider, { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt }, undefined, GROUPS.enemyMove);
		const m = this.cc.computedMovement();
		this.grounded = this.cc.computedGrounded();
		if (this.grounded && this.velocity.y < 0) this.velocity.y = 0;
		const t = this.body.translation();
		this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
	}

	postStep(): void {
		if (!this.alive) return;
		const t = this.body.translation();
		this.position.set(t.x, t.y - this.height / 2 - 0.02, t.z);
		if (this.position.y < -30) {
			// Fell out of the world: put it back home.
			this.teleport(this.home);
		}
		this.updateHurtboxes();
	}

	teleport(p: THREE.Vector3): void {
		const y = this.ctx.world.terrain.heightAt(p.x, p.z);
		this.body.setTranslation({ x: p.x, y: y + this.height / 2 + 0.05, z: p.z }, true);
		this.body.setNextKinematicTranslation({ x: p.x, y: y + this.height / 2 + 0.05, z: p.z });
		this.position.set(p.x, y, p.z);
		this.prevPosition.copy(this.position);
		this.velocity.set(0, 0, 0);
		this.external.set(0, 0, 0);
		this.updateHurtboxes();
	}

	faceToward(x: number, z: number, rate: number, dt: number): void {
		const target = Math.atan2(x - this.position.x, z - this.position.z);
		this.yaw = dampAngle(this.yaw, target, rate, dt);
	}

	private updateHurtboxes(): void {
		const p = this.position;
		const body = this.hurtboxes[0];
		const base = p.y + this.def.hover;
		body.a.set(p.x, base + this.radius, p.z);
		body.b.set(p.x, base + this.height - this.radius, p.z);
		if (this.def.weak && this.hurtboxes[1]) {
			const w = this.def.weak;
			const s = this.elite ? 1.15 : 1;
			const fx = Math.sin(this.yaw) * w.forward * s;
			const fz = Math.cos(this.yaw) * w.forward * s;
			this.hurtboxes[1].a.set(p.x + fx, p.y + w.y * s, p.z + fz);
			this.hurtboxes[1].b.copy(this.hurtboxes[1].a);
			// The core is only a true weak point while exposed after an attack or when staggered.
			const exposed = (this.ai.state === 'attack' && this.ai.phase === 'recovery') || this.ai.state === 'stagger';
			this.hurtboxes[1].weak = exposed ? w.mult : 1.3;
		}
	}

	update(dt: number, alpha: number): void {
		this.renderPosition.lerpVectors(this.prevPosition, this.position, alpha);
		const m = this.model;
		m.root.position.copy(this.renderPosition);
		m.root.position.y += this.def.hover;
		m.root.rotation.y = this.prevYaw + wrapAngle(this.yaw - this.prevYaw) * alpha;
		const a = this.anim;
		a.speed = Math.hypot(this.velocity.x, this.velocity.z);
		a.frozen = this.statuses.has('frozen');
		a.stunned = this.statuses.has('stunned');
		a.burning = this.statuses.has('burning');
		a.shocked = this.statuses.has('shocked');
		a.wet = this.statuses.has('wet');
		a.barrier = this.barrierHp > 0;
		a.exposed = this.statuses.has('exposed') || (this.ai.state === 'attack' && this.ai.phase === 'recovery');
		this.ai.fillAnim(a);
		m.update(dt, a);
		if (this.deadT >= 0) {
			m.dissolve(this.deadT / 1.3);
			if (this.deadT > 1.4) this.removed = true;
		}
		// Ambient status particles.
		if (this.alive && Math.random() < dt * 14) {
			this.aimPoint(_v);
			if (a.burning) this.ctx.vfx.burst(_v, 'flame', 0xffc070, 0xff3000, 1, 1.2, 0.5, 0.5, { up: 2, intensity: 2.2, spread: this.radius });
			if (a.frozen) this.ctx.vfx.burst(_v, 'star', 0xffffff, 0x8af0ff, 1, 0.6, 0.6, 0.15, { spread: this.radius });
			if (a.wet && Math.random() < 0.4) this.ctx.vfx.burst(_v, 'glow', 0xa8d8ff, 0x5a8aff, 1, 0.5, 0.6, 0.08, { gravity: -9, spread: this.radius, intensity: 1 });
			if (a.shocked && Math.random() < 0.3) this.ctx.vfx.arcs.spawn(_v, _d.copy(_v).add(new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5)), 0xb8a4ff, 0.08, 0.06, 0.3);
		}
	}

	private disposed = false;

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.ctx.scene.remove(this.model.root);
		this.model.dispose();
		if (this.alive) {
			this.ctx.physics.world.removeRigidBody(this.body);
			this.ctx.physics.untag(this.collider);
		}
		this.ctx.physics.world.removeCharacterController(this.cc);
		this.ctx.profile.forget(this.uid);
		this.ctx.combat.reactions.forget(this.uid);
	}
}

export { ARCHETYPES };
