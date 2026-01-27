/**
 * Server-only types and interfaces
 */

import type { CursorPosition, ServerMessage } from "../shared/messages.ts";

// WebSocket abstraction for testing
export interface WebSocketAdapter {
	sendMessage(message: ServerMessage): void;
	close(): void;
	readonly readyState: WebSocketReadyState;
	socketId: string;
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
	userId: string;
	cursor: CursorPosition;
	currentPageId: string | null;
	lastHeartbeat: number;
	serverProtocolVersion: number;
}

// Configuration interfaces
export interface ServerConfig {
	port: number;
	serverProtocolVersion: number;
	serverBufferMs: number; // 50ms default
	heartbeatIntervalMs: number; // 1000ms default
	heartbeatFastDelayMs: number; // 50ms default
	snapshotIntervalMs: number; // 30000ms default
	maxRoomsPerServer: number;
	maxClientsPerRoom: number;
	maxCommandBatchSize: number; // 100 default
}
