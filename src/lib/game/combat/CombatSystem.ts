import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Combatant, HitInfo, HitResult, Hurtbox, Team } from './types';
import { ELEMENT_COLORS, HitTag } from './types';
import { rollDamage } from './DamageSystem';
import { ReactionSystem, type TriggeredReaction } from '../magic/ElementalReactions';
import { pointSegDist2, segSegDist2 } from '../utils/collide';

export interface CombatantSource {
	forEachCombatant(fn: (c: Combatant) => void): void;
}

export interface SegmentHit {
	target: Combatant | null;
	hurtbox: Hurtbox | null;
	/** 0..1 along the swept segment. */
	s: number;
	point: THREE.Vector3;
}

/** Player-side hooks for blocking and parrying incoming attacks. */
export interface Interceptor {
	intercept(hit: HitInfo): 'parried' | 'blocked' | null;
}

/** Targets with damage-soaking shields (player ward, mage barriers). Returns damage absorbed. */
export interface Absorber {
	absorb(damage: number, hit: HitInfo): number;
}

const _st = { s: 0, t: 0 };
const _p = new THREE.Vector3();
const _hit: HitInfo = {
	source: 'player',
	attacker: null,
	element: 'physical',
	damage: 0,
	point: new THREE.Vector3(),
	dir: new THREE.Vector3(),
	knockback: 0,
	poise: 0,
	heavy: false,
	critChance: 0,
	critMult: 1.5,
	tags: 0
};

/**
 * Central hit resolution: blocking/parrying, elemental reactions, damage rolls, statuses,
 * knockback hand-off, splash effects and all combat feedback (numbers, sparks, sound,
 * hit-stop). Also provides swept/sphere queries against every combatant's hurtboxes.
 */
export class CombatSystem {
	readonly sources: CombatantSource[] = [];
	readonly reactions = new ReactionSystem();
	private triggered: TriggeredReaction[] = [];
	private splashQueue: { center: THREE.Vector3; radius: number; hit: HitInfo; exclude: number; onlyIf?: string }[] = [];
	/** Stats for the victory screen. */
	stats = { damageDealt: 0, reactions: 0, parries: 0, crits: 0, kills: 0 };

	constructor(private ctx: GameContext) {
		this.reactions.shatterMod = () => ctx.progression.mods().shatterDamage;
	}

	forEachTarget(attacker: Team | 'environment', fn: (c: Combatant) => void): void {
		if (attacker !== 'player') {
			const p = this.ctx.player;
			if (p.alive) fn(p);
		}
		if (attacker !== 'enemy') {
			for (const s of this.sources)
				s.forEachCombatant((c) => {
					if (c.alive) fn(c);
				});
		}
	}

	/** First hurtbox touched by a sphere of `radius` swept from a to b. */
	sweep(a: THREE.Vector3, b: THREE.Vector3, radius: number, attacker: Team | 'environment', exclude: Set<number> | null, out: SegmentHit): boolean {
		out.target = null;
		out.hurtbox = null;
		out.s = Infinity;
		this.forEachTarget(attacker, (c) => {
			if (exclude?.has(c.uid)) return;
			for (const hb of c.hurtboxes) {
				const r = radius + hb.r;
				const d2 = segSegDist2(a, b, hb.a, hb.b, _st);
				if (d2 > r * r) continue;
				// Prefer weak points when several boxes are hit at about the same place.
				const s = _st.s - (hb.weak > 1 ? 0.02 : 0);
				if (s < out.s) {
					out.s = s;
					out.target = c;
					out.hurtbox = hb;
				}
			}
		});
		if (!out.target) return false;
		out.s = Math.max(0, out.s);
		out.point.lerpVectors(a, b, out.s);
		return true;
	}

	/** Calls fn for every target whose hurtboxes overlap the sphere (once per target). */
	overlap(center: THREE.Vector3, radius: number, attacker: Team | 'environment', fn: (c: Combatant, dist: number, weak: number) => void): void {
		this.forEachTarget(attacker, (c) => {
			let best = Infinity;
			let weak = 1;
			for (const hb of c.hurtboxes) {
				const d = Math.sqrt(pointSegDist2(center, hb.a, hb.b)) - hb.r;
				if (d < best) {
					best = d;
					weak = hb.weak;
				}
			}
			if (best <= radius) fn(c, Math.max(0, best), weak);
		});
	}

