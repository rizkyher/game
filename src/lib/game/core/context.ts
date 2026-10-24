import type * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { WorldManager } from '../world/WorldManager';
import type { InputManager } from './InputManager';
import type { AudioManager } from '../systems/AudioManager';
import type { Effects } from '../systems/Effects';
import type { ChaosSystem } from '../systems/ChaosSystem';
import type { CollectionSystem } from '../systems/CollectionSystem';
import type { ChallengeSystem } from '../systems/ChallengeSystem';
import type { EnvironmentSystem } from '../systems/EnvironmentSystem';
import type { Achievements } from '../systems/Achievements';
import type { SaveSystem } from '../systems/SaveSystem';
import type { Props } from '../entities/Props';
import type { NPCManager } from '../entities/NPCManager';
import type { BeeController } from '../player/BeeController';
import type { BeeAbilities } from '../player/BeeAbilities';
import type { CameraController } from './CameraController';
import type { ScorePopups } from '../ui/ScorePopups';
import type { UIBridge } from './types';
import type { Interactions } from '../physics/Interactions';

/** Shared references between systems. Filled in by Game during startup. */
export interface GameContext {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	physics: PhysicsWorld;
	world: WorldManager;
	input: InputManager;
	audio: AudioManager;
	effects: Effects;
	chaos: ChaosSystem;
	collection: CollectionSystem;
	challenges: ChallengeSystem;
	env: EnvironmentSystem;
	achievements: Achievements;
	save: SaveSystem;
	props: Props;
	npcs: NPCManager;
	player: BeeController;
	abilities: BeeAbilities;
	cameraCtl: CameraController;
	popups: ScorePopups;
	interactions: Interactions;
	ui: UIBridge;
	/** Seconds of simulated game time. */
	time: number;
	/** True while the player is actively playing (not menu/paused). */
	playing: boolean;
}
