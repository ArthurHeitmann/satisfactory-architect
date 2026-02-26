import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SeededRandom } from "../utils/SeededRandom";
import { createAgents, setupCollaborativeSession, type Agent } from "../utils/Agent";
import { TestRunner, RUNNER_PRESETS } from "../runner/TestRunner";
import { HistoryRecorder } from "../recorder/HistoryRecorder";
import { assertConverged } from "../utils/stateExtraction";

const EMPTY_SAVE = JSON.parse(
	readFileSync(
		resolve(dirname(fileURLToPath(import.meta.url)), "../empty-save.json"),
		"utf-8",
	),
);

const ENV = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
	.process?.env ?? {};

function envNumber(name: string, fallback: number): number {
	const value = ENV[name];
	if (!value) return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

const LIVE_VIEW = ENV.STRESS_LIVE_VIEW === "1";
const LIVE_SLOW_MO_MS = envNumber("STRESS_LIVE_SLOWMO_MS", 0);

if (LIVE_VIEW) {
	test.use({
		headless: false,
		launchOptions: LIVE_SLOW_MO_MS > 0 ? { slowMo: LIVE_SLOW_MO_MS } : undefined,
	});
}

async function assertAllAgentsInRoom(agents: Agent[]): Promise<void> {
	for (const agent of agents) {
		const state = await agent.getConnectionState();
		if (state !== "InRoom") {
			throw new Error(`Agent ${agent.index} is not in room (state=${state})`);
		}
	}
}

test.describe.serial("stress: collaborative sync", () => {
	test("main stress run", async ({ browser }) => {
		test.skip(ENV.RUN_STRESS !== "1", "Set RUN_STRESS=1 to run the full stress scenario.");
		test.setTimeout(envNumber("STRESS_TEST_TIMEOUT_MS", 10 * 60 * 1000));

		const seed = envNumber("E2E_SEED", SeededRandom.randomSeed());
		const rng = new SeededRandom(seed);
		const appUrl = ENV.STRESS_APP_URL ?? "http://localhost:5173";
		const wsUrl = ENV.STRESS_WS_URL ?? "ws://localhost:8080";
		const agentCount = envNumber("STRESS_AGENT_COUNT", 10);
		const convergenceIntervalMs = envNumber("STRESS_CONVERGENCE_INTERVAL_MS", 2_000);
		const preConvergenceWaitMs = envNumber("STRESS_PRE_CONVERGENCE_WAIT_MS", 250);
		const convergenceEpsilon = envNumber("STRESS_CONVERGENCE_EPSILON", 1e-3);
		const quiescenceMs = envNumber("STRESS_QUIESCENCE_MS", 1_000);
		const durationScale = envNumber("STRESS_DURATION_SCALE", 1);
		const recordAllAgents = ENV.STRESS_RECORD_AGENTS === "1" || ENV.STRESS_RECORD_AGENT0 === "1";
		const recordingsDir = ENV.STRESS_RECORDINGS_DIR ?? "e2e/recordings";

		const contexts = [];
		let agents: Agent[] = [];
		const phaseSummaries: Array<{
			phaseName: string;
			durationMs: number;
			tickCount: number;
			executedActionCount: number;
			skippedTickCount: number;
		}> = [];

		const recorder = new HistoryRecorder();

		try {
			for (let i = 0; i < agentCount; i++) {
				if (recordAllAgents) {
					contexts.push(await browser.newContext({
						recordVideo: {
							dir: recordingsDir,
							size: { width: 1920, height: 1080 },
						},
					}));
				} else {
					contexts.push(await browser.newContext());
				}
			}

			agents = await createAgents(contexts, {
				appUrl,
				wsUrl,
				rng,
				connectionTimeoutMs: 30_000,
			});

			if (LIVE_VIEW && agents.length > 0) {
				await agents[0].page.bringToFront();
			}

			recorder.bindAgents(agents);

			await setupCollaborativeSession(agents, 50, EMPTY_SAVE);
			await assertAllAgentsInRoom(agents);

			const initialStates = await Promise.all(agents.map((agent) => agent.getAppState()));
			assertConverged(initialStates, convergenceEpsilon, "Initial state convergence failed");

			const runner = new TestRunner(agents, {
				recorder,
				epsilon: convergenceEpsilon,
				captureAllStatesInSnapshots: true,
				convergenceIntervalMs,
				preConvergenceWaitMs,
				quiescenceMs,
			}, {
				step: (name, fn) => test.step(name, fn),
			});

			const phaseOrder = [
				{ name: "warmup", preset: RUNNER_PRESETS.warmup },
				{ name: "normal", preset: RUNNER_PRESETS.normal },
				{ name: "highContention", preset: RUNNER_PRESETS.highContention },
				{ name: "churn", preset: RUNNER_PRESETS.churn },
			] as const;

			for (const phase of phaseOrder) {
				const result = await runner.runPhase({
					phaseName: phase.name,
					config: phase.preset.config,
					durationMs: Math.max(1, Math.round(phase.preset.durationMs * durationScale)),
					runQuiescence: false,
				});
				phaseSummaries.push({
					phaseName: result.phaseName,
					durationMs: result.durationMs,
					tickCount: result.tickCount,
					executedActionCount: result.executedActionCount,
					skippedTickCount: result.skippedTickCount,
				});
				await assertAllAgentsInRoom(agents);
			}

			await Promise.all(agents.map((agent) => agent.wait(quiescenceMs)));
			await assertAllAgentsInRoom(agents);

			const finalStates = await Promise.all(agents.map((agent) => agent.getAppState()));
			assertConverged(finalStates, convergenceEpsilon, "Final state convergence failed");

			for (const agent of agents) {
				expect(agent.hasErrors(), `Agent ${agent.index} has page errors: ${agent.formatErrors()}`).toBe(false);
			}
			await recorder.capturePendingCommandLogs();
		} catch (error) {
			const reportPath = await recorder.dumpFailureReport({
				seed,
				phaseSummaries,
				failureReason: error instanceof Error ? error.stack ?? error.message : String(error),
			});
			throw new Error(`Stress run failed. Failure report: ${reportPath}\n${String(error)}`);
		} finally {
			await Promise.all(contexts.map((context) => context.close()));

			if (recordAllAgents) {
				for (const agent of agents) {
					const video = agent.page.video();
					if (!video) continue;
					const videoPath = await video.path();
					console.log(`[stress] agent${agent.index} recording: ${videoPath}`);
				}
			}
		}
	});
});
