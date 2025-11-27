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
} from "./types_shared.ts";
import { ErrorCode } from "./types_shared.ts";
import { AppError } from "./errors/AppError.ts";
import { ErrorHandler } from "./errors/ErrorHandler.ts";
import { Scheduler } from "./utils/Scheduler.ts";
import type { IRoomState } from "./RoomState.ts";
import { RoomState } from "./RoomState.ts";
import type { CollaborationClient } from "./CollaborationClient.ts";
import { CommandBuffer, type CommandBufferConfig } from "./CommandBuffer.ts";
import type { CompressionService } from "./compression.ts";
import type { DatabaseManager, RoomSnapshot } from "./persistence.ts";

export interface RoomConfig {
	maxClients: number; // 10 default
	snapshotIntervalMs: number; // 30000ms default
	heartbeatIntervalMs: number; // 1000ms default
	commandBuffer: CommandBufferConfig;
}

/**
 * Manages a collaboration room and its connected clients
 */
export class CollaborationRoom {
	private clients = new Map<string, CollaborationClient>();
	private nextClientNumber = 1;
	private snapshotTimer: number | null = null;
	private heartbeatTimer: number | null = null;
	private roomState: IRoomState;
	private commandBuffer: CommandBuffer;

	constructor(
		public readonly roomId: string,
		private config: RoomConfig,
		private compression: CompressionService,
		private database: DatabaseManager,
		roomState?: IRoomState,
	) {
		// Create room state manager with default implementation
		this.roomState = roomState ?? new RoomState(roomId);

		// Create command buffer internally
		this.commandBuffer = new CommandBuffer(
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

		this.clients.set(client.clientId, client);

		let stateData: unknown | undefined;

		if (intent === "download") {
			// Client wants to download existing room state
			stateData = this.roomState.getState();
		}

		console.log(
			`Client ${client.clientId} joined room ${this.roomId} with intent '${intent}' (${this.clients.size}/${this.config.maxClients})`,
		);

		return {
			type: "room_joined",
			roomId: this.roomId,
			clientId: client.clientId,
			stateData,
		};
	}

	/**
	 * Remove client from room
	 */
	public removeClient(clientId: string): void {
		const client = this.clients.get(clientId);
		if (client) {
			this.clients.delete(clientId);
			console.log(
				`Client ${clientId} left room ${this.roomId} (${this.clients.size}/${this.config.maxClients})`,
			);
		}
	}

	/**
	 * Process command batch from client
	 */
	public handleCommandBatch(clientId: string, commands: Command[]): void {
		// Validate client is in room
		if (!this.clients.has(clientId)) {
			return;
		}

		// Apply commands to room state (will throw if state not initialized)
		try {
			this.roomState.applyCommands(commands);
		} catch (error) {
			ErrorHandler.handle(error, {
				source: "Room.handleCommandBatch",
				roomId: this.roomId,
				clientId,
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
	public setRoomState(clientId: string, stateData: unknown): void {
		this.roomState.setState(stateData);
		this.saveSnapshot();
		console.log(`Client ${clientId} uploaded state to room ${this.roomId}`);
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
	 * Get next client ID for new connections
	 */
	public getNextClientId(): string {
		return `u${this.nextClientNumber++}`;
	}

	/**
	 * Broadcast message to all clients in room
	 */
	public broadcast(message: ServerMessage, excludeClientId?: string): void {
		for (const [clientId, client] of this.clients) {
			if (clientId !== excludeClientId) {
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
				clientId: client.clientId,
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
				this.roomState.setState(decompressedState);
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
