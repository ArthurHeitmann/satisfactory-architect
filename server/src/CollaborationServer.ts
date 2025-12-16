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
 * Factory functions for creating server dependencies
 * Used for dependency injection in tests
 */
export interface ServerDependencies {
	createRoom: (
		roomId: string,
		config: RoomConfig,
		compression: CompressionService,
		database: DatabaseManager,
	) => CollaborationRoom;
	createClient: (
		socketId: string,
		serverProtocolVersion: number,
		socket: WebSocketAdapter,
		config: ClientConfig,
		onDisconnect: (client: CollaborationClient) => void,
	) => CollaborationClient;
	generateRoomId: () => string;
}

/** Default implementations for server dependencies */
const defaultDependencies: ServerDependencies = {
	createRoom: (roomId, config, compression, database) =>
		new CollaborationRoom(roomId, config, compression, database),
	createClient: (socketId, serverProtocolVersion, socket, config, onDisconnect) =>
		new CollaborationClient(socketId, serverProtocolVersion, socket, config, onDisconnect),
	generateRoomId: () => generateSecureId(16),
};

/**
 * Core collaboration server - framework independent
 */
export class CollaborationServer {
	private rooms = new Map<string, CollaborationRoom>();
	private clients = new Map<string, CollaborationClient>(); // Keyed by socketId
	private socketIdToRoomId = new Map<string, string>();
	private socketIdToSocket = new Map<string, WebSocketAdapter>();
	private dependencies: ServerDependencies;

	constructor(
		private config: ServerConfig,
		private compression: CompressionService,
		private database: DatabaseManager,
		dependencies?: Partial<ServerDependencies>,
	) {
		this.dependencies = { ...defaultDependencies, ...dependencies };
	}

