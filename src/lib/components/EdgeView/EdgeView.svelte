<script lang="ts">
	import { getContext, onDestroy } from "svelte";
	import { blockStateChanges, globals, unblockStateChanges } from "../../datamodel/globals.svelte";
	import type { GraphEdge, GraphEdgeDisplayType } from "../../datamodel/GraphEdge.svelte";
	import type { GraphPage } from "../../datamodel/GraphPage.svelte";
    import type { ContextMenuIconButton, ContextMenuItem, ContextMenuItemButtonRow, EventStream } from "$lib/EventStream.svelte";
    import { assertUnreachable, bezierPoint, floatToString, getThroughputColor, isThroughputBalanced, pluralStr, roundToNearest } from "$lib/utilties";
    import { updateEdgeOffsets } from "../../datamodel/straightEdgeRouting";
    import type { IVector2D } from "../../datamodel/GraphView.svelte";
    import { userCanChangeOrientationVector } from "../../datamodel/nodeTypeProperties.svelte";
    import UserEvents, { type DragEvent } from "../UserEvents.svelte";
    import type { LayoutOrientation } from "../../datamodel/GraphNode.svelte";
    import { edgeArrowLength, gridSize } from "$lib/datamodel/constants";

	interface Props {
		edge: GraphEdge;
	}
	const { edge }: Props = $props();
	
	let isRotating = $state(false);

	const eventStream = getContext("event-stream") as EventStream;
	const page = $derived(edge.context.page);
	
	const isSelected = $derived(page.selectedEdges.has(edge.id));
	
	function onClick(event: MouseEvent) {
		event.stopPropagation();
		if (event.shiftKey) {
			page.toggleEdgeSelection(edge);
		} else {
			page.selectEdge(edge);
		}
	}

	const {pathD, midPoint, arrowHeadPlaceholderPos} = $derived.by(() => {
		const fallback = {pathD: "", midPoint: null, arrowHeadPlaceholderPos: null};
		if (!edge.pathPoints)
			return fallback;
		
		const startX = edge.pathPoints.startPoint.x;
		const startY = edge.pathPoints.startPoint.y;
		const endX = edge.pathPoints.endPointWithoutArrow.x;
		const endY = edge.pathPoints.endPointWithoutArrow.y;
		const arrowHeadPlaceholderPos = {
			x: (edge.pathPoints.endPoint.x + endX) / 2,
			y: (edge.pathPoints.endPoint.y + endY) / 2,
		};
		if (edge.properties.displayType === "straight") {
			const midPoint = {
				x: (startX + endX) / 2,
				y: (startY + endY) / 2,
			};
			return {pathD: `M ${startX} ${startY} L ${endX} ${endY}`, midPoint, arrowHeadPlaceholderPos};
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
				arrowHeadPlaceholderPos,
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
			return {pathD, midPoint, arrowHeadPlaceholderPos};
		} else if (edge.properties.displayType === "teleport") {
			if (!edge.pathPoints || !edge.orientationVectors)
				return fallback;
			const startPoint = edge.pathPoints.startPoint;
			const endPoint = edge.pathPoints.endPointWithoutArrow;
			const startVec = edge.orientationVectors.startOffset;
			const endVec = edge.orientationVectors.endOffset;
			const lineLength = gridSize / 2;
			const miniRadius = 2.5;
			const startPointEnd = {
				x: startPoint.x + startVec.x * (lineLength - miniRadius*1),
				y: startPoint.y + startVec.y * (lineLength - miniRadius*1),
			};
			const endPointCircleStart = {
				x: endPoint.x + endVec.x * (lineLength - edgeArrowLength + miniRadius * 1),
				y: endPoint.y + endVec.y * (lineLength - edgeArrowLength + miniRadius * 1),
			};
			const endPointStart = {
				x: endPoint.x + endVec.x * (lineLength - edgeArrowLength - miniRadius * 1),
				y: endPoint.y + endVec.y * (lineLength - edgeArrowLength - miniRadius * 1),
			};
			const relCircle1 = `a ${miniRadius},${miniRadius} 0 1,0 ${startVec.x * miniRadius * 2},${startVec.y * miniRadius * 2} a ${miniRadius},${miniRadius} 0 1,0 ${startVec.x * miniRadius * -2},${startVec.y * miniRadius * -2}`;
			const relCircle2 = `M ${endPointCircleStart.x} ${endPointCircleStart.y} a ${miniRadius},${miniRadius} 0 1,0 ${endVec.x * miniRadius * -2},${endVec.y * miniRadius * -2} a ${miniRadius},${miniRadius} 0 1,0 ${endVec.x * miniRadius * 2},${endVec.y * miniRadius * 2}`;
			const pathD =
				`M ${startPoint.x} ${startPoint.y} L ${startPointEnd.x} ${startPointEnd.y} ${relCircle1}` +
				`${relCircle2} M ${endPointStart.x} ${endPointStart.y} L ${endPoint.x} ${endPoint.y}`;
			return {
				pathD,
				midPoint: null,
				arrowHeadPlaceholderPos: {
					x: (startPointEnd.x + endPointStart.x) / 2,
					y: (startPointEnd.y + endPointStart.y) / 2,
				},
			};
		} else {
			assertUnreachable(edge.properties.displayType);
		}
	});
	$effect(() => {
		if (edge.properties.displayType === "angled" && edge.straightEdgeCount !== null) {
			updateEdgeOffsets(edge.properties, edge.straightEdgeCount);
		}
	});
	const draggableEdges = $derived.by(() => {
		if (edge.properties.displayType !== "angled") {
			return [];
		}
		if (!edge.straightEdgePoints) {
			return [];
		}
		if (!edge.properties.straightLineOffsets || edge.properties.straightLineOffsets.length + 1 !== edge.straightEdgePoints.length) {
			return [];
		}

		const edges: {index: number, pathD: string, type: "vertical"|"horizontal"}[] = [];
		for (let i = 0; i < edge.properties.straightLineOffsets.length; i++) {
			const p1 = edge.straightEdgePoints[i + 0];
			const p2 = edge.straightEdgePoints[i + 1];
			const pathD = `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
			const type = p1.x === p2.x ? "vertical" : "horizontal";
			edges.push({index: i, pathD, type});
		}

		return edges;
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
	const color = $derived(getThroughputColor(isBalanced, edge.pushThroughput, edge.pullThroughput));

	const contextMenuItems = $derived.by(() => {
		const items: ContextMenuItem[] = [];
		// items.push({
		// 	label: "Delete Connection",
		// 	onClick: () => page.removeEdge(edge.id),
		// });
		if (isSelected && (page.selectedEdges.size > 1 || !page.selectedEdges.has(edge.id))) {
			const selectedCount = page.selectedEdges.size;
			items.push({
				label: `Delete ${pluralStr("Edge", selectedCount)}`,
				icon: "delete",
				hint: "Del",
				onClick: () => page.removeSelectedEdges(),
			});
		} else {
			items.push({
				label: "Delete Edge",
				icon: "delete",
				hint: "Del",
				onClick: () => page.removeEdge(edge.id),
			});
		}
		items.push({
			label: edge.properties.isDrainLine ? "Normal Line" : "Overflow Only",
			icon: "branch",
			onClick: () => edge.properties.isDrainLine = !edge.properties.isDrainLine,
		});
		items.push(<ContextMenuItemButtonRow<GraphEdgeDisplayType>>{
			onClick: (v) => edge.properties.displayType = v,
			currentValue: edge.properties.displayType,
			items: [
				{
					icon: "straight-line",
					value: "straight",
				},
				{
					icon: "curved-line",
					value: "curved",
				},
				{
					icon: "angled-line",
					value: "angled",
				},
				{
					icon: "teleport-line",
					value: "teleport",
				},
			]
		})
		return items;
	});

	let startOrientation: LayoutOrientation|null = null;
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

	let edgeDragStartValue: number|undefined;
	function onEdgeDrag(e: DragEvent, type: "horizontal"|"vertical", index: number) {
		const delta = type === "horizontal" ? e.totalDeltaY : e.totalDeltaX;
		const scale = page.view.scale;
		let newValue = (edgeDragStartValue ?? 0) + delta / scale;
		// if (page.view.enableGridSnap) {
		// 	newValue = roundToNearest(newValue, page.view.gridSnap);
		// }
		edge.properties.straightLineOffsets![index] = newValue;
	}

	onDestroy(() => {
		if (isRotating) {
			unblockStateChanges();
		}
	});
</script>

<g
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
	style="--edge-color: {color};"
>
	{#if pathD}
		<path
			class="edge-view-hover-area"
			d={pathD}
		/>
		<path
			class="edge-view-path"
			d={pathD}
			marker-end={isSelected ? "url(#arrow-wide)" : "url(#arrow)"}
			stroke-dasharray={edge.properties.isDrainLine ? "1, 5" : "0"}
			stroke-linecap="round"
		/>
	{/if}
	{#if arrowHeadPlaceholderPos}
		<circle
			cx={arrowHeadPlaceholderPos.x}
			cy={arrowHeadPlaceholderPos.y}
			r={edgeArrowLength * 2/3}
			fill="transparent"
		/>
	{/if}
	{#each draggableEdges as draggableEdge}
		<UserEvents
			onDragStart={() => edgeDragStartValue = edge.properties.straightLineOffsets?.[draggableEdge.index]}
			onDrag={e => onEdgeDrag(e, draggableEdge.type, draggableEdge.index)}
		>
			{#snippet children({ listeners })}
				<path
					{...listeners}
					d={draggableEdge.pathD}
					stroke-width=10
					stroke="transparent"
					style="cursor: {draggableEdge.type === "horizontal" ? "row-resize" : "col-resize"}"
				/>
			{/snippet}
		</UserEvents>
	{/each}
	{#each [[canRotateStart, startButtonPosition, "start"], [canRotateEnd, endButtonPosition, "end"]] as const as [canRotate, buttonPosition, type]}
		{#if canRotate}
			<UserEvents
				onDragStart={() => onOrientationRotateStart(type)}
				onDragEnd={() => onOrientationRotateEnd(type)}
				onDrag={e => onOrientationRotate(e, type)}
				id="edge {edge.id} drag start"
			>
				{#snippet children({ listeners })}
					<g {...listeners} class="drag-button">
						<circle
							{...listeners}
							class="drag-button-outer"
							cx={buttonPosition.x}
							cy={buttonPosition.y}
						/>
						<circle
							{...listeners}
							class="drag-button-inner"
							cx={buttonPosition.x}
							cy={buttonPosition.y}
						/>
					</g>
				{/snippet}
			</UserEvents>
		{/if}
	{/each}
	{#if midPoint && (edge.pushThroughput !== 0 || edge.pullThroughput !== 0)}
		<foreignObject
			x={midPoint.x}
			y={midPoint.y}
		>
			<div class="edge-throughput-text">
				{#if isBalanced}
					{floatToString(edge.pushThroughput)}
				{:else}
					{floatToString(edge.pushThroughput)} / {floatToString(edge.pullThroughput)}
				{/if}
			</div>
		</foreignObject>
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

<style lang="scss">
	path {
		fill: none;
	}

	.edge-view-hover-area {
		stroke: transparent;
		stroke-width: 10;
	}
	
	.edge-view-path {
		transition: stroke 0.1s ease-in-out;
		stroke: var(--edge-color);
		stroke-width: 2;
	}

	.drag-button {
		cursor: move;
		color: var(--edge-drag-handle-color);
		opacity: 0;
		transition: opacity 0.1s ease-in-out;

		&:hover {
			opacity: 1 !important;
		}
	}

	.drag-button-outer {
		fill: transparent;
		stroke: currentColor;
		stroke-width: 1;
		r: 5;
	}

	.drag-button-inner {
		r: 2;
		fill: currentColor;
	}
	
	.edge-view {
		cursor: pointer;

		&:hover {
			.drag-button {
				opacity: 0.5;
			}
		}

		&.isRotating {
			.drag-button {
				opacity: 1 !important;
			}
		}

		&:where(:hover, .isRotating) {
			.edge-view-path {
				filter: brightness(var(--edge-hover-brightness));
			}
		}

		&.selected {
			.edge-view-path {
				filter: brightness(var(--edge-selected-brightness));
				stroke-width: 4;
			}
		}
	}

	.edge-id-text {
		font-size: 10px;
	}

	.edge-throughput-text {
		width: max-content;
		transform: translateX(-50%) translateY(-50%);
		background: var(--edge-color);
		color: var(--edge-background-color-text);
		font-size: 9px;
		font-weight: bold;
		padding: 2px 4px;
		height: 13px;
		line-height: 9px;
		border-radius: 5px;
	}
</style>
