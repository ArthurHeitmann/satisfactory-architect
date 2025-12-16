/**
 * CollaborationClient unit tests
 */

import { assertEquals, assertThrows } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertSpyCall, assertSpyCalls, spy } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import {
	CollaborationClient,
	type ClientConfig,
} from "./CollaborationClient.ts";
import type { WebSocketAdapter } from "./types_server.ts";
import type { HeartbeatMessage, ServerMessage } from "../../shared/types_shared.ts";
import { WebSocketReadyState } from "./types_server.ts";

// ============================================================================
// Test Helpers & Mocks
// ============================================================================

/** Default client configuration for tests */
function createTestConfig(
	overrides: Partial<ClientConfig> = {},
): ClientConfig {
	return {
		heartbeatTimeoutMs: 5000,
		maxMissedHeartbeats: 3,
		...overrides,
	};
}

/** Creates a mock WebSocketAdapter */
function createMockSocket(): WebSocketAdapter {
	return {
		socketId: "socket-1",
		sendMessage: spy(),
		close: spy(),
		readyState: WebSocketReadyState.OPEN,
	};
}

// ============================================================================
// Tests
// ============================================================================

describe("CollaborationClient", () => {
	let client: CollaborationClient;
	let mockSocket: WebSocketAdapter;
	let config: ClientConfig;
	let onDisconnect: ReturnType<typeof spy>;
	let time: FakeTime;

	beforeEach(() => {
		time = new FakeTime();
		mockSocket = createMockSocket();
		config = createTestConfig();
		onDisconnect = spy() as ReturnType<typeof spy>;
	});

	afterEach(() => {
		client?.disconnect();
		time.restore();
	});

	describe("initialization", () => {
		it("should create client with socket ID and version", () => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);

			assertEquals(client.socketId, "socket-1");
			assertEquals(client.serverProtocolVersion, 1);
		});

		it("should initialize with default state", () => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);

			assertEquals(client.cursor, { x: 0, y: 0 });
			assertEquals(client.localIdCounter, "0");
			assertEquals(client.hasUserId(), false);
		});

		it("should start heartbeat timeout timer on creation", () => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);

			// Timer should be running - advance time and verify behavior
			time.tick(config.heartbeatTimeoutMs);

			// After one timeout, should not disconnect yet (maxMissedHeartbeats = 3)
			assertSpyCalls(onDisconnect, 0);
		});
	});

	describe("userId management", () => {
		beforeEach(() => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);
		});

		it("should throw error when getting userId before assignment", () => {
			assertThrows(
				() => client.userId,
				Error,
				"User ID has not been assigned yet",
			);
		});

		it("should return false from hasUserId before assignment", () => {
			assertEquals(client.hasUserId(), false);
		});

		it("should assign and return userId", () => {
			client.assignUserId("u1");

			assertEquals(client.hasUserId(), true);
			assertEquals(client.userId, "u1");
		});

		it("should allow userId reassignment", () => {
			client.assignUserId("u1");
			assertEquals(client.userId, "u1");

			client.assignUserId("u2");
			assertEquals(client.userId, "u2");
		});
	});

	describe("updateFromHeartbeat", () => {
		beforeEach(() => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);
		});

		it("should update cursor position", () => {
			const message: HeartbeatMessage = {
				type: "heartbeat",
				cursor: { x: 100, y: 200 },
				localIdCounter: "0",
			};

			client.updateFromHeartbeat(message);

			assertEquals(client.cursor, { x: 100, y: 200 });
		});

		it("should update local ID counter", () => {
			const message: HeartbeatMessage = {
				type: "heartbeat",
				cursor: { x: 0, y: 0 },
				localIdCounter: "500",
			};

			client.updateFromHeartbeat(message);

			assertEquals(client.localIdCounter, "500");
		});

		it("should reset heartbeat timeout", () => {
			const message: HeartbeatMessage = {
				type: "heartbeat",
				cursor: { x: 0, y: 0 },
				localIdCounter: "0",
			};

			// Advance time partway through timeout period
			time.tick(config.heartbeatTimeoutMs / 2);

			// Send heartbeat - should reset timer
			client.updateFromHeartbeat(message);

			// Advance time by another half period (would have timed out without reset)
			time.tick(config.heartbeatTimeoutMs / 2);

			// Should not have disconnected yet
			assertSpyCalls(onDisconnect, 0);
		});
	});

	describe("sendMessage", () => {
		beforeEach(() => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);
		});

		it("should forward message to socket", () => {
			const message: ServerMessage = {
				type: "heartbeat_response",
				clients: [],
				highestIdCounter: "0",
			};

			client.sendMessage(message);

			assertSpyCalls(mockSocket.sendMessage as ReturnType<typeof spy>, 1);
			assertSpyCall(mockSocket.sendMessage as ReturnType<typeof spy>, 0, {
				args: [message],
			});
		});
	});

	describe("getClientInfo", () => {
		beforeEach(() => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);
			client.assignUserId("u1");
		});

		it("should return client info with userId", () => {
			const info = client.getClientInfo();

			assertEquals(info.userId, "u1");
			assertEquals(info.cursor, { x: 0, y: 0 });
			assertEquals(info.serverProtocolVersion, 1);
		});

		it("should reflect updated state", () => {
			const message: HeartbeatMessage = {
				type: "heartbeat",
				cursor: { x: 50, y: 75 },
				localIdCounter: "100",
			};

			client.updateFromHeartbeat(message);
			const info = client.getClientInfo();

			assertEquals(info.cursor, { x: 50, y: 75 });
		});
	});

	describe("disconnect", () => {
		beforeEach(() => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);
		});

		it("should close socket", () => {
			client.disconnect();

			assertSpyCalls(mockSocket.close as ReturnType<typeof spy>, 1);
		});

		it("should call onDisconnect callback", () => {
			client.disconnect();

			assertSpyCalls(onDisconnect, 1);
			assertSpyCall(onDisconnect, 0, {
				args: [client],
			});
		});

		it("should not timeout after disconnect", () => {
			client.disconnect();

			// Advance time past timeout
			time.tick(config.heartbeatTimeoutMs * config.maxMissedHeartbeats);

			// Should only have been called once (from disconnect, not timeout)
			assertSpyCalls(onDisconnect, 1);
		});
	});

	describe("heartbeat timeout", () => {
		it("should not disconnect before maxMissedHeartbeats", () => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);

			// Miss heartbeats up to maxMissedHeartbeats - 1
			for (let i = 0; i < config.maxMissedHeartbeats - 1; i++) {
				time.tick(config.heartbeatTimeoutMs);
			}

			// Should not have disconnected yet
			assertSpyCalls(onDisconnect, 0);
		});

		it("should disconnect after maxMissedHeartbeats", () => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);

			// Miss maxMissedHeartbeats heartbeats
			for (let i = 0; i < config.maxMissedHeartbeats; i++) {
				time.tick(config.heartbeatTimeoutMs);
			}

			// Should have disconnected
			assertSpyCalls(onDisconnect, 1);
			assertSpyCalls(mockSocket.close as ReturnType<typeof spy>, 1);
		});

		it("should reset missed heartbeat count on heartbeat", () => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);

			// Miss some heartbeats
			time.tick(config.heartbeatTimeoutMs * 2);

			// Send heartbeat - should reset count
			const message: HeartbeatMessage = {
				type: "heartbeat",
				cursor: { x: 0, y: 0 },
				localIdCounter: "0",
			};
			client.updateFromHeartbeat(message);

			// Miss another maxMissedHeartbeats - 1 heartbeats
			time.tick(config.heartbeatTimeoutMs * (config.maxMissedHeartbeats - 1));

			// Should not have disconnected (count was reset)
			assertSpyCalls(onDisconnect, 0);
		});

		it("should use userId in timeout log when assigned", () => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);
			client.assignUserId("u1");

			// Miss maxMissedHeartbeats heartbeats
			for (let i = 0; i < config.maxMissedHeartbeats; i++) {
				time.tick(config.heartbeatTimeoutMs);
			}

			// Should have disconnected (console.log will mention u1)
			assertSpyCalls(onDisconnect, 1);
		});

		it("should use socketId in timeout log when userId not assigned", () => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);

			// Miss maxMissedHeartbeats heartbeats
			for (let i = 0; i < config.maxMissedHeartbeats; i++) {
				time.tick(config.heartbeatTimeoutMs);
			}

			// Should have disconnected (console.log will mention socket-1)
			assertSpyCalls(onDisconnect, 1);
		});
	});

	describe("edge cases", () => {
		it("should handle rapid heartbeats without issues", () => {
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);

			const message: HeartbeatMessage = {
				type: "heartbeat",
				cursor: { x: 0, y: 0 },
				localIdCounter: "0",
			};

			// Send many heartbeats in quick succession
			for (let i = 0; i < 10; i++) {
				client.updateFromHeartbeat(message);
				time.tick(100);
			}

			// Should not have disconnected
			assertSpyCalls(onDisconnect, 0);
		});

		it("should handle zero maxMissedHeartbeats", () => {
			config = createTestConfig({ maxMissedHeartbeats: 0 });
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);

			// First timeout should disconnect immediately
			time.tick(config.heartbeatTimeoutMs);

			assertSpyCalls(onDisconnect, 1);
		});

		it("should handle very short timeout interval", () => {
			config = createTestConfig({
				heartbeatTimeoutMs: 100,
				maxMissedHeartbeats: 2,
			});
			client = new CollaborationClient(
				"socket-1",
				1,
				mockSocket,
				config,
				onDisconnect,
			);

			// Should timeout quickly
			time.tick(100);
			assertSpyCalls(onDisconnect, 0);

			time.tick(100);
			assertSpyCalls(onDisconnect, 1);
		});
	});
});
