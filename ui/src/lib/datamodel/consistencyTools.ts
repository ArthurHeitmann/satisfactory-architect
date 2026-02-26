import type { AppState } from "./AppState.svelte";
import { GraphPage } from "./GraphPage.svelte";
import type { GraphNode, GraphNodeProductionProperties, GraphNodeResourceJointProperties } from "./GraphNode.svelte";
import type { GraphEdge } from "./GraphEdge.svelte";
import type { Id } from "./IdGen.svelte";

export type ConsistencySeverity = "error" | "warning";

export interface ConsistencyIssue {
	severity: ConsistencySeverity;
	code: string;
	message: string;
	pageId?: Id;
	nodeId?: Id;
	edgeId?: Id;
}

export interface ConsistencyReport {
	ok: boolean;
	errorCount: number;
	warningCount: number;
	issues: ConsistencyIssue[];
}

export interface RepairReport {
	appliedFixes: number;
	fixes: string[];
}

function logFix(desc: string): void {
	console.info(`[Consistency][repair] ${desc}`);
}

export function checkDataModelConsistency(appState: AppState): ConsistencyReport {
	const report = buildConsistencyReport(appState);
	logConsistencyReport(report, "Data Model Consistency Check");
	return report;
}

export function repairDataModelConsistency(appState: AppState): RepairReport {
	// console.time("Data model consistency repair");
	const fixes: string[] = [];

	const collectFix = (desc: string) => {
		fixes.push(desc);
	};
	const markFixed = (desc: string) => {
		logFix(desc);
		collectFix(desc);
	};

	if (appState.pages.length === 0) {
		const page = GraphPage.newDefault(appState, "Page 1");
		appState.addPage(page);
		appState.setCurrentPage(page);
		markFixed("Created a default page because app state had no pages.");
	}

	if (!appState.currentPage && appState.pages.length > 0) {
		appState.setCurrentPage(appState.pages[0]);
	}

	removeDuplicatePages(appState, markFixed);

	for (const page of appState.pages) {
		normalizeNodeMapKeys(page, markFixed);
		normalizeEdgeMapKeys(page, markFixed);

		for (const selectedId of [...page.selectedNodes]) {
			if (!page.nodes.has(selectedId)) {
				page.selectedNodes.delete(selectedId);
				markFixed(`Removed invalid selected node id '${selectedId}' on page '${page.id}'.`);
			}
		}
		for (const selectedId of [...page.selectedEdges]) {
			if (!page.edges.has(selectedId)) {
				page.selectedEdges.delete(selectedId);
				markFixed(`Removed invalid selected edge id '${selectedId}' on page '${page.id}'.`);
			}
		}

		for (const node of [...page.nodes.values()]) {
			repairNodeConsistency(page, node, collectFix, appState);
		}

		for (const edge of [...page.edges.values()]) {
			repairEdgeConsistency(page, edge, collectFix);
		}
	}

	logRepairReport(fixes);
	// console.timeEnd("Data model consistency repair");
	return { appliedFixes: fixes.length, fixes };
}

