import type * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { QuestHud } from '../core/types';

/** The Broken Seal: quest stages, tracking and objective markers. */
export class QuestSystem {
	constructor(private ctx: GameContext) {
		void this.ctx;
	}

	hud(): QuestHud | null {
		return null;
	}

	objective(): THREE.Vector3 | null {
		return null;
	}

	update(_dt: number): void {}
}