	/** Nearest living target to a point within range (any hurtbox distance). */
	nearest(center: THREE.Vector3, range: number, attacker: Team, exclude?: Set<number>): Combatant | null {
		let best: Combatant | null = null;
		let bd = range;
		this.overlap(center, range, attacker, (c, d) => {
			if (exclude?.has(c.uid)) return;
			if (d < bd) {
				bd = d;
				best = c;
			}
		});
		return best;
	}

	/** Resolves a hit against a target. Returns null when the hit was ignored. */
	applyHit(target: Combatant, hit: HitInfo): HitResult | null {
		const ctx = this.ctx;
		if (!target.alive) return null;
		const result: HitResult = { damage: 0, crit: false, killed: false, weak: false, blocked: false, parried: false, immune: false, reactions: [] };
		if (target.invulnerable() && !(hit.tags & HitTag.DOT)) {
			result.immune = true;
			// Only real dodges say so; post-hit mercy frames are silent.
			const move = (target as unknown as { fsm?: { move: string } }).fsm?.move;
			if (target.team === 'player' && (move === 'dodge' || move === 'dash')) ctx.numbers.spawn(_p.copy(target.position).setY(target.position.y + 2), 'Evaded', 'info');
			return null;
		}
		// Shield / parry on the player.
		const interceptor = target as unknown as Partial<Interceptor>;
		if (interceptor.intercept && !(hit.tags & HitTag.DOT)) {
			const r = interceptor.intercept(hit);
			if (r === 'parried') {
				result.parried = true;
				this.stats.parries++;
				target.onHit(hit, result);
				return result;
			}
			if (r === 'blocked') result.blocked = true;
		}
		// Elemental reactions modify the hit before the roll.
		const isPlayer = target.team === 'player';
		if (!isPlayer) this.reactions.evaluate(hit, target, ctx.time, this.triggered);
		else this.triggered.length = 0;
		const mods = ctx.progression.mods();
		const frozen = target.statuses.has('frozen');
		const roll = rollDamage(hit, target, {
			resist: isPlayer ? ctx.progression.stats().resist : 0,
			critBonus: frozen && !isPlayer ? mods.frozenCritDamage : 0
		});
		if (result.blocked) roll.damage = Math.max(0, Math.round(roll.damage * 0.12));
		result.damage = roll.damage;
		result.crit = roll.crit && !result.blocked;
		result.weak = roll.weak;
		const absorbed = (target as unknown as Partial<Absorber>).absorb?.(result.damage, hit) ?? 0;
		target.hp = Math.max(0, target.hp - (result.damage - absorbed));
		result.killed = target.hp <= 0;
		for (const t of this.triggered) result.reactions.push(t.def.id);

		// Statuses: reactions consume first, then the hit and reaction statuses apply.
		if (!result.killed && !result.blocked) {
			for (const t of this.triggered) for (const s of t.def.consume ?? []) target.statuses.remove(s);
			const power = hit.power ?? 1;
			const chill = hit.source === 'player' ? mods.chillDuration : 1;
			for (const s of hit.status ?? []) {
				const dur = s.id === 'chilled' ? s.duration * chill : s.duration;
				target.statuses.apply({ ...s, duration: dur }, s.id === 'burning' && hit.source === 'player' ? power * mods.burnDamage : power);
			}
			for (const t of this.triggered) for (const s of t.def.apply ?? []) target.statuses.apply(s, power);
		}
		if (result.killed) target.alive = false;
		target.onHit(hit, result);

		// --------------------------------------------- feedback
		const top = _p.copy(hit.point);
		if (!isPlayer) {
			this.stats.damageDealt += result.damage;
			if (result.crit) this.stats.crits++;
			if (!(hit.tags & HitTag.DOT)) {
				ctx.numbers.spawn(top, result.crit ? `${result.damage}!` : String(result.damage), result.weak ? 'weak' : result.crit ? 'crit' : 'normal');
				ctx.vfx.hitSpark(hit.point, ELEMENT_COLORS[hit.element], result.crit);
				ctx.audio.sfx(result.crit ? 'crit' : 'enemy_hit', hit.point, { volume: result.crit ? 0.9 : 0.6 });
			} else ctx.numbers.spawn(top, String(result.damage), 'status');
			if (hit.heavy || result.crit) ctx.feel.hitStop(hit.heavy ? 0.06 : 0.035);
			if (hit.heavy) ctx.feel.shake(0.18);
			if (hit.source === 'player') ctx.targeting.noteHit(target);
		} else if (!(hit.tags & HitTag.DOT) || result.damage > 0) {
			ctx.numbers.spawn(top.copy(target.position).setY(target.position.y + 2.1), result.blocked ? `Blocked ${result.damage}` : String(result.damage), result.blocked ? 'block' : 'player');
		}
		for (const t of this.triggered) {
			this.stats.reactions++;
			_p.copy(target.position).setY(target.position.y + target.height * 0.6);
			ctx.vfx.reaction(t.def.vfx, _p, t.def.splash?.radius ?? 2.5);
			ctx.numbers.spawn(_p.clone().setY(_p.y + target.height * 0.6 + 0.6), t.def.name.toUpperCase(), 'reaction');
			ctx.audio.sfx(t.def.sfx, _p, { volume: 1 });
			ctx.events.emit('reaction', { id: t.def.id, name: t.def.name, target, pos: _p.clone() });
			ctx.feel.hitStop(0.07);
			ctx.feel.shake(0.22);
			if (t.def.splash) {
				const sp = t.def.splash;
				const h: HitInfo = {
					..._hit,
					source: hit.source,
					attacker: hit.attacker,
					element: sp.element,
					damage: result.damage * sp.damageMult,
					point: _p.clone(),
					dir: new THREE.Vector3(),
					knockback: 4,
					poise: 15,
					heavy: false,
					critChance: 0,
					critMult: 1.5,
					status: sp.status,
					tags: HitTag.AOE | HitTag.REACTION,
					depth: (hit.depth ?? 0) + 1,
					power: hit.power
				};
				this.splashQueue.push({ center: _p.clone(), radius: sp.radius, hit: h, exclude: target.uid, onlyIf: sp.onlyIf });
			}
		}
		ctx.events.emit('hit', { target, hit, result });
		if (result.killed) {
			if (!isPlayer) this.stats.kills++;
			ctx.events.emit('kill', { target, hit });
		}
		return result;
	}

