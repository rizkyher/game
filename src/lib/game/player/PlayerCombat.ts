import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { HitInfo, PlayerElement } from '../combat/types';
import { ELEMENT_COLORS, HitTag } from '../combat/types';
import { COMBO, ELEMENT_SPELLS, SPELLS, type SpellDef, type SpellId } from '../magic/SpellRegistry';
import type { CharacterAnimInput } from './PlayerModel';
import { clamp } from '../utils/math';

const _o = new THREE.Vector3();
const _a = new THREE.Vector3();

interface PendingCast {
	spell: SpellDef;
	hand: 'L' | 'R' | 'both';
	finisher: boolean;
	dashCast: boolean;
	charge: number;
	fired: boolean;
}

export const SHIELD = { drain: 7, perfectWindow: 0.16, costMult: 0.9, costFlat: 6 };
export const PARRY = { start: 0.02, end: 0.26, duration: 0.42, failCooldown: 0.55, counter: 1.6 };

/**
 * Turns player input into actions on the state machine: casting (with combos, dash-casting
 * and charged specials), channelling, shielding, perfect parries, the ultimate, potions and
 * element swapping. Presses are buffered for a short window so fixed-step logic never drops
 * them and attacks feel responsive.
 */
export class PlayerCombat {
	element: PlayerElement = 'fire';
	readonly cooldowns: Partial<Record<SpellId, number>> = {};
	aether = 0;
	combo = 0;
	private comboTimer = 0;
	private buf = { jump: 0, dodge: 0, basic: 0, parry: 0, ultimate: 0 };
	private held = { basic: false, charge: false, shield: false, channel: false };
	private chargeReleased = false;
	private chargeTime = 0;
	private chargeCircle = -1;
	private pending: PendingCast | null = null;
	private shieldRaisedAt = -10;
	private parryCooldown = 0;
	private potionCooldown = 0;
	private lowManaTimer = 0;
	private notReadyTimer = 0;
	private lastWindBlade = -10;
	private castOrigin = new THREE.Vector3();

	constructor(private ctx: GameContext) {
		ctx.events.on('hit', ({ hit, result }) => {
			if (hit.source !== 'player' || result.damage <= 0) return;
			this.gainAether(Math.min(6, result.damage * 0.12));
		});
		ctx.events.on('reaction', () => this.gainAether(7));
		ctx.events.on('kill', ({ target, hit }) => {
			if (target.team !== 'enemy') return;
			this.gainAether(4);
			const mods = ctx.progression.mods();
			if (hit.element === 'fire' && mods.fireKillMana > 0) ctx.player.restoreMana(mods.fireKillMana);
		});
	}

	gainAether(n: number): void {
		const before = this.aether;
		this.aether = Math.min(100, this.aether + n);
		if (before < 100 && this.aether >= 100) {
			this.ctx.ui.notify('Aetherfall ready', 'Press G to unleash your ultimate', 'info');
			this.ctx.audio.sfx('ultimate_ready');
		}
	}

	get spellIds(): { basic: SpellId; special: SpellId } {
		return ELEMENT_SPELLS[this.element];
	}

	cooldown(id: SpellId): number {
		return this.cooldowns[id] ?? 0;
	}

	manaCost(spell: SpellDef): number {
		if (spell.id === 'lightning_bolt') return spell.mana * this.ctx.progression.mods().boltCost;
		return spell.mana;
	}

	// ------------------------------------------------------------------ per-frame input

	readInput(): void {
		const ctx = this.ctx;
		const input = ctx.input;
		const player = ctx.player;
		if (input.wasPressed('jump')) this.buf.jump = 0.15;
		player.setJumpHeld(input.isDown('jump'));
		if (input.wasPressed('dodge')) this.buf.dodge = 0.18;
		if (input.mouseClicked(0)) this.buf.basic = 0.25;
		this.held.basic = input.mouse(0);
		const rmb = input.mouse(2);
		if (input.mouseUp(2) || (!rmb && this.held.charge)) this.chargeReleased = true;
		this.held.charge = rmb;
		this.held.shield = input.isDown('shield');
		this.held.channel = input.isDown('channel');
		if (input.wasPressed('parry')) this.buf.parry = 0.14;
		if (input.wasPressed('ultimate')) this.buf.ultimate = 0.2;
		if (input.wasPressed('elem1')) this.setElement('fire');
		if (input.wasPressed('elem2')) this.setElement('ice');
		if (input.wasPressed('elem3')) this.setElement('lightning');
		if (input.wasPressed('elem4')) this.setElement('wind');
		if (input.wasPressed('lock')) ctx.targeting.toggleLock();
		if (input.wasPressed('potion')) this.drink('health_potion');
		if (input.wasPressed('manaPotion')) this.drink('mana_potion');
		if (input.wasPressed('interact')) ctx.interactables.interact();
	}

