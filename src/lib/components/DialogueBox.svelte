<script lang="ts">
	import type { DialogueView } from '../game/core/types';

	let { d, onnext, onchoose }: { d: DialogueView; onnext: () => void; onchoose: (id: string) => void } = $props();
	// `d` can turn null for a moment while the box closes (before the parent unmounts it).
	const last = $derived(!d || d.index >= d.lines.length - 1);

	function onKey(e: KeyboardEvent) {
		if (!d) return;
		if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') {
			e.preventDefault();
			if (!(last && d.choices?.length)) onnext();
			return;
		}
		if (d.choices && last) {
			const n = Number(e.key);
			if (n >= 1 && n <= d.choices.length) onchoose(d.choices[n - 1].id);
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="absolute inset-x-0 bottom-0 z-30 flex justify-center pb-10">
	<div class="af-panel af-fade-in w-[820px] max-w-[94vw] px-8 py-5">
		<div class="flex items-baseline gap-3">
			<span class="af-title text-xl font-bold">{d.speaker}</span>
			<span class="text-sm text-arcane-300 italic">{d.title}</span>
		</div>
		<div class="af-divider my-2"></div>
		<p class="min-h-[64px] text-[21px] leading-snug text-[#f2ead8]">{d.lines[d.index]}</p>
		<div class="mt-3 flex items-center justify-end gap-3">
			{#if last && d.choices?.length}
				{#each d.choices as c, i (c.id)}
					<button class="af-btn h-10 px-5 text-xs" onclick={() => onchoose(c.id)}><span class="af-key mr-1">{i + 1}</span>{c.label}</button>
				{/each}
			{:else}
				<span class="text-sm text-gold-400/80 italic">{d.index + 1} / {d.lines.length}</span>
				<button class="af-btn h-10 px-5 text-xs" onclick={onnext}>{last ? 'Farewell' : 'Continue'} <span class="af-key">E</span></button>
			{/if}
		</div>
	</div>
</div>
