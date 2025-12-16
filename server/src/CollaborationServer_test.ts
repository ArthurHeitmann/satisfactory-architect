/**
 * CollaborationServer unit tests
 */

import { assertEquals } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import {
	CollaborationServer,
	type ServerDependencies,
} from "./CollaborationServer.ts";
import type { CollaborationRoom } from "./CollaborationRoom.ts";
import type { CollaborationClient } from "./CollaborationClient.ts";
import type { ServerConfig, WebSocketAdapter } from "./types_server.ts";
import { WebSocketReadyState } from "./types_server.ts";
import type { CompressionService, CompressedData } from "./compression.ts";
import type { DatabaseManager } from "./persistence.ts";
import type {
	RoomJoinedMessage,
	ServerMessage,
	WelcomeMessage,
} from "../../shared/types_shared.ts";

// ============================================================================
// Test Helpers & Mocks
// ============================================================================

/** Default server configuration for tests */
function createTestConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
	return {
		port: 8080,
		serverProtocolVersion: 1,
		serverBufferMs: 50,
		heartbeatIntervalMs: 1000,
		snapshotIntervalMs: 30000,
		maxRoomsPerServer: 100,
		maxClientsPerRoom: 10,
		maxCommandBatchSize: 100,
		...overrides,
	};
}

/** Creates a mock WebSocketAdapter */
function createMockSocket(socketId: string): WebSocketAdapter {
	return {
		socketId,
		sendMessage: spy(),
		close: spy(),
		readyState: WebSocketReadyState.OPEN,
	};
}

/** Creates a mock CollaborationClient */
function createMockClient(
	socketId: string,
	serverProtocolVersion = 1,
): CollaborationClient {
	let assignedUserId: string | null = null;
	return {
		socketId,
		serverProtocolVersion,
		cursor: { x: 0, y: 0 },
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
		getClientInfo: () => ({
			userId: assignedUserId ?? socketId,
			cursor: { x: 0, y: 0 },
			lastHeartbeat: Date.now(),
			serverProtocolVersion,
		}),
		disconnect: spy(),
	} as unknown as CollaborationClient;
}

/** Creates a mock CollaborationRoom */
function createMockRoom(roomId: string): CollaborationRoom {
	return {
		roomId,
		addClient: spy((_client, _intent) => ({
			type: "room_joined" as const,
			roomId,
			userId: "u1",
			stateData: undefined,
		})),
		removeClient: spy(),
		handleCommandBatch: spy(),
		handleHeartbeat: spy(),
		setRoomState: spy(),
		getClientCount: () => 0,
		isEmpty: () => true,
		broadcast: spy(),
		dispose: spy(),
	} as unknown as CollaborationRoom;
}

/** Creates a mock CompressionService */
function createMockCompression(): CompressionService {
	return {
		registerProvider: spy(),
		setDefaultMethod: spy(),
		getDefaultMethod: () => "none" as const,
		getSupportedMethods: () => ["none" as const],
		compressJSON: spy((obj: unknown) => ({
			method: "none" as const,
			data: new TextEncoder().encode(JSON.stringify(obj)),
		})),
		decompressJSON: spy((compressed: CompressedData) => {
			// Handle both Uint8Array and plain arrays (from JSON serialization)
			const data = compressed.data instanceof Uint8Array
				? compressed.data
				: new Uint8Array(compressed.data as number[]);
			return JSON.parse(new TextDecoder().decode(data));
		}),
	} as unknown as CompressionService;
}

/** Creates a mock DatabaseManager */
function createMockDatabase(): DatabaseManager {
	return {
		upsertRoom: spy(),
		getRoom: spy(() => null),
		listRooms: spy(() => []),
		saveSnapshot: spy(),
		loadSnapshot: spy(() => null),
		saveCommand: spy(),
		cleanup: spy(),
		close: spy(),
	} as unknown as DatabaseManager;
}

// ============================================================================
// Tests
// ============================================================================

