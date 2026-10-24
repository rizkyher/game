import type { PlayerElement, StatusApplication, Element } from '../combat/types';
import type { ProjectileKind } from '../vfx/MagicVFX';

export type SpellId =
	| 'fireball'
	| 'flame_explosion'
	| 'ice_shards'
	| 'frost_nova'
	| 'lightning_bolt'
	| 'chain_lightning'
	| 'wind_blade'
	| 'tornado'
	| 'prismatic_ray'
	| 'aetherfall';

export type CastType = 'projectile' | 'hitscan' | 'aoe_target' | 'aoe_self' | 'chain' | 'summon' | 'channel' | 'ultimate';
export type SpellSlot = 'basic' | 'special' | 'channel' | 'ultimate';

export interface ProjectileSpec {
	kind: ProjectileKind;
	count: number;
	/** Fan spread between shots (degrees). */
	spread: number;
	speed: number;
	/** Seconds of flight. */
	life: number;
	radius: number;
	pierce: number;
	gravity: number;
	/** Explodes for a fraction of its damage in this radius on impact. */
	splash?: number;
	splashMult?: number;
	/** Turn rate toward the locked target (rad/s). */
	homing?: number;
}

export interface ChargeSpec {
	/** Seconds before a release counts as a cast. */
	min: number;
	/** Seconds to full charge. */
	full: number;
	damage: [number, number];
	radius: [number, number];
}

export interface SpellDef {
	id: SpellId;
	name: string;
	element: Element;
	slot: SpellSlot;
	castType: CastType;
	description: string;
	mana: number;
	cooldown: number;
	damage: number;
	range: number;
	radius: number;
	/** Cast animation phases (seconds): anticipation, release, recovery. */
	windup: number;
	release: number;
	recover: number;
	knockback: number;
	poise: number;
	heavy: boolean;
	status: StatusApplication[];
	projectile?: ProjectileSpec;
	charge?: ChargeSpec;
	/** Area spells: delay before detonation. */
	delay?: number;
	/** Chain lightning. */
	chain?: { jumps: number; range: number; falloff: number };
	/** Persistent fields (tornado): lifetime, travel speed, damage tick interval, pull strength. */
	field?: { duration: number; speed: number; tick: number; pull: number };
}

