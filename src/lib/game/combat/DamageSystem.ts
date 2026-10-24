import type { Combatant, HitInfo } from './types';

export interface DamageRoll {
	damage: number;
	crit: boolean;
	weak: boolean;
}

/** Elements that elemental resistance applies to. */
const ELEMENTAL = new Set(['fire', 'ice', 'lightning', 'wind', 'arcane', 'shadow', 'crystal']);

/**
 * Pure damage formula. Order: element affinity → weak point → critical → defence (weak
 * points pierce it) → status vulnerability (Shocked, Exposed) → elemental resistance.
 */
export function rollDamage(hit: HitInfo, target: Combatant, opts: { resist?: number; critBonus?: number } = {}): DamageRoll {
	let dmg = hit.damage * target.affinity(hit.element);
	const weak = (hit.weakMult ?? 1) > 1;
	if (weak) dmg *= hit.weakMult!;
	const crit = weak || Math.random() < hit.critChance;
	if (crit) dmg *= hit.critMult + (opts.critBonus ?? 0);
	if (!weak) dmg *= 100 / (100 + Math.max(0, target.defense()));
	dmg *= target.statuses.damageTakenMult();
	if (opts.resist && ELEMENTAL.has(hit.element)) dmg *= 1 - opts.resist;
	return { damage: Math.max(1, Math.round(dmg)), crit, weak };
}
