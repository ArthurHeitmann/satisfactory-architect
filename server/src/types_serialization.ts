/**
 * Shared serialization schemas for application state
 * These types match the toJSON() output from the UI datamodel classes
 */

/**
 * ID type - IDs are always strings
 */
export type Id = string;

/**
 * 2D vector/position
 */
export interface IVector2D {
	x: number;
	y: number;
}

/**
 * Graph view serialization (camera/viewport state)
 */
export interface GraphViewJson {
	pos: IVector2D;
	zoom: number;
}

/**
 * Graph node serialization
 */
export interface GraphNodeJson {
	id: Id;
	position: IVector2D;
	priority: number;
	edges: Id[];
	parentNode: Id | null;
	children: Id[];
	properties: unknown;
	size: IVector2D;
}

/**
 * Graph edge serialization
 */
export interface GraphEdgeJson {
	id: Id;
	type: string;
	startNodeId: Id;
	endNodeId: Id;
	properties: unknown;
}

/**
 * Graph page serialization
 */
export interface GraphPageJson {
	version: number;
	type: "graph-page";
	id: Id;
	name: string;
	icon: string;
	view: GraphViewJson;
	nodes: Record<Id, GraphNodeJson>;
	edges: Record<Id, GraphEdgeJson>;
	toolMode: string;
	selectedNodes: Id[];
	selectedEdges: Id[];
}

/**
 * Application state serialization (root)
 */
export interface AppStateJson {
	version: number;
	type: string;
	idGen: string; // Serialized as string representation of number
	currentPageId: Id;
	pages: GraphPageJson[];
}