export const SPELLS: Record<SpellId, SpellDef> = {
	fireball: {
		id: 'fireball',
		name: 'Fireball',
		element: 'fire',
		slot: 'basic',
		castType: 'projectile',
		description: 'Hurls a roaring ball of flame that bursts on impact and sets foes Burning.',
		mana: 7,
		cooldown: 0.36,
		damage: 16,
		range: 55,
		radius: 0.4,
		windup: 0.1,
		release: 0.06,
		recover: 0.2,
		knockback: 3,
		poise: 10,
		heavy: false,
		status: [{ id: 'burning', duration: 2.6 }],
		projectile: { kind: 'fireball', count: 1, spread: 0, speed: 36, life: 1.6, radius: 0.42, pierce: 0, gravity: 0, splash: 2.2, splashMult: 0.4 }
	},
	flame_explosion: {
		id: 'flame_explosion',
		name: 'Flame Explosion',
		element: 'fire',
		slot: 'special',
		castType: 'aoe_target',
		description: 'Charge a sigil at your aim point that erupts in a devastating blast. Heavy impact.',
		mana: 22,
		cooldown: 5,
		damage: 34,
		range: 30,
		radius: 4.5,
		windup: 0,
		release: 0.1,
		recover: 0.32,
		knockback: 11,
		poise: 50,
		heavy: true,
		status: [{ id: 'burning', duration: 3.2, stacks: 2 }],
		charge: { min: 0.25, full: 1.0, damage: [0.7, 1.5], radius: [0.8, 1.25] },
		delay: 0.32
	},
	ice_shards: {
		id: 'ice_shards',
		name: 'Ice Shards',
		element: 'ice',
		slot: 'basic',
		castType: 'projectile',
		description: 'A fan of razor ice that Chills. Three Chills freeze a foe solid.',
		mana: 8,
		cooldown: 0.44,
		damage: 7,
		range: 45,
		radius: 0.25,
		windup: 0.1,
		release: 0.06,
		recover: 0.22,
		knockback: 1.5,
		poise: 6,
		heavy: false,
		status: [{ id: 'chilled', duration: 3.2 }],
		projectile: { kind: 'iceShard', count: 3, spread: 5, speed: 44, life: 1.0, radius: 0.28, pierce: 0, gravity: 0 }
	},
	frost_nova: {
		id: 'frost_nova',
		name: 'Frost Nova',
		element: 'ice',
		slot: 'special',
		castType: 'aoe_self',
		description: 'Release a burst of glacial force around you that Freezes nearby foes.',
		mana: 24,
		cooldown: 7,
		damage: 22,
		range: 0,
		radius: 6.5,
		windup: 0,
		release: 0.1,
		recover: 0.35,
		knockback: 7,
		poise: 35,
		heavy: false,
		status: [{ id: 'frozen', duration: 2.4 }],
		charge: { min: 0.25, full: 0.9, damage: [0.7, 1.4], radius: [0.8, 1.3] }
	},
	lightning_bolt: {
		id: 'lightning_bolt',
		name: 'Lightning Bolt',
		element: 'lightning',
		slot: 'basic',
		castType: 'hitscan',
		description: 'An instant bolt that strikes true and may Shock, making foes take more damage.',
		mana: 9,
		cooldown: 0.5,
		damage: 17,
		range: 60,
		radius: 0.35,
		windup: 0.08,
		release: 0.06,
		recover: 0.24,
		knockback: 2,
		poise: 12,
		heavy: false,
		status: [{ id: 'shocked', duration: 3, chance: 0.6 }]
	},
	chain_lightning: {
		id: 'chain_lightning',
		name: 'Chain Lightning',
		element: 'lightning',
		slot: 'special',
		castType: 'chain',
		description: 'Lightning that leaps from foe to foe, Shocking and briefly stunning them.',
		mana: 22,
		cooldown: 6,
		damage: 26,
		range: 30,
		radius: 0.4,
		windup: 0,
		release: 0.1,
		recover: 0.3,
		knockback: 3,
		poise: 25,
		heavy: false,
		status: [
			{ id: 'shocked', duration: 4 },
			{ id: 'stunned', duration: 0.5, chance: 0.45 }
		],
		charge: { min: 0.25, full: 1.0, damage: [0.7, 1.4], radius: [1, 1] },
		chain: { jumps: 3, range: 9, falloff: 0.85 }
	},
	wind_blade: {
		id: 'wind_blade',
		name: 'Wind Blade',
		element: 'wind',
		slot: 'basic',
		castType: 'projectile',
		description: 'A slicing crescent of air that pierces foes and knocks them back.',
		mana: 6,
		cooldown: 0.32,
		damage: 11,
		range: 32,
		radius: 0.9,
		windup: 0.08,
		release: 0.06,
		recover: 0.18,
		knockback: 8,
		poise: 14,
		heavy: false,
		status: [],
		projectile: { kind: 'windBlade', count: 1, spread: 0, speed: 30, life: 1.0, radius: 0.85, pierce: 2, gravity: 0 }
	},
	tornado: {
		id: 'tornado',
		name: 'Tornado',
		element: 'wind',
		slot: 'special',
		castType: 'summon',
		description: 'Summon a roaming tornado that drags foes in. Fire turns it into a Fire Tornado.',
		mana: 26,
		cooldown: 9,
		damage: 6,
		range: 30,
		radius: 3.2,
		windup: 0,
		release: 0.12,
		recover: 0.32,
		knockback: 0,
		poise: 6,
		heavy: false,
		status: [],
		charge: { min: 0.25, full: 1.0, damage: [0.8, 1.3], radius: [0.85, 1.2] },
		field: { duration: 4.5, speed: 6.5, tick: 0.3, pull: 9 }
	},
	prismatic_ray: {
		id: 'prismatic_ray',
		name: 'Prismatic Ray',
		element: 'arcane',
		slot: 'channel',
		castType: 'channel',
		description: 'Hold to channel a beam of pure Aether that carries your current element. Drains mana.',
		mana: 24,
		cooldown: 1,
		damage: 34,
		range: 32,
		radius: 0.45,
		windup: 0.15,
		release: 0,
		recover: 0.2,
		knockback: 0.6,
		poise: 18,
		heavy: false,
		status: []
	},
	aetherfall: {
		id: 'aetherfall',
		name: 'Aetherfall',
		element: 'arcane',
		slot: 'ultimate',
		castType: 'ultimate',
		description: 'Call down a storm of elemental stars on your target area. Requires a full Aether gauge.',
		mana: 0,
		cooldown: 2,
		damage: 26,
		range: 30,
		radius: 9,
		windup: 0.6,
		release: 2.6,
		recover: 0.4,
		knockback: 8,
		poise: 40,
		heavy: true,
		status: []
	}
};

export const ELEMENT_SPELLS: Record<PlayerElement, { basic: SpellId; special: SpellId; name: string }> = {
	fire: { basic: 'fireball', special: 'flame_explosion', name: 'Fire' },
	ice: { basic: 'ice_shards', special: 'frost_nova', name: 'Ice' },
	lightning: { basic: 'lightning_bolt', special: 'chain_lightning', name: 'Lightning' },
	wind: { basic: 'wind_blade', special: 'tornado', name: 'Wind' }
};

/** Basic-cast combo: the third consecutive cast is a heavier finisher. */
export const COMBO = { window: 0.55, finisherMult: 1.6, finisherScale: 1.4, finisherPoise: 2 };
