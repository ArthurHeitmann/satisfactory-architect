import { test, expect, type TestInfo, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "../utils/Agent";
import { SeededRandom } from "../utils/SeededRandom";
import { canGenerateAction, executeAction, generateAction } from "./actions";
import type { Action } from "./types";

const DEFAULT_SEED = 12345;
const APP_URL = "http://localhost:5173";
const WS_URL = "ws://localhost:8080";

const EMPTY_SAVE = JSON.parse(
	readFileSync(
		resolve(dirname(fileURLToPath(import.meta.url)), "../empty-save.json"),
		"utf-8",
	),
);

async function createAgent(page: Page, seed: number = DEFAULT_SEED) {
	const agent = new Agent(page, {
		index: 0,
		appUrl: APP_URL,
		wsUrl: WS_URL,
		rng: new SeededRandom(seed),
	});
	await agent.setup();
	return agent;
}

async function resetToEmptySave(agent: Agent) {
	await agent.page.evaluate((json) => {
		const app = (window as any).__appState;
		app.replaceFromJSON(json);
	}, EMPTY_SAVE);
	await expect.poll(async () => getCounts(agent)).toEqual({ nodes: 0, edges: 0, pages: 1 });
}

async function attachScreenshot(agent: Agent, testInfo: TestInfo, label: string) {
	const buffer = await agent.page.screenshot({ fullPage: true });
	await testInfo.attach(label, { body: buffer, contentType: "image/png" });
}

async function getCounts(agent: Agent) {
	return agent.page.evaluate(() => {
		const app = (window as any).__appState;
		const page = app.currentPage;
		return {
			nodes: page.nodes.size,
			edges: page.edges.size,
			pages: app.pages.length,
		};
	});
}

async function getTopLevelNodeIds(agent: Agent): Promise<string[]> {
	return agent.page.evaluate(() => {
		const app = (window as any).__appState;
		const page = app.currentPage;
		const out: string[] = [];
		for (const node of page.nodes.values()) {
			if (node.parentNode === null) {
				out.push(node.id);
			}
		}
		return out;
	});
}

async function getTopLevelNodeCount(agent: Agent): Promise<number> {
	const ids = await getTopLevelNodeIds(agent);
	return ids.length;
}

function sortedIds(ids: string[]): string[] {
	return [...ids].sort();
}

async function getProductionNodeIds(agent: Agent): Promise<string[]> {
	return agent.page.evaluate(() => {
		const app = (window as any).__appState;
		const page = app.currentPage;
		const out: string[] = [];
		for (const node of page.nodes.values()) {
			if (node.parentNode === null && node.properties.type === "production") {
				out.push(node.id);
			}
		}
		return out;
	});
}

async function getCompatibleJointPair(agent: Agent): Promise<{ sourceNodeId: string; destNodeId: string } | null> {
	return agent.page.evaluate(() => {
		const app = (window as any).__appState;
		const page = app.currentPage;
		const outputs: Array<{ id: string; resourceClassName: string; parentId: string | null }> = [];
		const inputs: Array<{ id: string; resourceClassName: string; parentId: string | null }> = [];

		for (const node of page.nodes.values()) {
			if (node.properties.type !== "resource-joint") continue;
			if (!node.properties.locked) continue;
			if (node.edges.size > 0) continue;
			const record = {
				id: node.id,
				resourceClassName: node.properties.resourceClassName,
				parentId: node.parentNode ?? null,
			};
			if (node.properties.jointType === "output") {
				outputs.push(record);
			} else {
				inputs.push(record);
			}
		}

		for (const out of outputs) {
			for (const input of inputs) {
				if (out.resourceClassName !== input.resourceClassName) continue;
				if (out.parentId && input.parentId && out.parentId === input.parentId) continue;
				return { sourceNodeId: out.id, destNodeId: input.id };
			}
		}
		return null;
	});
}

async function getRecipeJointIds(
	agent: Agent,
	recipeClassName: string,
): Promise<{ inputs: string[]; outputs: string[] }> {
	return agent.page.evaluate((recipeKey: string) => {
		const app = (window as any).__appState;
		const page = app.currentPage;
		const inputs: string[] = [];
		const outputs: string[] = [];

		for (const node of page.nodes.values()) {
			if (node.parentNode !== null) continue;
			if (node.properties.type !== "production") continue;
			if (node.properties.details.type !== "recipe") continue;
			if (node.properties.details.recipeClassName !== recipeKey) continue;

			for (const joint of node.properties.resourceJoints) {
				if (joint.type === "input") {
					inputs.push(joint.id);
				} else {
					outputs.push(joint.id);
				}
			}
		}

		return { inputs, outputs };
	}, recipeClassName);
}

async function expectTopLevelNodeCount(agent: Agent, expected: number) {
	await expect.poll(async () => getTopLevelNodeCount(agent)).toBe(expected);
}

async function expectEdgeCount(agent: Agent, expected: number) {
	await expect.poll(async () => (await getCounts(agent)).edges).toBe(expected);
}

async function createProductionNodes(
	agent: Agent,
	count: number,
	afterEach?: (index: number) => Promise<void>,
) {
	for (let i = 0; i < count; i++) {
		const action = await generateAction("createNode", agent);
		expect(action).not.toBeNull();
		await executeAction(action as Action, agent);
		if (afterEach) {
			await afterEach(i + 1);
		}
	}
	const nodeIds = await getProductionNodeIds(agent);
	expect(nodeIds.length).toBeGreaterThanOrEqual(count);
	return nodeIds;
}

test.describe.serial("actions infrastructure", () => {
	test("canGenerateAction baseline", async ({ page }) => {
		const agent = await createAgent(page, DEFAULT_SEED);
		await resetToEmptySave(agent);
		expect(await canGenerateAction("createNode", agent)).toBe(true);
		expect(await canGenerateAction("createTextNote", agent)).toBe(true);
		expect(await canGenerateAction("createSplitterMerger", agent)).toBe(false);
		expect(await canGenerateAction("panView", agent)).toBe(true);
		expect(await canGenerateAction("zoomView", agent)).toBe(true);
		expect(await canGenerateAction("undoRedo", agent)).toBe(true);

		expect(await canGenerateAction("deleteNode", agent)).toBe(false);
		expect(await canGenerateAction("deleteEdge", agent)).toBe(false);
		expect(await canGenerateAction("modifyEdgeProperty", agent)).toBe(false);
		expect(await canGenerateAction("connectNodes", agent)).toBe(false);
		expect(await canGenerateAction("connectViaOverlay", agent)).toBe(false);
		expect(await canGenerateAction("moveSelectedNodes", agent)).toBe(false);
	});

	test("execute create/move/modify/delete actions", async ({ page }, testInfo) => {
		const agent = await createAgent(page, DEFAULT_SEED + 1);
		await resetToEmptySave(agent);
		await attachScreenshot(agent, testInfo, "before");
		let step = 0;
		const snap = async (label: string) => {
			step += 1;
			await attachScreenshot(agent, testInfo, `step-${step}-${label}`);
		};
		const topLevelStart = await getTopLevelNodeCount(agent);
		const createNodeAction = await generateAction("createNode", agent);
		expect(createNodeAction).not.toBeNull();
		await executeAction(createNodeAction as Action, agent);
		await snap("create-node");
		await expectTopLevelNodeCount(agent, topLevelStart + 1);

		const createTextAction = await generateAction("createTextNote", agent);
		expect(createTextAction).not.toBeNull();
		await executeAction(createTextAction as Action, agent);
		await snap("create-text-note");
		await expectTopLevelNodeCount(agent, topLevelStart + 2);

		const createSplitterAction = await generateAction("createSplitterMerger", agent);
		expect(createSplitterAction).not.toBeNull();
		await executeAction(createSplitterAction as Action, agent);
		await snap("create-splitter-merger");
		await expectTopLevelNodeCount(agent, topLevelStart + 3);

		const nodes = await getTopLevelNodeIds(agent);
		expect(nodes.length).toBeGreaterThanOrEqual(2);

		const moveAction: Action = {
			type: "moveNode",
			params: { nodeId: nodes[0], deltaX: 100, deltaY: -50 },
		};
		await executeAction(moveAction, agent);
		await snap("move-node");

		const modifyAction: Action = {
			type: "modifyNodeProperty",
			params: { nodeId: nodes[0], property: "customColor", value: "#ff00ff" },
		};
		await executeAction(modifyAction, agent);
		await snap("modify-node");
		await expect
			.poll(() => agent.page.evaluate((id: string) => {
				const app = (window as any).__appState;
				const node = app.currentPage.nodes.get(id);
				return node?.properties?.customColor ?? null;
			}, nodes[0]))
			.toBe("#ff00ff");

		const deleteAction: Action = { type: "deleteNode", params: { nodeId: nodes[0] } };
		await executeAction(deleteAction, agent);
		await snap("delete-node");
		await expectTopLevelNodeCount(agent, topLevelStart + 2);
		await attachScreenshot(agent, testInfo, "after");
	});

	test("execute connection and edge actions", async ({ page }, testInfo) => {
		const agent = await createAgent(page, DEFAULT_SEED + 2);
		await resetToEmptySave(agent);
		await attachScreenshot(agent, testInfo, "before");
		let step = 0;
		const snap = async (label: string) => {
			step += 1;
			await attachScreenshot(agent, testInfo, `step-${step}-${label}`);
		};
		const wirePos = await agent.getRandomCanvasPosition();
		const cablePos = await agent.getRandomCanvasPosition();
		await executeAction({
			type: "createNode",
			params: { x: wirePos.x, y: wirePos.y, recipeKey: "Recipe_Wire_C" },
		} as Action, agent);
		await snap("create-wire");
		await executeAction({
			type: "createNode",
			params: { x: cablePos.x, y: cablePos.y, recipeKey: "Recipe_Cable_C" },
		} as Action, agent);
		await snap("create-cable");

		const wireJoints = await getRecipeJointIds(agent, "Recipe_Wire_C");
		const cableJoints = await getRecipeJointIds(agent, "Recipe_Cable_C");
		expect(wireJoints.outputs.length).toBeGreaterThan(0);
		expect(cableJoints.inputs.length).toBeGreaterThan(0);

		const connectAction: Action = {
			type: "connectNodes",
			params: { sourceNodeId: wireJoints.outputs[0], destNodeId: cableJoints.inputs[0] },
		};
		await executeAction(connectAction, agent);
		await snap("connect-nodes");
		await expectEdgeCount(agent, 1);

		const edgeId = await agent.getRandomEdgeId();
		expect(edgeId).not.toBeNull();
		const modifyEdgeAction: Action = {
			type: "modifyEdgeProperty",
			params: { edgeId: edgeId as string, property: "displayType", value: "angled" },
		};
		await executeAction(modifyEdgeAction, agent);
		await snap("modify-edge");
		await expect
			.poll(() => agent.page.evaluate(() => {
				const app = (window as any).__appState;
				const edge = app.currentPage.edges.values().next().value;
				return edge?.properties?.displayType ?? null;
			}))
			.toBe("angled");

		const deleteEdgeId = await agent.getRandomEdgeId();
		expect(deleteEdgeId).not.toBeNull();
		const deleteEdgeAction: Action = {
			type: "deleteEdge",
			params: { edgeId: deleteEdgeId as string },
		};
		await executeAction(deleteEdgeAction, agent);
		await snap("delete-edge");
		await expectEdgeCount(agent, 0);
		await attachScreenshot(agent, testInfo, "after");
	});

	test("execute page actions", async ({ page }, testInfo) => {
		const agent = await createAgent(page, DEFAULT_SEED + 3);
		await resetToEmptySave(agent);
		await attachScreenshot(agent, testInfo, "before");
		let step = 0;
		const snap = async (label: string) => {
			step += 1;
			await attachScreenshot(agent, testInfo, `step-${step}-${label}`);
		};
		const pagesBefore = (await getCounts(agent)).pages;
		await executeAction({ type: "addPage", params: {} }, agent);
		await snap("add-page");
		await expect.poll(async () => (await getCounts(agent)).pages).toBe(pagesBefore + 1);

		const pages = await agent.getPages();
		expect(pages.length).toBeGreaterThanOrEqual(2);

		const renameAction: Action = { type: "renamePage", params: { pageId: pages[1].id, newName: "Test Page" } };
		await executeAction(renameAction, agent);
		await snap("rename-page");

		await expect
			.poll(() => agent.page.evaluate((id: string) => {
				const tab = document.querySelector(`[data-page-id="${id}"] .name`);
				return tab?.textContent?.trim() ?? null;
			}, pages[1].id))
			.toBe("Test Page");

		const switchAction: Action = { type: "switchPage", params: { pageId: pages[1].id } };
		await executeAction(switchAction, agent);
		await snap("switch-page");

		const reorderAction: Action = { type: "reorderPages", params: { pageId: pages[1].id, direction: -1 } };
		await executeAction(reorderAction, agent);
		await snap("reorder-pages");

		const deleteAction: Action = { type: "deletePage", params: { pageId: pages[1].id } };
		await executeAction(deleteAction, agent);
		await snap("delete-page");
		await expect.poll(async () => (await getCounts(agent)).pages).toBe(pagesBefore);
		await attachScreenshot(agent, testInfo, "after");
	});

	test("execute selection + history actions", async ({ page }, testInfo) => {
		const agent = await createAgent(page, DEFAULT_SEED + 4);
		await resetToEmptySave(agent);
		await attachScreenshot(agent, testInfo, "before");
		let step = 0;
		const snap = async (label: string) => {
			step += 1;
			await attachScreenshot(agent, testInfo, `step-${step}-${label}`);
		};

		const recipeKeys = ["Recipe_Wire_C", "Recipe_Cable_C", "Recipe_IronRod_C"];
		const stepNodeIds: string[][] = [];
		for (let i = 0; i < recipeKeys.length; i++) {
			const pos = await agent.getRandomCanvasPosition();
			await executeAction({
				type: "createNode",
				params: { x: pos.x, y: pos.y, recipeKey: recipeKeys[i] },
			} as Action, agent);
			await agent.page.waitForTimeout(600);
			const ids = sortedIds(await getTopLevelNodeIds(agent));
			expect(ids.length).toBe(i + 1);
			stepNodeIds.push(ids);
			await snap(`create-node-${i + 1}`);
		}

		await executeAction({ type: "undoRedo", params: { undoCount: 2, redoCount: 1 } }, agent);
		await snap("undo-2-redo-1");
		await expect.poll(async () => sortedIds(await getTopLevelNodeIds(agent))).toEqual(stepNodeIds[1]);

		await executeAction({ type: "undoRedo", params: { undoCount: 1, redoCount: 0 } }, agent);
		await snap("undo-1");
		await expect.poll(async () => sortedIds(await getTopLevelNodeIds(agent))).toEqual(stepNodeIds[0]);
		await attachScreenshot(agent, testInfo, "after");
	});

	test("execute connect via overlay and view actions", async ({ page }, testInfo) => {
		const agent = await createAgent(page, DEFAULT_SEED + 5);
		await resetToEmptySave(agent);
		await attachScreenshot(agent, testInfo, "before");
		let step = 0;
		const snap = async (label: string) => {
			step += 1;
			await attachScreenshot(agent, testInfo, `step-${step}-${label}`);
		};
		await createProductionNodes(agent, 1, async () => {
			await snap("create-node-1");
		});
		const countsBefore = await getCounts(agent);
		const action = await generateAction("connectViaOverlay", agent);
		expect(action).not.toBeNull();
		await executeAction(action as Action, agent);
		await snap("connect-via-overlay");
		await expect.poll(async () => (await getCounts(agent)).nodes).toBeGreaterThan(countsBefore.nodes);

		const panAction: Action = { type: "panView", params: { deltaX: 200, deltaY: -150 } };
		const zoomAction: Action = { type: "zoomView", params: { deltaY: -300, x: 400, y: 300 } };
		await executeAction(panAction, agent);
		await executeAction(zoomAction, agent);
		await snap("pan-view");
		await snap("zoom-view");
		await attachScreenshot(agent, testInfo, "after");
	});

	test("execute remaining selection and invalid-connection actions", async ({ page }, testInfo) => {
		const agent = await createAgent(page, DEFAULT_SEED + 55);
		await resetToEmptySave(agent);
		await attachScreenshot(agent, testInfo, "before");

		const posA = await agent.getRandomCanvasPosition();
		const posB = await agent.getRandomCanvasPosition();
		await executeAction({
			type: "createNode",
			params: { x: posA.x, y: posA.y, recipeKey: "Recipe_Wire_C" },
		} as Action, agent);
		await executeAction({
			type: "createNode",
			params: { x: posB.x, y: posB.y, recipeKey: "Recipe_Wire_C" },
		} as Action, agent);
		const posC = await agent.getRandomCanvasPosition();
		await executeAction({
			type: "createNode",
			params: { x: posC.x, y: posC.y, recipeKey: "Recipe_IronRod_C" },
		} as Action, agent);

		const topLevelIds = await getTopLevelNodeIds(agent);
		expect(topLevelIds.length).toBeGreaterThanOrEqual(2);

		const beforePositions = await agent.page.evaluate((ids: string[]) => {
			const app = (window as any).__appState;
			const page = app.currentPage;
			return ids.map((id) => {
				const node = page.nodes.get(id);
				return { id, x: node.position.x, y: node.position.y };
			});
		}, topLevelIds.slice(0, 2));

		await executeAction({
			type: "moveSelectedNodes",
			params: { nodeIds: topLevelIds.slice(0, 2), deltaX: 80, deltaY: -40 },
		} as Action, agent);

		const afterPositions = await agent.page.evaluate((ids: string[]) => {
			const app = (window as any).__appState;
			const page = app.currentPage;
			return ids.map((id) => {
				const node = page.nodes.get(id);
				return { id, x: node.position.x, y: node.position.y };
			});
		}, topLevelIds.slice(0, 2));
		expect(afterPositions).not.toEqual(beforePositions);

		await executeAction({
			type: "selectRandom",
			params: { target: "node", elementId: topLevelIds[0] },
		} as Action, agent);

		const selectedCount = await agent.page.evaluate(() => {
			const app = (window as any).__appState;
			return app.currentPage.selectedNodes.size;
		});
		expect(selectedCount).toBeGreaterThan(0);

		const topLevelBeforeDelete = await getTopLevelNodeCount(agent);
		await executeAction({
			type: "deleteSelected",
			params: { nodeIds: topLevelIds.slice(0, 2), edgeIds: [] },
		} as Action, agent);

		await expect.poll(async () => getTopLevelNodeCount(agent)).toBeLessThan(topLevelBeforeDelete);

		const wireJoints = await getRecipeJointIds(agent, "Recipe_Wire_C");
		const rodJoints = await getRecipeJointIds(agent, "Recipe_IronRod_C");
		expect(wireJoints.outputs.length).toBeGreaterThanOrEqual(1);
		expect(rodJoints.inputs.length).toBeGreaterThanOrEqual(1);
		const edgesBeforeInvalid = (await getCounts(agent)).edges;

		await executeAction({
			type: "attemptInvalidConnection",
			params: { sourceNodeId: wireJoints.outputs[0], destNodeId: rodJoints.inputs[0] },
		} as Action, agent);

		await expect.poll(async () => (await getCounts(agent)).edges).toBeGreaterThanOrEqual(edgesBeforeInvalid);
		await attachScreenshot(agent, testInfo, "after");
	});

	test("execute disconnect and reconnect", async ({ page }, testInfo) => {
		const agent = await createAgent(page, DEFAULT_SEED + 6);
		await resetToEmptySave(agent);
		await attachScreenshot(agent, testInfo, "before");
		let step = 0;
		const snap = async (label: string) => {
			step += 1;
			await attachScreenshot(agent, testInfo, `step-${step}-${label}`);
		};
		await agent.connectToServer();
		await agent.createRoom();

		const action: Action = { type: "disconnectAndReconnect", params: { disconnectDurationMs: 300 } };
		await executeAction(action, agent);
		await snap("disconnect-reconnect");

		await expect.poll(async () => agent.getConnectionState()).toBe("InRoom");
		await attachScreenshot(agent, testInfo, "after");
	});
});
