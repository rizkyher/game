import * as THREE from 'three';
import type { Terrain } from './TerrainGenerator';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { Vegetation } from './Vegetation';
import type { ChunkManager } from './ChunkManager';
import { landmark } from './Biomes';
import { Random } from '../utils/Random';
import { blob, canvasTexture, merge, place, prep, trimeshData } from '../utils/geometry';
import { mushroomGeometry, canopyGeometry } from './Flora';
import { tintMaterial } from './Materials';

export interface Web {
	center: THREE.Vector3;
	normal: THREE.Vector3;
	radius: number;
	mesh: THREE.Object3D;
	broken: boolean;
	respawnAt: number;
}

export interface Updraft {
	x: number;
	z: number;
	r: number;
	y0: number;
	y1: number;
	strength: number;
}

export interface FeatureInfo {
	webs: Web[];
	updrafts: Updraft[];
	picnicY: number;
	cherryPoints: THREE.Vector3[];
	berryPoints: THREE.Vector3[];
	birdPerches: THREE.Vector3[];
	hollowTreeInside: THREE.Vector3;
	hollowTreeTop: THREE.Vector3;
	logInside: THREE.Vector3;
	elderTop: THREE.Vector3;
	gardenShelf: THREE.Vector3[];
	gardenY: number;
	fairyCenter: THREE.Vector3;
	summit: THREE.Vector3;
	spiderHomes: THREE.Vector3[];
}

interface ShellOpts {
	radius: (h: number) => number;
	thickness: number;
	height: number;
	open: (ang: number, h: number) => boolean;
	color: (ang: number, h: number, out: THREE.Color) => void;
	innerColor: number;
	A?: number;
	K?: number;
}

