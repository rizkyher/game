import type { Element, StatusApplication, StatusId } from './types';

export interface StatusDef {
	id: StatusId;
	name: string;
	/** Short glyph shown on HUD icons. */
	icon: string;
	color: string;
	debuff: boolean;
	maxStacks: number;
	/** Damage per second per stack (scaled by the applier's power). */
	dps?: number;
	dotElement?: Element;
	/** Movement speed multiplier per stack (multiplicative). */
	slow?: number;
	immobilize?: boolean;
	/** Cannot start attacks/casts. */
	noAct?: boolean;
	damageTakenMult?: number;
	/** Converts into another status when max stacks are reached. */
	onMax?: { id: StatusId; duration: number };
	/** Applying this status removes these. */
	clears?: StatusId[];
}

/** Data-driven status catalogue shared by enemies and the player. */
export const STATUS_DEFS: Record<StatusId, StatusDef> = {
	burning: { id: 'burning', name: 'Burning', icon: '🔥', color: '#ff7a2a', debuff: true, maxStacks: 3, dps: 3.5, dotElement: 'fire', clears: ['wet'] },
	chilled: { id: 'chilled', name: 'Chilled', icon: '❄', color: '#7ae8ff', debuff: true, maxStacks: 3, slow: 0.82, onMax: { id: 'frozen', duration: 2.2 } },
	frozen: { id: 'frozen', name: 'Frozen', icon: '🧊', color: '#bff6ff', debuff: true, maxStacks: 1, immobilize: true, noAct: true, clears: ['chilled', 'burning'] },
	wet: { id: 'wet', name: 'Wet', icon: '💧', color: '#5aa8ff', debuff: true, maxStacks: 1, slow: 0.92 },
	shocked: { id: 'shocked', name: 'Shocked', icon: '⚡', color: '#c8b0ff', debuff: true, maxStacks: 1, damageTakenMult: 1.15 },
	stunned: { id: 'stunned', name: 'Stunned', icon: '✦', color: '#fff27a', debuff: true, maxStacks: 1, immobilize: true, noAct: true },
	silenced: { id: 'silenced', name: 'Hexed', icon: '⦸', color: '#d05aff', debuff: true, maxStacks: 1, noAct: true },
	exposed: { id: 'exposed', name: 'Exposed', icon: '◎', color: '#ff5a7a', debuff: true, maxStacks: 1, damageTakenMult: 1.25 },
	ward: { id: 'ward', name: 'Glacial Ward', icon: '⛨', color: '#9af0ff', debuff: false, maxStacks: 1 },
	counter: { id: 'counter', name: 'Counter', icon: '⟲', color: '#ffe08a', debuff: false, maxStacks: 1 },
	haste: { id: 'haste', name: 'Tailwind', icon: '➶', color: '#8affc8', debuff: false, maxStacks: 1, slow: 1.2 }
};

export interface StatusEntry {
	id: StatusId;
	remaining: number;
	duration: number;
	stacks: number;
	/** Damage scaling captured when applied (attacker's power). */
	power: number;
	tick: number;
}

export interface StatusView {
	id: StatusId;
	name: string;
	icon: string;
	color: string;
	debuff: boolean;
	t: number;
	stacks: number;
}

/**
 * Per-combatant active statuses. Durations refresh on re-application and stacks build up
 * to the definition's cap; reaching the cap can convert into another status (Chilled →
 * Frozen). DoTs tick through a callback so the owner routes them into the damage system.
 */
export class StatusSet {
	readonly entries = new Map<StatusId, StatusEntry>();
	/** Multiplier on all incoming durations (bosses shrug off control effects). */
	controlResist = 1;

	apply(app: StatusApplication, power = 1): StatusId | null {
		const def = STATUS_DEFS[app.id];
		if (app.chance !== undefined && Math.random() > app.chance) return null;
		const isControl = def.immobilize || def.noAct || def.slow !== undefined;
		const duration = app.duration * (isControl && def.debuff ? this.controlResist : 1);
		if (duration <= 0.05) return null;
		if (def.clears) for (const c of def.clears) this.entries.delete(c);
		let e = this.entries.get(app.id);
		if (!e) {
			e = { id: app.id, remaining: duration, duration, stacks: 0, power, tick: 0.5 };
			this.entries.set(app.id, e);
		}
		e.stacks = Math.min(def.maxStacks, e.stacks + (app.stacks ?? 1));
		e.remaining = Math.max(e.remaining, duration);
		e.duration = Math.max(e.duration, duration);
		e.power = Math.max(e.power, power);
		if (def.onMax && e.stacks >= def.maxStacks) {
			this.entries.delete(app.id);
			this.apply({ id: def.onMax.id, duration: def.onMax.duration }, power);
			return def.onMax.id;
		}
		return app.id;
	}

	has(id: StatusId): boolean {
		return this.entries.has(id);
	}

	stacks(id: StatusId): number {
		return this.entries.get(id)?.stacks ?? 0;
	}

	remove(id: StatusId): boolean {
		return this.entries.delete(id);
	}

	clear(): void {
		this.entries.clear();
	}

	/** Advances timers; `onDot(damage, element)` is invoked for damage-over-time ticks. */
	update(dt: number, onDot?: (damage: number, element: Element, id: StatusId) => void): void {
		for (const e of this.entries.values()) {
			e.remaining -= dt;
			const def = STATUS_DEFS[e.id];
			if (def.dps && onDot) {
				e.tick -= dt;
				if (e.tick <= 0) {
					e.tick += 0.5;
					onDot(def.dps * 0.5 * e.stacks * e.power, def.dotElement ?? 'physical', e.id);
				}
			}
			if (e.remaining <= 0) this.entries.delete(e.id);
		}
	}

	moveMult(): number {
		let m = 1;
		for (const e of this.entries.values()) {
			const def = STATUS_DEFS[e.id];
			if (def.immobilize) return 0;
			if (def.slow !== undefined) m *= Math.pow(def.slow, e.stacks);
		}
		return m;
	}

	canAct(): boolean {
		for (const e of this.entries.values()) if (STATUS_DEFS[e.id].noAct) return false;
		return true;
	}

	immobilized(): boolean {
		for (const e of this.entries.values()) if (STATUS_DEFS[e.id].immobilize) return true;
		return false;
	}

	damageTakenMult(): number {
		let m = 1;
		for (const e of this.entries.values()) m *= STATUS_DEFS[e.id].damageTakenMult ?? 1;
		return m;
	}

	view(out: StatusView[] = []): StatusView[] {
		out.length = 0;
		for (const e of this.entries.values()) {
			const d = STATUS_DEFS[e.id];
			out.push({ id: e.id, name: d.name, icon: d.icon, color: d.color, debuff: d.debuff, t: Math.max(0, e.remaining / e.duration), stacks: e.stacks });
		}
		return out;
	}
}
