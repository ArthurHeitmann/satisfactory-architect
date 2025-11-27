/**
 * Environment configuration with defaults
 */

export interface EnvironmentConfig {
	// Server
	port: number;
	serverProtocolVersion: number;

	// Timing
	serverBufferMs: number;
	heartbeatIntervalMs: number;
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
	compressionMethod: CompressionMethod;
	compressionThreshold: number;
}

export type CompressionMethod = "none" | "lz4" | "zstd";

/**
 * Load configuration from environment variables with defaults
 */
export function loadEnvironmentConfig(): EnvironmentConfig {
	return {
		// Server
		port: getEnvNumber("PORT", 8080),
		serverProtocolVersion: getEnvNumber("SERVER_PROTOCOL_VERSION", 1),

		// Timing
		serverBufferMs: getEnvNumber("SERVER_BUFFER_MS", 50),
		heartbeatIntervalMs: getEnvNumber("HEARTBEAT_INTERVAL_MS", 1000),
		heartbeatTimeoutMs: getEnvNumber("HEARTBEAT_TIMEOUT_MS", 5000),
		maxMissedHeartbeats: getEnvNumber("MAX_MISSED_HEARTBEATS", 3),
		snapshotIntervalMs: getEnvNumber("SNAPSHOT_INTERVAL_MS", 30000),

		// Limits
		maxRoomsPerServer: getEnvNumber("MAX_ROOMS_PER_SERVER", 100),
		maxClientsPerRoom: getEnvNumber("MAX_CLIENTS_PER_ROOM", 10),
		maxCommandBatchSize: getEnvNumber("MAX_COMMAND_BATCH_SIZE", 100),

		// Database
		databasePath: getEnvString("DATABASE_PATH", ":memory:"),

		// Compression
		compressionMethod: getEnvString(
			"COMPRESSION_METHOD",
			"none",
		) as CompressionMethod,
		compressionThreshold: getEnvNumber("COMPRESSION_THRESHOLD", 500),
	};
}

/**
 * Get environment variable as number with default
 */
function getEnvNumber(key: string, defaultValue: number): number {
	const value = Deno.env.get(key);
	if (value === undefined) {
		return defaultValue;
	}
	const parsed = parseInt(value, 10);
	return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Get environment variable as string with default
 */
function getEnvString(key: string, defaultValue: string): string {
	return Deno.env.get(key) || defaultValue;
}
