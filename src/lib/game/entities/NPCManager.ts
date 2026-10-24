import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { NPC, SPECIES_INFO, TALK_LINES, type Species } from './Insects';
import { HIVE, LANDMARKS, isInsideHive, landmark } from '../world/Biomes';
import { Random } from '../utils/Random';
import { clamp, damp, dampAngle, dampFactor } from '../utils/math';
import { disposeInsectMaterials } from './InsectModels';
import { SimpleBee } from './SimpleBee';
import type { FlowerRef } from '../world/Vegetation';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const ACTIVE_RANGE = 240;
/** Creatures are simulated within ACTIVE_RANGE but only drawn this close (birds are big). */
const DRAW_RANGE = 150;
const DRAW_RANGE_BIG = 320;
const FLOOR_HOLES = [0, 11, 9, 6.5, 0];

/** Height of the hive floor directly below a point (floors have central shaft holes). */
function hiveFloorBelow(p: THREE.Vector3): number {
	const h = p.y - HIVE.baseY;
	const r = Math.hypot(p.x - HIVE.x, p.z - HIVE.z);
	const levels = [0, ...HIVE.levels];
	for (let i = levels.length - 1; i >= 0; i--) {
		if (levels[i] <= h && r > FLOOR_HOLES[i]) return HIVE.baseY + levels[i];
	}
	return HIVE.baseY;
}

/**
 * Owns all creatures and runs their small state machines (idle / wander / interact /
 * flee / chase / return / tumble / dazed). Movement is kinematic with simple steering;
 * bumps send creatures tumbling with a cartoon ballistic arc.
 */
export class NPCManager {
	readonly list: NPC[] = [];
	private discoverTimer = 0;
	private flowerTmp: FlowerRef[] = [];
	private guardAlert = 0;
	private rng = new Random(616);

	constructor(private ctx: GameContext) {
		const t = ctx.world.terrain;
		const f = ctx.world.features.info;
		const hive = ctx.world.hive.info;
		const add = (s: Species, home: THREE.Vector3, color = 0) => {
			const n = new NPC(s, home, color);
			this.list.push(n);
			ctx.scene.add(n.root);
			return n;
		};
		const ground = (x: number, z: number, lift: number) => new THREE.Vector3(x, t.heightAt(x, z) + lift, z);
		const rng = this.rng;
		// Butterflies across the meadow landmarks.
		const meadowSpots = LANDMARKS.filter((l) => l.region === 'meadow');
		for (let i = 0; i < 18; i++) {
			const l = meadowSpots[i % meadowSpots.length];
			const x = l.x + rng.range(-40, 40);
			const z = l.z + rng.range(-40, 40);
			add('butterfly', ground(x, z, 8), i);
		}
		for (let i = 0; i < 6; i++) {
			const n = add('worker', hive.entranceOutside.clone().add(new THREE.Vector3(rng.range(-6, 6), rng.range(0, 6), rng.range(-6, 6))));
			n.phase = 0;
		}
		for (let i = 0; i < 7; i++) {
			const wp = hive.waypoints[(i * 3) % hive.waypoints.length];
			const n = add('worker', wp.clone());
			n.inside = true;
			n.waypoint = i * 3;
		}
		const queen = add('queen', hive.throne.clone().setY(hive.throne.y + 4.6));
		queen.state = 'idle';
		for (const s of [-1, 1]) {
			const g = add('guard', hive.throne.clone().add(new THREE.Vector3(s * 6, 5, s * 3)));
			g.inside = true;
			g.state = 'idle';
		}
		const bugSpots = [landmark('picnic'), landmark('garden'), landmark('roses'), { x: 30, z: 120 }, landmark('sunflowers')];
		for (let i = 0; i < 9; i++) {
			const l = bugSpots[i % bugSpots.length];
			add('ladybug', ground(l.x + rng.range(-25, 25), l.z + rng.range(-25, 25), 0.25));
		}
		const forestSpots = [landmark('elderTree'), landmark('fairyRing'), landmark('hollowLog'), landmark('hollowTree')];
		for (let i = 0; i < 5; i++) {
			const l = forestSpots[i % forestSpots.length];
			add('stagbeetle', ground(l.x + rng.range(-30, 30), l.z + rng.range(-30, 30), 0.3));
		}
		for (let i = 0; i < f.spiderHomes.length; i += 2) {
			const n = add('spider', f.spiderHomes[i].clone());
			n.state = 'idle';
		}
		f.birdPerches.slice(0, 2).forEach((p) => {
			const b = add('bird', p.clone().setY(p.y + 4.2));
			b.state = 'perch';
		});
		const pond = t.pond;
		for (let i = 0; i < 5; i++) add('dragonfly', new THREE.Vector3(pond.x + rng.range(-30, 30), t.pondLevel + rng.range(3, 8), pond.z + rng.range(-30, 30)), i);
		for (const l of [landmark('garden'), { x: -150, z: 170 }, { x: 60, z: -130 }]) add('snail', ground(l.x + rng.range(-10, 10), l.z + rng.range(-10, 10), 0.1));
		const glowSpots = [landmark('hollowTree'), landmark('spiderGrove'), landmark('fairyRing')];
		for (let i = 0; i < 15; i++) {
			const l = glowSpots[i % glowSpots.length];
			add('firefly', ground(l.x + rng.range(-20, 20), l.z + rng.range(-20, 20), rng.range(3, 12)));
		}
		for (const n of this.list) n.root.position.copy(n.pos);
	}

