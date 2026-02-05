<script lang="ts">
    import { Spring } from "svelte/motion";
    import PresetSvg from "../icons/PresetSvg.svelte";


	interface Props {
		x: number,
		y: number,
		color: string,
	}
	const { x, y, color }: Props = $props();

	const xSpring = Spring.of(() => x, { damping: 0.6, stiffness: 0.08 });
	const ySpring = Spring.of(() => y, { damping: 0.6, stiffness: 0.08 });
</script>

<g
	class="cursor"
	style="--cursor-x: {xSpring.current}px; --cursor-y: {ySpring.current}px;"
	>
	<PresetSvg name="cursor" size={20} color={color} />
</g>

<style>
	.cursor {
		transform: translate(var(--cursor-x), var(--cursor-y));
	}
</style>
