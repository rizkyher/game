import * as THREE from 'three';
import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { GameContext } from '../core/context';
import { GROUPS } from '../physics/PhysicsWorld';
import { propDefs, type PropDef, type PropKind } from './PropDefs';
import { HIVE, landmark } from '../world/Biomes';
import { Random } from '../utils/Random';

export interface PropSpawn {
	kind: PropKind;
	pos: THREE.Vector3;
	yaw?: number;
	pinned?: boolean;
	asleep?: boolean;
	color?: number;
	/** Balloon string anchor (another prop index). */
	anchor?: number;
}

export class Prop {
	readonly pos = new THREE.Vector3();
	readonly quat = new THREE.Quaternion();
	readonly prevPos = new THREE.Vector3();
	readonly prevQuat = new THREE.Quaternion();
	readonly homePos = new THREE.Vector3();
	readonly homeQuat = new THREE.Quaternion();
	readonly linvel = new THREE.Vector3();
	body: RigidBody | null = null;
	pinned: boolean;
	broken = false;
	held = false;
	respawnAt = 0;
	lastTouch = -100;
	chain = 0;
	chainRoot: Prop | null = null;
	tipped = false;
	toppled = false;
	asleep: boolean;
	anchor: Prop | null = null;
	rope: THREE.Line | null = null;
	restoreGroupsAt = 0;
	/** Instance slot per part mesh. */
	slot = 0;

	constructor(
		readonly id: number,
		readonly kind: PropKind,
		readonly def: PropDef,
		spawn: PropSpawn
	) {
		this.pos.copy(spawn.pos);
		this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spawn.yaw ?? 0);
		this.prevPos.copy(this.pos);
		this.prevQuat.copy(this.quat);
		this.homePos.copy(this.pos);
		this.homeQuat.copy(this.quat);
		this.pinned = !!spawn.pinned;
		this.asleep = !!spawn.asleep;
	}

	get active(): boolean {
		return this.body !== null;
	}
}

const ACTIVE_RADIUS = 150;
const DEACTIVATE_RADIUS = 175;
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _zero = new THREE.Vector3(0, 0, 0);

/**
 * All dynamic props. Rendering is instanced per kind; physics bodies exist only for props
 * near the player (distance activation) and sleep when idle.
 */
export class Props {
	readonly list: Prop[] = [];
	private meshes = new Map<PropKind, THREE.InstancedMesh[]>();
	private byHandle = new Map<number, Prop>();
	private activationTimer = 0;
	private ropeMat = new THREE.LineBasicMaterial({ color: 0xffffff });
	private tmpRot = { x: 0, y: 0, z: 0, w: 1 };
	cupsTipped = new Set<number>();
	private dirtyKinds = new Set<PropKind>();

	constructor(private ctx: GameContext) {
		const spawns = this.buildSpawns();
		const defs = propDefs();
		const counts = new Map<PropKind, number>();
		for (const s of spawns) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
		for (const [kind, n] of counts) {
			const def = defs[kind];
			const parts = def.parts.map((p) => {
				const mesh = new THREE.InstancedMesh(p.geo, p.mat, n);
				mesh.castShadow = kind !== 'balloon';
				mesh.receiveShadow = true;
				mesh.frustumCulled = false;
				mesh.count = n;
				ctx.scene.add(mesh);
				return mesh;
			});
			this.meshes.set(kind, parts);
		}
		const slots = new Map<PropKind, number>();
		spawns.forEach((s, i) => {
			const def = defs[s.kind];
			const p = new Prop(i, s.kind, def, s);
			p.slot = slots.get(s.kind) ?? 0;
			slots.set(s.kind, p.slot + 1);
			if (s.color !== undefined) for (const m of this.meshes.get(s.kind)!) m.setColorAt(p.slot, new THREE.Color(s.color));
			this.list.push(p);
		});
		spawns.forEach((s, i) => {
			if (s.anchor !== undefined) {
				const p = this.list[i];
				p.anchor = this.list[s.anchor];
				const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
				p.rope = new THREE.Line(g, this.ropeMat);
				p.rope.frustumCulled = false;
				ctx.scene.add(p.rope);
			}
		});
		for (const meshes of this.meshes.values()) for (const m of meshes) if (m.instanceColor) m.instanceColor.needsUpdate = true;
		for (const p of this.list) this.writeMatrix(p, p.pos, p.quat);
		this.markAllDirty();
	}

