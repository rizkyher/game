import * as THREE from 'three';
import type { Collider, KinematicCharacterController, RigidBody } from '@dimforge/rapier3d-compat';
import type { GameContext } from '../core/context';
import type { Combatant, Element, HitInfo, HitResult, Hurtbox, PlayerElement } from '../combat/types';
import { HitTag, newUid } from '../combat/types';
import { StatusSet } from '../combat/StatusEffects';
import { GROUPS } from '../physics/PhysicsWorld';
import { PlayerModel, type CharacterAnimInput, type CharacterVisual } from './PlayerModel';
import { PlayerStateMachine } from './PlayerStateMachine';
import { approach, clamp, dampAngle, wrapAngle } from '../utils/math';
import type { DodgeDir } from '../systems/PlayerProfile';

const RADIUS = 0.38;
const HALF = 0.52;
const CENTER = RADIUS + HALF;

export const MOVE = {
	run: 7.2,
	sprint: 11.2,
	accel: 70,
	decel: 55,
	airAccel: 24,
	airDecel: 5,
	gravity: 30,
	fallGravity: 38,
	jump: 10.4,
	doubleJump: 9.8,
	coyote: 0.12,
	terminal: -45,
	dodgeTime: 0.42,
	dodgeIFrames: [0.03, 0.3] as [number, number],
	dodgeSpeed: 17,
	dodgeCost: 20,
	dashTime: 0.26,
	dashSpeed: 24,
	dashIFrames: [0, 0.16] as [number, number],
	dashCost: 18,
	sprintDrain: 12
};

const _v = new THREE.Vector3();
const _move = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _flow = new THREE.Vector3();

/** THE ARCANIST: movement, resources and the player's side of combat. */
export class Player implements Combatant {
	readonly uid = newUid();
	readonly team = 'player' as const;
	readonly name = 'The Arcanist';
	readonly radius = RADIUS;
	readonly height = 1.8;
	readonly statuses = new StatusSet();
	readonly fsm = new PlayerStateMachine();
	readonly position = new THREE.Vector3();
	readonly prevPosition = new THREE.Vector3();
	readonly renderPosition = new THREE.Vector3();
	readonly velocity = new THREE.Vector3();
	/** External knockback velocity, decays over time. */
	readonly push = new THREE.Vector3();
	readonly model: CharacterVisual;
	readonly hurtboxes: Hurtbox[] = [{ a: new THREE.Vector3(), b: new THREE.Vector3(), r: RADIUS, weak: 1 }];
	yaw = 0;
	private prevYaw = 0;
	private turnRate = 0;
	targetYaw = 0;
	alive = true;
	hp = 100;
	maxHp = 100;
	mana = 100;
	stamina = 100;
	ward = 0;
	private wardTime = 0;
	level = 1;
	grounded = true;
	private coyote = 0;
	private jumpsUsed = 0;
	private airDashUsed = false;
	private jumpHeld = false;
	private jumpCut = false;
	private dodgeDir = new THREE.Vector3();
	private dodgeCooldown = 0;
	private flipT = -1;
	sprinting = false;
	private staminaDelay = 0;
	private manaDelay = 0;
	private mercy = 0;
	private lastHurt = -100;
	inWater = false;
	waterDepth = 0;
	private splashTimer = 0;
	private stepTimer = 0;
	private body: RigidBody;
	private collider: Collider;
	private cc: KinematicCharacterController;
	private moveInput = new THREE.Vector2();
	/** Set by PlayerCombat to make the body face the aim direction. */
	aimYaw: number | null = null;
	cutscene = false;
	/** Debug/testing: ignore all damage. */
	godMode = false;
	private anim: CharacterAnimInput = {
		speed: 0,
		runSpeed: MOVE.run,
		grounded: true,
		vy: 0,
		moveLocalX: 0,
		moveLocalZ: 0,
		sprinting: false,
		action: 'none',
		actionT: 0,
		castHand: 'R',
		aimPitch: 0,
		flipT: -1,
		turnRate: 0,
		charge: 0,
		inWater: false
	};

