<script lang="ts">
	import type { EventStream, ShowProductionSelectorEvent } from "$lib/EventStream.svelte";
	import { onDestroy, onMount } from "svelte";
	import RecipeSelector from "../RecipeSelector.svelte";
	import type { NewNodeDetails } from "../../datamodel/GraphNode.svelte";

	interface Props {
		event: ShowProductionSelectorEvent;
		dismissEventStream?: EventStream;
		onclose: () => void;
	}
	const { event, dismissEventStream, onclose }: Props = $props();

	function onDismiss() {
		event.onCancel?.();
		onclose();
	}
	
	onMount(() => {
		dismissEventStream?.addListener(onDismiss);
	});

	let cssWidth = $state("auto");

	function onRecipeSelected(result: NewNodeDetails) {
		event.onSelect(result);
		onclose();
	}

	function onNoAvailableRecipes() {
		onDismiss();
	}

	onDestroy(() => {
		dismissEventStream?.removeListener(onDismiss);
	});
</script>

<div
	class="recipe-selector-wrapper"
	style="--x: {event.x}px; --y: {event.y}px; --width: {cssWidth};"
>
	<RecipeSelector
		page={event.page}
		requiredInputsClassName={event.requiredInputsClassName}
		requiredOutputsClassName={event.requiredOutputsClassName}
		onRecipeSelected={onRecipeSelected}
		onNoAvailableRecipes={onNoAvailableRecipes}
		autofocusSearch={event.autofocus}
		bind:cssWidth
	/>
</div>

<style lang="scss">
	.recipe-selector-wrapper {
		position: absolute;
		--max-height: min(80vh, 600px);
		width: var(--width);
		top: max(100px, min(var(--y), calc(100vh - 100px - var(--max-height))));
		left: max(50px, min(var(--x), calc(100vw - 50px - var(--width))));
	}
</style>
