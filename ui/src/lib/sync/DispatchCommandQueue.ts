import { GraphEdge } from "$lib/datamodel/GraphEdge.svelte";
import { GraphNode } from "$lib/datamodel/GraphNode.svelte";
import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
import { watchState } from "$lib/utilities.svelte";
import { arraysEqual, assertUnreachable, generateUUID } from "$lib/utilties";
import type { Command, ObjectModifyCommand, PageAddCommand, PageDeleteCommand, PageModifyCommand, ObjectAddCommand, ObjectDeleteCommand, ObjectType, StateVarUpdateCommand, StateVarName, ViewUpdateCommand } from "../../../../server/shared/types_shared";

export class DispatchCommandQueue {
	private queue: Command[] = [];
	private flushTimeout: number | null = null;
	private static FLUSH_DELAY_MS = 50;

	constructor(
		private flushCallback: (commands: Command[]) => void,
		private isInRoom: () => boolean,
		private getUserId: () => string,
		private isUpdatingState: () => boolean,
	) {
	}

	/**
	 * Apply deduplication logic to the queue for a given command.
	 * Returns the filtered queue with outdated commands removed.
	 */
	private deduplicateQueue(command: Command): Command[] {
		switch (command.type) {
			case "page.modify": // remove old page.modify for same page
				return this.queue.filter(c => c.type !== "page.modify" || c.pageId !== command.pageId);
			case "object.delete": // remove old object.add, object.modify for same object
				return this.queue.filter(c => {
					if (c.type === "object.add" && c.objectId === command.objectId && c.objectType === command.objectType) {
						return false;
					}
					if (c.type === "object.modify" && c.objectId === command.objectId && c.objectType === command.objectType) {
						return false;
					}
					return true;
				});
			case "object.modify": // remove old object.modify for same object
				return this.queue.filter(c => c.type !== "object.modify" || c.objectId !== command.objectId || c.objectType !== command.objectType);
			case "page.delete": // remove old page.*, object.*, view.update for same page
				return this.queue.filter(c => {
					if ((c.type.startsWith("page.") || c.type.startsWith("object.") || c.type === "view.update") && "pageId" in c && c.pageId === command.pageId) {
						return false;
					}
					return true;
				});
			case "statevar.update": // remove old statevar.update for same variable
				return this.queue.filter(c => c.type !== "statevar.update" || c.name !== command.name);
			case "view.update": // remove old view.update for same page
				return this.queue.filter(c => c.type !== "view.update" || c.pageId !== command.pageId);
			case "object.add":
			case "page.add":
			case "page.reorder":
				return this.queue;
			default:
				assertUnreachable(command);
		}
	}

	/**
	 * Enqueue a command with optional flush scheduling.
	 * @param command The command to enqueue
	 * @param triggerFlush Whether to schedule a flush (default: true)
	 */
	enqueue(command: Command, triggerFlush: boolean = true): void {
		this.queue = this.deduplicateQueue(command);
		this.queue.push(command);
		if (triggerFlush) {
			this.scheduleFlush();
		}
	}

	private scheduleFlush(): void {
		if (this.flushTimeout !== null) {
			return;
		}
		this.flushTimeout = window.setTimeout(() => {
			this.flush();
		}, DispatchCommandQueue.FLUSH_DELAY_MS);
	}

	private flush(): void {
		if (this.queue.length === 0) {
			this.flushTimeout = null;
			return;
		}
		const commandsToFlush = this.queue;
		this.queue = [];
		this.flushTimeout = null;
		this.flushCallback(commandsToFlush);
	}

	private watch<T>(options: {
		dependencies: () => T,
		onChange: (value: T) => void,
	}) {
		watchState({
			dependencies: options.dependencies,
			guard: () => this.isInRoom(),
			onChange: (value) => {
				if (!this.isUpdatingState()) {
					options.onChange(value);
				}
			}
		});
	}

