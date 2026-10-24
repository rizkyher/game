import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { QuestHud } from '../core/types';
import { ARENA, CRYPT, ELDER, GATE, WAYSTONES, regionAt } from '../world/WorldLayout';
import { CRYSTALS } from '../entities/Interactables';

/** Stages of "The Broken Seal". Stored as an index in the save. */
export const QUEST_STAGES = [
	{ id: 'talk', objective: 'Speak with Elder Mirael in Lumen Hollow' },
	{ id: 'forest', objective: 'Travel west to the Eldergrove' },
	{ id: 'purge', objective: 'Purge the corrupted creatures of the forest' },
	{ id: 'crystals', objective: 'Recover the three Arcane Crystals' },
	{ id: 'seal', objective: 'Restore the Broken Seal' },
	{ id: 'azrak', objective: 'Descend to the Crystal Throne and defeat Azrak' },
	{ id: 'return', objective: 'Return to Elder Mirael' }
] as const;

export const PURGE_KILLS = 5;
export const QUEST_REWARD = { exp: 1500, item: 'heart_of_azrak', ability: 'prismatic_ray' } as const;

const FOREST_ENCOUNTERS = ['forest_edge', 'forest_glade', 'forest_deep'];

/**
 * The Broken Seal: stage machine driven by game events (talk, region, kill, crystal, seal,
 * boss), the HUD tracker, the compass objective and a light beacon over the objective.
 */
export class QuestSystem {
	private objPos = new THREE.Vector3();
	private beacon: THREE.Mesh;
	private beaconMat: THREE.ShaderMaterial;
	private checkTimer = 0;

