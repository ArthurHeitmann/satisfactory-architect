/**
 * Deno WebSocket server entry point for collaboration server
 */

import type { ClientMessage, ServerMessage } from "../shared/messages.ts";
import type { ServerConfig, WebSocketAdapter } from "./types_server.ts";
import { WebSocketReadyState } from "./types_server.ts";
import { CollaborationServer } from "./CollaborationServer.ts";
import { ZstdCompressionProvider } from "./ZstdCompressionProvider.ts";
import { WebSocketMessageMiddleware } from "../shared/WebSocketMessageMiddleware.ts";
import { DatabaseManager } from "./persistence.ts";
import { loadEnvironmentConfig } from "./EnvironmentConfig.ts";
import { SqliteDatabaseAdapter } from "./SqliteDatabaseAdapter.ts";
import { ErrorHandler } from "./errors/ErrorHandler.ts";
import { generateSecureId } from "./utils.ts";
import { CompressionService, ICompressionService } from "../shared/CompressionService.ts";

// Deno WebSocket adapter
class DenoWebSocketAdapter implements WebSocketAdapter {
	public readonly middleware: WebSocketMessageMiddleware;
	private sendQueue: Promise<void> = Promise.resolve();

	constructor(
		private ws: WebSocket,
		compression: ICompressionService,
		public readonly socketId: string = generateSecureId(16),
	) {
		this.middleware = new WebSocketMessageMiddleware(compression);
	}

	sendMessage(message: ServerMessage): void {
		if (this.ws.readyState !== WebSocketReadyState.OPEN) {
			return;
		}

		// Use a promise chain to strictly preserve message ordering during async compression
		this.sendQueue = this.sendQueue.then(async () => {
			try {
				const prepared = await this.middleware.prepareOutgoingMessage(message);
				this.ws.send(prepared);
			} catch (error) {
				ErrorHandler.handle(error, {
					source: "DenoWebSocketAdapter.sendMessage",
					socketId: this.socketId,
				});
			}
		});
	}

	close(): void {
		this.ws.close();
	}

	get readyState(): WebSocketReadyState {
		return this.ws.readyState as WebSocketReadyState;
	}
}

/**
 * Start WebSocket server
 */
function startServer() {
	const envConfig = loadEnvironmentConfig();

	const config: ServerConfig = {
		port: envConfig.port,
		serverProtocolVersion: 1,
		serverBufferMs: envConfig.serverBufferMs,
		heartbeatIntervalMs: envConfig.heartbeatIntervalMs,
		heartbeatFastDelayMs: envConfig.heartbeatFastDelayMs,
		snapshotIntervalMs: envConfig.snapshotIntervalMs,
		maxRoomsPerServer: envConfig.maxRoomsPerServer,
		maxClientsPerRoom: envConfig.maxClientsPerRoom,
		maxCommandBatchSize: envConfig.maxCommandBatchSize,
	};

	const compression = new CompressionService(envConfig.compressionThreshold);
	compression.registerProvider(new ZstdCompressionProvider());
	compression.setDefaultMethod("zstd");

	const dbAdapter = new SqliteDatabaseAdapter(envConfig.databasePath);
	const database = new DatabaseManager(dbAdapter);
	const server = new CollaborationServer(config, compression, database);

	console.log(`🚀 Collaboration server starting on port ${envConfig.port}`);

	const handler = (request: Request): Response => {
		if (request.headers.get("upgrade") === "websocket") {
			const { socket, response } = Deno.upgradeWebSocket(request);
			const adapter = new DenoWebSocketAdapter(socket, compression);

			socket.onopen = () => {
				console.log("Client connected");
				try {
					socket.send(adapter.middleware.sendInit());
					server.handleConnection(adapter);
				} catch (error) {
					ErrorHandler.handle(error, { source: "WebSocket.onopen" });
				}
			};

			socket.onmessage = async (event) => {
				try {
					const msg = await adapter.middleware.processIncomingMessage(event.data);
					if (msg) {
						await server.handleMessage(adapter, msg as ClientMessage);
					}
				} catch (error) {
					ErrorHandler.handle(error, {
						source: "WebSocket.onmessage",
						socketId: adapter.socketId,
					});
				}
			};

			socket.onclose = async () => {
				console.log("Client disconnected");
				try {
					await server.handleDisconnection(adapter);
				} catch (error) {
					ErrorHandler.handle(error, {
						source: "WebSocket.onclose",
						socketId: adapter.socketId,
					});
				}
			};

			socket.onerror = (event) => {
				const errorMessage = event instanceof ErrorEvent ? event.message : event.type;
				// "Unexpected EOF" is a normal occurrence when a client disconnects abruptly — suppress it
				if (errorMessage === "Unexpected EOF") {
					return;
				}
				const errorDetail = event instanceof ErrorEvent
					? { message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno, error: event.error }
					: { type: event.type };
				console.error("WebSocket error event:", errorDetail);
				ErrorHandler.handle(
					event instanceof ErrorEvent && event.error instanceof Error
						? event.error
						: new Error(`WebSocket error: ${errorMessage}`),
					{
						source: "WebSocket.onerror",
						socketId: adapter.socketId,
						readyState: socket.readyState,
					},
				);
			};

			return response;
		}

		// Handle regular HTTP requests
		return new Response(
			"Satisfactory Architect Collaboration Server",
			{
				status: 200,
				headers: { "content-type": "text/plain" },
			},
		);
	};

	// Start server
	Deno.serve({
		port: envConfig.port,
		onListen: ({ port, hostname }) => {
			console.log(`✅ WebSocket Server is running at ws://${hostname ?? "localhost"}:${port}`);
		},
	}, handler);

	// Graceful shutdown
	Deno.addSignalListener("SIGINT", async () => {
		console.log("🛑 Shutdown initiated, notifying clients...");
		server.broadcastAll({
			type: "user_message",
			message: "Server is restarting...",
		});

		// Wait 1 second for clients to receive the message
		await new Promise((resolve) => setTimeout(resolve, 1000));

		await server.dispose();
		Deno.exit(0);
	});
}

// Start server if this is the main module
if (import.meta.main) {
	await startServer();
}
