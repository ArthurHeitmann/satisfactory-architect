/**
 * Agent controller — wraps a Playwright `Page` with helpers for
 * navigating to the app, managing the collaboration connection,
 * extracting state, and adjusting the viewport before interactions.
 */

import type { Page, BrowserContext } from "@playwright/test";
import type { AppStateJson } from "../../../server/shared/types_serialization";
import type { SeededRandom } from "./SeededRandom";
import { extractAppState } from "./stateExtraction";

// ── Types ──────────────────────────────────────────────────────────

/** The connection states mirrored from ServerConnection on the client. */
export type ServerConnectionState =
	| "Disconnected"
	| "Connecting"
	| "Connected"
	| "JoiningRoom"
	| "UploadingState"
	| "InRoom";

export interface AgentOptions {
	/** Agent index (0-based). Agent 0 is the room creator. */
	index: number;
	/** Base URL of the Vite dev server. */
	appUrl: string;
	/** WebSocket URL of the collaboration server. */
	wsUrl: string;
	/** Forked PRNG stream for this agent. */
	rng: SeededRandom;
	/** Timeout for waiting on connection state transitions (ms). Default: 15000. */
	connectionTimeoutMs?: number;
}

export interface ConsoleEntry {
	type: "error" | "warning" | "log";
	text: string;
	timestamp: number;
}

export interface WebSocketCommandEvent {
	timestamp: number;
	direction: "sent" | "received";
	data: string;
}

/**
 * An Agent wraps a single Playwright browser page and provides
 * high-level methods for interacting with the Satisfactory Architect
 * application during e2e stress tests.
 */
export class Agent {
	readonly index: number;
	readonly page: Page;
	readonly rng: SeededRandom;

	private readonly appUrl: string;
	private readonly wsUrl: string;
	private readonly connectionTimeoutMs: number;

	/** Console errors captured from the page. */
	readonly consoleErrors: ConsoleEntry[] = [];
	/** All page errors (uncaught exceptions). */
	readonly pageErrors: Error[] = [];

	constructor(page: Page, options: AgentOptions) {
		this.index = options.index;
		this.page = page;
		this.rng = options.rng;
		this.appUrl = options.appUrl;
		this.wsUrl = options.wsUrl;
		this.connectionTimeoutMs = options.connectionTimeoutMs ?? 15_000;
	}

	// ── Lifecycle ────────────────────────────────────────────────

	/**
	 * Navigate to the app with `?e2e=1`, set up error listeners,
	 * and wait for `__appState` to be available.
	 */
	async setup(): Promise<void> {
		this.page.setDefaultTimeout(5_000);
		this.page.setDefaultNavigationTimeout(30_000);

		await this.page.addInitScript(() => {
			const win = window as any;
			if (win.__e2eWebSocketInterceptorInstalled) return;
			win.__e2eWebSocketInterceptorInstalled = true;
			win.__e2eWsEvents = [];

			const OriginalWebSocket = window.WebSocket;
			const toText = (value: unknown): string => {
				if (typeof value === "string") return value;
				if (value instanceof ArrayBuffer) return `[ArrayBuffer:${value.byteLength}]`;
				if (ArrayBuffer.isView(value as any)) {
					return `[ArrayBufferView:${(value as ArrayBufferView).byteLength}]`;
				}
				return String(value);
			};

			class InstrumentedWebSocket extends OriginalWebSocket {
				constructor(...args: ConstructorParameters<typeof WebSocket>) {
					super(...args);
					this.addEventListener("message", (event) => {
						win.__e2eWsEvents.push({
							timestamp: Date.now(),
							direction: "received",
							data: toText(event.data),
						});
					});
				}

				send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
					win.__e2eWsEvents.push({
						timestamp: Date.now(),
						direction: "sent",
						data: toText(data),
					});
					super.send(data);
				}
			}

			window.WebSocket = InstrumentedWebSocket as any;
			win.__drainE2eWsEvents = () => {
				const events = win.__e2eWsEvents ?? [];
				win.__e2eWsEvents = [];
				return events;
			};
		});

		// Set up error listeners BEFORE navigation
		this.page.on("pageerror", (error) => {
			this.pageErrors.push(error);
		});
		this.page.on("console", (msg) => {
			if (msg.type() === "error") {
				this.consoleErrors.push({
					type: "error",
					text: msg.text(),
					timestamp: Date.now(),
				});
			}
		});

