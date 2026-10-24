import type { GameMode, HudSnapshot, NoticeKind, UIBridge } from '../game/core/types';

export interface Notice {
	id: number;
	title: string;
	detail: string;
	kind: NoticeKind;
}

const EMPTY_HUD: HudSnapshot = {
	chaos: 0,
	combo: 1,
	comboTime: 0,
	nectar: 0,
	nectarCap: 10,
	pollen: 0,
	honey: 0,
	region: '',
	boost: 1,
	prompt: '',
	status: '',
	struggle: 0,
	held: '',
	challenge: null,
	orbs: 0,
	orbsTotal: 0,
	fps: 0,
	heading: 0,
	speed: 0
};

/**
 * Reactive UI state written by the game at a throttled rate (HUD ~10 Hz).
 * Implements the UIBridge so the game core never imports Svelte.
 */
export class UIState implements UIBridge {
	mode = $state<GameMode>('loading');
	progress = $state(0);
	loadingLabel = $state('Loading');
	hud = $state<HudSnapshot>({ ...EMPTY_HUD });
	notices = $state<Notice[]>([]);
	locked = $state(false);
	mapOpen = $state(false);
	private nextId = 1;

	setMode(mode: GameMode): void {
		this.mode = mode;
		if (mode !== 'playing') this.mapOpen = false;
	}

	setLoading(progress: number, label: string): void {
		this.progress = progress;
		this.loadingLabel = label;
	}

	updateHud(s: HudSnapshot): void {
		// Field-wise assignment so only changed values re-render.
		const h = this.hud;
		for (const k of Object.keys(s) as (keyof HudSnapshot)[]) {
			if (k === 'challenge') continue;
			if (h[k] !== s[k]) (h as unknown as Record<string, unknown>)[k] = s[k];
		}
		const a = h.challenge;
		const b = s.challenge;
		if (!a || !b || a.id !== b.id) h.challenge = b;
		else {
			a.detail = b.detail;
			a.progress = b.progress;
			a.timeLeft = b.timeLeft;
			a.arrow = b.arrow;
		}
	}

	notify(title: string, detail = '', kind: NoticeKind = 'info'): void {
		const id = this.nextId++;
		this.notices = [...this.notices.slice(-4), { id, title, detail, kind }];
		setTimeout(() => {
			this.notices = this.notices.filter((n) => n.id !== id);
		}, kind === 'achievement' ? 5200 : 3800);
	}

	setLocked(locked: boolean): void {
		this.locked = locked;
	}

	toggleMap(open?: boolean): void {
		this.mapOpen = open ?? !this.mapOpen;
	}
}
