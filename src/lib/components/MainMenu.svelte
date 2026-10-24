<script lang="ts">
	let {
		hasSave,
		onnew,
		oncontinue,
		onsettings,
		oncontrols
	}: { hasSave: boolean; onnew: () => void; oncontinue: () => void; onsettings: () => void; oncontrols: () => void } = $props();
	let confirmNew = $state(false);
</script>

<div class="absolute inset-0 z-30 flex items-center bg-[linear-gradient(90deg,rgba(7,6,15,0.92)_0%,rgba(7,6,15,0.65)_38%,transparent_70%)]">
	<div class="af-fade-in ml-[8vw] flex w-[420px] flex-col">
		<div class="font-display text-sm tracking-[0.5em] text-gold-400">A TALE OF</div>
		<h1 class="af-title mt-1 text-6xl leading-none font-black tracking-[0.18em]">AETHERFALL</h1>
		<div class="mt-2 text-xl tracking-[0.3em] text-arcane-300 italic">Echoes of the Arcane</div>
		<div class="af-divider my-6 w-3/4"></div>
		<p class="mb-8 text-lg leading-snug text-[#e8dcc4]/85">
			The Broken Seal weakens. Corruption spreads from the Forgotten Sanctuary, and only the last Arcanist of Lumen Hollow can master fire, frost, storm and wind to stop the Crystal Tyrant.
		</p>
		<div class="flex flex-col gap-3">
			{#if hasSave}
				<button class="af-btn af-btn-primary h-12 text-base" onclick={oncontinue}>Continue</button>
			{/if}
			{#if confirmNew}
				<div class="af-panel px-4 py-3">
					<p class="text-base">Begin a new journey? Your current progress will be lost.</p>
					<div class="mt-3 flex gap-2">
						<button class="af-btn h-10 flex-1 text-sm" onclick={onnew}>Begin anew</button>
						<button class="af-btn h-10 flex-1 text-sm" onclick={() => (confirmNew = false)}>Cancel</button>
					</div>
				</div>
			{:else}
				<button class="af-btn {hasSave ? '' : 'af-btn-primary'} h-12 text-base" onclick={() => (hasSave ? (confirmNew = true) : onnew())}>New Journey</button>
			{/if}
			<div class="flex gap-3">
				<button class="af-btn h-10 flex-1 text-sm" onclick={onsettings}>Settings</button>
				<button class="af-btn h-10 flex-1 text-sm" onclick={oncontrols}>Controls</button>
			</div>
		</div>
		<p class="mt-8 text-sm text-gold-400/70 italic">Best with keyboard &amp; mouse. Click Continue or New Journey to capture the mouse; Esc releases it.</p>
	</div>
</div>
