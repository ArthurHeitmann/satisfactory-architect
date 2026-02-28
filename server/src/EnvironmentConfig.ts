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

// ---------------------------------------------------------------------------
// Argument definitions — single source of truth for names, defaults and docs
// ---------------------------------------------------------------------------

type ArgType = "number" | "string";

interface ArgDefinition<T extends ArgType> {
	/** CLI flag name, e.g. "port" maps to --port */
	name: string;
	type: T;
	default: T extends "number" ? string : string;
	/** Human-readable description shown in --help output */
	description: string;
	/** EnvironmentConfig key this argument populates */
	configKey: keyof EnvironmentConfig;
}

// Infer a union of all arg names so the defaults object is fully typed
type ArgName = (typeof ARG_DEFINITIONS)[number]["name"];

const ARG_DEFINITIONS = [
	{
		name: "port",
		type: "number",
		default: "8080",
		description: "TCP port the WebSocket server listens on.",
		configKey: "port",
	},
	{
		name: "server-buffer-ms",
		type: "number",
		default: "50",
		description: "Time (ms) commands are buffered before being flushed to clients.",
		configKey: "serverBufferMs",
	},
	{
		name: "heartbeat-interval-ms",
		type: "number",
		default: "1000",
		description: "Interval (ms) between heartbeat pings sent to clients.",
		configKey: "heartbeatIntervalMs",
	},
	{
		name: "heartbeat-fast-delay-ms",
		type: "number",
		default: "50",
		description: "Delay (ms) used for accelerated heartbeat probing after a missed ping.",
		configKey: "heartbeatFastDelayMs",
	},
	{
		name: "heartbeat-timeout-ms",
		type: "number",
		default: "5000",
		description: "Total time (ms) to wait before considering a client timed out.",
		configKey: "heartbeatTimeoutMs",
	},
	{
		name: "max-missed-heartbeats",
		type: "number",
		default: "3",
		description: "Number of consecutive missed heartbeats before a client is disconnected.",
		configKey: "maxMissedHeartbeats",
	},
	{
		name: "snapshot-interval-ms",
		type: "number",
		default: "10000",
		description: "Interval (ms) between automatic room state snapshots written to the database.",
		configKey: "snapshotIntervalMs",
	},
	{
		name: "max-rooms-per-server",
		type: "number",
		default: "100",
		description: "Maximum number of concurrent collaboration rooms allowed on this server.",
		configKey: "maxRoomsPerServer",
	},
	{
		name: "max-clients-per-room",
		type: "number",
		default: "20",
		description: "Maximum number of clients that can join a single room.",
		configKey: "maxClientsPerRoom",
	},
	{
		name: "max-command-batch-size",
		type: "number",
		default: "1000",
		description: "Maximum number of commands included in a single flush batch.",
		configKey: "maxCommandBatchSize",
	},
	{
		name: "database-path",
		type: "string",
		default: ":memory:",
		description: 'Path to the SQLite database file. Use ":memory:" for an in-memory database.',
		configKey: "databasePath",
	},
	{
		name: "compression-threshold",
		type: "number",
		default: "200",
		description: "Minimum message size (bytes) before compression is applied.",
		configKey: "compressionThreshold",
	},
] as const satisfies ReadonlyArray<ArgDefinition<ArgType>>;

// ---------------------------------------------------------------------------
// Help output
// ---------------------------------------------------------------------------

/** Print CLI usage to stdout and exit with the given code (default 0). */
export function printHelp(exitCode = 0): never {
	const lines: string[] = [
		"Usage: deno run -P src/main.ts [OPTIONS]",
		"",
		"Satisfactory Architect collaboration server.",
		"",
		"Options:",
	];

	const nameColWidth = Math.max(
		"help".length,
		...ARG_DEFINITIONS.map((d) => d.name.length),
	) + 4; // "--" + name + "  "

	const formatFlag = (name: string, description: string) => {
		const padding = " ".repeat(nameColWidth - name.length);
		return `  --${name}${padding}${description}`;
	};

	lines.push(formatFlag("help", "Show this help message and exit."));

	for (const def of ARG_DEFINITIONS) {
		lines.push(formatFlag(def.name, `${def.description}  (default: ${def.default})`));
	}

	lines.push("");
	console.log(lines.join("\n"));
	Deno.exit(exitCode);
}

// ---------------------------------------------------------------------------
// Configuration loader
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments and return a fully resolved EnvironmentConfig.
 * Exits with a help message if --help is passed.
 */
export function loadEnvironmentConfig(): EnvironmentConfig {
	const stringArgs = ARG_DEFINITIONS.map((d) => d.name) satisfies ArgName[];
	const defaults = Object.fromEntries(
		ARG_DEFINITIONS.map((d) => [d.name, d.default]),
	) as Record<ArgName, string>;

	const args = parseArgs(Deno.args, {
		boolean: ["help"],
		string: stringArgs,
		default: { ...defaults, help: false },
	});

	if (args.help) {
		printHelp(0);
	}

	// Build the config by iterating over definitions to avoid manual repetition
	const partial: Partial<EnvironmentConfig> = {};
	for (const def of ARG_DEFINITIONS) {
		const raw = args[def.name as ArgName];
		(partial as Record<string, unknown>)[def.configKey] =
			def.type === "number" ? Number(raw) : raw;
	}

	return partial as EnvironmentConfig;
}
