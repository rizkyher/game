import type * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { WorldManager } from '../world/WorldManager';
import type { InputManager } from './InputManager';
import type { EventBus } from './EventBus';
import type { UIBridge } from './types';
import type { Settings } from './Settings';
import type { CameraController } from './CameraController';
import type { AudioManager } from '../systems/AudioManager';
import type { MagicVFX } from '../vfx/MagicVFX';
import type { DamageNumbers } from '../vfx/DamageNumbers';
import type { Player } from '../player/PlayerController';
import type { PlayerCombat } from '../player/PlayerCombat';
import type { CombatSystem } from '../combat/CombatSystem';
import type { TargetingSystem } from '../combat/TargetingSystem';
import type { SpellSystem } from '../magic/SpellSystem';
import type { EnemyManager } from '../entities/EnemyManager';
import type { Pickups } from '../entities/Pickups';
import type { Interactables } from '../entities/Interactables';
import type { NPCs } from '../entities/NPC';
import type { BossFight } from '../entities/Boss';
import type { QuestSystem } from '../systems/QuestSystem';
import type { Progression } from '../systems/Progression';
import type { Inventory } from '../systems/Inventory';
import type { SaveSystem } from '../systems/SaveSystem';
import type { PlayerProfile } from '../systems/PlayerProfile';
import type { Combatant, HitInfo, HitResult } from '../combat/types';
import type { RegionId } from '../world/WorldLayout';

export interface GameEvents {
	hit: { target: Combatant; hit: HitInfo; result: HitResult };
	kill: { target: Combatant; hit: HitInfo };
	reaction: { id: string; name: string; target: Combatant; pos: THREE.Vector3 };
	cast: { spellId: string; element: string; projectile: boolean };
	playerHurt: { amount: number; heavy: boolean };
	playerDeath: Record<string, never>;
	levelUp: { level: number };
	item: { id: string; count: number };
	region: { id: RegionId };
	parry: { perfect: boolean; projectile: boolean };
	dodge: { dir: 'left' | 'right' | 'back' | 'forward' };
	bossPhase: { phase: number };
	bossDefeated: Record<string, never>;
	checkpoint: { id: string };
	crystal: { id: string; count: number };
	sealOpened: Record<string, never>;
	talk: { npc: string };
}

/** Time-feel hooks owned by the Game (hit-stop, slow motion, camera shake). */
export interface FeelHooks {
	hitStop(seconds: number): void;
	slowMo(scale: number, seconds: number): void;
	shake(amount: number): void;
	kick(fov: number): void;
}

/** Mode changes other systems may request (dialogue, cutscenes, victory, saving). */
export interface FlowHooks {
	dialogue(open: boolean): void;
	cutscene(on: boolean): void;
	victory(): void;
	save(): boolean;
	isCheckpoint(id: string): boolean;
	setCheckpoint(id: string): void;
}

/** Shared references between systems. Filled in by Game during startup. */
export interface GameContext {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	physics: PhysicsWorld;
	world: WorldManager;
	input: InputManager;
	events: EventBus<GameEvents>;
	ui: UIBridge;
	audio: AudioManager;
	vfx: MagicVFX;
	numbers: DamageNumbers;
	cameraCtl: CameraController;
	player: Player;
	playerCombat: PlayerCombat;
	combat: CombatSystem;
	targeting: TargetingSystem;
	spells: SpellSystem;
	enemies: EnemyManager;
	pickups: Pickups;
	interactables: Interactables;
	npcs: NPCs;
	boss: BossFight;
	quests: QuestSystem;
	progression: Progression;
	inventory: Inventory;
	save: SaveSystem;
	profile: PlayerProfile;
	feel: FeelHooks;
	flow: FlowHooks;
	settings: Settings;
	/** Seconds of simulated (scaled) game time. */
	time: number;
	/** True while the player is actively playing (not menu/paused). */
	playing: boolean;
}
