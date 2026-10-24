<script lang="ts">
	import { untrack } from 'svelte';
	import type { Game } from '../game/core/Game';
	import { QUALITY_PRESETS, type Quality, type Settings } from '../game/core/Settings';

	let { game, onclose }: { game: Game; onclose: () => void } = $props();
	// Local editable copy, seeded once from the game's current settings.
	let s = $state<Settings>(untrack(() => ({ ...game.settings })));
	const qualities = Object.keys(QUALITY_PRESETS) as Quality[];

	function apply(patch: Partial<Settings>) {
		s = { ...s, ...patch };
		game.applySettings(s);
	}
</script>

<div class="absolute inset-0 z-40 grid place-items-center bg-ink-950/70 backdrop-blur-[2px]">
	<div class="af-panel af-fade-in w-[560px] max-w-[94vw] px-8 py-6">
		<div class="flex items-center justify-between">
			<div class="af-title text-2xl font-bold">Settings</div>
			<button class="af-btn h-9 px-4 text-xs" onclick={onclose}>Close</button>
		</div>
		<div class="af-divider my-4"></div>
		<div class="grid grid-cols-[150px_1fr] items-center gap-x-5 gap-y-3.5 text-[17px]">
			<span class="font-display text-xs tracking-widest text-gold-300">GRAPHICS</span>
			<div class="flex gap-2">
				{#each qualities as q (q)}
					<button class="af-btn h-9 flex-1 text-xs {s.quality === q ? 'af-btn-primary' : ''}" onclick={() => apply({ quality: q })}>{QUALITY_PRESETS[q].label}</button>
				{/each}
			</div>
			<span class="text-sm text-gold-400/80">Preset details</span>
			<span class="text-sm text-[#e8dcc4]/80">
				{QUALITY_PRESETS[s.quality].shadows ? `Shadows ${QUALITY_PRESETS[s.quality].shadowSize}px` : 'No shadows'} · {QUALITY_PRESETS[s.quality].bloom ? 'Bloom' : 'No bloom'} · View
				{QUALITY_PRESETS[s.quality].drawDistance} m
			</span>
			<label for="adaptive">Adaptive resolution</label>
			<input id="adaptive" type="checkbox" class="h-5 w-5 accent-gold-500" checked={s.adaptive} onchange={(e) => apply({ adaptive: e.currentTarget.checked })} />
			<label for="sens">Mouse sensitivity</label>
			<input id="sens" type="range" class="af-range" min="0.3" max="2.5" step="0.05" value={s.sensitivity} oninput={(e) => apply({ sensitivity: +e.currentTarget.value })} />
			<label for="fov">Field of view</label>
			<input id="fov" type="range" class="af-range" min="55" max="95" step="1" value={s.fov} oninput={(e) => apply({ fov: +e.currentTarget.value })} />
			<label for="invert">Invert Y</label>
			<input id="invert" type="checkbox" class="h-5 w-5 accent-gold-500" checked={s.invertY} onchange={(e) => apply({ invertY: e.currentTarget.checked })} />
			<label for="shake">Camera shake</label>
			<input id="shake" type="checkbox" class="h-5 w-5 accent-gold-500" checked={s.shake} onchange={(e) => apply({ shake: e.currentTarget.checked })} />
			<label for="assist">Aim assist</label>
			<input id="assist" type="checkbox" class="h-5 w-5 accent-gold-500" checked={s.aimAssist} onchange={(e) => apply({ aimAssist: e.currentTarget.checked })} />
			<label for="numbers">Damage numbers</label>
			<input id="numbers" type="checkbox" class="h-5 w-5 accent-gold-500" checked={s.damageNumbers} onchange={(e) => apply({ damageNumbers: e.currentTarget.checked })} />
			<span class="font-display text-xs tracking-widest text-gold-300">AUDIO</span>
			<span></span>
			<label for="master">Master</label>
			<input id="master" type="range" class="af-range" min="0" max="1" step="0.05" value={s.master} oninput={(e) => apply({ master: +e.currentTarget.value })} />
			<label for="sfx">Effects</label>
			<input id="sfx" type="range" class="af-range" min="0" max="1" step="0.05" value={s.sfx} oninput={(e) => apply({ sfx: +e.currentTarget.value })} />
			<label for="music">Music</label>
			<input id="music" type="range" class="af-range" min="0" max="1" step="0.05" value={s.music} oninput={(e) => apply({ music: +e.currentTarget.value })} />
			<label for="fps">Show FPS</label>
			<input id="fps" type="checkbox" class="h-5 w-5 accent-gold-500" checked={s.showFps} onchange={(e) => apply({ showFps: e.currentTarget.checked })} />
		</div>
	</div>
</div>