	watchPageChange(getPage: () => GraphPage) {
		this.watch({
			dependencies: () => getPage().toSyncJson(),
			onChange: (json) => {
				const page = getPage();
				console.log(`Page ${page.id} changed, enqueueing page.modify command`);
				const cmd: PageModifyCommand = {
					type: "page.modify",
					commandId: generateUUID(),
					userId: this.getUserId(),
					timestamp: Date.now(),
					pageId: page.id,
					data: json,
				};
				this.enqueue(cmd);
			}
		})
	}

	watchNodeOrEdgeChange(getObj: () => GraphNode | GraphEdge) {
		this.watch({
			dependencies: () => getObj().asJson,
			onChange: (json) => {
				const obj = getObj();
				console.log(`Object ${obj.id} changed, enqueueing object.modify command`);
				const cmd: ObjectModifyCommand = {
					type: "object.modify",
					commandId: generateUUID(),
					userId: this.getUserId(),
					timestamp: Date.now(),
					pageId: obj.context.page.id,
					objectType: obj instanceof GraphNode ? "node" : "edge",
					objectId: obj.id,
					data: json,
				};
				this.enqueue(cmd);
			}
		});
	}

	private watchList<T>(options: {
		getItems: () => T[],
		getId: (item: T) => string,
		onItemAdded: (item: T) => void,
		onItemRemoved: (itemId: string) => void,
	}) {
		let previousIds = new Set(options.getItems().map(options.getId));
		this.watch({
			dependencies: () => options.getItems(),
			onChange: (changedList) => {
				const currentIds = new Set(changedList.map(options.getId));
				// Added
				for (const item of changedList) {
					const id = options.getId(item);
					if (!previousIds.has(id)) {
						options.onItemAdded(item);
					}
				}
				// Removed
				for (const id of previousIds) {
					if (!currentIds.has(id)) {
						options.onItemRemoved(id);
					}
				}
				previousIds = currentIds;
			}
		});
	}

	watchPageList(getPages: () => GraphPage[]) {
		this.watchList<GraphPage>({
			getItems: getPages,
			getId: (page) => page.id,
			onItemAdded: (page) => {
				console.log(`Page ${page.id} added, enqueueing page.add command`);
				const cmd: PageAddCommand = {
					type: "page.add",
					commandId: generateUUID(),
					userId: this.getUserId(),
					timestamp: Date.now(),
					pageId: page.id,
					data: page.toJSON(),
				};
				this.enqueue(cmd);
			},
			onItemRemoved: (pageId) => {
				console.log(`Page ${pageId} removed, enqueueing page.delete command`);
				const cmd: PageDeleteCommand = {
					type: "page.delete",
					commandId: generateUUID(),
					userId: this.getUserId(),
					timestamp: Date.now(),
					pageId: pageId,
				};
				this.enqueue(cmd);
			},
		});
	}

	watchNodeList(pageId: string, getNodes: () => GraphNode[]) {
		this.watchList<GraphNode>({
			getItems: getNodes,
			getId: (node) => node.id,
			onItemAdded: (node) => {
				console.log(`Node ${node.id} added on page ${pageId}, enqueueing object.add command`);
				const cmd: ObjectAddCommand = {
					type: "object.add",
					commandId: generateUUID(),
					userId: this.getUserId(),
					timestamp: Date.now(),
					pageId: pageId,
					objectType: "node",
					objectId: node.id,
					data: node.asJson,
				};
				this.enqueue(cmd);
			},
			onItemRemoved: (nodeId) => {
				console.log(`Node ${nodeId} removed from page ${pageId}, enqueueing object.delete command`);
				const cmd: ObjectDeleteCommand = {
					type: "object.delete",
					commandId: generateUUID(),
					userId: this.getUserId(),
					timestamp: Date.now(),
					pageId: pageId,
					objectType: "node",
					objectId: nodeId,
				};
				this.enqueue(cmd);
			},
		});
	}