export function repairNodeConsistency(page: GraphPage, node: GraphNode, onFix?: (desc: string) => void, appState?: AppState): void {
	const markFixed = (desc: string) => {
		logFix(desc);
		onFix?.(desc);
	};

	if (node.parentNode !== null && (!page.nodes.has(node.parentNode) || node.parentNode === node.id)) {
		page.removeNode(node.id);
		markFixed(`Removed node '${node.id}' with invalid parent '${node.parentNode}'.`);
		return;
	}

	if (node.parentNode !== null) {
		const parent = page.nodes.get(node.parentNode)!;
		if (!parent.children.has(node.id)) {
			parent.children.add(node.id);
			markFixed(`Repaired parent children set '${parent.id}' to include '${node.id}'.`);
		}
	}

	for (const childId of [...node.children]) {
		if (!page.nodes.has(childId) || childId === node.id) {
			node.children.delete(childId);
			markFixed(`Removed invalid child '${childId}' from node '${node.id}'.`);
			continue;
		}
		const child = page.nodes.get(childId)!;
		if (child.parentNode !== node.id) {
			child.parentNode = node.id;
			markFixed(`Repaired parent pointer '${child.id}' -> '${node.id}'.`);
		}
	}

	for (const edgeId of [...node.edges]) {
		const edge = page.edges.get(edgeId);
		if (!edge || (edge.startNodeId !== node.id && edge.endNodeId !== node.id)) {
			node.edges.delete(edgeId);
			markFixed(`Removed stale edge ref '${edgeId}' from node '${node.id}'.`);
		}
	}

	if (node.properties.type === "resource-joint") {
		const parent = node.parentNode ? page.nodes.get(node.parentNode) : undefined;
		if (!parent || parent.properties.type !== "production") {
			page.removeNode(node.id);
			markFixed(`Removed orphan resource-joint '${node.id}'.`);
			return;
		}
	}
	else if (node.properties.type !== "production") {
		if (node.children.size > 0) {
			for (const childId of [...node.children]) {
				const child = page.nodes.get(childId);
				if (child && child.parentNode === node.id) {
					child.parentNode = null;
				}
				node.children.delete(childId);
			}
			markFixed(`Cleared non-production children on node '${node.id}'.`);
		}
	}
	else if (node.properties.type === "production") {
		const production = node as GraphNode<GraphNodeProductionProperties>;

		const jointIdsToRemove: Id[] = [];	
		for (const joint of [...production.properties.resourceJoints]) {
			const jointNode = page.nodes.get(joint.id);
			if (!jointNode || jointNode.properties.type !== "resource-joint") {
				jointIdsToRemove.push(joint.id);
				markFixed(`Removed invalid resource joint '${joint.id}' from production node '${production.id}'.`);
				continue;
			}
			if (!production.children.has(joint.id)) {
				production.children.add(joint.id);
				markFixed(`Added missing child '${joint.id}' to production node '${production.id}'.`);
			}
			if (jointNode.parentNode !== production.id) {
				jointNode.parentNode = production.id;
				markFixed(`Repaired parent link for joint '${joint.id}' -> '${production.id}'.`);
			}
		}
		if (jointIdsToRemove.length > 0) {
			production.properties.resourceJoints = production.properties.resourceJoints.filter((joint) => !jointIdsToRemove.includes(joint.id));
		}

		const jointIds = new Set(production.properties.resourceJoints.map((joint) => joint.id));
		for (const childId of production.children) {
			const child = page.nodes.get(childId);
			if (!child || child.properties.type !== "resource-joint") continue;
			if (jointIds.has(childId)) continue;
			production.properties.resourceJoints.push({ id: child.id, type: child.properties.jointType });
			markFixed(`Added missing resourceJoints entry '${child.id}' on production node '${production.id}'.`);
		}
	}
}

export function repairEdgeConsistency(page: GraphPage, edge: GraphEdge, onFix?: (desc: string) => void): void {
	const markFixed = (desc: string) => {
		logFix(desc);
		onFix?.(desc);
	};

	if (edge.startNodeId === edge.endNodeId || !page.nodes.has(edge.startNodeId) || !page.nodes.has(edge.endNodeId)) {
		page.removeEdge(edge.id)
		markFixed(`Removed invalid edge '${edge.id}'.`);
		return;
	}

	const start = page.nodes.get(edge.startNodeId)!;
	const end = page.nodes.get(edge.endNodeId)!;
	if (!start.edges.has(edge.id)) {
		start.edges.add(edge.id);
		markFixed(`Added missing edge ref '${edge.id}' to start node '${start.id}'.`);
	}
	if (!end.edges.has(edge.id)) {
		end.edges.add(edge.id);
		markFixed(`Added missing edge ref '${edge.id}' to end node '${end.id}'.`);
	}
}

