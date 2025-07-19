<script lang="ts">
	import { getContext } from "svelte";
	import RecipeNodeView from "./ProductionNodeView.svelte";
	import UserEvents, { type CursorEvent, type DragEvent } from "../UserEvents.svelte";
	import { isNodeSelectable, isNodeDraggable, isNodeDeletable, getNodeRadius } from "../datamodel/nodeTypeProperties.svelte";
	import ResourceJointNodeView from "./ResourceJointNodeView.svelte";
	import type { ContextMenuItem, EventStream, ShowContextMenuEvent, ShowProductionSelectorEvent } from "$lib/EventStream.svelte";
	import { assertUnreachable, pluralStr } from "$lib/utilties";
	import { gridSize } from "../datamodel/constants";
	import type { Id } from "../datamodel/IdGen";
	import ProductionNodeView from "./ProductionNodeView.svelte";
	import SplitterMergerNodeView from "./SplitterMergerNodeView.svelte";
	import type { GraphNode, GraphNodeProductionProperties, GraphNodeResourceJointProperties, GraphNodeSplitterMergerProperties } from "../datamodel/GraphNode.svelte";
	import type { GraphPage } from "../datamodel/GraphPage.svelte";
	import type { IVector2D } from "../datamodel/GraphView.svelte";

	interface Props {
		node: GraphNode;
	}
	const { node }: Props = $props();

	const page = getContext("graph-page") as GraphPage;
	const eventStream = getContext("event-stream") as EventStream;

	const isSelectable = $derived(isNodeSelectable(node));
	const isDraggable = $derived(isNodeDraggable(node));
	const isSelected = $derived(page.selectedNodes.has(node.id));
	const isDeletable = $derived(isNodeDeletable(node));

	let jointDragType: "drag-to-connect" | "click-to-connect" | null = $state(null);
	let jointDragStartPoint: IVector2D | null = null;

	const position = $derived.by(() => {
		if (!node.parentNode) {
			return { x: node.position.x, y: node.position.y };
		}
		const parentNode = page.nodes.get(node.parentNode);
		if (!parentNode) {
			console.warn("Node has a parent that does not exist in the page", node);
			return { x: node.position.x, y: node.position.y };
		}
		return {
			x: parentNode.position.x + node.position.x,
			y: parentNode.position.y + node.position.y,
		};
	});

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

	let dragType: "moveSelf" | "moveSelected" | "moveNewResourceJoint" | "moveDetachedResourceJoint" | null = null;
	let resourceJointNode: GraphNode<GraphNodeResourceJointProperties> | null = null;
	let connectableNodes: GraphNode[] = [];
	let indirectlyConnectableNodes: { node: GraphNode, joint: GraphNode }[] = [];
	let highlightedNodes = new Set<Id>();

	function getInRangeJointNode(): GraphNode | null {
		const absPosition = resourceJointNode!.getAbsolutePosition(page);
		const nodeRadius = getNodeRadius(resourceJointNode!);

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
			const isInsideWidth = absPosition.x >= xPoints[0] && absPosition.x <= xPoints[1];
			const isInsideHeight = absPosition.y >= yPoints[0] && absPosition.y <= yPoints[1];
			let distances: number[] = [];
			if (isInsideWidth && isInsideHeight) {
				distances.push(0);
			}
			else if (isInsideWidth) {
				distances.push(Math.abs(absPosition.y - yPoints[0]));
				distances.push(Math.abs(absPosition.y - yPoints[1]));
			}
			else if (isInsideHeight) {
				distances.push(Math.abs(absPosition.x - xPoints[0]));
				distances.push(Math.abs(absPosition.x - xPoints[1]));
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
				Math.pow(absPosition.x - nAbsPosition.x, 2) +
				Math.pow(absPosition.y - nAbsPosition.y, 2)
			);
			const otherRadius = getNodeRadius(n);
			if (distance < nodeRadius + otherRadius) {
				onCandidate(n, distance);
			}
		}
		
		return closestNode;
	}

	function startMoveResourceJoint(preferredJointType?: "input" | "output") {
		const absPosition = node.getAbsolutePosition(page);
		page.history.enabled = false;
		highlightedNodes.clear();
		dragType = "moveNewResourceJoint";
		if (node.properties.type === "resource-joint") {
			resourceJointNode = page.startMovingRecipeResourceJoint(node as GraphNode<GraphNodeResourceJointProperties>, absPosition, preferredJointType ?? node.properties.jointType, node.properties.resourceClassName, node.properties.layoutOrientation);
		} else if (node.properties.type === "splitter" || node.properties.type === "merger") {
			const jointType = node.properties.type === "splitter" ? "output" : "input";
			resourceJointNode = page.startMovingRecipeResourceJoint(node as GraphNode<GraphNodeSplitterMergerProperties>, absPosition, preferredJointType ?? jointType, node.properties.resourceClassName);
		} else {
			throw new Error("Node is not a resource joint or splitter/merger node, cannot start moving resource joint");
		}
		highlightedNodes.add(node.id);
		highlightedNodes.add(resourceJointNode.id);
		connectableNodes = page.getResourceJointAttachableNodes(resourceJointNode, node);
		indirectlyConnectableNodes = connectableNodes
			.filter(n => n.parentNode)
			.map(n => ({ node: page.nodes.get(n.parentNode!)!, joint: n }));
		page.clearHighlightedNodes;
		for (const n of [...connectableNodes, ...indirectlyConnectableNodes.map(n => n.node)]) {
			page.highlightedNodes.attachable.add(n.id);
		}
	}

	function moveResourceJoint(deltaX: number, deltaY: number) {
		if (!resourceJointNode) {
			return;
		}
		// move node
		page.moveNode(resourceJointNode, deltaX, deltaY);
		// highlight nodes
		page.highlightedNodes.hovered.clear();
		for (const id of highlightedNodes) {
			page.highlightedNodes.hovered.add(id);
		}
		// snap to in-range joint node
		const inRangeJointNode = getInRangeJointNode();
		if (inRangeJointNode) {
			page.highlightedNodes.hovered.add(inRangeJointNode.id);
			if (inRangeJointNode.parentNode) {
				page.highlightedNodes.hovered.add(inRangeJointNode.parentNode);
			}
			const inRangeNodePos = inRangeJointNode.getAbsolutePosition(page);
			resourceJointNode.position.x = inRangeNodePos.x;
			resourceJointNode.position.y = inRangeNodePos.y;
		}
	}

	function endMoveResourceJoint(e: CursorEvent) {
		if (!resourceJointNode) {
			return;
		}
		page.clearHighlightedNodes();
		page.history.enabled = true;

		const targetNode = getInRangeJointNode();

		if (targetNode) {
			page.connectResourceJoints(resourceJointNode, targetNode);
		}
		else if (dragType === "moveNewResourceJoint") {
			const dragStart = node.getAbsolutePosition(page);
			const dragEnd = resourceJointNode.getAbsolutePosition(page);
			const dragDistance = Math.sqrt(
				Math.pow(dragEnd.x - dragStart.x, 2) +
				Math.pow(dragEnd.y - dragStart.y, 2)
			);
			if (dragDistance < gridSize) {
				page.onResourceJointDragEnd(resourceJointNode);
			}
			else {
				const tmpNode = resourceJointNode;
				const edge = page.edges.get(tmpNode.edges.values().next().value || "");
				const isInput = edge?.endNodeId === tmpNode.id;
				eventStream.emit({
					type: "showProductionSelector",
					x: e.clientX,
					y: e.clientY,
					autofocus: !e.isTouchEvent,
					requiredInputsClassName: isInput ? tmpNode.properties.resourceClassName : undefined,
					requiredOutputsClassName: !isInput ? tmpNode.properties.resourceClassName : undefined,
					onSelect: (details) => {
						const point = page.screenToGraphCoords({x: e.clientX, y: e.clientY});
						const newNode = page.makeProductionNode(details, point);
						let destJoint: GraphNode | null = null;
						for (const jointId of newNode.children) {
							const joint = page.nodes.get(jointId);
							if (!joint || joint.properties.type !== "resource-joint") {
								continue;
							}
							if (joint.properties.resourceClassName !== tmpNode.properties.resourceClassName) {
								continue;
							}
							destJoint = joint;
							break;
						}
						if (!destJoint) {
							destJoint = newNode;
						}
						for (const edgeId of tmpNode.edges) {
							const edge = page.edges.get(edgeId)!;
							if (edge.startNodeId === tmpNode.id) {
								edge.connectNode(destJoint, "start", page);
							} else {
								edge.connectNode(destJoint, "end", page);
							}
						}
						tmpNode.edges.clear();
						page.removeNode(tmpNode.id);
					},
					onCancel: () => {
						page.onResourceJointDragEnd(tmpNode);
					},
				});
			}
		}
		else {
			page.onResourceJointDragEnd(resourceJointNode);
		}
	}

	function onDragStart(e: DragEvent) {
		if (jointDragType !== null) {
			return;
		}
		jointDragType = "drag-to-connect";
		const canDragFromResourceJoint = node.properties.type === "resource-joint" && node.properties.locked;
		const canDragFromSplitterMerger = node.properties.type === "splitter" || node.properties.type === "merger";
		const hasModifierKey = e.cursorEvent?.hasCtrlKey || e.cursorEvent?.hasMetaKey;
		if (canDragFromResourceJoint || canDragFromSplitterMerger && hasModifierKey) {
			startMoveResourceJoint();
		} else if (isSelected) {
			dragType = "moveSelected";
			page.startMovingSelectedNodes();
		} else {
			dragType = "moveSelf";
			page.startMovingNode(node);
		}
	}

	function onDrag(e: DragEvent) {
		const scale = page.view.scale;
		const deltaX = e.totalDeltaX / scale;
		const deltaY = e.totalDeltaY / scale;
		if ((dragType === "moveNewResourceJoint" || dragType === "moveDetachedResourceJoint") && resourceJointNode) {
			moveResourceJoint(deltaX, deltaY);
		} else if (dragType === "moveSelected") {
			page.moveSelectedNodes(deltaX, deltaY);
		} else if (dragType === "moveSelf") {
			page.moveNode(node, deltaX, deltaY);
		}
	}

	function onDragEnd(e: DragEvent) {
		if (resourceJointNode) {
			endMoveResourceJoint(e.cursorEvent);
		}
		dragType = null;
		resourceJointNode = null;
		jointDragType = null;
	}

	function onCursorMove(event: CursorEvent) {
		if (jointDragType !== "click-to-connect") {
			return;
		}
		if (jointDragStartPoint === null) {
			const absPosition = node.getAbsolutePosition(page);
			jointDragStartPoint = {
				x: absPosition.x,
				y: absPosition.y,
			};
			return;
		}
		const point = page.screenToGraphCoords({ x: event.clientX, y: event.clientY });
		const deltaX = point.x - jointDragStartPoint.x;
		const deltaY = point.y - jointDragStartPoint.y;
		moveResourceJoint(deltaX, deltaY);
	}

	function startNewIncomingConnection() {
		jointDragType = "click-to-connect";
		startMoveResourceJoint("input");
	}

	function startNewOutgoingConnection() {
		jointDragType = "click-to-connect";
		startMoveResourceJoint("output");
	}

	function connectOnClick(event: CursorEvent) {
		if (jointDragType !== "click-to-connect" || jointDragStartPoint === null) {
			return;
		}
		endMoveResourceJoint(event);
		jointDragType = null;
		jointDragStartPoint = null;
	}

	function onClick(event: CursorEvent) {
		if (event.hasShiftKey) {
			page.toggleNodeSelection(node);
		} else if (!isSelected) {
			page.selectNode(node);
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
	onClick={isSelectable ? onClick : null}
	onCursorMove={jointDragType === "click-to-connect" ? onCursorMove : null}
	onWindowClick={jointDragType === "click-to-connect" ? connectOnClick : null}
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
