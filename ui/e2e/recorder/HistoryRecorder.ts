import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppStateJson } from "../../../server/shared/types_serialization";
import type {
	RunnerActionRecord,
	RunnerConvergenceRecord,
	RunnerRecorder,
	RunnerSnapshotRecord,
} from "../runner/TestRunner";
import type { WebSocketCommandEvent } from "../utils/Agent";

const HERE = dirname(fileURLToPath(import.meta.url));
const E2E_ROOT = resolve(HERE, "..");
const FAILURE_REPORTS_ROOT = resolve(E2E_ROOT, "failure-reports");

export interface RecorderAgentHandle {
	index: number;
	getAppState(): Promise<AppStateJson>;
	drainWebSocketEvents?(): Promise<WebSocketCommandEvent[]>;
}

export interface RecordedAction {
	timestamp: number;
	agentId: number;
	actionName: string | null;
	params: Record<string, unknown> | null;
	executed: boolean;
	skippedReason?: string;
	durationMs: number;
}

export interface RecordedCommand {
	timestamp: number;
	agentId: number;
	direction: "sent" | "received";
	data: string;
}

export interface RecordedSnapshot {
	timestamp: number;
	phase: string;
	reason: "periodic" | "final";
	states: AppStateJson[];
}

export interface RecorderMetadata {
	seed: number;
	agentCount: number;
	startedAt: number;
	endedAt: number;
	phaseSummaries: Array<{
		phaseName: string;
		durationMs: number;
		tickCount: number;
		executedActionCount: number;
		skippedTickCount: number;
	}>;
	failureReason: string;
	actionCount: number;
	commandCount: number;
	snapshotCount: number;
	lastSnapshotTimestamp: number | null;
}

export interface DumpFailureOptions {
	seed: number;
	phaseSummaries: RecorderMetadata["phaseSummaries"];
	failureReason: string;
	timestamp?: number;
	outputRootDir?: string;
}

export class HistoryRecorder implements RunnerRecorder {
	readonly actions: RecordedAction[] = [];
	readonly commands: RecordedCommand[] = [];
	readonly snapshots: RecordedSnapshot[] = [];
	readonly convergences: RunnerConvergenceRecord[] = [];

	private readonly agentsByIndex = new Map<number, RecorderAgentHandle>();

	bindAgents(agents: RecorderAgentHandle[]): void {
		this.agentsByIndex.clear();
		for (const agent of agents) {
			this.agentsByIndex.set(agent.index, agent);
		}
	}

	async recordAction(record: RunnerActionRecord): Promise<void> {
		this.actions.push({
			timestamp: record.timestamp,
			agentId: record.agentIndex,
			actionName: record.actionType,
			params: record.action ? (record.action.params as Record<string, unknown>) : null,
			executed: record.executed,
			skippedReason: record.skippedReason,
			durationMs: record.durationMs,
		});

		await this.captureCommandLogsForAgent(record.agentIndex);
	}

	recordSnapshot(record: RunnerSnapshotRecord): void {
		this.snapshots.push(record);
	}

	recordConvergence(record: RunnerConvergenceRecord): void {
		this.convergences.push(record);
	}

	async capturePendingCommandLogs(): Promise<void> {
		const agentIndices = [...this.agentsByIndex.keys()];
		for (const agentIndex of agentIndices) {
			await this.captureCommandLogsForAgent(agentIndex);
		}
	}

	async dumpFailureReport(options: DumpFailureOptions): Promise<string> {
		await this.capturePendingCommandLogs();

		const now = options.timestamp ?? Date.now();
		const rootDir = options.outputRootDir ?? FAILURE_REPORTS_ROOT;
		const reportDir = resolve(rootDir, `${options.seed}-${now}`);
		const statesDir = resolve(reportDir, "final-states");
		await mkdir(statesDir, { recursive: true });

		await writeFile(resolve(reportDir, "actions.jsonl"), toJsonLines(this.actions), "utf8");
		await writeFile(resolve(reportDir, "commands.jsonl"), toJsonLines(this.commands), "utf8");
		await writeFile(resolve(reportDir, "snapshots.jsonl"), toJsonLines(this.snapshots), "utf8");

		for (const agent of this.agentsByIndex.values()) {
			try {
				const state = await agent.getAppState();
				await writeFile(
					resolve(statesDir, `agent-${agent.index}.json`),
					JSON.stringify(state, null, 2),
					"utf8",
				);
			} catch (error) {
				await writeFile(
					resolve(statesDir, `agent-${agent.index}.json`),
					JSON.stringify({
						error: "failed-to-capture-state",
						message: String(error),
					}, null, 2),
					"utf8",
				);
			}
		}

		const metadata: RecorderMetadata = {
			seed: options.seed,
			agentCount: this.agentsByIndex.size,
			startedAt: this.actions[0]?.timestamp ?? now,
			endedAt: now,
			phaseSummaries: options.phaseSummaries,
			failureReason: options.failureReason,
			actionCount: this.actions.length,
			commandCount: this.commands.length,
			snapshotCount: this.snapshots.length,
			lastSnapshotTimestamp: this.snapshots.length > 0
				? this.snapshots[this.snapshots.length - 1].timestamp
				: null,
		};

		await writeFile(resolve(reportDir, "metadata.json"), JSON.stringify(metadata, null, 2), "utf8");
		return reportDir;
	}

	private async captureCommandLogsForAgent(agentIndex: number): Promise<void> {
		const agent = this.agentsByIndex.get(agentIndex);
		if (!agent?.drainWebSocketEvents) return;

		try {
			const events = await agent.drainWebSocketEvents();
			for (const event of events) {
				this.commands.push({
					timestamp: event.timestamp,
					agentId: agentIndex,
					direction: event.direction,
					data: event.data,
				});
			}
		} catch {
			// Page/context may already be closed when handling a failure.
		}
	}
}

function toJsonLines(items: unknown[]): string {
	if (items.length === 0) return "";
	return `${items.map((item) => JSON.stringify(item)).join("\n")}\n`;
}