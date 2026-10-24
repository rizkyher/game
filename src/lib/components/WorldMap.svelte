<script lang="ts">
	import { onMount } from 'svelte';
	import type { Game, MapData } from '../game/core/Game';
	import { WORLD_HALF, WORLD_SIZE } from '../game/world/WorldLayout';

	let { game, onclose }: { game: Game; onclose: () => void } = $props();
	let host: HTMLDivElement;
	let data = $state<MapData | null>(null);
	const SIZE = 620;
	const icons: Record<string, string> = {
		village: '⌂',
		waystone: '✧',
		shrine: '❖',
		lake: '≈',
		cave: '◒',
		tower: '♜',
		arena: '◎',
		isles: '☁',
		gate: '⛩',
		ruins: '⌘',
		temple: '△',
		boss: '♛',
		crossroads: '✛',
		crystal: '◆'
	};
	const px = (x: number) => ((x + WORLD_HALF) / WORLD_SIZE) * SIZE;

	onMount(() => {
		data = game.getMapData();
		host.appendChild(data.image);
		data.image.style.width = `${SIZE}px`;
		data.image.style.height = `${SIZE}px`;
		data.image.style.display = 'block';
		const id = setInterval(() => (data = game.getMapData()), 250);
		return () => {
			clearInterval(id);
			data?.image.remove();
		};
	});
</script>

<div class="absolute inset-0 z-40 grid place-items-center bg-ink-950/75 backdrop-blur-[2px]">
	<div class="af-panel af-fade-in flex gap-6 px-7 py-6">
		<div class="relative overflow-hidden rounded-sm border border-gold-600/60" style="width: {SIZE}px; height: {SIZE}px">
			<div bind:this={host} class="absolute inset-0 opacity-90 saturate-[0.85]"></div>
			<div class="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(7,6,15,0.65))]"></div>
			{#if data}
				{#each data.markers as m (m.kind + m.id)}
					<div class="absolute -translate-x-1/2 -translate-y-1/2 text-center" style="left: {px(m.x)}px; top: {px(m.z)}px">
						<div
							class="grid h-6 w-6 place-items-center rounded-full border text-sm {m.kind === 'waystone' ? (m.active ? 'border-[#6ae6ff] bg-[#0a2a3a] text-[#9af0ff]' : 'border-gold-700 bg-ink-900/80 text-gold-600') : m.active ? 'border-gold-300 bg-ink-800 text-gold-200' : 'border-gold-700/60 bg-ink-900/70 text-gold-600'}"
						>
							{icons[m.icon] ?? '•'}
						</div>
						{#if m.active || m.kind === 'landmark'}<div class="mt-0.5 font-display text-[9px] tracking-wider whitespace-nowrap {m.active ? 'text-gold-200' : 'text-gold-600'} drop-shadow-[0_1px_2px_#000]">{m.name}</div>{/if}
					</div>
				{/each}
				{#if data.objective}
					<div class="af-pulse absolute -translate-x-1/2 -translate-y-1/2 text-2xl text-gold-200 drop-shadow-[0_0_8px_rgba(232,207,138,1)]" style="left: {px(data.objective.x)}px; top: {px(data.objective.z)}px">◆</div>
				{/if}
				<div class="absolute -translate-x-1/2 -translate-y-1/2" style="left: {px(data.player.x)}px; top: {px(data.player.z)}px; transform: translate(-50%, -50%) rotate({Math.PI - data.player.yaw}rad)">
					<svg width="22" height="22" viewBox="0 0 22 22"><path d="M11 1 L18 20 L11 15 L4 20 Z" fill="#fff6dc" stroke="#0c0a18" stroke-width="1.5" /></svg>
				</div>
			{/if}
		</div>
		<div class="flex w-[220px] flex-col">
			<div class="af-title text-2xl font-bold">Aetherfall</div>
			<div class="text-sm text-gold-400 italic">{data?.region ?? ''}</div>
			<div class="af-divider my-4"></div>
			<div class="space-y-2 text-[15px]">
				<div class="flex items-center gap-2"><span class="text-gold-200">◆</span> Current objective</div>
				<div class="flex items-center gap-2"><span class="text-[#9af0ff]">✧</span> Attuned waystone</div>
				<div class="flex items-center gap-2"><span class="text-gold-600">✧</span> Unattuned waystone</div>
				<div class="flex items-center gap-2"><span class="text-gold-200">❖</span> Discovered landmark</div>
			</div>
			<div class="mt-auto">
				<p class="mb-3 text-sm text-gold-400/80 italic">Waystones save your progress and become your return point when you fall.</p>
				<button class="af-btn h-10 w-full text-xs" onclick={onclose}>Close [M]</button>
			</div>
		</div>
	</div>
</div>
