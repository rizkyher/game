export type Action =
	| 'forward'
	| 'back'
	| 'left'
	| 'right'
	| 'up'
	| 'down'
	| 'boost'
	| 'interact'
	| 'dash'
	| 'roll'
	| 'drop'
	| 'map'
	| 'pause';

const BINDINGS: Record<Action, string[]> = {
	forward: ['KeyW', 'ArrowUp'],
	back: ['KeyS', 'ArrowDown'],
	left: ['KeyA', 'ArrowLeft'],
	right: ['KeyD', 'ArrowRight'],
	up: ['Space'],
	down: ['ControlLeft', 'ControlRight', 'KeyC'],
	boost: ['ShiftLeft', 'ShiftRight'],
	interact: ['KeyE'],
	dash: ['KeyQ'],
	roll: ['KeyR'],
	drop: ['KeyF'],
	map: ['KeyM'],
	pause: ['Escape', 'KeyP']
};

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'KeyQ', 'KeyR', 'KeyF']);

/**
 * Keyboard + mouse state with pointer lock handling. "Pressed" edges are kept until
 * `endFrame()` so per-frame logic can read them reliably.
 */
export class InputManager {
	private down = new Set<string>();
	private pressed = new Set<string>();
	private mouseDown = [false, false, false];
	private mousePressed = [false, false, false];
	private dx = 0;
	private dy = 0;
	private wheel = 0;
	locked = false;
	/** When false, game-related input is ignored (menus). */
	enabled = false;
	onLockChange?: (locked: boolean) => void;
	onKey?: (code: string) => void;
	private lastUnlock = 0;

	constructor(private target: HTMLElement) {
		window.addEventListener('keydown', this.onKeyDown);
		window.addEventListener('keyup', this.onKeyUp);
		window.addEventListener('blur', this.onBlur);
		target.addEventListener('mousedown', this.onMouseDown);
		window.addEventListener('mouseup', this.onMouseUp);
		window.addEventListener('mousemove', this.onMouseMove);
		target.addEventListener('wheel', this.onWheel, { passive: false });
		target.addEventListener('contextmenu', this.onContext);
		document.addEventListener('pointerlockchange', this.onPointerLockChange);
	}

	private onKeyDown = (e: KeyboardEvent) => {
		if (this.enabled && (PREVENT.has(e.code) || (e.code === 'Space' && !isTyping(e)))) e.preventDefault();
		if (!e.repeat) {
			this.pressed.add(e.code);
			this.onKey?.(e.code);
		}
		this.down.add(e.code);
	};

	private onKeyUp = (e: KeyboardEvent) => {
		this.down.delete(e.code);
	};

	private onBlur = () => {
		this.down.clear();
		this.mouseDown.fill(false);
	};

	private onMouseDown = (e: MouseEvent) => {
		if (e.button < 3) {
			this.mouseDown[e.button] = true;
			this.mousePressed[e.button] = true;
		}
	};

	private onMouseUp = (e: MouseEvent) => {
		if (e.button < 3) this.mouseDown[e.button] = false;
	};

	private onMouseMove = (e: MouseEvent) => {
		if (!this.locked) return;
		// Guard against the occasional huge spike some browsers emit right after locking.
		if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
		this.dx += e.movementX;
		this.dy += e.movementY;
	};

	private onWheel = (e: WheelEvent) => {
		if (this.enabled) e.preventDefault();
		this.wheel += Math.sign(e.deltaY);
	};

	private onContext = (e: Event) => e.preventDefault();

	private onPointerLockChange = () => {
		this.locked = document.pointerLockElement === this.target;
		if (!this.locked) {
			this.lastUnlock = performance.now();
			this.mouseDown.fill(false);
		}
		this.onLockChange?.(this.locked);
	};

	async requestLock(): Promise<boolean> {
		if (this.locked) return true;
		// Browsers refuse re-locking for ~1s after the user pressed Esc.
		const wait = 1100 - (performance.now() - this.lastUnlock);
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		try {
			await (this.target.requestPointerLock as (o?: unknown) => Promise<void> | void).call(this.target, { unadjustedMovement: true });
			return true;
		} catch {
			try {
				await this.target.requestPointerLock();
				return true;
			} catch {
				return false;
			}
		}
	}

	exitLock(): void {
		if (document.pointerLockElement) document.exitPointerLock();
	}

	isDown(a: Action): boolean {
		if (!this.enabled) return false;
		for (const c of BINDINGS[a]) if (this.down.has(c)) return true;
		return false;
	}

	wasPressed(a: Action): boolean {
		if (!this.enabled) return false;
		for (const c of BINDINGS[a]) if (this.pressed.has(c)) return true;
		return false;
	}

	axis(neg: Action, pos: Action): number {
		return (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
	}

	mouse(button: 0 | 2): boolean {
		return this.enabled && this.locked && this.mouseDown[button];
	}

	mouseClicked(button: 0 | 2): boolean {
		return this.enabled && this.locked && this.mousePressed[button];
	}

	/** Any key/button pressed this frame (used for struggle mashing). */
	anyPressed(): boolean {
		return this.enabled && (this.pressed.size > 0 || this.mousePressed[0] || this.mousePressed[2]);
	}

	consumeMouse(out: { x: number; y: number }): void {
		out.x = this.dx;
		out.y = this.dy;
		this.dx = 0;
		this.dy = 0;
	}

	consumeWheel(): number {
		const w = this.wheel;
		this.wheel = 0;
		return w;
	}

	endFrame(): void {
		this.pressed.clear();
		this.mousePressed.fill(false);
	}

	dispose(): void {
		window.removeEventListener('keydown', this.onKeyDown);
		window.removeEventListener('keyup', this.onKeyUp);
		window.removeEventListener('blur', this.onBlur);
		this.target.removeEventListener('mousedown', this.onMouseDown);
		window.removeEventListener('mouseup', this.onMouseUp);
		window.removeEventListener('mousemove', this.onMouseMove);
		this.target.removeEventListener('wheel', this.onWheel);
		this.target.removeEventListener('contextmenu', this.onContext);
		document.removeEventListener('pointerlockchange', this.onPointerLockChange);
	}
}

function isTyping(e: KeyboardEvent): boolean {
	const t = e.target as HTMLElement | null;
	return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