	setElement(el: PlayerElement): void {
		if (el === this.element || !this.ctx.player.alive) return;
		this.element = el;
		this.ctx.player.model.setElement(el);
		const p = this.ctx.player.position;
		this.ctx.vfx.rings.spawn(_o.set(p.x, p.y + 0.1, p.z), ELEMENT_COLORS[el], 0.3, 1.8, 0.35, { thick: 0.25, intensity: 2.5 });
		this.ctx.vfx.sparkle(_o.set(p.x, p.y + 1.2, p.z), ELEMENT_COLORS[el], 10);
		this.ctx.audio.sfx('swap', p, { pitch: el === 'fire' ? 1 : el === 'ice' ? 1.2 : el === 'lightning' ? 1.35 : 0.9 });
	}

	drink(id: 'health_potion' | 'mana_potion'): void {
		const ctx = this.ctx;
		const p = ctx.player;
		if (!p.alive || this.potionCooldown > 0) return;
		if (id === 'health_potion' && p.hp >= p.maxHp) return;
		if (id === 'mana_potion' && p.mana >= p.maxMana) return;
		if (!ctx.inventory.remove(id)) {
			ctx.ui.notify(id === 'health_potion' ? 'No Healing Draughts' : 'No Aether Tonics', '', 'warning');
			return;
		}
		this.potionCooldown = 1.0;
		if (id === 'health_potion') {
			p.heal(p.maxHp * 0.45);
			ctx.vfx.heal(_o.copy(p.position).setY(p.position.y + 0.2));
		} else {
			p.restoreMana(p.maxMana * 0.6);
			ctx.vfx.heal(_o.copy(p.position).setY(p.position.y + 0.2), 0x6aa8ff);
		}
		ctx.audio.sfx('potion', p.position);
	}

	// ------------------------------------------------------------------ fixed step

	fixedUpdate(dt: number): void {
		const ctx = this.ctx;
		const player = ctx.player;
		const f = player.fsm;
		for (const k of Object.keys(this.buf) as (keyof typeof this.buf)[]) this.buf[k] = Math.max(0, this.buf[k] - dt);
		for (const k of Object.keys(this.cooldowns) as SpellId[]) this.cooldowns[k] = Math.max(0, (this.cooldowns[k] ?? 0) - dt);
		this.comboTimer = Math.max(0, this.comboTimer - dt);
		if (this.comboTimer <= 0 && f.action === 'idle') this.combo = 0;
		this.parryCooldown = Math.max(0, this.parryCooldown - dt);
		this.potionCooldown = Math.max(0, this.potionCooldown - dt);
		this.lowManaTimer = Math.max(0, this.lowManaTimer - dt);
		this.notReadyTimer = Math.max(0, this.notReadyTimer - dt);
		if (!player.alive || !ctx.playing || player.cutscene) {
			if (f.action !== 'idle' && !player.alive) this.interrupt(true);
			player.aimYaw = null;
			this.chargeReleased = false;
			return;
		}

		// Movement intents first: dodging cancels actions inside their cancel windows.
		if (this.buf.dodge > 0 && player.tryDodge()) this.buf.dodge = 0;
		if (this.buf.jump > 0 && player.tryJump()) this.buf.jump = 0;

		this.advanceAction(dt);
		this.startActions();
		this.chargeReleased = false;

		// Face the aim direction while doing anything with the hands or when locked on.
		const busy = f.action !== 'idle' || this.held.basic || ctx.targeting.locked !== null;
		if (busy && f.move !== 'dodge') {
			const aim = ctx.targeting.aimPoint;
			player.aimYaw = Math.atan2(aim.x - player.position.x, aim.z - player.position.z);
		} else player.aimYaw = null;
	}

