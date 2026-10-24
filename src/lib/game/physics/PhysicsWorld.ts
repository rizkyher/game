import type RAPIER_NS from '@dimforge/rapier3d-compat';
import type { Collider, RigidBody, World, EventQueue } from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export type Rapier = typeof RAPIER_NS;

/** Collision group bits. Membership in the high 16 bits, filter in the low 16 bits. */
export const G = {
	PLAYER: 1 << 0,
	ENEMY: 1 << 1,
	STATIC: 1 << 2,
	BARRIER: 1 << 3,
	QUERY: 1 << 4
} as const;

export function groups(membership: number, filter: number): number {
	return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const GROUPS = {
	player: groups(G.PLAYER, G.STATIC | G.ENEMY | G.BARRIER),
	enemy: groups(G.ENEMY, G.STATIC | G.PLAYER | G.ENEMY | G.BARRIER),
	/** Enemies ignore each other in the character controller (separation steering handles crowding). */
	enemyMove: groups(G.ENEMY, G.STATIC | G.PLAYER | G.BARRIER),
	static: groups(G.STATIC, G.PLAYER | G.ENEMY | G.QUERY),
	barrier: groups(G.BARRIER, G.PLAYER | G.ENEMY | G.QUERY)
};

export type ColliderKind = 'terrain' | 'static' | 'player' | 'enemy' | 'barrier';

export interface ColliderTag {
	kind: ColliderKind;
	/** Optional owner object (e.g. an Enemy instance). */
	ref?: unknown;
	/** Surface sound flavour. */
	material?: 'wood' | 'stone' | 'plant' | 'soft';
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _d = new THREE.Vector3();

/** Thin wrapper over a Rapier world: fixed timestep, collider tagging and static-collider helpers. */
export class PhysicsWorld {
	readonly world: World;
	readonly events: EventQueue;
	readonly fixedDt = 1 / 60;
	private tags = new Map<number, ColliderTag>();

	private constructor(readonly R: Rapier) {
		this.world = new R.World({ x: 0, y: -30, z: 0 });
		this.world.timestep = this.fixedDt;
		this.events = new R.EventQueue(true);
	}

	static async create(): Promise<PhysicsWorld> {
		const mod = await import('@dimforge/rapier3d-compat');
		const R = (mod.default ?? mod) as Rapier;
		await R.init();
		return new PhysicsWorld(R);
	}

	step(): void {
		this.world.step(this.events);
	}

	tag(collider: Collider, tag: ColliderTag): void {
		this.tags.set(collider.handle, tag);
	}

	untag(collider: Collider): void {
		this.tags.delete(collider.handle);
	}

	getTag(handle: number): ColliderTag | undefined {
		return this.tags.get(handle);
	}

	private finishStatic(desc: RAPIER_NS.ColliderDesc, tag: ColliderTag, restitution = 0.2, friction = 0.8): Collider {
		desc.setCollisionGroups(GROUPS.static).setSolverGroups(GROUPS.static).setRestitution(restitution).setFriction(friction);
		const c = this.world.createCollider(desc);
		this.tag(c, tag);
		return c;
	}

	private rot(desc: RAPIER_NS.ColliderDesc, rx: number, ry: number, rz: number): void {
		if (rx === 0 && ry === 0 && rz === 0) return;
		_q.setFromEuler(_e.set(rx, ry, rz));
		desc.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
	}

	addHeightfield(nrows: number, ncols: number, heights: Float32Array, scale: { x: number; y: number; z: number }): Collider {
		const desc = this.R.ColliderDesc.heightfield(nrows, ncols, heights, scale);
		return this.finishStatic(desc, { kind: 'terrain', material: 'plant' }, 0.1, 0.9);
	}

	addBall(x: number, y: number, z: number, r: number, tag: ColliderTag = { kind: 'static', material: 'stone' }): Collider {
		const desc = this.R.ColliderDesc.ball(r).setTranslation(x, y, z);
		return this.finishStatic(desc, tag);
	}

	addCuboid(
		x: number,
		y: number,
		z: number,
		hx: number,
		hy: number,
		hz: number,
		ry = 0,
		tag: ColliderTag = { kind: 'static', material: 'wood' },
		rx = 0,
		rz = 0
	): Collider {
		const desc = this.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z);
		this.rot(desc, rx, ry, rz);
		return this.finishStatic(desc, tag);
	}

	addCylinder(
		x: number,
		y: number,
		z: number,
		halfHeight: number,
		r: number,
		tag: ColliderTag = { kind: 'static', material: 'wood' },
		rx = 0,
		ry = 0,
		rz = 0,
		restitution = 0.2
	): Collider {
		const desc = this.R.ColliderDesc.cylinder(halfHeight, r).setTranslation(x, y, z);
		this.rot(desc, rx, ry, rz);
		return this.finishStatic(desc, tag, restitution);
	}

	/** Capsule between two points. */
	addCapsuleBetween(a: THREE.Vector3, b: THREE.Vector3, r: number, tag: ColliderTag = { kind: 'static', material: 'wood' }): Collider {
		const mid = a.clone().add(b).multiplyScalar(0.5);
		const dir = b.clone().sub(a);
		const len = dir.length();
		dir.normalize();
		_q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
		const desc = this.R.ColliderDesc.capsule(Math.max(0.01, len / 2), r)
			.setTranslation(mid.x, mid.y, mid.z)
			.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w });
		return this.finishStatic(desc, tag);
	}

	addTrimesh(vertices: Float32Array, indices: Uint32Array, tag: ColliderTag = { kind: 'static', material: 'stone' }): Collider {
		const desc = this.R.ColliderDesc.trimesh(vertices, indices);
		return this.finishStatic(desc, tag, 0.15, 0.6);
	}

	private setRay(origin: THREE.Vector3, dir: THREE.Vector3): RAPIER_NS.Ray {
		const ray = this.ray;
		ray.origin.x = origin.x;
		ray.origin.y = origin.y;
		ray.origin.z = origin.z;
		ray.dir.x = dir.x;
		ray.dir.y = dir.y;
		ray.dir.z = dir.z;
		return ray;
	}

	/**
	 * Ray cast against static world geometry (terrain, architecture, trees), optionally also
	 * magic barriers. Returns hit distance or -1.
	 */
	castStatic(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, barriers = false): number {
		const hit = this.world.castRay(this.setRay(origin, dir), maxDist, true, undefined, groups(G.QUERY, G.STATIC | (barriers ? G.BARRIER : 0)));
		return hit ? hit.timeOfImpact : -1;
	}

	/** Like castStatic but also writes the surface normal. */
	castStaticNormal(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, normal: THREE.Vector3, barriers = true): number {
		const hit = this.world.castRayAndGetNormal(this.setRay(origin, dir), maxDist, true, undefined, groups(G.QUERY, G.STATIC | (barriers ? G.BARRIER : 0)));
		if (!hit) return -1;
		normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
		return hit.timeOfImpact;
	}

	/** True when the segment a→b is unobstructed by static geometry (line of sight). */
	lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
		_d.subVectors(b, a);
		const len = _d.length();
		if (len < 0.01) return true;
		_d.multiplyScalar(1 / len);
		return this.castStatic(a, _d, len - 0.05, true) < 0;
	}

	/** Kinematic capsule body for characters (player, enemies). Position is the capsule centre. */
	createCharacter(x: number, y: number, z: number, radius: number, halfHeight: number, group: number, tag: ColliderTag): { body: RigidBody; collider: Collider } {
		const body = this.world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z));
		const desc = this.R.ColliderDesc.capsule(halfHeight, radius).setCollisionGroups(group).setSolverGroups(group).setFriction(0);
		const collider = this.world.createCollider(desc, body);
		this.tag(collider, tag);
		return { body, collider };
	}

	/** A removable static wall that blocks players and enemies (magic seals, arena barrier). */
	addBarrier(x: number, y: number, z: number, hx: number, hy: number, hz: number, ry = 0): Collider {
		const desc = this.R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setCollisionGroups(GROUPS.barrier).setSolverGroups(GROUPS.barrier);
		this.rot(desc, 0, ry, 0);
		const c = this.world.createCollider(desc);
		this.tag(c, { kind: 'barrier', material: 'stone' });
		return c;
	}

	removeCollider(c: Collider): void {
		this.untag(c);
		this.world.removeCollider(c, false);
	}

	private _ray?: RAPIER_NS.Ray;
	private get ray(): RAPIER_NS.Ray {
		if (!this._ray) this._ray = new this.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
		return this._ray;
	}

	removeBody(body: RigidBody): void {
		for (let i = 0; i < body.numColliders(); i++) this.untag(body.collider(i));
		this.world.removeRigidBody(body);
	}

	dispose(): void {
		this.events.free();
		this.world.free();
	}
}
