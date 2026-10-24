<script lang="ts">
	import { onMount } from 'svelte';
	import type { Game } from '../game/core/Game';
	import type { PanelId } from '../game/core/types';
	import { UIState } from './uiState.svelte';
	import LoadingScreen from './LoadingScreen.svelte';
	import MainMenu from './MainMenu.svelte';
	import Hud from './Hud.svelte';
	import PauseMenu from './PauseMenu.svelte';
	import SettingsPanel from './SettingsPanel.svelte';
	import ControlsPanel from './ControlsPanel.svelte';
	import CharacterPanel from './CharacterPanel.svelte';
	import SkillTreePanel from './SkillTreePanel.svelte';
	import WorldMap from './WorldMap.svelte';
	import DialogueBox from './DialogueBox.svelte';
	import GameOver from './GameOver.svelte';
	import Victory from './Victory.svelte';
	import Notifications from './Notifications.svelte';

	const ui = new UIState();
	let canvas: HTMLCanvasElement;
	let popupLayer: HTMLDivElement;
	let game = $state<Game | null>(null);
	let error = $state('');
	/** Panels opened from the main menu (no game session yet). */
	let menuPanel = $state<'settings' | 'controls' | null>(null);
	let hasSave = $state(false);

	onMount(() => {
		let disposed = false;
		let instance: Game | null = null;
		const probe = document.createElement('canvas');
		if (!probe.getContext('webgl2')) {
			error = 'Your browser does not support WebGL 2, which Aetherfall needs to render its world.';
			return;
		}
		(async () => {
			try {
				// Three.js + Rapier load only in the browser, never during SSR/prerender.
				const { Game } = await import('../game/core/Game');
				if (disposed) return;
				instance = new Game(canvas, popupLayer, ui);
				game = instance;
				(window as unknown as { __game: Game }).__game = instance;
				await instance.init();
				hasSave = instance.hasSave();
			} catch (e) {
				console.error(e);
				error = e instanceof Error ? e.message : String(e);
			}
		})();
		return () => {
			disposed = true;
			instance?.dispose();
			game = null;
		};
	});

	function open(p: PanelId) {
		game?.openPanel(p);
	}

	function closePanel() {
		game?.closePanel();
	}
</script>

<div class="fixed inset-0 overflow-hidden bg-ink-950">
	<canvas bind:this={canvas} class="block h-full w-full outline-none" onclick={() => game?.capture()}></canvas>
	<div bind:this={popupLayer} class="pointer-events-none absolute inset-0 overflow-hidden"></div>

	{#if ui.mode === 'playing' || ui.mode === 'cutscene' || ui.mode === 'dead'}
		<Hud {ui} />
		{#if ui.mode === 'playing' && !ui.locked && !ui.gamepad}
			<button class="absolute inset-0 z-10 grid cursor-pointer place-items-center bg-ink-950/30" onclick={() => game?.capture()}>
				<span class="af-panel px-8 py-5 text-center">
					<span class="af-title block text-2xl">Click to resume</span>
					<span class="mt-1 block text-base text-gold-400 italic">Your mouse will be captured for aiming · Esc releases it</span>
				</span>
			</button>
		{/if}
	{/if}

	<Notifications {ui} />

	{#if ui.mode === 'menu' && game}
		{#if menuPanel === 'settings'}
			<SettingsPanel {game} onclose={() => (menuPanel = null)} />
		{:else if menuPanel === 'controls'}
			<ControlsPanel onclose={() => (menuPanel = null)} />
		{:else}
			<MainMenu
				{hasSave}
				onnew={() => game?.newGame()}
				oncontinue={() => game?.continueGame()}
				onsettings={() => (menuPanel = 'settings')}
				oncontrols={() => (menuPanel = 'controls')}
			/>
		{/if}
	{/if}

	{#if ui.mode === 'paused' && game && !ui.panel}
		<PauseMenu onresume={() => game?.resume()} onopen={open} onsave={() => game?.saveGame() ?? false} onquit={() => {
			game?.quitToMenu();
			hasSave = game?.hasSave() ?? false;
		}} />
	{/if}

	{#if game && ui.panel}
		{#if ui.panel === 'settings'}
			<SettingsPanel {game} onclose={closePanel} />
		{:else if ui.panel === 'controls'}
			<ControlsPanel onclose={closePanel} />
		{:else if ui.panel === 'character'}
			<CharacterPanel {game} {ui} onclose={closePanel} />
		{:else if ui.panel === 'skills'}
			<SkillTreePanel {game} {ui} onclose={closePanel} />
		{:else if ui.panel === 'map'}
			<WorldMap {game} onclose={closePanel} />
		{/if}
	{/if}

	{#if ui.mode === 'dialogue' && ui.dialogue && game}
		<DialogueBox d={ui.dialogue} onnext={() => game?.advanceDialogue()} onchoose={(id) => game?.chooseDialogue(id)} />
	{/if}

	{#if ui.mode === 'dead' && game}
		<GameOver onrespawn={() => game?.respawn()} onquit={() => game?.quitToMenu()} />
	{/if}

	{#if ui.mode === 'victory' && game}
		<Victory stats={game.getStats()} oncontinue={() => game?.closeVictory()} />
	{/if}

	{#if ui.mode === 'loading' || error}
		<LoadingScreen progress={ui.progress} label={ui.loadingLabel} {error} />
	{/if}
</div>
