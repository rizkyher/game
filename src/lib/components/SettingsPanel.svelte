<script lang="ts">
	import { untrack } from 'svelte';
	import type { Game } from '../game/core/Game';
	import { QUALITY_PRESETS, type Quality, type Settings } from '../game/core/Settings';

	let { game, onclose }: { game: Game; onclose: () => void } = $props();
	// Local editable copy; every change is applied live.
	let s = $state<Settings>(untrack(() => ({ ...game.settings })));
	const startAA = untrack(() => QUALITY_PRESETS[game.settings.quality].antialias);
	const qualities = Object.entries(QUALITY_PRESETS) as [Quality, (typeof QUALITY_PRESETS)[Quality]][];

	function apply() {
		game.applySettings($state.snapshot(s));
	}
	function setQuality(q: Quality) {
		s.quality = q;
		apply();
	}
</script>

<div class="absolute inset-0 z-40 flex items-center justify-center bg-bark-900/45 px-4 backdrop-blur-[2px]">
	<div class="bm-panel max-h-[90vh] w-full max-w-md overflow-y-auto px-6 py-5">
		<div class="flex items-center justify-between">
			<h2 class="text-2xl font-black">⚙️ Settings</h2>
			<button class="bm-btn bm-btn-ghost h-9 w-9 text-lg" onclick={onclose} aria-label="Close">✕</button>
		</div>

		<h3 class="mt-4 text-xs font-black tracking-widest opacity-60">GRAPHICS</h3>
		<div class="mt-2 grid grid-cols-4 gap-1.5">
			{#each qualities as [q, preset] (q)}
				<button class="bm-btn py-1.5 text-sm {s.quality === q ? '' : 'bm-btn-ghost'}" onclick={() => setQuality(q)}>{preset.label}</button>
			{/each}
		</div>
		<p class="mt-1.5 text-xs font-semibold opacity-60">
			Shadows {QUALITY_PRESETS[s.quality].shadows ? `${QUALITY_PRESETS[s.quality].shadowSize}px` : 'off'} · draw distance {QUALITY_PRESETS[s.quality].drawDistance} m · {QUALITY_PRESETS[s.quality].grassBlades.toLocaleString()} grass blades
			{#if QUALITY_PRESETS[s.quality].antialias !== startAA}
				· anti-aliasing changes after reload
			{/if}
		</p>
		<label class="mt-3 flex items-center justify-between text-sm font-bold">
			Adaptive resolution
			<input type="checkbox" class="h-5 w-5 accent-honey-600" bind:checked={s.adaptive} onchange={apply} />
		</label>
		<label class="mt-2 flex items-center justify-between text-sm font-bold">
			Show FPS
			<input type="checkbox" class="h-5 w-5 accent-honey-600" bind:checked={s.showFps} onchange={apply} />
		</label>

		<h3 class="mt-5 text-xs font-black tracking-widest opacity-60">CAMERA</h3>
		<label class="mt-2 block text-sm font-bold">
			Mouse sensitivity <span class="float-right tabular-nums">{s.sensitivity.toFixed(2)}</span>
			<input type="range" class="bm-range" min="0.2" max="3" step="0.05" bind:value={s.sensitivity} oninput={apply} />
		</label>
		<label class="mt-2 block text-sm font-bold">
			Field of view <span class="float-right tabular-nums">{s.fov}°</span>
			<input type="range" class="bm-range" min="60" max="100" step="1" bind:value={s.fov} oninput={apply} />
		</label>
		<label class="mt-2 flex items-center justify-between text-sm font-bold">
			Invert Y axis
			<input type="checkbox" class="h-5 w-5 accent-honey-600" bind:checked={s.invertY} onchange={apply} />
		</label>
		<label class="mt-2 flex items-center justify-between text-sm font-bold">
			Screen shake
			<input type="checkbox" class="h-5 w-5 accent-honey-600" bind:checked={s.shake} onchange={apply} />
		</label>

		<h3 class="mt-5 text-xs font-black tracking-widest opacity-60">AUDIO</h3>
		{#each [['master', 'Master'], ['sfx', 'Effects'], ['music', 'Music']] as [key, label] (key)}
			{@const k = key as 'master' | 'sfx' | 'music'}
			<label class="mt-2 block text-sm font-bold">
				{label} <span class="float-right tabular-nums">{Math.round(s[k] * 100)}%</span>
				<input type="range" class="bm-range" min="0" max="1" step="0.01" bind:value={s[k]} oninput={apply} />
			</label>
		{/each}

		<div class="mt-6 flex items-center justify-between gap-3">
			<button
				class="bm-btn bm-btn-ghost px-3 py-1.5 text-xs"
				onclick={() => {
					if (confirm('Reset all progress (achievements, orbs, scores)? Settings are kept.')) game.resetProgress();
				}}>Reset progress</button
			>
			<button class="bm-btn px-6 py-2" onclick={onclose}>Done</button>
		</div>
	</div>
</div>
