import type * as THREE from 'three';

const EPS = 1e-8;

/**
 * Squared distance between segments p1-q1 and p2-q2. Writes the parameters of the closest
 * points (0..1 along each segment) into `out`.
 */
export function segSegDist2(p1: THREE.Vector3, q1: THREE.Vector3, p2: THREE.Vector3, q2: THREE.Vector3, out: { s: number; t: number }): number {
	const d1x = q1.x - p1.x;
	const d1y = q1.y - p1.y;
	const d1z = q1.z - p1.z;
	const d2x = q2.x - p2.x;
	const d2y = q2.y - p2.y;
	const d2z = q2.z - p2.z;
	const rx = p1.x - p2.x;
	const ry = p1.y - p2.y;
	const rz = p1.z - p2.z;
	const a = d1x * d1x + d1y * d1y + d1z * d1z;
	const e = d2x * d2x + d2y * d2y + d2z * d2z;
	const f = d2x * rx + d2y * ry + d2z * rz;
	let s: number;
	let t: number;
	if (a <= EPS && e <= EPS) {
		s = t = 0;
	} else if (a <= EPS) {
		s = 0;
		t = clamp01(f / e);
	} else {
		const c = d1x * rx + d1y * ry + d1z * rz;
		if (e <= EPS) {
			t = 0;
			s = clamp01(-c / a);
		} else {
			const b = d1x * d2x + d1y * d2y + d1z * d2z;
			const denom = a * e - b * b;
			s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
			t = (b * s + f) / e;
			if (t < 0) {
				t = 0;
				s = clamp01(-c / a);
			} else if (t > 1) {
				t = 1;
				s = clamp01((b - c) / a);
			}
		}
	}
	out.s = s;
	out.t = t;
	const cx = p1.x + d1x * s - (p2.x + d2x * t);
	const cy = p1.y + d1y * s - (p2.y + d2y * t);
	const cz = p1.z + d1z * s - (p2.z + d2z * t);
	return cx * cx + cy * cy + cz * cz;
}

/** Squared distance from point p to segment a-b; writes the parameter into out.t. */
export function pointSegDist2(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out?: { t: number }): number {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const abz = b.z - a.z;
	const len2 = abx * abx + aby * aby + abz * abz;
	let t = len2 > EPS ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
	t = clamp01(t);
	if (out) out.t = t;
	const cx = a.x + abx * t - p.x;
	const cy = a.y + aby * t - p.y;
	const cz = a.z + abz * t - p.z;
	return cx * cx + cy * cy + cz * cz;
}

function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}
