<script lang="ts">
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
	import { productionNodeIconSize } from "$lib/components/datamodel/constants";
	import { getContext } from "svelte";
	import SfIconView from "../SFIconView.svelte";
	import SvgInput from "../SvgInput.svelte";
	import { floatToString } from "$lib/utilties";
	import { globals } from "../datamodel/globals.svelte";
	import type { GraphNode, GraphNodeProductionProperties } from "../datamodel/GraphNode.svelte";
	import type { GraphPage } from "../datamodel/GraphPage.svelte";

	interface Props {
		node: GraphNode<GraphNodeProductionProperties>;
	}
	const {
		node,
	}: Props = $props();

	const page = getContext("graph-page") as GraphPage;

	const isSelected = $derived(page.selectedNodes.has(node.id));
	const highlightAttachable = $derived(page.highlightedNodes.attachable.has(node.id));
	const highlightHovered = $derived(page.highlightedNodes.hovered.has(node.id));

	const { icon } = $derived.by(() => {
		const details = node.properties.details;
		switch (details.type) {
			case "recipe": {
				const building = satisfactoryDatabase.buildings[satisfactoryDatabase.recipes[details.recipeClassName]?.producedIn];
				return {
					icon: building?.icon,
				};
			}
			case "factory-output":
			case "factory-input": {
				const part = satisfactoryDatabase.parts[details.partClassName];
				return {
					icon: part?.icon,
				};
			}
			case "extraction": {
				const building = satisfactoryDatabase.buildings[details.buildingClassName];
				return {
					icon: building?.icon,
				};
			}
			case "power-production":
				const building = satisfactoryDatabase.buildings[details.powerBuildingClassName];
				return {
					icon: building?.icon,
				};
			default:
				return {
					icon: undefined,
				};
		}
	});

	const factoryName = $derived.by(() => {
		if (node.properties.details.type !== "factory-reference") {
			return undefined;
		}
		const pageId = node.properties.details.factoryId;
		const factoryPage = page.context.appState.pages.find((p) => p.id === pageId);
		if (!factoryPage) {
			return `Factory (${pageId})`;
		}
		return factoryPage.name;
	});

	$effect(() => node.reorderRecipeJoints(page));
</script>

<g
	class="recipe-node-view"
	class:selected={isSelected}
	class:highlight-attachable={highlightAttachable}
	class:highlight-hovered={highlightHovered}
>
	<rect
		class="background"
		x={-node.size.x / 2}
		y={-node.size.y / 2}
		width={node.size.x}
		height={node.size.y}
	/>
	{#if icon}
		<SfIconView
			icon={icon}
			x={-productionNodeIconSize / 2}
			y={-productionNodeIconSize / 2}
			size={productionNodeIconSize}
		/>
	{/if}
	{#if node.properties.details.type !== "factory-reference"}
		<SvgInput
			x={-productionNodeIconSize / 2}
			y={productionNodeIconSize / 2 - 10}
			width={productionNodeIconSize}
			height={10}
			isEditable={!node.properties.autoMultiplier}
			fontSize={12}
			value={floatToString(node.properties.multiplier, 3)}
			onChange={(value) => {
				const parsedValue = Number(value);
				if (!isNaN(parsedValue)) {
					node.properties.multiplier = parsedValue;
				}
			}}
			textAlign="right"
		/>
	{/if}
	{#if factoryName}
		<text
			x="0"
			y={productionNodeIconSize / 2 + 5}
			text-anchor="middle"
			font-size="12px"
			font-family="monospace"
			style="pointer-events: none;"
		>
			{factoryName}
		</text>
	{/if}
	{#if globals.debugShowNodeIds}
		<text
			x="0"
			y="-15"
			text-anchor="middle"
			style="pointer-events: none; font-size: 11px; font-family: monospace;"
		>
			n {node.id}
		</text>
	{/if}
</g>

<style lang="scss">
	.recipe-node-view {
		.background {
			fill: var(--node-background-color);
			stroke: var(--node-border-color);
			stroke-width: var(--rounded-border-width);
			rx: var(--rounded-border-radius-big);
			ry: var(--rounded-border-radius-big);
			transition: stroke 0.1s ease-in-out;
		}

		&:where(:hover, .highlight-attachable):not(:where(.selected, .highlight-hovered)) {
			.background {
				stroke: var(--node-border-hover-color);
			}
		}

		&:where(.selected, .highlight-hovered) {
			.background {
				stroke: var(--node-border-selected-color);
			}
		}
	}
</style>