/** Generic hollow tube shell with openings (used by the hollow oak and the log tunnel). */
function hollowShell(o: ShellOpts): THREE.BufferGeometry {
	const A = o.A ?? 40;
	const K = o.K ?? 30;
	const pos: number[] = [];
	const col: number[] = [];
	const idx: number[] = [];
	const c = new THREE.Color();
	const ic = new THREE.Color(o.innerColor);
	const row = A + 1;
	const outerStart = 0;
	for (let k = 0; k <= K; k++) {
		const h = (k / K) * o.height;
		for (let a = 0; a <= A; a++) {
			const ang = (a / A) * Math.PI * 2;
			const r = o.radius(h);
			pos.push(Math.cos(ang) * r, h, Math.sin(ang) * r);
			o.color(ang, h, c);
			col.push(c.r, c.g, c.b);
		}
	}
	const innerStart = pos.length / 3;
	for (let k = 0; k <= K; k++) {
		const h = (k / K) * o.height;
		for (let a = 0; a <= A; a++) {
			const ang = (a / A) * Math.PI * 2;
			const r = o.radius(h) - o.thickness;
			pos.push(Math.cos(ang) * r, h, Math.sin(ang) * r);
			col.push(ic.r, ic.g, ic.b);
		}
	}
	const isOpen = (a: number, k: number) => o.open((((a % A) + A) % A + 0.5) * ((Math.PI * 2) / A), (k + 0.5) * (o.height / K));
	const jamb = (o1: number, o2: number) => {
		const i1 = innerStart + o1;
		const i2 = innerStart + o2;
		idx.push(o1, o2, i1, o2, i2, i1, o1, i1, o2, o2, i1, i2);
	};
	for (let k = 0; k < K; k++) {
		for (let a = 0; a < A; a++) {
			const i0 = k * row + a;
			const i1 = i0 + 1;
			const i2 = i0 + row;
			const i3 = i2 + 1;
			if (isOpen(a, k)) {
				if (!isOpen(a - 1, k)) jamb(i0, i2);
				if (!isOpen(a + 1, k)) jamb(i1, i3);
				if (k > 0 && !isOpen(a, k - 1)) jamb(i0, i1);
				if (k + 1 < K && !isOpen(a, k + 1)) jamb(i2, i3);
				continue;
			}
			idx.push(outerStart + i0, outerStart + i2, outerStart + i1, outerStart + i1, outerStart + i2, outerStart + i3);
			idx.push(innerStart + i0, innerStart + i1, innerStart + i2, innerStart + i1, innerStart + i3, innerStart + i2);
		}
	}
	for (let a = 0; a < A; a++) {
		const top = K * row + a;
		if (!isOpen(a, K - 1)) jamb(top, top + 1);
		if (!isOpen(a, 0)) jamb(a, a + 1);
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
	g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	g.setIndex(idx);
	g.computeVertexNormals();
	return g;
}

/** Hand-placed landmark structures: special trees, tunnels, webs, picnic and garden set pieces. */
export class Features {
	readonly group = new THREE.Group();
	readonly info: FeatureInfo;
	private mats: THREE.Material[] = [];
	private webMat: THREE.LineBasicMaterial;
	private webDiscMat: THREE.MeshBasicMaterial;

	constructor(
		private terrain: Terrain,
		private physics: PhysicsWorld,
		vegetation: Vegetation,
		chunks: ChunkManager
	) {
		const rng = new Random(5150);
		const bark = this.mat(new THREE.MeshLambertMaterial({ vertexColors: true }));
		// Hollow interiors get a faint warm self-light so they aren't pitch black inside.
		const hollowBark = this.mat(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x2a1a0c }));
		const tint = this.mat(tintMaterial({ vertexColors: true }));
		const glow = this.mat(new THREE.MeshBasicMaterial({ vertexColors: true }));
		this.webMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 });
		this.webDiscMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
		this.mats.push(this.webMat, this.webDiscMat);

		// --- Elder Tree: the giant navigation landmark with spiralling shelf fungi. ---
		const elder = landmark('elderTree');
		const ey = terrain.heightAt(elder.x, elder.z);
		const elderChunk = chunks.chunkAt(elder.x, elder.z);
		vegetation.buildTrees(elderChunk, [{ x: elder.x, z: elder.z, y: ey, h: 170, r: 11, yaw: 0.6, special: false }], rng);
		const fungi: THREE.BufferGeometry[] = [];
		for (let i = 0; i < 16; i++) {
			const ang = i * 1.1;
			const h = 10 + i * 7.5;
			const trunkR = 11 * (1 - (h / 158) * 0.4) + 0.4;
			const x = elder.x + Math.cos(ang) * (trunkR + 1.6);
			const z = elder.z + Math.sin(ang) * (trunkR + 1.6);
			const shelf = new THREE.CylinderGeometry(3.4, 3, 0.8, 14, 1, false, -Math.PI / 2, Math.PI);
			shelf.scale(1, 1, 0.75);
			fungi.push(prep(place(shelf, x, ey + h, z, 0, -ang + Math.PI / 2, 0), i % 2 ? 0xf2c46d : 0xe8a95b));
			this.physics.addCuboid(x, ey + h, z, 3, 0.4, 1.6, -ang + Math.PI / 2, { kind: 'static', material: 'plant' });
		}
		this.add(new THREE.Mesh(merge(fungi), bark), true);
		const elderTop = new THREE.Vector3(elder.x, ey + 172, elder.z);

		// --- Hollow Oak: enter at the roots, fly up inside, exit through a knothole. ---
		const ht = landmark('hollowTree');
		const hy = terrain.heightAt(ht.x, ht.z) - 1;
		const htH = 74;
		const doorAng = 1.2;
		const knotAng = doorAng + Math.PI;
		const oakGeo = hollowShell({
			radius: (h) => 9.5 - (h / htH) * 2.6 + (h < 6 ? (6 - h) * 0.45 : 0),
			thickness: 2.2,
			height: htH,
			open: (ang, h) => {
				const d1 = Math.abs(Math.atan2(Math.sin(ang - doorAng), Math.cos(ang - doorAng)));
				const d2 = Math.abs(Math.atan2(Math.sin(ang - knotAng), Math.cos(ang - knotAng)));
				return (d1 < 0.42 && h < 9 * Math.sqrt(Math.max(0, 1 - Math.pow(d1 / 0.42, 4)))) || (d2 < 0.3 && Math.abs(h - 56) < 3.2 * Math.sqrt(Math.max(0, 1 - Math.pow(d2 / 0.3, 2))));
			},
			color: (ang, h, out) => out.setHex(0x6b4a30).lerp(new THREE.Color(0x8d6646), Math.min(1, h / htH) * 0.6 + 0.08 * Math.sin(ang * 11)),
			innerColor: 0xb08458,
			A: 48,
			K: 40
		});
		const oak = new THREE.Mesh(oakGeo, hollowBark);
		oak.position.set(ht.x, hy, ht.z);
		this.add(oak, true);
		const tm = trimeshData(oakGeo, new THREE.Matrix4().makeTranslation(ht.x, hy, ht.z));
		this.physics.addTrimesh(tm.vertices, tm.indices, { kind: 'static', material: 'wood' });
		// Oak canopy (decorative, collisionless) above the open top.
		const canopyGeo = canopyGeometry();
		const oakCanopy: THREE.BufferGeometry[] = [];
		for (let i = 0; i < 7; i++) {
			const a = (i / 7) * Math.PI * 2;
			const g = canopyGeo.clone();
			const s = rng.range(13, 19);
			oakCanopy.push(prep(place(g, Math.cos(a) * 14, htH + rng.range(2, 12), Math.sin(a) * 14, 0, 0, 0, s, s * 0.75, s), 0x58a845));
		}
		const oakCanopyMesh = new THREE.Mesh(merge(oakCanopy), bark);
		oakCanopyMesh.position.copy(oak.position);
		this.add(oakCanopyMesh, true);
		canopyGeo.dispose();
		// Glowing mushrooms lining the inside.
		const glowParts: THREE.BufferGeometry[] = [];
		const mushGeo = mushroomGeometry(false);
		for (let i = 0; i < 14; i++) {
			const a = rng.range(0, Math.PI * 2);
			const h = rng.range(4, 60);
			const r = 9.5 - (h / htH) * 2.6 - 2.4;
			const g = mushGeo.clone();
			const s = rng.range(1.2, 2.2);
			glowParts.push(prep(place(g, ht.x + Math.cos(a) * r, hy + h, ht.z + Math.sin(a) * r, 0, 0, Math.cos(a) * 0.9, s), [0x5ef2ff, 0xb18cff, 0x7dffb0][i % 3]));
		}
		mushGeo.dispose();
		this.add(new THREE.Mesh(merge(glowParts), glow), false);

		// --- Mossy Log Tunnel ---
		const lg = landmark('hollowLog');
		const ly = terrain.heightAt(lg.x, lg.z);
		const logLen = 64;
		const logGeo = hollowShell({
			radius: () => 6.5,
			thickness: 1.5,
			height: logLen,
			open: () => false,
			color: (ang, _h, out) => {
				// After the tube is laid on its side, angle 0 faces up.
				const topness = Math.max(0, Math.cos(ang));
				out.setHex(0x7a5a3a).lerp(new THREE.Color(0x4f9a3a), Math.pow(topness, 1.5));
			},
			innerColor: 0xa47a52,
			A: 32,
			K: 16
		});
		// Lay the tube down: its axis (y) becomes horizontal.
		logGeo.translate(0, -logLen / 2, 0);
		logGeo.rotateZ(Math.PI / 2);
		logGeo.rotateY(0.5);
		const log = new THREE.Mesh(logGeo, hollowBark);
		log.position.set(lg.x, ly + 5.2, lg.z);
		this.add(log, true);
		const lt = trimeshData(logGeo, new THREE.Matrix4().makeTranslation(lg.x, ly + 5.2, lg.z));
		this.physics.addTrimesh(lt.vertices, lt.indices, { kind: 'static', material: 'wood' });
		const logInside = new THREE.Vector3(lg.x, ly + 4.5, lg.z);

		// --- Fairy Ring: giant bouncy mushrooms ---
		const fr = landmark('fairyRing');
		const fy = terrain.heightAt(fr.x, fr.z);
		const giant = mushroomGeometry(true);
		const giantLayer = new THREE.InstancedMesh(giant, tint, 10);
		const m = new THREE.Matrix4();
		const colors = [0xe53935, 0xff7043, 0xab47bc, 0xec407a, 0xffb300];
		for (let i = 0; i < 10; i++) {
			const a = (i / 10) * Math.PI * 2;
			const s = rng.range(8, 15);
			const x = fr.x + Math.cos(a) * 19;
			const z = fr.z + Math.sin(a) * 19;
			const y = terrain.heightAt(x, z) - 0.3;
			m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(s, s, s));
			giantLayer.setMatrixAt(i, m);
			giantLayer.setColorAt(i, new THREE.Color(colors[i % colors.length]));
			this.physics.addCylinder(x, y + s * 0.5, z, s * 0.5, s * 0.24, { kind: 'static', material: 'plant' });
			this.physics.addCylinder(x, y + s * 1.08, z, s * 0.2, s * 0.82, { kind: 'bouncy', material: 'soft' });
		}
		giantLayer.instanceMatrix.needsUpdate = true;
		giantLayer.computeBoundingSphere();
		giantLayer.castShadow = true;
		this.add(giantLayer, true);
		const ringGlow: THREE.BufferGeometry[] = [];
		const smallMush = mushroomGeometry(false);
		for (let i = 0; i < 24; i++) {
			const a = (i / 24) * Math.PI * 2;
			const x = fr.x + Math.cos(a) * 9;
			const z = fr.z + Math.sin(a) * 9;
			ringGlow.push(prep(place(smallMush.clone(), x, terrain.heightAt(x, z) - 0.1, z, 0, a, 0, 1.4), i % 2 ? 0x7dffb0 : 0xb18cff));
		}
		smallMush.dispose();
		this.add(new THREE.Mesh(merge(ringGlow), glow), false);

		// --- Spider Grove webs ---
		const sg = landmark('spiderGrove');
		const webs: Web[] = [];
		const spiderHomes: THREE.Vector3[] = [];
		for (let i = 0; i < 6; i++) {
			const a = (i / 6) * Math.PI * 2 + 0.3;
			const d = rng.range(12, 34);
			const x = sg.x + Math.cos(a) * d;
			const z = sg.z + Math.sin(a) * d;
			const y = terrain.heightAt(x, z) + rng.range(7, 16);
			const r = rng.range(6, 9);
			const yaw = rng.range(0, Math.PI);
			const normal = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
			const center = new THREE.Vector3(x, y, z);
			const mesh = this.buildWeb(r);
			mesh.position.copy(center);
			mesh.lookAt(center.clone().add(normal));
			this.group.add(mesh);
			// Twig frame posts holding the web.
			const side = new THREE.Vector3(-normal.z, 0, normal.x);
			for (const sgn of [-1, 1]) {
				const px = x + side.x * (r + 0.5) * sgn;
				const pz = z + side.z * (r + 0.5) * sgn;
				const gy = terrain.heightAt(px, pz);
				const postH = y + r - gy;
				const post = new THREE.CylinderGeometry(0.5, 0.8, postH, 6);
				this.add(new THREE.Mesh(prep(place(post, px, gy + postH / 2, pz), 0x5d4030), bark), true);
				this.physics.addCylinder(px, gy + postH / 2, pz, postH / 2, 0.7);
			}
			webs.push({ center, normal, radius: r, mesh, broken: false, respawnAt: 0 });
			spiderHomes.push(center.clone().addScaledVector(side, r * 0.4).setY(y + r * 0.6));
		}

		// --- Picnic blanket ---
		const pic = landmark('picnic');
		const picnicY = terrain.heightAt(pic.x, pic.z) + 0.15;
		const checker = canvasTexture(256, 256, (ctx) => {
			for (let i = 0; i < 8; i++)
				for (let j = 0; j < 8; j++) {
					ctx.fillStyle = (i + j) % 2 ? '#e8463c' : '#fff6ea';
					ctx.fillRect(i * 32, j * 32, 32, 32);
				}
			ctx.fillStyle = 'rgba(255,255,255,0.12)';
			for (let i = 0; i < 256; i += 4) ctx.fillRect(i, 0, 1, 256);
		});
		checker.wrapS = checker.wrapT = THREE.RepeatWrapping;
		checker.repeat.set(2.5, 2);
		const blanketMat = this.mat(new THREE.MeshLambertMaterial({ map: checker }));
		const blanket = new THREE.Mesh(new THREE.PlaneGeometry(40, 30, 8, 6).rotateX(-Math.PI / 2), blanketMat);
		blanket.position.set(pic.x, picnicY, pic.z);
		blanket.receiveShadow = true;
		this.group.add(blanket);
		this.physics.addCuboid(pic.x, picnicY - 0.4, pic.z, 20, 0.4, 15, 0, { kind: 'static', material: 'soft' });

		// Cherry tree hanging over the blanket.
		const cherryBase = new THREE.Vector3(-125, terrain.heightAt(-125, 72), 72);
		const cherry: THREE.BufferGeometry[] = [];
		const trunk = new THREE.CylinderGeometry(1.4, 2.4, 26, 10);
		cherry.push(prep(place(trunk, cherryBase.x, cherryBase.y + 13, cherryBase.z, 0, 0, -0.08), 0x6b4430));
		this.physics.addCylinder(cherryBase.x, cherryBase.y + 13, cherryBase.z, 13, 2);
		const branchEnd = new THREE.Vector3(pic.x - 10, cherryBase.y + 30, pic.z - 6);
		const bstart = new THREE.Vector3(cherryBase.x + 1, cherryBase.y + 22, cherryBase.z);
		const bdir = branchEnd.clone().sub(bstart);
		const blen = bdir.length();
		const branchG = new THREE.CylinderGeometry(0.5, 1.1, blen, 8);
		branchG.translate(0, blen / 2, 0);
		branchG.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), bdir.clone().normalize()));
		branchG.translate(bstart.x, bstart.y, bstart.z);
		cherry.push(prep(branchG, 0x6b4430));
		this.physics.addCapsuleBetween(bstart, branchEnd, 0.8);
		const blossomPts = [branchEnd, bstart.clone().lerp(branchEnd, 0.5).add(new THREE.Vector3(0, 4, 0)), new THREE.Vector3(cherryBase.x, cherryBase.y + 30, cherryBase.z)];
		for (const bp of blossomPts) {
			for (let i = 0; i < 4; i++) {
				const b = blob(rng.range(5, 8), 1, 0.2, i + 3);
				cherry.push(prep(place(b, bp.x + rng.range(-5, 5), bp.y + rng.range(1, 6), bp.z + rng.range(-5, 5)), i % 2 ? 0xf8bbd0 : 0xf48fb1));
			}
		}
		const cherryMesh = new THREE.Mesh(merge(cherry), bark);
		this.add(cherryMesh, true);
		const cherryPoints: THREE.Vector3[] = [];
		for (let i = 0; i < 6; i++) {
			const t = 0.55 + i * 0.08;
			const p = bstart.clone().lerp(branchEnd, t);
			p.y -= 3.2;
			p.x += rng.range(-1.5, 1.5);
			p.z += rng.range(-1.5, 1.5);
			cherryPoints.push(p);
		}

		// --- Gardener's Corner: bench shelf, fence, raised bed ---
		const gar = landmark('garden');
		const gy = terrain.heightAt(gar.x, gar.z);
		const wood: THREE.BufferGeometry[] = [];
		const benchY = gy + 5;
		wood.push(prep(place(new THREE.BoxGeometry(22, 0.8, 5), gar.x, benchY, gar.z - 8), 0xa0703f));
		for (const sx of [-9.5, 9.5]) {
			wood.push(prep(place(new THREE.BoxGeometry(1, 5, 4), gar.x + sx, gy + 2.5, gar.z - 8), 0x7d5530));
			this.physics.addCuboid(gar.x + sx, gy + 2.5, gar.z - 8, 0.5, 2.5, 2);
		}
		this.physics.addCuboid(gar.x, benchY, gar.z - 8, 11, 0.4, 2.5);
		const gardenShelf = [-7, -2, 3, 8].map((dx) => new THREE.Vector3(gar.x + dx, benchY + 0.4, gar.z - 8));
		// Fence along the south side, with posts used as bird perches.
		const fencePosts: THREE.Vector3[] = [];
		for (let i = 0; i < 9; i++) {
			const x = gar.x - 24 + i * 6;
			const z = gar.z + 18;
			const y = terrain.heightAt(x, z);
			wood.push(prep(place(new THREE.BoxGeometry(1.2, 9, 1.2), x, y + 4.5, z), 0xc9a27a));
			wood.push(prep(place(new THREE.ConeGeometry(0.9, 1.2, 4), x, y + 9.6, z, 0, Math.PI / 4, 0), 0xc9a27a));
			this.physics.addCuboid(x, y + 4.5, z, 0.6, 4.5, 0.6);
			fencePosts.push(new THREE.Vector3(x, y + 10.4, z));
		}
		for (const ry of [3, 6.5]) {
			wood.push(prep(place(new THREE.BoxGeometry(48, 0.8, 0.4), gar.x, gy + ry, gar.z + 18), 0xd8b48c));
		}
		this.physics.addCuboid(gar.x, gy + 4.75, gar.z + 18, 24, 2.2, 0.3);
		// Raised vegetable bed.
		wood.push(prep(place(new THREE.BoxGeometry(18, 2, 10), gar.x + 4, gy + 1, gar.z + 4), 0x8a5a33));
		wood.push(prep(place(new THREE.BoxGeometry(17, 0.3, 9), gar.x + 4, gy + 2.05, gar.z + 4), 0x4a3020));
		this.physics.addCuboid(gar.x + 4, gy + 1.1, gar.z + 4, 9, 1.1, 5);
		for (let i = 0; i < 6; i++) {
			const b = blob(1.6, 1, 0.25, i);
			wood.push(prep(place(b, gar.x - 2 + (i % 3) * 6, gy + 3, gar.z + 1.5 + Math.floor(i / 3) * 5), i % 2 ? 0x7cb342 : 0x9ccc65));
		}
		this.add(new THREE.Mesh(merge(wood), bark), true);

		// --- Bird nest tree near the forest edge ---
		const bn = landmark('birdNest');
		const by = terrain.heightAt(bn.x, bn.z);
		vegetation.buildTrees(chunks.chunkAt(bn.x, bn.z), [{ x: bn.x, z: bn.z, y: by, h: 72, r: 4.2, yaw: 2.1, special: false }], rng);
		const nestPos = new THREE.Vector3(bn.x + 6.2, by + 38, bn.z);
		const nest = new THREE.TorusGeometry(3.2, 1.3, 8, 20).rotateX(Math.PI / 2);
		const nestParts = [prep(place(nest, nestPos.x, nestPos.y, nestPos.z), 0x8d6e4a), prep(place(new THREE.CylinderGeometry(3, 2, 1.2, 14), nestPos.x, nestPos.y - 0.6, nestPos.z), 0x6d4c33)];
		for (let i = 0; i < 3; i++) nestParts.push(prep(place(new THREE.SphereGeometry(0.9, 8, 6), nestPos.x + (i - 1) * 1.3, nestPos.y + 0.2, nestPos.z + (i % 2) * 0.8, 0, 0, 0, 1, 1.25, 1), 0x8fd3f4));
		this.add(new THREE.Mesh(merge(nestParts), bark), true);
		this.physics.addCylinder(nestPos.x, nestPos.y - 0.4, nestPos.z, 0.9, 4);
		const nestBranchA = new THREE.Vector3(bn.x, by + 37, bn.z);
		const nestBranch = new THREE.CylinderGeometry(0.6, 0.9, 7, 6);
		nestBranch.rotateZ(Math.PI / 2);
		this.add(new THREE.Mesh(prep(place(nestBranch, bn.x + 3.5, by + 37, bn.z), 0x6b4a30), bark), true);
		this.physics.addCapsuleBetween(nestBranchA, nestPos.clone().setY(by + 37), 0.7);

		// --- Forest berry bushes (hanging berries become props) ---
		const berryPoints: THREE.Vector3[] = [];
		const berryBush: THREE.BufferGeometry[] = [];
		const spots = [
			{ x: -60, z: -230 },
			{ x: 120, z: -260 },
			{ x: -230, z: -300 },
			{ x: 60, z: -330 }
		];
		for (const s of spots) {
			const y = terrain.heightAt(s.x, s.z);
			for (let i = 0; i < 4; i++) {
				const b = blob(3.2, 1, 0.22, i + 9);
				berryBush.push(prep(place(b, s.x + rng.range(-3, 3), y + 3.5 + rng.range(0, 2), s.z + rng.range(-3, 3)), i % 2 ? 0x2e7d32 : 0x388e3c));
			}
			// Arching twig the berries hang from.
			const twig = new THREE.CylinderGeometry(0.25, 0.4, 14, 5);
			twig.rotateZ(Math.PI / 2);
			berryBush.push(prep(place(twig, s.x, y + 11, s.z), 0x5d4030));
			for (let i = 0; i < 3; i++) berryPoints.push(new THREE.Vector3(s.x - 4 + i * 4, y + 9.4, s.z));
			this.physics.addCuboid(s.x, y + 11, s.z, 7, 0.3, 0.3);
		}
		this.add(new THREE.Mesh(merge(berryBush), bark), true);

		// --- Waterfall rocks, updraft stones and the summit cairn ---
		const rocks: THREE.BufferGeometry[] = [];
		const fallX = -206;
		const fallZ = -160;
		for (let i = 0; i < 10; i++) {
			const a = (i / 10) * Math.PI * 2;
			const x = fallX + Math.cos(a) * rng.range(12, 20);
			const z = fallZ + Math.sin(a) * rng.range(10, 18);
			const y = terrain.heightAt(x, z);
			const s = rng.range(2.5, 5);
			rocks.push(prep(place(blob(1, 1, 0.3, i), x, y + s * 0.3, z, 0, 0, 0, s, s * 0.8, s), 0x8a8d8f));
			this.physics.addBall(x, y + s * 0.3, z, s * 0.75);
		}
		const updrafts: Updraft[] = [];
		const updraftSpots = [
			{ x: 60, z: 160 },
			{ x: -40, z: 260 },
			{ x: 300, z: 60 },
			{ x: -240, z: 160 }
		];
		for (const u of updraftSpots) {
			const y = terrain.heightAt(u.x, u.z);
			for (let i = 0; i < 7; i++) {
				const a = (i / 7) * Math.PI * 2;
				rocks.push(prep(place(blob(1, 1, 0.25, i + 30), u.x + Math.cos(a) * 7, y + 0.4, u.z + Math.sin(a) * 7, 0, a, 0, 1.6, 1.1, 1.4), 0xd7a26a));
			}
			updrafts.push({ x: u.x, z: u.z, r: 8, y0: y, y1: y + 120, strength: 30 });
		}
		const summit = landmark('summit');
		const sy = terrain.heightAt(summit.x, summit.z);
		for (let i = 0; i < 5; i++) {
			const s = 4 - i * 0.6;
			rocks.push(prep(place(blob(1, 1, 0.2, i + 50), summit.x, sy + 1 + i * 2.6, summit.z, 0, i, 0, s, s * 0.6, s), 0xb0aabb));
			this.physics.addBall(summit.x, sy + 1 + i * 2.6, summit.z, s * 0.6);
		}
		this.add(new THREE.Mesh(merge(rocks), this.mat(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }))), true);

		this.info = {
			webs,
			updrafts,
			picnicY,
			cherryPoints,
			berryPoints,
			birdPerches: [nestPos.clone().setY(nestPos.y + 1.5), fencePosts[4], fencePosts[1]],
			hollowTreeInside: new THREE.Vector3(ht.x, hy + 40, ht.z),
			hollowTreeTop: new THREE.Vector3(ht.x, hy + htH - 6, ht.z),
			logInside,
			elderTop,
			gardenShelf,
			gardenY: gy,
			fairyCenter: new THREE.Vector3(fr.x, fy, fr.z),
			summit: new THREE.Vector3(summit.x, sy + 16, summit.z),
			spiderHomes
		};
	}

	private mat<T extends THREE.Material>(m: T): T {
		this.mats.push(m);
		return m;
	}

	private add(mesh: THREE.Mesh, shadow: boolean): void {
		mesh.castShadow = shadow;
		mesh.receiveShadow = true;
		this.group.add(mesh);
	}

	private buildWeb(r: number): THREE.Group {
		const g = new THREE.Group();
		const pts: number[] = [];
		const spokes = 14;
		for (let i = 0; i < spokes; i++) {
			const a = (i / spokes) * Math.PI * 2;
			pts.push(0, 0, 0, Math.cos(a) * r, Math.sin(a) * r, 0);
		}
		let prev: [number, number] | null = null;
		for (let t = 0; t < spokes * 7; t++) {
			const a = (t / spokes) * Math.PI * 2;
			const rr = r * (0.12 + (t / (spokes * 7)) * 0.86);
			const cur: [number, number] = [Math.cos(a) * rr, Math.sin(a) * rr];
			if (prev) pts.push(prev[0], prev[1], 0, cur[0], cur[1], 0);
			prev = cur;
		}
		const lg = new THREE.BufferGeometry();
		lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
		g.add(new THREE.LineSegments(lg, this.webMat));
		g.add(new THREE.Mesh(new THREE.CircleGeometry(r, 24), this.webDiscMat));
		return g;
	}

	setWebVisible(web: Web, visible: boolean): void {
		web.mesh.visible = visible;
	}

	dispose(): void {
		this.group.traverse((o) => {
			if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose();
		});
		for (const m of this.mats) m.dispose();
	}
}
