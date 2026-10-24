import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Combatant, Element, HitInfo, PlayerElement, StatusApplication, Team } from '../combat/types';
import { ELEMENT_COLORS, HitTag } from '../combat/types';
import type { ProjectileKind, ProjectileVisual } from '../vfx/MagicVFX';
import type { Beam, LightPool } from '../vfx/VfxPrimitives';
import { COMBO, SPELLS, type SpellDef } from './SpellRegistry';
import { TAILWIND, fieldReaction } from './ElementalReactions';
import type { SegmentHit } from '../combat/CombatSystem';
import { clamp, lerp } from '../utils/math';

type LightSlot = ReturnType<LightPool['hold']>;

export interface CastOpts {
	origin: THREE.Vector3;
	aim: THREE.Vector3;
	/** 0..1 for charged specials, -1 for uncharged casts. */
	charge: number;
	finisher: boolean;
	dashCast: boolean;
	counter: boolean;
	tailwind: boolean;
}

/** Something that can be dragged by a tornado (enemies implement this). */
export interface Pullable {
	pull(center: THREE.Vector3, strength: number, lift: number, dt: number): void;
}

interface Projectile {
	active: boolean;
	team: Team;
	kind: ProjectileKind;
	element: Element;
	spellId: string;
	pos: THREE.Vector3;
	prev: THREE.Vector3;
	vel: THREE.Vector3;
	life: number;
	radius: number;
	pierce: number;
	hits: Set<number>;
	damage: number;
	status: StatusApplication[];
	knockback: number;
	poise: number;
	heavy: boolean;
	tags: number;
	critChance: number;
	gravity: number;
	homing: Combatant | null;
	homingRate: number;
	splash: number;
	splashMult: number;
	accelerated: boolean;
	attacker: Combatant | null;
	parryable: boolean;
	blockable: boolean;
	scale: number;
	visual: ProjectileVisual | null;
	light: LightSlot;
	power: number;
	/** Enemy-cast interrupt bolts. */
	interrupt: boolean;
}

interface Tornado {
	active: boolean;
	pos: THREE.Vector3;
	dir: THREE.Vector3;
	speed: number;
	life: number;
	maxLife: number;
	radius: number;
	damage: number;
	tick: number;
	pull: number;
	fire: boolean;
	wet: boolean;
	vfx: number;
	power: number;
	stopped: boolean;
}

interface Scheduled {
	at: number;
	fn: () => void;
}

export interface EnemyProjectileSpec {
	kind: ProjectileKind;
	origin: THREE.Vector3;
	dir: THREE.Vector3;
	speed: number;
	damage: number;
	element: Element;
	radius: number;
	attacker: Combatant;
	life?: number;
	homing?: Combatant | null;
	homingRate?: number;
	status?: StatusApplication[];
	knockback?: number;
	heavy?: boolean;
	parryable?: boolean;
	blockable?: boolean;
	scale?: number;
	gravity?: number;
	interrupt?: boolean;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _seg: SegmentHit = { target: null, hurtbox: null, s: 0, point: new THREE.Vector3() };
const UP = new THREE.Vector3(0, 1, 0);

/**
 * Executes every spell: player casts (projectiles, hitscan bolts, targeted and self
 * areas, chains, summoned tornadoes, the channelled ray and the ultimate) and enemy
 * projectiles. Handles flight, collision, impacts, field reactions and parry reflects.
 */
export class SpellSystem {
	private projectiles: Projectile[] = [];
	readonly tornados: Tornado[] = [];
	private scheduled: Scheduled[] = [];
	private time = 0;
	// channel state
	private beam: Beam | null = null;
	private beamTick = 0;
	private beamElement: PlayerElement = 'fire';
	private beamArc = -1;
	readonly beamFrom = new THREE.Vector3();
	readonly beamTo = new THREE.Vector3();
	// ultimate state
	ultimateActive = false;
	private ultT = 0;
	private ultCenter = new THREE.Vector3();
	private ultElement: PlayerElement = 'fire';
	private ultNext = 0;
	private ultCircle = -1;
	private meteors: { start: THREE.Vector3; pos: THREE.Vector3; target: THREE.Vector3; t: number; visual: ProjectileVisual | null }[] = [];

	constructor(private ctx: GameContext) {
		for (let i = 0; i < 64; i++) {
			this.projectiles.push({
				active: false,
				team: 'player',
				kind: 'fireball',
				element: 'fire',
				spellId: '',
				pos: new THREE.Vector3(),
				prev: new THREE.Vector3(),
				vel: new THREE.Vector3(),
				life: 0,
				radius: 0.3,
				pierce: 0,
				hits: new Set(),
				damage: 0,
				status: [],
				knockback: 0,
				poise: 0,
				heavy: false,
				tags: 0,
				critChance: 0,
				gravity: 0,
				homing: null,
				homingRate: 0,
				splash: 0,
				splashMult: 0,
				accelerated: false,
				attacker: null,
				parryable: true,
				blockable: true,
				scale: 1,
				visual: null,
				light: null,
				power: 1,
				interrupt: false
			});
		}
		for (let i = 0; i < 4; i++) {
			this.tornados.push({ active: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, life: 0, maxLife: 1, radius: 3, damage: 0, tick: 0, pull: 0, fire: false, wet: false, vfx: -1, power: 1, stopped: false });
		}
	}

	private after(delay: number, fn: () => void): void {
		this.scheduled.push({ at: this.time + delay, fn });
	}

	// ------------------------------------------------------------------ player casts

