import { clamp, distToSegment2D, smoothstep } from '../utils/math';

export const WORLD_SIZE = 720;
export const WORLD_HALF = WORLD_SIZE / 2;
/** Terrain lattice spacing in metres. */
export const CELL = 2;
export const GRID = WORLD_SIZE / CELL;

export interface Point2 {
	x: number;
	z: number;
}

export type RegionId = 'hollow' | 'vale' | 'forest' | 'highlands' | 'sanctuary';

export interface RegionDef {
	id: RegionId;
	name: string;
	subtitle: string;
	/** Fog / atmosphere colours (linear-ish hex, applied through three.js colour management). */
	fog: number;
	fogNear: number;
	fogFar: number;
	hemiSky: number;
	hemiGround: number;
	sunTint: number;
	/** Ambient particle tint. */
	motes: number;
	exposure: number;
}

export const REGIONS: Record<RegionId, RegionDef> = {
	hollow: {
		id: 'hollow',
		name: 'Lumen Hollow',
		subtitle: 'The last lantern-lit village',
		fog: 0xf2c9a4,
		fogNear: 90,
		fogFar: 520,
		hemiSky: 0xbcd4ff,
		hemiGround: 0x6d5a3a,
		sunTint: 0xffd6a0,
		motes: 0xffd27a,
		exposure: 1.0
	},
	vale: {
		id: 'vale',
		name: 'Whispering Vale',
		subtitle: 'Where the old roads meet',
		fog: 0xe9c6b4,
		fogNear: 90,
		fogFar: 520,
		hemiSky: 0xb9ccff,
		hemiGround: 0x5f6a3a,
		sunTint: 0xffd2a0,
		motes: 0xfff0b0,
		exposure: 1.0
	},
	forest: {
		id: 'forest',
		name: 'Enchanted Forest',
		subtitle: 'Eldergrove of the Glowing Root',
		fog: 0x6fa7a0,
		fogNear: 25,
		fogFar: 300,
		hemiSky: 0x9fe0d4,
		hemiGround: 0x2a3f22,
		sunTint: 0xffe2a8,
		motes: 0x9dffb0,
		exposure: 1.05
	},
	highlands: {
		id: 'highlands',
		name: 'Arcane Highlands',
		subtitle: 'Isles of the Shattered Sky',
		fog: 0xc6b2e8,
		fogNear: 80,
		fogFar: 560,
		hemiSky: 0xcab8ff,
		hemiGround: 0x5a4a6a,
		sunTint: 0xffd8c0,
		motes: 0xc9a8ff,
		exposure: 1.0
	},
	sanctuary: {
		id: 'sanctuary',
		name: 'Forgotten Sanctuary',
		subtitle: 'Ruins of the Aether Academy',
		fog: 0x5b4a7e,
		fogNear: 40,
		fogFar: 380,
		hemiSky: 0x9a8ad8,
		hemiGround: 0x2e2440,
		sunTint: 0xffc0a8,
		motes: 0xd0a0ff,
		exposure: 1.02
	}
};

// ------------------------------------------------------------------ key locations

export const HOLLOW = { x: 0, z: 236, r: 34 };
export const SPAWN = { x: 0, z: 256 };
export const ELDER = { x: 8, z: 226 };
export const CROSSROADS = { x: 0, z: 112 };

export const SHRINE = { x: -150, z: 42 };
export const LAKE = { x: -226, z: 196, r: 30 };
export const FALLS = { x: -229, z: 152 };
export const FALLS_CRYSTAL = { x: -206, z: 168 };
export const GROTTO = { x: -292, z: 92 };

export const HL_RAMP_A = { x: 42, z: 158 };
export const HL_RAMP_B = { x: 104, z: 112 };
export const RING = { x: 196, z: 138, r: 22 };
export const SPIRE = { x: 206, z: -34 };
export const ISLES = { x: 132, z: -78 };

export const GATE = { x: 0, z: -136, halfWidth: 13 };
export const COURTYARD = { x: 0, z: -190 };
export const TEMPLE = { x: -78, z: -206 };
export const LIBRARY = { x: 74, z: -198 };
/** Crypt (Undercroft) footprint: a roofed sunken corridor leading from the terrace into the arena. */
export const CRYPT = { x: 0, z0: -224, z1: -268, halfWidth: 7, stairEnd: -246 };
export const ARENA = { x: 0, z: -300, r: 31 };

export interface WaystoneDef {
	id: string;
	name: string;
	x: number;
	z: number;
}

