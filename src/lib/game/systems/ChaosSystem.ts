import type * as THREE from 'three';
import type { GameContext } from '../core/context';

export const TRICKS: Record<string, { name: string; base: number }> = {
	bonk: { name: 'Bonk!', base: 20 },
	cup_tip: { name: 'Cup Tipper', base: 60 },
	topple: { name: 'Tower Toppler', base: 80 },
	domino: { name: 'Domino Effect', base: 40 },
	chain: { name: 'Chain Reaction', base: 50 },
	insect_bowl: { name: 'Insect Bowling', base: 90 },
	fruit_drop: { name: 'Fruit Dropper', base: 70 },
	pollen_bomb: { name: 'Pollen Bomb', base: 35 },
	thief: { name: 'Sticky Fingers', base: 40 },
	yeet: { name: 'Yeet!', base: 60 },
	bird_annoy: { name: 'Bird Brain', base: 120 },
	honey_stuck: { name: 'Sticky Situation', base: 50 },
	smash: { name: 'Smash!', base: 110 },
	balloon_pop: { name: 'Balloon Popper', base: 90 },
	splash: { name: 'Cannonball!', base: 70 },
	web_wreck: { name: 'Web Wrecker', base: 100 },
	bounce: { name: 'Boing!', base: 30 },
	ground_pound: { name: 'Ground Pound', base: 90 },
	queen_bump: { name: 'Royal Offense', base: 250 },
	sting: { name: 'Stinger', base: 45 },
	squeak: { name: 'Squeaky Clean', base: 50 },
	barrel_roll: { name: 'Barrel Roll', base: 15 },
	close_call: { name: 'Close Call', base: 150 },
	dandelion: { name: 'Dandelion Blast', base: 40 },
	gnome: { name: 'Gnome Tipper', base: 160 },
	shove: { name: 'Heavy Shove', base: 45 },
	spider_bump: { name: 'Arachno-Bonk', base: 110 },
	escape: { name: 'Great Escape', base: 60 }
};

const COMBO_WINDOW = 3.5;

/**
 * Chaos score with combo multipliers. Repeating the same trick quickly is worth less;
 * discovering a new trick type gives a one-time bonus.
 */
export class ChaosSystem {
	score = 0;
	comboCount = 0;
	comboTimer = 0;
	bestMultiplier = 1;
	private comboPoints = 0;
	private recent = new Map<string, number>();

	constructor(private ctx: GameContext) {}

	get multiplier(): number {
		return Math.min(8, 1 + Math.floor(this.comboCount / 3));
	}

	add(id: string, pos: THREE.Vector3 | null, scale = 1): number {
		const ctx = this.ctx;
		const trick = TRICKS[id];
		if (!trick || !ctx.playing) return 0;
		// Diminishing returns for spamming the same trick.
		const last = this.recent.get(id) ?? -100;
		const rep = ctx.time - last < 2.5 ? 0.35 : ctx.time - last < 8 ? 0.7 : 1;
		this.recent.set(id, ctx.time);

		const prevMult = this.multiplier;
		this.comboCount++;
		this.comboTimer = COMBO_WINDOW;
		const mult = this.multiplier;
		let pts = Math.max(5, Math.round(trick.base * scale * rep * mult));
		if (ctx.save.addUnique('tricks', id)) {
			pts += 100;
			ctx.ui.notify(`New Trick: ${trick.name}`, '+100 discovery bonus', 'trick');
			if (ctx.save.data.tricks.length >= 12) ctx.achievements.unlock('trickster');
		}
		this.score += pts;
		this.comboPoints += pts;
		ctx.save.data.totalChaos += pts;
		if (this.score > ctx.save.data.bestChaos) ctx.save.data.bestChaos = this.score;
		ctx.save.markDirty();
		if (pos) ctx.popups.show(`${trick.name} +${pts}`, pos, 'chaos');
		if (mult > prevMult) {
			ctx.audio.play('combo', { pitch: 1 + mult * 0.08 });
			if (pos) ctx.popups.show(`x${mult} COMBO!`, pos.clone().setY(pos.y + 1.6), 'combo', 1.6);
		}
		if (mult > this.bestMultiplier) this.bestMultiplier = mult;
		if (mult >= 5) ctx.achievements.unlock('combo_king');
		if (this.score >= 1000) ctx.achievements.unlock('chaos_rookie');
		if (this.score >= 20000) ctx.achievements.unlock('chaos_legend');
		ctx.challenges.onChaos(pts, mult);
		return pts;
	}

	update(dt: number): void {
		if (this.comboTimer > 0) {
			this.comboTimer -= dt;
			if (this.comboTimer <= 0) {
				if (this.comboCount >= 6) {
					const bonus = Math.round(this.comboPoints * 0.15);
					this.score += bonus;
					this.ctx.popups.show(`Combo Bonus +${bonus}`, this.ctx.player.position.clone().setY(this.ctx.player.position.y + 2), 'combo', 2);
				}
				this.comboCount = 0;
				this.comboPoints = 0;
			}
		}
	}
}
