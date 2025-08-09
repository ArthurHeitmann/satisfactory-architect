<script lang="ts">
    import { svgPresets, type SvgPresetName } from "./svgPresets";

	interface Props {
		name: SvgPresetName,
		x?: number;
		y?: number;
		size: number;
		color: string;
	}
	const {
		name,
		x,
		y,
		size,
		color,
	}: Props = $props();

	const preset = svgPresets[name];
</script>

{#if preset}
	<svg
		x={x}
		y={y}
		width={size}
		height={size}
		viewBox={preset.viewBox}
		xmlns="http://www.w3.org/2000/svg"
		style="color: {color};"
	>
		{@html preset.innerHtml}
	</svg>
{:else}
	?
{/if}
