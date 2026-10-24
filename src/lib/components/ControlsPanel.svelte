<script lang="ts">
	let { onclose }: { onclose: () => void } = $props();
	const rows: [string, string][] = [
		['W A S D', 'Fly forward / left / back / right'],
		['Mouse', 'Look around (camera orbit)'],
		['Space', 'Ascend'],
		['Ctrl / C', 'Descend'],
		['Shift', 'Boost (drains the boost meter)'],
		['Ctrl + Shift', 'Dive bomb — hit the ground hard for a Ground Pound'],
		['Q', 'Dash'],
		['R', 'Barrel roll'],
		['Left click', 'Headbutt / throw held object'],
		['Right click', 'Sting (pops balloons & puffballs)'],
		['E', 'Interact: pick up, sip nectar, talk, start challenges'],
		['F', 'Drop held object'],
		['M / Tab', 'World map'],
		['Mouse wheel', 'Camera zoom'],
		['Esc / P', 'Pause & release the mouse']
	];
	const padRows: [string, string][] = [
		['Left stick / D-pad', 'Fly'],
		['Right stick', 'Camera'],
		['RT · LT', 'Ascend · descend'],
		['RB', 'Boost'],
		['A', 'Dash'],
		['LB', 'Barrel roll'],
		['X', 'Headbutt / throw'],
		['B', 'Sting'],
		['Y', 'Interact'],
		['Back · Start', 'Map · pause (Start also plays from the menu)']
	];
</script>

<div class="absolute inset-0 z-40 flex items-center justify-center bg-bark-900/45 px-4 backdrop-blur-[2px]">
	<div class="bm-panel max-h-[90vh] w-full max-w-lg overflow-y-auto px-6 py-5">
		<div class="flex items-center justify-between">
			<h2 class="text-2xl font-black">🎮 Controls</h2>
			<button class="bm-btn bm-btn-ghost h-9 w-9 text-lg" onclick={onclose} aria-label="Close">✕</button>
		</div>
		<table class="mt-3 w-full text-sm">
			<tbody>
				{#each rows as [key, action] (key)}
					<tr class="border-b border-bark-800/10">
						<td class="py-1.5 pr-3 whitespace-nowrap"><kbd class="rounded-md border-2 border-bark-800 bg-white px-1.5 py-0.5 text-xs font-black">{key}</kbd></td>
						<td class="py-1.5 font-semibold">{action}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<h3 class="mt-4 text-xs font-black tracking-widest opacity-60">GAMEPAD (Xbox layout)</h3>
		<table class="mt-1 w-full text-sm">
			<tbody>
				{#each padRows as [key, action] (key)}
					<tr class="border-b border-bark-800/10">
						<td class="py-1.5 pr-3 whitespace-nowrap"><kbd class="rounded-md border-2 border-bark-800 bg-white px-1.5 py-0.5 text-xs font-black">{key}</kbd></td>
						<td class="py-1.5 font-semibold">{action}</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<div class="mt-4 rounded-xl bg-white/70 p-3 text-xs leading-relaxed font-semibold">
			<b>Tips:</b> Crash into things at speed for chaos points — chain tricks quickly for a combo multiplier. Hover on flowers to gather pollen, press <b>E</b> on a flower for nectar,
			then fly it into the glowing cell inside the hive. Mash keys to escape honey and webs. Annoyed robins chase you: boost away or hide indoors. Your browser may ask before
			closing the tab if you press Ctrl+W mid-flight.
		</div>
		<div class="mt-4 text-right"><button class="bm-btn px-6 py-2" onclick={onclose}>Got it</button></div>
	</div>
</div>
