<script lang="ts">
    import type { ContextMenuItem, EventStream, ShowContextMenuEvent } from "$lib/EventStream.svelte";

	interface Props {
		event: ShowContextMenuEvent;
		dismissEventStream?: EventStream;
		onclose: () => void;
	}
	const { event, dismissEventStream, onclose }: Props = $props();

	dismissEventStream?.addListener(() => onclose());

	function handleItemClick(item: ContextMenuItem) {
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
	const reserveIconSpace = event.items.some(item => item.icon !== undefined);
</script>

<div
	class="context-menu {horizontalDirection} {verticalDirection}"
	style="--x: {event.x}px; --y: {event.y}px"
>
	{#each event.items as item}
		<button class="context-menu-item" onclick={() => handleItemClick(item)}>
			{#if item.icon}
				<!-- svelte-ignore a11y_missing_attribute -->
				<img class="icon" src={item.icon} />
			{:else if reserveIconSpace}
				<div class="icon-placeholder"></div>
			{/if}
			{item.label}
			{#if item.hint}
				<span class="hint">{item.hint}</span>
			{/if}
		</button>
	{/each}
</div>

<style lang="scss">
	.context-menu {
		position: absolute;
		top: var(--y);
		left: var(--x);
		background: var(--background-200);
		padding: 4px;
		border-radius: 4px;
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
		justify-content: space-between;
		height: 30px;
		line-height: 30px;
		padding: 0 8px;
		background: transparent;
		border-radius: 4px;
		
		&:hover {
			background: var(--background-300);
		}

		&:active {
			background: var(--background-400);
		}

		.hint {
			margin-left: 16px;
			opacity: 0.6;
		}
	}
</style>
