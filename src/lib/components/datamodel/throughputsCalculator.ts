import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import { assertUnreachable } from "$lib/utilties";
import type { GraphEdge } from "./GraphEdge.svelte";
import type { GraphNode, GraphNodeResourceJointProperties } from "./GraphNode.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import type { Id } from "./IdGen";

type Mode = "push" | "pull";

interface Node extends Throughputs {
	node: GraphNode;
	nextNodes: LinkedNode[];
	previousNodes: LinkedNode[];
	pushed: number;
	pulled: number;
	consumeAll: Mode | null;
}
function defaultNode(node: GraphNode, other: Partial<Node>): Node {
	return {
		node: node,
		nextNodes: [],
		previousNodes: [],
		pushed: other.pushed ?? 0,
		pulled: other.pulled ?? 0,
		consumeAll: other.consumeAll ?? null,
	};
}

interface LinkedNode {
	node: Node;
	edge: GraphEdge;
	throughput: Throughputs;
}

export function calculateThroughputs(page: GraphPage) {
	console.time("calculateThroughputs");
	page.history.enabled = false;
	for (const edge of page.edges.values()) {
		edge.pushThroughput = 0;
		edge.pullThroughput = 0;
	}

	const nodes: Map<Id, Node> = new Map();
	const pushNodes: Node[] = [];
	const pullNodes: Node[] = [];
	const autoNodes: Node[] = [];
	const edges: LinkedNode[] = [];
	generateNodeNetwork(page, nodes, pushNodes, pullNodes, autoNodes, edges);
	for (const node of pushNodes) {
		const result = exploreThroughputOf(node, "push", 0, [node.node.id]);
		dumpLeftOverThroughput(node, "push", result);
	}
	for (const node of pullNodes) {
		const result = exploreThroughputOf(node, "pull", 0, [node.node.id]);
		dumpLeftOverThroughput(node, "pull", result);
	}
	for (const node of autoNodes) {
		autoSetMultiplier(page, node);
		exploreThroughputOf(node, node.consumeAll!,0, [node.node.id]);
	}
	for (const edge of edges) {
		edge.edge.pushThroughput = edge.throughput.pushed;
		edge.edge.pullThroughput = edge.throughput.pulled;
	}
	
	page.history.enabled = true;
	console.timeEnd("calculateThroughputs");
}

interface Throughputs {
	pushed: number;
	pulled: number;
}
type ExploreResult = Throughputs;
const getRateOf = (node: Throughputs, mode: Mode) => mode === "push" ? node.pushed : node.pulled;
const getInvRateOf = (node: Throughputs, mode: Mode) => mode === "push" ? node.pulled : node.pushed;
const getNextNodesOf = (node: Node, mode: Mode) => mode === "push" ? node.nextNodes : node.previousNodes;
function exploreThroughputOf(node: Node, mode: Mode, startingThroughput: number, visitedNodes: Id[]): ExploreResult {
	let rate = getRateOf(node, mode) + startingThroughput;
	const result: ExploreResult = { pushed: 0, pulled: 0 };
	const nextNodes = getNextNodesOf(node, mode);
	for (const nextNode of nextNodes) {
		if (visitedNodes.includes(nextNode.node.node.id)) {
			continue;
		}
		visitedNodes.push(nextNode.node.node.id);
		const consumedRate = getInvRateOf(nextNode.node, mode);
		const newRate = Math.max(0, rate - consumedRate);
		const rateChange = rate - newRate;
		rate = newRate;

		const nextResult = exploreThroughputOf(nextNode.node, mode, rate, visitedNodes);
		if (mode === "push") {
			nextResult.pushed += rateChange;
			nextNode.throughput.pushed += nextResult.pushed;
			result.pushed += nextResult.pushed;
		} else if (mode === "pull") {
			nextResult.pulled += rateChange;
			nextNode.throughput.pulled += nextResult.pulled;
			result.pulled += nextResult.pulled;
		} else {
			assertUnreachable(mode);
		}
	}

	return result;
}


function dumpLeftOverThroughput(node: Node, mode: Mode, result: ExploreResult) {
	const throughputDelta = {
		pushed: node.pushed - result.pushed,
		pulled: node.pulled - result.pulled,
	};
	if (throughputDelta.pushed === 0 && throughputDelta.pulled === 0) {
		return;
	}
	const visitedNodes: Id[] = [node.node.id];
	let head: LinkedNode|undefined = getNextNodesOf(node, mode)[0];
	while (head && !visitedNodes.includes(head.node.node.id)) {
		visitedNodes.push(head.node.node.id);
		head.throughput.pushed += throughputDelta.pushed;
		head.throughput.pulled += throughputDelta.pulled;
		head = getNextNodesOf(head.node, mode)[0];
	}
}

function autoSetMultiplier(page: GraphPage, node: Node) {
	const parent = page.nodes.get(node.node.parentNode!);
	if (parent?.properties.type !== "production") {
		return;
	}
	const mode = node.consumeAll!;
	let rate = 0;
	const nextNodes = getNextNodesOf(node, mode);
	for (const node of nextNodes) {
		rate += getInvRateOf(node.throughput, mode);
	}
	parent.properties.multiplier = rate;
}

