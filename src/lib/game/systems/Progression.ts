import type { PlayerElement } from '../combat/types';

export type AttrId = 'hp' | 'mana' | 'stamina' | 'power' | 'defense' | 'crit' | 'resist';

export interface AttrDef {
	id: AttrId;
	name: string;
	desc: string;
	base: number;
	perPoint: number;
	/** Automatic growth per character level. */
	perLevel: number;
	unit: string;
	cap?: number;
}

export const ATTRS: AttrDef[] = [
	{ id: 'hp', name: 'Vitality', desc: 'Maximum health.', base: 100, perPoint: 12, perLevel: 6, unit: '' },
	{ id: 'mana', name: 'Wisdom', desc: 'Maximum mana and mana regeneration.', base: 100, perPoint: 10, perLevel: 4, unit: '' },
	{ id: 'stamina', name: 'Endurance', desc: 'Stamina for sprinting, dodging and shielding.', base: 100, perPoint: 10, perLevel: 2, unit: '' },
	{ id: 'power', name: 'Arcana', desc: 'Magic Power: scales all spell damage.', base: 10, perPoint: 2, perLevel: 1, unit: '' },
	{ id: 'defense', name: 'Fortitude', desc: 'Reduces physical and magical damage taken.', base: 5, perPoint: 3, perLevel: 1, unit: '' },
	{ id: 'crit', name: 'Precision', desc: 'Critical hit chance.', base: 5, perPoint: 1.5, perLevel: 0, unit: '%', cap: 60 },
	{ id: 'resist', name: 'Warding', desc: 'Resistance to elemental damage.', base: 0, perPoint: 3, perLevel: 0, unit: '%', cap: 60 }
];

export type Branch = 'pyro' | 'frost' | 'storm';

export interface SkillDef {
	id: string;
	branch: Branch;
	name: string;
	desc: string;
	/** Text per rank (index = rank - 1). */
	ranks: string[];
	tier: number;
	requires?: string;
	level: number;
}

export const BRANCHES: { id: Branch; name: string; element: PlayerElement; blurb: string }[] = [
	{ id: 'pyro', name: 'Pyromancer', element: 'fire', blurb: 'Relentless flame and explosive force.' },
	{ id: 'frost', name: 'Frostweaver', element: 'ice', blurb: 'Control, protection and shattering cold.' },
	{ id: 'storm', name: 'Stormcaller', element: 'lightning', blurb: 'Chains of lightning and howling winds.' }
];

export const SKILLS: SkillDef[] = [
	{ id: 'pyro_searing', branch: 'pyro', name: 'Searing Flames', desc: 'Burning deals more damage.', ranks: ['Burning damage +40%', 'Burning damage +80%'], tier: 1, level: 1 },
	{ id: 'pyro_volatile', branch: 'pyro', name: 'Volatile Core', desc: 'Bigger blasts.', ranks: ['Flame Explosion radius +25%, Fireball splash damage doubled'], tier: 2, requires: 'pyro_searing', level: 3 },
	{ id: 'pyro_phoenix', branch: 'pyro', name: 'Phoenix Heart', desc: 'Fire feeds your spirit.', ranks: ['Fire spells +12% crit chance; fire kills restore 8 mana'], tier: 3, requires: 'pyro_volatile', level: 5 },
	{ id: 'frost_bite', branch: 'frost', name: 'Biting Cold', desc: 'More shards, longer chills.', ranks: ['Ice Shards +1 shard, Chill lasts 25% longer', 'Ice Shards +2 shards, Chill lasts 50% longer'], tier: 1, level: 1 },
	{ id: 'frost_ward', branch: 'frost', name: 'Glacial Ward', desc: 'Frost Nova armours you in ice.', ranks: ['Frost Nova grants a 35-point ward for 6s'], tier: 2, requires: 'frost_bite', level: 3 },
	{ id: 'frost_shatter', branch: 'frost', name: 'Shatterpoint', desc: 'Frozen foes break apart.', ranks: ['Shatter damage +60%; hits on Frozen foes +25% crit damage'], tier: 3, requires: 'frost_ward', level: 5 },
	{ id: 'storm_static', branch: 'storm', name: 'Static Charge', desc: 'Efficient, sharper bolts.', ranks: ['Lightning Bolt cost -15%, damage +12%', 'Lightning Bolt cost -30%, damage +25%'], tier: 1, level: 1 },
	{ id: 'storm_arc', branch: 'storm', name: 'Arc Conduction', desc: 'Lightning leaps further.', ranks: ['Chain Lightning +2 jumps and +3m jump range'], tier: 2, requires: 'storm_static', level: 3 },
	{ id: 'storm_tempest', branch: 'storm', name: 'Tempest', desc: 'Winds that never stop.', ranks: ['Tornado lasts +2s and pulls harder; Wind Blade pierces +2 more foes'], tier: 3, requires: 'storm_arc', level: 5 }
];