	constructor(
		private ctx: GameContext,
		spawn: THREE.Vector3
	) {
		const { body, collider } = ctx.physics.createCharacter(spawn.x, spawn.y + CENTER, spawn.z, RADIUS, HALF, GROUPS.player, { kind: 'player', ref: this });
		this.body = body;
		this.collider = collider;
		this.cc = ctx.physics.world.createCharacterController(0.03);
		this.cc.setUp({ x: 0, y: 1, z: 0 });
		this.cc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
		this.cc.setMinSlopeSlideAngle((58 * Math.PI) / 180);
		this.cc.enableAutostep(0.45, 0.25, false);
		this.cc.enableSnapToGround(0.4);
		this.cc.setApplyImpulsesToDynamicBodies(false);
		this.position.copy(spawn);
		this.prevPosition.copy(spawn);
		this.renderPosition.copy(spawn);
		this.model = new PlayerModel();
		ctx.scene.add(this.model.root);
		this.refreshStats(true);
	}

	// ------------------------------------------------------------------ resources

	get maxMana(): number {
		return this.ctx.progression.stats().maxMana;
	}

	get maxStamina(): number {
		return this.ctx.progression.stats().maxStamina;
	}

	/** Re-reads derived stats (level up, attributes, relics). */
	refreshStats(fill = false): void {
		const st = this.ctx.progression.stats();
		const ratio = this.maxHp > 0 ? this.hp / this.maxHp : 1;
		this.maxHp = st.maxHp;
		this.level = this.ctx.progression.level;
		if (fill) {
			this.hp = st.maxHp;
			this.mana = st.maxMana;
			this.stamina = st.maxStamina;
		} else {
			this.hp = Math.min(st.maxHp, Math.max(1, Math.round(ratio * st.maxHp)));
			this.mana = Math.min(this.mana, st.maxMana);
		}
	}

	spendMana(n: number): boolean {
		if (this.mana + 0.001 < n) return false;
		this.mana -= n;
		this.manaDelay = 0.9;
		return true;
	}

	spendStamina(n: number): boolean {
		if (this.stamina < n * 0.5) return false;
		this.stamina = Math.max(0, this.stamina - n);
		this.staminaDelay = 0.8;
		return true;
	}

	heal(n: number): void {
		this.hp = Math.min(this.maxHp, this.hp + n);
	}

	restoreMana(n: number): void {
		this.mana = Math.min(this.maxMana, this.mana + n);
	}

	addWard(n: number, seconds: number): void {
		this.ward = Math.max(this.ward, n);
		this.wardTime = seconds;
		this.statuses.apply({ id: 'ward', duration: seconds });
	}

	powerScale(): number {
		return this.ctx.progression.stats().power / 10;
	}

	get inCombat(): boolean {
		return this.ctx.time - this.lastHurt < 6 || this.ctx.enemies.engagedCount() > 0;
	}

	// ------------------------------------------------------------------ Combatant

	affinity(_el: Element): number {
		return 1;
	}

	defense(): number {
		return this.ctx.progression.stats().defense;
	}

	aimPoint(out: THREE.Vector3): THREE.Vector3 {
		return out.copy(this.position).setY(this.position.y + 1.15);
	}

	invulnerable(): boolean {
		if (this.cutscene || !this.alive || this.godMode) return true;
		if (this.mercy > 0) return true;
		const f = this.fsm;
		if (f.move === 'dodge') return f.moveTime >= MOVE.dodgeIFrames[0] && f.moveTime <= MOVE.dodgeIFrames[1];
		if (f.move === 'dash') return f.moveTime <= MOVE.dashIFrames[1];
		if (f.action === 'ultimate') return true;
		return false;
	}

	/** Shield and parry are owned by PlayerCombat. */
	intercept(hit: HitInfo): 'parried' | 'blocked' | null {
		return this.ctx.playerCombat.intercept(hit);
	}

