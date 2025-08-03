<script lang="ts">
	import { getContext } from "svelte";
	import { blockStateChanges, globals, unblockStateChanges } from "../../datamodel/globals.svelte";
	import type { GraphEdge } from "../../datamodel/GraphEdge.svelte";
	import type { GraphPage } from "../../datamodel/GraphPage.svelte";
    import type { ContextMenuItem, EventStream } from "$lib/EventStream.svelte";
    import { assertUnreachable, bezierPoint, floatToString, isThroughputBalanced } from "$lib/utilties";
    import { updateEdgeOffsets } from "../../datamodel/straightEdgeRouting";
    import type { IVector2D } from "../../datamodel/GraphView.svelte";
    import { userCanChangeOrientationVector } from "../../datamodel/nodeTypeProperties.svelte";
    import UserEvents, { type DragEvent } from "../UserEvents.svelte";
    import type { LayoutOrientation } from "../../datamodel/GraphNode.svelte";

	interface Props {
		edge: GraphEdge;
	}
	const { edge }: Props = $props();
	
	let isRotating = $state(false);

	const eventStream = getContext("event-stream") as EventStream;
	const page = getContext("graph-page") as GraphPage;
	
	const isSelected = $derived(page.selectedEdges.has(edge.id));
	
	function onClick(event: MouseEvent) {
		event.stopPropagation();
		if (event.shiftKey) {
			page.toggleEdgeSelection(edge);
		} else {
			page.clearAllSelection();
			page.selectEdge(edge);
		}
	}

	const {pathD, midPoint} = $derived.by(() => {
		const fallback = {pathD: "", midPoint: null};
		if (!edge.pathPoints)
			return fallback;
		
		const startX = edge.pathPoints.startPoint.x;
		const startY = edge.pathPoints.startPoint.y;
		const endX = edge.pathPoints.endPointWithoutArrow.x;
		const endY = edge.pathPoints.endPointWithoutArrow.y;
		if (edge.properties.displayType === "straight") {
			const midPoint = {
				x: (startX + endX) / 2,
				y: (startY + endY) / 2,
			};
			return {pathD: `M ${startX} ${startY} L ${endX} ${endY}`, midPoint};
		} else if (edge.properties.displayType === "curved") {
			let ctrl1 = edge.pathPoints.startControlPointVector;
			let ctrl2 = edge.pathPoints.endControlPointVector;
			ctrl1 = {
				x: startX + ctrl1.x,
				y: startY + ctrl1.y,
			};
			ctrl2 = {
				x: endX + ctrl2.x,
				y: endY + ctrl2.y,
			};
			const start = { x: startX, y: startY };
			const end = { x: endX, y: endY };
			const midPoint = bezierPoint(start, end, ctrl1, ctrl2, 0.5);
			return {
				pathD: `M ${startX} ${startY} C ${ctrl1.x} ${ctrl1.y}, ${ctrl2.x} ${ctrl2.y}, ${endX} ${endY}`,
				midPoint,
			};
		} else if (edge.properties.displayType === "angled") {
			const points = edge.straightEdgePoints;
			if (!points)
				return fallback;
			let pathD = `M ${startX} ${startY}`;
			for (const point of points) {
				pathD += ` L ${point.x} ${point.y}`;
			}
			pathD += ` L ${endX} ${endY}`;
			let midPoint: IVector2D;
			if (points.length >= 3 && points.length % 2 === 1) {
				const mid = points.length / 2;
				const p1 = points[Math.floor(mid)];
				const p2 = points[Math.ceil(mid)];
				midPoint = {
					x: (p1.x + p2.x) / 2,
					y: (p1.y + p2.y) / 2,
				};
			} else {
				const allPoints = [
					edge.pathPoints.startPoint,
					...points,
					edge.pathPoints.endPoint,
				];
				let maxP1P2 = [allPoints[0], allPoints[1]]
				let maxDist = Math.abs(allPoints[0].x - allPoints[1].x) + Math.abs(allPoints[0].y - allPoints[1].y);
				for (let i = 1; i < allPoints.length - 1; i++) {
					const p1 = allPoints[i];
					const p2 = allPoints[i + 1];
					const dist = Math.abs(p1.x - p2.x) + Math.abs(p1.y - p2.y);
					if (dist > maxDist) {
						maxDist = dist;
						maxP1P2 = [p1, p2];
					}
				}
				midPoint = {
					x: (maxP1P2[0].x + maxP1P2[1].x) / 2,
					y: (maxP1P2[0].y + maxP1P2[1].y) / 2,
				};
			}
			return {pathD, midPoint};
		} else {
			assertUnreachable(edge.properties.displayType);
		}
		return fallback;
	});
	$effect(() => {
		if (edge.properties.displayType === "angled" && edge.straightEdgeCount !== null) {
			updateEdgeOffsets(edge.properties, edge.straightEdgeCount);
		}
	});

	const {canRotateStart, startButtonPosition, canRotateEnd, endButtonPosition} = $derived.by(() => {
		if (!edge.orientationVectors || !edge.startNode || !edge.endNode) {
			return { canRotateStart: false, startButtonPosition: {x: 0, y: 0}, canRotateEnd: false, endButtonPosition: {x: 0, y: 0} };
		}
		const canRotateStart = userCanChangeOrientationVector(edge.startNode, edge);
		const canRotateEnd = userCanChangeOrientationVector(edge.endNode, edge);
		const offset = 9;
		const startButtonPosition: IVector2D = {
			x: edge.startNodePosition!.x + edge.orientationVectors!.startOffset.x * (edge.startNodeRadius + offset),
			y: edge.startNodePosition!.y + edge.orientationVectors!.startOffset.y * (edge.startNodeRadius + offset),
		}
		const endButtonPosition: IVector2D = {
			x: edge.endNodePosition!.x + edge.orientationVectors!.endOffset.x * (edge.endNodeRadius + offset),
			y: edge.endNodePosition!.y + edge.orientationVectors!.endOffset.y * (edge.endNodeRadius + offset),
		}
		return {canRotateStart, startButtonPosition, canRotateEnd, endButtonPosition};
	});
	const isBalanced = $derived(edge.properties.isDrainLine || isThroughputBalanced(edge.pushThroughput, edge.pullThroughput));
	const color = $derived.by(() => {
		if (isSelected) {
			return "var(--edge-selected-stroke-color)";
		} else if (isBalanced) {
			return "var(--edge-stroke-color)";
		} else {
			const mixPercent = (edge.pushThroughput - edge.pullThroughput) / Math.max(edge.pushThroughput, edge.pullThroughput);
			const minPercent = 0.2;
			const mixPercentAbs = Math.min(1.0, Math.abs(mixPercent) + minPercent);
			if (mixPercent < 0) {
				return `color-mix(in srgb, var(--underflow-color) ${mixPercentAbs * 100}%, var(--edge-stroke-color))`;
			} else if (mixPercent > 0) {
				return `color-mix(in srgb, var(--overflow-color) ${mixPercentAbs * 100}%, var(--edge-stroke-color))`;
			} else {
				return "var(--edge-stroke-color)";
			}
		}
	});

	const contextMenuItems = $derived.by(() => {
		const items: ContextMenuItem[] = [];
		items.push({
			label: "Delete Connection",
			onClick: () => page.removeEdge(edge.id),
		});
		items.push({
			label: edge.properties.isDrainLine ? "Make normal line" : "Make drain line",
			onClick: () => edge.properties.isDrainLine = !edge.properties.isDrainLine,
		});
		items.push({
			label: "Make straight",
			onClick: () => edge.properties.displayType = "straight",
		});
		items.push({
			label: "Make curved",
			onClick: () => edge.properties.displayType = "curved",
		});
		items.push({
			label: "Make angled",
			onClick: () => edge.properties.displayType = "angled",
		});
		return items;
	});

	let startOrientation: LayoutOrientation|undefined;
	function onOrientationRotateStart(type: "start"|"end") {
		isRotating = true;
		blockStateChanges();
		startOrientation = type === "start" ? edge.properties.startOrientation : edge.properties.endOrientation;
	}
	
	function onOrientationRotateEnd(type: "start"|"end") {
		isRotating = false;
		unblockStateChanges();
		const endOrientation = type === "start" ? edge.properties.startOrientation : edge.properties.endOrientation;
		if (startOrientation !== endOrientation) {
			page.history.onDataChange();
		}
	}

	function onOrientationRotate(e: DragEvent, type: "start"|"end") {
		const cursorPos = page.screenToPageCoords({x: e.cursorEvent.clientX, y: e.cursorEvent.clientY});
		const nodeCenter = type === "start" ? edge.startNodePosition : edge.endNodePosition;
		const delta = {
			x: cursorPos.x - nodeCenter!.x,
			y: cursorPos.y - nodeCenter!.y,
		};
		const angle = Math.atan2(delta.y, delta.x) / Math.PI * 180;
		let newOrientation: LayoutOrientation;
		if (angle >= -45 && angle < 45)
			newOrientation = "right";
		else if (angle >= 45 && angle < 135)
			newOrientation = "bottom";
		else if (angle >= 135 || angle < -135)
			newOrientation = "left";
		else
			newOrientation = "top";
			

		if (type === "start") {
			edge.properties.startOrientation = newOrientation;
		} else if (type === "end") {
			edge.properties.endOrientation = newOrientation;
		} else {
			assertUnreachable(type);
		}
	}
