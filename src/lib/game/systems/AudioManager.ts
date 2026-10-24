import type * as THREE from 'three';
import type { Element } from '../combat/types';
import type { RegionId } from '../world/WorldLayout';

interface PlayOpts {
	volume?: number;
	pitch?: number;
}

type MusicMood = 'explore' | 'combat' | 'boss' | 'menu' | 'victory';

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

// Mood progressions (MIDI chord roots + voicings).
const PROGRESSIONS: Record<RegionId | 'menu', number[][]> = {
	menu: [
		[50, 57, 62, 66],
		[47, 54, 59, 62],
		[43, 50, 55, 59],
		[45, 52, 57, 61]
	],
	hollow: [
		[48, 55, 60, 64],
		[45, 52, 57, 60],
		[41, 48, 53, 57],
		[43, 50, 55, 59]
	],
	vale: [
		[50, 57, 62, 65],
		[46, 53, 58, 62],
		[48, 55, 60, 64],
		[45, 52, 57, 60]
	],
	forest: [
		[45, 52, 57, 64],
		[48, 55, 60, 67],
		[43, 50, 55, 62],
		[50, 57, 62, 69]
	],
	highlands: [
		[52, 59, 64, 68],
		[49, 56, 61, 64],
		[45, 52, 57, 64],
		[47, 54, 59, 63]
	],
	sanctuary: [
		[41, 48, 53, 56],
		[39, 46, 51, 55],
		[44, 51, 56, 59],
		[43, 50, 55, 58]
	]
};

const BOSS_BASS = [38, 38, 41, 38, 36, 36, 39, 41];
const MIN_GAP: Record<string, number> = { step: 0.05, enemy_hit: 0.03, exp: 0.03, impact_ice: 0.03, impact_fire: 0.04, impact_lightning: 0.04, impact_wind: 0.04, step_water: 0.08 };

/**
 * Fully procedural audio (no sample files): synthesized spell, impact and creature sounds
 * with simple positional panning/attenuation, looping layers for charging, channelling and
 * tornadoes, regional ambience, and a small generative score with combat and boss layers.
 */
export class AudioManager {
	private ctx: AudioContext | null = null;
	private master!: GainNode;
	private sfxBus!: GainNode;
	private musicBus!: GainNode;
	private ambBus!: GainNode;
	private noiseBuf!: AudioBuffer;
	private volumes = { master: 0.8, sfx: 0.9, music: 0.5 };
	private last = new Map<string, number>();
	private listener = { x: 0, y: 0, z: 0, yaw: 0 };
	// loops
	private charge: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
	private tornado: { src: AudioBufferSourceNode; gain: GainNode; filter: BiquadFilterNode; lfo: OscillatorNode } | null = null;
	private channel: { osc: OscillatorNode; src: AudioBufferSourceNode; gain: GainNode } | null = null;
	private beamLoop: { osc: OscillatorNode; gain: GainNode } | null = null;
	// ambience
	private windGain!: GainNode;
	private windFilter!: BiquadFilterNode;
	private droneGain!: GainNode;
	private droneOsc: OscillatorNode[] = [];
	private waterGain!: GainNode;
	private region: RegionId | 'menu' = 'menu';
	private nextChirp = 0;
	// music
	private mood: MusicMood = 'menu';
	private nextBeat = 0;
	private beat = 0;
	private chordIdx = 0;
	private combatLevel = 0;
	private bossPhase = 1;
	private suspended = false;

	get ready(): boolean {
		return !!this.ctx;
	}

	/** Must be called from a user gesture. */
	start(): void {
		if (this.ctx) {
			void this.ctx.resume();
			return;
		}
		const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
		if (!AC) return;
		const ctx = new AC();
		this.ctx = ctx;
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = -14;
		comp.ratio.value = 5;
		comp.attack.value = 0.003;
		comp.release.value = 0.2;
		comp.connect(ctx.destination);
		this.master = ctx.createGain();
		this.master.connect(comp);
		this.sfxBus = ctx.createGain();
		this.musicBus = ctx.createGain();
		this.ambBus = ctx.createGain();
		// A short synthetic reverb shared by music and some effects.
		const verb = ctx.createConvolver();
		verb.buffer = this.makeImpulse(2.4);
		const verbGain = ctx.createGain();
		verbGain.gain.value = 0.28;
		verb.connect(verbGain).connect(this.master);
		this.sfxBus.connect(this.master);
		this.sfxBus.connect(verb);
		this.musicBus.connect(this.master);
		this.musicBus.connect(verb);
		this.ambBus.connect(this.master);
		this.applyVolumes();

		const len = ctx.sampleRate * 2;
		this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
		const data = this.noiseBuf.getChannelData(0);
		for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

		// Ambient wind bed.
		const wind = ctx.createBufferSource();
		wind.buffer = this.noiseBuf;
		wind.loop = true;
		this.windFilter = ctx.createBiquadFilter();
		this.windFilter.type = 'bandpass';
		this.windFilter.frequency.value = 500;
		this.windFilter.Q.value = 0.6;
		this.windGain = ctx.createGain();
		this.windGain.gain.value = 0;
		wind.connect(this.windFilter).connect(this.windGain).connect(this.ambBus);
		wind.start();
		// Waterfall/river rush.
		const water = ctx.createBufferSource();
		water.buffer = this.noiseBuf;
		water.loop = true;
		water.playbackRate.value = 0.7;
		const wf = ctx.createBiquadFilter();
		wf.type = 'lowpass';
		wf.frequency.value = 1400;
		this.waterGain = ctx.createGain();
		this.waterGain.gain.value = 0;
		water.connect(wf).connect(this.waterGain).connect(this.ambBus);
		water.start();
		// Low drone for ruins.
		this.droneGain = ctx.createGain();
		this.droneGain.gain.value = 0;
		const df = ctx.createBiquadFilter();
		df.type = 'lowpass';
		df.frequency.value = 400;
		df.connect(this.droneGain).connect(this.ambBus);
		for (const f of [55, 82.4, 110.5]) {
			const o = ctx.createOscillator();
			o.type = 'sawtooth';
			o.frequency.value = f;
			const g = ctx.createGain();
			g.gain.value = 0.15;
			o.connect(g).connect(df);
			o.start();
			this.droneOsc.push(o);
		}
		this.nextBeat = ctx.currentTime + 0.2;
	}

