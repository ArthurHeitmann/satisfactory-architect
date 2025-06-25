import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { untrack } from "svelte";
import { type JsonSerializable, StateHistory, type JsonElement } from "./StateHistory.svelte";
import { EventStream } from "../../EventStream.svelte";
import { IdGen, type Id } from "./IdGen";
import { satisfactoryDatabase } from "$lib/satisfactoryDatabase";
import { ceilToNearest, floorToNearest, roundToNearest } from "$lib/utilties";
import { gridSize, NodePriorities } from "./layoutConstants";


export class AppState {
	readonly idGen: IdGen;
	private currentPageId: Id;
	currentPage: GraphPage;
	pages: GraphPage[];

	constructor(idGen: IdGen, currentPageId: Id, pages: GraphPage[]) {
		this.idGen = idGen;
		this.currentPageId = $state(currentPageId);
		this.pages = $state.raw(pages);
		this.currentPage = $derived(this.pages.find((p) => p.id === this.currentPageId)!);
	}

	static newDefault(): AppState {
		const idGen = new IdGen(0);
		const page = GraphPage.newDefault(idGen, "Page 1");
		return new AppState(idGen, page.id, [page]);
	}

	static fromJSON(json: any): AppState {
		const idGen = IdGen.fromJson(json.idGen);
		const pages = json.pages.map((p: any) => GraphPage.fromJSON(idGen, p));
		return new AppState(idGen, json.currentPageId, pages);
	}

	toJSON(): any {
		return {
			idGen: this.idGen.toJSON(),
			currentPageId: this.currentPageId,
			pages: this.pages.map((p) => p.toJSON()),
		};
	}

	addPage(page: GraphPage): void {
		if (this.pages.some((p) => p.id === page.id)) {
			throw new Error(`Page with id ${page.id} already exists.`);
		}
		this.pages.push(page);
	}

	removePage(pageId: Id): void {
		if (this.pages.length === 1) {
			throw new Error("Cannot remove the last this.");
		}
		this.pages = this.pages.filter((p) => p.id !== pageId);
		if (this.currentPageId === pageId && this.pages.length > 0) {
			this.currentPageId = this.pages[0].id;
		}
	}

	setCurrentPage(page: GraphPage): void {
		if (!this.pages.some((p) => p.id === page.id)) {
			throw new Error(`Page with id ${page.id} does not exist.`);
		}
		this.currentPageId = page.id;
	}
}

export class GraphPage implements JsonSerializable {
	readonly idGen: IdGen;
	readonly id: Id;
	name: string;
	readonly view: GraphView;
	readonly nodes: SvelteMap<Id, GraphNode>;
	readonly edges: SvelteMap<Id, GraphEdge>;
	readonly selectedNodes: SvelteSet<Id>;
	readonly history: StateHistory;
	readonly eventStream: EventStream;

	constructor(idGen: IdGen, id: Id, name: string, view: GraphView, nodes: GraphNode[], edges: GraphEdge[]) {
		this.idGen = idGen;
		this.id = id;
		this.name = $state(name);
		this.view = view;
		this.nodes = new SvelteMap(nodes.map((n) => [n.id, n]));
		this.edges = new SvelteMap(edges.map((e) => [e.id, e]));
		this.selectedNodes = new SvelteSet();
		this.history = new StateHistory(this);
		this.eventStream = new EventStream();
	}

	static newDefault(idGen: IdGen, name: string = "New Page"): GraphPage {
		const view = GraphView.newDefault();
		return new GraphPage(idGen, idGen.nextId(), name, view, [], []);
	}

	static fromJSON(idGen: IdGen, json: any): GraphPage {
		const view = GraphView.fromJSON(json.view);
		const nodes = json.nodes.values().map((n: any) => GraphNode.fromJSON(n));
		const edges = json.edges.values().map((e: any) => GraphEdge.fromJSON(e));
		return new GraphPage(idGen, json.id, json.name, view, nodes, edges);
	}

	applyJson(json: any): void {
		this.name = json.name;
		applyJsonToMap(json.nodes, this.nodes, GraphNode.fromJSON);
		applyJsonToMap(json.edges, this.edges, GraphEdge.fromJSON);
		applyJsonToSet(json.selectedNodes, this.selectedNodes);
	}

