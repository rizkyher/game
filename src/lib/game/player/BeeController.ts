import * as THREE from 'three';
import type { RigidBody, Collider } from '@dimforge/rapier3d-compat';
import type { GameContext } from '../core/context';
import { GROUPS } from '../physics/PhysicsWorld';
import { BeeModel } from './BeeModel';
import { clamp, damp, dampAngle, dampFactor, wrapAngle } from '../utils/math';

export const BEE_RADIUS = 0.6;

export const FLIGHT = {
	speed: 13,
	boostSpeed: 29,
	ascend: 10,
	ascendBoost: 15,
	descend: 12,
	diveSpeed: 38,
	accel: 5.2,
	boostAccel: 3.4,
	drift: 2.1,
	verticalAccel: 5.5
};

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _accel = new THREE.Vector2();

/**
 * Arcade flight controller. The bee is a dynamic Rapier ball (rotation locked) whose velocity
 * is steered toward the desired velocity every fixed step, so collisions and pushes come for free.
 */
export class BeeController {
	readonly model: BeeModel;
	readonly position = new THREE.Vector3();
	readonly prevPosition = new THREE.Vector3();
	readonly renderPosition = new THREE.Vector3();
	readonly velocity = new THREE.Vector3();
	readonly preStepVelocity = new THREE.Vector3();
	readonly body: RigidBody;
	readonly collider: Collider;
	yaw = 0;
	stunned = 0;
	/** Seconds of reduced control after a launch/bounce. */
	launchTime = 0;
	boosting = false;
	diving = false;
	speed01 = 0;
	distanceFlown = 0;
	controlScale = 1;
	private tiltX = 0;
	private tiltZ = 0;
	private lastVel = new THREE.Vector3();
	private localAccel = new THREE.Vector2();
	private coatHoney = 0;
	private coatWet = 0;
	private spin = 0;
	private impactCooldown = 0;

	constructor(
		private ctx: GameContext,
		spawn: THREE.Vector3
	) {
		const { R, world } = ctx.physics;
		this.model = new BeeModel('player');
		ctx.scene.add(this.model.root);
		const desc = R.RigidBodyDesc.dynamic()
			.setTranslation(spawn.x, spawn.y, spawn.z)
			.lockRotations()
			.setGravityScale(0)
			.setLinearDamping(0)
			.setCcdEnabled(true)
			.setCanSleep(false);
		this.body = world.createRigidBody(desc);
		const cd = R.ColliderDesc.ball(BEE_RADIUS)
			.setMass(1)
			.setFriction(0.05)
			.setRestitution(0.2)
			.setCollisionGroups(GROUPS.player)
			.setSolverGroups(GROUPS.player)
			.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
		this.collider = world.createCollider(cd, this.body);
		ctx.physics.tag(this.collider, { kind: 'player' });
		this.position.copy(spawn);
		this.prevPosition.copy(spawn);
		this.renderPosition.copy(spawn);
	}

	get colliderHandle(): number {
		return this.collider.handle;
	}

	/** Adds velocity (bounces, escapes, knockbacks). */
	launch(x: number, y: number, z: number, controlLoss = 0.35): void {
		this.velocity.x += x;
		this.velocity.y = Math.max(this.velocity.y, 0) + y;
		this.velocity.z += z;
		this.launchTime = Math.max(this.launchTime, controlLoss);
		this.body.setLinvel({ x: this.velocity.x, y: this.velocity.y, z: this.velocity.z }, true);
	}

	stun(seconds: number): void {
		this.stunned = Math.max(this.stunned, seconds);
		this.model.setExpression('dizzy', seconds + 0.6);
	}

	teleport(p: THREE.Vector3): void {
		this.body.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
		this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
		this.position.copy(p);
		this.prevPosition.copy(p);
		this.renderPosition.copy(p);
		this.velocity.set(0, 0, 0);
	}

