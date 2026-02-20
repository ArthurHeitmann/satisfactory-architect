import { expect, test } from "@playwright/test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryRecorder } from "./HistoryRecorder";
import type { AppStateJson } from "../../../server/shared/types_serialization";

function state(name: string): AppStateJson {
	return {
		version: 1,
		type: "app-state",
		idGen: "1",
		name,
		currentPageId: "p1",
		pages: [
			{
				version: 1,
				type: "graph-page",
				id: "p1",
				name: "P",
				icon: "",
				view: { offset: { x: 0, y: 0 }, scale: 1, enableGridSnap: false },
				toolMode: "select-nodes",
				selectedNodes: [],
				selectedEdges: [],
				nodes: {},
				edges: {},
			},
		],
	};
}

test("history recorder dumps failure artifacts", async () => {
	const recorder = new HistoryRecorder();
	recorder.bindAgents([
		{
			index: 0,
			getAppState: async () => state("a"),
			drainWebSocketEvents: async () => [
				{ timestamp: 1000, direction: "sent", data: "[1,2]" },
				{ timestamp: 1100, direction: "received", data: "[3,4]" },
			],
		},
	]);

	await recorder.recordAction({
		timestamp: 1200,
		agentIndex: 0,
		actionType: "createNode",
		action: { type: "createNode", params: { x: 1, y: 2, recipeKey: "Recipe_Wire_C" } },
		executed: true,
		durationMs: 55,
	});
	await recorder.recordSnapshot({
		timestamp: 1300,
		phase: "normal",
		reason: "periodic",
		states: [state("s")],
	});

	const outRoot = await mkdtemp(join(tmpdir(), "satisfactory-architect-recorder-"));
	try {
		const reportDir = await recorder.dumpFailureReport({
			seed: 42,
			phaseSummaries: [
				{
					phaseName: "normal",
					durationMs: 1000,
					tickCount: 10,
					executedActionCount: 10,
					skippedTickCount: 0,
				},
			],
			failureReason: "synthetic-failure",
			outputRootDir: outRoot,
			timestamp: 9999,
		});

		const files = await readdir(reportDir);
		expect(files).toContain("actions.jsonl");
		expect(files).toContain("commands.jsonl");
		expect(files).toContain("metadata.json");
		expect(files).toContain("snapshots.jsonl");
		expect(files).toContain("final-states");

		const commands = await readFile(join(reportDir, "commands.jsonl"), "utf8");
		expect(commands).toContain("\"direction\":\"sent\"");
		expect(commands).toContain("\"direction\":\"received\"");

		const metadata = await readFile(join(reportDir, "metadata.json"), "utf8");
		expect(metadata).toContain("synthetic-failure");
		expect(metadata).toContain("\"seed\": 42");
	} finally {
		await rm(outRoot, { recursive: true, force: true });
	}
});
