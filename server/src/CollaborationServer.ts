/**
 * Framework-independent collaboration server core
 */

import type {
	ClientMessage,
	CommandBatchMessage,
	CreateRoomMessage,
	HeartbeatMessage,
	JoinRoomMessage,
	RoomListItem,
	UploadStateMessage,
	WelcomeMessage,
} from "./types_shared.ts";
import { ErrorCode } from "./types_shared.ts";
import type { ServerConfig, WebSocketAdapter } from "./types_server.ts";
import { AppError } from "./errors/AppError.ts";
import { ErrorHandler } from "./errors/ErrorHandler.ts";
import type { ClientConfig } from "./CollaborationClient.ts";
import { CollaborationClient } from "./CollaborationClient.ts";
import type { RoomConfig } from "./CollaborationRoom.ts";
import { CollaborationRoom } from "./CollaborationRoom.ts";
import type { CompressionService } from "./compression.ts";
import type { DatabaseManager } from "./persistence.ts";
import { generateSecureId } from "./utils.ts";

/**
 * Core collaboration server - framework independent
 */
export class CollaborationServer {
	private rooms = new Map<string, CollaborationRoom>();
	private clients = new Map<string, CollaborationClient>();
	private clientIdToRoomId = new Map<string, string>();
	private clientIdToSocket = new Map<string, WebSocketAdapter>();

	constructor(
		private config: ServerConfig,
		private compression: CompressionService,
		private database: DatabaseManager,
	) {}

	/**
	 * Handle new WebSocket connection
	 */
	public handleConnection(socket: WebSocketAdapter): void {
		// Store socket mapping
		this.clientIdToSocket.set(socket.clientId, socket);

		// Send welcome message
		const welcomeMessage: WelcomeMessage = {
			type: "welcome",
			serverProtocolVersion: this.config.serverProtocolVersion,
			availableRooms: this.getAvailableRooms(),
		};

		socket.sendMessage(welcomeMessage);
	}

	/**
	 * Handle incoming WebSocket message
	 */
	public handleMessage(
		socket: WebSocketAdapter,
		rawMessage: string,
	): void {
		try {
			const message = JSON.parse(rawMessage) as ClientMessage;

			switch (message.type) {
				case "create_room":
					this.handleCreateRoom(socket.clientId, message);
					break;
				case "join_room":
					this.handleJoinRoom(socket.clientId, message);
					break;
				case "command_batch":
					this.handleCommandBatch(socket.clientId, message);
					break;
				case "heartbeat":
					this.handleHeartbeat(socket.clientId, message);
					break;
				case "upload_state":
					this.handleUploadState(socket.clientId, message);
					break;
				default: {
					const unknownType = (message as { type: string }).type;
					console.warn(`Unknown message type: ${unknownType}`);
				}
			}
		} catch (error) {
			const errorMessage = ErrorHandler.handle(error, {
				clientId: socket.clientId,
				source: "CollaborationServer.handleMessage",
			});
			if (errorMessage) {
				socket.sendMessage(errorMessage);
			}
		}
	}

	/**
	 * Handle WebSocket disconnection
	 */
	public handleDisconnection(socket: WebSocketAdapter): void {
		this.clientIdToSocket.delete(socket.clientId);
		this.removeClient(socket.clientId);
	}

	/**
	 * Get list of available rooms (for welcome message)
	 */
	public getAvailableRooms(): RoomListItem[] {
		return Array.from(this.rooms.keys()).map((roomId) => ({ roomId }));
	}

	/**
	 * Generate cryptographically secure room ID
	 */
	public generateRoomId(): string {
		return generateSecureId(16);
	}

	/**
	 * Clean up server resources
	 */
	public dispose(): void {
		// Dispose all rooms
		for (const room of this.rooms.values()) {
			room.dispose();
		}
		this.rooms.clear();
		this.clients.clear();
		this.clientIdToRoomId.clear();
		this.clientIdToSocket.clear();
	}

	/**
	 * Handle create room request
	 */
	private handleCreateRoom(
		clientId: string,
		message: CreateRoomMessage,
	): void {
		// Check version compatibility
		if (!this.isVersionCompatible(message.serverProtocolVersion)) {
			throw new AppError(
				ErrorCode.VERSION_MISMATCH,
				{
					clientId,
					clientVersion: message.serverProtocolVersion,
					serverVersion: this.config.serverProtocolVersion,
				},
				`Server protocol version mismatch. Client: v${message.serverProtocolVersion}, Server: v${this.config.serverProtocolVersion}. Please update to the same version.`,
				true,
			);
		}

		const roomId = this.generateRoomId();
		const room = this.createRoom(roomId);

		// Create client and add to room
		const client = this.getOrCreateClient(
			clientId,
			message.serverProtocolVersion,
		);
		const joinResponse = room.addClient(client, "upload"); // New room creator uploads initial state

		// Register room and update database
		this.rooms.set(roomId, room);
		this.clientIdToRoomId.set(clientId, roomId);
		this.database.upsertRoom(roomId);

		client.sendMessage(joinResponse);
	}

