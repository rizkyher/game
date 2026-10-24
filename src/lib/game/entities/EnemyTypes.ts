import type { Element, StatusApplication } from '../combat/types';
import type { ProjectileKind } from '../vfx/MagicVFX';

export type EnemyKind = 'wraith' | 'golem' | 'mage';

export type AttackKind = 'melee' | 'lunge' | 'shockwave' | 'projectile' | 'aoe' | 'hex';

export interface AttackDef {
	id: string;
	name: string;
	kind: AttackKind;
	/** Distance band in which this attack may be chosen. */
	range: [number, number];
	windup: number;
	active: number;
	recovery: number;
	cooldown: number;
	damage: number;
	element: Element;
	knockback: number;
	heavy: boolean;
	parryable: boolean;
	blockable: boolean;
	weight: number;
	/** Turn rate (rad/s) while winding up, so the enemy tracks but can be outplayed. */
	trackRate: number;
	status?: StatusApplication[];
	melee?: { radius: number; halfAngle: number };
	lunge?: { distance: number; speed: number };
	shockwave?: { radius: number; speed: number; height: number };
	projectile?: { kind: ProjectileKind; speed: number; count: number; interval: number; radius: number; homing: number };
	aoe?: { radius: number; delay: number };
	/** Follow-up attack id chained immediately after this one. */
	chain?: string;
	telegraph: 'none' | 'cone' | 'line' | 'circle' | 'ring';
}

export interface EnemyArchetype {
	kind: EnemyKind;
	name: string;
	title: string;
	level: number;
	hp: number;
	defense: number;
	poise: number;
	staggerTime: number;
	/** 0 = immovable, 1 = full knockback. */
	mass: number;
	runSpeed: number;
	walkSpeed: number;
	turnRate: number;
	radius: number;
	height: number;
	hover: number;
	sight: number;
	leash: number;
	/** Distance the enemy tries to keep from the player. */
	preferred: [number, number];
	affinity: Partial<Record<Element, number>>;
	exp: number;
	loot: { id: string; chance: number }[];
	color: number;
	weak?: { y: number; forward: number; radius: number; mult: number };
	evade?: { chance: number; cooldown: number; distance: number };
	barrier?: { hp: number; duration: number; cooldown: number };
	blink?: { cooldown: number; distance: number; trigger: number };
	attacks: AttackDef[];
}

