import type { StatusView } from '../combat/StatusEffects';
import type { PlayerElement } from '../combat/types';

export type GameMode = 'loading' | 'menu' | 'playing' | 'paused' | 'panel' | 'dialogue' | 'dead' | 'victory' | 'cutscene';

export type PanelId = 'character' | 'skills' | 'map' | 'settings' | 'controls';

export type NoticeKind = 'info' | 'item' | 'quest' | 'level' | 'warning' | 'lore' | 'reaction';

export interface SpellSlotHud {
	element: PlayerElement;
	basicName: string;
	specialName: string;
	basicCost: number;
	specialCost: number;
	/** 0..1 remaining cooldown fraction. */
	basicCd: number;
	specialCd: number;
	specialCdSec: number;
}

export interface TargetHud {
	name: string;
	level: number;
	hp: number;
	maxHp: number;
	statuses: StatusView[];
	locked: boolean;
	shield: number;
	elite: boolean;
}

export interface BossHud {
	name: string;
	title: string;
	hp: number;
	maxHp: number;
	phase: number;
	phases: number[];
	shield: number;
	broken: boolean;
}

export interface QuestHud {
	title: string;
	objective: string;
	progress: string;
	complete: boolean;
}

export interface HudSnapshot {
	hp: number;
	hpMax: number;
	mana: number;
	manaMax: number;
	stamina: number;
	staminaMax: number;
	ward: number;
	level: number;
	exp: number;
	expNext: number;
	aether: number;
	element: PlayerElement;
	spells: SpellSlotHud[];
	/** -1 when not charging, else 0..1. */
	charge: number;
	channelUnlocked: boolean;
	channeling: boolean;
	shielding: boolean;
	counter: boolean;
	ultimateReady: boolean;
	statuses: StatusView[];
	target: TargetHud | null;
	boss: BossHud | null;
	quest: QuestHud | null;
	prompt: string;
	region: string;
	heading: number;
	/** Bearing of the current objective relative to the camera (radians) or null. */
	objectiveBearing: number | null;
	objectiveDist: number;
	fps: number;
	potions: number;
	manaPotions: number;
	combo: number;
	inCombat: boolean;
	skillPoints: number;
	attrPoints: number;
	lowMana: boolean;
}

export interface DialogueView {
	speaker: string;
	title: string;
	lines: string[];
	index: number;
	choices?: { id: string; label: string }[];
}

export interface UIBridge {
	setMode(mode: GameMode): void;
	setLoading(progress: number, label: string): void;
	updateHud(s: HudSnapshot): void;
	notify(title: string, detail?: string, kind?: NoticeKind): void;
	banner(title: string, subtitle: string, kind: 'region' | 'level' | 'quest' | 'boss' | 'victory' | 'discovery'): void;
	setLocked(locked: boolean): void;
	openPanel(panel: PanelId | null): void;
	showDialogue(d: DialogueView | null): void;
	setGamepad(active: boolean): void;
	/** Bumps a counter so open panels re-read game state. */
	refresh(): void;
}
