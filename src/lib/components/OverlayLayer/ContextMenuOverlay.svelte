<script lang="ts">
	import type { ContextMenuItem, ContextMenuItemAction, EventStream, ShowContextMenuEvent } from "$lib/EventStream.svelte";
    import PresetSvg from "../icons/PresetSvg.svelte";

	interface Props {
		event: ShowContextMenuEvent;
		dismissEventStream?: EventStream;
		onclose: () => void;
	}
	const { event, dismissEventStream, onclose }: Props = $props();

	dismissEventStream?.addListener(() => onclose());

	function handleItemClick(item: ContextMenuItemAction) {
		if ("onClick" in item) {
			item.onClick();
		}
		if (event.onClick && "value" in item) {
			event.onClick(item.value);
		}
		onclose();
	}

	const itemHeight = 30;
	const itemGap = 0;
	const edgePadding = 4;
	const expectedWidth = 200;
	const expectedHeight = event.items.length * itemHeight + (event.items.length - 1) * itemGap + edgePadding * 2;
	const screenWidth = window.innerWidth;
	const screenHeight = window.innerHeight;
	// svelte-ignore non_reactive_update
	let horizontalDirection: "l-to-r" | "r-to-l";
	// svelte-ignore non_reactive_update
	let verticalDirection: "t-to-b" | "b-to-t";
	if (event.x + expectedWidth > screenWidth) {
		horizontalDirection = "r-to-l";
	} else {
		horizontalDirection = "l-to-r";
	}
	if (event.y + expectedHeight > screenHeight) {
		verticalDirection = "b-to-t";
	} else {
		verticalDirection = "t-to-b";
	}
	const reserveIconSpace = event.items.some(item => "icon" in item && item.icon !== undefined);
</script>

<div
	class="context-menu {horizontalDirection} {verticalDirection}"
	style="--x: {event.x}px; --y: {event.y}px"
>
	{#each event.items as item}
		{#if "items" in item}
			<div class="button-row">
				{#each item.items as button}
					<button
						class="icon-button"
						class:selected={item.currentValue === button.value}
						onclick={() => {
							item.onClick(button.value);
							onclose();
						}}
						disabled={button.disabled}
					>
						<PresetSvg name={button.icon} size={18} color="currentColor" />
					</button>
				{/each}
			</div>
		{:else}
			<button class="context-menu-item" onclick={() => handleItemClick(item)} disabled={item.disabled}>
				{#if item.icon}
					<PresetSvg name={item.icon} size={18} color="currentColor" />
				{:else if reserveIconSpace}
					<div class="icon-placeholder"></div>
				{/if}
				<span class="label">{item.label}</span>
				{#if item.hint}
					<span class="hint">{item.hint}</span>
				{/if}
			</button>
		{/if}
	{/each}
</div>

<style lang="scss">
	.context-menu {
		position: absolute;
		top: var(--y);
		left: var(--x);
		background: var(--context-menu-background-color);
		padding: 4px;
		border-radius: var(--rounded-border-radius);
		border: var(--rounded-border-width) solid var(--context-menu-border-color);
		width: max-content;
		display: flex;
		flex-direction: column;

		&.r-to-l {
			transform: translateX(-100%);
		}

		&.b-to-t {
			transform: translateY(-100%);
		}
	}

	.context-menu-item {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 4px;
		height: 30px;
		line-height: 30px;
		padding: 0 8px;
		background: var(--context-menu-item-color);
		border-radius: var(--rounded-border-radius);
		text-align: left;
		
		&:disabled {
			opacity: 0.5;
			cursor: default;
		}

		&:not(:disabled) {
			&:hover {
				background: var(--context-menu-item-hover-color);
			}
	
			&:active {
				background: var(--context-menu-item-active-color);
			}
		}


		.label {
			flex: 1;
		}

		.hint {
			margin-left: 4px;
			opacity: 0.6;
		}
	}

	.button-row {
		height: 30px;
		display: flex;
		gap: 4px;
		justify-content: space-evenly;
		align-items: center;
	}

	.icon-button {
		width: 24px;
		height: 24px;
		border-radius: var(--rounded-border-radius);
		display: flex;
		align-items: center;
		justify-content: center;

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
