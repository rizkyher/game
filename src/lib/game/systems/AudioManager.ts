export type Sfx =
	| 'bump'
	| 'thud'
	| 'boing'
	| 'pop'
	| 'clink'
	| 'shatter'
	| 'crunch'
	| 'splash'
	| 'chime'
	| 'tick'
	| 'combo'
	| 'whoosh'
	| 'sting'
	| 'squeak'
	| 'squawk'
	| 'squelch'
	| 'fanfare'
	| 'notify'
	| 'click'
	| 'knock'
	| 'yelp'
	| 'ring';

export type Ambience = 'meadow' | 'forest' | 'hive' | 'peaks';

interface PlayOpts {
	volume?: number;
	pitch?: number;
	pan?: number;
}

const MIN_GAP: Partial<Record<Sfx, number>> = { bump: 0.06, thud: 0.08, tick: 0.035, clink: 0.05, knock: 0.05, squeak: 0.15, yelp: 0.2 };

// C major pentatonic-friendly progression: C, Am, F, G
const CHORDS = [
	[60, 64, 67, 72],
	[57, 60, 64, 69],
	[53, 57, 60, 65],
	[55, 59, 62, 67]
];

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/**
 * Fully procedural audio: no sample files. Wing buzz is a filtered, amplitude-modulated
 * sawtooth pair; effects are short synthesized envelopes; music is a tiny generative loop.
 */
export class AudioManager {
	private ctx: AudioContext | null = null;
	private master!: GainNode;
	private sfxBus!: GainNode;
	private musicBus!: GainNode;
	private ambBus!: GainNode;
	private noise!: AudioBuffer;
	private buzzA!: OscillatorNode;
	private buzzB!: OscillatorNode;
	private buzzSub!: OscillatorNode;
	private buzzFilter!: BiquadFilterNode;
	private buzzGain!: GainNode;
	private windFilter!: BiquadFilterNode;
	private windGain!: GainNode;
	private humGain!: GainNode;
	private waterGain!: GainNode;
	private last = new Map<Sfx, number>();
	private volumes = { master: 0.8, sfx: 0.9, music: 0.45 };
	private ambience: Ambience = 'meadow';
	private nextChirp = 0;
	private nextBeat = 0;
	private beat = 0;
	private musicOn = true;
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
		comp.threshold.value = -16;
		comp.ratio.value = 4;
		comp.connect(ctx.destination);
		this.master = ctx.createGain();
		this.master.connect(comp);
		this.sfxBus = ctx.createGain();
		this.musicBus = ctx.createGain();
		this.ambBus = ctx.createGain();
		this.sfxBus.connect(this.master);
		this.musicBus.connect(this.master);
		this.ambBus.connect(this.master);
		this.applyVolumes();

		const len = ctx.sampleRate * 2;
		this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
		const data = this.noise.getChannelData(0);
		let b = 0;
		for (let i = 0; i < len; i++) {
			// Slightly pinkish noise.
			const w = Math.random() * 2 - 1;
			b = 0.97 * b + 0.03 * w;
			data[i] = w * 0.6 + b * 2.2;
		}

		// Wing buzz.
		this.buzzFilter = ctx.createBiquadFilter();
		this.buzzFilter.type = 'lowpass';
		this.buzzFilter.frequency.value = 900;
		this.buzzFilter.Q.value = 2;
		this.buzzGain = ctx.createGain();
		this.buzzGain.gain.value = 0;
		const am = ctx.createGain();
		am.gain.value = 0.75;
		const lfo = ctx.createOscillator();
		lfo.frequency.value = 38;
		const lfoDepth = ctx.createGain();
		lfoDepth.gain.value = 0.25;
		lfo.connect(lfoDepth).connect(am.gain);
		lfo.start();
		this.buzzA = ctx.createOscillator();
		this.buzzA.type = 'sawtooth';
		this.buzzB = ctx.createOscillator();
		this.buzzB.type = 'sawtooth';
		this.buzzB.detune.value = 14;
		this.buzzSub = ctx.createOscillator();
		this.buzzSub.type = 'triangle';
		const subGain = ctx.createGain();
		subGain.gain.value = 0.5;
		this.buzzA.connect(this.buzzFilter);
		this.buzzB.connect(this.buzzFilter);
		this.buzzSub.connect(subGain).connect(this.buzzFilter);
		this.buzzFilter.connect(am).connect(this.buzzGain).connect(this.sfxBus);
		for (const o of [this.buzzA, this.buzzB, this.buzzSub]) o.start();
		this.setBuzz(0.3, false);