	private makeImpulse(seconds: number): AudioBuffer {
		const ctx = this.ctx!;
		const len = Math.floor(ctx.sampleRate * seconds);
		const buf = ctx.createBuffer(2, len, ctx.sampleRate);
		for (let c = 0; c < 2; c++) {
			const d = buf.getChannelData(c);
			for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
		}
		return buf;
	}

	setVolumes(master: number, sfx: number, music: number): void {
		this.volumes = { master, sfx, music };
		this.applyVolumes();
	}

	private applyVolumes(): void {
		if (!this.ctx) return;
		this.master.gain.value = this.volumes.master;
		this.sfxBus.gain.value = this.volumes.sfx;
		this.musicBus.gain.value = this.volumes.music * 0.55;
		this.ambBus.gain.value = this.volumes.sfx * 0.8;
	}

	suspend(): void {
		this.suspended = true;
		void this.ctx?.suspend();
	}

	resume(): void {
		this.suspended = false;
		void this.ctx?.resume();
	}

	setListener(pos: THREE.Vector3, yaw: number): void {
		this.listener.x = pos.x;
		this.listener.y = pos.y;
		this.listener.z = pos.z;
		this.listener.yaw = yaw;
	}

	// ------------------------------------------------------------------ synthesis helpers

	private out(pan: number, gain: number): GainNode {
		const ctx = this.ctx!;
		const g = ctx.createGain();
		g.gain.value = gain;
		if (pan !== 0 && ctx.createStereoPanner) {
			const p = ctx.createStereoPanner();
			p.pan.value = pan;
			g.connect(p).connect(this.sfxBus);
		} else g.connect(this.sfxBus);
		return g;
	}

	private tone(dest: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, dur: number, vol: number, attack = 0.005): void {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(f0, t);
		if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(vol, t + attack);
		g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
		o.connect(g).connect(dest);
		o.start(t);
		o.stop(t + dur + 0.05);
	}

	private noise(dest: AudioNode, t: number, dur: number, vol: number, type: BiquadFilterType, f0: number, f1 = f0, q = 1, attack = 0.004, rate = 1): void {
		const ctx = this.ctx!;
		const src = ctx.createBufferSource();
		src.buffer = this.noiseBuf;
		src.playbackRate.value = rate;
		const f = ctx.createBiquadFilter();
		f.type = type;
		f.frequency.setValueAtTime(f0, t);
		if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
		f.Q.value = q;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(vol, t + attack);
		g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
		src.connect(f).connect(g).connect(dest);
		const off = Math.random() * 1.5;
		src.start(t, off);
		src.stop(t + dur + 0.05);
	}

	private chime(dest: AudioNode, t: number, freqs: number[], dur: number, vol: number, type: OscillatorType = 'sine'): void {
		for (const f of freqs) this.tone(dest, type, f * (1 + (Math.random() - 0.5) * 0.01), f, t, dur * (0.7 + Math.random() * 0.5), vol / freqs.length, 0.002);
	}

	// ------------------------------------------------------------------ one-shots