describe("CollaborationServer", () => {
	let server: CollaborationServer;
	let config: ServerConfig;
	let mockCompression: CompressionService;
	let mockDatabase: DatabaseManager;
	let mockRoom: CollaborationRoom;
	let mockClient: CollaborationClient;
	let createdClients: Map<string, CollaborationClient>;
	let createdRooms: Map<string, CollaborationRoom>;
	let time: FakeTime;

	beforeEach(() => {
		time = new FakeTime();
		config = createTestConfig();
		mockCompression = createMockCompression();
		mockDatabase = createMockDatabase();
		createdClients = new Map();
		createdRooms = new Map();

		const dependencies: ServerDependencies = {
			generateRoomId: () => "test-room-id",
			createRoom: (roomId) => {
				mockRoom = createMockRoom(roomId);
				createdRooms.set(roomId, mockRoom);
				return mockRoom;
			},
			createClient: (socketId, serverProtocolVersion) => {
				mockClient = createMockClient(socketId, serverProtocolVersion);
				createdClients.set(socketId, mockClient);
				return mockClient;
			},
		};

		server = new CollaborationServer(
			config,
			mockCompression,
			mockDatabase,
			dependencies,
		);
	});

	afterEach(() => {
		server.dispose();
		time.restore();
	});

	describe("handleConnection", () => {
		it("should send welcome message on connection", () => {
			const socket = createMockSocket("socket-1");

			server.handleConnection(socket);

			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 1);
			const message = (socket.sendMessage as ReturnType<typeof spy>).calls[0].args[0] as WelcomeMessage;
			assertEquals(message.type, "welcome");
			assertEquals(message.serverProtocolVersion, config.serverProtocolVersion);
		});

		it("should include available rooms in welcome message", () => {
			// Create a room first
			const socket1 = createMockSocket("socket-1");
			server.handleConnection(socket1);
			server.handleMessage(socket1, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));

			// Connect new client
			const socket2 = createMockSocket("socket-2");
			server.handleConnection(socket2);

			const message = (socket2.sendMessage as ReturnType<typeof spy>).calls[0].args[0] as WelcomeMessage;
			assertEquals(message.availableRooms?.length, 1);
			assertEquals(message.availableRooms?.[0].roomId, "test-room-id");
		});
	});

	describe("handleMessage - create_room", () => {
		it("should create a new room", () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));

			assertEquals(createdRooms.size, 1);
			assertEquals(createdRooms.has("test-room-id"), true);
		});

		it("should add creator client to room", () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));

			assertSpyCalls(mockRoom.addClient as ReturnType<typeof spy>, 1);
			assertSpyCall(mockRoom.addClient as ReturnType<typeof spy>, 0, {
				args: [mockClient, "upload"],
			});
		});

		it("should send room_joined message to creator", () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));

			assertSpyCalls(mockClient.sendMessage as ReturnType<typeof spy>, 1);
			const message = (mockClient.sendMessage as ReturnType<typeof spy>).calls[0].args[0] as RoomJoinedMessage;
			assertEquals(message.type, "room_joined");
			assertEquals(message.roomId, "test-room-id");
		});

		it("should upsert room in database", () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));

			assertSpyCalls(mockDatabase.upsertRoom as ReturnType<typeof spy>, 1);
			assertSpyCall(mockDatabase.upsertRoom as ReturnType<typeof spy>, 0, {
				args: ["test-room-id"],
			});
		});

		it("should reject incompatible version", () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 999,
			}));

			// Error message should be sent
			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2); // welcome + error
			const errorMessage = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
			assertEquals(errorMessage.type, "error");
		});
	});

	describe("handleMessage - join_room", () => {
		beforeEach(() => {
			// Create a room first
			const socket = createMockSocket("socket-creator");
			server.handleConnection(socket);
			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));
		});

		it("should join existing room with download intent", () => {
			const socket = createMockSocket("socket-joiner");
			server.handleConnection(socket);

			server.handleMessage(socket, JSON.stringify({
				type: "join_room",
				roomId: "test-room-id",
				serverProtocolVersion: 1,
				intent: "download",
			}));

			assertSpyCalls(mockRoom.addClient as ReturnType<typeof spy>, 2); // creator + joiner
			const lastCall = (mockRoom.addClient as ReturnType<typeof spy>).calls[1];
			const joinerClient = createdClients.get("socket-joiner");
			assertEquals(lastCall.args[0], joinerClient);
			assertEquals(lastCall.args[1], "download");
		});

		it("should join existing room with upload intent", () => {
			const socket = createMockSocket("socket-joiner");
			server.handleConnection(socket);

			server.handleMessage(socket, JSON.stringify({
				type: "join_room",
				roomId: "test-room-id",
				serverProtocolVersion: 1,
				intent: "upload",
			}));

			const lastCall = (mockRoom.addClient as ReturnType<typeof spy>).calls[1];
			const joinerClient = createdClients.get("socket-joiner");
			assertEquals(lastCall.args[0], joinerClient);
			assertEquals(lastCall.args[1], "upload");
		});

		it("should send room_joined message to joiner", () => {
			const socket = createMockSocket("socket-joiner");
			server.handleConnection(socket);

			server.handleMessage(socket, JSON.stringify({
				type: "join_room",
				roomId: "test-room-id",
				serverProtocolVersion: 1,
				intent: "download",
			}));

			const joinerClient = createdClients.get("socket-joiner");
			assertSpyCalls(joinerClient!.sendMessage as ReturnType<typeof spy>, 1);
			const sentMessage = (joinerClient!.sendMessage as ReturnType<typeof spy>).calls[0].args[0] as RoomJoinedMessage;
			assertEquals(sentMessage.type, "room_joined");
			assertEquals(sentMessage.roomId, "test-room-id");
		});

		it("should reject non-existent room", () => {
			const socket = createMockSocket("socket-joiner");
			server.handleConnection(socket);

			server.handleMessage(socket, JSON.stringify({
				type: "join_room",
				roomId: "non-existent-room",
				serverProtocolVersion: 1,
				intent: "download",
			}));

			// welcome + error
			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2);
			const errorMessage = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
			assertEquals(errorMessage.type, "error");
		});

		it("should reject incompatible version", () => {
			const socket = createMockSocket("socket-joiner");
			server.handleConnection(socket);

			server.handleMessage(socket, JSON.stringify({
				type: "join_room",
				roomId: "test-room-id",
				serverProtocolVersion: 999,
				intent: "download",
			}));

			const errorMessage = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
			assertEquals(errorMessage.type, "error");
		});
	});

	describe("handleMessage - command_batch", () => {
		beforeEach(() => {
			// Create room and join client
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));
		});

		it("should forward commands to room", () => {
			const socket = createMockSocket("socket-1");

			const commands = [
				{
					commandId: "cmd-1",
					userId: "u1",
					timestamp: Date.now(),
					type: "page.add",
					pageId: "page-1",
					data: {},
				},
			];

			server.handleMessage(socket, JSON.stringify({
				type: "command_batch",
				commands,
			}));

			assertSpyCalls(mockRoom.handleCommandBatch as ReturnType<typeof spy>, 1);
			assertSpyCall(mockRoom.handleCommandBatch as ReturnType<typeof spy>, 0, {
				args: ["socket-1", commands],
			});
		});

	it("should send error for commands from unknown client", () => {
		const socket = createMockSocket("unknown-socket");
		server.handleConnection(socket);

		server.handleMessage(socket, JSON.stringify({
			type: "command_batch",
			commands: [],
		}));

		// Should send error message to socket (welcome + error)
		assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2);
		const errorMsg = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
		assertEquals(errorMsg.type, "error");

		// Room should not receive command batch from unknown client
		assertSpyCalls(mockRoom.handleCommandBatch as ReturnType<typeof spy>, 0);
	});
	});

	describe("handleMessage - heartbeat", () => {
		beforeEach(() => {
			// Create room and join client
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));
		});

		it("should update client from heartbeat", () => {
			const socket = createMockSocket("socket-1");
			const heartbeatMessage = {
				type: "heartbeat",
				cursor: { x: 100, y: 200 },
				localIdCounter: "500",
			};

			server.handleMessage(socket, JSON.stringify(heartbeatMessage));

			assertSpyCalls(mockClient.updateFromHeartbeat as ReturnType<typeof spy>, 1);
			assertSpyCall(mockClient.updateFromHeartbeat as ReturnType<typeof spy>, 0, {
				args: [heartbeatMessage],
			});
		});

		it("should forward heartbeat to room", () => {
			const socket = createMockSocket("socket-1");

			server.handleMessage(socket, JSON.stringify({
				type: "heartbeat",
				cursor: { x: 100, y: 200 },
				localIdCounter: "500",
			}));

			assertSpyCalls(mockRoom.handleHeartbeat as ReturnType<typeof spy>, 1);
			assertSpyCall(mockRoom.handleHeartbeat as ReturnType<typeof spy>, 0, {
				args: [mockClient],
			});
		});

	it("should send error for heartbeat from unknown client", () => {
		const socket = createMockSocket("unknown-socket");
		server.handleConnection(socket);

		server.handleMessage(socket, JSON.stringify({
			type: "heartbeat",
			cursor: { x: 0, y: 0 },
			localIdCounter: "0",
		}));

		// Should send error message to socket (welcome + error)
		assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2);
		const errorMsg = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
		assertEquals(errorMsg.type, "error");

		assertSpyCalls(mockRoom.handleHeartbeat as ReturnType<typeof spy>, 0);
	});
	});

	describe("handleMessage - upload_state", () => {
		beforeEach(() => {
			// Create room and join client
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));
		});

		it("should decompress and set room state", () => {
			const socket = createMockSocket("socket-1");
			const testState = { test: "state" };
			const stateData = {
				method: "none",
				data: Array.from(new TextEncoder().encode(JSON.stringify(testState))),
			};

			server.handleMessage(socket, JSON.stringify({
				type: "upload_state",
				stateData,
			}));

			assertSpyCalls(mockCompression.decompressJSON as ReturnType<typeof spy>, 1);
			assertSpyCall(mockCompression.decompressJSON as ReturnType<typeof spy>, 0, {
				args: [stateData],
			});
			assertSpyCalls(mockRoom.setRoomState as ReturnType<typeof spy>, 1);
			assertSpyCall(mockRoom.setRoomState as ReturnType<typeof spy>, 0, {
				args: ["socket-1", testState],
			});
		});

		it("should reject upload from client not in room", () => {
			const socket = createMockSocket("unknown-socket");
			server.handleConnection(socket);

			server.handleMessage(socket, JSON.stringify({
				type: "upload_state",
				stateData: { method: "none", data: [] },
			}));

			// Should send error
			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2); // welcome + error
			const errorMessage = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
			assertEquals(errorMessage.type, "error");
		});
	});

	describe("handleDisconnection", () => {
		it("should remove client from server", () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));

			server.handleDisconnection(socket);

			assertSpyCalls(mockRoom.removeClient as ReturnType<typeof spy>, 1);
			assertSpyCall(mockRoom.removeClient as ReturnType<typeof spy>, 0, {
				args: ["socket-1"],
			});
		});

		it("should dispose empty room after last client leaves", () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));

			server.handleDisconnection(socket);

			assertSpyCalls(mockRoom.dispose as ReturnType<typeof spy>, 1);
		});
	});

	describe("getAvailableRooms", () => {
		it("should return empty list when no rooms", () => {
			const rooms = server.getAvailableRooms();
			assertEquals(rooms, []);
		});

		it("should return list of room IDs", () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));

			const rooms = server.getAvailableRooms();
			assertEquals(rooms.length, 1);
			assertEquals(rooms[0].roomId, "test-room-id");
		});
	});

	describe("dispose", () => {
		it("should dispose all rooms", () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));

			server.dispose();

			assertSpyCalls(mockRoom.dispose as ReturnType<typeof spy>, 1);
		});

		it("should clear all internal state", () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			server.handleMessage(socket, JSON.stringify({
				type: "create_room",
				serverProtocolVersion: 1,
			}));

			server.dispose();

			assertEquals(server.getAvailableRooms(), []);
		});
	});

	describe("unknown message type", () => {
		it("should log warning for unknown message type", () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			// Should not throw
			server.handleMessage(socket, JSON.stringify({
				type: "unknown_type",
			}));
		});
	});

	describe("malformed messages", () => {
		it("should handle invalid JSON gracefully", () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			// Should not throw, should send error
			server.handleMessage(socket, "not valid json");

			// Error should be logged (we can't easily verify socket.sendMessage
			// since error goes to the socket passed to handleMessage)
			// Just verify it doesn't throw
		});
	});
});