		// Ambient wind bed.
		const wind = ctx.createBufferSource();
		wind.buffer = this.noise;
		wind.loop = true;
		this.windFilter = ctx.createBiquadFilter();
		this.windFilter.type = 'bandpass';
		this.windFilter.frequency.value = 420;
		this.windFilter.Q.value = 0.6;
		this.windGain = ctx.createGain();
		this.windGain.gain.value = 0.05;
		wind.connect(this.windFilter).connect(this.windGain).connect(this.ambBus);
		wind.start();

		// Water babble.
		const water = ctx.createBufferSource();
		water.buffer = this.noise;
		water.loop = true;
		water.playbackRate.value = 1.7;
		const wf = ctx.createBiquadFilter();
		wf.type = 'bandpass';
		wf.frequency.value = 1500;
		wf.Q.value = 1.2;
		this.waterGain = ctx.createGain();
		this.waterGain.gain.value = 0;
		water.connect(wf).connect(this.waterGain).connect(this.ambBus);
		water.start();

		// Hive hum drone.
		this.humGain = ctx.createGain();
		this.humGain.gain.value = 0;
		const humFilter = ctx.createBiquadFilter();
		humFilter.type = 'lowpass';
		humFilter.frequency.value = 500;
		humFilter.connect(this.humGain).connect(this.ambBus);
		for (const f of [110, 164.8, 220.5, 111.2]) {
			const o = ctx.createOscillator();
			o.type = 'sawtooth';
			o.frequency.value = f;
			const g = ctx.createGain();
			g.gain.value = 0.18;
			o.connect(g).connect(humFilter);
			o.start();
		}
		this.nextBeat = ctx.currentTime + 0.5;
	}

	private applyVolumes(): void {
		if (!this.ctx) return;
		this.master.gain.value = this.volumes.master;
		this.sfxBus.gain.value = this.volumes.sfx;
		this.ambBus.gain.value = this.volumes.sfx * 0.9;
		this.musicBus.gain.value = this.volumes.music * 0.5;
	}

	setVolumes(master: number, sfx: number, music: number): void {
		this.volumes = { master, sfx, music };
		this.musicOn = music > 0.001;
		this.applyVolumes();
	}

	suspend(): void {
		if (this.ctx && !this.suspended) {
			this.suspended = true;
			void this.ctx.suspend();
		}
	}

	resume(): void {
		if (this.ctx && this.suspended) {
			this.suspended = false;
			void this.ctx.resume();
		}
	}

	/** speed01: 0 hover .. 1 max boost. */
	setBuzz(speed01: number, boosting: boolean, muffled = 0): void {
		if (!this.ctx) return;
		const t = this.ctx.currentTime;
		const f = 165 + speed01 * 120 + (boosting ? 35 : 0);
		this.buzzA.frequency.setTargetAtTime(f, t, 0.05);
		this.buzzB.frequency.setTargetAtTime(f * 1.005, t, 0.05);
		this.buzzSub.frequency.setTargetAtTime(f * 0.5, t, 0.05);
		this.buzzFilter.frequency.setTargetAtTime((700 + speed01 * 1700) * (1 - muffled * 0.6), t, 0.08);
		this.buzzGain.gain.setTargetAtTime((0.045 + speed01 * 0.06) * (1 - muffled * 0.5), t, 0.08);
	}

	setEnvironment(amb: Ambience, wind: number, nearWater: number, insideHive: number): void {
		if (!this.ctx) return;
		this.ambience = amb;
		const t = this.ctx.currentTime;
		this.windGain.gain.setTargetAtTime((0.03 + wind * 0.07) * (1 - insideHive * 0.85), t, 0.4);
		this.windFilter.frequency.setTargetAtTime(350 + wind * 400, t, 0.4);
		this.waterGain.gain.setTargetAtTime(nearWater * 0.06, t, 0.3);
		this.humGain.gain.setTargetAtTime(insideHive * 0.05, t, 0.5);
	}

	update(): void {
		const ctx = this.ctx;
		if (!ctx || this.suspended) return;
		const now = ctx.currentTime;
		// Ambient birds / crickets.
		if (now > this.nextChirp) {
			this.nextChirp = now + 1.5 + Math.random() * 4;
			if (this.ambience === 'meadow' || this.ambience === 'forest') this.chirp(this.ambience === 'forest');
		}
		// Generative music with a short lookahead.
		if (!this.musicOn) return;
		const spb = 60 / 92 / 2; // eighth notes
		while (this.nextBeat < now + 0.25) {
			this.scheduleMusic(this.nextBeat, this.beat);
			this.nextBeat += spb;
			this.beat++;
		}
	}

	private scheduleMusic(t: number, beat: number): void {
		const bar = Math.floor(beat / 8) % CHORDS.length;
		const step = beat % 8;
		const chord = CHORDS[bar];
		if (step === 0) this.pluck(t, midi(chord[0] - 24), 0.12, 1.4, 'triangle');
		if (step === 4) this.pluck(t, midi(chord[2] - 24), 0.08, 0.9, 'triangle');
		const pattern = [0, 2, 1, 3, 2, 1, 3, 2];
		if (step % 2 === 0 || Math.random() < 0.35) {
			const n = chord[pattern[step]] + (Math.random() < 0.15 ? 12 : 0);
			this.pluck(t, midi(n), 0.05 + Math.random() * 0.02, 0.45, 'sine');
		}
	}

	private pluck(t: number, f: number, vol: number, dur: number, type: OscillatorType): void {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.value = f;
		const g = ctx.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(vol, t + 0.01);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(this.musicBus);
		o.start(t);
		o.stop(t + dur + 0.05);
	}

	private chirp(forest: boolean): void {
		const ctx = this.ctx!;
		const t = ctx.currentTime;
		const pan = ctx.createStereoPanner();
		pan.pan.value = Math.random() * 2 - 1;
		pan.connect(this.ambBus);
		const notes = forest ? 2 + Math.floor(Math.random() * 3) : 3 + Math.floor(Math.random() * 4);
		const base = forest ? 1800 + Math.random() * 1200 : 2600 + Math.random() * 1400;
		for (let i = 0; i < notes; i++) {
			const st = t + i * (0.09 + Math.random() * 0.05);
			const o = ctx.createOscillator();
			o.type = 'sine';
			o.frequency.setValueAtTime(base * (1 + Math.random() * 0.2), st);
			o.frequency.exponentialRampToValueAtTime(base * (forest ? 0.7 : 1.4), st + 0.07);
			const g = ctx.createGain();
			g.gain.setValueAtTime(0, st);
			g.gain.linearRampToValueAtTime(0.025, st + 0.01);
			g.gain.exponentialRampToValueAtTime(0.0001, st + 0.09);
			o.connect(g).connect(pan);
			o.start(st);
			o.stop(st + 0.12);
		}
	}

	private env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
	}

	private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, out: AudioNode, t: number): OscillatorNode {
		const ctx = this.ctx!;
		const o = ctx.createOscillator();
		o.type = type;
		o.frequency.setValueAtTime(f0, t);
		if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
		const g = ctx.createGain();
		this.env(g, t, vol, 0.005, dur);
		o.connect(g).connect(out);
		o.start(t);
		o.stop(t + dur + 0.05);
		return o;
	}

	private noiseBurst(type: BiquadFilterType, f0: number, f1: number, dur: number, vol: number, out: AudioNode, t: number, q = 1): void {
		const ctx = this.ctx!;
		const src = ctx.createBufferSource();
		src.buffer = this.noise;
		src.playbackRate.value = 0.8 + Math.random() * 0.4;
		const filt = ctx.createBiquadFilter();
		filt.type = type;
		filt.Q.value = q;
		filt.frequency.setValueAtTime(f0, t);
		filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
		const g = ctx.createGain();
		this.env(g, t, vol, 0.004, dur);
		src.connect(filt).connect(g).connect(out);
		src.start(t, Math.random() * 1.5);
		src.stop(t + dur + 0.05);
	}

	play(name: Sfx, opts: PlayOpts = {}): void {
		const ctx = this.ctx;
		if (!ctx || this.suspended) return;
		const now = ctx.currentTime;
		const gap = MIN_GAP[name];
		if (gap && now - (this.last.get(name) ?? -1) < gap) return;
		this.last.set(name, now);
		const vol = opts.volume ?? 1;
		const p = opts.pitch ?? 1;
		let out: AudioNode = this.sfxBus;
		if (opts.pan !== undefined) {
			const pan = ctx.createStereoPanner();
			pan.pan.value = Math.max(-1, Math.min(1, opts.pan));
			pan.connect(this.sfxBus);
			out = pan;
		}
		const t = now + 0.005;
		switch (name) {
			case 'bump':
				this.tone('sine', 150 * p, 55 * p, 0.22, 0.5 * vol, out, t);
				this.noiseBurst('lowpass', 900, 200, 0.12, 0.25 * vol, out, t);
				break;
			case 'thud':
				this.tone('sine', 90 * p, 38 * p, 0.4, 0.7 * vol, out, t);
				this.noiseBurst('lowpass', 500, 120, 0.25, 0.35 * vol, out, t);
				break;
			case 'boing': {
				const o = this.tone('triangle', 180 * p, 620 * p, 0.38, 0.35 * vol, out, t);
				const lfo = ctx.createOscillator();
				lfo.frequency.value = 22;
				const lg = ctx.createGain();
				lg.gain.value = 40;
				lfo.connect(lg).connect(o.frequency);
				lfo.start(t);
				lfo.stop(t + 0.4);
				break;
			}
			case 'pop':
				this.noiseBurst('highpass', 1800, 900, 0.07, 0.6 * vol, out, t);
				this.tone('sine', 900 * p, 180 * p, 0.09, 0.4 * vol, out, t);
				break;
			case 'clink':
				for (const f of [2100, 2780, 3460]) this.tone('sine', f * p, f * p * 0.98, 0.35, 0.09 * vol, out, t);
				break;
			case 'shatter':
				for (let i = 0; i < 6; i++) {
					const f = 2000 + Math.random() * 3000;
					this.tone('sine', f * p, f * 0.9, 0.25 + Math.random() * 0.3, 0.07 * vol, out, t + i * 0.025);
				}
				this.noiseBurst('highpass', 4000, 2500, 0.3, 0.35 * vol, out, t);
				break;
			case 'crunch':
				for (let i = 0; i < 3; i++) this.noiseBurst('bandpass', 1200 - i * 300, 300, 0.12, 0.4 * vol, out, t + i * 0.04, 2);
				this.tone('sine', 140, 60, 0.2, 0.3 * vol, out, t);
				break;
			case 'splash':
				this.noiseBurst('bandpass', 2400, 400, 0.55, 0.55 * vol, out, t, 0.8);
				this.noiseBurst('lowpass', 800, 150, 0.4, 0.3 * vol, out, t + 0.03);
				break;
			case 'chime':
				[0, 0.07, 0.14].forEach((dt, i) => this.tone('sine', [880, 1108, 1320][i] * p, [880, 1108, 1320][i] * p, 0.5, 0.12 * vol, out, t + dt));
				break;
			case 'tick':
				this.tone('sine', 1500 * p, 1700 * p, 0.05, 0.05 * vol, out, t);
				break;
			case 'combo':
				this.tone('square', 523 * p, 523 * p, 0.09, 0.05 * vol, out, t);
				this.tone('square', 784 * p, 784 * p, 0.14, 0.05 * vol, out, t + 0.07);
				break;
			case 'whoosh':
				this.noiseBurst('bandpass', 350 * p, 2600 * p, 0.32, 0.45 * vol, out, t, 1.4);
				break;
			case 'sting':
				this.tone('sawtooth', 1300 * p, 380 * p, 0.12, 0.12 * vol, out, t);
				this.noiseBurst('highpass', 3000, 6000, 0.06, 0.15 * vol, out, t);
				break;
			case 'squeak':
				this.tone('square', 900 * p, 1400 * p, 0.09, 0.08 * vol, out, t);
				this.tone('square', 1400 * p, 850 * p, 0.12, 0.08 * vol, out, t + 0.09);
				break;
			case 'squawk': {
				const o = this.tone('sawtooth', 950 * p, 520 * p, 0.32, 0.22 * vol, out, t);
				const fm = ctx.createOscillator();
				fm.frequency.value = 60;
				const fg = ctx.createGain();
				fg.gain.value = 300;
				fm.connect(fg).connect(o.frequency);
				fm.start(t);
				fm.stop(t + 0.35);
				this.noiseBurst('bandpass', 1500, 900, 0.25, 0.15 * vol, out, t, 3);
				break;
			}
			case 'squelch':
				this.noiseBurst('lowpass', 700, 120, 0.4, 0.5 * vol, out, t, 4);
				this.tone('sine', 90 * p, 140 * p, 0.35, 0.25 * vol, out, t);
				break;
			case 'fanfare':
				[523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, i === 3 ? 0.7 : 0.18, 0.16 * vol, out, t + i * 0.11));
				break;
			case 'notify':
				this.tone('sine', 660, 660, 0.18, 0.08 * vol, out, t);
				this.tone('sine', 990, 990, 0.25, 0.08 * vol, out, t + 0.1);
				break;
			case 'click':
				this.tone('sine', 1200, 900, 0.04, 0.06 * vol, out, t);
				break;
			case 'knock':
				this.noiseBurst('bandpass', 700 * p, 400 * p, 0.08, 0.5 * vol, out, t, 3);
				this.tone('sine', 320 * p, 200 * p, 0.1, 0.25 * vol, out, t);
				break;
			case 'yelp':
				this.tone('square', 700 * p, 1400 * p, 0.08, 0.06 * vol, out, t);
				this.tone('square', 1200 * p, 600 * p, 0.12, 0.06 * vol, out, t + 0.08);
				break;
			case 'ring':
				this.tone('sine', 1320 * p, 1320 * p, 0.6, 0.12 * vol, out, t);
				this.tone('sine', 1980 * p, 1980 * p, 0.5, 0.06 * vol, out, t + 0.04);
				break;
		}
	}

	dispose(): void {
		void this.ctx?.close();
		this.ctx = null;
	}
}
