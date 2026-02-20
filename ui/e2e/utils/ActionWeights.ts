import type { SeededRandom } from "./SeededRandom";

/**
 * Weights controlling relative probability of each action type.
 * A weight of 0 disables that action; higher values make it more likely.
 */
export interface ActionWeights {
	// Node creation
	createNode: number;
	createSplitterMerger: number;
	createTextNote: number;

	// Connections
	connectNodes: number;
	connectViaOverlay: number;
	attemptInvalidConnection: number;

	// Mutation
	moveNode: number;
	moveSelectedNodes: number;
	modifyNodeProperty: number;
	modifyEdgeProperty: number;

	// Deletion
	deleteNode: number;
	deleteEdge: number;
	deleteSelected: number;

	// Page operations
	addPage: number;
	deletePage: number;
	renamePage: number;
	reorderPages: number;
	switchPage: number;

	// History
	undoRedo: number;

	// View (local-only, doesn't affect shared state)
	panView: number;
	zoomView: number;

	// Connection lifecycle
	disconnectAndReconnect: number;

	// Passive
	selectRandom: number;
}

/** Union of all action type names, derived from `ActionWeights` keys. */
export type ActionType = keyof ActionWeights;

/** All valid action type names (compile-time checked). */
export const ALL_ACTION_TYPES: readonly ActionType[] = [
	"createNode",
	"createSplitterMerger",
	"createTextNote",
	"connectNodes",
	"connectViaOverlay",
	"attemptInvalidConnection",
	"moveNode",
	"moveSelectedNodes",
	"modifyNodeProperty",
	"modifyEdgeProperty",
	"deleteNode",
	"deleteEdge",
	"deleteSelected",
	"addPage",
	"deletePage",
	"renamePage",
	"reorderPages",
	"switchPage",
	"undoRedo",
	"panView",
	"zoomView",
	"disconnectAndReconnect",
	"selectRandom",
] as const;

export interface AgentConfig {
	/** Range [min, max] in ms for the delay between actions. */
	actionDelayMs: [min: number, max: number];
	/** Relative weights for each action type. */
	weights: ActionWeights;
}

// ── Predefined configs ─────────────────────────────────────────────

export const CONFIGS = {
	warmup: {
		actionDelayMs: [20, 60],
		weights: {
			createNode: 3,
			createSplitterMerger: 1,
			createTextNote: 1,
			connectNodes: 4,
			connectViaOverlay: 6,
			attemptInvalidConnection: 0,
			moveNode: 2,
			moveSelectedNodes: 0,
			modifyNodeProperty: 1,
			modifyEdgeProperty: 0,
			deleteNode: 0,
			deleteEdge: 0,
			deleteSelected: 0,
			addPage: 0,
			deletePage: 0,
			renamePage: 0,
			reorderPages: 0,
			switchPage: 0,
			undoRedo: 0,
			panView: 1,
			zoomView: 0,
			disconnectAndReconnect: 0,
			selectRandom: 1,
		},
	},
	normal: {
		actionDelayMs: [10, 40],
		weights: {
			createNode: 2,
			createSplitterMerger: 1,
			createTextNote: 1,
			connectNodes: 3,
			connectViaOverlay: 4,
			attemptInvalidConnection: 1,
			moveNode: 3,
			moveSelectedNodes: 1,
			modifyNodeProperty: 2,
			modifyEdgeProperty: 1,
			deleteNode: 1,
			deleteEdge: 1,
			deleteSelected: 1,
			addPage: 1,
			deletePage: 1,
			renamePage: 1,
			reorderPages: 1,
			switchPage: 2,
			undoRedo: 2,
			panView: 1,
			zoomView: 1,
			disconnectAndReconnect: 1,
			selectRandom: 2,
		},
	},
	highContention: {
		actionDelayMs: [5, 20],
		weights: {
			createNode: 1,
			createSplitterMerger: 0,
			createTextNote: 0,
			connectNodes: 1,
			connectViaOverlay: 1,
			attemptInvalidConnection: 1,
			moveNode: 5,
			moveSelectedNodes: 2,
			modifyNodeProperty: 4,
			modifyEdgeProperty: 2,
			deleteNode: 3,
			deleteEdge: 2,
			deleteSelected: 2,
			addPage: 0,
			deletePage: 0,
			renamePage: 0,
			reorderPages: 0,
			switchPage: 0,
			undoRedo: 4,
			panView: 0,
			zoomView: 0,
			disconnectAndReconnect: 0,
			selectRandom: 2,
		},
	},
	churn: {
		actionDelayMs: [10, 40],
		weights: {
			createNode: 1,
			createSplitterMerger: 0,
			createTextNote: 0,
			connectNodes: 2,
			connectViaOverlay: 2,
			attemptInvalidConnection: 0,
			moveNode: 2,
			moveSelectedNodes: 1,
			modifyNodeProperty: 1,
			modifyEdgeProperty: 1,
			deleteNode: 1,
			deleteEdge: 1,
			deleteSelected: 0,
			addPage: 0,
			deletePage: 0,
			renamePage: 0,
			reorderPages: 0,
			switchPage: 1,
			undoRedo: 1,
			panView: 0,
			zoomView: 0,
			disconnectAndReconnect: 5,
			selectRandom: 1,
		},
	},
} as const satisfies Record<string, AgentConfig>;

/**
 * Select a random action type based on the given weights, using the provided PRNG.
 *
 * Actions with weight 0 are excluded. Returns `null` only if all weights are 0.
 */
export function pickWeightedAction(
	weights: ActionWeights,
	rng: SeededRandom,
): ActionType | null {
	let totalWeight = 0;
	for (const key of ALL_ACTION_TYPES) {
		totalWeight += weights[key];
	}
	if (totalWeight === 0) return null;

	let roll = rng.nextFloat(0, totalWeight);
	for (const key of ALL_ACTION_TYPES) {
		roll -= weights[key];
		if (roll <= 0) return key;
	}
	// Floating-point edge case — return last non-zero action
	for (let i = ALL_ACTION_TYPES.length - 1; i >= 0; i--) {
		if (weights[ALL_ACTION_TYPES[i]] > 0) return ALL_ACTION_TYPES[i];
	}
	return null;
}
