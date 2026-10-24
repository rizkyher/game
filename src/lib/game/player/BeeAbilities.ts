import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Prop } from '../entities/Props';
import { clamp } from '../utils/math';

const _aim = new THREE.Vector3();
const _v = new THREE.Vector3();
const _hold = new THREE.Vector3();

/**
 * Player actions layered over flight: boost meter, dash, barrel roll, headbutt, sting,
 * pick up / carry / throw, struggling free, and the context-sensitive interact prompt.
 */
export class BeeAbilities {
	boost = 1;
	private exhausted = false;
	private boostRegenDelay = 0;
	private boostHeld = false;
	private dashTime = 0;
	private dashCooldown = 0;
	private rollTime = 0;
	private rollCooldown = 0;
	private rollDir = 1;
	private bumpTime = 0;
	private bumpCooldown = 0;
	private stingTime = 0;
	private stingCooldown = 0;
	private stingResolved = true;
	private bumpHits = new Set<Prop>();
	private nearby: Prop[] = [];
	private trailTimer = 0;
	private promptTimer = 0;
	held: Prop | null = null;
	prompt = '';

	constructor(private ctx: GameContext) {}

	isBoosting(moving: boolean): boolean {
		const ctx = this.ctx;
		this.boostHeld = ctx.input.isDown('boost');
		return this.boostHeld && moving && !this.exhausted && this.boost > 0 && !ctx.env.stuck;
	}

	isDashing(): boolean {
		return this.dashTime > 0;
	}

	isAiming(): boolean {
		return this.bumpTime > 0 || this.stingTime > 0 || (this.ctx.input.mouse(0) && !!this.held);
	}

	heldMass(): number {
		return this.held ? this.held.def.mass : 0;
	}

	/** Multiplier applied to impacts on props/NPCs. */
	impactPower(): number {
		if (this.dashTime > 0) return 3.2;
		if (this.bumpTime > 0) return 2.6;
		if (this.ctx.player.diving) return 2.4;
		if (this.rollTime > 0) return 1.8;
		return this.ctx.player.boosting ? 1.4 : 1;
	}

	rollAngle(): number {
		if (this.rollTime <= 0) return 0;
		const t = 1 - this.rollTime / 0.5;
		const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
		return e * Math.PI * 2 * this.rollDir;
	}

	private aimDir(out: THREE.Vector3): THREE.Vector3 {
		const cam = this.ctx.cameraCtl;
		const p = cam.pitch - 0.22;
		return out.set(-Math.sin(cam.yaw) * Math.cos(p), -Math.sin(p) * 0.85, -Math.cos(cam.yaw) * Math.cos(p)).normalize();
	}

	/** Per-frame: read button edges and trigger actions. */
	update(dt: number): void {
		const ctx = this.ctx;
		const input = ctx.input;
		const player = ctx.player;
		const env = ctx.env;
		this.dashCooldown -= dt;
		this.rollCooldown -= dt;
		this.bumpCooldown -= dt;
		this.stingCooldown -= dt;

		// Boost meter.
		if (player.boosting) {
			this.boost = Math.max(0, this.boost - dt * 0.26);
			this.boostRegenDelay = 0.6;
			if (this.boost <= 0) {
				this.exhausted = true;
				ctx.ui.notify('Out of breath!', 'Let go of SHIFT to recover', 'warning');
			}
		} else {
			this.boostRegenDelay -= dt;
			if (this.boostRegenDelay <= 0) this.boost = Math.min(1, this.boost + dt * 0.22);
			if (this.exhausted && this.boost > 0.3) this.exhausted = false;
		}

		if (env.stuck) {
			// Each press is a big wiggle; simply holding a direction keeps wriggling slowly.
			if (input.anyPressed()) env.addStruggle(0.2);
			const holding = input.isDown('up') || input.axis('back', 'forward') !== 0 || input.axis('left', 'right') !== 0;
			if (holding) env.addStruggle(0.35 * dt, false);
			this.updatePrompt(dt);
			return;
		}
		if (player.stunned > 0) return;

		if (input.wasPressed('dash') && this.dashCooldown <= 0 && this.boost >= 0.15) this.dash();
		if (input.wasPressed('roll') && this.rollCooldown <= 0) this.roll();
		if (input.mouseClicked(0)) {
			if (this.held) this.throwHeld();
			else if (this.bumpCooldown <= 0) this.bump();
		}
		if (input.mouseClicked(2) && this.stingCooldown <= 0) this.sting();
		if (input.wasPressed('drop') && this.held) this.dropHeld(true);
		if (input.wasPressed('interact')) this.interact();

		if (this.dashTime > 0 || player.boosting || player.diving) {
			this.trailTimer -= dt;
			if (this.trailTimer <= 0) {
				this.trailTimer = this.dashTime > 0 ? 0.015 : 0.04;
				_v.copy(player.renderPosition).addScaledVector(player.velocity, -0.03);
				ctx.effects.emit('trail', _v, 1, 0.25);
				if (this.dashTime > 0) ctx.effects.emit('sparkle', _v, 1, 0.3);
			}
		}
		this.updatePrompt(dt);
	}

