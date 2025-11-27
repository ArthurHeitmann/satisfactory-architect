/**
 * Room state management - handles application state and command application
 */

import type {
	Command,
	ObjectAddCommand,
	ObjectDeleteCommand,
	ObjectModifyCommand,
	PageAddCommand,
	PageDeleteCommand,
	PageModifyCommand,
	PageReorderCommand,
} from "./types_shared.ts";
import { ErrorCode } from "./types_shared.ts";
import { AppError } from "./errors/AppError.ts";
import type {
	AppStateJson,
	GraphEdgeJson,
	GraphNodeJson,
	GraphPageJson,
} from "./types_serialization.ts";

/**
 * Room state interface for dependency injection
 */
export interface IRoomState {
	isStateInitialized(): boolean;
	canSetState(): boolean;
	canGetState(): boolean;
	setState(data: AppStateJson): void;
	getState(): AppStateJson;
	consumeStateChanges(): { data: AppStateJson | null; hasChanged: boolean };
	updateIdCounter(clientIdCounter: string): void;
	getIdCounter(): string;
	applyCommand(command: Command): void;
	applyCommands(commands: Command[]): void;
}

/**
 * Manages the application state for a collaboration room
 */
export class RoomState implements IRoomState {
	private state: AppStateJson | null = null;
	private isInitialized = false;
	private hasChanged = false;

	constructor(
		private roomId: string,
	) {}

	/**
	 * Check if state has been initialized (uploaded at least once)
	 */
	public isStateInitialized(): boolean {
		return this.isInitialized;
	}

	/**
	 * Check if state can be set (uploaded)
	 * @returns true - uploads are always allowed
	 */
	public canSetState(): boolean {
		return true;
	}

	/**
	 * Check if state can be retrieved (downloaded)
	 * @returns true if state has been initialized
	 */
	public canGetState(): boolean {
		return this.isInitialized;
	}

	/**
	 * Update the highest ID counter seen from a client heartbeat
	 */
	public updateIdCounter(clientIdCounter: string): void {
		if (!this.state) return;

		this.state.idGen = clientIdCounter;
		this.hasChanged = true;
	}

	/**
	 * Get the current highest ID counter
	 */
	public getIdCounter(): string {
		return this.state?.idGen ?? "0";
	}

	/**
	 * Set the complete room state (from client upload)
	 */
	public setState(data: AppStateJson): void {
		this.state = data;
		this.isInitialized = true;
		this.hasChanged = true;
	}

	/**
	 * Get the current room state
	 * @throws AppError if state has not been initialized
	 */
	public getState(): AppStateJson {
		if (!this.isInitialized || !this.state) {
			throw new AppError(
				ErrorCode.INTERNAL_ERROR,
				{ roomId: this.roomId, operation: "getState" },
				"Room state has not been initialized yet",
			);
		}
		return this.state;
	}

	/**
	 * Get state data and consume the hasChanged flag.
	 * @returns Object with state data and whether changes occurred. Resets hasChanged to false.
	 */
	public consumeStateChanges(): { data: AppStateJson | null; hasChanged: boolean } {
		const result = {
			data: this.state,
			hasChanged: this.hasChanged,
		};
		this.hasChanged = false;
		return result;
	}

	/**
	 * Apply a command to the room state
	 * @param command The command to apply
	 */
	public applyCommand(command: Command): void {
		switch (command.type) {
			case "page.add":
				this.handlePageAdd(command);
				break;
			case "page.delete":
				this.handlePageDelete(command);
				break;
			case "page.modify":
				this.handlePageModify(command);
				break;
			case "page.reorder":
				this.handlePageReorder(command);
				break;
			case "object.add":
				this.handleObjectAdd(command);
				break;
			case "object.delete":
				this.handleObjectDelete(command);
				break;
			case "object.modify":
				this.handleObjectModify(command);
				break;
			default:
				throw new AppError(
					ErrorCode.INVALID_MESSAGE,
					{ roomId: this.roomId, commandType: command["type"] },
					`Unknown command type: ${command["type"]}`,
				);
		}
	}

	/**
	 * Apply multiple commands in sequence
	 * @throws AppError if state is not initialized
	 */
	public applyCommands(commands: Command[]): void {
		if (!this.isInitialized) {
			throw new AppError(
				ErrorCode.STATE_NOT_INITIALIZED,
				{ roomId: this.roomId, commandCount: commands.length },
				"Cannot apply commands: room state has not been initialized",
			);
		}

		for (const command of commands) {
			this.applyCommand(command);
		}

		if (commands.length > 0) {
			this.hasChanged = true;
		}
	}

	/**
	 * Find a page by ID
	 */
	private findPage(pageId: string): GraphPageJson | undefined {
		return this.state?.pages.find((p) => p.id === pageId);
	}

	private handlePageAdd(command: PageAddCommand): void {
		if (!this.state) return;

		this.state.pages.push(command.data as GraphPageJson);
	}

	private handlePageDelete(command: PageDeleteCommand): void {
		if (!this.state) return;

		const pageIndex = this.state.pages.findIndex((p) => p.id === command.pageId);
		if (pageIndex >= 0) {
			this.state.pages.splice(pageIndex, 1);
		}
	}

	private handlePageModify(command: PageModifyCommand): void {
		if (!this.state) return;

		const page = this.findPage(command.pageId);
		if (page) {
			Object.assign(page, command.data);
		}
	}

	private handlePageReorder(command: PageReorderCommand): void {
		if (!this.state) return;

		const reorderedPages: GraphPageJson[] = [];
		for (const pageId of command.pageOrder) {
			const page = this.findPage(pageId);
			if (page) {
				reorderedPages.push(page);
			}
		}

		// Add any pages not in the new order at the end
		for (const page of this.state.pages) {
			if (!reorderedPages.includes(page)) {
				reorderedPages.push(page);
			}
		}

		this.state.pages = reorderedPages;
	}

	private handleObjectAdd(command: ObjectAddCommand): void {
		if (!this.state) return;

		const page = this.findPage(command.pageId);
		if (!page) {
			throw new AppError(
				ErrorCode.INVALID_MESSAGE,
				{ roomId: this.roomId, pageId: command.pageId },
				`Page ${command.pageId} not found`,
			);
		}

		if (command.objectType === "node") {
			page.nodes[command.objectId] = command.data as GraphNodeJson;
		} else {
			page.edges[command.objectId] = command.data as GraphEdgeJson;
		}
	}

	private handleObjectDelete(command: ObjectDeleteCommand): void {
		if (!this.state) return;

		const page = this.findPage(command.pageId);
		if (!page) return;

		delete page.nodes[command.objectId];
		delete page.edges[command.objectId];
	}

	private handleObjectModify(command: ObjectModifyCommand): void {
		if (!this.state) return;

		const page = this.findPage(command.pageId);
		if (!page) return;

		if (command.objectId in page.nodes) {
			page.nodes[command.objectId] = command.data as GraphNodeJson;
		} else if (command.objectId in page.edges) {
			page.edges[command.objectId] = command.data as GraphEdgeJson;
		}
	}
}
