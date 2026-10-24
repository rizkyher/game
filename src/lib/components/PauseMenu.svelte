<script lang="ts">
	import type { PanelId } from '../game/core/types';

	let { onresume, onopen, onsave, onquit }: { onresume: () => void; onopen: (p: PanelId) => void; onsave: () => boolean; onquit: () => void } = $props();
	let saved = $state('');

	function save() {
		saved = onsave() ? 'Progress saved' : 'Saving is unavailable in this browser';
		setTimeout(() => (saved = ''), 2200);
	}
</script>

<div class="absolute inset-0 z-30 grid place-items-center bg-ink-950/65 backdrop-blur-[2px]">
	<div class="af-panel af-fade-in flex w-[360px] flex-col items-stretch px-8 py-7">
		<div class="af-title text-center text-3xl font-bold">Paused</div>
		<div class="af-divider my-4"></div>
		<div class="flex flex-col gap-2.5">
			<button class="af-btn af-btn-primary h-11" onclick={onresume}>Resume</button>
			<button class="af-btn h-10 text-sm" onclick={() => onopen('character')}>Character &amp; Inventory</button>
			<button class="af-btn h-10 text-sm" onclick={() => onopen('skills')}>Skill Tree</button>
			<button class="af-btn h-10 text-sm" onclick={() => onopen('map')}>World Map</button>
			<div class="flex gap-2.5">
				<button class="af-btn h-10 flex-1 text-sm" onclick={() => onopen('settings')}>Settings</button>
				<button class="af-btn h-10 flex-1 text-sm" onclick={() => onopen('controls')}>Controls</button>
			</div>
			<button class="af-btn h-10 text-sm" onclick={save}>Save Game</button>
			<button class="af-btn h-10 text-sm" onclick={onquit}>Save &amp; Quit to Title</button>
		</div>
		{#if saved}<div class="mt-3 text-center text-gold-300 italic">{saved}</div>{/if}
	</div>
</div>
