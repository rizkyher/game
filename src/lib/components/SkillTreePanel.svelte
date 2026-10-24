<script lang="ts">
	import type { Game } from '../game/core/Game';
	import type { UIState } from './uiState.svelte';
	import { BRANCHES, SKILLS } from '../game/systems/Progression';
	import ElementIcon from './ElementIcon.svelte';

	let { game, ui, onclose }: { game: Game; ui: UIState; onclose: () => void } = $props();
	const colors: Record<string, string> = { fire: '#ff7a3a', ice: '#6ae6ff', lightning: '#b8a4ff' };

	const view = $derived.by(() => {
		void ui.revision;
		const p = game.getCharacter().progression;
		return {
			points: p.data.skillPoints,
			level: p.level,
			branches: BRANCHES.map((b) => ({
				...b,
				skills: SKILLS.filter((s) => s.branch === b.id)
					.sort((x, y) => x.tier - y.tier)
					.map((s) => {
						const rank = p.rank(s.id);
						const check = p.canLearn(s.id);
						return { ...s, rank, max: s.ranks.length, can: check.ok, reason: check.reason };
					})
			}))
		};
	});

	function learn(id: string) {
		const ctx = game.debug();
		if (ctx.progression.learn(id)) {
			ctx.audio.sfx('level_up', undefined, { volume: 0.5 });
			ui.refresh();
		}
	}
</script>

<div class="absolute inset-0 z-40 grid place-items-center bg-ink-950/70 backdrop-blur-[2px]">
	<div class="af-panel af-fade-in w-[960px] max-w-[96vw] px-8 py-6">
		<div class="flex items-center justify-between">
			<div>
				<div class="af-title text-2xl font-bold">Arcane Disciplines</div>
				<div class="text-sm text-gold-400 italic">Spend skill points to reshape your spells. One point is earned each level.</div>
			</div>
			<div class="flex items-center gap-4">
				<span class="font-display text-lg {view.points > 0 ? 'af-pulse text-gold-200' : 'text-gold-400/70'}">{view.points} point{view.points === 1 ? '' : 's'}</span>
				<button class="af-btn h-9 px-4 text-xs" onclick={onclose}>Close</button>
			</div>
		</div>
		<div class="af-divider my-4"></div>
		<div class="grid grid-cols-3 gap-6">
			{#each view.branches as b (b.id)}
				<div class="flex flex-col items-center">
					<div class="flex items-center gap-2">
						<ElementIcon element={b.element} size={26} />
						<span class="af-title text-xl" style="color: {colors[b.element]}">{b.name}</span>
					</div>
					<div class="mb-4 text-center text-sm text-[#e8dcc4]/70 italic">{b.blurb}</div>
					{#each b.skills as s, i (s.id)}
						{#if i > 0}<div class="h-6 w-px" style="background: {s.rank > 0 || b.skills[i - 1].rank > 0 ? colors[b.element] : 'rgba(201,164,92,0.3)'}"></div>{/if}
						<button
							class="group relative w-full rounded-sm border px-4 py-3 text-left transition-all {s.can ? 'cursor-pointer hover:-translate-y-0.5' : 'cursor-default'}"
							style="border-color: {s.rank > 0 ? colors[b.element] : s.can ? 'rgba(232,207,138,0.8)' : 'rgba(201,164,92,0.25)'}; background: {s.rank > 0
								? `linear-gradient(180deg, ${colors[b.element]}22, rgba(10,8,22,0.9))`
								: 'rgba(10,8,22,0.75)'}; box-shadow: {s.rank > 0 ? `0 0 16px ${colors[b.element]}44` : 'none'}"
							onclick={() => s.can && learn(s.id)}
							disabled={!s.can}
						>
							<div class="flex items-baseline justify-between">
								<span class="font-display text-sm tracking-wider {s.rank > 0 ? 'text-white' : 'text-gold-200'}">{s.name}</span>
								<span class="font-display text-xs text-gold-300 tabular-nums">{s.rank}/{s.max}</span>
							</div>
							<div class="mt-1 text-[15px] leading-snug text-[#e8dcc4]/85">
								{s.rank < s.max ? s.ranks[s.rank] : s.ranks[s.max - 1]}
							</div>
							<div class="mt-1 text-xs tracking-wider uppercase {s.can ? 'text-gold-200' : 'text-gold-400/60'}">
								{s.rank >= s.max ? 'Mastered' : s.can ? 'Click to learn' : s.reason}
							</div>
						</button>
					{/each}
				</div>
			{/each}
		</div>
	</div>
</div>
