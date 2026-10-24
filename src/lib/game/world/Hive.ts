import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { HIVE, hiveDomeRadius } from './Biomes';
import { canvasTexture, merge, place, prep, trimeshData } from '../utils/geometry';
import { Random } from '../utils/Random';
import { wrapAngle } from '../utils/math';

const SQRT3 = Math.sqrt(3);

export function honeycombTexture(base: string, line: string, glow = false): THREE.CanvasTexture {
	const R = 256 / (2 * SQRT3);
	const W = 256;
	const H = Math.round(3 * R);
	const tex = canvasTexture(W, H, (ctx) => {
		ctx.fillStyle = base;
		ctx.fillRect(0, 0, W, H);
		const w = SQRT3 * R;
		for (let row = -1; row <= 3; row++) {
			for (let col = -1; col <= 3; col++) {
				const cx = col * w + (row % 2 ? w / 2 : 0);
				const cy = row * 1.5 * R;
				ctx.beginPath();
				for (let k = 0; k < 6; k++) {
					const a = Math.PI / 6 + (k * Math.PI) / 3;
					const x = cx + Math.cos(a) * (R - 3);
					const y = cy + Math.sin(a) * (R - 3);
					if (k === 0) ctx.moveTo(x, y);
					else ctx.lineTo(x, y);
				}
				ctx.closePath();
				if (glow) {
					const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, R);
					g.addColorStop(0, '#ffd45c');
					g.addColorStop(1, base);
					ctx.fillStyle = g;
					ctx.fill();
				}
				ctx.lineWidth = 7;
				ctx.strokeStyle = line;
				ctx.stroke();
			}
		}
	});
	tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
	return tex;
}

/** Points of interest inside the hive used by NPCs, collectibles and systems. */
export interface HiveInfo {
	entrance: THREE.Vector3;
	entranceOutside: THREE.Vector3;
	honeyPool: { x: number; y: number; z: number; r: number };
	nectarDeposit: THREE.Vector3;
	throne: THREE.Vector3;
	attic: THREE.Vector3;
	apex: THREE.Vector3;
	waypoints: THREE.Vector3[];
	shelves: THREE.Vector3[];
	ceilingHooks: THREE.Vector3[];
	waxStack: THREE.Vector3;
}

/**
 * The giant skep hive on an old tree stump. The dome is a hollow shell (trimesh collider)
 * with an arched entrance, a secret hole at the apex and four interior floors.
 */
export class Hive {
	readonly group = new THREE.Group();
	readonly interior = new THREE.Group();
	readonly info: HiveInfo;
	readonly lights: THREE.PointLight[] = [];
	private disposables: { dispose(): void }[] = [];

