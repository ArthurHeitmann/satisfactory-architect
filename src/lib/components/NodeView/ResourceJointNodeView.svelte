<script lang="ts">
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
	import type { SFPowerFuel, SFRecipe, SFRecipePart } from "$lib/satisfactoryDatabaseTypes";
	import { getContext } from "svelte";
	import SfIconView from "../SFIconView.svelte";
	import { getNodeRadius, isNodeSelectable } from "../../datamodel/nodeTypeProperties.svelte";
	import { globals } from "../../datamodel/globals.svelte";
	import SvgInput from "../SvgInput.svelte";
	import { assertUnreachable, floatToString, getThroughputColor, isThroughputBalanced } from "$lib/utilties";
	import type { GraphNode, GraphNodeProductionProperties, GraphNodeResourceJointProperties } from "../../datamodel/GraphNode.svelte";
	import type { GraphPage } from "../../datamodel/GraphPage.svelte";
    import type { Id } from "../../datamodel/IdGen";

	interface Props {
		node: GraphNode<GraphNodeResourceJointProperties>;
	}
	const {
		node,
	}: Props = $props();

	const page = $derived(node.context.page);
	const { productionRate, setProductionRate, isEditable } = $derived.by(() => {
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
		let isEditable = true;
		switch (parentDetails.type) {
			case "recipe":
			case "power-production":
				let recipe: SFRecipe|SFPowerFuel;
				if (parentDetails.type === "recipe") {
					recipe = satisfactoryDatabase.recipes[parentDetails.recipeClassName];
				} else {
					recipe = satisfactoryDatabase.powerProducers[parentDetails.powerBuildingClassName]
						?.fuels[parentDetails.fuelClassName];
				}
				const recipeParts = node.properties.jointType === "input" ? recipe?.inputs : recipe?.outputs;
				const recipePart = recipeParts?.find(p => p.itemClass === node.properties.resourceClassName);
				const amountPerMinute = recipePart?.amountPerMinute;
				if (amountPerMinute !== undefined) {
					productionRate = amountPerMinute * parentProperties.multiplier;
					setProductionRate = ((value: number) => parentProperties.multiplier = value / amountPerMinute);
				}
				break;
			case "factory-output":
			case "factory-input":
				const factoryPart = satisfactoryDatabase.parts[parentDetails.partClassName];
				if (factoryPart) {
					productionRate = parentProperties.multiplier;
					setProductionRate = ((value: number) => parentProperties.multiplier = value);
				}
				isEditable = !parentProperties.autoMultiplier;
				break;
			case "extraction":
				const productionBuilding = satisfactoryDatabase.extractionBuildings[parentDetails.buildingClassName];
				const purityModifier = parentDetails.purityModifier ?? 1;
				if (productionBuilding && purityModifier) {
					productionRate = productionBuilding.baseProductionRate * purityModifier * parentProperties.multiplier;
					setProductionRate = ((value: number) => parentProperties.multiplier = value / productionBuilding.baseProductionRate / purityModifier);
				}
				break;
			case "factory-reference":
				function getExternalNodeProperties(pageId: Id, externalId?: Id): GraphNodeProductionProperties | undefined {
					if (!externalId)
						return undefined;
					const factoryPage = page.context.appState.pages.find(p => p.id === pageId);
					const externalNode = factoryPage ? factoryPage.nodes.get(externalId) : undefined;
					if (!externalNode || externalNode.properties.type !== "production") {
						return undefined;
					}
					return externalNode.properties;
				}
				const factoryId = parentDetails.factoryId;
				const externalNodeId = parentDetails.jointsToExternalNodes[node.id];
				const externalNodeProperties = getExternalNodeProperties(factoryId, externalNodeId);
				isEditable = externalNodeProperties ? !externalNodeProperties.autoMultiplier : false;
				if (externalNodeProperties) {
					productionRate = externalNodeProperties.multiplier;
					if (isEditable) {
						setProductionRate = ((value: number) => {
							const externalNodeProperties = getExternalNodeProperties(factoryId, externalNodeId);
							if (externalNodeProperties) {
								externalNodeProperties.multiplier = value;
							}
						});
					}
				}
				break;
		}

		return {
			productionRate,
			setProductionRate,
			isEditable,
		};
	});

	const {suggestedThroughput, throughputColor} = $derived.by(() => {
		const fallback = {suggestedThroughput: 0, throughputColor: ""};
		if (node.edges.size === 0) {
			return fallback;
		}
		let totalPushed = 0;
		let totalPulled = 0;
		for (const edgeId of node.edges.values()) {
			const edge = page.edges.get(edgeId);
			if (edge === undefined) {
				continue;
			}
			totalPushed += edge.pushThroughput;
			totalPulled += edge.pullThroughput;
		}
		
		let suggestedThroughput: number;
		if (node.properties.jointType === "input") {
			suggestedThroughput = totalPushed;
		} else if (node.properties.jointType === "output") {
			suggestedThroughput = totalPulled;
		} else {
			assertUnreachable(node.properties.jointType);
		}
		if (isThroughputBalanced(suggestedThroughput, productionRate ?? 0)) {
			return fallback;
		}
		const throughputColor = getThroughputColor(false, totalPushed, totalPulled);
		return { suggestedThroughput, throughputColor };
	});

	const isSelected = $derived(page.selectedNodes.has(node.id));
	const isSelectable = $derived(isNodeSelectable(node));
	const highlightAttachable = $derived(page.highlightedNodes.attachable.has(node.id));
	const highlightHovered = $derived(page.highlightedNodes.hovered.has(node.id));

	const resource = $derived(satisfactoryDatabase.parts[node.properties.resourceClassName]);

	const outerRadius = getNodeRadius(node);
	const innerRadius = outerRadius - 4;
	const inputWidth = outerRadius * 2.2;
	
	const [suggestionAbsOffset, suggestionRelOffset] = (() => {
		const offset = outerRadius - 3;
		if (node.properties.jointType === "input") {
			return [-offset, "-100%"];
		} else if (node.properties.jointType === "output") {
			return [offset, "-0%"];
		} else {
			assertUnreachable(node.properties.jointType);
		}
	})();
