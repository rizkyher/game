<script lang="ts">
	let { progress, label, error }: { progress: number; label: string; error: string } = $props();
</script>

<div class="absolute inset-0 z-50 grid place-items-center bg-[radial-gradient(ellipse_at_center,#1d1640_0%,#07060f_70%)]">
	<div class="flex w-[460px] max-w-[90vw] flex-col items-center text-center">
		<div class="af-title text-5xl font-black tracking-[0.25em]">AETHERFALL</div>
		<div class="mt-1 text-lg tracking-[0.35em] text-arcane-300 italic">Echoes of the Arcane</div>
		{#if error}
			<div class="af-panel mt-10 px-6 py-5 text-left">
				<div class="font-display text-sm tracking-widest text-[#ff8a7a]">THE AETHER FALTERS</div>
				<p class="mt-2 text-lg">{error}</p>
				<p class="mt-2 text-sm text-gold-400">Try a recent desktop browser with WebGL 2 and hardware acceleration enabled.</p>
			</div>
		{:else}
			<div class="relative mt-12 h-[3px] w-full overflow-hidden bg-white/10">
				<div class="h-full bg-gradient-to-r from-arcane-500 via-arcane-300 to-gold-300 transition-[width] duration-300" style="width: {progress * 100}%"></div>
			</div>
			<div class="mt-3 text-lg text-gold-300/90 italic">{label}…</div>
		{/if}
	</div>
</div>
