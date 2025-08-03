import { EventStream } from "$lib/EventStream.svelte";
import { assertUnreachable, copyText } from "$lib/utilties";
import { untrack } from "svelte";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { type IdGen, type Id, IdMapper, type PasteSource } from "./IdGen";
import { dataModelVersion, NodePriorities } from "./constants";
import { isNodeAttachable } from "./nodeTypeProperties.svelte";
import { applyJsonToMap, applyJsonToSet, StateHistory, type JsonSerializable } from "./StateHistory.svelte";
import { GraphEdge } from "./GraphEdge.svelte";
import { type LayoutOrientation, GraphNode, type GraphNodeResourceJointProperties, type NewNodeDetails, type GraphNodeSplitterMergerProperties, type ProductionDetails, type JointDragType } from "./GraphNode.svelte";
import { GraphView, type IVector2D } from "./GraphView.svelte";
import type { AppState } from "./AppState.svelte";

export type PageContext = {
	appState: AppState,
	page: GraphPage,
};

export const oppositeLayoutOrientation: Record<LayoutOrientation, LayoutOrientation> = {
	"top": "bottom",
	"bottom": "top",
	"left": "right",
	"right": "left",
};
export type NodeHighlightType = "attachable" | "hovered";
export class GraphPage implements JsonSerializable<PageContext> {
	readonly context: PageContext;
	readonly idGen: IdGen;
	readonly id: Id;
	name: string;
	readonly view: GraphView;
	readonly nodes: SvelteMap<Id, GraphNode>;
	readonly edges: SvelteMap<Id, GraphEdge>;
	readonly selectedNodes: SvelteSet<Id>;
	readonly selectedEdges: SvelteSet<Id>;
	readonly history: StateHistory<PageContext>;
	readonly highlightedNodes: Record<NodeHighlightType, SvelteSet<Id>>;
	userEventsPriorityNodeId: Id | null;

	constructor(appState: AppState, id: Id, name: string, view: GraphView, nodes: GraphNode[], edges: GraphEdge[]) {
		this.context = { appState, page: this };
		this.idGen = appState.idGen;
		this.id = id;
		this.name = $state(name);
		this.view = view;
		this.nodes = new SvelteMap(nodes.map((n) => [n.id, n]));
		this.edges = new SvelteMap(edges.map((e) => [e.id, e]));
		this.selectedNodes = new SvelteSet();
		this.selectedEdges = new SvelteSet();
		this.history = new StateHistory(this, this.context);
		this.highlightedNodes = {
			attachable: new SvelteSet(),
			hovered: new SvelteSet(),
		};
		this.userEventsPriorityNodeId = $state(null);
	}

	static newDefault(appState: AppState, name: string = "New Page"): GraphPage {
		const view = GraphView.newDefault();
		return new GraphPage(appState, appState.idGen.nextId(), name, view, [], []);
	}

	static fromJSON(appState: AppState, json: any): GraphPage {
		const view = GraphView.fromJSON(json.view);
		const page = new GraphPage(appState, json.id, json.name, view, [], []);
		const nodes = Object.values(json.nodes).map((n: any) => GraphNode.fromJSON(n, page.context));
		for (const node of nodes) {
			page.nodes.set(node.id, node);
		}
		for (const [edgeId, edgeJson] of Object.entries(json.edges)) {
			const edge = GraphEdge.fromJSON(edgeJson, page.context);
			page.edges.set(edgeId, edge);
		}
		return page;
	}

	applyJson(json: any): void {
		// if (json.version !== dataModelVersion) {
		// 	throw new Error(`Unsupported data model version: ${json.version}. Expected: ${dataModelVersion}`);
		// }
		this.name = json.name;
		applyJsonToMap(json.nodes, this.nodes, GraphNode.fromJSON, this.context);
		applyJsonToMap(json.edges, this.edges, GraphEdge.fromJSON, this.context);
		applyJsonToSet(json.selectedNodes, this.selectedNodes);
	}

	toJSON(): any {
		return {
			version: dataModelVersion,
			id: this.id,
			name: this.name,
			view: untrack(() => this.view.toJSON()),
			nodes: Object.fromEntries(this.nodes.entries().map(([k, n]) => [k, n.toJSON()])),
			edges: Object.fromEntries(this.edges.entries().map(([k, e]) => [k, e.toJSON()])),
			selectedNodes: Array.from(this.selectedNodes),
		};
	}

