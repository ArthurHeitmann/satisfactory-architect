/**
 * Shared message types between client and server
 */

import type { AppStateJson, GraphEdgeJson, GraphNodeJson, GraphPageJson, GraphViewJson } from "./types_serialization.ts";


export interface VersionInfo {
	serverProtocolVersion: number;
}

interface CommandBase {
	commandId: string;
	userId: string;
	timestamp: number;
}

export interface PageAddCommand extends CommandBase {
	type: "page.add";
	pageId: string;
	data: GraphPageJson;
}

export interface PageDeleteCommand extends CommandBase {
	type: "page.delete";
	pageId: string;
}

export interface PageModifyCommand extends CommandBase {
	type: "page.modify";
	pageId: string;
	data: Partial<GraphPageJson>;
}

export interface PageReorderCommand extends CommandBase {
	type: "page.reorder";
	pageOrder: string[];
}

export type ObjectType = "node" | "edge";

export interface ObjectAddCommand extends CommandBase {
	type: "object.add";
	pageId: string;
	objectType: ObjectType;
	objectId: string;
	data: GraphNodeJson | GraphEdgeJson;
}

export interface ObjectDeleteCommand extends CommandBase {
	type: "object.delete";
	pageId: string;
	objectType: ObjectType;
	objectId: string;
}

export interface ObjectModifyCommand extends CommandBase {
	type: "object.modify";
	pageId: string;
	objectType: ObjectType;
	objectId: string;
	data: Partial<GraphNodeJson> | Partial<GraphEdgeJson>;
}

export type StateVarName = "currentPageId" | "name";

export interface StateVarUpdateCommand extends CommandBase {
	type: "statevar.update";
	name: StateVarName;
	value: unknown;
}

export interface ViewUpdateCommand extends CommandBase {
	type: "view.update";
	pageId: string;
	data: GraphViewJson;
}

export type Command =
	| PageAddCommand
	| PageDeleteCommand
	| PageModifyCommand
	| PageReorderCommand
	| ObjectAddCommand
	| ObjectDeleteCommand
	| ObjectModifyCommand
	| StateVarUpdateCommand
	| ViewUpdateCommand;

export type CommandType = Command["type"];

export type ClientMessage =
	| CreateRoomMessage
	| JoinRoomMessage
	| CommandBatchMessage
	| HeartbeatMessage
	| UploadStateMessage
	| GetRoomInfoMessage;

export interface CreateRoomMessage extends VersionInfo {
	type: "create_room";
}

export interface GetRoomInfoMessage {
	type: "get_room_info";
	roomId: string;
}

export type JoinRoomIntent = "download" | "upload";

export interface JoinRoomMessage extends VersionInfo {
	type: "join_room";
	roomId: string;
	intent: JoinRoomIntent;
}

export interface CommandBatchMessage {
	type: "command_batch";
	commands: Command[];
}

export interface HeartbeatMessage {
	type: "heartbeat";
	cursor: CursorPosition;
	currentPageId: string | null;
	localIdCounter: string;
}

export interface UploadStateMessage {
	type: "upload_state";
	stateData: AppStateJson;
}

export type ServerMessage =
	| WelcomeMessage
	| RoomJoinedMessage
	| UploadConfirmationMessage
	| CommandBatchMessage
	| HeartbeatResponseMessage
	| RoomInfoMessage
	| ErrorMessage;

export interface WelcomeMessage extends VersionInfo {
	type: "welcome";
	availableRooms?: RoomListItem[];
}

export interface RoomJoinedMessage {
	type: "room_joined";
	roomId: string;
	userId: string;
	stateData?: AppStateJson;
}

export interface UploadConfirmationMessage {
	type: "upload_confirmation";
}

export interface RoomInfoMessage {
	type: "room_info";
	info: {
		roomId: string;
		clientCount: number;
		allowedIntents: JoinRoomIntent[];
	} | null;
}

export interface HeartbeatResponseMessage {
	type: "heartbeat_response";
	clients: ClientPresence[];
	highestIdCounter: string;
}

export interface ErrorMessage {
	type: "error";
	message: string;
	code?: ErrorCode;
}

export interface CursorPosition {
	x: number;
	y: number;
}

export interface ClientPresence {
	userId: string;
	cursor: CursorPosition;
	currentPageId: string | null;
}

export interface RoomListItem {
	roomId: string;
	// Future: clientCount, lastActivity, name, etc.
}

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