	/** Glacial Ward soaks damage before health. */
	absorb(damage: number): number {
		if (this.ward <= 0) return 0;
		const a = Math.min(this.ward, damage);
		this.ward -= a;
		if (this.ward <= 0) this.statuses.remove('ward');
		return a;
	}

	onHit(hit: HitInfo, result: HitResult): void {
		const ctx = this.ctx;
		if (result.parried) return;
		if (hit.tags & HitTag.DOT) {
			if (this.hp <= 0) this.die();
			return;
		}
		this.lastHurt = ctx.time;
		const knock = result.blocked ? hit.knockback * 0.35 : hit.knockback;
		if (knock > 0) {
			_v.copy(hit.dir).setY(0);
			if (_v.lengthSq() < 1e-4) _v.subVectors(this.position, hit.point).setY(0);
			_v.normalize().multiplyScalar(knock);
			this.push.add(_v);
			if (hit.heavy && !result.blocked) this.velocity.y = Math.max(this.velocity.y, 3.5);
		}
		if (this.hp <= 0) {
			this.die();
			return;
		}
		this.mercy = result.blocked ? 0.12 : 0.3;
		this.model.flash(result.blocked ? 0.3 : 1);
		const heavyHit = !result.blocked && (hit.heavy || result.damage > this.maxHp * 0.16);
		ctx.events.emit('playerHurt', { amount: result.damage, heavy: heavyHit });
		ctx.feel.shake(result.blocked ? 0.12 : heavyHit ? 0.45 : 0.25);
		if (!result.blocked) {
			ctx.audio.sfx('player_hurt', this.position, { volume: 0.8 });
			ctx.feel.hitStop(heavyHit ? 0.07 : 0.03);
		}
		if (heavyHit && this.fsm.action !== 'ultimate') {
			this.fsm.setMove('stagger', 0.5);
			ctx.playerCombat.interrupt(true);
		} else if (!result.blocked && this.fsm.vulnerableCast) ctx.playerCombat.interrupt(false);
	}

	private die(): void {
		if (this.fsm.move === 'dead') return;
		this.alive = false;
		this.hp = 0;
		this.fsm.setMove('dead');
		this.ctx.playerCombat.interrupt(true);
		this.ctx.audio.sfx('player_death', this.position);
		this.ctx.events.emit('playerDeath', {});
	}

	revive(at: THREE.Vector3, yaw: number): void {
		this.alive = true;
		this.fsm.reset();
		this.statuses.clear();
		this.ward = 0;
		this.push.set(0, 0, 0);
		this.velocity.set(0, 0, 0);
		this.refreshStats(true);
		this.teleport(at, yaw);
		this.mercy = 1.5;
	}

	teleport(at: THREE.Vector3, yaw?: number): void {
		this.body.setTranslation({ x: at.x, y: at.y + CENTER, z: at.z }, true);
		this.body.setNextKinematicTranslation({ x: at.x, y: at.y + CENTER, z: at.z });
		this.position.copy(at);
		this.prevPosition.copy(at);
		this.renderPosition.copy(at);
		this.velocity.set(0, 0, 0);
		this.push.set(0, 0, 0);
		if (yaw !== undefined) this.yaw = this.targetYaw = this.prevYaw = yaw;
		this.updateHurtbox();
	}

	// ------------------------------------------------------------------ movement actions

