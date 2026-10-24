export type GameMode = 'loading' | 'menu' | 'playing' | 'paused';

export type NoticeKind = 'region' | 'achievement' | 'challenge' | 'discovery' | 'info' | 'trick' | 'warning';

export interface ChallengeHud {
	id: string;
	title: string;
	detail: string;
	progress: number;
	timeLeft: number | null;
	/** Screen-relative bearing to the current objective (radians, 0 = straight ahead). */
	arrow: number | null;
}

export interface HudSnapshot {
	chaos: number;
	combo: number;
	comboTime: number;
	nectar: number;
	nectarCap: number;
	pollen: number;
	honey: number;
	region: string;
	boost: number;
	prompt: string;
	status: string;
	struggle: number;
	held: string;
	challenge: ChallengeHud | null;
	orbs: number;
	orbsTotal: number;
	fps: number;
	heading: number;
	speed: number;
}

export interface UIBridge {
	setMode(mode: GameMode): void;
	setLoading(progress: number, label: string): void;
	updateHud(s: HudSnapshot): void;
	notify(title: string, detail?: string, kind?: NoticeKind): void;
	setLocked(locked: boolean): void;
	toggleMap(open?: boolean): void;
	setGamepad(active: boolean): void;
}
