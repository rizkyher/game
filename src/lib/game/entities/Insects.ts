import * as THREE from 'three';
import { SimpleBee } from './SimpleBee';
import {
	birdModel,
	butterflyModel,
	dragonflyModel,
	fireflyModel,
	ladybugModel,
	snailModel,
	spiderModel,
	stagBeetleModel,
	type CreatureModel
} from './InsectModels';
import type { FlowerRef } from '../world/Vegetation';

export type Species = 'butterfly' | 'worker' | 'queen' | 'guard' | 'ladybug' | 'stagbeetle' | 'spider' | 'bird' | 'dragonfly' | 'snail' | 'firefly';

export type NPCState = 'idle' | 'wander' | 'interact' | 'flee' | 'chase' | 'return' | 'perch' | 'tumble' | 'dazed';

export const SPECIES_INFO: Record<Species, { name: string; icon: string; desc: string }> = {
	butterfly: { name: 'Meadow Butterfly', icon: '🦋', desc: 'Flutters between flowers. Easily startled.' },
	worker: { name: 'Worker Bee', icon: '🐝', desc: 'Busy, polite, and very tired of your nonsense.' },
	queen: { name: 'Queen Beatrix', icon: '👑', desc: 'Ruler of the hive. Do not bump.' },
	guard: { name: 'Royal Guard', icon: '💂', desc: 'Protects the Queen with extreme prejudice.' },
	ladybug: { name: 'Ladybug', icon: '🐞', desc: 'Wanders the meadow. Lands on its back when bowled over.' },
	stagbeetle: { name: 'Stag Beetle', icon: '🪲', desc: 'Grumpy forest tank. Will charge.' },
	spider: { name: 'Grove Spider', icon: '🕷️', desc: 'Guards its webs. Loves a stuck snack.' },
	bird: { name: 'Robin', icon: '🐦', desc: 'Enormous. Hungry. Chases annoying bees.' },
	dragonfly: { name: 'Dragonfly', icon: '🪰', desc: 'Darts over the pond at ridiculous speed.' },
	snail: { name: 'Garden Snail', icon: '🐌', desc: 'Unhurried. Unimpressed.' },
	firefly: { name: 'Firefly', icon: '✨', desc: 'Glows softly in the shady forest.' }
};

export const TALK_LINES: Partial<Record<Species, string[]>> = {
	worker: [
		'Bzz! Drop nectar in the big glowing cell by the entrance.',
		'The Queen holds court on the top floor. Mind your manners!',
		'Psst... there is a secret way out at the very top of the hive.',
		'Those fairy ring mushrooms? Boing. Trust me.',
		'Golden Pollen orbs are hidden in the silliest places.',
		'Stay away from the honey pool. I was stuck for a WEEK.',
		"Don't annoy the robins. They are SO much bigger than us.",
		'Want a race? Look for the glowing hexagon totems!'
	],
	queen: ['Welcome, little one. Bring the hive nectar and you shall have my favour.', 'My guards are very protective. Very.', 'The meadow, the forest... all of it is ours to pollinate. Buzz along!'],
	snail: ['...', '...hello.', 'Everything is going too fast these days.'],
	ladybug: ['Lovely day for a crawl!', 'Have you seen my spots? I counted them twice.']
};

export class NPC {
	readonly pos = new THREE.Vector3();
	readonly vel = new THREE.Vector3();
	readonly home = new THREE.Vector3();
	readonly target = new THREE.Vector3();
	readonly root = new THREE.Group();
	readonly tilt = new THREE.Group();
	heading = Math.random() * Math.PI * 2;
	state: NPCState = 'idle';
	t = Math.random() * 3;
	radius: number;
	flying: boolean;
	groundOffset = 0;
	spin = 0;
	spinRate = 0;
	cooldown = 0;
	speechCD = 0;
	anger = 0;
	upsideDown = false;
	flower: FlowerRef | null = null;
	phase = 0;
	waypoint = 0;
	inside = false;
	active = true;
	model: CreatureModel | null = null;
	bee: SimpleBee | null = null;
	name: string;
	seed = Math.random() * 100;

	constructor(
		readonly species: Species,
		home: THREE.Vector3,
		color = 0
	) {
		this.home.copy(home);
		this.pos.copy(home);
		this.target.copy(home);
		this.name = SPECIES_INFO[species].name;
		this.root.add(this.tilt);
		this.flying = ['butterfly', 'worker', 'queen', 'guard', 'bird', 'dragonfly', 'firefly'].includes(species);
		this.radius = 1.2;
		switch (species) {
			case 'butterfly': {
				const palettes = [
					[0xff9800, 0x4e342e],
					[0x42a5f5, 0x1a237e],
					[0xffeb3b, 0xff7043],
					[0xf48fb1, 0xab47bc],
					[0xfafafa, 0x90caf9]
				];
				const p = palettes[color % palettes.length];
				this.model = butterflyModel(p[0], p[1]);
				this.radius = 1.6;
				break;
			}
			case 'worker':
				this.bee = new SimpleBee('worker', 0.9);
				break;
			case 'queen':
				this.bee = new SimpleBee('queen', 2.1);
				this.radius = 2.6;
				break;
			case 'guard':
				this.bee = new SimpleBee('guard', 1.25);
				this.radius = 1.5;
				break;
			case 'ladybug':
				this.model = ladybugModel();
				this.radius = 1.3;
				this.groundOffset = 0.25;
				break;
			case 'stagbeetle':
				this.model = stagBeetleModel();
				this.model.root.scale.setScalar(1.3);
				this.radius = 2.4;
				this.groundOffset = 0.3;
				break;
			case 'spider':
				this.model = spiderModel();
				this.radius = 2.4;
				break;
			case 'bird':
				this.model = birdModel();
				this.radius = 3.6;
				this.groundOffset = 4.2;
				break;
			case 'dragonfly':
				this.model = dragonflyModel(color % 2 ? 0x26a69a : 0x5c6bc0);
				this.radius = 1.6;
				break;
			case 'snail':
				this.model = snailModel();
				this.radius = 1.6;
				this.groundOffset = 0.1;
				break;
			case 'firefly':
				this.model = fireflyModel();
				this.radius = 0.8;
				break;
		}
		this.tilt.add(this.model ? this.model.root : this.bee!.root);
		if (species === 'spider') this.flying = false;
		this.state = species === 'bird' ? 'perch' : species === 'queen' ? 'idle' : 'wander';
	}

	get talkable(): boolean {
		return !!TALK_LINES[this.species];
	}

	dispose(): void {
		this.root.removeFromParent();
		this.bee?.dispose();
	}
}
