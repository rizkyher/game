import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Enemy } from './Enemy';
import { ITEMS } from '../systems/Inventory';

type PickupKind = 'exp' | 'health_orb' | 'mana_orb' | 'item';

interface Pickup {
	active: boolean;
	kind: PickupKind;
	item: string;
	value: number;
	pos: THREE.Vector3;
	vel: THREE.Vector3;
	age: number;
	magnet: boolean;
	slot: number;
}

const MAX = 96;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _sc = new THREE.Vector3();
const _e = new THREE.Euler();

const ORB_COLORS: Record<PickupKind, number> = { exp: 0x9af0ff, health_orb: 0xff5a7a, mana_orb: 0x6a9aff, item: 0xffffff };

/**
 * Loot: experience motes that stream into the player, small health/mana orbs, and item
 * drops (potions) that hover until collected. Rendered as two instanced meshes.
 */
export class Pickups {
	private items: Pickup[] = [];
	private orbs: THREE.InstancedMesh;
	private bottles: THREE.InstancedMesh;
	private orbMat: THREE.MeshStandardMaterial;
	private bottleMat: THREE.MeshStandardMaterial;
	private col = new THREE.Color();
	private time = 0;

	constructor(private ctx: GameContext) {
		const orbGeo = new THREE.IcosahedronGeometry(0.16, 1);
		this.orbMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.2, roughness: 0.3 });
		this.orbMat.onBeforeCompile = (shader) => {
			shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif');
		};
		this.orbs = new THREE.InstancedMesh(orbGeo, this.orbMat, MAX);
		// Potion bottle: body + neck + cork.
		const body = new THREE.SphereGeometry(0.22, 12, 10);
		body.scale(1, 1.1, 1);
		const neck = new THREE.CylinderGeometry(0.07, 0.09, 0.18, 8);
		neck.translate(0, 0.28, 0);
		const cork = new THREE.CylinderGeometry(0.075, 0.07, 0.08, 8);
		cork.translate(0, 0.4, 0);
		const parts = [body, neck, cork].map((g) => g.toNonIndexed());
		const merged = new THREE.BufferGeometry();
		let count = 0;
		for (const g of parts) count += g.attributes.position.count;
		const pos = new Float32Array(count * 3);
		const nrm = new Float32Array(count * 3);
		let off = 0;
		for (const g of parts) {
			g.computeVertexNormals();
			pos.set(g.attributes.position.array as Float32Array, off * 3);
			nrm.set(g.attributes.normal.array as Float32Array, off * 3);
			off += g.attributes.position.count;
			g.dispose();
		}
		body.dispose();
		neck.dispose();
		cork.dispose();
		merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
		this.bottleMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 });
		this.bottleMat.onBeforeCompile = (shader) => {
			shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_INSTANCING_COLOR\ntotalEmissiveRadiance *= vColor.rgb;\n#endif');
		};
		this.bottles = new THREE.InstancedMesh(merged, this.bottleMat, 32);
		for (let i = 0; i < MAX; i++) {
			this.orbs.setMatrixAt(i, _m.makeScale(0, 0, 0));
			this.orbs.setColorAt(i, this.col.setRGB(1, 1, 1));
			this.items.push({ active: false, kind: 'exp', item: '', value: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, magnet: false, slot: i });
		}
		for (let i = 0; i < 32; i++) {
			this.bottles.setMatrixAt(i, _m.makeScale(0, 0, 0));
			this.bottles.setColorAt(i, this.col.setRGB(1, 1, 1));
		}
		this.orbs.frustumCulled = false;
		this.bottles.frustumCulled = false;
		this.bottles.castShadow = true;
		ctx.scene.add(this.orbs, this.bottles);
	}

	private spawn(kind: PickupKind, at: THREE.Vector3, value: number, item = ''): void {
		const p = this.items.find((x) => !x.active && (kind !== 'item' || x.slot < 32)) ?? null;
		if (!p) {
			if (kind === 'exp') this.ctx.progression.addExp(value);
			return;
		}
		p.active = true;
		p.kind = kind;
		p.item = item;
		p.value = value;
		p.pos.copy(at);
		const a = Math.random() * Math.PI * 2;
		const sp = kind === 'item' ? 2 : 3 + Math.random() * 3;
		p.vel.set(Math.cos(a) * sp, 4 + Math.random() * 3, Math.sin(a) * sp);
		p.age = 0;
		p.magnet = false;
		const color = kind === 'item' ? new THREE.Color(ITEMS[item]?.color ?? '#ffffff') : this.col.setHex(ORB_COLORS[kind]);
		if (kind === 'item') this.bottles.setColorAt(p.slot, color);
		else this.orbs.setColorAt(p.slot, color);
		if (this.orbs.instanceColor) this.orbs.instanceColor.needsUpdate = true;
		if (this.bottles.instanceColor) this.bottles.instanceColor.needsUpdate = true;
	}

	/** Experience and loot from a defeated enemy. */
	dropFrom(e: Enemy): void {
		const at = e.aimPoint(_v.clone());
		const levelDiff = e.level - this.ctx.progression.level;
		const exp = Math.round(e.def.exp * (e.elite ? 1.8 : 1) * Math.max(0.35, 1 + levelDiff * 0.12));
		const motes = Math.min(8, 3 + Math.floor(exp / 20));
		for (let i = 0; i < motes; i++) this.spawn('exp', at, exp / motes);
		if (Math.random() < 0.45) this.spawn('mana_orb', at, 18);
		if (Math.random() < 0.3) this.spawn('health_orb', at, 15);
		for (const l of e.def.loot) if (Math.random() < l.chance * (e.elite ? 1.6 : 1)) this.spawn('item', at, 1, l.id);
	}

	dropItem(id: string, at: THREE.Vector3): void {
		this.spawn('item', at, 1, id);
	}

	update(dt: number): void {
		const ctx = this.ctx;
		this.time += dt;
		const player = ctx.player;
		const target = player.aimPoint(_t);
		let orbsDirty = false;
		let bottlesDirty = false;
		for (const p of this.items) {
			if (!p.active) continue;
			p.age += dt;
			const toX = target.x - p.pos.x;
			const toY = target.y - p.pos.y;
			const toZ = target.z - p.pos.z;
			const d = Math.sqrt(toX * toX + toY * toY + toZ * toZ);
			const magnetRange = p.kind === 'item' ? 2.2 : 7;
			if (!p.magnet && p.age > (p.kind === 'item' ? 0.6 : 0.45) && d < magnetRange && player.alive) p.magnet = true;
			if (p.magnet) {
				const speed = 6 + p.age * 14;
				p.vel.set((toX / d) * speed, (toY / d) * speed, (toZ / d) * speed);
				p.pos.addScaledVector(p.vel, dt);
				if (d < 0.6) {
					this.collect(p);
					continue;
				}
			} else {
				p.vel.y -= 14 * dt;
				p.vel.x *= Math.exp(-2 * dt);
				p.vel.z *= Math.exp(-2 * dt);
				p.pos.addScaledVector(p.vel, dt);
				const g = ctx.world.terrain.heightAt(p.pos.x, p.pos.z) + (p.kind === 'item' ? 0.5 : 0.7);
				if (p.pos.y < g) {
					p.pos.y = g;
					p.vel.y = Math.abs(p.vel.y) * 0.3;
				}
				// Exp eventually flies to the player on its own.
				if (p.kind === 'exp' && p.age > 3) p.magnet = true;
				if (p.age > 90) {
					this.hide(p);
					continue;
				}
			}
			const bob = Math.sin(this.time * 3 + p.slot) * 0.08;
			if (p.kind === 'item') {
				_q.setFromEuler(_e.set(0.2, this.time * 1.5 + p.slot, 0));
				this.bottles.setMatrixAt(p.slot, _m.compose(_s.set(p.pos.x, p.pos.y + bob, p.pos.z), _q, _sc.setScalar(1)));
				bottlesDirty = true;
			} else {
				const sc = p.kind === 'exp' ? 0.8 : 1.3;
				_q.setFromEuler(_e.set(this.time * 2, this.time * 3 + p.slot, 0));
				this.orbs.setMatrixAt(p.slot, _m.compose(_s.set(p.pos.x, p.pos.y + bob, p.pos.z), _q, _sc.setScalar(sc)));
				orbsDirty = true;
			}
			if (Math.random() < dt * 6) ctx.vfx.burst(p.pos, 'star', 0xffffff, ORB_COLORS[p.kind === 'item' ? 'exp' : p.kind], 1, 0.4, 0.4, 0.1, { intensity: 2 });
		}
		if (orbsDirty || bottlesDirty) {
			this.orbs.instanceMatrix.needsUpdate = true;
			this.bottles.instanceMatrix.needsUpdate = true;
		}
	}

	private hide(p: Pickup): void {
		p.active = false;
		if (p.kind === 'item') this.bottles.setMatrixAt(p.slot, _m.makeScale(0, 0, 0));
		else this.orbs.setMatrixAt(p.slot, _m.makeScale(0, 0, 0));
		this.orbs.instanceMatrix.needsUpdate = true;
		this.bottles.instanceMatrix.needsUpdate = true;
	}

	private collect(p: Pickup): void {
		const ctx = this.ctx;
		this.hide(p);
		const player = ctx.player;
		switch (p.kind) {
			case 'exp':
				ctx.progression.addExp(p.value);
				ctx.audio.sfx('exp', p.pos, { volume: 0.25, pitch: 1 + Math.random() * 0.3 });
				break;
			case 'health_orb':
				player.heal(player.maxHp * (p.value / 100));
				ctx.audio.sfx('orb', p.pos, { volume: 0.5 });
				break;
			case 'mana_orb':
				player.restoreMana(player.maxMana * (p.value / 100));
				ctx.audio.sfx('orb', p.pos, { volume: 0.5, pitch: 1.2 });
				break;
			case 'item': {
				const added = ctx.inventory.add(p.item, 1);
				const def = ITEMS[p.item];
				if (added > 0) {
					ctx.ui.notify(`+1 ${def.name}`, def.desc, 'item');
					ctx.events.emit('item', { id: p.item, count: 1 });
				} else ctx.ui.notify(`${def.name} — bag full`, '', 'warning');
				ctx.audio.sfx('pickup', p.pos, { volume: 0.7 });
				break;
			}
		}
	}

	clear(): void {
		for (const p of this.items) {
			if (!p.active) continue;
			if (p.kind === 'exp') this.ctx.progression.addExp(p.value);
			this.hide(p);
		}
	}

	dispose(): void {
		this.ctx.scene.remove(this.orbs, this.bottles);
		this.orbs.geometry.dispose();
		this.bottles.geometry.dispose();
		this.orbMat.dispose();
		this.bottleMat.dispose();
	}
}
