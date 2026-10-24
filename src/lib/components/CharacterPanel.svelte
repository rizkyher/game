<script lang="ts">
	import type { Game } from '../game/core/Game';
	import type { UIState } from './uiState.svelte';
	import { ATTRS, type AttrId } from '../game/systems/Progression';

	let { game, ui, onclose }: { game: Game; ui: UIState; onclose: () => void } = $props();
	let tab = $state<'attributes' | 'inventory'>('attributes');

	const data = $derived.by(() => {
		void ui.revision;
		const c = game.getCharacter();
		return {
			level: c.progression.level,
			exp: c.progression.data.exp,
			expNext: c.progression.expNext(),
			points: c.progression.data.attrPoints,
			skillPoints: c.progression.data.skillPoints,
			attrs: ATTRS.map((a) => ({ ...a, value: c.progression.attrValue(a), spent: c.progression.data.attrs[a.id] })),
			stats: c.stats,
			mods: c.mods,
			items: c.inventory.list().map((x) => ({ ...x.def, count: x.count }))
		};
	});

	function spend(id: AttrId) {
		game.debug().progression.spendAttr(id);
		game.debug().audio.sfx('ui_click');
	}

	function use(id: string) {
		if (id === 'health_potion' || id === 'mana_potion') game.debug().playerCombat.drink(id);
		ui.refresh();
	}

	const fmt = (a: { value: number; unit: string }) => (a.unit === '%' ? `${a.value.toFixed(1)}%` : Math.round(a.value).toString());
</script>

<div class="absolute inset-0 z-40 grid place-items-center bg-ink-950/70 backdrop-blur-[2px]">
	<div class="af-panel af-fade-in w-[820px] max-w-[95vw] px-8 py-6">
		<div class="flex items-center justify-between">
			<div>
				<div class="af-title text-2xl font-bold">The Arcanist</div>
				<div class="text-sm text-gold-400 italic">Level {data.level} · {data.exp} / {data.expNext} EXP</div>
			</div>
			<div class="flex gap-2">
				<button class="af-btn h-9 px-4 text-xs {tab === 'attributes' ? 'af-btn-primary' : ''}" onclick={() => (tab = 'attributes')}>Attributes</button>
				<button class="af-btn h-9 px-4 text-xs {tab === 'inventory' ? 'af-btn-primary' : ''}" onclick={() => (tab = 'inventory')}>Inventory</button>
				<button class="af-btn h-9 px-4 text-xs" onclick={onclose}>Close</button>
			</div>
		</div>
		<div class="af-divider my-4"></div>

		{#if tab === 'attributes'}
			<div class="grid grid-cols-[1fr_260px] gap-8">
				<div>
					<div class="mb-2 flex items-baseline justify-between">
						<span class="font-display text-xs tracking-[0.3em] text-gold-300">ATTRIBUTES</span>
						<span class="text-base {data.points > 0 ? 'af-pulse text-gold-200' : 'text-gold-400/70'}">{data.points} point{data.points === 1 ? '' : 's'} to spend</span>
					</div>
					{#each data.attrs as a (a.id)}
						<div class="flex items-center gap-3 border-b border-gold-700/30 py-2">
							<div class="flex-1">
								<div class="font-display text-sm tracking-wider text-gold-200">{a.name}</div>
								<div class="text-sm text-[#e8dcc4]/70">{a.desc} <span class="text-gold-400/80">(+{a.perPoint}{a.unit} per point)</span></div>
							</div>
							<div class="w-16 text-right font-display text-lg text-white tabular-nums">{fmt(a)}</div>
							<button class="af-btn h-8 w-8 text-lg" disabled={data.points <= 0 || (a.cap !== undefined && a.value + a.perPoint > a.cap)} onclick={() => spend(a.id)} aria-label="Increase {a.name}">+</button>
						</div>
					{/each}
				</div>
				<div class="flex flex-col gap-1.5 text-[16px]">
					<span class="mb-1 font-display text-xs tracking-[0.3em] text-gold-300">COMBAT</span>
					<div class="flex justify-between"><span>Health</span><span class="tabular-nums">{data.stats.maxHp}</span></div>
					<div class="flex justify-between"><span>Mana</span><span class="tabular-nums">{data.stats.maxMana}</span></div>
					<div class="flex justify-between"><span>Mana regen</span><span class="tabular-nums">{data.stats.manaRegen.toFixed(1)}/s</span></div>
					<div class="flex justify-between"><span>Stamina</span><span class="tabular-nums">{data.stats.maxStamina}</span></div>
					<div class="flex justify-between"><span>Magic Power</span><span class="tabular-nums">{data.stats.power}</span></div>
					<div class="flex justify-between"><span>Defense</span><span class="tabular-nums">{data.stats.defense}</span></div>
					<div class="flex justify-between"><span>Critical chance</span><span class="tabular-nums">{(data.stats.crit * 100).toFixed(1)}%</span></div>
					<div class="flex justify-between"><span>Critical damage</span><span class="tabular-nums">×{data.stats.critMult.toFixed(2)}</span></div>
					<div class="flex justify-between"><span>Elemental resist</span><span class="tabular-nums">{(data.stats.resist * 100).toFixed(0)}%</span></div>
					<div class="af-divider my-2"></div>
					<span class="mb-1 font-display text-xs tracking-[0.3em] text-gold-300">ELEMENT MASTERY</span>
					{#each Object.entries(data.mods.elementDamage) as [el, v] (el)}
						<div class="flex justify-between capitalize"><span>{el}</span><span class="tabular-nums">+{Math.round((v - 1) * 100)}%</span></div>
					{/each}
					{#if data.skillPoints > 0}<div class="mt-2 text-sm text-gold-200 italic">{data.skillPoints} unspent skill point{data.skillPoints === 1 ? '' : 's'} — open the Skill Tree [K]</div>{/if}
				</div>
			</div>
		{:else}
			<div class="grid min-h-[280px] grid-cols-2 gap-3">
				{#each data.items as it (it.id)}
					<div class="flex items-center gap-3 rounded-sm border border-gold-700/40 bg-ink-900/60 px-3 py-2">
						<div class="grid h-12 w-12 shrink-0 place-items-center rounded-sm border text-2xl" style="border-color: {it.color}; color: {it.color}; box-shadow: inset 0 0 12px {it.color}44">{it.icon}</div>
						<div class="flex-1">
							<div class="font-display text-sm tracking-wider" style="color: {it.color}">{it.name}{it.count > 1 ? ` ×${it.count}` : ''}</div>
							<div class="text-sm leading-snug text-[#e8dcc4]/80">{it.desc}</div>
							<div class="text-xs text-gold-400/70 uppercase">{it.kind}</div>
						</div>
						{#if it.kind === 'consumable'}<button class="af-btn h-8 px-3 text-xs" onclick={() => use(it.id)}>Use</button>{/if}
					</div>
				{:else}
					<div class="col-span-2 text-center text-gold-400/70 italic">Your satchel is empty.</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
