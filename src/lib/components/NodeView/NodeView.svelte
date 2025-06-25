<script lang="ts">
	import type { GraphNode, GraphNodeRecipeProperties, GraphNodeResourceJointProperties, GraphPage, IVector2D } from "$lib/components/datamodel/datamodel.svelte";
    import { getContext } from "svelte";
    import RecipeNodeView from "./RecipeNodeView.svelte";
    import DragEvents from "../UserEvents.svelte";
    import { isNodeSelectable, isNodeDraggable, isNodeDeletable } from "./nodeTypeProperties.svelte";
    import ResourceJointNodeView from "./ResourceJointNodeView.svelte";
    import type { ContextMenuItem, ShowContextMenuEvent, ShowRecipeSelectorEvent } from "$lib/EventStream.svelte";
    import { pluralStr } from "$lib/utilties";
    import { gridSize } from "../datamodel/layoutConstants";

	interface Props {
		node: GraphNode;
	}
	const { node }: Props = $props();

	const page = getContext("graph-page") as GraphPage;

	const isSelectable = $derived(isNodeSelectable(node));
	const isDraggable = $derived(isNodeDraggable(node));
	const isSelected = $derived(page.selectedNodes.has(node.id));
	const isDeletable = $derived(isNodeDeletable(node));

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
		return items;
	});

	let dragType: "moveSelf" | "moveSelected" | "moveNewResourceJoint" | "moveDetachedResourceJoint" | null = null;
	let resourceJointNode: GraphNode<GraphNodeResourceJointProperties> | null = null;
	let connectableNodes: GraphNode<GraphNodeRecipeProperties>[] = [];
</script>

