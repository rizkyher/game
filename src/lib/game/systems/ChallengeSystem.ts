import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { ChallengeHud } from '../core/types';
import { HIVE, HIVE_CHAMBERS, SPAWN, landmark } from '../world/Biomes';
import { canvasTexture } from '../utils/geometry';

type ChallengeId = 'race' | 'pollen' | 'nectar' | 'chaos' | 'hive';

interface ChallengeDef {
	id: ChallengeId;
	title: string;
	icon: string;
	desc: string;
	color: number;
	time: number;
	totem: THREE.Vector3;
}

interface Active {
	def: ChallengeDef;
	timeLeft: number;
	elapsed: number;
	count: number;
	target: number;
	ring: number;
	chambers: Set<string>;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

function fmtTime(s: number): string {
	const m = Math.floor(s / 60);
	const r = s - m * 60;
	return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}

/**
 * Optional mini activities started at glowing hexagon totems: a ring race, pollen rush,
 * nectar run, chaos combo and hive exploration. Free roam is never interrupted.
 */
export class ChallengeSystem {
	readonly defs: ChallengeDef[];
	active: Active | null = null;
	private totems: THREE.Group[] = [];
	private caps: THREE.Object3D[] = [];
	private rings: THREE.Mesh[] = [];
	private ringNormals: THREE.Vector3[] = [];
	private ringMat: THREE.MeshStandardMaterial;
	private ringNextMat: THREE.MeshStandardMaterial;
	private lastSide = 0;
	private nearTotem: ChallengeDef | null = null;
	private disposables: { dispose(): void }[] = [];

