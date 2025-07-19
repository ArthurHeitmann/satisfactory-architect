<script lang="ts">
	import { EventStream, type EventBase, type EventType, type ShowContextMenuEvent, type ShowProductionSelectorEvent } from "$lib/EventStream.svelte";
	import { onDestroy, setContext, type Snippet } from "svelte";
	import ContextMenuOverlay from "./ContextMenuOverlay.svelte";
	import RecipeSelectorOverlay from "./RecipeSelectorOverlay.svelte";

	interface Props {
		children: Snippet;
		eventStream: EventStream;
	}
	const {
		children,
		eventStream
	}: Props = $props();
	
	setContext("event-stream", eventStream);

	let activeEvents: EventBase[] = $state([]);

	function handleEvent(event: EventBase) {
		const uniqueEventTypes: EventType[] = ["showContextMenu", "showProductionSelector"];
		const isUniqueEvent = uniqueEventTypes.includes(event.type);
		if (isUniqueEvent) {
			activeEvents = activeEvents.filter(e => e.type !== event.type);
		}
		activeEvents = [...activeEvents, event];
	}

	eventStream.addListener(handleEvent);

	onDestroy(() => {
		eventStream.removeListener(handleEvent);
	});

	function onBackgroundClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			dismissEventStream.emit({type: ""});
		}
	}

	function closeEvent(event: EventBase) {
		activeEvents = activeEvents.filter(e => e !== event);
	}

	const dismissEventStream = new EventStream();
</script>

<div
	class="overlay-layer"
>
	{@render children()}
	<div
		class="overlays"
		class:active={activeEvents.length > 0}
		onclick={activeEvents.length > 0 ? onBackgroundClick : null}
		oncontextmenu={e => {
			const hasContextMenu = activeEvents.some(ev => ev.type === "showContextMenu");
			if (!hasContextMenu) {
				return;
			}
			e.preventDefault();
			activeEvents = activeEvents.filter(ev => ev.type !== "showContextMenu");
		}}
	>
		{#each activeEvents as event}
			{#if event.type === "showContextMenu"}
				<ContextMenuOverlay
					event={event as ShowContextMenuEvent}
					{dismissEventStream}
					onclose={() => closeEvent(event)}
				/>
			{:else if event.type === "showProductionSelector"}
				<RecipeSelectorOverlay
					event={event as ShowProductionSelectorEvent}
					{dismissEventStream}
					onclose={() => closeEvent(event)}
				/>
			{/if}
		{/each}
	</div>
</div>

<style lang="scss">
	.overlay-layer {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.overlays {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;

		&:not(.active) {
			pointer-events: none;
		}
	}
</style>
