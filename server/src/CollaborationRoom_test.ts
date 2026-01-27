/**
 * CollaborationRoom unit tests - testing all public interfaces
 */

import { assertEquals, assertExists, assertRejects, assertThrows } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import {
	CollaborationRoom,
	type RoomConfig,
	type RoomDependencies,
} from "./CollaborationRoom.ts";
import type { IRoomState } from "./RoomState.ts";
import type { ICommandBuffer } from "./CommandBuffer.ts";
import type { IDatabaseManager, RoomSnapshot } from "./persistence.ts";
import type { ICollaborationClient } from "./CollaborationClient.ts";
import type {
	Command,
	PageAddCommand,
	ServerMessage,
} from "../shared/messages.ts";
import { AppError } from "./errors/AppError.ts";
import type { AppStateJson } from "../shared/types_serialization.ts";
import { setImmediate } from "node:timers";
import { CompressedData, ICompressionService } from "../shared/CompressionService.ts";

// ============================================================================
// Test Helpers & Mocks
// ============================================================================

const flushPromises = () => new Promise(setImmediate);

/** Default room configuration for tests */
function createTestConfig(overrides: Partial<RoomConfig> = {}): RoomConfig {
	return {
		maxClients: 10,
		snapshotIntervalMs: 30000,
		heartbeatIntervalMs: 1000,
		heartbeatFastDelayMs: 50,
		commandBuffer: {
			bufferTimeMs: 50,
			maxBatchSize: 100,
		},
		...overrides,
	};
}

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
				view: { offset: { x: 0, y: 0 }, scale: 1, enableGridSnap: true },
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
function baseCommand(userId = "u1") {
	return {
		commandId: `cmd-${Date.now()}`,
		userId,
		timestamp: Date.now(),
	};
}

/** Creates a mock CollaborationClient */
function createMockClient(
	socketId: string,
	overrides: Partial<ICollaborationClient> = {},
): ICollaborationClient {
	let assignedUserId: string | null = null;
	return {
		socketId,
		serverProtocolVersion: 1,
		cursor: { x: 0, y: 0 },
		currentPageId: null,
		lastHeartbeat: Date.now(),
		localIdCounter: "0",
		updateFromHeartbeat: spy(),
		sendMessage: spy(),
		get userId() {
			if (assignedUserId === null) throw new Error("User ID not assigned");
			return assignedUserId;
		},
		hasUserId: () => assignedUserId !== null,
		assignUserId: (userId: string) => { assignedUserId = userId; },
		getClientInfo: function() {
			return {
				userId: assignedUserId ?? socketId,
				cursor: this.cursor,
				currentPageId: this.currentPageId,
				lastHeartbeat: this.lastHeartbeat,
				serverProtocolVersion: 1,
			};
		},
		disconnect: spy(),
		dispose: spy(),
		...overrides,
	} as ICollaborationClient;
}

/** Creates a mock RoomState */
function createMockRoomState(initialized = false): IRoomState {
	const state = createTestState();
	let isInit = initialized;
	let hasChanged = false;
	let idCounter = "0";

	return {
		isStateInitialized: () => isInit,
		canSetState: () => true,
		canGetState: () => isInit,
		setState: spy((_data: AppStateJson) => {
			isInit = true;
			hasChanged = true;
		}),
		getState: spy(() => {
			if (!isInit) throw new Error("Not initialized");
			return state;
		}),
		consumeStateChanges: spy(() => {
			const result = { data: isInit ? state : null, hasChanged };
			hasChanged = false;
			return result;
		}),
		updateIdCounter: spy((counter: string) => {
			idCounter = counter;
			hasChanged = true;
		}),
		getIdCounter: () => idCounter,
		applyCommand: spy(),
		applyCommands: spy(),
	};
}

/** Creates a mock CommandBuffer */
function createMockCommandBuffer(): ICommandBuffer {
	return {
		addCommands: spy(),
		flush: spy(),
		getBufferSize: () => 0,
		clear: spy(),
		dispose: spy(),
	};
}

