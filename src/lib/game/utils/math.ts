export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
	return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
	return clamp((v - a) / (b - a), 0, 1);
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
	return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential smoothing factor. */
export function dampFactor(rate: number, dt: number): number {
	return 1 - Math.exp(-rate * dt);
}

export function damp(current: number, target: number, rate: number, dt: number): number {
	return current + (target - current) * dampFactor(rate, dt);
}

/** Smoothly interpolate between two angles (radians) along the shortest arc. */
export function dampAngle(current: number, target: number, rate: number, dt: number): number {
	const diff = wrapAngle(target - current);
	return current + diff * dampFactor(rate, dt);
}

export function wrapAngle(a: number): number {
	a = (a + Math.PI) % TAU;
	if (a < 0) a += TAU;
	return a - Math.PI;
}

export function approach(current: number, target: number, maxDelta: number): number {
	if (current < target) return Math.min(current + maxDelta, target);
	return Math.max(current - maxDelta, target);
}

export function dist2D(ax: number, az: number, bx: number, bz: number): number {
	const dx = ax - bx;
	const dz = az - bz;
	return Math.sqrt(dx * dx + dz * dz);
}

/** Distance from point to segment in the XZ plane. Returns distance and segment parameter t. */
export function distToSegment2D(
	px: number,
	pz: number,
	ax: number,
	az: number,
	bx: number,
	bz: number,
	out?: { t: number }
): number {
	const abx = bx - ax;
	const abz = bz - az;
	const len2 = abx * abx + abz * abz;
	let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
	t = clamp(t, 0, 1);
	if (out) out.t = t;
	const cx = ax + abx * t - px;
	const cz = az + abz * t - pz;
	return Math.sqrt(cx * cx + cz * cz);
}
