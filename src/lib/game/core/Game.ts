import * as THREE from 'three';
import type { GameContext } from './context';
import type { GameMode, HudSnapshot, UIBridge } from './types';
import { GameLoop } from './GameLoop';
import { InputManager, PAD } from './InputManager';
import { CameraController } from './CameraController';
import { QUALITY_PRESETS, type Settings } from './Settings';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Interactions } from '../physics/Interactions';
import { WorldManager } from '../world/WorldManager';
import { HIVE, LANDMARKS, SPAWN, isInsideHive } from '../world/Biomes';
import { BeeController } from '../player/BeeController';
import { BeeAbilities } from '../player/BeeAbilities';
import { Props } from '../entities/Props';
import { NPCManager } from '../entities/NPCManager';
import { AudioManager } from '../systems/AudioManager';
import { Effects } from '../systems/Effects';
import { ChaosSystem } from '../systems/ChaosSystem';
import { CollectionSystem } from '../systems/CollectionSystem';
import { ChallengeSystem } from '../systems/ChallengeSystem';
import { EnvironmentSystem } from '../systems/EnvironmentSystem';
import { Achievements } from '../systems/Achievements';
import { SaveSystem } from '../systems/SaveSystem';
import { ScorePopups } from '../ui/ScorePopups';

export interface MapData {
	image: HTMLCanvasElement;
	player: { x: number; z: number; heading: number };
	landmarks: { name: string; icon: string; x: number; z: number; found: boolean }[];
	totems: { name: string; icon: string; x: number; z: number }[];
	orbs: { x: number; z: number }[];
	hive: { x: number; z: number };
	objective: { x: number; z: number } | null;
}

/**
 * Top-level orchestrator: renderer, scene, systems and the frame loop. Svelte only talks
 * to the game through this class and the UIBridge.
 */
export class Game {
	readonly renderer: THREE.WebGLRenderer;
	readonly scene = new THREE.Scene();
	readonly camera: THREE.PerspectiveCamera;
	readonly save = new SaveSystem();
	/** Exposed for debugging/tests. */
	ctx!: GameContext;
	private loop!: GameLoop;
	private input: InputManager;
	private mode: GameMode = 'loading';
	private resizeObs: ResizeObserver;
	private width = 1;
	private height = 1;
	private hudTimer = 0;
	private pixelScale = 1;
	private adaptTimer = 0;
	private mapImage: HTMLCanvasElement | null = null;
	private started = false;
	private disposed = false;
	private pauseRender = 0;

