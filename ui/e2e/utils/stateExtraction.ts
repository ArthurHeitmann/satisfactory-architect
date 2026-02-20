/**
 * State extraction and normalization for convergence comparison.
 *
 * Extracts `appState.toJSON()` from a Playwright page, strips local-only
 * fields, and normalizes the result into a canonical form suitable for
 * float-tolerant deep comparison across agents.
 */

import type { Page } from "@playwright/test";
import type {
	AppStateJson,
	GraphPageJson,
} from "../../../server/shared/types_serialization";
import { floatTolerantDeepEqual, type ComparisonResult } from "./floatTolerantDeepEqual";
import { checkInvariants, type InvariantViolation } from "./invariantChecker";

/**
 * Serialized app state with local-only fields stripped.
 * This is the shape used for cross-agent convergence comparison.
 */
export interface NormalizedAppState {
	version: number;
	type: string;
	name?: string;
	pages: NormalizedPage[];
}

export interface NormalizedPage {
	id: string;
	name: string;
	icon: string;
	nodes: Record<string, unknown>;
	edges: Record<string, unknown>;
}

/**
 * Fields stripped from each page before comparison.
 * These are per-client local state that legitimately differs between agents.
 */
const LOCAL_ONLY_PAGE_FIELDS: readonly (keyof GraphPageJson)[] = [
	"view",
	"selectedNodes",
	"selectedEdges",
	"toolMode",
];

/**
 * Fields stripped from the root AppState before comparison.
 */
const LOCAL_ONLY_ROOT_FIELDS: readonly (keyof AppStateJson)[] = [
	"currentPageId",
];

/**
 * Extract the full AppState JSON from a Playwright page.
 * Requires the page to have been loaded with `?e2e=1`.
 */
export async function extractAppState(page: Page): Promise<AppStateJson> {
	return await page.evaluate(() => {
		const appState = (window as any).__appState;
		if (!appState) {
			throw new Error("__appState not found — was the page loaded with ?e2e=1?");
		}
		return appState.toJSON();
	});
}

/**
 * Normalize a serialized AppState for convergence comparison by:
 * 1. Stripping local-only fields (view, selected, toolMode, currentPageId)
 * 2. Sorting pages by ID for canonical ordering
 */
export function normalizeState(state: AppStateJson): NormalizedAppState {
	const pages: NormalizedPage[] = state.pages
		.map((page): NormalizedPage => {
			return {
				id: page.id,
				name: page.name,
				icon: page.icon,
				nodes: page.nodes,
				edges: page.edges,
			};
		})
		.sort((a, b) => a.id.localeCompare(b.id));

	// Copy root, omitting local-only fields
	const normalized: NormalizedAppState = {
		version: state.version,
		type: state.type,
		name: state.name,
		pages,
	};

	return normalized;
}

/**
 * Result of a full convergence check across all agents.
 */
export interface ConvergenceResult {
	/** Whether all agents have converged to the same state. */
	converged: boolean;
	/** Invariant violations found on any agent. */
	invariantViolations: { agentIndex: number; violations: InvariantViolation[] }[];
	/** Pairwise comparison diffs (only populated if not converged). */
	comparisonDiffs: { agentA: number; agentB: number; result: ComparisonResult }[];
}

/**
 * Check convergence across multiple agents' states.
 *
 * 1. Run structural invariant checks on every agent's raw state.
 * 2. Normalize all states.
 * 3. Pairwise float-tolerant comparison.
 *
 * @param states  Raw `AppStateJson` from each agent (in agent-index order)
 * @param epsilon Float tolerance (default 1e-6)
 */
export function checkConvergence(
	states: AppStateJson[],
	epsilon: number = 1e-6,
): ConvergenceResult {
	const result: ConvergenceResult = {
		converged: true,
		invariantViolations: [],
		comparisonDiffs: [],
	};

	// 1. Invariant checks
	for (let i = 0; i < states.length; i++) {
		const violations = checkInvariants(states[i]);
		if (violations.length > 0) {
			result.converged = false;
			result.invariantViolations.push({ agentIndex: i, violations });
		}
	}

	// 2. Normalize
	const normalized = states.map(normalizeState);

	// 3. Compare all against the first agent
	for (let i = 1; i < normalized.length; i++) {
		const cmp = floatTolerantDeepEqual(normalized[0], normalized[i], epsilon);
		if (!cmp.equal) {
			result.converged = false;
			result.comparisonDiffs.push({
				agentA: 0,
				agentB: i,
				result: cmp,
			});
		}
	}

	return result;
}

/**
 * Format a convergence result into a human-readable string for test output.
 */
export function formatConvergenceResult(result: ConvergenceResult): string {
	if (result.converged) return "All agents converged.";

	const lines: string[] = ["Convergence check FAILED:"];

	for (const { agentIndex, violations } of result.invariantViolations) {
		lines.push(`  Agent ${agentIndex} invariant violations:`);
		for (const v of violations) {
			lines.push(`    [${v.rule}] ${v.message}${v.pageId ? ` (page: ${v.pageId})` : ""}`);
		}
	}

	for (const { agentA, agentB, result: cmp } of result.comparisonDiffs) {
		lines.push(`  Diff between Agent ${agentA} and Agent ${agentB}:`);
		for (const d of cmp.diffs) {
			lines.push(`    ${d.path}: ${d.message}`);
		}
	}

	return lines.join("\n");
}

/**
 * Assert that states have converged; throws with detailed diagnostics otherwise.
 */
export function assertConverged(
	states: AppStateJson[],
	epsilon: number = 1e-6,
	context: string = "Convergence check failed",
): ConvergenceResult {
	const result = checkConvergence(states, epsilon);
	if (!result.converged) {
		throw new Error(`${context}\n${formatConvergenceResult(result)}`);
	}
	return result;
}
