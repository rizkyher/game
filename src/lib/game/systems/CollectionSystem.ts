import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { FlowerRef } from '../world/Vegetation';
import { HIVE, HIVE_CHAMBERS, LANDMARKS, REGION_NAMES, landmark, type RegionId } from '../world/Biomes';
import { SPECIES_INFO, type Species } from '../entities/Insects';
import { BEE_RADIUS } from '../player/BeeController';

export interface Orb {
	id: string;
	pos: THREE.Vector3;
	hint: string;
	collected: boolean;
}

const NECTAR_CAP = 10;
const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

/** Pollen, nectar, honey deliveries, Golden Pollen orbs and all "discovery" bookkeeping. */
export class CollectionSystem {
	pollen = 0;
	nectar = 0;
	readonly nectarCap = NECTAR_CAP;
	readonly orbs: Orb[] = [];
	private orbMesh: THREE.InstancedMesh;
	private haloMesh: THREE.InstancedMesh;
	private region: RegionId | null = null;
	private chamber: string | null = null;
	private nearFlower: FlowerRef | null = null;
	private nearDeposit = false;
	private tickTimer = 0;
	private discoverTimer = 0;

	constructor(private ctx: GameContext) {
		const f = ctx.world.features.info;
		const hive = ctx.world.hive.info;
		const t = ctx.world.terrain;
		const water = ctx.world.water;
		const tallestSunflower = ctx.world.vegetation.allFlowers
			.filter((fl) => fl.type === 'sunflower' && Math.hypot(fl.x - landmark('sunflowers').x, fl.z - landmark('sunflowers').z) < 70)
			.sort((a, b) => b.y - a.y)[0];
		const lav = landmark('lavender');
		const roses = landmark('roses');
		const gar = landmark('garden');
		const sg = landmark('spiderGrove');
		const up = f.updrafts[2];
		const defs: [string, THREE.Vector3, string][] = [
			['hollow-oak', f.hollowTreeTop.clone(), 'Inside the Hollow Oak'],
			['log', f.logInside.clone(), 'Deep in the Mossy Log'],
			['elder', f.elderTop.clone(), 'Atop the Elder Tree'],
			['attic', hive.attic.clone().setY(hive.attic.y + 2), 'The Secret Royal Attic'],
			['apex', hive.apex.clone().setY(hive.apex.y + 5), 'On the hive roof'],
			['fairy', f.fairyCenter.clone().setY(f.fairyCenter.y + 30), 'High above the Fairy Ring'],
			['falls', water.fallBase.clone().setY(water.fallBase.y + 2), 'Under Whispering Falls'],
			['summit', f.summit.clone().setY(f.summit.y + 3), 'Misty Summit'],
			['spiders', new THREE.Vector3(sg.x, t.heightAt(sg.x, sg.z) + 10, sg.z), 'Among the webs'],
			['cherry', new THREE.Vector3(-125, t.heightAt(-125, 72) + 40, 72), 'Cherry tree crown'],
			['sunflower', tallestSunflower ? new THREE.Vector3(tallestSunflower.x, tallestSunflower.y + 6, tallestSunflower.z) : new THREE.Vector3(250, 30, 160), 'Tallest sunflower'],
			['pond', new THREE.Vector3(t.pond.x, t.pondLevel + 1.6, t.pond.z), 'Middle of the Lily Pond'],
			['nursery', new THREE.Vector3(HIVE.x + 12, HIVE.baseY + HIVE.levels[0] + 4, HIVE.z + 12), 'Royal Nursery'],
			['garden', new THREE.Vector3(gar.x + 4, t.heightAt(gar.x, gar.z) + 6, gar.z + 4), 'Over the veggie patch'],
			['nest', f.birdPerches[0].clone().setY(f.birdPerches[0].y + 2.5).add(new THREE.Vector3(-1.5, 0, 0)), "In the Robin's nest (careful!)"],
			['lavender', new THREE.Vector3(lav.x, t.heightAt(lav.x, lav.z) + 9, lav.z), 'Lavender Fields'],
			['roses', new THREE.Vector3(roses.x, t.heightAt(roses.x, roses.z) + 4, roses.z), 'Hidden in the roses'],
			['sky', new THREE.Vector3(up.x, up.y1 - 12, up.z), 'Riding the warm updraft']
		];
		for (const [id, pos, hint] of defs) this.orbs.push({ id, pos, hint, collected: ctx.save.data.orbs.includes(id) });

		const orbGeo = new THREE.IcosahedronGeometry(0.9, 2);
		const orbMat = new THREE.MeshStandardMaterial({ color: 0xffd54f, emissive: 0xffb300, emissiveIntensity: 0.9, metalness: 0.4, roughness: 0.2 });
		this.orbMesh = new THREE.InstancedMesh(orbGeo, orbMat, this.orbs.length);
		const haloGeo = new THREE.TorusGeometry(1.6, 0.12, 6, 24);
		const haloMat = new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.7 });
		this.haloMesh = new THREE.InstancedMesh(haloGeo, haloMat, this.orbs.length);
		this.orbMesh.frustumCulled = false;
		this.haloMesh.frustumCulled = false;
		ctx.scene.add(this.orbMesh, this.haloMesh);
	}

	get orbsCollected(): number {
		return this.orbs.filter((o) => o.collected).length;
	}

	spill(fraction: number): void {
		const lost = Math.floor(this.pollen * fraction);
		if (lost <= 0) return;
		this.pollen -= lost;
		this.ctx.effects.emit('pollen', this.ctx.player.position, Math.min(60, lost), 1);
		this.ctx.popups.show(`-${lost} pollen`, this.ctx.player.position.clone().setY(this.ctx.player.position.y + 1.5), 'bad');
	}

	discoverSpecies(s: Species): void {
		const ctx = this.ctx;
		if (!ctx.playing) return;
		if (!ctx.save.addUnique('species', s)) return;
		const info = SPECIES_INFO[s];
		ctx.ui.notify(`New species: ${info.icon} ${info.name}`, info.desc, 'discovery');
		ctx.audio.play('chime', { pitch: 1.2 });
		if (ctx.save.data.species.length >= Object.keys(SPECIES_INFO).length) ctx.achievements.unlock('entomologist');
	}

	private discover(id: string, title: string, detail: string): void {
		const ctx = this.ctx;
		if (!ctx.save.addUnique('discovered', id)) return;
		ctx.ui.notify(title, detail, 'region');
		ctx.audio.play('notify');
	}

	update(dt: number): void {
		const ctx = this.ctx;
		const player = ctx.player;
		const p = player.position;
		const veg = ctx.world.vegetation;
		const time = ctx.time;

		// --- Flowers: pollen on contact, pollen bombs on hard hits --------------------
		this.nearFlower = null;
		let bestD = Infinity;
		const speed = player.velocity.length();
		veg.flowers.query(p.x, p.z, 8, (f) => {
			if (!veg.isFlowerVisible(f)) return;
			const dx = p.x - f.x;
			const dy = p.y - f.y;
			const dz = p.z - f.z;
			const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
			const reach = f.r + BEE_RADIUS;
			if (d < reach + 2.5 && d < bestD && f.nectarAt <= time) {
				bestD = d;
				this.nearFlower = f;
			}
			if (d > reach) return;
			if (f.hitCooldown > 0) return;
			const power = speed * ctx.abilities.impactPower();
			if (power > 13) {
				f.hitCooldown = 3;
				veg.touchFlower(f, player.velocity.x, player.velocity.z, 1.4);
				_v.set(f.x, f.y, f.z);
				if (f.type === 'dandelion') {
					ctx.effects.emit('seeds', _v, 40, f.r);
					veg.hideFlower(f, time, 40);
					ctx.chaos.add('dandelion', _v);
					ctx.audio.play('pop', { pitch: 0.6, volume: 0.5 });
				} else {
					ctx.effects.emit('pollen', _v, 36, f.r * 0.6);
					ctx.chaos.add('pollen_bomb', _v);
					ctx.audio.play('bump', { pitch: 1.6, volume: 0.6 });
					this.addPollen(Math.round(5 * f.pollen));
					f.pollen = Math.max(0, f.pollen - 0.6);
				}
				ctx.cameraCtl.shake(0.12);
			} else {
				veg.touchFlower(f, dx || 0.1, dz || 0.1, 0.35);
				f.hitCooldown = 0.2;
				if (f.pollen > 0.05 && f.type !== 'dandelion') {
					f.pollen = Math.max(0, f.pollen - 0.08);
					this.addPollen(1);
					_v.set(f.x, f.y + 0.4, f.z);
					ctx.effects.emit('pollen', _v, 3, f.r * 0.4, _v.clone().sub(p).negate().normalize(), 3);
					this.tickTimer -= 1;
					if (this.tickTimer <= 0) {
						this.tickTimer = 2;
						ctx.audio.play('tick', { pitch: 0.9 + Math.random() * 0.4 });
					}
				}
			}
		});
		for (const f of veg.allFlowers) {
			// cheap pollen regeneration (only touched flowers drop below 1)
			if (f.pollen < 1) f.pollen = Math.min(1, f.pollen + dt * 0.02);
		}

		// --- Nectar deposit (auto when flying into the glowing cell) ------------------
		const dep = ctx.world.hive.info.nectarDeposit;
		this.nearDeposit = p.distanceTo(dep) < 7;
		if (this.nectar > 0 && p.distanceTo(dep) < 3.8) this.deliver();

		// --- Golden orbs -------------------------------------------------------
		for (let i = 0; i < this.orbs.length; i++) {
			const o = this.orbs[i];
			if (o.collected) {
				_m.makeScale(0, 0, 0);
				this.orbMesh.setMatrixAt(i, _m);
				this.haloMesh.setMatrixAt(i, _m);
				continue;
			}
			_v.copy(o.pos);
			_v.y += Math.sin(time * 2 + i) * 0.4;
			_q.setFromEuler(_e.set(0, time * 1.5 + i, 0));
			_s.setScalar(1);
			this.orbMesh.setMatrixAt(i, _m.compose(_v, _q, _s));
			_q.setFromEuler(_e.set(Math.PI / 2 + Math.sin(time + i) * 0.3, time * 0.8, 0));
			_s.setScalar(1 + Math.sin(time * 3 + i) * 0.08);
			this.haloMesh.setMatrixAt(i, _m.compose(_v, _q, _s));
			if (_v.distanceToSquared(p) < 3.2 * 3.2 && ctx.playing) this.collectOrb(o);
			else if (Math.random() < dt * 3 && _v.distanceToSquared(p) < 80 * 80) ctx.effects.emit('sparkle', _v, 1, 1);
		}
		this.orbMesh.instanceMatrix.needsUpdate = true;
		this.haloMesh.instanceMatrix.needsUpdate = true;

		// --- Discovery ----------------------------------------------------------
		this.discoverTimer -= dt;
		if (this.discoverTimer <= 0 && ctx.playing) {
			this.discoverTimer = 0.4;
			const region = ctx.world.regionAt(p);
			if (region !== this.region) {
				this.region = region;
				this.discover(`region-${region}`, `Discovered: ${REGION_NAMES[region]}`, 'New region');
				const regions: RegionId[] = ['meadow', 'forest', 'hive', 'peaks'];
				if (regions.every((r) => ctx.save.data.discovered.includes(`region-${r}`))) ctx.achievements.unlock('explorer');
			}
			for (const l of LANDMARKS) {
				if (Math.hypot(p.x - l.x, p.z - l.z) < l.r * 0.7) this.discover(`lm-${l.id}`, `${l.icon} ${l.name}`, l.secret ? 'Secret location found!' : 'Landmark discovered');
			}
			const ch = ctx.world.hiveChamberAt(p);
			if (ch !== this.chamber) {
				this.chamber = ch;
				if (ch) {
					const def = HIVE_CHAMBERS.find((c) => c.id === ch)!;
					this.discover(`ch-${ch}`, `🍯 ${def.name}`, 'Hive chamber explored');
					ctx.challenges.onChamber(ch);
					if (HIVE_CHAMBERS.every((c) => ctx.save.data.discovered.includes(`ch-${c.id}`))) ctx.achievements.unlock('hive_mind');
				}
			}
		}
	}

	private addPollen(n: number): void {
		this.pollen += n;
		this.ctx.save.data.totalPollen += n;
		this.ctx.challenges.onPollen(n);
	}

	private collectOrb(o: Orb): void {
		const ctx = this.ctx;
		o.collected = true;
		ctx.save.addUnique('orbs', o.id);
		ctx.effects.emit('sparkle', o.pos, 50, 1.5);
		ctx.effects.emit('confetti', o.pos, 20, 1);
		ctx.audio.play('ring');
		ctx.audio.play('chime', { pitch: 1.5 });
		ctx.popups.show('Golden Pollen!', o.pos, 'collect', 2);
		const n = this.orbsCollected;
		ctx.ui.notify(`✨ Golden Pollen ${n}/${this.orbs.length}`, o.hint, 'discovery');
		if (n >= this.orbs.length) ctx.achievements.unlock('collector');
	}

	trySipNectar(): boolean {
		const ctx = this.ctx;
		const f = this.nearFlower;
		if (!f || this.nectar >= NECTAR_CAP) return false;
		this.nectar++;
		f.nectarAt = ctx.time + 50;
		ctx.world.vegetation.touchFlower(f, 0.3, 0.3, 0.6);
		_v.set(f.x, f.y, f.z);
		ctx.effects.emit('sparkle', _v, 10, f.r * 0.4);
		ctx.audio.play('chime', { pitch: 0.9 + this.nectar * 0.05 });
		ctx.popups.show(`+1 Nectar (${this.nectar}/${NECTAR_CAP})`, _v.setY(_v.y + 1.5), 'collect', 1.4);
		ctx.challenges.onNectar();
		return true;
	}

	tryDeliver(): boolean {
		if (!this.nearDeposit || this.nectar <= 0) return false;
		this.deliver();
		return true;
	}

	private deliver(): void {
		const ctx = this.ctx;
		const n = this.nectar;
		this.nectar = 0;
		ctx.save.data.honey += n;
		ctx.save.data.totalNectar += n;
		ctx.save.markDirty();
		const dep = ctx.world.hive.info.nectarDeposit;
		ctx.effects.emit('honey', dep, 20 + n * 3, 1.5);
		ctx.effects.emit('sparkle', dep, 20, 2);
		ctx.audio.play('fanfare');
		ctx.popups.show(`+${n} Honey!`, dep.clone().setY(dep.y + 3), 'collect', 2);
		ctx.ui.notify(`Delivered ${n} nectar`, `Hive honey: ${ctx.save.data.honey}`, 'info');
		if (ctx.save.data.totalNectar >= 25) ctx.achievements.unlock('nectar_ninja');
		ctx.challenges.onDeliver(n);
	}

	promptText(): string {
		if (this.nearDeposit && this.nectar > 0) return `[E] Deliver ${this.nectar} nectar`;
		if (this.nearFlower) return this.nectar >= NECTAR_CAP ? 'Nectar full! Deliver it to the hive' : `[E] Sip nectar (${this.nectar}/${NECTAR_CAP})`;
		return '';
	}

	dispose(): void {
		this.orbMesh.geometry.dispose();
		(this.orbMesh.material as THREE.Material).dispose();
		this.haloMesh.geometry.dispose();
		(this.haloMesh.material as THREE.Material).dispose();
	}
}
