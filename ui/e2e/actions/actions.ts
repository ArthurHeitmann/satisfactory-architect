/**
 * Generate and execute functions for all 23 stress-test actions.
 *
 * Each action has:
 *   - `generate*` — uses the Agent's current state + RNG to produce a
 *     typed action descriptor (or null if preconditions aren't met).
 *   - `execute*` — carries out the action via Playwright DOM interactions.
 *
 * The top-level `generateAction` and `executeAction` dispatch by type.
 */

import type { Agent } from "../utils/Agent";
import type { Locator } from "@playwright/test";
import type { ActionType } from "../utils/ActionWeights";
import type {
	Action,
	ActionResult,
	AddPageAction,
	AttemptInvalidConnectionAction,
	ConnectNodesAction,
	ConnectViaOverlayAction,
	CreateNodeAction,
	CreateSplitterMergerAction,
	CreateTextNoteAction,
	DeleteEdgeAction,
	DeleteNodeAction,
	DeletePageAction,
	DeleteSelectedAction,
	DisconnectAndReconnectAction,
	ModifyEdgePropertyAction,
	ModifyNodePropertyAction,
	MoveNodeAction,
	MoveSelectedNodesAction,
	PanViewAction,
	RenamePageAction,
	ReorderPagesAction,
	SelectRandomAction,
	SwitchPageAction,
	UndoRedoAction,
	ZoomViewAction,
} from "./types";

// ── Helpers ────────────────────────────────────────────────────────

const OK: ActionResult = { executed: true };

/** Random names for pages and text notes. */
const RANDOM_NAMES = [
	"Iron", "Copper", "Steel", "Plastic", "Rubber", "Oil", "Coal",
	"Quartz", "Caterium", "Aluminum", "Sulfur", "Uranium", "Nitrogen",
	"Factory A", "Factory B", "Sub-factory", "Power Grid", "Logistics",
];

const COLORS = [
	"#ff0000", "#00ff00", "#0000ff", "#ffff00", "#ff00ff", "#00ffff",
	"#ff8800", "#8800ff", "#008800", "#880000", "#000088", "#888888",
];

const DISPLAY_TYPES = ["straight", "curved", "angled", "teleport"] as const;

// ── Top-level dispatch ─────────────────────────────────────────────

/**
 * Generate a random action of the given type using the agent's current state.
 * Returns null if the action's preconditions aren't met.
 */
export async function generateAction(
	actionType: ActionType,
	agent: Agent,
): Promise<Action | null> {
	switch (actionType) {
		case "createNode":            return generateCreateNode(agent);
		case "createSplitterMerger":  return generateCreateSplitterMerger(agent);
		case "createTextNote":        return generateCreateTextNote(agent);
		case "connectNodes":          return generateConnectNodes(agent);
		case "connectViaOverlay":     return generateConnectViaOverlay(agent);
		case "attemptInvalidConnection": return generateAttemptInvalidConnection(agent);
		case "moveNode":              return generateMoveNode(agent);
		case "moveSelectedNodes":     return generateMoveSelectedNodes(agent);
		case "modifyNodeProperty":    return generateModifyNodeProperty(agent);
		case "modifyEdgeProperty":    return generateModifyEdgeProperty(agent);
		case "deleteNode":            return generateDeleteNode(agent);
		case "deleteEdge":            return generateDeleteEdge(agent);
		case "deleteSelected":        return generateDeleteSelected(agent);
		case "addPage":               return generateAddPage();
		case "deletePage":            return generateDeletePage(agent);
		case "renamePage":            return generateRenamePage(agent);
		case "reorderPages":          return generateReorderPages(agent);
		case "switchPage":            return generateSwitchPage(agent);
		case "undoRedo":              return generateUndoRedo(agent);
		case "panView":               return generatePanView(agent);
		case "zoomView":              return generateZoomView(agent);
		case "disconnectAndReconnect": return generateDisconnectAndReconnect(agent);
		case "selectRandom":          return generateSelectRandom(agent);
	}
}

/**
 * Check whether an action type can be generated right now.
 * Use this to filter action types before random selection.
 */
export async function canGenerateAction(
	actionType: ActionType,
	agent: Agent,
): Promise<boolean> {
	switch (actionType) {
		case "createNode":            return canGenerateCreateNode(agent);
		case "createSplitterMerger":  return canGenerateCreateSplitterMerger(agent);
		case "createTextNote":        return canGenerateCreateTextNote(agent);
		case "connectNodes":          return canGenerateConnectNodes(agent);
		case "connectViaOverlay":     return canGenerateConnectViaOverlay(agent);
		case "attemptInvalidConnection": return canGenerateAttemptInvalidConnection(agent);
		case "moveNode":              return canGenerateMoveNode(agent);
		case "moveSelectedNodes":     return canGenerateMoveSelectedNodes(agent);
		case "modifyNodeProperty":    return canGenerateModifyNodeProperty(agent);
		case "modifyEdgeProperty":    return canGenerateModifyEdgeProperty(agent);
		case "deleteNode":            return canGenerateDeleteNode(agent);
		case "deleteEdge":            return canGenerateDeleteEdge(agent);
		case "deleteSelected":        return canGenerateDeleteSelected(agent);
		case "addPage":               return canGenerateAddPage(agent);
		case "deletePage":            return canGenerateDeletePage(agent);
		case "renamePage":            return canGenerateRenamePage(agent);
		case "reorderPages":          return canGenerateReorderPages(agent);
		case "switchPage":            return canGenerateSwitchPage(agent);
		case "undoRedo":              return canGenerateUndoRedo(agent);
		case "panView":               return canGeneratePanView(agent);
		case "zoomView":              return canGenerateZoomView(agent);
		case "disconnectAndReconnect": return canGenerateDisconnectAndReconnect(agent);
		case "selectRandom":          return canGenerateSelectRandom(agent);
	}
}

/**
 * Execute an action via Playwright DOM interactions.
 */
export async function executeAction(
	action: Action,
	agent: Agent,
): Promise<ActionResult> {
	switch (action.type) {
		case "createNode":            return executeCreateNode(action, agent);
		case "createSplitterMerger":  return executeCreateSplitterMerger(action, agent);
		case "createTextNote":        return executeCreateTextNote(action, agent);
		case "connectNodes":          return executeConnectNodes(action, agent);
		case "connectViaOverlay":     return executeConnectViaOverlay(action, agent);
		case "attemptInvalidConnection": return executeAttemptInvalidConnection(action, agent);
		case "moveNode":              return executeMoveNode(action, agent);
		case "moveSelectedNodes":     return executeMoveSelectedNodes(action, agent);
		case "modifyNodeProperty":    return executeModifyNodeProperty(action, agent);
		case "modifyEdgeProperty":    return executeModifyEdgeProperty(action, agent);
		case "deleteNode":            return executeDeleteNode(action, agent);
		case "deleteEdge":            return executeDeleteEdge(action, agent);
		case "deleteSelected":        return executeDeleteSelected(action, agent);
		case "addPage":               return executeAddPage(action, agent);
		case "deletePage":            return executeDeletePage(action, agent);
		case "renamePage":            return executeRenamePage(action, agent);
		case "reorderPages":          return executeReorderPages(action, agent);
		case "switchPage":            return executeSwitchPage(action, agent);
		case "undoRedo":              return executeUndoRedo(action, agent);
		case "panView":               return executePanView(action, agent);
		case "zoomView":              return executeZoomView(action, agent);
		case "disconnectAndReconnect": return executeDisconnectAndReconnect(action, agent);
		case "selectRandom":          return executeSelectRandom(action, agent);
	}
}