		// Navigate
		await this.page.goto(`${this.appUrl}?e2e=1`, { waitUntil: "networkidle" });

		// Wait for __appState to be exposed
		await this.page.waitForFunction(
			() => !!(window as any).__appState,
			{ timeout: 10_000 },
		);
	}

	/**
	 * Returns true if any uncaught page errors have been recorded.
	 */
	hasErrors(): boolean {
		return this.pageErrors.length > 0;
	}

	/**
	 * Format all captured errors into a readable string.
	 */
	formatErrors(): string {
		const lines: string[] = [];
		for (const err of this.pageErrors) {
			lines.push(`[PageError] ${err.message}`);
		}
		for (const entry of this.consoleErrors) {
			lines.push(`[Console.error] ${entry.text}`);
		}
		return lines.join("\n");
	}

	// ── Connection State ─────────────────────────────────────────

	/**
	 * Get the current ServerConnection state from the browser.
	 */
	async getConnectionState(): Promise<ServerConnectionState> {
		return await this.page.evaluate(() => {
			const conn = (window as any).__serverConnection;
			return conn?.state ?? "Disconnected";
		});
	}

	/**
	 * Wait until the connection reaches a specific state.
	 */
	async waitForConnectionState(
		targetState: ServerConnectionState,
		timeoutMs?: number,
	): Promise<void> {
		const timeout = timeoutMs ?? this.connectionTimeoutMs;
		await this.page.waitForFunction(
			(expected: string) => {
				const conn = (window as any).__serverConnection;
				return conn?.state === expected;
			},
			targetState,
			{ timeout },
		);
	}

	// ── Room Management ──────────────────────────────────────────

	/**
	 * Connect to the collaboration server.
	 * Sets the server URL and calls connect().
	 */
	async connectToServer(): Promise<void> {
		await this.page.evaluate((wsUrl: string) => {
			const conn = (window as any).__serverConnection;
			conn.setServerUrl(wsUrl);
		}, this.wsUrl);

		await this.waitForConnectionState("Connected");
	}

	/**
	 * Create a new room and upload the current app state.
	 * Used by Agent 0 to initialize the collaborative session.
	 * Returns the room ID.
	 */
	async createRoom(): Promise<string> {
		await this.page.evaluate(() => {
			const conn = (window as any).__serverConnection;
			const app = (window as any).__appState;
			conn.createRoom(app.toJSON());
		});

		await this.waitForConnectionState("InRoom");

		const roomId = await this.page.evaluate(() => {
			const conn = (window as any).__serverConnection;
			return conn.roomId;
		});

		if (!roomId) throw new Error("Room ID is null after createRoom");
		return roomId;
	}

	/**
	 * Join an existing room (download intent — state will be downloaded from server).
	 */
	async joinRoom(roomId: string): Promise<void> {
		await this.page.evaluate((id: string) => {
			const conn = (window as any).__serverConnection;
			conn.joinRoom(id);
		}, roomId);

		await this.waitForConnectionState("InRoom");
	}

	/**
	 * Intentionally disconnect from the server.
	 */
	async disconnect(): Promise<void> {
		await this.page.evaluate(() => {
			const conn = (window as any).__serverConnection;
			conn.intentionalDisconnect();
		});

		await this.waitForConnectionState("Disconnected");
	}

	/**
	 * Reconnect to the last room.
	 */
	async reconnect(): Promise<void> {
		await this.page.evaluate(() => {
			const conn = (window as any).__serverConnection;
			conn.reconnect();
		});

		await this.waitForConnectionState("InRoom");
	}

	// ── State Extraction ─────────────────────────────────────────

	/**
	 * Extract the full serialized AppState from the browser.
	 */
	async getAppState(): Promise<AppStateJson> {
		return extractAppState(this.page);
	}

	/**
	 * Get the current page's node count (from DOM).
	 */
	async getNodeCount(): Promise<number> {
		return this.page.locator('[data-node-id]').count();
	}

	/**
	 * Get the current page's edge count (from DOM).
	 */
	async getEdgeCount(): Promise<number> {
		return this.page.locator('[data-edge-id]').count();
	}

	// ── View Adjustment ──────────────────────────────────────────

	/**
	 * Pan the view so a specific node is centered in the viewport.
	 *
	 * This sets the page's view offset directly (local-only property)
	 * so that Playwright can interact with the node via mouse events.
	 */
	async panToNode(nodeId: string): Promise<void> {
		await this.page.evaluate((id: string) => {
			const app = (window as any).__appState;
			const page = app.currentPage;
			if (!page) return;

			const node = page.nodes.get(id);
			if (!node) return;

			const absPos = node.getAbsolutePosition(page);
			const svgEl = page.svgElement;
			if (!svgEl) return;

			const rect = svgEl.getBoundingClientRect();
			const centerX = rect.width / 2;
			const centerY = rect.height / 2;

			page.view.offset.x = centerX - absPos.x * page.view.scale;
			page.view.offset.y = centerY - absPos.y * page.view.scale;
		}, nodeId);
	}

	/**
	 * Pan the view so a specific position (in page coordinates) is centered.
	 */
	async panToPosition(x: number, y: number): Promise<void> {
		await this.page.evaluate(({ x, y }: { x: number; y: number }) => {
			const app = (window as any).__appState;
			const page = app.currentPage;
			if (!page) return;

			const svgEl = page.svgElement;
			if (!svgEl) return;

			const rect = svgEl.getBoundingClientRect();
			const centerX = rect.width / 2;
			const centerY = rect.height / 2;

			page.view.offset.x = centerX - x * page.view.scale;
			page.view.offset.y = centerY - y * page.view.scale;
		}, { x, y });
	}

	/**
	 * Reset the view to center on origin with scale = 1.
	 */
	async resetView(): Promise<void> {
		await this.page.evaluate(() => {
			const app = (window as any).__appState;
			const page = app.currentPage;
			if (!page) return;

			const svgEl = page.svgElement;
			if (!svgEl) return;

			const rect = svgEl.getBoundingClientRect();
			page.view.offset.x = rect.width / 2;
			page.view.offset.y = rect.height / 2;
			page.view.scale = 1;
		});
	}

	/**
	 * Get the viewport-relative center position of a node.
	 * Returns null if the node is not found or not on the current page.
	 */
	async getNodeScreenPosition(nodeId: string): Promise<{ x: number; y: number } | null> {
		const el = this.page.locator(`[data-node-id="${nodeId}"]`);
		const box = await el.boundingBox();
		if (!box) return null;
		return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	}

	/**
	 * Get a random node ID from the current page (via DOM data attributes).
	 * Returns null if there are no nodes.
	 */
	async getRandomNodeId(): Promise<string | null> {
		const nodes = this.page.locator('[data-node-id]');
		const count = await nodes.count();
		if (count === 0) return null;
		const index = this.rng.nextInt(0, count - 1);
		return nodes.nth(index).getAttribute('data-node-id');
	}

	/**
	 * Get a random top-level node ID (non-resource-joint) from the current page.
	 * Returns null if there are no top-level nodes.
	 */
	async getRandomTopLevelNodeId(): Promise<string | null> {
		const nodes = this.page.locator('[data-node-id]:not([data-node-type="resource-joint"])');
		const count = await nodes.count();
		if (count === 0) return null;
		const index = this.rng.nextInt(0, count - 1);
		return nodes.nth(index).getAttribute('data-node-id');
	}

	/**
	 * Get a random edge ID from the current page (via DOM data attributes).
	 * Returns null if there are no edges.
	 */
	async getRandomEdgeId(): Promise<string | null> {
		const edges = this.page.locator('[data-edge-id]');
		const count = await edges.count();
		if (count === 0) return null;
		const index = this.rng.nextInt(0, count - 1);
		return edges.nth(index).getAttribute('data-edge-id');
	}

	/**
	 * Get info about a specific node's resource joints (free input/output joints).
	 */
	async getFreeJoints(nodeId: string): Promise<{
		freeInputs: string[];
		freeOutputs: string[];
	}> {
		return await this.page.evaluate((id: string) => {
			const app = (window as any).__appState;
			const page = app.currentPage;
			if (!page) return { freeInputs: [], freeOutputs: [] };

			const node = page.nodes.get(id);
			if (!node || node.properties.type !== "production") {
				return { freeInputs: [], freeOutputs: [] };
			}

			const freeInputs: string[] = [];
			const freeOutputs: string[] = [];

			for (const joint of node.properties.resourceJoints) {
				const jointNode = page.nodes.get(joint.id);
				if (!jointNode) continue;
				// A joint is "free" if it has no edges (other than the one to its parent)
				if (jointNode.edges.size === 0) {
					if (joint.type === "input") {
						freeInputs.push(joint.id);
					} else {
						freeOutputs.push(joint.id);
					}
				}
			}

			return { freeInputs, freeOutputs };
		}, nodeId);
	}

	/**
	 * Get pages info (id and name) by reading the page tab buttons from the DOM.
	 */
	async getPages(): Promise<Array<{ id: string; name: string }>> {
		const buttons = this.page.locator('[data-page-id]');
		const count = await buttons.count();
		const pages: Array<{ id: string; name: string }> = [];
		for (let i = 0; i < count; i++) {
			const btn = buttons.nth(i);
			const id = await btn.getAttribute('data-page-id');
			const name = await btn.textContent();
			if (id) pages.push({ id, name: name?.trim() ?? '' });
		}
		return pages;
	}

	/**
	 * Get the current page ID by finding the selected page tab.
	 */
	async getCurrentPageId(): Promise<string | null> {
		const selected = this.page.locator('[data-page-id].selected');
		if (await selected.count() === 0) return null;
		return selected.getAttribute('data-page-id');
	}

	/**
	 * Switch to a specific page by ID.
	 */
	async switchToPage(pageId: string): Promise<void> {
		const pageTab = this.page.locator(`[data-page-id="${pageId}"]`);
		await pageTab.click();
	}

	// ── SVG Canvas Helpers ───────────────────────────────────────

	/**
	 * Get the bounding box of the SVG canvas element.
	 */
	async getCanvasBounds(): Promise<{ x: number; y: number; width: number; height: number }> {
		const svg = this.page.locator('.graph-page-view').first();
		const box = await svg.boundingBox();
		if (!box) return { x: 0, y: 0, width: 800, height: 600 };
		return box;
	}

	/**
	 * Get a random position on the canvas (screen coordinates).
	 * The position is within the central 60% of the canvas to avoid edges.
	 */
	async getRandomCanvasPosition(): Promise<{ x: number; y: number }> {
		const bounds = await this.getCanvasBounds();
		const margin = 0.2;
		return {
			x: bounds.x + bounds.width * (margin + this.rng.next() * (1 - 2 * margin)),
			y: bounds.y + bounds.height * (margin + this.rng.next() * (1 - 2 * margin)),
		};
	}

	/**
	 * Wait for a short duration. Used between actions to let the UI settle.
	 */
	async wait(ms: number): Promise<void> {
		await this.page.waitForTimeout(ms);
	}

	async drainWebSocketEvents(): Promise<WebSocketCommandEvent[]> {
		return await this.page.evaluate(() => {
			const win = window as any;
			if (typeof win.__drainE2eWsEvents === "function") {
				return win.__drainE2eWsEvents();
			}
			return [];
		});
	}
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create multiple agents from a set of browser contexts.
 */