	castPlayer(spell: SpellDef, o: CastOpts): void {
		const ctx = this.ctx;
		const isProjectile = spell.castType === 'projectile' || spell.castType === 'hitscan';
		ctx.profile.recordCast(isProjectile);
		ctx.events.emit('cast', { spellId: spell.id, element: spell.element, projectile: isProjectile });
		const charge = o.charge;
		const cd = spell.charge;
		const dmgK = cd && charge >= 0 ? lerp(cd.damage[0], cd.damage[1], charge) : 1;
		const radK = cd && charge >= 0 ? lerp(cd.radius[0], cd.radius[1], charge) : 1;
		let mult = dmgK * (o.finisher ? COMBO.finisherMult : 1) * (o.dashCast ? 1.2 : 1) * (o.counter ? 1.5 : 1);
		if (o.tailwind) mult *= TAILWIND.damageMult;
		_dir.subVectors(o.aim, o.origin);
		if (_dir.lengthSq() < 0.01) _dir.set(Math.sin(ctx.player.yaw), 0, Math.cos(ctx.player.yaw));
		_dir.normalize();
		const big = o.finisher || charge >= 0.95 || o.counter;
		ctx.vfx.castBurst(spell.element, o.origin, _dir, big || spell.slot === 'special');
		ctx.audio.sfx(`cast_${spell.element}`, o.origin, { volume: big ? 1 : 0.8, pitch: o.finisher ? 0.85 : 1 });
		if (o.counter) {
			ctx.numbers.spawn(_v.copy(o.origin).setY(o.origin.y + 0.8), 'COUNTER', 'reaction');
			ctx.feel.kick(4);
		}
		if (o.finisher) ctx.feel.shake(0.08);
		const tags = (o.finisher ? HitTag.FINISHER : 0) | (o.dashCast ? HitTag.DASH : 0) | (o.counter ? HitTag.COUNTER : 0) | (charge >= 0 ? HitTag.CHARGED : 0);
		const mods = ctx.progression.mods();
		switch (spell.castType) {
			case 'projectile':
				this.fireProjectiles(spell, o, mult, tags);
				if (o.tailwind) {
					ctx.vfx.reaction('accelerated', o.origin);
					ctx.numbers.spawn(_v.copy(o.origin).setY(o.origin.y + 0.6), 'TAILWIND', 'reaction');
				}
				break;
			case 'hitscan':
				this.fireBolt(spell, o, mult * mods.boltDamage, tags);
				break;
			case 'aoe_target':
				this.castExplosion(spell, o, mult, radK * mods.explosionRadius, tags);
				break;
			case 'aoe_self':
				this.castNova(spell, mult, radK, charge, tags);
				break;
			case 'chain':
				this.castChain(spell, o, mult, charge, tags);
				break;
			case 'summon':
				this.castTornado(spell, o, mult, radK, charge);
				break;
		}
	}

	private fireProjectiles(spell: SpellDef, o: CastOpts, mult: number, tags: number): void {
		const ctx = this.ctx;
		const spec = spell.projectile!;
		const mods = ctx.progression.mods();
		let count = spec.count;
		if (spell.id === 'ice_shards') count += mods.iceShardsExtra * (1 + (o.finisher ? 1 : 0));
		const scale = o.finisher ? COMBO.finisherScale : o.counter ? 1.25 : 1;
		const speed = spec.speed * (o.tailwind ? TAILWIND.speedMult : 1);
		const locked = ctx.targeting.locked;
		const spread = THREE.MathUtils.degToRad(spec.spread);
		for (let i = 0; i < count; i++) {
			const off = count > 1 ? (i - (count - 1) / 2) * spread : 0;
			_v.copy(_dir).applyAxisAngle(UP, off);
			const p = this.spawn('player', spec.kind, o.origin, _v.multiplyScalar(speed), spec.life, spec.radius * scale, scale);
			if (!p) return;
			p.element = spell.element;
			p.spellId = spell.id;
			p.damage = spell.damage * mult;
			p.status = spell.status;
			p.knockback = spell.knockback * (o.finisher ? 1.6 : 1);
			p.poise = spell.poise * (o.finisher ? COMBO.finisherPoise : 1);
			p.heavy = spell.heavy || o.finisher;
			p.pierce = spec.pierce + (spell.id === 'wind_blade' ? mods.bladePierce : 0);
			p.splash = (spec.splash ?? 0) * (o.finisher ? 1.4 : 1);
			p.splashMult = (spec.splashMult ?? 0) * (spell.id === 'fireball' ? mods.fireballSplash : 1);
			p.tags = tags | HitTag.PROJECTILE;
			p.homing = locked;
			p.homingRate = locked ? 5 : 0;
			p.accelerated = o.tailwind;
			if (i === Math.floor(count / 2)) p.light = ctx.vfx.lights.hold(ELEMENT_COLORS[spell.element], 6 * scale, 8, 0.5);
			if (ctx.targeting.aimTarget) ctx.profile.recordProjectileAt(ctx.targeting.aimTarget.uid);
		}
	}

	private spawn(team: Team, kind: ProjectileKind, origin: THREE.Vector3, vel: THREE.Vector3, life: number, radius: number, scale: number): Projectile | null {
		const p = this.projectiles.find((x) => !x.active);
		if (!p) return null;
		p.active = true;
		p.team = team;
		p.kind = kind;
		p.pos.copy(origin);
		p.prev.copy(origin);
		p.vel.copy(vel);
		p.life = life;
		p.radius = radius;
		p.pierce = 0;
		p.hits.clear();
		p.status = [];
		p.knockback = 0;
		p.poise = 0;
		p.heavy = false;
		p.tags = HitTag.PROJECTILE;
		p.critChance = -1;
		p.gravity = 0;
		p.homing = null;
		p.homingRate = 0;
		p.splash = 0;
		p.splashMult = 0;
		p.accelerated = false;
		p.attacker = team === 'player' ? this.ctx.player : null;
		p.parryable = true;
		p.blockable = true;
		p.scale = scale;
		p.power = team === 'player' ? this.ctx.player.powerScale() : 1;
		p.interrupt = false;
		p.visual = this.ctx.vfx.projectile(kind, scale);
		p.light = null;
		return p;
	}