	watchEdgeList(pageId: string, getEdges: () => GraphEdge[]) {
		this.watchList<GraphEdge>({
			getItems: getEdges,
			getId: (edge) => edge.id,
			onItemAdded: (edge) => {
				console.log(`Edge ${edge.id} added on page ${pageId}, enqueueing object.add command`);
				const cmd: ObjectAddCommand = {
					type: "object.add",
					commandId: generateUUID(),
					userId: this.getUserId(),
					timestamp: Date.now(),
					pageId: pageId,
					objectType: "edge",
					objectId: edge.id,
					data: edge.asJson,
				};
				this.enqueue(cmd);
			},
			onItemRemoved: (edgeId) => {
				console.log(`Edge ${edgeId} removed from page ${pageId}, enqueueing object.delete command`);
				const cmd: ObjectDeleteCommand = {
					type: "object.delete",
					commandId: generateUUID(),
					userId: this.getUserId(),
					timestamp: Date.now(),
					pageId: pageId,
					objectType: "edge",
					objectId: edgeId,
				};
				this.enqueue(cmd);
			},
		});
	}

	private watchOrderedList<T>(options: {
		getItems: () => T[],
		getId: (item: T) => string,
		onOrderChanged: (newOrder: string[]) => void,
	}) {
		let previousOrder: string[] = options.getItems().map(options.getId);
		this.watch({
			dependencies: () => options.getItems().map(options.getId),
			onChange: (currentOrder) => {
				if (previousOrder.length > 0 && !arraysEqual(previousOrder, currentOrder)) {
					options.onOrderChanged(currentOrder);
				}
				previousOrder = currentOrder;
			}
		});
	}

	watchPageOrder(getPages: () => GraphPage[]) {
		this.watchOrderedList<GraphPage>({
			getItems: getPages,
			getId: (page) => page.id,
			onOrderChanged: (newOrder) => {
				console.log(`Page order changed, enqueueing page.reorder command`);
				const cmd: Command = {
					type: "page.reorder",
					commandId: generateUUID(),
					userId: this.getUserId(),
					timestamp: Date.now(),
					pageOrder: newOrder,
				};
				this.enqueue(cmd);
			},
		});
	}

	/**
	 * Watch a state variable for changes and enqueue statevar.update commands.
	 * These commands are sent to the server for persistence but NOT applied on other clients.
	 */
	watchStateVar<T>(name: StateVarName, getValue: () => T) {
		let previousValue = getValue();
		this.watch({
			dependencies: getValue,
			onChange: (newValue) => {
				if (newValue !== previousValue) {
					console.log(`State variable ${name} changed, enqueueing statevar.update command`);
					this.enqueueStateVarUpdate(name, newValue);
					previousValue = newValue;
				}
			},
		});
	}

	/**
	 * Enqueue a statevar.update command programmatically.
	 * Use this when setting a state variable directly rather than through reactive watching.
	 */
	enqueueStateVarUpdate(name: StateVarName, value: unknown): void {
		const cmd: StateVarUpdateCommand = {
			type: "statevar.update",
			commandId: generateUUID(),
			userId: this.getUserId(),
			timestamp: Date.now(),
			name: name,
			value: value,
		};
		this.enqueue(cmd);
	}

	/**
	 * Watch a page's view for changes and enqueue view.update commands (low priority).
	 * These commands are sent to the server for persistence but NOT applied on other clients.
	 * They do not trigger a flush, so they piggyback on other commands.
	 */
	watchPageView(getPage: () => GraphPage) {
		this.watch({
			dependencies: () => getPage().view.toJSON(),
			onChange: (json) => {
				const page = getPage();
				const cmd: ViewUpdateCommand = {
					type: "view.update",
					commandId: generateUUID(),
					userId: this.getUserId(),
					timestamp: Date.now(),
					pageId: page.id,
					data: json,
				};
				this.enqueue(cmd, false); // Don't trigger flush for view updates
			},
		});
	}
}
