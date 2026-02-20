import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = resolve(HERE, "../..");
const REPO_ROOT = resolve(UI_ROOT, "..");
const SERVER_ROOT = resolve(REPO_ROOT, "server");

export interface ManagedServer {
	name: string;
	port: number;
	url: string;
	process: ChildProcess;
	stdout: string[];
	stderr: string[];
}

export interface StartServerOptions {
	port?: number;
	host?: string;
	startupTimeoutMs?: number;
	command?: string;
	extraArgs?: string[];
}

export async function startDenoServer(options: StartServerOptions = {}): Promise<ManagedServer> {
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? await findFreePort();
	const startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
	const command = options.command ?? "deno";
	const args = [
		"run",
		"start",
		`--port=${port}`,
		"--server-buffer-ms=10",
		"--heartbeat-fast-delay-ms=10",
		"--database-path=:memory:",
		...(options.extraArgs ?? []),
	];

	const managed = spawnManagedProcess({
		name: "deno",
		command,
		args,
		cwd: SERVER_ROOT,
		host,
		port,
		startupTimeoutMs,
	});

	await waitForHttpReady(managed.url, startupTimeoutMs);
	return managed;
}

export async function startViteDevServer(options: StartServerOptions = {}): Promise<ManagedServer> {
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? await findFreePort();
	const startupTimeoutMs = options.startupTimeoutMs ?? 30_000;
	const command = options.command ?? `npm run dev -- --host ${host} --port ${port}${options.extraArgs?.length ? ` ${options.extraArgs.join(" ")}` : ""}`;

	const managed = spawnManagedProcess({
		name: "vite",
		command,
		args: [],
		cwd: UI_ROOT,
		host,
		port,
		startupTimeoutMs,
		shell: true,
	});

	await waitForHttpReady(managed.url, startupTimeoutMs);
	return managed;
}

export async function stopManagedServer(server: ManagedServer, killTimeoutMs: number = 10_000): Promise<void> {
	if (server.process.killed || server.process.exitCode !== null) {
		return;
	}

	server.process.kill("SIGTERM");
	const exited = await waitForExit(server.process, killTimeoutMs);
	if (exited) return;

	server.process.kill("SIGKILL");
	await waitForExit(server.process, killTimeoutMs);
}

export function getServerStderr(server: ManagedServer): string {
	return server.stderr.join("");
}

export function getServerStdout(server: ManagedServer): string {
	return server.stdout.join("");
}

async function findFreePort(): Promise<number> {
	return await new Promise<number>((resolvePort, reject) => {
		const probe = createServer();
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			if (!address || typeof address === "string") {
				probe.close();
				reject(new Error("Failed to allocate free port"));
				return;
			}
			const port = address.port;
			probe.close((closeErr) => {
				if (closeErr) {
					reject(closeErr);
					return;
				}
				resolvePort(port);
			});
		});
		probe.on("error", reject);
	});
}

async function waitForHttpReady(url: string, timeoutMs: number): Promise<void> {
	const startedAt = Date.now();
	let lastError: unknown = null;

	while (Date.now() - startedAt < timeoutMs) {
		try {
			const response = await fetch(url, { method: "GET" });
			if (response.status >= 100) {
				return;
			}
		} catch (error) {
			lastError = error;
		}
		await sleep(150);
	}

	throw new Error(`Server ${url} did not become ready within ${timeoutMs}ms. Last error: ${String(lastError)}`);
}

function spawnManagedProcess(params: {
	name: string;
	command: string;
	args: string[];
	cwd: string;
	host: string;
	port: number;
	startupTimeoutMs: number;
	shell?: boolean;
}): ManagedServer {
	const proc = spawn(params.command, params.args, {
		cwd: params.cwd,
		stdio: ["ignore", "pipe", "pipe"],
		env: process.env,
		shell: params.shell ?? false,
	});

	const stdout: string[] = [];
	const stderr: string[] = [];
	proc.stdout.on("data", (chunk: Buffer) => stdout.push(chunk.toString("utf8")));
	proc.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));

	proc.on("error", (error) => {
		stderr.push(`[spawn-error] ${String(error)}\n`);
	});

	const url = `http://${params.host}:${params.port}`;

	return {
		name: params.name,
		port: params.port,
		url,
		process: proc,
		stdout,
		stderr,
	};
}

async function waitForExit(proc: ChildProcess, timeoutMs: number): Promise<boolean> {
	if (proc.exitCode !== null) return true;

	const timeout = new Promise<false>((resolveTimeout) => {
		setTimeout(() => resolveTimeout(false), timeoutMs);
	});
	const exited = once(proc, "exit").then(() => true as const);

	return await Promise.race([exited, timeout]);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