	/** Called by PlayerCombat when a buffered jump is consumed. */
	tryJump(): boolean {
		const f = this.fsm;
		if (!f.canMove || f.move === 'dodge') return false;
		if (this.inWater && this.waterDepth > 1.4) {
			this.velocity.y = 6;
			return true;
		}
		if (this.grounded || this.coyote > 0) {
			this.velocity.y = MOVE.jump;
			this.grounded = false;
			this.coyote = 0;
			this.jumpsUsed = 1;
			this.jumpCut = false;
			this.jumpHeld = true;
			f.setMove('air');
			this.ctx.audio.sfx('jump', this.position, { volume: 0.5 });
			this.ctx.vfx.dust(this.position, 0.3);
			return true;
		}
		if (this.jumpsUsed < 2) {
			this.velocity.y = MOVE.doubleJump;
			this.jumpsUsed = 2;
			this.jumpCut = true;
			this.flipT = 0;
			if (f.move === 'dash') f.setMove('air');
			this.ctx.vfx.doubleJump(_v.copy(this.position).setY(this.position.y + 0.1), this.ctx.playerCombat.element);
			this.ctx.audio.sfx('double_jump', this.position, { volume: 0.7 });
			return true;
		}
		return false;
	}

	setJumpHeld(held: boolean): void {
		this.jumpHeld = held;
	}

	/** Dodge roll on the ground; a dash when sprinting or airborne. */
	tryDodge(): boolean {
		const f = this.fsm;
		if (!f.canDodge() || this.dodgeCooldown > 0 || this.cutscene) return false;
		const dash = !this.grounded || this.sprinting;
		if (dash && !this.grounded && this.airDashUsed) return false;
		if (!this.spendStamina(dash ? MOVE.dashCost : MOVE.dodgeCost)) {
			this.ctx.ui.notify('Out of stamina', '', 'warning');
			return false;
		}
		this.cameraBasis();
		const ix = this.moveInput.x;
		const iz = this.moveInput.y;
		if (ix * ix + iz * iz > 0.04) this.dodgeDir.copy(_fwd).multiplyScalar(iz).addScaledVector(_right, ix).normalize();
		else this.dodgeDir.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
		// Classify relative to the camera for the adaptive-AI profile.
		const fz = this.dodgeDir.dot(_fwd);
		const fx = this.dodgeDir.dot(_right);
		const dir: DodgeDir = Math.abs(fx) > Math.abs(fz) ? (fx > 0 ? 'right' : 'left') : fz > 0 ? 'forward' : 'back';
		this.ctx.profile.recordDodge(dir);
		this.ctx.events.emit('dodge', { dir });
		if (dash) {
			f.setMove('dash', MOVE.dashTime);
			if (!this.grounded) this.airDashUsed = true;
			this.velocity.y = Math.max(0, this.velocity.y * 0.2);
			this.ctx.audio.sfx('dash', this.position, { volume: 0.8 });
			this.ctx.feel.kick(6);
		} else {
			f.setMove('dodge', MOVE.dodgeTime);
			this.ctx.audio.sfx('dodge', this.position, { volume: 0.7 });
		}
		this.targetYaw = Math.atan2(this.dodgeDir.x, this.dodgeDir.z);
		if (!dash || ix * ix + iz * iz > 0.04) this.yaw = this.targetYaw;
		this.ctx.playerCombat.onDodge();
		return true;
	}

	private cameraBasis(): void {
		const cy = this.ctx.cameraCtl.yaw;
		_fwd.set(-Math.sin(cy), 0, -Math.cos(cy));
		_right.set(Math.cos(cy), 0, -Math.sin(cy));
	}

	// ------------------------------------------------------------------ simulation

