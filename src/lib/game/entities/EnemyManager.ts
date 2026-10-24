import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Combatant } from '../combat/types';
import { HitTag } from '../combat/types';
import type { CombatantSource } from '../combat/CombatSystem';
import { Enemy } from './Enemy';
import type { AttackDef, EnemyKind } from './EnemyTypes';
import { FALLS_CRYSTAL, LIBRARY, RING, SHRINE, SPIRE, TEMPLE } from '../world/WorldLayout';

export interface EncounterDef {
	id: string;
	x: number;
	z: number;
	spawns: { kind: EnemyKind; dx: number; dz: number; elite?: boolean }[];
	/** Quest guardians stay defeated forever once cleared. */
	persistent?: boolean;
	/** Arena encounters face a fixed direction. */
	yaw?: number;
}

/** Hand-placed groups of foes. Kept apart so only a few groups are ever active at once. */
export const ENCOUNTERS: EncounterDef[] = [
	// Whispering Vale (first fights on the road north)
	{ id: 'vale_road', x: -14, z: 160, spawns: [{ kind: 'wraith', dx: 0, dz: 0 }, { kind: 'wraith', dx: 4, dz: -3 }] },
	{ id: 'crossroads', x: 34, z: 82, spawns: [{ kind: 'wraith', dx: 0, dz: 0 }, { kind: 'mage', dx: 6, dz: -6 }] },
	{ id: 'gate_watch', x: 4, z: -78, spawns: [{ kind: 'wraith', dx: -4, dz: 0 }, { kind: 'wraith', dx: 4, dz: 2 }, { kind: 'mage', dx: 0, dz: -8 }] },
	{ id: 'vale_east', x: 52, z: 10, spawns: [{ kind: 'golem', dx: 0, dz: 0 }] },
	// Enchanted Forest
	{ id: 'forest_edge', x: -92, z: 128, spawns: [{ kind: 'wraith', dx: 0, dz: 0 }, { kind: 'wraith', dx: 5, dz: 3 }] },
	{ id: 'forest_glade', x: -150, z: 182, spawns: [{ kind: 'wraith', dx: 0, dz: 0 }, { kind: 'wraith', dx: -4, dz: 4 }, { kind: 'mage', dx: 6, dz: -4 }] },
	{ id: 'forest_deep', x: -205, z: 40, spawns: [{ kind: 'wraith', dx: 0, dz: 0 }, { kind: 'wraith', dx: 5, dz: 3 }, { kind: 'wraith', dx: -5, dz: 4 }] },
	{
		id: 'shrine_guard',
		x: SHRINE.x,
		z: SHRINE.z,
		persistent: true,
		spawns: [
			{ kind: 'wraith', dx: 6, dz: 4, elite: true },
			{ kind: 'wraith', dx: -6, dz: 5 },
			{ kind: 'wraith', dx: 0, dz: -8 },
			{ kind: 'mage', dx: 9, dz: -6 }
		]
	},
	{
		id: 'falls_guard',
		x: FALLS_CRYSTAL.x + 4,
		z: FALLS_CRYSTAL.z + 6,
		persistent: true,
		spawns: [
			{ kind: 'golem', dx: 0, dz: 0 },
			{ kind: 'wraith', dx: 5, dz: 4 },
			{ kind: 'wraith', dx: -4, dz: 6 }
		]
	},
	// Arcane Highlands
	{ id: 'ramp_sentinel', x: 112, z: 98, spawns: [{ kind: 'golem', dx: 0, dz: 0 }] },
	{ id: 'ring', x: RING.x, z: RING.z, spawns: [{ kind: 'golem', dx: 0, dz: 0, elite: true }, { kind: 'mage', dx: 10, dz: 6 }, { kind: 'mage', dx: -10, dz: -6 }] },
	{
		id: 'spire_guard',
		x: SPIRE.x - 16,
		z: SPIRE.z,
		persistent: true,
		spawns: [
			{ kind: 'golem', dx: 0, dz: 0 },
			{ kind: 'mage', dx: 6, dz: 9 },
			{ kind: 'mage', dx: 6, dz: -9 }
		]
	},
	{ id: 'isles', x: 140, z: -50, spawns: [{ kind: 'mage', dx: 0, dz: 0 }, { kind: 'mage', dx: 8, dz: 5 }] },
	{ id: 'highland_east', x: 250, z: 120, spawns: [{ kind: 'wraith', dx: 0, dz: 0 }, { kind: 'wraith', dx: 4, dz: 4 }, { kind: 'golem', dx: -6, dz: 2 }] },
	// Forgotten Sanctuary
	{ id: 'courtyard', x: 0, z: -176, spawns: [{ kind: 'mage', dx: -8, dz: 0 }, { kind: 'mage', dx: 8, dz: 0 }, { kind: 'wraith', dx: 0, dz: 6 }, { kind: 'wraith', dx: 3, dz: -4 }] },
	{ id: 'temple', x: TEMPLE.x + 8, z: TEMPLE.z + 10, spawns: [{ kind: 'golem', dx: 0, dz: 0 }, { kind: 'mage', dx: -6, dz: -6 }] },
	{ id: 'library', x: LIBRARY.x, z: LIBRARY.z + 10, spawns: [{ kind: 'mage', dx: 0, dz: 0 }, { kind: 'mage', dx: 6, dz: -3, elite: true }] },
	{ id: 'crypt', x: 0, z: -256, spawns: [{ kind: 'wraith', dx: -2, dz: 0 }, { kind: 'wraith', dx: 2, dz: -3 }, { kind: 'mage', dx: 0, dz: -8, elite: true }] }
];