<DragEvents
	onDragStart={isDraggable ? (e) => {
		if (node.properties.type === "resource-joint" && (node.properties as GraphNodeResourceJointProperties).locked) {
			const scale = page.view.scale;
			const deltaX = e.totalDeltaX / scale;
			const deltaY = e.totalDeltaY / scale;
			const absPosition = node.getAbsolutePosition(page);
			const point: IVector2D = { x: absPosition.x + deltaX, y: absPosition.y + deltaY };
			if (node.edges.size !== 1) {
				dragType = "moveNewResourceJoint";
				resourceJointNode = page.startMovingRecipeResourceJoint(node as GraphNode<GraphNodeResourceJointProperties>, point);
			} else {
				const edge = page.edges.get(node.edges.values().next().value || "");
				if (edge) {
					dragType = "moveDetachedResourceJoint";
					resourceJointNode = page.startMovingConnectedRecipeResourceJoint(node as GraphNode<GraphNodeResourceJointProperties>, point, edge);
				} else {
					console.warn("Resource joint node has no edges", node);
					return;
				}
			}
			connectableNodes = [];
			const ownProperties = node.properties as GraphNodeResourceJointProperties;
			for (const n of page.nodes.values()) {
				if (n.id === node.id || n.id === resourceJointNode?.id) {
					continue;
				}
				if (n.properties.type !== "resource-joint") {
					continue;
				}
				const otherProperties = n.properties as GraphNodeResourceJointProperties;
				if (otherProperties.resourceClassName !== ownProperties.resourceClassName) {
					continue;
				}
				if (otherProperties.jointType !== resourceJointNode.properties.jointType) {
					continue;
				}
				if (page.selectedNodes.has(n.id)) {
					continue;
				}
				connectableNodes.push(n as GraphNode<GraphNodeRecipeProperties>);
			}
		} else if (isSelected) {
			dragType = "moveSelected";
			page.startMovingSelectedNodes();
		} else {
			dragType = "moveSelf";
			page.startMovingNode(node);
		}
	} : null}
	onDrag={isDraggable ? (e) => {
		const scale = page.view.scale;
		const deltaX = e.totalDeltaX / scale;
		const deltaY = e.totalDeltaY / scale;
		if ((dragType === "moveNewResourceJoint" || dragType === "moveDetachedResourceJoint") && resourceJointNode) {
			page.moveNode(resourceJointNode, deltaX, deltaY);
		} else if (dragType === "moveSelected") {
			page.moveSelectedNodes(deltaX, deltaY);
		} else if (dragType === "moveSelf") {
			page.moveNode(node, deltaX, deltaY);
		}
	} : null}
	onDragEnd={isDraggable ? (e) => {
		if (resourceJointNode) {
			const distanceThreshold = 16;
			const absPosition = resourceJointNode.getAbsolutePosition(page);
			for (const n of connectableNodes) {
				const nAbsPosition = n.getAbsolutePosition(page);
				const distance = Math.sqrt(
					Math.pow(absPosition.x - nAbsPosition.x, 2) +
					Math.pow(absPosition.y - nAbsPosition.y, 2)
				);
				if (distance < distanceThreshold) {
					page.connectResourceJoints(resourceJointNode, n as GraphNode<GraphNodeRecipeProperties>);
					return;
				}
			}
			
			if (dragType === "moveNewResourceJoint") {
				const tmpNode = resourceJointNode;
				const edge = page.edges.get(tmpNode.edges.values().next().value || "");
				const isInput = edge?.endNodeId === tmpNode.id;
				page.eventStream.emit(<ShowRecipeSelectorEvent>{
					type: "showRecipeSelector",
					x: e.clientX,
					y: e.clientY,
					autofocus: !e.isTouchEvent,
					requiredInputsClassName: isInput ? tmpNode.properties.resourceClassName : undefined,
					requiredOutputsClassName: !isInput ? tmpNode.properties.resourceClassName : undefined,
					onSelect: (recipe: string) => {
						const point = page.screenToGraphCoords({x: e.clientX, y: e.clientY});
						const newNode = page.makeRecipeNode(recipe, point);
						let destJoint: GraphNode<GraphNodeResourceJointProperties> | null = null;
						for (const jointId of newNode.children) {
							const joint = page.nodes.get(jointId) as GraphNode<GraphNodeResourceJointProperties>;
							if (joint.properties.resourceClassName !== tmpNode.properties.resourceClassName) {
								continue;
							}
							destJoint = joint;
							break;
						}
						if (!destJoint) {
							console.warn("No matching resource joint found for new recipe node", newNode);
							return;
						}
						for (const edgeId of tmpNode.edges) {
							const edge = page.edges.get(edgeId)!;
							if (edge.startNodeId === tmpNode.id) {
								edge.startNodeId = destJoint.id;
							} else {
								edge.endNodeId = destJoint.id;
							}
						}
						tmpNode.edges.clear();
						page.removeNode(tmpNode.id);
					},
					onCancel: () => {
						page.onResourceJointDragEnd(tmpNode);
					},
				});
			} else if (dragType === "moveDetachedResourceJoint") {
				page.onResourceJointDragEnd(resourceJointNode);
			}
		}
		dragType = null;
		resourceJointNode = null;
	} : null}
	onClick={isSelectable ? (event) => {
		if (event.hasShiftKey) {
			page.toggleNodeSelection(node);
		} else if (!isSelected) {
			page.selectNode(node);
		}
	} : null}
	onContextMenu={contextMenuItems.length > 0 ? (event) => {
		event.preventDefault();
		page.eventStream.emit(<ShowContextMenuEvent>{
			type: "showContextMenu",
			x: event.clientX,
			y: event.clientY,
			items: contextMenuItems,
		});
	} : null}
	dragStartThreshold={node.properties.type === "resource-joint" && (node.properties as GraphNodeResourceJointProperties).locked ? gridSize : 0}
>
	{#snippet children({ listeners })}
		<g {...listeners} transform={`translate(${position.x}, ${position.y})`}>
			{#if node.properties.type === "recipe"}
				<RecipeNodeView node={node as GraphNode<GraphNodeRecipeProperties>} />
			{:else if node.properties.type === "resource-joint"}
				<ResourceJointNodeView node={node as GraphNode<GraphNodeResourceJointProperties>} />
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
</DragEvents>