	fixedUpdate(dt: number): void {
		const ctx = this.ctx;
		const input = ctx.input;
		const env = ctx.env;
		const ab = ctx.abilities;
		const cam = ctx.cameraCtl;
		this.prevPosition.copy(this.position);
		if (this.impactCooldown > 0) this.impactCooldown -= dt;
		if (this.launchTime > 0) this.launchTime -= dt;

		const v = this.velocity;
		if (this.stunned > 0) {
			this.stunned -= dt;
			v.y -= 20 * dt;
			v.x *= Math.exp(-1.5 * dt);
			v.z *= Math.exp(-1.5 * dt);
		} else {
			const fx = -Math.sin(cam.yaw);
			const fz = -Math.cos(cam.yaw);
			const rx = Math.cos(cam.yaw);
			const rz = -Math.sin(cam.yaw);
			const f = input.axis('back', 'forward');
			const s = input.axis('left', 'right');
			let mx = fx * f + rx * s;
			let mz = fz * f + rz * s;
			const len = Math.hypot(mx, mz);
			if (len > 1) {
				mx /= len;
				mz /= len;
			}
			const hasMove = len > 0.01;
			this.boosting = ab.isBoosting(hasMove || input.isDown('up'));
			const up = input.isDown('up');
			const down = input.isDown('down');
			this.diving = down && input.isDown('boost') && ab.boost > 0.05;
			const carry = ab.heldMass();
			const speedMul = env.speedMul * (1 - Math.min(0.4, carry * 0.05));
			const maxSpeed = (this.boosting ? FLIGHT.boostSpeed : FLIGHT.speed) * speedMul;
			let ty = 0;
			if (up) ty += this.boosting ? FLIGHT.ascendBoost : FLIGHT.ascend;
			if (down) ty -= FLIGHT.descend;
			// "Fly where you look": a steep camera pitch adds climb/dive while moving forward.
			const look = -Math.sin(cam.pitch - 0.28);
			if (f > 0 && Math.abs(look) > 0.18) ty += (look - Math.sign(look) * 0.18) * maxSpeed * 1.3 * f;
			if (this.diving) ty = -FLIGHT.diveSpeed;
			ty *= speedMul;
			const control = this.controlScale * (this.launchTime > 0 ? 0.25 : 1);
			const rate = (hasMove ? (this.boosting ? FLIGHT.boostAccel : FLIGHT.accel) : FLIGHT.drift) * control;
			const k = dampFactor(rate, dt);
			v.x += (mx * maxSpeed - v.x) * k;
			v.z += (mz * maxSpeed - v.z) * k;
			const hover = up || down || Math.abs(ty) > 0.1 ? 0 : Math.sin(ctx.time * 2.2) * 0.35;
			v.y += (ty + hover - v.y) * dampFactor(FLIGHT.verticalAccel * control, dt);
		}
		v.addScaledVector(env.accel, dt);
		if (env.stuck) v.multiplyScalar(Math.exp(-12 * dt));
		const maxV = 70;
		if (v.lengthSq() > maxV * maxV) v.setLength(maxV);
		this.preStepVelocity.copy(v);
		this.body.setLinvel({ x: v.x, y: v.y, z: v.z }, true);
	}

	/** After the physics step: read back state and detect hard impacts. */
	postStep(dt: number): void {
		const ctx = this.ctx;
		const t = this.body.translation();
		const lv = this.body.linvel();
		this.position.set(t.x, t.y, t.z);
		this.velocity.set(lv.x, lv.y, lv.z);
		this.distanceFlown += this.position.distanceTo(this.prevPosition);
		if (this.distanceFlown > 200) ctx.achievements.unlock('first_flight');
		_d.copy(this.preStepVelocity).sub(this.velocity);
		const impact = _d.length();
		if (impact > 11 && this.impactCooldown <= 0) {
			this.impactCooldown = 0.25;
			this.onImpact(impact, _d);
		}
		// Safety: never fall through the terrain.
		const ground = ctx.world.terrain.heightAt(this.position.x, this.position.z);
		if (this.position.y < ground - 2) {
			this.position.y = ground + 1.5;
			this.body.setTranslation({ x: this.position.x, y: this.position.y, z: this.position.z }, true);
		}
		const hs = Math.hypot(this.velocity.x, this.velocity.z);
		this.speed01 = clamp(Math.max(hs, Math.abs(this.velocity.y) * 0.7) / FLIGHT.boostSpeed, 0, 1);
		void dt;
	}