	sfx(name: string, pos?: THREE.Vector3, opts: PlayOpts = {}): void {
		const ctx = this.ctx;
		if (!ctx || this.suspended) return;
		const now = ctx.currentTime;
		const gap = MIN_GAP[name];
		if (gap !== undefined) {
			const l = this.last.get(name) ?? 0;
			if (now - l < gap) return;
			this.last.set(name, now);
		}
		let vol = opts.volume ?? 1;
		let pan = 0;
		if (pos) {
			const dx = pos.x - this.listener.x;
			const dy = pos.y - this.listener.y;
			const dz = pos.z - this.listener.z;
			const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (d > 70) return;
			vol *= 1 / (1 + Math.max(0, d - 4) * 0.08);
			// Camera right = (cos yaw, -sin yaw) in xz.
			const rx = Math.cos(this.listener.yaw);
			const rz = -Math.sin(this.listener.yaw);
			pan = d > 0.5 ? Math.max(-0.8, Math.min(0.8, (dx * rx + dz * rz) / d)) : 0;
		}
		if (vol < 0.01) return;
		const p = opts.pitch ?? 1;
		const o = this.out(pan, vol);
		const t = now + 0.005;
		switch (name) {
			// --- casting
			case 'cast_fire':
				this.noise(o, t, 0.32, 0.55, 'bandpass', 500 * p, 2200 * p, 1.2, 0.02);
				this.tone(o, 'sine', 160 * p, 60, t, 0.25, 0.4);
				this.noise(o, t + 0.05, 0.15, 0.2, 'highpass', 3000, 3000, 1);
				break;
			case 'cast_ice':
				this.chime(o, t, [1760 * p, 2637 * p, 3520 * p], 0.45, 0.35);
				this.noise(o, t, 0.25, 0.25, 'highpass', 5000, 8000, 0.7, 0.01);
				break;
			case 'cast_lightning':
				this.noise(o, t, 0.08, 0.6, 'highpass', 2500, 2500, 0.8, 0.001);
				this.tone(o, 'square', 1200 * p, 180, t, 0.14, 0.18);
				this.tone(o, 'sawtooth', 90, 60, t, 0.2, 0.2);
				break;
			case 'cast_wind':
				this.noise(o, t, 0.35, 0.6, 'bandpass', 1400 * p, 350, 1.4, 0.04);
				this.tone(o, 'sine', 500 * p, 900 * p, t, 0.18, 0.06);
				break;
			case 'cast_arcane':
			case 'cast_shadow':
				this.chime(o, t, [660 * p, 990 * p, 1320 * p], 0.5, 0.3);
				break;
			// --- impacts
			case 'impact_fire':
				this.noise(o, t, 0.4, 0.6, 'lowpass', 1200 * p, 200, 0.8, 0.002);
				this.tone(o, 'sine', 110 * p, 40, t, 0.3, 0.5);
				for (let i = 0; i < 4; i++) this.noise(o, t + 0.05 + Math.random() * 0.25, 0.03, 0.15, 'highpass', 4000, 4000, 1);
				break;
			case 'impact_ice':
				this.chime(o, t, [2100 * p, 3150 * p, 4300 * p, 5200 * p], 0.35, 0.4, 'triangle');
				this.noise(o, t, 0.12, 0.3, 'highpass', 4000, 6000, 0.7, 0.001);
				break;
			case 'impact_lightning':
				this.noise(o, t, 0.05, 0.7, 'highpass', 3000, 3000, 0.7, 0.001);
				this.noise(o, t + 0.02, 0.35, 0.5, 'lowpass', 900, 120, 0.7, 0.002);
				this.tone(o, 'square', 800 * p, 120, t, 0.08, 0.12);
				break;
			case 'impact_wind':
				this.noise(o, t, 0.25, 0.5, 'bandpass', 1800 * p, 500, 1.6, 0.003);
				break;
			case 'impact_shadow':
			case 'impact_crystal':
			case 'impact_arcane':
			case 'impact_physical':
				this.tone(o, 'sine', 320 * p, 120, t, 0.3, 0.4);
				this.noise(o, t, 0.2, 0.35, 'bandpass', 900, 300, 1.2);
				if (name === 'impact_crystal') this.chime(o, t, [1500, 2250], 0.3, 0.2);
				break;
			case 'explosion':
				this.tone(o, 'sine', 90, 28, t, 0.9, 0.9, 0.003);
				this.noise(o, t, 1.1, 0.8, 'lowpass', 1600, 120, 0.7, 0.003);
				this.noise(o, t, 0.3, 0.4, 'highpass', 2000, 800, 0.7, 0.001);
				for (let i = 0; i < 8; i++) this.noise(o, t + 0.1 + Math.random() * 0.7, 0.03, 0.12, 'highpass', 5000, 5000, 1);
				break;
			case 'nova':
				this.chime(o, t, [880, 1320, 1760, 2640, 3520], 0.9, 0.5, 'triangle');
				this.noise(o, t, 0.6, 0.5, 'bandpass', 3000, 400, 1.2, 0.01);
				this.tone(o, 'sine', 120, 50, t, 0.6, 0.5);
				break;
			case 'sigil':
				this.tone(o, 'triangle', 300, 900, t, 0.35, 0.18, 0.02);
				this.noise(o, t, 0.3, 0.15, 'highpass', 3000, 6000, 0.7, 0.05);
				break;
			// --- reactions
			case 'reaction_steam':
				this.noise(o, t, 0.8, 0.7, 'highpass', 3000, 6000, 0.6, 0.01);
				this.noise(o, t, 0.5, 0.4, 'bandpass', 600, 2000, 1, 0.005);
				this.tone(o, 'sine', 220, 440, t, 0.3, 0.2);
				break;
			case 'reaction_zap':
				for (let i = 0; i < 7; i++) this.tone(o, 'square', 600 + Math.random() * 1600, 120, t + i * 0.035, 0.07, 0.12);
				this.noise(o, t, 0.4, 0.5, 'highpass', 2500, 1500, 0.7, 0.002);
				this.tone(o, 'sawtooth', 70, 50, t, 0.4, 0.3);
				break;
			case 'reaction_shatter':
				for (let i = 0; i < 8; i++) this.chime(o, t + Math.random() * 0.12, [1800 + Math.random() * 3000], 0.3, 0.3, 'triangle');
				this.noise(o, t, 0.3, 0.6, 'highpass', 3000, 7000, 0.8, 0.001);
				this.tone(o, 'sine', 140, 60, t, 0.3, 0.4);
				break;
			case 'reaction_fire_tornado':
				this.noise(o, t, 1.2, 0.8, 'lowpass', 300, 1200, 0.9, 0.1);
				this.tone(o, 'sawtooth', 80, 140, t, 1.0, 0.2, 0.1);
				break;
			// --- movement
			case 'jump':
				this.noise(o, t, 0.12, 0.25, 'bandpass', 900, 1600, 1, 0.005);
				break;
			case 'double_jump':
				this.chime(o, t, [880, 1320], 0.25, 0.25);
				this.chime(o, t + 0.06, [1760], 0.25, 0.15);
				this.noise(o, t, 0.2, 0.25, 'bandpass', 1200, 2400, 1, 0.01);
				break;
			case 'dodge':
				this.noise(o, t, 0.22, 0.5, 'bandpass', 1400, 400, 1.6, 0.02);
				break;
			case 'dash':
				this.noise(o, t, 0.3, 0.6, 'bandpass', 2400, 500, 1.8, 0.01);
				this.chime(o, t, [1320, 1980], 0.3, 0.15);
				break;
			case 'land':
				this.noise(o, t, 0.15, 0.4, 'lowpass', 500, 200, 0.7, 0.002);
				break;
			case 'step':
				this.noise(o, t, 0.05, 0.25, 'lowpass', 900 + Math.random() * 400, 300, 0.7, 0.002);
				break;
			case 'step_water':
				this.noise(o, t, 0.12, 0.3, 'bandpass', 1500, 600, 1, 0.003);
				break;
			case 'splash':
				this.noise(o, t, 0.5, 0.6, 'bandpass', 1200, 400, 0.8, 0.003);
				break;
			// --- defence
			case 'parry':
				this.chime(o, t, [1200, 1800, 2400, 3600], 1.2, 0.7, 'triangle');
				this.noise(o, t, 0.1, 0.5, 'highpass', 4000, 4000, 0.7, 0.001);
				this.tone(o, 'sine', 200, 60, t, 0.5, 0.4);
				break;
			case 'parry_swing':
				this.noise(o, t, 0.15, 0.35, 'bandpass', 2400, 900, 1.6, 0.01);
				break;
			case 'block':
				this.tone(o, 'triangle', 420, 300, t, 0.25, 0.4);
				this.chime(o, t, [1400, 2100], 0.3, 0.2);
				this.noise(o, t, 0.08, 0.3, 'bandpass', 2000, 1000, 1, 0.001);
				break;
			case 'guard_break':
				this.noise(o, t, 0.4, 0.7, 'highpass', 2500, 800, 0.7, 0.001);
				this.tone(o, 'sawtooth', 200, 50, t, 0.5, 0.35);
				break;
			case 'shield_up':
				this.tone(o, 'sine', 300, 900, t, 0.25, 0.25, 0.02);
				this.noise(o, t, 0.2, 0.15, 'highpass', 3000, 6000, 0.7, 0.03);
				break;
			case 'shield_down':
				this.tone(o, 'sine', 700, 250, t, 0.2, 0.15, 0.01);
				break;
			// --- player
			case 'player_hurt':
				this.noise(o, t, 0.2, 0.6, 'lowpass', 1200, 300, 0.8, 0.002);
				this.tone(o, 'sine', 160, 80, t, 0.2, 0.4);
				break;
			case 'player_death':
				this.tone(o, 'sine', 300, 60, t, 1.6, 0.5, 0.02);
				this.tone(o, 'triangle', 450, 90, t, 1.6, 0.3, 0.02);
				break;
			case 'swap':
				this.chime(o, t, [660 * p, 990 * p], 0.3, 0.3);
				this.noise(o, t, 0.12, 0.1, 'highpass', 4000, 4000, 0.7);
				break;
			case 'potion':
				for (let i = 0; i < 4; i++) this.tone(o, 'sine', 300 + i * 120, 500 + i * 120, t + i * 0.07, 0.07, 0.2);
				this.chime(o, t + 0.3, [1320, 1760, 2640], 0.6, 0.35);
				break;
			case 'fizzle':
				this.noise(o, t, 0.2, 0.35, 'bandpass', 2000, 600, 1, 0.003);
				this.tone(o, 'sine', 500, 200, t, 0.2, 0.15);
				break;
			case 'ultimate_ready':
				this.chime(o, t, [523, 659, 784, 1047], 1.2, 0.5);
				break;
			case 'ultimate':
				this.tone(o, 'sawtooth', 55, 110, t, 2.5, 0.35, 0.5);
				this.chime(o, t + 0.2, [523, 784, 1047, 1568], 2.5, 0.6);
				this.noise(o, t, 2.4, 0.4, 'bandpass', 200, 3000, 0.6, 1.2);
				break;
			// --- enemies
			case 'enemy_hit':
				this.noise(o, t, 0.08, 0.45, 'bandpass', 1200 * p, 600, 1, 0.001);
				this.tone(o, 'sine', 220 * p, 110, t, 0.1, 0.3);
				break;
			case 'crit':
				this.noise(o, t, 0.1, 0.6, 'bandpass', 2400, 900, 1, 0.001);
				this.tone(o, 'triangle', 900, 300, t, 0.15, 0.3);
				this.chime(o, t, [2400, 3600], 0.25, 0.25);
				break;
			case 'stagger':
				this.tone(o, 'sine', 180, 70, t, 0.4, 0.5);
				this.chime(o, t + 0.05, [990, 1485], 0.4, 0.25);
				break;
			case 'alert_wraith':
				this.wail(o, t, 900, 1500, 0.45, 0.3);
				break;
			case 'alert_golem':
				this.growl(o, t, 55, 0.8, 0.6);
				break;
			case 'alert_mage':
				this.noise(o, t, 0.5, 0.35, 'bandpass', 700, 1400, 4, 0.05);
				this.tone(o, 'sine', 330, 360, t, 0.5, 0.15, 0.05);
				break;
			case 'windup_wraith':
				this.noise(o, t, 0.4, 0.4, 'highpass', 2000 * p, 5000, 0.8, 0.2);
				this.wail(o, t, 700 * p, 1300 * p, 0.35, 0.18);
				break;
			case 'windup_golem':
				this.growl(o, t, 45, 1.0, 0.6);
				this.noise(o, t, 1.0, 0.35, 'lowpass', 200, 600, 0.8, 0.6);
				break;
			case 'windup_mage':
				this.tone(o, 'sine', 440, 880, t, 0.5, 0.18, 0.2);
				this.tone(o, 'sine', 554, 1108, t, 0.5, 0.12, 0.2);
				break;
			case 'swing_wraith':
				this.noise(o, t, 0.2, 0.6, 'bandpass', 2600 * p, 700, 2, 0.01);
				break;
			case 'swing_golem':
				this.noise(o, t, 0.35, 0.6, 'bandpass', 600, 150, 1.2, 0.02);
				break;
			case 'golem_slam':
				this.tone(o, 'sine', 70, 25, t, 1.0, 1.0, 0.002);
				this.noise(o, t, 1.2, 0.8, 'lowpass', 900, 80, 0.6, 0.002);
				this.chime(o, t + 0.05, [1500, 2200, 2900], 0.6, 0.25, 'triangle');
				break;
			case 'mage_chant':
				this.tone(o, 'sine', 220, 230, t, 0.9, 0.12, 0.3);
				this.tone(o, 'sine', 277, 290, t, 0.9, 0.1, 0.3);
				this.noise(o, t, 0.8, 0.12, 'bandpass', 1200, 900, 6, 0.3);
				break;
			case 'mage_bolt':
				this.tone(o, 'sawtooth', 300, 150, t, 0.18, 0.15);
				this.noise(o, t, 0.15, 0.2, 'bandpass', 900, 500, 2);
				break;
			case 'hex_cast':
				this.tone(o, 'square', 1400, 700, t, 0.15, 0.12);
				this.tone(o, 'square', 1470, 735, t, 0.15, 0.12);
				break;
			case 'void_burst':
				this.tone(o, 'sine', 120, 40, t, 0.6, 0.6);
				this.noise(o, t, 0.5, 0.5, 'lowpass', 700, 150, 1, 0.002);
				break;
			case 'blink':
				this.noise(o, t, 0.3, 0.4, 'bandpass', 600, 3000, 3, 0.01);
				this.tone(o, 'sine', 1200, 300, t, 0.25, 0.15);
				break;
			case 'barrier_up':
				this.tone(o, 'triangle', 400, 1200, t, 0.4, 0.2, 0.05);
				this.chime(o, t + 0.2, [1600, 2400], 0.4, 0.2);
				break;
			case 'barrier_break':
				for (let i = 0; i < 6; i++) this.chime(o, t + Math.random() * 0.1, [2000 + Math.random() * 2500], 0.3, 0.3, 'triangle');
				this.noise(o, t, 0.25, 0.5, 'highpass', 3000, 6000, 0.8, 0.001);
				break;
			case 'wraith_evade':
				this.noise(o, t, 0.2, 0.4, 'bandpass', 2000, 900, 2, 0.01);
				break;
			case 'death_wraith':
				this.wail(o, t, 900, 180, 1.2, 0.4);
				this.noise(o, t, 1.0, 0.3, 'highpass', 2000, 6000, 0.7, 0.05);
				break;
			case 'death_golem':
				this.noise(o, t, 1.6, 0.9, 'lowpass', 800, 60, 0.6, 0.01);
				for (let i = 0; i < 6; i++) this.tone(o, 'sine', 90 - i * 8, 40, t + i * 0.15, 0.3, 0.35);
				this.chime(o, t, [1300, 1950, 2600], 1.2, 0.3, 'triangle');
				break;
			case 'death_mage':
				this.wail(o, t, 1200, 300, 0.9, 0.3);
				this.chime(o, t + 0.1, [880, 1320, 1760], 0.9, 0.25);
				break;
			// --- world & UI
			case 'lock':
				this.tone(o, 'triangle', 1200, 1600, t, 0.08, 0.2);
				break;
			case 'ui_soft':
				this.tone(o, 'sine', 800, 600, t, 0.08, 0.15);
				break;
			case 'ui_click':
				this.tone(o, 'triangle', 900, 1100, t, 0.06, 0.2);
				break;
			case 'ui_hover':
				this.tone(o, 'sine', 1400, 1500, t, 0.04, 0.06);
				break;
			case 'ui_open':
				this.chime(o, t, [660, 990], 0.3, 0.2);
				break;
			case 'exp':
				this.tone(o, 'sine', 1800 * p, 2400 * p, t, 0.08, 0.15);
				break;
			case 'orb':
				this.chime(o, t, [1100 * p, 1650 * p], 0.25, 0.25);
				break;
			case 'pickup':
				this.chime(o, t, [880, 1320], 0.25, 0.3);
				this.chime(o, t + 0.08, [1760], 0.3, 0.2);
				break;
			case 'level_up':
				[523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(o, 'triangle', f, f, t + i * 0.09, 0.8, 0.22));
				this.chime(o, t + 0.5, [1047, 1568, 2093], 1.5, 0.4);
				break;
			case 'quest':
				[659, 784, 988].forEach((f, i) => this.tone(o, 'sine', f, f, t + i * 0.12, 0.7, 0.25));
				break;
			case 'chest':
				this.noise(o, t, 0.3, 0.3, 'bandpass', 400, 200, 3, 0.05);
				this.chime(o, t + 0.25, [784, 1175, 1568, 2349], 1.0, 0.45);
				break;
			case 'waystone':
				this.tone(o, 'sine', 110, 110, t, 2.0, 0.4, 0.3);
				this.chime(o, t + 0.2, [440, 660, 880, 1320], 2.0, 0.45);
				break;
			case 'crystal':
				this.chime(o, t, [1047, 1568, 2093, 3136], 1.8, 0.55);
				this.tone(o, 'sine', 262, 262, t, 1.8, 0.2, 0.2);
				break;
			case 'seal':
				this.tone(o, 'sine', 55, 40, t, 3.0, 0.8, 0.05);
				this.noise(o, t, 2.5, 0.6, 'lowpass', 600, 80, 0.6, 0.05);
				[262, 330, 392, 523].forEach((f, i) => this.tone(o, 'triangle', f, f, t + 0.4 + i * 0.15, 2.5, 0.2, 0.3));
				break;
			case 'lore':
				this.chime(o, t, [523, 784], 1.2, 0.3);
				break;
			case 'talk':
				this.tone(o, 'sine', 500, 600, t, 0.1, 0.12);
				break;
			// --- boss
			case 'boss_roar':
				this.growl(o, t, 42, 2.2, 1.0);
				this.noise(o, t, 2.0, 0.6, 'bandpass', 300, 900, 1.5, 0.3);
				this.chime(o, t + 0.3, [1100, 1650, 2200], 1.6, 0.3, 'triangle');
				break;
			case 'boss_slam':
				this.tone(o, 'sine', 60, 22, t, 1.4, 1.2, 0.002);
				this.noise(o, t, 1.4, 1.0, 'lowpass', 1000, 60, 0.6, 0.002);
				this.chime(o, t + 0.05, [1600, 2400, 3200], 0.8, 0.3, 'triangle');
				break;
			case 'boss_charge':
				this.tone(o, 'sawtooth', 80, 320, t, 1.4, 0.3, 0.6);
				this.noise(o, t, 1.4, 0.4, 'bandpass', 300, 3000, 2, 0.8);
				break;
			case 'boss_death':
				this.growl(o, t, 40, 3.0, 1.0);
				this.noise(o, t, 3.5, 0.9, 'lowpass', 1200, 50, 0.6, 0.05);
				for (let i = 0; i < 14; i++) this.chime(o, t + i * 0.18, [1200 + Math.random() * 2400], 0.8, 0.3, 'triangle');
				break;
			case 'victory':
				[523, 659, 784, 1047].forEach((f, i) => this.tone(o, 'triangle', f, f, t + i * 0.15, 1.6, 0.25));
				this.chime(o, t + 0.7, [1047, 1319, 1568, 2093], 2.4, 0.5);
				break;
			default:
				this.tone(o, 'sine', 600 * p, 400 * p, t, 0.12, 0.2);
		}
	}

