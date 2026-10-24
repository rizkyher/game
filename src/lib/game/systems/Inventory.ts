import type { Bonuses } from './Progression';

export type ItemKind = 'consumable' | 'quest' | 'relic' | 'key';

export interface ItemDef {
	id: string;
	name: string;
	kind: ItemKind;
	desc: string;
	icon: string;
	/** Display colour for the icon frame. */
	color: string;
	stack: number;
	bonus?: Bonuses;
}

export const ITEMS: Record<string, ItemDef> = {
	health_potion: { id: 'health_potion', name: 'Healing Draught', kind: 'consumable', desc: 'Restores 45% of your health. [H]', icon: '❤', color: '#e0485a', stack: 9 },
	mana_potion: { id: 'mana_potion', name: 'Aether Tonic', kind: 'consumable', desc: 'Restores 60% of your mana. [J]', icon: '✦', color: '#4a8aff', stack: 9 },
	arcane_crystal: { id: 'arcane_crystal', name: 'Arcane Crystal', kind: 'quest', desc: 'A shard of the Broken Seal, humming with old power.', icon: '◆', color: '#c08aff', stack: 3 },
	ember_locket: {
		id: 'ember_locket',
		name: 'Emberheart Locket',
		kind: 'relic',
		desc: 'A warm locket from the Hidden Grotto. Fire damage +12%.',
		icon: '❂',
		color: '#ff8a3a',
		stack: 1,
		bonus: { elementDamage: { fire: 0.12 } }
	},
	frost_charm: {
		id: 'frost_charm',
		name: 'Frostbloom Charm',
		kind: 'relic',
		desc: 'A flower of ice that never melts. Ice damage +12%, +10 max mana.',
		icon: '❄',
		color: '#6ae0ff',
		stack: 1,
		bonus: { elementDamage: { ice: 0.12 }, mana: 10 }
	},
	storm_lens: {
		id: 'storm_lens',
		name: 'Stormglass Lens',
		kind: 'relic',
		desc: 'Ground from a lightning-struck crystal. Lightning damage +10%, crit +4%.',
		icon: '◎',
		color: '#b8a4ff',
		stack: 1,
		bonus: { elementDamage: { lightning: 0.1 }, crit: 4 }
	},
	grove_sigil: {
		id: 'grove_sigil',
		name: 'Grovewarden Sigil',
		kind: 'relic',
		desc: 'Bark-bound seal of the forest wardens. +20 max health, Wind damage +10%.',
		icon: '✿',
		color: '#7dffc4',
		stack: 1,
		bonus: { hp: 20, elementDamage: { wind: 0.1 } }
	},
	scholar_quill: {
		id: 'scholar_quill',
		name: "Archmage's Quill",
		kind: 'relic',
		desc: 'Its ink still glows. +3 Magic Power, +5% elemental resistance.',
		icon: '✒',
		color: '#ffd070',
		stack: 1,
		bonus: { power: 3, resist: 5 }
	},
	heart_of_azrak: {
		id: 'heart_of_azrak',
		name: 'Heart of Azrak',
		kind: 'relic',
		desc: "The Tyrant's crystal core, now calm. +25 max mana, +25 max health, +3 defense.",
		icon: '♦',
		color: '#e070ff',
		stack: 1,
		bonus: { mana: 25, hp: 25, defense: 3 }
	},
	tome_insight: { id: 'tome_insight', name: 'Tome of Insight', kind: 'key', desc: 'Reading it grants a skill point.', icon: '📖', color: '#ffe08a', stack: 9 }
};

/** Counts of owned items; relics contribute passive bonuses while held. */
export class Inventory {
	items: Record<string, number> = {};
	onChange?: () => void;

	load(items: Record<string, number> | undefined): void {
		this.items = { ...(items ?? {}) };
		this.onChange?.();
	}

	count(id: string): number {
		return this.items[id] ?? 0;
	}

	/** Adds up to the stack limit; returns how many were actually added. */
	add(id: string, n = 1): number {
		const def = ITEMS[id];
		if (!def) return 0;
		const before = this.count(id);
		const after = Math.min(def.stack, before + n);
		this.items[id] = after;
		if (after !== before) this.onChange?.();
		return after - before;
	}

	remove(id: string, n = 1): boolean {
		if (this.count(id) < n) return false;
		this.items[id] -= n;
		if (this.items[id] <= 0) delete this.items[id];
		this.onChange?.();
		return true;
	}

	list(): { def: ItemDef; count: number }[] {
		return Object.entries(this.items)
			.filter(([id, n]) => n > 0 && ITEMS[id])
			.map(([id, n]) => ({ def: ITEMS[id], count: n }))
			.sort((a, b) => kindOrder(a.def.kind) - kindOrder(b.def.kind));
	}

	bonuses(): Bonuses {
		const out: Bonuses = { elementDamage: {} };
		for (const { def } of this.list()) {
			const b = def.bonus;
			if (!b) continue;
			out.hp = (out.hp ?? 0) + (b.hp ?? 0);
			out.mana = (out.mana ?? 0) + (b.mana ?? 0);
			out.power = (out.power ?? 0) + (b.power ?? 0);
			out.crit = (out.crit ?? 0) + (b.crit ?? 0);
			out.defense = (out.defense ?? 0) + (b.defense ?? 0);
			out.resist = (out.resist ?? 0) + (b.resist ?? 0);
			for (const [el, v] of Object.entries(b.elementDamage ?? {})) {
				const ed = out.elementDamage!;
				ed[el as keyof typeof ed] = (ed[el as keyof typeof ed] ?? 0) + (v ?? 0);
			}
		}
		return out;
	}
}

function kindOrder(k: ItemKind): number {
	return k === 'consumable' ? 0 : k === 'quest' ? 1 : k === 'key' ? 2 : 3;
}