	addNodes(...nodes: GraphNode[]): void {
		for (const node of nodes) {
			if (this.nodes.has(node.id)) {
				throw new Error(`Node with id ${node.id} already exists.`);
			}
			this.nodes.set(node.id, node);
		}
	}

	removeNode(nodeId: Id): void {
		if (!this.nodes.has(nodeId)) {
			throw new Error(`Node with id ${nodeId} does not exist.`);
		}
		const node = this.nodes.get(nodeId);
		if (node) {
			for (const childId of node.children) {
				const childNode = this.nodes.get(childId);
				if (childNode) {
					this.removeNode(childId);
				}
			}
			for (const edgeId of node.edges) {
				this.removeEdge(edgeId);
			}
		}
		this.nodes.delete(nodeId);
		this.selectedNodes.delete(nodeId);
	}

	removeSelectedNodes(): void {
		for (const nodeId of this.selectedNodes) {
			this.removeNode(nodeId);
		}
		this.selectedNodes.clear();
	}

	removeSelectedEdges(): void {
		for (const edgeId of this.selectedEdges) {
			this.removeEdge(edgeId);
		}
		this.selectedEdges.clear();
	}

	removeSelectedNodesAndEdges(): void {
		this.removeSelectedNodes();
		this.removeSelectedEdges();
	}

	addChildrenToNode(parentNode: GraphNode, ...childNodes: GraphNode[]): void {
		if (!this.nodes.has(parentNode.id)) {
			throw new Error("Parent node must exist in the this.");
		}
		for (const childNode of childNodes) {
			if (childNode.parentNode !== null) {
				throw new Error(`Child node ${childNode.id} already has a parent.`);
			}
			parentNode.children.add(childNode.id);
			childNode.parentNode = parentNode.id;
		}
	}

	addEdge(edge: GraphEdge): void {
		if (this.edges.has(edge.id)) {
			throw new Error(`Edge with id ${edge.id} already exists.`);
		}
		this.edges.set(edge.id, edge);
	}

	addEdgeBetweenNodes(edge: GraphEdge, startNode: GraphNode, endNode: GraphNode): void {
		this.edges.set(edge.id, edge);
		edge.connectNode(startNode, "start", this);
		edge.connectNode(endNode, "end", this);
	}

	removeEdge(edgeId: Id): void {
		if (!this.edges.has(edgeId)) {
			throw new Error(`Edge with id ${edgeId} does not exist.`);
		}
		const edge = this.edges.get(edgeId)!;
		const startNode = this.nodes.get(edge.startNodeId);
		const endNode = this.nodes.get(edge.endNodeId);
		if (startNode) {
			startNode.edges.delete(edge.id);
		}
		if (endNode) {
			endNode.edges.delete(edge.id);
		}
		this.edges.delete(edgeId);
	}

	moveSelectedNodes(totalDeltaX: number, totalDeltaY: number): void {
		for (const nodeId of this.selectedNodes) {
			const node = this.nodes.get(nodeId);
			if (node) {
				this.moveNode(node, totalDeltaX, totalDeltaY);
			}
		}
	}

	startMovingSelectedNodes(): void {
		for (const nodeId of this.selectedNodes) {
			const node = this.nodes.get(nodeId);
			if (node) {
				this.startMovingNode(node);
			}
		}
	}

	startMovingNode(node: GraphNode): void {
		node.onDragStart();
	}

	clearHighlightedNodes(): void {
		for (const nodes of Object.values(this.highlightedNodes)) {
			nodes.clear();
		}
	}

