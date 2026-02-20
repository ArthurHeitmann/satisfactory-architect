import { expect, test } from "@playwright/test";
import type { AppStateJson } from "../../../server/shared/types_serialization";
import { SeededRandom } from "../utils/SeededRandom";
import {
	RUNNER_PRESETS,
	TestRunner,
	type RunnerActionRecord,
	type RunnerAgent,
	type RunnerConvergenceRecord,
	type RunnerSnapshotRecord,
} from "./TestRunner";

class FakeAgent implements RunnerAgent {
	readonly index: number;
	readonly rng: SeededRandom;
	private state: AppStateJson;
	private readonly errored: boolean;

	constructor(index: number, seed: number, state: AppStateJson, errored: boolean = false) {
		this.index = index;
		this.rng = new SeededRandom(seed);
		this.state = state;
		this.errored = errored;
	}

	setState(state: AppStateJson): void {
		this.state = state;
	}

	async getAppState(): Promise<AppStateJson> {
		return this.state;
	}

	hasErrors(): boolean {
		return this.errored;
	}

	formatErrors(): string {
		return this.errored ? "synthetic page error" : "";
	}
}

class FakeClock {
	nowMs = 0;

	now = (): number => this.nowMs;

	sleep = async (ms: number): Promise<void> => {
		this.nowMs += ms;
	};
}

function createMinimalState(pageName: string): AppStateJson {
	return {
		version: 1,
		type: "app-state",
		idGen: "test",
		name: "test",
		currentPageId: "p1",
		pages: [
			{
				version: 1,
				type: "graph-page",
				id: "p1",
				name: pageName,
				icon: "",
				view: {
					offset: { x: 0, y: 0 },
					scale: 1,
					enableGridSnap: false,
				},
				selectedNodes: [],
				selectedEdges: [],
				toolMode: "select-nodes",
				nodes: {},
				edges: {},
			},
		],
	};
}