	constructor(physics: PhysicsWorld) {
		const cx = HIVE.x;
		const cz = HIVE.z;
		const base = HIVE.baseY;
		this.group.name = 'hive';
		this.group.add(this.interior);

		// --- Stump ---------------------------------------------------------------
		const stumpH = HIVE.stumpHeight + 3;
		const stump = new THREE.CylinderGeometry(HIVE.stumpRadius, HIVE.stumpRadius + 5, stumpH, 48, 4, true);
		{
			const pos = stump.attributes.position;
			const v = new THREE.Vector3();
			for (let i = 0; i < pos.count; i++) {
				v.fromBufferAttribute(pos, i);
				const a = Math.atan2(v.z, v.x);
				const s = 1 + 0.035 * Math.sin(a * 23) + (v.y < -stumpH / 2 + 3 ? 0.08 * Math.max(0, Math.cos(a * 6)) : 0);
				pos.setXYZ(i, v.x * s, v.y, v.z * s);
			}
			stump.computeVertexNormals();
		}
		const stumpMesh = new THREE.Mesh(prep(stump, 0x7a5236), this.track(new THREE.MeshLambertMaterial({ vertexColors: true })));
		stumpMesh.position.set(cx, base - stumpH / 2, cz);
		stumpMesh.castShadow = true;
		stumpMesh.receiveShadow = true;
		this.group.add(stumpMesh);
		physics.addCylinder(cx, base - stumpH / 2, cz, stumpH / 2, HIVE.stumpRadius + 1.5, { kind: 'static', material: 'wood' });

		const ringTex = canvasTexture(512, 512, (ctx) => {
			ctx.fillStyle = '#d9b07a';
			ctx.fillRect(0, 0, 512, 512);
			for (let r = 250; r > 4; r -= 9 + Math.sin(r) * 3) {
				ctx.beginPath();
				ctx.arc(256, 256, r, 0, Math.PI * 2);
				ctx.strokeStyle = r % 2 ? '#b98c58' : '#c99d66';
				ctx.lineWidth = 3;
				ctx.stroke();
			}
			ctx.fillStyle = '#8a5a34';
			ctx.beginPath();
			ctx.arc(256, 256, 252, 0, Math.PI * 2);
			ctx.lineWidth = 8;
			ctx.strokeStyle = '#6e4428';
			ctx.stroke();
		});
		this.track(ringTex);
		const top = new THREE.CircleGeometry(HIVE.stumpRadius + 0.3, 64);
		top.rotateX(-Math.PI / 2);
		const topMesh = new THREE.Mesh(top, this.track(new THREE.MeshLambertMaterial({ map: ringTex })));
		topMesh.position.set(cx, base + 0.01, cz);
		topMesh.receiveShadow = true;
		this.group.add(topMesh);

		// --- Dome shell ----------------------------------------------------------
		const shell = this.buildShell();
		const straw = this.track(new THREE.MeshLambertMaterial({ vertexColors: true }));
		const shellMesh = new THREE.Mesh(shell.outer, straw);
		shellMesh.position.set(cx, base, cz);
		shellMesh.castShadow = true;
		shellMesh.receiveShadow = true;
		this.group.add(shellMesh);
		const waxTex = this.track(honeycombTexture('#e9a93a', '#c98420'));
		waxTex.repeat.set(10, 7);
		const innerMesh = new THREE.Mesh(shell.inner, this.track(new THREE.MeshLambertMaterial({ map: waxTex, color: 0xffe2a8 })));
		innerMesh.position.copy(shellMesh.position);
		innerMesh.receiveShadow = true;
		this.group.add(innerMesh);
		const m = new THREE.Matrix4().makeTranslation(cx, base, cz);
		for (const g of [shell.outer, shell.inner]) {
			const t = trimeshData(g, m);
			physics.addTrimesh(t.vertices, t.indices, { kind: 'static', material: 'wax' });
		}

		// Arch trim around the entrance.
		const ea = HIVE.entranceAngle;
		const archPts: THREE.Vector3[] = [];
		for (let i = 0; i <= 24; i++) {
			const t = i / 24;
			const ang = ea + (t * 2 - 1) * HIVE.entranceHalfAngle * 1.05;
			const u = Math.abs(t * 2 - 1);
			const h = u > 0.999 ? 0 : HIVE.entranceHeight * Math.sqrt(1 - Math.pow(u, 6));
			const r = hiveDomeRadius(h) + 0.3;
			archPts.push(new THREE.Vector3(Math.cos(ang) * r, h, Math.sin(ang) * r));
		}
		const arch = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(archPts), 40, 1.1, 8, false);
		const archMesh = new THREE.Mesh(prep(arch, 0x8a5a2b), this.track(new THREE.MeshLambertMaterial({ vertexColors: true })));
		archMesh.position.set(cx, base, cz);
		archMesh.castShadow = true;
		this.group.add(archMesh);

