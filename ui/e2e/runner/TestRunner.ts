import type { AppStateJson } from "../../../server/shared/types_serialization";
import {
	ALL_ACTION_TYPES,
	CONFIGS,
	pickWeightedAction,
	type ActionType,
	type ActionWeights,
	type AgentConfig,
} from "../utils/ActionWeights";
import type { SeededRandom } from "../utils/SeededRandom";
import { canGenerateAction, executeAction, generateAction } from "../actions/actions";
import type { Action, ActionResult } from "../actions/types";
import {
	checkConvergence,
	formatConvergenceResult,
	type ConvergenceResult,
} from "../utils/stateExtraction";

export interface RunnerAgent {
	index: number;
	rng: SeededRandom;
	getAppState(): Promise<AppStateJson>;
	hasErrors(): boolean;
	formatErrors(): string;
}

export interface RunnerActionRecord {
	timestamp: number;
	agentIndex: number;
	actionType: ActionType | null;
	action: Action | null;
	executed: boolean;
	skippedReason?: string;
	durationMs: number;
}

export interface RunnerConvergenceRecord {
	timestamp: number;
	phase: string;
	reason: "periodic" | "final";
	result: ConvergenceResult;
}

export interface RunnerSnapshotRecord {
	timestamp: number;
	phase: string;
	reason: "periodic" | "final";
	states: AppStateJson[];
}

interface PlannedTick {
	agent: RunnerAgent;
	timestamp: number;
	actionType: ActionType | null;
	action: Action | null;
	preSkippedReason?: string;
}

export interface RunnerRecorder {
	recordAction?(record: RunnerActionRecord): void | Promise<void>;
	recordConvergence?(record: RunnerConvergenceRecord): void | Promise<void>;
	recordSnapshot?(record: RunnerSnapshotRecord): void | Promise<void>;
}

export interface RunnerDependencies {
	now(): number;
	sleep(ms: number): Promise<void>;
	canGenerateAction(actionType: ActionType, agent: RunnerAgent): Promise<boolean>;
	generateAction(actionType: ActionType, agent: RunnerAgent): Promise<Action | null>;
	executeAction(action: Action, agent: RunnerAgent): Promise<ActionResult>;
	checkConvergence(states: AppStateJson[], epsilon: number): ConvergenceResult;
	formatConvergenceResult(result: ConvergenceResult): string;
	getAppState(agent: RunnerAgent): Promise<AppStateJson>;
}

const DEFAULT_DEPS: RunnerDependencies = {
	now: () => Date.now(),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	canGenerateAction,
	generateAction,
	executeAction,
	checkConvergence,
	formatConvergenceResult,
	getAppState: (agent) => agent.getAppState(),
};

export interface TestRunnerOptions {
	epsilon?: number;
	convergenceIntervalMs?: number;
	preConvergenceWaitMs?: number;
	quiescenceMs?: number;
	maxGenerateAttemptsPerTick?: number;
	captureAllStatesInSnapshots?: boolean;
	recorder?: RunnerRecorder;
}

export interface RunPhaseInput {
	phaseName: string;
	config: AgentConfig;
	durationMs: number;
	runQuiescence?: boolean;
}

export interface RunPhaseResult {
	phaseName: string;
	durationMs: number;
	tickCount: number;
	executedActionCount: number;
	skippedTickCount: number;
	convergenceChecks: number;
	periodicChecks: number;
	finalCheck: ConvergenceResult;
}

export interface RunnerPreset {
	config: AgentConfig;
	durationMs: number;
}

export const RUNNER_PRESETS: Record<"warmup" | "normal" | "highContention" | "churn", RunnerPreset> = {
	warmup: {
		config: CONFIGS.warmup,
		durationMs: 30_000,
	},
	normal: {
		config: CONFIGS.normal,
		durationMs: 60_000,
	},
	highContention: {
		config: CONFIGS.highContention,
		durationMs: 30_000,
	},
	churn: {
		config: CONFIGS.churn,
		durationMs: 20_000,
	},
};

