<script lang="ts">
	import { onMount } from 'svelte';
	import type { Game } from '../game/core/Game';
	import { WORLD_HALF, WORLD_SIZE } from '../game/world/Biomes';

	let { game, onclose }: { game: Game; onclose: () => void } = $props();
	let canvas: HTMLCanvasElement;
	const SIZE = 520;

	const toMap = (v: number) => ((v + WORLD_HALF) / WORLD_SIZE) * SIZE;

	onMount(() => {
		const ctx = canvas.getContext('2d')!;
		let raf = 0;
		const draw = () => {
			raf = requestAnimationFrame(draw);
			const d = game.getMapData();
			ctx.imageSmoothingEnabled = true;
			ctx.drawImage(d.image, 0, 0, SIZE, SIZE);
			ctx.fillStyle = 'rgba(255,255,255,0.08)';
			ctx.fillRect(0, 0, SIZE, SIZE);
			// Hive
			ctx.font = '22px serif';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			ctx.fillText('🍯', toMap(d.hive.x), toMap(d.hive.z));
			ctx.font = 'bold 11px ui-rounded, system-ui, sans-serif';
			ctx.fillStyle = '#3e2a17';
			ctx.fillText('THE HIVE', toMap(d.hive.x), toMap(d.hive.z) + 17);
			for (const l of d.landmarks) {
				const x = toMap(l.x);
				const y = toMap(l.z);
				ctx.font = '16px serif';
				ctx.globalAlpha = l.found ? 1 : 0.55;
				ctx.fillText(l.found ? l.icon : '❔', x, y);
				if (l.found) {
					ctx.font = 'bold 10px ui-rounded, system-ui, sans-serif';
					ctx.fillStyle = 'rgba(255,255,255,0.85)';
					const w = ctx.measureText(l.name).width + 8;
					ctx.fillRect(x - w / 2, y + 10, w, 13);
					ctx.fillStyle = '#3e2a17';
					ctx.fillText(l.name, x, y + 17);
				}
				ctx.globalAlpha = 1;
			}
			for (const t of d.totems) {
				const x = toMap(t.x);
				const y = toMap(t.z);
				ctx.fillStyle = '#ffffff';
				ctx.beginPath();
				ctx.arc(x, y, 10, 0, Math.PI * 2);
				ctx.fill();
				ctx.strokeStyle = '#3e2a17';
				ctx.lineWidth = 2;
				ctx.stroke();
				ctx.font = '12px serif';
				ctx.fillText(t.icon, x, y + 1);
			}
			for (const o of d.orbs) {
				ctx.fillStyle = '#ffd54f';
				ctx.beginPath();
				ctx.arc(toMap(o.x), toMap(o.z), 3.5, 0, Math.PI * 2);
				ctx.fill();
			}
			if (d.objective) {
				ctx.strokeStyle = '#ff4081';
				ctx.lineWidth = 3;
				ctx.beginPath();
				ctx.arc(toMap(d.objective.x), toMap(d.objective.z), 9 + Math.sin(performance.now() / 150) * 2, 0, Math.PI * 2);
				ctx.stroke();
			}
			// Player arrow (heading: 0 = +Z).
			const px = toMap(d.player.x);
			const py = toMap(d.player.z);
			ctx.save();
			ctx.translate(px, py);
			ctx.rotate(-d.player.heading + Math.PI);
			ctx.fillStyle = '#ffeb3b';
			ctx.strokeStyle = '#3e2a17';
			ctx.lineWidth = 2.5;
			ctx.beginPath();
			ctx.moveTo(0, -11);
			ctx.lineTo(8, 9);
			ctx.lineTo(0, 4);
			ctx.lineTo(-8, 9);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			ctx.restore();
		};
		draw();
		return () => cancelAnimationFrame(raf);
	});
</script>

<div class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-bark-900/30 px-4">
	<div class="bm-panel pointer-events-auto p-3">
		<div class="mb-2 flex items-center justify-between px-1">
			<h2 class="text-lg font-black">🗺️ World Map</h2>
			<span class="text-xs font-bold opacity-60">N ↑ · press M to close</span>
			<button class="bm-btn bm-btn-ghost h-8 w-8 text-sm" onclick={onclose} aria-label="Close map">✕</button>
		</div>
		<canvas bind:this={canvas} width={SIZE} height={SIZE} class="block aspect-square w-[min(80vh,86vw,520px)] rounded-xl border-[3px] border-bark-800"></canvas>
	</div>
</div>
