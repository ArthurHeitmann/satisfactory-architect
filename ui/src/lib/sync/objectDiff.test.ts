import { describe, it, expect } from "vitest";
import { computeNodeDiff, computeEdgeDiff, applyDiffToJson } from "./objectDiff";
import type { GraphNodeJson, GraphEdgeJson } from "../../../../server/shared/types_serialization";

// ---------------------------------------------------------------------------
// Minimal fixture builders
// ---------------------------------------------------------------------------

function baseNode(overrides: Partial<GraphNodeJson> = {}): GraphNodeJson {
	return {
		id: "node-1",
		position: { x: 0, y: 0 },
		priority: 1,
		edges: [],
		parentNode: null,
		children: [],
		properties: { type: "resource-joint" },
		size: { x: 100, y: 60 },
		...overrides,
	};
}

function productionNode(overrides: Record<string, unknown> = {}): GraphNodeJson {
	return baseNode({
		properties: {
			type: "production",
			resourceJoints: [],
			multiplier: 1,
			autoMultiplier: false,
			details: { type: "basic" },
			...overrides,
		},
	});
}

function factoryRefNode(jointsToExternalNodes: Record<string, string> = {}): GraphNodeJson {
	return baseNode({
		properties: {
			type: "production",
			resourceJoints: [],
			multiplier: 1,
			autoMultiplier: false,
			details: {
				type: "factory-reference",
				factoryId: "page-2",
				jointsToExternalNodes,
			},
		},
	});
}

