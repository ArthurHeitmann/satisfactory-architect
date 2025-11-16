<script lang="ts">
	import type { ContextMenuItemAction, EventStream, ShowColorPickerEvent, ShowContextMenuEvent } from "$lib/EventStream.svelte";
	import { onMount } from "svelte";
	import PresetSvg from "../icons/PresetSvg.svelte";

	interface Props {
		event: ShowColorPickerEvent;
		onclose: () => void;
	}
	const { event, onclose }: Props = $props();

	const availableColors = [
		"#AA6C78", "#CB9D75", "#CBC98B", "#7A9D7D", "#4382A2", "#6C557E",
		"#E64A39", "#E97439", "#EDD157", "#7FBE59", "#5F8BE9", "#6F1BC6",
		"#DF3100", "#FB9C01", "#FFED00", "#00D51B", "#34EBFF", "#760EF4",
		"#0d0d0d", "#333333", "#4d4d4d", "#808080", "#b3b3b3", "#e6e6e6",
		// "#", "#", "#", "#", "#", "#",
	];
	const colorsPerRow = 6;
	const colorRows: string[][] = [];
	for (let i = 0; i < availableColors.length; i += colorsPerRow) {
		colorRows.push(availableColors.slice(i, i + colorsPerRow));
	}
</script>

<div
	class="color-picker"
	style="top: {event.y}px; left: {event.x}px;"
>
	{#each colorRows as row}
		<div class="color-row">
			{#each row as color}
				<button
					class="color-button"
					class:selected={event.currentColor() === color}
					style="--color: {color};"
					onclick={() => {
						const newColor = event.currentColor() === color ? undefined : color;
						event.onSelect(newColor);
						// onclose();
					}}
				>
					<div class="circle"></div>
				</button>
			{/each}
		</div>
	{/each}
</div>

<style lang="scss">
	.color-picker {
		position: absolute;
		background: var(--context-menu-background-color);
		padding: 3px;
		border-radius: var(--rounded-border-radius);
		border: var(--rounded-border-width) solid var(--context-menu-border-color);
		display: flex;
		flex-direction: column;
	}

	.color-row {
		display: flex;
	}

	.color-button {
		width: 26px;
		height: 26px;
		padding: 3px;
		cursor: pointer;
		
		.circle {
			width: 20px;
			height: 20px;
			border-radius: 50%;
			border: 2px solid transparent;
			background-color: var(--color);
		}

		&:hover {
			filter: brightness(1.2);
		}

		&:active {
			filter: brightness(1.5);
		}

		&.selected .circle {
			border-color: var(--color-button-selected-border-color);
		}
	}
</style>
