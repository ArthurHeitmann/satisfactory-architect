/**
 * Typed action descriptors for all 23 stress-test actions.
 *
 * Each action is described by `{ type, params }` where `params` is a
 * specialized interface per action type. The `Action` union covers
 * every variant.
 */

// ── Node creation ──────────────────────────────────────────────────

export interface CreateNodeAction {
	type: "createNode";
	params: {
		/** Screen-space position to double-click. */
		x: number;
		y: number;
		/** Recipe key to select from overlay. */
		recipeKey: string;
	};
}

export interface CreateSplitterMergerAction {
	type: "createSplitterMerger";
	params: {
		/** ID of the source joint to drag from. */
		sourceNodeId: string;
		/** Screen-space position to drop at (opens recipe overlay). */
		dropX: number;
		dropY: number;
		/** "splitter" or "merger" */
		nodeType: "splitter" | "merger";
	};
}

export interface CreateTextNoteAction {
	type: "createTextNote";
	params: {
		x: number;
		y: number;
		content: string;
	};
}

// ── Connections ────────────────────────────────────────────────────

export interface ConnectNodesAction {
	type: "connectNodes";
	params: {
		/** ID of the source joint/splitter/merger node. */
		sourceNodeId: string;
		/** ID of the destination joint/splitter/merger node. */
		destNodeId: string;
	};
}

export interface ConnectViaOverlayAction {
	type: "connectViaOverlay";
	params: {
		/** ID of the source joint to drag from. */
		sourceNodeId: string;
		/** Screen-space position to drop at (opens recipe overlay). */
		dropX: number;
		dropY: number;
		/** Recipe key to select from the overlay. */
		recipeKey: string;
	};
}

export interface AttemptInvalidConnectionAction {
	type: "attemptInvalidConnection";
	params: {
		/** Source node to drag from. */
		sourceNodeId: string;
		/** An incompatible target node. */
		destNodeId: string;
	};
}

// ── Mutation ───────────────────────────────────────────────────────

export interface MoveNodeAction {
	type: "moveNode";
	params: {
		nodeId: string;
		deltaX: number;
		deltaY: number;
	};
}

export interface MoveSelectedNodesAction {
	type: "moveSelectedNodes";
	params: {
		/** IDs of nodes to select before dragging. */
		nodeIds: string[];
		deltaX: number;
		deltaY: number;
	};
}

export interface ModifyNodePropertyAction {
	type: "modifyNodeProperty";
	params: {
		nodeId: string;
		property: "multiplier" | "customColor" | "textContent";
		value: string | number;
	};
}

export interface ModifyEdgePropertyAction {
	type: "modifyEdgeProperty";
	params: {
		edgeId: string;
		property: "displayType" | "isDrainLine";
		value: string | boolean;
	};
}

// ── Deletion ───────────────────────────────────────────────────────

export interface DeleteNodeAction {
	type: "deleteNode";
	params: {
		nodeId: string;
	};
}

export interface DeleteEdgeAction {
	type: "deleteEdge";
	params: {
		edgeId: string;
	};
}

export interface DeleteSelectedAction {
	type: "deleteSelected";
	params: {
		/** IDs of nodes and edges to select before deleting. */
		nodeIds: string[];
		edgeIds: string[];
	};
}

// ── Page operations ────────────────────────────────────────────────

export interface AddPageAction {
	type: "addPage";
	params: Record<string, never>;
}

export interface DeletePageAction {
	type: "deletePage";
	params: {
		pageId: string;
	};
}

export interface RenamePageAction {
	type: "renamePage";
	params: {
		pageId: string;
		newName: string;
	};
}

export interface ReorderPagesAction {
	type: "reorderPages";
	params: {
		pageId: string;
		/** Direction to drag: -1 (left) or +1 (right). */
		direction: -1 | 1;
	};
}

export interface SwitchPageAction {
	type: "switchPage";
	params: {
		pageId: string;
	};
}

// ── History ────────────────────────────────────────────────────────

export interface UndoRedoAction {
	type: "undoRedo";
	params: {
		undoCount: number;
		redoCount: number;
	};
}

// ── View (local-only) ──────────────────────────────────────────────

export interface PanViewAction {
	type: "panView";
	params: {
		deltaX: number;
		deltaY: number;
	};
}

export interface ZoomViewAction {
	type: "zoomView";
	params: {
		/** Positive = zoom in, negative = zoom out. */
		deltaY: number;
		/** Screen position of the mouse for zoom origin. */
		x: number;
		y: number;
	};
}

// ── Connection lifecycle ───────────────────────────────────────────

export interface DisconnectAndReconnectAction {
	type: "disconnectAndReconnect";
	params: {
		/** How long to stay disconnected (ms). */
		disconnectDurationMs: number;
	};
}

// ── Passive ────────────────────────────────────────────────────────

export interface SelectRandomAction {
	type: "selectRandom";
	params: {
		/** "node" or "edge" — which type of element to select. */
		target: "node" | "edge";
		/** The ID of the element to click. */
		elementId: string;
	};
}

// ── Union type ─────────────────────────────────────────────────────

export type Action =
	| CreateNodeAction
	| CreateSplitterMergerAction
	| CreateTextNoteAction
	| ConnectNodesAction
	| ConnectViaOverlayAction
	| AttemptInvalidConnectionAction
	| MoveNodeAction
	| MoveSelectedNodesAction
	| ModifyNodePropertyAction
	| ModifyEdgePropertyAction
	| DeleteNodeAction
	| DeleteEdgeAction
	| DeleteSelectedAction
	| AddPageAction
	| DeletePageAction
	| RenamePageAction
	| ReorderPagesAction
	| SwitchPageAction
	| UndoRedoAction
	| PanViewAction
	| ZoomViewAction
	| DisconnectAndReconnectAction
	| SelectRandomAction;

/** Result of executing an action. */
export interface ActionResult {
	/** Whether the action could be meaningfully executed. */
	executed: boolean;
	/** Optional reason when executed is false (e.g. "no nodes on page"). */
	skippedReason?: string;
}