	private advanceAction(dt: number): void {
		const ctx = this.ctx;
		const player = ctx.player;
		const f = player.fsm;
		switch (f.action) {
			case 'windup': {
				const p = this.pending;
				if (!p) {
					f.setAction('idle', 0, true);
					break;
				}
				this.handOrigin(p.hand, this.castOrigin);
				ctx.vfx.gather(p.spell.element, this.castOrigin, f.actionProgress);
				if (f.actionTime >= f.actionDuration) this.fire();
				break;
			}
			case 'release':
				if (f.actionTime >= f.actionDuration) {
					const rec = this.pending?.spell.recover ?? 0.2;
					f.setAction('recover', rec * (this.pending?.finisher ? 1.3 : 1), true);
				}
				break;
			case 'recover':
				if (f.actionTime >= f.actionDuration) {
					f.setAction('idle');
					this.pending = null;
				}
				break;
			case 'charging': {
				const spell = SPELLS[this.spellIds.special];
				this.chargeTime += dt;
				const c = this.chargeLevel(spell);
				this.handOrigin('both', this.castOrigin);
				ctx.vfx.gather(spell.element, this.castOrigin, c);
				ctx.audio.chargeLevel(c);
				if (this.chargeReleased || !this.held.charge) {
					if (this.chargeTime >= (spell.charge?.min ?? 0.2)) this.releaseCharged(spell, c);
					else this.cancelCharge();
				}
				break;
			}
			case 'channeling': {
				if (!this.held.channel || player.mana <= 0.5) {
					ctx.spells.channelStop();
					f.setAction('recover', SPELLS.prismatic_ray.recover, true);
					break;
				}
				player.mana = Math.max(0, player.mana - SPELLS.prismatic_ray.mana * dt);
				this.handOrigin('both', this.castOrigin);
				ctx.spells.channelTick(dt, this.castOrigin, ctx.targeting.aimPoint, this.element);
				break;
			}
			case 'shielding': {
				if (!this.held.shield) {
					f.setAction('idle');
					ctx.vfx.shield.set(false);
					ctx.audio.sfx('shield_down', player.position, { volume: 0.4 });
					break;
				}
				player.stamina = Math.max(0, player.stamina - SHIELD.drain * dt);
				if (player.stamina <= 0) this.guardBreak();
				break;
			}
			case 'parrying':
				if (f.actionTime >= f.actionDuration) {
					f.setAction('idle');
					if (this.held.shield) this.raiseShield();
				}
				break;
			case 'ultimate':
				if (!ctx.spells.ultimateActive) f.setAction('recover', 0.4, true);
				break;
		}
	}