	fixedUpdate(dt: number): void {
		const ctx = this.ctx;
		const f = this.fsm;
		const input = ctx.input;
		f.update(dt);
		this.prevPosition.copy(this.position);
		this.prevYaw = this.yaw;
		this.dodgeCooldown = Math.max(0, this.dodgeCooldown - dt);
		this.mercy = Math.max(0, this.mercy - dt);
		const st = ctx.progression.stats();

		// Statuses (DoTs route through the combat system).
		this.statuses.update(dt, (dmg, el) => {
			if (!this.alive) return;
			ctx.combat.applyHit(this, {
				source: 'environment',
				attacker: null,
				element: el,
				damage: dmg,
				point: _v.copy(this.position).setY(this.position.y + 1.2),
				dir: _move.set(0, 0, 0),
				knockback: 0,
				poise: 0,
				heavy: false,
				critChance: 0,
				critMult: 1,
				tags: HitTag.DOT
			});
		});
		if (this.wardTime > 0) {
			this.wardTime -= dt;
			if (this.wardTime <= 0) this.ward = 0;
		}

		// Input → camera-relative wish direction.
		const playing = ctx.playing && !this.cutscene;
		this.moveInput.set(playing ? input.axis('left', 'right') : 0, playing ? input.axis('back', 'forward') : 0);
		if (this.moveInput.lengthSq() > 1) this.moveInput.normalize();
		this.cameraBasis();
		_move.copy(_fwd).multiplyScalar(this.moveInput.y).addScaledVector(_right, this.moveInput.x);
		const wishLen = Math.min(1, _move.length());
		if (wishLen > 0.01) _move.multiplyScalar(1 / Math.max(wishLen, 1e-4));

		// Sprint & stamina.
		const wantSprint = playing && input.isDown('sprint') && wishLen > 0.2 && f.action === 'idle';
		this.sprinting = wantSprint && this.stamina > 1 && !(this.inWater && this.waterDepth > 1.0) && (this.grounded || this.sprinting);
		if (this.sprinting && this.grounded) {
			this.stamina = Math.max(0, this.stamina - MOVE.sprintDrain * dt);
			this.staminaDelay = 0.5;
		}
		this.staminaDelay -= dt;
		if (this.staminaDelay <= 0 && f.action !== 'shielding') this.stamina = Math.min(st.maxStamina, this.stamina + st.staminaRegen * dt);
		this.manaDelay -= dt;
		if (this.manaDelay <= 0 && f.action !== 'channeling') this.mana = Math.min(st.maxMana, this.mana + st.manaRegen * (this.inCombat ? 1 : 2.2) * dt);
		if (!this.inCombat && this.alive && ctx.time - this.lastHurt > 6) this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.03 * dt);

		// Horizontal velocity.
		const hv = _v.set(this.velocity.x, 0, this.velocity.z);
		if (f.move === 'dodge') {
			const t = f.moveTime / MOVE.dodgeTime;
			const sp = MOVE.dodgeSpeed * Math.pow(Math.max(0, 1 - t), 1.4) + 2.5;
			hv.copy(this.dodgeDir).multiplyScalar(sp);
			ctx.vfx.dashTrail(_flow.copy(this.position).setY(this.position.y + 0.7), ctx.playerCombat.element, false);
			if (f.moveTime >= MOVE.dodgeTime) {
				f.setMove(this.grounded ? 'ground' : 'air');
				this.dodgeCooldown = 0.12;
			}
		} else if (f.move === 'dash') {
			const t = f.moveTime / MOVE.dashTime;
			// Allow slight steering mid-dash.
			if (wishLen > 0.1) this.dodgeDir.lerp(_move, 0.06).normalize();
			hv.copy(this.dodgeDir).multiplyScalar(MOVE.dashSpeed * (t < 0.8 ? 1 : 1 - (t - 0.8) * 3));
			this.velocity.y = Math.max(this.velocity.y, -1);
			ctx.vfx.dashTrail(_flow.copy(this.position).setY(this.position.y + 0.9), ctx.playerCombat.element, true);
			if (f.moveTime >= MOVE.dashTime) {
				f.setMove(this.grounded ? 'ground' : 'air');
				this.dodgeCooldown = 0.1;
				hv.multiplyScalar(this.sprinting ? 0.55 : 0.4);
			}
		} else if (f.move === 'stagger') {
			hv.multiplyScalar(Math.exp(-8 * dt));
			if (f.moveTime >= f.moveDuration) f.setMove(this.grounded ? 'ground' : 'air');
		} else if (f.move === 'dead') {
			hv.multiplyScalar(Math.exp(-6 * dt));
		} else {
			let speed = this.sprinting ? MOVE.sprint : MOVE.run;
			speed *= f.moveMult * this.statuses.moveMult();
			if (this.inWater) speed *= this.waterDepth > 1.0 ? 0.6 : 0.8;
			if (!f.canMove) speed = 0;
			const target = _flow.copy(_move).multiplyScalar(speed * wishLen);
			const accel = this.grounded ? (wishLen > 0.05 ? MOVE.accel : MOVE.decel) : wishLen > 0.05 ? MOVE.airAccel : MOVE.airDecel;
			hv.x = approach(hv.x, target.x, accel * dt);
			hv.z = approach(hv.z, target.z, accel * dt);
		}
		this.velocity.x = hv.x;
		this.velocity.z = hv.z;