</script>

<g
	class="resource-joint-node-view"
	class:selectable={isSelectable}
	class:selected={isSelected}
	class:highlight-attachable={highlightAttachable}
	class:highlight-hovered={highlightHovered}
	class:locked={node.properties.locked}
	data-tooltip={node.properties.locked ? resource?.displayName : undefined}
>
	<circle r={outerRadius} />
	<SfIconView
		icon={resource.icon}
		x={-innerRadius}
		y={-innerRadius}
		size={innerRadius * 2}
	/>
	{#if productionRate !== undefined}
		<SvgInput
			x={-inputWidth / 2}
			y={11}
			width={inputWidth}
			height={9}
			fontSize={11}
			isEditable={isEditable && setProductionRate !== undefined}
			textAlign={"center"}
			value={floatToString(productionRate, 4)}
			onChange={setProductionRate !== undefined ? (value) => {
				const parsedValue = Number(value);
				if (!isNaN(parsedValue)) {
					setProductionRate(parsedValue);
				}
			} : undefined}
		/>
	{/if}
	{#if setProductionRate && suggestedThroughput !== 0}
			<foreignObject
				x={suggestionAbsOffset}
				y={-outerRadius/2}
			>
				<div
					class="rate-suggestion"
					style="--throughput-color: {throughputColor}; transform: translate({suggestionRelOffset}, -100%);"
					onmousedown={(e) => {
						e.stopPropagation();
						setProductionRate(suggestedThroughput);
					}}
					ontouchstart={(e) => {
						e.stopPropagation();
						setProductionRate(suggestedThroughput);
					}}
				>
					{floatToString(suggestedThroughput, 3)}
				</div>
			</foreignObject>
	{/if}
	{#if globals.debugShowNodeIds}
		<text
			x="0"
			y="-10"
			text-anchor="middle"
			style="pointer-events: none; font-size: 11px; font-family: monospace;"
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

		&.locked :global(:not(:where(text, foreignObject, foreignObject *))) {
			cursor: cell;
		}
		
		&.selectable:hover:not(:where(.selected, .highlight-hovered)) {
			circle {
				stroke: var(--node-border-hover-color);
			}
		}
	
		&:where(.highlight-attachable) {
			circle {
				stroke: var(--node-border-highlight-color);
			}
		}
	
		&:where(.selected, .highlight-hovered) {
			circle {
				stroke: var(--node-border-selected-color);
			}
		}
	}


	.rate-suggestion {
		cursor: pointer;
		width: max-content;
		background: var(--throughput-color);
		color: var(--edge-background-color-text);
		font-size: 9px;
		font-weight: bold;
		padding: 2px 4px;
		height: 13px;
		line-height: 9px;
		border-radius: 5px;

		&:hover {
			filter: brightness(1.1);
		}
	}
</style>