	/** Fixed-step: timers, held object, hit sweeps. */
	fixedUpdate(dt: number): void {
		const ctx = this.ctx;
		const player = ctx.player;
		if (this.dashTime > 0) {
			this.dashTime -= dt;
			player.controlScale = 0.12;
			if (this.dashTime <= 0) player.controlScale = 1;
		}
		if (this.rollTime > 0) this.rollTime -= dt;
		if (this.bumpTime > 0) {
			this.bumpTime -= dt;
			// Headbutt sweep ahead of the bee.
			this.aimDir(_aim);
			_v.copy(player.position).addScaledVector(_aim, 1.3);
			for (const p of ctx.props.query(_v, 2.6, this.nearby)) {
				if (this.bumpHits.has(p)) continue;
				this.bumpHits.add(p);
				ctx.interactions.playerHitProp(p, 2.8);
			}
			ctx.npcs.bumpAt(_v, 2.2, player.velocity, 2.6);
			if (this.bumpTime <= 0) this.bumpHits.clear();
		}
		if (this.dashTime > 0 || this.rollTime > 0) ctx.npcs.bumpAt(player.position, 2, player.velocity, this.dashTime > 0 ? 3 : 1.8);
		else if (player.velocity.lengthSq() > 64) ctx.npcs.bumpAt(player.position, 1.4, player.velocity, 1);
		if (this.stingTime > 0) {
			this.stingTime -= dt;
			if (!this.stingResolved && this.stingTime < 0.25) {
				this.stingResolved = true;
				this.resolveSting();
			}
			if (this.stingTime <= 0) player.model.setSting(false);
		}
		const h = this.held;
		if (h) {
			if (h.broken || !h.body) {
				this.held = null;
			} else {
				_hold.copy(player.position);
				_hold.y -= 1.1 + (h.def.shape.type === 'ball' ? h.def.shape.r : h.def.shape.type === 'cylinder' ? h.def.shape.hh : 0.8);
				_hold.x += Math.sin(player.yaw) * 0.4;
				_hold.z += Math.cos(player.yaw) * 0.4;
				ctx.props.carry(h, _hold, player.yaw);
			}
		}
	}

	private dash(): void {
		const ctx = this.ctx;
		const player = ctx.player;
		const input = ctx.input;
		const cam = ctx.cameraCtl;
		const f = input.axis('back', 'forward');
		const s = input.axis('left', 'right');
		if (Math.abs(f) + Math.abs(s) > 0) {
			_v.set(-Math.sin(cam.yaw) * f + Math.cos(cam.yaw) * s, 0, -Math.cos(cam.yaw) * f - Math.sin(cam.yaw) * s).normalize();
			if (f > 0) _v.y = this.aimDir(_aim).y * 0.8;
			_v.normalize();
		} else this.aimDir(_v);
		player.velocity.copy(_v).multiplyScalar(48);
		player.body.setLinvel({ x: player.velocity.x, y: player.velocity.y, z: player.velocity.z }, true);
		this.dashTime = 0.28;
		this.dashCooldown = 0.7;
		this.boost = Math.max(0, this.boost - 0.15);
		ctx.cameraCtl.kick(14);
		ctx.audio.play('whoosh');
		player.model.setExpression('determined', 0.6);
	}

	private roll(): void {
		const ctx = this.ctx;
		const player = ctx.player;
		const s = ctx.input.axis('left', 'right');
		// +1 rolls/hops to the right (positive tilt.z drops the bee's right side first).
		this.rollDir = s !== 0 ? s : Math.random() < 0.5 ? -1 : 1;
		const cam = ctx.cameraCtl;
		const side = this.rollDir;
		player.launch(Math.cos(cam.yaw) * side * 12, 2, -Math.sin(cam.yaw) * side * 12, 0.15);
		this.rollTime = 0.5;
		this.rollCooldown = 0.75;
		ctx.audio.play('whoosh', { pitch: 1.4, volume: 0.6 });
		ctx.chaos.add('barrel_roll', null);
		player.model.setExpression('happy', 0.6);
	}

	private bump(): void {
		const ctx = this.ctx;
		const player = ctx.player;
		this.aimDir(_aim);
		player.velocity.addScaledVector(_aim, 17);
		player.body.setLinvel({ x: player.velocity.x, y: player.velocity.y, z: player.velocity.z }, true);
		this.bumpTime = 0.34;
		this.bumpCooldown = 0.45;
		this.bumpHits.clear();
		ctx.audio.play('whoosh', { pitch: 1.8, volume: 0.4 });
		player.model.setExpression('determined', 0.5);
		ctx.cameraCtl.kick(5);
	}

