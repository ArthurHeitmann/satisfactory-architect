/**
 * SQLite database operations for persistence
 */

import type { RoomInfo } from "./types_server.ts";
import type { CompressedData } from "./compression.ts";
import { ErrorCode } from "./types_shared.ts";
import { AppError } from "./errors/AppError.ts";

// Database interface for testing
export interface DatabaseAdapter {
	execute(sql: string, params?: unknown[]): void;
	query<T = unknown>(sql: string, params?: unknown[]): T[];
	close(): void;
}

// Room state snapshot for persistence
export interface RoomSnapshot {
	roomId: string;
	stateData: CompressedData; // Compressed JSON with method indicator
	timestamp: number;
	clientCount: number;
}

// Command record for audit log
export interface CommandRecord {
	commandId: string;
	roomId: string;
	clientId: string;
	timestamp: number;
	commandType: string;
	payload: Uint8Array; // Compressed JSON
}

/**
 * Database manager for collaboration server persistence
 */
export class DatabaseManager {
	constructor(private db: DatabaseAdapter) {
		this.initializeSchema();
	}

	/**
	 * Create or update room entry
	 */
	public upsertRoom(roomId: string): void {
		try {
			const now = Date.now();
			this.db.execute(
				`
				INSERT OR REPLACE INTO rooms (room_id, created_at, last_updated)
				VALUES (?, COALESCE((SELECT created_at FROM rooms WHERE room_id = ?), ?), ?)
			`,
				[roomId, roomId, now, now],
			);
		} catch (error) {
			throw AppError.wrap(error, ErrorCode.INTERNAL_ERROR, {
				operation: "upsertRoom",
				roomId,
			}, "Failed to create or update room in database");
		}
	}

	/**
	 * Get room information
	 */
	public getRoom(roomId: string): RoomInfo | null {
		try {
			const rows = this.db.query<{
				room_id: string;
				created_at: number;
				last_updated: number;
			}>(
				`
				SELECT room_id, created_at, last_updated 
				FROM rooms 
				WHERE room_id = ?
			`,
				[roomId],
			);

			if (rows.length === 0) {
				return null;
			}

			const row = rows[0];
			return {
				roomId: row.room_id,
				createdAt: row.created_at,
				lastActivity: row.last_updated,
				clientCount: 0, // Will be updated from active connections
			};
		} catch (error) {
			throw AppError.wrap(error, ErrorCode.INTERNAL_ERROR, {
				operation: "getRoom",
				roomId,
			}, "Failed to retrieve room from database");
		}
	}

	/**
	 * List all rooms
	 */
	public listRooms(): RoomInfo[] {
		try {
			const rows = this.db.query<{
				room_id: string;
				created_at: number;
				last_updated: number;
			}>(`
				SELECT room_id, created_at, last_updated 
				FROM rooms 
				ORDER BY last_updated DESC
			`);

			return rows.map((row) => ({
				roomId: row.room_id,
				createdAt: row.created_at,
				lastActivity: row.last_updated,
				clientCount: 0,
			}));
		} catch (error) {
			throw AppError.wrap(error, ErrorCode.INTERNAL_ERROR, {
				operation: "listRooms",
			}, "Failed to list rooms from database");
		}
	}

	/**
	 * Save room state snapshot
	 */
	public saveSnapshot(snapshot: RoomSnapshot): void {
		try {
			this.db.execute(
				`
				INSERT OR REPLACE INTO room_states (room_id, state_data, compression_method, timestamp)
				VALUES (?, ?, ?, ?)
			`,
				[
					snapshot.roomId,
					snapshot.stateData.data,
					snapshot.stateData.method,
					snapshot.timestamp,
				],
			);

			// Update room last activity
			this.db.execute(
				`
				UPDATE rooms SET last_updated = ? WHERE room_id = ?
			`,
				[snapshot.timestamp, snapshot.roomId],
			);
		} catch (error) {
			throw AppError.wrap(error, ErrorCode.INTERNAL_ERROR, {
				operation: "saveSnapshot",
				roomId: snapshot.roomId,
			}, "Failed to save room snapshot to database");
		}
	}