	/** Ghostly vibrato wail. */
	private wail(dest: AudioNode, t: number, f0: number, f1: number, dur: number, vol: number): void {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		o.type = 'sawtooth';
		o.frequency.setValueAtTime(f0, t);
		o.frequency.exponentialRampToValueAtTime(f1, t + dur);
		const lfo = ctx.createOscillator();
		lfo.frequency.value = 9;
		const lg = ctx.createGain();
		lg.gain.value = f0 * 0.04;
		lfo.connect(lg).connect(o.frequency);
		const f = ctx.createBiquadFilter();
		f.type = 'bandpass';
		f.frequency.value = (f0 + f1) * 0.7;
		f.Q.value = 3;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(vol, t + 0.05);
		g.gain.exponentialRampToValueAtTime(0.001, t + dur);
		o.connect(f).connect(g).connect(dest);
		o.start(t);
		lfo.start(t);
		o.stop(t + dur + 0.05);
		lfo.stop(t + dur + 0.05);
	}

	/** Deep, rough growl (golems, the boss). */
	private growl(dest: AudioNode, t: number, freq: number, dur: number, vol: number): void {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		o.type = 'sawtooth';
		o.frequency.setValueAtTime(freq * 1.3, t);
		o.frequency.exponentialRampToValueAtTime(freq, t + dur);
		const trem = ctx.createOscillator();
		trem.frequency.value = 22;
		const tg = ctx.createGain();
		tg.gain.value = 0.4;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(vol, t + 0.12);
		g.gain.exponentialRampToValueAtTime(0.001, t + dur);
		trem.connect(tg).connect(g.gain);
		const f = ctx.createBiquadFilter();
		f.type = 'lowpass';
		f.frequency.value = 500;
		f.Q.value = 4;
		o.connect(f).connect(g).connect(dest);
		o.start(t);
		trem.start(t);
		o.stop(t + dur + 0.05);
		trem.stop(t + dur + 0.05);
	}

