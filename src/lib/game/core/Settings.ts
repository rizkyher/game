export type Quality = 'low' | 'medium' | 'high';

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
	damageNumbers: boolean;
	aimAssist: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
	quality: 'high',
	sensitivity: 1,
	invertY: false,
	fov: 70,
	master: 0.8,
	sfx: 0.9,
	music: 0.5,
	showFps: false,
	adaptive: true,
	shake: true,
	damageNumbers: true,
	aimAssist: true
};

export interface QualityPreset {
	label: string;
	pixelRatio: number;
	shadows: boolean;
	shadowSize: number;
	shadowExtent: number;
	bloom: boolean;
	bloomStrength: number;
	grassBlades: number;
	grassArea: number;
	drawDistance: number;
	/** Multiplier on scattered vegetation counts. */
	vegDensity: number;
	/** Multiplier on per-layer vegetation view distances. */
	detailScale: number;
	antialias: boolean;
	/** Multiplier on particle spawn counts. */
	particles: number;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
	low: {
		label: 'Low',
		pixelRatio: 0.85,
		shadows: false,
		shadowSize: 1024,
		shadowExtent: 50,
		bloom: false,
		bloomStrength: 0,
		grassBlades: 8000,
		grassArea: 56,
		drawDistance: 300,
		vegDensity: 0.55,
		detailScale: 0.65,
		antialias: false,
		particles: 0.55
	},
	medium: {
		label: 'Medium',
		pixelRatio: 1.25,
		shadows: true,
		shadowSize: 1024,
		shadowExtent: 60,
		bloom: true,
		bloomStrength: 0.7,
		grassBlades: 18000,
		grassArea: 70,
		drawDistance: 400,
		vegDensity: 0.8,
		detailScale: 0.85,
		antialias: false,
		particles: 0.8
	},
	high: {
		label: 'High',
		pixelRatio: 1.75,
		shadows: true,
		shadowSize: 2048,
		shadowExtent: 75,
		bloom: true,
		bloomStrength: 0.85,
		grassBlades: 32000,
		grassArea: 84,
		drawDistance: 520,
		vegDensity: 1,
		detailScale: 1,
		antialias: true,
		particles: 1
	}
};
