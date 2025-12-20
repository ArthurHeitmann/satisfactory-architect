import { GraphEdge } from "$lib/datamodel/GraphEdge.svelte";
import { GraphNode } from "$lib/datamodel/GraphNode.svelte";
import type { GraphPage } from "$lib/datamodel/GraphPage.svelte";
import { watchState } from "$lib/utilities.svelte";
import { arraysEqual, assertUnreachable } from "$lib/utilties";
import type { Command, ObjectModifyCommand, PageAddCommand, PageDeleteCommand, PageModifyCommand, ObjectAddCommand, ObjectDeleteCommand, ObjectType } from "../../../../shared/types_shared";

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

	enqueue(command: Command): void {
		switch (command.type) {
			case "page.modify": // remove old page.modify
				this.queue = this.queue.filter(c => c.type !== "page.modify" || c.pageId !== command.pageId);
				break;
			case "object.delete": // remove old object.add, object.modify
				this.queue = this.queue.filter(c => {
					if (c.type === "object.add" && c.objectId === command.objectId && c.objectType === command.objectType) {
						return false;
					}
					if (c.type === "object.modify" && c.objectId === command.objectId && c.objectType === command.objectType) {
						return false;
					}
					return true;
				});
				break;
			case "object.modify": // remove old object.modify
				this.queue = this.queue.filter(c => c.type !== "object.modify" || c.objectId !== command.objectId || c.objectType !== command.objectType);
				break;
			case "page.delete": // remove old page.*, object.*
				this.queue = this.queue.filter(c => {
					if ((c.type.startsWith("page.") || c.type.startsWith("object.")) && "pageId" in c && c.pageId === command.pageId) {
						return false;
					}
					return true;
				});
				break;
			case "object.add":
			case "page.add":
			case "page.reorder":
				break;
			default:
				assertUnreachable(command);
		}
		this.queue.push(command);
		this.scheduleFlush();
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
		const commandsToFlush = this.queue;;
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
					commandId: crypto.randomUUID(),
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
					commandId: crypto.randomUUID(),
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
					commandId: crypto.randomUUID(),
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
					commandId: crypto.randomUUID(),
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
					commandId: crypto.randomUUID(),
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
					commandId: crypto.randomUUID(),
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
					commandId: crypto.randomUUID(),
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
					commandId: crypto.randomUUID(),
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
					commandId: crypto.randomUUID(),
					userId: this.getUserId(),
					timestamp: Date.now(),
					pageOrder: newOrder,
				};
				this.enqueue(cmd);
			},
		});
	}
}