/** Creates a mock CompressionService */
function createMockCompression(): ICompressionService {
	return {
		registerProvider: spy(),
		setDefaultMethod: spy(),
		getDefaultMethod: () => "none" as const,
		getSupportedMethods: () => ["none" as const],
		compressJSON: spy((obj: unknown) => Promise.resolve({
			method: "none" as const,
			data: new TextEncoder().encode(JSON.stringify(obj)),
		})),
		decompressJSON: spy((compressed: CompressedData) => new Promise(resolve => {
			const data = compressed.data instanceof Uint8Array
				? compressed.data
				: new Uint8Array(compressed.data);
			resolve(JSON.parse(new TextDecoder().decode(data)));
		})),
	};
}

/** Creates a mock DatabaseManager */
function createMockDatabase(): IDatabaseManager {
	const snapshots = new Map<string, RoomSnapshot>();
	return {
		upsertRoom: spy(),
		getRoom: spy(() => null),
		listRooms: spy(() => []),
		saveSnapshot: spy((snapshot: RoomSnapshot) => {
			snapshots.set(snapshot.roomId, snapshot);
		}),
		loadSnapshot: spy((roomId: string) => snapshots.get(roomId) ?? null),
		cleanup: spy(),
		close: spy(),
	};
}

// ============================================================================
// Tests
// ============================================================================

