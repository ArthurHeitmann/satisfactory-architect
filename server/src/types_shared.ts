/**
 * Shared message types between client and server
 */

import type { CompressedData } from "./compression.ts";

// Server protocol version compatibility
export interface VersionInfo {
	serverProtocolVersion: number;
}

// Base command fields shared by all commands
interface CommandBase {
	commandId: string; // UUID for deduplication
	clientId: string; // Source client (assigned by server)
	timestamp: number; // Client timestamp (for ordering)
}

// Page commands
export interface PageAddCommand extends CommandBase {
	type: "page.add";
	pageId: string;
	data: unknown; // Full page JSON
}

export interface PageDeleteCommand extends CommandBase {
	type: "page.delete";
	pageId: string;
}

export interface PageModifyCommand extends CommandBase {
	type: "page.modify";
	pageId: string;
	data: Record<string, unknown>; // Properties to update
}

export interface PageReorderCommand extends CommandBase {
	type: "page.reorder";
	pageOrder: string[]; // New order of page IDs
}

// Object commands (nodes and edges)
export interface ObjectAddCommand extends CommandBase {
	type: "object.add";
	pageId: string;
	objectType: "node" | "edge";
	objectId: string;
	data: unknown; // Full node/edge JSON
}

export interface ObjectDeleteCommand extends CommandBase {
	type: "object.delete";
	pageId: string;
	objectId: string;
}

export interface ObjectModifyCommand extends CommandBase {
	type: "object.modify";
	pageId: string;
	objectId: string;
	data: unknown; // Full node/edge JSON replacement
}

// Union of all command types
export type Command =
	| PageAddCommand
	| PageDeleteCommand
	| PageModifyCommand
	| PageReorderCommand
	| ObjectAddCommand
	| ObjectDeleteCommand
	| ObjectModifyCommand;

// Helper type for command type strings
export type CommandType = Command["type"];

// Client → Server messages
export type ClientMessage =
	| CreateRoomMessage
	| JoinRoomMessage
	| CommandBatchMessage
	| HeartbeatMessage
	| UploadStateMessage;

export interface CreateRoomMessage extends VersionInfo {
	type: "create_room";
}

export type JoinRoomIntent = "download" | "upload";

export interface JoinRoomMessage extends VersionInfo {
	type: "join_room";
	roomId: string;
	intent: JoinRoomIntent; // "download" = get existing state, "upload" = provide state
}

export interface CommandBatchMessage {
	type: "command_batch";
	commands: Command[];
}

export interface HeartbeatMessage {
	type: "heartbeat";
	cursor: CursorPosition;
	localIdCounter: string; // String to match UI's IdGen.toJSON() format
}

export interface UploadStateMessage {
	type: "upload_state";
	stateData: CompressedData; // Compressed AppState
}

// Server → Client messages
export type ServerMessage =
	| WelcomeMessage
	| RoomJoinedMessage
	| CommandBatchMessage
	| HeartbeatResponseMessage
	| StateSnapshotMessage
	| ErrorMessage;

export interface WelcomeMessage extends VersionInfo {
	type: "welcome";
	availableRooms?: RoomListItem[];
}

export interface RoomJoinedMessage {
	type: "room_joined";
	roomId: string;
	clientId: string;
	stateData?: unknown; // Compressed AppState JSON (if download requested)
}

export interface HeartbeatResponseMessage {
	type: "heartbeat_response";
	clients: ClientPresence[];
	highestIdCounter: string; // String to match UI's IdGen.toJSON() format
}

export interface StateSnapshotMessage {
	type: "state_snapshot";
	stateData: unknown; // Compressed AppState JSON
}

export interface ErrorMessage {
	type: "error";
	message: string;
	code?: ErrorCode; // Optional: error code (e.g., "VERSION_MISMATCH")
}

// Common data structures
export interface CursorPosition {
	x: number;
	y: number;
}

export interface ClientPresence {
	clientId: string;
	cursor: CursorPosition;
}

export interface RoomListItem {
	roomId: string;
	// Future: clientCount, lastActivity, name, etc.
}

// Error codes
export enum ErrorCode {
	VERSION_MISMATCH = "VERSION_MISMATCH",
	ROOM_NOT_FOUND = "ROOM_NOT_FOUND",
	ROOM_FULL = "ROOM_FULL",
	INVALID_MESSAGE = "INVALID_MESSAGE",
	INTERNAL_ERROR = "INTERNAL_ERROR",
	UPLOAD_NOT_AUTHORIZED = "UPLOAD_NOT_AUTHORIZED",
	STATE_NOT_INITIALIZED = "STATE_NOT_INITIALIZED",
	TIMEOUT = "TIMEOUT",
}