	getResourceJointAttachableNodes(movingNode: GraphNode<GraphNodeResourceJointProperties>): GraphNode[] {
		const originalNode = this.nodes.get(movingNode.properties.dragStartNodeId!)!;
		const ignoreNodeIds = new Set([movingNode.id]);
		const ignoreEdges = [...movingNode.edges, ...originalNode.edges];
		if (movingNode.edges.size >= 1) {
			const edge = this.edges.get(movingNode.edges.values().next().value!);
			if (edge) {
				let otherNodeId: Id | undefined;
				if (edge.startNodeId === movingNode.id) {
					otherNodeId = edge.endNodeId;
				} else if (edge.endNodeId === movingNode.id) {
					otherNodeId = edge.startNodeId;
				}
				const otherNode = otherNodeId ? this.nodes.get(otherNodeId) : undefined;
				if (otherNode) {
					ignoreEdges.push(...otherNode.edges);
				}
			}
		}
		for (const edgeIds of ignoreEdges) {
			const edge = this.edges.get(edgeIds);
			if (!edge) {
				continue;
			}
			for (const otherNodeId of [edge.startNodeId, edge.endNodeId]) {
				ignoreNodeIds.add(otherNodeId);
			}
		}
		
		const isOutput = movingNode.properties.jointType === "output";
		const attachableNodes: GraphNode[] = [];
		for (const node of this.nodes.values()) {
			if (ignoreNodeIds.has(node.id)) {
				continue;
			}
			if (!isNodeAttachable(node)) {
				continue;
			}
			const properties = node.properties;
			if ("resourceClassName" in properties) {
				if (properties.resourceClassName !== movingNode.properties.resourceClassName) {
					continue;
				}
				if (properties.type === "resource-joint") {
					if (properties.jointType !== movingNode.properties.jointType) {
						continue;
					}
				} else if (properties.type === "splitter" || properties.type === "merger") {
					const attachedEdges = Array.from(node.edges.values()
						.map(edgeId => this.edges.get(edgeId))
						.filter(edge => edge !== undefined));
					const incomingEdges = attachedEdges.filter(edge => edge.endNodeId === node.id).length;
					const outgoingEdges = attachedEdges.filter(edge => edge.startNodeId === node.id).length;
					if (properties.type === "splitter" && incomingEdges >= 1 && !isOutput) {
						continue;
					} else if (properties.type === "merger" && outgoingEdges >= 1 && isOutput) {
						continue;
					}
				} else {
					assertUnreachable(properties.type);
				}
				attachableNodes.push(node as GraphNode);
			}
			else {
				continue;
			}
		}

		return attachableNodes;
	}

	startMovingRecipeResourceJoint(
		node: GraphNode,
		position: IVector2D,
		jointType: "input" | "output",
		jointDragType: JointDragType,
		resourceClassName: string,
		layoutOrientation?: LayoutOrientation,
	): GraphNode<GraphNodeResourceJointProperties> {
		const newNode = new GraphNode<GraphNodeResourceJointProperties>(
			this.idGen.nextId(),
			this.context,
			position,
			NodePriorities.TOP_LEVEL,
			[],
			null,
			[],
			{
				type: "resource-joint",
				resourceClassName: resourceClassName,
				jointType: jointType === "input" ? "output" : "input",
				layoutOrientation: oppositeLayoutOrientation[layoutOrientation!],
				locked: false,
				jointDragType: jointDragType,
				dragStartNodeId: node.id,
			}
		);
		this.addNodes(newNode);
		this.addEdgeBetweenNodes(
			new GraphEdge(this.context, this.idGen.nextId(), "item-flow", "", "", { displayType: "curved", isDrainLine: false }),
			jointType === "input" ? newNode : node,
			jointType === "input" ? node : newNode
		);
		newNode.onDragStart();
		return newNode;
	}

	onResourceJointDragEnd(node: GraphNode) {
		if (node.edges.size <= 1) {
			this.removeNode(node.id);
		}
	}
	
	connectResourceJoints(movingNode: GraphNode, destNode: GraphNode) {
		const movingEdge = this.edges.get(movingNode.edges.values().next().value!);
		if (!movingEdge) {
			throw new Error("Moving node does not have an edge.");
		}
		let otherNode: GraphNode|undefined;
		if (movingEdge.startNodeId === movingNode.id) {
			otherNode = this.nodes.get(movingEdge.endNodeId);
			movingEdge.connectNode(destNode, "start", this);
		} else if (movingEdge.endNodeId === movingNode.id) {
			otherNode = this.nodes.get(movingEdge.startNodeId);
			movingEdge.connectNode(destNode, "end", this);
		} else {
			throw new Error("Moving node is not connected to the edge.");
		}
		movingNode.edges.delete(movingEdge.id);
		if (movingNode.edges.size === 0) {
			this.removeNode(movingNode.id);
		}
		destNode.edges.add(movingEdge.id);

		if (destNode.parentNode && destNode.parentNode === otherNode?.parentNode) {
			movingEdge.properties.displayType = "angled";
		}
	}

	moveNode(node: GraphNode, totalDeltaX: number, totalDeltaY: number) {
		node.move(totalDeltaX, totalDeltaY, this.view.gridSnap);
	}

	selectNode(node: GraphNode): void {
		this.selectedNodes.clear();
		this.selectedNodes.add(node.id);
	}

	toggleNodeSelection(node: GraphNode): void {
		if (this.selectedNodes.has(node.id)) {
			this.selectedNodes.delete(node.id);
		} else {
			this.selectedNodes.add(node.id);
		}
	}

