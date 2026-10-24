import type { DialogueView, GameMode, HudSnapshot, NoticeKind, PanelId, UIBridge } from '../game/core/types';

export interface Notice {
	id: number;
	title: string;
	detail: string;
	kind: NoticeKind;
}

export interface Banner {
	id: number;
	title: string;
	subtitle: string;
	kind: 'region' | 'level' | 'quest' | 'boss' | 'victory' | 'discovery';
}

const EMPTY_HUD: HudSnapshot = {
	hp: 100,
	hpMax: 100,
	mana: 100,
	manaMax: 100,
	stamina: 100,
	staminaMax: 100,
	ward: 0,
	level: 1,
	exp: 0,
	expNext: 90,
	aether: 0,
	element: 'fire',
	spells: [],
	charge: -1,
	channelUnlocked: false,
	channeling: false,
	shielding: false,
	counter: false,
	ultimateReady: false,
	statuses: [],
	target: null,
	boss: null,
	quest: null,
	prompt: '',
	region: '',
	heading: 0,
	objectiveBearing: null,
	objectiveDist: 0,
	fps: 0,
	potions: 0,
	manaPotions: 0,
	combo: 0,
	inCombat: false,
	skillPoints: 0,
	attrPoints: 0,
	lowMana: false
};

/**
 * Reactive UI state written by the game at a throttled rate (HUD ~10 Hz). Implements the
 * UIBridge so the game core never imports Svelte.
 */
export class UIState implements UIBridge {
	mode = $state<GameMode>('loading');
	progress = $state(0);
	loadingLabel = $state('Loading');
	hud = $state<HudSnapshot>({ ...EMPTY_HUD });
	notices = $state<Notice[]>([]);
	banners = $state<Banner[]>([]);
	locked = $state(false);
	panel = $state<PanelId | null>(null);
	dialogue = $state<DialogueView | null>(null);
	gamepad = $state(false);
	revision = $state(0);
	private nextId = 1;

	setMode(mode: GameMode): void {
		this.mode = mode;
		if (mode !== 'panel' && mode !== 'paused') this.panel = null;
	}

	setLoading(progress: number, label: string): void {
		this.progress = progress;
		this.loadingLabel = label;
	}

	updateHud(s: HudSnapshot): void {
		// Field-wise assignment so only changed values re-render.
		const h = this.hud as unknown as Record<string, unknown>;
		for (const k of Object.keys(s) as (keyof HudSnapshot)[]) {
			const v = s[k] as unknown;
			if (typeof v === 'object' && v !== null) {
				if (JSON.stringify(h[k]) !== JSON.stringify(v)) h[k] = v;
			} else if (h[k] !== v) h[k] = v;
		}
	}

	notify(title: string, detail = '', kind: NoticeKind = 'info'): void {
		const id = this.nextId++;
		this.notices = [...this.notices.slice(-3), { id, title, detail, kind }];
		setTimeout(
			() => {
				this.notices = this.notices.filter((n) => n.id !== id);
			},
			kind === 'quest' || kind === 'level' ? 6000 : 4200
		);
	}

	banner(title: string, subtitle: string, kind: Banner['kind']): void {
		const id = this.nextId++;
		this.banners = [...this.banners.filter((b) => b.kind !== kind).slice(-1), { id, title, subtitle, kind }];
		setTimeout(
			() => {
				this.banners = this.banners.filter((b) => b.id !== id);
			},
			kind === 'boss' || kind === 'victory' ? 4800 : 3600
		);
	}

	setLocked(locked: boolean): void {
		this.locked = locked;
	}

	openPanel(panel: PanelId | null): void {
		this.panel = panel;
	}

	showDialogue(d: DialogueView | null): void {
		this.dialogue = d;
	}

	setGamepad(active: boolean): void {
		if (this.gamepad !== active) this.gamepad = active;
	}

	refresh(): void {
		this.revision++;
	}
}
