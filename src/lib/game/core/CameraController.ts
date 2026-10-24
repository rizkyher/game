import * as THREE from 'three';
import type { GameContext } from './context';
import { clamp, damp, wrapAngle } from '../utils/math';

const _dir = new THREE.Vector3();
const _target = new THREE.Vector3();
const _look = new THREE.Vector3();
const _mouse = { x: 0, y: 0 };

/** Smooth third-person orbit camera with collision avoidance, speed FOV, shake and turn tilt. */
export class CameraController {
	yaw = 0;
	pitch = 0.32;
	sensitivity = 1;
	invertY = false;
	baseFov = 72;
	shakeEnabled = true;
	mode: 'follow' | 'cinematic' = 'cinematic';
	private distance = 7.5;
	private targetDistance = 7.5;
	private smoothDist = 7.5;
	private smoothTarget = new THREE.Vector3();
	private trauma = 0;
	private fovKick = 0;
	private fov = 72;
	private roll = 0;
	private lastYaw = 0;
	private shakeTime = 0;
	private cineTime = 0;
	private initialized = false;

	constructor(
		private ctx: GameContext,
		readonly camera: THREE.PerspectiveCamera
	) {}

	shake(amount: number): void {
		this.trauma = Math.min(1, this.trauma + amount);
	}

	kick(fov: number): void {
		this.fovKick = Math.max(this.fovKick, fov);
	}

	/** Snap behind the bee (used when gameplay starts). */
	snapBehind(yaw: number): void {
		this.yaw = yaw;
		this.pitch = 0.3;
		this.initialized = false;
	}

	update(dt: number): void {
		const ctx = this.ctx;
		const cam = this.camera;
		const player = ctx.player;
		const input = ctx.input;
		if (this.mode === 'cinematic') {
			this.updateCinematic(dt);
			return;
		}
		input.consumeMouse(_mouse);
		const s = 0.0022 * this.sensitivity;
		this.yaw -= _mouse.x * s;
		this.pitch += _mouse.y * s * (this.invertY ? -1 : 1);
		this.pitch = clamp(this.pitch, -0.95, 1.25);
		const wheel = input.consumeWheel();
		if (wheel) this.targetDistance = clamp(this.targetDistance + wheel * 0.9, 3.5, 18);

		const speed01 = player.speed01;
		this.distance = damp(this.distance, this.targetDistance * (1 + speed01 * 0.22), 3, dt);
		_target.copy(player.renderPosition);
		_target.y += 0.9;
		if (!this.initialized) {
			this.smoothTarget.copy(_target);
			this.initialized = true;
		}
		// Slight positional lag keeps motion readable without feeling floaty.
		this.smoothTarget.x = damp(this.smoothTarget.x, _target.x, 16, dt);
		this.smoothTarget.y = damp(this.smoothTarget.y, _target.y, 12, dt);
		this.smoothTarget.z = damp(this.smoothTarget.z, _target.z, 16, dt);

		const cp = Math.cos(this.pitch);
		_dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
		let d = this.distance;
		const hit = ctx.physics.castStatic(this.smoothTarget, _dir, d + 0.6);
		if (hit >= 0) d = Math.max(1.1, hit - 0.55);
		// Pull in fast, ease back out slowly.
		this.smoothDist = d < this.smoothDist ? damp(this.smoothDist, d, 30, dt) : damp(this.smoothDist, d, 3.5, dt);
		cam.position.copy(this.smoothTarget).addScaledVector(_dir, this.smoothDist);
		const ground = ctx.world.terrain.heightAt(cam.position.x, cam.position.z) + 0.7;
		if (cam.position.y < ground) cam.position.y = ground;

		_look.copy(this.smoothTarget).addScaledVector(player.velocity, 0.04);
		cam.up.set(0, 1, 0);
		cam.lookAt(_look);

		// Tilt into fast turns.
		const yawRate = wrapAngle(this.yaw - this.lastYaw) / Math.max(dt, 1e-4);
		this.lastYaw = this.yaw;
		this.roll = damp(this.roll, clamp(-yawRate * 0.012, -0.07, 0.07), 5, dt);
		cam.rotateZ(this.roll);

		this.applyShake(dt);
		const target = this.baseFov + (player.boosting ? 9 : 0) + speed01 * 6 + this.fovKick + (player.diving ? 8 : 0);
		this.fovKick = damp(this.fovKick, 0, 4, dt);
		this.fov = damp(this.fov, target, 5, dt);
		if (Math.abs(cam.fov - this.fov) > 0.01) {
			cam.fov = this.fov;
			cam.updateProjectionMatrix();
		}
	}

	private applyShake(dt: number): void {
		this.trauma = Math.max(0, this.trauma - dt * 1.7);
		if (!this.shakeEnabled || this.trauma <= 0) return;
		this.shakeTime += dt;
		const t = this.shakeTime * 28;
		const k = this.trauma * this.trauma;
		this.camera.rotateX(Math.sin(t * 1.1) * 0.035 * k);
		this.camera.rotateY(Math.sin(t * 0.9 + 1.3) * 0.035 * k);
		this.camera.rotateZ(Math.sin(t * 1.3 + 2.1) * 0.05 * k);
	}

	private updateCinematic(dt: number): void {
		const ctx = this.ctx;
		this.cineTime += dt;
		const t = this.cineTime;
		const p = ctx.player.renderPosition;
		const a = t * 0.07 + 2.2;
		const r = 17 + Math.sin(t * 0.13) * 3;
		this.camera.position.set(p.x + Math.cos(a) * r, p.y + 4.5 + Math.sin(t * 0.21) * 1.6, p.z + Math.sin(a) * r);
		const ground = ctx.world.terrain.heightAt(this.camera.position.x, this.camera.position.z) + 1.5;
		if (this.camera.position.y < ground) this.camera.position.y = ground;
		this.camera.up.set(0, 1, 0);
		this.camera.lookAt(p.x, p.y + 1.6, p.z);
		this.yaw = Math.atan2(this.camera.position.x - p.x, this.camera.position.z - p.z);
		if (Math.abs(this.camera.fov - this.baseFov) > 0.01) {
			this.camera.fov = this.baseFov;
			this.camera.updateProjectionMatrix();
		}
		this.fov = this.baseFov;
	}
}
