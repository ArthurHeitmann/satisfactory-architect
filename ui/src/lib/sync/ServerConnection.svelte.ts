import { browser } from "$app/environment";
import type { AppState } from "$lib/datamodel/AppState.svelte";
import { globals } from "$lib/datamodel/globals.svelte";
import type { Id, IdGen } from "$lib/datamodel/IdGen.svelte.js";
import { watchState } from "$lib/utilities.svelte";
import { assertUnreachable, Throttler } from "$lib/utilties";
import { tick } from "svelte";
import { type ClientMessage, type RoomListItem, type ServerMessage, type WelcomeMessage, type UploadConfirmationMessage, type RoomJoinedMessage, type CommandBatchMessage, type HeartbeatResponseMessage, type ErrorMessage, type CursorPosition, type ClientPresence, type Command, ErrorCode } from "../../../../server/shared/messages";
import { WebSocketMessageMiddleware } from "../../../../server/shared/WebSocketMessageMiddleware";
import { CommandProcessor } from "./CommandProcessor";
import { DispatchCommandQueue } from "./DispatchCommandQueue";
import { StateMachine } from "./StateMachine.svelte.js";
import { CompressionService } from "../../../../server/shared/CompressionService";
import { ZstdCompressionProvider } from "./ZstdCompressionProvider";
import type { AppStateJson } from "../../../../server/shared/types_serialization";

export enum ServerConnectionState {
	Disconnected = "Disconnected",
	Connecting = "Connecting",
	Connected = "Connected",
	JoiningRoom = "JoiningRoom",
	UploadingState = "UploadingState",
	InRoom = "InRoom",
}

const serverProtocolVersion = 1;

export class ServerConnection {
	private stateMachine = new StateMachine<ServerConnectionState>({
		initialState: ServerConnectionState.Disconnected,
		transitions: {
			[ServerConnectionState.Disconnected]: [ServerConnectionState.Connecting],
			[ServerConnectionState.Connecting]: [ServerConnectionState.Connected, ServerConnectionState.Disconnected],
			[ServerConnectionState.Connected]: [ServerConnectionState.JoiningRoom, ServerConnectionState.Disconnected],
			[ServerConnectionState.JoiningRoom]: [ServerConnectionState.InRoom, ServerConnectionState.UploadingState, ServerConnectionState.Connected, ServerConnectionState.Disconnected],
			[ServerConnectionState.UploadingState]: [ServerConnectionState.InRoom, ServerConnectionState.Disconnected],
			[ServerConnectionState.InRoom]: [ServerConnectionState.Disconnected],
		},
	});
	get state() { return this.stateMachine.currentState; }

	private _serverUrl: string = $state("");
	public get serverUrl() { return this._serverUrl; }
	private _availableRooms: RoomListItem[] = $state([]);
	public get availableRooms() { return this._availableRooms; }
	private _roomId: string | null = $state(null);
	public get roomId() { return this._roomId; }
	private _lastRoomId: string | null = null;
	public get lastRoomId() { return this._lastRoomId; }
	private _ownUserId: string | null = null;
	public get ownUserId() { return this._ownUserId; }
	private _lastError: string | null = $state(null);
	public get lastError() { return this._lastError; }
	private _otherClients: ClientPresence[] = $state([]);
	public get otherClients() { return this._otherClients; }

	private ws: WebSocket | null = null;
	private wsCompressionMiddleware: WebSocketMessageMiddleware;
	private taskTimeout: number | null = null;
	private isExpectedDisconnect: boolean = false;
	private uploadStateData: AppStateJson | null = null;
	private pendingReconnectRoomId: string | null = null;

	private idGen: IdGen;
	readonly dispatchCommandQueue: DispatchCommandQueue;
	private commandProcessor: CommandProcessor;
	private isUpdatingState: boolean = false;

	private heartbeatInterval: number | null = null;
	private lastReceivedHeartbeat: number = Date.now();
	private fastHeartbeatThrottled = new Throttler(() => this.sendHeartbeat(), 100);
	private heartbeatWatchInitialized = false;
	private keepAliveInterval: number | null = null;

