import { DEFAULT_SETTINGS, type Settings } from '../core/Settings';
import { Progression, type ProgressionData } from './Progression';
import type { PlayerElement } from '../combat/types';

export interface QuestSave {
	stage: number;
	kills: number;
	crystals: string[];
	complete: boolean;
}

export interface SaveData {
	version: 1;
	settings: Settings;
	/** A character exists (Continue is available). */
	hasGame: boolean;
	progression: ProgressionData;
	inventory: Record<string, number>;
	element: PlayerElement;
	quest: QuestSave;
	waystones: string[];
	checkpoint: string;
	opened: string[];
	lore: string[];
	discovered: string[];
	cleared: string[];
	bossDefeated: boolean;
	playTime: number;
	deaths: number;
	savedAt: number;
}

const KEY = 'aetherfall-save-v1';

export function freshGame(settings: Settings): SaveData {
	return {
		version: 1,
		settings: { ...settings },
		hasGame: false,
		progression: Progression.fresh(),
		inventory: { health_potion: 3, mana_potion: 2 },
		element: 'fire',
		quest: { stage: 0, kills: 0, crystals: [], complete: false },
		waystones: ['hollow'],
		checkpoint: 'hollow',
		opened: [],
		lore: [],
		discovered: [],
		cleared: [],
		bossDefeated: false,
		playTime: 0,
		deaths: 0,
		savedAt: 0
	};
}

/** LocalStorage-backed progress. All access is guarded: private mode or full storage just disables saving. */
export class SaveSystem {
	data: SaveData;
	available = true;

	constructor() {
		this.data = this.load();
	}

	private load(): SaveData {
		try {
			const raw = localStorage.getItem(KEY);
			if (!raw) return freshGame(DEFAULT_SETTINGS);
			const parsed = JSON.parse(raw) as Partial<SaveData>;
			const base = freshGame(DEFAULT_SETTINGS);
			return {
				...base,
				...parsed,
				settings: { ...base.settings, ...(parsed.settings ?? {}) },
				progression: { ...base.progression, ...(parsed.progression ?? {}) },
				quest: { ...base.quest, ...(parsed.quest ?? {}) },
				version: 1
			};
		} catch {
			this.available = false;
			return freshGame(DEFAULT_SETTINGS);
		}
	}

	write(): boolean {
		this.data.savedAt = Date.now();
		try {
			localStorage.setItem(KEY, JSON.stringify(this.data));
			this.available = true;
			return true;
		} catch {
			this.available = false;
			return false;
		}
	}

	/** Persist settings without touching game progress. */
	writeSettings(s: Settings): void {
		this.data.settings = { ...s };
		this.write();
	}

	newGame(): void {
		this.data = freshGame(this.data.settings);
		this.data.hasGame = true;
		this.write();
	}

	wipe(): void {
		const settings = this.data.settings;
		this.data = freshGame(settings);
		this.write();
	}
}
