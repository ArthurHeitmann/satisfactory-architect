/**
 * Room management and client coordination
 */

import type {
	ClientPresence,
	Command,
	CommandBatchMessage,
	HeartbeatResponseMessage,
	JoinRoomIntent,
	RoomJoinedMessage,
	ServerMessage,
} from "../../shared/types_shared.ts";
import { ErrorCode } from "../../shared/types_shared.ts";
import { AppError } from "./errors/AppError.ts";
import { ErrorHandler } from "./errors/ErrorHandler.ts";
import { Scheduler } from "./utils/Scheduler.ts";
import type { IRoomState } from "./RoomState.ts";
import { RoomState } from "./RoomState.ts";
import type { CollaborationClient } from "./CollaborationClient.ts";
import {
	CommandBuffer,
	type CommandBufferConfig,
	type ICommandBuffer,
} from "./CommandBuffer.ts";
import type { ICompressionService } from "./compression.ts";
import type { IDatabaseManager, RoomSnapshot } from "./persistence.ts";
import { AppStateJson } from "../../shared/types_serialization.ts";

export interface RoomConfig {
	maxClients: number; // 10 default
	snapshotIntervalMs: number; // 30000ms default
	heartbeatIntervalMs: number; // 1000ms default
	commandBuffer: CommandBufferConfig;
}

/**
 * Factory functions for creating room dependencies
 * Used for dependency injection in tests
 */
export interface RoomDependencies {
	createRoomState?: (roomId: string) => IRoomState;
	createCommandBuffer?: (
		config: CommandBufferConfig,
		onFlush: (commands: Command[]) => void,
	) => ICommandBuffer;
}

/**
 * Manages a collaboration room and its connected clients
 */
export class CollaborationRoom {
	private clients = new Map<string, CollaborationClient>(); // Keyed by socketId
	private nextUserNumber = 1;
	private snapshotTimer: number | null = null;
	private heartbeatTimer: number | null = null;
	private roomState: IRoomState;
	private commandBuffer: ICommandBuffer;

	constructor(
		public readonly roomId: string,
		private config: RoomConfig,
		private compression: ICompressionService,
		private database: IDatabaseManager,
		dependencies?: RoomDependencies,
	) {
		// Create room state manager with dependency injection support
		this.roomState = dependencies?.createRoomState?.(roomId) ??
			new RoomState(roomId);

		// Create command buffer with dependency injection support
		this.commandBuffer = dependencies?.createCommandBuffer?.(
			this.config.commandBuffer,
			(commands) => this.handleCommandFlush(commands),
		) ?? new CommandBuffer(
			this.config.commandBuffer,
			(commands) => this.handleCommandFlush(commands),
		);

		this.startSnapshotTimer();
		this.startHeartbeatTimer();
	}

	/**
	 * Add client to room
	 */
	public addClient(
		client: CollaborationClient,
		intent: JoinRoomIntent,
	): RoomJoinedMessage {
		if (this.clients.size >= this.config.maxClients) {
			throw new AppError(
				ErrorCode.ROOM_FULL,
				{
					roomId: this.roomId,
					clientCount: this.clients.size,
					maxClients: this.config.maxClients,
				},
				undefined,
				true,
			);
		}

		// Check if download is requested but state is not initialized
		if (intent === "download" && !this.roomState.canGetState()) {
			throw new AppError(
				ErrorCode.STATE_NOT_INITIALIZED,
				{ roomId: this.roomId, intent },
				undefined,
				true,
			);
		}
		if (intent === "upload" && !this.roomState.canSetState()) {
			throw new AppError(
				ErrorCode.UPLOAD_NOT_AUTHORIZED,
				{ roomId: this.roomId, intent },
				undefined,
				true,
			);
		}

		// Assign user ID and add client to room
		const userId = this.generateUserId();
		client.assignUserId(userId);
		this.clients.set(client.socketId, client);

		let stateData: unknown | undefined;

		if (intent === "download") {
			// Client wants to download existing room state
			stateData = this.roomState.getState();
		}

		console.log(
			`Client ${userId} joined room ${this.roomId} with intent '${intent}' (${this.clients.size}/${this.config.maxClients})`,
		);

		return {
			type: "room_joined",
			roomId: this.roomId,
			userId: userId,
			stateData,
		};
	}

	/**
	 * Remove client from room
	 */
	public removeClient(socketId: string): void {
		const client = this.clients.get(socketId);
		if (client) {
			this.clients.delete(socketId);
			const identifier = client.hasUserId() ? client.userId : socketId;
			console.log(
				`Client ${identifier} left room ${this.roomId} (${this.clients.size}/${this.config.maxClients})`,
			);
		}
	}

	/**
	 * Process command batch from client
	 */
	public handleCommandBatch(socketId: string, commands: Command[]): void {
		// Validate client is in room
		if (!this.clients.has(socketId)) {
			throw new AppError(
				ErrorCode.INTERNAL_ERROR,
				{ socketId, roomId: this.roomId },
				`Client ${socketId} is not a member of room ${this.roomId}`,
			);
		}

		// Apply commands to room state (will throw if state not initialized)
		try {
			this.roomState.applyCommands(commands);
		} catch (error) {
			ErrorHandler.handle(error, {
				source: "Room.handleCommandBatch",
				roomId: this.roomId,
				socketId,
			});
			// Don't add to buffer if command application failed
			return;
		}

		// Add commands to buffer for broadcasting
		this.commandBuffer.addCommands(commands);
	}

