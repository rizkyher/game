export type Action =
	| 'forward'
	| 'back'
	| 'left'
	| 'right'
	| 'sprint'
	| 'jump'
	| 'dodge'
	| 'interact'
	| 'shield'
	| 'parry'
	| 'lock'
	| 'potion'
	| 'manaPotion'
	| 'ultimate'
	| 'channel'
	| 'elem1'
	| 'elem2'
	| 'elem3'
	| 'elem4'
	| 'inventory'
	| 'skills'
	| 'map'
	| 'pause';

const BINDINGS: Record<Action, string[]> = {
	forward: ['KeyW', 'ArrowUp'],
	back: ['KeyS', 'ArrowDown'],
	left: ['KeyA', 'ArrowLeft'],
	right: ['KeyD', 'ArrowRight'],
	sprint: ['ShiftLeft', 'ShiftRight'],
	jump: ['Space'],
	dodge: ['KeyQ'],
	interact: ['KeyE'],
	shield: ['KeyF'],
	parry: ['KeyR'],
	lock: ['Tab'],
	potion: ['KeyH'],
	manaPotion: ['KeyJ'],
	ultimate: ['KeyG'],
	channel: ['KeyX'],
	elem1: ['Digit1', 'Numpad1'],
	elem2: ['Digit2', 'Numpad2'],
	elem3: ['Digit3', 'Numpad3'],
	elem4: ['Digit4', 'Numpad4'],
	inventory: ['KeyI', 'KeyC'],
	skills: ['KeyK'],
	map: ['KeyM'],
	pause: ['Escape', 'KeyP']
};

/** Standard-mapping gamepad buttons. */
export const PAD = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 } as const;

const PAD_BINDINGS: Partial<Record<Action, number[]>> = {
	jump: [PAD.A],
	dodge: [PAD.B],
	interact: [PAD.X],
	ultimate: [PAD.Y],
	shield: [PAD.RB],
	parry: [PAD.LB],
	sprint: [PAD.L3],
	lock: [PAD.R3],
	elem1: [PAD.UP],
	elem2: [PAD.RIGHT],
	elem3: [PAD.DOWN],
	elem4: [PAD.LEFT],
	map: [PAD.BACK]
};

const STICK_DEAD = 0.18;
/** Right-stick look speed in "mouse pixels" per second at full deflection. */
const STICK_LOOK = 1100;

function deadzone(x: number, y: number, out: { x: number; y: number }): void {
	const m = Math.hypot(x, y);
	if (m < STICK_DEAD) {
		out.x = out.y = 0;
		return;
	}
	const k = Math.min(1, (m - STICK_DEAD) / (1 - STICK_DEAD)) / m;
	out.x = x * k;
	out.y = y * k;
}

