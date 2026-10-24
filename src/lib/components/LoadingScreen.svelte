<script lang="ts">
	let { progress, label, error }: { progress: number; label: string; error: string } = $props();
</script>

<div class="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-sky-300 via-sky-200 to-lime-200 text-bark-800">
	<div class="mb-6 animate-bounce text-7xl drop-shadow-lg">🐝</div>
	<h1 class="bm-stroke mb-2 text-5xl font-black tracking-tight text-honey-400 sm:text-6xl">BUZZ MAYHEM</h1>
	{#if error}
		<div class="bm-panel mt-6 max-w-md px-6 py-4 text-center">
			<p class="text-lg font-black">Oh no, the hive collapsed!</p>
			<p class="mt-2 text-sm font-semibold opacity-80">{error}</p>
			<button class="bm-btn mt-4 px-5 py-2" onclick={() => location.reload()}>Try again</button>
		</div>
	{:else}
		<div class="mt-6 h-5 w-72 overflow-hidden rounded-full border-[3px] border-bark-800 bg-white/70">
			<div class="h-full rounded-full bg-gradient-to-r from-honey-300 to-honey-600 transition-[width] duration-300" style="width: {Math.round(progress * 100)}%"></div>
		</div>
		<p class="mt-3 text-sm font-bold opacity-75">{label}…</p>
	{/if}
</div>
