import { expect, test } from "@playwright/test";
import { checkConvergence } from "../utils/stateExtraction";
import { floatTolerantDeepEqual } from "../utils/floatTolerantDeepEqual";
import { checkInvariants } from "../utils/invariantChecker";
import { SeededRandom } from "../utils/SeededRandom";
import { pickWeightedAction, type ActionWeights } from "../utils/ActionWeights";
import type { AppStateJson } from "../../../server/shared/types_serialization";

function baseState(name: string = "A"): AppStateJson {
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
				name: "Page 1",
				icon: "",
				view: { offset: { x: 0, y: 0 }, scale: 1, enableGridSnap: false },
				toolMode: "select-nodes",
				selectedNodes: [],
				selectedEdges: [],
				nodes: {
					n1: {
						id: "n1",
						position: { x: 0, y: 0 },
						priority: 0,
						edges: ["e1"],
						parentNode: null,
						children: [],
						properties: { type: "text-note" },
						size: { x: 100, y: 100 },
					},
					n2: {
						id: "n2",
						position: { x: 10, y: 10 },
						priority: 0,
						edges: ["e1"],
						parentNode: null,
						children: [],
						properties: { type: "text-note" },
						size: { x: 100, y: 100 },
					},
				},
				edges: {
					e1: {
						id: "e1",
						type: "graph-edge",
						startNodeId: "n1",
						endNodeId: "n2",
						properties: {},
					},
				},
			},
		],
	};
}

const SIMPLE_WEIGHTS: ActionWeights = {
	createNode: 3,
	createSplitterMerger: 0,
	createTextNote: 1,
	connectNodes: 0,
	connectViaOverlay: 0,
	attemptInvalidConnection: 0,
	moveNode: 2,
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

test.describe("infrastructure: state and utility checks", () => {
	test("convergence verifier detects equal and diff states", async () => {
		const s1 = baseState("Alpha");
		const s2 = baseState("Alpha");
		s2.currentPageId = "p1";
		s2.pages[0].view.offset.x = 999;
		const equalRes = checkConvergence([s1, s2]);
		expect(equalRes.converged).toBe(true);

		const s3 = baseState("Alpha");
		s3.pages[0].name = "Other";
		const diffRes = checkConvergence([s1, s3]);
		expect(diffRes.converged).toBe(false);
		expect(diffRes.comparisonDiffs.length).toBeGreaterThan(0);
	});

	test("seeded random reproducibility", async () => {
		const runSeq = (seed: number) => {
			const rng = new SeededRandom(seed);
			const out: string[] = [];
			for (let i = 0; i < 20; i++) {
				const action = pickWeightedAction(SIMPLE_WEIGHTS, rng);
				out.push(action ?? "none");
			}
			return out;
		};

		const a = runSeq(1234);
		const b = runSeq(1234);
		const c = runSeq(4321);
		expect(a).toEqual(b);
		expect(c).not.toEqual(a);
	});

	test("float tolerant compare epsilon handling", async () => {
		const within = floatTolerantDeepEqual({ x: 1.0 }, { x: 1.0 + 5e-7 }, 1e-6);
		expect(within.equal).toBe(true);

		const outside = floatTolerantDeepEqual({ x: 1.0 }, { x: 1.0 + 2e-5 }, 1e-6);
		expect(outside.equal).toBe(false);
		expect(outside.diffs.length).toBeGreaterThan(0);
	});

	test("invariant checker valid and invalid states", async () => {
		const valid = baseState();
		expect(checkInvariants(valid)).toEqual([]);

		const invalid = baseState();
		invalid.pages[0].edges.e1.startNodeId = "missing-node";
		const violations = checkInvariants(invalid);
		expect(violations.length).toBeGreaterThan(0);
		expect(violations.some((v) => v.rule === "no-orphan-edges")).toBe(true);
	});
});