// ════════════════════════════════════════════════════════════════════
// ── createNode ─────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateCreateNode(agent: Agent): Promise<CreateNodeAction | null> {
	const pos = await agent.getRandomCanvasPosition();
	// We'll pick a recipe from the overlay after it opens.
	// Use a placeholder key — execute will pick from what's available.
	return {
		type: "createNode",
		params: { x: pos.x, y: pos.y, recipeKey: "__random__" },
	};
}

async function canGenerateCreateNode(_agent: Agent): Promise<boolean> {
	return true;
}

async function executeCreateNode(
	action: CreateNodeAction,
	agent: Agent,
): Promise<ActionResult> {
	const { x, y } = action.params;
	const page = agent.page;

	// Ensure we're in select-nodes mode for double-click to work
	await ensureToolMode(agent, "select-nodes");

	// Double-click on the canvas to open recipe selector
	const svg = page.locator(".graph-page-view");
	const svgBox = await assertBoundingBox(svg, "canvas svg");
	await svg.dblclick({ position: { x: x - svgBox.x, y: y - svgBox.y } });

	// Wait for recipe selector overlay
	const selector = page.locator(".recipe-selector");
	// try {
		await selector.waitFor({ state: "visible", timeout: 1_200 });
	// } catch {
	// 	return { executed: false, skippedReason: "recipe-selector-not-visible" };
	// }

	// Pick a random recipe from the visible items
	const picked = await pickRandomRecipe(agent, action.params.recipeKey);
	// if (!picked) {
	// 	return { executed: false, skippedReason: "no-recipe-items-available" };
	// }
	if (!picked) {
		throw new Error("executeCreateNode: no recipe items available to pick");
	}

	// try {
		await selector.waitFor({ state: "hidden", timeout: 1_200 });
	// } catch {
	// 	return { executed: false, skippedReason: "recipe-selector-did-not-close" };
	// }
	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── createSplitterMerger ───────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateCreateSplitterMerger(agent: Agent): Promise<CreateSplitterMergerAction | null> {
	const sourceNodeId = await findDraggableJoint(agent);
	if (!sourceNodeId) return null;
	const pos = await getTrajectoryDropPosition(agent, sourceNodeId);
	const nodeType = agent.rng.pick(["splitter", "merger"] as const);
	return {
		type: "createSplitterMerger",
		params: { sourceNodeId, dropX: pos.x, dropY: pos.y, nodeType },
	};
}

async function canGenerateCreateSplitterMerger(agent: Agent): Promise<boolean> {
	return (await findDraggableJoint(agent)) !== null;
}

async function executeCreateSplitterMerger(
	action: CreateSplitterMergerAction,
	agent: Agent,
): Promise<ActionResult> {
	const { sourceNodeId, dropX, dropY } = action.params;
	const page = agent.page;

	await ensureToolMode(agent, "select-nodes");

	// Drag from a resource joint to open the context-aware recipe selector
	await agent.panToNode(sourceNodeId);
	const sourcePos = await agent.getNodeScreenPosition(sourceNodeId);
	if (!sourcePos) throw new Error("createSplitterMerger: source joint not visible");

	await page.mouse.move(sourcePos.x, sourcePos.y);
	await page.mouse.down();
	const steps = 12;
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		await page.mouse.move(
			sourcePos.x + (dropX - sourcePos.x) * t,
			sourcePos.y + (dropY - sourcePos.y) * t,
		);
	}
	await page.mouse.up();

	const selector = page.locator(".recipe-selector");
	try {
		await selector.waitFor({ state: "visible", timeout: 1_200 });
	} catch {
		return { executed: false, skippedReason: "recipe-selector-not-visible" };
	}

	// Splitter/Merger are under the "Special" section in the recipe selector.
	// Look for special recipe keys
	const targetKey = action.params.nodeType === "splitter"
		? "Splitter"
		: "Merger";

	const specialItem = page.locator(`[data-recipe-key="${targetKey}"]`);
	if (await specialItem.count() > 0) {
		await specialItem.click();
		// try {
			await selector.waitFor({ state: "hidden", timeout: 1_200 });
		// } catch {
		// 	return { executed: false, skippedReason: "recipe-selector-did-not-close" };
		// }
		return OK;
	}

	// return { executed: false, skippedReason: `splitter-merger-item-not-found:${action.params.nodeType}` };
	throw new Error(`executeCreateSplitterMerger: ${targetKey} item not found in recipe selector`);
}

// ════════════════════════════════════════════════════════════════════
// ── createTextNote ─────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateCreateTextNote(agent: Agent): Promise<CreateTextNoteAction | null> {
	const pos = await agent.getRandomCanvasPosition();
	const content = agent.rng.pick(RANDOM_NAMES) + " " + agent.rng.nextInt(1, 999);
	return {
		type: "createTextNote",
		params: { x: pos.x, y: pos.y, content },
	};
}

async function canGenerateCreateTextNote(_agent: Agent): Promise<boolean> {
	return true;
}