	update(dt: number): void {
		const ctx = this.ctx;
		const pp = ctx.player.position;
		if (this.guardAlert > 0) this.guardAlert -= dt;
		for (const n of this.list) {
			const range = n.state === 'chase' ? 1e9 : ACTIVE_RANGE;
			const d2 = n.pos.distanceToSquared(pp);
			const active = d2 < range * range;
			if (active !== n.active) n.active = active;
			const draw = active && d2 < (n.species === 'bird' || n.species === 'queen' ? DRAW_RANGE_BIG * DRAW_RANGE_BIG : DRAW_RANGE * DRAW_RANGE);
			if (draw !== n.root.visible) n.root.visible = draw;
			if (!active) continue;
			if (n.cooldown > 0) n.cooldown -= dt;
			if (n.speechCD > 0) n.speechCD -= dt;
			n.t -= dt;
			if (n.state === 'tumble') this.tumble(n, dt);
			else if (n.state === 'dazed') this.dazed(n, dt);
			else this.think(n, dt);
			this.animate(n, dt);
		}
		this.discoverTimer -= dt;
		if (this.discoverTimer <= 0) {
			this.discoverTimer = 0.5;
			for (const n of this.list) {
				if (n.active && n.pos.distanceToSquared(pp) < 16 * 16) ctx.collection.discoverSpecies(n.species);
			}
		}
	}

	// ---------------------------------------------------------------- behaviours
	private think(n: NPC, dt: number): void {
		switch (n.species) {
			case 'butterfly':
				return this.butterfly(n, dt);
			case 'worker':
				return n.inside ? this.workerInside(n, dt) : this.workerOutside(n, dt);
			case 'queen':
				return this.queen(n, dt);
			case 'guard':
				return this.guard(n, dt);
			case 'ladybug':
			case 'snail':
				return this.crawler(n, dt, n.species === 'snail' ? 0.5 : 1.8, n.species === 'snail' ? 10 : 22);
			case 'stagbeetle':
				return this.beetle(n, dt);
			case 'spider':
				return this.spider(n, dt);
			case 'bird':
				return this.bird(n, dt);
			case 'dragonfly':
				return this.dragonfly(n, dt);
			case 'firefly':
				return this.firefly(n, dt);
		}
	}

	private steer(n: NPC, target: THREE.Vector3, speed: number, rate: number, dt: number): number {
		_v.copy(target).sub(n.pos);
		const d = _v.length();
		const s = d < 3 ? speed * (d / 3) : speed;
		if (d > 0.001) _v.multiplyScalar(s / d);
		const k = dampFactor(rate, dt);
		n.vel.x += (_v.x - n.vel.x) * k;
		n.vel.y += (_v.y - n.vel.y) * k;
		n.vel.z += (_v.z - n.vel.z) * k;
		n.pos.addScaledVector(n.vel, dt);
		return d;
	}

	private fleeFrom(n: NPC, from: THREE.Vector3, speed: number, dt: number): void {
		_w.copy(n.pos).sub(from);
		_w.y = n.flying ? Math.abs(_w.y) + 2 : 0;
		_w.normalize().multiplyScalar(10).add(n.pos);
		this.steer(n, _w, speed, 4, dt);
	}

	private keepAboveGround(n: NPC, minAlt: number): void {
		if (isInsideHive(n.pos.x, n.pos.y, n.pos.z)) return;
		const g = this.ctx.world.terrain.heightAt(n.pos.x, n.pos.z);
		if (n.pos.y < g + minAlt) {
			n.pos.y = g + minAlt;
			if (n.vel.y < 0) n.vel.y = 0;
		}
	}

