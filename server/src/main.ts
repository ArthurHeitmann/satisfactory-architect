/**
 * Deno WebSocket server entry point for collaboration server
 */

import type { ServerMessage } from "./types_shared.ts";
import type { ServerConfig, WebSocketAdapter } from "./types_server.ts";
import { WebSocketReadyState } from "./types_server.ts";
import { CollaborationServer } from "./CollaborationServer.ts";;
import { CompressionService } from "./compression.ts";
import { DatabaseManager } from "./persistence.ts";
import { loadEnvironmentConfig } from "./EnvironmentConfig.ts";
import { SqliteDatabaseAdapter } from "./SqliteDatabaseAdapter.ts";
import { ErrorHandler } from "./errors/ErrorHandler.ts";
import { generateSecureId } from "./utils.ts";

// Deno WebSocket adapter
class DenoWebSocketAdapter implements WebSocketAdapter {
	constructor(
		private ws: WebSocket,
		public readonly clientId: string = generateSecureId(16),
	) {
	}

	sendMessage(message: ServerMessage): void {
		if (this.ws.readyState !== WebSocketReadyState.OPEN) {
			return;
		}

		try {
			const serialized = JSON.stringify(message);
			this.ws.send(serialized);
		} catch (error) {
			ErrorHandler.handle(error, {
				source: "DenoWebSocketAdapter.sendMessage",
				clientId: this.clientId,
			});
		}
	}

	close(): void {
		this.ws.close();
	}

	get readyState(): WebSocketReadyState {
		return this.ws.readyState as WebSocketReadyState;
	}
}

/**
 * Main server setup
 */
function createServer(): CollaborationServer {
	const envConfig = loadEnvironmentConfig();

	const config: ServerConfig = {
		port: envConfig.port,
		serverProtocolVersion: envConfig.serverProtocolVersion,
		serverBufferMs: envConfig.serverBufferMs,
		heartbeatIntervalMs: envConfig.heartbeatIntervalMs,
		snapshotIntervalMs: envConfig.snapshotIntervalMs,
		maxRoomsPerServer: envConfig.maxRoomsPerServer,
		maxClientsPerRoom: envConfig.maxClientsPerRoom,
		maxCommandBatchSize: envConfig.maxCommandBatchSize,
	};

	const compression = new CompressionService(
		undefined,
		envConfig.compressionThreshold,
	);
	const dbAdapter = new SqliteDatabaseAdapter(envConfig.databasePath);
	const database = new DatabaseManager(dbAdapter);

	return new CollaborationServer(config, compression, database);
}

/**
 * Start WebSocket server
 */
function startServer() {
	const server = createServer();
	const envConfig = loadEnvironmentConfig();

	console.log(`🚀 Collaboration server starting on port ${envConfig.port}`);

	const handler = (request: Request): Response => {
		// Handle WebSocket upgrade
		if (request.headers.get("upgrade") === "websocket") {
			const { socket, response } = Deno.upgradeWebSocket(request);
			const adapter = new DenoWebSocketAdapter(socket);

			socket.onopen = () => {
				console.log("Client connected");
				try {
					server.handleConnection(adapter);
				} catch (error) {
					ErrorHandler.handle(error, { source: "WebSocket.onopen" });
				}
			};

			socket.onmessage = (event) => {
				try {
					server.handleMessage(adapter, event.data);
				} catch (error) {
					ErrorHandler.handle(error, {
						source: "WebSocket.onmessage",
						clientId: adapter.clientId,
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
						clientId: adapter.clientId,
					});
				}
			};

			socket.onerror = (error) => {
				ErrorHandler.handle(error, {
					source: "WebSocket.onerror",
					clientId: adapter.clientId,
				});
			};

			return response;
		}

		// Handle regular HTTP requests
		return new Response(
			"Satisfactory Factory Manager Collaboration Server",
			{
				status: 200,
				headers: { "content-type": "text/plain" },
			},
		);
	};

	// Start server
	Deno.serve({ port: envConfig.port }, handler);

	// Graceful shutdown
	Deno.addSignalListener("SIGINT", () => {
		console.log("\n🛑 Shutting down server...");
		server.dispose();
		Deno.exit(0);
	});
}

// Start server if this is the main module
if (import.meta.main) {
	startServer();
}
