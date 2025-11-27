/**
 * RoomState unit tests - testing all public interfaces
 */

import { assertEquals, assertThrows } from "@std/assert";
import { beforeEach, describe, it } from "@std/testing/bdd";
import { RoomState } from "./RoomState.ts";
import type { AppStateJson } from "./types_serialization.ts";
import type {
	ObjectAddCommand,
	ObjectDeleteCommand,
	ObjectModifyCommand,
	PageAddCommand,
	PageDeleteCommand,
	PageModifyCommand,
	PageReorderCommand,
} from "./types_shared.ts";

// ============================================================================
// Test Helpers
// ============================================================================

/** Creates a minimal valid app state for testing */
function createTestState(overrides: Partial<AppStateJson> = {}): AppStateJson {
	return {
		version: 1,
		type: "app-state",
		idGen: "100",
		currentPageId: "page-1",
		pages: [
			{
				version: 1,
				type: "graph-page",
				id: "page-1",
				name: "Test Page",
				icon: "",
				view: { pos: { x: 0, y: 0 }, zoom: 1 },
				nodes: {},
				edges: {},
				toolMode: "select",
				selectedNodes: [],
				selectedEdges: [],
			},
		],
		...overrides,
	};
}

/** Base command fields for test commands */
function baseCommand() {
	return {
		commandId: "cmd-1",
		clientId: "client-1",
		timestamp: Date.now(),
	};
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
			const command: PageAddCommand = {
				...baseCommand(),
				type: "page.add",
				pageId: "new-page",
				data: { name: "New Page" },
			};

			assertThrows(
				() => state.applyCommands([command]),
				Error,
				"Cannot apply commands: room state has not been initialized",
			);
		});

		it("sets hasChanged flag", () => {
			state.setState(createTestState());
			state.consumeStateChanges(); // Reset flag

			const command: PageModifyCommand = {
				...baseCommand(),
				type: "page.modify",
				pageId: "page-1",
				data: { name: "Changed" },
			};

			state.applyCommands([command]);
			const result = state.consumeStateChanges();

			assertEquals(result.hasChanged, true);
		});
	});

	describe("page commands", () => {
		beforeEach(() => {
			state.setState(createTestState());
		});

		it("page.add creates a new page with all data", () => {
			const command: PageAddCommand = {
				...baseCommand(),
				type: "page.add",
				pageId: "page-2",
				data: {
					version: 1,
					type: "graph-page",
					id: "page-2",
					name: "New Page",
					icon: "factory.png",
					view: { pos: { x: 100, y: 200 }, zoom: 1.5 },
					nodes: {},
					edges: {},
					toolMode: "pan",
					selectedNodes: ["n1", "n2"],
					selectedEdges: ["e1"],
				},
			};

			state.applyCommands([command]);

			const result = state.getState();
			assertEquals(result.pages.length, 2);
			const newPage = result.pages[1];
			assertEquals(newPage.id, "page-2");
			assertEquals(newPage.name, "New Page");
			assertEquals(newPage.icon, "factory.png");
			assertEquals(newPage.view, { pos: { x: 100, y: 200 }, zoom: 1.5 });
			assertEquals(newPage.toolMode, "pan");
			assertEquals(newPage.selectedNodes, ["n1", "n2"]);
			assertEquals(newPage.selectedEdges, ["e1"]);
			assertEquals(newPage.nodes, {});
			assertEquals(newPage.edges, {});
		});

		it("page.delete removes a page", () => {
			const command: PageDeleteCommand = {
				...baseCommand(),
				type: "page.delete",
				pageId: "page-1",
			};

			state.applyCommands([command]);

			const result = state.getState();
			assertEquals(result.pages.length, 0);
		});

		it("page.modify updates page properties", () => {
			const command: PageModifyCommand = {
				...baseCommand(),
				type: "page.modify",
				pageId: "page-1",
				data: { name: "Updated Name", toolMode: "pan" },
			};

			state.applyCommands([command]);

			const result = state.getState();
			assertEquals(result.pages[0].name, "Updated Name");
			assertEquals(result.pages[0].toolMode, "pan");
		});

		it("page.reorder changes page order", () => {
			const testData = createTestState();
			testData.pages.push({
				version: 1,
				type: "graph-page",
				id: "page-2",
				name: "Page 2",
				icon: "",
				view: { pos: { x: 0, y: 0 }, zoom: 1 },
				nodes: {},
				edges: {},
				toolMode: "select",
				selectedNodes: [],
				selectedEdges: [],
			});
			state.setState(testData);

			const command: PageReorderCommand = {
				...baseCommand(),
				type: "page.reorder",
				pageOrder: ["page-2", "page-1"],
			};

			state.applyCommands([command]);

			const result = state.getState();
			assertEquals(result.pages[0].id, "page-2");
			assertEquals(result.pages[1].id, "page-1");
		});
	});

	describe("object commands", () => {
		beforeEach(() => {
			state.setState(createTestState());
		});

		it("object.add adds a node with all data", () => {
			const nodeData = {
				id: "node-1",
				position: { x: 100, y: 200 },
				priority: 5,
				edges: ["edge-1", "edge-2"],
				parentNode: "parent-1",
				children: ["child-1"],
				properties: { recipeId: "Recipe_IronIngot_C", overclock: 1.5 },
				size: { x: 200, y: 150 },
			};

			const command: ObjectAddCommand = {
				...baseCommand(),
				type: "object.add",
				pageId: "page-1",
				objectType: "node",
				objectId: "node-1",
				data: nodeData,
			};

			state.applyCommands([command]);

			const result = state.getState();
			assertEquals("node-1" in result.pages[0].nodes, true);
			const storedNode = result.pages[0].nodes["node-1"];
			assertEquals(storedNode.id, "node-1");
			assertEquals(storedNode.position, { x: 100, y: 200 });
			assertEquals(storedNode.priority, 5);
			assertEquals(storedNode.edges, ["edge-1", "edge-2"]);
			assertEquals(storedNode.parentNode, "parent-1");
			assertEquals(storedNode.children, ["child-1"]);
			assertEquals(storedNode.properties, { recipeId: "Recipe_IronIngot_C", overclock: 1.5 });
			assertEquals(storedNode.size, { x: 200, y: 150 });
		});

		it("object.add adds an edge with all data", () => {
			const edgeData = {
				id: "edge-1",
				type: "conveyor",
				startNodeId: "node-1",
				endNodeId: "node-2",
				properties: { portFrom: "output-0", portTo: "input-0", waypoints: [{ x: 150, y: 175 }] },
			};

			const command: ObjectAddCommand = {
				...baseCommand(),
				type: "object.add",
				pageId: "page-1",
				objectType: "edge",
				objectId: "edge-1",
				data: edgeData,
			};

			state.applyCommands([command]);

			const result = state.getState();
			assertEquals("edge-1" in result.pages[0].edges, true);
			const storedEdge = result.pages[0].edges["edge-1"];
			assertEquals(storedEdge.id, "edge-1");
			assertEquals(storedEdge.type, "conveyor");
			assertEquals(storedEdge.startNodeId, "node-1");
			assertEquals(storedEdge.endNodeId, "node-2");
			assertEquals(storedEdge.properties, { portFrom: "output-0", portTo: "input-0", waypoints: [{ x: 150, y: 175 }] });
		});

		it("object.delete removes a node from a page", () => {
			const testData = createTestState();
			testData.pages[0].nodes = {
				"node-1": {
					id: "node-1",
					position: { x: 0, y: 0 },
					priority: 1,
					edges: [],
					parentNode: null,
					children: [],
					properties: {},
					size: { x: 100, y: 80 },
				},
			};
			state.setState(testData);

			const command: ObjectDeleteCommand = {
				...baseCommand(),
				type: "object.delete",
				pageId: "page-1",
				objectId: "node-1",
			};

			state.applyCommands([command]);

			const result = state.getState();
			assertEquals("node-1" in result.pages[0].nodes, false);
		});

		it("object.modify updates a node", () => {
			const testData = createTestState();
			testData.pages[0].nodes = {
				"node-1": {
					id: "node-1",
					position: { x: 0, y: 0 },
					priority: 1,
					edges: [],
					parentNode: null,
					children: [],
					properties: {},
					size: { x: 100, y: 80 },
				},
			};
			state.setState(testData);

			const command: ObjectModifyCommand = {
				...baseCommand(),
				type: "object.modify",
				pageId: "page-1",
				objectId: "node-1",
				data: { id: "node-1", position: { x: 500, y: 600 } },
			};

			state.applyCommands([command]);

			const result = state.getState();
			const node = result.pages[0].nodes["node-1"];
			assertEquals(node.position.x, 500);
			assertEquals(node.position.y, 600);
		});
	});

	describe("serialization", () => {
		it("preserves state structure", () => {
			const testData = createTestState({
				idGen: "42",
				currentPageId: "page-1",
			});
			testData.pages[0].nodes = {
				"n1": {
					id: "n1",
					position: { x: 0, y: 0 },
					priority: 1,
					edges: [],
					parentNode: null,
					children: [],
					properties: { type: "recipe" },
					size: { x: 100, y: 80 },
				},
			};
			testData.pages[0].edges = {
				"e1": {
					id: "e1",
					type: "conveyor",
					startNodeId: "n1",
					endNodeId: "n2",
					properties: {},
				},
			};

			state.setState(testData);
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
			let cmdCounter = 0;

			function nextCommandId() {
				return `cmd-${++cmdCounter}`;
			}

			// 1. Add a new page
			const addPage: PageAddCommand = {
				commandId: nextCommandId(),
				clientId: "client-1",
				timestamp: Date.now(),
				type: "page.add",
				pageId: "page-2",
				data: {
					version: 1,
					type: "graph-page",
					id: "page-2",
					name: "Production Line",
					icon: "production.png",
					view: { pos: { x: 0, y: 0 }, zoom: 1 },
					nodes: {},
					edges: {},
					toolMode: "select",
					selectedNodes: [],
					selectedEdges: [],
				},
			};

			// 2. Modify the original page
			const modifyPage: PageModifyCommand = {
				commandId: nextCommandId(),
				clientId: "client-1",
				timestamp: Date.now(),
				type: "page.modify",
				pageId: "page-1",
				data: { name: "Iron Production", toolMode: "connect" },
			};

			// 3. Add nodes to page-2
			const addNode1: ObjectAddCommand = {
				commandId: nextCommandId(),
				clientId: "client-1",
				timestamp: Date.now(),
				type: "object.add",
				pageId: "page-2",
				objectType: "node",
				objectId: "node-1",
				data: {
					id: "node-1",
					position: { x: 0, y: 0 },
					priority: 1,
					edges: [],
					parentNode: null,
					children: [],
					properties: { recipeId: "Recipe_IronOre_C" },
					size: { x: 100, y: 80 },
				},
			};

			const addNode2: ObjectAddCommand = {
				commandId: nextCommandId(),
				clientId: "client-2",
				timestamp: Date.now(),
				type: "object.add",
				pageId: "page-2",
				objectType: "node",
				objectId: "node-2",
				data: {
					id: "node-2",
					position: { x: 300, y: 0 },
					priority: 2,
					edges: [],
					parentNode: null,
					children: [],
					properties: { recipeId: "Recipe_IronIngot_C" },
					size: { x: 100, y: 80 },
				},
			};

			// 4. Add an edge connecting the nodes
			const addEdge: ObjectAddCommand = {
				commandId: nextCommandId(),
				clientId: "client-1",
				timestamp: Date.now(),
				type: "object.add",
				pageId: "page-2",
				objectType: "edge",
				objectId: "edge-1",
				data: {
					id: "edge-1",
					type: "conveyor",
					startNodeId: "node-1",
					endNodeId: "node-2",
					properties: { portFrom: "out-0", portTo: "in-0" },
				},
			};

			// 5. Modify node-1
			const modifyNode: ObjectModifyCommand = {
				commandId: nextCommandId(),
				clientId: "client-2",
				timestamp: Date.now(),
				type: "object.modify",
				pageId: "page-2",
				objectId: "node-1",
				data: {
					id: "node-1",
					position: { x: 50, y: 50 },
					priority: 1,
					edges: [],
					parentNode: null,
					children: [],
					properties: { recipeId: "Recipe_IronOre_C", overclock: 2.0 },
					size: { x: 100, y: 80 },
				},
			};

			// 6. Reorder pages
			const reorderPages: PageReorderCommand = {
				commandId: nextCommandId(),
				clientId: "client-1",
				timestamp: Date.now(),
				type: "page.reorder",
				pageOrder: ["page-2", "page-1"],
			};

			// 7. Add a third page that will be deleted
			const addPageToDelete: PageAddCommand = {
				commandId: nextCommandId(),
				clientId: "client-1",
				timestamp: Date.now(),
				type: "page.add",
				pageId: "page-3",
				data: {
					version: 1,
					type: "graph-page",
					id: "page-3",
					name: "Temporary Page",
					icon: "",
					view: { pos: { x: 0, y: 0 }, zoom: 1 },
					nodes: {},
					edges: {},
					toolMode: "select",
					selectedNodes: [],
					selectedEdges: [],
				},
			};

			// 8. Delete the temporary page
			const deletePage: PageDeleteCommand = {
				commandId: nextCommandId(),
				clientId: "client-1",
				timestamp: Date.now(),
				type: "page.delete",
				pageId: "page-3",
			};

			// 9. Delete an object (edge)
			const deleteEdge: ObjectDeleteCommand = {
				commandId: nextCommandId(),
				clientId: "client-2",
				timestamp: Date.now(),
				type: "object.delete",
				pageId: "page-2",
				objectId: "edge-1",
			};

			// Apply all commands
			state.applyCommands([
				addPage,
				modifyPage,
				addNode1,
				addNode2,
				addEdge,
				modifyNode,
				reorderPages,
				addPageToDelete,
				deletePage,
				deleteEdge,
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