	private fireBolt(spell: SpellDef, o: CastOpts, mult: number, tags: number): void {
		const ctx = this.ctx;
		const range = spell.range * (o.finisher ? 1.2 : 1);
		const locked = ctx.targeting.locked;
		if (locked) locked.aimPoint(_v2);
		else _v2.copy(o.aim);
		_dir.subVectors(_v2, o.origin).normalize();
		let dist = ctx.physics.castStaticNormal(o.origin, _dir, range, _n);
		if (dist < 0) dist = range;
		const end = _v.copy(o.origin).addScaledVector(_dir, dist);
		const hitSomething = ctx.combat.sweep(o.origin, end, spell.radius * (o.finisher ? 1.6 : 1), 'player', null, _seg);
		if (hitSomething) end.copy(_seg.point);
		ctx.vfx.bolt(o.origin, end, ELEMENT_COLORS.lightning, o.finisher ? 0.7 : 0.45, o.finisher ? 0.3 : 0.22);
		ctx.vfx.impact('lightning', end, o.finisher ? 1.5 : 1, hitSomething ? undefined : _n);
		ctx.audio.sfx('impact_lightning', end, { volume: o.finisher ? 1 : 0.7 });
		if (hitSomething && _seg.target) {
			const h = ctx.combat.playerHit({
				element: 'lightning',
				damage: spell.damage * mult,
				point: end.clone(),
				dir: _dir.clone(),
				knockback: spell.knockback * (o.finisher ? 2.5 : 1),
				poise: spell.poise * (o.finisher ? COMBO.finisherPoise : 1),
				heavy: o.finisher,
				status: o.finisher ? [{ id: 'shocked', duration: 4 }] : spell.status,
				tags: tags | HitTag.PROJECTILE,
				spellId: spell.id,
				weakMult: _seg.hurtbox && _seg.hurtbox.weak > 1 ? _seg.hurtbox.weak : undefined
			});
			ctx.combat.applyHit(_seg.target, h);
			ctx.profile.recordProjectileAt(_seg.target.uid);
		}
	}

	private castExplosion(spell: SpellDef, o: CastOpts, mult: number, radK: number, tags: number): void {
		const ctx = this.ctx;
		const player = ctx.player;
		// Target point: crosshair point clamped to range, dropped onto the ground.
		const target = _v.copy(ctx.targeting.locked ? ctx.targeting.locked.position : o.aim);
		_v2.subVectors(target, player.position).setY(0);
		if (_v2.length() > spell.range) {
			_v2.setLength(spell.range);
			target.copy(player.position).add(_v2);
		}
		const ground = ctx.world.terrain.heightAt(target.x, target.z);
		if (target.y - ground < 3 || target.y < ground) target.y = ground;
		const point = target.clone();
		const radius = spell.radius * radK;
		const color = ELEMENT_COLORS.fire;
		ctx.vfx.circles.spawn(point, radius, color, (spell.delay ?? 0.3) + 0.15, { spin: 4, fadeIn: 0.06, intensity: 3 });
		ctx.vfx.rings.spawn(_v2.copy(point).setY(point.y + 0.1), color, radius * 1.2, radius * 0.2, spell.delay ?? 0.3, { thick: 0.12, intensity: 2.5 });
		ctx.audio.sfx('sigil', point, { volume: 0.6 });
		this.after(spell.delay ?? 0.3, () => {
			ctx.vfx.explosion(_v.copy(point).setY(point.y + 0.6), radius);
			ctx.audio.sfx('explosion', point, { volume: 1 });
			ctx.feel.shake(0.4);
			ctx.feel.hitStop(0.05);
			this.igniteTornadosNear(point, radius);
			ctx.combat.overlap(_v.copy(point).setY(point.y + 1), radius, 'player', (c, d) => {
				const falloff = lerp(1, 0.55, clamp(d / radius, 0, 1));
				const h = ctx.combat.playerHit({
					element: 'fire',
					damage: spell.damage * mult * falloff,
					point: c.aimPoint(new THREE.Vector3()),
					dir: new THREE.Vector3().subVectors(c.position, point).setY(0.4),
					knockback: spell.knockback,
					poise: spell.poise,
					heavy: true,
					status: spell.status,
					tags: tags | HitTag.AOE,
					spellId: spell.id
				});
				ctx.combat.applyHit(c, h);
			});
		});
	}

