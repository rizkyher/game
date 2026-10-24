<script lang="ts">
	import type { UIState } from './uiState.svelte';

	let { ui }: { ui: UIState } = $props();
	const accent: Record<string, string> = {
		info: '#cfb3ff',
		item: '#8affb0',
		quest: '#e8cf8a',
		level: '#ffd070',
		warning: '#ff8a7a',
		lore: '#9ad8ff',
		reaction: '#ffffff'
	};
	const bannerStyle: Record<string, string> = {
		region: 'text-5xl',
		discovery: 'text-3xl',
		level: 'text-5xl',
		quest: 'text-4xl',
		boss: 'text-6xl',
		victory: 'text-6xl'
	};
	const bannerKicker: Record<string, string> = {
		region: 'ENTERING',
		discovery: 'LANDMARK',
		level: 'LEVEL UP',
		quest: 'QUEST',
		boss: '',
		victory: 'VICTORY'
	};
</script>

<!-- Toasts (right side) -->
<div class="pointer-events-none absolute top-[230px] right-5 z-20 flex w-[340px] flex-col items-end gap-2">
	{#each ui.notices as n (n.id)}
		<div class="af-glass af-fade-in w-full rounded-sm border-l-2 px-4 py-2 text-right" style="border-left-color: {accent[n.kind]}">
			<div class="font-display text-sm tracking-wider" style="color: {accent[n.kind]}">{n.title}</div>
			{#if n.detail}<div class="text-[15px] leading-snug text-[#e8dcc4]/90">{n.detail}</div>{/if}
		</div>
	{/each}
</div>

<!-- Centre banners -->
<div class="pointer-events-none absolute inset-x-0 top-[18%] z-20 flex flex-col items-center">
	{#each ui.banners as b (b.id)}
		<div class="af-fade-in flex flex-col items-center text-center">
			{#if bannerKicker[b.kind]}<div class="font-display text-sm tracking-[0.6em] text-gold-400">{bannerKicker[b.kind]}</div>{/if}
			<div class="af-title {bannerStyle[b.kind]} font-bold {b.kind === 'boss' ? 'text-[#ffb0e0]' : ''}">{b.title}</div>
			<div class="af-divider my-2 w-[420px]"></div>
			<div class="text-xl tracking-wide text-[#e8dcc4] italic drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">{b.subtitle}</div>
		</div>
	{/each}
</div>