/** Aggregated skill/relic modifiers consumed by the spell system. */
export interface Mods {
	burnDamage: number;
	explosionRadius: number;
	fireballSplash: number;
	fireCrit: number;
	fireKillMana: number;
	iceShardsExtra: number;
	chillDuration: number;
	frostWard: number;
	shatterDamage: number;
	frozenCritDamage: number;
	boltCost: number;
	boltDamage: number;
	chainJumps: number;
	chainRange: number;
	tornadoDuration: number;
	tornadoPull: number;
	bladePierce: number;
	elementDamage: Record<PlayerElement, number>;
}

export interface Stats {
	maxHp: number;
	maxMana: number;
	maxStamina: number;
	power: number;
	defense: number;
	/** 0..1 */
	crit: number;
	critMult: number;
	/** 0..1 */
	resist: number;
	manaRegen: number;
	staminaRegen: number;
}

export interface Bonuses {
	hp?: number;
	mana?: number;
	power?: number;
	crit?: number;
	defense?: number;
	resist?: number;
	elementDamage?: Partial<Record<PlayerElement, number>>;
}

export interface ProgressionData {
	level: number;
	exp: number;
	attrPoints: number;
	skillPoints: number;
	attrs: Record<AttrId, number>;
	skills: Record<string, number>;
	abilities: string[];
}

export function expForLevel(level: number): number {
	return Math.round(90 * Math.pow(level, 1.55));
}

export const MAX_LEVEL = 20;

/**
 * Character level, experience, attribute allocation, skill ranks and unlocked abilities.
 * Derived stats and spell modifiers are recomputed only when something changes.
 */
export class Progression {
	data: ProgressionData;
	private statsCache: Stats | null = null;
	private modsCache: Mods | null = null;
	/** External bonuses (relics) supplied by the inventory. */
	bonuses: () => Bonuses = () => ({});
	onLevelUp?: (level: number) => void;
	onChange?: () => void;

	constructor() {
		this.data = Progression.fresh();
	}

	static fresh(): ProgressionData {
		return {
			level: 1,
			exp: 0,
			attrPoints: 0,
			skillPoints: 1,
			attrs: { hp: 0, mana: 0, stamina: 0, power: 0, defense: 0, crit: 0, resist: 0 },
			skills: {},
			abilities: []
		};
	}

	load(d: ProgressionData | undefined): void {
		const base = Progression.fresh();
		this.data = d ? { ...base, ...d, attrs: { ...base.attrs, ...d.attrs }, skills: { ...d.skills }, abilities: [...(d.abilities ?? [])] } : base;
		this.invalidate();
	}

	invalidate(): void {
		this.statsCache = null;
		this.modsCache = null;
		this.onChange?.();
	}

	get level(): number {
		return this.data.level;
	}

	expNext(): number {
		return expForLevel(this.data.level);
	}

	/** Adds experience; returns the number of levels gained. */
	addExp(amount: number): number {
		if (this.data.level >= MAX_LEVEL) return 0;
		this.data.exp += Math.round(amount);
		let gained = 0;
		while (this.data.level < MAX_LEVEL && this.data.exp >= this.expNext()) {
			this.data.exp -= this.expNext();
			this.data.level++;
			this.data.attrPoints += 3;
			this.data.skillPoints += 1;
			gained++;
			this.onLevelUp?.(this.data.level);
		}
		if (this.data.level >= MAX_LEVEL) this.data.exp = 0;
		this.invalidate();
		return gained;
	}

