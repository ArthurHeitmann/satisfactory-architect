import type { AppState } from "$lib/datamodel/AppState.svelte";
import { GraphEdge } from "$lib/datamodel/GraphEdge.svelte";
import { GraphNode } from "$lib/datamodel/GraphNode.svelte";
import { GraphPage } from "$lib/datamodel/GraphPage.svelte";
import { assertUnreachable } from "$lib/utilties";
import type { GraphEdgeJson, GraphNodeJson, GraphPageJson } from "../../../../shared/types_serialization";
import type { Command, ObjectModifyCommand, PageAddCommand, PageDeleteCommand, PageModifyCommand, ObjectAddCommand, ObjectDeleteCommand, PageReorderCommand, StateVarUpdateCommand } from "../../../../shared/types_shared";

export class CommandProcessor {
	constructor(
		private appState: AppState,
		private getUserId: () => string,
	) {
	}

	applyCommands(commands: Command[]): void {
		for (const command of commands) {
			if (this.getUserId() === command.userId) {
				continue; // Skip own commands
			}
			switch (command.type) {
				case "page.add":
					this.handlePageAddCommand(command);
					break;
				case "page.delete":
					this.handlePageDeleteCommand(command);
					break;
				case "page.modify":
					this.handlePageModifyCommand(command);
					break;
				case "page.reorder":
					this.handlePageReorderCommand(command);
					break;
				case "object.add":
					this.handleObjectAddCommand(command);
					break;
				case "object.delete":
					this.handleObjectDeleteCommand(command);
					break;
				case "object.modify":
					this.handleObjectModifyCommand(command);
					break;
				case "statevar.update":
					this.handleStateVarUpdateCommand(command);
					break;
				case "view.update":
					// View updates are intentionally NOT applied to other clients
					// They are only stored on the server for persistence
					break;
				default:
					assertUnreachable(command);
			}
		}
	}

	private handlePageAddCommand(command: PageAddCommand): void {
		const page = GraphPage.fromJSON(this.appState, command.data as GraphPageJson);
		this.appState.addPage(page);
	}

	private handlePageDeleteCommand(command: PageDeleteCommand): void {
		try {
			this.appState.removePage(command.pageId);
		} catch (error) {
			console.warn(`Failed to delete page ${command.pageId}: ${(error as Error).message}`);
		}
	}

	private handlePageModifyCommand(command: PageModifyCommand): void {
		const page = this.findPageById(command.pageId);
		if (!page) {
			return;
		}
		page.applySyncJson(command.data);
	}

	private handlePageReorderCommand(command: PageReorderCommand): void {
		const newPages: GraphPage[] = [];
		for (const pageId of command.pageOrder) {
			const page = this.findPageById(pageId);
			if (page) {
				newPages.push(page);
			} else {
				console.warn(`Cannot reorder page ${pageId}: not found`);
			}
		}
		this.appState.pages = newPages;
	}
	
	private handleObjectAddCommand(command: ObjectAddCommand): void {
		const page = this.findPageById(command.pageId);
		if (!page) {
			return;
		}
		if (command.objectType === "node") {
			if (page.nodes.has(command.objectId)) {
				console.warn(`Node with id ${command.objectId} already exists on page ${page.id}, skipping add.`);
				return;
			}
			const node = GraphNode.fromJSON(command.data as GraphNodeJson, { appState: this.appState, page });
			page.nodes.set(node.id, node);
			// const node = GraphNode.fromJSON(command.data as GraphNodeJson, { appState: this.appState, page });
			// if (page.nodes.has(node.id)) {
			// 	console.warn(`Node with id ${node.id} already exists on page ${page.id}, skipping add.`);
			// 	return;
			// }
			// page.addNodes(node);
		}
		else if (command.objectType === "edge") {
			if (page.edges.has(command.objectId)) {
				console.warn(`Edge with id ${command.objectId} already exists on page ${page.id}, skipping add.`);
				return;
			}
			const edge = GraphEdge.fromJSON(command.data as GraphEdgeJson, { appState: this.appState, page });
			page.edges.set(edge.id, edge);
			// const edge = GraphEdge.fromJSON(command.data as GraphEdgeJson, { appState: this.appState, page });
			// if (page.edges.has(edge.id)) {
			// 	console.warn(`Edge with id ${edge.id} already exists on page ${page.id}, skipping add.`);
			// 	return;
			// }
			// page.addEdge(edge);
		}
		else {
			assertUnreachable(command.objectType);
		}
	}

	private handleObjectDeleteCommand(command: ObjectDeleteCommand): void {
		const page = this.findPageById(command.pageId);
		if (!page) {
			return;
		}
		try {
			if (command.objectType === "node") {
				page.nodes.delete(command.objectId);
				// page.removeNode(command.objectId);
			} else {
				page.edges.delete(command.objectId);
				// page.removeEdge(command.objectId);
			}
		} catch (error) {
			console.warn(`Failed to delete ${command.objectType} ${command.objectId}: ${(error as Error).message}`);
		}
	}

	private handleObjectModifyCommand(command: ObjectModifyCommand): void {
		const page = this.findPageById(command.pageId);
		if (!page) {
			return;
		}
		if (command.objectType === "node") {
			const node = page.nodes.get(command.objectId);
			if (node) {
				node.applyJson(command.data);
			} else {
				console.warn(`Cannot modify node ${command.objectId}: not found on page ${page.id}`);
			}
		} else {
			const edge = page.edges.get(command.objectId);
			if (edge) {
				edge.applyJson(command.data);
			} else {
				console.warn(`Cannot modify edge ${command.objectId}: not found on page ${page.id}`);
			}
		}
	}

	private handleStateVarUpdateCommand(command: StateVarUpdateCommand): void {
		switch (command.name) {
			case "currentPageId":
				// do nothing
				break;
			case "name":
				this.appState.name = command.value as string | undefined;
				break;
			default:
				console.warn(`Unknown state variable name: ${command.name}`);
		}
	}
	
	private findPageById(pageId: string): GraphPage | null {
		const page = this.appState.pages.find(p => p.id === pageId);
		if (!page) {
			console.warn(`Page not found: ${pageId}`);
			return null;
		}
		return page;
	}
}
