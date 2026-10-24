import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Web } from '../world/Features';
import { SKY_CEILING, edgeDistance, isInsideHive } from '../world/Biomes';
import { clamp, smoothstep } from '../utils/math';

interface Puddle {
	mesh: THREE.Mesh;
	x: number;
	y: number;
	z: number;
	r: number;
	expires: number;
	active: boolean;
}

export type StuckKind = 'honey' | 'web' | null;

const _v = new THREE.Vector3();
const _flow = new THREE.Vector3();
const _seg = new THREE.Vector3();

/**
 * Environmental effects on the bee: water, waterfall, updrafts, wind gusts, sticky honey
 * and spider webs. Produces an external acceleration + speed multiplier each fixed step.
 */
export class EnvironmentSystem {
	readonly accel = new THREE.Vector3();
	speedMul = 1;
	inWater = false;
	stuck: StuckKind = null;
	stuckWeb: Web | null = null;
	struggle = 0;
	wet = 0;
	honeyCoat = 0;
	nearWater = 0;
	private immunity = 0;
	private puddles: Puddle[] = [];
	private puddleMat: THREE.MeshStandardMaterial;
	private puddleGeo: THREE.CircleGeometry;
	private emitTimer = 0;
	private wasInWater = false;

	constructor(private ctx: GameContext) {
		this.puddleGeo = new THREE.CircleGeometry(1, 24);
		this.puddleGeo.rotateX(-Math.PI / 2);
		this.puddleMat = new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0xff7b00, emissiveIntensity: 0.3, roughness: 0.12, transparent: true, opacity: 0.9 });
		for (let i = 0; i < 6; i++) {
			const mesh = new THREE.Mesh(this.puddleGeo, this.puddleMat);
			mesh.visible = false;
			mesh.receiveShadow = true;
			ctx.scene.add(mesh);
			this.puddles.push({ mesh, x: 0, y: 0, z: 0, r: 0, expires: 0, active: false });
		}
	}

	addHoneyPuddle(pos: THREE.Vector3, r: number, duration: number): void {
		const ctx = this.ctx;
		const p = this.puddles.find((q) => !q.active) ?? this.puddles.reduce((a, b) => (a.expires < b.expires ? a : b));
		const ground = ctx.world.terrain.heightAt(pos.x, pos.z);
		// Inside the hive the jar sits on a floor; outside use the terrain.
		const floor = isInsideHive(pos.x, pos.y, pos.z) ? pos.y - 1.45 : Math.max(ground, pos.y - 1.5);
		p.x = pos.x;
		p.y = floor + 0.06;
		p.z = pos.z;
		p.r = r;
		p.expires = ctx.time + duration;
		p.active = true;
		p.mesh.position.set(p.x, p.y, p.z);
		p.mesh.scale.setScalar(r);
		p.mesh.visible = true;
	}

	/** Called by abilities when the player mashes keys while stuck. */
	addStruggle(amount: number, wiggle = true): void {
		if (!this.stuck) return;
		this.struggle = Math.min(1, this.struggle + amount);
		// Check here: the per-step decay would otherwise pull a full meter back under 1.
		if (this.struggle >= 1) {
			this.escape();
			return;
		}
		if (!wiggle) return;
		this.ctx.player.model.bonk(0.15);
		this.ctx.effects.emit(this.stuck === 'honey' ? 'honey' : 'sparkle', this.ctx.player.position, 2, 0.4);
	}

	fixedUpdate(dt: number): void {
		const ctx = this.ctx;
		const p = ctx.player.position;
		const vel = ctx.player.velocity;
		const terrain = ctx.world.terrain;
		const world = ctx.world;
		this.accel.set(0, 0, 0);
		this.speedMul = 1;
		if (this.immunity > 0) this.immunity -= dt;
		if (this.wet > 0) this.wet -= dt;
		if (this.honeyCoat > 0) this.honeyCoat -= dt;

		// --- Water -----------------------------------------------------------
		const level = terrain.waterLevelAt(p.x, p.z, _flow);
		this.nearWater = level > -Infinity ? clamp(1 - (p.y - level) / 25, 0, 1) : 0;
		this.inWater = level > -Infinity && p.y < level + 0.45;
		if (this.inWater) {
			if (!this.wasInWater) {
				const impact = -vel.y;
				ctx.effects.emit('splash', _v.set(p.x, level + 0.2, p.z), Math.round(clamp(impact * 2.5, 8, 60)), 0.8);
				ctx.audio.play('splash', { volume: clamp(impact / 20, 0.3, 1) });
				if (impact > 12) {
					ctx.chaos.add('splash', p);
					ctx.achievements.unlock('splash_zone');
					ctx.cameraCtl.shake(0.3);
				}
			}
			this.wet = 6;
			const depth = level + 0.45 - p.y;
			this.accel.y += depth * 55 - vel.y * 3;
			this.accel.addScaledVector(_flow, 10);
		}
		this.wasInWater = this.inWater;

		// Waterfall column pushes you down and out.
		const ft = world.water.fallTop;
		const fb = world.water.fallBase;
		if (ft.distanceToSquared(fb) > 4) {
			_seg.copy(fb).sub(ft);
			const len = _seg.length();
			_seg.divideScalar(len);
			_v.copy(p).sub(ft);
			const t = clamp(_v.dot(_seg), 0, len);
			const cx = ft.x + _seg.x * t;
			const cz = ft.z + _seg.z * t;
			const d = Math.hypot(p.x - cx, p.z - cz);
			if (d < 7.5 && p.y < ft.y + 2 && p.y > fb.y - 1) {
				this.accel.y -= 45;
				this.accel.x += _seg.x * 18;
				this.accel.z += _seg.z * 18;
				this.wet = 6;
			}
		}

		// --- Updrafts ----------------------------------------------------------
		for (const u of world.features.info.updrafts) {
			const d = Math.hypot(p.x - u.x, p.z - u.z);
			if (d > u.r || p.y < u.y0 - 2 || p.y > u.y1) continue;
			const k = (1 - d / u.r) * (1 - smoothstep(u.y1 - 30, u.y1, p.y));
			this.accel.y += u.strength * 2.2 * k;
		}
		// Waterfall mist updraft beside the plunge pool.
		{
			const d = Math.hypot(p.x - fb.x, p.z - fb.z);
			if (d > 8 && d < 18 && p.y < fb.y + 40) this.accel.y += 14 * (1 - Math.abs(d - 13) / 5);
		}

		// --- Wind -----------------------------------------------------------------
		const inside = isInsideHive(p.x, p.y, p.z);
		if (!inside) {
			const ground = terrain.heightAt(p.x, p.z);
			const exposure = clamp((p.y - ground) / 25, 0.15, 1) * (1 - terrain.forestAt(p.x, p.z) * 0.75);
			const w = world.wind;
			const k = (1.2 + world.gust * 16) * exposure;
			this.accel.x += w.x * k;
			this.accel.z += w.y * k;
		}

		// --- Sticky stuff -----------------------------------------------------
		if (!this.stuck && this.immunity <= 0) {
			const pool = world.hive.info.honeyPool;
			if (Math.hypot(p.x - pool.x, p.z - pool.z) < pool.r && p.y < pool.y + 1.1 && p.y > pool.y - 2) this.stick('honey', null);
			for (const pd of this.puddles) {
				if (!pd.active) continue;
				if (Math.hypot(p.x - pd.x, p.z - pd.z) < pd.r && p.y < pd.y + 1 && p.y > pd.y - 1.5) this.stick('honey', null);
			}
			for (const web of world.features.info.webs) {
				if (web.broken) continue;
				_v.copy(p).sub(web.center);
				const planeD = Math.abs(_v.dot(web.normal));
				if (planeD > 1.1) continue;
				const radial = Math.sqrt(Math.max(0, _v.lengthSq() - planeD * planeD));
				if (radial > web.radius) continue;
				if (ctx.abilities.isDashing()) this.breakWeb(web, true);
				else this.stick('web', web);
				break;
			}
		}
		for (const pd of this.puddles) {
			if (pd.active && ctx.time > pd.expires) {
				pd.active = false;
				pd.mesh.visible = false;
			}
		}
		for (const web of world.features.info.webs) {
			if (web.broken && ctx.time > web.respawnAt) {
				web.broken = false;
				world.features.setWebVisible(web, true);
			}
		}
		if (this.stuck) {
			this.struggle = Math.max(0, this.struggle - dt * 0.06);
			this.speedMul = 0.04;
		} else {
			if (this.wet > 0) this.speedMul *= 0.68;
			if (this.honeyCoat > 0) this.speedMul *= 0.8;
		}

		// --- World bounds ------------------------------------------------------
		const e = edgeDistance(p.x, p.z);
		if (e > 470) {
			const k = (e - 470) * 3;
			this.accel.x -= (p.x / e) * k;
			this.accel.z -= (p.z / e) * k;
		}
		if (p.y > SKY_CEILING) this.accel.y -= (p.y - SKY_CEILING) * 4;
	}

	private stick(kind: 'honey' | 'web', web: Web | null): void {
		const ctx = this.ctx;
		this.stuck = kind;
		this.stuckWeb = web;
		this.struggle = 0;
		ctx.player.model.setExpression('worried');
		ctx.audio.play(kind === 'honey' ? 'squelch' : 'boing', { pitch: kind === 'web' ? 0.6 : 1 });
		ctx.cameraCtl.shake(0.15);
		ctx.abilities.dropHeld();
		if (kind === 'honey') {
			ctx.chaos.add('honey_stuck', ctx.player.position);
			ctx.achievements.unlock('sticky_business');
			ctx.effects.emit('honey', ctx.player.position, 14, 0.5);
		}
		ctx.ui.notify(kind === 'honey' ? 'STUCK IN HONEY!' : 'CAUGHT IN A WEB!', 'Mash or hold SPACE / WASD to wriggle free', 'warning');
	}

	private escape(): void {
		const ctx = this.ctx;
		const kind = this.stuck;
		this.stuck = null;
		this.struggle = 0;
		this.immunity = 2.5;
		if (kind === 'honey') this.honeyCoat = 9;
		if (kind === 'web' && this.stuckWeb) this.breakWeb(this.stuckWeb, false);
		this.stuckWeb = null;
		ctx.player.launch(0, 20, 0, 0.5);
		ctx.player.model.setExpression('happy');
		ctx.audio.play('boing', { pitch: 1.3 });
		ctx.chaos.add('escape', ctx.player.position);
		ctx.effects.emit(kind === 'honey' ? 'honey' : 'sparkle', ctx.player.position, 20, 0.6);
	}

	/** Called by spiders/birds that catch a stuck bee. */
	forceRelease(): void {
		this.stuck = null;
		this.struggle = 0;
		this.immunity = 2;
		if (this.stuckWeb) this.breakWeb(this.stuckWeb, false);
		this.stuckWeb = null;
	}

	private breakWeb(web: Web, dash: boolean): void {
		const ctx = this.ctx;
		web.broken = true;
		web.respawnAt = ctx.time + 35;
		ctx.world.features.setWebVisible(web, false);
		ctx.effects.emit('sparkle', web.center, 30, web.radius * 0.5);
		ctx.audio.play('whoosh', { pitch: 1.6 });
		if (dash) ctx.chaos.add('web_wreck', web.center);
	}

	/** Visual ambience (per frame). */
	update(dt: number): void {
		const ctx = this.ctx;
		const p = ctx.player.position;
		const world = ctx.world;
		this.emitTimer -= dt;
		if (this.emitTimer > 0) return;
		this.emitTimer = 0.06;
		const fb = world.water.fallBase;
		if (fb.distanceToSquared(p) < 220 * 220) {
			ctx.effects.emit('mist', fb, 1, 4);
			if (Math.random() < 0.5) ctx.effects.emit('splash', fb, 2, 3);
		}
		for (const u of world.features.info.updrafts) {
			if (Math.hypot(u.x - p.x, u.z - p.z) > 150) continue;
			_v.set(u.x + (Math.random() - 0.5) * u.r * 1.4, u.y0 + 1 + Math.random() * 4, u.z + (Math.random() - 0.5) * u.r * 1.4);
			ctx.effects.emit('swirl', _v, 1, 0.5, _flow.set(0, 1, 0), 14);
		}
		if (world.gust > 0.25 && !isInsideHive(p.x, p.y, p.z)) {
			const g = world.gustDir;
			for (let i = 0; i < 3; i++) {
				_v.set(p.x - g.x * 20 + (Math.random() - 0.5) * 30, p.y + (Math.random() - 0.5) * 12, p.z - g.y * 20 + (Math.random() - 0.5) * 30);
				ctx.effects.emit('wind', _v, 1, 0.2, _flow.set(g.x, 0, g.y), 32);
			}
		}
		if (this.honeyCoat > 0 && Math.random() < 0.4) ctx.effects.emit('honey', p, 1, 0.3);
		if (this.wet > 0 && !this.inWater && Math.random() < 0.5) ctx.effects.emit('splash', p, 1, 0.3);
		ctx.effects.windX = world.wind.x * 3;
		ctx.effects.windZ = world.wind.y * 3;
	}

	dispose(): void {
		for (const pd of this.puddles) pd.mesh.removeFromParent();
		this.puddleGeo.dispose();
		this.puddleMat.dispose();
	}
}