const PREVENT = new Set(['Space', 'Tab', 'KeyQ', 'KeyR', 'KeyF', 'KeyH', 'KeyG', 'KeyX', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/**
 * Keyboard + mouse + gamepad state with pointer lock handling. "Pressed" edges are kept
 * until `endFrame()` so per-frame logic can read them reliably; gameplay buffers them into
 * timed intents so fixed-step code never misses a press.
 */
export class InputManager {
	private down = new Set<string>();
	private pressed = new Set<string>();
	private mouseDown = [false, false, false];
	private mousePressed = [false, false, false];
	private mouseReleased = [false, false, false];
	private dx = 0;
	private dy = 0;
	private wheel = 0;
	locked = false;
	/** When false, game-related input is ignored (menus, dialogue). */
	enabled = false;
	/** Accept mouse buttons without pointer lock (automation / embedded previews). */
	allowUnlockedMouse = false;
	onLockChange?: (locked: boolean) => void;
	onLockError?: () => void;
	onKey?: (code: string) => void;
	private lastUnlock = 0;
	private lockedAt = 0;
	private padDown: boolean[] = [];
	private padPressed: boolean[] = [];
	private padReleased: boolean[] = [];
	private leftStick = { x: 0, y: 0 };
	private rightStick = { x: 0, y: 0 };
	private padLastUsed = -1e9;
	gamepadActive = false;

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
		document.addEventListener('pointerlockerror', this.onPointerLockError);
	}

	private onKeyDown = (e: KeyboardEvent) => {
		if (isTyping(e)) return;
		if (this.enabled && PREVENT.has(e.code)) e.preventDefault();
		// Tab would move focus out of the canvas even in menus.
		if (e.code === 'Tab') e.preventDefault();
		if (!e.repeat) {
			// Presses made while gameplay input is off (dialogue, menus) must not leak into the
			// first frame after it turns back on: closing a dialogue with E would re-open it.
			if (this.enabled) this.pressed.add(e.code);
			this.onKey?.(e.code);
		}
		this.down.add(e.code);
	};

	private onKeyUp = (e: KeyboardEvent) => {
		this.down.delete(e.code);
	};

	private onBlur = () => {
		this.down.clear();
		for (let i = 0; i < 3; i++) if (this.mouseDown[i]) this.mouseReleased[i] = true;
		this.mouseDown.fill(false);
	};

	private onMouseDown = (e: MouseEvent) => {
		if (e.button < 3) {
			this.mouseDown[e.button] = true;
			this.mousePressed[e.button] = true;
		}
	};

	private onMouseUp = (e: MouseEvent) => {
		if (e.button < 3) {
			if (this.mouseDown[e.button]) this.mouseReleased[e.button] = true;
			this.mouseDown[e.button] = false;
		}
	};

	private onMouseMove = (e: MouseEvent) => {
		if (!this.locked) return;
		// Browsers can emit one big synthetic delta right after locking; ignore a short window
		// after the lock and any absurd single-event spikes.
		if (performance.now() - this.lockedAt < 120) return;
		if (Math.abs(e.movementX) > 350 || Math.abs(e.movementY) > 350) return;
		this.dx += e.movementX;
		this.dy += e.movementY;
	};

	/** Inject look deltas (automation, touch). */
	addLook(x: number, y: number): void {
		this.dx += x;
		this.dy += y;
	}

	private onWheel = (e: WheelEvent) => {
		if (this.enabled) e.preventDefault();
		this.wheel += Math.sign(e.deltaY);
	};

	private onContext = (e: Event) => e.preventDefault();

	private onPointerLockChange = () => {
		this.locked = document.pointerLockElement === this.target;
		if (this.locked) {
			this.lockedAt = performance.now();
			this.dx = 0;
			this.dy = 0;
		} else {
			this.lastUnlock = performance.now();
			for (let i = 0; i < 3; i++) if (this.mouseDown[i]) this.mouseReleased[i] = true;
			this.mouseDown.fill(false);
		}
		this.onLockChange?.(this.locked);
	};

	private onPointerLockError = () => {
		this.onLockError?.();
	};

	async requestLock(): Promise<boolean> {
		if (this.locked) return true;
		// Browsers refuse re-locking for ~1s after the user pressed Esc.
		const wait = 1050 - (performance.now() - this.lastUnlock);
		if (wait > 0) await new Promise((r) => setTimeout(r, wait));
		if (this.locked) return true;
		const el = this.target as HTMLElement & { requestPointerLock(o?: unknown): Promise<void> | void };
		try {
			await el.requestPointerLock({ unadjustedMovement: true });
		} catch {
			try {
				await el.requestPointerLock();
			} catch {
				return false;
			}
		}
		// Older browsers return undefined synchronously; give the change event a moment.
		if (!this.locked) await new Promise((r) => setTimeout(r, 60));
		return this.locked;
	}

	exitLock(): void {
		if (document.pointerLockElement) document.exitPointerLock();
	}

	/** Reads the first connected gamepad. Call once per frame before game logic. */
	pollGamepad(dt: number): void {
		const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
		let pad: Gamepad | null = null;
		for (const p of pads)
			if (p && p.connected) {
				pad = p;
				break;
			}
		if (!pad) {
			this.padDown.length = 0;
			this.leftStick.x = this.leftStick.y = this.rightStick.x = this.rightStick.y = 0;
			this.gamepadActive = false;
			return;
		}
		let used = false;
		for (let i = 0; i < pad.buttons.length; i++) {
			const b = pad.buttons[i];
			const down = b.pressed || b.value > 0.3;
			if (down && !this.padDown[i]) this.padPressed[i] = true;
			if (!down && this.padDown[i]) this.padReleased[i] = true;
			this.padDown[i] = down;
			if (down) used = true;
		}
		deadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0, this.leftStick);
		deadzone(pad.axes[2] ?? 0, pad.axes[3] ?? 0, this.rightStick);
		if (this.leftStick.x || this.leftStick.y || this.rightStick.x || this.rightStick.y) used = true;
		if (used) this.padLastUsed = performance.now();
		this.gamepadActive = performance.now() - this.padLastUsed < 5000;
		if (this.enabled) {
			this.dx += this.rightStick.x * STICK_LOOK * dt;
			this.dy += this.rightStick.y * STICK_LOOK * dt;
		}
	}

	padButtonPressed(button: number): boolean {
		return !!this.padPressed[button];
	}

	isDown(a: Action): boolean {
		if (!this.enabled) return false;
		for (const c of BINDINGS[a]) if (this.down.has(c)) return true;
		const pb = PAD_BINDINGS[a];
		if (pb) for (const b of pb) if (this.padDown[b]) return true;
		return false;
	}

	wasPressed(a: Action): boolean {
		if (!this.enabled) return false;
		for (const c of BINDINGS[a]) if (this.pressed.has(c)) return true;
		const pb = PAD_BINDINGS[a];
		if (pb) for (const b of pb) if (this.padPressed[b]) return true;
		return false;
	}

	/** -1..1 from keys and the left stick (analog). */
	axis(neg: Action, pos: Action): number {
		let v = (this.isDown(pos) ? 1 : 0) - (this.isDown(neg) ? 1 : 0);
		if (this.enabled) {
			if (pos === 'forward') v -= this.leftStick.y;
			else if (pos === 'right') v += this.leftStick.x;
		}
		return Math.max(-1, Math.min(1, v));
	}

	private mouseOk(): boolean {
		return this.locked || this.allowUnlockedMouse;
	}

	/** Left = basic cast (pad RT), right = charged cast (pad LT). */
	mouse(button: 0 | 2): boolean {
		if (!this.enabled) return false;
		return (this.mouseOk() && this.mouseDown[button]) || !!this.padDown[button === 0 ? PAD.RT : PAD.LT];
	}

	mouseClicked(button: 0 | 2): boolean {
		if (!this.enabled) return false;
		return (this.mouseOk() && this.mousePressed[button]) || !!this.padPressed[button === 0 ? PAD.RT : PAD.LT];
	}

	mouseUp(button: 0 | 2): boolean {
		if (!this.enabled) return false;
		return this.mouseReleased[button] || !!this.padReleased[button === 0 ? PAD.RT : PAD.LT];
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

	/** Drops held state, e.g. when a menu opens mid-action. */
	clearHeld(): void {
		this.down.clear();
		this.mouseDown.fill(false);
		this.mouseReleased.fill(true);
	}

	endFrame(): void {
		this.pressed.clear();
		this.mousePressed.fill(false);
		this.mouseReleased.fill(false);
		this.padPressed.length = 0;
		this.padReleased.length = 0;
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
		document.removeEventListener('pointerlockerror', this.onPointerLockError);
	}
}

function isTyping(e: KeyboardEvent): boolean {
	const t = e.target as HTMLElement | null;
	return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
