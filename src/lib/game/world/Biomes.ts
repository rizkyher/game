/**
 * Static world layout: seed, landmark coordinates, region rules and the hive's dimensions.
 * Everything here is deterministic so the world is the same on every run.
 */
export const WORLD_SEED = 20251;
export const WORLD_SIZE = 1000;
export const WORLD_HALF = WORLD_SIZE / 2;
/** Terrain grid quads per side (vertices = GRID + 1). */
export const GRID = 512;
export const CELL = WORLD_SIZE / GRID;
export const SKY_CEILING = 230;

export type RegionId = 'meadow' | 'forest' | 'hive' | 'peaks';

export const REGION_NAMES: Record<RegionId, string> = {
	meadow: 'Flower Meadow',
	forest: 'Enchanted Forest',
	hive: 'The Beehive',
	peaks: 'Misty Peaks'
};

export interface Point2 {
	x: number;
	z: number;
}

export const SPAWN: Point2 = { x: 30, z: 120 };

export const HIVE = {
	x: 175,
	z: -20,
	/** Filled in by the terrain generator once the hill under the hive is flattened. */
	groundY: 0,
	stumpHeight: 14,
	stumpRadius: 37,
	domeRadius: 31,
	domeHeight: 62,
	wall: 1.8,
	/** Entrance faces the spawn meadow. */
	entranceAngle: Math.atan2(SPAWN.z - -20, SPAWN.x - 175),
	entranceHalfAngle: 0.2,
	entranceHeight: 10,
	topHoleRadius: 3.6,
	levels: [16, 30, 42, 52] as const,
	get baseY(): number {
		return this.groundY + this.stumpHeight;
	}
};

/** Outer radius of the skep dome at height h above the stump top. */
export function hiveDomeRadius(h: number): number {
	const t = Math.min(1, Math.max(0, h / HIVE.domeHeight));
	const r = HIVE.domeRadius * Math.pow(1 - Math.pow(t, 2.4), 0.5);
	return Math.max(HIVE.topHoleRadius, r);
}

export interface Landmark {
	id: string;
	name: string;
	x: number;
	z: number;
	r: number;
	region: RegionId;
	icon: string;
	secret?: boolean;
}

export const LANDMARKS: Landmark[] = [
	{ id: 'picnic', name: 'Picnic Grounds', x: -95, z: 95, r: 45, region: 'meadow', icon: '🧺' },
	{ id: 'garden', name: "Gardener's Corner", x: 90, z: 235, r: 40, region: 'meadow', icon: '🪴' },
	{ id: 'pond', name: 'Lily Pond', x: -180, z: 215, r: 60, region: 'meadow', icon: '💧' },
	{ id: 'sunflowers', name: 'Sunflower Grove', x: 250, z: 160, r: 60, region: 'meadow', icon: '🌻' },
	{ id: 'lavender', name: 'Lavender Fields', x: -280, z: 40, r: 65, region: 'meadow', icon: '💜' },
	{ id: 'roses', name: 'Rose Garden', x: 200, z: 300, r: 45, region: 'meadow', icon: '🌹' },
	{ id: 'waterfall', name: 'Whispering Falls', x: -206, z: -160, r: 35, region: 'forest', icon: '🌊' },
	{ id: 'hollowTree', name: 'Hollow Oak', x: -40, z: -270, r: 25, region: 'forest', icon: '🌳', secret: true },
	{ id: 'fairyRing', name: 'Fairy Ring', x: 95, z: -225, r: 30, region: 'forest', icon: '🍄' },
	{ id: 'spiderGrove', name: 'Spider Grove', x: -150, z: -350, r: 50, region: 'forest', icon: '🕸️' },
	{ id: 'hollowLog', name: 'Mossy Log Tunnel', x: 190, z: -300, r: 35, region: 'forest', icon: '🪵', secret: true },
	{ id: 'elderTree', name: 'The Elder Tree', x: 10, z: -385, r: 40, region: 'forest', icon: '🌲' },
	{ id: 'birdNest', name: "Robin's Perch", x: 40, z: -200, r: 25, region: 'forest', icon: '🐦' },
	{ id: 'summit', name: 'Misty Summit', x: 400, z: -400, r: 45, region: 'peaks', icon: '⛰️', secret: true }
];

export function landmark(id: string): Landmark {
	const l = LANDMARKS.find((l) => l.id === id);
	if (!l) throw new Error(`Unknown landmark ${id}`);
	return l;
}

/** Hive chambers by height band (y above the stump top). */
export const HIVE_CHAMBERS = [
	{ id: 'hall', name: 'Grand Entrance Hall', min: -2, max: HIVE.levels[0] },
	{ id: 'nursery', name: 'Royal Nursery', min: HIVE.levels[0], max: HIVE.levels[1] },
	{ id: 'workshop', name: 'Wax Workshop', min: HIVE.levels[1], max: HIVE.levels[2] },
	{ id: 'queen', name: "Queen's Chamber", min: HIVE.levels[2], max: HIVE.levels[3] },
	{ id: 'attic', name: 'Secret Royal Attic', min: HIVE.levels[3], max: HIVE.domeHeight + 2 }
] as const;

/** z coordinate of the ridge cliff separating the lowland meadow from the forest plateau. */
export function ridgeZ(x: number): number {
	return -150 + 22 * Math.sin(x * 0.009 + 1) + 8 * Math.sin(x * 0.023);
}

/** The stream runs from a forest spring, over the ridge (waterfall) and into the lily pond. */
export const STREAM_PATH: Point2[] = [
	{ x: -300, z: -385 },
	{ x: -272, z: -330 },
	{ x: -240, z: -268 },
	{ x: -218, z: -210 },
	{ x: -208, z: -172 },
	{ x: -205, z: -146 },
	{ x: -196, z: -95 },
	{ x: -212, z: -25 },
	{ x: -203, z: 55 },
	{ x: -190, z: 120 },
	{ x: -182, z: 170 }
];

export function edgeDistance(x: number, z: number): number {
	// Superellipse distance so the world boundary is a rounded square.
	return Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(z), 4), 0.25);
}

export function isInsideHive(x: number, y: number, z: number): boolean {
	const h = y - HIVE.baseY;
	if (h < -1.5 || h > HIVE.domeHeight + 1) return false;
	const dx = x - HIVE.x;
	const dz = z - HIVE.z;
	const r = hiveDomeRadius(h) - HIVE.wall * 0.5;
	return dx * dx + dz * dz < r * r;
}

export function regionAt(x: number, y: number, z: number): RegionId {
	const dx = x - HIVE.x;
	const dz = z - HIVE.z;
	if (dx * dx + dz * dz < 58 * 58 && y < HIVE.baseY + HIVE.domeHeight + 25) return 'hive';
	if (edgeDistance(x, z) > 405) return 'peaks';
	if (z < ridgeZ(x) + 6) return 'forest';
	return 'meadow';
}