	private stickToGround(n: NPC): void {
		n.pos.y = this.ctx.world.terrain.heightAt(n.pos.x, n.pos.z) + n.groundOffset;
		n.vel.y = 0;
	}

	private playerNearFast(n: NPC, r: number): boolean {
		const p = this.ctx.player;
		return n.pos.distanceToSquared(p.position) < r * r && p.velocity.lengthSq() > 100;
	}

	private pickFlower(n: NPC, around: THREE.Vector3, radius: number): FlowerRef | null {
		const veg = this.ctx.world.vegetation;
		this.flowerTmp.length = 0;
		veg.flowers.query(around.x, around.z, radius, (f) => {
			if (this.flowerTmp.length < 40 && veg.isFlowerVisible(f)) this.flowerTmp.push(f);
		});
		if (!this.flowerTmp.length) return null;
		return this.flowerTmp[Math.floor(Math.random() * this.flowerTmp.length)];
	}

	private butterfly(n: NPC, dt: number): void {
		if (n.state !== 'flee' && this.playerNearFast(n, 6)) {
			n.state = 'flee';
			n.t = 2;
		}
		if (n.state === 'flee') {
			this.fleeFrom(n, this.ctx.player.position, 9, dt);
			if (n.t <= 0) n.state = 'wander';
		} else if (n.state === 'interact') {
			n.vel.multiplyScalar(0.8);
			if (n.t <= 0) {
				n.state = 'wander';
				n.flower = null;
			}
		} else {
			if (!n.flower || n.t < -12) {
				n.flower = this.pickFlower(n, n.home, 70);
				n.t = 0;
				if (n.flower) n.target.set(n.flower.x, n.flower.y + n.flower.r * 0.3 + 0.5, n.flower.z);
				else n.target.copy(n.home).add(_v.set(Math.random() * 40 - 20, Math.random() * 6, Math.random() * 40 - 20));
			}
			_w.copy(n.target);
			_w.y += Math.sin(this.ctx.time * 3 + n.seed) * 1.2;
			const d = this.steer(n, _w, 5.5, 2.5, dt);
			if (d < 1.2) {
				n.state = 'interact';
				n.t = 2.5 + Math.random() * 4;
			}
		}
		this.keepAboveGround(n, 1.5);
	}

	private workerOutside(n: NPC, dt: number): void {
		const hive = this.ctx.world.hive.info;
		if (n.state === 'flee') {
			this.fleeFrom(n, this.ctx.player.position, 12, dt);
			if (n.t <= 0) n.state = 'wander';
			this.keepAboveGround(n, 1.5);
			return;
		}
		// Phases: 0 to flower, 1 collect, 2 to porch, 3 through entrance, 4 to deposit,
		// 5 deposit, 6 back to entrance, 7 out to porch. Routing through the entrance keeps
		// the (collision-free) workers from clipping through the dome.
		switch (n.phase) {
			case 0: {
				if (!n.flower) {
					n.flower = this.pickFlower(n, hive.entranceOutside, 150);
					if (!n.flower) return;
					n.target.set(n.flower.x, n.flower.y + 0.9, n.flower.z);
				}
				if (this.steer(n, n.target, 10, 2.5, dt) < 1.2) {
					n.phase = 1;
					n.t = 3 + Math.random() * 2;
				}
				break;
			}
			case 1:
				n.vel.multiplyScalar(0.85);
				if (Math.random() < dt * 4) this.ctx.effects.emit('pollen', n.pos, 1, 0.4);
				if (n.t <= 0) n.phase = 2;
				break;
			case 2:
				if (this.steer(n, hive.entranceOutside, 11, 2.5, dt) < 3) n.phase = 3;
				break;
			case 3:
				if (this.steer(n, hive.entrance, 7, 3, dt) < 2) n.phase = 4;
				break;
			case 4:
				if (this.steer(n, hive.nectarDeposit, 6, 3, dt) < 1.5) {
					n.phase = 5;
					n.t = 2.5;
				}
				break;
			case 5:
				n.vel.multiplyScalar(0.85);
				if (n.t <= 0) n.phase = 6;
				break;
			case 6:
				if (this.steer(n, hive.entrance, 6, 3, dt) < 2) n.phase = 7;
				break;
			case 7:
				if (this.steer(n, hive.entranceOutside, 8, 3, dt) < 3) {
					n.phase = 0;
					n.flower = null;
				}
				break;
		}
		if (!isInsideHive(n.pos.x, n.pos.y, n.pos.z)) this.keepAboveGround(n, 1.5);
	}