function buildConsistencyReport(appState: AppState): ConsistencyReport {
	// console.time("Building consistency report");
	const issues: ConsistencyIssue[] = [];

	const issue = (next: ConsistencyIssue) => {
		issues.push(next);
	};

	if (appState.pages.length === 0) {
		issue({ severity: "error", code: "no-pages", message: "AppState has no pages." });
	}

	const seenPageIds = new Set<Id>();
	for (const page of appState.pages) {
		if (seenPageIds.has(page.id)) {
			issue({ severity: "error", code: "duplicate-page-id", pageId: page.id, message: `Duplicate page id '${page.id}'.` });
		}
		seenPageIds.add(page.id);

		for (const selectedId of page.selectedNodes) {
			if (!page.nodes.has(selectedId)) {
				issue({ severity: "warning", code: "selected-node-missing", pageId: page.id, nodeId: selectedId, message: `Selected node '${selectedId}' does not exist.` });
			}
		}
		for (const selectedId of page.selectedEdges) {
			if (!page.edges.has(selectedId)) {
				issue({ severity: "warning", code: "selected-edge-missing", pageId: page.id, edgeId: selectedId, message: `Selected edge '${selectedId}' does not exist.` });
			}
		}

		for (const [nodeMapKey, node] of page.nodes.entries()) {
			if (nodeMapKey !== node.id) {
				issue({ severity: "warning", code: "node-map-key-mismatch", pageId: page.id, nodeId: node.id, message: `Node map key '${nodeMapKey}' does not match node.id '${node.id}'.` });
			}
			if (node.parentNode !== null && !page.nodes.has(node.parentNode)) {
				issue({ severity: "error", code: "orphan-parent", pageId: page.id, nodeId: node.id, message: `Node '${node.id}' parent '${node.parentNode}' does not exist.` });
			}
			if (node.parentNode === node.id) {
				issue({ severity: "error", code: "self-parent", pageId: page.id, nodeId: node.id, message: `Node '${node.id}' cannot be its own parent.` });
			}

			for (const childId of node.children) {
				const child = page.nodes.get(childId);
				if (!child) {
					issue({ severity: "error", code: "orphan-child", pageId: page.id, nodeId: node.id, message: `Node '${node.id}' has missing child '${childId}'.` });
					continue;
				}
				if (childId === node.id) {
					issue({ severity: "error", code: "self-child", pageId: page.id, nodeId: node.id, message: `Node '${node.id}' cannot be its own child.` });
				}
				if (child.parentNode !== node.id) {
					issue({ severity: "error", code: "parent-child-mismatch", pageId: page.id, nodeId: node.id, message: `Child '${child.id}' parent is '${child.parentNode ?? "null"}', expected '${node.id}'.` });
				}
			}

			if (node.properties.type === "resource-joint") {
				const parent = node.parentNode ? page.nodes.get(node.parentNode) : undefined;
				if (!parent || parent.properties.type !== "production") {
					issue({ severity: "error", code: "resource-joint-parent", pageId: page.id, nodeId: node.id, message: `Resource-joint '${node.id}' has invalid parent '${node.parentNode ?? "null"}'.` });
				}
			}

			if (node.properties.type === "production") {
				const production = node as GraphNode<GraphNodeProductionProperties>;
				const listedJointIds = new Set(production.properties.resourceJoints.map((joint) => joint.id));
				for (const joint of production.properties.resourceJoints) {
					const jointNode = page.nodes.get(joint.id);
					if (!jointNode || jointNode.properties.type !== "resource-joint") {
						issue({ severity: "error", code: "missing-production-joint", pageId: page.id, nodeId: node.id, message: `Production node '${node.id}' references invalid joint '${joint.id}'.` });
						continue;
					}
					if (!production.children.has(joint.id)) {
						issue({ severity: "error", code: "production-joint-child-missing", pageId: page.id, nodeId: node.id, message: `Production node '${node.id}' missing child link for joint '${joint.id}'.` });
					}
					if (jointNode.parentNode !== production.id) {
						issue({ severity: "error", code: "production-joint-parent-mismatch", pageId: page.id, nodeId: node.id, message: `Joint '${joint.id}' parent is '${jointNode.parentNode ?? "null"}', expected '${production.id}'.` });
					}
				}
				for (const childId of production.children) {
					const child = page.nodes.get(childId);
					if (!child || child.properties.type !== "resource-joint") {
						issue({ severity: "error", code: "non-joint-production-child", pageId: page.id, nodeId: node.id, message: `Production node '${node.id}' has non-joint child '${childId}'.` });
					}
					if (child && child.properties.type === "resource-joint" && !listedJointIds.has(childId)) {
						issue({ severity: "warning", code: "production-joint-list-missing", pageId: page.id, nodeId: node.id, message: `Production node '${node.id}' missing resourceJoints entry for child '${childId}'.` });
					}
				}

				if (production.properties.details.type === "factory-reference") {
					const details = production.properties.details;
					const externalPage = appState.pages.find((p) => p.id === details.factoryId);
					if (!externalPage) {
						issue({ severity: "error", code: "factory-reference-page-missing", pageId: page.id, nodeId: node.id, message: `Factory-reference node '${node.id}' targets missing page '${details.factoryId}'.` });
					} else {
						for (const [jointId, externalNodeId] of Object.entries(details.jointsToExternalNodes)) {
							if (!listedJointIds.has(jointId)) {
								issue({ severity: "warning", code: "factory-reference-joint-missing", pageId: page.id, nodeId: node.id, message: `Factory-reference node '${node.id}' maps unknown joint '${jointId}'.` });
							}
							if (!externalPage.nodes.has(externalNodeId)) {
								issue({ severity: "warning", code: "factory-reference-external-missing", pageId: page.id, nodeId: node.id, message: `Factory-reference node '${node.id}' maps joint '${jointId}' to missing external node '${externalNodeId}'.` });
							}
						}
					}
				}
			}

			if (hasParentCycle(page, node.id)) {
				issue({ severity: "error", code: "parent-cycle", pageId: page.id, nodeId: node.id, message: `Node '${node.id}' participates in a parent cycle.` });
			}
		}

		for (const [edgeMapKey, edge] of page.edges.entries()) {
			if (edgeMapKey !== edge.id) {
				issue({ severity: "warning", code: "edge-map-key-mismatch", pageId: page.id, edgeId: edge.id, message: `Edge map key '${edgeMapKey}' does not match edge.id '${edge.id}'.` });
			}
			if (!page.nodes.has(edge.startNodeId)) {
				issue({ severity: "error", code: "edge-start-missing", pageId: page.id, edgeId: edge.id, message: `Edge '${edge.id}' has missing start node '${edge.startNodeId}'.` });
			}
			if (!page.nodes.has(edge.endNodeId)) {
				issue({ severity: "error", code: "edge-end-missing", pageId: page.id, edgeId: edge.id, message: `Edge '${edge.id}' has missing end node '${edge.endNodeId}'.` });
			}
			if (edge.startNodeId === edge.endNodeId) {
				issue({ severity: "error", code: "edge-self-loop", pageId: page.id, edgeId: edge.id, message: `Edge '${edge.id}' is a self-loop.` });
			}

			const startNode = page.nodes.get(edge.startNodeId);
			const endNode = page.nodes.get(edge.endNodeId);
			if (startNode && !startNode.edges.has(edge.id)) {
				issue({ severity: "error", code: "edge-missing-on-start-node", pageId: page.id, edgeId: edge.id, nodeId: startNode.id, message: `Start node '${startNode.id}' missing edge '${edge.id}' in node.edges.` });
			}
			if (endNode && !endNode.edges.has(edge.id)) {
				issue({ severity: "error", code: "edge-missing-on-end-node", pageId: page.id, edgeId: edge.id, nodeId: endNode.id, message: `End node '${endNode.id}' missing edge '${edge.id}' in node.edges.` });
			}
		}

		for (const node of page.nodes.values()) {
			for (const edgeId of node.edges) {
				const edge = page.edges.get(edgeId);
				if (!edge) {
					issue({ severity: "error", code: "node-edge-missing", pageId: page.id, nodeId: node.id, edgeId, message: `Node '${node.id}' references missing edge '${edgeId}'.` });
					continue;
				}
				if (edge.startNodeId !== node.id && edge.endNodeId !== node.id) {
					issue({ severity: "error", code: "node-edge-disconnected", pageId: page.id, nodeId: node.id, edgeId, message: `Node '${node.id}' references edge '${edgeId}' that does not connect to it.` });
				}
			}
		}
	}

	const errorCount = issues.filter((entry) => entry.severity === "error").length;
	const warningCount = issues.filter((entry) => entry.severity === "warning").length;

	// console.timeEnd("Building consistency report");

	return {
		ok: errorCount === 0,
		errorCount,
		warningCount,
		issues,
	};
}

