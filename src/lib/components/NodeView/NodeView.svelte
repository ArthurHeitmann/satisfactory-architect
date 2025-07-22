<script lang="ts">
	import { getContext, onMount } from "svelte";
	import RecipeNodeView from "./ProductionNodeView.svelte";
	import UserEvents, { type CursorEvent, type DragEvent } from "../UserEvents.svelte";
	import { isNodeSelectable, isNodeDraggable, isNodeDeletable, getNodeRadius, isResourceNodeSplittable } from "../datamodel/nodeTypeProperties.svelte";
	import ResourceJointNodeView from "./ResourceJointNodeView.svelte";
	import type { ContextMenuItem, EventStream, ShowContextMenuEvent, ShowProductionSelectorEvent } from "$lib/EventStream.svelte";
	import { assertUnreachable, pluralStr } from "$lib/utilties";
	import { gridSize } from "../datamodel/constants";
	import type { Id } from "../datamodel/IdGen";
	import ProductionNodeView from "./ProductionNodeView.svelte";
	import SplitterMergerNodeView from "./SplitterMergerNodeView.svelte";
	import type { GraphNode, GraphNodeProductionProperties, GraphNodeResourceJointProperties, GraphNodeSplitterMergerProperties, JointDragType } from "../datamodel/GraphNode.svelte";
	import type { GraphPage } from "../datamodel/GraphPage.svelte";
	import type { IVector2D } from "../datamodel/GraphView.svelte";

	interface Props {
		node: GraphNode;
	}
	const { node }: Props = $props();

	const page = getContext("graph-page") as GraphPage;
	const eventStream = getContext("event-stream") as EventStream;
	
	const isSelectable = isNodeSelectable(node);
	const isDraggable = isNodeDraggable(node);
	const isSelected = $derived(page.selectedNodes.has(node.id));
	const isDeletable = isNodeDeletable(node);
	const isResourceSplittable = isResourceNodeSplittable(node);
	
	const position = $derived(node.getAbsolutePosition(page));
	
	const isMovingResourceJoint = node.properties.type === "resource-joint" && node.properties.jointDragType !== undefined;
	const jointDragType = isMovingResourceJoint ? node.properties.jointDragType! : null;
	// svelte-ignore state_referenced_locally
	let dragStartPoint = $state(isMovingResourceJoint ? position : null);
	let newNodeDragHasFinished = $state(false);

	const contextMenuItems = $derived.by(() => {
		const items: ContextMenuItem[] = [];
		if (isDeletable) {
			if (isSelected && (page.selectedNodes.size > 1 || !page.selectedNodes.has(node.id))) {
				const selectedCount = page.selectedNodes.size;
				items.push({
					label: `Delete ${pluralStr("node", selectedCount)}`,
					hint: "Del",
					onClick: () => page.removeSelectedNodes(),
				});
			}
			items.push({
				label: "Delete Node",
				hint: "Del",
				onClick: () => page.removeNode(node.id),
			});
		}
		let supportsNewIncomingConnection = false;
		let supportsNewOutgoingConnection = false;
		if (node.properties.type === "resource-joint" && node.properties.locked) {
			if (node.properties.jointType === "output") {
				supportsNewOutgoingConnection = true;
			} else if (node.properties.jointType === "input") {
				supportsNewIncomingConnection = true;
			}
		} else if (node.properties.type === "splitter" || node.properties.type === "merger") {
			const edges = node.edges.values().map(id => page.edges.get(id)).filter(e => e !== undefined);
			let incomingCount = 0;
			let outgoingCount = 0;
			for (const edge of edges) {
				if (edge.startNodeId === node.id) {
					outgoingCount++;
				} else if (edge.endNodeId === node.id) {
					incomingCount++;
				}
			}
			if (node.properties.type === "splitter") {
				supportsNewIncomingConnection = incomingCount === 0;
				supportsNewOutgoingConnection = true;
			} else if (node.properties.type === "merger") {
				supportsNewIncomingConnection = true;
				supportsNewOutgoingConnection = outgoingCount === 0;
			} else {
				assertUnreachable(node.properties.type);
			}
		}
		if (supportsNewIncomingConnection) {
			items.push({
				label: "Add incoming connection",
				onClick: startNewIncomingConnection,
			});
		}
		if (supportsNewOutgoingConnection) {
			items.push({
				label: "Add outgoing connection",
				onClick: startNewOutgoingConnection,
			});
		}
		return items;
	});

	let dragType: "moveSelf" | "moveSelected" | "moveNewResourceJoint" | null = isMovingResourceJoint ? "moveNewResourceJoint" : null;
	const connectableNodes = isMovingResourceJoint ? page.getResourceJointAttachableNodes(node as GraphNode<GraphNodeResourceJointProperties>) : [];
	const indirectlyConnectableNodes = connectableNodes
		.filter(n => n.parentNode)
		.map(n => ({ node: page.nodes.get(n.parentNode!)!, joint: n }));
	
		onMount(() => {
			for (const n of [...connectableNodes, ...indirectlyConnectableNodes.map(n => n.node)]) {
				page.highlightedNodes.attachable.add(n.id);
			}
		});

	function getInRangeJointNode(): GraphNode | null {
		const nodeRadius = getNodeRadius(node);

		let minDistance = Infinity;
		let closestNode: GraphNode | null = null;
		function onCandidate(n: GraphNode, distance: number) {
			if (distance < minDistance) {
				minDistance = distance;
				closestNode = n;
			}
		}

		for (const n of indirectlyConnectableNodes) {
			const nAbsPosition = n.node.getAbsolutePosition(page);
			const xPoints = [
				nAbsPosition.x - n.node.size.x / 2,
				nAbsPosition.x + n.node.size.x / 2,
			];
			const yPoints = [
				nAbsPosition.y - n.node.size.y / 2,
				nAbsPosition.y + n.node.size.y / 2,
			];
			const isInsideWidth = position.x >= xPoints[0] && position.x <= xPoints[1];
			const isInsideHeight = position.y >= yPoints[0] && position.y <= yPoints[1];
			let distances: number[] = [];
			if (isInsideWidth && isInsideHeight) {
				distances.push(0);
			}
			else if (isInsideWidth) {
				distances.push(Math.abs(position.y - yPoints[0]));
				distances.push(Math.abs(position.y - yPoints[1]));
			}
			else if (isInsideHeight) {
				distances.push(Math.abs(position.x - xPoints[0]));
				distances.push(Math.abs(position.x - xPoints[1]));
			}
			distances = distances.filter(d => d < nodeRadius);
			if (distances.length === 0) {
				continue;
			}
			const distance = Math.min(...distances);
			onCandidate(n.joint, distance);
		}
		for (const n of connectableNodes) {
			const nAbsPosition = n.getAbsolutePosition(page);
			const distance = Math.sqrt(
				Math.pow(position.x - nAbsPosition.x, 2) +
				Math.pow(position.y - nAbsPosition.y, 2)
			);
			const otherRadius = getNodeRadius(n);
			if (distance < nodeRadius + otherRadius) {
				onCandidate(n, distance);
			}
		}
		
		return closestNode;
	}

	function startMoveResourceJoint(jointDragType: JointDragType, preferredJointType?: "input" | "output") {
		page.history.enabled = false;
		let newNode: GraphNode<GraphNodeResourceJointProperties>;
		if (node.properties.type === "resource-joint") {
			newNode = page.startMovingRecipeResourceJoint(node, position, preferredJointType ?? node.properties.jointType, jointDragType, node.properties.resourceClassName, node.properties.layoutOrientation);
		} else if (node.properties.type === "splitter" || node.properties.type === "merger") {
			const jointType = node.properties.type === "splitter" ? "output" : "input";
			newNode = page.startMovingRecipeResourceJoint(node, position, preferredJointType ?? jointType, jointDragType, node.properties.resourceClassName);
		} else {
			throw new Error("Node is not a resource joint or splitter/merger node, cannot start moving resource joint");
		}
		page.clearHighlightedNodes();
	}

	function moveResourceJoint(deltaX: number, deltaY: number) {
		if (node.properties.type !== "resource-joint") {
			return;
		}
		if (newNodeDragHasFinished) {
			return;
		}
		// move node
		page.moveNode(node, deltaX, deltaY);
		// highlight nodes
		page.highlightedNodes.hovered.clear();
		page.highlightedNodes.hovered.add(node.id);
		page.highlightedNodes.hovered.add(node.properties.dragStartNodeId!);
		// snap to in-range joint node
		const inRangeJointNode = getInRangeJointNode();
		if (inRangeJointNode) {
			page.highlightedNodes.hovered.add(inRangeJointNode.id);
			if (inRangeJointNode.parentNode) {
				page.highlightedNodes.hovered.add(inRangeJointNode.parentNode);
			}
			const inRangeNodePos = inRangeJointNode.getAbsolutePosition(page);
			node.position.x = inRangeNodePos.x;
			node.position.y = inRangeNodePos.y;
		}
	}

	function endMoveResourceJoint(e: CursorEvent) {
		if (node.properties.type !== "resource-joint") {
			return;
		}
		if (newNodeDragHasFinished) {
			return;
		}
		page.clearHighlightedNodes();
		page.history.enabled = true;

		const targetNode = getInRangeJointNode();

		if (targetNode) {
			page.connectResourceJoints(node, targetNode);
		}
		else if (dragType === "moveNewResourceJoint") {
			const originalNode = page.nodes.get(node.properties.dragStartNodeId!)!;
			const dragStartPos = originalNode.getAbsolutePosition(page);
			const dragEndPos = node.getAbsolutePosition(page);
			const dragDistance = Math.sqrt(
				Math.pow(dragEndPos.x - dragStartPos.x, 2) +
				Math.pow(dragEndPos.y - dragStartPos.y, 2)
			);
			if (dragDistance < gridSize) {
				page.onResourceJointDragEnd(node);
			}
			else {
				newNodeDragHasFinished = true;
				const edge = page.edges.get(node.edges.values().next().value || "");
				const isInput = edge?.endNodeId === node.id;
				eventStream.emit({
					type: "showProductionSelector",
					x: e.clientX,
					y: e.clientY,
					autofocus: !e.isTouchEvent,
					requiredInputsClassName: isInput ? node.properties.resourceClassName : undefined,
					requiredOutputsClassName: !isInput ? node.properties.resourceClassName : undefined,
					onSelect: (details) => {
						const point = page.screenToPageCoords({x: e.clientX, y: e.clientY});
						const newNode = page.makeProductionNode(details, point);
						let destJoint: GraphNode | null = null;
						for (const jointId of newNode.children) {
							const joint = page.nodes.get(jointId);
							if (!joint || joint.properties.type !== "resource-joint") {
								continue;
							}
							if (joint.properties.resourceClassName !== (node.properties as GraphNodeResourceJointProperties).resourceClassName) {
								continue;
							}
							destJoint = joint;
							break;
						}
						if (!destJoint) {
							destJoint = newNode;
						}
						for (const edgeId of node.edges) {
							const edge = page.edges.get(edgeId)!;
							if (edge.startNodeId === node.id) {
								edge.connectNode(destJoint, "start", page);
							} else {
								edge.connectNode(destJoint, "end", page);
							}
						}
						node.edges.clear();
						page.removeNode(node.id);
					},
					onCancel: () => {
						page.onResourceJointDragEnd(node);
					},
				});
			}
		}
		else {
			page.onResourceJointDragEnd(node);
		}
	}

	function onDragStart(e: DragEvent) {
		const point = page.screenToPageCoords({ x: e.cursorEvent.clientX, y: e.cursorEvent.clientY });
		dragStartPoint = point;
		if (isSelected) {
			dragType = "moveSelected";
			page.startMovingSelectedNodes();
		} else {
			dragType = "moveSelf";
			page.startMovingNode(node);
		}
	}

	function onDrag(e: DragEvent) {
		const point = page.screenToPageCoords({ x: e.cursorEvent.clientX, y: e.cursorEvent.clientY });
		const deltaX = point.x - dragStartPoint!.x;
		const deltaY = point.y - dragStartPoint!.y;
		if (dragType === "moveSelected") {
			page.moveSelectedNodes(deltaX, deltaY);
		} else if (dragType === "moveSelf") {
			page.moveNode(node, deltaX, deltaY);
		}
	}

	function onDragEnd(e: DragEvent) {
		dragType = null;
	}

	function onSplitResourceStart(event: CursorEvent) {
		startMoveResourceJoint("drag-to-connect");
	}

	function onCursorMove(event: CursorEvent) {
		const point = page.screenToPageCoords({ x: event.clientX, y: event.clientY });
		const deltaX = point.x - dragStartPoint!.x;
		const deltaY = point.y - dragStartPoint!.y;
		moveResourceJoint(deltaX, deltaY);
	}

	function startNewIncomingConnection() {
		startMoveResourceJoint("click-to-connect", "input");
	}

	function startNewOutgoingConnection() {
		startMoveResourceJoint("click-to-connect", "output");
	}

	function onClick(event: CursorEvent) {
		if (isSelectable) {
			if (event.hasShiftKey) {
				page.toggleNodeSelection(node);
			} else if (!isSelected) {
				page.selectNode(node);
			}
		}
		if (jointDragType === "click-to-connect") {
			endMoveResourceJoint(event);
		}
	}

	function onContextMenu(event: MouseEvent) {
		event.preventDefault();
		eventStream.emit({
			type: "showContextMenu",
			x: event.clientX,
			y: event.clientY,
			items: contextMenuItems,
		});
	}


