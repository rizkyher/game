import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Enemy } from './Enemy';
import type { AttackDef } from './EnemyTypes';
import { attackById } from './EnemyTypes';
import type { EnemyAnimState } from './EnemyModels';
import type { HitInfo } from '../combat/types';
import { HitTag } from '../combat/types';
import { clamp, wrapAngle } from '../utils/math';

export type AIState = 'idle' | 'patrol' | 'detect' | 'chase' | 'attack' | 'reposition' | 'evade' | 'defend' | 'stagger' | 'retreat' | 'blink' | 'dead';
export type AttackPhase = 'windup' | 'active' | 'recovery';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _target = new THREE.Vector3();

const TELEGRAPH_COLOR = { normal: 0xff8a3a, heavy: 0xff2a3a, magic: 0xd040ff };

/**
 * Finite-state brain shared by all regular enemies; archetype data (attacks, ranges,
 * evasion, barriers, blinks) shapes the behaviour. Perception uses distance and line of
 * sight; attacks have readable wind-ups, active frames and punishable recoveries.
 */
export class EnemyAI {
	state: AIState = 'idle';
	phase: AttackPhase = 'windup';
	stateTime = 0;
	phaseTime = 0;
	stateDuration = 0;
	attack: AttackDef | null = null;
	aggro = false;
	private cooldowns = new Map<string, number>();
	private perceive = 0;
	canSee = false;
	dist = 999;
	private lastSeen = -100;
	private patrolTarget = new THREE.Vector3();
	private telegraph = -1;
	private attackHit = false;
	private lungeDir = new THREE.Vector3();
	private lungeLeft = 0;
	private shots = 0;
	private shotTimer = 0;
	private aoePoint = new THREE.Vector3();
	private evadeDir = new THREE.Vector3();
	private evadeCd = 0;
	private barrierCd = 4;
	private blinkCd = 2;
	private hexCheck = 0;
	private strafe = Math.random() < 0.5 ? 1 : -1;
	private repositionDir = new THREE.Vector3();

	constructor(
		private ctx: GameContext,
		private e: Enemy
	) {
		this.enter('idle', 1 + Math.random() * 2);
	}

	private enter(s: AIState, duration = 0): void {
		if (this.state === 'attack' && s !== 'attack') this.clearTelegraph();
		this.state = s;
		this.stateTime = 0;
		this.stateDuration = duration;
	}

	private cd(id: string): number {
		return this.cooldowns.get(id) ?? 0;
	}

	get engaged(): boolean {
		return this.aggro && this.state !== 'retreat' && this.state !== 'dead' && this.state !== 'idle' && this.state !== 'patrol';
	}

	// ------------------------------------------------------------------ events

	onDamaged(hit: HitInfo): void {
		if (hit.source !== 'player') return;
		if (!this.aggro) {
			this.aggro = true;
			this.lastSeen = this.ctx.time;
			if (this.state === 'idle' || this.state === 'patrol') this.enter('chase');
		}
		const def = this.e.def;
		// Mages blink away when pressed in melee range.
		if (def.blink && this.dist < def.blink.trigger + 1 && this.blinkCd <= 0 && this.canInterruptForDefence()) this.beginBlink();
	}

	/** The player cast something; a wraith being aimed at may sidestep it. */
	onPlayerCast(projectile: boolean): void {
		const ev = this.e.def.evade;
		if (!ev || !projectile || !this.aggro || this.evadeCd > 0) return;
		if (this.dist > 18 || !this.canInterruptForDefence()) return;
		const aimed = this.ctx.targeting.aimTarget === this.e || this.ctx.targeting.locked === this.e;
		if (!aimed) return;
		// Adapts: players who spam ranged spells get dodged more often.
		const chance = ev.chance + Math.min(0.3, this.ctx.profile.rangedRate() * 0.12);
		if (Math.random() > chance) return;
		this.evadeCd = ev.cooldown;
		_v.subVectors(this.e.position, this.ctx.player.position).setY(0).normalize();
		this.evadeDir.set(-_v.z * this.strafe, 0, _v.x * this.strafe).addScaledVector(_v, 0.3).normalize();
		this.strafe *= -1;
		this.enter('evade', 0.34);
		this.ctx.audio.sfx('wraith_evade', this.e.position, { volume: 0.5 });
	}