	spendAttr(id: AttrId): boolean {
		if (this.data.attrPoints <= 0) return false;
		const def = ATTRS.find((a) => a.id === id)!;
		if (def.cap !== undefined && this.attrValue(def) + def.perPoint > def.cap) return false;
		this.data.attrs[id]++;
		this.data.attrPoints--;
		this.invalidate();
		return true;
	}

	attrValue(def: AttrDef): number {
		return def.base + def.perPoint * this.data.attrs[def.id] + def.perLevel * (this.data.level - 1);
	}

	rank(id: string): number {
		return this.data.skills[id] ?? 0;
	}

	canLearn(id: string): { ok: boolean; reason: string } {
		const s = SKILLS.find((x) => x.id === id);
		if (!s) return { ok: false, reason: 'Unknown skill' };
		if (this.rank(id) >= s.ranks.length) return { ok: false, reason: 'Mastered' };
		if (this.data.skillPoints <= 0) return { ok: false, reason: 'No skill points' };
		if (this.data.level < s.level) return { ok: false, reason: `Requires level ${s.level}` };
		if (s.requires && this.rank(s.requires) <= 0) return { ok: false, reason: `Requires ${SKILLS.find((x) => x.id === s.requires)!.name}` };
		return { ok: true, reason: '' };
	}

	learn(id: string): boolean {
		if (!this.canLearn(id).ok) return false;
		this.data.skills[id] = this.rank(id) + 1;
		this.data.skillPoints--;
		this.invalidate();
		return true;
	}

	unlockAbility(id: string): boolean {
		if (this.data.abilities.includes(id)) return false;
		this.data.abilities.push(id);
		this.invalidate();
		return true;
	}

	hasAbility(id: string): boolean {
		return this.data.abilities.includes(id);
	}

	stats(): Stats {
		if (this.statsCache) return this.statsCache;
		const b = this.bonuses();
		const v = (id: AttrId) => this.attrValue(ATTRS.find((a) => a.id === id)!);
		const maxMana = v('mana') + (b.mana ?? 0);
		this.statsCache = {
			maxHp: v('hp') + (b.hp ?? 0),
			maxMana,
			maxStamina: v('stamina'),
			power: v('power') + (b.power ?? 0),
			defense: v('defense') + (b.defense ?? 0),
			crit: Math.min(0.75, (v('crit') + (b.crit ?? 0)) / 100),
			critMult: 1.75,
			resist: Math.min(0.6, (v('resist') + (b.resist ?? 0)) / 100),
			manaRegen: 7 + maxMana * 0.04,
			staminaRegen: 30
		};
		return this.statsCache;
	}

	mods(): Mods {
		if (this.modsCache) return this.modsCache;
		const r = (id: string) => this.rank(id);
		const b = this.bonuses();
		const ed = b.elementDamage ?? {};
		this.modsCache = {
			burnDamage: 1 + 0.4 * r('pyro_searing'),
			explosionRadius: r('pyro_volatile') ? 1.25 : 1,
			fireballSplash: r('pyro_volatile') ? 2 : 1,
			fireCrit: r('pyro_phoenix') ? 0.12 : 0,
			fireKillMana: r('pyro_phoenix') ? 8 : 0,
			iceShardsExtra: r('frost_bite'),
			chillDuration: 1 + 0.25 * r('frost_bite'),
			frostWard: r('frost_ward') ? 35 : 0,
			shatterDamage: r('frost_shatter') ? 1.6 : 1,
			frozenCritDamage: r('frost_shatter') ? 0.25 : 0,
			boltCost: 1 - 0.15 * r('storm_static'),
			boltDamage: 1 + 0.125 * r('storm_static'),
			chainJumps: r('storm_arc') ? 2 : 0,
			chainRange: r('storm_arc') ? 3 : 0,
			tornadoDuration: r('storm_tempest') ? 2 : 0,
			tornadoPull: r('storm_tempest') ? 1.6 : 1,
			bladePierce: r('storm_tempest') ? 2 : 0,
			elementDamage: { fire: 1 + (ed.fire ?? 0), ice: 1 + (ed.ice ?? 0), lightning: 1 + (ed.lightning ?? 0), wind: 1 + (ed.wind ?? 0) }
		};
		return this.modsCache;
	}
}
