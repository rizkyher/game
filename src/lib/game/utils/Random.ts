/** Small, fast deterministic PRNG (mulberry32) so the world layout is identical every run. */
export class Random {
	private state: number;

	constructor(seed: number) {
		this.state = seed >>> 0 || 0x9e3779b9;
	}

	next(): number {
		let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	range(min: number, max: number): number {
		return min + (max - min) * this.next();
	}

	int(min: number, maxInclusive: number): number {
		return Math.floor(this.range(min, maxInclusive + 1));
	}

	chance(p: number): boolean {
		return this.next() < p;
	}

	pick<T>(items: readonly T[]): T {
		return items[Math.floor(this.next() * items.length)];
	}

	sign(): number {
		return this.next() < 0.5 ? -1 : 1;
	}
}

/** Stateless integer hash -> [0, 1). Useful for per-cell deterministic values. */
export function hash2(x: number, y: number, seed = 0): number {
	let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177);
	h = Math.imul(h ^ (h >>> 13), 1103515245);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}