	private startActions(): void {
		const ctx = this.ctx;
		const player = ctx.player;
		const f = player.fsm;
		const canAct = player.statuses.canAct();
		if (!canAct) {
			if (f.action === 'windup' || f.action === 'charging' || f.action === 'channeling') this.interrupt(false);
			return;
		}
		// Defensive actions take priority.
		if (this.buf.parry > 0 && this.parryCooldown <= 0 && (f.action === 'idle' || f.action === 'shielding' || f.handsFree) && f.canEnterAction('parrying')) {
			this.buf.parry = 0;
			if (f.action === 'shielding') ctx.vfx.shield.set(false);
			f.setAction('parrying', PARRY.duration);
			ctx.audio.sfx('parry_swing', player.position, { volume: 0.6 });
			return;
		}
		if (this.held.shield && f.action === 'idle' && f.canEnterAction('shielding')) {
			this.raiseShield();
			return;
		}
		if (this.buf.ultimate > 0) {
			this.buf.ultimate = 0;
			if (this.aether < 100) {
				ctx.ui.notify('Aether gauge not full', 'Deal damage and trigger reactions to charge it', 'warning');
				ctx.audio.sfx('fizzle');
			} else if (f.handsFree && f.canEnterAction('ultimate')) {
				this.aether = 0;
				f.setAction('ultimate', 0, true);
				ctx.spells.ultimateStart(ctx.targeting.aimPoint, this.element);
				return;
			}
		}
		if (this.held.channel && f.handsFree && f.canEnterAction('channeling')) {
			if (!ctx.progression.hasAbility('prismatic_ray')) {
				if (this.notReadyTimer <= 0) {
					this.notReadyTimer = 2;
					ctx.ui.notify('Ability locked', 'Prismatic Ray is unlocked by completing The Broken Seal', 'warning');
				}
			} else if (player.mana > 4) {
				f.setAction('channeling');
				this.handOrigin('both', this.castOrigin);
				ctx.spells.channelStart(this.element);
				return;
			} else this.lowMana();
		}
		if (this.held.charge && f.handsFree && f.action !== 'charging') {
			const spell = SPELLS[this.spellIds.special];
			if (this.cooldown(spell.id) > 0) {
				if (this.notReadyTimer <= 0) {
					this.notReadyTimer = 0.8;
					ctx.audio.sfx('fizzle', player.position, { volume: 0.4 });
					ctx.numbers.spawn(_o.copy(player.position).setY(player.position.y + 2.2), `${spell.name} ${this.cooldown(spell.id).toFixed(1)}s`, 'info');
				}
			} else if (player.mana + 0.01 < this.manaCost(spell)) this.lowMana();
			else if (f.canEnterAction('charging')) {
				f.setAction('charging');
				this.chargeTime = 0;
				this.chargeCircle = ctx.vfx.circles.spawn(player.position, 1.6, ELEMENT_COLORS[spell.element], 30, { spin: 2, follow: player.renderPosition, offsetY: 0.08, intensity: 2.2 });
				ctx.audio.chargeStart(spell.element);
				return;
			}
		}
		if ((this.buf.basic > 0 || this.held.basic) && f.handsFree) this.tryBasic();
	}

	private chargeLevel(spell: SpellDef): number {
		return clamp(this.chargeTime / (spell.charge?.full ?? 1), 0, 1);
	}

	private tryBasic(): void {
		const ctx = this.ctx;
		const player = ctx.player;
		const f = player.fsm;
		const spell = SPELLS[this.spellIds.basic];
		if (this.cooldown(spell.id) > 0) return;
		const dashCast = f.move === 'dash';
		// Keep the press buffered while the body can't cast yet (e.g. mid-roll).
		if (!dashCast && !f.canEnterAction('windup')) return;
		if (player.mana + 0.01 < this.manaCost(spell)) {
			this.lowMana();
			this.buf.basic = 0;
			return;
		}
		const chained = this.comboTimer > 0 || f.action === 'recover';
		this.combo = chained ? (this.combo + 1) % 3 : 0;
		const finisher = this.combo === 2;
		const hand: 'L' | 'R' | 'both' = finisher ? 'both' : this.combo === 1 ? 'L' : 'R';
		this.pending = { spell, hand, finisher, dashCast, charge: -1, fired: false };
		this.cooldowns[spell.id] = spell.cooldown * (finisher ? 1.25 : 1);
		this.buf.basic = 0;
		if (dashCast) {
			f.setAction('release', spell.release, true);
			this.fire();
		} else if (!f.setAction('windup', spell.windup * (finisher ? 1.5 : 1), f.action === 'recover')) {
			this.pending = null;
			this.cooldowns[spell.id] = 0;
		}
	}

	/** Releases the pending basic cast. */
	private fire(): void {
		const ctx = this.ctx;
		const player = ctx.player;
		const p = this.pending;
		if (!p || p.fired) return;
		p.fired = true;
		if (!player.spendMana(this.manaCost(p.spell))) {
			this.lowMana();
			player.fsm.setAction('idle', 0, true);
			this.pending = null;
			return;
		}
		if (player.fsm.action !== 'release') player.fsm.setAction('release', p.spell.release, true);
		this.handOrigin(p.hand, this.castOrigin);
		const counter = player.statuses.has('counter');
		const tailwind = p.spell.projectile !== undefined && p.spell.element !== 'wind' && ctx.time - this.lastWindBlade < 1;
		ctx.spells.castPlayer(p.spell, {
			origin: this.castOrigin,
			aim: ctx.targeting.aimPoint,
			charge: -1,
			finisher: p.finisher,
			dashCast: p.dashCast,
			counter,
			tailwind
		});
		if (counter) player.statuses.remove('counter');
		if (p.spell.id === 'wind_blade') this.lastWindBlade = ctx.time;
		this.comboTimer = COMBO.window + p.spell.recover;
	}

