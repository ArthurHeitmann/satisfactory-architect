import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import type { SFPowerFuel, SFRecipe } from "$lib/satisfactoryDatabaseTypes";
import { assertUnreachable } from "$lib/utilties";
import { blockStateChanges, globals, unblockStateChanges } from "./globals.svelte";
import type { GraphEdge } from "./GraphEdge.svelte";
import type { GraphNode, GraphNodeResourceJointProperties } from "./GraphNode.svelte";
import type { GraphPage } from "./GraphPage.svelte";
import type { Id } from "./IdGen";

type Mode = "push" | "pull";

interface Throughputs {
	pushed: number;
	pulled: number;
	isSaturated: boolean;
}
interface Node {
	node: GraphNode;
	nextNodes: LinkedNode[];
	previousNodes: LinkedNode[];
	mode: Mode|null;
	initialThroughput: number;
	usedThroughput: number;
	isSaturated: boolean;
	consumeAll: Mode | null;
}
function defaultNode(node: GraphNode, other: {mode: Mode|null, initialThroughput?: number, consumeAll?: Mode | null}): Node {
	return {
		node: node,
		nextNodes: [],
		previousNodes: [],
		initialThroughput: other.initialThroughput ?? 0,
		usedThroughput: 0,
		mode: other.mode,
		isSaturated: false,
		consumeAll: other.consumeAll ?? null,
	};
}

interface LinkedNode {
	node: Node;
	edge: GraphEdge;
	throughput: Throughputs;
}

export function calculateThroughputs(page: GraphPage) {
	blockStateChanges();
	try {
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
			const result = exploreThroughputOf(node, "push", 0, []);
			dumpLeftOverThroughput(node, "push", result);
		}
		for (const node of pullNodes) {
			const result = exploreThroughputOf(node, "pull", 0, []);
			dumpLeftOverThroughput(node, "pull", result);
		}
		for (const node of autoNodes) {
			autoSetMultiplier(page, node);
			exploreThroughputOf(node, node.consumeAll!, 0, []);
		}
		for (const edge of edges) {
			edge.edge.pushThroughput = edge.throughput.pushed;
			edge.edge.pullThroughput = edge.throughput.pulled;
		}
	} finally {
		unblockStateChanges();
	}
}

interface ExploreResult {
	used: number;
	isSaturated: boolean;
}
const getRateOf = (node: Node, mode: Mode) => node.mode === mode ? node.initialThroughput : 0;
const getInvRateOf = (node: Throughputs, mode: Mode) => mode === "push" ? node.pulled : node.pushed;
const getNextNodesOf = (node: Node, mode: Mode) => mode === "push" ? node.nextNodes : node.previousNodes;
function exploreThroughputOf(node: Node, mode: Mode, startingThroughput: number, visitedNodes: Id[]): ExploreResult {
	if (visitedNodes.includes(node.node.id)) {
		return { used: 0, isSaturated: true };
	}
	visitedNodes = [...visitedNodes, node.node.id];
	let rate = getRateOf(node, mode) + startingThroughput;
	const allNextNodes = getNextNodesOf(node, mode).toSorted((a, b) => {
		const aDrain = a.edge.properties.isDrainLine ? 1 : 0;
		const bDrain = b.edge.properties.isDrainLine ? 1 : 0;
		return aDrain - bDrain;
	});
	const result: ExploreResult = {
		used: 0,
		isSaturated: false,
	};
	let nextNodes = allNextNodes;
	let loops = 0;
	while (!result.isSaturated && rate > 0 && nextNodes.length > 0 && loops < 5) {
		loops++;
		const normalTotal = nextNodes.filter(n => !n.edge.properties.isDrainLine).length;
		const drainTotal = nextNodes.length - normalTotal;
		let normalI = 0;
		let drainI = 0;
		for (let i = 0; i < nextNodes.length; i++) {
			const nextNode = nextNodes[i];
			let ratio: number;
			if (nextNode.edge.properties.isDrainLine) {
				ratio = 1 / (drainTotal - drainI);
				drainI++;
			} else {
				ratio = 1 / (normalTotal - normalI);
				normalI++;
			}
			let nextResult: ExploreResult;
			if (nextNode.node.initialThroughput > 0 || nextNode.node.consumeAll) {
				let rateChange: number;
				if (nextNode.node.consumeAll) {
					rateChange = ratio * rate;
				} else {
					rateChange = Math.min(ratio * rate, nextNode.node.initialThroughput - nextNode.node.usedThroughput);
				}
				rate -= rateChange;
				nextNode.node.usedThroughput += rateChange;
				nextResult = {
					isSaturated: nextNode.node.initialThroughput === nextNode.node.usedThroughput,
					used: rateChange,
				};
			} else {
				nextResult = exploreThroughputOf(nextNode.node, mode, ratio * rate, visitedNodes);
				rate -= nextResult.used;
			}
			nextNode.throughput.isSaturated = nextResult.isSaturated;
			result.used += nextResult.used;
			if (mode === "push") {
				nextNode.throughput.pushed += nextResult.used;
			} else if (mode === "pull") {
				nextNode.throughput.pulled += nextResult.used;
			} else {
				assertUnreachable(mode);
			}
		}

		nextNodes = nextNodes.filter(n => !n.throughput.isSaturated);
		result.isSaturated = allNextNodes.every(n => n.throughput.isSaturated);
	}

	return result;
}


