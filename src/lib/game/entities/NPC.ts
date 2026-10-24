import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { DialogueView } from '../core/types';
import { ELDER } from '../world/WorldLayout';
import { dampAngle } from '../utils/math';

/** One page of conversation: lines read in order, optionally ending in choices. */
export interface Conversation {
	speaker: string;
	title: string;
	lines: string[];
	choices?: { id: string; label: string }[];
	onChoose?: (id: string) => void;
	onEnd?: () => void;
}

interface NpcDef {
	id: string;
	name: string;
	title: string;
	x: number;
	z: number;
	yaw: number;
	robe: number;
	trim: number;
	glow: number;
	talk: () => Conversation;
	/** True when this NPC has something new to say (shows the marker). */
	hasNews: () => boolean;
}

/** Procedural robed villager: lathe robe, hood, beard, staff with a lantern crystal. */
class NpcRig {
	readonly root = new THREE.Group();
	private body = new THREE.Group();
	private head = new THREE.Group();
	private armR = new THREE.Group();
	private armL = new THREE.Group();
	readonly marker: THREE.Mesh;
	private lantern: THREE.Mesh;
	private light: THREE.PointLight;
	private t = Math.random() * 10;
	talking = 0;

	constructor(
		def: NpcDef,
		private geos: THREE.BufferGeometry[],
		private mats: THREE.Material[]
	) {
		const g = <T extends THREE.BufferGeometry>(x: T) => (geos.push(x), x);
		const m = <T extends THREE.Material>(x: T) => (mats.push(x), x);
		const robe = m(new THREE.MeshStandardMaterial({ color: def.robe, roughness: 0.85 }));
		const trim = m(new THREE.MeshStandardMaterial({ color: def.trim, roughness: 0.4, metalness: 0.6 }));
		const skin = m(new THREE.MeshStandardMaterial({ color: 0xe8c0a0, roughness: 0.7 }));
		const hair = m(new THREE.MeshStandardMaterial({ color: 0xeeeef4, roughness: 0.9 }));
		const wood = m(new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.8 }));
		const glow = m(new THREE.MeshStandardMaterial({ color: 0x201810, emissive: def.glow, emissiveIntensity: 3 }));
		// Robe silhouette from a lathe profile (wide hem, narrow waist, shoulders).
		const prof = [
			[0.0, 0],
			[0.52, 0],
			[0.46, 0.35],
			[0.36, 0.8],
			[0.3, 1.05],
			[0.34, 1.35],
			[0.3, 1.5],
			[0.12, 1.58],
			[0.0, 1.6]
		].map(([r, y]) => new THREE.Vector2(r, y));
		const robeMesh = new THREE.Mesh(g(new THREE.LatheGeometry(prof, 14)), robe);
		robeMesh.castShadow = true;
		const hem = new THREE.Mesh(g(new THREE.TorusGeometry(0.5, 0.035, 5, 20)), trim);
		hem.rotation.x = Math.PI / 2;
		hem.position.y = 0.05;
		const sash = new THREE.Mesh(g(new THREE.CylinderGeometry(0.31, 0.32, 0.12, 14)), trim);
		sash.position.y = 1.0;
		this.body.add(robeMesh, hem, sash);
		// Head with hood and long beard.
		this.head.position.y = 1.6;
		const face = new THREE.Mesh(g(new THREE.SphereGeometry(0.16, 12, 10)), skin);
		face.position.y = 0.14;
		const hood = new THREE.Mesh(g(new THREE.SphereGeometry(0.21, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62)), robe);
		hood.position.set(0, 0.16, -0.03);
		hood.rotation.x = -0.25;
		const hoodPoint = new THREE.Mesh(g(new THREE.ConeGeometry(0.12, 0.3, 8)), robe);
		hoodPoint.position.set(0, 0.32, -0.16);
		hoodPoint.rotation.x = -1.0;
		const beard = new THREE.Mesh(g(new THREE.ConeGeometry(0.12, 0.42, 8)), hair);
		beard.position.set(0, -0.08, 0.1);
		beard.rotation.x = Math.PI + 0.2;
		const brows = new THREE.Mesh(g(new THREE.BoxGeometry(0.2, 0.03, 0.04)), hair);
		brows.position.set(0, 0.2, 0.14);
		this.head.add(face, hood, hoodPoint, beard, brows);
		this.body.add(this.head);
		// Arms (sleeves) and the staff.
		const sleeve = g(new THREE.CylinderGeometry(0.07, 0.11, 0.62, 8));
		sleeve.translate(0, -0.31, 0);
		for (const [arm, side] of [
			[this.armR, 1],
			[this.armL, -1]
		] as const) {
			arm.position.set(side * 0.33, 1.45, 0);
			const s = new THREE.Mesh(sleeve, robe);
			s.castShadow = true;
			const hand = new THREE.Mesh(g(new THREE.SphereGeometry(0.06, 8, 6)), skin);
			hand.position.y = -0.64;
			arm.add(s, hand);
			this.body.add(arm);
		}
		this.armR.rotation.set(-0.5, 0, 0.12);
		this.armL.rotation.set(-0.1, 0, -0.08);
		const staff = new THREE.Mesh(g(new THREE.CylinderGeometry(0.03, 0.04, 2.1, 6)), wood);
		staff.position.set(0, -0.64, 0);
		staff.rotation.x = 0.5;
		staff.castShadow = true;
		const cage = new THREE.Mesh(g(new THREE.TorusGeometry(0.11, 0.015, 4, 12)), trim);
		this.lantern = new THREE.Mesh(g(new THREE.OctahedronGeometry(0.08, 0)), glow);
		const top = new THREE.Group();
		top.position.y = 1.05;
		top.add(cage, this.lantern);
		staff.add(top);
		this.armR.add(staff);
		this.root.add(this.body);
		this.light = new THREE.PointLight(def.glow, 1.4, 7, 2);
		this.light.position.set(0.45, 2.1, 0.3);
		this.root.add(this.light);
		// Floating quest marker.
		const markMat = m(new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
		this.marker = new THREE.Mesh(g(new THREE.OctahedronGeometry(0.16, 0)), markMat);
		this.marker.scale.set(1, 1.8, 1);
		this.marker.position.y = 2.45;
		this.root.add(this.marker);
	}

	update(dt: number, lookYaw: number | null, news: boolean): void {
		this.t += dt;
		const t = this.t;
		this.talking = Math.max(0, this.talking - dt);
		this.body.position.y = Math.sin(t * 1.6) * 0.012;
		this.body.scale.set(1, 1 + Math.sin(t * 1.6) * 0.008, 1);
		const head = lookYaw ?? Math.sin(t * 0.3) * 0.25;
		this.head.rotation.y = dampAngle(this.head.rotation.y, Math.max(-0.9, Math.min(0.9, head)), 4, dt);
		this.head.rotation.x = Math.sin(t * 0.7) * 0.04 + (this.talking > 0 ? Math.sin(t * 9) * 0.05 : 0);
		// Gesture with the free hand while speaking.
		const gest = this.talking > 0 ? 1 : 0;
		this.armL.rotation.x += (-0.1 - gest * (0.9 + Math.sin(t * 3) * 0.25) - this.armL.rotation.x) * Math.min(1, dt * 5);
		this.armL.rotation.z += (-0.08 - gest * 0.35 - this.armL.rotation.z) * Math.min(1, dt * 5);
		(this.lantern.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.6 + Math.sin(t * 3.1) * 0.6;
		this.lantern.rotation.y = t * 1.5;
		this.light.intensity = 1.2 + Math.sin(t * 3.1) * 0.25;
		this.marker.visible = news;
		if (news) {
			this.marker.position.y = 2.45 + Math.sin(t * 2.5) * 0.08;
			this.marker.rotation.y = t * 1.8;
		}
	}
}

