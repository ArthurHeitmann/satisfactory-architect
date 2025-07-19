<script lang="ts">
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
	import type { SFRecipePart } from "$lib/satisfactoryDatabaseTypes";
	import { getContext } from "svelte";
	import SfIconView from "../SFIconView.svelte";
	import { getNodeRadius, isNodeSelectable } from "../datamodel/nodeTypeProperties.svelte";
	import { globals } from "../datamodel/globals.svelte";
	import SvgInput from "../SvgInput.svelte";
	import { floatToString } from "$lib/utilties";
	import type { GraphNode, GraphNodeResourceJointProperties } from "../datamodel/GraphNode.svelte";
	import type { GraphPage } from "../datamodel/GraphPage.svelte";

	interface Props {
		node: GraphNode<GraphNodeResourceJointProperties>;
	}
	const {
		node,
	}: Props = $props();

	const page = getContext("graph-page") as GraphPage;

	// const parent = node.parentNode ? page.nodes.get(node.parentNode) as GraphNode<GraphNodeProductionProperties> : undefined;
	// const layoutOrientation = $derived(parent?.properties.resourceJoints.find(joint => joint.id === node.id)?.layoutOrientation);
	// const recipe = parent?.properties.details.recipeClassName ? satisfactoryDatabase.recipes[parent.properties.details.recipeClassName] : undefined;
	// const recipePart = recipe ? [...recipe.inputs, ...recipe.outputs].find(p => p.itemClass === node.properties.resourceClassName) : undefined;
	
	const { productionRate, setProductionRate } = $derived.by(() => {
		const parent = node.parentNode ? page.nodes.get(node.parentNode) : undefined;
		const parentProperties = parent?.properties;
		if (parentProperties?.type !== "production") {
			return {
				outputIcon: undefined,
				productionRate: undefined,
				setProductionRate: undefined,
			};
		}
		
		const parentDetails = parentProperties.details;
		let productionRate: number | undefined;
		let setProductionRate: ((value: number) => void) | undefined;
		switch (parentDetails.type) {
			case "recipe":
				const recipe = satisfactoryDatabase.recipes[parentDetails.recipeClassName];
				const output = recipe?.outputs[0];
				if (output) {
					productionRate = output.amountPerMinute * parentProperties.multiplier;
					setProductionRate = ((value: number) => parentProperties.multiplier = value / output.amountPerMinute);
				}
				break;
			case "factory-input":
			case "factory-output":
				const factoryPart = satisfactoryDatabase.parts[parentDetails.partClassName];
				if (factoryPart) {
					productionRate = 60 * parentProperties.multiplier;
					setProductionRate = ((value: number) => parentProperties.multiplier = value / 60);
				}
				break;
			case "extraction":
				const productionBuilding = satisfactoryDatabase.productionBuildings[parentDetails.buildingClassName];
				const purityModifier = parentDetails.purityModifier ?? 1;
				if (productionBuilding && purityModifier) {
					productionRate = productionBuilding.baseProductionRate * purityModifier * parentProperties.multiplier;
					setProductionRate = ((value: number) => parentProperties.multiplier = value / productionBuilding.baseProductionRate / purityModifier);
				}
				break;
		}

		return {
			productionRate,
			setProductionRate,
		};
	});

	const isSelected = $derived(page.selectedNodes.has(node.id));
	const isSelectable = $derived(isNodeSelectable(node));
	const highlightAttachable = $derived(page.highlightedNodes.attachable.has(node.id));
	const highlightHovered = $derived(page.highlightedNodes.hovered.has(node.id));

	const resource = $derived(satisfactoryDatabase.parts[node.properties.resourceClassName]);

	const outerRadius = getNodeRadius(node);
	const innerRadius = outerRadius - 4;
	const inputWidth = outerRadius * 2.2;
</script>

<g
	class="resource-joint-node-view"
	class:selectable={isSelectable}
	class:selected={isSelected}
	class:highlight-attachable={highlightAttachable}
	class:highlight-hovered={highlightHovered}
>
	<circle r={outerRadius} />
	<SfIconView
		icon={resource.icon}
		x={-innerRadius}
		y={-innerRadius}
		size={innerRadius * 2}
	/>
	{#if productionRate !== undefined && setProductionRate}
		<SvgInput
			x={-inputWidth / 2}
			y={8}
			width={inputWidth}
			height={12}
			fontSize={11}
			isEditable={true}
			textAlign={"center"}
			value={floatToString(productionRate, 4)}
			onChange={(value) => {
				const parsedValue = Number(value);
				if (!isNaN(parsedValue)) {
					setProductionRate(parsedValue);
				}
			}}
		/>
	{/if}
	{#if globals.debugShowNodeIds}
		<text
			x="0"
			y="-10"
			text-anchor="middle"
			font-size="10px"
			font-family="monospace"
			style="pointer-events: none;"
		>
			n {node.id}
		</text>
	{/if}
</g>

<style lang="scss">
	.resource-joint-node-view {
		circle {
			fill: var(--node-background-color);
			stroke: var(--node-border-color);
			stroke-width: var(--rounded-border-width);
			transition: stroke 0.1s ease-in-out;
		}
	}

	:global(.resource-joint-node-view.selectable:hover:not(:where(.selected, .highlight-hovered))) {
		circle {
			stroke: var(--node-border-hover-color);
		}
	}

	:global(.resource-joint-node-view:where(.highlight-attachable)) {
		circle {
			stroke: var(--node-border-highlight-color);
		}
	}

	:global(.resource-joint-node-view:where(.selected, .highlight-hovered)) {
		circle {
			stroke: var(--node-border-selected-color);
		}
	}
</style>