	private castNova(spell: SpellDef, mult: number, radK: number, charge: number, tags: number): void {
		const ctx = this.ctx;
		const player = ctx.player;
		const radius = spell.radius * radK;
		const center = player.position.clone();
		ctx.vfx.frostNova(center, radius);
		ctx.audio.sfx('nova', center, { volume: 1 });
		ctx.feel.shake(0.3);
		const freeze = 2.4 * (charge >= 0 ? lerp(0.8, 1.35, charge) : 1);
		ctx.combat.overlap(_v.copy(center).setY(center.y + 1), radius, 'player', (c, d) => {
			const h = ctx.combat.playerHit({
				element: 'ice',
				damage: spell.damage * mult * lerp(1, 0.7, clamp(d / radius, 0, 1)),
				point: c.aimPoint(new THREE.Vector3()),
				dir: new THREE.Vector3().subVectors(c.position, center).setY(0.2),
				knockback: spell.knockback,
				poise: spell.poise,
				heavy: false,
				status: [{ id: 'frozen', duration: freeze }],
				tags: tags | HitTag.AOE,
				spellId: spell.id
			});
			ctx.combat.applyHit(c, h);
		});
		const ward = ctx.progression.mods().frostWard;
		if (ward > 0) {
			player.addWard(ward, 6);
			ctx.numbers.spawn(_v.copy(center).setY(center.y + 2.3), `Ward +${ward}`, 'heal');
		}
	}

	private castChain(spell: SpellDef, o: CastOpts, mult: number, charge: number, tags: number): void {
		const ctx = this.ctx;
		const mods = ctx.progression.mods();
		const ch = spell.chain!;
		const jumps = ch.jumps + mods.chainJumps + (charge >= 0 ? Math.floor(charge * 2) : 0);
		const range = ch.range + mods.chainRange;
		let first: Combatant | null = ctx.targeting.locked ?? ctx.targeting.aimTarget;
		if (!first) first = ctx.combat.nearest(o.aim, 10, 'player');
		if (!first) {
			// Cone search in front of the player.
			let best: Combatant | null = null;
			let bestD = spell.range;
			ctx.combat.forEachTarget('player', (c) => {
				_v.subVectors(c.position, ctx.player.position);
				const d = _v.length();
				if (d > spell.range || d > bestD) return;
				if (_v.normalize().dot(_dir) < 0.6) return;
				best = c;
				bestD = d;
			});
			first = best;
		}
		if (!first) {
			const end = _v.copy(o.origin).addScaledVector(_dir, 14);
			ctx.vfx.bolt(o.origin, end, ELEMENT_COLORS.lightning, 0.5, 0.25);
			ctx.audio.sfx('impact_lightning', end, { volume: 0.6 });
			return;
		}
		const hitSet = new Set<number>();
		const from = o.origin.clone();
		let current: Combatant = first;
		let dmg = spell.damage * mult;
		for (let j = 0; j <= jumps; j++) {
			const target = current;
			const src = from.clone();
			const amount = dmg;
			hitSet.add(target.uid);
			this.after(j * 0.07, () => {
				if (!target.alive) return;
				const p = target.aimPoint(new THREE.Vector3());
				ctx.vfx.bolt(src, p, ELEMENT_COLORS.lightning, j === 0 ? 0.65 : 0.5, 0.42);
				ctx.vfx.impact('lightning', p, 1.1);
				ctx.audio.sfx('impact_lightning', p, { volume: 0.75, pitch: 1 + j * 0.08 });
				const h = ctx.combat.playerHit({
					element: 'lightning',
					damage: amount,
					point: p.clone(),
					dir: new THREE.Vector3().subVectors(p, src),
					knockback: spell.knockback,
					poise: spell.poise,
					heavy: false,
					status: spell.status,
					tags: tags | HitTag.AOE,
					spellId: spell.id
				});
				ctx.combat.applyHit(target, h);
			});
			target.aimPoint(from);
			const next = ctx.combat.nearest(target.position, range, 'player', hitSet);
			if (!next) break;
			current = next;
			dmg *= ch.falloff;
		}
		ctx.feel.shake(0.15);
	}

	private castTornado(spell: SpellDef, o: CastOpts, mult: number, radK: number, charge: number): void {
		const ctx = this.ctx;
		const t = this.tornados.find((x) => !x.active) ?? this.tornados[0];
		if (t.active) this.endTornado(t);
		const mods = ctx.progression.mods();
		const f = spell.field!;
		const player = ctx.player;
		_v.set(_dir.x, 0, _dir.z).normalize();
		t.active = true;
		t.pos.copy(player.position).addScaledVector(_v, 2.5);
		t.pos.y = ctx.world.terrain.heightAt(t.pos.x, t.pos.z);
		t.dir.copy(_v);
		t.speed = f.speed;
		t.maxLife = (f.duration + mods.tornadoDuration) * (charge >= 0 ? lerp(0.8, 1.3, charge) : 1);
		t.life = t.maxLife;
		t.radius = spell.radius * radK;
		// Raw damage per tick; playerHit applies power and element bonuses.
		t.damage = spell.damage * mult;
		t.tick = 0;
		t.pull = f.pull * mods.tornadoPull;
		t.fire = false;
		t.wet = false;
		t.stopped = false;
		t.power = player.powerScale();
		t.vfx = ctx.vfx.tornadoStart(t.pos, t.radius, false);
		ctx.audio.tornadoStart();
	}

	private igniteTornadosNear(p: THREE.Vector3, radius: number): void {
		for (const t of this.tornados) {
			if (!t.active || t.fire) continue;
			if (Math.hypot(t.pos.x - p.x, t.pos.z - p.z) < radius + t.radius) this.igniteTornado(t);
		}
	}

	private igniteTornado(t: Tornado): void {
		const ctx = this.ctx;
		const r = fieldReaction('tornado', 'fire', false);
		if (!r) return;
		t.fire = true;
		t.radius *= 1.35;
		t.damage *= 1.6;
		ctx.vfx.tornadoIgnite(t.vfx);
		_v.copy(t.pos).setY(t.pos.y + 3);
		ctx.numbers.spawn(_v, r.name.toUpperCase(), 'reaction');
		ctx.audio.sfx('reaction_fire_tornado', t.pos, { volume: 1 });
		ctx.feel.shake(0.3);
		ctx.combat.stats.reactions++;
		ctx.events.emit('reaction', { id: r.id, name: r.name, target: ctx.player, pos: t.pos.clone() });
	}

