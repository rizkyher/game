<script lang="ts">
	let { onclose }: { onclose: () => void } = $props();
	const groups: { title: string; rows: [string, string][] }[] = [
		{
			title: 'Movement',
			rows: [
				['W A S D', 'Move (camera-relative)'],
				['Mouse', 'Camera / aim'],
				['Shift', 'Sprint'],
				['Space', 'Jump · press again for a double jump'],
				['Q', 'Dodge roll (brief invincibility) · Dash when sprinting or airborne']
			]
		},
		{
			title: 'Spellcasting',
			rows: [
				['Left Click', 'Basic spell — hold to keep casting; every 3rd cast is a heavy Finisher'],
				['Hold Right Click', 'Charge your element\'s special; release to cast (more charge, more power)'],
				['1 · 2 · 3 · 4', 'Fire · Ice · Lightning · Wind'],
				['G', 'Aetherfall ultimate (when the Aether gauge is full)'],
				['Hold X', 'Prismatic Ray channel (unlocked by the quest)']
			]
		},
		{
			title: 'Defence',
			rows: [
				['Hold F', 'Aegis shield — blocks most damage, drains stamina'],
				['R', 'Parry — time it to the hit. Raising the shield just before impact also parries'],
				['Tab', 'Lock on / release target']
			]
		},
		{
			title: 'World',
			rows: [
				['E', 'Interact · talk · open · attune waystones'],
				['H · J', 'Healing Draught · Aether Tonic'],
				['I', 'Character & inventory'],
				['K', 'Skill tree'],
				['M', 'World map'],
				['Esc', 'Pause / release the mouse']
			]
		}
	];
	const tips = [
		'Fire on a Chilled or Frozen foe triggers Thermal Shock; it also leaves them Wet.',
		'Lightning on a Wet foe causes Overcharge: big damage and a stun that jumps to other wet foes. Rivers and lakes soak enemies too.',
		'A heavy hit (Finisher, Flame Explosion, ultimate) on a Frozen foe Shatters it.',
		'Fire through a Tornado ignites it; other spells cast through it are Accelerated.',
		'Crystal Golems hide a core on their chest. It is exposed while they recover from an attack.'
	];
</script>

<div class="absolute inset-0 z-40 grid place-items-center bg-ink-950/70 backdrop-blur-[2px]">
	<div class="af-panel af-fade-in af-scroll max-h-[88vh] w-[860px] max-w-[95vw] overflow-y-auto px-8 py-6">
		<div class="flex items-center justify-between">
			<div class="af-title text-2xl font-bold">Controls &amp; Combat Guide</div>
			<button class="af-btn h-9 px-4 text-xs" onclick={onclose}>Close</button>
		</div>
		<div class="af-divider my-4"></div>
		<div class="grid grid-cols-2 gap-x-8 gap-y-5">
			{#each groups as g (g.title)}
				<div>
					<div class="mb-2 font-display text-xs tracking-[0.3em] text-gold-300">{g.title.toUpperCase()}</div>
					{#each g.rows as [k, d] (k)}
						<div class="flex items-baseline gap-3 py-0.5">
							<span class="w-[118px] shrink-0 text-right"><span class="af-key text-[13px]">{k}</span></span>
							<span class="text-[16px] leading-snug">{d}</span>
						</div>
					{/each}
				</div>
			{/each}
		</div>
		<div class="af-divider my-4"></div>
		<div class="mb-2 font-display text-xs tracking-[0.3em] text-gold-300">ELEMENTAL REACTIONS</div>
		<ul class="list-inside list-['◆_'] space-y-1 text-[16px] text-[#e8dcc4]/90 marker:text-gold-400">
			{#each tips as t (t)}<li>{t}</li>{/each}
		</ul>
		<p class="mt-4 text-sm text-gold-400/80 italic">Gamepad: left stick move · right stick camera · RT basic · LT charge · A jump · B dodge · RB shield · LB parry · Y ultimate · X interact · D-pad elements · R3 lock-on.</p>
	</div>
</div>
