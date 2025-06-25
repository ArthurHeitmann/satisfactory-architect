<script lang="ts">
	import type { GraphNode, GraphNodeRecipeProperties, GraphPage } from "$lib/components/datamodel/datamodel.svelte";
    import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
    import type { SFRecipePart } from "$lib/satisfactoryDatabaseTypes";
    import { getContext } from "svelte";
    import SfIconView from "../SFIconView.svelte";

	interface Props {
		node: GraphNode<GraphNodeRecipeProperties>;
	}
	const {
		node,
	}: Props = $props();

	const page = getContext("graph-page") as GraphPage;

	const isSelected = $derived(page.selectedNodes.has(node.id));

	const recipe = $derived(satisfactoryDatabase.recipes[node.properties.recipeClassName]);
	const building = $derived(satisfactoryDatabase.buildings[satisfactoryDatabase.recipes[node.properties.recipeClassName]?.producedIn]);
</script>

<g
	class="recipe-node-view"
	class:selected={isSelected}
>
	<rect
		class="background"
		x={-node.properties.nodeSize.width / 2}
		y={-node.properties.nodeSize.height / 2}
		width={node.properties.nodeSize.width}
		height={node.properties.nodeSize.height}
		fill="var(--background-300)"
		rx="8"
		ry="8"
	/>
	{#if building}
		<SfIconView
			icon={building.icon}
			x={-node.properties.nodeSize.width / 2 + 8}
			y={-48 / 2}
			size={48}
		/>
	{/if}
	<text
		class="recipe-name"
		x={0}
		y={0}
		text-anchor="middle"
		dominant-baseline="central"
	>
		{#if recipe}
			{recipe.recipeDisplayName}
		{:else}
			{node.properties.recipeClassName}
		{/if}
	</text>
	{#if recipe}
		{@const icon = satisfactoryDatabase.icons[satisfactoryDatabase.parts[recipe.outputs[0].itemClass]?.icon]?.name}
		{#if icon}
			<SfIconView
				icon={icon}
				x={node.properties.nodeSize.width / 2 - 8 - 48}
				y={-48 / 2}
				size={48}
			/>
		{/if}
	{/if}
</g>

<style lang="scss">
	.recipe-node-view {
		.background {
			stroke: var(--background-400);
			stroke-width: 1;
			transition: stroke 0.1s ease-in-out;
		}

		&:hover:not(.selected) {
			.background {
				stroke: var(--background-500);
			}
		}
	}

	:global(.recipe-node-view.selected) {
		.background {
			stroke: var(--accent);
		}
	}
</style>
