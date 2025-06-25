<script lang="ts">
	import type { GraphNode, GraphNodeRecipeProperties, GraphNodeResourceJointProperties, GraphPage } from "$lib/components/datamodel/datamodel.svelte";
    import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
    import type { SFRecipePart } from "$lib/satisfactoryDatabaseTypes";
    import { getContext } from "svelte";
    import SfIconView from "../SFIconView.svelte";
    import { isNodeSelectable } from "./nodeTypeProperties.svelte";

	interface Props {
		node: GraphNode<GraphNodeResourceJointProperties>;
	}
	const {
		node,
	}: Props = $props();

	const page = getContext("graph-page") as GraphPage;
	
	const isSelected = $derived(page.selectedNodes.has(node.id));
	const isSelectable = $derived(isNodeSelectable(node));

	const resource = $derived(satisfactoryDatabase.parts[node.properties.resourceClassName]);

	const outerRadius = 16;
	const innerRadius = outerRadius - 3;
</script>

<g
	class="resource-joint-node-view"
	class:selectable={isSelectable}
	class:selected={isSelected}
>
	<circle
		r={outerRadius}
		fill="var(--background-300)"
		stroke="var(--background-400)"
		stroke-width="1"
	/>
	<SfIconView
		icon={resource.icon}
		x={-innerRadius}
		y={-innerRadius}
		size={innerRadius * 2}
	/>
</g>

<style lang="scss">
	.resource-joint-node-view {
		circle {
			stroke: var(--background-400);
			transition: stroke 0.1s ease-in-out;
		}
	}

	:global(.resource-joint-node-view.selectable:hover:not(.selected)) {
		circle {
			stroke: var(--background-500);
		}
	}

	:global(.resource-joint-node-view.selected) {
		circle {
			stroke: var(--accent);
		}
	}
</style>
