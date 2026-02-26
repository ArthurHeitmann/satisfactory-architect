import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppStateJson } from "../../../server/shared/types_serialization";
import { executeAction } from "../actions/actions";
import type { Action } from "../actions/types";
import { assertConverged } from "../utils/stateExtraction";
import { Agent, createAgents, setupCollaborativeSession } from "../utils/Agent";
import { SeededRandom } from "../utils/SeededRandom";

const APP_URL = "http://localhost:5173";
const WS_URL = "ws://localhost:8080";

const EMPTY_SAVE = JSON.parse(
	readFileSync(
		resolve(dirname(fileURLToPath(import.meta.url)), "../empty-save.json"),
		"utf-8",
	),
);

async function createRecipeNode(agent: Agent, recipeKey: string, x: number, y: number): Promise<void> {
	const action: Action = {
		type: "createNode",
		params: {
			x,
			y,
			recipeKey,
		},
	};
	await executeAction(action, agent);
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

async function dragConnect(agent: Agent, sourceNodeId: string, destNodeId: string): Promise<void> {
	await agent.panToNode(sourceNodeId);
	await agent.panToNode(destNodeId);

	const sourcePos = await agent.getNodeScreenPosition(sourceNodeId);
	const destPos = await agent.getNodeScreenPosition(destNodeId);
	if (!sourcePos || !destPos) {
		throw new Error(`dragConnect: missing screen position for ${sourceNodeId} -> ${destNodeId}`);
	}

	await agent.page.mouse.move(sourcePos.x, sourcePos.y);
	await agent.page.mouse.down();
	await agent.page.mouse.move(destPos.x, destPos.y, { steps: 12 });
	await agent.page.mouse.up();
}

function getCurrentPage(state: AppStateJson) {
	if (state.pages.length === 0) {
		throw new Error("State has no pages.");
	}
	const current = state.pages.find((page) => page.id === state.currentPageId);
	return current ?? state.pages[0];
}

function assertJointEdgeConsistency(state: AppStateJson, jointId: string): void {
	const page = getCurrentPage(state);
	const joint = page.nodes[jointId];
	if (!joint) {
		throw new Error(`Joint ${jointId} not found in page ${page.id}.`);
	}

	const edgeIdsFromEdgesTable = Object.entries(page.edges)
		.filter(([, edge]) => edge.startNodeId === jointId || edge.endNodeId === jointId)
		.map(([edgeId]) => edgeId)
		.sort();
	const edgeIdsFromNodeSet = [...joint.edges].sort();

	expect(edgeIdsFromNodeSet, `joint ${jointId} edges set mismatch`).toEqual(edgeIdsFromEdgesTable);
}

test.describe.serial("infrastructure: LWW joint edge consistency", () => {
	test("concurrent drags from same Recipe_IngotIron_C output keep state consistent", async ({ browser }) => {
		const contexts = [await browser.newContext(), await browser.newContext()];
		const agents = await createAgents(contexts, {
			appUrl: APP_URL,
			wsUrl: WS_URL,
			rng: new SeededRandom(20260216),
		});

		try {
			await setupCollaborativeSession(agents, 50, EMPTY_SAVE);
			await expect.poll(async () => Promise.all(agents.map((agent) => agent.getConnectionState()))).toEqual(["InRoom", "InRoom"]);

			const leader = agents[0];
			const canvas = await leader.getCanvasBounds();
			const centerY = canvas.y + canvas.height * 0.5;

			await createRecipeNode(leader, "Recipe_IngotIron_C", canvas.x + canvas.width * 0.35, centerY);
			await createRecipeNode(leader, "Recipe_IronPlate_C", canvas.x + canvas.width * 0.62, centerY - 120);
			await createRecipeNode(leader, "Recipe_IronRod_C", canvas.x + canvas.width * 0.62, centerY + 120);

			await expect.poll(async () => {
				const states = await Promise.all(agents.map((agent) => agent.getAppState()));
				return states.map((state) => Object.keys(getCurrentPage(state).nodes).length);
			}, { timeout: 10_000 }).toEqual([9, 9]);

			const sourceJoints = await getRecipeJointIds(leader, "Recipe_IngotIron_C");
			const plateJoints = await getRecipeJointIds(leader, "Recipe_IronPlate_C");
			const rodJoints = await getRecipeJointIds(leader, "Recipe_IronRod_C");

			expect(sourceJoints.outputs.length).toBeGreaterThan(0);
			expect(plateJoints.inputs.length).toBeGreaterThan(0);
			expect(rodJoints.inputs.length).toBeGreaterThan(0);

			const contestedSourceJoint = sourceJoints.outputs[0];
			const destA = plateJoints.inputs[0];
			const destB = rodJoints.inputs[0];

			await Promise.all([
				dragConnect(agents[0], contestedSourceJoint, destA),
				dragConnect(agents[1], contestedSourceJoint, destB),
			]);

			await Promise.all(agents.map((agent) => agent.wait(500)));

			const finalStates = await Promise.all(agents.map((agent) => agent.getAppState()));
			assertConverged(finalStates, 1e-6, "LWW contested resource-joint scenario did not converge consistently");

			for (const [index, state] of finalStates.entries()) {
				try {
					assertJointEdgeConsistency(state, contestedSourceJoint);
				} catch (error) {
					throw new Error(`Agent ${index}: ${(error as Error).message}`);
				}
			}

			for (const agent of agents) {
				expect(agent.hasErrors(), `Agent ${agent.index} has page errors: ${agent.formatErrors()}`).toBe(false);
			}
		} finally {
			await Promise.all(contexts.map((ctx) => ctx.close()));
		}
	});

	test("concurrent multiplier changes on same node converge to one value", async ({ browser }) => {
		const contexts = [await browser.newContext(), await browser.newContext()];
		const agents = await createAgents(contexts, {
			appUrl: APP_URL,
			wsUrl: WS_URL,
			rng: new SeededRandom(20260223),
		});

		try {
			await setupCollaborativeSession(agents, 50, EMPTY_SAVE);
			await expect.poll(async () => Promise.all(agents.map((agent) => agent.getConnectionState()))).toEqual(["InRoom", "InRoom"]);

			const leader = agents[0];
			const canvas = await leader.getCanvasBounds();
			await createRecipeNode(leader, "Recipe_IngotIron_C", canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.5);

			// Wait until both agents see the node
			await expect.poll(async () => {
				const states = await Promise.all(agents.map((agent) => agent.getAppState()));
				return states.map((state) => Object.keys(getCurrentPage(state).nodes).length);
			}, { timeout: 10_000 }).toEqual([3, 3]); // parent + 1 input joint + 1 output joint

			// Get the production node id on each agent
			const getProductionNodeId = async (agent: Agent): Promise<string> => {
				return agent.page.evaluate(() => {
					const app = (window as any).__appState;
					const page = app.currentPage;
					for (const node of page.nodes.values()) {
						if (node.parentNode !== null) continue;
						if (node.properties.type === "production") return node.id;
					}
					throw new Error("No production node found");
				});
			};

			const nodeIdA = await getProductionNodeId(agents[0]);
			const nodeIdB = await getProductionNodeId(agents[1]);
			expect(nodeIdA).toBe(nodeIdB);

			// Both agents set a different multiplier value simultaneously
			await Promise.all([
				agents[0].page.evaluate((id: string) => {
					const app = (window as any).__appState;
					const node = app.currentPage.nodes.get(id);
					node.properties.multiplier = 2.5;
				}, nodeIdA),
				agents[1].page.evaluate((id: string) => {
					const app = (window as any).__appState;
					const node = app.currentPage.nodes.get(id);
					node.properties.multiplier = 7.0;
				}, nodeIdB),
			]);

			await Promise.all(agents.map((agent) => agent.wait(500)));

			const finalStates = await Promise.all(agents.map((agent) => agent.getAppState()));
			assertConverged(finalStates, 1e-6, "LWW concurrent multiplier change did not converge consistently");

			// Verify the multiplier settled on one of the two written values
			const finalMultiplier = (getCurrentPage(finalStates[0]).nodes[nodeIdA].properties as any).multiplier as number;
			expect([2.5, 7.0], `multiplier ${finalMultiplier} is not one of the expected values`).toContain(finalMultiplier);

			for (const agent of agents) {
				expect(agent.hasErrors(), `Agent ${agent.index} has page errors: ${agent.formatErrors()}`).toBe(false);
			}
		} finally {
			await Promise.all(contexts.map((ctx) => ctx.close()));
		}
	});
});
