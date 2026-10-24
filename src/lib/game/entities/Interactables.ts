import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { ITEMS } from '../systems/Inventory';
import { WAYSTONES } from '../world/WorldLayout';
import { LORE } from '../systems/Lore';

export interface Interactable {
	id: string;
	pos: THREE.Vector3;
	radius: number;
	/** Text shown after "[E]"; null when not usable right now. */
	prompt(): string | null;
	use(): void;
	update?(dt: number, time: number): void;
	/** Snap visuals to the saved state without effects (after loading). */
	sync?(): void;
}

interface ChestDef {
	id: string;
	pos: THREE.Vector3;
	ry: number;
	loot: { id: string; n: number }[];
	exp: number;
}

/** Contents of every cache in the world, keyed by anchor id. */
const CHEST_LOOT: Record<string, { loot: { id: string; n: number }[]; exp: number }> = {
	'hollow-cache': { loot: [{ id: 'health_potion', n: 2 }], exp: 10 },
	'falls-cache': { loot: [{ id: 'frost_charm', n: 1 }, { id: 'mana_potion', n: 2 }], exp: 60 },
	'grotto-cache': { loot: [{ id: 'ember_locket', n: 1 }, { id: 'health_potion', n: 2 }], exp: 80 },
	'isles-cache': { loot: [{ id: 'storm_lens', n: 1 }, { id: 'mana_potion', n: 1 }], exp: 90 },
	'tower-cache': { loot: [{ id: 'tome_insight', n: 1 }, { id: 'health_potion', n: 1 }], exp: 70 },
	'academy-cache': { loot: [{ id: 'tome_insight', n: 1 }, { id: 'mana_potion', n: 2 }], exp: 80 },
	'library-relic': { loot: [{ id: 'scholar_quill', n: 1 }], exp: 90 },
	'warden-cache': { loot: [{ id: 'grove_sigil', n: 1 }, { id: 'health_potion', n: 1 }], exp: 70 },
	'crypt-cache': { loot: [{ id: 'health_potion', n: 2 }, { id: 'mana_potion', n: 2 }], exp: 60 }
};

export const CRYSTALS: { id: string; name: string; encounter: string; anchor: 'shrineAltar' | 'fallsLedge' | 'spirePedestal' }[] = [
	{ id: 'crystal_verdance', name: 'Crystal of Verdance', encounter: 'shrine_guard', anchor: 'shrineAltar' },
	{ id: 'crystal_moonwell', name: 'Crystal of the Moonwell', encounter: 'falls_guard', anchor: 'fallsLedge' },
	{ id: 'crystal_starfall', name: 'Crystal of Starfall', encounter: 'spire_guard', anchor: 'spirePedestal' }
];

const _v = new THREE.Vector3();

/**
 * Everything the player can use with E: waystones (checkpoints + saving), loot caches,
 * the three Arcane Crystals (sealed until their guardians fall), lore inscriptions and
 * the Seal Gate. Also aggregates NPC talk prompts.
 */
export class Interactables {
	readonly list: Interactable[] = [];
	prompt = '';
	private current: Interactable | null = null;
	private time = 0;
	private group = new THREE.Group();
	private geos: THREE.BufferGeometry[] = [];
	private mats: THREE.Material[] = [];
	/** Seal state (owned here, read by the quest). */
	sealOpen = false;
	private barrierCollider: ReturnType<GameContext['physics']['addBarrier']> | null = null;
	private barrierMesh: THREE.Mesh | null = null;
	private socketGems: THREE.Mesh[] = [];
	private sealAnim = -1;

	constructor(private ctx: GameContext) {
		this.group.name = 'interactables';
		ctx.scene.add(this.group);
		this.buildWaystones();
		this.buildChests();
		this.buildCrystals();
		this.buildLore();
		this.buildSeal();
	}

	register(i: Interactable): void {
		this.list.push(i);
	}

	private g<T extends THREE.BufferGeometry>(x: T): T {
		this.geos.push(x);
		return x;
	}

	private m<T extends THREE.Material>(x: T): T {
		this.mats.push(x);
		return x;
	}

	// ------------------------------------------------------------------ waystones