	onUnexpectedDisconnect: ((error: string | null) => void) | null = null;
	onUserMessage: ((message: string) => void) | null = null;

	constructor(
		appState: AppState,
		private getCurrentPageId: () => string | null,
		private onStateDownloaded: (state: any) => void,
	) {
		this.idGen = appState.idGen;

		const compressionService = new CompressionService();
		compressionService.registerProvider(new ZstdCompressionProvider());
		this.wsCompressionMiddleware = new WebSocketMessageMiddleware(compressionService);

		this.dispatchCommandQueue = new DispatchCommandQueue(
			this.sendCommands.bind(this),
			() => this.stateMachine.currentState === ServerConnectionState.InRoom,
			() => this._ownUserId!,
			() => this.isUpdatingState,
		);
		this.commandProcessor = new CommandProcessor(
			appState,
			() => this._ownUserId!,
		);

		if (browser && !location.origin.includes("localhost:")) {
			this._serverUrl = location.origin.replace(/^http/, "ws") + "/ws";
		}

	}

	watchHeartbeatDataChanges(): void {
		if (this.heartbeatWatchInitialized) {
			return;
		}
		this.heartbeatWatchInitialized = true;
		watchState({
			dependencies: () => [
				this.idGen.getCurrentId(),
				globals.pageMousePosition?.x,
				globals.pageMousePosition?.y,
				this.getCurrentPageId(),
			],
			guard: () => this.stateMachine.currentState === ServerConnectionState.InRoom,
			onChange: () => this.onHeartbeatDataChanged(),
		});
	}

	setServerUrl(url: string): void {
		if (this._serverUrl === url && this.state !== ServerConnectionState.Disconnected) {
			return;
		}
		this.disconnect();
		this._serverUrl = url;
		this.connect();
	}

	connect() {
		this.stateMachine.transitionTo(ServerConnectionState.Connecting);
		this._lastError = null;
		this.isExpectedDisconnect = false;

		this.wsCompressionMiddleware.reset();
		this.ws = new WebSocket(this._serverUrl);
		this.ws.binaryType = "arraybuffer";
		this.ws.onopen = () => this.ws?.send(this.wsCompressionMiddleware.sendInit());
		this.ws.onmessage = (event) => this.onWsMessage(event);
		this.ws.onclose = () => this.disconnect();
		this.ws.onerror = (e) => {
			console.error("WebSocket error:", e);
			this.disconnect();
		};

		this.startTaskTimeout(2500);
	}

	/**
	 * Disconnect from the server intentionally.
	 * This marks the disconnect as expected, so no reconnection prompt will be shown.
	 */
	intentionalDisconnect() {
		this.isExpectedDisconnect = true;
		this.disconnect();
	}

	disconnect() {
		// Track if this was an unexpected disconnect (was in room)
		const wasInRoom = this.stateMachine.currentState === ServerConnectionState.InRoom;
		
		// Save room ID before clearing for potential reconnection
		if (this._roomId) {
			this._lastRoomId = this._roomId;
		}
		
		this.stateMachine.transitionTo(ServerConnectionState.Disconnected);
		if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
			this.ws.onclose = null;
			this.ws.close();
		}
		this.ws = null;
		this._ownUserId = null;
		this._roomId = null;
		this._otherClients = [];
		this.idGen.removePrefix();
		this.clearTaskTimeout();
		this.clearHeartbeat();
		
