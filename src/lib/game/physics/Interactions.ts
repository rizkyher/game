import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Prop } from '../entities/Props';
import type { PropSound } from '../entities/PropDefs';
import type { Sfx } from '../systems/AudioManager';

const SOUND: Record<PropSound, { sfx: Sfx; pitch: number }> = {
	wood: { sfx: 'knock', pitch: 1 },
	glass: { sfx: 'clink', pitch: 1 },
	ceramic: { sfx: 'clink', pitch: 0.7 },
	soft: { sfx: 'bump', pitch: 1.3 },
	metal: { sfx: 'clink', pitch: 0.45 },
	plant: { sfx: 'bump', pitch: 1.5 },
	rubber: { sfx: 'boing', pitch: 1.4 },
	paper: { sfx: 'knock', pitch: 1.6 }
};

const _dir = new THREE.Vector3();
const _rel = new THREE.Vector3();

/**
 * Turns raw Rapier events into game events: exaggerated bee impacts on props, prop-to-prop
 * chain reactions, breakables and bouncy surfaces.
 */
export class Interactions {
	private pendingPlayerHits: Prop[] = [];
	private bounced = false;

	constructor(private ctx: GameContext) {}

	/** Drain Rapier's event queue after a physics step. */
	process(): void {
		const ctx = this.ctx;
		const physics = ctx.physics;
		const playerHandle = ctx.player.colliderHandle;
		this.pendingPlayerHits.length = 0;
		this.bounced = false;
		physics.events.drainCollisionEvents((h1, h2, started) => {
			if (!started) return;
			let other = -1;
			if (h1 === playerHandle) other = h2;
			else if (h2 === playerHandle) other = h1;
			if (other < 0) return;
			const tag = physics.getTag(other);
			if (!tag) return;
			if (tag.kind === 'prop') {
				const p = tag.ref as Prop;
				if (!this.pendingPlayerHits.includes(p)) this.pendingPlayerHits.push(p);
			} else if (tag.kind === 'bouncy') {
				this.bounced = true;
			}
		});
		physics.events.drainContactForceEvents((e) => {
			const a = physics.getTag(e.collider1());
			const b = physics.getTag(e.collider2());
			if (!a || !b) return;
			const force = e.totalForceMagnitude();
			if (a.kind === 'prop' && b.kind === 'prop') this.propImpact(a.ref as Prop, b.ref as Prop, force);
			else if (a.kind === 'prop' && b.kind !== 'player') this.propWorldImpact(a.ref as Prop, force);
			else if (b.kind === 'prop' && a.kind !== 'player') this.propWorldImpact(b.ref as Prop, force);
		});
		for (const p of this.pendingPlayerHits) this.playerHitProp(p);
		if (this.bounced) ctx.abilities.mushroomBounce();
	}

	/** Exaggerated, Goat-Simulator-style response to the bee crashing into a prop. */
	playerHitProp(p: Prop, forcedPower?: number): void {
		const ctx = this.ctx;
		if (p.broken || p.held || !p.body) return;
		const player = ctx.player;
		const v = player.preStepVelocity;
		_rel.copy(v).sub(p.linvel);
		const speed = _rel.length();
		const power = forcedPower ?? ctx.abilities.impactPower();
		const effective = speed * power;
		p.lastTouch = ctx.time;
		p.chain = 0;
		p.chainRoot = p;
		ctx.props.wake(p);
		if (effective < 2.5) return;
		_dir.copy(p.pos).sub(player.position);
		if (_dir.lengthSq() < 0.0001) _dir.copy(v);
		_dir.normalize();
		// Blend contact normal with travel direction so hits go where you were flying.
		if (v.lengthSq() > 1) _dir.lerp(_rel.normalize(), 0.6).normalize();
		// Exaggerated but bounded: light props get at most ~22 m/s of launch speed.
		const mag = Math.min(28, effective * 0.8) * Math.min(p.def.mass, 5) * 0.8;
		ctx.props.impulse(p, _dir.x * mag, _dir.y * mag + mag * 0.45, _dir.z * mag, mag * 0.6);
		const snd = SOUND[p.def.sound];
		ctx.audio.play(snd.sfx, { pitch: snd.pitch * (0.9 + Math.random() * 0.2), volume: Math.min(1, effective / 18) });
		ctx.cameraCtl.shake(Math.min(0.5, effective / 50));
		player.model.bonk(Math.min(0.4, effective / 40));
		if (effective > 6) ctx.effects.emit(p.def.sound === 'plant' ? 'pollen' : 'dust', p.pos, 6, 0.6);

		const spec = p.def.breakable;
		if (spec && effective > spec.speed) {
			ctx.props.breakProp(p);
			return;
		}
		if (p.kind === 'duck') {
			ctx.audio.play('squeak');
			ctx.chaos.add('squeak', p.pos);
		} else if (p.def.mass >= 4 && effective > 10) ctx.chaos.add('shove', p.pos);
		else if (effective > 9 && !p.def.tipTrick) ctx.chaos.add('bonk', p.pos, Math.min(2, effective / 15));
	}

	private propImpact(a: Prop, b: Prop, force: number): void {
		const ctx = this.ctx;
		const t = ctx.time;
		const aHot = t - a.lastTouch < 6;
		const bHot = t - b.lastTouch < 6;
		this.breakCheck(a, force);
		this.breakCheck(b, force);
		if (aHot === bHot) {
			if (force > 400) this.impactSound(a, force);
			return;
		}
		// Propagate the chain from the "hot" prop to the newly hit one.
		const src = aHot ? a : b;
		const dst = aHot ? b : a;
		dst.lastTouch = t;
		dst.chain = src.chain + 1;
		dst.chainRoot = src.chainRoot ?? src;
		this.impactSound(dst, force);
		if (dst.pinned) ctx.props.unpin(dst);
		const n = dst.chain;
		const domino = dst.kind === 'domino' && src.kind === 'domino';
		if (n >= 1) {
			ctx.chaos.add(domino ? 'domino' : 'chain', dst.pos, 0.6 + n * 0.25);
			if (n >= 6) ctx.achievements.unlock('domino_master');
		}
	}

	private propWorldImpact(p: Prop, force: number): void {
		this.breakCheck(p, force);
		if (force > p.def.mass * 500) this.impactSound(p, force);
	}

	private breakCheck(p: Prop, force: number): void {
		const spec = p.def.breakable;
		if (!spec || p.broken || p.held) return;
		// Only break from impacts the player is (indirectly) responsible for.
		if (this.ctx.time - p.lastTouch > 8) return;
		if (force > spec.force) this.ctx.props.breakProp(p);
	}

	private impactSound(p: Prop, force: number): void {
		const snd = SOUND[p.def.sound];
		this.ctx.audio.play(snd.sfx, { pitch: snd.pitch * (0.85 + Math.random() * 0.3), volume: Math.min(0.8, force / (p.def.mass * 2500)) });
	}
}
