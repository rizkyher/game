<script lang="ts">
	import type { Game } from '../game/core/Game';

	let { game, onplay, onopen }: { game: Game | null; onplay: () => void; onopen: (p: 'settings' | 'controls' | 'progress') => void } = $props();
	const best = $derived(game ? game.save.data.bestChaos : 0);
	const honey = $derived(game ? game.save.data.honey : 0);
</script>

<div class="absolute inset-0 flex flex-col items-center justify-between bg-gradient-to-b from-black/10 via-transparent to-black/30 px-4 py-10">
	<div class="text-center">
		<div class="text-6xl drop-shadow-lg sm:text-7xl">🐝</div>
		<h1 class="bm-stroke text-6xl leading-none font-black tracking-tight text-honey-300 drop-shadow-[0_6px_0_rgba(62,42,23,0.6)] sm:text-8xl">
			BUZZ<br />MAYHEM
		</h1>
		<p class="mt-3 inline-block rounded-full bg-bark-800/80 px-4 py-1 text-sm font-bold text-honey-100 sm:text-base">
			A tiny bee. A giant world. Absolutely no rules.
		</p>
	</div>

	<div class="flex w-full max-w-xs flex-col gap-3">
		<button class="bm-btn py-4 text-2xl" onclick={onplay}>▶ Play</button>
		<div class="grid grid-cols-3 gap-2">
			<button class="bm-btn bm-btn-ghost py-2 text-sm" onclick={() => onopen('settings')}>⚙️ Settings</button>
			<button class="bm-btn bm-btn-ghost py-2 text-sm" onclick={() => onopen('controls')}>🎮 Controls</button>
			<button class="bm-btn bm-btn-ghost py-2 text-sm" onclick={() => onopen('progress')}>🏆 Progress</button>
		</div>
		{#if best > 0 || honey > 0}
			<p class="text-center text-sm font-bold text-white drop-shadow">Best chaos {best.toLocaleString()} · Honey {honey}</p>
		{/if}
	</div>

	<p class="rounded-full bg-black/35 px-4 py-1.5 text-center text-xs font-semibold text-white/90 sm:text-sm">
		Play captures your mouse for flying · <b>Esc</b> releases it · works best with a keyboard &amp; mouse
	</p>
</div>