	private endTornado(t: Tornado): void {
		t.active = false;
		this.ctx.vfx.tornadoEnd(t.vfx);
		t.vfx = -1;
		if (!this.tornados.some((x) => x.active)) this.ctx.audio.tornadoStop();
	}

	// ------------------------------------------------------------------ channel

	channelStart(el: PlayerElement): void {
		this.beamElement = el;
		this.beam = this.ctx.vfx.beams.acquire(ELEMENT_COLORS[el]);
		this.beamTick = 0;
		this.ctx.audio.channelStart();
	}

	channelTick(dt: number, origin: THREE.Vector3, aim: THREE.Vector3, el: PlayerElement): void {
		const ctx = this.ctx;
		const spell = SPELLS.prismatic_ray;
		if (el !== this.beamElement && this.beam) {
			this.beamElement = el;
			(this.beam.mat.uniforms.uColor.value as THREE.Color).setHex(ELEMENT_COLORS[el]).multiplyScalar(2);
		}
		_dir.subVectors(aim, origin).normalize();
		let dist = ctx.physics.castStaticNormal(origin, _dir, spell.range, _n);
		if (dist < 0) dist = spell.range;
		const end = _v.copy(origin).addScaledVector(_dir, dist);
		const hit = ctx.combat.sweep(origin, end, spell.radius, 'player', null, _seg);
		if (hit) end.copy(_seg.point);
		this.beamFrom.copy(origin);
		this.beamTo.copy(end);
		if (this.beam) ctx.vfx.beams.aim(this.beam, origin, end, 0.22 + Math.sin(this.time * 30) * 0.03);
		if (this.beamArc < 0 || !ctx.vfx.arcs.items[this.beamArc]?.active) this.beamArc = ctx.vfx.arcs.spawn(origin, end, ELEMENT_COLORS[el], 0.2, 0.18, 0.5);
		else ctx.vfx.arcs.move(this.beamArc, origin, end, 0.1);
		this.beamTick -= dt;
		if (this.beamTick <= 0) {
			this.beamTick = 0.1;
			ctx.vfx.impact(el, end, 0.5, hit ? undefined : _n);
			if (hit && _seg.target) {
				const status: StatusApplication[] =
					el === 'fire'
						? [{ id: 'burning', duration: 2, chance: 0.25 }]
						: el === 'ice'
							? [{ id: 'chilled', duration: 2.5, chance: 0.3 }]
							: el === 'lightning'
								? [{ id: 'shocked', duration: 2.5, chance: 0.35 }]
								: [];
				const h = ctx.combat.playerHit({
					element: el,
					damage: spell.damage * 0.1,
					point: end.clone(),
					dir: _dir.clone(),
					knockback: el === 'wind' ? 2.5 : spell.knockback,
					poise: spell.poise * 0.1,
					heavy: false,
					status,
					tags: HitTag.BEAM,
					spellId: spell.id
				});
				ctx.combat.applyHit(_seg.target, h);
			}
		}
	}

	channelStop(): void {
		this.ctx.vfx.beams.release(this.beam);
		this.beam = null;
		this.beamArc = -1;
		this.ctx.audio.channelStop();
	}

	// ------------------------------------------------------------------ ultimate

	ultimateStart(aim: THREE.Vector3, el: PlayerElement): void {
		const ctx = this.ctx;
		const player = ctx.player;
		this.ultimateActive = true;
		this.ultT = 0;
		this.ultNext = 0.6;
		this.ultElement = el;
		_v2.subVectors(aim, player.position).setY(0);
		if (_v2.length() > SPELLS.aetherfall.range) _v2.setLength(SPELLS.aetherfall.range);
		this.ultCenter.copy(player.position).add(_v2);
		this.ultCenter.y = ctx.world.terrain.heightAt(this.ultCenter.x, this.ultCenter.z);
		const col = ELEMENT_COLORS[el];
		this.ultCircle = ctx.vfx.circles.spawn(this.ultCenter, SPELLS.aetherfall.radius, col, 3.6, { spin: 1.2, fadeIn: 0.5, intensity: 3 });
		ctx.vfx.circles.spawn(player.position, 2.2, 0xffd070, 3.4, { spin: -2, follow: player.renderPosition, intensity: 2.5 });
		ctx.vfx.levelUp(player.position);
		ctx.audio.sfx('ultimate', player.position, { volume: 1 });
		ctx.world.sky.gloom = 0.45;
		ctx.feel.shake(0.3);
		ctx.numbers.spawn(_v.copy(player.position).setY(player.position.y + 2.6), 'AETHERFALL', 'reaction');
	}

