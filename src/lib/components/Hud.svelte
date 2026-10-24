<script lang="ts">
	import type { UIState } from './uiState.svelte';

	let { ui }: { ui: UIState } = $props();
	const h = $derived(ui.hud);
	const showFps = $derived(ui.hud.fps > 0);

	// Compass: camera yaw -> heading in degrees (0 = north / -Z).
	const headingDeg = $derived(((((-h.heading * 180) / Math.PI) % 360) + 360) % 360);
	const marks = [
		{ label: 'N', deg: 0 },
		{ label: 'E', deg: 90 },
		{ label: 'S', deg: 180 },
		{ label: 'W', deg: 270 }
	];
	function markOffset(deg: number, heading: number): number {
		let d = deg - heading;
		d = ((d + 540) % 360) - 180;
		return d;
	}
	function fmt(s: number): string {
		const m = Math.floor(s / 60);
		return `${m}:${Math.floor(s % 60)
			.toString()
			.padStart(2, '0')}`;
	}
</script>

<div class="pointer-events-none absolute inset-0 text-bark-800">
	<!-- Chaos score -->
	<div class="absolute top-4 left-4">
		<div class="text-xs font-black tracking-[0.25em] text-white drop-shadow">CHAOS</div>
		<div class="bm-stroke text-4xl leading-none font-black text-honey-300 tabular-nums drop-shadow-[0_3px_0_rgba(62,42,23,0.6)]">
			{h.chaos.toLocaleString()}
		</div>
		{#if h.combo > 1}
			<div class="mt-1 flex items-center gap-2">
				<span class="rounded-lg border-2 border-bark-800 bg-pink-400 px-2 py-0.5 text-lg font-black text-white">x{h.combo}</span>
				<div class="h-2 w-24 overflow-hidden rounded-full border-2 border-bark-800 bg-white/70">
					<div class="h-full bg-pink-500" style="width: {h.comboTime * 100}%"></div>
				</div>
			</div>
		{/if}
	</div>

	<!-- Compass + region -->
	<div class="absolute top-3 left-1/2 flex -translate-x-1/2 flex-col items-center">
		<div class="relative h-7 w-64 overflow-hidden rounded-full border-2 border-bark-800/70 bg-white/55 backdrop-blur-sm">
			{#each marks as m (m.label)}
				{@const off = markOffset(m.deg, headingDeg)}
				{#if Math.abs(off) < 70}
					<span class="absolute top-0.5 -translate-x-1/2 text-sm font-black {m.label === 'N' ? 'text-red-600' : ''}" style="left: {50 + (off / 70) * 50}%">{m.label}</span>
				{/if}
			{/each}
			<span class="absolute top-0 left-1/2 h-full w-0.5 -translate-x-1/2 bg-bark-800/60"></span>
		</div>
		<div class="mt-1.5 rounded-full bg-bark-800/80 px-3 py-0.5 text-sm font-bold text-honey-100">{h.region}</div>
	</div>

	<!-- Collection counters -->
	<div class="absolute top-4 right-4 flex flex-col items-end gap-1.5">
		<div class="flex gap-1.5">
			<span class="rounded-xl border-2 border-bark-800 bg-white/85 px-2.5 py-1 text-sm font-black tabular-nums">🌼 {h.pollen}</span>
			<span class="rounded-xl border-2 border-bark-800 bg-white/85 px-2.5 py-1 text-sm font-black tabular-nums {h.nectar >= h.nectarCap ? 'bg-honey-200' : ''}">💧 {h.nectar}/{h.nectarCap}</span>
			<span class="rounded-xl border-2 border-bark-800 bg-white/85 px-2.5 py-1 text-sm font-black tabular-nums">🍯 {h.honey}</span>
			<span class="rounded-xl border-2 border-bark-800 bg-white/85 px-2.5 py-1 text-sm font-black tabular-nums">✨ {h.orbs}/{h.orbsTotal}</span>
		</div>
		{#if showFps}
			<span class="rounded-md bg-black/40 px-1.5 text-xs font-bold text-white tabular-nums">{h.fps} fps · {h.speed} m/s</span>
		{/if}
	</div>

	<!-- Active challenge -->
	{#if h.challenge}
		{@const c = h.challenge}
		<div class="bm-panel absolute top-24 right-4 w-60 px-4 py-3">
			<div class="flex items-center justify-between">
				<span class="text-sm font-black">{c.title}</span>
				{#if c.timeLeft !== null}
					<span class="rounded-md bg-bark-800 px-1.5 text-xs font-black text-honey-200 tabular-nums {c.timeLeft < 10 ? 'animate-pulse bg-red-600' : ''}">{fmt(c.timeLeft)}</span>
				{/if}
			</div>
			<div class="mt-1 text-xs font-bold opacity-80">{c.detail}</div>
			<div class="mt-2 h-2.5 overflow-hidden rounded-full border-2 border-bark-800 bg-white">
				<div class="h-full bg-gradient-to-r from-honey-300 to-honey-600 transition-[width] duration-200" style="width: {c.progress * 100}%"></div>
			</div>
			{#if c.arrow !== null}
				<div class="mt-2 flex items-center justify-center gap-2 text-xs font-bold">
					<span class="inline-block text-2xl text-honey-600 transition-transform duration-100" style="transform: rotate({(-c.arrow * 180) / Math.PI}deg)">⬆</span>
					next objective
				</div>
			{/if}
		</div>
	{/if}

	<!-- Crosshair -->
	<div class="absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 shadow-[0_0_0_2px_rgba(62,42,23,0.4)]"></div>

	<!-- Status / struggle -->
	{#if h.status}
		<div class="absolute top-[62%] left-1/2 -translate-x-1/2 text-center">
			<div class="bm-stroke text-2xl font-black text-white {h.struggle > 0 || h.status.startsWith('STUCK') || h.status.startsWith('CAUGHT') ? 'animate-pulse' : ''}">{h.status}</div>
			{#if h.struggle > 0 || h.status.startsWith('STUCK') || h.status.startsWith('CAUGHT')}
				<div class="mx-auto mt-2 h-3 w-56 overflow-hidden rounded-full border-2 border-bark-800 bg-white/80">
					<div class="h-full bg-gradient-to-r from-lime-300 to-lime-600" style="width: {h.struggle * 100}%"></div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Prompt + boost -->
	<div class="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2">
		{#if h.prompt}
			<div class="rounded-xl border-2 border-bark-800 bg-white/90 px-4 py-1.5 text-sm font-black shadow-[0_3px_0_rgba(62,42,23,0.5)]">{h.prompt}</div>
		{/if}
		<div class="flex items-center gap-2">
			<span class="text-xs font-black tracking-widest text-white drop-shadow">BOOST</span>
			<div class="h-3.5 w-56 overflow-hidden rounded-full border-2 border-bark-800 bg-white/70">
				<div
					class="h-full rounded-full transition-[width] duration-100 {h.boost < 0.2 ? 'bg-red-400' : 'bg-gradient-to-r from-sky-300 to-sky-500'}"
					style="width: {h.boost * 100}%"
				></div>
			</div>
		</div>
	</div>

	<div class="absolute bottom-4 left-4 rounded-lg bg-black/30 px-2 py-1 text-xs font-bold text-white/90">
		<b>M</b> map · <b>Esc</b> pause · <b>E</b> interact
	</div>
</div>