	// ------------------------------------------------------------------ loops

	chargeStart(el: Element): void {
		const ctx = this.ctx;
		if (!ctx) return;
		this.chargeStop();
		const base = el === 'fire' ? 110 : el === 'ice' ? 220 : el === 'lightning' ? 165 : 147;
		const osc = ctx.createOscillator();
		osc.type = el === 'lightning' ? 'square' : 'sawtooth';
		osc.frequency.value = base;
		const osc2 = ctx.createOscillator();
		osc2.type = 'sine';
		osc2.frequency.value = base * 2.01;
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = 400;
		filter.Q.value = 6;
		const gain = ctx.createGain();
		gain.gain.value = 0;
		gain.gain.linearRampToValueAtTime(0.18, ctx.currentTime + 0.15);
		osc.connect(filter);
		osc2.connect(filter);
		filter.connect(gain).connect(this.sfxBus);
		osc.start();
		osc2.start();
		this.charge = { osc, osc2, gain, filter };
	}

	chargeLevel(c: number): void {
		if (!this.ctx || !this.charge) return;
		const t = this.ctx.currentTime;
		this.charge.filter.frequency.setTargetAtTime(400 + c * 3200, t, 0.05);
		this.charge.osc.detune.setTargetAtTime(c * 1200, t, 0.05);
		this.charge.osc2.detune.setTargetAtTime(c * 1200, t, 0.05);
		this.charge.gain.gain.setTargetAtTime(0.14 + c * 0.12, t, 0.05);
	}