	private buildSpawns(): PropSpawn[] {
		const ctx = this.ctx;
		const t = ctx.world.terrain;
		const f = ctx.world.features.info;
		const hive = ctx.world.hive.info;
		const out: PropSpawn[] = [];
		const rng = new Random(8080);
		const add = (s: PropSpawn) => {
			out.push(s);
			return out.length - 1;
		};
		const pic = landmark('picnic');
		const py = f.picnicY;
		const P = (x: number, y: number, z: number) => new THREE.Vector3(pic.x + x, py + y, pic.z + z);
		const basket = add({ kind: 'basket', pos: P(8, 2.55, -7), yaw: 0.3 });
		add({ kind: 'balloon', pos: P(6, 15, -8), color: 0xff4d6d, anchor: basket });
		add({ kind: 'balloon', pos: P(10, 17, -6), color: 0x4dabf7, anchor: basket });
		for (const [x, z] of [
			[-4, 6],
			[3, 10],
			[17, -2],
			[-17, 3]
		])
			add({ kind: 'cup', pos: P(x, 2.05, z), yaw: rng.range(0, 6) });
		// Upside-down cup pyramid right under the cherry branch.
		this.flipStart = out.length;
		this.flipCount = 6;
		for (const x of [-16, -12.7, -9.4]) add({ kind: 'cup', pos: P(x, 2.05, -9), asleep: true });
		for (const x of [-14.35, -11.05]) add({ kind: 'cup', pos: P(x, 6.1, -9), asleep: true });
		add({ kind: 'cup', pos: P(-12.7, 10.15, -9), asleep: true });
		for (const [x, z] of [
			[-1, -8],
			[16, -11],
			[-16, 10]
		])
			add({ kind: 'plate', pos: P(x, 0.2, z) });
		// Domino arc.
		for (let i = 0; i < 16; i++) {
			const a = -2.2 + i * 0.17;
			const x = 2 + Math.cos(a) * 10;
			const z = 10 + Math.sin(a) * 10;
			add({ kind: 'domino', pos: P(x, 1.75, z), yaw: -a, asleep: true });
		}
		for (let i = 0; i < 5; i++) add({ kind: 'sugar', pos: P(16, 0.72 + i * 1.42, 9), yaw: i * 0.2, asleep: true });
		add({ kind: 'jar', pos: P(-5, 1.55, -3) });
		add({ kind: 'apple', pos: P(6, 1.5, 13) });
		add({ kind: 'apple', pos: P(-12, 1.5, 12) });
		add({ kind: 'beachball', pos: new THREE.Vector3(pic.x + 30, t.heightAt(pic.x + 30, pic.z + 18) + 3.1, pic.z + 18) });
		for (const cp of f.cherryPoints) add({ kind: 'cherry', pos: cp.clone(), pinned: true });

		// Garden.
		const gar = landmark('garden');
		for (const s of f.gardenShelf) add({ kind: 'pot', pos: s.clone().setY(s.y + 1.55), asleep: true });
		const G = (x: number, z: number, lift: number) => new THREE.Vector3(gar.x + x, t.heightAt(gar.x + x, gar.z + z) + lift, gar.z + z);
		add({ kind: 'wateringcan', pos: G(-12, 6, 1.75), yaw: 0.8 });
		add({ kind: 'trowel', pos: G(13, 8, 0.4), yaw: 1.2 });
		add({ kind: 'gnome', pos: G(-16, -3, 4.1), yaw: 0.4, asleep: true });
		add({ kind: 'beachball', pos: G(20, 20, 3.1) });

		// Pond floaters.
		const pond = t.pond;
		add({ kind: 'duck', pos: new THREE.Vector3(pond.x + 10, t.pondLevel + 0.6, pond.z - 8) });
		add({ kind: 'duck', pos: new THREE.Vector3(pond.x - 14, t.pondLevel + 0.6, pond.z + 6), yaw: 2 });
		add({ kind: 'boat', pos: new THREE.Vector3(pond.x + 2, t.pondLevel + 0.7, pond.z + 18), yaw: 1 });

		// Forest litter.
		const forestSpots = [landmark('hollowTree'), landmark('fairyRing'), landmark('elderTree'), landmark('birdNest'), landmark('spiderGrove'), landmark('hollowLog')];
		for (const spot of forestSpots) {
			for (let i = 0; i < 4; i++) {
				const a = rng.range(0, Math.PI * 2);
				const d = rng.range(spot.r * 0.6, spot.r + 12);
				const x = spot.x + Math.cos(a) * d;
				const z = spot.z + Math.sin(a) * d;
				const kind: PropKind = rng.pick(['acorn', 'pinecone', 'twig', 'puffball', 'acorn'] as const);
				const lift = kind === 'twig' ? 0.3 : kind === 'puffball' ? 1.3 : 0.9;
				add({ kind, pos: new THREE.Vector3(x, t.heightAt(x, z) + lift, z), yaw: rng.range(0, 6), asleep: true });
			}
		}
		for (let i = 0; i < 8; i++) {
			const s = t.stream[Math.floor(rng.range(0.1, 0.85) * t.stream.length)];
			const side = rng.sign() * rng.range(8, 12);
			const x = s.x - s.dz * side;
			const z = s.z + s.dx * side;
			add({ kind: 'pebble', pos: new THREE.Vector3(x, t.heightAt(x, z) + 0.9, z), asleep: true });
		}
		for (const bp of f.berryPoints) add({ kind: 'berry', pos: bp.clone(), pinned: true });

		// Hive interior.
		const ws = hive.waxStack;
		for (let layer = 0; layer < 3; layer++) {
			for (let i = 0; i < 3 - layer; i++) add({ kind: 'waxblock', pos: new THREE.Vector3(ws.x + (i - (2 - layer) / 2) * 2.05, ws.y + 1 + layer * 2.02, ws.z), asleep: true });
		}
		for (const s of hive.shelves) add({ kind: 'honeyjar', pos: s.clone().setY(s.y + 1.55), asleep: true });
		for (const h of hive.ceilingHooks) add({ kind: 'honeyglob', pos: h.clone().setY(h.y - 1.6), pinned: true });
		add({ kind: 'honeyjar', pos: new THREE.Vector3(HIVE.x + 9, HIVE.baseY + 1.55, HIVE.z + 4) });
		add({ kind: 'honeyjar', pos: new THREE.Vector3(HIVE.x - 8, HIVE.baseY + 1.55, HIVE.z - 6) });
		// Rests on the rim of the hole at the dome's apex (a secret exit once knocked away).
		add({ kind: 'waxplug', pos: hive.apex.clone().setY(hive.apex.y + 0.3), asleep: true });
		return out;
	}

