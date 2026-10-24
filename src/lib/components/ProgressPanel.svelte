<script lang="ts">
	import { untrack } from 'svelte';
	import type { Game } from '../game/core/Game';
	import { ACHIEVEMENTS } from '../game/systems/Achievements';

	let { game, onclose }: { game: Game; onclose: () => void } = $props();
	const p = untrack(() => game.getProgress());
	const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
	const minutes = Math.floor(p.playTime / 60);
</script>

<div class="absolute inset-0 z-40 flex items-center justify-center bg-bark-900/45 px-4 backdrop-blur-[2px]">
	<div class="bm-panel max-h-[90vh] w-full max-w-2xl overflow-y-auto px-6 py-5">
		<div class="flex items-center justify-between">
			<h2 class="text-2xl font-black">🏆 Progress</h2>
			<button class="bm-btn bm-btn-ghost h-9 w-9 text-lg" onclick={onclose} aria-label="Close">✕</button>
		</div>
		<div class="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-bold sm:grid-cols-6">
			{#each [[p.bestChaos.toLocaleString(), 'best chaos'], [p.totalChaos.toLocaleString(), 'total chaos'], [p.honey, 'honey'], [`${p.orbs}/${p.orbsTotal}`, 'golden orbs'], [`${p.species}/${p.speciesTotal}`, 'species'], [p.tricks, 'tricks found']] as [v, l] (l)}
				<div class="rounded-xl bg-white/70 py-2"><div class="text-base font-black">{v}</div>{l}</div>
			{/each}
		</div>
		<p class="mt-1.5 text-right text-xs font-semibold opacity-60">{minutes} min played</p>

		<h3 class="mt-3 text-xs font-black tracking-widest opacity-60">ACTIVITIES</h3>
		<div class="mt-2 grid gap-2 sm:grid-cols-2">
			{#each p.challenges as c (c.id)}
				<div class="rounded-xl border-2 border-bark-800/20 bg-white/60 px-3 py-2 text-sm {c.done ? 'border-lime-600/60 bg-lime-100/70' : ''}">
					<div class="font-black">{c.icon} {c.title} {c.done ? '✓' : ''}</div>
					<div class="text-xs font-semibold opacity-75">{c.desc}{c.best ? ` · best ${fmt(c.best)}` : ''}</div>
				</div>
			{/each}
			<div class="rounded-xl border-2 border-bark-800/20 bg-white/60 px-3 py-2 text-sm">
				<div class="font-black">✨ Golden Pollen Hunt {p.orbs >= p.orbsTotal ? '✓' : ''}</div>
				<div class="text-xs font-semibold opacity-75">Find all {p.orbsTotal} orbs hidden around the world ({p.orbs} found).</div>
			</div>
		</div>
		<p class="mt-1 text-xs font-semibold opacity-60">Start activities at the glowing hexagon totems (shown on the map).</p>

		<h3 class="mt-4 text-xs font-black tracking-widest opacity-60">ACHIEVEMENTS · {p.achievements.length}/{ACHIEVEMENTS.length}</h3>
		<div class="mt-2 grid gap-2 sm:grid-cols-2">
			{#each ACHIEVEMENTS as a (a.id)}
				{@const got = p.achievements.includes(a.id)}
				<div class="flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm {got ? 'bg-honey-200/80' : 'bg-white/40 opacity-60'}">
					<span class="text-xl {got ? '' : 'grayscale'}">{a.icon}</span>
					<div>
						<div class="font-black">{a.name}</div>
						<div class="text-xs font-semibold opacity-75">{a.desc}</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
