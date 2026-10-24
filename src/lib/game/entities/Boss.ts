import type { GameContext } from '../core/context';
import type { Combatant } from '../combat/types';
import type { CombatantSource } from '../combat/CombatSystem';
import type { BossHud } from '../core/types';

/** Azrak, the Crystal Tyrant. */
export class BossFight implements CombatantSource {
	active = false;

	constructor(private ctx: GameContext) {
		void this.ctx;
	}

	forEachCombatant(_fn: (c: Combatant) => void): void {}

	fixedUpdate(_dt: number): void {}

	postStep(): void {}

	update(_dt: number, _alpha: number): void {}

	hud(): BossHud | null {
		return null;
	}

	dispose(): void {}
}
