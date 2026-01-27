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
} from "../shared/messages.ts";
import { ErrorCode } from "../shared/messages.ts";
import { AppError } from "./errors/AppError.ts";
import { ErrorHandler } from "./errors/ErrorHandler.ts";
import { Scheduler } from "./utils/Scheduler.ts";
import type { IRoomState } from "./RoomState.ts";
import { RoomState } from "./RoomState.ts";
import type { ICollaborationClient } from "./CollaborationClient.ts";
import {
	CommandBuffer,
	type CommandBufferConfig,
	type ICommandBuffer,
} from "./CommandBuffer.ts";
import type { IDatabaseManager, RoomSnapshot } from "./persistence.ts";
import { AppStateJson } from "../shared/types_serialization.ts";
import { ICompressionService } from "../shared/CompressionService.ts";

export interface RoomConfig {
	maxClients: number; // 10 default
	snapshotIntervalMs: number; // 30000ms default
	heartbeatIntervalMs: number; // 1000ms default
	heartbeatFastDelayMs: number; // 50ms default - delay before broadcasting after receiving a heartbeat
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
	private clients = new Map<string, ICollaborationClient>(); // Keyed by socketId
	private nextUserNumber = 1;
	private snapshotTimer: number | null = null;
	private heartbeatTimer: number | null = null;
	private nextHeartbeatTime: number = 0;
	private roomState: IRoomState;
	private commandBuffer: ICommandBuffer;
	private loadingSnapshot: Promise<void> | null = null;

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
		this.scheduleHeartbeat(this.config.heartbeatIntervalMs);
	}

	/**
	 * Add client to room
	 */
	public async addClient(
		client: ICollaborationClient,
		intent: JoinRoomIntent,
	): Promise<RoomJoinedMessage> {
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
		await this.loadingSnapshot;

		// Check if download is requested but state is not initialized
		if (intent === "download" && !this.canDownload()) {
			throw new AppError(
				ErrorCode.STATE_NOT_INITIALIZED,
				{ roomId: this.roomId, intent },
				undefined,
				true,
			);
		}
		if (intent === "upload" && !this.canUpload()) {
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

		let stateData: AppStateJson | undefined;

		if (intent === "download") {
			// Client wants to download existing room state
			const rawState = this.roomState.getState();
			stateData = rawState;
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
	public handleHeartbeat(client: ICollaborationClient): void {
		// Forward ID counter to room state for tracking
		this.roomState.updateIdCounter(client.localIdCounter);
		
		// Schedule a fast heartbeat if it would be sooner than the next scheduled one
		this.scheduleHeartbeatIfSooner(this.config.heartbeatFastDelayMs);
	}

	/**
	 * Set room state (from upload)
	 */
	public setRoomState(socketId: string, stateData: AppStateJson): void {
		this.roomState.setState(stateData);
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
	 * Get allowed join intents for this room
	 */
	public getAllowedIntents(): JoinRoomIntent[] {
		const intents: JoinRoomIntent[] = [];
		if (this.canDownload()) {
			intents.push("download");
		}
		if (this.canUpload()) {
			intents.push("upload");
		}
		return intents;
	}

	/**
	 * Check if download is allowed
	 */
	private canDownload(): boolean {
		return this.roomState.canGetState();
	}

	/**
	 * Check if upload is allowed
	 */
	private canUpload(): boolean {
		// Upload is allowed if state is not initialized OR no clients are connected
		return !this.roomState.isStateInitialized() || this.clients.size === 0;
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

		// Broadcast heartbeat immediately after commands and reschedule for full interval
		this.broadcastHeartbeatAndReschedule();
	}

	/**
	 * Broadcast heartbeat response to all clients
	 */
	private broadcastHeartbeatResponse(): void {
		const clients: ClientPresence[] = Array.from(this.clients.values()).map(
			(client) => ({
				userId: client.userId,
				cursor: client.cursor,
				currentPageId: client.currentPageId,
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
	private async saveSnapshot(): Promise<void> {
		const { data: stateData, hasChanged } = this.roomState.consumeStateChanges();

		// Skip saving if state hasn't changed or is null
		if (!hasChanged || !stateData) {
			return;
		}

		try {
			const compressed = await this.compression.compressJSON(stateData);
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
	private async loadSnapshot(): Promise<void> {
		try {
			const snapshot = this.database.loadSnapshot(this.roomId);
			if (snapshot) {
				const decompressedState = await this.compression.decompressJSON(
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
		this.loadingSnapshot = this.loadSnapshot();
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
	 * Schedule a heartbeat broadcast only if it would be sooner than the current schedule.
	 * This is used for fast heartbeats triggered by client activity.
	 */
	private scheduleHeartbeatIfSooner(delayMs: number): void {
		const targetTime = Date.now() + delayMs;
		if (this.heartbeatTimer !== null && targetTime >= this.nextHeartbeatTime) {
			return; // Already scheduled for sooner or same time
		}
		this.scheduleHeartbeat(delayMs);
	}

	/**
	 * Schedule a heartbeat broadcast after the specified delay.
	 * Clears any existing scheduled heartbeat.
	 */
	private scheduleHeartbeat(delayMs: number): void {
		this.clearHeartbeatTimer();
		this.nextHeartbeatTime = Date.now() + delayMs;
		this.heartbeatTimer = Scheduler.safeTimeout(
			`heartbeat-${this.roomId}`,
			() => this.broadcastHeartbeatAndReschedule(),
			delayMs,
		);
	}

	/**
	 * Broadcast heartbeat response and schedule the next one for the full interval.
	 */
	private broadcastHeartbeatAndReschedule(): void {
		this.clearHeartbeatTimer();
		this.broadcastHeartbeatResponse();
		this.scheduleHeartbeat(this.config.heartbeatIntervalMs);
	}

	/**
	 * Clear heartbeat timer
	 */
	private clearHeartbeatTimer(): void {
		if (this.heartbeatTimer !== null) {
			clearTimeout(this.heartbeatTimer);
			this.heartbeatTimer = null;
			this.nextHeartbeatTime = 0;
		}
	}
}
