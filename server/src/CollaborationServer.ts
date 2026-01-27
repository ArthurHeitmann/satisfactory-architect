/**
 * Framework-independent collaboration server core
 */

import type {
	ClientMessage,
	CommandBatchMessage,
	CreateRoomMessage,
	GetRoomInfoMessage,
	HeartbeatMessage,
	JoinRoomMessage,
	RoomInfoMessage,
	RoomListItem,
	UploadConfirmationMessage,
	UploadStateMessage,
	WelcomeMessage,
} from "../shared/messages.ts";
import { ErrorCode } from "../shared/messages.ts";
import type { ServerConfig, WebSocketAdapter } from "./types_server.ts";
import { AppError } from "./errors/AppError.ts";
import { ErrorHandler } from "./errors/ErrorHandler.ts";
import type { ClientConfig, ICollaborationClient } from "./CollaborationClient.ts";
import { CollaborationClient } from "./CollaborationClient.ts";
import type { RoomConfig } from "./CollaborationRoom.ts";
import { CollaborationRoom } from "./CollaborationRoom.ts";
import type { DatabaseManager } from "./persistence.ts";
import { generateSecureId } from "./utils.ts";
import { CompressionService } from "../shared/CompressionService.ts";

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
		onDisconnect: (client: ICollaborationClient) => void,
	) => ICollaborationClient;
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
	private clients = new Map<string, ICollaborationClient>(); // Keyed by socketId
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
	public async handleMessage(
		socket: WebSocketAdapter,
		message: ClientMessage,
	): Promise<void> {
		try {
			switch (message.type) {
				case "create_room":
					await this.handleCreateRoom(socket.socketId, message);
					break;
				case "join_room":
					await this.handleJoinRoom(socket.socketId, message);
					break;
				case "get_room_info":
					this.handleGetRoomInfo(socket.socketId, message);
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
		const activeRoomIds = new Set(this.rooms.keys());
		const dbRooms = this.database.listRooms();

		const allRoomIds = new Set(activeRoomIds);
		for (const room of dbRooms) {
			allRoomIds.add(room.roomId);
		}

		return Array.from(allRoomIds).map((roomId) => ({ roomId }));
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
	private async handleCreateRoom(
		socketId: string,
		message: CreateRoomMessage,
	): Promise<void> {
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

		try {
			// Create client and add to room
			const client = this.getOrCreateClient(
				socketId,
				message.serverProtocolVersion,
			);
			const joinResponse = await room.addClient(client, "upload"); // New room creator uploads initial state

			// Register room and update database
			this.rooms.set(roomId, room);
			this.socketIdToRoomId.set(socketId, roomId);
			this.database.upsertRoom(roomId);

			client.sendMessage(joinResponse);
		} catch (error) {
			room.dispose();
			throw error;
		}
	}

	/**
	 * Handle join room request
	 */
	private async handleJoinRoom(socketId: string, message: JoinRoomMessage): Promise<void> {
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

		const room = this.getOrLoadRoom(message.roomId);
		if (!room) {
			throw new AppError(
				ErrorCode.ROOM_NOT_FOUND,
				{ socketId, roomId: message.roomId },
				`Room ${message.roomId} not found`,
				true,
			);
		}

		try {
			// Create client and add to room
			const client = this.getOrCreateClient(
				socketId,
				message.serverProtocolVersion,
			);
			const joinResponse = await room.addClient(client, message.intent);

			this.rooms.set(message.roomId, room);
			this.socketIdToRoomId.set(socketId, message.roomId);
			client.sendMessage(joinResponse);
		} catch (error) {
			if (!this.rooms.has(message.roomId)) {
				room.dispose();
			}
			throw error;
		}
	}

	/**
	 * Handle get room info request
	 */
	private handleGetRoomInfo(
		socketId: string,
		message: GetRoomInfoMessage,
	): void {
		const socket = this.socketIdToSocket.get(socketId);
		if (!socket) {
			return;
		}

		const room = this.getOrLoadRoom(message.roomId);
		const isTemporary = room && !this.rooms.has(message.roomId);

		const response: RoomInfoMessage = {
			type: "room_info",
			info: room
				? {
					roomId: room.roomId,
					clientCount: room.getClientCount(),
					allowedIntents: room.getAllowedIntents(),
				}
				: null,
		};

		socket.sendMessage(response);

		if (isTemporary && room) {
			room.dispose();
		}
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

		room.setRoomState(socketId, message.stateData);
		const client = this.clients.get(socketId);
		if (client) {
			const confirmationMessage: UploadConfirmationMessage = {
				type: "upload_confirmation",
			};
			client.sendMessage(confirmationMessage);
		}
	}

	/**
	 * Get room by ID, loading from database if necessary.
	 * Does NOT add to this.rooms automatically.
	 */
	private getOrLoadRoom(roomId: string): CollaborationRoom | null {
		const room = this.rooms.get(roomId);
		if (room) return room;

		const roomInfo = this.database.getRoom(roomId);
		if (roomInfo) {
			return this.createRoom(roomId);
		}
		return null;
	}

	/**
	 * Create new room
	 */
	private createRoom(roomId: string): CollaborationRoom {
		const roomConfig: RoomConfig = {
			maxClients: this.config.maxClientsPerRoom,
			snapshotIntervalMs: this.config.snapshotIntervalMs,
			heartbeatIntervalMs: this.config.heartbeatIntervalMs,
			heartbeatFastDelayMs: this.config.heartbeatFastDelayMs,
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
	): ICollaborationClient {
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
		const client = this.clients.get(socketId);
		if (client) {
			client.dispose();
		}
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
