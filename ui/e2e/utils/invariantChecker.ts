/**
 * Structural invariant checker for serialized AppState.
 *
 * Validates graph integrity rules that must always hold, regardless of
 * what user actions have been performed. These are checked on every
 * convergence point during the stress test.
 */

import type {
	AppStateJson,
	GraphPageJson,
	GraphNodeJson,
	GraphEdgeJson,
	Id,
} from "../../../server/shared/types_serialization";

export interface InvariantViolation {
	/** Which invariant was violated. */
	rule: string;
	/** Human-readable description of the violation. */
	message: string;
	/** The page where the violation occurred (if applicable). */
	pageId?: Id;
}

/**
 * Check all structural invariants on a serialized AppState.
 * Returns an empty array if all invariants hold.
 */
export function checkInvariants(state: AppStateJson): InvariantViolation[] {
	const violations: InvariantViolation[] = [];

	// ── Global invariants ──────────────────────────────────────────
	checkAtLeastOnePage(state, violations);
	checkUniquePageIds(state, violations);

	// ── Per-page invariants ────────────────────────────────────────
	for (const page of state.pages) {
		checkUniqueNodeIds(page, violations);
		checkUniqueEdgeIds(page, violations);
		checkNoOrphanEdges(page, violations);
		checkNoOrphanChildren(page, violations);
		checkNoOrphanParents(page, violations);
		checkBidirectionalParentChild(page, violations);
		checkEdgeNodeConsistency(page, violations);
		checkNoSelfLoopEdges(page, violations);
		checkProductionNodeIntegrity(page, violations);
	}

	return violations;
}

// ── Individual invariant checks ────────────────────────────────────

function checkAtLeastOnePage(
	state: AppStateJson,
	violations: InvariantViolation[],
): void {
	if (state.pages.length === 0) {
		violations.push({
			rule: "at-least-one-page",
			message: "AppState has no pages",
		});
	}
}

function checkUniquePageIds(
	state: AppStateJson,
	violations: InvariantViolation[],
): void {
	const seen = new Set<Id>();
	for (const page of state.pages) {
		if (seen.has(page.id)) {
			violations.push({
				rule: "unique-page-ids",
				message: `Duplicate page ID: ${page.id}`,
				pageId: page.id,
			});
		}
		seen.add(page.id);
	}
}

function checkUniqueNodeIds(
	page: GraphPageJson,
	violations: InvariantViolation[],
): void {
	const nodeIds = Object.keys(page.nodes);
	const seen = new Set<Id>();
	for (const id of nodeIds) {
		if (seen.has(id)) {
			violations.push({
				rule: "unique-node-ids",
				message: `Duplicate node ID: ${id}`,
				pageId: page.id,
			});
		}
		seen.add(id);
	}
}

function checkUniqueEdgeIds(
	page: GraphPageJson,
	violations: InvariantViolation[],
): void {
	const edgeIds = Object.keys(page.edges);
	const seen = new Set<Id>();
	for (const id of edgeIds) {
		if (seen.has(id)) {
			violations.push({
				rule: "unique-edge-ids",
				message: `Duplicate edge ID: ${id}`,
				pageId: page.id,
			});
		}
		seen.add(id);
	}
}

function checkNoOrphanEdges(
	page: GraphPageJson,
	violations: InvariantViolation[],
): void {
	const nodeIds = new Set(Object.keys(page.nodes));
	for (const [edgeId, edge] of Object.entries(page.edges)) {
		if (!nodeIds.has(edge.startNodeId)) {
			violations.push({
				rule: "no-orphan-edges",
				message: `Edge ${edgeId} references non-existent startNodeId: ${edge.startNodeId}`,
				pageId: page.id,
			});
		}
		if (!nodeIds.has(edge.endNodeId)) {
			violations.push({
				rule: "no-orphan-edges",
				message: `Edge ${edgeId} references non-existent endNodeId: ${edge.endNodeId}`,
				pageId: page.id,
			});
		}
	}
}

function checkNoOrphanChildren(
	page: GraphPageJson,
	violations: InvariantViolation[],
): void {
	const nodeIds = new Set(Object.keys(page.nodes));
	for (const [nodeId, node] of Object.entries(page.nodes)) {
		for (const childId of node.children) {
			if (!nodeIds.has(childId)) {
				violations.push({
					rule: "no-orphan-children",
					message: `Node ${nodeId} has child ${childId} that does not exist`,
					pageId: page.id,
				});
			}
		}
	}
}

function checkNoOrphanParents(
	page: GraphPageJson,
	violations: InvariantViolation[],
): void {
	const nodeIds = new Set(Object.keys(page.nodes));
	for (const [nodeId, node] of Object.entries(page.nodes)) {
		if (node.parentNode !== null && !nodeIds.has(node.parentNode)) {
			violations.push({
				rule: "no-orphan-parents",
				message: `Node ${nodeId} has parentNode ${node.parentNode} that does not exist`,
				pageId: page.id,
			});
		}
	}
}

