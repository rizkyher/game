export interface LoopHooks {
	fixed(dt: number): void;
	frame(dt: number, alpha: number): void;
}

/**
 * requestAnimationFrame loop with a fixed-timestep accumulator for physics and variable
 * per-frame updates for visuals. Stops while the tab is hidden.
 */
export class GameLoop {
	private raf = 0;
	private running = false;
	private last = 0;
	private acc = 0;
	private frameTimes = new Float32Array(60);
	private frameIdx = 0;
	fps = 60;
	/** Average frame time in ms over the last 60 frames. */
	avgFrameMs = 16.7;
	/** When true, fixed steps are skipped (paused) but frames still render. */
	frozen = false;
	readonly maxSteps = 5;

	constructor(
		readonly fixedDt: number,
		private hooks: LoopHooks
	) {
		document.addEventListener('visibilitychange', this.onVisibility);
	}

	private onVisibility = () => {
		if (document.hidden) this.halt();
		else if (this.running) this.resumeLoop();
	};

	start(): void {
		if (this.running) return;
		this.running = true;
		this.resumeLoop();
	}

	private resumeLoop(): void {
		cancelAnimationFrame(this.raf);
		this.last = performance.now();
		this.acc = 0;
		this.raf = requestAnimationFrame(this.tick);
	}

	private halt(): void {
		cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	stop(): void {
		this.running = false;
		this.halt();
	}

	private tick = (now: number) => {
		this.raf = requestAnimationFrame(this.tick);
		let dt = (now - this.last) / 1000;
		this.last = now;
		if (dt > 0.1) dt = 0.1;
		if (dt <= 0) return;
		this.frameTimes[this.frameIdx] = dt * 1000;
		this.frameIdx = (this.frameIdx + 1) % this.frameTimes.length;
		if (this.frameIdx === 0) {
			let sum = 0;
			for (const t of this.frameTimes) sum += t;
			this.avgFrameMs = sum / this.frameTimes.length;
			this.fps = Math.round(1000 / this.avgFrameMs);
		}
		if (!this.frozen) {
			this.acc += dt;
			let steps = 0;
			while (this.acc >= this.fixedDt && steps < this.maxSteps) {
				this.hooks.fixed(this.fixedDt);
				this.acc -= this.fixedDt;
				steps++;
			}
			if (steps === this.maxSteps) this.acc = 0;
		}
		this.hooks.frame(dt, this.frozen ? 1 : this.acc / this.fixedDt);
	};

	dispose(): void {
		this.stop();
		document.removeEventListener('visibilitychange', this.onVisibility);
	}
}
