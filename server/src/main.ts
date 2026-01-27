/**
 * Deno WebSocket server entry point for collaboration server
 */

import type { ClientMessage, ServerMessage } from "../shared/types_shared.ts";
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
		serverProtocolVersion: envConfig.serverProtocolVersion,
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
	const server = new CollaborationServer(config, compression, database)

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
						server.handleMessage(adapter, msg as ClientMessage); 
					}
				} catch (error) {
					ErrorHandler.handle(error, {
						source: "WebSocket.onmessage",
						socketId: adapter.socketId,
					});
				}
			};

			socket.onclose = () => {
				console.log("Client disconnected");
				try {
					server.handleDisconnection(adapter);
				} catch (error) {
					ErrorHandler.handle(error, {
						source: "WebSocket.onclose",
						socketId: adapter.socketId,
					});
				}
			};

			socket.onerror = (error) => {
				ErrorHandler.handle(error, {
					source: "WebSocket.onerror",
					socketId: adapter.socketId,
				});
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
	Deno.addSignalListener("SIGINT", () => {
		server.dispose();
		Deno.exit(0);
	});
}

// Start server if this is the main module
if (import.meta.main) {
	await startServer();
}