	private workerInside(n: NPC, dt: number): void {
		const wps = this.ctx.world.hive.info.waypoints;
		if (n.state === 'flee') {
			this.fleeFrom(n, this.ctx.player.position, 9, dt);
			if (n.t <= 0) n.state = 'wander';
		} else {
			const wp = wps[n.waypoint % wps.length];
			if (this.steer(n, wp, 5, 2, dt) < 1.5) {
				n.waypoint = (n.waypoint + 1 + Math.floor(Math.random() * 3)) % wps.length;
			}
		}
		this.confineToHive(n);
	}

	private confineToHive(n: NPC): void {
		const dx = n.pos.x - HIVE.x;
		const dz = n.pos.z - HIVE.z;
		const d = Math.hypot(dx, dz);
		const max = 20;
		if (d > max) {
			n.pos.x = HIVE.x + (dx / d) * max;
			n.pos.z = HIVE.z + (dz / d) * max;
		}
		n.pos.y = clamp(n.pos.y, HIVE.baseY + 2, HIVE.baseY + HIVE.levels[3] - 2);
	}

	private queen(n: NPC, dt: number): void {
		n.vel.multiplyScalar(0.9);
		n.pos.lerp(n.home, dampFactor(1.5, dt));
		n.pos.y = n.home.y + Math.sin(this.ctx.time * 1.6) * 0.25;
	}

	private guard(n: NPC, dt: number): void {
		const ctx = this.ctx;
		const p = ctx.player.position;
		if (n.state === 'chase') {
			const d = this.steer(n, p, 19, 3.5, dt);
			this.keepAboveGround(n, 1.5);
			if (d < n.radius + 1.2) {
				_v.copy(p).sub(n.pos).setY(0).normalize();
				ctx.player.launch(_v.x * 22, 12, _v.z * 22, 0.6);
				ctx.player.stun(0.8);
				this.say(n, 'Out you go!', true);
				ctx.audio.play('thud');
				ctx.cameraCtl.shake(0.5);
				n.state = 'return';
			} else if (n.t <= 0 || this.guardAlert <= 0) n.state = 'return';
		} else if (n.state === 'return') {
			if (this.steer(n, n.home, 9, 3, dt) < 2) n.state = 'idle';
		} else {
			_w.copy(n.home);
			_w.x += Math.sin(ctx.time * 0.6 + n.seed) * 3;
			_w.z += Math.cos(ctx.time * 0.5 + n.seed) * 3;
			this.steer(n, _w, 3, 2, dt);
		}
	}

	private crawler(n: NPC, dt: number, speed: number, range: number): void {
		if (n.state === 'flee') {
			this.fleeFrom(n, this.ctx.player.position, speed * 2.2, dt);
			if (n.t <= 0) n.state = 'wander';
		} else if (n.state === 'idle') {
			n.vel.multiplyScalar(0.8);
			if (n.t <= 0) {
				n.state = 'wander';
				n.target.copy(n.home).add(_v.set(Math.random() * range * 2 - range, 0, Math.random() * range * 2 - range));
				n.t = 12;
			}
		} else {
			_w.copy(n.target);
			if (this.steer(n, _w, speed, 3, dt) < 1.5 || n.t <= 0) {
				n.state = 'idle';
				n.t = 1 + Math.random() * 4;
			}
			if (n.species === 'ladybug' && this.playerNearFast(n, 5)) {
				n.state = 'flee';
				n.t = 2;
			}
		}
		this.stickToGround(n);
	}

	private beetle(n: NPC, dt: number): void {
		const ctx = this.ctx;
		const p = ctx.player.position;
		const ground = ctx.world.terrain.heightAt(n.pos.x, n.pos.z);
		const near = n.pos.distanceTo(p) < 9 && p.y - ground < 4;
		if (n.state === 'chase') {
			_w.set(p.x, n.pos.y, p.z);
			this.steer(n, _w, 7, 5, dt);
			if (n.pos.distanceTo(p) < n.radius + 1) {
				_v.copy(p).sub(n.pos).setY(0).normalize();
				ctx.player.launch(_v.x * 16, 14, _v.z * 16, 0.5);
				ctx.player.stun(0.5);
				this.say(n, 'CHOMP!', true);
				ctx.audio.play('bump', { pitch: 0.6 });
				n.state = 'idle';
				n.t = 6;
			} else if (n.t <= 0) {
				n.state = 'idle';
				n.t = 5;
			}
			this.stickToGround(n);
			return;
		}
		if (near && n.anger <= 0 && n.state !== 'flee') {
			n.state = 'chase';
			n.t = 2.5;
			n.anger = 8;
			this.say(n, 'Grrr!', false);
			return;
		}
		if (n.anger > 0) n.anger -= dt;
		this.crawler(n, dt, 1.2, 18);
	}

