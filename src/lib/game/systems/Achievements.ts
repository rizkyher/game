import type { SaveSystem } from './SaveSystem';
import type { UIBridge } from '../core/types';
import type { AudioManager } from './AudioManager';

export interface AchievementDef {
	id: string;
	name: string;
	desc: string;
	icon: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
	{ id: 'first_flight', name: 'First Flight', desc: 'Fly 200 meters.', icon: '🐝' },
	{ id: 'chaos_rookie', name: 'Chaos Rookie', desc: 'Earn 1,000 chaos in one session.', icon: '💥' },
	{ id: 'chaos_legend', name: 'Chaos Legend', desc: 'Earn 20,000 chaos in one session.', icon: '🌪️' },
	{ id: 'combo_king', name: 'Combo King', desc: 'Reach a x5 chaos multiplier.', icon: '👑' },
	{ id: 'picnic_wrecker', name: 'Picnic Wrecker', desc: 'Knock over every picnic cup.', icon: '🧺' },
	{ id: 'domino_master', name: 'Domino Master', desc: 'Trigger a chain reaction of 6 objects.', icon: '🁢' },
	{ id: 'sticky_business', name: 'Sticky Business', desc: 'Get stuck in honey.', icon: '🍯' },
	{ id: 'bird_brained', name: 'Bird Brained', desc: 'Survive a bird chase.', icon: '🐦' },
	{ id: 'explorer', name: 'Explorer', desc: 'Visit every region.', icon: '🧭' },
	{ id: 'hive_mind', name: 'Hive Mind', desc: 'Explore every hive chamber.', icon: '🏠' },
	{ id: 'nectar_ninja', name: 'Nectar Ninja', desc: 'Deliver 25 nectar to the hive.', icon: '🌼' },
	{ id: 'collector', name: 'Golden Collector', desc: 'Find every Golden Pollen orb.', icon: '✨' },
	{ id: 'entomologist', name: 'Entomologist', desc: 'Discover every species.', icon: '🔎' },
	{ id: 'royal_audience', name: 'Royal Audience', desc: 'Greet the Queen.', icon: '🤴' },
	{ id: 'treason', name: 'High Treason', desc: 'Bump the Queen. Rude.', icon: '😱' },
	{ id: 'speed_demon', name: 'Speed Demon', desc: 'Finish the Meadow Dash under 70 seconds.', icon: '⚡' },
	{ id: 'splash_zone', name: 'Splash Zone', desc: 'Cannonball into water.', icon: '💦' },
	{ id: 'balloon_popper', name: 'Balloon Popper', desc: 'Pop a balloon.', icon: '🎈' },
	{ id: 'trickster', name: 'Trickster', desc: 'Discover 12 different chaos tricks.', icon: '🎭' }
];

export class Achievements {
	constructor(
		private save: SaveSystem,
		private ui: UIBridge,
		private audio: AudioManager
	) {}

	has(id: string): boolean {
		return this.save.data.achievements.includes(id);
	}

	unlock(id: string): void {
		const def = ACHIEVEMENTS.find((a) => a.id === id);
		if (!def) return;
		if (!this.save.addUnique('achievements', id)) return;
		this.ui.notify(`${def.icon} ${def.name}`, def.desc, 'achievement');
		this.audio.play('fanfare');
	}
}
