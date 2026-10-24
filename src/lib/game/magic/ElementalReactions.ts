import type { Combatant, Element, HitInfo, StatusApplication, StatusId } from '../combat/types';
import { HitTag } from '../combat/types';

/** A reaction triggered when a hit lands on a target in a particular state. */
export interface HitReactionDef {
	id: string;
	name: string;
	color: string;
	/** Incoming element(s); omit to match any element. */
	elements?: Element[];
	/** Target must carry at least one of these statuses. */
	requiresAny?: StatusId[];
	/** The hit must be a heavy impact (charged spells, finishers, slams). */
	requiresHeavy?: boolean;
	/** Damage multiplier, optionally depending on which required status was present. */
	damageMult?: number;
	multByStatus?: Partial<Record<StatusId, number>>;
	/** Flat bonus damage (scaled by the attacker's power and `bonusMod`). */
	bonus?: number;
	bonusMod?: 'shatter';
	consume?: StatusId[];
	apply?: StatusApplication[];
	/** Secondary burst around the target. */
	splash?: { radius: number; damageMult: number; element: Element; status?: StatusApplication[]; onlyIf?: StatusId };
	/** Per-target cooldown in seconds. */
	cooldown: number;
	vfx: string;
	sfx: 'reaction_steam' | 'reaction_zap' | 'reaction_shatter';
}

export const HIT_REACTIONS: HitReactionDef[] = [
	{
		id: 'thermal_shock',
		name: 'Thermal Shock',
		color: '#ffb080',
		elements: ['fire'],
		requiresAny: ['frozen', 'chilled'],
		multByStatus: { frozen: 2.2, chilled: 1.5 },
		consume: ['frozen', 'chilled'],
		apply: [{ id: 'wet', duration: 7 }],
		splash: { radius: 2.8, damageMult: 0.4, element: 'fire' },
		cooldown: 0.6,
		vfx: 'thermal_shock',
		sfx: 'reaction_steam'
	},
	{
		id: 'overcharge',
		name: 'Overcharge',
		color: '#8ab8ff',
		elements: ['lightning'],
		requiresAny: ['wet'],
		damageMult: 1.8,
		consume: ['wet'],
		apply: [
			{ id: 'stunned', duration: 1.4 },
			{ id: 'shocked', duration: 4 }
		],
		splash: { radius: 5, damageMult: 0.6, element: 'lightning', status: [{ id: 'stunned', duration: 0.8 }], onlyIf: 'wet' },
		cooldown: 0.5,
		vfx: 'overcharge',
		sfx: 'reaction_zap'
	},
	{
		id: 'shatter',
		name: 'Shatter',
		color: '#bff6ff',
		requiresAny: ['frozen'],
		requiresHeavy: true,
		damageMult: 1.2,
		bonus: 30,
		bonusMod: 'shatter',
		consume: ['frozen', 'chilled'],
		splash: { radius: 3.2, damageMult: 0.5, element: 'ice', status: [{ id: 'chilled', duration: 3 }] },
		cooldown: 0.4,
		vfx: 'shatter',
		sfx: 'reaction_shatter'
	}
];

/** Interactions between active spell fields (tornadoes) and other spells or terrain. */
export interface FieldReactionDef {
	id: string;
	name: string;
	color: string;
	field: 'tornado';
	/** Element of the spell entering the field, or 'water' for terrain. */
	trigger: Element | 'water';
	/** Only for projectiles passing through. */
	projectileOnly?: boolean;
	effect: 'ignite' | 'accelerate' | 'soak';
	speedMult?: number;
	damageMult?: number;
}

export const FIELD_REACTIONS: FieldReactionDef[] = [
	{ id: 'fire_tornado', name: 'Fire Tornado', color: '#ff9a4a', field: 'tornado', trigger: 'fire', effect: 'ignite' },
	{ id: 'accelerated', name: 'Accelerated Spell', color: '#7dffc4', field: 'tornado', trigger: 'ice', projectileOnly: true, effect: 'accelerate', speedMult: 1.6, damageMult: 1.3 },
	{ id: 'accelerated', name: 'Accelerated Spell', color: '#7dffc4', field: 'tornado', trigger: 'lightning', projectileOnly: true, effect: 'accelerate', speedMult: 1.6, damageMult: 1.3 },
	{ id: 'accelerated', name: 'Accelerated Spell', color: '#7dffc4', field: 'tornado', trigger: 'wind', projectileOnly: true, effect: 'accelerate', speedMult: 1.6, damageMult: 1.3 },
	{ id: 'waterspout', name: 'Waterspout', color: '#6ab0ff', field: 'tornado', trigger: 'water', effect: 'soak' }
];

/** Casting any projectile shortly after a Wind Blade rides its tailwind (Accelerated Spell). */
export const TAILWIND = { window: 1.0, speedMult: 1.45, damageMult: 1.2 };

export interface TriggeredReaction {
	def: HitReactionDef;
	/** Status that satisfied the requirement (for status-dependent multipliers). */
	via: StatusId | null;
}

/**
 * Evaluates data-driven reactions against a hit. It adjusts the hit's damage before
 * resolution and reports which reactions fired so the combat system can apply their
 * secondary effects (consumed/applied statuses, splash, VFX, callouts).
 */
export class ReactionSystem {
	private cooldowns = new Map<string, number>();
	/** External scale for Shatter bonus (Shatterpoint skill). */
	shatterMod = () => 1;

	evaluate(hit: HitInfo, target: Combatant, now: number, out: TriggeredReaction[]): void {
		out.length = 0;
		if ((hit.depth ?? 0) > 1 || hit.tags & HitTag.DOT) return;
		for (const def of HIT_REACTIONS) {
			if (def.elements && !def.elements.includes(hit.element)) continue;
			if (def.requiresHeavy && !hit.heavy) continue;
			let via: StatusId | null = null;
			if (def.requiresAny) {
				for (const s of def.requiresAny) {
					if (target.statuses.has(s)) {
						via = s;
						break;
					}
				}
				if (!via) continue;
			}
			const key = `${target.uid}:${def.id}`;
			const ready = this.cooldowns.get(key) ?? -1;
			if (now < ready) continue;
			this.cooldowns.set(key, now + def.cooldown);
			let mult = def.damageMult ?? 1;
			if (def.multByStatus && via && def.multByStatus[via] !== undefined) mult = def.multByStatus[via]!;
			hit.damage *= mult;
			if (def.bonus) {
				hit.damage += def.bonus * (hit.power ?? 1) * (def.bonusMod === 'shatter' ? this.shatterMod() : 1);
			}
			hit.tags |= HitTag.REACTION;
			out.push({ def, via });
		}
	}

	forget(uid: number): void {
		const prefix = `${uid}:`;
		for (const k of this.cooldowns.keys()) if (k.startsWith(prefix)) this.cooldowns.delete(k);
	}

	reset(): void {
		this.cooldowns.clear();
	}
}

/** Looks up a field reaction for something entering a field. */
export function fieldReaction(field: 'tornado', trigger: Element | 'water', projectile: boolean): FieldReactionDef | null {
	for (const r of FIELD_REACTIONS) {
		if (r.field !== field || r.trigger !== trigger) continue;
		if (r.projectileOnly && !projectile) continue;
		return r;
	}
	return null;
}
