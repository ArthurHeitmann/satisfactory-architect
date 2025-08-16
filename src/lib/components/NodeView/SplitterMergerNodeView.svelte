<script lang="ts">
	import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
	import SfIconView from "../SFIconView.svelte";
	import { assertUnreachable } from "$lib/utilties";
	import { globals } from "../../datamodel/globals.svelte";
	import { getNodeRadius, isNodeSelectable } from "../../datamodel/nodeTypeProperties.svelte";
	import type { GraphNode, GraphNodeSplitterMergerProperties } from "../../datamodel/GraphNode.svelte";
	import type { IVector2D } from "../../datamodel/GraphView.svelte";

	interface Props {
		node: GraphNode<GraphNodeSplitterMergerProperties>;
	}
	const {
		node,
	}: Props = $props();

	const page = $derived(node.context.page);

	const isSelected = $derived(page.selectedNodes.has(node.id));
	const isSelectable = $derived(isNodeSelectable(node));
	const highlightAttachable = $derived(page.highlightedNodes.attachable.has(node.id));
	const highlightHovered = $derived(page.highlightedNodes.hovered.has(node.id));

	const partIcon = satisfactoryDatabase.parts[node.properties.resourceClassName]?.icon;
	const outerRadius = getNodeRadius(node);
	const innerRadius = outerRadius - 4;
	const connectionsPath = $derived.by(() => {
		const nodePos = node.position;
		type OutsidePoint = {point: IVector2D, type: "in" | "out"};
		const outsidePoints: OutsidePoint[] = [];
		for (const edgeId of node.edges.values()) {
			const edge = page.edges.get(edgeId);
			if (!edge) {
				continue;
			}
			let point: OutsidePoint | undefined;
			if (edge.startNodeId === node.id) {
				const startPoint = edge.pathPoints?.startPoint;
				if (startPoint) {
					point = { point: startPoint, type: "out" };
				}
			} else if (edge.endNodeId === node.id) {
				const endPoint = edge.pathPoints?.endPoint;
				if (endPoint) {
					point = { point: endPoint, type: "in" };
				}
			}
			if (point) {
				point.point = {
					x: point.point.x - nodePos.x,
					y: point.point.y - nodePos.y,
				};
				outsidePoints.push(point);
			}
		}
		const inCount = outsidePoints.filter(p => p.type === "in").length;
		const outCount = outsidePoints.filter(p => p.type === "out").length;
		let mergePointType: "in" | "out";
		if (inCount === 1 && outCount > 0) {
			mergePointType = "in";
		} else if (outCount === 1 && inCount > 0) {
			mergePointType = "out";
		} else {
			return "";
		}
		const mergePoint = outsidePoints.find(p => p.type === mergePointType)!.point;
	
		let path = "";
		for (const point of outsidePoints) {
			if (point.point.x === mergePoint.x && point.point.y === mergePoint.y) {
				continue;
			}
			let startPoint: IVector2D;
			let endPoint: IVector2D;
			if (point.type === "in") {
				startPoint = { x: point.point.x, y: point.point.y };
				endPoint = { x: mergePoint.x, y: mergePoint.y };
			} else if (point.type === "out") {
				startPoint = { x: mergePoint.x, y: mergePoint.y };
				endPoint = { x: point.point.x, y: point.point.y };
			} else {
				assertUnreachable(point.type);
			}

			path += `M ${startPoint.x} ${startPoint.y} `;
			path += `Q 0 0, ${endPoint.x} ${endPoint.y} `;
		}
		return path;
	});

	const displayName = node.properties.type === "splitter" ? "Splitter" : "Merger";
</script>

<g
	class="splitter-merger"
	class:selectable={isSelectable}
	class:selected={isSelected}
	class:highlight-attachable={highlightAttachable}
	class:highlight-hovered={highlightHovered}
	data-tooltip={displayName}
>
	<circle r={outerRadius} />
	<path
		class="connections"
		d={connectionsPath}
	/>
	<SfIconView
		icon={partIcon}
		x={-innerRadius}
		y={-innerRadius}
		size={innerRadius * 2}
	/>
	{#if globals.debugShowNodeIds}
		<text
			x="0"
			y="-15"
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
	.splitter-merger { 
		circle {
			fill: var(--node-background-color);
			stroke: var(--node-border-color);
			stroke-width: 2px;
			transition: stroke 0.1s ease-in-out;
		}

		.connections {
			fill: none;
			stroke: var(--edge-stroke-color);
			stroke-width: 2;
			transition: stroke 0.1s ease-in-out;
		}
	}

	.splitter-merger.selectable:hover:not(:where(.selected, .highlight-hovered)) {
		circle {
			stroke: var(--node-border-hover-color);
		}
	}

	.splitter-merger:where(.highlight-attachable) {
		circle, .connections {
			stroke: var(--node-border-highlight-color);
		}
	}

	.splitter-merger:where(.selected, .highlight-hovered) {
		circle, .connections {
			stroke: var(--node-border-selected-color);
		}
	}
</style>