interface EncounterState {
	def: EncounterDef;
	active: boolean;
	cleared: boolean;
	enemies: Enemy[];
}

interface Shockwave {
	center: THREE.Vector3;
	attack: AttackDef;
	owner: Enemy;
	r: number;
	hit: boolean;
	ground: number;
}

const _v = new THREE.Vector3();

/**
 * Spawns encounters near the player, despawns them far away, steers enemies apart, runs
 * shockwaves and tracks which groups are cleared (quest guardians stay cleared).
 */
export class EnemyManager implements CombatantSource {
	readonly enemies: Enemy[] = [];
	readonly encounters = new Map<string, EncounterState>();
	private shockwaves: Shockwave[] = [];
	private scanTimer = 0;
	onEncounterCleared?: (id: string) => void;
	activationRadius = 75;

	constructor(private ctx: GameContext) {
		for (const def of ENCOUNTERS) this.encounters.set(def.id, { def, active: false, cleared: false, enemies: [] });
		ctx.events.on('cast', ({ projectile }) => {
			for (const e of this.enemies) if (e.alive) e.ai.onPlayerCast(projectile);
		});
	}

	forEachCombatant(fn: (c: Combatant) => void): void {
		for (const e of this.enemies) if (e.alive) fn(e);
	}

	spawn(kind: EnemyKind, pos: THREE.Vector3, opts: { encounter?: string; elite?: boolean; yaw?: number } = {}): Enemy {
		const e = new Enemy(this.ctx, kind, pos, opts);
		this.enemies.push(e);
		return e;
	}

	isCleared(id: string): boolean {
		return this.encounters.get(id)?.cleared ?? false;
	}

	/** Restores persistent clears from a save. */
	setCleared(ids: string[]): void {
		for (const id of ids) {
			const s = this.encounters.get(id);
			if (s && s.def.persistent) s.cleared = true;
		}
	}

	clearedPersistent(): string[] {
		return [...this.encounters.values()].filter((s) => s.cleared && s.def.persistent).map((s) => s.def.id);
	}

	/** Resting or dying brings ordinary foes back; quest guardians stay defeated. */
	resetEncounters(): void {
		for (const s of this.encounters.values()) {
			this.despawnEncounter(s);
			if (!s.def.persistent) s.cleared = false;
		}
		this.shockwaves.length = 0;
	}

	engagedCount(): number {
		let n = 0;
		for (const e of this.enemies) if (e.alive && e.ai.engaged && e.ai.dist < 40) n++;
		return n;
	}

	addShockwave(center: THREE.Vector3, attack: AttackDef, owner: Enemy): void {
		this.shockwaves.push({ center, attack, owner, r: 0.8, hit: false, ground: this.ctx.world.terrain.heightAt(center.x, center.z) });
	}

	private spawnEncounter(s: EncounterState): void {
		s.active = true;
		s.enemies = [];
		for (const sp of s.def.spawns) {
			_v.set(s.def.x + sp.dx, 0, s.def.z + sp.dz);
			const yaw = s.def.yaw ?? Math.atan2(this.ctx.player.position.x - _v.x, this.ctx.player.position.z - _v.z);
			s.enemies.push(this.spawn(sp.kind, _v, { encounter: s.def.id, elite: sp.elite, yaw }));
		}
	}

