import * as THREE from 'three';
import { Random } from '../utils/Random';

/** Particle atlas tiles (4 x 2 grid). */
export const TILE = { glow: 0, spark: 1, smoke: 2, flame: 3, shard: 4, leaf: 5, star: 6, ring: 7 } as const;
export type TileName = keyof typeof TILE;

const CELL = 128;

function radial(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, stops: [number, string][]): void {
	const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
	for (const [t, c] of stops) g.addColorStop(t, c);
	ctx.fillStyle = g;
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI * 2);
	ctx.fill();
}

/** Builds the white-on-transparent particle atlas; colour comes from per-particle tint. */
export function createParticleAtlas(): THREE.CanvasTexture {
	const canvas = document.createElement('canvas');
	canvas.width = CELL * 4;
	canvas.height = CELL * 2;
	const ctx = canvas.getContext('2d')!;
	const rng = new Random(77);
	const cell = (i: number, draw: (cx: number, cy: number) => void) => {
		const cx = (i % 4) * CELL + CELL / 2;
		const cy = Math.floor(i / 4) * CELL + CELL / 2;
		ctx.save();
		ctx.beginPath();
		ctx.rect(cx - CELL / 2, cy - CELL / 2, CELL, CELL);
		ctx.clip();
		draw(cx, cy);
		ctx.restore();
	};
	// glow
	cell(TILE.glow, (cx, cy) => radial(ctx, cx, cy, 62, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.85)'], [0.45, 'rgba(255,255,255,0.28)'], [1, 'rgba(255,255,255,0)']]));
	// spark: bright elongated core (stretched further by velocity)
	cell(TILE.spark, (cx, cy) => {
		ctx.translate(cx, cy);
		ctx.scale(0.28, 1);
		radial(ctx, 0, 0, 60, [[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]);
	});
	// smoke: overlapping soft blobs
	cell(TILE.smoke, (cx, cy) => {
		for (let i = 0; i < 14; i++) {
			const a = rng.range(0, Math.PI * 2);
			const d = rng.range(0, 26);
			radial(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rng.range(22, 38), [[0, 'rgba(255,255,255,0.32)'], [1, 'rgba(255,255,255,0)']]);
		}
	});
	// flame: teardrop with a hot core
	cell(TILE.flame, (cx, cy) => {
		ctx.translate(cx, cy + 14);
		const g = ctx.createRadialGradient(0, 0, 2, 0, -8, 52);
		g.addColorStop(0, 'rgba(255,255,255,1)');
		g.addColorStop(0.35, 'rgba(255,255,255,0.75)');
		g.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.moveTo(0, -58);
		ctx.bezierCurveTo(26, -24, 34, 10, 0, 40);
		ctx.bezierCurveTo(-34, 10, -26, -24, 0, -58);
		ctx.fill();
	});
	// shard: faceted diamond
	cell(TILE.shard, (cx, cy) => {
		ctx.translate(cx, cy);
		ctx.fillStyle = 'rgba(255,255,255,0.95)';
		ctx.beginPath();
		ctx.moveTo(0, -56);
		ctx.lineTo(18, 0);
		ctx.lineTo(0, 56);
		ctx.lineTo(-18, 0);
		ctx.closePath();
		ctx.fill();
		ctx.fillStyle = 'rgba(255,255,255,0.55)';
		ctx.beginPath();
		ctx.moveTo(0, -56);
		ctx.lineTo(18, 0);
		ctx.lineTo(0, 0);
		ctx.closePath();
		ctx.fill();
	});
	// leaf
	cell(TILE.leaf, (cx, cy) => {
		ctx.translate(cx, cy);
		ctx.rotate(0.6);
		ctx.fillStyle = 'rgba(255,255,255,0.95)';
		ctx.beginPath();
		ctx.moveTo(0, -48);
		ctx.quadraticCurveTo(34, 0, 0, 48);
		ctx.quadraticCurveTo(-34, 0, 0, -48);
		ctx.fill();
		ctx.strokeStyle = 'rgba(0,0,0,0.25)';
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.moveTo(0, -44);
		ctx.lineTo(0, 44);
		ctx.stroke();
	});
	// star: four-point twinkle
	cell(TILE.star, (cx, cy) => {
		radial(ctx, cx, cy, 30, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
		ctx.translate(cx, cy);
		for (let k = 0; k < 2; k++) {
			ctx.save();
			ctx.rotate((k * Math.PI) / 2);
			ctx.scale(0.09, 1);
			radial(ctx, 0, 0, 62, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
			ctx.restore();
		}
	});
	// ring
	cell(TILE.ring, (cx, cy) => {
		const g = ctx.createRadialGradient(cx, cy, 30, cx, cy, 60);
		g.addColorStop(0, 'rgba(255,255,255,0)');
		g.addColorStop(0.55, 'rgba(255,255,255,1)');
		g.addColorStop(1, 'rgba(255,255,255,0)');
		ctx.fillStyle = g;
		ctx.beginPath();
		ctx.arc(cx, cy, 60, 0, Math.PI * 2);
		ctx.fill();
	});
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.NoColorSpace;
	tex.generateMipmaps = true;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	return tex;
}

/** An ornate magic circle (white on transparent) used for casting circles and AoE decals. */
export function createRuneCircle(seed = 3): THREE.CanvasTexture {
	const size = 512;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	const c = size / 2;
	const rng = new Random(seed);
	ctx.strokeStyle = 'white';
	ctx.fillStyle = 'white';
	ctx.shadowColor = 'white';
	ctx.shadowBlur = 8;
	const ring = (r: number, w: number) => {
		ctx.lineWidth = w;
		ctx.beginPath();
		ctx.arc(c, c, r, 0, Math.PI * 2);
		ctx.stroke();
	};
	ring(248, 6);
	ring(232, 2);
	ring(178, 4);
	ring(120, 2.5);
	ring(60, 3);
	// Glyph band between the outer rings.
	ctx.font = 'bold 22px serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	const glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
	const n = 30;
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		ctx.save();
		ctx.translate(c + Math.cos(a) * 205, c + Math.sin(a) * 205);
		ctx.rotate(a + Math.PI / 2);
		ctx.fillText(glyphs[Math.floor(rng.next() * glyphs.length)], 0, 0);
		ctx.restore();
	}
	// Two interlocking triangles (hexagram) and spokes.
	ctx.lineWidth = 3;
	for (let t = 0; t < 2; t++) {
		ctx.beginPath();
		for (let i = 0; i <= 3; i++) {
			const a = (i / 3) * Math.PI * 2 + t * Math.PI + Math.PI / 2;
			const x = c + Math.cos(a) * 176;
			const y = c + Math.sin(a) * 176;
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.stroke();
	}
	ctx.lineWidth = 2;
	for (let i = 0; i < 12; i++) {
		const a = (i / 12) * Math.PI * 2;
		ctx.beginPath();
		ctx.moveTo(c + Math.cos(a) * 60, c + Math.sin(a) * 60);
		ctx.lineTo(c + Math.cos(a) * 120, c + Math.sin(a) * 120);
		ctx.stroke();
		ctx.beginPath();
		ctx.arc(c + Math.cos(a) * 150, c + Math.sin(a) * 150, 6, 0, Math.PI * 2);
		ctx.fill();
	}
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.NoColorSpace;
	tex.anisotropy = 4;
	return tex;
}

/** Soft disc with a bright rim, used by danger telegraphs. */
export function createTelegraphTexture(): THREE.CanvasTexture {
	const size = 256;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d')!;
	const c = size / 2;
	const g = ctx.createRadialGradient(c, c, 0, c, c, c);
	g.addColorStop(0, 'rgba(255,255,255,0.18)');
	g.addColorStop(0.85, 'rgba(255,255,255,0.32)');
	g.addColorStop(0.94, 'rgba(255,255,255,1)');
	g.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, size, size);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = THREE.NoColorSpace;
	return tex;
}
