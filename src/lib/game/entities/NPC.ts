import type { GameContext } from '../core/context';

/** Friendly characters in Lumen Hollow. */
export class NPCs {
	constructor(private ctx: GameContext) {
		void this.ctx;
	}

	advance(): void {}

	choose(_id: string): void {}

	update(_dt: number): void {}

	dispose(): void {}
}