	chargeStop(): void {
		if (!this.ctx || !this.charge) return;
		const c = this.charge;
		const t = this.ctx.currentTime;
		c.gain.gain.cancelScheduledValues(t);
		c.gain.gain.setTargetAtTime(0, t, 0.03);
		c.osc.stop(t + 0.2);
		c.osc2.stop(t + 0.2);
		this.charge = null;
	}

	tornadoStart(): void {
		const ctx = this.ctx;
		if (!ctx || this.tornado) return;
		const src = ctx.createBufferSource();
		src.buffer = this.noiseBuf;
		src.loop = true;
		const filter = ctx.createBiquadFilter();
		filter.type = 'bandpass';
		filter.frequency.value = 600;
		filter.Q.value = 1.4;
		const lfo = ctx.createOscillator();
		lfo.frequency.value = 3;
		const lg = ctx.createGain();
		lg.gain.value = 300;
		lfo.connect(lg).connect(filter.frequency);
		const gain = ctx.createGain();
		gain.gain.value = 0;
		gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.3);
		src.connect(filter).connect(gain).connect(this.sfxBus);
		src.start();
		lfo.start();
		this.tornado = { src, gain, filter, lfo };
	}

	tornadoStop(): void {
		if (!this.ctx || !this.tornado) return;
		const t = this.ctx.currentTime;
		this.tornado.gain.gain.setTargetAtTime(0, t, 0.15);
		this.tornado.src.stop(t + 0.8);
		this.tornado.lfo.stop(t + 0.8);
		this.tornado = null;
	}

	channelStart(): void {
		const ctx = this.ctx;
		if (!ctx) return;
		this.channelStop();
		const osc = ctx.createOscillator();
		osc.type = 'sawtooth';
		osc.frequency.value = 220;
		const src = ctx.createBufferSource();
		src.buffer = this.noiseBuf;
		src.loop = true;
		const f = ctx.createBiquadFilter();
		f.type = 'bandpass';
		f.frequency.value = 1800;
		f.Q.value = 2;
		const gain = ctx.createGain();
		gain.gain.value = 0;
		gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.1);
		osc.connect(f);
		src.connect(f);
		f.connect(gain).connect(this.sfxBus);
		osc.start();
		src.start();
		this.channel = { osc, src, gain };
	}

	channelStop(): void {
		if (!this.ctx || !this.channel) return;
		const t = this.ctx.currentTime;
		this.channel.gain.gain.setTargetAtTime(0, t, 0.05);
		this.channel.osc.stop(t + 0.3);
		this.channel.src.stop(t + 0.3);
		this.channel = null;
	}

	/** Boss beam hum (0 = off). */
	setBeam(level: number): void {
		const ctx = this.ctx;
		if (!ctx) return;
		if (level > 0 && !this.beamLoop) {
			const osc = ctx.createOscillator();
			osc.type = 'sawtooth';
			osc.frequency.value = 95;
			const f = ctx.createBiquadFilter();
			f.type = 'lowpass';
			f.frequency.value = 900;
			const gain = ctx.createGain();
			gain.gain.value = 0;
			osc.connect(f).connect(gain).connect(this.sfxBus);
			osc.start();
			this.beamLoop = { osc, gain };
		}
		if (this.beamLoop) {
			this.beamLoop.gain.gain.setTargetAtTime(level * 0.35, ctx.currentTime, 0.08);
			if (level <= 0) {
				this.beamLoop.osc.stop(ctx.currentTime + 0.4);
				this.beamLoop = null;
			}
		}
	}

	// ------------------------------------------------------------------ ambience & music

	setMood(mood: MusicMood, bossPhase = 1): void {
		this.mood = mood;
		this.bossPhase = bossPhase;
	}

	update(region: RegionId | 'menu', combat: number, nearWater: number, inRuins: boolean): void {
		const ctx = this.ctx;
		if (!ctx || this.suspended) return;
		const t = ctx.currentTime;
		this.region = region;
		this.combatLevel += (combat - this.combatLevel) * 0.05;
		// Ambience mix per region.
		const windTarget = region === 'highlands' ? 0.22 : region === 'sanctuary' ? 0.12 : region === 'forest' ? 0.05 : 0.1;
		this.windGain.gain.setTargetAtTime(windTarget, t, 0.8);
		this.windFilter.frequency.setTargetAtTime(region === 'highlands' ? 700 + Math.sin(t * 0.3) * 250 : 400 + Math.sin(t * 0.2) * 120, t, 0.5);
		this.waterGain.gain.setTargetAtTime(nearWater * 0.25, t, 0.5);
		this.droneGain.gain.setTargetAtTime(region === 'sanctuary' || inRuins ? 0.06 : 0, t, 1.5);
		// Birdsong / crickets / crystal chimes.
		if (t > this.nextChirp) {
			this.nextChirp = t + 1.5 + Math.random() * 4;
			const o = this.out((Math.random() - 0.5) * 1.4, 0.12);
			if (region === 'forest' || region === 'vale') {
				const f = 2200 + Math.random() * 1600;
				for (let i = 0; i < 3; i++) this.tone(o, 'sine', f, f * 1.25, t + i * 0.09, 0.07, 0.25);
			} else if (region === 'hollow') {
				for (let i = 0; i < 4; i++) this.tone(o, 'square', 4200, 4100, t + i * 0.05, 0.03, 0.05);
			} else if (region === 'highlands') this.chime(o, t, [1568 + Math.random() * 800], 2.2, 0.35, 'triangle');
			else if (region === 'sanctuary') this.tone(o, 'sine', 180 + Math.random() * 60, 120, t, 2.5, 0.25, 0.8);
		}
		this.scheduleMusic();
	}

	private scheduleMusic(): void {
		const ctx = this.ctx!;
		const bpm = this.mood === 'boss' ? 132 + this.bossPhase * 6 : this.mood === 'combat' ? 112 : 72;
		const spb = 60 / bpm;
		while (this.nextBeat < ctx.currentTime + 0.25) {
			this.playBeat(this.nextBeat, spb);
			this.nextBeat += spb;
			this.beat++;
		}
	}

	private playBeat(t: number, spb: number): void {
		const bar = 8;
		const step = this.beat % bar;
		const prog = PROGRESSIONS[this.mood === 'menu' ? 'menu' : this.region];
		if (step === 0) this.chordIdx = (this.chordIdx + 1) % prog.length;
		const chord = prog[this.chordIdx];
		const mus = this.musicBus;
		if (this.mood === 'boss') {
			// Driving ostinato, pounding drums, tense pad.
			const bass = BOSS_BASS[this.beat % BOSS_BASS.length] - 12;
			this.pluck(mus, midi(bass), t, spb * 0.9, 0.35, 'sawtooth', 600);
			if (step % 2 === 0) this.kick(mus, t, 0.6);
			if (step % 4 === 2) this.snare(mus, t, 0.35);
			this.hat(mus, t + spb / 2, 0.08);
			if (step === 0) for (const n of [50, 53, 57, 60 + (this.bossPhase > 2 ? 1 : 0)]) this.pad(mus, midi(n), t, spb * 8, 0.05);
			if (this.bossPhase >= 2 && step % 2 === 1) this.pluck(mus, midi(chord[3] + 12), t, spb * 0.5, 0.08, 'square', 2400);
			return;
		}
		if (this.mood === 'victory') {
			if (step === 0) for (const n of [60, 64, 67, 72]) this.pad(mus, midi(n), t, spb * 8, 0.06);
			if (step % 2 === 0) this.pluck(mus, midi([72, 76, 79, 84][step / 2]), t, spb * 2, 0.12, 'triangle', 3000);
			return;
		}
		// Exploration: soft pads and a wandering arpeggio; combat adds drums and bass.
		if (step === 0) for (let i = 0; i < 3; i++) this.pad(mus, midi(chord[i + 1]), t, spb * 8.5, 0.035);
		if (Math.random() < 0.55) this.pluck(mus, midi(chord[Math.floor(Math.random() * 4)] + 12), t, spb * 1.5, 0.05, 'triangle', 2600);
		const c = this.combatLevel;
		if (c > 0.15) {
			if (step % 2 === 0) this.kick(mus, t, 0.35 * c);
			if (step % 4 === 2) this.snare(mus, t, 0.2 * c);
			this.hat(mus, t + spb / 2, 0.05 * c);
			this.pluck(mus, midi(chord[0] - 12), t, spb * 0.8, 0.22 * c, 'sawtooth', 500);
		}
	}

	private pad(dest: AudioNode, f: number, t: number, dur: number, vol: number): void {
		const ctx = this.ctx!;
		const f1 = ctx.createBiquadFilter();
		f1.type = 'lowpass';
		f1.frequency.value = 1100;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
		g.gain.linearRampToValueAtTime(0, t + dur);
		f1.connect(g).connect(dest);
		for (const d of [-7, 7]) {
			const o = ctx.createOscillator();
			o.type = 'sawtooth';
			o.frequency.value = f;
			o.detune.value = d;
			o.connect(f1);
			o.start(t);
			o.stop(t + dur + 0.05);
		}
	}

	private pluck(dest: AudioNode, f: number, t: number, dur: number, vol: number, type: OscillatorType, cutoff: number): void {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.value = f;
		const fl = ctx.createBiquadFilter();
		fl.type = 'lowpass';
		fl.frequency.setValueAtTime(cutoff, t);
		fl.frequency.exponentialRampToValueAtTime(cutoff * 0.3, t + dur);
		const g = ctx.createGain();
		g.gain.setValueAtTime(vol, t);
		g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
		o.connect(fl).connect(g).connect(dest);
		o.start(t);
		o.stop(t + dur + 0.05);
	}

	private kick(dest: AudioNode, t: number, vol: number): void {
		this.tone(dest, 'sine', 140, 40, t, 0.3, vol, 0.002);
	}

	private snare(dest: AudioNode, t: number, vol: number): void {
		this.noise(dest, t, 0.18, vol, 'bandpass', 1800, 1200, 0.8, 0.001);
		this.tone(dest, 'triangle', 220, 160, t, 0.1, vol * 0.5, 0.001);
	}

	private hat(dest: AudioNode, t: number, vol: number): void {
		this.noise(dest, t, 0.05, vol, 'highpass', 7000, 7000, 0.8, 0.001);
	}

	dispose(): void {
		this.chargeStop();
		this.tornadoStop();
		this.channelStop();
		void this.ctx?.close();
		this.ctx = null;
	}
}
