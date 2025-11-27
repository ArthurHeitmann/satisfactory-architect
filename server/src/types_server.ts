/**
 * Server-only types and interfaces
 */

import type { CursorPosition, ServerMessage } from "./types_shared.ts";

// WebSocket abstraction for testing
export interface WebSocketAdapter {
	sendMessage(message: ServerMessage): void;
	close(): void;
	readonly readyState: WebSocketReadyState;
	clientId: string;
}

export enum WebSocketReadyState {
	CONNECTING = 0,
	OPEN = 1,
	CLOSING = 2,
	CLOSED = 3,
}

// Room state interfaces
export interface RoomInfo {
	roomId: string;
	clientCount: number;
	lastActivity: number;
	createdAt: number;
}

export interface ClientInfo {
	clientId: string;
	cursor: CursorPosition;
	lastHeartbeat: number;
	serverProtocolVersion: number;
}

// Configuration interfaces
export interface ServerConfig {
	port: number;
	serverProtocolVersion: number;
	serverBufferMs: number; // 50ms default
	heartbeatIntervalMs: number; // 1000ms default
	snapshotIntervalMs: number; // 30000ms default
	maxRoomsPerServer: number;
	maxClientsPerRoom: number;
	maxCommandBatchSize: number; // 100 default
}
