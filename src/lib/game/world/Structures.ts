import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Terrain } from './Terrain';
import { Kit, StructureMaterials, shade, type Structure } from './StructureKit';
import * as F from './Flora';
import { place } from '../utils/geometry';
import { Random } from '../utils/Random';
import {
	ARENA,
	COURTYARD,
	CRYPT,
	CROSSROADS,
	FALLS,
	FALLS_CRYSTAL,
	GATE,
	GROTTO,
	HEIGHTS,
	HOLLOW,
	ISLES,
	LIBRARY,
	RING,
	SHRINE,
	SPIRE,
	TEMPLE
} from './WorldLayout';
import { worldUniforms } from './Materials';

const C = {
	stoneWarm: 0x9a8f80,
	stoneOld: 0x8c879a,
	stoneDark: 0x5a5466,
	marble: 0xc9c3d3,
	wood: 0x6a4a32,
	woodDark: 0x3a2a1e,
	plaster: 0xe6d8bc,
	slate: 0x3a4a6a,
	thatch: 0xb08a4a,
	roofRed: 0x8a3a2a,
	moss: 0x4a7a3a,
	cloth: [0xb03a3a, 0x3a6ab0, 0xd0a040, 0x6a3ab0]
};

interface Animated {
	obj: THREE.Object3D;
	kind: 'bob' | 'spin' | 'orbit';
	base: THREE.Vector3;
	amp: number;
	speed: number;
	phase: number;
}

/** Named positions other systems hang gameplay objects on (pedestals, chests, sockets). */
export interface Anchors {
	shrineAltar: THREE.Vector3;
	fallsLedge: THREE.Vector3;
	spirePedestal: THREE.Vector3;
	grottoChest: THREE.Vector3;
	islesTop: THREE.Vector3;
	libraryRelic: THREE.Vector3;
	templeAltar: THREE.Vector3;
	cryptRelic: THREE.Vector3;
	ringCenter: THREE.Vector3;
	gateSockets: THREE.Vector3[];
	gateBarrier: { center: THREE.Vector3; width: number; height: number };
	arenaThrone: THREE.Vector3;
	arenaPillars: THREE.Vector3[];
	chests: { id: string; pos: THREE.Vector3; ry: number }[];
	lore: { id: string; pos: THREE.Vector3; ry: number }[];
}

/**
 * All hand-placed architecture and landmarks. Static parts are merged per structure (a few
 * draws each) with colliders; a handful of animated pieces (floating blocks, crystals,
 * books) are updated every frame.
 */
export class Structures {
	readonly list: Structure[] = [];
	readonly root = new THREE.Group();
	readonly anchors: Anchors;
	private animated: Animated[] = [];
	private materials = new StructureMaterials();
	private kit: Kit;
	private extraGeos: THREE.BufferGeometry[] = [];
	private extraMats: THREE.Material[] = [];

	constructor(
		private physics: PhysicsWorld,
		private terrain: Terrain
	) {
		this.kit = new Kit(physics, terrain, this.materials);
		this.root.name = 'structures';
		const v = (x: number, z: number, dy = 0) => new THREE.Vector3(x, terrain.heightAt(x, z) + dy, z);
		this.anchors = {
			shrineAltar: v(SHRINE.x, SHRINE.z, 2.15),
			fallsLedge: v(FALLS_CRYSTAL.x, FALLS_CRYSTAL.z, 1.3),
			spirePedestal: v(SPIRE.x - 13, SPIRE.z, 1.3),
			grottoChest: v(GROTTO.x + 3, GROTTO.z, 0),
			islesTop: new THREE.Vector3(),
			libraryRelic: v(LIBRARY.x + 2, LIBRARY.z - 3, 0),
			templeAltar: v(TEMPLE.x, TEMPLE.z, 3.3),
			cryptRelic: new THREE.Vector3(5, HEIGHTS.arenaFloor, -256),
			ringCenter: v(RING.x, RING.z, 0.4),
			gateSockets: [],
			gateBarrier: { center: new THREE.Vector3(), width: 20, height: 20 },
			arenaThrone: new THREE.Vector3(ARENA.x, HEIGHTS.arenaFloor, ARENA.z - 24),
			arenaPillars: [],
			chests: [],
			lore: []
		};
		this.buildHollow();
		this.buildCrossroads();
		this.buildShrine();
		this.buildFalls();
		this.buildGrotto();
		this.buildRing();
		this.buildSpire();
		this.buildIsles();
		this.buildHighlandRuins();
		this.buildGate();
		this.buildAcademy();
		this.buildTemple();
		this.buildLibrary();
		this.buildCrypt();
		this.buildArena();
		for (const s of this.list) this.root.add(s.group);
	}

	private push(s: Structure): void {
		this.list.push(s);
	}

	/** Rotate a local offset by ry around a structure origin. */
	private L(x: number, z: number, ry: number, ox: number, oz: number): [number, number] {
		const c = Math.cos(ry);
		const s = Math.sin(ry);
		return [x + ox * c + oz * s, z - ox * s + oz * c];
	}

	// ------------------------------------------------------------------ Lumen Hollow

	private cottage(x: number, z: number, ry: number, w: number, d: number, roof: number, seed: number): void {
		const k = this.kit;
		const y = k.gy(x, z);
		const L = (ox: number, oz: number) => this.L(x, z, ry, ox, oz);
		const rng = new Random(seed);
		k.box('stone', x, y + 0.1, z, w + 0.5, 1.0, d + 0.5, C.stoneWarm, { ry, collide: true });
		k.box('plain', x, y + 2.1, z, w, 3.0, d, C.plaster, { ry, collide: true });
		// Timber frame.
		for (const [sx, sz] of [
			[-1, -1],
			[1, -1],
			[1, 1],
			[-1, 1]
		]) {
			const [px, pz] = L(sx * (w / 2), sz * (d / 2));
			k.box('plain', px, y + 2.1, pz, 0.3, 3.1, 0.3, C.woodDark, { ry });
		}
		for (const oz of [-d / 2, d / 2]) {
			const [bx, bz] = L(0, oz);
			k.box('plain', bx, y + 3.55, bz, w + 0.2, 0.22, 0.32, C.woodDark, { ry });
			k.box('plain', bx, y + 1.65, bz, w + 0.1, 0.16, 0.3, C.woodDark, { ry });
		}
		// Door and glowing windows on the front (+z local).
		const [dx, dz] = L(0, d / 2 + 0.06);
		k.box('plain', dx, y + 1.55, dz, 1.1, 2.0, 0.12, C.wood, { ry });
		for (const ox of [-w * 0.3, w * 0.3]) {
			const [wx, wz] = L(ox, d / 2 + 0.06);
			k.box('warm', wx, y + 2.3, wz, 0.8, 0.8, 0.1, 0xffc070, { ry, glow: 1 });
			k.box('plain', wx, y + 1.85, wz, 1.0, 0.12, 0.2, C.woodDark, { ry });
		}
		for (const sx of [-1, 1]) {
			const [wx, wz] = L(sx * (w / 2 + 0.06), 0);
			k.box('warm', wx, y + 2.3, wz, 0.1, 0.8, 0.8, 0xffc070, { ry, glow: 1 });
		}
		k.gableRoof('plain', x, y + 3.6, z, w + 1.0, d + 1.2, 2.3, ry, roof);
		const [cx, cz] = L(w * 0.28, -d * 0.18);
		k.box('stone', cx, y + 5.2, cz, 0.7, 2.2, 0.7, C.stoneWarm, { ry });
		// Barrels and crates by the door.
		const [bx, bz] = L(w / 2 + 0.6, d / 2 + 0.4);
		k.cyl('plain', bx, y, bz, 0.38, 0.42, 1.0, 10, C.wood, { collide: rng.chance(0.5) });
		const [cbx, cbz] = L(-w / 2 - 0.7, d / 2 + 0.2);
		k.box('plain', cbx, y + 0.4, cbz, 0.8, 0.8, 0.8, 0x8a6a42, { ry: ry + 0.3 });
	}