	toJSON(): any {
		return {
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
	}

	removeSelectedNodes(): void {
		for (const nodeId of this.selectedNodes) {
			this.removeNode(nodeId);
		}
		this.selectedNodes.clear();
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
		if (edge.startNodeId) {
			const prevStartNode = this.nodes.get(edge.startNodeId);
			if (prevStartNode) {
				prevStartNode.edges.delete(edge.id);
			}
		}
		if (edge.endNodeId) {
			const prevEndNode = this.nodes.get(edge.endNodeId);
			if (prevEndNode) {
				prevEndNode.edges.delete(edge.id);
			}
		}
		this.edges.set(edge.id, edge);
		edge.startNodeId = startNode.id;
		edge.endNodeId = endNode.id;
		startNode.edges.add(edge.id);
		endNode.edges.add(edge.id);
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

	startMovingRecipeResourceJoint(node: GraphNode<GraphNodeResourceJointProperties>, position: IVector2D): GraphNode<GraphNodeResourceJointProperties> {
		const newNode = new GraphNode<GraphNodeResourceJointProperties>(
			this.idGen.nextId(),
			position,
			NodePriorities.RESOURCE_JOINT,
			[],
			null,
			[],
			{
				type: "resource-joint",
				resourceClassName: node.properties.resourceClassName,
				jointType: node.properties.jointType === "input" ? "output" : "input",
				locked: false,
			}
		);
		this.addNodes(newNode);
		this.addEdgeBetweenNodes(
			new GraphEdge(this.idGen.nextId(), "default", "", "", {}),
			node.properties.jointType === "input" ? newNode : node,
			node.properties.jointType === "input" ? node : newNode
		);
		newNode.onDragStart();
		return newNode;
	}

	startMovingConnectedRecipeResourceJoint(node: GraphNode<GraphNodeResourceJointProperties>, position: IVector2D, edge: GraphEdge): GraphNode<GraphNodeResourceJointProperties> {
		let otherNode: GraphNode| undefined;
		if (edge.startNodeId === node.id) {
			otherNode = this.nodes.get(edge.endNodeId);
		} else if (edge.endNodeId === node.id) {
			otherNode = this.nodes.get(edge.startNodeId);
		}
		if (!otherNode) {
			throw new Error("Edge does not connect to the specified node.");
		}
		const newNode = new GraphNode<GraphNodeResourceJointProperties>(
			this.idGen.nextId(),
			position,
			NodePriorities.RESOURCE_JOINT,
			[],
			null,
			[],
			{
				type: "resource-joint",
				resourceClassName: node.properties.resourceClassName,
				jointType: node.properties.jointType,
				locked: false,
			}
		);
		this.addNodes(newNode);
		this.addEdgeBetweenNodes(
			edge,
			node.properties.jointType === "input" ? otherNode : newNode,
			node.properties.jointType === "input" ? newNode : otherNode
		);
		newNode.onDragStart();
		return newNode;
	}

	onResourceJointDragEnd(node: GraphNode<GraphNodeResourceJointProperties>) {
		if (node.edges.size <= 1) {
			this.removeNode(node.id);
		}
	}
    
	connectResourceJoints(movingNode: GraphNode<GraphNodeResourceJointProperties>, destNode: GraphNode<GraphNodeRecipeProperties>) {
        const movingEdge = this.edges.get(movingNode.edges.values().next().value!);
		if (!movingEdge) {
			throw new Error("Moving node does not have an edge.");
		}
		if (movingEdge.startNodeId === movingNode.id) {
			movingEdge.startNodeId = destNode.id;
		} else if (movingEdge.endNodeId === movingNode.id) {
			movingEdge.endNodeId = destNode.id;
		}
		movingNode.edges.delete(movingEdge.id);
		if (movingNode.edges.size === 0) {
			this.removeNode(movingNode.id);
		}
		destNode.edges.add(movingEdge.id);
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

	screenToGraphCoords(screen: IVector2D): IVector2D {
		const graphX = (screen.x - this.view.offset.x) / this.view.scale;
		const graphY = (screen.y - this.view.offset.y) / this.view.scale;
		return { x: graphX, y: graphY };
	}

	makeRecipeNode(recipe: string, position: IVector2D): GraphNode<GraphNodeRecipeProperties> {
		const {parent, children} = GraphNode.makeRecipeNode(
			this.idGen,
			{x: 0, y: 0},
			[],
			recipe,
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

export class GraphView {
	readonly offset: IVector2D;
	scale: number;
	enableGridSnap: boolean;
	gridSnap: number;

	constructor(offset: IVector2D, scale: number, enableGridSnap: boolean) {
		this.offset = $state(offset);
		this.scale = $state(scale);
		this.enableGridSnap = $state(enableGridSnap);
		this.gridSnap = $derived(this.enableGridSnap ? gridSize / 2 : 0);
	}

	static newDefault(): GraphView {
		return new GraphView({ x: 0, y: 0 }, 1, false);
	}

	static fromJSON(json: any): GraphView {
		return new GraphView(json.offset, json.scale, json.enableGridSnap);
	}

	toJSON(): any {
		return {
			offset: this.offset,
			scale: this.scale,
			enableGridSnap: this.enableGridSnap,
		};
	}
}

export interface IVector2D {
	x: number;
	y: number;
}

export class Vector2D {
	x: number;
	y: number;

	constructor(vector: IVector2D) {
		this.x = $state(vector.x);
		this.y = $state(vector.y);
	}

	static fromJSON(json: IVector2D): Vector2D {
		return new Vector2D(json);
	}

	applyJson(json: IVector2D): void {
		this.x = json.x;
		this.y = json.y;
	}

	toJSON(): IVector2D {
		return {
			x: this.x,
			y: this.y,
		};
	}
}

export type GraphNodeType = "recipe" | "resource-joint";
export interface GraphNodePropertiesBase {
	type: GraphNodeType;
}
export interface ResourceJointInfo {
	id: Id;
	type: "input" | "output";
}
export interface GraphNodeRecipeProperties extends GraphNodePropertiesBase {
	type: "recipe";
	recipeClassName: string;
	multiplier: number;
	nodeSize: { width: number; height: number; };
	resourceJoints: ResourceJointInfo[];
}
export interface GraphNodeResourceJointProperties extends GraphNodePropertiesBase {
	type: "resource-joint";
	resourceClassName: string;
	jointType: "input" | "output" | "middle";
	locked: boolean;
}
export type GraphNodeProperties = GraphNodePropertiesBase | GraphNodeRecipeProperties | GraphNodeResourceJointProperties;
export class GraphNode<T extends GraphNodeProperties = GraphNodeProperties> implements JsonSerializable {
	readonly id: Id;
	readonly position: Vector2D;
	private dragStartPosition: IVector2D;
	readonly priority: number;
	readonly edges: SvelteSet<Id>;
	parentNode: Id|null;
	readonly children: SvelteSet<Id>;
	readonly properties: T;

	constructor(id: Id, position: IVector2D, priority: number, edges: Id[], parentNode: Id|null, children: Id[], properties: T) {
		this.id = id;
		this.position = new Vector2D(position);
		this.dragStartPosition = { x: 0, y: 0 };
		this.priority = priority;
		this.edges = new SvelteSet(edges);
		this.parentNode = parentNode;
		this.children = new SvelteSet(children);
		this.properties = $state(properties);
	}

	static makeRecipeNode(
		idGen: IdGen,
		position: IVector2D,
		edges: Id[],
		recipeClassName: string,
		multiplier: number = 1,
	): {parent: GraphNode<GraphNodeRecipeProperties>, children: GraphNode<GraphNodeResourceJointProperties>[]} {
		const recipe = satisfactoryDatabase.recipes[recipeClassName];
		if (!recipe) {
			throw new Error(`Recipe with class name ${recipeClassName} does not exist.`);
		}
		const nodeSize = GraphNode.calcSizeFromRecipe(recipeClassName);
		const children: GraphNode<GraphNodeResourceJointProperties>[] = [];
		const resourceJoints: ResourceJointInfo[] = [];
		const inputsGapSize = floorToNearest(nodeSize.width / recipe.inputs.length, gridSize);
		const outputsGapSize = floorToNearest(nodeSize.width / recipe.outputs.length, gridSize);
		const inputsXStart = -inputsGapSize/2 * (recipe.inputs.length - 1)
		const outputsXStart = -outputsGapSize/2 * (recipe.outputs.length - 1)
		for (let i = 0; i < recipe.inputs.length; i++) {
			const input = recipe.inputs[i];
			const jointNode = new GraphNode(
				idGen.nextId(),
				{x: inputsXStart + inputsGapSize * i, y: -nodeSize.height / 2},
				NodePriorities.RESOURCE_JOINT,
				[],
				null,
				[],
				{
					type: "resource-joint",
					resourceClassName: input.itemClass,
					jointType: "input",
					locked: true,
				} as GraphNodeResourceJointProperties
			);
			children.push(jointNode);
			resourceJoints.push({ id: jointNode.id, type: "input" });
		}
		for (let i = 0; i < recipe.outputs.length; i++) {
			const output = recipe.outputs[i];
			const jointNode = new GraphNode(
				idGen.nextId(),
				{x:outputsXStart + outputsGapSize * i, y: nodeSize.height / 2},
				NodePriorities.RESOURCE_JOINT,
				[],
				null,
				[],
				{
					type: "resource-joint",
					resourceClassName: output.itemClass,
					jointType: "output",
					locked: true,
				} as GraphNodeResourceJointProperties
			);
			children.push(jointNode);
			resourceJoints.push({ id: jointNode.id, type: "output" });
		}
		const properties: GraphNodeRecipeProperties = {
			type: "recipe",
			recipeClassName,
			multiplier,
			nodeSize: nodeSize,
			resourceJoints: resourceJoints,
		};
		const parent = new GraphNode(idGen.nextId(), position, NodePriorities.RECIPE, edges, null, [], properties);
		return { parent, children };
	}

	static fromJSON(json: any): GraphNode {
		return new GraphNode(
			json.id,
			{ x: json.position.x, y: json.position.y },
			json.priority,
			json.edges,
			json.parentNode,
			json.children,
			json.properties
		);
	}

	applyJson(json: any): void {
		this.position.applyJson(json.position);
		applyJsonToSet(json.edges, this.edges);
		this.parentNode = json.parentNode;
		applyJsonToSet(json.children, this.children);
		applyJsonToObject(json.properties, this.properties as Record<string, any>);
	}

	toJSON(): any {
		return {
			id: this.id,
			position: this.position.toJSON(),
			priority: this.priority,
			edges: this.edges,
			parentNode: this.parentNode,
			children: Array.from(this.children),
			properties: $state.snapshot(this.properties),
		};
	}

	onDragStart(): void {
		this.dragStartPosition = { x: this.position.x, y: this.position.y };
	}

	move(totalDeltaX: number, totalDeltaY: number, gridSnap: number): void {
		this.position.x = roundToNearest(this.dragStartPosition.x + totalDeltaX, gridSnap);
		this.position.y = roundToNearest(this.dragStartPosition.y + totalDeltaY, gridSnap);
	}

	getAbsolutePosition(page: GraphPage): IVector2D {
		const parentNode = this.parentNode ? page.nodes.get(this.parentNode) : null;
		if (!parentNode) {
			return { x: this.position.x, y: this.position.y };
		}
		const parentPosition = parentNode.getAbsolutePosition(page);
		return {
			x: parentPosition.x + this.position.x,
			y: parentPosition.y + this.position.y,
		};
	}

	private static calcSizeFromRecipe(recipe: string): { width: number; height: number } {
		const edgePadding = 8;
		const iconSize = 48;
		const pxPerChar = 7.5;
		const recipeName = satisfactoryDatabase.recipes[recipe]?.recipeDisplayName ?? recipe;
		const width = edgePadding * 2 + iconSize * 2 + pxPerChar * recipeName.length;
		return { width: ceilToNearest(width, gridSize), height: gridSize * 2 };
	}
}

export type GraphEdgeType = "default";
export class GraphEdge implements JsonSerializable {
	readonly id: Id;
	type: GraphEdgeType;
	startNodeId: Id;
	endNodeId: Id;
	readonly properties: SvelteMap<string, any>;

	constructor(id: Id, type: GraphEdgeType, startNodeId: Id, endNodeId: Id, properties: Record<string, any>) {
		this.id = id;
		this.type = $state(type);
		this.startNodeId = $state(startNodeId);
		this.endNodeId = $state(endNodeId);
		this.properties = new SvelteMap(Object.entries(properties));
	}

	static fromJSON(json: any): GraphEdge {
		return new GraphEdge(json.id, json.type, json.startNodeId, json.endNodeId, json.properties);
	}

	applyJson(json: any): void {
		this.type = json.type;
		this.startNodeId = json.startNodeId;
		this.endNodeId = json.endNodeId;
		applyJsonToMap(json.properties, this.properties);
	}

	toJSON(): any {
		return {
			id: this.id,
			type: this.type,
			startNodeId: this.startNodeId,
			endNodeId: this.endNodeId,
			properties: Object.fromEntries(this.properties.entries()),
		};
	}
}


function applyJsonToMap(json: Record<string, JsonElement>, map: SvelteMap<string, JsonElement>): void;
function applyJsonToMap(json: Record<string, JsonElement>, map: SvelteMap<string, JsonSerializable>, makeFromJson: (json: JsonElement) => JsonSerializable): void;
function applyJsonToMap(json: Record<string, JsonElement>, map: SvelteMap<string, JsonElement|JsonSerializable>, makeFromJson?: (json: JsonElement) => JsonSerializable): void {
	const keysToRemove = map.keys().filter((key) => !(key in json));
	for (const key of keysToRemove) {
		map.delete(key);
	}
	for (const [key, value] of Object.entries(json)) {
		const existingValue = map.get(key);
		if (existingValue) {
			if (makeFromJson) {
				(existingValue as JsonSerializable).applyJson(value);
			}
			else {
				map.set(key, value);
			}
		} else {
			if (makeFromJson) {
				map.set(key, makeFromJson(value));
			} else {
				map.set(key, value);
			}
		}
	}
}

function applyJsonToSet(json: string[], set: SvelteSet<string>): void {
	set.clear();
	for (const value of json) {
		set.add(value);
	}
}

function applyJsonToObject(json: Record<string, JsonElement>, obj: Record<string, JsonElement>): void {
	for (const [key, value] of Object.entries(json)) {
		obj[key] = value;
	}
}
