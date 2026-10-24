import * as THREE from 'three';
import type { GameContext } from './context';
import { clamp, damp, dampAngle, wrapAngle } from '../utils/math';

const _dir = new THREE.Vector3();
const _pivot = new THREE.Vector3();
const _right = new THREE.Vector3();
const _look = new THREE.Vector3();
const _v = new THREE.Vector3();
const _mouse = { x: 0, y: 0 };

/**
 * Over-the-shoulder third-person orbit camera with collision pull-in, smooth follow,
 * lock-on framing, FOV kicks, trauma-based shake and a cinematic mode for menus/cutscenes.
 */
export class CameraController {
	yaw = Math.PI;
	pitch = 0.22;
	sensitivity = 1;
	invertY = false;
	baseFov = 70;
	shakeEnabled = true;
	mode: 'follow' | 'menu' | 'cutscene' = 'menu';
	private distance = 4.8;
	private targetDistance = 4.8;
	private smoothDist = 4.8;
	private smoothPivot = new THREE.Vector3();
	private shoulder = 0.62;
	private trauma = 0;
	private fovKick = 0;
	private fov = 70;
	private shakeTime = 0;
	private cineTime = 0;
	private initialized = false;
	private cutFrom = new THREE.Vector3();
	private cutTo = new THREE.Vector3();
	private cutLook = new THREE.Vector3();
	private cutT = 0;
	private cutDur = 1;

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

	/** Elevation of the aim direction (up positive). */
	aimPitch(): number {
		return -this.pitch + 0.12;
	}

	snapBehind(yaw: number): void {
		this.yaw = yaw;
		this.pitch = 0.2;
		this.initialized = false;
	}

	/** Scripted camera move (boss intro): glide from `from` to `to`, looking at `look`. */
	cutscene(from: THREE.Vector3, to: THREE.Vector3, look: THREE.Vector3, duration: number): void {
		this.mode = 'cutscene';
		this.cutFrom.copy(from);
		this.cutTo.copy(to);
		this.cutLook.copy(look);
		this.cutT = 0;
		this.cutDur = duration;
	}

	endCutscene(): void {
		this.mode = 'follow';
		this.initialized = false;
	}

	update(dt: number): void {
		if (this.mode === 'menu') {
			this.updateMenu(dt);
			return;
		}
		if (this.mode === 'cutscene') {
			this.updateCutscene(dt);
			return;
		}
		const ctx = this.ctx;
		const cam = this.camera;
		const player = ctx.player;
		const input = ctx.input;
		input.consumeMouse(_mouse);
		const s = 0.0022 * this.sensitivity;
		const locked = ctx.targeting.locked;
		this.yaw -= _mouse.x * s * (locked ? 0.35 : 1);
		this.pitch += _mouse.y * s * (this.invertY ? -1 : 1);
		this.pitch = clamp(this.pitch, -0.85, 1.2);
		const wheel = input.consumeWheel();
		if (wheel) this.targetDistance = clamp(this.targetDistance + wheel * 0.6, 2.6, 9);

		// Lock-on: swing behind the player, facing the target.
		if (locked) {
			const t = locked.position;
			const want = Math.atan2(player.position.x - t.x, player.position.z - t.z);
			this.yaw = dampAngle(this.yaw, want, 5, dt);
			const dy = locked.aimPoint(_v).y - (player.position.y + 1.6);
			const horiz = Math.max(2, Math.hypot(t.x - player.position.x, t.z - player.position.z));
			const wantPitch = clamp(0.22 - Math.atan2(dy, horiz) * 0.6, -0.3, 0.7);
			this.pitch = damp(this.pitch, wantPitch, 3, dt);
		}

		const f = player.fsm;
		const charging = f.action === 'charging' || f.action === 'channeling';
		const zoomIn = charging ? 0.8 : f.action === 'shielding' ? 0.92 : 1;
		this.distance = damp(this.distance, this.targetDistance * zoomIn * (player.sprinting ? 1.12 : 1), 4, dt);

		// Pivot: above the player's shoulder, offset to the right.
		_right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
		_pivot.copy(player.renderPosition);
		_pivot.y += 1.55;
		if (!this.initialized) {
			this.smoothPivot.copy(_pivot);
			this.initialized = true;
		}
		this.smoothPivot.x = damp(this.smoothPivot.x, _pivot.x, 18, dt);
		this.smoothPivot.y = damp(this.smoothPivot.y, _pivot.y, 10, dt);
		this.smoothPivot.z = damp(this.smoothPivot.z, _pivot.z, 18, dt);
		// Shoulder offset, pulled in if a wall is to the right.
		const sideHit = ctx.physics.castStatic(this.smoothPivot, _right, this.shoulder + 0.3);
		const shoulder = sideHit >= 0 ? Math.max(0, sideHit - 0.3) : this.shoulder;
		_pivot.copy(this.smoothPivot).addScaledVector(_right, shoulder);

		const cp = Math.cos(this.pitch);
		_dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);
		let d = this.distance;
		const hit = ctx.physics.castStatic(_pivot, _dir, d + 0.4);
		if (hit >= 0) d = Math.max(0.6, hit - 0.35);
		this.smoothDist = d < this.smoothDist ? damp(this.smoothDist, d, 30, dt) : damp(this.smoothDist, d, 4, dt);
		cam.position.copy(_pivot).addScaledVector(_dir, this.smoothDist);
		const ground = ctx.world.terrain.heightAt(cam.position.x, cam.position.z) + 0.45;
		if (cam.position.y < ground) cam.position.y = ground;
		_look.copy(_pivot).addScaledVector(_dir, -10);
		cam.up.set(0, 1, 0);
		cam.lookAt(_look);
		this.applyShake(dt);