async function executeCreateTextNote(
	action: CreateTextNoteAction,
	agent: Agent,
): Promise<ActionResult> {
	const { x, y } = action.params;
	const page = agent.page;

	// Switch to add-note tool mode, then click canvas
	await setToolMode(agent, "add-note");

	const svg = page.locator(".graph-page-view");
	const box = await assertBoundingBox(svg, "canvas svg");

	const nodeCountBefore = await agent.getNodeCount();
	await svg.click({ position: { x: x - box.x, y: y - box.y } });
	await waitForNodeCountChange(agent, nodeCountBefore + 1);

	// Switch back to select-nodes mode
	await setToolMode(agent, "select-nodes");
	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── connectNodes ───────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateConnectNodes(agent: Agent): Promise<ConnectNodesAction | null> {
	// Find two connectable joints: a free output and a compatible free input
	const pair = await findConnectableJointPair(agent);
	if (!pair) return null;

	return {
		type: "connectNodes",
		params: { sourceNodeId: pair.sourceId, destNodeId: pair.destId },
	};
}

async function canGenerateConnectNodes(agent: Agent): Promise<boolean> {
	return (await findConnectableJointPair(agent)) !== null;
}

async function executeConnectNodes(
	action: ConnectNodesAction,
	agent: Agent,
): Promise<ActionResult> {
	const { sourceNodeId, destNodeId } = action.params;
	const page = agent.page;

	// Pan once to bring both nodes into view
	await panToFitNodes(agent, [sourceNodeId, destNodeId]);

	const sourcePos = await agent.getNodeScreenPosition(sourceNodeId);
	const destPos = await agent.getNodeScreenPosition(destNodeId);
	if (!sourcePos || !destPos) {
		throw new Error("connectNodes: nodes not visible after panToFit");
	}

	// Drag from source to destination
	const edgeCountBefore = await agent.getEdgeCount();
	await page.mouse.move(sourcePos.x, sourcePos.y);
	await page.mouse.down();

	// Move in steps to simulate real drag
	const steps = 10;
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		await page.mouse.move(
			sourcePos.x + (destPos.x - sourcePos.x) * t,
			sourcePos.y + (destPos.y - sourcePos.y) * t,
		);
	}

	await page.mouse.up();

	// Wait for edge count to increase
	await waitForEdgeCountAtLeast(agent, edgeCountBefore + 1);

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── connectViaOverlay ──────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateConnectViaOverlay(agent: Agent): Promise<ConnectViaOverlayAction | null> {
	// Find a locked joint that we can drag from
	const sourceId = await findDraggableJoint(agent);
	if (!sourceId) return null;

	const canvasPos = await getTrajectoryDropPosition(agent, sourceId);

	return {
		type: "connectViaOverlay",
		params: {
			sourceNodeId: sourceId,
			dropX: canvasPos.x,
			dropY: canvasPos.y,
			recipeKey: "__random__",
		},
	};
}

async function canGenerateConnectViaOverlay(agent: Agent): Promise<boolean> {
	return (await findDraggableJoint(agent)) !== null;
}

async function executeConnectViaOverlay(
	action: ConnectViaOverlayAction,
	agent: Agent,
): Promise<ActionResult> {
	const { sourceNodeId, dropX, dropY } = action.params;
	const page = agent.page;

	// Pan to and get position of source joint
	await agent.panToNode(sourceNodeId);

	const sourcePos = await agent.getNodeScreenPosition(sourceNodeId);
	if (!sourcePos) {
		throw new Error("connectViaOverlay: source joint not visible");
	}

	// Drag from source to empty canvas area (far enough away to trigger overlay)
	await page.mouse.move(sourcePos.x, sourcePos.y);
	await page.mouse.down();

	const steps = 15;
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		await page.mouse.move(
			sourcePos.x + (dropX - sourcePos.x) * t,
			sourcePos.y + (dropY - sourcePos.y) * t,
		);
	}

	await page.mouse.up();

	// Recipe selector should appear
	const selector = page.locator(".recipe-selector");
	try {
		await selector.waitFor({ state: "visible", timeout: 1_200 });
	} catch {
		return { executed: false, skippedReason: "recipe-selector-not-visible" };
	}

	const picked = await pickRandomRecipe(agent, action.params.recipeKey);
	// if (!picked) {
	// 	return { executed: false, skippedReason: "no-recipe-items-available" };
	// }
	if (!picked) {
		throw new Error("executeConnectViaOverlay: no recipe items available to pick");
	}

	// try {
		await selector.waitFor({ state: "hidden", timeout: 1_200 });
	// } catch {
	// 	return { executed: false, skippedReason: "recipe-selector-did-not-close" };
	// }
	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── attemptInvalidConnection ───────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateAttemptInvalidConnection(agent: Agent): Promise<AttemptInvalidConnectionAction | null> {
	// Get two random top-level nodes (not joints) — these can't be connected directly
	const nodeA = await agent.getRandomTopLevelNodeId();
	const nodeB = await agent.getRandomTopLevelNodeId();
	if (!nodeA || !nodeB || nodeA === nodeB) return null;

	return {
		type: "attemptInvalidConnection",
		params: { sourceNodeId: nodeA, destNodeId: nodeB },
	};
}

async function canGenerateAttemptInvalidConnection(agent: Agent): Promise<boolean> {
	const count = await agent.page.locator('[data-node-id]:not([data-node-type="resource-joint"])').count();
	return count >= 2;
}

async function executeAttemptInvalidConnection(
	action: AttemptInvalidConnectionAction,
	agent: Agent,
): Promise<ActionResult> {
	// Attempt to drag between two non-joint nodes — should be a no-op
	const { sourceNodeId, destNodeId } = action.params;
	const page = agent.page;

	await panToFitNodes(agent, [sourceNodeId, destNodeId]);

	const sourcePos = await agent.getNodeScreenPosition(sourceNodeId);
	const destPos = await agent.getNodeScreenPosition(destNodeId);
	if (!sourcePos || !destPos) {
		throw new Error("attemptInvalidConnection: nodes not visible after panToFit");
	}

	// This drag on a production node body will just move it, not connect.
	// That's the expected "invalid" connection attempt.
	await page.mouse.move(sourcePos.x, sourcePos.y);
	await page.mouse.down();
	await page.mouse.move(destPos.x, destPos.y, { steps: 5 });
	await page.mouse.up();

	// Undo the move so we don't displace the node
	const originalPos = sourcePos;
	await page.keyboard.press("Control+z");
	await waitForNodePositionNear(agent, sourceNodeId, originalPos);

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── moveNode ───────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateMoveNode(agent: Agent): Promise<MoveNodeAction | null> {
	const nodeId = await agent.getRandomTopLevelNodeId();
	if (!nodeId) return null;

	const deltaX = agent.rng.nextFloat(-200, 200);
	const deltaY = agent.rng.nextFloat(-200, 200);

	return {
		type: "moveNode",
		params: { nodeId, deltaX, deltaY },
	};
}

async function canGenerateMoveNode(agent: Agent): Promise<boolean> {
	return (await agent.page.locator('[data-node-id]:not([data-node-type="resource-joint"])').count()) > 0;
}

async function executeMoveNode(
	action: MoveNodeAction,
	agent: Agent,
): Promise<ActionResult> {
	const { nodeId, deltaX, deltaY } = action.params;
	const page = agent.page;

	await agent.panToNode(nodeId);

	const pos = await agent.getNodeScreenPosition(nodeId);
	if (!pos) throw new Error("moveNode: node not visible after pan");

	// Click to deselect all, then drag this node
	const svg = page.locator(".graph-page-view");
	await assertBoundingBox(svg, "canvas svg");
	await svg.click({ position: { x: 5, y: 5 } });

	await page.mouse.move(pos.x, pos.y);
	await page.mouse.down();
	await page.mouse.move(pos.x + deltaX, pos.y + deltaY, { steps: 8 });
	await page.mouse.up();

	await waitForNodePositionShift(agent, nodeId, pos);

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── moveSelectedNodes ──────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateMoveSelectedNodes(agent: Agent): Promise<MoveSelectedNodesAction | null> {
	// Pick 2-4 random top-level nodes
	const allNodes = agent.page.locator('[data-node-id]:not([data-node-type="resource-joint"])');
	const count = await allNodes.count();
	if (count < 2) return null;

	const pickCount = Math.min(count, agent.rng.nextInt(2, 4));
	const indices = new Set<number>();
	while (indices.size < pickCount) {
		indices.add(agent.rng.nextInt(0, count - 1));
	}

	const nodeIds: string[] = [];
	for (const i of indices) {
		const id = await allNodes.nth(i).getAttribute("data-node-id");
		if (id) nodeIds.push(id);
	}

	if (nodeIds.length < 2) return null;

	return {
		type: "moveSelectedNodes",
		params: {
			nodeIds,
			deltaX: agent.rng.nextFloat(-150, 150),
			deltaY: agent.rng.nextFloat(-150, 150),
		},
	};
}

async function canGenerateMoveSelectedNodes(agent: Agent): Promise<boolean> {
	return (await agent.page.locator('[data-node-id]:not([data-node-type="resource-joint"])').count()) >= 2;
}

async function executeMoveSelectedNodes(
	action: MoveSelectedNodesAction,
	agent: Agent,
): Promise<ActionResult> {
	const { nodeIds, deltaX, deltaY } = action.params;
	const page = agent.page;

	if (nodeIds.length === 0) throw new Error("moveSelectedNodes: no nodes to select");

	// Click first node to select it
	await panToFitNodes(agent, nodeIds);

	const firstPos = await agent.getNodeScreenPosition(nodeIds[0]);
	if (!firstPos) {
		throw new Error("moveSelectedNodes: first node not visible after panToFit");
	}

	await page.locator(`[data-node-id="${nodeIds[0]}"]`).click();

	// Shift-click remaining nodes
	for (let i = 1; i < nodeIds.length; i++) {
		await page.locator(`[data-node-id="${nodeIds[i]}"]`).click({ modifiers: ["Shift"] });
	}

	// Drag the first node (which drags all selected)
	await panToFitNodes(agent, nodeIds);

	const dragStart = await agent.getNodeScreenPosition(nodeIds[0]);
	if (!dragStart) {
		throw new Error("moveSelectedNodes: drag start node not visible after panToFit");
	}

	await page.mouse.move(dragStart.x, dragStart.y);
	await page.mouse.down();
	await page.mouse.move(dragStart.x + deltaX, dragStart.y + deltaY, { steps: 8 });
	await page.mouse.up();

	await waitForNodePositionShift(agent, nodeIds[0], dragStart);

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── modifyNodeProperty ─────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateModifyNodeProperty(agent: Agent): Promise<ModifyNodePropertyAction | null> {
	const nodeId = await agent.getRandomTopLevelNodeId();
	if (!nodeId) return null;

	// Read the node type to determine which properties we can modify
	const nodeType = await agent.page.locator(`[data-node-id="${nodeId}"]`).getAttribute("data-node-type");

	if (nodeType === "production") {
		const prop = agent.rng.pick(["multiplier", "customColor"] as const);
		if (prop === "multiplier") {
			return {
				type: "modifyNodeProperty",
				params: { nodeId, property: "multiplier", value: agent.rng.nextFloat(0.1, 10) },
			};
		} else {
			return {
				type: "modifyNodeProperty",
				params: { nodeId, property: "customColor", value: agent.rng.pick(COLORS) },
			};
		}
	} else if (nodeType === "text-note") {
		return {
			type: "modifyNodeProperty",
			params: {
				nodeId,
				property: "textContent",
				value: agent.rng.pick(RANDOM_NAMES) + " " + agent.rng.nextInt(1, 999),
			},
		};
	}

	// splitter/merger have no interesting modifiable properties
	return null;
}

async function canGenerateModifyNodeProperty(agent: Agent): Promise<boolean> {
	const count = await agent.page.locator('[data-node-id]:not([data-node-type="resource-joint"])').count();
	return count > 0;
}

async function executeModifyNodeProperty(
	action: ModifyNodePropertyAction,
	agent: Agent,
): Promise<ActionResult> {
	const { nodeId, property, value } = action.params;
	const page = agent.page;

	await agent.panToNode(nodeId);

	if (property === "multiplier") {
		// Multiplier is modified via the node's "properties" — we do this via evaluate
		// because the multiplier input is inside PropertiesToolbar which
		// requires the node to be selected first.
		await page.locator(`[data-node-id="${nodeId}"]`).click();

		const result = await page.evaluate(({ nodeId, value }) => {
			const app = (window as any).__appState;
			const currentPage = app.currentPage;
			if (!currentPage) return { executed: false, skippedReason: "no current page" };
			const node = currentPage.nodes.get(nodeId);
			if (!node || node.properties.type !== "production") {
				return { executed: false, skippedReason: "node not found or not production" };
			}
			node.properties.multiplier = value as number;
			return { executed: true };
		}, { nodeId, value });
		if (!result.executed) {
			throw new Error(`modifyNodeProperty(multiplier) failed: ${result.skippedReason}`);
		}
		return result;
	}

	if (property === "customColor") {
		// Custom color via evaluate (color picker overlay is complex to automate)
		const result = await page.evaluate(({ nodeId, value }) => {
			const app = (window as any).__appState;
			const currentPage = app.currentPage;
			if (!currentPage) return { executed: false, skippedReason: "no current page" };
			const node = currentPage.nodes.get(nodeId);
			if (!node || node.properties.type !== "production") {
				return { executed: false, skippedReason: "node not found or not production" };
			}
			node.properties.customColor = value as string;
			return { executed: true };
		}, { nodeId, value });
		if (!result.executed) {
			throw new Error(`modifyNodeProperty(customColor) failed: ${result.skippedReason}`);
		}
		return result;
	}

	if (property === "textContent") {
		// Text notes have a contenteditable div — we need to evaluate because
		// it's inside a foreignObject in SVG
		const result = await page.evaluate(({ nodeId, value }) => {
			const app = (window as any).__appState;
			const currentPage = app.currentPage;
			if (!currentPage) return { executed: false, skippedReason: "no current page" };
			const node = currentPage.nodes.get(nodeId);
			if (!node || node.properties.type !== "text-note") {
				return { executed: false, skippedReason: "node not found or not text-note" };
			}
			node.properties.content = value as string;
			return { executed: true };
		}, { nodeId, value });
		if (!result.executed) {
			throw new Error(`modifyNodeProperty(textContent) failed: ${result.skippedReason}`);
		}
		return result;
	}

	throw new Error(`modifyNodeProperty: unknown property ${property}`);
}

// ════════════════════════════════════════════════════════════════════
// ── modifyEdgeProperty ─────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateModifyEdgeProperty(agent: Agent): Promise<ModifyEdgePropertyAction | null> {
	const edgeId = await agent.getRandomEdgeId();
	if (!edgeId) return null;

	const property = agent.rng.pick(["displayType", "isDrainLine"] as const);
	if (property === "displayType") {
		return {
			type: "modifyEdgeProperty",
			params: { edgeId, property: "displayType", value: agent.rng.pick(DISPLAY_TYPES) },
		};
	} else {
		return {
			type: "modifyEdgeProperty",
			params: { edgeId, property: "isDrainLine", value: agent.rng.pick([true, false]) },
		};
	}
}

async function canGenerateModifyEdgeProperty(agent: Agent): Promise<boolean> {
	return (await agent.getEdgeCount()) > 0;
}

async function executeModifyEdgeProperty(
	action: ModifyEdgePropertyAction,
	agent: Agent,
): Promise<ActionResult> {
	const { edgeId, property, value } = action.params;
	const page = agent.page;

	// Edge properties are easiest to modify via evaluate (context-menu overlay
	// for edge display type is complex and fragile)
	const result = await page.evaluate(({ edgeId, property, value }) => {
		const app = (window as any).__appState;
		const currentPage = app.currentPage;
		if (!currentPage) return { executed: false, skippedReason: "no current page" };
		const edge = currentPage.edges.get(edgeId);
		if (!edge) return { executed: false, skippedReason: "edge not found" };
		if (property === "displayType") {
			edge.properties.displayType = value;
		} else if (property === "isDrainLine") {
			edge.properties.isDrainLine = value;
		}
		return { executed: true };
	}, { edgeId, property, value });
	if (!result.executed) {
		throw new Error(`modifyEdgeProperty failed: ${result.skippedReason}`);
	}
	return result;
}

// ════════════════════════════════════════════════════════════════════
// ── deleteNode ─────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateDeleteNode(agent: Agent): Promise<DeleteNodeAction | null> {
	const nodeId = await agent.getRandomTopLevelNodeId();
	if (!nodeId) return null;

	return { type: "deleteNode", params: { nodeId } };
}

async function canGenerateDeleteNode(agent: Agent): Promise<boolean> {
	return (await agent.page.locator('[data-node-id]:not([data-node-type="resource-joint"])').count()) > 0;
}

async function executeDeleteNode(
	action: DeleteNodeAction,
	agent: Agent,
): Promise<ActionResult> {
	const { nodeId } = action.params;
	const page = agent.page;

	await agent.panToNode(nodeId);

	// Click to select, then press Delete
	const nodeEl = page.locator(`[data-node-id="${nodeId}"]`);
	await nodeEl.waitFor({ state: "visible" });

	const nodeCountBefore = await agent.getNodeCount();
	await nodeEl.click();
	await page.keyboard.press("Delete");
	await waitForNodeCountAtMost(agent, Math.max(0, nodeCountBefore - 1));

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── deleteEdge ─────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateDeleteEdge(agent: Agent): Promise<DeleteEdgeAction | null> {
	const edgeId = await agent.getRandomEdgeId();
	if (!edgeId) return null;

	return { type: "deleteEdge", params: { edgeId } };
}

async function canGenerateDeleteEdge(agent: Agent): Promise<boolean> {
	return (await agent.getEdgeCount()) > 0;
}

async function executeDeleteEdge(
	action: DeleteEdgeAction,
	agent: Agent,
): Promise<ActionResult> {
	const { edgeId } = action.params;
	const page = agent.page;

	// Switch to edge selection mode so we can click-select the edge
	await ensureToolMode(agent, "select-edges");

	// We need to find where the edge is on screen and click it
	const edgeEl = page.locator(`[data-edge-id="${edgeId}"]`);
	await edgeEl.waitFor({ state: "visible" });

	// Click the edge's hover area path
	const hoverPath = edgeEl.locator(".edge-view-hover-area");
	if (await hoverPath.count() > 0) {
		await hoverPath.click({ force: true });
	} else {
		await edgeEl.click({ force: true });
	}
	const edgeCountBefore = await agent.getEdgeCount();
	await page.keyboard.press("Delete");
	await waitForEdgeCountAtMost(agent, Math.max(0, edgeCountBefore - 1));

	// Switch back to node selection
	await ensureToolMode(agent, "select-nodes");

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── deleteSelected ─────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateDeleteSelected(agent: Agent): Promise<DeleteSelectedAction | null> {
	// Pick 1-3 random top-level nodes to select and delete
	const allNodes = agent.page.locator('[data-node-id]:not([data-node-type="resource-joint"])');
	const nodeCount = await allNodes.count();
	if (nodeCount === 0) return null;

	const pickCount = Math.min(nodeCount, agent.rng.nextInt(1, 3));
	const indices = new Set<number>();
	while (indices.size < pickCount) {
		indices.add(agent.rng.nextInt(0, nodeCount - 1));
	}

	const nodeIds: string[] = [];
	for (const i of indices) {
		const id = await allNodes.nth(i).getAttribute("data-node-id");
		if (id) nodeIds.push(id);
	}

	return {
		type: "deleteSelected",
		params: { nodeIds, edgeIds: [] },
	};
}

async function canGenerateDeleteSelected(agent: Agent): Promise<boolean> {
	return (await agent.page.locator('[data-node-id]:not([data-node-type="resource-joint"])').count()) > 0;
}

async function executeDeleteSelected(
	action: DeleteSelectedAction,
	agent: Agent,
): Promise<ActionResult> {
	const { nodeIds } = action.params;
	const page = agent.page;

	if (nodeIds.length === 0) throw new Error("deleteSelected: nothing to delete");

	// Select nodes via shift-click
	await panToFitNodes(agent, nodeIds);
	for (let i = 0; i < nodeIds.length; i++) {
		const nodeEl = page.locator(`[data-node-id="${nodeIds[i]}"]`);
		await nodeEl.waitFor({ state: "visible" });
		if (i === 0) {
			await nodeEl.click();
		} else {
			await nodeEl.click({ modifiers: ["Shift"] });
		}
	}

	const nodeCountBefore = await agent.getNodeCount();
	await page.keyboard.press("Delete");
	await waitForNodeCountAtMost(agent, Math.max(0, nodeCountBefore - 1));

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── addPage ────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

function generateAddPage(): AddPageAction {
	return { type: "addPage", params: {} };
}

async function canGenerateAddPage(_agent: Agent): Promise<boolean> {
	return true;
}

async function executeAddPage(
	_action: AddPageAction,
	agent: Agent,
): Promise<ActionResult> {
	const page = agent.page;
	const addBtn = page.locator('[data-testid="add-page-btn"]');
	await addBtn.waitFor({ state: "visible" });

	const countBefore = (await agent.getPages()).length;
	await addBtn.click();
	await page.waitForFunction((before) => {
		const tabs = document.querySelectorAll('[data-page-id]');
		return tabs.length > before;
	}, countBefore);

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── deletePage ─────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateDeletePage(agent: Agent): Promise<DeletePageAction | null> {
	const pages = await agent.getPages();
	if (pages.length <= 1) return null; // Can't delete the last page

	const page = agent.rng.pick(pages);
	return { type: "deletePage", params: { pageId: page.id } };
}

async function canGenerateDeletePage(agent: Agent): Promise<boolean> {
	const pages = await agent.getPages();
	return pages.length > 1;
}

async function executeDeletePage(
	action: DeletePageAction,
	agent: Agent,
): Promise<ActionResult> {
	const { pageId } = action.params;
	const page = agent.page;

	const tab = page.locator(`[data-page-id="${pageId}"]`);
	await tab.waitFor({ state: "visible" });

	// Right-click to open context menu
	await tab.click({ button: "right" });

	// Click "Remove" in context menu
	const removeItem = page.locator('.context-menu-item').filter({ hasText: "Remove" });
	await removeItem.waitFor({ state: "visible" });
	await removeItem.click();

	// Confirm the removal in the confirmation prompt
	const countBefore = (await agent.getPages()).length;
	const confirmBtn = page.locator('button').filter({ hasText: "Remove" }).last();
	await confirmBtn.waitFor({ state: "visible" });
	await confirmBtn.click();
	await page.waitForFunction((before) => {
		const tabs = document.querySelectorAll('[data-page-id]');
		return tabs.length < before;
	}, countBefore);

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── renamePage ─────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateRenamePage(agent: Agent): Promise<RenamePageAction | null> {
	const pages = await agent.getPages();
	if (pages.length === 0) return null;

	const targetPage = agent.rng.pick(pages);
	const newName = agent.rng.pick(RANDOM_NAMES) + " " + agent.rng.nextInt(1, 99);

	return { type: "renamePage", params: { pageId: targetPage.id, newName } };
}

async function canGenerateRenamePage(agent: Agent): Promise<boolean> {
	return (await agent.getPages()).length > 0;
}

async function executeRenamePage(
	action: RenamePageAction,
	agent: Agent,
): Promise<ActionResult> {
	const { pageId, newName } = action.params;
	const page = agent.page;

	const tab = page.locator(`[data-page-id="${pageId}"]`);
	await tab.waitFor({ state: "visible" });

	// Double-click the name span to enter rename mode
	const nameSpan = tab.locator(".name");
	await nameSpan.dblclick();

	// Wait for the editing span to appear
	const editingSpan = tab.locator(".name.editing");
	await editingSpan.waitFor({ state: "visible" });

	// Select all text and type the new name
	await page.keyboard.press("Control+a");
	await page.keyboard.type(newName, { delay: 20 });
	await page.keyboard.press("Enter");

	await page.waitForFunction(
		({ id, expected }) => {
			const tabEl = document.querySelector(`[data-page-id="${id}"]`);
			const nameEl = tabEl?.querySelector(".name");
			return nameEl?.textContent?.trim() === expected;
		},
		{ id: pageId, expected: newName },
	);

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── reorderPages ───────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateReorderPages(agent: Agent): Promise<ReorderPagesAction | null> {
	const pages = await agent.getPages();
	if (pages.length < 2) return null;

	const idx = agent.rng.nextInt(0, pages.length - 1);
	const direction = idx === 0 ? 1 : idx === pages.length - 1 ? -1 : agent.rng.pick([-1, 1] as const);

	return {
		type: "reorderPages",
		params: { pageId: pages[idx].id, direction },
	};
}

async function canGenerateReorderPages(agent: Agent): Promise<boolean> {
	return (await agent.getPages()).length >= 2;
}

async function executeReorderPages(
	action: ReorderPagesAction,
	agent: Agent,
): Promise<ActionResult> {
	const { pageId, direction } = action.params;
	const page = agent.page;

	const tab = page.locator(`[data-page-id="${pageId}"]`);
	await tab.waitFor({ state: "visible" });

	const tabOrderBefore = await getPageTabOrder(agent);
	const tabBox = await assertBoundingBox(tab, "page tab");

	const startX = tabBox.x + tabBox.width / 2;
	const startY = tabBox.y + tabBox.height / 2;
	const dragDistance = tabBox.width * 1.5 * direction;

	await page.mouse.move(startX, startY);
	await page.mouse.down();

	// Drag far enough to cross the 4px threshold and trigger reorder
	await page.mouse.move(startX + dragDistance, startY, { steps: 10 });
	await page.mouse.up();

	await agent.page.waitForFunction((before) => {
		const tabs = Array.from(document.querySelectorAll('[data-page-id]')).map((t) => t.getAttribute("data-page-id"));
		return tabs.join(",") !== before.join(",");
	}, tabOrderBefore);

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── switchPage ─────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateSwitchPage(agent: Agent): Promise<SwitchPageAction | null> {
	const pages = await agent.getPages();
	const currentId = await agent.getCurrentPageId();

	const otherPages = pages.filter((p) => p.id !== currentId);
	if (otherPages.length === 0) return null;

	const targetPage = agent.rng.pick(otherPages);
	return { type: "switchPage", params: { pageId: targetPage.id } };
}

async function canGenerateSwitchPage(agent: Agent): Promise<boolean> {
	const pages = await agent.getPages();
	return pages.length >= 2;
}

async function executeSwitchPage(
	action: SwitchPageAction,
	agent: Agent,
): Promise<ActionResult> {
	await agent.switchToPage(action.params.pageId);
	await agent.page.waitForFunction((id) => {
		const selected = document.querySelector('[data-page-id].selected');
		return selected?.getAttribute("data-page-id") === id;
	}, action.params.pageId);
	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── undoRedo ───────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateUndoRedo(agent: Agent): Promise<UndoRedoAction | null> {
	const undoCount = agent.rng.nextInt(1, 5);
	const redoCount = agent.rng.nextInt(0, undoCount);

	return { type: "undoRedo", params: { undoCount, redoCount } };
}

async function canGenerateUndoRedo(_agent: Agent): Promise<boolean> {
	return true;
}

async function executeUndoRedo(
	action: UndoRedoAction,
	agent: Agent,
): Promise<ActionResult> {
	const page = agent.page;

	for (let i = 0; i < action.params.undoCount; i++) {
		await page.keyboard.press("Control+z");
	}

	for (let i = 0; i < action.params.redoCount; i++) {
		await page.keyboard.press("Control+y");
	}
	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── panView ────────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generatePanView(agent: Agent): Promise<PanViewAction | null> {
	return {
		type: "panView",
		params: {
			deltaX: agent.rng.nextFloat(-300, 300),
			deltaY: agent.rng.nextFloat(-300, 300),
		},
	};
}

async function canGeneratePanView(_agent: Agent): Promise<boolean> {
	return true;
}

async function executePanView(
	action: PanViewAction,
	agent: Agent,
): Promise<ActionResult> {
	const page = agent.page;
	const bounds = await agent.getCanvasBounds();

	const startX = bounds.x + bounds.width / 2;
	const startY = bounds.y + bounds.height / 2;

	// Middle-click drag for panning
	await page.mouse.move(startX, startY);
	await page.mouse.down({ button: "middle" });
	await page.mouse.move(startX + action.params.deltaX, startY + action.params.deltaY, { steps: 5 });
	await page.mouse.up({ button: "middle" });

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── zoomView ───────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateZoomView(agent: Agent): Promise<ZoomViewAction | null> {
	const bounds = await agent.getCanvasBounds();
	return {
		type: "zoomView",
		params: {
			deltaY: agent.rng.nextFloat(-300, 300),
			x: bounds.x + bounds.width / 2,
			y: bounds.y + bounds.height / 2,
		},
	};
}

async function canGenerateZoomView(_agent: Agent): Promise<boolean> {
	return true;
}

async function executeZoomView(
	action: ZoomViewAction,
	agent: Agent,
): Promise<ActionResult> {
	const page = agent.page;

	await page.mouse.move(action.params.x, action.params.y);
	await page.mouse.wheel(0, action.params.deltaY);

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── disconnectAndReconnect ─────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateDisconnectAndReconnect(agent: Agent): Promise<DisconnectAndReconnectAction | null> {
	return {
		type: "disconnectAndReconnect",
		params: {
			disconnectDurationMs: agent.rng.nextInt(500, 3000),
		},
	};
}

async function canGenerateDisconnectAndReconnect(agent: Agent): Promise<boolean> {
	return (await agent.getConnectionState()) === "InRoom";
}

async function executeDisconnectAndReconnect(
	action: DisconnectAndReconnectAction,
	agent: Agent,
): Promise<ActionResult> {
	const state = await agent.getConnectionState();
	if (state !== "InRoom") throw new Error(`disconnectAndReconnect: not in room (state: ${state})`);

	await agent.disconnect();
	await agent.page.waitForFunction(({ start, ms }) => {
		return Date.now() - start >= ms;
	}, { start: Date.now(), ms: action.params.disconnectDurationMs });

	// Dismiss reconnect overlay if it appeared
	await dismissOverlays(agent);

	await agent.reconnect();

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── selectRandom ───────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

async function generateSelectRandom(agent: Agent): Promise<SelectRandomAction | null> {
	const pickNode = agent.rng.next() < 0.7;

	if (pickNode) {
		const nodeId = await agent.getRandomTopLevelNodeId();
		if (!nodeId) return null;
		return { type: "selectRandom", params: { target: "node", elementId: nodeId } };
	} else {
		const edgeId = await agent.getRandomEdgeId();
		if (!edgeId) return null;
		return { type: "selectRandom", params: { target: "edge", elementId: edgeId } };
	}
}

async function canGenerateSelectRandom(agent: Agent): Promise<boolean> {
	const nodeCount = await agent.page.locator('[data-node-id]:not([data-node-type="resource-joint"])').count();
	const edgeCount = await agent.getEdgeCount();
	return nodeCount + edgeCount > 0;
}

async function executeSelectRandom(
	action: SelectRandomAction,
	agent: Agent,
): Promise<ActionResult> {
	const { target, elementId } = action.params;
	const page = agent.page;

	if (target === "node") {
		await ensureToolMode(agent, "select-nodes");

		await agent.panToNode(elementId);

		const nodeEl = page.locator(`[data-node-id="${elementId}"]`);
		await nodeEl.waitFor({ state: "visible" });

		await nodeEl.click();
	} else {
		await ensureToolMode(agent, "select-edges");

		const edgeEl = page.locator(`[data-edge-id="${elementId}"]`);
		await edgeEl.waitFor({ state: "visible" });

		const hoverPath = edgeEl.locator(".edge-view-hover-area");
		if (await hoverPath.count() > 0) {
			await hoverPath.click({ force: true });
		} else {
			await edgeEl.click({ force: true });
		}

		// Switch back to node selection
		await ensureToolMode(agent, "select-nodes");
	}

	return OK;
}

// ════════════════════════════════════════════════════════════════════
// ── Shared helpers ─────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

/**
 * Ensure the page is in a given tool mode by evaluating on the page.
 * Avoids the complexity of trying to click tiny toolbar buttons.
 */
async function setToolMode(
	agent: Agent,
	mode: "select-nodes" | "select-edges" | "add-note" | "drag-view",
): Promise<void> {
	await agent.page.evaluate((m: string) => {
		const app = (window as any).__appState;
		if (app?.currentPage) app.currentPage.toolMode = m;
	}, mode);
	await agent.page.waitForFunction((m) => {
		const app = (window as any).__appState;
		return app?.currentPage?.toolMode === m;
	}, mode);
}

/**
 * Switch to a tool mode only if not already in it.
 */
async function ensureToolMode(
	agent: Agent,
	mode: "select-nodes" | "select-edges" | "add-note" | "drag-view",
): Promise<void> {
	const current = await agent.page.evaluate(() => {
		const app = (window as any).__appState;
		return app?.currentPage?.toolMode;
	});
	if (current !== mode) {
		await setToolMode(agent, mode);
	}
}

/**
 * Pick a random recipe from the currently-visible recipe selector overlay.
 * Returns true if a recipe was clicked, false if none were available.
 */
async function pickRandomRecipe(
	agent: Agent,
	preferredKey: string,
): Promise<boolean> {
	const page = agent.page;

	if (preferredKey && preferredKey !== "__random__") {
		const item = page.locator(`[data-recipe-key="${preferredKey}"]`);
		if (await item.count() > 0) {
			await item.click();
			return true;
		}
	}

	// Collect all visible recipe items and pick one randomly
	const items = page.locator(".recipe-item");
	const count = await items.count();
	if (count === 0) return false;

	const idx = agent.rng.nextInt(0, count - 1);
	await items.nth(idx).click();
	return true;
}

/**
 * Find a pair of connectable joints: a free output and a compatible free input.
 * Returns null if no pair is found.
 */
async function findConnectableJointPair(
	agent: Agent,
): Promise<{ sourceId: string; destId: string } | null> {
	// Get all production nodes and collect their free joints
	const productionNodes = agent.page.locator('[data-node-type="production"]');
	const count = await productionNodes.count();
	if (count < 2) return null;

	// Gather free joints from up to 10 random production nodes
	const sampleSize = Math.min(count, 10);
	const indices: number[] = [];
	for (let i = 0; i < sampleSize; i++) {
		indices.push(agent.rng.nextInt(0, count - 1));
	}

	interface JointInfo {
		nodeId: string;
		freeInputs: string[];
		freeOutputs: string[];
	}

	const jointInfos: JointInfo[] = [];
	for (const i of indices) {
		const nodeId = await productionNodes.nth(i).getAttribute("data-node-id");
		if (!nodeId) continue;
		const joints = await agent.getFreeJoints(nodeId);
		if (joints.freeInputs.length > 0 || joints.freeOutputs.length > 0) {
			jointInfos.push({ nodeId, ...joints });
		}
	}

	// Try to find a source output and a destination input with matching resource class
	const outputs = jointInfos.flatMap(j => j.freeOutputs.map(id => ({ id, parentNodeId: j.nodeId })));
	const inputs = jointInfos.flatMap(j => j.freeInputs.map(id => ({ id, parentNodeId: j.nodeId })));

	if (outputs.length === 0 || inputs.length === 0) return null;

	// Shuffle and try to find a compatible pair
	agent.rng.shuffle(outputs);
	agent.rng.shuffle(inputs);

	// For simplicity in e2e tests, we just pick a random output and input
	// even if their resource types don't match — the app will handle the
	// incompatibility gracefully. For the stress test, what matters is
	// exercising the drag interaction.
	const source = outputs[0];
	const dest = inputs[0];

	// Make sure they're not from the same node
	if (source.parentNodeId === dest.parentNodeId && outputs.length > 1) {
		const alt = outputs.find(o => o.parentNodeId !== dest.parentNodeId);
		if (alt) return { sourceId: alt.id, destId: dest.id };
	}
	if (source.parentNodeId === dest.parentNodeId) return null;

	return { sourceId: source.id, destId: dest.id };
}

/**
 * Find a locked resource joint that can be dragged to start a new connection.
 */
async function findDraggableJoint(agent: Agent): Promise<string | null> {
	// Pick a random production node and look for a locked joint to drag
	const nodeId = await agent.getRandomTopLevelNodeId();
	if (!nodeId) return null;

	const nodeType = await agent.page.locator(`[data-node-id="${nodeId}"]`).getAttribute("data-node-type");
	if (nodeType !== "production") return null;

	const joints = await agent.getFreeJoints(nodeId);
	const allJoints = [...joints.freeInputs, ...joints.freeOutputs];
	if (allJoints.length === 0) return null;

	return agent.rng.pick(allJoints);
}

/**
 * Dismiss any currently-visible overlays (reconnect overlay, context menu, etc.)
 */
async function dismissOverlays(agent: Agent): Promise<void> {
	const page = agent.page;
	const overlays = page.locator(".overlays.active");
	if (await overlays.count() > 0) {
		await page.keyboard.press("Escape");
		await overlays.waitFor({ state: "hidden" });
	}
}

async function assertBoundingBox(locator: Locator, label: string) {
	const box = await locator.boundingBox();
	if (!box) throw new Error(`${label} not visible`);
	return box;
}

async function waitForNodeCountChange(agent: Agent, expected: number): Promise<void> {
	await agent.page.waitForFunction((count) => {
		return document.querySelectorAll('[data-node-id]').length >= count;
	}, expected);
}

async function waitForNodeCountAtMost(agent: Agent, max: number): Promise<void> {
	await agent.page.waitForFunction((count) => {
		return document.querySelectorAll('[data-node-id]').length <= count;
	}, max);
}

async function waitForEdgeCountAtLeast(agent: Agent, min: number): Promise<void> {
	await agent.page.waitForFunction((count) => {
		return document.querySelectorAll('[data-edge-id]').length >= count;
	}, min);
}

async function waitForEdgeCountAtMost(agent: Agent, max: number): Promise<void> {
	await agent.page.waitForFunction((count) => {
		return document.querySelectorAll('[data-edge-id]').length <= count;
	}, max);
}

async function waitForNodePositionShift(
	agent: Agent,
	nodeId: string,
	start: { x: number; y: number },
): Promise<void> {
	await agent.page.waitForFunction(
		({ id, sx, sy }) => {
			const el = document.querySelector(`[data-node-id="${id}"]`) as SVGGraphicsElement | null;
			if (!el) return false;
			const box = el.getBoundingClientRect();
			const cx = box.x + box.width / 2;
			const cy = box.y + box.height / 2;
			return Math.hypot(cx - sx, cy - sy) > 1;
		},
		{ id: nodeId, sx: start.x, sy: start.y },
	);
}

async function waitForNodePositionNear(
	agent: Agent,
	nodeId: string,
	start: { x: number; y: number },
): Promise<void> {
	await agent.page.waitForFunction(
		({ id, sx, sy }) => {
			const el = document.querySelector(`[data-node-id="${id}"]`) as SVGGraphicsElement | null;
			if (!el) return false;
			const box = el.getBoundingClientRect();
			const cx = box.x + box.width / 2;
			const cy = box.y + box.height / 2;
			return Math.hypot(cx - sx, cy - sy) < 1;
		},
		{ id: nodeId, sx: start.x, sy: start.y },
	);
}

async function panToFitNodes(agent: Agent, nodeIds: string[]): Promise<void> {
	if (nodeIds.length === 0) return;
	await agent.page.evaluate((ids: string[]) => {
		const app = (window as any).__appState;
		const page = app?.currentPage;
		if (!page) return;
		const svgEl = page.svgElement;
		if (!svgEl) return;
		const rect = svgEl.getBoundingClientRect();
		const positions = ids
			.map((id) => page.nodes.get(id))
			.filter(Boolean)
			.map((node: any) => node.getAbsolutePosition(page));
		if (positions.length === 0) return;
		let minX = positions[0].x;
		let maxX = positions[0].x;
		let minY = positions[0].y;
		let maxY = positions[0].y;
		for (const pos of positions) {
			minX = Math.min(minX, pos.x);
			maxX = Math.max(maxX, pos.x);
			minY = Math.min(minY, pos.y);
			maxY = Math.max(maxY, pos.y);
		}
		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;
		page.view.offset.x = rect.width / 2 - centerX * page.view.scale;
		page.view.offset.y = rect.height / 2 - centerY * page.view.scale;
	}, nodeIds);
}

async function getTrajectoryDropPosition(
	agent: Agent,
	sourceNodeId: string,
): Promise<{ x: number; y: number }> {
	const fallback = await agent.getRandomCanvasPosition();
	const distance = agent.rng.nextFloat(150, 270);
	const result = await agent.page.evaluate(({ id, distance }) => {
		const app = (window as any).__appState;
		const page = app?.currentPage;
		if (!page || !page.svgElement) return null;
		const node = page.nodes.get(id);
		if (!node || !node.parentNode) return null;
		const parent = page.nodes.get(node.parentNode);
		if (!parent) return null;
		const nodePos = node.getAbsolutePosition(page);
		const parentPos = parent.getAbsolutePosition(page);
		const dx = nodePos.x - parentPos.x;
		const dy = nodePos.y - parentPos.y;
		const len = Math.hypot(dx, dy);
		if (len === 0) return null;
		const ux = dx / len;
		const uy = dy / len;
		const target = {
			x: nodePos.x + ux * distance,
			y: nodePos.y + uy * distance,
		};
		const rect = page.svgElement.getBoundingClientRect();
		const screenX = rect.left + page.view.offset.x + target.x * page.view.scale;
		const screenY = rect.top + page.view.offset.y + target.y * page.view.scale;
		return { x: screenX, y: screenY };
	}, { id: sourceNodeId, distance });

	return result ?? fallback;
}

async function getPageTabOrder(agent: Agent): Promise<string[]> {
	return agent.page.evaluate(() => {
		return Array.from(document.querySelectorAll('[data-page-id]'))
			.map((t) => t.getAttribute("data-page-id") || "");
	});
}
