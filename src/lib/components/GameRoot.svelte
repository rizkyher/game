<script lang="ts">
	import { onMount } from 'svelte';
	import type { Game } from '../game/core/Game';
	import { UIState } from './uiState.svelte';
	import LoadingScreen from './LoadingScreen.svelte';
	import MainMenu from './MainMenu.svelte';
	import Hud from './Hud.svelte';
	import PauseMenu from './PauseMenu.svelte';
	import SettingsPanel from './SettingsPanel.svelte';
	import ControlsPanel from './ControlsPanel.svelte';
	import ProgressPanel from './ProgressPanel.svelte';
	import WorldMap from './WorldMap.svelte';
	import Notifications from './Notifications.svelte';

	type Panel = 'none' | 'settings' | 'controls' | 'progress';

	const ui = new UIState();
	let canvas: HTMLCanvasElement;
	let popupLayer: HTMLDivElement;
	let game = $state<Game | null>(null);
	let panel = $state<Panel>('none');
	let error = $state('');

	onMount(() => {
		let disposed = false;
		let instance: Game | null = null;
		const probe = document.createElement('canvas');
		if (!probe.getContext('webgl2')) {
			error = 'Your browser does not support WebGL 2, which Buzz Mayhem needs to render the world.';
			return;
		}
		(async () => {
			try {
				// Three.js + Rapier are loaded only in the browser, never during SSR.
				const { Game } = await import('../game/core/Game');
				if (disposed) return;
				instance = new Game(canvas, popupLayer, ui);
				game = instance;
				// Dev-only handle for debugging in the console.
				if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = instance;
				await instance.init();
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

	function open(p: Panel) {
		panel = p;
	}

	function play() {
		panel = 'none';
		game?.start();
	}

	function resume() {
		panel = 'none';
		game?.resume();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.code !== 'Escape') return;
		if (panel !== 'none') {
			panel = 'none';
			e.preventDefault();
		} else if (ui.mapOpen) ui.toggleMap(false);
		// Some browsers also deliver the Esc that released pointer lock; don't bounce straight back.
		else if (ui.mode === 'paused' && performance.now() - ui.modeChangedAt > 500) resume();
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div class="fixed inset-0 overflow-hidden">
	<canvas bind:this={canvas} class="block h-full w-full outline-none" onclick={() => game?.capture()}></canvas>
	<div bind:this={popupLayer} class="pointer-events-none absolute inset-0 overflow-hidden"></div>

	{#if ui.mode === 'playing'}
		<Hud {ui} />
		{#if !ui.locked && !ui.gamepad}
			<button
				class="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/25 text-white"
				onclick={() => game?.capture()}
			>
				<span class="bm-panel px-8 py-5 text-center text-xl font-black">
					🖱️ Click to fly
					<span class="mt-1 block text-sm font-bold opacity-70">Your mouse will be captured · press Esc to release it</span>
				</span>
			</button>
		{/if}
	{/if}

	{#if ui.mapOpen && game}
		<WorldMap {game} onclose={() => ui.toggleMap(false)} />
	{/if}

	<Notifications {ui} />

	{#if ui.mode === 'menu' && panel === 'none'}
		<MainMenu {game} onplay={play} onopen={open} />
	{/if}

	{#if ui.mode === 'paused' && panel === 'none' && game}
		<PauseMenu {game} onresume={resume} onopen={open} />
	{/if}

	{#if panel === 'settings' && game}
		<SettingsPanel {game} onclose={() => (panel = 'none')} />
	{:else if panel === 'controls'}
		<ControlsPanel onclose={() => (panel = 'none')} />
	{:else if panel === 'progress' && game}
		<ProgressPanel {game} onclose={() => (panel = 'none')} />
	{/if}

	{#if ui.mode === 'loading' || error}
		<LoadingScreen progress={ui.progress} label={ui.loadingLabel} {error} />
	{/if}
</div>
