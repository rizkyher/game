import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Combatant } from './types';
import { segSegDist2 } from '../utils/collide';

const _dir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _to = new THREE.Vector3();
const _p = new THREE.Vector3();
const _st = { s: 0, t: 0 };

/**
 * Lock-on, crosshair aiming and the "current target" shown on the HUD. Aim resolves the
 * camera ray against terrain, architecture and enemy hurtboxes; light aim assist nudges
 * shots toward an enemy just off the crosshair.
 */
export class TargetingSystem {
	locked: Combatant | null = null;
	/** Most recently damaged or locked enemy (HUD target frame). */
	focus: Combatant | null = null;
	private focusTimer = 0;
	private losLost = 0;
	/** World point the crosshair is resting on. */
	readonly aimPoint = new THREE.Vector3();
	/** Enemy under (or near) the crosshair, if any. */
	aimTarget: Combatant | null = null;

	constructor(private ctx: GameContext) {}

	toggleLock(): void {
		if (this.locked) {
			this.locked = null;
			this.ctx.audio.sfx('ui_soft');
			return;
		}
		const best = this.pickLockTarget();
		if (best) {
			this.locked = best;
			this.focus = best;
			this.focusTimer = 6;
			this.ctx.audio.sfx('lock');
		}
	}

	/** Best enemy for lock-on: close to screen centre, near, visible. */
	private pickLockTarget(): Combatant | null {
		const cam = this.ctx.camera;
		cam.getWorldDirection(_dir);
		let best: Combatant | null = null;
		let bestScore = Infinity;
		this.ctx.combat.forEachTarget('player', (c) => {
			c.aimPoint(_p);
			_to.subVectors(_p, cam.position);
			const dist = _to.length();
			if (dist > 42) return;
			const ang = _to.normalize().angleTo(_dir);
			if (ang > 0.75) return;
			if (!this.ctx.physics.lineOfSight(cam.position, _p)) return;
			const score = ang * 30 + dist * 0.4;
			if (score < bestScore) {
				bestScore = score;
				best = c;
			}
		});
		return best;
	}

	noteHit(c: Combatant): void {
		this.focus = c;
		this.focusTimer = 5;
	}

	update(dt: number): void {
		const ctx = this.ctx;
		const player = ctx.player;
		if (this.locked) {
			const l = this.locked;
			const d = l.position.distanceTo(player.position);
			if (!l.alive || d > 48) this.locked = null;
			else {
				l.aimPoint(_p);
				if (!ctx.physics.lineOfSight(ctx.camera.position, _p)) {
					this.losLost += dt;
					if (this.losLost > 2.5) this.locked = null;
				} else this.losLost = 0;
			}
		}
		if (this.locked) {
			this.focus = this.locked;
			this.focusTimer = 2;
		}
		this.focusTimer -= dt;
		if (this.focus && (!this.focus.alive || this.focusTimer <= 0)) this.focus = null;
		this.resolveAim();
	}

	/** Ray from the camera through the crosshair. */
	private resolveAim(): void {
		const ctx = this.ctx;
		const cam = ctx.camera;
		if (this.locked) {
			this.locked.aimPoint(this.aimPoint);
			this.aimTarget = this.locked;
			return;
		}
		cam.getWorldDirection(_dir);
		const maxD = 90;
		let d = ctx.physics.castStatic(cam.position, _dir, maxD, true);
		if (d < 0) d = maxD;
		_end.copy(cam.position).addScaledVector(_dir, d);
		// Nearest enemy hurtbox along the ray (with a generous assist radius).
		let bestS = Infinity;
		let best: Combatant | null = null;
		const assist = ctx.settings.aimAssist ? 0.9 : 0.05;
		ctx.combat.forEachTarget('player', (c) => {
			for (const hb of c.hurtboxes) {
				const d2 = segSegDist2(cam.position, _end, hb.a, hb.b, _st);
				const dist = _st.s * d;
				// Assist radius grows a little with distance so far targets are reachable.
				const r = hb.r + assist * Math.min(2.5, 0.3 + dist * 0.04);
				if (d2 < r * r && _st.s < bestS) {
					bestS = _st.s;
					best = c;
				}
			}
		});
		this.aimTarget = best;
		if (best) {
			(best as Combatant).aimPoint(this.aimPoint);
			// Do not snap to enemies behind the player when the camera is pulled back.
			_to.subVectors(this.aimPoint, ctx.player.position);
			if (_to.dot(_dir) < 0) {
				this.aimTarget = null;
				this.aimPoint.copy(_end);
			}
		} else this.aimPoint.copy(_end);
		// Never aim at a point between the camera and the player (would shoot backwards).
		_to.subVectors(this.aimPoint, ctx.player.position);
		if (_to.dot(_dir) < 1.5) this.aimPoint.copy(ctx.player.position).addScaledVector(_dir, 40).setY(ctx.player.position.y + 1.4 + _dir.y * 40);
	}

	clear(): void {
		this.locked = null;
		this.focus = null;
		this.aimTarget = null;
	}
}
