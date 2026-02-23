/**
 * RoomState unit tests - testing all public interfaces
 */

import { assertEquals, assertThrows } from "@std/assert";
import { beforeEach, describe, it } from "@std/testing/bdd";
import { RoomState } from "./RoomState.ts";
import type { AppStateJson, GraphEdgeJson, GraphNodeJson, GraphPageJson } from "../shared/types_serialization.ts";
import type { Command, ObjectAddCommand, ObjectDeleteCommand, ObjectDiffOperation, ObjectModifyCommand, PageAddCommand, PageDeleteCommand, PageModifyCommand, PageReorderCommand, StateVarUpdateCommand, ViewUpdateCommand } from "../shared/messages.ts";

// ============================================================================
// Test Helpers
// ============================================================================

/** Auto-incrementing command ID generator */
let cmdCounter = 0;
function nextCommandId() {
	return `cmd-${++cmdCounter}`;
}

/** Base command fields for test commands */
function cmd() {
	return { commandId: nextCommandId(), userId: "u1", timestamp: Date.now() };
}

/** Creates a page with defaults */
function createPage(id: string, overrides: Partial<GraphPageJson> = {}): GraphPageJson {
	return {
		version: 1,
		type: "graph-page",
		id,
		name: overrides.name ?? "Test Page",
		icon: overrides.icon ?? "",
		view: overrides.view ?? { offset: { x: 0, y: 0 }, scale: 1, enableGridSnap: true },
		nodes: overrides.nodes ?? {},
		edges: overrides.edges ?? {},
		toolMode: overrides.toolMode ?? "select",
		selectedNodes: overrides.selectedNodes ?? [],
		selectedEdges: overrides.selectedEdges ?? [],
	};
}

/** Creates a node with defaults */
function createNode(id: string, overrides: Partial<GraphNodeJson> = {}): GraphNodeJson {
	return {
		id,
		position: overrides.position ?? { x: 0, y: 0 },
		priority: overrides.priority ?? 1,
		edges: overrides.edges ?? [],
		parentNode: overrides.parentNode ?? null,
		children: overrides.children ?? [],
		properties: overrides.properties ?? {},
		size: overrides.size ?? { x: 100, y: 80 },
	};
}

/** Creates an edge with defaults */
function createEdge(id: string, overrides: Partial<GraphEdgeJson> = {}): GraphEdgeJson {
	return {
		id,
		type: overrides.type ?? "conveyor",
		startNodeId: overrides.startNodeId ?? "node-1",
		endNodeId: overrides.endNodeId ?? "node-2",
		properties: overrides.properties ?? {},
	};
}

/** Creates a minimal valid app state for testing */
function createTestState(overrides: Partial<AppStateJson> = {}): AppStateJson {
	return {
		version: 1,
		type: "app-state",
		idGen: overrides.idGen ?? "100",
		name: overrides.name,
		currentPageId: overrides.currentPageId ?? "page-1",
		pages: overrides.pages ?? [createPage("page-1")],
	};
}

// Command builders - reduce boilerplate for creating commands
const commands = {
	pageAdd: (pageId: string, data: Partial<GraphPageJson> = {}) => ({
		...cmd(),
		type: "page.add" as const,
		pageId,
		data: { name: data.name ?? "New Page", ...data },
	} as PageAddCommand),

	pageDelete: (pageId: string) => ({
		...cmd(),
		type: "page.delete" as const,
		pageId,
	} as PageDeleteCommand),

	pageModify: (pageId: string, data: Partial<GraphPageJson>) => ({
		...cmd(),
		type: "page.modify" as const,
		pageId,
		data,
	} as PageModifyCommand),

	pageReorder: (pageOrder: string[]) => ({
		...cmd(),
		type: "page.reorder" as const,
		pageOrder,
	} as PageReorderCommand),

	objectAdd: (pageId: string, objectType: "node" | "edge", objectId: string, data: unknown) => ({
		...cmd(),
		type: "object.add" as const,
		pageId,
		objectType,
		objectId,
		data,
	} as ObjectAddCommand),

	objectDelete: (pageId: string, objectType: "node" | "edge", objectId: string) => ({
		...cmd(),
		type: "object.delete" as const,
		pageId,
		objectType,
		objectId,
	} as ObjectDeleteCommand),

	objectModify: (pageId: string, objectType: "node" | "edge", objectId: string, data: ObjectDiffOperation[]) => ({
		...cmd(),
		type: "object.modify" as const,
		pageId,
		objectType,
		objectId,
		data,
	} as ObjectModifyCommand),

	statevarUpdate: <T extends "currentPageId" | "name">(name: T, value: unknown) => ({
		...cmd(),
		type: "statevar.update" as const,
		name,
		value,
	} as StateVarUpdateCommand),

	viewUpdate: (pageId: string, data: unknown) => ({
		...cmd(),
		type: "view.update" as const,
		pageId,
		data,
	} as ViewUpdateCommand),
};