	private ultimateUpdate(dt: number): void {
		const ctx = this.ctx;
		this.ultT += dt;
		const spell = SPELLS.aetherfall;
		const el = this.ultElement;
		if (this.ultT >= this.ultNext && this.ultT < spell.windup + spell.release) {
			this.ultNext += 0.17;
			// Bias impacts toward enemies inside the area.
			let target: THREE.Vector3 | null = null;
			const candidates: Combatant[] = [];
			ctx.combat.overlap(this.ultCenter, spell.radius, 'player', (c) => candidates.push(c));
			if (candidates.length && Math.random() < 0.6) target = candidates[Math.floor(Math.random() * candidates.length)].position.clone();
			if (!target) {
				const a = Math.random() * Math.PI * 2;
				const r = Math.sqrt(Math.random()) * spell.radius;
				target = new THREE.Vector3(this.ultCenter.x + Math.cos(a) * r, 0, this.ultCenter.z + Math.sin(a) * r);
			}
			target.y = ctx.world.terrain.heightAt(target.x, target.z);
			const start = target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 8, 22, (Math.random() - 0.5) * 8));
			const kind: ProjectileKind = el === 'fire' ? 'fireball' : el === 'ice' ? 'iceShard' : el === 'wind' ? 'windBlade' : 'arcaneOrb';
			this.meteors.push({ start, pos: start.clone(), target, t: 0, visual: ctx.vfx.projectile(kind, 2.2) });
		}
		for (let i = this.meteors.length - 1; i >= 0; i--) {
			const m = this.meteors[i];
			const prevPos = _v2.copy(m.pos);
			m.t += dt / 0.38;
			const k = Math.min(1, m.t);
			// Accelerating fall from the sky onto the target point.
			m.pos.set(lerp(m.start.x, m.target.x, k), lerp(m.start.y, m.target.y, k * k), lerp(m.start.z, m.target.z, k));
			if (m.visual) ctx.vfx.trail(m.visual, m.pos, _n.subVectors(m.pos, prevPos).multiplyScalar(1 / Math.max(dt, 1e-3)), dt);
			if (el === 'lightning' && k < 1) ctx.vfx.bolt(_v.copy(m.target).setY(m.target.y + 22), m.target, ELEMENT_COLORS.lightning, 0.5, 0.06);
			if (k >= 1) {
				ctx.vfx.releaseProjectile(m.visual);
				this.meteorImpact(m.target, 3.2, spell.damage, false);
				this.meteors.splice(i, 1);
			}
		}
		if (this.ultT >= spell.windup + spell.release && this.meteors.length === 0) {
			this.meteorImpact(this.ultCenter, 6.5, spell.damage * 2.4, true);
			ctx.vfx.circles.end(this.ultCircle, 0.3);
			ctx.world.sky.gloom = 0;
			this.ultimateActive = false;
		}
	}

	private meteorImpact(p: THREE.Vector3, radius: number, damage: number, final: boolean): void {
		const ctx = this.ctx;
		const el = this.ultElement;
		const pos = p.clone();
		pos.y += 0.6;
		if (el === 'fire' || final) ctx.vfx.explosion(pos, radius * (final ? 1 : 0.7), ELEMENT_COLORS[el]);
		if (el === 'ice') ctx.vfx.frostNova(p, radius * 0.9);
		if (el === 'lightning') ctx.vfx.reaction('overcharge', pos, radius);
		if (el === 'wind') ctx.vfx.impact('wind', pos, 2);
		ctx.vfx.impact(el, pos, final ? 2.5 : 1.4);
		ctx.audio.sfx(final ? 'explosion' : `impact_${el}`, p, { volume: final ? 1 : 0.7 });
		ctx.feel.shake(final ? 0.6 : 0.15);
		const status: StatusApplication[] =
			el === 'fire' ? [{ id: 'burning', duration: 3 }] : el === 'ice' ? [{ id: 'chilled', duration: 3, stacks: 2 }] : el === 'lightning' ? [{ id: 'shocked', duration: 4 }] : [];
		ctx.combat.overlap(pos, radius, 'player', (c) => {
			const h = ctx.combat.playerHit({
				element: el,
				damage,
				point: c.aimPoint(new THREE.Vector3()),
				dir: new THREE.Vector3().subVectors(c.position, p).setY(0.5),
				knockback: final ? 12 : 4,
				poise: final ? 80 : 20,
				heavy: final,
				status,
				tags: HitTag.ULTIMATE | HitTag.AOE,
				spellId: 'aetherfall'
			});
			ctx.combat.applyHit(c, h);
		});
	}

	// ------------------------------------------------------------------ enemy projectiles

	enemyProjectile(s: EnemyProjectileSpec): void {
		_v.copy(s.dir).normalize().multiplyScalar(s.speed);
		const p = this.spawn('enemy', s.kind, s.origin, _v, s.life ?? 3, s.radius, s.scale ?? 1);
		if (!p) return;
		p.element = s.element;
		p.spellId = 'enemy';
		p.damage = s.damage;
		p.status = s.status ?? [];
		p.knockback = s.knockback ?? 3;
		p.poise = 0;
		p.heavy = s.heavy ?? false;
		p.attacker = s.attacker;
		p.homing = s.homing ?? null;
		p.homingRate = s.homingRate ?? 0;
		p.parryable = s.parryable ?? true;
		p.blockable = s.blockable ?? true;
		p.gravity = s.gravity ?? 0;
		p.interrupt = s.interrupt ?? false;
		p.critChance = 0;
	}

	// ------------------------------------------------------------------ simulation

	fixedUpdate(dt: number): void {
		this.time += dt;
		for (let i = this.scheduled.length - 1; i >= 0; i--) {
			if (this.time >= this.scheduled[i].at) {
				const s = this.scheduled[i];
				this.scheduled.splice(i, 1);
				s.fn();
			}
		}
		for (const p of this.projectiles) if (p.active) this.stepProjectile(p, dt);
		for (const t of this.tornados) if (t.active) this.stepTornado(t, dt);
		if (this.ultimateActive) this.ultimateUpdate(dt);
	}

	private stepProjectile(p: Projectile, dt: number): void {
		const ctx = this.ctx;
		p.prev.copy(p.pos);
		if (p.homing && p.homing.alive && p.homingRate > 0) {
			p.homing.aimPoint(_v);
			_v.sub(p.pos);
			const speed = p.vel.length();
			const want = _v.normalize().multiplyScalar(speed);
			p.vel.lerp(want, Math.min(1, p.homingRate * dt)).setLength(speed);
		}
		p.vel.y -= p.gravity * dt;
		p.pos.addScaledVector(p.vel, dt);
		p.life -= dt;
		// Field reactions: projectiles passing through a tornado.
		if (p.team === 'player') {
			for (const t of this.tornados) {
				if (!t.active) continue;
				if (Math.hypot(p.pos.x - t.pos.x, p.pos.z - t.pos.z) > t.radius || p.pos.y > t.pos.y + 7) continue;
				const r = fieldReaction('tornado', p.element, true);
				if (!r) continue;
				if (r.effect === 'ignite' && !t.fire) this.igniteTornado(t);
				else if (r.effect === 'accelerate' && !p.accelerated) {
					p.accelerated = true;
					p.vel.multiplyScalar(r.speedMult ?? 1.5);
					p.damage *= r.damageMult ?? 1.2;
					ctx.vfx.reaction('accelerated', p.pos);
					ctx.numbers.spawn(p.pos, r.name.toUpperCase(), 'reaction');
					ctx.combat.stats.reactions++;
				}
			}
		}
		// World collision.
		_dir.subVectors(p.pos, p.prev);
		const segLen = _dir.length();
		let worldT = Infinity;
		if (segLen > 1e-5) {
			_dir.multiplyScalar(1 / segLen);
			const d = ctx.physics.castStaticNormal(p.prev, _dir, segLen + p.radius * 0.5, _n);
			if (d >= 0) worldT = d / segLen;
		}
		const ground = ctx.world.terrain.heightAt(p.pos.x, p.pos.z);
		// Combatants.
		const hit = ctx.combat.sweep(p.prev, p.pos, p.radius, p.team, p.hits, _seg);
		if (hit && _seg.s <= worldT && _seg.target) {
			const target = _seg.target;
			const point = _seg.point.clone();
			const result = this.hitWith(p, target, point, _seg.hurtbox?.weak ?? 1);
			if (result === 'parried') {
				this.reflect(p);
				return;
			}
			p.hits.add(target.uid);
			if (p.pierce > 0 && result !== 'blocked') {
				p.pierce--;
				ctx.vfx.impact(p.element, point, 0.6 * p.scale);
			} else {
				this.impact(p, point, null, target);
				return;
			}
		}
		if (worldT <= 1) {
			_v.copy(p.prev).addScaledVector(_dir, worldT * segLen);
			this.impact(p, _v, _n, null);
			return;
		}
		if (p.pos.y < ground) {
			ctx.world.terrain.normalAt(p.pos.x, p.pos.z, _n);
			_v.copy(p.pos).setY(ground + 0.05);
			this.impact(p, _v, _n, null);
			return;
		}
		if (p.life <= 0) {
			ctx.vfx.impact(p.element, p.pos, 0.4 * p.scale);
			this.kill(p);
		}
	}

	private hitWith(p: Projectile, target: Combatant, point: THREE.Vector3, weak: number): 'parried' | 'blocked' | 'hit' | null {
		const ctx = this.ctx;
		let hit: HitInfo;
		if (p.team === 'player') {
			hit = ctx.combat.playerHit({
				element: p.element,
				damage: p.damage,
				point,
				dir: p.vel.clone(),
				knockback: p.knockback,
				poise: p.poise,
				heavy: p.heavy,
				status: p.status,
				tags: p.tags,
				spellId: p.spellId,
				weakMult: weak > 1 ? weak : undefined
			});
			hit.power = p.power;
		} else {
			hit = {
				source: 'enemy',
				attacker: p.attacker,
				element: p.element,
				damage: p.damage,
				point,
				dir: p.vel.clone(),
				knockback: p.knockback,
				poise: 0,
				heavy: p.heavy,
				critChance: 0,
				critMult: 1.5,
				status: p.status,
				tags: HitTag.PROJECTILE,
				parryable: p.parryable,
				blockable: p.blockable
			};
		}
		const r = ctx.combat.applyHit(target, hit);
		if (!r) return null;
		if (r.parried) return 'parried';
		if (p.interrupt && !r.blocked && target === ctx.player) {
			ctx.playerCombat.interrupt(false);
			ctx.player.statuses.apply({ id: 'silenced', duration: 1.2 });
		}
		return r.blocked ? 'blocked' : 'hit';
	}

	/** A parried enemy projectile flies back at its caster, empowered. */
	private reflect(p: Projectile): void {
		const ctx = this.ctx;
		const caster = p.attacker;
		p.team = 'player';
		p.attacker = ctx.player;
		p.hits.clear();
		p.life = 2.5;
		p.damage = p.damage * 2.2 + 10;
		p.poise = 60;
		p.heavy = true;
		p.tags = HitTag.PROJECTILE | HitTag.COUNTER;
		p.critChance = 1;
		p.interrupt = false;
		p.power = ctx.player.powerScale();
		const speed = p.vel.length() * 1.4;
		if (caster && caster.alive) {
			caster.aimPoint(_v);
			p.vel.subVectors(_v, p.pos).setLength(speed);
			p.homing = caster;
			p.homingRate = 8;
		} else p.vel.multiplyScalar(-1.4);
		ctx.vfx.releaseProjectile(p.visual);
		p.visual = ctx.vfx.projectile('reflected', p.scale * 1.2);
		p.kind = 'reflected';
		ctx.numbers.spawn(p.pos, 'REFLECTED', 'reaction');
	}

	private impact(p: Projectile, point: THREE.Vector3, normal: THREE.Vector3 | null, direct: Combatant | null): void {
		const ctx = this.ctx;
		ctx.vfx.impact(p.element, point, (p.heavy ? 1.4 : 1) * p.scale * (p.kind === 'iceShard' ? 0.6 : 1), normal ?? undefined);
		ctx.audio.sfx(`impact_${p.element}`, point, { volume: p.team === 'player' ? 0.7 : 0.6, pitch: p.kind === 'iceShard' ? 1.2 : 1 });
		if (p.splash > 0 && p.splashMult > 0) {
			if (p.element === 'fire') this.igniteTornadosNear(point, p.splash);
			ctx.combat.overlap(point, p.splash, p.team, (c) => {
				if (c === direct) return;
				const h = ctx.combat.playerHit({
					element: p.element,
					damage: p.damage * p.splashMult,
					point: c.aimPoint(new THREE.Vector3()),
					dir: new THREE.Vector3().subVectors(c.position, point),
					knockback: p.knockback * 0.5,
					poise: p.poise * 0.5,
					heavy: false,
					status: p.status,
					tags: HitTag.AOE,
					spellId: p.spellId
				});
				ctx.combat.applyHit(c, h);
			});
		}
		this.kill(p);
	}

	private kill(p: Projectile): void {
		p.active = false;
		this.ctx.vfx.releaseProjectile(p.visual);
		p.visual = null;
		this.ctx.vfx.lights.release(p.light);
		p.light = null;
	}

	private stepTornado(t: Tornado, dt: number): void {
		const ctx = this.ctx;
		t.life -= dt;
		if (t.life <= 0) {
			this.endTornado(t);
			return;
		}
		// Drift toward the locked target, otherwise straight ahead; stop at walls.
		const locked = ctx.targeting.locked;
		if (locked && locked.alive) {
			_v.subVectors(locked.position, t.pos).setY(0);
			if (_v.lengthSq() > 1) t.dir.lerp(_v.normalize(), Math.min(1, dt * 1.5)).normalize();
		}
		if (!t.stopped) {
			_v.copy(t.pos).setY(t.pos.y + 1);
			if (ctx.physics.castStatic(_v, t.dir, t.speed * dt + 1.2) >= 0) t.stopped = true;
			else t.pos.addScaledVector(t.dir, t.speed * dt);
		}
		const ground = ctx.world.terrain.heightAt(t.pos.x, t.pos.z);
		const water = ctx.world.terrain.waterLevelAt(t.pos.x, t.pos.z);
		t.pos.y = Math.max(ground, water > -1e6 ? water : ground);
		if (!t.wet && water > ground + 0.2) {
			const r = fieldReaction('tornado', 'water', false);
			if (r) {
				t.wet = true;
				ctx.numbers.spawn(_v.copy(t.pos).setY(t.pos.y + 3), r.name.toUpperCase(), 'reaction');
				ctx.vfx.splash(t.pos, 2);
			}
		}
		const fade = Math.min(1, t.life / 0.5, (t.maxLife - t.life) / 0.25);
		ctx.vfx.tornadoUpdate(t.vfx, t.pos, dt, fade);
		if (t.wet && Math.random() < 0.4) ctx.vfx.splash(_v.copy(t.pos).add(_v2.set((Math.random() - 0.5) * t.radius, 0, (Math.random() - 0.5) * t.radius)), 0.6);
		// Pull and damage.
		_v.copy(t.pos).setY(t.pos.y + 1.2);
		ctx.combat.overlap(_v, t.radius * 1.8, 'player', (c) => {
			const pullable = c as unknown as Partial<Pullable>;
			pullable.pull?.(t.pos, t.pull, t.radius, dt);
		});
		t.tick -= dt;
		if (t.tick <= 0) {
			t.tick = SPELLS.tornado.field!.tick;
			ctx.combat.overlap(_v, t.radius, 'player', (c) => {
				const status: StatusApplication[] = [];
				if (t.fire) status.push({ id: 'burning', duration: 2.5 });
				if (t.wet) status.push({ id: 'wet', duration: 7 });
				const h: HitInfo = ctx.combat.playerHit({
					element: t.fire ? 'fire' : 'wind',
					damage: t.damage,
					point: c.aimPoint(new THREE.Vector3()),
					dir: new THREE.Vector3(),
					knockback: 0,
					poise: SPELLS.tornado.poise,
					heavy: false,
					status,
					tags: HitTag.AOE,
					spellId: 'tornado',
					critChance: 0.05
				});
				ctx.combat.applyHit(c, h);
			});
		}
	}

	/** Per-frame visuals with interpolation. */
	update(dt: number, alpha: number): void {
		for (const p of this.projectiles) {
			if (!p.active || !p.visual) continue;
			_v.lerpVectors(p.prev, p.pos, alpha);
			this.ctx.vfx.trail(p.visual, _v, p.vel, dt);
			if (p.light) p.light.light.position.copy(_v);
		}
	}

	clear(): void {
		for (const p of this.projectiles) if (p.active) this.kill(p);
		for (const t of this.tornados) if (t.active) this.endTornado(t);
		this.scheduled.length = 0;
		for (const m of this.meteors) this.ctx.vfx.releaseProjectile(m.visual);
		this.meteors.length = 0;
		this.ultimateActive = false;
		this.channelStop();
	}

	activeProjectiles(): number {
		return this.projectiles.filter((p) => p.active).length;
	}
}