function normalizeNodeMapKeys(page: GraphPage, onFix: (description: string) => void): void {
	for (const [mapKey, node] of [...page.nodes.entries()]) {
		if (mapKey === node.id) continue;
		page.nodes.delete(mapKey);
		if (!page.nodes.has(node.id)) {
			page.nodes.set(node.id, node);
		}
		onFix(`Normalized node map key '${mapKey}' -> '${node.id}' on page '${page.id}'.`);
	}
}

function normalizeEdgeMapKeys(page: GraphPage, onFix: (description: string) => void): void {
	for (const [mapKey, edge] of [...page.edges.entries()]) {
		if (mapKey === edge.id) continue;
		page.edges.delete(mapKey);
		if (!page.edges.has(edge.id)) {
			page.edges.set(edge.id, edge);
		}
		onFix(`Normalized edge map key '${mapKey}' -> '${edge.id}' on page '${page.id}'.`);
	}
}

function removeDuplicatePages(appState: AppState, onFix: (description: string) => void): void {
	const seen = new Set<Id>();
	for (const page of [...appState.pages]) {
		if (seen.has(page.id)) {
			appState.removePage(page.id);
			onFix(`Removed duplicate page '${page.id}'.`);
		} else {
			seen.add(page.id);
		}
	}
}

function hasParentCycle(page: GraphPage, nodeId: Id): boolean {
	const seen = new Set<Id>();
	let currentId: Id | null = nodeId;
	while (currentId) {
		if (seen.has(currentId)) {
			return true;
		}
		seen.add(currentId);
		const node = page.nodes.get(currentId);
		if (!node || node.parentNode === null) {
			return false;
		}
		currentId = node.parentNode;
	}
	return false;
}