		// Honey drips on the outside of the dome.
		const honeyMat = this.track(
			new THREE.MeshStandardMaterial({ color: 0xffa000, emissive: 0xff7b00, emissiveIntensity: 0.35, roughness: 0.18, metalness: 0.05 })
		);
		const rng = new Random(4040);
		const drips: THREE.BufferGeometry[] = [];
		for (let i = 0; i < 14; i++) {
			const ang = ea + rng.range(-0.9, 0.9) + (i % 2 ? Math.PI : 0);
			const h = rng.range(18, 45);
			const r = hiveDomeRadius(h) + 0.4;
			const len = rng.range(2, 5);
			const d = new THREE.CapsuleGeometry(0.55, len, 3, 8);
			drips.push(prep(place(d, Math.cos(ang) * r, h - len / 2, Math.sin(ang) * r)));
		}
		const dripMesh = new THREE.Mesh(merge(drips), honeyMat);
		dripMesh.position.set(cx, base, cz);
		this.group.add(dripMesh);

		// --- Floors ---------------------------------------------------------------
		const floorTex = this.track(honeycombTexture('#f0b445', '#c98a2a'));
		floorTex.repeat.set(0.09, 0.1);
		const floorMat = this.track(new THREE.MeshLambertMaterial({ map: floorTex }));
		const atticAngle = ea + Math.PI * 0.85;
		const atticHole = { x: Math.cos(atticAngle) * 9, z: Math.sin(atticAngle) * 9, r: 2.8 };
		const holes: { inner: number; hole?: typeof atticHole }[] = [{ inner: 11 }, { inner: 9 }, { inner: 6.5 }, { inner: 0, hole: atticHole }];
		HIVE.levels.forEach((lh, i) => {
			const outer = hiveDomeRadius(lh) - HIVE.wall + 0.6;
			const g = floorGeometry(holes[i].inner, outer, 1, holes[i].hole);
			const mesh = new THREE.Mesh(g, floorMat);
			mesh.position.set(cx, base + lh, cz);
			mesh.receiveShadow = true;
			mesh.castShadow = true;
			this.group.add(mesh);
			const t = trimeshData(g, new THREE.Matrix4().makeTranslation(cx, base + lh, cz));
			physics.addTrimesh(t.vertices, t.indices, { kind: 'static', material: 'wax' });
		});