/**
 * Friendly characters in Lumen Hollow and the shared dialogue runner (also used for lore
 * inscriptions). Conversations depend on quest progress.
 */
export class NPCs {
	private rigs: { def: NpcDef; rig: NpcRig; pos: THREE.Vector3 }[] = [];
	private geos: THREE.BufferGeometry[] = [];
	private mats: THREE.Material[] = [];
	private conv: Conversation | null = null;
	private index = 0;

	constructor(private ctx: GameContext) {
		const defs: NpcDef[] = [
			{
				id: 'mirael',
				name: 'Elder Mirael',
				title: 'Keeper of the Lumen Well',
				x: ELDER.x,
				z: ELDER.z,
				yaw: -2.6,
				robe: 0x3a3070,
				trim: 0xd4a64a,
				glow: 0xffc870,
				talk: () => this.mirael(),
				hasNews: () => {
					const q = ctx.save.data.quest;
					return !q.complete && (q.stage === 0 || q.stage === 6);
				}
			},
			{
				id: 'wren',
				name: 'Wren',
				title: 'Lamplighter',
				x: -3,
				z: 243,
				yaw: 0.6,
				robe: 0x6a3a28,
				trim: 0xb08850,
				glow: 0xff9a50,
				talk: () => this.wren(),
				hasNews: () => false
			}
		];
		for (const def of defs) {
			const rig = new NpcRig(def, this.geos, this.mats);
			const y = ctx.world.terrain.heightAt(def.x, def.z);
			const pos = new THREE.Vector3(def.x, y, def.z);
			rig.root.position.copy(pos);
			rig.root.rotation.y = def.yaw;
			ctx.scene.add(rig.root);
			ctx.physics.addCylinder(def.x, y + 0.9, def.z, 0.9, 0.45, { kind: 'static', material: 'wood' });
			this.rigs.push({ def, rig, pos });
			ctx.interactables.register({
				id: `npc-${def.id}`,
				pos,
				radius: 3.2,
				prompt: () => `Talk to ${def.name}`,
				use: () => {
					rig.talking = 99;
					ctx.audio.sfx('talk', pos);
					ctx.events.emit('talk', { npc: def.id });
					this.open(def.talk());
				}
			});
		}
	}

