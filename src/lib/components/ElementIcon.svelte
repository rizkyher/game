<script lang="ts">
	let { element, size = 24, glow = true }: { element: string; size?: number; glow?: boolean } = $props();
	const colors: Record<string, string> = {
		fire: '#ff7a3a',
		ice: '#6ae6ff',
		lightning: '#c8b8ff',
		wind: '#7dffc4',
		arcane: '#e8cf8a',
		shadow: '#d070ff'
	};
	const color = $derived(colors[element] ?? '#ffffff');
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke={color}
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	style={glow ? `filter: drop-shadow(0 0 4px ${color})` : ''}
	aria-hidden="true"
>
	{#if element === 'fire'}
		<path d="M12 2.5c1.2 3.6 5.2 5.6 5.2 10.6a5.2 5.2 0 0 1-10.4 0c0-2.2 1-3.6 2.2-4.6 0 2 1 3.2 2.2 3.2 0-3.8-2.2-5.8.8-9.2z" fill={color} fill-opacity="0.25" />
		<path d="M12 21c-1.6 0-2.6-1.2-2.6-2.6 0-1.6 1.4-2.4 2.6-4 1.2 1.6 2.6 2.4 2.6 4 0 1.4-1 2.6-2.6 2.6z" fill={color} fill-opacity="0.6" />
	{:else if element === 'ice'}
		<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7" />
		<path d="M12 5.5l-2-2M12 5.5l2-2M12 18.5l-2 2M12 18.5l2 2M5.8 8.2l-.8-2.7M5.8 8.2l-2.7.6M18.2 15.8l.8 2.7M18.2 15.8l2.7-.6M5.8 15.8l-2.7-.6M5.8 15.8l-.8 2.7M18.2 8.2l2.7.6M18.2 8.2l.8-2.7" />
	{:else if element === 'lightning'}
		<path d="M13.5 2 4.5 13.5h6.5L9.8 22l9.4-12.2h-6.6L13.5 2z" fill={color} fill-opacity="0.3" />
	{:else if element === 'wind'}
		<path d="M3 8.5h10.5a3 3 0 1 0-3-3" />
		<path d="M3 12.5h15a3.2 3.2 0 1 1-3.2 3.2" />
		<path d="M3 16.5h7" />
	{:else if element === 'shield'}
		<path d="M12 2.5 4.5 5.5v6c0 4.6 3.2 8.4 7.5 10 4.3-1.6 7.5-5.4 7.5-10v-6L12 2.5z" fill={color} fill-opacity="0.2" />
	{:else if element === 'parry'}
		<path d="M5 19 19 5M14 5h5v5M9 19H5v-4" />
	{:else if element === 'ray'}
		<circle cx="6" cy="18" r="2.5" />
		<path d="M8 16 20 4M10 18l10-6M6 14l6-10" />
	{:else}
		<path d="M12 2 15 9l7 3-7 3-3 7-3-7-7-3 7-3 3-7z" fill={color} fill-opacity="0.3" />
	{/if}
</svg>
