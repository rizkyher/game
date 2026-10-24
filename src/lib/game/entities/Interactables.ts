import type { GameContext } from '../core/context';

/** World objects the player can use with E (waystones, chests, crystals, lore, the seal). */
export class Interactables {
	prompt = '';

	constructor(private ctx: GameContext) {}

	interact(): void {
		void this.ctx;
	}

	update(_dt: number): void {}

	dispose(): void {}
}
