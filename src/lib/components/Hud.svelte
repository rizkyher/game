<script lang="ts">
	import type { UIState } from './uiState.svelte';
	import ElementIcon from './ElementIcon.svelte';

	let { ui }: { ui: UIState } = $props();
	const h = $derived(ui.hud);

	const pct = (v: number, m: number) => `${Math.max(0, Math.min(100, (v / Math.max(1, m)) * 100))}%`;
	const headingDeg = $derived(((((-h.heading * 180) / Math.PI) % 360) + 360) % 360);
	const marks = [
		{ label: 'N', deg: 0 },
		{ label: 'NE', deg: 45 },
		{ label: 'E', deg: 90 },
		{ label: 'SE', deg: 135 },
		{ label: 'S', deg: 180 },
		{ label: 'SW', deg: 225 },
		{ label: 'W', deg: 270 },
		{ label: 'NW', deg: 315 }
	];
	function offset(deg: number, heading: number): number {
		return ((deg - heading + 540) % 360) - 180;
	}
	const objDeg = $derived(h.objectiveBearing === null ? null : (h.objectiveBearing * 180) / Math.PI);
	const elementColors: Record<string, string> = { fire: '#ff7a3a', ice: '#6ae6ff', lightning: '#b8a4ff', wind: '#7dffc4' };
	const keyFor: Record<string, string> = { fire: '1', ice: '2', lightning: '3', wind: '4' };
	const sweep = (cd: number) => `conic-gradient(rgba(5,4,12,0.78) ${Math.max(0, Math.min(1, cd)) * 360}deg, transparent 0deg)`;
	const chargeDash = $derived(h.charge >= 0 ? 125.6 * (1 - h.charge) : 125.6);
</script>

