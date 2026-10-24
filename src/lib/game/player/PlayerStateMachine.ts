/**
 * Two-layer finite state machine for the player.
 *
 * - Movement layer: what the body is doing (grounded, airborne, dodging, dashing, staggered, dead).
 * - Action layer: what the hands are doing (casting phases, charging, channelling, shielding, parrying).
 *
 * Transitions are guarded by explicit rule tables so restrictions (no casting mid-roll,
 * dodge-cancel windows, dash-casting) live in one place instead of scattered ifs.
 */

export type MoveState = 'ground' | 'air' | 'dodge' | 'dash' | 'stagger' | 'dead';
export type ActionState = 'idle' | 'windup' | 'release' | 'recover' | 'charging' | 'channeling' | 'shielding' | 'parrying' | 'ultimate';

/**
 * Which action states may be *started* while in each movement state. Continuations of an
 * action already under way (windup → release → recover) are always allowed.
 */
const ACTION_ENTRY: Record<MoveState, ReadonlySet<ActionState>> = {
	ground: new Set(['windup', 'release', 'recover', 'charging', 'channeling', 'shielding', 'parrying', 'ultimate']),
	air: new Set(['windup', 'release', 'recover', 'charging', 'shielding', 'parrying', 'ultimate']),
	// Dash-casting: spells fired mid-dash skip their wind-up.
	dash: new Set(['release', 'recover']),
	dodge: new Set([]),
	stagger: new Set([]),
	dead: new Set([])
};

/** Allowed action-layer transitions. */
const ACTION_NEXT: Record<ActionState, ReadonlySet<ActionState>> = {
	idle: new Set(['windup', 'release', 'charging', 'channeling', 'shielding', 'parrying', 'ultimate']),
	windup: new Set(['release', 'idle']),
	release: new Set(['recover', 'idle']),
	// Recovery can chain straight into the next combo cast or any defensive action.
	recover: new Set(['idle', 'windup', 'release', 'charging', 'shielding', 'parrying']),
	charging: new Set(['release', 'idle']),
	channeling: new Set(['idle', 'recover']),
	shielding: new Set(['idle', 'parrying']),
	parrying: new Set(['idle', 'shielding']),
	ultimate: new Set(['idle', 'recover'])
};

/** Transitions that continue an action already started. */
const CONTINUATION: Partial<Record<ActionState, ReadonlySet<ActionState>>> = {
	windup: new Set(['release']),
	release: new Set(['recover']),
	charging: new Set(['release']),
	channeling: new Set(['recover']),
	ultimate: new Set(['recover'])
};

/** Action states a dodge may cancel out of (and how far into them, 0..1 of the phase). */
const DODGE_CANCEL: Partial<Record<ActionState, number>> = {
	idle: 0,
	windup: 0,
	recover: 0.15,
	charging: 0,
	shielding: 0,
	parrying: 0.5
};

/** Movement speed multiplier per action. */
export const ACTION_MOVE_MULT: Record<ActionState, number> = {
	idle: 1,
	windup: 0.75,
	release: 0.75,
	recover: 0.85,
	charging: 0.5,
	channeling: 0.4,
	shielding: 0.45,
	parrying: 0.3,
	ultimate: 0
};

export class PlayerStateMachine {
	move: MoveState = 'ground';
	action: ActionState = 'idle';
	/** Seconds spent in the current movement / action state. */
	moveTime = 0;
	actionTime = 0;
	/** Duration of the current action phase (for progress), 0 = open-ended. */
	actionDuration = 0;
	moveDuration = 0;
	onActionChange?: (from: ActionState, to: ActionState) => void;

	update(dt: number): void {
		this.moveTime += dt;
		this.actionTime += dt;
	}

	get actionProgress(): number {
		return this.actionDuration > 0 ? Math.min(1, this.actionTime / this.actionDuration) : 0;
	}

	get moveProgress(): number {
		return this.moveDuration > 0 ? Math.min(1, this.moveTime / this.moveDuration) : 0;
	}

	canEnterAction(next: ActionState): boolean {
		if (next === 'idle') return true;
		if (!ACTION_NEXT[this.action].has(next)) return false;
		// Continuing the current action ignores movement restrictions.
		if (CONTINUATION[this.action]?.has(next)) return true;
		return ACTION_ENTRY[this.move].has(next);
	}

	setAction(next: ActionState, duration = 0, force = false): boolean {
		if (!force && !this.canEnterAction(next)) return false;
		const prev = this.action;
		this.action = next;
		this.actionTime = 0;
		this.actionDuration = duration;
		if (prev !== next) this.onActionChange?.(prev, next);
		return true;
	}

	/** True when the hands are free to start something new this step. */
	get handsFree(): boolean {
		return this.action === 'idle' || (this.action === 'recover' && this.actionTime > 0.06);
	}

	canDodge(): boolean {
		if (this.move === 'dodge' || this.move === 'stagger' || this.move === 'dead') return false;
		if (this.move === 'dash' && this.moveProgress < 0.7) return false;
		const gate = DODGE_CANCEL[this.action];
		if (gate === undefined) return false;
		return this.actionProgress >= gate;
	}

	setMove(next: MoveState, duration = 0): void {
		if (this.move === 'dead' && next !== 'ground') return;
		this.move = next;
		this.moveTime = 0;
		this.moveDuration = duration;
		// Entering a state that forbids the current action drops it.
		if (next === 'dodge' || next === 'stagger' || next === 'dead') {
			if (this.action !== 'idle') this.setAction('idle', 0, true);
		}
	}

	get canMove(): boolean {
		return this.move !== 'stagger' && this.move !== 'dead' && this.action !== 'ultimate';
	}

	get moveMult(): number {
		return ACTION_MOVE_MULT[this.action];
	}

	/** Casting, charging or channelling — vulnerable to interruption. */
	get vulnerableCast(): boolean {
		return this.action === 'windup' || this.action === 'charging' || this.action === 'channeling';
	}

	reset(): void {
		this.move = 'ground';
		this.action = 'idle';
		this.moveTime = this.actionTime = 0;
		this.actionDuration = this.moveDuration = 0;
	}
}