export class TestRunner {
	private readonly agents: RunnerAgent[];
	private readonly agentsByIndex: RunnerAgent[];
	private readonly deps: RunnerDependencies;
	private readonly options: Required<Omit<TestRunnerOptions, "recorder">> & {
		recorder?: RunnerRecorder;
	};

	constructor(
		agents: RunnerAgent[],
		options: TestRunnerOptions = {},
		deps: Partial<RunnerDependencies> = {},
	) {
		if (agents.length === 0) {
			throw new Error("TestRunner requires at least one agent");
		}

		this.agents = agents;
		this.agentsByIndex = [...agents].sort((a, b) => a.index - b.index);
		this.deps = { ...DEFAULT_DEPS, ...deps };
		this.options = {
			epsilon: options.epsilon ?? 1e-6,
			convergenceIntervalMs: options.convergenceIntervalMs ?? 2_000,
			preConvergenceWaitMs: options.preConvergenceWaitMs ?? 250,
			quiescenceMs: options.quiescenceMs ?? 5_000,
			maxGenerateAttemptsPerTick: options.maxGenerateAttemptsPerTick ?? 4,
			captureAllStatesInSnapshots: options.captureAllStatesInSnapshots ?? false,
			recorder: options.recorder,
		};
	}

	async runPhase(input: RunPhaseInput): Promise<RunPhaseResult> {
		const runQuiescence = input.runQuiescence ?? true;
		const startedAt = this.deps.now();
		const endsAt = startedAt + input.durationMs;
		let nextPeriodicCheckAt = startedAt + this.options.convergenceIntervalMs;

		let tickCount = 0;
		let executedActionCount = 0;
		let skippedTickCount = 0;
		let periodicChecks = 0;

		while (this.deps.now() < endsAt) {
			this.assertNoAgentErrors();

			const tickStartedAt = this.deps.now();
			const plannedTicks: PlannedTick[] = [];
			for (const agent of this.agentsByIndex) {
				plannedTicks.push(await this.planTick(agent, input.config.weights, tickStartedAt));
			}

			const tickRecords = await Promise.all(
				plannedTicks.map((planned) => this.executePlannedTick(planned)),
			);
			tickCount += 1;

			for (const tickRecord of tickRecords) {
				await this.options.recorder?.recordAction?.(tickRecord);
				if (tickRecord.executed) {
					executedActionCount += 1;
				} else {
					skippedTickCount += 1;
				}
			}

			const [minDelay, maxDelay] = input.config.actionDelayMs;
			const delayMs = Math.min(...this.agentsByIndex.map((agent) => agent.rng.nextInt(minDelay, maxDelay)));
			if (delayMs > 0) {
				await this.deps.sleep(delayMs);
			}

			if (this.deps.now() >= nextPeriodicCheckAt) {
				if (this.options.preConvergenceWaitMs > 0) {
					await this.deps.sleep(this.options.preConvergenceWaitMs);
				}
				while (this.deps.now() >= nextPeriodicCheckAt) {
					await this.runConvergenceCheck(input.phaseName, "periodic");
					periodicChecks += 1;
					nextPeriodicCheckAt += this.options.convergenceIntervalMs;
				}
			}
		}

		if (runQuiescence && this.options.quiescenceMs > 0) {
			await this.deps.sleep(this.options.quiescenceMs);
		}
		if (this.options.preConvergenceWaitMs > 0) {
			await this.deps.sleep(this.options.preConvergenceWaitMs);
		}

		const finalCheck = await this.runConvergenceCheck(input.phaseName, "final");

		return {
			phaseName: input.phaseName,
			durationMs: this.deps.now() - startedAt,
			tickCount,
			executedActionCount,
			skippedTickCount,
			convergenceChecks: periodicChecks + 1,
			periodicChecks,
			finalCheck,
		};
	}

