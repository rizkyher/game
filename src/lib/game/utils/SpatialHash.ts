/**
 * Uniform grid over the XZ plane for fast proximity queries of interactable things
 * (flowers, props, collectibles). Items are stored by reference; positions are static
 * unless `move` is called.
 */
export interface SpatialItem {
	x: number;
	z: number;
}

export class SpatialHash<T extends SpatialItem> {
	private cells = new Map<number, T[]>();

	constructor(private cellSize: number) {}

	private key(cx: number, cz: number): number {
		return (cx + 1024) * 4096 + (cz + 1024);
	}

	insert(item: T): void {
		const k = this.key(Math.floor(item.x / this.cellSize), Math.floor(item.z / this.cellSize));
		let bucket = this.cells.get(k);
		if (!bucket) {
			bucket = [];
			this.cells.set(k, bucket);
		}
		bucket.push(item);
	}

	remove(item: T): void {
		const k = this.key(Math.floor(item.x / this.cellSize), Math.floor(item.z / this.cellSize));
		const bucket = this.cells.get(k);
		if (!bucket) return;
		const i = bucket.indexOf(item);
		if (i >= 0) bucket.splice(i, 1);
	}

	/** Calls `fn` for every item whose cell overlaps the query circle. Caller does exact distance test. */
	query(x: number, z: number, radius: number, fn: (item: T) => void): void {
		const cs = this.cellSize;
		const minX = Math.floor((x - radius) / cs);
		const maxX = Math.floor((x + radius) / cs);
		const minZ = Math.floor((z - radius) / cs);
		const maxZ = Math.floor((z + radius) / cs);
		for (let cx = minX; cx <= maxX; cx++) {
			for (let cz = minZ; cz <= maxZ; cz++) {
				const bucket = this.cells.get(this.key(cx, cz));
				if (!bucket) continue;
				for (let i = 0; i < bucket.length; i++) fn(bucket[i]);
			}
		}
	}
}