function generateNodeNetwork(page: GraphPage, nodes: Map<string, Node>, pushNodes: Node[], pullNodes: Node[], autoNodes: Node[], edges: LinkedNode[]) {
	for (const node of page.nodes.values()) {
		if (node.properties.type === "production") {
			if (node.properties.details.type === "recipe") {
				const recipe = satisfactoryDatabase.recipes[node.properties.details.recipeClassName];
				if (!recipe) continue;
				for (const jointInfo of node.properties.resourceJoints) {
					const joint = page.nodes.get(jointInfo.id) as GraphNode<GraphNodeResourceJointProperties> | undefined;
					if (!joint) continue;
					const recipePart = recipe.inputs.find(i => i.itemClass === joint.properties.resourceClassName)
						??
						recipe.outputs.find(o => o.itemClass === joint.properties.resourceClassName);
					if (!recipePart) continue;
					const rate = recipePart.amountPerMinute * node.properties.multiplier;
					const type = jointInfo.type;
					const newNode: Node = defaultNode(joint, { pushed: type === "output" ? rate : 0, pulled: type === "input" ? rate : 0 });
					nodes.set(joint.id, newNode);
					if (type === "output") {
						pushNodes.push(newNode);
					} else if (type === "input") {
						pullNodes.push(newNode);
					} else {
						assertUnreachable(type);
					}
				}
			} else if (node.properties.details.type === "extraction") {
				const productionBuilding = satisfactoryDatabase.productionBuildings[node.properties.details.buildingClassName];
				if (!productionBuilding) continue;
				const joint = page.nodes.get(node.properties.resourceJoints[0]?.id);
				if (!joint) continue;
				const purityModifier = node.properties.details.purityModifier ?? 1;
				const rate = productionBuilding.baseProductionRate * purityModifier * node.properties.multiplier;
				const newNode: Node = defaultNode(joint, { pushed: rate });
				nodes.set(joint.id, newNode);
				pushNodes.push(newNode);
			} else if (node.properties.details.type === "factory-input" || node.properties.details.type === "factory-output") {
				const joint = page.nodes.get(node.properties.resourceJoints[0]?.id);
				if (!joint) continue;
				const type = node.properties.details.type === "factory-input" ? "input" : "output";
				const rate = node.properties.multiplier;
				let consumeAll: Mode | null = null;
				if (node.properties.autoMultiplier) {
					consumeAll = node.properties.details.type === "factory-input" ? "push" : "pull";
				}
				const newNode: Node = defaultNode(joint, { pushed: type === "input" ? rate : 0, pulled: type === "output" ? rate : 0, consumeAll });
				nodes.set(joint.id, newNode);
				if (node.properties.autoMultiplier) {
					autoNodes.push(newNode);
				} else {
					if (type === "output") {
						pullNodes.push(newNode);
					} else if (type === "input") {
						pushNodes.push(newNode);
					} else {
						assertUnreachable(type);
					}
				}
			} else if (node.properties.details.type === "factory-reference") {
				const extPageId = node.properties.details.factoryId;
				const extPage = page.context.appState.pages.find(p => p.id === extPageId);
				if (!extPage) continue;
				for (const jointInfo of node.properties.resourceJoints) {
					const joint = page.nodes.get(jointInfo.id) as GraphNode<GraphNodeResourceJointProperties> | undefined;
					if (!joint) continue;
					const extNodeId = node.properties.details.jointsToExternalNodes[joint.id];
					if (!extNodeId) continue;
					const extNode = extPage.nodes.get(extNodeId);
					if (!extNode) continue;
					if (extNode.properties.type !== "production") continue;
					const rate = extNode.properties.multiplier;
					const type = jointInfo.type;
					const newNode: Node = defaultNode(joint, { pushed: type === "output" ? rate : 0, pulled: type === "input" ? rate : 0 });
					nodes.set(joint.id, newNode);
					if (type === "output") {
						pushNodes.push(newNode);
					} else if (type === "input") {
						pullNodes.push(newNode);
					} else {
						assertUnreachable(type);
					}
				}
			} else {
				assertUnreachable(node.properties.details.type);
			}
		} else if (node.properties.type === "merger" || node.properties.type === "splitter") {
			const newNode: Node = defaultNode(node, {});
			nodes.set(node.id, newNode);
		}
	}

	for (const edge of page.edges.values()) {
		const startNode = nodes.get(edge.startNodeId);
		const endNode = nodes.get(edge.endNodeId);
		if (!startNode || !endNode) continue;
		const throughput = { pushed: 0, pulled: 0 };
		const linkedNextNode: LinkedNode = {
			node: endNode,
			edge: edge,
			throughput,
		};
		const linkedPreviousNode: LinkedNode = {
			node: startNode,
			edge: edge,
			throughput,
		};
		startNode.nextNodes.push(linkedNextNode);
		endNode.previousNodes.push(linkedPreviousNode);
		edges.push(linkedNextNode);
		edges.push(linkedPreviousNode);
	}
}