	// ------------------------------------------------------------------ dialogue runner

	/** Show a conversation. Chains seamlessly when one is already open. */
	open(c: Conversation): void {
		const wasOpen = this.conv !== null;
		this.conv = c;
		this.index = 0;
		if (!wasOpen) this.ctx.flow.dialogue(true);
		this.push();
	}

	/** Read-only text (lore tablets). */
	showText(speaker: string, title: string, lines: string[]): void {
		this.open({ speaker, title, lines });
	}

	private push(): void {
		const c = this.conv;
		if (!c) return;
		const view: DialogueView = { speaker: c.speaker, title: c.title, lines: c.lines, index: this.index, choices: c.choices };
		this.ctx.ui.showDialogue(view);
	}

	advance(): void {
		const c = this.conv;
		if (!c) return;
		if (this.index < c.lines.length - 1) {
			this.index++;
			this.ctx.audio.sfx('ui_soft');
			this.push();
			return;
		}
		if (c.choices?.length) return;
		this.close();
	}

	choose(id: string): void {
		const c = this.conv;
		if (!c?.choices?.some((x) => x.id === id)) return;
		this.ctx.audio.sfx('ui_click');
		if (c.onChoose) c.onChoose(id);
		// onChoose may have opened a follow-up page; otherwise the conversation ends.
		if (this.conv === c) this.close();
	}

	close(): void {
		const c = this.conv;
		this.conv = null;
		for (const r of this.rigs) r.rig.talking = Math.min(r.rig.talking, 0.4);
		this.ctx.flow.dialogue(false);
		c?.onEnd?.();
	}

	// ------------------------------------------------------------------ conversations

