export type Quality = 'low' | 'medium' | 'high' | 'ultra';

export interface Settings {
	quality: Quality;
	sensitivity: number;
	invertY: boolean;
	fov: number;
	master: number;
	sfx: number;
	music: number;
	showFps: boolean;
	adaptive: boolean;
	shake: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
	quality: 'high',
	sensitivity: 1,
	invertY: false,
	fov: 72,
	master: 0.8,
	sfx: 0.9,
	music: 0.45,
	showFps: false,
	adaptive: true,
	shake: true
};

export interface QualityPreset {
	label: string;
	pixelRatio: number;
	shadows: boolean;
	shadowSize: number;
	shadowExtent: number;
	grassBlades: number;
	grassArea: number;
	drawDistance: number;
	flowerDensity: number;
	/** Multiplier on per-layer vegetation view distances. */
	detailScale: number;
	antialias: boolean;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
	low: { label: 'Low', pixelRatio: 0.85, shadows: false, shadowSize: 512, shadowExtent: 60, grassBlades: 9000, grassArea: 60, drawDistance: 330, flowerDensity: 0.45, detailScale: 0.65, antialias: false },
	medium: { label: 'Medium', pixelRatio: 1.25, shadows: true, shadowSize: 1024, shadowExtent: 70, grassBlades: 20000, grassArea: 74, drawDistance: 420, flowerDensity: 0.7, detailScale: 0.85, antialias: true },
	high: { label: 'High', pixelRatio: 1.6, shadows: true, shadowSize: 2048, shadowExtent: 85, grassBlades: 34000, grassArea: 86, drawDistance: 520, flowerDensity: 1, detailScale: 1, antialias: true },
	ultra: { label: 'Ultra', pixelRatio: 2, shadows: true, shadowSize: 4096, shadowExtent: 110, grassBlades: 46000, grassArea: 92, drawDistance: 650, flowerDensity: 1, detailScale: 1.3, antialias: true }
};
