<script lang="ts">
	let { stats, oncontinue }: { stats: { damageDealt: number; reactions: number; parries: number; crits: number; kills: number; playTime: number; deaths: number; level: number }; oncontinue: () => void } = $props();
	const time = $derived(`${Math.floor(stats.playTime / 3600)}h ${Math.floor((stats.playTime % 3600) / 60)}m`);
</script>

<div class="absolute inset-0 z-30 grid place-items-center bg-[radial-gradient(ellipse_at_center,rgba(60,40,110,0.55),rgba(5,4,12,0.9))]">
	<div class="af-panel af-fade-in flex w-[640px] max-w-[94vw] flex-col items-center px-10 py-8 text-center">
		<div class="font-display text-sm tracking-[0.6em] text-gold-400">THE SEAL IS RESTORED</div>
		<div class="af-title mt-2 text-5xl font-black">VICTORY</div>
		<div class="af-divider my-4 w-3/4"></div>
		<p class="text-xl text-[#e8dcc4] italic">Azrak's crystal heart falls silent. Light returns to the Sanctuary, and the Aether answers your call as never before.</p>
		<div class="mt-5 grid w-full grid-cols-2 gap-x-10 gap-y-1.5 text-left text-[17px]">
			<div class="flex justify-between"><span>Level</span><span class="tabular-nums">{stats.level}</span></div>
			<div class="flex justify-between"><span>Time in Aetherfall</span><span class="tabular-nums">{time}</span></div>
			<div class="flex justify-between"><span>Foes vanquished</span><span class="tabular-nums">{stats.kills}</span></div>
			<div class="flex justify-between"><span>Damage dealt</span><span class="tabular-nums">{Math.round(stats.damageDealt).toLocaleString()}</span></div>
			<div class="flex justify-between"><span>Elemental reactions</span><span class="tabular-nums">{stats.reactions}</span></div>
			<div class="flex justify-between"><span>Perfect parries</span><span class="tabular-nums">{stats.parries}</span></div>
			<div class="flex justify-between"><span>Critical hits</span><span class="tabular-nums">{stats.crits}</span></div>
			<div class="flex justify-between"><span>Times fallen</span><span class="tabular-nums">{stats.deaths}</span></div>
		</div>
		<div class="af-divider my-5 w-3/4"></div>
		<div class="text-lg text-gold-200">Rewards: <span class="text-white">1500 EXP · Heart of Azrak · Prismatic Ray</span></div>
		<div class="mt-1 text-sm text-gold-400 italic">Hold X to channel the Prismatic Ray. The world remains open to explore.</div>
		<button class="af-btn af-btn-primary mt-6 h-12 w-56" onclick={oncontinue}>Continue</button>
	</div>
</div>