	private spider(n: NPC, dt: number): void {
		const ctx = this.ctx;
		const p = ctx.player.position;
		const env = ctx.env;
		const dist = n.pos.distanceTo(p);
		if (env.stuck === 'web' && dist < 45 && n.state !== 'return') {
			n.state = 'chase';
			n.t = 8;
		}
		if (n.state === 'chase') {
			const d = this.steer(n, p, env.stuck === 'web' ? 9 : 6.5, 4, dt);
			if (d < n.radius + 0.8) {
				if (env.stuck === 'web') {
					env.forceRelease();
					ctx.collection.spill(0.5);
					this.say(n, 'Wrapped!', true);
				} else this.say(n, 'Hssss!', true);
				_v.copy(p).sub(n.pos).normalize();
				ctx.player.launch(_v.x * 18, 10, _v.z * 18, 0.6);
				ctx.player.stun(1);
				ctx.audio.play('bump', { pitch: 0.7 });
				n.state = 'return';
			} else if (n.t <= 0 || dist > 40) n.state = 'return';
		} else if (n.state === 'return') {
			if (this.steer(n, n.home, 4, 3, dt) < 1) n.state = 'idle';
		} else {
			n.vel.multiplyScalar(0.8);
			n.pos.lerp(n.home, dampFactor(1, dt));
			if (dist < 14 && n.anger <= 0) {
				n.state = 'chase';
				n.t = 4;
				n.anger = 10;
			}
			if (n.anger > 0) n.anger -= dt;
		}
		this.keepAboveGround(n, 1.5);
	}

	private isHidden(p: THREE.Vector3): boolean {
		if (isInsideHive(p.x, p.y, p.z)) return true;
		const ft = this.ctx.world.features.info;
		if (Math.hypot(p.x - ft.hollowTreeInside.x, p.z - ft.hollowTreeInside.z) < 7) return true;
		if (p.distanceTo(ft.logInside) < 9) return true;
		return false;
	}

	private bird(n: NPC, dt: number): void {
		const ctx = this.ctx;
		const p = ctx.player.position;
		const dist = n.pos.distanceTo(p);
		if (n.state === 'perch') {
			n.vel.set(0, 0, 0);
			n.pos.lerp(n.home, dampFactor(3, dt));
			if (dist < 12 && !this.isHidden(p)) n.anger += dt;
			else n.anger = Math.max(0, n.anger - dt * 0.5);
			if (n.anger > 3.5) this.startBirdChase(n);
		} else if (n.state === 'chase') {
			const d = this.steer(n, p, 21, 2.2, dt);
			this.keepAboveGround(n, 3);
			if (Math.random() < dt * 0.6) ctx.audio.play('squawk', { volume: 0.6 });
			if (d < n.radius + 0.6) {
				_v.copy(p).sub(n.pos).normalize();
				ctx.player.launch(_v.x * 24, 14, _v.z * 24, 0.8);
				ctx.player.stun(1.3);
				ctx.collection.spill(0.5);
				ctx.audio.play('squawk');
				ctx.cameraCtl.shake(0.7);
				this.say(n, 'CAW!', true);
				ctx.effects.emit('feather', n.pos, 10, 1);
				n.state = 'return';
				n.anger = 0;
			} else if (n.t <= 0 || this.isHidden(p) || dist > 140) {
				n.state = 'return';
				n.anger = 0;
				this.say(n, 'Hmph.', false);
				ctx.chaos.add('close_call', p);
				ctx.achievements.unlock('bird_brained');
				ctx.ui.notify('You escaped the Robin!', '+ Close Call', 'info');
			}
		} else if (n.state === 'return') {
			if (this.steer(n, n.home, 14, 2, dt) < 2) n.state = 'perch';
			this.keepAboveGround(n, 3);
		}
	}

