<script lang="ts">
	import { fly } from 'svelte/transition';
	import type { UIState } from './uiState.svelte';

	let { ui }: { ui: UIState } = $props();
	const styles: Record<string, string> = {
		region: 'bg-sky-100',
		achievement: 'bg-honey-200',
		challenge: 'bg-violet-100',
		discovery: 'bg-lime-100',
		trick: 'bg-cyan-100',
		warning: 'bg-rose-100',
		info: 'bg-white'
	};
	const labels: Record<string, string> = {
		region: 'DISCOVERED',
		achievement: 'ACHIEVEMENT',
		challenge: 'ACTIVITY',
		discovery: 'FOUND',
		trick: 'CHAOS',
		warning: 'UH OH',
		info: ''
	};
</script>

<div class="pointer-events-none absolute top-20 left-1/2 z-20 flex w-80 -translate-x-1/2 flex-col items-center gap-2">
	{#each ui.notices as n (n.id)}
		<div
			class="w-full rounded-2xl border-[3px] border-bark-800 px-4 py-2 text-center text-bark-800 shadow-[0_4px_0_rgba(62,42,23,0.55)] {styles[n.kind]}"
			in:fly={{ y: -16, duration: 220 }}
			out:fly={{ y: -10, duration: 200 }}
		>
			{#if labels[n.kind]}
				<div class="text-[10px] font-black tracking-[0.25em] opacity-60">{labels[n.kind]}</div>
			{/if}
			<div class="text-base leading-tight font-black">{n.title}</div>
			{#if n.detail}
				<div class="text-xs font-semibold opacity-75">{n.detail}</div>
			{/if}
		</div>
	{/each}
</div>
