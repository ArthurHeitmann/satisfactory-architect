/**
 * DatabaseManager unit tests (happy path)
 */

import { assertEquals } from "@std/assert";
import { describe, it, beforeEach } from "@std/testing/bdd";
import { DatabaseManager, type DatabaseAdapter } from "./persistence.ts";

interface MockCall {
	sql: string;
	params?: unknown[];
}

/** Creates a mock DatabaseAdapter that records calls */
function createMockAdapter() {
	const executeCalls: MockCall[] = [];
	const queryCalls: MockCall[] = [];
	let queryResult: unknown[] = [];
	let closeCalled = false;

	const adapter: DatabaseAdapter = {
		execute(sql: string, params?: unknown[]) {
			executeCalls.push({ sql, params });
		},
		query<T = unknown>(sql: string, params?: unknown[]): T[] {
			queryCalls.push({ sql, params });
			return queryResult as T[];
		},
		close() {
			closeCalled = true;
		},
	};

	return {
		adapter,
		executeCalls,
		queryCalls,
		setQueryResult: (result: unknown[]) => { queryResult = result; },
		isCloseCalled: () => closeCalled,
		clear: () => {
			executeCalls.length = 0;
			queryCalls.length = 0;
		},
	};
}

describe("DatabaseManager", () => {
	let mock: ReturnType<typeof createMockAdapter>;
	let db: DatabaseManager;

	beforeEach(() => {
		mock = createMockAdapter();
		db = new DatabaseManager(mock.adapter);
		// Clear calls from schema initialization
		mock.clear();
	});

	describe("upsertRoom", () => {
		it("should insert or replace room with correct parameters", () => {
			db.upsertRoom("room-123");

			assertEquals(mock.executeCalls.length, 1);
			const call = mock.executeCalls[0];
			assertEquals(call.sql.includes("INSERT OR REPLACE INTO rooms"), true);
			assertEquals((call.params as unknown[])?.[0], "room-123");
			assertEquals((call.params as unknown[])?.[1], "room-123");
		});
	});

	describe("getRoom", () => {
		it("should query room by roomId", () => {
			mock.setQueryResult([{
				room_id: "room-123",
				created_at: 1000,
				last_updated: 2000,
			}]);

			const result = db.getRoom("room-123");

			assertEquals(mock.queryCalls.length, 1);
			assertEquals(mock.queryCalls[0].params, ["room-123"]);
			assertEquals(result?.roomId, "room-123");
			assertEquals(result?.createdAt, 1000);
			assertEquals(result?.lastActivity, 2000);
		});

		it("should return null when room not found", () => {
			const result = db.getRoom("nonexistent");
			assertEquals(result, null);
		});
	});

	describe("listRooms", () => {
		it("should query all rooms", () => {
			mock.setQueryResult([
				{ room_id: "room-1", created_at: 1000, last_updated: 2000 },
				{ room_id: "room-2", created_at: 1500, last_updated: 2500 },
			]);

			const result = db.listRooms();

			assertEquals(mock.queryCalls.length, 1);
			assertEquals(result.length, 2);
			assertEquals(result[0].roomId, "room-1");
			assertEquals(result[1].roomId, "room-2");
		});
	});

	describe("saveSnapshot", () => {
		it("should save snapshot with correct parameters", () => {
			const snapshot = {
				roomId: "room-123",
				stateData: {
					method: "none" as const,
					data: new Uint8Array([1, 2, 3]),
				},
				timestamp: 5000,
				clientCount: 2,
			};

			db.saveSnapshot(snapshot);

			assertEquals(mock.executeCalls.length, 2); // INSERT + UPDATE
			
			// Check INSERT
			const insertCall = mock.executeCalls[0];
			assertEquals(insertCall.sql.includes("INSERT OR REPLACE INTO room_states"), true);
			const insertParams = insertCall.params as unknown[];
			assertEquals(insertParams[0], "room-123");
			assertEquals(insertParams[1], snapshot.stateData.data);
			assertEquals(insertParams[2], "none");
			assertEquals(insertParams[3], 5000);

			// Check UPDATE
			const updateCall = mock.executeCalls[1];
			assertEquals(updateCall.sql.includes("UPDATE rooms"), true);
			const updateParams = updateCall.params as unknown[];
			assertEquals(updateParams[0], 5000);
			assertEquals(updateParams[1], "room-123");
		});
	});

	describe("loadSnapshot", () => {
		it("should load snapshot by roomId", () => {
			const stateData = new Uint8Array([1, 2, 3]);
			mock.setQueryResult([{
				room_id: "room-123",
				state_data: stateData,
				compression_method: "none",
				timestamp: 5000,
			}]);

			const result = db.loadSnapshot("room-123");

			assertEquals(mock.queryCalls.length, 1);
			assertEquals(mock.queryCalls[0].params, ["room-123"]);
			assertEquals(result?.roomId, "room-123");
			assertEquals(result?.stateData.method, "none");
			assertEquals(result?.stateData.data, stateData);
			assertEquals(result?.timestamp, 5000);
		});

		it("should return null when no snapshot exists", () => {
			const result = db.loadSnapshot("nonexistent");
			assertEquals(result, null);
		});
	});

	describe("cleanup", () => {
		it("should delete old records", () => {
			db.cleanup(86400000); // 24 hours

			assertEquals(mock.executeCalls.length, 2);
			assertEquals(mock.executeCalls[0].sql.includes("DELETE FROM commands"), true);
			assertEquals(mock.executeCalls[1].sql.includes("DELETE FROM room_states"), true);
		});
	});

	describe("close", () => {
		it("should close the database adapter", () => {
			db.close();
			assertEquals(mock.isCloseCalled(), true);
		});
	});
});