	private lantern(x: number, z: number): void {
		const k = this.kit;
		const y = k.gy(x, z);
		k.box('plain', x, y + 1.4, z, 0.16, 2.8, 0.16, C.woodDark, { collide: true });
		k.box('plain', x + 0.3, y + 2.7, z, 0.7, 0.1, 0.1, C.woodDark);
		k.box('warm', x + 0.55, y + 2.35, z, 0.32, 0.45, 0.32, 0xffd080, { glow: 1 });
		k.box('plain', x + 0.55, y + 2.62, z, 0.42, 0.08, 0.42, C.woodDark);
	}

	private buildHollow(): void {
		const k = this.kit.begin('Lumen Hollow', HOLLOW.x, HOLLOW.z, 60);
		const hx = HOLLOW.x;
		const hz = HOLLOW.z;
		const y = k.gy(hx, hz);
		// Lumen Well: the village's guiding light.
		k.cyl('stone', hx, y - 0.2, hz, 3.3, 3.5, 0.9, 20, C.stoneWarm, { collide: true });
		k.cyl('stone', hx, y + 0.6, hz, 2.7, 2.7, 0.12, 20, 0x2a6a7a, { glow: 0.25 });
		k.cyl('stone', hx, y - 0.2, hz, 0.55, 0.7, 3.4, 10, C.stoneWarm, { collide: true });
		k.geo('warm', new THREE.OctahedronGeometry(0.7, 0), 0xffe0a0, hx, y + 3.9, hz, { glow: 1, sy: 1.6 });
		for (let i = 0; i < 4; i++) {
			const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
			k.box('stone', hx + Math.cos(a) * 0.5, y + 3.2, hz + Math.sin(a) * 0.5, 0.12, 1.4, 0.12, C.stoneWarm, { ry: -a, rz: 0.35 });
		}
		// Cottages ring the plaza.
		const homes: [number, number, number, number, number, number][] = [
			[-22, 222, Math.PI / 2 + 0.2, 7, 5.5, C.thatch],
			[-25, 245, Math.PI / 2 - 0.1, 6.5, 5, C.slate],
			[23, 247, -Math.PI / 2 + 0.15, 7, 5.5, C.roofRed],
			[-14, 266, Math.PI + 0.3, 6, 5, C.thatch],
			[17, 268, Math.PI - 0.25, 6.5, 5, C.slate],
			[-30, 205, Math.PI / 2 + 0.5, 6, 5, C.roofRed]
		];
		homes.forEach(([x, z, ry, w, d, roof], i) => this.cottage(x, z, ry, w, d, roof, i + 3));
		// Elder Mirael's observatory tower.
		{
			const tx = 20;
			const tz = 212;
			const ty = k.gy(tx, tz);
			k.cyl('stone', tx, ty - 0.5, tz, 3.6, 3.9, 1.5, 16, C.stoneWarm, { collide: true });
			k.cyl('stone', tx, ty + 1, tz, 3.2, 3.4, 10, 16, 0xb0a490, { collide: true });
			k.cyl('stone', tx, ty + 11, tz, 3.7, 3.7, 0.6, 16, C.stoneWarm);
			for (let i = 0; i < 12; i++) {
				const a = (i / 12) * Math.PI * 2;
				k.box('stone', tx + Math.cos(a) * 3.5, ty + 11.9, tz + Math.sin(a) * 3.5, 0.7, 1.0, 0.6, C.stoneWarm, { ry: -a });
			}
			const cone = new THREE.ConeGeometry(3.1, 5.5, 16);
			cone.translate(0, 2.75, 0);
			k.geo('plain', cone, C.slate, tx, ty + 11.6, tz);
			for (const h of [4, 8]) {
				for (let i = 0; i < 4; i++) {
					const a = (i / 4) * Math.PI * 2 + h;
					k.box('warm', tx + Math.cos(a) * 3.25, ty + h, tz + Math.sin(a) * 3.25, 0.7, 1.1, 0.25, 0xffc070, { ry: -a + Math.PI / 2, glow: 1 });
				}
			}
			k.box('plain', tx - 3.3, ty + 1.2, tz + 0.5, 0.2, 2.2, 1.2, C.wood, { ry: 0 });
			k.geo('stone', new THREE.TorusGeometry(1.2, 0.08, 6, 24), 0xd0b070, tx, ty + 18, tz, { rx: 1.2, glow: 0.6 });
		}
		// Market stall.
		{
			const sx = -11;
			const sz = 221;
			const sy = k.gy(sx, sz);
			for (const [ox, oz] of [
				[-1.6, -1],
				[1.6, -1],
				[-1.6, 1],
				[1.6, 1]
			])
				k.box('plain', sx + ox, sy + 1.2, sz + oz, 0.15, 2.4, 0.15, C.wood);
			k.box('plain', sx, sy + 2.5, sz, 3.8, 0.12, 2.6, C.cloth[0], { rx: 0.18 });
			k.box('plain', sx, sy + 0.85, sz + 0.4, 3.2, 0.12, 1.2, C.wood, { collide: true });
			const rng = new Random(9);
			for (let i = 0; i < 7; i++) k.box('plain', sx - 1.3 + i * 0.42, sy + 1.02, sz + 0.4 + rng.range(-0.3, 0.3), 0.3, 0.22, 0.3, rng.pick([0xd04a3a, 0xe0b040, 0x6ab040, 0x9a5ac8]));
		}
		// Fences and garden plots.
		for (let i = 0; i < 9; i++) {
			const x = -34 + i * 1.6;
			const z = 232;
			const fy = k.gy(x, z);
			k.box('plain', x, fy + 0.45, z, 0.12, 0.9, 0.12, C.wood);
			k.box('plain', x + 0.8, fy + 0.65, z, 1.6, 0.08, 0.06, C.wood);
			k.box('plain', x + 0.8, fy + 0.35, z, 1.6, 0.08, 0.06, C.wood);
		}
		for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) k.box('plain', -33 + c * 1.5, k.gy(-33 + c * 1.5, 236 + r * 1.3) + 0.15, 236 + r * 1.3, 1.0, 0.3, 0.8, r % 2 ? 0x4a8a3a : 0x6aa040);
		// Lanterns along the road and around the plaza.
		for (let z = 270; z > 150; z -= 15) this.lantern(z % 30 === 0 ? 5 : -5, z);
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * Math.PI * 2 + 0.3;
			this.lantern(hx + Math.cos(a) * 15, hz + Math.sin(a) * 15);
		}
		this.anchors.chests.push({ id: 'hollow-cache', pos: new THREE.Vector3(-26, k.gy(-26, 260), 260), ry: 0.6 });
		this.anchors.lore.push({ id: 'lore-hollow', pos: new THREE.Vector3(-6, k.gy(-6, 248), 248), ry: Math.PI });
		this.push(k.end());
	}

	// ------------------------------------------------------------------ Crossroads

	private ruinedTower(name: string, x: number, z: number, r: number, h: number, color: number, seed: number, door = 0): void {
		const k = this.kit.begin(name, x, z, r + 10);
		const y = k.gy(x, z) - 0.4;
		const segs = 14;
		const rng = new Random(seed);
		for (let i = 0; i < segs; i++) {
			const a = (i / segs) * Math.PI * 2;
			if (Math.abs(((a - door + Math.PI) % (Math.PI * 2)) - Math.PI) < 0.3) continue;
			const sh = h * rng.range(0.45, 1);
			const w = 2 * Math.PI * r / segs + 0.1;
			k.box('stone', x + Math.cos(a) * r, y + sh / 2, z + Math.sin(a) * r, w, sh, 1.1, shade(color, rng.range(0.9, 1.05)), { ry: -a + Math.PI / 2, collide: true });
		}
		for (let i = 0; i < 6; i++) k.rock(x + rng.range(-r - 5, r + 5), y + 0.3, z + rng.range(-r - 5, r + 5), rng.range(0.4, 0.9), shade(color, 0.9), seed + i, { sy: 0.6 });
		this.push(k.end());
	}

	private buildCrossroads(): void {
		this.ruinedTower('Crossroads Watch', CROSSROADS.x + 22, CROSSROADS.z - 14, 4.2, 10, C.stoneOld, 21, Math.PI);
		const k = this.kit.begin('Crossroads Sign', CROSSROADS.x - 7, CROSSROADS.z + 6, 6);
		const x = CROSSROADS.x - 7;
		const z = CROSSROADS.z + 6;
		const y = k.gy(x, z);
		k.box('plain', x, y + 1.5, z, 0.2, 3, 0.2, C.wood, { collide: true });
		k.box('plain', x - 0.7, y + 2.6, z, 1.4, 0.35, 0.08, 0x8a6a42, { ry: 0.2 });
		k.box('plain', x + 0.7, y + 2.1, z, 1.4, 0.35, 0.08, 0x8a6a42, { ry: -0.5 });
		k.box('plain', x, y + 1.6, z + 0.6, 0.08, 0.35, 1.4, 0x8a6a42);
		this.anchors.lore.push({ id: 'lore-crossroads', pos: new THREE.Vector3(x + 2.5, y, z - 1), ry: 0.4 });
		this.push(k.end());
	}

	// ------------------------------------------------------------------ Shrine of Verdance

	private buildShrine(): void {
		const k = this.kit.begin('Shrine of Verdance', SHRINE.x, SHRINE.z, 24);
		const x = SHRINE.x;
		const z = SHRINE.z;
		const y = k.gy(x, z);
		k.cyl('stone', x, y - 0.5, z, 7.2, 7.6, 0.9, 28, 0x7a8478, { collide: true });
		k.cyl('stone', x, y + 0.4, z, 5.2, 5.5, 0.5, 24, 0x868e82, { collide: true });
		for (let i = 0; i < 20; i++) {
			const a = (i / 20) * Math.PI * 2;
			k.box('verdant', x + Math.cos(a) * 6.4, y + 0.42, z + Math.sin(a) * 6.4, 0.9, 0.06, 0.25, 0x6aff9a, { ry: -a, glow: 1 });
		}
		k.box('stone', x, y + 1.35, z, 1.8, 1.0, 1.8, 0x9aa294, { collide: true });
		k.box('stone', x, y + 1.95, z, 2.2, 0.25, 2.2, 0xa8b0a2);
		const rng = new Random(77);
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * Math.PI * 2 + 0.2;
			const broken = i % 3 === 1 ? rng.range(0.3, 0.6) : 0;
			k.column('stone', x + Math.cos(a) * 11, z + Math.sin(a) * 11, 6, 0.55, 0x8c9488, { broken, glowBand: i % 2 === 0 });
		}
		k.arch('verdant', x, z - 14, 0, 4, 4.5, 0.9, 0x86907e, { glow: true });
		k.arch('stone', x + 13.5, z + 2, Math.PI / 2, 4, 4.2, 0.9, 0x86907e);
		// Fallen column drums and overgrowth.
		for (let i = 0; i < 4; i++) k.cyl('stone', x + rng.range(-14, 14), y - 0.1, z + rng.range(8, 14), 0.55, 0.55, 1.1, 12, 0x8c9488, { rz: Math.PI / 2, ry: rng.range(0, 3) });
		for (let i = 0; i < 6; i++) k.rock(x + rng.range(-16, 16), y, z + rng.range(-16, 16), rng.range(0.6, 1.3), 0x6a6a64, 400 + i, { moss: C.moss, sy: 0.7 });
		this.anchors.lore.push({ id: 'lore-shrine', pos: new THREE.Vector3(x - 4, y + 0.65, z + 4.5), ry: 0.8 });
		this.push(k.end());
	}

	// ------------------------------------------------------------------ Moonwell Falls

	private buildFalls(): void {
		const k = this.kit.begin('Moonwell Falls', FALLS.x, FALLS.z + 10, 30);
		const rng = new Random(55);
		// Rocks framing the falls and the plunge pool.
		for (let i = 0; i < 14; i++) {
			const side = i % 2 ? 1 : -1;
			const x = FALLS.x + side * rng.range(7, 13);
			const z = FALLS.z + rng.range(-6, 10);
			k.rock(x, k.gy(x, z) + rng.range(0, 1.5), z, rng.range(1.4, 3), 0x5a5a62, 500 + i, { moss: 0x3a6a4a, collide: true, sy: 0.9 });
		}
		// Crystal ledge.
		const lx = FALLS_CRYSTAL.x;
		const lz = FALLS_CRYSTAL.z;
		const ly = k.gy(lx, lz);
		k.cyl('stone', lx, ly - 0.6, lz, 2.6, 3.2, 1.6, 9, 0x6a6a74, { collide: true });
		for (let i = 0; i < 5; i++) {
			const a = (i / 5) * Math.PI * 2;
			k.add('stone', place(F.crystalCluster(600 + i, 0x5ae0ff, 0.7), lx + Math.cos(a) * 3.4, ly - 0.2, lz + Math.sin(a) * 3.4, 0, a, 0, 0.6, 0.6, 0.6));
		}
		this.anchors.fallsLedge.set(lx, ly + 1.0, lz);
		this.anchors.chests.push({ id: 'falls-cache', pos: new THREE.Vector3(FALLS.x + 9, k.gy(FALLS.x + 9, FALLS.z + 16), FALLS.z + 16), ry: -0.8 });
		this.push(k.end());
	}

	// ------------------------------------------------------------------ Hidden Grotto

	private buildGrotto(): void {
		const x = GROTTO.x;
		const z = GROTTO.z;
		const k = this.kit.begin('Hidden Grotto', x, z, 22);
		const y = k.gy(x + 3, z);
		const rock = 0x4e4a56;
		k.rock(x + 1, y + 2.5, z - 7.5, 4.5, rock, 701, { sy: 1.1, collide: true });
		k.rock(x + 1, y + 2.5, z + 7.5, 4.5, rock, 702, { sy: 1.1, collide: true });
		k.rock(x - 6, y + 3, z, 5.5, rock, 703, { sy: 1.2, collide: true });
		k.rock(x - 1, y + 8.2, z, 6.5, rock, 704, { sy: 0.45, moss: 0x3a6a3a });
		this.kit.physics.addCuboid(x - 1, y + 8.4, z, 6.5, 1.2, 7, 0);
		// Entrance hidden behind boulders.
		k.rock(x + 9, y + 0.8, z - 3.5, 1.8, rock, 705, { moss: 0x3a6a3a, collide: true });
		k.rock(x + 8, y + 0.6, z + 4, 1.5, rock, 706, { moss: 0x3a6a3a, collide: true });
		for (let i = 0; i < 6; i++) {
			const a = Math.PI * 0.6 + (i / 5) * Math.PI * 0.8;
			k.add('stone', place(F.crystalCluster(710 + i, 0x5ae0ff, 0.9), x + Math.cos(a) * 4.2, y - 0.2, z + Math.sin(a) * 4.6, 0, a, 0, 0.7, 0.7, 0.7));
		}
		this.anchors.grottoChest.set(x - 1.5, y, z);
		this.anchors.lore.push({ id: 'lore-grotto', pos: new THREE.Vector3(x + 1, y, z + 3.5), ry: -2.4 });
		this.push(k.end());
	}

	// ------------------------------------------------------------------ Highlands

	private buildRing(): void {
		const k = this.kit.begin('Ring of Echoes', RING.x, RING.z, RING.r + 8);
		const x = RING.x;
		const z = RING.z;
		const y = k.gy(x, z);
		k.cyl('stone', x, y - 0.4, z, 8.5, 9, 0.75, 32, 0x6a6476, { collide: true });
		for (const r of [6.6, 7.6]) k.geo('arcane', new THREE.TorusGeometry(r, 0.08, 4, 64), 0xc090ff, x, y + 0.37, z, { rx: Math.PI / 2, glow: 1 });
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * Math.PI * 2;
			k.box('arcane', x + Math.cos(a) * 3.5, y + 0.37, z + Math.sin(a) * 3.5, 6.2, 0.04, 0.12, 0xc090ff, { ry: -a, glow: 1 });
		}
		const n = 12;
		for (let i = 0; i < n; i++) {
			const a = (i / n) * Math.PI * 2;
			const sx = x + Math.cos(a) * (RING.r - 1);
			const sz = z + Math.sin(a) * (RING.r - 1);
			const sy = k.gy(sx, sz) - 0.3;
			k.add('arcane', place(F.standingStone(900 + i, 0xc090ff), sx, sy, sz, 0, -a + Math.PI / 2, 0, 1.5, 1.5, 1.5));
			this.kit.physics.addCuboid(sx, sy + 3, sz, 1.0, 3, 0.6, -a + Math.PI / 2);
			if (i % 3 === 0) {
				const b = ((i + 1) / n) * Math.PI * 2;
				const mx = x + Math.cos((a + b) / 2) * (RING.r - 1);
				const mz = z + Math.sin((a + b) / 2) * (RING.r - 1);
				k.box('stone', mx, sy + 6.6, mz, 11, 1.0, 1.4, 0x6a6476, { ry: -(a + b) / 2 + Math.PI / 2 });
			}
		}
		this.push(k.end());
	}

	private buildSpire(): void {
		const x = SPIRE.x;
		const z = SPIRE.z;
		const k = this.kit.begin('Starfall Spire', x, z, 40);
		const y = k.gy(x, z) - 0.5;
		const stone = 0x7a7488;
		k.cyl('stone', x, y, z, 7, 7.6, 1.6, 8, 0x5f5a6c, { collide: true });
		k.cyl('stone', x, y + 1.6, z, 4.4, 4.9, 26, 14, stone, { collide: true });
		for (const h of [6, 12, 18, 24]) k.cyl('arcane', x, y + 1.6 + h, z, 4.6 - h * 0.016, 4.6 - h * 0.016, 0.35, 14, 0xc090ff, { glow: 1 });
		for (let i = 0; i < 4; i++) {
			const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
			k.box('stone', x + Math.cos(a) * 5, y + 7, z + Math.sin(a) * 5, 1.6, 12, 1.6, 0x6a6478, { ry: -a, collide: true });
			k.box('stone', x + Math.cos(a) * 4.7, y + 14, z + Math.sin(a) * 4.7, 1.2, 3, 1.2, 0x6a6478, { ry: -a, rz: 0.2 });
		}
		// Ragged top.
		const rng = new Random(1201);
		for (let i = 0; i < 10; i++) {
			const a = (i / 10) * Math.PI * 2;
			k.box('stone', x + Math.cos(a) * 4.1, y + 28 + rng.range(0, 2.5), z + Math.sin(a) * 4.1, 2.4, rng.range(1.5, 4), 1.0, stone, { ry: -a + Math.PI / 2 });
		}
		k.arch('arcane', x - 4.6, z, Math.PI / 2, 2.6, 3.2, 0.8, 0x5f5a6c, { glow: true, y: y + 1.6 });
		// Courtyard walls (ruined), open to the west.
		for (let i = 0; i < 9; i++) {
			const a0 = Math.PI * 0.25 + (i / 9) * Math.PI * 1.5;
			const a1 = Math.PI * 0.25 + ((i + 0.8) / 9) * Math.PI * 1.5;
			k.wall('stone', x + Math.cos(a0) * 16, z + Math.sin(a0) * 16, x + Math.cos(a1) * 16, z + Math.sin(a1) * 16, 4, 1, 0x6a6476, { ruin: 0.7, seed: i });
		}
		// Crystal pedestal in front of the doors.
		const px = this.anchors.spirePedestal.x;
		const pz = this.anchors.spirePedestal.z;
		const py = k.gy(px, pz);
		k.cyl('stone', px, py - 0.2, pz, 1.2, 1.5, 1.2, 8, 0x6a6478, { collide: true });
		k.cyl('arcane', px, py + 0.95, pz, 1.3, 1.3, 0.12, 8, 0xc090ff, { glow: 1 });
		this.anchors.spirePedestal.set(px, py + 1.0, pz);
		this.anchors.lore.push({ id: 'lore-spire', pos: new THREE.Vector3(x - 9, k.gy(x - 9, z + 6), z + 6), ry: Math.PI / 2 });
		this.push(k.end());

		// Floating crown crystal and orbiting blocks.
		const crystalMat = this.trackMat(
			new THREE.MeshStandardMaterial({ color: 0x9a70ff, emissive: 0x8a50ff, emissiveIntensity: 2.2, roughness: 0.2, metalness: 0.2, flatShading: true })
		);
		const crystalGeo = this.trackGeo(new THREE.OctahedronGeometry(2.2, 0));
		crystalGeo.scale(1, 2, 1);
		const crown = new THREE.Mesh(crystalGeo, crystalMat);
		crown.position.set(x, y + 38, z);
		this.addAnimated(crown, 'spin', 0.5, 0.4);
		const blockGeo = this.trackGeo(new THREE.BoxGeometry(1.6, 1.2, 1.2));
		const blockMat = this.trackMat(new THREE.MeshLambertMaterial({ color: 0x7a7488 }));
		for (let i = 0; i < 7; i++) {
			const b = new THREE.Mesh(blockGeo, blockMat);
			const a = (i / 7) * Math.PI * 2;
			b.position.set(x + Math.cos(a) * 7, y + 31 + (i % 3) * 1.5, z + Math.sin(a) * 7);
			b.rotation.set(i, i * 2, 0);
			b.castShadow = true;
			this.addAnimated(b, 'orbit', 7, 0.15, a);
		}
	}

	private buildIsles(): void {
		const x = ISLES.x;
		const z = ISLES.z;
		const k = this.kit.begin('Drifting Isles', x, z, 40);
		const g0 = k.gy(x, z);
		// A climbable stair of floating isles (static), spiralling upward.
		const steps: [number, number, number, number][] = [
			[x - 6, z + 8, 2.3, 2.4],
			[x - 1, z + 11, 4.5, 2.2],
			[x + 4.5, z + 8, 6.8, 2.2],
			[x + 7, z + 2.5, 9.0, 2.2],
			[x + 4, z - 3.5, 11.3, 2.4],
			[x - 2, z - 5, 13.7, 4.2]
		];
		steps.forEach(([sx, sz, h, r], i) => {
			const top = g0 + h;
			k.add('plain', k.isle(sx, top, sz, r, 800 + i));
			this.kit.physics.addCylinder(sx, top - 0.3, sz, 0.4, r * 0.95, { kind: 'static', material: 'stone' });
		});
		const last = steps[steps.length - 1];
		this.anchors.islesTop.set(last[0], g0 + last[2] + 0.1, last[1]);
		this.anchors.chests.push({ id: 'isles-cache', pos: this.anchors.islesTop.clone(), ry: 0.3 });
		// Crystal pylons with energy streams.
		const pylons: THREE.Vector3[] = [];
		for (const [px, pz] of [
			[x - 18, z - 10],
			[x + 16, z - 14],
			[x + 2, z + 22]
		]) {
			const py = k.gy(px, pz);
			k.cyl('stone', px, py - 0.3, pz, 1.3, 1.7, 1.2, 6, 0x5f5a6c, { collide: true });
			k.add('arcane', place(F.crystalCluster(850 + px, 0xb070ff, 2.2), px, py + 0.6, pz, 0, 0, 0, 1, 1, 1));
			this.kit.physics.addCylinder(px, py + 3, pz, 3, 0.9, { kind: 'static', material: 'stone' });
			pylons.push(new THREE.Vector3(px, py + 5.5, pz));
		}
		this.push(k.end());
		for (let i = 0; i < pylons.length; i++) this.energyStream(pylons[i], pylons[(i + 1) % pylons.length], 9, 0xc090ff);
		this.energyStream(pylons[0], this.anchors.islesTop.clone().add(new THREE.Vector3(0, 2, 0)), 6, 0x80e0ff);
		// Decorative high isles drifting overhead.
		const rng = new Random(860);
		const decoMat = this.trackMat(new THREE.MeshLambertMaterial({ vertexColors: true }));
		for (let i = 0; i < 9; i++) {
			const a = rng.range(0, Math.PI * 2);
			const r = rng.range(18, 70);
			const ix = x + Math.cos(a) * r + 30;
			const iz = z + Math.sin(a) * r + 20;
			const g = this.trackGeo(this.kit.isle(0, 0, 0, rng.range(3, 9), 870 + i, 0x6a8a5a));
			const m = new THREE.Mesh(g, decoMat);
			m.position.set(ix, this.terrain.heightAt(ix, iz) + rng.range(22, 48), iz);
			m.castShadow = true;
			this.addAnimated(m, 'bob', rng.range(0.8, 1.8), rng.range(0.25, 0.5), rng.range(0, 6));
		}
	}

	private buildHighlandRuins(): void {
		this.ruinedTower('Windward Tower', 150, 42, 3.6, 13, 0x7a7488, 31, 2.4);
		this.ruinedTower('Eastwatch Tower', 262, 72, 4, 15, 0x7a7488, 41, 3.6);
		this.ruinedTower('Ridge Tower', 120, 170, 3.2, 9, 0x7a7488, 51, 0.5);
		this.anchors.chests.push({ id: 'tower-cache', pos: new THREE.Vector3(262, this.terrain.heightAt(262, 72), 72), ry: 0 });
	}

	// ------------------------------------------------------------------ Sanctuary

	private buildGate(): void {
		const x = GATE.x;
		const z = GATE.z;
		const k = this.kit.begin('Seal Gate', x, z, 40);
		const y = k.gy(x, z) - 0.5;
		const dark = 0x4f4a5e;
		for (const side of [-1, 1]) {
			const tx = x + side * 17;
			k.cyl('stone', tx, y - 2, z, 5.6, 6.2, 26, 12, dark, { collide: true });
			k.cyl('arcane', tx, y + 9, z, 5.75, 5.75, 0.5, 12, 0xc090ff, { glow: 1 });
			k.cyl('arcane', tx, y + 17, z, 5.7, 5.7, 0.5, 12, 0xc090ff, { glow: 1 });
			for (let i = 0; i < 10; i++) {
				const a = (i / 10) * Math.PI * 2;
				k.box('stone', tx + Math.cos(a) * 5.3, y + 24.6, z + Math.sin(a) * 5.3, 1.6, 1.4, 1.0, dark, { ry: -a + Math.PI / 2 });
			}
			k.box('stone', x + side * 26, y + 9, z, 12, 22, 6, dark, { collide: true });
		}
		k.arch('stone', x, z, 0, 20, 11, 3, 0x5f5a70, { y });
		// Socket ring for the three Arcane Crystals.
		const sockets = [-6, 0, 6].map((ox, i) => new THREE.Vector3(x + ox, y + (i === 1 ? 22.0 : 20.3), z + 1.9));
		for (const s of sockets) {
			k.geo('arcane', new THREE.TorusGeometry(1.2, 0.22, 6, 18), 0x8a70b0, s.x, s.y, s.z, { glow: 0.3 });
		}
		this.anchors.gateSockets = sockets;
		this.anchors.gateBarrier.center.set(x, y + 10, z);
		this.anchors.gateBarrier.width = 20;
		this.anchors.gateBarrier.height = 21;
		this.push(k.end());
	}

	private statue(k: Kit, x: number, y: number, z: number, ry: number): void {
		const marble = C.marble;
		k.cyl('stone', x, y, z, 2.0, 2.3, 2.2, 8, 0x8a8496, { collide: true });
		const robe = new THREE.CylinderGeometry(0.9, 1.6, 4.2, 10);
		robe.translate(0, 2.1, 0);
		k.geo('stone', robe, marble, x, y + 2.2, z, { ry });
		k.geo('stone', new THREE.SphereGeometry(0.62, 12, 10), marble, x, y + 6.9, z, { ry });
		const hood = new THREE.ConeGeometry(0.85, 1.6, 10);
		k.geo('stone', hood, shade(marble, 0.92), x, y + 7.2, z, { ry });
		const [ax, az] = this.L(x, z, ry, 0.9, 0.2);
		k.geo('stone', new THREE.CylinderGeometry(0.22, 0.28, 2.4, 6), marble, ax, y + 6.6, az, { rz: -0.5, ry });
		const [sx, sz] = this.L(x, z, ry, 1.5, 0.2);
		k.geo('stone', new THREE.CylinderGeometry(0.08, 0.1, 7, 6), 0x9a8a70, sx, y + 6, sz, { ry });
		k.geo('arcane', new THREE.IcosahedronGeometry(0.55, 1), 0xd0b0ff, sx, y + 9.7, sz, { glow: 1 });
		k.physics.addCylinder(x, y + 5, z, 2.8, 1.4);
	}

	private buildAcademy(): void {
		const x = COURTYARD.x;
		const z = COURTYARD.z;
		const k = this.kit.begin('Aether Academy', x, z, 60);
		const y = HEIGHTS.terrace - 0.3;
		const rng = new Random(1301);
		// Colonnade ring with gaps for the avenue (south) and the hall (north).
		for (let i = 0; i < 30; i++) {
			const a = (i / 30) * Math.PI * 2;
			const dz = Math.sin(a);
			if (Math.abs(Math.cos(a)) < 0.2) continue;
			const cx = x + Math.cos(a) * 31;
			const cz = z + dz * 31;
			if (cz < z - 14) continue; // inside the hall
			const broken = rng.chance(0.45) ? rng.range(0.25, 0.7) : 0;
			k.column('stone', cx, cz, 7, 0.6, C.stoneOld, { broken, glowBand: i % 4 === 0 });
		}
		// Fountain and statue of the first Archmage.
		k.cyl('stone', x, y, z, 6, 6.3, 0.9, 24, 0x7a748a, { collide: true });
		k.cyl('stone', x, y + 0.85, z, 5.3, 5.3, 0.1, 24, 0x2a2238, { glow: 0.2 });
		this.statue(k, x, y + 0.6, z, Math.PI);
		// Main hall to the north, open to the sky.
		const hz0 = z - 16;
		const hz1 = CRYPT.z0;
		const hw = 24;
		k.wall('stone', x - hw, hz0, x - hw, hz1, 14, 1.4, C.stoneOld, { y, windows: 1, ruin: 0.55, seed: 1 });
		k.wall('stone', x + hw, hz0, x + hw, hz1, 14, 1.4, C.stoneOld, { y, windows: 1, ruin: 0.6, seed: 2 });
		k.wall('stone', x - hw, hz1, x - 9, hz1, 14, 1.4, C.stoneOld, { y, ruin: 0.4, seed: 3 });
		k.wall('stone', x + 9, hz1, x + hw, hz1, 14, 1.4, C.stoneOld, { y, ruin: 0.4, seed: 4 });
		k.wall('stone', x - hw, hz0, x - 5, hz0, 12, 1.4, C.stoneOld, { y, windows: 1, ruin: 0.5, seed: 5 });
		k.wall('stone', x + 5, hz0, x + hw, hz0, 12, 1.4, C.stoneOld, { y, windows: 1, ruin: 0.5, seed: 6 });
		k.arch('arcane', x, hz0, 0, 8, 7, 1.6, 0x6a6478, { y, glow: true });
		for (let i = 0; i < 4; i++) {
			const cz = hz0 - 3 - i * 4;
			for (const side of [-1, 1]) k.column('stone', x + side * 13, cz, 10, 0.7, 0x7e788e, { y, broken: (i + (side > 0 ? 1 : 0)) % 3 === 0 ? 0.4 : 0 });
		}
		// Collapsed roof beams and rubble.
		for (let i = 0; i < 8; i++) k.box('stone', x + rng.range(-20, 20), y + 0.5, rng.range(hz1 + 2, hz0 - 2), rng.range(1, 3), rng.range(0.6, 1.4), rng.range(1, 2), C.stoneOld, { ry: rng.range(0, 3), collide: true });
		for (let i = 0; i < 3; i++) k.box('stone', x + rng.range(-18, 18), y + 1.2, rng.range(hz1 + 3, hz0 - 3), 12, 0.9, 1, 0x6a6478, { ry: rng.range(-0.4, 0.4), rz: rng.range(0.1, 0.25), collide: true });
		this.anchors.lore.push({ id: 'lore-academy', pos: new THREE.Vector3(x + 8, y + 0.3, z + 6), ry: Math.PI });
		this.anchors.chests.push({ id: 'academy-cache', pos: new THREE.Vector3(x - 19, y + 0.3, hz1 + 4), ry: 0.4 });
		this.push(k.end());
	}

	private buildTemple(): void {
		const x = TEMPLE.x;
		const z = TEMPLE.z;
		const k = this.kit.begin('Temple of Dusk', x, z, 26);
		const y = k.gy(x, z) - 0.3;
		k.box('stone', x, y + 0.5, z, 22, 1, 16, 0x6a6478, { collide: true });
		k.box('stone', x, y + 1.5, z, 18, 1, 12.5, 0x726c80, { collide: true });
		k.box('stone', x, y + 2.5, z, 14, 1, 9, 0x7a748a, { collide: true });
		for (let i = 0; i < 6; i++) {
			for (const side of [-1, 1]) k.column('stone', x - 5.5 + i * 2.2, z + side * 3.6, 6.5, 0.45, C.stoneOld, { y: y + 3, broken: (i * 7 + side) % 5 === 0 ? 0.5 : 0 });
		}
		k.box('stone', x - 2, y + 10, z, 9, 0.8, 9, 0x6a6478, { rz: 0.05 });
		k.box('stone', x, y + 3.6, z, 2.2, 1.2, 1.4, 0x5a5466, { collide: true });
		k.geo('arcane', new THREE.ConeGeometry(0.5, 1.4, 8), 0xd080ff, x, y + 4.9, z, { glow: 1 });
		this.anchors.templeAltar.set(x, y + 4.2, z + 1.6);
		this.anchors.lore.push({ id: 'lore-temple', pos: new THREE.Vector3(x + 9, y + 1, z + 7), ry: -0.6 });
		this.push(k.end());
	}

	private buildLibrary(): void {
		const x = LIBRARY.x;
		const z = LIBRARY.z;
		const k = this.kit.begin('Sunken Library', x, z, 24);
		const y = k.gy(x, z) - 0.3;
		k.wall('stone', x - 10, z - 7, x + 10, z - 7, 9, 1.2, C.stoneOld, { y, windows: 1, ruin: 0.6, seed: 11 });
		k.wall('stone', x + 10, z - 7, x + 10, z + 7, 9, 1.2, C.stoneOld, { y, windows: 1, ruin: 0.7, seed: 12 });
		k.wall('stone', x - 10, z + 7, x - 2, z + 7, 7, 1.2, C.stoneOld, { y, ruin: 0.6, seed: 13 });
		k.wall('stone', x - 10, z - 7, x - 10, z + 2, 8, 1.2, C.stoneOld, { y, ruin: 0.8, seed: 14 });
		const rng = new Random(1401);
		for (let i = 0; i < 6; i++) {
			const sx = x - 7 + i * 2.6;
			const sz = z - 5.6;
			k.box('plain', sx, y + 1.8, sz, 2.2, 3.6, 0.7, 0x4a3226, { collide: true });
			for (let r = 0; r < 4; r++) k.box('plain', sx, y + 0.6 + r * 0.9, sz + 0.3, 2.0, 0.55, 0.15, rng.pick([0x7a2a2a, 0x2a4a7a, 0x6a5a2a, 0x3a6a3a]));
		}
		for (let i = 0; i < 3; i++) k.box('plain', x + rng.range(-6, 6), y + 0.5, z + rng.range(-2, 5), 2.2, 0.7, 3.6, 0x4a3226, { ry: rng.range(0, 3), rz: Math.PI / 2 - 0.2, collide: true });
		this.push(k.end());
		// Floating, glowing tomes.
		const bookGeo = this.trackGeo(new THREE.BoxGeometry(0.5, 0.12, 0.7));
		for (let i = 0; i < 9; i++) {
			const mat = this.trackMat(new THREE.MeshStandardMaterial({ color: rng.pick([0x7a2a2a, 0x2a4a7a, 0x5a2a7a]), emissive: 0xb080ff, emissiveIntensity: 0.6 }));
			const b = new THREE.Mesh(bookGeo, mat);
			b.position.set(x + rng.range(-7, 7), y + rng.range(2.5, 6), z + rng.range(-4, 5));
			b.rotation.set(rng.range(-0.4, 0.4), rng.range(0, 6), rng.range(-0.4, 0.4));
			this.addAnimated(b, 'bob', 0.35, rng.range(0.6, 1.1), rng.range(0, 6));
		}
		this.anchors.libraryRelic.set(x + 4, y + 0.3, z + 2);
		this.anchors.lore.push({ id: 'lore-library', pos: new THREE.Vector3(x - 3, y + 0.3, z + 4), ry: 2.6 });
	}

	private buildCrypt(): void {
		const k = this.kit.begin('The Undercroft', CRYPT.x, (CRYPT.z0 + CRYPT.z1) / 2, 30);
		const x = CRYPT.x;
		const top = HEIGHTS.terrace;
		const floor = HEIGHTS.arenaFloor;
		const hw = CRYPT.halfWidth;
		const len = CRYPT.z0 - CRYPT.z1;
		const midZ = (CRYPT.z0 + CRYPT.z1) / 2;
		const wallH = top - floor + 2.5;
		for (const side of [-1, 1]) {
			k.box('stone', x + side * (hw + 0.6), floor - 1 + wallH / 2, midZ, 1.2, wallH, len + 0.4, 0x4a4558, { collide: true });
		}
		// Ceiling slab (with a roofed look from above).
		const c0 = CRYPT.z0 - 7;
		const c1 = CRYPT.z1 + 2;
		k.box('stone', x, top + 0.45, (c0 + c1) / 2, hw * 2 + 2.4, 0.9, c0 - c1, 0x524c62, { collide: true });
		const rng = new Random(1501);
		for (let i = 0; i < 10; i++) k.box('stone', x + rng.range(-hw, hw), top + 1.0, rng.range(c1 + 1, c0 - 1), rng.range(1, 2.5), 0.3, rng.range(1, 2.5), 0x5f586e, { ry: rng.range(0, 3) });
		// Entrance arch at the top of the stairs and exit portal into the arena.
		k.arch('arcane', x, CRYPT.z0 + 0.5, 0, hw * 2 - 1, 5, 1.4, 0x5a5468, { y: top - 0.3, glow: true });
		k.arch('arcane', x, CRYPT.z1 + 0.2, 0, hw * 2 - 1, 5, 1.6, 0x5a5468, { y: floor - 0.2, glow: true });
		// Pillars, braziers and sarcophagi along the flat stretch.
		for (let zz = CRYPT.stairEnd - 3; zz > CRYPT.z1 + 3; zz -= 6) {
			for (const side of [-1, 1]) {
				k.column('stone', x + side * (hw - 1.2), zz, top - floor - 0.6, 0.45, 0x5f586e, { y: floor - 0.1 });
				k.box('stone', x + side * (hw - 0.35), floor + 3.0, zz + 3, 0.7, 0.2, 0.3, 0x3a3446);
				k.cyl('arcane', x + side * (hw - 0.55), floor + 3.1, zz + 3, 0.32, 0.2, 0.4, 8, 0xd080ff, { glow: 1 });
			}
		}
		for (const [sx, sz] of [
			[-hw + 1.6, CRYPT.stairEnd - 6],
			[hw - 1.6, CRYPT.stairEnd - 12]
		]) {
			k.box('stone', x + sx, floor + 0.5, sz, 1.4, 1.0, 2.6, 0x5a5468, { collide: true });
			k.box('stone', x + sx, floor + 1.08, sz, 1.5, 0.16, 2.7, 0x6a6478);
		}
		this.anchors.cryptRelic.set(x - hw + 2, floor, CRYPT.z1 + 6);
		this.anchors.lore.push({ id: 'lore-crypt', pos: new THREE.Vector3(x + hw - 1.8, floor, CRYPT.stairEnd - 2), ry: -Math.PI / 2 });
		this.push(k.end());
	}

	private buildArena(): void {
		const x = ARENA.x;
		const z = ARENA.z;
		const k = this.kit.begin('Crystal Throne', x, z, 50);
		const floor = HEIGHTS.arenaFloor;
		// Giant rune circle on the floor.
		for (const r of [10, 20, 27]) k.geo('arcane', new THREE.TorusGeometry(r, r === 20 ? 0.18 : 0.12, 4, 96), 0xc090ff, x, floor + 0.06, z, { rx: Math.PI / 2, glow: 0.8 });
		for (let i = 0; i < 12; i++) {
			const a = (i / 12) * Math.PI * 2;
			k.box('arcane', x + Math.cos(a) * 18.5, floor + 0.06, z + Math.sin(a) * 18.5, 17, 0.03, 0.14, 0xc090ff, { ry: -a, glow: 0.7 });
		}
		// Retaining wall around the bowl.
		const segs = 28;
		for (let i = 0; i < segs; i++) {
			const a0 = (i / segs) * Math.PI * 2;
			const a1 = ((i + 1) / segs) * Math.PI * 2;
			const am = (a0 + a1) / 2;
			if (Math.abs(am - Math.PI * 0.5) < 0.12) continue; // gap where the crypt opens in (+z side)
			const r = ARENA.r + 1.3;
			const wx = x + Math.cos(am) * r;
			const wz = z + Math.sin(am) * r;
			const w = 2 * r * Math.sin(Math.PI / segs) + 0.2;
			k.box('stone', wx, floor + 5, wz, w, 12, 1.6, 0x4f4a5e, { ry: -am + Math.PI / 2, collide: true });
		}
		// Rim colonnade at terrace level.
		const rng = new Random(1601);
		for (let i = 0; i < 20; i++) {
			const a = (i / 20) * Math.PI * 2 + 0.08;
			if (Math.abs(a - Math.PI * 0.5) < 0.25) continue;
			k.column('stone', x + Math.cos(a) * 37, z + Math.sin(a) * 37, 9, 0.6, 0x6a6478, { y: HEIGHTS.terrace - 0.3, broken: rng.chance(0.5) ? rng.range(0.3, 0.7) : 0, glowBand: i % 2 === 0 });
		}
		// Throne dais at the far (north) end.
		const tz = this.anchors.arenaThrone.z;
		k.cyl('stone', x, floor - 0.2, tz, 6, 6.5, 0.8, 16, 0x4f4a5e, { collide: true });
		k.cyl('stone', x, floor + 0.6, tz - 1, 4, 4.5, 0.8, 16, 0x5a5468, { collide: true });
		k.box('stone', x, floor + 4.5, tz - 3.6, 7, 7, 1.4, 0x4f4a5e, { collide: true });
		for (let i = 0; i < 7; i++) {
			const a = Math.PI * 0.15 + (i / 6) * Math.PI * 0.7;
			k.add('arcane', place(F.crystalCluster(1650 + i, 0xb070ff, 1.4), x + Math.cos(a) * 4, floor + 6.5 + Math.sin(a) * 2.5, tz - 3.8, 0, 0, a - Math.PI / 2, 0.9, 0.9, 0.9));
		}
		this.push(k.end());
		// Positions for Azrak's floating crystal pillars (owned by the boss fight).
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
			this.anchors.arenaPillars.push(new THREE.Vector3(x + Math.cos(a) * 24, floor, z + Math.sin(a) * 24));
		}
	}

	// ------------------------------------------------------------------ animated decor

	private energyStream(a: THREE.Vector3, b: THREE.Vector3, sag: number, color: number): void {
		const mid = a.clone().lerp(b, 0.5);
		mid.y += sag;
		const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
		const geo = this.trackGeo(new THREE.TubeGeometry(curve, 40, 0.18, 6, false));
		const mat = this.trackMat(
			new THREE.ShaderMaterial({
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				uniforms: { uTime: worldUniforms.uTime, uColor: { value: new THREE.Color(color) } },
				vertexShader: /* glsl */ `
					varying vec2 vUv;
					void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
				`,
				fragmentShader: /* glsl */ `
					uniform float uTime;
					uniform vec3 uColor;
					varying vec2 vUv;
					void main() {
						float pulse = 0.5 + 0.5 * sin(vUv.x * 40.0 - uTime * 6.0);
						float flick = 0.7 + 0.3 * sin(uTime * 13.0 + vUv.x * 7.0);
						float edge = 1.0 - abs(vUv.y - 0.5) * 2.0;
						gl_FragColor = vec4(uColor * (1.2 + pulse * 2.4) * flick, edge * (0.35 + pulse * 0.5));
					}
				`
			})
		);
		const m = new THREE.Mesh(geo, mat);
		m.frustumCulled = true;
		this.root.add(m);
	}

	private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
		this.extraGeos.push(g);
		return g;
	}

	private trackMat<T extends THREE.Material>(m: T): T {
		this.extraMats.push(m);
		return m;
	}

	private addAnimated(obj: THREE.Object3D, kind: Animated['kind'], amp: number, speed: number, phase = 0): void {
		this.root.add(obj);
		this.animated.push({ obj, kind, base: obj.position.clone(), amp, speed, phase });
	}

	update(time: number, camPos: THREE.Vector3, drawDistance: number): void {
		for (const a of this.animated) {
			const o = a.obj;
			if (o.position.distanceToSquared(camPos) > 300 * 300) continue;
			if (a.kind === 'bob') {
				o.position.y = a.base.y + Math.sin(time * a.speed + a.phase) * a.amp;
				o.rotation.y += 0.0015;
			} else if (a.kind === 'spin') {
				o.rotation.y = time * a.speed;
				o.position.y = a.base.y + Math.sin(time * 0.8) * a.amp;
			} else {
				const ang = a.phase + time * a.speed;
				o.position.x = SPIRE.x + Math.cos(ang) * a.amp;
				o.position.z = SPIRE.z + Math.sin(ang) * a.amp;
				o.position.y = a.base.y + Math.sin(time * 0.7 + a.phase) * 0.6;
				o.rotation.x += 0.003;
			}
		}
		const d2 = drawDistance * drawDistance;
		for (const s of this.list) {
			const dx = s.x - camPos.x;
			const dz = s.z - camPos.z;
			s.group.visible = dx * dx + dz * dz < d2 + s.radius * s.radius * 4;
		}
	}

	dispose(): void {
		for (const s of this.list) s.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
		for (const g of this.extraGeos) g.dispose();
		for (const m of this.extraMats) m.dispose();
		this.materials.dispose();
	}
}