	constructor(private ctx: GameContext) {
		const ev = ctx.events;
		ev.on('region', ({ id }) => {
			if (this.stage === 1 && id === 'forest') this.advance(2);
		});
		ev.on('kill', ({ target }) => {
			if (this.stage !== 2 || !('def' in target)) return;
			const q = this.q;
			q.kills = Math.min(PURGE_KILLS, q.kills + 1);
			if (q.kills >= PURGE_KILLS) this.advance(3);
			else ctx.ui.notify('Corruption purged', `${q.kills}/${PURGE_KILLS} corrupted creatures defeated`, 'quest');
		});
		ev.on('crystal', ({ count }) => {
			if (count >= 3 && this.stage <= 3) this.advance(4);
		});
		ev.on('sealOpened', () => {
			if (this.stage < 5) this.advance(5);
		});
		ev.on('bossDefeated', () => this.onBossDefeated());

		// Pillar of light over the current objective, visible across the map.
		this.beaconMat = new THREE.ShaderMaterial({
			uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(0xffd36a) } },
			vertexShader: /* glsl */ `
				varying vec2 vUv;
				void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
			`,
			fragmentShader: /* glsl */ `
				uniform float uTime;
				uniform float uAlpha;
				uniform vec3 uColor;
				varying vec2 vUv;
				void main() {
					float edge = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 2.0);
					float fade = smoothstep(0.0, 0.08, vUv.y) * (1.0 - vUv.y);
					float flow = 0.75 + 0.25 * sin(vUv.y * 40.0 - uTime * 3.0);
					float a = edge * fade * flow * uAlpha;
					gl_FragColor = vec4(uColor * a * 1.6, a);
				}
			`,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			blending: THREE.CustomBlending,
			blendSrc: THREE.OneFactor,
			blendDst: THREE.OneFactor
		});
		const geo = new THREE.CylinderGeometry(1.4, 1.4, 120, 10, 1, true);
		geo.translate(0, 60, 0);
		this.beacon = new THREE.Mesh(geo, this.beaconMat);
		this.beacon.frustumCulled = false;
		this.beacon.renderOrder = 12;
		ctx.scene.add(this.beacon);
	}

	private get q() {
		return this.ctx.save.data.quest;
	}

	get stage(): number {
		return this.q.stage;
	}

	/** Called by Elder Mirael when the player agrees to help. */
	accept(): void {
		if (this.stage === 0) this.advance(1);
	}

	/** Called by Elder Mirael's final conversation. */
	complete(): void {
		const q = this.q;
		if (q.complete || this.stage < 6) return;
		q.complete = true;
		this.ctx.audio.sfx('quest');
		this.ctx.ui.banner('Quest complete', 'The Broken Seal', 'quest');
		this.ctx.flow.save();
	}

	private advance(stage: number): void {
		const ctx = this.ctx;
		const q = this.q;
		if (stage <= q.stage) return;
		q.stage = stage;
		ctx.audio.sfx('quest');
		ctx.ui.notify('The Broken Seal', QUEST_STAGES[stage].objective, 'quest');
		ctx.progression.addExp([0, 40, 60, 120, 150, 200, 0][stage] ?? 0);
		// Skip stages whose goal is already met (crystals found early, forest already reached).
		if (stage === 1 && regionAt(ctx.player.position.x, ctx.player.position.z) === 'forest') this.advance(2);
		else if (stage === 3 && q.crystals.length >= 3) this.advance(4);
		else if (stage === 4 && ctx.interactables.sealOpen) this.advance(5);
		else if (stage === 5 && ctx.save.data.bossDefeated) this.advance(6);
		ctx.flow.save();
	}

	private onBossDefeated(): void {
		const ctx = this.ctx;
		ctx.save.data.bossDefeated = true;
		ctx.progression.addExp(QUEST_REWARD.exp);
		ctx.inventory.add(QUEST_REWARD.item, 1);
		ctx.progression.unlockAbility(QUEST_REWARD.ability);
		this.advance(Math.max(6, this.stage));
		ctx.flow.save();
	}

	hud(): QuestHud | null {
		const q = this.q;
		if (q.complete) return null;
		const s = QUEST_STAGES[Math.min(q.stage, QUEST_STAGES.length - 1)];
		let progress = '';
		if (q.stage === 2) progress = `${q.kills}/${PURGE_KILLS} defeated`;
		else if (q.stage === 3) progress = `${q.crystals.length}/3 crystals`;
		else if (q.stage === 4) progress = 'Seal Gate, north';
		return { title: 'The Broken Seal', objective: s.objective, progress, complete: false };
	}

	objective(): THREE.Vector3 | null {
		const q = this.q;
		if (q.complete) return null;
		return this.objPos;
	}

	private computeObjective(): void {
		const ctx = this.ctx;
		const q = this.q;
		const p = ctx.player.position;
		const o = this.objPos;
		const at = (x: number, z: number) => o.set(x, ctx.world.terrain.heightAt(x, z), z);
		switch (q.stage) {
			case 0:
			case 6:
				at(ELDER.x, ELDER.z);
				break;
			case 1: {
				const w = WAYSTONES.find((x) => x.id === 'forest')!;
				at(w.x, w.z);
				break;
			}
			case 2: {
				let best = Infinity;
				for (const id of FOREST_ENCOUNTERS) {
					const e = ctx.enemies.encounters.get(id);
					if (!e || e.cleared) continue;
					const d = Math.hypot(e.def.x - p.x, e.def.z - p.z);
					if (d < best) {
						best = d;
						at(e.def.x, e.def.z);
					}
				}
				if (best === Infinity) at(-150, 42);
				break;
			}
			case 3: {
				let best = Infinity;
				for (const c of CRYSTALS) {
					if (q.crystals.includes(c.id)) continue;
					const a = ctx.world.structures.anchors[c.anchor];
					const d = Math.hypot(a.x - p.x, a.z - p.z);
					if (d < best) {
						best = d;
						o.copy(a);
					}
				}
				break;
			}
			case 4:
				at(GATE.x, GATE.z + 5);
				break;
			case 5:
				if (p.z > GATE.z - 4) at(GATE.x, GATE.z - 6);
				else if (p.z > CRYPT.z0 - 1) at(CRYPT.x, CRYPT.z0 + 2);
				else o.set(ARENA.x, ctx.world.structures.anchors.arenaThrone.y, ARENA.z);
				break;
		}
	}

	update(dt: number): void {
		const ctx = this.ctx;
		this.checkTimer -= dt;
		if (this.checkTimer <= 0) {
			this.checkTimer = 0.25;
			this.computeObjective();
		}
		const obj = this.objective();
		const show = !!obj && ctx.playing && !ctx.boss.active;
		const k = this.beaconMat.uniforms;
		k.uTime.value += dt;
		let target = 0;
		if (show && obj) {
			this.beacon.position.copy(obj);
			const d = Math.hypot(obj.x - ctx.player.position.x, obj.z - ctx.player.position.z);
			// Fade out up close so it doesn't swallow the screen.
			target = Math.min(1, Math.max(0, (d - 12) / 30)) * 0.55;
		}
		k.uAlpha.value += (target - k.uAlpha.value) * Math.min(1, dt * 3);
		this.beacon.visible = k.uAlpha.value > 0.01;
	}

	dispose(): void {
		this.ctx.scene.remove(this.beacon);
		this.beacon.geometry.dispose();
		this.beaconMat.dispose();
	}
}
