<script lang="ts">
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
	import { productionNodeIconSize } from "$lib/datamodel/constants";
	import SfIconView from "../SFIconView.svelte";
	import SvgInput from "../SvgInput.svelte";
	import { floatToString, parseFloatExpr } from "$lib/utilties";
	import { globals } from "../../datamodel/globals.svelte";
	import type { GraphNode, GraphNodeProductionProperties } from "../../datamodel/GraphNode.svelte";

	interface Props {
		node: GraphNode<GraphNodeProductionProperties>;
	}
	const {
		node,
	}: Props = $props();

	const page = $derived(node.context.page);

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
			case "factory-reference":
				const factoryPage = page.context.appState.pages.find(p => p.id === details.factoryId);
				return {
					icon: factoryPage?.icon,
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

	function onMultiplierChange(value: string, isEnter: boolean) {
		const parsedValue = parseFloatExpr(value, !isEnter);
		if (!isNaN(parsedValue)) {
			node.properties.multiplier = parsedValue;
		}
	}
</script>

<g
	class="recipe-node-view"
	class:selected={isSelected}
	class:highlight-attachable={highlightAttachable}
	class:highlight-hovered={highlightHovered}
	style="--background-color: {node.properties.customColor ?? 'var(--node-background-color)'};"
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
			onChange={(value) => onMultiplierChange(value, false)}
			onEnter={(value) => onMultiplierChange(value, true)}
			textAlign="right"
		/>
	{/if}
	{#if factoryName}
		<foreignObject
			x={-node.size.x / 2 + 12}
			y={productionNodeIconSize / 2}
			width={node.size.x - 24}
			height={node.size.y / 2 - productionNodeIconSize / 2}
			class="factory-name"
		>
			<div>
				{factoryName}
			</div>
		</foreignObject>
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
			fill: var(--background-color);
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

	.factory-name {
		pointer-events: none;
		overflow: hidden;

		div {
			text-align: center;
			font-size: 11px;
			line-break: anywhere;
		}
	}
</style>