	private despawnEncounter(s: EncounterState): void {
		for (const e of s.enemies) {
			const i = this.enemies.indexOf(e);
			if (i >= 0) this.enemies.splice(i, 1);
			e.dispose();
		}
		s.enemies = [];
		s.active = false;
	}

	private scan(): void {
		const p = this.ctx.player.position;
		for (const s of this.encounters.values()) {
			const d = Math.hypot(s.def.x - p.x, s.def.z - p.z);
			if (!s.active && !s.cleared && d < this.activationRadius) this.spawnEncounter(s);
			else if (s.active) {
				const anyEngaged = s.enemies.some((e) => e.alive && e.ai.engaged);
				if (d > this.activationRadius + 45 && !anyEngaged) {
					this.despawnEncounter(s);
					continue;
				}
				if (!s.cleared && s.enemies.length > 0 && s.enemies.every((e) => !e.alive)) {
					s.cleared = true;
					this.onEncounterCleared?.(s.def.id);
				}
			}
		}
	}

	fixedUpdate(dt: number): void {
		this.scanTimer -= dt;
		if (this.scanTimer <= 0) {
			this.scanTimer = 0.4;
			this.scan();
		}
		for (const e of this.enemies) e.fixedUpdate(dt);
		// Separation: keep living enemies from stacking on one another.
		const list = this.enemies;
		for (let i = 0; i < list.length; i++) {
			const a = list[i];
			if (!a.alive) continue;
			for (let j = i + 1; j < list.length; j++) {
				const b = list[j];
				if (!b.alive) continue;
				const dx = b.position.x - a.position.x;
				const dz = b.position.z - a.position.z;
				const min = a.radius + b.radius + 0.6;
				const d2 = dx * dx + dz * dz;
				if (d2 >= min * min || d2 < 1e-6) continue;
				const d = Math.sqrt(d2);
				const push = ((min - d) / min) * 5;
				const nx = dx / d;
				const nz = dz / d;
				const wa = b.def.mass / (a.def.mass + b.def.mass + 1e-3);
				a.external.x -= nx * push * wa * dt * 10;
				a.external.z -= nz * push * wa * dt * 10;
				b.external.x += nx * push * (1 - wa) * dt * 10;
				b.external.z += nz * push * (1 - wa) * dt * 10;
			}
		}
		this.stepShockwaves(dt);
	}

	private stepShockwaves(dt: number): void {
		const ctx = this.ctx;
		const player = ctx.player;
		for (let i = this.shockwaves.length - 1; i >= 0; i--) {
			const w = this.shockwaves[i];
			const spec = w.attack.shockwave!;
			w.r += spec.speed * dt;
			if (Math.random() < 0.8) {
				const a = Math.random() * Math.PI * 2;
				_v.set(w.center.x + Math.cos(a) * w.r, 0, w.center.z + Math.sin(a) * w.r);
				_v.y = ctx.world.terrain.heightAt(_v.x, _v.z);
				ctx.vfx.dust(_v, 0.25, 0xb8a8c8);
			}
			if (!w.hit && player.alive) {
				const d = Math.hypot(player.position.x - w.center.x, player.position.z - w.center.z);
				const above = player.position.y - ctx.world.terrain.heightAt(player.position.x, player.position.z);
				// Jumping over the wave front avoids it.
				if (Math.abs(d - w.r) < 0.9 && above < spec.height) {
					w.hit = true;
					ctx.combat.applyHit(player, {
						source: 'enemy',
						attacker: w.owner,
						element: w.attack.element,
						damage: w.attack.damage * w.owner.damageMult,
						point: player.aimPoint(new THREE.Vector3()),
						dir: new THREE.Vector3(player.position.x - w.center.x, 0.3, player.position.z - w.center.z),
						knockback: w.attack.knockback,
						poise: 0,
						heavy: true,
						critChance: 0,
						critMult: 1.5,
						tags: HitTag.AOE,
						parryable: false,
						blockable: true,
						attackName: w.attack.name
					});
				}
			}
			if (w.r >= spec.radius) this.shockwaves.splice(i, 1);
		}
	}

	postStep(): void {
		for (const e of this.enemies) e.postStep();
	}

	update(dt: number, alpha: number): void {
		for (let i = this.enemies.length - 1; i >= 0; i--) {
			const e = this.enemies[i];
			e.update(dt, alpha);
			if (e.removed) {
				this.enemies.splice(i, 1);
				e.dispose();
			}
		}
	}

	dispose(): void {
		for (const e of this.enemies) e.dispose();
		this.enemies.length = 0;
	}
}