test.describe("TestRunner", () => {
	test("runs synchronous ticks with periodic checks and final verification", async () => {
		const clock = new FakeClock();
		const actionRecords: RunnerActionRecord[] = [];
		const convergenceRecords: RunnerConvergenceRecord[] = [];
		const snapshots: RunnerSnapshotRecord[] = [];

		const agents: RunnerAgent[] = [
			new FakeAgent(0, 100, createMinimalState("A")),
			new FakeAgent(1, 200, createMinimalState("A")),
		];

		const runner = new TestRunner(
			agents,
			{
				convergenceIntervalMs: 200,
				quiescenceMs: 0,
				recorder: {
					recordAction: (r) => {
						actionRecords.push(r);
					},
					recordConvergence: (r) => {
						convergenceRecords.push(r);
					},
					recordSnapshot: (r) => {
						snapshots.push(r);
					},
				},
			},
			{
				now: clock.now,
				sleep: clock.sleep,
				canGenerateAction: async (actionType) => actionType === "createNode",
				generateAction: async () => ({
					type: "createNode",
					params: { x: 10, y: 20, recipeKey: "Recipe_Wire_C" },
				}),
				executeAction: async () => ({ executed: true }),
				checkConvergence: () => ({ converged: true, invariantViolations: [], comparisonDiffs: [] }),
				formatConvergenceResult: () => "ok",
			},
		);

		const result = await runner.runPhase({
			phaseName: "normal",
			config: {
				actionDelayMs: [100, 100],
				weights: {
					createNode: 1,
					createSplitterMerger: 0,
					createTextNote: 0,
					connectNodes: 0,
					connectViaOverlay: 0,
					attemptInvalidConnection: 0,
					moveNode: 0,
					moveSelectedNodes: 0,
					modifyNodeProperty: 0,
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
					panView: 0,
					zoomView: 0,
					disconnectAndReconnect: 0,
					selectRandom: 0,
				},
			},
			durationMs: 350,
		});

		expect(result.tickCount).toBe(4);
		expect(result.executedActionCount).toBe(8);
		expect(result.skippedTickCount).toBe(0);
		expect(result.periodicChecks).toBe(2);
		expect(result.convergenceChecks).toBe(3);
		expect(actionRecords).toHaveLength(8);
		expect(convergenceRecords.map((r) => r.reason)).toEqual(["periodic", "periodic", "final"]);
		expect(snapshots).toHaveLength(3);
		expect(actionRecords.map((r) => r.agentIndex)).toEqual([0, 1, 0, 1, 0, 1, 0, 1]);
	});

	test("skips tick when no action is generatable", async () => {
		const clock = new FakeClock();
		const actionRecords: RunnerActionRecord[] = [];
		const agent = new FakeAgent(0, 42, createMinimalState("A"));

		const runner = new TestRunner(
			[agent],
			{
				convergenceIntervalMs: 500,
				quiescenceMs: 0,
				recorder: {
					recordAction: (record) => {
						actionRecords.push(record);
					},
				},
			},
			{
				now: clock.now,
				sleep: clock.sleep,
				canGenerateAction: async () => false,
				generateAction: async () => null,
				executeAction: async () => ({ executed: true }),
				checkConvergence: () => ({ converged: true, invariantViolations: [], comparisonDiffs: [] }),
				formatConvergenceResult: () => "ok",
			},
		);

		const result = await runner.runPhase({
			phaseName: "normal",
			config: {
				actionDelayMs: [100, 100],
				weights: {
					createNode: 1,
					createSplitterMerger: 0,
					createTextNote: 0,
					connectNodes: 0,
					connectViaOverlay: 0,
					attemptInvalidConnection: 0,
					moveNode: 0,
					moveSelectedNodes: 0,
					modifyNodeProperty: 0,
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
					panView: 0,
					zoomView: 0,
					disconnectAndReconnect: 0,
					selectRandom: 0,
				},
			},
			durationMs: 250,
		});

		expect(result.tickCount).toBe(3);
		expect(result.executedActionCount).toBe(0);
		expect(result.skippedTickCount).toBe(3);
		expect(actionRecords.every((r) => !r.executed)).toBe(true);
		expect(actionRecords.every((r) => r.skippedReason === "no-generatable-actions")).toBe(true);
	});

	test("throws when final convergence check fails", async () => {
		const clock = new FakeClock();
		const agent = new FakeAgent(0, 99, createMinimalState("A"));

		const runner = new TestRunner(
			[agent],
			{ convergenceIntervalMs: 10_000, quiescenceMs: 0 },
			{
				now: clock.now,
				sleep: clock.sleep,
				canGenerateAction: async () => true,
				generateAction: async () => ({
					type: "createNode",
					params: { x: 1, y: 1, recipeKey: "Recipe_IronIngot_C" },
				}),
				executeAction: async () => ({ executed: true }),
				checkConvergence: () => ({
					converged: false,
					invariantViolations: [],
					comparisonDiffs: [
						{
							agentA: 0,
							agentB: 1,
							result: {
								equal: false,
								diffs: [
									{ path: ".pages[0].name", a: "A", b: "B", message: "Value mismatch" },
								],
							},
						},
					],
				}),
				formatConvergenceResult: () => "diff",
			},
		);

		await expect(
			runner.runPhase({
				phaseName: "normal",
				config: {
					actionDelayMs: [1, 1],
					weights: {
						createNode: 1,
						createSplitterMerger: 0,
						createTextNote: 0,
						connectNodes: 0,
						connectViaOverlay: 0,
						attemptInvalidConnection: 0,
						moveNode: 0,
						moveSelectedNodes: 0,
						modifyNodeProperty: 0,
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
						panView: 0,
						zoomView: 0,
						disconnectAndReconnect: 0,
						selectRandom: 0,
					},
				},
				durationMs: 1,
			}),
		).rejects.toThrow(/Convergence failed/);
	});

	test("exposes expected phase presets", async () => {
		expect(RUNNER_PRESETS.warmup.durationMs).toBe(30_000);
		expect(RUNNER_PRESETS.normal.durationMs).toBe(60_000);
		expect(RUNNER_PRESETS.highContention.durationMs).toBe(30_000);
		expect(RUNNER_PRESETS.churn.durationMs).toBe(20_000);
	});
});