describe("CollaborationRoom", () => {
	let room: CollaborationRoom;
	let config: RoomConfig;
	let mockRoomState: IRoomState;
	let mockCommandBuffer: ICommandBuffer;
	let mockCompression: ICompressionService;
	let mockDatabase: IDatabaseManager;
	let time: FakeTime;

	beforeEach(() => {
		time = new FakeTime();
		config = createTestConfig();
		mockRoomState = createMockRoomState();
		mockCommandBuffer = createMockCommandBuffer();
		mockCompression = createMockCompression();
		mockDatabase = createMockDatabase();

		const dependencies: RoomDependencies = {
			createRoomState: () => mockRoomState,
			createCommandBuffer: () => mockCommandBuffer,
		};

		room = new CollaborationRoom(
			"test-room",
			config,
			mockCompression,
			mockDatabase,
			dependencies,
		);
	});

	afterEach(() => {
		room.dispose();
		time.restore();
	});

	describe("room creation", () => {
		it("should create a room with the given roomId", () => {
			assertEquals(room.roomId, "test-room");
		});

		it("should start with zero clients", () => {
			assertEquals(room.getClientCount(), 0);
			assertEquals(room.isEmpty(), true);
		});

		it("should load existing snapshot on creation", () => {
			assertSpyCalls(mockDatabase.loadSnapshot as ReturnType<typeof spy>, 1);
			assertSpyCall(mockDatabase.loadSnapshot as ReturnType<typeof spy>, 0, {
				args: ["test-room"],
			});
		});
	});

	describe("addClient", () => {
		describe("with download intent", () => {
			it("should add client successfully when state is initialized", async () => {
				// Initialize state first
				mockRoomState = createMockRoomState(true);
				const dependencies: RoomDependencies = {
					createRoomState: () => mockRoomState,
					createCommandBuffer: () => mockCommandBuffer,
				};
				room.dispose();
				room = new CollaborationRoom(
					"test-room",
					config,
					mockCompression,
					mockDatabase,
					dependencies,
				);

				const client = createMockClient("socket-1");
				const result = await room.addClient(client, "download");

				assertEquals(result.type, "room_joined");
				assertEquals(result.roomId, "test-room");
				assertEquals(result.userId, "u1");
				assertExists(result.stateData);
				assertEquals(typeof result.stateData, "object");
				assertEquals(room.getClientCount(), 1);
			});

			it("should throw STATE_NOT_INITIALIZED when state is not initialized", async () => {
				const client = createMockClient("socket-1");

				await assertRejects(
					async () => await room.addClient(client, "download"),
					AppError,
				);
			});
		});

		describe("with upload intent", () => {
			it("should add client successfully when room is empty", async () => {
				const client = createMockClient("socket-1");
				const result = await room.addClient(client, "upload");

				assertEquals(result.type, "room_joined");
				assertEquals(result.roomId, "test-room");
				assertEquals(result.userId, "u1");
				assertEquals(result.stateData, undefined);
				assertEquals(room.getClientCount(), 1);
			});

			it("should add client successfully when state is not initialized even if not empty", async () => {
				mockRoomState.isStateInitialized = () => false;
				await room.addClient(createMockClient("socket-1"), "upload");

				const client = createMockClient("socket-2");
				const result = await room.addClient(client, "upload");
				assertEquals(result.type, "room_joined");
				assertEquals(room.getClientCount(), 2);
			});

			it("should throw UPLOAD_NOT_AUTHORIZED when state is initialized and room is not empty", async () => {
				// Setup initialized state
				room.setRoomState("socket-setup", createTestState());

				// Add first client (allowed because room is empty)
				await room.addClient(createMockClient("socket-1"), "download");

				// Add second client with upload intent (should fail)
				const client2 = createMockClient("socket-2");
				await assertRejects(
					async () => await room.addClient(client2, "upload"),
					AppError,
				);
			});
		});

		it("should throw ROOM_FULL when max clients reached", async () => {
			config = createTestConfig({ maxClients: 2 });
			room.dispose();
			room = new CollaborationRoom(
				"test-room",
				config,
				mockCompression,
				mockDatabase,
				{
					createRoomState: () => mockRoomState,
					createCommandBuffer: () => mockCommandBuffer,
				},
			);

			// Add up to maxClients - 1 (should succeed)
			await room.addClient(createMockClient("socket-1"), "upload");
			assertEquals(room.getClientCount(), 1);

			// Add one more to reach exactly maxClients (should still succeed)
			await room.addClient(createMockClient("socket-2"), "upload");
			assertEquals(room.getClientCount(), 2);

			// Adding one more beyond maxClients should throw
			await assertRejects(
				async () => await room.addClient(createMockClient("socket-3"), "upload"),
				AppError,
			);

			// Client count should remain at maxClients after failed add
			assertEquals(room.getClientCount(), 2);
		});

		it("should increment client count for each added client", async () => {
			await room.addClient(createMockClient("socket-1"), "upload");
			assertEquals(room.getClientCount(), 1);
			assertEquals(room.isEmpty(), false);

			await room.addClient(createMockClient("socket-2"), "upload");
			assertEquals(room.getClientCount(), 2);
		});
	});

	describe("getAllowedIntents", () => {
		it("should return both download and upload when state is initialized and no clients connected", () => {
			room.setRoomState("socket-setup", createTestState());

			const intents = room.getAllowedIntents();
			assertEquals(intents.sort(), ["download", "upload"].sort());
		});

		it("should return only download when state is initialized and clients are connected", async () => {
			room.setRoomState("socket-setup", createTestState());

			await room.addClient(createMockClient("socket-1"), "download");

			const intents = room.getAllowedIntents();
			assertEquals(intents, ["download"]);
		});

		it("should return only upload when state is not initialized", () => {
			// Room is not initialized by default in beforeEach
			const intents = room.getAllowedIntents();
			assertEquals(intents, ["upload"]);
		});

		it("should return only upload when state is not initialized even if clients are connected", async () => {
			await room.addClient(createMockClient("socket-1"), "upload");

			const intents = room.getAllowedIntents();
			assertEquals(intents, ["upload"]);
		});
	});

	describe("removeClient", () => {
		it("should remove an existing client", async () => {
			const client = createMockClient("socket-1");
			await room.addClient(client, "upload");
			assertEquals(room.getClientCount(), 1);

			room.removeClient("socket-1");
			assertEquals(room.getClientCount(), 0);
			assertEquals(room.isEmpty(), true);
		});

		it("should do nothing when removing non-existent client", async () => {
			await room.addClient(createMockClient("socket-1"), "upload");
			assertEquals(room.getClientCount(), 1);

			room.removeClient("non-existent");
			assertEquals(room.getClientCount(), 1);
		});
	});

	describe("handleCommandBatch", () => {
		beforeEach(() => {
			// Initialize state for command handling
			mockRoomState = createMockRoomState(true);
			room.dispose();
			room = new CollaborationRoom(
				"test-room",
				config,
				mockCompression,
				mockDatabase,
				{
					createRoomState: () => mockRoomState,
					createCommandBuffer: () => mockCommandBuffer,
				},
			);
		});

	it("should throw error for commands from non-member clients", () => {
		const commands: Command[] = [
			{
				...baseCommand("u99"),
				type: "page.add",
				pageId: "new-page",
				data: {},
			} as PageAddCommand,
		];

		assertThrows(
			() => room.handleCommandBatch("unknown-socket", commands),
			AppError,
			"Client unknown-socket is not a member of room",
		);

		assertSpyCalls(mockRoomState.applyCommands as ReturnType<typeof spy>, 0);
		assertSpyCalls(mockCommandBuffer.addCommands as ReturnType<typeof spy>, 0);
	});		it("should apply commands to room state", async () => {
			const client = createMockClient("socket-1");
			await room.addClient(client, "upload");

			const commands: Command[] = [
				{
					...baseCommand("u1"),
					type: "page.add",
					pageId: "new-page",
					data: { name: "New Page" },
				} as PageAddCommand,
			];

			room.handleCommandBatch("socket-1", commands);

			assertSpyCalls(mockRoomState.applyCommands as ReturnType<typeof spy>, 1);
			assertSpyCall(mockRoomState.applyCommands as ReturnType<typeof spy>, 0, {
				args: [commands],
			});
		});

		it("should add commands to buffer for broadcasting", async () => {
			const client = createMockClient("socket-1");
			await room.addClient(client, "upload");

			const commands: Command[] = [
				{
					...baseCommand("u1"),
					type: "page.add",
					pageId: "new-page",
					data: {},
				} as PageAddCommand,
			];

			room.handleCommandBatch("socket-1", commands);

			assertSpyCalls(mockCommandBuffer.addCommands as ReturnType<typeof spy>, 1);
			assertSpyCall(mockCommandBuffer.addCommands as ReturnType<typeof spy>, 0, {
				args: [commands],
			});
		});

		it("should not add commands to buffer when applyCommands fails", async () => {
			// Create a room state that throws on applyCommands
			const failingRoomState = createMockRoomState(true);
			failingRoomState.applyCommands = () => {
				throw new Error("Command failed");
			};

			const failingCommandBuffer = createMockCommandBuffer();

			room.dispose();
			room = new CollaborationRoom(
				"test-room",
				config,
				mockCompression,
				mockDatabase,
				{
					createRoomState: () => failingRoomState,
					createCommandBuffer: () => failingCommandBuffer,
				},
			);

			const client = createMockClient("socket-1");
			await room.addClient(client, "upload");

			const commands: Command[] = [
				{
					...baseCommand("u1"),
					type: "page.add",
					pageId: "new-page",
					data: {},
				} as PageAddCommand,
			];

			room.handleCommandBatch("socket-1", commands);

			assertSpyCalls(failingCommandBuffer.addCommands as ReturnType<typeof spy>, 0);
		});
	});

	describe("handleHeartbeat", () => {
		it("should forward ID counter to room state", async () => {
			const client = createMockClient("socket-1", {
				localIdCounter: "500",
			});
			await room.addClient(client, "upload");

			room.handleHeartbeat(client);

			assertSpyCalls(mockRoomState.updateIdCounter as ReturnType<typeof spy>, 1);
			assertSpyCall(mockRoomState.updateIdCounter as ReturnType<typeof spy>, 0, {
				args: ["500"],
			});
		});
	});

	describe("setRoomState", () => {
		it("should set state on room state manager", () => {
			const stateData = createTestState();

			room.setRoomState("socket-1", stateData);

			assertSpyCalls(mockRoomState.setState as ReturnType<typeof spy>, 1);
			assertSpyCall(mockRoomState.setState as ReturnType<typeof spy>, 0, {
				args: [stateData],
			});
		});

		it("should save snapshot after setting state", () => {
			const stateData = createTestState();

			room.setRoomState("socket-1", stateData);

			// consumeStateChanges should be called as part of saveSnapshot
			assertSpyCalls(mockRoomState.consumeStateChanges as ReturnType<typeof spy>, 1);
		});
	});

	describe("broadcast", () => {
		it("should send message to all clients", async () => {
			const client1 = createMockClient("socket-1");
			const client2 = createMockClient("socket-2");
			await room.addClient(client1, "upload");
			await room.addClient(client2, "upload");

			const message: ServerMessage = {
				type: "heartbeat_response",
				clients: [],
				highestIdCounter: "0",
			};

			room.broadcast(message);

			assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 1);
			assertSpyCalls(client2.sendMessage as ReturnType<typeof spy>, 1);
		});

		it("should exclude specified client from broadcast", async () => {
			const client1 = createMockClient("socket-1");
			const client2 = createMockClient("socket-2");
			await room.addClient(client1, "upload");
			await room.addClient(client2, "upload");

			const message: ServerMessage = {
				type: "heartbeat_response",
				clients: [],
				highestIdCounter: "0",
			};

			room.broadcast(message, "socket-1");

			assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 0);
			assertSpyCalls(client2.sendMessage as ReturnType<typeof spy>, 1);
		});
	});

	describe("periodic timers", () => {
		describe("heartbeat timer", () => {
			it("should broadcast heartbeat response at configured interval", async () => {
				const client1 = createMockClient("socket-1");
				const client2 = createMockClient("socket-2");
				await room.addClient(client1, "upload");
				await room.addClient(client2, "upload");

				// Advance time to just before heartbeat interval - no message yet
				time.tick(config.heartbeatIntervalMs - 1);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 0);

				// Advance by 1 more ms to reach exactly the interval
				time.tick(1);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 1);
				const message1 = (client1.sendMessage as ReturnType<typeof spy>).calls[0].args[0] as ServerMessage;
				assertEquals(message1.type, "heartbeat_response");

				// Advance by half interval - no additional message
				time.tick(config.heartbeatIntervalMs / 2);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 1);

				// Advance to complete the second interval - second message
				time.tick(config.heartbeatIntervalMs / 2);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 2);
			});

			it("should include all client presences in heartbeat response", async () => {
				const client1 = createMockClient("socket-1", {
					cursor: { x: 10, y: 20 },
				});
				const client2 = createMockClient("socket-2", {
					cursor: { x: 30, y: 40 },
				});
				await room.addClient(client1, "upload");
				await room.addClient(client2, "upload");

				time.tick(config.heartbeatIntervalMs);

				const message = (client1.sendMessage as ReturnType<typeof spy>).calls[0].args[0] as ServerMessage;
				assertEquals(message.type, "heartbeat_response");
				if (message.type === "heartbeat_response") {
					assertEquals(message.clients.length, 2);
				}
			});

			it("should schedule fast heartbeat broadcast after receiving client heartbeat", async () => {
				const client1 = createMockClient("socket-1");
				const client2 = createMockClient("socket-2");
				await room.addClient(client1, "upload");
				await room.addClient(client2, "upload");

				// Trigger heartbeat from client
				room.handleHeartbeat(client1);

				// Before fast delay - no message yet
				time.tick(config.heartbeatFastDelayMs - 1);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 0);

				// At fast delay - should broadcast
				time.tick(1);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 1);
				const message = (client1.sendMessage as ReturnType<typeof spy>).calls[0].args[0] as ServerMessage;
				assertEquals(message.type, "heartbeat_response");
			});

			it("should not schedule multiple fast heartbeats when receiving multiple client heartbeats", async () => {
				const client1 = createMockClient("socket-1");
				const client2 = createMockClient("socket-2");
				await room.addClient(client1, "upload");
				await room.addClient(client2, "upload");

				// Trigger multiple heartbeats
				room.handleHeartbeat(client1);
				room.handleHeartbeat(client2);
				room.handleHeartbeat(client1);

				// Wait for fast delay
				time.tick(config.heartbeatFastDelayMs);

				// Should only have one broadcast
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 1);
			});

			it("should restart regular interval after fast heartbeat", async () => {
				const client1 = createMockClient("socket-1");
				await room.addClient(client1, "upload");

				// Trigger fast heartbeat
				room.handleHeartbeat(client1);
				time.tick(config.heartbeatFastDelayMs);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 1);

				// After regular interval, should get another heartbeat
				time.tick(config.heartbeatIntervalMs);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 2);
			});

			it("should cancel regular interval during fast heartbeat scheduling", async () => {
				const client1 = createMockClient("socket-1");
				await room.addClient(client1, "upload");

				// At t=0, trigger fast heartbeat - fast delay (50ms) is sooner than regular (1000ms)
				room.handleHeartbeat(client1);

				// Fast delay fires at t=50
				time.tick(config.heartbeatFastDelayMs);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 1);

				// Regular interval would have fired at t=1000, but now next is at t=50+1000=1050
				// Advance to t=1000 - no additional message
				time.tick(config.heartbeatIntervalMs - config.heartbeatFastDelayMs);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 1);

				// Advance to t=1050 - second message
				time.tick(config.heartbeatFastDelayMs);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 2);
			});

			it("should not schedule fast heartbeat if regular is sooner", async () => {
				const client1 = createMockClient("socket-1");
				await room.addClient(client1, "upload");

				// Advance to 10ms before regular heartbeat would fire
				time.tick(config.heartbeatIntervalMs - 10);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 0);

				// Trigger fast heartbeat - but fast delay (50ms) would fire AFTER regular (10ms away)
				room.handleHeartbeat(client1);

				// Advance 10ms - regular heartbeat should fire (not rescheduled for fast delay)
				time.tick(10);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 1);
			});

			it("should properly reschedule after command flush broadcasts heartbeat", async () => {
				let onFlushCallback: ((commands: Command[]) => void) | undefined;
				const captureFlushCommandBuffer: ICommandBuffer = {
					addCommands: spy(),
					flush: spy(),
					getBufferSize: () => 0,
					clear: spy(),
					dispose: spy(),
				};

				room.dispose();
				room = new CollaborationRoom(
					"test-room",
					config,
					mockCompression,
					mockDatabase,
					{
						createRoomState: () => createMockRoomState(true),
						createCommandBuffer: (_config, onFlush) => {
							onFlushCallback = onFlush;
							return captureFlushCommandBuffer;
						},
					},
				);

				const client1 = createMockClient("socket-1");
				await room.addClient(client1, "upload");

				// Schedule fast heartbeat
				room.handleHeartbeat(client1);

				// Before fast delay, trigger command flush (which broadcasts heartbeat immediately)
				time.tick(config.heartbeatFastDelayMs - 10);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 0);

				// Flush commands - broadcasts command_batch + heartbeat_response
				onFlushCallback?.([{
					type: "page.add",
					commandId: "cmd-1",
					userId: "u1",
					pageId: "new-page",
					data: {},
				} as PageAddCommand]);

				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 2);
				const message1 = (client1.sendMessage as ReturnType<typeof spy>).calls[0].args[0] as ServerMessage;
				const message2 = (client1.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
				assertEquals(message1.type, "command_batch");
				assertEquals(message2.type, "heartbeat_response");

				// The fast heartbeat timer should have been cancelled
				// Next heartbeat should be at full interval after the command flush
				time.tick(config.heartbeatIntervalMs - 1);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 2);

				time.tick(1);
				assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 3);
				const message3 = (client1.sendMessage as ReturnType<typeof spy>).calls[2].args[0] as ServerMessage;
				assertEquals(message3.type, "heartbeat_response");
			});
		});

		describe("snapshot timer", () => {
			it("should save snapshot at configured interval when state has changed", async () => {
				// Make state appear changed
				let hasChanged = true;
				mockRoomState.consumeStateChanges = spy(() => {
					const result = { data: createTestState(), hasChanged };
					hasChanged = true; // Keep returning hasChanged=true for this test
					return result;
				});

				room.dispose();
				room = new CollaborationRoom(
					"test-room",
					config,
					mockCompression,
					mockDatabase,
					{
						createRoomState: () => mockRoomState,
						createCommandBuffer: () => mockCommandBuffer,
					},
				);

				// Reset spy call counts after room creation (which may trigger initial load)
				(mockDatabase.saveSnapshot as ReturnType<typeof spy>).calls.length = 0;

				// Advance time to just before snapshot interval - no save yet
				time.tick(config.snapshotIntervalMs - 1);
				assertSpyCalls(mockDatabase.saveSnapshot as ReturnType<typeof spy>, 0);

				// Advance by 1 more ms to reach exactly the interval
				time.tick(1);
				await flushPromises();
				assertSpyCalls(mockDatabase.saveSnapshot as ReturnType<typeof spy>, 1);

				// Advance by half interval - no additional save
				time.tick(config.snapshotIntervalMs / 2);
				assertSpyCalls(mockDatabase.saveSnapshot as ReturnType<typeof spy>, 1);

				// Advance to complete the second interval - second save
				time.tick(config.snapshotIntervalMs / 2);
				await flushPromises();
				assertSpyCalls(mockDatabase.saveSnapshot as ReturnType<typeof spy>, 2);
			});

			it("should not save snapshot when state has not changed", () => {
				// Ensure state reports no changes
				mockRoomState.consumeStateChanges = spy(() => ({
					data: null,
					hasChanged: false,
				}));

				room.dispose();
				room = new CollaborationRoom(
					"test-room",
					config,
					mockCompression,
					mockDatabase,
					{
						createRoomState: () => mockRoomState,
						createCommandBuffer: () => mockCommandBuffer,
					},
				);

				// Reset spy call counts
				(mockDatabase.saveSnapshot as ReturnType<typeof spy>).calls.length = 0;

				// Advance time by snapshot interval
				time.tick(config.snapshotIntervalMs);

				// Snapshot should NOT be saved
				assertSpyCalls(mockDatabase.saveSnapshot as ReturnType<typeof spy>, 0);
			});
		});
	});

	describe("dispose", () => {
		it("should dispose command buffer", () => {
			room.dispose();

			assertSpyCalls(mockCommandBuffer.dispose as ReturnType<typeof spy>, 1);
		});

		it("should disconnect all clients", async () => {
			const client1 = createMockClient("socket-1");
			const client2 = createMockClient("socket-2");
			await room.addClient(client1, "upload");
			await room.addClient(client2, "upload");

			room.dispose();

			assertSpyCalls(client1.disconnect as ReturnType<typeof spy>, 1);
			assertSpyCalls(client2.disconnect as ReturnType<typeof spy>, 1);
		});

		it("should clear all clients from room", async () => {
			await room.addClient(createMockClient("socket-1"), "upload");
			await room.addClient(createMockClient("socket-2"), "upload");

			room.dispose();

			assertEquals(room.getClientCount(), 0);
			assertEquals(room.isEmpty(), true);
		});
	});

	describe("command flush callback", () => {
		it("should broadcast commands when buffer flushes", async () => {
			// Create room with real command buffer to test flush behavior
			let onFlushCallback: ((commands: Command[]) => void) | undefined;

			const captureFlushCommandBuffer: ICommandBuffer = {
				addCommands: spy(),
				flush: spy(),
				getBufferSize: () => 0,
				clear: spy(),
				dispose: spy(),
			};

			room.dispose();
			room = new CollaborationRoom(
				"test-room",
				config,
				mockCompression,
				mockDatabase,
				{
					createRoomState: () => createMockRoomState(true),
					createCommandBuffer: (_config, onFlush) => {
						onFlushCallback = onFlush;
						return captureFlushCommandBuffer;
					},
				},
			);

			const client1 = createMockClient("socket-1");
			const client2 = createMockClient("socket-2");
			await room.addClient(client1, "upload");
			await room.addClient(client2, "download");

			// Simulate buffer flush
			const commands: Command[] = [
				{
					...baseCommand("u1"),
					type: "page.add",
					pageId: "new-page",
					data: {},
				} as PageAddCommand,
			];

			onFlushCallback?.(commands);

			// Both clients should receive command batch and heartbeat response
			assertSpyCalls(client1.sendMessage as ReturnType<typeof spy>, 2);
			assertSpyCalls(client2.sendMessage as ReturnType<typeof spy>, 2);

			const message1 = (client1.sendMessage as ReturnType<typeof spy>).calls[0].args[0] as ServerMessage;
			assertEquals(message1.type, "command_batch");
			if (message1.type === "command_batch") {
				assertEquals(message1.commands, commands);
			}

			const message2 = (client1.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
			assertEquals(message2.type, "heartbeat_response");
		});

		it("should not broadcast when flush has no commands", async () => {
			let onFlushCallback: ((commands: Command[]) => void) | undefined;

			room.dispose();
			room = new CollaborationRoom(
				"test-room",
				config,
				mockCompression,
				mockDatabase,
				{
					createRoomState: () => createMockRoomState(true),
					createCommandBuffer: (_config, onFlush) => {
						onFlushCallback = onFlush;
						return createMockCommandBuffer();
					},
				},
			);

			const client = createMockClient("socket-1");
			await room.addClient(client, "upload");

			// Simulate empty flush
			onFlushCallback?.([]);

			// No messages should be sent
			assertSpyCalls(client.sendMessage as ReturnType<typeof spy>, 0);
		});
	});

	describe("snapshot persistence", () => {
		it("should compress state data before saving", () => {
			let hasChanged = true;
			mockRoomState.consumeStateChanges = spy(() => {
				const result = { data: createTestState(), hasChanged };
				hasChanged = false;
				return result;
			});

			room.dispose();
			room = new CollaborationRoom(
				"test-room",
				config,
				mockCompression,
				mockDatabase,
				{
					createRoomState: () => mockRoomState,
					createCommandBuffer: () => mockCommandBuffer,
				},
			);

			room.setRoomState("socket-1", createTestState());

			// Compression should have been called
			assertSpyCalls(mockCompression.compressJSON as ReturnType<typeof spy>, 1);
		});

		it("should decompress state data when loading snapshot", async () => {
			// Pre-populate database with a snapshot
			const stateData = createTestState();
			const compressed: CompressedData = {
				method: "none",
				data: new TextEncoder().encode(JSON.stringify(stateData)),
			};

			mockDatabase.loadSnapshot = spy(() => ({
				roomId: "test-room",
				stateData: compressed,
				timestamp: Date.now(),
				clientCount: 0,
			}));

			room.dispose();
			room = new CollaborationRoom(
				"test-room",
				config,
				mockCompression,
				mockDatabase,
				{
					createRoomState: () => mockRoomState,
					createCommandBuffer: () => mockCommandBuffer,
				},
			);

			await flushPromises();

			// Decompression should have been called during load
			assertSpyCalls(mockCompression.decompressJSON as ReturnType<typeof spy>, 1);
			// State should have been set
			assertSpyCalls(mockRoomState.setState as ReturnType<typeof spy>, 1);
		});
	});
});
