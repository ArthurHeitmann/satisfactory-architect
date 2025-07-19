<script lang="ts">
	import { getContext } from "svelte";
	import { globals } from "../datamodel/globals.svelte";
	import type { GraphEdge } from "../datamodel/GraphEdge.svelte";
	import type { GraphPage } from "../datamodel/GraphPage.svelte";
    import type { EventStream } from "$lib/EventStream.svelte";

	interface Props {
		edge: GraphEdge;
	}
	const { edge }: Props = $props();
	
	let hovered = $state(false);

	const eventStream = getContext("event-stream") as EventStream;
	const page = getContext("graph-page") as GraphPage;
	const pathD = $derived.by(() => {
		if (!edge.pathPoints)
			return "";
		
		const startX = edge.pathPoints!.startPoint.x;
		const startY = edge.pathPoints!.startPoint.y;
		const endX = edge.pathPoints!.endPointWithoutArrow.x;
		const endY = edge.pathPoints!.endPointWithoutArrow.y;
		if (edge.properties.displayType === "straight") {
			return `M ${startX} ${startY} L ${endX} ${endY}`;
		} else if (edge.properties.displayType === "curved") {
			const ctrl1 = edge.pathPoints?.startControlPointVector;
			const ctrl2 = edge.pathPoints?.endControlPointVector;
			if (!ctrl1 || !ctrl2)
				return "";
			return `M ${startX} ${startY} C ${startX + ctrl1.x} ${startY + ctrl1.y}, ${endX + ctrl2.x} ${endY + ctrl2.y}, ${endX} ${endY}`;
		}
		return "";
	});

</script>

{#if pathD}
	<g
		onmouseover={() => hovered = true}
		onmouseout={() => hovered = false}
		oncontextmenu={(event) => {
			event.preventDefault();
			eventStream.emit({
				type: "showContextMenu",
				x: event.clientX,
				y: event.clientY,
				items: [
					{
						label: "Delete Connection",
						onClick: () => page.removeEdge(edge.id),
					},
				],
			});
		}}
	>
		<path
			class="edge-view-hover-area"
			d={pathD}
		/>
		<path
			class="edge-view"
			class:hovered={hovered}
			d={pathD}
			marker-end="url(#arrow)"
		/>
		{#if globals.debugShowEdgeIds}
			<text
				x={(edge.startNodePosition!.x + edge.endNodePosition!.x) / 2}
				y={(edge.startNodePosition!.y + edge.endNodePosition!.y) / 2}
				text-anchor="middle"
				font-size="10px"
				font-family="monospace"
				style="pointer-events: none;"
			>
				e {edge.id}
			</text>
		{/if}
	</g>
{/if}
		
<style lang="scss">
	path {
		fill: none;
	}

	.edge-view-hover-area {
		stroke: transparent;
		stroke-width: 10;
		cursor: pointer;
	}
	
	.edge-view {
		cursor: pointer;
		transition: stroke 0.1s ease-in-out;
		stroke: var(--edge-stroke-color);
		stroke-width: 2;

		&.hovered {
			stroke: var(--edge-hover-stroke-color);
		}
	}
</style>
