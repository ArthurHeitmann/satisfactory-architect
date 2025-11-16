import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import { assertUnreachable } from "$lib/utilties";
import type { AppState } from "./AppState.svelte";
import type { GraphEdge } from "./GraphEdge.svelte";
import type { GraphNodeType, GraphNode, ProductionDetails } from "./GraphNode.svelte";
import { resourceJointNodeRadius, splitterMergerNodeRadius } from "./constants";

const draggableTypes: GraphNodeType[] = ["production", "splitter", "merger", "text-note"];
const selectableTypes: GraphNodeType[] = ["production", "splitter", "merger", "text-note"];
const deletableTypes: GraphNodeType[] = ["production", "splitter", "merger", "text-note"];
const attachableTypes: GraphNodeType[] = ["resource-joint", "splitter", "merger"];
const rotatableEdgeNodes: GraphNodeType[] = ["splitter", "merger"];

const nodeRadius: Partial<Record<GraphNodeType, number>> = {
	"resource-joint": resourceJointNodeRadius,
	"splitter": splitterMergerNodeRadius,
	"merger": splitterMergerNodeRadius,
};

export function isNodeDraggable(node: GraphNode): boolean {
	return draggableTypes.includes(node.properties.type);
}

export function isNodeSelectable(node: GraphNode): boolean {
	return selectableTypes.includes(node.properties.type);
}

export function isNodeDeletable(node: GraphNode): boolean {
	if (node.properties.type === "resource-joint" && node.properties.locked) {
		return false;
	}
	return deletableTypes.includes(node.properties.type);
}

export function isNodeAttachable(node: GraphNode): boolean {
	return attachableTypes.includes(node.properties.type);
}

export function isResourceNodeSplittable(node: GraphNode): boolean {
	if (node.properties.type === "resource-joint" && node.properties.locked) {
		return true;
	}
	return false;
}

export function canUseInvertedEdgeControlPoint(node: GraphNode): boolean {
	if (node.properties.type !== "resource-joint") {
		return false;
	}
	return !node.properties.locked;
}

export function userCanChangeOrientationVector(node: GraphNode, edge: GraphEdge): boolean {
	if (edge.properties.displayType === "straight") {
		return false;
	}
	return rotatableEdgeNodes.includes(node.properties.type);
}

export function getNodeRadius(node: GraphNode): number {
	const radius = nodeRadius[node.properties.type];
	return radius ?? 0;
}