		// --- Honey storage + nursery cells on the inner wall ------------------------------
		const cellGeo = new THREE.CylinderGeometry(1.25, 1.25, 1.3, 6, 1, true);
		cellGeo.rotateX(Math.PI / 2);
		const cellFill = new THREE.CircleGeometry(1.08, 6);
		const cells: THREE.Matrix4[] = [];
		const honeyFills: THREE.Matrix4[] = [];
		const larvae: THREE.Matrix4[] = [];
		const caps: THREE.Matrix4[] = [];
		const q = new THREE.Quaternion();
		const up = new THREE.Vector3(0, 1, 0);
		const placeCell = (ang: number, h: number, kind: 'honey' | 'larva' | 'cap') => {
			const r = hiveDomeRadius(h) - HIVE.wall - 0.5;
			const p = new THREE.Vector3(cx + Math.cos(ang) * r, base + h, cz + Math.sin(ang) * r);
			q.setFromAxisAngle(up, -ang - Math.PI / 2);
			const mm = new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
			cells.push(mm);
			const front = new THREE.Vector3(-Math.cos(ang), 0, -Math.sin(ang));
			if (kind === 'honey') honeyFills.push(new THREE.Matrix4().compose(p.clone().addScaledVector(front, 0.2), q.clone(), new THREE.Vector3(1, 1, 1)));
			if (kind === 'cap') caps.push(new THREE.Matrix4().compose(p.clone().addScaledVector(front, 0.5), q.clone(), new THREE.Vector3(1, 1, 1)));
			if (kind === 'larva')
				larvae.push(
					new THREE.Matrix4().compose(
						p.clone().addScaledVector(front, 0.1),
						new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(0, 6), rng.range(0, 6), 0)),
						new THREE.Vector3(0.8, 0.6, 0.6)
					)
				);
		};
		for (let row = 0; row < 6; row++) {
			const h = 2 + row * 2.15;
			const r = hiveDomeRadius(h) - HIVE.wall - 0.5;
			const n = Math.floor((Math.PI * 2 * r) / 2.2);
			for (let k = 0; k < n; k++) {
				const ang = (k + (row % 2) * 0.5) * ((Math.PI * 2) / n);
				if (Math.abs(wrapAngle(ang - ea)) < HIVE.entranceHalfAngle + 0.12) continue;
				placeCell(ang, h, 'honey');
			}
		}
		for (let row = 0; row < 5; row++) {
			const h = HIVE.levels[0] + 2.4 + row * 2.15;
			const r = hiveDomeRadius(h) - HIVE.wall - 0.5;
			const n = Math.floor((Math.PI * 2 * r) / 2.2);
			for (let k = 0; k < n; k++) {
				const ang = (k + (row % 2) * 0.5) * ((Math.PI * 2) / n);
				placeCell(ang, h, rng.chance(0.55) ? 'larva' : 'cap');
			}
		}
		const waxCellMat = this.track(new THREE.MeshLambertMaterial({ color: 0xf4b942, side: THREE.DoubleSide }));
		this.addInstanced(cellGeo, waxCellMat, cells);
		this.addInstanced(cellFill, honeyMat, honeyFills);
		this.addInstanced(new THREE.SphereGeometry(1, 10, 8), this.track(new THREE.MeshLambertMaterial({ color: 0xfff8ec, emissive: 0x332a20 })), larvae);
		this.addInstanced(new THREE.CircleGeometry(1.15, 6), this.track(new THREE.MeshLambertMaterial({ color: 0xe8c27a })), caps);

		// --- Honey pool on the ground floor -----------------------------------------
		const pool = new THREE.Mesh(new THREE.CircleGeometry(7, 40).rotateX(-Math.PI / 2), honeyMat);
		pool.position.set(cx, base + 0.35, cz);
		this.interior.add(pool);
		const rim = new THREE.Mesh(new THREE.TorusGeometry(7.2, 0.7, 8, 40).rotateX(Math.PI / 2), waxCellMat);
		rim.position.set(cx, base + 0.4, cz);
		this.interior.add(rim);

		// Nectar deposit: a big glowing cell just inside the entrance.
		const depAng = ea + 0.55;
		const depR = hiveDomeRadius(4) - HIVE.wall - 4;
		const nectarDeposit = new THREE.Vector3(cx + Math.cos(depAng) * depR, base + 3.2, cz + Math.sin(depAng) * depR);
		const depGeo = new THREE.CylinderGeometry(3, 3, 1.2, 6);
		const dep = new THREE.Mesh(depGeo, this.track(new THREE.MeshStandardMaterial({ color: 0xffc107, emissive: 0xffa000, emissiveIntensity: 0.8, roughness: 0.3 })));
		dep.position.copy(nectarDeposit).setY(base + 0.6);
		this.interior.add(dep);
		const depRing = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.25, 6, 6).rotateX(Math.PI / 2), waxCellMat);
		depRing.position.copy(dep.position).setY(base + 1.25);
		this.interior.add(depRing);

		// --- Workshop shelves (level 2) ---------------------------------------------
		const shelfMat = this.track(new THREE.MeshLambertMaterial({ color: 0xd9962e }));
		const shelves: THREE.Vector3[] = [];
		for (let i = 0; i < 4; i++) {
			const ang = ea + Math.PI * 0.5 + i * 0.55;
			const h = HIVE.levels[1] + 4;
			const r = hiveDomeRadius(h) - HIVE.wall - 2.4;
			const p = new THREE.Vector3(cx + Math.cos(ang) * r, base + h, cz + Math.sin(ang) * r);
			const shelf = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.6, 3), shelfMat);
			shelf.position.copy(p);
			shelf.rotation.y = -ang + Math.PI / 2;
			shelf.castShadow = true;
			this.interior.add(shelf);
			physics.addCuboid(p.x, p.y, p.z, 2.75, 0.3, 1.5, -ang + Math.PI / 2, { kind: 'static', material: 'wax' });
			shelves.push(p.clone().setY(p.y + 0.3));
		}
		const ceilingHooks: THREE.Vector3[] = [];
		for (let i = 0; i < 5; i++) {
			const ang = ea + Math.PI + (i - 2) * 0.5;
			const r = 15;
			ceilingHooks.push(new THREE.Vector3(cx + Math.cos(ang) * r, base + HIVE.levels[2] - 0.6, cz + Math.sin(ang) * r));
		}

		// --- Queen's chamber -------------------------------------------------------
		const thAng = ea + Math.PI;
		const throne = new THREE.Vector3(cx + Math.cos(thAng) * 12, base + HIVE.levels[2] + 0.5, cz + Math.sin(thAng) * 12);
		const royal = this.track(new THREE.MeshStandardMaterial({ color: 0xffca28, emissive: 0xff8f00, emissiveIntensity: 0.25, roughness: 0.25, metalness: 0.4 }));
		const velvet = this.track(new THREE.MeshLambertMaterial({ color: 0xb0204a }));
		const seat = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.6, 2.2, 6), royal);
		seat.position.copy(throne).setY(throne.y + 1.1);
		const back = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 7, 6, 1, false, 0, Math.PI), royal);
		back.position.copy(throne).setY(throne.y + 3.5);
		back.rotation.y = -thAng - Math.PI / 2;
		const cushion = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.6, 16), velvet);
		cushion.position.copy(throne).setY(throne.y + 2.45);
		const carpet = new THREE.Mesh(new THREE.CircleGeometry(9, 32).rotateX(-Math.PI / 2), velvet);
		carpet.position.copy(throne).setY(base + HIVE.levels[2] + 0.52);
		for (const o of [seat, back, cushion, carpet]) {
			o.castShadow = true;
			this.interior.add(o);
		}
		physics.addCylinder(seat.position.x, seat.position.y, seat.position.z, 1.1, 3.4, { kind: 'static', material: 'wax' });

		// Royal attic treasure glow.
		const attic = new THREE.Vector3(cx + Math.cos(atticAngle + Math.PI) * 5, base + HIVE.levels[3] + 2.5, cz + Math.sin(atticAngle + Math.PI) * 5);
		const pile = new THREE.Mesh(new THREE.ConeGeometry(4, 2.5, 6), royal);
		pile.position.copy(attic).setY(base + HIVE.levels[3] + 1.75);
		this.interior.add(pile);

		// --- Interior lights ------------------------------------------------------
		for (const h of [8, 36]) {
			const l = new THREE.PointLight(0xffb347, 0, 90, 1.4);
			l.position.set(cx, base + h, cz);
			this.lights.push(l);
			this.group.add(l);
		}

		this.interior.traverse((o) => {
			if (o instanceof THREE.Mesh) o.receiveShadow = true;
		});

		const out = new THREE.Vector3(Math.cos(ea), 0, Math.sin(ea));
		const entranceR = hiveDomeRadius(0);
		const waypoints: THREE.Vector3[] = [];
		const levelsMid = [6, HIVE.levels[0] + 6, HIVE.levels[1] + 6, HIVE.levels[2] + 4];
		levelsMid.forEach((h, li) => {
			const r = Math.max(4, hiveDomeRadius(h) - HIVE.wall - 6);
			for (let k = 0; k < 5; k++) {
				const a = (k / 5) * Math.PI * 2 + li;
				waypoints.push(new THREE.Vector3(cx + Math.cos(a) * r, base + h, cz + Math.sin(a) * r));
			}
		});

		this.info = {
			entrance: new THREE.Vector3(cx + out.x * (entranceR - 3), base + 4, cz + out.z * (entranceR - 3)),
			entranceOutside: new THREE.Vector3(cx + out.x * (entranceR + 14), base + 6, cz + out.z * (entranceR + 14)),
			honeyPool: { x: cx, y: base + 0.35, z: cz, r: 7 },
			nectarDeposit,
			throne,
			attic,
			apex: new THREE.Vector3(cx, base + HIVE.domeHeight, cz),
			waypoints,
			shelves,
			ceilingHooks,
			waxStack: new THREE.Vector3(cx + Math.cos(ea + Math.PI * 1.4) * 14, base + HIVE.levels[1] + 0.5, cz + Math.sin(ea + Math.PI * 1.4) * 14)
		};
	}

	private track<T extends { dispose(): void }>(o: T): T {
		this.disposables.push(o);
		return o;
	}

	private addInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[]): void {
		if (!mats.length) return;
		const mesh = new THREE.InstancedMesh(geo, mat, mats.length);
		mats.forEach((mm, i) => mesh.setMatrixAt(i, mm));
		mesh.instanceMatrix.needsUpdate = true;
		mesh.computeBoundingSphere();
		mesh.receiveShadow = true;
		this.interior.add(mesh);
		this.track(geo);
	}

	/** Builds outer (straw coils) and inner (wax) surfaces with an entrance cut and closed edges. */
	private buildShell(): { outer: THREE.BufferGeometry; inner: THREE.BufferGeometry } {
		const A = 72;
		const K = 84;
		const hTop = topHeight();
		const ea = HIVE.entranceAngle;
		const isOpen = (a: number, k: number): boolean => {
			const ang = ((a + 0.5) / A) * Math.PI * 2;
			const h = ((k + 0.5) / K) * hTop;
			const u = Math.abs(wrapAngle(ang - ea)) / HIVE.entranceHalfAngle;
			if (u >= 1) return false;
			return h < HIVE.entranceHeight * Math.sqrt(1 - Math.pow(u, 6));
		};
		const outerPos: number[] = [];
		const innerPos: number[] = [];
		const outerCol: number[] = [];
		const innerUv: number[] = [];
		const c = new THREE.Color();
		const coil = 3.1;
		for (let k = 0; k <= K; k++) {
			const h = (k / K) * hTop;
			const groove = 0.5 + 0.5 * Math.cos((h / coil) * Math.PI * 2);
			const ro = hiveDomeRadius(h) + 0.5 * groove;
			const ri = Math.max(HIVE.topHoleRadius * 0.5, hiveDomeRadius(h) - HIVE.wall);
			c.setHex(0xe0a63a).lerp(new THREE.Color(0x9c6420), (1 - groove) * 0.75);
			for (let a = 0; a <= A; a++) {
				const ang = (a / A) * Math.PI * 2;
				const ca = Math.cos(ang);
				const sa = Math.sin(ang);
				const tint = 0.94 + 0.06 * Math.sin(ang * 13 + h * 0.7);
				outerPos.push(ca * ro, h, sa * ro);
				outerCol.push(c.r * tint, c.g * tint, c.b * tint);
				innerPos.push(ca * ri, h, sa * ri);
				innerUv.push(a / A, h / hTop);
			}
		}
		const outerIdx: number[] = [];
		const innerIdx: number[] = [];
		const row = A + 1;
		// Jambs connect outer and inner surfaces where an open cell meets a closed one.
		const jambPos: number[] = [];
		const jambIdx: number[] = [];
		const addJamb = (o1: number, o2: number) => {
			const base = jambPos.length / 3;
			for (const idx of [o1, o2]) jambPos.push(outerPos[idx * 3], outerPos[idx * 3 + 1], outerPos[idx * 3 + 2]);
			for (const idx of [o1, o2]) jambPos.push(innerPos[idx * 3], innerPos[idx * 3 + 1], innerPos[idx * 3 + 2]);
			jambIdx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2, base, base + 2, base + 1, base + 1, base + 2, base + 3);
		};
		for (let k = 0; k < K; k++) {
			for (let a = 0; a < A; a++) {
				const i0 = k * row + a;
				const i1 = i0 + 1;
				const i2 = i0 + row;
				const i3 = i2 + 1;
				if (isOpen(a, k)) {
					if (!isOpen((a + A - 1) % A, k)) addJamb(i0, i2);
					if (!isOpen((a + 1) % A, k)) addJamb(i1, i3);
					if (k + 1 < K && !isOpen(a, k + 1)) addJamb(i2, i3);
					continue;
				}
				outerIdx.push(i0, i2, i1, i1, i2, i3);
				innerIdx.push(i0, i1, i2, i1, i3, i2);
			}
		}
		// Close the top hole rim and the bottom edge.
		for (let a = 0; a < A; a++) {
			addJamb(K * row + a, K * row + a + 1);
			if (!isOpen(a, 0)) addJamb(a, a + 1);
		}
		const outer = new THREE.BufferGeometry();
		outer.setAttribute('position', new THREE.Float32BufferAttribute(outerPos, 3));
		outer.setAttribute('color', new THREE.Float32BufferAttribute(outerCol, 3));
		outer.setIndex(outerIdx);
		outer.computeVertexNormals();
		// Jambs are appended to the outer shell so they render with the straw colour.
		const jamb = new THREE.BufferGeometry();
		jamb.setAttribute('position', new THREE.Float32BufferAttribute(jambPos, 3));
		jamb.setAttribute('color', new THREE.Float32BufferAttribute(new Array(jambPos.length).fill(0).map((_, i) => [0.62, 0.4, 0.15][i % 3]), 3));
		jamb.setIndex(jambIdx);
		jamb.computeVertexNormals();
		const outerAll = merge([prepKeepColor(outer), prepKeepColor(jamb)]);
		const inner = new THREE.BufferGeometry();
		inner.setAttribute('position', new THREE.Float32BufferAttribute(innerPos, 3));
		inner.setAttribute('uv', new THREE.Float32BufferAttribute(innerUv, 2));
		inner.setIndex(innerIdx);
		inner.computeVertexNormals();
		return { outer: outerAll, inner };
	}

	setLightLevel(level: number): void {
		for (const l of this.lights) l.intensity = level * 140;
	}

	dispose(): void {
		for (const d of this.disposables) d.dispose();
		this.group.traverse((o) => {
			if (o instanceof THREE.Mesh) o.geometry.dispose();
		});
	}
}