	private startBirdChase(n: NPC): void {
		const ctx = this.ctx;
		if (n.state === 'chase') return;
		n.state = 'chase';
		n.t = 14;
		ctx.audio.play('squawk');
		this.say(n, 'SQUAWK!', true);
		ctx.chaos.add('bird_annoy', n.pos);
		ctx.ui.notify('A Robin is chasing you!', 'Boost away or hide in the hive, hollow oak or log tunnel', 'warning');
	}

	private dragonfly(n: NPC, dt: number): void {
		const t = this.ctx.world.terrain;
		if (n.state === 'flee') {
			this.fleeFrom(n, this.ctx.player.position, 18, dt);
			if (n.t <= 0) n.state = 'wander';
		} else if (n.state === 'idle') {
			n.vel.multiplyScalar(0.85);
			if (n.t <= 0) {
				n.state = 'wander';
				n.target.set(n.home.x + Math.random() * 60 - 30, t.pondLevel + 2 + Math.random() * 8, n.home.z + Math.random() * 60 - 30);
			}
		} else if (this.steer(n, n.target, 17, 4, dt) < 1.5) {
			n.state = 'idle';
			n.t = 0.6 + Math.random() * 1.8;
		}
		if (this.playerNearFast(n, 6) && n.state !== 'flee') {
			n.state = 'flee';
			n.t = 1;
		}
		this.keepAboveGround(n, 1.5);
	}

	private firefly(n: NPC, dt: number): void {
		const time = this.ctx.time;
		if (n.state === 'flee') {
			this.fleeFrom(n, this.ctx.player.position, 7, dt);
			if (n.t <= 0) n.state = 'wander';
		} else {
			_w.set(
				n.home.x + Math.sin(time * 0.3 + n.seed) * 14,
				n.home.y + Math.sin(time * 0.5 + n.seed * 2) * 4,
				n.home.z + Math.cos(time * 0.27 + n.seed * 3) * 14
			);
			this.steer(n, _w, 2.5, 1.5, dt);
		}
		this.keepAboveGround(n, 1);
	}

	private tumble(n: NPC, dt: number): void {
		const g = n.flying && n.species !== 'bird' ? 14 : 32;
		n.vel.y -= g * dt;
		n.pos.addScaledVector(n.vel, dt);
		n.spin += n.spinRate * dt;
		const ground = isInsideHive(n.pos.x, n.pos.y, n.pos.z) ? hiveFloorBelow(n.pos) : this.ctx.world.terrain.heightAt(n.pos.x, n.pos.z);
		const floorY = ground + Math.max(0.2, n.groundOffset);
		if (n.inside) this.confineToHive(n);
		if (n.pos.y < floorY) {
			n.pos.y = floorY;
			if (n.vel.y < -4) this.ctx.effects.emit('dust', n.pos, 4, 0.5);
			n.vel.y = Math.abs(n.vel.y) * 0.4;
			n.vel.x *= 0.6;
			n.vel.z *= 0.6;
			n.spinRate *= 0.6;
			if (n.vel.length() < 3) {
				n.state = 'dazed';
				n.t = n.species === 'snail' ? 5 : 1.6 + Math.random();
				n.upsideDown = n.species === 'ladybug' || (n.species === 'stagbeetle' && Math.random() < 0.5);
			}
		}
		if (n.flying && n.t <= 0) {
			n.state = 'flee';
			n.t = 2.5;
			n.spin = 0;
		}
	}

	private dazed(n: NPC, dt: number): void {
		n.vel.multiplyScalar(0.8);
		if (Math.random() < dt * 3) this.ctx.effects.emit('stars', _v.copy(n.pos).setY(n.pos.y + n.radius + 0.5), 1, 0.3);
		if (!n.flying) this.stickToGround(n);
		if (n.t <= 0) {
			n.upsideDown = false;
			n.spin = 0;
			n.state = n.species === 'spider' || n.species === 'guard' ? 'return' : n.species === 'bird' ? 'chase' : 'flee';
			n.t = n.species === 'bird' ? 8 : 2.5;
		}
	}