function baseEdge(overrides: Partial<GraphEdgeJson> = {}): GraphEdgeJson {
	return {
		id: "edge-1",
		type: "resource",
		startNodeId: "node-a",
		endNodeId: "node-b",
		properties: {},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// computeNodeDiff
// ---------------------------------------------------------------------------

describe("computeNodeDiff", () => {
	it("returns no ops when nodes are identical", () => {
		const node = baseNode();
		expect(computeNodeDiff(node, node)).toEqual([]);
	});

	it("returns no ops for deep-equal nodes", () => {
		const a = baseNode({ edges: ["e1", "e2"] });
		const b = baseNode({ edges: ["e1", "e2"] });
		expect(computeNodeDiff(a, b)).toEqual([]);
	});

	it("emits set op for position change", () => {
		const a = baseNode({ position: { x: 0, y: 0 } });
		const b = baseNode({ position: { x: 10, y: 20 } });
		expect(computeNodeDiff(a, b)).toContainEqual({ op: "set", path: "position", value: { x: 10, y: 20 } });
	});

	it("emits set op for priority change", () => {
		const a = baseNode({ priority: 1 });
		const b = baseNode({ priority: 5 });
		expect(computeNodeDiff(a, b)).toContainEqual({ op: "set", path: "priority", value: 5 });
	});

	it("emits set op for parentNode change", () => {
		const a = baseNode({ parentNode: null });
		const b = baseNode({ parentNode: "parent-1" });
		expect(computeNodeDiff(a, b)).toContainEqual({ op: "set", path: "parentNode", value: "parent-1" });
	});

	describe("edges (set_members)", () => {
		it("emits set_add when an edge id is added", () => {
			const a = baseNode({ edges: ["e1"] });
			const b = baseNode({ edges: ["e1", "e2"] });
			expect(computeNodeDiff(a, b)).toContainEqual({ op: "set_add", path: "edges", value: "e2" });
		});

		it("emits set_remove when an edge id is removed", () => {
			const a = baseNode({ edges: ["e1", "e2"] });
			const b = baseNode({ edges: ["e1"] });
			expect(computeNodeDiff(a, b)).toContainEqual({ op: "set_remove", path: "edges", value: "e2" });
		});

		it("emits both set_add and set_remove when edges differ", () => {
			const a = baseNode({ edges: ["e1", "e2"] });
			const b = baseNode({ edges: ["e1", "e3"] });
			const ops = computeNodeDiff(a, b);
			expect(ops).toContainEqual({ op: "set_remove", path: "edges", value: "e2" });
			expect(ops).toContainEqual({ op: "set_add",    path: "edges", value: "e3" });
		});

		it("produces no edge ops when edges are the same set in different order", () => {
			const a = baseNode({ edges: ["e1", "e2"] });
			const b = baseNode({ edges: ["e2", "e1"] });
			const ops = computeNodeDiff(a, b);
			expect(ops.filter(o => o.path === "edges")).toEqual([]);
		});
	});

	describe("children (set_members)", () => {
		it("emits set_add when a child is added", () => {
			const a = baseNode({ children: [] });
			const b = baseNode({ children: ["c1"] });
			expect(computeNodeDiff(a, b)).toContainEqual({ op: "set_add", path: "children", value: "c1" });
		});

		it("emits set_remove when a child is removed", () => {
			const a = baseNode({ children: ["c1"] });
			const b = baseNode({ children: [] });
			expect(computeNodeDiff(a, b)).toContainEqual({ op: "set_remove", path: "children", value: "c1" });
		});
	});

	describe("properties – production variant", () => {
		it("emits set op for multiplier change", () => {
			const a = productionNode({ multiplier: 1 });
			const b = productionNode({ multiplier: 2 });
			expect(computeNodeDiff(a, b)).toContainEqual({ op: "set", path: "properties.multiplier", value: 2 });
		});

		it("emits set op when resourceJoints array changes (array strategy = full replacement)", () => {
			const joint1 = { id: "j1", type: "input" };
			const joint2 = { id: "j2", type: "output" };
			const a = productionNode({ resourceJoints: [joint1] });
			const b = productionNode({ resourceJoints: [joint1, joint2] });
			expect(computeNodeDiff(a, b)).toContainEqual({
				op: "set",
				path: "properties.resourceJoints",
				value: [joint1, joint2],
			});
		});

		it("emits no ops when resourceJoints is unchanged", () => {
			const joint = { id: "j1", type: "input" };
			const a = productionNode({ resourceJoints: [joint] });
			const b = productionNode({ resourceJoints: [joint] });
			const ops = computeNodeDiff(a, b);
			expect(ops.filter(o => o.path === "properties.resourceJoints")).toEqual([]);
		});
	});

	describe("properties – factory-reference variant (jointsToExternalNodes map)", () => {
		it("emits map_put when a joint entry is added", () => {
			const a = factoryRefNode({});
			const b = factoryRefNode({ "j1": "ext-1" });
			expect(computeNodeDiff(a, b)).toContainEqual({
				op: "map_put",
				path: "properties.details.jointsToExternalNodes",
				key: "j1",
				value: "ext-1",
			});
		});

		it("emits map_delete when a joint entry is removed", () => {
			const a = factoryRefNode({ "j1": "ext-1" });
			const b = factoryRefNode({});
			expect(computeNodeDiff(a, b)).toContainEqual({
				op: "map_delete",
				path: "properties.details.jointsToExternalNodes",
				key: "j1",
			});
		});

		it("emits map_put when a joint mapping changes value", () => {
			const a = factoryRefNode({ "j1": "ext-1" });
			const b = factoryRefNode({ "j1": "ext-2" });
			expect(computeNodeDiff(a, b)).toContainEqual({
				op: "map_put",
				path: "properties.details.jointsToExternalNodes",
				key: "j1",
				value: "ext-2",
			});
		});

		it("emits no map ops when jointsToExternalNodes is unchanged", () => {
			const a = factoryRefNode({ "j1": "ext-1" });
			const b = factoryRefNode({ "j1": "ext-1" });
			expect(computeNodeDiff(a, b)).toEqual([]);
		});
	});

	describe("properties – unknown variant (default set fallback)", () => {
		it("emits set op for changed fields on an unknown properties type", () => {
			const a = baseNode({ properties: { type: "custom-type", value: 1 } });
			const b = baseNode({ properties: { type: "custom-type", value: 2 } });
			expect(computeNodeDiff(a, b)).toContainEqual({ op: "set", path: "properties.value", value: 2 });
		});
	});
});

// ---------------------------------------------------------------------------
// computeEdgeDiff
// ---------------------------------------------------------------------------

describe("computeEdgeDiff", () => {
	it("returns no ops when edges are identical", () => {
		const edge = baseEdge();
		expect(computeEdgeDiff(edge, edge)).toEqual([]);
	});

	it("emits set op for startNodeId change", () => {
		const a = baseEdge({ startNodeId: "node-a" });
		const b = baseEdge({ startNodeId: "node-z" });
		expect(computeEdgeDiff(a, b)).toContainEqual({ op: "set", path: "startNodeId", value: "node-z" });
	});

	it("emits set op for endNodeId change", () => {
		const a = baseEdge({ endNodeId: "node-b" });
		const b = baseEdge({ endNodeId: "node-y" });
		expect(computeEdgeDiff(a, b)).toContainEqual({ op: "set", path: "endNodeId", value: "node-y" });
	});

	it("emits set op for straightLineOffsets change (array strategy = full replacement)", () => {
		const a = baseEdge({ properties: { straightLineOffsets: [{ x: 0, y: 0 }] } });
		const b = baseEdge({ properties: { straightLineOffsets: [{ x: 0, y: 0 }, { x: 10, y: 5 }] } });
		expect(computeEdgeDiff(a, b)).toContainEqual({
			op: "set",
			path: "properties.straightLineOffsets",
			value: [{ x: 0, y: 0 }, { x: 10, y: 5 }],
		});
	});

	it("emits no ops when straightLineOffsets is unchanged", () => {
		const offsets = [{ x: 1, y: 2 }];
		const a = baseEdge({ properties: { straightLineOffsets: offsets } });
		const b = baseEdge({ properties: { straightLineOffsets: offsets } });
		expect(computeEdgeDiff(a, b)).toEqual([]);
	});

	it("emits set op for an arbitrary properties field (default set)", () => {
		const a = baseEdge({ properties: { color: "red" } });
		const b = baseEdge({ properties: { color: "blue" } });
		expect(computeEdgeDiff(a, b)).toContainEqual({ op: "set", path: "properties.color", value: "blue" });
	});
});

// ---------------------------------------------------------------------------
// applyDiffToJson
// ---------------------------------------------------------------------------

describe("applyDiffToJson", () => {
	it("applies a set op on a top-level field", () => {
		const json: Record<string, unknown> = { x: 1 };
		applyDiffToJson(json, [{ op: "set", path: "x", value: 99 }]);
		expect(json.x).toBe(99);
	});

	it("applies a set op on a nested field", () => {
		const json: Record<string, unknown> = { a: { b: 1 } };
		applyDiffToJson(json, [{ op: "set", path: "a.b", value: 42 }]);
		expect((json.a as any).b).toBe(42);
	});

	it("applies set_add to a string array", () => {
		const json: Record<string, unknown> = { tags: ["a"] };
		applyDiffToJson(json, [{ op: "set_add", path: "tags", value: "b" }]);
		expect(json.tags).toEqual(["a", "b"]);
	});

	it("set_add is idempotent for duplicates", () => {
		const json: Record<string, unknown> = { tags: ["a"] };
		applyDiffToJson(json, [{ op: "set_add", path: "tags", value: "a" }]);
		expect(json.tags).toEqual(["a"]);
	});

	it("applies set_remove from a string array", () => {
		const json: Record<string, unknown> = { tags: ["a", "b"] };
		applyDiffToJson(json, [{ op: "set_remove", path: "tags", value: "a" }]);
		expect(json.tags).toEqual(["b"]);
	});

	it("set_remove is a no-op when value is absent", () => {
		const json: Record<string, unknown> = { tags: ["a"] };
		applyDiffToJson(json, [{ op: "set_remove", path: "tags", value: "z" }]);
		expect(json.tags).toEqual(["a"]);
	});

	it("applies map_put to a nested record", () => {
		const json: Record<string, unknown> = { m: {} };
		applyDiffToJson(json, [{ op: "map_put", path: "m", key: "k1", value: "v1" }]);
		expect((json.m as any).k1).toBe("v1");
	});

	it("applies map_delete from a nested record", () => {
		const json: Record<string, unknown> = { m: { k1: "v1", k2: "v2" } };
		applyDiffToJson(json, [{ op: "map_delete", path: "m", key: "k1" }]);
		expect(json.m).toEqual({ k2: "v2" });
	});

	it("applies multiple ops in order", () => {
		const json: Record<string, unknown> = { edges: ["e1", "e2"], priority: 1 };
		applyDiffToJson(json, [
			{ op: "set_remove", path: "edges", value: "e2" },
			{ op: "set_add",    path: "edges", value: "e3" },
			{ op: "set",        path: "priority", value: 5 },
		]);
		expect(json.edges).toEqual(["e1", "e3"]);
		expect(json.priority).toBe(5);
	});

	it("is a no-op when path traversal reaches a non-object intermediate", () => {
		const json: Record<string, unknown> = { a: 42 };
		// Should not throw; simply does nothing
		expect(() => applyDiffToJson(json, [{ op: "set", path: "a.b", value: 1 }])).not.toThrow();
		expect(json.a).toBe(42);
	});
});