	private releaseCharged(spell: SpellDef, charge: number): void {
		const ctx = this.ctx;
		const player = ctx.player;
		ctx.vfx.circles.end(this.chargeCircle, 0.15);
		this.chargeCircle = -1;
		ctx.audio.chargeStop();
		if (!player.spendMana(this.manaCost(spell))) {
			this.lowMana();
			player.fsm.setAction('idle', 0, true);
			return;
		}
		this.cooldowns[spell.id] = spell.cooldown;
		this.pending = { spell, hand: 'both', finisher: false, dashCast: false, charge, fired: true };
		player.fsm.setAction('release', spell.release, true);
		this.handOrigin('both', this.castOrigin);
		const counter = player.statuses.has('counter');
		ctx.spells.castPlayer(spell, { origin: this.castOrigin, aim: ctx.targeting.aimPoint, charge, finisher: false, dashCast: false, counter, tailwind: false });
		if (counter) player.statuses.remove('counter');
		this.comboTimer = 0;
	}

	private cancelCharge(): void {
		const ctx = this.ctx;
		ctx.vfx.circles.end(this.chargeCircle, 0.15);
		this.chargeCircle = -1;
		ctx.audio.chargeStop();
		ctx.player.fsm.setAction('idle', 0, true);
	}

	private raiseShield(): void {
		const ctx = this.ctx;
		const f = ctx.player.fsm;
		if (!f.setAction('shielding')) return;
		this.shieldRaisedAt = ctx.time;
		ctx.vfx.shield.set(true, 0x7ad8ff);
		ctx.audio.sfx('shield_up', ctx.player.position, { volume: 0.6 });
	}

	private guardBreak(): void {
		const ctx = this.ctx;
		const player = ctx.player;
		ctx.vfx.shield.set(false);
		player.fsm.setAction('idle', 0, true);
		player.fsm.setMove('stagger', 0.8);
		player.stamina = 0;
		ctx.numbers.spawn(_o.copy(player.position).setY(player.position.y + 2.2), 'GUARD BROKEN', 'reaction');
		ctx.audio.sfx('guard_break', player.position);
		ctx.feel.shake(0.4);
	}

	private lowMana(): void {
		if (this.lowManaTimer > 0) return;
		this.lowManaTimer = 0.7;
		const p = this.ctx.player;
		this.ctx.numbers.spawn(_o.copy(p.position).setY(p.position.y + 2.2), 'Not enough mana', 'mana');
		this.ctx.audio.sfx('fizzle', p.position, { volume: 0.5 });
	}

	/** Hand world position for spell origins. */
	private handOrigin(hand: 'L' | 'R' | 'both', out: THREE.Vector3): THREE.Vector3 {
		const m = this.ctx.player.model;
		if (hand === 'both') {
			m.handPosition('L', out);
			m.handPosition('R', _a);
			out.add(_a).multiplyScalar(0.5);
			return out;
		}
		return m.handPosition(hand, out);
	}

	// ------------------------------------------------------------------ defence

	/** Called by the combat system before damage is applied to the player. */
	intercept(hit: HitInfo): 'parried' | 'blocked' | null {
		const ctx = this.ctx;
		const player = ctx.player;
		const f = player.fsm;
		const parryable = hit.parryable !== false && !(hit.tags & HitTag.DOT);
		if (f.action === 'parrying' && parryable && f.actionTime >= PARRY.start && f.actionTime <= PARRY.end) {
			this.onParry(hit, true);
			return 'parried';
		}
		if (f.action === 'shielding' && hit.blockable !== false) {
			if (parryable && ctx.time - this.shieldRaisedAt < SHIELD.perfectWindow) {
				this.onParry(hit, false);
				return 'parried';
			}
			const cost = hit.damage * SHIELD.costMult + SHIELD.costFlat;
			if (player.stamina >= cost) {
				player.stamina -= cost;
				player.spendStamina(0);
				ctx.vfx.block(_o.copy(player.position).setY(player.position.y + 1.1));
				ctx.audio.sfx('block', player.position);
				return 'blocked';
			}
			this.guardBreak();
			return null;
		}
		if (f.action === 'parrying' && f.actionTime > PARRY.end) this.parryCooldown = PARRY.failCooldown;
		return null;
	}

