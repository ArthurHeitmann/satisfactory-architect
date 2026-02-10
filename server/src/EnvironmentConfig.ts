/**
 * Environment configuration with defaults
 */

import { parseArgs } from "@std/cli/parse-args";


export interface EnvironmentConfig {
	// Server
	port: number;

	// Timing
	serverBufferMs: number;
	heartbeatIntervalMs: number;
	heartbeatFastDelayMs: number;
	heartbeatTimeoutMs: number;
	maxMissedHeartbeats: number;
	snapshotIntervalMs: number;

	// Limits
	maxRoomsPerServer: number;
	maxClientsPerRoom: number;
	maxCommandBatchSize: number;

	// Database
	databasePath: string;

	// Compression
	compressionThreshold: number;
}

/**
 * Load configuration from environment variables with defaults
 */
export function loadEnvironmentConfig(): EnvironmentConfig {

	const args = parseArgs(Deno.args, {
		string: [
			"port",
			"server-buffer-ms",
			"heartbeat-interval-ms",
			"heartbeat-fast-delay-ms",
			"heartbeat-timeout-ms",
			"max-missed-heartbeats",
			"snapshot-interval-ms",
			"max-rooms-per-server",
			"max-clients-per-room",
			"max-command-batch-size",
			"database-path",
			"compression-threshold",
		],
		default: {
			"port": "8080",
			"server-buffer-ms": "50",
			"heartbeat-interval-ms": "1000",
			"heartbeat-fast-delay-ms": "50",
			"heartbeat-timeout-ms": "5000",
			"max-missed-heartbeats": "3",
			"snapshot-interval-ms": "10000",
			"max-rooms-per-server": "100",
			"max-clients-per-room": "20",
			"max-command-batch-size": "1000",
			"database-path": ":memory:",
			"compression-threshold": "200",
		},
	});

	return {
		port: Number(args["port"]),
		serverBufferMs: Number(args["server-buffer-ms"]),
		heartbeatIntervalMs: Number(args["heartbeat-interval-ms"]),
		heartbeatFastDelayMs: Number(args["heartbeat-fast-delay-ms"]),
		heartbeatTimeoutMs: Number(args["heartbeat-timeout-ms"]),
		maxMissedHeartbeats: Number(args["max-missed-heartbeats"]),
		snapshotIntervalMs: Number(args["snapshot-interval-ms"]),
		maxRoomsPerServer: Number(args["max-rooms-per-server"]),
		maxClientsPerRoom: Number(args["max-clients-per-room"]),
		maxCommandBatchSize: Number(args["max-command-batch-size"]),
		databasePath: args["database-path"],
		compressionThreshold: Number(args["compression-threshold"]),
	};
}
