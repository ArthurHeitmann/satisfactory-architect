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

	const midPoint = $derived.by(() => {
		if (!edge.pathPoints)
			return null;
		return {
			x: (edge.pathPoints.startPoint.x + edge.pathPoints.endPointWithoutArrow.x) / 2,
			y: (edge.pathPoints.startPoint.y + edge.pathPoints.endPointWithoutArrow.y) / 2,
		};
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
		{#if midPoint && edge.pushThroughput !== 0 && edge.pullThroughput !== 0}
			<text
				x={midPoint.x}
				y={midPoint.y}
				text-anchor="middle"
				class="edge-throughput-text"
			>
				<!-- {edge.pushThroughput} - {edge.pullThroughput} = {edge.netThroughput} -->
				<!-- {edge.pushThroughput} - {edge.pullThroughput} -> {edge.minThroughput} -->
				{edge.minThroughput} ({(edge.relativeThroughput * 100).toFixed(0)}%)
			</text>
		{/if}
		{#if globals.debugShowEdgeIds && midPoint}
			<text
				x={midPoint.x}
				y={midPoint.y + 13}
				text-anchor="middle"
				class="edge-id-text"
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

	.edge-throughput-text, .edge-id-text {
		font-size: 10px;
	}
</style>
