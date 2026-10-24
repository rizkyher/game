import type * as THREE from 'three';
import type { StatusSet } from './StatusEffects';

export type Element = 'fire' | 'ice' | 'lightning' | 'wind' | 'arcane' | 'shadow' | 'crystal' | 'physical';
export const PLAYER_ELEMENTS = ['fire', 'ice', 'lightning', 'wind'] as const;
export type PlayerElement = (typeof PLAYER_ELEMENTS)[number];

export const ELEMENT_COLORS: Record<Element, number> = {
	fire: 0xff6a1a,
	ice: 0x5ae6ff,
	lightning: 0xb8a4ff,
	wind: 0x7dffc4,
	arcane: 0xd8b0ff,
	shadow: 0xb02cff,
	crystal: 0xe070ff,
	physical: 0xffffff
};

export type StatusId = 'burning' | 'chilled' | 'frozen' | 'wet' | 'shocked' | 'stunned' | 'silenced' | 'exposed' | 'ward' | 'counter' | 'haste';

export type Team = 'player' | 'enemy';

/** Bit flags describing how a hit was delivered. */
export const HitTag = {
	PROJECTILE: 1 << 0,
	AOE: 1 << 1,
	CHARGED: 1 << 2,
	COUNTER: 1 << 3,
	DASH: 1 << 4,
	FINISHER: 1 << 5,
	REACTION: 1 << 6,
	DOT: 1 << 7,
	MELEE: 1 << 8,
	BEAM: 1 << 9,
	ULTIMATE: 1 << 10
} as const;

export interface StatusApplication {
	id: StatusId;
	duration: number;
	stacks?: number;
	/** 0..1, defaults to 1. */
	chance?: number;
}

export interface HitInfo {
	source: Team | 'environment';
	attacker: Combatant | null;
	element: Element;
	/** Base damage before crits, defences and reactions. */
	damage: number;
	spellId?: string;
	attackName?: string;
	point: THREE.Vector3;
	/** Direction of travel (for knockback); need not be normalized. */
	dir: THREE.Vector3;
	knockback: number;
	/** Poise (stagger) damage. */
	poise: number;
	/** Heavy impacts can Shatter frozen targets and break guards. */
	heavy: boolean;
	critChance: number;
	critMult: number;
	status?: StatusApplication[];
	tags: number;
	/** Weak-point multiplier when a weak hurtbox was struck (>1). */
	weakMult?: number;
	/** Can this hit be parried / blocked (enemy attacks against the player). */
	parryable?: boolean;
	blockable?: boolean;
	/** Reaction chains stop after a depth to avoid feedback loops. */
	depth?: number;
	/** Attacker's power scale (1 = base); scales status DoTs and reaction bonuses. */
	power?: number;
}

export interface HitResult {
	damage: number;
	crit: boolean;
	killed: boolean;
	weak: boolean;
	blocked: boolean;
	parried: boolean;
	immune: boolean;
	reactions: string[];
}

export interface Hurtbox {
	/** Capsule segment endpoints (a == b for spheres) in world space. */
	a: THREE.Vector3;
	b: THREE.Vector3;
	r: number;
	weak: number;
}

/** Anything that can be hit: the player, regular enemies, the boss, destructible props. */
export interface Combatant {
	readonly uid: number;
	readonly team: Team;
	readonly name: string;
	/** Feet position. */
	readonly position: THREE.Vector3;
	readonly radius: number;
	readonly height: number;
	readonly statuses: StatusSet;
	alive: boolean;
	hp: number;
	maxHp: number;
	level: number;
	/** World-space hurtboxes (refreshed each fixed step). */
	hurtboxes: Hurtbox[];
	/** Damage multiplier per incoming element (weakness > 1, resistance < 1). */
	affinity(el: Element): number;
	defense(): number;
	/** Called by the combat system after damage has been resolved. */
	onHit(hit: HitInfo, result: HitResult): void;
	/** Aim point (centre mass). */
	aimPoint(out: THREE.Vector3): THREE.Vector3;
	/** Invulnerable right now (dodge i-frames, phase transitions). */
	invulnerable(): boolean;
}

let nextUid = 1;
export function newUid(): number {
	return nextUid++;
}