	private async planTick(
		agent: RunnerAgent,
		weights: ActionWeights,
		tickStartedAt: number,
	): Promise<PlannedTick> {
		for (let attempt = 0; attempt < this.options.maxGenerateAttemptsPerTick; attempt++) {
			const actionType = await this.pickRunnableActionType(agent, weights);
			if (!actionType) {
				return {
					agent,
					timestamp: tickStartedAt,
					actionType: null,
					action: null,
					preSkippedReason: "no-generatable-actions",
				};
			}

			try {
				const action = await this.deps.generateAction(actionType, agent);
				if (!action) {
					continue;
				}
				return {
					agent,
					timestamp: tickStartedAt,
					actionType,
					action,
				};
			} catch (error) {
				return {
					agent,
					timestamp: tickStartedAt,
					actionType,
					action: null,
					preSkippedReason: `generate-error:${formatError(error)}`,
				};
			}
		}

		throw new Error(
			`Agent ${agent.index}: failed to generate an action after ${this.options.maxGenerateAttemptsPerTick} attempts`,
		);
	}

	private async executePlannedTick(planned: PlannedTick): Promise<RunnerActionRecord> {
		if (!planned.action) {
			return {
				timestamp: planned.timestamp,
				agentIndex: planned.agent.index,
				actionType: planned.actionType,
				action: planned.action,
				executed: false,
				skippedReason: planned.preSkippedReason ?? "no-generatable-actions",
				durationMs: this.deps.now() - planned.timestamp,
			};
		}

		let result: ActionResult;
		try {
			result = await this.deps.executeAction(planned.action, planned.agent);
		} catch (error) {
			return {
				timestamp: planned.timestamp,
				agentIndex: planned.agent.index,
				actionType: planned.actionType,
				action: planned.action,
				executed: false,
				skippedReason: `execute-error:${formatError(error)}`,
				durationMs: this.deps.now() - planned.timestamp,
			};
		}

		return {
			timestamp: planned.timestamp,
			agentIndex: planned.agent.index,
			actionType: planned.actionType,
			action: planned.action,
			executed: result.executed,
			skippedReason: result.skippedReason,
			durationMs: this.deps.now() - planned.timestamp,
		};
	}

	private async pickRunnableActionType(agent: RunnerAgent, weights: ActionWeights): Promise<ActionType | null> {
		const runnableWeights = emptyWeights();
		for (const actionType of ALL_ACTION_TYPES) {
			if (weights[actionType] <= 0) continue;
			const canGenerate = await this.deps.canGenerateAction(actionType, agent);
			if (canGenerate) {
				runnableWeights[actionType] = weights[actionType];
			}
		}

		return pickWeightedAction(runnableWeights, agent.rng);
	}

	private async runConvergenceCheck(
		phaseName: string,
		reason: "periodic" | "final",
	): Promise<ConvergenceResult> {
		const states = await Promise.all(this.agents.map((agent) => this.deps.getAppState(agent)));

		const snapshotStates = this.options.captureAllStatesInSnapshots
			? states
			: [states[0]];

		await this.options.recorder?.recordSnapshot?.({
			timestamp: this.deps.now(),
			phase: phaseName,
			reason,
			states: snapshotStates,
		});

		const result = this.deps.checkConvergence(states, this.options.epsilon);
		await this.options.recorder?.recordConvergence?.({
			timestamp: this.deps.now(),
			phase: phaseName,
			reason,
			result,
		});

		if (!result.converged) {
			throw new Error(
				`Convergence failed during ${phaseName} (${reason})\n${this.deps.formatConvergenceResult(result)}`,
			);
		}

		this.assertNoAgentErrors();
		return result;
	}

	private assertNoAgentErrors(): void {
		const failingAgents = this.agents.filter((agent) => agent.hasErrors());
		if (failingAgents.length === 0) return;

		const details = failingAgents
			.map((agent) => `Agent ${agent.index}:\n${agent.formatErrors()}`)
			.join("\n\n");

		throw new Error(`Agent error(s) detected:\n${details}`);
	}
}

function emptyWeights(): ActionWeights {
	return {
		createNode: 0,
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
	};
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message.replace(/\s+/g, " ").slice(0, 200);
	}
	return String(error).replace(/\s+/g, " ").slice(0, 200);
}