function checkBidirectionalParentChild(
	page: GraphPageJson,
	violations: InvariantViolation[],
): void {
	const nodes = page.nodes;

	for (const [nodeId, node] of Object.entries(nodes)) {
		// If A is in B.children, then A.parentNode must be B
		for (const childId of node.children) {
			const child = nodes[childId];
			if (child && child.parentNode !== nodeId) {
				violations.push({
					rule: "bidirectional-parent-child",
					message: `Node ${nodeId} has child ${childId}, but child's parentNode is ${child.parentNode ?? "null"} (expected ${nodeId})`,
					pageId: page.id,
				});
			}
		}

		// If A.parentNode is B, then A must be in B.children
		if (node.parentNode !== null) {
			const parent = nodes[node.parentNode];
			if (parent && !parent.children.includes(nodeId)) {
				violations.push({
					rule: "bidirectional-parent-child",
					message: `Node ${nodeId} has parentNode ${node.parentNode}, but parent's children don't include ${nodeId}`,
					pageId: page.id,
				});
			}
		}
	}
}

function checkEdgeNodeConsistency(
	page: GraphPageJson,
	violations: InvariantViolation[],
): void {
	// Build a set of edge IDs each node claims
	const nodeEdgeMap = new Map<Id, Set<Id>>();
	for (const [nodeId, node] of Object.entries(page.nodes)) {
		nodeEdgeMap.set(nodeId, new Set(node.edges));
	}

	for (const [edgeId, edge] of Object.entries(page.edges)) {
		// startNode should have this edge in its edges list
		const startEdges = nodeEdgeMap.get(edge.startNodeId);
		if (startEdges && !startEdges.has(edgeId)) {
			violations.push({
				rule: "edge-node-consistency",
				message: `Edge ${edgeId} has startNodeId ${edge.startNodeId}, but that node doesn't list edge ${edgeId}`,
				pageId: page.id,
			});
		}

		// endNode should have this edge in its edges list
		const endEdges = nodeEdgeMap.get(edge.endNodeId);
		if (endEdges && !endEdges.has(edgeId)) {
			violations.push({
				rule: "edge-node-consistency",
				message: `Edge ${edgeId} has endNodeId ${edge.endNodeId}, but that node doesn't list edge ${edgeId}`,
				pageId: page.id,
			});
		}
	}

	// Reverse: every edge ID a node claims should exist in page.edges
	for (const [nodeId, edgeIds] of nodeEdgeMap.entries()) {
		for (const edgeId of edgeIds) {
			if (!(edgeId in page.edges)) {
				violations.push({
					rule: "edge-node-consistency",
					message: `Node ${nodeId} references edge ${edgeId} that does not exist`,
					pageId: page.id,
				});
			}
		}
	}
}

function checkNoSelfLoopEdges(
	page: GraphPageJson,
	violations: InvariantViolation[],
): void {
	for (const [edgeId, edge] of Object.entries(page.edges)) {
		if (edge.startNodeId === edge.endNodeId) {
			violations.push({
				rule: "no-self-loop-edges",
				message: `Edge ${edgeId} is a self-loop (startNodeId === endNodeId === ${edge.startNodeId})`,
				pageId: page.id,
			});
		}
	}
}

function checkProductionNodeIntegrity(
	page: GraphPageJson,
	violations: InvariantViolation[],
): void {
	for (const [nodeId, node] of Object.entries(page.nodes)) {
		const props = node.properties as Record<string, unknown>;
		if (props.type !== "production") continue;

		// All children of a production node must be resource-joints
		for (const childId of node.children) {
			const child = page.nodes[childId];
			if (!child) continue; // already caught by orphan-children check
			const childProps = child.properties as Record<string, unknown>;
			if (childProps.type !== "resource-joint") {
				violations.push({
					rule: "production-node-integrity",
					message: `Production node ${nodeId} has child ${childId} of type "${childProps.type}" (expected "resource-joint")`,
					pageId: page.id,
				});
			}
		}
	}

	// Resource-joint parents must be production nodes
	for (const [nodeId, node] of Object.entries(page.nodes)) {
		const props = node.properties as Record<string, unknown>;
		if (props.type !== "resource-joint") continue;

		if (node.parentNode !== null) {
			const parent = page.nodes[node.parentNode];
			if (parent) {
				const parentProps = parent.properties as Record<string, unknown>;
				if (parentProps.type !== "production") {
					violations.push({
						rule: "production-node-integrity",
						message: `Resource-joint node ${nodeId} has parent ${node.parentNode} of type "${parentProps.type}" (expected "production")`,
						pageId: page.id,
					});
				}
			}
		}
	}
}