</script>

<UserEvents
	onDragStart={isDraggable ? onDragStart : null}
	onDrag={isDraggable ? onDrag : null}
	onDragEnd={isDraggable ? onDragEnd : null}
	onClick={isSelectable || jointDragType === "click-to-connect" ? onClick : null}
	onCursorDown={isResourceSplittable ? onSplitResourceStart : null}
	onCursorMove={jointDragType ? onCursorMove : null}
	onCursorUp={jointDragType === "drag-to-connect" ? endMoveResourceJoint : null}
	onContextMenu={contextMenuItems.length > 0 ? onContextMenu : null}
	debugKey="Node {node.id}"
>
	{#snippet children({ listeners })}
		<g {...listeners} transform={`translate(${position.x}, ${position.y})`}>
			{#if node.properties.type === "production"}
				<ProductionNodeView node={node as GraphNode<GraphNodeProductionProperties>} />
			{:else if node.properties.type === "resource-joint"}
				<ResourceJointNodeView node={node as GraphNode<GraphNodeResourceJointProperties>} />
			{:else if node.properties.type === "splitter" || node.properties.type === "merger"}
				<SplitterMergerNodeView node={node as GraphNode<GraphNodeSplitterMergerProperties>} />
			{:else}
				<circle
					class="node-view"
					cx={-10}
					cy={-10}
					r="20"
					fill="red"
				/>
			{/if}
		</g>
	{/snippet}
</UserEvents>