/** Checkpoints: activating one saves the game and becomes the respawn point. */
export const WAYSTONES: WaystoneDef[] = [
	{ id: 'hollow', name: 'Lumen Hollow', x: -9, z: 210 },
	{ id: 'crossroads', name: 'Crossroads Watch', x: -9, z: 104 },
	{ id: 'forest', name: 'Eldergrove', x: -112, z: 100 },
	{ id: 'falls', name: 'Moonwell Falls', x: -188, z: 192 },
	{ id: 'highlands', name: 'Highland Rise', x: 126, z: 94 },
	{ id: 'spire', name: 'Starfall Approach', x: 178, z: -10 },
	{ id: 'gate', name: 'The Seal Gate', x: 10, z: -104 },
	{ id: 'sanctuary', name: 'Academy Courtyard', x: 16, z: -170 }
];

export const HEIGHTS = {
	hollow: 4,
	crossroads: 6,
	plateau: 30,
	terrace: 22,
	arenaFloor: 11
};

export type LandmarkIcon = 'village' | 'waystone' | 'shrine' | 'lake' | 'cave' | 'tower' | 'arena' | 'isles' | 'gate' | 'ruins' | 'temple' | 'boss' | 'crossroads';

export interface Landmark {
	id: string;
	name: string;
	icon: LandmarkIcon;
	x: number;
	z: number;
	r: number;
}

export const LANDMARKS: Landmark[] = [
	{ id: 'hollow', name: 'Lumen Hollow', icon: 'village', x: HOLLOW.x, z: HOLLOW.z, r: 40 },
	{ id: 'crossroads', name: 'Crossroads Watch', icon: 'crossroads', x: CROSSROADS.x + 18, z: CROSSROADS.z - 12, r: 26 },
	{ id: 'shrine', name: 'Shrine of Verdance', icon: 'shrine', x: SHRINE.x, z: SHRINE.z, r: 24 },
	{ id: 'lake', name: 'Moonwell Falls', icon: 'lake', x: LAKE.x, z: LAKE.z - 20, r: 40 },
	{ id: 'grotto', name: 'Hidden Grotto', icon: 'cave', x: GROTTO.x, z: GROTTO.z, r: 14 },
	{ id: 'ring', name: 'Ring of Echoes', icon: 'arena', x: RING.x, z: RING.z, r: 30 },
	{ id: 'spire', name: 'Starfall Spire', icon: 'tower', x: SPIRE.x, z: SPIRE.z, r: 26 },
	{ id: 'isles', name: 'Drifting Isles', icon: 'isles', x: ISLES.x, z: ISLES.z, r: 30 },
	{ id: 'gate', name: 'The Broken Seal', icon: 'gate', x: GATE.x, z: GATE.z, r: 22 },
	{ id: 'courtyard', name: 'Aether Academy', icon: 'ruins', x: COURTYARD.x, z: COURTYARD.z, r: 34 },
	{ id: 'temple', name: 'Temple of Dusk', icon: 'temple', x: TEMPLE.x, z: TEMPLE.z, r: 24 },
	{ id: 'library', name: 'Sunken Library', icon: 'ruins', x: LIBRARY.x, z: LIBRARY.z, r: 22 },
	{ id: 'crypt', name: 'The Undercroft', icon: 'cave', x: CRYPT.x, z: (CRYPT.z0 + CRYPT.z1) / 2, r: 16 },
	{ id: 'arena', name: 'Crystal Throne', icon: 'boss', x: ARENA.x, z: ARENA.z, r: ARENA.r }
];

export function landmark(id: string): Landmark {
	const l = LANDMARKS.find((x) => x.id === id);
	if (!l) throw new Error(`Unknown landmark ${id}`);
	return l;
}

// ------------------------------------------------------------------ waterways

/** Upper river on the forest shelf, ending at the falls. */
export const RIVER_UPPER: Point2[] = [
	{ x: -262, z: -58 },
	{ x: -250, z: -10 },
	{ x: -246, z: 40 },
	{ x: -236, z: 96 },
	{ x: -231, z: 146 }
];

/** Lower river from the lake past Lumen Hollow into the millpond. */
export const RIVER_LOWER: Point2[] = [
	{ x: -212, z: 222 },
	{ x: -170, z: 246 },
	{ x: -120, z: 262 },
	{ x: -74, z: 272 },
	{ x: -48, z: 292 }
];

export const MILLPOND = { x: -40, z: 304, r: 18 };

// ------------------------------------------------------------------ roads