	private onParry(hit: HitInfo, fromParry: boolean): void {
		const ctx = this.ctx;
		const player = ctx.player;
		const chest = player.model.chestPosition(_o);
		ctx.vfx.parry(chest);
		ctx.audio.sfx('parry', chest);
		ctx.feel.slowMo(0.25, 0.35);
		ctx.feel.shake(0.25);
		ctx.numbers.spawn(_a.copy(chest).setY(chest.y + 1), fromParry ? 'PERFECT PARRY' : 'PERFECT BLOCK', 'reaction');
		player.statuses.apply({ id: 'counter', duration: PARRY.counter });
		player.restoreMana(12);
		player.stamina = Math.min(player.maxStamina, player.stamina + 20);
		this.gainAether(18);
		const projectile = !!(hit.tags & HitTag.PROJECTILE);
		const atk = hit.attacker as unknown as { onParried?: () => void } | null;
		if (!projectile) atk?.onParried?.();
		ctx.events.emit('parry', { perfect: true, projectile });
		ctx.ui.notify('Counter ready', 'Your next spell is a guaranteed critical Counterattack', 'info');
	}

	/** Cancels vulnerable actions (windup, charge, channel) when hit. */
	interrupt(heavy: boolean): void {
		const ctx = this.ctx;
		const f = ctx.player.fsm;
		const was = f.action;
		if (was === 'charging') {
			ctx.vfx.circles.end(this.chargeCircle, 0.1);
			this.chargeCircle = -1;
			ctx.audio.chargeStop();
		}
		if (was === 'channeling') ctx.spells.channelStop();
		if (was === 'shielding') ctx.vfx.shield.set(false);
		if (was === 'windup' || was === 'charging' || was === 'channeling') {
			const p = ctx.player.position;
			ctx.numbers.spawn(_o.copy(p).setY(p.y + 2.2), 'Interrupted', 'info');
			ctx.audio.sfx('fizzle', p, { volume: 0.6 });
			if (this.pending && !this.pending.fired) this.cooldowns[this.pending.spell.id] = 0;
		}
		if (was !== 'ultimate' && (heavy || was === 'windup' || was === 'charging' || was === 'channeling' || was === 'shielding')) {
			f.setAction('idle', 0, true);
			this.pending = null;
		}
	}

	onDodge(): void {
		const ctx = this.ctx;
		if (this.chargeCircle >= 0) {
			ctx.vfx.circles.end(this.chargeCircle, 0.1);
			this.chargeCircle = -1;
			ctx.audio.chargeStop();
		}
		ctx.vfx.shield.set(false);
		this.pending = null;
	}

	fillAnim(a: CharacterAnimInput): void {
		const f = this.ctx.player.fsm;
		a.charge = 0;
		a.castHand = this.pending?.hand ?? 'R';
		a.actionT = f.actionProgress;
		switch (f.action) {
			case 'windup':
				a.action = 'castWindup';
				break;
			case 'release':
				a.action = 'castRelease';
				break;
			case 'recover':
				a.action = 'castRecover';
				break;
			case 'charging':
				a.action = 'charge';
				a.charge = this.chargeLevel(SPELLS[this.spellIds.special]);
				break;
			case 'channeling':
				a.action = 'channel';
				break;
			case 'shielding':
				a.action = 'shield';
				break;
			case 'parrying':
				a.action = 'parry';
				break;
			case 'ultimate':
				a.action = 'ultimate';
				break;
			default:
				a.action = 'none';
		}
	}

	/** HUD charge meter (-1 when not charging). */
	chargeHud(): number {
		const f = this.ctx.player.fsm;
		return f.action === 'charging' ? this.chargeLevel(SPELLS[this.spellIds.special]) : -1;
	}

	reset(): void {
		for (const k of Object.keys(this.cooldowns) as SpellId[]) this.cooldowns[k] = 0;
		this.combo = 0;
		this.comboTimer = 0;
		this.pending = null;
		this.chargeCircle = -1;
		this.buf = { jump: 0, dodge: 0, basic: 0, parry: 0, ultimate: 0 };
		this.ctx.vfx.shield.set(false);
	}
}