	private buildWaystones(): void {
		const ctx = this.ctx;
		const stoneGeo = this.g(new THREE.CylinderGeometry(0.32, 0.55, 3.2, 6));
		stoneGeo.translate(0, 1.6, 0);
		const baseGeo = this.g(new THREE.CylinderGeometry(1.3, 1.5, 0.4, 8));
		baseGeo.translate(0, 0.2, 0);
		const runeGeo = this.g(new THREE.BoxGeometry(0.1, 1.6, 0.66));
		const ringGeo = this.g(new THREE.TorusGeometry(0.9, 0.05, 6, 40));
		const gemGeo = this.g(new THREE.OctahedronGeometry(0.32, 0));
		const stoneMat = this.m(new THREE.MeshStandardMaterial({ color: 0x6a6478, roughness: 0.9, flatShading: true }));
		for (const w of WAYSTONES) {
			const y = ctx.world.terrain.heightAt(w.x, w.z);
			const root = new THREE.Group();
			root.position.set(w.x, y - 0.1, w.z);
			const glow = this.m(new THREE.MeshStandardMaterial({ color: 0x0a1a24, emissive: 0x6ae6ff, emissiveIntensity: 0.3, roughness: 0.4 }));
			const base = new THREE.Mesh(baseGeo, stoneMat);
			const stone = new THREE.Mesh(stoneGeo, stoneMat);
			stone.castShadow = true;
			base.receiveShadow = true;
			root.add(base, stone);
			for (let i = 0; i < 3; i++) {
				const r = new THREE.Mesh(runeGeo, glow);
				const a = (i / 3) * Math.PI * 2;
				r.position.set(Math.cos(a) * 0.36, 1.6, Math.sin(a) * 0.36);
				r.rotation.y = -a;
				r.scale.set(1, 1, 0.35);
				root.add(r);
			}
			const ring = new THREE.Mesh(ringGeo, glow);
			ring.position.y = 3.6;
			ring.rotation.x = Math.PI / 2;
			const gem = new THREE.Mesh(gemGeo, glow);
			gem.position.y = 3.6;
			gem.scale.set(1, 1.6, 1);
			root.add(ring, gem);
			this.group.add(root);
			ctx.physics.addCylinder(w.x, y + 1.5, w.z, 1.5, 0.55, { kind: 'static', material: 'stone' });
			const pos = new THREE.Vector3(w.x, y, w.z);
			let pulse = 0;
			this.register({
				id: `waystone-${w.id}`,
				pos,
				radius: 3.2,
				prompt: () => (ctx.flow.isCheckpoint(w.id) ? `Rest at ${w.name}` : `Attune Waystone · ${w.name}`),
				use: () => {
					if (ctx.player.inCombat && ctx.enemies.engagedCount() > 0) {
						ctx.ui.notify('Enemies are near', 'You cannot rest while foes hunt you.', 'warning');
						return;
					}
					const first = !ctx.flow.isCheckpoint(w.id);
					ctx.flow.setCheckpoint(w.id);
					ctx.player.heal(ctx.player.maxHp);
					ctx.player.restoreMana(ctx.player.maxMana);
					ctx.player.statuses.clear();
					ctx.enemies.resetEncounters();
					ctx.enemies.setCleared(ctx.save.data.cleared);
					const saved = ctx.flow.save();
					pulse = 1.2;
					ctx.vfx.levelUp(_v.copy(pos).setY(pos.y + 0.2));
					ctx.vfx.circles.spawn(pos, 3, 0x6ae6ff, 1.6, { spin: 1, intensity: 2.5 });
					ctx.audio.sfx('waystone', pos);
					if (first) {
						ctx.progression.addExp(25);
						ctx.ui.banner(w.name, 'Waystone attuned', 'discovery');
					}
					ctx.ui.notify(first ? 'Waystone attuned' : 'Rested', saved ? 'Progress saved. You will return here if you fall.' : 'Saving is unavailable in this browser.', 'info');
					ctx.events.emit('checkpoint', { id: w.id });
				},
				update: (dt, time) => {
					const active = ctx.flow.isCheckpoint(w.id);
					pulse = Math.max(0, pulse - dt);
					glow.emissiveIntensity = (active ? 2.2 + Math.sin(time * 2 + w.x) * 0.5 : 0.35) + pulse * 6;
					ring.rotation.z = time * (active ? 0.8 : 0.15);
					gem.rotation.y = time * 1.2;
					gem.position.y = 3.6 + Math.sin(time * 1.5 + w.z) * 0.12;
				}
			});
		}
	}