	/**
	 * Handle heartbeat from client
	 */
	public handleHeartbeat(client: CollaborationClient): void {
		// Forward ID counter to room state for tracking
		this.roomState.updateIdCounter(client.localIdCounter);
	}

	/**
	 * Set room state (from upload)
	 */
	public setRoomState(socketId: string, stateData: unknown): void {
		this.roomState.setState(stateData as AppStateJson);
		this.saveSnapshot();
		const client = this.clients.get(socketId);
		const identifier = client?.hasUserId() ? client.userId : socketId;
		console.log(`Client ${identifier} uploaded state to room ${this.roomId}`);
	}

	/**
	 * Get room client count
	 */
	public getClientCount(): number {
		return this.clients.size;
	}

	/**
	 * Check if room is empty
	 */
	public isEmpty(): boolean {
		return this.clients.size === 0;
	}

	/**
	 * Generate a new user ID for a client joining the room
	 */
	private generateUserId(): string {
		return `u${this.nextUserNumber++}`;
	}

	/**
	 * Broadcast message to all clients in room
	 */
	public broadcast(message: ServerMessage, excludeSocketId?: string): void {
		for (const [socketId, client] of this.clients) {
			if (socketId !== excludeSocketId) {
				client.sendMessage(message);
			}
		}
	}

	/**
	 * Clean up room resources
	 */
	public dispose(): void {
		this.clearSnapshotTimer();
		this.clearHeartbeatTimer();
		this.commandBuffer.dispose();

		// Disconnect all clients
		for (const client of this.clients.values()) {
			client.disconnect();
		}
		this.clients.clear();
	}

	/**
	 * Handle flushed commands from buffer
	 */
	private handleCommandFlush(commands: Command[]): void {
		if (commands.length === 0) {
			return;
		}

		const message: CommandBatchMessage = {
			type: "command_batch",
			commands,
		};

		this.broadcast(message);

		// Save commands to audit log (optional)
		// this.saveCommandsToAuditLog(commands);
	}

	/**
	 * Broadcast heartbeat response to all clients
	 */
	private broadcastHeartbeatResponse(): void {
		const clients: ClientPresence[] = Array.from(this.clients.values()).map(
			(client) => ({
				userId: client.userId,
				cursor: client.cursor,
			}),
		);

		const message: HeartbeatResponseMessage = {
			type: "heartbeat_response",
			clients,
			highestIdCounter: this.roomState.getIdCounter(),
		};

		this.broadcast(message);
	}

	/**
	 * Save room state snapshot to database
	 */
	private saveSnapshot(): void {
		const { data: stateData, hasChanged } = this.roomState.consumeStateChanges();

		// Skip saving if state hasn't changed or is null
		if (!hasChanged || !stateData) {
			return;
		}

		try {
			const compressed = this.compression.compressJSON(stateData);
			const snapshot: RoomSnapshot = {
				roomId: this.roomId,
				stateData: compressed,
				timestamp: Date.now(),
				clientCount: this.clients.size,
			};

			this.database.saveSnapshot(snapshot);
		} catch (error) {
			ErrorHandler.handle(error, {
				source: "Room.saveSnapshot",
				roomId: this.roomId,
			});
		}
	}

	/**
	 * Load room state from database
	 */
	private loadSnapshot(): void {
		try {
			const snapshot = this.database.loadSnapshot(this.roomId);
			if (snapshot) {
				const decompressedState = this.compression.decompressJSON(
					snapshot.stateData,
				);
				this.roomState.setState(decompressedState as AppStateJson);
				console.log(
					`Loaded snapshot for room ${this.roomId} from ${new Date(
						snapshot.timestamp,
					)}`,
				);
			}
		} catch (error) {
			ErrorHandler.handle(error, {
				source: "Room.loadSnapshot",
				roomId: this.roomId,
			});
		}
	}

	/**
	 * Start periodic snapshot timer
	 */
	private startSnapshotTimer(): void {
		this.snapshotTimer = Scheduler.safeInterval(
			`snapshot-${this.roomId}`,
			() => this.saveSnapshot(),
			this.config.snapshotIntervalMs,
		);

		// Load existing snapshot on startup
		this.loadSnapshot();
	}

	/**
	 * Clear snapshot timer
	 */
	private clearSnapshotTimer(): void {
		if (this.snapshotTimer !== null) {
			clearInterval(this.snapshotTimer);
			this.snapshotTimer = null;
		}
	}

	/**
	 * Start periodic heartbeat broadcast timer
	 */
	private startHeartbeatTimer(): void {
		this.heartbeatTimer = Scheduler.safeInterval(
			`heartbeat-${this.roomId}`,
			() => this.broadcastHeartbeatResponse(),
			this.config.heartbeatIntervalMs,
		);
	}

	/**
	 * Clear heartbeat timer
	 */
	private clearHeartbeatTimer(): void {
		if (this.heartbeatTimer !== null) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}
}