	selectEdge(edge: GraphEdge): void {
		this.selectedEdges.clear();
		this.selectedEdges.add(edge.id);
	}

	toggleEdgeSelection(edge: GraphEdge): void {
		if (this.selectedEdges.has(edge.id)) {
			this.selectedEdges.delete(edge.id);
		} else {
			this.selectedEdges.add(edge.id);
		}
	}

	clearAllSelection(): void {
		this.selectedNodes.clear();
		this.selectedEdges.clear();
	}

	screenToPageCoords(screen: IVector2D): IVector2D {
		const graphX = (screen.x - this.view.offset.x) / this.view.scale;
		const graphY = (screen.y - this.view.offset.y) / this.view.scale;
		return { x: graphX, y: graphY };
	}

	makeProductionNode(productionDetails: NewNodeDetails, position: IVector2D): GraphNode {
		if (productionDetails.type === "splitter" || productionDetails.type === "merger") {
			const node = new GraphNode<GraphNodeSplitterMergerProperties>(
				this.idGen.nextId(),
				this.context,
				{x: 0, y: 0},
				NodePriorities.OTHER,
				[],
				null,
				[],
				productionDetails,
			);
			node.onDragStart();
			this.moveNode(node, position.x, position.y);
			this.addNodes(node);
			return node;
		}
		else {
			const {parent, children} = GraphNode.makeProductionNode(
				this.idGen,
				this.context,
				{x: 0, y: 0},
				[],
				productionDetails as ProductionDetails,
			);
			parent.onDragStart();
			this.moveNode(parent, position.x, position.y);
			this.addNodes(parent);
			for (const child of children) {
				this.addNodes(child);
				this.addChildrenToNode(parent, child);
			}
			return parent;
		}
	}

	copyOrCutSelection(mode: "copy" | "cut") {
		const selectedNodes = Array.from(this.selectedNodes.values()
			.map((id) => this.nodes.get(id)!));
		const selectedJointIds = new Set(selectedNodes
			.flatMap(n => Array.from(n.children.values())));
		const selectedJoints = Array.from(selectedJointIds.values()
			.map((id) => this.nodes.get(id))
			.filter(n => n !== undefined));
		const allNodes = [...selectedNodes, ...selectedJoints];
		const allNodeIds = new Set(allNodes.map(n => n.id));
		const selectedEdges = Array.from(this.edges.values()
			.filter(e => allNodeIds.has(e.startNodeId) && allNodeIds.has(e.endNodeId)));
		const json = {
			type: "factory-data",
			version: dataModelVersion,
			nodes: allNodes.map((n) => n.toJSON()),
			edges: selectedEdges.map((e) => e.toJSON()),
		};
		copyText(JSON.stringify(json));
		if (mode === "cut") {
			this.removeSelectedNodesAndEdges();
		}
	}

	insertJson(text: string, pasteSource: PasteSource, centerPoint?: IVector2D) {
		let data;
		try {
			data = JSON.parse(text);
		} catch {
			console.log("Not json data");
			return;
		}
		if (data.type !== "factory-data" || data.version !== dataModelVersion) {
			console.log("Unsupported data format or version");
			return;
		}
		const idMapper = new IdMapper(this.idGen);
		for (const item of [...data.nodes, ...data.edges]) {
			if ("id" in item) {
				item.id = idMapper.mapId(item.id);
			}
		}
		const nodes = (data.nodes as any[]).map((n: any) => GraphNode.fromJSON(n, this.context));
		const edges = (data.edges as any[]).map((e: any) => GraphEdge.fromJSON(e, this.context));
		for (const node of nodes) {
			node.afterPaste(idMapper, pasteSource);
			this.addNodes(node);
		}
		for (const edge of edges) {
			edge.afterPaste(idMapper);
			this.addEdge(edge);
		}

		if (centerPoint) {
			const nodesCenter: IVector2D = {x: 0, y: 0};
			let count = 0;
			for (const node of nodes) {
				if (node.parentNode !== null) {
					continue;
				}
				nodesCenter.x += node.position.x;
				nodesCenter.y += node.position.y;
				count++;
			}
			nodesCenter.x /= count;
			nodesCenter.y /= count;
			const deltaX = centerPoint.x - nodesCenter.x;
			const deltaY = centerPoint.y - nodesCenter.y;
			for (const node of nodes) {
				if (node.parentNode !== null) {
					continue;
				}
				node.position.x += deltaX;
				node.position.y += deltaY;
			}
		}
	}
}