	// ------------------------------------------------------------------ chests

	private buildChests(): void {
		const ctx = this.ctx;
		const a = ctx.world.structures.anchors;
		const defs: ChestDef[] = a.chests.map((c) => ({ id: c.id, pos: c.pos.clone(), ry: c.ry, ...(CHEST_LOOT[c.id] ?? { loot: [{ id: 'health_potion', n: 1 }], exp: 30 }) }));
		defs.push({ id: 'grotto-cache', pos: a.grottoChest.clone(), ry: Math.PI / 2, ...CHEST_LOOT['grotto-cache'] });
		defs.push({ id: 'library-relic', pos: a.libraryRelic.clone(), ry: 0.4, ...CHEST_LOOT['library-relic'] });
		defs.push({ id: 'crypt-cache', pos: a.cryptRelic.clone(), ry: Math.PI / 2, ...CHEST_LOOT['crypt-cache'] });
		const wx = -262;
		const wz = -30;
		defs.push({ id: 'warden-cache', pos: new THREE.Vector3(wx, ctx.world.terrain.heightAt(wx, wz), wz), ry: 1.2, ...CHEST_LOOT['warden-cache'] });

		const body = this.g(new THREE.BoxGeometry(1.1, 0.6, 0.7));
		body.translate(0, 0.3, 0);
		const lid = this.g(new THREE.CylinderGeometry(0.35, 0.35, 1.1, 10, 1, false, 0, Math.PI));
		lid.rotateZ(Math.PI / 2);
		lid.rotateX(-Math.PI / 2);
		lid.translate(0, 0, 0.35);
		const band = this.g(new THREE.BoxGeometry(1.14, 0.08, 0.74));
		const lock = this.g(new THREE.OctahedronGeometry(0.09, 0));
		const wood = this.m(new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.8 }));
		const gold = this.m(new THREE.MeshStandardMaterial({ color: 0xd4a64a, roughness: 0.35, metalness: 0.85 }));
		for (const d of defs) {
			const root = new THREE.Group();
			root.position.copy(d.pos);
			root.rotation.y = d.ry;
			const glow = this.m(new THREE.MeshStandardMaterial({ color: 0x221a10, emissive: 0xffc860, emissiveIntensity: 2.5 }));
			const b = new THREE.Mesh(body, wood);
			b.castShadow = true;
			const hinge = new THREE.Group();
			hinge.position.set(0, 0.6, -0.35);
			const l = new THREE.Mesh(lid, wood);
			l.castShadow = true;
			hinge.add(l);
			const b1 = new THREE.Mesh(band, gold);
			b1.position.y = 0.15;
			const b2 = new THREE.Mesh(band, gold);
			b2.position.y = 0.5;
			const lk = new THREE.Mesh(lock, glow);
			lk.position.set(0, 0.55, 0.37);
			root.add(b, hinge, b1, b2, lk);
			this.group.add(root);
			const isOpen = () => ctx.save.data.opened.includes(d.id);
			let openT = isOpen() ? 1 : 0;
			const relic = d.loot.find((x) => ITEMS[x.id]?.kind === 'relic');
			this.register({
				id: `chest-${d.id}`,
				pos: d.pos,
				radius: 2.4,
				prompt: () => (isOpen() ? null : relic ? 'Open Ancient Reliquary' : 'Open Arcane Cache'),
				use: () => {
					if (isOpen()) return;
					ctx.save.data.opened.push(d.id);
					for (const it of d.loot) {
						const added = ctx.inventory.add(it.id, it.n);
						const def = ITEMS[it.id];
						if (it.id === 'tome_insight' && added > 0) {
							ctx.inventory.remove('tome_insight', added);
							ctx.progression.data.skillPoints += added;
							ctx.progression.invalidate();
							ctx.ui.notify('Tome of Insight', '+1 skill point — open the Skill Tree [K]', 'level');
						} else if (def.kind === 'relic') ctx.ui.banner(def.name, def.desc, 'discovery');
						else ctx.ui.notify(`+${it.n} ${def.name}`, def.desc, 'item');
					}
					ctx.progression.addExp(d.exp);
					ctx.vfx.sparkle(_v.copy(d.pos).setY(d.pos.y + 0.9), 0xffd070, 30);
					ctx.vfx.burst(_v, 'glow', 0xfff0c0, 0xffa040, 20, 3, 1, 0.25, { up: 3, intensity: 2.5 });
					ctx.audio.sfx('chest', d.pos);
					ctx.flow.save();
				},
				update: (dt, time) => {
					const target = isOpen() ? 1 : 0;
					openT += (target - openT) * Math.min(1, dt * 4);
					hinge.rotation.x = -openT * 1.9;
					glow.emissiveIntensity = isOpen() ? 0.2 : 2 + Math.sin(time * 3 + d.pos.x) * 0.8;
				},
				sync: () => {
					openT = isOpen() ? 1 : 0;
				}
			});
		}
	}

	// ------------------------------------------------------------------ crystals

	private buildCrystals(): void {
		const ctx = this.ctx;
		const a = ctx.world.structures.anchors;
		const gemGeo = this.g(new THREE.OctahedronGeometry(0.45, 0));
		gemGeo.scale(1, 1.8, 1);
		const shellGeo = this.g(new THREE.IcosahedronGeometry(0.95, 1));
		for (const c of CRYSTALS) {
			const pos = a[c.anchor].clone();
			const gemMat = this.m(new THREE.MeshStandardMaterial({ color: 0xe8d0ff, emissive: 0xb070ff, emissiveIntensity: 3, roughness: 0.15, metalness: 0.2, flatShading: true }));
			const shellMat = this.m(
				new THREE.MeshStandardMaterial({ color: 0x1a0a24, emissive: 0x6a10a0, emissiveIntensity: 1.2, roughness: 0.3, transparent: true, opacity: 0.6, depthWrite: false, flatShading: true })
			);
			const gem = new THREE.Mesh(gemGeo, gemMat);
			const shell = new THREE.Mesh(shellGeo, shellMat);
			gem.position.copy(pos).setY(pos.y + 1.2);
			shell.position.copy(gem.position);
			this.group.add(gem, shell);
			const collected = () => ctx.save.data.quest.crystals.includes(c.id);
			const unsealed = () => ctx.enemies.isCleared(c.encounter);
			let shellK = unsealed() ? 0 : 1;
			let shattered = unsealed();
			gem.visible = shell.visible = !collected();
			this.register({
				id: c.id,
				pos,
				radius: 3,
				prompt: () => {
					if (collected()) return null;
					if (!unsealed()) return `${c.name} · sealed — defeat its guardians`;
					return `Take the ${c.name}`;
				},
				use: () => {
					if (collected() || !unsealed()) {
						if (!unsealed()) ctx.audio.sfx('fizzle', pos);
						return;
					}
					ctx.save.data.quest.crystals.push(c.id);
					ctx.inventory.add('arcane_crystal', 1);
					gem.visible = false;
					ctx.vfx.levelUp(pos);
					ctx.vfx.sparkle(gem.position, 0xd090ff, 40);
					ctx.audio.sfx('crystal', pos);
					const n = ctx.save.data.quest.crystals.length;
					ctx.ui.banner(c.name, `Arcane Crystal recovered (${n}/3)`, 'quest');
					ctx.progression.addExp(120);
					ctx.events.emit('crystal', { id: c.id, count: n });
					ctx.flow.save();
				},
				update: (dt, time) => {
					if (collected()) {
						gem.visible = shell.visible = false;
						return;
					}
					gem.visible = true;
					if (!unsealed()) shattered = false;
					gem.rotation.y = time * 1.4;
					gem.position.y = pos.y + 1.2 + Math.sin(time * 2) * 0.12;
					if (unsealed() && !shattered) {
						shattered = true;
						ctx.vfx.burst(shell.position, 'shard', 0xd070ff, 0x400060, 40, 9, 1, 0.3, { gravity: -12 });
						ctx.vfx.reaction('shatter', shell.position, 2);
						ctx.audio.sfx('barrier_break', shell.position);
						ctx.ui.notify('The corruption breaks', `${c.name} is free. Take it [E].`, 'quest');
					}
					shellK += ((unsealed() ? 0 : 1) - shellK) * Math.min(1, dt * 4);
					shell.visible = shellK > 0.02;
					shell.scale.setScalar(0.4 + shellK * 0.6 + Math.sin(time * 3) * 0.03 * shellK);
					shell.rotation.y = -time * 0.5;
					gemMat.emissiveIntensity = unsealed() ? 3 + Math.sin(time * 4) * 1 : 1;
				},
				sync: () => {
					shattered = unsealed();
					shellK = shattered ? 0 : 1;
					gem.visible = shell.visible = !collected();
				}
			});
		}
	}

	// ------------------------------------------------------------------ lore

	private buildLore(): void {
		const ctx = this.ctx;
		const slab = this.g(new THREE.BoxGeometry(0.9, 1.3, 0.22));
		slab.translate(0, 0.65, 0);
		const glyphs = this.g(new THREE.PlaneGeometry(0.6, 0.9));
		glyphs.translate(0, 0.72, 0.115);
		const stone = this.m(new THREE.MeshStandardMaterial({ color: 0x7a7488, roughness: 0.9 }));
		const tex = this.loreTexture();
		for (const l of ctx.world.structures.anchors.lore) {
			const text = LORE[l.id];
			if (!text) continue;
			const glow = this.m(new THREE.MeshBasicMaterial({ map: tex, color: 0x9ad8ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
			const root = new THREE.Group();
			root.position.copy(l.pos);
			root.rotation.y = l.ry;
			root.rotation.x = -0.12;
			const s = new THREE.Mesh(slab, stone);
			s.castShadow = true;
			root.add(s, new THREE.Mesh(glyphs, glow));
			this.group.add(root);
			const read = () => ctx.save.data.lore.includes(l.id);
			this.register({
				id: l.id,
				pos: l.pos,
				radius: 2.4,
				prompt: () => `Read: ${text.title}`,
				use: () => {
					if (!read()) {
						ctx.save.data.lore.push(l.id);
						ctx.progression.addExp(15);
					}
					ctx.audio.sfx('lore', l.pos);
					ctx.npcs.showText(text.speaker, text.title, text.lines);
				},
				update: (_dt, time) => {
					glow.opacity = read() ? 0.35 : 0.6 + Math.sin(time * 2 + l.pos.x) * 0.3;
				}
			});
		}
	}

	private loreTexture(): THREE.Texture {
		const c = document.createElement('canvas');
		c.width = 128;
		c.height = 192;
		const g = c.getContext('2d')!;
		g.strokeStyle = 'white';
		g.lineWidth = 3;
		g.shadowColor = 'white';
		g.shadowBlur = 6;
		for (let row = 0; row < 7; row++) {
			let x = 14;
			while (x < 110) {
				const w = 8 + ((row * 7 + x) % 13);
				g.beginPath();
				g.moveTo(x, 22 + row * 24);
				g.lineTo(x + w * 0.5, 12 + row * 24 + ((x * 3) % 9));
				g.lineTo(x + w, 22 + row * 24);
				g.stroke();
				x += w + 6;
			}
		}
		const t = new THREE.CanvasTexture(c);
		t.colorSpace = THREE.SRGBColorSpace;
		this.mats.push({ dispose: () => t.dispose() } as unknown as THREE.Material);
		return t;
	}

	// ------------------------------------------------------------------ the Seal

	private buildSeal(): void {
		const ctx = this.ctx;
		const a = ctx.world.structures.anchors;
		const b = a.gateBarrier;
		const mat = this.m(
			new THREE.ShaderMaterial({
				uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uCrack: { value: 0 } },
				vertexShader: /* glsl */ `
					varying vec2 vUv;
					void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
				`,
				fragmentShader: /* glsl */ `
					uniform float uTime;
					uniform float uAlpha;
					uniform float uCrack;
					varying vec2 vUv;
					float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
					float noise(vec2 p) {
						vec2 i = floor(p); vec2 f = fract(p);
						vec2 u = f * f * (3.0 - 2.0 * f);
						return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
					}
					void main() {
						vec2 p = vUv * vec2(6.0, 6.0);
						float n = noise(p + vec2(uTime * 0.3, -uTime * 0.5)) * 0.6 + noise(p * 2.3 - uTime * 0.4) * 0.4;
						float bands = smoothstep(0.45, 0.55, abs(fract(n * 4.0) - 0.5) * 2.0);
						vec2 c = vUv - 0.5;
						float ring = smoothstep(0.02, 0.0, abs(length(c * vec2(1.0, 1.05)) - 0.3 - sin(uTime) * 0.01));
						float edge = smoothstep(0.5, 0.42, max(abs(c.x), abs(c.y)));
						vec3 col = mix(vec3(0.35, 0.05, 0.6), vec3(0.9, 0.5, 1.0), bands) * (1.2 + ring * 2.0);
						float cracks = smoothstep(0.92, 1.0, noise(vUv * 30.0)) * uCrack * 3.0;
						col += vec3(1.0, 0.9, 1.0) * cracks;
						float a = (0.28 + bands * 0.35 + ring * 0.6 + cracks) * edge * uAlpha;
						gl_FragColor = vec4(col * a, a);
					}
				`,
				transparent: true,
				depthWrite: false,
				side: THREE.DoubleSide,
				blending: THREE.CustomBlending,
				blendSrc: THREE.OneFactor,
				blendDst: THREE.OneFactor
			})
		);
		const plane = this.g(new THREE.PlaneGeometry(b.width, b.height));
		this.barrierMesh = new THREE.Mesh(plane, mat);
		this.barrierMesh.position.copy(b.center);
		this.barrierMesh.renderOrder = 15;
		this.group.add(this.barrierMesh);
		this.barrierCollider = ctx.physics.addBarrier(b.center.x, b.center.y, b.center.z, b.width / 2 + 0.5, b.height / 2, 0.6);
		const gemGeo = this.g(new THREE.OctahedronGeometry(0.55, 0));
		gemGeo.scale(1, 1.6, 1);
		for (const s of a.gateSockets) {
			const gm = this.m(new THREE.MeshStandardMaterial({ color: 0xe8d0ff, emissive: 0xb070ff, emissiveIntensity: 4, flatShading: true }));
			const gem = new THREE.Mesh(gemGeo, gm);
			gem.position.copy(s);
			gem.visible = false;
			this.group.add(gem);
			this.socketGems.push(gem);
		}
		const pos = new THREE.Vector3(b.center.x, ctx.world.terrain.heightAt(b.center.x, b.center.z + 5), b.center.z + 5);
		this.register({
			id: 'seal',
			pos,
			radius: 7,
			prompt: () => {
				if (this.sealOpen || this.sealAnim >= 0) return null;
				const n = ctx.save.data.quest.crystals.length;
				return n >= 3 ? 'Restore the Broken Seal' : `The Broken Seal — ${n}/3 Arcane Crystals`;
			},
			use: () => {
				if (this.sealOpen || this.sealAnim >= 0) return;
				const n = ctx.save.data.quest.crystals.length;
				if (n < 3) {
					ctx.ui.notify('The Seal holds fast', `It hungers for three Arcane Crystals. You carry ${n}.`, 'warning');
					ctx.audio.sfx('fizzle', pos);
					return;
				}
				this.sealAnim = 0;
				ctx.flow.cutscene(true);
				const g = ctx.world.terrain.heightAt(0, b.center.z + 22);
				ctx.cameraCtl.cutscene(new THREE.Vector3(8, g + 6, b.center.z + 26), new THREE.Vector3(-4, g + 4, b.center.z + 18), b.center.clone().setY(b.center.y + 4), 4.2);
				ctx.audio.sfx('seal', pos);
			},
			update: (dt, time) => this.updateSeal(dt, time)
		});
	}

	/** Called by the quest when the seal is already open in a loaded save. */
	setSealOpen(open: boolean): void {
		this.sealOpen = open;
		if (this.barrierMesh) this.barrierMesh.visible = !open;
		if (open && this.barrierCollider) {
			this.ctx.physics.removeCollider(this.barrierCollider);
			this.barrierCollider = null;
		} else if (!open && !this.barrierCollider) {
			const b = this.ctx.world.structures.anchors.gateBarrier;
			this.barrierCollider = this.ctx.physics.addBarrier(b.center.x, b.center.y, b.center.z, b.width / 2 + 0.5, b.height / 2, 0.6);
		}
		for (const g of this.socketGems) g.visible = open;
	}

	private updateSeal(dt: number, time: number): void {
		const ctx = this.ctx;
		const mat = this.barrierMesh?.material as THREE.ShaderMaterial | undefined;
		if (mat) mat.uniforms.uTime.value = time;
		for (const g of this.socketGems) if (g.visible) g.rotation.y = time;
		if (this.sealAnim < 0) return;
		this.sealAnim += dt;
		const t = this.sealAnim;
		// Crystals take their sockets one by one, the barrier cracks, then shatters.
		this.socketGems.forEach((g, i) => {
			const at = 0.6 + i * 0.7;
			if (!g.visible && t >= at) {
				g.visible = true;
				ctx.vfx.levelUp(g.position);
				ctx.vfx.sparkle(g.position, 0xd090ff, 30);
				ctx.audio.sfx('crystal', g.position, { pitch: 1 + i * 0.15 });
				ctx.feel.shake(0.15);
			}
		});
		if (mat) mat.uniforms.uCrack.value = Math.min(1, Math.max(0, (t - 2.4) / 1.0));
		if (t >= 3.4 && !this.sealOpen) {
			const c = ctx.world.structures.anchors.gateBarrier.center;
			for (let i = 0; i < 6; i++) ctx.vfx.burst(_v.set(c.x + (Math.random() - 0.5) * 16, c.y + (Math.random() - 0.5) * 14, c.z), 'shard', 0xe8b0ff, 0x6020a0, 30, 12, 1.2, 0.35, { gravity: -10 });
			ctx.vfx.explosion(_v.copy(c), 6, 0xb070ff);
			ctx.feel.shake(0.7);
			ctx.audio.sfx('barrier_break', c);
			this.setSealOpen(true);
			for (const g of this.socketGems) g.visible = true;
			ctx.inventory.remove('arcane_crystal', 3);
			ctx.events.emit('sealOpened', {});
		}
		if (t >= 4.4) {
			this.sealAnim = -1;
			ctx.flow.cutscene(false);
			ctx.ui.banner('The Seal is broken', 'The Forgotten Sanctuary lies open', 'quest');
		}
	}

	// ------------------------------------------------------------------ per frame

	/** Re-apply the loaded save to every interactable (seal, chests, crystals). */
	sync(): void {
		const d = this.ctx.save.data;
		if (this.sealAnim >= 0) {
			this.sealAnim = -1;
			const mat = this.barrierMesh?.material as THREE.ShaderMaterial | undefined;
			if (mat) mat.uniforms.uCrack.value = 0;
		}
		this.setSealOpen(d.quest.stage >= 5 || d.bossDefeated);
		for (const i of this.list) i.sync?.();
	}

	interact(): void {
		if (this.current) this.current.use();
	}

	update(dt: number): void {
		const ctx = this.ctx;
		this.time += dt;
		const p = ctx.player.position;
		let best: Interactable | null = null;
		let bestD = Infinity;
		let bestPrompt = '';
		for (const i of this.list) {
			const dx = i.pos.x - p.x;
			const dz = i.pos.z - p.z;
			const d2 = dx * dx + dz * dz;
			// Only animate things near the camera.
			if (d2 < 200 * 200) i.update?.(dt, this.time);
			if (d2 > i.radius * i.radius || Math.abs(i.pos.y - p.y) > 4) continue;
			const pr = i.prompt();
			if (pr && d2 < bestD) {
				bestD = d2;
				best = i;
				bestPrompt = pr;
			}
		}
		this.current = ctx.player.alive && ctx.playing ? best : null;
		this.prompt = this.current ? bestPrompt : '';
	}

	dispose(): void {
		this.ctx.scene.remove(this.group);
		for (const g of this.geos) g.dispose();
		for (const m of this.mats) m.dispose();
	}
}
