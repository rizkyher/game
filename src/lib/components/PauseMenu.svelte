<script lang="ts">
	import { untrack } from 'svelte';
	import type { Game } from '../game/core/Game';

	let { game, onresume, onopen }: { game: Game; onresume: () => void; onopen: (p: 'settings' | 'controls' | 'progress') => void } = $props();
	// Snapshot when the menu opens.
	const progress = untrack(() => game.getProgress());
</script>

<div class="absolute inset-0 flex items-center justify-center bg-bark-900/45 px-4 backdrop-blur-[2px]">
	<div class="bm-panel max-h-[94vh] w-full max-w-sm overflow-y-auto px-6 py-5">
		<h2 class="text-center text-3xl font-black">⏸ Paused</h2>
		<p class="mt-1 text-center text-xs font-bold opacity-70">Mouse released. Resume to keep buzzing.</p>
		<div class="mt-5 flex flex-col gap-2.5">
			<button class="bm-btn py-3 text-xl" onclick={onresume}>▶ Resume</button>
			<div class="grid grid-cols-3 gap-2">
				<button class="bm-btn bm-btn-ghost py-2 text-sm" onclick={() => onopen('settings')}>⚙️ Settings</button>
				<button class="bm-btn bm-btn-ghost py-2 text-sm" onclick={() => onopen('controls')}>🎮 Controls</button>
				<button class="bm-btn bm-btn-ghost py-2 text-sm" onclick={() => onopen('progress')}>🏆 Progress</button>
			</div>
			{#if progress.activeChallenge}
				<button
					class="bm-btn bm-btn-ghost py-2 text-sm"
					onclick={() => {
						game.abandonChallenge();
						onresume();
					}}>🏳️ Abandon “{progress.activeChallenge}”</button
				>
			{/if}
			<button
				class="bm-btn bm-btn-ghost py-2 text-sm"
				onclick={() => {
					game.respawn();
					onresume();
				}}>🌼 Return to the meadow</button
			>
			<button class="bm-btn bm-btn-ghost py-2 text-sm" onclick={() => game.quitToMenu()}>🏠 Main menu</button>
		</div>
		<div class="mt-5 grid grid-cols-3 gap-2 text-center text-xs font-bold">
			<div class="rounded-xl bg-white/70 py-2"><div class="text-lg font-black">{progress.bestChaos.toLocaleString()}</div>best chaos</div>
			<div class="rounded-xl bg-white/70 py-2"><div class="text-lg font-black">{progress.orbs}/{progress.orbsTotal}</div>golden orbs</div>
			<div class="rounded-xl bg-white/70 py-2"><div class="text-lg font-black">{progress.species}/{progress.speciesTotal}</div>species</div>
		</div>
	</div>
</div>