function dumpLeftOverThroughput(node: Node, mode: Mode, result: ExploreResult) {
	const throughputDelta = node.initialThroughput - result.used;
	if (throughputDelta === 0) {
		return;
	}
	const visitedNodes: Id[] = [node.node.id];
	let head: LinkedNode|undefined = getNextNodesOf(node, mode)[0];
	while (head && !visitedNodes.includes(head.node.node.id)) {
		visitedNodes.push(head.node.node.id);
		if (mode === "push") {
			head.throughput.pushed += throughputDelta;
		} else if (mode === "pull") {
			head.throughput.pulled += throughputDelta;
		} else {
			assertUnreachable(mode);
		}
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
			if (node.properties.details.type === "recipe" || node.properties.details.type === "power-production") {
				let recipe: SFRecipe|SFPowerFuel;
				if (node.properties.details.type === "recipe") {
					recipe = satisfactoryDatabase.recipes[node.properties.details.recipeClassName];
				} else {
					recipe = satisfactoryDatabase.powerProducers[node.properties.details.powerBuildingClassName]
						?.fuels[node.properties.details.fuelClassName];
				}
				if (!recipe) continue;
				for (const jointInfo of node.properties.resourceJoints) {
					const joint = page.nodes.get(jointInfo.id) as GraphNode<GraphNodeResourceJointProperties> | undefined;
					if (!joint) continue;
					const recipeParts = joint.properties.jointType === "input" ? recipe.inputs : recipe.outputs;
					const recipePart = recipeParts.find(o => o.itemClass === joint.properties.resourceClassName);
					if (!recipePart) continue;
					const rate = recipePart.amountPerMinute * node.properties.multiplier;
					const type = jointInfo.type;
					const mode = jointInfo.type === "input" ? "pull" : "push";
					const newNode: Node = defaultNode(joint, { initialThroughput: rate, mode });
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
				const productionBuilding = satisfactoryDatabase.extractionBuildings[node.properties.details.buildingClassName];
				if (!productionBuilding) continue;
				const joint = page.nodes.get(node.properties.resourceJoints[0]?.id);
				if (!joint) continue;
				const purityModifier = node.properties.details.purityModifier ?? 1;
				const rate = productionBuilding.baseProductionRate * purityModifier * node.properties.multiplier;
				const newNode: Node = defaultNode(joint, { initialThroughput: rate, mode: "push" });
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
				const mode = type === "input" ? "push" : "pull";
				const newNode: Node = defaultNode(joint, { initialThroughput: rate, mode, consumeAll });
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
					const mode = jointInfo.type === "input" ? "pull" : "push";
					const newNode: Node = defaultNode(joint, { initialThroughput: rate, mode });
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
			const newNode: Node = defaultNode(node, { mode: null });
			nodes.set(node.id, newNode);
		}
	}

	for (const edge of page.edges.values()) {
		const startNode = nodes.get(edge.startNodeId);
		const endNode = nodes.get(edge.endNodeId);
		if (!startNode || !endNode) continue;
		const throughput = { pushed: 0, pulled: 0, isSaturated: false };
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

