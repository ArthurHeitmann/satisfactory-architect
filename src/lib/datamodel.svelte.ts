
/*
- next id
- last page id
- pages
	- id [S]
	- name
	- view
		- offset
		- scale
 	- nodes
		- id [S]
		- node type
		- edges
			- id [S]
		- properties
	- edges
		- id [S]
		- type
		- start node id
		- end node id
		- properties
*/

import { SvelteMap, SvelteSet } from "svelte/reactivity";

type Id = string;

export class AppState {
	private lastId: number;
	private currentPageId: Id;
	currentPage: GraphPage;
	pages: GraphPage[];

	constructor(nextId: number, currentPageId: Id, pages: GraphPage[]) {
		this.lastId = nextId;
		this.currentPageId = $state(currentPageId);
		this.pages = $state(pages);
		this.currentPage = $derived(this.pages.find((p) => p.id === this.currentPageId)!);
	}

	static newDefault(): AppState {
		const page = GraphPage.newDefault("0");
		return new AppState(1, page.id, [page]);
	}

	static fromJSON(json: any): AppState {
		const pages = json.pages.map((p: any) => GraphPage.fromJSON(p));
		return new AppState(Number(json.nextId), json.currentPageId, pages);
	}

	toJSON(): any {
		return {
			nextId: this.lastId.toString(),
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
			throw new Error("Cannot remove the last page.");
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

	nextId(): Id {
		const id = this.lastId.toString();
		this.lastId += 1;
		return id;
	}
}

export class GraphPage {
	readonly id: Id;
	name: string;
	readonly view: GraphView;
	readonly nodes: SvelteMap<Id, GraphNode>;
	readonly edges: SvelteMap<Id, GraphEdge>;

	constructor(id: Id, name: string, view: GraphView, nodes: GraphNode[], edges: GraphEdge[]) {
		this.id = id;
		this.name = $state(name);
		this.view = view;
		this.nodes = new SvelteMap(nodes.map((n) => [n.id, n]));
		this.edges = new SvelteMap(edges.map((e) => [e.id, e]));
	}

	static newDefault(id: string, name: string = "New Page"): GraphPage {
		const view = GraphView.newDefault();
		return new GraphPage(id, name, view, [], []);
	}

	static fromJSON(json: any): GraphPage {
		const view = GraphView.fromJSON(json.view);
		const nodes = json.nodes.map((n: any) => GraphNode.fromJSON(n));
		const edges = json.edges.map((e: any) => GraphEdge.fromJSON(e));
		return new GraphPage(json.id, json.name, view, nodes, edges);
	}

	toJSON(): any {
		return {
			id: this.id,
			name: this.name,
			view: this.view.toJSON(),
			nodes: this.nodes.values().map((n) => n.toJSON()),
			edges: this.edges.values().map((e) => e.toJSON()),
		};
	}

	addNode(node: GraphNode): void {
		if (this.nodes.has(node.id)) {
			throw new Error(`Node with id ${node.id} already exists.`);
		}
		this.nodes.set(node.id, node);
	}

	removeNode(nodeId: Id): void {
		if (!this.nodes.has(nodeId)) {
			throw new Error(`Node with id ${nodeId} does not exist.`);
		}
		this.nodes.delete(nodeId);
	}

	addEdge(edge: GraphEdge): void {
		if (this.edges.has(edge.id)) {
			throw new Error(`Edge with id ${edge.id} already exists.`);
		}
		this.edges.set(edge.id, edge);
	}

	addEdgeBetweenNodes(edge: GraphEdge, startNode: GraphNode, endNode: GraphNode): void {
		if (!this.nodes.has(startNode.id) || !this.nodes.has(endNode.id)) {
			throw new Error("Both start and end nodes must exist in the page.");
		}
		if (this.edges.has(edge.id)) {
			throw new Error(`Edge with id ${edge.id} already exists.`);
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
		this.edges.delete(edgeId);
	}
}

export class GraphView {
	readonly offset: { x: number; y: number };
	scale: number;

	constructor(offset: { x: number; y: number }, scale: number) {
		this.offset = $state(offset);
		this.scale = $state(scale);
	}

	static newDefault(): GraphView {
		return new GraphView({ x: 0, y: 0 }, 1);
	}

	static fromJSON(json: any): GraphView {
		return new GraphView(json.offset, json.scale);
	}

	toJSON(): any {
		return {
			offset: this.offset,
			scale: this.scale,
		};
	}
}

export class Vector2D {
	x: number;
	y: number;

	constructor(x: number, y: number) {
		this.x = $state(x);
		this.y = $state(y);
	}

	static fromJSON(json: any): Vector2D {
		return new Vector2D(json.x, json.y);
	}

	toJSON(): any {
		return {
			x: this.x,
			y: this.y,
		};
	}
}

export class GraphNode {
	readonly id: Id;
	type: string;
	readonly position: Vector2D;
	edges: SvelteSet<Id>;
	readonly properties: SvelteMap<string, any>;

	constructor(id: Id, type: string, position: [number, number], edges: Id[], properties: Record<string, any>) {
		this.id = id;
		this.type = $state(type);
		this.position = new Vector2D(position[0], position[1]);
		this.edges = new SvelteSet(edges);
		this.properties = new SvelteMap(Object.entries(properties));
	}

	static fromJSON(json: any): GraphNode {
		return new GraphNode(
			json.id,
			json.type,
			[json.position.x, json.position.y],
			json.edges,
			json.properties
		);
	}

	toJSON(): any {
		return {
			id: this.id,
			type: this.type,
			position: this.position.toJSON(),
			edges: this.edges,
			properties: this.properties,
		};
	}
}

export class GraphEdge {
	readonly id: Id;
	type: string;
	startNodeId: Id;
	endNodeId: Id;
	readonly properties: SvelteMap<string, any>;

	constructor(id: Id, type: string, startNodeId: Id, endNodeId: Id, properties: Record<string, any>) {
		this.id = id;
		this.type = $state(type);
		this.startNodeId = $state(startNodeId);
		this.endNodeId = $state(endNodeId);
		this.properties = new SvelteMap(Object.entries(properties));
	}

	static fromJSON(json: any): GraphEdge {
		return new GraphEdge(json.id, json.type, json.startNodeId, json.endNodeId, json.properties);
	}

	toJSON(): any {
		return {
			id: this.id,
			type: this.type,
			startNodeId: this.startNodeId,
			endNodeId: this.endNodeId,
			properties: this.properties,
		};
	}
}