	constructor(
		private canvas: HTMLCanvasElement,
		private popupLayer: HTMLElement,
		private ui: UIBridge
	) {
		const preset = QUALITY_PRESETS[this.save.data.settings.quality];
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: preset.antialias, powerPreference: 'high-performance', stencil: false });
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.08;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFShadowMap;
		this.camera = new THREE.PerspectiveCamera(72, 1, 0.3, 1500);
		this.input = new InputManager(canvas);
		this.input.onLockChange = (locked) => this.onLockChange(locked);
		this.input.onKey = (code) => this.onKey(code);
		this.resizeObs = new ResizeObserver(() => this.resize());
		this.resizeObs.observe(canvas.parentElement ?? canvas);
		window.addEventListener('beforeunload', this.onBeforeUnload);
		document.addEventListener('visibilitychange', this.onVisibility);
	}

	private onVisibility = () => {
		if (!this.ctx) return;
		if (document.hidden) this.ctx.audio.suspend();
		else if (this.mode !== 'paused') this.ctx.audio.resume();
	};

	async init(): Promise<void> {
		const ui = this.ui;
		ui.setLoading(0.02, 'Waking up the physics engine');
		const physics = await PhysicsWorld.create();
		if (this.disposed) return;
		const world = await WorldManager.create(this.scene, physics, (t, label) => ui.setLoading(t, label));
		if (this.disposed) return;
		ui.setLoading(0.86, 'Hatching bees');
		await new Promise((r) => setTimeout(r, 0));

		const ctx = {
			scene: this.scene,
			camera: this.camera,
			physics,
			world,
			input: this.input,
			save: this.save,
			ui,
			time: 0,
			playing: false
		} as unknown as GameContext;
		this.ctx = ctx;
		ctx.audio = new AudioManager();
		ctx.effects = new Effects(this.scene, world.terrain);
		ctx.popups = new ScorePopups(this.popupLayer);
		ctx.achievements = new Achievements(this.save, ui, ctx.audio);
		ctx.cameraCtl = new CameraController(ctx, this.camera);
		const spawnY = world.terrain.heightAt(SPAWN.x, SPAWN.z) + 6;
		ctx.player = new BeeController(ctx, new THREE.Vector3(SPAWN.x, spawnY, SPAWN.z));
		ctx.abilities = new BeeAbilities(ctx);
		ctx.env = new EnvironmentSystem(ctx);
		ctx.chaos = new ChaosSystem(ctx);
		ctx.challenges = new ChallengeSystem(ctx);
		ctx.collection = new CollectionSystem(ctx);
		ctx.props = new Props(ctx);
		ctx.npcs = new NPCManager(ctx);
		ctx.interactions = new Interactions(ctx);
		ctx.props.init();
		ctx.player.yaw = Math.atan2(HIVE.x - SPAWN.x, HIVE.z - SPAWN.z);

		ui.setLoading(0.95, 'Compiling shaders');
		this.applySettings(this.save.data.settings);
		this.resize();
		world.update(0, 0, this.camera, ctx.player.position);
		ctx.cameraCtl.update(0.016);
		this.renderer.compile(this.scene, this.camera);
		this.mapImage = world.buildMapCanvas(256);

		this.loop = new GameLoop(physics.fixedDt, {
			fixed: (dt) => this.fixed(dt),
			frame: (dt, alpha) => this.frame(dt, alpha)
		});
		this.loop.start();
		ui.setLoading(1, 'Ready');
		this.setMode('menu');
	}

	get settings(): Settings {
		return this.save.data.settings;
	}

	private setMode(m: GameMode): void {
		this.mode = m;
		this.ctx.playing = m === 'playing';
		this.input.enabled = m === 'playing';
		this.loop.frozen = m === 'paused';
		this.ui.setMode(m);
	}

	/** Play button. Must be called from a user gesture (audio + pointer lock). */
	start(): void {
		const ctx = this.ctx;
		ctx.audio.start();
		this.applyAudio();
		if (!this.started) {
			this.started = true;
			ctx.cameraCtl.snapBehind(ctx.player.yaw + Math.PI);
			if (this.save.data.playTime < 30) this.showTips();
		}
		ctx.cameraCtl.mode = 'follow';
		ctx.audio.resume();
		this.setMode('playing');
		if (!this.input.gamepadActive) void this.input.requestLock().then((ok) => this.ui.setLocked(ok));
	}

	/** A few staggered onboarding hints for first-time players. */
	private showTips(): void {
		const tips: [string, string][] = [
			['Fly with WASD + mouse', 'Space up · Ctrl/C down · Shift boost · Q dash · R barrel roll'],
			['Cause CHAOS!', 'Crash into things, headbutt (left click), sting (right click). Chain tricks for combos.'],
			['Explore & collect', 'Hover on flowers for pollen, press E for nectar, find ✨ Golden Pollen. M opens the map.']
		];
		tips.forEach(([t, d], i) => setTimeout(() => this.mode === 'playing' && this.ui.notify(t, d, 'info'), 1200 + i * 4200));
	}

	pause(): void {
		if (this.mode !== 'playing') return;
		this.ctx.audio.suspend();
		this.ctx.save.flush();
		this.setMode('paused');
		this.input.exitLock();
	}

	resume(): void {
		if (this.mode !== 'paused') return;
		this.ctx.audio.resume();
		this.setMode('playing');
		if (!this.input.gamepadActive) void this.input.requestLock().then((ok) => this.ui.setLocked(ok));
	}

	/** Re-capture the mouse while playing (click on canvas). */
	capture(): void {
		if (this.mode === 'playing' && !this.input.locked) void this.input.requestLock().then((ok) => this.ui.setLocked(ok));
	}

	quitToMenu(): void {
		const ctx = this.ctx;
		ctx.challenges.abandon();
		ctx.save.flush();
		ctx.cameraCtl.mode = 'cinematic';
		ctx.audio.resume();
		this.setMode('menu');
		this.input.exitLock();
	}

	respawn(): void {
		const ctx = this.ctx;
		const y = ctx.world.terrain.heightAt(SPAWN.x, SPAWN.z) + 6;
		ctx.abilities.dropHeld();
		ctx.env.forceRelease();
		ctx.player.teleport(new THREE.Vector3(SPAWN.x, y, SPAWN.z));
	}

	abandonChallenge(): void {
		this.ctx.challenges.abandon();
	}

	private onLockChange(locked: boolean): void {
		this.ui.setLocked(locked);
		if (!locked && this.mode === 'playing') this.pause();
	}

	private onKey(code: string): void {
		if (this.mode === 'playing' && (code === 'KeyM' || code === 'Tab')) this.ui.toggleMap();
		if (this.mode === 'playing' && code === 'KeyP') this.pause();
		else if (this.mode === 'playing' && code === 'Escape' && !this.input.locked) this.pause();
	}

	private onBeforeUnload = (e: BeforeUnloadEvent) => {
		this.ctx?.save.flush();
		// Ctrl is the descend key; guard against an accidental Ctrl+W / Ctrl+R mid-flight.
		if (this.mode === 'playing') {
			e.preventDefault();
			e.returnValue = '';
		}
	};

	applySettings(s: Settings): void {
		this.save.data.settings = { ...s };
		this.save.markDirty();
		const ctx = this.ctx;
		const preset = QUALITY_PRESETS[s.quality];
		ctx.world.sky.setShadowQuality(preset.shadows, preset.shadowSize);
		ctx.player.blobShadow.visible = !preset.shadows;
		ctx.world.sky.setShadowExtent(preset.shadowExtent);
		if (this.renderer.shadowMap.enabled !== preset.shadows) {
			this.renderer.shadowMap.enabled = preset.shadows;
			this.scene.traverse((o) => {
				const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
				if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
				else if (m) m.needsUpdate = true;
			});
		}
		ctx.world.setGrassQuality({ blades: preset.grassBlades, area: preset.grassArea });
		ctx.world.setDrawDistance(preset.drawDistance);
		ctx.world.chunks.detailScale = preset.detailScale;
		ctx.world.vegetation.setDensity(preset.flowerDensity, ctx.world.chunks.chunks);
		ctx.world.chunks.update(0, this.camera.position, true);
		this.camera.far = preset.drawDistance + 900;
		this.camera.updateProjectionMatrix();
		ctx.cameraCtl.sensitivity = s.sensitivity;
		ctx.cameraCtl.invertY = s.invertY;
		ctx.cameraCtl.baseFov = s.fov;
		ctx.cameraCtl.shakeEnabled = s.shake;
		this.pixelScale = 1;
		this.applyPixelRatio();
		this.applyAudio();
	}

	private applyAudio(): void {
		const s = this.save.data.settings;
		this.ctx.audio.setVolumes(s.master, s.sfx, s.music);
	}

	private applyPixelRatio(): void {
		const preset = QUALITY_PRESETS[this.save.data.settings.quality];
		const pr = Math.min(window.devicePixelRatio || 1, preset.pixelRatio) * this.pixelScale;
		this.renderer.setPixelRatio(Math.max(0.5, pr));
		this.renderer.setSize(this.width, this.height, false);
	}

	private resize(): void {
		const parent = this.canvas.parentElement ?? this.canvas;
		this.width = Math.max(1, parent.clientWidth);
		this.height = Math.max(1, parent.clientHeight);
		this.camera.aspect = this.width / this.height;
		this.camera.updateProjectionMatrix();
		if (this.ctx) {
			this.applyPixelRatio();
			this.ctx.effects.setViewport(this.height * this.renderer.getPixelRatio(), this.camera.fov);
		}
	}

	// ------------------------------------------------------------------ loop
	private fixed(dt: number): void {
		const ctx = this.ctx;
		ctx.time += dt;
		ctx.abilities.fixedUpdate(dt);
		ctx.env.fixedUpdate(dt);
		ctx.player.fixedUpdate(dt);
		ctx.props.fixedUpdate(dt);
		ctx.physics.step();
		ctx.player.postStep(dt);
		ctx.props.postStep();
		ctx.interactions.process();
	}

	private frame(dt: number, alpha: number): void {
		const ctx = this.ctx;
		this.input.pollGamepad(dt);
		this.ui.setGamepad(this.input.gamepadActive);
		if (this.input.padButtonPressed(PAD.START)) {
			if (this.mode === 'playing') this.pause();
			else if (this.mode === 'paused') this.resume();
			else if (this.mode === 'menu') this.start();
		}
		if (this.mode === 'playing' && this.input.padButtonPressed(PAD.BACK)) this.ui.toggleMap();
		if (this.mode === 'paused') {
			// Keep the paused frame on screen without burning the GPU.
			this.pauseRender -= dt;
			if (this.pauseRender <= 0) {
				this.pauseRender = 0.25;
				this.renderer.render(this.scene, this.camera);
			}
			this.input.endFrame();
			return;
		}
		if (this.mode === 'playing') ctx.abilities.update(dt);
		ctx.player.update(dt, alpha);
		ctx.cameraCtl.update(dt);
		ctx.props.update(dt, alpha);
		ctx.npcs.update(dt);
		ctx.collection.update(dt);
		ctx.challenges.update(dt);
		ctx.chaos.update(dt);
		ctx.env.update(dt);
		ctx.world.update(dt, ctx.time, this.camera, ctx.player.renderPosition);
		ctx.effects.update(dt);
		this.updateAudio();
		ctx.popups.update(dt, this.camera, this.width, this.height);
		this.hudTimer -= dt;
		if (this.hudTimer <= 0) {
			this.hudTimer = 0.1;
			this.ui.updateHud(this.snapshot());
		}
		this.adaptResolution(dt);
		this.save.update(this.mode === 'playing' ? dt : 0);
		this.renderer.render(this.scene, this.camera);
		this.input.endFrame();
	}

	private updateAudio(): void {
		const ctx = this.ctx;
		const p = ctx.player;
		const inside = isInsideHive(p.position.x, p.position.y, p.position.z) ? 1 : 0;
		ctx.audio.setBuzz(p.speed01, p.boosting, ctx.env.inWater ? 0.7 : 0);
		const region = ctx.world.regionAt(p.position);
		ctx.audio.setEnvironment(region, ctx.world.wind.length() * 0.6 + ctx.world.gust, ctx.env.nearWater, inside);
		ctx.audio.update();
	}

	private adaptResolution(dt: number): void {
		if (!this.save.data.settings.adaptive) return;
		this.adaptTimer += dt;
		if (this.adaptTimer < 1.5) return;
		this.adaptTimer = 0;
		const ms = this.loop.avgFrameMs;
		const prev = this.pixelScale;
		if (ms > 20 && this.pixelScale > 0.6) this.pixelScale = Math.max(0.6, this.pixelScale - 0.1);
		else if (ms < 14 && this.pixelScale < 1) this.pixelScale = Math.min(1, this.pixelScale + 0.05);
		if (prev !== this.pixelScale) {
			this.applyPixelRatio();
			this.ctx.effects.setViewport(this.height * this.renderer.getPixelRatio(), this.camera.fov);
		}
	}

	private snapshot(): HudSnapshot {
		const ctx = this.ctx;
		const p = ctx.player;
		const env = ctx.env;
		const ab = ctx.abilities;
		let status = '';
		if (env.stuck === 'honey') status = 'STUCK IN HONEY — mash keys!';
		else if (env.stuck === 'web') status = 'CAUGHT IN A WEB — mash keys!';
		else if (p.stunned > 0) status = 'Dizzy...';
		else if (env.honeyCoat > 0) status = 'Honey-coated (slow)';
		else if (env.wet > 0) status = 'Soggy wings (slow)';
		return {
			chaos: ctx.chaos.score,
			combo: ctx.chaos.multiplier,
			comboTime: Math.max(0, ctx.chaos.comboTimer / 3.5),
			nectar: ctx.collection.nectar,
			nectarCap: ctx.collection.nectarCap,
			pollen: ctx.collection.pollen,
			honey: this.save.data.honey,
			region: ctx.world.regionName(p.position),
			boost: ab.boost,
			prompt: ab.prompt,
			status,
			struggle: env.stuck ? env.struggle : 0,
			held: ab.held?.def.name ?? '',
			challenge: ctx.challenges.hud(),
			orbs: ctx.collection.orbsCollected,
			orbsTotal: ctx.collection.orbs.length,
			fps: this.save.data.settings.showFps ? this.loop.fps : 0,
			heading: ctx.cameraCtl.yaw,
			speed: Math.round(p.velocity.length())
		};
	}

	getMapData(): MapData {
		const ctx = this.ctx;
		const p = ctx.player.position;
		const disc = this.save.data.discovered;
		const ch = ctx.challenges;
		let objective: MapData['objective'] = null;
		const hud = ch.active;
		if (hud?.def.id === 'race') {
			const ring = (ch as unknown as { rings: THREE.Mesh[] }).rings[hud.ring];
			if (ring) objective = { x: ring.position.x, z: ring.position.z };
		}
		return {
			image: this.mapImage!,
			player: { x: p.x, z: p.z, heading: ctx.player.yaw },
			landmarks: LANDMARKS.map((l) => ({ name: l.name, icon: l.icon, x: l.x, z: l.z, found: disc.includes(`lm-${l.id}`) })),
			totems: ch.defs.map((d) => ({ name: d.title, icon: d.icon, x: d.totem.x, z: d.totem.z })),
			orbs: ctx.collection.orbs.filter((o) => o.collected).map((o) => ({ x: o.pos.x, z: o.pos.z })),
			hive: { x: HIVE.x, z: HIVE.z },
			objective
		};
	}

	/** Progress summary for the pause menu. */
	getProgress() {
		const s = this.save.data;
		const ctx = this.ctx;
		return {
			bestChaos: s.bestChaos,
			totalChaos: s.totalChaos,
			honey: s.honey,
			species: s.species.length,
			speciesTotal: ctx.npcs.speciesCount,
			orbs: ctx.collection.orbsCollected,
			orbsTotal: ctx.collection.orbs.length,
			tricks: s.tricks.length,
			achievements: [...s.achievements],
			challenges: ctx.challenges.defs.map((d) => ({ id: d.id, title: d.title, icon: d.icon, desc: d.desc, done: s.challengesDone.includes(d.id), best: d.id === 'race' && s.raceBest ? s.raceBest : null })),
			activeChallenge: ctx.challenges.active?.def.title ?? null,
			playTime: s.playTime
		};
	}

	resetProgress(): void {
		this.save.reset();
		window.location.reload();
	}

	dispose(): void {
		this.disposed = true;
		window.removeEventListener('beforeunload', this.onBeforeUnload);
		document.removeEventListener('visibilitychange', this.onVisibility);
		this.resizeObs.disconnect();
		this.loop?.dispose();
		this.input.exitLock();
		this.input.dispose();
		const ctx = this.ctx;
		if (ctx) {
			ctx.save.flush();
			ctx.npcs?.dispose();
			ctx.props?.dispose();
			ctx.collection?.dispose();
			ctx.challenges?.dispose();
			ctx.env?.dispose();
			ctx.effects?.dispose();
			ctx.popups?.dispose();
			ctx.player?.dispose();
			ctx.audio?.dispose();
			ctx.world?.dispose();
			ctx.physics?.dispose();
		}
		this.renderer.dispose();
		this.renderer.forceContextLoss();
	}
}