	// ----------------------------------------------------------------- animation
	private animate(n: NPC, dt: number): void {
		const time = this.ctx.time;
		const sp = Math.hypot(n.vel.x, n.vel.z);
		if (n.state === 'tumble') {
			n.tilt.rotation.x = n.spin;
			n.tilt.rotation.z = n.spin * 0.6;
		} else {
			if (sp > 0.4) n.heading = dampAngle(n.heading, Math.atan2(n.vel.x, n.vel.z), 6, dt);
			else if (n.species === 'queen' || n.species === 'bird') {
				const p = this.ctx.player.position;
				if (n.pos.distanceTo(p) < 25) n.heading = dampAngle(n.heading, Math.atan2(p.x - n.pos.x, p.z - n.pos.z), 3, dt);
			}
			n.tilt.rotation.x = damp(n.tilt.rotation.x, n.flying ? clamp(sp * 0.03, -0.4, 0.5) : 0, 6, dt);
			n.tilt.rotation.z = damp(n.tilt.rotation.z, n.upsideDown ? Math.PI : 0, 8, dt);
		}
		n.root.position.copy(n.pos);
		n.root.rotation.y = n.heading;
		if (n.bee) {
			n.bee.update(dt, time + n.seed, n.state === 'chase' ? 1 : 0.4 + sp * 0.04);
			if (n.state === 'tumble' || n.state === 'dazed') n.bee.setExpression('dizzy', 0.5);
			else if (n.state === 'chase') n.bee.setExpression('angry', 0.3);
			return;
		}
		const m = n.model!;
		switch (n.species) {
			case 'butterfly': {
				const rest = n.state === 'interact';
				const f = rest ? Math.sin(time * 2 + n.seed) * 0.5 + 0.6 : Math.sin(time * 14 + n.seed) * 0.9 + 0.3;
				for (const w of m.parts) w.rotation.z = f * (w.userData.side as number);
				break;
			}
			case 'bird': {
				const flyingNow = n.state === 'chase' || n.state === 'return';
				const f = flyingNow ? Math.sin(time * 9) * 1 : -0.1 + Math.sin(time * 0.7) * 0.05;
				for (const w of m.parts) w.rotation.z = f * (w.userData.side as number);
				if (n.state === 'perch') n.tilt.rotation.x = Math.max(0, Math.sin(time * 1.3 + n.seed)) * 0.5;
				break;
			}
			case 'dragonfly':
			case 'firefly': {
				const f = Math.sin(time * 40 + n.seed) * 0.7;
				m.parts.forEach((w, i) => (w.rotation.z = (i % 2 ? f : -f * 0.8) * (w.userData.side as number)));
				if (n.species === 'firefly') {
					const g = m.extra[0];
					g.scale.setScalar(0.7 + Math.sin(time * 3 + n.seed) * 0.35);
				}
				break;
			}
			default: {
				// Leg scuttle (ladybug, beetle, spider).
				const speed = n.state === 'dazed' && n.upsideDown ? 18 : sp * 4 + 1;
				for (const l of m.parts) {
					const row = l.userData.row as number;
					const side = l.userData.side as number;
					l.rotation.x = Math.sin(time * speed + row * 1.7 + (side > 0 ? Math.PI : 0)) * (sp > 0.2 || n.upsideDown ? 0.5 : 0.05);
				}
				if (n.species === 'snail') n.tilt.scale.set(1, n.state === 'dazed' ? 0.75 : 1, 1 + Math.sin(time * 1.5) * 0.04);
				// Baked-leg crawlers get a little scuttle bob instead.
				else if (!m.parts.length) n.tilt.position.y = sp > 0.2 ? Math.abs(Math.sin(time * (8 + sp * 3))) * 0.06 : 0;
			}
		}
	}

	// ------------------------------------------------------------ interactions
	private say(n: NPC, text: string, force: boolean): void {
		if (!force && n.speechCD > 0) return;
		n.speechCD = 2.5;
		this.ctx.popups.show(text, _v.copy(n.pos).setY(n.pos.y + n.radius + 1.6), 'speech', 2);
	}

	private knock(n: NPC, dir: THREE.Vector3, strength: number): void {
		_v.copy(dir).setY(0);
		if (_v.lengthSq() < 0.01) _v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
		_v.normalize();
		const s = Math.min(30, strength);
		n.vel.set(_v.x * s, 7 + s * 0.35, _v.z * s);
		n.state = 'tumble';
		n.t = 1.2;
		n.spinRate = 10 + s * 0.6;
		n.cooldown = 0.6;
		n.flower = null;
	}