</script>

{#if pathD}	<g
		class="edge-view"
		class:isRotating
		class:selected={isSelected}
		oncontextmenu={(event) => {
			event.preventDefault();
			eventStream.emit({
				type: "showContextMenu",
				x: event.clientX,
				y: event.clientY,
				items: contextMenuItems,
			});		}}
		onclick={onClick}
	>
		<path
			class="edge-view-hover-area"
			d={pathD}
		/>
		<path
			class="edge-view-path"
			d={pathD}
			marker-end="url(#arrow)"
			style="--edge-color: {color};"
			stroke-dasharray={edge.properties.isDrainLine ? "5, 10" : "0"}
			stroke-linecap="round"
		/>
		{#each [[canRotateStart, startButtonPosition, "start"], [canRotateEnd, endButtonPosition, "end"]] as const as [canRotate, buttonPosition, type]}
			{#if canRotate}
				<UserEvents
					onDragStart={() => onOrientationRotateStart(type)}
					onDragEnd={() => onOrientationRotateEnd(type)}
					onDrag={e => onOrientationRotate(e, type)}
					id="edge {edge.id} drag start"
				>
					{#snippet children({ listeners })}
						<circle
							{...listeners}
							class="drag-button"
							cx={buttonPosition.x}
							cy={buttonPosition.y}
							r={7}
						/>
					{/snippet}
				</UserEvents>
			{/if}
		{/each}
		{#if midPoint && (edge.pushThroughput !== 0 || edge.pullThroughput !== 0)}
			<text
				x={midPoint.x}
				y={midPoint.y}
				text-anchor="middle"
				dominant-baseline="middle"
				class="edge-throughput-text"
			>
				{#if isBalanced}
					{floatToString(edge.pushThroughput)}
				{:else}
					{floatToString(edge.pushThroughput)} / {floatToString(edge.pullThroughput)}
				{/if}
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
	
	.edge-view-path {
		cursor: pointer;
		transition: stroke 0.1s ease-in-out;
		stroke: var(--edge-color);
		stroke-width: 2;
	}
	
	.edge-view:hover .edge-view-path {
		stroke: var(--edge-hover-stroke-color);
	}

	.edge-view.selected .edge-view-path {
		stroke-width: 3;
	}
	
	.edge-throughput-text, .edge-id-text {
		font-size: 10px;
	}

	.edge-view:not(:where(:hover, .isRotating)) .drag-button {
		display: none;
	}

	.drag-button {
		fill: red;
		cursor: move;
	}
</style>