	private flipStart = 0;
	private flipCount = 0;

	/** The cup pyramid cups start upside down. */
	private initialRotation(p: Prop): void {
		if (p.kind === 'cup' && p.id >= this.flipStart && p.id < this.flipStart + this.flipCount) {
			p.quat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
			p.homeQuat.copy(p.quat);
			p.prevQuat.copy(p.quat);
		}
	}

	init(): void {
		for (const p of this.list) {
			this.initialRotation(p);
			this.writeMatrix(p, p.pos, p.quat);
		}
		this.markAllDirty();
		this.updateActivation();
	}

	private markAllDirty(): void {
		for (const meshes of this.meshes.values()) for (const m of meshes) m.instanceMatrix.needsUpdate = true;
	}

	private createBody(p: Prop): void {
		const { R, world } = this.ctx.physics;
		const def = p.def;
		const desc = R.RigidBodyDesc.dynamic()
			.setTranslation(p.pos.x, p.pos.y, p.pos.z)
			.setRotation({ x: p.quat.x, y: p.quat.y, z: p.quat.z, w: p.quat.w })
			.setLinearDamping(def.linDamp)
			.setAngularDamping(def.angDamp)
			.setGravityScale(p.pinned ? 0 : def.gravity)
			.setCanSleep(true)
			.setCcdEnabled(def.mass < 1.5);
		if (p.asleep && !p.pinned) desc.setSleeping(true);
		const body = world.createRigidBody(desc);
		const s = def.shape;
		let cd;
		switch (s.type) {
			case 'ball':
				cd = R.ColliderDesc.ball(s.r);
				break;
			case 'cuboid':
				cd = R.ColliderDesc.cuboid(s.hx, s.hy, s.hz);
				break;
			case 'cylinder':
				cd = R.ColliderDesc.cylinder(s.hh, s.r);
				break;
			case 'capsule': {
				cd = R.ColliderDesc.capsule(s.hh, s.r);
				if (s.axis === 'x') {
					_q.setFromAxisAngle(_v.set(0, 0, 1), Math.PI / 2);
					cd.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
				}
				break;
			}
		}
		if (s.y) cd.setTranslation(0, s.y, 0);
		cd.setMass(def.mass)
			.setRestitution(def.restitution)
			.setFriction(def.friction)
			.setCollisionGroups(GROUPS.prop)
			.setSolverGroups(GROUPS.prop)
			.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS | R.ActiveEvents.CONTACT_FORCE_EVENTS)
			.setContactForceEventThreshold(Math.max(40, def.mass * 160));
		const col = world.createCollider(cd, body);
		this.ctx.physics.tag(col, { kind: 'prop', ref: p });
		this.byHandle.set(col.handle, p);
		if (p.pinned) {
			body.lockTranslations(true, false);
			body.lockRotations(true, false);
		}
		p.body = body;
	}

	private removeBody(p: Prop): void {
		if (!p.body) return;
		for (let i = 0; i < p.body.numColliders(); i++) this.byHandle.delete(p.body.collider(i).handle);
		this.ctx.physics.removeBody(p.body);
		p.body = null;
	}

	fromHandle(handle: number): Prop | undefined {
		return this.byHandle.get(handle);
	}

	private updateActivation(): void {
		const pl = this.ctx.player.position;
		for (const p of this.list) {
			if (p.broken) continue;
			const d = p.pos.distanceTo(pl);
			if (!p.body && d < ACTIVE_RADIUS) this.createBody(p);
			else if (p.body && !p.held && d > DEACTIVATE_RADIUS) {
				// Fell out of the world? Send it home.
				if (p.pos.y < this.ctx.world.terrain.heightAt(p.pos.x, p.pos.z) - 20) this.sendHome(p);
				this.removeBody(p);
			}
		}
	}

	private sendHome(p: Prop): void {
		p.pos.copy(p.homePos);
		p.quat.copy(p.homeQuat);
		p.prevPos.copy(p.pos);
		p.prevQuat.copy(p.quat);
		p.tipped = false;
		p.toppled = false;
		this.writeMatrix(p, p.pos, p.quat);
	}

	/** Called before each fixed physics step. */
	fixedUpdate(dt: number): void {
		const ctx = this.ctx;
		const terrain = ctx.world.terrain;
		for (const p of this.list) {
			const b = p.body;
			if (!b) continue;
			p.prevPos.copy(p.pos);
			p.prevQuat.copy(p.quat);
			if (p.held) continue;
			if (p.restoreGroupsAt && ctx.time > p.restoreGroupsAt) {
				p.restoreGroupsAt = 0;
				b.collider(0).setCollisionGroups(GROUPS.prop);
				b.collider(0).setSolverGroups(GROUPS.prop);
			}
			// Buoyancy for floaty things (and a splashy bob for everything else in water).
			if (!b.isSleeping()) {
				const level = terrain.waterLevelAt(p.pos.x, p.pos.z);
				if (level > -Infinity && p.pos.y < level + 0.3) {
					const depth = Math.min(2, level + 0.3 - p.pos.y);
					const lift = p.def.floats ? 34 : 12;
					const v = b.linvel();
					b.applyImpulse({ x: -v.x * 0.02 * p.def.mass, y: (lift * depth - v.y * 2) * p.def.mass * dt, z: -v.z * 0.02 * p.def.mass }, true);
				}
				// Balloon string: soft tether toward the anchor.
				if (p.anchor && !p.anchor.broken) {
					const a = p.anchor.pos;
					_v.set(p.pos.x - a.x, p.pos.y - a.y, p.pos.z - a.z);
					const len = _v.length();
					const rest = 13;
					if (len > rest) {
						_v.multiplyScalar(((rest - len) / len) * 3 * p.def.mass);
						b.applyImpulse({ x: _v.x, y: _v.y, z: _v.z }, true);
					}
				}
			}
		}
	}

	/** Called after each fixed physics step: copies body transforms and runs tip/topple checks. */
	postStep(): void {
		const ctx = this.ctx;
		for (const p of this.list) {
			const b = p.body;
			if (!b || p.held) continue;
			if (b.isSleeping()) continue;
			const t = b.translation();
			const r = b.rotation();
			p.pos.set(t.x, t.y, t.z);
			p.quat.set(r.x, r.y, r.z, r.w);
			const lv = b.linvel();
			p.linvel.set(lv.x, lv.y, lv.z);
			// Knocked over?
			_v.set(0, 1, 0).applyQuaternion(p.quat);
			const upright = p.kind === 'cup' && p.id >= this.flipStart && p.id < this.flipStart + this.flipCount ? -_v.y : _v.y;
			if (!p.tipped && upright < 0.45 && ctx.time - p.lastTouch < 8) {
				p.tipped = true;
				if (p.def.tipTrick) ctx.chaos.add(p.def.tipTrick, p.pos);
				if (p.kind === 'cup') {
					this.cupsTipped.add(p.id);
					const total = this.list.filter((q) => q.kind === 'cup').length;
					if (this.cupsTipped.size >= total) ctx.achievements.unlock('picnic_wrecker');
				}
			}
			if (!p.toppled && p.homePos.y - p.pos.y > 2.5 && p.asleep && ctx.time - p.lastTouch < 10) {
				p.toppled = true;
				if (p.kind !== 'domino') ctx.chaos.add('topple', p.pos, 0.6);
			}
		}
	}

	update(dt: number, alpha: number): void {
		this.activationTimer -= dt;
		if (this.activationTimer <= 0) {
			this.activationTimer = 0.5;
			this.updateActivation();
			this.respawnBroken();
		}
		const dirty = this.dirtyKinds;
		dirty.clear();
		for (const p of this.list) {
			if (p.broken) continue;
			if (!p.body) continue;
			if (!p.held && p.body.isSleeping() && p.prevPos.equals(p.pos)) continue;
			_v.lerpVectors(p.prevPos, p.pos, alpha);
			_q.slerpQuaternions(p.prevQuat, p.quat, alpha);
			this.writeMatrix(p, _v, _q);
			dirty.add(p.kind);
			if (p.body.isSleeping()) p.prevPos.copy(p.pos);
		}
		for (const k of dirty) for (const m of this.meshes.get(k)!) m.instanceMatrix.needsUpdate = true;
		for (const p of this.list) {
			if (!p.rope) continue;
			const visible = !p.broken && !!p.anchor && !p.anchor.broken;
			p.rope.visible = visible;
			if (!visible) continue;
			const arr = p.rope.geometry.attributes.position as THREE.BufferAttribute;
			arr.setXYZ(0, p.pos.x, p.pos.y - 2.6, p.pos.z);
			arr.setXYZ(1, p.anchor!.pos.x, p.anchor!.pos.y + 2.5, p.anchor!.pos.z);
			arr.needsUpdate = true;
		}
	}

	private writeMatrix(p: Prop, pos: THREE.Vector3, quat: THREE.Quaternion): void {
		const meshes = this.meshes.get(p.kind)!;
		if (p.broken) _m.compose(pos, quat, _zero);
		else _m.compose(pos, quat, _s);
		for (const m of meshes) m.setMatrixAt(p.slot, _m);
	}

	/** Nearest pickup-able prop to a point. */
	nearestPickup(pos: THREE.Vector3, radius: number): Prop | null {
		let best: Prop | null = null;
		let bd = radius;
		for (const p of this.list) {
			if (p.broken || !p.def.pickup || p.held || !p.body) continue;
			const d = p.pos.distanceTo(pos) - (p.def.shape.type === 'ball' ? p.def.shape.r : 1);
			if (d < bd) {
				bd = d;
				best = p;
			}
		}
		return best;
	}

	/** Props within radius (active only). */
	query(pos: THREE.Vector3, radius: number, out: Prop[]): Prop[] {
		out.length = 0;
		for (const p of this.list) {
			if (p.broken || !p.body || p.held) continue;
			if (p.pos.distanceToSquared(pos) < radius * radius) out.push(p);
		}
		return out;
	}

	unpin(p: Prop): void {
		if (!p.pinned || !p.body) return;
		p.pinned = false;
		p.body.lockTranslations(false, true);
		p.body.lockRotations(false, true);
		p.body.setGravityScale(p.def.gravity, true);
		this.ctx.chaos.add('fruit_drop', p.pos);
	}

	wake(p: Prop): void {
		p.asleep = p.asleep && !!p.body?.isSleeping();
		p.body?.wakeUp();
	}

	impulse(p: Prop, x: number, y: number, z: number, spin = 0): void {
		const b = p.body;
		if (!b) return;
		if (p.pinned) this.unpin(p);
		b.applyImpulse({ x, y, z }, true);
		if (spin > 0) b.applyTorqueImpulse({ x: (Math.random() - 0.5) * spin, y: (Math.random() - 0.5) * spin, z: (Math.random() - 0.5) * spin }, true);
	}

	pickUp(p: Prop): void {
		const b = p.body;
		if (!b) return;
		if (p.pinned) this.unpin(p);
		p.held = true;
		b.setBodyType(this.ctx.physics.R.RigidBodyType.KinematicPositionBased, true);
		b.collider(0).setCollisionGroups(GROUPS.held);
		b.collider(0).setSolverGroups(GROUPS.held);
	}

	/** Move a held prop (kinematic) each fixed step. */
	carry(p: Prop, target: THREE.Vector3, yaw: number): void {
		const b = p.body;
		if (!b) return;
		p.prevPos.copy(p.pos);
		p.prevQuat.copy(p.quat);
		p.pos.lerp(target, 0.5);
		_q.setFromAxisAngle(_v.set(0, 1, 0), yaw);
		p.quat.slerp(_q, 0.2);
		b.setNextKinematicTranslation({ x: p.pos.x, y: p.pos.y, z: p.pos.z });
		this.tmpRot.x = p.quat.x;
		this.tmpRot.y = p.quat.y;
		this.tmpRot.z = p.quat.z;
		this.tmpRot.w = p.quat.w;
		b.setNextKinematicRotation(this.tmpRot);
	}

	release(p: Prop, vel: THREE.Vector3): void {
		const b = p.body;
		p.held = false;
		if (!b) return;
		b.setBodyType(this.ctx.physics.R.RigidBodyType.Dynamic, true);
		b.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
		b.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 6 }, true);
		p.restoreGroupsAt = this.ctx.time + 0.35;
		p.lastTouch = this.ctx.time;
		p.asleep = false;
	}

	breakProp(p: Prop): void {
		if (p.broken) return;
		const ctx = this.ctx;
		const spec = p.def.breakable;
		p.broken = true;
		p.held = false;
		p.respawnAt = ctx.time + 45;
		this.removeBody(p);
		this.writeMatrix(p, p.pos, p.quat);
		for (const m of this.meshes.get(p.kind)!) m.instanceMatrix.needsUpdate = true;
		if (!spec) return;
		const pos = p.pos;
		switch (spec.effect) {
			case 'shatter':
				ctx.effects.shatter(pos, spec.color, 12, 8);
				ctx.effects.shatter(pos, 0xdff6ff, 10, 9, 0.8);
				ctx.audio.play('shatter');
				ctx.chaos.add('smash', pos);
				ctx.env.addHoneyPuddle(pos, 3.5, 25);
				break;
			case 'honey':
				ctx.effects.emit('honey', pos, 30, 0.8);
				ctx.effects.shatter(pos, 0xdff6ff, 10, 8, 0.8);
				ctx.audio.play('shatter', { pitch: 0.8 });
				ctx.audio.play('squelch');
				ctx.chaos.add('smash', pos);
				ctx.env.addHoneyPuddle(pos, 4.5, 40);
				break;
			case 'crunch':
				ctx.effects.shatter(pos, spec.color, 18, 9, 1.2);
				ctx.effects.emit('dust', pos, 16, 1);
				ctx.audio.play('crunch');
				ctx.chaos.add('smash', pos, 1.2);
				break;
			case 'pop':
				ctx.effects.emit('confetti', pos, 40, 1);
				ctx.audio.play('pop');
				ctx.chaos.add('balloon_pop', pos);
				ctx.achievements.unlock('balloon_popper');
				break;
			case 'spores':
				ctx.effects.emit('spores', pos, 34, 1.4);
				ctx.audio.play('pop', { pitch: 0.5, volume: 0.6 });
				ctx.chaos.add('smash', pos, 0.6);
				break;
		}
	}

	private respawnBroken(): void {
		const ctx = this.ctx;
		for (const p of this.list) {
			if (!p.broken || ctx.time < p.respawnAt) continue;
			if (p.homePos.distanceTo(ctx.player.position) < 60) continue;
			p.broken = false;
			p.pinned = p.kind === 'cherry' || p.kind === 'berry' || p.kind === 'honeyglob';
			this.sendHome(p);
		}
		this.markAllDirty();
	}

	dispose(): void {
		for (const p of this.list) {
			this.removeBody(p);
			p.rope?.geometry.dispose();
		}
		for (const meshes of this.meshes.values()) for (const m of meshes) m.dispose();
		this.ropeMat.dispose();
	}
}