export const ROADS: Point2[][] = [
	// Hollow → crossroads
	[
		{ x: 0, z: 262 },
		{ x: 2, z: 214 },
		{ x: -4, z: 160 },
		{ x: 0, z: 112 }
	],
	// Crossroads → forest shrine
	[
		{ x: 0, z: 112 },
		{ x: -48, z: 104 },
		{ x: -96, z: 84 },
		{ x: -130, z: 58 },
		{ x: SHRINE.x, z: SHRINE.z }
	],
	// Forest road → falls
	[
		{ x: -96, z: 84 },
		{ x: -140, z: 118 },
		{ x: -178, z: 150 },
		{ x: -200, z: 166 }
	],
	// Crossroads → highlands ramp
	[
		{ x: 0, z: 112 },
		{ x: 26, z: 140 },
		{ x: HL_RAMP_A.x, z: HL_RAMP_A.z },
		{ x: HL_RAMP_B.x, z: HL_RAMP_B.z },
		{ x: 140, z: 100 },
		{ x: RING.x - 26, z: RING.z - 6 }
	],
	// Highlands → spire
	[
		{ x: 140, z: 100 },
		{ x: 160, z: 40 },
		{ x: 190, z: -6 },
		{ x: SPIRE.x, z: SPIRE.z }
	],
	// Crossroads → gate
	[
		{ x: 0, z: 112 },
		{ x: 6, z: 50 },
		{ x: -4, z: -20 },
		{ x: 0, z: -80 },
		{ x: 0, z: -140 }
	],
	// Sanctuary avenue
	[
		{ x: 0, z: -140 },
		{ x: 0, z: -222 }
	],
	[
		{ x: -60, z: -196 },
		{ x: 0, z: -190 },
		{ x: 60, z: -192 }
	]
];

export function roadDistance(x: number, z: number): number {
	let best = Infinity;
	for (const road of ROADS) {
		for (let i = 1; i < road.length; i++) {
			const a = road[i - 1];
			const b = road[i];
			// Cheap reject on a padded bounding box.
			if (x < Math.min(a.x, b.x) - 14 || x > Math.max(a.x, b.x) + 14 || z < Math.min(a.z, b.z) - 14 || z > Math.max(a.z, b.z) + 14) continue;
			best = Math.min(best, distToSegment2D(x, z, a.x, a.z, b.x, b.z));
		}
	}
	return best;
}

export function polylineDistance(pts: Point2[], x: number, z: number): number {
	let best = Infinity;
	for (let i = 1; i < pts.length; i++) best = Math.min(best, distToSegment2D(x, z, pts[i - 1].x, pts[i - 1].z, pts[i].x, pts[i].z));
	return best;
}

export function edgeDistance(x: number, z: number): number {
	return Math.min(WORLD_HALF - Math.abs(x), WORLD_HALF - Math.abs(z));
}

// ------------------------------------------------------------------ region masks

/** Smooth 0..1 masks for each region; used for atmosphere blending and terrain colouring. */
export interface RegionWeights {
	hollow: number;
	vale: number;
	forest: number;
	highlands: number;
	sanctuary: number;
}

export function sanctuaryMask(_x: number, z: number): number {
	return smoothstep(-118, -150, z);
}

/** Western forest boundary with a soft, wavy edge. */
export function forestMask(x: number, z: number): number {
	const edge = -58 + Math.sin(z * 0.03) * 10;
	return smoothstep(edge + 14, edge - 14, x) * (1 - sanctuaryMask(x, z));
}

export function highlandsMask(x: number, z: number): number {
	const edge = 78 + Math.sin(z * 0.025 + 1) * 8;
	return smoothstep(edge - 16, edge + 6, x) * (1 - sanctuaryMask(x, z));
}

export function hollowMask(x: number, z: number): number {
	const d = Math.hypot(x - HOLLOW.x, z - HOLLOW.z);
	return smoothstep(70, 42, d);
}

export function regionWeights(x: number, z: number, out: RegionWeights): RegionWeights {
	const s = sanctuaryMask(x, z);
	const f = forestMask(x, z);
	const h = highlandsMask(x, z);
	const ho = hollowMask(x, z) * (1 - f) * (1 - h);
	const v = clamp(1 - s - f - h - ho, 0, 1);
	const sum = s + f + h + ho + v || 1;
	out.sanctuary = s / sum;
	out.forest = f / sum;
	out.highlands = h / sum;
	out.hollow = ho / sum;
	out.vale = v / sum;
	return out;
}

export function regionAt(x: number, z: number): RegionId {
	if (sanctuaryMask(x, z) > 0.5) return 'sanctuary';
	if (forestMask(x, z) > 0.5) return 'forest';
	if (highlandsMask(x, z) > 0.5) return 'highlands';
	if (hollowMask(x, z) > 0.5) return 'hollow';
	return 'vale';
}
