import { DEFAULT_SETTINGS, type Settings } from '../core/Settings';

export interface SaveData {
	version: 1;
	settings: Settings;
	bestChaos: number;
	totalChaos: number;
	honey: number;
	totalNectar: number;
	totalPollen: number;
	discovered: string[];
	species: string[];
	orbs: string[];
	achievements: string[];
	tricks: string[];
	challengesDone: string[];
	raceBest: number | null;
	playTime: number;
}

const KEY = 'buzz-mayhem-save-v1';

function fresh(): SaveData {
	return {
		version: 1,
		settings: { ...DEFAULT_SETTINGS },
		bestChaos: 0,
		totalChaos: 0,
		honey: 0,
		totalNectar: 0,
		totalPollen: 0,
		discovered: [],
		species: [],
		orbs: [],
		achievements: [],
		tricks: [],
		challengesDone: [],
		raceBest: null,
		playTime: 0
	};
}

/** LocalStorage-backed progress. All access is guarded: private mode or full storage just disables saving. */
export class SaveSystem {
	data: SaveData;
	private dirty = false;
	private timer = 0;

	constructor() {
		this.data = this.load();
	}

	private load(): SaveData {
		try {
			const raw = localStorage.getItem(KEY);
			if (!raw) return fresh();
			const parsed = JSON.parse(raw) as Partial<SaveData>;
			const base = fresh();
			return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings ?? {}) }, version: 1 };
		} catch {
			return fresh();
		}
	}

	markDirty(): void {
		this.dirty = true;
	}

	/** Adds a unique id to a list; returns true when it was new. */
	addUnique(list: 'discovered' | 'species' | 'orbs' | 'achievements' | 'tricks' | 'challengesDone', id: string): boolean {
		const arr = this.data[list];
		if (arr.includes(id)) return false;
		arr.push(id);
		this.dirty = true;
		return true;
	}

	update(dt: number): void {
		this.data.playTime += dt;
		this.timer += dt;
		if (this.dirty && this.timer > 3) this.flush();
	}

	flush(): void {
		this.timer = 0;
		this.dirty = false;
		try {
			localStorage.setItem(KEY, JSON.stringify(this.data));
		} catch {
			/* storage unavailable */
		}
	}

	reset(): void {
		const settings = this.data.settings;
		this.data = fresh();
		this.data.settings = settings;
		this.flush();
	}
}