	private onImpact(impact: number, delta: THREE.Vector3): void {
		const ctx = this.ctx;
		const pre = this.preStepVelocity;
		const groundPound = this.diving && pre.y < -22 && delta.y < -15;
		ctx.cameraCtl.shake(Math.min(0.9, impact / 35));
		this.model.bonk(Math.min(0.5, impact / 40));
		ctx.audio.play(impact > 25 ? 'thud' : 'bump', { volume: Math.min(1, impact / 25) });
		_v.copy(this.position).addScaledVector(pre.clone().normalize(), BEE_RADIUS);
		ctx.effects.emit('stars', _v, Math.round(Math.min(10, impact / 3)), 0.3);
		ctx.effects.emit('dust', _v, 4, 0.4);
		if (groundPound) {
			ctx.abilities.groundPound(this.position);
			return;
		}
		// Cartoon bounce-back off walls.
		_v.copy(delta).normalize().multiplyScalar(-Math.min(12, impact * 0.35));
		this.launch(_v.x, Math.max(0, _v.y) + 2, _v.z, 0.2);
		if (impact > 26 && !ctx.abilities.isDashing()) {
			this.stun(0.9);
			ctx.popups.show('BONK!', this.position.clone().setY(this.position.y + 1.2), 'bad', 1);
		} else this.model.setExpression('surprised', 0.6);
	}

	/** Per-frame visual update with interpolation alpha. */
	update(dt: number, alpha: number): void {
		const ctx = this.ctx;
		this.renderPosition.lerpVectors(this.prevPosition, this.position, alpha);
		const m = this.model;
		const v = this.velocity;
		const hs = Math.hypot(v.x, v.z);
		const cam = ctx.cameraCtl;
		const ab = ctx.abilities;
		const camYaw = Math.atan2(-Math.sin(cam.yaw), -Math.cos(cam.yaw));
		const aiming = ab.isAiming();
		const targetYaw = hs > 2 && !aiming ? Math.atan2(v.x, v.z) : camYaw;
		const prevYaw = this.yaw;
		this.yaw = dampAngle(this.yaw, targetYaw, aiming ? 14 : 7, dt);
		const yawRate = wrapAngle(this.yaw - prevYaw) / Math.max(dt, 1e-4);

		// Local-frame velocity / acceleration for tilt and antenna lag.
		const fwdX = Math.sin(this.yaw);
		const fwdZ = Math.cos(this.yaw);
		const forward = v.x * fwdX + v.z * fwdZ;
		const lateral = v.x * -fwdZ + v.z * fwdX;
		_v.copy(v).sub(this.lastVel).divideScalar(Math.max(dt, 1e-4));
		this.lastVel.copy(v);
		const aFwd = _v.x * fwdX + _v.z * fwdZ;
		const aLat = _v.x * -fwdZ + _v.z * fwdX;
		this.localAccel.x = damp(this.localAccel.x, aLat, 10, dt);
		this.localAccel.y = damp(this.localAccel.y, _v.y + aFwd * 0.3, 10, dt);

		const pitchT = clamp(forward * 0.022 - v.y * 0.03 + aFwd * 0.004, -0.75, 0.9) + (this.diving ? 0.9 : 0);
		// Bank into strafes and turns (+z roll lifts the bee's left side).
		const rollT = clamp(lateral * 0.03 - yawRate * 0.12, -0.8, 0.8);
		this.tiltX = damp(this.tiltX, pitchT, 6, dt);
		this.tiltZ = damp(this.tiltZ, rollT, 6, dt);
		if (this.stunned > 0) this.spin += dt * 14;
		else this.spin = damp(this.spin, Math.round(this.spin / (Math.PI * 2)) * Math.PI * 2, 6, dt);
		m.root.position.copy(this.renderPosition);
		m.root.position.y += Math.sin(ctx.time * 2.6) * 0.06;
		m.root.rotation.y = this.yaw;
		m.tilt.rotation.x = this.tiltX + this.spin;
		m.tilt.rotation.z = this.tiltZ + ab.rollAngle();

		const env = ctx.env;
		this.coatHoney = damp(this.coatHoney, env.honeyCoat > 0 || env.stuck === 'honey' ? 1 : 0, 3, dt);
		this.coatWet = damp(this.coatWet, env.wet > 0 ? 1 : 0, 3, dt);
		m.setCoat(this.coatHoney, this.coatWet);
		const flap = env.stuck ? 1 : clamp(0.35 + this.speed01 * 0.6 + (this.boosting ? 0.2 : 0), 0, 1);
		_accel.set(this.localAccel.x, this.localAccel.y);
		m.update(dt, ctx.time, flap, _accel, this.coatWet * 0.6);
	}

	dispose(): void {
		this.model.root.removeFromParent();
		this.model.dispose();
	}
}
