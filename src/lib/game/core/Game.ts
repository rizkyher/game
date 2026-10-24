import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { FeelHooks, FlowHooks, GameContext, GameEvents } from './context';
import type { GameMode, HudSnapshot, PanelId, UIBridge, SpellSlotHud } from './types';
import { GameLoop } from './GameLoop';
import { InputManager, PAD } from './InputManager';
import { EventBus } from './EventBus';
import { CameraController } from './CameraController';
import { QUALITY_PRESETS, type Settings } from './Settings';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { WorldManager } from '../world/WorldManager';
import { LANDMARKS, REGIONS, SPAWN, WAYSTONES, regionAt, type RegionId } from '../world/WorldLayout';
import { AudioManager } from '../systems/AudioManager';
import { MagicVFX } from '../vfx/MagicVFX';
import { DamageNumbers } from '../vfx/DamageNumbers';
import { Player } from '../player/PlayerController';
import { PlayerCombat } from '../player/PlayerCombat';
import { CombatSystem } from '../combat/CombatSystem';
import { TargetingSystem } from '../combat/TargetingSystem';
import { SpellSystem } from '../magic/SpellSystem';
import { ELEMENT_SPELLS, SPELLS } from '../magic/SpellRegistry';
import { EnemyManager } from '../entities/EnemyManager';
import { Pickups } from '../entities/Pickups';
import { CRYSTALS, Interactables } from '../entities/Interactables';
import { NPCs } from '../entities/NPC';
import { BossFight } from '../entities/Boss';
import { QuestSystem } from '../systems/QuestSystem';
import { Progression } from '../systems/Progression';
import { Inventory } from '../systems/Inventory';
import { SaveSystem } from '../systems/SaveSystem';
import { PlayerProfile } from '../systems/PlayerProfile';
import { PLAYER_ELEMENTS, type PlayerElement } from '../combat/types';
import type { StatusView } from '../combat/StatusEffects';
import { wrapAngle } from '../utils/math';

export interface MapMarker {
	id: string;
	name: string;
	icon: string;
	x: number;
	z: number;
	kind: 'landmark' | 'waystone' | 'objective' | 'crystal';
	active: boolean;
}

export interface MapData {
	image: HTMLCanvasElement;
	player: { x: number; z: number; yaw: number };
	markers: MapMarker[];
	objective: { x: number; z: number } | null;
	region: string;
}

const _v = new THREE.Vector3();

/**
 * Top-level orchestrator: renderer and post-processing, system construction, modes and
 * pointer lock, the fixed-step/frame loop, time-feel (hit-stop, slow motion), saving and
 * the throttled HUD snapshot. Svelte only talks to the game through this class and the
 * UIBridge.
 */
export class Game {
	readonly renderer: THREE.WebGLRenderer;
	readonly scene = new THREE.Scene();
	readonly camera: THREE.PerspectiveCamera;
	readonly save = new SaveSystem();
	ctx!: GameContext;
	private loop!: GameLoop;
	private input: InputManager;
	private events = new EventBus<GameEvents>();
	private composer: EffectComposer | null = null;
	private bloom: UnrealBloomPass | null = null;
	private composerTarget: THREE.WebGLRenderTarget | null = null;
	private mode: GameMode = 'loading';
	private resizeObs: ResizeObserver;
	private width = 1;
	private height = 1;
	private hudTimer = 0;
	private pixelScale = 1;
	private adaptTimer = 0;
	private mapImage: HTMLCanvasElement | null = null;
	private disposed = false;
	private pauseRender = 0;
	private hitStopT = 0;
	private slowT = 0;
	private slowScale = 1;
	private region: RegionId | null = null;
	private discoverTimer = 0;
	private deathTimer = -1;
	private statusBuf: StatusView[] = [];
	private targetStatusBuf: StatusView[] = [];
	private panel: PanelId | null = null;
	private modeAt = 0;
	/** Smoothed CPU milliseconds per frame: simulation, per-frame logic, render submission. */
	readonly perf = { sim: 0, logic: 0, render: 0, frames: 0 };