	/** Player bump/headbutt/dash sweep. Returns true if anything was hit. */
	bumpAt(pos: THREE.Vector3, radius: number, vel: THREE.Vector3, power: number): boolean {
		const ctx = this.ctx;
		let hit = false;
		for (const n of this.list) {
			if (!n.active || n.cooldown > 0 || n.state === 'tumble') continue;
			const r = radius + n.radius;
			if (n.pos.distanceToSquared(pos) > r * r) continue;
			const speed = vel.length() * power;
			if (speed < 5) continue;
			hit = true;
			n.cooldown = 0.8;
			ctx.audio.play('yelp', { pitch: n.radius > 2 ? 0.6 : 1.3 });
			ctx.cameraCtl.shake(0.2);
			ctx.player.model.bonk(0.25);
			ctx.effects.emit('stars', n.pos, 6, 0.5);
			if (n.species === 'queen') {
				this.say(n, 'How DARE you!', true);
				ctx.chaos.add('queen_bump', n.pos);
				ctx.achievements.unlock('treason');
				this.alertGuards();
				n.cooldown = 2;
				continue;
			}
			this.knock(n, vel, speed * 0.8);
			if (n.species === 'bird') {
				this.startBirdChase(n);
				n.t = 1;
				continue;
			}
			if (n.species === 'spider') {
				ctx.chaos.add('spider_bump', n.pos);
				this.say(n, 'Hsss?!', true);
				continue;
			}
			if (n.species === 'guard') {
				this.say(n, 'Halt!', true);
				continue;
			}
			ctx.chaos.add('insect_bowl', n.pos, n.radius > 2 ? 1.4 : 1);
			const lines = n.species === 'worker' ? ['Hey!', 'Watch it!', 'Bzzt!', 'Rude!'] : n.species === 'snail' ? ['Rude.'] : ['Eep!', 'Whoa!', 'Oof!', 'Wheee!'];
			this.say(n, lines[Math.floor(Math.random() * lines.length)], true);
		}
		return hit;
	}

	stingAt(pos: THREE.Vector3, radius: number): boolean {
		const ctx = this.ctx;
		let hit = false;
		for (const n of this.list) {
			if (!n.active) continue;
			const r = radius + n.radius;
			if (n.pos.distanceToSquared(pos) > r * r) continue;
			hit = true;
			this.say(n, 'OUCH!', true);
			ctx.chaos.add('sting', n.pos);
			ctx.audio.play('yelp', { pitch: 1.6 });
			if (n.species === 'bird') this.startBirdChase(n);
			else if (n.species === 'queen') {
				ctx.chaos.add('queen_bump', n.pos);
				ctx.achievements.unlock('treason');
				this.alertGuards();
			} else if (n.species === 'stagbeetle' || n.species === 'spider') {
				n.state = 'chase';
				n.t = 3;
			} else {
				_v.copy(n.pos).sub(ctx.player.position);
				this.knock(n, _v, 10);
			}
		}
		return hit;
	}

	shockwave(pos: THREE.Vector3, radius: number): void {
		for (const n of this.list) {
			if (!n.active || n.species === 'queen') continue;
			const d = n.pos.distanceTo(pos);
			if (d > radius) continue;
			_w.copy(n.pos).sub(pos);
			this.knock(n, _w, (1 - d / radius) * 24 + 6);
			this.ctx.chaos.add('insect_bowl', n.pos, 0.8);
		}
	}

	private alertGuards(): void {
		this.guardAlert = 12;
		for (const n of this.list) {
			if (n.species !== 'guard') continue;
			n.state = 'chase';
			n.t = 12;
			this.say(n, 'Seize the intruder!', true);
		}
		this.ctx.ui.notify('The Royal Guard is after you!', 'Get out of the hive!', 'warning');
	}

	private nearestTalkable(): NPC | null {
		const p = this.ctx.player.position;
		let best: NPC | null = null;
		let bd = 7;
		for (const n of this.list) {
			if (!n.active || !n.talkable || n.state === 'tumble' || n.state === 'chase') continue;
			const d = n.pos.distanceTo(p) - n.radius;
			if (d < bd) {
				bd = d;
				best = n;
			}
		}
		return best;
	}

	talkPrompt(): string {
		const n = this.nearestTalkable();
		return n ? `[E] Talk to ${n.name}` : '';
	}

	tryTalk(): boolean {
		const ctx = this.ctx;
		const n = this.nearestTalkable();
		if (!n) return false;
		const lines = TALK_LINES[n.species]!;
		const line = lines[Math.floor(Math.random() * lines.length)];
		n.speechCD = 0;
		this.say(n, line, true);
		ctx.audio.play('notify');
		if (n.species === 'queen') ctx.achievements.unlock('royal_audience');
		return true;
	}

	get speciesCount(): number {
		return Object.keys(SPECIES_INFO).length;
	}

	dispose(): void {
		for (const n of this.list) n.dispose();
		disposeInsectMaterials();
		SimpleBee.disposeShared();
	}
}
