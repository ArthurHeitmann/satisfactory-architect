/**
 * Client connection state and messaging interface
 */

import type {
	CursorPosition,
	HeartbeatMessage,
	ServerMessage,
} from "../../shared/types_shared.ts";
import type { ClientInfo, WebSocketAdapter } from "./types_server.ts";
import { Scheduler } from "./utils/Scheduler.ts";

export interface ClientConfig {
	heartbeatTimeoutMs: number; // 5000ms default
	maxMissedHeartbeats: number; // 3 default
}

/**
 * Represents a connected collaboration client
 */
export class CollaborationClient {
	private heartbeatTimer: number | null = null;
	private missedHeartbeats = 0;

	// Client state
	public cursor: CursorPosition = { x: 0, y: 0 };
	public lastHeartbeat = Date.now();
	public localIdCounter = "0"; // String to match UI's IdGen format

	// User ID assigned by room (set when joining a room)
	private _userId: string | null = null;

	constructor(
		public readonly socketId: string, // Server-internal socket identifier
		public readonly serverProtocolVersion: number,
		private socket: WebSocketAdapter,
		private config: ClientConfig,
		private onDisconnect: (client: CollaborationClient) => void,
	) {
		this.startHeartbeatTimeout();
	}

	/**
	 * Get the user ID assigned by the room
	 * @throws Error if user ID has not been assigned yet
	 */
	public get userId(): string {
		if (this._userId === null) {
			throw new Error("User ID has not been assigned yet");
		}
		return this._userId;
	}

	/**
	 * Check if this client has been assigned a user ID
	 */
	public hasUserId(): boolean {
		return this._userId !== null;
	}

	/**
	 * Assign a user ID to this client (called when joining a room)
	 */
	public assignUserId(userId: string): void {
		this._userId = userId;
	}

	/**
	 * Update client state from heartbeat
	 */
	public updateFromHeartbeat(message: HeartbeatMessage): void {
		this.cursor = message.cursor;
		this.localIdCounter = message.localIdCounter;
		this.lastHeartbeat = Date.now();
		this.missedHeartbeats = 0;
		this.resetHeartbeatTimeout();
	}

	/**
	 * Send message to this client
	 */
	public sendMessage(message: ServerMessage): void {
		this.socket.sendMessage(message);
	}

	/**
	 * Get client info for sharing with other clients
	 */
	public getClientInfo(): ClientInfo {
		return {
			userId: this.userId,
			cursor: this.cursor,
			lastHeartbeat: this.lastHeartbeat,
			serverProtocolVersion: this.serverProtocolVersion,
		};
	}

	/**
	 * Gracefully disconnect client
	 */
	public disconnect(): void {
		this.clearHeartbeatTimer();
		this.socket.close();
		this.onDisconnect(this);
	}

	/**
	 * Handle missed heartbeat
	 */
	private onHeartbeatTimeout(): void {
		this.missedHeartbeats++;

		if (this.missedHeartbeats >= this.config.maxMissedHeartbeats) {
			const identifier = this._userId ?? this.socketId;
			console.log(
				`Client ${identifier} timed out after ${this.missedHeartbeats} missed heartbeats`,
			);
			this.disconnect();
		} else {
			// Wait for next heartbeat
			this.startHeartbeatTimeout();
		}
	}

	/**
	 * Start heartbeat timeout timer
	 */
	private startHeartbeatTimeout(): void {
		this.heartbeatTimer = Scheduler.safeTimeout(
			`heartbeat-timeout-${this.socketId}`,
			() => this.onHeartbeatTimeout(),
			this.config.heartbeatTimeoutMs,
		);
	}

	/**
	 * Reset heartbeat timeout timer
	 */
	private resetHeartbeatTimeout(): void {
		this.clearHeartbeatTimer();
		this.startHeartbeatTimeout();
	}

	/**
	 * Clear heartbeat timeout timer
	 */
	private clearHeartbeatTimer(): void {
		if (this.heartbeatTimer !== null) {
			clearTimeout(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}
}