		// Vertical.
		if (f.move !== 'dash') {
			if (this.velocity.y > 0 && !this.jumpHeld && !this.jumpCut && this.jumpsUsed === 1) {
				this.velocity.y *= 0.55;
				this.jumpCut = true;
			}
			const g = this.velocity.y < 0 ? MOVE.fallGravity : MOVE.gravity;
			if (f.action === 'ultimate') this.velocity.y = approach(this.velocity.y, 0.6, 40 * dt);
			else this.velocity.y = Math.max(MOVE.terminal, this.velocity.y - g * dt);
		}
		// Water buoyancy.
		const wl = ctx.world.terrain.waterLevelAt(this.position.x, this.position.z, _flow);
		this.waterDepth = wl > -1e6 ? wl - this.position.y : 0;
		const wasIn = this.inWater;
		this.inWater = this.waterDepth > 0.25;
		if (this.inWater) {
			if (this.waterDepth > 1.3) {
				const float = (this.waterDepth - 1.3) * 6;
				this.velocity.y = Math.max(this.velocity.y, Math.min(float, 4));
				if (this.velocity.y < 0) this.velocity.y *= 0.6;
				this.jumpsUsed = 0;
			}
			// River current.
			this.velocity.x += _flow.x * 2.5 * dt;
			this.velocity.z += _flow.z * 2.5 * dt;
			this.statuses.apply({ id: 'wet', duration: 4 });
			this.splashTimer -= dt;
			if (!wasIn || (hv.lengthSq() > 4 && this.splashTimer <= 0)) {
				this.splashTimer = 0.25;
				ctx.vfx.splash(_v.set(this.position.x, wl, this.position.z), wasIn ? 0.5 : 1.2);
				if (!wasIn) ctx.audio.sfx('splash', this.position, { volume: 0.7 });
			}
		}

		// Knockback decays.
		this.push.multiplyScalar(Math.exp(-7 * dt));

