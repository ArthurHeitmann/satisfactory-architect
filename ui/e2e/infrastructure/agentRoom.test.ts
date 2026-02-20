import { expect, test } from "@playwright/test";
import { Agent, createAgents, setupCollaborativeSession } from "../utils/Agent";
import { SeededRandom } from "../utils/SeededRandom";

function summarizeStateCounts(state: Awaited<ReturnType<Agent["getAppState"]>>) {
	let nodeCount = 0;
	let edgeCount = 0;
	for (const page of state.pages) {
		nodeCount += Object.keys(page.nodes).length;
		edgeCount += Object.keys(page.edges).length;
	}
	return {
		pages: state.pages.length,
		nodes: nodeCount,
		edges: edgeCount,
	};
}

const APP_URL = "http://localhost:5173";
const WS_URL = "ws://localhost:8080";

test.describe.serial("infrastructure: agent and room setup", () => {
	test("agent setup exposes __appState", async ({ browser }) => {
		const context = await browser.newContext();
		try {
			const page = await context.newPage();
			const agent = new Agent(page, {
				index: 0,
				appUrl: APP_URL,
				wsUrl: WS_URL,
				rng: new SeededRandom(123),
			});
			await agent.setup();

			const exposed = await page.evaluate(() => Boolean((window as any).__appState));
			expect(exposed).toBe(true);
		} finally {
			await context.close();
		}
	});

	test("room creation and join converge across two agents", async ({ browser }) => {
		const contexts = [await browser.newContext(), await browser.newContext()];
		try {
			const agents = await createAgents(contexts, {
				appUrl: APP_URL,
				wsUrl: WS_URL,
				rng: new SeededRandom(999),
			});

			const roomId = await setupCollaborativeSession(agents, 150);
			expect(roomId.length).toBeGreaterThan(0);
			await expect.poll(async () => Promise.all(agents.map((agent) => agent.getConnectionState()))).toEqual(["InRoom", "InRoom"]);

			await expect.poll(async () => {
				const states = await Promise.all(agents.map((agent) => agent.getAppState()));
				const left = summarizeStateCounts(states[0]);
				const right = summarizeStateCounts(states[1]);
				return JSON.stringify(left) === JSON.stringify(right);
			}, { timeout: 10_000 }).toBe(true);
		} finally {
			await Promise.all(contexts.map((ctx) => ctx.close()));
		}
	});
});