	constructor(
		private canvas: HTMLCanvasElement,
		private popupLayer: HTMLElement,
		private ui: UIBridge
	) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
		this.renderer.toneMappingExposure = 1.0;
		this.renderer.shadowMap.enabled = true;
		this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1400);
		this.input = new InputManager(canvas);
		this.input.onLockChange = (locked) => this.onLockChange(locked);
		this.input.onKey = (code) => this.onKey(code);
		this.input.onLockError = () => this.ui.setLocked(false);
		if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('nolock')) this.input.allowUnlockedMouse = true;
		this.resizeObs = new ResizeObserver(() => this.resize());
		this.resizeObs.observe(canvas.parentElement ?? canvas);
		window.addEventListener('beforeunload', this.onBeforeUnload);
		document.addEventListener('visibilitychange', this.onVisibility);
	}

	private onVisibility = () => {
		if (!this.ctx) return;
		if (document.hidden) this.ctx.audio.suspend();
		else if (this.mode !== 'paused' && this.mode !== 'panel') this.ctx.audio.resume();
	};

	get settings(): Settings {
		return this.save.data.settings;
	}

	async init(): Promise<void> {
		const ui = this.ui;
		ui.setLoading(0.02, 'Awakening the Aether');
		const physics = await PhysicsWorld.create();
		if (this.disposed) return;
		const world = await WorldManager.create(this.scene, physics, (t, label) => ui.setLoading(0.05 + t * 0.6, label));
		if (this.disposed) return;
		ui.setLoading(0.7, 'Summoning the Arcanist');
		await new Promise((r) => setTimeout(r, 0));

		const feel: FeelHooks = {
			hitStop: (s) => (this.hitStopT = Math.max(this.hitStopT, s)),
			slowMo: (scale, s) => {
				this.slowScale = scale;
				this.slowT = Math.max(this.slowT, s);
			},
			shake: (a) => this.ctx.cameraCtl.shake(a),
			kick: (f) => this.ctx.cameraCtl.kick(f)
		};
		const flow: FlowHooks = {
			dialogue: (open) => {
				if (open && this.mode === 'playing') {
					this.setMode('dialogue');
					this.input.exitLock();
					this.input.clearHeld();
				} else if (!open && this.mode === 'dialogue') {
					this.ui.showDialogue(null);
					this.setMode('playing');
					this.requestLock();
				}
			},
			cutscene: (on) => {
				if (on && this.mode === 'playing') this.setMode('cutscene');
				else if (!on && this.mode === 'cutscene') {
					this.ctx.cameraCtl.endCutscene();
					this.setMode('playing');
				}
			},
			victory: () => {
				this.setMode('victory');
				this.input.exitLock();
				this.ctx.audio.setMood('victory');
			},
			save: () => this.saveGame(),
			isCheckpoint: (id) => this.save.data.waystones.includes(id),
			setCheckpoint: (id) => {
				if (!this.save.data.waystones.includes(id)) this.save.data.waystones.push(id);
				this.save.data.checkpoint = id;
			}
		};
		const ctx = {
			scene: this.scene,
			camera: this.camera,
			physics,
			world,
			input: this.input,
			events: this.events,
			ui,
			save: this.save,
			feel,
			flow,
			settings: this.save.data.settings,
			time: 0,
			playing: false
		} as unknown as GameContext;
		this.ctx = ctx;
		ctx.audio = new AudioManager();
		ctx.progression = new Progression();
		ctx.inventory = new Inventory();
		ctx.profile = new PlayerProfile();
		ctx.vfx = new MagicVFX(this.scene, this.camera, world.terrain);
		ctx.numbers = new DamageNumbers(this.popupLayer);
		ctx.cameraCtl = new CameraController(ctx, this.camera);
		ctx.combat = new CombatSystem(ctx);
		ctx.targeting = new TargetingSystem(ctx);
		ctx.spells = new SpellSystem(ctx);
		const spawn = new THREE.Vector3(SPAWN.x, world.terrain.heightAt(SPAWN.x, SPAWN.z), SPAWN.z);
		ctx.player = new Player(ctx, spawn);
		ctx.player.yaw = ctx.player.targetYaw = Math.PI;
		ctx.playerCombat = new PlayerCombat(ctx);
		ctx.enemies = new EnemyManager(ctx);
		ctx.boss = new BossFight(ctx);
		ctx.combat.sources.push(ctx.enemies, ctx.boss);
		ctx.pickups = new Pickups(ctx);
		ctx.interactables = new Interactables(ctx);
		ctx.npcs = new NPCs(ctx);
		ctx.quests = new QuestSystem(ctx);
		ctx.progression.bonuses = () => ctx.inventory.bonuses();
		ctx.inventory.onChange = () => {
			ctx.progression.invalidate();
			this.ui.refresh();
		};
		ctx.progression.onChange = () => {
			ctx.player?.refreshStats();
			this.ui.refresh();
		};
		ctx.progression.onLevelUp = (level) => this.onLevelUp(level);
		this.wireEvents();

		ui.setLoading(0.8, 'Growing the world around you');
		world.chunks.drawDistance = QUALITY_PRESETS[this.settings.quality].drawDistance;
		world.chunks.prewarm(spawn, (t) => ui.setLoading(0.8 + t * 0.12, 'Growing the world around you'));
		ui.setLoading(0.94, 'Compiling shaders');
		await new Promise((r) => setTimeout(r, 0));
		this.applySettings(this.save.data.settings, false);
		this.resize();
		ctx.cameraCtl.update(0.016);
		world.update(0, 0, this.camera, ctx.player.position);
		this.warmup();
		this.mapImage = world.buildMapCanvas(360);

		this.loop = new GameLoop(physics.fixedDt, {
			fixed: (dt) => this.fixed(dt),
			frame: (dt, alpha) => this.frame(dt, alpha)
		});
		this.loop.start();
		ui.setLoading(1, 'Ready');
		this.setMode('menu');
	}

	/**
	 * Compile every shader the game can need (enemies, pooled VFX, LOD meshes) during the
	 * loading screen so the first fight doesn't hitch.
	 */
	private warmup(): void {
		const ctx = this.ctx;
		const p = ctx.player.position;
		const temp = (['wraith', 'golem', 'mage'] as const).map((k, i) => ctx.enemies.spawn(k, new THREE.Vector3(p.x + 3 + i * 3, 0, p.z + 8)));
		for (const e of temp) e.update(0.016, 1);
		const hidden: THREE.Object3D[] = [];
		this.scene.traverse((o) => {
			if (!o.visible) {
				hidden.push(o);
				o.visible = true;
			}
		});
		this.renderer.compile(this.scene, this.camera);
		for (const o of hidden) o.visible = false;
		for (const e of temp) {
			ctx.enemies.enemies.splice(ctx.enemies.enemies.indexOf(e), 1);
			e.dispose();
		}
	}

	// ------------------------------------------------------------------ events

	private wireEvents(): void {
		const ctx = this.ctx;
		const ev = this.events;
		ev.on('playerDeath', () => {
			if (this.deathTimer < 0) this.deathTimer = 2.2;
			this.save.data.deaths++;
			ctx.targeting.clear();
		});
		ctx.enemies.onEncounterCleared = (id) => {
			if (ctx.enemies.encounters.get(id)?.def.persistent) this.save.data.cleared = ctx.enemies.clearedPersistent();
		};
	}

	private onLevelUp(level: number): void {
		const ctx = this.ctx;
		ctx.player.refreshStats(true);
		ctx.vfx.levelUp(ctx.player.position);
		ctx.audio.sfx('level_up');
		ctx.ui.banner(`Level ${level}`, '+3 attribute points · +1 skill point  —  [I] Character  ·  [K] Skills', 'level');
		ctx.events.emit('levelUp', { level });
	}

	// ------------------------------------------------------------------ modes

	private setMode(m: GameMode): void {
		this.mode = m;
		this.modeAt = performance.now();
		const ctx = this.ctx;
		ctx.playing = m === 'playing';
		this.input.enabled = m === 'playing';
		this.loop.frozen = m === 'paused' || m === 'panel' || m === 'dialogue' || m === 'loading';
		this.ui.setMode(m);
	}

	get currentMode(): GameMode {
		return this.mode;
	}

	hasSave(): boolean {
		return this.save.data.hasGame;
	}

	/** Start a brand-new journey (from the main menu; must be a user gesture). */
	newGame(): void {
		this.save.newGame();
		this.loadState();
		this.enterWorld();
		setTimeout(() => this.mode === 'playing' && this.ui.notify('The Broken Seal', 'Speak with Elder Mirael in Lumen Hollow [E]', 'quest'), 2500);
		this.showTips();
	}

	continueGame(): void {
		this.loadState();
		this.enterWorld();
	}

	private enterWorld(): void {
		const ctx = this.ctx;
		ctx.audio.start();
		this.applyAudio();
		ctx.audio.setMood('explore');
		ctx.cameraCtl.mode = 'follow';
		ctx.cameraCtl.snapBehind(ctx.player.yaw + Math.PI);
		this.region = null;
		this.setMode('playing');
		this.requestLock();
	}

	/** Push saved state into every system and place the player at the checkpoint. */
	private loadState(): void {
		const ctx = this.ctx;
		const d = this.save.data;
		ctx.progression.load(d.progression);
		ctx.inventory.load(d.inventory);
		ctx.enemies.resetEncounters();
		ctx.enemies.setCleared(d.cleared);
		ctx.spells.clear();
		ctx.vfx.clearAll();
		ctx.pickups.clear();
		ctx.playerCombat.reset();
		ctx.playerCombat.element = d.element;
		ctx.player.model.setElement(d.element);
		ctx.playerCombat.aether = 0;
		const cp = this.checkpointPosition();
		ctx.player.revive(cp.pos, cp.yaw);
		ctx.player.refreshStats(true);
		ctx.profile.reset();
		ctx.combat.reset();
		ctx.boss.reset();
		ctx.interactables.sync();
		this.ui.refresh();
	}

	private checkpointPosition(): { pos: THREE.Vector3; yaw: number } {
		const d = this.save.data;
		const terrain = this.ctx.world.terrain;
		if (d.checkpoint === 'hollow' && !d.waystones.includes('crossroads') && d.playTime < 1) {
			return { pos: new THREE.Vector3(SPAWN.x, terrain.heightAt(SPAWN.x, SPAWN.z), SPAWN.z), yaw: Math.PI };
		}
		const w = WAYSTONES.find((x) => x.id === d.checkpoint) ?? WAYSTONES[0];
		const x = w.x + 2.5;
		const z = w.z + 2.5;
		return { pos: new THREE.Vector3(x, terrain.heightAt(x, z), z), yaw: Math.PI };
	}

	/** Persist everything (waystones, quest milestones, quitting). */
	saveGame(): boolean {
		const ctx = this.ctx;
		const d = this.save.data;
		d.hasGame = true;
		d.progression = JSON.parse(JSON.stringify(ctx.progression.data));
		d.inventory = { ...ctx.inventory.items };
		d.element = ctx.playerCombat.element;
		d.cleared = ctx.enemies.clearedPersistent();
		return this.save.write();
	}

	private showTips(): void {
		const tips: [string, string][] = [
			['Move & fight', 'WASD move · Shift sprint · Space jump (twice to double jump) · Q dodge / dash'],
			['Spellcasting', 'Left click: basic spell (chain 3 for a finisher) · Hold right click: charged special · 1–4 switch element'],
			['Defend yourself', 'F hold: Aegis shield · R: parry (time it to counter!) · Tab: lock on · H: Healing Draught']
		];
		tips.forEach(([t, d], i) => setTimeout(() => this.mode === 'playing' && this.ui.notify(t, d, 'info'), 5000 + i * 5000));
	}

	pause(): void {
		if (this.mode !== 'playing') return;
		this.ctx.audio.suspend();
		this.saveSilently();
		this.setMode('paused');
		this.input.exitLock();
		this.input.clearHeld();
	}

	resume(): void {
		if (this.mode !== 'paused' && this.mode !== 'panel') return;
		this.panel = null;
		this.ui.openPanel(null);
		this.ctx.audio.resume();
		this.setMode('playing');
		this.requestLock();
	}

	openPanel(p: PanelId): void {
		if (this.mode !== 'playing' && this.mode !== 'paused' && this.mode !== 'panel') return;
		this.panel = p;
		this.input.clearHeld();
		if (this.mode === 'playing') {
			this.setMode('panel');
			this.input.exitLock();
		}
		this.ui.openPanel(p);
		this.ctx.audio.sfx('ui_open');
		this.ui.refresh();
	}

	closePanel(): void {
		if (this.mode === 'panel') this.resume();
		else {
			this.panel = null;
			this.ui.openPanel(null);
		}
	}

	/** Capture the mouse again while playing (click on the canvas). */
	capture(): void {
		if (this.mode === 'playing' && !this.input.locked) this.requestLock();
	}

	private requestLock(): void {
		if (this.input.gamepadActive) return;
		if (this.input.allowUnlockedMouse) {
			// Automation / embedded previews: play without capturing the pointer.
			this.ui.setLocked(true);
			return;
		}
		void this.input.requestLock().then((ok) => this.ui.setLocked(ok || this.input.allowUnlockedMouse));
	}

	quitToMenu(): void {
		const ctx = this.ctx;
		this.saveSilently();
		ctx.cameraCtl.mode = 'menu';
		ctx.audio.setMood('menu');
		ctx.audio.resume();
		this.panel = null;
		this.ui.openPanel(null);
		this.setMode('menu');
		this.input.exitLock();
	}

	private saveSilently(): void {
		if (this.save.data.hasGame && this.ctx.player.alive) this.saveGame();
	}

	advanceDialogue(): void {
		this.ctx.npcs.advance();
	}

	chooseDialogue(id: string): void {
		this.ctx.npcs.choose(id);
	}

	closeVictory(): void {
		if (this.mode !== 'victory') return;
		this.ctx.audio.setMood('explore');
		this.setMode('playing');
		this.requestLock();
	}

	/** Respawn at the last waystone after defeat. */
	respawn(): void {
		const ctx = this.ctx;
		ctx.spells.clear();
		ctx.vfx.clearAll();
		ctx.pickups.clear();
		ctx.enemies.resetEncounters();
		ctx.enemies.setCleared(this.save.data.cleared);
		ctx.targeting.clear();
		ctx.playerCombat.reset();
		ctx.boss.reset();
		const cp = this.checkpointPosition();
		ctx.player.revive(cp.pos, cp.yaw);
		ctx.cameraCtl.snapBehind(cp.yaw + Math.PI);
		this.deathTimer = -1;
		ctx.audio.setMood('explore');
		this.setMode('playing');
		this.requestLock();
	}

	private onLockChange(locked: boolean): void {
		this.ui.setLocked(locked || this.input.allowUnlockedMouse);
		if (!locked && this.mode === 'playing' && !this.input.allowUnlockedMouse) this.pause();
	}

	private onKey(code: string): void {
		const m = this.mode;
		if (m === 'playing') {
			if (code === 'KeyI' || code === 'KeyC') this.openPanel('character');
			else if (code === 'KeyK') this.openPanel('skills');
			else if (code === 'KeyM') this.openPanel('map');
			else if (code === 'KeyP' || (code === 'Escape' && !this.input.locked)) this.pause();
		} else if (m === 'panel') {
			const p = this.panel;
			if (code === 'Escape' || (code === 'KeyI' && p === 'character') || (code === 'KeyC' && p === 'character') || (code === 'KeyK' && p === 'skills') || (code === 'KeyM' && p === 'map')) this.closePanel();
			else if (code === 'KeyI' || code === 'KeyC') this.openPanel('character');
			else if (code === 'KeyK') this.openPanel('skills');
			else if (code === 'KeyM') this.openPanel('map');
		} else if (m === 'paused') {
			// Browsers may also deliver the Esc that released the lock; ignore it briefly.
			if ((code === 'Escape' || code === 'KeyP') && performance.now() - this.modeAt > 400) this.resume();
		}
	}

	private onBeforeUnload = () => {
		if (this.ctx) this.saveSilently();
	};

	// ------------------------------------------------------------------ settings

	applySettings(s: Settings, persist = true): void {
		this.save.data.settings = { ...s };
		const ctx = this.ctx;
		ctx.settings = this.save.data.settings;
		if (persist) this.save.writeSettings(s);
		const preset = QUALITY_PRESETS[s.quality];
		ctx.world.sky.setShadowQuality(preset.shadows, preset.shadowSize);
		ctx.world.sky.setShadowExtent(preset.shadowExtent);
		if (this.renderer.shadowMap.enabled !== preset.shadows) {
			this.renderer.shadowMap.enabled = preset.shadows;
			this.scene.traverse((o) => {
				const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
				if (Array.isArray(m)) m.forEach((x) => (x.needsUpdate = true));
				else if (m) m.needsUpdate = true;
			});
		}
		ctx.world.setGrassQuality(preset.grassBlades, preset.grassArea);
		ctx.world.setDrawDistance(preset.drawDistance);
		ctx.world.chunks.detailScale = preset.detailScale;
		ctx.world.setVegetationDensity(preset.vegDensity);
		ctx.world.chunks.update(0, this.camera.position, true);
		ctx.vfx.setQuality(preset.particles);
		this.camera.far = preset.drawDistance + 900;
		this.camera.updateProjectionMatrix();
		ctx.cameraCtl.sensitivity = s.sensitivity;
		ctx.cameraCtl.invertY = s.invertY;
		ctx.cameraCtl.baseFov = s.fov;
		ctx.cameraCtl.shakeEnabled = s.shake;
		ctx.numbers.enabled = s.damageNumbers;
		this.setupPost(preset.bloom, preset.bloomStrength, preset.antialias);
		this.pixelScale = 1;
		this.applyPixelRatio();
		this.applyAudio();
	}

	private setupPost(bloom: boolean, strength: number, aa: boolean): void {
		this.composer?.dispose();
		this.composerTarget?.dispose();
		this.composer = null;
		this.bloom = null;
		this.composerTarget = null;
		if (!bloom) return;
		const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
		this.composerTarget = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: aa ? 4 : 0 });
		this.composer = new EffectComposer(this.renderer, this.composerTarget);
		this.composer.addPass(new RenderPass(this.scene, this.camera));
		this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), strength, 0.55, 0.92);
		this.composer.addPass(this.bloom);
		this.composer.addPass(new OutputPass());
	}

	private applyAudio(): void {
		const s = this.save.data.settings;
		this.ctx.audio.setVolumes(s.master, s.sfx, s.music);
	}

	private applyPixelRatio(): void {
		const preset = QUALITY_PRESETS[this.save.data.settings.quality];
		const pr = Math.max(0.5, Math.min(window.devicePixelRatio || 1, preset.pixelRatio) * this.pixelScale);
		this.renderer.setPixelRatio(pr);
		this.renderer.setSize(this.width, this.height, false);
		if (this.composer) {
			this.composer.setPixelRatio(pr);
			this.composer.setSize(this.width, this.height);
		}
		const h = this.height * pr;
		this.ctx?.world.ambience.setViewport(h, this.camera.fov);
	}

	private resize(): void {
		const parent = this.canvas.parentElement ?? this.canvas;
		this.width = Math.max(1, parent.clientWidth);
		this.height = Math.max(1, parent.clientHeight);
		this.camera.aspect = this.width / this.height;
		this.camera.updateProjectionMatrix();
		if (this.ctx) this.applyPixelRatio();
	}

	// ------------------------------------------------------------------ loop

	private fixed(dt: number): void {
		const t0 = performance.now();
		this.fixedInner(dt);
		this.simAcc += performance.now() - t0;
	}

	private simAcc = 0;

	private fixedInner(dt: number): void {
		const ctx = this.ctx;
		ctx.time += dt;
		ctx.profile.update(ctx.time);
		ctx.playerCombat.fixedUpdate(dt);
		ctx.player.fixedUpdate(dt);
		ctx.enemies.fixedUpdate(dt);
		ctx.boss.fixedUpdate(dt);
		ctx.spells.fixedUpdate(dt);
		ctx.physics.step();
		ctx.player.postStep();
		ctx.enemies.postStep();
		ctx.boss.postStep();
		ctx.combat.update();
	}

	private frame(dt: number, alpha: number): void {
		const t0 = performance.now();
		this.frameInner(dt, alpha, t0);
	}

	private frameInner(dt: number, alpha: number, t0: number): void {
		const ctx = this.ctx;
		this.perf.frames++;
		this.input.pollGamepad(dt);
		this.ui.setGamepad(this.input.gamepadActive);
		if (this.input.padButtonPressed(PAD.START)) {
			if (this.mode === 'playing') this.pause();
			else if (this.mode === 'paused' || this.mode === 'panel') this.resume();
		}
		if (this.loop.frozen) {
			// Keep the paused frame on screen without burning the GPU.
			this.pauseRender -= dt;
			if (this.pauseRender <= 0) {
				this.pauseRender = 0.25;
				this.render();
			}
			this.input.endFrame();
			return;
		}
		// Time feel: hit-stop and slow motion run on real time.
		this.hitStopT = Math.max(0, this.hitStopT - dt);
		this.slowT = Math.max(0, this.slowT - dt);
		this.loop.timeScale = this.hitStopT > 0 ? 0.05 : this.slowT > 0 ? this.slowScale : 1;
		const sdt = dt * this.loop.timeScale;

		if (this.mode === 'playing') ctx.playerCombat.readInput();
		if (this.deathTimer > 0) {
			this.deathTimer -= dt;
			if (this.deathTimer <= 0 && this.mode === 'playing') {
				this.setMode('dead');
				this.input.exitLock();
				ctx.audio.setMood('menu');
			}
		}
		ctx.player.update(sdt, alpha);
		ctx.enemies.update(sdt, alpha);
		ctx.boss.update(sdt, alpha);
		ctx.spells.update(sdt, alpha);
		ctx.targeting.update(dt);
		ctx.cameraCtl.update(dt);
		ctx.pickups.update(sdt);
		ctx.vfx.update(sdt);
		ctx.player.model.chestPosition(_v);
		ctx.vfx.shield.update(dt, _v);
		ctx.world.update(sdt, ctx.time, this.camera, ctx.player.renderPosition);
		ctx.interactables.update(dt);
		ctx.npcs.update(dt);
		ctx.quests.update(dt);
		this.trackRegion(dt);
		ctx.audio.setListener(this.camera.position, ctx.cameraCtl.yaw);
		const nearWater = ctx.player.inWater ? 1 : 0;
		ctx.audio.update(this.mode === 'menu' ? 'menu' : ctx.world.region, Math.min(1, ctx.enemies.engagedCount() / 2), nearWater, false);
		ctx.numbers.update(dt, this.camera, this.width, this.height);
		this.hudTimer -= dt;
		if (this.hudTimer <= 0 && (this.mode === 'playing' || this.mode === 'dead' || this.mode === 'cutscene')) {
			this.hudTimer = 0.1;
			this.ui.updateHud(this.snapshot());
		}
		this.adaptResolution(dt);
		if (this.mode === 'playing') this.save.data.playTime += dt;
		const t1 = performance.now();
		this.render();
		const t2 = performance.now();
		const k = 0.05;
		const pf = this.perf;
		pf.sim += (this.simAcc - pf.sim) * k;
		pf.logic += (t1 - t0 - pf.logic) * k;
		pf.render += (t2 - t1 - pf.render) * k;
		this.simAcc = 0;
		this.input.endFrame();
	}

	private render(): void {
		if (this.composer) this.composer.render();
		else this.renderer.render(this.scene, this.camera);
	}

	private trackRegion(dt: number): void {
		const ctx = this.ctx;
		if (this.mode !== 'playing') return;
		const p = ctx.player.position;
		const r = regionAt(p.x, p.z);
		if (r !== this.region) {
			const first = this.region === null;
			this.region = r;
			const def = REGIONS[r];
			if (!first) ctx.ui.banner(def.name, def.subtitle, 'region');
			ctx.events.emit('region', { id: r });
		}
		this.discoverTimer -= dt;
		if (this.discoverTimer > 0) return;
		this.discoverTimer = 0.5;
		const disc = this.save.data.discovered;
		for (const l of LANDMARKS) {
			if (disc.includes(l.id)) continue;
			if (Math.hypot(p.x - l.x, p.z - l.z) < l.r) {
				disc.push(l.id);
				ctx.ui.banner(l.name, 'Discovered', 'discovery');
				ctx.progression.addExp(20);
				ctx.audio.sfx('lore');
			}
		}
	}

	private adaptResolution(dt: number): void {
		if (!this.save.data.settings.adaptive) return;
		this.adaptTimer += dt;
		if (this.adaptTimer < 1.5) return;
		this.adaptTimer = 0;
		const ms = this.loop.avgFrameMs;
		const prev = this.pixelScale;
		if (ms > 21 && this.pixelScale > 0.55) this.pixelScale = Math.max(0.55, this.pixelScale - 0.1);
		else if (ms < 14.5 && this.pixelScale < 1) this.pixelScale = Math.min(1, this.pixelScale + 0.05);
		if (prev !== this.pixelScale) this.applyPixelRatio();
	}

	// ------------------------------------------------------------------ HUD

	private snapshot(): HudSnapshot {
		const ctx = this.ctx;
		const p = ctx.player;
		const pc = ctx.playerCombat;
		const st = ctx.progression.stats();
		const spells: SpellSlotHud[] = PLAYER_ELEMENTS.map((el: PlayerElement) => {
			const ids = ELEMENT_SPELLS[el];
			const b = SPELLS[ids.basic];
			const s = SPELLS[ids.special];
			return {
				element: el,
				basicName: b.name,
				specialName: s.name,
				basicCost: Math.round(pc.manaCost(b)),
				specialCost: Math.round(pc.manaCost(s)),
				basicCd: pc.cooldown(b.id) / b.cooldown,
				specialCd: pc.cooldown(s.id) / s.cooldown,
				specialCdSec: pc.cooldown(s.id)
			};
		});
		const t = ctx.targeting.focus;
		const boss = ctx.boss.hud();
		const obj = ctx.quests.objective();
		let bearing: number | null = null;
		let objDist = 0;
		if (obj) {
			const dx = obj.x - p.position.x;
			const dz = obj.z - p.position.z;
			objDist = Math.hypot(dx, dz);
			// Camera looks along (-sin yaw, -cos yaw); bearing 0 = straight ahead, positive = right.
			const ang = Math.atan2(dx, dz);
			bearing = wrapAngle(ang - (ctx.cameraCtl.yaw + Math.PI));
			bearing = -bearing;
		}
		const tEnemy = t as unknown as { barrierHp?: number; elite?: boolean } | null;
		return {
			hp: Math.ceil(p.hp),
			hpMax: p.maxHp,
			mana: p.mana,
			manaMax: st.maxMana,
			stamina: p.stamina,
			staminaMax: st.maxStamina,
			ward: Math.ceil(p.ward),
			level: ctx.progression.level,
			exp: ctx.progression.data.exp,
			expNext: ctx.progression.expNext(),
			aether: pc.aether / 100,
			element: pc.element,
			spells,
			charge: pc.chargeHud(),
			channelUnlocked: ctx.progression.hasAbility('prismatic_ray'),
			channeling: p.fsm.action === 'channeling',
			shielding: p.fsm.action === 'shielding',
			counter: p.statuses.has('counter'),
			ultimateReady: pc.aether >= 100,
			statuses: p.statuses.view(this.statusBuf).slice(),
			target:
				t && t.alive && !boss
					? {
							name: t.name,
							level: t.level,
							hp: Math.ceil(t.hp),
							maxHp: t.maxHp,
							statuses: t.statuses.view(this.targetStatusBuf).slice(),
							locked: ctx.targeting.locked === t,
							shield: Math.ceil(tEnemy?.barrierHp ?? 0),
							elite: !!tEnemy?.elite
						}
					: null,
			boss,
			quest: ctx.quests.hud(),
			prompt: ctx.interactables.prompt,
			region: ctx.world.regionName(p.position),
			heading: ctx.cameraCtl.yaw,
			objectiveBearing: bearing,
			objectiveDist: Math.round(objDist),
			fps: this.save.data.settings.showFps ? this.loop.fps : 0,
			potions: ctx.inventory.count('health_potion'),
			manaPotions: ctx.inventory.count('mana_potion'),
			combo: pc.combo,
			inCombat: p.inCombat,
			skillPoints: ctx.progression.data.skillPoints,
			attrPoints: ctx.progression.data.attrPoints,
			lowMana: p.mana < pc.manaCost(SPELLS[ELEMENT_SPELLS[pc.element].basic])
		};
	}

	getMapData(): MapData {
		const ctx = this.ctx;
		const p = ctx.player.position;
		const d = this.save.data;
		const markers: MapMarker[] = [];
		for (const l of LANDMARKS) markers.push({ id: l.id, name: d.discovered.includes(l.id) ? l.name : '???', icon: l.icon, x: l.x, z: l.z, kind: 'landmark', active: d.discovered.includes(l.id) });
		for (const w of WAYSTONES) markers.push({ id: w.id, name: w.name, icon: 'waystone', x: w.x, z: w.z, kind: 'waystone', active: d.waystones.includes(w.id) });
		if (d.quest.stage >= 1 && d.quest.stage <= 3) {
			for (const c of CRYSTALS) {
				if (d.quest.crystals.includes(c.id)) continue;
				const a = ctx.world.structures.anchors[c.anchor];
				markers.push({ id: c.id, name: c.name, icon: 'crystal', x: a.x, z: a.z, kind: 'crystal', active: true });
			}
		}
		const obj = ctx.quests.objective();
		return {
			image: this.mapImage!,
			player: { x: p.x, z: p.z, yaw: ctx.player.yaw },
			markers,
			objective: obj ? { x: obj.x, z: obj.z } : null,
			region: ctx.world.regionName(p)
		};
	}

	/** Snapshot of stats for the character panel. */
	getCharacter() {
		const ctx = this.ctx;
		return { progression: ctx.progression, inventory: ctx.inventory, stats: ctx.progression.stats(), mods: ctx.progression.mods(), player: ctx.player };
	}

	/** Combat totals for the victory screen. */
	getStats() {
		return { ...this.ctx.combat.stats, playTime: this.save.data.playTime, deaths: this.save.data.deaths, level: this.ctx.progression.level };
	}

	/** Dev/test hooks. */
	debug() {
		return this.ctx;
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
			this.saveSilently();
			ctx.enemies?.dispose();
			ctx.boss?.dispose();
			ctx.pickups?.dispose();
			ctx.interactables?.dispose();
			ctx.npcs?.dispose();
			ctx.vfx?.dispose();
			ctx.numbers?.dispose();
			ctx.player?.dispose();
			ctx.audio?.dispose();
			ctx.world?.dispose();
			ctx.physics?.dispose();
		}
		this.composer?.dispose();
		this.composerTarget?.dispose();
		this.renderer.dispose();
		this.renderer.forceContextLoss();
		this.events.clear();
	}
}