	/** Processes queued reaction splashes (kept out of applyHit to avoid re-entrancy). */
	update(): void {
		if (!this.splashQueue.length) return;
		const q = this.splashQueue.splice(0, this.splashQueue.length);
		for (const s of q) {
			this.overlap(s.center, s.radius, s.hit.source === 'environment' ? 'player' : s.hit.source, (c) => {
				if (c.uid === s.exclude) return;
				if (s.onlyIf && !c.statuses.has(s.onlyIf as never)) return;
				const h = { ...s.hit, point: c.aimPoint(new THREE.Vector3()), dir: new THREE.Vector3().subVectors(c.position, s.center) };
				this.applyHit(c, h);
				if (s.hit.element === 'lightning') this.ctx.vfx.bolt(s.center, h.point, ELEMENT_COLORS.lightning, 0.3, 0.2);
			});
		}
	}

	/** Builds a hit template from the player's stats. */
	playerHit(partial: Partial<HitInfo> & Pick<HitInfo, 'element' | 'damage' | 'point' | 'dir'>): HitInfo {
		const st = this.ctx.progression.stats();
		const mods = this.ctx.progression.mods();
		const power = st.power / 10;
		let crit = st.crit + (partial.element === 'fire' ? mods.fireCrit : 0);
		const el = partial.element;
		const elemMult = el === 'fire' || el === 'ice' || el === 'lightning' || el === 'wind' ? mods.elementDamage[el] : 1;
		if (this.ctx.player.statuses.has('counter')) crit = 1;
		return {
			source: 'player',
			attacker: this.ctx.player,
			knockback: 0,
			poise: 0,
			heavy: false,
			critMult: st.critMult,
			tags: 0,
			...partial,
			damage: partial.damage * power * elemMult,
			critChance: partial.critChance ?? crit,
			power
		};
	}

	reset(): void {
		this.splashQueue.length = 0;
		this.reactions.reset();
	}
}
