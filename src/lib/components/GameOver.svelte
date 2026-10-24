<script lang="ts">
	let { onrespawn, onquit }: { onrespawn: () => void; onquit: () => void } = $props();
</script>

<div class="absolute inset-0 z-30 grid place-items-center bg-[radial-gradient(ellipse_at_center,rgba(60,0,20,0.55),rgba(5,0,8,0.88))]">
	<div class="af-fade-in flex flex-col items-center text-center">
		<div class="af-title text-6xl font-black tracking-[0.3em] text-[#ffb0b0]">FALLEN</div>
		<div class="af-divider my-4 w-[420px]"></div>
		<p class="max-w-[440px] text-xl text-[#e8dcc4]/90 italic">The Aether pulls you back from the brink. Rise again at the last waystone you attuned.</p>
		<div class="mt-8 flex gap-3">
			<button class="af-btn af-btn-primary h-12 w-48" onclick={onrespawn}>Rise Again</button>
			<button class="af-btn h-12 w-48" onclick={onquit}>Quit to Title</button>
		</div>
	</div>
</div>