	private mirael(): Conversation {
		const ctx = this.ctx;
		const q = ctx.save.data.quest;
		const base = { speaker: 'Elder Mirael', title: 'Keeper of the Lumen Well' };
		if (q.complete) {
			return {
				...base,
				lines: [
					'The Well burns brighter than I have seen it in forty winters. That is your doing, Arcanist.',
					'The Sanctuary is quiet now. Walk it whenever you wish. There are still secrets in the old Academy halls, and stranger things in the Highlands.'
				]
			};
		}
		switch (q.stage) {
			case 0:
				return {
					...base,
					lines: [
						'You came. Good. I felt your aether from the other side of the valley. Few Arcanists are left who can hold all four elements at once.',
						'Look north, past the Crossroads. That violet glow is the Broken Seal. For a thousand years it held Azrak, the Crystal Tyrant, beneath the Forgotten Sanctuary.',
						'Now it is cracking. Its corruption seeps into the Eldergrove and twists the creatures there into wraiths.',
						'The Seal was bound with three Arcane Crystals. Corrupted guardians hold them now. Will you recover them and restore the Seal?'
					],
					choices: [
						{ id: 'accept', label: 'I will restore the Seal.' },
						{ id: 'more', label: 'Tell me about the elements.' }
					],
					onChoose: (id) => {
						if (id === 'accept') this.open(this.miraelAccept());
						else this.open(this.miraelElements());
					}
				};
			case 1:
			case 2:
				return {
					...base,
					lines: [
						q.stage === 1
							? 'The Eldergrove lies west of the Crossroads. Follow the road, and do not let the beauty of the glowing woods fool you.'
							: `The forest is still full of corruption. Purge it, Arcanist: ${q.kills}/5 of its creatures have fallen.`,
						'Remember: lock on with Tab, and roll through their claws with Q. A good parry [R] turns their own strength against them.'
					]
				};
			case 3:
				return {
					...base,
					lines: [
						`You carry ${q.crystals.length} of the three Crystals.`,
						'One rests on the Shrine of Verdance, deep in the Eldergrove. One lies on a ledge above Moonwell Falls. The last crowns the Starfall Spire, high in the Arcane Highlands.',
						'Their guardians will not give them up willingly. Defeat them and the corruption around each Crystal will break.'
					]
				};
			case 4:
				return { ...base, lines: ['All three Crystals! I can feel them singing from here.', 'Take them to the Seal Gate, north beyond the Crossroads, and set them in their sockets.'] };
			case 5:
				return {
					...base,
					lines: [
						'The Seal is open. The Sanctuary lies before you, and below it, Azrak.',
						'Beneath the Academy courtyard a stair descends into the Undercroft, and from there to the Crystal Throne. When his crystal heart is exposed, strike it.',
						'Rest at the Academy waystone before you descend.'
					]
				};
			default:
				return {
					...base,
					lines: [
						'It is over. The Tyrant is dust and crystal, and the Seal will never need to hold him again.',
						'The Heart you carry is yours by right. And the Prismatic Ray you learned in that fight is the oldest spell of the Academy. Hold X to channel it, and the four elements will answer as one.',
						'Lumen Hollow owes you its light, Arcanist. Thank you.'
					],
					onEnd: () => ctx.quests.complete()
				};
		}
	}

	private miraelAccept(): Conversation {
		return {
			speaker: 'Elder Mirael',
			title: 'Keeper of the Lumen Well',
			lines: [
				'Then the Well has chosen well. Go west to the Eldergrove first and purge the corruption there, so the Crystals can be reached.',
				'Waystones will mend you and remember your path. Touch every one you find [E]. If you fall, you will wake at the last one.'
			],
			onEnd: () => this.ctx.quests.accept()
		};
	}

	private miraelElements(): Conversation {
		return {
			speaker: 'Elder Mirael',
			title: 'Keeper of the Lumen Well',
			lines: [
				'Fire burns and Ice binds. Lightning leaps between foes. Wind cuts, and gathers into storms.',
				'They answer one another. Strike frozen foes with fire and the ice explodes in Thermal Shock. Lightning on a soaked foe Overcharges.',
				'Fire fed into a whirlwind becomes a firestorm. And a heavy blow on frozen flesh will Shatter it.',
				'Now, will you go?'
			],
			choices: [{ id: 'accept', label: 'I will restore the Seal.' }],
			onChoose: () => this.open(this.miraelAccept())
		};
	}

	private wren(): Conversation {
		const tips = [
			'Evening, traveller. I keep the lanterns lit. Not that the wraiths care for lanterns any more.',
			'Golems hide a glowing core in their chests. It only shows after they swing, so wait them out and then hit it hard.',
			'Those masked mages raise barriers. Lightning tears through them faster than anything else.',
			'Soak something in the river, then hit it with lightning. You will see why the old wardens loved the water.',
			'If your aether gauge fills, press G. Watch the sky when you do.'
		];
		const i = Math.floor((this.ctx.time / 7) % (tips.length - 1)) + 1;
		return { speaker: 'Wren', title: 'Lamplighter', lines: [tips[0], tips[i]] };
	}

	// ------------------------------------------------------------------ per frame

	update(dt: number): void {
		const p = this.ctx.player.position;
		for (const { def, rig, pos } of this.rigs) {
			const dx = p.x - pos.x;
			const dz = p.z - pos.z;
			const d2 = dx * dx + dz * dz;
			if (d2 > 120 * 120) {
				rig.root.visible = false;
				continue;
			}
			rig.root.visible = true;
			let look: number | null = null;
			if (d2 < 10 * 10) {
				// Head turns towards the player (relative to the body's facing).
				look = Math.atan2(dx, dz) - def.yaw;
				look = Math.atan2(Math.sin(look), Math.cos(look));
			}
			rig.update(dt, look, def.hasNews());
		}
	}

	dispose(): void {
		for (const r of this.rigs) this.ctx.scene.remove(r.rig.root);
		for (const g of this.geos) g.dispose();
		for (const m of this.mats) m.dispose();
	}
}