		const target = this.baseFov + (player.sprinting ? 6 : 0) + (f.move === 'dash' ? 8 : 0) + this.fovKick - (charging ? 4 : 0);
		this.fovKick = damp(this.fovKick, 0, 5, dt);
		this.fov = damp(this.fov, target, 6, dt);
		if (Math.abs(cam.fov - this.fov) > 0.01) {
			cam.fov = this.fov;
			cam.updateProjectionMatrix();
		}
	}

	private applyShake(dt: number): void {
		this.trauma = Math.max(0, this.trauma - dt * 1.8);
		if (!this.shakeEnabled || this.trauma <= 0) return;
		this.shakeTime += dt;
		const t = this.shakeTime * 30;
		const k = this.trauma * this.trauma;
		this.camera.rotateX(Math.sin(t * 1.1) * 0.03 * k);
		this.camera.rotateY(Math.sin(t * 0.9 + 1.3) * 0.03 * k);
		this.camera.rotateZ(Math.sin(t * 1.3 + 2.1) * 0.045 * k);
	}

	private updateMenu(dt: number): void {
		const ctx = this.ctx;
		this.cineTime += dt;
		const t = this.cineTime;
		const p = ctx.player.renderPosition;
		// Slow arc in front of the Arcanist, looking past them toward the vale.
		const a = Math.PI + Math.sin(t * 0.08) * 0.6 + 0.5;
		const r = 6.5 + Math.sin(t * 0.13) * 0.8;
		this.camera.position.set(p.x + Math.sin(a) * r, p.y + 2.2 + Math.sin(t * 0.21) * 0.4, p.z + Math.cos(a) * r);
		const ground = ctx.world.terrain.heightAt(this.camera.position.x, this.camera.position.z) + 0.8;
		if (this.camera.position.y < ground) this.camera.position.y = ground;
		this.camera.up.set(0, 1, 0);
		this.camera.lookAt(p.x - 1.5, p.y + 1.7, p.z - 1);
		this.yaw = Math.atan2(this.camera.position.x - p.x, this.camera.position.z - p.z);
		this.setFov(this.baseFov - 8);
	}

	private updateCutscene(dt: number): void {
		this.cutT = Math.min(1, this.cutT + dt / this.cutDur);
		const k = this.cutT * this.cutT * (3 - 2 * this.cutT);
		this.camera.position.lerpVectors(this.cutFrom, this.cutTo, k);
		this.camera.up.set(0, 1, 0);
		this.camera.lookAt(this.cutLook);
		this.applyShake(dt);
		this.setFov(this.baseFov - 6);
		this.yaw = wrapAngle(Math.atan2(this.camera.position.x - this.cutLook.x, this.camera.position.z - this.cutLook.z));
	}

	private setFov(f: number): void {
		this.fov = f;
		if (Math.abs(this.camera.fov - f) > 0.01) {
			this.camera.fov = f;
			this.camera.updateProjectionMatrix();
		}
	}
}
