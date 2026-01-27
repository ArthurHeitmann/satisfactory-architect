
import type {
	ClientMessage,
	ServerMessage,
} from "../shared/messages.ts";

export class TestServer {
	private process: Deno.ChildProcess | null = null;
	public readonly port: number;

	constructor() {
		// Pick a random port between 10000 and 60000
		this.port = Math.floor(Math.random() * 50000) + 10000;
	}

	async start() {
		let cwd = Deno.cwd();
		// Check if we are in root or server
		try {
			// Check for server/src/main.ts (root)
			await Deno.stat(cwd + "/server/src/main.ts");
			cwd = cwd + "/server";
		} catch {
			try {
				// Check for src/main.ts (server dir)
				await Deno.stat(cwd + "/src/main.ts");
				// cwd is correct
			} catch {
				throw new Error("Could not find server source. Please run from project root or server directory.");
			}
		}

		const command = new Deno.Command("deno", {
			args: ["run", "-P", "src/main.ts"],
			cwd: cwd,
			env: {
				PORT: this.port.toString(),
				DATABASE_PATH: ":memory:", // Use in-memory DB for tests
				HEARTBEAT_INTERVAL_MS: "100", // Fast heartbeats for testing
				HEARTBEAT_TIMEOUT_MS: "1000",
			},
			stdout: "piped",
			stderr: "piped",
		});

		this.process = command.spawn();

		// Wait for server to be ready by reading stdout
		const reader = this.process.stdout.getReader();
		const decoder = new TextDecoder();
		let output = "";
		
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			const chunk = decoder.decode(value);
			output += chunk;
			if (output.includes("Collaboration server starting")) {
				break;
			}
		}
		reader.releaseLock();

		// this.process.stdout.pipeTo(Deno.stdout.writable);
		// this.process.stderr.pipeTo(Deno.stderr.writable);
	}

	async stop() {
		if (this.process) {
			try {
				this.process.kill();
			} catch {
				// Ignore errors
			}
			await this.process.status;
			this.process = null;
		}
	}
}

export class TestClient {
	private ws: WebSocket | null = null;
	private messageQueue: ServerMessage[] = [];
	private heartbeatInterval: number | null = null;
	public socketId: string = "";

	constructor(private port: number) {}

	connect(): Promise<void> {
		this.ws = new WebSocket(`ws://localhost:${this.port}`);
		
		return new Promise((resolve, reject) => {
			if (!this.ws) return reject("No WebSocket");

			this.ws.onopen = () => {
				this.ws?.send(`init:{"supported_compression_methods":["none"]}`);
				resolve();
			};

			this.ws.onmessage = (event) => {
				const data = event.data;
				if (typeof data === "string" && data.startsWith("init:")) {
					return;
				}
				const msg = JSON.parse(data) as ServerMessage;
				this.handleMessage(msg);
			};

			this.ws.onerror = (e) => {
				console.error("WebSocket error:", e);
				reject(e);
			};
			
			this.ws.onclose = () => {
				// console.log("WebSocket closed");
			};
		});
	}

	private handleMessage(msg: ServerMessage) {
		// console.log("Received", msg);
		this.messageQueue.push(msg);
	}

	send(msg: ClientMessage) {
		// console.log("Sending", msg);
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		} else {
			throw new Error("WebSocket not open");
		}
	}

	async waitForMessage(predicate: (msg: ServerMessage) => boolean, timeoutMs = 5000): Promise<ServerMessage> {
		const startTime = Date.now();
		
		while (Date.now() - startTime < timeoutMs) {
			const index = this.messageQueue.findIndex(predicate);
			if (index !== -1) {
				return this.messageQueue.splice(index, 1)[0];
			}
			await new Promise(r => setTimeout(r, 10));
		}
		
		throw new Error(`Timeout waiting for message matching predicate`);
	}
	
	// improved waitForMessage
	async waitForMessageType<T extends ServerMessage>(type: T["type"], timeoutMs = 5000): Promise<T> {
		const startTime = Date.now();
		
		while (Date.now() - startTime < timeoutMs) {
			const index = this.messageQueue.findIndex(m => m.type === type);
			if (index !== -1) {
				return this.messageQueue.splice(index, 1)[0] as T;
			}
			await new Promise(r => setTimeout(r, 10));
		}
		
		throw new Error(`Timeout waiting for message type ${type}. Queue: ${JSON.stringify(this.messageQueue)}`);
	}

	startHeartbeat(intervalMs: number = 100) {
		this.heartbeatInterval = setInterval(() => {
			this.send({
				type: "heartbeat",
				cursor: { x: 0, y: 0 },
				currentPageId: null,
				localIdCounter: "0",
			});
		}, intervalMs);
	}

	stopHeartbeat() {
		if (this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
	}

	close() {
		this.stopHeartbeat();
		if (this.ws) {
			this.ws.close();
		}
	}
}