<div class="pointer-events-none absolute inset-0 font-body text-[#efe6d2] select-none">
	<!-- ============ Vitals (top-left) ============ -->
	<div class="absolute top-4 left-4 flex items-start gap-3">
		<div class="relative grid h-[74px] w-[74px] shrink-0 place-items-center rounded-full border-2 border-gold-500 bg-ink-900/90 shadow-[0_0_24px_rgba(0,0,0,0.6),inset_0_0_18px_rgba(120,90,200,0.35)]" style="box-shadow: 0 0 18px {elementColors[h.element]}55, inset 0 0 18px rgba(120,90,200,0.35)">
			<div class="absolute inset-1 rounded-full border border-gold-700/70"></div>
			<ElementIcon element={h.element} size={30} />
			<div class="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-sm border border-gold-500 bg-ink-800 px-2 font-display text-xs font-bold text-gold-200">Lv {h.level}</div>
			{#if h.attrPoints > 0 || h.skillPoints > 0}
				<div class="af-pulse absolute -top-1 -right-1 grid h-5 w-5 place-items-center rounded-full border border-gold-300 bg-gold-600 font-display text-[11px] font-bold text-ink-900">+</div>
			{/if}
		</div>
		<div class="flex w-[300px] flex-col gap-1.5 pt-1">
			<div class="flex items-baseline justify-between font-display text-[11px] tracking-[0.2em] text-gold-300">
				<span>THE ARCANIST</span>
				<span class="font-body text-sm tracking-normal text-[#f6d8d8] tabular-nums">{h.hp} / {h.hpMax}</span>
			</div>
			<div class="af-bar" style="height: 16px">
				<div class="ghost" style="width: {pct(h.hp, h.hpMax)}"></div>
				<div class="fill" style="width: {pct(h.hp, h.hpMax)}; background: linear-gradient(180deg, #ff6a78, #b0203a)"></div>
				{#if h.ward > 0}
					<div class="fill" style="width: {pct(h.ward, h.hpMax)}; background: linear-gradient(180deg, rgba(190,245,255,0.85), rgba(90,200,255,0.6)); mix-blend-mode: screen"></div>
				{/if}
				<div class="shine"></div>
			</div>
			<div class="af-bar" style="height: 11px">
				<div class="fill" style="width: {pct(h.mana, h.manaMax)}; background: linear-gradient(180deg, #7ab0ff, #2a54c8)"></div>
				<div class="shine"></div>
			</div>
			<div class="af-bar" style="height: 6px; width: 78%">
				<div class="fill" style="width: {pct(h.stamina, h.staminaMax)}; background: linear-gradient(180deg, #c4f08a, #5aa83a)"></div>
			</div>
			{#if h.statuses.length}
				<div class="mt-1 flex flex-wrap gap-1">
					{#each h.statuses as s (s.id)}
						<div
							class="relative grid h-7 w-7 place-items-center overflow-hidden rounded-sm border bg-ink-900/85 text-sm"
							style="border-color: {s.color}; box-shadow: 0 0 8px {s.color}66"
							title={s.name}
						>
							<span style="color: {s.color}">{s.icon}</span>
							<div class="absolute right-0 bottom-0 left-0 h-[3px] bg-black/60"><div class="h-full" style="width: {s.t * 100}%; background: {s.color}"></div></div>
							{#if s.stacks > 1}<span class="absolute top-0 right-0.5 font-display text-[9px] font-bold">{s.stacks}</span>{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- ============ Compass + region (top-center) ============ -->
	<div class="absolute top-3 left-1/2 flex -translate-x-1/2 flex-col items-center">
		<div class="af-glass relative h-7 w-[420px] overflow-hidden rounded-sm">
			{#each marks as m (m.label)}
				{@const off = offset(m.deg, headingDeg)}
				{#if Math.abs(off) < 80}
					<span
						class="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 font-display {m.label.length === 1 ? 'text-sm font-bold text-gold-200' : 'text-[10px] text-gold-400/70'} {m.label === 'N' ? 'text-[#ff8a7a]' : ''}"
						style="left: {50 + (off / 80) * 50}%">{m.label}</span
					>
				{/if}
			{/each}
			{#if objDeg !== null && Math.abs(objDeg) < 80}
				<span class="absolute top-0.5 -translate-x-1/2 text-[13px] text-gold-300 drop-shadow-[0_0_6px_rgba(232,207,138,0.9)]" style="left: {50 + (objDeg / 80) * 50}%">◆</span>
			{:else if objDeg !== null}
				<span class="absolute top-0.5 text-[12px] text-gold-300" style={objDeg < 0 ? 'left: 4px' : 'right: 4px'}>{objDeg < 0 ? '◀' : '▶'}</span>
			{/if}
			<div class="absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-gold-300/60"></div>
		</div>
		<div class="mt-1 font-display text-[11px] tracking-[0.3em] text-gold-300/90 drop-shadow">{h.region.toUpperCase()}</div>

		{#if h.boss}
			{@const b = h.boss}
			<div class="af-fade-in mt-3 w-[620px]">
				<div class="mb-1 flex items-end justify-between">
					<div>
						<div class="af-title text-xl font-bold">{b.name}</div>
						<div class="text-xs tracking-[0.25em] text-arcane-300 italic">{b.title}</div>
					</div>
					<div class="font-display text-xs tracking-[0.2em] text-gold-300">PHASE {b.phase}</div>
				</div>
				<div class="af-bar" style="height: 18px; border-color: #c9a45c">
					<div class="ghost" style="width: {pct(b.hp, b.maxHp)}"></div>
					<div class="fill" style="width: {pct(b.hp, b.maxHp)}; background: linear-gradient(180deg, {b.phase >= 3 ? '#ff5ab0, #8a1050' : '#d07aff, #5a2aa8'})"></div>
					{#each b.phases as p (p)}
						<div class="absolute top-0 bottom-0 w-[2px] bg-gold-200/80" style="left: {p * 100}%"></div>
					{/each}
					<div class="shine"></div>
				</div>
				{#if b.broken}<div class="af-pulse mt-1 text-center font-display text-xs tracking-[0.3em] text-[#ffd070]">GUARD SHATTERED — STRIKE NOW</div>{/if}
			</div>
		{:else if h.target}
			{@const t = h.target}
			<div class="af-fade-in mt-3 w-[340px]">
				<div class="flex items-baseline justify-between">
					<span class="font-display text-sm tracking-wider {t.elite ? 'text-[#ffb070]' : 'text-gold-200'}">{t.locked ? '⌖ ' : ''}{t.name}</span>
					<span class="text-xs text-gold-400">Lv {t.level}</span>
				</div>
				<div class="af-bar mt-0.5" style="height: 10px">
					<div class="ghost" style="width: {pct(t.hp, t.maxHp)}"></div>
					<div class="fill" style="width: {pct(t.hp, t.maxHp)}; background: linear-gradient(180deg, #ff7a6a, #9a2030)"></div>
					{#if t.shield > 0}
						<div class="fill" style="width: {pct(t.shield, t.maxHp)}; background: linear-gradient(180deg, rgba(255,140,240,0.9), rgba(180,40,200,0.7))"></div>
					{/if}
					<div class="shine"></div>
				</div>
				{#if t.statuses.length}
					<div class="mt-1 flex justify-center gap-1">
						{#each t.statuses as s (s.id)}
							<span class="rounded-sm border bg-ink-900/80 px-1 text-xs" style="border-color: {s.color}; color: {s.color}">{s.icon}{s.stacks > 1 ? s.stacks : ''}</span>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- ============ Quest tracker (right) ============ -->
	{#if h.quest}
		{@const q = h.quest}
		<div class="absolute top-20 right-5 w-[300px] text-right">
			<div class="font-display text-[11px] tracking-[0.3em] text-gold-400">QUEST</div>
			<div class="af-title text-lg leading-tight">{q.title}</div>
			<div class="af-divider my-1.5 ml-auto w-3/4"></div>
			<div class="text-[17px] leading-snug text-[#f2ead8] drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
				<span class="text-gold-300">◆</span>
				{q.objective}
			</div>
			{#if q.progress}<div class="mt-0.5 font-display text-sm text-gold-300 tabular-nums">{q.progress}</div>{/if}
			{#if h.objectiveDist > 0 && h.objectiveBearing !== null}<div class="mt-0.5 text-sm text-gold-400/80 italic">{h.objectiveDist} m</div>{/if}
		</div>
	{/if}

	{#if h.fps > 0}
		<div class="absolute top-2 right-2 rounded bg-black/50 px-1.5 font-mono text-xs text-white tabular-nums">{h.fps} fps</div>
	{/if}

	<!-- ============ Crosshair ============ -->
	<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
		<svg width="56" height="56" viewBox="0 0 56 56" class="overflow-visible">
			<circle cx="28" cy="28" r="20" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="2" />
			{#if h.charge >= 0}
				<circle
					cx="28"
					cy="28"
					r="20"
					fill="none"
					stroke={elementColors[h.element]}
					stroke-width="3"
					stroke-dasharray="125.6"
					stroke-dashoffset={chargeDash}
					transform="rotate(-90 28 28)"
					style="filter: drop-shadow(0 0 4px {elementColors[h.element]})"
				/>
			{/if}
			<path d="M28 22 L31 28 L28 34 L25 28 Z" fill={h.counter ? '#ffd070' : h.lowMana ? '#6a8aff' : 'rgba(255,248,230,0.9)'} stroke="rgba(0,0,0,0.6)" stroke-width="0.8" />
			<path d="M28 12 v5 M28 39 v5 M12 28 h5 M39 28 h5" stroke="rgba(255,248,230,0.55)" stroke-width="1.5" />
		</svg>
		{#if h.combo > 0}
			<div class="absolute top-full left-1/2 -translate-x-1/2 font-display text-xs tracking-widest text-gold-300">{h.combo === 2 ? 'FINISHER' : `x${h.combo + 1}`}</div>
		{/if}
	</div>

	<!-- ============ Interaction prompt ============ -->
	{#if h.prompt}
		<div class="absolute bottom-[150px] left-1/2 -translate-x-1/2 af-fade-in">
			<div class="af-glass flex items-center gap-2 rounded-sm px-4 py-1.5 text-lg">
				<span class="af-key">E</span>
				<span>{h.prompt}</span>
			</div>
		</div>
	{/if}

	<!-- ============ Hotbar (bottom-center) ============ -->
	<div class="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-end gap-3">
		<!-- Defensive keys -->
		<div class="flex flex-col gap-1.5 pb-1">
			<div class="af-glass flex items-center gap-1.5 rounded-sm px-2 py-1 {h.shielding ? 'border-ice' : ''}" style={h.shielding ? 'box-shadow: 0 0 14px #6ae6ff88' : ''}>
				<ElementIcon element="shield" size={16} />
				<span class="af-key">F</span>
			</div>
			<div class="af-glass flex items-center gap-1.5 rounded-sm px-2 py-1" style={h.counter ? 'box-shadow: 0 0 14px #ffd07088; border-color:#ffd070' : ''}>
				<ElementIcon element="parry" size={16} />
				<span class="af-key">R</span>
			</div>
		</div>

		<div class="flex gap-2">
			{#each h.spells as s (s.element)}
				{@const active = s.element === h.element}
				<div class="relative flex flex-col items-center transition-transform duration-150 {active ? '-translate-y-2' : 'opacity-75'}">
					<div
						class="relative grid h-[64px] w-[64px] place-items-center overflow-hidden rounded-sm border-2 bg-ink-900/90"
						style="border-color: {active ? elementColors[s.element] : 'rgba(201,164,92,0.45)'}; box-shadow: {active ? `0 0 18px ${elementColors[s.element]}88, inset 0 0 16px ${elementColors[s.element]}33` : 'none'}"
					>
						<ElementIcon element={s.element} size={34} glow={active} />
						<div class="absolute inset-0" style="background: {sweep(s.basicCd)}"></div>
						<span class="absolute top-0.5 left-1 font-display text-[11px] font-bold text-gold-200">{keyFor[s.element]}</span>
						<span class="absolute right-1 bottom-0.5 text-[11px] text-[#9ec0ff] tabular-nums">{s.basicCost}</span>
					</div>
					<!-- Special (charged) spell -->
					<div class="relative mt-1 h-[14px] w-[64px] overflow-hidden rounded-sm border border-gold-600/60 bg-ink-900/90" title={s.specialName}>
						<div class="absolute inset-0" style="background: linear-gradient(90deg, {elementColors[s.element]}aa, {elementColors[s.element]}44); width: {(1 - Math.min(1, s.specialCd)) * 100}%"></div>
						<span class="absolute inset-0 grid place-items-center font-display text-[8px] tracking-wider text-white/90">{s.specialCdSec > 0 ? s.specialCdSec.toFixed(1) : 'RMB'}</span>
					</div>
					{#if active}<div class="mt-0.5 font-display text-[10px] tracking-wider whitespace-nowrap text-gold-200">{s.basicName}</div>{/if}
				</div>
			{/each}
		</div>

		<!-- Aether gauge (ultimate) -->
		<div class="flex flex-col items-center pb-1">
			<div class="relative grid h-[58px] w-[58px] place-items-center rounded-full border-2 bg-ink-900/90 {h.ultimateReady ? 'af-pulse' : ''}" style="border-color: {h.ultimateReady ? '#f3e3b3' : 'rgba(201,164,92,0.5)'}; box-shadow: {h.ultimateReady ? '0 0 24px #e8cf8acc' : 'none'}">
				<div class="absolute inset-[3px] rounded-full" style="background: conic-gradient(#e8cf8a {h.aether * 360}deg, rgba(255,255,255,0.05) 0deg); mask: radial-gradient(circle, transparent 58%, black 60%); -webkit-mask: radial-gradient(circle, transparent 58%, black 60%)"></div>
				<ElementIcon element="arcane" size={24} glow={h.ultimateReady} />
			</div>
			<span class="af-key mt-1">G</span>
		</div>

		{#if h.channelUnlocked}
			<div class="flex flex-col items-center pb-1">
				<div class="grid h-[44px] w-[44px] place-items-center rounded-sm border-2 bg-ink-900/90" style="border-color: {h.channeling ? '#e8cf8a' : 'rgba(201,164,92,0.5)'}">
					<ElementIcon element="ray" size={22} />
				</div>
				<span class="af-key mt-1">X</span>
			</div>
		{/if}

		<!-- Potions -->
		<div class="flex flex-col gap-1.5 pb-1">
			<div class="af-glass flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-sm">
				<span class="text-hp">❤</span><span class="tabular-nums">{h.potions}</span><span class="af-key">H</span>
			</div>
			<div class="af-glass flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-sm">
				<span class="text-mana">✦</span><span class="tabular-nums">{h.manaPotions}</span><span class="af-key">J</span>
			</div>
		</div>
	</div>

	<!-- ============ Experience bar ============ -->
	<div class="absolute right-0 bottom-0 left-0 h-[4px] bg-black/60">
		<div class="h-full bg-gradient-to-r from-arcane-500 via-arcane-300 to-gold-300 transition-[width] duration-300" style="width: {pct(h.exp, h.expNext)}"></div>
	</div>
</div>