	/**
	 * Load latest room state snapshot
	 */
	public loadSnapshot(roomId: string): RoomSnapshot | null {
		try {
			const rows = this.db.query<{
				room_id: string;
				state_data: Uint8Array;
				compression_method: string;
				timestamp: number;
			}>(
				`
				SELECT room_id, state_data, compression_method, timestamp 
				FROM room_states 
				WHERE room_id = ? 
				ORDER BY timestamp DESC 
				LIMIT 1
			`,
				[roomId],
			);

			if (rows.length === 0) {
				return null;
			}

			const row = rows[0];
			const stateData: CompressedData = {
				method: row.compression_method as CompressedData["method"],
				data: row.state_data,
			};

			return {
				roomId: row.room_id,
				stateData,
				timestamp: row.timestamp,
				clientCount: 0,
			};
		} catch (error) {
			throw AppError.wrap(error, ErrorCode.INTERNAL_ERROR, {
				operation: "loadSnapshot",
				roomId,
			}, "Failed to load room snapshot from database");
		}
	}

	/**
	 * Save command to audit log (optional feature)
	 */
	public saveCommand(record: CommandRecord): void {
		try {
			this.db.execute(
				`
				INSERT INTO commands (command_id, room_id, client_id, timestamp, command_type, payload)
				VALUES (?, ?, ?, ?, ?, ?)
			`,
				[
					record.commandId,
					record.roomId,
					record.clientId,
					record.timestamp,
					record.commandType,
					record.payload,
				],
			);
		} catch (error) {
			throw AppError.wrap(error, ErrorCode.INTERNAL_ERROR, {
				operation: "saveCommand",
				commandId: record.commandId,
			}, "Failed to save command to audit log");
		}
	}

	/**
	 * Clean up old data
	 */
	public cleanup(maxAgeMs: number): void {
		try {
			const cutoff = Date.now() - maxAgeMs;

			// Remove old command history
			this.db.execute(
				`
				DELETE FROM commands WHERE timestamp < ?
			`,
				[cutoff],
			);

			// Remove old snapshots (keep latest 3 per room)
			this.db.execute(`
				DELETE FROM room_states 
				WHERE rowid NOT IN (
					SELECT rowid FROM room_states rs1 
					WHERE (
						SELECT COUNT(*) FROM room_states rs2 
						WHERE rs2.room_id = rs1.room_id 
						AND rs2.timestamp > rs1.timestamp
					) < 3
				)
			`);
		} catch (error) {
			throw AppError.wrap(error, ErrorCode.INTERNAL_ERROR, {
				operation: "cleanup",
				maxAgeMs,
			}, "Failed to cleanup old database records");
		}
	}

	/**
	 * Close database connection
	 */
	public close(): void {
		this.db.close();
	}

	/**
	 * Initialize database schema
	 */
	private initializeSchema(): void {
		try {
			// Rooms table
			this.db.execute(`
				CREATE TABLE IF NOT EXISTS rooms (
					room_id TEXT PRIMARY KEY,
					created_at INTEGER NOT NULL,
					last_updated INTEGER NOT NULL
				) STRICT
			`);

			// Room state snapshots
			this.db.execute(`
				CREATE TABLE IF NOT EXISTS room_states (
					room_id TEXT NOT NULL,
					state_data BLOB NOT NULL,
					compression_method TEXT NOT NULL,
					timestamp INTEGER NOT NULL,
					PRIMARY KEY (room_id, timestamp),
					FOREIGN KEY (room_id) REFERENCES rooms(room_id)
				) STRICT
			`);

			// Command history (audit log)
			this.db.execute(`
				CREATE TABLE IF NOT EXISTS commands (
					command_id TEXT PRIMARY KEY,
					room_id TEXT NOT NULL,
					client_id TEXT NOT NULL,
					timestamp INTEGER NOT NULL,
					command_type TEXT NOT NULL,
					payload BLOB NOT NULL,
					FOREIGN KEY (room_id) REFERENCES rooms(room_id)
				) STRICT
			`);

			// Indexes for performance
			this.db.execute(`
				CREATE INDEX IF NOT EXISTS idx_rooms_updated ON rooms(last_updated)
			`);
			this.db.execute(`
				CREATE INDEX IF NOT EXISTS idx_room_states_room_time ON room_states(room_id, timestamp DESC)
			`);
			this.db.execute(`
				CREATE INDEX IF NOT EXISTS idx_commands_room ON commands(room_id, timestamp)
			`);
		} catch (error) {
			throw AppError.wrap(error, ErrorCode.INTERNAL_ERROR, {
				operation: "initializeSchema",
			}, "Failed to initialize database schema");
		}
	}
}