function logConsistencyReport(report: ConsistencyReport, title: string): void {
	if (report.ok) {
		console.info(`[Consistency] ${title}: OK (${report.warningCount} warning${report.warningCount === 1 ? "" : "s"}).`);
		if (report.warningCount > 0) {
			console.groupCollapsed("[Consistency] Warnings");
			for (const entry of report.issues.filter((issue) => issue.severity === "warning")) {
				console.warn(formatIssue(entry));
			}
			console.groupEnd();
		}
		return;
	}

	console.group(`[Consistency] ${title}: FAILED (${report.errorCount} errors, ${report.warningCount} warnings)`);
	for (const entry of report.issues) {
		if (entry.severity === "error") {
			console.error(formatIssue(entry));
		} else {
			console.warn(formatIssue(entry));
		}
	}
	console.groupEnd();
}

function logRepairReport(fixes: string[]): void {
	console.group(`[Consistency] Repair complete (${fixes.length} fix${fixes.length === 1 ? "" : "es"})`);
	if (fixes.length > 0) {
		console.groupCollapsed("Applied fixes");
		for (const fix of fixes) {
			console.info(fix);
		}
		console.groupEnd();
	}
	console.groupEnd();
}

function formatIssue(issue: ConsistencyIssue): string {
	const location = [
		issue.pageId ? `page=${issue.pageId}` : "",
		issue.nodeId ? `node=${issue.nodeId}` : "",
		issue.edgeId ? `edge=${issue.edgeId}` : "",
	].filter(Boolean).join(", ");
	return `[${issue.severity.toUpperCase()}][${issue.code}] ${issue.message}${location ? ` (${location})` : ""}`;
}
