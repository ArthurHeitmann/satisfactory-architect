<script lang="ts">
	import { EventStream, type ConfirmationPromptEvent, type EventBase, type EventType, type ShowContextMenuEvent, type ShowProductionSelectorEvent } from "$lib/EventStream.svelte";
	import { onDestroy, onMount, setContext, type Snippet } from "svelte";
	import ContextMenuOverlay from "./ContextMenuOverlay.svelte";
	import RecipeSelectorOverlay from "./RecipeSelectorOverlay.svelte";
	import { fade } from "svelte/transition";
	import type { IVector2D } from "$lib/datamodel/GraphView.svelte";
	import ConfirmationPrompt from "./ConfirmationPrompt.svelte";

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

	onMount(() => {
		eventStream.addListener(handleEvent);
	});

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

	class HoveredElement {
		element: Element;
		tooltip: string;
		startPoint: IVector2D;
		transform: string;
		startTimeout: any | null;
		endTimeout: any | null;
		isVisible: boolean;
		
		constructor(
			element: Element,
			tooltip: string,
			startPoint: IVector2D,
			transform: string,
			startTimeout: any | null = null,
			endTimeout: any | null = null
		) {
			this.element = element;
			this.tooltip = tooltip;
			this.startPoint = startPoint;
			this.transform = transform;
			this.startTimeout = startTimeout;
			this.endTimeout = endTimeout;
			this.isVisible = $state(false);
		}
	}
	let hoveredElements: HoveredElement[] = $state([]);
	const showDelayMs = 500;
	const hideDelayMs = 500;

	function onElementMouseOver(e: MouseEvent) {
		const allHoveredByEvent = getAllHoveredTooltips(e.target as Element);
		const allNew = getNewHovered(allHoveredByEvent);
		const allSame = getSameHovered(allHoveredByEvent);
		const allDead = getDeadHovered(allHoveredByEvent);

		for (const newElement of allNew) {
			const rect = newElement.getBoundingClientRect();
			let startPoint: IVector2D;
			let transform: string;
			switch (newElement.getAttribute("data-tooltip-position")) {
				case "bottom":
					startPoint = {x: rect.left + rect.width / 2, y: rect.bottom};
					transform = "translate(-50%, 0) translateY(4px)";
					break;
				case "left":
					startPoint = {x: rect.left, y: rect.top + rect.height / 2};
					transform = "translate(-100%, -50%) translateX(-4px)";
					break;
				case "right":
					startPoint = {x: rect.right, y: rect.top + rect.height / 2};
					transform = "translate(0, -50%) translateX(4px)";
					break;
				case "top":
				default:
					startPoint = {x: rect.left + rect.width / 2, y: rect.top};
					transform = "translate(-50%, -100%) translateY(-4px)";
					break;
			}
			const newHov = new HoveredElement(
				newElement,
				newElement.getAttribute("data-tooltip")!,
				startPoint,
				transform,
			);
			newHov.startTimeout = setTimeout(() => onElementTooltipStart(newHov), showDelayMs);
			hoveredElements = [...hoveredElements, newHov];
		}
		for (const sameElement of allSame) {
			if (!sameElement.startTimeout) {
				sameElement.startTimeout = setTimeout(() => onElementTooltipStart(sameElement), showDelayMs);
			}
			if (sameElement.endTimeout) {
				clearTimeout(sameElement.endTimeout);
				sameElement.endTimeout = null;
			}
		}
		for (const deadElement of allDead) {
			if (deadElement.startTimeout) {
				clearTimeout(deadElement.startTimeout);
				deadElement.startTimeout = null;
			}
			if (!deadElement.endTimeout)
				deadElement.endTimeout = setTimeout(() => onElementTooltipEnd(deadElement), hideDelayMs)
		}
	}

	function onElementTooltipStart(element: HoveredElement) {
		element.startTimeout = null;
		element.isVisible = true;
	}

	function onElementTooltipEnd(element: HoveredElement) {
		element.endTimeout = null;
		element.isVisible = false;
		hoveredElements = hoveredElements.filter(e => e !== element);
	}

	function getNewHovered(allNewHovered: Element[]): Element[] {
		return allNewHovered
			.filter(elem => hoveredElements.findIndex(hovered => hovered.element === elem) === -1);
	}

	function getSameHovered(allNewHovered: Element[]): HoveredElement[] {
		return hoveredElements
			.filter(hovered => allNewHovered.findIndex(elem => hovered.element === elem) !== -1);
	}

	function getDeadHovered(allNewHovered: Element[]): HoveredElement[] {
		return hoveredElements
			.filter(hovered => allNewHovered.findIndex(elem => hovered.element === elem) === -1);
	}

	function getAllHoveredTooltips(target: Element|null): Element[] {
		const out = [];
		while (target) {
			if (target.hasAttribute("data-tooltip"))
				out.push(target);
			target = target.parentElement;
		}
		return out;
	}
</script>

<svelte:window onmouseover={onElementMouseOver} />

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
			{:else if event.type === "confirmationPrompt"}
				<ConfirmationPrompt
					event={event as ConfirmationPromptEvent}
					{dismissEventStream}
					onclose={() => closeEvent(event)}
				/>
			{/if}
		{/each}

		{#each hoveredElements as element}
			{#if element.isVisible}
				<div
					class="tooltip"
					style="top: {element.startPoint.y}px; left: {element.startPoint.x}px; transform: {element.transform};"
					in:fade={{ duration: 50 }}
					out:fade={{ duration: 100 }}
				>
					{element.tooltip}
				</div>
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

	.tooltip {
		pointer-events: none;
		position: absolute;
		background: var(--tooltip-background-color);
		border: 1px solid var(--tooltip-border-color);
		padding: 0 10px;
		font-size: 14px;
		line-height: 24px;
		border-radius: 6px;
	}
</style>