	constructor(private ctx: GameContext) {
		const t = ctx.world.terrain;
		const g = (x: number, z: number, lift = 0) => new THREE.Vector3(x, t.heightAt(x, z) + lift, z);
		const sun = landmark('sunflowers');
		const pic = landmark('picnic');
		const hiveOut = ctx.world.hive.info.entranceOutside;
		this.defs = [
			{ id: 'race', title: 'Meadow Dash', icon: '🏁', desc: 'Fly through all 14 rings as fast as you can.', color: 0x40c4ff, time: 240, totem: g(SPAWN.x - 18, SPAWN.z + 4) },
			{ id: 'pollen', title: 'Pollen Rush', icon: '🌼', desc: 'Collect 80 pollen in 60 seconds.', color: 0xffeb3b, time: 60, totem: g(sun.x - 60, sun.z - 10) },
			{ id: 'nectar', title: 'Nectar Run', icon: '🍯', desc: 'Deliver 8 nectar to the hive within 4 minutes.', color: 0xffa000, time: 240, totem: g(hiveOut.x + 8, hiveOut.z + 10) },
			{ id: 'chaos', title: 'Chaos Combo', icon: '💥', desc: 'Earn 1,500 chaos within 60 seconds.', color: 0xff4081, time: 60, totem: g(pic.x + 26, pic.z - 4) },
			{ id: 'hive', title: 'Hive Explorer', icon: '🏠', desc: 'Visit every chamber of the hive.', color: 0xb388ff, time: 300, totem: new THREE.Vector3(HIVE.x + 6, HIVE.baseY, HIVE.z + 10) }
		];
		const pillarGeo = new THREE.CylinderGeometry(1.6, 2, 5, 6);
		const capGeo = new THREE.OctahedronGeometry(1.2, 0);
		this.disposables.push(pillarGeo, capGeo);
		for (const d of this.defs) {
			const grp = new THREE.Group();
			grp.position.copy(d.totem);
			const mat = new THREE.MeshStandardMaterial({ color: d.color, emissive: d.color, emissiveIntensity: 0.55, roughness: 0.3 });
			const pillar = new THREE.Mesh(pillarGeo, mat);
			pillar.position.y = 2.5;
			pillar.castShadow = true;
			const cap = new THREE.Mesh(capGeo, mat);
			cap.position.y = 6.6;
			const tex = canvasTexture(128, 128, (c) => {
				c.font = '92px serif';
				c.textAlign = 'center';
				c.textBaseline = 'middle';
				c.fillText(d.icon, 64, 70);
			});
			const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
			sprite.position.y = 9.4;
			sprite.scale.setScalar(3.2);
			grp.add(pillar, cap, sprite);
			this.caps.push(cap);
			ctx.scene.add(grp);
			ctx.physics.addCylinder(d.totem.x, d.totem.y + 2.5, d.totem.z, 2.5, 1.8, { kind: 'static', material: 'stone' });
			this.totems.push(grp);
			this.disposables.push(mat, tex, sprite.material);
		}

		// Race course rings.
		const course: [number, number, number][] = [
			[-10, 95, 10],
			[-95, 70, 18],
			[-180, 45, 12],
			[-262, 20, 9],
			[-212, -60, 8],
			[-196, -128, 10],
			[-120, -185, 30],
			[-20, -215, 26],
			[90, -225, 22],
			[160, -110, 30],
			[230, -40, 52],
			[255, 120, 24],
			[150, 230, 14],
			[60, 150, 8]
		];
		this.ringMat = new THREE.MeshStandardMaterial({ color: 0x80d8ff, emissive: 0x40c4ff, emissiveIntensity: 0.4, transparent: true, opacity: 0.45 });
		this.ringNextMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd740, emissiveIntensity: 1.2 });
		const ringGeo = new THREE.TorusGeometry(5.5, 0.55, 10, 36);
		this.disposables.push(this.ringMat, this.ringNextMat, ringGeo);
		const pts = course.map(([x, z, alt]) => g(x, z, alt));
		pts.forEach((p, i) => {
			const next = pts[(i + 1) % pts.length];
			const prev = pts[(i + pts.length - 1) % pts.length];
			const n = next.clone().sub(prev).normalize();
			const ring = new THREE.Mesh(ringGeo, this.ringMat);
			ring.position.copy(p);
			ring.lookAt(p.clone().add(n));
			ring.visible = false;
			ctx.scene.add(ring);
			this.rings.push(ring);
			this.ringNormals.push(n);
		});
	}

	private def(id: ChallengeId): ChallengeDef {
		return this.defs.find((d) => d.id === id)!;
	}

	bestText(id: ChallengeId): string {
		const s = this.ctx.save.data;
		if (id === 'race' && s.raceBest) return ` (best ${fmtTime(s.raceBest)})`;
		return s.challengesDone.includes(id) ? ' ✓' : '';
	}

	start(id: ChallengeId): void {
		const ctx = this.ctx;
		const def = this.def(id);
		const targets: Record<ChallengeId, number> = { race: this.rings.length, pollen: 80, nectar: 8, chaos: 1500, hive: HIVE_CHAMBERS.length };
		this.active = { def, timeLeft: def.time, elapsed: 0, count: 0, target: targets[id], ring: 0, chambers: new Set() };
		ctx.ui.notify(`${def.icon} ${def.title}`, def.desc, 'challenge');
		ctx.audio.play('fanfare');
		if (id === 'race') {
			for (const r of this.rings) r.visible = true;
			this.highlightRing();
			this.lastSide = this.sideOf(0);
		}
		if (id === 'hive') {
			const ch = ctx.world.hiveChamberAt(ctx.player.position);
			if (ch) this.onChamber(ch);
		}
	}

	abandon(): void {
		if (!this.active) return;
		this.ctx.ui.notify('Challenge abandoned', this.active.def.title, 'info');
		this.end();
	}

	private end(): void {
		this.active = null;
		for (const r of this.rings) r.visible = false;
	}

	private complete(): void {
		const ctx = this.ctx;
		const a = this.active!;
		const id = a.def.id;
		ctx.save.addUnique('challengesDone', id);
		let detail = 'Challenge complete!';
		if (id === 'race') {
			const best = ctx.save.data.raceBest;
			if (!best || a.elapsed < best) {
				ctx.save.data.raceBest = a.elapsed;
				detail = `New best time: ${fmtTime(a.elapsed)}!`;
			} else detail = `Time ${fmtTime(a.elapsed)} (best ${fmtTime(best)})`;
			if (a.elapsed < 70) ctx.achievements.unlock('speed_demon');
		}
		ctx.save.markDirty();
		ctx.ui.notify(`🏆 ${a.def.title} complete!`, detail, 'challenge');
		ctx.audio.play('fanfare');
		ctx.effects.emit('confetti', ctx.player.position, 60, 2);
		this.end();
	}

	private fail(): void {
		const a = this.active!;
		this.ctx.ui.notify(`⏱️ ${a.def.title} — time's up!`, `${Math.floor(a.count)}/${a.target}`, 'warning');
		this.ctx.audio.play('notify');
		this.end();
	}

	private sideOf(i: number): number {
		_v.copy(this.ctx.player.position).sub(this.rings[i].position);
		return Math.sign(_v.dot(this.ringNormals[i])) || 1;
	}

	private highlightRing(): void {
		const a = this.active;
		this.rings.forEach((r, i) => {
			r.material = a && i === a.ring ? this.ringNextMat : this.ringMat;
			r.visible = !!a && a.def.id === 'race' && i >= a.ring;
		});
	}

	onPollen(n: number): void {
		if (this.active?.def.id === 'pollen') this.active.count += n;
	}

	onNectar(): void {}

	onDeliver(n: number): void {
		if (this.active?.def.id === 'nectar') this.active.count += n;
	}

	onChaos(pts: number, _mult: number): void {
		if (this.active?.def.id === 'chaos') this.active.count += pts;
	}

	onChamber(id: string): void {
		const a = this.active;
		if (a?.def.id !== 'hive') return;
		if (!a.chambers.has(id)) {
			a.chambers.add(id);
			a.count = a.chambers.size;
			this.ctx.audio.play('chime');
		}
	}

	tryInteract(): boolean {
		if (!this.nearTotem || this.active) return false;
		this.start(this.nearTotem.id);
		return true;
	}

	promptText(): string {
		if (!this.nearTotem) return '';
		if (this.active) return this.active.def.id === this.nearTotem.id ? '' : 'Finish your current challenge first';
		return `[E] Start ${this.nearTotem.icon} ${this.nearTotem.title}${this.bestText(this.nearTotem.id)}`;
	}

	update(dt: number): void {
		const ctx = this.ctx;
		const p = ctx.player.position;
		this.nearTotem = null;
		for (let i = 0; i < this.totems.length; i++) {
			const cap = this.caps[i];
			cap.rotation.y += dt * 1.5;
			cap.position.y = 6.6 + Math.sin(ctx.time * 2 + i) * 0.3;
			if (this.totems[i].position.distanceTo(p) < 8) this.nearTotem = this.defs[i];
		}
		const a = this.active;
		if (!a) return;
		a.elapsed += dt;
		a.timeLeft -= dt;
		if (a.def.id === 'race') {
			const ring = this.rings[a.ring];
			ring.rotation.z += dt;
			const side = this.sideOf(a.ring);
			const d = p.distanceTo(ring.position);
			if (side !== this.lastSide && d < 6.5) {
				a.ring++;
				a.count = a.ring;
				ctx.audio.play('ring', { pitch: 1 + a.ring * 0.04 });
				ctx.effects.emit('sparkle', ring.position, 30, 3);
				if (a.ring >= this.rings.length) {
					this.complete();
					return;
				}
				this.highlightRing();
				this.lastSide = this.sideOf(a.ring);
			} else if (d > 12) this.lastSide = side;
		}
		if (a.count >= a.target) {
			this.complete();
			return;
		}
		if (a.timeLeft <= 0) this.fail();
	}

	hud(): ChallengeHud | null {
		const a = this.active;
		if (!a) return null;
		const ctx = this.ctx;
		let detail = '';
		switch (a.def.id) {
			case 'race':
				detail = `Ring ${a.ring + 1}/${a.target} · ${fmtTime(a.elapsed)}`;
				break;
			case 'pollen':
				detail = `Pollen ${Math.floor(a.count)}/${a.target}`;
				break;
			case 'nectar':
				detail = `Delivered ${a.count}/${a.target} · carrying ${ctx.collection.nectar}`;
				break;
			case 'chaos':
				detail = `Chaos ${a.count}/${a.target}`;
				break;
			case 'hive':
				detail = `Chambers ${a.count}/${a.target}`;
				break;
		}
		let target: THREE.Vector3 | null = null;
		if (a.def.id === 'race') target = this.rings[a.ring].position;
		else if (a.def.id === 'nectar' && ctx.collection.nectar >= 3) target = ctx.world.hive.info.nectarDeposit;
		let arrow: number | null = null;
		if (target) {
			const cam = ctx.camera;
			_n.copy(target).sub(cam.position);
			const yawTo = Math.atan2(_n.x, _n.z);
			const camYaw = Math.atan2(-Math.sin(ctx.cameraCtl.yaw), -Math.cos(ctx.cameraCtl.yaw));
			arrow = Math.atan2(Math.sin(yawTo - camYaw), Math.cos(yawTo - camYaw));
		}
		return { id: a.def.id, title: `${a.def.icon} ${a.def.title}`, detail, progress: Math.min(1, a.count / a.target), timeLeft: a.def.id === 'race' || a.def.id === 'hive' ? null : Math.max(0, a.timeLeft), arrow };
	}

	dispose(): void {
		for (const d of this.disposables) d.dispose();
		for (const g of this.totems) g.removeFromParent();
		for (const r of this.rings) r.removeFromParent();
	}
}