/** Helper to apply command and verify hasChanged flag is set */
function applyAndExpectChanged(state: RoomState, command: Command) {
	state.consumeStateChanges(); // Reset flag
	state.applyCommands([command]);
	const result = state.consumeStateChanges();
	assertEquals(result.hasChanged, true);
}

// ============================================================================
// Tests
// ============================================================================

describe("RoomState", () => {
	let state: RoomState;

	beforeEach(() => {
		state = new RoomState("room-1");
	});

	describe("state lifecycle", () => {
		it("initial state is not initialized", () => {
			assertEquals(state.isStateInitialized(), false);
			assertEquals(state.canGetState(), false);
			assertEquals(state.canSetState(), true);
		});

		it("setState initializes state", () => {
			state.setState(createTestState());

			assertEquals(state.isStateInitialized(), true);
			assertEquals(state.canGetState(), true);
		});

		it("getState returns serialized state", () => {
			state.setState(createTestState());
			const result = state.getState();

			assertEquals(result.idGen, "100");
			assertEquals(result.currentPageId, "page-1");
			assertEquals(Array.isArray(result.pages), true);
			assertEquals(result.pages.length, 1);
		});

		it("getState throws when not initialized", () => {
			assertThrows(
				() => state.getState(),
				Error,
				"Room state has not been initialized yet",
			);
		});

		it("consumeStateChanges returns data and hasChanged flag", () => {
			state.setState(createTestState());
			const result = state.consumeStateChanges();

			assertEquals(result.hasChanged, true);
			assertEquals(result.data !== null, true);
		});

		it("consumeStateChanges resets hasChanged flag", () => {
			state.setState(createTestState());
			state.consumeStateChanges(); // First call
			const result = state.consumeStateChanges(); // Second call

			assertEquals(result.hasChanged, false);
		});
	});

	describe("ID counter", () => {
		it("returns 0 when not initialized", () => {
			assertEquals(state.getIdCounter(), "0");
		});

		it("updates the counter", () => {
			state.setState(createTestState({ idGen: "50" }));
			state.updateIdCounter("200");

			assertEquals(state.getIdCounter(), "200");
		});

		it("sets hasChanged flag on update", () => {
			state.setState(createTestState());
			state.consumeStateChanges(); // Reset hasChanged

			state.updateIdCounter("300");
			const result = state.consumeStateChanges();

			assertEquals(result.hasChanged, true);
		});
	});

	describe("applyCommands", () => {
		it("throws when not initialized", () => {
			assertThrows(
				() => state.applyCommands([commands.pageAdd("new-page")]),
				Error,
				"Cannot apply commands: room state has not been initialized",
			);
		});

		it("sets hasChanged flag", () => {
			state.setState(createTestState());
			applyAndExpectChanged(state, commands.pageModify("page-1", { name: "Changed" }));
		});
	});

	describe("page commands", () => {
		beforeEach(() => {
			state.setState(createTestState());
		});

		it("page.add creates a new page with all data", () => {
			const pageData = createPage("page-2", {
				name: "New Page",
				icon: "factory.png",
				view: { offset: { x: 100, y: 200 }, scale: 1.5, enableGridSnap: true },
				toolMode: "pan",
				selectedNodes: ["n1", "n2"],
				selectedEdges: ["e1"],
			});

			state.applyCommands([commands.pageAdd("page-2", pageData)]);

			const result = state.getState();
			assertEquals(result.pages.length, 2);
			const newPage = result.pages[1];
			assertEquals(newPage.id, "page-2");
			assertEquals(newPage.name, "New Page");
			assertEquals(newPage.icon, "factory.png");
			assertEquals(newPage.view, { offset: { x: 100, y: 200 }, scale: 1.5, enableGridSnap: true });
			assertEquals(newPage.toolMode, "pan");
			assertEquals(newPage.selectedNodes, ["n1", "n2"]);
			assertEquals(newPage.selectedEdges, ["e1"]);
		});

		it("page.delete removes a page", () => {
			state.applyCommands([commands.pageDelete("page-1")]);

			const result = state.getState();
			assertEquals(result.pages.length, 0);
		});

		it("page.modify updates page properties", () => {
			state.applyCommands([commands.pageModify("page-1", { name: "Updated Name", toolMode: "pan" })]);

			const result = state.getState();
			assertEquals(result.pages[0].name, "Updated Name");
			assertEquals(result.pages[0].toolMode, "pan");
		});

		it("page.reorder changes page order", () => {
			state.setState(createTestState({ pages: [createPage("page-1"), createPage("page-2")] }));

			state.applyCommands([commands.pageReorder(["page-2", "page-1"])]);

			const result = state.getState();
			assertEquals(result.pages[0].id, "page-2");
			assertEquals(result.pages[1].id, "page-1");
		});
	});

	describe("object commands", () => {
		beforeEach(() => {
			state.setState(createTestState());
		});

		// Parameterized add tests for nodes and edges
		const addCases = [
			{
				name: "node",
				data: createNode("node-1", {
					position: { x: 100, y: 200 },
					priority: 5,
					edges: ["edge-1", "edge-2"],
					parentNode: "parent-1",
					children: ["child-1"],
					properties: { recipeId: "Recipe_IronIngot_C", overclock: 1.5 },
					size: { x: 200, y: 150 },
				}),
				getStored: (result: AppStateJson) => result.pages[0].nodes["node-1"],
			},
			{
				name: "edge",
				data: createEdge("edge-1", {
					type: "conveyor",
					startNodeId: "node-1",
					endNodeId: "node-2",
					properties: { portFrom: "output-0", portTo: "input-0", waypoints: [{ x: 150, y: 175 }] },
				}),
				getStored: (result: AppStateJson) => result.pages[0].edges["edge-1"],
			},
		] as const;

		for (const { name, data, getStored } of addCases) {
			it(`object.add adds a ${name} with all data`, () => {
				state.applyCommands([commands.objectAdd("page-1", name, data.id, data)]);

				const stored = getStored(state.getState());
				assertEquals(stored, data);
			});
		}

		it("object.delete removes a node from a page", () => {
			state.setState(createTestState({
				pages: [createPage("page-1", { nodes: { "node-1": createNode("node-1") } })],
			}));

			state.applyCommands([commands.objectDelete("page-1", "node", "node-1")]);

			assertEquals("node-1" in state.getState().pages[0].nodes, false);
		});

		it("object.modify applies a set op to a node field", () => {
			state.setState(createTestState({
				pages: [createPage("page-1", { nodes: { "node-1": createNode("node-1") } })],
			}));

			state.applyCommands([commands.objectModify("page-1", "node", "node-1", [
				{ op: "set", path: "position", value: { x: 500, y: 600 } },
			])]);

			const node = state.getState().pages[0].nodes["node-1"];
			assertEquals(node.position, { x: 500, y: 600 });
		});

		it("object.modify set_add adds an entry to a string array field", () => {
			state.setState(createTestState({
				pages: [createPage("page-1", { nodes: { "node-1": createNode("node-1", { edges: ["e1"] }) } })],
			}));

			state.applyCommands([commands.objectModify("page-1", "node", "node-1", [
				{ op: "set_add", path: "edges", value: "e2" },
			])]);

			const node = state.getState().pages[0].nodes["node-1"];
			assertEquals(node.edges, ["e1", "e2"]);
		});

		it("object.modify set_add is idempotent for duplicates", () => {
			state.setState(createTestState({
				pages: [createPage("page-1", { nodes: { "node-1": createNode("node-1", { edges: ["e1"] }) } })],
			}));

			state.applyCommands([commands.objectModify("page-1", "node", "node-1", [
				{ op: "set_add", path: "edges", value: "e1" },
			])]);

			const node = state.getState().pages[0].nodes["node-1"];
			assertEquals(node.edges, ["e1"]);
		});

		it("object.modify set_remove removes an entry from a string array field", () => {
			state.setState(createTestState({
				pages: [createPage("page-1", { nodes: { "node-1": createNode("node-1", { edges: ["e1", "e2"] }) } })],
			}));

			state.applyCommands([commands.objectModify("page-1", "node", "node-1", [
				{ op: "set_remove", path: "edges", value: "e1" },
			])]);

			const node = state.getState().pages[0].nodes["node-1"];
			assertEquals(node.edges, ["e2"]);
		});

		it("object.modify map_put inserts a key into a nested record", () => {
			const nodeWithMap = createNode("node-1", {
				properties: { type: "factory-reference", factoryId: "page-2", jointsToExternalNodes: { "j1": "ext-1" } },
			});
			state.setState(createTestState({
				pages: [createPage("page-1", { nodes: { "node-1": nodeWithMap } })],
			}));

			state.applyCommands([commands.objectModify("page-1", "node", "node-1", [
				{ op: "map_put", path: "properties.jointsToExternalNodes", key: "j2", value: "ext-2" },
			])]);

			const props = state.getState().pages[0].nodes["node-1"].properties as Record<string, unknown>;
			assertEquals(props.jointsToExternalNodes, { "j1": "ext-1", "j2": "ext-2" });
		});

		it("object.modify map_delete removes a key from a nested record", () => {
			const nodeWithMap = createNode("node-1", {
				properties: { type: "factory-reference", factoryId: "page-2", jointsToExternalNodes: { "j1": "ext-1", "j2": "ext-2" } },
			});
			state.setState(createTestState({
				pages: [createPage("page-1", { nodes: { "node-1": nodeWithMap } })],
			}));

			state.applyCommands([commands.objectModify("page-1", "node", "node-1", [
				{ op: "map_delete", path: "properties.jointsToExternalNodes", key: "j1" },
			])]);

			const props = state.getState().pages[0].nodes["node-1"].properties as Record<string, unknown>;
			assertEquals(props.jointsToExternalNodes, { "j2": "ext-2" });
		});

		it("object.modify with multiple ops applies all in order", () => {
			state.setState(createTestState({
				pages: [createPage("page-1", { nodes: { "node-1": createNode("node-1", { edges: ["e1"] }) } })],
			}));

			state.applyCommands([commands.objectModify("page-1", "node", "node-1", [
				{ op: "set", path: "position", value: { x: 10, y: 20 } },
				{ op: "set_add", path: "edges", value: "e2" },
				{ op: "set_remove", path: "edges", value: "e1" },
			])]);

			const node = state.getState().pages[0].nodes["node-1"];
			assertEquals(node.position, { x: 10, y: 20 });
			assertEquals(node.edges, ["e2"]);
		});

		it("object.modify is a no-op when the object does not exist", () => {
			state.setState(createTestState({
				pages: [createPage("page-1", { nodes: { "node-1": createNode("node-1") } })],
			}));

			// Applying to a non-existent node should not throw
			state.applyCommands([commands.objectModify("page-1", "node", "node-missing", [
				{ op: "set", path: "position", value: { x: 1, y: 2 } },
			])]);

			// Existing node is untouched
			const node = state.getState().pages[0].nodes["node-1"];
			assertEquals(node.position, { x: 0, y: 0 });
		});

		it("object.modify applies a set op to an edge field", () => {
			state.setState(createTestState({
				pages: [createPage("page-1", { edges: { "edge-1": createEdge("edge-1") } })],
			}));

			state.applyCommands([commands.objectModify("page-1", "edge", "edge-1", [
				{ op: "set", path: "startNodeId", value: "node-99" },
			])]);

			const edge = state.getState().pages[0].edges["edge-1"];
			assertEquals(edge.startNodeId, "node-99");
		});
	});

	describe("statevar and view commands", () => {
		beforeEach(() => {
			state.setState(createTestState());
		});

		// Parameterized tests for commands that require initialized state
		const uninitializedErrorCases = [
			{ name: "statevar.update", cmd: () => commands.statevarUpdate("currentPageId", "page-2") },
			{ name: "view.update", cmd: () => commands.viewUpdate("page-1", {}) },
		];

		for (const { name, cmd } of uninitializedErrorCases) {
			it(`${name} throws for state not initialized`, () => {
				const uninitializedState = new RoomState("room-2");
				assertThrows(
					() => uninitializedState.applyCommand(cmd()),
					Error,
					"Room state has not been initialized yet",
				);
			});
		}

		// Parameterized tests for hasChanged flag
		const hasChangedCases = [
			{ name: "statevar.update", cmd: () => commands.statevarUpdate("currentPageId", "page-new") },
			{ name: "view.update", cmd: () => commands.viewUpdate("page-1", { offset: { x: 50, y: 50 }, scale: 1.5, enableGridSnap: true }) },
		];

		for (const { name, cmd } of hasChangedCases) {
			it(`${name} sets hasChanged flag`, () => {
				applyAndExpectChanged(state, cmd());
			});
		}

		// Specific behavior tests
		it("statevar.update updates currentPageId", () => {
			state.setState(createTestState({ pages: [createPage("page-1"), createPage("page-2")] }));
			state.applyCommands([commands.statevarUpdate("currentPageId", "page-2")]);

			assertEquals(state.getState().currentPageId, "page-2");
		});

		it("statevar.update updates name", () => {
			state.applyCommands([commands.statevarUpdate("name", "My Project")]);

			assertEquals(state.getState().name, "My Project");
		});

		it("statevar.update can clear name with undefined", () => {
			state.setState(createTestState({ name: "Existing Name" }));
			state.applyCommands([commands.statevarUpdate("name", undefined)]);

			assertEquals(state.getState().name, undefined);
		});

		it("view.update updates page view", () => {
			const newView = { offset: { x: 200, y: 300 }, scale: 2.0, enableGridSnap: false };
			state.applyCommands([commands.viewUpdate("page-1", newView)]);

			assertEquals(state.getState().pages[0].view, newView);
		});

		it("view.update throws for non-existent page", () => {
			assertThrows(
				() => state.applyCommands([commands.viewUpdate("non-existent-page", {})]),
				Error,
				"Page non-existent-page not found",
			);
		});
	});

	describe("serialization", () => {
		it("preserves state structure", () => {
			state.setState(createTestState({
				idGen: "42",
				pages: [createPage("page-1", {
					nodes: { "n1": createNode("n1", { properties: { type: "recipe" } }) },
					edges: { "e1": createEdge("e1", { startNodeId: "n1", endNodeId: "n2" }) },
				})],
			}));

			const result = state.getState();

			assertEquals(result.idGen, "42");
			assertEquals(result.currentPageId, "page-1");
			assertEquals(Object.keys(result.pages[0].nodes).length, 1);
			assertEquals(Object.keys(result.pages[0].edges).length, 1);
		});
	});

	describe("complex workflow", () => {
		it("applies all command types in sequence", () => {
			state.setState(createTestState());

			// Apply a sequence of commands covering all command types
			state.applyCommands([
				// 1. Add a new page
				commands.pageAdd("page-2", createPage("page-2", { name: "Production Line", icon: "production.png" })),
				// 2. Modify the original page
				commands.pageModify("page-1", { name: "Iron Production", toolMode: "connect" }),
				// 3. Add nodes to page-2
				commands.objectAdd("page-2", "node", "node-1", createNode("node-1", { properties: { recipeId: "Recipe_IronOre_C" } })),
				commands.objectAdd("page-2", "node", "node-2", createNode("node-2", { position: { x: 300, y: 0 }, priority: 2, properties: { recipeId: "Recipe_IronIngot_C" } })),
				// 4. Add an edge connecting the nodes
				commands.objectAdd("page-2", "edge", "edge-1", createEdge("edge-1", { properties: { portFrom: "out-0", portTo: "in-0" } })),
				// 5. Modify node-1 with diff ops
				commands.objectModify("page-2", "node", "node-1", [
					{ op: "set", path: "position", value: { x: 50, y: 50 } },
					{ op: "set", path: "properties", value: { recipeId: "Recipe_IronOre_C", overclock: 2.0 } },
				]),
				// 6. Reorder pages
				commands.pageReorder(["page-2", "page-1"]),
				// 7. Add a third page that will be deleted
				commands.pageAdd("page-3", createPage("page-3", { name: "Temporary Page" })),
				// 8. Delete the temporary page
				commands.pageDelete("page-3"),
				// 9. Delete the edge
				commands.objectDelete("page-2", "edge", "edge-1"),
			]);

			// Verify final state
			const result = state.getState();

			// Should have 2 pages (page-3 was deleted)
			assertEquals(result.pages.length, 2);

			// Pages should be reordered (page-2 first, then page-1)
			assertEquals(result.pages[0].id, "page-2");
			assertEquals(result.pages[1].id, "page-1");

			// page-1 should have modified name and toolMode
			const page1 = result.pages.find((p) => p.id === "page-1")!;
			assertEquals(page1.name, "Iron Production");
			assertEquals(page1.toolMode, "connect");

			// page-2 should have the added nodes but edge should be deleted
			const page2 = result.pages.find((p) => p.id === "page-2")!;
			assertEquals(page2.name, "Production Line");
			assertEquals(Object.keys(page2.nodes).length, 2);
			assertEquals(Object.keys(page2.edges).length, 0); // Edge was deleted

			// node-1 should have modified position and overclock
			const node1 = page2.nodes["node-1"];
			assertEquals(node1.position, { x: 50, y: 50 });
			assertEquals((node1.properties as Record<string, unknown>).overclock, 2.0);

			// node-2 should be unchanged
			const node2 = page2.nodes["node-2"];
			assertEquals(node2.position, { x: 300, y: 0 });
			assertEquals((node2.properties as Record<string, unknown>).recipeId, "Recipe_IronIngot_C");

			// hasChanged should be true
			const changes = state.consumeStateChanges();
			assertEquals(changes.hasChanged, true);
		});
	});
});