function prepKeepColor(g: THREE.BufferGeometry): THREE.BufferGeometry {
	g.setAttribute('aTint', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
	return g;
}

function topHeight(): number {
	let h = HIVE.domeHeight;
	while (h > 0 && hiveDomeRadius(h) <= HIVE.topHoleRadius + 0.001) h -= 0.05;
	return h;
}

/** Extruded annulus (optionally with an extra round hole) with honeycomb UVs from world xz. */
function floorGeometry(inner: number, outer: number, thickness: number, hole?: { x: number; z: number; r: number }): THREE.BufferGeometry {
	const shape = new THREE.Shape();
	shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
	if (inner > 0) {
		const p = new THREE.Path();
		p.absarc(0, 0, inner, 0, Math.PI * 2, true);
		shape.holes.push(p);
	}
	if (hole) {
		const p = new THREE.Path();
		// Shape lives in the XY plane and is rotated so +Y maps to -Z.
		p.absarc(hole.x, -hole.z, hole.r, 0, Math.PI * 2, true);
		shape.holes.push(p);
	}
	const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 48 });
	g.rotateX(-Math.PI / 2);
	g.translate(0, -thickness, 0);
	// Planar UVs so the honeycomb texture tiles evenly.
	const pos = g.attributes.position;
	const uv = new Float32Array(pos.count * 2);
	for (let i = 0; i < pos.count; i++) {
		uv[i * 2] = pos.getX(i);
		uv[i * 2 + 1] = pos.getZ(i);
	}
	g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	return g;
}