export async function createAgents(
	contexts: BrowserContext[],
	options: Omit<AgentOptions, "index" | "rng" | "page"> & { rng: SeededRandom },
): Promise<Agent[]> {
	const agents: Agent[] = [];

	for (let i = 0; i < contexts.length; i++) {
		const page = await contexts[i].newPage();
		const forkedRng = options.rng.fork();
		const agent = new Agent(page, {
			index: i,
			appUrl: options.appUrl,
			wsUrl: options.wsUrl,
			rng: forkedRng,
			connectionTimeoutMs: options.connectionTimeoutMs,
		});
		agents.push(agent);
	}

	return agents;
}

/**
 * Set up a collaborative session:
 * 1. Agent 0 connects, creates a room, and uploads state.
 * 2. Remaining agents connect and join the room (staggered).
 *
 * Returns the room ID.
 */
export async function setupCollaborativeSession(
	agents: Agent[],
	staggerDelayMs: number = 500,
	initialStateJson?: unknown,
): Promise<string> {
	if (agents.length === 0) throw new Error("Need at least one agent");

	// All agents navigate and set up error listeners
	await Promise.all(agents.map((a) => a.setup()));

	// Agent 0: connect + create room
	const leader = agents[0];
	await leader.connectToServer();
	if (initialStateJson !== undefined) {
		await leader.page.evaluate((json) => {
			const app = (window as any).__appState;
			app.replaceFromJSON(json);
		}, initialStateJson);
	}
	const roomId = await leader.createRoom();

	// Remaining agents: connect + join room (staggered)
	for (let i = 1; i < agents.length; i++) {
		await agents[i].connectToServer();
		await agents[i].joinRoom(roomId);
		if (i < agents.length - 1 && staggerDelayMs > 0) {
			await agents[i].wait(staggerDelayMs);
		}
	}

	return roomId;
}
