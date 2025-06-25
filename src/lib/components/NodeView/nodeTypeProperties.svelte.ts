import type { GraphNode, GraphNodeResourceJointProperties, GraphNodeType } from "$lib/components/datamodel/datamodel.svelte";

const draggableTypes: GraphNodeType[] = ["recipe", "resource-joint"];
const selectableTypes: GraphNodeType[] = ["recipe", "resource-joint"];
const deletableTypes: GraphNodeType[] = ["recipe", "resource-joint"];

export function isNodeDraggable(node: GraphNode): boolean {
	return draggableTypes.includes(node.properties.type);
}

export function isNodeSelectable(node: GraphNode): boolean {
	if (node.properties.type === "resource-joint" && (node.properties as GraphNodeResourceJointProperties).locked) {
		return false;
	}
	return selectableTypes.includes(node.properties.type);
}

export function isNodeDeletable(node: GraphNode): boolean {
	if (node.properties.type === "resource-joint" && (node.properties as GraphNodeResourceJointProperties).locked) {
		return false;
	}
	return deletableTypes.includes(node.properties.type);
}
