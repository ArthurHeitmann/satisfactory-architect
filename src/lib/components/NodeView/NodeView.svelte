<script lang="ts">
	import { getContext, onDestroy, onMount } from "svelte";
	import RecipeNodeView from "./ProductionNodeView.svelte";
	import UserEvents, { type CursorEvent, type DragEvent } from "../UserEvents.svelte";
	import { isNodeSelectable, isNodeDraggable, isNodeDeletable, getNodeRadius, isResourceNodeSplittable } from "../../datamodel/nodeTypeProperties.svelte";
	import ResourceJointNodeView from "./ResourceJointNodeView.svelte";
	import type { ContextMenuItem, EventStream, ShowContextMenuEvent, ShowProductionSelectorEvent } from "$lib/EventStream.svelte";
	import { assertUnreachable, pluralStr } from "$lib/utilties";
	import { gridSize } from "../../datamodel/constants";
	import type { Id } from "../../datamodel/IdGen";
	import ProductionNodeView from "./ProductionNodeView.svelte";
	import SplitterMergerNodeView from "./SplitterMergerNodeView.svelte";
	import type { GraphNode, GraphNodeProductionProperties, GraphNodeResourceJointProperties, GraphNodeSplitterMergerProperties, GraphNodeTextNoteProperties, JointDragType } from "../../datamodel/GraphNode.svelte";
	import type { GraphPage } from "../../datamodel/GraphPage.svelte";
	import type { IVector2D } from "../../datamodel/GraphView.svelte";
    import { fade } from "svelte/transition";
    import { blockStateChanges, globals, unblockStateChanges } from "../../datamodel/globals.svelte";
    import TextNoteNodeView from "./TextNoteNodeView.svelte";

	interface Props {
		node: GraphNode;
	}
	const { node }: Props = $props();

	const eventStream = getContext("event-stream") as EventStream;
	const page = $derived(node.context.page);
	
	const isSelectable = isNodeSelectable(node);
	const isDraggable = isNodeDraggable(node);
	const isSelected = $derived(page.selectedNodes.has(node.id));
	const isDeletable = isNodeDeletable(node);
	const isResourceSplittable = isResourceNodeSplittable(node);
	
	const position = $derived(node.getAbsolutePosition(page));
	
	const isMovingResourceJoint = node.properties.type === "resource-joint" && node.properties.jointDragType !== undefined;
	const jointDragType = isMovingResourceJoint ? node.properties.jointDragType! : null;
	const enableEvents = $derived(page.userEventsPriorityNodeId ? page.userEventsPriorityNodeId === node.id : true);
	// svelte-ignore state_referenced_locally
	let dragStartPoint = $state(isMovingResourceJoint ? position : null);
	let newNodeDragHasFinished = $state(false);
	let enableWindowClick = $state(false);

	const contextMenuItems = $derived.by(() => {
		const items: ContextMenuItem[] = [];
		if (isDeletable) {
			if (isSelected && (page.selectedNodes.size > 1 || !page.selectedNodes.has(node.id))) {
				const selectedCount = page.selectedNodes.size;
				items.push({
					label: `Delete ${pluralStr("Node", selectedCount)}`,
					icon: "delete",
					hint: "Del",
					onClick: () => page.removeSelectedNodes(),
				});
			} else {
				items.push({
					label: "Delete Node",
					icon: "delete",
					hint: "Del",
					onClick: () => page.removeNode(node.id),
				});
			}
		}
		if (isSelected) {
			items.push({
				label: `Copy ${page.selectedNodes.size === 1 ? "Node" : pluralStr("Node", page.selectedNodes.size)}`,
				icon: "copy",
				hint: "Ctrl+C",
				onClick: () => page.copyOrCutSelection("copy"),
			});
			items.push({
				label: `Cut ${page.selectedNodes.size === 1 ? "Node" : pluralStr("Node", page.selectedNodes.size)}`,
				icon: "cut",
				hint: "Ctrl+X",
				onClick: () => page.copyOrCutSelection("cut"),
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
				label: "Add Incoming Connection",
				icon: "arrow-right-base-right",
				onClick: startNewIncomingConnection,
			});
		}
		if (supportsNewOutgoingConnection) {
			items.push({
				label: "Add Outgoing Connection",
				icon: "arrow-right-base-left",
				onClick: startNewOutgoingConnection,
			});
		}
		if (node.properties.type === "production" && node.properties.details.type === "factory-reference") {
			items.push({
				label: "Update In-/Outputs",
				icon: "refresh",
				onClick: node.updateExternalFactoryJoints.bind(node),
			});
		}
		if (node.properties.type === "production") {
			if (node.properties.details.type === "factory-input" || node.properties.details.type === "factory-output") {
				items.push({
					label: (node.properties.autoMultiplier ? "Manual" : "Auto") + " Rate",
					icon: "infinity",
					onClick: () => {
						const properties = node.properties as GraphNodeProductionProperties;
						properties.autoMultiplier = !properties.autoMultiplier;
					},
				});
			}
			// if (node.properties.details.type === "extraction") {
			// 	const details = node.properties.details;
			// 	items.push({
			// 		label: "Make impure",
			// 		onClick: () => details.purityModifier = 0.5,
			// 	});
			// 	items.push({
			// 		label: "Make normal",
			// 		onClick: () => details.purityModifier = 1,
			// 	});
			// 	items.push({
			// 		label: "Make pure",
			// 		onClick: () => details.purityModifier = 2,
			// 	});
			// }
		}
		return items;
	});

	let dragType: "moveSelf" | "moveSelected" | "moveNewResourceJoint" | null = isMovingResourceJoint ? "moveNewResourceJoint" : null;
	const connectableNodes = isMovingResourceJoint ? page.getResourceJointAttachableNodes(node as GraphNode<GraphNodeResourceJointProperties>) : [];
	const indirectlyConnectableNodes = connectableNodes
		.filter(n => n.parentNode)
		.map(n => ({ node: page.nodes.get(n.parentNode!)!, joint: n }))
		.filter(n => n.node);
	
	onMount(() => {
		for (const n of [...connectableNodes, ...indirectlyConnectableNodes.map(n => n.node)]) {
			page.highlightedNodes.attachable.add(n.id);
		}

		if (jointDragType === "click-to-connect") {
			page.userEventsPriorityNodeId = node.id;
			setTimeout(() => {
				enableWindowClick = true;
			}, 0);
		}
	});
	onDestroy(() => {
		if (page.userEventsPriorityNodeId === node.id) {
			page.userEventsPriorityNodeId = null;
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
		blockStateChanges();
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
		unblockStateChanges();
		page.clearHighlightedNodes();

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
				blockStateChanges();
				eventStream.emit({
					type: "showProductionSelector",
					page: page,
					x: e.clientX,
					y: e.clientY,
					autofocus: !e.isTouchEvent,
					requiredInputsClassName: isInput ? node.properties.resourceClassName : undefined,
					requiredOutputsClassName: !isInput ? node.properties.resourceClassName : undefined,
					onSelect: (details) => {
						unblockStateChanges();
						const point = page.screenToPageCoords({x: e.clientX, y: e.clientY});
						const newNode = page.makeNewNode(details, point);
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
						for (let i = 0; i < 5; i++) {
							const destJointPos = destJoint.getAbsolutePosition(page);
							const posDelta = {
								x: node.position.x - destJointPos.x,
								y: node.position.y - destJointPos.y,
							};
							if (posDelta.x === 0 && posDelta.y === 0) {
								break;
							}
							newNode.onDragStart();
							newNode.move(posDelta.x, posDelta.y, 0);
							newNode.reorderRecipeJoints(page);
						}
					},
					onCancel: () => {
						unblockStateChanges();
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
				page.clearAllSelection();
				page.selectNode(node);
			}
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
	id="Node {node.id}"
	onDragStart={enableEvents && isDraggable ? onDragStart : null}
	onDrag={enableEvents && isDraggable ? onDrag : null}
	onDragEnd={enableEvents && isDraggable ? onDragEnd : null}
	onClick={enableEvents && isSelectable ? onClick : null}
	onWindowClick={enableEvents && enableWindowClick ? endMoveResourceJoint : null}
	onCursorDown={enableEvents && isResourceSplittable ? onSplitResourceStart : null}
	onCursorMove={enableEvents && jointDragType ? onCursorMove : null}
	onWindowCursorUp={enableEvents && jointDragType === "drag-to-connect" ? endMoveResourceJoint : null}
	onContextMenu={enableEvents && contextMenuItems.length > 0 ? onContextMenu : null}
>
	{#snippet children({ listeners })}
		<g
			{...listeners}
			transform={`translate(${position.x}, ${position.y})`}
		>
			{#if node.properties.type === "production"}
				<ProductionNodeView node={node as GraphNode<GraphNodeProductionProperties>} />
			{:else if node.properties.type === "resource-joint"}
				<ResourceJointNodeView node={node as GraphNode<GraphNodeResourceJointProperties>} />
			{:else if node.properties.type === "splitter" || node.properties.type === "merger"}
				<SplitterMergerNodeView node={node as GraphNode<GraphNodeSplitterMergerProperties>} />
			{:else if node.properties.type === "text-note"}
				<TextNoteNodeView node={node as GraphNode<GraphNodeTextNoteProperties>} />
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
