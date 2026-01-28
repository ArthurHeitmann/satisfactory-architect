/**
 * CollaborationServer unit tests
 */

import { assertEquals, assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import {
	CollaborationServer,
	type ServerDependencies,
} from "./CollaborationServer.ts";
import type { CollaborationRoom } from "./CollaborationRoom.ts";
import type { ICollaborationClient } from "./CollaborationClient.ts";
import type { ServerConfig, WebSocketAdapter } from "./types_server.ts";
import { WebSocketReadyState } from "./types_server.ts";
import type { DatabaseManager } from "./persistence.ts";
import type {
ClientMessage,
Command,
	HeartbeatMessage,
	RoomInfoMessage,
	RoomJoinedMessage,
	ServerMessage,
	UploadConfirmationMessage,
	WelcomeMessage,
} from "../shared/messages.ts";
import { CompressedData, CompressionService } from "../shared/CompressionService.ts";
import { AppStateJson } from "../shared/types_serialization.ts";

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
		heartbeatFastDelayMs: 50,
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
): ICollaborationClient {
	let assignedUserId: string | null = null;
	return {
		socketId,
		serverProtocolVersion,
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
		getClientInfo: () => ({
			userId: assignedUserId ?? socketId,
			cursor: { x: 0, y: 0 },
			currentPageId: null,
			lastHeartbeat: Date.now(),
			serverProtocolVersion,
		}),
		disconnect: spy(),
		dispose: spy(),
	} as ICollaborationClient;
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
		getAllowedIntents: () => ["download", "upload"],
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

interface MockRoomData {
	roomId: string;
	createdAt: number;
	lastActivity: number;
}

/** Creates a mock DatabaseManager */
function createMockDatabase(roomsMap = new Map<string, MockRoomData>()): DatabaseManager {
	return {
		upsertRoom: spy((roomId: string) => {
			roomsMap.set(roomId, { roomId, createdAt: Date.now(), lastActivity: Date.now() });
		}),
		getRoom: spy((roomId: string) => roomsMap.get(roomId) || null),
		listRooms: spy(() => Array.from(roomsMap.values())),
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
	let mockClient: ICollaborationClient;
	let createdClients: Map<string, ICollaborationClient>;
	let createdRooms: Map<string, CollaborationRoom>;
	let dbRooms: Map<string, MockRoomData>;
	let time: FakeTime;

	beforeEach(() => {
		time = new FakeTime();
		config = createTestConfig();
		mockCompression = createMockCompression();
		dbRooms = new Map();
		mockDatabase = createMockDatabase(dbRooms);
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

		it("should include available rooms in welcome message", async () => {
			// Create a room first
			const socket1 = createMockSocket("socket-1");
			server.handleConnection(socket1);
			await server.handleMessage(socket1, {
				type: "create_room",
				serverProtocolVersion: 1,
			});

			// Connect new client
			const socket2 = createMockSocket("socket-2");
			server.handleConnection(socket2);

			const message = (socket2.sendMessage as ReturnType<typeof spy>).calls[0].args[0] as WelcomeMessage;
			assertEquals(message.availableRooms?.length, 1);
			assertEquals(message.availableRooms?.[0].roomId, "test-room-id");
		});
	});

	describe("handleMessage - create_room", () => {
		it("should create a new room", async () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});

			assertEquals(createdRooms.size, 1);
			assertEquals(createdRooms.has("test-room-id"), true);
		});

		it("should add creator client to room", async () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});

			assertSpyCalls(mockRoom.addClient as ReturnType<typeof spy>, 1);
			assertSpyCall(mockRoom.addClient as ReturnType<typeof spy>, 0, {
				args: [mockClient, "upload"],
			});
		});

		it("should send room_joined message to creator", async () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});

			assertSpyCalls(mockClient.sendMessage as ReturnType<typeof spy>, 1);
			const message = (mockClient.sendMessage as ReturnType<typeof spy>).calls[0].args[0] as RoomJoinedMessage;
			assertEquals(message.type, "room_joined");
			assertEquals(message.roomId, "test-room-id");
		});

		it("should upsert room in database", async () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});

			assertSpyCalls(mockDatabase.upsertRoom as ReturnType<typeof spy>, 1);
			assertSpyCall(mockDatabase.upsertRoom as ReturnType<typeof spy>, 0, {
				args: ["test-room-id"],
			});
		});

		it("should reject incompatible version", async () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 999,
			});

			// Error message should be sent
			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2); // welcome + error
			const errorMessage = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
			assertEquals(errorMessage.type, "error");
		});

		it("should reject if client is already in a room", async () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			// First create a room
			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});

			// Try to create another room
			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});

			// Error message should be sent
			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2); // welcome + error
			const errorMessage = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
			assertEquals(errorMessage.type, "error");
		});
	});

	describe("handleMessage - join_room", () => {
		beforeEach(async () => {
			// Create a room first
			const socket = createMockSocket("socket-creator");
			server.handleConnection(socket);
			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});
		});

		it("should join existing room with download intent", async () => {
			const socket = createMockSocket("socket-joiner");
			server.handleConnection(socket);

			await server.handleMessage(socket, {
				type: "join_room",
				roomId: "test-room-id",
				serverProtocolVersion: 1,
				intent: "download",
			});

			assertSpyCalls(mockRoom.addClient as ReturnType<typeof spy>, 2); // creator + joiner
			const lastCall = (mockRoom.addClient as ReturnType<typeof spy>).calls[1];
			const joinerClient = createdClients.get("socket-joiner");
			assertEquals(lastCall.args[0], joinerClient);
			assertEquals(lastCall.args[1], "download");
		});

		it("should join existing room with upload intent", async () => {
			const socket = createMockSocket("socket-joiner");
			server.handleConnection(socket);

			await server.handleMessage(socket, {
				type: "join_room",
				roomId: "test-room-id",
				serverProtocolVersion: 1,
				intent: "upload",
			});

			const lastCall = (mockRoom.addClient as ReturnType<typeof spy>).calls[1];
			const joinerClient = createdClients.get("socket-joiner");
			assertEquals(lastCall.args[0], joinerClient);
			assertEquals(lastCall.args[1], "upload");
		});

		it("should send room_joined message to joiner", async () => {
			const socket = createMockSocket("socket-joiner");
			server.handleConnection(socket);

			await server.handleMessage(socket, {
				type: "join_room",
				roomId: "test-room-id",
				serverProtocolVersion: 1,
				intent: "download",
			});

			const joinerClient = createdClients.get("socket-joiner");
			assertSpyCalls(joinerClient!.sendMessage as ReturnType<typeof spy>, 1);
			const sentMessage = (joinerClient!.sendMessage as ReturnType<typeof spy>).calls[0].args[0] as RoomJoinedMessage;
			assertEquals(sentMessage.type, "room_joined");
			assertEquals(sentMessage.roomId, "test-room-id");
		});

		it("should reject non-existent room", async () => {
			const socket = createMockSocket("socket-joiner");
			server.handleConnection(socket);

			await server.handleMessage(socket, {
				type: "join_room",
				roomId: "non-existent-room",
				serverProtocolVersion: 1,
				intent: "download",
			});

			// welcome + error
			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2);
			const errorMessage = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
			assertEquals(errorMessage.type, "error");
		});

		it("should join room from database if not in memory", async () => {
			const socket = createMockSocket("socket-joiner-db");
			server.handleConnection(socket);

			const roomId = "db-room-id";
			mockDatabase.upsertRoom(roomId);

			await server.handleMessage(socket, {
				type: "join_room",
				roomId: roomId,
				serverProtocolVersion: 1,
				intent: "upload",
			});

			// welcome message
			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 1);
			
			// room_joined message
			const joinerClient = createdClients.get("socket-joiner-db");
			assertExists(joinerClient);
			assertSpyCalls(joinerClient.sendMessage as ReturnType<typeof spy>, 1);
			const joinResponse = (joinerClient.sendMessage as ReturnType<typeof spy>).calls[0].args[0] as RoomJoinedMessage;
			assertEquals(joinResponse.type, "room_joined");
			assertEquals(joinResponse.roomId, roomId);
		});

		it("should reject incompatible version", async () => {
			const socket = createMockSocket("socket-joiner");
			server.handleConnection(socket);

			await server.handleMessage(socket, {
				type: "join_room",
				roomId: "test-room-id",
				serverProtocolVersion: 999,
				intent: "download",
			});

			const errorMessage = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
			assertEquals(errorMessage.type, "error");
		});

		it("should reject if client is already in a room", async () => {
			const socket = createMockSocket("socket-joiner");
			server.handleConnection(socket);

			// First join the room
			await server.handleMessage(socket, {
				type: "join_room",
				roomId: "test-room-id",
				serverProtocolVersion: 1,
				intent: "download",
			});

			// Try to join again
			await server.handleMessage(socket, {
				type: "join_room",
				roomId: "test-room-id",
				serverProtocolVersion: 1,
				intent: "download",
			});

			// Error message should be sent
			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2); // welcome + error
			const errorMessage = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
			assertEquals(errorMessage.type, "error");
		});
	});

	describe("handleMessage - get_room_info", () => {
		it("should return room info if room exists", async () => {
			const socket = createMockSocket("socket-info");
			server.handleConnection(socket); // Call 0: welcome

			// Create a room first
			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});
			// Note: create_room sends room_joined to client.sendMessage, not socket.sendMessage

			const roomId = "test-room-id";

			// Request info
			await server.handleMessage(socket, {
				type: "get_room_info",
				roomId: roomId,
			});

			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2);
			const infoResponse = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as RoomInfoMessage;
			assertEquals(infoResponse.type, "room_info");
			assertExists(infoResponse.info);
			if (infoResponse.info) {
				assertEquals(infoResponse.info.roomId, roomId);
				assertEquals(infoResponse.info.clientCount, 0); // Mock room returns 0
				assertEquals(infoResponse.info.allowedIntents, ["download", "upload"]);
			}
		});

		it("should return null if room does not exist", async () => {
			const socket = createMockSocket("socket-info-missing");
			server.handleConnection(socket);

			await server.handleMessage(socket, {
				type: "get_room_info",
				roomId: "non-existent-room",
			});

			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2);
			const infoResponse = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as RoomInfoMessage;
			assertEquals(infoResponse.type, "room_info");
			assertEquals(infoResponse.info, null);
		});

		it("should return room info for room in database but not in memory", async () => {
			const socket = createMockSocket("socket-info-db");
			server.handleConnection(socket);

			// Manually add room to mock database
			const roomId = "db-room-id-info";
			mockDatabase.upsertRoom(roomId);

			// Request info
			await server.handleMessage(socket, {
				type: "get_room_info",
				roomId: roomId,
			});

			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2);
			const infoResponse = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as RoomInfoMessage;
			assertEquals(infoResponse.type, "room_info");
			assertExists(infoResponse.info);
			if (infoResponse.info) {
				assertEquals(infoResponse.info.roomId, roomId);
			}
		});
	});

	describe("handleMessage - command_batch", () => {
		beforeEach(async () => {
			// Create room and join client
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});
		});

		it("should forward commands to room", async () => {
			const socket = createMockSocket("socket-1");

			const commands = [
				{
					commandId: "cmd-1",
					userId: "u1",
					timestamp: Date.now(),
					type: "page.add",
					pageId: "page-1",
					data: {},
				} as Command,
			];

			await server.handleMessage(socket, {
				type: "command_batch",
				commands,
			});

			assertSpyCalls(mockRoom.handleCommandBatch as ReturnType<typeof spy>, 1);
			assertSpyCall(mockRoom.handleCommandBatch as ReturnType<typeof spy>, 0, {
				args: ["socket-1", commands],
			});
		});

	it("should send error for commands from unknown client", async () => {
		const socket = createMockSocket("unknown-socket");
		server.handleConnection(socket);

		await server.handleMessage(socket, {
			type: "command_batch",
			commands: [],
		});

		// Should send error message to socket (welcome + error)
		assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2);
		const errorMsg = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
		assertEquals(errorMsg.type, "error");

		// Room should not receive command batch from unknown client
		assertSpyCalls(mockRoom.handleCommandBatch as ReturnType<typeof spy>, 0);
	});
	});

	describe("handleMessage - heartbeat", () => {
		beforeEach(async () => {
			// Create room and join client
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});
		});

		it("should update client from heartbeat", async () => {
			const socket = createMockSocket("socket-1");
			const heartbeatMessage: HeartbeatMessage = {
				type: "heartbeat",
				cursor: { x: 100, y: 200 },
				currentPageId: "page-1",
				localIdCounter: "500",
			};

			await server.handleMessage(socket, heartbeatMessage);

			assertSpyCalls(mockClient.updateFromHeartbeat as ReturnType<typeof spy>, 1);
			assertSpyCall(mockClient.updateFromHeartbeat as ReturnType<typeof spy>, 0, {
				args: [heartbeatMessage],
			});
		});

		it("should forward heartbeat to room", async () => {
			const socket = createMockSocket("socket-1");

			await server.handleMessage(socket, {
				type: "heartbeat",
				cursor: { x: 100, y: 200 },
				currentPageId: "page-1",
				localIdCounter: "500",
			});

			assertSpyCalls(mockRoom.handleHeartbeat as ReturnType<typeof spy>, 1);
			assertSpyCall(mockRoom.handleHeartbeat as ReturnType<typeof spy>, 0, {
				args: [mockClient],
			});
		});

		it("should send error for heartbeat from unknown client", async () => {
			const socket = createMockSocket("unknown-socket");
			server.handleConnection(socket);

			await server.handleMessage(socket, {
				type: "heartbeat",
				cursor: { x: 0, y: 0 },
				currentPageId: null,
				localIdCounter: "0",
			});

			// Should send error message to socket (welcome + error)
			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2);
			const errorMsg = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
			assertEquals(errorMsg.type, "error");

			assertSpyCalls(mockRoom.handleHeartbeat as ReturnType<typeof spy>, 0);
		});
	});

	describe("handleMessage - upload_state", () => {
		beforeEach(async () => {
			// Create room and join client
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});
		});

		it("should pass state data to room directly", async () => {
			const socket = createMockSocket("socket-1");
			const testState = { test: "state" };

			await server.handleMessage(socket, {
				type: "upload_state",
				stateData: testState as unknown as AppStateJson,
			});

			assertSpyCalls(mockRoom.setRoomState as ReturnType<typeof spy>, 1);
			assertSpyCall(mockRoom.setRoomState as ReturnType<typeof spy>, 0, {
				args: ["socket-1", testState],
			});
			assertSpyCalls(mockClient.sendMessage as ReturnType<typeof spy>, 2);
			const confirmationMessage = (mockClient.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as UploadConfirmationMessage;
			assertEquals(confirmationMessage.type, "upload_confirmation");
		});

		it("should reject upload from client not in room", async () => {
			const socket = createMockSocket("unknown-socket");
			server.handleConnection(socket);

			await server.handleMessage(socket, {
				type: "upload_state",
				stateData: { test: "state" } as unknown as AppStateJson,
			});

			// Should send error
			assertSpyCalls(socket.sendMessage as ReturnType<typeof spy>, 2); // welcome + error
			const errorMessage = (socket.sendMessage as ReturnType<typeof spy>).calls[1].args[0] as ServerMessage;
			assertEquals(errorMessage.type, "error");
		});
	});

	describe("handleDisconnection", () => {
		it("should remove client from server", async () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});

			server.handleDisconnection(socket);

			assertSpyCalls(mockClient.dispose as ReturnType<typeof spy>, 1);

			assertSpyCalls(mockRoom.removeClient as ReturnType<typeof spy>, 1);
			assertSpyCall(mockRoom.removeClient as ReturnType<typeof spy>, 0, {
				args: ["socket-1"],
			});
		});

		it("should dispose empty room after last client leaves", async () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});

			server.handleDisconnection(socket);

			assertSpyCalls(mockRoom.dispose as ReturnType<typeof spy>, 1);
		});
	});

	describe("getAvailableRooms", () => {
		it("should return empty list when no rooms", () => {
			const rooms = server.getAvailableRooms();
			assertEquals(rooms, []);
		});

		it("should return list of room IDs", async () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});

			const rooms = server.getAvailableRooms();
			assertEquals(rooms.length, 1);
			assertEquals(rooms[0].roomId, "test-room-id");
		});
	});

	describe("dispose", () => {
		it("should dispose all rooms", async () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});

			server.dispose();

			assertSpyCalls(mockRoom.dispose as ReturnType<typeof spy>, 1);
		});

		it("should clear all internal state", async () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);
			await server.handleMessage(socket, {
				type: "create_room",
				serverProtocolVersion: 1,
			});

			server.dispose();
			dbRooms.clear(); // Clear DB too for this test

			assertEquals(server.getAvailableRooms(), []);
		});
	});

	describe("broadcastAll", () => {
		it("should send message to all connected sockets", () => {
			const socket1 = createMockSocket("socket-1");
			const socket2 = createMockSocket("socket-2");
			const socket3 = createMockSocket("socket-3");

			server.handleConnection(socket1);
			server.handleConnection(socket2);
			server.handleConnection(socket3);

			server.broadcastAll({
				type: "user_message",
				message: "Server is shutting down...",
			});

			assertSpyCalls(socket1.sendMessage as ReturnType<typeof spy>, 2); // welcome + broadcast
			assertSpyCalls(socket2.sendMessage as ReturnType<typeof spy>, 2);
			assertSpyCalls(socket3.sendMessage as ReturnType<typeof spy>, 2);

			// Verify the broadcast message content
			assertSpyCall(socket1.sendMessage as ReturnType<typeof spy>, 1, {
				args: [{ type: "user_message", message: "Server is shutting down..." }],
			});
			assertSpyCall(socket2.sendMessage as ReturnType<typeof spy>, 1, {
				args: [{ type: "user_message", message: "Server is shutting down..." }],
			});
			assertSpyCall(socket3.sendMessage as ReturnType<typeof spy>, 1, {
				args: [{ type: "user_message", message: "Server is shutting down..." }],
			});
		});
	});

	describe("unknown message type", () => {
		it("should log warning for unknown message type", async () => {
			const socket = createMockSocket("socket-1");
			server.handleConnection(socket);

			// Should not throw
			await server.handleMessage(socket, {
				type: "unknown_type",
			} as unknown as ClientMessage);
		});
	});
});