		// Notify about unexpected disconnect if we were in room and it wasn't intentional
		if (wasInRoom && !this.isExpectedDisconnect && this._lastRoomId) {
			this.onUnexpectedDisconnect?.(this._lastError);
		}
	}

	/**
	 * Attempt to reconnect to the last room with download intent.
	 * Returns true if reconnection was initiated, false if not possible.
	 */
	reconnect(): boolean {
		if (!this._lastRoomId || !this._serverUrl) {
			return false;
		}
		this.connect();
		// We'll join the room after connection is established
		this.pendingReconnectRoomId = this._lastRoomId;
		return true;
	}

	async joinRoom(roomId: string, uploadData?: AppStateJson): Promise<void> {
		this.stateMachine.transitionTo(ServerConnectionState.JoiningRoom);
		this.uploadStateData = uploadData ?? null;
		await this.sendMessage({
			type: "join_room",
			roomId,
			intent: uploadData ? "upload" : "download",
			serverProtocolVersion,
		});
		this.startTaskTimeout(5000);
	}

	async createRoom(uploadData?: AppStateJson): Promise<void> {
		this.stateMachine.transitionTo(ServerConnectionState.JoiningRoom);
		this.uploadStateData = uploadData ?? null;
		await this.sendMessage({
			type: "create_room",
			serverProtocolVersion,
		});
		this.startTaskTimeout(5000);
	}

	private async onWsMessage(event: MessageEvent): Promise<void> {
		let message: ServerMessage | null = null;
		try {
			message = await this.wsCompressionMiddleware.processIncomingMessage(event.data) as ServerMessage | null;
		} catch (e) {
			console.error("Failed to parse server message:", event.data);
			console.error(e);
			return;
		}
		if (message === null) {
			return;
		}
		if (!("type" in message)) {
			console.warn("Invalid server message format:", message);
			return;
		}
		switch (message.type) {
			case "welcome":
				this.handleWelcomeMessage(message);
				break;
			case "room_joined":
				this.handleRoomJoinedMessage(message);
				break;
			case "upload_confirmation":
				this.handleUploadConfirmationMessage(message);
				break;
			case "command_batch":
				this.handleCommandBatchMessage(message);
				break;
			case "heartbeat_response":
				this.handleHeartbeatResponseMessage(message);
				break;
			case "user_message":
				this.onUserMessage?.(message.message);
				break;	
			case "room_info":
				// TODO
				break;
			case "keep_alive":
				// Placeholder: server-to-client keep_alive (no action needed)
				break;
			case "error":
				this.handleErrorMessage(message);
				break;
			default:
				console.warn("Unknown server message type:", message);
				assertUnreachable(message);
		}
	}

	async sendMessage(message: ClientMessage): Promise<void> {
		const preparedMessage = await this.wsCompressionMiddleware.prepareOutgoingMessage(message);
		this.ws?.send(preparedMessage);
	}

	private handleWelcomeMessage(message: WelcomeMessage): void {
		if (message.serverProtocolVersion !== serverProtocolVersion) {
			console.error(`Incompatible server protocol version: ${message.serverProtocolVersion} (expected ${serverProtocolVersion})`);
			this._lastError = `Incompatible server protocol version: ${message.serverProtocolVersion} (expected ${serverProtocolVersion})`;
			this.disconnect();
			return;
		}
		this.stateMachine.transitionTo(ServerConnectionState.Connected);
		this._availableRooms = message.availableRooms ?? [];
		this.clearTaskTimeout();
		
		// Auto-join room if we're reconnecting
		if (this.pendingReconnectRoomId) {
			const roomId = this.pendingReconnectRoomId;
			this.pendingReconnectRoomId = null;
			this.joinRoom(roomId); // Download intent (no upload data)
		}
	}

	private async handleRoomJoinedMessage(message: RoomJoinedMessage): Promise<void> {
		this.clearTaskTimeout();
		this._ownUserId = message.userId;
		this._roomId = message.roomId;
		if (this.uploadStateData !== null) {
			this.stateMachine.transitionTo(ServerConnectionState.UploadingState);
			await this.sendMessage({
				type: "upload_state",
				stateData: this.uploadStateData,
			});
			this.uploadStateData = null;
			this.startTaskTimeout(5000);
		}
		else {
			this.stateMachine.transitionTo(ServerConnectionState.InRoom);
			this.onRoomJoined();
			if (message.stateData) {
				const state = message.stateData;
				this.onStateDownloaded(state);
			}
		}
	}

	private handleUploadConfirmationMessage(message: UploadConfirmationMessage): void {
		this.stateMachine.transitionTo(ServerConnectionState.InRoom);
		this.onRoomJoined();
	}

	private onRoomJoined(): void {
		this.clearTaskTimeout();
		this.startHeartbeat();
		this.idGen.setPrefix(this._ownUserId!);
	}

	private handleCommandBatchMessage(message: CommandBatchMessage): void {
		if (this.state !== ServerConnectionState.InRoom) {
			console.warn("Received command batch while not in room, ignoring.");
			return;
		}
		this.isUpdatingState = true;
		try {
			this.commandProcessor.applyCommands(message.commands);
		} catch (error) {
			console.error("Error applying command batch:", error);
			this._lastError = "Error applying command";
			this.disconnect();
		}
		tick().then(() => {
			this.isUpdatingState = false;
		});
	}

	private handleHeartbeatResponseMessage(message: HeartbeatResponseMessage): void {
		this.lastReceivedHeartbeat = Date.now();
		this._otherClients = message.clients;
		this.idGen.replaceFromJsonIfHigher(message.highestIdCounter);
	}

	/**
	 * Check if a user is currently connected to the room.
	 * Returns true for own user or any user in otherClients.
	 */
	isUserConnected(userId: string): boolean {
		if (this._ownUserId === userId) {
			return true;
		}
		return this._otherClients.some(client => client.userId === userId);
	}

	private handleErrorMessage(message: ErrorMessage): void {
		console.error("Server error:", message);
		this._lastError = message.message;
		if (this.state === ServerConnectionState.JoiningRoom && message.code === ErrorCode.ROOM_NOT_FOUND) {
			this.stateMachine.transitionTo(ServerConnectionState.Connected);
			this.clearTaskTimeout();
			return;
		}
		this.disconnect();
	}

	private startTaskTimeout(duration: number = 5000): void {
		if (this.taskTimeout !== null) {
			window.clearTimeout(this.taskTimeout);
		}
		this.taskTimeout = window.setTimeout(() => {
			this.disconnect();
		}, duration);
	}

	private clearTaskTimeout(): void {
		if (this.taskTimeout !== null) {
			window.clearTimeout(this.taskTimeout);
			this.taskTimeout = null;
		}
	}

	onHeartbeatDataChanged(): void {
		this.fastHeartbeatThrottled.call();
	}

	private startHeartbeat(): void {
		this.clearHeartbeat();
		this.heartbeatInterval = window.setInterval(() => this.sendHeartbeat(), 1000);
		this.lastReceivedHeartbeat = Date.now();
	}

	private async sendHeartbeat(): Promise<void> {
		if (this.stateMachine.currentState !== ServerConnectionState.InRoom) {
			return;
		}
		const now = Date.now();
		if (now - this.lastReceivedHeartbeat > 5000) {
			console.warn("No heartbeat response received in 5 seconds, disconnecting...");
			this._lastError = "Connection lost: no heartbeat response";
			this.disconnect();
			return;
		}
		const pageMousePosition = globals.pageMousePosition;
		await this.sendMessage({
			type: "heartbeat",
			cursor: pageMousePosition ?? { x: 0, y: 0 },
			currentPageId: this.getCurrentPageId(),
			localIdCounter: this.idGen.getCurrentId(),
		});
	}

	private clearHeartbeat(): void {
		if (this.heartbeatInterval !== null) {
			window.clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
	}

	/**
	 * Start sending keep_alive messages to prevent idle socket closure.
	 * Only sends while in the Connected state.
	 * Should be called when the connection overlay is opened.
	 */
	startKeepAlive(): void {
		this.stopKeepAlive();
		this.keepAliveInterval = window.setInterval(() => {
			if (this.stateMachine.currentState === ServerConnectionState.Connected) {
				void this.sendMessage({ type: "keep_alive" });
			}
		}, 1500);
	}

	/**
	 * Stop sending keep_alive messages.
	 * Should be called when the connection overlay is closed.
	 */
	stopKeepAlive(): void {
		if (this.keepAliveInterval !== null) {
			window.clearInterval(this.keepAliveInterval);
			this.keepAliveInterval = null;
		}
	}

	private async sendCommands(commands: Command[]): Promise<void> {
		await this.sendMessage({
			type: "command_batch",
			commands,
		});
	}
}