export const ARCHETYPES: Record<EnemyKind, EnemyArchetype> = {
	wraith: {
		kind: 'wraith',
		name: 'Forest Wraith',
		title: 'Corrupted Spirit',
		level: 2,
		hp: 72,
		defense: 6,
		poise: 32,
		staggerTime: 0.9,
		mass: 1,
		runSpeed: 7.6,
		walkSpeed: 2.4,
		turnRate: 9,
		radius: 0.45,
		height: 2.0,
		hover: 0.35,
		sight: 26,
		leash: 42,
		preferred: [0, 2.2],
		affinity: { fire: 1.5, wind: 0.9 },
		exp: 34,
		loot: [
			{ id: 'health_potion', chance: 0.22 },
			{ id: 'mana_potion', chance: 0.18 }
		],
		color: 0x5affc8,
		evade: { chance: 0.38, cooldown: 2.4, distance: 4.5 },
		attacks: [
			{
				id: 'claw',
				name: 'Rending Claw',
				kind: 'melee',
				range: [0, 2.7],
				windup: 0.42,
				active: 0.12,
				recovery: 0.32,
				cooldown: 1.3,
				damage: 11,
				element: 'shadow',
				knockback: 4,
				heavy: false,
				parryable: true,
				blockable: true,
				weight: 3,
				trackRate: 6,
				melee: { radius: 2.7, halfAngle: 0.95 },
				chain: 'claw2',
				telegraph: 'none'
			},
			{
				id: 'claw2',
				name: 'Rending Claw',
				kind: 'melee',
				range: [0, 0],
				windup: 0.3,
				active: 0.12,
				recovery: 0.55,
				cooldown: 0,
				damage: 13,
				element: 'shadow',
				knockback: 6,
				heavy: false,
				parryable: true,
				blockable: true,
				weight: 0,
				trackRate: 5,
				melee: { radius: 2.8, halfAngle: 1.0 },
				telegraph: 'none'
			},
			{
				id: 'lunge',
				name: 'Spectral Lunge',
				kind: 'lunge',
				range: [4, 10],
				windup: 0.62,
				active: 0.42,
				recovery: 0.6,
				cooldown: 4.2,
				damage: 17,
				element: 'shadow',
				knockback: 8,
				heavy: false,
				parryable: true,
				blockable: true,
				weight: 2,
				trackRate: 4,
				lunge: { distance: 8.5, speed: 20 },
				melee: { radius: 1.6, halfAngle: 1.2 },
				telegraph: 'line'
			}
		]
	},
	golem: {
		kind: 'golem',
		name: 'Crystal Golem',
		title: 'Shard-bound Sentinel',
		level: 4,
		hp: 280,
		defense: 65,
		poise: 140,
		staggerTime: 1.8,
		mass: 0.12,
		runSpeed: 3.4,
		walkSpeed: 1.8,
		turnRate: 2.6,
		radius: 1.0,
		height: 3.2,
		hover: 0,
		sight: 24,
		leash: 36,
		preferred: [0, 3],
		affinity: { lightning: 1.3, wind: 0.6, fire: 0.85 },
		exp: 95,
		loot: [
			{ id: 'health_potion', chance: 0.6 },
			{ id: 'mana_potion', chance: 0.5 }
		],
		color: 0xd070ff,
		weak: { y: 2.0, forward: 0.62, radius: 0.42, mult: 2.4 },
		attacks: [
			{
				id: 'smash',
				name: 'Crystal Smash',
				kind: 'melee',
				range: [0, 3.6],
				windup: 0.95,
				active: 0.16,
				recovery: 1.05,
				cooldown: 2.2,
				damage: 27,
				element: 'crystal',
				knockback: 11,
				heavy: true,
				parryable: true,
				blockable: true,
				weight: 3,
				trackRate: 1.8,
				melee: { radius: 3.8, halfAngle: 1.05 },
				telegraph: 'cone'
			},
			{
				id: 'shockwave',
				name: 'Ground Shockwave',
				kind: 'shockwave',
				range: [0, 10],
				windup: 1.3,
				active: 1.0,
				recovery: 1.3,
				cooldown: 6.5,
				damage: 21,
				element: 'crystal',
				knockback: 9,
				heavy: true,
				parryable: false,
				blockable: true,
				weight: 2,
				trackRate: 0,
				shockwave: { radius: 12, speed: 12, height: 1.0 },
				telegraph: 'ring'
			}
		]
	},
	mage: {
		kind: 'mage',
		name: 'Corrupted Mage',
		title: 'Fallen Scholar',
		level: 3,
		hp: 88,
		defense: 10,
		poise: 26,
		staggerTime: 1.0,
		mass: 0.9,
		runSpeed: 5.4,
		walkSpeed: 2.4,
		turnRate: 7,
		radius: 0.42,
		height: 1.9,
		hover: 0,
		sight: 30,
		leash: 44,
		preferred: [9, 17],
		affinity: { wind: 1.3, shadow: 0.5 },
		exp: 58,
		loot: [
			{ id: 'mana_potion', chance: 0.45 },
			{ id: 'health_potion', chance: 0.25 }
		],
		color: 0xd050ff,
		barrier: { hp: 60, duration: 6, cooldown: 11 },
		blink: { cooldown: 5.5, distance: 8, trigger: 5 },
		attacks: [
			{
				id: 'bolt',
				name: 'Shadow Bolt',
				kind: 'projectile',
				range: [4, 28],
				windup: 0.55,
				active: 0.5,
				recovery: 0.6,
				cooldown: 2.2,
				damage: 9,
				element: 'shadow',
				knockback: 3,
				heavy: false,
				parryable: true,
				blockable: true,
				weight: 3,
				trackRate: 6,
				projectile: { kind: 'shadowBolt', speed: 21, count: 3, interval: 0.18, radius: 0.32, homing: 0.9 },
				telegraph: 'none'
			},
			{
				id: 'void',
				name: 'Void Circle',
				kind: 'aoe',
				range: [5, 24],
				windup: 0.5,
				active: 1.15,
				recovery: 0.7,
				cooldown: 6.5,
				damage: 19,
				element: 'shadow',
				knockback: 6,
				heavy: false,
				parryable: false,
				blockable: true,
				weight: 2,
				trackRate: 5,
				aoe: { radius: 3.2, delay: 1.15 },
				status: [{ id: 'silenced', duration: 0.8 }],
				telegraph: 'circle'
			},
			{
				id: 'hex',
				name: 'Disrupting Hex',
				kind: 'hex',
				range: [3, 26],
				windup: 0.22,
				active: 0.1,
				recovery: 0.5,
				cooldown: 5,
				damage: 6,
				element: 'shadow',
				knockback: 2,
				heavy: false,
				parryable: true,
				blockable: true,
				weight: 0,
				trackRate: 10,
				projectile: { kind: 'hexBolt', speed: 34, count: 1, interval: 0, radius: 0.28, homing: 2.5 },
				telegraph: 'none'
			}
		]
	}
};

export function attackById(a: EnemyArchetype, id: string): AttackDef | undefined {
	return a.attacks.find((x) => x.id === id);
}