	private canInterruptForDefence(): boolean {
		return this.state === 'chase' || this.state === 'reposition' || this.state === 'idle' || (this.state === 'attack' && this.phase === 'recovery');
	}

	stagger(seconds: number): void {
		if (this.state === 'dead') return;
		this.clearTelegraph();
		this.attack = null;
		this.enter('stagger', seconds);
		this.aggro = true;
	}

	die(): void {
		this.clearTelegraph();
		this.attack = null;
		this.enter('dead');
	}

	private clearTelegraph(): void {
		if (this.telegraph >= 0) this.ctx.vfx.telegraphs.cancel(this.telegraph);
		this.telegraph = -1;
		this.e.model.telegraph(0);
	}

	// ------------------------------------------------------------------ update

	fixedUpdate(dt: number): void {
		const ctx = this.ctx;
		const e = this.e;
		const def = e.def;
		const player = ctx.player;
		this.stateTime += dt;
		for (const [k, v] of this.cooldowns) this.cooldowns.set(k, Math.max(0, v - dt));
		this.evadeCd = Math.max(0, this.evadeCd - dt);
		this.barrierCd = Math.max(0, this.barrierCd - dt);
		this.blinkCd = Math.max(0, this.blinkCd - dt);
		e.desired.set(0, 0, 0);
		if (this.state === 'dead') return;

		// Perception.
		this.perceive -= dt;
		if (this.perceive <= 0) {
			this.perceive = 0.2 + Math.random() * 0.08;
			this.dist = e.position.distanceTo(player.position);
			this.canSee = false;
			if (player.alive && this.dist < def.sight * (this.aggro ? 1.6 : 1)) {
				e.aimPoint(_eye);
				player.aimPoint(_v);
				this.canSee = ctx.physics.lineOfSight(_eye, _v);
			}
			if (this.canSee) this.lastSeen = ctx.time;
		} else this.dist = e.position.distanceTo(player.position);

		if (!e.statuses.canAct()) {
			if (this.state === 'attack' && this.phase === 'windup') {
				this.clearTelegraph();
				this.attack = null;
				this.enter('stagger', 0.2);
			}
			return;
		}

		switch (this.state) {
			case 'idle':
				if (this.shouldAggro()) this.detect();
				else if (this.stateTime > this.stateDuration) this.beginPatrol();
				break;
			case 'patrol': {
				if (this.shouldAggro()) {
					this.detect();
					break;
				}
				_v.subVectors(this.patrolTarget, e.position).setY(0);
				if (_v.length() < 1 || this.stateTime > 10) this.enter('idle', 2 + Math.random() * 3);
				else this.moveDir(_v.normalize(), def.walkSpeed, dt);
				break;
			}
			case 'detect':
				e.faceToward(player.position.x, player.position.z, def.turnRate, dt);
				if (this.stateTime > this.stateDuration) this.enter('chase');
				break;
			case 'chase':
				this.chase(dt);
				break;
			case 'attack':
				this.runAttack(dt);
				break;
			case 'reposition': {
				this.moveDir(this.repositionDir, def.walkSpeed * 1.6, dt);
				e.faceToward(player.position.x, player.position.z, def.turnRate, dt);
				if (this.stateTime > this.stateDuration) this.enter('chase');
				break;
			}
			case 'evade':
				e.desired.copy(this.evadeDir).multiplyScalar((def.evade?.distance ?? 4) / 0.34);
				if (this.stateTime > this.stateDuration) this.enter('chase');
				break;
			case 'defend':
				e.faceToward(player.position.x, player.position.z, def.turnRate, dt);
				if (this.stateTime > this.stateDuration) {
					const b = def.barrier!;
					e.barrierHp = b.hp;
					e.barrierTime = b.duration;
					this.barrierCd = b.cooldown;
					ctx.audio.sfx('barrier_up', e.position);
					ctx.vfx.rings.spawn(_v.copy(e.position).setY(e.position.y + 1), 0xff50d0, 0.3, 1.8, 0.4, { thick: 0.3, intensity: 2.5 });
					this.enter('chase');
				}
				break;
			case 'stagger':
				if (this.stateTime > this.stateDuration) this.enter('chase');
				break;
			case 'retreat': {
				_v.subVectors(e.home, e.position).setY(0);
				e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.25 * dt);
				if (_v.length() < 2) {
					this.aggro = false;
					e.hp = e.maxHp;
					this.enter('idle', 2);
				} else this.moveDir(_v.normalize(), def.runSpeed, dt);
				if (this.canSee && this.dist < def.sight * 0.6 && player.alive && e.home.distanceTo(player.position) < def.leash) this.enter('chase');
				break;
			}
			case 'blink':
				if (this.stateTime > 0.22 && this.stateDuration > 0) {
					this.stateDuration = 0;
					this.completeBlink();
				}
				if (this.stateTime > 0.45) this.enter('chase');
				break;
		}
	}

	private shouldAggro(): boolean {
		return this.ctx.player.alive && this.canSee && this.dist < this.e.def.sight;
	}

	private detect(): void {
		this.aggro = true;
		this.enter('detect', 0.5);
		const e = this.e;
		this.ctx.numbers.spawn(_v.copy(e.position).setY(e.position.y + e.height + 0.5), '!', 'reaction');
		this.ctx.audio.sfx(`alert_${e.def.kind}`, e.position, { volume: 0.7 });
	}

	private beginPatrol(): void {
		const a = Math.random() * Math.PI * 2;
		const r = 3 + Math.random() * 6;
		this.patrolTarget.set(this.e.home.x + Math.cos(a) * r, 0, this.e.home.z + Math.sin(a) * r);
		this.enter('patrol');
	}

	private moveDir(dir: THREE.Vector3, speed: number, dt: number, face = true): void {
		const e = this.e;
		e.desired.set(dir.x * speed, 0, dir.z * speed);
		if (face && speed > 0.1) e.faceToward(e.position.x + dir.x, e.position.z + dir.z, e.def.turnRate, dt);
	}

	private chase(dt: number): void {
		const ctx = this.ctx;
		const e = this.e;
		const def = e.def;
		const player = ctx.player;
		if (!player.alive) {
			this.enter('retreat');
			return;
		}
		// Leash: give up when dragged too far from home and the player is out of sight.
		const fromHome = e.position.distanceTo(e.home);
		if ((fromHome > def.leash && this.dist > 10) || ctx.time - this.lastSeen > 8) {
			this.enter('retreat');
			return;
		}
		// Defensive abilities first.
		if (def.barrier && this.barrierCd <= 0 && e.barrierHp <= 0) {
			const pressure = ctx.profile.projectilePressure(e.uid);
			if (pressure >= 3 || e.hp < e.maxHp * 0.45) {
				this.enter('defend', 0.55);
				ctx.audio.sfx('mage_chant', e.position, { volume: 0.6 });
				return;
			}
		}
		if (def.blink && this.blinkCd <= 0 && this.dist < def.blink.trigger) {
			this.beginBlink();
			return;
		}
		// Interrupt careless casting (mages): the player's charge glow is visible.
		const hex = attackById(def, 'hex');
		this.hexCheck -= dt;
		if (hex && this.hexCheck <= 0 && this.cd('hex') <= 0 && this.canSee) {
			this.hexCheck = 0.25;
			if (player.fsm.vulnerableCast && this.dist < hex.range[1] && Math.random() < 0.65) {
				this.startAttack(hex);
				return;
			}
		}
		e.faceToward(player.position.x, player.position.z, def.turnRate, dt);
		const choice = this.pickAttack();
		if (choice) {
			this.startAttack(choice);
			return;
		}
		// Movement toward the preferred distance band.
		_v.subVectors(player.position, e.position).setY(0);
		const d = _v.length();
		_v.normalize();
		const [near, far] = def.preferred;
		if (far > 3) {
			// Ranged: back off when crowded, close in when far, otherwise strafe.
			if (d < near) this.moveDir(_v2.copy(_v).multiplyScalar(-1), def.runSpeed * 0.85, dt, false);
			else if (d > far || !this.canSee) this.moveDir(_v, def.runSpeed, dt);
			else this.moveDir(_v2.set(-_v.z * this.strafe, 0, _v.x * this.strafe), def.walkSpeed, dt, false);
			if (Math.random() < dt * 0.3) this.strafe *= -1;
		} else {
			const stop = Math.max(1.2, (attackById(def, def.attacks[0].id)?.range[1] ?? 2) * 0.8);
			if (d > stop) this.moveDir(_v, d > 6 ? def.runSpeed : def.runSpeed * 0.7, dt);
			else if (Math.random() < dt * 0.6) {
				// Circle a little instead of standing still while attacks cool down.
				this.repositionDir.set(-_v.z * this.strafe, 0, _v.x * this.strafe);
				this.enter('reposition', 0.5 + Math.random() * 0.5);
			}
		}
	}

	private pickAttack(): AttackDef | null {
		const def = this.e.def;
		if (!this.canSee) return null;
		let total = 0;
		const options: [AttackDef, number][] = [];
		const ranged = this.ctx.profile.rangedRate();
		for (const a of def.attacks) {
			if (a.weight <= 0 || this.cd(a.id) > 0) continue;
			if (this.dist < a.range[0] || this.dist > a.range[1]) continue;
			let w = a.weight;
			// Gap-closers become more likely against players who kite with spells.
			if (a.kind === 'lunge') w *= 1 + Math.min(1.5, ranged * 0.6);
			options.push([a, w]);
			total += w;
		}
		if (!options.length) return null;
		let r = Math.random() * total;
		for (const [a, w] of options) {
			r -= w;
			if (r <= 0) return a;
		}
		return options[0][0];
	}

	// ------------------------------------------------------------------ attacks

	private startAttack(a: AttackDef): void {
		const ctx = this.ctx;
		const e = this.e;
		this.clearTelegraph();
		this.attack = a;
		this.phase = 'windup';
		this.phaseTime = 0;
		this.attackHit = false;
		this.cooldowns.set(a.id, a.cooldown * (0.85 + Math.random() * 0.3));
		this.enter('attack');
		const color = a.heavy ? TELEGRAPH_COLOR.heavy : a.kind === 'aoe' || a.kind === 'hex' ? TELEGRAPH_COLOR.magic : TELEGRAPH_COLOR.normal;
		const tv = ctx.vfx.telegraphs;
		switch (a.telegraph) {
			case 'cone':
				this.telegraph = tv.spawn('cone', e.position.x, e.position.z, e.yaw, a.melee!.radius, a.windup, color, { angle: a.melee!.halfAngle });
				break;
			case 'ring':
				this.telegraph = tv.spawn('circle', e.position.x, e.position.z, 0, a.shockwave!.radius, a.windup, color);
				break;
		}
		ctx.audio.sfx(`windup_${e.def.kind}`, e.position, { volume: a.heavy ? 0.9 : 0.6, pitch: a.id === 'claw2' ? 1.2 : 1 });
	}

	/** Where to aim: usually the player, sometimes where they habitually dodge to. */
	private aimTarget(out: THREE.Vector3): THREE.Vector3 {
		const ctx = this.ctx;
		out.copy(ctx.player.position);
		const pd = ctx.profile.predictedDodge();
		if (pd && Math.random() < 0.4) {
			// Directions are relative to the player's view, as their dodges were.
			const cy = ctx.cameraCtl.yaw;
			const k = 2.8;
			const fwdX = -Math.sin(cy);
			const fwdZ = -Math.cos(cy);
			const rightX = Math.cos(cy);
			const rightZ = -Math.sin(cy);
			const [dx, dz] = pd === 'left' ? [-rightX, -rightZ] : pd === 'right' ? [rightX, rightZ] : pd === 'back' ? [-fwdX, -fwdZ] : [fwdX, fwdZ];
			out.x += dx * k;
			out.z += dz * k;
		}
		return out;
	}

	private runAttack(dt: number): void {
		const ctx = this.ctx;
		const e = this.e;
		const a = this.attack;
		if (!a) {
			this.enter('chase');
			return;
		}
		const player = ctx.player;
		this.phaseTime += dt;
		if (this.phase === 'windup') {
			if (a.trackRate > 0) e.faceToward(player.position.x, player.position.z, a.trackRate, dt);
			e.model.telegraph(clamp(this.phaseTime / a.windup, 0, 1));
			// Keep the cone aligned with the tracking body (fill progress is preserved).
			if (a.telegraph === 'cone' && this.telegraph >= 0 && a.trackRate > 0) ctx.vfx.telegraphs.reposition(this.telegraph, e.position.x, e.position.z, e.yaw);
			if (a.kind === 'lunge' && this.phaseTime > a.windup * 0.4 && this.telegraph < 0) {
				this.aimTarget(_target);
				const yaw = Math.atan2(_target.x - e.position.x, _target.z - e.position.z);
				e.yaw = yaw;
				this.telegraph = ctx.vfx.telegraphs.spawn('line', e.position.x, e.position.z, yaw, 1.0, a.windup * 0.6, TELEGRAPH_COLOR.normal, { length: a.lunge!.distance + 1 });
			}
			if (this.phaseTime >= a.windup) this.activate(a);
			return;
		}
		if (this.phase === 'active') {
			this.stepActive(a, dt);
			if (this.phaseTime >= a.active) {
				if (a.chain) {
					const next = attackById(e.def, a.chain);
					if (next) {
						this.startAttack(next);
						return;
					}
				}
				this.phase = 'recovery';
				this.phaseTime = 0;
				e.model.telegraph(0);
			}
			return;
		}
		// Recovery: committed and punishable.
		if (this.phaseTime >= a.recovery) {
			this.attack = null;
			if (e.def.kind === 'wraith' && Math.random() < 0.6) {
				_v.subVectors(e.position, player.position).setY(0).normalize();
				this.repositionDir.set(_v.x - _v.z * this.strafe * 0.8, 0, _v.z + _v.x * this.strafe * 0.8).normalize();
				this.enter('reposition', 0.5);
			} else this.enter('chase');
		}
	}

	private activate(a: AttackDef): void {
		const ctx = this.ctx;
		const e = this.e;
		this.phase = 'active';
		this.phaseTime = 0;
		e.model.telegraph(1);
		switch (a.kind) {
			case 'melee':
				ctx.audio.sfx(`swing_${e.def.kind}`, e.position, { volume: 0.8 });
				break;
			case 'lunge': {
				this.lungeDir.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
				this.lungeLeft = a.lunge!.distance;
				ctx.audio.sfx('swing_wraith', e.position, { volume: 0.9, pitch: 0.8 });
				break;
			}
			case 'shockwave': {
				const center = e.position.clone();
				ctx.enemies.addShockwave(center, a, e);
				ctx.vfx.dust(center, 1);
				ctx.vfx.rings.spawn(center.clone().setY(center.y + 0.15), 0xd070ff, 1, a.shockwave!.radius, a.shockwave!.radius / a.shockwave!.speed, { thick: 0.1, intensity: 2.5 });
				ctx.audio.sfx('golem_slam', center, { volume: 1 });
				ctx.feel.shake(Math.max(0, 0.5 - this.dist * 0.03));
				break;
			}
			case 'projectile':
				this.shots = a.projectile!.count;
				this.shotTimer = 0;
				break;
			case 'aoe': {
				this.aimTarget(this.aoePoint);
				this.telegraph = ctx.vfx.telegraphs.spawn('circle', this.aoePoint.x, this.aoePoint.z, 0, a.aoe!.radius, a.aoe!.delay, TELEGRAPH_COLOR.magic);
				ctx.vfx.circles.spawn(_v.set(this.aoePoint.x, ctx.world.terrain.heightAt(this.aoePoint.x, this.aoePoint.z), this.aoePoint.z), a.aoe!.radius, 0xb030ff, a.aoe!.delay + 0.2, { spin: -2, intensity: 1.6 });
				ctx.audio.sfx('mage_chant', e.position, { volume: 0.6 });
				break;
			}
			case 'hex':
				this.fireProjectile(a, true);
				break;
		}
	}

	private stepActive(a: AttackDef, dt: number): void {
		const ctx = this.ctx;
		const e = this.e;
		switch (a.kind) {
			case 'melee':
				if (!this.attackHit && this.phaseTime <= a.active) this.meleeCheck(a, a.melee!.radius, a.melee!.halfAngle);
				break;
			case 'lunge': {
				const step = Math.min(this.lungeLeft, a.lunge!.speed * dt);
				_v.copy(e.position).setY(e.position.y + 1);
				if (ctx.physics.castStatic(_v, this.lungeDir, step + e.radius + 0.2) >= 0) this.lungeLeft = 0;
				e.desired.copy(this.lungeDir).multiplyScalar(this.lungeLeft > 0 ? a.lunge!.speed : 0);
				this.lungeLeft -= step;
				if (!this.attackHit) this.meleeCheck(a, a.melee!.radius + e.radius, a.melee!.halfAngle);
				if (Math.random() < 0.6) ctx.vfx.dashTrail(_v.copy(e.position).setY(e.position.y + 1.2), 'shadow', true);
				if (this.lungeLeft <= 0) this.phaseTime = Math.max(this.phaseTime, a.active - 0.05);
				break;
			}
			case 'projectile': {
				this.shotTimer -= dt;
				if (this.shots > 0 && this.shotTimer <= 0) {
					this.shots--;
					this.shotTimer = a.projectile!.interval;
					this.fireProjectile(a, false);
				}
				break;
			}
			case 'aoe':
				if (!this.attackHit && this.phaseTime >= a.aoe!.delay) {
					this.attackHit = true;
					const p = this.aoePoint;
					const g = ctx.world.terrain.heightAt(p.x, p.z);
					_v.set(p.x, g + 0.5, p.z);
					ctx.vfx.burst(_v, 'glow', 0xff60ff, 0x400060, 30, 6, 0.6, 0.5, { up: 6, intensity: 2.5 });
					ctx.vfx.rings.spawn(_v.set(p.x, g + 0.15, p.z), 0xd040ff, 0.4, a.aoe!.radius * 1.2, 0.35, { thick: 0.3, intensity: 3 });
					ctx.audio.sfx('void_burst', _v, { volume: 0.9 });
					const player = ctx.player;
					const d = Math.hypot(player.position.x - p.x, player.position.z - p.z);
					if (d < a.aoe!.radius + player.radius && Math.abs(player.position.y - g) < 2.5) this.hitPlayer(a, _v2.subVectors(player.position, p).setY(0.3));
				}
				break;
		}
	}

	private meleeCheck(a: AttackDef, radius: number, halfAngle: number): void {
		const ctx = this.ctx;
		const e = this.e;
		const player = ctx.player;
		if (!player.alive) return;
		_v.subVectors(player.position, e.position);
		const vy = _v.y;
		_v.setY(0);
		const d = _v.length();
		if (d > radius + player.radius || vy > e.height + 0.5 || vy < -1.5) return;
		const ang = Math.abs(wrapAngle(Math.atan2(_v.x, _v.z) - e.yaw));
		if (ang > halfAngle && d > 1.0) return;
		this.attackHit = true;
		this.hitPlayer(a, _v.normalize());
	}

	private hitPlayer(a: AttackDef, dir: THREE.Vector3): void {
		const ctx = this.ctx;
		const e = this.e;
		const player = ctx.player;
		ctx.combat.applyHit(player, {
			source: 'enemy',
			attacker: e,
			element: a.element,
			damage: a.damage * e.damageMult,
			point: player.aimPoint(new THREE.Vector3()),
			dir: dir.clone(),
			knockback: a.knockback,
			poise: 0,
			heavy: a.heavy,
			critChance: 0,
			critMult: 1.5,
			status: a.status,
			tags: HitTag.MELEE,
			parryable: a.parryable,
			blockable: a.blockable,
			attackName: a.name
		});
	}

	private fireProjectile(a: AttackDef, interrupt: boolean): void {
		const ctx = this.ctx;
		const e = this.e;
		const spec = a.projectile!;
		const origin = e.model.handPosition(new THREE.Vector3());
		// Lead the target slightly using its visible velocity.
		const player = ctx.player;
		const t = origin.distanceTo(player.position) / spec.speed;
		player.aimPoint(_target).addScaledVector(player.velocity, t * 0.5);
		const dir = _target.sub(origin).normalize();
		ctx.spells.enemyProjectile({
			kind: spec.kind,
			origin,
			dir: dir.clone(),
			speed: spec.speed,
			damage: a.damage * e.damageMult,
			element: a.element,
			radius: spec.radius,
			attacker: e,
			homing: player,
			homingRate: spec.homing,
			knockback: a.knockback,
			parryable: a.parryable,
			blockable: a.blockable,
			interrupt
		});
		ctx.vfx.castBurst('shadow', origin, dir, false);
		ctx.audio.sfx(interrupt ? 'hex_cast' : 'mage_bolt', origin, { volume: 0.7 });
	}

	// ------------------------------------------------------------------ blink

	private beginBlink(): void {
		const ctx = this.ctx;
		const e = this.e;
		this.blinkCd = e.def.blink!.cooldown;
		ctx.vfx.burst(e.aimPoint(_v), 'glow', 0xff60ff, 0x300050, 24, 5, 0.6, 0.4, { intensity: 2.5 });
		ctx.audio.sfx('blink', e.position);
		e.model.root.visible = false;
		this.enter('blink', 1);
	}

	private completeBlink(): void {
		const ctx = this.ctx;
		const e = this.e;
		const player = ctx.player;
		_v.subVectors(e.position, player.position).setY(0);
		if (_v.lengthSq() < 0.01) _v.set(1, 0, 0);
		_v.normalize();
		const dist = e.def.blink!.distance;
		// Try a few angles away from the player; pick one with clear ground.
		for (const off of [0, 0.7, -0.7, 1.4, -1.4]) {
			_v2.copy(_v).applyAxisAngle(new THREE.Vector3(0, 1, 0), off).multiplyScalar(dist).add(e.position);
			const g = ctx.world.terrain.heightAt(_v2.x, _v2.z);
			if (Math.abs(g - e.position.y) > 4) continue;
			if (ctx.world.terrain.waterLevelAt(_v2.x, _v2.z) > g) continue;
			_target.copy(_v2).setY(g + 1);
			if (!ctx.physics.lineOfSight(e.aimPoint(_eye), _target)) continue;
			e.teleport(_v2);
			break;
		}
		e.model.root.visible = true;
		ctx.vfx.burst(e.aimPoint(_v), 'glow', 0xff60ff, 0x300050, 24, 4, 0.6, 0.4, { intensity: 2.5 });
		e.faceToward(player.position.x, player.position.z, 100, 1);
	}

	fillAnim(a: EnemyAnimState): void {
		a.attackId = this.attack?.id ?? '';
		switch (this.state) {
			case 'attack': {
				const at = this.attack;
				if (!at) {
					a.phase = 'idle';
					break;
				}
				a.phase = this.phase === 'windup' ? 'windup' : this.phase === 'active' ? 'active' : 'recover';
				const dur = this.phase === 'windup' ? at.windup : this.phase === 'active' ? at.active : at.recovery;
				a.t = clamp(this.phaseTime / Math.max(0.01, dur), 0, 1);
				break;
			}
			case 'detect':
				a.phase = 'alert';
				break;
			case 'stagger':
				a.phase = 'stagger';
				break;
			case 'evade':
			case 'blink':
				a.phase = 'evade';
				break;
			case 'defend':
				a.phase = 'cast';
				a.t = clamp(this.stateTime / 0.55, 0, 1);
				break;
			case 'dead':
				a.phase = 'dead';
				break;
			default:
				a.phase = a.speed > 0.3 ? 'move' : 'idle';
		}
	}
}