	/**
	 * Handle new WebSocket connection
	 */
	public handleConnection(socket: WebSocketAdapter): void {
		// Store socket mapping
		this.socketIdToSocket.set(socket.socketId, socket);

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
					this.handleCreateRoom(socket.socketId, message);
					break;
				case "join_room":
					this.handleJoinRoom(socket.socketId, message);
					break;
				case "command_batch":
					this.handleCommandBatch(socket.socketId, message);
					break;
				case "heartbeat":
					this.handleHeartbeat(socket.socketId, message);
					break;
				case "upload_state":
					this.handleUploadState(socket.socketId, message);
					break;
				default: {
					const unknownType = (message as { type: string }).type;
					console.warn(`Unknown message type: ${unknownType}`);
				}
			}
		} catch (error) {
			const errorMessage = ErrorHandler.handle(error, {
				socketId: socket.socketId,
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
		this.socketIdToSocket.delete(socket.socketId);
		this.removeClient(socket.socketId);
	}

	/**
	 * Get list of available rooms (for welcome message)
	 */
	public getAvailableRooms(): RoomListItem[] {
		return Array.from(this.rooms.keys()).map((roomId) => ({ roomId }));
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
		this.socketIdToRoomId.clear();
		this.socketIdToSocket.clear();
	}

	/**
	 * Generate cryptographically secure room ID
	 */
	private generateRoomId(): string {
		return this.dependencies.generateRoomId();
	}

	/**
	 * Handle create room request
	 */
	private handleCreateRoom(
		socketId: string,
		message: CreateRoomMessage,
	): void {
		// Check version compatibility
		if (!this.isVersionCompatible(message.serverProtocolVersion)) {
			throw new AppError(
				ErrorCode.VERSION_MISMATCH,
				{
					socketId,
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
			socketId,
			message.serverProtocolVersion,
		);
		const joinResponse = room.addClient(client, "upload"); // New room creator uploads initial state

		// Register room and update database
		this.rooms.set(roomId, room);
		this.socketIdToRoomId.set(socketId, roomId);
		this.database.upsertRoom(roomId);

		client.sendMessage(joinResponse);
	}

	/**
	 * Handle join room request
	 */
	private handleJoinRoom(socketId: string, message: JoinRoomMessage): void {
		// Check version compatibility
		if (!this.isVersionCompatible(message.serverProtocolVersion)) {
			throw new AppError(
				ErrorCode.VERSION_MISMATCH,
				{
					socketId,
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
				{ socketId, roomId: message.roomId },
				`Room ${message.roomId} not found`,
				true,
			);
		}

		// Create client and add to room
		const client = this.getOrCreateClient(
			socketId,
			message.serverProtocolVersion,
		);
		const joinResponse = room.addClient(client, message.intent);

		this.socketIdToRoomId.set(socketId, message.roomId);
		client.sendMessage(joinResponse);
	}

	/**
	 * Handle command batch
	 */
	private handleCommandBatch(
		socketId: string,
		message: CommandBatchMessage,
	): void {
		const client = this.clients.get(socketId);
		if (!client) {
			throw new AppError(
				ErrorCode.INTERNAL_ERROR,
				{ socketId },
				`Client ${socketId} not found when handling command batch`,
				true,
			);
		}

		// Find client's room
		const room = this.findClientRoom(socketId);
		if (!room) {
			throw new AppError(
				ErrorCode.ROOM_NOT_FOUND,
				{ socketId },
				`Client ${socketId} is not in any room`,
				true,
			);
		}
		room.handleCommandBatch(socketId, message.commands);
	}

	/**
	 * Handle heartbeat
	 */
	private handleHeartbeat(socketId: string, message: HeartbeatMessage): void {
		const client = this.clients.get(socketId);
		if (!client) {
			throw new AppError(
				ErrorCode.INTERNAL_ERROR,
				{ socketId },
				`Client ${socketId} not found when handling heartbeat`,
				true,
			);
		}

		client.updateFromHeartbeat(message);

		// Find client's room and handle heartbeat
		const room = this.findClientRoom(socketId);
		if (room) {
			room.handleHeartbeat(client);
		}
	}

	/**
	 * Handle state upload
	 */
	private handleUploadState(
		socketId: string,
		message: UploadStateMessage,
	): void {
		const room = this.findClientRoom(socketId);
		if (!room) {
			throw new AppError(
				ErrorCode.ROOM_NOT_FOUND,
				{ socketId },
				undefined,
				true,
			);
		}

		const decompressedState = this.compression.decompressJSON(
			message.stateData,
		);
		room.setRoomState(socketId, decompressedState);
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

		return this.dependencies.createRoom(
			roomId,
			roomConfig,
			this.compression,
			this.database,
		);
	}

	/**
	 * Get or create client by socket ID
	 */
	private getOrCreateClient(
		socketId: string,
		serverProtocolVersion: number,
	): CollaborationClient {
		let client = this.clients.get(socketId);
		if (!client) {
			// Get actual WebSocket from socketId mapping
			const socket = this.socketIdToSocket.get(socketId);
			if (!socket) {
				throw new AppError(
					ErrorCode.INTERNAL_ERROR,
					{ socketId },
					`No socket found for socketId ${socketId}`,
				);
			}

			const clientConfig: ClientConfig = {
				heartbeatTimeoutMs: 5000,
				maxMissedHeartbeats: 3,
			};

			client = this.dependencies.createClient(
				socketId,
				serverProtocolVersion,
				socket,
				clientConfig,
				(client) => this.removeClient(client.socketId),
			);

			this.clients.set(socketId, client);
		}
		return client;
	}

	/**
	 * Find which room a client is in
	 */
	private findClientRoom(socketId: string): CollaborationRoom | null {
		const roomId = this.socketIdToRoomId.get(socketId);
		if (!roomId) {
			return null;
		}
		return this.rooms.get(roomId) || null;
	}

	/**
	 * Remove client from server
	 */
	private removeClient(socketId: string): void {
		this.clients.delete(socketId);

		// Remove from room
		const room = this.findClientRoom(socketId);
		if (room) {
			room.removeClient(socketId);
			this.socketIdToRoomId.delete(socketId);

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