	private sting(): void {
		const ctx = this.ctx;
		this.stingTime = 0.4;
		this.stingCooldown = 0.85;
		this.stingResolved = false;
		ctx.player.model.setSting(true);
		ctx.player.model.setExpression('angry', 0.6);
		ctx.audio.play('sting');
		this.aimDir(_aim);
		ctx.player.launch(_aim.x * 6, Math.max(0, _aim.y * 6), _aim.z * 6, 0.05);
	}

	private resolveSting(): void {
		const ctx = this.ctx;
		this.aimDir(_aim);
		_v.copy(ctx.player.position).addScaledVector(_aim, 1.7);
		let hit = false;
		for (const p of ctx.props.query(_v, 2.8, this.nearby)) {
			hit = true;
			p.lastTouch = ctx.time;
			if (p.def.breakable?.sting) ctx.props.breakProp(p);
			else {
				ctx.props.impulse(p, _aim.x * 6 * p.def.mass, (_aim.y * 6 + 4) * p.def.mass, _aim.z * 6 * p.def.mass, 2 * p.def.mass);
				ctx.audio.play('knock', { pitch: 1.5 });
			}
		}
		if (ctx.npcs.stingAt(_v, 2.6)) hit = true;
		if (hit) {
			ctx.effects.emit('sparkle', _v, 8, 0.3);
			ctx.cameraCtl.shake(0.12);
		}
	}

	throwHeld(): void {
		const ctx = this.ctx;
		const h = this.held;
		if (!h) return;
		this.held = null;
		this.aimDir(_aim);
		_v.copy(ctx.player.velocity).addScaledVector(_aim, 30);
		_v.y += 5;
		ctx.props.release(h, _v);
		ctx.audio.play('whoosh', { pitch: 1.2 });
		ctx.chaos.add('yeet', h.pos);
	}

	dropHeld(gentle = false): void {
		const ctx = this.ctx;
		const h = this.held;
		if (!h) return;
		this.held = null;
		_v.copy(ctx.player.velocity);
		if (gentle) _v.y = Math.min(_v.y, 0);
		ctx.props.release(h, _v);
	}

	private interact(): void {
		const ctx = this.ctx;
		if (ctx.challenges.tryInteract()) return;
		if (ctx.npcs.tryTalk()) return;
		if (ctx.collection.trySipNectar()) return;
		if (ctx.collection.tryDeliver()) return;
		if (this.held) {
			this.dropHeld(true);
			return;
		}
		const p = ctx.props.nearestPickup(ctx.player.position, 3.6);
		if (p) {
			ctx.props.pickUp(p);
			this.held = p;
			ctx.audio.play('click');
			ctx.chaos.add('thief', p.pos);
		}
	}

	private updatePrompt(dt: number): void {
		this.promptTimer -= dt;
		if (this.promptTimer > 0) return;
		this.promptTimer = 0.12;
		const ctx = this.ctx;
		if (ctx.env.stuck) {
			this.prompt = '';
			return;
		}
		const c = ctx.challenges.promptText() || ctx.npcs.talkPrompt() || ctx.collection.promptText();
		if (c) {
			this.prompt = c;
			return;
		}
		if (this.held) {
			this.prompt = `[LMB] Throw ${this.held.def.name} · [F] Drop`;
			return;
		}
		const p = ctx.props.nearestPickup(ctx.player.position, 3.6);
		this.prompt = p ? `[E] Pick up ${p.def.name}` : '';
	}

	/** Mushroom caps launch the bee skyward. */
	mushroomBounce(): void {
		const ctx = this.ctx;
		const player = ctx.player;
		if (player.velocity.y > 20) return;
		player.velocity.y = 0;
		player.launch(0, 34, 0, 0.5);
		player.model.bonk(0.4);
		player.model.setExpression('surprised', 0.8);
		ctx.audio.play('boing');
		ctx.effects.emit('spores', player.position, 10, 0.8);
		ctx.chaos.add('bounce', player.position);
	}

	groundPound(pos: THREE.Vector3): void {
		const ctx = this.ctx;
		ctx.cameraCtl.shake(0.9);
		ctx.audio.play('thud', { volume: 1, pitch: 0.7 });
		ctx.effects.emit('dust', pos, 30, 2);
		ctx.effects.emit('stars', pos, 10, 1);
		for (const p of ctx.props.query(pos, 14, this.nearby)) {
			_v.copy(p.pos).sub(pos);
			const d = Math.max(1, _v.length());
			_v.normalize();
			const k = (1 - d / 14) * 22 * Math.min(p.def.mass, 4);
			p.lastTouch = ctx.time;
			ctx.props.impulse(p, _v.x * k, k * 0.9, _v.z * k, k * 0.4);
		}
		ctx.npcs.shockwave(pos, 14);
		ctx.chaos.add('ground_pound', pos);
		ctx.player.launch(0, 10, 0, 0.3);
	}

	/** HUD helper: 0..1 struggle meter. */
	get struggle(): number {
		return clamp(this.ctx.env.struggle, 0, 1);
	}
}
