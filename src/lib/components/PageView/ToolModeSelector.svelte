<script lang="ts" module>
</script>
<script lang="ts">
    import type { ToolMode } from '$lib/datamodel/GraphPage.svelte';
    import PresetSvg from '../icons/PresetSvg.svelte';
        import type { SvgPresetName } from '../icons/svgPresets';

	interface Props {
		activeMode: ToolMode;
		x: number;
		y: number;
	}
	let {
		activeMode = $bindable(),
		x,
		y,
	}: Props = $props();
</script>

<div class="toolbar" style="top: {x}px; left: {y}px;">
	{#snippet toolButton(mode: ToolMode, icon: SvgPresetName, tooltip: string)}
		<button
			class="tool-button"
			class:selected={activeMode === mode}
			onclick={() => activeMode = mode}
			data-tooltip={tooltip}
			data-tooltip-position="right"
		>
			<PresetSvg
				name={icon}
				size={24}
				color="currentColor"
			/>
		</button>
	{/snippet}
	{@render toolButton("select-nodes", "select-nodes", "Select Nodes")}
	{@render toolButton("select-edges", "select-edges", "Select Edges")}
	{@render toolButton("add-note", "note", "Add Note")}
</div>

<style lang="scss">
	.toolbar {
		padding: 4px;
		position: absolute;
		background: var(--toolbar-background-color);
		border: var(--rounded-border-width) solid var(--toolbar-border-color);
		border-radius: var(--rounded-border-radius);
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
	}

	.tool-button {
		width: 24px;
		height: 24px;
		border-radius: var(--rounded-border-radius);

		&:hover {
			background: var(--toggle-button-hover-background-color);
		}

		&:active {
			background: var(--toggle-button-active-background-color);
		}

		&.selected {
			background: var(--toggle-button-selected-background-color);
			color: var(--toggle-button-selected-text-color);
		}
	}
</style>