	/**
	 * Handle join room request
	 */
	private handleJoinRoom(clientId: string, message: JoinRoomMessage): void {
		// Check version compatibility
		if (!this.isVersionCompatible(message.serverProtocolVersion)) {
			throw new AppError(
				ErrorCode.VERSION_MISMATCH,
				{
					clientId,
					clientVersion: message.serverProtocolVersion,
					serverVersion: this.config.serverProtocolVersion,
				},
				`Server protocol version mismatch. Client: v${message.serverProtocolVersion}, Server: v${this.config.serverProtocolVersion}. Please update to the same version.`,
				true,
			);
		}

		const room = this.rooms.get(message.roomId);
		if (!room) {
			throw new AppError(
				ErrorCode.ROOM_NOT_FOUND,
				{ clientId, roomId: message.roomId },
				`Room ${message.roomId} not found`,
				true,
			);
		}

		// Create client and add to room
		const client = this.getOrCreateClient(
			clientId,
			message.serverProtocolVersion,
		);
		const joinResponse = room.addClient(client, message.intent);

		this.clientIdToRoomId.set(clientId, message.roomId);
		client.sendMessage(joinResponse);
	}

	/**
	 * Handle command batch
	 */
	private handleCommandBatch(
		clientId: string,
		message: CommandBatchMessage,
	): void {
		const client = this.clients.get(clientId);
		if (!client) {
			return;
		}

		// Find client's room
		const room = this.findClientRoom(clientId);
		if (room) {
			room.handleCommandBatch(clientId, message.commands);
		}
	}

	/**
	 * Handle heartbeat
	 */
	private handleHeartbeat(clientId: string, message: HeartbeatMessage): void {
		const client = this.clients.get(clientId);
		if (!client) {
			return;
		}

		client.updateFromHeartbeat(message);

		// Find client's room and handle heartbeat
		const room = this.findClientRoom(clientId);
		if (room) {
			room.handleHeartbeat(client);
		}
	}

	/**
	 * Handle state upload
	 */
	private handleUploadState(
		clientId: string,
		message: UploadStateMessage,
	): void {
		const room = this.findClientRoom(clientId);
		if (!room) {
			throw new AppError(
				ErrorCode.ROOM_NOT_FOUND,
				{ clientId },
				undefined,
				true,
			);
		}

		const decompressedState = this.compression.decompressJSON(
			message.stateData,
		);
		room.setRoomState(clientId, decompressedState);
	}

	/**
	 * Create new room
	 */
	private createRoom(roomId: string): CollaborationRoom {
		const roomConfig: RoomConfig = {
			maxClients: this.config.maxClientsPerRoom,
			snapshotIntervalMs: this.config.snapshotIntervalMs,
			heartbeatIntervalMs: this.config.heartbeatIntervalMs,
			commandBuffer: {
				bufferTimeMs: this.config.serverBufferMs,
				maxBatchSize: this.config.maxCommandBatchSize,
			},
		};

		return new CollaborationRoom(
			roomId,
			roomConfig,
			this.compression,
			this.database,
		);
	}

	/**
	 * Get or create client
	 */
	private getOrCreateClient(
		clientId: string,
		serverProtocolVersion: number,
	): CollaborationClient {
		let client = this.clients.get(clientId);
		if (!client) {
			// Get actual WebSocket from clientId mapping
			const socket = this.clientIdToSocket.get(clientId);
			if (!socket) {
				throw new AppError(
					ErrorCode.INTERNAL_ERROR,
					{ clientId },
					`No socket found for client ${clientId}`,
				);
			}

			const clientConfig: ClientConfig = {
				heartbeatTimeoutMs: 5000,
				maxMissedHeartbeats: 3,
			};

			client = new CollaborationClient(
				clientId,
				serverProtocolVersion,
				socket,
				clientConfig,
				(client) => this.removeClient(client.clientId),
			);

			this.clients.set(clientId, client);
		}
		return client;
	}

	/**
	 * Find which room a client is in
	 */
	private findClientRoom(clientId: string): CollaborationRoom | null {
		const roomId = this.clientIdToRoomId.get(clientId);
		if (!roomId) {
			return null;
		}
		return this.rooms.get(roomId) || null;
	}

	/**
	 * Remove client from server
	 */
	private removeClient(clientId: string): void {
		this.clients.delete(clientId);

		// Remove from room
		const room = this.findClientRoom(clientId);
		if (room) {
			room.removeClient(clientId);
			this.clientIdToRoomId.delete(clientId);

			// Clean up empty rooms
			if (room.isEmpty()) {
				this.rooms.delete(room.roomId);
				room.dispose();
			}
		}
	}

	/**
	 * Check if client version is compatible
	 */
	private isVersionCompatible(clientVersion: number): boolean {
		return clientVersion === this.config.serverProtocolVersion;
	}
}