		// Character controller.
		const dx = (this.velocity.x + this.push.x) * dt;
		const dy = (this.velocity.y + this.push.y) * dt;
		const dz = (this.velocity.z + this.push.z) * dt;
		this.cc.computeColliderMovement(this.collider, { x: dx, y: dy, z: dz }, undefined, GROUPS.player);
		const m = this.cc.computedMovement();
		const wasGrounded = this.grounded;
		this.grounded = this.cc.computedGrounded();
		if (dy > 0 && m.y < dy * 0.5) this.velocity.y = Math.min(this.velocity.y, 0);
		if (this.grounded && this.velocity.y <= 0) {
			if (!wasGrounded) this.land(-this.velocity.y);
			this.velocity.y = 0;
			this.coyote = MOVE.coyote;
			this.jumpsUsed = 0;
			this.airDashUsed = false;
			if (f.move === 'air') f.setMove('ground');
		} else {
			this.coyote -= dt;
			if (f.move === 'ground' && this.coyote <= 0) f.setMove('air');
		}
		const t = this.body.translation();
		this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });

		// Facing.
		if (this.aimYaw !== null && f.move !== 'dodge' && f.move !== 'dash') this.targetYaw = this.aimYaw;
		else if (wishLen > 0.1 && f.canMove && f.move !== 'dodge' && f.move !== 'dash') this.targetYaw = Math.atan2(_move.x, _move.z);
		const turn = f.move === 'dodge' || f.move === 'dash' ? 30 : this.aimYaw !== null ? 22 : 14;
		this.yaw = dampAngle(this.yaw, this.targetYaw, turn, dt);
		this.turnRate = wrapAngle(this.yaw - this.prevYaw) / dt;

		if (this.flipT >= 0) {
			this.flipT += dt / 0.48;
			if (this.flipT >= 1 || this.grounded) this.flipT = -1;
		}

		// Footsteps.
		if (this.grounded && hv.lengthSq() > 4 && f.move === 'ground') {
			this.stepTimer -= dt * Math.sqrt(hv.lengthSq()) * 0.32;
			if (this.stepTimer <= 0) {
				this.stepTimer = 1;
				ctx.audio.sfx(this.inWater ? 'step_water' : 'step', this.position, { volume: this.sprinting ? 0.35 : 0.22 });
				if (this.sprinting) ctx.vfx.dust(this.position, 0.1);
			}
		}
	}

	private land(impact: number): void {
		if (impact > 6) {
			this.ctx.vfx.dust(this.position, Math.min(1, impact / 20));
			this.ctx.audio.sfx('land', this.position, { volume: Math.min(0.8, impact / 25) });
			if (impact > 18) this.ctx.feel.shake(0.1);
		}
	}

	/** After physics: read back the body position. */
	postStep(): void {
		const t = this.body.translation();
		this.position.set(t.x, t.y - CENTER, t.z);
		if (this.position.y < -40) {
			this.ctx.events.emit('playerDeath', {});
			this.hp = 0;
			this.alive = false;
			this.fsm.setMove('dead');
		}
		this.updateHurtbox();
	}

	private updateHurtbox(): void {
		const hb = this.hurtboxes[0];
		const crouch = this.fsm.move === 'dodge' ? 0.45 : 0;
		hb.a.set(this.position.x, this.position.y + RADIUS, this.position.z);
		hb.b.set(this.position.x, this.position.y + this.height - RADIUS - crouch, this.position.z);
	}

	/** Per-frame visuals: interpolation and animation. */
	update(dt: number, alpha: number): void {
		this.renderPosition.lerpVectors(this.prevPosition, this.position, alpha);
		const m = this.model;
		m.root.position.copy(this.renderPosition);
		m.root.rotation.y = this.yaw;
		const pc = this.ctx.playerCombat;
		const a = this.anim;
		const hs = Math.hypot(this.velocity.x, this.velocity.z);
		a.speed = hs;
		a.grounded = this.grounded;
		a.vy = this.velocity.y;
		const s = Math.sin(this.yaw);
		const c = Math.cos(this.yaw);
		a.moveLocalX = hs > 0.1 ? (this.velocity.x * c - this.velocity.z * s) / hs : 0;
		a.moveLocalZ = hs > 0.1 ? (this.velocity.x * s + this.velocity.z * c) / hs : 0;
		a.sprinting = this.sprinting;
		a.flipT = this.flipT;
		a.turnRate = this.turnRate;
		a.inWater = this.inWater;
		pc.fillAnim(a);
		const f = this.fsm;
		if (f.move === 'dead') a.action = 'dead';
		else if (f.move === 'dodge') {
			a.action = 'dodge';
			a.actionT = f.moveProgress;
		} else if (f.move === 'dash' && a.action === 'none') a.action = 'dash';
		else if (f.move === 'stagger') {
			a.action = 'hit';
			a.actionT = f.moveProgress;
		}
		a.aimPitch = clamp(this.ctx.cameraCtl.aimPitch(), -0.8, 0.8);
		m.update(dt, a);
	}

	dispose(): void {
		this.ctx.scene.remove(this.model.root);
		this.model.dispose();
	}
}

export type { PlayerElement };
