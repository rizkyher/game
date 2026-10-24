export type DodgeDir = 'left' | 'right' | 'back' | 'forward';

/**
 * Rolling record of observable player habits that enemies may adapt to. It only stores
 * things an opponent could see (casts thrown, dodges made), never raw input state.
 */
export class PlayerProfile {
	private casts: number[] = [];
	private projectilesAt = new Map<number, number[]>();
	private dodges: { t: number; dir: DodgeDir }[] = [];
	private now = 0;

	update(time: number): void {
		this.now = time;
		while (this.casts.length && time - this.casts[0] > 6) this.casts.shift();
		while (this.dodges.length && time - this.dodges[0].t > 12) this.dodges.shift();
	}

	recordCast(projectile: boolean): void {
		if (projectile) this.casts.push(this.now);
	}

	/** A projectile was aimed at (or passed close to) enemy `uid`. */
	recordProjectileAt(uid: number): void {
		let l = this.projectilesAt.get(uid);
		if (!l) {
			l = [];
			this.projectilesAt.set(uid, l);
		}
		l.push(this.now);
		while (l.length && this.now - l[0] > 4) l.shift();
	}

	recordDodge(dir: DodgeDir): void {
		this.dodges.push({ t: this.now, dir });
		if (this.dodges.length > 8) this.dodges.shift();
	}

	/** Projectile casts per second over the last 6 s. */
	rangedRate(): number {
		return this.casts.length / 6;
	}

	projectilePressure(uid: number): number {
		const l = this.projectilesAt.get(uid);
		if (!l) return 0;
		while (l.length && this.now - l[0] > 4) l.shift();
		return l.length;
	}

	/** If the last three dodges went the same way, that direction; otherwise null. */
	predictedDodge(): DodgeDir | null {
		const n = this.dodges.length;
		if (n < 3) return null;
		const d = this.dodges[n - 1].dir;
		if (this.dodges[n - 2].dir === d && this.dodges[n - 3].dir === d) return d;
		return null;
	}

	forget(uid: number): void {
		this.projectilesAt.delete(uid);
	}

	reset(): void {
		this.casts.length = 0;
		this.dodges.length = 0;
		this.projectilesAt.clear();
	}
}
